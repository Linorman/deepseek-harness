/**
 * One rendering of absent or restricted values. Withheld, redacted, not applicable, unknown, unsupported and read failure
 * are distinct and never shown as zero or a dash; restricted text is never derived or summarized here. The component is a
 * pure function of its props, so a revoked grant (the owner stops passing the value) removes the content immediately.
 */
import type { ReactNode } from 'react'
import type { WorldT } from './WorldFacts.tsx'
import type { Key } from './locales.ts'
import css from './World.module.css'

/** Why a value is not shown. */
export type DisclosureState = 'withheld' | 'redacted' | 'not-applicable' | 'unknown' | 'unsupported' | 'read-failed'

/**
 * @param props.state - Disclosure state, or `allowed` with children.
 * @param props.compact - Inline cell form; the explanation moves to the title.
 * @param props.children - Allowed content.
 * @returns the content, or the state with its explanation.
 */
export function DisclosedValue({ state, compact = false, label, role, children, t }: {
  state: DisclosureState | 'allowed'
  compact?: boolean
  /** Surface-specific short wording; the explanation still comes from the state. */
  label?: Key | undefined
  /** Live-region role where the value replaces content in place. */
  role?: 'status' | undefined
  children?: ReactNode
  t: WorldT
}) {
  if (state === 'allowed') return <>{children}</>
  const restricted = state === 'withheld' || state === 'redacted'
  const Tag = compact ? 'span' : 'p'
  return <Tag className={compact ? css.lockedValue : css.gate} data-disclosure={state} role={role}
    title={compact ? t(`disclosure.${state}.why`) : undefined}>
    {restricted && <LockGlyph />}<span>{t(label ?? `disclosure.${state}`)}</span>
    {!compact && <small className={css.muted}> {t(`disclosure.${state}.why`)}</small>}
  </Tag>
}

function LockGlyph() {
  return <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" className={css.badgeIcon}>
    <rect x="2.5" y="5.2" width="7" height="5" rx="1" fill="currentColor" />
    <path d="M4 5.2V4a2 2 0 0 1 4 0v1.2" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
}
