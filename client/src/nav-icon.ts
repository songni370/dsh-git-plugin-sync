/**
 * The settings-navigation glyph for the "插件备份 / Plugin Backup" row.
 *
 * `settings.section` registration only projects `id` / `order` / `label` (the
 * shell falls back to its own gear for every other id), so a third-party
 * section has no icon to pass. This module claims its own nav row once the
 * dialog is mounted and swaps the fallback gear for a sync glyph — narrow
 * scope: only the row whose visible text equals this plugin's own localized
 * label, and everything (style tag, marker) is owned by `ctx.effect`.
 *
 * Delete this module the day `settings.section` grows an `icon` field.
 * @module nav-icon
 */

/** Attribute that marks the one nav row this plugin owns. */
export const NAV_ICON_MARKER = 'data-dsh-git-sync-nav-icon'

/** Nav rows are rendered as buttons inside the settings dialog's `nav`. */
export const NAV_ROW_SELECTOR = '[role="dialog"] nav button'

/** Glyph box, matching the shell's 16 px nav icons. */
export const NAV_ICON_SIZE = 16

/**
 * Standalone monochrome SVG used as a CSS mask.
 *
 * Painted pure black on purpose: a mask reads alpha only, and the visible
 * colour comes from `background-color: currentColor` (theme-aware in both
 * light and dark modes). Shape: two circular arrows — backup/sync.
 */
export function navIconMaskSvg(): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"'
    + ' stroke="#000" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>'
    + '<path d="M21 3v5h-5"/>'
    + '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>'
    + '<path d="M8 16H3v5"/>'
    + '</svg>'
}

/** Data-URL form of the mask glyph. */
export function navIconMaskUrl(svg: string = navIconMaskSvg()): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** Whether a nav row's text is this plugin's own label. */
export function isOwnNavRow(rowText: string | null | undefined, wantedLabel: string | null | undefined): boolean {
  const wanted = String(wantedLabel ?? '').trim()
  if (wanted === '') return false
  return String(rowText ?? '').trim() === wanted
}

/** Stylesheet that hides the shell's gear and paints the mask. */
export function navIconCss(maskUrl: string): string {
  return [
    `[${NAV_ICON_MARKER}] > svg { display: none; }`,
    `[${NAV_ICON_MARKER}]::before {`,
    `  content: '';`,
    `  flex: none;`,
    `  width: ${NAV_ICON_SIZE}px;`,
    `  height: ${NAV_ICON_SIZE}px;`,
    `  background-color: currentColor;`,
    `  -webkit-mask-image: url("${maskUrl}");`,
    `  mask-image: url("${maskUrl}");`,
    `  -webkit-mask-repeat: no-repeat;`,
    `  mask-repeat: no-repeat;`,
    `  -webkit-mask-position: center;`,
    `  mask-position: center;`,
    `  -webkit-mask-size: ${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px;`,
    `  mask-size: ${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px;`,
    `}`,
  ].join('\n')
}

/** The slice of the client context this module needs. */
export interface NavIconContext {
  effect(callback: () => unknown, label?: string): void
}

/**
 * Install the nav glyph.
 * @param ctx - client context, for effect ownership.
 * @param resolveLabel - current localized section label, re-read on every
 *   mutation so a locale switch re-claims the row.
 */
export function installSettingsNavIcon(ctx: NavIconContext, resolveLabel: () => string): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-git-plugin-sync'
    style.dataset.pluginCss = 'dsh-git-plugin-sync/settings-nav-icon'
    style.textContent = navIconCss(navIconMaskUrl())
    document.head.appendChild(style)

    let disposed = false
    let scheduled = false

    const sync = (): void => {
      scheduled = false
      if (disposed) return
      const wanted = resolveLabel()
      for (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) {
        if (isOwnNavRow(row.textContent, wanted)) row.setAttribute(NAV_ICON_MARKER, '')
        else row.removeAttribute(NAV_ICON_MARKER)
      }
    }

    // Coalesce DOM bursts into one sync, landing before the next paint so the
    // gear never flashes where our glyph belongs.
    const schedule = (): void => {
      if (scheduled || disposed) return
      scheduled = true
      queueMicrotask(sync)
    }

    sync()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    return () => {
      disposed = true
      observer.disconnect()
      for (const row of document.querySelectorAll(`[${NAV_ICON_MARKER}]`)) row.removeAttribute(NAV_ICON_MARKER)
      style.remove()
    }
  }, 'dsh-git-plugin-sync: settings nav icon')
}
