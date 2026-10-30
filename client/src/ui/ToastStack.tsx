/**
 * Floating, bottom-centre feedback stack for the settings page.
 *
 * Feedback used to render inside each card, so a save result appeared far
 * away from the action that caused it and moved the layout. The stack keeps
 * results visible over the page without shifting anything, and each toast can
 * be dismissed early; the page still owns the five-second timers.
 * @module ui/ToastStack
 */

import type { ReactElement } from 'react'
import type { Translate } from '../i18n'
import type { Feedback } from './controls'

/** One visible toast. */
export interface ToastItem {
  key: string
  tone: Feedback['tone']
  text: string
}

/** Props for {@link ToastStack}. */
export interface ToastStackProps {
  t: Translate
  items: readonly ToastItem[]
  onDismiss: (key: string) => void
}

/** Fixed, non-layout-shifting feedback stack. */
export function ToastStack(props: ToastStackProps): ReactElement | null {
  if (props.items.length === 0) return null
  return (
    <div className="dgs-toastStack" role="region" aria-label={props.t('notifications')}>
      {props.items.map(item => (
        <div
          key={item.key}
          className={item.tone === 'error' ? 'dgs-toast dgs-toastError' : 'dgs-toast dgs-toastSuccess'}
          role={item.tone === 'error' ? 'alert' : 'status'}
          aria-live={item.tone === 'error' ? 'assertive' : 'polite'}
        >
          <span className="dgs-toastText">{item.text}</span>
          <button
            type="button"
            className="dgs-toastClose"
            aria-label={props.t('close')}
            title={props.t('close')}
            onClick={() => props.onDismiss(item.key)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
