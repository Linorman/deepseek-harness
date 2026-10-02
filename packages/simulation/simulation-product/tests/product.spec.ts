/** Product reads preserve authorization, complete response budgets and drained disposal. */
import { expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { SimulationProducts } from '../src/index.ts'
import { call, fixture, registration } from './fixtures.ts'
import { createBusinessHarness } from '../../simulation-local/tests/business-harness.ts'
import { LocalSimulationProvider } from '../../simulation-local/src/index.ts'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

it.each(['json', 'sqlite'] as const)('recovers immutable authorized registrations and expires old pages on remount (%s)', async (backend) => {
  const imports = [registration('b'), registration('a'), registration('private', 'other')]
  const h = await fixture(backend, { imports, maxPageSize: 1 })
  const { products, fiber } = await h.mount()
  const first = await products.list({}, call())
  expect(first.items.map(row => row.id)).toEqual(['a'])
  expect(first.nextCursor).toBeDefined()
  const second = await products.list({ cursor: first.nextCursor }, call())
  expect(second.items.map(row => row.id)).toEqual(['b'])
  expect(second.nextCursor).toBeUndefined()
  expect((await products.list({ search: '  SIMULATION  ' }, call())).items).toHaveLength(1)
  expect(await products.list({ search: 'no match' }, call())).toEqual({ items: [] })
  expect((await products.list({}, call(undefined, 'other'))).items.map(row => row.id)).toEqual(['private'])
  expect(h.inspect).not.toHaveBeenCalled()
  expect(h.open).not.toHaveBeenCalled()
  const serialized = JSON.stringify(first)
  for (const privateField of ['ownerPrincipalId', 'native-', 'provider', 'spec', 'rulesVersion', 'scanned']) expect(serialized).not.toContain(privateField)
  await expect(products.list({ cursor: first.nextCursor, search: 'different' }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
  await fiber.dispose()
  expect(h.ctx.get('simulationProducts')).toBeUndefined()
  await expect(products.list({}, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
  const remounted = await h.mount(Object.assign({}, h.config, { imports: [] }))
  expect((await remounted.products.list({}, call())).items[0]?.registeredAt).toBe(first.items[0]?.registeredAt)
  await expect(remounted.products.list({ cursor: first.nextCursor }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
})

it.each(['json', 'sqlite'] as const)('observes held real history without takeover, changing phase or disclosing private profiles (%s)', async (backend) => {
  const native = await createBusinessHarness(backend, { origin: '9007199254740993', maxTime: '100000000000000000000' })
  const imported = { ...registration(), spec: native.selection.spec }
  const h = await fixture(backend, { imports: [imported], maxTextBytes: 4 })
  h.unregister()
  h.ctx.simulations.registerProvider(native.provider)
  try {
    const { products } = await h.mount()
    const before = native.run.snapshot()
    const result = await products.inspect({ runId: imported.id }, call())
    expect(result).toMatchObject({ status: 'observed', world: { time: before.time, phase: 'running', revision: before.revision,
      owner: 'this-provider', tickUnit: { text: 'minu', truncated: true }, entityCount: 0, decisionCount: 0, operationCount: 0 } })
    expect(native.run.snapshot()).toEqual(before)
    expect(JSON.stringify(result)).not.toContain('maxTokensPerInterval')
    expect(JSON.stringify(result)).not.toContain(native.root)
    await expect(products.inspect({ runId: imported.id }, call(undefined, 'other'))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    await expect(products.inspect({ runId: 'absent' as never }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    await native.run.close()
    expect((await products.inspect({ runId: imported.id }, call())).world?.owner).toBe('unowned')
  } finally { await native.close() }
})

it.each(['json', 'sqlite'] as const)('distinguishes another live owner from corrupted released history and never acquires execution (%s)', async (backend) => {
  const native = await createBusinessHarness(backend)
  const reader = new LocalSimulationProvider({ name: 'local', root: native.root, backend, replayPageSize: 4 }, () => {})
  const imported = { ...registration(), spec: native.selection.spec }
  const h = await fixture(backend, { imports: [imported] })
  h.unregister()
  h.ctx.simulations.registerProvider(reader)
  const open = vi.spyOn(reader, 'open')
  try {
    const { products } = await h.mount()
    const before = native.run.snapshot()
    // A reader with a distinct provider instance sees the retained coordinator's
    // lock, but may observe it without opening or restoring the native run.
    expect(await products.inspect({ runId: imported.id }, call())).toMatchObject({ status: 'observed', world: { owner: 'other-owner' } })
    expect(await products.browse({ runId: imported.id, collection: 'entities' }, call())).toMatchObject({ items: [] })
    expect(await products.readRecords({ runId: imported.id, mode: 'metadata' }, call())).toHaveProperty('items')
    expect(native.run.snapshot()).toEqual(before)
    expect(open).not.toHaveBeenCalled()
    await native.run.close()
    const path = join(native.root, createHash('sha256').update(imported.spec.runId).digest('hex'))
    const journal = backend === 'json' ? join(path, 'journal', 'logs', 'c2ltdWxhdGlvbg.json') : join(path, 'journal.sqlite')
    const bytes = await readFile(journal)
    await writeFile(journal, 'invalid retained history')
    try {
      for (const read of [() => products.inspect({ runId: imported.id }, call()),
        () => products.browse({ runId: imported.id, collection: 'entities' }, call()),
        () => products.readRecords({ runId: imported.id, mode: 'metadata' }, call())]) {
        await expect(read()).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE',
          message: 'Simulation history is unavailable for inspection' })
      }
      expect(open).not.toHaveBeenCalled()
    } finally { await writeFile(journal, bytes) }
    expect(await products.inspect({ runId: imported.id }, call())).toMatchObject({ status: 'observed', world: { owner: 'unowned' } })
  } finally { await reader.close(); await native.close() }
})

it('distinguishes missing history from provider failure and rechecks revocation on success and error', async () => {
  const h = await fixture()
  const { products } = await h.mount()
  const request = { runId: registration().id }
  expect(await products.inspect(request, call())).toMatchObject({ status: 'missing' })
  h.inspect.mockRejectedValueOnce(new Error('/private/secret provider diagnostic'))
  await expect(products.inspect(request, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE',
    message: 'Simulation history is unavailable for inspection' })
  for (const rejected of [false, true]) {
    const controller = new AbortController()
    h.inspect.mockImplementationOnce(async () => {
      controller.abort()
      if (rejected) throw new Error('provider diagnostic')
      return undefined
    })
    await expect(products.inspect(request, call(controller))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
  }
  const controller = new AbortController(); controller.abort()
  h.inspect.mockClear()
  await expect(products.inspect(request, call(controller))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
  expect(h.inspect).not.toHaveBeenCalled()
})

it('caps retained reads without blocking directory discovery and drains inspection before closing storage', async () => {
  const h = await fixture('json', { maxPendingReads: 2 })
  const { products, fiber } = await h.mount()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  h.inspect.mockImplementationOnce(() => { entered.resolve(undefined); return release.promise })
  const reading = products.inspect({ runId: registration().id }, call())
  await entered.promise
  expect((await products.list({}, call())).items).toHaveLength(1)
  const second = products.inspect({ runId: registration().id }, call())
  await expect(products.list({}, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
  const closed = vi.fn()
  const disposal = fiber.dispose().then(closed)
  await vi.waitFor(() => { expect(h.ctx.get('simulationProducts')).toBeUndefined() })
  expect(closed).not.toHaveBeenCalled()
  await expect(products.list({}, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
  release.resolve(undefined)
  await Promise.all([reading, second, disposal])
  expect(closed).toHaveBeenCalledOnce()
  expect(h.ctx.storageLog.get(h.config.directoryStream)).toBeUndefined()
})

it('bounds UTF-8 text and complete results including empty wrappers, rows and cursors', async () => {
  const h = await fixture('json', { imports: [registration('a', 'reader', '中文🙂标题'), registration('b')], maxTextBytes: 7 })
  let mounted = await h.mount()
  const page = await mounted.products.list({}, call())
  expect(page.items[0]?.name).toEqual({ text: '中文', truncated: true })
  const exact = Buffer.byteLength(JSON.stringify(page))
  await mounted.fiber.dispose()
  mounted = await h.mount(Object.assign({}, h.config, { imports: [], maxBytes: exact }))
  expect(Buffer.byteLength(JSON.stringify(await mounted.products.list({}, call())))).toBe(exact)
  await mounted.fiber.dispose()
  // Retained journal entries have an independent durable budget; public byte bounds cannot make recovery lossy.
  const empty = await fixture('json', { imports: [], maxBytes: 1 })
  const small = await empty.mount()
  await expect(small.products.list({}, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
  await expect(small.products.list({ search: '中文' }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
  const rows = await fixture('json', { imports: Array.from({ length: 5 }, (_, index) => registration(String(index), 'reader', 'x'.repeat(400))),
    maxBytes: 1500 })
  const bounded = await rows.mount()
  let result = await bounded.products.list({ limit: 5 }, call())
  expect(result.items.length).toBeGreaterThan(0)
  expect(result.items.length).toBeLessThan(5)
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1500)
  const ids = result.items.map(row => row.id)
  while (result.nextCursor !== undefined) {
    result = await bounded.products.list({ limit: 5, cursor: result.nextCursor }, call())
    ids.push(...result.items.map(row => row.id))
  }
  expect(ids).toEqual(['0', '1', '2', '3', '4'])
  const one = await fixture('json', { maxBytes: 2 })
  const tooSmall = await one.mount()
  await expect(tooSmall.products.list({}, call())).rejects.toThrow(/row exceeds/)
})

it('rejects misconfigured imports and allowances before directory IO', async () => {
  const h = await fixture()
  const open = vi.spyOn(h.ctx.storageLog, 'open')
  for (const config of [Object.assign({}, h.config, { directoryStream: ' ' }), Object.assign({}, h.config, { maxPendingReads: 0 }),
    Object.assign({}, h.config, { maxTextBytes: Number.POSITIVE_INFINITY }), Object.assign({}, h.config, { maxDirectoryEntryBytes: 1 }),
    Object.assign({}, h.config, { maxRuns: 1, imports: [registration('a'), registration('b')] }),
    Object.assign({}, h.config, { imports: [registration(), registration()] }),
    Object.assign({}, h.config, { imports: [registration(), { ...registration(), id: 'other' as never }] })]) {
    const ctx = new Context()
    ctx.provide('storageLog', h.ctx.storageLog)
    ctx.provide('simulations', h.ctx.simulations)
    try { expect(() => new SimulationProducts(ctx, config)).toThrow() }
    finally { await ctx.fiber.dispose() }
  }
  expect(open).not.toHaveBeenCalled()
})

it('retains discoverability independently of provider registration and explicitly refuses unavailable detail', async () => {
  const h = await fixture('json', { imports: [{ ...registration(), provider: 'unloaded' }] })
  const { products } = await h.mount()
  expect((await products.list({}, call())).items).toHaveLength(1)
  await expect(products.inspect({ runId: registration().id }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
  const release = h.ctx.simulations.registerProvider({ name: 'unloaded', open: h.open, inspect: h.inspect })
  expect((await products.inspect({ runId: registration().id }, call())).status).toBe('missing')
  release()
  await expect(products.inspect({ runId: registration().id }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
  expect(h.open).not.toHaveBeenCalled()
})
