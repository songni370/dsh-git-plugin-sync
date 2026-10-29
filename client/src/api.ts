/**
 * Typed client for the Host half's HTTP contract.
 *
 * The only contract this file knows is `src/http/api-types.ts` — every request
 * and response shape is imported from there with `import type`, so the browser
 * bundle never carries a byte of the Host sources but a contract change breaks
 * `tsc` instead of silently breaking the page.
 *
 * Wire rules (see api-types.ts):
 *  - every route is POSTed relative to the page (`api/dsh-plugins-git-sync/...`),
 *    through the Host connection's authenticated same-origin channel;
 *  - the body is JSON, `{ ok: true, value }` on success and
 *    `{ ok: false, error: { code, message } }` on failure;
 *  - `error.message` is already localized by the Host. The UI shows it VERBATIM
 *    and never wraps it in invented copy, so a new Host message needs no client
 *    change.
 * @module api
 */

import type {
  ApiError,
  ApiResult,
  AutoSyncRequest,
  AutoSyncResponse,
  BackupRequest,
  DiffRequest,
  DiffResponse,
  HistoryRequest,
  HistoryResponse,
  LogsRequest,
  LogsResponse,
  OperationResponse,
  PluginListResponse,
  RestorePreviewRequest,
  RestorePreviewResponse,
  RestoreRequest,
  RollbackRequest,
  SaveConfigRequest,
  SaveConfigResponse,
  StatusPayload,
  SyncPreviewResponse,
  SyncRequest,
  TestConnectionRequest,
  TestConnectionResponse,
} from '../../src/http/api-types'
import type { SyncPlan } from '../../src/types'

/** Route prefix, relative to the page the UI is served from. */
const PREFIX = 'api/dsh-plugins-git-sync'

/**
 * A failed Host call, carrying the Host's machine code so a caller can branch
 * on it when it has to, and its localized message for display.
 */
export class ApiRequestError extends Error {
  /** Machine-readable code from the Host envelope, or a transport code. */
  readonly code: string
  /** Structured details, when the Host sent any. */
  readonly details: unknown

  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiRequestError'
    this.code = code
    this.details = details
  }
}

/**
 * Turn any thrown value into text fit for the page.
 * A transport failure has no localized Host message, so its `ApiRequestError`
 * carries the browser's wording; everything else falls back to `String`.
 */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** How long one Host call may take before the UI reports a timeout. */
const REQUEST_TIMEOUT_MS = 20_000

/** POST one route and unwrap the Host envelope. */
async function request<T>(route: string, body: unknown = {}): Promise<T> {
  let response: Response
  // A hung route must surface as an error instead of an endless loading state.
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    response = await fetch(`${PREFIX}/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      credentials: 'same-origin',
      signal: controller.signal,
    })
  } catch (error) {
    // Offline, Host restarting, proxy dropped the connection, or our timeout.
    const message = controller.signal.aborted ? '请求超时 / request timed out' : errorText(error)
    throw new ApiRequestError(controller.signal.aborted ? 'timeout' : 'network', message)
  } finally {
    window.clearTimeout(timer)
  }

  let payload: ApiResult<T> | null = null
  try {
    payload = (await response.json()) as ApiResult<T>
  } catch {
    payload = null
  }

  if (payload !== null) {
    if (payload.ok === true) return payload.value
    const failure: ApiError | undefined = payload.error
    throw new ApiRequestError(
      failure?.code ?? 'unknown',
      failure?.message ?? `HTTP ${response.status}`,
      failure?.details,
    )
  }

  // A non-envelope body (HTML error page, empty 204, ...) — surface the status.
  throw new ApiRequestError('bad-response', `HTTP ${response.status} ${response.statusText}`.trim())
}

/** Current status, recent logs, and the effective configuration. */
export function getStatus(): Promise<StatusPayload> {
  return request<StatusPayload>('status')
}

/** Persist a partial configuration; the Host answers with the effective view. */
export function saveConfig(body: SaveConfigRequest): Promise<SaveConfigResponse> {
  return request<SaveConfigResponse>('config/save', body)
}

/** Check repository reachability, optionally with unsaved field values. */
export function testConnection(body: TestConnectionRequest = {}): Promise<TestConnectionResponse> {
  return request<TestConnectionResponse>('connection/test', body)
}

/** Local plugins joined with the repository's shared state. */
export function getPlugins(): Promise<PluginListResponse> {
  return request<PluginListResponse>('plugins/list')
}

/** Direction a difference preview is computed for (`DiffRequest.direction`). */
export type DiffDirection = NonNullable<DiffRequest['direction']>

/** Preview the plan an operation would execute, without executing it. */
export function getDiff(body: DiffRequest = {}): Promise<DiffResponse> {
  return request<DiffResponse>('diff', body)
}

/** Commit the local inventory to the repository and push. */
export function backup(body: BackupRequest = {}): Promise<OperationResponse> {
  return request<OperationResponse>('backup', body)
}

/**
 * The `SyncPlan` carried by a confirmation / conflict error envelope.
 *
 * `/backup`, `/restore`, `/sync`, and `/rollback` refuse a plan that needs
 * acknowledgement or that has unresolved conflicts by failing with
 * `{ ok: false, error: { code: 'confirmation-required' | 'conflict-present',
 * message, details: { plan } } }`. The page renders that plan, then re-calls
 * with `confirmDestructive: true` and `resolutions`. Returns null for any
 * other failure so callers can keep the plain error path.
 */
export function planFromError(error: unknown): SyncPlan | null {
  if (!(error instanceof ApiRequestError)) return null
  if (error.code !== 'confirmation-required' && error.code !== 'conflict-present') return null
  const details = error.details
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return null
  const plan = (details as Record<string, unknown>).plan
  return isSyncPlan(plan) ? plan : null
}

/** Structural check for a plan carried over the wire. */
function isSyncPlan(value: unknown): value is SyncPlan {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const plan = value as Record<string, unknown>
  return (
    (plan.direction === 'push' || plan.direction === 'pull' || plan.direction === 'two-way') &&
    Array.isArray(plan.actions) &&
    Array.isArray(plan.conflicts) &&
    Array.isArray(plan.warnings)
  )
}

/** Preview what restoring the repository head (or one commit) would do. */
export function previewRestore(body: RestorePreviewRequest = {}): Promise<RestorePreviewResponse> {
  return request<RestorePreviewResponse>('restore/preview', body)
}

/** Apply a restore; `confirmDestructive` acknowledges the previewed removals. */
export function restore(body: RestoreRequest = {}): Promise<OperationResponse> {
  return request<OperationResponse>('restore', body)
}

/** Preview a two-way sync. */
export function previewSync(): Promise<SyncPreviewResponse> {
  return request<SyncPreviewResponse>('sync/preview', { refresh: true })
}

/** Apply a two-way sync. */
export function sync(body: SyncRequest = {}): Promise<OperationResponse> {
  return request<OperationResponse>('sync', body)
}

/** Recent backup-repository commits plus the last operation. */
export function getHistory(body: HistoryRequest = {}): Promise<HistoryResponse> {
  return request<HistoryResponse>('history', body)
}

/** Restore the local side from one historical commit. */
export function rollback(body: RollbackRequest): Promise<OperationResponse> {
  return request<OperationResponse>('rollback', body)
}

/** Persist the automatic-sync settings. */
export function saveAutoSync(body: AutoSyncRequest): Promise<AutoSyncResponse> {
  return request<AutoSyncResponse>('auto-sync', body)
}

/** Recent Host log entries (already redacted by the Host). */
export function getLogs(body: LogsRequest = {}): Promise<LogsResponse> {
  return request<LogsResponse>('logs', body)
}
