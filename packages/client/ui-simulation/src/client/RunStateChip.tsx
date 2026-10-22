/** Shared run-state chip: icon plus text, never color alone; stale observations say so first. */
import { SimClock, StatusGlyph } from '@clocky/clocky-client-ui-primitives'
import type { AgentStatus } from '@clocky/clocky-client-ui-primitives'
import type { Key } from './locales.ts'
import type { RunState, RunStateKind } from './run-state.ts'
import css from './Workspace.module.css'

type Translate = (key: Key, params?: Record<string, string>) => string

/** Status role of each state; only an observed working run uses the animated running role. */
const GLYPH: Record<RunStateKind, AgentStatus> = {
  running: 'running', stopping: 'waiting', saving: 'waiting', paused: 'idle', idle: 'waiting', attention: 'needs-you',
  blocked: 'blocked', failed: 'failed', completed: 'done', reconciling: 'waiting', unknown: 'idle',
}

/**
 * Status role for accents that echo a state; stale states never claim activity.
 * @param state - Synthesized run state.
 * @returns status role.
 */
export function runStateStatus(state: RunState): AgentStatus {
  return state.freshness === 'stale' ? 'idle' : GLYPH[state.kind]
}

const UNIT_KEYS: Readonly<Record<string, Key>> = {
  minute: 'unit.minute', minutes: 'unit.minute', hour: 'unit.hour', hours: 'unit.hour', day: 'unit.day', days: 'unit.day',
  week: 'unit.week', weeks: 'unit.week', month: 'unit.month', months: 'unit.month', year: 'unit.year', years: 'unit.year',
  tick: 'unit.tick', ticks: 'unit.tick',
}

/**
 * Localized label of a provider-declared tick unit; unknown units stay literal.
 * @param unit - Tick unit text from the run.
 * @param t - Translator.
 * @returns display unit.
 */
export function tickUnitLabel(unit: string, t: Translate): string {
  const key = UNIT_KEYS[unit.toLowerCase()]
  return key === undefined ? unit : t(key)
}

/**
 * Observation time as a short real clock time.
 * @param value - Real milliseconds.
 * @param locale - BCP 47 locale.
 * @returns hour, minute and second.
 */
export function observedClock(value: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(value)
}

/**
 * One state chip used by the directory, header and dialogs.
 * @param props.state - Synthesized run state.
 * @param props.locale - Formatting locale for the observation time.
 * @param props.time - Whether to show the simulated time beside the state.
 * @returns chip whose text names the state; a stale state reads "current state unknown · last observed".
 */
export function RunStateChip({ state, locale, time = true, t }: {
  state: RunState
  locale: string
  time?: boolean | undefined
  t: Translate
}) {
  const stale = state.freshness === 'stale'
  const name = t(state.headline)
  return <span className={css.stateChip} data-run-state={state.kind} data-freshness={state.freshness} role="status">
    <StatusGlyph status={runStateStatus(state)} />
    <strong>{stale ? t('state.currentUnknown') : name}</strong>
    {stale && <span>{t('state.lastObserved', { state: name })}</span>}
    {time && state.simTime !== undefined && <SimClock value={state.simTime.value} unit={state.simTime.unit}
      unitLabel={tickUnitLabel(state.simTime.unit, t)} label={t('time')} />}
    {state.observedAt !== undefined && <small>{t(stale ? 'state.lastObservedAt' : 'state.observedAt',
      { time: observedClock(state.observedAt, locale) })}</small>}
  </span>
}
