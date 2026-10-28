/**
 * Typed errors with stable machine codes.
 *
 * The HTTP surface and the agent tools both map these codes to a message; the
 * code is what a caller inspects, the message is what a user reads. Messages
 * never contain credentials.
 * @module core/errors
 */
/** Error carrying a stable code and optional retry hint. */
export class SyncError extends Error {
    code;
    retryable;
    details;
    constructor(code, message, options = {}) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause });
        this.name = 'SyncError';
        this.code = code;
        this.retryable = options.retryable ?? false;
        this.details = options.details;
    }
}
/** Normalize any thrown value into a user-facing message. */
export function errorMessage(error) {
    if (error instanceof SyncError)
        return error.message;
    if (error instanceof Error)
        return error.message === '' ? error.name : error.message;
    if (typeof error === 'string')
        return error;
    try {
        return JSON.stringify(error);
    }
    catch {
        return 'unknown error';
    }
}
/** Normalize any thrown value into a SyncError. */
export function toSyncError(error, fallbackCode = 'internal') {
    if (error instanceof SyncError)
        return error;
    return new SyncError(fallbackCode, errorMessage(error), { cause: error });
}
/** Whether an error is retryable (network/transient Git failure). */
export function isRetryable(error) {
    return error instanceof SyncError && error.retryable;
}
