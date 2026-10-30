/**
 * Read-only rendering of a Host `SyncPlan`: what an operation would do.
 *
 * The preview is grouped by direction — delete/overwrite first, then steps the
 * device will receive from the repository, then steps it will push — because
 * "what happens to me" is the question a user actually asks. Counts sit in a
 * summary strip so the shape of the plan is visible before reading rows.
 *
 * Conflicts are rendered first and, when editable, as reason-specific choices
 * whose labels name the actual action (for example "keep repository" versus
 * "delete from repository"). Under the buttons, one line spells out what the
 * current choice will do, so the decision never depends on a tooltip, and a
 * plugin deleted only on this device is never offered a meaningless "keep
 * local" option.
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

/** One selectable choice: short button label plus the consequence of picking it. */
interface ConflictChoiceView {
  value: ConflictChoice
  label: string
  effect: string
  danger?: boolean
}

/** Reason-specific copy and choices for one conflict. */
interface ConflictPresentation {
  reason: string
  explain: string
  choices: ConflictChoiceView[]
}

/**
 * Turn a conflict reason into plain language. The three useful situations are
 * deliberately separate:
 *  - the plugin is gone here but still backed up (keep it or delete it);
 *  - a restore would overwrite local configuration (keep local or use remote);
 *  - both sides changed the plugin differently (pick a side or leave it).
 * "Both added" is a special case of the last one: neither side has a baseline
 * to be "changed" against, so saying "both changed" would confuse a new device.
 */
function conflictPresentation(t: Translate, conflict: SyncPlan['conflicts'][number]): ConflictPresentation {
  if (conflict.reason === 'local-deleted') {
    return {
      reason: t('conflictReasonLocalDeleted'),
      explain: t('conflictLocalDeletedExplain'),
      choices: [
        { value: 'skip', label: t('conflictChoiceKeepRemote'), effect: t('conflictEffectKeepRemote') },
        { value: 'local', label: t('conflictChoiceDeleteRemote'), effect: t('conflictEffectDeleteRemote'), danger: true },
      ],
    }
  }
  if (conflict.reason === 'config-conflict') {
    return {
      reason: t('conflictReasonConfigConflict'),
      explain: t('conflictConfigConflictExplain'),
      choices: [
        { value: 'local', label: t('conflictChoiceKeepLocalConfig'), effect: t('conflictEffectKeepLocalConfig') },
        { value: 'remote', label: t('conflictChoiceUseRemoteConfig'), effect: t('conflictEffectUseRemoteConfig') },
        { value: 'skip', label: t('conflictChoiceSkip'), effect: t('conflictEffectSkip') },
      ],
    }
  }
  const bothAdded = conflict.hadBaseline === false
  return {
    reason: bothAdded ? t('conflictReasonBothAdded') : reasonLabel(t, conflict.reason),
    explain: bothAdded ? t('conflictBothAddedExplain') : t('conflictBothChangedExplain'),
    choices: [
      { value: 'local', label: t('conflictChoiceLocal'), effect: t('conflictEffectLocal') },
      { value: 'remote', label: t('conflictChoiceRemote'), effect: t('conflictEffectRemote') },
      { value: 'skip', label: t('conflictChoiceSkip'), effect: t('conflictEffectSkip') },
    ],
  }
}

/** One conflict: plain-language reason, differences, choices and their effect. */
function ConflictCard(props: {
  t: Translate
  conflict: SyncPlan['conflicts'][number]
  choice?: ConflictChoice
  onChoice?: (choice: ConflictChoice) => void
}): ReactElement {
  const { t, conflict } = props
  const choice = props.choice ?? 'skip'
  const presentation = conflictPresentation(t, conflict)
  const active = presentation.choices.find(item => item.value === choice) ?? presentation.choices[0]
  const versions =
    conflict.localVersion === null
      ? t('conflictVersionRemoteOnly', { remote: conflict.remoteVersion ?? t('notAvailable') })
      : t('conflictVersionPair', {
          local: conflict.localVersion,
          remote: conflict.remoteVersion ?? t('notAvailable'),
        })
  return (
    <li className="dgs-conflictCard">
      <div className="dgs-conflictHead">
        <span className="dgs-planName">{conflict.pluginName}</span>
        <span className="dgs-conflictMeta">
          {versions}
          {conflict.remoteDevice === undefined ? null : ` · ${t('conflictRemoteDevice', { device: conflict.remoteDevice })}`}
        </span>
      </div>
      <p className="dgs-conflictReason">{presentation.reason}</p>
      <p className="dgs-conflictExplain">{presentation.explain}</p>
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
        <>
          <div className="dgs-choiceGroup" role="radiogroup" aria-label={t('conflictChoiceLabel')}>
            {presentation.choices.map(item => (
              <button
                key={item.value}
                type="button"
                role="radio"
                aria-checked={choice === item.value}
                title={item.effect}
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
          {active === undefined ? null : (
            <p className="dgs-conflictEffect" aria-live="polite">
              {active.effect}
            </p>
          )}
        </>
      )}
    </li>
  )
}

/**
 * The Host adds a pause warning while a plan still has unresolved conflicts.
 * Once every card has a real decision, that warning is stale: keeping it would
 * tell the user the opposite of what the dialog is about to do.
 */
function isConflictPauseWarning(warning: string): boolean {
  return warning.includes('未解决的冲突') || warning.includes('unresolved conflicts pause auto-sync')
}

/** Render a plan's conflicts, summary, grouped steps and warnings. */
export function PlanPreview(props: PlanPreviewProps): ReactElement {
  const { t, plan } = props
  const deletions = plan.actions.filter(
    action => action.destructive || action.kind === 'remove-local' || action.kind === 'remove-remote',
  )
  const downloads = plan.actions.filter(action => !deletions.includes(action) && DOWNLOAD_KINDS.has(action.kind))
  const uploads = plan.actions.filter(action => !deletions.includes(action) && UPLOAD_KINDS.has(action.kind))
  const editable = props.onResolutionChange !== undefined
  const unresolved = plan.conflicts.filter(
    conflict => (props.resolutions?.[conflict.pluginId] ?? 'skip') === 'skip',
  ).length
  const warnings =
    editable && plan.conflicts.length > 0 && unresolved === 0
      ? plan.warnings.filter(warning => !isConflictPauseWarning(warning))
      : plan.warnings
  const hasNothing = plan.actions.length === 0 && plan.conflicts.length === 0 && warnings.length === 0

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
          {editable ? (
            <p className="dgs-hint">
              {unresolved === 0
                ? t('planConflictAllChosen')
                : t('planConflictStillSkipped', { count: unresolved })}
            </p>
          ) : null}
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
            {warnings.length === 0 ? null : (
              <span className="dgs-planSummaryItem">{t('planSummaryWarning', { n: warnings.length })}</span>
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

      {warnings.length === 0 ? null : (
        <section className="dgs-planSection">
          <h4 className="dgs-planHeading">{t('planWarningsHeader', { count: warnings.length })}</h4>
          <ul className="dgs-plainList">
            {warnings.map((warning, index) => (
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
