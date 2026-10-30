/**
 * Local persistence: configuration, runtime state, device identity and paths.
 *
 * The plugin keeps its own files under `<DSH home>/dsh-plugins-git-sync`, never
 * inside the DSH profile package files and never inside the backup repository.
 * Configuration contains no secrets: an HTTPS token is read from an environment
 * variable at Git-invocation time, and only the variable's *name* is stored.
 * @module state/store
 */
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { CONFIG_FILE, LOG_FILE, SNAPSHOT_DIR, STATE_SCHEMA_VERSION, STATE_FILE, WORKDIR_DIR, ARCHIVE_DIR, } from '../constants.js';
import { isJsonValue, safeParseJson } from '../core/json.js';
import { SyncError } from '../core/errors.js';
import { dataDirFor, hasControlCharacters, normalizeBackupDir } from '../core/paths.js';
/** Resolve every local path from the DSH home. */
export function resolveStorePaths(dshHome) {
    const dataDir = dataDirFor(dshHome);
    return {
        dataDir,
        configPath: join(dataDir, CONFIG_FILE),
        statePath: join(dataDir, STATE_FILE),
        logPath: join(dataDir, LOG_FILE),
        snapshotDir: join(dataDir, SNAPSHOT_DIR),
        workDir: join(dataDir, WORKDIR_DIR),
        archiveDir: join(dataDir, ARCHIVE_DIR),
    };
}
/** Ensure a private directory exists. */
export async function ensurePrivateDir(path) {
    await mkdir(path, { recursive: true, mode: 0o700 });
}
/** Write a file atomically (temp file + rename) with owner-only permissions. */
export async function writeFileAtomic(path, content) {
    await ensurePrivateDir(dirname(path));
    const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    const handle = await open(temporary, 'w', 0o600);
    try {
        await handle.writeFile(content, 'utf8');
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    try {
        await rename(temporary, path);
    }
    catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
}
/** Whether a file exists. */
export async function fileExists(path) {
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
}
/** Default auto-sync configuration: off until the user enables it. */
export function defaultAutoSync() {
    return {
        enabled: false,
        mode: 'two-way',
        intervalMinutes: 30,
        startupDelayMs: 15_000,
        onStartup: false,
        onPluginChange: false,
        debounceMs: 10_000,
    };
}
/** Default configuration; auto-sync deliberately disabled. */
export function defaultConfig() {
    return {
        repoUrl: '',
        branch: 'main',
        backupDir: '',
        authMode: 'credential-helper',
        tokenEnvVar: '',
        username: '',
        profiles: [],
        includeConfigs: true,
        includeLocalPlugins: false,
        excludedPlugins: [],
        excludedConfigPlugins: [],
        autoSync: defaultAutoSync(),
        deviceName: defaultDeviceName(),
    };
}
/** Default device name from the OS host name. */
export function defaultDeviceName() {
    const name = sanitizeDeviceName(hostname());
    return name === '' ? 'DSH Device' : name;
}
/** Trim control characters and cap length. */
export function sanitizeDeviceName(input) {
    return input
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 64);
}
/** Error helper for invalid configuration. */
function invalid(field, reason) {
    return new SyncError('invalid-config', `配置项 ${field} 无效：${reason} / invalid ${field}: ${reason}`, {
        details: { field },
    });
}
/** Git branch validation (a conservative subset of `git check-ref-format`). */
export function isSafeBranchName(branch) {
    if (branch === '' || branch.length > 240)
        return false;
    if (branch.startsWith('-') || branch.startsWith('/') || branch.endsWith('/'))
        return false;
    if (branch.endsWith('.') || branch.endsWith('.lock'))
        return false;
    if (branch.includes('..') || branch.includes('@{') || branch.includes('\\'))
        return false;
    if (/[\s~^:?*[\]\u0000-\u001f\u007f]/.test(branch))
        return false;
    return true;
}
/** Repository URL validation; returns a normalized URL. */
export function validateRepoUrl(raw) {
    const value = raw.trim();
    if (value === '')
        return '';
    if (value.length > 2048)
        throw invalid('repoUrl', '地址过长 / URL too long');
    if (hasControlCharacters(value))
        throw invalid('repoUrl', '包含控制字符 / contains control characters');
    if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('.') || value.startsWith('~')) {
        // A local path or file URL is supported (mainly for self-hosted bare
        // repositories and tests); it never leaves the machine.
        return value;
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        let url;
        try {
            url = new URL(value);
        }
        catch {
            throw invalid('repoUrl', 'URL 无法解析 / unparseable URL');
        }
        if (!['https:', 'http:', 'ssh:', 'git:', 'file:', 'sftp:'].includes(url.protocol)) {
            throw invalid('repoUrl', `不支持的协议 ${url.protocol} / unsupported protocol`);
        }
        if (url.username !== '' || url.password !== '') {
            throw new SyncError('invalid-config', '仓库地址中不能包含用户名或 Token，请使用「HTTPS Token」认证方式或系统 Git 凭据助手 / credentials must not be embedded in the repository URL');
        }
        return url.toString();
    }
    // scp-like syntax: git@github.com:owner/repo.git
    if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/.test(value))
        return value;
    throw invalid('repoUrl', '不是有效的 Git 仓库地址 / not a Git repository URL');
}
/** Validate a profile name. */
export function isSafeProfileName(name) {
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name);
}
/**
 * Validate and normalize untrusted configuration (written by the UI, a tool, or
 * an older version of this plugin). Unknown keys are dropped.
 */
export function normalizeConfig(input, activeProfile, availableProfiles) {
    const defaults = defaultConfig();
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        return { ...defaults, profiles: [activeProfile] };
    }
    const raw = input;
    const config = { ...defaults };
    if (typeof raw.repoUrl === 'string')
        config.repoUrl = validateRepoUrl(raw.repoUrl);
    if (typeof raw.branch === 'string') {
        const branch = raw.branch.trim();
        if (branch !== '' && !isSafeBranchName(branch))
            throw invalid('branch', '不是合法的 Git 分支名 / invalid branch name');
        config.branch = branch === '' ? defaults.branch : branch;
    }
    if (typeof raw.backupDir === 'string')
        config.backupDir = normalizeBackupDir(raw.backupDir);
    if (raw.authMode === 'credential-helper' || raw.authMode === 'ssh' || raw.authMode === 'https-token') {
        config.authMode = raw.authMode;
    }
    else if (raw.authMode !== undefined) {
        throw invalid('authMode', '未知认证方式 / unknown authentication mode');
    }
    if (typeof raw.tokenEnvVar === 'string') {
        const envName = raw.tokenEnvVar.trim();
        if (envName !== '' && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(envName)) {
            throw invalid('tokenEnvVar', '不是合法的环境变量名 / invalid environment variable name');
        }
        config.tokenEnvVar = envName;
    }
    if (typeof raw.username === 'string')
        config.username = raw.username.trim().slice(0, 128);
    if (Array.isArray(raw.profiles)) {
        const selected = [];
        for (const value of raw.profiles) {
            if (typeof value !== 'string' || !isSafeProfileName(value))
                continue;
            if (!selected.includes(value))
                selected.push(value);
        }
        config.profiles = selected;
    }
    config.profiles = config.profiles.filter(name => availableProfiles.length === 0 || availableProfiles.includes(name));
    // The active profile is always synchronized and is listed first so every
    // surface shows the same order on every device.
    config.profiles = [activeProfile, ...config.profiles.filter(name => name !== activeProfile)];
    if (typeof raw.includeConfigs === 'boolean')
        config.includeConfigs = raw.includeConfigs;
    if (typeof raw.includeLocalPlugins === 'boolean')
        config.includeLocalPlugins = raw.includeLocalPlugins;
    if (typeof raw.deviceName === 'string') {
        const name = sanitizeDeviceName(raw.deviceName);
        config.deviceName = name === '' ? defaultDeviceName() : name;
    }
    config.excludedPlugins = stringList(raw.excludedPlugins);
    config.excludedConfigPlugins = stringList(raw.excludedConfigPlugins);
    if (raw.autoSync !== null && typeof raw.autoSync === 'object' && !Array.isArray(raw.autoSync)) {
        const auto = raw.autoSync;
        const next = defaultAutoSync();
        if (typeof auto.enabled === 'boolean')
            next.enabled = auto.enabled;
        if (auto.mode === 'two-way' || auto.mode === 'backup' || auto.mode === 'restore')
            next.mode = auto.mode;
        if (typeof auto.intervalMinutes === 'number' && Number.isFinite(auto.intervalMinutes)) {
            next.intervalMinutes = clamp(Math.round(auto.intervalMinutes), 0, 7 * 24 * 60);
        }
        if (typeof auto.startupDelayMs === 'number' && Number.isFinite(auto.startupDelayMs)) {
            next.startupDelayMs = clamp(Math.round(auto.startupDelayMs), 0, 10 * 60 * 1000);
        }
        if (typeof auto.onStartup === 'boolean')
            next.onStartup = auto.onStartup;
        if (typeof auto.onPluginChange === 'boolean')
            next.onPluginChange = auto.onPluginChange;
        if (typeof auto.debounceMs === 'number' && Number.isFinite(auto.debounceMs)) {
            next.debounceMs = clamp(Math.round(auto.debounceMs), 1_000, 60 * 60 * 1000);
        }
        if (next.enabled && next.intervalMinutes !== 0 && next.intervalMinutes < 1) {
            throw invalid('autoSync.intervalMinutes', '自动同步间隔必须至少为 1 分钟 / interval must be at least 1 minute');
        }
        config.autoSync = next;
    }
    return config;
}
/** Read a list of trimmed non-empty strings. */
function stringList(value) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const item of value) {
        if (typeof item !== 'string')
            continue;
        const trimmed = item.trim();
        if (trimmed !== '' && !out.includes(trimmed))
            out.push(trimmed.slice(0, 256));
    }
    return out.slice(0, 500);
}
/** Clamp a number. */
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
/** Persisted configuration file. */
export class ConfigStore {
    onNormalize;
    path;
    constructor(path, onNormalize) {
        this.onNormalize = onNormalize;
        this.path = path;
    }
    /**
     * Read and normalize the configuration; a corrupt file falls back to defaults.
     *
     * Deliberately uncached: the file is small, and the settings page, an agent
     * tool and a synchronization can all read it inside one polling window. A
     * cache here once hid an external edit until the next DSH restart.
     */
    async read() {
        let raw = null;
        try {
            const text = await readFile(this.path, 'utf8');
            raw = safeParseJson(text) ?? null;
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        return this.onNormalize(raw);
    }
    /** Persist a normalized configuration. */
    async write(config) {
        const normalized = this.onNormalize(config);
        await writeFileAtomic(this.path, `${JSON.stringify(normalized, null, 2)}\n`);
    }
}
/** Default empty local state. */
export function defaultState(device) {
    return {
        schemaVersion: STATE_SCHEMA_VERSION,
        device,
        lastSyncAt: null,
        lastCommit: null,
        lastOperation: null,
        lastError: null,
        baselines: {},
        conflicts: [],
        connection: null,
        autoSyncFailures: 0,
    };
}
/** Persisted runtime state. */
export class StateStore {
    createDefault;
    path;
    cached = null;
    constructor(path, createDefault) {
        this.createDefault = createDefault;
        this.path = path;
    }
    /** Read the state, falling back to a fresh default when absent or corrupt. */
    async read() {
        if (this.cached !== null)
            return structuredClone(this.cached);
        let raw = null;
        try {
            const text = await readFile(this.path, 'utf8');
            raw = safeParseJson(text);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        const state = isLocalState(raw) ? raw : this.createDefault();
        this.cached = state;
        return structuredClone(state);
    }
    /** Persist the state atomically. */
    async write(state) {
        const next = structuredClone(state);
        next.schemaVersion = STATE_SCHEMA_VERSION;
        await writeFileAtomic(this.path, `${JSON.stringify(next, null, 2)}\n`);
        this.cached = next;
    }
}
/** Structural validation for a persisted state document. */
function isLocalState(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const raw = value;
    if (raw.schemaVersion !== STATE_SCHEMA_VERSION)
        return false;
    if (!isJsonValue(raw.device) || raw.device === null || typeof raw.device !== 'object')
        return false;
    const device = raw.device;
    if (typeof device.id !== 'string' || device.id === '')
        return false;
    if (raw.baselines !== null && typeof raw.baselines === 'object' && !Array.isArray(raw.baselines))
        return true;
    return false;
}
/** Stable device identity for this DSH home. */
export function createDeviceInfo(options) {
    const existing = options.existing;
    return {
        id: existing?.id !== undefined && existing.id !== '' ? existing.id : `dev-${randomBytes(8).toString('hex')}`,
        name: options.name,
        platform: process.platform,
        arch: process.arch,
        dshVersion: options.dshVersion,
        pluginVersion: options.pluginVersion,
    };
}
