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
import type { DshConfigEditor, DshPluginManager, DshProfileContext, DshSettingsService } from '../dsh.js';
import type { DeviceInfo, InventoryScanner, SyncLogger } from '../types.js';
/** Optional Host services the scanner can use. */
export interface ScannerServices {
    pluginManager?: DshPluginManager;
    configEditor?: DshConfigEditor;
    settings?: DshSettingsService;
    profileContext?: DshProfileContext;
}
/** Dependencies of {@link createScanner}. */
export interface ScannerDeps {
    /** Host services; every one is optional so a minimal composition still scans. */
    services: ScannerServices;
    /** `<DSH home>/profiles`; the fallback inventory reads profiles from here. */
    profilesRoot: string;
    /** Version of this plugin, recorded in the device identity. */
    pluginVersion: string;
    /** Running DSH version, recorded in the device identity. */
    dshVersion: string;
    /** Logger; receives no configuration values. */
    logger: SyncLogger;
    /** Device identity included in every inventory. */
    device: DeviceInfo;
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
export declare function createScanner(deps: ScannerDeps): InventoryScanner;
