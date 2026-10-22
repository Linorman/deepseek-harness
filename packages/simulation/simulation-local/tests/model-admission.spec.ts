/** Refused model attempts retain ownership and return their wake without accepted effects or automatic retry. */
import { describe, expect, it } from 'vitest'
import { simulationDecisionIdSchema, simulationModelAdmissionBlockSchema, simulationWakeRequestSchema,
  simulationWindowRequestSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'

const block = { sessionSequence: 7, active: 1, queued: 0, limit: 1, queueLimit: 0 }
it('refuses malformed or unoccupied pool evidence instead of guessing from error text', () => {
  expect(simulationModelAdmissionBlockSchema.parse(block)).toEqual(block)
  for (const invalid of [{ ...block, active: 0 }, { ...block, queued: 1 }, { ...block, limit: 0 },
    { ...block, queueLimit: -1 }, { ...block, sessionSequence: -1 }, { ...block, extra: true }]) {
    expect(simulationModelAdmissionBlockSchema.safeParse(invalid).success).toBe(false)
  }
})

describe.each(['json', 'sqlite'] as const)('%s model admission refusal', (backend) => {
  it('retains a concurrent user pause while cancelling the refused attempt', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('director')
      const id = simulationDecisionIdSchema.parse('paused-refusal')
      await actor.lease.openDecision(id, h.run.snapshot().revision)
      await actor.lease.prepareContext(id, contextRequest())
      await actor.lease.startDecision(id, Date.now())
      await h.run.setPhase('paused', h.run.snapshot().revision)
      await actor.lease.blockModelAdmission(id, block)
      expect(h.run.snapshot().phase).toBe('paused')
      expect(h.run.snapshot().stall?.code).toBe('SIM_MODEL_POOL_CAPACITY')
      expect(h.run.snapshot().decisions[id]?.status).toBe('cancelled')
    } finally { await h.close() }
  })
  it('atomically cancels the exact attempt, closes its window and retains original refusal across replay', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('director'), foreign = await h.actor('foreign')
      const wake = simulationWakeRequestSchema.parse({ id: 'model-wake', entityId: actor.id, time: '0', reason: 'model-test' })
      await h.run.scheduleWake(wake, h.run.snapshot().revision)
      await h.run.drive({ until: wake.time })
      const id = simulationDecisionIdSchema.parse('refused')
      const window = simulationWindowRequestSchema.parse({ id: 'model-window',
        decisions: [{ id, entityId: actor.id, wakeId: wake.id, context: contextRequest() }] })
      await h.run.openWindow(window, h.run.snapshot().revision)
      await expect(actor.lease.blockModelAdmission(id, block)).rejects.toThrow(/current started/)
      await actor.lease.startDecision(id, 0)
      await expect(foreign.lease.blockModelAdmission(id, block)).rejects.toThrow(/another writer/)
      const before = h.run.snapshot().revision
      const cancelled = await actor.lease.blockModelAdmission(id, block)
      expect(cancelled).toMatchObject({ status: 'cancelled', modelAdmissionBlock: block, operationIds: [] })
      const stopped = h.run.snapshot()
      expect(stopped.revision).toBeGreaterThan(before)
      expect(stopped).toMatchObject({ phase: 'stalled', stall: { code: 'SIM_MODEL_POOL_CAPACITY', decisionId: id } })
      expect(stopped.activeWindowId).toBeUndefined()
      expect(stopped.wakes[wake.id]).toMatchObject({ status: 'pending' })
      expect(stopped.wakes[wake.id]?.decisionId).toBeUndefined()
      expect(await actor.lease.blockModelAdmission(id, block)).toEqual(cancelled)
      expect(h.run.snapshot().revision).toBe(stopped.revision)
      await expect(actor.lease.blockModelAdmission(id, { ...block, sessionSequence: 8 })).rejects.toThrow(/changed on retry/)
      await expect(actor.lease.submitDecision(id, [])).rejects.toThrow()
      await h.run.setPhase('paused', h.run.snapshot().revision)
      for (const lease of h.leases) { await lease.revoke(); await lease.release() }
      await h.run.close()
      const reopened = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        expect(reopened.snapshot().decisions[id]).toEqual(cancelled)
        expect(reopened.snapshot().stall).toEqual(stopped.stall)
        expect(reopened.snapshot().phase).toBe('paused')
      } finally { await reopened.close() }
    } finally { await h.close() }
  })

  it('rejects a retired writer and accepted effects without changing the original state', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('newcomer')
      const id = simulationDecisionIdSchema.parse('accepted')
      await actor.lease.openDecision(id, h.run.snapshot().revision)
      await actor.lease.prepareContext(id, contextRequest())
      await actor.lease.startDecision(id, Date.now())
      await actor.lease.submitDecision(id, [])
      const before = h.run.snapshot()
      await expect(actor.lease.blockModelAdmission(id, block)).rejects.toThrow(/current started/)
      expect(h.run.snapshot()).toEqual(before)
      await actor.lease.revoke()
      await expect(actor.lease.blockModelAdmission(id, block)).rejects.toThrow(/admission owner/)
    } finally { await h.close() }
  })
})
