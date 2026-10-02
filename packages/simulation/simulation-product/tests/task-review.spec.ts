import { companyReviewSummary } from '../src/company-review.ts'
/** Original administrative scene review over real canonical actors, journals and held/cold product owners. */
import { afterEach, expect, it, vi } from 'vitest'
import { simulationCompanyDriverSchema } from '../src/company-driver.ts'
import { ownerFixture } from './company-owner-fixture.ts'
import { companyConfig } from './company-driver-fixture.ts'
import { call } from './fixtures.ts'
import { simulationProductTaskReviewResolveInputSchema } from '../src/review-schema.ts'
import { simulationProductManageInputSchema } from '../src/control-schema.ts'

afterEach(() => { vi.restoreAllMocks() })
const driver = simulationCompanyDriverSchema.parse({ ...companyConfig, tasks: { version: '1', cognition: 'deterministic',
  leaseDurationMs: 100000, maxAttempts: 3, retry: 'scene', review: 'buyer' } })
async function pending(h: Awaited<ReturnType<typeof ownerFixture>>, runId: import('../src/types.ts').SimulationProductRunId) {
  await h.ctx.simulationAdministration.manage(simulationProductManageInputSchema.parse({ runId, managementId: 'start', phase: 'running' }), call())
  return await vi.waitFor(async () => {
    const page = await h.ctx.simulationAdministration.listTaskReviews({ runId }, call())
    const item = page.items.find(value => value.action.allowed)
    if (item === undefined) throw new Error('Company review is pending')
    return item
  }, { timeout: 5000, interval: 10 })
}
const intent = (runId: string, item: Awaited<ReturnType<typeof pending>>, commandId = 'original-review', nextPhase: 'pending' | 'completed' = 'completed') =>
  simulationProductTaskReviewResolveInputSchema.parse({ runId, commandId, operationId: item.operationId,
    attemptId: item.attemptId, expectedRevision: item.taskRevision, nextPhase, reason: nextPhase === 'pending' ? 'Revise the report' : 'Approved' })

it.each(['json', 'sqlite'] as const)('retains exact review intent and terminal result, keeps paused phase and inert cold reads (%s)', async (backend) => {
  const h = await ownerFixture(backend, {}, driver)
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    expect((await service.catalog(call())).items[0]?.review).toBe('buyer')
    const item = await pending(h, runId)
    await vi.waitFor(async () => { expect((await service.control({ runId }, call())).stop).toBe('review-required') }, { timeout: 3000 })
    const text = JSON.stringify(await service.listTaskReviews({ runId }, call()))
    expect(text).not.toContain('description'); expect(text).not.toContain('reviewPolicy'); expect(text).not.toContain('resultJSON')
    const modelCount = h.requests.length
    await service.manage(simulationProductManageInputSchema.parse({ runId, managementId: 'pause-review', phase: 'paused' }), call())
    const input = intent(runId, item)
    expect((await service.resolveTaskReview(input, call())).status).toBe('accepted')
    expect((await h.finished(input.commandId)).status).toBe('completed')
    expect(h.requests.length).toBe(modelCount); expect(h.owned().snapshot().phase).toBe('paused')
    const result = await service.request({ commandId: input.commandId }, call())
    expect(result).toMatchObject({ status: 'found', request: { kind: 'review', status: 'completed' }, review: input })
    expect(await service.resolveTaskReview(input, call())).toEqual((result as Extract<typeof result, { status: 'found' }>).request)
    await expect(service.resolveTaskReview({ ...input, reason: 'Changed' }, call())).rejects.toThrow('another original payload')
    await h.fiber.dispose(); const fiber = h.mount(); await fiber
    const open = vi.spyOn(h.ctx.simulations, 'open').mockClear(), attach = vi.spyOn(h.ctx.simulationTeams, 'attach').mockClear()
    expect(await h.ctx.simulationAdministration.request({ commandId: input.commandId }, call())).toEqual(result)
    expect((await h.ctx.simulationAdministration.listTaskReviews({ runId }, call())).items[0]?.action.reason).toBe('recovery-required')
    expect(await h.ctx.simulationAdministration.resolveTaskReview(input, call())).toEqual((result as Extract<typeof result, { status: 'found' }>).request)
    await expect(h.ctx.simulationAdministration.resolveTaskReview({ ...input, commandId: 'cold-new' as never }, call())).rejects.toThrow('explicit restore')
    expect(open).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled(); expect(h.requests.length).toBe(modelCount)
  } finally { await h.close() }
})

it('refuses changed canonical revision and revoked owner after durable acceptance, retaining separate terminal failures', async () => {
  const h = await ownerFixture('json', {}, driver)
  try {
    const runId = await h.create(), item = await pending(h, runId), service = h.ctx.simulationAdministration
    const wrong = { ...intent(runId, item, 'stale-review'), expectedRevision: item.taskRevision - 1 }
    await service.resolveTaskReview(wrong, call())
    expect(await h.finished(wrong.commandId)).toMatchObject({ status: 'failed', failure: 'review-failed' })
    expect((await service.listTaskReviews({ runId }, call())).items[0]?.phase).toBe('review')
    const revoked = new AbortController(); revoked.abort()
    await expect(service.resolveTaskReview(intent(runId, item, 'revoked-review'), call(revoked))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    expect(await service.request({ commandId: 'revoked-review' as never }, call())).toMatchObject({ status: 'not-found' })
    await expect(service.listTaskReviews({ runId, limit: 33 }, call())).rejects.toThrow('page exceeds')
  } finally { await h.close() }
})

it('keeps a committed review with lost terminal publication accepted, explicitly restores and replays its same canonical command', async () => {
  const h = await ownerFixture('json', {}, driver)
  try {
    const runId = await h.create(), item = await pending(h, runId), input = intent(runId, item)
    const { SimulationCreationStore } = await import('../src/creation-store.ts')
    const publication = vi.spyOn(SimulationCreationStore.prototype, 'finish').mockRejectedValueOnce(new Error('Terminal publication lost'))
    await h.ctx.simulationAdministration.resolveTaskReview(input, call())
    await vi.waitFor(async () => { expect((await h.ctx.teams.getTask({ teamId: item.teamId, taskId: item.taskId })).phase).toBe('completed') })
    await vi.waitFor(() => { expect(publication).toHaveBeenCalledWith(input.commandId) })
    expect(await h.ctx.simulationAdministration.request({ commandId: input.commandId }, call())).toMatchObject({ status: 'found', request: { status: 'accepted' }, review: input })
    publication.mockRestore()
    await h.fiber.dispose(); const cold = h.mount(); await cold
    const restore = { runId, commandId: 'restore-review' as never, checkpointId: `product-initial/${h.input.commandId}` as never }
    await h.ctx.simulationAdministration.restore(restore, call())
    expect(await h.finished(restore.commandId)).toMatchObject({ status: 'completed' })
    expect((await h.ctx.simulationAdministration.listRequests({ runId }, call())).items)
      .toEqual(expect.arrayContaining([expect.objectContaining({ commandId: input.commandId, kind: 'review', status: 'accepted' })]))
    await h.ctx.simulationAdministration.retryRequest({ runId, commandId: input.commandId }, call())
    expect(await h.finished(input.commandId)).toMatchObject({ status: 'completed' })
    const task = await h.ctx.teams.getTask({ teamId: item.teamId, taskId: item.taskId })
    expect(task.reviewHistory.filter(value => value.simulationCommand?.commandId === input.commandId)).toHaveLength(1)
    expect((await h.ctx.simulationAdministration.control({ runId }, call())).phase).toBe('paused')
  } finally { await h.close() }
})

it('rechecks revocation after the owner waits for canonical task metadata', async () => {
  const h = await ownerFixture('json', {}, driver)
  const ready = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  try {
    const runId = await h.create(), item = await pending(h, runId), input = intent(runId, item, 'queued-revocation')
    const original = h.ctx.teams.getTask.bind(h.ctx.teams)
    vi.spyOn(h.ctx.teams, 'getTask').mockImplementationOnce(async (request) => { ready.resolve(undefined); await release.promise; return await original(request) })
    const lease = new AbortController()
    await h.ctx.simulationAdministration.resolveTaskReview(input, call(lease))
    await ready.promise
    lease.abort(); release.resolve(undefined)
    expect(await h.finished(input.commandId)).toMatchObject({ status: 'failed', failure: 'review-failed' })
    expect((await original({ teamId: item.teamId, taskId: item.taskId })).phase).toBe('review')
  } finally { release.resolve(undefined); await h.close() }
})

it('refuses a canonical single-row review response that exceeds its complete byte allowance', async () => {
  const options: { maxBytes?: number } = {}
  const h = await ownerFixture('json', options, driver)
  try {
    const runId = await h.create(); await pending(h, runId)
    await h.fiber.dispose()
    options.maxBytes = 256
    const cold = h.mount(); await cold
    await expect(h.ctx.simulationAdministration.listTaskReviews({ runId }, call())).rejects.toThrow('complete byte allowance')
    expect(await h.ctx.simulationAdministration.request({ commandId: h.input.commandId }, call())).toMatchObject({ status: 'found', request: { status: 'completed' } })
  } finally { await h.close() }
})


it('requires the fixed completion policy, one purchase transfer and this attempt’s exact persisted report', async () => {
  const h = await ownerFixture('json', {}, driver)
  try {
    const runId = await h.create(), item = await pending(h, runId), state = h.owned().snapshot()
    const task = await h.ctx.teams.getTask({ teamId: item.teamId, taskId: item.taskId })
    const execution = state.taskExecutions?.[item.attemptId]
    if (execution === undefined || item.evidence === undefined) throw new Error('Fixture has no reviewed scene evidence')
    const summary = companyReviewSummary(state, execution, { ...task, description: 'Private instructions' })
    expect(summary.evidence).toEqual(item.evidence)
    expect(JSON.stringify(summary)).not.toContain('Private instructions')
    const report = state.operations[item.evidence.report.operationId]
    if (report === undefined) throw new Error('Fixture report has no retained operation')
    const wrongPolicy = { ...execution, completionPolicy: { id: 'unknown' as never, version: '1' } }
    expect(companyReviewSummary(state, wrongPolicy, task).action).toEqual({ allowed: false, reason: 'review-unavailable' })
    const withoutDelivery = { ...state, operations: { ...state.operations, [report.id]: { ...report, delivery: undefined } } }
    expect(companyReviewSummary(withoutDelivery, execution, task).action.reason)
      .toBe('review-unavailable')
    if (report.action.kind !== 'communication/post') throw new Error('Fixture report is not a communication')
    expect(companyReviewSummary({ ...state, operations: { ...state.operations, [report.id]: { ...report,
      action: { ...report.action, channelId: 'foreign' as never } } } }, execution, task).evidence).toBeUndefined()
    const snapshot = h.owned().snapshot.bind(h.owned())
    vi.spyOn(h.owned(), 'snapshot').mockImplementation(() => { const current = snapshot(); return { ...current,
      operations: { ...current.operations, [report.id]: { ...report, delivery: undefined } } } })
    const input = intent(runId, item, 'missing-evidence')
    await h.ctx.simulationAdministration.resolveTaskReview(input, call())
    expect(await h.finished(input.commandId)).toMatchObject({ status: 'failed', failure: 'review-failed' })
    expect((await h.ctx.teams.getTask({ teamId: item.teamId, taskId: item.taskId })).phase).toBe('review')
    vi.restoreAllMocks()
  } finally { await h.close() }
})

it('keeps an applied canonical review accepted when its lease retires before publication and reconciles only the original command', async () => {
  const h = await ownerFixture('json', {}, driver)
  try {
    const nativeAttach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
    let connection: import('@clocky/clocky-simulation-team').SimulationTeamConnection | undefined
    vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementation(async (...args) => {
      connection = await nativeAttach(...args); return connection
    })
    const runId = await h.create(), item = await pending(h, runId), input = intent(runId, item, 'native-lease-loss')
    if (connection === undefined) throw new Error('Review fixture has no canonical connection')
    const nativeReview = connection.reviewTask.bind(connection), retired = Promise.withResolvers<undefined>()
    const lease = new AbortController()
    vi.spyOn(connection, 'reviewTask').mockImplementationOnce(async (request, authorize) => {
      const task = await nativeReview(request, authorize)
      lease.abort(); retired.resolve(undefined); authorize?.()
      return task
    })
    await h.ctx.simulationAdministration.resolveTaskReview(input, call(lease))
    await retired.promise
    await vi.waitFor(async () => {
      const current = await h.ctx.simulationAdministration.control({ runId }, call())
      expect(current.inFlight).toBe(false)
    })
    expect(await h.ctx.simulationAdministration.request({ commandId: input.commandId }, call())).toMatchObject({ status: 'found', request: { status: 'accepted' } })
    expect((await h.ctx.teams.getTask({ teamId: item.teamId, taskId: item.taskId })).phase).toBe('completed')
    await h.ctx.simulationAdministration.resolveTaskReview(input, call())
    expect(await h.finished(input.commandId)).toMatchObject({ status: 'completed' })
    expect((await h.ctx.teams.getTask({ teamId: item.teamId, taskId: item.taskId })).reviewHistory).toHaveLength(1)
  } finally { await h.close() }
})
