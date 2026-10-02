/** Exact Simulation task cancellation retains canonical work and revocable source authority on both stores. */
import { expect, it } from 'vitest'
import { activationIdSchema, taskAttemptIdSchema, teamSimulationTaskCancelInputSchema, teamSystemTaskControlScopeSchema } from '@clocky/clocky-team'
import type { SimulationTaskCancelScope, TeamSystemTaskControlProof, TeamSimulationTaskCancelInput } from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, task, taskChanged, teamId, teamPhase } from './fixtures.ts'

async function cancellationFixture(backend: 'json' | 'sqlite', assigned = false, review = false, running = false) {
  const member = participant({ id: 'simulation-cancel-creator', role: 'worker' })
  const reviewer = participant({ id: 'simulation-cancel-reviewer', kind: 'human', role: 'human',
    owner: { kind: 'product-principal', principalId: 'simulation-review-principal' } })
  const createdAt = review ? 20 : 16
  const original = task({ id: 'simulation-cancel-task', createdAt, maxAttempts: 2,
    ...review ? { reviewPolicy: { kind: 'participant', reviewerId: reviewer.id } } : {},
    createCommand: { creator: { kind: 'simulation', teamId, participantId: member.id, runId: 'run-cancel', operationId: 'task-operation' },
      idempotencyKey: JSON.stringify(['simulation-task', 'run-cancel', 'task-operation']) } })
  const activationId = activationIdSchema.parse('simulation-cancel-activation'), attemptId = taskAttemptIdSchema.parse('simulation-cancel-attempt')
  const assignedTask = { ...original, revision: 2, phase: 'assigned' as const, attemptCount: 1,
    lease: { attemptId, assignedRevision: 2, ordinal: 1, participantId: member.id, activationId,
      assignedAt: createdAt + 1, durationMs: 60_000, renewedAt: createdAt + 1, expiresAt: createdAt + 60_001 } }
  const runningTask = { ...assignedTask, revision: 3, phase: 'running' as const,
    lease: { ...assignedTask.lease, startedAt: createdAt + 2 } }
  const reviewTask = { ...runningTask, revision: 4, phase: 'review' as const, lease: undefined,
    attemptHistory: [{ id: attemptId, teamId, taskId: original.id, ordinal: 1, participantId: member.id, activationId,
      assignedAt: createdAt + 1, startedAt: createdAt + 2, leaseExpiresAt: createdAt + 60_001, settledAt: createdAt + 3,
      outcome: { kind: 'completed' as const, result: { summary: 'Retained completed review result.' } } }] }
  const records = [createdTeam({ rules: { simulationRunId: 'run-cancel', activationLifecycleOwner: 'simulation/cancel-owner' } }), teamPhase(),
    ...(['invited', 'provisioning', 'active'] as const).map((phase, index) =>
      participantChanged({ participant: { ...member, phase }, createdAt: 12 + index })),
    { type: 'activation/changed', createdAt: 15, binding: { activation: { id: activationId, teamId,
      participantId: member.id, status: 'idle' }, sessionId: SessionId('simulation-cancel-session'), provider: 'in-process' } },
    ...review ? (['invited', 'provisioning', 'active'] as const).map((phase, index) =>
      participantChanged({ participant: { ...reviewer, phase }, createdAt: 16 + index })) : [],
    taskChanged({ task: original, createdAt }),
    ...assigned || review || running ? [taskChanged({ task: assignedTask, createdAt: createdAt + 1 })] : [],
    ...review || running ? [taskChanged({ task: runningTask, createdAt: createdAt + 2 })] : [],
    ...review ? [taskChanged({ task: reviewTask, createdAt: createdAt + 3 })] : []]
  const ctx = await recover(backend, records)
  const input = teamSimulationTaskCancelInputSchema.parse({ teamId, taskId: original.id,
    expectedRevision: review ? 4 : running ? 3 : assigned ? 2 : 1, runId: 'run-cancel', operationId: 'task-operation',
    expectedAttemptId: (assigned || running) && !review ? attemptId : null, reason: 'Stop this exact Simulation task.' })
  let scope = teamSystemTaskControlScopeSchema.parse({ kind: 'simulation-task-cancel', runId: input.runId,
    operationId: input.operationId, creatorId: member.id, lifecycleOwner: 'simulation/cancel-owner', input })
  if (scope.kind !== 'simulation-task-cancel') throw new Error('Cancellation fixture requires its exact source operation')
  let accepting = true
  const proof = Object.freeze({}) as TeamSystemTaskControlProof
  ctx.teams.registerSystemTaskControlProofSource({ name: 'simulation-team',
    resolveTaskControlProof: candidate => accepting && candidate === proof ? scope : undefined })
  return { ctx, input, proof, original, assignedTask, runningTask, reviewTask, attemptId,
    change: (next: SimulationTaskCancelScope) => { scope = next }, revoke: () => { accepting = false } }
}

it.each(['json', 'sqlite'] as const)('retains lease-free cancellation and identical original retries across checkpoint recovery (%s)', async (backend) => {
  const h = await cancellationFixture(backend)
  const first = await h.ctx.teams.cancelRuntimeTask({ actor: h.proof, ...h.input })
  expect(first.phase).toBe('cancelled')
  expect(first.cancellation).toMatchObject({ requestedRevision: 1, target: { kind: 'pending' } })
  const before = await h.ctx.teams.getTeam({ teamId })
  expect(await h.ctx.teams.cancelRuntimeTask({ actor: h.proof, ...h.input })).toEqual(first)
  expect(await h.ctx.teams.getTeam({ teamId })).toEqual(before)
  const journal = h.ctx.storageLog.get(`team/${teamId}`)
  if (journal === undefined) throw new Error('Cancellation journal is missing')
  const records = (await journal.read(-1, 128)).map(entry => entry.value)
  const restored = await recover(backend, records, checkpointFor(records))
  expect(await restored.teams.getTask({ teamId, taskId: h.input.taskId })).toEqual(first)
  expect(first.attemptCount).toBe(0)
  expect(first.maxAttempts).toBe(h.original.maxAttempts)
})

it.each(['json', 'sqlite'] as const)('preserves a running lease until its physical owner settles instead of reporting premature cancellation (%s)', async (backend) => {
  const h = await cancellationFixture(backend, false, false, true)
  const result = await h.ctx.teams.cancelRuntimeTask({ actor: h.proof, ...h.input })
  expect(result.phase).toBe('running')
  expect(result.lease).toEqual(h.runningTask.lease)
  expect(result.cancellation).toMatchObject({ requestedRevision: 3, target: { kind: 'attempt', attemptId: h.attemptId } })
  expect(result.attemptCount).toBe(1)
  expect(result.maxAttempts).toBe(2)
})

it.each(['json', 'sqlite'] as const)('cancels lease-free review while preserving the original result and attempt limits (%s)', async (backend) => {
  const h = await cancellationFixture(backend, false, true)
  const result = await h.ctx.teams.cancelRuntimeTask({ actor: h.proof, ...h.input })
  expect(result.phase).toBe('cancelled')
  expect(result.cancellation).toMatchObject({ requestedRevision: 4, target: { kind: 'review', attemptId: h.attemptId } })
  expect(result.attemptHistory).toEqual(h.reviewTask.attemptHistory)
  expect(result.attemptCount).toBe(1)
  expect(result.maxAttempts).toBe(2)
  expect(await h.ctx.teams.cancelRuntimeTask({ actor: h.proof, ...h.input })).toEqual(result)
})

it.each(['json', 'sqlite'] as const)('retains the exact live attempt and capacity responsibility after cancellation admission (%s)', async (backend) => {
  const h = await cancellationFixture(backend, true)
  const result = await h.ctx.teams.cancelRuntimeTask({ actor: h.proof, ...h.input })
  expect(result.phase).toBe('assigned')
  expect(result.lease).toEqual(h.assignedTask.lease)
  expect(result.cancellation).toMatchObject({ requestedRevision: 2, target: { kind: 'attempt', attemptId: h.attemptId } })
  expect(result.attemptCount).toBe(1)
  expect(result.attemptHistory).toEqual([])
  expect(await h.ctx.teams.cancelRuntimeTask({ actor: h.proof, ...h.input })).toEqual(result)
})

it.each(['run', 'operation', 'task', 'attempt', 'reason'] as const)('rejects a substituted %s before recording cancellation', async (field) => {
  const h = await cancellationFixture('json', true)
  const altered = { ...h.input, ...field === 'run' ? { runId: 'other-run' as never }
    : field === 'operation' ? { operationId: 'other-operation' as never }
      : field === 'task' ? { taskId: 'other-task' as never }
        : field === 'attempt' ? { expectedAttemptId: null } : { reason: 'Changed reason' } }
  const before = await h.ctx.teams.getTeam({ teamId })
  await expect(h.ctx.teams.cancelRuntimeTask({ actor: h.proof, ...altered })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  expect(await h.ctx.teams.getTeam({ teamId })).toEqual(before)
})

it('rejects a source-authorized wrong attempt and rechecks revocation after asynchronous policy before append', async () => {
  const h = await cancellationFixture('json', true)
  const input: TeamSimulationTaskCancelInput = { ...h.input, expectedAttemptId: taskAttemptIdSchema.parse('another-attempt') }
  h.change({ kind: 'simulation-task-cancel', runId: input.runId, operationId: input.operationId,
    creatorId: h.original.createCommand.creator.participantId, lifecycleOwner: 'simulation/cancel-owner', input })
  await expect(h.ctx.teams.cancelRuntimeTask({ actor: h.proof, ...input })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  h.change({ kind: 'simulation-task-cancel', runId: h.input.runId, operationId: h.input.operationId,
    creatorId: h.original.createCommand.creator.participantId, lifecycleOwner: 'simulation/cancel-owner', input: h.input })
  h.ctx.teams.registerPolicy('task-mutate', { name: 'revoke-runtime-task-cancel', async apply(_request, next) {
    const result = await next()
    h.revoke()
    return result
  } })
  const before = await h.ctx.teams.getTeam({ teamId })
  await expect(h.ctx.teams.cancelRuntimeTask({ actor: h.proof, ...h.input })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  expect(await h.ctx.teams.getTeam({ teamId })).toEqual(before)
})

it('rejects missing/ordinary authority and keeps the ordinary task-control entry closed to Simulation source proofs', async () => {
  const h = await cancellationFixture('json')
  await expect(h.ctx.teams.cancelRuntimeTask({ ...h.input, actor: {} as never })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  const { runId: _run, operationId: _operation, expectedAttemptId: _attempt, ...ordinary } = h.input
  await expect(h.ctx.teams.cancelTask({ ...ordinary, actor: h.proof })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  h.revoke()
  await expect(h.ctx.teams.cancelRuntimeTask({ ...h.input, actor: h.proof })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
})
