/** Launch-screen workspace tile with a living mini visualization. */
import { useRef, type ReactNode } from 'react'
import { hashSeed } from './layout/random.ts'
import type { VizState } from './interaction/describe.ts'
import { useAnimationActive } from './motion/hooks.ts'
import { usePointerLight } from './motion/pointer-light.ts'
import { PointerLight } from './PointerLight.tsx'
import css from './ModeTile.module.css'

/** One figure on a tile. `tone` colors the value with a status role. */
export interface ModeTileStat {
  readonly id: string
  readonly value: string
  readonly label: string
  readonly tone?: 'running' | 'needs-you' | undefined
}

/**
 * Render a workspace tile. The mode tints only chrome; every state mark in
 * the preview uses a status role.
 * @param props.mode - Workspace identity.
 * @param props.eyebrow - Short mode tag.
 * @param props.title - Workspace name.
 * @param props.tagline - One-line purpose.
 * @param props.stats - Loaded figures; the owner states what they count.
 * @param props.recent - Latest item line, or an empty-state hint.
 * @param props.preview - Mini visualization, normally {@link SwarmGlyph} or {@link ConstellationGlyph}.
 * @param props.label - Accessible name of the whole tile.
 * @param props.onOpen - Open the workspace.
 * @param props.transitionName - Shared `view-transition-name` that morphs the tile into the workspace it opens.
 * @returns a button.
 */
export function ModeTile({ mode, eyebrow, title, tagline, stats, recent, preview, label, onOpen, transitionName }: {
  mode: 'team' | 'simulation'
  eyebrow: string
  title: string
  tagline: string
  stats: readonly ModeTileStat[]
  recent: string
  preview: ReactNode
  label: string
  onOpen: () => void
  transitionName?: string | undefined
}) {
  const tile = useRef<HTMLButtonElement>(null)
  usePointerLight(tile, { tilt: 3, lift: 3 })
  // Hover quickens the preview's orbit; leaving eases it back. Playback rate
  // changes keep the current angle, so nothing jumps.
  const orbitRate = (rate: number) => {
    for (const animation of tile.current?.getAnimations({ subtree: true }) ?? []) {
      if ('animationName' in animation && String(animation.animationName).includes('spin')) animation.updatePlaybackRate(rate)
    }
  }
  return <button ref={tile} type="button" className={css.tile} data-mode={mode} data-mode-card={mode} aria-label={label} onClick={onOpen}
    onPointerEnter={(event) => { if (event.pointerType === 'mouse') orbitRate(4) }} onPointerLeave={() => { orbitRate(1) }}
    style={transitionName === undefined ? undefined : { viewTransitionName: transitionName }}>
    <PointerLight />
    <span className={css.text}>
      <span className={css.eyebrow}>{eyebrow}</span>
      <span className={css.title}>{title}</span>
      <span className={css.tagline}>{tagline}</span>
      <span className={css.stats}>
        {stats.map(stat => <span key={stat.id} className={css.stat} data-tone={stat.tone}><strong>{stat.value}</strong>{stat.label}</span>)}
      </span>
    </span>
    <span className={css.preview}>{preview}</span>
    <span className={css.footer}><span className={css.recent}>{recent}</span><span className={css.arrow} aria-hidden="true">→</span></span>
  </button>
}

/**
 * Satellites around a hub: only rings containing real running work orbit;
 * hidden, covered, off-screen and reduced-motion views remain static.
 * @param props.satellites - One mark per loaded item in its state; the inner ring holds the first six.
 * @param props.label - Accessible summary.
 * @param props.size - Edge length in pixels.
 * @returns an SVG glyph.
 */
export function SwarmGlyph({ satellites, label, size = 112 }: {
  satellites: readonly { readonly id: string; readonly state: VizState }[]
  label: string
  size?: number
}) {
  const ref = useRef<SVGSVGElement>(null)
  const active = useAnimationActive(ref)
  const c = size / 2
  const inner = satellites.slice(0, 6)
  const outer = satellites.slice(6, 18)
  const ring = (items: typeof satellites, radius: number) => items.map((item, index) => {
    const angle = -Math.PI / 2 + index / Math.max(1, items.length) * Math.PI * 2
    return <circle key={item.id} className={css.satellite} data-state={item.state}
      cx={c + Math.cos(angle) * radius} cy={c + Math.sin(angle) * radius} r={radius > size / 3 ? 4 : 5} />
  })
  return <svg ref={ref} className={css.glyph} width={size} height={size} viewBox={`0 0 ${String(size)} ${String(size)}`}
    role="img" aria-label={label} data-paused={!active || undefined} data-motion-tier="L1">
    <circle className={css.ring} cx={c} cy={c} r={size * 0.27} />
    <circle className={css.ring} cx={c} cy={c} r={size * 0.44} />
    <g className={inner.some(item => item.state === 'running') ? css.orbit : undefined}>{ring(inner, size * 0.27)}</g>
    <g className={outer.some(item => item.state === 'running') ? css.orbit : undefined} data-reverse>{ring(outer, size * 0.44)}</g>
    <circle className={css.hubHalo} cx={c} cy={c} r={size * 0.14} />
    <circle className={css.hub} cx={c} cy={c} r={size * 0.08} />
  </svg>
}

/**
 * A static constellation of loaded items placed deterministically by id.
 * It asserts neither activity nor a relation between items.
 * @param props.points - One star per loaded item.
 * @param props.label - Accessible summary.
 * @param props.size - Edge length in pixels.
 * @returns an SVG glyph.
 */
export function ConstellationGlyph({ points, label, size = 112 }: {
  points: readonly { readonly id: string }[]
  label: string
  size?: number
}) {
  const c = size / 2
  const stars = points.slice(0, 24).map((point) => {
    const hash = hashSeed(point.id)
    const angle = (hash % 3600) / 3600 * Math.PI * 2
    const radius = size * (0.16 + (hash >>> 12) % 1000 / 1000 * 0.3)
    return { id: point.id, x: c + Math.cos(angle) * radius, y: c + Math.sin(angle) * radius, r: 1.8 + (hash >>> 22) % 3 }
  })
  return <svg className={css.glyph} width={size} height={size} viewBox={`0 0 ${String(size)} ${String(size)}`}
    role="img" aria-label={label}>
    <circle className={css.ring} cx={c} cy={c} r={size * 0.3} />
    <circle className={css.ring} cx={c} cy={c} r={size * 0.46} />
    <g>
      {stars.map(star => <circle key={star.id} className={css.star} cx={star.x} cy={star.y} r={star.r} />)}
    </g>
    <circle className={css.hubHalo} cx={c} cy={c} r={size * 0.12} />
    <circle className={css.hub} cx={c} cy={c} r={size * 0.06} />
  </svg>
}
