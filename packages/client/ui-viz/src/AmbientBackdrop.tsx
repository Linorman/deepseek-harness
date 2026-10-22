/**
 * L0 ambient field behind a workspace, tinted by the active mode. Simulation adds a terrain layer: a seeded
 * contour map of the shown run (a neutral star map without one) that drifts very slowly, and one expanding
 * ring per live observation the workspace signals. Everything here is decorative chrome and never carries state.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { terrainContours } from './layout/terrain.ts'
import { seededRandom } from './layout/random.ts'
import { AMBIENT_SIGNAL, useAmbientMotion } from './motion/ambient.ts'
import type { AmbientSignal, AmbientTone } from './motion/ambient.ts'
import { prefersReducedMotion, useDocumentVisible, usePrefersReducedMotion } from './motion/hooks.ts'
import { tokenDuration } from './motion/tokens.ts'
import css from './Backdrop.module.css'

/** Pulses closer together than this merge into the ring already in flight. */
const PULSE_MERGE_MS = 1200
/** Input-free time after which the field freezes completely. */
const IDLE_FREEZE_MS = 60_000
const VIEW = { width: 1600, height: 1000 } as const

/**
 * Whether the viewer has not touched pointer, wheel or keyboard for a while.
 * @param ms - Inactivity threshold.
 * @returns true after `ms` without input; any input clears it.
 */
function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let timer = window.setTimeout(() => { setIdle(true) }, ms)
    let last = 0
    const wake = () => {
      const now = Date.now()
      // Rescheduling at most once a second keeps a moving pointer from churning timers.
      if (now - last < 1000) return
      last = now
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { setIdle(true) }, ms)
    }
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const
    for (const name of events) window.addEventListener(name, wake, { passive: true })
    return () => { window.clearTimeout(timer); for (const name of events) window.removeEventListener(name, wake) }
  }, [ms])
  return idle
}

/** Static neutral star map for a stage that shows no particular run: points and sparse nearest-neighbour links. */
function StarMap() {
  const { stars, links } = useMemo(() => {
    const random = seededRandom('clocky-star-map')
    const stars = Array.from({ length: 42 }, () => ({ x: random() * VIEW.width, y: random() * VIEW.height, r: 0.8 + random() * 1.6 }))
    const links = stars.flatMap((star, index) => {
      let best: { x: number; y: number } | undefined, distance = Infinity
      for (const [other, candidate] of stars.entries()) {
        if (other === index) continue
        const d = Math.hypot(candidate.x - star.x, candidate.y - star.y)
        if (d < distance) { distance = d; best = candidate }
      }
      return best !== undefined && distance < 220 ? [{ from: star, to: best }] : []
    })
    return { stars, links }
  }, [])
  return <g data-variant="stars">
    {links.map((link, index) => <line key={index} x1={link.from.x} y1={link.from.y} x2={link.to.x} y2={link.to.y} />)}
    {stars.map((star, index) => <circle key={index} cx={star.x} cy={star.y} r={star.r} />)}
  </g>
}

/**
 * Render the ambient field. It listens on its stage (the positioned parent) for {@link AMBIENT_SIGNAL} events.
 * Motion stops while the page is hidden, after a minute without input, under reduced motion and when the viewer
 * turns ambient motion off; high-contrast and print hide the terrain entirely.
 * @param props.mode - Active workspace; selects the identity ramp and whether the terrain layer exists.
 * @returns a decorative layer that fills its positioned parent.
 */
export function AmbientBackdrop({ mode }: { mode: 'team' | 'simulation' }) {
  const root = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLSpanElement>(null)
  const lastPulse = useRef(0)
  const [scene, setScene] = useState<{ seed: string | undefined; tone: AmbientTone }>({ seed: undefined, tone: 'muted' })
  const [motion] = useAmbientMotion()
  const visible = useDocumentVisible()
  const reduced = usePrefersReducedMotion()
  const idle = useIdle(IDLE_FREEZE_MS)
  const still = motion === 'off' || reduced || !visible || idle
  const stillRef = useRef(still)
  stillRef.current = still
  useEffect(() => {
    const stage = root.current?.parentElement
    if (mode !== 'simulation' || stage === null || stage === undefined) return
    const listen = (event: Event) => {
      const signal = (event as CustomEvent<AmbientSignal>).detail
      switch (signal.kind) {
        case 'scene': setScene({ seed: signal.seed, tone: signal.tone }); return
        case 'pulse': {
          const element = ring.current, box = root.current?.getBoundingClientRect()
          const now = Date.now()
          if (element === null || box === undefined || stillRef.current || prefersReducedMotion()
            || typeof element.animate !== 'function' || now - lastPulse.current < PULSE_MERGE_MS) return
          lastPulse.current = now
          element.style.left = `${String(signal.x - box.left)}px`
          element.style.top = `${String(signal.y - box.top)}px`
          element.animate([
            { opacity: 0, transform: 'translate(-50%, -50%) scale(0.12)' },
            { opacity: 1, transform: 'translate(-50%, -50%) scale(0.5)', offset: 0.18 },
            { opacity: 0, transform: 'translate(-50%, -50%) scale(1.6)' },
          ], { duration: tokenDuration(element, '--clocky-duration-celebrate', 1200) * 1.6, easing: 'cubic-bezier(0, 0, 0, 1)' })
          return
        }
        default: { const unreachable: never = signal; void unreachable }
      }
    }
    stage.addEventListener(AMBIENT_SIGNAL, listen)
    return () => { stage.removeEventListener(AMBIENT_SIGNAL, listen) }
  }, [mode])
  const contours = useMemo(() => scene.seed === undefined ? undefined : terrainContours(scene.seed, VIEW), [scene.seed])
  return <div ref={root} className={css.backdrop} data-mode={mode} data-tone={scene.tone} data-still={still || undefined}
    data-motion-tier="L0" aria-hidden="true">
    <span className={css.glow} />
    <span className={css.glow} />
    {mode === 'simulation' && <>
      {/* Keyed by seed so a new run's terrain cross-fades in instead of morphing from the previous one. */}
      <svg key={scene.seed ?? 'stars'} className={css.terrain} viewBox={`0 0 ${String(VIEW.width)} ${String(VIEW.height)}`}
        preserveAspectRatio="xMidYMid slice" data-variant={contours === undefined ? 'stars' : 'terrain'}>
        {contours === undefined ? <StarMap /> : <g>{contours.map((d, index) => <path key={index} d={d} />)}</g>}
      </svg>
      <span ref={ring} className={css.ring} />
    </>}
  </div>
}
