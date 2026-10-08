/** Edge geometry shared by the SVG path, the canvas stroke, and particle flights. */
import type { Point } from './layout/space.ts'

/** A quadratic curve between two points. */
export interface Curve {
  readonly from: Point
  readonly control: Point
  readonly to: Point
}

/**
 * Curve bending to one side of the straight segment.
 * @param from - Start point.
 * @param to - End point.
 * @param curvature - Offset of the control point as a share of the segment length.
 * @param inset - Distance trimmed from both ends so arrows stop at node rims.
 * @returns the curve.
 */
export function edgeCurve(from: Point, to: Point, curvature = 0.12, inset = 0): Curve {
  const dx = to.x - from.x, dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length, uy = dy / length
  const trim = Math.min(inset, length / 3)
  const a = { x: from.x + ux * trim, y: from.y + uy * trim }
  const b = { x: to.x - ux * trim, y: to.y - uy * trim }
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
  return { from: a, to: b, control: { x: mx - uy * length * curvature, y: my + ux * length * curvature } }
}

/**
 * SVG path data for a curve.
 * @param curve - The curve.
 * @returns a `M … Q …` path string.
 */
export function curvePath(curve: Curve): string {
  const f = (value: number) => value.toFixed(1)
  return `M${f(curve.from.x)} ${f(curve.from.y)} Q${f(curve.control.x)} ${f(curve.control.y)} ${f(curve.to.x)} ${f(curve.to.y)}`
}

/**
 * Point at parameter `t` along a curve.
 * @param curve - The curve.
 * @param t - Parameter in [0, 1].
 * @returns the point.
 */
export function pointOnCurve(curve: Curve, t: number): Point {
  const u = 1 - t
  return {
    x: u * u * curve.from.x + 2 * u * t * curve.control.x + t * t * curve.to.x,
    y: u * u * curve.from.y + 2 * u * t * curve.control.y + t * t * curve.to.y,
  }
}

/**
 * Sample a curve into evenly spaced points for WAAPI `translate` keyframes.
 * @param curve - The curve.
 * @param steps - Number of segments; the result has `steps + 1` points.
 * @returns sampled points from start to end.
 */
export function sampleCurve(curve: Curve, steps = 12): Point[] {
  return Array.from({ length: steps + 1 }, (_, index) => pointOnCurve(curve, index / steps))
}
