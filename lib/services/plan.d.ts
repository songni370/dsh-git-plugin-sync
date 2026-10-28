/**
 * Pure planning: compare local, remote and baseline states and produce the
 * exact actions a backup, restore or two-way sync would execute.
 *
 * Nothing in this module performs I/O, which is what makes the destructive
 * parts reviewable: the settings page shows this plan, the agent tools return
 * it, and the executor runs only what the plan (plus the user's conflict
 * choices) contains.
 *
 * Change attribution is a three-way comparison:
 * - base   = what this device last agreed with the repository about
 * - local  = what is installed now
 * - remote = what the repository says now
 *
 * `localChanged` alone means this device changed → push.
 * `remoteChanged` alone means another device changed → apply locally.
 * Both changed and still different is a conflict: never resolved silently.
 * @module services/plan
 */
import { versionRelation } from '../core/version.js';
import type { ConflictResolution, SyncConfig, SyncPlan } from '../types.js';
import { type PluginState } from './model.js';
/** Per-plugin remote metadata used to explain a conflict. */
export interface RemoteMeta {
    updatedBy: string;
    updatedAt: string;
    /** Platform of the device that last changed the entry, when known. */
    platform?: string;
}
/** Everything a plan needs. */
export interface PlanInput {
    profile: string;
    config: SyncConfig;
    now: string;
    localPlatform: string;
    local: Record<string, PluginState>;
    /** Repository entries excluding tombstones. */
    remote: Record<string, PluginState>;
    /** Repository tombstones (ids deliberately deleted by a device). */
    remoteTombstones: ReadonlySet<string>;
    remoteMeta: Record<string, RemoteMeta>;
    base: Record<string, PluginState>;
    /** User decisions for conflicts raised by this plan. */
    resolutions?: readonly ConflictResolution[];
    /** Additional warnings gathered by the engine before planning. */
    warnings?: string[];
}
/** Plan a backup: this device's state becomes the repository's state. */
export declare function planBackup(input: PlanInput): SyncPlan;
/** Plan a restore: the repository's state is applied to this device. */
export declare function planRestore(input: PlanInput): SyncPlan;
/** Plan a two-way synchronization. */
export declare function planSync(input: PlanInput): SyncPlan;
/** Count pending changes by direction, for the status panel. */
export declare function countPlanChanges(plan: SyncPlan): {
    uploads: number;
    downloads: number;
    destructive: number;
};
/** Version relation helper re-exported for the status view. */
export { versionRelation };
