/**
 * The repository card shows the fields that belong to the detected transport:
 * HTTPS gets the helper/token choice (token fields only for token auth), SSH
 * and local repositories get no credential fields at all.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConfigSection, configFormFromView } from '../../client/src/ui/ConfigSection'
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
    autoSync: { enabled: false, mode: 'two-way', intervalMinutes: 30, onStartup: false, onPluginChange: false, debounceMs: 10_000 },
    deviceName: 'mac',
    allowPluginRemoval: false,
    tokenAvailable: true,
    device: { id: 'd', name: 'mac', platform: 'darwin', arch: 'arm64', dshVersion: '0.2.1-rc.3', pluginVersion: '0.1.0' },
    activeProfile: 'desktop',
    availableProfiles: ['desktop'],
    dataDir: '~/.dsh/dsh-git-plugin-sync',
  } as SyncConfigView
}

/** Render the card for one form. */
function render(repoUrl: string, authMode: GitAuthMode, overrides: Partial<ConfigForm> = {}): string {
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
      connection={null}
      open
      onToggle={() => undefined}
      onChange={() => undefined}
      onTest={() => undefined}
      onSave={() => undefined}
    />,
  )
}

describe('repository card transport fields', () => {
  it('HTTPS + credential helper: helper/token choice, no token value fields', () => {
    const html = render('https://github.com/songni370/dsh-git-plugin-sync.git', 'credential-helper')
    expect(html).toContain('HTTPS 仓库')
    expect(html).toContain('id="dgs-config-auth"')
    expect(html).toContain('Git 凭据助手')
    expect(html).toContain('HTTPS 令牌') // the option is offered; its fields are not
    expect(html).not.toContain('id="dgs-config-token-env"')
    expect(html).not.toContain('id="dgs-config-username"')
  })

  it('HTTPS + token: token env var and username are shown', () => {
    const html = render('https://github.com/songni370/dsh-git-plugin-sync.git', 'https-token')
    expect(html).toContain('HTTPS 令牌')
    expect(html).toContain('id="dgs-config-token-env"')
    expect(html).toContain('id="dgs-config-username"')
  })

  it('SSH: no auth selector or credential fields, just the SSH hint', () => {
    const html = render('git@github.com:songni370/dsh-git-plugin-sync.git', 'ssh')
    expect(html).toContain('SSH 仓库')
    expect(html).toContain('SSH Agent')
    expect(html).not.toContain('id="dgs-config-auth"')
    expect(html).not.toContain('id="dgs-config-token-env"')
    expect(html).not.toContain('id="dgs-config-username"')
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
    expect(html).toContain('本地仓库')
    expect(html).toContain('file://')
    expect(html).not.toContain('id="dgs-config-auth"')
    expect(html).not.toContain('id="dgs-config-token-env"')
  })
})
