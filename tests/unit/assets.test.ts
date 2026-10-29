/**
 * Packaging constraints for the two designed icons.
 *
 * The host reads the plugin-page icon from the package manifest and rejects
 * anything over 256 KiB; the settings-nav glyph is embedded as a PNG mask in
 * the client bundle.
 */

import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SETTINGS_ICON_MASK_URL } from '../../client/src/settings-icon-data.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('designed icons', () => {
  it('ships a plugin-page icon the host accepts', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      icon?: string
      exports?: Record<string, string>
    }
    expect(pkg.icon).toBe('./assets/icon.png')
    expect(pkg.exports?.['./icon']).toBe('./assets/icon.png')
    const file = resolve(root, pkg.icon ?? '')
    const bytes = readFileSync(file)
    expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE)
    expect(statSync(file).size).toBeLessThanOrEqual(256 * 1024)
  })

  it('embeds the settings nav glyph as a PNG mask', () => {
    expect(SETTINGS_ICON_MASK_URL.startsWith('data:image/png;base64,')).toBe(true)
    const encoded = SETTINGS_ICON_MASK_URL.slice('data:image/png;base64,'.length)
    const bytes = Buffer.from(encoded, 'base64')
    expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE)
    expect(bytes.length).toBeLessThan(64 * 1024)
  })
})
