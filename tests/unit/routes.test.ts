/**
 * Unit tests for the Host HTTP surface: one envelope for every route, JSON body
 * validation, and the confirmation payload that keeps destructive actions
 * behind an explicit decision.
 */

import { describe, expect, it } from 'vitest'
import { registerHttpRoutes, toErrorEnvelope } from '../../src/http/routes.js'
import { SyncError } from '../../src/core/errors.js'
import { silentLogger } from '../../src/core/logger.js'
import type { DshContext } from '../../src/dsh.js'
import type { SyncEngine } from '../../src/services/engine.js'

/** Captured route definition usable through a real Request. */
interface CapturedRoute {
  path: string
  methods: readonly string[]
  requestBody: string
  fetch: (request: Request) => Promise<Response>
}

/** Build a fake Host context whose connection captures registered routes. */
function fakeContext(routes: CapturedRoute[]): DshContext {
  const logger = silentLogger()
  const services: Record<string, unknown> = {
    connection: {
      fetch: {
        register: (route: CapturedRoute) => {
          routes.push(route)
          return () => undefined
        },
      },
    },
  }
  const ctx: DshContext = {
    logger: {
      debug: (...args) => logger.debug(String(args[0]), undefined),
      info: (...args) => logger.info(String(args[0]), undefined),
      warn: (...args) => logger.warn(String(args[0]), undefined),
      error: (...args) => logger.error(String(args[0]), undefined),
    },
    get: name => services[name] as never,
    inject: (_deps, callback) => {
      callback(ctx)
      return () => undefined
    },
    effect: callback => {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => undefined
    },
    on: () => () => undefined,
    timeout: () => () => undefined,
    interval: () => () => undefined,
  }
  return ctx
}

/** Fake engine for the route layer. */
function fakeEngine(overrides: Record<string, unknown> = {}): SyncEngine {
  const base: Record<string, unknown> = {
    status: async () => ({ status: { state: 'not-configured' }, logs: [] }),
    saveConfig: async () => ({ config: {} }),
    testConnection: async () => ({ ok: true, at: '', message: 'ok' }),
    listPlugins: async () => ({ rows: [], activeProfile: 'desktop', availableProfiles: ['desktop'] }),
    diff: async () => ({ direction: 'push', plan: { direction: 'push', actions: [], conflicts: [] } }),
    backup: async () => ({ ok: true, operation: 'backup' }),
    previewRestore: async () => ({ plan: { direction: 'pull', actions: [], conflicts: [] }, snapshotPlanned: false, source: { commit: null, updatedAt: null } }),
    restore: async () => ({ ok: true, operation: 'restore' }),
    previewSync: async () => ({ plan: { direction: 'two-way', actions: [], conflicts: [] } }),
    sync: async () => ({ ok: true, operation: 'sync' }),
    history: async () => ({ entries: [], lastOperation: null }),
    rollback: async () => ({ ok: true, operation: 'rollback' }),
    setAutoSync: async () => ({ status: { state: 'synced' } }),
    logs: () => ({ entries: [] }),
  }
  return { ...base, ...overrides } as unknown as SyncEngine
}

/** Register routes and return them by name. */
function routesOf(engine: SyncEngine): Map<string, CapturedRoute> {
  const routes: CapturedRoute[] = []
  registerHttpRoutes({ ctx: fakeContext(routes), engine, logger: silentLogger() })
  const map = new Map<string, CapturedRoute>()
  for (const route of routes) map.set(route.path.replace('/api/dsh-plugins-git-sync/', ''), route)
  return map
}

/** POST one route with a JSON body. */
async function post(route: CapturedRoute, body: string): Promise<Response> {
  return route.fetch(new Request(`http://127.0.0.1:1${route.path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  }))
}

describe('HTTP surface', () => {
  it('registers the documented routes as POST-only JSON endpoints', () => {
    const routes = routesOf(fakeEngine())
    expect(routes.size).toBe(14)
    for (const [name, route] of routes) {
      expect(route.path.startsWith('/api/dsh-plugins-git-sync/'), name).toBe(true)
      expect(route.methods).toEqual(['POST'])
      expect(route.requestBody).toBe('buffered')
    }
    expect(routes.has('status')).toBe(true)
    expect(routes.has('config/save')).toBe(true)
    expect(routes.has('restore/preview')).toBe(true)
    expect(routes.has('auto-sync')).toBe(true)
  })

  it('answers success with { ok: true, value }', async () => {
    const routes = routesOf(fakeEngine())
    const response = await post(routes.get('status') as CapturedRoute, '{}')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const payload = (await response.json()) as { ok: boolean; value: unknown }
    expect(payload.ok).toBe(true)
    expect(payload.value).toBeDefined()
  })

  it('rejects malformed bodies with a structured error envelope', async () => {
    const routes = routesOf(fakeEngine())
    const invalid = await post(routes.get('diff') as CapturedRoute, '{ nope')
    const invalidPayload = (await invalid.json()) as { ok: boolean; error: { code: string } }
    expect(invalidPayload.ok).toBe(false)
    expect(invalidPayload.error.code).toBe('invalid-config')

    const notObject = await post(routes.get('diff') as CapturedRoute, '[]')
    const notObjectPayload = (await notObject.json()) as { ok: boolean; error: { code: string } }
    expect(notObjectPayload.error.code).toBe('invalid-config')
  })

  it('passes the direction through and returns the documented shape', async () => {
    const routes = routesOf(fakeEngine())
    const response = await post(routes.get('diff') as CapturedRoute, '{"direction":"push"}')
    const payload = (await response.json()) as { ok: boolean; value: { direction: string } }
    expect(payload.ok).toBe(true)
    expect(payload.value.direction).toBe('push')

    const syncPreview = await post(routes.get('sync/preview') as CapturedRoute, '{}')
    const syncPayload = (await syncPreview.json()) as { ok: boolean; value: { direction: string; plan: unknown } }
    expect(syncPayload.value.direction).toBe('two-way')
    expect(syncPayload.value.plan).toBeDefined()
  })

  it('returns confirmation details with the plan for destructive operations', async () => {
    const plan = {
      direction: 'push',
      profile: 'desktop',
      generatedAt: '2026-01-01T00:00:00.000Z',
      actions: [{ kind: 'remove-remote', pluginId: 'alpha', pluginName: 'alpha', detail: 'x', destructive: true }],
      conflicts: [],
      diffs: [],
      requiresConfirmation: true,
      warnings: [],
      localPluginCount: 1,
      remotePluginCount: 1,
    }
    const engine = fakeEngine({
      backup: async () => {
        throw new SyncError('confirmation-required', '需要确认', { details: { plan } })
      },
    })
    const routes = routesOf(engine)
    const response = await post(routes.get('backup') as CapturedRoute, '{}')
    const payload = (await response.json()) as {
      ok: boolean
      error: { code: string; details: { plan: { actions: unknown[] } } }
    }
    expect(payload.ok).toBe(false)
    expect(payload.error.code).toBe('confirmation-required')
    expect(payload.error.details.plan.actions).toHaveLength(1)
  })

  it('maps unknown failures to the internal code without leaking details', () => {
    const envelope = toErrorEnvelope(new Error('boom'))
    expect(envelope.ok).toBe(false)
    expect(envelope.error.code).toBe('internal')
  })
})
