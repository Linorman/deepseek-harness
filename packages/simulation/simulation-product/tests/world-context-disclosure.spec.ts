/** Authenticated product disclosure of real World material remains independent of actor membership. */
import { expect, it, vi } from 'vitest'
import { simulationDecisionIdSchema, simulationEntityIdSchema, simulationWorldFactRequestSchema, simulationChangeSchema } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from '../../simulation-local/tests/hiring-resource-harness.ts'
import { contextRequest } from '../../simulation-local/tests/context-fixture.ts'
import Products from '../src/index.ts'
import { registration, call } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('fences frozen World body pages and in-flight reads by the current user grant (%s)', async (backend) => {
  const h = await hiringResourceHarness(backend, 'hire-existing')
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  try {
    const canary = 'PRIVATE-WORLD-USER-BODY-CANARY'
    await h.run.recordWorldFact(simulationWorldFactRequestSchema.parse({ factId: 'private-user-scope', version: '1',
      schemaRef: 'clocky.world-fact/text/1', subject: 'fee-org', scope: 'fee-org', payload: { body: canary },
      effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'scope-members' }, supersedes: null,
      sources: [{ kind: 'run-event', runId: h.selection.spec.runId, sequence: h.run.snapshot().world!.sequence }] }))
    const id = simulationDecisionIdSchema.parse('user-world-context')
    await h.connection.openDecision(h.requester, id)
    const prepared = await h.connection.prepareContext(h.requester, id, { ...contextRequest(), world: { kind: 'goal' } })
    expect(JSON.stringify(prepared)).toContain(canary)
    const registered = { ...registration(), spec: h.selection.spec }
    await h.ctx.plugin(Products, { directoryStream: 'world-reader-directory', imports: [registered], maxContextPartBytes: 64 })
    const products = h.ctx.simulationProducts
    const input = { runId: registered.id, collection: 'decisions', id, section: 'context', limit: 1 } as const
    expect(JSON.stringify(await products.inspectObject(input, call()))).not.toContain(canary)
    await expect(products.inspectObject(input, call(new AbortController(), 'outsider')))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    const grant = () => products.contextReaderRegistrar()([{ principalId: call().principal.id,
      runId: registered.id, entityIds: [h.requester], content: ['context'] }])
    let revoke = grant()
    const first = await products.inspectObject(input, call())
    if (first.value?.section !== 'context') throw new Error('Missing original context')
    expect(first.value.bodyAccess).toBe('allowed')
    const cursor = first.value.items.nextCursor
    expect(cursor).toBeDefined()
    let page = first, text = ''
    for (;;) {
      if (page.value?.section !== 'context') throw new Error('Missing original context page')
      for (const item of page.value.items.items) if (item.kind === 'section' && item.body.status === 'text') text += item.body.text
      if (page.value.items.nextCursor === undefined) break
      page = await products.inspectObject({ ...input, cursor: page.value.items.nextCursor }, call())
    }
    expect(text).toContain(canary)
    revoke()
    await expect(products.inspectObject({ ...input, cursor }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    const hidden = await products.inspectObject(input, call())
    expect(hidden.value).toMatchObject({ bodyAccess: 'withheld' })
    expect(JSON.stringify(hidden)).not.toContain(canary)
    revoke = grant()
    const inspect = h.ctx.simulations.inspect.bind(h.ctx.simulations)
    const held = vi.spyOn(h.ctx.simulations, 'inspect').mockImplementationOnce(async (request) => {
      const original = await inspect(request)
      entered.resolve(undefined); await release.promise
      return original
    })
    const reading = products.inspectObject({ ...input, limit: 32 }, call())
    await entered.promise
    revoke(); release.resolve(undefined)
    const result = await reading
    expect(result.value).toMatchObject({ bodyAccess: 'withheld' })
    expect(JSON.stringify(result)).not.toContain(canary)
    held.mockRestore()
    // User archive authority is a separate grant, not a delegated live actor query.
    revoke = grant()
    const position = h.run.snapshot().entities[simulationEntityIdSchema.parse('fee-role')]!
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: position.id,
      entityRevision: position.revision, phase: 'inactive' }), h.run.snapshot().revision)
    expect(h.run.queryWorldFacts({ viewer: h.requester, time: h.run.snapshot().time,
      cursor: h.run.snapshot().revision, limit: 4 })).toMatchObject({ items: [] })
    expect((await products.inspectObject(input, call())).value).toMatchObject({ bodyAccess: 'allowed' })
    expect(h.run.snapshot().decisions[id]?.context).toEqual(prepared)
    revoke()
    expect(h.requests).toHaveLength(0)
  } finally { release.resolve(undefined); await h.close() }
})
