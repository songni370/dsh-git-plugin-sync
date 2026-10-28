/**
 * Typed errors with stable machine codes.
 *
 * The HTTP surface and the agent tools both map these codes to a message; the
 * code is what a caller inspects, the message is what a user reads. Messages
 * never contain credentials.
 * @module core/errors
 */

/** Stable error codes surfaced to the UI and to agent tools. */
export type SyncErrorCode =
  | 'not-configured'
  | 'invalid-config'
  | 'invalid-path'
  | 'invalid-manifest'
  | 'git-not-found'
  | 'git-failed'
  | 'git-auth-failed'
  | 'git-network'
  | 'git-conflict'
  | 'git-push-rejected'
  | 'repo-empty'
  | 'busy'
  | 'unsupported'
  | 'cancelled'
  | 'install-failed'
  | 'conflict-present'
  | 'confirmation-required'
  | 'snapshot-failed'
  | 'internal'

/** Error carrying a stable code and optional retry hint. */
export class SyncError extends Error {
  readonly code: SyncErrorCode
  readonly retryable: boolean
  readonly details?: Record<string, unknown>

  constructor(
    code: SyncErrorCode,
    message: string,
    options: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'SyncError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.details = options.details
  }
}

/** Normalize any thrown value into a user-facing message. */
export function errorMessage(error: unknown): string {
  if (error instanceof SyncError) return error.message
  if (error instanceof Error) return error.message === '' ? error.name : error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return 'unknown error'
  }
}

/** Normalize any thrown value into a SyncError. */
export function toSyncError(error: unknown, fallbackCode: SyncErrorCode = 'internal'): SyncError {
  if (error instanceof SyncError) return error
  return new SyncError(fallbackCode, errorMessage(error), { cause: error })
}

/** Whether an error is retryable (network/transient Git failure). */
export function isRetryable(error: unknown): boolean {
  return error instanceof SyncError && error.retryable
}
