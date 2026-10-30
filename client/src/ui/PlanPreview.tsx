/**
 * Read-only rendering of a Host `SyncPlan`: what an operation would do.
 *
 * The preview is grouped by direction — delete/overwrite first, then steps the
 * device will receive from the repository, then steps it will push — because
 * "what happens to me" is the question a user actually asks. Counts sit in a
 * summary strip so the shape of the plan is visible before reading rows.
 *
 * Conflicts are rendered first and, when editable, as a segmented choice
 * whose labels name the actual action (for example "delete from repository
 * too"); a conflict is the one decision a person must make here, so it should
 * not be buried under plan rows or hidden behind a dropdown.
 * @module ui/PlanPreview
 */

import type { ReactElement } from 'react'
import type { ConflictChoice, PlanAction, PlanActionKind, SyncPlan } from '../../../src/types'
import type { Translate } from '../i18n'
import { planKindLabel } from '../format'

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
        {props.destructive ? <span className="dgs-badge dgs-badgeError">{t('planDestructive')}</span> : null}
      </div>
      {action.detail === '' ? null : <span className="dgs-planDetail">{action.detail}</span>}
    </li>
  )
}

/** Friendly label for a plan's conflict reason code. */
function reasonLabel(t: Translate, reason: string): string {
  switch (reason) {
    case 'both-changed':
      return t('conflictReasonBothChanged')
    case 'config-conflict':
      return t('conflictReasonConfigConflict')
    case 'local-deleted':
      return t('conflictReasonLocalDeleted')
    default:
      return t('conflictReasonGeneric')
  }
}

/** Friendly label for a changed field path. */
function fieldLabel(t: Translate, field: string): string {
  if (field === 'version') return t('conflictFieldVersion')
  if (field === 'enabled') return t('conflictFieldEnabled')
  if (field === 'presence') return t('conflictFieldPresence')
  if (field === 'config') return t('conflictFieldConfig')
  if (field.startsWith('config.')) return t('conflictFieldConfigNamed', { key: field.slice('config.'.length) })
  return field
}

/** One conflict: reason, versions and the three-way choice. */
function ConflictCard(props: {
  t: Translate
  conflict: SyncPlan['conflicts'][number]
  choice?: ConflictChoice
  onChoice?: (choice: ConflictChoice) => void
}): ReactElement {
  const { t, conflict } = props
  const choice = props.choice ?? 'skip'
  const versions = t('conflictVersionPair', {
    local: conflict.localVersion ?? t('notAvailable'),
    remote: conflict.remoteVersion ?? t('notAvailable'),
  })
  // The same three generic labels ("keep local / use repository") are wrong
  // for a plugin that is only gone on this device: there is no local side to
  // keep, and the real decision is whether the repository copy is deleted too.
  const choices: Array<{ value: ConflictChoice; label: string; hint: string; danger?: boolean }> =
    conflict.reason === 'local-deleted'
      ? [
          { value: 'skip', label: t('conflictChoiceSkip'), hint: t('conflictChoiceHintSkipKeepRemote') },
          { value: 'local', label: t('conflictChoiceDeleteRemote'), hint: t('conflictChoiceHintDeleteRemote'), danger: true },
        ]
      : [
          { value: 'skip', label: t('conflictChoiceSkip'), hint: t('conflictChoiceHintSkip') },
          { value: 'local', label: t('conflictChoiceLocal'), hint: t('conflictChoiceHintLocal') },
          { value: 'remote', label: t('conflictChoiceRemote'), hint: t('conflictChoiceHintRemote') },
        ]
  return (
    <li className="dgs-conflictCard">
      <div className="dgs-conflictHead">
        <span className="dgs-planName">{conflict.pluginName}</span>
        <span className="dgs-conflictMeta">
          {versions}
          {conflict.remoteDevice === undefined ? null : ` · ${t('conflictRemoteDevice', { device: conflict.remoteDevice })}`}
        </span>
      </div>
      <p className="dgs-conflictReason">{reasonLabel(t, conflict.reason)}</p>
      {conflict.reason === 'local-deleted' ? (
        <p className="dgs-conflictExplain">{t('conflictLocalDeletedExplain')}</p>
      ) : null}
      {conflict.fields.length === 0 ? null : (
        <div className="dgs-conflictFields">
          {conflict.fields.map(field => (
            <span key={field} className="dgs-conflictField">
              {fieldLabel(t, field)}
            </span>
          ))}
        </div>
      )}
      {props.onChoice === undefined ? null : (
        <div className="dgs-choiceGroup" role="radiogroup" aria-label={t('conflictChoiceLabel')}>
          {choices.map(item => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={choice === item.value}
              title={item.hint}
              className={[
                'dgs-choice',
                choice === item.value ? 'dgs-choiceActive' : '',
                item.danger === true ? 'dgs-choiceDanger' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => props.onChoice?.(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </li>
  )
}

/** Render a plan's conflicts, summary, grouped steps and warnings. */
export function PlanPreview(props: PlanPreviewProps): ReactElement {
  const { t, plan } = props
  const deletions = plan.actions.filter(
    action => action.destructive || action.kind === 'remove-local' || action.kind === 'remove-remote',
  )
  const downloads = plan.actions.filter(action => !deletions.includes(action) && DOWNLOAD_KINDS.has(action.kind))
  const uploads = plan.actions.filter(action => !deletions.includes(action) && UPLOAD_KINDS.has(action.kind))
  const hasNothing = plan.actions.length === 0 && plan.conflicts.length === 0 && plan.warnings.length === 0
  const editable = props.onResolutionChange !== undefined

  return (
    <>
      {props.sourceCommit === undefined || props.sourceCommit === null ? null : (
        <p className="dgs-hint dgs-mono">{t('planSource', { commit: props.sourceCommit })}</p>
      )}

      {props.snapshotPlanned === true ? <p className="dgs-hint">{t('planSnapshot')}</p> : null}

      {plan.conflicts.length === 0 ? null : (
        <section className="dgs-planSection dgs-conflictSection">
          <h4 className="dgs-planHeading">{t('planConflictsHeader', { count: plan.conflicts.length })}</h4>
          <p className="dgs-hint">{t('planConflictNote')}</p>
          <ul className="dgs-conflictList">
            {plan.conflicts.map(conflict => (
              <ConflictCard
                key={conflict.id}
                t={t}
                conflict={conflict}
                {...(editable
                  ? {
                      choice: props.resolutions?.[conflict.pluginId] ?? 'skip',
                      onChoice: (choice: ConflictChoice) => props.onResolutionChange?.(conflict.pluginId, choice),
                    }
                  : {})}
              />
            ))}
          </ul>
        </section>
      )}

      {hasNothing ? <p className="dgs-hint">{t('planEmpty')}</p> : null}

      {plan.actions.length === 0 ? null : (
        <>
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
        </>
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
