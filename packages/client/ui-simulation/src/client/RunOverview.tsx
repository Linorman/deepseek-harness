/** Progress uses existing bounded observations; diagnostics and Host-wide resources have separate disclosure. */
import type { SimulationProductRunStatus, SimulationProductModelPoolObservation, SimulationProductControl } from '@clocky/clocky-client-runtime/client'
import { BudgetPanel } from './BudgetPanel.tsx'
import { tickUnitLabel } from './RunStateChip.tsx'
import type { CSSProperties } from 'react'
import { ModelPool } from './RunStatus.tsx'
import { SeatMap } from './Visuals.tsx'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'

/**
 * Interval token budget as one bar: the charged segment against the limit,
 * with unknown inference attempts marked separately because their charge is
 * not exact model consumption.
 */
function BudgetMeter({ charged, limit, unknownAttempts, t }: {
  charged: number
  limit: number
  unknownAttempts: number
  t: (key: Key) => string
}) {
  const share = limit <= 0 ? 0 : Math.min(1, charged / limit)
  return <div className={css.budget}>
    <div className={css.budgetBar} role="meter" aria-label={t('metrics.tokens')}
      aria-valuemin={0} aria-valuemax={limit} aria-valuenow={charged} aria-valuetext={`${String(charged)} / ${String(limit)}`}>
      <span className={css.budgetCharged} style={{ '--budget-share': String(share) } as CSSProperties} />
    </div>
    <div className={css.budgetLegend}>
      <span>{`${String(charged)} / ${String(limit)}`}</span>
      {unknownAttempts > 0 && <span className={css.budgetUnknown}>{t('metrics.unknownModel')} {unknownAttempts}</span>}
    </div>
  </div>
}

/**
 * @param props - Authorized native counters and separately scoped Host pool observations.
 * @returns primary progress facts followed by optional budget and diagnostic detail; absent values stay unavailable.
 */
export function RunOverview({ value, pool, budget, t }: {
  value?: SimulationProductRunStatus | undefined
  pool?: SimulationProductModelPoolObservation | undefined
  /** Configured run limits from the control, for the usage panel. */
  budget?: SimulationProductControl['budget'] | undefined
  t: (key: Key, vars?: Record<string, unknown>) => string
}) {
  const world = value?.status === 'observed' ? value.world : undefined
  const metrics = world?.metrics
  const unavailable = t('unavailable')
  const observedPool = pool?.status === 'observed' ? pool : undefined
  return <section className={css.runOverview} aria-label={t('metrics.run')}>
    <div className={css.overviewHeading}>
      <h2>{t('overview.progress')}</h2>
      {/* Host-wide and real-time: kept apart from this run's simulated-time budget. */}
      <span className={css.hostPoolChip} title={t('metrics.poolNotice')} data-host-pool={observedPool === undefined ? 'unavailable' : 'observed'}>
        <span className={css.hostPoolScope}>{t('metrics.hostScope')}</span>
        {observedPool === undefined
          ? t('metrics.poolChipUnavailable')
          : t('metrics.poolChip', { active: observedPool.active, limit: observedPool.limit, queued: observedPool.queued })}
      </span>
    </div>
    {metrics !== undefined && <div className={css.pulse}>
      <BudgetMeter charged={metrics.budgets.tokens.charged} limit={metrics.budgets.tokens.limit}
        unknownAttempts={metrics.budgets.tokens.unknownAttempts} t={t} />
      <SeatMap used={metrics.residentSlots.used} limit={metrics.residentSlots.limit}
        recovery={metrics.residentSlots.recoveryRequired} t={t} />
    </div>}
    <dl className={css.primaryMetrics}>
      <div><dt>{t('entityCount')}</dt><dd>{world?.entityCount ?? unavailable}</dd></div>
      <div><dt>{t('metrics.tokens')}</dt><dd>{metrics === undefined ? unavailable
        : `${metrics.budgets.tokens.charged} / ${metrics.budgets.tokens.limit}`}</dd></div>
      <div><dt>{t('metrics.pendingDecisions')}</dt><dd>{metrics?.pendingDecisionCount ?? unavailable}</dd></div>
      <div><dt>{t('metrics.pendingOperations')}</dt><dd>{metrics?.pendingExternalOperationCount ?? unavailable}</dd></div>
    </dl>
    <p className={css.muted}>{t('metrics.chargedNotice')}</p>
    <details className={css.overviewDetails}><summary>{t('overview.budgetDetails')}</summary>
      <dl className={css.metrics}>
        <div><dt>{t('decisionCount')}</dt><dd>{world?.decisionCount ?? unavailable}</dd></div>
        <div><dt>{t('operationCount')}</dt><dd>{world?.operationCount ?? unavailable}</dd></div>
        <div><dt>{t('metrics.interval')}</dt><dd>{metrics === undefined ? unavailable
          // metrics comes from this observed world's optional metrics field.
          : `${metrics.budgets.interval} / ${metrics.budgets.width} ${(world as NonNullable<typeof world>).tickUnit.text}`}</dd></div>
        <div><dt>{t('metrics.unknownModel')}</dt><dd>{metrics?.budgets.tokens.unknownAttempts ?? unavailable}</dd></div>
        <div><dt>{t('metrics.decisions')}</dt><dd>{metrics === undefined ? unavailable
          : `${metrics.budgets.decisions.used} / ${metrics.budgets.decisions.limit}`}</dd></div>
        <div><dt>{t('metrics.messages')}</dt><dd>{metrics === undefined ? unavailable
          : `${metrics.budgets.messages.used} / ${metrics.budgets.messages.limit}`}</dd></div>
        <div><dt>{t('metrics.resident')}</dt><dd>{metrics === undefined ? unavailable
          : `${metrics.residentSlots.used} / ${metrics.residentSlots.limit}`}</dd></div>
        <div><dt>{t('status.residentRecovery')}</dt><dd>{metrics?.residentSlots.recoveryRequired ?? unavailable}</dd></div>
        <div><dt>{t('metrics.unknownOperations')}</dt><dd>{metrics?.unknownOperationCount ?? unavailable}</dd></div>
      </dl>
    </details>
    <BudgetPanel budget={budget} attribution={metrics?.tokenAttribution} unit={tickUnitLabel(world?.tickUnit.text ?? '', t)} t={t} />
    <details className={css.overviewDetails}><summary>{t('directory.hostResources')}</summary><ModelPool value={pool} t={t} /></details>
  </section>
}
