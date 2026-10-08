// Sheet: a modal panel sliding in from the right edge, full screen on narrow
// viewports. The native modal dialog owns focus containment and inertness.

import { useModalDialog } from './useModalDialog.ts'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { IconCloseOutline16 } from './icons/index.tsx'
import css from './Sheet.module.css'

/**
 * Render a side sheet.
 * @param props.open - whether the sheet shows.
 * @param props.onClose - Escape, scrim press, or the close button.
 * @param props.title - heading and accessible name.
 * @param props.closeLabel - accessible close-button label.
 * @param props.actions - header controls before the close button.
 * @param props.footer - sticky footer actions.
 * @returns the portaled sheet, or null when closed.
 */
export function Sheet({ open, onClose, title, closeLabel, actions, footer, className, children }: {
  open: boolean
  onClose: () => void
  title: string
  closeLabel: string
  actions?: ReactNode
  footer?: ReactNode
  className?: string | undefined
  children?: ReactNode
}) {
  const dialogRef = useModalDialog(open)

  if (!open) return null
  return createPortal((
    <div className={css.root} role="presentation">
      <div className={css.scrim} aria-hidden="true" onClick={onClose} />
      <dialog
        ref={dialogRef}
        className={clsx(css.sheet, className)}
        aria-modal="true"
        aria-label={title}
        onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose() }}
      >
        <header className={css.header}>
          <h2 className={css.title}>{title}</h2>
          {actions}
          <button type="button" className={css.close} aria-label={closeLabel} onClick={onClose}>
            <IconCloseOutline16 size={16} />
          </button>
        </header>
        <div className={css.body}>{children}</div>
        {footer !== undefined && <footer className={css.footer}>{footer}</footer>}
      </dialog>
    </div>
  ), document.body)
}
