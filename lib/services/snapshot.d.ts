/**
 * Local safety snapshots taken before an operation changes the DSH environment.
 *
 * A snapshot records the plugin inventory, versions, enabled states and the
 * configuration values this plugin is allowed to write. Restoring a snapshot
 * can roll configuration and enablement back; it deliberately CANNOT reinstall
 * removed plugins, and says so in the result instead of pretending otherwise.
 * @module services/snapshot
 */
import type { ConfigGateway, DeviceInventory, DeviceInfo, JsonObject, PluginRecord, PluginInstaller, SyncLogger } from '../types.js';
/** One snapshot document. */
export interface LocalSnapshot {
    schemaVersion: number;
    createdAt: string;
    operation: 'restore' | 'sync' | 'rollback';
    profile: string;
    device: DeviceInfo;
    inventory: DeviceInventory;
    /** Configuration values that this plugin wrote (or would write). */
    configs: Record<string, JsonObject>;
}
/** Snapshot service. */
export interface SnapshotService {
    /** Persist a snapshot; returns its opaque id (a directory name). */
    create(options: {
        operation: LocalSnapshot['operation'];
        profile: string;
        device: DeviceInfo;
        inventory: DeviceInventory;
        configs: Record<string, JsonObject>;
    }): Promise<string>;
    /** Read one snapshot by id. */
    read(id: string): Promise<LocalSnapshot>;
    /** List snapshot ids, newest first. */
    list(): Promise<string[]>;
    /** Roll back the parts that can be rolled back. */
    rollback(options: {
        id: string;
        installer: PluginInstaller;
        configGateway: ConfigGateway;
        profile: string;
        logger: SyncLogger;
        currentInventory: DeviceInventory;
    }): Promise<RollbackReport>;
}
/** What a rollback managed to restore. */
export interface RollbackReport {
    snapshot: string;
    restoredConfigs: string[];
    restoredEnabled: string[];
    /** Plugins that were removed and cannot be reinstalled from a snapshot. */
    notRestorablePlugins: {
        id: string;
        name: string;
        version: string | null;
    }[];
    errors: string[];
}
/** Create the snapshot service rooted at `<data>/snapshots`. */
export declare function createSnapshotService(options: {
    snapshotDir: string;
}): SnapshotService;
/** Configuration values that a snapshot should keep for a plugin. */
export declare function snapshotConfigs(inventory: DeviceInventory, excluded: readonly string[]): Record<string, JsonObject>;
/** Extract enabled states from an inventory (used by rollback reports). */
export declare function enabledStates(inventory: DeviceInventory): Record<string, boolean>;
/** Plugin record lookup helper. */
export declare function pluginRecordOf(inventory: DeviceInventory, id: string): PluginRecord | undefined;
