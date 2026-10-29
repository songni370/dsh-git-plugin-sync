/**
 * Read-only rendering of a Host `SyncPlan`: what an operation would do.
 *
 * The preview is grouped by direction — delete/overwrite first, then steps the
 * device will receive from the repository, then steps it will push — because
 * "what happens to me" is the question a user actually asks. Counts sit in a
 * summary strip so the shape of the plan is visible before reading rows.
 *
 * It deliberately does not offer conflict resolutions — the Host rejects a plan
 * with unresolved conflicts with its own localized message, and inventing a
 * resolution model here would be a second contract to keep in sync.
 * @module ui/PlanPreview
 */

import type { ReactElement } from 'react'
import type { ConflictChoice, PlanAction, PlanActionKind, SyncPlan } from '../../../src/types'
import type { Translate } from '../i18n'
import { planKindLabel } from '../format'
import { Badge, Select } from './controls'

/** Steps the device receives from the repository. */
const DOWNLOAD_KINDS: ReadonlySet<PlanActionKind> = new Set([
  'install',
  'upgrade',
  'downgrade',
  'enable',
  'disable',
  'restore-config',
])

/** Steps the device pushes to the repository. */
const UPLOAD_KINDS: ReadonlySet<PlanActionKind> = new Set(['push-plugin', 'push-config'])

/** Props for {@link PlanPreview}. */
export interface PlanPreviewProps {
  t: Translate
  plan: SyncPlan
  /** The Host will snapshot the local side before acting. */
  snapshotPlanned?: boolean
  /** Commit the plan was computed from, when known. */
  sourceCommit?: string | null
  /**
   * Per-conflict choice. When this and `onResolutionChange` are present the
   * conflict list becomes editable; otherwise it is read-only (difference
   * previews never need a decision).
   */
  resolutions?: Record<string, ConflictChoice>
  onResolutionChange?: (pluginId: string, choice: ConflictChoice) => void
}

/** One plan row: plugin name, kind pill and detail. */
function ActionRow(props: { t: Translate; action: PlanAction; destructive: boolean }): ReactElement {
  const { t, action } = props
  return (
    <li className={props.destructive ? 'dgs-planItem dgs-planItemDestructive' : 'dgs-planItem'}>
      <div className="dgs-planItemHead">
        <span className="dgs-planName">{action.pluginName}</span>
        <span className="dgs-planKind">{planKindLabel(t, action.kind)}</span>
        {props.destructive ? <Badge tone="error">{t('planDestructive')}</Badge> : null}
      </div>
      {action.detail === '' ? null : <span className="dgs-planDetail">{action.detail}</span>}
    </li>
  )
}

/** Render a plan's summary, grouped steps, conflicts and warnings. */
export function PlanPreview(props: PlanPreviewProps): ReactElement {
  const { t, plan } = props
  const deletions = plan.actions.filter(
    action => action.destructive || action.kind === 'remove-local' || action.kind === 'remove-remote',
  )
  const downloads = plan.actions.filter(action => !deletions.includes(action) && DOWNLOAD_KINDS.has(action.kind))
  const uploads = plan.actions.filter(action => !deletions.includes(action) && UPLOAD_KINDS.has(action.kind))
  const hasNothing = plan.actions.length === 0 && plan.conflicts.length === 0 && plan.warnings.length === 0

  return (
    <>
      {props.sourceCommit === undefined || props.sourceCommit === null ? null : (
        <p className="dgs-hint dgs-mono">{t('planSource', { commit: props.sourceCommit })}</p>
      )}

      {props.snapshotPlanned === true ? <p className="dgs-hint">{t('planSnapshot')}</p> : null}

      {hasNothing ? <p className="dgs-hint">{t('planEmpty')}</p> : null}

      {plan.actions.length === 0 ? null : (
        <div className="dgs-planSummary">
          <span className="dgs-planSummaryItem">{t('planSummaryTotal', { n: plan.actions.length })}</span>
          {downloads.length === 0 ? null : (
            <span className="dgs-planSummaryItem">{t('planSummaryDownload', { n: downloads.length })}</span>
          )}
          {uploads.length === 0 ? null : (
            <span className="dgs-planSummaryItem">{t('planSummaryUpload', { n: uploads.length })}</span>
          )}
          {deletions.length === 0 ? null : (
            <span className="dgs-planSummaryItem dgs-planSummaryItemError">
              {t('planSummaryRemove', { n: deletions.length })}
            </span>
          )}
          {plan.conflicts.length === 0 ? null : (
            <span className="dgs-planSummaryItem dgs-planSummaryItemWarn">
              {t('planSummaryConflict', { n: plan.conflicts.length })}
            </span>
          )}
          {plan.warnings.length === 0 ? null : (
            <span className="dgs-planSummaryItem">{t('planSummaryWarning', { n: plan.warnings.length })}</span>
          )}
        </div>
      )}

      {deletions.length === 0 ? null : (
        <section className="dgs-planSection">
          <h4 className="dgs-planHeading">{t('planDestructiveHeader', { count: deletions.length })}</h4>
          <ul className="dgs-planList">
            {deletions.map(action => (
              <ActionRow key={`remove:${action.kind}:${action.pluginId}`} t={t} action={action} destructive />
            ))}
          </ul>
        </section>
      )}

      {downloads.length === 0 ? null : (
        <section className="dgs-planSection">
          <h4 className="dgs-planHeading">{t('planDownloadHeader', { count: downloads.length })}</h4>
          <ul className="dgs-planList">
            {downloads.map(action => (
              <ActionRow key={`down:${action.kind}:${action.pluginId}`} t={t} action={action} destructive={false} />
            ))}
          </ul>
        </section>
      )}

      {uploads.length === 0 ? null : (
        <section className="dgs-planSection">
          <h4 className="dgs-planHeading">{t('planUploadHeader', { count: uploads.length })}</h4>
          <ul className="dgs-planList">
            {uploads.map(action => (
              <ActionRow key={`up:${action.kind}:${action.pluginId}`} t={t} action={action} destructive={false} />
            ))}
          </ul>
        </section>
      )}

      {plan.conflicts.length === 0 ? null : (
        <section className="dgs-planSection">
          <h4 className="dgs-planHeading">{t('planConflictsHeader', { count: plan.conflicts.length })}</h4>
          <p className="dgs-hint">{t('planConflictNote')}</p>
          <ul className="dgs-plainList">
            {plan.conflicts.map(conflict =>
              props.onResolutionChange === undefined ? (
                <li key={conflict.id} className="dgs-conflictItem">
                  <span className="dgs-planName">{conflict.pluginName}</span>
                  <span className="dgs-planDetail">{conflict.reason}</span>
                  {conflict.fields.length === 0 ? null : (
                    <span className="dgs-conflictFields">{conflict.fields.join(' · ')}</span>
                  )}
                </li>
              ) : (
                <li key={conflict.id} className="dgs-conflictItem dgs-field">
                  <span className="dgs-label">{`${t('conflictChoiceLabel')}: ${conflict.pluginName}`}</span>
                  <span className="dgs-hint">{conflict.reason}</span>
                  <Select
                    id={`dgs-conflict-${conflict.pluginId.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                    className="dgs-selectInline"
                    value={props.resolutions?.[conflict.pluginId] ?? 'skip'}
                    options={[
                      { value: 'skip', label: t('conflictChoiceSkip') },
                      { value: 'local', label: t('conflictChoiceLocal') },
                      { value: 'remote', label: t('conflictChoiceRemote') },
                    ]}
                    onChange={choice => {
                      props.onResolutionChange?.(conflict.pluginId, choice)
                    }}
                  />
                </li>
              ),
            )}
          </ul>
        </section>
      )}

      {plan.warnings.length === 0 ? null : (
        <section className="dgs-planSection">
          <h4 className="dgs-planHeading">{t('planWarningsHeader', { count: plan.warnings.length })}</h4>
          <ul className="dgs-plainList">
            {plan.warnings.map((warning, index) => (
              <li key={`w${index}`} className="dgs-warningItem">
                {warning}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
