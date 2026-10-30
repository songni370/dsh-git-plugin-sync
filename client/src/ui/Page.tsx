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
  OperationResult,
  StatusView,
  SyncPlan,
} from '../../../src/types'
import * as api from '../api'
import { errorText, planFromError } from '../api'
import { shortCommit } from '../format'
import {
  pluginsTabEnabled,
  setPluginsTabEnabled,
  subscribePluginsTab,
} from '../plugins-tab-visibility'
import { authForTransport, detectRepoTransport } from '../repo-transport'
import type { Translate } from '../i18n'
import { CSS } from '../styles'
import { ActionsSection } from './ActionsSection'
import type { ActionName } from './ActionsSection'
import { AutoSyncSection, autoFormFromView } from './AutoSyncSection'
import type { AutoForm } from './AutoSyncSection'
import { Banner, Button, Card, LinkButton, Loading, Switch } from './controls'
import type { Feedback } from './controls'
import { ConfigSection, configFormFromView } from './ConfigSection'
import type { ConfigForm } from './ConfigSection'
import { HistorySection } from './HistorySection'
import { Modal } from './Modal'
import { PlanPreview } from './PlanPreview'
import { PluginsSection } from './PluginsSection'
import { StatusSection } from './StatusSection'
import { ToastStack } from './ToastStack'

/** Poll interval for the status endpoint, in milliseconds. */
const STATUS_POLL_MS = 5000

/** How many history entries the page requests. */
const HISTORY_LIMIT = 20

/** Props handed to the section by the slot registration. */
export interface PageProps {
  t: Translate
}

/** Operation a confirmation dialog will execute. */
type ConfirmKind = 'backup' | 'restore' | 'rollback' | 'sync'

/** Which settings section a transient result belongs under. */
type FeedbackArea = 'config' | 'auto' | 'actions' | 'plugins' | 'history'

/** How long a success/error message stays on screen. */
const FEEDBACK_TTL_MS = 5_000

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
  const [pluginsTab, setPluginsTab] = useState<boolean>(pluginsTabEnabled)
  /** null until the first status arrives: configured -> collapsed, empty -> open. */
  const [configOpen, setConfigOpen] = useState<boolean | null>(null)
  const [form, setForm] = useState<ConfigForm | null>(null)
  const [autoForm, setAutoForm] = useState<AutoForm | null>(null)
  const [configDirty, setConfigDirty] = useState(false)
  const [autoDirty, setAutoDirty] = useState(false)
  const [filter, setFilter] = useState('')
  const [exclusions, setExclusions] = useState<ReadonlySet<string>>(() => new Set<string>())

  useEffect(() => subscribePluginsTab(() => setPluginsTab(pluginsTabEnabled())), [])

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
  const [feedback, setFeedback] = useState<Record<FeedbackArea, Feedback | null>>({
    config: null,
    auto: null,
    actions: null,
    plugins: null,
    history: null,
  })
  const feedbackTimers = useRef<Record<FeedbackArea, number | null>>({
    config: null,
    auto: null,
    actions: null,
    plugins: null,
    history: null,
  })
  const [diff, setDiff] = useState<DiffResponse | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
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
    // A configured machine opens on the collapsed summary; a fresh install
    // starts expanded so the first setup is one glance away.
    setConfigOpen(current => current ?? view.repoUrl.trim() === '')
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

  function clearFeedbackTimer(area: FeedbackArea): void {
    const timer = feedbackTimers.current[area]
    if (timer !== null) {
      window.clearTimeout(timer)
      feedbackTimers.current[area] = null
    }
  }

  function showFeedback(area: FeedbackArea, tone: Feedback['tone'], text: string): void {
    clearFeedbackTimer(area)
    setFeedback(current => ({ ...current, [area]: { tone, text } }))
    feedbackTimers.current[area] = window.setTimeout(() => {
      feedbackTimers.current[area] = null
      setFeedback(current => ({ ...current, [area]: null }))
    }, FEEDBACK_TTL_MS)
  }

  function clearMessages(): void {
    for (const area of Object.keys(feedbackTimers.current) as FeedbackArea[]) clearFeedbackTimer(area)
    setFeedback({ config: null, auto: null, actions: null, plugins: null, history: null })
  }

  /** Close one floating toast without waiting for its five-second timer. */
  function dismissFeedback(area: FeedbackArea): void {
    clearFeedbackTimer(area)
    setFeedback(current => ({ ...current, [area]: null }))
  }

  // Never leave a timeout writing state after the page unmounts.
  useEffect(() => {
    return () => {
      for (const area of Object.keys(feedbackTimers.current) as FeedbackArea[]) clearFeedbackTimer(area)
    }
  }, [])

  function reportOperation(result: OperationResult, doneKey: string, area: FeedbackArea): void {
    if (!result.ok) {
      showFeedback(area, 'error', result.error !== undefined && result.error !== '' ? result.error : t('stateError'))
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
    showFeedback(area, 'success', parts.join(' · '))
  }

  function operationFailed(label: string, error: unknown, area: FeedbackArea = 'actions'): void {
    showFeedback(area, 'error', t('actionFailed', { message: `${label}: ${errorText(error)}` }))
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
    const conflicts = plan.conflicts.length
    setModal({
      kind,
      ...(extras.commit === undefined ? {} : { commit: extras.commit }),
      title: conflicts === 0 ? confirmTitle(kind, extras.commit) : t('confirmConflictTitle', { count: conflicts }),
      description: conflicts === 0 ? confirmDescription(kind) : t('confirmConflictDesc'),
      plan,
      snapshotPlanned: extras.snapshotPlanned === true,
      sourceCommit: extras.sourceCommit ?? null,
      resolutions: defaultResolutions(plan),
      // The Host's raw `conflict-present` error is not useful above a list of
      // conflicts; keep it only for non-conflict confirmations.
      ...(extras.hint === undefined || conflicts > 0 ? {} : { hint: extras.hint }),
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
    setForm(current => {
      if (current === null) return current
      const next = { ...current, ...patch }
      // Editing the repository URL re-derives the authentication mode that
      // fits the transport (SSH URL → SSH; HTTPS URL → helper/token). The
      // form then shows only the fields that apply.
      if (patch.repoUrl !== undefined) next.authMode = authForTransport(detectRepoTransport(patch.repoUrl), next.authMode)
      return next
    })
    markConfigDirty(true)
  }

  async function testRepository(): Promise<void> {
    clearMessages()
    setTesting(true)
    try {
      const result = await api.testConnection(form === null ? {} : { config: form })
      showFeedback(
        'config',
        result.ok ? 'success' : 'error',
        result.ok
          ? t('configConnectionOk', { message: result.message })
          : t('configConnectionFail', { message: result.message }),
      )
    } catch (error) {
      operationFailed(t('configTest'), error, 'config')
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
      // Saved successfully: a configured machine shows the collapsed summary.
      setConfigOpen(response.config.repoUrl.trim() === '')
      showFeedback('config', 'success', t('configSaved'))
      await refreshStatus()
    } catch (error) {
      operationFailed(t('save'), error, 'config')
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
        startupDelayMs: autoForm.startupDelayMs,
        onStartup: autoForm.onStartup,
        onPluginChange: autoForm.onPluginChange,
        debounceMs: autoForm.debounceMs,
      })
      markAutoDirty(false)
      applyConfigView(response.status.config)
      setStatus(current => (current === null ? current : { ...current, status: response.status }))
      showFeedback('auto', 'success', t('autoSaved'))
      await refreshStatus()
    } catch (error) {
      operationFailed(t('autoSave'), error, 'auto')
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
      reportOperation(result, 'actionBackupDone', 'actions')
      await refreshAll()
    } catch (error) {
      // A backup that would remove repository content comes back as
      // `confirmation-required` with the plan; show it, then re-run on confirm.
      const plan = planFromError(error)
      if (plan === null) operationFailed(t('actionBackup'), error, 'actions')
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
      setDiff(await api.getDiff({ direction: 'two-way' }))
    } catch (error) {
      showFeedback('actions', 'error', t('diffLoadFailed', { message: errorText(error) }))
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
        showFeedback(kind === 'rollback' ? 'history' : 'actions', 'error', t(key, { message: errorText(error) }))
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
      const plan = preview.plan
      // A clean sync needs no second confirmation: only conflicts or steps that
      // delete/overwrite content are worth interrupting the user for.
      const needsDecision =
        plan.conflicts.length > 0 ||
        plan.requiresConfirmation ||
        plan.actions.some(action => action.destructive)
      if (!needsDecision) {
        const result = await api.sync({ confirmDestructive: false })
        reportOperation(result, 'actionSyncDone', 'actions')
        await refreshAll()
        return
      }
      openConfirm('sync', plan)
    } catch (error) {
      const plan = planFromError(error)
      if (plan !== null) openConfirm('sync', plan, { hint: errorText(error) })
      else showFeedback('actions', 'error', t('syncPreviewFailed', { message: errorText(error) }))
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
    const reportArea: FeedbackArea = current.kind === 'rollback' ? 'history' : 'actions'
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
        reportArea,
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
          reportArea,
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
      showFeedback('plugins', 'success', t('pluginsExclusionSaved'))
      await refreshPlugins()
      await refreshStatus()
    } catch (error) {
      setExclusions(previous)
      showFeedback('plugins', 'error', t('pluginsExclusionFailed', { message: errorText(error) }))
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
          <Card title={t('tabVisibilityTitle')}>
            <Switch
              label={t('tabVisibilityLabel')}
              hint={t('tabVisibilityHint')}
              checked={pluginsTab}
              onChange={setPluginsTabEnabled}
            />
          </Card>

          {form === null ? null : (
            <ConfigSection
              t={t}
              form={form}
              view={view.config}
              dirty={configDirty}
              saving={savingConfig}
              testing={testing}
              open={configOpen ?? true}
              onToggle={() => setConfigOpen(current => !(current ?? true))}
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
            statusPanel={<StatusSection t={t} status={view} embedded />}
            notices={
              <>
                {view.state === 'not-configured' ? (
                  <Banner tone="idle">{t('statusNotConfiguredHint')}</Banner>
                ) : null}
                {view.busy ? <Banner tone="warn">{t('statusBusy')}</Banner> : null}
              </>
            }
            autoPanel={
              autoForm === null ? undefined : (
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
              )
            }
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
          confirmLabel={modal.plan.conflicts.length > 0 ? t('confirmConflictRun') : t('confirmRun')}
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

      {modal === null ? (
        <ToastStack
          t={t}
          items={(Object.keys(feedback) as FeedbackArea[]).flatMap(area => {
            const item = feedback[area]
            return item === null ? [] : [{ key: area, tone: item.tone, text: item.text }]
          })}
          onDismiss={key => dismissFeedback(key as FeedbackArea)}
        />
      ) : null}
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
