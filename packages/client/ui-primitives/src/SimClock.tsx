// SimClock: an exact simulated time. Values are arbitrary-precision decimal
// strings and are never converted through Number.

import clsx from 'clsx'
import css from './SimClock.module.css'

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/

/**
 * Group the integer digits of a decimal string. Invalid input is returned
 * unchanged so a malformed value is visible rather than silently rewritten.
 * @param value - decimal string such as `9007199254740993` or `-1240.5`.
 * @param separator - group separator (default `,`).
 * @returns the grouped string.
 */
export function groupDecimal(value: string, separator = ','): string {
  const match = DECIMAL.exec(value)
  if (match === null) return value
  const [, sign = '', integer = '', fraction] = match
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, separator)
  return `${sign}${grouped}${fraction === undefined ? '' : `.${fraction}`}`
}

/**
 * Render simulated time with grouped digits and a localized unit; the exact
 * value and the source unit stay in the tooltip. The hourglass icon marks
 * simulated time so it never mixes with wall-clock time.
 * @param props.value - exact decimal string.
 * @param props.unit - source unit, for example `minute`.
 * @param props.unitLabel - localized unit, for example `分钟`; defaults to `unit`.
 * @param props.label - accessible prefix, for example `模拟时间`.
 * @returns the clock element.
 */
export function SimClock({ value, unit, unitLabel, label, className }: {
  value: string
  unit: string
  unitLabel?: string | undefined
  label: string
  className?: string | undefined
}) {
  const shown = `${groupDecimal(value)} ${unitLabel ?? unit}`
  return (
    <span className={clsx(css.clock, className)} data-clock="simulated" title={`${value} ${unit}`} aria-label={`${label} ${shown}`} role="img">
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" className={css.icon}>
        <path d="M3 1.5h6M3 10.5h6M3.5 1.5c0 2.4 5 2.6 5 4.5s-5 2.1-5 4.5M8.5 1.5c0 2.4-5 2.6-5 4.5s5 2.1 5 4.5"
          fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
      <span aria-hidden="true">{shown}</span>
    </span>
  )
}
