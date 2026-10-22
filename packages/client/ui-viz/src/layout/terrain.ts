/** Deterministic contour "terrain" for the ambient field: a pure function of a seed, never of data. */
import { seededRandom } from './random.ts'

/** Canvas and density for {@link terrainContours}. */
export interface TerrainOptions {
  /** Virtual canvas width; the SVG scales to its box with `slice`. */
  readonly width?: number
  /** Virtual canvas height. */
  readonly height?: number
  /** Number of contour summits. */
  readonly summits?: number
  /** Nested contour lines per summit. */
  readonly rings?: number
  /** Samples per contour line before smoothing. */
  readonly samples?: number
}

interface Sample { readonly x: number; readonly y: number }

const round = (value: number) => Math.round(value * 10) / 10

/**
 * Close a sampled loop with Catmull-Rom segments expressed as cubic Béziers.
 * @param points - At least three samples in drawing order.
 * @returns an SVG path `d` ending in `Z`.
 */
function closedCurve(points: readonly Sample[]): string {
  const at = (index: number): Sample => {
    const point = points[(index + points.length) % points.length]
    if (point === undefined) throw new Error('terrain: a contour needs at least one sample')
    return point
  }
  let d = `M${String(round(at(0).x))} ${String(round(at(0).y))}`
  for (let index = 0; index < points.length; index++) {
    const p0 = at(index - 1), p1 = at(index), p2 = at(index + 1), p3 = at(index + 2)
    d += `C${String(round(p1.x + (p2.x - p0.x) / 6))} ${String(round(p1.y + (p2.y - p0.y) / 6))} `
      + `${String(round(p2.x - (p3.x - p1.x) / 6))} ${String(round(p2.y - (p3.y - p1.y) / 6))} `
      + `${String(round(p2.x))} ${String(round(p2.y))}`
  }
  return `${d}Z`
}

/**
 * Generate nested, smoothly perturbed contour loops around a few seeded summits, like a topographic map.
 * Equal seeds always yield equal paths, so one run keeps one "terrain fingerprint" across visits.
 * @param seed - Opaque identity such as a run id; it only selects the shape.
 * @param options - Canvas size and density.
 * @returns SVG path strings in the virtual canvas coordinates.
 */
export function terrainContours(seed: string, options: TerrainOptions = {}): string[] {
  const { width = 1600, height = 1000, summits = 3, rings = 6, samples = 48 } = options
  const random = seededRandom(`terrain:${seed}`)
  const paths: string[] = []
  for (let summit = 0; summit < summits; summit++) {
    const cx = width * (0.12 + random() * 0.76), cy = height * (0.12 + random() * 0.76)
    const base = Math.min(width, height) * (0.05 + random() * 0.05)
    const step = base * (0.7 + random() * 0.4)
    const squash = 0.62 + random() * 0.5, turn = random() * Math.PI
    const harmonics = [2, 3, 5].map(order => ({ order, phase: random() * Math.PI * 2, amplitude: 0.06 + random() * 0.12 }))
    for (let ring = 0; ring < rings; ring++) {
      const radius = base + step * ring
      const points: Sample[] = []
      for (let index = 0; index < samples; index++) {
        const angle = (index / samples) * Math.PI * 2
        let scale = 1
        // Outer lines wander more than inner ones, as real contours loosen away from a summit.
        for (const wave of harmonics) scale += wave.amplitude * (1 + ring * 0.2) * Math.sin(wave.order * angle + wave.phase + ring * 0.4)
        const x = radius * scale * Math.cos(angle), y = radius * scale * Math.sin(angle) * squash
        points.push({ x: cx + x * Math.cos(turn) - y * Math.sin(turn), y: cy + x * Math.sin(turn) + y * Math.cos(turn) })
      }
      paths.push(closedCurve(points))
    }
  }
  return paths
}
