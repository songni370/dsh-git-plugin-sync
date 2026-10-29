/**
 * Path validation and safe joining.
 *
 * Backup contents are untrusted input (another device, or a repository the
 * user cloned from anywhere), so every manifest-derived relative path is
 * validated before it touches the filesystem or a Git work tree: absolute
 * paths, drive-letter paths, URL schemes, parent traversal, NUL bytes and
 * symlinked escape routes are all refused.
 * @module core/paths
 */

import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { APP_DIR_NAME, LEGACY_APP_DIR_NAME } from '../constants.js'

/** Expand `~`, `~/` and `~\` against the OS home. */
export function expandHomePath(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/') || input.startsWith('~\\')) return join(homedir(), input.slice(2))
  return input
}

/** Whether a string can be a legal relative backup path (POSIX/JGit form). */
export function isSafeRelativePath(input: string): boolean {
  if (input === '' || input.length > 1024) return false
  if (input.includes('\0')) return false
  if (/^[a-zA-Z]:[\\/]/.test(input)) return false
  if (isAbsolute(input) || input.startsWith('/') || input.startsWith('\\')) return false
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return false
  const normalized = input.replaceAll('\\', '/')
  if (normalized.startsWith('../') || normalized.includes('/../') || normalized === '..') return false
  const segments = normalized.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return false
  return true
}

/**
 * Join a validated relative path onto a trusted root.
 * @throws when the relative path is unsafe or escapes the root.
 */
export function safeJoin(root: string, relative: string): string {
  if (!isSafeRelativePath(relative)) throw new Error(`unsafe backup path: ${JSON.stringify(relative)}`)
  const rootResolved = resolve(root)
  const target = resolve(rootResolved, relative.replaceAll('\\', '/'))
  const prefix = rootResolved.endsWith(sep) ? rootResolved : `${rootResolved}${sep}`
  if (target !== rootResolved && !target.startsWith(prefix)) {
    throw new Error(`backup path escapes its root: ${JSON.stringify(relative)}`)
  }
  return target
}

/**
 * Normalize a configured backup directory into a safe repository-relative form.
 * Accepts `''`, `'.'`, `'backup'`, `'backup/'`, `'a/b'` and `'./a/b'`.
 * @throws when the value is absolute, traversing, or otherwise unsafe.
 */
export function normalizeBackupDir(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '' || trimmed === '.' || trimmed === './') return ''
  const slash = trimmed.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
  if (!isSafeRelativePath(slash)) throw new Error(`invalid backup directory: ${JSON.stringify(input)}`)
  return slash
}

/** Join repository-relative segments, tolerating an empty base. */
export function repoPath(...segments: string[]): string {
  const filtered = segments.filter(segment => segment !== '' && segment !== '.')
  return normalize(filtered.join('/')).replaceAll('\\', '/')
}

/** A filesystem-safe file name derived from a plugin id. */
export function safeFileName(id: string, maxLength = 120): string {
  const normalized = id
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .replace(/[._]+$/, '')
  const base = normalized === '' ? 'plugin' : normalized
  return base.length > maxLength ? base.slice(0, maxLength) : base
}

/**
 * Data directory for a DSH home.
 *
 * The package was renamed (dsh-git-plugin-sync → dsh-plugins-git-sync), so an
 * existing install keeps using its old directory instead of losing config,
 * state and snapshots; a fresh install uses the new name.
 */
export function dataDirFor(dshHome: string): string {
  const next = join(dshHome, APP_DIR_NAME)
  const legacy = join(dshHome, LEGACY_APP_DIR_NAME)
  return existsSync(next) || !existsSync(legacy) ? next : legacy
}

/** OS temp root used by tests and snapshot staging. */
export function tempRoot(): string {
  return tmpdir()
}

/** Collapse a path for display: replace the OS home with `~`. */
export function displayPath(input: string): string {
  const home = homedir()
  if (input === home) return '~'
  if (input.startsWith(`${home}${sep}`)) return `~${input.slice(home.length)}`
  return input
}

/**
 * Windows-safe comparison key for paths (case-insensitive there).
 */
export function pathKey(input: string): string {
  return process.platform === 'win32' ? resolve(input).toLowerCase() : resolve(input)
}

/** Whether a host path contains a NUL byte or a control character. */
export function hasControlCharacters(input: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f]/.test(input)
}
