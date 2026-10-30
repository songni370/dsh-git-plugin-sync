/**
 * Unit tests for the pure planning engine: backup (push), restore (pull) and
 * two-way sync with baseline-based change attribution, conflict detection and
 * explicit user resolutions.
 */

import { describe, expect, it } from 'vitest'
import { defaultConfig, defaultAutoSync } from '../../src/state/store.js'
import type { ConflictResolution, SyncConfig } from '../../src/types.js'
import type { PluginState } from '../../src/services/model.js'
import { planBackup, planRestore, planSync, type PlanInput } from '../../src/services/plan.js'

/** Build a plugin state quickly. */
function plugin(id: string, overrides: Partial<PluginState> = {}): PluginState {
  return {
    id,
    name: id,
    version: '1.0.0',
    enabled: true,
    configs: {},
    installSpec: `${id}@1.0.0`,
    origin: 'npm',
    pathOnly: false,
    builtIn: false,
    syncable: true,
    rows: [],
    ...overrides,
  }
}

/** Build a plan input with sensible defaults. */
function input(overrides: Partial<PlanInput> = {}): PlanInput {
  const config: SyncConfig = {
    ...defaultConfig(),
    repoUrl: 'file:///tmp/backup.git',
    autoSync: defaultAutoSync(),
  }
  return {
    profile: 'desktop',
    config,
    now: '2026-01-01T00:00:00.000Z',
    localPlatform: 'darwin',
    local: {},
    remote: {},
    remoteTombstones: new Set<string>(),
    remoteMeta: {},
    base: {},
    ...overrides,
  }
}

/** Find actions of a kind for one plugin. */
function actionsOf(plan: ReturnType<typeof planSync>, kind: string, pluginId?: string) {
  return plan.actions.filter(action => action.kind === kind && (pluginId === undefined || action.pluginId === pluginId))
}

describe('backup plan', () => {
  it('pushes a new local plugin', () => {
    const plan = planBackup(input({ local: { alpha: plugin('alpha') } }))
    expect(actionsOf(plan, 'push-plugin', 'alpha')).toHaveLength(1)
    expect(plan.requiresConfirmation).toBe(false)
    expect(plan.conflicts).toHaveLength(0)
    expect(plan.diffs[0]?.kind).toBe('missing-remote')
  })

  it('does nothing when both sides are identical', () => {
    const plan = planBackup(input({ local: { alpha: plugin('alpha') }, remote: { alpha: plugin('alpha') } }))
    expect(plan.actions).toHaveLength(0)
    expect(plan.requiresConfirmation).toBe(false)
    expect(plan.diffs[0]?.kind).toBe('identical')
  })

  it('pushes changed configuration separately from the plugin entry', () => {
    const local = plugin('alpha', { configs: { timeout: 30 } })
    const remote = plugin('alpha', { configs: { timeout: 10 } })
    const plan = planBackup(input({ local: { alpha: local }, remote: { alpha: remote } }))
    expect(actionsOf(plan, 'push-config', 'alpha')).toHaveLength(1)
    expect(plan.actions.find(action => action.kind === 'push-config')?.configs).toEqual({ timeout: 30 })
  })

  it('requires confirmation before tombstoning a plugin removed locally', () => {
    const plan = planBackup(input({
      base: { alpha: plugin('alpha') },
      remote: { alpha: plugin('alpha') },
      local: {},
    }))
    expect(actionsOf(plan, 'remove-remote', 'alpha')).toHaveLength(1)
    expect(plan.requiresConfirmation).toBe(true)
    expect(plan.diffs[0]?.kind).toBe('deleted-remote')
  })

  it('skips built-in and user-excluded plugins', () => {
    const plan = planBackup(input({
      config: { ...input().config, excludedPlugins: ['excluded'] },
      local: {
        official: plugin('official', { builtIn: true }),
        excluded: plugin('excluded', { syncable: false }),
      },
    }))
    expect(plan.actions).toHaveLength(0)
    expect(plan.warnings.join('\n')).toContain('excluded')
  })

  it('does not warn about internal/self plugins that are non-syncable by design', () => {
    const plan = planBackup(input({
      local: {
        internal: plugin('cordis:include', { syncable: false }),
        self: plugin('dsh-plugins-git-sync', { syncable: false }),
      },
    }))
    expect(plan.actions).toHaveLength(0)
    expect(plan.warnings).toEqual([])
  })
})

describe('restore plan', () => {
  it('installs a plugin that is missing locally', () => {
    const plan = planRestore(input({ remote: { alpha: plugin('alpha', { version: '1.2.3' }) } }))
    const install = actionsOf(plan, 'upgrade', 'alpha')[0]
    expect(install).toBeDefined()
    expect(install?.installSpec).toBe('alpha@1.0.0')
    expect(plan.requiresConfirmation).toBe(true)
  })

  it('upgrades and downgrades to the recorded version', () => {
    const upgrade = planRestore(input({
      local: { alpha: plugin('alpha', { version: '1.0.0' }) },
      remote: { alpha: plugin('alpha', { version: '2.0.0' }) },
    }))
    expect(actionsOf(upgrade, 'upgrade', 'alpha')).toHaveLength(1)
    const downgrade = planRestore(input({
      local: { alpha: plugin('alpha', { version: '2.0.0' }) },
      remote: { alpha: plugin('alpha', { version: '1.0.0' }) },
    }))
    expect(actionsOf(downgrade, 'downgrade', 'alpha')).toHaveLength(1)
    expect(downgrade.requiresConfirmation).toBe(true)
  })

  it('restores configuration after a version replacement even when its values are unchanged', () => {
    const plan = planRestore(input({
      local: { alpha: plugin('alpha', { version: '1.0.0', configs: { timeout: 10 } }) },
      remote: { alpha: plugin('alpha', { version: '2.0.0', configs: { timeout: 10 } }) },
    }))
    expect(actionsOf(plan, 'upgrade', 'alpha')).toHaveLength(1)
    expect(actionsOf(plan, 'restore-config', 'alpha')).toHaveLength(1)
  })

  it('restores configuration only when the local value was unchanged since the baseline', () => {
    const safe = planRestore(input({
      base: { alpha: plugin('alpha', { configs: { timeout: 10 } }) },
      local: { alpha: plugin('alpha', { configs: { timeout: 10 } }) },
      remote: { alpha: plugin('alpha', { configs: { timeout: 30 } }) },
    }))
    expect(actionsOf(safe, 'restore-config', 'alpha')).toHaveLength(1)
    expect(safe.conflicts).toHaveLength(0)

    const conflict = planRestore(input({
      base: { alpha: plugin('alpha', { configs: { timeout: 10 } }) },
      local: { alpha: plugin('alpha', { configs: { timeout: 20 } }) },
      remote: { alpha: plugin('alpha', { configs: { timeout: 30 } }) },
    }))
    expect(actionsOf(conflict, 'restore-config', 'alpha')).toHaveLength(0)
    expect(conflict.conflicts).toHaveLength(1)
    expect(conflict.conflicts[0]?.fields).toContain('config.timeout')
  })

  it('honours a remote conflict resolution', () => {
    const resolutions: ConflictResolution[] = [{ pluginId: 'alpha', choice: 'remote' }]
    const plan = planRestore(input({
      base: { alpha: plugin('alpha', { configs: { timeout: 10 } }) },
      local: { alpha: plugin('alpha', { configs: { timeout: 20 } }) },
      remote: { alpha: plugin('alpha', { configs: { timeout: 30 } }) },
      resolutions,
    }))
    expect(plan.conflicts).toHaveLength(0)
    expect(actionsOf(plan, 'restore-config', 'alpha')).toHaveLength(1)
  })

  it('never removes local plugins that are absent from the backup', () => {
    const plan = planRestore(input({
      local: { extra: plugin('extra') },
      remote: { alpha: plugin('alpha') },
    }))
    expect(plan.actions.some(action => action.kind === 'remove-local')).toBe(false)
    expect(plan.warnings.join('\n')).toContain('不会删除')
  })

  it('does not remove a plugin deleted remotely', () => {
    const plan = planRestore(input({
      base: { alpha: plugin('alpha') },
      local: { alpha: plugin('alpha') },
      remoteTombstones: new Set(['alpha']),
    }))
    expect(plan.actions).toHaveLength(0)
    expect(plan.warnings.join('\n')).toContain('远端已删除')
  })
})

describe('two-way sync plan', () => {
  it('pushes a local-only change', () => {
    const plan = planSync(input({
      base: { alpha: plugin('alpha', { version: '1.0.0' }) },
      local: { alpha: plugin('alpha', { version: '1.1.0' }) },
      remote: { alpha: plugin('alpha', { version: '1.0.0' }) },
    }))
    expect(actionsOf(plan, 'push-plugin', 'alpha')).toHaveLength(1)
    expect(plan.actions.some(action => action.kind === 'upgrade')).toBe(false)
    expect(plan.conflicts).toHaveLength(0)
  })

  it('applies a remote-only change locally', () => {
    const plan = planSync(input({
      base: { alpha: plugin('alpha', { version: '1.0.0' }) },
      local: { alpha: plugin('alpha', { version: '1.0.0' }) },
      remote: { alpha: plugin('alpha', { version: '1.1.0' }) },
    }))
    expect(actionsOf(plan, 'upgrade', 'alpha')).toHaveLength(1)
    expect(plan.actions.some(action => action.kind === 'push-plugin')).toBe(false)
  })

  it('attributes independent additions on two devices without overwriting', () => {
    const plan = planSync(input({
      local: { macPlugin: plugin('macPlugin') },
      remote: { winPlugin: plugin('winPlugin') },
    }))
    expect(actionsOf(plan, 'push-plugin', 'macPlugin')).toHaveLength(1)
    expect(actionsOf(plan, 'upgrade', 'winPlugin')).toHaveLength(1)
    expect(plan.conflicts).toHaveLength(0)
  })

  it('reports both-changed conflicts and resolves them explicitly', () => {
    const base = { alpha: plugin('alpha', { version: '1.0.0' }) }
    const local = { alpha: plugin('alpha', { version: '1.1.0' }) }
    const remote = { alpha: plugin('alpha', { version: '1.2.0' }) }
    const conflicted = planSync(input({ base, local, remote }))
    expect(conflicted.conflicts).toHaveLength(1)
    expect(conflicted.conflicts[0]?.fields).toContain('version')
    expect(conflicted.actions).toHaveLength(0)

    const preferLocal = planSync(input({ base, local, remote, resolutions: [{ pluginId: 'alpha', choice: 'local' }] }))
    expect(preferLocal.conflicts).toHaveLength(0)
    expect(actionsOf(preferLocal, 'push-plugin', 'alpha')).toHaveLength(1)

    const preferRemote = planSync(input({ base, local, remote, resolutions: [{ pluginId: 'alpha', choice: 'remote' }] }))
    expect(preferRemote.conflicts).toHaveLength(0)
    expect(actionsOf(preferRemote, 'upgrade', 'alpha')).toHaveLength(1)

    const skipped = planSync(input({ base, local, remote, resolutions: [{ pluginId: 'alpha', choice: 'skip' }] }))
    expect(skipped.conflicts).toHaveLength(1)
  })

  it('asks whether to delete the repository copy when the local plugin is gone', () => {
    const base = { alpha: plugin('alpha') }
    const local = {}
    const remote = { alpha: plugin('alpha') }
    const plan = planSync(input({ base, local, remote }))
    expect(actionsOf(plan, 'remove-remote')).toHaveLength(0)
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]?.reason).toBe('local-deleted')

    const deleteRemote = planSync(input({
      base,
      local,
      remote,
      resolutions: [{ pluginId: 'alpha', choice: 'local' }],
    }))
    expect(actionsOf(deleteRemote, 'remove-remote', 'alpha')).toHaveLength(1)
    expect(deleteRemote.requiresConfirmation).toBe(true)

    const restoreLocal = planSync(input({
      base,
      local,
      remote,
      resolutions: [{ pluginId: 'alpha', choice: 'remote' }],
    }))
    expect(actionsOf(restoreLocal, 'upgrade', 'alpha')).toHaveLength(1)
    expect(restoreLocal.conflicts).toHaveLength(0)
  })

  it('backs up a local plugin when the repository no longer has it', () => {
    const plan = planSync(input({
      base: { alpha: plugin('alpha') },
      local: { alpha: plugin('alpha') },
      remoteTombstones: new Set(['alpha']),
    }))
    expect(plan.conflicts).toHaveLength(0)
    expect(actionsOf(plan, 'push-plugin', 'alpha')).toHaveLength(1)
    expect(actionsOf(plan, 'remove-local')).toHaveLength(0)
  })

  it('backs up a local plugin even when both sides changed and the repository copy is gone', () => {
    const plan = planSync(input({
      base: { alpha: plugin('alpha', { version: '1.0.0' }) },
      local: { alpha: plugin('alpha', { version: '1.1.0' }) },
      remoteTombstones: new Set(['alpha']),
    }))
    expect(plan.conflicts).toHaveLength(0)
    expect(actionsOf(plan, 'push-plugin', 'alpha')).toHaveLength(1)
  })
  it('detects enablement changes in both directions', () => {
    const push = planSync(input({
      base: { alpha: plugin('alpha') },
      local: { alpha: plugin('alpha', { enabled: false }) },
      remote: { alpha: plugin('alpha') },
    }))
    expect(actionsOf(push, 'push-plugin', 'alpha')).toHaveLength(1)

    const pull = planSync(input({
      base: { alpha: plugin('alpha') },
      local: { alpha: plugin('alpha', { enabled: true }) },
      remote: { alpha: plugin('alpha', { enabled: false }) },
    }))
    expect(actionsOf(pull, 'disable', 'alpha')).toHaveLength(1)
  })

  it('converges when both sides made the same change', () => {
    const plan = planSync(input({
      base: { alpha: plugin('alpha', { version: '1.0.0' }) },
      local: { alpha: plugin('alpha', { version: '1.1.0' }) },
      remote: { alpha: plugin('alpha', { version: '1.1.0' }) },
    }))
    expect(plan.conflicts).toHaveLength(0)
    expect(plan.actions).toHaveLength(0)
  })

  it('skips plugins without a usable install source', () => {
    const plan = planSync(input({
      base: {},
      remote: { localdev: plugin('localdev', { installSpec: null, origin: 'local-path', pathOnly: true }) },
    }))
    expect(plan.actions).toHaveLength(0)
    expect(plan.warnings.join('\n')).toContain('缺少可安装来源')
  })

  it('keeps conflict details useful for the UI', () => {
    const base = { alpha: plugin('alpha', { version: '1.0.0', configs: { timeout: 10 } }) }
    const local = { alpha: plugin('alpha', { version: '1.1.0', configs: { timeout: 20 } }) }
    const remote = { alpha: plugin('alpha', { version: '1.2.0', configs: { timeout: 30 } }) }
    const plan = planSync(input({
      base,
      local,
      remote,
      remoteMeta: { alpha: { updatedBy: 'device-b', updatedAt: '2026-01-02T00:00:00.000Z', platform: 'win32' } },
    }))
    const conflict = plan.conflicts[0]
    expect(conflict?.pluginId).toBe('alpha')
    expect(conflict?.remoteDevice).toBe('device-b')
    expect(conflict?.localVersion).toBe('1.1.0')
    expect(conflict?.remoteVersion).toBe('1.2.0')
    expect(conflict?.localConfig).toEqual({ timeout: 20 })
    expect(conflict?.remoteConfig).toEqual({ timeout: 30 })
  })
})
