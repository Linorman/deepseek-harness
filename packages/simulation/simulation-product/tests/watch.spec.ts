/** Metadata waits hold no writer and authenticate every observation, continuation and retirement. */
import { expect, it, vi } from 'vitest'
import { createBusinessHarness } from '../../simulation-local/tests/business-harness.ts'
import { simulationChangeSchema } from '@clocky/clocky-simulation'
import { fixture, registration, call } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('observes native writes without opening execution and resets replaced-policy cursors (%s)', async (backend) => {
  const native = await createBusinessHarness(backend)
  const h = await fixture(backend, { imports: [{ ...registration(), spec: native.selection.spec }], watchPollMs: 1, maxWatchWaitMs: 20 })
  h.unregister(); h.ctx.simulations.registerProvider(native.provider)
  try {
    const { products, fiber } = await h.mount()
    const runId = registration().id
    const first = await products.watch({ runId, waitMs: 0 }, call())
    expect(first).toMatchObject({ status: 'changed', world: { status: 'observed', revision: native.run.snapshot().revision } })
    const before = native.run.snapshot()
    expect((await products.watch({ runId, cursor: first.cursor, waitMs: 0 }, call())).status).toBe('unchanged')
    expect(native.run.snapshot()).toEqual(before)
    const waiting = products.watch({ runId, cursor: first.cursor, waitMs: 20 }, call())
    await native.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'new', entityKind: 'org', cognition: 'none', profile: {} }), before.revision)
    const returned = await waiting
    const changed = returned.status === 'unchanged' ? await products.watch({ runId, cursor: returned.cursor, waitMs: 0 }, call()) : returned
    expect(changed).toMatchObject({ status: 'changed', readVersion: first.readVersion, world: { revision: native.run.snapshot().revision } })
    const expired = await products.watch({ runId, cursor: 'forged' as never, waitMs: 0 }, call())
    expect(expired.status).toBe('reset')
    await fiber.dispose()
    const next = await h.mount()
    const replaced = await next.products.watch({ runId, cursor: first.cursor, waitMs: 0 }, call())
    expect(replaced.status).toBe('reset'); expect(replaced.readVersion).not.toBe(first.readVersion)
    expect(native.run.snapshot().phase).toBe(before.phase)
  } finally { await native.close() }
})

it('separates missing and unavailable observations while retaining only a safe policy identity', async () => {
  const h = await fixture()
  const { products } = await h.mount()
  const first = await products.watch({ runId: registration().id, waitMs: 0 }, call())
  expect(first.world).toEqual({ status: 'missing' })
  h.unregister()
  const missing = await products.watch({ runId: registration().id, cursor: first.cursor, waitMs: 0 }, call())
  expect(missing.world).toEqual({ status: 'unavailable' })
  expect(missing.readVersion).toBe(first.readVersion)
  expect(JSON.stringify(missing)).not.toContain('native-')
  expect(h.open).not.toHaveBeenCalled()
})

it('bounds wait admission, clamps real wait, and retires credential and service waits without leaking native diagnostics', async () => {
  const h = await fixture('json', { maxWatchers: 1, maxWatchWaitMs: 10, watchPollMs: 1 })
  const { products, fiber } = await h.mount()
  const runId = registration().id
  const first = await products.watch({ runId, waitMs: 0 }, call())
  const controller = new AbortController()
  const wait = products.watch({ runId, cursor: first.cursor, waitMs: 1000 }, call(controller))
  const refused = expect(wait).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
  await expect(products.watch({ runId }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
  controller.abort(); await refused
  expect((await products.watch({ runId, cursor: first.cursor, waitMs: 1000 }, call())).status).toBe('unchanged')
  const waiting = products.watch({ runId, cursor: first.cursor, waitMs: 1000 }, call())
  const retired = expect(waiting).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
  await fiber.dispose(); await retired
  expect(h.open).not.toHaveBeenCalled()
})

it('checks ownership before provider IO and does not return even a policy hint after revocation', async () => {
  const h = await fixture()
  const { products } = await h.mount()
  await expect(products.watch({ runId: registration().id }, call(new AbortController(), 'other')))
    .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
  expect(h.inspect).not.toHaveBeenCalled()
  const controller = new AbortController()
  h.inspect.mockImplementationOnce(async () => { controller.abort(); throw new Error('private-diagnostic') })
  await expect(products.watch({ runId: registration().id }, call(controller))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
})

it('wakes an unchanged-world wait when an independent policy retires without replacing directory ownership', async () => {
  const h = await fixture('json', { watchPollMs: 1000, maxWatchWaitMs: 1000 })
  const { products } = await h.mount()
  const directory = await products.list({}, call())
  const grant = products.contextReaderRegistrar()
  expect(() => JSON.stringify(grant)).toThrow('process-local')
  const remove = grant([{ principalId: 'reader' as never, entityIds: ['actor' as never] }])
  const first = await products.watch({ runId: registration().id, waitMs: 0 }, call())
  const waiting = products.watch({ runId: registration().id, cursor: first.cursor, waitMs: 1000 }, call())
  await vi.waitFor(() => expect(h.inspect).toHaveBeenCalledTimes(2))
  remove()
  const next = await waiting
  expect(next.status).toBe('reset')
  expect(next.readVersion).not.toBe(first.readVersion)
  expect(next.world).toEqual(first.world)
  expect((await products.list({}, call())).items).toEqual(directory.items)
  expect(h.open).not.toHaveBeenCalled()
})
