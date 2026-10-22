// @vitest-environment jsdom
/** Scheduling controls follow Host allowability, retain exact original manage intents, and isolate in-flight work. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { Controls } from '../src/client/Controls.tsx'
import { runState } from '../src/client/run-state.ts'
import { en } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'
import type { SimulationProductControl, SimulationCommand, SimulationCommandState, SimulationReadState } from '@clocky/clocky-client-runtime/client'

afterEach(cleanup)
const t = (key: Key) => en[key]

function makeControl(overrides: {
  startAllowed?: boolean
  pauseAllowed?: boolean
  startReason?: SimulationProductControl['actions']['start']['reason']
  pauseReason?: SimulationProductControl['actions']['pause']['reason']
  phase?: SimulationProductControl['phase']
  driver?: SimulationProductControl['driver']
  inFlight?: boolean
  owner?: SimulationProductControl['owner']
  adminOverrides?: Partial<SimulationProductControl['administration']['actions']>
} = {}): SimulationProductControl {
  const adminActions = { checkpoint: { allowed: true, reason: 'ready' as const },
    restore: { allowed: true, reason: 'ready' as const },
    prepare: { allowed: true, reason: 'ready' as const },
    ingress: { allowed: true, reason: 'ready' as const },
    ...(overrides.adminOverrides ?? {}) }
  return {
    runId: 'run' as never,
    administration: { actions: adminActions,
      ingress: { maxTime: 100 as never, maxBytes: 1000, targets: [] } },
    budget: { model: { provider: 'p', name: 'm' }, tokensPerRequest: 1000, tokensPerInterval: 10000, interval: 60 as never,
      residentActors: 2, sharedModelLimit: 4 },
    owner: overrides.owner ?? 'held', phase: 'phase' in overrides ? overrides.phase : 'paused', revision: 1,
    driver: overrides.driver ?? 'idle', inFlight: overrides.inFlight ?? false, observedAt: 1,
    actions: { start: { allowed: overrides.startAllowed ?? true, reason: overrides.startReason ?? 'ready' },
      pause: { allowed: overrides.pauseAllowed ?? false, reason: overrides.pauseReason ?? 'stalled' } },
  }
}

function setup(value: SimulationReadState<SimulationProductControl>, overrides: Partial<Parameters<typeof Controls>[0]> = {}) {
  const retain = vi.fn((_command: SimulationCommand) => 'key' as never)
  const submit = vi.fn(async () => undefined as SimulationCommandState | undefined)
  const refresh = vi.fn(async () => {})
  const openMaintenance = vi.fn()
  const view = render(<Controls name="Run A" value={value} connected authorizationVersion={1}
    blockedPhases={[]} blockedMaintenance={[]} openMaintenance={openMaintenance}
    retain={retain} submit={submit} refresh={refresh} t={t} {...overrides} />)
  return { view, retain, submit, refresh, openMaintenance }
}

function openMaintenanceSection(view: ReturnType<typeof render>) {
  const details = view.container.querySelector('details[data-simulation-maintenance]')
  if (details) (details as HTMLDetailsElement).open = true
}

it('renders full driver/phase/owner observations and starts scheduling through an exact retained manage command', async () => {
  const h = setup({ loading: false, stale: false, value: makeControl() })
  expect(h.view.getByText(en['driver.idle'])).toBeDefined()
  expect(h.view.getByText(en['paused'])).toBeDefined()
  expect(h.view.getByText(en['this-provider'])).toBeDefined()
  fireEvent.click(h.view.getByRole('button', { name: en.start }))
  const modal = within(h.view.getByRole('dialog', { name: en.start }))
  expect(modal.getByText('Run A')).toBeDefined()
  expect(modal.getByText(en.model)).toBeDefined()
  expect(modal.getByText('p/m')).toBeDefined()
  fireEvent.click(modal.getByRole('button', { name: en.start }))
  await waitFor(() => { expect(h.submit).toHaveBeenCalledOnce() })
  expect(h.retain.mock.calls[0]?.[0]).toMatchObject({ kind: 'manage', input: { runId: 'run', phase: 'running' } })
  expect(h.retain).toHaveBeenCalledOnce()
  await waitFor(() => { expect(h.refresh).toHaveBeenCalledOnce() })
})

it('pauses directly when allowed and shows the start not-allowed reason', () => {
  const h = setup({ loading: false, stale: false, value: makeControl({ startAllowed: false, pauseAllowed: true,
    pauseReason: 'ready', startReason: 'recovery-required' }) })
  fireEvent.click(h.view.getByRole('button', { name: en.pauseScheduling }))
  expect(h.retain.mock.calls[0]?.[0]).toMatchObject({ kind: 'manage', input: { phase: 'paused' } })
  expect(h.view.getByText(en['controlReason.recovery-required'])).toBeDefined()
})

it('explains that evidence and timeout attempts consume the planning limit and that restarting cannot reset it', () => {
  const control = { ...makeControl({ startAllowed: false, startReason: 'scenario-blocked', phase: 'running', driver: 'waiting' }),
    stop: 'plan-budget' as const }
  const h = setup({ loading: false, stale: false, value: control }, { compact: true })
  expect(h.view.getByRole('status').textContent).toBe(en['controlReason.plan-budget'])
  expect(h.view.queryByText(en['controlReason.scenario-blocked'])).toBeNull()
  expect((h.view.getByRole('button', { name: en.start }) as HTMLButtonElement).disabled).toBe(true)
  expect(h.retain).not.toHaveBeenCalled()
})

it('shows resume label when prepare reason is scenario-progressed and preserves compact in-flight display', () => {
  const h = setup({ loading: false, stale: false, value: makeControl({
    adminOverrides: { prepare: { allowed: false, reason: 'scenario-progressed' } },
    inFlight: true, phase: 'running', driver: 'advancing' }) }, { compact: true })
  expect(h.view.getByRole('button', { name: en.resumeScheduling })).toBeDefined()
  expect(h.view.getByText(en.inFlight)).toBeDefined()
  expect(h.view.getByText(en['maintenanceReason.scenario-progressed'])).toBeDefined()
})

it('opens maintenance dialogs for allowed unblocked kinds and disables blocked ones', () => {
  const h = setup({ loading: false, stale: false, value: makeControl() },
    { blockedMaintenance: ['restore', 'ingress'] })
  openMaintenanceSection(h.view)
  fireEvent.click(h.view.getByRole('button', { name: en['maintenance.checkpoint'] }))
  expect(h.openMaintenance).toHaveBeenCalledWith('checkpoint')
  expect(h.view.getByRole('button', { name: en['maintenance.restore'] }).hasAttribute('disabled')).toBe(true)
  expect(h.view.getByRole('button', { name: en['maintenance.ingress'] }).hasAttribute('disabled')).toBe(true)
})

it('disables start and pause when disconnected, stale, or blocked by phase', () => {
  const h = setup({ loading: false, stale: true, value: makeControl() }, { blockedPhases: ['running'], connected: false })
  expect(h.view.getByRole('button', { name: en.start }).hasAttribute('disabled')).toBe(true)
  expect(h.view.getByRole('button', { name: en.pauseScheduling }).hasAttribute('disabled')).toBe(true)
})

it('reports unavailable and forbidden errors with distinct messages and no control body', () => {
  const h1 = setup({ loading: false, stale: false, value: undefined, error: 'unavailable' })
  expect(h1.view.getByText(en.noManagement)).toBeDefined()
  const h2 = setup({ loading: false, stale: false, value: undefined, error: 'forbidden' })
  expect(h2.view.getByText(en.noControlAccess)).toBeDefined()
})

it('refreshes controls and reports command capacity failure without losing the admission guard', async () => {
  const h = setup({ loading: false, stale: false, value: makeControl() })
  openMaintenanceSection(h.view)
  fireEvent.click(h.view.getByRole('button', { name: en.refreshControl }))
  await waitFor(() => { expect(h.refresh).toHaveBeenCalledOnce() })
  h.retain.mockImplementation(() => { throw new Error('capacity') })
  fireEvent.click(h.view.getByRole('button', { name: en.start }))
  fireEvent.click(within(h.view.getByRole('dialog', { name: en.start })).getByRole('button', { name: en.start }))
  await waitFor(() => { expect(h.view.getByText(en.commandCapacity)).toBeDefined() })
})

it('does not refresh after unmount, preserving the active guard', async () => {
  const pending = Promise.withResolvers<SimulationCommandState | undefined>()
  const h = setup({ loading: false, stale: false, value: makeControl() },
    { submit: vi.fn(async () => pending.promise) })
  fireEvent.click(h.view.getByRole('button', { name: en.start }))
  fireEvent.click(within(h.view.getByRole('dialog', { name: en.start })).getByRole('button', { name: en.start }))
  h.view.unmount()
  pending.resolve(undefined)
  await Promise.resolve()
  expect(h.refresh).not.toHaveBeenCalled()
})

it('renders unavailable phase and unowned owner, and cancels the start confirmation modal', () => {
  const unavailable = setup({ loading: false, stale: false, value: makeControl({ phase: undefined, owner: 'not-held' }) })
  expect(unavailable.view.getByText(en.unavailable)).toBeDefined()
  expect(unavailable.view.getByText(en.unowned)).toBeDefined()
  const h = setup({ loading: false, stale: false, value: makeControl({ phase: 'running' }) })
  expect(h.view.getByText(en.running)).toBeDefined()
  fireEvent.click(h.view.getAllByRole('button', { name: en.start })[0]!)
  const modal = within(h.view.getByRole('dialog', { name: en.start }))
  fireEvent.click(modal.getAllByRole('button', { name: en.cancel })[0]!)
  expect(h.view.queryByRole('dialog')).toBeNull()
  expect(h.submit).not.toHaveBeenCalled()
})

it('shows pause not-allowed reason and start not-allowed reason in the maintenance section', () => {
  const h = setup({ loading: false, stale: false, value: makeControl({ startAllowed: false, pauseAllowed: false,
    startReason: 'stalled', pauseReason: 'recovery-required' }) })
  openMaintenanceSection(h.view)
  expect(h.view.getByText(en['controlReason.recovery-required'])).toBeDefined()
  expect(h.view.getByText(en['controlReason.stalled'])).toBeDefined()
})

it('blocks concurrent manage admission: a second click during submit does not retain twice', async () => {
  const pending = Promise.withResolvers<SimulationCommandState | undefined>()
  const h = setup({ loading: false, stale: false, value: makeControl({ pauseAllowed: true, pauseReason: 'ready' }) },
    { submit: vi.fn(async () => pending.promise) })
  fireEvent.click(h.view.getByRole('button', { name: en.pauseScheduling }))
  fireEvent.click(h.view.getByRole('button', { name: en.pauseScheduling }))
  expect(h.retain).toHaveBeenCalledOnce()
  pending.resolve(undefined)
  await waitFor(() => { expect(h.refresh).toHaveBeenCalledOnce() })
})

it('closes the start modal via onClose without submitting', () => {
  const h = setup({ loading: false, stale: false, value: makeControl() })
  fireEvent.click(h.view.getByRole('button', { name: en.start }))
  const modal = within(h.view.getByRole('dialog', { name: en.start }))
  fireEvent.click(modal.getAllByRole('button', { name: en.cancel })[0]!)
  expect(h.view.queryByRole('dialog')).toBeNull()
  expect(h.submit).not.toHaveBeenCalled()
})

it('renders a generic control error when it is neither unavailable nor forbidden', () => {
  const h = setup({ loading: false, stale: false, value: undefined, error: 'network' })
  expect(h.view.getByText(en.network)).toBeDefined()
})

it('preserves the manage not-found guard when control observation clears during an admission attempt', async () => {
  const h = setup({ loading: false, stale: false, value: makeControl() },
    { submit: vi.fn(async () => { throw new Error('not found') }) })
  fireEvent.click(h.view.getByRole('button', { name: en.start }))
  const modal = within(h.view.getByRole('dialog', { name: en.start }))
  const submitButton = modal.getByRole('button', { name: en.start })
  h.view.rerender(<Controls name="Run A" value={{ loading: false, stale: false, value: undefined }} connected={false}
    authorizationVersion={1} blockedPhases={[]} blockedMaintenance={[]} openMaintenance={h.openMaintenance}
    retain={h.retain} submit={h.submit} refresh={h.refresh} t={t} />)
  fireEvent.click(submitButton)
  await waitFor(() => { expect(h.submit).not.toHaveBeenCalled() })
  expect(h.retain).not.toHaveBeenCalled()
})

it('does not update error state after unmount when retain throws', async () => {
  const h = setup({ loading: false, stale: false, value: makeControl({ pauseAllowed: true, pauseReason: 'ready' }) },
    { retain: vi.fn(() => { throw new Error('capacity') }) })
  fireEvent.click(h.view.getByRole('button', { name: en.pauseScheduling }))
  h.view.unmount()
  await Promise.resolve()
  expect(h.submit).not.toHaveBeenCalled()
  expect(h.refresh).not.toHaveBeenCalled()
})

it('invokes the modal onClose callback directly to close the start confirmation', () => {
  const h = setup({ loading: false, stale: false, value: makeControl() })
  fireEvent.click(h.view.getByRole('button', { name: en.start }))
  const modal = within(h.view.getByRole('dialog', { name: en.start }))
  fireEvent.click(modal.getAllByRole('button', { name: en.cancel }).at(-1)!)
  expect(h.view.queryByRole('dialog')).toBeNull()
  expect(h.submit).not.toHaveBeenCalled()
})

it('does not attempt manage when a stale start-confirmation button is clicked after control clears', () => {
  const h = setup({ loading: false, stale: false, value: makeControl() })
  fireEvent.click(h.view.getByRole('button', { name: en.start }))
  const submitButton = within(h.view.getByRole('dialog', { name: en.start })).getByRole('button', { name: en.start })
  h.view.rerender(<Controls name="Run A" value={{ loading: false, stale: false, value: undefined }} connected={false}
    authorizationVersion={1} blockedPhases={[]} blockedMaintenance={[]} openMaintenance={h.openMaintenance}
    retain={h.retain} submit={h.submit} refresh={h.refresh} t={t} />)
  fireEvent.click(submitButton)
  expect(h.retain).not.toHaveBeenCalled()
  expect(h.submit).not.toHaveBeenCalled()
})

it('returns early when manage admission is requested after unmount clears the active guard', async () => {
  const pending = Promise.withResolvers<SimulationCommandState | undefined>()
  const h = setup({ loading: false, stale: false, value: makeControl({ pauseAllowed: true, pauseReason: 'ready' }) },
    { submit: vi.fn(async () => pending.promise) })
  fireEvent.click(h.view.getByRole('button', { name: en.pauseScheduling }))
  h.view.unmount()
  pending.resolve(undefined)
  await Promise.resolve()
  expect(h.retain).toHaveBeenCalledOnce()
  expect(h.refresh).not.toHaveBeenCalled()
})

it('returns early from manage when value becomes stale before an already-rendered start action is invoked', async () => {
  const h = setup({ loading: false, stale: false, value: makeControl() })
  fireEvent.click(h.view.getByRole('button', { name: en.start }))
  h.view.rerender(<Controls name="Run A" value={{ loading: false, stale: true, value: makeControl() }} connected
    authorizationVersion={1} blockedPhases={[]} blockedMaintenance={[]} openMaintenance={h.openMaintenance}
    retain={h.retain} submit={h.submit} refresh={h.refresh} t={t} />)
  fireEvent.click(within(h.view.getByRole('dialog', { name: en.start })).getByRole('button', { name: en.start }))
  expect(h.retain).not.toHaveBeenCalled()
  expect(h.submit).not.toHaveBeenCalled()
})

it('renders in-flight work in both full and compact layouts', () => {
  const full = setup({ loading: false, stale: false, value: makeControl({ inFlight: true }) })
  expect(full.view.getByText(en.inFlight)).toBeDefined()
  const compact = setup({ loading: false, stale: false, value: makeControl({ inFlight: true }) }, { compact: true })
  expect(compact.view.container.textContent).toContain(en.inFlight)
})

it('skips refresh after unmount during a running submit', async () => {
  const pending = Promise.withResolvers<SimulationCommandState | undefined>()
  const h = setup({ loading: false, stale: false, value: makeControl() },
    { submit: vi.fn(async () => pending.promise) })
  fireEvent.click(h.view.getAllByRole('button', { name: en.start })[0]!)
  const dialog = h.view.getByRole('dialog', { name: en.start })
  const submitBtn = within(dialog).getByRole('button', { name: en.start })
  fireEvent.click(submitBtn)
  h.view.unmount()
  pending.resolve(undefined)
  await new Promise(r => setTimeout(r, 50))
  expect(h.refresh).not.toHaveBeenCalled()
})

it('admits only one manage command from two clicks in the same render frame', async () => {
  const pending = Promise.withResolvers<SimulationCommandState | undefined>()
  const h = setup({ loading: false, stale: false, value: makeControl({ pauseAllowed: true, pauseReason: 'ready' }) },
    { submit: vi.fn(() => pending.promise) })
  const pause = h.view.getByRole('button', { name: en.pauseScheduling })
  act(() => { fireEvent.click(pause); fireEvent.click(pause) })
  expect(h.retain).toHaveBeenCalledOnce()
  pending.resolve(undefined)
  await waitFor(() => { expect(h.refresh).toHaveBeenCalledOnce() })
})

it('contains a late manage rejection after its controls have unmounted', async () => {
  const pending = Promise.withResolvers<SimulationCommandState | undefined>()
  const h = setup({ loading: false, stale: false, value: makeControl({ pauseAllowed: true, pauseReason: 'ready' }) },
    { submit: vi.fn(() => pending.promise) })
  fireEvent.click(h.view.getByRole('button', { name: en.pauseScheduling }))
  h.view.unmount()
  pending.reject(new Error('Host rejected after navigation'))
  await expect(pending.promise).rejects.toThrow('Host rejected after navigation')
  await Promise.resolve()
  expect(h.refresh).not.toHaveBeenCalled()
})

it('reviews an exact overrun quote and retains only a paused acknowledgement, without a start', async () => {
  const quote = { reservationId: 'tokens/10' as never, reserved: 16384, used: 26990, interval: '0', additionalTokens: 0 }
  const control = { ...makeControl({ startAllowed: false, startReason: 'scenario-blocked' }),
    tokenRecovery: { request: quote, allowed: true, reason: 'ready' as const } }
  const h = setup({ loading: false, stale: false, value: control })
  fireEvent.click(h.view.getByRole('button', { name: en['tokenRecovery.action'] }))
  expect(h.retain).not.toHaveBeenCalled()
  const dialog = within(h.view.getByRole('dialog', { name: en['tokenRecovery.action'] }))
  expect(dialog.getByText('26,990')).toBeDefined()
  fireEvent.click(dialog.getByRole('button', { name: en['tokenRecovery.confirm'] }))
  await waitFor(() => { expect(h.submit).toHaveBeenCalledOnce() })
  expect(h.retain.mock.calls[0]?.[0]).toMatchObject({ kind: 'manage', input: { phase: 'paused', tokenRecovery: quote } })
})

it.each(['pause-required', 'in-flight', 'unknown-usage', 'ownership-unavailable'] as const)('explains %s without enabling acknowledgement', (reason) => {
  const control = { ...makeControl(), tokenRecovery: { request: {
    reservationId: 'tokens/10' as never, reserved: 16384, used: 26990, interval: '0', additionalTokens: 0 }, allowed: false, reason } }
  const h = setup({ loading: false, stale: false, value: control })
  expect(h.view.getByRole('button', { name: en['tokenRecovery.action'] }).hasAttribute('disabled')).toBe(true)
  expect(h.view.getByText(en[`tokenRecovery.${reason}`])).toBeDefined()
})

describe('primary action from the synthesized run state', () => {
  const stateFor = (control: SimulationProductControl, extra: Partial<Parameters<typeof runState>[0]> = {}) => runState({
    control, nativeFailed: false, connected: true, now: control.observedAt, refreshMs: 2000, staleAfterMs: 30000, ...extra })
  const names = (view: ReturnType<typeof render>) => within(view.container).queryAllByRole('button').map(button => button.textContent)

  it('offers only Continue while safely paused and only Pause while running', () => {
    const paused = makeControl()
    const h = setup({ loading: false, stale: false, value: paused }, { state: stateFor(paused) })
    expect(h.view.getByRole('button', { name: en.start })).toBeDefined()
    expect(h.view.queryByRole('button', { name: en.pauseScheduling })).toBeNull()
    h.view.unmount()
    const running = makeControl({ phase: 'running', driver: 'advancing', startAllowed: false, pauseAllowed: true })
    const r = setup({ loading: false, stale: false, value: running }, { state: stateFor(running) })
    expect(r.view.getByRole('button', { name: en.pauseScheduling }).className).toContain('primary')
    expect(r.view.queryByRole('button', { name: en.start })).toBeNull()
    expect(names(r.view)).not.toContain(en.start)
  })

  it('offers no primary scheduling action while accepted work is still stopping', () => {
    const stopping = makeControl({ inFlight: true, startAllowed: false })
    const h = setup({ loading: false, stale: false, value: stopping }, { state: stateFor(stopping) })
    const start = h.view.getByRole('button', { name: en.start })
    expect(start.hasAttribute('disabled')).toBe(true)
    expect(start.className).toContain('secondary')
    expect(h.view.queryByRole('button', { name: en.pauseScheduling })).toBeNull()
  })

  it('makes recovery primary when the scheduler failed and opens the allowed restore', () => {
    const failed = makeControl({ phase: 'running', driver: 'failed', startAllowed: false, pauseAllowed: true })
    const h = setup({ loading: false, stale: false, value: failed }, { state: stateFor(failed) })
    const recover = h.view.getByRole('button', { name: en['state.action.recover'] })
    expect(recover.className).toContain('primary')
    fireEvent.click(recover)
    expect(h.openMaintenance).toHaveBeenCalledWith('restore')
    expect(h.view.getByRole('button', { name: en.pauseScheduling }).className).toContain('secondary')
  })

  it('explains a failed state with no allowed remedy instead of offering a dead primary', () => {
    const failed = makeControl({ phase: 'running', driver: 'failed', startAllowed: false, adminOverrides: { restore: { allowed: false, reason: 'checkpoint-required' } } })
    const h = setup({ loading: false, stale: false, value: failed }, { state: stateFor(failed) })
    expect(h.view.getByRole('button', { name: en['state.action.recover'] }).hasAttribute('disabled')).toBe(true)
    expect(h.view.getByText(en['state.recoverUnavailable'])).toBeDefined()
  })

  it('replaces scheduling with Refresh and disables maintenance while the observation is stale', () => {
    const paused = makeControl()
    const refreshState = vi.fn()
    const state = stateFor(paused, { connected: true, now: paused.observedAt + 60000 })
    const h = setup({ loading: false, stale: false, value: paused }, { state, refreshState })
    expect(h.view.getByRole('button', { name: en.start }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(h.view.getByRole('button', { name: en['state.action.refresh'] }))
    expect(refreshState).toHaveBeenCalledOnce()
    expect(h.view.getByText(en['state.refreshFirst'])).toBeDefined()
    openMaintenanceSection(h.view)
    expect(h.view.getByRole('button', { name: en['maintenance.checkpoint'] }).hasAttribute('disabled')).toBe(true)
  })

  it('opens the resolving surface for an attention state', () => {
    const review = vi.fn()
    const attention = { ...makeControl({ phase: 'running', startAllowed: false, pauseAllowed: true }), stop: 'review-required' as const }
    const h = setup({ loading: false, stale: false, value: attention }, { state: stateFor(attention), review })
    fireEvent.click(h.view.getByRole('button', { name: en['state.action.review'] }))
    expect(review).toHaveBeenCalledOnce()
  })
})
