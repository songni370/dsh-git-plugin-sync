/**
 * Host-side HTTP routes for the Web settings page.
 *
 * Routes are registered on the Host connection's authenticated shared channel
 * (`connection.fetch.register`), so they inherit the deployment's Host/Origin
 * fence and browser authentication instead of inventing a second gate. Every
 * route is POST + JSON; responses use one envelope, `{ ok, value }` or
 * `{ ok, error }`, which the client parses once.
 * @module http/routes
 */
import type { ApiError } from './api-types.js';
import type { DshContext, DshDisposer } from '../dsh.js';
import type { SyncEngine } from '../services/engine.js';
import type { SyncLogger } from '../types.js';
/** Register every route; returns a disposer removing all of them. */
export declare function registerHttpRoutes(options: {
    ctx: DshContext;
    engine: SyncEngine;
    logger: SyncLogger;
}): DshDisposer;
/** Exported for tests: map any throwable to the wire envelope. */
export declare function toErrorEnvelope(error: unknown): {
    ok: false;
    error: ApiError;
};
