/** Actual unanswered Native/Team evidence questions expire once and retain their original result through replay. */
import { describe, expect, it } from 'vitest'
import { simTimeSchema, simulationWorldCancelRequestSchema, simulationWorldEvidenceAskSchema } from '@clocky/clocky-simulation'
import { foldSchedulerRecord } from '../src/scheduler.ts'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { worldEvidenceDeadlineId, assertWorldEvidenceDeadlineSource, assertWorldEvidenceDeadlineProjection,
  worldEvidenceDeadlineRecords } from '../src/world-evidence-deadline.ts'

describe.each(['json', 'sqlite'] as const)('%s evidence deadline', (backend) => {
  it('expires the actual delivered unanswered question at its simulated deadline and reopens without new effects', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing')
    try {
      const plan = await h.plan('unanswered', 'hire-existing', simulationWorldEvidenceAskSchema.parse({ kind: 'awaiting-evidence',
        missingFields: ['requirements'], deadline: '10', maxAttempts: 2, rationale: 'Missing the requested requirements.' }))
      const question = Object.values(h.run.snapshot().world!.evidence.challenges)[0]!
      const eventId = worldEvidenceDeadlineId(question.id), before = h.run.snapshot()
      const event = before.scheduledEvents[eventId]!
      expect(event).toMatchObject({ status: 'pending', key: { time: '10', phase: 'deadline' }, sourceOperationId: question.source.operationId })
      expect(() => assertWorldEvidenceDeadlineSource(before, { ...event, key: { ...event.key, time: simTimeSchema.parse('11') } }))
        .toThrow(/original challenge/)
      expect(() => foldSchedulerRecord(before, { kind: 'event/cancelled', id: eventId, reason: 'Original evidence challenge settled' },
        before.revision + 1)).toThrow(/settled challenge/)
      const { [eventId]: _deadline, ...withoutDeadline } = before.scheduledEvents
      expect(() =>{  assertWorldEvidenceDeadlineProjection({ ...before, scheduledEvents: withoutDeadline }) }).toThrow(/omitted/)
      await h.run.drive({ until: simTimeSchema.parse('0') })
      await h.connection.dispatchOperation(question.notificationOperationId, () => Date.now())
      const wake = await h.connection.receiveOperation(question.notificationOperationId)
      await h.run.drive({ until: simTimeSchema.parse('0') })
      await h.propose(h.requester, 'read-without-answer', undefined, undefined, wake)
      await h.run.drive({ until: simTimeSchema.parse('10') })
      const state = h.run.snapshot(), result = Object.values(state.world!.results)[0]!
      expect(state.world!.requests[plan.requestId]!.status).toBe('rejected')
      expect(state.world!.evidence.challenges[question.id]).toMatchObject({ status: 'expired', settledSequence: result.sequence })
      expect(result).toMatchObject({ source: { kind: 'evidence-deadline', challengeId: question.id, eventId },
        outcome: { kind: 'rejected', reason: 'insufficient-information' }, time: '10' })
      expect(state.scheduledEvents[eventId]).toMatchObject({ status: 'consumed', settledAt: result.sequence })
      expect(worldEvidenceDeadlineRecords(state)).toEqual([])
      expect(() =>{  assertWorldEvidenceDeadlineProjection(state) }).not.toThrow()
      expect(Object.values(state.world!.results)).toHaveLength(1)
      await h.connection.close(); await h.run.close()
      const cold = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
      try {
        expect(cold.snapshot().world).toEqual(state.world)
        expect(cold.snapshot().scheduledEvents).toEqual(state.scheduledEvents)
        expect(() =>{  assertWorldEvidenceDeadlineProjection(cold.snapshot()) }).not.toThrow()
        expect(h.requests).toHaveLength(0)
      } finally { await cold.close() }
    } finally { await h.close() }
  })
  it('exhausts the last actual response attempt once and retains its decision source through cold replay', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing')
    try {
      await h.plan('exhausted', 'hire-existing', simulationWorldEvidenceAskSchema.parse({ kind: 'awaiting-evidence',
        missingFields: ['requirements'], deadline: '10', maxAttempts: 1, rationale: 'Clarify requirements.' }))
      const question = Object.values(h.run.snapshot().world!.evidence.challenges)[0]!
      await h.run.drive({ until: simTimeSchema.parse('0') })
      await h.connection.dispatchOperation(question.notificationOperationId, () => Date.now())
      const wake = await h.connection.receiveOperation(question.notificationOperationId)
      await h.run.drive({ until: simTimeSchema.parse('0') })
      await h.propose(h.requester, 'last-answer-attempt', undefined, { kind: 'evidence', challengeId: question.id }, wake)
      const state = h.run.snapshot(), result = Object.values(state.world!.results)[0]!
      expect(state.world!.evidence.challenges[question.id]).toMatchObject({ status: 'exhausted', settledSequence: result.sequence })
      expect(result).toMatchObject({ source: { kind: 'evidence-exhausted', challengeId: question.id, decisionId: 'last-answer-attempt' },
        outcome: { kind: 'rejected', reason: 'insufficient-information' }, time: '0' })
      expect(state.scheduledEvents[worldEvidenceDeadlineId(question.id)]!.status).toBe('cancelled')
      expect(Object.values(state.world!.results)).toHaveLength(1)
      await h.connection.close(); await h.run.close()
      const cold = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
      try { expect(cold.snapshot().world).toEqual(state.world); expect(h.requests).toHaveLength(0) }
      finally { await cold.close() }
    } finally { await h.close() }
  })
  it('cancels the original deadline and already-delivered question wake when its case is cancelled', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing')
    try {
      const plan = await h.plan('cancel-question', 'hire-existing', simulationWorldEvidenceAskSchema.parse({ kind: 'awaiting-evidence',
        missingFields: ['requirements'], deadline: '10', maxAttempts: 2, rationale: 'Clarify requirements.' }))
      const question = Object.values(h.run.snapshot().world!.evidence.challenges)[0]!
      await h.run.drive({ until: simTimeSchema.parse('0') })
      await h.connection.dispatchOperation(question.notificationOperationId, () => Date.now())
      const wake = await h.connection.receiveOperation(question.notificationOperationId)
      await h.run.drive({ until: simTimeSchema.parse('0') })
      expect(h.run.snapshot().wakes[wake]!.status).toBe('pending')
      await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'cancel-awaiting', requestId: plan.requestId }))
      const state = h.run.snapshot()
      expect(state.world!.evidence.challenges[question.id]!.status).toBe('cancelled')
      expect(state.scheduledEvents[worldEvidenceDeadlineId(question.id)]!.status).toBe('cancelled')
      expect(state.wakes[wake]!.status).toBe('cancelled')
      expect(worldEvidenceDeadlineRecords(state)).toEqual([])
      expect(() =>{  assertWorldEvidenceDeadlineProjection(state) }).not.toThrow()
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })

})
