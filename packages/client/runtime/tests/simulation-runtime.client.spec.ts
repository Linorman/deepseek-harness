/** Business caches distinguish connection loss, authority replacement and stale collection continuation. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { SimulationRuntime } from '../src/client/simulations/service.ts'
import { FakeApiClient, ok, err } from './fake-api.client.ts'

const runId = 'registered-run' as never
const page = { items: [{ id: runId, name: { text: 'Recorded run', truncated: false }, registeredAt: 1, observation: 'not-observed' as const }] }
async function fixture() {
  const ctx = new Context()
  const api = new FakeApiClient()
  const runtime = new SimulationRuntime(ctx, api)
  runtime.connected('scope-one' as never)
  return { ctx, api, runtime }
}

it('reads only a bounded unknown preview and leaves the user operation window and execution unchanged', async () => {
  const h = await fixture()
  try {
    const browse = vi.spyOn(h.api.simulations, 'browse').mockResolvedValueOnce(ok({ runId, collection: 'operations',
      selection: { collection: 'operations' }, snapshotRevision: 1, observedAt: 1, items: [] } as never))
    const grant = vi.spyOn(h.api.simulations, 'retryOperation')
    await h.runtime.unknownOperations(runId, 2)
    expect(browse).toHaveBeenCalledWith({ runId, collection: 'operations', status: 'outcome-unknown', limit: 2 }, expect.any(AbortSignal))
    expect(h.runtime.state.getSnapshot().unknownOperations.value?.runId).toBe(runId)
    expect(h.runtime.state.getSnapshot().collection.value).toBeUndefined()
    expect(grant).not.toHaveBeenCalled()
  } finally { await h.ctx.fiber.dispose() }
})

it('retains statuses only for the current ordered directory window and ignores delayed old pages', async () => {
  const h = await fixture()
  try {
    const manage = vi.spyOn(h.api.simulations, 'manage')
    const first = page.items[0]!
    const second = { ...first, id: 'second' as never }
    vi.spyOn(h.api.simulations, 'list').mockResolvedValueOnce(ok({ items: [first], nextCursor: 'next' as never }))
      .mockResolvedValueOnce(ok({ items: [second] }))
    const pending = Promise.withResolvers<ReturnType<typeof ok<{ items: Array<{ run: typeof first; status: 'missing' }> }>>>()
    const statuses = vi.spyOn(h.api.simulations, 'runStatuses').mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(ok({ items: [{ run: second, status: 'missing' }] }))
    const oldRead = h.runtime.directory({})
    await vi.waitFor(() => { expect(statuses).toHaveBeenCalledOnce() })
    await h.runtime.directory({ cursor: 'next' as never })
    expect(statuses.mock.calls[0]?.[1]?.aborted).toBe(true)
    pending.resolve(ok({ items: [{ run: first, status: 'missing' }] })); await oldRead
    expect(h.runtime.state.getSnapshot().statuses.value?.items[0]?.run.id).toBe(second.id)
    await h.runtime.runStatuses({ runIds: [first.id] })
    expect(statuses).toHaveBeenCalledTimes(2)
    expect(statuses.mock.calls[1]?.[0]).toEqual({ runIds: [second.id] })
    expect(manage).not.toHaveBeenCalled()
  } finally { await h.ctx.fiber.dispose() }
})

it('does not send a displaced directory request when retiring status IO synchronously selects another page', async () => {
  const h = await fixture()
  try {
    const second = { ...page.items[0]!, id: 'second' as never }
    const names = vi.spyOn(h.api.simulations, 'list').mockResolvedValueOnce(ok(page))
      .mockResolvedValueOnce(ok({ items: [second] }))
    const statuses = vi.spyOn(h.api.simulations, 'runStatuses').mockResolvedValueOnce(ok({ items: [] }))
    await h.runtime.directory({})
    let replacement: Promise<void> | undefined
    statuses.mockImplementationOnce(async (_input, signal) => await new Promise((resolve) => {
      signal?.addEventListener('abort', () => {
        replacement = h.runtime.directory({ search: 'replacement' })
        resolve(ok({ items: [] }))
      }, { once: true })
    })).mockResolvedValueOnce(ok({ items: [{ run: second, status: 'missing' }] }))
    const pending = h.runtime.runStatuses({ runIds: [runId] })
    await h.runtime.directory({ search: 'displaced' })
    await replacement; await pending
    expect(names.mock.calls.map(([input]) => input.search)).toEqual([undefined, 'replacement'])
    expect(h.runtime.state.getSnapshot().directory.value?.items[0]?.id).toBe(second.id)
    expect(h.runtime.state.getSnapshot().statuses.value?.items[0]?.run.id).toBe(second.id)
  } finally { await h.ctx.fiber.dispose() }
})

it('preserves failed status observations as stale and clears denied metadata before late replies', async () => {
  const h = await fixture()
  try {
    vi.spyOn(h.api.simulations, 'list').mockResolvedValueOnce(ok(page))
    const status = { items: [{ run: page.items[0]!, status: 'missing' as const }] }
    const statuses = vi.spyOn(h.api.simulations, 'runStatuses').mockResolvedValueOnce(ok(status))
      .mockRejectedValueOnce(new Error('Disconnected status read'))
      .mockResolvedValueOnce(err({ code: 'simulation-product-forbidden', message: 'Read grant retired', details: {} }))
    await h.runtime.directory({})
    await h.runtime.runStatuses({ runIds: [runId] })
    expect(h.runtime.state.getSnapshot().statuses).toMatchObject({ value: status, stale: true, error: 'network' })
    await h.runtime.runStatuses({ runIds: [runId] })
    expect(h.runtime.state.getSnapshot().statuses.value).toBeUndefined()
    expect(h.runtime.state.getSnapshot().directory.value).toBeUndefined()
    expect(statuses).toHaveBeenCalledTimes(3)
  } finally { await h.ctx.fiber.dispose() }
})

it('bounds review pages, cancels replaced runs and clears their metadata on authorization replacement', async () => {
  const h = await fixture()
  try {
    const original = { runId, snapshotRevision: 1, observedAt: 1, total: 1, items: [] }
    const delayed = Promise.withResolvers<ReturnType<typeof ok<typeof original>>>()
    const read = vi.spyOn(h.api.simulations, 'listTaskReviews').mockReturnValueOnce(delayed.promise)
      .mockResolvedValueOnce(ok({ ...original, runId: 'new-run' as never }))
    const pending = h.runtime.listTaskReviews({ runId, limit: 1 })
    await h.runtime.listTaskReviews({ runId: 'new-run' as never, limit: 1 })
    expect(read.mock.calls[0]?.[1]?.aborted).toBe(true)
    delayed.resolve(ok(original)); await pending
    expect(h.runtime.state.getSnapshot().reviews.value?.runId).toBe('new-run')
    h.runtime.disconnected()
    expect(h.runtime.state.getSnapshot().reviews).toMatchObject({ stale: true, loading: false, value: { runId: 'new-run' } })
    h.runtime.connected('scope-two' as never)
    expect(h.runtime.state.getSnapshot().reviews.value).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})

it('refuses administrative review reads without withdrawing independently authorized viewing', async () => {
  const h = await fixture()
  try {
    vi.spyOn(h.api.simulations, 'list').mockResolvedValueOnce(ok(page))
    await h.runtime.directory({})
    const generation = h.runtime.state.getSnapshot().authorizationVersion
    vi.spyOn(h.api.simulations, 'listTaskReviews').mockResolvedValueOnce(err({ code: 'simulation-product-forbidden',
      message: 'Administrative review denied', details: {} }))
    await h.runtime.listTaskReviews({ runId, limit: 1 })
    expect(h.runtime.state.getSnapshot().reviews.error).toBe('forbidden')
    expect(h.runtime.state.getSnapshot().directory.value).toEqual(page)
    expect(h.runtime.state.getSnapshot().authorizationVersion).toBe(generation)
  } finally { await h.ctx.fiber.dispose() }
})

it('clears authorized frozen-context text on account replacement and ignores its old pending response', async () => {
  const h = await fixture()
  try {
    const selection = { collection: 'decisions' as const, section: 'context' as const, id: 'decision' as never }
    const data: import('../src/client/simulations/service.ts').SimulationProductObjectInspection = {
      runId, snapshotRevision: 1, observedAt: 1, selection, status: 'found', value: { ...selection, readVersion: 'v1' as never,
        accounting: { status: 'prepared', retainedBytes: 100, maxBytes: 200, knowledgeCount: 0, sourceCount: 0, sectionCount: 1, content: 'withheld' },
        bodyAccess: 'allowed', frozen: { entityId: 'entity' as never, time: '1' as never, slot: '1' as never, epoch: '1' as never,
          projections: { run: 1, entity: 1, team: 1 }, versions: { rules: { text: '1', truncated: false }, policy: { text: '1', truncated: false },
            persona: { text: '1', truncated: false }, model: { text: '1', truncated: false } } },
        items: { total: 1, items: [{ kind: 'section', index: 0, block: 0, section: { text: 'input', truncated: false }, required: true,
          body: { status: 'text', text: 'private-authorized-text', part: 0, parts: 1 } }] } },
    }
    vi.spyOn(h.api.simulations, 'inspectObject').mockResolvedValueOnce(ok(data))
    await h.runtime.inspectObject({ runId, ...selection, limit: 1 })
    expect(h.runtime.state.getSnapshot().object.value).toEqual(data)
    const pending = Promise.withResolvers<ReturnType<typeof ok<typeof data>>>()
    vi.spyOn(h.api.simulations, 'inspectObject').mockReturnValueOnce(pending.promise)
    const reading = h.runtime.inspectObject({ runId, ...selection, limit: 1 })
    h.runtime.connected('scope-two' as never)
    expect(h.runtime.state.getSnapshot().object.value).toBeUndefined()
    pending.resolve(ok(data)); await reading
    expect(h.runtime.state.getSnapshot().object.value).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})

it('retires a pending recovery reference read when a different run is selected', async () => {
  const h = await fixture()
  try {
    const inspect = vi.spyOn(h.api.simulations, 'inspect').mockResolvedValue(ok({ run: page.items[0]!, status: 'missing', observedAt: 1 }))
    await h.runtime.inspect({ runId })
    const pending = Promise.withResolvers<ReturnType<typeof ok<import('../src/client/simulations/service.ts').SimulationProductObjectInspection>>>()
    let signal: AbortSignal | undefined
    vi.spyOn(h.api.simulations, 'inspectObject').mockImplementationOnce((_input, current) => { signal = current; return pending.promise })
    const reading = h.runtime.inspectRecovery({ runId, collection: 'checkpoints', id: 'checkpoint' as never, section: 'references', limit: 1 })
    await h.runtime.inspect({ runId: 'another-run' as never })
    expect(signal?.aborted).toBe(true)
    pending.resolve(ok({ runId, snapshotRevision: 1, observedAt: 1, selection: { collection: 'checkpoints', id: 'checkpoint' as never, section: 'references' }, status: 'missing' }))
    await reading
    expect(h.runtime.state.getSnapshot().recovery).toEqual({ loading: false, stale: false })
    expect(inspect).toHaveBeenCalledTimes(2)
  } finally { await h.ctx.fiber.dispose() }
})

it('retains a page after ordinary read failure or disconnection and clears it on authority replacement', async () => {
  const h = await fixture()
  try {
    vi.spyOn(h.api.simulations, 'list').mockResolvedValueOnce(ok(page))
    await h.runtime.directory({ search: '', limit: 1 })
    expect(h.runtime.state.getSnapshot().directory.value).toEqual(page)
    vi.spyOn(h.api.simulations, 'list').mockRejectedValueOnce(new Error('private-network-diagnostic'))
    await h.runtime.directory({ search: '', limit: 1 })
    expect(h.runtime.state.getSnapshot().directory).toMatchObject({ value: page, loading: false, error: 'network' })
    h.runtime.disconnected()
    expect(h.runtime.state.getSnapshot()).toMatchObject({ connected: false, directory: { value: page, stale: true } })
    h.runtime.connected('scope-one' as never)
    expect(h.runtime.state.getSnapshot().directory.value).toEqual(page)
    h.runtime.connected('scope-two' as never)
    expect(h.runtime.state.getSnapshot().directory.value).toBeUndefined()
    expect(h.ctx.get('simulationRuns')).toBe(h.runtime)
  } finally { await h.ctx.fiber.dispose() }
})

it('discards late responses after query replacement, view pause and authentication withdrawal', async () => {
  const h = await fixture()
  try {
    const old = Promise.withResolvers<ReturnType<typeof ok<typeof page>>>()
    vi.spyOn(h.api.simulations, 'list').mockReturnValueOnce(old.promise).mockResolvedValueOnce(ok({ items: [] }))
    const first = h.runtime.directory({ search: 'old', limit: 1 })
    await h.runtime.directory({ search: 'new', limit: 1 })
    old.resolve(ok(page)); await first
    expect(h.runtime.state.getSnapshot().directory.value).toEqual({ items: [] })
    for (const cancel of [() => { h.runtime.pause() }, () => { h.runtime.clearAuthorization() }]) {
      const pending = Promise.withResolvers<ReturnType<typeof ok<typeof page>>>()
      vi.spyOn(h.api.simulations, 'list').mockReturnValueOnce(pending.promise)
      const reading = h.runtime.directory({ search: 'pending', limit: 1 })
      cancel(); pending.resolve(ok(page)); await reading
      expect(h.runtime.state.getSnapshot().directory.value).not.toEqual(page)
    }
  } finally { await h.ctx.fiber.dispose() }
})

it('keeps stale collection data, clears all affected content on denial and does not read before handshake', async () => {
  const h = await fixture()
  try {
    const data = { runId, collection: 'entities' as const, snapshotRevision: 1, observedAt: 1, total: 0, items: [] }
    vi.spyOn(h.api.simulations, 'browse').mockResolvedValueOnce(ok(data)).mockResolvedValueOnce(err({ code: 'simulation-product-stale', message: 'private', details: {} }))
    await h.runtime.browse({ runId, collection: 'entities', limit: 1 })
    await h.runtime.browse({ runId, collection: 'entities', limit: 1, cursor: 'old' as never })
    expect(h.runtime.state.getSnapshot().collection).toMatchObject({ value: data, stale: true, error: 'stale' })
    vi.spyOn(h.api.simulations, 'inspect').mockResolvedValueOnce(err({ code: 'simulation-product-forbidden', message: 'private', details: {} }))
    await h.runtime.inspect({ runId })
    expect(h.runtime.state.getSnapshot().collection.value).toBeUndefined()
    h.runtime.disconnected()
    const read = vi.spyOn(h.api.simulations, 'list')
    await h.runtime.directory({ limit: 1 })
    expect(read).not.toHaveBeenCalled()
  } finally { await h.ctx.fiber.dispose() }
})

it('keeps a replacement selected synchronously by the cancelled request', async () => {
  const h = await fixture()
  try {
    const old = Promise.withResolvers<ReturnType<typeof ok<typeof page>>>()
    let replacement: Promise<void> | undefined
    const list = vi.spyOn(h.api.simulations, 'list').mockImplementationOnce((_input, signal) => {
      signal?.addEventListener('abort', () => { replacement = h.runtime.directory({ search: 'replacement', limit: 1 }) })
      return old.promise
    }).mockResolvedValueOnce(ok(page))
    const first = h.runtime.directory({ search: 'initial', limit: 1 })
    await h.runtime.directory({ search: 'outer', limit: 1 })
    await replacement
    old.resolve(ok({ items: [] })); await first
    expect(list.mock.calls.map(([input]) => input.search)).toEqual(['initial', 'replacement'])
    expect(h.runtime.state.getSnapshot().directory).toMatchObject({ value: page, scope: '["directory","replacement"]' })
  } finally { await h.ctx.fiber.dispose() }
})

it('does not send work restarted by abort or by a loading-state observer during authority retirement', async () => {
  const h = await fixture()
  try {
    const old = Promise.withResolvers<ReturnType<typeof ok<typeof page>>>()
    const list = vi.spyOn(h.api.simulations, 'list').mockImplementationOnce((_input, signal) => {
      signal?.addEventListener('abort', () => { void h.runtime.directory({ search: 'abort', limit: 1 }) })
      return old.promise
    })
    const first = h.runtime.directory({ limit: 1 })
    h.runtime.clearAuthorization()
    old.resolve(ok(page)); await first
    expect(list).toHaveBeenCalledTimes(1)
    expect(h.runtime.state.getSnapshot()).toMatchObject({ connected: false, directory: { loading: false } })
    h.runtime.connected('scope-two' as never)
    const off = h.runtime.state.subscribe(() => {
      if (h.runtime.state.getSnapshot().directory.loading) h.runtime.disconnected()
    })
    await h.runtime.directory({ search: 'observer', limit: 1 })
    off()
    expect(list).toHaveBeenCalledTimes(1)
    expect(h.runtime.state.getSnapshot().connected).toBe(false)
  } finally { await h.ctx.fiber.dispose() }
})

it('keeps a run selected while dependent inspection state is being cleared', async () => {
  const h = await fixture()
  try {
    const data = { runId, collection: 'entities' as const, snapshotRevision: 1, observedAt: 1, total: 0, items: [] }
    vi.spyOn(h.api.simulations, 'browse').mockResolvedValueOnce(ok(data))
    await h.runtime.browse({ runId, collection: 'entities', limit: 1 })
    const inspect = vi.spyOn(h.api.simulations, 'inspect').mockResolvedValueOnce(ok({ run: page.items[0]!, status: 'missing' }))
    let replacement: Promise<void> | undefined
    let redirected = false
    const off = h.runtime.state.subscribe(() => {
      if (!redirected && h.runtime.state.getSnapshot().collection.value === undefined) {
        redirected = true
        replacement = h.runtime.inspect({ runId })
      }
    })
    await h.runtime.inspect({ runId: 'outer-run' as never })
    await replacement
    off()
    expect(inspect.mock.calls.map(([input]) => input.runId)).toEqual([runId])
    expect(h.runtime.state.getSnapshot().run.value?.run.id).toBe(runId)
  } finally { await h.ctx.fiber.dispose() }
})

it('reads installed templates and scoped controls independently of metadata, and denies auth failures without retaining old content', async () => {
  const h = await fixture()
  try {
    await h.runtime.catalog()
    expect(h.runtime.state.getSnapshot().catalog.value).toEqual({ items: [] })
    const control = { runId, owner: 'not-held', driver: 'idle', inFlight: false, observedAt: 1,
      actions: { start: { allowed: false, reason: 'recovery-required' }, pause: { allowed: false, reason: 'recovery-required' } } }
    const read = vi.spyOn(h.api.simulations, 'control').mockResolvedValue(ok(control) as never)
    await h.runtime.control(runId)
    expect(read).toHaveBeenCalledWith({ runId }, expect.any(AbortSignal))
    expect(h.runtime.state.getSnapshot().control.value).toEqual(control)
    h.runtime.disconnected()
    expect(h.runtime.state.getSnapshot().control.stale).toBe(true)
    for (const code of ['PRODUCT_AUTH_INVALID', 'PRODUCT_AUTH_REQUIRED'] as const) {
      h.runtime.connected('scope-one' as never)
      vi.spyOn(h.api.simulations, 'catalog').mockResolvedValueOnce(err({ code, message: 'Secret', details: {} }) as never)
      await h.runtime.catalog()
      expect(h.runtime.state.getSnapshot().connected).toBe(false)
      expect(h.runtime.state.getSnapshot().control.value).toBeUndefined()
    }
  } finally { await h.ctx.fiber.dispose() }
})

it('retains exact object pages and classifies unavailable, invalid and internal responses without exposing messages', async () => {
  const h = await fixture()
  try {
    const selection = { runId, collection: 'entities' as const, id: 'entity' as never, section: 'identity' as const }
    const object = { runId, selection: { collection: 'entities', id: 'entity', section: 'identity' },
      snapshotRevision: 1, observedAt: 1, status: 'missing' }
    vi.spyOn(h.api.simulations, 'inspectObject').mockResolvedValueOnce(ok(object) as never)
    await h.runtime.inspectObject(selection)
    expect(h.runtime.state.getSnapshot().object.value).toEqual(object)
    h.runtime.closeObject(); expect(h.runtime.state.getSnapshot().object.value).toBeUndefined()
    for (const [code, category] of [['simulation-product-unavailable', 'unavailable'], ['simulation-product-invalid', 'invalid'],
      ['bad-request', 'invalid'], ['internal', 'internal']] as const) {
      vi.spyOn(h.api.simulations, 'inspectObject').mockResolvedValueOnce(err({ code, message: 'Secret', details: {} } as never))
      await h.runtime.inspectObject(selection)
      expect(h.runtime.state.getSnapshot().object.error).toBe(category)
      expect(JSON.stringify(h.runtime.state.getSnapshot())).not.toContain('Secret')
    }
    const failed = Promise.withResolvers<ReturnType<typeof ok<typeof page>>>()
    vi.spyOn(h.api.simulations, 'list').mockReturnValueOnce(failed.promise)
    const pending = h.runtime.directory({ limit: 1 })
    h.runtime.disconnected(); failed.reject(new Error('Cancelled'))
    await pending
    expect(h.runtime.state.getSnapshot().directory.error).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})

it('prevents dependent-clear callbacks and abort callbacks from replacing run selections during retirement', async () => {
  const h = await fixture()
  try {
    const response = Promise.withResolvers<ReturnType<typeof ok<typeof page>>>()
    vi.spyOn(h.api.simulations, 'list').mockImplementationOnce((_input, signal) => {
      signal?.addEventListener('abort', () => { void h.runtime.inspect({ runId }) })
      return response.promise
    })
    const reading = h.runtime.directory({ limit: 1 })
    const inspect = vi.spyOn(h.api.simulations, 'inspect')
    h.runtime.clearAuthorization()
    response.resolve(ok(page)); await reading
    expect(inspect).not.toHaveBeenCalled()
    h.runtime.connected('scope-one' as never)
    for (const target of ['run', 'collection', 'object'] as const) {
      const unresolved = Promise.withResolvers<ReturnType<FakeApiClient['simulations']['inspect']> extends Promise<infer T> ? T : never>()
      const cancel = (_input: unknown, signal?: AbortSignal) => {
        signal?.addEventListener('abort', () => { void h.runtime.inspect({ runId }) })
        return unresolved.promise
      }
      let pending: Promise<void>
      if (target === 'run') { inspect.mockImplementationOnce(cancel); pending = h.runtime.inspect({ runId: 'old' as never }) }
      else if (target === 'collection') { vi.spyOn(h.api.simulations, 'browse').mockImplementationOnce(cancel as never)
        pending = h.runtime.browse({ runId, collection: 'entities' }) }
      else { vi.spyOn(h.api.simulations, 'inspectObject').mockImplementationOnce(cancel as never)
        pending = h.runtime.inspectObject({ runId, collection: 'entities', id: 'old' as never, section: 'identity' }) }
      inspect.mockResolvedValue(ok({ run: page.items[0]!, status: 'missing' }))
      await h.runtime.inspect({ runId: 'outer' as never })
      unresolved.resolve(ok({ run: page.items[0]!, status: 'missing' })); await pending
      expect(h.runtime.state.getSnapshot().run.value?.run.id).toBe(runId)
    }
  } finally { await h.ctx.fiber.dispose() }
})

it('preserves an inspector replacement selected by an abort callback during dismissal', async () => {
  const h = await fixture()
  try {
    const old = Promise.withResolvers<Awaited<ReturnType<FakeApiClient['simulations']['inspectObject']>>>()
    const selection = { runId, collection: 'entities' as const, id: 'new' as never, section: 'identity' as const }
    const value = { runId, selection: { collection: 'entities', id: 'new', section: 'identity' },
      snapshotRevision: 1, observedAt: 1, status: 'missing' }
    let replacement: Promise<void> | undefined
    vi.spyOn(h.api.simulations, 'inspectObject').mockImplementationOnce((_input, signal) => {
      signal?.addEventListener('abort', () => { replacement = h.runtime.inspectObject(selection) })
      return old.promise
    }).mockResolvedValueOnce(ok(value) as never)
    const pending = h.runtime.inspectObject({ ...selection, id: 'old' as never })
    h.runtime.closeObject(); await replacement
    old.resolve(ok(value) as never); await pending
    expect(h.runtime.state.getSnapshot().object.value).toEqual(value)
  } finally { await h.ctx.fiber.dispose() }
})

it('preserves separately authorized metadata when a viewing run lacks administrative control access', async () => {
  const h = await fixture()
  try {
    const run = { run: page.items[0]!, status: 'missing' as const }
    vi.spyOn(h.api.simulations, 'inspect').mockResolvedValueOnce(ok(run))
    await h.runtime.inspect({ runId })
    const version = h.runtime.state.getSnapshot().authorizationVersion
    vi.spyOn(h.api.simulations, 'control').mockResolvedValueOnce(err({ code: 'simulation-product-forbidden', message: 'Denied', details: {} }))
    await h.runtime.control(runId)
    expect(h.runtime.state.getSnapshot().run.value).toEqual(run)
    expect(h.runtime.state.getSnapshot().authorizationVersion).toBe(version)
    expect(h.runtime.state.getSnapshot().control).toMatchObject({ error: 'forbidden', loading: false, stale: false })
    expect(h.runtime.state.getSnapshot().control.value).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})

it('keeps recovery references independent of the browsing inspector and retires them on disconnect, account change or close', async () => {
  const h = await fixture()
  try {
    const selection = { runId, collection: 'checkpoints' as const, id: 'anchor' as never, section: 'references' as const, limit: 1 }
    const value = { runId, selection: { collection: 'checkpoints', id: 'anchor', section: 'references' },
      snapshotRevision: 1, observedAt: 1, status: 'missing' }
    const read = vi.spyOn(h.api.simulations, 'inspectObject').mockResolvedValueOnce(ok(value) as never)
    await h.runtime.inspectRecovery(selection)
    expect(read).toHaveBeenCalledWith(selection, expect.any(AbortSignal))
    expect(h.runtime.state.getSnapshot().object.value).toBeUndefined()
    expect(h.runtime.state.getSnapshot().recovery.value).toEqual(value)
    h.runtime.disconnected(); expect(h.runtime.state.getSnapshot().recovery.stale).toBe(true)
    h.runtime.connected('scope-one' as never)
    h.runtime.closeRecovery(); expect(h.runtime.state.getSnapshot().recovery.value).toBeUndefined()
    const old = Promise.withResolvers<Awaited<ReturnType<FakeApiClient['simulations']['inspectObject']>>>()
    let replacement: Promise<void> | undefined
    read.mockImplementationOnce((_input, signal) => {
      signal?.addEventListener('abort', () => { replacement = h.runtime.inspectRecovery(selection) })
      return old.promise
    }).mockResolvedValueOnce(ok(value) as never)
    const pending = h.runtime.inspectRecovery({ ...selection, id: 'old' as never })
    h.runtime.closeRecovery(); await replacement
    old.resolve(ok(value) as never); await pending
    expect(h.runtime.state.getSnapshot().recovery.value).toEqual(value)
    h.runtime.connected('replacement' as never)
    expect(h.runtime.state.getSnapshot().recovery.value).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})
