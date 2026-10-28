/**
 * Small helpers for the orchestration layer (kept separate so `engine.ts`
 * stays focused on workflow).
 * @module services/engine-utils
 */

import type { JsonValue } from '../types.js'
import { isJsonValue } from '../core/json.js'

/**
 * Deep-copy a value into lossless JSON.
 * @throws when the value cannot be represented as JSON (a programming error in
 * this plugin, never user input).
 */
export function safeJsonCopy(value: unknown): JsonValue {
  const cloned: unknown = structuredClone(value)
  if (!isJsonValue(cloned)) throw new TypeError('value is not lossless JSON')
  return cloned
}
