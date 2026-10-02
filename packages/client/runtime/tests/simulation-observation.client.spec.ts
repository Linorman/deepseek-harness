/** Known policy retirement clears private pages and old replies while preserving independent original commands. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { SimulationRuntime } from '../src/client/simulations/service.ts'
import type { SimulationProductObjectInspection, SimulationProductWatchResult } from '../src/client/simulations/service.ts'
import { FakeApiClient, ok, err } from './fake-api.client.ts'
const runId = 'run' as never
const input = { runId, collection: 'decisions', id: 'decision' as never, section: 'context', limit: 1 } as const
const hint = (readVersion = 'v1', status: SimulationProductWatchResult['status'] = 'changed', revision = 1): SimulationProductWatchResult => ({
  runId, readVersion: readVersion as never, status, cursor: readVersion as never, observedAt: 1, world: { status: 'observed', revision },
})
const body = (readVersion = 'v1'): SimulationProductObjectInspection => ({ runId, snapshotRevision: 1, observedAt: 1,
  selection: { collection: 'decisions', id: input.id, section: 'context' }, status: 'found', value: {
    collection: 'decisions', id: input.id, section: 'context', readVersion: readVersion as never, bodyAccess: 'allowed',
    accounting: { status: 'prepared', content: 'withheld', maxBytes: 100, retainedBytes: 50, knowledgeCount: 0, sourceCount: 0, sectionCount: 1 },
    frozen: { entityId: 'actor' as never, epoch: '1' as never, slot: '1' as never, time: '1' as never, projections: { run: 1, entity: 1, team: 1 },
      versions: { rules: { text: '1', truncated: false }, policy: { text: '1', truncated: false },
        persona: { text: '1', truncated: false }, model: { text: '1', truncated: false } } },
    items: { total: 1, items: [{ kind: 'section', index: 0, block: 0, section: { text: 'input', truncated: false }, required: true,
      body: { status: 'text', text: 'authorized-private-text', part: 0, parts: 1 } }] },
  } })
async function fixture() {
  const ctx = new Context(), api = new FakeApiClient(), runtime = new SimulationRuntime(ctx, api)
  runtime.connected('authority' as never)
  const waiting = (_input: unknown, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
    const cancel = () => { reject(new Error('cancelled')) }
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
  })
  const watch = vi.spyOn(api.simulations, 'watch').mockImplementation(waiting)
  return { ctx, api, runtime, watch }
}

it('clears retired bodies, ignores held responses and rejects obsolete read versions without clearing original outcomes', async () => {
  const h = await fixture()
  try {
    const change = Promise.withResolvers<ReturnType<typeof ok<SimulationProductWatchResult>>>()
    const watch = h.watch.mockResolvedValueOnce(ok(hint())).mockReturnValueOnce(change.promise)
    const stop = h.runtime.observe(runId, { waitMs: 10, retryMs: 1 })
    await vi.waitFor(() =>{  expect(watch).toHaveBeenCalledTimes(2) })
    const inspect = vi.spyOn(h.api.simulations, 'inspectObject').mockResolvedValueOnce(ok(body()))
    await h.runtime.inspectObject(input)
    const admin = h.runtime.administration(h.ctx, { maxCommands: 8, maxBytes: 65536 })
    const original = admin.retain({ kind: 'manage', input: { runId, managementId: 'original' as never, phase: 'paused' } },
      h.runtime.state.getSnapshot().authorizationVersion)
    vi.spyOn(h.api.simulations, 'manage').mockRejectedValueOnce(new Error('response lost'))
    await admin.submit(original)
    const authority = h.runtime.state.getSnapshot().authorizationVersion
    const held = Promise.withResolvers<ReturnType<typeof ok<SimulationProductObjectInspection>>>()
    inspect.mockReturnValueOnce(held.promise)
    const reading = h.runtime.inspectObject(input)
    change.resolve(ok(hint('v2', 'reset')))
    await vi.waitFor(() =>{  expect(h.runtime.state.getSnapshot().observation.value?.readVersion).toBe('v2') })
    expect(h.runtime.state.getSnapshot().object.value).toBeUndefined()
    expect(h.runtime.state.getSnapshot().authorizationVersion).toBe(authority)
    expect(admin.state.getSnapshot().commands[original]).toMatchObject({ unknown: true })
    held.resolve(ok(body())); await reading
    expect(h.runtime.state.getSnapshot().object.value).toBeUndefined()
    inspect.mockResolvedValueOnce(ok(body()))
    await h.runtime.inspectObject(input)
    expect(h.runtime.state.getSnapshot().object).toMatchObject({ stale: true, error: 'stale' })
    expect(h.runtime.state.getSnapshot().object.value).toBeUndefined()
    inspect.mockResolvedValueOnce(ok(body('v2')))
    await h.runtime.inspectObject(input)
    expect(h.runtime.state.getSnapshot().object.value?.value?.section).toBe('context')
    stop()
    expect(h.runtime.state.getSnapshot().object.value).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})

it('marks later world observations stale without clearing permitted historical text or moving its page', async () => {
  const h = await fixture()
  try {
    const change = Promise.withResolvers<ReturnType<typeof ok<SimulationProductWatchResult>>>()
    h.watch.mockResolvedValueOnce(ok(hint())).mockReturnValueOnce(change.promise)
    h.runtime.observe(runId, { waitMs: 10, retryMs: 1 })
    await vi.waitFor(() =>{  expect(h.runtime.state.getSnapshot().observation.value).toBeDefined() })
    vi.spyOn(h.api.simulations, 'inspectObject').mockResolvedValueOnce(ok(body()))
    await h.runtime.inspectObject(input)
    change.resolve(ok(hint('v1', 'changed', 2)))
    await vi.waitFor(() =>{  expect(h.runtime.state.getSnapshot().object.stale).toBe(true) })
    expect(h.runtime.state.getSnapshot().object.value).toEqual(body())
  } finally { await h.ctx.fiber.dispose() }
})

it('keeps permitted content after ordinary network loss but clears it when the read policy is unavailable', async () => {
  const h = await fixture()
  try {
    const failure = Promise.withResolvers<ReturnType<typeof ok<SimulationProductWatchResult>>>()
    const next = Promise.withResolvers<ReturnType<typeof ok<SimulationProductWatchResult>>>()
    const watch = h.watch.mockResolvedValueOnce(ok(hint())).mockReturnValueOnce(failure.promise)
      .mockReturnValueOnce(next.promise)
    h.runtime.observe(runId, { waitMs: 10, retryMs: 1 })
    await vi.waitFor(() =>{  expect(watch).toHaveBeenCalledTimes(2) })
    vi.spyOn(h.api.simulations, 'inspectObject').mockResolvedValueOnce(ok(body()))
    await h.runtime.inspectObject(input)
    failure.reject(new Error('lost transport'))
    await vi.waitFor(() =>{  expect(watch).toHaveBeenCalledTimes(3) })
    expect(h.runtime.state.getSnapshot().object.value).toEqual(body())
    next.resolve(err({ code: 'simulation-product-unavailable', message: 'Retired', details: {} }))
    await vi.waitFor(() =>{  expect(h.runtime.state.getSnapshot().object.value).toBeUndefined() })
    expect(h.runtime.state.getSnapshot().authorizationVersion).toBe(1)
  } finally { await h.ctx.fiber.dispose() }
})

it('retires knowledge bodies on later audience revisions even when historical context permission stays unchanged', async () => {
  const h = await fixture()
  try {
    const changed = Promise.withResolvers<ReturnType<typeof ok<SimulationProductWatchResult>>>()
    h.watch.mockResolvedValueOnce(ok(hint())).mockReturnValueOnce(changed.promise)
    h.runtime.observe(runId, { waitMs: 10, retryMs: 1 })
    await vi.waitFor(() => expect(h.watch).toHaveBeenCalledTimes(2))
    const value: SimulationProductObjectInspection = { runId, snapshotRevision: 1, observedAt: 1,
      selection: { collection: 'entities', id: 'actor' as never, section: 'knowledge' }, status: 'found', value: {
        collection: 'entities', id: 'actor' as never, section: 'knowledge', readVersion: 'v1' as never, bodyAccess: 'allowed',
        entityId: 'actor' as never, time: '1' as never, cutoffRevision: 1, knowledge: { total: 1, items: [{
          reference: { id: 'private' as never, revision: 1 }, owner: 'actor' as never, sequence: 1,
          observedAt: '0' as never, availableAt: '0' as never, validFrom: '0' as never, validUntil: null,
          body: { status: 'text', text: 'current-private-knowledge', part: 0, parts: 1 }, premises: [],
          source: { kind: 'belief', profileRevision: 1, policyVersion: { text: '1', truncated: false } },
        }] } } }
    const read = vi.spyOn(h.api.simulations, 'inspectObject').mockResolvedValueOnce(ok(value))
    const selected = { runId, collection: 'entities', id: 'actor' as never, section: 'knowledge', limit: 1 } as const
    await h.runtime.inspectObject(selected)
    expect(h.runtime.state.getSnapshot().object.value).toEqual(value)
    changed.resolve(ok(hint('v1', 'changed', 2)))
    await vi.waitFor(() => expect(h.runtime.state.getSnapshot().object.value).toBeUndefined())
    read.mockResolvedValueOnce(ok(value))
    await h.runtime.inspectObject(selected)
    expect(h.runtime.state.getSnapshot().object.value).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})
