/**
 * Simulation visual views over bounded collection pages. Each view draws only
 * the loaded page, states loaded versus total, and keeps the table one
 * toggle away. Run-level relations, time-range reads, operation targets, and
 * interval series are not available yet, so the World, Timeline, and pulse
 * views ship in their bounded fallback forms.
 */
import { useMemo, useRef } from 'react'
import {
  decimalTimeScale, decimalToFixed, describeVisualization, GraphView, LaneView, layoutLanes, layoutRadialSwarm, Moment,
  useAnimationActive, useLiveChanges, VizListView, type DescribeWords, type GraphNodeView, type MomentKind, type VizItem, type VizState,
} from '@clocky/clocky-client-ui-viz'
import type { SimulationProductCollectionPage } from '@clocky/clocky-client-runtime/client'
import type { Key } from './locales.ts'
import css from './Visuals.module.css'

type Translate = (key: Key, vars?: Record<string, unknown>) => string
type Page<C extends SimulationProductCollectionPage['collection']> = Extract<SimulationProductCollectionPage, { collection: C }>

/** Phrase builders shared by the Simulation visuals. */
export function simulationWords(t: Translate): { describe: DescribeWords; loaded: (loaded: number, total: number | undefined) => string } {
  const loaded = (count: number, total: number | undefined) =>
    total === undefined ? t('visual.loadedOnly', { loaded: count }) : t('visual.loaded', { loaded: count, total })
  return { loaded, describe: { loaded, state: (count, state) => t('visual.stateCount', { count, state }),
    ghosts: count => t('visual.ghosts', { count }), stale: count => t('visual.staleCount', { count }) } }
}

/**
 * Residency from the writer state: active is resident, reserved and revoked
 * are transitional, none and released are dormant.
 * @param writer - Entity writer state.
 * @returns the state and its residency key.
 */
export function residency(writer: Page<'entities'>['items'][number]['writer']): { state: VizState; key: Key } {
  switch (writer) {
    case 'active': return { state: 'running', key: 'visual.residency.resident' }
    case 'reserved': case 'revoked': return { state: 'waiting', key: 'visual.residency.transitional' }
    case 'none': case 'released': return { state: 'idle', key: 'visual.residency.dormant' }
    default: {
      const unreachable: never = writer
      throw new Error(`unknown writer state ${String(unreachable)}`)
    }
  }
}

/**
 * Entity constellation: loaded entities clustered by kind, agent cognition glowing.
 * @param props - One entities page, selection, and copy.
 * @returns the graph with its list equivalent.
 */
export function WorldView({ page, runId, selected, open, t }: {
  page: Page<'entities'>
  runId: string
  selected?: string | undefined
  open: (id: string) => void
  t: Translate
}) {
  const words = simulationWords(t)
  const items: (VizItem & { kind: string; agent: boolean })[] = page.items.map((entity) => {
    const { state, key } = residency(entity.writer)
    return { id: entity.id, label: entity.name?.text ?? entity.id, state, stateLabel: t(key), kind: entity.kind.text,
      agent: entity.cognition === 'agent', detail: `${entity.kind.text} · ${t(entity.cognition)} · ${t(entity.phase)}` }
  })
  const layout = useMemo(() => layoutRadialSwarm({ seed: runId, ringGap: 150, nodeSpacing: 44,
    nodes: items.map(item => ({ id: item.id, ring: 1, cluster: item.kind })) }), [runId, page])
  const nodes: GraphNodeView[] = items.map((item) => {
    const position = layout.positions.get(item.id) ?? { x: 0, y: 0 }
    return { ...item, x: position.x, y: position.y, radius: 13, glow: item.agent || undefined,
      initials: Array.from(item.label)[0] ?? '?' }
  })
  const clusters = [...layout.clusters].map(([id, cluster]) => ({ id, ...cluster, label: id }))
  const count = { loaded: page.items.length, total: page.total }
  return <section className={css.visual} aria-label={t('visual.world.title')} data-simulation-visual="entities">
    <div className={css.meta}><span>{words.loaded(count.loaded, count.total)}</span></div>
    <p className={css.note}>{t('visual.world.note')}</p>
    <GraphView label={t('visual.world.title')} description={describeVisualization(t('visual.world.title'), items, count, words.describe)}
      nodes={nodes} edges={[]} clusters={clusters} selectedId={selected} onSelect={open} height={420} showLabels={nodes.length <= 24}
      controls={{ zoomIn: t('visual.zoomIn'), zoomOut: t('visual.zoomOut'), fit: t('visual.fit') }} />
    <details><summary className={css.note}>{t('visual.table')}</summary>
      <VizListView label={t('visual.world.title')} items={items} count={count} onSelect={open} selectedId={selected}
        words={{ loaded: words.loaded, ghost: t('visual.ghost'), stale: t('visual.stale') }} />
    </details>
  </section>
}

/** Decision status as a timeline state and marker. */
function decisionMark(status: Page<'decisions'>['items'][number]['status']): { state: VizState; marker: 'hollow' | 'half' | 'filled' | 'cross' } {
  switch (status) {
    case 'open': return { state: 'idle', marker: 'hollow' }
    case 'submitted': return { state: 'waiting', marker: 'half' }
    case 'accepted': return { state: 'done', marker: 'filled' }
    case 'cancelled': return { state: 'idle', marker: 'cross' }
    default: {
      const unreachable: never = status
      throw new Error(`unknown decision status ${String(unreachable)}`)
    }
  }
}

const TIMELINE_WIDTH = 720

/**
 * Decision timeline over the loaded page: one lane per entity, markers at
 * exact simulated time, same-time slots stacked, and a now cursor.
 * @param props - One decisions page, the observed world time, and copy.
 * @returns the lane chart.
 */
export function TimelineView({ page, now, unit, selected, open, t }: {
  page: Page<'decisions'>
  now?: string | undefined
  unit?: string | undefined
  selected?: string | undefined
  open: (id: string) => void
  t: Translate
}) {
  const words = simulationWords(t)
  const times = page.items.map(item => item.time as string)
  const bounds = [...times, ...now === undefined ? [] : [now]].sort((a, b) => {
    const delta = decimalToFixed(a) - decimalToFixed(b)
    return delta < 0n ? -1 : delta > 0n ? 1 : 0
  })
  const start = bounds[0] ?? '0'
  const end = bounds.at(-1) ?? '1'
  const scale = decimalTimeScale(start, end === start ? (BigInt(start) + 1n).toString() : end, TIMELINE_WIDTH)
  const lanes = [...new Set(page.items.map(item => item.entityId as string))]
  const layout = layoutLanes({ lanes: lanes.map(id => ({ id })), position: scale, markerWidth: 14,
    items: page.items.map(item => ({ id: item.id, lane: item.entityId, start: item.time as string })) })
  const items = page.items.map((item) => {
    const mark = decisionMark(item.status)
    return { id: item.id, label: `${item.entityId} · ${item.time} · ${t('slot')} ${item.slot}`, stateLabel: t(item.status), ...mark }
  })
  const count = { loaded: page.items.length, total: page.total }
  return <section className={css.visual} aria-label={t('visual.timeline.title')} data-simulation-visual="decisions">
    <div className={css.meta}><span>{words.loaded(count.loaded, count.total)}</span></div>
    <p className={css.note}>{t('visual.timeline.note')}</p>
    <LaneView label={t('visual.timeline.title')} width={TIMELINE_WIDTH} layout={layout}
      description={describeVisualization(t('visual.timeline.title'), items, count, words.describe)}
      lanes={lanes.map(id => ({ id, label: id }))} items={items} selectedId={selected} onSelect={open}
      cursor={now === undefined ? undefined : { x: scale(now), label: t('visual.timeline.now', { time: `${now}${unit === undefined ? '' : ` ${unit}`}` }) }} />
  </section>
}

type Operation = Page<'operations'>['items'][number]
type Stage = 'pending' | 'settled' | 'published' | 'persisted' | 'receipted' | 'blocked' | 'unknown'

/**
 * The furthest confirmed stage of one operation. A receipt confirms delivery
 * into the recipient's input; it never implies business acceptance.
 * @param operation - Operation summary.
 * @returns the pipeline column or side lane.
 */
export function operationStage(operation: Operation): Stage {
  switch (operation.status) {
    case 'pending': return 'pending'
    case 'outcome-unknown': return 'unknown'
    case 'blocked-authority': case 'blocked-dependency': return 'blocked'
    case 'rejected': return 'settled'
    case 'applied':
      return operation.delivery === 'receipted' ? 'receipted' : operation.delivery === 'input-persisted' ? 'persisted'
        : operation.publication === 'published' ? 'published' : 'settled'
    default: {
      const unreachable: never = operation.status
      throw new Error(`unknown operation status ${String(unreachable)}`)
    }
  }
}

const stageState: Record<Stage, VizState> = {
  pending: 'idle', settled: 'running', published: 'running', persisted: 'running', receipted: 'done', blocked: 'blocked', unknown: 'needs-you',
}

/**
 * Effect pipeline board over the loaded operations page.
 * @param props - One operations page and copy.
 * @returns the main stages, the side lanes, and the persistent receipt footnote.
 */
export function EffectsView({ page, selected, open, t }: {
  page: Page<'operations'>
  selected?: string | undefined
  open: (id: string) => void
  t: Translate
}) {
  const words = simulationWords(t)
  const byStage = new Map<Stage, Operation[]>()
  for (const operation of page.items) {
    const stage = operationStage(operation)
    byStage.set(stage, [...byStage.get(stage) ?? [], operation])
  }
  const column = (stage: Stage, key: Key) => {
    const cards = byStage.get(stage) ?? []
    return <section key={stage} className={css.lane} aria-label={`${t(key)} ${String(cards.length)}`}>
      <h3><span>{t(key)}</span><span>{cards.length}</span></h3>
      <ol>{cards.map(operation => <li key={operation.id}>
        <button type="button" className={css.card} data-state={operation.status === 'rejected' ? 'idle' : stageState[stage]}
          aria-pressed={operation.id === selected}
          onClick={() => { open(operation.id) }}>
          <span>{operation.kind.text}</span>
          <small>{t('entity')} {operation.entityId}</small>
          <small>{t('decision')} {operation.decisionId} · {t(operation.status)}</small>
        </button>
      </li>)}</ol>
    </section>
  }
  return <section className={css.visual} aria-label={t('visual.effects.title')} data-simulation-visual="operations">
    <div className={css.meta}><span>{words.loaded(page.items.length, page.total)}</span></div>
    <div className={css.pipeline}>
      {column('pending', 'visual.effects.pending')}
      {column('settled', 'visual.effects.settled')}
      {column('published', 'visual.effects.published')}
      {column('persisted', 'visual.effects.persisted')}
      {column('receipted', 'visual.effects.receipted')}
    </div>
    <div className={css.side}>
      {column('blocked', 'visual.effects.blocked')}
      {column('unknown', 'visual.effects.unknown')}
    </div>
    <p className={css.footnote} role="note">{t('visual.effects.footnote')}</p>
  </section>
}

/**
 * Checkpoint rail in start order: in progress, failed, or completed, with the
 * latest successful checkpoint highlighted.
 * @param props - One checkpoints page and copy.
 * @returns the rail.
 */
export function CheckpointRail({ page, selected, open, date, t }: {
  page: Page<'checkpoints'>
  selected?: string | undefined
  open: (id: string) => void
  date: (value: number) => string
  t: Translate
}) {
  const words = simulationWords(t)
  const items = [...page.items].sort((a, b) => a.startedSequence - b.startedSequence)
  // Seal (L3): a checkpoint observed finishing while this run's rail stays open.
  const statuses = useMemo(() => new Map(page.items.map(item => [item.id as string, item.status as string])), [page.items])
  const changed = useLiveChanges(page.runId, statuses)
  const sealed = [...changed].map(id => statuses.get(id)).filter(status => status === 'completed' || status === 'failed')
  const seal = useRef<{ generation: number; kind: MomentKind }>({ generation: 0, kind: 'seal' })
  const signature = useRef<ReadonlySet<string>>(changed)
  if (signature.current !== changed && sealed.length > 0) {
    seal.current = { generation: seal.current.generation + 1, kind: sealed.includes('failed') ? 'seal-failed' : 'seal' }
  }
  signature.current = changed
  return <Moment kind={seal.current.kind} generation={seal.current.generation}>
    <section className={css.visual} aria-label={t('visual.checkpoints.title')} data-simulation-visual="checkpoints">
      <div className={css.meta}><span>{words.loaded(page.items.length, page.total)}</span></div>
      <ol className={css.rail}>{items.map((checkpoint) => {
        const state: VizState = checkpoint.status === 'completed' ? 'done' : checkpoint.status === 'failed' ? 'failed' : 'running'
        return <li key={checkpoint.id}>
          <button type="button" className={css.stop} data-state={state} data-latest={checkpoint.latestSuccessful || undefined}
            aria-pressed={checkpoint.id === selected} onClick={() => { open(checkpoint.id) }}
            aria-label={`${checkpoint.id} · ${t(checkpoint.status)}${checkpoint.latestSuccessful ? ` · ${t('visual.checkpoints.latest')}` : ''}`}>
            <span className={css.marker} aria-hidden="true" />
            <strong>{t(checkpoint.status)}</strong>
            <span>{checkpoint.time ?? t('unavailable')}</span>
            {checkpoint.publishedAt !== undefined && <span>{date(checkpoint.publishedAt)}</span>}
            {checkpoint.latestSuccessful && <span>{t('visual.checkpoints.latest')}</span>}
          </button>
        </li>
      })}</ol>
    </section>
  </Moment>
}

/** Largest seat count drawn individually; larger pools summarize the rest. */
const MAX_SEATS = 64

/**
 * Resident seat map: active, awaiting release, and free. Reservations are
 * not reported by the run status, so no seat claims to be reserved.
 * @param props - Resident slot counters and copy.
 * @returns the grid with its legend.
 */
export function SeatMap({ used, limit, recovery, t }: { used: number; limit: number; recovery: number; t: Translate }) {
  const awaiting = Math.min(recovery, used)
  const shown = Math.min(limit, MAX_SEATS)
  const seats = Array.from({ length: shown }, (_, index) => index < used - awaiting ? 'active' : index < used ? 'awaiting' : 'free')
  return <div className={css.seats} role="group" aria-label={t('seat.title')}>
    <div className={css.seatGrid} role="img" aria-label={t('seat.summary', { used, limit })}>
      {seats.map((kind, index) => <span key={index} className={css.seat} data-seat={kind} />)}
    </div>
    <div className={css.legend}>
      <span><span className={css.seat} data-seat="active" />{t('seat.active')} {used - awaiting}</span>
      <span><span className={css.seat} data-seat="awaiting" />{t('seat.awaiting')} {awaiting}</span>
      <span><span className={css.seat} />{t('seat.free')} {Math.max(0, limit - used)}</span>
      {limit > shown && <span>+{limit - shown}</span>}
    </div>
  </div>
}

/**
 * Driver ring: it turns only while the driver is observed active; a saved
 * running phase without an observed driver stays still.
 * @param props - Whether the driver is observed active, and its label.
 * @returns a small ring glyph.
 */
export function DriverRing({ active, label }: { active: boolean; label: string }) {
  const ref = useRef<SVGSVGElement>(null)
  const running = useAnimationActive(ref)
  return <svg ref={ref} className={css.driverRing} width={16} height={16} viewBox="0 0 16 16" role="img" aria-label={label}
    data-active={active || undefined} data-paused={!running || undefined} data-motion-tier={active ? 'L1' : undefined}>
    <circle cx={8} cy={8} r={6} />
  </svg>
}
