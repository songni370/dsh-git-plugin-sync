/**
 * Agent tools.
 *
 * Every tool calls the same {@link SyncEngine} method the settings page calls —
 * no operation logic is duplicated here, and no tool builds a shell command.
 * Destructive work is two-phase for the model: without `confirm: true` the tool
 * returns the preview plan; with it, the engine still refuses unless the plan
 * was explicitly confirmed, so an agent cannot destroy data silently.
 * @module tools/tools
 */
import { SyncError, errorMessage } from '../core/errors.js';
/** Parameters shared by tools that can preview or execute. */
const CONFIRM_PARAMETER = {
    type: 'boolean',
    description: 'Execute for real. Omit or false to receive a preview plan first. Destructive plans additionally require the user to confirm explicitly.',
};
/** Conflict resolution parameter schema. */
const RESOLUTIONS_PARAMETER = {
    type: 'array',
    description: 'Decisions for conflicts returned by a previous preview.',
    items: {
        type: 'object',
        properties: {
            pluginId: { type: 'string' },
            choice: { type: 'string', enum: ['local', 'remote', 'skip', 'manual'] },
            manualConfig: { type: 'object', additionalProperties: true },
        },
        required: ['pluginId', 'choice'],
        additionalProperties: false,
    },
};
/** Build one tool definition. */
function tool(definition) {
    return definition;
}
/** Render a JSON value as the model-facing text block. */
function renderJson(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}
/**
 * Project a tool result onto lossless JSON.
 *
 * The tool registry rejects any canonical value that is not lossless JSON, and
 * plans legitimately carry optional fields as explicit `undefined`. A JSON
 * round-trip drops exactly those keys, which is the documented lossless
 * projection — without it every preview tool would fail at the boundary.
 */
function lossless(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}
/** Read a boolean argument. */
function booleanArg(value) {
    return typeof value === 'boolean' ? value : undefined;
}
/** Read a string argument. */
function stringArg(value) {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
/** Read a number argument. */
function numberArg(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
/** Read conflict resolutions from unknown arguments. */
function resolutionsArg(value) {
    if (!Array.isArray(value))
        return undefined;
    const out = [];
    for (const item of value) {
        if (item === null || typeof item !== 'object' || Array.isArray(item))
            continue;
        const raw = item;
        if (typeof raw.pluginId !== 'string')
            continue;
        if (raw.choice !== 'local' && raw.choice !== 'remote' && raw.choice !== 'skip' && raw.choice !== 'manual')
            continue;
        const resolution = {
            pluginId: raw.pluginId,
            choice: raw.choice,
        };
        if (raw.manualConfig !== null && typeof raw.manualConfig === 'object' && !Array.isArray(raw.manualConfig)) {
            resolution.manualConfig = raw.manualConfig;
        }
        out.push(resolution);
    }
    return out.length === 0 ? undefined : out;
}
/** Normalize a thrown error into a tool result rather than a tool crash. */
function errorResult(error) {
    if (error instanceof SyncError) {
        const details = error.details;
        if (error.code === 'confirmation-required' || error.code === 'conflict-present') {
            return lossless({
                ok: true,
                requiresConfirmation: true,
                needsUserDecision: true,
                reason: error.message,
                plan: details?.plan,
            });
        }
        return { ok: false, error: { code: error.code, message: error.message } };
    }
    return { ok: false, error: { code: 'internal', message: errorMessage(error) } };
}
/** Build the six tools. */
export function buildToolDefinitions(engine) {
    return [
        tool({
            name: 'dsh_git_plugin_status',
            description: 'Show the DSH Plugin Git Sync status: configured repository, branch, device, last sync time/commit, local and remote plugin counts, pending upload/download counts, conflicts and the last error. Use `refresh: true` to contact the Git remote. Read-only.',
            parameters: {
                type: 'object',
                properties: {
                    refresh: { type: 'boolean', description: 'Fetch the remote before computing the status.' },
                },
                additionalProperties: false,
            },
            output: { schema: { type: 'object' }, render: renderJson },
            timeoutMs: 120_000,
            isConcurrencySafe: () => true,
            execute: async (args) => {
                const raw = (args ?? {});
                try {
                    const result = await engine.status({ refresh: booleanArg(raw.refresh) === true });
                    return lossless({ ok: true, ...result });
                }
                catch (error) {
                    return errorResult(error);
                }
            },
        }),
        tool({
            name: 'dsh_git_plugin_backup',
            description: 'Back up this device\'s installed DSH plugins, versions, enabled states and filtered configuration to the configured Git repository. Returns a preview plan when a destructive change needs confirmation. Set `confirm: true` only after the user agreed to the preview.',
            parameters: {
                type: 'object',
                properties: {
                    message: { type: 'string', description: 'Optional short message stored in the backup commit.' },
                    confirm: CONFIRM_PARAMETER,
                },
                additionalProperties: false,
            },
            output: { schema: { type: 'object' }, render: renderJson },
            timeoutMs: 300_000,
            isConcurrencySafe: () => false,
            execute: async (args) => {
                const raw = (args ?? {});
                try {
                    const result = await engine.backup({
                        message: stringArg(raw.message),
                        confirmDestructive: booleanArg(raw.confirm) === true,
                    });
                    return lossless({ ok: true, result });
                }
                catch (error) {
                    return errorResult(error);
                }
            },
        }),
        tool({
            name: 'dsh_git_plugin_restore',
            description: 'Restore DSH plugins from the Git backup repository: preview first (default), then execute with `confirm: true`. The preview lists plugins to install, version changes and configuration conflicts. Restoring never deletes plugins that are not in the backup. To restore a historical commit, pass its hash as `commit`.',
            parameters: {
                type: 'object',
                properties: {
                    commit: { type: 'string', description: 'History commit to restore; defaults to the branch head.' },
                    pluginIds: { type: 'array', items: { type: 'string' }, description: 'Optional subset of plugin ids to restore.' },
                    resolutions: RESOLUTIONS_PARAMETER,
                    confirm: CONFIRM_PARAMETER,
                },
                additionalProperties: false,
            },
            output: { schema: { type: 'object' }, render: renderJson },
            timeoutMs: 300_000,
            isConcurrencySafe: () => false,
            execute: async (args) => {
                const raw = (args ?? {});
                const commit = stringArg(raw.commit);
                try {
                    if (booleanArg(raw.confirm) !== true) {
                        const preview = await engine.previewRestore({ commit });
                        return lossless({
                            ok: true,
                            requiresConfirmation: preview.plan.actions.length > 0,
                            source: preview.source,
                            plan: preview.plan,
                            hint: 'Review the plan with the user, then call again with confirm: true.',
                        });
                    }
                    const result = await engine.restore({
                        commit,
                        pluginIds: Array.isArray(raw.pluginIds) ? raw.pluginIds.filter((id) => typeof id === 'string') : undefined,
                        resolutions: resolutionsArg(raw.resolutions),
                        confirmDestructive: true,
                    });
                    return lossless({ ok: true, result });
                }
                catch (error) {
                    return errorResult(error);
                }
            },
        }),
        tool({
            name: 'dsh_git_plugin_sync',
            description: 'Two-way synchronize this device with the Git backup repository: local-only changes are uploaded and remote-only changes are applied locally. Preview first (default) and execute with `confirm: true`. Conflicts are never resolved automatically; pass `resolutions` to decide them, otherwise the user must resolve them in the settings page.',
            parameters: {
                type: 'object',
                properties: {
                    resolutions: RESOLUTIONS_PARAMETER,
                    confirm: CONFIRM_PARAMETER,
                },
                additionalProperties: false,
            },
            output: { schema: { type: 'object' }, render: renderJson },
            timeoutMs: 300_000,
            isConcurrencySafe: () => false,
            execute: async (args) => {
                const raw = (args ?? {});
                try {
                    if (booleanArg(raw.confirm) !== true) {
                        const preview = await engine.previewSync();
                        return lossless({
                            ok: true,
                            requiresConfirmation: preview.plan.actions.length > 0 || preview.plan.conflicts.length > 0,
                            plan: preview.plan,
                            hint: 'Review the plan and conflicts with the user, then call again with confirm: true and resolutions if needed.',
                        });
                    }
                    const result = await engine.sync({
                        resolutions: resolutionsArg(raw.resolutions),
                        confirmDestructive: true,
                    });
                    return lossless({ ok: true, result });
                }
                catch (error) {
                    return errorResult(error);
                }
            },
        }),
        tool({
            name: 'dsh_git_plugin_diff',
            description: 'Compare this device\'s DSH plugins with the Git backup repository without changing anything. direction "push" previews a backup, "pull" previews a restore, "two-way" previews a sync (default). Returns per-plugin differences and any conflicts.',
            parameters: {
                type: 'object',
                properties: {
                    direction: { type: 'string', enum: ['push', 'pull', 'two-way'], description: 'Which operation to preview.' },
                    commit: { type: 'string', description: 'Compare against a history commit (pull direction).' },
                },
                additionalProperties: false,
            },
            output: { schema: { type: 'object' }, render: renderJson },
            timeoutMs: 120_000,
            isConcurrencySafe: () => true,
            execute: async (args) => {
                const raw = (args ?? {});
                const direction = raw.direction === 'push' || raw.direction === 'pull' || raw.direction === 'two-way' ? raw.direction : 'two-way';
                try {
                    const result = await engine.diff({ direction, commit: stringArg(raw.commit) });
                    return lossless({ ok: true, ...result });
                }
                catch (error) {
                    return errorResult(error);
                }
            },
        }),
        tool({
            name: 'dsh_git_plugin_history',
            description: 'List recent backup commits of the DSH Plugin Git Sync repository: time, commit hash, device, operation, result and changed plugin count. Read-only.',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'number', description: 'Maximum number of commits to return (default 20, max 200).' },
                },
                additionalProperties: false,
            },
            output: { schema: { type: 'object' }, render: renderJson },
            timeoutMs: 120_000,
            isConcurrencySafe: () => true,
            execute: async (args) => {
                const raw = (args ?? {});
                const limit = Math.min(200, Math.max(1, Math.round(numberArg(raw.limit) ?? 20)));
                try {
                    const result = await engine.history({ limit });
                    const snapshots = await engine.listSnapshots();
                    return lossless({ ok: true, ...result, snapshots: snapshots.slice(0, 20) });
                }
                catch (error) {
                    return errorResult(error);
                }
            },
        }),
    ];
}
/** Register every tool on the context; returns a disposer removing them. */
export function registerTools(options) {
    const tools = options.ctx.get('tools');
    if (tools === undefined || typeof tools.register !== 'function') {
        options.logger.warn('当前 DSH 环境未注册 Agent 工具服务 / agent tool service unavailable');
        return () => undefined;
    }
    const disposers = [];
    for (const definition of buildToolDefinitions(options.engine)) {
        try {
            disposers.push(tools.register(definition));
        }
        catch (error) {
            options.logger.error(`注册工具失败 / failed to register tool ${definition.name}: ${errorMessage(error)}`);
        }
    }
    options.logger.info(`已注册 ${disposers.length} 个 Agent 工具 / registered agent tools`);
    return () => {
        for (const disposer of disposers.splice(0)) {
            try {
                void disposer();
            }
            catch {
                // Owned by the plugin fiber anyway.
            }
        }
    };
}
