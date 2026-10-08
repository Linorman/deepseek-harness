/** Runtime task proofs reject missing sources and changed writer facts before invoking canonical mutation. */
import { expect, it, vi } from 'vitest'
import { taskAttemptIdSchema } from '@clocky/clocky-team'
import { simulationDecisionIdSchema, simulationEntityIdSchema, simulationOperationIdSchema,
  simulationPolicyRefSchema, simulationWindowIdSchema, simulationWindowRequestSchema } from '@clocky/clocky-simulation'
import { taskExecutorFixture } from '../../simulation-product/tests/task-executor-fixture.ts'
import { companySettings } from '../../simulation-product/tests/company-driver-fixture.ts'
import { validateAcceptedTargets } from '../src/target-references.ts'

async function assignedFixture() {
  const h = await taskExecutorFixture()
  await h.start(); await h.createTask()
  vi.spyOn(h.connection, 'executeTaskDecision').mockRejectedValueOnce(new Error('before-input'))
  await expect(h.executor.advance()).rejects.toThrow('before-input')
  const authority = h.ctx.simulationTeams['taskAuthority']
  if (authority === undefined) throw new Error('Assignment did not create its runtime proof owner')
  const execution = Object.values(h.run.snapshot().taskExecutions!)[0]!
  return { ...h, authority, execution }
}

it.each(['uninitialized', 'missing', 'operation', 'creator', 'writer'] as const)
('refuses assignment when its retained %s source is unavailable', async (fault) => {
  const h = await assignedFixture()
  try {
    const state = h.run.snapshot(), request = h.execution.request
    const entity = state.entities[request.entityId]!
    const { taskExecutions: _taskExecutions, ...uninitialized } = state
    const changed = fault === 'uninitialized' ? uninitialized
      : fault === 'missing' ? { ...state, taskExecutions: {} }
        : fault === 'operation' ? { ...state, operations: {} }
          : fault === 'creator' ? { ...state, entities: {} }
            : { ...state, entities: { ...state.entities, [entity.id]: { ...entity, writer: { ...entity.writer!, phase: 'released' as const } } } }
    vi.spyOn(h.run, 'snapshot').mockReturnValue(changed)
    const write = vi.spyOn(h.ctx.teams, 'assignSimulationTask')
    await expect(h.authority.assign(h.run, request.attemptId, companySettings.ownerName, () => true))
      .rejects.toThrow('current reserved writer')
    expect(write).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  } finally { await h.close() }
})

it('requires an original attempt, retained input and result before task start or settlement', async () => {
  const h = await assignedFixture()
  try {
    const id = simulationDecisionIdSchema.parse('not-prepared'), missing = taskAttemptIdSchema.parse('not-reserved')
    await expect(h.authority.start(h.run, missing, id, companySettings.ownerName, () => true)).rejects.toThrow('no reserved attempt')
    await expect(h.authority.start(h.run, h.execution.request.attemptId, id, companySettings.ownerName, () => true))
      .rejects.toThrow('durable input and current writer')
    const state = h.run.snapshot()
    vi.spyOn(h.run, 'snapshot').mockReturnValue({ ...state, operations: {} })
    await expect(h.authority.start(h.run, h.execution.request.attemptId, id, companySettings.ownerName, () => true))
      .rejects.toThrow('durable input and current writer')
    vi.restoreAllMocks()
    await expect(h.authority.settle(h.run, missing, companySettings.ownerName, () => true)).rejects.toThrow('no retained result')
    await expect(h.authority.settle(h.run, h.execution.request.attemptId, companySettings.ownerName, () => true))
      .rejects.toThrow('no retained result')
  } finally { await h.close() }
})

it('makes the original task-start proof nonserializable and releases it after the Hub call', async () => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    const start = h.ctx.teams.startSimulationTaskAttempt.bind(h.ctx.teams)
    let captured: Parameters<typeof start>[0] | undefined
    vi.spyOn(h.ctx.teams, 'startSimulationTaskAttempt').mockImplementationOnce(async (request) => {
      captured = request
      expect(() => JSON.stringify(request.actor)).toThrow('runtime-only')
      return await start(request)
    })
    expect((await h.executor.advance()).reason).toBe('idle')
    if (captured === undefined) throw new Error('Start proof not observed')
    await expect(start(captured)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  } finally { await h.close() }
})

it('refuses task-start authority when its connection retires after durable input', async () => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask()
    const start = h.ctx.teams.startSimulationTaskAttempt.bind(h.ctx.teams)
    let closing: Promise<void> | undefined
    vi.spyOn(h.ctx.teams, 'startSimulationTaskAttempt').mockImplementationOnce(async (request) => {
      closing = h.connection.close()
      return await start(request)
    })
    await expect(h.executor.advance()).rejects.toThrow(/task start|cancellation|connection|proof/i)
    await closing
    expect(Object.values(h.run.snapshot().taskExecutions ?? {}).some(value => value.task?.phase === 'running')).toBe(false)
  } finally { await h.close() }
})

it('refuses settlement when a retained result loses its accepted creation source', async () => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask(); await h.executor.advance()
    const state = h.run.snapshot(), execution = Object.values(state.taskExecutions!)[0]!
    const authority = h.ctx.simulationTeams['taskAuthority']
    if (authority === undefined) throw new Error('Result has no runtime proof owner')
    vi.spyOn(h.run, 'snapshot').mockReturnValue({ ...state, operations: {} })
    await expect(authority.settle(h.run, execution.request.attemptId, companySettings.ownerName, () => true))
      .rejects.toThrow('current result writer')
    vi.restoreAllMocks()
  } finally { await h.close() }
})

it('rejects a second applied creation referencing another operation’s canonical task', async () => {
  const h = await assignedFixture()
  try {
    const state = h.run.snapshot(), operation = state.operations[h.execution.request.operationId]!
    const id = simulationOperationIdSchema.parse('another-accepted-creation')
    const team = await h.ctx.teams.getTeam({ teamId: h.execution.request.teamId })
    await expect(validateAcceptedTargets(h.ctx, { ...state, operations: { ...state.operations,
      [id]: { ...operation, id } } }, [], team.tasks, team.activations, () => {}))
      .rejects.toThrow('differs from its retained creation')
  } finally { await h.close() }
})

it('cancels only the exact accepted creation and live attempt under current admission', async () => {
  const h = await assignedFixture()
  try {
    const request = h.execution.request
    const task = await h.ctx.teams.getTask({ teamId: request.teamId, taskId: request.taskId })
    const selection = { operationId: request.operationId, expectedRevision: task.revision,
      expectedAttemptId: request.attemptId }
    await expect(h.authority.cancel(h.run, companySettings.ownerName,
      { ...selection, operationId: simulationOperationIdSchema.parse('foreign') }, () => true))
      .rejects.toThrow('exact accepted creation')
    await expect(h.authority.cancel(h.run, companySettings.ownerName,
      { ...selection, expectedAttemptId: taskAttemptIdSchema.parse('foreign') }, () => true))
      .rejects.toThrow('cancellation admission is unavailable')
    await expect(h.authority.cancel(h.run, companySettings.ownerName, selection, () => false))
      .rejects.toThrow('cancellation admission is unavailable')
    const cancel = h.ctx.teams.cancelRuntimeTask.bind(h.ctx.teams)
    let proofRequest: Parameters<typeof cancel>[0] | undefined
    vi.spyOn(h.ctx.teams, 'cancelRuntimeTask').mockImplementationOnce(async (input) => {
      proofRequest = input
      expect(() => JSON.stringify(input.actor)).toThrow('runtime-only')
      return await cancel(input)
    })
    const cancelled = await h.authority.cancel(h.run, companySettings.ownerName, selection, () => true)
    expect(cancelled.cancellation).toBeDefined()
    expect(h.run.snapshot().taskCancellations?.[selection.operationId]?.request.cancellation).toEqual(cancelled.cancellation)
    if (proofRequest === undefined) throw new Error('Cancellation proof was not observed')
    await expect(cancel(proofRequest)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(h.authority.assign(h.run, request.attemptId, companySettings.ownerName, () => true))
      .rejects.toThrow('current reserved writer')
    await expect(h.authority.start(h.run, request.attemptId, simulationDecisionIdSchema.parse('after-cancellation'),
      companySettings.ownerName, () => true)).rejects.toThrow('durable input and current writer')
  } finally { await h.close() }
})

it('releases a failed connection cancellation so the exact original attempt can be retried', async () => {
  const h = await assignedFixture()
  try {
    const request = h.execution.request
    const task = await h.ctx.teams.getTask({ teamId: request.teamId, taskId: request.taskId })
    const selection = { operationId: request.operationId, expectedRevision: task.revision,
      expectedAttemptId: request.attemptId }
    vi.spyOn(h.ctx.teams, 'cancelRuntimeTask').mockRejectedValueOnce(new Error('Team cancellation store unavailable'))
    await expect(h.connection.cancelTask(selection)).rejects.toThrow('Team cancellation store unavailable')
    expect(h.run.snapshot().taskCancellations?.[request.operationId]).toBeUndefined()
    const cancelled = await h.connection.cancelTask(selection)
    expect(cancelled.cancellation).toBeDefined()
    expect(h.run.snapshot().taskCancellations?.[request.operationId]).toBeDefined()
  } finally { await h.close() }
})

it('rejects cancellation when caller authorization is revoked after initial admission', async () => {
  const h = await assignedFixture()
  try {
    const request = h.execution.request
    const task = await h.ctx.teams.getTask({ teamId: request.teamId, taskId: request.taskId })
    const selection = { operationId: request.operationId, expectedRevision: task.revision,
      expectedAttemptId: request.attemptId }
    let checks = 0
    const authorize = () => { if (++checks > 1) throw new Error('caller authorization expired') }
    await expect(h.connection.cancelTask(selection, authorize)).rejects.toThrow('cancellation admission is unavailable')
    expect(checks).toBeGreaterThan(1)
    expect(h.run.snapshot().taskCancellations?.[request.operationId]).toBeUndefined()
  } finally { await h.close() }
})

it('keeps cancellation canonical after the original writer has hibernated', async () => {
  const h = await assignedFixture()
  try {
    const request = h.execution.request
    const task = await h.ctx.teams.getTask({ teamId: request.teamId, taskId: request.taskId })
    const selection = { operationId: request.operationId, expectedRevision: task.revision,
      expectedAttemptId: request.attemptId }
    const cancel = h.ctx.teams.cancelRuntimeTask.bind(h.ctx.teams)
    vi.spyOn(h.ctx.teams, 'cancelRuntimeTask').mockImplementationOnce(async (input) => {
      const accepted = await cancel(input)
      await h.connection.hibernate(request.entityId)
      return accepted
    })
    const cancelled = await h.connection.cancelTask(selection)
    expect(cancelled.cancellation).toBeDefined()
    expect(h.run.snapshot().taskCancellations?.[request.operationId]).toBeDefined()
  } finally { await h.close() }
})

it('rejects contradictory post-cancellation Team attempt evidence after canonical intent commits', async () => {
  const h = await assignedFixture()
  try {
    const request = h.execution.request
    const task = await h.ctx.teams.getTask({ teamId: request.teamId, taskId: request.taskId })
    const selection = { operationId: request.operationId, expectedRevision: task.revision,
      expectedAttemptId: request.attemptId }
    const cancel = h.ctx.teams.cancelRuntimeTask.bind(h.ctx.teams)
    const read = h.ctx.teams.getTask.bind(h.ctx.teams)
    let reader: { mockRestore(): void } | undefined
    vi.spyOn(h.ctx.teams, 'cancelRuntimeTask').mockImplementationOnce(async (input) => {
      const accepted = await cancel(input)
      reader = vi.spyOn(h.ctx.teams, 'getTask').mockImplementationOnce(async (query) => {
        const current = await read(query), latest = current.attemptHistory.at(-1)
        if (latest === undefined) throw new Error('Cancelled task has no settled attempt')
        return { ...current, attemptHistory: [...current.attemptHistory.slice(0, -1),
          { ...latest, id: taskAttemptIdSchema.parse('foreign-cancelled-attempt') }] }
      })
      return accepted
    })
    await expect(h.connection.cancelTask(selection)).rejects.toThrow('observation differs from its reserved attempt')
    reader?.mockRestore()
    expect(h.run.snapshot().taskCancellations?.[selection.operationId]).toBeDefined()
    expect((await read({ teamId: request.teamId, taskId: request.taskId })).phase).toBe('cancelled')
  } finally { await h.close() }
})

it('rejects a task decision when the canonical Team lease no longer names its original attempt', async () => {
  const h = await assignedFixture()
  try {
    const request = h.execution.request
    const getTeam = h.ctx.teams.getTeam.bind(h.ctx.teams)
    const changed = vi.spyOn(h.ctx.teams, 'getTeam').mockImplementation(async (query) => {
      const team = await getTeam(query)
      return { ...team, tasks: team.tasks.map(task => task.id !== request.taskId || task.lease === undefined ? task : {
        ...task, lease: { ...task.lease,
          attemptId: taskAttemptIdSchema.parse('foreign-live-attempt'),
        },
      }) }
    })
    await expect(h.executor.advance()).rejects.toThrow('no longer owns its live attempt')
    changed.mockRestore()
    expect(h.computations).toBe(0)
  } finally { await h.close() }
})

it('commits the cancelled writer decision window after exact task cancellation', async () => {
  const h = await assignedFixture()
  try {
    const { simulationWindowRequestSchema, simulationWindowIdSchema } = await import('@clocky/clocky-simulation')
    const { contextRequest } = await import('../../simulation-local/tests/context-fixture.ts')
    const request = h.execution.request
    const windowId = simulationWindowIdSchema.parse('unrelated-cancellation-window')
    await h.run.openWindow(simulationWindowRequestSchema.parse({ id: windowId, decisions: [{
      id: simulationDecisionIdSchema.parse('unrelated-cancellation-decision'), entityId: request.entityId,
      context: contextRequest(),
    }] }), h.run.snapshot().revision)
    const task = await h.ctx.teams.getTask({ teamId: request.teamId, taskId: request.taskId })
    const cancelled = await h.connection.cancelTask({ operationId: request.operationId,
      expectedRevision: task.revision, expectedAttemptId: request.attemptId })
    expect(cancelled.cancellation).toBeDefined()
    expect(h.run.snapshot().activeWindowId).toBeUndefined()
    expect(h.run.snapshot().windows?.[windowId]?.status).toBe('closed')
  } finally { await h.close() }
})

it('closes a mixed accepted and cancelled native window after exact task cancellation', async () => {
  const h = await assignedFixture()
  try {
    const { contextRequest } = await import('../../simulation-local/tests/context-fixture.ts')
    const request = h.execution.request, buyer = simulationEntityIdSchema.parse('buyer')
    const task = await h.ctx.teams.getTask({ teamId: request.teamId, taskId: request.taskId })
    const policy = simulationPolicyRefSchema.parse({ id: 'accepted-before-cancellation', version: '1' })
    h.ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide: () => [] })
    const first = simulationDecisionIdSchema.parse('accepted-before-cancellation')
    const second = simulationDecisionIdSchema.parse('open-before-cancellation')
    const windowId = simulationWindowIdSchema.parse('mixed-cancellation-window')
    await h.run.openWindow(simulationWindowRequestSchema.parse({ id: windowId, decisions: [
      { id: first, entityId: buyer, context: contextRequest(), policy },
      { id: second, entityId: request.entityId, context: contextRequest() },
    ] }), h.run.snapshot().revision)
    await h.connection.executeDeterministicDecision(buyer, first, h.options.context(), policy)
    await h.run.commitWindow(windowId)
    expect(h.run.snapshot().activeWindowId).toBe(windowId)
    expect(h.run.snapshot().decisions[first]?.status).toBe('accepted')
    expect(h.run.snapshot().decisions[second]?.status).toBe('open')
    const cancelled = await h.connection.cancelTask({ operationId: request.operationId,
      expectedRevision: task.revision, expectedAttemptId: request.attemptId })
    expect(cancelled.cancellation).toBeDefined()
    expect(h.run.snapshot().decisions[second]?.status).toBe('cancelled')
    expect(h.run.snapshot().windows?.[windowId]?.status).toBe('closed')
  } finally { await h.close() }
})

it('keeps a terminal task terminal when cancellation arrives after its settled result', async () => {
  const h = await taskExecutorFixture()
  try {
    await h.start(); await h.createTask(); await h.executor.advance()
    const execution = Object.values(h.run.snapshot().taskExecutions!)[0]!
    const authority = h.ctx.simulationTeams['taskAuthority']
    if (authority === undefined) throw new Error('Settled task has no runtime proof owner')
    const task = await h.ctx.teams.getTask({ teamId: execution.request.teamId, taskId: execution.request.taskId })
    expect(task.phase).toBe('completed')
    const result = await authority.cancel(h.run, companySettings.ownerName,
      { operationId: execution.request.operationId, expectedRevision: task.revision, expectedAttemptId: null }, () => true)
    expect(result.phase).toBe('completed')
    expect(result.cancellation).toBeUndefined()
    await expect(h.connection.cancelTask({ operationId: execution.request.operationId,
      expectedRevision: task.revision, expectedAttemptId: execution.request.attemptId })).rejects.toThrow('actor is invalid')
    expect(h.run.snapshot().taskCancellations?.[execution.request.operationId]).toBeUndefined()
  } finally { await h.close() }
})

it('revokes settlement when cancellation wins after a completed result is retained', async () => {
  const h = await taskExecutorFixture()
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  try {
    await h.start(); await h.createTask()
    const settle = h.ctx.teams.settleSimulationTaskAttempt.bind(h.ctx.teams)
    vi.spyOn(h.ctx.teams, 'settleSimulationTaskAttempt').mockImplementationOnce(async (input) => {
      entered.resolve(undefined); await release.promise
      return await settle(input)
    })
    const work = h.executor.advance()
    await entered.promise
    const execution = Object.values(h.run.snapshot().taskExecutions!)[0]!
    expect(execution.result?.request.outcome.kind).toBe('completed')
    const authority = h.ctx.simulationTeams['taskAuthority']
    if (authority === undefined) throw new Error('Completed result has no runtime proof owner')
    const task = await h.ctx.teams.getTask({ teamId: execution.request.teamId, taskId: execution.request.taskId })
    await authority.cancel(h.run, companySettings.ownerName, { operationId: execution.request.operationId,
      expectedRevision: task.revision, expectedAttemptId: execution.request.attemptId }, () => true)
    await expect(authority.settle(h.run, execution.request.attemptId, companySettings.ownerName, () => true))
      .rejects.toThrow('current result writer')
    release.resolve(undefined)
    await work.catch(() => undefined)
  } finally { release.resolve(undefined); await h.close() }
})
