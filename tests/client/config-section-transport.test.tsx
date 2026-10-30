/**
 * The repository card shows the fields that belong to the detected transport:
 * HTTPS gets the helper/token choice (token fields only for token auth), SSH
 * and local repositories get no credential fields at all.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConfigSection, configFormFromView } from '../../client/src/ui/ConfigSection'
import { AutoSyncSection } from '../../client/src/ui/AutoSyncSection'
import type { ConfigForm } from '../../client/src/ui/ConfigSection'
import { createTranslate, zh } from '../../client/src/i18n'
import type { GitAuthMode, SyncConfigView } from '../../src/types'

const t = createTranslate(key => zh[key] ?? key)

/** Effective configuration view used by the card. */
function viewFor(repoUrl: string, authMode: GitAuthMode): SyncConfigView {
  return {
    repoUrl,
    branch: 'main',
    backupDir: '',
    authMode,
    tokenEnvVar: 'GITHUB_TOKEN',
    username: '',
    profiles: ['desktop'],
    includeConfigs: true,
    includeLocalPlugins: false,
    excludedPlugins: [],
    excludedConfigPlugins: [],
    autoSync: { enabled: false, mode: 'two-way', intervalMinutes: 30, startupDelayMs: 15_000, onStartup: false, onPluginChange: false, debounceMs: 10_000 },
    deviceName: 'mac',
    tokenAvailable: true,
    device: { id: 'd', name: 'mac', platform: 'darwin', arch: 'arm64', dshVersion: '0.2.1-rc.3', pluginVersion: '0.1.0' },
    activeProfile: 'desktop',
    availableProfiles: ['desktop'],
    dataDir: '~/.dsh/dsh-plugins-git-sync',
  } as SyncConfigView
}

/** Render the card for one form. */
function render(
  repoUrl: string,
  authMode: GitAuthMode,
  overrides: Partial<ConfigForm> = {},
): string {
  const view = viewFor(repoUrl, authMode)
  const form: ConfigForm = { ...configFormFromView(view), ...overrides }
  return renderToStaticMarkup(
    <ConfigSection
      t={t}
      form={form}
      view={view}
      dirty={false}
      saving={false}
      testing={false}
      open
      onToggle={() => undefined}
      onChange={() => undefined}
      onTest={() => undefined}
      onSave={() => undefined}
    />,
  )
}

describe('auto-sync startup delay', () => {
  const baseAuto = {
    enabled: true,
    mode: 'two-way' as const,
    intervalMinutes: 0,
    startupDelayMs: 15_000,
    onStartup: true,
    onPluginChange: false,
    debounceMs: 10_000,
  }

  it('renders the delay in seconds with no warning at the default', () => {
    const html = renderToStaticMarkup(
      <AutoSyncSection t={t} form={baseAuto} dirty={false} saving={false} onChange={() => undefined} onSave={() => undefined} />,
    )
    expect(html).toContain('id="dgs-auto-startup-delay"')
    expect(html).toContain('value="15"')
    expect(html).not.toContain('低于 5 秒')
  })

  it('warns when the startup delay is below 5 seconds', () => {
    const html = renderToStaticMarkup(
      <AutoSyncSection
        t={t}
        form={{ ...baseAuto, startupDelayMs: 3_000 }}
        dirty={false}
        saving={false}
        onChange={() => undefined}
        onSave={() => undefined}
      />,
    )
    expect(html).toContain('value="3"')
    expect(html).toContain('低于 5 秒')
  })
})


describe('repository card transport fields', () => {
  it('HTTPS + credential helper: helper/token choice, no token value fields', () => {
    const html = render('https://github.com/songni370/dsh-plugins-git-sync.git', 'credential-helper')
    expect(html).toContain('HTTPS 仓库')
    expect(html).toContain('id="dgs-config-auth"')
    expect(html).toContain('Git 凭据助手')
    expect(html).toContain('HTTPS 令牌') // the option is offered; its fields are not
    expect(html).not.toContain('id="dgs-config-token-env"')
    expect(html).not.toContain('id="dgs-config-username"')
  })

  it('HTTPS + token: token env var and username are shown', () => {
    const html = render('https://github.com/songni370/dsh-plugins-git-sync.git', 'https-token')
    expect(html).toContain('HTTPS 令牌')
    expect(html).toContain('id="dgs-config-token-env"')
    expect(html).toContain('id="dgs-config-username"')
  })

  it('SSH: one hint only, no auth row or credential fields', () => {
    const html = render('git@github.com:songni370/dsh-plugins-git-sync.git', 'ssh')
    expect(html.split('>SSH 仓库<')).toHaveLength(2) // exactly one badge
    expect(html).toContain('SSH Agent')
    expect(html).not.toContain('认证方式')
    expect(html).not.toContain('id="dgs-config-auth"')
    expect(html).not.toContain('id="dgs-config-token-env"')
    expect(html).not.toContain('id="dgs-config-username"')
  })

  it('shows the current client instead of profile internals', () => {
    const html = render('https://github.com/songni370/dsh-plugins-git-sync.git', 'credential-helper')
    expect(html).toContain('当前客户端')
    expect(html).toContain('桌面端')
    expect(html).not.toContain('暂不支持')
    expect(html).not.toContain('DSH Profile')
  })

  it('secondary options are collapsed on a configured card', () => {
    const html = render('https://github.com/songni370/dsh-plugins-git-sync.git', 'credential-helper')
    expect(html).toContain('高级设置')
    expect(html).toContain('id="dgs-config-advanced" class="dgs-formRows dgs-advancedBody" hidden')
  })

  it('secondary options are expanded on a fresh card', () => {
    const html = render('', 'credential-helper')
    expect(html).toContain('高级设置')
    expect(html).toContain('id="dgs-config-advanced" class="dgs-formRows dgs-advancedBody"><')
  })

  it('empty address: nothing auth-related is shown before detection', () => {
    const html = render('', 'credential-helper')
    expect(html).not.toContain('id="dgs-config-auth"')
    expect(html).not.toContain('id="dgs-config-token-env"')
    expect(html).not.toContain('id="dgs-config-username"')
    // The rest of the form (branch, backup dir, device) is still there.
    expect(html).toContain('id="dgs-config-repo"')
    expect(html).toContain('id="dgs-config-device"')
  })

  it('unknown address form: no auth selector until the transport is known', () => {
    const html = render('git://example.com/repo.git', 'credential-helper')
    expect(html).toContain('其他地址')
    expect(html).not.toContain('id="dgs-config-auth"')
    expect(html).not.toContain('id="dgs-config-token-env"')
  })

  it('local: no auth selector or credential fields', () => {
    const html = render('/tmp/backup.git', 'credential-helper')
    expect(html.split('>本地仓库<')).toHaveLength(2) // exactly one badge
    expect(html).toContain('本地仓库无需认证')
    expect(html).not.toContain('认证方式')
    expect(html).not.toContain('id="dgs-config-auth"')
    expect(html).not.toContain('id="dgs-config-token-env"')
  })
})
