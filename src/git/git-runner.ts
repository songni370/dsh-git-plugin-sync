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

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { DEFAULT_GIT_TIMEOUT_MS } from '../constants.js'
import { SyncError, type SyncErrorCode } from '../core/errors.js'
import { redactText } from '../core/redact.js'
import type { GitRunner, GitRunResult, JsonValue, SyncLogger } from '../types.js'

/** Largest amount of stdout/stderr retained for one command (per stream). */
export const MAX_CAPTURED_OUTPUT_BYTES = 1024 * 1024

/** Exit code reported when the command was killed after its timeout. */
export const GIT_TIMEOUT_EXIT_CODE = 124

/**
 * POSIX `sh` snippet registered as `credential.helper`.
 *
 * Git runs it for `get`/`store`/`erase`; the values are read from the
 * environment at that moment, so the token is never part of `argv` or of any
 * Git configuration file on disk. The `f() { ... }; f` wrapper is the documented
 * form for a helper that lives in configuration rather than on `PATH`.
 */
export const TOKEN_CREDENTIAL_HELPER =
  `!f() { printf '%s\\n' "username=$DSH_GIT_SYNC_USER" "password=$DSH_GIT_SYNC_TOKEN"; }; f`

/** Authentication material for HTTPS repositories. */
export interface GitTokenCredentials {
  username: string
  token: string
}

/** Options accepted by {@link createGitRunner}. */
export interface GitRunnerOptions {
  /** Redacting logger used for command diagnostics. */
  logger: SyncLogger
  /**
   * Supplies HTTPS credentials. Called before every command; return `null` for
   * credential-helper/SSH modes, where Git must be left alone.
   */
  tokenProvider?: () => Promise<GitTokenCredentials | null>
  /** Base environment; merged over `process.env`. */
  baseEnv?: NodeJS.ProcessEnv
  /** Git executable (defaults to `git`). */
  gitPath?: string
  /** Per-command timeout in milliseconds (defaults to {@link DEFAULT_GIT_TIMEOUT_MS}). */
  timeoutMs?: number
  /** Injection point for tests; defaults to `node:child_process.spawn`. */
  spawnImpl?: typeof spawn
  /** Override the capture cap (tests). */
  maxOutputBytes?: number
}

/** Per-command options accepted by {@link GitRunner.run}. */
interface GitRunOptions {
  cwd?: string
  env?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
}

/** Option prefixes that let a caller redirect Git at an arbitrary program. */
const FORBIDDEN_OPTION_PREFIXES = ['--upload-pack', '--receive-pack', '--exec-path', '--config-env', '--git-dir', '--work-tree']

/** Errors that mean "Git wants credentials and could not get them". */
const AUTH_FAILURE_PATTERNS: readonly RegExp[] = [
  /authentication failed/i,
  /could not read (?:username|password)/i,
  /permission denied \(publickey\)/i,
  /terminal prompts disabled/i,
  /invalid username or password/i,
  /support for password authentication was removed/i,
  /host key verification failed/i,
  /returned error: (?:401|403)/i,
  /\b401 unauthorized\b/i,
  /\b403 forbidden\b/i,
]

/** Errors caused by the network rather than by the repository contents. */
const NETWORK_FAILURE_PATTERNS: readonly RegExp[] = [
  /could not resolve host/i,
  /could not resolve proxy/i,
  /connection timed out/i,
  /connection refused/i,
  /connection reset/i,
  /operation timed out/i,
  /network is unreachable/i,
  /no route to host/i,
  /unable to access/i,
  /ssl certificate problem/i,
  /ssl error/i,
  /tls handshake/i,
  /rpc failed/i,
  /remote end hung up/i,
  /early eof/i,
  /unexpected disconnect while reading sideband packet/i,
]

/** A logger method may throw; a diagnostic must never break a Git command. */
function safeLog(logger: SyncLogger, message: string, details: JsonValue): void {
  try {
    logger.debug(redactText(message), details)
  } catch {
    // Diagnostics are best effort.
  }
}

/**
 * Reject argument vectors that could execute something other than the fixed Git
 * subcommand the caller intends.
 *
 * Callers inside this plugin always pass fixed argument lists; this validation
 * is defence in depth against a future caller forwarding user input.
 * @throws {SyncError} code `git-failed`.
 */
export function validateGitArgs(args: readonly string[]): void {
  if (!Array.isArray(args) || args.length === 0) {
    throw new SyncError('git-failed', 'Git 参数必须是非空数组 / git arguments must be a non-empty array')
  }
  for (const arg of args) {
    if (typeof arg !== 'string') {
      throw new SyncError('git-failed', 'Git 参数必须是字符串 / every git argument must be a string')
    }
    if (arg.includes('\0')) {
      throw new SyncError('git-failed', 'Git 参数包含 NUL 字节 / git argument contains a NUL byte')
    }
    if (arg === '') {
      throw new SyncError('git-failed', 'Git 参数不能为空 / git argument must not be empty')
    }
  }
  const subcommand = args[0] ?? ''
  if (subcommand.startsWith('-') && subcommand !== '--version') {
    throw new SyncError(
      'git-failed',
      `拒绝以选项开头的 Git 子命令 / refusing a git command that starts with an option: ${subcommand}`,
    )
  }
  for (const arg of args) {
    for (const prefix of FORBIDDEN_OPTION_PREFIXES) {
      if (arg === prefix || arg.startsWith(`${prefix}=`) || arg.startsWith(`${prefix} `)) {
        throw new SyncError(
          'git-failed',
          `拒绝危险的 Git 选项 / refusing dangerous git option: ${prefix}`,
        )
      }
    }
    // `-c name=value` / `-cname=value` lets the caller override configuration
    // (including core.sshCommand / core.hooksPath); this plugin uses the
    // GIT_CONFIG_* env interface instead.
    if (/^-c(?:=|$)/.test(arg) || (arg.startsWith('-c') && arg.length > 2 && !arg.startsWith('--'))) {
      throw new SyncError('git-failed', '拒绝 Git 的 -c 选项，请使用环境配置 / refusing git -c; use environment based configuration')
    }
  }
}

/** Render unknown captured stderr as a short, redacted, single-line detail. */
function summarizeGitFailure(stderr: string): string {
  const safe = redactText(stderr)
  const lines = safe
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('hint:'))
  const preferred =
    lines.find(line => /^(?:fatal|error):/i.test(line)) ??
    lines.find(line => /^(?:remote:)/i.test(line)) ??
    lines[0] ??
    ''
  const cleaned = preferred.replace(/^(?:fatal|error|remote):\s*/i, '').trim()
  return cleaned.length > 400 ? `${cleaned.slice(0, 400)}…` : cleaned
}

/** Append a detail clause only when a detail exists. */
function withDetail(message: string, detail: string): string {
  return detail === '' ? message : `${message}: ${detail}`
}

/**
 * Map captured Git stderr to a typed {@link SyncError}.
 *
 * This is the single classification table used by the store: authentication
 * problems are not retryable, network problems and timeouts are retryable, and
 * everything else is a plain `git-failed` (for example a missing repository).
 */
export function classifyGitFailure(stderr: string, timedOut: boolean): SyncError {
  const safe = typeof stderr === 'string' ? redactText(stderr) : ''
  const detail = summarizeGitFailure(safe)
  const details = detail === '' ? undefined : { detail }
  if (timedOut) {
    return new SyncError('git-network', withDetail('Git 操作超时 / git operation timed out', detail), {
      retryable: true,
      details,
    })
  }
  if (AUTH_FAILURE_PATTERNS.some(pattern => pattern.test(safe))) {
    return new SyncError('git-auth-failed', withDetail('Git 认证失败 / git authentication failed', detail), {
      details,
    })
  }
  if (NETWORK_FAILURE_PATTERNS.some(pattern => pattern.test(safe))) {
    return new SyncError('git-network', withDetail('Git 网络错误 / git network error', detail), {
      retryable: true,
      details,
    })
  }
  return new SyncError('git-failed', withDetail('Git 命令失败 / git command failed', detail), { details })
}

/** One captured output stream with a hard byte cap. */
interface Capture {
  chunks: Buffer[]
  bytes: number
  truncated: boolean
}

/** Add a chunk while enforcing the capture cap. */
function captureChunk(capture: Capture, chunk: Buffer, limit: number): void {
  if (capture.bytes >= limit) {
    capture.truncated = true
    return
  }
  const room = limit - capture.bytes
  if (chunk.length > room) {
    capture.chunks.push(chunk.subarray(0, room))
    capture.bytes = limit
    capture.truncated = true
  } else {
    capture.chunks.push(chunk)
    capture.bytes += chunk.length
  }
}

/** Materialize a capture as UTF-8 text, marking truncation. */
function captureText(capture: Capture): string {
  const text = Buffer.concat(capture.chunks).toString('utf8')
  return capture.truncated ? `${text}\n[output truncated]` : text
}

/**
 * Create the process-wide Git runner.
 *
 * @param options - logger, optional token provider, and test injection points.
 */
export function createGitRunner(options: GitRunnerOptions): GitRunner {
  const logger = options.logger
  const gitPath = options.gitPath === undefined || options.gitPath === '' ? 'git' : options.gitPath
  const spawnProcess: typeof spawn = options.spawnImpl ?? spawn
  const defaultTimeoutMs =
    options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? Math.floor(options.timeoutMs)
      : DEFAULT_GIT_TIMEOUT_MS
  const captureLimit =
    options.maxOutputBytes !== undefined && Number.isFinite(options.maxOutputBytes) && options.maxOutputBytes > 0
      ? Math.floor(options.maxOutputBytes)
      : MAX_CAPTURED_OUTPUT_BYTES

  /** Build the environment for one command, including HTTPS credentials. */
  const buildEnvironment = async (extraEnv?: Record<string, string>): Promise<NodeJS.ProcessEnv> => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...options.baseEnv, ...extraEnv }
    // Never prompt, and make Git diagnostics parseable.
    env.GIT_TERMINAL_PROMPT = '0'
    env.GIT_OPTIONAL_LOCKS = '0'
    env.LC_ALL = 'C'
    env.LANG = 'C'
    // Git Credential Manager must not open a UI either.
    env.GCM_INTERACTIVE = 'never'
    env.GIT_EDITOR = 'true'
    const provider = options.tokenProvider
    if (provider === undefined) return env
    let credentials: GitTokenCredentials | null
    try {
      credentials = await provider()
    } catch (error) {
      if (error instanceof SyncError) throw error
      throw new SyncError(
        'git-auth-failed',
        '无法读取 Git 访问令牌 / failed to read the git access token',
        { cause: error },
      )
    }
    if (credentials === null || credentials.token === '') return env
    const parsedCount = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10)
    const index = Number.isInteger(parsedCount) && parsedCount >= 0 ? parsedCount : 0
    env.GIT_CONFIG_COUNT = String(index + 1)
    env[`GIT_CONFIG_KEY_${index}`] = 'credential.helper'
    env[`GIT_CONFIG_VALUE_${index}`] = TOKEN_CREDENTIAL_HELPER
    env.DSH_GIT_SYNC_USER = credentials.username
    env.DSH_GIT_SYNC_TOKEN = credentials.token
    return env
  }

  const run = async (args: string[], runOptions: GitRunOptions = {}): Promise<GitRunResult> => {
    validateGitArgs(args)
    const signal = runOptions.signal
    if (signal?.aborted === true) {
      throw new SyncError('cancelled', 'Git 操作已取消 / git operation cancelled')
    }
    const env = await buildEnvironment(runOptions.env)
    const timeoutMs =
      runOptions.timeoutMs !== undefined && Number.isFinite(runOptions.timeoutMs) && runOptions.timeoutMs > 0
        ? Math.floor(runOptions.timeoutMs)
        : defaultTimeoutMs
    const spawnOptions = {
      cwd: runOptions.cwd,
      env,
      windowsHide: true,
    }
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawnProcess(gitPath, args, spawnOptions)
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code
      if (errno === 'ENOENT') {
        throw new SyncError('git-not-found', `找不到 Git 可执行文件 / git executable not found: ${gitPath}`, {
          cause: error,
        })
      }
      throw new SyncError('git-failed', redactText(`无法启动 Git / failed to start git: ${String(error)}`), {
        cause: error,
      })
    }
    const stdoutCapture: Capture = { chunks: [], bytes: 0, truncated: false }
    const stderrCapture: Capture = { chunks: [], bytes: 0, truncated: false }
    return await new Promise<GitRunResult>((resolve, reject) => {
      let settled = false
      let timedOut = false
      let aborted = false
      let timer: NodeJS.Timeout | undefined
      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const finish = (code: number | null): void => {
        if (settled) return
        settled = true
        cleanup()
        if (aborted) {
          reject(new SyncError('cancelled', 'Git 操作已取消 / git operation cancelled'))
          return
        }
        const stdout = redactText(captureText(stdoutCapture))
        const stderr = redactText(captureText(stderrCapture))
        const effectiveCode = timedOut ? GIT_TIMEOUT_EXIT_CODE : code === null ? 1 : code
        safeLog(logger, `git ${args.join(' ')}`, {
          code: effectiveCode,
          timedOut,
          stdoutBytes: stdoutCapture.bytes,
          stderrBytes: stderrCapture.bytes,
        })
        resolve({ code: effectiveCode, stdout, stderr, timedOut })
      }
      const onAbort = (): void => {
        aborted = true
        try {
          child.kill('SIGKILL')
        } catch {
          // The child may already be gone.
        }
      }
      if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true })
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true
          try {
            child.kill('SIGKILL')
          } catch {
            // The child may already be gone.
          }
        }, timeoutMs)
        timer.unref?.()
      }
      child.stdout?.on('data', (chunk: Buffer | string) => {
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
        captureChunk(stdoutCapture, buffer, captureLimit)
      })
      child.stderr?.on('data', (chunk: Buffer | string) => {
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
        captureChunk(stderrCapture, buffer, captureLimit)
      })
      child.on('error', (error: Error) => {
        const errno = (error as NodeJS.ErrnoException).code
        if (errno === 'ENOENT') {
          fail(
            new SyncError('git-not-found', `找不到 Git 可执行文件 / git executable not found: ${gitPath}`, {
              cause: error,
            }),
          )
          return
        }
        fail(
          new SyncError('git-failed', redactText(`Git 进程错误 / git process error: ${error.message}`), {
            cause: error,
          }),
        )
      })
      child.on('close', (code: number | null) => {
        finish(code)
      })
    })
  }

  return { run }
}

/** Human-readable relation between a failed result's stream and an error code. */
export function gitFailureCode(result: Pick<GitRunResult, 'stderr' | 'stdout' | 'timedOut'>): SyncErrorCode {
  return classifyGitFailure(result.stderr.length > 0 ? result.stderr : result.stdout, result.timedOut).code
}
