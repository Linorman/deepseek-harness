/** Real JSON/SQLite journals retain private CAS ancestors and exact retry outcomes across owner restart. */
import { expect, it } from 'vitest'
import { fixture, call } from './fixtures.ts'
import { sample } from '../../simulation-scenario/tests/v1-fixtures.ts'

for (const backend of ['json', 'sqlite'] as const) {
  it(`${backend}: conflicting tabs retain both documents without changing history and exact saves survive restart`, async () => {
    const { mount, open, inspect } = await fixture(backend)
    const first = await mount()
    const input = { draftId: 'draft', saveId: 'save-0', parentRevision: null, name: 'Original', definition: sample, layout: [{ id: sample.organization.rootId, x: 100, y: -50 }] }
    const saved = await first.products.saveScenarioDraft(input, call())
    expect(saved.status).toBe('saved')
    expect(saved).toMatchObject({ value: { layout: input.layout } })
    const [left, right] = await Promise.all([
      first.products.saveScenarioDraft({ ...input, name: 'Left', saveId: 'save-left', parentRevision: 0 }, call()),
      first.products.saveScenarioDraft({ ...input, name: 'Right', saveId: 'save-right', parentRevision: 0 }, call()),
    ])
    expect(left.status).toBe('saved')
    expect(right).toMatchObject({ status: 'conflict', current: { name: 'Left', revision: 1 }, attempted: { name: 'Right' } })
    expect(await first.products.readScenarioDraft({ draftId: 'draft' }, call(undefined, 'stranger'))).toEqual({ value: null })
    await first.fiber.dispose()
    const restarted = await mount()
    expect(await restarted.products.saveScenarioDraft(input, call())).toEqual(saved)
    expect((await restarted.products.readScenarioDraft({ draftId: 'draft', revision: 0 }, call())).value?.name).toBe('Original')
    expect((await restarted.products.readScenarioDraft({ draftId: 'draft' }, call())).value?.revision).toBe(1)
    await expect(restarted.products.saveScenarioDraft({ ...input, layout: [] }, call())).rejects.toThrow('payload changed')
    await expect(restarted.products.saveScenarioDraft({ ...input, name: 'Changed retry' }, call())).rejects.toThrow('payload changed')
    const aborted = new AbortController(); aborted.abort()
    await expect(restarted.products.readScenarioDraft({ draftId: 'draft' }, call(aborted))).rejects.toThrow()
    expect(open).not.toHaveBeenCalled(); expect(inspect).not.toHaveBeenCalled()
  })
}

it('recovers an acknowledged-on-disk save after its append reply is lost, without accepting another writer turn', async () => {
  const { ctx, mount } = await fixture('json')
  const first = await mount(), stream = ctx.storageLog.get('simulation-products:author-drafts')!
  const append = stream.append.bind(stream)
  stream.append = async (...args) => { await append(...args); throw new Error('lost durable reply') }
  const input = { draftId: 'ambiguous', saveId: 'original-save', parentRevision: null, name: 'Original', definition: sample }
  await expect(first.products.saveScenarioDraft(input, call())).rejects.toThrow('lost durable reply')
  await expect(first.products.saveScenarioDraft({ ...input, saveId: 'replacement' }, call())).rejects.toThrow('unavailable')
  await first.fiber.dispose()
  const restored = await mount()
  expect(await restored.products.saveScenarioDraft(input, call())).toMatchObject({ status: 'saved', value: { revision: 0 } })
  expect(ctx.storageLog.get('simulation-products:author-drafts')!.tailSequence).toBe(0)
})

it('refuses history capacity and malformed input without evicting original definitions', async () => {
  const { mount } = await fixture('sqlite', { maxDraftRevisions: 1 })
  const { products } = await mount()
  const input = { draftId: 'bounded', saveId: 'first', parentRevision: null, name: 'Original', definition: sample }
  await products.saveScenarioDraft(input, call())
  await expect(products.saveScenarioDraft({ ...input, saveId: 'second', parentRevision: 0 }, call())).rejects.toThrow('capacity')
  await expect(products.saveScenarioDraft({ ...input, author: 'impersonated' } as never, call())).rejects.toThrow()
  expect((await products.readScenarioDraft({ draftId: 'bounded' }, call())).value?.revision).toBe(0)
})

it.each(['json', 'sqlite'] as const)('%s refuses the old author log format instead of silently losing presentation metadata', async (backend) => {
  const { ctx, mount } = await fixture(backend)
  await ctx.storageLog.open({ name: 'simulation-products:author-drafts', version: 1 })
  await expect(mount()).rejects.toThrow()
})
