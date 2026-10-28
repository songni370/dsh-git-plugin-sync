import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { silentLogger } from '../../src/core/logger.js'
import { SyncError } from '../../src/core/errors.js'
import {
  GIT_TIMEOUT_EXIT_CODE,
  TOKEN_CREDENTIAL_HELPER,
  classifyGitFailure,
  createGitRunner,
  validateGitArgs,
} from '../../src/git/git-runner.js'
import type { GitRunner } from '../../src/types.js'

/** One recorded spawn invocation. */
interface RecordedCall {
  command: string
  args: string[]
  options: { cwd?: string; env: NodeJS.ProcessEnv }
}

/** Minimal fake child process used by the injected spawn implementation. */
class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  killed = false
  killedWith: NodeJS.Signals | undefined
  onKill: (() => void) | undefined

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true
    this.killedWith = signal
    this.onKill?.()
    return true
  }

  data(stdout: string, stderr = ''): void {
    if (stdout !== '') this.stdout.emit('data', Buffer.from(stdout, 'utf8'))
    if (stderr !== '') this.stderr.emit('data', Buffer.from(stderr, 'utf8'))
  }

  close(code: number | null): void {
    this.emit('close', code)
  }

  fail(error: NodeJS.ErrnoException): void {
    this.emit('error', error)
  }
}

/** Create an injectable spawn that records calls and scripts fake children. */
function fakeSpawn(script: (child: FakeChild, call: RecordedCall) => void): {
  spawnImpl: typeof spawn
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const spawnImpl = (command: string, args: readonly string[], options: { cwd?: string; env: NodeJS.ProcessEnv }): ChildProcess => {
    const call: RecordedCall = { command, args: [...args], options }
    calls.push(call)
    const child = new FakeChild()
    setImmediate(() => script(child, call))
    return child as unknown as ChildProcess
  }
  return { spawnImpl: spawnImpl as unknown as typeof spawn, calls }
}

/** A runner whose fake child finishes immediately with the given output. */
function immediateRunner(behavior: { stdout?: string; stderr?: string; code?: number }): {
  runner: GitRunner
  calls: RecordedCall[]
} {
  const { spawnImpl, calls } = fakeSpawn(child => {
    child.data(behavior.stdout ?? '', behavior.stderr ?? '')
    child.close(behavior.code ?? 0)
  })
  const runner = createGitRunner({ logger: silentLogger(), spawnImpl })
  return { runner, calls }
}

/** The token used across the secret-leak tests. */
const SECRET_TOKEN = `ghp_${'A'.repeat(36)}`

describe('classifyGitFailure', () => {
  it('classifies authentication failures', () => {
    const cases = [
      'fatal: Authentication failed for \'https://github.com/owner/repo.git/\'',
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      'git@github.com: Permission denied (publickey).',
      'fatal: unable to access \'https://example.com/repo\': The requested URL returned error: 403',
    ]
    for (const stderr of cases) {
      const error = classifyGitFailure(stderr, false)
      expect(error).toBeInstanceOf(SyncError)
      expect(error.code).toBe('git-auth-failed')
      expect(error.retryable).toBe(false)
    }
  })

  it('classifies network failures as retryable', () => {
    const cases = [
      "fatal: unable to access 'https://example.invalid/repo.git/': Could not resolve host: example.invalid",
      "fatal: unable to access 'https://example.com/repo.git/': Connection timed out",
      'fatal: unable to access \'https://example.com/repo\': SSL certificate problem: unable to get local issuer certificate',
      'error: RPC failed; curl 56 Recv failure: Connection reset by peer',
    ]
    for (const stderr of cases) {
      const error = classifyGitFailure(stderr, false)
      expect(error.code).toBe('git-network')
      expect(error.retryable).toBe(true)
    }
  })

  it('classifies timeouts as retryable network errors', () => {
    const error = classifyGitFailure('', true)
    expect(error.code).toBe('git-network')
    expect(error.retryable).toBe(true)
    expect(error.message).toMatch(/超时|timed out/)
  })

  it('classifies everything else as a plain git failure', () => {
    for (const stderr of [
      'fatal: not a git repository (or any of the parent directories): .git',
      "fatal: repository '/tmp/missing.git' does not exist",
      'fatal: pathspec did not match any files',
    ]) {
      const error = classifyGitFailure(stderr, false)
      expect(error.code).toBe('git-failed')
      expect(error.retryable).toBe(false)
    }
  })

  it('never returns a token in the message or details', () => {
    const error = classifyGitFailure(`fatal: Authentication failed for ${SECRET_TOKEN}`, false)
    expect(error.message).not.toContain(SECRET_TOKEN)
    expect(JSON.stringify(error.details)).not.toContain(SECRET_TOKEN)
  })
})

describe('validateGitArgs', () => {
  it('accepts the fixed argument vectors this plugin uses', () => {
    expect(() =>
      validateGitArgs(['push', 'origin', 'HEAD:refs/heads/main']),
    ).not.toThrow()
    expect(() => validateGitArgs(['clone', '--no-checkout', '--origin', 'origin', '/tmp/r.git', '/tmp/w'])).not.toThrow()
    expect(() => validateGitArgs(['--version'])).not.toThrow()
  })

  it('refuses NUL bytes and empty arguments', () => {
    expect(() => validateGitArgs(['status', 'a\0b'])).toThrow(SyncError)
    expect(() => validateGitArgs(['status', ''])).toThrow(SyncError)
    expect(() => validateGitArgs([])).toThrow(SyncError)
  })

  it('refuses program-redirecting options', () => {
    for (const args of [
      ['clone', '--upload-pack=/bin/sh', 'x'],
      ['push', '--receive-pack=/bin/sh'],
      ['-c', 'core.sshCommand=/bin/sh', 'status'],
      ['--git-dir=/tmp/evil', 'status'],
      ['-cimplicit=1', 'status'],
    ]) {
      expect(() => validateGitArgs(args)).toThrow(SyncError)
    }
  })

  it('refuses a subcommand that starts with an option other than --version', () => {
    expect(() => validateGitArgs(['--exec-path=/bin/sh'])).toThrow(SyncError)
  })
})

describe('createGitRunner (real git)', () => {
  it('runs the real git executable and captures stdout', async () => {
    const runner = createGitRunner({ logger: silentLogger() })
    const result = await runner.run(['--version'])
    expect(result.code).toBe(0)
    expect(result.timedOut).toBe(false)
    expect(result.stdout).toMatch(/git version/i)
  })

  it('returns the exit code instead of throwing for expected failures', async () => {
    const runner = createGitRunner({ logger: silentLogger() })
    const result = await runner.run(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: tmpdir() })
    expect(result.code).not.toBe(0)
    expect(result.stderr.length + result.stdout.length).toBeGreaterThanOrEqual(0)
  })

  it('runs with shell:false — shell metacharacters are inert', async () => {
    const runner = createGitRunner({ logger: silentLogger() })
    const result = await runner.run(['rev-parse', '--verify', '--quiet', 'HEAD; echo pwned'], { cwd: tmpdir() })
    // The argument is passed to git literally (an invalid revision), not to a shell.
    expect(result.code).not.toBe(0)
    expect(result.stdout).not.toMatch(/pwned/)
    expect(result.stderr).not.toMatch(/pwned/)
    expect(result.stdout).toBe('')
  })
})

describe('createGitRunner (injected spawn)', () => {
  it('passes a safe base environment and the fixed subcommand', async () => {
    const { runner, calls } = immediateRunner({ stdout: 'ok' })
    const result = await runner.run(['status', '--porcelain', '-z'], {
      cwd: '/tmp/work',
      env: { GIT_AUTHOR_NAME: 'Tester' },
    })
    expect(result).toEqual({ code: 0, stdout: 'ok', stderr: '', timedOut: false })
    const call = calls[0]
    expect(call).toBeDefined()
    expect(call?.command).toBe('git')
    expect(call?.args).toEqual(['status', '--porcelain', '-z'])
    expect(call?.options.cwd).toBe('/tmp/work')
    const env = call?.options.env ?? {}
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env.GIT_OPTIONAL_LOCKS).toBe('0')
    expect(env.LC_ALL).toBe('C')
    expect(env.GIT_AUTHOR_NAME).toBe('Tester')
  })

  it('passes an HTTPS token only through the environment, never argv', async () => {
    const { spawnImpl, calls } = fakeSpawn(child => {
      child.data('')
      child.close(0)
    })
    const runner = createGitRunner({
      logger: silentLogger(),
      tokenProvider: async () => ({ username: 'oauth2', token: SECRET_TOKEN }),
      spawnImpl,
    })
    await runner.run(['push', 'origin', 'HEAD:refs/heads/main'])
    const call = calls[0]
    expect(call).toBeDefined()
    expect(call?.args.join(' ')).not.toContain(SECRET_TOKEN)
    expect(call?.options.env.DSH_GIT_SYNC_TOKEN).toBe(SECRET_TOKEN)
    expect(call?.options.env.DSH_GIT_SYNC_USER).toBe('oauth2')
    expect(call?.options.env.GIT_CONFIG_COUNT).toBe('1')
    expect(call?.options.env.GIT_CONFIG_KEY_0).toBe('credential.helper')
    expect(call?.options.env.GIT_CONFIG_VALUE_0).toBe(TOKEN_CREDENTIAL_HELPER)
    expect(call?.options.env.GIT_CONFIG_VALUE_0).not.toContain(SECRET_TOKEN)
    expect(call?.options.env.GIT_CONFIG_VALUE_0).toContain('$DSH_GIT_SYNC_USER')
    expect(call?.options.env.GIT_CONFIG_VALUE_0).toContain('$DSH_GIT_SYNC_TOKEN')
  })

  it('does not touch the environment for credential-helper/SSH modes', async () => {
    const { runner, calls } = immediateRunner({ code: 0 })
    await runner.run(['fetch', 'origin'])
    const env = calls[0]?.options.env ?? {}
    expect(env.DSH_GIT_SYNC_TOKEN).toBeUndefined()
    expect(env.GIT_CONFIG_COUNT).toBeUndefined()
  })

  it('preserves pre-existing GIT_CONFIG_* entries when adding the helper', async () => {
    const { spawnImpl, calls } = fakeSpawn(child => {
      child.close(0)
    })
    const runner = createGitRunner({
      logger: silentLogger(),
      baseEnv: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'pre-existing' },
      tokenProvider: async () => ({ username: 'u', token: 'tok' }),
      spawnImpl,
    })
    await runner.run(['fetch', 'origin'])
    const env = calls[0]?.options.env ?? {}
    expect(env.GIT_CONFIG_COUNT).toBe('2')
    expect(env.GIT_CONFIG_KEY_0).toBe('user.name')
    expect(env.GIT_CONFIG_KEY_1).toBe('credential.helper')
    expect(env.DSH_GIT_SYNC_TOKEN).toBe('tok')
  })

  it('maps a missing git executable to git-not-found', async () => {
    const { spawnImpl } = fakeSpawn(child => {
      child.fail(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }))
    })
    const runner = createGitRunner({ logger: silentLogger(), spawnImpl })
    await expect(runner.run(['--version'])).rejects.toMatchObject({ code: 'git-not-found' })
  })

  it('kills a command that exceeds its timeout', async () => {
    const { spawnImpl } = fakeSpawn(child => {
      child.onKill = () => {
        setImmediate(() => child.close(null))
      }
    })
    const runner = createGitRunner({ logger: silentLogger(), timeoutMs: 50, spawnImpl })
    const result = await runner.run(['fetch', 'origin'])
    expect(result.timedOut).toBe(true)
    expect(result.code).toBe(GIT_TIMEOUT_EXIT_CODE)
  })

  it('kills a command when its AbortSignal is aborted', async () => {
    const { spawnImpl } = fakeSpawn(child => {
      child.onKill = () => {
        setImmediate(() => child.close(null))
      }
    })
    const runner = createGitRunner({ logger: silentLogger(), spawnImpl })
    const controller = new AbortController()
    const pending = runner.run(['fetch', 'origin'], { signal: controller.signal })
    setTimeout(() => controller.abort(), 10)
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const { runner } = immediateRunner({})
    const controller = new AbortController()
    controller.abort()
    await expect(runner.run(['fetch'], { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('caps captured output', async () => {
    const { spawnImpl } = fakeSpawn(child => {
      child.data('x'.repeat(10_000), 'y'.repeat(10_000))
      child.close(0)
    })
    const runner = createGitRunner({ logger: silentLogger(), spawnImpl, maxOutputBytes: 64 })
    const result = await runner.run(['status'])
    expect(result.stdout.startsWith('x'.repeat(64))).toBe(true)
    expect(result.stdout).toContain('[output truncated]')
    expect(result.stdout.length).toBeLessThan(200)
    expect(result.stderr.startsWith('y'.repeat(64))).toBe(true)
    expect(result.stderr).toContain('[output truncated]')
  })

  it('redacts secret-looking output before returning it', async () => {
    const { runner } = immediateRunner({
      stdout: `token is ${SECRET_TOKEN}`,
      stderr: 'password=hunter2secret',
    })
    const result = await runner.run(['status'])
    expect(result.stdout).not.toContain(SECRET_TOKEN)
    expect(result.stdout).toContain('[redacted:github-token]')
    expect(result.stderr).not.toContain('hunter2secret')
    expect(result.stderr).toContain('[redacted]')
  })

  it('turns a failing token provider into git-auth-failed', async () => {
    const runner = createGitRunner({
      logger: silentLogger(),
      tokenProvider: async () => {
        throw new Error('DSH_GIT_TOKEN is not set')
      },
    })
    await expect(runner.run(['fetch', 'origin'])).rejects.toMatchObject({ code: 'git-auth-failed' })
  })
})
