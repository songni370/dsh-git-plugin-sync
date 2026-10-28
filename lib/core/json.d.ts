/**
 * Small JSON helpers shared by every module.
 *
 * Backups are JSON-only data: every value is validated at the boundary (Git
 * contents are untrusted input) and compared with an order-insensitive
 * serializer, so "no changes" really means no change.
 * @module core/json
 */
import type { JsonObject, JsonValue } from '../types.js';
/** Test whether `value` is lossless JSON data. Never throws. */
export declare function isJsonValue(value: unknown): value is JsonValue;
/** Deep-clone JSON data. */
export declare function cloneJson<T extends JsonValue>(value: T): T;
/** Deterministic serialization: object keys sorted, arrays preserved. */
export declare function stableStringify(value: JsonValue): string;
/** Structural equality for JSON data. */
export declare function deepEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean;
/** Short stable hash of JSON data (16 hex chars). */
export declare function hashJson(value: JsonValue): string;
/** Full SHA-256 hex digest of a string or buffer. */
export declare function sha256(data: string | Uint8Array): string;
/** Narrow an unknown value to a JSON object, or null. */
export declare function asJsonObject(value: unknown): JsonObject | null;
/** Read a nested JSON value by path, or undefined. */
export declare function getPath(root: JsonValue, path: readonly string[]): JsonValue | undefined;
/** Deep-merge `patch` into `target` (arrays replaced, objects merged). */
export declare function mergeJson(target: JsonObject, patch: JsonObject): JsonObject;
/** Pick a subset of keys from a JSON object. */
export declare function pickJson(value: JsonObject, keys: readonly string[]): JsonObject;
/** JSON-safe string preview with a hard length cap. */
export declare function previewJson(value: JsonValue, maxLength?: number): string;
/** Parse JSON without throwing; returns undefined on malformed input. */
export declare function safeParseJson(text: string): JsonValue | undefined;
