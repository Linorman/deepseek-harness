/** Product scheduling owns background progression while original management receipts remain historical. */
import type { MockInstance } from 'vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { simulationProductManageInputSchema, simulationProductManagementInputSchema } from '../src/control-schema.ts'
import { simulationCompanyPreparationSchema } from '../src/company-preparation.ts'
import { SimulationCompanyOwner } from '../src/company-owner.ts'
import { simulationCheckpointRequestSchema } from '@clocky/clocky-simulation'
import { simulationIngressRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import { operation as observedOperation } from './collection-fixtures.ts'
import type { LogStream } from '@clocky/clocky-storage'
import { SimulationCompanyDriver, simulationCompanyDriverSchema } from '../src/company-driver.ts'
import type { SimulationCompanyDriveResult } from '../src/company-driver.ts'
import { ownerFixture } from './company-owner-fixture.ts'
import { companyConfig } from './company-driver-fixture.ts'
import { call } from './fixtures.ts'
import { simulationProductTaskReviewResolveInputSchema } from '../src/review-schema.ts'
import { simulationProductTaskCancelInputSchema } from '../src/task-control-schema.ts'

afterEach(() => { vi.restoreAllMocks() })

const management = (runId: string, managementId: string, phase: 'running' | 'paused' = 'running') =>
  simulationProductManageInputSchema.parse({ runId, managementId, phase })
const lookup = (runId: string, managementId: string) => simulationProductManagementInputSchema.parse({ runId, managementId })

async function captureOwner(h: Awaited<ReturnType<typeof ownerFixture>>, runId: import('../src/types.ts').SimulationProductRunId) {
  // oxlint-disable-next-line typescript/unbound-method -- The observer forwards the original method with its exact receiver.
  const original = SimulationCompanyOwner.prototype.observe
  const seen = new Set<SimulationCompanyOwner>()
  const probe = vi.spyOn(SimulationCompanyOwner.prototype, 'observe').mockImplementation(function (this: SimulationCompanyOwner) {
    seen.add(this)
    return original.call(this)
  })
  await h.ctx.simulationAdministration.control({ runId }, call())
  probe.mockRestore()
  const owner = seen.values().next().value
  if (owner === undefined) throw new Error('Product control did not observe its held owner')
  return owner
}

it.each(['json', 'sqlite'] as const)('starts one real bounded background driver, completes procurement and leaves results queryable (%s)', async (backend) => {
  const h = await ownerFixture(backend)
  try {
    const runId = await h.create()
    const service = h.ctx.simulationAdministration
    const attach = vi.spyOn(h.ctx.simulationTeams, 'attach')
    const before = h.owned().snapshot()
    expect(await service.control({ runId }, call())).toMatchObject({ owner: 'held', phase: 'paused', driver: 'idle',
      inFlight: false, actions: { start: { allowed: true, reason: 'ready' } } })
    expect(h.owned().snapshot()).toEqual(before)
    expect(h.requests).toEqual([]); expect(attach).not.toHaveBeenCalled()
    const start = management(runId, 'start')
    const [one, two] = await Promise.all([service.manage(start, call()), service.manage(start, call())])
    expect(one.operation).toEqual(two.operation)
    expect(one.operation.status).toBe('completed'); expect(attach).toHaveBeenCalledTimes(1)
    await vi.waitFor(async () => { expect((await service.control({ runId }, call())).driver).toBe('completed') }, { timeout: 5000, interval: 5 })
    const state = h.owned().snapshot()
    expect(state.resources['received' as never]?.quantity).toBe('1')
    expect(state.resources['stock' as never]?.quantity).toBe('1')
    expect(h.requests.length).toBeGreaterThan(0)
    expect(h.requests.every(value => value.tools.join(',') === 'simulation_observe,simulation_stage,simulation_submit')).toBe(true)
    expect(Object.keys(state.management ?? {})).toHaveLength(1)
    const calls = h.requests.length
    await service.manage(management(runId, 'pause', 'paused'), call())
    const retry = await service.manage(start, call())
    expect(retry.operation.phase).toBe('running'); expect(retry.control.phase).toBe('paused')
    expect(h.requests).toHaveLength(calls)
    expect(await service.managementRequest(lookup(runId, 'start'), call())).toMatchObject({ status: 'found', operation: one.operation })
    await expect(service.manage(management(runId, 'start', 'paused'), call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
    expect(Object.keys(h.owned().snapshot().management ?? {})).toHaveLength(2)
  } finally { await h.close() }
})

it('cancels only the future timer on pause and never restarts it for an old completed request', async () => {
  const h = await ownerFixture('json', { driverIntervalMs: 1000 })
  try {
    const runId = await h.create()
    const service = h.ctx.simulationAdministration
    const start = management(runId, 'start')
    expect((await service.manage(start, call())).control.driver).toBe('scheduled')
    await service.manage(management(runId, 'pause', 'paused'), call())
    expect((await service.manage(start, call())).control).toMatchObject({ phase: 'paused', driver: 'idle', inFlight: false })
    expect(h.requests).toEqual([])
    expect((await service.managementRequest(lookup(runId, 'not-found'), call())).status).toBe('not-found')
    await h.fiber.dispose(); await h.mount()
    expect(await h.ctx.simulationAdministration.control({ runId }, call())).toMatchObject({ owner: 'not-held', phase: 'paused',
      actions: { start: { allowed: false, reason: 'recovery-required' } } })
    const open = vi.spyOn(h.ctx.simulations, 'open').mockClear()
    expect((await h.ctx.simulationAdministration.manage(start, call())).operation.phase).toBe('running')
    expect((await h.ctx.simulationAdministration.managementRequest(lookup(runId, 'start'), call())).status).toBe('found')
    await expect(h.ctx.simulationAdministration.manage(management(runId, 'cold-start'), call()))
      .rejects.toThrow('explicit recovery')
    expect(open).not.toHaveBeenCalled(); expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('allows pause during accepted inference, reports its remaining work and drains on unload', async () => {
  const h = await ownerFixture()
  const started = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  const stream = h.adapter.stream.bind(h.adapter)
  vi.spyOn(h.adapter, 'stream').mockImplementationOnce(async function* (options) {
    started.resolve(undefined); await finish.promise; yield* stream(options)
  })
  try {
    const runId = await h.create()
    const service = h.ctx.simulationAdministration
    await service.manage(management(runId, 'start'), call())
    await started.promise
    const paused = await service.manage(management(runId, 'pause', 'paused'), call())
    expect(paused.control).toMatchObject({ phase: 'paused', inFlight: true, driver: 'advancing' })
    finish.resolve(undefined)
    await vi.waitFor(async () => {
      expect((await service.control({ runId }, call())).inFlight).toBe(false)
    }, { timeout: 3000, interval: 5 })
    expect(h.owned().snapshot().phase).toBe('paused')
    const calls = h.requests.length
    await h.fiber.dispose()
    expect(h.requests).toHaveLength(calls)
    const selection = h.ctx.simulations.resolveInspection({ provider: 'local', spec: h.owned().snapshot().spec })
    expect((await h.ctx.simulations.inspect(selection))?.owner)
      .toBe('unowned')
  } finally { finish.resolve(undefined); await h.close() }
})

it('keeps an accepted running intent after the carrier retires and rejects other principals', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const service = h.ctx.simulationAdministration
    for (const operation of [() => service.control({ runId }, call(undefined, 'other')),
      () => service.manage(management(runId, 'foreign'), call(undefined, 'other')),
      () => service.managementRequest(lookup(runId, 'foreign'), call(undefined, 'other'))]) {
      await expect(operation()).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    }
    const controller = new AbortController()
    const manage = h.owned().managePhase.bind(h.owned())
    vi.spyOn(h.owned(), 'managePhase').mockImplementationOnce(async (request) => {
      const result = await manage(request); controller.abort(); return result
    })
    await expect(service.manage(management(runId, 'retired-waiter'), call(controller))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    await vi.waitFor(async () => { expect((await service.control({ runId }, call())).driver).toBe('completed') }, { timeout: 5000, interval: 5 })
    expect((await service.managementRequest(lookup(runId, 'retired-waiter'), call())).status).toBe('found')
  } finally { await h.close() }
})

it('allows a new completed preparation anchor after initial checkpoint failure without rewriting that failure', async () => {
  const h = await ownerFixture()
  try {
    const attach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
    vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementationOnce(async (...args) => {
      const connection = await attach(...args)
      vi.spyOn(connection, 'checkpoint').mockRejectedValueOnce(new Error('checkpoint-response-failed'))
      return connection
    })
    const receipt = await h.ctx.simulationAdministration.create(h.input, call())
    expect((await h.finished()).status).toBe('failed')
    const preparation = { runId: receipt.runId, commandId: 'fixed-preparation' as never }
    await h.ctx.simulationAdministration.prepare(preparation, call())
    expect((await h.finished(preparation.commandId)).status).toBe('completed')
    await h.ctx.simulationAdministration.manage(management(receipt.runId, 'start-after-preparation'), call())
    await vi.waitFor(async () => { expect((await h.ctx.simulationAdministration.control({ runId: receipt.runId }, call())).driver)
      .toBe('completed') }, { timeout: 5000, interval: 5 })
    expect((await h.ctx.simulationAdministration.request({ commandId: h.input.commandId }, call())).status).toBe('found')
    expect((await h.finished()).status).toBe('failed')
    expect(h.owned().snapshot().resources['received' as never]?.quantity).toBe('1')
  } finally { await h.close() }
})

it('keeps management history bounded while terminal retry and queries remain available', async () => {
  const h = await ownerFixture('json', { maxManagementRequestsPerRun: 1, driverIntervalMs: 1000 })
  try {
    const runId = await h.create()
    const service = h.ctx.simulationAdministration
    const input = management(runId, 'paused', 'paused')
    const receipt = await service.manage(input, call())
    await expect(service.manage(management(runId, 'another', 'paused'), call())).rejects.toThrow('capacity')
    expect((await service.manage(input, call())).operation).toEqual(receipt.operation)
    expect((await service.managementRequest(lookup(runId, 'paused'), call())).status).toBe('found')
    expect(Object.keys(h.owned().snapshot().management ?? {})).toHaveLength(1)
  } finally { await h.close() }
})

it('retires the connection before releasing the run and waits for accepted external model cleanup', async () => {
  const h = await ownerFixture()
  const started = Promise.withResolvers<undefined>()
  const cancelled = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  vi.spyOn(h.adapter, 'stream').mockImplementationOnce(async function* (options) {
    options.signal?.addEventListener('abort', () => { cancelled.resolve(undefined) }, { once: true })
    started.resolve(undefined); await finish.promise
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  try {
    const runId = await h.create()
    await h.ctx.simulationAdministration.manage(management(runId, 'start'), call())
    await started.promise
    const close = vi.spyOn(h.owned(), 'close')
    let disposed = false
    const disposal = h.fiber.dispose().then(() => { disposed = true })
    await cancelled.promise
    expect(disposed).toBe(false); expect(close).not.toHaveBeenCalled()
    finish.resolve(undefined); await disposal
    expect(disposed).toBe(true); expect(close).toHaveBeenCalledTimes(1)
    const selection = h.ctx.simulations.resolveInspection({ provider: 'local', spec: h.owned().snapshot().spec })
    expect((await h.ctx.simulations.inspect(selection))?.owner)
      .toBe('unowned')
  } finally { finish.resolve(undefined); await h.close() }
})

it('refuses management while preparing and rejects a retired caller after attachment without starting models', async () => {
  const h = await ownerFixture()
  const waiting = Promise.withResolvers<undefined>()
  const entered = Promise.withResolvers<undefined>()
  try {
    const ensure = h.ctx.simulationTeams.ensureTeam.bind(h.ctx.simulationTeams)
    vi.spyOn(h.ctx.simulationTeams, 'ensureTeam').mockImplementationOnce(async (...args) => {
      entered.resolve(undefined); await waiting.promise; return ensure(...args)
    })
    const receipt = await h.ctx.simulationAdministration.create(h.input, call())
    await entered.promise
    expect((await h.ctx.simulationAdministration.control({ runId: receipt.runId }, call())).actions.start.allowed).toBe(false)
    await expect(h.ctx.simulationAdministration.manage(management(receipt.runId, 'premature'), call())).rejects.toThrow('completed preparation')
    waiting.resolve(undefined); await h.finished()
    const controller = new AbortController()
    const attach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
    vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementationOnce(async (...args) => {
      const result = await attach(...args); controller.abort(); return result
    })
    await expect(h.ctx.simulationAdministration.manage(management(receipt.runId, 'retired-before-acceptance'), call(controller)))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    expect(h.owned().snapshot().phase).toBe('paused')
    expect((await h.ctx.simulationAdministration.managementRequest(lookup(receipt.runId, 'retired-before-acceptance'), call())).status)
      .toBe('not-found')
    expect(h.requests).toEqual([])
  } finally { waiting.resolve(undefined); await h.close() }
})

it('serializes conflicting concurrent requests and refuses new preparation after scheduling attachment', async () => {
  const h = await ownerFixture('json', { driverIntervalMs: 1000 })
  try {
    const runId = await h.create()
    const service = h.ctx.simulationAdministration
    const results = await Promise.allSettled([service.manage(management(runId, 'same'), call()),
      service.manage(management(runId, 'same', 'paused'), call())])
    expect(results[0]?.status).toBe('fulfilled')
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'SIMULATION_PRODUCT_INVALID' } })
    await service.manage(management(runId, 'pause', 'paused'), call())
    const attempt = { runId, commandId: 'prepare-attached' as never }
    await service.prepare(attempt, call())
    expect((await h.finished(attempt.commandId)).status).toBe('failed')
    expect(h.owned().snapshot().phase).toBe('paused')
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('rechecks current model/activation availability instead of trusting the installed template catalog', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const providers = h.ctx.llm.listProviders.bind(h.ctx.llm)
    vi.spyOn(h.ctx.llm, 'listProviders').mockReturnValueOnce([])
    expect((await h.ctx.simulationAdministration.control({ runId }, call())).actions.start)
      .toEqual({ allowed: false, reason: 'execution-unavailable' })
    vi.spyOn(h.ctx.llm, 'listProviders').mockImplementation(providers)
    vi.spyOn(h.ctx.agentRuntimes, 'getProvider').mockReturnValue(undefined)
    await expect(h.ctx.simulationAdministration.manage(management(runId, 'no-provider'), call())).rejects.toThrow('execution-unavailable')
    expect(Object.keys(h.owned().snapshot().management ?? {})).toHaveLength(0)
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('keeps JavaScript property names valid as opaque native management identities', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const service = h.ctx.simulationAdministration
    for (const id of ['constructor', 'toString', '__proto__']) {
      expect((await service.managementRequest(lookup(runId, id), call())).status).toBe('not-found')
      const input = management(runId, id, 'paused')
      const result = await service.manage(input, call())
      expect(result.operation.managementId).toBe(id)
      expect((await service.managementRequest(lookup(runId, id), call())).status).toBe('found')
      expect((await service.manage(input, call())).operation).toEqual(result.operation)
    }
    expect(Object.keys(h.owned().snapshot().management ?? {})).toHaveLength(3)
  } finally { await h.close() }
})

it.each(['retry', 'resident-capacity', 'recipient-busy', 'coordination-limit'] as const)
('schedules one bounded next batch for %s without bypassing the retry deadline', async (reason) => {
  const h = await ownerFixture('json', { driverRetryMs: 50, driverIntervalMs: 10 })
  try {
    const runId = await h.create()
    const native = h.owned().snapshot()
    const nextAttemptAt = Date.now() + 150
    const result: SimulationCompanyDriveResult = { reason, controlSteps: 0, time: native.time, revision: native.revision,
      ...reason === 'retry' ? { nextAttemptAt } : {} }
    const advance = vi.spyOn(SimulationCompanyDriver.prototype, 'advance').mockResolvedValueOnce(result)
      .mockResolvedValue({ ...result, reason: 'completed' })
    await h.ctx.simulationAdministration.manage(management(runId, 'start'), call())
    await vi.waitFor(async () => {
      expect((await h.ctx.simulationAdministration.control({ runId }, call())).stop).toBe(reason)
    }, { timeout: 2000, interval: 5 })
    expect(advance).toHaveBeenCalledTimes(1)
    expect((await h.ctx.simulationAdministration.control({ runId }, call())).driver).toBe('scheduled')
    if (reason === 'retry') expect(Date.now()).toBeLessThan(nextAttemptAt)
    await vi.waitFor(() => { expect(advance).toHaveBeenCalledTimes(2) }, { timeout: 2000, interval: 5 })
    expect((await h.ctx.simulationAdministration.control({ runId }, call())).driver).toBe('completed')
  } finally { await h.close() }
})

it.each(['scenario-blocked', 'outcome-unknown', 'recovery-required', 'residency-recovery-required', 'recipient-required', 'stalled'] as const)
('waits for explicit intervention after %s rather than polling or losing the reason on pause', async (reason) => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const native = h.owned().snapshot()
    const advance = vi.spyOn(SimulationCompanyDriver.prototype, 'advance').mockResolvedValue({ reason, controlSteps: 0,
      time: native.time, revision: native.revision })
    await h.ctx.simulationAdministration.manage(management(runId, 'start'), call())
    await vi.waitFor(async () => { expect((await h.ctx.simulationAdministration.control({ runId }, call())).stop).toBe(reason) })
    await h.ctx.simulationAdministration.manage(management(runId, 'pause', 'paused'), call())
    const control = await h.ctx.simulationAdministration.control({ runId }, call())
    expect(control).toMatchObject({ phase: 'paused', driver: 'waiting', stop: reason, inFlight: false })
    if (reason !== 'recipient-required') expect(control.actions.start.allowed).toBe(false)
    expect(advance).toHaveBeenCalledTimes(1)
  } finally { await h.close() }
})

it('retains native responsibility after driver failure, permits pause and does not automatically repeat inference', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const advance = vi.spyOn(SimulationCompanyDriver.prototype, 'advance').mockRejectedValue(new Error('private provider path'))
    await h.ctx.simulationAdministration.manage(management(runId, 'start'), call())
    await vi.waitFor(async () => { expect((await h.ctx.simulationAdministration.control({ runId }, call())).driver).toBe('failed') })
    const control = await h.ctx.simulationAdministration.control({ runId }, call())
    expect(control.actions.start).toEqual({ allowed: false, reason: 'driver-failed' })
    expect(JSON.stringify(control)).not.toContain('private')
    await h.ctx.simulationAdministration.manage(management(runId, 'pause', 'paused'), call())
    await expect(h.ctx.simulationAdministration.manage(management(runId, 'restart'), call())).rejects.toThrow('driver-failed')
    expect(advance).toHaveBeenCalledTimes(1)
  } finally { await h.close() }
})

it('makes a retiring owner readable but refuses later management and preparation', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const owner = await captureOwner(h, runId)
    await owner.close()
    expect(owner.observe()).toMatchObject({ driver: 'retiring', actions: { pause: { allowed: false, reason: 'retiring' } } })
    await expect(owner.manage(management(runId, 'closed', 'paused'), () => {})).rejects.toThrow('retiring')
    const review = simulationProductTaskReviewResolveInputSchema.parse({ runId, commandId: 'closed-review',
      operationId: 'closed-operation', attemptId: 'closed-attempt', expectedRevision: 1,
      nextPhase: 'completed', reason: 'Owner has retired' })
    const cancellation = simulationProductTaskCancelInputSchema.parse({ runId, commandId: 'closed-cancel',
      operationId: 'closed-operation', expectedRevision: 1, expectedAttemptId: null, reason: 'Owner has retired' })
    await expect(owner.review(review, () => {}, async () => {})).rejects.toThrow('retiring')
    await expect(owner.cancelTask(cancellation, () => {}, async () => {})).rejects.toThrow('retiring')
    await expect(owner.retryOperation({ runId, commandId: 'closed-retry' as never,
      operationId: 'closed-operation' as never, expectedAttemptCount: 1, reason: 'Owner has retired' }, Date.now(),
    () => {}, async () => {})).rejects.toThrow('retiring')
    expect(owner.retryCapability('closed-operation' as never).reason).toBe('maintenance-in-progress')
    const operation = vi.fn(async () => {})
    await expect(owner.prepare(simulationCompanyPreparationSchema.parse({ ...h.input.parameters, version: '1', ownerName: `simulation-product/${runId}`,
      objective: 'Deliver one inventory unit', participant: { provider: 'in-process', preset: 'simulation', model: 'company/scripted' },
      checkpoint: { id: 'not-admitted' as never, maxDrainRounds: 4, maxAttempts: 3 } }), operation)).rejects.toThrow('unstarted owner')
    expect(operation).not.toHaveBeenCalled()
  } finally { await h.close() }
})

it('reports retry maintenance while a real owner checkpoint is collecting', async () => {
  const h = await ownerFixture()
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  try {
    const runId = await h.create(), owner = await captureOwner(h, runId)
    const attach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
    vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementationOnce(async (...args) => {
      const connection = await attach(...args), checkpoint = connection.checkpoint.bind(connection)
      vi.spyOn(connection, 'checkpoint').mockImplementationOnce(async (request) => {
        entered.resolve(undefined); await release.promise; return await checkpoint(request)
      })
      return connection
    })
    const cut = simulationCheckpointRequestSchema.parse({ id: 'held-owner-cut', implementationVersion: 'company/1',
      maxDrainRounds: 4, maxAttempts: 3 })
    const collecting = owner.checkpoint(cut)
    await entered.promise
    expect(owner.observe()).toMatchObject({ driver: 'checkpointing', inFlight: true,
      actions: { pause: { allowed: false, reason: 'checkpoint-in-progress' } } })
    expect(owner.retryCapability('blocked-operation' as never).reason).toBe('maintenance-in-progress')
    release.resolve(undefined)
    expect((await collecting).status).toBe('completed')
  } finally { release.resolve(undefined); await h.close() }
})

it('checks native task ownership and current Team revision before cancellation', async () => {
  const driver = simulationCompanyDriverSchema.parse({ ...companyConfig, tasks: { version: '1', cognition: 'deterministic',
    leaseDurationMs: 100000, maxAttempts: 3, retry: 'scene', review: 'buyer' } })
  const h = await ownerFixture('json', {}, driver, { maxMicrostepsPerTime: 5 })
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    await service.manage(management(runId, 'task-owner-start'), call())
    const row = await vi.waitFor(async () => {
      const item = (await service.listTaskReviews({ runId }, call())).items.find(value => value.action.allowed)
      if (item === undefined) throw new Error('Review task is not ready')
      return item
    }, { timeout: 5000 })
    await service.manage(management(runId, 'task-owner-pause', 'paused'), call())
    const owner = await captureOwner(h, runId)
    const review = simulationProductTaskReviewResolveInputSchema.parse({ runId, commandId: 'owner-review-target',
      operationId: row.operationId, attemptId: row.attemptId, expectedRevision: row.taskRevision,
      nextPhase: 'completed', reason: 'Review target must be exact' })
    const pendingCut = simulationCheckpointRequestSchema.parse({ id: 'review-pending-cut', implementationVersion: 'company/1',
      maxDrainRounds: 4, maxAttempts: 3 })
    await h.owned().beginCheckpoint(pendingCut)
    await expect(owner.review(review, () => {}, async () => {})).rejects.toThrow('outside native maintenance')
    await h.owned().failCheckpoint(pendingCut.id, 'test checkpoint retirement')
    await expect(owner.review({ ...review, operationId: 'foreign-operation' as never }, () => {}, async () => {}))
      .rejects.toThrow('original attempt')
    const operation = h.owned().snapshot().operations[row.operationId]
    if (operation?.outbox?.taskReceipt === undefined) throw new Error('Company task has no canonical receipt')
    const input = simulationProductTaskCancelInputSchema.parse({ runId, commandId: 'terminal-task-cancel',
      operationId: operation.id, expectedRevision: row.taskRevision - 1, expectedAttemptId: null, reason: 'Task selection is stale' })
    await expect(owner.cancelTask({ ...input, operationId: 'foreign-operation' as never }, () => {}, async () => {}))
      .rejects.toThrow('not an accepted run-owned task')
    await expect(owner.cancelTask(input, () => {}, async () => {})).rejects.toThrow('target changed')
    const quiesce = simulationCheckpointRequestSchema.parse({ id: 'review-stall-cut', implementationVersion: 'company/1',
      maxDrainRounds: 4, maxAttempts: 3 })
    expect((await owner.checkpoint(quiesce)).status).toBe('completed')
    const beforeStall = h.owned().snapshot()
    await h.owned().ingest(simulationIngressRequestSchema.parse({ id: 'review-stall-ingress', entityId: 'buyer',
      source: 'Operator', text: 'Input at the exhausted microstep', availableAt: beforeStall.time }))
    const pendingRecipients = new Set(Object.values(h.owned().snapshot().wakes)
      .filter(value => value.status === 'pending').map(value => value.entityId))
    if (pendingRecipients.size === 0) throw new Error('Review fixture has no pending recipient wake')
    for (const id of pendingRecipients) {
      const recipient = h.owned().snapshot().entities[id]
      if (recipient === undefined) throw new Error('Review wake has no recipient entity')
      await h.owned().change({ kind: 'entity/phase', id, entityRevision: recipient.revision, phase: 'inactive' },
        h.owned().snapshot().revision)
    }
    await h.owned().setPhase('running', h.owned().snapshot().revision)
    expect((await h.owned().drive({ until: beforeStall.time })).reason).toBe('stalled')
    await expect(owner.review(review, () => {}, async () => {})).rejects.toThrow('outside native maintenance')
  } finally { await h.close() }
})

it('refuses administrative review for a real task whose scenario disabled review', async () => {
  const driver = simulationCompanyDriverSchema.parse({ ...companyConfig, tasks: { version: '1', cognition: 'deterministic',
    leaseDurationMs: 100000, maxAttempts: 1, retry: 'scene', review: 'none' } })
  const h = await ownerFixture('json', {}, driver)
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    await service.manage(management(runId, 'unreviewed-start'), call())
    await vi.waitFor(async () => { expect((await service.control({ runId }, call())).stop).toBe('completed') }, { timeout: 5000 })
    const execution = Object.values(h.owned().snapshot().taskExecutions ?? {})[0]
    if (execution === undefined) throw new Error('Unreviewed task has no native attempt')
    const owner = await captureOwner(h, runId)
    const review = simulationProductTaskReviewResolveInputSchema.parse({ runId, commandId: 'unreviewed-command',
      operationId: execution.request.operationId, attemptId: execution.request.attemptId, expectedRevision: 1,
      nextPhase: 'completed', reason: 'Review was not configured' })
    await expect(owner.review(review, () => {}, async () => {})).rejects.toThrow('does not permit administrative review')
  } finally { await h.close() }
})

it('revalidates a queued retry against the current native operation before granting an allowance', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create(), owner = await captureOwner(h, runId)
    const complete = vi.fn(async () => {})
    await expect(owner.retryOperation({ runId, commandId: 'stale-native-retry' as never,
      operationId: 'absent-operation' as never, expectedAttemptCount: 1, reason: 'Retry current operation' },
    Date.now(), () => {}, complete)).rejects.toThrow('retry target changed')
    expect(complete).not.toHaveBeenCalled()
    expect(owner.observe().inFlight).toBe(false)
  } finally { await h.close() }
})

it('retries an in-progress original request after native terminal append failure without changing its identity', async () => {
  const h = await ownerFixture('json', { driverIntervalMs: 1000 })
  try {
    const runId = await h.create()
    // Fault the actual durable append rather than replacing the native management implementation.
    const stream = (h.owned() as unknown as { readonly stream: LogStream }).stream
    const append = stream.append.bind(stream)
    vi.spyOn(stream, 'append').mockImplementationOnce(append).mockRejectedValueOnce(new Error('management-terminal-write-failed'))
    const input = management(runId, 'interrupted', 'paused')
    await expect(h.ctx.simulationAdministration.manage(input, call())).rejects.toThrow('management-terminal-write-failed')
    expect((await h.ctx.simulationAdministration.control({ runId }, call())).actions.start.reason).toBe('management-in-progress')
    expect((await h.ctx.simulationAdministration.managementRequest(lookup(runId, 'interrupted'), call()))).toMatchObject({ status: 'found',
      operation: { status: 'in-progress' } })
    const retried = await h.ctx.simulationAdministration.manage(input, call())
    expect(retried.operation.status).toBe('completed')
    expect(Object.keys(h.owned().snapshot().management ?? {})).toHaveLength(1)
  } finally { await h.close() }
})

it('blocks a real pending checkpoint before native scheduling acceptance', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const request = simulationCheckpointRequestSchema.parse({ id: 'pending-cut', implementationVersion: 'company/1', maxDrainRounds: 4, maxAttempts: 3 })
    await h.owned().beginCheckpoint(request)
    expect((await h.ctx.simulationAdministration.control({ runId }, call())).actions.start.reason).toBe('checkpoint-in-progress')
    await expect(h.ctx.simulationAdministration.manage(management(runId, 'blocked'), call())).rejects.toThrow('checkpoint-in-progress')
    expect(h.requests).toEqual([])
    await h.owned().failCheckpoint(request.id, 'explicit test retirement')
  } finally { await h.close() }
})

it.each(['missing', 'implementation', 'team', 'unknown-operation', 'stalled'] as const)
('refuses an observed %s prerequisite before scheduling', async (variant) => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const state = h.owned().snapshot()
    let changed: SimulationSnapshot = state
    if (variant === 'missing') { const { checkpoints: _removed, ...without } = state; changed = without }
    else if (variant === 'implementation' || variant === 'team') {
      const id = state.latestCheckpointId!
      const original = state.checkpoints![id]!
      if (original.status !== 'completed') throw new Error('Fixture requires a complete preparation anchor')
      changed = { ...state, checkpoints: { ...state.checkpoints, [id]: { ...original, manifest: { ...original.manifest,
        ...variant === 'implementation' ? { implementationVersion: 'other/1' } : { team: { ...original.manifest.team,
          owner: { ...original.manifest.team.owner, teamId: 'other-team' as never } } } } } } }
    } else if (variant === 'unknown-operation') {
      const operation = { ...observedOperation('unknown'), entityId: 'buyer' as never, status: 'outcome-unknown' as const }
      changed = { ...state, operations: { [operation.id]: operation } }
    } else changed = { ...state, phase: 'stalled' }
    const probe = vi.spyOn(h.owned(), 'snapshot').mockReturnValue(changed)
    const control = await h.ctx.simulationAdministration.control({ runId }, call())
    expect(control.actions.start.allowed).toBe(false)
    await expect(h.ctx.simulationAdministration.manage(management(runId, 'not-admitted'), call())).rejects.toThrow('cannot start')
    probe.mockRestore()
    expect(Object.keys(h.owned().snapshot().management ?? {})).toHaveLength(0)
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('confirms retirement retry before releasing an owner whose connection close failed', async () => {
  const h = await ownerFixture('json', { driverIntervalMs: 1000 })
  try {
    const runId = await h.create()
    const attach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
    let close: MockInstance<() => Promise<void>> | undefined
    vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementationOnce(async (...args) => {
      const connection = await attach(...args)
      close = vi.spyOn(connection, 'close').mockRejectedValueOnce(new Error('connection-close-unconfirmed'))
      return connection
    })
    await h.ctx.simulationAdministration.manage(management(runId, 'start'), call())
    const owner = await captureOwner(h, runId)
    await expect(owner.close()).rejects.toThrow('retirement is unconfirmed')
    expect(owner.observe().driver).toBe('retiring')
    const selection = h.ctx.simulations.resolveInspection({ provider: 'local', spec: h.owned().snapshot().spec })
    expect((await h.ctx.simulations.inspect(selection))?.owner)
      .toBe('this-provider')
    await owner.close()
    expect(close).toHaveBeenCalledTimes(2)
  } finally { await h.close() }
})

it('drains a management queue and a late attachment when owner retirement wins the race', async () => {
  const h = await ownerFixture()
  const entered = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  try {
    const runId = await h.create()
    const owner = await captureOwner(h, runId)
    const attach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
    vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementationOnce(async (...args) => {
      entered.resolve(undefined); await finish.promise; return attach(...args)
    })
    const starting = h.ctx.simulationAdministration.manage(management(runId, 'start'), call())
    await entered.promise
    const queued = owner.manage(management(runId, 'pause', 'paused'), () => {})
    const settled = Promise.allSettled([starting, queued])
    const closing = owner.close()
    expect(owner.observe().driver).toBe('retiring')
    finish.resolve(undefined)
    expect(await settled).toMatchObject([{ status: 'rejected', reason: { code: 'SIMULATION_PRODUCT_UNAVAILABLE' } },
      { status: 'rejected', reason: { code: 'SIMULATION_PRODUCT_UNAVAILABLE' } }])
    await closing
    expect(h.owned().snapshot().phase).toBe('paused')
    expect(Object.keys(h.owned().snapshot().management ?? {})).toHaveLength(0)
    expect(h.requests).toEqual([])
  } finally { finish.resolve(undefined); await h.close() }
})

it('rechecks the native phase when a previously scheduled timer fires after checkpoint admission', async () => {
  const h = await ownerFixture('json', { driverIntervalMs: 50 })
  try {
    const runId = await h.create()
    const advance = vi.spyOn(SimulationCompanyDriver.prototype, 'advance')
    await h.ctx.simulationAdministration.manage(management(runId, 'start'), call())
    const cut = simulationCheckpointRequestSchema.parse({ id: 'future-cut', implementationVersion: 'company/1', maxDrainRounds: 4, maxAttempts: 3 })
    await h.owned().beginCheckpoint(cut)
    await vi.waitFor(async () => { expect((await h.ctx.simulationAdministration.control({ runId }, call())).driver).toBe('idle') })
    expect(advance).not.toHaveBeenCalled()
    await h.owned().failCheckpoint(cut.id, 'explicit test retirement')
  } finally { await h.close() }
})

it('does not schedule work for a native provider that reports a failed management result', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const state = h.owned().snapshot()
    vi.spyOn(h.owned(), 'managePhase').mockImplementationOnce(async request => ({ request, startedSequence: state.revision + 1,
      finishedSequence: state.revision + 2, status: 'failed', error: 'private native prerequisite' }))
    const result = await h.ctx.simulationAdministration.manage(management(runId, 'refused'), call())
    expect(result.operation).toMatchObject({ status: 'failed', failure: 'details-withheld' })
    expect(result.control).toMatchObject({ phase: 'paused', driver: 'idle' })
    expect(JSON.stringify(result)).not.toContain('private')
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})
