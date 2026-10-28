import { execFileSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MANIFEST_SCHEMA_VERSION } from '../../src/constants.js'
import { SyncError } from '../../src/core/errors.js'
import { createGitRunner } from '../../src/git/git-runner.js'
import { silentLogger } from '../../src/core/logger.js'
import {
  BACKUP_README,
  backupPaths,
  createRepoStore,
  formatCommitTrailers,
  parseCommitTrailers,
} from '../../src/git/repo-store.js'
import {
  buildDeviceSnapshot,
  buildManifest,
  buildRemoteConfigEntry,
  buildRemotePluginEntry,
  buildRemoteProfileState,
  serializeJson,
  serializeManifest,
} from '../../src/manifest/manifest.js'
import { safeFileName } from '../../src/core/paths.js'
import type {
  CommitTrailers,
  DeviceInfo,
  GitRunner,
  JsonObject,
  PluginRecord,
} from '../../src/types.js'

/** Whether a real git executable is available; the suite skips otherwise. */
function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const HAS_GIT = gitAvailable()
const describeGit = HAS_GIT ? describe : describe.skip

const NOW = '2026-10-28T06:00:00.000Z'
const LATER = '2026-10-28T07:00:00.000Z'

const logger = silentLogger()
const runner = createGitRunner({ logger })

const IDENTITY_ENV = {
  GIT_AUTHOR_NAME: 'Test Device',
  GIT_AUTHOR_EMAIL: 'test@dsh.local',
  GIT_COMMITTER_NAME: 'Test Device',
  GIT_COMMITTER_EMAIL: 'test@dsh.local',
}

const DEVICE: DeviceInfo = {
  id: 'dev-0123456789abcdef',
  name: 'Test Mac',
  platform: 'darwin',
  arch: 'arm64',
  dshVersion: '0.2.1-rc.3',
  pluginVersion: '0.1.0',
}

const TRAILERS: CommitTrailers = {
  operation: 'backup',
  deviceId: DEVICE.id,
  deviceName: DEVICE.name,
  profile: 'default',
  result: 'ok',
  pluginCount: '1',
}

/** Temporary directories created by one test. */
let roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-git-sync-test-'))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  const dirs = roots
  roots = []
  await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true })))
})

/** A scanned plugin record fixture. */
function pluginRecord(overrides: Partial<PluginRecord> = {}): PluginRecord {
  return {
    id: 'dsh-plugin-demo',
    name: 'dsh-plugin-demo',
    version: '1.2.3',
    origin: 'npm',
    installSpec: 'dsh-plugin-demo@1.2.3',
    enabled: true,
    builtIn: false,
    syncable: true,
    pathOnly: false,
    profile: 'default',
    platform: 'darwin',
    rows: [{ moduleName: 'dsh-plugin-demo', enabled: true }],
    configs: { timeout: 30 },
    configSkipped: [],
    ...overrides,
  }
}

/** A complete, deterministic backup file set (root backup directory). */
function backupFileSet(updatedAt: string, record: PluginRecord = pluginRecord()): Record<string, string> {
  const entry = buildRemotePluginEntry({ record, updatedAt, updatedBy: DEVICE.id })
  const manifest = buildManifest({
    previous: null,
    profiles: { default: { pluginCount: 1, updatedAt } },
    devices: [DEVICE.id],
    now: updatedAt,
  })
  const state = buildRemoteProfileState({ profile: 'default', plugins: [entry], updatedAt })
  const config = buildRemoteConfigEntry({
    pluginId: record.id,
    configs: record.configs,
    updatedAt,
    updatedBy: DEVICE.id,
  })
  const snapshot = buildDeviceSnapshot({ device: DEVICE, profile: 'default', plugins: [record], updatedAt })
  return {
    'manifest.json': serializeManifest(manifest),
    'metadata/schema.json': '{"schemaVersion":1,"note":"test"}\n',
    'profiles/default/plugins.json': serializeJson(state),
    [`profiles/default/configs/${safeFileName(record.id)}.json`]: serializeJson(config),
    [`devices/${DEVICE.id}/default.json`]: serializeJson(snapshot),
  }
}

/** Create a temporary bare repository. */
async function createBareRemote(): Promise<string> {
  const remote = await tempDir()
  const result = await runner.run(['init', '--bare', '--quiet', remote])
  expect(result.code).toBe(0)
  return remote
}

/** Clone a repository (used to inspect what was really pushed). */
async function cloneRemote(remote: string): Promise<string> {
  const clone = await tempDir()
  const result = await runner.run(['clone', '--quiet', '--branch', 'main', remote, clone])
  expect(result.code).toBe(0)
  return clone
}

/** A store whose work tree lives under `root`. */
function makeStore(
  root: string,
  remote: string,
  overrides: Partial<Parameters<typeof createRepoStore>[0]> = {},
): ReturnType<typeof createRepoStore> {
  return createRepoStore({
    run: runner,
    workDir: join(root, 'work'),
    repoUrl: remote,
    branch: 'main',
    backupDir: '',
    logger,
    ...overrides,
  })
}

/** Wrap a runner to record every argument vector it receives. */
function recordingRunner(inner: GitRunner): { runner: GitRunner; calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    runner: {
      run: async (args, runOptions) => {
        calls.push([...args])
        return inner.run(args, runOptions)
      },
    },
  }
}

/** Read and parse a JSON file. */
async function readJsonObject(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(path, 'utf8')) as JsonObject
}

describe('backupPaths', () => {
  it('builds the documented layout and refuses unsafe identifiers', () => {
    const paths = backupPaths('backup', 'default', '@scope/pkg name', DEVICE.id)
    expect(paths.root).toBe('backup')
    expect(paths.manifest).toBe('backup/manifest.json')
    expect(paths.schema).toBe('backup/metadata/schema.json')
    expect(paths.readme).toBe('backup/README.md')
    expect(paths.profileState).toBe('backup/profiles/default/plugins.json')
    expect(paths.configsDir).toBe('backup/profiles/default/configs')
    expect(paths.config).toBe(`backup/profiles/default/configs/${safeFileName('@scope/pkg name')}.json`)
    expect(paths.devicesDir).toBe('backup/devices')
    expect(paths.deviceSnapshot).toBe(`backup/devices/${DEVICE.id}/default.json`)
    expect(() => backupPaths('backup', '../escape', 'p', DEVICE.id)).toThrow(SyncError)
    expect(() => backupPaths('backup', 'default', 'p', '../escape')).toThrow(SyncError)
  })
})

describeGit('RepoStore / commit trailers', () => {
  it('parses trailers from real commit bodies (regression: trailing newline)', () => {
    expect(parseCommitTrailers('subject\n\nOperation: backup\nDevice-Id: dev-1\n')).toEqual({
      operation: 'backup',
      'device-id': 'dev-1',
    })
    expect(parseCommitTrailers('subject\n\n\nOperation: backup\nPlugin-Count: 3\n\n')).toEqual({
      operation: 'backup',
      'plugin-count': '3',
    })
    // No trailer paragraph: the subject must never be mistaken for a trailer.
    expect(parseCommitTrailers('subject\n')).toEqual({})
    expect(parseCommitTrailers('backup: first\n')).toEqual({})
    expect(parseCommitTrailers('')).toEqual({})
  })

  it('formats the documented trailer names', () => {
    const body = formatCommitTrailers({ ...TRAILERS, extraKey: 'value', bad: '' })
    expect(body).toBe(
      [
        'Operation: backup',
        `Device-Id: ${DEVICE.id}`,
        'Device-Name: Test Mac',
        'Profile: default',
        'Result: ok',
        'Plugin-Count: 1',
        'extraKey: value',
      ].join('\n'),
    )
  })
})

describeGit('RepoStore (real git)', () => {
  it('prepares an empty repository, returns null reads, then creates the first commit', async () => {
    const root = await tempDir()
    const remote = await createBareRemote()
    const store = makeStore(root, remote)

    const prepared = await store.prepare()
    expect(prepared).toEqual({ head: null, created: true, branch: 'main', refreshed: false })
    // Empty repository: reads are empty, never an error.
    await expect(store.readManifest()).resolves.toBeNull()
    await expect(store.readProfileState('default')).resolves.toBeNull()
    await expect(store.readConfigs('default')).resolves.toEqual({})
    await expect(store.readDeviceSnapshots()).resolves.toEqual({})
    await expect(store.history()).resolves.toEqual([])

    const files = backupFileSet(NOW)
    const result = await store.write({ files, message: 'backup: first', trailers: TRAILERS })
    expect(result.changed).toBe(true)
    expect(result.pushed).toBe(true)
    expect(result.retried).toBe(false)
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(result.changedFiles).toEqual(
      expect.arrayContaining(['manifest.json', 'README.md', 'profiles/default/plugins.json']),
    )

    const manifest = await store.readManifest()
    expect(manifest).toMatchObject({ schemaVersion: MANIFEST_SCHEMA_VERSION, devices: [DEVICE.id] })
    expect(manifest?.profiles.default).toEqual({ pluginCount: 1, updatedAt: NOW })
    await expect(store.readConfigs('default')).resolves.toEqual({ 'dsh-plugin-demo': { timeout: 30 } })

    // The push really landed: clone the remote and inspect it.
    const clone = await cloneRemote(remote)
    expect(await readFile(join(clone, 'README.md'), 'utf8')).toBe(BACKUP_README)
    expect((await readJsonObject(join(clone, 'manifest.json'))).schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    expect(await readFile(join(clone, 'profiles', 'default', 'configs', 'dsh-plugin-demo.json'), 'utf8')).toContain(
      '"timeout": 30',
    )

    // Preparing again picks up the pushed commit.
    const reprepared = await store.prepare()
    expect(reprepared.head).toBe(result.commit)
    expect(reprepared.created).toBe(false)
    expect(reprepared.refreshed).toBe(true)
  })

  it('prepares a fresh work tree from an existing bare branch (clone → fetch → reset)', async () => {
    const remote = await createBareRemote()
    const firstRoot = await tempDir()
    const firstStore = makeStore(firstRoot, remote)
    await firstStore.prepare()
    const firstWrite = await firstStore.write({
      files: backupFileSet(NOW),
      message: 'backup: first',
      trailers: TRAILERS,
    })

    const freshRoot = await tempDir()
    const freshStore = makeStore(freshRoot, remote)
    const prepared = await freshStore.prepare()
    expect(prepared.head).toBe(firstWrite.commit)
    expect(prepared.created).toBe(false)
    expect(prepared.refreshed).toBe(true)
    expect(prepared.branch).toBe('main')
    await expect(freshStore.readManifest()).resolves.not.toBeNull()
  })

  it('does not create a commit when an identical write changes nothing', async () => {
    const root = await tempDir()
    const remote = await createBareRemote()
    const store = makeStore(root, remote)
    await store.prepare()
    const files = backupFileSet(NOW)
    const first = await store.write({ files, message: 'backup: first', trailers: TRAILERS })
    expect(first.changed).toBe(true)

    const second = await store.write({ files, message: 'backup: again', trailers: { ...TRAILERS, pluginCount: '9' } })
    expect(second).toEqual({
      changed: false,
      pushed: false,
      commit: first.commit,
      changedFiles: [],
      retried: false,
    })

    const clone = await cloneRemote(remote)
    const count = await runner.run(['rev-list', '--count', 'HEAD'], { cwd: clone })
    expect(count.stdout.trim()).toBe('1')
    // The work tree is clean after the no-op write.
    const status = await runner.run(['status', '--porcelain'], { cwd: join(root, 'work') })
    expect(status.stdout.trim()).toBe('')
  })

  it('supports deletion-only writes and tolerates deleting a missing file', async () => {
    const root = await tempDir()
    const remote = await createBareRemote()
    const store = makeStore(root, remote)
    await store.prepare()
    const configFile = `profiles/default/configs/${safeFileName(pluginRecord().id)}.json`
    await store.write({ files: backupFileSet(NOW), message: 'backup: first', trailers: TRAILERS })
    expect(await store.readConfigs('default')).toHaveProperty('dsh-plugin-demo')

    const removal = await store.write({
      files: {},
      deletions: [configFile],
      message: 'backup: remove config',
      trailers: { ...TRAILERS, operation: 'sync' },
    })
    expect(removal.changed).toBe(true)
    expect(removal.pushed).toBe(true)
    await expect(store.readConfigs('default')).resolves.toEqual({})
    const clone = await cloneRemote(remote)
    await expect(readFile(join(clone, configFile), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const repeated = await store.write({
      files: {},
      deletions: [configFile],
      message: 'backup: remove again',
      trailers: TRAILERS,
    })
    expect(repeated.changed).toBe(false)
  })

  it('fast-forwards an existing branch and merges a concurrent device via rebuild (no force)', async () => {
    const remote = await createBareRemote()
    const shared = recordingRunner(runner)
    const rootA = await tempDir()
    const rootB = await tempDir()
    const storeA = makeStore(rootA, remote, { run: shared.runner })
    const storeB = makeStore(rootB, remote, { run: shared.runner })
    await storeA.prepare()
    await storeB.prepare()

    const filesA = { ...backupFileSet(NOW), 'shared.txt': 'A\n' }
    const writeA = await storeA.write({ files: filesA, message: 'backup: device A', trailers: TRAILERS })
    expect(writeA.pushed).toBe(true)

    // Device B prepared before A pushed; its first push must be rejected and
    // resolved by fetch → rebuild → retry.
    const filesB = { ...backupFileSet(LATER), 'shared.txt': 'B\n' }
    let rebuildCalls = 0
    const writeB = await storeB.write({
      files: filesB,
      message: 'backup: device B',
      trailers: { ...TRAILERS, deviceId: 'dev-b', deviceName: 'Device B', pluginCount: '2' },
      rebuild: async workTree => {
        rebuildCalls += 1
        const remoteShared = await readFile(join(workTree, 'shared.txt'), 'utf8')
        return { files: { ...filesB, 'shared.txt': `${remoteShared}+B\n` } }
      },
    })
    expect(rebuildCalls).toBe(1)
    expect(writeB.retried).toBe(true)
    expect(writeB.pushed).toBe(true)
    expect(writeB.changed).toBe(true)

    const clone = await cloneRemote(remote)
    expect(await readFile(join(clone, 'shared.txt'), 'utf8')).toBe('A\n+B\n')
    const log = await runner.run(['log', '--format=%H'], { cwd: clone })
    const commits = log.stdout.trim().split('\n')
    expect(commits).toHaveLength(2)
    expect(commits).toContain(writeA.commit)
    expect(commits).toContain(writeB.commit)
    // The store never force-pushes, and the retry path really reset the tree.
    const pushCalls = shared.calls.filter(args => args[0] === 'push')
    expect(pushCalls.length).toBeGreaterThanOrEqual(2)
    for (const args of pushCalls) {
      expect(args.some(arg => arg === '--force' || arg.startsWith('--force'))).toBe(false)
    }
    expect(shared.calls.some(args => args[0] === 'reset' && args[1] === '--hard')).toBe(true)
  })

  it('records trailers that history parses (operation, device, profile, count)', async () => {
    const root = await tempDir()
    const remote = await createBareRemote()
    const store = makeStore(root, remote)
    await store.prepare()
    const written = await store.write({
      files: backupFileSet(NOW),
      message: 'backup: first',
      trailers: TRAILERS,
    })
    const entries = await store.history({ limit: 10 })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      commit: written.commit,
      subject: 'backup: first',
      operation: 'backup',
      deviceId: DEVICE.id,
      deviceName: DEVICE.name,
      profile: 'default',
      pluginCount: 1,
      result: 'ok',
    })
    expect(entries[0]?.shortCommit.length).toBeGreaterThanOrEqual(7)
    expect(Number.isFinite(Date.parse(entries[0]?.date ?? ''))).toBe(true)

    await store.write({
      files: { ...backupFileSet(LATER), 'extra.txt': 'x\n' },
      message: 'sync: second',
      trailers: { ...TRAILERS, operation: 'sync', result: 'ok' },
    })
    const after = await store.history()
    expect(after).toHaveLength(2)
    expect(after[0]?.operation).toBe('sync')
    expect(after[1]?.operation).toBe('backup')
  })

  it('rejects a malformed manifest instead of silently accepting it', async () => {
    const root = await tempDir()
    const remote = await createBareRemote()
    const store = makeStore(root, remote)
    await store.prepare()
    await store.write({ files: { 'manifest.json': '{not json' }, message: 'backup: broken', trailers: TRAILERS })
    await expect(store.readManifest()).rejects.toMatchObject({ code: 'invalid-manifest' })

    const newer = JSON.stringify({ schemaVersion: MANIFEST_SCHEMA_VERSION + 1 })
    await store.write({ files: { 'manifest.json': newer }, message: 'backup: newer', trailers: TRAILERS })
    try {
      await store.readManifest()
      expect.unreachable('readManifest should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(SyncError)
      expect((error as SyncError).code).toBe('invalid-manifest')
      expect((error as SyncError).message).toMatch(/upgrade/i)
    }
  })

  it('refuses traversal, absolute paths and .git writes', async () => {
    const root = await tempDir()
    const remote = await createBareRemote()
    const store = makeStore(root, remote)
    await store.prepare()
    const workDir = join(root, 'work')

    const badFileSets: Record<string, string>[] = [
      { '../evil.txt': 'x' },
      { '/tmp/evil.json': 'x' },
      { '.git/config': '[core]\n\tmalicious = true\n' },
      { 'profiles/default/../../escape.json': 'x' },
    ]
    for (const files of badFileSets) {
      await expect(store.write({ files, message: 'bad path', trailers: TRAILERS })).rejects.toMatchObject({
        code: 'invalid-path',
      })
    }
    await expect(
      store.write({ files: {}, deletions: ['../evil.txt'], message: 'bad deletion', trailers: TRAILERS }),
    ).rejects.toMatchObject({ code: 'invalid-path' })

    await expect(lstat(resolve(workDir, '..', 'evil.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    const gitConfig = await readFile(join(workDir, '.git', 'config'), 'utf8')
    expect(gitConfig).not.toContain('malicious')
    // Nothing was committed by the rejected writes.
    await expect(store.readManifest()).resolves.toBeNull()
  })

  it('writes a nested backup directory and reads every document back', async () => {
    const root = await tempDir()
    const remote = await createBareRemote()
    const store = makeStore(root, remote, { backupDir: 'backup' })
    await store.prepare()
    const paths = backupPaths('backup', 'default', pluginRecord().id, DEVICE.id)
    const record = pluginRecord()
    const state = buildRemoteProfileState({
      profile: 'default',
      plugins: [buildRemotePluginEntry({ record, updatedAt: NOW, updatedBy: DEVICE.id })],
      updatedAt: NOW,
    })
    const config = buildRemoteConfigEntry({
      pluginId: record.id,
      configs: record.configs,
      updatedAt: NOW,
      updatedBy: DEVICE.id,
    })
    const snapshot = buildDeviceSnapshot({ device: DEVICE, profile: 'default', plugins: [record], updatedAt: NOW })
    const manifest = buildManifest({
      previous: null,
      profiles: { default: { pluginCount: 1, updatedAt: NOW } },
      devices: [DEVICE.id],
      now: NOW,
    })
    const result = await store.write({
      files: {
        [paths.manifest]: serializeManifest(manifest),
        [paths.schema]: serializeJson({ schemaVersion: MANIFEST_SCHEMA_VERSION, note: 'test' }),
        [paths.profileState]: serializeJson(state),
        [paths.config]: serializeJson(config),
        [paths.deviceSnapshot]: serializeJson(snapshot),
      },
      message: 'backup: nested',
      trailers: TRAILERS,
    })
    expect(result.pushed).toBe(true)
    expect(result.changedFiles).toEqual(expect.arrayContaining([paths.manifest, pathToReadme(paths.root), paths.config]))

    expect((await store.readManifest())?.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    await expect(store.readProfileState('default')).resolves.toMatchObject({ profile: 'default' })
    await expect(store.readConfigs('default')).resolves.toEqual({ 'dsh-plugin-demo': { timeout: 30 } })
    const snapshots = await store.readDeviceSnapshots()
    expect(snapshots[DEVICE.id]?.profile).toBe('default')

    const clone = await cloneRemote(remote)
    expect(await readFile(join(clone, 'backup', 'README.md'), 'utf8')).toBe(BACKUP_README)
    expect((await readJsonObject(join(clone, 'backup', 'metadata', 'schema.json'))).note).toBe('test')
    // Both caller path forms are accepted: backup-relative and repository-relative.
    if (paths.root !== '') {
      expect(paths.profileState.startsWith(`${paths.root}/`)).toBe(true)
    }
  })

  it('supports a local non-bare repository and never initializes it as bare', async () => {
    const source = await tempDir()
    const init = await runner.run(['init', '--quiet', '--initial-branch=trunk', source])
    expect(init.code).toBe(0)
    await writeFile(join(source, 'source.txt'), 'source\n', 'utf8')
    await runner.run(['add', '-A'], { cwd: source })
    const commit = await runner.run(['commit', '-q', '-m', 'initial'], { cwd: source, env: IDENTITY_ENV })
    expect(commit.code).toBe(0)
    const sourceHead = (await runner.run(['rev-parse', 'HEAD'], { cwd: source })).stdout.trim()

    const root = await tempDir()
    const store = makeStore(root, source)
    const prepared = await store.prepare()
    expect(prepared.head).toBe(sourceHead)
    expect(prepared.created).toBe(true)
    expect(prepared.refreshed).toBe(false)

    const manifest = buildManifest({
      previous: null,
      profiles: {},
      devices: [],
      now: NOW,
    })
    const result = await store.write({
      files: { 'manifest.json': serializeManifest(manifest) },
      message: 'backup: local',
      trailers: TRAILERS,
    })
    expect(result.pushed).toBe(true)

    const stats = await stat(join(source, '.git'))
    expect(stats.isDirectory()).toBe(true)
    const branch = await runner.run(['show-ref', '--verify', 'refs/heads/main'], { cwd: source })
    expect(branch.code).toBe(0)
    const head = await runner.run(['symbolic-ref', 'HEAD'], { cwd: source })
    expect(head.stdout.trim()).toBe('refs/heads/trunk')
  })

  it('dryRun reports the would-be change without writing, committing or pushing', async () => {
    const root = await tempDir()
    const remote = await createBareRemote()
    const store = makeStore(root, remote)
    await store.prepare()
    const manifest = buildManifest({ previous: null, profiles: {}, devices: [], now: NOW })
    const result = await store.write({
      files: { 'manifest.json': serializeManifest(manifest) },
      message: 'backup: dry',
      trailers: TRAILERS,
      dryRun: true,
    })
    expect(result.changed).toBe(true)
    expect(result.pushed).toBe(false)
    expect(result.commit).toBeNull()
    expect(result.changedFiles).toEqual(expect.arrayContaining(['manifest.json', 'README.md']))

    const workDir = join(root, 'work')
    await expect(lstat(join(workDir, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    const status = await runner.run(['status', '--porcelain'], { cwd: workDir })
    expect(status.stdout.trim()).toBe('')
    const remoteRefs = await runner.run(['ls-remote', '--heads', remote])
    expect(remoteRefs.stdout.trim()).toBe('')
    await expect(store.readManifest()).resolves.toBeNull()
  })

  it('reads a historical commit without disturbing the work tree', async () => {
    const root = await tempDir()
    const remote = await createBareRemote()
    const store = makeStore(root, remote)
    await store.prepare()
    const first = await store.write({ files: backupFileSet(NOW), message: 'backup: first', trailers: TRAILERS })
    await store.write({ files: backupFileSet(LATER), message: 'backup: second', trailers: TRAILERS })
    expect((await store.readManifest())?.updatedAt).toBe(LATER)

    const at = await store.readAtCommit(first.commit!, 'default')
    expect(at.manifest?.updatedAt).toBe(NOW)
    expect(at.state?.updatedAt).toBe(NOW)
    expect(Object.keys(at.configs)).toEqual(['dsh-plugin-demo'])
    expect(at.device?.id).toBe(DEVICE.id)

    await expect(store.readAtCommit('not-a-hash', 'default')).rejects.toMatchObject({ code: 'invalid-path' })
    await expect(store.readAtCommit('--help', 'default')).rejects.toMatchObject({ code: 'invalid-path' })
  })

  it('tests connectivity and reports the branch head', async () => {
    const root = await tempDir()
    const remote = await createBareRemote()
    const store = makeStore(root, remote)
    await store.prepare()
    const empty = await store.testConnection()
    expect(empty.ok).toBe(true)
    expect(empty.head).toBeNull()
    expect(empty.branch).toBe('main')
    expect(empty.message).toMatch(/does not exist/i)
    expect(empty.authMethod).toBe('local-path')

    const written = await store.write({ files: backupFileSet(NOW), message: 'backup: first', trailers: TRAILERS })
    const connected = await store.testConnection()
    expect(connected.ok).toBe(true)
    expect(connected.head).toBe(written.commit)

    const missingRoot = await tempDir()
    const missing = makeStore(missingRoot, join(missingRoot, 'does-not-exist.git'))
    const unreachable = await missing.testConnection()
    expect(unreachable.ok).toBe(false)
    expect(unreachable.message.length).toBeGreaterThan(0)
  })

  it('refuses unsafe or unconfigured repository URLs', async () => {
    const root = await tempDir()
    const workDir = join(root, 'work')
    const embedded = createRepoStore({
      run: runner,
      workDir,
      repoUrl: 'https://user:ghp_secret@example.com/repo.git',
      branch: 'main',
      backupDir: '',
      logger,
    })
    await expect(
      embedded.write({ files: { 'a.json': '{}\n' }, message: 'x', trailers: TRAILERS }),
    ).rejects.toMatchObject({ code: 'invalid-config' })

    const optionLike = createRepoStore({
      run: runner,
      workDir: join(root, 'work2'),
      repoUrl: '--upload-pack=/bin/sh',
      branch: 'main',
      backupDir: '',
      logger,
    })
    const connection = await optionLike.testConnection()
    expect(connection.ok).toBe(false)

    const unconfigured = createRepoStore({
      run: runner,
      workDir: join(root, 'work3'),
      repoUrl: '',
      branch: 'main',
      backupDir: '',
      logger,
    })
    await expect(
      unconfigured.write({ files: {}, message: 'x', trailers: TRAILERS }),
    ).rejects.toMatchObject({ code: 'not-configured' })
    expect((await unconfigured.testConnection()).ok).toBe(false)
  })


  it('applies rebuild-provided deletions during a race retry', async () => {
    const remote = await createBareRemote()
    const rootA = await tempDir()
    const rootB = await tempDir()
    const storeA = makeStore(rootA, remote)
    const storeB = makeStore(rootB, remote)
    await storeA.prepare()
    await storeB.prepare()

    const filesA = { ...backupFileSet(NOW), 'keep.txt': 'A\n', 'obsolete.txt': 'A\n' }
    await storeA.write({ files: filesA, message: 'backup: device A', trailers: TRAILERS })

    const writeB = await storeB.write({
      files: { 'keep.txt': 'B\n' },
      message: 'backup: device B',
      trailers: { ...TRAILERS, deviceId: 'dev-b', deviceName: 'Device B' },
      rebuild: async workTree => {
        const remoteKeep = await readFile(join(workTree, 'keep.txt'), 'utf8')
        return {
          files: { 'keep.txt': `${remoteKeep}+B\n` },
          deletions: ['obsolete.txt'],
        }
      },
    })
    expect(writeB.retried).toBe(true)
    expect(writeB.pushed).toBe(true)
    const clone = await cloneRemote(remote)
    expect(await readFile(join(clone, 'keep.txt'), 'utf8')).toBe('A\n+B\n')
    await expect(readFile(join(clone, 'obsolete.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    // Device A''s files survive because the retry rebuilt on top of the pulled tree.
    expect(await readFile(join(clone, 'manifest.json'), 'utf8')).toContain('"schemaVersion"')
  })

  it('accepts backup-relative file paths when backupDir is set', async () => {
    const root = await tempDir()
    const remote = await createBareRemote()
    const store = makeStore(root, remote, { backupDir: 'backup' })
    await store.prepare()
    const manifest = buildManifest({ previous: null, profiles: {}, devices: [], now: NOW })
    const result = await store.write({
      files: {
        'manifest.json': serializeManifest(manifest),
        'profiles/default/plugins.json': serializeJson(
          buildRemoteProfileState({ profile: 'default', plugins: [], updatedAt: NOW }),
        ),
      },
      message: 'backup: relative',
      trailers: TRAILERS,
    })
    expect(result.changedFiles).toEqual(
      expect.arrayContaining(['backup/manifest.json', 'backup/profiles/default/plugins.json', 'backup/README.md']),
    )
    await expect(store.readManifest()).resolves.not.toBeNull()
    const clone = await cloneRemote(remote)
    expect((await readJsonObject(join(clone, 'backup', 'manifest.json'))).schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
  })

  it('refuses to write through a symlinked directory inside the work tree', async () => {
    const root = await tempDir()
    const remote = await createBareRemote()
    const store = makeStore(root, remote)
    await store.prepare()
    const workDir = join(root, 'work')
    const outside = await tempDir()
    await mkdir(join(outside, 'default'), { recursive: true })
    await symlink(outside, join(workDir, 'profiles'), 'dir')
    await expect(
      store.write({
        files: { 'profiles/default/plugins.json': '{}\n' },
        message: 'backup: symlink',
        trailers: TRAILERS,
      }),
    ).rejects.toMatchObject({ code: 'invalid-path' })
    // Nothing escaped the work tree.
    const outsideEntries = await readdir(join(outside, 'default'))
    expect(outsideEntries).toEqual([])
    await expect(store.readManifest()).resolves.toBeNull()
  })


  it('refuses to read through a symlinked directory inside the work tree', async () => {
    const root = await tempDir()
    const remote = await createBareRemote()
    const store = makeStore(root, remote)
    await store.prepare()
    const workDir = join(root, 'work')
    const outside = await tempDir()
    await mkdir(join(outside, 'default', 'configs'), { recursive: true })
    await writeFile(
      join(outside, 'default', 'configs', 'dsh-plugin-demo.json'),
      serializeJson(buildRemoteConfigEntry({ pluginId: 'dsh-plugin-demo', configs: { timeout: 1 }, updatedAt: NOW, updatedBy: DEVICE.id })),
      'utf8',
    )
    await symlink(outside, join(workDir, 'profiles'), 'dir')
    await expect(store.readConfigs('default')).rejects.toMatchObject({ code: 'invalid-path' })
  })

  it('never passes option-like user data to git and never force-pushes', async () => {
    const root = await tempDir()
    const remote = await createBareRemote()
    const recorded = recordingRunner(runner)
    const store = makeStore(root, remote, { run: recorded.runner })
    await store.prepare()
    await store.write({ files: backupFileSet(NOW), message: 'backup: first', trailers: TRAILERS })
    await store.write({ files: backupFileSet(LATER), message: 'backup: second', trailers: TRAILERS })

    for (const args of recorded.calls) {
      expect(args[0]?.startsWith('-')).toBe(false)
      expect(args.some(arg => arg === '--force' || arg.startsWith('--force'))).toBe(false)
    }
    const pushes = recorded.calls.filter(args => args[0] === 'push')
    expect(pushes.length).toBe(2)
    for (const push of pushes) expect(push).toEqual(['push', 'origin', 'HEAD:refs/heads/main'])
  })
})

/** README path for a backup root (helper for assertions). */
function pathToReadme(root: string): string {
  return root === '' ? 'README.md' : `${root}/README.md`
}
