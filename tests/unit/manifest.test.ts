import { describe, expect, it } from 'vitest'
import { MANIFEST_SCHEMA_VERSION, PACKAGE_NAME } from '../../src/constants.js'
import { SyncError } from '../../src/core/errors.js'
import {
  MANIFEST_GENERATOR,
  buildDeviceSnapshot,
  buildManifest,
  buildRemoteConfigEntry,
  buildRemotePluginEntry,
  buildRemoteProfileState,
  buildSchemaDocument,
  parseManifestJson,
  parseRepoJson,
  serializeJson,
  serializeManifest,
  validateDeviceSnapshot,
  validateManifest,
  validateRemoteConfigEntry,
  validateRemoteProfileState,
} from '../../src/manifest/manifest.js'
import type { DeviceInfo, JsonObject, PluginRecord, RemotePluginEntry } from '../../src/types.js'

const NOW = '2026-10-28T06:00:00.000Z'
const LATER = '2026-10-28T07:00:00.000Z'

/** A scanned plugin record used by several fixtures. */
function pluginRecord(overrides: Partial<PluginRecord> = {}): PluginRecord {
  return {
    id: 'dsh-plugin-demo',
    name: 'dsh-plugin-demo',
    version: '1.2.3',
    origin: 'npm',
    installSpec: 'dsh-plugin-demo@1.2.3',
    enabled: true,
    builtIn: false,
    syncable: true,
    pathOnly: false,
    profile: 'default',
    platform: 'darwin',
    rows: [{ moduleName: 'dsh-plugin-demo', enabled: true, entryId: 'entry-1' }],
    configs: { timeout: 30, nested: { retries: 2 } },
    configSkipped: ['apiKey'],
    ...overrides,
  }
}

/** A device info fixture. */
const DEVICE: DeviceInfo = {
  id: 'dev-0123456789abcdef',
  name: 'Test Mac',
  platform: 'darwin',
  arch: 'arm64',
  dshVersion: '0.2.1-rc.3',
  pluginVersion: '0.1.0',
}

/** Valid manifest fixture. */
function manifestFixture() {
  return buildManifest({
    previous: null,
    profiles: {
      default: { pluginCount: 3, updatedAt: NOW },
      work: { pluginCount: 1, updatedAt: NOW },
    },
    devices: [DEVICE.id, 'dev-ffffffffffffffff'],
    now: NOW,
  })
}

describe('validateManifest', () => {
  it('accepts and normalizes a manifest built by buildManifest', () => {
    const manifest = manifestFixture()
    const validated = validateManifest(JSON.parse(serializeManifest(manifest)))
    expect(validated.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    expect(validated.generator.name).toBe(PACKAGE_NAME)
    expect(Object.keys(validated.profiles).sort()).toEqual(['default', 'work'])
    expect(validated.devices).toEqual([DEVICE.id, 'dev-ffffffffffffffff'].sort())
  })

  it('drops unknown extra members but keeps documented ones', () => {
    const raw = { ...manifestFixture(), extra: 'ignored', another: { nested: true } }
    const validated = validateManifest(raw)
    expect((validated as unknown as Record<string, unknown>).extra).toBeUndefined()
  })

  it('deduplicates and sorts device ids', () => {
    const raw = { ...manifestFixture(), devices: ['dev-b', 'dev-a', 'dev-b'] }
    expect(validateManifest(raw).devices).toEqual(['dev-a', 'dev-b'])
  })

  it('rejects a non-object document', () => {
    for (const value of [null, 'manifest', 42, [], undefined]) {
      expect(() => validateManifest(value)).toThrow(SyncError)
      try {
        validateManifest(value)
      } catch (error) {
        expect((error as SyncError).code).toBe('invalid-manifest')
      }
    }
  })

  it('rejects a missing or malformed schemaVersion', () => {
    const manifest = manifestFixture() as unknown as JsonObject
    delete manifest.schemaVersion
    expect(() => validateManifest(manifest)).toThrow(/schemaVersion/)
    expect(() => validateManifest({ ...manifestFixture(), schemaVersion: '1' })).toThrow(/schemaVersion/)
    expect(() => validateManifest({ ...manifestFixture(), schemaVersion: 0 })).toThrow(/schemaVersion/)
  })

  it('asks the user to upgrade the plugin for a newer schemaVersion', () => {
    const raw = { ...manifestFixture(), schemaVersion: MANIFEST_SCHEMA_VERSION + 1 }
    try {
      validateManifest(raw)
      expect.unreachable('validateManifest should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(SyncError)
      expect((error as SyncError).code).toBe('invalid-manifest')
      expect((error as SyncError).message).toMatch(/upgrade/i)
      expect((error as SyncError).message).toContain('请升级')
    }
  })

  it('rejects a malformed generator and timestamps', () => {
    expect(() => validateManifest({ ...manifestFixture(), generator: null })).toThrow(/generator/)
    expect(() =>
      validateManifest({ ...manifestFixture(), generator: { name: '', version: '1' } }),
    ).toThrow(/generator/)
    expect(() => validateManifest({ ...manifestFixture(), createdAt: 'yesterday' })).toThrow(/createdAt/)
    expect(() => validateManifest({ ...manifestFixture(), updatedAt: 123 })).toThrow(/updatedAt/)
  })

  it('rejects bad profile summaries', () => {
    const manifest = manifestFixture()
    const negative = { ...manifest, profiles: { default: { pluginCount: -1, updatedAt: NOW } } }
    expect(() => validateManifest(negative)).toThrow(/pluginCount/)
    const huge = { ...manifest, profiles: { default: { pluginCount: 10_000_000, updatedAt: NOW } } }
    expect(() => validateManifest(huge)).toThrow(/pluginCount/)
    const badDate = { ...manifest, profiles: { default: { pluginCount: 1, updatedAt: 'soon' } } }
    expect(() => validateManifest(badDate)).toThrow(/updatedAt/)
    const badKey = { ...manifest, profiles: { '../escape': { pluginCount: 1, updatedAt: NOW } } }
    expect(() => validateManifest(badKey)).toThrow(/profile/)
  })

  it('rejects unsafe device ids', () => {
    const manifest = { ...manifestFixture(), devices: ['../escape'] }
    expect(() => validateManifest(manifest)).toThrow(/device id/)
  })

  it('surfaces multiple reasons in one error', () => {
    try {
      validateManifest({ ...manifestFixture(), createdAt: 'bad', updatedAt: 'also-bad' })
      expect.unreachable('validateManifest should have thrown')
    } catch (error) {
      expect((error as SyncError).message).toMatch(/createdAt/)
      expect((error as SyncError).message).toMatch(/updatedAt/)
      expect((error as SyncError).details?.reasons).toBeInstanceOf(Array)
    }
  })
})

describe('buildManifest / serializeManifest', () => {
  it('creates a valid manifest for the first backup', () => {
    const manifest = manifestFixture()
    expect(manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    expect(manifest.generator).toEqual({ ...MANIFEST_GENERATOR })
    expect(manifest.createdAt).toBe(NOW)
    expect(manifest.updatedAt).toBe(NOW)
    expect(manifest.devices).toEqual([DEVICE.id, 'dev-ffffffffffffffff'].sort())
    expect(manifest.profiles.default).toEqual({ pluginCount: 3, updatedAt: NOW })
  })

  it('preserves createdAt and the generator from the previous manifest', () => {
    const previous = { ...manifestFixture(), createdAt: '2026-01-01T00:00:00.000Z' }
    previous.generator = { name: PACKAGE_NAME, version: '0.0.9' }
    const next = buildManifest({
      previous,
      profiles: { default: { pluginCount: 4, updatedAt: LATER } },
      devices: [DEVICE.id],
      now: LATER,
    })
    expect(next.createdAt).toBe('2026-01-01T00:00:00.000Z')
    // The generator records the plugin version that wrote this manifest, so an
    // upgraded plugin reports its own version instead of freezing the first one.
    expect(next.generator.version).toBe(MANIFEST_GENERATOR.version)
    expect(next.updatedAt).toBe(LATER)
  })

  it('normalizes profile counts and timestamps', () => {
    const manifest = buildManifest({
      previous: null,
      profiles: { default: { pluginCount: -5, updatedAt: 'not-a-date' } },
      devices: [],
      now: NOW,
    })
    expect(manifest.profiles.default).toEqual({ pluginCount: 0, updatedAt: NOW })
  })

  it('rejects invalid profile and device identifiers in the input', () => {
    expect(() =>
      buildManifest({ previous: null, profiles: { '..': { pluginCount: 1, updatedAt: NOW } }, devices: [], now: NOW }),
    ).toThrow(SyncError)
    expect(() =>
      buildManifest({ previous: null, profiles: {}, devices: ['../evil'], now: NOW }),
    ).toThrow(SyncError)
  })

  it('serializes deterministically regardless of insertion order', () => {
    const first = manifestFixture()
    const second = buildManifest({
      previous: null,
      profiles: {
        work: { pluginCount: 1, updatedAt: NOW },
        default: { pluginCount: 3, updatedAt: NOW },
      },
      devices: ['dev-ffffffffffffffff', DEVICE.id],
      now: NOW,
    })
    expect(serializeManifest(first)).toBe(serializeManifest(second))
    const text = serializeManifest(first)
    expect(text.endsWith('\n')).toBe(true)
    expect(text.startsWith('{\n  "schemaVersion": 1,')).toBe(true)
    const parsed = JSON.parse(text) as Record<string, unknown>
    expect(Object.keys(parsed)).toEqual(['schemaVersion', 'generator', 'createdAt', 'updatedAt', 'profiles', 'devices'])
  })
})

describe('serializeJson', () => {
  it('sorts keys recursively and appends a newline', () => {
    const text = serializeJson({ b: 1, a: { z: [3, 2, 1], y: null } })
    expect(text).toBe('{\n  "a": {\n    "y": null,\n    "z": [\n      3,\n      2,\n      1\n    ]\n  },\n  "b": 1\n}\n')
  })

  it('rejects values that are not lossless JSON', () => {
    expect(() => serializeJson({ value: Number.NaN })).toThrow(SyncError)
    expect(() => serializeJson({ value: undefined })).toThrow(SyncError)
    expect(() => serializeJson({ value: () => 1 })).toThrow(SyncError)
    expect(() => serializeJson({ value: 1n })).toThrow(SyncError)
  })
})

describe('buildSchemaDocument', () => {
  it('documents the schema version and layout as valid JSON', () => {
    const text = buildSchemaDocument()
    expect(text.endsWith('\n')).toBe(true)
    const document = JSON.parse(text) as JsonObject
    expect(document.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    const files = document.files as Record<string, string>
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        'manifest.json',
        'metadata/schema.json',
        'README.md',
        'profiles/<profile>/plugins.json',
        'profiles/<profile>/configs/<plugin-id>.json',
        'devices/<deviceId>/<profile>.json',
      ]),
    )
    const trailers = document.commitTrailers as Record<string, string>
    expect(Object.keys(trailers)).toEqual(
      expect.arrayContaining(['Operation', 'Device-Id', 'Device-Name', 'Profile', 'Result', 'Plugin-Count']),
    )
    // Layout entries are repository-relative: no absolute machine paths leaked.
    expect(text).not.toMatch(/"\/(?:Users|Volumes|home|tmp|private)\//)
  })
})

describe('remote profile state helpers', () => {
  it('builds a shared profile state from scanned records', () => {
    const entry = buildRemotePluginEntry({ record: pluginRecord(), updatedAt: NOW, updatedBy: DEVICE.id })
    expect(entry).toMatchObject({
      id: 'dsh-plugin-demo',
      name: 'dsh-plugin-demo',
      version: '1.2.3',
      origin: 'npm',
      enabled: true,
      updatedAt: NOW,
      updatedBy: DEVICE.id,
    })
    // Local-only fields never reach the shared state.
    expect((entry as unknown as Record<string, unknown>).configs).toBeUndefined()
    expect((entry as unknown as Record<string, unknown>).localPath).toBeUndefined()
    expect(entry.rows).toEqual([{ moduleName: 'dsh-plugin-demo', enabled: true, entryId: 'entry-1' }])

    const state = buildRemoteProfileState({ profile: 'default', plugins: [entry], updatedAt: NOW })
    expect(state.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    expect(state.profile).toBe('default')
    expect(state.plugins['dsh-plugin-demo']).toBeDefined()
    // Round-trip through the untrusted-document validator.
    const validated = validateRemoteProfileState(JSON.parse(serializeJson(state)))
    expect(validated).toEqual(state)
  })

  it('records deletion tombstones', () => {
    const entry = buildRemotePluginEntry({
      record: pluginRecord(),
      updatedAt: NOW,
      updatedBy: DEVICE.id,
      deleted: true,
    })
    expect(entry.deleted).toBe(true)
  })

  it('rejects invalid profile-state documents', () => {
    expect(() => validateRemoteProfileState(null)).toThrow(SyncError)
    expect(() => validateRemoteProfileState({ ...buildRemoteProfileState({ profile: 'default', plugins: [], updatedAt: NOW }), schemaVersion: 99 })).toThrow(/upgrade/i)
    const state = buildRemoteProfileState({
      profile: 'default',
      plugins: [buildRemotePluginEntry({ record: pluginRecord(), updatedAt: NOW, updatedBy: DEVICE.id })],
      updatedAt: NOW,
    })
    const mismatched = { ...state, plugins: { 'other-id': state.plugins['dsh-plugin-demo'] } }
    expect(() => validateRemoteProfileState(mismatched)).toThrow(/does not match/)
    const badEntry: RemotePluginEntry = { ...state.plugins['dsh-plugin-demo']! }
    const withBrokenRows = { ...state, plugins: { 'dsh-plugin-demo': { ...badEntry, rows: 'nope' } } }
    expect(() => validateRemoteProfileState(withBrokenRows)).toThrow(/rows/)
  })

  it('builds and validates config entries', () => {
    const entry = buildRemoteConfigEntry({
      pluginId: 'dsh-plugin-demo',
      configs: { timeout: 30, flags: [true, false] },
      updatedAt: NOW,
      updatedBy: DEVICE.id,
    })
    expect(validateRemoteConfigEntry(JSON.parse(serializeJson(entry)))).toEqual(entry)
    expect(() => validateRemoteConfigEntry({ ...entry, configs: [] })).toThrow(/configs/)
    expect(() => validateRemoteConfigEntry({ ...entry, updatedBy: '' })).toThrow(/updatedBy/)
    expect(() => buildRemoteConfigEntry({ pluginId: '', configs: {}, updatedAt: NOW, updatedBy: DEVICE.id })).toThrow(SyncError)
  })

  it('builds and validates device snapshots', () => {
    const snapshot = buildDeviceSnapshot({
      device: DEVICE,
      profile: 'default',
      // Absolute machine paths must never reach the backup.
      plugins: [pluginRecord({ localPath: '/Users/someone/plugins/local-demo' })],
      updatedAt: NOW,
    })
    expect(snapshot.plugins[0]?.localPath).toBeUndefined()
    expect(snapshot.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    expect(snapshot.device.id).toBe(DEVICE.id)
    expect(snapshot.plugins).toHaveLength(1)
    const validated = validateDeviceSnapshot(JSON.parse(serializeJson(snapshot)))
    expect(validated).toEqual(snapshot)
    expect(() => validateDeviceSnapshot({ ...snapshot, profile: '../escape' })).toThrow(/profile/)
    expect(() => validateDeviceSnapshot({ ...snapshot, schemaVersion: 2 })).toThrow(/upgrade/i)
    expect(() => validateDeviceSnapshot({ ...snapshot, updatedAt: 'now' })).toThrow(/updatedAt/)
  })
})

describe('parseRepoJson / parseManifestJson', () => {
  it('maps malformed JSON to invalid-manifest', () => {
    try {
      parseRepoJson('{not json', 'manifest.json')
      expect.unreachable('parseRepoJson should have thrown')
    } catch (error) {
      expect((error as SyncError).code).toBe('invalid-manifest')
      expect((error as SyncError).message).toMatch(/manifest\.json/)
    }
    expect(() => parseManifestJson('[]')).toThrow(SyncError)
  })

  it('accepts a serialized manifest', () => {
    const manifest = manifestFixture()
    expect(parseManifestJson(serializeManifest(manifest))).toEqual(manifest)
  })
})
