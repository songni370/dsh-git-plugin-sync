/**
 * Unit tests for the six agent tools: names and parameters are part of the
 * model contract, results must be lossless JSON (the registry rejects explicit
 * `undefined` values), and destructive work is two-phase.
 */

import { describe, expect, it } from 'vitest'
import { buildToolDefinitions } from '../../src/tools/tools.js'
import { isJsonValue } from '../../src/core/json.js'
import { SyncError } from '../../src/core/errors.js'
import type { SyncEngine } from '../../src/services/engine.js'

/** A fake engine that records calls and returns plan-shaped results. */
function fakeEngine(overrides: Record<string, unknown> = {}): { engine: SyncEngine; calls: string[] } {
  const calls: string[] = []
  const base: Record<string, unknown> = {
    status: async () => {
      calls.push('status')
      return {
        status: {
          state: 'ahead',
          config: { repoUrl: '', branch: 'main' },
          branch: 'main',
          lastSyncAt: null,
          lastCommit: null,
          lastOperation: null,
          localPluginCount: 1,
          remotePluginCount: null,
          pendingUploads: 1,
          pendingDownloads: 0,
          conflictCount: 0,
          lastError: null,
          busy: false,
          connection: null,
        },
        logs: [],
      }
    },
    diff: async () => {
      calls.push('diff')
      return {
        direction: 'two-way',
        plan: {
          direction: 'two-way',
          profile: 'desktop',
          generatedAt: '2026-01-01T00:00:00.000Z',
          actions: [{
            kind: 'push-plugin',
            pluginId: 'alpha',
            pluginName: 'alpha',
            detail: 'add',
            destructive: false,
            // Explicit undefined values are the reason the tool must project.
            installSpec: undefined,
            version: undefined,
          }],
          conflicts: [],
          diffs: [],
          requiresConfirmation: false,
          warnings: [],
          localPluginCount: 1,
          remotePluginCount: 0,
        },
      }
    },
    backup: async () => {
      calls.push('backup')
      return {
        ok: true,
        operation: 'backup',
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:01.000Z',
        commit: 'abc',
        pushed: true,
        noChanges: false,
        actionOutcomes: [],
        warnings: [],
        snapshot: undefined,
      }
    },
    previewRestore: async () => {
      calls.push('previewRestore')
      return {
        plan: {
          direction: 'pull',
          profile: 'desktop',
          generatedAt: '2026-01-01T00:00:00.000Z',
          actions: [],
          conflicts: [{
            id: 'conflict:alpha',
            pluginId: 'alpha',
            pluginName: 'alpha',
            reason: 'both-changed',
            fields: ['version'],
            localVersion: '1.0.0',
            remoteVersion: '1.1.0',
            localEnabled: true,
            remoteEnabled: true,
            remoteDevice: undefined,
          }],
          diffs: [],
          requiresConfirmation: false,
          warnings: [],
          localPluginCount: 0,
          remotePluginCount: 1,
        },
        snapshotPlanned: false,
        source: { commit: null, updatedAt: null },
      }
    },
    restore: async () => {
      calls.push('restore')
      return { ok: true, operation: 'restore', startedAt: '', finishedAt: '', actionOutcomes: [], warnings: [], error: undefined }
    },
    previewSync: async () => {
      calls.push('previewSync')
      return {
        plan: {
          direction: 'two-way',
          profile: 'desktop',
          generatedAt: '2026-01-01T00:00:00.000Z',
          actions: [],
          conflicts: [],
          diffs: [],
          requiresConfirmation: false,
          warnings: [],
          localPluginCount: 0,
          remotePluginCount: 0,
        },
      }
    },
    sync: async () => {
      calls.push('sync')
      return { ok: true, operation: 'sync', startedAt: '', finishedAt: '', actionOutcomes: [], warnings: [] }
    },
    history: async () => {
      calls.push('history')
      return {
        entries: [{ commit: 'abc', shortCommit: 'abc', date: '', author: '', subject: 'backup', operation: 'backup' }],
        lastOperation: null,
      }
    },
    listSnapshots: async () => [],
  }
  const engine = { ...base, ...overrides } as unknown as SyncEngine
  return { engine, calls }
}

/** Find one tool definition by name. */
async function toolOf(engine: SyncEngine, name: string) {
  const definitions = buildToolDefinitions(engine)
  const found = definitions.find(definition => definition.name === name)
  if (found === undefined) throw new Error(`tool ${name} missing`)
  return found
}

describe('agent tools', () => {
  it('registers exactly the six documented tools', () => {
    const { engine } = fakeEngine()
    const names = buildToolDefinitions(engine).map(definition => definition.name).sort()
    expect(names).toEqual([
      'dsh_git_plugin_backup',
      'dsh_git_plugin_diff',
      'dsh_git_plugin_history',
      'dsh_git_plugin_restore',
      'dsh_git_plugin_status',
      'dsh_git_plugin_sync',
    ])
    for (const definition of buildToolDefinitions(engine)) {
      expect(definition.description.length).toBeGreaterThan(40)
      expect(typeof definition.parameters).toBe('object')
      expect(definition.output.schema).toEqual({ type: 'object' })
      expect(typeof definition.execute).toBe('function')
    }
  })

  it('returns lossless JSON for every tool result', async () => {
    const { engine } = fakeEngine()
    const cases: [string, Record<string, unknown>][] = [
      ['dsh_git_plugin_status', {}],
      ['dsh_git_plugin_diff', { direction: 'push' }],
      ['dsh_git_plugin_backup', { confirm: true }],
      ['dsh_git_plugin_restore', {}],
      ['dsh_git_plugin_restore', { confirm: true }],
      ['dsh_git_plugin_sync', {}],
      ['dsh_git_plugin_sync', { confirm: true }],
      ['dsh_git_plugin_history', { limit: 5 }],
    ]
    for (const [name, args] of cases) {
      const definition = await toolOf(engine, name)
      const result = await definition.execute(args, { signal: undefined })
      expect(isJsonValue(result), `${name} ${JSON.stringify(args)}`).toBe(true)
    }
  })

  it('previews restore and sync without executing until confirmed', async () => {
    const { engine, calls } = fakeEngine()
    const restore = await toolOf(engine, 'dsh_git_plugin_restore')
    await restore.execute({}, { signal: undefined })
    expect(calls).toContain('previewRestore')
    expect(calls).not.toContain('restore')

    const sync = await toolOf(engine, 'dsh_git_plugin_sync')
    await sync.execute({}, { signal: undefined })
    expect(calls).toContain('previewSync')
    expect(calls).not.toContain('sync')

    await sync.execute({ confirm: true }, { signal: undefined })
    expect(calls).toContain('sync')
  })

  it('turns a confirmation requirement into a reviewable plan', async () => {
    const { engine } = fakeEngine({
      backup: async () => {
        throw new SyncError('confirmation-required', 'destructive plan', {
          details: { plan: { direction: 'push', actions: [{ kind: 'remove-remote', pluginId: 'alpha', pluginName: 'alpha', detail: 'x', destructive: true }] } },
        })
      },
    })
    const backup = await toolOf(engine, 'dsh_git_plugin_backup')
    const result = (await backup.execute({}, { signal: undefined })) as Record<string, unknown>
    expect(result.ok).toBe(true)
    expect(result.requiresConfirmation).toBe(true)
    expect(result.plan).toBeDefined()
    expect(isJsonValue(result)).toBe(true)
  })

  it('reports engine failures as structured results instead of throwing', async () => {
    const { engine } = fakeEngine({
      status: async () => {
        throw new SyncError('not-configured', 'no repository configured')
      },
    })
    const status = await toolOf(engine, 'dsh_git_plugin_status')
    const result = (await status.execute({}, { signal: undefined })) as { ok: boolean; error?: { code: string } }
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('not-configured')
  })
})
