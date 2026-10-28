/**
 * The single orchestration surface used by both the settings page and the agent
 * tools.
 *
 * One operation is implemented once here; the HTTP routes and the tools are
 * thin adapters that call these methods with the same meaning. The engine owns
 * the mutex (one synchronization at a time), the safety snapshot, the baseline
 * update and the persisted status.
 * @module services/engine
 */
import type { FileSyncLogger } from '../core/logger.js';
import type { ConfigStore, StateStore } from '../state/store.js';
import type { ConnectionTestResult, ConflictResolution, ConfigGateway, HistoryEntry, InventoryScanner, LocalState, OperationResult, PluginInstaller, RepoStore, SyncConfig, SyncConfigView, SyncPlan } from '../types.js';
import type { PluginListResponse } from '../http/api-types.js';
/** Everything the engine needs, injected by the plugin entry. */
export interface EngineDeps {
    logger: FileSyncLogger;
    configStore: ConfigStore;
    stateStore: StateStore;
    paths: {
        dataDir: string;
        workDir: string;
        snapshotDir: string;
        archiveDir: string;
        logPath: string;
    };
    scanner: InventoryScanner;
    configGateway: ConfigGateway;
    installer: PluginInstaller;
    pluginVersion: string;
    dshVersion: string;
    activeProfile: string;
    availableProfiles: string[];
    platform: string;
    env: NodeJS.ProcessEnv;
    /** Build a repository store for one configuration (work dir is stable per repo+branch). */
    createRepo: (config: SyncConfig) => {
        store: RepoStore;
        workDir: string;
    };
    /** Called after the configuration changed (auto-sync reconciliation). */
    onConfigChanged?: (config: SyncConfig) => void;
}
/** Options for read-only views. */
export interface StatusOptions {
    /** Fetch the repository before computing counts. */
    refresh?: boolean;
}
/** Backup options. */
export interface BackupOptions {
    message?: string;
    confirmDestructive?: boolean;
    signal?: AbortSignal;
}
/** Restore options. */
export interface RestoreOptions {
    commit?: string;
    pluginIds?: string[];
    resolutions?: ConflictResolution[];
    confirmDestructive?: boolean;
    signal?: AbortSignal;
}
/** Sync options. */
export interface SyncOptions {
    resolutions?: ConflictResolution[];
    confirmDestructive?: boolean;
    signal?: AbortSignal;
}
/** Diff options. */
export interface DiffOptions {
    direction?: 'push' | 'pull' | 'two-way';
    commit?: string;
    signal?: AbortSignal;
}
/** Create the engine. */
export declare function createEngine(deps: EngineDeps): SyncEngine;
/** The orchestration engine. */
export declare class SyncEngine {
    private readonly deps;
    private readonly mutex;
    private readonly snapshots;
    private scanCache;
    private scanInFlight;
    /**
     * One prepared RepoStore per configuration.
     *
     * A RepoStore prepares once (clone/fetch/reset) and then reads the local work
     * tree; creating a fresh store for every status poll made each poll run a
     * full `fetch`+`reset`, so concurrent page requests raced on the same working
     * tree and the settings page appeared to load forever. The key covers every
     * setting that changes the remote or its auth, so a configuration change
     * gets a fresh store.
     */
    private repoCache;
    private busy;
    private lastError;
    constructor(deps: EngineDeps);
    /** Whether an operation currently runs. */
    isBusy(): boolean;
    /** Latest error observed by the engine (used by the status panel). */
    currentError(): string | null;
    /** Read the status payload for the settings page. */
    status(options?: StatusOptions): Promise<{
        status: import('../types.js').StatusView;
        logs: import('../types.js').LogEntry[];
    }>;
    /** Save configuration from the settings page. */
    saveConfig(patch: Partial<SyncConfig>): Promise<{
        config: SyncConfigView;
    }>;
    /** Test repository connectivity, optionally with unsaved values. */
    testConnection(patch?: Partial<SyncConfig>): Promise<ConnectionTestResult>;
    /** List plugins with their sync status for the settings page. */
    listPlugins(): Promise<PluginListResponse>;
    /** Compute the plan for a direction without executing anything. */
    diff(options?: DiffOptions): Promise<{
        direction: 'push' | 'pull' | 'two-way';
        plan: SyncPlan;
    }>;
    /** Back up this device's plugin state to the repository. */
    backup(options?: BackupOptions): Promise<OperationResult>;
    /** Preview a restore from the branch head or one commit. */
    previewRestore(options?: {
        commit?: string;
        signal?: AbortSignal;
    }): Promise<{
        plan: SyncPlan;
        snapshotPlanned: boolean;
        source: {
            commit: string | null;
            updatedAt: string | null;
        };
    }>;
    /** Restore plugins from the repository (never deletes local extras). */
    restore(options?: RestoreOptions): Promise<OperationResult>;
    /** Restore one history commit; always takes a snapshot first. */
    rollback(options: RestoreOptions & {
        commit: string;
    }): Promise<OperationResult>;
    /** Preview a two-way sync. */
    previewSync(signal?: AbortSignal): Promise<{
        plan: SyncPlan;
    }>;
    /** Perform a two-way synchronization. */
    sync(options?: SyncOptions): Promise<OperationResult>;
    /** Read backup history from Git. */
    history(options?: {
        limit?: number;
        signal?: AbortSignal;
    }): Promise<{
        entries: HistoryEntry[];
        lastOperation: LocalState['lastOperation'];
    }>;
    /** Update automatic synchronization settings. */
    setAutoSync(patch: Partial<SyncConfig['autoSync']>): Promise<{
        status: Awaited<ReturnType<SyncEngine['status']>>;
    }>;
    /** Recent log entries. */
    logs(options?: {
        limit?: number;
    }): {
        entries: import('../types.js').LogEntry[];
    };
    /** Snapshot ids available for rollback. */
    listSnapshots(): Promise<string[]>;
    /** Roll back the configuration/enablement half of one snapshot. */
    rollbackSnapshot(id: string): Promise<OperationResult>;
    /** Build a plan input from the current reads. */
    private planInput;
    /** Build the repository file set for one plan. */
    private buildRemoteFiles;
    /** Return the cached store for this configuration, creating it on change. */
    private repoFor;
    /** Read everything needed from the repository. */
    private readRemote;
    /** Read a repository state at one commit. */
    private readAtCommit;
    /** Execute a restore (or history rollback) with a safety snapshot. */
    private runRestore;
    /** Best-effort rollback of a snapshot after a failed local operation. */
    private tryRollback;
    /** Resolve a `backup-tarball:<repo-relative path>` install spec. */
    private resolveTarballSpec;
    /** Preview a backup (used by the diff view). */
    private previewBackup;
    /** Read configuration. */
    private readConfig;
    /** Read local state. */
    private readState;
    /** Keep the persisted device identity in step with configuration/versions. */
    private persistDeviceIfChanged;
    /**
     * Drop the cached inventory: the profile's plugins changed.
     *
     * Called from the `plugin-manager/changed` listener; the next read rescans.
     */
    invalidateScan(): void;
    /**
     * Scan the local profile, with a cache shared by concurrent callers.
     *
     * The settings page fires status + plugin list together, and the status
     * poll runs every five seconds; without single-flight each of those ran a
     * full scan. A plugin-manager change invalidates the cache immediately, and
     * a forced scan (after an install/remove) bypasses it.
     */
    private scanLocal;
    /** Configuration view without secrets. */
    private configView;
    /** Human-readable authentication method (never the secret). */
    private authMethod;
    /** Throw when the repository is not configured. */
    private ensureConfigured;
    /** Record a failed operation in state and logs. */
    private recordFailure;
    /** Compose a commit message. */
    private commitMessage;
}
