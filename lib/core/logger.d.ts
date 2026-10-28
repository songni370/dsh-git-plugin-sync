/**
 * Redacting, ring-buffered logger.
 *
 * Writes one JSON object per line to `<data>/sync.log`, keeps the last N
 * entries in memory for the settings page, and forwards to the Host logger.
 * Every message and detail passes through {@link redactText} first, so a token
 * can never reach the log file or the UI even if a caller passes one by mistake.
 * @module core/logger
 */
import type { DshLogger } from '../dsh.js';
import type { LogEntry, SyncLogger } from '../types.js';
/** Options for {@link createLogger}. */
export interface LoggerOptions {
    /** Absolute path of the JSONL log file, or null to keep memory only. */
    filePath?: string | null;
    /** Maximum in-memory entries. */
    ringSize?: number;
    /** Host logger to mirror into. */
    host?: DshLogger;
    /** Notification for new entries (used by the HTTP surface). */
    onEntry?: (entry: LogEntry) => void;
}
/** A {@link SyncLogger} plus a flush hook for tests. */
export interface FileSyncLogger extends SyncLogger {
    /** Wait for pending file writes (tests and shutdown). */
    flush(): Promise<void>;
}
/** Create the process logger. */
export declare function createLogger(options?: LoggerOptions): FileSyncLogger;
/** A logger that keeps nothing; useful for pure unit tests. */
export declare function silentLogger(): SyncLogger;
