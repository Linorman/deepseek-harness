/** Explicit index maintenance crosses the real authenticated Host and Native provider. */
import { expect, it, vi } from 'vitest'
import UserQuestions from '@clocky/clocky-user-questions'
import { simulationChangeSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from '../../../simulation/simulation-local/tests/business-harness.ts'
import { call, fixture, registration } from '../../../simulation/simulation-product/tests/fixtures.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'
import { InProcessApiClient } from '../src/fetch/client.ts'

it.each(['json', 'sqlite'] as const)('rebuilds the exact source and refuses stale or unauthorized requests (%s)', async (backend) => {
  const native = await createBusinessHarness(backend)
  const h = await fixture(backend, { imports: [{ ...registration(), spec: native.selection.spec }] })
  h.unregister(); h.ctx.simulations.registerProvider(native.provider)
  try {
    await h.mount(); await h.ctx.plugin(UserQuestions)
    const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
    const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
    const input = { runId: registration().id, expectedRevision: native.run.snapshot().revision }
    const first = await client.simulations.rebuildIndex(input)
    expect(first.result).toMatchObject({ ok: true, value: { snapshotRevision: input.expectedRevision, version: 1 } })
    expect((await client.simulations.rebuildIndex(input)).result).toEqual(first.result)
    const foreign = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call(new AbortController(), 'foreign') }))
    expect((await foreign.simulations.rebuildIndex(input)).result).toMatchObject({ ok: false, error: { code: 'simulation-product-forbidden' } })
    await native.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'new', entityKind: 'org', cognition: 'none', readiness: 'ready', profile: {} }), input.expectedRevision)
    expect((await client.simulations.rebuildIndex(input)).result).toMatchObject({ ok: false, error: { code: 'simulation-product-stale' } })
    expect(native.run.snapshot().revision).toBe(input.expectedRevision + 1)
  } finally { await native.close() }
})

it.each(['json', 'sqlite'] as const)('reports source movement between Product observation and Native rebuild as stale (%s)', async (backend) => {
  const native = await createBusinessHarness(backend)
  const h = await fixture(backend, { imports: [{ ...registration(), spec: native.selection.spec }] })
  h.unregister(); h.ctx.simulations.registerProvider(native.provider)
  try {
    await h.mount(); await h.ctx.plugin(UserQuestions)
    const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
    const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
    const input = { runId: registration().id, expectedRevision: native.run.snapshot().revision }
    const rebuild = h.ctx.simulations.rebuildIndex.bind(h.ctx.simulations)
    const spy = vi.spyOn(h.ctx.simulations, 'rebuildIndex').mockImplementationOnce(async (...args) => {
      await native.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'between-captures',
        entityKind: 'org', cognition: 'none', readiness: 'ready', profile: {} }), native.run.snapshot().revision)
      return await rebuild(...args)
    })
    expect((await client.simulations.rebuildIndex(input)).result).toMatchObject({ ok: false, error: { code: 'simulation-product-stale' } })
    spy.mockRestore()
  } finally { await native.close() }
})
