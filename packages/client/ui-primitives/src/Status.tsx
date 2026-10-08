// Agent-state glyphs and badges. Every state pairs a color, a shape, and
// (in the badge) words, so state never rides on color alone.

import clsx from 'clsx'
import css from './Status.module.css'

/** The seven agent states the theme colors (`--clocky-status-<state>-*`). */
export type AgentStatus = 'running' | 'waiting' | 'needs-you' | 'blocked' | 'done' | 'failed' | 'idle'

/** Every status, in attention order (what needs a person first). */
export const AGENT_STATUSES: readonly AgentStatus[] = ['needs-you', 'failed', 'blocked', 'running', 'waiting', 'idle', 'done']

function GlyphShape({ status }: { status: AgentStatus }) {
  switch (status) {
    case 'running':
      return (
        <>
          <circle cx="8" cy="8" r="5.5" className={css.track} />
          <path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5" className={css.arc} />
        </>
      )
    case 'waiting':
      return (
        <>
          <circle cx="8" cy="8" r="5.5" className={css.ring} />
          <path d="M8 5v3.2l2 1.3" className={css.stroke} />
        </>
      )
    case 'needs-you':
      return (
        <>
          <circle cx="8" cy="8" r="6" className={css.fill} />
          <path d="M8 4.8v3.6" className={css.inverse} />
          <circle cx="8" cy="11" r="0.9" className={css.inverseFill} />
        </>
      )
    case 'blocked':
      return (
        <>
          <circle cx="8" cy="8" r="5.5" className={css.ring} />
          <path d="M5 8h6" className={css.stroke} />
        </>
      )
    case 'done':
      return (
        <>
          <circle cx="8" cy="8" r="6" className={css.fill} />
          <path d="M5.4 8.2l1.8 1.8 3.4-3.6" className={css.inverse} />
        </>
      )
    case 'failed':
      return (
        <>
          <circle cx="8" cy="8" r="6" className={css.fill} />
          <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" className={css.inverse} />
        </>
      )
    case 'idle':
      return <circle cx="8" cy="8" r="4" className={css.ring} />
    default: {
      const unreachable: never = status
      throw new Error(`unknown agent status ${String(unreachable)}`)
    }
  }
}

/**
 * Render the shape for one agent state at 16px. The running arc rotates on
 * the spin token, so reduced motion leaves it static.
 * @param props.status - agent state.
 * @param props.label - accessible name; omit when adjacent text already names the state.
 * @returns an inline SVG.
 */
export function StatusGlyph({ status, label, className }: {
  status: AgentStatus
  label?: string | undefined
  className?: string | undefined
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      className={clsx(css.glyph, className)}
      data-status={status}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      focusable="false"
    >
      <GlyphShape status={status} />
    </svg>
  )
}

/**
 * Render a status pill: glyph plus words in the state's colors.
 * @param props.status - agent state.
 * @param props.children - the human-readable state name.
 * @param props.title - optional detail, such as the protocol term behind the label.
 * @returns the badge element.
 */
export function StatusBadge({ status, children, title, className }: {
  status: AgentStatus
  children: string
  title?: string | undefined
  className?: string | undefined
}) {
  return (
    <span className={clsx(css.badge, className)} data-status={status} title={title}>
      <StatusGlyph status={status} />
      <span>{children}</span>
    </span>
  )
}
