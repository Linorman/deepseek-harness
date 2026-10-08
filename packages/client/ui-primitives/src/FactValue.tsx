// FactValue: one value together with how it is known. Each state has its own
// shape and words, so an unavailable count never reads as zero and a stale
// observation never reads as an error.

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import css from './FactValue.module.css'

/**
 * How a value is known:
 * - `observed`: read now from the source of truth.
 * - `unavailable`: no observation exists; `reason` says why. Never a zero.
 * - `unknown`: an outcome that cannot be determined (for example an external
 *   operation whose result was lost); only query or exact retry can resolve it.
 * - `stale`: a retained observation that may be out of date.
 * - `withheld`: exists but the reader lacks `permission`.
 * - `truncated`: a display label cut to fit; `full` is the complete text.
 */
export type Fact =
  | { state: 'observed'; value: ReactNode }
  | { state: 'unavailable'; reason: string }
  | { state: 'unknown'; reason?: string | undefined }
  | { state: 'stale'; value: ReactNode; observedAt?: string | undefined }
  | { state: 'withheld'; permission: string }
  | { state: 'truncated'; value: string; full: string }

/** Owner-supplied words for each state. */
export interface FactLabels {
  unavailable: string
  unknown: string
  stale: string
  withheld: string
  truncated: string
  expand: string
}

/** Chinese product copy; owners pass English or more specific words as needed. */
export const DEFAULT_FACT_LABELS: FactLabels = {
  unavailable: '不可用',
  unknown: '结果未知',
  stale: '可能已过期',
  withheld: '需要权限',
  truncated: '已截断',
  expand: '展开全文',
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" className={css.icon}>
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 3.6V6l1.6 1" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" className={css.icon}>
      <rect x="2.5" y="5.2" width="7" height="5" rx="1" fill="currentColor" />
      <path d="M4 5.2V4a2 2 0 0 1 4 0v1.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

/**
 * Render a fact in its knowledge state.
 * @param props.fact - the value and how it is known.
 * @param props.labels - state words (default Chinese product copy).
 * @returns an inline element whose accessible text states the knowledge state.
 */
export function FactValue({ fact, labels = DEFAULT_FACT_LABELS, className }: {
  fact: Fact
  labels?: FactLabels
  className?: string | undefined
}) {
  const [expanded, setExpanded] = useState(false)
  const fullId = useId()
  switch (fact.state) {
    case 'observed':
      return <span className={clsx(css.fact, className)} data-fact="observed">{fact.value}</span>
    case 'unavailable':
      return (
        <span className={clsx(css.fact, css.unavailable, className)} data-fact="unavailable" title={fact.reason}>
          <span aria-hidden="true">—</span>
          <span className={css.srOnly}>{`${labels.unavailable}：${fact.reason}`}</span>
        </span>
      )
    case 'unknown':
      return (
        <span className={clsx(css.fact, css.unknown, className)} data-fact="unknown" title={fact.reason}>
          <span aria-hidden="true">?</span>
          <span className={css.srOnly}>{fact.reason === undefined ? labels.unknown : `${labels.unknown}：${fact.reason}`}</span>
        </span>
      )
    case 'stale':
      return (
        <span
          className={clsx(css.fact, css.stale, className)}
          data-fact="stale"
          title={fact.observedAt === undefined ? labels.stale : `${labels.stale} · ${fact.observedAt}`}
        >
          <ClockIcon />
          <span>{fact.value}</span>
          <span className={css.srOnly}>{`（${labels.stale}）`}</span>
        </span>
      )
    case 'withheld':
      return (
        <span className={clsx(css.fact, css.withheld, className)} data-fact="withheld" title={fact.permission}>
          <LockIcon />
          <span>{`${labels.withheld}：${fact.permission}`}</span>
        </span>
      )
    case 'truncated':
      return (
        <span className={clsx(css.fact, css.truncated, className)} data-fact="truncated" data-expanded={expanded || undefined}>
          <span id={fullId} className={css.text}>{expanded ? fact.full : fact.value}</span>
          {!expanded && <span className={css.srOnly}>{`（${labels.truncated}）`}</span>}
          {!expanded && (
            <button type="button" className={css.expand} aria-controls={fullId} onClick={() => { setExpanded(true) }}>
              {labels.expand}
            </button>
          )}
        </span>
      )
    default: {
      const unreachable: never = fact
      throw new Error(`unknown fact state ${JSON.stringify(unreachable)}`)
    }
  }
}
