/** Automatic source selection and original-attempt retry through native effects and canonical Hub settlement. */
import { expect, it, vi } from 'vitest'
import { SimulationTaskExecutor } from '../src/task-executor.ts'
import type { SimulationTaskExecutorOptions } from '../src/task-executor.ts'
import { taskExecutorFixture } from './task-executor-fixture.ts'
import { taskAttemptIdSchema, teamTaskCancellationSnapshotSchema } from '@clocky/clocky-team'
import { LlmAdapter, CallId } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationEntityIdSchema, simulationDecisionIdSchema, simulationWindowIdSchema,
  simulationCheckpointIdSchema, simulationInteractionIdSchema, simulationProposalSchema } from '@clocky/clocky-simulation'

function loseResponse<Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) {
  return async (...args: Args): Promise<Result> => { await operation(...args); throw new Error('response-lost') }
}

it.each(['json', 'sqlite'] as const)('automatically assigns, executes and completes an accepted task (%s)', async (backend) => {
  const h = await taskExecutorFixture(backend)
  try {
    const paused = h.run.snapshot()
    expect((await h.executor.advance()).reason).toBe('paused')
    expect(h.run.snapshot()).toEqual(paused)
    await h.start()
    await h.createTask()
    const pending = h.executor.advance()
    expect(h.executor.advance()).toBe(pending)
    expect((await pending).reason).toBe('idle')
    const state = h.run.snapshot(), execution = Object.values(state.taskExecutions!)[0]!
    expect(execution.task?.phase).toBe('completed')
    expect(execution.decisions?.[0]?.input).toBeDefined()
    expect(state.resources['stock' as never]?.quantity).toBe('1')
    expect(state.resources['received' as never]?.quantity).toBe('1')
    expect(h.computations).toBe(1)
    expect(h.requests).toEqual([])
    expect((await h.executor.advance()).reason).toBe('idle')
    expect(h.run.snapshot()).toEqual(state)
    await h.executor.drain()
  } finally { await h.close() }
})

it.each(['reserve', 'assign', 'decision', 'settle'] as const)('retries the original identities after %s response loss', async (stage) => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    const spy = stage === 'reserve'
      ? vi.spyOn(h.run, 'reserveTaskExecution').mockImplementationOnce(loseResponse(h.run.reserveTaskExecution.bind(h.run)))
      : stage === 'assign'
        ? vi.spyOn(h.ctx.teams, 'assignSimulationTask').mockImplementationOnce(loseResponse(h.ctx.teams.assignSimulationTask.bind(h.ctx.teams)))
        : stage === 'settle'
          ? vi.spyOn(h.ctx.teams, 'settleSimulationTaskAttempt').mockImplementationOnce(loseResponse(h.ctx.teams.settleSimulationTaskAttempt.bind(h.ctx.teams)))
          : vi.spyOn(h.connection, 'executeTaskDecision').mockImplementationOnce(loseResponse(h.connection.executeTaskDecision.bind(h.connection)))
    await expect(h.executor.advance()).rejects.toThrow('response-lost')
    spy.mockRestore()
    expect((await h.executor.advance()).reason).toBe('idle')
    const executions = Object.values(h.run.snapshot().taskExecutions!)
    expect(executions).toHaveLength(1)
    const execution = executions[0]!
    const task = await h.ctx.teams.getTask({ teamId: execution.request.teamId, taskId: execution.request.taskId })
    expect(task.attemptCount).toBe(1)
    expect(task.phase).toBe('completed')
    expect(h.computations).toBe(1)
    expect(h.run.snapshot().resources['received' as never]?.quantity).toBe('1')
  } finally { await h.close() }
})

it.each(['residency', 'assignment', 'cognition', 'effects'] as const)('keeps admitted identities and stops after pause during %s', async (stage) => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    const pauseAfter = <Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) => async (...args: Args) => {
      const result = await operation(...args)
      await h.run.setPhase('paused', h.run.snapshot().revision)
      return result
    }
    if (stage === 'residency') vi.spyOn(h.connection, 'ensureResident').mockImplementationOnce(pauseAfter(h.connection.ensureResident.bind(h.connection)))
    if (stage === 'assignment') vi.spyOn(h.connection, 'assignTask').mockImplementationOnce(pauseAfter(h.connection.assignTask.bind(h.connection)))
    if (stage === 'cognition') vi.spyOn(h.connection, 'executeTaskDecision').mockImplementationOnce(pauseAfter(h.connection.executeTaskDecision.bind(h.connection)))
    if (stage === 'effects') vi.spyOn(h.connection, 'driveResident').mockImplementationOnce(pauseAfter(h.connection.driveResident.bind(h.connection)))
    expect((await h.executor.advance()).reason).toBe('paused')
    const state = h.run.snapshot()
    expect(Object.values(state.taskExecutions ?? {}).length).toBe(stage === 'residency' ? 0 : 1)
    expect(Object.values(state.taskExecutions ?? {}).every(value => value.task?.phase !== 'completed')).toBe(true)
    await h.run.setPhase('running', h.run.snapshot().revision)
    expect((await h.executor.advance()).reason).toBe('idle')
    expect(h.computations).toBe(1)
  } finally { await h.close() }
})

it.each(['capacity', 'recovery-required'] as const)('reports %s residency without assigning or computing', async (status) => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    vi.spyOn(h.connection, 'ensureResident').mockResolvedValueOnce({ status, entityId: h.config.routes[0]!.entityId })
    expect((await h.executor.advance()).reason).toBe(status === 'capacity' ? 'resident-capacity' : 'recovery-required')
    expect(h.run.snapshot().taskExecutions).toBeUndefined()
    expect(h.computations).toBe(0)
  } finally { await h.close() }
})

it.each([false, true])('retains an unmet dependency and respects pause in its read (pause=%s)', async (pause) => {
  const h = await taskExecutorFixture()
  try {
    await h.start()
    const dependency = await h.createTask([], simulationEntityIdSchema.parse('supplier'))
    const taskId = dependency.outbox!.taskReceipt!.taskId
    await h.createTask([taskId])
    const executor = new SimulationTaskExecutor(h.run, h.connection, h.config, { ...h.options, readTask: async (request) => {
      const task = await h.options.readTask(request)
      if (pause && request.taskId === taskId) await h.run.setPhase('paused', h.run.snapshot().revision)
      return task
    } })
    expect((await executor.advance()).reason).toBe(pause ? 'paused' : 'task-blocked')
    expect(h.run.snapshot().taskExecutions).toBeUndefined()
  } finally { await h.close() }
})

it('waits for an existing scenario window and drains a pending batch before retirement', async () => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    const id = simulationDecisionIdSchema.parse('scenario-window'), windowId = simulationWindowIdSchema.parse(id)
    const buyer = simulationEntityIdSchema.parse('buyer')
    await h.connection.openWindow({ id: windowId, decisions: [{ id, entityId: buyer, context: h.options.context() }] })
    expect((await h.executor.advance()).reason).toBe('task-waiting')
    await h.connection.cancelDecision(buyer, id)
    await h.run.commitWindow(windowId)
    const pending = h.executor.advance()
    const drained = h.executor.drain()
    await drained
    expect((await pending).reason).toBe('idle')
    h.lifetime.abort(new Error('owner-retired'))
    await expect(h.executor.advance()).rejects.toThrow('owner-retired')
  } finally { await h.close() }
})

it.each(['retry', 'outcome-unknown', 'decision-required'] as const)('preserves the %s operation stop without repeating cognition', async (reason) => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    vi.spyOn(h.connection, 'driveResident').mockResolvedValueOnce({ reason, rounds: 0, steps: 0,
      revision: h.run.snapshot().revision, ...reason === 'retry' ? { nextAttemptAt: 1234 } : {} })
    const result = await h.executor.advance()
    expect(result.reason).toBe(reason === 'decision-required' ? 'task-waiting' : reason)
    if (reason === 'retry') expect(result.nextAttemptAt).toBe(1234)
    expect(h.computations).toBe(1)
    expect((await h.executor.advance()).reason).toBe('idle')
    expect(h.computations).toBe(1)
  } finally { await h.close() }
})

it('returns its configured work bound after productive execution', async () => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    const executor = new SimulationTaskExecutor(h.run, h.connection, { ...h.config, maxControlSteps: 1 }, h.options)
    expect(await executor.advance()).toMatchObject({ reason: 'work-limit', controlSteps: 1 })
    expect((await executor.advance()).reason).toBe('idle')
  } finally { await h.close() }
})

it('does not turn a failed completed attempt into another inference', async () => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    h.removeCompletion()
    h.ctx.simulationTeams.registerTaskCompletionPolicy({ ...h.config.routes[0]!.completion, evaluate: () => ({ status: 'result',
      operations: [], outcome: { kind: 'failed', failure: { code: 'SCENE_FAILED', message: 'Required scene result failed' } } }) })
    expect((await h.executor.advance()).reason).toBe('task-blocked')
    expect((await h.executor.advance()).reason).toBe('task-blocked')
    expect(h.computations).toBe(1)
    expect(Object.values(h.run.snapshot().taskExecutions!)).toHaveLength(1)
  } finally { await h.close() }
})

it('requires recovery after checkpoint retirement of an unfinished attempt', async () => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    vi.spyOn(h.connection, 'executeTaskDecision').mockRejectedValueOnce(new Error('before-input'))
    await expect(h.executor.advance()).rejects.toThrow('before-input')
    await h.connection.checkpoint({ id: simulationCheckpointIdSchema.parse('unfinished'), implementationVersion: 'company/1',
      maxDrainRounds: 4, maxAttempts: 3 })
    await h.run.setPhase('running', h.run.snapshot().revision)
    expect((await h.executor.advance()).reason).toBe('recovery-required')
    expect(h.computations).toBe(0)
  } finally { await h.close() }
})

it.each(['entity', 'lease', 'interaction', 'reason', 'cognition', 'completion'] as const)('rejects a changed %s route after original acceptance', async (field) => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    await h.executor.advance()
    const route = h.config.routes[0]!
    const config = { ...h.config, ...field === 'lease' ? { leaseDurationMs: h.config.leaseDurationMs + 1 } : {},
      routes: [{ ...route, ...field === 'entity' ? { entityId: simulationEntityIdSchema.parse('buyer') } : {},
        ...field === 'interaction' ? { interactionId: simulationInteractionIdSchema.parse('another-interaction') } : {},
        ...field === 'reason' ? { reason: 'Another instruction' } : {},
        ...field === 'cognition' ? { cognition: { ...route.cognition!, version: '2' } } : {},
        ...field === 'completion' ? { completion: { ...route.completion, version: '2' } } : {} }],
    }
    const executor = new SimulationTaskExecutor(h.run, h.connection, config, h.options)
    await expect(executor.advance()).rejects.toThrow(/differs from its retained/)
    expect(h.computations).toBe(1)
  } finally { await h.close() }
})

it('rejects a canonical reader returning another task identity', async () => {
  const h = await taskExecutorFixture()
  try {
    await h.start()
    const first = await h.createTask(), second = await h.createTask()
    const executor = new SimulationTaskExecutor(h.run, h.connection, h.config, { ...h.options,
      readTask: request => h.options.readTask({ ...request, taskId: request.taskId === first.outbox!.taskReceipt!.taskId
        ? second.outbox!.taskReceipt!.taskId : first.outbox!.taskReceipt!.taskId }) })
    await expect(executor.advance()).rejects.toThrow('reader returned another task')
  } finally { await h.close() }
})

it('retains explicit interaction responsibility after a lost reconciliation response', async () => {
  const h = await taskExecutorFixture()
  try {
    await h.start()
    const buyer = simulationEntityIdSchema.parse('buyer'), supplier = simulationEntityIdSchema.parse('supplier')
    const interactionId = simulationInteractionIdSchema.parse('delivery-commitment')
    const apply = async (entityId: typeof buyer, label: string, action: unknown) => {
      await h.connection.ensureResident(entityId, h.options.residency(entityId))
      const id = simulationDecisionIdSchema.parse(label)
      await h.connection.openDecision(entityId, id)
      const decision = await h.connection.submitDecision(entityId, id, [simulationProposalSchema.parse({ after: [], action })])
      await h.run.executeOperation(decision.operationIds[0]!)
    }
    await apply(buyer, 'request-task', { kind: 'interaction/request', id: interactionId, assignee: supplier,
      description: 'Deliver the inventory task', replyBy: null, completeBy: null, fulfillment: { kind: 'task-completed' } })
    await apply(supplier, 'accept-task', { kind: 'interaction/accept', id: interactionId, expectedRevision: 1 })
    await h.createTask()
    const executor = new SimulationTaskExecutor(h.run, h.connection, { ...h.config,
      routes: [{ ...h.config.routes[0]!, interactionId }] }, h.options)
    vi.spyOn(h.run, 'reconcileTask').mockRejectedValueOnce(new Error('reconcile-response-lost'))
    await expect(executor.advance()).rejects.toThrow('reconcile-response-lost')
    expect(Object.values(h.run.snapshot().taskExecutions!)[0]!.task?.phase).toBe('completed')
    expect((await executor.advance()).reason).toBe('idle')
    const state = h.run.snapshot(), interaction = state.interactions[interactionId]!
    expect(interaction.task?.phase).toBe('completed')
    expect(state.commitments[interaction.commitmentId!]!.phase).toBe('fulfilled')
    expect(h.computations).toBe(1)
  } finally { await h.close() }
})

it('executes a dependent task after its separately routed prerequisite completes', async () => {
  const h = await taskExecutorFixture()
  try {
    await h.start()
    const supplier = simulationEntityIdSchema.parse('supplier')
    const dependency = await h.createTask([], supplier)
    await h.createTask([dependency.outbox!.taskReceipt!.taskId])
    const prerequisite = new SimulationTaskExecutor(h.run, h.connection, { ...h.config,
      routes: [{ ...h.config.routes[0]!, sourceEntityId: supplier }] }, h.options)
    expect((await prerequisite.advance()).reason).toBe('idle')
    expect((await h.executor.advance()).reason).toBe('idle')
    expect(h.computations).toBe(2)
  } finally { await h.close() }
})

it('selects the newer explicit attempt after the retired attempt is accounted for', async () => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); const operation = await h.createTask()
    vi.spyOn(h.connection, 'executeTaskDecision').mockRejectedValueOnce(new Error('before-input'))
    await expect(h.executor.advance()).rejects.toThrow('before-input')
    const supplier = simulationEntityIdSchema.parse('supplier')
    await h.connection.hibernate(supplier)
    await h.connection.ensureResident(supplier, h.options.residency(supplier))
    await h.connection.assignTask({ operationId: operation.id, entityId: supplier,
      attemptId: taskAttemptIdSchema.parse('explicit-replacement'), leaseDurationMs: h.config.leaseDurationMs })
    expect((await h.executor.advance()).reason).toBe('idle')
    const attempts = Object.values(h.run.snapshot().taskExecutions!)
    expect(attempts).toHaveLength(2)
    expect(attempts[0]!.retired).toBeDefined()
    expect(attempts[1]!.task?.phase).toBe('completed')
    expect(h.computations).toBe(1)
  } finally { await h.close() }
})

it.each(['completed', 'cancelled', 'deleted', 'failed'] as const)('honors a source task already observed as %s without a reservation', async (phase) => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    const executor = new SimulationTaskExecutor(h.run, h.connection, h.config, { ...h.options, readTask: async request => ({
      ...await h.options.readTask(request), phase,
    }) })
    expect((await executor.advance()).reason).toBe(phase === 'failed' ? 'task-blocked' : 'idle')
    expect(h.run.snapshot().taskExecutions).toBeUndefined()
  } finally { await h.close() }
})

it('rejects an unfinished attempt whose observed writer has been released', async () => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    vi.spyOn(h.connection, 'executeTaskDecision').mockRejectedValueOnce(new Error('before-input'))
    await expect(h.executor.advance()).rejects.toThrow('before-input')
    const state = h.run.snapshot(), supplier = simulationEntityIdSchema.parse('supplier')
    vi.spyOn(h.run, 'snapshot').mockReturnValue({ ...state, entities: { ...state.entities,
      [supplier]: { ...state.entities[supplier]!, writer: { ...state.entities[supplier]!.writer!, phase: 'released' } },
    } })
    expect((await h.executor.advance()).reason).toBe('recovery-required')
    vi.restoreAllMocks()
    expect(h.computations).toBe(0)
  } finally { await h.close() }
})

it('does not reopen a cancelled task decision', async () => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    vi.spyOn(h.connection, 'executeDeterministicDecision').mockImplementationOnce(async (entityId, id) => {
      await h.connection.openDecision(entityId, id)
      return await h.connection.cancelDecision(entityId, id)
    })
    expect((await h.executor.advance()).reason).toBe('task-waiting')
    expect((await h.executor.advance()).reason).toBe('recovery-required')
    expect(h.computations).toBe(0)
  } finally { await h.close() }
})

it('uses the scoped real model path when the route does not select deterministic cognition', async () => {
  const h = await taskExecutorFixture()
  try {
    let calls = 0
    class Model extends LlmAdapter {
      async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        expect(options.tools?.map(tool => tool.name).sort()).toEqual(['simulation_observe', 'simulation_stage', 'simulation_submit'])
        const name = calls++ === 0 ? 'simulation_stage' : 'simulation_submit'
        const args = JSON.stringify(name === 'simulation_stage' ? { proposals: [simulationProposalSchema.parse({ after: [],
          action: { kind: 'resource/transfer', grants: [], transaction: { commitmentId: null,
            reads: ['stock', 'received'].map(id => ({ resourceId: id, revision: h.run.snapshot().resources[id as never]!.revision })),
            transfers: [{ from: 'stock', to: 'received', quantity: '1' }] } },
        })] } : {})
        const id = CallId(name)
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      }
    }
    const model = new Model()
    vi.spyOn(h.adapter, 'stream').mockImplementation(model.stream.bind(model))
    await h.start(); await h.createTask()
    const { cognition: _cognition, ...route } = h.config.routes[0]!
    const executor = new SimulationTaskExecutor(h.run, h.connection, { ...h.config, routes: [route] }, h.options)
    expect((await executor.advance()).reason).toBe('idle')
    expect(calls).toBe(2)
    expect(h.computations).toBe(0)
    expect(h.run.snapshot().resources['received' as never]?.quantity).toBe('1')
  } finally { await h.close() }
})

it.each([false, true])('stops on canonical cancellation before more task input (already assigned=%s)', async (assigned) => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    if (assigned) {
      vi.spyOn(h.connection, 'executeTaskDecision').mockRejectedValueOnce(new Error('before-input'))
      await expect(h.executor.advance()).rejects.toThrow('before-input')
    }
    const executor = new SimulationTaskExecutor(h.run, h.connection, h.config, { ...h.options, readTask: async (request) => {
      const task = await h.options.readTask(request)
      return { ...task, cancellation: teamTaskCancellationSnapshotSchema.parse({ requestedRevision: task.revision,
        requestedBy: h.run.snapshot().entities[h.config.routes[0]!.entityId]!.binding!.participantId, requestedAt: 1,
        target: task.lease === undefined ? { kind: 'pending' } : { kind: 'attempt', attemptId: task.lease.attemptId,
          participantId: task.lease.participantId, activationId: task.lease.activationId },
      }) }
    } })
    expect((await executor.advance()).reason).toBe('task-blocked')
    expect(h.computations).toBe(0)
    expect(Object.values(h.run.snapshot().taskExecutions ?? {})).toHaveLength(assigned ? 1 : 0)
  } finally { await h.close() }
})

it('requires the scene callback at construction and filters a route to its exact original creation', async () => {
  const h = await taskExecutorFixture()
  try {
    expect(() => new SimulationTaskExecutor(h.run, h.connection, { ...h.config, retry: 'scene' }, h.options))
      .toThrow('trusted recovery policy')
    await h.start()
    const first = await h.createTask(), second = await h.createTask()
    const executor = new SimulationTaskExecutor(h.run, h.connection, { ...h.config,
      routes: [{ ...h.config.routes[0]!, operationId: second.id }] }, h.options)
    expect((await executor.advance()).reason).toBe('idle')
    expect(Object.values(h.run.snapshot().taskExecutions!)[0]?.request.operationId).toBe(second.id)
    expect(h.run.snapshot().operations[first.id]?.outbox?.taskReceipt).toBeDefined()
  } finally { await h.close() }
})

it.each(['before-effects', 'scene'] as const)('automatically replaces a physically retired attempt before effects (%s)', async (retry) => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    vi.spyOn(h.connection, 'executeTaskDecision').mockRejectedValueOnce(new Error('before-input'))
    await expect(h.executor.advance()).rejects.toThrow('before-input')
    await h.connection.hibernate(h.config.routes[0]!.entityId)
    const executor = new SimulationTaskExecutor(h.run, h.connection, { ...h.config, retry }, { ...h.options,
      recover: () => 'retry' })
    expect((await executor.advance()).reason).toBe('idle')
    const executions = Object.values(h.run.snapshot().taskExecutions!)
    expect(executions).toHaveLength(2)
    expect(executions[0]?.retired).toBeDefined()
    expect(executions[1]?.task?.phase).toBe('completed')
    expect(executions[1]?.request.attemptId).not.toBe(executions[0]?.request.attemptId)
    expect(h.computations).toBe(1)
  } finally { await h.close() }
})

it('replaces a retired association whose decision was never opened', async () => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    const associate = h.run.associateTaskDecision.bind(h.run)
    vi.spyOn(h.run, 'associateTaskDecision').mockImplementationOnce(loseResponse(associate))
    await expect(h.executor.advance()).rejects.toThrow('response-lost')
    await h.connection.hibernate(h.config.routes[0]!.entityId)
    const executor = new SimulationTaskExecutor(h.run, h.connection, { ...h.config, retry: 'before-effects' }, h.options)
    expect((await executor.advance()).reason).toBe('idle')
    expect(h.computations).toBe(1)
  } finally { await h.close() }
})

it('does not reserve task work when a newly resident writer is retired before its caller observes it', async () => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    const resident = h.connection.ensureResident.bind(h.connection)
    vi.spyOn(h.connection, 'ensureResident').mockImplementationOnce(async (...args) => {
      const result = await resident(...args)
      await h.connection.hibernate(args[0])
      return result
    })
    expect((await h.executor.advance()).reason).toBe('recovery-required')
    expect(h.run.snapshot().taskExecutions).toBeUndefined()
    expect(h.computations).toBe(0)
  } finally { await h.close() }
})

it.each(['waiting', 'blocked'] as const)('honors a scene recovery decision to keep the task %s', async (selection) => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    vi.spyOn(h.connection, 'executeTaskDecision').mockRejectedValueOnce(new Error('before-input'))
    await expect(h.executor.advance()).rejects.toThrow('before-input')
    await h.connection.hibernate(h.config.routes[0]!.entityId)
    const recover = vi.fn<NonNullable<SimulationTaskExecutorOptions['recover']>>((state, attempts) => {
      expect(Object.isFrozen(state)).toBe(true); expect(Object.isFrozen(attempts)).toBe(true); return selection
    })
    const executor = new SimulationTaskExecutor(h.run, h.connection, { ...h.config, retry: 'scene' }, { ...h.options, recover })
    expect((await executor.advance()).reason).toBe(selection === 'waiting' ? 'task-waiting' : 'task-blocked')
    expect(recover).toHaveBeenCalledOnce()
    expect(h.computations).toBe(0)
  } finally { await h.close() }
})

it.each(['pause', 'retry', 'outcome-unknown', 'decision-required', 'until'] as const)
('reconciles old accepted effects and preserves the %s stop before a replacement', async (stop) => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    const execute = h.connection.executeTaskDecision.bind(h.connection)
    vi.spyOn(h.connection, 'executeTaskDecision').mockImplementationOnce(async (...args) => {
      await execute(...args); throw new Error('decision-response-lost')
    })
    await expect(h.executor.advance()).rejects.toThrow('decision-response-lost')
    await h.connection.hibernate(h.config.routes[0]!.entityId)
    const drive = h.connection.driveResident.bind(h.connection)
    vi.spyOn(h.connection, 'driveResident').mockImplementationOnce(async (...args) => {
      const result = await drive(...args)
      if (stop === 'pause') await h.run.setPhase('paused', h.run.snapshot().revision)
      return { ...result, reason: stop === 'pause' ? 'paused' : stop, ...stop === 'retry' ? { nextAttemptAt: 1234 } : {} }
    })
    const executor = new SimulationTaskExecutor(h.run, h.connection, { ...h.config, retry: 'before-effects' }, h.options)
    const result = await executor.advance()
    expect(result.reason).toBe(stop === 'pause' ? 'paused' : stop === 'until' || stop === 'decision-required' ? 'task-blocked' : stop)
    if (stop === 'retry') expect(result.nextAttemptAt).toBe(1234)
    expect(h.computations).toBe(1)
    expect(Object.values(h.run.snapshot().taskExecutions!)).toHaveLength(1)
    expect(h.run.snapshot().resources['received' as never]?.quantity).toBe('1')
  } finally { await h.close() }
})

it('stops new assignment when pause arrives during the task read', async () => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    const executor = new SimulationTaskExecutor(h.run, h.connection, h.config, { ...h.options, readTask: async (request) => {
      const task = await h.options.readTask(request)
      await h.run.setPhase('paused', h.run.snapshot().revision)
      return task
    } })
    expect((await executor.advance()).reason).toBe('paused')
    expect(h.run.snapshot().taskExecutions).toBeUndefined()
    expect(h.computations).toBe(0)
  } finally { await h.close() }
})

it('leaves unmet completion evidence waiting without repeating cognition', async () => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    h.removeCompletion()
    h.ctx.simulationTeams.registerTaskCompletionPolicy({ ...h.config.routes[0]!.completion,
      evaluate: () => ({ status: 'waiting', reason: 'Additional scenario evidence is required' }) })
    expect((await h.executor.advance()).reason).toBe('task-waiting')
    expect((await h.executor.advance()).reason).toBe('task-waiting')
    expect(h.computations).toBe(1)
    expect(h.run.snapshot().resources['received' as never]?.quantity).toBe('1')
  } finally { await h.close() }
})
