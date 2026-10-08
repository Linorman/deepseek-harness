/** Scheduling controls follow Host allowability and retain original intents independently of live phase. */
import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from '@clocky/clocky-client-ui-primitives'
import type { SimulationProductControl, SimulationCommandKey, SimulationCommand, SimulationCommandState, SimulationReadState } from '@clocky/clocky-client-runtime/client'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'

/**
 * Render current owner/driver observations and explicit authenticated scheduling requests.
 * @param props - Host action hints and budget summary, connection authority and original-command callbacks.
 * @returns controls with costly-start confirmation and separate in-flight explanation.
 */
export function Controls({ compact = false, name, value, connected, authorizationVersion, blockedPhases, blockedMaintenance,
  openMaintenance,
  retain, submit, refresh, t }: {
  compact?: boolean | undefined
  name: string
  value: SimulationReadState<SimulationProductControl>
  connected: boolean
  authorizationVersion: number
  blockedMaintenance: readonly ('checkpoint' | 'restore' | 'prepare' | 'ingress')[]
  openMaintenance: (kind: 'checkpoint' | 'restore' | 'prepare' | 'ingress') => void
  blockedPhases: readonly ('running' | 'paused')[]
  retain: (command: SimulationCommand, authorizationVersion: number) => SimulationCommandKey
  submit: (key: SimulationCommandKey) => Promise<SimulationCommandState | undefined>
  refresh: () => Promise<void>
  t: (key: Key) => string
}) {
  const [starting, setStarting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pendingAction, setPendingAction] = useState<'start' | 'pause'>()
  const [error, setError] = useState<string>()
  const admission = useRef(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const control = value.value
  const labelKey = control?.administration.actions.prepare.reason === 'scenario-progressed' ? 'resumeScheduling' : 'start'
  const pendingLabel = useRef<'start' | 'resumeScheduling'>(labelKey)
  const startLabel = t(busy ? pendingLabel.current : labelKey)
  const pausePrimary = control?.actions.pause.allowed === true && !control.actions.start.allowed
  const can = (action: 'start' | 'pause'): boolean => connected && control !== undefined && !value.stale
    && value.error === undefined && control.actions[action].allowed && !busy && !blockedPhases.includes(action === 'start' ? 'running' : 'paused')
  const manage = async (phase: 'running' | 'paused') => {
    const action = phase === 'running' ? 'start' : 'pause'
    if (admission.current || control === undefined) return
    pendingLabel.current = labelKey
    admission.current = true; setBusy(true); setPendingAction(action); setError(undefined)
    try {
      const key = retain({ kind: 'manage', input: { runId: control.runId, managementId: crypto.randomUUID() as never, phase } }, authorizationVersion)
      setStarting(false)
      await submit(key)
      if (active.current) await refresh()
    } catch { if (active.current) setError(t('commandCapacity')) }
    finally { admission.current = false; if (active.current) { setBusy(false); setPendingAction(undefined) } }
  }
  return <section aria-label={t('management')} aria-busy={busy}>
    {value.error !== undefined && <p role="alert">{t(value.error === 'unavailable' ? 'noManagement' : value.error === 'forbidden' ? 'noControlAccess' : value.error)}</p>}
    {control !== undefined && <>
      {!compact && <dl><dt>{t('driver')}</dt><dd>{t(`driver.${control.driver}`)}</dd>
        <dt>{t('phase')}</dt><dd>{control.phase === undefined ? t('unavailable') : t(control.phase)}</dd>
        <dt>{t('owner')}</dt><dd>{t(control.owner === 'held' ? 'this-provider' : 'unowned')}</dd></dl>}
      {!compact && control.inFlight && <p role="status">{t('inFlight')}</p>}
      <div className={css.actions}>
        {/* The Host's allowed action is the one primary; the in-flight one keeps its label and shows progress. */}
        <Button variant={pausePrimary ? 'secondary' : 'primary'} disabled={!can('start')} loading={pendingAction === 'start'}
          onClick={() => { setStarting(true) }}>{startLabel}</Button>
        <Button variant={pausePrimary ? 'primary' : 'secondary'} disabled={!can('pause')} loading={pendingAction === 'pause'}
          onClick={() => { void manage('paused') }}>{t('pauseScheduling')}</Button>

      </div>
      <details data-simulation-maintenance open={!compact || undefined}><summary>{t('status.moreActions')}</summary>
        {compact && control.inFlight && <p role="status">{t('inFlight')}</p>}
        <Button variant="secondary" disabled={!connected || value.loading || busy} onClick={() => { void refresh() }}>{t('refreshControl')}</Button>
        <div className={css.actions}>{(['checkpoint', 'restore', 'ingress', 'prepare'] as const).map(kind => <div key={kind}>
          <Button variant="secondary" disabled={!connected || value.stale || value.error !== undefined || busy
          || !control.administration.actions[kind].allowed || blockedMaintenance.includes(kind)}
          onClick={() => { openMaintenance(kind) }}>{t(`maintenance.${kind}`)}</Button>
          {!control.administration.actions[kind].allowed && <p>{t(`maintenanceReason.${control.administration.actions[kind].reason}`)}</p>}
        </div>)}</div>
        {!control.actions.pause.allowed && <p>{t(`controlReason.${control.actions.pause.reason}`)}</p>}
      </details>
      {!control.actions.start.allowed && <p>{t(`controlReason.${control.actions.start.reason}`)}</p>}
    </>}
    {error !== undefined && <p role="alert">{error}</p>}
    {starting && control !== undefined && <Modal open title={startLabel} closeLabel={t('cancel')} onClose={() => { setStarting(false) }}
      footer={<><Button onClick={() => { setStarting(false) }}>{t('cancel')}</Button>
        <Button variant="primary" disabled={!can('start')} onClick={() => { void manage('running') }}>{startLabel}</Button></>}>
      <p>{name}</p><p>{t('startNotice')}</p>
      <dl><dt>{t('model')}</dt><dd>{control.budget.model.provider}/{control.budget.model.name}</dd>
        <dt>{t('tokensPerRequest')}</dt><dd>{control.budget.tokensPerRequest}</dd>
        <dt>{t('tokensPerInterval')}</dt><dd>{control.budget.tokensPerInterval} / {control.budget.interval} {t('simulationTicks')}</dd>
        <dt>{t('residentActors')}</dt><dd>{control.budget.residentActors}</dd>
        <dt>{t('sharedModelLimit')}</dt><dd>{control.budget.sharedModelLimit}</dd></dl>
    </Modal>}
  </section>
}
