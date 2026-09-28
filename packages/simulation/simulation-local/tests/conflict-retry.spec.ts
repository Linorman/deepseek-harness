import { describe, expect, it } from 'vitest'
import { simulationDecisionIdSchema, simulationProposalSchema, simulationWindowRequestSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'

describe.each(['json', 'sqlite'] as const)('%s bounded resource conflict retries', (backend) => {
  it('admits a retry window while an older operation waits for future communication', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const a = await h.actor('a')
      const b = await h.actor('b')
      await h.account('stock', a.id, '3', [a.id, b.id])
      await h.account('received', b.id, '0')
      const transfer = { kind: 'resource/transfer', grants: [], transaction: { commitmentId: null,
        reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: 'received', revision: 1 }],
        transfers: [{ from: 'stock', to: 'received', quantity: '1' }] } }
      await h.apply(a.lease, 'first', transfer)
      const original = await h.submit(b.lease, 'conflicted', [
        { after: [], action: transfer },
        { after: [], action: { kind: 'communication/post', recipient: a.id, channelId: 'future-channel', text: 'Future acknowledgement', deliverAt: '10' } },
        { after: [1], action: transfer },
      ])
      expect((await h.run.drive({ until: simTimeSchema.parse('0') })).reason).toBe('decision-required')
      const wake = Object.values(h.run.snapshot().wakes).find(value => value.status === 'pending')!
      const request = simulationWindowRequestSchema.parse({ id: 'replan', decisions: [{ id: 'replan', entityId: b.id,
        wakeId: wake.eventId, context: contextRequest() }] })
      const window = await h.run.openWindow(request, h.run.snapshot().revision)
      await b.lease.submitDecision(request.decisions[0]!.id, [])
      await h.run.commitWindow(window.id)
      expect((await h.run.drive({ until: simTimeSchema.parse('0') })).reason).toBe('until')
      expect(h.run.snapshot().operations[original.operationIds[2]!]?.result).toBeUndefined()
      expect(Object.values(h.run.snapshot().resources).map(value => value.quantity)).toEqual(['2', '1'])
    } finally { await h.close() }
  })
  it('records exhaustion on the initial conflict when retries are disabled', async () => {
    const h = await createBusinessHarness(backend, { maxConflictRetries: 0 })
    try {
      const actor = await h.actor('a')
      await h.account('stock', actor.id, '2')
      await h.account('received', actor.id, '0')
      const action = { kind: 'resource/transfer', grants: [], transaction: { commitmentId: null,
        reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: 'received', revision: 1 }],
        transfers: [{ from: 'stock', to: 'received', quantity: '1' }] } }
      await h.apply(actor.lease, 'first', action)
      const result = await h.apply(actor.lease, 'stale', action)
      expect(result.code).toBe('SIM_RESOURCE_REVISION_CONFLICT')
      expect(h.run.snapshot().stall).toMatchObject({ code: 'SIM_CONFLICT_RETRY_LIMIT', attempt: 0 })
      expect(h.run.snapshot().scheduledEvents).toEqual({})
      const applied = Object.values(h.run.snapshot().operations).find(operation => operation.result?.status === 'applied')!
      await expect(h.run.acknowledgeConflict(applied.id, h.run.snapshot().revision)).rejects.toThrow(/no exhausted retry/)
    } finally { await h.close() }
  })
  it('queues one next-microstep responsibility and retains exhausted budget after reopen', async () => {
    const h = await createBusinessHarness(backend, { maxConflictRetries: 1 })
    try {
      const a = await h.actor('a')
      const b = await h.actor('b')
      await h.account('stock', a.id, '2', [a.id, b.id])
      await h.account('received', b.id, '0')
      const proposal = simulationProposalSchema.parse({ after: [], action: { kind: 'resource/transfer', grants: [], transaction: {
        commitmentId: null, reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: 'received', revision: 1 }],
        transfers: [{ from: 'stock', to: 'received', quantity: '1' }],
      } } })
      const window = await h.run.openWindow(simulationWindowRequestSchema.parse({ id: 'competing', decisions: [a, b].map(actor => ({
        id: actor.id, entityId: actor.id, context: contextRequest(),
      })) }), h.run.snapshot().revision)
      await a.lease.submitDecision(simulationDecisionIdSchema.parse(a.id), [proposal])
      await b.lease.submitDecision(simulationDecisionIdSchema.parse(b.id), [proposal, proposal])
      await h.run.commitWindow(window.id)
      expect((await h.run.drive({ until: simTimeSchema.parse('0') })).reason).toBe('decision-required')
      const retries = Object.values(h.run.snapshot().scheduledEvents).filter(event => event.action.kind === 'conflict-retry')
      expect(retries).toHaveLength(1)
      expect(retries[0]).toMatchObject({ key: { time: '0', microstep: '1' }, action: { rootDecisionId: b.id, attempt: 1 } })
      const wake = Object.values(h.run.snapshot().wakes).find(value => value.status === 'pending')!
      const id = simulationDecisionIdSchema.parse('retry')
      const retry = await b.lease.openDecision(id, h.run.snapshot().revision, wake.eventId)
      expect(retry.retry).toMatchObject({ rootDecisionId: b.id, attempt: 1 })
      const accepted = await b.lease.submitDecision(id, [proposal])
      expect((await h.run.drive({ until: simTimeSchema.parse('0') })).reason).toBe('stalled')
      const failed = accepted.operationIds[0]!
      expect(h.run.snapshot().operations[failed]?.conflictRetry).toMatchObject({ kind: 'exhausted', rootDecisionId: b.id, attempt: 1 })
      expect(Object.values(h.run.snapshot().resources).map(value => value.quantity)).toEqual(['1', '1'])
      const originalResult = h.run.snapshot().operations[failed]!.result
      expect(await h.run.executeOperation(failed)).toEqual(originalResult)
      for (const lease of h.leases) { await lease.revoke(); await lease.release() }
      await h.run.close()
      const reopened = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        await expect(reopened.setPhase('running', reopened.snapshot().revision)).rejects.toThrow(/acknowledgement/)
        await reopened.acknowledgeConflict(failed, reopened.snapshot().revision)
        expect(await reopened.acknowledgeConflict(failed, 0)).toEqual(reopened.snapshot())
        await reopened.setPhase('running', reopened.snapshot().revision)
        expect((await reopened.drive({ until: simTimeSchema.parse('0') })).reason).toBe('until')
        expect(reopened.snapshot().operations[failed]?.result).toEqual(originalResult)
        expect(Object.values(reopened.snapshot().scheduledEvents).filter(event => event.action.kind === 'conflict-retry')).toHaveLength(1)
      } finally { await reopened.close() }
    } finally { await h.close() }
  })
})
