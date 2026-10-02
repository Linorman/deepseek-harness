/** Runtime task proofs reject missing sources and changed writer facts before invoking canonical mutation. */
import { expect, it, vi } from 'vitest'
import { taskAttemptIdSchema } from '@clocky/clocky-team'
import { simulationDecisionIdSchema, simulationOperationIdSchema } from '@clocky/clocky-simulation'
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
