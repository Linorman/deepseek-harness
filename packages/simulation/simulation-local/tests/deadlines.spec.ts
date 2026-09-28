import { describe, expect, it, vi } from 'vitest'
import { simulationDecisionIdSchema, simulationWindowRequestSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'

describe.each(['json', 'sqlite'] as const)('%s durable deadlines', (backend) => {
  it('reuses the first deadline and expires a late submission without accepting intents', async () => {
    const h = await createBusinessHarness(backend, { decisionTimeoutMs: 100 })
    try {
      const actor = await h.actor('a')
      const id = simulationDecisionIdSchema.parse('late')
      await actor.lease.openDecision(id, h.run.snapshot().revision)
      await actor.lease.prepareContext(id, contextRequest())
      expect(await actor.lease.startDecision(id, 1000)).toEqual({ startedAt: 1000, deadline: 1100 })
      expect(await actor.lease.startDecision(id, 1050)).toEqual({ startedAt: 1000, deadline: 1100 })
      expect((await actor.lease.expireDecision(id, 1099)).status).toBe('open')
      await h.run.setPhase('paused', h.run.snapshot().revision)
      vi.spyOn(Date, 'now').mockReturnValue(1100)
      const result = await actor.lease.submitDecision(id, [])
      expect(result).toMatchObject({ status: 'cancelled', cancellation: 'timeout', inference: { expiredAt: 1100 } })
      expect((await actor.lease.expireDecision(id, 1200)).inference?.expiredAt).toBe(1100)
      expect(h.run.snapshot().operations).toEqual({})
      expect(h.run.snapshot().phase).toBe('paused')
    } finally { vi.restoreAllMocks(); await h.close() }
  })

  it('keeps a completed later-slot proposal while timing out the unfinished first slot', async () => {
    const h = await createBusinessHarness(backend, { decisionTimeoutMs: 100 })
    try {
      const a = await h.actor('a')
      const b = await h.actor('b')
      const request = simulationWindowRequestSchema.parse({ id: 'timed', decisions: [a, b].map(actor => ({
        id: actor.id, entityId: actor.id, context: contextRequest(),
      })) })
      const window = await h.run.openWindow(request, h.run.snapshot().revision)
      const aId = request.decisions[0]!.id
      const bId = request.decisions[1]!.id
      await a.lease.startDecision(aId, 1000)
      await b.lease.startDecision(bId, 1000)
      vi.spyOn(Date, 'now').mockReturnValue(1099)
      expect((await b.lease.submitDecision(bId, [])).inference?.finishedAt).toBe(1099)
      expect((await h.run.commitWindow(window.id)).status).toBe('collecting')
      expect((await b.lease.expireDecision(bId, 1200)).status).toBe('submitted')
      await a.lease.expireDecision(aId, 1200)
      expect((await h.run.commitWindow(window.id)).status).toBe('closed')
      expect(h.run.snapshot().decisions[bId]?.status).toBe('accepted')
      expect(h.run.snapshot().decisions[aId]?.cancellation).toBe('timeout')
    } finally { vi.restoreAllMocks(); await h.close() }
  })
})
