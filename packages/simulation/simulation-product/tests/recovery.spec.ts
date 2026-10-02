/** Startup validates the full retained registration journal before publishing product reads. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import SimulationProducts from '../src/index.ts'
import { call, fixture, registration } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('reuses exact configured imports and refuses changed registrations or retained capacity (%s)', async (backend) => {
  const h = await fixture(backend, { imports: [registration('a'), registration('b')] })
  let current = await h.mount()
  const first = await current.products.list({}, call())
  await current.fiber.dispose()
  current = await h.mount()
  expect(await current.products.list({}, call())).toEqual(first)
  expect(h.ctx.storageLog.get(h.config.directoryStream)?.tailSequence).toBe(1)
  await current.fiber.dispose()
  for (const extra of [{ imports: [registration('a', 'reader', 'Changed')] }, { maxRuns: 1, imports: [] },
    { maxDirectoryEntryBytes: 1, imports: [] }]) {
    const ctx = new Context()
    ctx.provide('storageLog', h.ctx.storageLog)
    ctx.provide('simulations', h.ctx.simulations)
    const products = new SimulationProducts(ctx, Object.assign({}, h.config, extra))
    try { await expect(products.list({}, call())).rejects.toThrow() }
    finally { await ctx.fiber.dispose() }
    expect(h.ctx.storageLog.get(h.config.directoryStream)).toBeUndefined()
  }
})

it('rejects a new import beyond retained capacity before appending it', async () => {
  const h = await fixture('json', { maxRuns: 1, imports: [registration('a')] })
  const original = await h.mount()
  await original.fiber.dispose()
  const ctx = new Context()
  ctx.provide('storageLog', h.ctx.storageLog)
  ctx.provide('simulations', h.ctx.simulations)
  try {
    const products = new SimulationProducts(ctx, Object.assign({}, h.config, { imports: [registration('b')] }))
    await expect(products.list({}, call())).rejects.toThrow(/capacity/)
    expect(h.ctx.storageLog.get(h.config.directoryStream)?.tailSequence).toBe(0)
  } finally { await ctx.fiber.dispose() }
  const verified = await h.mount()
  expect((await verified.products.list({}, call())).items.map(row => row.id)).toEqual(['a'])
})

it('rejects missing retained prefixes, empty suffix pages and noncontiguous sequence facts', async () => {
  const h = await fixture()
  const original = await h.mount()
  await original.fiber.dispose()
  const routedOpen = h.ctx.storageLog.open.bind(h.ctx.storageLog)
  for (const mode of ['prefix', 'suffix', 'gap']) {
    const ctx = new Context()
    ctx.provide('storageLog', h.ctx.storageLog)
    ctx.provide('simulations', h.ctx.simulations)
    const open = vi.spyOn(h.ctx.storageLog, 'open').mockImplementationOnce(async (descriptor) => {
      const stream = await routedOpen(descriptor)
      if (mode === 'prefix') vi.spyOn(stream, 'firstSequence', 'get').mockReturnValue(1)
      else if (mode === 'suffix') vi.spyOn(stream, 'read').mockResolvedValueOnce([])
      else {
        const rows = await stream.read(-1, 1)
        vi.spyOn(stream, 'read').mockResolvedValueOnce(rows.map(row => ({ ...row, sequence: 1 })))
      }
      return stream
    })
    try {
      const products = new SimulationProducts(ctx, Object.assign({}, h.config, { imports: [] }))
      await expect(products.list({}, call())).rejects.toThrow(/prefix|suffix|contiguous/)
    } finally { await ctx.fiber.dispose(); open.mockRestore() }
  }
})

it('contains failed storage initialization and releases an absent stream during disposal', async () => {
  const h = await fixture()
  vi.spyOn(h.ctx.storageLog, 'open').mockRejectedValueOnce(new Error('Unavailable storage'))
  const ctx = new Context()
  ctx.provide('storageLog', h.ctx.storageLog)
  ctx.provide('simulations', h.ctx.simulations)
  try {
    const products = new SimulationProducts(ctx, { directoryStream: h.config.directoryStream })
    await expect(products.list({}, call())).rejects.toThrow(/Unavailable storage/)
  } finally { await ctx.fiber.dispose() }
})

it('resolves constructor defaults and refuses an oversized explicit page', async () => {
  const h = await fixture()
  const ctx = new Context()
  ctx.provide('storageLog', h.ctx.storageLog)
  ctx.provide('simulations', h.ctx.simulations)
  try {
    const products = new SimulationProducts(ctx, { directoryStream: h.config.directoryStream })
    expect(await products.list({}, call())).toEqual({ items: [] })
    await expect(products.list({ limit: 65 }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
  } finally { await ctx.fiber.dispose() }
})
