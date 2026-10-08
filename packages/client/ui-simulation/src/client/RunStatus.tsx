/** Native world facts, administrative scheduling and infrastructure admission retain separate meanings. */
import type { SimulationProductRunStatus, SimulationProductControl, SimulationReadState,
  SimulationProductModelPoolObservation } from '@clocky/clocky-client-runtime/client'
import { FactValue, SimClock, StatusBadge, StatusGlyph } from '@clocky/clocky-client-ui-primitives'
import type { AgentStatus, Fact } from '@clocky/clocky-client-ui-primitives'
import type { Key } from './locales.ts'
import { DriverRing } from './Visuals.tsx'
import css from './Workspace.module.css'

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
/** Render an exact authorized run status without deriving execution from its directory name. */
export function RunStatus({ value, control, connected, stale, header = false, t }: {
  value?: SimulationProductRunStatus | undefined
  control?: SimulationReadState<SimulationProductControl> | undefined
  connected: boolean
  stale: boolean
  header?: boolean
  t: Translate
}) {
  const world = value?.status === 'observed' ? value.world : undefined
  const administrative = control?.value
  const operational = value?.operational?.status === 'observed' ? value.operational : undefined
  const scenario = administrative?.versions?.scenario ?? value?.operational?.scenario
  const stop = administrative?.stop ?? operational?.stop
  const driver = administrative?.driver ?? operational?.driver
  const inFlight = administrative?.inFlight ?? operational?.inFlight
  const phase = administrative?.phase ?? world?.phase
  const versions = administrative?.versions
  // An unobserved fact is a dashed empty slot with its reason, never a zero.
  const reason = value?.status === 'unavailable' ? value.errorSummary.text : t('status.notObserved')
  const unavailableFact: Fact = { state: 'unavailable', reason }
  const unavailable = <FactValue fact={unavailableFact} labels={factLabels(t)} />
  const driverObserved = driver !== undefined && driverStatus(driver) === 'running'
  const scenarioSummary = <div><dt>{t('status.scenario')}</dt><dd>{scenario?.status !== 'observed' ? unavailable
    : `${scenario.templateId.text} · ${scenario.version} (${t('status.driverVersion')}: ${scenario.driverVersion})`}</dd></div>
  return <section aria-label={t(header ? 'status.header' : 'status.directory')}>
    {stale && <p role="status" className={css.stalePill}>{t('status.stale')}</p>}
    {value?.status === 'unavailable' && <p role="status">{value.errorSummary.text}</p>}
    {value?.status === 'missing' && <p role="status" className={css.missing}>{t('missing')}</p>}
    {/* A directory row for a run with no world yet states that once instead of four empty facts. */}
    {(header || value?.status !== 'missing') && <><dl className={css.statusSummary}>
      {!header && scenarioSummary}
      <div><dt>{t('phase')}</dt><dd>{phase === undefined ? unavailable
        : <StatusBadge status={phaseStatus(phase)} title={phase}>{t(phase)}</StatusBadge>}</dd></div>
      {header && <div><dt>{t('driver')}</dt><dd className={css.driver} data-driver-observed={driverObserved || undefined}>
        {driver === undefined
          ? unavailable
          : <><DriverRing active={driverObserved} label={t(`driver.${driver}`)} />
            <StatusGlyph status={phase === 'running' && !driverObserved ? 'waiting' : driverStatus(driver)} />{t(`driver.${driver}`)}</>}
        {phase === 'running' && !driverObserved && <small>{t('status.driverNotObserved')}</small>}
      </dd></div>}
      <div><dt>{t('time')}</dt><dd>{world === undefined ? unavailable
        : <SimClock value={String(world.time)} unit={world.tickUnit.text} label={t('time')} />}</dd></div>
      <div><dt>{t('status.inFlight')}</dt><dd>{inFlight === undefined ? unavailable : t(inFlight ? 'status.workRemaining' : 'status.noWorkRemaining')}</dd></div>
      {header && <div><dt>{t('status.connection')}</dt><dd>{t(connected ? 'status.connected' : 'status.disconnected')}</dd></div>}
    </dl>
    <details className={css.diagnostics}>
      <summary>{t('status.details')}</summary>
      <dl className={css.statusDetails}>
        <div><dt>{t('owner')}</dt><dd>{world === undefined ? unavailable : t(world.owner)}</dd></div>
        <div><dt>{t('revision')}</dt><dd>{world?.revision ?? unavailable}</dd></div>
        {!header && <div><dt>{t('driver')}</dt><dd>{driver === undefined ? unavailable : t(`driver.${driver}`)}</dd></div>}
        <div><dt>{t('status.stop')}</dt><dd>{driver === undefined ? unavailable : stop === undefined ? t('status.noStop') : t(`status.stop.${stop}`)}</dd></div>

        <div><dt>{t('status.residentRecovery')}</dt><dd>{world?.metrics === undefined ? unavailable : world.metrics.residentSlots.recoveryRequired}</dd></div>
        {world?.schedulerStop !== undefined && <div><dt>{t('status.nativeRecovery')}</dt>
          <dd><code>{world.schedulerStop.code}</code> · <code>{world.schedulerStop.recovery}</code></dd></div>}
        {administrative?.actions.start.reason === 'recovery-required' && <div><dt>{t('status.recovery')}</dt>
          <dd>{t('controlReason.recovery-required')}</dd></div>}
        {header && scenarioSummary}
        <div><dt>{t('status.rules')}</dt><dd>{versions?.rulesVersion.text ?? world?.rulesVersion?.text ?? unavailable}</dd></div>
        <div><dt>{t('status.policy')}</dt><dd>{versions?.policyVersion.text ?? world?.policyVersion?.text ?? unavailable}</dd></div>
      </dl>
    </details></>}
  </section>
}

/** Host-wide semaphore usage is a real-time observation, independent of a run's native charges. */
export function ModelPool({ value, t }: { value?: SimulationProductModelPoolObservation | undefined; t: Translate }) {
  const observed = value?.status === 'observed' ? value : undefined
  return <section aria-label={t('metrics.pool')}>
    <h3>{t('metrics.pool')}</h3><p>{t('metrics.poolNotice')}</p>
    <dl><dt>{t('metrics.poolActive')}</dt><dd>{observed === undefined ? <FactValue fact={{ state: 'unavailable', reason: t('status.notObserved') }} labels={factLabels(t)} /> : `${observed.active} / ${observed.limit}`}</dd>
      <dt>{t('metrics.poolQueued')}</dt><dd>{observed === undefined ? <FactValue fact={{ state: 'unavailable', reason: t('status.notObserved') }} labels={factLabels(t)} /> : `${observed.queued} / ${observed.queueLimit}`}</dd></dl>
  </section>
}
