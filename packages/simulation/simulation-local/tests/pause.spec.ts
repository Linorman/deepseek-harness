/** Recorded user pause settles only original prepared model slots without releasing their token usage. */
import { describe, expect, it } from 'vitest'
import { simulationDecisionIdSchema, simulationPolicyRefSchema, simulationWakeRequestSchema, simulationWindowRequestSchema,
  SimulationDecisionPausedError } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'
import { businessRecordSchema, foldBusinessRecord } from '../src/decisions.ts'

describe.each(['json', 'sqlite'] as const)('%s prepared decision pause', (backend) => {
  it('atomically returns the wake and closes its window while retaining all original token accounting', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('director'), other = await h.actor('other')
      const wake = simulationWakeRequestSchema.parse({ id: 'original-wake', entityId: actor.id, time: '0', reason: 'original input' })
      await h.run.scheduleWake(wake, h.run.snapshot().revision)
      await h.run.drive({ until: wake.time })
      const id = simulationDecisionIdSchema.parse('original-pause'), window = simulationWindowRequestSchema.parse({ id: 'pause-window',
        decisions: [{ id, entityId: actor.id, wakeId: wake.id, context: contextRequest() }] })
      await h.run.openWindow(window, h.run.snapshot().revision)
      await actor.lease.startDecision(id, 0)
      const known = await actor.lease.reserveModelTokens(id, { sessionSequence: 1, provider: 'model', model: 'version-1' })
      await actor.lease.settleModelTokens(known.id, { kind: 'complete', usage: { inputTokens: 10, outputTokens: 5 } })
      const unknown = await actor.lease.reserveModelTokens(id, { sessionSequence: 2, provider: 'model', model: 'version-1' })
      await actor.lease.settleModelTokens(unknown.id, { kind: 'unknown', observedUsage: { inputTokens: 2, outputTokens: 1 } })
      const running = h.run.snapshot()
      expect(() => businessRecordSchema.parse({ kind: 'decision/paused', id, reason: 'timeout' })).toThrow()
      expect(() => foldBusinessRecord(running, { kind: 'decision/paused', id }, running.revision + 1)).toThrow()
      expect(await actor.lease.cancelDecisionForPause(id)).toBeUndefined()
      expect(h.run.snapshot()).toEqual(running)
      await h.run.setPhase('paused', running.revision)
      const before = h.run.snapshot()
      await expect(actor.lease.readPreparedContext(id)).rejects.toBeInstanceOf(SimulationDecisionPausedError)
      await expect(actor.lease.reserveModelTokens(id, { sessionSequence: 3, provider: 'model', model: 'version-1' }))
        .rejects.toBeInstanceOf(SimulationDecisionPausedError)
      expect(h.run.snapshot()).toEqual(before)
      await expect(other.lease.cancelDecisionForPause(id)).rejects.toThrow(/another writer/)
      const cancelled = await actor.lease.cancelDecisionForPause(id)
      expect(cancelled).toMatchObject({ id, status: 'cancelled', cancellation: 'paused', operationIds: [] })
      const settled = h.run.snapshot()
      expect(settled.phase).toBe('paused')
      expect(settled.activeWindowId).toBeUndefined()
      expect(settled.windows?.[window.id]?.status).toBe('closed')
      expect(settled.wakes[wake.id]).toMatchObject({ status: 'pending' })
      expect(settled.wakes[wake.id]?.decisionId).toBeUndefined()
      expect(settled.tokenReservations).toEqual(before.tokenReservations)
      expect(await actor.lease.cancelDecisionForPause(id)).toEqual(cancelled)
      expect(h.run.snapshot()).toEqual(settled)
      for (const lease of h.leases) { await lease.revoke(); await lease.release() }
      await h.run.close()
      const cold = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        expect(cold.snapshot().decisions[id]).toEqual(cancelled)
        expect(cold.snapshot().wakes[wake.id]).toEqual(settled.wakes[wake.id])
        expect(cold.snapshot().tokenReservations).toEqual(settled.tokenReservations)
        expect(cold.snapshot().phase).toBe('paused')
      } finally { await cold.close() }
    } finally { await h.close() }
  })

  it('keeps a multi-actor window open until every original slot is settled', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const first = await h.actor('director'), second = await h.actor('newcomer')
      const a = simulationDecisionIdSchema.parse('a'), b = simulationDecisionIdSchema.parse('b')
      const window = simulationWindowRequestSchema.parse({ id: 'two-slots', decisions: [
        { id: a, entityId: first.id, context: contextRequest() }, { id: b, entityId: second.id, context: contextRequest() }] })
      await h.run.openWindow(window, h.run.snapshot().revision)
      await h.run.setPhase('paused', h.run.snapshot().revision)
      expect((await first.lease.cancelDecisionForPause(a))?.cancellation).toBe('paused')
      expect(h.run.snapshot().activeWindowId).toBe(window.id)
      expect((await second.lease.cancelDecisionForPause(b))?.cancellation).toBe('paused')
      expect(h.run.snapshot().activeWindowId).toBeUndefined()
    } finally { await h.close() }
  })

  it.each(['accepted', 'deterministic', 'unprepared'] as const)('does not relabel an %s slot or a retired writer', async (mode) => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('actor'), id = simulationDecisionIdSchema.parse('ineligible')
      await actor.lease.openDecision(id, h.run.snapshot().revision)
      if (mode !== 'unprepared') await actor.lease.prepareContext(id, contextRequest())
      if (mode === 'accepted') await actor.lease.submitDecision(id, [])
      if (mode === 'deterministic') await actor.lease.selectDeterministicPolicy(id, simulationPolicyRefSchema.parse({ id: 'policy', version: '1' }))
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const before = h.run.snapshot()
      expect(await actor.lease.cancelDecisionForPause(id)).toBeUndefined()
      expect(() => foldBusinessRecord(before, { kind: 'decision/paused', id }, before.revision + 1)).toThrow()
      expect(h.run.snapshot()).toEqual(before)
      await expect(actor.lease.readPreparedContext(id)).rejects.not.toBeInstanceOf(SimulationDecisionPausedError)
      await actor.lease.revoke()
      await expect(actor.lease.cancelDecisionForPause(id)).rejects.toThrow(/admission owner/)
    } finally { await h.close() }
  })
})
