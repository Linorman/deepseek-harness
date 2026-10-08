/** Simulation read owners preserve selection, authority, and observer lifetimes across reentrant callbacks. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { SimulationRuntime } from '../src/client/simulations/service.ts'
import type { SimulationProductPreflightInput } from '../src/client/simulations/service.ts'
import { FakeApiClient, ok, err } from './fake-api.client.ts'

const runId = 'edge-run' as never
const preflight: SimulationProductPreflightInput = { templateId: 'company' as never, templateVersion: '1', name: 'Edge draft',
  parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' }, limits: { maxTime: '100' } }
const ready = { status: 'invalid' as const, readiness: { status: 'ready' as const, model: { provider: 'company', name: 'scripted' } }, issues: [] }

function fixture() {
  const ctx = new Context(), api = new FakeApiClient(), runtime = new SimulationRuntime(ctx, api)
  runtime.connected('edge-authority' as never)
  return { ctx, api, runtime }
}

it('retains public object metadata across pauses and same-authority reconnection, then clears it on replacement', async () => {
  const h = fixture()
  try {
    const selection = { runId, collection: 'entities' as const, id: 'entity' as never, section: 'identity' as const }
    const page = { runId, snapshotRevision: 1, observedAt: 1, selection, status: 'found', value: { ...selection } }
    vi.spyOn(h.api.simulations, 'inspectObject').mockResolvedValue(ok(page as never))
    await h.runtime.inspectObject(selection)
    expect(h.runtime.state.getSnapshot().object.value).toEqual(page)
    h.runtime.pause()
    expect(h.runtime.state.getSnapshot().object.value).toEqual(page)
    h.runtime.disconnected()
    h.runtime.connected('edge-authority' as never)
    expect(h.runtime.state.getSnapshot().object.value).toEqual(page)
    h.runtime.connected('new-authority' as never)
    expect(h.runtime.state.getSnapshot().object.value).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})

it('withdraws a frozen context page when the view pauses, reconnects, or begins a policy watch', async () => {
  const h = fixture()
  try {
    const selection = { runId, collection: 'decisions' as const, id: 'decision' as never, section: 'context' as const }
    const page = { runId, snapshotRevision: 1, observedAt: 1, selection, status: 'found', value: {
      ...selection, readVersion: 'v1', accounting: { status: 'absent' }, bodyAccess: 'withheld', items: { total: 0, items: [] },
    } }
    vi.spyOn(h.api.simulations, 'inspectObject').mockResolvedValue(ok(page as never))
    await h.runtime.inspectObject(selection)
    h.runtime.pause()
    expect(h.runtime.state.getSnapshot().object).toMatchObject({ loading: false, stale: true })
    expect(h.runtime.state.getSnapshot().object.value).toBeUndefined()
    await h.runtime.inspectObject(selection)
    h.runtime.connected('edge-authority' as never)
    expect(h.runtime.state.getSnapshot().object.value).toBeUndefined()
    await h.runtime.inspectObject(selection)
    vi.spyOn(h.api.simulations, 'watch').mockImplementation(async (_input, signal) => await new Promise((resolve) => {
      signal?.addEventListener('abort', () => { resolve(err({ code: 'internal', message: 'Stopped', details: {} })) }, { once: true })
    }))
    const stop = h.runtime.observe(runId, { waitMs: 1, retryMs: 1 })
    expect(h.runtime.state.getSnapshot().object.value).toBeUndefined()
    expect(h.runtime.state.getSnapshot().object.scope).toBe(JSON.stringify([runId, 'decisions', selection.id, 'context']))
    stop()
  } finally { await h.ctx.fiber.dispose() }
})

it('leaves a replacement preflight selected when an abort listener starts it during close', async () => {
  const h = fixture()
  try {
    const old = Promise.withResolvers<ReturnType<typeof ok<typeof ready>>>()
    const check = vi.spyOn(h.api.simulations, 'preflight').mockImplementationOnce((_input, signal) => {
      signal?.addEventListener('abort', () => { void h.runtime.preflight({ ...preflight, name: 'Replacement draft' }) }, { once: true })
      return old.promise
    }).mockResolvedValue(ok(ready))
    const first = h.runtime.preflight(preflight)
    h.runtime.closePreflight()
    old.resolve(ok(ready))
    expect(await first).toBeUndefined()
    await vi.waitFor(() => { expect(h.runtime.state.getSnapshot().preflight.value).toEqual(ready) })
    expect(h.runtime.state.getSnapshot().preflight.scope).toBe(JSON.stringify({ ...preflight, name: 'Replacement draft' }))
    expect(check).toHaveBeenCalledTimes(2)
  } finally { await h.ctx.fiber.dispose() }
})

it('refuses observers while disconnected, validates timers, and preserves a replacement against an old disposer', async () => {
  const h = fixture()
  const watchers: Array<AbortSignal> = []
  try {
    const watch = vi.spyOn(h.api.simulations, 'watch').mockImplementation(async (_input, signal) => {
      if (signal === undefined) throw new Error('Observer has no cancellation signal')
      watchers.push(signal)
      return await new Promise((resolve) => { signal.addEventListener('abort', () => {
        resolve(err({ code: 'internal', message: 'Closed observer', details: {} }))
      }, { once: true }) })
    })
    h.runtime.disconnected()
    h.runtime.observe(runId, { waitMs: 1, retryMs: 1 })()
    expect(watch).not.toHaveBeenCalled()
    h.runtime.connected('edge-authority' as never)
    for (const options of [{ waitMs: 0, retryMs: 1 }, { waitMs: 1, retryMs: 0 },
      { waitMs: 1.5, retryMs: 1 }, { waitMs: 1, retryMs: 2147483648 }]) {
      expect(() => h.runtime.observe(runId, options)).toThrow('Invalid Simulation observation timer')
    }
    const stopOld = h.runtime.observe(runId, { waitMs: 1, retryMs: 10 })
    await vi.waitFor(() => { expect(watch).toHaveBeenCalledOnce() })
    const stopCurrent = h.runtime.observe('replacement-run' as never, { waitMs: 1, retryMs: 10 })
    await vi.waitFor(() => { expect(watch).toHaveBeenCalledTimes(2) })
    stopOld()
    expect(h.runtime.state.getSnapshot().observation.scope).toBe(JSON.stringify(['watch', 'replacement-run']))
    stopCurrent()
    expect(watchers.every(signal => signal.aborted)).toBe(true)
  } finally { await h.ctx.fiber.dispose() }
})

it.each(['changed', 'failed'] as const)('ignores a noncooperative old watch %s after a replacement starts', async (outcome) => {
  const h = fixture()
  const old = Promise.withResolvers<unknown>()
  try {
    const watch = vi.spyOn(h.api.simulations, 'watch').mockImplementation(async (input, signal) => {
      if (input.runId === runId) return await old.promise as never
      return await new Promise((resolve) => {
        signal?.addEventListener('abort', () => {
          resolve(err({ code: 'internal', message: 'Stopped', details: {} }))
        }, { once: true })
      })
    })
    const stopOld = h.runtime.observe(runId, { waitMs: 1, retryMs: 10 })
    await vi.waitFor(() => { expect(watch).toHaveBeenCalledOnce() })
    const replacement = 'replacement-run' as typeof runId
    const stopNew = h.runtime.observe(replacement, { waitMs: 1, retryMs: 10 })
    await vi.waitFor(() => { expect(watch).toHaveBeenCalledTimes(2) })
    old.resolve(outcome === 'changed' ? ok({ runId, readVersion: 'old' as never, cursor: 'old' as never,
      status: 'changed', observedAt: 1, world: { status: 'missing' } })
      : err({ code: 'internal', message: 'Old watch failed', details: {} }))
    await Promise.resolve(); await Promise.resolve()
    expect(h.runtime.state.getSnapshot().observation.scope).toBe(JSON.stringify(['watch', replacement]))
    expect(h.runtime.state.getSnapshot().observation.value).toBeUndefined()
    expect(h.runtime.state.getSnapshot().observation.error).toBeUndefined()
    stopOld(); stopNew()
  } finally { await h.ctx.fiber.dispose() }
})

const readRaces: Array<{ name: string
  start: (h: ReturnType<typeof fixture>) => Promise<void>
  block: (h: ReturnType<typeof fixture>, hold: (signal?: AbortSignal) => Promise<never>) => void
}> = [
  { name: 'unknown operations', start: h => h.runtime.unknownOperations(runId, 1),
    block: (h, hold) => { vi.spyOn(h.api.simulations, 'browse').mockImplementationOnce((_input, signal) => hold(signal)) } },
  { name: 'reviews', start: h => h.runtime.listTaskReviews({ runId, limit: 1 }),
    block: (h, hold) => { vi.spyOn(h.api.simulations, 'listTaskReviews').mockImplementationOnce((_input, signal) => hold(signal)) } },
  { name: 'tasks', start: h => h.runtime.listTasks({ runId, limit: 1 }),
    block: (h, hold) => { vi.spyOn(h.api.simulations, 'listTasks').mockImplementationOnce((_input, signal) => hold(signal)) } },
  { name: 'requests', start: h => h.runtime.listRequests({ runId, limit: 1 }),
    block: (h, hold) => { vi.spyOn(h.api.simulations, 'listRequests').mockImplementationOnce((_input, signal) => hold(signal)) } },
  { name: 'collection', start: h => h.runtime.browse({ runId, collection: 'entities' }),
    block: (h, hold) => { vi.spyOn(h.api.simulations, 'browse').mockImplementationOnce((_input, signal) => hold(signal)) } },
  { name: 'object', start: h => h.runtime.inspectObject({ runId, collection: 'entities', id: 'entity' as never, section: 'identity' }),
    block: (h, hold) => { vi.spyOn(h.api.simulations, 'inspectObject').mockImplementationOnce((_input, signal) => hold(signal)) } },
  { name: 'recovery', start: h => h.runtime.inspectRecovery({ runId, collection: 'checkpoints', id: 'cut' as never, section: 'references' }),
    block: (h, hold) => { vi.spyOn(h.api.simulations, 'inspectObject').mockImplementationOnce((_input, signal) => hold(signal)) } },
  { name: 'records', start: h => h.runtime.readRecords({ runId, mode: 'metadata' }),
    block: (h, hold) => { vi.spyOn(h.api.simulations, 'records').mockImplementationOnce((_input, signal) => hold(signal)) } },
  { name: 'record body', start: h => h.runtime.readRecords({ runId, mode: 'original' }),
    block: (h, hold) => { vi.spyOn(h.api.simulations, 'records').mockImplementationOnce((_input, signal) => hold(signal)) } },
]

it.each(readRaces)('does not send a displaced run inspection after aborting $name', async ({ start, block }) => {
  const h = fixture()
  try {
    const inspect = vi.spyOn(h.api.simulations, 'inspect').mockResolvedValue(ok({ runId, status: 'missing', observedAt: 1 } as never))
    await h.runtime.inspect({ runId })
    const replacementId = 'replacement-run' as never
    let replacement: Promise<void> | undefined
    block(h, signal => new Promise<never>((resolve) => {
      signal?.addEventListener('abort', () => {
        replacement = h.runtime.inspect({ runId: replacementId })
        resolve(ok({}) as never)
      }, { once: true })
    }))
    const pending = start(h)
    await h.runtime.inspect({ runId: 'displaced-run' as never })
    await replacement; await pending
    expect(inspect.mock.calls.map(([input]) => input.runId)).toEqual([runId, replacementId])
    expect(h.runtime.state.getSnapshot().run.scope).toBe(JSON.stringify(['run', replacementId]))
  } finally { await h.ctx.fiber.dispose() }
})

it.each([
  { code: 'PRODUCT_AUTH_INVALID', expected: 'cleared' },
  { code: 'simulation-product-forbidden', expected: 'forbidden' },
] as const)('withdraws a run after a $code watch refusal', async ({ code, expected }) => {
  const h = fixture()
  try {
    const page = { items: [{ id: runId, name: { text: 'Run', truncated: false }, registeredAt: 1, observation: 'not-observed' }] }
    vi.spyOn(h.api.simulations, 'list').mockResolvedValue(ok(page as never))
    vi.spyOn(h.api.simulations, 'runStatuses').mockResolvedValue(ok({ items: [] } as never))
    await h.runtime.directory({})
    const version = h.runtime.state.getSnapshot().authorizationVersion
    vi.spyOn(h.api.simulations, 'watch').mockResolvedValueOnce(err({ code, message: 'Authority retired', details: {} }))
      .mockImplementation(async (_input, signal) => await new Promise((resolve) => {
        signal?.addEventListener('abort', () => { resolve(err({ code: 'internal', message: 'Stopped', details: {} })) }, { once: true })
      }))
    const stop = h.runtime.observe(runId, { waitMs: 1, retryMs: 5 })
    await vi.waitFor(() => { expect(h.runtime.state.getSnapshot().authorizationVersion).toBeGreaterThan(version) })
    expect(h.runtime.state.getSnapshot().directory.value).toBeUndefined()
    if (expected === 'forbidden') expect(h.runtime.state.getSnapshot().run.error).toBe('forbidden')
    else expect(h.runtime.state.getSnapshot().connected).toBe(false)
    stop()
  } finally { await h.ctx.fiber.dispose() }
})

it('withdraws product authority when a journal export receives an explicit Host permission refusal', async () => {
  const h = fixture()
  try {
    vi.spyOn(h.api.simulations, 'inspect').mockResolvedValue(ok({ runId, status: 'missing', observedAt: 1 } as never))
    await h.runtime.inspect({ runId })
    const watchValue = { runId, readVersion: 'v1' as never, cursor: 'watch-1' as never, status: 'changed' as const,
      observedAt: 1, world: { status: 'observed' as const, revision: 1 } }
    vi.spyOn(h.api.simulations, 'watch').mockResolvedValueOnce(ok(watchValue))
      .mockImplementation(async (_input, signal) => await new Promise((resolve) => {
        signal?.addEventListener('abort', () => { resolve(err({ code: 'internal', message: 'Stopped', details: {} })) }, { once: true })
      }))
    const stop = h.runtime.observe(runId, { waitMs: 1, retryMs: 5 })
    await vi.waitFor(() => { expect(h.runtime.state.getSnapshot().observation.value?.readVersion).toBe('v1') })
    const exporter = h.runtime.recordExporter(h.ctx, { maxBytes: 4096, maxPages: 2, pageSize: 2 })
    const version = h.runtime.state.getSnapshot().authorizationVersion
    vi.spyOn(h.api.simulations, 'records').mockResolvedValueOnce(err({
      code: 'simulation-product-forbidden', message: 'Journal permission retired', details: {},
    }))
    const deliver = vi.fn()
    await exporter.start({ runId, mode: 'metadata' }, deliver)
    expect(deliver).not.toHaveBeenCalled()
    expect(h.runtime.state.getSnapshot().authorizationVersion).toBeGreaterThan(version)
    expect(h.runtime.state.getSnapshot().run.error).toBe('forbidden')
    stop()
  } finally { await h.ctx.fiber.dispose() }
})

it('withdraws product authority when a watched source loses its independent Team read grant', async () => {
  const h = fixture()
  try {
    vi.spyOn(h.api.simulations, 'inspect').mockResolvedValue(ok({ runId, status: 'missing', observedAt: 1 } as never))
    await h.runtime.inspect({ runId })
    const watchValue = { runId, readVersion: 'v1' as never, cursor: 'watch-1' as never, status: 'changed' as const,
      observedAt: 1, world: { status: 'observed' as const, revision: 1 } }
    vi.spyOn(h.api.simulations, 'watch').mockResolvedValueOnce(ok(watchValue))
      .mockImplementation(async (_input, signal) => await new Promise((resolve) => {
        signal?.addEventListener('abort', () => { resolve(err({ code: 'internal', message: 'Stopped', details: {} })) }, { once: true })
      }))
    const stopObservation = h.runtime.observe(runId, { waitMs: 1, retryMs: 5 })
    await vi.waitFor(() => { expect(h.runtime.state.getSnapshot().observation.value?.readVersion).toBe('v1') })
    const before = h.runtime.state.getSnapshot().authorizationVersion
    vi.spyOn(h.api.simulations, 'inspectSource').mockResolvedValueOnce(err({
      code: 'simulation-product-forbidden', message: 'Team read grant retired', details: {},
    }))
    const stopSource = h.runtime.watchSource({ runId, decisionId: 'decision' as never, sourceIndex: 0 }, 100)
    await vi.waitFor(() => { expect(h.runtime.state.getSnapshot().authorizationVersion).toBeGreaterThan(before) })
    expect(h.runtime.state.getSnapshot().run.error).toBe('forbidden')
    expect(h.runtime.state.getSnapshot().source.value).toBeUndefined()
    stopSource(); stopObservation()
  } finally { await h.ctx.fiber.dispose() }
})

it('does not preflight or read statuses after disconnection', async () => {
  const h = fixture()
  try {
    const check = vi.spyOn(h.api.simulations, 'preflight')
    const statuses = vi.spyOn(h.api.simulations, 'runStatuses')
    h.runtime.disconnected()
    expect(await h.runtime.preflight(preflight)).toBeUndefined()
    await h.runtime.runStatuses({ runIds: [runId] })
    expect(check).not.toHaveBeenCalled()
    expect(statuses).not.toHaveBeenCalled()
  } finally { await h.ctx.fiber.dispose() }
})

it('clears both journal windows when the complete records view closes', async () => {
  const h = fixture()
  try {
    const base = { runId, snapshotRevision: 1, observedAt: 1, readVersion: 'v1', totalRecords: 0,
      selection: {}, items: [], bodyAccess: 'withheld' }
    const records = vi.spyOn(h.api.simulations, 'records').mockResolvedValueOnce(ok({ ...base, mode: 'metadata' } as never))
      .mockResolvedValueOnce(ok({ ...base, mode: 'original' } as never))
    await h.runtime.readRecords({ runId, mode: 'metadata' })
    await h.runtime.readRecords({ runId, mode: 'original' })
    expect(h.runtime.state.getSnapshot().records.value).toBeDefined()
    expect(h.runtime.state.getSnapshot().record.value).toBeDefined()
    h.runtime.closeRecords()
    expect(h.runtime.state.getSnapshot().records.value).toBeUndefined()
    expect(h.runtime.state.getSnapshot().record.value).toBeUndefined()
    expect(records).toHaveBeenCalledTimes(2)
  } finally { await h.ctx.fiber.dispose() }
})

it('keeps exact selected knowledge revisions separate across late object pages', async () => {
  const h = fixture()
  try {
    const selected = { runId, collection: 'decisions' as const, id: 'decision' as never, section: 'knowledge' as const }
    const first = { ...selected, reference: { id: 'knowledge' as never, revision: 1 } }
    const second = { ...selected, reference: { id: 'knowledge' as never, revision: 2 } }
    const pending = Promise.withResolvers<ReturnType<typeof ok<unknown>>>()
    const inspect = vi.spyOn(h.api.simulations, 'inspectObject').mockReturnValueOnce(pending.promise as never)
      .mockResolvedValueOnce(ok({ runId, selection: second, status: 'missing', snapshotRevision: 2, observedAt: 2 } as never))
    const old = h.runtime.inspectObject(first)
    await h.runtime.inspectObject(second)
    pending.resolve(ok({ runId, selection: first, status: 'missing', snapshotRevision: 1, observedAt: 1 }))
    await old
    expect(inspect.mock.calls[0]?.[1]?.aborted).toBe(true)
    expect(h.runtime.state.getSnapshot().object.value?.selection).toEqual(second)
    expect(h.runtime.state.getSnapshot().object.scope).toContain('knowledge')
  } finally { await h.ctx.fiber.dispose() }
})

it('does not send reads selected synchronously inside a state transition or an aborting read', async () => {
  const h = fixture()
  try {
    const catalog = vi.spyOn(h.api.simulations, 'catalog')
    const stop = h.runtime.state.subscribe(() => { void h.runtime.catalog() })
    h.runtime.connected('edge-authority' as never)
    stop()
    expect(catalog).not.toHaveBeenCalled()
    const pending = Promise.withResolvers<ReturnType<typeof ok<unknown>>>()
    catalog.mockImplementationOnce((_input, signal) => {
      signal?.addEventListener('abort', () => { h.runtime.disconnected() }, { once: true })
      return pending.promise as never
    })
    const first = h.runtime.catalog()
    await h.runtime.catalog()
    pending.resolve(ok({ templates: [] }))
    await first
    expect(catalog).toHaveBeenCalledTimes(1)
    expect(h.runtime.state.getSnapshot().connected).toBe(false)
  } finally { await h.ctx.fiber.dispose() }
})

it('does not send a displaced run inspection after cancelling a pending status batch', async () => {
  const h = fixture()
  try {
    vi.spyOn(h.api.simulations, 'list').mockResolvedValue(ok({ items: [{ id: runId }] } as never))
    const statuses = vi.spyOn(h.api.simulations, 'runStatuses').mockResolvedValueOnce(ok({ items: [] } as never))
    await h.runtime.directory({})
    const pending = Promise.withResolvers<ReturnType<typeof ok<unknown>>>()
    let replacement: Promise<void> | undefined
    statuses.mockImplementationOnce((_input, signal) => {
      signal?.addEventListener('abort', () => {
        replacement = h.runtime.inspect({ runId: 'replacement-run' as never })
        pending.resolve(ok({ items: [] }))
      }, { once: true })
      return pending.promise as never
    })
    const inspect = vi.spyOn(h.api.simulations, 'inspect').mockResolvedValue(ok({ runId: 'replacement-run', status: 'missing' } as never))
    const reading = h.runtime.runStatuses({ runIds: [runId] })
    await h.runtime.inspect({ runId: 'displaced-run' as never })
    await replacement; await reading
    expect(inspect.mock.calls.map(([input]) => input.runId)).toEqual(['replacement-run'])
    expect(h.runtime.state.getSnapshot().run.scope).toBe(JSON.stringify(['run', 'replacement-run']))
  } finally { await h.ctx.fiber.dispose() }
})

it('publishes a stale inspector before aborting its pending body read for a new watch', async () => {
  const h = fixture()
  try {
    const pending = Promise.withResolvers<ReturnType<typeof ok<unknown>>>()
    let readSignal: AbortSignal | undefined
    vi.spyOn(h.api.simulations, 'inspectObject').mockImplementationOnce((_input, signal) => {
      readSignal = signal
      return pending.promise as never
    })
    const reading = h.runtime.inspectObject({ runId, collection: 'decisions', id: 'decision' as never, section: 'context' })
    vi.spyOn(h.api.simulations, 'watch').mockImplementation(async (_input, signal) => await new Promise((resolve) => {
      signal?.addEventListener('abort', () => { resolve(err({ code: 'internal', message: 'Stopped', details: {} })) }, { once: true })
    }))
    const stop = h.runtime.observe(runId, { waitMs: 1, retryMs: 5 })
    expect(readSignal?.aborted).toBe(true)
    expect(h.runtime.state.getSnapshot().object).toMatchObject({ loading: false, stale: true })
    pending.resolve(ok({ runId, selection: { collection: 'decisions', id: 'decision', section: 'context' }, status: 'missing' }))
    await reading
    expect(h.runtime.state.getSnapshot().object.value).toBeUndefined()
    stop()
  } finally { await h.ctx.fiber.dispose() }
})

it('drains observer ownership when a client snapshot subscriber throws twice', async () => {
  const h = fixture()
  const response = Promise.withResolvers<ReturnType<typeof ok<unknown>>>()
  let stop = () => {}, unsubscribe = () => {}
  try {
    vi.spyOn(h.api.simulations, 'watch').mockReturnValueOnce(response.promise as never)
    stop = h.runtime.observe(runId, { waitMs: 1, retryMs: 1 })
    let notifications = 0
    unsubscribe = h.runtime.state.subscribe(() => {
      notifications += 1
      throw new Error('consumer snapshot listener failed')
    })
    response.resolve(ok({ runId, readVersion: 'v1', cursor: 'watch' as never, status: 'changed', observedAt: 1,
      world: { status: 'observed', revision: 1 } }))
    await vi.waitFor(() => { expect(notifications).toBeGreaterThanOrEqual(2) })
    unsubscribe()
    stop()
    await expect(h.ctx.fiber.dispose()).resolves.toBeUndefined()
  } finally { unsubscribe(); stop(); response.resolve(ok({})); await h.ctx.fiber.dispose() }
})

it('clears record policy pages on version replacement and marks current metadata stale when world observation disappears', async () => {
  const h = fixture()
  const first = { runId, readVersion: 'v1' as never, cursor: 'first' as never, status: 'changed' as const,
    observedAt: 1, world: { status: 'observed' as const, revision: 1 } }
  const second = { ...first, readVersion: 'v2' as never, cursor: 'second' as never,
    world: { status: 'observed' as const, revision: 2 } }
  const third = { ...second, cursor: 'third' as never, world: { status: 'unavailable' as const } }
  const next = Promise.withResolvers<ReturnType<typeof ok<typeof second>>>()
  const unavailable = Promise.withResolvers<ReturnType<typeof ok<typeof third>>>()
  let stop = () => {}
  try {
    vi.spyOn(h.api.simulations, 'watch').mockResolvedValueOnce(ok(first)).mockReturnValueOnce(next.promise)
      .mockReturnValueOnce(unavailable.promise).mockImplementation(async (_input, signal) => await new Promise((resolve) => {
        signal?.addEventListener('abort', () => { resolve(err({ code: 'internal', message: 'Stopped', details: {} })) }, { once: true })
      }))
    stop = h.runtime.observe(runId, { waitMs: 1, retryMs: 1 })
    await vi.waitFor(() => { expect(h.runtime.state.getSnapshot().observation.value?.readVersion).toBe('v1') })
    vi.spyOn(h.api.simulations, 'inspect').mockResolvedValue(ok({ runId, snapshotRevision: 1,
      status: 'found', world: { revision: 1 } } as never))
    await h.runtime.inspect({ runId })
    const records = vi.spyOn(h.api.simulations, 'records').mockResolvedValue(ok({ runId, snapshotRevision: 1,
      observedAt: 1, readVersion: 'v1', mode: 'metadata', totalRecords: 0, selection: {}, items: [], bodyAccess: 'withheld' } as never))
    await h.runtime.readRecords({ runId, mode: 'metadata' })
    records.mockResolvedValueOnce(ok({ runId, snapshotRevision: 1, observedAt: 1, readVersion: 'v1',
      mode: 'original', totalRecords: 0, selection: {}, items: [], bodyAccess: 'allowed' } as never))
    await h.runtime.readRecords({ runId, mode: 'original' })
    expect(h.runtime.state.getSnapshot().record.value).toBeDefined()
    next.resolve(ok(second))
    await vi.waitFor(() => { expect(h.runtime.state.getSnapshot().observation.value?.readVersion).toBe('v2') })
    expect(h.runtime.state.getSnapshot().records).toMatchObject({ stale: true, value: { readVersion: 'v1' } })
    expect(h.runtime.state.getSnapshot().record.value).toBeUndefined()
    expect(h.runtime.state.getSnapshot().run.stale).toBe(true)
    await h.runtime.inspect({ runId })
    expect(h.runtime.state.getSnapshot().run.stale).toBe(true)
    records.mockResolvedValueOnce(ok({ runId, snapshotRevision: 2, observedAt: 2, readVersion: 'v2',
      mode: 'metadata', totalRecords: 0, selection: {}, items: [], bodyAccess: 'withheld' } as never))
    await h.runtime.readRecords({ runId, mode: 'metadata' })
    unavailable.resolve(ok(third))
    await vi.waitFor(() => { expect(h.runtime.state.getSnapshot().observation.value?.world.status).toBe('unavailable') })
    expect(h.runtime.state.getSnapshot().records).toMatchObject({ stale: true, value: { readVersion: 'v2' } })
  } finally { stop(); next.resolve(ok(second)); unavailable.resolve(ok(third)); await h.ctx.fiber.dispose() }
})

it('marks a run stale from same-policy world progress or missing observation without requiring a snapshot field', async () => {
  const h = fixture()
  const first = { runId, readVersion: 'same-policy' as never, cursor: 'first' as never, status: 'changed' as const,
    observedAt: 1, world: { status: 'observed' as const, revision: 1 } }
  const progressed = { ...first, cursor: 'progressed' as never, world: { status: 'observed' as const, revision: 2 } }
  const unavailable = { ...progressed, cursor: 'unavailable' as never, world: { status: 'unavailable' as const } }
  const second = Promise.withResolvers<ReturnType<typeof ok<typeof progressed>>>()
  const third = Promise.withResolvers<ReturnType<typeof ok<typeof unavailable>>>()
  let stop = () => {}
  try {
    vi.spyOn(h.api.simulations, 'watch').mockResolvedValueOnce(ok(first)).mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise).mockImplementation(async (_input, signal) => await new Promise((resolve) => {
        signal?.addEventListener('abort', () => { resolve(err({ code: 'internal', message: 'Stopped', details: {} })) }, { once: true })
      }))
    stop = h.runtime.observe(runId, { waitMs: 1, retryMs: 1 })
    await vi.waitFor(() => { expect(h.runtime.state.getSnapshot().observation.value?.world).toEqual(first.world) })
    const run = (revision: number) => ({
      run: { id: runId, name: { text: 'Run', truncated: false }, registeredAt: 1, observation: 'observed' },
      status: 'observed', observedAt: 1,
      world: { revision, phase: 'running', time: '0', tickUnit: { text: 'tick', truncated: false } },
    })
    const inspect = vi.spyOn(h.api.simulations, 'inspect').mockResolvedValueOnce(ok(run(1) as never))
      .mockResolvedValueOnce(ok(run(1) as never)).mockResolvedValueOnce(ok({ run: run(1).run, status: 'missing' } as never))
      .mockResolvedValueOnce(ok(run(2) as never))
    await h.runtime.inspect({ runId })
    expect(h.runtime.state.getSnapshot().run.stale).toBe(false)
    second.resolve(ok(progressed))
    await vi.waitFor(() => { expect(h.runtime.state.getSnapshot().observation.value?.world).toEqual(progressed.world) })
    expect(h.runtime.state.getSnapshot().run.stale).toBe(true)
    await h.runtime.inspect({ runId })
    expect(h.runtime.state.getSnapshot().run.stale).toBe(true)
    await h.runtime.inspect({ runId })
    expect(h.runtime.state.getSnapshot().run.stale).toBe(false)
    await h.runtime.inspect({ runId })
    expect(h.runtime.state.getSnapshot().run.stale).toBe(false)
    third.resolve(ok(unavailable))
    await vi.waitFor(() => { expect(h.runtime.state.getSnapshot().observation.value?.world.status).toBe('unavailable') })
    expect(h.runtime.state.getSnapshot().run.stale).toBe(true)
    expect(inspect).toHaveBeenCalledTimes(4)
  } finally { stop(); second.resolve(ok(progressed)); third.resolve(ok(unavailable)); await h.ctx.fiber.dispose() }
})
