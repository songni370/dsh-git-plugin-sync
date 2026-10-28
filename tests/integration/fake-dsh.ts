/**
 * Integration-test fixture: two simulated DSH devices sharing one local bare
 * Git repository.
 *
 * Each device has its own temporary DSH home, profile package.json, fake
 * plugin-manager and config-editor services, and one real `SyncEngine` wired to
 * the real scanner, installer, config gateway, Git runner and repository store.
 * Only the Host services are simulated; the code under test is production code.
 */

import { execFileSync } from 'node:child_process'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createInstaller } from '../../src/adapters/installer.js'
import { createGitRunner } from '../../src/git/git-runner.js'
import { createRepoStore } from '../../src/git/repo-store.js'
import { createLogger, type FileSyncLogger } from '../../src/core/logger.js'
import { createScanner } from '../../src/scanner/inventory.js'
import { createConfigGateway } from '../../src/scanner/config-gateway.js'
import { createEngine, SyncEngine } from '../../src/services/engine.js'
import {
  ConfigStore,
  StateStore,
  createDeviceInfo,
  defaultState,
  normalizeConfig,
  resolveStorePaths,
  type StorePaths,
} from '../../src/state/store.js'
import type {
  DshBundleInfo,
  DshChangeResult,
  DshConfigEditor,
  DshLoaderEntry,
  DshPluginInfo,
  DshPluginManager,
  DshPluginSpecInspection,
} from '../../src/dsh.js'
import type { DeviceInfo, JsonObject, JsonValue, SyncConfig } from '../../src/types.js'

/** One installed plugin in a fake device. */
export interface FakePlugin {
  name: string
  version: string
  enabled: boolean
  /** Install source spec; defaults to `name@version`. */
  spec?: string
  /** Source label reported by the plugin manager (e.g. a file: spec). */
  source?: string
  configs: JsonObject
  builtIn?: boolean
}

/** A simulated device with real scanner/engine but fake Host services. */
export interface FakeDevice {
  name: string
  root: string
  profile: string
  profilesRoot: string
  plugins: Map<string, FakePlugin>
  engine: SyncEngine
  logger: FileSyncLogger
  configStore: ConfigStore
  stateStore: StateStore
  paths: StorePaths
  device: DeviceInfo
  manager: FakePluginManager
  configEditor: FakeConfigEditor
  /** Replace the whole configuration and rebuild the engine's scheduler view. */
  saveConfig(patch: Partial<SyncConfig>): Promise<void>
  /** Install a plugin directly, as `dsh plugin add` would. */
  addPlugin(plugin: FakePlugin): void
  /** Remove a plugin directly. */
  removePlugin(name: string): void
  /** Read a plugin, or undefined. */
  plugin(name: string): FakePlugin | undefined
  /** Scan the device through the real scanner. */
  scan(): Promise<import('../../src/types.js').DeviceInventory>
}

/** In-memory plugin manager implementing the Host service contract. */
export class FakePluginManager implements DshPluginManager {
  constructor(private readonly device: FakeDevice) {}

  private plugin(name: string): FakePlugin | undefined {
    return this.device.plugins.get(name)
  }

  async listPlugins(): Promise<DshPluginInfo[]> {
    return [...this.device.plugins.values()].map(plugin => ({
      entryId: `entry:${plugin.name}`,
      moduleName: plugin.name,
      enabled: plugin.enabled,
      fiberPhase: 'active',
      patchId: plugin.name,
    }))
  }

  async listBundles(): Promise<DshBundleInfo[]> {
    return [...this.device.plugins.values()].map(plugin => ({
      name: plugin.name,
      official: plugin.builtIn === true,
      availability: plugin.builtIn === true ? 'installation' : 'profile',
      installTarget: plugin.builtIn === true
        ? undefined
        : { spec: plugin.spec ?? `${plugin.name}@${plugin.version}`, version: plugin.version },
      version: plugin.version,
      source: plugin.source,
      enabled: plugin.enabled,
      installed: true,
      optional: false,
      removable: plugin.builtIn !== true,
      rows: [{ rowId: plugin.name, moduleName: plugin.name, entryId: `entry:${plugin.name}` }],
      overrides: [],
    }))
  }

  async inspect(spec: string): Promise<DshPluginSpecInspection> {
    const parsed = parseNpmSpec(spec)
    if (parsed === null) return { status: 'refused', problem: 'invalid-spec', reason: 'not an npm spec' }
    return { status: 'accepted', kind: 'registry', name: parsed.name, version: parsed.version, bundle: true }
  }

  async installBundle(spec: string, options?: { enabled?: boolean }): Promise<DshChangeResult> {
    const parsed = parseNpmSpec(spec)
    if (parsed === null) {
      return { changed: false, application: 'failed', stage: 'install', target: spec, error: { code: 'invalid-spec' } }
    }
    const existing = this.plugin(parsed.name)
    this.device.plugins.set(parsed.name, {
      name: parsed.name,
      version: parsed.version,
      enabled: options?.enabled !== false,
      configs: existing?.configs ?? {},
    })
    return { changed: true, application: 'applied', stage: 'install', target: spec, version: parsed.version, enabled: true }
  }

  async removeBundle(name: string): Promise<DshChangeResult> {
    const existed = this.device.plugins.delete(name)
    return { changed: existed, application: 'applied', stage: 'remove', target: name }
  }

  async setBundleEnabled(name: string, enabled: boolean): Promise<DshChangeResult> {
    const plugin = this.plugin(name)
    if (plugin === undefined) {
      return { changed: false, application: 'failed', stage: 'enable', target: name, error: { code: 'unknown-plugin' } }
    }
    plugin.enabled = enabled
    return { changed: true, application: 'applied', stage: 'enable', target: name, enabled }
  }

  async setPluginEnabled(id: string, enabled: boolean): Promise<DshChangeResult> {
    const name = id.replace(/^entry:/, '')
    const plugin = this.plugin(name)
    if (plugin === undefined) {
      return { changed: false, application: 'failed', stage: 'enable', target: id, error: { code: 'unknown-plugin' } }
    }
    plugin.enabled = enabled
    return { changed: true, application: 'applied', stage: 'enable', target: id, enabled }
  }
}

/** In-memory config editor implementing the Host service contract. */
export class FakeConfigEditor implements DshConfigEditor {
  constructor(private readonly device: FakeDevice) {}

  entries(): DshLoaderEntry[] {
    return [...this.device.plugins.values()].map(plugin => ({
      id: `entry:${plugin.name}`,
      name: plugin.name,
      patchId: plugin.name,
      config: plugin.configs,
    }))
  }

  configuration(): Array<{ entry: DshLoaderEntry; inherited: Record<string, unknown>; override: Record<string, unknown> }> {
    return this.entries().map(entry => ({ entry, inherited: {}, override: { ...(entry.config ?? {}) } }))
  }

  async edit(
    entry: DshLoaderEntry,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void> {
    const name = entry.name ?? entry.id.replace(/^entry:/, '')
    const plugin = this.device.plugins.get(name)
    if (plugin === undefined) throw new Error(`unknown plugin ${name}`)
    const next = change({ ...plugin.configs }, {})
    plugin.configs = next as JsonObject
    // Keep the entry's visible config in step.
    entry.config = next
  }
}

/** Parse `name@version` (scoped names supported). */
export function parseNpmSpec(spec: string): { name: string; version: string } | null {
  const index = spec.lastIndexOf('@')
  if (index <= 0) return null
  const name = spec.slice(0, index)
  const version = spec.slice(index + 1)
  if (name === '' || version === '') return null
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)) return null
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) return null
  return { name, version }
}

/** Create a temporary bare Git repository and return its path. */
export function createBareRepo(root: string, name = 'backup.git'): string {
  const path = join(root, name)
  execFileSync('git', ['init', '--bare', '-q', path], { stdio: 'pipe' })
  return path
}

/** Read one file from the bare repository's default branch. */
export function readRepoFile(bareRepo: string, filePath: string, branch = 'main'): string {
  return execFileSync('git', ['--git-dir', bareRepo, 'show', `${branch}:${filePath}`], { encoding: 'utf8' })
}

/** List files tracked by the bare repository. */
export function listRepoFiles(bareRepo: string, branch = 'main'): string[] {
  const output = execFileSync('git', ['--git-dir', bareRepo, 'ls-tree', '-r', '--name-only', branch], { encoding: 'utf8' })
  return output.split('\n').filter(line => line.trim() !== '')
}

/** Latest commit hash of the bare repository branch. */
export function repoHead(bareRepo: string, branch = 'main'): string {
  return execFileSync('git', ['--git-dir', bareRepo, 'rev-parse', branch], { encoding: 'utf8' }).trim()
}

/** Number of commits on the bare repository branch. */
export function repoCommitCount(bareRepo: string, branch = 'main'): number {
  const output = execFileSync('git', ['--git-dir', bareRepo, 'rev-list', '--count', branch], { encoding: 'utf8' })
  return Number(output.trim())
}

/** Create one simulated device. */
export async function createFakeDevice(options: {
  root: string
  name: string
  repoUrl: string
  branch?: string
  platform?: string
}): Promise<FakeDevice> {
  const profile = 'desktop'
  const home = join(options.root, options.name)
  const profilesRoot = join(home, 'profiles')
  const profileDir = join(profilesRoot, profile)
  await mkdir(profileDir, { recursive: true })
  await writeFile(
    join(profileDir, 'package.json'),
    `${JSON.stringify({ name: `dsh-profile-${profile}`, private: true, dependencies: {} }, null, 2)}\n`,
    'utf8',
  )

  const plugins = new Map<string, FakePlugin>()
  const paths = resolveStorePaths(home)
  const logger = createLogger({ filePath: join(home, 'logs', 'sync.log') })

  const device: FakeDevice = {
    name: options.name,
    root: home,
    profile,
    profilesRoot,
    plugins,
    engine: undefined as unknown as SyncEngine,
    logger,
    configStore: undefined as unknown as ConfigStore,
    stateStore: undefined as unknown as StateStore,
    paths,
    device: createDeviceInfo({
      existing: null,
      name: options.name,
      dshVersion: '0.2.1-test',
      pluginVersion: '0.1.0',
    }),
    manager: undefined as unknown as FakePluginManager,
    configEditor: undefined as unknown as FakeConfigEditor,
    async saveConfig(patch) {
      const current = await this.configStore.read()
      await this.configStore.write({ ...current, ...patch, autoSync: { ...current.autoSync, ...(patch.autoSync ?? {}) } })
    },
    addPlugin(plugin) {
      plugins.set(plugin.name, plugin)
    },
    removePlugin(name) {
      plugins.delete(name)
    },
    plugin(name) {
      return plugins.get(name)
    },
    async scan() {
      const config = await this.configStore.read()
      return scanner.scan({ config, profile })
    },
  }
  device.manager = new FakePluginManager(device)
  device.configEditor = new FakeConfigEditor(device)

  const activeProfile = profile
  const availableProfiles = [profile]
  const configStore = new ConfigStore(paths.configPath, input => normalizeConfig(input, activeProfile, availableProfiles))
  const stateStore = new StateStore(paths.statePath, () => defaultState(device.device))
  device.configStore = configStore
  device.stateStore = stateStore
  const initialConfig = await configStore.read()
  await configStore.write({
    ...initialConfig,
    repoUrl: options.repoUrl,
    branch: options.branch ?? 'main',
    deviceName: options.name,
  })

  const scanner = createScanner({
    services: {
      pluginManager: device.manager,
      configEditor: device.configEditor,
      settings: undefined,
    },
    profilesRoot,
    pluginVersion: '0.1.0',
    dshVersion: '0.2.1-test',
    logger,
    device: device.device,
  })
  const configGateway = createConfigGateway({
    services: { configEditor: device.configEditor },
    logger,
  })
  const installer = createInstaller({ pluginManager: device.manager, activeProfile, logger })
  const createRepo = (config: SyncConfig) => {
    const workDir = join(paths.workDir, `repo-${options.name}-${config.branch}`)
    const run = createGitRunner({ logger })
    const store = createRepoStore({
      run,
      workDir,
      repoUrl: config.repoUrl,
      branch: config.branch,
      backupDir: config.backupDir,
      logger,
    })
    return { store, workDir }
  }
  device.engine = createEngine({
    logger,
    configStore,
    stateStore,
    paths,
    scanner,
    configGateway,
    installer,
    pluginVersion: '0.1.0',
    dshVersion: '0.2.1-test',
    activeProfile,
    availableProfiles,
    platform: options.platform ?? process.platform,
    env: process.env,
    createRepo,
  })

  // Persist the device identity so both devices have stable, distinct ids.
  const state = await stateStore.read()
  state.device = device.device
  await stateStore.write(state)
  return device
}

/** Create a local development plugin directory and link it into a profile. */
export async function createLinkedLocalPlugin(options: {
  device: FakeDevice
  name: string
  version: string
}): Promise<{ name: string; path: string }> {
  const pluginDir = join(options.device.root, 'dev', options.name)
  await mkdir(pluginDir, { recursive: true })
  await writeFile(
    join(pluginDir, 'package.json'),
    `${JSON.stringify({ name: options.name, version: options.version, main: 'index.js' }, null, 2)}\n`,
    'utf8',
  )
  await writeFile(join(pluginDir, 'index.js'), 'export function apply() {}\n', 'utf8')
  const nodeModules = join(options.device.root, 'profiles', options.device.profile, 'node_modules')
  await mkdir(nodeModules, { recursive: true })
  const link = join(nodeModules, options.name)
  await symlink(pluginDir, link, process.platform === 'win32' ? 'junction' : 'dir')
  // Add the dependency to the profile manifest.
  const manifestPath = join(options.device.root, 'profiles', options.device.profile, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { dependencies?: Record<string, string> }
  manifest.dependencies = { ...(manifest.dependencies ?? {}), [options.name]: `file:${pluginDir}` }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return { name: options.name, path: pluginDir }
}

/** Read a JSON file from a fake device's data directory. */
export async function readDeviceJson<T>(device: FakeDevice, relativePath: string): Promise<T> {
  const text = await readFile(join(device.paths.dataDir, relativePath), 'utf8')
  return JSON.parse(text) as T
}

/** Ensure an empty file exists (helper for malformed-manifest tests). */
export async function writeRepoFileDirect(bareRepo: string, file: string, content: string, branch = 'main'): Promise<void> {
  const work = resolve(dirname(bareRepo), `mutate-${Math.random().toString(36).slice(2, 8)}`)
  try {
    execFileSync('git', ['clone', '-q', '--branch', branch, bareRepo, work], { stdio: 'pipe' })
  } catch {
    execFileSync('git', ['clone', '-q', bareRepo, work], { stdio: 'pipe' })
    execFileSync('git', ['-C', work, 'checkout', '-B', branch], { stdio: 'pipe' })
  }
  execFileSync('git', ['-C', work, 'config', 'user.email', 'test@example.com'], { stdio: 'pipe' })
  execFileSync('git', ['-C', work, 'config', 'user.name', 'Test'], { stdio: 'pipe' })
  await writeFile(join(work, file), content, 'utf8')
  execFileSync('git', ['-C', work, 'add', '-A'], { stdio: 'pipe' })
  execFileSync('git', ['-C', work, 'commit', '-q', '-m', 'test: mutate repository'], { stdio: 'pipe' })
  execFileSync('git', ['-C', work, 'push', '-q', 'origin', `HEAD:${branch}`], { stdio: 'pipe' })
}

/** Supported JSON value helper for tests. */
export type { JsonValue }
