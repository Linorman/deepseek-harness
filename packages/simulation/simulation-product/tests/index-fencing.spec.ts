/** Policy replacement invalidates collection cursors and in-flight index maintenance. */
import { expect, it } from 'vitest'
import { call, registration } from './fixtures.ts'
import { worldFixture, browseInput, decision } from './collection-fixtures.ts'

it('expires a collection cursor when policy generation changes at the same source revision', async () => {
  const h = await worldFixture()
  Object.assign(h.state.decisions, { a: decision('a', '1'), b: decision('b', '2') })
  const input = { ...browseInput('decisions'), collection: 'decisions' as const, limit: 1 }
  const page = await h.products.browse(input, call())
  const revoke = h.products.contextReaderRegistrar()([])
  await expect(h.products.browse({ ...input, cursor: page.nextCursor }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
  revoke()
})

it('discards late metadata when policy changes during source IO', async () => {
  const h = await worldFixture()
  let release!: () => void
  const paused = new Promise<void>((resolve) => { release = resolve })
  h.inspect.mockImplementation(async () => { await paused; return { snapshot: h.state, owner: 'unowned' } })
  const pending = h.products.browse({ ...browseInput('entities'), collection: 'entities' }, call())
  await Promise.resolve(); await Promise.resolve()
  const revoke = h.products.contextReaderRegistrar()([])
  release()
  await expect(pending).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
  revoke()
})

it('does not admit a rebuild for another owner or changed source', async () => {
  const h = await worldFixture()
  await expect(h.products.rebuildIndex({ runId: registration().id, expectedRevision: h.state.revision + 1 }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
  await expect(h.products.rebuildIndex({ runId: registration().id, expectedRevision: 0 }, call(new AbortController(), 'foreign')))
    .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
})
