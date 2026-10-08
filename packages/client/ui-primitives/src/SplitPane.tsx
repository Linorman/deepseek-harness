// SplitPane: a primary pane and a resizable secondary pane separated by a
// focusable handle. The owner keeps the size; the handle reports changes.

import { useCallback, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react'
import clsx from 'clsx'
import css from './SplitPane.module.css'

/** Keyboard step for arrow keys; Shift multiplies it by four. */
const KEY_STEP = 16

/**
 * Clamp a proposed secondary-pane size.
 * @param size - proposed width in px.
 * @param min - minimum secondary width.
 * @param max - maximum secondary width.
 * @returns the clamped width.
 */
export function clampPaneSize(size: number, min: number, max: number): number {
  return Math.min(Math.max(size, min), Math.max(min, max))
}

/**
 * Render a horizontal split with the secondary pane on the right.
 * @param props.size - secondary pane width in px (owner state).
 * @param props.onResize - receives the clamped width during drag and key presses.
 * @param props.minSize - minimum secondary width.
 * @param props.maxSize - maximum secondary width.
 * @param props.handleLabel - accessible name of the separator.
 * @param props.primary - the main pane.
 * @param props.secondary - the resizable pane.
 * @returns the split container.
 */
export function SplitPane({
  size, onResize, minSize, maxSize, handleLabel, primary, secondary, className,
}: {
  size: number
  onResize: (size: number) => void
  minSize: number
  maxSize: number
  handleLabel: string
  primary: ReactNode
  secondary: ReactNode
  className?: string | undefined
}) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef({ x: 0, size: 0 })
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const resize = useRef(onResize)
  resize.current = onResize
  const bounds = useRef({ minSize, maxSize })
  bounds.current = { minSize, maxSize }

  const report = useCallback((next: number) => {
    resize.current(clampPaneSize(next, bounds.current.minSize, bounds.current.maxSize))
  }, [])

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    origin.current = { x: event.clientX, size }
    latest.current = event.clientX
    setDragging(true)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    latest.current = event.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      report(origin.current.size - (latest.current - origin.current.x))
    })
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    latest.current = event.clientX
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    report(origin.current.size - (latest.current - origin.current.x))
    setDragging(false)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP
    let next: number | undefined
    // The handle sits left of the secondary pane: moving it left widens the pane.
    if (event.key === 'ArrowLeft') next = size + step
    else if (event.key === 'ArrowRight') next = size - step
    else if (event.key === 'Home') next = maxSize
    else if (event.key === 'End') next = minSize
    if (next === undefined) return
    event.preventDefault()
    report(next)
  }

  return (
    <div
      className={clsx(css.split, className)}
      data-dragging={dragging || undefined}
      style={{ '--split-secondary': `${String(size)}px` } as CSSProperties}
    >
      <div className={css.primary}>{primary}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={handleLabel}
        aria-valuenow={Math.round(size)}
        aria-valuemin={minSize}
        aria-valuemax={maxSize}
        tabIndex={0}
        className={css.handle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
      />
      <div className={css.secondary}>{secondary}</div>
    </div>
  )
}
