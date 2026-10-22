/**
 * World pulse: changes this overview observed live since it opened. It is not history — the first value of a run
 * is the baseline, a reload starts empty, and the Records module keeps the durable event log.
 */
import { useEffect, useRef, useState } from 'react'
import type { SimulationProductPeopleCounts } from '@clocky/clocky-client-runtime/client'
import type { WorldAttention, WorldOverviewView } from './world-domain.ts'
import { compareTime } from './world-domain.ts'
import { InfoHint, displayText, groupTime } from './WorldFacts.tsx'
import type { WorldT } from './WorldFacts.tsx'
import css from './World.module.css'

/** Domain a pulse entry belongs to; it selects the entry's marker colour and nothing else. */
export type PulseDomain = 'time' | 'governance' | 'organization' | 'external' | 'cases' | 'attention'

/** One observed change. */
export interface PulseEntry {
  readonly id: number
  /** Simulated time of the observation that carried the change. */
  readonly at: string
  readonly domain: PulseDomain
  readonly text: string
}

/** Entries kept on the page; older ones merge into an overflow count. */
export const PULSE_LIMIT = 20

const ATTENTION_KEYS: readonly (keyof WorldAttention)[] = ['handoffRequired', 'outcomeUnknown', 'retirementUnconfirmed',
  'implementationMissing', 'evidenceRequired']
const PEOPLE_KEYS = ['employed', 'nonTerminalPersons', 'resident', 'unreleasedWriters'] as const
const PEOPLE_LABEL = { employed: 'employed', nonTerminalPersons: 'nonTerminal', resident: 'resident', unreleasedWriters: 'writers' } as const

/**
 * Localized request-state label; unknown extension states stay literal.
 * @param status - Host request state.
 * @param t - Namespace translator.
 * @returns label text.
 */
export function caseStatusLabel(status: string, t: WorldT): string {
  const key = `cases.status.${status}` as Parameters<WorldT>[0]
  const text = t(key)
  return text === key ? status : text
}

/**
 * Describe what changed between two overview projections of the same run.
 * @param previous - Earlier projection.
 * @param next - Later projection.
 * @param t - Namespace translator.
 * @returns domain-tagged sentences, in reading order.
 */
export function overviewChanges(previous: WorldOverviewView, next: WorldOverviewView, t: WorldT): { domain: PulseDomain; text: string }[] {
  const out: { domain: PulseDomain; text: string }[] = []
  if (compareTime(next.now, previous.now) !== 0) {
    out.push({ domain: 'time', text: t('world.pulse.time', { from: groupTime(previous.now), to: groupTime(next.now), unit: next.tickUnit }) })
  }
  if (next.norms.active !== previous.norms.active) {
    out.push({ domain: 'governance', text: t('world.pulse.norms', { from: previous.norms.active, to: next.norms.active }) })
  }
  if (next.norms.knownNotEffective !== previous.norms.knownNotEffective) {
    out.push({ domain: 'governance', text: t('world.pulse.pendingNorms', { from: previous.norms.knownNotEffective, to: next.norms.knownNotEffective }) })
  }
  for (const proposal of next.proposals) {
    const before = previous.proposals.find(item => item.id === proposal.id)
    const title = displayText(proposal.title.text)
    if (before === undefined) out.push({ domain: 'governance', text: t('world.pulse.proposal', { title }) })
    else if (before.status !== proposal.status) {
      out.push({ domain: 'governance', text: t('world.pulse.proposalStatus', { title, status: t(`world.gov.status.${proposal.status}`) }) })
    } else if (before.tally.for !== proposal.tally.for || before.tally.against !== proposal.tally.against
      || before.tally.abstain !== proposal.tally.abstain) {
      out.push({ domain: 'governance', text: t('world.pulse.votes', { title, for: proposal.tally.for,
        against: proposal.tally.against, abstain: proposal.tally.abstain }) })
    }
  }
  const counts = new Map(previous.caseFlow.map(item => [item.status, item.count]))
  for (const item of next.caseFlow) {
    const before = counts.get(item.status) ?? 0
    if (before !== item.count) out.push({ domain: 'cases', text: t('world.pulse.cases', { status: caseStatusLabel(item.status, t), from: before, to: item.count }) })
  }
  if (next.external.identities !== previous.external.identities) {
    out.push({ domain: 'external', text: t('world.pulse.identities', { from: previous.external.identities, to: next.external.identities }) })
  }
  const latest = next.external.latest
  const before = previous.external.latest
  if (latest !== undefined && (before?.at !== latest.at || before.summary.text !== latest.summary.text)) {
    out.push({ domain: 'external', text: t('world.pulse.interaction', { summary: latest.summary.text }) })
  }
  for (const id of ATTENTION_KEYS) {
    if (next.attention[id] !== previous.attention[id]) {
      out.push({ domain: 'attention', text: t(`world.overview.attention.${id}`, { count: next.attention[id] }) })
    }
  }
  return out
}

interface PulseState { identity: string; entries: readonly PulseEntry[]; overflow: number }
interface Seen { identity: string; value?: WorldOverviewView | undefined; people?: SimulationProductPeopleCounts | undefined }

/**
 * Collect live changes for one run while this component stays mounted.
 * @param identity - Run identity; a new run resets the feed.
 * @param value - Latest overview projection, if any.
 * @param people - Latest whole-run personnel counts, if observed.
 * @param t - Namespace translator.
 * @returns newest-first entries and how many older ones were merged away.
 */
export function useWorldPulse(identity: string, value: WorldOverviewView | undefined,
  people: SimulationProductPeopleCounts | undefined, t: WorldT): { entries: readonly PulseEntry[]; overflow: number } {
  const [state, setState] = useState<PulseState>({ identity, entries: [], overflow: 0 })
  const seen = useRef<Seen>({ identity })
  const sequence = useRef(0)
  useEffect(() => {
    const previous = seen.current
    seen.current = { identity, value: value ?? (previous.identity === identity ? previous.value : undefined),
      people: people ?? (previous.identity === identity ? previous.people : undefined) }
    if (previous.identity !== identity) { setState({ identity, entries: [], overflow: 0 }); return }
    const found: { domain: PulseDomain; text: string }[] = []
    // The first projection of a run is the baseline; only later revisions describe observed change.
    if (value !== undefined && previous.value !== undefined && value.revision > previous.value.revision) {
      found.push(...overviewChanges(previous.value, value, t))
    }
    if (people !== undefined && previous.people !== undefined) {
      for (const key of PEOPLE_KEYS) {
        if (people[key] !== previous.people[key]) {
          found.push({ domain: 'organization', text: t('world.pulse.people', { label: t(`world.overview.people.${PEOPLE_LABEL[key]}`),
            from: previous.people[key], to: people[key] }) })
        }
      }
    }
    if (found.length === 0) return
    const at = value?.now ?? previous.value?.now ?? '0'
    const added = found.map(item => ({ ...item, at, id: ++sequence.current }))
    setState((current) => {
      const merged = [...added.reverse(), ...current.identity === identity ? current.entries : []]
      return { identity, entries: merged.slice(0, PULSE_LIMIT),
        overflow: (current.identity === identity ? current.overflow : 0) + Math.max(0, merged.length - PULSE_LIMIT) }
    })
  }, [identity, value, people, t])
  return state.identity === identity ? state : { entries: [], overflow: 0 }
}

/**
 * Newest-first list of live observations with a scope caption that keeps it from reading as history.
 * @param props.entries - Live entries.
 * @param props.overflow - Older entries merged away.
 * @param props.unit - Tick unit for entry times.
 * @param props.openRecords - Open the durable Records module.
 * @returns section.
 */
export function WorldPulse({ entries, overflow, unit, openRecords, t }: {
  entries: readonly PulseEntry[]
  overflow: number
  unit: string | undefined
  openRecords: () => void
  t: WorldT
}) {
  return <section className={css.pulse} aria-labelledby="world-pulse">
    <header><h3 id="world-pulse"><span className={css.pulseBeacon} aria-hidden="true" data-active={entries.length > 0 || undefined} />
      {t('world.pulse.title')}</h3><InfoHint label={t('world.hint')} text={t('world.pulse.scope')} />
    <button type="button" className={css.viewAll} onClick={openRecords}>{t('world.pulse.records')}</button></header>
    {entries.length === 0 ? <p className={css.muted}>{t('world.pulse.empty')}</p>
      : <ol className={css.pulseList} aria-live="polite">{entries.map(entry => <li key={entry.id} data-domain={entry.domain}>
        <span className={css.pulseTime} title={unit === undefined ? entry.at : `${entry.at} ${unit}`}>{groupTime(entry.at)}</span>
        <span className={css.pulseMark} aria-hidden="true" />
        <span className={css.pulseText}>{entry.text}</span>
      </li>)}</ol>}
    {overflow > 0 && <p className={css.muted}>{t('world.pulse.overflow', { count: overflow })}</p>}
  </section>
}
