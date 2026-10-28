/**
 * Local safety snapshots taken before an operation changes the DSH environment.
 *
 * A snapshot records the plugin inventory, versions, enabled states and the
 * configuration values this plugin is allowed to write. Restoring a snapshot
 * can roll configuration and enablement back; it deliberately CANNOT reinstall
 * removed plugins, and says so in the result instead of pretending otherwise.
 * @module services/snapshot
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STATE_SCHEMA_VERSION } from '../constants.js';
import { SyncError, errorMessage } from '../core/errors.js';
import { isJsonValue, safeParseJson } from '../core/json.js';
import { displayPath } from '../core/paths.js';
import { ensurePrivateDir, writeFileAtomic } from '../state/store.js';
/** Validate a snapshot id (never trust a manifest/history-provided string). */
function assertSnapshotId(id) {
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(id) || id === '.' || id === '..') {
        throw new SyncError('invalid-path', `非法快照标识 / invalid snapshot id: ${JSON.stringify(id)}`);
    }
}
/** Create the snapshot service rooted at `<data>/snapshots`. */
export function createSnapshotService(options) {
    const fileFor = (id) => join(options.snapshotDir, id, 'snapshot.json');
    const nextId = () => {
        const now = new Date();
        const pad = (value) => String(value).padStart(2, '0');
        return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
    };
    return {
        async create(input) {
            const id = nextId();
            const snapshot = {
                schemaVersion: STATE_SCHEMA_VERSION,
                createdAt: new Date().toISOString(),
                operation: input.operation,
                profile: input.profile,
                device: input.device,
                inventory: input.inventory,
                configs: input.configs,
            };
            await ensurePrivateDir(join(options.snapshotDir, id));
            await writeFileAtomic(fileFor(id), `${JSON.stringify(snapshot, null, 2)}\n`);
            return id;
        },
        async read(id) {
            assertSnapshotId(id);
            const text = await readFile(fileFor(id), 'utf8');
            const parsed = safeParseJson(text);
            if (!isSnapshot(parsed)) {
                throw new SyncError('invalid-manifest', `快照内容非法 / malformed snapshot: ${id}`);
            }
            return parsed;
        },
        async list() {
            try {
                const entries = await readdir(options.snapshotDir, { withFileTypes: true });
                return entries
                    .filter(entry => entry.isDirectory())
                    .map(entry => entry.name)
                    .sort()
                    .reverse();
            }
            catch {
                return [];
            }
        },
        async rollback(input) {
            const snapshot = await this.read(input.id);
            const report = {
                snapshot: input.id,
                restoredConfigs: [],
                restoredEnabled: [],
                notRestorablePlugins: [],
                errors: [],
            };
            const currentIds = new Set(input.currentInventory.plugins.map(plugin => plugin.id));
            for (const plugin of snapshot.inventory.plugins) {
                if (plugin.builtIn)
                    continue;
                if (!currentIds.has(plugin.id)) {
                    report.notRestorablePlugins.push({ id: plugin.id, name: plugin.name, version: plugin.version });
                    continue;
                }
                const configs = snapshot.configs[plugin.id];
                if (configs !== undefined && Object.keys(configs).length > 0) {
                    try {
                        await input.configGateway.write({
                            moduleName: plugin.name,
                            entryIds: plugin.rows.map(row => row.entryId).filter((id) => typeof id === 'string'),
                            values: configs,
                            profile: input.profile,
                        });
                        report.restoredConfigs.push(plugin.id);
                    }
                    catch (error) {
                        report.errors.push(`${plugin.name}: ${errorMessage(error)}`);
                    }
                }
            }
            const currentById = new Map(input.currentInventory.plugins.map(plugin => [plugin.id, plugin]));
            for (const plugin of snapshot.inventory.plugins) {
                const current = currentById.get(plugin.id);
                if (current === undefined || current.enabled === plugin.enabled)
                    continue;
                try {
                    const result = await input.installer.setEnabled(plugin.name, plugin.enabled, { profile: input.profile });
                    if (result.ok)
                        report.restoredEnabled.push(plugin.id);
                    else
                        report.errors.push(`${plugin.name}: ${result.error ?? 'toggle failed'}`);
                }
                catch (error) {
                    report.errors.push(`${plugin.name}: ${errorMessage(error)}`);
                }
            }
            input.logger.warn('已回滚快照 / rolled back snapshot', {
                snapshot: input.id,
                snapshotPath: displayPath(join(options.snapshotDir, input.id)),
                restoredConfigs: report.restoredConfigs.length,
                notRestorable: report.notRestorablePlugins.length,
            });
            return report;
        },
    };
}
/** Structural validation of a snapshot document. */
function isSnapshot(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const raw = value;
    if (raw.schemaVersion !== STATE_SCHEMA_VERSION)
        return false;
    if (typeof raw.createdAt !== 'string')
        return false;
    if (raw.inventory === null || typeof raw.inventory !== 'object')
        return false;
    const inventory = raw.inventory;
    if (!Array.isArray(inventory.plugins))
        return false;
    if (raw.configs === null || typeof raw.configs !== 'object' || Array.isArray(raw.configs))
        return false;
    for (const config of Object.values(raw.configs)) {
        if (!isJsonValue(config))
            return false;
    }
    return true;
}
/** Configuration values that a snapshot should keep for a plugin. */
export function snapshotConfigs(inventory, excluded) {
    const configs = {};
    for (const plugin of inventory.plugins) {
        if (plugin.builtIn)
            continue;
        if (excluded.includes(plugin.id) || excluded.includes(plugin.name))
            continue;
        if (Object.keys(plugin.configs).length === 0)
            continue;
        configs[plugin.id] = plugin.configs;
    }
    return configs;
}
/** Extract enabled states from an inventory (used by rollback reports). */
export function enabledStates(inventory) {
    const out = {};
    for (const plugin of inventory.plugins)
        out[plugin.id] = plugin.enabled;
    return out;
}
/** Plugin record lookup helper. */
export function pluginRecordOf(inventory, id) {
    return inventory.plugins.find(plugin => plugin.id === id);
}
