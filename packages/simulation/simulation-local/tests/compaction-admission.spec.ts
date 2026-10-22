/** Auxiliary refusal preserves exact canonical request ownership, without charging an undispatched model. */
import { describe, expect, it } from 'vitest'
import { simulationCompactionTokenRequestSchema, simulationDecisionIdSchema, simulationWakeRequestSchema,
  simulationWindowRequestSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'

const request = simulationCompactionTokenRequestSchema.parse({ compactionId: 'auxiliary', sessionSequence: 3,
  provider: 'scripted', model: 'fixture' })
const pool = { active: 1, queued: 0, limit: 1, queueLimit: 0 }, hash = 'a'.repeat(64)

describe.each(['json', 'sqlite'] as const)('%s auxiliary admission', (backend) => {
  it('retains a paused auxiliary refusal without creating a world decision or token reservation', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('director')
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const blocked = await actor.lease.blockCompactionModelAdmission(request, pool, hash)
      expect(blocked).toEqual({ entityId: actor.id, epoch: actor.lease.epoch, sessionId: actor.id,
        request, pool, requestHash: hash })
      const state = h.run.snapshot()
      expect(state.phase).toBe('paused')
      expect(state.decisions).toEqual({})
      expect(state.tokenReservations ?? {}).toEqual({})
      expect(state.stall?.code).toBe('SIM_COMPACTION_MODEL_POOL_CAPACITY')
      expect(await actor.lease.blockCompactionModelAdmission(request, pool, hash)).toEqual(blocked)
      expect(h.run.snapshot().revision).toBe(state.revision)
      await expect(actor.lease.blockCompactionModelAdmission({ ...request, sessionSequence: 4 }, pool, hash))
        .rejects.toThrow(/changed on retry/)
      await expect(actor.lease.blockCompactionModelAdmission(request, pool, 'b'.repeat(64))).rejects.toThrow(/changed on retry/)
      expect(() => actor.lease.blockCompactionModelAdmission(request, { ...pool, active: 0 }, hash)).toThrow()
      await actor.lease.revoke(); await actor.lease.release()
      await h.run.close()
      const reopened = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        expect(reopened.snapshot().compactionAdmissionBlocks).toEqual([blocked])
        expect(reopened.snapshot().stall).toEqual(state.stall)
        expect(reopened.snapshot().phase).toBe('paused')
      } finally { await reopened.close() }
    } finally { await h.close() }
  })

  it('atomically returns the original wake and closes the unsubmitted window, retaining user pause', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('newcomer')
      const wake = simulationWakeRequestSchema.parse({ id: 'wake', entityId: actor.id, time: '0', reason: 'first-action' })
      await h.run.scheduleWake(wake, h.run.snapshot().revision)
      await h.run.drive({ until: wake.time })
      const id = simulationDecisionIdSchema.parse('unsubmitted')
      await h.run.openWindow(simulationWindowRequestSchema.parse({ id: 'window',
        decisions: [{ id, entityId: actor.id, wakeId: wake.id, context: contextRequest() }] }), h.run.snapshot().revision)
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const block = await actor.lease.blockCompactionModelAdmission(request, pool, hash)
      expect(block.decisionId).toBe(id)
      const state = h.run.snapshot()
      expect(state.phase).toBe('paused')
      expect(state.activeWindowId).toBeUndefined()
      expect(state.decisions[id]).toMatchObject({ status: 'cancelled', cancellation: 'requested', operationIds: [] })
      expect(state.wakes[wake.id]).toMatchObject({ status: 'pending' })
      expect(state.wakes[wake.id]?.decisionId).toBeUndefined()
      expect(state.tokenReservations ?? {}).toEqual({})
      await expect(actor.lease.submitDecision(id, [])).rejects.toThrow()
    } finally { await h.close() }
  })

  it('cannot cancel accepted effects, forge request fields or use a retired epoch', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('director')
      const id = simulationDecisionIdSchema.parse('accepted')
      await actor.lease.openDecision(id, h.run.snapshot().revision)
      await actor.lease.submitDecision(id, [])
      const accepted = h.run.snapshot().decisions[id]
      expect(() => actor.lease.blockCompactionModelAdmission({ ...request, extra: true } as typeof request, pool, hash)).toThrow()
      await actor.lease.blockCompactionModelAdmission(request, pool, hash)
      expect(h.run.snapshot().decisions[id]).toEqual(accepted)
      await actor.lease.revoke()
      await expect(actor.lease.blockCompactionModelAdmission(request, pool, hash)).rejects.toThrow(/admission owner/)
    } finally { await h.close() }
  })
})
