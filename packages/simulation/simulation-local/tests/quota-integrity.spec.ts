import { afterEach, expect, it } from 'vitest'
import { simulationBudgetGrantRequestSchema, simulationCapacityGrantRequestSchema, simulationDecisionIdSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { assertBudgetProjection, foldBudget } from '../src/budget.ts'
import { assertCapacityProjection, foldCapacity } from '../src/capacity.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })

it('rejects overflowing administrative grants and fabricated quota exhaustion without changing state', async () => {
  const h = await createBusinessHarness('sqlite')
  cleanups.push(h.close)
  const state = h.run.snapshot()
  const budget = simulationBudgetGrantRequestSchema.parse({ id: 'too-large', budget: 'decisions', interval: '0',
    amount: Number.MAX_SAFE_INTEGER, reason: 'Overflow' })
  const capacity = simulationCapacityGrantRequestSchema.parse({ id: 'too-large', capacity: 'events',
    amount: Number.MAX_SAFE_INTEGER, reason: 'Overflow' })
  await expect(h.run.extendBudget(budget, state.revision)).rejects.toThrow(/safe integer/)
  await expect(h.run.extendCapacity(capacity, state.revision)).rejects.toThrow(/safe integer/)
  expect(() => foldBudget(state, { kind: 'budget/exhausted', budget: 'decisions', requested: 1 })).toThrow(/not exhausted/)
  expect(() => foldCapacity(state, { kind: 'capacity/exhausted', capacity: 'events', requested: 1 })).toThrow(/not exhausted/)
  expect(h.run.snapshot()).toEqual(state)
  const bounded = { ...capacity, amount: 1 }
  const granted = foldCapacity(state, { kind: 'capacity/extended', request: bounded })
  expect(() => foldCapacity(granted, { kind: 'capacity/extended', request: bounded })).toThrow(/identity is retained/)
})

it('diagnoses retained work that exceeds independently declared budget or backlog limits', async () => {
  const h = await createBusinessHarness('sqlite')
  cleanups.push(h.close)
  const actor = await h.actor('actor')
  const id = simulationDecisionIdSchema.parse('work')
  await actor.lease.openDecision(id, h.run.snapshot().revision)
  const state = h.run.snapshot()
  expect(() => { assertBudgetProjection({ ...state, spec: { ...state.spec, maxDecisionsPerInterval: 0 } }) }).toThrow(/exceeds its granted/)
  await actor.lease.submitDecision(id, [])
  const { simulationWakeRequestSchema } = await import('@clocky/clocky-simulation')
  await h.run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'wake', entityId: actor.id, time: '0', reason: 'Work' }), h.run.snapshot().revision)
  const pending = h.run.snapshot()
  expect(() => { assertCapacityProjection({ ...pending, spec: { ...pending.spec, maxPendingEvents: 0 } }) })
    .toThrow(/exceed granted capacity/)
})

it('preserves a rejected grant demand as a distinct event without fabricating a budget extension', async () => {
  const h = await createBusinessHarness('sqlite', { maxDecisionsPerInterval: 0 })
  cleanups.push(h.close)
  const actor = await h.actor('actor')
  await expect(actor.lease.openDecision(simulationDecisionIdSchema.parse('blocked'), h.run.snapshot().revision)).rejects.toThrow(/budget exhausted/)
  expect(h.run.snapshot().budgetGrants).toBeUndefined()
  expect(h.run.snapshot().decisions).toEqual({})
  expect(h.run.snapshot().stall).toMatchObject({ code: 'SIM_BUDGET_LIMIT', used: 0, limit: 0, requested: 1 })
})
