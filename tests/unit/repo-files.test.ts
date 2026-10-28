/**
 * Unit tests for the backup-repository serialization boundary: machine paths
 * must never enter a shared backup, config files are only rewritten when they
 * change, and the produced layout stays versioned.
 */

import { describe, expect, it } from 'vitest'
import { buildBackupFiles, configPath, profileStatePath, sanitizeModuleName, sanitizePluginRecord, toRemoteEntry } from '../../src/services/repo-files.js'
import { MANIFEST_SCHEMA_VERSION } from '../../src/constants.js'
import type { PluginRecord } from '../../src/types.js'
import type { PluginState as ModelPluginState } from '../../src/services/model.js'

/** Build a plugin record. */
function record(overrides: Partial<PluginRecord> = {}): PluginRecord {
  return {
    id: 'alpha',
    name: 'alpha',
    version: '1.2.3',
    origin: 'npm',
    installSpec: 'alpha@1.2.3',
    enabled: true,
    builtIn: false,
    syncable: true,
    pathOnly: false,
    profile: 'desktop',
    platform: 'darwin',
    rows: [{ moduleName: 'alpha', rowId: 'alpha', enabled: true, entryId: 'include:alpha' }],
    configs: { timeout: 30 },
    configSkipped: ['apiKey'],
    ...overrides,
  }
}

/** Build a normalized plugin state. */
function state(overrides: Partial<ModelPluginState> = {}): ModelPluginState {
  return {
    id: 'alpha',
    name: 'alpha',
    version: '1.2.3',
    enabled: true,
    configs: { timeout: 30 },
    installSpec: 'alpha@1.2.3',
    origin: 'npm',
    pathOnly: false,
    builtIn: false,
    syncable: true,
    rows: [{ moduleName: 'alpha', rowId: 'alpha', enabled: true }],
    ...overrides,
  } as ModelPluginState
}

describe('module name sanitization', () => {
  it('replaces absolute file URLs with the plugin name', () => {
    expect(sanitizeModuleName('file:///Users/dev/.dsh/profiles/desktop/node_modules/cc/dist/index.js', 'cc-safety-net'))
      .toBe('cc-safety-net')
    expect(sanitizeModuleName('/absolute/path/index.js', 'pkg')).toBe('pkg')
    expect(sanitizeModuleName('C:\\plugins\\x\\index.js', 'pkg')).toBe('pkg')
    expect(sanitizeModuleName('link:../local', 'pkg')).toBe('pkg')
  })

  it('keeps ordinary package names and subpaths', () => {
    expect(sanitizeModuleName('dsh-context', 'fallback')).toBe('dsh-context')
    expect(sanitizeModuleName('@scope/plugin', 'fallback')).toBe('@scope/plugin')
    expect(sanitizeModuleName('@deepseek-ai/dsh-plugin-manager/tools', 'fallback')).toBe('@deepseek-ai/dsh-plugin-manager/tools')
  })

  it('strips the local path and sanitizes rows from a device snapshot record', () => {
    const sanitized = sanitizePluginRecord(record({
      localPath: '/Users/dev/plugins/alpha',
      rows: [
        { moduleName: 'file:///Users/dev/.dsh/profiles/desktop/node_modules/alpha/index.js', rowId: 'alpha', enabled: true },
        { moduleName: 'alpha', rowId: 'alpha', enabled: true, entryId: 'include:alpha' },
      ],
    }))
    expect(sanitized.localPath).toBeUndefined()
    expect(sanitized.rows[0]?.moduleName).toBe('alpha')
    expect(sanitized.rows[1]?.moduleName).toBe('alpha')
  })
})

describe('repository entry conversion', () => {
  it('builds an entry with machine paths removed', () => {
    const entry = toRemoteEntry(state({
      pathOnly: true,
      origin: 'local-path',
      installSpec: null,
      rows: [{ moduleName: 'file:///Users/dev/.dsh/profile/node_modules/dev/index.js', enabled: true, rowId: 'dev' }],
    }), { deviceId: 'device-1', now: '2026-01-01T00:00:00.000Z' })
    expect(entry.id).toBe('alpha')
    expect(entry.rows[0]?.moduleName).toBe('alpha')
    expect(JSON.stringify(entry)).not.toContain('/Users/')
    expect(entry.updatedBy).toBe('device-1')
  })
})

describe('buildBackupFiles', () => {
  it('produces the versioned layout and no absolute paths', () => {
    const files = buildBackupFiles({
      backupDir: 'backup',
      generatorVersion: '0.1.0',
      profile: 'desktop',
      deviceId: 'device-1',
      now: '2026-01-01T00:00:00.000Z',
      previousManifest: null,
      previousState: null,
      upserts: [
        {
          entry: toRemoteEntry(state({
            rows: [{ moduleName: 'file:///Users/dev/node_modules/alpha/index.js', enabled: true, rowId: 'alpha' }],
          }), { deviceId: 'device-1', now: '2026-01-01T00:00:00.000Z' }),
          configs: { timeout: 30 },
        },
      ],
      removals: [],
      deviceSnapshot: {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        device: {
          id: 'device-1',
          name: 'mac',
          platform: 'darwin',
          arch: 'arm64',
          dshVersion: '0.2.1',
          pluginVersion: '0.1.0',
        },
        profile: 'desktop',
        updatedAt: '2026-01-01T00:00:00.000Z',
        plugins: [record({ localPath: '/Users/dev/plugins/alpha' })],
      },
      knownDevices: [],
    })
    expect(files.files['backup/manifest.json']).toBeDefined()
    expect(files.files['backup/metadata/schema.json']).toBeDefined()
    expect(files.files['backup/README.md']).toBeDefined()
    expect(files.files[profileStatePath('backup', 'desktop')]).toBeDefined()
    expect(files.files[configPath('backup', 'desktop', 'alpha')]).toBeDefined()
    const all = Object.values(files.files).join('\n')
    expect(all).not.toContain('/Users/')
    expect(all).not.toContain('sk-')
    const plugins = JSON.parse(files.files[profileStatePath('backup', 'desktop')] ?? '{}') as {
      plugins: Record<string, { rows: { moduleName: string }[] }>
    }
    expect(plugins.plugins.alpha?.rows[0]?.moduleName).toBe('alpha')
    const manifest = JSON.parse(files.files['backup/manifest.json'] ?? '{}') as { schemaVersion: number; devices: string[] }
    expect(manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    expect(manifest.devices).toContain('device-1')
  })

  it('tombstones removals and deletes their config file', () => {
    const now = '2026-01-02T00:00:00.000Z'
    const files = buildBackupFiles({
      backupDir: '',
      generatorVersion: '0.1.0',
      profile: 'desktop',
      deviceId: 'device-2',
      now,
      previousManifest: null,
      previousState: {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        profile: 'desktop',
        updatedAt: now,
        plugins: {
          alpha: toRemoteEntry(state(), { deviceId: 'device-1', now }),
        },
      },
      upserts: [],
      removals: ['alpha'],
      deviceSnapshot: {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        device: { id: 'device-2', name: 'win', platform: 'win32', arch: 'x64', dshVersion: '0.2.1', pluginVersion: '0.1.0' },
        profile: 'desktop',
        updatedAt: now,
        plugins: [],
      },
      knownDevices: ['device-1'],
    })
    const plugins = JSON.parse(files.files[profileStatePath('', 'desktop')] ?? '{}') as {
      plugins: Record<string, { deleted?: boolean }>
    }
    expect(plugins.plugins.alpha?.deleted).toBe(true)
    expect(files.deletions).toContain(configPath('', 'desktop', 'alpha'))
  })

  it('deletes a config file without tombstoning the plugin when the config becomes empty', () => {
    const files = buildBackupFiles({
      backupDir: '',
      generatorVersion: '0.1.0',
      profile: 'desktop',
      deviceId: 'device-1',
      now: '2026-01-02T00:00:00.000Z',
      previousManifest: null,
      previousState: null,
      upserts: [],
      removals: [],
      configDeletions: ['alpha'],
      deviceSnapshot: {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        device: { id: 'device-1', name: 'mac', platform: 'darwin', arch: 'arm64', dshVersion: '0.2.1', pluginVersion: '0.1.0' },
        profile: 'desktop',
        updatedAt: '2026-01-02T00:00:00.000Z',
        plugins: [],
      },
      knownDevices: [],
    })
    expect(files.deletions).toContain(configPath('', 'desktop', 'alpha'))
    expect(files.files[configPath('', 'desktop', 'alpha')]).toBeUndefined()
  })
})
