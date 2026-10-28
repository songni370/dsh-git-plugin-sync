/**
 * "Automatic sync" card: the master switch, the run mode, interval and the two
 * trigger options.
 *
 * Laid out like the repository card: the master switch is a highlighted panel,
 * every option is a settings row (label left, control right), and the save
 * button sits right-aligned at the end. Everything below the master switch is
 * disabled and dimmed while automatic sync is off.
 *
 * Values are edited locally and persisted in ONE `/auto-sync` request, so the
 * Host never sees a half-updated auto-sync configuration.
 * @module ui/AutoSyncSection
 */

import type { ReactElement } from 'react'
import type { AutoSyncMode, SyncConfigView } from '../../../src/types'
import type { Translate } from '../i18n'
import { Badge, Button, Card, NumberInput, Switch } from './controls'

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
    intervalMinutes: view.autoSync.intervalMinutes,
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

/** Compact switch used inside a settings row (the row label is on the left). */
function RowSwitch(props: {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      className="dgs-switch"
      disabled={props.disabled}
      onClick={() => {
        props.onChange(!props.checked)
      }}
    />
  )
}

/** Render the automatic-sync card. */
export function AutoSyncSection(props: AutoSyncSectionProps): ReactElement {
  const { t, form } = props
  const optionsDisabled = props.saving || !form.enabled
  const debounceSeconds = Math.max(1, Math.round(form.debounceMs / 1000))

  return (
    <Card
      title={t('autoTitle')}
      description={t('autoDesc')}
      trailing={props.dirty ? <Badge tone="warn">{t('configUnsaved')}</Badge> : undefined}
    >
      <div className={form.enabled ? 'dgs-autoMaster' : 'dgs-autoMaster dgs-autoMasterOff'}>
        <Switch
          label={t('autoEnabled')}
          hint={t('autoEnabledHint')}
          checked={form.enabled}
          disabled={props.saving}
          onChange={checked => {
            props.onChange({ enabled: checked })
          }}
        />
      </div>

      <div className={optionsDisabled ? 'dgs-autoOptions dgs-autoOptionsOff' : 'dgs-autoOptions'}>
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
            <span className="dgs-formRowHint">{t('autoModeBehaviorHint')}</span>
          </div>
        </div>

        <div className="dgs-formRow">
          <span className="dgs-formRowLabel">{t('autoInterval')}</span>
          <div className="dgs-formRowControl">
            <div className="dgs-autoNumber">
              <NumberInput
                id="dgs-auto-interval"
                value={form.intervalMinutes}
                min={0}
                max={1440}
                disabled={optionsDisabled}
                onChange={value => {
                  props.onChange({ intervalMinutes: value })
                }}
              />
              <span className="dgs-autoUnit">{t('autoIntervalUnit')}</span>
            </div>
            <span className="dgs-formRowHint">{t('autoIntervalHint')}</span>
          </div>
        </div>

        <div className="dgs-formRow">
          <span className="dgs-formRowLabel">{t('autoStartup')}</span>
          <div className="dgs-formRowControl dgs-formRowControlInline">
            <span className="dgs-formRowHint">{t('autoStartupHint')}</span>
            <RowSwitch
              label={t('autoStartup')}
              checked={form.onStartup}
              disabled={optionsDisabled}
              onChange={checked => {
                props.onChange({ onStartup: checked })
              }}
            />
          </div>
        </div>

        <div className="dgs-formRow">
          <span className="dgs-formRowLabel">{t('autoPluginChange')}</span>
          <div className="dgs-formRowControl dgs-formRowControlInline">
            <span className="dgs-formRowHint">
              {t('autoPluginChangeHint')}
              {form.onPluginChange ? ` · ${t('autoDebounce', { s: debounceSeconds })}` : ''}
            </span>
            <RowSwitch
              label={t('autoPluginChange')}
              checked={form.onPluginChange}
              disabled={optionsDisabled}
              onChange={checked => {
                props.onChange({ onPluginChange: checked })
              }}
            />
          </div>
        </div>
      </div>

      <p className="dgs-formRowHint">{t('autoModeHint')}</p>

      <div className="dgs-formActions">
        <Button variant="primary" onClick={props.onSave} disabled={props.saving || !props.dirty}>
          {props.saving ? t('saving') : t('autoSave')}
        </Button>
      </div>
    </Card>
  )
}
