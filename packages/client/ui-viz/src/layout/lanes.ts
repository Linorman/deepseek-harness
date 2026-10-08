/**
 * Lane layout: one horizontal lane per participant or entity, with items
 * stacked into rows when their extents overlap. The caller injects the
 * time-to-x function, so Simulation callers keep exact decimal time in
 * BigInt space and never round it through `Number` before scaling.
 */
import { round2 } from './space.ts'

/** One item placed in a lane. `start`/`end` are opaque to the layout. */
export interface LaneItemInput<T> {
  readonly id: string
  readonly lane: string
  readonly start: T
  /** Absent for point markers. */
  readonly end?: T | undefined
}

/** Inputs to {@link layoutLanes}. */
export interface LaneLayoutInput<T> {
  readonly lanes: readonly { readonly id: string }[]
  readonly items: readonly LaneItemInput<T>[]
  /** Map a time value to an x coordinate. */
  readonly position: (value: T) => number
  /** Height of one stacked row inside a lane. */
  readonly rowHeight?: number
  /** Vertical gap between lanes. */
  readonly laneGap?: number
  /** Minimum width reserved for a point marker when stacking. */
  readonly markerWidth?: number
}

/** Placement of one lane. */
export interface LanePlacement {
  readonly y: number
  readonly height: number
  readonly rows: number
}

/** Placement of one item. */
export interface LaneItemPlacement {
  readonly x: number
  /** Equal to `x` for point markers. */
  readonly x2: number
  readonly y: number
  readonly row: number
  readonly lane: string
}

/** Result of {@link layoutLanes}. */
export interface LaneLayout {
  readonly lanes: ReadonlyMap<string, LanePlacement>
  readonly items: ReadonlyMap<string, LaneItemPlacement>
  readonly height: number
}

/**
 * Place items in lanes and stack overlaps into rows.
 * @param input - Lanes, items, and the injected position function.
 * @returns lane and item placements; items in unknown lanes are skipped.
 */
export function layoutLanes<T>(input: LaneLayoutInput<T>): LaneLayout {
  const { rowHeight = 22, laneGap = 8, markerWidth = 12 } = input
  const byLane = new Map<string, { id: string; x: number; x2: number }[]>(input.lanes.map(lane => [lane.id, []]))
  for (const item of input.items) {
    const bucket = byLane.get(item.lane)
    if (bucket === undefined) continue
    const x = input.position(item.start)
    const x2 = item.end === undefined ? x : Math.max(x, input.position(item.end))
    bucket.push({ id: item.id, x, x2 })
  }
  const lanes = new Map<string, LanePlacement>()
  const items = new Map<string, LaneItemPlacement>()
  let y = 0
  for (const lane of input.lanes) {
    const bucket = byLane.get(lane.id) ?? []
    bucket.sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))
    // Greedy interval packing: each item takes the first row whose last item ended before it starts.
    const rowEnds: number[] = []
    const rowOf = new Map<string, number>()
    for (const item of bucket) {
      const reach = Math.max(item.x2, item.x + markerWidth)
      let row = rowEnds.findIndex(end => end <= item.x)
      if (row === -1) { row = rowEnds.length; rowEnds.push(reach) } else rowEnds[row] = reach
      rowOf.set(item.id, row)
    }
    const rows = Math.max(1, rowEnds.length)
    const height = rows * rowHeight
    lanes.set(lane.id, { y: round2(y), height, rows })
    for (const item of bucket) {
      const row = rowOf.get(item.id) ?? 0
      items.set(item.id, { x: round2(item.x), x2: round2(item.x2), y: round2(y + row * rowHeight + rowHeight / 2), row, lane: lane.id })
    }
    y += height + laneGap
  }
  return { lanes, items, height: Math.max(0, y - laneGap) }
}

/** Fraction digits kept when scaling decimal time strings. */
const DECIMAL_SCALE = 6

/**
 * Parse a non-negative or negative decimal string to a fixed-point BigInt.
 * @param value - Decimal text such as `"9007199254740993.25"`.
 * @returns the value multiplied by 10^6, truncated.
 */
export function decimalToFixed(value: string): bigint {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim())
  if (match === null) throw new RangeError(`not a decimal time: ${value}`)
  const [, sign, whole = '0', fraction = ''] = match
  const scaled = BigInt(whole) * 10n ** BigInt(DECIMAL_SCALE) + BigInt((fraction + '0'.repeat(DECIMAL_SCALE)).slice(0, DECIMAL_SCALE))
  return sign === undefined ? scaled : -scaled
}

/**
 * Build a position function over exact decimal time.
 * @param origin - Window start as a decimal string.
 * @param end - Window end as a decimal string; must exceed `origin`.
 * @param width - Pixel width the window maps onto.
 * @returns a function mapping a decimal string to x, exact up to the pixel
 * even when the times exceed 2^53.
 */
export function decimalTimeScale(origin: string, end: string, width: number): (value: string) => number {
  const start = decimalToFixed(origin)
  const span = decimalToFixed(end) - start
  if (span <= 0n) return () => 0
  // Subtract in BigInt first; only the in-window offset, scaled to pixel
  // micro-units, crosses into Number.
  const micro = BigInt(Math.round(width * 1_000_000))
  return value => Number((decimalToFixed(value) - start) * micro / span) / 1_000_000
}
