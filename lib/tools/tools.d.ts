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
import type { DshContext, DshDisposer } from '../dsh.js';
import type { SyncEngine } from '../services/engine.js';
import type { SyncLogger } from '../types.js';
/** Minimal content block shape the tool registry accepts. */
interface TextContent {
    type: 'text';
    text: string;
}
/** The structural tool definition `ctx.tools.register` accepts. */
interface ToolDefinitionLike {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    output: {
        schema: Record<string, unknown>;
        render: (args: unknown, value: unknown) => TextContent[];
    };
    timeoutMs?: number;
    execute: (args: unknown, exec: {
        signal?: AbortSignal;
    }) => Promise<unknown>;
    isConcurrencySafe?: (args: unknown) => boolean;
}
/** Build the six tools. */
export declare function buildToolDefinitions(engine: SyncEngine): ToolDefinitionLike[];
/** Register every tool on the context; returns a disposer removing them. */
export declare function registerTools(options: {
    ctx: DshContext;
    engine: SyncEngine;
    logger: SyncLogger;
}): DshDisposer;
export {};
