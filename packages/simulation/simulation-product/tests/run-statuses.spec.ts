import { StorageError } from '@clocky/clocky-storage'
/** Finite status observations isolate per-run failures and retain one current authenticated batch lifetime. */
import { expect, it, vi } from 'vitest'
import { simulationRuntimeMetrics } from '@clocky/clocky-simulation'
import { simulationProductRunStatusesPageSchema, simulationProductRuntimeMetricsSchema } from '../src/schema.ts'
import { fixture, registration, call } from './fixtures.ts'
import { createBusinessHarness } from '../../simulation-local/tests/business-harness.ts'

it.each(['json', 'sqlite'] as const)('observes the current %s directory window without takeover and isolates provider errors', async (backend) => {
  const native = await createBusinessHarness(backend)
  const observed = { ...registration('observed'), spec: native.selection.spec }
  const imports = [observed, registration('missing'), registration('broken')]
  const h = await fixture(backend, { imports })
  h.unregister()
  const opening = vi.spyOn(native.provider, 'open')
  h.ctx.simulations.registerProvider({ name: 'local', open: h.open, async inspect(selection) {
    if (selection.spec.runId === native.selection.spec.runId) return await native.provider.inspect(selection)
    if (selection.spec.runId === 'native-broken') throw new Error('/private/credential/path')
    return undefined
  } })
  try {
    const { products } = await h.mount()
    const before = native.run.snapshot()
    const result = await products.runStatuses({ runIds: imports.map(value => value.id) }, call())
    expect(result.items.map(value => value.status)).toEqual(['observed', 'missing', 'unavailable'])
    expect(result.items[0]).toMatchObject({ world: { worldInitialized: false, metrics: simulationRuntimeMetrics(before, 'this-provider'),
      rulesVersion: { text: before.spec.rulesVersion }, policyVersion: { text: before.spec.policyVersion } } })
    expect(result.items.every(value => value.operational?.status === 'unavailable')).toBe(true)
    expect(result.modelPool?.status).toBe('unavailable')
    expect(simulationProductRunStatusesPageSchema.parse(result)).toEqual(result)
    const original = result.items[0]
    if (original?.status !== 'observed' || original.world === undefined) throw new Error('No original Native observation')
    const { worldInitialized: _known, ...legacy } = original.world
    const oldPeer = simulationProductRunStatusesPageSchema.parse({ ...result, items: [{ ...original, world: legacy }] })
    expect(oldPeer.items[0]).not.toHaveProperty('world.worldInitialized')
    for (const worldInitialized of [null, 0, 1, 'true', 'false', {}, []]) expect(simulationProductRunStatusesPageSchema
      .safeParse({ ...result, items: [{ ...original, world: { ...original.world, worldInitialized } }] }).success).toBe(false)

    expect(JSON.stringify(result)).not.toContain('/private/')
    expect(JSON.stringify(result)).not.toContain('native-broken')
    expect(native.run.snapshot()).toEqual(before)
    expect(h.open).not.toHaveBeenCalled(); expect(opening).not.toHaveBeenCalled()
  } finally { await native.close() }
})

it('returns explicit unavailable for unsafe aggregate token consumption and rejects malformed supplied metrics', async () => {
  const native = await createBusinessHarness('json')
  const h = await fixture()
  try {
    const { products } = await h.mount()
    const a = await native.actor('a')
    const state = native.run.snapshot()
    const unknown = { id: 'unknown', entityId: a.id, epoch: '1', sessionId: 'a', request: {
      provider: 'fixture', model: 'scripted', sessionSequence: 1 }, interval: '0', status: 'unknown', reserved: Number.MAX_SAFE_INTEGER }
    const snapshot = { ...state, tokenReservations: { unknown, held: { ...unknown, id: 'held', reserved: 1, status: 'reserved' } } }
    h.inspect.mockResolvedValue({ snapshot, owner: 'unowned' } as never)
    expect((await products.runStatuses({ runIds: [registration().id] }, call())).items[0]).toMatchObject({ status: 'unavailable' })
    await expect(products.inspect({ runId: registration().id }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
    const metrics = simulationRuntimeMetrics(state, 'this-provider')
    expect(simulationProductRuntimeMetricsSchema.safeParse({ ...metrics,
      budgets: { ...metrics.budgets, tokens: { ...metrics.budgets.tokens, charged: Number.MAX_SAFE_INTEGER + 1 } } }).success).toBe(false)
    expect(simulationProductRuntimeMetricsSchema.safeParse({ ...metrics, residentSlots: {
      ...metrics.residentSlots, recoveryRequired: metrics.residentSlots.used + 1 } }).success).toBe(false)
  } finally { await native.close() }
})

it('projects a durable scheduler stop without converting it into an operational provider status', async () => {
  const native = await createBusinessHarness('json')
  const selected = { ...registration(), spec: native.selection.spec }
  const h = await fixture('json', { imports: [selected] })
  try {
    const { products } = await h.mount()
    const snapshot = { ...native.run.snapshot(), phase: 'stalled' as const, stall: {
      code: 'SIM_QUEUE_CAPACITY' as const, capacity: 'events' as const,
      used: 1, limit: 1, requested: 1, recovery: 'free-or-extend-capacity-and-resume' as const,
    } }
    h.inspect.mockResolvedValueOnce({ snapshot, owner: 'unowned' })
    await expect(products.inspect({ runId: selected.id }, call())).resolves.toMatchObject({
      world: { phase: 'stalled', schedulerStop: { code: 'SIM_QUEUE_CAPACITY', recovery: 'free-or-extend-capacity-and-resume' } },
      operational: { status: 'unavailable' },
    })
  } finally { await native.close() }
})

it('bounds distinct identities and the complete batch, and never reads private or unregistered identities', async () => {
  const imports = [registration('a'), registration('b'), registration('private', 'other')]
  const h = await fixture('json', { imports, maxPageSize: 1 })
  let mounted = await h.mount()
  await expect(mounted.products.runStatuses({ runIds: [imports[0]!.id, imports[1]!.id] }, call()))
    .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
  await expect(mounted.products.runStatuses({ runIds: [imports[0]!.id, imports[0]!.id] }, call())).rejects.toThrow('distinct')
  await expect(mounted.products.runStatuses({ runIds: [imports[2]!.id] }, call()))
    .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
  expect(h.inspect).not.toHaveBeenCalled()
  const request = { runIds: [imports[0]!.id] }
  const result = await mounted.products.runStatuses(request, call())
  const size = Buffer.byteLength(JSON.stringify(result))
  await mounted.fiber.dispose()
  mounted = await h.mount(Object.assign({}, h.config, { imports: [], maxBytes: size }))
  expect(Buffer.byteLength(JSON.stringify(await mounted.products.runStatuses(request, call())))).toBe(size)
  await mounted.fiber.dispose()
  mounted = await h.mount(Object.assign({}, h.config, { imports: [], maxBytes: size - 1 }))
  await expect(mounted.products.runStatuses(request, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
  expect(h.open).not.toHaveBeenCalled()
})

it('discards every batch result after credential retirement and drains other accepted provider reads', async () => {
  const imports = [registration('a'), registration('b')]
  const h = await fixture('json', { imports })
  const { products, fiber } = await h.mount()
  const controller = new AbortController()
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  h.inspect.mockImplementationOnce(async () => { await Promise.resolve(); controller.abort(); throw new Error('Private failed provider') })
  h.inspect.mockImplementationOnce(async () => { entered.resolve(undefined); await release.promise; return undefined })
  const request = products.runStatuses({ runIds: imports.map(value => value.id) }, call(controller))
  await entered.promise
  const closed = vi.fn()
  const closing = fiber.dispose().then(closed)
  expect(closed).not.toHaveBeenCalled()
  release.resolve(undefined)
  await expect(request).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
  await closing
  expect(closed).toHaveBeenCalledOnce()
})

it.each([
  ['read-limit', 'history-limit'], ['version-mismatch', 'unsupported-version'],
  ['malformed-medium', 'corrupt-history'], ['closed', 'owner-unavailable'],
] as const)('isolates typed %s history failures and retains their safe category', async (code, reason) => {
  const h = await fixture()
  const { products } = await h.mount()
  h.inspect.mockRejectedValue(new StorageError(code, '/private/path token=secret private payload'))
  const result = await products.runStatuses({ runIds: [registration().id] }, call())
  expect(result.items[0]).toMatchObject({ status: 'unavailable', reason })
  expect(JSON.stringify(result)).not.toMatch(/private|secret/)
  await expect(products.inspect({ runId: registration().id }, call()))
    .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE', reason })
})

it('binds collection continuations to source identity even when the numeric revision is unchanged', async () => {
  const native = await createBusinessHarness('json')
  const h = await fixture()
  try {
    await native.actor('a'); await native.actor('b')
    const { products } = await h.mount(), snapshot = native.run.snapshot()
    h.inspect.mockResolvedValue({ snapshot, owner: 'unowned', sourceHash: 'a'.repeat(64) })
    const input = { runId: registration().id, collection: 'entities' as const, limit: 1 }
    const first = await products.browse(input, call())
    expect(first.nextCursor).toBeDefined()
    h.inspect.mockResolvedValue({ snapshot, owner: 'unowned', sourceHash: 'b'.repeat(64) })
    await expect(products.browse({ ...input, cursor: first.nextCursor }, call()))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    h.inspect.mockResolvedValue({ snapshot, owner: 'unowned', sourceHash: 'a'.repeat(64) })
    expect((await products.browse({ ...input, cursor: first.nextCursor }, call())).items).toHaveLength(1)
  } finally { await native.close() }
})
