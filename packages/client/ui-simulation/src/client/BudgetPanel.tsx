/**
 * Budget and usage, kept in separate meanings: configured admission limits are not a bill; reserved, settled and unknown
 * usage are summed by the Host per category and token kind and never merged here. Unknown usage is never shown as zero
 * and no monetary cost is estimated. The Host-wide model limit is labeled as shared with every run.
 */
import type { SimulationProductControl, SimulationProductRunInspection } from '@clocky/clocky-client-runtime/client'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'

type Translate = (key: Key, params?: Record<string, string>) => string
/** Host token attribution carried in the run's metrics. */
export type TokenAttribution = NonNullable<NonNullable<SimulationProductRunInspection['world']>['metrics']>['tokenAttribution']
type Bucket = TokenAttribution['total']

const CATEGORIES = ['business-choice', 'adjudication', 'result-closeout', 'communication', 'compaction', 'unknown'] as const
const KINDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const

/**
 * Group the digits of an exact count; decimal strings stay exact beyond the safe-integer range.
 * @param value - Non-negative count or decimal string.
 * @returns grouped text.
 */
function grouped(value: number | string): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * @param props.budget - Configured run limits from the control; absent when management cannot be read.
 * @param props.attribution - Host attribution; absent on older peers, which then say so instead of zero.
 * @param props.unit - Localized simulated time unit of the budget interval.
 * @returns the panel.
 */
export function BudgetPanel({ budget, attribution, unit, t }: {
  budget?: SimulationProductControl['budget'] | undefined
  attribution?: TokenAttribution | undefined
  unit: string
  t: Translate
}) {
  const total = attribution?.total
  const unknownAttempts = total?.statuses.unknown ?? 0
  return <section className={css.budgetPanel} aria-label={t('budget.title')} data-budget-panel>
    <h3>{t('budget.title')}</h3>
    <dl className={css.budgetFacts} data-budget-group="limits">
      <div><dt>{t('budget.perRequest')}</dt><dd>{budget === undefined ? t('unavailable') : grouped(budget.tokensPerRequest)}</dd></div>
      <div><dt>{t('budget.perInterval')}</dt><dd>{budget === undefined ? t('unavailable')
        : t('budget.perIntervalValue', { tokens: grouped(budget.tokensPerInterval), interval: grouped(budget.interval), unit })}</dd></div>
    </dl>
    <p className={css.muted}>{t('budget.limitsNotice')}</p>
    {total === undefined ? <p role="status" data-budget-usage="unavailable">{t('budget.usageUnavailable')}</p> : <>
      <dl className={css.budgetFacts} data-budget-group="usage">
        <div><dt>{t('budget.reserved')}</dt><dd>{grouped(total.outstandingReservedTokens)}</dd></div>
        <div><dt>{t('budget.settled')}</dt><dd>{grouped(sum(total.settled))}</dd></div>
        <div data-unknown={unknownAttempts > 0 || undefined}><dt>{t('budget.unknown')}</dt>
          <dd>{unknownAttempts === 0 ? t('budget.unknownNone') : t('budget.unknownValue', { attempts: grouped(unknownAttempts),
            reported: grouped(sum(total.unknownReported)) })}</dd></div>
      </dl>
      <div className={css.budgetTableWrap}><table className={css.budgetTable}>
        <caption className={css.visuallyHidden}>{t('budget.byCategory')}</caption>
        <thead><tr><th scope="col">{t('budget.category')}</th><th scope="col">{t('budget.attempts')}</th>
          {KINDS.map(kind => <th key={kind} scope="col">{t(`budget.kind.${kind}`)}</th>)}<th scope="col">{t('budget.unknownAttempts')}</th></tr></thead>
        <tbody>{CATEGORIES.map(category => <Row key={category} id={category} bucket={attribution?.categories[category]} t={t} />)}
          <Row id="total" bucket={total} t={t} /></tbody>
      </table></div>
      <p className={css.muted}>{t('budget.settledNotice')}</p>
    </>}
    {budget !== undefined && <p className={css.hostShared} data-budget-group="host">
      <span className={css.hostPoolScope}>{t('metrics.hostScope')}</span>{t('budget.hostShared', { limit: grouped(budget.sharedModelLimit) })}</p>}
  </section>
}

function Row({ id, bucket, t }: { id: (typeof CATEGORIES)[number] | 'total'; bucket: Bucket | undefined; t: Translate }) {
  return <tr data-category={id}><th scope="row">{t(`budget.category.${id}`)}</th>
    <td>{bucket === undefined ? '—' : grouped(bucket.attempts)}</td>
    {KINDS.map((kind) => { const value = bucket?.settled[kind]; return <td key={kind}>{value === undefined ? '—' : grouped(value)}</td> })}
    <td>{bucket === undefined ? '—' : grouped(bucket.statuses.unknown)}</td></tr>
}

/** Provider-reported total; cache buckets a provider does not report are absent, not zero, and add nothing. */
function sum(usage: Bucket['settled']): number {
  return usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}
