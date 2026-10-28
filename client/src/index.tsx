/**
 * Browser half of dsh-git-plugin-sync.
 *
 * Registers one native settings section, "DSH 插件 Git 同步 / DSH Plugin Git
 * Sync", in the Harness Settings dialog. Built by `scripts/build-client.mjs`
 * into the `window.__ModuleLoader__.load({ id, factory(require) { ... } })`
 * artifact at `lib/client.js`; the only externals are the module table's react
 * entries, so the page shares the host's React instance and no second copy.
 *
 * The factory must be side-effect free. Everything it registers is owned by
 * this plugin's client fiber:
 *  - the zh/en dictionaries through `ctx.effect` (a locale switch re-renders
 *    the nav label and every string without a reload);
 *  - the settings section through `ctx.slots.inject`, which waits for the
 *    shell to declare the slot.
 *
 * A failure in either registration is caught and logged with the package
 * prefix: one guest plugin must never blank the whole settings dialog.
 * @module index
 */

import { Component } from 'react'
import type { ErrorInfo, ReactElement, ReactNode } from 'react'
import { createTranslate, en, fallbackTranslate, NS, zh } from './i18n'
import { installSettingsNavIcon } from './nav-icon'
import { clickBackupTab } from './plugins-tab'
import type { Translate, Vars } from './i18n'
import { Page } from './ui/Page'

/** The subset of the client locale service this plugin touches. */
interface LocaleService {
  /**
   * Register a namespace's dictionaries. The two-argument object form is the
   * contract the current host serves; the disposer it returns is owned by
   * `ctx.effect`.
   */
  register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): unknown
  /** Bind a translator for one namespace. MUST be called as a method. */
  bind(namespace: string): (key: string, vars?: Vars) => string
}

/** Registration metadata the settings slot understands. */
interface SectionRegistration {
  name: 'settings.section' | 'plugins.tab'
  id: string
  order: number
  label: () => string
  locale: string
  inject: () => { t: Translate }
}

/** The subset of the client slots service this plugin touches. */
interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(registration: SectionRegistration, component: (props: SectionProps) => ReactElement): unknown
}

/** The client cordis context shape this plugin relies on (structural typing
 * keeps this external package free of monorepo-internal type dependencies). */
interface ClientContext {
  effect(callback: () => unknown, label?: string): void
  locale: LocaleService
  slots: SlotsService
  /** Injected for the shell's benefit; the page follows the host palette via
   * `--dsw-alias-*` CSS variables and needs no theme API. */
  theme: unknown
  /** Optional service injection (Cordis); absence just disables the shortcut. */
  inject?(deps: readonly string[], callback: (scoped: { layout?: LayoutService }) => void): unknown
}

/** Props the slot registration injects into the section component. */
interface SectionProps {
  t?: Translate
  /** Present on the settings page only: jump to the backup tab on the Plugins page. */
  openInPlugins?: () => void
}

/** The slice of the client layout service used to open the Plugins page. */
interface LayoutService {
  selectPanel(id: string | null): void
}

/** Props of the crash boundary below. */
interface BoundaryProps {
  t: Translate
  children: ReactNode
}

/** Boundary state. */
interface BoundaryState {
  failed: boolean
}

/**
 * Last-resort render guard.
 *
 * The host runs a client plugin's factory on the boot path with nothing
 * between it and the shell, and a render throw inside the settings section
 * would blank the dialog. `apply` catches registration failures; this catches
 * render failures and shows one styled line instead, so the rest of Settings
 * stays usable.
 */
class SectionBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.warn('[dsh-git-plugin-sync] settings section crashed:', error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: '8px 12px',
            fontSize: 12,
            lineHeight: '18px',
            color: 'var(--dsw-alias-state-error-primary, #dc2626)',
            border: '1px solid var(--dsw-alias-state-error-primary, #dc2626)',
            borderRadius: 8,
          }}
        >
          {this.props.t('sectionCrash')}
        </p>
      )
    }
    return this.props.children
  }
}

/** Cordis plugin name (equals the package name). */
export const name = 'dsh-git-plugin-sync'

/** Services required before the browser half mounts. */
export const inject = ['slots', 'locale', 'theme']

/** Cordis plugin entry point. */
export function apply(ctx: ClientContext): void {
  let t: Translate
  try {
    // Dictionaries first: the section label and every string resolve through
    // this namespace. `ctx.effect` owns the returned disposers.
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-git-plugin-sync: locale dictionaries')
    // Method call on purpose: the host's bind reads its own receiver.
    const bound = ctx.locale.bind(NS)
    t = createTranslate(bound)
  } catch (error) {
    // A moved locale contract costs the localized copy, not the page: keep
    // going with our own dictionaries and the browser language.
    console.warn('[dsh-git-plugin-sync] locale service unavailable, using browser language:', error)
    t = fallbackTranslate()
  }

  // Optional: the layout service opens the main column on the Plugins page.
  let layout: LayoutService | undefined
  try {
    ctx.inject?.(['layout'], scoped => {
      layout = scoped.layout
    })
  } catch (error) {
    console.warn('[dsh-git-plugin-sync] layout service unavailable; the Plugins-page shortcut is disabled:', error)
  }

  /** Open the Plugins page and select this plugin's backup tab there. */
  const openInPlugins = (): void => {
    try {
      layout?.selectPanel('plugins')
    } catch (error) {
      console.warn('[dsh-git-plugin-sync] could not switch to the Plugins page:', error)
    }
    clickBackupTab(() => t('tab'))
  }

  try {
    const Section = (props: SectionProps): ReactElement => {
      const translate = props.t ?? t
      return (
        <SectionBoundary t={translate}>
          <Page t={translate} openInPlugins={props.openInPlugins} />
        </SectionBoundary>
      )
    }

    // The shell draws only its own gear for a third-party section; claim our
    // nav row and paint the sync glyph (same label thunk as the registration).
    installSettingsNavIcon(ctx, () => t('nav'))

    // The settings page appears once the shell declares the slot. The label
    // is a thunk so a locale switch re-claims the nav row.
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: 'git-sync',
          order: 42,
          label: () => t('nav'),
          locale: NS,
          inject: () => ({ t, openInPlugins }),
        },
        Section,
      ),
    )
  } catch (error) {
    // Contain anything the host's bootstrap throws: the rest of the app,
    // settings included, keeps working without this section.
    console.warn(
      '[dsh-git-plugin-sync] settings section registration failed; the rest of Settings is unaffected:',
      error,
    )
  }

  try {
    // Plugins page tab: same page, one click from 已安装 (order 1 = after the
    // host's own 发现 tab). The page hands `t` down; no shortcut button here.
    const Tab = (props: SectionProps): ReactElement => {
      const translate = props.t ?? t
      return (
        <SectionBoundary t={translate}>
          <Page t={translate} />
        </SectionBoundary>
      )
    }
    ctx.slots.inject('plugins.tab', () =>
      ctx.slots.register(
        {
          name: 'plugins.tab',
          id: 'git-sync-backup',
          order: 1,
          label: () => t('tab'),
          locale: NS,
          inject: () => ({ t }),
        },
        Tab,
      ),
    )
  } catch (error) {
    // Contain anything the host's bootstrap throws: the rest of the app,
    // settings included, keeps working without this section.
    console.warn(
      '[dsh-git-plugin-sync] settings section registration failed; the rest of Settings is unaffected:',
      error,
    )
  }
}
