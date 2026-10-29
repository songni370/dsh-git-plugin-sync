/**
 * "History" card: the backup repository's commits and the one-click restore
 * of the local side to any of them.
 *
 * Rendered as a compact activity list instead of a seven-column table: each
 * entry states the operation and result on the first line, the subject and
 * commit on the second, and the time/device/plugin count as small metadata.
 * That keeps the useful information readable at a glance even for long
 * subjects and device names.
 *
 * A row's restore goes through the same confirmation path as "restore from
 * Git" (the page previews the commit with `/restore/preview`, then runs
 * `/rollback`), so a destructive history restore is never a single click.
 * @module ui/HistorySection
 */

import type { ReactElement } from 'react'
import type { HistoryResponse } from '../../../src/http/api-types'
import type { Translate } from '../i18n'
import { formatDateTime, isGoodResult, operationLabel, resultLabel, shortCommit } from '../format'
import { Badge, Banner, Button, Card, LinkButton, Loading } from './controls'
import type { Feedback } from './controls'

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
  /** Result of a rollback, shown inside this card. */
  feedback?: Feedback
}

/** Render the history card. */
export function HistorySection(props: HistorySectionProps): ReactElement {
  const { t } = props
  const entries = props.history === null ? [] : props.history.entries
  const lastOperation = props.history === null ? null : props.history.lastOperation

  return (
    <Card
      title={t('historyTitle')}
      description={t('historyDesc')}
      trailing={
        <Button small onClick={props.onRefresh} disabled={props.loading}>
          {t('refresh')}
        </Button>
      }
    >
      {props.error === null ? null : (
        <Banner tone="error">
          {t('historyLoadFailed', { message: props.error })} <LinkButton onClick={props.onRefresh}>{t('retry')}</LinkButton>
        </Banner>
      )}

      {props.loading && props.history === null ? <Loading text={t('loading')} /> : null}

      {props.history !== null && entries.length === 0 ? <p className="dgs-hint">{t('historyEmpty')}</p> : null}

      {props.history !== null ? (
        <div className="dgs-historySummary">
          <span className="dgs-historySummaryItem">{t('historyCount', { count: entries.length })}</span>
          {lastOperation === null ? null : (
            <span className="dgs-historySummaryItem">
              {t('historyLastOperation')}: {operationLabel(t, lastOperation.operation)} ·{' '}
              {resultLabel(t, lastOperation.ok ? 'ok' : 'failed')} ·{' '}
              {formatDateTime(lastOperation.at, t('unknown'))}
            </span>
          )}
        </div>
      ) : null}

      {entries.length === 0 ? null : (
        <ul className="dgs-historyList">
          {entries.map(entry => {
            const good = isGoodResult(entry.result)
            const hasResult = entry.result !== undefined && entry.result !== null && entry.result !== ''
            const dotTone = !hasResult ? 'dgs-historyDotIdle' : good ? 'dgs-historyDotOk' : 'dgs-historyDotFail'
            return (
              <li className="dgs-historyItem" key={entry.commit}>
                <span className={`dgs-historyDot ${dotTone}`} aria-hidden="true" />
                <div className="dgs-historyMain">
                  <div className="dgs-historyTop">
                    <span className="dgs-historyOp">{operationLabel(t, entry.operation)}</span>
                    <Badge tone={good ? 'success' : hasResult ? 'error' : 'idle'}>
                      {resultLabel(t, entry.result)}
                    </Badge>
                    {entry.pluginCount === undefined ? null : (
                      <span className="dgs-historyMeta">{t('historyPluginsCount', { count: entry.pluginCount })}</span>
                    )}
                    <span className="dgs-historyMeta">{entry.deviceName ?? t('unknown')}</span>
                  </div>
                  {entry.subject === '' ? null : (
                    <span className="dgs-historySubject" title={entry.subject}>
                      {entry.subject}
                    </span>
                  )}
                  <div className="dgs-historyMetaRow">
                    <span className="dgs-mono" title={entry.commit}>
                      {shortCommit(entry.commit)}
                    </span>
                    <span>{formatDateTime(entry.date, t('unknown'))}</span>
                  </div>
                </div>
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
              </li>
            )
          })}
        </ul>
      )}

      {props.feedback === undefined ? null : <Banner tone={props.feedback.tone}>{props.feedback.text}</Banner>}
    </Card>
  )
}
