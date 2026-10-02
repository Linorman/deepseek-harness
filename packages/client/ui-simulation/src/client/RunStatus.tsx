/** Native world facts, administrative scheduling and infrastructure admission retain separate meanings. */
import type { SimulationProductRunStatus, SimulationProductControl, SimulationReadState,
  SimulationProductModelPoolObservation } from '@clocky/clocky-client-runtime/client'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'

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
  const unavailable = t('unavailable')
  const scenarioSummary = <div><dt>{t('status.scenario')}</dt><dd>{scenario?.status !== 'observed' ? unavailable
    : `${scenario.templateId.text} · ${scenario.version} (${t('status.driverVersion')}: ${scenario.driverVersion})`}</dd></div>
  return <section aria-label={t(header ? 'status.header' : 'status.directory')}>
    {stale && <p role="status">{t('status.stale')}</p>}
    {value?.status === 'unavailable' && <p role="status">{value.errorSummary.text}</p>}
    {value?.status === 'missing' && <p role="status">{t('missing')}</p>}
    <dl className={css.statusSummary}>
      {!header && scenarioSummary}
      <div><dt>{t('phase')}</dt><dd>{phase === undefined ? unavailable : t(phase)}</dd></div>
      <div><dt>{t('time')}</dt><dd>{world === undefined ? unavailable : `${world.time} ${world.tickUnit.text}`}</dd></div>
      <div><dt>{t('status.inFlight')}</dt><dd>{inFlight === undefined ? unavailable : t(inFlight ? 'status.workRemaining' : 'status.noWorkRemaining')}</dd></div>
      {header && <div><dt>{t('status.connection')}</dt><dd>{t(connected ? 'status.connected' : 'status.disconnected')}</dd></div>}
    </dl>
    <details className={css.diagnostics}>
      <summary>{t('status.details')}</summary>
      <dl className={css.statusDetails}>
        <div><dt>{t('owner')}</dt><dd>{world === undefined ? unavailable : t(world.owner)}</dd></div>
        <div><dt>{t('revision')}</dt><dd>{world?.revision ?? unavailable}</dd></div>
        <div><dt>{t('driver')}</dt><dd>{driver === undefined ? unavailable : t(`driver.${driver}`)}</dd></div>
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
    </details>
  </section>
}

/** Host-wide semaphore usage is a real-time observation, independent of a run's native charges. */
export function ModelPool({ value, t }: { value?: SimulationProductModelPoolObservation | undefined; t: Translate }) {
  const observed = value?.status === 'observed' ? value : undefined
  return <section aria-label={t('metrics.pool')}>
    <h3>{t('metrics.pool')}</h3><p>{t('metrics.poolNotice')}</p>
    <dl><dt>{t('metrics.poolActive')}</dt><dd>{observed === undefined ? t('unavailable') : `${observed.active} / ${observed.limit}`}</dd>
      <dt>{t('metrics.poolQueued')}</dt><dd>{observed === undefined ? t('unavailable') : `${observed.queued} / ${observed.queueLimit}`}</dd></dl>
  </section>
}
