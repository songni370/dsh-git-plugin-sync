/**
 * Host-side HTTP routes for the Web settings page.
 *
 * Routes are registered on the Host connection's authenticated shared channel
 * (`connection.fetch.register`), so they inherit the deployment's Host/Origin
 * fence and browser authentication instead of inventing a second gate. Every
 * route is POST + JSON; responses use one envelope, `{ ok, value }` or
 * `{ ok, error }`, which the client parses once.
 * @module http/routes
 */

import { SyncError, errorMessage, toSyncError } from '../core/errors.js'
import { safeJsonCopy } from '../services/engine-utils.js'
import { API_PREFIX } from './api-types.js'
import type { ApiError } from './api-types.js'
import type { DshConnection, DshContext, DshDisposer } from '../dsh.js'
import type { SyncEngine } from '../services/engine.js'
import type { ConflictResolution, JsonObject, SyncLogger } from '../types.js'
import { isJsonValue } from '../core/json.js'

/** Maximum JSON body accepted by one route. */
const MAX_BODY_BYTES = 1024 * 1024

/** Callback used by every route. */
type Handler = (body: Record<string, unknown>) => Promise<unknown>

/** JSON response helper. */
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  })
}

/** Error envelope. */
function failure(error: SyncError): Response {
  const apiError: ApiError = { code: error.code, message: error.message }
  if (error.details !== undefined) apiError.details = safeJsonCopy(error.details)
  return json({ ok: false, error: apiError })
}

/** Read and validate one JSON body. */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) {
    throw new SyncError('invalid-config', '请求内容过大 / request body too large')
  }
  if (text.trim() === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new SyncError('invalid-config', '请求内容不是合法 JSON / request body is not JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SyncError('invalid-config', '请求内容必须是 JSON 对象 / request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

/** Build a request-scoped abort signal from the request. */
function requestSignal(request: Request): AbortSignal {
  return request.signal
}

/** Register every route; returns a disposer removing all of them. */
export function registerHttpRoutes(options: { ctx: DshContext; engine: SyncEngine; logger: SyncLogger }): DshDisposer {
  const disposers: DshDisposer[] = []
  let disposed = false
  const routeDisposer = options.ctx.inject(['connection'], scoped => {
    const connection = scoped.get('connection') as DshConnection | undefined
    const fetchRegistry = connection?.fetch
    if (fetchRegistry === undefined || typeof fetchRegistry.register !== 'function') {
      options.logger.warn('Web 设置页不可用：缺少 connection 服务 / settings page unavailable: no connection service')
      return
    }
    const handlers: Record<string, Handler> = {
      status: async body => {
        const result = await options.engine.status({ refresh: body.refresh === true })
        return result
      },
      'config/save': async body => options.engine.saveConfig(asObject(body.config) as never),
      'connection/test': async body => options.engine.testConnection(asObject(body.config) as never),
      'plugins/list': async () => options.engine.listPlugins(),
      diff: async body => options.engine.diff({
        direction: body.direction === 'push' || body.direction === 'pull' || body.direction === 'two-way' ? body.direction : 'two-way',
        commit: typeof body.commit === 'string' ? body.commit : undefined,
      }),
      backup: async body => options.engine.backup({
        message: typeof body.message === 'string' ? body.message : undefined,
        confirmDestructive: body.confirmDestructive === true,
      }),
      'restore/preview': async body => options.engine.previewRestore({ commit: typeof body.commit === 'string' ? body.commit : undefined }),
      restore: async body => options.engine.restore({
        commit: typeof body.commit === 'string' ? body.commit : undefined,
        pluginIds: Array.isArray(body.pluginIds) ? body.pluginIds.filter((id): id is string => typeof id === 'string') : undefined,
        resolutions: asResolutions(body.resolutions),
        confirmDestructive: body.confirmDestructive === true,
      }),
      'sync/preview': async () => {
        const preview = await options.engine.previewSync()
        return { direction: 'two-way' as const, plan: preview.plan }
      },
      sync: async body => options.engine.sync({
        resolutions: asResolutions(body.resolutions),
        confirmDestructive: body.confirmDestructive === true,
      }),
      history: async body => options.engine.history({ limit: typeof body.limit === 'number' ? body.limit : undefined }),
      rollback: async body => {
        if (typeof body.commit !== 'string' || body.commit.trim() === '') {
          throw new SyncError('invalid-config', '缺少提交标识 / commit is required')
        }
        return options.engine.rollback({
          commit: body.commit,
          resolutions: asResolutions(body.resolutions),
          confirmDestructive: body.confirmDestructive === true,
        })
      },
      'auto-sync': async body => options.engine.setAutoSync({
        enabled: body.enabled === true,
        mode: body.mode === 'two-way' || body.mode === 'backup' || body.mode === 'restore' ? body.mode : undefined,
        intervalMinutes: typeof body.intervalMinutes === 'number' ? body.intervalMinutes : undefined,
        startupDelayMs: typeof body.startupDelayMs === 'number' ? body.startupDelayMs : undefined,
        onStartup: typeof body.onStartup === 'boolean' ? body.onStartup : undefined,
        onPluginChange: typeof body.onPluginChange === 'boolean' ? body.onPluginChange : undefined,
        debounceMs: typeof body.debounceMs === 'number' ? body.debounceMs : undefined,
      }),
      logs: async body => options.engine.logs({ limit: typeof body.limit === 'number' ? body.limit : undefined }),
    }

    for (const [name, handler] of Object.entries(handlers)) {
      const path = `${API_PREFIX}/${name}`
      disposers.push(
        fetchRegistry.register({
          path,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request: Request): Promise<Response> => {
            try {
              const body = await readBody(request)
              if (request.signal.aborted) return failure(new SyncError('cancelled', '请求已取消 / request cancelled'))
              const value = await handler(body)
              return json({ ok: true, value })
            } catch (error) {
              const syncError = toSyncError(error)
              if (syncError.code === 'internal') options.logger.error(`API 失败 / API failure: ${name}: ${syncError.message}`)
              else options.logger.debug(`API 拒绝 / API refusal: ${name}: ${syncError.code}`)
              return failure(syncError)
            }
          },
        }),
      )
    }
    options.logger.info(`已注册 ${Object.keys(handlers).length} 个 Web 设置页接口 / registered settings-page routes`)
  })

  return () => {
    disposed = true
    void routeDisposer()
    for (const disposer of disposers.splice(0)) {
      try {
        void disposer()
      } catch {
        // Disposal is best-effort; the owning fiber already tears down.
      }
    }
    if (!disposed) options.logger.debug('routes disposed')
  }
}

/** Narrow an unknown to an object record. */
function asObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Parse user conflict decisions. */
function asResolutions(value: unknown): ConflictResolution[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: ConflictResolution[] = []
  for (const item of value) {
    const raw = asObject(item)
    if (raw === null || raw === undefined) continue
    if (typeof raw.pluginId !== 'string' || raw.pluginId === '') continue
    const choice = raw.choice
    if (choice !== 'local' && choice !== 'remote' && choice !== 'skip' && choice !== 'manual') continue
    const entry: ConflictResolution = { pluginId: raw.pluginId, choice }
    const manual = asObject(raw.manualConfig)
    if (manual !== undefined && isJsonValue(manual)) entry.manualConfig = manual as JsonObject
    out.push(entry)
  }
  return out.length === 0 ? undefined : out
}

/** Exported for tests: map any throwable to the wire envelope. */
export function toErrorEnvelope(error: unknown): { ok: false; error: ApiError } {
  if (error instanceof SyncError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: safeJsonCopy(error.details) }),
      },
    }
  }
  return { ok: false, error: { code: 'internal', message: errorMessage(error) } }
}
