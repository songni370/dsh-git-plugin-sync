/**
 * Version comparison for plugin synchronization.
 *
 * Deliberately tolerant: a backup may contain a prerelease, a git-sourced
 * version, or nothing at all. Only clearly ordered semver values are compared;
 * anything else is reported as "different, order unknown" so the UI asks the
 * user instead of guessing.
 * @module core/version
 */

/** Parsed semantic version. */
export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
  raw: string
}

/** Parse `1.2.3`, `v1.2.3`, `1.2.3-rc.1`, `1.2.3+build`. */
export function parseVersion(input: string | null | undefined): ParsedVersion | null {
  if (input === null || input === undefined) return null
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(input.trim())
  if (match === null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
    raw: input.trim(),
  }
}

/** Compare prerelease identifiers per semver; a release ranks above its PREs. */
function comparePrerelease(a: ParsedVersion, b: ParsedVersion): number {
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const left = a.prerelease[index]
    const right = b.prerelease[index]
    if (left === undefined) return -1
    if (right === undefined) return 1
    const leftNumeric = /^\d+$/.test(left)
    const rightNumeric = /^\d+$/.test(right)
    if (leftNumeric && rightNumeric) {
      const diff = Number(left) - Number(right)
      if (diff !== 0) return diff > 0 ? 1 : -1
    } else if (leftNumeric) {
      return -1
    } else if (rightNumeric) {
      return 1
    } else if (left !== right) {
      return left > right ? 1 : -1
    }
  }
  return 0
}

/** Compare two versions: -1 (a<b), 0 (equal), 1 (a>b), null when unordered. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null
  if (a === b) return 0
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === null || right === null) return null
  if (left.major !== right.major) return left.major > right.major ? 1 : -1
  if (left.minor !== right.minor) return left.minor > right.minor ? 1 : -1
  if (left.patch !== right.patch) return left.patch > right.patch ? 1 : -1
  const pre = comparePrerelease(left, right)
  return pre > 0 ? 1 : pre < 0 ? -1 : 0
}

/** Whether `candidate` is a newer version than `current`. */
export function isNewerVersion(candidate: string | null | undefined, current: string | null | undefined): boolean {
  return compareVersions(candidate, current) === 1
}

/** Whether a version string parses as semver. */
export function isValidVersion(input: string | null | undefined): boolean {
  return parseVersion(input) !== null
}

/** Human-readable relation between two versions. */
export function versionRelation(
  local: string | null | undefined,
  remote: string | null | undefined,
): 'same' | 'local-newer' | 'remote-newer' | 'different' {
  if (local === remote) return 'same'
  const compared = compareVersions(local, remote)
  if (compared === 0) return 'same'
  if (compared === 1) return 'local-newer'
  if (compared === -1) return 'remote-newer'
  return 'different'
}
