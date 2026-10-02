/** Native administrative review uses original result evidence, exact command retries and live source authority. */
import { expect, it, vi } from 'vitest'
import { simulationEntityIdSchema, simulationChangeSchema } from '@clocky/clocky-simulation'
import { taskExecutorFixture } from '../../simulation-product/tests/task-executor-fixture.ts'
import type { SimulationTaskReviewRequest } from '../src/types.ts'
import { teamProjectionData, teamProjectionFromData } from '@clocky/clocky-team-hub/src/fold.ts'
import { teamProjectionDataSchema } from '@clocky/clocky-team-hub/src/schema.ts'
import type { TeamProjection } from '@clocky/clocky-team-hub/src/types.ts'
import type { TeamId } from '@clocky/clocky-team'

async function reviewFixture(backend: 'json' | 'sqlite' = 'json') {
  const h = await taskExecutorFixture(backend)
  await h.start()
  const buyer = simulationEntityIdSchema.parse('buyer')
  const reviewerId = h.run.snapshot().entities[buyer]!.binding!.participantId
  await h.createTask([], buyer, { reviewPolicy: { kind: 'participant', reviewerId }, maxAttempts: 3 })
  await h.executor.advance()
  const execution = Object.values(h.run.snapshot().taskExecutions!)[0]!
  const task = await h.ctx.teams.getTask({ teamId: execution.request.teamId, taskId: execution.request.taskId })
  expect(task.phase).toBe('review')
  const request: SimulationTaskReviewRequest = { commandId: 'review/first', attemptId: execution.request.attemptId,
    reviewerEntityId: buyer, expectedRevision: task.revision, nextPhase: 'completed', reason: 'Original inventory evidence accepted' }
  return { ...h, buyer, execution, task, request }
}

it.each(['json', 'sqlite'] as const)('reviews while paused without reviewer residency and retains the exact retry on %s', async (backend) => {
  const h = await reviewFixture(backend)
  try {
    await h.connection.hibernate(h.buyer)
    await h.run.setPhase('paused', h.run.snapshot().revision)
    expect(h.ctx.agents.get(h.run.snapshot().entities[h.buyer]!.binding!.sessionId)).toBeUndefined()
    const before = h.computations
    const reviewed = await h.connection.reviewTask(h.request)
    expect(reviewed.phase).toBe('completed')
    expect(reviewed.reviewHistory).toEqual([expect.objectContaining({ attemptId: h.request.attemptId,
      simulationCommand: { runId: h.run.snapshot().spec.runId, commandId: h.request.commandId,
        operationId: h.execution.request.operationId, expectedRevision: h.task.revision } })])
    expect(await h.connection.reviewTask(h.request)).toEqual(reviewed)
    expect(h.computations).toBe(before)
    expect(h.run.snapshot().taskExecutions?.[h.request.attemptId]?.task?.phase).toBe('completed')
    await expect(h.connection.reviewTask({ ...h.request, reason: 'Changed acceptance' }))
      .rejects.toMatchObject({ code: 'TEAM_TASK_IDEMPOTENCY_CONFLICT' })
    await expect(h.connection.reviewTask({ ...h.request, nextPhase: 'pending' }))
      .rejects.toMatchObject({ code: 'TEAM_TASK_IDEMPOTENCY_CONFLICT' })
  } finally { await h.close() }
})

it('keeps an old rework command attached to its first attempt after the next attempt reaches review', async () => {
  const h = await reviewFixture()
  try {
    const request = { ...h.request, nextPhase: 'pending' as const, reason: 'Deliver clearer evidence' }
    expect((await h.connection.reviewTask(request)).phase).toBe('pending')
    await h.executor.advance()
    const next = await h.ctx.teams.getTask({ teamId: h.task.teamId, taskId: h.task.id })
    expect(next.phase).toBe('review')
    expect(next.attemptHistory).toHaveLength(2)
    expect(next.attemptHistory[1]?.id).not.toBe(request.attemptId)
    expect(await h.connection.reviewTask(request)).toEqual(next)
    expect((await h.ctx.teams.getTask({ teamId: next.teamId, taskId: next.id })).reviewHistory).toHaveLength(1)
    await expect(h.connection.reviewTask({ ...request, attemptId: next.attemptHistory[1]!.id,
      expectedRevision: next.revision })).rejects.toMatchObject({ code: 'TEAM_TASK_IDEMPOTENCY_CONFLICT' })
    const accepted = await h.connection.reviewTask({ ...h.request, commandId: 'review/second',
      attemptId: next.attemptHistory[1]!.id, expectedRevision: next.revision })
    expect(accepted.phase).toBe('completed')
    expect(accepted.reviewHistory).toHaveLength(2)
  } finally { await h.close() }
})

it.each(['result', 'source', 'reviewer', 'phase'] as const)('refuses review without its retained %s authority', async (fault) => {
  const h = await reviewFixture()
  try {
    const state = h.run.snapshot(), execution = state.taskExecutions![h.request.attemptId]!
    const changed = fault === 'result' ? { ...state, taskExecutions: { ...state.taskExecutions,
      [h.request.attemptId]: { ...execution, result: undefined } } }
      : fault === 'source' ? { ...state, operations: {} }
        : fault === 'reviewer' ? { ...state, entities: { ...state.entities,
          [h.buyer]: { ...state.entities[h.buyer]!, binding: state.entities[simulationEntityIdSchema.parse('supplier')]!.binding } } }
          : { ...state, phase: 'stalled' as const }
    vi.spyOn(h.run, 'snapshot').mockReturnValue(changed)
    const mutate = vi.spyOn(h.ctx.teams, 'resolveSimulationTaskReview')
    await expect(h.connection.reviewTask(h.request)).rejects.toThrow('original completed result')
    expect(mutate).not.toHaveBeenCalled()
    vi.restoreAllMocks()
    expect((await h.ctx.teams.getTask({ teamId: h.task.teamId, taskId: h.task.id })).phase).toBe('review')
  } finally { vi.restoreAllMocks(); await h.close() }
})

it('rechecks reviewer authority after policy IO and revokes its nonserializable proof after return', async () => {
  const h = await reviewFixture()
  try {
    await h.connection.hibernate(h.buyer)
    const perform = h.ctx.teams.resolveSimulationTaskReview.bind(h.ctx.teams)
    let captured: Parameters<typeof perform>[0] | undefined
    vi.spyOn(h.ctx.teams, 'resolveSimulationTaskReview').mockImplementation(async (request) => {
      captured = request
      expect(() => JSON.stringify(request.actor)).toThrow('runtime-only')
      await expect(h.ctx.teams.resolveTaskReviewFromResponse(request)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      return await perform(request)
    })
    const remove = h.ctx.teams.registerPolicy('task-mutate', { name: 'withdraw-reviewer', async apply(_request, next) {
      const entity = h.run.snapshot().entities[h.buyer]!
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: h.buyer,
        entityRevision: entity.revision, phase: 'inactive' }), h.run.snapshot().revision)
      return await next()
    } })
    await expect(h.connection.reviewTask(h.request)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    remove()
    expect((await h.ctx.teams.getTask({ teamId: h.task.teamId, taskId: h.task.id })).reviewHistory).toEqual([])
    expect(captured).toBeDefined()
    await expect(perform(captured!)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  } finally { vi.restoreAllMocks(); await h.close() }
})

it.each(['checkpoint', 'close'] as const)('withdraws review authority and drains pending policy IO on %s', async (fence) => {
  const h = await reviewFixture()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const remove = h.ctx.teams.registerPolicy('task-mutate', { name: 'hold-review', async apply(_request, next) {
    entered.resolve(undefined)
    await release.promise
    return await next()
  } })
  try {
    const review = h.connection.reviewTask(h.request)
    await entered.promise
    const blocked = fence === 'close' ? h.connection.close() : h.connection.collectCheckpointCandidate(4, 3)
    release.resolve(undefined)
    await expect(review).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const candidate = await blocked
    candidate?.release()
    expect((await h.ctx.teams.getTask({ teamId: h.task.teamId, taskId: h.task.id })).reviewHistory).toEqual([])
  } finally { release.resolve(undefined); remove(); await h.close() }
})

it('rejects stale task revisions and checkpoint or closed connection admission', async () => {
  const h = await reviewFixture()
  try {
    await expect(h.connection.reviewTask({ ...h.request, expectedRevision: h.request.expectedRevision - 1 }))
      .rejects.toMatchObject({ code: 'TEAM_TASK_STALE_REVISION' })
    const candidate = await h.connection.collectCheckpointCandidate(4, 3)
    expect(() => h.connection.reviewTask(h.request)).toThrow('checkpoint collection')
    candidate.release()
    await h.connection.close()
    expect(() => h.connection.reviewTask(h.request)).toThrow('closed')
  } finally { await h.close() }
})

it('retains original command attribution in serialized replay and refuses a different creation or future revision', async () => {
  const h = await reviewFixture()
  try {
    const reviewed = await h.connection.reviewTask(h.request)
    const internals = h.ctx.teams as unknown as { readonly teams: ReadonlyMap<TeamId, { readonly projection: TeamProjection }> }
    const projection = internals.teams.get(h.task.teamId)!.projection
    const data = teamProjectionDataSchema.parse(JSON.parse(JSON.stringify(teamProjectionData(projection))))
    expect(teamProjectionFromData(data).tasks.get(h.task.id)?.reviewHistory).toEqual(reviewed.reviewHistory)
    const original = reviewed.reviewHistory[0]!.simulationCommand!
    for (const changed of [{ ...original, operationId: 'other-operation' }, { ...original, expectedRevision: reviewed.revision + 1 }]) {
      const altered = teamProjectionDataSchema.parse({ ...data, tasks: data.tasks.map(task => task.id !== reviewed.id ? task : {
        ...task, reviewHistory: [{ ...task.reviewHistory[0], simulationCommand: changed }],
      }) })
      expect(() => teamProjectionFromData(altered)).toThrow(/Simulation review command attribution/)
    }
  } finally { await h.close() }
})

it.each(['owner-read', 'policy'] as const)('withdraws the caller admission lease during %s before the review mutation', async (stage) => {
  const h = await reviewFixture()
  let allowed = true
  const authorize = (): void => { if (!allowed) throw new Error('Caller admission retired') }
  let remove: (() => void) | undefined
  try {
    if (stage === 'owner-read') {
      const perform = h.ctx.teams.resolveSimulationTaskReview.bind(h.ctx.teams)
      vi.spyOn(h.ctx.teams, 'resolveSimulationTaskReview').mockImplementationOnce(async (request) => {
        // This await represents an owner lookup before the Hub validates the runtime proof.
        await h.ctx.teams.getTask({ teamId: h.task.teamId, taskId: h.task.id })
        allowed = false
        return await perform(request)
      })
    } else {
      remove = h.ctx.teams.registerPolicy('task-mutate', { name: 'retire-caller-review-lease', async apply(_request, next) {
        await Promise.resolve()
        allowed = false
        return await next()
      } })
    }
    await expect(h.connection.reviewTask(h.request, authorize)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await h.ctx.teams.getTask({ teamId: h.task.teamId, taskId: h.task.id })).reviewHistory).toEqual([])
    expect(() => h.connection.reviewTask(h.request, authorize)).toThrow('Caller admission retired')
  } finally { remove?.(); vi.restoreAllMocks(); await h.close() }
})
