/**
 * Host entry of **DSH 插件 Git 同步 / DSH Plugin Git Sync**.
 *
 * Wires the platform pieces together and keeps itself inert when an optional
 * Host service is missing: the plugin never throws during profile boot, because
 * a thrown plugin load can take the whole DSH profile down.
 *
 * No runtime dependency on any `@deepseek-ai/*` package is used: services are
 * reached through `ctx.get()` / `ctx.inject()` and the browser half through the
 * Harness module table. This keeps the published plugin installable on a
 * Harness whose internals moved.
 * @module index
 */
import { APP_DIR_NAME } from './constants.js';
import { createEngine } from './services/engine.js';
import type { DshContext } from './dsh.js';
/** Cordis plugin name; equals the bundle row id and the npm package name. */
export declare const name = "dsh-git-plugin-sync";
/** No hard service dependency: every service is feature-detected. */
export declare const inject: string[];
/** Plugin entry point. */
export declare function apply(ctx: DshContext): void;
/** Re-exported for tests and for a future service surface. */
export { apply as start, inject as services, name as pluginName, createEngine };
export { APP_DIR_NAME };
