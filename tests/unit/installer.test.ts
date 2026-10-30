/**
 * Installer behaviour when DSH refuses to install an already-installed name.
 *
 * DSH's plugin manager treats an existing dependency as `already-installed`
 * even when the requested version differs. The installer must treat the same
 * version as a no-op and replace a different version through remove + install.
 */
import { describe, expect, it } from 'vitest'
import { createInstaller } from '../../src/adapters/installer.js'
import { silentLogger } from '../../src/core/logger.js'
import type { DshBundleInfo, DshChangeResult, DshPluginManager } from '../../src/dsh.js'
import type { PluginInstaller } from '../../src/types.js'

const logger = silentLogger()

function changeResult(overrides: Partial<DshChangeResult> = {}): DshChangeResult {
  return {
    changed: true,
    application: 'applied',
    stage: 'install',
    target: 'demo-plugin',
    ...overrides,
  }
}

function bundle(overrides: Partial<DshBundleInfo> = {}): DshBundleInfo {
  return {
    name: 'demo-plugin',
    official: false,
    availability: 'profile',
    version: '1.0.0',
    enabled: true,
    installed: true,
    optional: false,
    removable: true,
    rows: [],
    overrides: [],
    ...overrides,
  }
}

interface FakeHooks {
  installedVersion?: string
  removable?: boolean
  /** The first install throws already-installed, as DSH does for an existing dependency. */
  throwAlreadyInstalled?: boolean
}

function manager(hooks: FakeHooks = {}) {
  let installs = 0
  let removals = 0
  let currentVersion = hooks.installedVersion ?? '1.0.0'
  const fake: DshPluginManager = {
    async listPlugins() { return [] },
    async listBundles() { return [bundle({ version: currentVersion, removable: hooks.removable ?? true })] },
    async inspect(spec: string) { return { status: 'accepted', kind: 'registry', name: spec, version: '2.0.0', bundle: true, registry: null } },
    async installBundle() {
      installs += 1
      if (hooks.throwAlreadyInstalled === true && installs === 1) {
        throw Object.assign(new Error('demo-plugin is already installed'), { code: 'already-installed' })
      }
      currentVersion = '2.0.0'
      return changeResult({ version: '2.0.0' })
    },
    async removeBundle() {
      removals += 1
      return changeResult({ stage: 'remove', target: 'demo-plugin' })
    },
    async setBundleEnabled() { return changeResult({ stage: 'enable' }) },
    async setPluginEnabled() { return changeResult({ stage: 'enable' }) },
  }
  return { fake, counts: () => ({ installs, removals }) }
}

function installerWith(fake: DshPluginManager): PluginInstaller {
  return createInstaller({ pluginManager: fake, activeProfile: 'desktop', logger })
}

describe('installer already-installed handling', () => {
  it('treats the same version as a successful no-op', async () => {
    const { fake, counts } = manager({ installedVersion: '2.0.0', throwAlreadyInstalled: true })
    const outcome = await installerWith(fake).install('demo-plugin@2.0.0', {
      profile: 'desktop',
      name: 'demo-plugin',
      version: '2.0.0',
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.changed).toBe(false)
    expect(outcome.message).toContain('already installed')
    expect(counts()).toEqual({ installs: 1, removals: 0 })
  })

  it('replaces an installed older version through remove + install', async () => {
    const { fake, counts } = manager({ installedVersion: '1.0.0', throwAlreadyInstalled: true })
    const outcome = await installerWith(fake).install('demo-plugin@2.0.0', {
      profile: 'desktop',
      name: 'demo-plugin',
      version: '2.0.0',
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.version).toBe('2.0.0')
    expect(counts()).toEqual({ installs: 2, removals: 1 })
    expect(fake.listBundles).toBeTypeOf('function')
  })

  it('refuses to replace a non-removable bundle and explains why', async () => {
    const { fake, counts } = manager({ installedVersion: '1.0.0', throwAlreadyInstalled: true, removable: false })
    const outcome = await installerWith(fake).install('demo-plugin@2.0.0', {
      profile: 'desktop',
      name: 'demo-plugin',
      version: '2.0.0',
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.message).toContain('无法自动升级')
    expect(counts()).toEqual({ installs: 1, removals: 0 })
  })

  it('keeps a normal successful install unchanged', async () => {
    const { fake, counts } = manager({ installedVersion: '1.0.0' })
    const outcome = await installerWith(fake).install('demo-plugin@2.0.0', {
      profile: 'desktop',
      name: 'demo-plugin',
      version: '2.0.0',
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.version).toBe('2.0.0')
    expect(counts()).toEqual({ installs: 1, removals: 0 })
  })
})
