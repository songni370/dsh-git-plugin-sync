/**
 * "Operations" card: the four manual actions and the read-only difference
 * preview.
 *
 * The three content-changing actions are delegated to the page, which opens
 * the confirmation dialog for them. Only "check differences" renders its
 * result here — it never modifies anything, so it needs no dialog.
 * @module ui/ActionsSection
 */

import type { ReactElement, ReactNode } from 'react'
import type { DiffResponse } from '../../../src/http/api-types'
import type { Translate } from '../i18n'
import { Button, Card, LinkButton } from './controls'
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
  onBackup: () => void
  onRestore: () => void
  onSync: () => void
  onDiff: () => void
  onClearDiff: () => void
  /** Automatic-sync panel, merged into this card below the manual actions. */
  autoPanel?: ReactNode
  /** Result of a manual operation, shown inside this card. */
  /** Result of saving auto-sync, shown below the auto-sync panel. */
  /** Sync status content, embedded at the bottom of this card. */
  statusPanel?: ReactNode
  /** State notices (not configured / busy / last error) shown near the actions. */
  notices?: ReactNode
}

/** Render the operations card. */
export function ActionsSection(props: ActionsSectionProps): ReactElement {
  const { t } = props
  const disabled = props.busy !== null || props.hostBusy || !props.enabled
  return (
    <Card title={t('actionsTitle')} description={t('actionsDesc')}>
      <div className="dgs-actionsMain">
        <Button
          variant="primary"
          onClick={props.onSync}
          disabled={disabled}
          loading={props.busy === 'sync'}
          title={t('actionSyncHint')}
        >
          {t('actionSync')}
        </Button>
        <Button
          onClick={props.onDiff}
          disabled={disabled}
          loading={props.busy === 'diff'}
          title={t('actionDiffHint')}
        >
          {t('actionDiff')}
        </Button>
        <Button
          onClick={props.onBackup}
          disabled={disabled}
          loading={props.busy === 'backup'}
          title={t('actionBackupHint')}
        >
          {t('actionBackup')}
        </Button>
        <Button
          onClick={props.onRestore}
          disabled={disabled}
          loading={props.busy === 'restore'}
          title={t('actionRestoreHint')}
        >
          {t('actionRestore')}
        </Button>
      </div>

      {props.notices === undefined ? null : <div className="dgs-actionsNotices">{props.notices}</div>}

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

      {props.statusPanel === undefined ? null : props.statusPanel}
    </Card>
  )
}

