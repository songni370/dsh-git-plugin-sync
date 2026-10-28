/**
 * Backup repository layout: path construction and safe file access.
 *
 * Two problems are solved here and nowhere else:
 *
 * - **Mapping caller paths to repository paths.** {@link RepoWriteOptions.files}
 *   keys may be written relative to the backup directory (`manifest.json`) or
 *   relative to the repository root (`backup/manifest.json`); both forms are
 *   accepted and normalized to a repository-relative path that is guaranteed to
 *   live inside the configured backup directory.
 * - **Untrusted work-tree content.** The work tree is cloned from a repository
 *   the other device controls. Writing through a symlink would escape the work
 *   tree, so every write/delete checks each path segment with `lstat` and refuses
 *   symlinks; reads use the same no-follow rule. `.git` (and Windows' `GIT~1`
 *   short name) can never be written, so a malicious backup cannot install hooks.
 *
 * All paths are validated with `core/paths`; no caller string reaches the
 * filesystem or a Git argument unchecked.
 * @module git/repo-paths
 */

import { open, lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'
import {
  REPO_CONFIGS_DIR,
  REPO_DEVICES_DIR,
  REPO_MANIFEST_FILE,
  REPO_PLUGINS_FILE,
  REPO_PROFILES_DIR,
  REPO_README_FILE,
  REPO_SCHEMA_FILE,
} from '../constants.js'
import { SyncError } from '../core/errors.js'
import { isSafeRelativePath, normalizeBackupDir, repoPath, safeFileName, safeJoin } from '../core/paths.js'
import { DEVICE_ID_PATTERN, isSafeProfileSegment } from '../manifest/manifest.js'

/** Device IDs become directory names; kept to one conservative segment. */
export { DEVICE_ID_PATTERN }

/** Every repository-relative path of one backup entry point. */
export interface BackupPaths {
  /** Backup root (`''` means the repository root). */
  root: string
  /** `manifest.json` */
  manifest: string
  /** `metadata/schema.json` */
  schema: string
  /** `README.md` */
  readme: string
  /** `profiles/<profile>/plugins.json` */
  profileState: string
  /** `profiles/<profile>/configs` */
  configsDir: string
  /** `profiles/<profile>/configs/<plugin>.json` */
  config: string
  /** `devices` */
  devicesDir: string
  /** `devices/<deviceId>/<profile>.json` */
  deviceSnapshot: string
}

/** Throw a typed error for an invalid profile name. */
export function assertProfileName(profile: string): string {
  if (!isSafeProfileSegment(profile)) {
    throw new SyncError('invalid-path', `非法的 profile 名称 / invalid profile name: ${JSON.stringify(profile)}`)
  }
  return profile
}

/** Throw a typed error for an invalid device id. */
export function assertDeviceId(deviceId: string): string {
  if (typeof deviceId !== 'string' || !DEVICE_ID_PATTERN.test(deviceId)) {
    throw new SyncError('invalid-path', `非法的设备 ID / invalid device id: ${JSON.stringify(deviceId)}`)
  }
  return deviceId
}

/** Throw a typed error for a plugin id that cannot be a file name. */
export function assertPluginId(pluginId: string): string {
  if (typeof pluginId !== 'string' || pluginId === '') {
    throw new SyncError('invalid-path', '插件 ID 不能为空 / plugin id must not be empty')
  }
  // `safeFileName` sanitizes anything, so the only hard requirement is a
  // non-empty string; this pattern is used to reject hostile control bytes.
  if (/[\u0000-\u001f\u007f]/.test(pluginId) || pluginId.length > 512) {
    throw new SyncError('invalid-path', `非法的插件 ID / invalid plugin id: ${JSON.stringify(pluginId)}`)
  }
  return pluginId
}

/** Repository-relative path of a profile's shared state. */
export function profileStatePath(backupDir: string, profile: string): string {
  assertProfileName(profile)
  return repoPath(backupDir, REPO_PROFILES_DIR, profile, REPO_PLUGINS_FILE)
}

/** Repository-relative path of a profile's config directory. */
export function configsDirPath(backupDir: string, profile: string): string {
  assertProfileName(profile)
  return repoPath(backupDir, REPO_PROFILES_DIR, profile, REPO_CONFIGS_DIR)
}

/** Repository-relative path of one plugin's config file. */
export function configPath(backupDir: string, profile: string, pluginId: string): string {
  assertPluginId(pluginId)
  return repoPath(configsDirPath(backupDir, profile), `${safeFileName(pluginId)}.json`)
}

/** Repository-relative path of one device snapshot. */
export function deviceSnapshotPath(backupDir: string, deviceId: string, profile: string): string {
  assertDeviceId(deviceId)
  assertProfileName(profile)
  return repoPath(backupDir, REPO_DEVICES_DIR, deviceId, `${profile}.json`)
}

/** Repository-relative path of the root manifest. */
export function manifestPath(backupDir: string): string {
  return repoPath(backupDir, REPO_MANIFEST_FILE)
}

/** Repository-relative path of the machine-readable layout document. */
export function schemaPath(backupDir: string): string {
  return repoPath(backupDir, REPO_SCHEMA_FILE)
}

/** Repository-relative path of the human warning README. */
export function readmePath(backupDir: string): string {
  return repoPath(backupDir, REPO_README_FILE)
}

/** Repository-relative path of the device snapshots directory. */
export function devicesDirPath(backupDir: string): string {
  return repoPath(backupDir, REPO_DEVICES_DIR)
}

/**
 * Every path used by one profile/device/plugin combination.
 *
 * This is the helper the sync services use so they never build a layout path by
 * hand.
 */
export function backupPaths(backupDir: string, profile: string, pluginId: string, deviceId: string): BackupPaths {
  const root = normalizeBackupDir(backupDir)
  return {
    root,
    manifest: manifestPath(root),
    schema: schemaPath(root),
    readme: readmePath(root),
    profileState: profileStatePath(root, profile),
    configsDir: configsDirPath(root, profile),
    config: configPath(root, profile, pluginId),
    devicesDir: devicesDirPath(root),
    deviceSnapshot: deviceSnapshotPath(root, deviceId, profile),
  }
}

/** Normalize the configured backup directory, turning failures into typed errors. */
export function normalizeBackupDirectory(input: string | undefined): string {
  try {
    return normalizeBackupDir(input ?? '')
  } catch (error) {
    throw new SyncError('invalid-config', `备份目录无效 / invalid backup directory: ${String(input)}`, {
      cause: error,
    })
  }
}

/** A write target resolved against the backup directory. */
export interface ResolvedTarget {
  /** Path relative to the repository root. */
  repo: string
  /** Path relative to the backup directory. */
  backup: string
}

/**
 * Resolve one caller-supplied file path.
 *
 * Accepts both repository-relative (`backup/x.json`) and backup-relative
 * (`x.json`) forms. Absolute paths, parent traversal, URL schemes, NUL bytes and
 * `.git` are refused.
 * @throws {SyncError} code `invalid-path`.
 */
export function resolveTarget(backupDir: string, input: string): ResolvedTarget {
  if (typeof input !== 'string' || !isSafeRelativePath(input)) {
    throw new SyncError('invalid-path', `不安全的备份路径 / unsafe backup path: ${JSON.stringify(input)}`)
  }
  const normalized = input.replaceAll('\\', '/')
  const root = backupDir
  let repo: string
  let backup: string
  if (root !== '' && (normalized === root || normalized.startsWith(`${root}/`))) {
    repo = repoPath(normalized)
    backup = normalized.slice(root.length + 1)
    if (backup === '') {
      throw new SyncError('invalid-path', `备份路径不能是目录 / backup path must name a file: ${JSON.stringify(input)}`)
    }
  } else {
    backup = repoPath(normalized)
    repo = repoPath(root, backup)
  }
  if (!isSafeRelativePath(repo) || !isSafeRelativePath(backup)) {
    throw new SyncError('invalid-path', `不安全的备份路径 / unsafe backup path: ${JSON.stringify(input)}`)
  }
  const firstSegment = repo.split('/')[0]?.toLowerCase() ?? ''
  if (firstSegment === '.git' || firstSegment === 'git~1') {
    throw new SyncError('invalid-path', `禁止写入 .git 目录 / refusing to write inside .git: ${JSON.stringify(input)}`)
  }
  return { repo, backup }
}

/** Refuse a symlink anywhere along a repository-relative path. */
async function assertNoSymlinkSegments(root: string, repoRelative: string): Promise<void> {
  const segments = repoRelative.split('/')
  let current = root
  for (const segment of segments) {
    current = safeJoin(current, segment)
    let stats
    try {
      stats = await lstat(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (stats.isSymbolicLink()) {
      throw new SyncError('invalid-path', `拒绝写入符号链接 / refusing to write through a symbolic link: ${repoRelative}`)
    }
  }
}

/** Resolve a repository-relative path inside the work tree with safety checks. */
export function workTreePath(workTree: string, repoRelative: string): string {
  if (!isSafeRelativePath(repoRelative)) {
    throw new SyncError('invalid-path', `不安全的仓库路径 / unsafe repository path: ${JSON.stringify(repoRelative)}`)
  }
  return safeJoin(workTree, repoRelative)
}

/** Write one UTF-8 file atomically inside the work tree. */
export async function writeWorkTreeFile(workTree: string, repoRelative: string, content: string): Promise<void> {
  await assertNoSymlinkSegments(workTree, repoRelative)
  const target = workTreePath(workTree, repoRelative)
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  const temporary = `${target}.${randomBytes(6).toString('hex')}.tmp`
  const handle = await open(temporary, 'w', 0o600)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    throw new SyncError('invalid-path', `无法写入备份文件 / failed to write backup file: ${repoRelative}`, {
      cause: error,
    })
  }
}

/**
 * Read one repository file, refusing to traverse any symbolic link on the way.
 *
 * Repository contents are untrusted: a backup can commit a symlink such as
 * `profiles -> ~/.ssh`, so every read walks the path segments first.
 */
export async function readRepoFile(workTree: string, repoRelative: string): Promise<string | null> {
  await assertNoSymlinkSegments(workTree, repoRelative)
  return await readWorkTreeFile(workTreePath(workTree, repoRelative))
}

/** List one repository directory, refusing symlinked paths. */
export async function listRepoDirectory(workTree: string, repoRelative: string): Promise<Dirent[] | null> {
  await assertNoSymlinkSegments(workTree, repoRelative)
  return await listDirectoryEntries(workTreePath(workTree, repoRelative))
}

/** Read a UTF-8 file without following a symlink; null when it does not exist. */
export async function readWorkTreeFile(path: string): Promise<string | null> {
  let stats
  try {
    stats = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  if (stats.isSymbolicLink()) {
    throw new SyncError('invalid-manifest', '备份仓库包含符号链接，已拒绝读取 / backup repository contains a symbolic link; refusing to read it')
  }
  if (!stats.isFile()) {
    throw new SyncError('invalid-manifest', '备份路径不是普通文件 / backup path is not a regular file')
  }
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** Delete one file inside the work tree; a missing file is a no-op. */
export async function deleteWorkTreeFile(workTree: string, repoRelative: string): Promise<boolean> {
  await assertNoSymlinkSegments(workTree, repoRelative)
  const target = workTreePath(workTree, repoRelative)
  try {
    await lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  await rm(target, { force: true })
  return true
}

/** List a directory without following symlinks; null when it does not exist. */
export async function listDirectoryEntries(path: string): Promise<Dirent[] | null> {
  let stats
  try {
    stats = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  if (stats.isSymbolicLink()) {
    throw new SyncError('invalid-manifest', '备份仓库包含符号链接目录，已拒绝读取 / backup repository contains a symlinked directory; refusing to read it')
  }
  if (!stats.isDirectory()) {
    throw new SyncError('invalid-manifest', '备份路径不是目录 / backup path is not a directory')
  }
  return await readdir(path, { withFileTypes: true })
}
