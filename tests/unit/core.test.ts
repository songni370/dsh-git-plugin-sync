/**
 * Unit tests for the dependency-free core utilities: path safety, secret
 * filtering, redaction, version ordering, JSON helpers and configuration
 * validation.
 */

import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  dataDirFor,
  expandHomePath,
  isSafeRelativePath,
  normalizeBackupDir,
  repoPath,
  safeFileName,
  safeJoin,
  displayPath,
} from '../../src/core/paths.js'
import {
  filterSensitiveConfig,
  isSensitiveKey,
  looksLikeSecretValue,
  redactGitUrl,
  redactJson,
  redactText,
} from '../../src/core/redact.js'
import { compareVersions, isNewerVersion, isValidVersion, versionRelation } from '../../src/core/version.js'
import { deepEqual, hashJson, isJsonValue, mergeJson, stableStringify } from '../../src/core/json.js'
import {
  ConfigStore,
  StateStore,
  defaultConfig,
  defaultState,
  isSafeBranchName,
  normalizeConfig,
  validateRepoUrl,
} from '../../src/state/store.js'
import { createDeviceInfo } from '../../src/state/store.js'
import { SyncError } from '../../src/core/errors.js'
import { createLogger, silentLogger } from '../../src/core/logger.js'

describe('path safety', () => {
  it('accepts ordinary relative paths', () => {
    expect(isSafeRelativePath('profiles/desktop/plugins.json')).toBe(true)
    expect(isSafeRelativePath('manifest.json')).toBe(true)
    expect(isSafeRelativePath('devices/dev-1/desktop.json')).toBe(true)
  })

  it('rejects absolute, traversal, drive-letter and URL paths', () => {
    for (const bad of [
      '',
      '/etc/passwd',
      '\\\\server\\share',
      'C:\\Windows\\system.ini',
      'C:/Windows/system.ini',
      '../secrets',
      'a/../../b',
      'a/./b',
      'a//b',
      'file:///etc/passwd',
      'https://example.com/x',
      'a\0b',
    ]) {
      expect(isSafeRelativePath(bad), bad).toBe(false)
    }
  })

  it('joins inside a root and refuses escapes', () => {
    expect(safeJoin('/data/work', 'profiles/desktop/plugins.json')).toBe('/data/work/profiles/desktop/plugins.json')
    expect(() => safeJoin('/data/work', '../escape')).toThrow()
    expect(() => safeJoin('/data/work', '/etc/passwd')).toThrow()
  })

  it('normalizes backup directories', () => {
    expect(normalizeBackupDir('')).toBe('')
    expect(normalizeBackupDir('.')).toBe('')
    expect(normalizeBackupDir('./')).toBe('')
    expect(normalizeBackupDir('backup/')).toBe('backup')
    expect(normalizeBackupDir('./a/b/')).toBe('a/b')
    expect(() => normalizeBackupDir('/abs')).toThrow()
    expect(() => normalizeBackupDir('../x')).toThrow()
  })

  it('builds repository paths and file names', () => {
    expect(repoPath('backup', 'profiles', 'desktop', 'plugins.json')).toBe('backup/profiles/desktop/plugins.json')
    expect(repoPath('', 'manifest.json')).toBe('manifest.json')
    expect(safeFileName('@scope/My Plugin')).toBe('scope_my_plugin')
    expect(safeFileName('')).toBe('plugin')
    expect(safeFileName('../../etc')).toBe('etc')
  })

  it('expands and displays home paths', () => {
    expect(expandHomePath('~').length).toBeGreaterThan(1)
    expect(expandHomePath('~/x').endsWith('/x')).toBe(true)
    expect(displayPath(join(process.env.HOME ?? '/home/u', 'x'))).toBe('~/x')
  })
})

describe('secret filtering', () => {
  it('recognizes credential-shaped keys', () => {
    for (const key of ['apiKey', 'API_KEY', 'token', 'access_token', 'password', 'client_secret', 'privateKey', 'authorization', 'cookie', 'ssh_key']) {
      expect(isSensitiveKey(key), key).toBe(true)
    }
    for (const key of ['timeout', 'model', 'enabled', 'baseUrl', 'username', 'name']) {
      expect(isSensitiveKey(key), key).toBe(false)
    }
  })

  it('recognizes secret-shaped values', () => {
    expect(looksLikeSecretValue('sk-abcdefghijklmnopqrstuvwxyz')).toBe(true)
    expect(looksLikeSecretValue('ghp_abcdefghijklmnopqrstuvwxyz')).toBe(true)
    expect(looksLikeSecretValue('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true)
    expect(looksLikeSecretValue('https://user:pass@example.com/repo.git')).toBe(true)
    expect(looksLikeSecretValue('hello world')).toBe(false)
    expect(looksLikeSecretValue('short')).toBe(false)
  })

  it('filters nested configuration and reports skipped keys', () => {
    const filtered = filterSensitiveConfig({
      timeout: 30,
      model: 'deepseek-flash',
      apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
      nested: { password: 'hunter2hunter2', port: 8080 },
      endpoints: [{ url: 'https://x.dev', token: 'ghp_abcdefghijklmnopqrstuvwxyz' }],
    })
    expect(filtered.values.timeout).toBe(30)
    expect(filtered.values.model).toBe('deepseek-flash')
    expect(filtered.skippedKeys).toContain('apiKey')
    expect(filtered.values.nested).toEqual({ port: 8080 })
    expect(JSON.stringify(filtered.values)).not.toContain('sk-')
    expect(JSON.stringify(filtered.values)).not.toContain('ghp_')
  })

  it('redacts secrets in text and URLs', () => {
    const text = 'failed with token=ghp_abcdefghijklmnopqrstuvwxyz and password: hunter2hunter2'
    const redacted = redactText(text)
    expect(redacted).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz')
    expect(redacted).not.toContain('hunter2hunter2')
    expect(redactGitUrl('https://user:secret@github.com/o/r.git')).toBe('https://***@github.com/o/r.git')
    expect(redactJson({ apiKey: 'value', nested: { timeout: 1 } })).toEqual({ apiKey: '[redacted]', nested: { timeout: 1 } })
  })
})

describe('version comparison', () => {
  it('orders semantic versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.2.4', '1.2.3')).toBe(1)
    expect(compareVersions('1.3.0', '1.2.9')).toBe(1)
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.2.3', '1.2.3-rc.1')).toBe(1)
    expect(compareVersions('1.2.3-rc.1', '1.2.3-rc.2')).toBe(-1)
    expect(compareVersions('git-sha', '1.0.0')).toBeNull()
    expect(isNewerVersion('1.2.4', '1.2.3')).toBe(true)
    expect(isNewerVersion('1.2.3', '1.2.4')).toBe(false)
    expect(isValidVersion('v1.2.3')).toBe(true)
    expect(isValidVersion('not-a-version')).toBe(false)
  })

  it('describes relations', () => {
    expect(versionRelation('1.0.0', '1.0.0')).toBe('same')
    expect(versionRelation('2.0.0', '1.0.0')).toBe('local-newer')
    expect(versionRelation('1.0.0', '2.0.0')).toBe('remote-newer')
    expect(versionRelation('abc', 'def')).toBe('different')
  })
})

describe('json helpers', () => {
  it('serializes stably regardless of key order', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
    expect(deepEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true)
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
    expect(hashJson({ a: 1 })).toBe(hashJson({ a: 1 }))
    expect(hashJson({ a: 1 })).not.toBe(hashJson({ a: 2 }))
  })

  it('validates JSON data', () => {
    expect(isJsonValue({ a: [1, 'x', null, true] })).toBe(true)
    expect(isJsonValue({ a: Number.NaN })).toBe(false)
    expect(isJsonValue({ a: new Date() })).toBe(false)
    expect(isJsonValue({ a: () => 1 })).toBe(false)
  })

  it('merges nested objects', () => {
    expect(mergeJson({ a: { x: 1, y: 2 }, z: 1 }, { a: { y: 3 }, z: 2 })).toEqual({ a: { x: 1, y: 3 }, z: 2 })
  })
})

describe('configuration validation', () => {
  const active = 'desktop'
  const profiles = ['desktop', 'web']

  it('starts with auto-sync disabled', () => {
    const config = defaultConfig()
    expect(config.autoSync.enabled).toBe(false)
    expect(config.repoUrl).toBe('')
    expect(config.includeConfigs).toBe(true)
    expect(config.includeLocalPlugins).toBe(false)
  })

  it('rejects credentials inside the repository URL', () => {
    expect(() => validateRepoUrl('https://user:token@github.com/o/r.git')).toThrow(SyncError)
    expect(validateRepoUrl('https://github.com/o/r.git')).toContain('github.com')
    expect(validateRepoUrl('git@github.com:o/r.git')).toBe('git@github.com:o/r.git')
    expect(validateRepoUrl('')).toBe('')
    expect(() => validateRepoUrl('--upload-pack=evil')).toThrow()
  })

  it('validates branch names', () => {
    expect(isSafeBranchName('main')).toBe(true)
    expect(isSafeBranchName('feature/x')).toBe(true)
    expect(isSafeBranchName('-x')).toBe(false)
    expect(isSafeBranchName('a..b')).toBe(false)
    expect(isSafeBranchName('a b')).toBe(false)
    expect(isSafeBranchName('x@{1}')).toBe(false)
  })

  it('normalizes a full configuration document', () => {
    const config = normalizeConfig(
      {
        repoUrl: 'https://github.com/example/backup.git',
        branch: 'main',
        authMode: 'https-token',
        tokenEnvVar: 'DSH_GIT_TOKEN',
        profiles: ['web', 'desktop', 'bogus'],
        includeConfigs: false,
        includeLocalPlugins: true,
        excludedPlugins: ['x', 'x', ' y '],
        autoSync: { enabled: true, mode: 'backup', intervalMinutes: 15, onStartup: true },
      },
      active,
      profiles,
    )
    expect(config.authMode).toBe('https-token')
    expect(config.profiles).toEqual(['desktop', 'web'])
    expect(config.includeConfigs).toBe(false)
    expect(config.excludedPlugins).toEqual(['x', 'y'])
    expect(config.autoSync).toMatchObject({
      enabled: true,
      mode: 'backup',
      intervalMinutes: 15,
      startupDelayMs: 15_000,
      onStartup: true,
    })
  })

  it('always keeps the active profile and clamps intervals', () => {
    const config = normalizeConfig({ profiles: ['web'], autoSync: { enabled: true, intervalMinutes: 999_999 } }, active, profiles)
    expect(config.profiles).toContain(active)
    expect(config.autoSync.intervalMinutes).toBe(7 * 24 * 60)
    const tooSmall = normalizeConfig({ autoSync: { enabled: true, intervalMinutes: 0.2 } }, active, profiles)
    expect(tooSmall.autoSync.intervalMinutes).toBe(0)
    const delay = normalizeConfig({ autoSync: { enabled: true, startupDelayMs: 999_999_999 } }, active, profiles)
    expect(delay.autoSync.startupDelayMs).toBe(10 * 60 * 1000)
    const negative = normalizeConfig({ autoSync: { enabled: true, startupDelayMs: -5 } }, active, profiles)
    expect(negative.autoSync.startupDelayMs).toBe(0)
  })

  it('ignores unknown fields and malformed auto-sync', () => {
    const config = normalizeConfig({ unknown: true, autoSync: 'nope', branch: 42 }, active, profiles)
    expect(config).toEqual({ ...defaultConfig(), profiles: [active] })
  })
})

describe('persistence', () => {
  it('writes configuration with owner-only permissions and reads it back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-git-test-'))
    try {
      const path = join(dir, 'config.json')
      const store = new ConfigStore(path, input => normalizeConfig(input, 'desktop', ['desktop']))
      const config = await store.read()
      expect(config.repoUrl).toBe('')
      await store.write({ ...config, repoUrl: 'https://github.com/a/b.git' })
      const mode = (await stat(path)).mode & 0o777
      if (process.platform !== 'win32') expect(mode).toBe(0o600)
      const text = await readFile(path, 'utf8')
      expect(text).toContain('github.com')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('recovers from a corrupt state file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-git-test-'))
    try {
      const device = createDeviceInfo({ existing: null, name: 'dev', dshVersion: '1', pluginVersion: '1' })
      const path = join(dir, 'state.json')
      const store = new StateStore(path, () => defaultState(device))
      const state = await store.read()
      expect(state.device.id).toBe(device.id)
      await store.write({ ...state, lastCommit: 'abc' })
      expect((await store.read()).lastCommit).toBe('abc')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('logger', () => {
  it('redacts secrets and keeps a bounded ring', () => {
    const logger = silentLogger()
    logger.info('token=ghp_abcdefghijklmnopqrstuvwxyz')
    const recent = logger.recent(10)
    expect(recent).toHaveLength(1)
    expect(recent[0]?.message).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz')
  })

  it('writes JSONL and flushes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-git-test-'))
    try {
      const path = join(dir, 'logs', 'sync.log')
      const logger = createLogger({ filePath: path })
      logger.info('hello', { token: 'should-be-redacted' })
      await logger.flush()
      const text = await readFile(path, 'utf8')
      const line = JSON.parse(text.trim().split('\n')[0] ?? '{}') as { message?: string; details?: { token?: string } }
      expect(line.message).toBe('hello')
      expect(line.details?.token).toBe('[redacted]')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
