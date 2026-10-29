// @vitest-environment jsdom
/**
 * The plugin list paginates at 20 rows so a large inventory stays readable.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { PluginsSection } from '../../client/src/ui/PluginsSection'
import { createTranslate, zh } from '../../client/src/i18n'
import type { PluginListRow } from '../../src/http/api-types'

const t = createTranslate(key => zh[key] ?? key)

/** Build N synthetic user-installed plugins. */
function rows(count: number): PluginListRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `plugin-${index}`,
    name: `plugin-${index}`,
    displayName: `Plugin ${index}`,
    presence: 'both',
    version: '1.0.0',
    remoteVersion: '1.0.0',
    enabled: true,
    remoteEnabled: true,
    syncStatus: 'synced',
    inSync: true,
    syncable: true,
    selected: true,
  } satisfies PluginListRow))
}

/** Render the list with the given row count. */
function render(count: number): string {
  return renderToStaticMarkup(
    <PluginsSection
      t={t}
      plugins={{ rows: rows(count), activeProfile: 'desktop', availableProfiles: ['desktop'] }}
      loading={false}
      error={null}
      filter=""
      exclusions={new Set()}
      busy={false}
      onFilterChange={() => undefined}
      onToggle={() => undefined}
      onRefresh={() => undefined}
    />,
  )
}

describe('plugin list pagination', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('shows 20 rows on the first page with a pager', () => {
    const html = render(25)
    expect(html).toContain('第 1 / 3 页')
    expect(html).toContain('显示 1–10，共 25 个')
    expect(html.split('class="dgs-pluginName"')).toHaveLength(11)
    expect(html).toContain('上一页')
    expect(html).toContain('下一页')
    // The page size is user-selectable, defaults to 10 and lives in the pager.
    expect(html).toContain('id="dgs-plugins-page-size"')
    expect(html).toContain('每页')
    expect(html).toContain('<option value="10" selected="">10</option>')
    expect(html).toContain('<option value="100">100</option>')
  })

  it('honours a stored custom page size', () => {
    window.localStorage.setItem('dsh-git-plugin-sync.plugins-page-size', '20')
    const html = render(25)
    expect(html).toContain('第 1 / 2 页')
    expect(html).toContain('显示 1–20，共 25 个')
    expect(html.split('class="dgs-pluginName"')).toHaveLength(21)
  })

  it('renders a footer with the page-size selector but no page buttons for one page', () => {
    const html = render(3)
    expect(html).toContain('dgs-pagination')
    expect(html).toContain('显示 1–3，共 3 个')
    expect(html).toContain('id="dgs-plugins-page-size"')
    expect(html).not.toContain('上一页')
    expect(html).not.toContain('下一页')
    expect(html.split('class="dgs-pluginName"')).toHaveLength(4)
  })
})
