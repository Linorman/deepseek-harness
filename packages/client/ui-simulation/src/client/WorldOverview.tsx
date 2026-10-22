/** World run overview: dial, what needs you, governance, people, external world, matter flow and the live pulse. */
import { CalendarEditor } from './WorldCalendarEditor.tsx'
import type { SimulationCalendarState, SimulationProductCalendarInput } from '@clocky/clocky-client-runtime/client'
import type { CSSProperties, ReactNode } from 'react'
import type { SimulationProductPeopleCounts, SimulationReadState } from '@clocky/clocky-client-runtime/client'
import { Button, Menu, Tooltip, IconChevronDownOutline14 } from '@clocky/clocky-client-ui-primitives'
import { useEffect, useRef, useState } from 'react'
import { pulseAmbient, useLiveTransition } from '@clocky/clocky-client-ui-viz'
import type { SourceKind, WorldAttention, WorldOverviewView, WorldWindow } from './world-domain.ts'
import { windowValue } from './world-domain.ts'
import { Count, InfoHint, SourceKindBadge, WindowStatus, WindowCoverage, groupTime, proposalTitle } from './WorldFacts.tsx'
import type { WorldT } from './WorldFacts.tsx'
import { VoteTally } from './WorldVotes.tsx'
import { Feedback } from './Feedback.tsx'
import { WorldDial } from './WorldDial.tsx'
import { WorldPulse, caseStatusLabel, useWorldPulse } from './WorldPulse.tsx'
import css from './World.module.css'

/** One engine-level attention count the workspace already reads (reviews, unknown outcomes, requests to verify, a failed scheduler). */
export interface EngineAttention { readonly id: 'reviews' | 'unknown' | 'requests' | 'scheduler'; readonly count: number; readonly open: () => void }
/** Destinations the overview cards link into. */
export interface OverviewLinks {
  attention: (id: keyof WorldAttention) => void
  module: (module: 'cases' | 'organization' | 'governance' | 'external') => void
  caseStatus: (status: string) => void
  proposal: (id: string) => void
  /** Open the durable Records module (the pulse feed is not history). */
  records: () => void
}

const ATTENTION: readonly (keyof WorldAttention)[] = ['handoffRequired', 'outcomeUnknown', 'retirementUnconfirmed', 'implementationMissing', 'evidenceRequired']
const ATTENTION_GLYPH: Readonly<Record<keyof WorldAttention, string>> = {
  handoffRequired: '⚠', outcomeUnknown: '◌', retirementUnconfirmed: '⏸', implementationMissing: '⛔', evidenceRequired: '✎',
}
const KINDS: readonly SourceKind[] = ['simulated-actor', 'rule', 'director-ruling']

/**
 * Overview: the dial hero, what needs you, three domain cards, the matter-flow capsule and the live pulse. Each area
 * fails independently; unloaded numbers show the unavailable state, never zero.
 * @param props.runId - Run identity; live motion and the pulse feed reset when it changes.
 * @param props.window - World overview window (unpublished until the Host projects it).
 * @param props.engine - Engine-level attention the workspace already observed.
 * @param props.people - Independently authenticated whole-run personnel metadata from run inspection.
 * @param props.budget - Existing budget and model pool disclosure.
 * @param props.exportDefinition - Download the original definition in a syntax.
 * @returns overview content.
 */
export function WorldOverview({ runId, calendar, previewCalendar, submitCalendar, closeCalendar, recoverCalendar, cancelCalendar,
  window, people, refreshPeople, business, peopleApplicable = true,
  engine, budget, extras, links, reload, exportDefinition, exporting, connected, t }: {
  runId: string
  calendar?: SimulationCalendarState | undefined
  previewCalendar?: ((input: SimulationProductCalendarInput) => Promise<void>) | undefined
  submitCalendar?: (() => Promise<void>) | undefined
  closeCalendar?: (() => boolean) | undefined
  recoverCalendar?: ((runId: string) => Promise<void>) | undefined
  cancelCalendar?: (() => Promise<void>) | undefined
  window: WorldWindow<WorldOverviewView>
  people: SimulationReadState<SimulationProductPeopleCounts>
  refreshPeople: () => void
  /** Domain business card; it leads the domain cards because business responsibilities outrank engine mechanics. */
  business?: ReactNode
  /** False only when the domain projector declares employment not applicable; the card then collapses to that statement. */
  peopleApplicable?: boolean | undefined
  engine: readonly EngineAttention[]
  budget: ReactNode
  /** Further run tools shown inside Run management (request history, execution-mode note). */
  extras?: ReactNode
  links: OverviewLinks
  reload: (cursor?: string) => void
  exportDefinition: (format: 'json' | 'yaml') => void
  exporting: boolean
  connected: boolean
  t: WorldT
}) {
  const [exportMenu, setExportMenu] = useState(false)
  const shown = windowValue(window)
  const value = shown?.value
  const attention = value === undefined ? [] : ATTENTION.filter(id => value.attention[id] > 0)
  const engineItems = engine.filter(item => item.count > 0)
  const nothing = attention.length === 0 && engineItems.length === 0
  const pulse = useWorldPulse(runId, value, people.value, t)
  // A norm observed taking effect live answers with one ambient ring from the governance card (seal).
  const governanceCard = useRef<HTMLElement>(null)
  const norms = useLiveTransition(runId, value?.revision, value?.norms.active)
  const sealed = norms.live && norms.previous !== undefined && value !== undefined && value.norms.active > norms.previous
  useEffect(() => { if (sealed) pulseAmbient(governanceCard.current) }, [sealed, norms.generation])
  const exportTools = <Menu open={exportMenu} portal align="end" items={[{ id: 'json', label: t('world.overview.exportJson') },
    { id: 'yaml', label: t('world.overview.exportYaml') }]} footer={[{ type: 'label', id: 'notice', text: t('world.overview.exportNotice') }]}
  anchor={<Button size="sm" variant="secondary" disabled={!connected || exporting} aria-expanded={exportMenu}
    onClick={() => { setExportMenu(!exportMenu) }}>{t('world.overview.export')}<IconChevronDownOutline14 /></Button>}
  onClose={() => { setExportMenu(false) }} onSelect={(format) => { setExportMenu(false); exportDefinition(format as 'json' | 'yaml') }} />
  const personnel = people.value
  return <div className={css.overview}>
    <WorldDial identity={runId} value={value} tools={exportTools} t={t} />
    <section className={css.attention} aria-label={t('needsYou.title')} data-pending={!nothing || undefined}>
      <h2><span className={css.attentionDot} aria-hidden="true" />{t('needsYou.title')}</h2>
      {nothing ? <p className={css.muted}>{value === undefined && window.status === 'unpublished' && engineItems.length === 0
        ? t('needsYou.none') : t('world.overview.attention.none')}</p>
        : <div className={css.chips}>
          {attention.map(id => <button key={id} type="button" className={css.attentionChip} data-attention={id} onClick={() => { links.attention(id) }}>
            <span aria-hidden="true">{ATTENTION_GLYPH[id]}</span>{t(`world.overview.attention.${id}`, { count: value?.attention[id] ?? 0 })}</button>)}
          {engineItems.map(item => <button key={item.id} type="button" className={css.attentionChip} data-attention={item.id} onClick={item.open}>
            {t(`needsYou.${item.id}`, { count: item.count })}</button>)}
        </div>}
    </section>
    <WindowStatus window={window} retry={reload} t={t} />
    {/* Background freshness changes must not insert a new coverage row. */}
    {window.coverage?.complete === false && <WindowCoverage window={window} disabled={!connected}
      more={() => { reload(window.coverage?.nextCursor) }} t={t} />}
    <div className={css.domainGrid}>
      {business}
      <section ref={governanceCard} className={css.domainCard} data-domain="governance" aria-labelledby="world-governance">
        <header><h3 id="world-governance"><span className={css.domainDot} aria-hidden="true" />{t('world.overview.governance')}</h3>
          <button type="button" className={css.viewAll} onClick={() => { links.module('governance') }}>{t('world.viewAll')}</button></header>
        {value === undefined ? <Count value={undefined} t={t} /> : <>
          <dl className={css.heroFigures}>
            <div><dt>{t('world.overview.normsActive')}</dt><dd><Count value={value.norms.active} t={t} /></dd></div>
            <div><dt>{t('world.overview.normsPending')}</dt><dd><Count value={value.norms.knownNotEffective} t={t} /></dd></div>
          </dl>
          {value.proposals.length === 0 ? <p className={css.muted}>{t('world.overview.noProposals')}</p>
            : <div className={css.proposalStack}>{value.proposals.slice(0, 2).map(proposal => <button key={proposal.id} type="button"
              className={css.proposalRow} onClick={() => { links.proposal(proposal.id) }}>
              <span className={css.proposalTitle}><strong title={proposal.title.text}>{proposalTitle(proposal, t)}</strong>
                <span className={css.muted}>{t('world.gov.votingUntil', { at: groupTime(proposal.deadline) })}</span></span>
              <VoteTally value={proposal.tally} compact t={t} />
              <span className={css.muted}>{t('world.vote.summary', { for: proposal.tally.for, against: proposal.tally.against,
                abstain: proposal.tally.abstain, pending: proposal.tally.pending, threshold: proposal.tally.threshold })}</span>
            </button>)}</div>}
        </>}
      </section>
      {!peopleApplicable ? <section className={css.domainCard} data-domain="organization" data-collapsed aria-labelledby="world-people">
        <header><h3 id="world-people"><span className={css.domainDot} aria-hidden="true" />{t('world.overview.people')}</h3></header>
        <p className={css.muted}>{t('world.overview.people.notApplicable')}</p>
      </section> : <section className={css.domainCard} data-domain="organization" aria-labelledby="world-people">
        <header><h3 id="world-people"><span className={css.domainDot} aria-hidden="true" />{t('world.overview.people')}</h3>
          <InfoHint label={t('world.hint')} text={t('world.overview.people.scope')} /><span className={css.cardTools}>
            <Button size="sm" variant="ghost" disabled={!connected} onClick={refreshPeople}>{t('world.refresh')}</Button>
            <button type="button" className={css.viewAll} onClick={() => { links.module('organization') }}>{t('world.viewAll')}</button></span></header>
        {/* Keep existing figures visible during background reads; report real failures. */}
        <Feedback value={{ ...people, stale: false }} t={t} />
        <dl className={css.heroFigures}>
          <PeopleFigure id="employed" value={personnel?.employed} t={t} />
          <PeopleFigure id="nonTerminal" value={personnel?.nonTerminalPersons} t={t} />
        </dl>
        <p className={css.muted}>{t('world.overview.people.technicalMoved')}</p>
      </section>}
      <section className={css.domainCard} data-domain="external" aria-labelledby="world-external">
        <header><h3 id="world-external"><span className={css.domainDot} aria-hidden="true" />{t('world.overview.external')}</h3>
          <button type="button" className={css.viewAll} onClick={() => { links.module('external') }}>{t('world.viewAll')}</button></header>
        {value === undefined ? <Count value={undefined} t={t} /> : <>
          <dl className={css.heroFigures}><div><dt>{t('world.ext.identities')}</dt><dd><Count value={value.external.identities} t={t} /></dd></div></dl>
          <KindBars counts={value.external.byKind} t={t} />
          {value.external.latest !== undefined && <p className={css.latestLine}>{t('world.overview.external.latest',
            { summary: value.external.latest.summary.text, at: groupTime(value.external.latest.at) })}</p>}
        </>}
      </section>
    </div>
    <section className={css.flow} aria-labelledby="world-flow">
      <header><h3 id="world-flow">{t('world.overview.flow')}</h3>
        <InfoHint label={t('world.hint')} text={t('world.overview.flow.note')} />
        <button type="button" className={css.viewAll} onClick={() => { links.module('cases') }}>{t('world.viewAll')}</button></header>
      {value === undefined ? <Count value={undefined} t={t} /> : <CaseFlow counts={value.caseFlow} open={links.caseStatus} t={t} />}
    </section>
    <WorldPulse entries={pulse.entries} overflow={pulse.overflow} unit={value?.tickUnit} openRecords={links.records} t={t} />
    {/* Low-frequency tools live together behind one disclosure: future calendar, budget and model pool, run requests. */}
    <details className={css.manage} data-world-management>
      <summary><span className={css.manageIcon} aria-hidden="true" /><span className={css.manageTitle}>{t('world.manage.title')}</span>
        <span className={css.manageHint}>{t('world.manage.hint')}</span><span className={css.manageChevron} aria-hidden="true">▸</span></summary>
      <div className={css.manageBody}>
        {value !== undefined && value.calendars !== undefined && calendar !== undefined && previewCalendar !== undefined
          && submitCalendar !== undefined && closeCalendar !== undefined && <section className={css.manageCard}><CalendarEditor view={value}
          state={calendar} preview={previewCalendar} submit={submitCalendar} close={closeCalendar} recover={recoverCalendar}
          cancel={cancelCalendar} connected={connected && !shown?.stale} t={t} /></section>}
        {/* Technical bindings (resident seats, writers, participants, activations) are diagnostics, not social facts. */}
        <section className={css.manageCard} aria-label={t('world.overview.people.technical')} data-people-technical>
          <h3>{t('world.overview.people.technical')}</h3>
          <div className={css.seatRow}>
            <Tooltip label={t('world.overview.people.resident.hint')} side="top" delayMs={300}>
              <span className={css.figureLabel} tabIndex={0}>{t('world.overview.people.resident')}</span></Tooltip>
            {personnel === undefined ? <Count value={undefined} t={t} />
              : <SeatStrip filled={personnel.resident} limit={personnel.residentLimit} t={t} />}
          </div>
          <dl className={css.minorFigures}>
            <PeopleFigure id="writers" value={personnel?.unreleasedWriters} t={t} />
            <PeopleFigure id="history" value={personnel?.history.status === 'observed' ? personnel.history.participants : undefined} t={t} />
            <PeopleFigure id="activations" value={personnel?.history.status === 'observed' ? personnel.history.activations : undefined} t={t} />
          </dl>
          {personnel?.history.status === 'unavailable' && <p className={css.muted}>{t('world.overview.people.historyUnavailable')}</p>}
        </section>
        <section className={css.manageCard} aria-label={t('world.overview.budget')}>{budget}</section>
        {extras !== undefined && <section className={css.manageCard}>{extras}</section>}
      </div>
    </details>
  </div>
}

/** One personnel figure with its definition tooltip; unobserved values show the unavailable fact, never zero. */
function PeopleFigure({ id, value, t }: { id: 'employed' | 'nonTerminal' | 'writers' | 'history' | 'activations'; value: number | undefined; t: WorldT }) {
  return <div><Tooltip label={t(`world.overview.people.${id}.hint`)} side="top" delayMs={300}>
    <dt tabIndex={0}>{t(`world.overview.people.${id}`)}</dt></Tooltip>
  <dd><Count value={value} t={t} /></dd></div>
}

/** Seats drawn individually up to this limit; larger limits use a proportional bar. */
const SEAT_LIMIT = 24

/**
 * Resident writers against the run limit as seats: filled seats are resident, hollow seats are free capacity.
 * A count above the limit is drawn as an error rather than clipped.
 * @param props.filled - Resident writers.
 * @param props.limit - Run limit.
 * @returns seat strip with the exact fraction.
 */
export function SeatStrip({ filled, limit, t }: { filled: number; limit: number; t: WorldT }) {
  const over = filled > limit
  const label = t('world.overview.seats', { filled, limit })
  return <span className={css.seatStrip} data-state={over ? 'over' : filled === limit ? 'full' : undefined} role="img" aria-label={label}>
    {limit <= SEAT_LIMIT && !over ? <span className={css.seats} aria-hidden="true">{Array.from({ length: limit }, (_, index) =>
      <span key={index} data-seat={index < filled ? 'filled' : 'free'} />)}</span>
      : <span className={css.seatBar} aria-hidden="true"><span style={{ '--share': Math.min(filled / Math.max(limit, 1), 1) } as CSSProperties} /></span>}
    <span className={css.figure} aria-hidden="true">{filled}<span className={css.muted}>/{limit}</span></span>
  </span>
}

/**
 * External sources as horizontal bars normalised to the largest count on this card (magnitude, not share).
 * @param props.counts - Counts by source kind.
 * @returns list of badge, bar and exact figure.
 */
function KindBars({ counts, t }: { counts: WorldOverviewView['external']['byKind']; t: WorldT }) {
  const max = Math.max(1, ...KINDS.map(kind => counts[kind] ?? 0))
  return <ul className={css.kindBars}>{KINDS.map((kind) => {
    const count = counts[kind] ?? 0
    return <li key={kind}><SourceKindBadge kind={kind} t={t} />
      <span className={css.kindBar} aria-hidden="true"><span style={{ '--share': count / max } as CSSProperties} data-empty={count === 0 || undefined} /></span>
      <Count value={count} t={t} /></li>
  })}</ul>
}

/**
 * Matter flow as one segmented capsule: each request state is a clickable segment sized by its count (at least a
 * touch target wide); states with zero matters stay listed after it. Counts, not progress: nothing flows.
 * @param props.counts - Host counts by status.
 * @param props.open - Open matters filtered by a status.
 * @returns capsule plus the zero-count legend.
 */
function CaseFlow({ counts, open, t }: { counts: WorldOverviewView['caseFlow']; open: (status: string) => void; t: WorldT }) {
  const total = counts.reduce((sum, item) => sum + item.count, 0)
  if (total === 0) return <p className={css.muted}>{t('world.overview.flow.empty')}</p>
  const present = counts.filter(item => item.count > 0), empty = counts.filter(item => item.count === 0)
  return <div className={css.caseFlow}>
    <ol className={css.flowCapsule}>{present.map(item => <li key={item.status} style={{ flexGrow: item.count }}>
      <button type="button" data-status={item.status} title={`${caseStatusLabel(item.status, t)} ${String(item.count)}`}
        onClick={() => { open(item.status) }}>
        <span className={css.flowLabel}>{caseStatusLabel(item.status, t)}</span>{' '}<span className={css.figure}>{item.count}</span></button>
    </li>)}</ol>
    {empty.length > 0 && <p className={css.flowZero}>{empty.map(item => <button key={item.status} type="button" data-status={item.status}
      onClick={() => { open(item.status) }}><span className={css.swatch} aria-hidden="true" />{caseStatusLabel(item.status, t)} 0</button>)}</p>}
  </div>
}
