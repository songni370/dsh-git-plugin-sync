/**
 * Automatic synchronization scheduler.
 *
 * Safety properties, in order of importance:
 * - off by default; nothing runs until the user enables it;
 * - one run at a time (the engine's mutex plus a local guard);
 * - conflicts and destructive plans pause automatic runs until the user acts;
 * - a debounce and a post-run cooldown prevent a loop when installing plugins
 *   itself emits `plugin-manager/changed`;
 * - a failed run is retried with backoff, at most three times;
 * - every timer is owned by the plugin's effect and removed on disable/unload.
 * @module services/scheduler
 */

import { SyncError, errorMessage } from '../core/errors.js'
import type { DshContext, DshDisposer } from '../dsh.js'
import type { SyncConfig, SyncLogger } from '../types.js'
import type { SyncEngine } from './engine.js'

/** Delay before the startup check, giving the profile time to finish booting. */
const STARTUP_CHECK_DELAY_MS = 15_000

/** Minimum time between two automatic runs (anti-loop). */
const COOLDOWN_MS = 60_000

/** Retry delays for a failed automatic run. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const

/** Options for {@link createScheduler}. */
export interface SchedulerOptions {
  ctx: DshContext
  engine: SyncEngine
  logger: SyncLogger
  /** Called when an automatic run cannot continue without the user. */
  onPaused?: (reason: string) => void
}

/** Automatic synchronization scheduler. */
export interface AutoSyncScheduler {
  /** Apply new configuration (called on start and after save). */
  applyConfig(config: SyncConfig): void
  /** Notify a possible plugin change; only acts when change-triggered sync is on. */
  notifyPluginChange(): void
  /** Current scheduler state for diagnostics. */
  state(): { enabled: boolean; pausedReason: string | null; failures: number; lastRunAt: string | null }
  dispose(): void
}

/** Create the scheduler. */
export function createScheduler(options: SchedulerOptions): AutoSyncScheduler {
  const { engine, logger } = options
  let config: SyncConfig | null = null
  let startupDisposer: DshDisposer | null = null
  let debounceDisposer: DshDisposer | null = null
  let retryDisposer: DshDisposer | null = null
  let running = false
  let pausedReason: string | null = null
  let failures = 0
  let lastRunAt: number | null = null
  let disposed = false

  const clear = (disposer: DshDisposer | null): null => {
    if (disposer !== null) {
      try {
        void disposer()
      } catch {
        // A disposer that throws must not stop the remaining cleanup.
      }
    }
    return null
  }

  const clearTimers = (): void => {
    startupDisposer = clear(startupDisposer)
    debounceDisposer = clear(debounceDisposer)
    retryDisposer = clear(retryDisposer)
  }

  const scheduleLater = (callback: () => void, delayMs: number): DshDisposer => {
    let cancelled = false
    const timer = setTimeout(() => {
      if (!cancelled && !disposed) callback()
    }, delayMs)
    // Never keep a shutting-down Host alive just for this timer.
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) timer.unref()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }

  const scheduleRetry = (): void => {
    if (failures >= RETRY_DELAYS_MS.length) {
      logger.warn('自动同步连续失败，已停止重试；请检查配置或手动同步 / automatic sync stopped after repeated failures')
      pausedReason = 'automatic sync failed repeatedly'
      options.onPaused?.(pausedReason)
      return
    }
    const delay = RETRY_DELAYS_MS[failures] ?? 15 * 60_000
    failures += 1
    retryDisposer = clear(retryDisposer)
    retryDisposer = scheduleLater(() => {
      retryDisposer = null
      void run('retry')
    }, delay)
    logger.info(`自动同步将在 ${Math.round(delay / 1000)} 秒后重试 / automatic sync retry scheduled`, { attempt: failures })
  }

  const run = async (reason: string): Promise<void> => {
    const current = config
    if (disposed || current === null || !current.autoSync.enabled) return
    if (running || engine.isBusy()) {
      logger.debug(`自动同步跳过（已有任务运行）/ automatic sync skipped (busy): ${reason}`)
      return
    }
    if (pausedReason !== null) {
      logger.debug(`自动同步处于暂停状态 / automatic sync paused: ${pausedReason}`)
      return
    }
    const now = Date.now()
    if (lastRunAt !== null && now - lastRunAt < COOLDOWN_MS) {
      logger.debug(`自动同步冷却中 / automatic sync cooling down: ${reason}`)
      return
    }
    running = true
    lastRunAt = now
    try {
      logger.info(`自动同步开始 / automatic sync started (${reason}, mode=${current.autoSync.mode})`)
      if (current.autoSync.mode === 'backup') {
        await engine.backup({ confirmDestructive: false })
      } else if (current.autoSync.mode === 'restore') {
        await engine.restore({ confirmDestructive: false })
      } else {
        await engine.sync({ confirmDestructive: false })
      }
      failures = 0
      pausedReason = null
      logger.info('自动同步完成 / automatic sync finished')
    } catch (error) {
      if (error instanceof SyncError && (error.code === 'conflict-present' || error.code === 'confirmation-required')) {
        pausedReason = error.code === 'conflict-present'
          ? 'unresolved conflicts need a decision'
          : 'destructive actions need confirmation'
        logger.warn(`自动同步已暂停 / automatic sync paused: ${error.message}`)
        options.onPaused?.(pausedReason)
        return
      }
      logger.warn(`自动同步失败 / automatic sync failed: ${errorMessage(error)}`)
      scheduleRetry()
    } finally {
      running = false
    }
  }

  const applyConfig = (next: SyncConfig): void => {
    config = next
    clearTimers()
    if (disposed) return
    const auto = next.autoSync
    if (!auto.enabled) {
      pausedReason = null
      failures = 0
      logger.debug('自动同步已关闭 / automatic sync disabled')
      return
    }
    if (next.repoUrl.trim() === '') {
      pausedReason = 'no repository configured'
      return
    }
    if (auto.onStartup) {
      // Opening the client is a trigger, not just a read-only check.
      startupDisposer = scheduleLater(() => {
        startupDisposer = null
        void run('startup')
      }, STARTUP_CHECK_DELAY_MS)
    }
    logger.info('自动同步已启用 / automatic sync enabled', {
      mode: auto.mode,
      onStartup: auto.onStartup,
      onPluginChange: auto.onPluginChange,
    })
  }

  const notifyPluginChange = (): void => {
    const current = config
    if (current === null || disposed || !current.autoSync.enabled || !current.autoSync.onPluginChange) return
    debounceDisposer = clear(debounceDisposer)
    debounceDisposer = scheduleLater(() => {
      debounceDisposer = null
      void run('plugin-change')
    }, Math.max(1_000, current.autoSync.debounceMs))
  }

  return {
    applyConfig,
    notifyPluginChange,
    state: () => ({
      enabled: config?.autoSync.enabled ?? false,
      pausedReason,
      failures,
      lastRunAt: lastRunAt === null ? null : new Date(lastRunAt).toISOString(),
    }),
    dispose: () => {
      disposed = true
      clearTimers()
      config = null
    },
  }
}
