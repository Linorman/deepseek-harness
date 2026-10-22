import { afterEach, expect, it } from 'vitest'
import { simulationDecisionIdSchema, simulationEntityIdSchema, simulationWriterEpochSchema,
  simulationTaskResultRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { acceptanceRecords, assertBusinessProjection, assertDecisionOwner, requireDecision } from '../src/decisions.ts'
import { foldEntry } from '../src/journal.ts'
import { assertTaskExecutions, assertTaskResultEvidence } from '../src/task-execution.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function setup() {
  const h = await createBusinessHarness('sqlite')
  cleanups.push(h.close)
  const actor = await h.actor('actor')
  await h.account('stock', actor.id, '10'); await h.account('received', actor.id, '0')
  const decision = await actor.lease.openDecision(simulationDecisionIdSchema.parse('decision'), h.run.snapshot().revision)
  const proposal = { after: [], action: { kind: 'resource/transfer', transaction: { commitmentId: null,
    reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: 'received', revision: 1 }],
    transfers: [{ from: 'stock', to: 'received', quantity: '1' }] }, grants: [] } }
  const { simulationProposalSchema } = await import('@clocky/clocky-simulation')
  const proposals = [simulationProposalSchema.parse(proposal)]
  return { ...h, actor, decision, proposals }
}
function fold(state: SimulationSnapshot, change: unknown): SimulationSnapshot {
  return foldEntry(state, { sequence: state.revision + 1,
    value: { kind: 'run/business', runId: state.spec.runId, expectedRevision: state.revision, change } }, state.spec, 'sqlite')
}

it('rejects foreign ownership, missing decisions, oversized proposals and forward dependencies', async () => {
  const h = await setup()
  const state = h.run.snapshot()
  expect(() => requireDecision(state, simulationDecisionIdSchema.parse('toString'))).toThrow(/does not exist/)
  for (const [id, epoch] of [[simulationEntityIdSchema.parse('other'), h.decision.epoch],
    [h.actor.id, simulationWriterEpochSchema.parse('2')]] as const) {
    expect(() => { assertDecisionOwner(h.decision, id, epoch) }).toThrow(/another writer/)
  }
  expect(() => acceptanceRecords({ ...state, spec: { ...state.spec, maxOperationsPerDecision: 0 } }, h.decision, h.proposals))
    .toThrow(/operation limit/)
  expect(() => acceptanceRecords(state, h.decision, [{ ...h.proposals[0]!, after: [0] }])).toThrow(/precede/)
  const { simulationOperationIdSchema } = await import('@clocky/clocky-simulation')
  expect(() => acceptanceRecords(state, h.decision, [{ ...h.proposals[0]!, after: [simulationOperationIdSchema.parse('toString')] }]))
    .toThrow(/does not exist/)
})

it('refuses replacement effects or an unproven acknowledgement for a report continuation', async () => {
  const h = await setup()
  const state = h.run.snapshot()
  const attemptId = 'continuation-attempt' as never
  const execution = { request: { attemptId, operationId: 'report-operation', reportContinuation: {
    attemptId: 'original-attempt', operationId: 'report-operation', contextFingerprint: 'original-context',
  } }, decisions: [{ request: { decisionId: h.decision.id } }] } as never
  const associated = { ...state, taskExecutions: { [attemptId]: execution },
    taskDecisionOwners: { [h.decision.id]: { attemptId, index: 0 } } }
  expect(() => acceptanceRecords(associated, h.decision, h.proposals))
    .toThrow('report continuation accepts only acknowledgement')
  expect(() => acceptanceRecords(associated, h.decision, []))
    .toThrow('report continuation accepts only acknowledgement')
  expect(() => { assertTaskExecutions(associated) })
    .toThrow('report continuation lost its immutable retired source evidence')
  const result = simulationTaskResultRequestSchema.parse({ attemptId, policy: { id: 'report', version: '1' },
    operations: ['report-operation'], outcome: { kind: 'completed', result: { summary: 'Reported' } } })
  expect(() => { assertTaskResultEvidence(associated, execution, result) })
    .toThrow('report continuation result requires its recorded acknowledgement and exact original report')
})

it('rejects malformed acceptance identities and truncated or altered intent batches', async () => {
  const h = await setup()
  const state = h.run.snapshot()
  const records = acceptanceRecords(state, h.decision, h.proposals)
  const acceptedRecord = records[0]!, intent = records[1]!
  expect(() => fold(state, { ...acceptedRecord, operationIds: ['foreign'] })).toThrow(/identities/)
  const accepted = fold(state, acceptedRecord)
  expect(() => { assertBusinessProjection(accepted) }).toThrow(/missing its operation intents/)
  for (const altered of [
    { ...intent, fingerprint: 'sha256:changed' }, { ...intent, index: 1 },
    { ...intent, dependencies: ['toString'] }, { ...intent, decisionId: 'toString' },
  ]) expect(() => fold(accepted, altered)).toThrow(/inconsistent|does not exist/)
  const complete = fold(accepted, intent)
  expect(() => fold(complete, intent)).toThrow(/inconsistent/)
  expect(() => { assertBusinessProjection(complete) }).not.toThrow()
  const recorded = complete.decisions[h.decision.id]!
  const operation = Object.values(complete.operations)[0]!
  for (const altered of [
    { ...operation, entityId: simulationEntityIdSchema.parse('other') }, { ...operation, index: 1 },
    { ...operation, decisionId: simulationDecisionIdSchema.parse('other') },
  ]) expect(() => { assertBusinessProjection({ ...complete, operations: { [operation.id]: altered } }) }).toThrow(/missing its operation/)
  expect(() => { assertBusinessProjection({ ...complete, spec: { ...complete.spec, maxOperationsPerDecision: 0 } }) })
    .toThrow(/operation limit/)
  expect(() => { assertBusinessProjection({ ...complete, decisions: { [recorded.id]: { ...recorded, fingerprint: 'changed' } } }) })
    .toThrow(/fingerprint/)
})

it('recomputes settlement effects during replay and rejects an invented result or repeated settlement', async () => {
  const h = await setup()
  const accepted = await h.actor.lease.submitDecision(h.decision.id, h.proposals)
  const id = accepted.operationIds[0]!
  const state = h.run.snapshot()
  expect(() => fold(state, { kind: 'operation/settled', id: 'missing', status: 'applied', code: 'SIM_APPLIED' }))
    .toThrow(/before acceptance/)
  expect(() => fold(state, { kind: 'operation/settled', id, status: 'rejected', code: 'SIM_APPLIED' }))
    .toThrow(/contradicts/)
  expect(() => fold(state, { kind: 'operation/settled', id, status: 'applied', code: 'invented' })).toThrow(/contradicts/)
  const settled = fold(state, { kind: 'operation/settled', id, status: 'applied', code: 'SIM_APPLIED' })
  expect(Object.values(settled.resources).map(value => value.quantity)).toEqual(['9', '1'])
  expect(() => fold(settled, { kind: 'operation/settled', id, status: 'applied', code: 'SIM_APPLIED' })).toThrow(/twice/)
  expect(h.run.snapshot()).toEqual(state)
})

it('refuses persisted settlement before dependencies and refuses local settlement of outbox effects', async () => {
  const h = await setup()
  const { simulationProposalSchema } = await import('@clocky/clocky-simulation')
  const accepted = await h.actor.lease.submitDecision(h.decision.id, [h.proposals[0]!, { ...h.proposals[0]!, after: [0] },
    simulationProposalSchema.parse({ after: [], action: { kind: 'communication/post', recipient: h.actor.id,
      channelId: 'channel', text: 'After settlement', deliverAt: '0' } })])
  const state = h.run.snapshot()
  expect(() => fold(state, { kind: 'operation/settled', id: accepted.operationIds[1], status: 'applied', code: 'SIM_APPLIED' }))
    .toThrow(/earlier simulation operation/)
  const operation = state.operations[accepted.operationIds[0]!]!
  const { computeOperation } = await import('../src/business.ts')
  expect(() => computeOperation(state, state.operations[accepted.operationIds[1]!]!)).toThrow(/dependency is pending/)
  const { applyInteraction, recordTransferEvidence } = await import('../src/interactions.ts')
  expect(() => applyInteraction(state, operation)).toThrow(/Non-interaction/)
  const message = state.operations[accepted.operationIds[2]!]!
  expect(() => computeOperation(state, message)).toThrow(/outbox transport/)
  expect(() => recordTransferEvidence(state, message)).toThrow('Transfer evidence requires its actual conserved transaction')
  const taskAction = simulationProposalSchema.parse({ after: [], action: { kind: 'task/create', deliverAt: '0',
    task: { subject: 'Work', description: 'Do work', blockedBy: [], requiredCapabilities: [], priority: 0,
      readScopes: [], writeScopes: [], workspaceMode: 'shared', reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 1 } } }).action
  expect(() => computeOperation(state, { ...operation, action: taskAction })).toThrow(/outbox transport/)
})

it('keeps serial slots current and returns an accepted payload after later entity revisions', async () => {
  const h = await setup()
  const { simulationChangeSchema } = await import('@clocky/clocky-simulation')
  await expect(h.actor.lease.openDecision(simulationDecisionIdSchema.parse('another'), h.run.snapshot().revision))
    .rejects.toThrow(/previous slot/)
  const accepted = await h.actor.lease.submitDecision(h.decision.id, h.proposals)
  const before = h.run.snapshot()
  await h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: h.actor.id,
    entityRevision: before.entities[h.actor.id]!.revision, profile: { role: 'updated' } }), before.revision)
  const after = h.run.snapshot()
  expect(await h.actor.lease.submitDecision(h.decision.id, h.proposals)).toEqual(accepted)
  expect(h.run.snapshot()).toEqual(after)
  const stale = await h.actor.lease.openDecision(simulationDecisionIdSchema.parse('stale-profile'), after.revision)
  await h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: h.actor.id,
    entityRevision: h.run.snapshot().entities[h.actor.id]!.revision, profile: { role: 'newer' } }), h.run.snapshot().revision)
  await expect(h.actor.lease.submitDecision(stale.id, h.proposals)).rejects.toThrow(/not current/)
  expect(h.run.snapshot().decisions[stale.id]!.status).toBe('open')
})

it('rejects journal settlement that skips an earlier independent local intent', async () => {
  const h = await setup()
  const accepted = await h.actor.lease.submitDecision(h.decision.id, [h.proposals[0]!, h.proposals[0]!])
  const state = h.run.snapshot()
  expect(() => fold(state, { kind: 'operation/settled', id: accepted.operationIds[1], status: 'applied', code: 'SIM_APPLIED' }))
    .toThrow(/earlier simulation operation/)
})
