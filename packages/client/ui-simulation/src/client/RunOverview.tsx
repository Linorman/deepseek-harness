/** Progress uses existing bounded observations; diagnostics and Host-wide resources have separate disclosure. */
import type { SimulationProductRunStatus, SimulationProductModelPoolObservation } from '@clocky/clocky-client-runtime/client'
import { ModelPool } from './RunStatus.tsx'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'

/**
 * @param props - Authorized native counters and separately scoped Host pool observations.
 * @returns primary progress facts followed by optional budget and diagnostic detail; absent values stay unavailable.
 */
export function RunOverview({ value, pool, t }: {
  value?: SimulationProductRunStatus | undefined
  pool?: SimulationProductModelPoolObservation | undefined
  t: (key: Key) => string
}) {
  const world = value?.status === 'observed' ? value.world : undefined
  const metrics = world?.metrics
  const unavailable = t('unavailable')
  return <section className={css.runOverview} aria-label={t('metrics.run')}>
    <h2>{t('overview.progress')}</h2>
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
          : `${metrics.budgets.interval} / ${metrics.budgets.width} ${world?.tickUnit.text ?? t('simulationTicks')}`}</dd></div>
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
    <details className={css.overviewDetails}><summary>{t('directory.hostResources')}</summary><ModelPool value={pool} t={t} /></details>
  </section>
}
