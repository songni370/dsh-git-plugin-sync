/**
 * Domain model shared by the scanner, Git store, sync engine, HTTP surface,
 * agent tools and the Web UI.
 *
 * Everything in a backup manifest is versioned by {@link Manifest.schemaVersion}
 * so a future release can migrate an old repository instead of guessing.
 * @module types
 */
/** Lossless JSON value; the only shape a backup may contain. */
export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
/** Lossless JSON object. */
export type JsonObject = {
    [key: string]: JsonValue;
};
/** Where an installed plugin came from. */
export type PluginOrigin = 'npm' | 'git' | 'local-path' | 'tarball' | 'official' | 'unknown';
/** Which layer provides a plugin on this machine. */
export type PluginLayer = 'profile' | 'installation';
/** Authentication strategy for the backup repository. */
export type GitAuthMode = 'credential-helper' | 'ssh' | 'https-token';
/** Which operation an automatic run performs. */
export type AutoSyncMode = 'two-way' | 'backup' | 'restore';
/** How the automatic synchronizer behaves. */
export interface AutoSyncConfig {
    /** Master switch. Absent or false leaves auto-sync completely off. */
    enabled: boolean;
    /** Operation an automatic run performs; defaults to a two-way sync. */
    mode: AutoSyncMode;
    /** Periodic sync interval in minutes; 0 disables the timer. */
    intervalMinutes: number;
    /** Delay before the startup-triggered sync, in milliseconds. */
    startupDelayMs: number;
    /** Run one sync after DSH startup. */
    onStartup: boolean;
    /** Queue a sync after DSH reports a plugin change (debounced). */
    onPluginChange: boolean;
    /** Debounce window for change-triggered syncs, in milliseconds. */
    debounceMs: number;
}
/** One installed plugin row (a bundle may declare several). */
export interface PluginRowRecord {
    /** Loader entry identity on the scanning device, when one exists. */
    entryId?: string;
    /** Patch row id declared by the bundle. */
    rowId?: string;
    /** Installed module name. */
    moduleName: string;
    enabled: boolean;
}
/**
 * One plugin as scanned on a device, or as stored in the shared profile state.
 *
 * `id` is the identity used for matching across devices: the npm package name
 * for registry/git/tarball plugins, and a `local:<name>` key for a plugin that
 * only exists as a directory on one machine.
 */
export interface PluginRecord {
    id: string;
    /** npm package name (or the directory name of a local plugin). */
    name: string;
    displayName?: string;
    version: string | null;
    origin: PluginOrigin;
    /** Where the plugin came from, already sanitized for storage. */
    source?: string;
    /**
     * A reproducible spec accepted by `pluginManager.installBundle`, when the
     * plugin can be installed on another device (`name@1.2.3`, a git URL, or a
     * tarball path inside the backup work tree).
     */
    installSpec: string | null;
    enabled: boolean;
    /** Built-in / installation-provided plugins are listed but never reinstalled. */
    builtIn: boolean;
    /** Whether this plugin may be synchronized at all (third-party and restorable). */
    syncable: boolean;
    /** True for a plugin that can only be restored from an archived source. */
    pathOnly: boolean;
    /** Human-readable local path of a local plugin; never written to a backup. */
    localPath?: string;
    profile: string;
    platform: string;
    rows: PluginRowRecord[];
    /** Non-sensitive configuration values keyed by their config key. */
    configs: Record<string, JsonValue>;
    /** Config keys that were deliberately omitted because they may be secret. */
    configSkipped: string[];
    /** Archive of a local plugin (opt-in), relative to the backup directory. */
    archive?: PluginArchive;
    /** Set when the scanner could not fully inspect the plugin. */
    error?: string;
}
/** A local-plugin source archive stored in the backup repository. */
export interface PluginArchive {
    file: string;
    sha256: string;
    size: number;
}
/** Device identity recorded with every backup. */
export interface DeviceInfo {
    /** Stable random identifier generated once per DSH home. */
    id: string;
    /** User-visible device name (defaults to the host name). */
    name: string;
    /** `process.platform` of the device. */
    platform: string;
    /** CPU architecture. */
    arch: string;
    /** DSH version of the device. */
    dshVersion: string;
    /** Version of this plugin on the device. */
    pluginVersion: string;
}
/** A full scan result for one profile on one device. */
export interface DeviceInventory {
    schemaVersion: number;
    generatedAt: string;
    profile: string;
    device: DeviceInfo;
    plugins: PluginRecord[];
}
/**
 * One plugin entry in the shared repository state.
 *
 * `deleted` is a tombstone: it records that a device deliberately removed the
 * plugin, so another device's sync can offer the removal instead of silently
 * resurrecting it.
 */
export interface RemotePluginEntry {
    id: string;
    name: string;
    displayName?: string;
    version: string | null;
    origin: PluginOrigin;
    source?: string;
    installSpec: string | null;
    enabled: boolean;
    builtIn: boolean;
    syncable: boolean;
    pathOnly: boolean;
    rows: PluginRowRecord[];
    /** Config keys omitted because they may be secret (informational). */
    configSkipped?: string[];
    deleted?: boolean;
    updatedAt: string;
    updatedBy: string;
}
/** `profiles/<profile>/plugins.json` — the shared desired state for one profile. */
export interface RemoteProfileState {
    schemaVersion: number;
    profile: string;
    updatedAt: string;
    plugins: Record<string, RemotePluginEntry>;
}
/** `profiles/<profile>/configs/<id>.json`. */
export interface RemoteConfigEntry {
    pluginId: string;
    updatedAt: string;
    updatedBy: string;
    configs: Record<string, JsonValue>;
}
/** `devices/<deviceId>/<profile>.json`. */
export interface DeviceSnapshot {
    schemaVersion: number;
    device: DeviceInfo;
    profile: string;
    updatedAt: string;
    plugins: PluginRecord[];
}
/** `manifest.json` at the repository root: the index of the whole backup. */
export interface Manifest {
    schemaVersion: number;
    generator: {
        name: string;
        version: string;
    };
    createdAt: string;
    updatedAt: string;
    /** Per-profile plugin counts for a fast status read. */
    profiles: Record<string, {
        pluginCount: number;
        updatedAt: string;
    }>;
    /** Device IDs whose snapshots exist in this repository. */
    devices: string[];
}
/** How the backup directory should be laid out. */
export interface RepoLayout {
    /** Directory inside the repository that holds the backup (`''` = root). */
    backupDir: string;
}
/** Local, non-secret configuration of this plugin. */
export interface SyncConfig {
    /** Repository URL (https, ssh, scp-like, or `file://`). */
    repoUrl: string;
    /** Branch to push to and pull from. */
    branch: string;
    /** Directory inside the repository that holds the data. */
    backupDir: string;
    authMode: GitAuthMode;
    /** Name of the environment variable holding an HTTPS token; never the token. */
    tokenEnvVar: string;
    /** HTTPS username paired with the token (defaults per provider). */
    username: string;
    /** DSH profiles to include in backups. The active profile is always included. */
    profiles: string[];
    /** Extract and synchronize plugin configuration values. */
    includeConfigs: boolean;
    /** Include local-development plugins by archiving their source (opt-in). */
    includeLocalPlugins: boolean;
    /** Plugin ids never synchronized. */
    excludedPlugins: string[];
    /** Plugin ids whose configs are never synchronized. */
    excludedConfigPlugins: string[];
    autoSync: AutoSyncConfig;
    /** Device name shown in history and status. */
    deviceName: string;
    /** Whether a sync may remove plugins that another device deleted. */
    allowPluginRemoval: boolean;
}
/** Configuration as shown to the UI: secrets never leave the host. */
export interface SyncConfigView extends SyncConfig {
    /** Whether the configured token environment variable is present and non-empty. */
    tokenAvailable: boolean;
    /** Effective device identity. */
    device: DeviceInfo;
    /** Profile this process is running in. */
    activeProfile: string;
    /** Profiles present in this DSH home. */
    availableProfiles: string[];
    /** Where this plugin keeps its data (display form). */
    dataDir: string;
}
/** How one plugin differs between two states. */
export type DiffKind = 'missing-local' | 'missing-remote' | 'version-diff' | 'config-diff' | 'enabled-diff' | 'deleted-remote' | 'new-local' | 'new-remote' | 'identical';
/** One plugin-level difference, for previews and the plugin list. */
export interface PluginDiff {
    id: string;
    name: string;
    displayName?: string;
    kind: DiffKind;
    /** Local side of the comparison, when present. */
    local?: PluginRecord;
    /** Remote side of the comparison, when present. */
    remote?: RemotePluginEntry;
    /** Base (last synchronized) side, when present. */
    base?: PluginRecord;
    /** Config keys whose values differ. */
    configChangedKeys?: string[];
    /** Set when this difference will remove something locally or remotely. */
    destructive: boolean;
    /** Set when the difference cannot be resolved automatically. */
    conflict?: ConflictInfo;
}
/** Everything a caller needs to decide about a conflict. */
export interface ConflictInfo {
    id: string;
    pluginId: string;
    pluginName: string;
    /** Human-readable reason. */
    reason: string;
    /** Field paths that differ, e.g. `version`, `enabled`, `config.timeout`. */
    fields: string[];
    localVersion: string | null;
    remoteVersion: string | null;
    localEnabled: boolean | null;
    remoteEnabled: boolean | null;
    localConfig?: Record<string, JsonValue>;
    remoteConfig?: Record<string, JsonValue>;
    baseConfig?: Record<string, JsonValue>;
    /** Device that produced the remote change, when known. */
    remoteDevice?: string;
    /** When the remote change was recorded. */
    remoteUpdatedAt?: string;
}
/** A user's decision for one conflict. */
export type ConflictChoice = 'local' | 'remote' | 'skip' | 'manual';
/** Resolution payload for one conflict. */
export interface ConflictResolution {
    pluginId: string;
    choice: ConflictChoice;
    /** Replacement config for `manual`; omitted fields keep the chosen side. */
    manualConfig?: Record<string, JsonValue>;
}
/** One executable step a sync plan produced. */
export type PlanActionKind = 'install' | 'upgrade' | 'downgrade' | 'enable' | 'disable' | 'restore-config' | 'remove-local' | 'push-plugin' | 'push-config' | 'remove-remote';
/** One executable step. */
export interface PlanAction {
    kind: PlanActionKind;
    pluginId: string;
    pluginName: string;
    /** Detail for the UI. */
    detail: string;
    /** Removing a plugin locally or remotely is destructive. */
    destructive: boolean;
    /** Install spec for install/upgrade/downgrade actions. */
    installSpec?: string;
    version?: string;
    enabled?: boolean;
    configs?: Record<string, JsonValue>;
    /** Current value used for the change (for logs and previews). */
    from?: string;
}
/** A complete plan: what a backup / restore / sync would do. */
export interface SyncPlan {
    direction: 'push' | 'pull' | 'two-way';
    profile: string;
    generatedAt: string;
    actions: PlanAction[];
    /** Differences that require a user decision. */
    conflicts: ConflictInfo[];
    /** Differences found but not actionable in this direction. */
    diffs: PluginDiff[];
    /** Destructive actions are present and require explicit confirmation. */
    requiresConfirmation: boolean;
    /** Human-readable warnings (skipped platform-specific plugin, ...). */
    warnings: string[];
    localPluginCount: number;
    remotePluginCount: number;
}
/** Per-action execution outcome. */
export interface ActionOutcome {
    action: PlanAction;
    ok: boolean;
    skipped?: boolean;
    detail?: string;
    error?: string;
}
/** What an operation produced. */
export interface OperationResult {
    ok: boolean;
    operation: 'backup' | 'restore' | 'sync' | 'rollback';
    startedAt: string;
    finishedAt: string;
    commit?: string | null;
    pushed?: boolean;
    noChanges?: boolean;
    actionOutcomes: ActionOutcome[];
    warnings: string[];
    error?: string;
    /** Snapshot directory created before a destructive operation. */
    snapshot?: string;
}
/** High-level synchronization state shown by the settings page. */
export type SyncState = 'not-configured' | 'synced' | 'ahead' | 'behind' | 'diverged' | 'conflict' | 'error' | 'syncing' | 'unknown';
/** Last operation, for the status panel. */
export interface LastOperation {
    operation: 'backup' | 'restore' | 'sync' | 'rollback';
    at: string;
    ok: boolean;
    error?: string;
    commit?: string | null;
    changedPlugins?: number;
}
/** Everything the settings page needs for its status area. */
export interface StatusView {
    state: SyncState;
    config: SyncConfigView;
    branch: string;
    lastSyncAt: string | null;
    lastCommit: string | null;
    lastOperation: LastOperation | null;
    localPluginCount: number;
    remotePluginCount: number | null;
    pendingUploads: number;
    pendingDownloads: number;
    conflictCount: number;
    lastError: string | null;
    /** Whether an operation currently runs. */
    busy: boolean;
    /** Repository reachability from the last check. */
    connection: ConnectionTestResult | null;
}
/** Outcome of a repository connectivity test. */
export interface ConnectionTestResult {
    ok: boolean;
    at: string;
    branch?: string;
    head?: string | null;
    message: string;
    /** How authentication resolved (never includes the secret). */
    authMethod?: string;
}
/** One Git commit of the backup repository. */
export interface HistoryEntry {
    commit: string;
    shortCommit: string;
    date: string;
    author: string;
    subject: string;
    /** Operation recorded by this plugin (`backup` / `restore` / `sync` / ...). */
    operation: string;
    deviceId?: string;
    deviceName?: string;
    profile?: string;
    pluginCount?: number;
    result?: string;
}
/** Metadata trailers this plugin writes into every backup commit. */
export interface CommitTrailers {
    operation: string;
    deviceId: string;
    deviceName: string;
    profile: string;
    result: string;
    pluginCount: string;
    [key: string]: string;
}
/** A plugin state baseline used to attribute changes to the correct device. */
export interface BaselineEntry {
    version: string | null;
    enabled: boolean;
    configs: Record<string, JsonValue>;
    /** Fingerprint of the record for cheap equality checks. */
    hash: string;
}
/** Local baseline: "what this device last agreed with the repository about". */
export interface SyncBaseline {
    profile: string;
    /** Repository commit the baseline was taken at. */
    commit: string | null;
    updatedAt: string;
    plugins: Record<string, BaselineEntry>;
}
/** Unresolved conflicts from the last sync. */
export interface PendingConflict {
    pluginId: string;
    conflict: ConflictInfo;
    detectedAt: string;
}
/** Local, persisted runtime state (not the configuration). */
export interface LocalState {
    schemaVersion: number;
    device: DeviceInfo;
    lastSyncAt: string | null;
    lastCommit: string | null;
    lastOperation: LastOperation | null;
    lastError: string | null;
    baselines: Record<string, SyncBaseline>;
    conflicts: PendingConflict[];
    connection: ConnectionTestResult | null;
    /** Consecutive failed automatic synchronizations, for backoff. */
    autoSyncFailures: number;
}
/** Logger used by every module; implementations must redact secrets. */
export interface SyncLogger {
    debug(message: string, details?: JsonValue): void;
    info(message: string, details?: JsonValue): void;
    warn(message: string, details?: JsonValue): void;
    error(message: string, details?: JsonValue): void;
    /** Recent entries for the settings page. */
    recent(limit?: number): LogEntry[];
}
/** One log record. */
export interface LogEntry {
    at: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    details?: JsonValue;
}
/** Scans a device profile into a {@link DeviceInventory}. */
export interface InventoryScanner {
    scan(options: {
        config: SyncConfig;
        profile: string;
        signal?: AbortSignal;
    }): Promise<DeviceInventory>;
}
/** Installs, removes, and toggles plugins through the DSH plugin manager. */
export interface PluginInstaller {
    /** Install one exact spec; resolves with the plugin manager's outcome. */
    install(spec: string, options: {
        profile: string;
        signal?: AbortSignal;
    }): Promise<InstallOutcome>;
    /** Enable or disable a plugin identified by its module name. */
    setEnabled(moduleName: string, enabled: boolean, options: {
        profile: string;
    }): Promise<ToggleOutcome>;
    /** Remove an installed plugin (opt-in, destructive). */
    remove(moduleName: string, options: {
        profile: string;
    }): Promise<InstallOutcome>;
    /** Report whether a newer version is available for one plugin. */
    latestVersion(moduleName: string, signal?: AbortSignal): Promise<string | null>;
}
/** Normalized install result. */
export interface InstallOutcome {
    ok: boolean;
    changed: boolean;
    application: string;
    message: string;
    version?: string;
    pendingBuilds?: string[];
    error?: string;
}
/** Normalized enable/disable result. */
export interface ToggleOutcome {
    ok: boolean;
    changed: boolean;
    application: string;
    message: string;
    error?: string;
}
/** Reads and writes plugin configuration through the Loader/settings path. */
export interface ConfigGateway {
    /** Read the configs that may be synchronized for one plugin module. */
    read(options: {
        moduleName: string;
        entryIds: string[];
        profile: string;
    }): Promise<PluginConfigRead>;
    /** Write synchronized config values for one plugin module. */
    write(options: {
        moduleName: string;
        entryIds: string[];
        values: Record<string, JsonValue>;
        profile: string;
    }): Promise<void>;
}
/** Config values plus the keys deliberately dropped as sensitive. */
export interface PluginConfigRead {
    values: Record<string, JsonValue>;
    skippedKeys: string[];
}
/** Git command runner. */
export interface GitRunner {
    run(args: string[], options?: {
        cwd?: string;
        env?: Record<string, string>;
        signal?: AbortSignal;
        timeoutMs?: number;
    }): Promise<GitRunResult>;
}
/** Result of one Git invocation. */
export interface GitRunResult {
    code: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}
/** Repository store: the only module that talks to Git and the work tree. */
export interface RepoStore {
    /** Clone or refresh the work tree; returns the current HEAD commit. */
    prepare(options?: {
        signal?: AbortSignal;
    }): Promise<RepoPrepareResult>;
    /** Whether this store instance already prepared (read-only local access is safe). */
    prepared(): boolean;
    /** Read the root manifest, or null when the repository is empty. */
    readManifest(): Promise<Manifest | null>;
    /** Read one profile's shared state. */
    readProfileState(profile: string): Promise<RemoteProfileState | null>;
    /** Read one profile's config files. */
    readConfigs(profile: string): Promise<Record<string, Record<string, JsonValue>>>;
    /** Read every device snapshot in the repository. */
    readDeviceSnapshots(): Promise<Record<string, DeviceSnapshot>>;
    /** Read the repository at a specific commit (for history restore). */
    readAtCommit(commit: string, profile: string): Promise<{
        manifest: Manifest | null;
        state: RemoteProfileState | null;
        configs: Record<string, Record<string, JsonValue>>;
        device: DeviceInfo | null;
    }>;
    /**
     * Write backup files, commit, and push.
     *
     * Never force-pushes: a non-fast-forward push is retried after a pull, and a
     * persistent race fails the operation with a retryable error.
     */
    write(options: RepoWriteOptions): Promise<RepoWriteResult>;
    /** List recent commits of the backup branch. */
    history(options?: {
        limit?: number;
        signal?: AbortSignal;
    }): Promise<HistoryEntry[]>;
    /** Check reachability and authentication. */
    testConnection(options?: {
        signal?: AbortSignal;
    }): Promise<ConnectionTestResult>;
}
/** Files (and deletions) a rebuild produces after a concurrent-device pull. */
export type RepoRebuildResult = Record<string, string> | {
    files: Record<string, string>;
    deletions?: readonly string[];
};
/** Options for one repository write. */
export interface RepoWriteOptions {
    /** Relative path -> UTF-8 content. */
    files: Record<string, string>;
    /** Relative paths to delete from the work tree (a missing file is a no-op). */
    deletions?: readonly string[];
    /**
     * Rebuild the file set after a concurrent-device push forced a fresh pull.
     * Called with the refreshed work tree root so the caller can re-merge its
     * changes against the new remote state instead of overwriting it.
     */
    rebuild?: (workTree: string) => Promise<RepoRebuildResult>;
    /** Commit message subject. */
    message: string;
    /** Commit trailers recorded by this plugin. */
    trailers: CommitTrailers;
    /** Skip the commit even when files differ (dry run). */
    dryRun?: boolean;
    signal?: AbortSignal;
}
/** Outcome of a repository write. */
export interface RepoWriteResult {
    changed: boolean;
    pushed: boolean;
    commit: string | null;
    /** Files that actually changed (relative paths). */
    changedFiles: string[];
    /** Set when the push raced another device and was retried. */
    retried: boolean;
}
/** Result of preparing the work tree. */
export interface RepoPrepareResult {
    /** Current HEAD, or null while the repository has no commit yet. */
    head: string | null;
    /** True when this run created the branch (first backup). */
    created: boolean;
    branch: string;
    /** True when the local work tree was reset to the remote branch. */
    refreshed: boolean;
}
