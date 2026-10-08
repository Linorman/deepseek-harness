// Skeleton: placeholder bars while a bounded read is in flight.

import type { CSSProperties } from 'react'
import clsx from 'clsx'
import css from './Skeleton.module.css'

/**
 * Render placeholder lines. The group is one busy status for assistive
 * technology; the bars themselves are decorative.
 * @param props.lines - bar count (default 1).
 * @param props.label - accessible loading text.
 * @param props.width - CSS width of the last bar, to suggest ragged text.
 * @returns the skeleton group.
 */
export function Skeleton({ lines = 1, label, width = '60%', className }: {
  lines?: number
  label: string
  width?: string
  className?: string | undefined
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={clsx(css.group, className)}>
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className={css.bar}
          aria-hidden="true"
          style={index === lines - 1 && lines > 1 ? { '--skeleton-width': width } as CSSProperties : undefined}
        />
      ))}
    </div>
  )
}
