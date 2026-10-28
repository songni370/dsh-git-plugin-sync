/**
 * Read-only rendering of a Host `SyncPlan`: what an operation would do.
 *
 * Used inside the destructive-operation confirmation dialog and by the
 * "check differences" preview. It deliberately does not offer conflict
 * resolutions — the Host rejects a plan with unresolved conflicts with its own
 * localized message, and inventing a resolution model here would be a second
 * contract to keep in sync.
 * @module ui/PlanPreview
 */

import type { ReactElement } from 'react'
import type { ConflictChoice, SyncPlan } from '../../../src/types'
import type { Translate } from '../i18n'
import { planKindLabel } from '../format'
import { Badge, Select } from './controls'

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

/** Render a plan's destructive steps, all steps, conflicts, and warnings. */
export function PlanPreview(props: PlanPreviewProps): ReactElement {
  const { t, plan } = props
  const destructive = plan.actions.filter(action => action.destructive)
  const hasNothing = plan.actions.length === 0 && plan.conflicts.length === 0 && plan.warnings.length === 0

  return (
    <>
      {props.sourceCommit === undefined || props.sourceCommit === null ? null : (
        <p className="dgs-hint dgs-mono">{t('planSource', { commit: props.sourceCommit })}</p>
      )}

      {props.snapshotPlanned === true ? <p className="dgs-hint">{t('planSnapshot')}</p> : null}

      {hasNothing ? <p className="dgs-hint">{t('planEmpty')}</p> : null}

      {destructive.length === 0 ? null : (
        <section className="dgs-planSection">
          <h4 className="dgs-planHeading">{t('planDestructiveHeader', { count: destructive.length })}</h4>
          <ul className="dgs-planList">
            {destructive.map(action => (
              <li className="dgs-planItem dgs-planItemDestructive" key={`${action.kind}:${action.pluginId}`}>
                <Badge tone="error">{t('planDestructive')}</Badge>
                <span className="dgs-planName">{action.pluginName}</span>
                <span className="dgs-planDetail">{planKindLabel(t, action.kind)}</span>
                {action.detail === '' ? null : <span className="dgs-planDetail">{action.detail}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan.actions.length === 0 ? null : (
        <section className="dgs-planSection">
          <h4 className="dgs-planHeading">{t('planActionsHeader', { count: plan.actions.length })}</h4>
          <ul className="dgs-planList">
            {plan.actions.map(action => (
              <li className="dgs-planItem" key={`${action.kind}:${action.pluginId}`}>
                <span className="dgs-planName">{action.pluginName}</span>
                <span className="dgs-planDetail">{planKindLabel(t, action.kind)}</span>
                {action.detail === '' ? null : <span className="dgs-planDetail">{action.detail}</span>}
                {action.destructive ? <Badge tone="error">{t('planDestructive')}</Badge> : null}
              </li>
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
                <li key={conflict.id}>
                  {conflict.pluginName}: {conflict.reason}
                  {conflict.fields.length === 0 ? null : ` (${conflict.fields.join(', ')})`}
                </li>
              ) : (
                <li key={conflict.id} className="dgs-field">
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
              <li key={`w${index}`}>{warning}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
