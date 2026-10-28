/**
 * Small JSON helpers shared by every module.
 *
 * Backups are JSON-only data: every value is validated at the boundary (Git
 * contents are untrusted input) and compared with an order-insensitive
 * serializer, so "no changes" really means no change.
 * @module core/json
 */

import { createHash } from 'node:crypto'
import type { JsonObject, JsonValue } from '../types.js'

/** Test whether `value` is lossless JSON data. Never throws. */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  const kind = typeof value
  if (kind === 'string' || kind === 'boolean') return true
  if (kind === 'number') return Number.isFinite(value as number)
  if (kind === 'object') {
    if (Array.isArray(value)) return value.every(isJsonValue)
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return false
    return Object.values(value as Record<string, unknown>).every(isJsonValue)
  }
  return false
}

/** Deep-clone JSON data. */
export function cloneJson<T extends JsonValue>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => cloneJson(item)) as T
  const out: JsonObject = {}
  for (const [key, item] of Object.entries(value)) out[key] = cloneJson(item)
  return out as T
}

/** Deterministic serialization: object keys sorted, arrays preserved. */
export function stableStringify(value: JsonValue): string {
  if (value === null) return 'null'
  const kind = typeof value
  if (kind === 'number' || kind === 'boolean' || kind === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as JsonObject).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

/** Structural equality for JSON data. */
export function deepEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return stableStringify(a) === stableStringify(b)
}

/** Short stable hash of JSON data (16 hex chars). */
export function hashJson(value: JsonValue): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 16)
}

/** Full SHA-256 hex digest of a string or buffer. */
export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Narrow an unknown value to a JSON object, or null. */
export function asJsonObject(value: unknown): JsonObject | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return null
  return value as JsonObject
}

/** Read a nested JSON value by path, or undefined. */
export function getPath(root: JsonValue, path: readonly string[]): JsonValue | undefined {
  let current: JsonValue | undefined = root
  for (const key of path) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = current[key]
    if (current === undefined) return undefined
  }
  return current
}

/** Deep-merge `patch` into `target` (arrays replaced, objects merged). */
export function mergeJson(target: JsonObject, patch: JsonObject): JsonObject {
  const out: JsonObject = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key]
    const existingObj = asJsonObject(existing)
    const patchObj = asJsonObject(value)
    out[key] = existingObj !== null && patchObj !== null ? mergeJson(existingObj, patchObj) : cloneJson(value)
  }
  return out
}

/** Pick a subset of keys from a JSON object. */
export function pickJson(value: JsonObject, keys: readonly string[]): JsonObject {
  const out: JsonObject = {}
  for (const key of keys) {
    if (Object.hasOwn(value, key)) out[key] = value[key] as JsonValue
  }
  return out
}

/** JSON-safe string preview with a hard length cap. */
export function previewJson(value: JsonValue, maxLength = 400): string {
  const text = stableStringify(value)
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

/** Parse JSON without throwing; returns undefined on malformed input. */
export function safeParseJson(text: string): JsonValue | undefined {
  try {
    const parsed = JSON.parse(text) as unknown
    return isJsonValue(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}
