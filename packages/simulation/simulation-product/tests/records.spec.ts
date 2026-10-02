/** Journal inspection returns original durable sequences with independent private-history permission. */
import { expect, it } from 'vitest'
import { simulationChangeSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from '../../simulation-local/tests/business-harness.ts'
import { fixture, registration, call } from './fixtures.ts'
import { worldFixture } from './collection-fixtures.ts'

it.each(['json', 'sqlite'] as const)('reads bounded original history without acquiring a writer or changing facts (%s)', async (backend) => {
  const native = await createBusinessHarness(backend)
  const h = await fixture(backend, { imports: [{ ...registration(), spec: native.selection.spec }],
    maxContextPartBytes: 7, maxPageSize: 3 })
  h.unregister(); h.ctx.simulations.registerProvider(native.provider)
  try {
    await native.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'private-record', entityKind: 'org',
      cognition: 'none', profile: { name: 'Secret🙂history' } }), native.run.snapshot().revision)
    const before = native.run.snapshot()
    const observation = await native.provider.inspect({ provider: 'local', spec: native.selection.spec, includeRecords: true })
    expect(observation?.records?.length).toBe(before.revision + 1)
    const sequence = before.revision
    const { products } = await h.mount()
    const input = { runId: registration().id, mode: 'original', sequence, limit: 3 } as const
    const hidden = await products.readRecords(input, call())
    expect(hidden).toMatchObject({ bodyAccess: 'withheld', totalRecords: 1, items: [{ sequence, body: { status: 'withheld' } }] })
    expect(JSON.stringify(hidden)).not.toContain('Secret')
    const remove = products.recordReaderRegistrar()([{ principalId: 'reader' as never, runId: registration().id }])
    const metadata = await products.readRecords({ ...input, mode: 'metadata' }, call())
    expect(metadata.items[0]?.body.status).toBe('withheld')
    const page = await products.readRecords(input, call())
    expect(page.items).toHaveLength(3)
    expect(page.nextCursor).toBeDefined()
    const parts: string[] = []
    let current = page
    for (;;) {
      for (const item of current.items) {
        if (item.body.status !== 'text') throw new Error('Expected original text')
        expect(item.sequence).toBe(sequence)
        expect(item.body.part).toBe(parts.length)
        expect(Buffer.byteLength(item.body.text)).toBeLessThanOrEqual(7)
        parts.push(item.body.text)
      }
      if (current.nextCursor === undefined) break
      current = await products.readRecords({ ...input, expectedRevision: page.snapshotRevision, cursor: current.nextCursor }, call())
    }
    expect(JSON.parse(parts.join(''))).toEqual(observation?.records?.find(entry => entry.sequence === sequence)?.value)
    for (const patch of [{ mode: 'metadata' as const }, { sequence: 0 }, { kind: 'run/created' }]) {
      await expect(products.readRecords({ ...input, ...patch, cursor: page.nextCursor }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    }
    await expect(products.readRecords({ ...input, cursor: page.nextCursor }, call(new AbortController(), 'other')))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    const credential = { ...call(), credentialGeneration: 2 }
    await expect(products.readRecords({ ...input, cursor: page.nextCursor }, credential)).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    remove()
    await expect(products.readRecords({ ...input, cursor: page.nextCursor }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    expect((await products.readRecords(input, call())).bodyAccess).toBe('withheld')
    expect((await products.readRecords({ ...input, sequence: before.revision + 1 }, call())).items).toEqual([])
    expect(native.run.snapshot()).toEqual(before)
    expect(h.open).not.toHaveBeenCalled()
  } finally { await native.close() }
})

it('withholds reads across policy and credential retirement, and counts the full UTF-8 response envelope', async () => {
  const h = await fixture('json', { maxBytes: 1400, maxContextPartBytes: 4, maxPageSize: 64 })
  const snapshot = (await worldFixture()).state
  const observation = { snapshot, owner: 'unowned' as const, records: [{ sequence: 0, value: { kind: 'run/created', text: '私密🙂'.repeat(30) } }] }
  h.inspect.mockResolvedValue(observation)
  const { products } = await h.mount()
  const remove = products.recordReaderRegistrar()([{ principalId: 'reader' as never }])
  const input = { runId: registration().id, mode: 'original' } as const
  const page = await products.readRecords(input, call())
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(1400)
  expect(page.nextCursor).toBeDefined()
  expect(page.items.length).toBeGreaterThan(0)
  expect(page.items.length).toBeLessThan(64)
  h.inspect.mockImplementationOnce(async () => { remove(); return observation })
  await expect(products.readRecords(input, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
  const controller = new AbortController()
  h.inspect.mockImplementationOnce(async () => { controller.abort(); return observation })
  await expect(products.readRecords(input, call(controller))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
  await expect(products.readRecords({ ...input, expectedRevision: snapshot.revision + 1 }, call()))
    .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
  h.inspect.mockResolvedValueOnce({ snapshot, owner: 'unowned' })
  await expect(products.readRecords(input, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
})
