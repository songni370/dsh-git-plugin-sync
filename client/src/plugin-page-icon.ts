/**
 * Enlarge this plugin's icon on the host's Plugins page.
 *
 * The host renders package icons at a fixed 48×48 (`object-fit: contain`), so
 * the asset cannot make itself bigger. This module marks only the card whose
 * text names this plugin and upsizes its icon wrapper to 64×64. It is scoped to
 * the 48px card artwork; row icons stay at the host's 40px size.
 *
 * The DOM is owned by the host, so everything is conservative: match by the
 * card's own text, tag only the direct icon wrapper, and remove the marker and
 * style when the fiber disposes.
 * @module plugin-page-icon
 */

/** Attribute set on the icon wrapper of this plugin's plugin-manager card. */
export const PLUGIN_ICON_WRAPPER_ATTR = 'data-dsh-plugin-backup-icon'

/** Host card artwork size, as rendered by `img[width]`. */
const HOST_CARD_ICON_SIZE = '48'

/** Text that identifies our card; includes both locales and the package id. */
const MATCH_TEXTS = ['插件备份', 'Plugin Backup', 'dsh-plugins-git-sync'] as const

/** The slice of the client context this module needs. */
export interface PluginPageIconContext {
  effect(callback: () => unknown, label?: string): void
}

/** Stylesheet for the marked wrapper and its image. */
export function pluginPageIconCss(): string {
  return [
    `[${PLUGIN_ICON_WRAPPER_ATTR}] {`,
    '  width: 64px !important;',
    '  height: 64px !important;',
    '}',
    `[${PLUGIN_ICON_WRAPPER_ATTR}] > img {`,
    '  width: 60px !important;',
    '  height: 60px !important;',
    '  max-width: none !important;',
    '  flex: none;',
    '}',
  ].join('\n')
}

/** Whether a host card containing this text belongs to this plugin. */
export function isOwnPluginCardText(text: string | null | undefined): boolean {
  const value = String(text ?? '')
  return MATCH_TEXTS.some(needle => value.includes(needle))
}

/** Install the scoped Plugins-page icon enlargement. */
export function installPluginPageIcon(ctx: PluginPageIconContext): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-plugins-git-sync'
    style.dataset.pluginCss = 'dsh-plugins-git-sync/plugin-page-icon'
    style.textContent = pluginPageIconCss()
    document.head.appendChild(style)

    let disposed = false
    let scheduled = false

    const sync = (): void => {
      scheduled = false
      if (disposed) return
      for (const image of document.querySelectorAll<HTMLImageElement>('img')) {
        const wrapper = image.parentElement
        if (wrapper === null) continue
        // Only the 48px card artwork; row icons are 40px and stay unchanged.
        if (image.getAttribute('width') !== HOST_CARD_ICON_SIZE) {
          if (wrapper.hasAttribute(PLUGIN_ICON_WRAPPER_ATTR)) wrapper.removeAttribute(PLUGIN_ICON_WRAPPER_ATTR)
          continue
        }
        // Stop within the card head (wrapper → head → card). Walking further
        // would reach a page container whose text includes every plugin title.
        let node: Element | null = wrapper.parentElement
        let own = false
        for (let depth = 0; node !== null && depth < 2; depth += 1) {
          if (node === document.body || node === document.documentElement) break
          if (isOwnPluginCardText(node.textContent)) {
            own = true
            break
          }
          node = node.parentElement
        }
        if (own) wrapper.setAttribute(PLUGIN_ICON_WRAPPER_ATTR, '')
        else if (wrapper.hasAttribute(PLUGIN_ICON_WRAPPER_ATTR)) wrapper.removeAttribute(PLUGIN_ICON_WRAPPER_ATTR)
      }
    }

    const schedule = (): void => {
      if (scheduled || disposed) return
      scheduled = true
      queueMicrotask(sync)
    }

    sync()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      disposed = true
      observer.disconnect()
      for (const node of document.querySelectorAll(`[${PLUGIN_ICON_WRAPPER_ATTR}]`)) {
        node.removeAttribute(PLUGIN_ICON_WRAPPER_ATTR)
      }
      style.remove()
    }
  }, 'dsh-plugins-git-sync: plugin page icon')
}
