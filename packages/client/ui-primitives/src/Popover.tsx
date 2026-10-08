// Popover: a non-modal floating panel anchored to its trigger. Escape and an
// outside press close it, and focus returns to the trigger.

import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { useAnchoredPosition } from './useAnchoredPosition.ts'
import css from './Popover.module.css'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Render the floating panel for an owner-controlled trigger.
 * @param props.open - whether the panel shows.
 * @param props.onClose - Escape, outside press, or programmatic close.
 * @param props.anchorRef - the trigger element; focus returns here on close.
 * @param props.label - accessible name of the panel.
 * @returns the portaled panel, or null when closed.
 */
export function Popover({ open, onClose, anchorRef, label, className, children }: {
  open: boolean
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
  label: string
  className?: string | undefined
  children?: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const position = useAnchoredPosition({ open, anchorRef, panelRef, gap: 6, margin: 8 })
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    if (!open) return
    // open renders the panel unconditionally; its ref attaches before this effect.
    const panel = panelRef.current as HTMLDivElement
    const anchor = anchorRef.current
    const first = panel.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel).focus()
    return () => {
      if (anchor?.isConnected === true) anchor.focus()
    }
  }, [open, anchorRef])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) === true || anchorRef.current?.contains(target) === true) return
      onCloseRef.current()
    }
    document.addEventListener('pointerdown', onPointer)
    return () => { document.removeEventListener('pointerdown', onPointer) }
  }, [open, anchorRef])

  if (!open) return null
  return createPortal((
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={clsx(css.popover, className)}
      style={position ?? { visibility: 'hidden' }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
      }}
    >
      {children}
    </div>
  ), anchorRef.current?.closest('dialog[open]') ?? document.body)
}
