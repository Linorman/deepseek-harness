/** Shared geometry and graph input shapes for the layout functions. */

/** A point in layout space; the renderer maps it through its viewport. */
export interface Point {
  readonly x: number
  readonly y: number
}

/** A directed edge between two node ids; `from` is upstream of `to`. */
export interface LayoutEdge {
  readonly from: string
  readonly to: string
}

/** Axis-aligned extent of a layout, used to fit the viewport. */
export interface Bounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/**
 * Bounds of a set of points, padded on every side.
 * @param points - Positions to enclose; an empty set yields a zero box at the origin.
 * @param padding - Margin added on every side.
 * @returns the padded box.
 */
export function boundsOf(points: Iterable<Point>, padding = 0): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const { x, y } of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  if (minX === Infinity) return { minX: -padding, minY: -padding, maxX: padding, maxY: padding }
  return { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding }
}

/**
 * Round to two decimals so equal inputs yield byte-identical coordinates
 * across engines that differ in the last float bits of trigonometry.
 * @param value - Raw coordinate.
 * @returns the rounded coordinate, with negative zero normalized.
 */
export function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100
  return rounded === 0 ? 0 : rounded
}
