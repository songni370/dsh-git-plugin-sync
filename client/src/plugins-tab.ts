/**
 * Switch the main column to the Plugins page and select this plugin's backup
 * tab there.
 *
 * The Plugins page owns its tab selection and exposes no "select tab" API, so
 * the settings-page button navigates through the layout service and then
 * clicks the tab whose visible text is this plugin's own tab label. Retries
 * cover the page's first render, and the label is resolved per attempt so a
 * locale switch is honoured.
 * @module plugins-tab
 */

/** Default number of attempts (100 ms apart) to find the mounted tab. */
const DEFAULT_ATTEMPTS = 12

/** Label thunk and timing, injectable for tests. */
export interface ClickTabOptions {
  attempts?: number
  delayMs?: number
  schedule?: (callback: () => void, delayMs: number) => void
}

/**
 * Click the Plugins-page tab whose visible text equals the current label.
 *
 * Matching is exact after trimming: the settings page's own "备份到 Git"
 * action and the "插件备份" nav label therefore can never be mistaken for the
 * tab. A miss after the last attempt is silent — the page is already open and
 * the user can click the tab themselves.
 */
export function clickBackupTab(resolveLabel: () => string, options: ClickTabOptions = {}): void {
  if (typeof document === 'undefined') return
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS
  const delayMs = options.delayMs ?? 100
  const schedule = options.schedule ?? ((callback, delay) => { window.setTimeout(callback, delay) })
  let remaining = Math.max(1, attempts)
  const attempt = (): void => {
    remaining -= 1
    const wanted = resolveLabel().trim()
    if (wanted !== '') {
      const tab = Array.from(document.querySelectorAll('button'))
        .find(button => (button.textContent ?? '').trim() === wanted)
      if (tab !== undefined) {
        tab.click()
        return
      }
    }
    if (remaining > 0) schedule(attempt, delayMs)
  }
  attempt()
}
