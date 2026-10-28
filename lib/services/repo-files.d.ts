/**
 * Conversion between in-memory synchronization state and the files that live
 * in the user's backup repository.
 *
 * Absolute machine paths never cross this boundary: a `PluginRecord.localPath`
 * is stripped before serialization, and configuration values were already
 * filtered for secrets by the scanner. Every file is derived from data (never
 * copied from a directory tree), so the backup stays diff-friendly.
 * @module services/repo-files
 */
import type { DeviceSnapshot, JsonObject, Manifest, PluginRecord, RemoteConfigEntry, RemotePluginEntry, RemoteProfileState, SyncBaseline } from '../types.js';
import { type PluginState } from './model.js';
/**
 * Make a row's module name safe to store.
 *
 * A DSH row can name a module through an absolute `file:///…` URL (the
 * cc-safety-net bundle does this in practice). Such a value is device-specific
 * and must never reach a shared repository, so it is replaced with the plugin's
 * package name; ordinary package names and subpaths are kept.
 */
export declare function sanitizeModuleName(moduleName: string, fallbackName: string): string;
/** Strip machine-only fields before a plugin record enters the backup. */
export declare function sanitizePluginRecord(record: PluginRecord): PluginRecord;
/** Join repository-relative path segments with POSIX separators. */
export declare function joinRepoPath(...segments: readonly string[]): string;
/** Path of one profile's shared plugin state. */
export declare function profileStatePath(backupDir: string, profile: string): string;
/** Path of one plugin's config file. */
export declare function configPath(backupDir: string, profile: string, pluginId: string): string;
/** Path of one device snapshot. */
export declare function deviceSnapshotPath(backupDir: string, deviceId: string, profile: string): string;
/** Build the repository entry for one plugin. */
export declare function toRemoteEntry(state: PluginState, options: {
    deviceId: string;
    now: string;
}): RemotePluginEntry;
/** Build a tombstone entry that records a deliberate removal. */
export declare function toTombstone(previous: RemotePluginEntry | undefined, state: PluginState | null, options: {
    deviceId: string;
    now: string;
}): RemotePluginEntry;
/** Build a device snapshot with machine paths stripped. */
export declare function toDeviceSnapshot(options: {
    device: DeviceSnapshot['device'];
    profile: string;
    now: string;
    plugins: readonly PluginRecord[];
}): DeviceSnapshot;
/** Build a profile state document from its entries. */
export declare function toProfileState(profile: string, now: string, entries: Record<string, RemotePluginEntry>): RemoteProfileState;
/** Build a config file document. */
export declare function toConfigEntry(pluginId: string, configs: JsonObject, options: {
    deviceId: string;
    now: string;
}): RemoteConfigEntry;
/** Input to {@link buildBackupFiles}. */
export interface BuildBackupFilesInput {
    backupDir: string;
    /** Running plugin version, recorded in the manifest generator field. */
    generatorVersion: string;
    profile: string;
    deviceId: string;
    now: string;
    previousManifest: Manifest | null;
    previousState: RemoteProfileState | null;
    /** Entries to create or replace. */
    upserts: readonly {
        entry: RemotePluginEntry;
        configs?: JsonObject;
    }[];
    /** Plugin ids to tombstone / delete configs for. */
    removals: readonly string[];
    /** Config files to delete without tombstoning the plugin (config became empty). */
    configDeletions?: readonly string[];
    /** This device's snapshot for this profile. */
    deviceSnapshot: DeviceSnapshot;
    /** Device ids already known to the repository. */
    knownDevices: readonly string[];
}
/** The repository file set a backup produces. */
export interface BackupFiles {
    files: Record<string, string>;
    deletions: string[];
}
/** Build every file a backup/sync writes, plus the paths to delete. */
export declare function buildBackupFiles(input: BuildBackupFilesInput): BackupFiles;
/** Build a baseline from converged local/remote state maps. */
export declare function buildBaseline(options: {
    profile: string;
    commit: string | null;
    now: string;
    local: Record<string, PluginState>;
    remote: Record<string, PluginState>;
    previous: SyncBaseline | undefined;
}): SyncBaseline;
/** Serialize a plugin state map (used by tests and snapshots). */
export declare function serializeStates(states: Record<string, PluginState>): string;
