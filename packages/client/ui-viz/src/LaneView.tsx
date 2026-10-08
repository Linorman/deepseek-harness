/**
 * Swimlane renderer for agent attempts and simulated-time timelines. The
 * caller lays items out with `layoutLanes`, so exact time scaling stays in
 * the caller's domain; this component only draws and navigates.
 */
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { LaneLayout } from './layout/lanes.ts'
import type { VizState } from './interaction/describe.ts'
import { ARROW_DIRECTIONS, nextSpatialFocus, readingOrder, type SpatialMark } from './interaction/spatial.ts'
import { elementByData } from './interaction/dom.ts'
import css from './Views.module.css'

/** One lane header. */
export interface LaneRowView {
  readonly id: string
  readonly label: string
  readonly detail?: string | undefined
  readonly stale?: boolean | undefined
}

/** One item: a bar when it has extent, otherwise a marker. */
export interface LaneItemView {
  readonly id: string
  readonly label: string
  readonly state: VizState
  readonly stateLabel: string
  readonly marker?: 'hollow' | 'half' | 'filled' | 'cross' | 'tick' | undefined
  readonly ghost?: boolean | undefined
  /** Text drawn inside a bar wide enough to hold it, or before a point marker. */
  readonly caption?: string | undefined
}

/** A vertical rule such as a checkpoint. */
export interface LaneRuleView {
  readonly id: string
  readonly x: number
  readonly label: string
  readonly state?: VizState | undefined
}

/** A causal arrow between two items. */
export interface LaneArrowView {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly variant: 'dashed' | 'solid' | 'headed'
}

const ROW = 22

/**
 * Render lanes, items, rules, arrows, and a now cursor.
 * @param props.label - Accessible name.
 * @param props.layout - Placement from `layoutLanes`.
 * @param props.lanes - Lane headers in layout order.
 * @param props.items - Item metadata keyed by the ids in `layout.items`.
 * @param props.width - Drawable width of the time axis.
 * @param props.cursor - Optional now cursor.
 * @returns a scrollable lane chart with spatial keyboard traversal.
 */
export function LaneView({ label, description, layout, lanes, items, width, rules = [], arrows = [], cursor, selectedId, onSelect }: {
  label: string
  description: string
  layout: LaneLayout
  lanes: readonly LaneRowView[]
  items: readonly LaneItemView[]
  width: number
  rules?: readonly LaneRuleView[]
  arrows?: readonly LaneArrowView[]
  cursor?: { x: number; label: string } | undefined
  selectedId?: string | undefined
  onSelect?: ((id: string) => void) | undefined
}) {
  const root = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState<string>()
  const top = 20
  const height = layout.height + top + 8
  const marks: SpatialMark[] = useMemo(() => items.flatMap((item) => {
    const place = layout.items.get(item.id)
    return place === undefined ? [] : [{ id: item.id, x: (place.x + place.x2) / 2, y: place.y }]
  }), [items, layout])
  const order = useMemo(() => readingOrder(marks), [marks])
  const tabStop = focused !== undefined && order.includes(focused) ? focused
    : selectedId !== undefined && order.includes(selectedId) ? selectedId : order[0]
  const focus = (id: string | undefined) => {
    if (id === undefined) return
    setFocused(id)
    elementByData(root.current, 'lane-item', id)?.focus()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const direction = ARROW_DIRECTIONS[event.key]
    if (direction !== undefined) {
      event.preventDefault()
      // Lanes are rows: a vertical move may land anywhere in the next lane.
      focus(nextSpatialFocus(marks, id, direction) ?? (direction === 'down' || direction === 'up'
        ? nearestInNextLane(marks, id, direction) : undefined))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focus(event.key === 'Home' ? order[0] : order.at(-1))
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect?.(id)
    }
  }
  return <div ref={root} className={css.lanes} role="group" aria-label={label} aria-description={description}>
    <div className={css.laneLabels} style={{ height }}>
      {lanes.map((lane) => {
        const place = layout.lanes.get(lane.id)
        if (place === undefined) return null
        return <div key={lane.id} className={css.laneLabel} data-stale={lane.stale || undefined}
          style={{ top: place.y + top, height: place.height }} title={lane.label}>
          <span>{lane.label}{lane.detail !== undefined && <small> · {lane.detail}</small>}</span>
        </div>
      })}
    </div>
    <div className={css.laneScroll}>
      <svg className={css.laneSvg} width={width + 24} height={height} aria-hidden="true">
        <defs>
          <marker id="clocky-viz-lane-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path className={css.marker} d="M0 0 L8 4 L0 8 z" />
          </marker>
        </defs>
        <g transform={`translate(12 ${String(top)})`}>
          {lanes.map((lane, index) => {
            const place = layout.lanes.get(lane.id)
            return place === undefined || index % 2 === 1 ? null
              : <rect key={lane.id} className={css.laneBand} x={-12} y={place.y} width={width + 24} height={place.height} />
          })}
          {rules.map(rule => <g key={rule.id}>
            <line className={css.rule} data-state={rule.state} x1={rule.x} x2={rule.x} y1={-top + 4} y2={layout.height} />
            <text className={css.ruleLabel} x={rule.x + 3} y={-top + 12}>{rule.label}</text>
          </g>)}
          {arrows.map((arrow) => {
            const a = layout.items.get(arrow.from), b = layout.items.get(arrow.to)
            if (a === undefined || b === undefined) return null
            const midX = (a.x + b.x) / 2
            return <path key={arrow.id} className={arrow.variant === 'dashed' ? css.arrowDashed : css.arrowSolid}
              d={`M${String(a.x)} ${String(a.y)} C${String(midX)} ${String(a.y)} ${String(midX)} ${String(b.y)} ${String(b.x)} ${String(b.y)}`}
              markerEnd={arrow.variant === 'headed' ? 'url(#clocky-viz-lane-arrow)' : undefined} />
          })}
          {items.map((item) => {
            const place = layout.items.get(item.id)
            if (place === undefined) return null
            const span = place.x2 - place.x
            return <g key={item.id} className={css.bar} data-state={item.state} data-ghost={item.ghost || undefined}
              data-selected={item.id === selectedId || undefined}>
              {span > 0 || item.marker === undefined
                ? <>
                  <rect x={place.x} y={place.y - ROW / 2 + 3} width={Math.max(4, span)} height={ROW - 6} rx={4} />
                  {item.caption !== undefined && span > 48
                    && <text className={css.barLabel} x={place.x + 6} y={place.y + 4}>{item.caption}</text>}
                </>
                : <>
                  {marker(item.marker, place.x, place.y)}
                  {item.caption !== undefined && <text className={css.barLabel} x={place.x - 10} y={place.y + 4} textAnchor="end">{item.caption}</text>}
                </>}
            </g>
          })}
          {cursor !== undefined && <g>
            <line className={css.cursor} x1={cursor.x} x2={cursor.x} y1={-top + 4} y2={layout.height} />
            <text className={css.cursorLabel} x={cursor.x + 3} y={layout.height + 6}>{cursor.label}</text>
          </g>}
        </g>
      </svg>
      {items.map((item) => {
        const place = layout.items.get(item.id)
        if (place === undefined) return null
        const span = Math.max(12, place.x2 - place.x)
        return <button key={item.id} type="button" className={css.laneProxy} data-lane-item={item.id}
          tabIndex={item.id === tabStop ? 0 : -1} aria-pressed={item.id === selectedId}
          aria-label={`${item.label} · ${item.stateLabel}`}
          style={{ left: place.x + 12 - (place.x2 === place.x ? 6 : 0), top: place.y + top - ROW / 2 + 2, width: span, height: ROW - 4 }}
          onFocus={() => { setFocused(item.id) }} onClick={() => { onSelect?.(item.id) }}
          onKeyDown={(event) => { onKeyDown(event, item.id) }} />
      })}
    </div>
  </div>
}

function marker(kind: NonNullable<LaneItemView['marker']>, x: number, y: number) {
  switch (kind) {
    case 'cross': return <path className={css.marker} data-marker={kind} d={`M${String(x - 5)} ${String(y - 5)} L${String(x + 5)} ${String(y + 5)} M${String(x + 5)} ${String(y - 5)} L${String(x - 5)} ${String(y + 5)}`} />
    case 'tick': return <line className={css.marker} data-marker={kind} x1={x} x2={x} y1={y - 6} y2={y + 6} />
    case 'hollow': case 'half': case 'filled': return <circle className={css.marker} data-marker={kind} cx={x} cy={y} r={5.5} />
    default: {
      const unreachable: never = kind
      throw new Error(`unknown lane marker ${String(unreachable)}`)
    }
  }
}

function nearestInNextLane(marks: readonly SpatialMark[], id: string, direction: 'up' | 'down'): string | undefined {
  const current = marks.find(mark => mark.id === id)
  if (current === undefined) return undefined
  const candidates = marks.filter(mark => direction === 'down' ? mark.y > current.y : mark.y < current.y)
  if (candidates.length === 0) return undefined
  const laneY = direction === 'down' ? Math.min(...candidates.map(mark => mark.y)) : Math.max(...candidates.map(mark => mark.y))
  return candidates.filter(mark => mark.y === laneY).sort((a, b) => Math.abs(a.x - current.x) - Math.abs(b.x - current.x))[0]?.id
}
