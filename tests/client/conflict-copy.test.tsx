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

function planWithConflict(reason: string, hadBaseline?: boolean, warnings: string[] = []): SyncPlan {
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
    ...(hadBaseline === undefined ? {} : { hadBaseline }),
  }
  return {
    direction: 'two-way',
    profile: 'desktop',
    generatedAt: '2026-01-01T00:00:00.000Z',
    actions: [],
    conflicts: [conflict],
    diffs: [],
    requiresConfirmation: false,
    warnings,
    localPluginCount: 0,
    remotePluginCount: 1,
  }
}

function render(reason: string, choice: ConflictChoice, hadBaseline?: boolean, warnings: string[] = []): string {
  return renderToStaticMarkup(
    <PlanPreview
      t={t}
      plan={planWithConflict(reason, hadBaseline, warnings)}
      resolutions={{ alpha: choice }}
      onResolutionChange={() => undefined}
    />,
  )
}

describe('conflict copy', () => {
  it('offers keep-repository or delete-from-repository when the local plugin is gone', () => {
    const html = render('local-deleted', 'skip')
    expect(html).toContain('本机已卸载，仓库还有备份')
    expect(html).toContain('保留仓库')
    expect(html).toContain('从仓库删除')
    expect(html).toContain('其他设备如果还装着，下次同步会重新备份回来')
    expect(html).not.toContain('仓库也删除')
    expect(html).not.toContain('保留本机')
  })

  it('drops the stale pause warning once every conflict has a choice', () => {
    const pause = '存在 1 个未解决的冲突，自动同步会暂停 / unresolved conflicts pause auto-sync'
    const pending = render('local-deleted', 'skip', undefined, [pause, '另一个提示'])
    expect(pending).toContain('还有 1 个冲突未选择')
    expect(pending).toContain('未解决的冲突')
    expect(pending).toContain('另一个提示')

    const chosen = render('local-deleted', 'local', undefined, [pause, '另一个提示'])
    expect(chosen).toContain('冲突都已选择')
    expect(chosen).not.toContain('未解决的冲突')
    expect(chosen).toContain('另一个提示')
  })

  it('labels both-changed choices by which side overwrites the other', () => {
    const html = render('both-changed', 'skip')
    expect(html).toContain('本机和仓库都改过，结果不同')
    expect(html).toContain('用本机覆盖仓库')
    expect(html).toContain('用仓库覆盖本机')
    expect(html).toContain('先不处理')
    expect(html).toContain('两边都不改动，下次同步还会提示')
    expect(html).not.toContain('保留本机')
  })

  it('explains a first-sync add/add instead of calling it both-changed', () => {
    const html = render('both-changed', 'skip', false)
    expect(html).toContain('两边都安装了这个插件')
    expect(html).toContain('但版本或配置不同')
    expect(html).not.toContain('本机和仓库都改过')
  })

  it('separates restore configuration choices from plugin overwrite choices', () => {
    const html = render('config-conflict', 'skip')
    expect(html).toContain('本机配置和仓库配置不同')
    expect(html).toContain('保留本机配置')
    expect(html).toContain('用仓库配置')
    expect(html).not.toContain('用本机覆盖仓库')
  })

  it('shows the consequence of the selected choice', () => {
    const html = render('both-changed', 'local')
    expect(html).toMatch(/<p class="dgs-conflictEffect" aria-live="polite">用本机内容覆盖仓库[^<]*<\/p>/)
  })
})
