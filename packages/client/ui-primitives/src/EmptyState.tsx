// EmptyState: an icon, one sentence, and at most one action.

import type { ReactNode } from 'react'
import clsx from 'clsx'
import css from './EmptyState.module.css'

/**
 * Render an empty state.
 * @param props.icon - decorative 16–24px icon.
 * @param props.title - the one sentence that says what is empty and why.
 * @param props.action - the single next step, usually a Button.
 * @param props.compact - inline row form for small containers.
 * @returns the empty-state element (a status region, so assistive technology hears changes).
 */
export function EmptyState({ icon, title, action, compact = false, className }: {
  icon?: ReactNode
  title: ReactNode
  action?: ReactNode
  compact?: boolean
  className?: string | undefined
}) {
  return (
    <div role="status" className={clsx(css.empty, compact && css.compact, className)}>
      {icon !== undefined && <span className={css.icon} aria-hidden="true">{icon}</span>}
      <p className={css.title}>{title}</p>
      {action !== undefined && <div className={css.action}>{action}</div>}
    </div>
  )
}
