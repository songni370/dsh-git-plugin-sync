/**
 * Small JSON helpers shared by every module.
 *
 * Backups are JSON-only data: every value is validated at the boundary (Git
 * contents are untrusted input) and compared with an order-insensitive
 * serializer, so "no changes" really means no change.
 * @module core/json
 */
import { createHash } from 'node:crypto';
/** Test whether `value` is lossless JSON data. Never throws. */
export function isJsonValue(value) {
    if (value === null)
        return true;
    const kind = typeof value;
    if (kind === 'string' || kind === 'boolean')
        return true;
    if (kind === 'number')
        return Number.isFinite(value);
    if (kind === 'object') {
        if (Array.isArray(value))
            return value.every(isJsonValue);
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null)
            return false;
        return Object.values(value).every(isJsonValue);
    }
    return false;
}
/** Deep-clone JSON data. */
export function cloneJson(value) {
    if (value === null || typeof value !== 'object')
        return value;
    if (Array.isArray(value))
        return value.map(item => cloneJson(item));
    const out = {};
    for (const [key, item] of Object.entries(value))
        out[key] = cloneJson(item);
    return out;
}
/** Deterministic serialization: object keys sorted, arrays preserved. */
export function stableStringify(value) {
    if (value === null)
        return 'null';
    const kind = typeof value;
    if (kind === 'number' || kind === 'boolean' || kind === 'string')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(',')}]`;
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}
/** Structural equality for JSON data. */
export function deepEqual(a, b) {
    if (a === b)
        return true;
    if (a === undefined || b === undefined)
        return false;
    return stableStringify(a) === stableStringify(b);
}
/** Short stable hash of JSON data (16 hex chars). */
export function hashJson(value) {
    return createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 16);
}
/** Full SHA-256 hex digest of a string or buffer. */
export function sha256(data) {
    return createHash('sha256').update(data).digest('hex');
}
/** Narrow an unknown value to a JSON object, or null. */
export function asJsonObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return null;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null)
        return null;
    return value;
}
/** Read a nested JSON value by path, or undefined. */
export function getPath(root, path) {
    let current = root;
    for (const key of path) {
        if (current === null || typeof current !== 'object' || Array.isArray(current))
            return undefined;
        current = current[key];
        if (current === undefined)
            return undefined;
    }
    return current;
}
/** Deep-merge `patch` into `target` (arrays replaced, objects merged). */
export function mergeJson(target, patch) {
    const out = { ...target };
    for (const [key, value] of Object.entries(patch)) {
        const existing = out[key];
        const existingObj = asJsonObject(existing);
        const patchObj = asJsonObject(value);
        out[key] = existingObj !== null && patchObj !== null ? mergeJson(existingObj, patchObj) : cloneJson(value);
    }
    return out;
}
/** Pick a subset of keys from a JSON object. */
export function pickJson(value, keys) {
    const out = {};
    for (const key of keys) {
        if (Object.hasOwn(value, key))
            out[key] = value[key];
    }
    return out;
}
/** JSON-safe string preview with a hard length cap. */
export function previewJson(value, maxLength = 400) {
    const text = stableStringify(value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
/** Parse JSON without throwing; returns undefined on malformed input. */
export function safeParseJson(text) {
    try {
        const parsed = JSON.parse(text);
        return isJsonValue(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
