/**
 * Unit tests for the plugin inventory scanner and profile discovery.
 *
 * Everything runs against fake Host services and filesystems under the OS temp
 * directory: no DSH runtime, no user profile and no network are involved.
 */
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { silentLogger } from '../../src/core/logger.js'
import type { DshBundleInfo, DshConfigEditor, DshPluginInfo, DshPluginManager } from '../../src/dsh.js'
import { createScanner } from '../../src/scanner/inventory.js'
import {
  findProfileDir,
  listProfiles,
  readProfileDependencies,
} from '../../src/scanner/profiles.js'
import type { DeviceInfo, InventoryScanner, PluginRecord, SyncConfig } from '../../src/types.js'

const DEVICE: DeviceInfo = {
  id: 'dev-test',
  name: 'Test Device',
  platform: 'darwin',
  arch: 'arm64',
  dshVersion: '0.2.1-rc.3',
  pluginVersion: '0.1.0',
}

const tempDirs: string[] = []

afterAll(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

/** Create a temp directory that the suite cleans up afterwards. */
async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-scan-'))
  tempDirs.push(dir)
  return dir
}

/** A complete local configuration for the scanner under test. */
function makeConfig(overrides: Partial<SyncConfig> = {}): SyncConfig {
  return {
    repoUrl: '',
    branch: 'main',
    backupDir: '',
    authMode: 'credential-helper',
    tokenEnvVar: '',
    username: '',
    profiles: ['default'],
    includeConfigs: true,
    includeLocalPlugins: false,
    excludedPlugins: [],
    excludedConfigPlugins: [],
    autoSync: {
      enabled: false,
      mode: 'two-way',
      intervalMinutes: 30,
      onStartup: false,
      onPluginChange: false,
      debounceMs: 10_000,
    },
    deviceName: 'test',
    allowPluginRemoval: false,
    ...overrides,
  }
}

/** A scanner wired to fake services and a temp profiles root. */
function scannerFor(
  profilesRoot: string,
  services: {
    pluginManager?: DshPluginManager
    configEditor?: DshConfigEditor
  } = {},
): InventoryScanner {
  return createScanner({
    services,
    profilesRoot,
    pluginVersion: '0.1.0',
    dshVersion: '0.2.1-rc.3',
    logger: silentLogger(),
    device: DEVICE,
  })
}

/** A fake plugin manager exposing only the two list methods the scanner uses. */
function fakeManager(bundles: unknown[], plugins: unknown[]): DshPluginManager {
  return {
    listBundles: async () => bundles as DshBundleInfo[],
    listPlugins: async () => plugins as DshPluginInfo[],
  } as unknown as DshPluginManager
}

/** Build a valid bundle fixture with sensible defaults. */
function bundle(overrides: Partial<DshBundleInfo> & { name: string }): DshBundleInfo {
  return {
    official: false,
    availability: 'profile',
    enabled: true,
    installed: true,
    optional: false,
    removable: true,
    rows: [],
    overrides: [],
    ...overrides,
  }
}

/** Build a valid plugin-info fixture with sensible defaults. */
function plugin(overrides: Partial<DshPluginInfo> & { entryId: string; moduleName: string }): DshPluginInfo {
  return { enabled: true, ...overrides }
}

/** Write `<profilesRoot>/<name>/package.json`. */
async function writeProfile(profilesRoot: string, name: string, pkg: unknown): Promise<string> {
  const dir = join(profilesRoot, name)
  await mkdir(dir, { recursive: true })
  const content = typeof pkg === 'string' ? pkg : JSON.stringify(pkg)
  await writeFile(join(dir, 'package.json'), content, 'utf8')
  return dir
}

/** Find one record by id, failing the test with a useful message when absent. */
function recordById(inventory: { plugins: PluginRecord[] }, id: string): PluginRecord {
  const record = inventory.plugins.find(item => item.id === id)
  if (record === undefined) throw new Error(`record ${id} not found in ${inventory.plugins.map(p => p.id).join(', ')}`)
  return record
}

describe('createScanner inventory', () => {
  it('scans an npm bundle with a reproducible install spec, rows and display name', async () => {
    const root = await makeTempDir()
    const profilesRoot = join(root, 'profiles')
    const services = {
      pluginManager: fakeManager(
        [
          bundle({
            name: 'demo-plugin',
            version: '2.3.4',
            installTarget: { spec: 'demo-plugin@2.3.4', version: '2.3.4' },
            meta: { title: 'Demo Plugin' },
            rows: [{ rowId: 'demo-row', moduleName: 'demo-plugin', entryId: 'entry-demo' }],
          }),
        ],
        [plugin({ entryId: 'entry-demo', moduleName: 'demo-plugin', enabled: true })],
      ),
    }

    const inventory = await scannerFor(profilesRoot, services).scan({
      config: makeConfig(),
      profile: 'default',
    })

    expect(inventory.schemaVersion).toBe(1)
    expect(inventory.profile).toBe('default')
    expect(inventory.device.id).toBe('dev-test')
    expect(typeof inventory.generatedAt).toBe('string')
    expect(inventory.plugins).toHaveLength(1)
    const record = inventory.plugins[0]!
    expect(record).toMatchObject({
      id: 'demo-plugin',
      name: 'demo-plugin',
      displayName: 'Demo Plugin',
      version: '2.3.4',
      origin: 'npm',
      installSpec: 'demo-plugin@2.3.4',
      enabled: true,
      builtIn: false,
      syncable: true,
      pathOnly: false,
      profile: 'default',
      platform: 'darwin',
    })
    expect(record.rows).toEqual([
      { moduleName: 'demo-plugin', enabled: true, entryId: 'entry-demo', rowId: 'demo-row' },
    ])
  })

  it('detects git, credentialed git and tarball origins', async () => {
    const root = await makeTempDir()
    const profilesRoot = join(root, 'profiles')
    const services = {
      pluginManager: fakeManager(
        [
          bundle({
            name: 'git-plugin',
            version: '1.0.0',
            installTarget: { spec: 'git+https://github.com/acme/git-plugin.git', version: '1.0.0' },
            rows: [{ rowId: 'git-row', moduleName: 'git-plugin' }],
          }),
          bundle({
            name: 'tarball-plugin',
            version: '2.0.0',
            installTarget: { spec: './vendor/tarball-plugin-2.0.0.tgz', version: '2.0.0' },
            rows: [{ rowId: 'tar-row', moduleName: 'tarball-plugin' }],
          }),
          bundle({
            name: 'private-git-plugin',
            installTarget: { spec: 'https://user:secret-token@github.com/acme/private.git', version: '3.0.0' },
            rows: [{ rowId: 'private-row', moduleName: 'private-git-plugin' }],
          }),
        ],
        [],
      ),
    }

    const inventory = await scannerFor(profilesRoot, services).scan({
      config: makeConfig(),
      profile: 'default',
    })

    expect(recordById(inventory, 'git-plugin')).toMatchObject({
      origin: 'git',
      source: 'git+https://github.com/acme/git-plugin.git',
      installSpec: 'git+https://github.com/acme/git-plugin.git',
      pathOnly: false,
      syncable: true,
    })
    expect(recordById(inventory, 'tarball-plugin')).toMatchObject({
      origin: 'tarball',
      source: './vendor/tarball-plugin-2.0.0.tgz',
      installSpec: './vendor/tarball-plugin-2.0.0.tgz',
      pathOnly: false,
      syncable: true,
    })
    const privateRecord = recordById(inventory, 'private-git-plugin')
    expect(privateRecord.origin).toBe('git')
    expect(privateRecord.installSpec).toBeNull()
    expect(privateRecord.syncable).toBe(false)
    expect(privateRecord.source).toBeDefined()
    expect(privateRecord.source).not.toContain('secret-token')
    expect(privateRecord.source).not.toContain('user:')
  })

  it('marks official installation bundles as builtIn and never syncable', async () => {
    const root = await makeTempDir()
    const profilesRoot = join(root, 'profiles')
    const services = {
      pluginManager: fakeManager(
        [
          bundle({
            name: '@deepseek-ai/dsh-client-ui',
            official: true,
            availability: 'installation',
            rows: [{ rowId: 'ui-row', moduleName: '@deepseek-ai/dsh-client-ui' }],
          }),
          bundle({
            name: 'dsh-installation-bundle',
            official: false,
            availability: 'installation',
            rows: [{ rowId: 'install-row', moduleName: 'dsh-installation-bundle' }],
          }),
          bundle({
            name: '@deepseek-ai/dsh-by-name',
            official: false,
            availability: 'profile',
            rows: [{ rowId: 'name-row', moduleName: '@deepseek-ai/dsh-by-name' }],
          }),
        ],
        [],
      ),
    }

    const inventory = await scannerFor(profilesRoot, services).scan({
      config: makeConfig(),
      profile: 'default',
    })

    expect(inventory.plugins).toHaveLength(3)
    for (const record of inventory.plugins) {
      expect(record.builtIn).toBe(true)
      expect(record.origin).toBe('official')
      expect(record.installSpec).toBeNull()
      expect(record.syncable).toBe(false)
    }
  })

  it('detects a symlinked profile dependency as a local-path plugin', async () => {
    const root = await makeTempDir()
    const profilesRoot = join(root, 'profiles')
    const profileDir = await writeProfile(profilesRoot, 'default', {
      name: 'profile-default',
      dependencies: { '@acme/linked': 'workspace:*' },
    })
    const targetDir = join(root, 'linked-target')
    await mkdir(targetDir, { recursive: true })
    await writeFile(join(targetDir, 'package.json'), JSON.stringify({ name: '@acme/linked', version: '0.0.7' }))
    await mkdir(join(profileDir, 'node_modules', '@acme'), { recursive: true })
    await symlink(targetDir, join(profileDir, 'node_modules', '@acme', 'linked'), 'dir')

    const manifest = await readProfileDependencies(profileDir)
    expect(manifest).toEqual({ '@acme/linked': 'workspace:*' })

    const scanner = scannerFor(profilesRoot)
    const inventory = await scanner.scan({ config: makeConfig(), profile: 'default' })
    expect(inventory.plugins).toHaveLength(1)
    const record = inventory.plugins[0]!
    expect(record).toMatchObject({
      id: 'local:@acme/linked',
      name: '@acme/linked',
      origin: 'local-path',
      installSpec: null,
      pathOnly: true,
      builtIn: false,
      syncable: false,
      version: '0.0.7',
      localPath: await realpath(targetDir),
    })

    const included = await scanner.scan({
      config: makeConfig({ includeLocalPlugins: true }),
      profile: 'default',
    })
    expect(included.plugins[0]!.syncable).toBe(true)
  })

  it('keeps excluded third-party plugins listed but not syncable', async () => {
    const root = await makeTempDir()
    const profilesRoot = join(root, 'profiles')
    const services = {
      pluginManager: fakeManager(
        [
          bundle({
            name: 'excluded-plugin',
            version: '1.0.0',
            installTarget: { spec: 'excluded-plugin@1.0.0', version: '1.0.0' },
            rows: [{ rowId: 'excluded-row', moduleName: 'excluded-plugin' }],
          }),
        ],
        [],
      ),
    }

    const inventory = await scannerFor(profilesRoot, services).scan({
      config: makeConfig({ excludedPlugins: ['excluded-plugin'] }),
      profile: 'default',
    })

    expect(inventory.plugins).toHaveLength(1)
    expect(inventory.plugins[0]).toMatchObject({
      id: 'excluded-plugin',
      syncable: false,
      installSpec: 'excluded-plugin@1.0.0',
    })
  })

  it('falls back to the profile manifest when the plugin manager is absent', async () => {
    const root = await makeTempDir()
    const profilesRoot = join(root, 'profiles')
    const profileDir = await writeProfile(profilesRoot, 'default', {
      name: 'profile-default',
      dependencies: {
        '@deepseek-ai/dsh-builtin': '^1.0.0',
        'npm-plugin': '2.0.0',
        'file-plugin': 'file:./packages/file-plugin',
      },
    })
    await mkdir(join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-builtin'), { recursive: true })
    await writeFile(
      join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-builtin', 'package.json'),
      JSON.stringify({ name: '@deepseek-ai/dsh-builtin', version: '1.5.0' }),
    )

    const inventory = await scannerFor(profilesRoot).scan({ config: makeConfig(), profile: 'default' })

    expect(inventory.plugins).toHaveLength(3)
    const builtin = recordById(inventory, '@deepseek-ai/dsh-builtin')
    expect(builtin).toMatchObject({
      builtIn: true,
      origin: 'official',
      installSpec: null,
      syncable: false,
      version: '1.5.0',
    })
    expect(recordById(inventory, 'npm-plugin')).toMatchObject({
      origin: 'npm',
      version: '2.0.0',
      installSpec: 'npm-plugin@2.0.0',
      syncable: true,
      enabled: true,
    })
    expect(recordById(inventory, 'local:file-plugin')).toMatchObject({
      name: 'file-plugin',
      origin: 'local-path',
      installSpec: null,
      pathOnly: true,
      syncable: false,
      localPath: join(profileDir, 'packages', 'file-plugin'),
    })
  })

  it('ignores a broken profile package.json and returns an empty inventory', async () => {
    const root = await makeTempDir()
    const profilesRoot = join(root, 'profiles')
    await writeProfile(profilesRoot, 'broken', '{ this is not json')
    const inventory = await scannerFor(profilesRoot).scan({ config: makeConfig(), profile: 'broken' })
    expect(inventory.profile).toBe('broken')
    expect(inventory.plugins).toEqual([])
    expect(await readProfileDependencies(join(profilesRoot, 'broken'))).toEqual({})
  })

  it('reports plugin entries without bundle metadata as non-syncable orphans', async () => {
    const root = await makeTempDir()
    const profilesRoot = join(root, 'profiles')
    const services = {
      pluginManager: fakeManager(
        [],
        [plugin({ entryId: 'orphan-entry', moduleName: 'orphan-plugin', enabled: false })],
      ),
    }

    const inventory = await scannerFor(profilesRoot, services).scan({
      config: makeConfig(),
      profile: 'default',
    })

    expect(inventory.plugins).toHaveLength(1)
    const record = inventory.plugins[0]!
    expect(record).toMatchObject({
      id: 'orphan-plugin',
      name: 'orphan-plugin',
      builtIn: false,
      origin: 'unknown',
      installSpec: null,
      syncable: false,
      enabled: false,
      version: null,
    })
    expect(record.rows).toEqual([{ moduleName: 'orphan-plugin', enabled: false, entryId: 'orphan-entry' }])
    expect(record.error).toBeTruthy()
  })

  it('extracts filtered configuration through the config editor', async () => {
    const root = await makeTempDir()
    const profilesRoot = join(root, 'profiles')
    const configEditor = {
      entries: () => [],
      configuration: () => [
        {
          entry: { id: 'entry-demo', name: 'demo-plugin' },
          inherited: { timeout: 30 },
          override: { apiKey: 'sk-abcdefghijklmnopqrstuvwxyz', retries: 2 },
        },
      ],
      edit: async () => undefined,
    } as unknown as DshConfigEditor
    const services = {
      configEditor,
      pluginManager: fakeManager(
        [
          bundle({
            name: 'demo-plugin',
            version: '1.0.0',
            rows: [{ rowId: 'demo-row', moduleName: 'demo-plugin', entryId: 'entry-demo' }],
          }),
        ],
        [plugin({ entryId: 'entry-demo', moduleName: 'demo-plugin' })],
      ),
    }

    const inventory = await scannerFor(profilesRoot, services).scan({
      config: makeConfig(),
      profile: 'default',
    })

    expect(inventory.plugins[0]!.configs).toEqual({ timeout: 30, retries: 2 })
    expect(inventory.plugins[0]!.configSkipped).toEqual(['apiKey'])
  })

  it('skips config extraction when includeConfigs is false', async () => {
    const root = await makeTempDir()
    const profilesRoot = join(root, 'profiles')
    const services = {
      configEditor: {
        entries: () => [],
        configuration: () => [{ entry: { id: 'entry-demo' }, inherited: {}, override: { timeout: 5 } }],
        edit: async () => undefined,
      } as unknown as DshConfigEditor,
      pluginManager: fakeManager(
        [bundle({ name: 'demo-plugin', rows: [{ rowId: 'demo-row', moduleName: 'demo-plugin' }] })],
        [],
      ),
    }

    const inventory = await scannerFor(profilesRoot, services).scan({
      config: makeConfig({ includeConfigs: false }),
      profile: 'default',
    })

    expect(inventory.plugins[0]!.configs).toEqual({})
    expect(inventory.plugins[0]!.configSkipped).toEqual([])
  })

  it('never throws on malformed plugin-manager data', async () => {
    const root = await makeTempDir()
    const profilesRoot = join(root, 'profiles')
    const services = {
      pluginManager: fakeManager(
        [
          null,
          42,
          { name: '' },
          {
            name: 'weird-plugin',
            rows: [null, { moduleName: 42 }, {}, { rowId: 7, moduleName: 'weird-plugin' }],
            official: 'yes',
            availability: 'weird',
          },
        ],
        [null, {}, { entryId: 42, moduleName: 7 }, plugin({ entryId: 'weird-entry', moduleName: 'weird-plugin' })],
      ),
    }

    const inventory = await scannerFor(profilesRoot, services).scan({
      config: makeConfig(),
      profile: 'default',
    })

    expect(inventory.plugins).toHaveLength(1)
    const record = inventory.plugins[0]!
    expect(record).toMatchObject({
      id: 'weird-plugin',
      origin: 'unknown',
      syncable: false,
      builtIn: false,
    })
    expect(record.rows).toEqual([{ moduleName: 'weird-plugin', enabled: true, entryId: 'weird-entry' }])
  })

  it('uses the first configured profile when the caller omits one', async () => {
    const root = await makeTempDir()
    const profilesRoot = join(root, 'profiles')
    await writeProfile(profilesRoot, 'work', { dependencies: {} })
    const inventory = await scannerFor(profilesRoot).scan({
      config: makeConfig({ profiles: ['work'] }),
      profile: '',
    })
    expect(inventory.profile).toBe('work')
  })

  it('rejects an aborted scan with a cancelled SyncError', async () => {
    const root = await makeTempDir()
    const profilesRoot = join(root, 'profiles')
    const controller = new AbortController()
    controller.abort()
    await expect(
      scannerFor(profilesRoot).scan({
        config: makeConfig(),
        profile: 'default',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'SyncError', code: 'cancelled' })
  })
})

describe('profile discovery', () => {
  it('lists usable profiles, merging dependencies with declared bundles', async () => {
    const root = await makeTempDir()
    const profilesRoot = join(root, 'profiles')
    await writeProfile(profilesRoot, 'default', {
      name: 'profile-default',
      dependencies: { 'npm-plugin': '1.0.0' },
      dsh: { bundles: ['@deepseek-ai/declared-bundle'] },
    })
    await writeProfile(profilesRoot, 'work', { dependencies: { 'other-plugin': '^2.0.0' } })
    await writeProfile(profilesRoot, 'broken', 'not json at all')
    await mkdir(join(profilesRoot, 'no-manifest'), { recursive: true })

    const profiles = await listProfiles(profilesRoot)
    expect(profiles.map(profile => profile.name)).toEqual(['default', 'work'])

    const defaultProfile = profiles[0]!
    expect(defaultProfile.dir).toBe(join(profilesRoot, 'default'))
    expect(defaultProfile.dependencies).toEqual({ 'npm-plugin': '1.0.0' })
    expect(defaultProfile.bundles).toEqual(['npm-plugin', '@deepseek-ai/declared-bundle'])
    expect(defaultProfile.pluginCount).toBe(2)
    expect(profiles[1]!.pluginCount).toBe(1)
  })

  it('does not spend scan time on configuration or versions of built-in plugins', async () => {
    const root = await makeTempDir()
    const profilesRoot = join(root, 'profiles')
    await writeProfile(profilesRoot, 'default', { dependencies: {} })

    let configurationCalls = 0
    const configEditor = {
      entries: () => [],
      configuration: () => {
        configurationCalls += 1
        return [{ entry: { id: 'entry-community' }, inherited: {}, override: { timeout: 30 } }]
      },
      edit: async () => undefined,
    }
    const bundles = [
      bundle({ name: '@deepseek-ai/base', official: true, availability: 'installation', version: '0.2.1-rc.3' }),
      bundle({ name: '@deepseek-ai/web-app', official: true, availability: 'installation' }),
      bundle({
        name: 'community-plugin',
        version: '1.0.0',
        rows: [{ rowId: 'community-plugin', moduleName: 'community-plugin', entryId: 'entry-community' }],
      }),
    ]
    const plugins = [plugin({ entryId: 'entry-community', moduleName: 'community-plugin' })]
    const inventory = await scannerFor(profilesRoot, {
      pluginManager: fakeManager(bundles, plugins),
      configEditor: configEditor as unknown as DshConfigEditor,
    }).scan({ config: makeConfig(), profile: 'default' })

    // Only the third-party plugin may trigger a config walk; built-ins are
    // inventory-only and dominated a full-profile scan before this guard.
    expect(configurationCalls).toBe(1)
    const builtIn = inventory.plugins.find(record => record.name === '@deepseek-ai/web-app')
    expect(builtIn?.builtIn).toBe(true)
    expect(builtIn?.configs).toEqual({})
    // A missing built-in version is deliberately not probed from disk.
    expect(builtIn?.version).toBeNull()
  })

  it('returns an empty list for a missing profiles root', async () => {
    expect(await listProfiles(join(tmpdir(), 'dsh-does-not-exist-scanner-test'))).toEqual([])
  })

  it('resolves profile directories and refuses unsafe names', async () => {
    const root = await makeTempDir()
    const profilesRoot = join(root, 'profiles')
    const dir = await writeProfile(profilesRoot, 'default', { dependencies: {} })

    expect(await findProfileDir(profilesRoot, 'default')).toBe(dir)
    expect(await findProfileDir(profilesRoot, 'missing')).toBeNull()
    expect(await findProfileDir(profilesRoot, '../default')).toBeNull()
    expect(await findProfileDir(profilesRoot, '')).toBeNull()
  })
})
