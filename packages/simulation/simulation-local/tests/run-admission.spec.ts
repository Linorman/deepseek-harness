/** Public run admission and retry behavior through durable owners. */
import { describe, expect, it, vi } from 'vitest'
import { simulationChangeSchema, simulationCheckpointIdSchema, simulationDecisionIdSchema,
  simulationDispatchSelectionRequestSchema, simulationEntityIdSchema, simulationOperationIdSchema, simulationParticipantSpecSchema,
  simulationProposalSchema,
  simulationWakeRequestSchema, simulationWindowIdSchema, simulationWindowRequestSchema, simTimeSchema,
} from '@clocky/clocky-simulation'
import type { LogStream } from '@clocky/clocky-storage'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'
import { LocalSimulationRun } from '../src/run.ts'

describe.each(['json', 'sqlite'] as const)('%s run admission', (backend) => {
  it('rejects unknown durable identities without changing the journal', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const before = h.run.snapshot()
      await expect(h.run.failCheckpoint(simulationCheckpointIdSchema.parse('missing'), 'Failure')).rejects.toThrow(/does not exist/)
      await expect(h.run.commitWindow(simulationWindowIdSchema.parse('missing'))).rejects.toThrow(/does not exist/)
      await expect(h.run.executeOperation(simulationOperationIdSchema.parse('missing'))).rejects.toThrow(/does not exist/)
      await expect(h.run.acknowledgeConflict(simulationOperationIdSchema.parse('missing'), before.revision)).rejects.toThrow()
      expect(await h.run.reserveDecisionWindow(simulationDispatchSelectionRequestSchema.parse({ id: 'empty', limit: 1 }), before.revision))
        .toBeUndefined()
      expect(h.run.snapshot()).toEqual(before)
    } finally { await h.close() }
  })

  it('retains a decision identity across open and cancellation retries', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('actor')
      expect(() => { actor.lease.bindDecisionAdmission(async () => {}) }).toThrow(/already bound/)
      const id = simulationDecisionIdSchema.parse('decision')
      const decision = await actor.lease.openDecision(id, h.run.snapshot().revision)
      expect(await actor.lease.openDecision(id, 0)).toEqual(decision)
      const cancelled = await actor.lease.cancelDecision(id)
      const before = h.run.snapshot()
      expect(await actor.lease.cancelDecision(id)).toEqual(cancelled)
      expect(h.run.snapshot()).toEqual(before)
      await expect(h.run.reserveParticipant(actor.id, simulationParticipantSpecSchema.parse({
        displayName: 'Actor', role: 'Actor', capabilities: [], provider: 'local', preset: 'actor', model: 'model',
      }), before.revision)).rejects.toThrow(/reserved canonical Team/)
    } finally { await h.close() }
  })

  it('rejects a replaced submitted proposal and cannot accept replayed slots without their live owner', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('actor')
      const request = simulationWindowRequestSchema.parse({ id: 'window', decisions: [{
        id: 'decision', entityId: actor.id, context: contextRequest(),
      }] })
      await h.run.openWindow(request, h.run.snapshot().revision)
      const id = request.decisions[0]!.id
      await actor.lease.submitDecision(id, [])
      await expect(actor.lease.submitDecision(id, [simulationProposalSchema.parse({ after: [], action: { kind: 'communication/post',
        recipient: actor.id, channelId: 'channel', text: 'Changed', deliverAt: '0',
      } })])).rejects.toThrow(/changed its payload/)
      const stream = (h.run as unknown as { stream: LogStream }).stream
      const replayed = new LocalSimulationRun(stream, h.run.snapshot(), backend, async () => {}, () => {})
      await expect(replayed.commitWindow(request.id)).rejects.toThrow(/lost its writer/)
      await h.run.commitWindow(request.id)
      await expect(h.run.commitWindow(simulationWindowIdSchema.parse('other'))).rejects.toThrow(/does not exist/)
      await actor.lease.revoke()
      await expect(h.run.openWindow({ ...request, id: simulationWindowIdSchema.parse('retired') }, h.run.snapshot().revision))
        .rejects.toThrow(/no live admission owner/)
    } finally { await h.close() }
  })

  it('rejects unavailable wake targets, cancels obsolete pending wakes and prevents clock rewind', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('actor')
      const wake = simulationWakeRequestSchema.parse({ id: 'wake', entityId: actor.id, time: '0', reason: 'Work' })
      await expect(h.run.scheduleWake({ ...wake, entityId: simulationEntityIdSchema.parse('absent') }, h.run.snapshot().revision))
        .rejects.toThrow(/active cognitive entity/)
      await h.run.scheduleWake(wake, h.run.snapshot().revision)
      await h.run.drive({ until: simTimeSchema.parse('0') })
      await actor.lease.revoke(); await actor.lease.release()
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: actor.id, phase: 'inactive',
        entityRevision: h.run.snapshot().entities[actor.id]!.revision }), h.run.snapshot().revision)
      await h.run.drive({ until: simTimeSchema.parse('1') })
      expect(h.run.snapshot().wakes[wake.id]?.status).toBe('cancelled')
      await expect(h.run.drive({ until: simTimeSchema.parse('0') })).rejects.toThrow(/cannot rewind/)
      await expect(h.run.scheduleWake({ ...wake, id: simulationWakeRequestSchema.parse({ ...wake, id: 'later' }).id },
        h.run.snapshot().revision)).rejects.toThrow(/active cognitive entity/)
    } finally { await h.close() }
  })

  it('refuses a persistence reference when the storage tail moved outside the projection', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const stream = (h.run as unknown as { stream: LogStream }).stream
      const observed = stream.tailSequence
      const changed = vi.spyOn(stream, 'tailSequence', 'get').mockReturnValue(observed + 1)
      try { await expect(h.run.getPersistenceReference(h.run.snapshot().revision)).rejects.toThrow(/does not match its durable journal/) }
      finally { changed.mockRestore() }
      expect((await h.run.getPersistenceReference(h.run.snapshot().revision)).cursor).toBe(observed)
    } finally { await h.close() }
  })
})
