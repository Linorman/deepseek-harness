/** Real question delivery and Session consumption provide the original prefix; fences are then checked by pure admission/folds. */
import { expect, it } from 'vitest'
import { simulationDecisionIdSchema, simulationWorldEvidenceAskSchema, simTimeSchema, personnelFenceSchema,
  simulationProposalSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationDecision } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { acceptanceRecords, foldBusinessRecord } from '../src/decisions.ts'
import { NativeWorldRuntime } from '../src/world-runtime.ts'

it('allows only original consumed evidence and its derived notice through an employment fence, including an empty answer attempt', async () => {
  const h = await hiringResourceHarness('json', 'hire-existing')
  const runtime = new NativeWorldRuntime(h.ctx.simulations.domains('local'))
  try {
    const plan = await h.plan('before-fence', 'hire-existing', simulationWorldEvidenceAskSchema.parse({ kind: 'awaiting-evidence',
      missingFields: ['requirements'], deadline: '10', maxAttempts: 2, rationale: 'Original missing field' }))
    const question = Object.values(h.run.snapshot().world!.evidence.challenges)[0]!
    await h.run.drive({ until: simTimeSchema.parse('0') })
    await h.connection.dispatchOperation(question.notificationOperationId, () => Date.now())
    const wake = await h.connection.receiveOperation(question.notificationOperationId)
    await h.run.drive({ until: simTimeSchema.parse('0') })
    await h.propose(h.requester, 'fenced-original-answer', undefined,
      { kind: 'evidence', challengeId: question.id }, wake)
    const settled = h.run.snapshot(), acceptedDecision = settled.decisions[simulationDecisionIdSchema.parse('fenced-original-answer')]!
    if (acceptedDecision.closedAt === undefined || acceptedDecision.windowId !== undefined || acceptedDecision.operationIds.length !== 0)
      throw new Error('Evidence admission fixture requires a serial empty accepted decision')
    // Reverse only this empty acceptance's phase/wake change; retain its real flushed Session consumption and question delivery.
    const { closedAt: _closedAt, fingerprint: _fingerprint, ...pendingDecision } = acceptedDecision
    const decision: SimulationDecision = { ...pendingDecision, status: 'open' }
    const original: SimulationSnapshot = { ...settled, revision: acceptedDecision.closedAt - 1, activeDecisionId: decision.id,
      decisions: { ...settled.decisions, [decision.id]: decision },
      wakes: { ...settled.wakes, [wake]: { ...settled.wakes[wake]!, status: 'claimed', decisionId: decision.id } } }
    const fence = personnelFenceSchema.parse({ assignmentId: 'fee-employed', personId: h.requester, intentId: 'later-departure',
      requestId: 'later-departure-case', generation: 1, sequence: original.revision + 1, status: 'active' })
    const fenced: SimulationSnapshot = { ...original, world: { ...original.world!, personnel: { ...original.world!.personnel,
      generations: { ...original.world!.personnel.generations, [h.requester]: 1 }, fences: { [fence.intentId]: fence } } } }
    const proposal = simulationProposalSchema.parse({ after: [], action: { kind: 'world/evidence', requestId: plan.requestId,
      challengeId: question.id, expectedInputRevision: question.inputRevision,
      answers: [{ field: 'requirements', text: 'The original requirement is confirmed.', references: [] }] } })
    expect(decision.consumption?.notification?.operationId).toBe(question.notificationOperationId)
    expect(decision.wakeId).toBe(wake)
    expect(original.operations[question.notificationOperationId]?.delivery?.wakeId).toBe(wake)
    const accepted = acceptanceRecords(fenced, decision, [proposal], runtime)
    expect(accepted[0]?.kind).toBe('decision/accepted')
    let replayed = fenced
    for (const record of accepted) {
      const sequence = replayed.revision + 1
      replayed = { ...foldBusinessRecord(replayed, record, sequence, runtime), revision: sequence }
    }
    expect(replayed.decisions[decision.id]?.status).toBe('accepted')
    expect(acceptanceRecords(fenced, decision, [], runtime)[0]?.kind).toBe('decision/accepted')
    const assertBlocked = (state: SimulationSnapshot, candidate: SimulationDecision) => {
      expect(() => acceptanceRecords(state, candidate, [], runtime)).toThrow(/employment generation/)
    }
    const { wakeId: _wakeId, ...withoutWake } = decision
    assertBlocked(fenced, withoutWake)
    assertBlocked(fenced, { ...decision, consumption: { ...decision.consumption!, notification: undefined } })
    assertBlocked({ ...fenced, world: { ...fenced.world!, evidence: { ...fenced.world!.evidence,
      challenges: { [question.id]: { ...question, responders: [h.director] } } } } }, decision)
    assertBlocked({ ...fenced, world: { ...fenced.world!, requests: { ...fenced.world!.requests,
      [plan.requestId]: { ...fenced.world!.requests[plan.requestId]!, sequence: fence.sequence } } } }, decision)
    assertBlocked({ ...fenced, time: question.deadline }, decision)
    const changedText = { after: [], action: { kind: 'communication/post', recipient: h.director,
      channelId: original.world!.channels[h.requester], text: 'New business under an old wake', deliverAt: '0' } }
    expect(() => acceptanceRecords(fenced, decision, [simulationProposalSchema.parse(changedText)], runtime)).toThrow()
  } finally { runtime.close(); await h.close() }
})
