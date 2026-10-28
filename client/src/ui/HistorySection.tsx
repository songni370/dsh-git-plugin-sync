/**
 * "History" card: the backup repository's commits and the one-click restore
 * of the local side to any of them.
 *
 * A row's restore goes through the same confirmation path as "restore from
 * Git" (the page previews the commit with `/restore/preview`, then runs
 * `/rollback`), so a destructive history restore is never a single click.
 * @module ui/HistorySection
 */

import type { ReactElement, ReactNode } from 'react'
import type { HistoryResponse } from '../../../src/http/api-types'
import type { Translate } from '../i18n'
import { formatDateTime, isGoodResult, operationLabel, resultLabel, shortCommit } from '../format'
import { Badge, Banner, Button, Card, LinkButton, Loading } from './controls'

/** Props for {@link HistorySection}. */
export interface HistorySectionProps {
  t: Translate
  history: HistoryResponse | null
  loading: boolean
  error: string | null
  /** Any operation that changes history is in flight. */
  busy: boolean
  onRestoreCommit: (commit: string) => void
  onRefresh: () => void
}

/** Render the history card. */
export function HistorySection(props: HistorySectionProps): ReactElement {
  const { t } = props
  const entries = props.history === null ? [] : props.history.entries
  const lastOperation = props.history === null ? null : props.history.lastOperation

  const lastOperationNode: ReactNode =
    lastOperation === null ? (
      <span className="dgs-hint">{t('notAvailable')}</span>
    ) : (
      <span className="dgs-hint">
        {t('historyLastOperation')}: {operationLabel(t, lastOperation.operation)} ·{' '}
        {resultLabel(t, lastOperation.ok ? 'ok' : 'failed')} · {formatDateTime(lastOperation.at, t('unknown'))}
      </span>
    )

  return (
    <Card
      title={t('historyTitle')}
      description={t('historyDesc')}
      trailing={
        <div className="dgs-btnRow">
          {lastOperationNode}
          <Button small onClick={props.onRefresh} disabled={props.loading}>
            {t('refresh')}
          </Button>
        </div>
      }
    >
      {props.error === null ? null : (
        <Banner tone="error">
          {t('historyLoadFailed', { message: props.error })} <LinkButton onClick={props.onRefresh}>{t('retry')}</LinkButton>
        </Banner>
      )}

      {props.loading && props.history === null ? <Loading text={t('loading')} /> : null}

      {props.history !== null && entries.length === 0 ? <p className="dgs-hint">{t('historyEmpty')}</p> : null}

      {entries.length === 0 ? null : (
        <>
          <p className="dgs-hint">{t('historyCount', { count: entries.length })}</p>
          <div className="dgs-tableWrap">
            <table className="dgs-table">
              <thead>
                <tr>
                  <th>{t('historyColCommit')}</th>
                  <th>{t('historyColTime')}</th>
                  <th>{t('historyColOperation')}</th>
                  <th>{t('historyColDevice')}</th>
                  <th>{t('historyColResult')}</th>
                  <th>{t('historyColPlugins')}</th>
                  <th aria-label={t('historyRestore')} />
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <tr key={entry.commit}>
                    <td>
                      <span className="dgs-pluginCell">
                        <span className="dgs-mono" title={entry.commit}>
                          {shortCommit(entry.commit)}
                        </span>
                        {entry.subject === '' ? null : <span className="dgs-pluginId">{entry.subject}</span>}
                      </span>
                    </td>
                    <td className="dgs-nowrap">{formatDateTime(entry.date, t('unknown'))}</td>
                    <td className="dgs-nowrap">{operationLabel(t, entry.operation)}</td>
                    <td>{entry.deviceName ?? t('unknown')}</td>
                    <td className="dgs-nowrap">
                      <Badge tone={isGoodResult(entry.result) ? 'success' : entry.result === undefined ? 'idle' : 'error'}>
                        {resultLabel(t, entry.result)}
                      </Badge>
                    </td>
                    <td className="dgs-nowrap">{entry.pluginCount === undefined ? t('notAvailable') : String(entry.pluginCount)}</td>
                    <td className="dgs-nowrap">
                      <Button
                        small
                        disabled={props.busy}
                        ariaLabel={t('historyRestoreAria', { commit: shortCommit(entry.commit) })}
                        onClick={() => {
                          props.onRestoreCommit(entry.commit)
                        }}
                      >
                        {t('historyRestore')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}
