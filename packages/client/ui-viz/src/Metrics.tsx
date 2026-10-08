/** Numeric primitives: rolling digits, a segmented progress ring, and a sparkline. */
import type { CSSProperties, ReactNode } from 'react'
import type { VizState } from './interaction/describe.ts'
import css from './Metrics.module.css'

/**
 * Rolling-digit number. Digits roll (L2) only when `live` is set, so a value
 * that arrives with hydration, reload, or navigation renders settled.
 * @param props.text - The formatted value; digits roll, every other character is static.
 * @param props.label - Accessible value; defaults to `text`.
 * @param props.live - True when the latest change was observed live.
 * @param props.className - Typography owner's class.
 * @returns an inline element whose accessible name is the full value.
 */
export function Odometer({ text, label, live = false, className }: {
  text: string
  label?: string | undefined
  live?: boolean | undefined
  className?: string | undefined
}) {
  // The digits are real text; a distinct accessible value (such as an
  // uncompacted count) turns the number into one labelled image.
  return <span className={className === undefined ? css.odometer : `${css.odometer} ${className}`}
    {...label === undefined || label === text ? {} : { role: 'img', 'aria-label': label }}
    data-live={live || undefined} data-motion-tier={live ? 'L2' : undefined}>
    {/* Keys count from the right so the ones digit keeps its reel as the number grows. */}
    {Array.from(text).map((char, index, chars) => {
      const key = chars.length - index
      return /\d/.test(char)
        ? <span key={key} className={css.digit} style={{ '--digit': char } as CSSProperties}><span>{char}</span></span>
        : <span key={`l${String(key)}`} className={css.literal}>{char}</span>
    })}
  </span>
}

/** One segment of a progress ring. */
export interface RingSegment {
  readonly state: VizState
  readonly value: number
  readonly label: string
}

/**
 * Segmented progress ring: each segment's arc is its share of `total`.
 * Segment changes animate (L2) only when `live` is set.
 * @param props.segments - Ordered segments; zero values draw nothing.
 * @param props.total - Denominator; when larger than the segment sum the rest stays track.
 * @param props.size - Edge length in pixels.
 * @param props.thickness - Stroke width in pixels.
 * @param props.label - Accessible summary of the ring.
 * @param props.children - Centered content such as a count.
 * @returns the ring with its content.
 */
export function RadialProgress({ segments, total, size = 64, thickness = 6, label, live = false, children }: {
  segments: readonly RingSegment[]
  total: number
  size?: number
  thickness?: number
  label: string
  live?: boolean | undefined
  children?: ReactNode
}) {
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  let start = 0
  return <span className={css.radial} role="img" aria-label={label} data-live={live || undefined}
    data-motion-tier={live ? 'L2' : undefined} style={{ width: size, height: size }}>
    <svg width={size} height={size} viewBox={`0 0 ${String(size)} ${String(size)}`} aria-hidden="true">
      <circle className={css.radialTrack} cx={size / 2} cy={size / 2} r={radius} strokeWidth={thickness} />
      {segments.map((segment) => {
        const share = total <= 0 ? 0 : Math.max(0, segment.value) / total
        const rotation = start * 360
        start += share
        return <circle key={segment.state} className={css.radialSegment} data-state={segment.state}
          cx={size / 2} cy={size / 2} r={radius} strokeWidth={thickness}
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - share)}
          style={{ transform: `rotate(${String(rotation)}deg)` }}>
          <title>{`${segment.label} ${String(segment.value)}`}</title>
        </circle>
      })}
    </svg>
    {children !== undefined && <span className={css.radialCenter}>{children}</span>}
  </span>
}

/**
 * Sparkline over a series. Absent data renders a dashed empty slot, never a
 * flat line, so an unavailable series is not read as zero.
 * @param props.values - Series values, oldest first; undefined when unavailable.
 * @param props.label - Accessible summary.
 * @returns an SVG sparkline or the unavailable slot.
 */
export function Sparkline({ values, width = 96, height = 24, label }: {
  values: readonly number[] | undefined
  width?: number
  height?: number
  label: string
}) {
  if (values === undefined || values.length === 0) {
    return <span className={css.sparkUnavailable} role="img" aria-label={label} style={{ width, height }} />
  }
  const max = Math.max(...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  const step = values.length === 1 ? 0 : width / (values.length - 1)
  const points = values.map((value, index) => [index * step, height - 2 - (value - min) / span * (height - 4)] as const)
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const last = points.at(-1) ?? [0, height]
  return <svg className={css.sparkline} width={width} height={height} viewBox={`0 0 ${String(width)} ${String(height)}`} role="img" aria-label={label}>
    <polygon className={css.sparkArea} points={`0,${String(height)} ${line} ${last[0].toFixed(1)},${String(height)}`} />
    <polyline points={line} />
    <circle className={css.sparkDot} cx={last[0]} cy={last[1]} r={2} />
  </svg>
}
