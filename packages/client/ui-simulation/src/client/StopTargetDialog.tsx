/**
 * Stop targets: "run until simulated time N" as its own Host command. A target looks effective only after the Host's
 * receipt confirms it; the browser never chains setting a target with starting, pausing or saving.
 */
import { useId, useState } from 'react'
import { Button, Input, Modal } from '@clocky/clocky-client-ui-primitives'
import type { SimulationProductControl, SimulationRunControlState } from '@clocky/clocky-client-runtime/client'
import type { Key } from './locales.ts'
import { tickUnitLabel } from './RunStateChip.tsx'
import css from './Workspace.module.css'

type Translate = (key: Key, params?: Record<string, string>) => string
/** Host-retained stop control projection. */
export type StopTargetView = NonNullable<SimulationProductControl['stopTarget']>
/** Complete target the Host persists; the boundary is on the run's native clock. */
export type StopTargetInput = NonNullable<StopTargetView['target']>
/** Deployment defaults for the drain budget; the dialog lets the user tighten or widen them before submitting. */
export interface StopDrainDefaults { readonly maxSteps: number; readonly maxTokens: number; readonly maxWallTimeMs: number }

/** Authored form values; numbers stay decimal strings until submission. */
interface Draft {
  enabled: boolean
  boundary: string
  mode: StopTargetInput['mode']
  checkpoint: boolean
  maxSteps: string
  maxTokens: string
  minutes: string
}

const DECIMAL = /^(0|[1-9][0-9]*)$/

/**
 * Whether the current control confirms exactly this receipt's target as installed and effective.
 * @param stop - Host stop control.
 * @param state - Original command state.
 * @returns true once the Host's current projection carries the confirmed command and it is effective.
 */
export function targetArmed(stop: StopTargetView | undefined, state: SimulationRunControlState): boolean {
  if (stop === undefined || state.status !== 'confirmed' || state.receipt?.activation !== 'effective') return false
  return stop.commandId === state.input?.commandId && stop.activation === 'effective' && (stop.state === 'armed' || stop.state === 'cleared')
}

/**
 * Stop-target form plus the original command outcome.
 * @param props.control - Current control; supplies the native clock, current target and budget.
 * @param props.now - Confirmed simulated time; earlier boundaries are refused before submission.
 * @param props.state - Original stop-target command state.
 * @param props.update - Submit a target or `null` to clear; never starts scheduling.
 * @param props.retry - Resend the exact original after an unknown outcome.
 * @returns a fieldset section.
 */
export function StopTargetSection({ control, now, state, update, retry, defaults, connected, t }: {
  control: SimulationProductControl
  now: string | undefined
  state: SimulationRunControlState
  update: (target: StopTargetInput | null) => void
  retry: () => void
  defaults: StopDrainDefaults
  connected: boolean
  t: Translate
}) {
  const id = useId()
  const current = control.stopTarget?.target ?? null
  const [draft, setDraft] = useState<Draft>(() => ({ enabled: current !== null, boundary: current?.boundary ?? now ?? '',
    mode: current?.mode ?? 'drain-admitted', checkpoint: (current?.checkpointPolicy ?? 'request') === 'request',
    maxSteps: String(current?.drainBudget.maxSteps ?? defaults.maxSteps),
    maxTokens: String(current?.drainBudget.maxTokens ?? defaults.maxTokens),
    minutes: String(Math.ceil((current?.drainBudget.maxWallTimeMs ?? defaults.maxWallTimeMs) / 60000)) }))
  const [error, setError] = useState<Key>()
  const unit = tickUnitLabel(control.versions?.tickUnit.text ?? '', t)
  // Without a declared clock unit or a deployed stop-control command there is no reliable mapping to offer.
  const unsupported = control.versions === undefined ? 'stop.unsupported.clock'
    : state.status === 'refused' && state.error === 'unavailable' ? 'stop.unsupported.host' : undefined
  const busy = state.status === 'submitting' || state.status === 'unknown'
  const change = (next: Partial<Draft>) => { setError(undefined); setDraft(value => ({ ...value, ...next })) }
  const submit = () => {
    if (!draft.enabled) { update(null); return }
    if (!DECIMAL.test(draft.boundary)) { setError('stop.error.boundary'); return }
    if (now !== undefined && BigInt(draft.boundary) < BigInt(now)) { setError('stop.error.past'); return }
    if (![draft.maxSteps, draft.maxTokens, draft.minutes].every(value => DECIMAL.test(value) && value !== '0')) { setError('stop.error.budget'); return }
    update({ targetId: crypto.randomUUID(), clock: { kind: 'native' }, boundary: draft.boundary as StopTargetInput['boundary'],
      mode: draft.mode, checkpointPolicy: draft.checkpoint ? 'request' : 'none',
      drainBudget: { maxSteps: Number(draft.maxSteps), maxTokens: Number(draft.maxTokens), maxWallTimeMs: Number(draft.minutes) * 60000 } })
  }
  return <fieldset className={css.stopTarget} data-stop-target disabled={!connected || unsupported !== undefined || busy}>
    <legend>{t('stop.title')}</legend>
    {unsupported !== undefined && <p role="status">{t(unsupported)}</p>}
    <label className={css.radio}><input type="radio" name={`${id}-target`} checked={!draft.enabled}
      onChange={() => { change({ enabled: false }) }} />{t(current === null ? 'stop.none' : 'stop.clear')}</label>
    <label className={css.radio}><input type="radio" name={`${id}-target`} checked={draft.enabled}
      onChange={() => { change({ enabled: true }) }} />{t('stop.until')}</label>
    {draft.enabled && <div className={css.stopFields}>
      <label htmlFor={`${id}-boundary`}>{t('stop.boundary', { unit })}</label>
      <Input id={`${id}-boundary`} inputMode="numeric" value={draft.boundary} aria-describedby={`${id}-now`}
        aria-invalid={error === 'stop.error.boundary' || error === 'stop.error.past'} onChange={(event) => { change({ boundary: event.target.value.trim() }) }} />
      <p id={`${id}-now`} className={css.muted}>{t('stop.now', { now: now ?? t('unavailable'), unit })}</p>
      <label className={css.radio}><input type="radio" name={`${id}-mode`} checked={draft.mode === 'drain-admitted'}
        onChange={() => { change({ mode: 'drain-admitted' }) }} /><span>{t('stop.mode.drain-admitted')}<small className={css.muted}> {t('stop.mode.drain-admitted.hint')}</small></span></label>
      <label className={css.radio}><input type="radio" name={`${id}-mode`} checked={draft.mode === 'at-boundary'}
        onChange={() => { change({ mode: 'at-boundary' }) }} /><span>{t('stop.mode.at-boundary')}<small className={css.muted}> {t('stop.mode.at-boundary.hint')}</small></span></label>
      {draft.mode === 'drain-admitted' && <div className={css.stopBudget}>
        <p className={css.muted}>{t('stop.budget.notice')}</p>
        <label>{t('stop.budget.steps')}<Input inputMode="numeric" value={draft.maxSteps} onChange={(event) => { change({ maxSteps: event.target.value.trim() }) }} /></label>
        <label>{t('stop.budget.tokens')}<Input inputMode="numeric" value={draft.maxTokens} onChange={(event) => { change({ maxTokens: event.target.value.trim() }) }} /></label>
        <label>{t('stop.budget.minutes')}<Input inputMode="numeric" value={draft.minutes} onChange={(event) => { change({ minutes: event.target.value.trim() }) }} /></label>
      </div>}
      <label className={css.radio}><input type="checkbox" checked={draft.checkpoint} onChange={(event) => { change({ checkpoint: event.target.checked }) }} />
        {t('stop.checkpoint')}</label>
    </div>}
    {error !== undefined && <p role="alert">{t(error)}</p>}
    <div className={css.actions}>
      <Button variant="secondary" disabled={!connected || unsupported !== undefined || busy || !draft.enabled && current === null}
        loading={state.status === 'submitting'} onClick={submit}>{t(draft.enabled ? 'stop.submit' : 'stop.submitClear')}</Button>
    </div>
    <StopCommandOutcome state={state} retry={retry} t={t} />
  </fieldset>
}

/**
 * Original command outcome: pending, confirmed, Host-refused (out of bounds) and unknown stay distinct.
 * @param props.state - Original stop-target command state.
 * @param props.retry - Exact original retry.
 * @returns status text and, for an unknown outcome, the retry.
 */
export function StopCommandOutcome({ state, retry, t }: { state: SimulationRunControlState; retry: () => void; t: Translate }) {
  switch (state.status) {
    case 'idle': return null
    case 'submitting': return <p role="status" data-stop-outcome="submitting">{t('stop.outcome.submitting')}</p>
    case 'confirmed': return <p role="status" data-stop-outcome={state.receipt?.activation}>{t(`stop.outcome.${state.receipt?.activation ?? 'effective'}`)}</p>
    case 'refused': return <div role="alert" data-stop-outcome="refused"><p>{t(state.error === 'invalid' ? 'stop.outcome.outOfBounds' : `stop.outcome.refused.${state.error ?? 'internal'}`)}</p>
      {state.message !== undefined && <details className={css.diagnostics}><summary>{t('status.details')}</summary><code>{state.message}</code></details>}</div>
    case 'unknown': return <div role="alert" data-stop-outcome="unknown"><p>{t('stop.outcome.unknown')}</p>
      <Button size="sm" onClick={retry}>{t('stop.retry')}</Button></div>
    default: { const unreachable: never = state.status; throw new Error(`Unknown stop command status ${String(unreachable)}`) }
  }
}

/**
 * Standalone "edit target" dialog, opened from the header target chip or once the target is reached.
 * @returns modal wrapping {@link StopTargetSection}.
 */
export function StopTargetDialog({ close, ...props }: Parameters<typeof StopTargetSection>[0] & { close: () => void }) {
  return <Modal open title={props.t('stop.edit')} closeLabel={props.t('cancel')} onClose={close}
    footer={<Button onClick={close}>{props.t('stop.done')}</Button>}>
    <p className={css.muted}>{props.t('stop.editNotice')}</p>
    <StopTargetSection {...props} />
  </Modal>
}

/**
 * Header chip for the current stop target and its Host state; absent or cleared targets render nothing.
 * @param props.stop - Host stop control.
 * @param props.unit - Localized clock unit.
 * @param props.edit - Open the edit dialog.
 * @returns a button chip naming the boundary, mode and state.
 */
export function StopTargetChip({ stop, unit, edit, t }: {
  stop: StopTargetView | undefined
  unit: string
  edit: () => void
  t: Translate
}) {
  if (stop === undefined || stop.target === null || stop.state === 'cleared') return null
  const state = stop.activation !== 'effective' ? `activation.${stop.activation}` as const : stop.state
  return <button type="button" className={css.targetChip} data-stop-state={state} onClick={edit}
    aria-label={`${t('stop.chip', { boundary: stop.target.boundary, unit, mode: t(`stop.mode.${stop.target.mode}`) })} · ${t(`stop.state.${state}`)}. ${t('stop.edit')}`}>
    <span>{t('stop.chip', { boundary: stop.target.boundary, unit, mode: t(`stop.mode.${stop.target.mode}`) })}</span>
    <small>{t(`stop.state.${state}`)}</small>
  </button>
}

/**
 * Stop progress and save state sentences from the Host projection.
 * @param props.stop - Host stop control.
 * @param props.retrySave - Open an explicit checkpoint after a failed save; it never starts inference.
 * @returns lines for the run banner.
 */
export function StopProgress({ stop, retrySave, t }: {
  stop: StopTargetView | undefined
  retrySave?: (() => void) | undefined
  t: Translate
}) {
  if (stop === undefined || stop.target === null || stop.state === 'cleared') return null
  const budget = stop.target.drainBudget
  return <div className={css.stopProgress} data-stop-progress>
    <ol className={css.stopSteps} aria-label={t('stop.progress')}>
      {(['armed', 'draining', 'paused'] as const).map(step => <li key={step} data-current={stop.state === step || undefined}
        data-done={(['armed', 'draining', 'paused'] as const).indexOf(step) < (['armed', 'draining', 'paused'] as const).indexOf(stop.state as 'armed') || undefined}>
        {t(`stop.step.${step}`)}</li>)}
    </ol>
    {stop.state === 'draining' && <p>{t('stop.draining', { steps: String(stop.steps), maxSteps: String(budget.maxSteps),
      tokens: String(stop.tokens), maxTokens: String(budget.maxTokens) })}</p>}
    {stop.reason === 'drain-budget' && <p role="status">{t('stop.drainExhausted', { operations: String(stop.cut?.operationCount ?? 0),
      requests: String(stop.cut?.requestCount ?? 0), decisions: String(stop.cut?.decisionCount ?? 0) })}</p>}
    {stop.reason === 'target-reached' && <p>{t('stop.reached')}</p>}
    {stop.checkpoint !== 'not-requested' && <p data-stop-save={stop.checkpoint}>{t(`stop.save.${stop.checkpoint}`)}
      {stop.checkpointAttemptCount > 1 && <small> {t('stop.save.attempts', { count: String(stop.checkpointAttemptCount) })}</small>}
      {stop.checkpoint === 'failed' && retrySave !== undefined && <> <Button size="sm" onClick={retrySave}>{t('stop.save.retry')}</Button></>}</p>}
    {stop.checkpoint === 'failed' && <p className={css.muted}>{t('stop.save.retryNotice')}</p>}
  </div>
}
