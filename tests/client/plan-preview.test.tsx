/**
 * The difference preview groups steps by direction and summarises counts; a
 * destructive step appears once, in its own group, not duplicated in the full
 * action list.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PlanPreview } from '../../client/src/ui/PlanPreview'
import { createTranslate, zh } from '../../client/src/i18n'
import type { PlanAction, SyncPlan } from '../../src/types'

const t = createTranslate(key => zh[key] ?? key)

function action(kind: PlanAction['kind'], pluginName: string, destructive = false): PlanAction {
  return { kind, pluginId: `p-${pluginName}`, pluginName, detail: '', destructive }
}

const plan: SyncPlan = {
  direction: 'two-way',
  profile: 'desktop',
  generatedAt: '2026-10-29T00:00:00.000Z',
  actions: [
    action('install', 'alpha'),
    action('push-plugin', 'beta'),
    action('remove-local', 'gamma', true),
  ],
  conflicts: [],
  diffs: [],
  requiresConfirmation: true,
  warnings: ['缺少可安装来源 / no install source'],
  localPluginCount: 3,
  remotePluginCount: 3,
}

const conflictPlan: SyncPlan = {
  ...plan,
  actions: [],
  conflicts: [{
    id: 'conflict:alpha',
    pluginId: 'alpha',
    pluginName: 'alpha',
    reason: 'both-changed',
    fields: ['version', 'config.timeout'],
    localVersion: '1.0.0',
    remoteVersion: '2.0.0',
    localEnabled: true,
    remoteEnabled: true,
    remoteDevice: 'device-b',
  }],
  warnings: [],
  requiresConfirmation: true,
}

describe('PlanPreview', () => {
  it('summarises counts and groups steps by direction without duplication', () => {
    const html = renderToStaticMarkup(<PlanPreview t={t} plan={plan} />)
    expect(html).toContain('共 3 步')
    expect(html).toContain('下载 1')
    expect(html).toContain('上传 1')
    expect(html).toContain('删除 1')
    expect(html).toContain('警告 1')
    expect(html).toContain('将从仓库应用（1）')
    expect(html).toContain('将上传到仓库（1）')
    expect(html).toContain('将被删除或覆盖（1）')
    // Each plugin appears exactly once, even though gamma is destructive.
    for (const name of ['alpha', 'beta', 'gamma']) {
      expect(html.split(name)).toHaveLength(2)
    }
  })

  it('renders conflicts first with concise labels and a three-way choice', () => {
    const html = renderToStaticMarkup(
      <PlanPreview
        t={t}
        plan={conflictPlan}
        resolutions={{ alpha: 'skip' }}
        onResolutionChange={() => undefined}
      />,
    )
    expect(html).toContain('需要你决定')
    expect(html).toContain('本机和仓库都改过')
    expect(html).toContain('本机 1.0.0 · 仓库 2.0.0')
    expect(html).toContain('来自 device-b')
    expect(html).toContain('用本机覆盖仓库')
    expect(html).toContain('用仓库覆盖本机')
    expect(html).toContain('跳过')
    expect(html).not.toContain('both-changed')
    expect(html.indexOf('需要你决定')).toBeLessThan(html.indexOf('alpha'))
  })

  it('shows the empty state when there is nothing to do', () => {
    const html = renderToStaticMarkup(
      <PlanPreview
        t={t}
        plan={{ ...plan, actions: [], warnings: [], requiresConfirmation: false }}
      />,
    )
    expect(html).toContain('没有需要执行的步骤')
  })
})
