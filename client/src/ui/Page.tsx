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
import type { ConnectionTestResult, OperationResult, StatusView, SyncPlan } from '../../../src/types'
import * as api from '../api'
import { errorText } from '../api'
import { formatDateTime, operationLabel, shortCommit } from '../format'
import type { Translate } from '../i18n'
import { CSS } from '../styles'
import { ActionsSection } from './ActionsSection'
import type { ActionName } from './ActionsSection'
import { AutoSyncSection, autoFormFromView } from './AutoSyncSection'
import type { AutoForm } from './AutoSyncSection'
import { Badge, Banner, Button, Card, LinkButton, Loading } from './controls'
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
}

/** What the open confirmation dialog will run. */
interface ConfirmState {
  kind: 'restore' | 'rollback' | 'sync'
  /** Commit for restore/rollback; absent for restore-from-head and sync. */
  commit?: string
  title: string
  description: string
  plan: SyncPlan
  snapshotPlanned: boolean
  sourceCommit: string | null
}

/** Render the whole settings page. */
export function Page({ t }: PageProps): ReactElement {
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

  const refreshStatus = useCallback(
    async (quiet: boolean) => {
      try {
        const payload = await api.getStatus()
        setStatus(payload)
        setStatusError(null)
        applyConfigView(payload.status.config)
      } catch (error) {
        setStatusError(errorText(error))
      }
    },
    [applyConfigView],
  )

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
    await Promise.all([refreshStatus(true), refreshPlugins(), refreshHistory()])
  }, [refreshStatus, refreshPlugins, refreshHistory])

  // Initial load.
  useEffect(() => {
    void refreshStatus(false)
    void refreshPlugins()
    void refreshHistory()
  }, [refreshStatus, refreshPlugins, refreshHistory])

  // Poll the status while mounted and visible.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void refreshStatus(true)
    }, STATUS_POLL_MS)
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') void refreshStatus(true)
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
      parts.push(
        t('actionOutcome', { ok: outcomes.filter(outcome => outcome.ok).length, total: outcomes.length }),
      )
    }
    if (result.warnings.length > 0) parts.push(t('actionWarnings', { count: result.warnings.length }))
    setNotice(parts.join(' · '))
  }

  function operationFailed(label: string, error: unknown): void {
    setActionError(t('actionFailed', { message: `${label}: ${errorText(error)}` }))
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
      await refreshStatus(true)
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
        intervalMinutes: autoForm.intervalMinutes,
        onStartup: autoForm.onStartup,
        onPluginChange: autoForm.onPluginChange,
        debounceMs: autoForm.debounceMs,
      })
      markAutoDirty(false)
      applyConfigView(response.status.config)
      setStatus(current => (current === null ? current : { ...current, status: response.status }))
      setNotice(t('autoSaved'))
      await refreshStatus(true)
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
      operationFailed(t('actionBackup'), error)
    } finally {
      setBusy(null)
    }
  }

  async function runDiff(): Promise<void> {
    clearMessages()
    setBusy('diff')
    setDiffLoading(true)
    try {
      setDiff(await api.getDiff({}))
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
      setModal({
        kind,
        ...(commit === undefined ? {} : { commit }),
        title:
          kind === 'rollback'
            ? t('confirmRollbackTitle', { commit: shortCommit(commit) })
            : t('confirmRestoreTitle'),
        description: kind === 'rollback' ? t('confirmRollbackDesc') : t('confirmRestoreDesc'),
        plan: preview.plan,
        snapshotPlanned: preview.snapshotPlanned,
        sourceCommit: preview.source.commit,
      })
    } catch (error) {
      const key = kind === 'rollback' ? 'rollbackPreviewFailed' : 'restorePreviewFailed'
      setActionError(t(key, { message: errorText(error) }))
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
      setModal({
        kind: 'sync',
        title: t('confirmSyncTitle'),
        description: t('confirmSyncDesc'),
        plan: preview.plan,
        snapshotPlanned: false,
        sourceCommit: null,
      })
    } catch (error) {
      setActionError(t('syncPreviewFailed', { message: errorText(error) }))
    } finally {
      setBusy(null)
    }
  }

  /** Run the previewed operation, then refresh every data source. */
  async function confirmModal(): Promise<void> {
    if (modal === null) return
    setModalBusy(true)
    clearMessages()
    setBusy(modal.kind === 'sync' ? 'sync' : 'restore')
    try {
      let result: OperationResponse
      if (modal.kind === 'sync') {
        result = await api.sync({ confirmDestructive: true })
      } else if (modal.kind === 'rollback') {
        if (modal.commit === undefined) throw new Error('rollback requires a commit')
        result = await api.rollback({ commit: modal.commit, confirmDestructive: true })
      } else {
        result = await api.restore({
          ...(modal.commit === undefined ? {} : { commit: modal.commit }),
          confirmDestructive: true,
        })
      }
      setModal(null)
      reportOperation(
        result,
        modal.kind === 'sync' ? 'actionSyncDone' : modal.kind === 'rollback' ? 'actionRollbackDone' : 'actionRestoreDone',
      )
      await refreshAll()
    } catch (error) {
      setModal(null)
      operationFailed(
        modal.kind === 'sync' ? t('actionSync') : modal.kind === 'rollback' ? t('op_rollback') : t('actionRestore'),
        error,
      )
    } finally {
      setModalBusy(false)
      setBusy(null)
    }
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
      await refreshStatus(true)
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
      <p className="dgs-intro">{t('intro')}</p>

      {notice === null ? null : <Banner tone="success">{notice}</Banner>}
      {actionError === null ? null : <Banner tone="error">{actionError}</Banner>}
      {statusError === null || view === null ? null : (
        <Banner tone="error">
          {t('statusLoadFailed', { message: statusError })}{' '}
          <LinkButton onClick={() => void refreshStatus(false)}>{t('retry')}</LinkButton>
        </Banner>
      )}

      {view === null ? (
        statusError === null ? (
          <Loading text={t('loading')} />
        ) : (
          <Card title={t('statusTitle')}>
            <Banner tone="error">{t('statusLoadFailed', { message: statusError })}</Banner>
            <div className="dgs-btnRow">
              <Button onClick={() => void refreshStatus(false)}>{t('retry')}</Button>
            </div>
          </Card>
        )
      ) : (
        <>
          <StatusSection t={t} status={view} />

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

          <ActionsSection
            t={t}
            busy={busy}
            hostBusy={hostBusy}
            enabled={configured}
            diff={diff}
            diffLoading={diffLoading}
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
          <PlanPreview t={t} plan={modal.plan} snapshotPlanned={modal.snapshotPlanned} sourceCommit={modal.sourceCommit} />
        </Modal>
      )}
    </div>
  )
}

/** Unused re-exports kept out of the bundle; types only. */
export type { OperationResult }
