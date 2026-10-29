/**
 * The single orchestration surface used by both the settings page and the agent
 * tools.
 *
 * One operation is implemented once here; the HTTP routes and the tools are
 * thin adapters that call these methods with the same meaning. The engine owns
 * the mutex (one synchronization at a time), the safety snapshot, the baseline
 * update and the persisted status.
 * @module services/engine
 */

import { PACKAGE_NAME } from '../constants.js'
import { compareVersions } from '../core/version.js'
import { SyncError, errorMessage, toSyncError } from '../core/errors.js'
import { displayPath } from '../core/paths.js'
import { Mutex } from '../core/mutex.js'
import { safeJsonCopy } from './engine-utils.js'
import type { FileSyncLogger } from '../core/logger.js'
import type { ConfigStore, StateStore } from '../state/store.js'
import type {
  ActionOutcome,
  ConnectionTestResult,
  ConflictInfo,
  ConflictResolution,
  ConfigGateway,
  DeviceInfo,
  DeviceInventory,
  DeviceSnapshot,
  HistoryEntry,
  InventoryScanner,
  JsonObject,
  LocalState,
  Manifest,
  OperationResult,
  PluginDiff,
  PluginInstaller,
  RemotePluginEntry,
  RemoteProfileState,
  RepoStore,
  SyncBaseline,
  SyncConfig,
  SyncConfigView,
  SyncLogger,
  SyncPlan,
} from '../types.js'
import type { PluginListResponse, PluginListRow } from '../http/api-types.js'
import {
  baselinePluginState,
  changedConfigKeys,
  isSyncable,
  localPluginState,
  remotePluginState,
  statesEqual,
  type PluginState,
} from './model.js'
import { countPlanChanges, planBackup, planRestore, planSync, type PlanInput, type RemoteMeta } from './plan.js'
import {
  buildBackupFiles,
  buildBaseline,
  deviceSnapshotPath,
  toDeviceSnapshot,
  toRemoteEntry,
  toTombstone,
} from './repo-files.js'
import { executeLocalActions, isLocalAction } from './executor.js'
import { createSnapshotService, snapshotConfigs, type SnapshotService } from './snapshot.js'
import { fileExists } from '../state/store.js'
import { join } from 'node:path'

/** Everything the engine needs, injected by the plugin entry. */
export interface EngineDeps {
  logger: FileSyncLogger
  configStore: ConfigStore
  stateStore: StateStore
  paths: { dataDir: string; workDir: string; snapshotDir: string; archiveDir: string; logPath: string }
  scanner: InventoryScanner
  configGateway: ConfigGateway
  installer: PluginInstaller
  pluginVersion: string
  dshVersion: string
  activeProfile: string
  availableProfiles: string[]
  platform: string
  env: NodeJS.ProcessEnv
  /** Build a repository store for one configuration (work dir is stable per repo+branch). */
  createRepo: (config: SyncConfig) => { store: RepoStore; workDir: string }
  /** Called after the configuration changed (auto-sync reconciliation). */
  onConfigChanged?: (config: SyncConfig) => void
}

/** Options for read-only views. */
export interface StatusOptions {
  /** Fetch the repository before computing counts. */
  refresh?: boolean
}

/** Backup options. */
export interface BackupOptions {
  message?: string
  confirmDestructive?: boolean
  signal?: AbortSignal
}

/** Restore options. */
export interface RestoreOptions {
  commit?: string
  pluginIds?: string[]
  resolutions?: ConflictResolution[]
  confirmDestructive?: boolean
  signal?: AbortSignal
}

/** Sync options. */
export interface SyncOptions {
  resolutions?: ConflictResolution[]
  confirmDestructive?: boolean
  signal?: AbortSignal
}

/** Diff options. */
export interface DiffOptions {
  direction?: 'push' | 'pull' | 'two-way'
  commit?: string
  signal?: AbortSignal
}

/** Snapshot of everything read from the repository in one operation. */
interface RemoteRead {
  manifest: Manifest | null
  state: RemoteProfileState | null
  configs: Record<string, Record<string, JsonValue>>
  devices: Record<string, DeviceSnapshot>
  head: string | null
}

/** Nullable JSON object alias used in this module. */
type JsonValue = import('../types.js').JsonValue

const EMPTY_REMOTE: RemoteRead = { manifest: null, state: null, configs: {}, devices: {}, head: null }

/**
 * Whether a plugin belongs in the user-facing inventory.
 *
 * DSH built-in/official plugins, the DSH loader's internal `cordis:*` rows and
 * this plugin itself are deliberately excluded from backup and from the
 * selectable list — counts must use the same predicate or the status card and
 * the plugin list disagree (e.g. "local 8" vs a six-row list).
 */
function isListedPlugin(name: string, builtIn: boolean): boolean {
  if (builtIn) return false
  if (name === PACKAGE_NAME) return false
  if (name.startsWith('cordis:')) return false
  return true
}

/** Convert a repository state map into comparable plugin states. */
function remoteStates(read: RemoteRead): Record<string, PluginState> {
  const out: Record<string, PluginState> = {}
  for (const [id, entry] of Object.entries(read.state?.plugins ?? {})) {
    const state = remotePluginState(entry)
    if (state === null) continue
    state.configs = read.configs[id] ?? {}
    out[id] = state
  }
  return out
}

/** Convert local inventory into comparable plugin states. */
function localStates(inventory: DeviceInventory): Record<string, PluginState> {
  const out: Record<string, PluginState> = {}
  for (const record of inventory.plugins) out[record.id] = localPluginState(record)
  return out
}

/** Convert a baseline into comparable plugin states. */
function baselineStates(baseline: SyncBaseline | undefined): Record<string, PluginState> {
  const out: Record<string, PluginState> = {}
  for (const [id, entry] of Object.entries(baseline?.plugins ?? {})) {
    out[id] = baselinePluginState(id, entry, id)
  }
  return out
}

/** Build remote metadata for conflict explanations. */
function remoteMeta(read: RemoteRead): Record<string, RemoteMeta> {
  const out: Record<string, RemoteMeta> = {}
  for (const [id, entry] of Object.entries(read.state?.plugins ?? {})) {
    out[id] = {
      updatedBy: entry.updatedBy,
      updatedAt: entry.updatedAt,
      platform: read.devices[entry.updatedBy]?.device.platform,
    }
  }
  return out
}

/**
 * Conflicts still needing a decision.
 *
 * The planner itself removes every conflict a supplied resolution actually
 * resolved, so `plan.conflicts` is already the exact unresolved set: filtering
 * by the caller's resolution list a second time would treat a resolution the
 * planner could not apply (for example a removal the configuration forbids) as
 * handled, and the operation would silently skip it.
 */
function unresolvedConflicts(plan: SyncPlan): ConflictInfo[] {
  return plan.conflicts
}

/** Human-readable conflict summary naming the affected plugins. */
function describeConflicts(conflicts: readonly ConflictInfo[]): string {
  const names = conflicts.slice(0, 3).map(conflict => conflict.pluginName)
  const suffix = conflicts.length > 3 ? ', …' : ''
  return `${conflicts.length} 个冲突（${names.join(', ')}${suffix}）需要先选择处理方式 / ${conflicts.length} conflict(s) (${names.join(', ')}${suffix}) need a decision`
}

/** Convert a plan into operation warnings when changes were filtered out. */
function summarizeActions(outcomes: readonly ActionOutcome[]): number {
  return outcomes.filter(outcome => outcome.ok && !outcome.skipped).length
}

/** Create the engine. */
export function createEngine(deps: EngineDeps): SyncEngine {
  return new SyncEngine(deps)
}

/** The orchestration engine. */
export class SyncEngine {
  private readonly deps: EngineDeps
  private readonly mutex = new Mutex()
  private readonly snapshots: SnapshotService
  private scanCache: { at: number; profile: string; inventory: DeviceInventory } | null = null
  private scanInFlight: Promise<DeviceInventory> | null = null
  /**
   * One prepared RepoStore per configuration.
   *
   * A RepoStore prepares once (clone/fetch/reset) and then reads the local work
   * tree; creating a fresh store for every status poll made each poll run a
   * full `fetch`+`reset`, so concurrent page requests raced on the same working
   * tree and the settings page appeared to load forever. The key covers every
   * setting that changes the remote or its auth, so a configuration change
   * gets a fresh store.
   */
  private repoCache: { key: string; store: RepoStore; workDir: string } | null = null
  private busy = false
  private lastError: string | null = null

  constructor(deps: EngineDeps) {
    this.deps = deps
    this.snapshots = createSnapshotService({ snapshotDir: deps.paths.snapshotDir })
  }

  /** Whether an operation currently runs. */
  isBusy(): boolean {
    return this.busy || this.mutex.isPending()
  }

  /** Latest error observed by the engine (used by the status panel). */
  currentError(): string | null {
    return this.lastError
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Read the status payload for the settings page. */
  async status(options: StatusOptions = {}): Promise<{
    status: import('../types.js').StatusView
    logs: import('../types.js').LogEntry[]
  }> {
    const config = await this.readConfig()
    let state = await this.readState()
    state = await this.persistDeviceIfChanged(state, config)
    const device = state.device

    let local: DeviceInventory | null = null
    let localError: string | null = null
    try {
      local = await this.scanLocal(config)
    } catch (error) {
      localError = errorMessage(error)
    }

    let read: RemoteRead = EMPTY_REMOTE
    let connection = state.connection
    if (config.repoUrl !== '') {
      const { store, workDir } = this.repoFor(config)
      const hasLocalCopy = await fileExists(workDir)
      // Opening the settings page must not clone or fetch. Until a work tree
      // exists the remote side is simply unknown; only `refresh: true` (an
      // explicit user action) or a page rendered after a previous operation
      // may touch the network, and only the former may report a connection
      // failure — a missing local copy is not an error.
      if (options.refresh === true) {
        try {
          const prepared = await store.prepare()
          read = await this.readRemote(store, config, prepared.head)
          connection = {
            ok: true,
            at: new Date().toISOString(),
            branch: config.branch,
            head: prepared.head,
            message: '仓库连接正常 / repository reachable',
            authMethod: this.authMethod(config),
          }
        } catch (error) {
          connection = {
            ok: false,
            at: new Date().toISOString(),
            message: errorMessage(error),
            branch: config.branch,
            authMethod: this.authMethod(config),
          }
        }
      } else if (hasLocalCopy && store.prepared()) {
        try {
          read = await this.readRemote(store, config, state.lastCommit)
        } catch {
          read = EMPTY_REMOTE
        }
      }
    }

    const baseline = state.baselines[this.deps.activeProfile]
    let uploads = 0
    let downloads = 0
    let planConflicts = 0
    if (local !== null) {
      const plan = planSync({
        profile: this.deps.activeProfile,
        config,
        now: new Date().toISOString(),
        localPlatform: this.deps.platform,
        local: localStates(local),
        remote: remoteStates(read),
        remoteTombstones: new Set(Object.entries(read.state?.plugins ?? {}).filter(([, entry]) => entry.deleted === true).map(([id]) => id)),
        remoteMeta: remoteMeta(read),
        base: baselineStates(baseline),
        warnings: [],
      })
      const counts = countPlanChanges(plan)
      uploads = counts.uploads
      downloads = counts.downloads
      planConflicts = plan.conflicts.length
    }

    const conflictCount = Math.max(state.conflicts.length, planConflicts)
    let syncState: import('../types.js').SyncState
    if (config.repoUrl === '') syncState = 'not-configured'
    else if (this.isBusy()) syncState = 'syncing'
    else if (localError !== null) syncState = 'error'
    else if (conflictCount > 0) syncState = 'conflict'
    else if (state.lastError !== null) syncState = 'error'
    else if (uploads > 0 && downloads > 0) syncState = 'diverged'
    else if (uploads > 0) syncState = 'ahead'
    else if (downloads > 0) syncState = 'behind'
    else syncState = 'synced'

    const status: import('../types.js').StatusView = {
      state: syncState,
      config: this.configView(config, device),
      branch: config.branch,
      lastSyncAt: state.lastSyncAt,
      lastCommit: state.lastCommit,
      lastOperation: state.lastOperation,
      localPluginCount: local?.plugins.filter(plugin => isListedPlugin(plugin.name, plugin.builtIn)).length ?? 0,
      remotePluginCount:
        read.state === null
          ? null
          : Object.values(read.state.plugins)
              .filter(entry => entry.deleted !== true && isListedPlugin(entry.name, entry.builtIn))
              .length,
      pendingUploads: uploads,
      pendingDownloads: downloads,
      conflictCount,
      lastError: localError ?? state.lastError ?? this.lastError,
      busy: this.isBusy(),
      connection: connection ?? null,
    }
    return { status, logs: this.deps.logger.recent(50) }
  }

  /** Save configuration from the settings page. */
  async saveConfig(patch: Partial<SyncConfig>): Promise<{ config: SyncConfigView }> {
    const current = await this.readConfig()
    const merged: Partial<SyncConfig> = { ...current, ...patch }
    if (patch.autoSync !== undefined) merged.autoSync = { ...current.autoSync, ...patch.autoSync }
    if (current.repoUrl !== (patch.repoUrl ?? current.repoUrl)) {
      // A different repository invalidates the cached connection result.
      const state = await this.readState()
      state.connection = null
      await this.deps.stateStore.write(state)
    }
    await this.deps.configStore.write(merged as SyncConfig)
    const config = await this.readConfig()
    const state = await this.readState()
    const next = await this.persistDeviceIfChanged(state, config)
    this.deps.onConfigChanged?.(config)
    return { config: this.configView(config, next.device) }
  }

  /** Test repository connectivity, optionally with unsaved values. */
  async testConnection(patch?: Partial<SyncConfig>): Promise<ConnectionTestResult> {
    const current = await this.readConfig()
    const config = patch === undefined ? current : { ...current, ...patch, autoSync: current.autoSync }
    if (config.repoUrl.trim() === '') {
      throw new SyncError('not-configured', '请先填写 Git 仓库地址 / configure a repository URL first')
    }
    const { store } = this.repoFor(config)
    const result = await store.testConnection()
    const state = await this.readState()
    state.connection = result
    await this.deps.stateStore.write(state)
    return result
  }

  /** List plugins with their sync status for the settings page. */
  async listPlugins(): Promise<PluginListResponse> {
    const config = await this.readConfig()
    const state = await this.readState()
    const local = await this.scanLocal(config)
    let read: RemoteRead = EMPTY_REMOTE
    if (config.repoUrl !== '') {
      try {
        const { store, workDir } = this.repoFor(config)
        if ((await fileExists(workDir)) && store.prepared()) {
          read = await this.readRemote(store, config, state.lastCommit)
        }
      } catch {
        read = EMPTY_REMOTE
      }
    }
    const localMap = localStates(local)
    const remoteMap = remoteStates(read)
    const diffs = new Map<string, PluginDiff>()
    try {
      const plan = planSync(this.planInput(config, local, read, state))
      for (const diff of plan.diffs) diffs.set(diff.id, diff)
    } catch {
      // A malformed remote must not break the local plugin list.
    }
    const ids = [...new Set([...Object.keys(localMap), ...Object.keys(remoteMap)])]
      // Only user-installed third-party plugins belong in the selectable
      // list: DSH built-ins are inventory-only, the DSH loader's internal
      // `cordis:*` entries are not installable plugins, and this plugin never
      // backs itself up (avoiding a self-sync loop).
      .filter(id => {
        const local = localMap[id]
        const remote = remoteMap[id]
        return isListedPlugin(local?.name ?? remote?.name ?? id, local?.builtIn === true || remote?.builtIn === true)
      })
      .sort()
    const rows: PluginListRow[] = ids.map(id => {
      const localState = localMap[id]
      const remoteState = remoteMap[id]
      const diff = diffs.get(id)
      const conflict = diff?.conflict
      let syncStatus: PluginListRow['syncStatus'] = 'synced'
      if (conflict !== undefined) syncStatus = 'conflict'
      else if (localState !== undefined && remoteState === undefined) syncStatus = 'local-only'
      else if (localState === undefined && remoteState !== undefined) syncStatus = 'remote-only'
      else if (diff?.kind === 'version-diff') syncStatus = 'version-diff'
      else if (diff?.kind === 'config-diff') syncStatus = 'config-diff'
      else if (diff?.kind === 'enabled-diff') syncStatus = 'enabled-diff'
      const record = local.plugins.find(plugin => plugin.id === id)
      const entry = read.state?.plugins[id]
      const excluded = config.excludedPlugins.includes(id) || (record?.name !== undefined && config.excludedPlugins.includes(record.name))
      if (excluded) syncStatus = 'excluded'
      const row: PluginListRow = {
        id,
        name: record?.name ?? entry?.name ?? id,
        presence: localState !== undefined && remoteState !== undefined ? 'both' : localState !== undefined ? 'local' : 'remote',
        version: localState?.version ?? null,
        remoteVersion: remoteState?.version ?? null,
        enabled: localState?.enabled ?? false,
        remoteEnabled: remoteState?.enabled ?? null,
        syncStatus,
        inSync: diff === undefined || diff.kind === 'identical' ? !excluded : false,
        syncable: !(record?.builtIn ?? entry?.builtIn ?? false) && !excluded,
        selected: !excluded,
      }
      if (record?.displayName !== undefined) row.displayName = record.displayName
      else if (entry?.displayName !== undefined) row.displayName = entry.displayName
      if (record !== undefined) row.local = record
      if (entry !== undefined) row.remote = entry
      if (conflict !== undefined) row.conflict = true
      if (diff !== undefined) row.diff = diff
      return row
    })
    return { rows, activeProfile: this.deps.activeProfile, availableProfiles: this.deps.availableProfiles }
  }

  /** Compute the plan for a direction without executing anything. */
  async diff(options: DiffOptions = {}): Promise<{ direction: 'push' | 'pull' | 'two-way'; plan: SyncPlan }> {
    const direction = options.direction ?? 'two-way'
    if (direction === 'push') {
      const plan = await this.previewBackup(options.signal)
      return { direction, plan }
    }
    if (direction === 'pull') {
      const preview = await this.previewRestore({ commit: options.commit, signal: options.signal })
      return { direction, plan: preview.plan }
    }
    const preview = await this.previewSync(options.signal)
    return { direction, plan: preview.plan }
  }

  /** Back up this device's plugin state to the repository. */
  async backup(options: BackupOptions = {}): Promise<OperationResult> {
    return this.mutex.runExclusive(async () => {
      this.busy = true
      const startedAt = new Date().toISOString()
      try {
        const config = await this.readConfig()
        this.ensureConfigured(config)
        let state = await this.readState()
        state = await this.persistDeviceIfChanged(state, config)
        const { store } = this.repoFor(config)
        const prepared = await store.prepare({ signal: options.signal })
        const local = await this.scanLocal(config, true)
        const read = await this.readRemote(store, config, prepared.head)
        const plan = planBackup(this.planInput(config, local, read, state))
        if (plan.requiresConfirmation && options.confirmDestructive !== true) {
          throw new SyncError(
            'confirmation-required',
            '备份包含删除远端记录的破坏性操作，需要确认 / the backup removes repository entries and requires confirmation',
            { details: { plan: safeJsonCopy(plan) as unknown as import('../types.js').JsonValue } },
          )
        }
        const build = (currentRead: RemoteRead, inventory: DeviceInventory): { files: Record<string, string>; deletions: string[] } =>
          this.buildRemoteFiles({ config, plan, local: inventory, read: currentRead, device: state.device, baselineRead: read })
        const firstFiles = build(read, local)
        const now = new Date().toISOString()
        const repositoryHasData = read.manifest !== null || read.state !== null
        const nothingToRecord = plan.actions.length === 0 && repositoryHasData
        const trailers = {
          operation: 'backup',
          deviceId: state.device.id,
          deviceName: state.device.name,
          profile: this.deps.activeProfile,
          result: plan.actions.length === 0 ? 'no-changes' : 'ok',
          pluginCount: String(local.plugins.filter(plugin => !plugin.builtIn).length),
        }
        const write = nothingToRecord
          ? { changed: false, pushed: false, commit: prepared.head, changedFiles: [], retried: false }
          : await store.write({
              files: firstFiles.files,
              deletions: firstFiles.deletions,
              rebuild: async () => {
                const freshRead = await this.readRemote(store, config, null)
                const freshPlan = planBackup(this.planInput(config, local, freshRead, await this.readState()))
                return this.buildRemoteFiles({ config, plan: freshPlan, local, read: freshRead, device: state.device, baselineRead: freshRead })
              },
              message: this.commitMessage('backup', options.message),
              trailers,
              signal: options.signal,
            })
        const localAfter = await this.scanLocal(config, true)
        const remoteAfter = await this.readRemote(store, config, write.commit)
        const baseline = buildBaseline({
          profile: this.deps.activeProfile,
          commit: write.commit ?? prepared.head,
          now,
          local: localStates(localAfter),
          remote: remoteStates(remoteAfter),
          previous: state.baselines[this.deps.activeProfile],
        })
        const outcomes: ActionOutcome[] = plan.actions.map(action => ({
          action,
          ok: true,
          detail: write.changed ? '已写入备份仓库 / written to the backup repository' : '无变化 / no changes',
        }))
        state.lastSyncAt = now
        state.lastCommit = write.commit ?? prepared.head
        state.lastError = null
        state.baselines[this.deps.activeProfile] = baseline
        state.conflicts = []
        state.lastOperation = {
          operation: 'backup',
          at: now,
          ok: true,
          commit: write.commit,
          changedPlugins: plan.actions.length,
        }
        await this.deps.stateStore.write(state)
        this.lastError = null
        const result: OperationResult = {
          ok: true,
          operation: 'backup',
          startedAt,
          finishedAt: new Date().toISOString(),
          commit: write.commit,
          pushed: write.pushed,
          noChanges: !write.changed,
          actionOutcomes: outcomes,
          warnings: plan.warnings,
        }
        this.deps.logger.info(`备份完成 / backup finished (changed=${String(write.changed)}, pushed=${String(write.pushed)})`, {
          commit: write.commit,
          actions: plan.actions.length,
        })
        return result
      } catch (error) {
        this.recordFailure('backup', error)
        throw error
      } finally {
        this.busy = false
      }
    }, { wait: true })
  }

  /** Preview a restore from the branch head or one commit. */
  async previewRestore(options: { commit?: string; signal?: AbortSignal } = {}): Promise<{
    plan: SyncPlan
    snapshotPlanned: boolean
    source: { commit: string | null; updatedAt: string | null }
  }> {
    return this.mutex.runExclusive(async () => {
      const config = await this.readConfig()
      this.ensureConfigured(config)
      const state = await this.readState()
      const { store } = this.repoFor(config)
      const prepared = await store.prepare({ signal: options.signal })
      const read = options.commit === undefined || options.commit === ''
        ? await this.readRemote(store, config, prepared.head)
        : await this.readAtCommit(store, config, options.commit)
      const local = await this.scanLocal(config)
      const plan = planRestore(this.planInput(config, local, read, state))
      return {
        plan,
        snapshotPlanned: plan.actions.some(isLocalAction),
        source: {
          commit: options.commit === undefined || options.commit === '' ? prepared.head : options.commit,
          updatedAt: read.state?.updatedAt ?? null,
        },
      }
    }, { wait: true })
  }

  /** Restore plugins from the repository (never deletes local extras). */
  async restore(options: RestoreOptions = {}): Promise<OperationResult> {
    return this.runRestore({ ...options, operation: 'restore' })
  }

  /** Restore one history commit; always takes a snapshot first. */
  async rollback(options: RestoreOptions & { commit: string }): Promise<OperationResult> {
    if (options.commit.trim() === '') throw new SyncError('invalid-config', '缺少要恢复的提交 / a commit is required')
    return this.runRestore({ ...options, operation: 'rollback' })
  }

  /** Preview a two-way sync. */
  async previewSync(signal?: AbortSignal): Promise<{ plan: SyncPlan }> {
    return this.mutex.runExclusive(async () => {
      const config = await this.readConfig()
      this.ensureConfigured(config)
      const state = await this.readState()
      const { store } = this.repoFor(config)
      const prepared = await store.prepare({ signal })
      const read = await this.readRemote(store, config, prepared.head)
      const local = await this.scanLocal(config)
      return { plan: planSync(this.planInput(config, local, read, state)) }
    }, { wait: true })
  }

  /** Perform a two-way synchronization. */
  async sync(options: SyncOptions = {}): Promise<OperationResult> {
    return this.mutex.runExclusive(async () => {
      this.busy = true
      const startedAt = new Date().toISOString()
      let snapshotId: string | undefined
      try {
        const config = await this.readConfig()
        this.ensureConfigured(config)
        let state = await this.readState()
        state = await this.persistDeviceIfChanged(state, config)
        const { store } = this.repoFor(config)
        const prepared = await store.prepare({ signal: options.signal })
        const local = await this.scanLocal(config, true)
        const read = await this.readRemote(store, config, prepared.head)
        const base = this.planInput(config, local, read, state)
        const plan = planSync({ ...base, resolutions: options.resolutions })
        const pending = unresolvedConflicts(plan)
        if (pending.length > 0) {
          throw new SyncError(
            'conflict-present',
            describeConflicts(pending),
            { details: { plan: safeJsonCopy(plan) as unknown as import('../types.js').JsonValue } },
          )
        }
        if (plan.actions.length === 0) {
          const now = new Date().toISOString()
          state.lastSyncAt = now
          state.lastCommit = prepared.head
          state.lastError = null
          state.conflicts = []
          await this.deps.stateStore.write(state)
          return {
            ok: true,
            operation: 'sync',
            startedAt,
            finishedAt: new Date().toISOString(),
            commit: prepared.head,
            noChanges: true,
            actionOutcomes: [],
            warnings: plan.warnings,
          }
        }
        if (plan.requiresConfirmation && options.confirmDestructive !== true) {
          throw new SyncError(
            'confirmation-required',
            '同步包含破坏性操作，需要确认 / the sync contains destructive actions and requires confirmation',
            { details: { plan: safeJsonCopy(plan) as unknown as import('../types.js').JsonValue } },
          )
        }
        const localActions = plan.actions.filter(isLocalAction)
        if (localActions.length > 0) {
          snapshotId = await this.snapshots.create({
            operation: 'sync',
            profile: this.deps.activeProfile,
            device: state.device,
            inventory: local,
            configs: snapshotConfigs(local, config.excludedConfigPlugins),
          })
        }
        const outcomes = await executeLocalActions(plan.actions, {
          installer: this.deps.installer,
          configGateway: this.deps.configGateway,
          logger: this.deps.logger,
          profile: this.deps.activeProfile,
          signal: options.signal,
          resolveInstallSpec: async spec => this.resolveTarballSpec(spec, store),
        })
        const failed = outcomes.filter(outcome => !outcome.ok && outcome.skipped !== true)
        if (failed.length > 0) {
          const rollback = snapshotId === undefined
            ? null
            : await this.tryRollback(snapshotId, config, state.device)
          state.lastError = failed.map(outcome => `${outcome.action.pluginName}: ${outcome.error ?? 'failed'}`).join('; ')
          state.lastOperation = { operation: 'sync', at: new Date().toISOString(), ok: false, error: state.lastError }
          await this.deps.stateStore.write(state)
          return {
            ok: false,
            operation: 'sync',
            startedAt,
            finishedAt: new Date().toISOString(),
            actionOutcomes: outcomes,
            warnings: [
              ...plan.warnings,
              ...(rollback === null ? [] : [`已自动回滚可回滚的配置变更 / rolled back configuration: ${rollback.restoredConfigs.length}`]),
              ...(rollback === null ? [] : rollback.notRestorablePlugins.map(plugin => `无法自动回滚插件安装 / cannot roll back install: ${plugin.name}`)),
            ],
            error: state.lastError,
            snapshot: snapshotId,
          }
        }
        const build = (currentRead: RemoteRead, inventory: DeviceInventory): { files: Record<string, string>; deletions: string[] } =>
          this.buildRemoteFiles({
            config,
            plan,
            local: inventory,
            read: currentRead,
            device: state.device,
            baselineRead: read,
          })
        const firstFiles = build(read, local)
        const write = plan.actions.some(action => !isLocalAction(action))
          ? await store.write({
              files: firstFiles.files,
              deletions: firstFiles.deletions,
              rebuild: async () => {
                const freshRead = await this.readRemote(store, config, null)
                const freshPlan = planSync({ ...this.planInput(config, await this.scanLocal(config, true), freshRead, state), resolutions: options.resolutions })
                return this.buildRemoteFiles({ config, plan: freshPlan, local: await this.scanLocal(config), read: freshRead, device: state.device, baselineRead: freshRead })
              },
              message: this.commitMessage('sync', undefined),
              trailers: {
                operation: 'sync',
                deviceId: state.device.id,
                deviceName: state.device.name,
                profile: this.deps.activeProfile,
                result: 'ok',
                pluginCount: String(local.plugins.filter(plugin => !plugin.builtIn).length),
              },
              signal: options.signal,
            })
          : { changed: false, pushed: false, commit: prepared.head, changedFiles: [], retried: false }
        const localAfter = await this.scanLocal(config, true)
        const remoteAfter = await this.readRemote(store, config, write.commit)
        const now = new Date().toISOString()
        state.baselines[this.deps.activeProfile] = buildBaseline({
          profile: this.deps.activeProfile,
          commit: write.commit ?? prepared.head,
          now,
          local: localStates(localAfter),
          remote: remoteStates(remoteAfter),
          previous: state.baselines[this.deps.activeProfile],
        })
        state.lastSyncAt = now
        state.lastCommit = write.commit ?? prepared.head
        state.lastError = null
        state.conflicts = []
        state.lastOperation = {
          operation: 'sync',
          at: now,
          ok: true,
          commit: write.commit,
          changedPlugins: plan.actions.length,
        }
        await this.deps.stateStore.write(state)
        this.lastError = null
        return {
          ok: true,
          operation: 'sync',
          startedAt,
          finishedAt: new Date().toISOString(),
          commit: write.commit,
          pushed: write.pushed,
          noChanges: false,
          actionOutcomes: outcomes,
          warnings: plan.warnings,
          snapshot: snapshotId,
        }
      } catch (error) {
        this.recordFailure('sync', error)
        throw error
      } finally {
        this.busy = false
      }
    }, { wait: true })
  }

  /** Read backup history from Git. */
  async history(options: { limit?: number; signal?: AbortSignal } = {}): Promise<{
    entries: HistoryEntry[]
    lastOperation: LocalState['lastOperation']
  }> {
    const config = await this.readConfig()
    this.ensureConfigured(config)
    const state = await this.readState()
    const { store, workDir } = this.repoFor(config)
    // No local copy yet: show an empty history instead of cloning on page
    // open. The first backup/restore/sync creates the work tree.
    if (!(await fileExists(workDir))) return { entries: [], lastOperation: state.lastOperation }
    // A cached store is already prepared; only the first call in a process
    // prepares (and that is what may touch the network), so opening the page
    // does not fetch the remote on every request.
    const entries = await store.history({ limit: options.limit ?? 100, signal: options.signal })
    return { entries, lastOperation: state.lastOperation }
  }

  /** Update automatic synchronization settings. */
  async setAutoSync(patch: Partial<SyncConfig['autoSync']>): Promise<{ status: import('../types.js').StatusView }> {
    await this.saveConfig({ autoSync: { ...(await this.readConfig()).autoSync, ...patch } })
    // The wire contract (`AutoSyncResponse`) is `{ status: StatusView }`; the
    // route used to nest the whole status payload one level deeper, so the
    // page read `response.status.config` from `undefined` after a save.
    const { status } = await this.status()
    return { status }
  }

  /** Recent log entries. */
  logs(options: { limit?: number } = {}): { entries: import('../types.js').LogEntry[] } {
    return { entries: this.deps.logger.recent(options.limit ?? 100) }
  }

  /** Snapshot ids available for rollback. */
  listSnapshots(): Promise<string[]> {
    return this.snapshots.list()
  }

  /** Roll back the configuration/enablement half of one snapshot. */
  async rollbackSnapshot(id: string): Promise<OperationResult> {
    return this.mutex.runExclusive(async () => {
      const startedAt = new Date().toISOString()
      const config = await this.readConfig()
      const state = await this.readState()
      const local = await this.scanLocal(config, true)
      const report = await this.snapshots.rollback({
        id,
        installer: this.deps.installer,
        configGateway: this.deps.configGateway,
        profile: this.deps.activeProfile,
        logger: this.deps.logger,
        currentInventory: local,
      })
      const outcomes: ActionOutcome[] = []
      const warnings = [
        ...report.notRestorablePlugins.map(plugin => `无法自动回滚插件安装 / cannot roll back install: ${plugin.name} (${plugin.version ?? '?'})`),
        ...report.errors,
      ]
      state.lastOperation = {
        operation: 'rollback',
        at: new Date().toISOString(),
        ok: report.errors.length === 0,
        changedPlugins: report.restoredConfigs.length + report.restoredEnabled.length,
      }
      if (report.errors.length > 0) state.lastError = report.errors.join('; ')
      await this.deps.stateStore.write(state)
      return {
        ok: report.errors.length === 0,
        operation: 'rollback',
        startedAt,
        finishedAt: new Date().toISOString(),
        actionOutcomes: outcomes,
        warnings,
        snapshot: report.snapshot,
        error: report.errors.length === 0 ? undefined : report.errors.join('; '),
      }
    }, { wait: true })
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Build a plan input from the current reads. */
  private planInput(config: SyncConfig, local: DeviceInventory, read: RemoteRead, state: LocalState, resolutions?: ConflictResolution[]): PlanInput {
    const tombstones = new Set(
      Object.entries(read.state?.plugins ?? {})
        .filter(([, entry]) => entry.deleted === true)
        .map(([id]) => id),
    )
    const localMap = localStates(local)
    for (const id of Object.keys(localMap)) {
      const plugin = localMap[id]
      if (plugin === undefined) continue
      const excluded = config.excludedPlugins.includes(plugin.id) || config.excludedPlugins.includes(plugin.name)
      const syncable = isSyncable({ state: plugin, excludedPlugins: config.excludedPlugins, platform: this.deps.platform })
      localMap[id] = { ...plugin, syncable: syncable && !excluded }
    }
    const warnings: string[] = []
    const meta = remoteMeta(read)
    for (const [id, entry] of Object.entries(read.state?.plugins ?? {})) {
      if (entry.deleted === true) continue
      const devices = read.devices[entry.updatedBy]
      if (entry.pathOnly && devices !== undefined && devices.device.platform !== this.deps.platform) {
        warnings.push(`插件 ${entry.name} 由 ${devices.device.platform} 设备归档，可能不兼容当前平台 / archived on ${devices.device.platform}`)
      }
      if (meta[id]?.platform !== undefined && meta[id].platform !== this.deps.platform && entry.origin === 'local-path') {
        // Already covered above; kept for a future per-plugin platform declaration.
      }
    }
    return {
      profile: this.deps.activeProfile,
      config,
      now: new Date().toISOString(),
      localPlatform: this.deps.platform,
      local: localMap,
      remote: remoteStates(read),
      remoteTombstones: tombstones,
      remoteMeta: meta,
      base: baselineStates(state.baselines[this.deps.activeProfile]),
      resolutions,
      warnings,
    }
  }

  /** Build the repository file set for one plan. */
  private buildRemoteFiles(input: {
    config: SyncConfig
    plan: SyncPlan
    local: DeviceInventory
    read: RemoteRead
    device: DeviceInfo
    baselineRead: RemoteRead
  }): { files: Record<string, string>; deletions: string[] } {
    const localMap = localStates(input.local)
    const upserts = new Map<string, { entry: RemotePluginEntry; configs?: JsonObject }>()
    const removals = new Set<string>()
    const configDeletions = new Set<string>()
    const configWrites = new Map<string, JsonObject | null>()
    for (const action of input.plan.actions) {
      if (action.kind === 'push-plugin') {
        const state = localMap[action.pluginId]
        if (state === undefined) continue
        upserts.set(action.pluginId, { entry: toRemoteEntry(state, { deviceId: input.device.id, now: new Date().toISOString() }) })
      } else if (action.kind === 'push-config') {
        const existing = upserts.get(action.pluginId)
        if (existing !== undefined) {
          existing.configs = action.configs ?? {}
        } else {
          const state = localMap[action.pluginId]
          if (state === undefined) continue
          upserts.set(action.pluginId, {
            entry: toRemoteEntry(state, { deviceId: input.device.id, now: new Date().toISOString() }),
            configs: action.configs ?? {},
          })
        }
        configWrites.set(action.pluginId, action.configs ?? {})
      } else if (action.kind === 'remove-remote') {
        removals.add(action.pluginId)
      }
    }
    for (const [pluginId, configs] of configWrites) {
      if (configs === null) continue
      if (Object.keys(configs).length === 0) {
        configDeletions.add(pluginId)
        const existing = upserts.get(pluginId)
        if (existing !== undefined) existing.configs = undefined
      } else {
        const existing = upserts.get(pluginId)
        if (existing !== undefined) existing.configs = configs
      }
    }
    const deviceSnapshot = toDeviceSnapshot({
      device: input.device,
      profile: this.deps.activeProfile,
      now: new Date().toISOString(),
      plugins: input.local.plugins,
    })
    const knownDevices = input.read.manifest?.devices ?? input.baselineRead.manifest?.devices ?? []
    return buildBackupFiles({
      backupDir: input.config.backupDir,
      generatorVersion: this.deps.pluginVersion,
      profile: this.deps.activeProfile,
      deviceId: input.device.id,
      now: new Date().toISOString(),
      previousManifest: input.read.manifest,
      previousState: input.read.state,
      upserts: [...upserts.values()],
      removals: [...removals],
      configDeletions: [...configDeletions],
      deviceSnapshot,
      knownDevices,
    })
  }

  /** Return the cached store for this configuration, creating it on change. */
  private repoFor(config: SyncConfig): { store: RepoStore; workDir: string } {
    const key = [
      config.repoUrl,
      config.branch,
      config.backupDir,
      config.authMode,
      config.tokenEnvVar,
      config.username,
    ].join('\u0000')
    if (this.repoCache !== null && this.repoCache.key === key) return this.repoCache
    const created = this.deps.createRepo(config)
    this.repoCache = { key, ...created }
    return this.repoCache
  }

  /** Read everything needed from the repository. */
  private async readRemote(store: RepoStore, config: SyncConfig, head: string | null): Promise<RemoteRead> {
    let manifest: Manifest | null = null
    let state: RemoteProfileState | null = null
    let configs: Record<string, Record<string, JsonValue>> = {}
    let devices: Record<string, DeviceSnapshot> = {}
    try {
      manifest = await store.readManifest()
    } catch (error) {
      if (!isMissingRepository(error)) throw error
    }
    try {
      state = await store.readProfileState(this.deps.activeProfile)
    } catch (error) {
      if (!isMissingRepository(error)) throw error
    }
    try {
      configs = await store.readConfigs(this.deps.activeProfile)
    } catch (error) {
      if (!isMissingRepository(error)) throw error
    }
    try {
      devices = await store.readDeviceSnapshots()
    } catch {
      devices = {}
    }
    return { manifest, state, configs, devices, head }
  }

  /** Read a repository state at one commit. */
  private async readAtCommit(store: RepoStore, config: SyncConfig, commit: string): Promise<RemoteRead> {
    if (!/^[0-9a-fA-F]{4,64}$/.test(commit)) {
      throw new SyncError('invalid-manifest', `非法提交标识 / invalid commit id: ${JSON.stringify(commit)}`)
    }
    const snapshot = await store.readAtCommit(commit, this.deps.activeProfile)
    return {
      manifest: snapshot.manifest,
      state: snapshot.state,
      configs: snapshot.configs,
      devices: snapshot.device === null ? {} : {},
      head: commit,
    }
  }

  /** Execute a restore (or history rollback) with a safety snapshot. */
  private async runRestore(options: RestoreOptions & { operation: 'restore' | 'rollback' }): Promise<OperationResult> {
    return this.mutex.runExclusive(async () => {
      this.busy = true
      const startedAt = new Date().toISOString()
      let snapshotId: string | undefined
      try {
        const config = await this.readConfig()
        this.ensureConfigured(config)
        const state = await this.readState()
        const { store } = this.repoFor(config)
        const prepared = await store.prepare({ signal: options.signal })
        const read = options.commit === undefined || options.commit === ''
          ? await this.readRemote(store, config, prepared.head)
          : await this.readAtCommit(store, config, options.commit)
        const local = await this.scanLocal(config, true)
        let plan = planRestore(this.planInput(config, local, read, state, options.resolutions))
        if (options.pluginIds !== undefined && options.pluginIds.length > 0) {
          const wanted = new Set(options.pluginIds)
          plan = { ...plan, actions: plan.actions.filter(action => wanted.has(action.pluginId)) }
        }
        const pending = unresolvedConflicts(plan)
        if (pending.length > 0) {
          throw new SyncError(
            'conflict-present',
            describeConflicts(pending),
            { details: { plan: safeJsonCopy(plan) as unknown as JsonValue } },
          )
        }
        if (plan.actions.length === 0) {
          state.lastOperation = { operation: options.operation, at: new Date().toISOString(), ok: true, changedPlugins: 0 }
          await this.deps.stateStore.write(state)
          return {
            ok: true,
            operation: options.operation,
            startedAt,
            finishedAt: new Date().toISOString(),
            noChanges: true,
            actionOutcomes: [],
            warnings: plan.warnings,
          }
        }
        if (plan.requiresConfirmation && options.confirmDestructive !== true) {
          throw new SyncError(
            'confirmation-required',
            '恢复包含破坏性操作，需要确认 / the restore contains destructive actions and requires confirmation',
            { details: { plan: safeJsonCopy(plan) as unknown as JsonValue } },
          )
        }
        snapshotId = await this.snapshots.create({
          operation: options.operation,
          profile: this.deps.activeProfile,
          device: state.device,
          inventory: local,
          configs: snapshotConfigs(local, config.excludedConfigPlugins),
        })
        const outcomes = await executeLocalActions(plan.actions, {
          installer: this.deps.installer,
          configGateway: this.deps.configGateway,
          logger: this.deps.logger,
          profile: this.deps.activeProfile,
          signal: options.signal,
          resolveInstallSpec: async spec => this.resolveTarballSpec(spec, store),
        })
        const failed = outcomes.filter(outcome => !outcome.ok && outcome.skipped !== true)
        const localAfter = await this.scanLocal(config, true)
        const now = new Date().toISOString()
        const baseline = buildBaseline({
          profile: this.deps.activeProfile,
          commit: plan.direction === 'pull' ? (options.commit ?? prepared.head) : prepared.head,
          now,
          local: localStates(localAfter),
          remote: remoteStates(read),
          previous: state.baselines[this.deps.activeProfile],
        })
        state.baselines[this.deps.activeProfile] = baseline
        state.lastCommit = prepared.head
        state.lastOperation = {
          operation: options.operation,
          at: now,
          ok: failed.length === 0,
          commit: options.commit ?? prepared.head,
          changedPlugins: summarizeActions(outcomes),
        }
        if (failed.length === 0) {
          state.lastSyncAt = now
          state.lastError = null
          state.conflicts = []
        } else {
          const rollback = await this.tryRollback(snapshotId, config, state.device)
          state.lastError = failed.map(outcome => `${outcome.action.pluginName}: ${outcome.error ?? 'failed'}`).join('; ')
          state.conflicts = plan.conflicts.map(conflict => ({ pluginId: conflict.pluginId, conflict, detectedAt: new Date().toISOString() }))
          await this.deps.stateStore.write(state)
          return {
            ok: false,
            operation: options.operation,
            startedAt,
            finishedAt: new Date().toISOString(),
            actionOutcomes: outcomes,
            warnings: [
              ...plan.warnings,
              ...(rollback === null ? [] : [`已自动回滚配置变更 / configuration rolled back: ${rollback.restoredConfigs.length}`]),
              ...(rollback === null ? [] : rollback.notRestorablePlugins.map(plugin => `无法自动回滚插件安装 / cannot roll back install: ${plugin.name}`)),
            ],
            error: state.lastError,
            snapshot: snapshotId,
          }
        }
        await this.deps.stateStore.write(state)
        this.lastError = null
        return {
          ok: true,
          operation: options.operation,
          startedAt,
          finishedAt: new Date().toISOString(),
          commit: options.commit ?? prepared.head,
          noChanges: false,
          actionOutcomes: outcomes,
          warnings: plan.warnings,
          snapshot: snapshotId,
        }
      } catch (error) {
        this.recordFailure(options.operation, error)
        throw error
      } finally {
        this.busy = false
      }
    }, { wait: true })
  }

  /** Best-effort rollback of a snapshot after a failed local operation. */
  private async tryRollback(snapshotId: string, config: SyncConfig, device: DeviceInfo): Promise<import('./snapshot.js').RollbackReport | null> {
    try {
      const local = await this.scanLocal(config, true)
      return await this.snapshots.rollback({
        id: snapshotId,
        installer: this.deps.installer,
        configGateway: this.deps.configGateway,
        profile: this.deps.activeProfile,
        logger: this.deps.logger,
        currentInventory: local,
      })
    } catch (error) {
      this.deps.logger.error(`自动回滚失败 / automatic rollback failed: ${errorMessage(error)}`)
      return null
    }
  }

  /** Resolve a `backup-tarball:<repo-relative path>` install spec. */
  private async resolveTarballSpec(spec: string, store: RepoStore): Promise<string> {
    const relative = spec.slice('backup-tarball:'.length)
    const config = await this.readConfig()
    const workDir = this.repoFor(config).workDir
    const { safeJoin } = await import('../core/paths.js')
    const absolute = safeJoin(workDir, relative.startsWith(config.backupDir) ? relative : `${config.backupDir === '' ? '' : `${config.backupDir}/`}${relative}`)
    if (!(await fileExists(absolute))) {
      throw new SyncError('install-failed', `本地插件归档不存在 / plugin archive not found: ${relative}`)
    }
    return absolute
  }

  /** Preview a backup (used by the diff view). */
  private async previewBackup(signal?: AbortSignal): Promise<SyncPlan> {
    const config = await this.readConfig()
    this.ensureConfigured(config)
    const state = await this.readState()
    const { store } = this.repoFor(config)
    const prepared = await store.prepare({ signal })
    const read = await this.readRemote(store, config, prepared.head)
    const local = await this.scanLocal(config)
    return planBackup(this.planInput(config, local, read, state))
  }

  /** Read configuration. */
  private readConfig(): Promise<SyncConfig> {
    return this.deps.configStore.read()
  }

  /** Read local state. */
  private readState(): Promise<LocalState> {
    return this.deps.stateStore.read()
  }

  /** Keep the persisted device identity in step with configuration/versions. */
  private async persistDeviceIfChanged(state: LocalState, config: SyncConfig): Promise<LocalState> {
    const next: DeviceInfo = {
      ...state.device,
      name: config.deviceName,
      dshVersion: this.deps.dshVersion,
      pluginVersion: this.deps.pluginVersion,
      platform: this.deps.platform,
      arch: process.arch,
    }
    if (JSON.stringify(next) === JSON.stringify(state.device)) return state
    state.device = next
    await this.deps.stateStore.write(state)
    return state
  }

  /**
   * Drop the cached inventory: the profile's plugins changed.
   *
   * Called from the `plugin-manager/changed` listener; the next read rescans.
   */
  invalidateScan(): void {
    this.scanCache = null
  }

  /**
   * Scan the local profile, with a cache shared by concurrent callers.
   *
   * The settings page fires status + plugin list together, and the status
   * poll runs every five seconds; without single-flight each of those ran a
   * full scan. A plugin-manager change invalidates the cache immediately, and
   * a forced scan (after an install/remove) bypasses it.
   */
  private async scanLocal(config: SyncConfig, force = false): Promise<DeviceInventory> {
    const now = Date.now()
    if (
      !force
      && this.scanCache !== null
      && this.scanCache.profile === this.deps.activeProfile
      && now - this.scanCache.at < 10_000
    ) {
      return this.scanCache.inventory
    }
    if (this.scanInFlight !== null) return this.scanInFlight
    const run = this.deps.scanner.scan({ config, profile: this.deps.activeProfile }).then(inventory => {
      this.scanCache = { at: Date.now(), profile: this.deps.activeProfile, inventory }
      return inventory
    })
    this.scanInFlight = run
    try {
      return await run
    } finally {
      if (this.scanInFlight === run) this.scanInFlight = null
    }
  }

  /** Configuration view without secrets. */
  private configView(config: SyncConfig, device: DeviceInfo): SyncConfigView {
    const tokenEnvVar = config.tokenEnvVar
    return {
      ...config,
      tokenAvailable: tokenEnvVar !== '' && (this.deps.env[tokenEnvVar] ?? '') !== '',
      device,
      activeProfile: this.deps.activeProfile,
      availableProfiles: this.deps.availableProfiles,
      dataDir: displayPath(this.deps.paths.dataDir),
    }
  }

  /** Human-readable authentication method (never the secret). */
  private authMethod(config: SyncConfig): string {
    if (config.authMode === 'https-token') {
      return config.tokenEnvVar === '' ? 'HTTPS token (environment variable not configured)' : `HTTPS token from $${config.tokenEnvVar}`
    }
    if (config.authMode === 'ssh') return 'SSH agent / key'
    return 'system Git credential helper'
  }

  /** Throw when the repository is not configured. */
  private ensureConfigured(config: SyncConfig): void {
    if (config.repoUrl.trim() === '') {
      throw new SyncError('not-configured', '尚未配置 Git 仓库地址 / no Git repository configured')
    }
  }

  /** Record a failed operation in state and logs. */
  private recordFailure(operation: OperationResult['operation'], error: unknown): void {
    const syncError = toSyncError(error)
    // A confirmation requirement is not a failure: the user simply has not
    // decided yet, and the status panel must not show an error.
    if (syncError.code === 'confirmation-required' || syncError.code === 'conflict-present') {
      this.deps.logger.info(`操作等待确认 / operation needs confirmation: ${syncError.message}`)
      return
    }
    this.lastError = syncError.message
    this.deps.logger.error(`操作失败 / operation failed: ${operation}: ${syncError.message}`)
    void this.deps.stateStore
      .read()
      .then(state => {
        state.lastError = syncError.message
        state.lastOperation = { operation, at: new Date().toISOString(), ok: false, error: syncError.message }
        return this.deps.stateStore.write(state)
      })
      .catch(() => undefined)
  }

  /** Compose a commit message. */
  private commitMessage(operation: string, userMessage: string | undefined): string {
    const subject = `[dsh-plugins-git-sync] ${operation} ${this.deps.activeProfile}`
    if (userMessage === undefined || userMessage.trim() === '') return subject
    return `${subject}: ${userMessage.trim().slice(0, 200)}`
  }
}

/** Whether an error means "the repository has no such data yet". */
function isMissingRepository(error: unknown): boolean {
  if (error instanceof SyncError) return error.code === 'repo-empty'
  const message = errorMessage(error).toLowerCase()
  return message.includes('does not exist') || message.includes('not found') || message.includes('enoent')
}
