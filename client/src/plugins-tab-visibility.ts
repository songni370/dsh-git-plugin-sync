/**
 * Persisted visibility of the backup tab on the Plugins page.
 *
 * The Plugins page tab is optional (it is a second surface for the same data),
 * so the settings page offers a switch. The choice is stored per browser
 * profile under one localStorage key; the plugin's client fiber subscribes and
 * registers/unregisters the `plugins.tab` row accordingly.
 * @module plugins-tab-visibility
 */

/** localStorage key; keeps its own namespace. */
export const PLUGINS_TAB_STORAGE_KEY = 'dsh-plugins-git-sync.plugins-tab'

/** Pre-rename key; read once so an upgrade keeps the saved choice. */
const LEGACY_PLUGINS_TAB_STORAGE_KEY = 'dsh-git-plugin-sync.plugins-tab'

/** Default: the tab is shown, matching the shipped behaviour. */
const DEFAULT_ENABLED = true

type Listener = () => void
const listeners = new Set<Listener>()

/** Read without throwing when storage is disabled (private mode, policies). */
function readStored(): boolean {
  try {
    const value =
      localStorage.getItem(PLUGINS_TAB_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_PLUGINS_TAB_STORAGE_KEY)
    if (value === null) return DEFAULT_ENABLED
    return value !== '0'
  } catch {
    return DEFAULT_ENABLED
  }
}

let enabled = readStored()

/** Whether the Plugins-page backup tab should be registered. */
export function pluginsTabEnabled(): boolean {
  return enabled
}

/** Persist a new visibility choice and notify subscribers. */
export function setPluginsTabEnabled(next: boolean): void {
  if (next === enabled) return
  enabled = next
  try {
    localStorage.setItem(PLUGINS_TAB_STORAGE_KEY, next ? '1' : '0')
  } catch {
    // Storage is unavailable: the choice lasts for this page lifetime.
  }
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // A subscriber must never break the toggle.
    }
  }
}

/** Subscribe to visibility changes; returns the unsubscribe. */
export function subscribePluginsTab(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test-only reset (also clears stored state). */
export function resetPluginsTabVisibility(): void {
  enabled = DEFAULT_ENABLED
  try {
    localStorage.removeItem(PLUGINS_TAB_STORAGE_KEY)
  } catch {
    // Ignore unavailable storage.
  }
  for (const listener of [...listeners]) listener()
}
