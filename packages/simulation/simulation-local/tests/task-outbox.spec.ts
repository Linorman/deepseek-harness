/** Task target refusal and uncertain receipts retain independent dependent-operation outcomes. */
import { describe, expect, it, vi } from 'vitest'
import { teamIdSchema, teamTaskIdSchema } from '@clocky/clocky-team'
import { simTimeSchema, simulationOperationIdSchema, simulationOutboxRetryRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationTaskTransport } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { assertTaskExecutions } from '../src/task-execution.ts'

const task = { subject: 'Prepare evidence', description: 'Return an independently reviewed result', blockedBy: [],
  requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
  reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 1 }

for (const backend of ['json', 'sqlite'] as const) {
  describe(`${backend} task outbox results`, () => {
    it.each(['rejected', 'blocked-authority'] as const)('retains %s and blocks dependent tasks without calling their target', async (status) => {
      const h = await createBusinessHarness(backend)
      try {
        const actor = await h.actor('creator')
        const decision = await h.submit(actor.lease, 'tasks', [
          { after: [], action: { kind: 'task/create', deliverAt: '5', task } },
          { after: [0], action: { kind: 'task/create', deliverAt: '5', task } },
        ])
        const first = decision.operationIds[0]!, dependent = decision.operationIds[1]!
        await expect(h.run.recordDelivery(first, actor.lease.epoch, h.run.snapshot().revision))
          .rejects.toThrow(/cannot produce message delivery/)
        await expect(h.run.dispatchOperation(first, { post: async () => ({ status: 'rejected', code: 'WRONG_TARGET' }) }, () => 100))
          .rejects.toThrow(/does not implement its target kind/)
        const createTask = vi.fn<SimulationTaskTransport['createTask']>(async () => ({ status, code: 'TARGET_REFUSED' }))
        const transport = { createTask }
        await h.run.drive({ until: simTimeSchema.parse('5') })
        const refused = await h.run.dispatchOperation(first, transport, () => 100)
        expect(refused).toMatchObject({ status: 'settled', result: { status, code: 'TARGET_REFUSED' } })
        await h.run.drive({ until: simTimeSchema.parse('5') })
        const blocked = await h.run.dispatchOperation(dependent, transport, () => 100)
        expect(blocked).toMatchObject({ status: 'settled', result: { status: 'blocked-dependency', code: 'SIM_DEPENDENCY_FAILED' } })
        expect(createTask).toHaveBeenCalledTimes(1)
        expect(h.run.snapshot().operations[first]?.outbox?.taskReceipt).toBeUndefined()
        expect(h.run.snapshot().operations[dependent]?.outbox?.attempts).toEqual([])
        expect(h.run.budgetUsage().messages.used).toBe(0)
        await actor.lease.revoke(); await actor.lease.release(); h.leases.splice(0)
        await h.run.close()
        const restored = await h.provider.open({ ...h.selection, mode: 'open' })
        expect(await restored.dispatchOperation(first, transport, () => 200)).toEqual(refused)
        expect(await restored.dispatchOperation(dependent, transport, () => 200)).toEqual(blocked)
        expect(createTask).toHaveBeenCalledTimes(1)
      } finally { await h.close() }
    })

    it('keeps a foreign Team receipt uncertain until explicit retry returns the canonical receipt', async () => {
      const h = await createBusinessHarness(backend, { outboxMaxAttempts: 1 })
      try {
        const actor = await h.actor('creator')
        const decision = await h.submit(actor.lease, 'task', [{ after: [], action: { kind: 'task/create', deliverAt: '0', task } }])
        const id = decision.operationIds[0]!
        let foreign = true
        const createTask = vi.fn<SimulationTaskTransport['createTask']>(async message => ({ status: 'applied', taskReceipt: {
          operationId: message.operationId, fingerprint: message.fingerprint,
          teamId: foreign ? teamIdSchema.parse('foreign-team') : message.sender.teamId, taskId: teamTaskIdSchema.parse('task'),
        } }))
        await h.run.drive({ until: simTimeSchema.parse('0') })
        expect(await h.run.dispatchOperation(id, { createTask }, () => 100)).toEqual({ status: 'outcome-unknown' })
        expect(h.run.snapshot().operations[id]?.result).toBeUndefined()
        expect(h.run.snapshot().operations[id]?.outbox?.taskReceipt).toBeUndefined()
        expect(h.run.snapshot().stall).toMatchObject({ code: 'SIM_OUTBOX_OUTCOME_UNKNOWN', operationId: id })
        expect(await h.run.dispatchOperation(id, { createTask }, () => 200)).toEqual({ status: 'outcome-unknown' })
        expect(createTask).toHaveBeenCalledTimes(1)
        await actor.lease.revoke(); await actor.lease.release(); h.leases.splice(0)
        await h.run.close()
        const restored = await h.provider.open({ ...h.selection, mode: 'open' })
        expect(restored.snapshot().operations[id]?.status).toBe('outcome-unknown')
        foreign = false
        await restored.retryOutbox(simulationOutboxRetryRequestSchema.parse({ id: 'reconcile-task', operationId: id,
          expectedAttemptCount: restored.snapshot().operations[id]!.outbox!.attempts.length,
          reason: 'Reconcile the canonical task', authorizedAt: 200 }))
        await restored.setPhase('running', restored.snapshot().revision)
        expect(await restored.dispatchOperation(id, { createTask }, () => 200))
          .toMatchObject({ status: 'settled', result: { status: 'applied', code: 'SIM_TASK_CREATED' } })
        expect(createTask).toHaveBeenCalledTimes(2)
        expect(createTask.mock.calls[1]?.[0]).toEqual(createTask.mock.calls[0]?.[0])
        expect(restored.snapshot().operations[id]?.outbox?.attempts.map(attempt => attempt.outcome)).toEqual(['uncertain', 'applied'])
        expect(restored.snapshot().operations[id]?.outbox?.taskReceipt?.teamId).toBe('company')
        const cancellation = { operationId: id, teamId: teamIdSchema.parse('company'), taskId: teamTaskIdSchema.parse('task'),
          cancellation: { requestedRevision: 1, requestedBy: actor.id as never, requestedAt: 201,
            target: { kind: 'pending' as const } } }
        const beforeCancellation = restored.snapshot().revision
        for (const invalid of [
          { ...cancellation, operationId: 'missing-operation' },
          { ...cancellation, teamId: 'foreign-team' },
          { ...cancellation, cancellation: { ...cancellation.cancellation, requestedBy: 'foreign-participant' } },
          { ...cancellation, cancellation: { ...cancellation.cancellation,
            target: { kind: 'attempt', attemptId: 'missing-attempt', participantId: 'creator', activationId: 'missing-activation' } } },
        ]) {
          await expect(restored.recordTaskCancellation(invalid as never)).rejects.toThrow('exact accepted source')
          expect(restored.snapshot().revision).toBe(beforeCancellation)
        }
        const first = await restored.recordTaskCancellation(cancellation)
        expect(await restored.recordTaskCancellation(cancellation)).toEqual(first)
        await expect(restored.recordTaskCancellation({ ...cancellation,
          cancellation: { ...cancellation.cancellation, reason: 'Changed original reason' } }))
          .rejects.toThrow('changed its original intent')
        const retained = restored.snapshot()
        expect(() => { assertTaskExecutions(retained) }).not.toThrow()
        expect(() => { assertTaskExecutions({ ...retained, taskCancellations: { [simulationOperationIdSchema.parse('foreign-key')]: first } }) })
          .toThrow('lost its original canonical source')
        expect(() => { assertTaskExecutions({ ...retained, operations: { ...retained.operations, [id]: undefined } }) })
          .toThrow('lost its original canonical source')
        expect(() => { assertTaskExecutions({ ...retained, taskCancellations: { [id]: { ...first,
          request: { ...first.request, cancellation: { ...first.request.cancellation, requestedBy: 'foreign' as never } } } } }) })
          .toThrow('lost its original canonical source')
      } finally { await h.close() }
    })
  })
}

it('rejects task outbox records without due, attempt, authority and matching target evidence', async () => {
  const h = await createBusinessHarness('sqlite', { outboxMaxAttempts: 1 })
  try {
    const creator = await h.actor('creator')
    const decision = await h.submit(creator.lease, 'tasks', [
      { after: [], action: { kind: 'task/create', deliverAt: '10', task } },
      { after: [0], action: { kind: 'task/create', deliverAt: '5', task } },
    ])
    const id = decision.operationIds[0]!, dependent = decision.operationIds[1]!
    const { foldOutboxRecord, outboxRecordSchema, requireOutbox, outboundMessage, outboundPayload } = await import('../src/outbox.ts')
    const { simulationOperationIdSchema, simulationChangeSchema } = await import('@clocky/clocky-simulation')
    const fold = (state: ReturnType<typeof h.run.snapshot>, change: unknown) => {
      const sequence = state.revision + 1
      return { ...foldOutboxRecord(state, outboxRecordSchema.parse(change), sequence), revision: sequence }
    }
    const early = h.run.snapshot(), operation = requireOutbox(early, id)
    expect(() => requireOutbox(early, simulationOperationIdSchema.parse('missing'))).toThrow(/not an accepted outbox/)
    expect(() => outboundMessage(early, operation)).toThrow(/requires communication/)
    expect(() => outboundPayload({ ...early, entities: {} }, operation)).toThrow(/canonical creator binding/)
    expect(() => fold(early, { kind: 'outbox/started', id, number: 1, at: 100 })).toThrow(/not due/)
    await h.run.drive({ until: simTimeSchema.parse('5') })
    await h.run.drive({ until: simTimeSchema.parse('10') })
    const ready = h.run.snapshot()
    for (const record of [
      { kind: 'outbox/delivery-failed', id, record: { type: 'channel/delivery-expired', sequence: 1, createdAt: 100,
        participantId: 'creator', envelopeId: 'envelope', envelopeSequence: 0 } },
      { kind: 'outbox/delivery-failure-resolved', id, resolution: { kind: 'retained-input' } },
      { kind: 'outbox/delivery-receipted', id, receipt: { type: 'channel/receipt', sequence: 1, createdAt: 100,
        participantId: 'creator', envelopeId: 'envelope', cursor: 0 } },
      { kind: 'outbox/received', id, epoch: '1' },
    ]) expect(() => fold(ready, record)).toThrow(/cannot have message delivery evidence/)
    expect(() => fold(ready, { kind: 'outbox/started', id: dependent, number: 1, at: 100 })).toThrow(/prerequisites are not applied/)
    expect(() => fold(ready, { kind: 'outbox/exhausted', id })).toThrow(/not exhausted/)
    expect(() => fold(ready, { kind: 'outbox/blocked', id, code: 'SIM_ENTITY_UNAVAILABLE' })).toThrow(/lacks authoritative evidence/)
    expect(() => fold(ready, { kind: 'outbox/blocked', id, code: 'SIM_DEPENDENCY_FAILED' })).toThrow(/lacks authoritative evidence/)
    expect(() => fold({ ...ready, phase: 'paused' }, { kind: 'outbox/started', id, number: 1, at: 100 })).toThrow(/not admissible/)
    const started = fold(ready, { kind: 'outbox/started', id, number: 1, at: 100 })
    const receipt = { operationId: id, fingerprint: operation.fingerprint, teamId: 'company', taskId: 'task' }
    expect(() => fold(ready, { kind: 'outbox/finished', id, number: 1, at: 100,
      outcome: { status: 'applied', taskReceipt: receipt } })).toThrow(/no matching attempt/)
    expect(() => fold(started, { kind: 'outbox/finished', id, number: 1, at: 100,
      outcome: { status: 'applied', taskReceipt: { ...receipt, fingerprint: 'foreign' } } })).toThrow(/does not match/)
    const completed = fold(started, { kind: 'outbox/finished', id, number: 1, at: 100, outcome: { status: 'applied', taskReceipt: receipt } })
    expect(() => fold(completed, { kind: 'outbox/started', id, number: 2, at: 100 })).toThrow(/already retained/)
    const retry = simulationOutboxRetryRequestSchema.parse({ id: 'original-retry', operationId: id,
      expectedAttemptCount: 1, authorizedAt: 110, reason: 'Reconcile target' })
    expect(() => fold(completed, { kind: 'outbox/retry-authorized', id, request: retry })).toThrow(/exact current unknown/)
    const exhausted = fold(started, { kind: 'outbox/exhausted', id })
    expect(exhausted.operations[id]?.status).toBe('outcome-unknown')
    const retried = fold(exhausted, { kind: 'outbox/retry-authorized', id, request: retry })
    expect(() => fold(retried, { kind: 'outbox/started', id, number: 2, at: 110 })).toThrow(/not admissible/)
    const resumed = { ...retried, phase: 'running' as const }
    expect(() => fold(resumed, { kind: 'outbox/started', id, number: 2, at: 109 })).toThrow(/not admissible/)
    expect(fold(resumed, { kind: 'outbox/started', id, number: 2, at: 110 }).operations[id]?.outbox?.attempts).toHaveLength(2)
    const refused = fold(started, { kind: 'outbox/finished', id, number: 1, at: 100, outcome: { status: 'rejected', code: 'DENIED' } })
    expect(fold(refused, { kind: 'outbox/blocked', id: dependent, code: 'SIM_DEPENDENCY_FAILED' }).operations[dependent]?.status).toBe('blocked-dependency')
    await creator.lease.revoke(); await creator.lease.release()
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: creator.id,
      entityRevision: h.run.snapshot().entities[creator.id]!.revision, phase: 'inactive' }), h.run.snapshot().revision)
    expect(fold(h.run.snapshot(), { kind: 'outbox/blocked', id, code: 'SIM_ENTITY_UNAVAILABLE' }).operations[id]?.status).toBe('blocked-authority')
  } finally { await h.close() }
})
