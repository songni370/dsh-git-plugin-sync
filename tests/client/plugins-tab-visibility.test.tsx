// @vitest-environment jsdom
/**
 * Persisted "show the Backup tab on the Plugins page" switch.
 *
 * The setting is per browser profile (localStorage) and drives registration of
 * the `plugins.tab` row in the plugin's client fiber.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PLUGINS_TAB_STORAGE_KEY,
  pluginsTabEnabled,
  resetPluginsTabVisibility,
  setPluginsTabEnabled,
  subscribePluginsTab,
} from '../../client/src/plugins-tab-visibility'

beforeEach(() => {
  resetPluginsTabVisibility()
})

describe('plugins-tab visibility', () => {
  it('is shown by default', () => {
    expect(pluginsTabEnabled()).toBe(true)
    expect(localStorage.getItem(PLUGINS_TAB_STORAGE_KEY)).toBeNull()
  })

  it('persists a switch-off and reads it back', () => {
    setPluginsTabEnabled(false)
    expect(pluginsTabEnabled()).toBe(false)
    expect(localStorage.getItem(PLUGINS_TAB_STORAGE_KEY)).toBe('0')
    setPluginsTabEnabled(true)
    expect(localStorage.getItem(PLUGINS_TAB_STORAGE_KEY)).toBe('1')
  })

  it('notifies subscribers and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribePluginsTab(listener)
    setPluginsTabEnabled(false)
    expect(listener).toHaveBeenCalledTimes(1)
    // Same value is a no-op, not a second notification.
    setPluginsTabEnabled(false)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    setPluginsTabEnabled(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('falls back to shown when storage throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    try {
      expect(pluginsTabEnabled()).toBe(true)
      expect(() => setPluginsTabEnabled(false)).not.toThrow()
      expect(pluginsTabEnabled()).toBe(false)
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })
})
