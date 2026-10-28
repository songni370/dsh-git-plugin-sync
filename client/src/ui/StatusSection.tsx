/**
 * "Sync status" card: the device/repository state at a glance.
 *
 * The badge tone is derived from the Host's `SyncState` (never from counts
 * recomputed here), so the page and the Host cannot disagree about what
 * "ahead" means; counts are shown next to it for detail.
 * @module ui/StatusSection
 */

import type { ReactElement, ReactNode } from 'react'
import type { SyncState, StatusView } from '../../../src/types'
import type { Translate } from '../i18n'
import { formatDateTime, operationLabel, resultLabel, shortCommit } from '../format'
import { Badge, Banner, Card, KeyValue } from './controls'
import type { Tone } from './controls'

/** Copy + tone for every Host sync state. */
const STATE_META: Record<SyncState, { key: string; tone: Tone }> = {
  'not-configured': { key: 'stateNotConfigured', tone: 'idle' },
  synced: { key: 'stateSynced', tone: 'success' },
  ahead: { key: 'stateAhead', tone: 'warn' },
  behind: { key: 'stateBehind', tone: 'warn' },
  diverged: { key: 'stateDiverged', tone: 'warn' },
  conflict: { key: 'stateConflict', tone: 'error' },
  error: { key: 'stateError', tone: 'error' },
  syncing: { key: 'stateSyncing', tone: 'idle' },
  unknown: { key: 'stateUnknown', tone: 'idle' },
}

/** Props for {@link StatusSection}. */
export interface StatusSectionProps {
  t: Translate
  status: StatusView
}

/** Render the sync-status card. */
export function StatusSection(props: StatusSectionProps): ReactElement {
  const { t, status } = props
  const meta = STATE_META[status.state] ?? STATE_META.unknown
  const connection = status.connection

  const lastOperation: ReactNode =
    status.lastOperation === null
      ? t('notAvailable')
      : `${operationLabel(t, status.lastOperation.operation)} · ${resultLabel(
          t,
          status.lastOperation.ok ? 'ok' : 'failed',
        )} · ${formatDateTime(status.lastOperation.at, t('unknown'))}`

  return (
    <Card
      title={t('statusTitle')}
      description={t('statusDesc')}
      trailing={<Badge tone={meta.tone}>{t(meta.key)}</Badge>}
    >
      {status.state === 'not-configured' ? <Banner tone="idle">{t('statusNotConfiguredHint')}</Banner> : null}
      {status.busy ? <Banner tone="warn">{t('statusBusy')}</Banner> : null}

      <KeyValue
        items={[
          { label: t('statusDevice'), value: status.config.device.name },
          { label: t('statusBranch'), value: status.branch === '' ? t('notAvailable') : status.branch },
          { label: t('statusLastSync'), value: formatDateTime(status.lastSyncAt, t('never')) },
          {
            label: t('statusLastCommit'),
            value:
              status.lastCommit === null ? (
                t('notAvailable')
              ) : (
                <span className="dgs-mono" title={status.lastCommit}>
                  {shortCommit(status.lastCommit)}
                </span>
              ),
          },
          { label: t('statusLocalPlugins'), value: String(status.localPluginCount) },
          {
            label: t('statusRemotePlugins'),
            value: status.remotePluginCount === null ? t('notAvailable') : String(status.remotePluginCount),
          },
          { label: t('statusPendingUp'), value: String(status.pendingUploads) },
          { label: t('statusPendingDown'), value: String(status.pendingDownloads) },
          { label: t('statusConflicts'), value: String(status.conflictCount) },
          { label: t('statusLastOperation'), value: lastOperation },
          {
            label: t('statusConnection'),
            value:
              connection === null ? (
                t('notAvailable')
              ) : (
                <>
                  <Badge tone={connection.ok ? 'success' : 'error'}>
                    {connection.ok ? t('statusConnectionOk') : t('statusConnectionFail')}
                  </Badge>{' '}
                  <span className="dgs-muted dgs-small">{connection.message}</span>
                </>
              ),
          },
        ]}
      />

      {connection !== null ? (
        <p className="dgs-hint">{t('statusConnectionAt', { time: formatDateTime(connection.at, t('unknown')) })}</p>
      ) : null}

      {status.lastError === null ? null : (
        <Banner tone="error">
          {t('statusLastError')}: {status.lastError}
        </Banner>
      )}
    </Card>
  )
}
