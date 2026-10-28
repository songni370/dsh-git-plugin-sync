/**
 * Backup repository store: clone, read, write, commit and push.
 *
 * This is the only module that touches the Git work tree. It owns three
 * invariants the rest of the plugin relies on:
 *
 * - **The work tree is a cache.** `prepare()` clones it if needed and resets it
 *   to `origin/<branch>`, so a half-finished earlier run never leaks into a new
 *   backup. Reads always come from that refreshed work tree; `readAtCommit()`
 *   reads a historical revision through `git show` without touching it.
 * - **Writes are transactions.** Files are written atomically inside the backup
 *   directory, deletions are applied first, then a single commit with the
 *   plugin's trailers is created. Nothing is committed when the tree is already
 *   identical (`changed: false`), which keeps the history meaningful.
 * - **Pushes never force.** A non-fast-forward rejection is resolved by
 *   fetching, resetting, calling the caller's `rebuild` hook and retrying; after
 *   the retry budget it fails with a retryable `git-push-rejected` instead of
 *   overwriting another device's work.
 *
 * All paths are validated by `repo-paths`, which refuses parent traversal,
 * absolute paths, `.git`, and symlinked directories.
 * @module git/repo-store
 */
import type { CommitTrailers, GitAuthMode, GitRunner, HistoryEntry, RepoStore, SyncLogger } from '../types.js';
import { backupPaths } from './repo-paths.js';
export { backupPaths };
/** README written into a fresh backup repository. Contains no absolute paths. */
export declare const BACKUP_README = "# DSH \u63D2\u4EF6 Git \u540C\u6B65 \u2014 \u5907\u4EFD\u4ED3\u5E93 / DSH Plugin Git Sync \u2014 Backup Repository\n\n\u6B64\u4ED3\u5E93\u7531 DSH \u63D2\u4EF6\u300CDSH \u63D2\u4EF6 Git \u540C\u6B65\u300D\u81EA\u52A8\u7EF4\u62A4\uFF0C\u8BF7\u52FF\u624B\u5DE5\u4FEE\u6539\u3002\nThis repository is maintained automatically by the DSH \"DSH Plugin Git Sync\" plugin. Do not edit it by hand: local changes may be overwritten by the next synchronization.\n\n- `manifest.json` \u2014 \u5907\u4EFD\u7D22\u5F15 / index of the backup\n- `metadata/schema.json` \u2014 \u5E03\u5C40\u4E0E schema \u7248\u672C\u8BF4\u660E / layout and schema version\n- `profiles/<profile>/plugins.json` \u2014 \u5171\u4EAB\u63D2\u4EF6\u72B6\u6001 / shared plugin state per profile\n- `profiles/<profile>/configs/<plugin-id>.json` \u2014 \u975E\u654F\u611F\u914D\u7F6E / non-secret configuration\n- `devices/<deviceId>/<profile>.json` \u2014 \u8BBE\u5907\u5FEB\u7167 / device snapshot\n\n\u6062\u590D\u4E0E\u540C\u6B65\u8BF7\u4F7F\u7528\u63D2\u4EF6\u8BBE\u7F6E\u9875\u6216 Agent \u5DE5\u5177\u3002/ Use the plugin settings page or agent tools to restore or synchronize.\n";
/** Options accepted by {@link createRepoStore}. */
export interface RepoStoreOptions {
    /** Safe Git runner (see `createGitRunner`). */
    run: GitRunner;
    /** Absolute path of the local work tree (created on demand). */
    workDir: string;
    /** Repository URL from configuration (validated here as well). */
    repoUrl: string;
    /** Backup branch. */
    branch: string;
    /** Directory inside the repository that holds the backup (`''` = root). */
    backupDir: string;
    /** Redacting logger. */
    logger: SyncLogger;
    /** Optional authentication mode, used only for the connection-test label. */
    authMode?: GitAuthMode;
    /** Optional token env-var name, shown as the connection-test auth label. */
    tokenEnvVar?: string;
    /** Device whose snapshot `readAtCommit()` should prefer. */
    deviceId?: string;
    /** How many times a rejected push may be retried (default 3). */
    maxPushRetries?: number;
}
/**
 * Format the trailer paragraph of a backup commit.
 *
 * `CommitTrailers` keys are mapped to their documented trailer names
 * (`deviceId` → `Device-Id`, ...); one `Key: value` line is emitted per trailer
 * so `git interpret-trailers` and the history parser both read them.
 */
export declare function formatCommitTrailers(trailers: CommitTrailers): string;
/** Parse a commit body's trailer paragraph (tolerates a missing paragraph). */
export declare function parseCommitTrailers(body: string): Record<string, string>;
/** Parse `git log` output produced with the history format string. */
export declare function parseHistoryLog(stdout: string): HistoryEntry[];
/** Parse `git status --porcelain -z` output into repository-relative paths. */
export declare function parsePorcelainZ(stdout: string): string[];
/**
 * Create the backup repository store.
 *
 * Configuration is validated lazily: constructing a store never throws, so the
 * plugin can create it at startup and surface a `not-configured` error only when
 * an operation actually needs the repository.
 */
export declare function createRepoStore(options: RepoStoreOptions): RepoStore;
