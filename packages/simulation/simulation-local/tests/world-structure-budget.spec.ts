/** Actual retained hiring ownership exercises structural quota admission, cancellation and journal reopen. */
import { describe, expect, it } from 'vitest'
import { simTimeSchema, simulationWakeRequestSchema, simulationWorldCancelRequestSchema } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { assertWorldBirthBudget, assertWorldMutationSlot, assertWorldStructureBudgetProjection,
  pendingWorldMutations } from '../src/world-structure-budget.ts'

const limit = (value: string) => ({ code: 'SIM_WORLD_LIMIT', failure: { code: 'SIM_WORLD_LIMIT', limit: value } })
describe.each(['json', 'sqlite'] as const)('%s structural budgets', (backend) => {
  it('zero births rejects before retaining identity or funds and survives journal reopen', async () => {
    const h = await hiringResourceHarness(backend, 'generate-and-hire', { births: 0 })
    try {
      const plan = await h.plan(), before = h.run.snapshot()
      await expect(h.reserve(plan)).rejects.toMatchObject(limit('births'))
      expect(h.run.snapshot()).toEqual(before)
      expect(before.world!.reservations).toEqual({})
      expect(before.resourceReservations).toEqual({})
      await h.connection.close(); await h.run.close()
      const reopened = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
      try {
        expect(reopened.snapshot().world).toEqual(before.world)
        await expect(reopened.reserveWorldHire(h.generatedRequest(plan))).rejects.toMatchObject(limit('births'))
        expect(h.requests).toHaveLength(0)
      } finally { await reopened.close() }
    } finally { await h.close() }
  })

  it('unprepared cancellation releases the pending slot but never refunds the original interval birth', async () => {
    const h = await hiringResourceHarness(backend, 'generate-and-hire', { births: 1 })
    try {
      const plan = await h.plan('reserved-once'), reserved = await h.run.reserveWorldHire(h.generatedRequest(plan))
      expect(reserved).toMatchObject({ reservedAt: '0', status: 'reserved' })
      expect(reserved.prepared).toBeUndefined()
      const before = h.run.snapshot()
      expect(pendingWorldMutations(before)).toEqual(new Set([reserved.id]))
      expect(() =>{  assertWorldMutationSlot(before) }).toThrow(expect.objectContaining(limit('mutations')))
      expect(() =>{  assertWorldMutationSlot(before, reserved.id) }).not.toThrow()
      expect(await h.run.reserveWorldHire(h.generatedRequest(plan))).toEqual(reserved)
      expect(h.run.snapshot()).toEqual(before)
      const carried = { ...before, time: simTimeSchema.parse('100') }
      expect(() =>{  assertWorldBirthBudget(carried, false) }).toThrow(expect.objectContaining(limit('births')))
      expect(() =>{  assertWorldBirthBudget(carried, false, reserved.id) }).not.toThrow()
      await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'cancel-reservation', requestId: plan.requestId }))
      const cancelled = h.run.snapshot()
      expect(pendingWorldMutations(cancelled).size).toBe(0)
      expect(() =>{  assertWorldBirthBudget(cancelled, false) }).toThrow(expect.objectContaining(limit('births')))
      expect(() =>{  assertWorldBirthBudget({ ...cancelled, time: simTimeSchema.parse('100') }, false) }).not.toThrow()
      const next = await h.plan('different-case'), nextState = h.run.snapshot()
      await expect(h.reserve(next)).rejects.toMatchObject(limit('births'))
      expect(h.run.snapshot()).toEqual(nextState)
      assertWorldStructureBudgetProjection(nextState)
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })

  it('cross-period cancellation keeps the settlement interval charged', async () => {
    const h = await hiringResourceHarness(backend, 'generate-and-hire', { births: 1, period: '250' })
    try {
      const plan = await h.plan(), reservation = await h.run.reserveWorldHire(h.generatedRequest(plan))
      await h.run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'birth-boundary', entityId: h.requester,
        time: '100', reason: 'Original unresolved birth crosses its interval' }), h.run.snapshot().revision)
      await h.run.drive({ until: simTimeSchema.parse('100') })
      expect(h.run.snapshot().time).toBe('100')
      expect(() =>{  assertWorldBirthBudget(h.run.snapshot(), false) }).toThrow(expect.objectContaining(limit('births')))
      await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'cancel-carried', requestId: plan.requestId }))
      const cancelled = h.run.snapshot()
      expect(cancelled.world!.reservations[reservation.id]!.status).toBe('abandoned')
      expect(pendingWorldMutations(cancelled).size).toBe(0)
      expect(() =>{  assertWorldBirthBudget(cancelled, false) }).toThrow(expect.objectContaining(limit('births')))
      expect(() =>{  assertWorldBirthBudget({ ...cancelled, time: simTimeSchema.parse('200') }, false) }).not.toThrow()
      assertWorldStructureBudgetProjection(cancelled)
    } finally { await h.close() }
  })

  it('committed identity retains its structural slot until original maintenance finishes', async () => {
    const h = await hiringResourceHarness(backend, 'generate-and-hire', { births: 1 })
    try {
      const plan = await h.plan(), prepared = await h.prepareGenerated(plan)
      expect(prepared.prepared).toEqual({ time: '0', sequence: prepared.updatedSequence })
      const result = await h.run.commitWorldHire(prepared.id), committed = h.run.snapshot()
      expect(pendingWorldMutations(committed)).toEqual(new Set([prepared.id]))
      expect(() =>{  assertWorldMutationSlot(committed) }).toThrow(expect.objectContaining(limit('mutations')))
      expect(await h.run.commitWorldHire(prepared.id)).toEqual(result)
      expect(h.run.snapshot()).toEqual(committed)
      await h.run.finishMaintenance(prepared.request.maintenance)
      const settled = h.run.snapshot()
      expect(pendingWorldMutations(settled).size).toBe(0)
      expect(() =>{  assertWorldBirthBudget(settled, false) }).toThrow(expect.objectContaining(limit('births')))
      expect(() =>{  assertWorldBirthBudget({ ...settled, time: simTimeSchema.parse('100') }, false) }).not.toThrow()
      assertWorldStructureBudgetProjection(settled)
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })

  it('existing-person funds hold the same mutation slot without consuming a birth', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { births: 1 })
    try {
      const plan = await h.plan(), hold = await h.run.reserveExistingHireResources(plan.id), state = h.run.snapshot()
      expect(pendingWorldMutations(state)).toEqual(new Set([hold!.world!.intentId]))
      expect(() =>{  assertWorldBirthBudget(state, false) }).not.toThrow()
      expect(() =>{  assertWorldMutationSlot(state) }).toThrow(expect.objectContaining(limit('mutations')))
      expect(() =>{  assertWorldMutationSlot(state, hold!.world!.intentId) }).not.toThrow()
      await h.run.commitWorldMutation({ planId: plan.id, payload: plan.proposal.resolution.kind === 'apply' ? plan.proposal.resolution.payload : {} })
      expect(pendingWorldMutations(h.run.snapshot()).size).toBe(0)
    } finally { await h.close() }
  })
})
