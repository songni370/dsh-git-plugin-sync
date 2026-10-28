/**
 * The settings page: data loading, polling, actions, and the confirmation
 * dialog that guards every destructive operation.
 *
 * Data flow (kept in one place so the sections stay presentational):
 *  - on mount, POST `/status`, `/plugins/list`, `/history`;
 *  - `/status` is polled every 5 s while the section is mounted AND the
 *    document is visible, and once more immediately when it becomes visible;
 *  - every operation refreshes status, plugins, and history afterwards;
 *  - errors from the Host are shown verbatim (`ApiRequestError.message`).
 *
 * Confirmation protocol (`confirmation-required` / `conflict-present`):
 * the Host never executes a destructive plan or an unresolved conflict
 * silently — it answers with an error envelope whose `details.plan` is the
 * plan that needs acknowledgement. This page always renders that plan in the
 * dialog before re-calling with `confirmDestructive: true` (and the user's
 * `resolutions` when conflicts exist), so no destructive step runs unseen.
 *
 * The component-level timer and visibility listener are removed by their
 * `useEffect` cleanup, which React runs when the settings section unmounts —
 * the same disposal guarantee a plugin-level `ctx.effect` gives the locale
 * dictionaries in `index.tsx`.
 * @module ui/Page
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type {
  DiffResponse,
  HistoryResponse,
  OperationResponse,
  PluginListResponse,
  PluginListRow,
  StatusPayload,
} from '../../../src/http/api-types'
import type {
  ConflictChoice,
  ConflictResolution,
  ConnectionTestResult,
  OperationResult,
  StatusView,
  SyncPlan,
} from '../../../src/types'
import * as api from '../api'
import { errorText, planFromError } from '../api'
import type { DiffDirection } from '../api'
import { shortCommit } from '../format'
import type { Translate } from '../i18n'
import { CSS } from '../styles'
import { ActionsSection } from './ActionsSection'
import type { ActionName } from './ActionsSection'
import { AutoSyncSection, autoFormFromView } from './AutoSyncSection'
import type { AutoForm } from './AutoSyncSection'
import { Banner, Button, Card, LinkButton, Loading } from './controls'
import { ConfigSection, configFormFromView } from './ConfigSection'
import type { ConfigForm } from './ConfigSection'
import { HistorySection } from './HistorySection'
import { Modal } from './Modal'
import { PlanPreview } from './PlanPreview'
import { PluginsSection } from './PluginsSection'
import { StatusSection } from './StatusSection'

/** Poll interval for the status endpoint, in milliseconds. */
const STATUS_POLL_MS = 5000

/** How many history entries the page requests. */
const HISTORY_LIMIT = 20

/** Props handed to the section by the slot registration. */
export interface PageProps {
  t: Translate
  /** Settings page only: switch to the Plugins page and select the backup tab. */
  openInPlugins?: () => void
}

/** Operation a confirmation dialog will execute. */
type ConfirmKind = 'backup' | 'restore' | 'rollback' | 'sync'

/** What the open confirmation dialog will run. */
interface ConfirmState {
  kind: ConfirmKind
  /** Commit for restore/rollback; absent for restore-from-head and sync. */
  commit?: string
  title: string
  description: string
  plan: SyncPlan
  snapshotPlanned: boolean
  sourceCommit: string | null
  /** Per-plugin conflict decisions; `skip` unless the user changes one. */
  resolutions: Record<string, ConflictChoice>
  /** Informational Host message (e.g. why confirmation is required). */
  hint?: string
}

/** Render the whole settings page. */
export function Page({ t, openInPlugins }: PageProps): ReactElement {
  // --- Host data ---------------------------------------------------------
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [plugins, setPlugins] = useState<PluginListResponse | null>(null)
  const [pluginsLoading, setPluginsLoading] = useState(true)
  const [pluginsError, setPluginsError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryResponse | null>(null)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)

  // --- Editable state ----------------------------------------------------
  const [form, setForm] = useState<ConfigForm | null>(null)
  const [autoForm, setAutoForm] = useState<AutoForm | null>(null)
  const [configDirty, setConfigDirty] = useState(false)
  const [autoDirty, setAutoDirty] = useState(false)
  const [filter, setFilter] = useState('')
  const [exclusions, setExclusions] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [diffDirection, setDiffDirection] = useState<DiffDirection>('two-way')

  // Refs mirror the state that async callbacks and the poll loop must read
  // WITHOUT re-creating themselves: a stale closure here would silently drop
  // the user's unsaved edits on the next poll.
  const configDirtyRef = useRef(false)
  const autoDirtyRef = useRef(false)
  const exclusionBusyRef = useRef(false)

  // --- Transient operation state ----------------------------------------
  const [busy, setBusy] = useState<ActionName | null>(null)
  const [modalBusy, setModalBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [savingAuto, setSavingAuto] = useState(false)
  const [exclusionBusy, setExclusionBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [diff, setDiff] = useState<DiffResponse | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [connection, setConnection] = useState<ConnectionTestResult | null>(null)
  const [modal, setModal] = useState<ConfirmState | null>(null)

  function markConfigDirty(dirty: boolean): void {
    configDirtyRef.current = dirty
    setConfigDirty(dirty)
  }

  function markAutoDirty(dirty: boolean): void {
    autoDirtyRef.current = dirty
    setAutoDirty(dirty)
  }

  /**
   * Adopt the Host's effective configuration into the editable forms.
   * A form the user has modified is left alone, so background polling can
   * never overwrite an in-progress edit.
   */
  const applyConfigView = useCallback((view: StatusView['config']) => {
    if (!configDirtyRef.current) setForm(configFormFromView(view))
    if (!autoDirtyRef.current) setAutoForm(autoFormFromView(view))
    if (!exclusionBusyRef.current) setExclusions(new Set(view.excludedPlugins))
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
        const payload = await api.getStatus()
        setStatus(payload)
        setStatusError(null)
        applyConfigView(payload.status.config)
      } catch (error) {
        setStatusError(errorText(error))
    }
  }, [applyConfigView])

  const refreshPlugins = useCallback(async () => {
    setPluginsLoading(true)
    try {
      const response = await api.getPlugins()
      setPlugins(response)
      setPluginsError(null)
    } catch (error) {
      setPluginsError(errorText(error))
    } finally {
      setPluginsLoading(false)
    }
  }, [])

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const response = await api.getHistory({ limit: HISTORY_LIMIT })
      setHistory(response)
      setHistoryError(null)
    } catch (error) {
      setHistoryError(errorText(error))
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshStatus(), refreshPlugins(), refreshHistory()])
  }, [refreshStatus, refreshPlugins, refreshHistory])

  // Initial load.
  useEffect(() => {
    void refreshStatus()
    void refreshPlugins()
    void refreshHistory()
  }, [refreshStatus, refreshPlugins, refreshHistory])

  // Poll the status while mounted and visible.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void refreshStatus()
    }, STATUS_POLL_MS)
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') void refreshStatus()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [refreshStatus])

  function clearMessages(): void {
    setNotice(null)
    setActionError(null)
  }

  function reportOperation(result: OperationResult, doneKey: string): void {
    if (!result.ok) {
      setActionError(result.error !== undefined && result.error !== '' ? result.error : t('stateError'))
      return
    }
    const parts: string[] = [t(doneKey)]
    if (result.noChanges === true) parts.push(t('noChanges'))
    if (result.commit !== null && result.commit !== undefined && result.commit !== '') {
      parts.push(t('actionCommit', { commit: shortCommit(result.commit) }))
      if (result.pushed === true) parts.push(t('actionPushed'))
    }
    const outcomes = result.actionOutcomes
    if (outcomes.length > 0) {
      parts.push(t('actionOutcome', { ok: outcomes.filter(outcome => outcome.ok).length, total: outcomes.length }))
    }
    if (result.warnings.length > 0) parts.push(t('actionWarnings', { count: result.warnings.length }))
    setNotice(parts.join(' · '))
  }

  function operationFailed(label: string, error: unknown): void {
    setActionError(t('actionFailed', { message: `${label}: ${errorText(error)}` }))
  }

  // --- Confirmation dialog ----------------------------------------------
  function confirmTitle(kind: ConfirmKind, commit?: string): string {
    switch (kind) {
      case 'backup':
        return t('confirmBackupTitle')
      case 'restore':
        return t('confirmRestoreTitle')
      case 'sync':
        return t('confirmSyncTitle')
      case 'rollback':
        return t('confirmRollbackTitle', { commit: shortCommit(commit) })
    }
  }

  function confirmDescription(kind: ConfirmKind): string {
    switch (kind) {
      case 'backup':
        return t('confirmBackupDesc')
      case 'restore':
        return t('confirmRestoreDesc')
      case 'sync':
        return t('confirmSyncDesc')
      case 'rollback':
        return t('confirmRollbackDesc')
    }
  }

  /** Open the dialog for a plan the Host asked us to acknowledge. */
  function openConfirm(
    kind: ConfirmKind,
    plan: SyncPlan,
    extras: { commit?: string; snapshotPlanned?: boolean; sourceCommit?: string | null; hint?: string } = {},
  ): void {
    setModal({
      kind,
      ...(extras.commit === undefined ? {} : { commit: extras.commit }),
      title: confirmTitle(kind, extras.commit),
      description: confirmDescription(kind),
      plan,
      snapshotPlanned: extras.snapshotPlanned === true,
      sourceCommit: extras.sourceCommit ?? null,
      resolutions: defaultResolutions(plan),
      ...(extras.hint === undefined ? {} : { hint: extras.hint }),
    })
  }

  /** Decide the request's resolutions from the dialog's current choices. */
  function buildResolutions(current: ConfirmState): ConflictResolution[] | undefined {
    if (current.plan.conflicts.length === 0) return undefined
    return current.plan.conflicts.map(conflict => ({
      pluginId: conflict.pluginId,
      choice: current.resolutions[conflict.pluginId] ?? 'skip',
    }))
  }

  // --- Configuration -----------------------------------------------------
  function changeConfig(patch: Partial<ConfigForm>): void {
    setForm(current => (current === null ? current : { ...current, ...patch }))
    // The reported connection result belongs to the previous values.
    setConnection(null)
    markConfigDirty(true)
  }

  async function testRepository(): Promise<void> {
    clearMessages()
    setTesting(true)
    try {
      const result = await api.testConnection(form === null ? {} : { config: form })
      setConnection(result)
      if (result.ok) setNotice(t('configConnectionOk', { message: result.message }))
      else setActionError(t('configConnectionFail', { message: result.message }))
    } catch (error) {
      operationFailed(t('configTest'), error)
    } finally {
      setTesting(false)
    }
  }

  async function saveRepository(): Promise<void> {
    if (form === null) return
    clearMessages()
    setSavingConfig(true)
    setBusy('config')
    try {
      const response = await api.saveConfig({ config: form })
      markConfigDirty(false)
      applyConfigView(response.config)
      setNotice(t('configSaved'))
      await refreshStatus()
    } catch (error) {
      operationFailed(t('save'), error)
    } finally {
      setSavingConfig(false)
      setBusy(null)
    }
  }

  async function saveAutoSync(): Promise<void> {
    if (autoForm === null) return
    clearMessages()
    setSavingAuto(true)
    setBusy('auto')
    try {
      const response = await api.saveAutoSync({
        enabled: autoForm.enabled,
        mode: autoForm.mode,
        intervalMinutes: autoForm.intervalMinutes,
        onStartup: autoForm.onStartup,
        onPluginChange: autoForm.onPluginChange,
        debounceMs: autoForm.debounceMs,
      })
      markAutoDirty(false)
      applyConfigView(response.status.config)
      setStatus(current => (current === null ? current : { ...current, status: response.status }))
      setNotice(t('autoSaved'))
      await refreshStatus()
    } catch (error) {
      operationFailed(t('autoSave'), error)
    } finally {
      setSavingAuto(false)
      setBusy(null)
    }
  }

  // --- Operations --------------------------------------------------------
  async function runBackup(): Promise<void> {
    clearMessages()
    setBusy('backup')
    try {
      const result = await api.backup({})
      reportOperation(result, 'actionBackupDone')
      await refreshAll()
    } catch (error) {
      // A backup that would remove repository content comes back as
      // `confirmation-required` with the plan; show it, then re-run on confirm.
      const plan = planFromError(error)
      if (plan === null) operationFailed(t('actionBackup'), error)
      else openConfirm('backup', plan, { hint: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  async function runDiff(): Promise<void> {
    clearMessages()
    setBusy('diff')
    setDiffLoading(true)
    try {
      setDiff(await api.getDiff({ direction: diffDirection }))
    } catch (error) {
      setActionError(t('diffLoadFailed', { message: errorText(error) }))
    } finally {
      setDiffLoading(false)
      setBusy(null)
    }
  }

  /** Preview a restore (from the head, or from one commit) and open the dialog. */
  async function previewRestore(kind: 'restore' | 'rollback', commit?: string): Promise<void> {
    clearMessages()
    setBusy('restore')
    try {
      const preview = await api.previewRestore(commit === undefined ? {} : { commit })
      openConfirm(kind, preview.plan, {
        ...(commit === undefined ? {} : { commit }),
        snapshotPlanned: preview.snapshotPlanned,
        sourceCommit: preview.source.commit,
      })
    } catch (error) {
      const plan = planFromError(error)
      if (plan !== null) {
        openConfirm(kind, plan, {
          ...(commit === undefined ? {} : { commit }),
          hint: errorText(error),
        })
      } else {
        const key = kind === 'rollback' ? 'rollbackPreviewFailed' : 'restorePreviewFailed'
        setActionError(t(key, { message: errorText(error) }))
      }
    } finally {
      setBusy(null)
    }
  }

  /** Preview a two-way sync and open the dialog. */
  async function previewSync(): Promise<void> {
    clearMessages()
    setBusy('sync')
    try {
      const preview = await api.previewSync()
      // Even a clean plan goes through the dialog: the user asked to sync, so
      // show what will happen before anything runs.
      openConfirm('sync', preview.plan)
    } catch (error) {
      const plan = planFromError(error)
      if (plan !== null) openConfirm('sync', plan, { hint: errorText(error) })
      else setActionError(t('syncPreviewFailed', { message: errorText(error) }))
    } finally {
      setBusy(null)
    }
  }

  /** Run the previewed operation, then refresh every data source. */
  async function confirmModal(): Promise<void> {
    if (modal === null) return
    const current = modal
    setModalBusy(true)
    clearMessages()
    setBusy(current.kind)
    try {
      const resolutions = buildResolutions(current)
      const resolutionBody = resolutions === undefined ? {} : { resolutions }
      let result: OperationResponse
      switch (current.kind) {
        case 'backup':
          result = await api.backup({ confirmDestructive: true })
          break
        case 'sync':
          result = await api.sync({ confirmDestructive: true, ...resolutionBody })
          break
        case 'rollback':
          if (current.commit === undefined) throw new Error('rollback requires a commit')
          result = await api.rollback({ commit: current.commit, confirmDestructive: true, ...resolutionBody })
          break
        case 'restore':
          result = await api.restore({
            ...(current.commit === undefined ? {} : { commit: current.commit }),
            confirmDestructive: true,
            ...resolutionBody,
          })
          break
      }
      setModal(null)
      reportOperation(
        result,
        current.kind === 'backup'
          ? 'actionBackupDone'
          : current.kind === 'sync'
            ? 'actionSyncDone'
            : current.kind === 'rollback'
              ? 'actionRollbackDone'
              : 'actionRestoreDone',
      )
      await refreshAll()
    } catch (error) {
      // The plan changed underneath the dialog (a race with another device, or
      // conflicts the preview missed). Keep the dialog open with the fresh plan
      // so the user decides on what is actually about to happen.
      const plan = planFromError(error)
      if (plan === null) {
        setModal(null)
        operationFailed(
          current.kind === 'backup'
            ? t('actionBackup')
            : current.kind === 'sync'
              ? t('actionSync')
              : current.kind === 'rollback'
                ? t('op_rollback')
                : t('actionRestore'),
          error,
        )
      } else {
        setModal(previous =>
          previous === null
            ? previous
            : {
                ...previous,
                plan,
                resolutions: mergeResolutions(previous.resolutions, plan),
                hint: errorText(error),
              },
        )
      }
    } finally {
      setModalBusy(false)
      setBusy(null)
    }
  }

  function setResolution(pluginId: string, choice: ConflictChoice): void {
    setModal(current =>
      current === null ? current : { ...current, resolutions: { ...current.resolutions, [pluginId]: choice } },
    )
  }

  // --- Plugin exclusions -------------------------------------------------
  async function toggleExclusion(row: PluginListRow, next: boolean): Promise<void> {
    if (exclusionBusyRef.current) return
    const previous = new Set(exclusions)
    const updated = new Set(previous)
    if (next) updated.delete(row.id)
    else updated.add(row.id)

    exclusionBusyRef.current = true
    setExclusionBusy(true)
    setExclusions(updated)
    clearMessages()
    try {
      const response = await api.saveConfig({ config: { excludedPlugins: [...updated] } })
      setExclusions(new Set(response.config.excludedPlugins))
      setNotice(t('pluginsExclusionSaved'))
      await refreshPlugins()
      await refreshStatus()
    } catch (error) {
      setExclusions(previous)
      setActionError(t('pluginsExclusionFailed', { message: errorText(error) }))
    } finally {
      exclusionBusyRef.current = false
      setExclusionBusy(false)
    }
  }

  // --- Render ------------------------------------------------------------
  const view = status === null ? null : status.status
  const configured = view !== null && view.state !== 'not-configured' && view.config.repoUrl !== ''
  const hostBusy = view !== null && view.busy
  const anyBusy = busy !== null || exclusionBusy

  return (
    <div className="dgs-root">
      <style>{CSS}</style>
      <div className="dgs-pageHeader">
        <p className="dgs-intro">{t('intro')}</p>
        {openInPlugins === undefined ? null : (
          <Button onClick={openInPlugins}>{t('openInPlugins')}</Button>
        )}
      </div>

      {notice === null ? null : <Banner tone="success">{notice}</Banner>}
      {actionError === null ? null : <Banner tone="error">{actionError}</Banner>}
      {statusError === null || view === null ? null : (
        <Banner tone="error">
          {t('statusLoadFailed', { message: statusError })}{' '}
          <LinkButton onClick={() => void refreshStatus()}>{t('retry')}</LinkButton>
        </Banner>
      )}

      {view === null ? (
        statusError === null ? (
          <Loading text={t('loading')} />
        ) : (
          <Card title={t('statusTitle')}>
            <Banner tone="error">{t('statusLoadFailed', { message: statusError })}</Banner>
            <div className="dgs-btnRow">
              <Button onClick={() => void refreshStatus()}>{t('retry')}</Button>
            </div>
          </Card>
        )
      ) : (
        <>
          {form === null ? null : (
            <ConfigSection
              t={t}
              form={form}
              view={view.config}
              dirty={configDirty}
              saving={savingConfig}
              testing={testing}
              connection={connection}
              onChange={changeConfig}
              onTest={() => void testRepository()}
              onSave={() => void saveRepository()}
            />
          )}

          <StatusSection t={t} status={view} />

          <ActionsSection
            t={t}
            busy={busy}
            hostBusy={hostBusy}
            enabled={configured}
            diff={diff}
            diffLoading={diffLoading}
            diffDirection={diffDirection}
            onDiffDirectionChange={setDiffDirection}
            onBackup={() => void runBackup()}
            onRestore={() => void previewRestore('restore')}
            onSync={() => void previewSync()}
            onDiff={() => void runDiff()}
            onClearDiff={() => {
              setDiff(null)
            }}
          />

          <PluginsSection
            t={t}
            plugins={plugins}
            loading={pluginsLoading}
            error={pluginsError}
            filter={filter}
            exclusions={exclusions}
            busy={anyBusy}
            onFilterChange={setFilter}
            onToggle={(row, next) => void toggleExclusion(row, next)}
            onRefresh={() => void refreshPlugins()}
          />

          {autoForm === null ? null : (
            <AutoSyncSection
              t={t}
              form={autoForm}
              dirty={autoDirty}
              saving={savingAuto}
              onChange={patch => {
                setAutoForm(current => (current === null ? current : { ...current, ...patch }))
                markAutoDirty(true)
              }}
              onSave={() => void saveAutoSync()}
            />
          )}

          <HistorySection
            t={t}
            history={history}
            loading={historyLoading}
            error={historyError}
            busy={anyBusy}
            onRestoreCommit={commit => void previewRestore('rollback', commit)}
            onRefresh={() => void refreshHistory()}
          />
        </>
      )}

      {modal === null ? null : (
        <Modal
          t={t}
          title={modal.title}
          description={modal.description}
          confirmLabel={t('confirmRun')}
          busy={modalBusy}
          onConfirm={() => void confirmModal()}
          onClose={() => {
            if (!modalBusy) setModal(null)
          }}
        >
          {modal.hint === undefined || modal.hint === '' ? null : <Banner tone="warn">{modal.hint}</Banner>}
          <PlanPreview
            t={t}
            plan={modal.plan}
            snapshotPlanned={modal.snapshotPlanned}
            sourceCommit={modal.sourceCommit}
            resolutions={modal.resolutions}
            onResolutionChange={setResolution}
          />
        </Modal>
      )}
    </div>
  )
}

/** Every conflict starts at `skip` — the user must choose deliberately. */
function defaultResolutions(plan: SyncPlan): Record<string, ConflictChoice> {
  const resolutions: Record<string, ConflictChoice> = {}
  for (const conflict of plan.conflicts) resolutions[conflict.pluginId] = 'skip'
  return resolutions
}

/** Keep choices the user already made; new conflicts start at `skip`. */
function mergeResolutions(
  previous: Record<string, ConflictChoice>,
  plan: SyncPlan,
): Record<string, ConflictChoice> {
  const resolutions: Record<string, ConflictChoice> = {}
  for (const conflict of plan.conflicts) resolutions[conflict.pluginId] = previous[conflict.pluginId] ?? 'skip'
  return resolutions
}
