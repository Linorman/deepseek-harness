/** Simulation reads traverse the authenticated fetch carrier and owning product directory. */
import { Context } from '@clocky/cordis'
import UserQuestions from '@clocky/clocky-user-questions'
import { expect, it, vi } from 'vitest'
import { call, fixture, registration } from '../../../simulation/simulation-product/tests/fixtures.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'
import { InProcessApiClient } from '../src/fetch/client.ts'
import { RpcId } from '../src/api/rpc.ts'
import { withAuthenticatedProductCall } from '../src/authenticated-product-call.ts'
import { worldFixture, browseInput, decision } from '../../../simulation/simulation-product/tests/collection-fixtures.ts'
import { ownerFixture } from '../../../simulation/simulation-product/tests/company-owner-fixture.ts'
import { simulationProductCommandIdSchema, simulationProductPreflightInputSchema } from '../../../simulation/simulation-product/src/administration-schema.ts'

it('refuses unauthenticated and undeployed reads through direct and fetch dispatch', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(UserQuestions)
    const api = createApiProxy(ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
    expect(await api.simulations!.list({ rpcId: RpcId('list'), payload: {} })).toMatchObject({ result: { error: { code: 'PRODUCT_AUTH_REQUIRED' } } })
    const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
    expect(await client.simulations.list({})).toMatchObject({ result: { ok: false, error: { code: 'simulation-product-unavailable' } } })
    expect(await client.simulations.inspect({ runId: registration().id })).toMatchObject({ result: { ok: false, error: { code: 'simulation-product-unavailable' } } })
    const draft = simulationProductPreflightInputSchema.parse({ templateId: 'company', templateVersion: '1', name: 'Company',
      parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '1' } })
    for (const operation of [
      () => client.simulations.catalog({}),
      () => client.simulations.preflight(draft),
      () => client.simulations.create({ ...draft, expectedModel: { provider: 'company', name: 'scripted' },
        commandId: simulationProductCommandIdSchema.parse('create') }),
      () => client.simulations.prepare({ runId: registration().id, commandId: simulationProductCommandIdSchema.parse('prepare') }),
      () => client.simulations.listRequests({ runId: registration().id }),
      () => client.simulations.retryRequest({ runId: registration().id, commandId: simulationProductCommandIdSchema.parse('retry') }),
      () => client.simulations.request({ commandId: simulationProductCommandIdSchema.parse('original') }),
    ]) {
      expect(await operation()).toMatchObject({ result: { ok: false, error: { code: 'simulation-product-unavailable' } } })
    }
    delete api.simulations
    expect(await client.simulations.list({})).toMatchObject({ result: { ok: false, error: { code: 'simulation-product-unavailable' } } })
    expect(await client.simulations.inspect({ runId: registration().id })).toMatchObject({ result: { ok: false, error: { code: 'simulation-product-unavailable' } } })
  } finally { await ctx.fiber.dispose() }
})

it.each(['json', 'sqlite'] as const)('returns only authorized safe reads over fetch and maps private/missing IDs identically (%s)', async (backend) => {
  const h = await fixture(backend, { imports: [registration(), registration('private', 'other')] })
  await h.mount()
  await h.ctx.plugin(UserQuestions)
  const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
  const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
  const listing = await client.simulations.list({})
  expect(listing).toMatchObject({ result: { ok: true, value: { items: [{ id: registration().id }] } } })
  expect(await client.simulations.inspect({ runId: registration().id })).toMatchObject({ result: { ok: true, value: { status: 'missing' } } })
  for (const id of ['private', 'absent']) {
    expect(await client.simulations.inspect({ runId: id as never })).toMatchObject({ result: { ok: false, error: {
      code: 'simulation-product-forbidden', message: 'Simulation product access is unavailable', details: {},
    } } })
  }
  expect(await client.simulations.list({ limit: 65 })).toMatchObject({ result: { ok: false, error: { code: 'simulation-product-invalid' } } })
  expect(await client.simulations.list({ cursor: 'tampered' as never })).toMatchObject({ result: { ok: false, error: { code: 'simulation-product-invalid' } } })
  h.inspect.mockRejectedValueOnce(new Error('secret provider path'))
  const failed = await client.simulations.inspect({ runId: registration().id })
  expect(failed).toMatchObject({ result: { ok: false, error: { code: 'simulation-product-unavailable' } } })
  expect(JSON.stringify(failed)).not.toContain('secret')
  expect(h.open).not.toHaveBeenCalled()
})

it('rechecks revoked reads and separates input validation from unexpected failures', async () => {
  const h = await fixture()
  const { products } = await h.mount()
  await h.ctx.plugin(UserQuestions)
  const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
  const controller = new AbortController()
  const reader = call(controller)
  const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: reader }))
  h.inspect.mockImplementationOnce(async () => { controller.abort(); return undefined })
  expect(await client.simulations.inspect({ runId: registration().id })).toMatchObject({ result: { ok: false, error: { code: 'PRODUCT_AUTH_INVALID' } } })
  for (const method of ['list', 'inspect'] as const) {
    const request = { rpcId: RpcId(method), payload: { extra: '/private/credentials' } }
    expect(await withAuthenticatedProductCall(call(), () => api.simulations![method](request as never)))
      .toMatchObject({ result: { error: { code: 'simulation-product-invalid' } } })
    vi.spyOn(products, method).mockRejectedValueOnce(new Error('/private/credentials'))
    const payload = method === 'list' ? {} : { runId: registration().id }
    const result = await withAuthenticatedProductCall(call(), () => api.simulations![method]({ ...request, payload } as never))
    expect(result).toMatchObject({ result: { error: { code: 'internal', details: {} } } })
    expect(JSON.stringify(result)).not.toContain('/private')
  }
})

it('rejects a valid wire observation naming a different product run', async () => {
  const h = await fixture()
  const { products } = await h.mount()
  await h.ctx.plugin(UserQuestions)
  const original = await products.inspect({ runId: registration().id }, call())
  vi.spyOn(products, 'inspect').mockResolvedValueOnce({ ...original, run: { ...original.run, id: 'other-run' as never } })
  const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
  const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
  await expect(client.simulations.inspect({ runId: registration().id })).rejects.toThrow(/does not match/)
})

it('authenticates collection/object reads, preserves stale errors and rechecks retired calls', async () => {
  const h = await worldFixture()
  await h.ctx.plugin(UserQuestions)
  const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
  const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
  Object.assign(h.state.decisions, { first: decision('first', '1'), second: decision('second', '2') })
  const page = await client.simulations.browse({ ...browseInput('decisions'), collection: 'decisions', limit: 1 })
  expect(page.result).toMatchObject({ ok: true, value: { total: 2, items: [{ id: 'first' }] } })
  if (!page.result.ok) throw new Error('Expected authorized decision page')
  const input = { runId: registration().id, collection: 'decisions', id: 'first' as never, section: 'execution' } as const
  expect((await client.simulations.inspectObject(input)).result).toMatchObject({ ok: true, value: { status: 'found' } })
  h.state.revision++
  expect((await client.simulations.browse({ ...browseInput('decisions'), collection: 'decisions', limit: 1, cursor: page.result.value.nextCursor })).result)
    .toMatchObject({ ok: false, error: { code: 'simulation-product-stale' } })
  expect((await client.simulations.inspectObject({ ...input, expectedRevision: h.state.revision - 1 })).result)
    .toMatchObject({ ok: false, error: { code: 'simulation-product-stale' } })
  const controller = new AbortController(); controller.abort()
  expect(await withAuthenticatedProductCall(call(controller), () => api.simulations!.browse({ rpcId: RpcId('retired'), payload: {} as never })))
    .toMatchObject({ result: { ok: false, error: { code: 'PRODUCT_AUTH_INVALID' } } })
  const untrusted = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call(undefined, 'other') }))
  expect((await untrusted.simulations.inspectObject(input)).result).toMatchObject({ ok: false, error: { code: 'simulation-product-forbidden' } })
  expect((await untrusted.simulations.browse(browseInput('entities'))).result).toMatchObject({ ok: false, error: { code: 'simulation-product-forbidden' } })
  delete api.simulations
  expect((await client.simulations.inspectObject(input)).result).toMatchObject({ ok: false, error: { code: 'simulation-product-unavailable' } })
  expect((await client.simulations.browse(browseInput('entities'))).result).toMatchObject({ ok: false, error: { code: 'simulation-product-unavailable' } })
})

it('rejects valid wire pages and details that substitute run, collection, object, section or revision', async () => {
  const h = await worldFixture()
  await h.ctx.plugin(UserQuestions)
  Object.assign(h.state.decisions, { first: decision('first', '1') })
  const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
  const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
  const pageInput = { ...browseInput('decisions'), collection: 'decisions' } as const
  const page = await h.products.browse(pageInput, call())
  for (const value of [{ ...page, runId: 'other' as never }, { ...page, collection: 'entities', items: [] }]) {
    vi.spyOn(h.products, 'browse').mockResolvedValueOnce(value as never)
    await expect(client.simulations.browse(pageInput)).rejects.toThrow(/does not match/)
  }
  const input = { runId: registration().id, collection: 'decisions', id: 'first' as never, section: 'execution',
    expectedRevision: h.state.revision } as const
  const detail = await h.products.inspectObject(input, call())
  for (const value of [{ ...detail, runId: 'other' as never }, { ...detail, snapshotRevision: detail.snapshotRevision + 1 },
    { ...detail, selection: { collection: 'entities', id: 'other', section: 'identity' }, status: 'missing', value: undefined },
    { ...detail, selection: { collection: 'decisions', id: 'other', section: 'execution' }, status: 'missing', value: undefined },
    { ...detail, selection: { collection: 'operations', id: 'first', section: 'attempts' }, status: 'missing', value: undefined }]) {
    vi.spyOn(h.products, 'inspectObject').mockResolvedValueOnce(value as never)
    await expect(client.simulations.inspectObject(input)).rejects.toThrow(/does not match/)
  }
})

it('exposes journal metadata and separately granted original text through the authenticated fetch carrier', async () => {
  const h = await worldFixture()
  h.inspect.mockResolvedValue({ snapshot: h.state, owner: 'unowned', records: [
    { sequence: 0, value: { kind: 'run/created', privateText: 'historical secret' } },
  ] })
  await h.ctx.plugin(UserQuestions)
  const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
  const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
  const input = { runId: registration().id, mode: 'original', sequence: 0 } as const
  const hidden = await client.simulations.records(input)
  expect(hidden).toMatchObject({ result: { ok: true, value: { bodyAccess: 'withheld' } } })
  expect(JSON.stringify(hidden)).not.toContain('historical secret')
  const remove = h.products.recordReaderRegistrar()([{ principalId: 'reader' as never }])
  const allowed = await client.simulations.records(input)
  expect(allowed.result.ok).toBe(true)
  expect(JSON.stringify(allowed)).toContain('historical secret')
  expect((await client.simulations.inspectSource({ runId: registration().id,
    decisionId: 'missing-decision' as never, sourceIndex: 0 })).result)
    .toMatchObject({ ok: true, value: { status: 'missing' } })
  expect((await client.simulations.watch({ runId: registration().id, waitMs: 0 })).result)
    .toMatchObject({ ok: true, value: { runId: registration().id } })
  expect((await client.simulations.runStatuses({ runIds: [registration().id] })).result)
    .toMatchObject({ ok: true, value: { items: [{ run: { id: registration().id } }] } })
  remove()
  expect(JSON.stringify(await client.simulations.records(input))).not.toContain('historical secret')
  expect(h.open).not.toHaveBeenCalled()
})

it('routes catalog, creation, preparation and original receipt reads through the authenticated fetch carrier', async () => {
  const h = await ownerFixture('json')
  try {
    await h.ctx.plugin(UserQuestions)
    const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
    const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
    expect((await client.simulations.catalog({})).result).toMatchObject({ ok: true, value: { items: [{ id: 'company' }] } })
    const created = await client.simulations.create(h.input)
    if (!created.result.ok) throw new Error('Host creation was not accepted')
    const runId = created.result.value.runId
    expect((await h.finished()).status).toBe('completed')
    const preparation = await client.simulations.prepare({ runId, commandId: simulationProductCommandIdSchema.parse('host-prepare') })
    expect(preparation.result.ok).toBe(true)
    expect((await client.simulations.request({ commandId: h.input.commandId })).result)
      .toMatchObject({ ok: true, value: { status: 'found', request: { runId, kind: 'create' } } })
  } finally { await h.close() }
})
