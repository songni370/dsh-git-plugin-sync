/**
 * Safe Git command runner.
 *
 * Every Git invocation in this plugin goes through this module. It exists to
 * make three classes of mistake impossible:
 *
 * 1. **Shell injection** — commands are always an argument *array* handed to
 *    `spawn` with `shell: false`, never a concatenated command string. A small
 *    deny-list additionally refuses NUL bytes and the options that let a caller
 *    point Git at an arbitrary program (`-c`, `--upload-pack`, ...).
 * 2. **Secret leakage** — an HTTPS token is passed only through environment
 *    variables referenced by a throwaway credential helper registered with
 *    `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_*`/`GIT_CONFIG_VALUE_*`, so it never
 *    appears in `argv` (and therefore never in `ps`). All captured output is
 *    redacted with {@link redactText} before it is returned or logged.
 * 3. **Hanging** — interactive prompts are disabled (`GIT_TERMINAL_PROMPT=0`),
 *    a timeout kills the child, and captured output is capped so a runaway
 *    command cannot exhaust memory.
 *
 * The runner returns the exit code instead of throwing; callers decide which
 * failures are expected (an empty remote makes `git fetch` fail, for example)
 * and use {@link classifyGitFailure} to turn the others into typed errors.
 * @module git/git-runner
 */
import { spawn } from 'node:child_process';
import { SyncError, type SyncErrorCode } from '../core/errors.js';
import type { GitRunner, GitRunResult, SyncLogger } from '../types.js';
/** Largest amount of stdout/stderr retained for one command (per stream). */
export declare const MAX_CAPTURED_OUTPUT_BYTES: number;
/** Exit code reported when the command was killed after its timeout. */
export declare const GIT_TIMEOUT_EXIT_CODE = 124;
/**
 * POSIX `sh` snippet registered as `credential.helper`.
 *
 * Git runs it for `get`/`store`/`erase`; the values are read from the
 * environment at that moment, so the token is never part of `argv` or of any
 * Git configuration file on disk. The `f() { ... }; f` wrapper is the documented
 * form for a helper that lives in configuration rather than on `PATH`.
 */
export declare const TOKEN_CREDENTIAL_HELPER = "!f() { printf '%s\\n' \"username=$DSH_GIT_SYNC_USER\" \"password=$DSH_GIT_SYNC_TOKEN\"; }; f";
/** Authentication material for HTTPS repositories. */
export interface GitTokenCredentials {
    username: string;
    token: string;
}
/** Options accepted by {@link createGitRunner}. */
export interface GitRunnerOptions {
    /** Redacting logger used for command diagnostics. */
    logger: SyncLogger;
    /**
     * Supplies HTTPS credentials. Called before every command; return `null` for
     * credential-helper/SSH modes, where Git must be left alone.
     */
    tokenProvider?: () => Promise<GitTokenCredentials | null>;
    /** Base environment; merged over `process.env`. */
    baseEnv?: NodeJS.ProcessEnv;
    /** Git executable (defaults to `git`). */
    gitPath?: string;
    /** Per-command timeout in milliseconds (defaults to {@link DEFAULT_GIT_TIMEOUT_MS}). */
    timeoutMs?: number;
    /** Injection point for tests; defaults to `node:child_process.spawn`. */
    spawnImpl?: typeof spawn;
    /** Override the capture cap (tests). */
    maxOutputBytes?: number;
}
/**
 * Reject argument vectors that could execute something other than the fixed Git
 * subcommand the caller intends.
 *
 * Callers inside this plugin always pass fixed argument lists; this validation
 * is defence in depth against a future caller forwarding user input.
 * @throws {SyncError} code `git-failed`.
 */
export declare function validateGitArgs(args: readonly string[]): void;
/**
 * Map captured Git stderr to a typed {@link SyncError}.
 *
 * This is the single classification table used by the store: authentication
 * problems are not retryable, network problems and timeouts are retryable, and
 * everything else is a plain `git-failed` (for example a missing repository).
 */
export declare function classifyGitFailure(stderr: string, timedOut: boolean): SyncError;
/**
 * Create the process-wide Git runner.
 *
 * @param options - logger, optional token provider, and test injection points.
 */
export declare function createGitRunner(options: GitRunnerOptions): GitRunner;
/** Human-readable relation between a failed result's stream and an error code. */
export declare function gitFailureCode(result: Pick<GitRunResult, 'stderr' | 'stdout' | 'timedOut'>): SyncErrorCode;
