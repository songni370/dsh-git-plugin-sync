/**
 * Local persistence: configuration, runtime state, device identity and paths.
 *
 * The plugin keeps its own files under `<DSH home>/dsh-plugins-git-sync`, never
 * inside the DSH profile package files and never inside the backup repository.
 * Configuration contains no secrets: an HTTPS token is read from an environment
 * variable at Git-invocation time, and only the variable's *name* is stored.
 * @module state/store
 */
import type { AutoSyncConfig, DeviceInfo, LocalState, SyncConfig } from '../types.js';
/** Absolute locations of this plugin's local files. */
export interface StorePaths {
    dataDir: string;
    configPath: string;
    statePath: string;
    logPath: string;
    snapshotDir: string;
    workDir: string;
    archiveDir: string;
}
/** Resolve every local path from the DSH home. */
export declare function resolveStorePaths(dshHome: string): StorePaths;
/** Ensure a private directory exists. */
export declare function ensurePrivateDir(path: string): Promise<void>;
/** Write a file atomically (temp file + rename) with owner-only permissions. */
export declare function writeFileAtomic(path: string, content: string): Promise<void>;
/** Whether a file exists. */
export declare function fileExists(path: string): Promise<boolean>;
/** Default auto-sync configuration: off until the user enables it. */
export declare function defaultAutoSync(): AutoSyncConfig;
/** Default configuration; auto-sync deliberately disabled. */
export declare function defaultConfig(): SyncConfig;
/** Default device name from the OS host name. */
export declare function defaultDeviceName(): string;
/** Trim control characters and cap length. */
export declare function sanitizeDeviceName(input: string): string;
/** Git branch validation (a conservative subset of `git check-ref-format`). */
export declare function isSafeBranchName(branch: string): boolean;
/** Repository URL validation; returns a normalized URL. */
export declare function validateRepoUrl(raw: string): string;
/** Validate a profile name. */
export declare function isSafeProfileName(name: string): boolean;
/**
 * Validate and normalize untrusted configuration (written by the UI, a tool, or
 * an older version of this plugin). Unknown keys are dropped.
 */
export declare function normalizeConfig(input: unknown, activeProfile: string, availableProfiles: string[]): SyncConfig;
/** Persisted configuration file. */
export declare class ConfigStore {
    private readonly onNormalize;
    readonly path: string;
    constructor(path: string, onNormalize: (input: unknown) => SyncConfig);
    /**
     * Read and normalize the configuration; a corrupt file falls back to defaults.
     *
     * Deliberately uncached: the file is small, and the settings page, an agent
     * tool and a synchronization can all read it inside one polling window. A
     * cache here once hid an external edit until the next DSH restart.
     */
    read(): Promise<SyncConfig>;
    /** Persist a normalized configuration. */
    write(config: SyncConfig): Promise<void>;
}
/** Default empty local state. */
export declare function defaultState(device: DeviceInfo): LocalState;
/** Persisted runtime state. */
export declare class StateStore {
    private readonly createDefault;
    readonly path: string;
    private cached;
    constructor(path: string, createDefault: () => LocalState);
    /** Read the state, falling back to a fresh default when absent or corrupt. */
    read(): Promise<LocalState>;
    /** Persist the state atomically. */
    write(state: LocalState): Promise<void>;
}
/** Stable device identity for this DSH home. */
export declare function createDeviceInfo(options: {
    existing?: DeviceInfo | null;
    name: string;
    dshVersion: string;
    pluginVersion: string;
}): DeviceInfo;
