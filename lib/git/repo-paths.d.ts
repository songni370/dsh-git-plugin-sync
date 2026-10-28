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
import type { Dirent } from 'node:fs';
import { DEVICE_ID_PATTERN } from '../manifest/manifest.js';
/** Device IDs become directory names; kept to one conservative segment. */
export { DEVICE_ID_PATTERN };
/** Every repository-relative path of one backup entry point. */
export interface BackupPaths {
    /** Backup root (`''` means the repository root). */
    root: string;
    /** `manifest.json` */
    manifest: string;
    /** `metadata/schema.json` */
    schema: string;
    /** `README.md` */
    readme: string;
    /** `profiles/<profile>/plugins.json` */
    profileState: string;
    /** `profiles/<profile>/configs` */
    configsDir: string;
    /** `profiles/<profile>/configs/<plugin>.json` */
    config: string;
    /** `devices` */
    devicesDir: string;
    /** `devices/<deviceId>/<profile>.json` */
    deviceSnapshot: string;
}
/** Throw a typed error for an invalid profile name. */
export declare function assertProfileName(profile: string): string;
/** Throw a typed error for an invalid device id. */
export declare function assertDeviceId(deviceId: string): string;
/** Throw a typed error for a plugin id that cannot be a file name. */
export declare function assertPluginId(pluginId: string): string;
/** Repository-relative path of a profile's shared state. */
export declare function profileStatePath(backupDir: string, profile: string): string;
/** Repository-relative path of a profile's config directory. */
export declare function configsDirPath(backupDir: string, profile: string): string;
/** Repository-relative path of one plugin's config file. */
export declare function configPath(backupDir: string, profile: string, pluginId: string): string;
/** Repository-relative path of one device snapshot. */
export declare function deviceSnapshotPath(backupDir: string, deviceId: string, profile: string): string;
/** Repository-relative path of the root manifest. */
export declare function manifestPath(backupDir: string): string;
/** Repository-relative path of the machine-readable layout document. */
export declare function schemaPath(backupDir: string): string;
/** Repository-relative path of the human warning README. */
export declare function readmePath(backupDir: string): string;
/** Repository-relative path of the device snapshots directory. */
export declare function devicesDirPath(backupDir: string): string;
/**
 * Every path used by one profile/device/plugin combination.
 *
 * This is the helper the sync services use so they never build a layout path by
 * hand.
 */
export declare function backupPaths(backupDir: string, profile: string, pluginId: string, deviceId: string): BackupPaths;
/** Normalize the configured backup directory, turning failures into typed errors. */
export declare function normalizeBackupDirectory(input: string | undefined): string;
/** A write target resolved against the backup directory. */
export interface ResolvedTarget {
    /** Path relative to the repository root. */
    repo: string;
    /** Path relative to the backup directory. */
    backup: string;
}
/**
 * Resolve one caller-supplied file path.
 *
 * Accepts both repository-relative (`backup/x.json`) and backup-relative
 * (`x.json`) forms. Absolute paths, parent traversal, URL schemes, NUL bytes and
 * `.git` are refused.
 * @throws {SyncError} code `invalid-path`.
 */
export declare function resolveTarget(backupDir: string, input: string): ResolvedTarget;
/** Resolve a repository-relative path inside the work tree with safety checks. */
export declare function workTreePath(workTree: string, repoRelative: string): string;
/** Write one UTF-8 file atomically inside the work tree. */
export declare function writeWorkTreeFile(workTree: string, repoRelative: string, content: string): Promise<void>;
/**
 * Read one repository file, refusing to traverse any symbolic link on the way.
 *
 * Repository contents are untrusted: a backup can commit a symlink such as
 * `profiles -> ~/.ssh`, so every read walks the path segments first.
 */
export declare function readRepoFile(workTree: string, repoRelative: string): Promise<string | null>;
/** List one repository directory, refusing symlinked paths. */
export declare function listRepoDirectory(workTree: string, repoRelative: string): Promise<Dirent[] | null>;
/** Read a UTF-8 file without following a symlink; null when it does not exist. */
export declare function readWorkTreeFile(path: string): Promise<string | null>;
/** Delete one file inside the work tree; a missing file is a no-op. */
export declare function deleteWorkTreeFile(workTree: string, repoRelative: string): Promise<boolean>;
/** List a directory without following symlinks; null when it does not exist. */
export declare function listDirectoryEntries(path: string): Promise<Dirent[] | null>;
