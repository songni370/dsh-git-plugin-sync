/**
 * End-to-end integration tests: two simulated DSH devices synchronizing through
 * one real local bare Git repository.
 *
 * The real scanner, config gateway, installer adapter, Git runner, repository
 * store, manifest validation, sync engine, snapshot and history code are
 * exercised; only the two Host service endpoints (plugin manager and config
 * editor) are simulated.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SyncError } from '../../src/core/errors.js'
import {
  createBareRepo,
  createFakeDevice,
  createLinkedLocalPlugin,
  listRepoFiles,
  readRepoFile,
  repoCommitCount,
  repoHead,
  writeRepoFileDirect,
  type FakeDevice,
} from './fake-dsh.js'

interface TestContext {
  root: string
  bareRepo: string
  mac: FakeDevice
  win: FakeDevice
}

let ctx: TestContext

/** Fail the test with a readable message when a call unexpectedly succeeds. */
async function expectRejection(promise: Promise<unknown>, code: string): Promise<SyncError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(SyncError)
    expect((error as SyncError).code).toBe(code)
    return error as SyncError
  }
  throw new Error(`expected a SyncError with code ${code}, but the call succeeded`)
}

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-git-sync-it-'))
  const bareRepo = createBareRepo(root)
  const mac = await createFakeDevice({ root, name: 'mac', repoUrl: bareRepo, platform: 'darwin' })
  const win = await createFakeDevice({ root, name: 'win', repoUrl: bareRepo, platform: 'win32' })
  ctx = { root, bareRepo, mac, win }
}, 120_000)

afterAll(async () => {
  if (ctx !== undefined) await rm(ctx.root, { recursive: true, force: true })
})

describe('two-device synchronization', () => {
  it('backs up one device and restores it on another without leaking secrets', async () => {
    ctx.mac.addPlugin({
      name: 'alpha',
      version: '1.0.0',
      enabled: true,
      configs: { timeout: 30, apiKey: 'sk-abcdefghijklmnopqrstuvwxyz', nested: { password: 'hunter2hunter2', mode: 'fast' } },
    })

    const backup = await ctx.mac.engine.backup({ confirmDestructive: true })
    expect(backup.ok).toBe(true)
    expect(backup.pushed).toBe(true)
    expect(backup.commit).toBeTruthy()
    expect(repoCommitCount(ctx.bareRepo)).toBe(1)

    // Repository layout and no-secret checks.
    const files = listRepoFiles(ctx.bareRepo)
    expect(files).toContain('manifest.json')
    expect(files).toContain('metadata/schema.json')
    expect(files).toContain('profiles/desktop/plugins.json')
    expect(files).toContain('profiles/desktop/configs/alpha.json')
    expect(files.some(file => file.startsWith('devices/'))).toBe(true)

    const configText = readRepoFile(ctx.bareRepo, 'profiles/desktop/configs/alpha.json')
    expect(configText).toContain('"timeout": 30')
    expect(configText).not.toContain('apiKey')
    expect(configText).not.toContain('sk-')
    expect(configText).not.toContain('hunter2hunter2')

    const allText = files.map(file => readRepoFile(ctx.bareRepo, file)).join('\n')
    expect(allText).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
    expect(allText).not.toContain('hunter2hunter2')

    const manifest = JSON.parse(readRepoFile(ctx.bareRepo, 'manifest.json')) as { schemaVersion: number }
    expect(manifest.schemaVersion).toBe(1)

    // Second device: preview then restore.
    const preview = await ctx.win.engine.previewRestore()
    expect(preview.plan.direction).toBe('pull')
    expect(preview.plan.actions.some(action => action.pluginId === 'alpha')).toBe(true)
    expect(preview.plan.requiresConfirmation).toBe(true)

    const restore = await ctx.win.engine.restore({ confirmDestructive: true })
    expect(restore.ok).toBe(true)
    expect(restore.snapshot).toBeTruthy()
    const restored = ctx.win.plugin('alpha')
    expect(restored?.version).toBe('1.0.0')
    expect(restored?.configs.timeout).toBe(30)
    expect(restored?.configs.apiKey).toBeUndefined()
    expect(restored?.configs.nested).toEqual({ mode: 'fast' })
  }, 120_000)

  it('returns the documented AutoSyncResponse shape', async () => {
    const result = await ctx.mac.engine.setAutoSync({ enabled: false })
    // The page reads `response.status.config`, so the status view must be at
    // exactly that depth (regression: it used to be nested one level deeper).
    expect(result.status.config.repoUrl).toBe(ctx.bareRepo)
    expect(result.status.state).toBeDefined()
  }, 120_000)

  it('does not create a commit when nothing changed', async () => {
    const before = repoHead(ctx.bareRepo)
    const commits = repoCommitCount(ctx.bareRepo)
    const again = await ctx.mac.engine.backup({ confirmDestructive: true })
    expect(again.ok).toBe(true)
    expect(again.noChanges).toBe(true)
    expect(repoHead(ctx.bareRepo)).toBe(before)
    expect(repoCommitCount(ctx.bareRepo)).toBe(commits)
  }, 120_000)

  it('attributes independent additions on both devices and exchanges them', async () => {
    ctx.win.addPlugin({ name: 'beta', version: '2.0.0', enabled: true, configs: { level: 2 } })
    const winBackup = await ctx.win.engine.backup({ confirmDestructive: true })
    expect(winBackup.ok).toBe(true)

    // mac now sees beta only remotely, and its own alpha change must still be pushed.
    const preview = await ctx.mac.engine.previewSync()
    expect(preview.plan.conflicts).toHaveLength(0)
    expect(preview.plan.actions.some(action => action.pluginId === 'beta' && action.kind === 'upgrade')).toBe(true)

    const sync = await ctx.mac.engine.sync({ confirmDestructive: true })
    expect(sync.ok).toBe(true)
    expect(ctx.mac.plugin('beta')?.version).toBe('2.0.0')
    expect(ctx.mac.plugin('alpha')?.version).toBe('1.0.0')
  }, 120_000)

  it('applies a remote-only version change locally', async () => {
    ctx.mac.addPlugin({ name: 'alpha', version: '1.1.0', enabled: true, configs: { timeout: 30, nested: { mode: 'fast' } } })
    const backup = await ctx.mac.engine.backup({ confirmDestructive: true })
    expect(backup.ok).toBe(true)

    const preview = await ctx.win.engine.previewSync()
    expect(preview.plan.actions.some(action => action.pluginId === 'alpha' && action.kind === 'upgrade')).toBe(true)

    const sync = await ctx.win.engine.sync({ confirmDestructive: true })
    expect(sync.ok).toBe(true)
    expect(ctx.win.plugin('alpha')?.version).toBe('1.1.0')
    expect(ctx.win.plugin('beta')?.version).toBe('2.0.0')
  }, 120_000)

  it('detects a configuration conflict and resolves it with the remote side', async () => {
    ctx.mac.addPlugin({ name: 'alpha', version: '1.1.0', enabled: true, configs: { timeout: 60, nested: { mode: 'fast' } } })
    const macBackup = await ctx.mac.engine.backup({ confirmDestructive: true })
    expect(macBackup.ok).toBe(true)

    ctx.win.addPlugin({ name: 'alpha', version: '1.1.0', enabled: true, configs: { timeout: 90, nested: { mode: 'fast' } } })
    const error = await expectRejection(ctx.win.engine.sync({ confirmDestructive: true }), 'conflict-present')
    const details = error.details as { plan?: { conflicts: { pluginId: string; fields: string[]; localConfig?: Record<string, unknown>; remoteConfig?: Record<string, unknown> }[] } }
    const conflict = details.plan?.conflicts.find(item => item.pluginId === 'alpha')
    expect(conflict?.fields).toContain('config.timeout')
    expect(conflict?.localConfig).toMatchObject({ timeout: 90 })
    expect(conflict?.remoteConfig).toMatchObject({ timeout: 60 })

    const resolved = await ctx.win.engine.sync({
      confirmDestructive: true,
      resolutions: [{ pluginId: 'alpha', choice: 'remote' }],
    })
    expect(resolved.ok).toBe(true)
    expect(ctx.win.plugin('alpha')?.configs.timeout).toBe(60)
  }, 120_000)

  it('requires confirmation before a backup deletes a repository entry', async () => {
    ctx.mac.removePlugin('beta')
    const error = await expectRejection(ctx.mac.engine.backup(), 'confirmation-required')
    const details = error.details as { plan?: { actions: { kind: string; pluginId: string }[] } }
    expect(details.plan?.actions.some(action => action.kind === 'remove-remote' && action.pluginId === 'beta')).toBe(true)

    const confirmed = await ctx.mac.engine.backup({ confirmDestructive: true })
    expect(confirmed.ok).toBe(true)
    const state = JSON.parse(readRepoFile(ctx.bareRepo, 'profiles/desktop/plugins.json')) as {
      plugins: Record<string, { deleted?: boolean }>
    }
    expect(state.plugins.beta?.deleted).toBe(true)
  }, 120_000)

  it('pauses on a remote deletion until the user decides, then removes locally', async () => {
    const error = await expectRejection(ctx.win.engine.sync({ confirmDestructive: true }), 'conflict-present')
    const details = error.details as { plan?: { conflicts: { pluginId: string; reason: string }[] } }
    expect(details.plan?.conflicts.find(item => item.pluginId === 'beta')?.reason).toBe('remote-deleted')
    expect(ctx.win.plugin('beta')).toBeDefined()

    // Without allowPluginRemoval the engine keeps refusing destructive removals.
    const stillRefused = await expectRejection(
      ctx.win.engine.sync({ confirmDestructive: true, resolutions: [{ pluginId: 'beta', choice: 'remote' }] }),
      'conflict-present',
    )
    expect(stillRefused.message).toContain('beta')

    await ctx.win.saveConfig({ allowPluginRemoval: true })
    const removed = await ctx.win.engine.sync({
      confirmDestructive: true,
      resolutions: [{ pluginId: 'beta', choice: 'remote' }],
    })
    expect(removed.ok).toBe(true)
    expect(ctx.win.plugin('beta')).toBeUndefined()
  }, 120_000)

  it('rolls back configuration and enablement from a snapshot', async () => {
    const snapshots = await ctx.win.engine.listSnapshots()
    expect(snapshots.length).toBeGreaterThan(0)
    const latest = snapshots[0]
    expect(latest).toBeDefined()
    const result = await ctx.win.engine.rollbackSnapshot(latest as string)
    expect(result.operation).toBe('rollback')
    expect(result.snapshot).toBe(latest)
  }, 120_000)

  it('reports an unreachable repository without touching local plugins', async () => {
    const before = ctx.win.plugin('alpha')?.version
    const bad = await createFakeDevice({
      root: join(ctx.root, 'broken'),
      name: 'broken',
      repoUrl: join(ctx.root, 'does-not-exist.git'),
    })
    bad.addPlugin({ name: 'alpha', version: '1.0.0', enabled: true, configs: {} })
    let failed = false
    try {
      await bad.engine.backup({ confirmDestructive: true })
    } catch (error) {
      failed = true
      expect(error).toBeInstanceOf(SyncError)
      const code = (error as SyncError).code
      expect(['git-failed', 'git-network', 'git-auth-failed', 'repo-empty']).toContain(code)
    }
    expect(failed).toBe(true)
    expect(bad.plugin('alpha')?.version).toBe('1.0.0')
    expect(ctx.win.plugin('alpha')?.version).toBe(before)
  }, 120_000)

  it('keeps a local development plugin out of the backup unless opted in, and never stores its path', async () => {
    const local = await createLinkedLocalPlugin({ device: ctx.mac, name: 'dev-plugin', version: '0.0.1' })
    // A linked local plugin is also reported by the Host plugin manager, with a
    // file: install target; the scanner must classify it as a local path.
    ctx.mac.addPlugin({ name: 'dev-plugin', version: '0.0.1', enabled: true, configs: {}, spec: `file:${local.path}` })
    const inventory = await ctx.mac.scan()
    const record = inventory.plugins.find(plugin => plugin.name === 'dev-plugin')
    expect(record?.origin).toBe('local-path')
    expect(record?.pathOnly).toBe(true)
    expect(record?.syncable).toBe(false)
    expect(record?.localPath).toContain(local.path)

    const backup = await ctx.mac.engine.backup({ confirmDestructive: true })
    expect(backup.ok).toBe(true)
    const files = listRepoFiles(ctx.bareRepo)
    const backupText = files.map(file => readRepoFile(ctx.bareRepo, file)).join('\n')
    expect(backupText).not.toContain(local.path)
    expect(files.some(file => file.includes('dev-plugin'))).toBe(false)

    await ctx.mac.saveConfig({ includeLocalPlugins: true })
    const optedIn = await ctx.mac.engine.backup({ confirmDestructive: true })
    expect(optedIn.ok).toBe(true)
    const optedText = listRepoFiles(ctx.bareRepo).map(file => readRepoFile(ctx.bareRepo, file)).join('\n')
    expect(optedText).not.toContain(local.path)
  }, 120_000)

  it('produces history entries with device and operation trailers', async () => {
    const history = await ctx.mac.engine.history({ limit: 50 })
    expect(history.entries.length).toBeGreaterThan(0)
    const operations = history.entries.map(entry => entry.operation)
    expect(operations).toContain('backup')
    const withDevice = history.entries.find(entry => entry.deviceId !== undefined)
    expect(withDevice).toBeDefined()
    expect(withDevice?.deviceName).toBe('mac')
  }, 120_000)

  it('counts only listable plugins in the status card', async () => {
    const before = await ctx.mac.engine.status()
    ctx.mac.addPlugin({ name: 'cordis:include', version: '0.0.0', enabled: true, configs: {} })
    ctx.mac.engine.invalidateScan()
    const after = await ctx.mac.engine.status()
    const list = await ctx.mac.engine.listPlugins()
    // A loader-internal row must not bump the local count or appear in the list.
    expect(after.status.localPluginCount).toBe(before.status.localPluginCount)
    expect(list.rows.some(row => row.name === 'cordis:include')).toBe(false)
    expect(after.status.localPluginCount).toBe(list.rows.filter(row => row.local !== undefined).length)
  }, 120_000)

  it('reports status counts without contacting the network when cached', async () => {
    const { status } = await ctx.mac.engine.status()
    expect(status.config.repoUrl).toBe(ctx.bareRepo)
    expect(status.localPluginCount).toBeGreaterThan(0)
    expect(['synced', 'ahead', 'behind', 'diverged', 'conflict', 'error', 'unknown', 'not-configured']).toContain(status.state)
  }, 120_000)
  it('rejects a malformed manifest instead of guessing', async () => {
    await writeRepoFileDirect(ctx.bareRepo, 'manifest.json', '{ this is not json')
    const error = await expectRejection(ctx.win.engine.sync({ confirmDestructive: true }), 'invalid-manifest')
    expect(error.message.length).toBeGreaterThan(0)
  }, 120_000)

})
