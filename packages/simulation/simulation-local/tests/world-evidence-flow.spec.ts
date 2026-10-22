/** Actual Native/Team/private Channel clarification without replacing its original business request. */
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { simTimeSchema, simulationDecisionIdSchema, simulationProposalSchema, simulationWorldEvidenceAskSchema, simulationWorldEvidenceSupplySchema } from '@clocky/clocky-simulation'
import { assertWorldEvidenceProjection, validateWorldEvidenceAsk, validateWorldEvidenceSupply } from '../src/world-evidence.ts'
import { assertWorldProjection, expandWorldProposals } from '../src/world.ts'
import type { NativeWorldRuntime } from '../src/world-runtime.ts'
import type { LogStream } from '@clocky/clocky-storage'
import type { SimulationSnapshot, SimulationWorldEvidenceChallenge, SimulationWorldEvidenceRevision } from '@clocky/clocky-simulation'
import { decisionInput } from '../../simulation-team/src/input.ts'
import { contextConsumption } from '../../simulation-team/src/context-consumption.ts'
import { contextRequest } from './context-fixture.ts'
import { hiringResourceHarness } from './hiring-resource-harness.ts'

async function journal(stream: LogStream) {
  const rows = []; let after = -1
  while (after < stream.tailSequence) {
    const page = await stream.read(after, 128)
    if (page.length === 0) throw new Error('Original evidence journal prefix is incomplete')
    rows.push(...page); after = page.at(-1)!.sequence
  }
  return rows
}

describe.each(['json', 'sqlite'] as const)('%s evidence exchange', (backend) => {
  it('consumes the original question and revision notifications before hiring once and preserving the full case on cold replay', async () => {
    const evidence = resolve('.local/world-completion/thread-01a1336a-evidence-native/roundtrip')
    await mkdir(evidence, { recursive: true })
    const output = await mkdtemp(resolve(evidence, `${backend}-`))
    const h = await hiringResourceHarness(backend, 'hire-existing')
    const runtime = Reflect.get(h.run, 'worldRuntime') as NativeWorldRuntime
    const captured: { ask?: SimulationSnapshot; answer?: SimulationSnapshot } = {}
    const stream = Reflect.get(h.run, 'stream') as LogStream, originalAppend = stream.append.bind(stream)
    stream.append = async (expectedRevision, values, options) => {
      const state = h.run.snapshot()
      const decision = Object.values(state.decisions).find(value => value.status === 'open' && value.consumption !== undefined)
      const scope = decision?.context?.status === 'prepared' ? decision.context.world : undefined
      if (scope?.kind === 'evidence') captured.answer = state
      if (scope?.kind === 'resolve' && Object.keys(state.world!.evidence.challenges).length === 0) captured.ask = state
      return await originalAppend.call(stream, expectedRevision, values, options)
    }
    try {
      const plan = await h.plan('clarify', 'hire-existing', simulationWorldEvidenceAskSchema.parse({ kind: 'awaiting-evidence',
        missingFields: ['requirements'], deadline: '10', maxAttempts: 2, rationale: 'PRIVATE-DIRECTOR-RATIONALE' }))
      const question = Object.values(h.run.snapshot().world!.evidence.challenges)[0]!
      const original = h.run.snapshot().world!.requests[plan.requestId]!
      const beforeAsk = captured.ask
      if (beforeAsk === undefined || plan.proposal.resolution.kind !== 'awaiting-evidence') throw new Error('Missing actual preacceptance question')
      const asking = beforeAsk.decisions[h.run.snapshot().operations[plan.operationId]!.decisionId]!
      const askingRequest = beforeAsk.world!.requests[plan.requestId]!, ask = plan.proposal.resolution
      expect(() => validateWorldEvidenceAsk(beforeAsk, asking, askingRequest, ask, runtime)).not.toThrow()
      const askProposals = [simulationProposalSchema.parse({ after: [], action: plan.proposal })]
      expect(expandWorldProposals({ ...beforeAsk, revision: beforeAsk.revision + 1 }, asking, askProposals, runtime)).toHaveLength(2)
      const grant = Object.values(beforeAsk.relations).find(value => value.relation === 'can-hire')!
      const changedGrant = { ...beforeAsk, relations: { ...beforeAsk.relations,
        [grant.id]: { ...grant, revision: grant.revision + 1 } } }
      expect(() => expandWorldProposals(changedGrant, asking, askProposals, runtime)).toThrow(/planning reads are stale/)
      const endedGrant = { ...beforeAsk, relations: { ...beforeAsk.relations,
        [grant.id]: { ...grant, validUntil: simTimeSchema.parse('0'), revision: grant.revision + 1 } } }
      expect(() => expandWorldProposals(endedGrant, asking, askProposals, runtime)).toThrow()

      expect(() => validateWorldEvidenceAsk(beforeAsk, asking, askingRequest,
        simulationWorldEvidenceAskSchema.parse({ ...ask, missingFields: ['undeclared-field'] }), runtime)).toThrow(/not declared/)
      expect(() => validateWorldEvidenceAsk(beforeAsk, asking, askingRequest,
        { ...ask, maxAttempts: beforeAsk.world!.definition.limits.maxEvidenceAttemptsPerRequest + 1 }, runtime)).toThrow(/allowance/)
      const noNextPlan = { ...beforeAsk, world: { ...beforeAsk.world!, definition: { ...beforeAsk.world!.definition,
        limits: { ...beforeAsk.world!.definition.limits, maxPlansPerRequest: 1 } } } }
      expect(() => validateWorldEvidenceAsk(noNextPlan, asking, askingRequest, ask, runtime)).toThrow(/subsequent planning allowance/)

      expect(original.status).toBe('awaiting-evidence')
      expect(h.run.snapshot().world!.results).toEqual({})
      await h.run.drive({ until: simTimeSchema.parse('0') })
      await h.connection.dispatchOperation(question.notificationOperationId, () => Date.now())
      const wake = await h.connection.receiveOperation(question.notificationOperationId)
      await h.run.drive({ until: simTimeSchema.parse('0') })
      await h.propose(h.requester, 'answer-original', { kind: 'world/evidence', requestId: original.id, challengeId: question.id,
        expectedInputRevision: 0, answers: [{ field: 'requirements', text: 'The role requires careful research.', references: [] }] },
      { kind: 'evidence', challengeId: question.id }, wake)
      const state = h.run.snapshot(), revision = Object.values(state.world!.evidence.revisions)[0]!
      const beforeAnswer = captured.answer
      if (beforeAnswer === undefined) throw new Error('Missing actual consumed preacceptance answer')
      const answering = beforeAnswer.decisions[revision.source.decisionId]!
      const answer = simulationWorldEvidenceSupplySchema.parse(state.operations[revision.source.operationId]!.action)
      expect(answering.consumption?.notification?.operationId).toBe(question.notificationOperationId)
      expect(() => validateWorldEvidenceSupply(beforeAnswer, answering, answer)).not.toThrow()
      expect(() => validateWorldEvidenceSupply(beforeAnswer, answering, simulationWorldEvidenceSupplySchema.parse({ ...answer,
        answers: [{ ...answer.answers[0], field: 'undeclared-field' }] }))).toThrow()
      expect(() => validateWorldEvidenceSupply(beforeAnswer, answering, simulationWorldEvidenceSupplySchema.parse({ ...answer,
        answers: [{ ...answer.answers[0], references: [{ kind: 'run-event', runId: 'foreign-run', sequence: 1 }] }] }))).toThrow()
      expect(() => validateWorldEvidenceSupply(beforeAnswer, { ...answering, entityId: h.director }, answer)).toThrow(/actual responder/)
      expect(() => validateWorldEvidenceSupply(beforeAnswer, answering, { ...answer, expectedInputRevision: 1 })).toThrow(/input revision/)
      expect(() => validateWorldEvidenceSupply(beforeAnswer, { ...answering, time: question.deadline }, answer)).toThrow(/deadline/)
      expect(revision.revision).toBe(1)
      expect(revision.source.actorId).toBe(h.requester)
      expect(state.world!.evidence.challenges[question.id]!.status).toBe('answered')
      expect(state.world!.requests[original.id]!.proposal).toEqual(original.proposal)
      expect(state.world!.requests[original.id]!.payloadHash).toBe(original.payloadHash)
      expect(state.world!.requests[original.id]!.status).toBe('open')
      expect(() =>{  assertWorldEvidenceProjection(state, runtime) }).not.toThrow()
      const alteredQuestion = (change: Partial<SimulationWorldEvidenceChallenge>) => ({ ...state, world: { ...state.world!,
        evidence: { ...state.world!.evidence, challenges: { ...state.world!.evidence.challenges,
          [question.id]: { ...state.world!.evidence.challenges[question.id]!, ...change } } } } })
      for (const change of [
        { fields: question.fields.map(field => ({ ...field, description: 'FORGED-FIELD-DESCRIPTION' })) },
        { inputRevision: question.inputRevision + 1 },
        { source: { ...question.source, decisionId: revision.source.decisionId } },
      ]) expect(() =>{  assertWorldEvidenceProjection(alteredQuestion(change), runtime) }).toThrow(/original source or revision chain/)
      const alteredRevision = (change: Partial<SimulationWorldEvidenceRevision>) => ({ ...state, world: { ...state.world!,
        evidence: { ...state.world!.evidence, revisions: { ...state.world!.evidence.revisions,
          [revision.id]: { ...revision, ...change } } } } })
      for (const change of [
        { revision: revision.revision + 1 },
        { answers: revision.answers.map(answer => ({ ...answer, text: 'FORGED-ANSWER' })) },
        { source: { ...revision.source, actorId: h.director } },
        { notificationOperationId: question.notificationOperationId },
      ]) expect(() =>{  assertWorldEvidenceProjection(alteredRevision(change), runtime) }).toThrow(/original source or revision chain/)
      expect(h.run.snapshot()).toEqual(state)
      const notice = state.operations[question.notificationOperationId]!.action
      expect(JSON.stringify(notice)).not.toContain('PRIVATE-DIRECTOR-RATIONALE')
      await h.run.drive({ until: simTimeSchema.parse('0') })
      await h.connection.dispatchOperation(revision.notificationOperationId, () => Date.now())
      const directorWake = await h.connection.receiveOperation(revision.notificationOperationId)
      await h.run.drive({ until: simTimeSchema.parse('0') })
      const proofRoot = resolve('.local/world-completion/thread-01a1336a-notification-proof')
      await mkdir(proofRoot, { recursive: true }); const proofOutput = await mkdtemp(resolve(proofRoot, `${backend}-`))
      const director = h.ctx.agents.get(h.run.snapshot().entities[h.director]!.binding!.sessionId)!
      const oldDecision = h.run.snapshot().decisions[state.operations[plan.operationId]!.decisionId]!
      expect(contextConsumption(oldDecision, director.session.id, director.session.events, h.run.snapshot()).notification?.operationId)
        .toBe(original.notificationOperationId)
      const resolving = simulationDecisionIdSchema.parse('resolve-with-original-answer')
      await h.connection.openDecision(h.director, resolving, directorWake)
      const prepared = await h.connection.prepareContext(h.director, resolving, { ...contextRequest(), world: { kind: 'resolve', requestId: original.id } })
      if (prepared.status !== 'prepared') throw new Error('Expected the actual revision-specific context')
      expect(prepared.world).toMatchObject({ kind: 'resolve', notificationOperationId: revision.notificationOperationId })
      director.session.append('simulation/context-view', prepared.view, { surfaceOp: 'append' })
      director.session.append('user/message', decisionInput(prepared.view), { surfaceOp: 'append' })
      expect(await h.ctx.sessions.flush(director.session)).toBe(true)
      const queued = [...director.inbox.nextTurn, ...director.inbox.nextStep]
      expect(queued).toHaveLength(1)
      expect(director.session.events.some(event => event.type === 'agent/inbox/spliced'
        && event.data.inserted.some(message => message.id === queued[0]!.id))).toBe(true)
      expect(director.session.events.some(event => event.type === 'user/message' && event.data.id === queued[0]!.id)).toBe(false)
      const proposals = [simulationProposalSchema.parse({ after: [], action: { kind: 'world/resolve', requestId: original.id, supersedes: plan.id,
        resolution: { kind: 'apply', payload: original.proposal.payload, rationale: 'The original answer supports this hire.' } } })]
      await h.ctx.simulationTeams.modelRequest(director, { kind: 'observe' }, h.lifetime.signal)
      await h.ctx.simulationTeams.modelRequest(director, { kind: 'stage', proposals }, h.lifetime.signal)
      const beforeUnconsumed = h.run.snapshot()
      await expect(h.ctx.simulationTeams.modelRequest(director, { kind: 'submit' }, h.lifetime.signal))
        .rejects.toThrow(/not consumed the exact original notification/)
      expect(h.run.snapshot()).toEqual(beforeUnconsumed)
      expect(h.run.snapshot().decisions[resolving]!.consumption).toBeUndefined()
      await writeFile(resolve(proofOutput, 'unconsumed.json'), JSON.stringify({ state: beforeUnconsumed,
        queued, session: director.session.events, originalNotification: original.notificationOperationId,
        requiredNotification: revision.notificationOperationId }, null, 2) + '\n')
      for (const message of queued) {
        director.inbox.remove(message.id)
        director.session.append('user/message', message, { surfaceOp: 'append' })
      }
      expect(await h.ctx.sessions.flush(director.session)).toBe(true)
      await h.ctx.simulationTeams.modelRequest(director, { kind: 'submit' }, h.lifetime.signal)
      const accepted = h.run.snapshot().decisions[resolving]!
      expect(accepted.status).toBe('accepted')
      await h.run.executeOperation(accepted.operationIds[0]!)
      await writeFile(resolve(proofOutput, 'consumed.json'), JSON.stringify({ state: h.run.snapshot(),
        session: director.session.events, requiredNotification: revision.notificationOperationId }, null, 2) + '\n')
      const planned = h.run.snapshot(), decision = planned.decisions[simulationDecisionIdSchema.parse('resolve-with-original-answer')]!
      expect(decision.consumption?.notification?.operationId).toBe(revision.notificationOperationId)
      expect(decision.context).toMatchObject({ status: 'prepared', world: {
        kind: 'resolve', notificationOperationId: revision.notificationOperationId } })
      expect(JSON.stringify(decision.context)).toContain('The role requires careful research.')
      const finalPlan = planned.world!.plans[planned.world!.requests[original.id]!.plans.at(-1)!]!
      expect(finalPlan.id).not.toBe(plan.id)
      expect(finalPlan.proposal.supersedes).toBe(plan.id)
      expect(finalPlan.proposal.resolution.kind).toBe('apply')
      expect(planned.world!.plans[plan.id]).toEqual(state.world!.plans[plan.id])
      const candidate = planned.entities[h.candidate]!
      await h.reserve(finalPlan)
      if (finalPlan.proposal.resolution.kind !== 'apply') throw new Error('Expected the actual accepted hiring plan')
      const mutation = { planId: finalPlan.id, payload: finalPlan.proposal.resolution.payload }
      const result = await h.run.commitWorldMutation(mutation)
      expect(result.outcome.kind).toBe('committed')
      const committed = h.run.snapshot()
      expect(Object.values(committed.resources).map(value => value.quantity)).toEqual(['4', '6'])
      expect(committed.entities[h.candidate]).toEqual(candidate)
      expect(committed.world!.requests[original.id]).toMatchObject({ proposal: original.proposal, payloadHash: original.payloadHash,
        operationId: original.operationId, source: original.source, sequence: original.sequence, status: 'committed' })
      expect(committed.world!.evidence.revisions[revision.id]).toEqual(revision)
      expect(Object.values(committed.world!.requests)).toHaveLength(1)
      expect(Object.values(committed.world!.results)).toEqual([result])
      expect(() =>{  assertWorldProjection({ ...committed, world: { ...committed.world!,
        requests: { ...committed.world!.requests, [original.id]: { ...committed.world!.requests[original.id]!, status: 'rejected' } },
        results: { [result.id]: { ...result, outcome: { kind: 'rejected', reason: 'insufficient-information' },
          source: { kind: 'evidence-exhausted', challengeId: question.id, decisionId: revision.source.decisionId } } },
      } }, runtime) }).toThrow(/exact source/)

      const assignments = Object.values(committed.relations).filter(value => value.subject === h.candidate && value.relation === 'assignment')
      expect(assignments).toHaveLength(1)
      const originalPost = committed.operations[original.notificationOperationId!]!
      const questionPost = committed.operations[question.notificationOperationId]!
      const answerPost = committed.operations[revision.notificationOperationId]!
      for (const post of [originalPost, questionPost, answerPost]) {
        expect(post.action.kind).toBe('communication/post')
        expect(post.delivery?.receipt).toBeDefined()
        expect(post.outbox?.receipt?.channelId).toBe(originalPost.outbox?.receipt?.channelId)
      }
      await h.connection.close()
      const sessions = await Promise.all([h.requester, h.director].map(async (id) => {
        const sessionId = committed.entities[id]!.binding!.sessionId
        return { id, sessionId, events: (await h.ctx.sessionPersistence.readFrom(sessionId, 0)).events }
      }))
      const originalState = h.run.snapshot(), originalJournal = await journal(Reflect.get(h.run, 'stream') as LogStream)
      await writeFile(resolve(output, 'original.json'), JSON.stringify({ state: originalState, sessions, result, journal: originalJournal }, null, 2) + '\n')
      await h.run.close()
      const cold = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
      try {
        const reopened = cold.snapshot()
        expect(reopened.world).toEqual(originalState.world)
        expect(reopened.resources).toEqual(originalState.resources)
        expect(reopened.resourceReservations).toEqual(originalState.resourceReservations)
        expect(reopened.relations).toEqual(originalState.relations)
        expect(await cold.commitWorldMutation(mutation)).toEqual(result)
        expect(cold.snapshot()).toEqual(reopened)
        const reopenedJournal = await journal(Reflect.get(cold, 'stream') as LogStream)
        expect(reopenedJournal).toEqual(originalJournal)
        for (const session of sessions)
          expect((await h.ctx.sessionPersistence.readFrom(session.sessionId, 0)).events).toEqual(session.events)
        await writeFile(resolve(output, 'reopened.json'), JSON.stringify({ state: reopened, sessions, result, journal: reopenedJournal }, null, 2) + '\n')
        expect(h.requests).toHaveLength(0)
      } finally { await cold.close() }

    } finally { stream.append = originalAppend; await h.close() }
  })
})
