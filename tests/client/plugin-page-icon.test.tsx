// @vitest-environment jsdom
/**
 * The Plugins-page card icon is enlarged for this plugin only (48px → 64px),
 * leaving other packages and 40px row icons untouched.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PLUGIN_ICON_WRAPPER_ATTR,
  installPluginPageIcon,
  isOwnPluginCardText,
} from '../../client/src/plugin-page-icon'

/** A tiny valid-looking image URL; only the width attribute is inspected. */
const IMG = 'data:image/png;base64,iVBORw0KGgo='

/** Build one card with an icon and a title. */
function card(title: string, size = 48): string {
  return `<div class="card"><span class="cardIcon"><img width="${size}" height="${size}" src="${IMG}"></span><button>${title}</button></div>`
}

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('plugin page icon', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.head.querySelectorAll('style[data-plugin="dsh-plugins-git-sync"]').forEach(node => node.remove())
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('matches only its own card text', () => {
    expect(isOwnPluginCardText('插件备份 使用 Git 仓库…')).toBe(true)
    expect(isOwnPluginCardText('Plugin Backup')).toBe(true)
    expect(isOwnPluginCardText('dsh-plugins-git-sync')).toBe(true)
    expect(isOwnPluginCardText('dsh-context')).toBe(false)
  })

  it('marks the 48px card icon of this plugin and cleans up', async () => {
    document.body.innerHTML = card('插件备份') + card('dsh-context') + card('插件备份', 40)
    let disposer: (() => void) | undefined
    const ctx = {
      effect: (callback: () => unknown) => {
        const result = callback()
        if (typeof result === 'function') disposer = result as () => void
        return result
      },
    }
    installPluginPageIcon(ctx)
    await settle()

    const marked = () => Array.from(document.querySelectorAll(`[${PLUGIN_ICON_WRAPPER_ATTR}]`))
    expect(marked()).toHaveLength(1)
    const style = document.head.querySelector('style[data-plugin-css="dsh-plugins-git-sync/plugin-page-icon"]')
    expect(style?.textContent).toContain('width: 64px !important')

    // A late-rendered card is picked up by the observer.
    document.body.insertAdjacentHTML('beforeend', card('Plugin Backup'))
    await settle()
    expect(marked()).toHaveLength(2)

    disposer?.()
    await settle()
    expect(marked()).toHaveLength(0)
    expect(document.head.querySelector('style[data-plugin-css="dsh-plugins-git-sync/plugin-page-icon"]')).toBeNull()
  })
})
