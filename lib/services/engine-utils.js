/**
 * Small helpers for the orchestration layer (kept separate so `engine.ts`
 * stays focused on workflow).
 * @module services/engine-utils
 */
import { isJsonValue } from '../core/json.js';
/**
 * Deep-copy a value into lossless JSON.
 * @throws when the value cannot be represented as JSON (a programming error in
 * this plugin, never user input).
 */
export function safeJsonCopy(value) {
    // JSON round-trip, not structuredClone: plan objects legitimately carry
    // optional fields as explicit `undefined` (e.g. `installSpec: undefined`),
    // which is valid in memory but not lossless JSON. Dropping those keys is the
    // documented lossless-JSON projection and keeps the wire envelope valid.
    let cloned;
    try {
        cloned = JSON.parse(JSON.stringify(value ?? null));
    }
    catch {
        throw new TypeError('value is not lossless JSON');
    }
    if (!isJsonValue(cloned))
        throw new TypeError('value is not lossless JSON');
    return cloned;
}
