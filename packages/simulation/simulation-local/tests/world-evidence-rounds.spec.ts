/** Repeated original-case clarification consumes bounded planning slots and keeps each input version immutable. */
import { describe, expect, it } from 'vitest'
import { simTimeSchema, simulationWorldEvidenceAskSchema } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from './hiring-resource-harness.ts'

describe.each(['json', 'sqlite'] as const)('%s evidence planning revisions', (backend) => {
  it('retains two actual questions and input revisions before the third and final plan', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing')
    try {
      const ask = simulationWorldEvidenceAskSchema.parse({ kind: 'awaiting-evidence', missingFields: ['requirements'],
        deadline: '10', maxAttempts: 1, rationale: 'Clarify the original requirement.' })
      let plan: import('@clocky/clocky-simulation').SimulationWorldPlan = await h.plan('two-questions', 'hire-existing', ask)
      const request = h.run.snapshot().world!.requests[plan.requestId]!
      for (const revisionNumber of [1, 2]) {
        const question = Object.values(h.run.snapshot().world!.evidence.challenges).at(-1)!
        expect(question.inputRevision).toBe(revisionNumber - 1)
        await h.run.drive({ until: simTimeSchema.parse('0') })
        await h.connection.dispatchOperation(question.notificationOperationId, () => Date.now())
        const answerWake = await h.connection.receiveOperation(question.notificationOperationId)
        await h.run.drive({ until: simTimeSchema.parse('0') })
        await h.propose(h.requester, `answer-${revisionNumber}`, { kind: 'world/evidence', requestId: request.id,
          challengeId: question.id, expectedInputRevision: revisionNumber - 1,
          answers: [{ field: 'requirements', text: `Original attributed answer ${revisionNumber}`, references: [] }] },
        { kind: 'evidence', challengeId: question.id }, answerWake)
        const revision = Object.values(h.run.snapshot().world!.evidence.revisions).at(-1)!
        expect(revision.revision).toBe(revisionNumber)
        await h.run.drive({ until: simTimeSchema.parse('0') })
        await h.connection.dispatchOperation(revision.notificationOperationId, () => Date.now())
        const resolveWake = await h.connection.receiveOperation(revision.notificationOperationId)
        await h.run.drive({ until: simTimeSchema.parse('0') })
        await h.propose(h.director, `plan-after-${revisionNumber}`, { kind: 'world/resolve', requestId: request.id,
          supersedes: plan.id, resolution: revisionNumber === 1 ? ask
            : { kind: 'apply', payload: request.proposal.payload, rationale: 'The original evidence is sufficient.' } },
        { kind: 'resolve', requestId: request.id }, resolveWake)
        plan = h.run.snapshot().world!.plans[h.run.snapshot().world!.requests[request.id]!.plans.at(-1)!]!
        expect(plan.reads).toContainEqual({ kind: 'world-input', id: request.intentId, revision: revisionNumber, hash: revision.hash })
      }
      const state = h.run.snapshot()
      expect(state.world!.requests[request.id]!.proposal).toEqual(request.proposal)
      expect(state.world!.requests[request.id]!.plans).toHaveLength(3)
      expect(Object.values(state.world!.evidence.revisions).map(value => value.revision)).toEqual([1, 2])
      expect(Object.values(state.world!.evidence.challenges).map(value => value.status)).toEqual(['answered', 'answered'])
      await h.connection.close(); await h.run.close()
      const cold = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
      try { expect(cold.snapshot().world).toEqual(state.world); expect(h.requests).toHaveLength(0) }
      finally { await cold.close() }
    } finally { await h.close() }
  })
})
