/** Run diagnostics: every contributing source with its own revision and observation time, behind one disclosure. */
import type { SimulationProductRunStatus, SimulationProductControl } from '@clocky/clocky-client-runtime/client'
import { FactValue } from '@clocky/clocky-client-ui-primitives'
import type { Fact } from '@clocky/clocky-client-ui-primitives'
import { useRef } from 'react'
import type { Key } from './locales.ts'
import { useDismissibleDisclosure } from './disclosure.ts'
import { factLabels } from './RunStatus.tsx'
import { observedClock } from './RunStateChip.tsx'
import css from './Workspace.module.css'

type Translate = (key: Key, params?: Record<string, string>) => string

/**
 * Diagnostic facts for one run; the first layer of state belongs to the shared run-state chip.
 * @param props.value - Native inspection or directory status row.
 * @param props.control - Management control, when this caller may read it.
 * @param props.header - Anchored popover in the run header instead of an inline disclosure.
 * @param props.locale - Formatting locale for observation times.
 * @returns a disclosure; unobserved facts are dashed slots with their reason, never zero.
 */
export function RunDetails({ value, control, connected, header = false, locale, t }: {
  value?: SimulationProductRunStatus | undefined
  control?: SimulationProductControl | undefined
  connected: boolean
  header?: boolean
  locale: string
  t: Translate
}) {
  const world = value?.status === 'observed' ? value.world : undefined
  const operational = value?.operational?.status === 'observed' ? value.operational : undefined
  const scenario = control?.versions?.scenario ?? value?.operational?.scenario
  const stop = control?.stop ?? operational?.stop
  const driver = control?.driver ?? operational?.driver
  const inFlight = control?.inFlight ?? operational?.inFlight
  const versions = control?.versions
  const failure = control?.failure ?? operational?.failure
  const details = useRef<HTMLDetailsElement>(null)
  useDismissibleDisclosure(details)
  const reason = value?.status === 'unavailable' ? t(`state.unavailable.${value.reason ?? 'unavailable'}`) : t('status.notObserved')
  const unavailableFact: Fact = { state: 'unavailable', reason }
  const unavailable = <FactValue fact={unavailableFact} labels={factLabels(t)} />
  const phase = control?.phase ?? world?.phase
  return <details ref={details} className={header ? css.headerPopover : css.diagnostics} data-run-details={header || undefined}>
    <summary>{t('status.details')}</summary>
    <dl className={header ? `${css.statusDetails} ${css.popoverPanel}` : css.statusDetails}>
      <div><dt>{t('details.nativeSource')}</dt><dd>{world === undefined ? unavailable
        : `${t('revision')} ${world.revision} · ${observedClock(world.observedAt, locale)}`}</dd></div>
      {control !== undefined && <div><dt>{t('details.controlSource')}</dt>
        <dd>{`${control.revision === undefined ? '—' : `${t('revision')} ${control.revision}`} · ${observedClock(control.observedAt, locale)}`}</dd></div>}
      {control?.driverSource !== undefined && <div><dt>{t('details.driverSource')}</dt>
        <dd>{`${t(control.driverSource.status === 'live' ? 'details.live' : 'details.ownerUnavailable')} · ${observedClock(control.driverSource.observedAt, locale)}`}</dd></div>}
      {control === undefined && value?.operational !== undefined && <div><dt>{t('details.controlSource')}</dt>
        <dd>{observedClock(value.operational.observedAt, locale)}</dd></div>}
      <div><dt>{t('owner')}</dt><dd>{world === undefined ? unavailable : t(world.owner)}</dd></div>
      <div><dt>{t('phase')}</dt><dd>{phase === undefined ? unavailable : t(phase)}</dd></div>
      <div><dt>{t('driver')}</dt><dd>{driver === undefined ? unavailable : t(`driver.${driver}`)}</dd></div>
      <div><dt>{t('status.inFlight')}</dt><dd>{inFlight === undefined ? unavailable
        : inFlight ? t('status.workRemaining') : t('status.noWorkRemaining')}</dd></div>
      {header && <div><dt>{t('status.connection')}</dt><dd>{t(connected ? 'status.connected' : 'status.disconnected')}</dd></div>}
      <div><dt>{t('status.stop')}</dt><dd>{driver === undefined ? unavailable : stop === undefined ? t('status.noStop') : t(`status.stop.${stop}`)}</dd></div>
      <div><dt>{t('status.residentRecovery')}</dt><dd>{world?.metrics === undefined ? unavailable : world.metrics.residentSlots.recoveryRequired}</dd></div>
      {world?.schedulerStop !== undefined && <div><dt>{t('status.nativeRecovery')}</dt>
        <dd><code>{world.schedulerStop.code}</code> · <code>{world.schedulerStop.recovery}</code></dd></div>}
      {control?.actions.start.reason === 'recovery-required' && <div><dt>{t('status.recovery')}</dt>
        <dd>{t('controlReason.recovery-required')}</dd></div>}
      {failure !== undefined && <div><dt>{t('failure.title')}</dt>
        <dd>{t(`failure.category.${failure.category}`)} · {observedClock(failure.occurredAt, locale)} · <code>{failure.failureId}</code></dd></div>}
      {value?.status === 'unavailable' && <div><dt>{t('details.originalError')}</dt><dd><code>{value.errorSummary.text}</code></dd></div>}
      <div><dt>{t('status.scenario')}</dt><dd>{scenario?.status !== 'observed' ? unavailable
        : `${scenario.templateId.text} · ${scenario.version} (${t('status.driverVersion')}: ${scenario.driverVersion})`}</dd></div>
      <div><dt>{t('status.rules')}</dt><dd>{versions?.rulesVersion.text ?? world?.rulesVersion?.text ?? unavailable}</dd></div>
      <div><dt>{t('status.policy')}</dt><dd>{versions?.policyVersion.text ?? world?.policyVersion?.text ?? unavailable}</dd></div>
    </dl>
  </details>
}
