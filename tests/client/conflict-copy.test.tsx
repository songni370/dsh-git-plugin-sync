/**
 * Conflict choices must describe the actual action. A plugin that is gone on
 * this device but present in the repository cannot offer "keep local"; the
 * user needs to see "delete from repository too" versus "skip".
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PlanPreview } from '../../client/src/ui/PlanPreview'
import { createTranslate, zh } from '../../client/src/i18n'
import type { ConflictChoice, ConflictInfo, SyncPlan } from '../../src/types'

const t = createTranslate(key => zh[key] ?? key)

function planWithConflict(reason: string): SyncPlan {
  const conflict: ConflictInfo = {
    id: 'conflict:alpha',
    pluginId: 'alpha',
    pluginName: 'alpha',
    reason,
    fields: [],
    localVersion: reason === 'local-deleted' ? null : '1.1.0',
    remoteVersion: '1.2.0',
    localEnabled: reason === 'local-deleted' ? null : true,
    remoteEnabled: true,
    remoteDevice: 'device-b',
  }
  return {
    direction: 'two-way',
    profile: 'desktop',
    generatedAt: '2026-01-01T00:00:00.000Z',
    actions: [],
    conflicts: [conflict],
    diffs: [],
    requiresConfirmation: false,
    warnings: [],
    localPluginCount: 0,
    remotePluginCount: 1,
  }
}

function render(reason: string, choice: ConflictChoice): string {
  return renderToStaticMarkup(
    <PlanPreview
      t={t}
      plan={planWithConflict(reason)}
      resolutions={{ alpha: choice }}
      onResolutionChange={() => undefined}
    />,
  )
}

describe('conflict copy', () => {
  it('offers delete-from-repository or skip when the local plugin is gone', () => {
    const html = render('local-deleted', 'skip')
    expect(html).toContain('仓库也删除')
    expect(html).toContain('跳过')
    expect(html).toContain('保留仓库')
    expect(html).not.toContain('保留本机')
  })

  it('labels both-changed choices by which side overwrites the other', () => {
    const html = render('both-changed', 'skip')
    expect(html).toContain('用本机覆盖仓库')
    expect(html).toContain('用仓库覆盖本机')
    expect(html).not.toContain('保留本机')
  })
})
