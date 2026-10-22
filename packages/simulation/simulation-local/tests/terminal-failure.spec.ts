/** Failed canonical contexts and deadlines are durable stops, independent of a live driver. */
import { expect, it } from 'vitest'
import { simulationDecisionIdSchema, simulationWindowRequestSchema, simulationWakeRequestSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'

it.each((['json', 'sqlite'] as const).flatMap(backend => (['integrity', 'timeout'] as const).map(kind => ({ backend, kind }))))(
  'retains $backend $kind cancellation, returned wake and closed window through cold open', async ({ backend, kind }) => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('reader'), id = simulationDecisionIdSchema.parse('failed')
      const wake = simulationWakeRequestSchema.parse({ id: 'wake', entityId: actor.id, time: '0', reason: 'test' })
      await h.run.scheduleWake(wake, h.run.snapshot().revision); await h.run.drive({ until: wake.time })
      const window = simulationWindowRequestSchema.parse({ id: 'window', decisions: [{ id, entityId: actor.id,
        wakeId: wake.id, context: contextRequest() }] })
      await h.run.openWindow(window, h.run.snapshot().revision)
      const timing = await actor.lease.startDecision(id, 0)
      if (kind === 'integrity') await actor.lease.failContextIntegrity(id)
      else await actor.lease.expireDecision(id, timing.deadline)
      const stopped = h.run.snapshot()
      expect(stopped.phase).toBe('stalled')
      expect(stopped.stall).toMatchObject({ code: kind === 'integrity' ? 'SIM_CONTEXT_INTEGRITY' : 'SIM_DECISION_TIMEOUT', decisionId: id })
      expect(stopped.activeWindowId).toBeUndefined()
      expect(stopped.wakes[wake.id]?.status).toBe('pending')
      expect(stopped.decisions[id]?.status).toBe('cancelled')
      for (const lease of h.leases) { await lease.revoke(); await lease.release() }
      await h.run.close()
      const reopened = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        expect(reopened.snapshot().phase).toBe('stalled')
        expect(reopened.snapshot().stall).toEqual(stopped.stall)
        expect(reopened.snapshot().activeWindowId).toBeUndefined()
        expect(reopened.snapshot().wakes[wake.id]).toEqual(stopped.wakes[wake.id])
      } finally { await reopened.close() }
    } finally { await h.close() }
  })
