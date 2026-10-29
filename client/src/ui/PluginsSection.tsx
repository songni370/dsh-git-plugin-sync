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

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { PluginListResponse, PluginListRow } from '../../../src/http/api-types'
import type { Translate } from '../i18n'
import type { Feedback, Tone } from './controls'
import { Badge, Banner, Button, Card, Checkbox, LinkButton, Loading, Select } from './controls'

/** Rows-per-page choices for the plugin table. */
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
const DEFAULT_PAGE_SIZE = 20
const PAGE_SIZE_STORAGE_KEY = 'dsh-git-plugin-sync.plugins-page-size'

/** Remember the user's page size across visits. */
function storedPageSize(): number {
  try {
    const saved = Number.parseInt(window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY) ?? '', 10)
    return (PAGE_SIZE_OPTIONS as readonly number[]).includes(saved) ? saved : DEFAULT_PAGE_SIZE
  } catch {
    return DEFAULT_PAGE_SIZE
  }
}

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
  /** Result of saving an exclusion, shown inside this card. */
  feedback?: Feedback
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

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(storedPageSize)
  // A new filter or page size always starts from the first page.
  useEffect(() => {
    setPage(1)
  }, [props.filter, pageSize])

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * pageSize
  const pageRows = visible.slice(start, start + pageSize)

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

      <div className="dgs-pluginsToolbar">
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
        <div className="dgs-pluginsPageSize">
          <label className="dgs-hint" htmlFor="dgs-plugins-page-size">
            {t('pluginsPageSize')}
          </label>
          <Select
            id="dgs-plugins-page-size"
            className="dgs-pageSizeSelect"
            value={String(pageSize)}
            options={PAGE_SIZE_OPTIONS.map(size => ({ value: String(size), label: String(size) }))}
            onChange={value => {
              const next = Number.parseInt(value, 10)
              setPageSize(next)
              try {
                window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(next))
              } catch {
                // Storage can be unavailable in private mode; the choice still
                // applies for this visit.
              }
            }}
          />
        </div>
      </div>

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
              {pageRows.map(row => {
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
      {visible.length <= pageSize ? null : (
        <div className="dgs-pagination">
          <span className="dgs-hint">
            {t('pluginsPageRange', {
              from: start + 1,
              to: Math.min(start + pageSize, visible.length),
              total: visible.length,
            })}
          </span>
          <div className="dgs-btnRow">
            <Button small onClick={() => setPage(currentPage - 1)} disabled={currentPage <= 1}>
              {t('pluginsPagePrev')}
            </Button>
            <span className="dgs-hint">{t('pluginsPageInfo', { page: currentPage, pages: totalPages })}</span>
            <Button small onClick={() => setPage(currentPage + 1)} disabled={currentPage >= totalPages}>
              {t('pluginsPageNext')}
            </Button>
          </div>
        </div>
      )}

      {props.feedback === undefined ? null : <Banner tone={props.feedback.tone}>{props.feedback.text}</Banner>}
    </Card>
  )
}
