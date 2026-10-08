/** Separate body grants, frozen source ordering and real durable inspections preserve read-only ownership. */
import { expect, it } from 'vitest'
import { simulationDecisionIdSchema, simulationContextRequestSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from '../../simulation-local/tests/business-harness.ts'
import { contextRequest } from '../../simulation-local/tests/context-fixture.ts'
import { fixture, registration, call } from './fixtures.ts'
import { worldFixture } from './collection-fixtures.ts'
import { simulationProductObjectInputSchema, simulationProductObjectInspectionSchema } from '../src/schema.ts'
import type { SimulationProductContextItem } from '../src/types.ts'

it.each(['json', 'sqlite'] as const)('reads original frozen context only under a distinct entity body grant (%s)', async (backend) => {
  const native = await createBusinessHarness(backend)
  const readers = [{ principalId: 'reader' as never, runId: registration().id, entityIds: ['buyer' as never] }]
  const h = await fixture(backend, { imports: [{ ...registration(), spec: native.selection.spec }], contextReaders: readers,
    maxContextPartBytes: 4 })
  h.unregister(); h.ctx.simulations.registerProvider(native.provider)
  try {
    const buyer = await native.actor('buyer')
    const id = simulationDecisionIdSchema.parse('frozen')
    const decision = await buyer.lease.openDecision(id, native.run.snapshot().revision)
    const request = contextRequest()
    request.sections[0]!.blocks = [{ type: 'text', text: '中🙂文原始正文' }]
    request.sections.push({ kind: 'history', required: false, blocks: [{ type: 'reasoning', text: '/private/image' }] })
    request.sources.push({ kind: 'run-event', runId: native.selection.spec.runId, sequence: decision.snapshotRevision })
    await buyer.lease.prepareContext(id, simulationContextRequestSchema.parse(request))
    const { products, fiber } = await h.mount()
    // The owner copies trusted reader configuration instead of consulting caller-mutated arrays after registration.
    readers[0]!.entityIds.length = 0
    const input = { runId: registration().id, collection: 'decisions', id, section: 'context', limit: 2 } as const
    const before = native.run.snapshot()
    const items: SimulationProductContextItem[] = []
    let result = await products.inspectObject(input, call())
    for (;;) {
      if (result.value?.section !== 'context') throw new Error('Expected frozen context')
      expect(result.value.bodyAccess).toBe('allowed')
      expect(result.value.frozen?.projections.run).toBe(decision.snapshotRevision)
      items.push(...result.value.items.items)
      if (result.value.items.nextCursor === undefined) break
      result = await products.inspectObject({ ...input, cursor: result.value.items.nextCursor,
        expectedRevision: result.snapshotRevision }, call())
    }
    const original = items.filter(item => item.kind === 'section' && item.index === 0)
    expect(original.map(item => item.kind === 'section' && item.body.status === 'text' ? item.body.text : '').join('')).toBe('中🙂文原始正文')
    for (const item of original) {
      if (item.kind === 'section' && item.body.status === 'text') expect(Buffer.byteLength(item.body.text)).toBeLessThanOrEqual(4)
    }
    expect(items).toContainEqual({ kind: 'run-event', sequence: decision.snapshotRevision })
    expect(items.some(item => item.kind === 'section' && item.body.status === 'unsupported')).toBe(true)
    expect(JSON.stringify(items)).not.toContain('/private/image')
    expect(native.run.snapshot()).toEqual(before)
    await fiber.dispose()
    const redacted = await h.mount(Object.assign({}, h.config, { contextReaders: [] }))
    result = await redacted.products.inspectObject(input, call())
    if (result.value?.section !== 'context') throw new Error('Expected redacted context')
    expect(result.value.bodyAccess).toBe('withheld')
    expect(result.value.items.items.every(item => item.kind !== 'section' || item.body.status === 'withheld')).toBe(true)
    expect(JSON.stringify(result)).not.toContain('原始正文')
    await expect(redacted.products.inspectObject(input, call(new AbortController(), 'other'))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
  } finally { await native.close() }
})

it('keeps relation history, scope and exact half-open time separate from entity state and fences each page', async () => {
  const h = await worldFixture()
  const entity = { id: 'actor', kind: 'person', phase: 'active', cognition: 'none', revision: 1, profileRevision: 1, profile: {} }
  Object.assign(h.state.entities, { actor: entity })
  Object.assign(h.state, { time: '9007199254740993' })
  const relation = { subject: 'actor', object: 'other', relation: 'member-of', revision: 1, validFrom: '9007199254740993', validUntil: null }
  Object.assign(h.state.relations, { a: { ...relation, id: 'a' }, b: { ...relation, id: 'b', validFrom: '0', validUntil: '9007199254740993' },
    c: { ...relation, id: 'c', subject: 'other', object: 'scope', scope: 'actor', validFrom: '9007199254740994' },
    hidden: { ...relation, id: 'hidden', subject: 'unrelated', object: 'unrelated-other' } })
  const input = { runId: registration().id, collection: 'entities', id: 'actor' as never, section: 'relationships', limit: 2 } as const
  const first = await h.products.inspectObject(input, call())
  expect(first.value).toMatchObject({ time: '9007199254740993', relationships: { total: 3,
    items: [{ id: 'a', active: true, validFrom: '9007199254740993' }, { id: 'b', active: false, validUntil: '9007199254740993' }] } })
  if (first.value?.section !== 'relationships') throw new Error('Expected relationships')
  const next = await h.products.inspectObject({ ...input, cursor: first.value.relationships.nextCursor }, call())
  expect(next.value).toMatchObject({ relationships: { items: [{ id: 'c', active: false, scope: 'actor' }] } })
  h.state.revision++
  await expect(h.products.inspectObject({ ...input, cursor: first.value.relationships.nextCursor }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
  expect((await h.products.inspectObject({ ...input, id: 'missing' as never }, call())).status).toBe('missing')
  expect(h.open).not.toHaveBeenCalled()
})

it('refuses retired context grants after provider IO and never returns a pending private body during unload', async () => {
  const h = await worldFixture({ contextReaders: [{ principalId: 'reader' as never, entityIds: ['actor' as never] }] })
  const input = { runId: registration().id, collection: 'decisions', id: 'decision' as never, section: 'context', limit: 32 } as const
  const actor = await h.native.actor('actor')
  const decisionId = simulationDecisionIdSchema.parse('decision')
  const opened = await actor.lease.openDecision(decisionId, h.native.run.snapshot().revision)
  const context = contextRequest()
  context.sources.push({ kind: 'run-event', runId: h.native.run.snapshot().spec.runId, sequence: opened.snapshotRevision })
  await actor.lease.prepareContext(decisionId, context)
  Object.assign(h.state, h.native.run.snapshot())
  const controller = new AbortController()
  h.inspect.mockImplementationOnce(async () => { controller.abort(); return { snapshot: h.state, owner: 'unowned' } })
  await expect(h.products.inspectObject(input, call(controller))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
  const barrier = Promise.withResolvers<undefined>()
  const entered = Promise.withResolvers<undefined>()
  h.inspect.mockImplementationOnce(async () => { entered.resolve(undefined); await barrier.promise; return { snapshot: h.state, owner: 'unowned' } })
  const read = h.products.inspectObject(input, call())
  const redacted = read.then((result) => {
    if (result.value?.section !== 'context') throw new Error('Retired context has no metadata')
    expect(result.value.bodyAccess).toBe('withheld')
    expect(result.value.items.items.every(item => item.kind !== 'section' || item.body.status === 'withheld')).toBe(true)
    expect(result.value.items.items.some(item => item.kind === 'run-event')).toBe(true)
  })
  await entered.promise
  const retiring = h.fiber.dispose()
  barrier.resolve(undefined)
  await redacted; await retiring
})

it('rejects malformed private-reader config and unauthorized context bodies at wire parsing', async () => {
  for (const options of [{ maxContextPartBytes: 3 }, { contextReaders: [{ principalId: 'reader', entityIds: [] }] },
    { contextReaders: [{ principalId: 'reader', entityIds: ['actor'], uploadedCode: 'private' }] }]) {
    const h = await fixture()
    await expect(h.mount(Object.assign({}, h.config, options) as never)).rejects.toThrow()
    expect(h.open).not.toHaveBeenCalled(); expect(h.inspect).not.toHaveBeenCalled()
  }
  expect(() => simulationProductObjectInputSchema.parse({ runId: 'run', collection: 'entities', id: 'entity', section: 'context' })).toThrow()
  const selection = { collection: 'decisions', section: 'context', id: 'decision' }
  expect(() => simulationProductObjectInspectionSchema.parse({ runId: 'run', snapshotRevision: 1, observedAt: 1, selection, status: 'found',
    value: { ...selection, accounting: { status: 'absent' }, bodyAccess: 'withheld', items: { total: 1, items: [{ kind: 'section', index: 0,
      block: 0, section: { text: 'input', truncated: false }, required: true, body: { status: 'text', text: 'private', part: 0, parts: 1 } }] } } })).toThrow()
})
