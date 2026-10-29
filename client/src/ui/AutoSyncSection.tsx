/**
 * Automatic-sync panel, rendered inside the "Operations" card.
 *
 * The schedule is a collapsed-by-default disclosure: the header always states
 * whether automatic sync is on and, when it is, the effective schedule
 * ("每 30 分钟 · 双向同步"). Expanding reveals only the settings that matter —
 * master switch, behavior, interval and the two triggers — and saving collapses
 * it back to the status line.
 *
 * Values are edited locally and persisted in ONE `/auto-sync` request, so the
 * Host never sees a half-updated auto-sync configuration.
 * @module ui/AutoSyncSection
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { AutoSyncMode, SyncConfigView } from '../../../src/types'
import type { Translate } from '../i18n'
import { Badge, Button, Checkbox, Switch } from './controls'

/** The editable subset of `SyncConfig.autoSync`. */
export interface AutoForm {
  enabled: boolean
  mode: AutoSyncMode
  intervalMinutes: number
  onStartup: boolean
  onPluginChange: boolean
  debounceMs: number
}

/** Build the form from the Host's effective configuration view. */
export function autoFormFromView(view: SyncConfigView): AutoForm {
  return {
    enabled: view.autoSync.enabled,
    mode: view.autoSync.mode,
    // Auto-sync is event-driven; the legacy interval field is retired and is
    // always saved as 0 from this page.
    intervalMinutes: 0,
    onStartup: view.autoSync.onStartup,
    onPluginChange: view.autoSync.onPluginChange,
    debounceMs: view.autoSync.debounceMs,
  }
}

/** Props for {@link AutoSyncSection}. */
export interface AutoSyncSectionProps {
  t: Translate
  form: AutoForm
  dirty: boolean
  saving: boolean
  onChange: (patch: Partial<AutoForm>) => void
  onSave: () => void
}

/** Localized label of one auto-sync behavior. */
function modeLabel(t: Translate, mode: AutoSyncMode): string {
  switch (mode) {
    case 'two-way':
      return t('autoModeTwoWay')
    case 'backup':
      return t('autoModeBackup')
    case 'restore':
      return t('autoModeRestore')
  }
}

/** One-line schedule summary shown in the collapsed header. */
function scheduleSummary(t: Translate, form: AutoForm): string {
  if (!form.enabled) return t('autoDisabledSummary')
  const triggers = [form.onStartup ? t('autoStartup') : null, form.onPluginChange ? t('autoPluginChange') : null]
    .filter((part): part is string => part !== null)
  return [modeLabel(t, form.mode), ...(triggers.length === 0 ? [t('autoNoTrigger')] : triggers)].join(' · ')
}

/** Render the automatic-sync panel. */
export function AutoSyncSection(props: AutoSyncSectionProps): ReactElement {
  const { t, form } = props
  const [open, setOpen] = useState(false)
  const wasDirty = useRef(props.dirty)

  // A successful save collapses the form back to the status line.
  useEffect(() => {
    if (wasDirty.current && !props.dirty) setOpen(false)
    wasDirty.current = props.dirty
  }, [props.dirty])

  const optionsDisabled = props.saving || !form.enabled
  const debounceSeconds = Math.max(1, Math.round(form.debounceMs / 1000))

  return (
    <>
      <div className="dgs-autoHeader">
        <div className="dgs-autoHeaderMain">
          <span className="dgs-autoTitle">{t('autoTitle')}</span>
          <Badge tone={form.enabled ? 'success' : 'idle'}>
            {form.enabled ? t('autoStatusOn') : t('autoStatusOff')}
          </Badge>
          <span className="dgs-autoSummary">{scheduleSummary(t, form)}</span>
        </div>
        <div className="dgs-autoHeaderActions">
          {props.dirty ? <Badge tone="warn">{t('configUnsaved')}</Badge> : null}
          <button
            type="button"
            className="dgs-disclosure"
            aria-expanded={open}
            aria-controls="dgs-auto-body"
            onClick={() => {
              setOpen(current => !current)
            }}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
              <path
                d="M4 6.5 8 10.5 12 6.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>{open ? t('configCollapse') : t('autoConfigure')}</span>
          </button>
        </div>
      </div>

      <div id="dgs-auto-body" className="dgs-autoBody" hidden={!open}>
        <div className="dgs-formRows">
          <Switch
            label={t('autoEnabled')}
            hint={t('autoEnabledHint')}
            checked={form.enabled}
            disabled={props.saving}
            onChange={checked => {
              // The two triggers are the whole point of event-driven auto-sync;
              // enabling it with neither selected would never run.
              if (checked && !form.onStartup && !form.onPluginChange) {
                props.onChange({ enabled: true, onStartup: true, onPluginChange: true })
              } else {
                props.onChange({ enabled: checked })
              }
            }}
          />

          <div className="dgs-formRow">
            <span className="dgs-formRowLabel">{t('autoMode')}</span>
            <div className="dgs-formRowControl">
              <div
                id="dgs-auto-mode"
                className="dgs-segmented"
                role="radiogroup"
                aria-label={t('autoMode')}
              >
                {([
                  { value: 'two-way' as const, label: t('autoModeTwoWay') },
                  { value: 'backup' as const, label: t('autoModeBackup') },
                  { value: 'restore' as const, label: t('autoModeRestore') },
                ]).map(option => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={form.mode === option.value}
                    disabled={optionsDisabled}
                    onClick={() => {
                      props.onChange({ mode: option.value })
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="dgs-formRow">
            <span className="dgs-formRowLabel">{t('autoTrigger')}</span>
            <div className="dgs-formRowControl">
              <div className="dgs-checkRowGroup">
                <label className="dgs-checkRow" title={t('autoStartupHint')}>
                  <Checkbox
                    label={t('autoStartup')}
                    checked={form.onStartup}
                    disabled={optionsDisabled}
                    onChange={checked => {
                      props.onChange({ onStartup: checked })
                    }}
                  />
                  {t('autoStartup')}
                </label>
                <label className="dgs-checkRow" title={t('autoPluginChangeHint')}>
                  <Checkbox
                    label={t('autoPluginChange')}
                    checked={form.onPluginChange}
                    disabled={optionsDisabled}
                    onChange={checked => {
                      props.onChange({ onPluginChange: checked })
                    }}
                  />
                  {t('autoPluginChange')}
                </label>
              </div>
              {form.onPluginChange ? (
                <span className="dgs-formRowHint">{t('autoDebounce', { s: debounceSeconds })}</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="dgs-formActions">
          <Button variant="primary" onClick={props.onSave} disabled={props.saving || !props.dirty}>
            {props.saving ? t('saving') : t('autoSave')}
          </Button>
        </div>
      </div>
    </>
  )
}
