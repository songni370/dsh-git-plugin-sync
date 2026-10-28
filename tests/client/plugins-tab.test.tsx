// @vitest-environment jsdom
/**
 * The settings-page shortcut that opens the Plugins page's backup tab.
 *
 * The Plugins page exposes no tab-selection API, so the helper navigates the
 * layout first and then clicks the tab with this plugin's exact label.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { clickBackupTab } from '../../client/src/plugins-tab'

/** Render tab-like buttons in document order. */
function renderTabs(labels: readonly string[]): HTMLButtonElement[] {
  document.body.innerHTML = labels.map(label => `<button>${label}</button>`).join('')
  return Array.from(document.querySelectorAll('button'))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('clickBackupTab', () => {
  it('clicks only the button whose exact label matches', () => {
    const [discover, backup, settingsAction] = renderTabs(['发现', '备份', '备份到 Git'])
    const clicks: string[] = []
    for (const button of [discover, backup, settingsAction]) {
      button?.addEventListener('click', () => clicks.push(button.textContent ?? ''))
    }
    clickBackupTab(() => '备份', { attempts: 1, delayMs: 0 })
    expect(clicks).toEqual(['备份'])
  })

  it('never mistakes the settings nav label or action for the tab', () => {
    const buttons = renderTabs(['插件备份', '备份到 Git', 'Plugin Backup'])
    const clicked: string[] = []
    for (const button of buttons) button.addEventListener('click', () => clicked.push(button.textContent ?? ''))
    clickBackupTab(() => '备份', { attempts: 1, delayMs: 0 })
    expect(clicked).toEqual([])
  })

  it('retries until the Plugins page has rendered the tab', () => {
    const schedule = (callback: () => void): void => {
      queueMicrotask(callback)
    }
    const clicks: string[] = []
    document.body.innerHTML = '<button>发现</button>'
    clickBackupTab(() => '备份', { attempts: 3, schedule })
    // The tab appears between the attempts (the page renders asynchronously).
    queueMicrotask(() => {
      const tab = document.createElement('button')
      tab.textContent = '备份'
      tab.addEventListener('click', () => clicks.push('备份'))
      document.body.appendChild(tab)
    })
    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(clicks).toEqual(['备份'])
        resolve()
      }, 0)
    })
  })

  it('follows the active locale on each attempt', () => {
    const clicked: string[] = []
    document.body.innerHTML = '<button>Backup</button>'
    document.querySelector('button')?.addEventListener('click', () => clicked.push('Backup'))
    let label = '备份'
    clickBackupTab(() => label, { attempts: 1, delayMs: 0 })
    expect(clicked).toEqual([])
    label = 'Backup'
    clickBackupTab(() => label, { attempts: 1, delayMs: 0 })
    expect(clicked).toEqual(['Backup'])
  })

  it('is inert outside a browser document', () => {
    const spy = vi.fn()
    const original = globalThis.document
    // Deliberately simulate a non-DOM runtime.
    delete (globalThis as { document?: Document }).document
    try {
      clickBackupTab(spy, { attempts: 1, delayMs: 0 })
      expect(spy).not.toHaveBeenCalled()
    } finally {
      globalThis.document = original
    }
  })
})
