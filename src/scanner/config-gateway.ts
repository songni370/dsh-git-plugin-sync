/**
 * Configuration extraction and write-back through the Host's Loader/settings
 * services.
 *
 * Two paths exist in DSH 0.2.1-rc.3:
 * 1. `ctx.get('configEditor')` owns the Loader entries and can persist a whole
 *    entry config through `edit()`;
 * 2. `ctx.get('settings')` owns registered settings namespaces and can patch a
 *    namespace through `update()`.
 *
 * The config editor is preferred because it sees per-entry inherited defaults
 * and overrides. Both paths are treated as untrusted input: every value is
 * filtered through the secret rules before it is returned to a caller or
 * written back. Read never throws; write throws a {@link SyncError} with a
 * stable code when no usable path exists.
 * @module scanner/config-gateway
 */

import type { DshConfigEditor, DshLoaderEntry, DshSettingsService } from '../dsh.js'
import { SyncError, errorMessage } from '../core/errors.js'
import { isJsonValue } from '../core/json.js'
import { filterSensitiveConfig } from '../core/redact.js'
import type { ConfigGateway, JsonValue, PluginConfigRead, SyncLogger } from '../types.js'

/** Dependencies of {@link createConfigGateway}. */
export interface ConfigGatewayDeps {
  /** Optional Host services; either may be absent on a minimal composition. */
  services: {
    configEditor?: DshConfigEditor
    settings?: DshSettingsService
  }
  /** Logger used for best-effort diagnostics; never receives config values. */
  logger: SyncLogger
}

/** One row of `configEditor.configuration()`, defensively narrowed. */
interface ConfigurationRow {
  entry: DshLoaderEntry
  inherited: Record<string, unknown>
  override: Record<string, unknown>
}

/** Read options shared by both gateway methods (structural). */
interface ReadOptions {
  moduleName: string
  entryIds: string[]
  profile: string
}

/** Write options shared by both gateway methods (structural). */
interface WriteOptions extends ReadOptions {
  values: Record<string, JsonValue>
}

/** Whether a value is a plain data record (not an array, class instance or null). */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Whether a value is any non-array object; Host DTOs may be class instances. */
function isRecordObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Whether a value looks enough like a Loader entry to inspect it.
 * Entries are opaque class instances in the Host, so only the object shape is
 * checked here; identity fields are read individually and never trusted.
 */
function isEntryObject(value: unknown): value is DshLoaderEntry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' || typeof record.name === 'string' || typeof record.patchId === 'string'
  )
}

/** Read one identity field from an opaque entry. */
function identityOf(entry: DshLoaderEntry, key: 'id' | 'name' | 'patchId'): string | null {
  const value = (entry as Record<string, unknown>)[key]
  return typeof value === 'string' && value !== '' ? value : null
}

/** Defensive string-list normalization. */
function normalizeIds(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const item of input) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed !== '' && !out.includes(trimmed)) out.push(trimmed)
  }
  return out
}

/** Deduplicate strings, preserving order. */
function unique(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (value === '' || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

/** Whether one opaque entry belongs to the requested module or entry ids. */
function entryMatches(entry: DshLoaderEntry, moduleName: string, entryIds: readonly string[]): boolean {
  const identities = [identityOf(entry, 'id'), identityOf(entry, 'name'), identityOf(entry, 'patchId')].filter(
    (identity): identity is string => identity !== null,
  )
  if (identities.length === 0) return false
  if (moduleName !== '' && identities.includes(moduleName)) return true
  return identities.some(identity => entryIds.includes(identity))
}

/** Collect the usable rows of `configEditor.configuration()`; never throws. */
function collectConfigurationRows(editor: DshConfigEditor): ConfigurationRow[] {
  if (typeof editor.configuration !== 'function') return []
  const configuration: unknown = editor.configuration()
  if (!Array.isArray(configuration)) return []
  const rows: ConfigurationRow[] = []
  for (const item of configuration) {
    if (!isRecordObject(item)) continue
    const entry = item.entry
    if (!isEntryObject(entry)) continue
    rows.push({
      entry,
      inherited: isRecordObject(item.inherited) ? item.inherited : {},
      override: isRecordObject(item.override) ? item.override : {},
    })
  }
  return rows
}

/** Read config values from the config editor; null when nothing matched. */
function readFromEditor(
  editor: DshConfigEditor,
  moduleName: string,
  entryIds: readonly string[],
): PluginConfigRead | null {
  const matched = collectConfigurationRows(editor).filter(row => entryMatches(row.entry, moduleName, entryIds))
  if (matched.length === 0) return null
  const merged: Record<string, unknown> = {}
  for (const row of matched) {
    // The effective config is the override layered on the inherited defaults.
    Object.assign(merged, row.inherited)
    Object.assign(merged, row.override)
  }
  return filterSensitiveConfig(merged)
}

/** Find a settings descriptor for the requested module; null when none matches. */
function findSettingsDescriptor(
  settings: DshSettingsService,
  moduleName: string,
  entryIds: readonly string[],
): Record<string, unknown> | null {
  if (typeof settings.describe !== 'function') return null
  const descriptors: unknown = settings.describe({ redactSecrets: true })
  if (!Array.isArray(descriptors)) return null
  for (const descriptor of descriptors) {
    if (!isRecordObject(descriptor)) continue
    const ns = typeof descriptor.ns === 'string' ? descriptor.ns : ''
    if (ns === '') continue
    if (moduleName !== '' && ns === moduleName) return descriptor
    if (entryIds.includes(ns)) return descriptor
  }
  return null
}

/** Deep-clone a plain record/array so secret paths can be removed safely. */
function cloneData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => cloneData(item))
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = cloneData(item)
    return out
  }
  return value
}

/** Remove one path from cloned data; returns whether the leaf existed. */
function removePath(root: unknown, path: readonly string[]): boolean {
  const first = path[0]
  if (first === undefined) return false
  let current: unknown = root
  for (let index = 0; index < path.length - 1; index += 1) {
    const part = path[index] as string
    if (Array.isArray(current)) {
      const itemIndex = Number(part)
      if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= current.length) return false
      current = current[itemIndex]
      continue
    }
    if (!isPlainRecord(current) || !Object.hasOwn(current, part)) return false
    current = current[part]
  }
  const last = path[path.length - 1] as string
  if (Array.isArray(current)) {
    const itemIndex = Number(last)
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= current.length) return false
    current.splice(itemIndex, 1)
    return true
  }
  if (isPlainRecord(current) && Object.hasOwn(current, last)) {
    delete current[last]
    return true
  }
  return false
}

/** Drop the settings service's declared secret paths from a value tree. */
function dropSecretPaths(
  value: Record<string, unknown>,
  secrets: unknown,
): { value: Record<string, unknown>; dropped: string[] } {
  if (!Array.isArray(secrets) || secrets.length === 0) return { value, dropped: [] }
  const cloned = cloneData(value)
  if (!isPlainRecord(cloned)) return { value, dropped: [] }
  const dropped: string[] = []
  for (const secret of secrets) {
    if (!isRecordObject(secret)) continue
    const rawPath = secret.path
    let path: string[] = []
    if (Array.isArray(rawPath)) {
      path = rawPath.filter((part): part is string => typeof part === 'string' && part !== '')
    } else if (typeof rawPath === 'string' && rawPath !== '') {
      path = rawPath.split('.').filter(part => part !== '')
    }
    if (path.length === 0) continue
    if (removePath(cloned, path)) dropped.push(path.join('.'))
  }
  return { value: cloned, dropped }
}

/** Read config values from a settings namespace; null when nothing matched. */
function readFromSettings(
  settings: DshSettingsService,
  moduleName: string,
  entryIds: readonly string[],
): PluginConfigRead | null {
  const descriptor = findSettingsDescriptor(settings, moduleName, entryIds)
  if (descriptor === null) return null
  const value = descriptor.value
  if (!isRecordObject(value)) return null
  const { value: sanitized, dropped } = dropSecretPaths(value, descriptor.secrets)
  const filtered = filterSensitiveConfig(sanitized)
  return {
    values: filtered.values,
    skippedKeys: unique([...filtered.skippedKeys, ...dropped]),
  }
}

/** Find the Loader entry an edit should target; null when it is not loaded. */
function findEditorEntry(
  editor: DshConfigEditor,
  moduleName: string,
  entryIds: readonly string[],
): DshLoaderEntry | null {
  const candidates: unknown[] = []
  if (typeof editor.configuration === 'function') {
    try {
      const configuration: unknown = editor.configuration()
      if (Array.isArray(configuration)) {
        for (const item of configuration) {
          if (isRecordObject(item)) candidates.push(item.entry)
        }
      }
    } catch {
      // Fall through to entries(); either source is enough to locate the entry.
    }
  }
  if (typeof editor.entries === 'function') {
    try {
      const entries: unknown = editor.entries()
      if (Array.isArray(entries)) candidates.push(...entries)
    } catch {
      // No usable entry list; the caller will fall back to settings.
    }
  }
  for (const candidate of candidates) {
    if (isEntryObject(candidate) && entryMatches(candidate, moduleName, entryIds)) return candidate
  }
  return null
}

/**
 * Create the {@link ConfigGateway}.
 *
 * Reads are best-effort and never throw. Writes throw
 * `SyncError('invalid-config')` for non-JSON input and
 * `SyncError('unsupported')` when neither Host service can accept a write;
 * values that look like secrets are silently dropped and never written.
 */
export function createConfigGateway(deps: ConfigGatewayDeps): ConfigGateway {
  const services: ConfigGatewayDeps['services'] = deps.services ?? {}
  const logger = deps.logger
  const warn = (message: string, error?: unknown): void => {
    try {
      logger?.warn(message, error === undefined ? undefined : { reason: errorMessage(error) })
    } catch {
      // Logging must never break configuration access.
    }
  }

  const read = async (options: ReadOptions): Promise<PluginConfigRead> => {
    const moduleName = typeof options?.moduleName === 'string' ? options.moduleName.trim() : ''
    const entryIds = normalizeIds(options?.entryIds)
    const empty: PluginConfigRead = { values: {}, skippedKeys: [] }
    if (moduleName === '' && entryIds.length === 0) return empty

    const editor = services.configEditor
    if (editor !== undefined) {
      try {
        const fromEditor = readFromEditor(editor, moduleName, entryIds)
        if (fromEditor !== null) return fromEditor
      } catch (error) {
        warn(`config editor read failed for ${moduleName || entryIds[0] || 'unknown plugin'}`, error)
      }
    }

    const settings = services.settings
    if (settings !== undefined) {
      try {
        const fromSettings = readFromSettings(settings, moduleName, entryIds)
        if (fromSettings !== null) return fromSettings
      } catch (error) {
        warn(`settings read failed for ${moduleName || entryIds[0] || 'unknown plugin'}`, error)
      }
    }
    return empty
  }

  const write = async (options: WriteOptions): Promise<void> => {
    const moduleName = typeof options?.moduleName === 'string' ? options.moduleName.trim() : ''
    const entryIds = normalizeIds(options?.entryIds)
    const rawValues = options?.values
    if (!isPlainRecord(rawValues)) {
      throw new SyncError('invalid-config', 'plugin configuration values must be a JSON object')
    }
    for (const [key, value] of Object.entries(rawValues)) {
      if (!isJsonValue(value)) {
        throw new SyncError('invalid-config', `plugin configuration value ${JSON.stringify(key)} is not JSON data`)
      }
    }

    // Secrets are never written, whichever Host path is used.
    const safeValues = filterSensitiveConfig(rawValues).values
    if (Object.keys(safeValues).length === 0) return

    let editorError: unknown
    const editor = services.configEditor
    if (editor !== undefined) {
      try {
        const entry = findEditorEntry(editor, moduleName, entryIds)
        if (entry !== null && typeof editor.edit === 'function') {
          await editor.edit(entry, current => {
            // Preserve every key the current entry config already has; only the
            // synchronized keys are replaced.
            const next: Record<string, unknown> = isPlainRecord(current) ? { ...current } : {}
            for (const [key, value] of Object.entries(safeValues)) next[key] = value
            return next
          })
          return
        }
      } catch (error) {
        editorError = error
        warn(`config editor write failed for ${moduleName || entryIds[0] || 'unknown plugin'}`, error)
      }
    }

    const settings = services.settings
    if (settings !== undefined && typeof settings.update === 'function') {
      try {
        const descriptor = findSettingsDescriptor(settings, moduleName, entryIds)
        const descriptorNs = descriptor !== null && typeof descriptor.ns === 'string' ? descriptor.ns : ''
        const namespace = descriptorNs !== '' ? descriptorNs : moduleName !== '' ? moduleName : (entryIds[0] ?? '')
        if (namespace === '') {
          throw new SyncError('unsupported', 'cannot determine the settings namespace to write to')
        }
        await settings.update(namespace, safeValues)
        return
      } catch (error) {
        if (error instanceof SyncError) throw error
        throw new SyncError(
          'internal',
          `failed to write plugin configuration: ${errorMessage(error)}`,
          { cause: error },
        )
      }
    }

    if (editorError !== undefined) {
      if (editorError instanceof SyncError) throw editorError
      throw new SyncError(
        'internal',
        `failed to write plugin configuration: ${errorMessage(editorError)}`,
        { cause: editorError },
      )
    }
    throw new SyncError(
      'unsupported',
      'this DSH version exposes neither a config editor nor a writable settings service',
    )
  }

  return { read, write }
}
