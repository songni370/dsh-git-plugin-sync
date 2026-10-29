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
