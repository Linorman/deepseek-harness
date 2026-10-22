/**
 * Domain business summaries as returned by the Host's projector: the business action label, three independent result
 * layers and covered counts. The UI never derives success or computes measures; absent summaries state why.
 */
import type { SimulationProductWorldCasesPage } from '@clocky/clocky-client-runtime/client'
import type { WorldT } from './WorldFacts.tsx'
import css from './World.module.css'
import workspaceCss from './Workspace.module.css'
import { DisclosedValue } from './DisclosedValue.tsx'

/** Host business summary disclosure carried by every case summary. */
export type SimulationProductWorldBusinessSummary = SimulationProductWorldCasesPage['items'][number]['businessSummary']
/** Allowed projector output. */
export type BusinessSummaryValue = Extract<SimulationProductWorldBusinessSummary, { status: 'allowed' }>['value']
type Tone = 'done' | 'failed' | 'waiting' | 'needs-you' | 'idle'

const SUBMISSION_TONE: Record<BusinessSummaryValue['submission'], Tone> = { accepted: 'idle', rejected: 'failed', cancelled: 'idle' }
const EXECUTION_TONE: Record<BusinessSummaryValue['execution'], Tone> = {
  pending: 'waiting', accepted: 'done', rejected: 'failed', unknown: 'needs-you', 'not-applicable': 'idle' }
const OUTCOME_TONE: Record<BusinessSummaryValue['businessOutcome'], Tone> = {
  achieved: 'done', 'not-achieved': 'failed', unknown: 'needs-you', 'not-applicable': 'idle' }

/**
 * Business action of one case: the projector label, or the reason no label is shown.
 * @param props.summary - Host business summary disclosure.
 * @param props.operation - Technical operation name kept as secondary text.
 * @returns label plus the technical operation, never "unknown domain" for a working provider.
 */
export function BusinessAction({ summary, operation, t }: {
  summary: SimulationProductWorldBusinessSummary
  operation: string
  t: WorldT
}) {
  return <span className={css.businessAction} data-business-summary={summary.status}>
    {summary.status === 'allowed' ? <strong>{summary.value.label}</strong>
      : <span className={css.muted}>{t(`world.cases.summary.${summary.status}`)}</span>}
    <small className={css.muted}>{operation}</small>
  </span>
}

/**
 * Submission, execution and business outcome as three labelled layers; a judge rejection is never success-colored.
 * @param props.value - Allowed projector output.
 * @param props.compact - Table-row form without layer names in view (they stay in the accessible text).
 * @returns the three layers.
 */
export function ResultLayers({ value, compact = false, t }: { value: BusinessSummaryValue; compact?: boolean; t: WorldT }) {
  const layers = [
    { id: 'submission', tone: SUBMISSION_TONE[value.submission], text: t(`world.result.submission.${value.submission}`) },
    { id: 'execution', tone: EXECUTION_TONE[value.execution], text: t(`world.result.execution.${value.execution}`) },
    { id: 'outcome', tone: OUTCOME_TONE[value.businessOutcome], text: t(`world.result.outcome.${value.businessOutcome}`) },
  ] as const
  return <span className={css.resultLayers} data-compact={compact || undefined}>
    {layers.map(layer => <span key={layer.id} className={css.resultLayer} data-layer={layer.id} data-tone={layer.tone}>
      <span className={compact ? workspaceCss.visuallyHidden : css.muted}>{t(`world.result.${layer.id}`)}</span>{layer.text}
    </span>)}
  </span>
}

/**
 * Newest allowed projector output on a loaded window, by Native revision.
 * @param summaries - Business summary disclosures.
 * @returns the newest allowed value, or undefined when none is allowed.
 */
export function latestBusinessSummary(summaries: readonly SimulationProductWorldBusinessSummary[]): BusinessSummaryValue | undefined {
  return summaries.flatMap(summary => summary.status === 'allowed' ? [summary.value] : [])
    .reduce<BusinessSummaryValue | undefined>((best, value) =>
      best === undefined || value.nativeRevision > best.nativeRevision ? value : best, undefined)
}

/**
 * Whether the projector declares employment facts not applicable to this domain; only that declaration collapses the people card.
 * @param latest - Newest allowed projector output.
 * @returns true when both employment counts are declared not applicable.
 */
export function peopleNotApplicable(latest: BusinessSummaryValue | undefined): boolean {
  return latest?.counts.employedPeople.status === 'not-applicable' && latest.counts.employmentRelationships.status === 'not-applicable'
}

const COUNTS = ['openOrders', 'openLoans', 'businessEntities', 'firms', 'alliances', 'organizations', 'memberships',
  'employmentRelationships', 'founderRepresentedEntities', 'employedPeople', 'technicalRoles', 'independentSessions'] as const
/** Technical bindings, kept apart from business and social counts. */
const TECHNICAL = new Set<string>(['technicalRoles', 'independentSessions'])

/**
 * Domain business card: the newest allowed projector counts on the loaded window with their revision, or why none show.
 * Counts are the projector's; "not applicable", withheld and unknown stay distinct from zero.
 * @param props.summaries - Business summary disclosures from the loaded cases, newest first is not assumed.
 * @param props.loaded - Whether a case window has been read at all.
 * @returns a card section.
 */
export function DomainBusinessCard({ summaries, loaded, open, t }: {
  summaries: readonly SimulationProductWorldBusinessSummary[]
  loaded: boolean
  open: () => void
  t: WorldT
}) {
  const latest = latestBusinessSummary(summaries)
  const reason = !loaded ? 'world.business.notLoaded' : summaries.length === 0 ? 'world.business.noCases'
    : summaries.some(summary => summary.status === 'withheld') ? 'world.cases.summary.withheld'
      : summaries.some(summary => summary.status === 'unknown') ? 'world.cases.summary.unknown' : 'world.cases.summary.unsupported'
  return <section className={css.domainCard} data-domain="business" aria-labelledby="world-business">
    <header><h3 id="world-business"><span className={css.domainDot} aria-hidden="true" />{t('world.business.title')}</h3>
      <button type="button" className={css.viewAll} onClick={open}>{t('world.viewAll')}</button></header>
    {latest === undefined ? <p className={css.muted} data-business-unavailable>{t(reason)}</p> : <>
      <p className={css.muted}>{t('world.business.scope', { revision: latest.nativeRevision })}</p>
      <dl className={css.businessCounts}>{COUNTS.map((id) => {
        const count = latest.counts[id]
        return <div key={id} data-count={id} data-technical={TECHNICAL.has(id) || undefined}>
          <dt>{t(`world.business.count.${id}`)}</dt>
          <dd data-state={count.status}>{count.status === 'known' ? count.value : <DisclosedValue state={count.status} compact t={t} />}</dd>
        </div>
      })}</dl>
      <p className={css.muted}>{t('world.business.definition')}</p>
    </>}
  </section>
}
