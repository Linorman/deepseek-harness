/** Immutable result intent requires real applied effects owned by the original attempt. */
import { describe, expect, it } from 'vitest'
import { channelReceiptRecordSchema, envelopeIdSchema, taskAttemptIdSchema } from '@clocky/clocky-team'
import { simulationTaskExecutionRequestSchema, simulationTaskEvidenceSchema, simulationTaskDecisionRequestSchema,
  simulationPolicyRefSchema, simulationTaskResultRequestSchema, simulationDecisionIdSchema,
  simulationTaskCancellationSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { createTaskReceipt } from './task-evidence-fixture.ts'
import { contextRequest } from './context-fixture.ts'
import { assertTaskExecutions, assertTaskResultEvidence, foldTaskExecution, taskExecutionRecordSchema } from '../src/task-execution.ts'

async function fixture(backend: 'json' | 'sqlite', communication = false) {
  const h = await createBusinessHarness(backend)
  const actor = await h.actor('executor')
  const recipient = communication ? await h.actor('recipient') : undefined
  await h.account('stock', actor.id, '2'); await h.account('received', actor.id, '0')
  const operationId = await createTaskReceipt(h, actor.lease, 'task')
  const entity = h.run.snapshot().entities[actor.id]!
  const request = simulationTaskExecutionRequestSchema.parse({ ...entity.binding!, runId: h.selection.spec.runId,
    operationId, attemptId: 'attempt', taskId: 'task', taskRevision: 1, ordinal: 1, entityId: actor.id,
    epoch: actor.lease.epoch, activationId: entity.writer!.activationId,
    reservationId: entity.writer!.reservationId, leaseDurationMs: 1000 })
  await h.run.reserveTaskExecution(request, h.run.snapshot().revision)
  const task = simulationTaskEvidenceSchema.parse({ operationId, teamId: request.teamId, taskId: request.taskId, revision: 2,
    phase: 'running', executor: { participantId: request.participantId, activationId: request.activationId, attemptId: request.attemptId, ordinal: 1 } })
  await h.run.observeTaskExecution({ attemptId: request.attemptId, task })
  const policy = simulationPolicyRefSchema.parse({ id: 'transfer', version: '1' })
  const decisionId = simulationDecisionIdSchema.parse('task-work')
  const association = simulationTaskDecisionRequestSchema.parse({ attemptId: request.attemptId, decisionId, predecessor: null,
    reason: 'Transfer inventory', task: { revision: 2, subject: 'Transfer', description: 'Transfer one unit' } })
  await h.run.associateTaskDecision(association)
  await actor.lease.openDecision(decisionId, h.run.snapshot().revision)
  const prepared = await actor.lease.prepareContext(decisionId, contextRequest())
  if (prepared.status !== 'prepared') throw new Error('Fixture requires prepared input')
  await h.run.recordTaskInput({ attemptId: request.attemptId, decisionId, inputId: prepared.view.inputId })
  const accepted = await h.submit(actor.lease, 'task-work', [{ after: [], action: communication ? {
    kind: 'communication/post', recipient: recipient!.id, channelId: 'channel', text: 'Delivery proof', deliverAt: '0',
  } : { kind: 'resource/transfer', grants: [],
    transaction: { commitmentId: null, reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: 'received', revision: 1 }],
      transfers: [{ from: 'stock', to: 'received', quantity: '1' }] } } }])
  const effectId = accepted.operationIds[0]!
  const result = simulationTaskResultRequestSchema.parse({ attemptId: request.attemptId, policy, operations: [effectId],
    outcome: { kind: 'completed', result: { summary: 'Transferred inventory' } } })
  return { ...h, actor, recipient, request, policy, result, effectId }
}

describe.each(['json', 'sqlite'] as const)('%s task result acceptance', (backend) => {
  it('waits for applied evidence, pins policy, retains exact terminal intent across retries and cold replay', async () => {
    const h = await fixture(backend)
    try {
      await expect(h.run.recordTaskResult(h.result, h.run.snapshot().revision)).rejects.toThrow(/selected policy/)
      const selected = await h.run.selectTaskCompletionPolicy(h.request.attemptId, h.policy)
      expect(await h.run.selectTaskCompletionPolicy(h.request.attemptId, h.policy)).toEqual(selected)
      await expect(h.run.selectTaskCompletionPolicy(h.request.attemptId, { ...h.policy, version: '2' })).rejects.toThrow(/changed its completion policy/)
      await expect(h.run.recordTaskResult(h.result, h.run.snapshot().revision)).rejects.toThrow(/applied effect/)
      await h.run.executeOperation(h.effectId)
      await expect(h.run.recordTaskResult(h.result, 0)).rejects.toThrow(/revision/)
      const result = await h.run.recordTaskResult(h.result, h.run.snapshot().revision)
      const revision = h.run.snapshot().revision
      expect(await h.run.recordTaskResult(h.result, 0)).toEqual(result)
      expect(h.run.snapshot().revision).toBe(revision)
      await expect(h.run.recordTaskResult({ ...h.result, outcome: { kind: 'failed', failure: { code: 'DIFFERENT', message: 'Other outcome' } } },
        revision)).rejects.toThrow(/changed its accepted result/)
      await h.actor.lease.revoke(); await h.actor.lease.release(); h.leases.splice(0)
      await h.run.close()
      const cold = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        expect(cold.snapshot().taskExecutions?.[h.request.attemptId]?.result).toEqual(result)
        expect(await cold.recordTaskResult(h.result, 0)).toEqual(result)
      } finally { await cold.close() }
    } finally { await h.close() }
  })

  it('requires recipient persistence independently of a successful publication receipt', async () => {
    const h = await fixture(backend, true)
    try {
      await h.run.selectTaskCompletionPolicy(h.request.attemptId, h.policy)
      await h.run.drive({ until: h.run.snapshot().time })
      await h.run.dispatchOperation(h.effectId, { post: async message => ({ status: 'applied', receipt: {
        runId: message.runId, teamId: message.sender.teamId, recipientId: message.recipient.participantId,
        operationId: message.operationId, fingerprint: message.fingerprint, channelId: message.channelId,
        envelopeId: envelopeIdSchema.parse('delivered'), sequence: 1,
      } }) }, () => 100)
      const pendingState = h.run.snapshot()
      const pendingExecution = pendingState.taskExecutions![h.request.attemptId]!
      expect(() => { assertTaskResultEvidence(pendingState, pendingExecution, h.result) })
        .toThrow(/recipient persistence evidence/)
      await expect(h.run.recordTaskResult(h.result, h.run.snapshot().revision)).rejects.toThrow(/recipient persistence evidence/)
      await h.run.recordDelivery(h.effectId, h.recipient!.lease.epoch, h.run.snapshot().revision)
      await expect(h.run.recordTaskResult(h.result, h.run.snapshot().revision)).rejects.toThrow(/recipient persistence evidence/)
      await h.run.confirmDelivery(h.effectId, channelReceiptRecordSchema.parse({ type: 'channel/receipt', sequence: 2,
        createdAt: 100, participantId: h.recipient!.id, envelopeId: 'delivered', cursor: 1 }), h.run.snapshot().revision)
      expect((await h.run.recordTaskResult(h.result, h.run.snapshot().revision)).request).toEqual(h.result)
    } finally { await h.close() }
  })

  it('refuses a completed result after a durable cancellation of the same accepted attempt', async () => {
    const h = await fixture(backend)
    try {
      await h.run.selectTaskCompletionPolicy(h.request.attemptId, h.policy)
      await h.run.executeOperation(h.effectId)
      await h.run.recordTaskCancellation(simulationTaskCancellationSchema.parse({
        operationId: h.request.operationId, teamId: h.request.teamId, taskId: h.request.taskId,
        cancellation: { requestedRevision: 2, requestedBy: h.actor.id, requestedAt: 10,
          target: { kind: 'attempt', attemptId: h.request.attemptId, participantId: h.request.participantId,
            activationId: h.request.activationId } },
      }))
      await expect(h.run.recordTaskResult(h.result, h.run.snapshot().revision))
        .rejects.toThrow(/cancelled task cannot accept a new completed result/)
    } finally { await h.close() }
  })

  it('rejects foreign or missing evidence and malformed terminal outcomes without recording completion', async () => {
    const h = await fixture(backend)
    try {
      await expect(h.run.selectTaskCompletionPolicy(taskAttemptIdSchema.parse('unknown'), h.policy))
        .rejects.toThrow(/current unfinished writer/)
      await h.run.selectTaskCompletionPolicy(h.request.attemptId, h.policy)
      await h.run.executeOperation(h.effectId)
      for (const operations of [[h.request.operationId], ['unknown']]) {
        const request = simulationTaskResultRequestSchema.parse({ ...h.result, operations })
        await expect(h.run.recordTaskResult(request, h.run.snapshot().revision))
          .rejects.toThrow(/exact applied effect/)
      }
      for (const patch of [
        { operations: [] }, { operations: [h.effectId, h.effectId] }, { outcome: { kind: 'released' } }, { outcome: { kind: 'lease-expired' } },
      ]) expect(() => simulationTaskResultRequestSchema.parse({ ...h.result, ...patch })).toThrow()
      const state = h.run.snapshot(), execution = state.taskExecutions![h.request.attemptId]!
      const record = taskExecutionRecordSchema.parse({ kind: 'task/execution-policy', attemptId: h.request.attemptId, policy: h.policy })
      expect(() => foldTaskExecution(state, record, state.revision + 1)).toThrow(/already selected/)
      expect(() => { assertTaskResultEvidence({ ...state, decisions: {} }, execution, h.result) }).toThrow(/exact applied effect/)
      expect(() => { assertTaskResultEvidence(state, { ...execution, decisions: [] }, h.result) }).toThrow(/exact applied effect/)
      const result = await h.run.recordTaskResult(h.result, state.revision)
      const complete = h.run.snapshot(), retained = complete.taskExecutions![h.request.attemptId]!
      for (const changed of [
        { ...result, sequence: 0 }, { ...result, sequence: complete.revision + 1 },
        { ...result, request: { ...result.request, policy: { ...h.policy, version: '2' } } },
      ]) expect(() => {
        assertTaskExecutions({ ...complete, taskExecutions: { [h.request.attemptId]: { ...retained, result: changed } } })
      })
        .toThrow(/original policy or acceptance sequence/)
    } finally { await h.close() }
  })
})
