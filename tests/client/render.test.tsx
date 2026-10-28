// @vitest-environment jsdom
/**
 * Render smoke test for the settings page.
 *
 * Verifies the client half actually mounts, performs its initial Host calls,
 * renders the four main sections with localized text, and opens the
 * confirmation protocol when the Host refuses a destructive operation. This is
 * the closest check available without an authenticated Harness page.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Page } from '../../client/src/ui/Page'
import { resetPluginsTabVisibility } from '../../client/src/plugins-tab-visibility'
import { createTranslate, en, zh } from '../../client/src/i18n'
import type { HistoryResponse, PluginListResponse, StatusPayload } from '../../src/http/api-types'

const t = createTranslate(key => zh[key] ?? key)

/** Per-test repository URL override (null = the configured default mock). */
let repoUrlOverride: string | null = null

/** Build the status payload the Host returns. */
function statusPayload(): StatusPayload {
  return {
    status: {
      state: 'ahead',
      config: {
        repoUrl: repoUrlOverride ?? 'https://github.com/example/backup.git',
        branch: 'main',
        backupDir: '',
        authMode: 'credential-helper',
        tokenEnvVar: '',
        username: '',
        profiles: ['desktop'],
        includeConfigs: true,
        includeLocalPlugins: false,
        excludedPlugins: [],
        excludedConfigPlugins: [],
        autoSync: { enabled: false, mode: 'two-way', intervalMinutes: 30, onStartup: false, onPluginChange: false, debounceMs: 10_000 },
        deviceName: 'mac',
        allowPluginRemoval: false,
        tokenAvailable: false,
        device: { id: 'device-1', name: 'mac', platform: 'darwin', arch: 'arm64', dshVersion: '0.2.1-rc.3', pluginVersion: '0.1.0' },
        activeProfile: 'desktop',
        availableProfiles: ['desktop', 'web'],
        dataDir: '~/.dsh/dsh-git-plugin-sync',
      },
      branch: 'main',
      lastSyncAt: null,
      lastCommit: null,
      lastOperation: null,
      localPluginCount: 5,
      remotePluginCount: 5,
      pendingUploads: 1,
      pendingDownloads: 0,
      conflictCount: 0,
      lastError: null,
      busy: false,
      connection: null,
    },
    logs: [],
  }
}

/** Build the plugin list payload. */
function pluginsPayload(): PluginListResponse {
  return {
    rows: [{
      id: 'dsh-context',
      name: 'dsh-context',
      presence: 'both',
      version: '0.77.0',
      remoteVersion: '0.77.0',
      enabled: true,
      remoteEnabled: true,
      syncStatus: 'synced',
      inSync: true,
      syncable: true,
      selected: true,
    }],
    activeProfile: 'desktop',
    availableProfiles: ['desktop', 'web'],
  }
}

/** Build the history payload. */
function historyPayload(): HistoryResponse {
  return {
    entries: [{
      commit: 'abcdef1234567890abcdef1234567890abcdef12',
      shortCommit: 'abcdef1',
      date: '2026-10-28T07:13:55.045Z',
      author: 'DSH',
      subject: '[dsh-git-plugin-sync] backup desktop',
      operation: 'backup',
      deviceName: 'mac',
      result: 'ok',
      pluginCount: 5,
    }],
    lastOperation: null,
  }
}

/** Fake the four initial Host calls; `/backup` refuses and demands confirmation. */
function installFetchMock(): void {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const target = String(url)
    const envelope = (value: unknown): unknown => ({ ok: true, value })
    const failure = (code: string, message: string, details?: unknown): unknown => ({ ok: false, error: { code, message, details } })
    let payload: unknown
    if (target.endsWith('/status')) payload = envelope(statusPayload())
    else if (target.endsWith('/plugins/list')) payload = envelope(pluginsPayload())
    else if (target.endsWith('/history')) payload = envelope(historyPayload())
    else if (target.endsWith('/backup')) {
      payload = failure('confirmation-required', '需要确认 / confirmation required', {
        plan: {
          direction: 'push',
          profile: 'desktop',
          generatedAt: '2026-10-28T07:13:55.045Z',
          actions: [{
            kind: 'remove-remote',
            pluginId: 'dsh-context',
            pluginName: 'dsh-context',
            detail: '从远端备份中标记删除 / mark deleted in repository',
            destructive: true,
          }],
          conflicts: [],
          diffs: [],
          requiresConfirmation: true,
          warnings: [],
          localPluginCount: 5,
          remotePluginCount: 5,
        },
      })
    } else if (target.endsWith('/diff')) {
      payload = envelope({ direction: 'two-way', plan: { direction: 'two-way', profile: 'desktop', generatedAt: '', actions: [], conflicts: [], diffs: [], requiresConfirmation: false, warnings: [], localPluginCount: 5, remotePluginCount: 5 } })
    } else if (target.endsWith('/config/save')) payload = envelope({ config: statusPayload().status.config })
    else payload = envelope({})
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => payload,
    } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
}

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  resetPluginsTabVisibility()
  repoUrlOverride = null
  installFetchMock()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<Page t={t} />)
  })
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  repoUrlOverride = null
  vi.unstubAllGlobals()
})

/** Wait until the initial fetches settled and the page left its loading state. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('settings page render', () => {
  it('registers the settings menu label as 插件备份 / Plugin Backup', () => {
    expect(zh.nav).toBe('插件备份')
    expect(en.nav).toBe('Plugin Backup')
    expect(createTranslate(key => (key === 'nav' ? 'Plugin Backup' : key))('nav')).toBe('Plugin Backup')
    // Plugins-page tab and the settings-page shortcut label.
    expect(zh.tab).toBe('备份')
    expect(en.tab).toBe('Backup')
    expect(zh.tabVisibilityTitle).toBe('配置页面展示')
    expect(zh.tabVisibilityLabel).toContain('备份')
  })

  it('mounts and renders the repository configuration', async () => {
    await settle()
    expect(container.textContent).toContain('仓库配置')
    expect(container.textContent).toContain('同步状态')
  })

  it('collapses an already configured repository card and expands it on demand', async () => {
    await settle()
    expect(container.textContent).toContain('已配置')
    const repoInput = () => container.querySelector('#dgs-config-repo')
    expect(repoInput()?.closest('[hidden]')).not.toBeNull()
    // Collapsed shows only the title, the status badge and the toggle button.
    expect(container.querySelector('.dgs-configSummary')).toBeNull()
    expect(container.textContent).not.toContain('Git 仓库地址与认证方式')
    const edit = Array.from(container.querySelectorAll('button')).find(button => (button.textContent ?? '').trim() === '编辑配置')
    expect(edit).toBeDefined()
    await act(async () => {
      edit?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    expect(repoInput()?.closest('[hidden]')).toBeNull()
    const collapse = Array.from(container.querySelectorAll('button')).find(button => (button.textContent ?? '').trim() === '收起')
    expect(collapse).toBeDefined()
  })

  it('starts expanded on a fresh install with no repository configured', async () => {
    repoUrlOverride = ''
    await act(async () => {
      root.unmount()
    })
    container.remove()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(<Page t={t} />)
    })
    await settle()
    expect(container.textContent).toContain('未配置仓库')
    expect(container.querySelector('#dgs-config-repo')?.closest('[hidden]')).toBeNull()
  })

  it('renders the status tile row and metadata grid', async () => {
    await settle()
    const text = container.textContent ?? ''
    for (const label of ['本地插件', '仓库插件', '待上传', '待下载', '冲突', '设备', '分支', '上次同步']) {
      expect(text).toContain(label)
    }
    expect(container.querySelector('.dgs-statusTiles')).not.toBeNull()
    expect(container.querySelectorAll('.dgs-statusTile')).toHaveLength(5)
    expect(container.querySelectorAll('.dgs-statusMetaItem')).toHaveLength(6)
  })

  it('renders live status counts and the plugin list', async () => {
    await settle()
    const text = container.textContent ?? ''
    expect(text).toContain('通过 Git 仓库备份、恢复并跨设备同步 DSH 插件与配置。')
    expect(text).toContain('dsh-context')
    expect(text).toContain('有待上传变更')
  })

  it('shows the 配置页面展示 switch and persists switching the Plugins tab off', async () => {
    await settle()
    const switchButton = container.querySelector('[role="switch"][aria-label="在「插件」页面显示「备份」标签页"]')
    expect(switchButton).not.toBeNull()
    expect(container.textContent).toContain('配置页面展示')
    await act(async () => {
      switchButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    expect(localStorage.getItem('dsh-git-plugin-sync.plugins-tab')).toBe('0')
  })

  it('opens the confirmation dialog with the destructive plan from the Host', async () => {
    await settle()
    const buttons = Array.from(container.querySelectorAll('button'))
    const backup = buttons.find(button => (button.textContent ?? '').includes('备份到 Git'))
    expect(backup).toBeDefined()
    await act(async () => {
      backup?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    const text = container.textContent ?? ''
    expect(text).toContain('确认')
    expect(text).toContain('dsh-context')
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
  })
})
