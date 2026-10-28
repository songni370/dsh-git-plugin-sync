/**
 * `PluginInstaller` over the Host's plugin manager service.
 *
 * All install / remove / enable operations go through `ctx.pluginManager` —
 * the supported path that owns pnpm, profile files, activation and reload
 * semantics. This module never edits profile files and never shells out to a
 * package manager. A plugin's own source repository and the user's backup
 * repository stay separate: nothing here knows about the backup repository.
 * @module adapters/installer
 */

import type { DshBundleInfo, DshChangeResult, DshPluginInfo, DshPluginManager } from '../dsh.js'
import { SyncError, errorMessage } from '../core/errors.js'
import { redactText } from '../core/redact.js'
import type { InstallOutcome, PluginInstaller, SyncLogger, ToggleOutcome } from '../types.js'

/** Options for {@link createInstaller}. */
export interface InstallerOptions {
  /** The profile's plugin manager; absent on a composition without one. */
  pluginManager: DshPluginManager | undefined
  /** The profile this process runs in. Restores are limited to it. */
  activeProfile: string
  logger: SyncLogger
}

/** Normalize a plugin-manager change result into an install outcome. */
function toInstallOutcome(result: DshChangeResult, action: string): InstallOutcome {
  const failed = result.application === 'failed' || result.application === 'cancelled'
  const error = result.error === undefined ? undefined : redactText(`${result.error.code}: ${result.error.diagnostic ?? ''}`.trim())
  let message = `${action} ${result.target}: ${result.application}`
  if (result.application === 'restart-required') message = `${action} ${result.target}: 已安装，需要重启 DSH 后生效 / installed, restart DSH to activate`
  if (result.application === 'overridden') message = `${action} ${result.target}: 被更高优先级的配置覆盖 / overridden by a higher-priority layer`
  if (failed) message = `${action} ${result.target} 失败 / failed: ${error ?? 'unknown error'}`
  if (result.packageResult?.output !== undefined && failed) {
    const output = result.packageResult.output.trim()
    if (output !== '') message += `\n${redactText(output.slice(-1500))}`
  }
  return {
    ok: !failed,
    changed: result.changed,
    application: result.application,
    message,
    version: result.version,
    pendingBuilds: result.pendingBuilds,
    error: failed ? error : undefined,
  }
}

/** Normalize an enable/disable result. */
function toToggleOutcome(result: DshChangeResult, enabled: boolean): ToggleOutcome {
  const failed = result.application === 'failed' || result.application === 'cancelled'
  return {
    ok: !failed,
    changed: result.changed,
    application: result.application,
    message: failed
      ? `切换插件状态失败 / failed to ${enabled ? 'enable' : 'disable'}: ${redactText(result.error?.diagnostic ?? result.error?.code ?? 'unknown error')}`
      : `${enabled ? '已启用 / enabled' : '已禁用 / disabled'}`,
    error: failed ? redactText(result.error?.diagnostic ?? result.error?.code ?? 'unknown error') : undefined,
  }
}

/** Find a bundle row that names the module. */
function bundleForModule(bundles: readonly DshBundleInfo[], moduleName: string): DshBundleInfo | undefined {
  return bundles.find(bundle => bundle.name === moduleName || bundle.rows.some(row => row.moduleName === moduleName))
}

/** Create the installer. */
export function createInstaller(options: InstallerOptions): PluginInstaller {
  const requireManager = (): DshPluginManager => {
    const manager = options.pluginManager
    if (manager === undefined || typeof manager.installBundle !== 'function') {
      throw new SyncError(
        'unsupported',
        '当前 DSH 环境不提供插件管理服务，无法安装或移除插件 / the DSH plugin manager service is unavailable',
      )
    }
    return manager
  }

  const requireActiveProfile = (profile: string): void => {
    if (profile !== options.activeProfile) {
      throw new SyncError(
        'unsupported',
        `只能修改当前 Profile（${options.activeProfile}）的插件；请切换到 ${profile} 后重试 / only the active profile can be modified`,
      )
    }
  }

  return {
    async install(spec, request): Promise<InstallOutcome> {
      const manager = requireManager()
      requireActiveProfile(request.profile)
      if (spec.trim() === '') throw new SyncError('install-failed', '安装规格为空 / empty install spec')
      options.logger.info(`安装插件 / installing plugin: ${spec}`)
      try {
        const result = await manager.installBundle(spec.trim(), { saveExact: true, enabled: true })
        const outcome = toInstallOutcome(result, '安装 / install')
        if (outcome.pendingBuilds !== undefined && outcome.pendingBuilds.length > 0) {
          outcome.message += `\n需要在插件管理器中批准构建脚本 / build scripts need approval: ${outcome.pendingBuilds.join(', ')}`
        }
        return outcome
      } catch (error) {
        return {
          ok: false,
          changed: false,
          application: 'failed',
          message: `安装 ${spec} 失败 / failed to install: ${redactText(errorMessage(error))}`,
          error: redactText(errorMessage(error)),
        }
      }
    },

    async setEnabled(moduleName, enabled, request): Promise<ToggleOutcome> {
      const manager = requireManager()
      requireActiveProfile(request.profile)
      try {
        const [bundles, plugins] = await Promise.all([manager.listBundles(), manager.listPlugins()])
        const bundle = bundleForModule(bundles, moduleName)
        if (bundle !== undefined) {
          if (bundle.enabled === enabled) {
            return { ok: true, changed: false, application: 'applied', message: '状态已一致 / already in the requested state' }
          }
          const result = await manager.setBundleEnabled(bundle.name, enabled)
          return toToggleOutcome(result, enabled)
        }
        const entry = plugins.find(plugin => plugin.moduleName === moduleName)
        if (entry === undefined) {
          return {
            ok: false,
            changed: false,
            application: 'failed',
            message: `找不到已安装的插件 ${moduleName} / plugin is not installed`,
            error: 'not installed',
          }
        }
        if (entry.enabled === enabled) {
          return { ok: true, changed: false, application: 'applied', message: '状态已一致 / already in the requested state' }
        }
        const result = await manager.setPluginEnabled(entry.entryId, enabled)
        return toToggleOutcome(result, enabled)
      } catch (error) {
        return {
          ok: false,
          changed: false,
          application: 'failed',
          message: `切换 ${moduleName} 状态失败 / failed to toggle: ${redactText(errorMessage(error))}`,
          error: redactText(errorMessage(error)),
        }
      }
    },

    async remove(moduleName, request): Promise<InstallOutcome> {
      const manager = requireManager()
      requireActiveProfile(request.profile)
      try {
        const bundles = await manager.listBundles()
        const bundle = bundles.find(item => item.name === moduleName)
        if (bundle === undefined) {
          return {
            ok: false,
            changed: false,
            application: 'failed',
            message: `${moduleName} 不是可移除的插件包 / not a removable bundle`,
            error: 'not a bundle',
          }
        }
        if (!bundle.removable) {
          return {
            ok: false,
            changed: false,
            application: 'failed',
            message: `${moduleName} 不可自动移除 / bundle cannot be removed automatically`,
            error: bundle.readOnlyReason ?? 'not removable',
          }
        }
        options.logger.warn(`移除插件 / removing plugin: ${moduleName}`)
        const result = await manager.removeBundle(moduleName)
        return toInstallOutcome(result, '移除 / remove')
      } catch (error) {
        return {
          ok: false,
          changed: false,
          application: 'failed',
          message: `移除 ${moduleName} 失败 / failed to remove: ${redactText(errorMessage(error))}`,
          error: redactText(errorMessage(error)),
        }
      }
    },

    async latestVersion(moduleName, signal): Promise<string | null> {
      const manager = options.pluginManager
      if (manager === undefined || typeof manager.inspect !== 'function') return null
      try {
        const inspection = await manager.inspect(moduleName, undefined, signal)
        if (inspection.status !== 'accepted') return null
        return inspection.version ?? null
      } catch {
        return null
      }
    },
  }
}

/** List the plugins currently installed in the active profile. */
export async function listInstalledPlugins(manager: DshPluginManager | undefined): Promise<DshPluginInfo[]> {
  if (manager === undefined) return []
  try {
    return await manager.listPlugins()
  } catch {
    return []
  }
}
