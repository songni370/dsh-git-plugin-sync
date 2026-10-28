/**
 * "Plugins" card: this device's plugins joined with the repository state, plus
 * the per-row sync switch.
 *
 * The switch is a check on top of the Host payload: it displays
 * `syncable`/`syncStatus` from `/plugins/list` and persists a change through
 * `config/save`'s `excludedPlugins` (the only exclusion endpoint the contract
 * has). Turning it off never uninstalls anything — it stops future syncs.
 * @module ui/PluginsSection
 */

import type { ReactElement } from 'react'
import type { PluginListResponse, PluginListRow } from '../../../src/http/api-types'
import type { Translate } from '../i18n'
import type { Tone } from './controls'
import { Badge, Banner, Button, Card, Checkbox, LinkButton, Loading } from './controls'

/** Copy + tone for every sync status the Host reports for one row. */
const SYNC_META: Record<PluginListRow['syncStatus'], { key: string; tone: Tone }> = {
  synced: { key: 'statusSynced', tone: 'success' },
  'local-only': { key: 'statusLocalOnly', tone: 'idle' },
  'remote-only': { key: 'statusRemoteOnly', tone: 'idle' },
  'version-diff': { key: 'statusVersionDiff', tone: 'warn' },
  'config-diff': { key: 'statusConfigDiff', tone: 'warn' },
  'enabled-diff': { key: 'statusEnabledDiff', tone: 'warn' },
  conflict: { key: 'statusConflict', tone: 'error' },
  excluded: { key: 'statusExcluded', tone: 'idle' },
}

/** Props for {@link PluginsSection}. */
export interface PluginsSectionProps {
  t: Translate
  plugins: PluginListResponse | null
  loading: boolean
  error: string | null
  filter: string
  /** Ids the user excluded from sync (optimistic, mirrored by config). */
  exclusions: ReadonlySet<string>
  /** An exclusion save is in flight. */
  busy: boolean
  onFilterChange: (value: string) => void
  onToggle: (row: PluginListRow, next: boolean) => void
  onRefresh: () => void
}

/** Render the plugin list card. */
export function PluginsSection(props: PluginsSectionProps): ReactElement {
  const { t } = props
  const rows = props.plugins === null ? [] : props.plugins.rows
  const needle = props.filter.trim().toLowerCase()
  const visible =
    needle === ''
      ? rows
      : rows.filter(row => `${row.displayName ?? ''}\n${row.name}\n${row.id}`.toLowerCase().includes(needle))

  return (
    <Card
      title={t('pluginsTitle')}
      description={t('pluginsDesc')}
      trailing={
        <div className="dgs-btnRow">
          <span className="dgs-hint">{t('pluginsCount', { count: rows.length })}</span>
          <Button small onClick={props.onRefresh} disabled={props.loading || props.busy}>
            {t('pluginsRefresh')}
          </Button>
        </div>
      }
    >
      {props.error === null ? null : (
        <Banner tone="error">
          {t('pluginsLoadFailed', { message: props.error })} <LinkButton onClick={props.onRefresh}>{t('retry')}</LinkButton>
        </Banner>
      )}

      <label className="dgs-srOnly" htmlFor="dgs-plugins-filter">
        {t('pluginsFilterPlaceholder')}
      </label>
      <input
        id="dgs-plugins-filter"
        className="dgs-input"
        type="search"
        value={props.filter}
        placeholder={t('pluginsFilterPlaceholder')}
        onChange={event => {
          props.onFilterChange(event.target.value)
        }}
      />

      {props.loading && props.plugins === null ? <Loading text={t('loading')} /> : null}

      {rows.length === 0 && !props.loading && props.error === null ? (
        <p className="dgs-hint">{t('pluginsEmpty')}</p>
      ) : null}

      {rows.length > 0 && visible.length === 0 ? <p className="dgs-hint">{t('pluginsNoMatch')}</p> : null}

      {visible.length === 0 ? null : (
        <div className="dgs-tableWrap">
          <table className="dgs-table">
            <thead>
              <tr>
                <th className="dgs-tableCellCheck">{t('pluginsSyncable')}</th>
                <th>{t('pluginsName')}</th>
                <th>{t('pluginsLocalVersion')}</th>
                <th>{t('pluginsRemoteVersion')}</th>
                <th>{t('pluginsStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(row => {
                const excluded = props.exclusions.has(row.id) || row.syncStatus === 'excluded'
                const checked = row.syncable && !excluded
                const meta = SYNC_META[row.syncStatus] ?? SYNC_META.excluded
                const localVersion = row.local?.version ?? row.version
                const remoteVersion = row.remoteVersion ?? row.remote?.version ?? null
                return (
                  <tr key={row.id}>
                    <td className="dgs-tableCellCheck">
                      <Checkbox
                        checked={checked}
                        disabled={!row.syncable || props.busy}
                        label={
                          row.syncable
                            ? `${t('pluginsSyncable')}: ${row.displayName ?? row.name}`
                            : `${t('pluginsNotSyncable')}: ${row.displayName ?? row.name}`
                        }
                        onChange={next => {
                          props.onToggle(row, next)
                        }}
                      />
                    </td>
                    <td>
                      <span className="dgs-pluginCell">
                        <span className="dgs-pluginName">{row.displayName ?? row.name}</span>
                        <span className="dgs-pluginId dgs-mono">{row.id}</span>
                      </span>
                    </td>
                    <td className="dgs-nowrap dgs-mono">{localVersion === null || localVersion === '' ? t('notAvailable') : localVersion}</td>
                    <td className="dgs-nowrap dgs-mono">
                      {remoteVersion === null || remoteVersion === '' ? t('notAvailable') : remoteVersion}
                    </td>
                    <td className="dgs-nowrap">
                      <Badge tone={excluded ? 'idle' : meta.tone}>{excluded ? t('statusExcluded') : t(meta.key)}</Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
