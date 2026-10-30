/**
 * Installed-plugin inventory scanner.
 *
 * The inventory is the input of every backup: for one DSH profile it reports
 * each installed plugin's identity, version, origin, reproducibility and
 * non-secret configuration.
 *
 * The Host's plugin manager (`ctx.get('pluginManager')`) is the primary
 * source because it knows about installation-provided bundles that are not in
 * the profile manifest. When it is absent or broken, the profile's
 * `package.json` dependencies are read instead: a degraded but useful list.
 * Nothing in this module throws on malformed data; an unreadable plugin is
 * reported in its record's `error` field.
 * @module scanner/inventory
 */
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { MANIFEST_SCHEMA_VERSION, NPM_NAME_PATTERN, PACKAGE_NAME } from '../constants.js';
import { SyncError, errorMessage } from '../core/errors.js';
import { expandHomePath } from '../core/paths.js';
import { redactGitUrl } from '../core/redact.js';
import { isValidVersion } from '../core/version.js';
import { createConfigGateway } from './config-gateway.js';
import { findProfileDir, readProfileDependencies } from './profiles.js';
/** Whether a value is a non-null, non-array object (accepts class instances). */
function isRecordObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Read a trimmed non-empty string, or undefined. */
function safeText(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
}
/** Read a list of unique non-empty strings from untrusted input. */
function stringArray(value) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const item of value) {
        const text = safeText(item);
        if (text !== undefined && !out.includes(text))
            out.push(text);
    }
    return out;
}
/** Normalize the configuration switches the scanner honors. */
function readConfigFlags(config) {
    const record = isRecordObject(config) ? config : {};
    return {
        includeConfigs: record.includeConfigs !== false,
        includeLocalPlugins: record.includeLocalPlugins === true,
        excludedConfig: stringArray(record.excludedConfigPlugins),
        profiles: stringArray(record.profiles),
    };
}
/** A built-in/official plugin origin. */
function officialOrigin() {
    return { origin: 'official', installSpec: null, pathOnly: false };
}
/** Strip a `file:` prefix (also used to spot tarball paths). */
function stripFileProtocol(spec) {
    return spec.replace(/^file:/i, '');
}
/** Whether a spec points at a tarball (`.tgz` / `.tar.gz`). */
function isTarballSpec(spec) {
    const withoutFile = stripFileProtocol(spec);
    const withoutQuery = withoutFile.split(/[?#]/)[0] ?? '';
    return /\.(?:tgz|tar\.gz)$/i.test(withoutQuery);
}
/** Whether a spec is a git source (scheme, scp-like, or GitHub shorthand). */
function isGitSpec(spec) {
    if (/^(?:git\+|git:|github:|gitlab:|bitbucket:)/i.test(spec))
        return true;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(spec))
        return /^(?:https?|ssh|git|git\+https|git\+ssh|sftp):/i.test(spec);
    if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/.test(spec))
        return true;
    if (/\.git(?:#.*)?$/i.test(spec))
        return true;
    // npm's `owner/repo` GitHub shorthand (not a package name and not a path).
    return /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*(?:#.*)?$/.test(spec);
}
/** Whether a spec is an explicit local path/protocol. */
function isLocalSpec(spec) {
    if (/^(?:file|link|workspace):/i.test(spec))
        return true;
    if (isAbsolute(spec) || /^[A-Za-z]:[\\/]/.test(spec))
        return true;
    if (spec === '~' || spec.startsWith('~/') || spec.startsWith('~\\'))
        return true;
    if (spec === '.' || spec === '..')
        return true;
    if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('.\\') || spec.startsWith('..\\'))
        return true;
    return !NPM_NAME_PATTERN.test(spec) && /[\\/]/.test(spec);
}
/** npm version range, exact version, or dist-tag. */
const NPM_VERSION_SPEC = /^(?:[\^~]|>=?|<=?|=)?\s*v?\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?$/;
const NPM_TAG_SPEC = /^(?:latest|next|beta|alpha|rc|canary|stable|\*|x)$/i;
/** Whether a spec is a registry (npm) spec: a name, version, range, tag or `name@version`. */
function isNpmSpec(spec) {
    if (NPM_NAME_PATTERN.test(spec))
        return true;
    if (NPM_VERSION_SPEC.test(spec) || NPM_TAG_SPEC.test(spec))
        return true;
    // `installTarget.spec` is usually `name@version`, including scoped names.
    const separator = spec.lastIndexOf('@');
    if (separator > 0) {
        const name = spec.slice(0, separator);
        const version = spec.slice(separator + 1);
        if (NPM_NAME_PATTERN.test(name) && (NPM_VERSION_SPEC.test(version) || NPM_TAG_SPEC.test(version)))
            return true;
    }
    return false;
}
/** Whether a git/tarball spec embeds credentials in its URL userinfo. */
function hasUrlCredentials(spec) {
    return /^[a-z][a-z0-9+.-]*:\/\/[^/\s@]+:[^/\s@]+@/i.test(spec);
}
/** Classify a git source; credentialed URLs cannot be reproduced. */
function classifyGit(spec) {
    const credentialed = hasUrlCredentials(spec);
    return {
        origin: 'git',
        source: credentialed ? redactGitUrl(spec) : spec,
        installSpec: credentialed ? null : spec,
        pathOnly: false,
    };
}
/** Classify a tarball source. Relative paths/URLs are reproducible. */
function classifyTarball(spec) {
    const path = stripFileProtocol(spec);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
        const credentialed = hasUrlCredentials(path);
        return {
            origin: 'tarball',
            source: credentialed ? redactGitUrl(path) : path,
            installSpec: credentialed ? null : path,
            pathOnly: false,
        };
    }
    const expanded = expandHomePath(path);
    if (isAbsolute(expanded) || /^[A-Za-z]:[\\/]/.test(expanded)) {
        return { origin: 'tarball', installSpec: null, pathOnly: true, localPath: resolve(expanded) };
    }
    return { origin: 'tarball', source: path, installSpec: path, pathOnly: false };
}
/** Classify a local path/protocol; the resolved directory is display-only. */
function classifyLocal(spec, profileDir) {
    if (/^workspace:/i.test(spec))
        return { origin: 'local-path', installSpec: null, pathOnly: true };
    const pathPart = stripFileProtocol(spec);
    const expanded = expandHomePath(pathPart);
    const absolute = isAbsolute(expanded) || /^[A-Za-z]:[\\/]/.test(expanded);
    const localPath = absolute
        ? resolve(expanded)
        : profileDir !== null
            ? resolve(profileDir, expanded)
            : undefined;
    const info = { origin: 'local-path', installSpec: null, pathOnly: true };
    // A home-absolute or root-absolute path must not leak into `source`.
    if (!absolute && pathPart !== '~' && !pathPart.startsWith('~/') && !pathPart.startsWith('~\\')) {
        info.source = spec;
    }
    if (localPath !== undefined)
        info.localPath = localPath;
    return info;
}
/**
 * Classify one install source spec.
 * A resolved symlink target always wins: it means a local development link
 * regardless of what the manifest claims.
 */
function classifySource(specInput, options) {
    if (options.linkedDir !== null) {
        return { origin: 'local-path', installSpec: null, pathOnly: true, localPath: options.linkedDir };
    }
    const spec = safeText(specInput);
    if (spec === undefined)
        return { origin: 'unknown', installSpec: null, pathOnly: false };
    if (isTarballSpec(spec))
        return classifyTarball(spec);
    if (isGitSpec(spec))
        return classifyGit(spec);
    if (isLocalSpec(spec))
        return classifyLocal(spec, options.profileDir);
    if (isNpmSpec(spec))
        return { origin: 'npm', installSpec: null, pathOnly: false };
    return { origin: 'unknown', installSpec: null, pathOnly: false };
}
/** Resolve a dependency to a symlink target inside the profile's node_modules. */
async function resolveLinkedPackage(profileDir, name) {
    const candidate = join(profileDir, 'node_modules', name);
    try {
        const info = await lstat(candidate);
        if (!info.isSymbolicLink())
            return null;
        try {
            return await realpath(candidate);
        }
        catch {
            return null;
        }
    }
    catch {
        return null;
    }
}
/** Read an installed plugin's version from its own package.json, if present. */
async function readInstalledVersion(localPath, profileDir, name) {
    const candidates = [];
    if (localPath !== undefined)
        candidates.push(join(localPath, 'package.json'));
    if (profileDir !== null)
        candidates.push(join(profileDir, 'node_modules', name, 'package.json'));
    for (const file of candidates) {
        try {
            const parsed = JSON.parse(await readFile(file, 'utf8'));
            if (isRecordObject(parsed)) {
                const version = safeText(parsed.version);
                if (version !== undefined)
                    return version;
            }
        }
        catch {
            // Try the next candidate.
        }
    }
    return null;
}
/** Compute the reproducible install spec for one record. */
function resolveInstallSpec(name, originInfo, version) {
    if (originInfo.origin === 'npm') {
        return version !== null && isValidVersion(version) ? `${name}@${version}` : null;
    }
    if (originInfo.origin === 'git' || originInfo.origin === 'tarball')
        return originInfo.installSpec;
    return null;
}
/** Whether the plugin may be synchronized from this device. */
function computeSyncable(args) {
    if (args.builtIn)
        return false;
    // This plugin is the backup tool itself: never back it up into its own
    // repository (self-sync would resurrect it on other devices unexpectedly).
    if (args.name === PACKAGE_NAME)
        return false;
    // DSH loader internals are not installable plugins.
    if (args.name.startsWith('cordis:'))
        return false;
    if (args.origin === 'local-path')
        return args.context.includeLocalPlugins;
    if (args.origin === 'official' || args.origin === 'unknown')
        return false;
    return args.installSpec !== null;
}
/** Read a localized `meta.title`. */
function titleOf(meta) {
    if (!isRecordObject(meta))
        return undefined;
    const title = meta.title;
    const direct = safeText(title);
    if (direct !== undefined)
        return direct;
    if (!isRecordObject(title))
        return undefined;
    const english = safeText(title.en);
    if (english !== undefined)
        return english;
    for (const value of Object.values(title)) {
        const text = safeText(value);
        if (text !== undefined)
            return text;
    }
    return undefined;
}
/** Find the plugin info row that corresponds to one bundle row. */
function findPluginInfo(plugins, query) {
    let byModule = null;
    for (const plugin of plugins) {
        const entryId = safeText(plugin.entryId);
        const moduleName = safeText(plugin.moduleName);
        if (query.entryId !== undefined && entryId === query.entryId)
            return plugin;
        if (query.patchId !== undefined && safeText(plugin.patchId) === query.patchId && moduleName === query.moduleName) {
            return plugin;
        }
        if (moduleName === query.moduleName && byModule === null)
            byModule = plugin;
    }
    return byModule;
}
/** Build the `rows` of one bundle, taking per-row `enabled` from the plugin list. */
function buildRows(bundle, plugins) {
    const rows = [];
    const bundleName = safeText(bundle.name) ?? '';
    const rawRows = Array.isArray(bundle.rows) ? bundle.rows : [];
    for (const rawRow of rawRows) {
        if (!isRecordObject(rawRow))
            continue;
        const moduleName = safeText(rawRow.moduleName);
        if (moduleName === undefined)
            continue;
        const rowId = safeText(rawRow.rowId);
        const declaredEntryId = safeText(rawRow.entryId);
        const match = findPluginInfo(plugins, { moduleName, entryId: declaredEntryId, patchId: rowId });
        const row = {
            moduleName,
            enabled: typeof match?.enabled === 'boolean' ? match.enabled : bundle.enabled === true,
        };
        if (declaredEntryId !== undefined)
            row.entryId = declaredEntryId;
        else {
            const matchedEntryId = match === null ? undefined : safeText(match.entryId);
            if (matchedEntryId !== undefined)
                row.entryId = matchedEntryId;
        }
        if (rowId !== undefined)
            row.rowId = rowId;
        rows.push(row);
    }
    if (rows.length === 0) {
        for (const plugin of plugins) {
            if (safeText(plugin.moduleName) !== bundleName)
                continue;
            const row = { moduleName: bundleName, enabled: plugin.enabled === true };
            const entryId = safeText(plugin.entryId);
            if (entryId !== undefined)
                row.entryId = entryId;
            rows.push(row);
        }
    }
    return rows;
}
/** Human-readable error for a bundle the Host could not fully load. */
function bundleErrorText(bundle) {
    if (isRecordObject(bundle.error)) {
        const code = safeText(bundle.error.code) ?? 'unknown error';
        const diagnostic = safeText(bundle.error.diagnostic);
        return diagnostic === undefined ? code : `${code}: ${diagnostic}`;
    }
    const readOnlyReason = safeText(bundle.readOnlyReason);
    if (readOnlyReason !== undefined)
        return readOnlyReason;
    if (bundle.availability === 'missing')
        return 'not installed';
    return undefined;
}
/** Read and filter one record's configuration through the gateway. */
async function attachConfigs(record, entryIds, context) {
    // Built-in/official plugins are never synchronized, so reading their configs
    // is pure scan cost: on a full profile this was ~200 redundant
    // configEditor.configuration() walks per scan.
    if (record.builtIn)
        return;
    if (!context.includeConfigs)
        return;
    if (context.excludedConfig.includes(record.id) || context.excludedConfig.includes(record.name))
        return;
    try {
        const read = await context.gateway.read({
            moduleName: record.name,
            entryIds: [...entryIds],
            profile: context.profile,
        });
        record.configs = read.values;
        record.configSkipped = read.skippedKeys;
    }
    catch (error) {
        // A config failure never invalidates the plugin record itself.
        context.warn(`config extraction failed for ${record.name}`, { reason: errorMessage(error) });
    }
}
/** Build one record from a plugin-manager bundle row. */
async function buildBundleRecord(bundle, plugins, context) {
    const name = safeText(bundle.name);
    if (name === undefined)
        return null;
    const builtIn = bundle.official === true || bundle.availability === 'installation' || name.startsWith('@deepseek-ai/');
    const installed = bundle.installed !== false && bundle.availability !== 'missing';
    if (!installed && bundle.installed === false)
        return null;
    const installTarget = isRecordObject(bundle.installTarget) ? bundle.installTarget : null;
    const installTargetSpec = installTarget === null ? undefined : safeText(installTarget.spec);
    const installTargetVersion = installTarget === null ? undefined : safeText(installTarget.version);
    const bundleSource = safeText(bundle.source);
    const dependencySpec = context.dependencies[name];
    const bundleVersion = safeText(bundle.version);
    const linkedDir = builtIn || context.profileDir === null ? null : await resolveLinkedPackage(context.profileDir, name);
    const originInfo = builtIn
        ? officialOrigin()
        : classifySource(installTargetSpec ?? bundleSource ?? dependencySpec ?? bundleVersion, {
            linkedDir,
            profileDir: context.profileDir,
        });
    const dependencyVersion = dependencySpec !== undefined && isValidVersion(dependencySpec) ? dependencySpec.trim() : null;
    let installedVersion;
    const getInstalledVersion = async () => {
        if (installedVersion === undefined) {
            installedVersion = await readInstalledVersion(originInfo.localPath, context.profileDir, name);
        }
        return installedVersion;
    };
    let version = bundleVersion ?? installTargetVersion ?? null;
    if (version === null && !builtIn) {
        version =
            originInfo.origin === 'local-path'
                ? (await getInstalledVersion()) ?? dependencyVersion
                : dependencyVersion ?? (await getInstalledVersion());
    }
    const installSpec = resolveInstallSpec(name, originInfo, version);
    const rows = buildRows(bundle, plugins);
    const id = originInfo.origin === 'local-path' ? `local:${name}` : name;
    const enabled = bundle.enabled === true;
    const record = {
        id,
        name,
        version,
        origin: originInfo.origin,
        installSpec,
        enabled,
        builtIn,
        syncable: computeSyncable({ builtIn, origin: originInfo.origin, installSpec, id, name, context }),
        pathOnly: originInfo.origin === 'local-path' ? true : originInfo.pathOnly,
        profile: context.profile,
        platform: context.platform,
        rows,
        configs: {},
        configSkipped: [],
    };
    const displayName = titleOf(bundle.meta) ?? titleOf(findPluginInfo(plugins, { moduleName: name })?.meta);
    if (displayName !== undefined)
        record.displayName = displayName;
    if (originInfo.source !== undefined)
        record.source = originInfo.source;
    if (originInfo.localPath !== undefined)
        record.localPath = originInfo.localPath;
    const errorText = bundleErrorText(bundle);
    if (errorText !== undefined)
        record.error = errorText;
    const entryIds = rows
        .map(row => row.entryId)
        .filter((entryId) => typeof entryId === 'string' && entryId !== '');
    await attachConfigs(record, entryIds, context);
    return record;
}
/** Build one record for a plugin entry that no bundle claims (an orphan). */
async function buildOrphanRecord(plugin, context) {
    const moduleName = safeText(plugin.moduleName);
    const entryId = safeText(plugin.entryId);
    const name = moduleName ?? entryId;
    if (name === undefined)
        return null;
    const builtIn = name.startsWith('@deepseek-ai/');
    const dependencySpec = context.dependencies[name];
    const linkedDir = builtIn || context.profileDir === null ? null : await resolveLinkedPackage(context.profileDir, name);
    const originInfo = builtIn
        ? officialOrigin()
        : classifySource(dependencySpec, { linkedDir, profileDir: context.profileDir });
    const dependencyVersion = dependencySpec !== undefined && isValidVersion(dependencySpec) ? dependencySpec.trim() : null;
    // Built-in orphans are inventory-only; skip the per-package fs probe.
    const version = builtIn
        ? null
        : dependencyVersion ?? (await readInstalledVersion(originInfo.localPath, context.profileDir, name));
    const installSpec = resolveInstallSpec(name, originInfo, version);
    const id = originInfo.origin === 'local-path' ? `local:${name}` : name;
    const row = { moduleName: name, enabled: plugin.enabled === true };
    if (entryId !== undefined)
        row.entryId = entryId;
    const record = {
        id,
        name,
        version,
        origin: originInfo.origin,
        installSpec,
        enabled: plugin.enabled === true,
        builtIn,
        syncable: computeSyncable({ builtIn, origin: originInfo.origin, installSpec, id, name, context }),
        pathOnly: originInfo.origin === 'local-path',
        profile: context.profile,
        platform: context.platform,
        rows: [row],
        configs: {},
        configSkipped: [],
        error: 'no matching bundle metadata was found for this plugin entry',
    };
    const displayName = titleOf(plugin.meta);
    if (displayName !== undefined)
        record.displayName = displayName;
    if (originInfo.source !== undefined)
        record.source = originInfo.source;
    if (originInfo.localPath !== undefined)
        record.localPath = originInfo.localPath;
    await attachConfigs(record, entryId === undefined ? [] : [entryId], context);
    return record;
}
/** Build records from plugin-manager bundles, then add bundle-less orphan rows. */
async function buildFromManager(bundles, plugins, context) {
    const pluginInfos = plugins.filter((plugin) => isRecordObject(plugin));
    const records = [];
    const covered = new Set();
    for (const bundle of bundles) {
        if (!isRecordObject(bundle))
            continue;
        const record = await buildBundleRecord(bundle, pluginInfos, context);
        if (record === null)
            continue;
        records.push(record);
        covered.add(record.name);
        for (const row of record.rows)
            covered.add(row.moduleName);
    }
    for (const plugin of pluginInfos) {
        const moduleName = safeText(plugin.moduleName);
        if (moduleName !== undefined && covered.has(moduleName))
            continue;
        const orphan = await buildOrphanRecord(plugin, context);
        if (orphan === null)
            continue;
        if (covered.has(orphan.name))
            continue;
        covered.add(orphan.name);
        records.push(orphan);
    }
    return records;
}
/** Build records from a profile package.json: the degraded fallback path. */
async function buildFromProfileManifest(context) {
    const records = [];
    for (const [rawName, spec] of Object.entries(context.dependencies)) {
        const name = rawName.trim();
        if (name === '')
            continue;
        const builtIn = name.startsWith('@deepseek-ai/');
        const linkedDir = builtIn || context.profileDir === null ? null : await resolveLinkedPackage(context.profileDir, name);
        const originInfo = builtIn
            ? officialOrigin()
            : classifySource(spec, { linkedDir, profileDir: context.profileDir });
        const dependencyVersion = isValidVersion(spec) ? spec.trim() : null;
        const version = dependencyVersion ?? (await readInstalledVersion(originInfo.localPath, context.profileDir, name));
        const installSpec = resolveInstallSpec(name, originInfo, version);
        const id = originInfo.origin === 'local-path' ? `local:${name}` : name;
        // The manifest does not record enabled state; a dependency that is present
        // is assumed to be loaded, and a later plugin-manager scan corrects it.
        const row = { moduleName: name, enabled: true };
        const record = {
            id,
            name,
            version,
            origin: originInfo.origin,
            installSpec,
            enabled: true,
            builtIn,
            syncable: computeSyncable({ builtIn, origin: originInfo.origin, installSpec, id, name, context }),
            pathOnly: originInfo.origin === 'local-path',
            profile: context.profile,
            platform: context.platform,
            rows: [row],
            configs: {},
            configSkipped: [],
        };
        if (originInfo.source !== undefined)
            record.source = originInfo.source;
        if (originInfo.localPath !== undefined)
            record.localPath = originInfo.localPath;
        await attachConfigs(record, [], context);
        records.push(record);
    }
    return records;
}
/** Merge records observed twice (same id) without losing rows or metadata. */
function dedupeRecords(records) {
    const byId = new Map();
    for (const record of records) {
        const existing = byId.get(record.id);
        if (existing === undefined) {
            byId.set(record.id, record);
            continue;
        }
        for (const row of record.rows) {
            const duplicate = existing.rows.some(candidate => candidate.moduleName === row.moduleName && candidate.entryId === row.entryId);
            if (!duplicate)
                existing.rows.push(row);
        }
        if (existing.version === null && record.version !== null)
            existing.version = record.version;
        if (existing.installSpec === null && record.installSpec !== null)
            existing.installSpec = record.installSpec;
        if (existing.localPath === undefined && record.localPath !== undefined)
            existing.localPath = record.localPath;
        if (existing.displayName === undefined && record.displayName !== undefined) {
            existing.displayName = record.displayName;
        }
        if (existing.source === undefined && record.source !== undefined)
            existing.source = record.source;
        if (existing.error === undefined && record.error !== undefined)
            existing.error = record.error;
        existing.syncable = existing.syncable || record.syncable;
    }
    return [...byId.values()];
}
/** Normalize the device identity, filling a couple of fields defensively. */
function resolveDevice(deps) {
    const input = isRecordObject(deps.device) ? deps.device : {};
    const platform = safeText(input.platform) ?? process.platform;
    return {
        id: safeText(input.id) ?? 'unknown-device',
        name: safeText(input.name) ?? 'DSH Device',
        platform,
        arch: safeText(input.arch) ?? process.arch,
        dshVersion: safeText(input.dshVersion) ?? safeText(deps.dshVersion) ?? 'unknown',
        pluginVersion: safeText(input.pluginVersion) ?? safeText(deps.pluginVersion) ?? 'unknown',
    };
}
/**
 * Create the {@link InventoryScanner}.
 *
 * `scan({ config, profile, signal })` resolves the profile directory, reads
 * the plugin manager (when available) and returns a {@link DeviceInventory}.
 * It throws only `SyncError('cancelled')` (aborted signal) and
 * `SyncError('invalid-config')` (no profile name); plugin-level failures are
 * reported per record.
 */
export function createScanner(deps) {
    const logger = deps.logger;
    const log = {
        debug: (message, details) => {
            try {
                logger?.debug(message, details);
            }
            catch {
                // Logging must never break a scan.
            }
        },
        info: (message, details) => {
            try {
                logger?.info(message, details);
            }
            catch {
                // Logging must never break a scan.
            }
        },
        warn: (message, details) => {
            try {
                logger?.warn(message, details);
            }
            catch {
                // Logging must never break a scan.
            }
        },
    };
    const gateway = createConfigGateway({
        services: {
            configEditor: deps.services?.configEditor,
            settings: deps.services?.settings,
        },
        logger: logger ?? {
            debug: () => { },
            info: () => { },
            warn: () => { },
            error: () => { },
            recent: () => [],
        },
    });
    const isAborted = (signal) => signal?.aborted === true;
    const scan = async (options) => {
        const scanStartedAt = performance.now();
        if (isAborted(options?.signal)) {
            throw new SyncError('cancelled', 'plugin inventory scan was cancelled');
        }
        const flags = readConfigFlags(options?.config);
        const requestedProfile = safeText(options?.profile) ?? flags.profiles[0] ?? '';
        if (requestedProfile === '') {
            throw new SyncError('invalid-config', 'a profile name is required to scan the plugin inventory');
        }
        const device = resolveDevice(deps);
        let profileDir = null;
        try {
            profileDir = await findProfileDir(deps.profilesRoot, requestedProfile);
        }
        catch {
            profileDir = null;
        }
        let dependencies = {};
        if (profileDir !== null) {
            try {
                dependencies = await readProfileDependencies(profileDir);
            }
            catch (error) {
                log.warn(`could not read the package manifest of profile ${requestedProfile}`, {
                    reason: errorMessage(error),
                });
            }
        }
        const context = {
            profile: requestedProfile,
            profileDir,
            dependencies,
            platform: device.platform,
            includeConfigs: flags.includeConfigs,
            includeLocalPlugins: flags.includeLocalPlugins,
            excludedConfig: flags.excludedConfig,
            gateway,
            warn: log.warn,
        };
        let records = null;
        const manager = deps.services?.pluginManager;
        if (manager !== undefined) {
            try {
                const [bundlesRaw, pluginsRaw] = await Promise.all([
                    typeof manager.listBundles === 'function' ? manager.listBundles() : Promise.resolve([]),
                    typeof manager.listPlugins === 'function' ? manager.listPlugins() : Promise.resolve([]),
                ]);
                records = await buildFromManager(Array.isArray(bundlesRaw) ? bundlesRaw : [], Array.isArray(pluginsRaw) ? pluginsRaw : [], context);
            }
            catch (error) {
                log.warn('plugin manager inventory is unavailable; falling back to the profile manifest', {
                    reason: errorMessage(error),
                });
                records = null;
            }
        }
        const useFallback = records === null || (records.length === 0 && Object.keys(dependencies).length > 0);
        if (useFallback) {
            try {
                records = await buildFromProfileManifest(context);
            }
            catch (error) {
                log.warn(`could not build the inventory of profile ${requestedProfile} from its manifest`, {
                    reason: errorMessage(error),
                });
                records = records ?? [];
            }
        }
        if (isAborted(options?.signal)) {
            throw new SyncError('cancelled', 'plugin inventory scan was cancelled');
        }
        const plugins = dedupeRecords(records ?? []);
        plugins.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
        log.info(`scanned ${plugins.length} plugins for profile ${requestedProfile}`, {
            profile: requestedProfile,
            plugins: plugins.length,
            source: records !== null && manager !== undefined && !useFallback ? 'plugin-manager' : 'profile-manifest',
            durationMs: Math.round((performance.now() - scanStartedAt) * 10) / 10,
        });
        return {
            schemaVersion: MANIFEST_SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
            profile: requestedProfile,
            device,
            plugins,
        };
    };
    return { scan };
}
