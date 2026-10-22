import { expect, it, vi } from 'vitest'
import { simulationWorldDomainRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import { HarborNativeDomain } from '../src/harbor-domain.ts'
import { HARBOR_CONTRACTS } from '../src/harbor-protocol.ts'
import { HarborExecution } from '../src/harbor-execution.ts'
import { HarborCase } from '../src/harbor-case.ts'
import type { WorldExecutionBinding } from '../src/providers.ts'

function state(day: number): SimulationSnapshot {
  return { revision: 41, spec: { tickUnit: 'day', origin: '0' }, entities: { 'harbor-environment': { profile: { harbor: {
    day, revision: 17, publishedAtNativeSequence: 41, overview: {}, prompt: 'Task', rules: 'Rules', guide: 'Guide',
  } } } }, world: { results: {}, intents: {} } } as unknown as SimulationSnapshot
}

const request = (version: string, command: unknown) => simulationWorldDomainRequestSchema.parse({
  kind: 'world/request', domain: 'harbor', operation: 'execute', version, businessKey: 'clock-test',
  expectedTime: null, evidence: [], payload: { scopeEntityId: 'harbor', targetEntityId: 'harbor-environment', command },
})

it.each(HARBOR_CONTRACTS)('interprets $pin.version dates without rewriting the original command', (contract) => {
  const domain = new HarborNativeDomain(contract), current = state(11)
  expect(domain.stopClock.name).toBe('harbor-day')
  expect(domain.stopClock.observe(current)).toEqual({ value: '11', revision: 41 })
  expect(domain.stopClock.nativeBoundary?.(current, '12' as never)).toBe('12')
  expect(domain.stopClock.nativeBoundary?.({ ...current, spec: { ...current.spec, tickUnit: 'hour' } }, '12' as never)).toBeUndefined()
  for (const day of [12, 13]) {
    const original = request(contract.pin.version, { kind: 'advance', day }), before = structuredClone(original)
    expect(domain.stopClock.effect(current, original)).toBe(String(day))
    expect(original).toEqual(before)
  }
  expect(domain.stopClock.effect(current, request('uninstalled', { kind: 'audit' }))).toBeUndefined()
  expect(domain.stopClock.observe({ ...current, entities: {} })).toBeUndefined()
  expect(domain.stopClock.effect({ ...current, entities: {} }, request(contract.pin.version, { kind: 'audit' }))).toBeUndefined()
})

it('bounds future messages while retaining future financial obligations at the current date', () => {
  const domain = new HarborNativeDomain(), current = state(11)
  const act = (actions: unknown[]) => request('3', { kind: 'act', viewId: `view-${'0'.repeat(64)}`,
    rationale: 'An original actor makes a current dated decision.', actions })
  expect(domain.stopClock.effect(current, act([{ kind: 'message', to: ['clinic'], text: 'Current information',
    delayDays: 2, public: false }]))).toBe('13')
  expect(domain.stopClock.effect(current, act([{ kind: 'loan-offer', id: 'credit', to: 'clinic', principal: 1,
    repayAmount: 1, dueDay: 20 }]))).toBe('11')
})

it('observes committed receipts before public observation refresh, including judge refusals', () => {
  const domain = new HarborNativeDomain(), current = state(11)
  const updated = { ...current, world: { ...current.world, intents: { intent: { pin: {
    domain: 'harbor', operation: 'execute', version: '3',
  } } }, results: { result: { intentId: 'intent', outcome: { kind: 'committed' }, payload: {
    day: 12, command: 'advance', ok: false, receipt: { error: 'Rejected', decisionId: null, checkpointId: null,
      checkpointDay: null, restored: null, audit: null, report: null, wakeActors: [] },
  } } } } } as unknown as SimulationSnapshot
  expect(domain.stopClock.observe(updated)).toEqual({ value: '12', revision: 41 })
  expect(domain.stopClock.effect(updated, request('3', { kind: 'audit' }))).toBe('12')
})

it.each(['draining', 'paused', 'pending'] as const)('does not create actor opportunities for %s stopping controls', async (status) => {
  const current = { ...state(12), spec: { runId: 'stop-control' }, phase: 'running',
    runControl: { current: { activation: status === 'pending' ? 'pending' : 'effective',
      state: status === 'pending' ? 'armed' : status } } } as unknown as SimulationSnapshot
  const run = { snapshot: () => current, scheduleWake: vi.fn(), change: vi.fn() }
  const overview = vi.spyOn(HarborCase.prototype, 'overview').mockResolvedValue({ day: 12, revision: 17 })
  try {
    const handler = new HarborExecution({ run, lifetime: new AbortController().signal } as unknown as WorldExecutionBinding,
      'test-cases/harbor-society-365', '.tmp/simulation-system-development/unused-clock-case')
    expect(await handler.settleBoundary()).toBe(false)
    expect(run.scheduleWake).not.toHaveBeenCalled()
    expect(run.change).not.toHaveBeenCalled()
  } finally { overview.mockRestore() }
})
