/**
 * Confirmation dialog for destructive operations.
 *
 * Every destructive action routes through here with the previewed plan, so
 * the user confirms a concrete list of removals/overwrites instead of a bare
 * "are you sure". Dialog behaviour is hand-built to stay dependency-free:
 *  - `role="dialog"` + `aria-modal`, labelled by its title;
 *  - initial focus moves into the dialog and returns to the trigger on close;
 *  - Escape and overlay click close it (blocked while an operation runs);
 *  - Tab is trapped inside the dialog.
 * No `document.body` writes and no portal: the overlay is fixed-position, so
 * it covers the viewport from wherever the settings section renders.
 * @module ui/Modal
 */

import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode } from 'react'
import type { Translate } from '../i18n'
import { Button } from './controls'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Props for {@link Modal}. */
export interface ModalProps {
  t: Translate
  title: string
  description?: string
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
  children?: ReactNode
}

/** Modal dialog with focus trap and Escape handling. */
export function Modal(props: ModalProps): ReactElement {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    return () => {
      restoreRef.current?.focus()
    }
  }, [])

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.stopPropagation()
      if (props.busy !== true) props.onClose()
      return
    }
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (dialog === null) return
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      element => element.offsetParent !== null || element === document.activeElement,
    )
    if (focusable.length === 0) {
      event.preventDefault()
      dialog.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const current = document.activeElement
    if (event.shiftKey && (current === first || current === dialog)) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && current === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div
      className="dgs-modalOverlay"
      onKeyDown={onKeyDown}
      onMouseDown={event => {
        if (event.target === event.currentTarget && props.busy !== true) props.onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="dgs-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dgs-modal-title"
        aria-describedby={props.description === undefined ? undefined : 'dgs-modal-desc'}
        tabIndex={-1}
      >
        <div className="dgs-modalHead">
          <h2 className="dgs-modalTitle" id="dgs-modal-title">
            {props.title}
          </h2>
          {props.description === undefined ? null : (
            <p className="dgs-modalDesc" id="dgs-modal-desc">
              {props.description}
            </p>
          )}
        </div>
        {props.children === undefined ? null : <div className="dgs-modalBody">{props.children}</div>}
        <div className="dgs-modalFoot">
          <Button onClick={props.onClose} disabled={props.busy === true}>
            {props.t('cancel')}
          </Button>
          <Button variant="danger" onClick={props.onConfirm} disabled={props.busy === true}>
            {props.busy === true ? props.t('confirmRunning') : props.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
