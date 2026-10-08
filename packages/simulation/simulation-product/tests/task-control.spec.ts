/** Product cancellation uses actual scoped canonical operations and remains recoverable by its original command. */
import { afterEach, expect, it, vi } from 'vitest'
import { ownerFixture } from './company-owner-fixture.ts'
import { companyConfig } from './company-driver-fixture.ts'
import { simulationCompanyDriverSchema } from '../src/company-driver.ts'
import { simulationProductTaskCancelInputSchema } from '../src/task-control-schema.ts'
import { call } from './fixtures.ts'
import { simulationProductCheckpointInputSchema } from '../src/maintenance-schema.ts'
import { simulationProductTaskReviewResolveInputSchema } from '../src/review-schema.ts'
import type { Context } from '@clocky/cordis'
import { SimulationCompanyOwner } from '../src/company-owner.ts'

afterEach(() => { vi.restoreAllMocks() })
const driver = simulationCompanyDriverSchema.parse({ ...companyConfig, scenario: { kind: 'task-workflow', version: '1', steps: [
  { id: 'report', sourceEntityId: 'buyer', entityId: 'buyer', recipientEntityId: 'supplier', channelKey: 'purchase',
    reviewerEntityId: 'supplier', subject: 'Private task subject', description: 'Private task instructions', text: 'Private report body',
    cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 2, retry: 'before-effects' },
] } })

it('pages two canonical workflow tasks without exposing another task body', async () => {
  const first = driver.scenario?.steps[0]
  if (first === undefined) throw new Error('Workflow fixture has no first report step')
  const twoSteps = simulationCompanyDriverSchema.parse({ ...driver, scenario: { ...driver.scenario,
    steps: [first, { ...first, id: 'follow-up', subject: 'Second report', description: 'Second private instruction' }] } })
  const limits: { maxReviewPageSize: number; maxBytes?: number } = { maxReviewPageSize: 2 }
  const h = await ownerFixture('json', limits, twoSteps)
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    await service.manage({ runId, managementId: 'two-task-start' as never, phase: 'running' }, call())
    const review = await vi.waitFor(async () => {
      const item = (await service.listTaskReviews({ runId }, call())).items.find(value => value.action.allowed)
      if (item === undefined) throw new Error('First workflow task has no review')
      return item
    }, { timeout: 5000 })
    const resolve = simulationProductTaskReviewResolveInputSchema.parse({ runId, commandId: 'approve-first',
      operationId: review.operationId, attemptId: review.attemptId, expectedRevision: review.taskRevision,
      nextPhase: 'completed', reason: 'Advance to the next task' })
    await service.resolveTaskReview(resolve, call())
    await h.finished(resolve.commandId)
    await vi.waitFor(async () => {
      const page = await service.listTasks({ runId }, call())
      if (page.total !== 2) throw new Error('Second workflow task has not been created')
    }, { timeout: 5000 })
    const page = await service.listTasks({ runId, limit: 1 }, call())
    expect(page.total).toBe(2)
    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toBeDefined()
    const next = await service.listTasks({ runId, limit: 1, cursor: page.nextCursor }, call())
    expect(next.items).toHaveLength(1)
    expect(next.items[0]?.taskId).not.toBe(page.items[0]?.taskId)
    expect(next.nextCursor).toBeUndefined()
    expect(JSON.stringify([page, next])).not.toContain('private instruction')
    const reviewPage = await vi.waitFor(async () => {
      const result = await service.listTaskReviews({ runId, limit: 1 }, call())
      if (result.total !== 2) throw new Error('Second review task is not yet materialized')
      return result
    }, { timeout: 5000, interval: 5 })
    expect(reviewPage.total).toBe(2)
    expect(reviewPage.nextCursor).toBeDefined()
    const nextReview = await service.listTaskReviews({ runId, limit: 1, cursor: reviewPage.nextCursor }, call())
    expect(nextReview.items).toHaveLength(1)
    expect(nextReview.items[0]?.operationId).not.toBe(reviewPage.items[0]?.operationId)
    await h.fiber.dispose(); const coldFiber = h.mount(); await coldFiber
    const cold = h.ctx.simulationAdministration
    const completeTasks = await cold.listTasks({ runId, limit: 2 }, call())
    const completeReviews = await cold.listTaskReviews({ runId, limit: 2 }, call())
    const singleReviews = await cold.listTaskReviews({ runId, limit: 1 }, call())
    const singleReviewBytes = Buffer.byteLength(JSON.stringify(singleReviews))
    const completeReviewBytes = Buffer.byteLength(JSON.stringify(completeReviews))
    if (singleReviewBytes >= completeReviewBytes) throw new Error('Two review rows must exceed one bounded page')
    await coldFiber.dispose(); limits.maxBytes = singleReviewBytes; const boundedFiber = h.mount(); await boundedFiber
    const bounded = h.ctx.simulationAdministration
    const boundedReviews = await bounded.listTaskReviews({ runId, limit: 2 }, call())
    expect(boundedReviews.items).toHaveLength(1)
    expect(boundedReviews.nextCursor).toBeDefined()
    await boundedFiber.dispose(); limits.maxBytes = Buffer.byteLength(JSON.stringify(completeTasks)) - 1; await h.mount()
    await expect(h.ctx.simulationAdministration.listTasks({ runId, limit: 2 }, call()))
      .rejects.toThrow('complete byte allowance')
  } finally { await h.close() }
})

it('retains a non-null exact attempt fence in task cancellation input', () => {
  const input = { runId: 'run', commandId: 'cancel-attempt', operationId: 'operation', expectedRevision: 1,
    expectedAttemptId: 'attempt', reason: 'Cancel the observed attempt' }
  expect(simulationProductTaskCancelInputSchema.parse(input).expectedAttemptId).toBe('attempt')
  expect(simulationProductTaskCancelInputSchema.safeParse({ ...input, expectedAttemptId: '' }).success).toBe(false)
})

it.each(['json', 'sqlite'] as const)('cancels a reviewed report through its original product command without reverting its effect (%s)', async (backend) => {
  const h = await ownerFixture(backend, {}, driver)
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    await service.manage({ runId, managementId: 'task-control-start' as never, phase: 'running' }, call())
    const row = await vi.waitFor(async () => {
      const result = await service.listTaskReviews({ runId }, call())
      const item = result.items.find(item => item.action.allowed)
      if (item === undefined) throw new Error('Real reviewed attempt is not ready')
      return item
    }, { timeout: 3000, interval: 5 })
    await service.manage({ runId, managementId: 'task-control-pause' as never, phase: 'paused' }, call())
    const unavailableReader = vi.spyOn(h.ctx.teams, 'getTask').mockRejectedValue(new Error('Private Team reader failure'))
    await expect(service.listTasks({ runId }, call())).rejects.toThrow('Canonical Simulation task metadata is unavailable')
    unavailableReader.mockRestore()
    const getTask = h.ctx.teams.getTask.bind(h.ctx.teams)
    const wrongTask = vi.spyOn(h.ctx.teams, 'getTask').mockImplementationOnce(async request => ({
      ...await getTask(request), id: 'other-task' as never,
    }))
    await expect(service.listTasks({ runId }, call())).rejects.toThrow('Canonical task has another Simulation source')
    wrongTask.mockRestore()
    const controls = await service.listTasks({ runId, limit: 1 }, call())
    expect(controls.total).toBe(1)
    expect(controls.items[0]).toMatchObject({ operationId: row.operationId, taskId: row.taskId, phase: 'review', expectedAttemptId: null,
      cancel: { allowed: true, reason: 'ready' } })
    await expect(service.listTasks({ runId, expectedRevision: controls.snapshotRevision + 1 }, call()))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    await expect(service.listTasks({ runId, limit: 10_000 }, call()))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
    await expect(service.listTasks({ runId, cursor: 'tampered' as never }, call()))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    expect(JSON.stringify(controls)).not.toContain('Private')
    const before = h.owned().snapshot()
    const beforeTask = await h.ctx.teams.getTask({ teamId: row.teamId, taskId: row.taskId })
    const input = simulationProductTaskCancelInputSchema.parse({ runId, commandId: 'cancel-exact-report', operationId: row.operationId,
      expectedRevision: controls.items[0]!.taskRevision, expectedAttemptId: null, reason: 'Cancel this reviewed report' })
    await service.cancelTask(input, call())
    const terminal = await h.finished(input.commandId)
    expect(terminal).toMatchObject({ status: 'completed', kind: 'cancel-task' })
    const task = await h.ctx.teams.getTask({ teamId: row.teamId, taskId: row.taskId })
    expect(task.phase).toBe('cancelled')
    expect(task.attemptHistory[0]?.outcome.kind).toBe('completed')
    expect(task.cancellation?.target.kind).toBe('review')
    if (task.cancellation === undefined) throw new Error('Canonical cancellation intent is missing')
    const pendingRead = vi.spyOn(h.ctx.teams, 'getTask').mockResolvedValueOnce({ ...beforeTask,
      revision: beforeTask.revision + 1, cancellation: task.cancellation })
    expect((await service.listTasks({ runId }, call())).items[0]).toMatchObject({
      cancellation: { target: 'review' }, cancel: { allowed: false, reason: 'cancellation-pending' },
    })
    pendingRead.mockRestore()
    const after = h.owned().snapshot()
    expect(after.phase).toBe('paused')
    expect(after.resources).toEqual(before.resources)
    expect(Object.keys(after.operations)).toEqual(Object.keys(before.operations))
    expect(h.requests).toEqual([])
    expect(await service.cancelTask(input, call())).toEqual(terminal)
    await expect(service.cancelTask({ ...input, reason: 'Another reason' }, call())).rejects.toThrow()
    expect(await service.request({ commandId: input.commandId }, call())).toEqual({ status: 'found', request: terminal, cancellation: input })
    expect((await service.listTasks({ runId }, call())).items[0]?.cancel.reason).toBe('terminal')
    await h.fiber.dispose(); await h.mount()
    const cold = h.ctx.simulationAdministration, open = vi.spyOn(h.ctx.simulations, 'open').mockClear()
    await expect(cold.cancelTask({ ...input, commandId: 'cold-new-cancel' as never }, call()))
      .rejects.toThrow('explicit owner restore')
    expect((await cold.listTasks({ runId }, call())).items[0]?.cancel.reason).toBe('terminal')
    expect(await cold.retryRequest({ runId, commandId: input.commandId }, call())).toEqual(terminal)
    expect(open).not.toHaveBeenCalled()
  } finally { await h.close() }
})

it('retains definitive stale-revision refusal and denies other owners without exposing task bodies', async () => {
  const h = await ownerFixture('json', {}, driver)
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    await service.manage({ runId, managementId: 'stale-cancel-start' as never, phase: 'running' }, call())
    const row = await vi.waitFor(async () => {
      const page = await service.listTaskReviews({ runId }, call())
      const item = page.items.find(item => item.action.allowed)
      if (item === undefined) throw new Error('Waiting for canonical review')
      return item
    }, { timeout: 3000, interval: 5 })
    await service.manage({ runId, managementId: 'stale-cancel-pause' as never, phase: 'paused' }, call())
    const before = await h.ctx.teams.getTask({ teamId: row.teamId, taskId: row.taskId })
    const request = simulationProductTaskCancelInputSchema.parse({ runId, commandId: 'stale-cancel', operationId: row.operationId,
      expectedRevision: row.taskRevision - 1, expectedAttemptId: null, reason: 'Stale selection' })
    await service.cancelTask(request, call())
    expect(await h.finished(request.commandId)).toMatchObject({ status: 'failed', failure: 'cancel-task-failed' })
    expect(await h.ctx.teams.getTask({ teamId: row.teamId, taskId: row.taskId })).toEqual(before)
    await expect(service.listTasks({ runId }, call(undefined, 'other'))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    await expect(service.cancelTask({ ...request, commandId: 'foreign-cancel' as never }, call(undefined, 'other')))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    await h.fiber.dispose(); await h.mount()
    const cold = h.ctx.simulationAdministration
    const absent = vi.spyOn(h.ctx.simulations, 'inspect').mockResolvedValueOnce(undefined)
    await expect(cold.listTasks({ runId }, call())).rejects.toThrow('task history is not materialized')
    absent.mockRestore()
    const scope = (cold as unknown as { ctx: Context }).ctx
    const getService = scope.get.bind(scope)
    const missingReader = vi.spyOn(scope, 'get').mockImplementation(name => name === 'teams' ? undefined : getService(name) as unknown)
    await expect(cold.listTasks({ runId }, call())).rejects.toThrow('canonical Team reader')
    missingReader.mockRestore()
    expect((await cold.listTasks({ runId }, call())).items[0]?.cancel.reason).toBe('recovery-required')
  } finally { await h.close() }
})

it('retains a cancellation refusal when administration retires before the owner authority check', async () => {
  const h = await ownerFixture('json', {}, driver)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    await service.manage({ runId, managementId: 'retiring-cancel-start' as never, phase: 'running' }, call())
    const row = await vi.waitFor(async () => {
      const item = (await service.listTaskReviews({ runId }, call())).items.find(value => value.action.allowed)
      if (item === undefined) throw new Error('Reviewed task is not ready')
      return item
    }, { timeout: 5000, interval: 5 })
    const input = simulationProductTaskCancelInputSchema.parse({ runId, commandId: 'retiring-cancel',
      operationId: row.operationId, expectedRevision: row.taskRevision, expectedAttemptId: null,
      reason: 'Stop before owner handoff' })
    vi.spyOn(SimulationCompanyOwner.prototype, 'cancelTask').mockImplementationOnce(async (_request, authorize) => {
      entered.resolve(undefined); await release.promise; authorize()
    })
    expect((await service.cancelTask(input, call())).status).toBe('accepted')
    await entered.promise
    const retiring = h.fiber.dispose()
    release.resolve(undefined)
    await retiring; await h.mount()
    expect(await h.ctx.simulationAdministration.request({ commandId: input.commandId }, call()))
      .toMatchObject({ status: 'found', request: { status: 'failed', failure: 'cancel-task-failed' } })
  } finally { release.resolve(undefined); await h.close() }
})

it('reattaches a canonical Team connection to cancel a reviewed task after checkpoint collection', async () => {
  const h = await ownerFixture('json', {}, driver)
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    await service.manage({ runId, managementId: 'checkpoint-cancel-start' as never, phase: 'running' }, call())
    const row = await vi.waitFor(async () => {
      const item = (await service.listTaskReviews({ runId }, call())).items.find(value => value.action.allowed)
      if (item === undefined) throw new Error('Reviewed task is not ready')
      return item
    }, { timeout: 5000 })
    const cut = simulationProductCheckpointInputSchema.parse({ runId, commandId: 'before-cancel-cut' })
    await service.checkpoint(cut, call())
    expect((await h.finished(cut.commandId)).status).toBe('completed')
    const task = await h.ctx.teams.getTask({ teamId: row.teamId, taskId: row.taskId })
    const input = simulationProductTaskCancelInputSchema.parse({ runId, commandId: 'cancel-after-cut',
      operationId: row.operationId, expectedRevision: task.revision, expectedAttemptId: null,
      reason: 'Cancel reviewed task after checkpoint' })
    const attach = vi.spyOn(h.ctx.simulationTeams, 'attach')
    await service.cancelTask(input, call())
    expect(await h.finished(input.commandId)).toMatchObject({ status: 'completed', kind: 'cancel-task' })
    expect(attach).toHaveBeenCalledOnce()
    expect((await h.ctx.teams.getTask({ teamId: row.teamId, taskId: row.taskId })).phase).toBe('cancelled')
  } finally { await h.close() }
})

it('reconciles the original cancellation command after a committed native response is lost', async () => {
  const h = await ownerFixture('json', {}, driver)
  try {
    const attach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
    let connection: import('@clocky/clocky-simulation-team').SimulationTeamConnection | undefined
    vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementation(async (...args) => {
      connection = await attach(...args); return connection
    })
    const runId = await h.create(), service = h.ctx.simulationAdministration
    await service.manage({ runId, managementId: 'lost-cancel-start' as never, phase: 'running' }, call())
    const row = await vi.waitFor(async () => {
      const item = (await service.listTaskReviews({ runId }, call())).items.find(value => value.action.allowed)
      if (item === undefined) throw new Error('Reviewed task is not ready')
      return item
    }, { timeout: 5000 })
    await service.manage({ runId, managementId: 'lost-cancel-pause' as never, phase: 'paused' }, call())
    const input = simulationProductTaskCancelInputSchema.parse({ runId, commandId: 'lost-cancel-response',
      operationId: row.operationId, expectedRevision: row.taskRevision, expectedAttemptId: null,
      reason: 'Retain the original cancellation' })
    if (connection === undefined) throw new Error('Cancellation has no canonical connection')
    const native = connection.cancelTask.bind(connection)
    const lost = vi.spyOn(connection, 'cancelTask').mockImplementationOnce(async (request, authorize) => {
      await native(request, authorize)
      throw new Error('Native cancellation response lost after commit')
    })
    await service.cancelTask(input, call())
    await vi.waitFor(async () => {
      expect((await service.request({ commandId: input.commandId }, call()))).toMatchObject({ status: 'found',
        request: { status: 'accepted' } })
      expect(lost).toHaveBeenCalledOnce()
    })
    lost.mockRestore()
    expect((await h.ctx.teams.getTask({ teamId: row.teamId, taskId: row.taskId })).phase).toBe('cancelled')
    await h.fiber.dispose(); await h.mount()
    const cold = h.ctx.simulationAdministration
    const attachAfterRestart = vi.spyOn(h.ctx.simulationTeams, 'attach').mockClear()
    expect(await cold.request({ commandId: input.commandId }, call())).toMatchObject({ status: 'found',
      request: { status: 'accepted' } })
    expect(attachAfterRestart).not.toHaveBeenCalled()
    await expect(cold.retryRequest({ runId, commandId: input.commandId }, call())).rejects.toThrow('explicit owner restore')
    const restore = { runId, commandId: 'restore-before-cancel-retry' as never,
      checkpointId: `product-initial/${h.input.commandId}` as never }
    await cold.restore(restore, call())
    await h.finished(restore.commandId)
    await cold.retryRequest({ runId, commandId: input.commandId }, call())
    expect(await h.finished(input.commandId)).toMatchObject({ status: 'completed', kind: 'cancel-task' })
  } finally { await h.close() }
}, 30000)

it('drops a task-control read when its caller retires during canonical Team observation', async () => {
  const h = await ownerFixture('json', {}, driver)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    await service.manage({ runId, managementId: 'task-read-start' as never, phase: 'running' }, call())
    await vi.waitFor(async () => {
      expect((await service.listTaskReviews({ runId }, call())).items.some(value => value.action.allowed)).toBe(true)
    }, { timeout: 5000 })
    const read = h.ctx.teams.getTask.bind(h.ctx.teams)
    vi.spyOn(h.ctx.teams, 'getTask').mockImplementationOnce(async (request) => {
      entered.resolve(undefined); await release.promise; return await read(request)
    })
    const caller = new AbortController()
    const pending = service.listTasks({ runId }, call(caller))
    await entered.promise
    caller.abort(); release.resolve(undefined)
    await expect(pending).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
  } finally { release.resolve(undefined); await h.close() }
})
