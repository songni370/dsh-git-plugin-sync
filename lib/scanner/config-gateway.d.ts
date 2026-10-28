/**
 * Configuration extraction and write-back through the Host's Loader/settings
 * services.
 *
 * Two paths exist in DSH 0.2.1-rc.3:
 * 1. `ctx.get('configEditor')` owns the Loader entries and can persist a whole
 *    entry config through `edit()`;
 * 2. `ctx.get('settings')` owns registered settings namespaces and can patch a
 *    namespace through `update()`.
 *
 * The config editor is preferred because it sees per-entry inherited defaults
 * and overrides. Both paths are treated as untrusted input: every value is
 * filtered through the secret rules before it is returned to a caller or
 * written back. Read never throws; write throws a {@link SyncError} with a
 * stable code when no usable path exists.
 * @module scanner/config-gateway
 */
import type { DshConfigEditor, DshSettingsService } from '../dsh.js';
import type { ConfigGateway, SyncLogger } from '../types.js';
/** Dependencies of {@link createConfigGateway}. */
export interface ConfigGatewayDeps {
    /** Optional Host services; either may be absent on a minimal composition. */
    services: {
        configEditor?: DshConfigEditor;
        settings?: DshSettingsService;
    };
    /** Logger used for best-effort diagnostics; never receives config values. */
    logger: SyncLogger;
}
/**
 * Create the {@link ConfigGateway}.
 *
 * Reads are best-effort and never throw. Writes throw
 * `SyncError('invalid-config')` for non-JSON input and
 * `SyncError('unsupported')` when neither Host service can accept a write;
 * values that look like secrets are silently dropped and never written.
 */
export declare function createConfigGateway(deps: ConfigGatewayDeps): ConfigGateway;
