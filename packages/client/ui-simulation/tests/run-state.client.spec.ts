/** One synthesis decides every run-state wording; sources that disagree or age never present as current execution. */
import { describe, expect, it } from 'vitest'
import type { SimulationProductControl, SimulationProductRunInspection, SimulationProductRunStatus } from '@clocky/clocky-client-runtime/client'
import { defaultStaleAfterMs, runState, stopCategory } from '../src/client/run-state.ts'
import type { RunStateInput, RunStop } from '../src/client/run-state.ts'
import { en } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'

const NOW = 1_000_000
const native = (phase: 'paused' | 'running' | 'stalled', extra: Partial<NonNullable<SimulationProductRunInspection['world']>> = {}): SimulationProductRunInspection => ({
  run: { id: 'run' as never, name: { text: 'Harbor', truncated: false }, registeredAt: 1, observation: 'not-observed' },
  status: 'observed', world: { revision: 7, phase, time: '12' as never, tickUnit: { text: 'day', truncated: false },
    owner: 'this-provider', entityCount: 1, decisionCount: 1, operationCount: 1, observedAt: NOW, ...extra } })
const control = (value: Partial<SimulationProductControl>): SimulationProductControl => ({
  runId: 'run' as never, owner: 'held', phase: 'paused', revision: 7, driver: 'idle', inFlight: false, observedAt: NOW,
  actions: { start: { allowed: true, reason: 'ready' }, pause: { allowed: false, reason: 'ready' } },
  administration: { actions: { checkpoint: { allowed: true, reason: 'ready' }, restore: { allowed: false, reason: 'ready' },
    prepare: { allowed: false, reason: 'ready' }, ingress: { allowed: false, reason: 'ready' } },
  ingress: { maxTime: '0' as never, maxBytes: 1, targets: [] } },
  budget: { model: { provider: 'p', name: 'm' }, tokensPerRequest: 1, tokensPerInterval: 1, interval: '1' as never,
    residentActors: 1, sharedModelLimit: 1 }, ...value })
const input = (value: Partial<RunStateInput>): RunStateInput => ({ nativeFailed: false, connected: true, now: NOW,
  refreshMs: 2000, staleAfterMs: 30000, ...value })
const failure = (retryDisposition: 'explicit-resume' | 'account-action') => ({ failureId: '00000000-0000-4000-8000-000000000001',
  ownerId: '00000000-0000-4000-8000-000000000002', batchId: '00000000-0000-4000-8000-000000000003', occurredAt: NOW, revision: 7,
  category: 'insufficient-balance', retryDisposition, actionCode: 'check-account' }) as NonNullable<SimulationProductControl['failure']>

describe('derivation table', () => {
  it.each([
    ['paused without in-flight work offers Continue', native('paused'), control({}), 'paused', 'start'],
    ['paused with in-flight work is still stopping', native('paused'), control({ inFlight: true }), 'stopping', undefined],
    ['paused while the driver advances is still stopping', native('paused'), control({ driver: 'advancing' }), 'stopping', undefined],
    ['a checkpoint being collected after the pause is saving', native('paused'), control({ driver: 'checkpointing' }), 'saving', undefined],
    ['an observed working driver is running and offers Pause', native('running'), control({ phase: 'running', driver: 'advancing', inFlight: true }), 'running', 'pause'],
    ['a scheduled driver is running', native('running'), control({ phase: 'running', driver: 'scheduled' }), 'running', 'pause'],
    ['running requested with an idle driver and no work is idle, not running', native('running'), control({ phase: 'running', driver: 'idle' }), 'idle', 'pause'],
    ['a review stop needs attention', native('running'), control({ phase: 'running', driver: 'idle', stop: 'review-required' }), 'attention', 'review'],
    ['a budget stop is blocked and recovery is primary', native('running'), control({ phase: 'running', driver: 'waiting', stop: 'budget-limit',
      actions: { start: { allowed: false, reason: 'scenario-blocked' }, pause: { allowed: true, reason: 'ready' } } }), 'blocked', 'recover'],
    ['a budget stop the Host allows continuing offers Continue', native('running'), control({ phase: 'running', driver: 'waiting', stop: 'model-pool-capacity' }), 'blocked', 'start'],
    ['a failed driver is failed and recovery is primary', native('running'), control({ phase: 'running', driver: 'failed' }), 'failed', 'recover'],
    ['an explicit-resume failure offers Continue', native('running'), control({ phase: 'running', driver: 'failed', failure: failure('explicit-resume') }), 'failed', 'start'],
    ['a recovery-required start is failed', native('paused'), control({ actions: { start: { allowed: false, reason: 'recovery-required' }, pause: { allowed: false, reason: 'ready' } } }), 'failed', 'recover'],
    ['a stalled world is blocked', native('stalled', { schedulerStop: { code: 'STOP', recovery: 'RESUME' } }), control({ phase: 'stalled' }), 'blocked', 'recover'],
    ['a completed scenario is completed with no primary', native('paused'), control({ driver: 'completed' }), 'completed', undefined],
    ['sources with different phases are reconciling', native('running'), control({ phase: 'paused' }), 'reconciling', 'refresh'],
  ] as const)('%s', (_name, world, value, kind, primary) => {
    const state = runState(input({ native: world, control: value }))
    expect(state.kind).toBe(kind)
    expect(state.primaryAction).toBe(primary)
    expect(state.freshness).toBe('live')
    expect(en[state.headline]).toBeDefined()
  })

  it('never offers Pause while paused or Continue while running', () => {
    expect(runState(input({ native: native('paused'), control: control({}) })).primaryAction).not.toBe('pause')
    expect(runState(input({ native: native('running'), control: control({ phase: 'running', driver: 'advancing' }) })).primaryAction).not.toBe('start')
  })

  it('reads the directory operational projection when no control is present', () => {
    const row: SimulationProductRunInspection = { ...native('running'), operational: { status: 'observed', observedAt: NOW,
      scenario: { status: 'unavailable' }, owner: 'held', driver: 'idle', inFlight: true, stop: 'work-limit' } }
    expect(runState(input({ native: row })).kind).toBe('running')
    const idle = { ...row, operational: { ...row.operational, inFlight: false } } as SimulationProductRunInspection
    expect(runState(input({ native: idle })).kind).toBe('idle')
  })

  it('states an unavailable observation with its safe reason and asks for a refresh', () => {
    const row: SimulationProductRunStatus = { run: native('paused').run, status: 'unavailable',
      errorSummary: { text: 'Simulation observation is unavailable', truncated: false }, reason: 'history-limit' }
    const state = runState(input({ native: row }))
    expect(state).toMatchObject({ kind: 'unknown', primaryAction: 'refresh', unavailable: 'history-limit', detail: 'state.unavailable.history-limit' })
  })

  it('distinguishes a missing run and no observation at all', () => {
    expect(runState(input({ native: { run: native('paused').run, status: 'missing' } }))).toMatchObject({ kind: 'unknown', detail: 'state.detail.missing' })
    expect(runState(input({}))).toMatchObject({ kind: 'unknown', freshness: 'unknown', primaryAction: 'refresh' })
  })

  it('categorizes every Host stop that has localized copy', () => {
    // The closed Record fails compilation when the protocol adds a stop; unknown copy keys stay uncategorized.
    const categorized = Object.keys(en).filter(key => key.startsWith('status.stop.'))
      .map(key => key.slice('status.stop.'.length) as RunStop).filter(stop => stopCategory(stop) !== undefined)
    expect(categorized.length).toBeGreaterThan(40)
    expect(stopCategory('plan-budget')).toBe('blocked')
    expect(stopCategory('until')).toBe('idle')
    expect(stopCategory('review-required')).toBe('attention')
  })
})

describe('freshness', () => {
  it('ages and then expires an observation that stops refreshing', () => {
    const at = (now: number) => runState(input({ native: native('paused'), control: control({}), now }))
    expect(at(NOW + 5000).freshness).toBe('live')
    expect(at(NOW + 5001).freshness).toBe('aging')
    expect(at(NOW + 30000).freshness).toBe('aging')
    const stale = at(NOW + 30001)
    expect(stale.freshness).toBe('stale')
    expect(stale.kind).toBe('paused')
    expect(stale.primaryAction).toBe('refresh')
  })

  it('downgrades a failed read and disconnection to a last observation, never to running', () => {
    const running = { native: native('running'), control: control({ phase: 'running', driver: 'advancing' }) }
    for (const value of [input({ ...running, nativeFailed: true, controlFailed: true }), input({ ...running, controlFailed: true }),
      input({ ...running, connected: false }), input({ native: native('running'), nativeFailed: true })]) {
      const state = runState(value)
      expect(state.freshness).toBe('stale')
      expect(state.primaryAction).toBe('refresh')
      expect(state.observedAt).toBe(NOW)
    }
  })

  it('treats a native value confirmed by the revision watch as live regardless of its age', () => {
    const state = runState(input({ native: native('paused', { observedAt: 1 }), nativeWatched: true, control: control({}) }))
    expect(state.freshness).toBe('live')
    expect(state.observedAt).toBe(1)
  })

  it('derives the default threshold from the refresh interval', () => {
    expect(defaultStaleAfterMs(2000)).toBe(30000)
    expect(defaultStaleAfterMs(10000)).toBe(150000)
  })
})

it('has localized copy for every headline and detail it can return', () => {
  const keys: Key[] = ['state.running', 'state.stopping', 'state.saving', 'state.paused', 'state.idle', 'state.attention', 'state.blocked',
    'state.failed', 'state.completed', 'state.reconciling', 'state.unknown', 'state.detail.missing', 'state.detail.reconciling',
    'state.detail.nativeStop', 'state.detail.saving', 'state.detail.stopping', 'state.detail.noWork', 'state.detail.waiting',
    'state.detail.settling', 'state.detail.idle']
  for (const key of keys) expect(en[key]).toBeTruthy()
})

it('keeps scheduling usable from a live control when only the native detail read fails', () => {
  const NOW2 = 1_000_000
  const state = runState({ native: undefined, control: { runId: 'run', owner: 'held', phase: 'running', revision: 7, driver: 'advancing',
    inFlight: true, observedAt: NOW2, actions: { start: { allowed: false, reason: 'ready' }, pause: { allowed: true, reason: 'ready' } },
    administration: { actions: { checkpoint: { allowed: true, reason: 'ready' } } } } as never,
  nativeFailed: true, connected: true, now: NOW2, refreshMs: 2000, staleAfterMs: 30000 })
  expect(state).toMatchObject({ kind: 'running', primaryAction: 'pause', freshness: 'live', detailLimited: true })
  const both = runState({ control: { runId: 'run', owner: 'held', phase: 'running', driver: 'advancing', inFlight: true, observedAt: NOW2,
    actions: { start: { allowed: false, reason: 'ready' }, pause: { allowed: true, reason: 'ready' } },
    administration: { actions: { checkpoint: { allowed: true, reason: 'ready' } } } } as never,
  nativeFailed: true, controlFailed: true, connected: true, now: NOW2, refreshMs: 2000, staleAfterMs: 30000 })
  expect(both).toMatchObject({ freshness: 'stale', primaryAction: 'refresh', detailLimited: false })
})

describe('remaining derivations', () => {
  const target = (state: 'armed' | 'draining' | 'paused', reason: 'target-reached' | 'drain-budget' | null = null) => ({ revision: 7,
    commandId: 'command', activation: 'effective', state, reason, cut: null, steps: 0, tokens: 0, checkpointId: null, checkpointAttemptCount: 0,
    nativeBoundary: null, checkpoint: 'not-requested', target: { targetId: 'target', clock: { kind: 'native' }, boundary: '12',
      mode: 'drain-admitted', checkpointPolicy: 'request', drainBudget: { maxSteps: 1, maxTokens: 1, maxWallTimeMs: 60000 } } }) as never

  it('keeps a failed native detail read out of freshness while the live control is current', () => {
    const state = runState(input({ native: native('running'), nativeFailed: true,
      control: control({ phase: 'running', driver: 'advancing', inFlight: true }) }))
    expect(state).toMatchObject({ kind: 'running', freshness: 'live', detailLimited: true })
    expect(state.sources.native?.failed).toBe(true)
  })

  it('names an unavailable observation without a reason generically and a stalled native stop specifically', () => {
    const unavailable = { run: native('paused').run, status: 'unavailable' } as unknown as SimulationProductRunInspection
    expect(runState(input({ native: unavailable }))).toMatchObject({ kind: 'unknown', detail: 'state.unavailable.unavailable' })
    const stalled = native('stalled', { schedulerStop: { code: 'SIM_BUDGET_LIMIT', recovery: 'raise-budget' } })
    expect(runState(input({ native: stalled, control: control({ phase: 'stalled' }) })))
      .toMatchObject({ kind: 'blocked', primaryAction: 'recover', detail: 'state.detail.nativeStop' })
  })

  it('follows a stop target from draining to reached, editing only once nothing is still settling', () => {
    expect(runState(input({ native: native('running'), control: control({ phase: 'running', driver: 'advancing', stopTarget: target('draining') }) })))
      .toMatchObject({ kind: 'stopping', detail: 'state.detail.draining' })
    expect(runState(input({ native: native('paused'), control: control({ inFlight: true, stopTarget: target('paused', 'target-reached') }) })))
      .toMatchObject({ kind: 'stopping', detail: 'state.detail.draining' })
    expect(runState(input({ native: native('paused'), control: control({ stopTarget: target('paused', 'target-reached') }) })))
      .toMatchObject({ kind: 'paused', primaryAction: 'edit-target', detail: 'state.detail.targetReached' })
  })

  it('fails a running run that records a failure, offering Continue only for an explicit-resume disposition', () => {
    expect(runState(input({ native: native('running'), control: control({ phase: 'running', driver: 'idle', failure: failure('explicit-resume') }) })))
      .toMatchObject({ kind: 'failed', primaryAction: 'start' })
    expect(runState(input({ native: native('running'), control: control({ phase: 'running', driver: 'idle', failure: failure('account-action') }) })))
      .toMatchObject({ kind: 'failed', primaryAction: 'recover' })
  })

  it('explains a running run waiting for its effective time', () => {
    expect(runState(input({ native: native('running'), control: control({ phase: 'running', driver: 'idle', stop: 'waiting-effective-time' }) })))
      .toMatchObject({ kind: 'running', primaryAction: 'pause', detail: 'state.detail.waiting' })
  })

  it('keeps a paused run stopping while its driver is scheduled or retiring and omits the no-work line when work is unobserved', () => {
    for (const driver of ['scheduled', 'retiring'] as const) {
      expect(runState(input({ native: native('paused'), control: control({ driver }) }))).toMatchObject({ kind: 'stopping' })
    }
    const unobserved = runState(input({ native: native('paused'), control: control({ inFlight: undefined as never }) }))
    expect(unobserved).toMatchObject({ kind: 'paused', primaryAction: 'start' })
    expect(unobserved.detail).toBeUndefined()
  })
})
