import { describe, expect, it } from 'vitest'
import { simulationCapacityGrantRequestSchema, simulationDecisionIdSchema, simulationWakeRequestSchema,
  simulationIngressRequestSchema, simulationProposalSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'

const grant = (capacity: 'events' | 'interactions', amount: number) =>
  simulationCapacityGrantRequestSchema.parse({ id: `${capacity}-addition`, capacity, amount, reason: 'Allow retained responsibilities' })
const request = (assignee: string, id: string, deadline = false) => ({ kind: 'interaction/request', id, assignee,
  description: 'Review', replyBy: deadline ? '5' : null, completeBy: deadline ? '10' : null, fulfillment: { kind: 'explicit' } })

describe.each(['json', 'sqlite'] as const)('%s pending capacity', (backend) => {
  it('counts consumed wakes, refuses ingress atomically and releases capacity only at completion', async () => {
    const h = await createBusinessHarness(backend, { maxPendingEvents: 1 })
    try {
      const a = await h.actor('a')
      const wake = simulationWakeRequestSchema.parse({ id: 'wake', entityId: a.id, time: '1', reason: 'Work' })
      await h.run.scheduleWake(wake, h.run.snapshot().revision)
      const input = simulationIngressRequestSchema.parse({ id: 'input', entityId: a.id, source: 'operator', text: 'Work', availableAt: '1' })
      await expect(h.run.ingest(input)).rejects.toThrow(/events capacity/)
      expect(h.run.snapshot().ingresses).toBeUndefined()
      await expect(h.run.setPhase('running', h.run.snapshot().revision)).rejects.toThrow(/freed or extended/)
      await h.run.cancelEvent(wake.id, 'Withdraw scheduled work', h.run.snapshot().revision)
      await h.run.setPhase('running', h.run.snapshot().revision)
      const received = await h.run.ingest(input)
      await h.run.drive({ until: simTimeSchema.parse('1') })
      expect(h.run.queueUsage().events.used).toBe(1)
      const id = simulationDecisionIdSchema.parse('consume')
      await a.lease.openDecision(id, h.run.snapshot().revision, received.eventId)
      expect(h.run.queueUsage().events.used).toBe(1)
      await a.lease.submitDecision(id, [])
      expect(h.run.queueUsage().events.used).toBe(0)
      expect(Object.keys(h.run.snapshot().scheduledEvents)).toHaveLength(2)
    } finally { await h.close() }
  })

  it('retains an accepted request until capacity is extended, and rejection frees its slot', async () => {
    const h = await createBusinessHarness(backend, { maxPendingInteractions: 1 })
    try {
      const a = await h.actor('a'); const b = await h.actor('b')
      await h.apply(a.lease, 'first', request(b.id, 'first'))
      const accepted = await h.submit(a.lease, 'second', [{ after: [], action: request(b.id, 'second') }])
      const operation = accepted.operationIds[0]!
      await expect(h.run.executeOperation(operation)).rejects.toThrow(/interactions capacity/)
      expect(h.run.snapshot().operations[operation]?.result).toBeUndefined()
      expect(h.run.queueUsage().interactions.used).toBe(1)
      const addition = grant('interactions', 1)
      await h.run.extendCapacity(addition, h.run.snapshot().revision)
      await h.run.extendCapacity(addition, 0)
      await expect(h.run.extendCapacity({ ...addition, amount: 2 }, 0)).rejects.toThrow(/changed its payload/)
      await h.run.setPhase('running', h.run.snapshot().revision)
      const effect = await h.run.executeOperation(operation)
      expect(await h.run.executeOperation(operation)).toEqual(effect)
      expect(h.run.queueUsage().interactions).toEqual({ used: 2, limit: 2 })
      await h.apply(b.lease, 'reject', { kind: 'interaction/reject', id: 'first', expectedRevision: 1, reason: 'Declined' })
      expect(h.run.queueUsage().interactions.used).toBe(1)
      expect(Object.keys(h.run.snapshot().interactions)).toHaveLength(2)
    } finally { await h.close() }
  })

  it('keeps a business effect and its deadline absent together and reuses a cancelled timer slot', async () => {
    const h = await createBusinessHarness(backend, { maxPendingEvents: 0 })
    try {
      const a = await h.actor('a'); const b = await h.actor('b')
      const accepted = await h.submit(a.lease, 'request', [{ after: [], action: request(b.id, 'work', true) }])
      await expect(h.run.executeOperation(accepted.operationIds[0]!)).rejects.toThrow(/events capacity/)
      expect(h.run.snapshot().interactions).toEqual({})
      expect(h.run.snapshot().scheduledEvents).toEqual({})
      await h.run.extendCapacity(grant('events', 1), h.run.snapshot().revision)
      await h.run.setPhase('running', h.run.snapshot().revision)
      await h.run.executeOperation(accepted.operationIds[0]!)
      await h.apply(b.lease, 'accept', { kind: 'interaction/accept', id: 'work', expectedRevision: 1 })
      expect(h.run.queueUsage().events).toEqual({ used: 1, limit: 1 })
      expect(Object.values(h.run.snapshot().scheduledEvents).map(event => [event.action.kind, event.status]))
        .toEqual([['reply-deadline', 'cancelled'], ['commitment-deadline', 'pending']])
    } finally { await h.close() }
  })

  it('accounts for a completed wake when reserving all message events in one acceptance batch', async () => {
    const h = await createBusinessHarness(backend, { maxPendingEvents: 1 })
    try {
      const a = await h.actor('a'); const b = await h.actor('b')
      const wake = simulationWakeRequestSchema.parse({ id: 'wake', entityId: a.id, time: '1', reason: 'Send messages' })
      await h.run.scheduleWake(wake, h.run.snapshot().revision)
      await h.run.drive({ until: simTimeSchema.parse('1') })
      const id = simulationDecisionIdSchema.parse('messages')
      await a.lease.openDecision(id, h.run.snapshot().revision, wake.id)
      const proposals = [0, 1].map(index => simulationProposalSchema.parse({ after: [], action: { kind: 'communication/post',
        recipient: b.id, channelId: 'channel', text: `Message ${index}`, deliverAt: '5',
      } }))
      await expect(a.lease.submitDecision(id, proposals)).rejects.toThrow(/events capacity/)
      expect(h.run.snapshot().stall).toMatchObject({ code: 'SIM_QUEUE_CAPACITY', used: 1, limit: 1, requested: 1 })
      expect(h.run.snapshot().operations).toEqual({})
      expect(h.run.snapshot().wakes[wake.id]?.status).toBe('claimed')
      await h.run.extendCapacity(grant('events', 1), h.run.snapshot().revision)
      await h.run.setPhase('running', h.run.snapshot().revision)
      await a.lease.submitDecision(id, proposals)
      expect(h.run.queueUsage().events).toEqual({ used: 2, limit: 2 })
      expect(h.run.snapshot().wakes[wake.id]?.status).toBe('completed')
    } finally { await h.close() }
  })
})
