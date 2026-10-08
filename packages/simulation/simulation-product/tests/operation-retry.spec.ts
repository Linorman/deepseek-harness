/** Original retry permissions survive lost native responses and cold owner restoration without publishing on grant or query. */
import { afterEach, expect, it, vi } from 'vitest'
import { ownerFixture } from './company-owner-fixture.ts'
import { call } from './fixtures.ts'
import { simulationProductManageInputSchema } from '../src/control-schema.ts'
import { simulationProductOperationRetryInputSchema } from '../src/operation-retry-schema.ts'
import type { SimulationProductOperationRetryReader } from '../src/registration-types.ts'

afterEach(() => { vi.restoreAllMocks() })

async function unknown(h: Awaited<ReturnType<typeof ownerFixture>>) {
  const runId = await h.create()
  const original = h.ctx.teams.postChannelEnvelope.bind(h.ctx.teams)
  let losses = h.owned().snapshot().spec.outboxMaxAttempts
  const publication = vi.spyOn(h.ctx.teams, 'postChannelEnvelope').mockImplementation(async (...args) => {
    const value = await original(...args)
    if (losses-- > 0) throw new Error('Publication receipt lost after real Hub acceptance')
    return value
  })
  await h.ctx.simulationAdministration.manage(simulationProductManageInputSchema.parse({ runId, managementId: 'start', phase: 'running' }), call())
  const operation = await vi.waitFor(() => {
    const value = Object.values(h.owned().snapshot().operations).find(item => item.status === 'outcome-unknown')
    if (value === undefined) throw new Error('Scene has not exhausted its unknown publication yet')
    return value
  }, { timeout: 5000, interval: 5 })
  await vi.waitFor(async () => { expect((await h.ctx.simulationAdministration.control({ runId }, call())).inFlight).toBe(false) })
  publication.mockRestore()
  return { runId, operation }
}

it('discards a retired administration retry hint after its reader finishes late', async () => {
  const h = await ownerFixture()
  const release = Promise.withResolvers<undefined>()
  try {
    const { runId, operation } = await unknown(h)
    const products = h.ctx.simulationProducts
    const entry = (products as unknown as { operationRetryReader?: { read: SimulationProductOperationRetryReader } }).operationRetryReader
    if (entry === undefined) throw new Error('Administration did not register its retry reader')
    const entered = Promise.withResolvers<undefined>()
    vi.spyOn(entry, 'read').mockImplementation(async (_runId, _operationId, native) => {
      entered.resolve(undefined)
      await release.promise
      return { ...native, allowed: false, reason: 'capacity-unavailable' }
    })
    const pending = products.inspectObject({ runId, collection: 'operations', id: operation.id, section: 'execution' }, call())
    await entered.promise
    await h.fiber.dispose()
    release.resolve(undefined)
    const result = await pending
    expect(result.value).toMatchObject({ retry: { allowed: false, reason: 'recovery-required' } })
  } finally { release.resolve(undefined); await h.close() }
})

it.each(['json', 'sqlite'] as const)('keeps one bounded native grant and original payload through lost responses and cold reads (%s)', async (backend) => {
  const h = await ownerFixture(backend)
  try {
    const { runId, operation } = await unknown(h), service = h.ctx.simulationAdministration
    const input = simulationProductOperationRetryInputSchema.parse({ runId, commandId: 'original-operation-retry',
      operationId: operation.id, expectedAttemptCount: operation.outbox!.attempts.length, reason: '  Reconcile the original target receipt  ' })
    const detail = await h.ctx.simulationProducts.inspectObject({ runId, collection: 'operations', id: operation.id, section: 'execution' }, call())
    expect(detail.value).toMatchObject({ retry: { allowed: true, reason: 'ready', expectedAttemptCount: input.expectedAttemptCount,
      maxAttempts: h.owned().snapshot().spec.outboxMaxAttempts } })
    const models = h.requests.length, posting = vi.spyOn(h.ctx.teams, 'postChannelEnvelope')
    const before = h.owned().snapshot(), nativeRetry = h.owned().retryOutbox.bind(h.owned())
    const lost = vi.spyOn(h.owned(), 'retryOutbox').mockImplementationOnce(async (...args) => {
      await nativeRetry(...args)
      throw new Error('Native grant response lost after its durable append')
    })
    expect((await service.retryOperation(input, call())).status).toBe('accepted')
    await vi.waitFor(() => { expect(lost).toHaveBeenCalledOnce(); expect(h.owned().snapshot().operations[operation.id]?.status).toBe('pending') })
    await vi.waitFor(async () => { expect((await service.control({ runId }, call())).inFlight).toBe(false) })
    const query = await service.request({ commandId: input.commandId }, call())
    expect(query).toMatchObject({ status: 'found', request: { kind: 'retry-operation', status: 'accepted' }, retryOperation: input })
    expect(h.requests.length).toBe(models); expect(posting).not.toHaveBeenCalled()
    expect(h.owned().snapshot().phase).toBe('stalled')
    expect(h.owned().snapshot().operations[operation.id]).toMatchObject({ action: before.operations[operation.id]!.action,
      fingerprint: operation.fingerprint, outbox: { budgetStart: input.expectedAttemptCount } })
    expect(Object.keys(h.owned().snapshot().operations[operation.id]!.outbox!.retryAuthorizations!)).toHaveLength(1)
    lost.mockRestore()
    await h.fiber.dispose(); const cold = h.mount(); await cold
    const open = vi.spyOn(h.ctx.simulations, 'open').mockClear(), attach = vi.spyOn(h.ctx.simulationTeams, 'attach').mockClear()
    expect(await h.ctx.simulationAdministration.request({ commandId: input.commandId }, call())).toEqual(query)
    await expect(h.ctx.simulationAdministration.retryRequest({ runId, commandId: input.commandId }, call())).rejects.toThrow('explicit restore')
    expect(open).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled(); expect(h.requests.length).toBe(models)
    const coldDetail = await h.ctx.simulationProducts.inspectObject({ runId, collection: 'operations', id: operation.id, section: 'execution' }, call())
    expect(coldDetail.value).toMatchObject({ retry: { allowed: false, reason: 'not-unknown' } })
    const restore = { runId, commandId: 'restore-operation-retry' as never, checkpointId: `product-initial/${h.input.commandId}` as never }
    await h.ctx.simulationAdministration.restore(restore, call())
    expect((await h.finished(restore.commandId)).status).toBe('completed')
    await h.ctx.simulationAdministration.retryRequest({ runId, commandId: input.commandId }, call())
    expect((await h.finished(input.commandId)).status).toBe('completed')
    expect(Object.keys(h.owned().snapshot().operations[operation.id]!.outbox!.retryAuthorizations!)).toHaveLength(1)
    expect(h.requests.length).toBe(models); expect(posting).not.toHaveBeenCalled()
    const granted = h.owned().snapshot()
    expect((await h.ctx.simulationAdministration.retryOperation(input, call())).status).toBe('completed')
    expect(h.owned().snapshot()).toEqual(granted)
    await expect(h.ctx.simulationAdministration.retryOperation({ ...input, reason: 'Changed original decision' }, call())).rejects.toThrow('another original payload')
    await h.ctx.simulationAdministration.manage(simulationProductManageInputSchema.parse({ runId, managementId: 'resume-original-retry', phase: 'running' }), call())
    await vi.waitFor(() => { expect(h.owned().snapshot().operations[operation.id]?.result?.status).toBe('applied') }, { timeout: 5000 })
    expect(h.owned().snapshot().operations[operation.id]?.outbox?.attempts).toHaveLength(input.expectedAttemptCount + 1)
  } finally { await h.close() }
})

it('refuses stale first acceptance and already retired credentials without retaining a new request', async () => {
  const h = await ownerFixture()
  try {
    const { runId, operation } = await unknown(h)
    const input = simulationProductOperationRetryInputSchema.parse({ runId, commandId: 'stale-operation', operationId: operation.id,
      expectedAttemptCount: operation.outbox!.attempts.length + 1, reason: 'Reconcile target' })
    await expect(h.ctx.simulationAdministration.retryOperation(input, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
    expect(await h.ctx.simulationAdministration.request({ commandId: input.commandId }, call())).toMatchObject({ status: 'not-found' })
    const controller = new AbortController(); controller.abort()
    await expect(h.ctx.simulationAdministration.retryOperation(
      { ...input, expectedAttemptCount: operation.outbox!.attempts.length }, call(controller)))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    expect(h.owned().snapshot().operations[operation.id]?.status).toBe('outcome-unknown')
  } finally { await h.close() }
})
