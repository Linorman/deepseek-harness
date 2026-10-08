/** Exact Simulation task cancellation retains canonical work and revocable source authority on both stores. */
import { expect, it, vi } from 'vitest'
import { activationIdSchema, channelIdSchema, channelManifestSchema, taskAttemptIdSchema, teamEnvelopeSchema,
  teamWorkspaceAllocationIdSchema, teamWorkspaceAllocationSnapshotSchema,
  teamSimulationTaskCancelInputSchema, teamSystemTaskControlScopeSchema,
  teamSystemTaskReviewScopeSchema } from '@clocky/clocky-team'
import type { SimulationTaskCancelScope, TeamSystemTaskControlProof, TeamSimulationTaskCancelInput,
  TeamSystemTaskLeaseProof, TeamSystemTaskLeaseScope, TeamSystemTaskReviewProof,
  TeamSystemTaskReviewScope } from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import { consultChannelAdapter } from '@clocky/clocky-team-channel-basic'
import { RECENT_WINDOW_VIEW_POLICY, directChannelAdapter } from '@clocky/clocky-team-channel-direct'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import type { DurableChannelFixture } from './durable-replay-fixtures.ts'
import { channelAdmissionPrefix } from './durable-channel-fixtures.ts'
import { createdTeam, participant, participantChanged, task, taskChanged, teamId, teamPhase } from './fixtures.ts'

async function cancellationFixture(backend: 'json' | 'sqlite', assigned = false, review = false, running = false,
  consult = false, unreleasedAllocation = false) {
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
  if (unreleasedAllocation) {
    if (!review) throw new Error('Unreleased review allocation requires a settled attempt')
    const reserved = teamWorkspaceAllocationSnapshotSchema.parse({
      id: teamWorkspaceAllocationIdSchema.parse('review-workspace-allocation'), revision: 1, teamId, taskId: original.id,
      attemptId, assignedRevision: assignedTask.revision, participantId: member.id, activationId,
      sessionId: SessionId('simulation-cancel-session'), provider: 'workspace-local', mode: 'shared',
      lifecycle: 'reserved', reservedAt: createdAt + 2, updatedAt: createdAt + 2 })
    const preserved = teamWorkspaceAllocationSnapshotSchema.parse({ ...reserved, revision: 2, lifecycle: 'preserved',
      preservedAt: createdAt + 4, preservationReason: { code: 'PROVIDER_UNAVAILABLE', message: 'Keep the workspace.' },
      updatedAt: createdAt + 4 })
    const reviewRow = records.pop()
    if (reviewRow === undefined) throw new Error('Review fixture omitted its settled task row')
    records.push({ type: 'workspace-allocation/changed', allocation: reserved, createdAt: createdAt + 2 }, reviewRow,
      { type: 'workspace-allocation/changed', allocation: preserved, createdAt: createdAt + 4 })
  }
  const channels: DurableChannelFixture[] = []
  if (consult) {
    if (!review) throw new Error('Review consult requires a settled task attempt')
    const channelId = channelIdSchema.parse('simulation-review-cancellation-channel')
    const manifest = channelManifestSchema.parse({ id: channelId, teamId,
      adapter: { type: 'consult', version: 1 },
      viewPolicy: { type: RECENT_WINDOW_VIEW_POLICY.type, version: RECENT_WINDOW_VIEW_POLICY.version },
      participants: [{ id: member.id, role: 'initiator' }, { id: reviewer.id, role: 'respondent' }], limits: {} })
    const prefix = channelAdmissionPrefix(manifest, createdAt + 5, createdAt + 100, [reviewer.id])
    const envelope = teamEnvelopeSchema.parse({ id: 'simulation-review-cancellation-request', teamId, channelId,
      sequence: prefix.length, senderId: member.id, audience: [reviewer.id], kind: 'review-request',
      payload: { text: 'Review the completed result.', taskId: original.id, attemptId,
        reviewRevision: reviewTask.revision, reviewerId: reviewer.id, initiatorId: member.id,
        result: { summary: 'Retained completed review result.' } },
      delivery: 'turn', priority: 'normal', taskId: original.id, createdAt: createdAt + 6 })
    channels.push({ id: channelId, records: [...prefix, { type: 'channel/envelope', envelope,
      deliveryIntents: [{ participantId: reviewer.id, envelopeId: envelope.id, delivery: 'turn' }] }] })
    records.push({ type: 'channel/attached', channelId, createdAt: createdAt + 4 })
    const unrelatedConsultId = channelIdSchema.parse('unrelated-review-consult')
    const unrelatedConsult = channelManifestSchema.parse({ ...manifest, id: unrelatedConsultId })
    channels.push({ id: unrelatedConsultId,
      records: channelAdmissionPrefix(unrelatedConsult, createdAt + 6, createdAt + 100, [reviewer.id]) })
    records.push({ type: 'channel/attached', channelId: unrelatedConsultId, createdAt: createdAt + 5 })
    const unrelatedDirectId = channelIdSchema.parse('unrelated-review-direct')
    const unrelatedDirect = channelManifestSchema.parse({ id: unrelatedDirectId, teamId,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: member.id, role: 'sender' }, { id: reviewer.id, role: 'recipient' }], limits: {} })
    channels.push({ id: unrelatedDirectId,
      records: channelAdmissionPrefix(unrelatedDirect, createdAt + 7, createdAt + 100, [reviewer.id]) })
    records.push({ type: 'channel/attached', channelId: unrelatedDirectId, createdAt: createdAt + 6 })
    const closedConsultId = channelIdSchema.parse('closed-unrelated-review-consult')
    const closedConsult = channelManifestSchema.parse({ ...manifest, id: closedConsultId })
    const closedPrefix = channelAdmissionPrefix(closedConsult, createdAt + 8, createdAt + 100, [reviewer.id])
    channels.push({ id: closedConsultId, records: [...closedPrefix,
      { type: 'channel/phase', sequence: closedPrefix.length, phase: 'closing', createdAt: createdAt + 9 },
      { type: 'channel/closed', sequence: closedPrefix.length + 1, phase: 'closed', createdAt: createdAt + 10 }] })
    records.push({ type: 'channel/attached', channelId: closedConsultId, createdAt: createdAt + 7 })
  }
  const ctx = await recover(backend, records, undefined, teamId, channels)
  if (consult) {
    ctx.teams.registerAdapter(consultChannelAdapter)
    ctx.teams.registerAdapter(directChannelAdapter)
    ctx.teams.registerViewPolicy(RECENT_WINDOW_VIEW_POLICY)
  }
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

it.each(['json', 'sqlite'] as const)('closes the retained Consult review request before cancelling its lease-free task (%s)', async (backend) => {
  const h = await cancellationFixture(backend, false, true, false, true)
  const channelId = channelIdSchema.parse('simulation-review-cancellation-channel')
  expect((await h.ctx.teams.getChannel({ channelId })).phase).toBe('active')
  const cancelled = await h.ctx.teams.cancelRuntimeTask({ actor: h.proof, ...h.input })
  expect(cancelled.phase).toBe('cancelled')
  expect(cancelled.cancellation?.target).toMatchObject({ kind: 'review', attemptId: h.attemptId })
  expect((await h.ctx.teams.getChannel({ channelId })).phase).toBe('closed')
  expect((await h.ctx.teams.getChannel({ channelId: channelIdSchema.parse('unrelated-review-consult') })).phase).toBe('active')
  expect((await h.ctx.teams.getChannel({ channelId: channelIdSchema.parse('unrelated-review-direct') })).phase).toBe('active')
  expect((await h.ctx.teams.getChannel({ channelId: channelIdSchema.parse('closed-unrelated-review-consult') })).phase).toBe('closed')
  expect((await h.ctx.teams.getTask({ teamId, taskId: h.input.taskId })).attemptHistory)
    .toEqual(h.reviewTask.attemptHistory)
})

it.each(['json', 'sqlite'] as const)('retains review cancellation until an unreleased workspace allocation is cleaned up (%s)', async (backend) => {
  const h = await cancellationFixture(backend, false, true, false, false, true)
  const before = await h.ctx.teams.getTeam({ teamId })
  expect(before.workspaceAllocations[0]?.lifecycle).toBe('preserved')
  const retained = await h.ctx.teams.cancelRuntimeTask({ actor: h.proof, ...h.input })
  expect(retained.phase).toBe('review')
  expect(retained.cancellation?.target).toMatchObject({ kind: 'review', attemptId: h.attemptId })
  expect((await h.ctx.teams.getTeam({ teamId })).workspaceAllocations[0]?.lifecycle).toBe('preserved')
})

it.each(['json', 'sqlite'] as const)('reconciles a durable review cancellation after the final task append fails (%s)', async (backend) => {
  const h = await cancellationFixture(backend, false, true)
  await h.ctx.teams.getTask({ teamId, taskId: h.input.taskId })
  const journal = h.ctx.storageLog.get(`team/${teamId}`)
  if (journal === undefined) throw new Error('Cancellation journal is missing')
  const append = journal.append.bind(journal)
  let writes = 0
  const failure = new Error('final cancellation append unavailable')
  const interrupted = vi.spyOn(journal, 'append').mockImplementation(async (...args) => {
    if (++writes === 2) throw failure
    return await append(...args)
  })
  try {
    await expect(h.ctx.teams.cancelRuntimeTask({ actor: h.proof, ...h.input })).rejects.toBe(failure)
  } finally { interrupted.mockRestore() }
  const retained = await h.ctx.teams.getTask({ teamId, taskId: h.input.taskId })
  expect(retained.phase).toBe('review')
  expect(retained.cancellation?.requestedRevision).toBe(h.input.expectedRevision)
  const input = { teamId, taskId: retained.id, expectedRevision: retained.revision,
    requestedRevision: h.input.expectedRevision }
  const proof = Object.freeze({}) as TeamSystemTaskLeaseProof
  const scopes = new Map<TeamSystemTaskLeaseProof, TeamSystemTaskLeaseScope>([[proof, {
    kind: 'scheduler-task-cancellation-reconcile', ...input,
  }]])
  h.ctx.teams.registerSystemTaskLeaseProofSource({ name: 'team-scheduler-dag',
    resolveTaskLeaseProof: candidate => scopes.get(candidate) })
  await expect(h.ctx.teams.reconcileTaskCancellation({ ...input, requestedRevision: input.requestedRevision - 1,
    actor: proof })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  const cancelled = await h.ctx.teams.reconcileTaskCancellation({ ...input, actor: proof })
  expect(cancelled.phase).toBe('cancelled')
  expect(cancelled.attemptHistory).toEqual(retained.attemptHistory)
  expect(cancelled.cancellation).toEqual(retained.cancellation)
  await expect(h.ctx.teams.reconcileTaskCancellation({ ...input, actor: proof }))
    .rejects.toMatchObject({ code: 'TEAM_TASK_STALE_REVISION' })
  const replay = { ...input, expectedRevision: cancelled.revision }
  const replayProof = Object.freeze({}) as TeamSystemTaskLeaseProof
  scopes.set(replayProof, { kind: 'scheduler-task-cancellation-reconcile', ...replay })
  expect(await h.ctx.teams.reconcileTaskCancellation({ ...replay, actor: replayProof })).toEqual(cancelled)
  const unrelated = { ...replay, requestedRevision: replay.requestedRevision + 1 }
  const unrelatedProof = Object.freeze({}) as TeamSystemTaskLeaseProof
  scopes.set(unrelatedProof, { kind: 'scheduler-task-cancellation-reconcile', ...unrelated })
  await expect(h.ctx.teams.reconcileTaskCancellation({ ...unrelated, actor: unrelatedProof }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  scopes.delete(proof)
  await expect(h.ctx.teams.reconcileTaskCancellation({ ...input, actor: proof }))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
})

it.each(['json', 'sqlite'] as const)('keeps a cancelled task assigned until its live attempt owner settles (%s)', async (backend) => {
  const h = await cancellationFixture(backend, true)
  const retained = await h.ctx.teams.cancelRuntimeTask({ actor: h.proof, ...h.input })
  if (retained.cancellation === undefined) throw new Error('Fixture cancellation was not retained')
  const input = { teamId, taskId: retained.id, expectedRevision: retained.revision,
    requestedRevision: retained.cancellation.requestedRevision }
  const proof = Object.freeze({}) as TeamSystemTaskLeaseProof
  h.ctx.teams.registerSystemTaskLeaseProofSource({ name: 'team-scheduler-dag',
    resolveTaskLeaseProof: candidate => candidate === proof ? { kind: 'scheduler-task-cancellation-reconcile', ...input } : undefined })
  await expect(h.ctx.teams.reconcileTaskCancellation({ ...input, actor: proof }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  expect(await h.ctx.teams.getTask({ teamId, taskId: input.taskId })).toEqual(retained)
})

it.each(['json', 'sqlite'] as const)('accepts one exact native Simulation review and replays its command identity (%s)', async (backend) => {
  const h = await cancellationFixture(backend, false, true)
  const review = await h.ctx.teams.getTask({ teamId, taskId: h.input.taskId })
  const attempt = review.attemptHistory.at(-1)
  if (attempt?.outcome.kind !== 'completed' || review.reviewPolicy.kind !== 'participant') {
    throw new Error('Simulation review fixture requires a completed participant review')
  }
  const scope = teamSystemTaskReviewScopeSchema.parse({ kind: 'simulation-task-review',
    runId: 'run-cancel', commandId: 'review-command-1', operationId: 'task-operation',
    teamId, taskId: review.id, lifecycleOwner: 'simulation/cancel-owner',
    creatorId: 'simulation-cancel-creator', initiatorId: attempt.participantId,
    reviewerId: review.reviewPolicy.reviewerId, reviewerSessionId: SessionId('simulation-review-session'),
    attemptId: attempt.id, expectedRevision: review.revision, nextPhase: 'completed',
    reason: 'The retained result is accepted.', outcome: attempt.outcome,
  })
  if (scope.kind !== 'simulation-task-review') throw new Error('Fixture needs a Simulation review scope')
  const scopes = new Map<TeamSystemTaskReviewProof, TeamSystemTaskReviewScope>()
  h.ctx.teams.registerSystemTaskReviewProofSource({ name: 'simulation-team',
    resolveTaskReviewProof: proof => scopes.get(proof) })
  const actor = Object.freeze({}) as TeamSystemTaskReviewProof
  scopes.set(actor, scope)
  const completed = await h.ctx.teams.resolveSimulationTaskReview({ actor })
  expect(completed.phase).toBe('completed')
  expect(completed.reviewHistory.at(-1)?.simulationCommand).toMatchObject({ commandId: scope.commandId,
    runId: scope.runId, operationId: scope.operationId })
  const beforeRetry = await h.ctx.teams.getTeam({ teamId })
  expect(await h.ctx.teams.resolveSimulationTaskReview({ actor })).toEqual(completed)
  expect(await h.ctx.teams.getTeam({ teamId })).toEqual(beforeRetry)
  const changed = Object.freeze({}) as TeamSystemTaskReviewProof
  scopes.set(changed, { ...scope, nextPhase: 'pending' })
  await expect(h.ctx.teams.resolveSimulationTaskReview({ actor: changed }))
    .rejects.toMatchObject({ code: 'TEAM_TASK_IDEMPOTENCY_CONFLICT' })
  scopes.delete(actor)
  await expect(h.ctx.teams.resolveSimulationTaskReview({ actor }))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
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
