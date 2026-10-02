/** Ordered cognition and canonical reviewer decisions retain distinct task responsibilities. */
import { expect, it, vi } from 'vitest'
import { simulationEntityIdSchema } from '@clocky/clocky-simulation'
import { SimulationTaskExecutor } from '../src/task-executor.ts'
import type { SimulationTaskExecutorOptions } from '../src/task-executor.ts'
import { taskExecutorFixture } from './task-executor-fixture.ts'

async function twoStepFixture(backend: 'json' | 'sqlite' = 'json', maxDecisionsPerAttempt = 2) {
  const h = await taskExecutorFixture(backend)
  h.removeCompletion()
  h.ctx.simulationTeams.registerTaskCompletionPolicy({ ...h.config.routes[0]!.completion, evaluate(state, execution) {
    const operations = execution.decisions?.flatMap(value => state.decisions[value.request.decisionId]?.operationIds ?? [])
      .filter(id => state.operations[id]?.result?.status === 'applied') ?? []
    return operations.length < 2 ? { status: 'waiting', reason: 'Second delivery is required' }
      : { status: 'result', operations, outcome: { kind: 'completed', result: { summary: 'Delivered two units' } } }
  } })
  const nextDecision = vi.fn<NonNullable<SimulationTaskExecutorOptions['nextDecision']>>((state, execution) => {
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(execution)).toBe(true)
    const policy = h.config.routes[0]!.cognition
    return { kind: 'decision', reason: 'Deliver the second unit', ...policy === undefined ? {} : { policy } }
  })
  const executor = new SimulationTaskExecutor(h.run, h.connection, { ...h.config, maxDecisionsPerAttempt },
    { ...h.options, nextDecision })
  await h.start(); await h.createTask()
  return { ...h, executor, nextDecision }
}

it.each(['json', 'sqlite'] as const)('executes ordered bounded decisions in one actual attempt (%s)', async (backend) => {
  const h = await twoStepFixture(backend)
  try {
    expect((await h.executor.advance()).reason).toBe('work-limit')
    expect((await h.executor.advance()).reason).toBe('idle')
    const state = h.run.snapshot(), execution = Object.values(state.taskExecutions!)[0]!
    expect(execution.task?.phase).toBe('completed')
    expect(execution.request.ordinal).toBe(1)
    expect(execution.decisions).toHaveLength(2)
    expect(execution.decisions![1]!.request.predecessor).toBe(execution.decisions![0]!.request.decisionId)
    expect(execution.decisions!.every(value => value.input !== undefined)).toBe(true)
    expect(state.resources['stock' as never]?.quantity).toBe('0')
    expect(state.resources['received' as never]?.quantity).toBe('2')
    expect(h.nextDecision).toHaveBeenCalledOnce()
    const settled = h.run.snapshot()
    await h.executor.advance()
    expect(h.run.snapshot()).toEqual(settled)
  } finally { await h.close() }
})

it.each(['associate', 'execute'] as const)('reuses the recorded second decision after %s response loss', async (stage) => {
  const h = await twoStepFixture()
  try {
    const associate = h.run.associateTaskDecision.bind(h.run)
    const execute = h.connection.executeTaskDecision.bind(h.connection)
    let lost = false
    if (stage === 'associate') vi.spyOn(h.run, 'associateTaskDecision').mockImplementation(async (request) => {
      const result = await associate(request)
      if (request.predecessor !== null && !lost) { lost = true; throw new Error('second-response-lost') }
      return result
    })
    else vi.spyOn(h.connection, 'executeTaskDecision').mockImplementation(async (request) => {
      const result = await execute(request)
      if (request.predecessor !== null && !lost) { lost = true; throw new Error('second-response-lost') }
      return result
    })
    await expect(h.executor.advance()).rejects.toThrow('second-response-lost')
    h.nextDecision.mockImplementation(() => { throw new Error('Retained decisions must not be reselected') })
    expect((await h.executor.advance()).reason).toBe('idle')
    const state = h.run.snapshot(), execution = Object.values(state.taskExecutions!)[0]!
    expect(execution.decisions).toHaveLength(2)
    expect(execution.task?.phase).toBe('completed')
    expect(state.resources['received' as never]?.quantity).toBe('2')
  } finally { await h.close() }
})

it.each(['waiting', 'blocked', 'limit'] as const)('keeps %s from admitting additional cognition', async (kind) => {
  const h = await twoStepFixture('json', kind === 'limit' ? 1 : 2)
  try {
    if (kind !== 'limit') h.nextDecision.mockReturnValue({ kind })
    expect((await h.executor.advance()).reason).toBe(kind === 'waiting' ? 'task-waiting' : 'task-blocked')
    const state = h.run.snapshot()
    expect(Object.values(state.taskExecutions!)[0]!.decisions).toHaveLength(1)
    expect(state.resources['received' as never]?.quantity).toBe('1')
    await h.executor.advance()
    expect(h.run.snapshot()).toEqual(state)
  } finally { await h.close() }
})

it.each([1, 2])('creates a distinct attempt only for canonical rework within maxAttempts=%s', async (maxAttempts) => {
  const h = await taskExecutorFixture()
  try {
    await h.start()
    const buyer = simulationEntityIdSchema.parse('buyer')
    await h.connection.ensureResident(buyer, h.options.residency(buyer))
    const reviewerId = h.run.snapshot().entities[buyer]!.binding!.participantId
    await h.createTask([], buyer, { reviewPolicy: { kind: 'participant', reviewerId }, maxAttempts })
    expect((await h.executor.advance()).reason).toBe('task-waiting')
    const original = Object.values(h.run.snapshot().taskExecutions!)[0]!
    const intent = original.result
    const task = await h.ctx.teams.getTask({ teamId: original.request.teamId, taskId: original.request.taskId })
    expect(task.phase).toBe('review')
    const team = await h.ctx.teams.getTeam({ teamId: task.teamId })
    const binding = team.activations.find(value => value.activation.participantId === reviewerId)!
    const issuer = h.ctx.teams.openActivationActorProofIssuer(), actor = issuer.issue(binding)
    try {
      await h.ctx.teams.resolveTaskReview({ actor: actor.proof, taskId: task.id, expectedRevision: task.revision,
        nextPhase: 'pending', reason: 'Deliver a second authorized unit' })
    } finally { actor.revoke(); issuer.close() }
    expect((await h.executor.advance()).reason).toBe(maxAttempts === 1 ? 'task-blocked' : 'task-waiting')
    const state = h.run.snapshot(), executions = Object.values(state.taskExecutions!)
    expect(executions).toHaveLength(maxAttempts)
    expect(executions[0]!.result).toEqual(intent)
    expect(state.resources['received' as never]?.quantity).toBe(String(maxAttempts))
    if (maxAttempts === 2) {
      expect(executions[1]!.request.attemptId).not.toBe(original.request.attemptId)
      expect(executions[1]!.request.ordinal).toBe(2)
      expect(executions[1]!.decisions).toHaveLength(1)
      expect(executions[1]!.task?.phase).toBe('review')
      expect(executions[0]!.result?.request.outcome.kind).toBe('completed')
    }
  } finally { await h.close() }
})
