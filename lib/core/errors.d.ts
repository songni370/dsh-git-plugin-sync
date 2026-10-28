/**
 * Typed errors with stable machine codes.
 *
 * The HTTP surface and the agent tools both map these codes to a message; the
 * code is what a caller inspects, the message is what a user reads. Messages
 * never contain credentials.
 * @module core/errors
 */
/** Stable error codes surfaced to the UI and to agent tools. */
export type SyncErrorCode = 'not-configured' | 'invalid-config' | 'invalid-path' | 'invalid-manifest' | 'git-not-found' | 'git-failed' | 'git-auth-failed' | 'git-network' | 'git-conflict' | 'git-push-rejected' | 'repo-empty' | 'busy' | 'unsupported' | 'cancelled' | 'install-failed' | 'conflict-present' | 'confirmation-required' | 'snapshot-failed' | 'internal';
/** Error carrying a stable code and optional retry hint. */
export declare class SyncError extends Error {
    readonly code: SyncErrorCode;
    readonly retryable: boolean;
    readonly details?: Record<string, unknown>;
    constructor(code: SyncErrorCode, message: string, options?: {
        retryable?: boolean;
        details?: Record<string, unknown>;
        cause?: unknown;
    });
}
/** Normalize any thrown value into a user-facing message. */
export declare function errorMessage(error: unknown): string;
/** Normalize any thrown value into a SyncError. */
export declare function toSyncError(error: unknown, fallbackCode?: SyncErrorCode): SyncError;
/** Whether an error is retryable (network/transient Git failure). */
export declare function isRetryable(error: unknown): boolean;
