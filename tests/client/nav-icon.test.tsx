// @vitest-environment jsdom
/**
 * The settings nav glyph: the shell only supports its own icons for
 * `settings.section`, so this plugin claims its row and paints a sync mask.
 * Tests cover the label match, locale re-claim, and effect-owned cleanup.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  NAV_ICON_MARKER,
  installSettingsNavIcon,
  isOwnNavRow,
  navIconCss,
  navIconMaskSvg,
  navIconMaskUrl,
} from '../../client/src/nav-icon'

/** Build the shell's nav markup for a given row label. */
function renderNav(labels: readonly string[]): void {
  document.body.innerHTML = `<div role="dialog"><nav>${
    labels.map(label => `<button data-row="${label}"><svg data-gear=""></svg><span>${label}</span></button>`).join('')
  }</nav></div>`
}

/** Let queueMicrotask + MutationObserver callbacks run. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('settings nav icon', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.head.querySelectorAll('style[data-plugin="dsh-plugins-git-sync"]').forEach(node => node.remove())
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('paints a monochrome mask at the shell icon size', () => {
    const svg = navIconMaskSvg()
    expect(svg).toContain('viewBox="0 0 24 24"')
    expect(svg).toContain('stroke="#000"')
    expect(navIconMaskUrl().startsWith('data:image/svg+xml,')).toBe(true)
    const css = navIconCss(navIconMaskUrl())
    expect(css).toContain(`[${NAV_ICON_MARKER}] > svg { display: none; }`)
    expect(css).toContain('16px 16px')
    expect(css).toContain('background-color: currentColor')
  })

  it('matches only its own row label', () => {
    expect(isOwnNavRow('插件备份', '插件备份')).toBe(true)
    expect(isOwnNavRow(' 插件备份 ', '插件备份')).toBe(true)
    expect(isOwnNavRow('Plugin Backup', '插件备份')).toBe(false)
    expect(isOwnNavRow('插件备份', '')).toBe(false)
    expect(isOwnNavRow('插件备份', undefined)).toBe(false)
  })

  it('marks the own row, follows a locale switch, and cleans up', async () => {
    renderNav(['通用', '插件备份', '插件市场'])
    let disposer: (() => void) | undefined
    const ctx = {
      effect: (callback: () => unknown) => {
        const result = callback()
        if (typeof result === 'function') disposer = result as () => void
        return result
      },
    }
    let label = '插件备份'
    installSettingsNavIcon(ctx, () => label)
    await settle()

    const marked = () => Array.from(document.querySelectorAll(`[${NAV_ICON_MARKER}]`))
    expect(marked()).toHaveLength(1)
    expect(marked()[0]?.getAttribute('data-row')).toBe('插件备份')
    expect(document.head.querySelector('style[data-plugin="dsh-plugins-git-sync"]')).not.toBeNull()

    // Locale switch: the shell re-renders the row with the English label.
    label = 'Plugin Backup'
    const row = document.querySelector('button[data-row="插件备份"]') as HTMLButtonElement
    row.textContent = 'Plugin Backup'
    row.setAttribute('data-row', 'Plugin Backup')
    await settle()
    expect(marked()).toHaveLength(1)
    expect(marked()[0]?.getAttribute('data-row')).toBe('Plugin Backup')

    disposer?.()
    await settle()
    expect(marked()).toHaveLength(0)
    expect(document.head.querySelector('style[data-plugin="dsh-plugins-git-sync"]')).toBeNull()
  })
})
