/**
 * Graph renderer for swarm topologies, task flows, and entity worlds. It
 * draws SVG up to `markThreshold` marks and canvas above it. Pointer
 * hit-testing and keyboard focus use the same layout-space marks in both
 * modes, so the renderer never changes which node a click or a key reaches.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { boundsOf, type Point } from './layout/space.ts'
import { ARROW_DIRECTIONS, fitTransform, hitTest, nextSpatialFocus, readingOrder, toLayout, type SpatialMark, type ViewTransform } from './interaction/spatial.ts'
import type { VizState } from './interaction/describe.ts'
import { curvePath, edgeCurve, sampleCurve, type Curve } from './geometry.ts'
import { MAX_PARTICLES, prefersReducedMotion, useAnimationActive } from './motion/hooks.ts'
import { tokenDuration } from './motion/tokens.ts'
import { elementByData } from './interaction/dom.ts'
import css from './GraphView.module.css'

/** One node as drawn. */
export interface GraphNodeView {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly label: string
  readonly state: VizState
  readonly stateLabel: string
  /** Up to two characters drawn inside the disc. */
  readonly initials?: string | undefined
  /** Secondary text for the accessible name and the label row. */
  readonly detail?: string | undefined
  readonly radius?: number | undefined
  /** Referenced but not loaded. */
  readonly ghost?: boolean | undefined
  /** Observation older than its owner's cursor. */
  readonly stale?: boolean | undefined
  /** On the highlighted path, such as the critical path. */
  readonly emphasis?: boolean | undefined
  /** Static identity halo, such as agent cognition. */
  readonly glow?: boolean | undefined
  /** Small caption under the label, such as a count. */
  readonly badge?: string | undefined
}

/** One edge as drawn; `variant` names what the edge asserts. */
export interface GraphEdgeView {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly variant: 'solid' | 'dashed' | 'ghost'
  readonly directed?: boolean | undefined
  readonly active?: boolean | undefined
  readonly emphasis?: boolean | undefined
  readonly curvature?: number | undefined
}

/** A labelled cluster hull. */
export interface GraphClusterView extends Point {
  readonly id: string
  readonly radius: number
  readonly label: string
}

/** One live event to perform: a particle along an edge, or a pulse on a node. */
export interface GraphSignal {
  readonly id: string
  readonly edgeId?: string | undefined
  readonly nodeId?: string | undefined
}

/** Localized control labels. */
export interface GraphControlLabels {
  readonly zoomIn: string
  readonly zoomOut: string
  readonly fit: string
}

/** Props of {@link GraphView}. */
export interface GraphViewProps {
  /** Accessible name of the visualization. */
  readonly label: string
  /** One-sentence summary from `describeVisualization`. */
  readonly description: string
  readonly nodes: readonly GraphNodeView[]
  readonly edges: readonly GraphEdgeView[]
  readonly clusters?: readonly GraphClusterView[] | undefined
  readonly selectedId?: string | undefined
  readonly onSelect?: ((id: string) => void) | undefined
  /** Optional draft-editor gesture. Dropping one node on another requests a connection; the consumer validates before publishing. */
  readonly onConnect?: ((from: string, to: string) => void) | undefined
  readonly onActivate?: ((id: string) => void) | undefined
  readonly renderer?: 'auto' | 'svg' | 'canvas'
  readonly markThreshold?: number
  /** CSS height of the frame. */
  readonly height?: number | string
  /** Live signals; each id plays once. */
  readonly signals?: readonly GraphSignal[] | undefined
  /** Nodes whose state changed live; each plays one L2 bump. */
  readonly changedIds?: ReadonlySet<string> | undefined
  /** Assemble moment: nodes stagger in and edges draw in. Set only for a live observation. */
  readonly assemble?: boolean | undefined
  readonly controls: GraphControlLabels
  /** Overlay content such as a legend or loaded/total label. */
  readonly overlay?: ReactNode
  /** Draw node labels; dense graphs turn them off and keep names on focus proxies and the list view. */
  readonly showLabels?: boolean | undefined
}

const DEFAULT_RADIUS = 18
const FALLBACK_SIZE = { width: 640, height: 360 }

/**
 * Render a graph with pan, zoom, spatial keyboard focus, and live signals.
 * @param props - Laid-out nodes and edges plus selection and signal inputs.
 * @returns the interactive graph frame.
 */
export function GraphView(props: GraphViewProps) {
  const { nodes, edges, clusters = [], selectedId, onSelect, onActivate, renderer = 'auto', markThreshold = 500 } = props
  const frame = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const particleLayer = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef(new Map<string, SVGGElement>())
  const active = useAnimationActive(frame)
  const [size, setSize] = useState(FALLBACK_SIZE)
  const mode = renderer === 'auto' ? (nodes.length + edges.length > markThreshold ? 'canvas' : 'svg') : renderer
  const byId = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes])
  const marks: SpatialMark[] = useMemo(() => nodes.map(node => ({
    id: node.id, x: node.x, y: node.y, radius: node.radius ?? DEFAULT_RADIUS,
  })), [nodes])
  const bounds = useMemo(() => {
    const box = boundsOf(nodes, DEFAULT_RADIUS * 2.5)
    let { minX, minY, maxX, maxY } = box
    for (const cluster of clusters) {
      minX = Math.min(minX, cluster.x - cluster.radius); maxX = Math.max(maxX, cluster.x + cluster.radius)
      minY = Math.min(minY, cluster.y - cluster.radius - 16); maxY = Math.max(maxY, cluster.y + cluster.radius)
    }
    // Labels hang below each disc, and the legend overlays the bottom edge.
    return { minX, minY, maxX, maxY: maxY + (props.overlay === undefined ? 16 : 48) }
  }, [nodes, clusters, props.overlay === undefined])
  const [transform, setTransform] = useState<ViewTransform>(() => fitTransform(bounds, size.width, size.height))
  const userMoved = useRef(false)
  const [focusedId, setFocusedId] = useState<string | undefined>()
  // Spotlight: the hovered (or keyboard-focused) node and its direct neighbours
  // stay full strength while the rest of the graph recedes.
  const [hoveredId, setHoveredId] = useState<string | undefined>()
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  const spotlightId = hoveredId ?? (keyboardFocus ? focusedId : undefined)
  const neighbours = useMemo(() => {
    if (spotlightId === undefined) return undefined
    const out = new Set<string>([spotlightId])
    for (const edge of edges) {
      if (edge.from === spotlightId) out.add(edge.to)
      if (edge.to === spotlightId) out.add(edge.from)
    }
    return out
  }, [spotlightId, edges])
  // Button, key, and fit changes glide; pointer drags and wheel zoom follow the hand directly.
  const [glide, setGlide] = useState(false)
  const order = useMemo(() => readingOrder(marks), [marks])
  const tabStop = focusedId !== undefined && byId.has(focusedId) ? focusedId
    : selectedId !== undefined && byId.has(selectedId) ? selectedId : order[0]
  const curves = useMemo(() => {
    const out = new Map<string, Curve>()
    for (const edge of edges) {
      const a = byId.get(edge.from), b = byId.get(edge.to)
      if (a === undefined || b === undefined) continue
      out.set(edge.id, edgeCurve(a, b, edge.curvature ?? 0.12, edge.directed === true ? (b.radius ?? DEFAULT_RADIUS) + 3 : 0))
    }
    return out
  }, [edges, byId])

  useLayoutEffect(() => {
    const element = frame.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined || entry.contentRect.width === 0) return
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [])
  // Refit while the user has not moved the view; once they pan or zoom, the view is theirs.
  useEffect(() => {
    if (!userMoved.current) setTransform(fitTransform(bounds, size.width, size.height))
  }, [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, size.width, size.height])

  // Canvas mode repaints on data, size, or view changes only; nothing runs per frame.
  useEffect(() => {
    if (mode !== 'canvas') return
    const element = canvas.current
    const context = element?.getContext('2d') ?? null
    if (element === null || context === null) return
    const ratio = window.devicePixelRatio || 1
    element.width = Math.round(size.width * ratio)
    element.height = Math.round(size.height * ratio)
    paintCanvas(context, element, ratio, transform, nodes, edges, curves, selectedId)
  }, [mode, size.width, size.height, transform, nodes, edges, curves, selectedId])

  // L1 signals: particles fly along edges, node pulses ring once. Hidden or
  // off-screen frames drop signals instead of queueing work.
  const played = useRef(new Set<string>())
  const flying = useRef(0)
  useEffect(() => {
    const layer = particleLayer.current
    if (layer === null || props.signals === undefined) return
    const fresh = props.signals.filter(signal => !played.current.has(signal.id))
    for (const signal of fresh) played.current.add(signal.id)
    if (!active || fresh.length === 0) return
    const reduced = prefersReducedMotion()
    const overflowByTarget = new Map<string, number>()
    for (const signal of fresh) {
      const curve = signal.edgeId === undefined ? undefined : curves.get(signal.edgeId)
      const target = signal.nodeId !== undefined ? byId.get(signal.nodeId) : curve === undefined ? undefined : { ...curve.to }
      if (target === undefined) continue
      if (curve === undefined || reduced) { pulseAt(layer, target, reduced); continue }
      if (flying.current >= MAX_PARTICLES) {
        const key = `${target.x.toFixed(0)}:${target.y.toFixed(0)}`
        overflowByTarget.set(key, (overflowByTarget.get(key) ?? 0) + 1)
        continue
      }
      flying.current++
      flyParticle(layer, curve, () => { flying.current-- })
    }
    for (const [key, count] of overflowByTarget) {
      const [x = 0, y = 0] = key.split(':').map(Number)
      overflowPulse(layer, { x, y }, count)
    }
  }, [props.signals, active])
  // Keep the played set bounded to signals the owner still lists.
  useEffect(() => {
    if (props.signals === undefined) return
    const listed = new Set(props.signals.map(signal => signal.id))
    for (const id of played.current) if (!listed.has(id)) played.current.delete(id)
  }, [props.signals])

  // L2: a live state change bumps the node once.
  useEffect(() => {
    if (props.changedIds === undefined || props.changedIds.size === 0 || !active) return
    const reduced = prefersReducedMotion()
    for (const id of props.changedIds) {
      const body = nodeRefs.current.get(id)?.querySelector<SVGGElement>(`.${css.nodeBody}`)
      if (body === undefined || body === null || typeof body.animate !== 'function') continue
      body.animate(reduced
        ? [{ opacity: 0.4 }, { opacity: 1 }]
        : [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
      { duration: tokenDuration(body, reduced ? '--clocky-duration-fade' : '--clocky-duration-slow', 280), easing: 'cubic-bezier(0.2, 0, 0, 1)' })
    }
  }, [props.changedIds, active])

  const connecting = useRef<string | undefined>()
  const pan = useRef<{ x: number; y: number; start: ViewTransform; moved: boolean } | undefined>()
  const [panning, setPanning] = useState(false)
  const local = (event: { clientX: number; clientY: number }): Point => {
    const rect = frame.current?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button') !== null) return
    connecting.current = props.onConnect === undefined ? undefined : hitTest(marks, toLayout(transform, local(event)), 6 / transform.k)
    pan.current = { ...local(event), start: transform, moved: false }
    // jsdom lacks pointer capture; real browsers keep the drag on the frame.
    if ('setPointerCapture' in event.currentTarget) event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = pan.current
    if (state === undefined) {
      if (event.pointerType !== 'mouse') return
      const over = hitTest(marks, toLayout(transform, local(event)), 4 / transform.k)
      if (over !== hoveredId) setHoveredId(over)
      return
    }
    const point = local(event)
    const dx = point.x - state.x, dy = point.y - state.y
    if (!state.moved && Math.hypot(dx, dy) < 4) return
    if (!state.moved) { setPanning(true); setGlide(false); setHoveredId(undefined) }
    state.moved = true
    if (connecting.current !== undefined) {
      setHoveredId(hitTest(marks, toLayout(transform, point), 6 / transform.k)); return
    }
    userMoved.current = true
    setTransform({ ...state.start, x: state.start.x + dx, y: state.start.y + dy })
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const state = pan.current
    pan.current = undefined
    setPanning(false)
    const from = connecting.current
    connecting.current = undefined
    if (state?.moved && from !== undefined) {
      const to = hitTest(marks, toLayout(transform, local(event)), 6 / transform.k)
      if (to !== undefined && to !== from) props.onConnect?.(from, to)
      return
    }
    if (state === undefined || state.moved) return
    const id = hitTest(marks, toLayout(transform, local(event)), 6 / transform.k)
    if (id === undefined) return
    setFocusedId(id)
    onSelect?.(id)
  }
  const zoom = (factor: number, origin: Point = { x: size.width / 2, y: size.height / 2 }, animate = true) => {
    userMoved.current = true
    setGlide(animate)
    setTransform((current) => {
      const k = Math.min(4, Math.max(0.2, current.k * factor))
      const scale = k / current.k
      return { k, x: origin.x - (origin.x - current.x) * scale, y: origin.y - (origin.y - current.y) * scale }
    })
  }
  // Wheel zooms only with a modifier (or a trackpad pinch), so page scrolling keeps working.
  useEffect(() => {
    const element = frame.current
    if (element === null) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      zoom(Math.exp(-event.deltaY * 0.002), { x: event.clientX - rect.left, y: event.clientY - rect.top }, false)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => { element.removeEventListener('wheel', onWheel) }
  }, [size.width, size.height])
  const fit = () => { userMoved.current = false; setGlide(true); setTransform(fitTransform(bounds, size.width, size.height)) }

  const focusMark = (id: string | undefined) => {
    if (id === undefined) return
    setFocusedId(id)
    elementByData(frame.current, 'proxy-id', id)?.focus()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const direction = ARROW_DIRECTIONS[event.key]
    if (direction !== undefined) {
      event.preventDefault()
      focusMark(nextSpatialFocus(marks, id, direction))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focusMark(event.key === 'Home' ? order[0] : order.at(-1))
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect?.(id)
      onActivate?.(id)
    } else if (event.key === '+' || event.key === '=') zoom(1.2)
    else if (event.key === '-') zoom(1 / 1.2)
  }

  const layerTransform = `translate(${String(transform.x)}px, ${String(transform.y)}px) scale(${String(transform.k)})`
  const enteringIds = props.assemble === true ? order : []
  return <div ref={frame} className={css.frame} role="group" aria-label={props.label} aria-description={props.description}
    data-renderer={mode} data-paused={!active || undefined} data-panning={panning || undefined}
    data-motion-tier={props.assemble === true ? 'L3' : undefined}
    style={{ '--graph-height': typeof props.height === 'number' ? `${String(props.height)}px` : props.height } as CSSProperties}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
    onPointerCancel={() => { connecting.current = undefined; pan.current = undefined; setPanning(false) }}
    onPointerLeave={() => { setHoveredId(undefined) }}
    data-spotlight={neighbours === undefined ? undefined : true}>
    {mode === 'svg'
      ? <svg className={css.surface} width={size.width} height={size.height} aria-hidden="true">
        <defs>
          <marker id="clocky-viz-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path className={css.arrow} d="M0 0 L8 4 L0 8 z" />
          </marker>
        </defs>
        <g className={css.viewport} data-glide={glide || undefined} style={{ transform: layerTransform }}>
          {clusters.map(cluster => <g key={cluster.id}>
            <circle className={css.cluster} cx={cluster.x} cy={cluster.y} r={cluster.radius} />
            <text className={css.clusterLabel} x={cluster.x} y={cluster.y - cluster.radius - 6}>{cluster.label}</text>
          </g>)}
          {edges.map((edge, index) => {
            const curve = curves.get(edge.id)
            if (curve === undefined) return null
            const lit = neighbours !== undefined && (edge.from === spotlightId || edge.to === spotlightId)
            const path = curvePath(curve)
            return <g key={edge.id} className={css.edgeGroup} data-lit={lit || undefined}>
              <path className={css.edge} d={path} data-variant={edge.variant}
                data-active={edge.active || undefined} data-emphasis={edge.emphasis || undefined}
                data-draw-in={props.assemble || undefined} pathLength={props.assemble === true ? 1 : undefined}
                style={props.assemble === true ? { '--stagger': String(index + nodes.length / 2) } as CSSProperties : undefined}
                markerEnd={edge.directed === true ? 'url(#clocky-viz-arrow)' : undefined} />
              {/* Active work flows along its edge (L1); the solid base keeps the edge's own encoding. */}
              {edge.active === true && props.assemble !== true && <path className={css.edgeFlow} d={path} data-motion-tier="L1" />}
            </g>
          })}
          {nodes.map((node) => {
            const radius = node.radius ?? DEFAULT_RADIUS
            const entering = enteringIds.indexOf(node.id)
            const bind = (element: SVGGElement | null) => {
              if (element === null) nodeRefs.current.delete(node.id)
              else nodeRefs.current.set(node.id, element)
            }
            return <g key={node.id} ref={bind}
              className={css.node} transform={`translate(${String(node.x)} ${String(node.y)})`} data-node-id={node.id}
              data-state={node.state} data-ghost={node.ghost || undefined} data-stale={node.stale || undefined}
              data-selected={node.id === selectedId || undefined} data-emphasis={node.emphasis || undefined}
              data-lit={neighbours?.has(node.id) || undefined} data-spot={node.id === spotlightId || undefined}
              data-motion-tier={node.state === 'running' && node.ghost !== true ? 'L1' : undefined}
              data-glow={node.glow || undefined} data-entering={entering >= 0 || undefined}
              style={entering >= 0 ? { '--stagger': String(entering) } as CSSProperties : undefined}>
              <g className={css.nodeBody}>
                <circle className={css.nodeHalo} r={radius + 8} />
                <circle className={css.nodeDisc} r={radius} />
                <circle className={css.nodeRing} r={radius + 3} />
                {node.initials !== undefined && <text className={css.nodeInitials}>{node.initials}</text>}
              </g>
              {props.showLabels !== false && <text className={css.nodeLabel} y={radius + 18}>{truncate(node.label, 18)}</text>}
              {props.showLabels !== false && node.badge !== undefined
                && <text className={css.nodeBadge} y={radius + 32}>{node.badge}</text>}
            </g>
          })}
        </g>
      </svg>
      : <canvas ref={canvas} className={css.surface} style={{ width: size.width, height: size.height }} aria-hidden="true" />}
    <div ref={particleLayer} className={css.particles} data-glide={glide || undefined} style={{ transform: layerTransform }} aria-hidden="true" />
    <div className={css.focusLayer}>
      {nodes.map((node) => {
        const radius = (node.radius ?? DEFAULT_RADIUS) * transform.k
        const name = [node.label, node.stateLabel, node.detail].filter(Boolean).join(' · ')
        return <button key={node.id} type="button" className={css.proxy} data-proxy-id={node.id}
          tabIndex={node.id === tabStop ? 0 : -1} aria-label={name} aria-pressed={node.id === selectedId}
          style={{ left: node.x * transform.k + transform.x, top: node.y * transform.k + transform.y,
            width: radius * 2 + 6, height: radius * 2 + 6 }}
          onFocus={(event) => { setFocusedId(node.id); setKeyboardFocus(isFocusVisible(event.currentTarget)) }}
          onBlur={() => { setKeyboardFocus(false) }} onKeyDown={(event) => { onKeyDown(event, node.id) }} />
      })}
    </div>
    {props.overlay !== undefined && <div className={css.legend}>{props.overlay}</div>}
    <div className={css.controls} onPointerDown={(event) => { event.stopPropagation() }}>
      <button type="button" aria-label={props.controls.zoomOut} onClick={() => { zoom(1 / 1.2) }}>−</button>
      <button type="button" aria-label={props.controls.fit} onClick={fit}>⤢</button>
      <button type="button" aria-label={props.controls.zoomIn} onClick={() => { zoom(1.2) }}>+</button>
    </div>
  </div>
}

/** Whether focus arrived by keyboard; pointer focus does not spotlight. */
function isFocusVisible(element: Element): boolean {
  try { return element.matches(':focus-visible') }
  // jsdom's selector engine rejects :focus-visible; tests then count every focus as keyboard focus.
  catch { return true }
}

function truncate(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text
}

/** Fly one particle along a curve with sampled `translate` keyframes. */
function flyParticle(layer: HTMLElement, curve: Curve, done: () => void): void {
  const dot = layer.ownerDocument.createElement('span')
  dot.className = css.particle ?? ''
  layer.append(dot)
  const frames = sampleCurve(curve, 16).map(point => ({ transform: `translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px)` }))
  if (typeof dot.animate !== 'function') { dot.remove(); done(); return }
  const duration = tokenDuration(layer, '--clocky-duration-flow', 1200)
  const animation = dot.animate(frames, { duration, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' })
  dot.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration })
  animation.onfinish = () => { dot.remove(); done() }
  animation.oncancel = animation.onfinish
}

/** Ring once at a point; reduced motion flashes opacity in place instead. */
function pulseAt(layer: HTMLElement, at: Point, reduced: boolean): void {
  const ring = layer.ownerDocument.createElement('span')
  ring.className = css.pulse ?? ''
  ring.style.left = `${String(at.x)}px`
  ring.style.top = `${String(at.y)}px`
  layer.append(ring)
  if (typeof ring.animate !== 'function') { ring.remove(); return }
  const animation = ring.animate(reduced
    ? [{ opacity: 0 }, { opacity: 0.8 }, { opacity: 0 }]
    : [{ opacity: 0.7, transform: 'scale(0.6)' }, { opacity: 0, transform: 'scale(1.6)' }],
  { duration: reduced ? tokenDuration(layer, '--clocky-duration-fade', 140) * 3 : tokenDuration(layer, '--clocky-duration-flow', 1200) * 0.75, easing: 'cubic-bezier(0, 0, 0, 1)' })
  animation.onfinish = () => { ring.remove() }
}

/** The merged "+N" pulse for particles beyond the concurrency cap. */
function overflowPulse(layer: HTMLElement, at: Point, count: number): void {
  const badge = layer.ownerDocument.createElement('span')
  badge.className = css.overflow ?? ''
  badge.textContent = `+${String(count)}`
  badge.style.left = `${String(at.x)}px`
  badge.style.top = `${String(at.y)}px`
  layer.append(badge)
  if (typeof badge.animate !== 'function') { badge.remove(); return }
  const animation = badge.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }],
    { duration: Math.max(tokenDuration(layer, '--clocky-duration-fade', 140) * 4, tokenDuration(layer, '--clocky-duration-flow', 1200)) })
  animation.onfinish = () => { badge.remove() }
}

/** Paint every mark on a 2D canvas using the same role tokens as the SVG sheet. */
function paintCanvas(context: CanvasRenderingContext2D, element: HTMLCanvasElement, ratio: number, transform: ViewTransform,
  nodes: readonly GraphNodeView[], edges: readonly GraphEdgeView[], curves: ReadonlyMap<string, Curve>,
  selectedId: string | undefined): void {
  const style = getComputedStyle(element)
  const token = (name: string) => style.getPropertyValue(name).trim() || 'gray'
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, element.width, element.height)
  context.translate(transform.x, transform.y)
  context.scale(transform.k, transform.k)
  context.lineWidth = 1.25
  for (const edge of edges) {
    const curve = curves.get(edge.id)
    if (curve === undefined) continue
    context.strokeStyle = token(edge.emphasis === true ? '--clocky-accent-fg' : edge.active === true ? '--clocky-viz-edge-active' : edge.variant === 'ghost' ? '--clocky-viz-edge-ghost' : '--clocky-viz-edge')
    context.setLineDash(edge.variant === 'solid' ? [] : edge.variant === 'dashed' ? [5, 4] : [2, 4])
    context.beginPath()
    context.moveTo(curve.from.x, curve.from.y)
    context.quadraticCurveTo(curve.control.x, curve.control.y, curve.to.x, curve.to.y)
    context.stroke()
  }
  context.setLineDash([])
  for (const node of nodes) {
    const radius = node.radius ?? DEFAULT_RADIUS
    const role = node.ghost === true ? 'idle' : node.state
    context.globalAlpha = node.stale === true ? 0.6 : 1
    context.beginPath()
    context.arc(node.x, node.y, radius, 0, Math.PI * 2)
    if (node.ghost === true) {
      context.setLineDash([3, 3])
      context.strokeStyle = token('--clocky-viz-edge-ghost')
      context.stroke()
      context.setLineDash([])
    } else {
      context.fillStyle = token(`--clocky-status-${role}-bg`)
      context.fill()
      context.lineWidth = node.id === selectedId ? 2.5 : 2
      context.strokeStyle = token(node.id === selectedId ? '--clocky-border-focus' : `--clocky-status-${role}-fg`)
      context.stroke()
    }
  }
  context.globalAlpha = 1
}
