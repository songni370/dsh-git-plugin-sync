/**
 * Executes the local half of a plan through the DSH plugin manager and the
 * configuration gateway.
 *
 * Failures are contained per action: one unavailable package must not abort the
 * rest of a restore, which is what lets the result report "5 installed, 1
 * failed, 9 skipped" instead of a single opaque error.
 * @module services/executor
 */
import { SyncError, errorMessage } from '../core/errors.js';
/** Whether an action is executed locally (as opposed to written to the repo). */
export function isLocalAction(action) {
    return action.kind === 'install'
        || action.kind === 'upgrade'
        || action.kind === 'downgrade'
        || action.kind === 'enable'
        || action.kind === 'disable'
        || action.kind === 'restore-config'
        || action.kind === 'remove-local';
}
/** Derive the install spec for an install-like action. */
async function installSpecFor(action, context) {
    const spec = action.installSpec;
    if (spec !== null && spec !== undefined && spec !== '') {
        if (spec.startsWith('backup-tarball:'))
            return await context.resolveInstallSpec(spec);
        return spec;
    }
    if (action.version !== null && action.version !== undefined && action.version !== '') {
        return `${action.pluginId}@${action.version}`;
    }
    throw new SyncError('install-failed', `插件 ${action.pluginId} 没有可用的安装来源 / no install source recorded`);
}
/** Run one local action. */
async function runAction(action, context) {
    try {
        switch (action.kind) {
            case 'install':
            case 'upgrade':
            case 'downgrade': {
                const spec = await installSpecFor(action, context);
                const result = await context.installer.install(spec, {
                    profile: context.profile,
                    signal: context.signal,
                    name: action.pluginId,
                    version: action.version ?? null,
                });
                const outcome = {
                    action,
                    ok: result.ok,
                    detail: result.message,
                };
                if (result.error !== undefined)
                    outcome.error = result.error;
                if (result.ok && action.enabled === false) {
                    const toggle = await context.installer.setEnabled(action.pluginId, false, { profile: context.profile });
                    outcome.detail = `${result.message}\n${toggle.message}`;
                    if (!toggle.ok)
                        outcome.error = toggle.error;
                }
                return outcome;
            }
            case 'enable':
            case 'disable': {
                const result = await context.installer.setEnabled(action.pluginId, action.kind === 'enable', {
                    profile: context.profile,
                });
                const outcome = { action, ok: result.ok, detail: result.message };
                if (result.error !== undefined)
                    outcome.error = result.error;
                return outcome;
            }
            case 'remove-local': {
                const result = await context.installer.remove(action.pluginId, { profile: context.profile });
                const outcome = { action, ok: result.ok, detail: result.message };
                if (result.error !== undefined)
                    outcome.error = result.error;
                return outcome;
            }
            case 'restore-config': {
                const configs = action.configs ?? {};
                await context.configGateway.write({
                    moduleName: action.pluginId,
                    entryIds: [],
                    values: configs,
                    profile: context.profile,
                });
                return { action, ok: true, detail: '配置已写入 / configuration written' };
            }
            default:
                return {
                    action,
                    ok: false,
                    skipped: true,
                    detail: `动作 ${action.kind} 不是本地动作 / not a local action`,
                };
        }
    }
    catch (error) {
        const message = errorMessage(error);
        context.logger.warn(`本地动作失败 / local action failed: ${action.kind} ${action.pluginId}`, { message });
        return { action, ok: false, error: message, detail: message };
    }
}
/** Execute every local action in order, containing per-action failures. */
export async function executeLocalActions(actions, context) {
    const outcomes = [];
    for (const action of actions) {
        if (!isLocalAction(action))
            continue;
        if (context.signal?.aborted === true) {
            outcomes.push({ action, ok: false, skipped: true, detail: '已取消 / cancelled' });
            continue;
        }
        context.logger.info(`执行 / executing: ${action.kind} ${action.pluginName}`, { version: action.version ?? null });
        outcomes.push(await runAction(action, context));
    }
    return outcomes;
}
