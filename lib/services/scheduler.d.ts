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
import type { DshContext } from '../dsh.js';
import type { SyncConfig, SyncLogger } from '../types.js';
import type { SyncEngine } from './engine.js';
/** Options for {@link createScheduler}. */
export interface SchedulerOptions {
    ctx: DshContext;
    engine: SyncEngine;
    logger: SyncLogger;
    /** Called when an automatic run cannot continue without the user. */
    onPaused?: (reason: string) => void;
}
/** Automatic synchronization scheduler. */
export interface AutoSyncScheduler {
    /** Apply new configuration (called on start and after save). */
    applyConfig(config: SyncConfig): void;
    /** Notify a possible plugin change; only acts when change-triggered sync is on. */
    notifyPluginChange(): void;
    /** Current scheduler state for diagnostics. */
    state(): {
        enabled: boolean;
        pausedReason: string | null;
        failures: number;
        lastRunAt: string | null;
        nextRunInMs: number | null;
    };
    dispose(): void;
}
/** Create the scheduler. */
export declare function createScheduler(options: SchedulerOptions): AutoSyncScheduler;
