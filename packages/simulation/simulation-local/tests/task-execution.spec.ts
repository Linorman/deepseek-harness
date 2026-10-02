/** Native attempt responsibility and canonical observations across storage replay. */
import { describe, expect, it } from 'vitest'
import { taskAttemptIdSchema } from '@clocky/clocky-team'
import { simulationTaskExecutionRequestSchema, simulationTaskEvidenceSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { createTaskReceipt } from './task-evidence-fixture.ts'
import { foldTaskExecution, assertTaskExecutions, taskExecutionRecordSchema } from '../src/task-execution.ts'

async function fixture(backend: 'json' | 'sqlite') {
  const h = await createBusinessHarness(backend)
  const actor = await h.actor('executor')
  const operationId = await createTaskReceipt(h, actor.lease, 'task')
  const entity = h.run.snapshot().entities[actor.id]!
  const request = simulationTaskExecutionRequestSchema.parse({ runId: h.selection.spec.runId, operationId,
    attemptId: 'attempt', taskId: 'task', taskRevision: 1, ordinal: 1, entityId: actor.id,
    ...entity.binding!, epoch: actor.lease.epoch, activationId: entity.writer!.activationId,
    reservationId: entity.writer!.reservationId, leaseDurationMs: 1000 })
  const task = simulationTaskEvidenceSchema.parse({ operationId, teamId: request.teamId, taskId: request.taskId,
    revision: 2, phase: 'assigned', executor: { participantId: request.participantId, activationId: request.activationId,
      attemptId: request.attemptId, ordinal: request.ordinal } })
  return { ...h, actor, request, task }
}

describe.each(['json', 'sqlite'] as const)('%s task execution responsibility', (backend) => {
  it('retains reservation and exact source facts on retry, pause and cold replay', async () => {
    const h = await fixture(backend)
    try {
      const reserved = await h.run.reserveTaskExecution(h.request, h.run.snapshot().revision)
      expect(reserved.request).toEqual(h.request)
      const observed = await h.run.observeTaskExecution({ attemptId: h.request.attemptId, task: h.task })
      const revision = h.run.snapshot().revision
      expect(await h.run.reserveTaskExecution(h.request, 0)).toEqual(observed)
      expect(await h.run.observeTaskExecution({ attemptId: h.request.attemptId, task: h.task })).toEqual(observed)
      expect(h.run.snapshot().revision).toBe(revision)
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const completed = simulationTaskEvidenceSchema.parse({ ...h.task, revision: 3, phase: 'completed',
        executor: { ...h.task.executor, outcome: 'completed' } })
      const terminal = await h.run.observeTaskExecution({ attemptId: h.request.attemptId, task: completed })
      await h.actor.lease.revoke(); await h.actor.lease.release(); h.leases.splice(0)
      await h.run.close()
      const cold = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        expect(cold.snapshot().taskExecutions?.[h.request.attemptId]).toEqual(terminal)
        const cut = await cold.acquireCheckpointCut(4)
        try { expect(cut.snapshot.taskExecutions?.[h.request.attemptId]).toEqual(terminal) }
        finally { cut.release() }
      } finally { await cold.close() }
    } finally { await h.close() }
  })

  it('refuses altered reservation, unowned source or concurrent responsibility before assignment', async () => {
    const h = await fixture(backend)
    try {
      const before = h.run.snapshot()
      for (const patch of [
        { runId: 'other' }, { operationId: 'missing' }, { taskId: 'other' }, { teamId: 'other' }, { ordinal: 3 },
        { entityId: 'missing' }, { participantId: 'other' }, { sessionId: 'other' }, { activationId: 'other' },
        { reservationId: 'other' }, { epoch: '2' },
      ]) {
        await expect(h.run.reserveTaskExecution(simulationTaskExecutionRequestSchema.parse({ ...h.request, ...patch }), before.revision))
          .rejects.toThrow(/current accepted source and writer/)
        expect(h.run.snapshot()).toEqual(before)
      }
      await expect(h.run.reserveTaskExecution(h.request, before.revision - 1)).rejects.toThrow(/revision/)
      await h.run.reserveTaskExecution(h.request, before.revision)
      await expect(h.run.reserveTaskExecution({ ...h.request, leaseDurationMs: 1 }, before.revision))
        .rejects.toThrow(/changed its reservation/)
      await expect(h.run.reserveTaskExecution({ ...h.request, attemptId: taskAttemptIdSchema.parse('second') }, h.run.snapshot().revision))
        .rejects.toThrow(/unresolved attempt/)
      const state = h.run.snapshot()
      expect(() => foldTaskExecution(state, { kind: 'task/execution-reserved', request: h.request }, state.revision + 1))
        .toThrow(/already reserved/)
      await h.run.setPhase('paused', h.run.snapshot().revision)
      await h.actor.lease.revoke(); await h.actor.lease.release(); h.leases.splice(0)
      await expect(h.run.acquireCheckpointCut(4)).rejects.toThrow(/unresolved task attempt/)
    } finally { await h.close() }
  })

  it('requires the exact attempt and immutable source revision; settled failure permits the next bounded attempt', async () => {
    const h = await fixture(backend)
    try {
      await expect(h.run.observeTaskExecution({ attemptId: h.request.attemptId, task: h.task })).rejects.toThrow(/no reserved attempt/)
      await h.run.reserveTaskExecution(h.request, h.run.snapshot().revision)
      const before = h.run.snapshot()
      for (const patch of [
        { operationId: 'other' }, { teamId: 'other' }, { taskId: 'other' }, { revision: 1 },
        { executor: { ...h.task.executor, attemptId: 'other' } },
        { executor: { ...h.task.executor, participantId: 'other' } },
        { executor: { ...h.task.executor, activationId: 'other' } },
        { executor: { ...h.task.executor, ordinal: 2 } },
      ]) await expect(h.run.observeTaskExecution({ attemptId: h.request.attemptId,
        task: simulationTaskEvidenceSchema.parse({ ...h.task, ...patch }) })).rejects.toThrow(/differs from its reserved attempt/)
      expect(h.run.snapshot()).toEqual(before)
      await h.run.observeTaskExecution({ attemptId: h.request.attemptId, task: h.task })
      await expect(h.run.observeTaskExecution({ attemptId: h.request.attemptId, task: { ...h.task, phase: 'running' } }))
        .rejects.toThrow(/immutable revision/)
      const failed = simulationTaskEvidenceSchema.parse({ ...h.task, revision: 3, phase: 'pending',
        executor: { ...h.task.executor, outcome: 'failed' } })
      await h.run.observeTaskExecution({ attemptId: h.request.attemptId, task: failed })
      await expect(h.run.observeTaskExecution({ attemptId: h.request.attemptId, task: h.task })).rejects.toThrow(/immutable revision/)
      const second = { ...h.request, attemptId: taskAttemptIdSchema.parse('second'), taskRevision: 3, ordinal: 2 }
      expect((await h.run.reserveTaskExecution(second, h.run.snapshot().revision)).request).toEqual(second)
      await expect(h.run.reserveTaskExecution({ ...second, attemptId: taskAttemptIdSchema.parse('third'), ordinal: 3 },
        h.run.snapshot().revision)).rejects.toThrow(/current accepted source/)
    } finally { await h.close() }
  })
})

it('checks persisted execution source identities without requiring the historical writer to remain live', async () => {
  const h = await fixture('sqlite')
  try {
    await h.run.reserveTaskExecution(h.request, h.run.snapshot().revision)
    await h.run.observeTaskExecution({ attemptId: h.request.attemptId, task: h.task })
    const state = h.run.snapshot(), execution = state.taskExecutions![h.request.attemptId]!
    for (const changed of [
      { ...execution, reservedSequence: state.revision + 1 },
      { ...execution, request: { ...h.request, ordinal: 3 } },
      { ...execution, request: simulationTaskExecutionRequestSchema.parse({ ...h.request, runId: 'other' }) },
    ]) expect(() => { assertTaskExecutions({ ...state, taskExecutions: { [h.request.attemptId]: changed } }) })
      .toThrow(/creation responsibility/)
    expect(() => { assertTaskExecutions({ ...state, taskExecutions: { [taskAttemptIdSchema.parse('other')]: execution } }) })
      .toThrow(/creation responsibility/)
    expect(() => { assertTaskExecutions({ ...state, operations: {} }) }).toThrow(/creation responsibility/)
    expect(() => { assertTaskExecutions({ ...state, taskExecutions: { [h.request.attemptId]: { ...execution,
      task: simulationTaskEvidenceSchema.parse({ ...h.task, executor: { ...h.task.executor, attemptId: 'other' } }),
    } } }) }).toThrow(/canonical source identity/)
    await h.actor.lease.revoke(); await h.actor.lease.release()
    expect(() => { assertTaskExecutions(h.run.snapshot()) }).not.toThrow()
    expect(() => taskExecutionRecordSchema.parse({ kind: 'task/execution-reserved', request: { ...h.request, epoch: '-1' } })).toThrow()
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('%s retires only a stopped original writer and retains immutable controller evidence', async (backend) => {
  const h = await fixture(backend)
  try {
    await h.run.reserveTaskExecution(h.request, h.run.snapshot().revision)
    const retirement = { attemptId: h.request.attemptId, quiescedAt: 100, source: 'quiesced' as const, reason: 'Writer retired' }
    await expect(h.run.retireTaskExecution(retirement)).rejects.toThrow(/stopped writer epoch/)
    await h.actor.lease.revoke()
    await expect(h.run.retireTaskExecution(retirement)).rejects.toThrow(/stopped writer epoch/)
    await h.actor.lease.release()
    const retired = await h.run.retireTaskExecution(retirement)
    const revision = h.run.snapshot().revision
    expect(await h.run.retireTaskExecution(retirement)).toEqual(retired)
    expect(h.run.snapshot().revision).toBe(revision)
    await expect(h.run.retireTaskExecution({ ...retirement, source: 'fenced' })).rejects.toThrow(/changed its retirement evidence/)
    await expect(h.run.retireTaskExecution({ ...retirement, attemptId: taskAttemptIdSchema.parse('unknown') }))
      .rejects.toThrow(/stopped writer epoch/)
    const state = h.run.snapshot()
    expect(() => foldTaskExecution(state, { kind: 'task/execution-retired', retirement }, state.revision + 1)).toThrow(/stopped writer epoch/)
    for (const sequence of [retired.reservedSequence, state.revision + 1]) {
      expect(() => { assertTaskExecutions({ ...state, taskExecutions: { [h.request.attemptId]: { ...retired,
        retired: { ...retired.retired!, sequence },
      } } }) }).toThrow(/creation responsibility/)
    }
    expect(() => { assertTaskExecutions({ ...state, entities: {} }) }).toThrow(/stopped writer epoch/)
    await h.run.setPhase('paused', h.run.snapshot().revision)
    const cut = await h.run.acquireCheckpointCut(4)
    try { expect(cut.snapshot.taskExecutions?.[h.request.attemptId]?.retired).toEqual(retired.retired) }
    finally { cut.release() }
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('%s records ordered task decisions and exact prepared input with immutable retry', async (backend) => {
  const h = await fixture(backend)
  try {
    const { simulationTaskDecisionRequestSchema, simulationDecisionIdSchema, taskDecision, taskDecisionBlock }
      = await import('@clocky/clocky-simulation')
    const { contextRequest } = await import('./context-fixture.ts')
    await h.run.reserveTaskExecution(h.request, h.run.snapshot().revision)
    await h.run.observeTaskExecution({ attemptId: h.request.attemptId, task: h.task })
    const request = simulationTaskDecisionRequestSchema.parse({ attemptId: h.request.attemptId,
      decisionId: 'task-decision', predecessor: null, reason: 'Execute the original task',
      task: { revision: h.task.revision, subject: 'Prepare goods', description: 'Fulfill the accepted order' } })
    const association = await h.run.associateTaskDecision(request)
    const revision = h.run.snapshot().revision
    expect(await h.run.associateTaskDecision(request)).toEqual(association)
    expect(h.run.snapshot().revision).toBe(revision)
    await expect(h.run.associateTaskDecision({ ...request, reason: 'Another selection' })).rejects.toThrow(/changed its source/)
    await h.actor.lease.openDecision(request.decisionId, h.run.snapshot().revision)
    const prepared = await h.actor.lease.prepareContext(request.decisionId, contextRequest())
    if (prepared.status !== 'prepared') throw new Error('Fixture requires prepared input')
    expect(prepared.view.content.find(value => value.kind === 'input')?.blocks.at(-1))
      .toEqual(taskDecisionBlock(h.run.snapshot().taskExecutions![h.request.attemptId]!, association))
    const receipt = { attemptId: h.request.attemptId, decisionId: request.decisionId, inputId: prepared.view.inputId }
    await expect(h.run.recordTaskInput({ ...receipt, inputId: 'wrong' })).rejects.toThrow(/exact prepared decision/)
    const recorded = await h.run.recordTaskInput(receipt)
    expect(await h.run.recordTaskInput(receipt)).toEqual(recorded)
    await expect(h.run.recordTaskInput({ ...receipt, inputId: 'wrong' })).rejects.toThrow(/changed its identity/)
    expect(taskDecision(h.run.snapshot(), request.decisionId)?.decision).toEqual(recorded)
    expect(taskDecision(h.run.snapshot(), simulationDecisionIdSchema.parse('ordinary'))).toBeUndefined()
    await expect(h.run.associateTaskDecision({ ...request, decisionId: simulationDecisionIdSchema.parse('next'),
      predecessor: request.decisionId })).rejects.toThrow(/conflicting predecessor/)
    await h.actor.lease.submitDecision(request.decisionId, [])
    const next = { ...request, decisionId: simulationDecisionIdSchema.parse('next'), predecessor: request.decisionId, reason: 'Report the result' }
    expect((await h.run.associateTaskDecision(next)).request.predecessor).toBe(request.decisionId)
    await h.actor.lease.revoke(); await h.actor.lease.release(); h.leases.splice(0)
    await h.run.close()
    const cold = await h.provider.open({ ...h.selection, mode: 'open' })
    try {
      expect(cold.snapshot().taskExecutions?.[h.request.attemptId]?.decisions).toHaveLength(2)
      expect(taskDecision(cold.snapshot(), request.decisionId)?.decision.input?.id).toBe(prepared.view.inputId)
    } finally { await cold.close() }
  } finally { await h.close() }
})

it('rejects a new task decision without live assignment, ordered source or unique identity', async () => {
  const h = await fixture('sqlite')
  try {
    const { simulationTaskDecisionRequestSchema } = await import('@clocky/clocky-simulation')
    const request = simulationTaskDecisionRequestSchema.parse({ attemptId: h.request.attemptId, decisionId: 'task-decision',
      predecessor: null, reason: 'Execute', task: { revision: 2, subject: 'Prepare', description: 'Prepare goods' } })
    await expect(h.run.associateTaskDecision(request)).rejects.toThrow(/live assigned attempt/)
    await h.run.reserveTaskExecution(h.request, h.run.snapshot().revision)
    await expect(h.run.associateTaskDecision(request)).rejects.toThrow(/live assigned attempt/)
    await h.run.observeTaskExecution({ attemptId: h.request.attemptId, task: h.task })
    const before = h.run.snapshot()
    await expect(h.run.associateTaskDecision({ ...request, task: { ...request.task, revision: 3 } }))
      .rejects.toThrow(/live assigned attempt/)
    await h.actor.lease.openDecision(request.decisionId, h.run.snapshot().revision)
    await expect(h.run.associateTaskDecision(request)).rejects.toThrow(/conflicting predecessor/)
    await h.actor.lease.cancelDecision(request.decisionId)
    expect(h.run.snapshot().taskDecisionOwners).toBeUndefined()
    const record = taskExecutionRecordSchema.parse({ kind: 'task/execution-decision', request })
    expect(() => foldTaskExecution({ ...before, phase: 'paused' }, record, before.revision + 1)).toThrow(/live assigned attempt/)
  } finally { await h.close() }
})

it('rejects broken task decision indexes and retained input relationships', async () => {
  const h = await fixture('sqlite')
  try {
    const { simulationTaskDecisionRequestSchema, taskDecision, simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
    await h.run.reserveTaskExecution(h.request, h.run.snapshot().revision)
    await h.run.observeTaskExecution({ attemptId: h.request.attemptId, task: h.task })
    const request = simulationTaskDecisionRequestSchema.parse({ attemptId: h.request.attemptId, decisionId: 'linked', predecessor: null,
      reason: 'Work', task: { revision: 2, subject: 'Task', description: 'Work' } })
    const association = await h.run.associateTaskDecision(request)
    const state = h.run.snapshot(), execution = state.taskExecutions![h.request.attemptId]!
    await expect(h.run.recordTaskInput({ attemptId: taskAttemptIdSchema.parse('unknown'), decisionId: request.decisionId, inputId: 'unknown' }))
      .rejects.toThrow(/exact prepared decision/)
    expect(() => { assertTaskExecutions({ ...state, taskDecisionOwners: { ...state.taskDecisionOwners,
      [simulationDecisionIdSchema.parse('extra')]: { attemptId: h.request.attemptId, index: 0 },
    } }) }).toThrow(/index lost its ordered source/)
    expect(() => taskDecision({ ...state, taskDecisionOwners: { [request.decisionId]: { attemptId: h.request.attemptId, index: 1 } } },
      request.decisionId)).toThrow(/index lost its source/)
    expect(() => { assertTaskExecutions({ ...state, taskDecisionOwners: { [simulationDecisionIdSchema.parse('other')]:
      { attemptId: h.request.attemptId, index: 0 } } }) }).toThrow(/ordered source/)
    for (const changed of [
      { ...association, sequence: execution.reservedSequence },
      { ...association, input: { id: 'unprepared', sequence: state.revision + 1 } },
    ]) expect(() => { assertTaskExecutions({ ...state, taskExecutions: { [h.request.attemptId]: { ...execution,
      decisions: [changed],
    } } }) }).toThrow(/ordered source or input relationship/)
    await expect(h.run.recordTaskInput({ attemptId: h.request.attemptId, decisionId: request.decisionId, inputId: 'unprepared' }))
      .rejects.toThrow(/exact prepared decision/)
  } finally { await h.close() }
})

describe.each(['json', 'sqlite'] as const)('%s task cognition selection', (backend) => {
  it('retains its pure policy and rejects switching cognition before computation or after replay', async () => {
    const h = await fixture(backend)
    const { simulationTaskDecisionRequestSchema, simulationPolicyRefSchema } = await import('@clocky/clocky-simulation')
    const { contextRequest } = await import('./context-fixture.ts')
    try {
      await h.run.reserveTaskExecution(h.request, h.run.snapshot().revision)
      await h.run.observeTaskExecution({ attemptId: h.request.attemptId, task: h.task })
      const policy = simulationPolicyRefSchema.parse({ id: 'pure-task', version: '1' })
      const request = simulationTaskDecisionRequestSchema.parse({ attemptId: h.request.attemptId, decisionId: 'pure',
        predecessor: null, reason: 'Compute the task', policy,
        task: { revision: h.task.revision, subject: 'Prepare goods', description: 'Fulfill the accepted order' } })
      await h.run.associateTaskDecision(request)
      await h.actor.lease.openDecision(request.decisionId, h.run.snapshot().revision)
      await expect(h.actor.lease.submitDecision(request.decisionId, [])).rejects.toThrow(/selected cognition policy/)
      await expect(h.actor.lease.selectDeterministicPolicy(request.decisionId, { ...policy, version: '2' }))
        .rejects.toThrow(/selected cognition policy/)
      await h.actor.lease.selectDeterministicPolicy(request.decisionId, policy)
      const prepared = await h.actor.lease.prepareContext(request.decisionId, contextRequest())
      if (prepared.status !== 'prepared') throw new Error('Fixture requires prepared input')
      await h.run.recordTaskInput({ attemptId: h.request.attemptId, decisionId: request.decisionId, inputId: prepared.view.inputId })
      await h.actor.lease.recordDeterministicResult(request.decisionId, [])
      await h.actor.lease.submitDecision(request.decisionId, [])
      await h.actor.lease.revoke(); await h.actor.lease.release(); h.leases.splice(0)
      await h.run.close()
      const cold = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        expect(cold.snapshot().taskExecutions?.[h.request.attemptId]?.decisions?.[0]?.request.policy).toEqual(policy)
        expect(cold.snapshot().decisions[request.decisionId]?.deterministic?.policy).toEqual(policy)
      } finally { await cold.close() }
    } finally { await h.close() }
  })
})
