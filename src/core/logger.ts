/**
 * Redacting, ring-buffered logger.
 *
 * Writes one JSON object per line to `<data>/sync.log`, keeps the last N
 * entries in memory for the settings page, and forwards to the Host logger.
 * Every message and detail passes through {@link redactText} first, so a token
 * can never reach the log file or the UI even if a caller passes one by mistake.
 * @module core/logger
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DshLogger } from '../dsh.js'
import { LOG_RING_SIZE } from '../constants.js'
import { redactJson, redactText } from './redact.js'
import type { JsonValue, LogEntry, SyncLogger } from '../types.js'

/** Options for {@link createLogger}. */
export interface LoggerOptions {
  /** Absolute path of the JSONL log file, or null to keep memory only. */
  filePath?: string | null
  /** Maximum in-memory entries. */
  ringSize?: number
  /** Host logger to mirror into. */
  host?: DshLogger
  /** Notification for new entries (used by the HTTP surface). */
  onEntry?: (entry: LogEntry) => void
}

/** A {@link SyncLogger} plus a flush hook for tests. */
export interface FileSyncLogger extends SyncLogger {
  /** Wait for pending file writes (tests and shutdown). */
  flush(): Promise<void>
}

/** Create the process logger. */
export function createLogger(options: LoggerOptions = {}): FileSyncLogger {
  const ring: LogEntry[] = []
  const ringSize = options.ringSize ?? LOG_RING_SIZE
  let pending: Promise<void> = Promise.resolve()
  let fileReady = options.filePath === null || options.filePath === undefined

  const write = (level: LogEntry['level'], message: string, details?: JsonValue): void => {
    const safeMessage = redactText(message)
    const safeDetails = details === undefined ? undefined : redactJson(details)
    const entry: LogEntry = { at: new Date().toISOString(), level, message: safeMessage }
    if (safeDetails !== undefined) entry.details = safeDetails
    ring.push(entry)
    if (ring.length > ringSize) ring.splice(0, ring.length - ringSize)
    try {
      options.onEntry?.(entry)
    } catch {
      // A UI notification must never break a synchronization.
    }
    const host = options.host
    if (host !== undefined) {
      try {
        if (level === 'error') host.error(`[${'dsh-plugins-git-sync'}] ${safeMessage}`, safeDetails ?? '')
        else if (level === 'warn') host.warn(`[${'dsh-plugins-git-sync'}] ${safeMessage}`, safeDetails ?? '')
        else if (level === 'debug') host.debug(`[${'dsh-plugins-git-sync'}] ${safeMessage}`, safeDetails ?? '')
        else host.info(`[${'dsh-plugins-git-sync'}] ${safeMessage}`, safeDetails ?? '')
      } catch {
        // Host logger availability is not worth failing an operation for.
      }
    }
    const path = options.filePath
    if (path === null || path === undefined) return
    pending = pending
      .then(async () => {
        if (!fileReady) {
          await mkdir(dirname(path), { recursive: true, mode: 0o700 })
          fileReady = true
        }
        await appendFile(path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 })
      })
      .catch(() => {
        // Log persistence is best-effort; the in-memory ring still has the entry.
      })
  }

  return {
    debug: (message, details) => write('debug', message, details),
    info: (message, details) => write('info', message, details),
    warn: (message, details) => write('warn', message, details),
    error: (message, details) => write('error', message, details),
    recent: (limit = 100) => ring.slice(-Math.max(1, limit)),
    flush: () => pending,
  }
}

/** A logger that keeps nothing; useful for pure unit tests. */
export function silentLogger(): SyncLogger {
  const ring: LogEntry[] = []
  const push = (level: LogEntry['level']) => (message: string, details?: JsonValue) => {
    const entry: LogEntry = { at: new Date().toISOString(), level, message: redactText(message) }
    if (details !== undefined) entry.details = redactJson(details)
    ring.push(entry)
    if (ring.length > 100) ring.shift()
  }
  return {
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    recent: (limit = 100) => ring.slice(-limit),
  }
}
