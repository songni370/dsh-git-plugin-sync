/**
 * "Operations" card: the four manual actions and the read-only difference
 * preview.
 *
 * The three content-changing actions are delegated to the page, which opens
 * the confirmation dialog for them. Only "check differences" renders its
 * result here — it never modifies anything, so it needs no dialog.
 * @module ui/ActionsSection
 */

import { useEffect, useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { DiffResponse } from '../../../src/http/api-types'
import type { Translate } from '../i18n'
import { Button, Card, LinkButton, Loading } from './controls'
import { PlanPreview } from './PlanPreview'

/** Action names used for the busy indicator and disabled set. */
export type ActionName = 'backup' | 'restore' | 'rollback' | 'sync' | 'diff' | 'config' | 'auto' | 'exclusion'

/** Props for {@link ActionsSection}. */
export interface ActionsSectionProps {
  t: Translate
  /** Which operation is running, if any. */
  busy: ActionName | null
  /** The Host reports an operation in flight (status.busy). */
  hostBusy: boolean
  /** Actions need a saved repository URL. */
  enabled: boolean
  diff: DiffResponse | null
  diffLoading: boolean
  onBackup: () => void
  onRestore: () => void
  onSync: () => void
  onDiff: () => void
  onClearDiff: () => void
  /** Automatic-sync panel, merged into this card below the manual actions. */
  autoPanel?: ReactNode
}

/** Render the operations card. */
export function ActionsSection(props: ActionsSectionProps): ReactElement {
  const { t } = props
  const disabled = props.busy !== null || props.hostBusy || !props.enabled
  const running = props.busy === null ? null : actionLabel(t, props.busy)
  const moreRef = useRef<HTMLDetailsElement>(null)
  const closeTimer = useRef<number | null>(null)

  const cancelScheduledClose = (): void => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const closeMore = (): void => {
    cancelScheduledClose()
    if (moreRef.current !== null) moreRef.current.open = false
  }

  // A short grace period lets the pointer cross the 6px gap between the trigger
  // and the popup without closing it; hovering the popup cancels the close.
  const scheduleClose = (): void => {
    cancelScheduledClose()
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      if (moreRef.current !== null) moreRef.current.open = false
    }, 160)
  }

  useEffect(() => cancelScheduledClose, [])

  return (
    <Card title={t('actionsTitle')} description={t('actionsDesc')}>
      <div className="dgs-actionsMain">
        <Button variant="primary" onClick={props.onSync} disabled={disabled} title={t('actionSyncHint')}>
          {t('actionSync')}
        </Button>
        <Button onClick={props.onDiff} disabled={disabled} title={t('actionDiffHint')}>
          {t('actionDiff')}
        </Button>
        <details
          className="dgs-moreActions"
          ref={moreRef}
          onMouseEnter={cancelScheduledClose}
          onMouseLeave={scheduleClose}
        >
          <summary className="dgs-moreSummary">{t('moreActions')}</summary>
          <div className="dgs-moreMenu" role="menu">
            <button
              type="button"
              className="dgs-moreItem"
              role="menuitem"
              disabled={disabled}
              title={t('actionBackupHint')}
              onClick={() => {
                closeMore()
                props.onBackup()
              }}
            >
              {t('actionBackup')}
            </button>
            <button
              type="button"
              className="dgs-moreItem dgs-moreItemDanger"
              role="menuitem"
              disabled={disabled}
              title={t('actionRestoreHint')}
              onClick={() => {
                closeMore()
                props.onRestore()
              }}
            >
              {t('actionRestore')}
            </button>
          </div>
        </details>
      </div>

      {running === null ? null : (
        <p className="dgs-hint" role="status" aria-live="polite">
          {t('actionRunning', { action: running })}
        </p>
      )}

      {props.diffLoading ? <Loading text={t('loading')} /> : null}

      {props.diff === null ? null : (
        <section className="dgs-diffPanel" aria-label={t('diffTitle')}>
          <div className="dgs-diffHead">
            <div className="dgs-diffHeadText">
              <h4 className="dgs-diffTitle">{t('diffTitle')}</h4>
              <p className="dgs-diffDesc">{t('diffDesc')}</p>
            </div>
            <LinkButton onClick={props.onClearDiff}>{t('close')}</LinkButton>
          </div>
          <PlanPreview t={t} plan={props.diff.plan} />
        </section>
      )}

      {props.autoPanel === undefined ? null : (
        <div className="dgs-autoSection">{props.autoPanel}</div>
      )}
    </Card>
  )
}

/** Localized action name for the busy line. */
function actionLabel(t: Translate, action: ActionName): string {
  switch (action) {
    case 'backup':
      return t('actionBackup')
    case 'restore':
      return t('actionRestore')
    case 'rollback':
      return t('op_rollback')
    case 'sync':
      return t('actionSync')
    case 'diff':
      return t('actionDiff')
    case 'config':
      return t('configTitle')
    case 'auto':
      return t('autoTitle')
    case 'exclusion':
      return t('pluginsTitle')
  }
}
