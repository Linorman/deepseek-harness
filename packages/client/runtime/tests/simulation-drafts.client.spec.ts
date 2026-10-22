/** Private authoring responses must retain every original CAS field under the current authority. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { scenarioDraftSaveSchema, scenarioDraftRevisionSchema } from '@clocky/clocky-simulation-product/schema'
import { SimulationRuntime } from '../src/client/simulations/service.ts'
import { FakeApiClient, ok } from './fake-api.client.ts'
import definition from '../../../sdk/protocol/tests/fixtures/world-v1-definition.json'

it('normalizes the original name and rejects a receipt that changes only the retained graph layout', async () => {
  const ctx = new Context(), api = new FakeApiClient(), runtime = new SimulationRuntime(ctx, api)
  runtime.connected('draft-author' as never)
  try {
    const input = { ...scenarioDraftSaveSchema.parse({ draftId: 'private', saveId: 'save', parentRevision: null, name: 'Draft', definition,
      layout: [{ id: 'unit', x: 12, y: 4 }] }), name: '  Draft  ' }
    const request = scenarioDraftSaveSchema.parse(input)
    const value = scenarioDraftRevisionSchema.parse({ ...request, author: 'draft-author', revision: 0, savedAt: 1 })
    const send = vi.spyOn(api.simulations, 'saveScenarioDraft').mockResolvedValue(ok({ status: 'saved', value }))
    await expect(runtime.saveScenarioDraft(input)).resolves.toMatchObject({ status: 'saved', value: { layout: input.layout } })
    expect(send).toHaveBeenCalledWith(request)
    send.mockResolvedValue(ok({ status: 'saved', value: { ...value, layout: [] } }))
    await expect(runtime.saveScenarioDraft(input)).rejects.toThrow('original identity')
  } finally { await ctx.fiber.dispose() }
})
