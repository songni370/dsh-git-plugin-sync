/**
 * Wire contract between the Host half and the Web settings page.
 *
 * The browser fetches `api/dsh-git-plugin-sync/<name>` (same origin, through the
 * Host connection's authenticated shared channel), POSTs JSON, and receives
 * `{ ok: true, value }` or `{ ok: false, error }`. Types here are shared with the
 * client sources by `import type` only, so nothing in this file reaches the
 * browser bundle.
 * @module http/api-types
 */
/** Route prefix shared by every endpoint. */
export const API_PREFIX = '/api/dsh-git-plugin-sync';
