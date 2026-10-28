/**
 * Unit tests for the configuration gateway.
 *
 * Fake Host services only: no DSH runtime, no settings files and no network.
 * The tests pin down both read paths (config editor, settings fallback), the
 * secret filtering rules, and the write semantics (merge-only, never secrets).
 */
import { describe, expect, it } from 'vitest'
import { silentLogger } from '../../src/core/logger.js'
import type { DshConfigEditor, DshSettingsService } from '../../src/dsh.js'
import { createConfigGateway } from '../../src/scanner/config-gateway.js'
import type { JsonValue } from '../../src/types.js'

const logger = silentLogger()

/** Fake config editor hooks. */
interface EditorHooks {
  entries?: () => unknown[]
  configuration?: () => unknown
  edit?: (
    entry: unknown,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ) => Promise<void> | void
}

/** Build a fake `DshConfigEditor`. */
function makeEditor(hooks: EditorHooks): DshConfigEditor {
  const editor: unknown = {
    entries: () => hooks.entries?.() ?? [],
    configuration: () => hooks.configuration?.() ?? [],
    edit: async (
      entry: unknown,
      change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
    ): Promise<void> => {
      await hooks.edit?.(entry, change)
    },
  }
  return editor as DshConfigEditor
}

/** Fake settings service hooks. */
interface SettingsHooks {
  describe?: (options?: { redactSecrets?: boolean }) => unknown
  update?: (ns: string, patch: object, expectedRevision?: number) => Promise<void> | void
}

/** Build a fake `DshSettingsService`. */
function makeSettings(hooks: SettingsHooks): DshSettingsService {
  const settings: unknown = {
    describe: (options?: { redactSecrets?: boolean }) => hooks.describe?.(options) ?? [],
    update: async (ns: string, patch: object, expectedRevision?: number): Promise<void> => {
      await hooks.update?.(ns, patch, expectedRevision)
    },
    replace: async () => undefined,
    mutate: async () => undefined,
  }
  return settings as DshSettingsService
}

/** One settings descriptor fixture. */
function settingsDescriptor(
  ns: string,
  value: unknown,
  secrets: Array<{ path: string[]; set: boolean }> = [],
): Record<string, unknown> {
  return { ns, autoGenerate: false, schema: {}, value, revision: 1, applies: 'live', secrets }
}

/** A gateway wired to the provided fake services. */
function gateway(services: { configEditor?: DshConfigEditor; settings?: DshSettingsService }) {
  return createConfigGateway({ services, logger })
}

describe('config gateway read', () => {
  it('merges inherited and override config, filtering secret keys and values', async () => {
    const entry = { id: 'entry-1', name: 'demo-plugin', patchId: 'patch-1' }
    const editor = makeEditor({
      entries: () => [entry],
      configuration: () => [
        {
          entry,
          inherited: { timeout: 10, nested: { a: 1, apiKey: 'sk-abcdefghijklmnopqrstuvwxyz' } },
          override: { retries: 2, password: 'hunter2' },
        },
      ],
    })

    const result = await gateway({ configEditor: editor }).read({
      moduleName: 'demo-plugin',
      entryIds: [],
      profile: 'default',
    })

    expect(result.values).toEqual({ timeout: 10, retries: 2, nested: { a: 1 } })
    expect(result.skippedKeys).toEqual(['password'])
  })

  it('matches entries by id, name, patchId or requested entry ids', async () => {
    const byPatchId = { id: 'entry-a', name: 'loader-name-a', patchId: 'patch-a' }
    const byEntryId = { id: 'entry-b', name: 'loader-name-b' }
    const editor = makeEditor({
      configuration: () => [
        { entry: byPatchId, inherited: {}, override: { a: true } },
        { entry: byEntryId, inherited: {}, override: { b: true } },
      ],
    })
    const configGateway = gateway({ configEditor: editor })

    expect(
      (await configGateway.read({ moduleName: 'different', entryIds: ['patch-a'], profile: 'default' }))
        .values,
    ).toEqual({ a: true })
    expect(
      (await configGateway.read({ moduleName: 'loader-name-b', entryIds: [], profile: 'default' }))
        .values,
    ).toEqual({ b: true })
    expect(
      (await configGateway.read({ moduleName: '', entryIds: ['entry-b'], profile: 'default' })).values,
    ).toEqual({ b: true })
  })

  it('drops URL userinfo, private keys and nested secret values', async () => {
    const entry = { id: 'entry-1', name: 'demo-plugin' }
    const editor = makeEditor({
      configuration: () => [
        {
          entry,
          inherited: {},
          override: {
            endpoint: 'https://user:password@example.com/repo',
            signingKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
            nested: { token: 'opaque-value', keep: 'yes' },
            plain: 7,
          },
        },
      ],
    })

    const result = await gateway({ configEditor: editor }).read({
      moduleName: 'demo-plugin',
      entryIds: [],
      profile: 'default',
    })

    expect(result.values).toEqual({ nested: { keep: 'yes' }, plain: 7 })
    expect(result.skippedKeys).toEqual(expect.arrayContaining(['endpoint', 'signingKey']))
  })

  it('falls back to settings.describe and always drops declared secret paths', async () => {
    const describeCalls: unknown[] = []
    const settings = makeSettings({
      describe: options => {
        describeCalls.push(options)
        return [
          settingsDescriptor(
            'demo-plugin',
            {
              timeout: 5,
              apiKey: 'opaque',
              endpoint: 'https://user:password@example.com/repo',
              nested: { token: 'opaque-value', keep: true },
            },
            [
              { path: ['nested', 'token'], set: true },
              { path: ['apiKey'], set: true },
            ],
          ),
        ]
      },
    })

    const result = await gateway({ settings }).read({
      moduleName: 'demo-plugin',
      entryIds: [],
      profile: 'default',
    })

    expect(describeCalls).toEqual([{ redactSecrets: true }])
    expect(result.values).toEqual({ timeout: 5, nested: { keep: true } })
    expect(result.skippedKeys).toEqual(
      expect.arrayContaining(['nested.token', 'apiKey', 'endpoint']),
    )
  })

  it('uses settings when the config editor has no matching entry', async () => {
    const editor = makeEditor({
      configuration: () => [{ entry: { id: 'other-entry', name: 'other-plugin' }, inherited: {}, override: { x: 1 } }],
    })
    const settings = makeSettings({
      describe: () => [settingsDescriptor('demo-plugin', { timeout: 9 })],
    })

    const result = await gateway({ configEditor: editor, settings }).read({
      moduleName: 'demo-plugin',
      entryIds: [],
      profile: 'default',
    })
    expect(result.values).toEqual({ timeout: 9 })
  })

  it('returns an empty best-effort result when the editor is malformed and settings throws', async () => {
    const editor = makeEditor({
      configuration: () => {
        throw new Error('loader exploded')
      },
      entries: () => {
        throw new Error('entries exploded')
      },
    })
    const settings = makeSettings({
      describe: () => {
        throw new Error('settings exploded')
      },
    })

    await expect(
      gateway({ configEditor: editor, settings }).read({
        moduleName: 'demo-plugin',
        entryIds: [],
        profile: 'default',
      }),
    ).resolves.toEqual({ values: {}, skippedKeys: [] })
  })

  it('tolerates malformed configuration rows', async () => {
    const editor = makeEditor({
      configuration: () => [null, 42, {}, { entry: null }, { entry: { id: 42 } }, { entry: { id: 'ok' }, override: { a: 1 } }],
    })

    const result = await gateway({ configEditor: editor }).read({
      moduleName: 'ok',
      entryIds: [],
      profile: 'default',
    })
    expect(result.values).toEqual({ a: 1 })
  })

  it('returns an empty result when no Host service is available', async () => {
    await expect(
      gateway({}).read({ moduleName: 'demo-plugin', entryIds: ['entry-1'], profile: 'default' }),
    ).resolves.toEqual({ values: {}, skippedKeys: [] })
  })
})

describe('config gateway write', () => {
  it('merges only the given keys into the current entry config, dropping secrets', async () => {
    let observed: Record<string, unknown> | null = null
    const entry = { id: 'entry-1', name: 'demo-plugin' }
    const editor = makeEditor({
      entries: () => [entry],
      configuration: () => [{ entry, inherited: {}, override: {} }],
      edit: (_target, change) => {
        observed = change({ keep: 'yes', timeout: 1 }, {})
      },
    })

    await gateway({ configEditor: editor }).write({
      moduleName: 'demo-plugin',
      entryIds: ['entry-1'],
      values: {
        timeout: 99,
        apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
        nested: { password: 'hunter2', keep: true },
      },
      profile: 'default',
    })

    expect(observed).toEqual({ keep: 'yes', timeout: 99, nested: { keep: true } })
  })

  it('finds the edit target through patchId when the module name differs', async () => {
    let editedEntry: unknown = null
    const entry = { id: 'entry-x', name: 'package-name', patchId: 'patch-x' }
    const editor = makeEditor({
      configuration: () => [{ entry, inherited: {}, override: {} }],
      edit: target => {
        editedEntry = target
      },
    })

    await gateway({ configEditor: editor }).write({
      moduleName: 'unrelated',
      entryIds: ['patch-x'],
      values: { timeout: 5 },
      profile: 'default',
    })
    expect(editedEntry).toBe(entry)
  })

  it('falls back to settings.update when the editor has no matching entry', async () => {
    const updates: Array<{ ns: string; patch: object }> = []
    const editor = makeEditor({
      configuration: () => [{ entry: { id: 'other', name: 'other-plugin' }, inherited: {}, override: {} }],
    })
    const settings = makeSettings({
      describe: () => [settingsDescriptor('demo-plugin', {})],
      update: (ns, patch) => {
        updates.push({ ns, patch })
      },
    })

    await gateway({ configEditor: editor, settings }).write({
      moduleName: 'demo-plugin',
      entryIds: [],
      values: { timeout: 5, token: 'secret-token' },
      profile: 'default',
    })

    expect(updates).toEqual([{ ns: 'demo-plugin', patch: { timeout: 5 } }])
  })

  it('writes through settings.update when no config editor exists', async () => {
    const updates: Array<{ ns: string; patch: object }> = []
    const settings = makeSettings({
      update: (ns, patch) => {
        updates.push({ ns, patch })
      },
    })

    await gateway({ settings }).write({
      moduleName: 'demo-plugin',
      entryIds: [],
      values: { timeout: 5 },
      profile: 'default',
    })

    expect(updates).toEqual([{ ns: 'demo-plugin', patch: { timeout: 5 } }])
  })

  it('never writes sensitive values and never touches a service for them', async () => {
    let editCalls = 0
    let updateCalls = 0
    const editor = makeEditor({
      edit: () => {
        editCalls += 1
      },
    })
    const settings = makeSettings({
      update: () => {
        updateCalls += 1
      },
    })

    await gateway({ configEditor: editor, settings }).write({
      moduleName: 'demo-plugin',
      entryIds: [],
      values: {
        apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
        password: 'hunter2',
        authorization: 'Bearer abcdefghijklmnopqrstuvwxyz',
      },
      profile: 'default',
    })

    expect(editCalls).toBe(0)
    expect(updateCalls).toBe(0)
  })

  it('rejects non-JSON values with invalid-config', async () => {
    const editor = makeEditor({ edit: () => undefined })
    const configGateway = gateway({ configEditor: editor })

    await expect(
      configGateway.write({
        moduleName: 'demo-plugin',
        entryIds: [],
        values: { bad: undefined as unknown as JsonValue },
        profile: 'default',
      }),
    ).rejects.toMatchObject({ name: 'SyncError', code: 'invalid-config' })

    await expect(
      configGateway.write({
        moduleName: 'demo-plugin',
        entryIds: [],
        values: { bad: (() => undefined) as unknown as JsonValue },
        profile: 'default',
      }),
    ).rejects.toMatchObject({ name: 'SyncError', code: 'invalid-config' })
  })

  it('throws unsupported when neither Host write path exists', async () => {
    await expect(
      gateway({}).write({
        moduleName: 'demo-plugin',
        entryIds: [],
        values: { timeout: 5 },
        profile: 'default',
      }),
    ).rejects.toMatchObject({ name: 'SyncError', code: 'unsupported' })
  })

  it('falls back to settings when the config editor throws', async () => {
    const updates: Array<{ ns: string; patch: object }> = []
    const editor = makeEditor({
      configuration: () => {
        throw new Error('broken loader')
      },
      entries: () => {
        throw new Error('broken loader')
      },
    })
    const settings = makeSettings({
      update: (ns, patch) => {
        updates.push({ ns, patch })
      },
    })

    await gateway({ configEditor: editor, settings }).write({
      moduleName: 'demo-plugin',
      entryIds: [],
      values: { timeout: 5 },
      profile: 'default',
    })
    expect(updates).toEqual([{ ns: 'demo-plugin', patch: { timeout: 5 } }])
  })
})
