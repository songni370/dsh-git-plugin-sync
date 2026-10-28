/**
 * `PluginInstaller` over the Host's plugin manager service.
 *
 * All install / remove / enable operations go through `ctx.pluginManager` —
 * the supported path that owns pnpm, profile files, activation and reload
 * semantics. This module never edits profile files and never shells out to a
 * package manager. A plugin's own source repository and the user's backup
 * repository stay separate: nothing here knows about the backup repository.
 * @module adapters/installer
 */
import type { DshPluginInfo, DshPluginManager } from '../dsh.js';
import type { PluginInstaller, SyncLogger } from '../types.js';
/** Options for {@link createInstaller}. */
export interface InstallerOptions {
    /** The profile's plugin manager; absent on a composition without one. */
    pluginManager: DshPluginManager | undefined;
    /** The profile this process runs in. Restores are limited to it. */
    activeProfile: string;
    logger: SyncLogger;
}
/** Create the installer. */
export declare function createInstaller(options: InstallerOptions): PluginInstaller;
/** List the plugins currently installed in the active profile. */
export declare function listInstalledPlugins(manager: DshPluginManager | undefined): Promise<DshPluginInfo[]>;
