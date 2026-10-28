/**
 * Pure planning: compare local, remote and baseline states and produce the
 * exact actions a backup, restore or two-way sync would execute.
 *
 * Nothing in this module performs I/O, which is what makes the destructive
 * parts reviewable: the settings page shows this plan, the agent tools return
 * it, and the executor runs only what the plan (plus the user's conflict
 * choices) contains.
 *
 * Change attribution is a three-way comparison:
 * - base   = what this device last agreed with the repository about
 * - local  = what is installed now
 * - remote = what the repository says now
 *
 * `localChanged` alone means this device changed → push.
 * `remoteChanged` alone means another device changed → apply locally.
 * Both changed and still different is a conflict: never resolved silently.
 * @module services/plan
 */
import { compareVersions, versionRelation } from '../core/version.js';
import { changedConfigKeys, changedFields, statesEqual } from './model.js';
/** Ids present on at least one side. */
function unionIds(...maps) {
    const ids = new Set();
    for (const map of maps)
        for (const id of Object.keys(map))
            ids.add(id);
    return [...ids].sort();
}
/** Name to show for a plugin id. */
function displayNameOf(id, ...states) {
    for (const state of states)
        if (state !== null && state !== undefined)
            return state.displayName ?? state.name;
    return id;
}
/** Build the conflict report for one plugin. */
function makeConflict(id, reason, base, local, remote, meta) {
    const fields = new Set([...changedFields(base, local), ...changedFields(base, remote)]);
    for (const field of fields) {
        // "presence" is reported as deleted/added rather than as a field.
        if (field === 'presence')
            continue;
    }
    const conflict = {
        id: `conflict:${id}`,
        pluginId: id,
        pluginName: displayNameOf(id, local, remote, base),
        reason,
        fields: [...fields].filter(field => field !== 'presence'),
        localVersion: local?.version ?? null,
        remoteVersion: remote?.version ?? null,
        localEnabled: local?.enabled ?? null,
        remoteEnabled: remote?.enabled ?? null,
    };
    if (local !== null && local !== undefined)
        conflict.localConfig = local.configs;
    if (remote !== null && remote !== undefined)
        conflict.remoteConfig = remote.configs;
    if (base !== null && base !== undefined)
        conflict.baseConfig = base.configs;
    if (meta !== undefined) {
        conflict.remoteDevice = meta.updatedBy;
        conflict.remoteUpdatedAt = meta.updatedAt;
    }
    return conflict;
}
/** Find a user decision for a plugin. */
function resolutionFor(resolutions, pluginId) {
    return resolutions?.find(item => item.pluginId === pluginId);
}
/** Actions for applying a remote version to the local device. */
function localApplyActions(remote, local, options) {
    const actions = [];
    const targetVersion = remote.version;
    const versionDiffers = local === null || local === undefined || local.version !== remote.version;
    if (versionDiffers) {
        const relation = local === null || local === undefined ? null : compareVersions(remote.version, local.version);
        const kind = relation === -1 ? 'downgrade' : 'upgrade';
        actions.push({
            kind,
            pluginId: remote.id,
            pluginName: remote.displayName ?? remote.name,
            detail: local === null || local === undefined
                ? `安装 ${remote.name}@${targetVersion ?? '?'} / install`
                : `版本 ${local.version ?? '?'} → ${remote.version ?? '?'} (${kind === 'downgrade' ? '降级 / downgrade' : '升级 / upgrade'})`,
            destructive: kind === 'downgrade',
            installSpec: remote.installSpec ?? undefined,
            version: targetVersion ?? undefined,
            from: local?.version ?? undefined,
        });
    }
    if (local !== null && local !== undefined && local.enabled !== remote.enabled) {
        actions.push({
            kind: remote.enabled ? 'enable' : 'disable',
            pluginId: remote.id,
            pluginName: remote.displayName ?? remote.name,
            detail: remote.enabled ? '启用插件 / enable' : '禁用插件 / disable',
            destructive: false,
            enabled: remote.enabled,
        });
    }
    const configs = options.manualConfig ?? remote.configs;
    if (options.includeConfigs && Object.keys(configs).length > 0) {
        const differs = local === null || local === undefined
            ? true
            : changedConfigKeys(local.configs, configs).length > 0;
        if (differs) {
            actions.push({
                kind: 'restore-config',
                pluginId: remote.id,
                pluginName: remote.displayName ?? remote.name,
                detail: '恢复插件配置 / restore plugin configuration',
                destructive: false,
                configs,
            });
        }
    }
    return actions;
}
/** Actions for writing a local state into the repository. */
function remotePushActions(local, remote, includeConfigs) {
    const actions = [];
    const versionDiffers = remote === null || remote === undefined || remote.version !== local.version;
    const configDiffers = remote === null || remote === undefined
        ? Object.keys(local.configs).length > 0
        : changedConfigKeys(remote.configs, local.configs).length > 0;
    if (versionDiffers || (remote !== null && remote !== undefined && remote.enabled !== local.enabled)) {
        actions.push({
            kind: 'push-plugin',
            pluginId: local.id,
            pluginName: local.displayName ?? local.name,
            detail: remote === null || remote === undefined
                ? `新增到远端 ${local.name}@${local.version ?? '?'} / add to repository`
                : `更新远端 ${local.name} ${remote.version ?? '?'} → ${local.version ?? '?'}`,
            destructive: false,
            version: local.version ?? undefined,
            enabled: local.enabled,
            from: remote?.version ?? undefined,
        });
    }
    if (includeConfigs && configDiffers) {
        actions.push({
            kind: 'push-config',
            pluginId: local.id,
            pluginName: local.displayName ?? local.name,
            detail: '上传插件配置 / upload plugin configuration',
            destructive: false,
            configs: local.configs,
        });
    }
    return actions;
}
/** Build the diff row for one plugin comparison. */
function makeDiff(id, options) {
    const { local, remote, base, conflict } = options;
    const includeConfigs = options.includeConfigs ?? true;
    const name = displayNameOf(id, local, remote, base);
    let kind = options.kind ?? 'identical';
    const destructive = false;
    if (options.kind === undefined) {
        if (conflict !== undefined) {
            if (conflict.reason === 'remote-deleted')
                kind = 'deleted-remote';
            else if (conflict.reason === 'local-deleted')
                kind = 'missing-local';
            else if (local !== null && local !== undefined && remote !== null && remote !== undefined) {
                kind = local.version !== remote.version ? 'version-diff' : 'config-diff';
            }
            else
                kind = 'config-diff';
        }
        else if (local === null || local === undefined) {
            kind = 'missing-local';
        }
        else if (remote === null || remote === undefined) {
            kind = 'missing-remote';
        }
        else if (local.version !== remote.version) {
            kind = 'version-diff';
        }
        else if (local.enabled !== remote.enabled) {
            kind = 'enabled-diff';
        }
        else if (includeConfigs && changedConfigKeys(local.configs, remote.configs).length > 0) {
            kind = 'config-diff';
        }
    }
    const diff = {
        id,
        name,
        kind,
        destructive,
    };
    if (local !== null && local !== undefined)
        diff.local = toPluginRecordShim(local);
    if (remote !== null && remote !== undefined)
        diff.remote = toRemoteShim(remote);
    if (base !== null && base !== undefined)
        diff.base = toPluginRecordShim(base);
    if (conflict !== undefined)
        diff.conflict = conflict;
    if (includeConfigs && local !== null && local !== undefined && remote !== null && remote !== undefined) {
        const keys = changedConfigKeys(local.configs, remote.configs);
        if (keys.length > 0)
            diff.configChangedKeys = keys;
    }
    return diff;
}
/**
 * Compact shims: {@link PluginDiff} carries scanner types, while the planner
 * only knows the normalized projection. Only fields the UI reads are filled.
 */
function toPluginRecordShim(state) {
    return {
        id: state.id,
        name: state.name,
        displayName: state.displayName,
        version: state.version,
        origin: state.origin,
        installSpec: state.installSpec,
        enabled: state.enabled,
        builtIn: state.builtIn,
        syncable: state.syncable,
        pathOnly: state.pathOnly,
        profile: '',
        platform: '',
        rows: state.rows,
        configs: state.configs,
        configSkipped: [],
    };
}
function toRemoteShim(state) {
    return {
        id: state.id,
        name: state.name,
        displayName: state.displayName,
        version: state.version,
        origin: state.origin,
        installSpec: state.installSpec,
        enabled: state.enabled,
        builtIn: state.builtIn,
        syncable: state.syncable,
        pathOnly: state.pathOnly,
        rows: state.rows,
        deleted: false,
        updatedAt: '',
        updatedBy: '',
    };
}
/** Whether a local state can be installed elsewhere. */
function isRestorable(state) {
    if (state.builtIn)
        return false;
    if (state.installSpec !== null && state.installSpec !== '')
        return true;
    return state.origin === 'npm' && state.version !== null;
}
/** Build one plan action for a remote plugin that only exists remotely. */
function pushDeleteAction(state, destructive) {
    return {
        kind: 'remove-remote',
        pluginId: state.id,
        pluginName: state.displayName ?? state.name,
        detail: `从远端备份中标记删除 ${state.name} / mark deleted in repository`,
        destructive,
        version: state.version ?? undefined,
    };
}
/** Build one plan action for removing a plugin locally. */
function removeLocalAction(state) {
    return {
        kind: 'remove-local',
        pluginId: state.id,
        pluginName: state.displayName ?? state.name,
        detail: `从本机移除 ${state.name} / remove from this device`,
        destructive: true,
        version: state.version ?? undefined,
    };
}
// ---------------------------------------------------------------------------
// Backup (push)
// ---------------------------------------------------------------------------
/** Plan a backup: this device's state becomes the repository's state. */
export function planBackup(input) {
    const actions = [];
    const diffs = [];
    const warnings = [...(input.warnings ?? [])];
    const includeConfigs = input.config.includeConfigs;
    const destructiveIds = new Set();
    const localIds = new Set(Object.keys(input.local));
    for (const id of unionIds(input.local, input.base)) {
        const local = input.local[id] ?? null;
        const remote = input.remote[id] ?? null;
        const base = input.base[id] ?? null;
        if (local !== null && (local.builtIn || !local.syncable)) {
            if (!local.builtIn)
                warnings.push(`插件 ${local.name} 已被排除，未备份 / plugin excluded from backup`);
            continue;
        }
        if (local !== null) {
            const push = remotePushActions(local, remote, includeConfigs);
            if (push.length === 0) {
                diffs.push(makeDiff(id, { local, remote, base, includeConfigs }));
                continue;
            }
            actions.push(...push);
            diffs.push(makeDiff(id, { local, remote, base, includeConfigs }));
            continue;
        }
        // local is null: this device no longer has the plugin.
        if (base === null)
            continue;
        if (remote === null)
            continue; // already absent remotely
        actions.push(pushDeleteAction(remote, true));
        destructiveIds.add(id);
        diffs.push(makeDiff(id, {
            local: null,
            remote,
            base,
            conflict: makeConflict(id, 'local-deleted', base, null, remote, input.remoteMeta[id]),
            includeConfigs,
            kind: 'deleted-remote',
        }));
    }
    for (const id of localIds) {
        const local = input.local[id];
        if (local === undefined || local.builtIn || !local.syncable)
            continue;
        if (!isRestorable(local)) {
            warnings.push(`本地插件 ${local.name} 无法自动安装到其他设备，已备份记录但不可恢复 / local plugin is not restorable`);
        }
    }
    return {
        direction: 'push',
        profile: input.profile,
        generatedAt: input.now,
        actions,
        conflicts: [],
        diffs,
        requiresConfirmation: destructiveIds.size > 0,
        warnings,
        localPluginCount: Object.keys(input.local).length,
        remotePluginCount: Object.keys(input.remote).length,
    };
}
// ---------------------------------------------------------------------------
// Restore (pull)
// ---------------------------------------------------------------------------
/** Plan a restore: the repository's state is applied to this device. */
export function planRestore(input) {
    const actions = [];
    const diffs = [];
    const conflicts = [];
    const warnings = [...(input.warnings ?? [])];
    const includeConfigs = input.config.includeConfigs;
    const resolutions = input.resolutions;
    for (const id of unionIds(input.remote, input.base, input.local)) {
        const remote = input.remote[id] ?? null;
        const local = input.local[id] ?? null;
        const base = input.base[id] ?? null;
        if (input.remoteTombstones.has(id) && remote === null) {
            if (local !== null) {
                warnings.push(`远端已删除插件 ${local.name}；恢复不会自动删除本地插件 / deleted remotely; restore keeps the local copy`);
                diffs.push(makeDiff(id, { local, remote: null, base, includeConfigs }));
            }
            continue;
        }
        if (remote === null) {
            if (local !== null) {
                warnings.push(`本地插件 ${local.name} 不在备份中，恢复不会删除它 / not in the backup; restore keeps it`);
            }
            continue;
        }
        if (remote.builtIn || !remote.syncable)
            continue;
        const needInstall = local === null || local.version !== remote.version;
        const needToggle = local !== null && local.enabled !== remote.enabled;
        let configConflict = false;
        let needConfig = false;
        if (includeConfigs && local !== null) {
            const keys = changedConfigKeys(local.configs, remote.configs);
            if (keys.length > 0) {
                const safe = base !== null && changedConfigKeys(base.configs, local.configs).length === 0;
                if (safe)
                    needConfig = true;
                else
                    configConflict = true;
            }
        }
        else if (includeConfigs && local === null) {
            needConfig = Object.keys(remote.configs).length > 0;
        }
        let conflict;
        if (configConflict) {
            conflict = makeConflict(id, 'config-conflict', base, local, remote, input.remoteMeta[id]);
            const resolution = resolutionFor(resolutions, id);
            if (resolution === undefined || resolution.choice === 'skip') {
                conflicts.push(conflict);
                diffs.push(makeDiff(id, { local, remote, base, conflict, includeConfigs }));
                continue;
            }
            if (resolution.choice === 'remote') {
                conflict = undefined;
                needConfig = true;
            }
            else if (resolution.choice === 'manual') {
                conflict = undefined;
                needConfig = resolution.manualConfig !== undefined;
            }
            else {
                // "local" keeps the local configuration and skips the remote one.
                conflict = undefined;
            }
        }
        if (!isRestorable(remote) && needInstall) {
            warnings.push(`备份中的插件 ${remote.name} 缺少可安装来源，已跳过 / no install source recorded; skipped`);
            diffs.push(makeDiff(id, { local, remote, base, includeConfigs }));
            continue;
        }
        const actionsForPlugin = localApplyActions(remote, local, {
            includeConfigs: needConfig,
            manualConfig: resolutionFor(resolutions, id)?.manualConfig ?? undefined,
        });
        if (needToggle && !actionsForPlugin.some(action => action.kind === 'enable' || action.kind === 'disable')) {
            actionsForPlugin.push({
                kind: remote.enabled ? 'enable' : 'disable',
                pluginId: id,
                pluginName: remote.displayName ?? remote.name,
                detail: remote.enabled ? '启用插件 / enable' : '禁用插件 / disable',
                destructive: false,
                enabled: remote.enabled,
            });
        }
        actions.push(...actionsForPlugin);
        diffs.push(makeDiff(id, { local, remote, base, conflict, includeConfigs }));
    }
    return {
        direction: 'pull',
        profile: input.profile,
        generatedAt: input.now,
        actions,
        conflicts,
        diffs,
        requiresConfirmation: actions.length > 0,
        warnings: dedupe(warnings),
        localPluginCount: Object.keys(input.local).length,
        remotePluginCount: Object.keys(input.remote).length,
    };
}
// ---------------------------------------------------------------------------
// Two-way sync
// ---------------------------------------------------------------------------
/** Plan a two-way synchronization. */
export function planSync(input) {
    const actions = [];
    const diffs = [];
    const conflicts = [];
    const warnings = [...(input.warnings ?? [])];
    const includeConfigs = input.config.includeConfigs;
    const resolutions = input.resolutions;
    const destructive = new Set();
    const ids = new Set([...unionIds(input.local, input.remote, input.base), ...input.remoteTombstones]);
    for (const id of [...ids].sort()) {
        const local = input.local[id] ?? null;
        const remote = input.remote[id] ?? null;
        const base = input.base[id] ?? null;
        const meta = input.remoteMeta[id];
        if (local !== null && (local.builtIn || !local.syncable)) {
            if (!local.builtIn)
                warnings.push(`插件 ${local.name} 已被排除，未同步 / plugin excluded from sync`);
            continue;
        }
        if (remote !== null && (remote.builtIn || !remote.syncable))
            continue;
        const localChanged = !statesEqual(local, base);
        const remoteChanged = !statesEqual(remote, base);
        if (!localChanged && !remoteChanged) {
            diffs.push(makeDiff(id, { local, remote, base, includeConfigs }));
            continue;
        }
        if (localChanged && !remoteChanged) {
            // This device changed: push it.
            const resolution = resolutionFor(resolutions, id);
            if (local === null) {
                // Local deletion: needs explicit confirmation because it deletes remote data.
                if (input.config.allowPluginRemoval && resolution?.choice === 'local') {
                    if (remote !== null)
                        actions.push(pushDeleteAction(remote, true));
                    destructive.add(id);
                    diffs.push(makeDiff(id, { local, remote, base, includeConfigs }));
                    continue;
                }
                const conflict = makeConflict(id, 'local-deleted', base, local, remote, meta);
                if (resolution === undefined || resolution.choice === 'skip') {
                    conflicts.push(conflict);
                }
                else if (resolution.choice === 'remote') {
                    if (remote === null) {
                        conflicts.push(conflict);
                    }
                    else {
                        actions.push(...localApplyActions(remote, local, { includeConfigs }));
                        diffs.push(makeDiff(id, { local, remote, base, includeConfigs }));
                        continue;
                    }
                }
                else {
                    conflicts.push(conflict);
                }
                diffs.push(makeDiff(id, { local, remote, base, conflict, includeConfigs }));
                continue;
            }
            if (!isRestorable(local) && remote === null) {
                warnings.push(`本地插件 ${local.name} 无法在其他设备安装，仅记录 / local plugin cannot be restored elsewhere`);
            }
            actions.push(...remotePushActions(local, remote, includeConfigs));
            diffs.push(makeDiff(id, { local, remote, base, includeConfigs }));
            continue;
        }
        if (!localChanged && remoteChanged) {
            // Another device changed: apply it locally.
            const resolution = resolutionFor(resolutions, id);
            if (remote === null) {
                // Remote deletion: destructive locally, so only with permission.
                if (local === null)
                    continue;
                if (input.config.allowPluginRemoval && resolution?.choice === 'remote') {
                    actions.push(removeLocalAction(local));
                    destructive.add(id);
                    diffs.push(makeDiff(id, { local, remote, base, includeConfigs }));
                    continue;
                }
                const conflict = makeConflict(id, 'remote-deleted', base, local, remote, meta);
                if (resolution?.choice === 'local') {
                    actions.push(...remotePushActions(local, remote, includeConfigs));
                    diffs.push(makeDiff(id, { local, remote, base, includeConfigs }));
                    continue;
                }
                conflicts.push(conflict);
                diffs.push(makeDiff(id, { local, remote, base, conflict, includeConfigs }));
                continue;
            }
            if (!isRestorable(remote)) {
                warnings.push(`备份中的插件 ${remote.name} 缺少可安装来源，已跳过 / no install source; skipped`);
                diffs.push(makeDiff(id, { local, remote, base, includeConfigs }));
                continue;
            }
            actions.push(...localApplyActions(remote, local, { includeConfigs }));
            diffs.push(makeDiff(id, { local, remote, base, includeConfigs }));
            continue;
        }
        // Both sides changed.
        if (statesEqual(local, remote)) {
            diffs.push(makeDiff(id, { local, remote, base, includeConfigs }));
            continue;
        }
        const conflict = makeConflict(id, local === null ? 'local-deleted' : remote === null ? 'remote-deleted' : 'both-changed', base, local, remote, meta);
        const resolution = resolutionFor(resolutions, id);
        if (resolution === undefined || resolution.choice === 'skip') {
            conflicts.push(conflict);
            diffs.push(makeDiff(id, { local, remote, base, conflict, includeConfigs }));
            continue;
        }
        if (resolution.choice === 'local') {
            if (local === null) {
                if (remote !== null)
                    actions.push(pushDeleteAction(remote, true));
                destructive.add(id);
            }
            else {
                actions.push(...remotePushActions(local, remote, includeConfigs));
            }
            diffs.push(makeDiff(id, { local, remote, base, includeConfigs }));
            continue;
        }
        if (resolution.choice === 'remote') {
            if (remote === null) {
                if (local !== null) {
                    actions.push(removeLocalAction(local));
                    destructive.add(id);
                }
            }
            else if (!isRestorable(remote) && (local === null || local.version !== remote.version)) {
                warnings.push(`备份中的插件 ${remote.name} 缺少可安装来源，已跳过 / no install source; skipped`);
            }
            else {
                actions.push(...localApplyActions(remote, local, { includeConfigs }));
            }
            diffs.push(makeDiff(id, { local, remote, base, includeConfigs }));
            continue;
        }
        // Manual: apply the user's config locally and push the merged state.
        if (local !== null) {
            const manualConfig = resolution.manualConfig;
            if (manualConfig !== undefined) {
                actions.push(...localApplyActions({ ...local, configs: manualConfig }, local, { includeConfigs: true, manualConfig }));
                actions.push(...remotePushActions({ ...local, configs: manualConfig }, remote, true));
            }
            diffs.push(makeDiff(id, { local, remote, base, includeConfigs }));
        }
        else {
            conflicts.push(conflict);
            diffs.push(makeDiff(id, { local, remote, base, conflict, includeConfigs }));
        }
    }
    if (conflicts.length > 0) {
        warnings.push(`存在 ${conflicts.length} 个未解决的冲突，自动同步会暂停 / unresolved conflicts pause auto-sync`);
    }
    return {
        direction: 'two-way',
        profile: input.profile,
        generatedAt: input.now,
        actions,
        conflicts,
        diffs,
        requiresConfirmation: destructive.size > 0 || actions.some(action => action.destructive),
        warnings: dedupe(warnings),
        localPluginCount: Object.keys(input.local).length,
        remotePluginCount: Object.keys(input.remote).length,
    };
}
/** Stable deduplication of warning lines. */
function dedupe(values) {
    return [...new Set(values)];
}
/** Count pending changes by direction, for the status panel. */
export function countPlanChanges(plan) {
    let uploads = 0;
    let downloads = 0;
    let destructive = 0;
    for (const action of plan.actions) {
        if (action.kind === 'push-plugin' || action.kind === 'push-config' || action.kind === 'remove-remote')
            uploads += 1;
        else
            downloads += 1;
        if (action.destructive)
            destructive += 1;
    }
    return { uploads, downloads, destructive };
}
/** Version relation helper re-exported for the status view. */
export { versionRelation };
