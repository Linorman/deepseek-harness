/**
 * One presentation judgment of a run's state shared by the directory, header, overview and dialogs.
 *
 * Native world facts, the management control (or its directory projection), read health and the browser
 * connection stay independent observations with their own revision and time; this module only words them.
 * Sources that disagree become `reconciling`, unobservable ones `unknown`, and an old or failed observation
 * is downgraded to `stale` rather than presented as current.
 */
import type { SimulationProductControl, SimulationProductRunStatus } from '@clocky/clocky-client-runtime/client'
import type { Key } from './locales.ts'

/** Synthesized run state; each value has one wording and at most one primary action. */
export type RunStateKind = 'running' | 'stopping' | 'saving' | 'paused' | 'idle' | 'attention' | 'blocked' | 'failed'
  | 'completed' | 'reconciling' | 'unknown'
/** The single next step a state recommends; controls decide whether the Host currently allows it. */
export type RunPrimaryAction = 'start' | 'pause' | 'recover' | 'review' | 'refresh' | 'edit-target'
/** How current the oldest contributing observation is. */
export type RunFreshness = 'live' | 'aging' | 'stale' | 'unknown'
/** Scheduling stop shared by the control and its directory projection. */
export type RunStop = NonNullable<SimulationProductControl['stop']>
/** Safe Host failure facts; diagnostics stay behind the failure identity. */
export type RunFailure = NonNullable<SimulationProductControl['failure']>
/** Safe reason a native observation could not be read. */
export type RunReadFailure = NonNullable<Extract<SimulationProductRunStatus, { status: 'unavailable' }>['reason']>

/** One contributing source: its own revision and observation time, and whether its latest read failed. */
export interface RunSourceTime {
  readonly revision?: number | undefined
  readonly observedAt?: number | undefined
  /** The latest read of this source failed, so the retained value is only a last observation. */
  readonly failed: boolean
}

/** Observations and read health for one run; every field is optional because sources arrive independently. */
export interface RunStateInput {
  /** Native world inspection or directory status row. */
  readonly native?: SimulationProductRunStatus | undefined
  /** Full management control (run page); the directory passes none and uses the row's operational projection. */
  readonly control?: SimulationProductControl | undefined
  /** The native read failed; its retained value is a last observation. */
  readonly nativeFailed: boolean
  /** A revision watch currently confirms the native value, so its age does not matter. */
  readonly nativeWatched?: boolean | undefined
  /** The control read failed (forbidden or unsupported control is absent, not failed). */
  readonly controlFailed?: boolean | undefined
  readonly connected: boolean
  /** Real milliseconds now, from the caller's clock. */
  readonly now: number
  /** Automatic refresh interval; observations within twice this interval (at least five seconds) are live. */
  readonly refreshMs: number
  /** Observations older than this are stale even when their reads succeeded. */
  readonly staleAfterMs: number
}

/** Presentation of one run's current state. */
export interface RunState {
  readonly kind: RunStateKind
  /** Localized state name. */
  readonly headline: Key
  /** Localized one-line explanation of what is happening, when one adds information. */
  readonly detail?: Key | undefined
  readonly simTime?: { readonly value: string; readonly unit: string } | undefined
  readonly phase?: 'paused' | 'running' | 'stalled' | undefined
  readonly stop?: RunStop | undefined
  readonly failure?: RunFailure | undefined
  /** Safe reason the native observation is unavailable. */
  readonly unavailable?: RunReadFailure | undefined
  readonly inFlight?: boolean | undefined
  /** Host stop-target projection (D1); present only when the control carries one. */
  readonly target?: SimulationProductControl['stopTarget'] | undefined
  readonly primaryAction?: RunPrimaryAction | undefined
  readonly sources: { readonly native?: RunSourceTime | undefined; readonly control?: RunSourceTime | undefined }
  readonly freshness: RunFreshness
  /** Native details could not be read while the live control still answers: scheduling stays usable, details explain the limit. */
  readonly detailLimited?: boolean | undefined
  /** Oldest contributing observation time, shown as "observed at" or "last observed". */
  readonly observedAt?: number | undefined
}

/** Minimum age still presented as live, independent of the refresh interval. */
const LIVE_FLOOR_MS = 5000

type StopCategory = 'paused' | 'idle' | 'waiting' | 'attention' | 'blocked' | 'failed' | 'completed'
/** Every Host stop has one category; the closed record fails compilation when the protocol adds a stop. */
const STOP_CATEGORY: Record<RunStop, StopCategory> = {
  'paused': 'paused', 'idle': 'idle', 'until': 'idle', 'work-limit': 'idle',
  'retry': 'waiting', 'waiting-effective-time': 'waiting',
  'decision-required': 'attention', 'outcome-unknown': 'attention', 'review-required': 'attention',
  'recipient-required': 'attention', 'authority-missing': 'attention', 'approval-required': 'attention',
  'existing-obligations': 'attention', 'plan-stale': 'attention', 'handoff-required': 'attention',
  'retirement-unknown': 'attention', 'stale-time': 'attention', 'message-rejected': 'attention',
  'context-integrity': 'attention', 'maintenance-blocked': 'attention',
  'stalled': 'blocked', 'decision-timeout': 'blocked', 'token-overrun': 'blocked', 'request-budget': 'blocked',
  'recipient-busy': 'blocked', 'coordination-limit': 'blocked', 'resident-capacity': 'blocked', 'scenario-blocked': 'blocked',
  'position-capacity': 'blocked', 'plan-budget': 'blocked', 'resource-capacity': 'blocked', 'resource-history-limit': 'blocked',
  'resource-reservation-expired': 'blocked', 'entity-capacity': 'blocked', 'identity-capacity': 'blocked',
  'channel-capacity': 'blocked', 'world-byte-limit': 'blocked', 'world-request-limit': 'blocked',
  'world-command-limit': 'blocked', 'world-birth-limit': 'blocked', 'world-expansion-limit': 'blocked',
  'world-mutation-limit': 'blocked', 'budget-limit': 'blocked', 'context-limit': 'blocked', 'microstep-limit': 'blocked',
  'model-pool-capacity': 'blocked', 'activation-history-limit': 'blocked', 'message-byte-limit': 'blocked',
  'recovery-required': 'failed', 'residency-recovery-required': 'failed',
  'completed': 'completed',
}

/**
 * Category of a Host stop.
 * @param stop - Recorded scheduling stop.
 * @returns its presentation category.
 */
export function stopCategory(stop: RunStop): StopCategory {
  return STOP_CATEGORY[stop]
}

/**
 * Default freshness threshold for a refresh interval: fifteen intervals, never below thirty seconds.
 * @param refreshMs - Automatic control refresh interval.
 * @returns milliseconds after which an observation is stale.
 */
export function defaultStaleAfterMs(refreshMs: number): number {
  return Math.max(30000, refreshMs * 15)
}

/**
 * Synthesize one run state from independent observations; uncovered combinations fall to `unknown`.
 * @param input - Native, control and read-health observations.
 * @returns the state, its primary action and freshness.
 */
export function runState(input: RunStateInput): RunState {
  const native = input.native
  const world = native?.status === 'observed' ? native.world : undefined
  const operational = native?.operational?.status === 'observed' ? native.operational : undefined
  const control = input.control
  const sources = {
    native: native === undefined ? undefined : { revision: world?.revision, observedAt: world?.observedAt
      ?? native.operational?.observedAt, failed: input.nativeFailed },
    control: control === undefined ? undefined : { revision: control.revision, observedAt: control.observedAt,
      failed: input.controlFailed === true },
  }
  // A live control keeps actions usable when only the (possibly very large) native detail read fails.
  const detailLimited = input.nativeFailed && control !== undefined && input.controlFailed !== true
  const freshness = freshnessOf(input, detailLimited ? { ...sources, native: sources.native === undefined ? undefined
    : { ...sources.native, failed: false } } : sources)
  const observedTimes = [sources.native?.observedAt, sources.control?.observedAt].filter((value): value is number => value !== undefined)
  const observedAt = observedTimes.length === 0 ? undefined : Math.min(...observedTimes)
  const simTime = world === undefined ? undefined : { value: String(world.time), unit: world.tickUnit.text }
  const phase = control?.phase ?? world?.phase
  const driver = control?.driver ?? operational?.driver
  const inFlight = control?.inFlight ?? operational?.inFlight
  const stop = control?.stop ?? operational?.stop
  const failure = control?.failure ?? operational?.failure
  const unavailable = native?.status === 'unavailable' ? native.reason ?? 'unavailable' : undefined
  const target = control?.stopTarget
  const base = { simTime, phase, stop, failure, inFlight, sources, freshness, observedAt, unavailable, target, detailLimited }
  const state = (kind: RunStateKind, primaryAction?: RunPrimaryAction, detail?: Key): RunState =>
    ({ ...base, kind, headline: `state.${kind}`, detail, primaryAction: freshness === 'stale' ? 'refresh' : primaryAction })
  if (native === undefined && control === undefined) return state('unknown', 'refresh')
  if (native?.status === 'missing' && control === undefined) return state('unknown', undefined, 'state.detail.missing')
  if (unavailable !== undefined && control === undefined) return state('unknown', 'refresh', `state.unavailable.${unavailable}`)
  // Two sources from different cuts: say so instead of choosing one as the truth.
  if (control?.phase !== undefined && world !== undefined && control.phase !== world.phase) {
    return state('reconciling', 'refresh', 'state.detail.reconciling')
  }
  if (driver === 'completed' || stop !== undefined && stopCategory(stop) === 'completed') return state('completed')
  const category = stop === undefined ? undefined : stopCategory(stop)
  if (driver === 'failed' || category === 'failed' || control?.actions.start.reason === 'recovery-required'
    || control?.actions.start.reason === 'driver-failed') {
    return state('failed', failure?.retryDisposition === 'explicit-resume' ? 'start' : 'recover')
  }
  if (phase === 'stalled') return state('blocked', 'recover', world?.schedulerStop === undefined ? undefined : 'state.detail.nativeStop')
  // A reached stop target blocks ordinary Continue; the next step is editing or removing the target.
  if (control?.actions.start.reason === 'stop-target-reached' || target?.state === 'paused' && target.reason === 'target-reached') {
    return phase === 'paused' && inFlight !== true ? state('paused', 'edit-target', 'state.detail.targetReached')
      : state('stopping', undefined, 'state.detail.draining')
  }
  if (target?.state === 'draining') return state('stopping', undefined, 'state.detail.draining')
  if (phase === 'paused') {
    if (driver === 'checkpointing' || control?.administration.actions.checkpoint.reason === 'checkpoint-in-progress') {
      return state('saving', undefined, 'state.detail.saving')
    }
    if (inFlight === true || driver === 'scheduled' || driver === 'advancing' || driver === 'retiring') {
      return state('stopping', undefined, 'state.detail.stopping')
    }
    return state('paused', 'start', inFlight === undefined ? undefined : 'state.detail.noWork')
  }
  if (phase === 'running') {
    if (category === 'attention') return state('attention', 'review')
    // A capacity or budget stop the Host already allows continuing from offers Continue; otherwise recovery leads.
    if (category === 'blocked') return state('blocked', control?.actions.start.allowed === true ? 'start' : 'recover')
    if (failure !== undefined) return state('failed', failure.retryDisposition === 'explicit-resume' ? 'start' : 'recover')
    if (driver === 'scheduled' || driver === 'advancing' || driver === 'checkpointing' || driver === 'waiting'
      || category === 'waiting' || inFlight === true) {
      return state('running', 'pause', category === 'waiting' ? 'state.detail.waiting'
        : inFlight === true && driver !== 'advancing' ? 'state.detail.settling' : undefined)
    }
    if (driver === 'idle' || driver === 'retiring' || category === 'idle' || category === 'paused') {
      return state('idle', 'pause', 'state.detail.idle')
    }
    return state('unknown', 'refresh')
  }
  return state('unknown', 'refresh')
}

function freshnessOf(input: RunStateInput, sources: RunState['sources']): RunFreshness {
  const present = [sources.native, sources.control].filter((value): value is RunSourceTime => value !== undefined)
  if (present.length === 0) return input.connected ? 'unknown' : 'stale'
  if (!input.connected || present.some(source => source.failed)) return 'stale'
  const timed = [input.nativeWatched === true ? undefined : sources.native?.observedAt, sources.control?.observedAt]
    .filter((value): value is number => value !== undefined)
  if (timed.length === 0) return 'live'
  const age = Math.max(0, input.now - Math.min(...timed))
  // Very short refresh intervals would make round-trip latency look like aging; live spans at least five seconds.
  return age <= Math.max(input.refreshMs * 2, LIVE_FLOOR_MS) ? 'live' : age <= input.staleAfterMs ? 'aging' : 'stale'
}
