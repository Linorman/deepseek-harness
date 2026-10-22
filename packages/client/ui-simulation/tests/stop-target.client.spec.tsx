// @vitest-environment jsdom
/** Stop targets take effect only after the Host confirms them; reaching one blocks ordinary Continue. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import type { SimulationProductControl, SimulationRunControlState } from '@clocky/clocky-client-runtime/client'
import { StopCommandOutcome, StopProgress, StopTargetChip, StopTargetDialog, StopTargetSection, targetArmed } from '../src/client/StopTargetDialog.tsx'
import type { StopTargetView } from '../src/client/StopTargetDialog.tsx'
import { Controls } from '../src/client/Controls.tsx'
import { RunStateChip } from '../src/client/RunStateChip.tsx'
import { runState } from '../src/client/run-state.ts'
import { en } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'

afterEach(cleanup)
const t = (key: Key, vars?: Record<string, unknown>) => en[key].replace(/\{(\w+)\}/g, (_m, name: string) => String(vars?.[name]))
const defaults = { maxSteps: 32, maxTokens: 4096, maxWallTimeMs: 600000 }
const target = { targetId: 'target', clock: { kind: 'native' as const }, boundary: '12' as never, mode: 'drain-admitted' as const,
  checkpointPolicy: 'request' as const, drainBudget: { maxSteps: 32, maxTokens: 4096, maxWallTimeMs: 600000 } }
const stop = (value: Partial<StopTargetView>): StopTargetView => ({ revision: 9, commandId: 'command', target, activation: 'effective',
  state: 'armed', reason: null, cut: null, steps: 0, tokens: 0, checkpointId: null, checkpointAttemptCount: 0, nativeBoundary: null, checkpoint: 'not-requested',
  ...value })
const control = (value: Partial<SimulationProductControl> = {}): SimulationProductControl => ({ runId: 'run' as never, owner: 'held',
  phase: 'paused', revision: 9, driver: 'idle', inFlight: false, observedAt: 1,
  versions: { rulesVersion: { text: 'r', truncated: false }, policyVersion: { text: 'p', truncated: false },
    tickUnit: { text: 'day', truncated: false }, scenario: { status: 'unavailable' } },
  actions: { start: { allowed: true, reason: 'ready' }, pause: { allowed: false, reason: 'stalled' } },
  administration: { actions: { checkpoint: { allowed: true, reason: 'ready' }, restore: { allowed: true, reason: 'ready' },
    prepare: { allowed: true, reason: 'ready' }, ingress: { allowed: true, reason: 'ready' } }, ingress: { maxTime: '400' as never, maxBytes: 1, targets: [] } },
  budget: { model: { provider: 'p', name: 'm' }, tokensPerRequest: 1, tokensPerInterval: 1, interval: '1' as never, residentActors: 1, sharedModelLimit: 1 },
  ...value })

it('submits 11→13 as its own command and shows a Host boundary refusal distinctly from an unknown outcome', () => {
  const update = vi.fn(), retry = vi.fn()
  const ui = render(<StopTargetSection control={control()} now="11" state={{ status: 'idle' }} update={update} retry={retry}
    defaults={defaults} connected t={t} />)
  fireEvent.click(ui.getByLabelText(en['stop.until']))
  const boundary = ui.getByLabelText(t('stop.boundary', { unit: en['unit.day'] }))
  fireEvent.change(boundary, { target: { value: '10' } })
  fireEvent.click(ui.getByRole('button', { name: en['stop.submit'] }))
  expect(ui.getByRole('alert').textContent).toBe(en['stop.error.past'])
  expect(update).not.toHaveBeenCalled()
  fireEvent.change(boundary, { target: { value: '13' } })
  fireEvent.click(ui.getByRole('button', { name: en['stop.submit'] }))
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ boundary: '13', clock: { kind: 'native' }, mode: 'drain-admitted',
    checkpointPolicy: 'request', drainBudget: { maxSteps: 32, maxTokens: 4096, maxWallTimeMs: 600000 } }))
  const refused: SimulationRunControlState = { status: 'refused', error: 'invalid', message: 'The target exceeds the Native run horizon' }
  ui.rerender(<StopTargetSection control={control()} now="11" state={refused} update={update} retry={retry} defaults={defaults} connected t={t} />)
  const alert = ui.container.querySelector('[data-stop-outcome="refused"]')!
  expect(alert.textContent).toContain(en['stop.outcome.outOfBounds'])
  expect(alert.querySelector('code')?.textContent).toBe('The target exceeds the Native run horizon')
  ui.rerender(<StopTargetSection control={control()} now="11" state={{ status: 'unknown' }} update={update} retry={retry} defaults={defaults} connected t={t} />)
  fireEvent.click(ui.getByRole('button', { name: en['stop.retry'] }))
  expect(retry).toHaveBeenCalledOnce()
  expect(ui.getByRole('button', { name: en['stop.submit'] }).hasAttribute('disabled')).toBe(true)
})

it('keeps Continue disabled until the Host projection carries the confirmed target in effect', () => {
  const confirmed: SimulationRunControlState = { status: 'confirmed', input: { runId: 'run' as never, commandId: 'command', target },
    receipt: { commandId: 'command', revision: 9, activation: 'effective', targetId: 'target' } }
  expect(targetArmed(undefined, confirmed)).toBe(false)
  expect(targetArmed(stop({ commandId: 'older' }), confirmed)).toBe(false)
  expect(targetArmed(stop({ activation: 'pending' }), confirmed)).toBe(false)
  expect(targetArmed(stop({}), confirmed)).toBe(true)
  const props = { name: 'Harbor', connected: true, authorizationVersion: 1, blockedPhases: [], blockedMaintenance: [], openMaintenance: vi.fn(),
    retain: vi.fn(() => 'key' as never), submit: vi.fn(async () => undefined), refresh: vi.fn(async () => {}), t }
  const runControl = { state: confirmed, update: vi.fn(), retry: vi.fn(), defaults, now: '11' }
  const waiting = control()
  const ui = render(<Controls {...props} value={{ loading: false, stale: false, value: waiting }} runControl={runControl}
    state={runState({ control: waiting, nativeFailed: false, connected: true, now: 1, refreshMs: 2000, staleAfterMs: 30000 })} />)
  fireEvent.click(ui.getByRole('button', { name: en.start }))
  const dialog = within(ui.getByRole('dialog'))
  expect(dialog.getByText(en['stop.waitArmed'])).toBeDefined()
  expect(dialog.getAllByRole('button', { name: en.start }).at(-1)!.hasAttribute('disabled')).toBe(true)
  const armed = control({ stopTarget: stop({}) })
  ui.rerender(<Controls {...props} value={{ loading: false, stale: false, value: armed }} runControl={runControl}
    state={runState({ control: armed, nativeFailed: false, connected: true, now: 1, refreshMs: 2000, staleAfterMs: 30000 })} />)
  expect(within(ui.getByRole('dialog')).getAllByRole('button', { name: en.start }).at(-1)!.hasAttribute('disabled')).toBe(false)
})

it('makes Edit target the only primary action once the target is reached and disables ordinary Continue', () => {
  const reached = control({ actions: { start: { allowed: false, reason: 'stop-target-reached' }, pause: { allowed: false, reason: 'stalled' } },
    stopTarget: stop({ state: 'paused', reason: 'target-reached', checkpoint: 'completed' }) })
  const state = runState({ control: reached, nativeFailed: false, connected: true, now: 1, refreshMs: 2000, staleAfterMs: 30000 })
  expect(state).toMatchObject({ kind: 'paused', primaryAction: 'edit-target', detail: 'state.detail.targetReached' })
  const editTarget = vi.fn()
  const ui = render(<Controls name="Harbor" connected authorizationVersion={1} blockedPhases={[]} blockedMaintenance={[]} openMaintenance={vi.fn()}
    retain={vi.fn(() => 'key' as never)} submit={vi.fn(async () => undefined)} refresh={vi.fn(async () => {})} t={t}
    value={{ loading: false, stale: false, value: reached }} state={state} editTarget={editTarget} />)
  const start = ui.getByRole('button', { name: en.start })
  expect(start.hasAttribute('disabled')).toBe(true)
  expect(start.className).toContain('secondary')
  fireEvent.click(ui.getByRole('button', { name: en['state.action.editTarget'] }))
  expect(editTarget).toHaveBeenCalledOnce()
  expect(ui.getAllByText(en['controlReason.stop-target-reached']).length).toBeGreaterThan(0)
})

it('still shows the set target after a disconnect, beside a stale state', () => {
  const armed = control({ stopTarget: stop({}) })
  const state = runState({ control: armed, nativeFailed: false, connected: false, now: 1, refreshMs: 2000, staleAfterMs: 30000 })
  const ui = render(<><RunStateChip state={state} locale="en-US" t={t} />
    <StopTargetChip stop={armed.stopTarget} unit={en['unit.day']} edit={vi.fn()} t={t} /></>)
  expect(ui.container.querySelector('[data-run-state]')?.getAttribute('data-freshness')).toBe('stale')
  expect(ui.getByRole('button', { name: /Target 12 day/ }).textContent).toContain(en['stop.state.armed'])
})

it('drives stop progress from armed to draining to paused and distinguishes complete, partial and failed saves', () => {
  const retrySave = vi.fn()
  const ui = render(<StopProgress stop={stop({ state: 'draining', steps: 3, tokens: 900 })} t={t} retrySave={retrySave} />)
  expect(ui.container.querySelector('[data-current]')?.textContent).toBe(en['stop.step.draining'])
  expect(ui.getByText(t('stop.draining', { steps: 3, maxSteps: 32, tokens: 900, maxTokens: 4096 }))).toBeDefined()
  ui.rerender(<StopProgress stop={stop({ state: 'paused', reason: 'drain-budget', cut: { nativeRevision: 1, nativeTime: '12', clockRevision: 1,
    clockValue: '12', recordedAt: 1, tokenBaseline: 0, tokenReservationCount: 0, operationCount: 2, requestCount: 1, decisionCount: 0 } as never,
  checkpoint: 'external-state-required' })} t={t} retrySave={retrySave} />)
  expect(ui.getByText(t('stop.drainExhausted', { operations: 2, requests: 1, decisions: 0 }))).toBeDefined()
  expect(ui.container.querySelector('[data-stop-save]')?.textContent).toBe(en['stop.save.external-state-required'])
  ui.rerender(<StopProgress stop={stop({ state: 'paused', reason: 'target-reached', checkpoint: 'completed' })} t={t} retrySave={retrySave} />)
  expect(ui.container.querySelector('[data-stop-save]')?.textContent).toBe(en['stop.save.completed'])
  ui.rerender(<StopProgress stop={stop({ state: 'paused', reason: 'target-reached', checkpoint: 'failed', checkpointId: 'save-1',
    checkpointAttemptCount: 1 })} t={t} retrySave={retrySave} />)
  // The retry saves the original stop target again; it keeps the run paused and calls no model.
  expect(ui.getByText(en['stop.save.retryNotice'])).toBeDefined()
  fireEvent.click(ui.getByRole('button', { name: en['stop.save.retry'] }))
  expect(retrySave).toHaveBeenCalledOnce()
  ui.rerender(<StopProgress stop={stop({ state: 'paused', reason: 'target-reached', checkpoint: 'completed', checkpointId: 'save-2',
    checkpointAttemptCount: 2 })} t={t} />)
  expect(ui.container.querySelector('[data-stop-save]')?.textContent).toContain(t('stop.save.attempts', { count: 2 }))
  ui.rerender(<StopProgress stop={stop({ state: 'cleared', target: null })} t={t} />)
  expect(ui.container.querySelector('[data-stop-progress]')).toBeNull()
})

it('disables target input when the run declares no clock or the Host offers no stop control', () => {
  const ui = render(<StopTargetSection control={control({ versions: undefined })} now="11" state={{ status: 'idle' }} update={vi.fn()} retry={vi.fn()}
    defaults={defaults} connected t={t} />)
  expect(ui.getByText(en['stop.unsupported.clock'])).toBeDefined()
  expect((ui.container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
  ui.rerender(<StopTargetSection control={control()} now="11" state={{ status: 'refused', error: 'unavailable' }} update={vi.fn()} retry={vi.fn()}
    defaults={defaults} connected t={t} />)
  expect(ui.getByText(en['stop.unsupported.host'])).toBeDefined()
})

it('clears an installed target as its own command and refuses malformed boundaries and empty budgets', () => {
  const update = vi.fn()
  const installed = control({ stopTarget: stop({ target: { ...target, mode: 'at-boundary', checkpointPolicy: 'none' } }) })
  const ui = render(<StopTargetSection control={installed} now={undefined} state={{ status: 'idle' }} update={update} retry={vi.fn()}
    defaults={defaults} connected t={t} />)
  // An installed target starts selected; its own boundary seeds the field and the current time is unavailable.
  expect(ui.getByText(t('stop.now', { now: en.unavailable, unit: en['unit.day'] }))).toBeDefined()
  fireEvent.click(ui.getByLabelText(en['stop.clear']))
  fireEvent.click(ui.getByRole('button', { name: en['stop.submitClear'] }))
  expect(update).toHaveBeenLastCalledWith(null)
  fireEvent.click(ui.getByLabelText(en['stop.until']))
  const boundary = ui.getByLabelText(t('stop.boundary', { unit: en['unit.day'] }))
  fireEvent.change(boundary, { target: { value: '1.5' } })
  fireEvent.click(ui.getByRole('button', { name: en['stop.submit'] }))
  expect(ui.getByRole('alert').textContent).toBe(en['stop.error.boundary'])
  fireEvent.change(boundary, { target: { value: '20' } })
  fireEvent.click(ui.getByLabelText(new RegExp(en['stop.mode.drain-admitted'])))
  fireEvent.change(ui.getByLabelText(en['stop.budget.steps']), { target: { value: '0' } })
  fireEvent.click(ui.getByRole('button', { name: en['stop.submit'] }))
  expect(ui.getByRole('alert').textContent).toBe(en['stop.error.budget'])
  fireEvent.change(ui.getByLabelText(en['stop.budget.steps']), { target: { value: '4' } })
  fireEvent.change(ui.getByLabelText(en['stop.budget.tokens']), { target: { value: '500' } })
  fireEvent.change(ui.getByLabelText(en['stop.budget.minutes']), { target: { value: '2' } })
  fireEvent.click(ui.getByLabelText(en['stop.checkpoint']))
  fireEvent.click(ui.getByRole('button', { name: en['stop.submit'] }))
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ boundary: '20', mode: 'drain-admitted', checkpointPolicy: 'request',
    drainBudget: { maxSteps: 4, maxTokens: 500, maxWallTimeMs: 120000 } }))
  fireEvent.click(ui.getByLabelText(new RegExp(en['stop.mode.at-boundary'])))
  fireEvent.click(ui.getByLabelText(en['stop.checkpoint']))
  fireEvent.click(ui.getByRole('button', { name: en['stop.submit'] }))
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'at-boundary', checkpointPolicy: 'none' }))
  expect(ui.queryByLabelText(en['stop.budget.steps'])).toBeNull()
})

it('keeps pending, confirmed, refused and unknown outcomes distinct and closes the standalone editor', () => {
  const ui = render(<StopCommandOutcome state={{ status: 'idle' }} retry={vi.fn()} t={t} />)
  expect(ui.container.textContent).toBe('')
  ui.rerender(<StopCommandOutcome state={{ status: 'submitting' }} retry={vi.fn()} t={t} />)
  expect(ui.getByRole('status').textContent).toBe(en['stop.outcome.submitting'])
  ui.rerender(<StopCommandOutcome state={{ status: 'confirmed', receipt: { commandId: 'command', revision: 9, activation: 'pending',
    targetId: 'target' } }} retry={vi.fn()} t={t} />)
  expect(ui.getByRole('status').textContent).toBe(en['stop.outcome.pending'])
  ui.rerender(<StopCommandOutcome state={{ status: 'confirmed' }} retry={vi.fn()} t={t} />)
  expect(ui.getByRole('status').textContent).toBe(en['stop.outcome.effective'])
  ui.rerender(<StopCommandOutcome state={{ status: 'refused', error: 'forbidden' }} retry={vi.fn()} t={t} />)
  expect(ui.getByRole('alert').textContent).toBe(en['stop.outcome.refused.forbidden'])
  ui.rerender(<StopCommandOutcome state={{ status: 'refused' }} retry={vi.fn()} t={t} />)
  expect(ui.getByRole('alert').textContent).toBe(en['stop.outcome.refused.internal'])
  ui.unmount()
  // The status union is closed; anything else is a contract violation rather than a guessed outcome.
  expect(() => StopCommandOutcome({ state: { status: 'newer-status' } as never, retry: vi.fn(), t })).toThrow('Unknown stop command status')
  const close = vi.fn()
  const dialog = render(<StopTargetDialog close={close} control={control()} now="11" state={{ status: 'idle' }} update={vi.fn()}
    retry={vi.fn()} defaults={defaults} connected t={t} />)
  expect(dialog.getByText(en['stop.editNotice'])).toBeDefined()
  fireEvent.click(dialog.getByRole('button', { name: en['stop.done'] }))
  expect(close).toHaveBeenCalledOnce()
})

it('names a not-yet-effective target by its activation and reports a drain cut without counts as zero', () => {
  const confirmed: SimulationRunControlState = { status: 'confirmed', input: { runId: 'run' as never, commandId: 'command', target },
    receipt: { commandId: 'command', revision: 9, activation: 'effective', targetId: 'target' } }
  expect(targetArmed(stop({ state: 'cleared' }), confirmed)).toBe(true)
  expect(targetArmed(stop({ state: 'draining' }), confirmed)).toBe(false)
  const edit = vi.fn()
  const ui = render(<StopTargetChip stop={stop({ activation: 'pending' })} unit={en['unit.day']} edit={edit} t={t} />)
  expect(ui.getByRole('button').getAttribute('data-stop-state')).toBe('activation.pending')
  expect(ui.getByRole('button').textContent).toContain(en['stop.state.activation.pending'])
  fireEvent.click(ui.getByRole('button'))
  expect(edit).toHaveBeenCalledOnce()
  ui.rerender(<StopTargetChip stop={stop({ state: 'cleared' })} unit={en['unit.day']} edit={edit} t={t} />)
  expect(ui.container.textContent).toBe('')
  ui.rerender(<StopProgress stop={stop({ state: 'paused', reason: 'drain-budget', cut: null })} t={t} />)
  expect(ui.getByText(t('stop.drainExhausted', { operations: 0, requests: 0, decisions: 0 }))).toBeDefined()
  ui.unmount()
  // Without an installed target or a confirmed current time the boundary starts empty instead of guessing one.
  const empty = render(<StopTargetSection control={control()} now={undefined} state={{ status: 'idle' }} update={vi.fn()} retry={vi.fn()}
    defaults={defaults} connected t={t} />)
  fireEvent.click(empty.getByLabelText(en['stop.until']))
  expect((empty.getByLabelText(t('stop.boundary', { unit: en['unit.day'] })) as HTMLInputElement).value).toBe('')
})
