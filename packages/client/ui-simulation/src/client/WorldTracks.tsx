/** Independent state machines drawn as tracks, steps and meters; every node pairs a shape with words. */
import clsx from 'clsx'
import { Tooltip } from '@clocky/clocky-client-ui-primitives'
import type { MutationPhase, Track, TrackNodeState } from './world-domain.ts'
import { assertNever } from './WorldFacts.tsx'
import type { WorldT } from './WorldFacts.tsx'
import css from './World.module.css'

/** Visual status family for a node; colors come only from `--clocky-status-*`. */
function nodeTone(state: TrackNodeState): string {
  switch (state) {
    case 'done': return 'done'
    case 'active': return 'running'
    case 'waiting': return 'waiting'
    case 'blocked': return 'blocked'
    case 'rejected': return 'failed'
    case 'unknown': return 'needs-you'
    case 'pending': return 'idle'
    default: return assertNever(state)
  }
}

/**
 * One node glyph: filled done, half active/waiting, hollow pending, cross rejected, question unknown, pause blocked.
 * @param props.state - Node state.
 * @returns 14px SVG without its own accessible name.
 */
export function TrackNode({ state }: { state: TrackNodeState }) {
  const shape = (() => {
    switch (state) {
      case 'done': return <circle cx="7" cy="7" r="5" className={css.nodeFill} />
      case 'active':
      case 'waiting': return <><circle cx="7" cy="7" r="4.5" className={css.nodeRing} /><path d="M7 2.5a4.5 4.5 0 0 1 0 9z" className={css.nodeFill} /></>
      case 'pending': return <circle cx="7" cy="7" r="4.5" className={css.nodeRing} />
      case 'rejected': return <><circle cx="7" cy="7" r="5" className={css.nodeFill} /><path d="M5 5l4 4M9 5l-4 4" className={css.nodeInverse} /></>
      case 'unknown': return <><circle cx="7" cy="7" r="5" className={css.nodeFill} />
        <path d="M5.6 5.6a1.5 1.5 0 1 1 2.1 1.3c-.5.3-.7.6-.7 1.1" className={css.nodeInverse} /><circle cx="7" cy="9.9" r=".7" className={css.nodeInverseFill} /></>
      case 'blocked': return <><circle cx="7" cy="7" r="4.5" className={css.nodeRing} /><path d="M5.6 5v4M8.4 5v4" className={css.nodeStroke} /></>
      default: return assertNever(state)
    }
  })()
  return <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" className={css.node} data-tone={nodeTone(state)}>{shape}</svg>
}

/**
 * Request, plan, execution and notification as four independent tracks, never one merged status word.
 * @param props.tracks - Host-projected tracks in display order.
 * @param props.compact - Table-row form: four dots with a tooltip carrying the full sentences.
 * @param props.open - Optional jump to the section that explains a track.
 * @returns grouped tracks with text equivalents.
 */
export function StatusTrack({ tracks, compact = false, open, t }: {
  tracks: readonly Track[]
  compact?: boolean
  open?: ((kind: Track['kind']) => void) | undefined
  t: WorldT
}) {
  if (compact) {
    const sentence = tracks.map(track => `${t(`world.track.${track.kind}`)}: ${track.summary}`).join(' · ')
    return <Tooltip label={sentence} side="top" delayMs={300} maxWidth={360}>
      <span className={css.trackCompact} role="img" aria-label={sentence} tabIndex={0}>
        {tracks.map(track => <TrackNode key={track.kind} state={track.steps.at(-1)?.state ?? 'pending'} />)}
      </span>
    </Tooltip>
  }
  return <div className={css.tracks}>{tracks.map((track) => {
    const head = <span className={css.trackLabel}>{t(`world.track.${track.kind}`)}</span>
    return <div key={track.kind} role="group" aria-label={t(`world.track.${track.kind}`)} className={css.track} data-track={track.kind}>
      {open === undefined ? head : <button type="button" className={css.trackJump}
        aria-label={t('world.track.open', { track: t(`world.track.${track.kind}`) })}
        onClick={() => { open(track.kind) }}>{head}</button>}
      <ol className={css.trackSteps}>
        {track.steps.length === 0 ? <li><TrackNode state="pending" /><span className={css.srOnly}>{t('world.track.state.pending')}</span></li>
          : track.steps.map((step, index) => <li key={step.id} data-state={step.state}>
            {index > 0 && <span className={css.trackLine} data-tone={nodeTone(step.state)} aria-hidden="true" />}
            <TrackNode state={step.state} /><span className={css.srOnly}>{`${step.label}: ${t(`world.track.state.${step.state}`)}`}</span>
          </li>)}
      </ol>
      <span className={css.trackSummary}>{track.steps.length === 0 ? t('world.track.notStarted') : track.summary}</span>
    </div>
  })}</div>
}

const PHASES: readonly MutationPhase[] = ['retained', 'reserved', 'quiescing', 'transferring', 'committed', 'notifying', 'done']

/**
 * Structural mutation phases as discrete steps; no flowing or countdown animation.
 * @param props.phase - Current phase.
 * @param props.blocked - Blocking reason code, if blocked.
 * @param props.cancelRequested - Cancellation branch.
 * @returns ordered step list with the current step marked.
 */
export function MutationSteps({ phase, blocked, cancelRequested = false, t }: {
  phase: MutationPhase
  blocked?: string | undefined
  cancelRequested?: boolean
  t: WorldT
}) {
  const current = PHASES.indexOf(phase)
  return <div className={css.mutation}>
    <ol className={css.mutationSteps}>{PHASES.map((item, index) => {
      const state: TrackNodeState = index < current || phase === 'done' ? 'done' : index === current
        ? blocked === undefined ? 'active' : 'blocked' : 'pending'
      return <li key={item} data-state={state} aria-current={index === current ? 'step' : undefined}>
        <TrackNode state={state} /><span>{t(`world.mutation.${item}`)}</span></li>
    })}</ol>
    {blocked !== undefined && <p className={css.branch} data-tone="blocked">{t('world.mutation.blocked', { reason: blocked })}</p>}
    {cancelRequested && <p className={css.branch} data-tone="waiting">{t('world.mutation.cancelRequested')}</p>}
  </div>
}

/**
 * Position occupancy: solid occupied, hatched reserved, empty free; full shows a lock.
 * @param props.occupied - Committed holders.
 * @param props.reserved - Reservations in flight.
 * @param props.capacity - Positive capacity.
 * @returns segmented meter with a text equivalent; over-capacity is shown as a data error.
 */
export function OccupancyMeter({ occupied, reserved, capacity, t }: {
  occupied: number
  reserved: number
  capacity: number
  t: WorldT
}) {
  const over = occupied + reserved > capacity
  const full = !over && occupied + reserved === capacity
  const label = t('world.occupancy', { occupied, reserved, capacity })
  const cells = Math.max(capacity, occupied + reserved)
  return <span className={css.occupancy} data-state={over ? 'over' : full ? 'full' : 'open'}>
    <span className={css.occupancyBar} role="img" aria-label={over ? `${label} · ${t('world.occupancy.over')}` : label}>
      {Array.from({ length: Math.min(cells, 24) }, (_, index) => <span key={index}
        data-cell={index < occupied ? 'occupied' : index < occupied + reserved ? 'reserved' : 'free'} />)}
    </span>
    <span className={css.occupancyText} aria-hidden="true">{label}</span>
    {full && <span className={css.occupancyFull}><svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <rect x="2.5" y="5.2" width="7" height="5" rx="1" fill="currentColor" />
      <path d="M4 5.2V4a2 2 0 0 1 4 0v1.2" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>{t('world.occupancy.full')}</span>}
    {over && <span className={clsx(css.occupancyFull, css.error)} role="alert">{t('world.occupancy.over')}</span>}
  </span>
}

const LEGEND_STATES: readonly TrackNodeState[] = ['done', 'active', 'waiting', 'blocked', 'rejected', 'unknown', 'pending']

/**
 * Legend for compact track dots: their order, then what each glyph means.
 * @param props.t - Translator.
 * @returns a small figure caption that pairs every glyph with its words.
 */
export function TrackLegend({ t }: { t: WorldT }) {
  return <p className={css.trackLegend} data-track-legend>
    <span>{t('world.track.legendOrder', { order: (['request', 'plan', 'execution', 'notification'] as const)
      .map(kind => t(`world.track.${kind}`)).join(' → ') })}</span>
    {LEGEND_STATES.map(state => <span key={state} className={css.trackLegendItem}><TrackNode state={state} />{t(`world.track.state.${state}`)}</span>)}
  </p>
}
