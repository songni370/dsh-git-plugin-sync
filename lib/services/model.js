/**
 * Normalized plugin state used by every planning decision.
 *
 * A plugin state is the small, comparable projection of a scanned plugin, a
 * repository entry, or a saved baseline. Comparing these projections is what
 * separates "this device changed" from "another device changed" — the core of
 * two-way synchronization.
 * @module services/model
 */
import { stableStringify } from '../core/json.js';
/** Build the comparable state of a locally scanned plugin. */
export function localPluginState(record) {
    return {
        id: record.id,
        name: record.name,
        displayName: record.displayName,
        version: record.version,
        enabled: record.enabled,
        configs: record.configs,
        installSpec: record.installSpec,
        origin: record.origin,
        pathOnly: record.pathOnly,
        builtIn: record.builtIn,
        syncable: record.syncable,
        source: record.source,
        rows: record.rows,
    };
}
/** Build the comparable state of a repository entry (tombstones excluded). */
export function remotePluginState(entry) {
    if (entry.deleted === true)
        return null;
    return {
        id: entry.id,
        name: entry.name,
        displayName: entry.displayName,
        version: entry.version,
        enabled: entry.enabled,
        configs: {},
        installSpec: entry.installSpec,
        origin: entry.origin,
        pathOnly: entry.pathOnly,
        builtIn: entry.builtIn,
        syncable: entry.syncable,
        source: entry.source,
        rows: entry.rows ?? [],
    };
}
/** Build the comparable state from a saved baseline entry. */
export function baselinePluginState(id, entry, name) {
    return {
        id,
        name,
        version: entry.version,
        enabled: entry.enabled,
        configs: entry.configs,
        installSpec: null,
        origin: 'unknown',
        pathOnly: false,
        builtIn: false,
        syncable: true,
        rows: [],
    };
}
/** Normalize a state map into plain records. */
export function stateMap(items, key, value) {
    const out = {};
    for (const item of items)
        out[key(item)] = value(item);
    return out;
}
/** Whether two states are the same for synchronization purposes. */
export function statesEqual(a, b) {
    if (a === null || a === undefined)
        return b === null || b === undefined;
    if (b === null || b === undefined)
        return false;
    if (a.version !== b.version)
        return false;
    if (a.enabled !== b.enabled)
        return false;
    if (stableStringify(a.configs) !== stableStringify(b.configs))
        return false;
    return true;
}
/** Whether a state equals a baseline entry (used to attribute changes). */
export function stateMatchesBaseline(state, entry) {
    if (state === null || state === undefined)
        return entry === undefined || entry === null;
    if (entry === undefined)
        return false;
    return state.version === entry.version
        && state.enabled === entry.enabled
        && stableStringify(state.configs) === stableStringify(entry.configs);
}
/** Convert a state into a baseline entry. */
export function toBaselineEntry(state) {
    return {
        version: state.version,
        enabled: state.enabled,
        configs: state.configs,
        hash: stateHash(state),
    };
}
/** Stable hash of the synchronization-relevant fields. */
export function stateHash(state) {
    return stableStringify({
        v: state.version,
        e: state.enabled,
        c: state.configs,
    });
}
/** Field names that differ between two states (for conflict reports). */
export function changedFields(base, candidate) {
    const fields = [];
    const baseState = base ?? null;
    const next = candidate ?? null;
    if ((baseState === null) !== (next === null)) {
        fields.push('presence');
        return fields;
    }
    if (baseState === null || next === null)
        return fields;
    if (baseState.version !== next.version)
        fields.push('version');
    if (baseState.enabled !== next.enabled)
        fields.push('enabled');
    const baseKeys = Object.keys(baseState.configs).sort();
    const nextKeys = Object.keys(next.configs).sort();
    if (baseKeys.join('\u0000') !== nextKeys.join('\u0000')) {
        fields.push('config');
    }
    else {
        for (const key of baseKeys) {
            if (stableStringify(baseState.configs[key] ?? null) !== stableStringify(next.configs[key] ?? null)) {
                fields.push(`config.${key}`);
            }
        }
    }
    return fields;
}
/** Config keys whose values differ between two config maps. */
export function changedConfigKeys(base, candidate) {
    const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(candidate ?? {})]);
    const changed = [];
    for (const key of [...keys].sort()) {
        if (stableStringify((base ?? {})[key] ?? null) !== stableStringify((candidate ?? {})[key] ?? null))
            changed.push(key);
    }
    return changed;
}
/** Whether a state must be excluded from synchronization. */
export function isSyncable(options) {
    const { state, excludedPlugins } = options;
    if (state.builtIn)
        return false;
    if (!state.syncable)
        return false;
    if (state.origin === 'official')
        return false;
    if (excludedPlugins.includes(state.id) || excludedPlugins.includes(state.name))
        return false;
    return true;
}
