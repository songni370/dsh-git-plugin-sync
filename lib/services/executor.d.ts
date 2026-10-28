/**
 * Executes the local half of a plan through the DSH plugin manager and the
 * configuration gateway.
 *
 * Failures are contained per action: one unavailable package must not abort the
 * rest of a restore, which is what lets the result report "5 installed, 1
 * failed, 9 skipped" instead of a single opaque error.
 * @module services/executor
 */
import type { ActionOutcome, ConfigGateway, PlanAction, PluginInstaller, SyncLogger } from '../types.js';
/** Context shared by every local action. */
export interface LocalExecutionContext {
    installer: PluginInstaller;
    configGateway: ConfigGateway;
    logger: SyncLogger;
    profile: string;
    signal?: AbortSignal;
    /** Turn a `backup-tarball:<path>` spec into a real local file path. */
    resolveInstallSpec: (spec: string) => Promise<string>;
}
/** Whether an action is executed locally (as opposed to written to the repo). */
export declare function isLocalAction(action: PlanAction): boolean;
/** Execute every local action in order, containing per-action failures. */
export declare function executeLocalActions(actions: readonly PlanAction[], context: LocalExecutionContext): Promise<ActionOutcome[]>;
