/** Scheduling controls follow Host allowability and retain original intents independently of live phase. */
import { useEffect, useRef, useState } from 'react'
import { Button, IconEllipsisOutline16, Modal } from '@clocky/clocky-client-ui-primitives'
import type { SimulationProductControl, SimulationCommandKey, SimulationCommand, SimulationCommandState, SimulationReadState } from '@clocky/clocky-client-runtime/client'
import type { Key } from './locales.ts'
import type { RunState } from './run-state.ts'
import { StopTargetSection, targetArmed } from './StopTargetDialog.tsx'
import { BudgetPanel } from './BudgetPanel.tsx'
import type { TokenAttribution } from './BudgetPanel.tsx'
import { tickUnitLabel } from './RunStateChip.tsx'
import type { StopDrainDefaults, StopTargetInput } from './StopTargetDialog.tsx'
import type { SimulationRunControlState } from '@clocky/clocky-client-runtime/client'
import { useDismissibleDisclosure } from './disclosure.ts'
import css from './Workspace.module.css'

/**
 * Render current owner/driver observations and explicit authenticated scheduling requests.
 * @param props - Host action hints and budget summary, connection authority and original-command callbacks.
 * @returns controls with costly-start confirmation and separate in-flight explanation.
 */
export function Controls({ compact = false, name, value, state, connected, authorizationVersion, blockedPhases, blockedMaintenance,
  openMaintenance, scheduledWakes, review, refreshState, startRequest = 0, runControl, editTarget, attribution,
  retain, submit, refresh, t }: {
  compact?: boolean | undefined
  name: string
  /** Synthesized run state; its primary action is the only emphasized control. Absent keeps both scheduling actions. */
  state?: RunState | undefined
  /** Open the surface that resolves an attention state. */
  review?: (() => void) | undefined
  /** Reread every source of a stale state; defaults to the control refresh. */
  refreshState?: (() => void) | undefined
  /** Incremented by another surface (the failure card) to open the Continue confirmation; Host allowability still applies. */
  startRequest?: number | undefined
  /** Stop-target command owner offered inside the Continue confirmation; absent hides the section. */
  runControl?: {
    state: SimulationRunControlState
    update: (target: StopTargetInput | null) => void
    retry: () => void
    defaults: StopDrainDefaults
    now: string | undefined
  } | undefined
  /** Host token attribution of this run, shown in the Continue confirmation. */
  attribution?: TokenAttribution | undefined
  /** Open the stop-target editor; the primary action once a target is reached. */
  editTarget?: (() => void) | undefined
  value: SimulationReadState<SimulationProductControl>
  connected: boolean
  authorizationVersion: number
  blockedMaintenance: readonly ('checkpoint' | 'restore' | 'prepare' | 'ingress')[]
  openMaintenance: (kind: 'checkpoint' | 'restore' | 'prepare' | 'ingress') => void
  blockedPhases: readonly ('running' | 'paused')[]
  retain: (command: SimulationCommand, authorizationVersion: number) => SimulationCommandKey
  submit: (key: SimulationCommandKey) => Promise<SimulationCommandState | undefined>
  refresh: () => Promise<void>
  /** World runs: finite scheduled events that starting will wake; absent for other runs or when not observed. */
  scheduledWakes?: number | undefined
  t: (key: Key, params?: Record<string, string>) => string
}) {
  const [recoveryReview, setRecoveryReview] = useState<{ value: NonNullable<SimulationProductControl['tokenRecovery']>
    runId: string
    authorizationVersion: number }>()
  const setRecovering = (next: SimulationProductControl['tokenRecovery']) => {
    setRecoveryReview(next === undefined || value.value === undefined ? undefined
      : { value: next, runId: value.value.runId, authorizationVersion })
  }
  const recovering = recoveryReview?.authorizationVersion === authorizationVersion && recoveryReview.runId === value.value?.runId
    ? recoveryReview.value : undefined
  const [starting, setStarting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pendingAction, setPendingAction] = useState<'start' | 'pause'>()
  const [error, setError] = useState<string>()
  const admission = useRef(false)
  const overflow = useRef<HTMLDetailsElement>(null)
  useDismissibleDisclosure(overflow)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => { if (startRequest > 0) setStarting(true) }, [startRequest])
  const control = value.value
  const labelKey = control?.administration.actions.prepare.reason === 'scenario-progressed' ? 'resumeScheduling' : 'start'
  const pendingLabel = useRef<'start' | 'resumeScheduling'>(labelKey)
  const startLabel = t(busy ? pendingLabel.current : labelKey)
  const pausePrimary = control?.actions.pause.allowed === true && !control.actions.start.allowed
  const legacy = state === undefined, primary = state?.primaryAction
  // Recovery opens the first allowed remedy: a token overrun acknowledgement, a checkpoint restore, or an explicit resume.
  const recoverTarget = control === undefined ? undefined : control.tokenRecovery?.allowed === true ? 'token' as const
    : control.administration.actions.restore.allowed && !blockedMaintenance.includes('restore') ? 'restore' as const
      : control.actions.start.allowed ? 'start' as const : undefined
  // A target being set must be confirmed and in effect before Continue; choosing no target never waits.
  const targetWaiting = runControl !== undefined && control !== undefined && (runControl.state.status === 'submitting'
    || runControl.state.status === 'unknown' || runControl.state.status === 'confirmed' && !targetArmed(control.stopTarget, runControl.state))
  // Only a stale observation disables actions; reconciling sources keep Host-allowed actions usable beside Refresh.
  const stale = state?.freshness === 'stale'
  const can = (action: 'start' | 'pause'): boolean => connected && control !== undefined && !value.stale && !stale
    && value.error === undefined && control.actions[action].allowed && !busy && !blockedPhases.includes(action === 'start' ? 'running' : 'paused')
  const manage = async (phase: 'running' | 'paused', tokenRecovery?: NonNullable<SimulationProductControl['tokenRecovery']>['request']) => {
    const action = phase === 'running' ? 'start' : 'pause'
    if (admission.current || control === undefined) return
    pendingLabel.current = labelKey
    admission.current = true; setBusy(true); setPendingAction(action); setError(undefined)
    try {
      const key = retain({ kind: 'manage', input: { runId: control.runId, managementId: crypto.randomUUID() as never, phase, ...tokenRecovery === undefined ? {} : { tokenRecovery } } }, authorizationVersion)
      setStarting(false); setRecovering(undefined)
      await submit(key)
      if (active.current) await refresh()
    } catch { if (active.current) setError(t('commandCapacity')) }
    finally { admission.current = false; if (active.current) { setBusy(false); setPendingAction(undefined) } }
  }
  return <section aria-label={t('management')} aria-busy={busy} className={compact ? css.compactControls : undefined}>
    {value.error !== undefined && <p role="alert">{t(value.error === 'unavailable' ? 'noManagement' : value.error === 'forbidden' ? 'noControlAccess' : value.error)}</p>}
    {control !== undefined && <>
      {!compact && <dl><dt>{t('driver')}</dt><dd>{t(`driver.${control.driver}`)}</dd>
        <dt>{t('phase')}</dt><dd>{control.phase === undefined ? t('unavailable') : t(control.phase)}</dd>
        <dt>{t('owner')}</dt><dd>{t(control.owner === 'held' ? 'this-provider' : 'unowned')}</dd></dl>}
      {!compact && control.inFlight && <p role="status">{t('inFlight')}</p>}
      <div className={css.actions}>
        {/* One primary action from the synthesized state. Continue is never offered while running and Pause never while
            paused; in every other state both stay available as secondary, Host-gated actions. */}
        {(legacy || state.phase !== 'running') && <Button variant={legacy ? (pausePrimary ? 'secondary' : 'primary')
          : primary === 'start' || primary === 'recover' && recoverTarget === 'start' ? 'primary' : 'secondary'} disabled={!can('start')}
        loading={pendingAction === 'start'} onClick={() => { setStarting(true) }}>{startLabel}</Button>}
        {primary === 'recover' && recoverTarget !== 'start' && <Button variant="primary" disabled={recoverTarget === undefined || !connected
          || value.stale || value.error !== undefined || busy}
        onClick={() => {
          if (recoverTarget === 'token') setRecovering(control.tokenRecovery)
          else if (recoverTarget === 'restore') openMaintenance('restore')
        }}>{t('state.action.recover')}</Button>}
        {primary === 'review' && review !== undefined && <Button variant="primary" onClick={review}>{t('state.action.review')}</Button>}
        {primary === 'edit-target' && editTarget !== undefined && <Button variant="primary" onClick={editTarget}>{t('state.action.editTarget')}</Button>}
        {primary === 'refresh' && <Button variant="primary" disabled={!connected || value.loading}
          onClick={() => { if (refreshState === undefined) void refresh(); else refreshState() }}>{t('state.action.refresh')}</Button>}
        {(legacy || state.phase !== 'paused') && <Button variant={primary === 'pause' || legacy && pausePrimary ? 'primary' : 'secondary'}
          disabled={!can('pause')} loading={pendingAction === 'pause'} onClick={() => { void manage('paused') }}>{t('pauseScheduling')}</Button>}
      </div>
      {stale && <p role="status">{t('state.refreshFirst')}</p>}
      {primary === 'recover' && recoverTarget === undefined && <p role="status">{t('state.recoverUnavailable')}</p>}
      {/* Compact headers show maintenance as the overflow popover; its entries stay buttons with their refusal reasons. */}
      <details ref={compact ? overflow : undefined} data-simulation-maintenance open={!compact || undefined}
        className={compact ? css.overflow : undefined} onToggle={(event) => {
          // The popover opens toward the side with room, so a trigger near the left edge never pushes it under the sidebar.
          const element = event.currentTarget
          if (compact && element.open) element.dataset['align'] = element.getBoundingClientRect().left < window.innerWidth / 2 ? 'start' : 'end'
        }}>
        <summary title={compact ? t('status.moreActions') : undefined}>{compact
          ? <><span aria-hidden="true" className={css.overflowGlyph}><IconEllipsisOutline16 /></span><span className={css.visuallyHidden}>{t('status.moreActions')}</span></>
          : t('status.moreActions')}</summary>
        <div className={compact ? css.popoverPanel : undefined}>
          {compact && control.inFlight && <p role="status">{t('inFlight')}</p>}
          <Button variant="secondary" disabled={!connected || value.loading || busy} onClick={() => { void refresh() }}>{t('refreshControl')}</Button>
          <div className={css.actions}>{(['checkpoint', 'restore', 'ingress', 'prepare'] as const).map(kind => <div key={kind}>
            <Button variant="secondary" disabled={!connected || value.stale || value.error !== undefined || busy || stale
          || !control.administration.actions[kind].allowed || blockedMaintenance.includes(kind)}
            onClick={() => { openMaintenance(kind) }}>{t(`maintenance.${kind}`)}</Button>
            {!control.administration.actions[kind].allowed && <p>{t(`maintenanceReason.${control.administration.actions[kind].reason}`)}</p>}
          </div>)}</div>
          {!control.actions.pause.allowed && <p>{t(`controlReason.${control.actions.pause.reason}`)}</p>}
        </div>
      </details>
      {control.tokenRecovery !== undefined && <div role="status">
        <p>{t('tokenRecovery.notice')}</p>
        <p>{t('tokenRecovery.reserved')}: {grouped(control.tokenRecovery.request.reserved)} · {t('tokenRecovery.used')}: {grouped(control.tokenRecovery.request.used)}</p>
        <Button disabled={!connected || value.stale || value.error !== undefined || busy
          || blockedPhases.includes('paused') || !control.tokenRecovery.allowed}
        onClick={() => { setRecovering(control.tokenRecovery) }}>{t('tokenRecovery.action')}</Button>
        {!control.tokenRecovery.allowed && <p>{t(`tokenRecovery.${control.tokenRecovery.reason}`)}</p>}
      </div>}
      {control.requestBudget !== undefined && <p role="status">{t('requestBudget.notice')} {grouped(control.requestBudget.estimatedInputTokens)} + {grouped(control.requestBudget.maxOutputTokens)} + {grouped(control.requestBudget.safetyMarginTokens)} &gt; {grouped(control.requestBudget.limit)}</p>}
      {!control.actions.start.allowed && <p role="status">{t(control.stop === 'plan-budget'
        ? 'controlReason.plan-budget' : `controlReason.${control.actions.start.reason}`)}</p>}
    </>}
    {error !== undefined && <p role="alert">{error}</p>}
    {recovering !== undefined && <Modal open title={t('tokenRecovery.action')} closeLabel={t('cancel')} onClose={() => { setRecovering(undefined) }}
      footer={<><Button onClick={() => { setRecovering(undefined) }}>{t('cancel')}</Button>
        <Button variant="primary" disabled={!connected || value.stale || value.error !== undefined || busy || blockedPhases.includes('paused')
          || control?.tokenRecovery?.allowed !== true
          || JSON.stringify(control.tokenRecovery.request) !== JSON.stringify(recovering.request)}
        onClick={() => { void manage('paused', recovering.request) }}>{t('tokenRecovery.confirm')}</Button></>}>
      <p>{name}</p><p>{t('tokenRecovery.confirmNotice')}</p>
      <dl><dt>{t('tokenRecovery.reserved')}</dt><dd>{grouped(recovering.request.reserved)}</dd>
        <dt>{t('tokenRecovery.used')}</dt><dd>{grouped(recovering.request.used)}</dd>
        <dt>{t('tokenRecovery.additional')}</dt><dd>{grouped(recovering.request.additionalTokens)}</dd></dl>
    </Modal>}
    {starting && control !== undefined && <Modal open title={startLabel} closeLabel={t('cancel')} onClose={() => { setStarting(false) }}
      bodyClassName={css.formBody ?? ''}
      footer={<><Button onClick={() => { setStarting(false) }}>{t('cancel')}</Button>
        <Button variant="primary" disabled={!can('start') || targetWaiting} onClick={() => { void manage('running') }}>{startLabel}</Button></>}>
      <p className={css.confirmName}>{name}</p><p className={css.muted}>{t('startNotice')}</p>
      <dl className={css.confirmList}><dt>{t('model')}</dt><dd><code>{control.budget.model.provider}/{control.budget.model.name}</code></dd>
        <dt>{t('residentActors')}</dt><dd>{grouped(control.budget.residentActors)}</dd>
        {scheduledWakes !== undefined && <><dt>{t('world.start.wakes')}</dt><dd>{grouped(scheduledWakes)}</dd></>}</dl>
      <BudgetPanel budget={control.budget} attribution={attribution} unit={tickUnitLabel(control.versions?.tickUnit.text ?? '', t)} t={t} />
      {runControl !== undefined && <StopTargetSection control={control} now={runControl.now} state={runControl.state}
        update={runControl.update}
        retry={runControl.retry} defaults={runControl.defaults} connected={connected} t={t} />}
      {targetWaiting && <p role="status">{t('stop.waitArmed')}</p>}
    </Modal>}
  </section>
}

/**
 * Group the digits of an exact count for reading; non-numeric values stay literal.
 * @param value - Count as number or decimal string.
 * @returns grouped digits.
 */
function grouped(value: number | string): string {
  const text = String(value)
  return /^(0|[1-9][0-9]*)$/.test(text) ? text.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : text
}
