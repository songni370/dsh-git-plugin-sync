/**
 * Small presentation helpers shared by the sections: dates, commits, and
 * dictionary-backed labels for Host enum values.
 * @module format
 */

import type { Translate } from './i18n'
import type { PlanActionKind } from '../../src/types'

/** Render an ISO timestamp in the browser's locale; `fallback` when absent. */
export function formatDateTime(iso: string | null | undefined, fallback: string): string {
  if (iso === null || iso === undefined || iso === '') return fallback
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  try {
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/** Short form of a Git commit for tables and badges. */
export function shortCommit(commit: string | null | undefined): string {
  if (commit === null || commit === undefined || commit === '') return ''
  return commit.slice(0, 8)
}

/**
 * Localized operation name for `backup` / `restore` / `sync` / `rollback` /
 * any future value: an unknown operation falls through to the raw string
 * rather than a bare dictionary key.
 */
export function operationLabel(t: Translate, operation: string): string {
  const key = `op_${operation}`
  const text = t(key)
  return text === key ? operation : text
}

/** Localized result label; anything unrecognized shows as-is. */
export function resultLabel(t: Translate, result: string | null | undefined): string {
  if (result === null || result === undefined || result === '') return t('unknown')
  const normalized = result.toLowerCase()
  if (normalized === 'ok' || normalized === 'success' || normalized === 'succeeded') return t('resultOk')
  if (normalized === 'failed' || normalized === 'error' || normalized === 'failure') return t('resultFailed')
  return result
}

/** Whether a commit trailer result value means success. */
export function isGoodResult(result: string | null | undefined): boolean {
  if (result === null || result === undefined) return false
  const normalized = result.toLowerCase()
  return normalized === 'ok' || normalized === 'success' || normalized === 'succeeded'
}

const PLAN_KIND_KEYS: Record<PlanActionKind, string> = {
  install: 'planKindInstall',
  upgrade: 'planKindUpgrade',
  downgrade: 'planKindDowngrade',
  enable: 'planKindEnable',
  disable: 'planKindDisable',
  'restore-config': 'planKindRestoreConfig',
  'remove-local': 'planKindRemoveLocal',
  'push-plugin': 'planKindPushPlugin',
  'push-config': 'planKindPushConfig',
  'remove-remote': 'planKindRemoveRemote',
}

/** Localized label for one plan step kind. */
export function planKindLabel(t: Translate, kind: PlanActionKind): string {
  return t(PLAN_KIND_KEYS[kind] ?? 'planKindInstall')
}
