/**
 * Spatial keyboard traversal and pointer hit-testing over laid-out marks.
 * Both renderers (SVG and canvas) use these same functions, so a mark that
 * a click reaches is the mark arrow keys reach.
 */
import type { Point } from '../layout/space.ts'

/** A focusable mark at a layout position. */
export interface SpatialMark extends Point {
  readonly id: string
  /** Hit radius in layout units. */
  readonly radius?: number | undefined
}

/** Arrow-key direction. */
export type SpatialDirection = 'up' | 'down' | 'left' | 'right'

/** Arrow keys mapped to traversal directions; other keys map to undefined. */
export const ARROW_DIRECTIONS: Readonly<Record<string, SpatialDirection | undefined>> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
}

/**
 * Pick the mark an arrow key moves to: the nearest mark inside the
 * direction's 90° cone, where off-axis distance costs twice as much as
 * on-axis distance so movement follows rows and columns.
 * @param marks - Every focusable mark.
 * @param currentId - The mark that holds focus.
 * @param direction - Arrow-key direction.
 * @returns the next mark id, or undefined when nothing lies in that direction.
 */
export function nextSpatialFocus(marks: readonly SpatialMark[], currentId: string, direction: SpatialDirection): string | undefined {
  const current = marks.find(mark => mark.id === currentId)
  if (current === undefined) return marks[0]?.id
  let best: string | undefined
  let bestScore = Infinity
  for (const mark of marks) {
    if (mark.id === currentId) continue
    const dx = mark.x - current.x
    const dy = mark.y - current.y
    const along = direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy
    const across = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx)
    if (along <= 0 || across > along) continue
    const score = along + across * 2
    if (score < bestScore || score === bestScore && best !== undefined && mark.id < best) { bestScore = score; best = mark.id }
  }
  return best
}

/**
 * Reading order for Home/End and the list view: top to bottom, then left to right.
 * @param marks - Marks to order.
 * @returns ids in reading order.
 */
export function readingOrder(marks: readonly SpatialMark[]): string[] {
  return [...marks].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1)).map(mark => mark.id)
}

/**
 * Find the mark under a layout-space point.
 * @param marks - Candidate marks.
 * @param point - Pointer position already mapped into layout space.
 * @param slop - Extra tolerance added to every radius.
 * @returns the closest mark whose radius covers the point, if any.
 */
export function hitTest(marks: readonly SpatialMark[], point: Point, slop = 4): string | undefined {
  let best: string | undefined
  let bestDistance = Infinity
  for (const mark of marks) {
    const distance = Math.hypot(mark.x - point.x, mark.y - point.y)
    if (distance <= (mark.radius ?? 16) + slop && distance < bestDistance) { best = mark.id; bestDistance = distance }
  }
  return best
}

/** Viewport transform: layout point × scale + translation = screen point. */
export interface ViewTransform {
  readonly x: number
  readonly y: number
  readonly k: number
}

/**
 * Map a screen point (relative to the visualization element) into layout space.
 * @param transform - Current viewport transform.
 * @param screen - Point in element pixels.
 * @returns the corresponding layout point.
 */
export function toLayout(transform: ViewTransform, screen: Point): Point {
  return { x: (screen.x - transform.x) / transform.k, y: (screen.y - transform.y) / transform.k }
}

/**
 * Transform that fits layout bounds into a viewport with padding.
 * @param bounds - Layout extent.
 * @param width - Viewport width in pixels.
 * @param height - Viewport height in pixels.
 * @param maxScale - Upper bound so tiny graphs do not blow up.
 * @returns a centered transform.
 */
export function fitTransform(bounds: { minX: number; minY: number; maxX: number; maxY: number }, width: number, height: number,
  maxScale = 1.25): ViewTransform {
  const spanX = Math.max(1, bounds.maxX - bounds.minX)
  const spanY = Math.max(1, bounds.maxY - bounds.minY)
  const k = Math.min(maxScale, Math.max(0.1, Math.min(width / spanX, height / spanY)))
  return { k, x: width / 2 - (bounds.minX + spanX / 2) * k, y: height / 2 - (bounds.minY + spanY / 2) * k }
}
