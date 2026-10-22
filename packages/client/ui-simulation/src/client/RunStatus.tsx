/** Status helpers and the Host model-pool observation; run state wording belongs to `run-state.ts`. */
import type { SimulationProductModelPoolObservation } from '@clocky/clocky-client-runtime/client'
import { FactValue } from '@clocky/clocky-client-ui-primitives'
import type { AgentStatus } from '@clocky/clocky-client-ui-primitives'
import type { Key } from './locales.ts'

/** Localized honesty-state words for {@link FactValue}. */
export function factLabels(t: Translate) {
  return { unavailable: t('unavailable'), unknown: t('unavailable'), stale: t('status.staleShort'),
    withheld: t('unavailable'), truncated: t('truncate'), expand: t('status.expand') }
}

/** Saved run phase as an agent state; a persisted phase never claims active scheduling. */
export function phaseStatus(phase: string | undefined): AgentStatus {
  switch (phase) {
    case 'running': return 'waiting'
    case 'stalled': return 'blocked'
    case 'completed': return 'done'
    case 'failed': return 'failed'
    default: return 'idle'
  }
}

/** Driver observation as an agent state; only an observed working driver animates. */
export function driverStatus(driver: string | undefined): AgentStatus {
  switch (driver) {
    case 'scheduled': case 'advancing': case 'checkpointing': return 'running'
    case 'waiting': case 'retiring': return 'waiting'
    case 'completed': return 'done'
    case 'failed': return 'failed'
    default: return 'idle'
  }
}

type Translate = (key: Key) => string
/** Host-wide semaphore usage is a real-time observation, independent of a run's native charges. */
export function ModelPool({ value, t }: { value?: SimulationProductModelPoolObservation | undefined; t: Translate }) {
  const observed = value?.status === 'observed' ? value : undefined
  return <section aria-label={t('metrics.pool')}>
    <h3>{t('metrics.pool')}</h3><p>{t('metrics.poolNotice')}</p>
    <dl><dt>{t('metrics.poolActive')}</dt><dd>{observed === undefined ? <FactValue fact={{ state: 'unavailable', reason: t('status.notObserved') }} labels={factLabels(t)} /> : `${observed.active} / ${observed.limit}`}</dd>
      <dt>{t('metrics.poolQueued')}</dt><dd>{observed === undefined ? <FactValue fact={{ state: 'unavailable', reason: t('status.notObserved') }} labels={factLabels(t)} /> : `${observed.queued} / ${observed.queueLimit}`}</dd></dl>
  </section>
}
