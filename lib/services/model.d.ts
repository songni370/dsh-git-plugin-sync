/**
 * Normalized plugin state used by every planning decision.
 *
 * A plugin state is the small, comparable projection of a scanned plugin, a
 * repository entry, or a saved baseline. Comparing these projections is what
 * separates "this device changed" from "another device changed" — the core of
 * two-way synchronization.
 * @module services/model
 */
import type { BaselineEntry, JsonObject, PluginOrigin, PluginRecord, PluginRowRecord, RemotePluginEntry } from '../types.js';
/** Comparable projection of one plugin on one side. */
export interface PluginState {
    id: string;
    name: string;
    displayName?: string;
    version: string | null;
    enabled: boolean;
    configs: JsonObject;
    installSpec: string | null;
    origin: PluginOrigin;
    pathOnly: boolean;
    builtIn: boolean;
    syncable: boolean;
    source?: string;
    rows: PluginRowRecord[];
}
/** Build the comparable state of a locally scanned plugin. */
export declare function localPluginState(record: PluginRecord): PluginState;
/** Build the comparable state of a repository entry (tombstones excluded). */
export declare function remotePluginState(entry: RemotePluginEntry): PluginState | null;
/** Build the comparable state from a saved baseline entry. */
export declare function baselinePluginState(id: string, entry: BaselineEntry, name: string): PluginState;
/** Normalize a state map into plain records. */
export declare function stateMap<T>(items: Iterable<T>, key: (item: T) => string, value: (item: T) => PluginState): Record<string, PluginState>;
/** Whether two states are the same for synchronization purposes. */
export declare function statesEqual(a: PluginState | null | undefined, b: PluginState | null | undefined): boolean;
/** Whether a state equals a baseline entry (used to attribute changes). */
export declare function stateMatchesBaseline(state: PluginState | null | undefined, entry: BaselineEntry | undefined): boolean;
/** Convert a state into a baseline entry. */
export declare function toBaselineEntry(state: PluginState): BaselineEntry;
/** Stable hash of the synchronization-relevant fields. */
export declare function stateHash(state: PluginState): string;
/** Field names that differ between two states (for conflict reports). */
export declare function changedFields(base: PluginState | null | undefined, candidate: PluginState | null | undefined): string[];
/** Config keys whose values differ between two config maps. */
export declare function changedConfigKeys(base: JsonObject | null | undefined, candidate: JsonObject | null | undefined): string[];
/** Whether a state must be excluded from synchronization. */
export declare function isSyncable(options: {
    state: PluginState;
    excludedPlugins: readonly string[];
    platform: string;
}): boolean;
