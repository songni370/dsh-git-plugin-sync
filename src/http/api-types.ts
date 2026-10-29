/**
 * Wire contract between the Host half and the Web settings page.
 *
 * The browser fetches `api/dsh-plugins-git-sync/<name>` (same origin, through the
 * Host connection's authenticated shared channel), POSTs JSON, and receives
 * `{ ok: true, value }` or `{ ok: false, error }`. Types here are shared with the
 * client sources by `import type` only, so nothing in this file reaches the
 * browser bundle.
 * @module http/api-types
 */

import type {
  ConflictResolution,
  ConnectionTestResult,
  DeviceInfo,
  HistoryEntry,
  JsonValue,
  LastOperation,
  LogEntry,
  OperationResult,
  PluginDiff,
  PluginRecord,
  RemotePluginEntry,
  StatusView,
  SyncConfig,
  SyncConfigView,
  SyncPlan,
  SyncState,
} from '../types.js'

/** Route prefix shared by every endpoint. */
export const API_PREFIX = '/api/dsh-plugins-git-sync'

/** Error body. */
export interface ApiError {
  code: string
  message: string
  details?: JsonValue
}

/** Success envelope. */
export interface ApiOk<T> {
  ok: true
  value: T
}

/** Failure envelope. */
export interface ApiFail {
  ok: false
  error: ApiError
}

/** Every response. */
export type ApiResult<T> = ApiOk<T> | ApiFail

/** GET/POST status payload. */
export interface StatusPayload {
  status: StatusView
  /** Recent log entries for the status card. */
  logs: LogEntry[]
}

/** Config as edited by the settings page. */
export type SaveConfigRequest = { config: Partial<SyncConfig> }

/** Result of saving configuration. */
export interface SaveConfigResponse {
  config: SyncConfigView
}

/** Repository connectivity test. */
export interface TestConnectionRequest {
  /** Optional unsaved configuration to test before saving. */
  config?: Partial<SyncConfig>
}

/** Repository connectivity test response. */
export type TestConnectionResponse = ConnectionTestResult

/** One row the plugin list shows. */
export interface PluginListRow {
  id: string
  name: string
  displayName?: string
  local?: PluginRecord
  remote?: RemotePluginEntry
  /** Which side(s) provide the plugin. */
  presence: 'local' | 'remote' | 'both'
  version: string | null
  remoteVersion: string | null
  enabled: boolean
  remoteEnabled: boolean | null
  syncStatus: 'synced' | 'local-only' | 'remote-only' | 'version-diff' | 'config-diff' | 'enabled-diff' | 'conflict' | 'excluded'
  inSync: boolean
  syncable: boolean
  selected: boolean
  conflict?: boolean
  diff?: PluginDiff
}

/** Plugin list response. */
export interface PluginListResponse {
  rows: PluginListRow[]
  activeProfile: string
  availableProfiles: string[]
}

/** Diff/preview request. */
export interface DiffRequest {
  /** Which operation to preview; defaults to a two-way sync. */
  direction?: 'push' | 'pull' | 'two-way'
  /** Compare against a history commit (restore direction only). */
  commit?: string
}

/** Diff response: the plan a restore or sync would execute, without doing it. */
export interface DiffResponse {
  direction: 'push' | 'pull' | 'two-way'
  plan: SyncPlan
}

/** Backup request. */
export interface BackupRequest {
  /** Optional user message appended to the commit subject. */
  message?: string
  /** Set after the user confirmed a plan flagged as destructive. */
  confirmDestructive?: boolean
}

/** Backup/sync/restore execution response. */
export type OperationResponse = OperationResult

/** Restore preview request. */
export interface RestorePreviewRequest {
  /** Commit to restore from; omitted means the branch head. */
  commit?: string
}

/** Restore preview response. */
export interface RestorePreviewResponse {
  plan: SyncPlan
  /** Local snapshot that will be created before any destructive action. */
  snapshotPlanned: boolean
  source: { commit: string | null; updatedAt: string | null }
}

/** Restore request. */
export interface RestoreRequest {
  /** Commit to restore from; omitted means the branch head. */
  commit?: string
  /** Plugins the user selected for restore (omitted = every planned plugin). */
  pluginIds?: string[]
  /** Conflict decisions resolved in the preview. */
  resolutions?: ConflictResolution[]
  /** Explicit confirmation for destructive actions. */
  confirmDestructive?: boolean
}

/** Sync preview request. */
export interface SyncPreviewRequest {
  /** Include repository information in the preview even when it costs a fetch. */
  refresh?: boolean
}

/** Sync preview response. */
export type SyncPreviewResponse = DiffResponse

/** Sync request. */
export interface SyncRequest {
  resolutions?: ConflictResolution[]
  confirmDestructive?: boolean
}

/** History request. */
export interface HistoryRequest {
  limit?: number
}

/** History response. */
export interface HistoryResponse {
  entries: HistoryEntry[]
  lastOperation: LastOperation | null
}

/** Rollback (restore a history commit) request. */
export interface RollbackRequest {
  commit: string
  resolutions?: ConflictResolution[]
  confirmDestructive?: boolean
}

/** Auto-sync request. */
export interface AutoSyncRequest {
  enabled: boolean
  mode?: 'two-way' | 'backup' | 'restore'
  intervalMinutes?: number
  startupDelayMs?: number
  onStartup?: boolean
  onPluginChange?: boolean
  debounceMs?: number
}

/** Auto-sync response. */
export interface AutoSyncResponse {
  status: StatusView
}

/** Logs request. */
export interface LogsRequest {
  limit?: number
}

/** Logs response. */
export interface LogsResponse {
  entries: LogEntry[]
}

/** Overview payload used by the first render. */
export interface OverviewResponse extends StatusPayload {
  device: DeviceInfo
  /** Schema version of the backup manifest understood by this plugin. */
  manifestSchemaVersion: number
  /** Plugin version. */
  pluginVersion: number | string
}

/** Request handler map keyed by route name (no `/api` prefix). */
export type ApiRouteName =
  | 'status'
  | 'config/save'
  | 'connection/test'
  | 'plugins/list'
  | 'diff'
  | 'backup'
  | 'restore/preview'
  | 'restore'
  | 'sync/preview'
  | 'sync'
  | 'history'
  | 'rollback'
  | 'auto-sync'
  | 'logs'

/** A sync state alias for the UI. */
export type { SyncState }
