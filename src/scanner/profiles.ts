/**
 * Profile discovery and profile-manifest reading.
 *
 * A DSH home keeps one directory per profile under `<DSH home>/profiles`. Each
 * one is a small package whose `dependencies` are the plugins installed into
 * that profile; the same directory is the fallback inventory source when the
 * Host's plugin manager is unavailable. Everything here parses defensively:
 * a profile that a previous install left broken is skipped, never fatal.
 * @module scanner/profiles
 */

import type { Dirent } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** One profile the settings page can offer in its selector. */
export interface ProfileSummary {
  /** Directory name, which is also the profile name. */
  name: string
  /** Absolute profile directory. */
  dir: string
  /** `dependencies` map from the profile's `package.json` (plugin name -> spec). */
  dependencies: Record<string, string>
  /**
   * Installed plugin/bundle package names: the dependency names, plus any
   * bundle names the profile manifest declares explicitly under `dsh`.
   */
  bundles: string[]
  /** Number of known bundles, for the selector's badge. */
  pluginCount: number
}

/** Conservative profile name validation (also blocks path traversal). */
const SAFE_PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Parsed subset of a profile `package.json`. */
interface ProfilePackage {
  dependencies: Record<string, string>
  declaredBundles: string[]
}

/** Whether a value is a plain record (never a class instance or array). */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Normalize a dependency map, dropping non-string and empty specs. */
function normalizeDependencies(raw: unknown): Record<string, string> {
  const dependencies: Record<string, string> = {}
  if (!isPlainRecord(raw)) return dependencies
  for (const [name, spec] of Object.entries(raw)) {
    if (name.trim() === '' || typeof spec !== 'string') continue
    const trimmed = spec.trim()
    if (trimmed === '') continue
    dependencies[name] = trimmed
  }
  return dependencies
}

/** Read bundle names a profile manifest declares under its `dsh` section. */
function collectDeclaredBundles(dsh: unknown): string[] {
  if (!isPlainRecord(dsh)) return []
  const out: string[] = []
  const push = (value: unknown): void => {
    if (typeof value === 'string' && value.trim() !== '') out.push(value.trim())
  }
  const pushEntry = (value: unknown): void => {
    if (typeof value === 'string') push(value)
    else if (isPlainRecord(value)) push(value.name)
  }

  const bundles = dsh.bundles
  if (Array.isArray(bundles)) for (const item of bundles) pushEntry(item)

  const bundle = dsh.bundle
  if (Array.isArray(bundle)) for (const item of bundle) pushEntry(item)
  else pushEntry(bundle)

  return out
}

/** Parse `<dir>/package.json`; null when missing, unreadable or malformed. */
async function readProfilePackage(dir: string): Promise<ProfilePackage | null> {
  let text: string
  try {
    text = await readFile(join(dir, 'package.json'), 'utf8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return null
  }
  if (!isPlainRecord(parsed)) return null
  return {
    dependencies: normalizeDependencies(parsed.dependencies),
    declaredBundles: collectDeclaredBundles(parsed.dsh),
  }
}

/** Merge dependency names with explicitly declared bundles, without duplicates. */
function mergeBundles(dependencies: readonly string[], declared: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of [...dependencies, ...declared]) {
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/**
 * List the usable profiles under a DSH home's `profiles` directory.
 *
 * Directories without a readable `package.json` (broken or half-created
 * profiles) are ignored, and an unreadable root yields an empty list.
 */
export async function listProfiles(profilesRoot: string): Promise<ProfileSummary[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(profilesRoot, { withFileTypes: true })
  } catch {
    return []
  }

  const summaries: ProfileSummary[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    if (!SAFE_PROFILE_NAME.test(entry.name)) continue
    const dir = join(profilesRoot, entry.name)
    const pkg = await readProfilePackage(dir)
    if (pkg === null) continue
    const bundles = mergeBundles(Object.keys(pkg.dependencies), pkg.declaredBundles)
    summaries.push({
      name: entry.name,
      dir,
      dependencies: pkg.dependencies,
      bundles,
      pluginCount: bundles.length,
    })
  }
  summaries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  return summaries
}

/**
 * Resolve one profile directory, or null when the profile does not exist.
 * Rejects unsafe names before touching the filesystem.
 */
export async function findProfileDir(profilesRoot: string, name: string): Promise<string | null> {
  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  if (trimmed === '' || !SAFE_PROFILE_NAME.test(trimmed)) return null
  const dir = join(profilesRoot, trimmed)
  try {
    await readdir(dir)
    return dir
  } catch {
    return null
  }
}

/** Read only the dependency map of a profile; `{}` when unreadable or broken. */
export async function readProfileDependencies(dir: string): Promise<Record<string, string>> {
  const pkg = await readProfilePackage(dir)
  return pkg === null ? {} : pkg.dependencies
}
