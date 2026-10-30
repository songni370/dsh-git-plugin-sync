/**
 * Unit tests for the automatic synchronization scheduler.
 *
 * Auto-sync is event-driven only: opening the client and plugin changes. There
 * is deliberately no interval timer. The safety properties that matter remain:
 * off by default, one run at a time, conflicts and destructive plans pause
 * instead of prompting, a failed run is retried with backoff, and repeated
 * plugin-change notifications are debounced.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createScheduler } from '../../src/services/scheduler.js'
import { silentLogger } from '../../src/core/logger.js'
import { SyncError } from '../../src/core/errors.js'
import { defaultAutoSync } from '../../src/state/store.js'
import type { DshContext } from '../../src/dsh.js'
import type { SyncEngine } from '../../src/services/engine.js'
import type { SyncConfig } from '../../src/types.js'

/** Minimal context; the scheduler uses plain timers but requires the shape. */
const ctx: DshContext = {
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  get: () => undefined,
  inject: () => () => undefined,
  effect: callback => {
    const disposer = callback()
    return typeof disposer === 'function' ? disposer : () => undefined
  },
  on: () => () => undefined,
  timeout: () => () => undefined,
  interval: () => () => undefined,
}

/** Configuration with automatic synchronization enabled. */
function config(overrides: Partial<SyncConfig['autoSync']> = {}): SyncConfig {
  return {
    repoUrl: '/tmp/backup.git',
    branch: 'main',
    backupDir: '',
    authMode: 'credential-helper',
    tokenEnvVar: '',
    username: '',
    profiles: ['desktop'],
    includeConfigs: true,
    includeLocalPlugins: false,
    excludedPlugins: [],
    excludedConfigPlugins: [],
    autoSync: { ...defaultAutoSync(), enabled: true, ...overrides },
    deviceName: 'mac',
  }
}

/** Engine double with call tracking. */
function fakeEngine(behaviour: () => Promise<unknown> = async () => ({ ok: true })): {
  engine: SyncEngine
  calls: string[]
  busy: { value: boolean }
} {
  const calls: string[] = []
  const busy = { value: false }
  const engine = {
    isBusy: () => busy.value,
    sync: async () => {
      calls.push('sync')
      return behaviour()
    },
    backup: async () => {
      calls.push('backup')
      return behaviour()
    },
    restore: async () => {
      calls.push('restore')
      return behaviour()
    },
    status: async () => {
      calls.push('status')
      return { status: { pendingDownloads: 0 }, logs: [] }
    },
  } as unknown as SyncEngine
  return { engine, calls, busy }
}

describe('automatic sync scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does nothing while disabled', async () => {
    const { engine, calls } = fakeEngine()
    const scheduler = createScheduler({ ctx, engine, logger: silentLogger() })
    scheduler.applyConfig({ ...config(), autoSync: { ...defaultAutoSync(), enabled: false } })
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    scheduler.notifyPluginChange()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(calls).toHaveLength(0)
    scheduler.dispose()
  })

  it('never runs on a timer', async () => {
    const { engine, calls } = fakeEngine()
    const scheduler = createScheduler({ ctx, engine, logger: silentLogger() })
    scheduler.applyConfig(config({ onStartup: false, onPluginChange: false }))
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(calls).toHaveLength(0)
    scheduler.dispose()
  })

  it('syncs after a plugin change', async () => {
    const { engine, calls } = fakeEngine()
    const scheduler = createScheduler({ ctx, engine, logger: silentLogger() })
    scheduler.applyConfig(config({ onPluginChange: true, debounceMs: 1_000 }))
    scheduler.notifyPluginChange()
    await vi.advanceTimersByTimeAsync(999)
    expect(calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toEqual(['sync'])
    scheduler.dispose()
  })

  it('uses backup / restore when the mode asks for it', async () => {
    const backup = fakeEngine()
    const backupScheduler = createScheduler({ ctx, engine: backup.engine, logger: silentLogger() })
    backupScheduler.applyConfig(config({ mode: 'backup', onPluginChange: true, debounceMs: 1_000 }))
    backupScheduler.notifyPluginChange()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(backup.calls).toEqual(['backup'])
    backupScheduler.dispose()

    const restore = fakeEngine()
    const restoreScheduler = createScheduler({ ctx, engine: restore.engine, logger: silentLogger() })
    restoreScheduler.applyConfig(config({ mode: 'restore', onPluginChange: true, debounceMs: 1_000 }))
    restoreScheduler.notifyPluginChange()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(restore.calls).toEqual(['restore'])
    restoreScheduler.dispose()
  })

  it('pauses on conflicts instead of retrying forever', async () => {
    const { engine, calls } = fakeEngine(async () => {
      throw new SyncError('conflict-present', 'conflicts need a decision')
    })
    const paused: string[] = []
    const scheduler = createScheduler({ ctx, engine, logger: silentLogger(), onPaused: reason => paused.push(reason) })
    scheduler.applyConfig(config({ onPluginChange: true, debounceMs: 1_000 }))
    scheduler.notifyPluginChange()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls).toEqual(['sync'])
    expect(paused.length).toBe(1)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(calls).toEqual(['sync'])
    expect(scheduler.state().pausedReason).toContain('conflict')
    scheduler.dispose()
  })

  it('retries a failed run with backoff', async () => {
    let attempts = 0
    const { engine, calls } = fakeEngine(async () => {
      attempts += 1
      if (attempts === 1) throw new SyncError('git-network', 'network down', { retryable: true })
      return { ok: true }
    })
    const scheduler = createScheduler({ ctx, engine, logger: silentLogger() })
    scheduler.applyConfig(config({ onPluginChange: true, debounceMs: 1_000 }))
    scheduler.notifyPluginChange()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls.length).toBeGreaterThanOrEqual(2)
    scheduler.dispose()
  })

  it('debounces plugin-change notifications', async () => {
    const { engine, calls } = fakeEngine()
    const scheduler = createScheduler({ ctx, engine, logger: silentLogger() })
    scheduler.applyConfig(config({ onPluginChange: true, debounceMs: 5_000 }))
    scheduler.notifyPluginChange()
    scheduler.notifyPluginChange()
    scheduler.notifyPluginChange()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(1)
    scheduler.dispose()
  })

  it('skips a run while the engine is busy', async () => {
    const { engine, calls, busy } = fakeEngine()
    busy.value = true
    const scheduler = createScheduler({ ctx, engine, logger: silentLogger() })
    scheduler.applyConfig(config({ onPluginChange: true, debounceMs: 1_000 }))
    scheduler.notifyPluginChange()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls).toHaveLength(0)
    scheduler.dispose()
  })

  it('syncs once when the client starts', async () => {
    const { engine, calls } = fakeEngine()
    const scheduler = createScheduler({ ctx, engine, logger: silentLogger() })
    scheduler.applyConfig(config({ onStartup: true }))
    await vi.advanceTimersByTimeAsync(14_999)
    expect(calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toEqual(['sync'])
    scheduler.dispose()
  })

  it('honours a custom startup delay', async () => {
    const { engine, calls } = fakeEngine()
    const scheduler = createScheduler({ ctx, engine, logger: silentLogger() })
    scheduler.applyConfig(config({ onStartup: true, startupDelayMs: 5_000 }))
    await vi.advanceTimersByTimeAsync(4_999)
    expect(calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toEqual(['sync'])
    scheduler.dispose()
  })

  it('removes every timer on dispose', async () => {
    const { engine, calls } = fakeEngine()
    const scheduler = createScheduler({ ctx, engine, logger: silentLogger() })
    scheduler.applyConfig(config({ onStartup: true, onPluginChange: true }))
    scheduler.dispose()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(calls).toHaveLength(0)
  })
})
