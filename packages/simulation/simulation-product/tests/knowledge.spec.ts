/** Exact selected versions remain subject to current native audience and transitive premise visibility. */
import { expect, it, vi } from 'vitest'
import { simulationDecisionIdSchema, simulationKnowledgeRequestSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from '../../simulation-local/tests/business-harness.ts'
import { contextRequest } from '../../simulation-local/tests/context-fixture.ts'
import { fixture, registration, call } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('separates current and frozen knowledge, refuses unrelated refs and rechecks current revocation (%s)', async (backend) => {
  const native = await createBusinessHarness(backend)
  const h = await fixture(backend, { imports: [{ ...registration(), spec: native.selection.spec }], maxContextPartBytes: 4,
    contextReaders: [{ principalId: 'reader' as never, entityIds: ['b' as never] }] })
  h.unregister(); h.ctx.simulations.registerProvider(native.provider)
  try {
    await native.actor('a'); const b = await native.actor('b')
    const request = simulationKnowledgeRequestSchema.parse({ id: 'shared', owner: 'a', expectedRevision: 0, statement: '原始🙂知识',
      source: { kind: 'belief', profileRevision: 1, policyVersion: '1' }, observedAt: '0', availableAt: '0',
      validFrom: '0', validUntil: null, readers: ['b'] })
    const first = await native.run.recordKnowledge(request)
    const id = simulationDecisionIdSchema.parse('frozen-knowledge')
    await b.lease.openDecision(id, native.run.snapshot().revision)
    const context = contextRequest()
    await b.lease.prepareContext(id, { ...context, knowledge: { ids: [first.id], required: true } })
    const { products } = await h.mount()
    const input = { runId: registration().id, collection: 'decisions', id, section: 'knowledge', reference: { id: first.id, revision: 1 }, limit: 2 } as const
    expect((await products.inspectObject(input, call())).value).toMatchObject({ bodyAccess: 'withheld', knowledge: { items: [], total: 0 } })
    const remove = products.contextReaderRegistrar()([{ principalId: 'reader' as never, entityIds: ['b' as never], content: ['knowledge', 'sources'] }])
    await native.run.recordKnowledge({ ...request, expectedRevision: 1, statement: '后来知识' })
    const before = native.run.snapshot()
    let result = await products.inspectObject(input, call())
    const parts: string[] = []
    for (;;) {
      if (result.value?.section !== 'knowledge') throw new Error('Missing selected knowledge')
      expect(result.value.selected).toEqual(input.reference)
      for (const item of result.value.knowledge.items) {
        expect(item.reference.revision).toBe(1)
        if (item.body.status === 'text') { parts.push(item.body.text); expect(Buffer.byteLength(item.body.text)).toBeLessThanOrEqual(4) }
      }
      if (result.value.knowledge.nextCursor === undefined) break
      result = await products.inspectObject({ ...input, cursor: result.value.knowledge.nextCursor }, call())
    }
    expect(parts.join('')).toBe('原始🙂知识')
    const internals = products as unknown as { boundedPage: (...args: unknown[]) => unknown }
    const boundedPage = internals.boundedPage.bind(internals)
    const projected = vi.spyOn(internals, 'boundedPage').mockImplementation((...args) => {
      const page = boundedPage(...args)
      queueMicrotask(remove)
      return page
    })
    const retired = await products.inspectObject(input, call())
    expect(retired.value).toMatchObject({ section: 'knowledge', bodyAccess: 'withheld', knowledge: { items: [], total: 0 } })
    projected.mockRestore()
    const renewed = products.contextReaderRegistrar()([{ principalId: 'reader' as never, entityIds: ['b' as never],
      content: ['knowledge', 'sources'] }])
    const current = await products.inspectObject({ runId: registration().id, collection: 'entities', id: b.id, section: 'knowledge' }, call())
    if (current.value?.section !== 'knowledge') throw new Error('Missing current knowledge')
    expect(current.value.knowledge.items.every(item => item.reference.revision === 2)).toBe(true)
    expect(current.value.knowledge.items.map(item => item.body.status === 'text' ? item.body.text : '').join('')).toBe('后来知识')
    expect(native.run.snapshot()).toEqual(before)
    expect((await products.inspectObject({ ...input, reference: { ...input.reference, revision: 2 } }, call())).status).toBe('missing')
    await native.run.recordKnowledge({ ...request, expectedRevision: 2, statement: '已经撤销', readers: [] })
    result = await products.inspectObject(input, call())
    expect(result.value).toMatchObject({ bodyAccess: 'allowed', knowledge: { items: [], total: 0 } })
    expect(JSON.stringify(result)).not.toContain('原始')
    remove()
    renewed()
    expect((await products.inspectObject(input, call())).value).toMatchObject({ bodyAccess: 'withheld' })
  } finally { await native.close() }
})
