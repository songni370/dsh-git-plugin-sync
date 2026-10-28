/**
 * "Automatic sync" card: the four Host auto-sync switches plus the interval.
 *
 * Values are edited locally and persisted in ONE `/auto-sync` request, so the
 * Host never sees a half-updated auto-sync configuration.
 * @module ui/AutoSyncSection
 */

import type { ReactElement } from 'react'
import type { SyncConfigView } from '../../../src/types'
import type { Translate } from '../i18n'
import { Badge, Button, Card, Field, NumberInput, Switch } from './controls'

/** The editable subset of `SyncConfig.autoSync`. */
export interface AutoForm {
  enabled: boolean
  intervalMinutes: number
  onStartup: boolean
  onPluginChange: boolean
  debounceMs: number
}

/** Build the form from the Host's effective configuration view. */
export function autoFormFromView(view: SyncConfigView): AutoForm {
  return {
    enabled: view.autoSync.enabled,
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

/** Render the automatic-sync card. */
export function AutoSyncSection(props: AutoSyncSectionProps): ReactElement {
  const { t, form } = props
  return (
    <Card
      title={t('autoTitle')}
      description={t('autoDesc')}
      trailing={props.dirty ? <Badge tone="warn">{t('configUnsaved')}</Badge> : undefined}
    >
      <Switch
        label={t('autoEnabled')}
        hint={t('autoEnabledHint')}
        checked={form.enabled}
        disabled={props.saving}
        onChange={checked => {
          props.onChange({ enabled: checked })
        }}
      />
      <Switch
        label={t('autoStartup')}
        hint={t('autoStartupHint')}
        checked={form.onStartup}
        disabled={props.saving || !form.enabled}
        onChange={checked => {
          props.onChange({ onStartup: checked })
        }}
      />
      <Switch
        label={t('autoPluginChange')}
        hint={t('autoPluginChangeHint')}
        checked={form.onPluginChange}
        disabled={props.saving || !form.enabled}
        onChange={checked => {
          props.onChange({ onPluginChange: checked })
        }}
      />

      <Field id="dgs-auto-interval" label={t('autoInterval')} hint={t('autoIntervalHint')}>
        <NumberInput
          id="dgs-auto-interval"
          value={form.intervalMinutes}
          min={0}
          max={1440}
          disabled={props.saving || !form.enabled}
          onChange={value => {
            props.onChange({ intervalMinutes: value })
          }}
        />
      </Field>

      <p className="dgs-hint">{t('autoModeHint')}</p>
      <p className="dgs-hint">{t('autoDebounce', { ms: form.debounceMs })}</p>

      <div className="dgs-btnRow">
        <Button variant="primary" onClick={props.onSave} disabled={props.saving || !props.dirty}>
          {props.saving ? t('saving') : t('autoSave')}
        </Button>
      </div>
    </Card>
  )
}
