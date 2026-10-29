/**
 * Backup manifest: construction, validation and deterministic serialization.
 *
 * The manifest is the index of a backup repository, and the repository itself is
 * untrusted input: it may have been cloned from anywhere, or written by another
 * device running an older or newer version of this plugin. Every document read
 * from it therefore passes through a validator here, and a document that cannot
 * be understood is rejected with {@link SyncError} code `invalid-manifest`
 * instead of being silently repaired. A newer `schemaVersion` gets an explicit
 * "please upgrade the plugin" message, because migrating is a future release's
 * job, not a guess this release should make.
 *
 * Serialization is deterministic: keys are sorted recursively, rendered with
 * two-space indentation and a trailing newline, so writing identical data twice
 * produces byte-identical files and the "nothing changed" detection in
 * `RepoStore.write` stays reliable.
 * @module manifest/manifest
 */
import { MANIFEST_SCHEMA_VERSION, MAX_BACKUP_FILES, PACKAGE_NAME, REPO_CONFIGS_DIR, REPO_DEVICES_DIR, REPO_MANIFEST_FILE, REPO_PLUGINS_FILE, REPO_PROFILES_DIR, REPO_README_FILE, REPO_SCHEMA_FILE, } from '../constants.js';
import { SyncError } from '../core/errors.js';
import { asJsonObject, isJsonValue } from '../core/json.js';
import { isSafeRelativePath } from '../core/paths.js';
/** Generator recorded in the manifest; bumped with the plugin release. */
export const MANIFEST_GENERATOR = { name: PACKAGE_NAME, version: '0.2.1' };
/** Profile names and device ids become path segments; keep them simple. */
export const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Device IDs become directory names; keep them to one conservative segment. */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Origins a plugin record may declare. */
const PLUGIN_ORIGINS = ['npm', 'git', 'local-path', 'tarball', 'official', 'unknown'];
/** Maximum number of device snapshots a manifest may index. */
const MAX_DEVICE_ENTRIES = 1_000;
/** Maximum number of plugins recorded in one profile state document. */
const MAX_PROFILE_ENTRIES = MAX_BACKUP_FILES;
/** Whether a string is a safe single-segment profile name. */
export function isSafeProfileSegment(value) {
    return typeof value === 'string' && PROFILE_NAME_PATTERN.test(value);
}
/** Whether a string is a safe single-segment device id. */
export function isSafeDeviceId(value) {
    return typeof value === 'string' && DEVICE_ID_PATTERN.test(value);
}
/** Whether a string is an ISO-8601 timestamp `.toISOString()` could produce. */
export function isValidTimestamp(value) {
    if (typeof value !== 'string' || value.length < 20 || value.length > 40)
        return false;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value))
        return false;
    return Number.isFinite(Date.parse(value));
}
/** Use a timestamp when valid, otherwise the supplied fallback. */
function timestampOr(value, fallback) {
    return isValidTimestamp(value) ? value : fallback;
}
/** Invalid repository data. */
function invalid(label, reason, details) {
    return new SyncError('invalid-manifest', `${label} 无效 / invalid ${label}: ${reason}`, {
        details: details === undefined ? undefined : { label, reason, ...details },
    });
}
/** Aggregate several manifest problems into one error with reasons. */
function invalidManifest(reasons) {
    const shown = reasons.slice(0, 8);
    const more = reasons.length > shown.length ? [`… (${reasons.length - shown.length} more)`] : [];
    return new SyncError('invalid-manifest', `备份 manifest 无效 / invalid backup manifest: ${[...shown, ...more].join('; ')}`, { details: { reasons: [...shown, ...more] } });
}
/**
 * Validate the schema version of a document read from the repository.
 * A newer version cannot be migrated by this release, so it fails with a clear
 * instruction instead of writing data an older plugin cannot read.
 * @throws {SyncError} code `invalid-manifest`.
 */
export function checkSchemaVersion(value, label) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw invalid(label, `schemaVersion 必须是正整数 / schemaVersion must be a positive integer`);
    }
    if (value > MANIFEST_SCHEMA_VERSION) {
        throw new SyncError('invalid-manifest', `备份仓库使用了更新的 schema 版本 v${value}（当前插件支持 v${MANIFEST_SCHEMA_VERSION}），请升级 dsh-plugins-git-sync / backup uses schema version v${value}, but this plugin supports v${MANIFEST_SCHEMA_VERSION}; please upgrade dsh-plugins-git-sync`, { details: { schemaVersion: value, supported: MANIFEST_SCHEMA_VERSION } });
    }
    if (value !== MANIFEST_SCHEMA_VERSION) {
        throw invalid(label, `不支持的 schemaVersion ${value} / unsupported schemaVersion ${value}`, {
            schemaVersion: value,
            supported: MANIFEST_SCHEMA_VERSION,
        });
    }
    return value;
}
/** Validate `generator` ({name, version}) or explain why it is unusable. */
function validateGenerator(value) {
    const raw = asJsonObject(value);
    if (raw === null)
        throw invalid('manifest.generator', '必须是对象 / must be an object');
    if (typeof raw.name !== 'string' || raw.name === '' || raw.name.length > 200) {
        throw invalid('manifest.generator.name', '必须是非空字符串 / must be a non-empty string');
    }
    if (typeof raw.version !== 'string' || raw.version === '' || raw.version.length > 100) {
        throw invalid('manifest.generator.version', '必须是非空字符串 / must be a non-empty string');
    }
    return { name: raw.name, version: raw.version };
}
/** Validate a profile's summary row. */
function validateProfileSummary(value, profile) {
    const raw = asJsonObject(value);
    if (raw === null)
        throw invalid(`manifest.profiles.${profile}`, '必须是对象 / must be an object');
    if (typeof raw.pluginCount !== 'number' || !Number.isInteger(raw.pluginCount) || raw.pluginCount < 0) {
        throw invalid(`manifest.profiles.${profile}.pluginCount`, '必须是非负整数 / must be a non-negative integer');
    }
    if (raw.pluginCount > MAX_PROFILE_ENTRIES) {
        throw invalid(`manifest.profiles.${profile}.pluginCount`, `超过上限 ${MAX_PROFILE_ENTRIES} / exceeds the limit of ${MAX_PROFILE_ENTRIES}`);
    }
    if (!isValidTimestamp(raw.updatedAt)) {
        throw invalid(`manifest.profiles.${profile}.updatedAt`, '必须是 ISO-8601 时间 / must be an ISO-8601 timestamp');
    }
    return { pluginCount: raw.pluginCount, updatedAt: raw.updatedAt };
}
/**
 * Validate an untrusted manifest document and return a normalized copy.
 *
 * Unknown top-level members are dropped (forward compatibility), while invalid
 * required members fail loudly. `profiles` and `devices` are normalized to
 * sorted order so serialization is deterministic.
 * @throws {SyncError} code `invalid-manifest`.
 */
export function validateManifest(value) {
    const raw = asJsonObject(value);
    if (raw === null)
        throw invalidManifest(['manifest 必须是 JSON 对象 / manifest must be a JSON object']);
    // A newer schema version has its own upgrade message, so check it before
    // collecting generic reasons.
    checkSchemaVersion(raw.schemaVersion, 'manifest');
    const reasons = [];
    const generator = validateGenerator(raw.generator);
    if (!isValidTimestamp(raw.createdAt))
        reasons.push('createdAt 必须是 ISO-8601 时间 / createdAt must be an ISO-8601 timestamp');
    if (!isValidTimestamp(raw.updatedAt))
        reasons.push('updatedAt 必须是 ISO-8601 时间 / updatedAt must be an ISO-8601 timestamp');
    const profilesRaw = asJsonObject(raw.profiles);
    if (profilesRaw === null)
        reasons.push('profiles 必须是对象 / profiles must be an object');
    if (!Array.isArray(raw.devices))
        reasons.push('devices 必须是数组 / devices must be an array');
    if (reasons.length > 0)
        throw invalidManifest(reasons);
    const profiles = {};
    for (const profile of Object.keys(profilesRaw ?? {}).sort()) {
        if (!isSafeProfileSegment(profile)) {
            reasons.push(`profiles 中的键不是合法 profile 名称 / invalid profile key: ${JSON.stringify(profile)}`);
            continue;
        }
        profiles[profile] = validateProfileSummary((profilesRaw ?? {})[profile], profile);
    }
    const devices = [];
    for (const device of raw.devices) {
        if (!isSafeDeviceId(device)) {
            reasons.push(`devices 中的设备 ID 不合法 / invalid device id: ${JSON.stringify(device)}`);
            continue;
        }
        if (!devices.includes(device))
            devices.push(device);
    }
    if (devices.length > MAX_DEVICE_ENTRIES) {
        reasons.push(`devices 超过上限 ${MAX_DEVICE_ENTRIES} / too many device entries`);
    }
    if (reasons.length > 0)
        throw invalidManifest(reasons);
    return {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        generator,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        profiles,
        devices: devices.sort(),
    };
}
/**
 * Build a fresh manifest for this write.
 *
 * `createdAt` is carried over from the previous manifest (the repository's real
 * creation time), while `updatedAt` is always the current time.
 */
export function buildManifest(input) {
    const generatorVersion = typeof input.generatorVersion === 'string' && input.generatorVersion.trim() !== ''
        ? input.generatorVersion.trim()
        : MANIFEST_GENERATOR.version;
    const now = timestampOr(input.now, new Date().toISOString());
    const previous = input.previous;
    const createdAt = previous !== null && isValidTimestamp(previous.createdAt) ? previous.createdAt : now;
    // The generator records the plugin version that wrote this manifest, so an
    // upgraded plugin updates it instead of freezing the first writer's version.
    const generator = { name: MANIFEST_GENERATOR.name, version: generatorVersion };
    const profiles = {};
    const profileInput = input.profiles ?? {};
    for (const profile of Object.keys(profileInput).sort()) {
        if (!isSafeProfileSegment(profile)) {
            throw new SyncError('invalid-path', `非法的 profile 名称 / invalid profile name: ${JSON.stringify(profile)}`);
        }
        const summary = profileInput[profile];
        if (summary === null || typeof summary !== 'object') {
            throw new SyncError('invalid-config', `profile 摘要无效 / invalid profile summary: ${profile}`);
        }
        const rawCount = Number(summary.pluginCount);
        const pluginCount = Number.isFinite(rawCount) ? Math.min(MAX_PROFILE_ENTRIES, Math.max(0, Math.trunc(rawCount))) : 0;
        profiles[profile] = { pluginCount, updatedAt: timestampOr(summary.updatedAt, now) };
    }
    const devices = [];
    for (const device of input.devices ?? []) {
        if (!isSafeDeviceId(device)) {
            throw new SyncError('invalid-path', `非法的设备 ID / invalid device id: ${JSON.stringify(device)}`);
        }
        if (!devices.includes(device))
            devices.push(device);
    }
    devices.sort();
    return {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        generator,
        createdAt,
        updatedAt: now,
        profiles,
        devices,
    };
}
/** Recursive deterministic pretty printer (2-space indent, optional key sorting). */
function prettyJson(value, depth = 0, sortKeys = true) {
    if (value === null)
        return 'null';
    const kind = typeof value;
    if (kind === 'string' || kind === 'number' || kind === 'boolean')
        return JSON.stringify(value);
    const indent = '  '.repeat(depth + 1);
    const closing = '  '.repeat(depth);
    if (Array.isArray(value)) {
        if (value.length === 0)
            return '[]';
        return `[\n${value.map(item => `${indent}${prettyJson(item, depth + 1, sortKeys)}`).join(',\n')}\n${closing}]`;
    }
    const object = value;
    const keys = sortKeys ? Object.keys(object).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) : Object.keys(object);
    if (keys.length === 0)
        return '{}';
    const body = keys
        .map(key => `${indent}${JSON.stringify(key)}: ${prettyJson(object[key], depth + 1, sortKeys)}`)
        .join(',\n');
    return `{\n${body}\n${closing}}`;
}
/**
 * Serialize arbitrary backup JSON deterministically: recursively sorted keys,
 * two-space indentation, trailing newline.
 * @throws {SyncError} code `internal` when the value is not lossless JSON.
 */
export function serializeJson(value) {
    if (!isJsonValue(value)) {
        throw new SyncError('internal', '备份内容包含无法序列化的值 / value is not lossless JSON');
    }
    return `${prettyJson(value)}\n`;
}
/**
 * Serialize the root manifest.
 *
 * Uses the documented member order (schemaVersion first) and sorted profile /
 * device collections, so equal manifests serialize to identical bytes.
 */
export function serializeManifest(manifest) {
    const profiles = {};
    for (const profile of Object.keys(manifest.profiles).sort()) {
        const summary = manifest.profiles[profile];
        if (summary === undefined)
            continue;
        profiles[profile] = { pluginCount: summary.pluginCount, updatedAt: summary.updatedAt };
    }
    const document = {
        schemaVersion: manifest.schemaVersion,
        generator: { name: manifest.generator.name, version: manifest.generator.version },
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt,
        profiles,
        devices: [...manifest.devices].sort(),
    };
    // The manifest keeps its documented member order (schemaVersion first).
    return `${prettyJson(document, 0, false)}\n`;
}
/**
 * The machine-readable layout document written to `metadata/schema.json`.
 *
 * It is deliberately self-describing: anyone who opens the repository without
 * the plugin can read the schema version, the directory layout and the commit
 * trailers. It contains no machine-specific paths.
 */
export function buildSchemaDocument(pluginVersion = MANIFEST_GENERATOR.version) {
    const document = {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        generator: { name: MANIFEST_GENERATOR.name, version: pluginVersion },
        description: 'DSH 插件 Git 同步的备份布局 / Backup layout of DSH Plugin Git Sync. 此目录由插件自动维护，请勿手工修改 / maintained automatically; do not edit by hand.',
        files: {
            [REPO_MANIFEST_FILE]: '备份索引 / index of the backup',
            [REPO_SCHEMA_FILE]: '本说明文档 / this document',
            [REPO_README_FILE]: '仓库说明 / human-readable repository notes',
            [`${REPO_PROFILES_DIR}/<profile>/${REPO_PLUGINS_FILE}`]: '共享插件状态 / shared plugin state per profile',
            [`${REPO_PROFILES_DIR}/<profile>/${REPO_CONFIGS_DIR}/<plugin-id>.json`]: '非敏感插件配置 / non-secret plugin configuration',
            [`${REPO_DEVICES_DIR}/<deviceId>/<profile>.json`]: '设备快照 / device snapshot',
        },
        commitTrailers: {
            Operation: '产生提交的操作 / operation that produced the commit',
            'Device-Id': '设备稳定 ID / stable device id',
            'Device-Name': '设备显示名称 / device display name',
            Profile: 'DSH profile 名称 / DSH profile name',
            Result: '操作结果 / operation result',
            'Plugin-Count': '涉及的插件数量 / number of plugins involved',
        },
        notes: [
            '所有路径都相对于备份目录（默认是仓库根目录）/ all paths are relative to the backup directory (the repository root by default)',
            '配置文件中的敏感键和疑似密钥的值不会被写入 / sensitive config keys and secret-looking values are never written',
            '同一仓库被多个设备同时写入时，插件会重新拉取、合并并重试，绝不强制推送 / concurrent writes are re-merged and retried; the plugin never force-pushes',
        ],
    };
    return serializeJson(document);
}
/** Validate a profile's shared plugin state (`plugins.json`). */
export function validateRemoteProfileState(value) {
    const raw = asJsonObject(value);
    if (raw === null)
        throw invalid('plugins.json', '必须是 JSON 对象 / must be a JSON object');
    checkSchemaVersion(raw.schemaVersion, 'plugins.json');
    if (!isSafeProfileSegment(raw.profile)) {
        throw invalid('plugins.json.profile', '不是合法 profile 名称 / not a valid profile name');
    }
    if (!isValidTimestamp(raw.updatedAt)) {
        throw invalid('plugins.json.updatedAt', '必须是 ISO-8601 时间 / must be an ISO-8601 timestamp');
    }
    const pluginsRaw = asJsonObject(raw.plugins);
    if (pluginsRaw === null)
        throw invalid('plugins.json.plugins', '必须是对象 / must be an object');
    const keys = Object.keys(pluginsRaw);
    if (keys.length > MAX_PROFILE_ENTRIES) {
        throw invalid('plugins.json.plugins', `超过上限 ${MAX_PROFILE_ENTRIES} / exceeds the limit of ${MAX_PROFILE_ENTRIES}`);
    }
    const plugins = {};
    for (const key of keys.sort()) {
        plugins[key] = validateRemotePluginEntry(pluginsRaw[key], key);
    }
    return {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        profile: raw.profile,
        updatedAt: raw.updatedAt,
        plugins,
    };
}
/** Validate one plugin entry in the shared profile state. */
export function validateRemotePluginEntry(value, expectedId) {
    const raw = asJsonObject(value);
    if (raw === null)
        throw invalid('plugins.json entry', '必须是对象 / must be an object');
    if (typeof raw.id !== 'string' || raw.id === '' || raw.id.length > 512) {
        throw invalid('plugins.json entry.id', '必须是非空字符串 / must be a non-empty string');
    }
    if (expectedId !== undefined && raw.id !== expectedId) {
        throw invalid('plugins.json entry.id', `与键不一致 / does not match its key ${JSON.stringify(expectedId)}`);
    }
    if (typeof raw.name !== 'string' || raw.name === '' || raw.name.length > 512) {
        throw invalid('plugins.json entry.name', '必须是非空字符串 / must be a non-empty string');
    }
    if (raw.version !== null && (typeof raw.version !== 'string' || raw.version.length > 100)) {
        throw invalid('plugins.json entry.version', '必须是字符串或 null / must be a string or null');
    }
    if (typeof raw.origin !== 'string' || !PLUGIN_ORIGINS.includes(raw.origin)) {
        throw invalid('plugins.json entry.origin', `未知来源 / unknown origin: ${JSON.stringify(raw.origin)}`);
    }
    if (raw.installSpec !== null && (typeof raw.installSpec !== 'string' || raw.installSpec.length > 4096)) {
        throw invalid('plugins.json entry.installSpec', '必须是字符串或 null / must be a string or null');
    }
    for (const field of ['enabled', 'builtIn', 'syncable', 'pathOnly']) {
        if (typeof raw[field] !== 'boolean') {
            throw invalid(`plugins.json entry.${field}`, '必须是布尔值 / must be a boolean');
        }
    }
    if (raw.deleted !== undefined && typeof raw.deleted !== 'boolean') {
        throw invalid('plugins.json entry.deleted', '必须是布尔值 / must be a boolean');
    }
    if (!isValidTimestamp(raw.updatedAt)) {
        throw invalid('plugins.json entry.updatedAt', '必须是 ISO-8601 时间 / must be an ISO-8601 timestamp');
    }
    if (typeof raw.updatedBy !== 'string' || raw.updatedBy === '' || raw.updatedBy.length > 128) {
        throw invalid('plugins.json entry.updatedBy', '必须是非空字符串 / must be a non-empty string');
    }
    const entry = {
        id: raw.id,
        name: raw.name,
        version: raw.version,
        origin: raw.origin,
        installSpec: raw.installSpec,
        enabled: raw.enabled,
        builtIn: raw.builtIn,
        syncable: raw.syncable,
        pathOnly: raw.pathOnly,
        rows: validateRows(raw.rows),
        updatedAt: raw.updatedAt,
        updatedBy: raw.updatedBy,
    };
    if (typeof raw.displayName === 'string' && raw.displayName !== '')
        entry.displayName = raw.displayName.slice(0, 200);
    if (typeof raw.source === 'string' && raw.source !== '')
        entry.source = raw.source.slice(0, 4096);
    if (Array.isArray(raw.configSkipped)) {
        entry.configSkipped = raw.configSkipped
            .filter((key) => typeof key === 'string')
            .slice(0, 200);
    }
    if (raw.deleted === true)
        entry.deleted = true;
    return entry;
}
/** Validate a plugin's loader rows. */
function validateRows(value) {
    if (!Array.isArray(value))
        throw invalid('plugin rows', '必须是数组 / must be an array');
    if (value.length > 500)
        throw invalid('plugin rows', '超过上限 500 / exceeds the limit of 500');
    const rows = [];
    for (const item of value) {
        const raw = asJsonObject(item);
        if (raw === null)
            throw invalid('plugin row', '必须是对象 / must be an object');
        if (typeof raw.moduleName !== 'string' || raw.moduleName === '' || raw.moduleName.length > 512) {
            throw invalid('plugin row.moduleName', '必须是非空字符串 / must be a non-empty string');
        }
        if (typeof raw.enabled !== 'boolean')
            throw invalid('plugin row.enabled', '必须是布尔值 / must be a boolean');
        const row = { moduleName: raw.moduleName, enabled: raw.enabled };
        if (typeof raw.entryId === 'string' && raw.entryId !== '')
            row.entryId = raw.entryId.slice(0, 200);
        if (typeof raw.rowId === 'string' && raw.rowId !== '')
            row.rowId = raw.rowId.slice(0, 200);
        rows.push(row);
    }
    return rows;
}
/** Validate one plugin config document. */
export function validateRemoteConfigEntry(value) {
    const raw = asJsonObject(value);
    if (raw === null)
        throw invalid('config entry', '必须是 JSON 对象 / must be a JSON object');
    if (typeof raw.pluginId !== 'string' || raw.pluginId === '' || raw.pluginId.length > 512) {
        throw invalid('config entry.pluginId', '必须是非空字符串 / must be a non-empty string');
    }
    if (!isValidTimestamp(raw.updatedAt)) {
        throw invalid('config entry.updatedAt', '必须是 ISO-8601 时间 / must be an ISO-8601 timestamp');
    }
    if (typeof raw.updatedBy !== 'string' || raw.updatedBy === '' || raw.updatedBy.length > 128) {
        throw invalid('config entry.updatedBy', '必须是非空字符串 / must be a non-empty string');
    }
    const configs = asJsonObject(raw.configs);
    if (configs === null)
        throw invalid('config entry.configs', '必须是 JSON 对象 / must be a JSON object');
    return {
        pluginId: raw.pluginId,
        updatedAt: raw.updatedAt,
        updatedBy: raw.updatedBy,
        configs: configs,
    };
}
/** Validate device identity metadata. */
export function validateDeviceInfo(value) {
    const raw = asJsonObject(value);
    if (raw === null)
        throw invalid('device', '必须是对象 / must be an object');
    if (!isSafeDeviceId(raw.id))
        throw invalid('device.id', '不是合法设备 ID / not a valid device id');
    for (const field of ['name', 'platform', 'arch', 'dshVersion', 'pluginVersion']) {
        if (typeof raw[field] !== 'string' || raw[field].length > 200) {
            throw invalid(`device.${field}`, '必须是字符串 / must be a string');
        }
    }
    if (raw.name === '')
        throw invalid('device.name', '不能为空 / must not be empty');
    return {
        id: raw.id,
        name: raw.name,
        platform: raw.platform,
        arch: raw.arch,
        dshVersion: raw.dshVersion,
        pluginVersion: raw.pluginVersion,
    };
}
/** Validate one scanned plugin record (as stored in a device snapshot). */
export function validatePluginRecord(value) {
    const raw = asJsonObject(value);
    if (raw === null)
        throw invalid('device plugin', '必须是对象 / must be an object');
    if (typeof raw.id !== 'string' || raw.id === '' || raw.id.length > 512) {
        throw invalid('device plugin.id', '必须是非空字符串 / must be a non-empty string');
    }
    if (typeof raw.name !== 'string' || raw.name === '' || raw.name.length > 512) {
        throw invalid('device plugin.name', '必须是非空字符串 / must be a non-empty string');
    }
    if (raw.version !== null && (typeof raw.version !== 'string' || raw.version.length > 100)) {
        throw invalid('device plugin.version', '必须是字符串或 null / must be a string or null');
    }
    if (typeof raw.origin !== 'string' || !PLUGIN_ORIGINS.includes(raw.origin)) {
        throw invalid('device plugin.origin', `未知来源 / unknown origin: ${JSON.stringify(raw.origin)}`);
    }
    if (raw.installSpec !== null && (typeof raw.installSpec !== 'string' || raw.installSpec.length > 4096)) {
        throw invalid('device plugin.installSpec', '必须是字符串或 null / must be a string or null');
    }
    for (const field of ['enabled', 'builtIn', 'syncable', 'pathOnly']) {
        if (typeof raw[field] !== 'boolean') {
            throw invalid(`device plugin.${field}`, '必须是布尔值 / must be a boolean');
        }
    }
    if (typeof raw.profile !== 'string' || typeof raw.platform !== 'string') {
        throw invalid('device plugin.profile', 'profile 与 platform 必须是字符串 / profile and platform must be strings');
    }
    const configs = asJsonObject(raw.configs);
    if (configs === null)
        throw invalid('device plugin.configs', '必须是 JSON 对象 / must be a JSON object');
    const configSkipped = Array.isArray(raw.configSkipped)
        ? raw.configSkipped.filter((key) => typeof key === 'string').slice(0, 200)
        : [];
    const record = {
        id: raw.id,
        name: raw.name,
        version: raw.version,
        origin: raw.origin,
        installSpec: raw.installSpec,
        enabled: raw.enabled,
        builtIn: raw.builtIn,
        syncable: raw.syncable,
        pathOnly: raw.pathOnly,
        profile: raw.profile,
        platform: raw.platform,
        rows: validateRows(raw.rows),
        configs: configs,
        configSkipped,
    };
    if (typeof raw.displayName === 'string' && raw.displayName !== '')
        record.displayName = raw.displayName.slice(0, 200);
    if (typeof raw.source === 'string' && raw.source !== '')
        record.source = raw.source.slice(0, 4096);
    if (typeof raw.localPath === 'string' && raw.localPath !== '')
        record.localPath = raw.localPath.slice(0, 4096);
    if (typeof raw.error === 'string' && raw.error !== '')
        record.error = raw.error.slice(0, 2000);
    if (raw.archive !== undefined)
        record.archive = validateArchive(raw.archive);
    return record;
}
/** Validate a local-plugin archive reference. */
function validateArchive(value) {
    const raw = asJsonObject(value);
    if (raw === null)
        throw invalid('plugin archive', '必须是对象 / must be an object');
    if (typeof raw.file !== 'string' || !isSafeRelativePath(raw.file)) {
        throw invalid('plugin archive.file', '必须是仓库内相对路径 / must be a repository-relative path');
    }
    if (typeof raw.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.sha256)) {
        throw invalid('plugin archive.sha256', '必须是 SHA-256 十六进制摘要 / must be a SHA-256 hex digest');
    }
    if (typeof raw.size !== 'number' || !Number.isInteger(raw.size) || raw.size < 0) {
        throw invalid('plugin archive.size', '必须是非负整数 / must be a non-negative integer');
    }
    return { file: raw.file, sha256: raw.sha256, size: raw.size };
}
/**
 * Strip fields that must never be persisted in a backup.
 *
 * `PluginRecord.localPath` is an absolute machine path (`types.ts` says it is
 * "never written to a backup"), so it is dropped from device snapshots even when
 * a scanner hands one over.
 */
function withoutLocalPaths(record) {
    if (record.localPath === undefined)
        return record;
    const { localPath: _localPath, ...rest } = record;
    return rest;
}
/** Validate one device snapshot document. */
export function validateDeviceSnapshot(value) {
    const raw = asJsonObject(value);
    if (raw === null)
        throw invalid('device snapshot', '必须是 JSON 对象 / must be a JSON object');
    checkSchemaVersion(raw.schemaVersion, 'device snapshot');
    const device = validateDeviceInfo(raw.device);
    if (!isSafeProfileSegment(raw.profile)) {
        throw invalid('device snapshot.profile', '不是合法 profile 名称 / not a valid profile name');
    }
    if (!isValidTimestamp(raw.updatedAt)) {
        throw invalid('device snapshot.updatedAt', '必须是 ISO-8601 时间 / must be an ISO-8601 timestamp');
    }
    if (!Array.isArray(raw.plugins))
        throw invalid('device snapshot.plugins', '必须是数组 / must be an array');
    if (raw.plugins.length > MAX_BACKUP_FILES) {
        throw invalid('device snapshot.plugins', `超过上限 ${MAX_BACKUP_FILES} / exceeds the limit of ${MAX_BACKUP_FILES}`);
    }
    const plugins = raw.plugins.map(item => withoutLocalPaths(validatePluginRecord(item)));
    return {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        device,
        profile: raw.profile,
        updatedAt: raw.updatedAt,
        plugins,
    };
}
/** Build one shared profile-state entry from a scanned plugin record. */
export function buildRemotePluginEntry(input) {
    const record = input.record;
    if (typeof record?.id !== 'string' || record.id === '') {
        throw new SyncError('invalid-config', '插件 ID 不能为空 / plugin id must not be empty');
    }
    if (!isValidTimestamp(input.updatedAt)) {
        throw new SyncError('invalid-config', 'updatedAt 必须是 ISO-8601 时间 / updatedAt must be an ISO-8601 timestamp');
    }
    const entry = {
        id: record.id,
        name: record.name,
        version: record.version,
        origin: record.origin,
        installSpec: record.installSpec,
        enabled: record.enabled,
        builtIn: record.builtIn,
        syncable: record.syncable,
        pathOnly: record.pathOnly,
        rows: record.rows.map(row => ({ ...row })),
        updatedAt: input.updatedAt,
        updatedBy: input.updatedBy,
    };
    if (record.displayName !== undefined && record.displayName !== '')
        entry.displayName = record.displayName;
    if (record.source !== undefined && record.source !== '')
        entry.source = record.source;
    if (record.configSkipped.length > 0)
        entry.configSkipped = [...record.configSkipped];
    if (input.deleted === true)
        entry.deleted = true;
    return entry;
}
/** Build one profile's shared state document. */
export function buildRemoteProfileState(input) {
    if (!isSafeProfileSegment(input.profile)) {
        throw new SyncError('invalid-path', `非法的 profile 名称 / invalid profile name: ${JSON.stringify(input.profile)}`);
    }
    if (!isValidTimestamp(input.updatedAt)) {
        throw new SyncError('invalid-config', 'updatedAt 必须是 ISO-8601 时间 / updatedAt must be an ISO-8601 timestamp');
    }
    const list = Array.isArray(input.plugins) ? input.plugins : Object.values(input.plugins);
    const plugins = {};
    for (const entry of list) {
        const validated = validateRemotePluginEntry(entry);
        plugins[validated.id] = validated;
    }
    return {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        profile: input.profile,
        updatedAt: input.updatedAt,
        plugins,
    };
}
/** Build one plugin config document. */
export function buildRemoteConfigEntry(input) {
    if (typeof input.pluginId !== 'string' || input.pluginId === '') {
        throw new SyncError('invalid-config', '插件 ID 不能为空 / plugin id must not be empty');
    }
    if (!isValidTimestamp(input.updatedAt)) {
        throw new SyncError('invalid-config', 'updatedAt 必须是 ISO-8601 时间 / updatedAt must be an ISO-8601 timestamp');
    }
    if (!isJsonValue(input.configs) || asJsonObject(input.configs) === null) {
        throw new SyncError('invalid-config', '配置必须是 JSON 对象 / configs must be a JSON object');
    }
    return {
        pluginId: input.pluginId,
        updatedAt: input.updatedAt,
        updatedBy: input.updatedBy,
        configs: input.configs,
    };
}
/** Build one device snapshot document. */
export function buildDeviceSnapshot(input) {
    if (!isSafeProfileSegment(input.profile)) {
        throw new SyncError('invalid-path', `非法的 profile 名称 / invalid profile name: ${JSON.stringify(input.profile)}`);
    }
    if (!isValidTimestamp(input.updatedAt)) {
        throw new SyncError('invalid-config', 'updatedAt 必须是 ISO-8601 时间 / updatedAt must be an ISO-8601 timestamp');
    }
    const device = validateDeviceInfo(input.device);
    return {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        device,
        profile: input.profile,
        updatedAt: input.updatedAt,
        plugins: input.plugins.map(record => withoutLocalPaths(validatePluginRecord(record))),
    };
}
/** Parse repository JSON, mapping a syntax error to `invalid-manifest`. */
export function parseRepoJson(text, label) {
    try {
        return JSON.parse(text);
    }
    catch (error) {
        throw new SyncError('invalid-manifest', `${label} 不是合法 JSON / ${label} is not valid JSON`, { cause: error });
    }
}
/** Parse and validate the root manifest file. */
export function parseManifestJson(text) {
    return validateManifest(parseRepoJson(text, REPO_MANIFEST_FILE));
}
/** Parse and validate a `plugins.json` file. */
export function parseRemoteProfileStateJson(text) {
    return validateRemoteProfileState(parseRepoJson(text, REPO_PLUGINS_FILE));
}
/** Parse and validate a config file. */
export function parseRemoteConfigEntryJson(text) {
    return validateRemoteConfigEntry(parseRepoJson(text, 'config'));
}
/** Parse and validate a device snapshot file. */
export function parseDeviceSnapshotJson(text) {
    return validateDeviceSnapshot(parseRepoJson(text, 'device snapshot'));
}
