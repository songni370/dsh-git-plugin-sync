/**
 * Small helpers for the orchestration layer (kept separate so `engine.ts`
 * stays focused on workflow).
 * @module services/engine-utils
 */
import type { JsonValue } from '../types.js';
/**
 * Deep-copy a value into lossless JSON.
 * @throws when the value cannot be represented as JSON (a programming error in
 * this plugin, never user input).
 */
export declare function safeJsonCopy(value: unknown): JsonValue;
