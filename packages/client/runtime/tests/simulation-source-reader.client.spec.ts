/** Source pages retain their exact identity across permission polling and refuse known-revoked late responses. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { SimulationRuntime } from '../src/client/simulations/service.ts'
import type { SimulationProductSourceInspection } from '../src/client/simulations/service.ts'
import { FakeApiClient, ok, deferred } from './fake-api.client.ts'
const input = { runId: 'run' as never, decisionId: 'decision' as never, sourceIndex: 0, limit: 1 }
const value: SimulationProductSourceInspection = { ...input, snapshotRevision: 3, readVersion: 'policy' as never,
  observedAt: 1, status: 'found', source: { kind: 'team-envelope', teamId: 'team' as never, channelId: 'channel' as never, envelopeId: 'original' as never },
  envelope: { sequence: 7, kind: { text: 'message', truncated: false }, createdAt: 1 },
  items: [{ block: 0, body: { status: 'text', text: 'private', part: 0, parts: 2 } }], nextCursor: 'next' as never }
function setup() {
  const ctx = new Context(), api = new FakeApiClient(), runtime = new SimulationRuntime(ctx, api)
  runtime.connected('authority' as never)
  runtime.state.set({ ...runtime.state.getSnapshot(), run: { scope: JSON.stringify(['run', 'run']), loading: false, stale: false },
    observation: { loading: false, stale: false, value: { runId: input.runId, readVersion: 'policy' as never,
      cursor: 'watch' as never, status: 'changed', observedAt: 1, world: { status: 'observed', revision: 3 } } } })
  const read = vi.spyOn(api.simulations, 'inspectSource').mockResolvedValue(ok(value))
  return { ctx, api, runtime, read }
}
it('polls the exact retained text page and reflects Team permission loss without changing authoring authority', async () => {
  const h = setup()
  try {
    const stop = h.runtime.watchSource(input, 10)
    await vi.waitFor(() => { expect(h.runtime.state.getSnapshot().source.value?.status).toBe('found') })
    const calls = h.read.mock.calls.length
    await h.runtime.inspectSource({ ...input, envelopeSequence: 7, cursor: 'next' as never, expectedRevision: 3 })
    await vi.waitFor(() => { expect(h.read.mock.calls.length).toBeGreaterThan(calls + 1) })
    expect(h.read).toHaveBeenLastCalledWith({ ...input, envelopeSequence: 7, cursor: 'next', expectedRevision: undefined }, expect.any(AbortSignal))
    const authority = h.runtime.state.getSnapshot().authorizationVersion
    h.read.mockResolvedValue(ok({ ...value, status: 'withheld', envelope: undefined, items: [], nextCursor: undefined }))
    await vi.waitFor(() => { expect(h.runtime.state.getSnapshot().source.value?.status).toBe('withheld') })
    expect(h.runtime.state.getSnapshot().source.value?.items).toEqual([])
    expect(h.runtime.state.getSnapshot().authorizationVersion).toBe(authority)
    stop(); expect(h.runtime.state.getSnapshot().source.value).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})
it.each(['revocation', 'policy', 'account', 'close'] as const)('rejects a held original after %s', async (change) => {
  const h = setup()
  try {
    const pending = deferred<Awaited<ReturnType<typeof h.api.simulations.inspectSource>>>()
    h.read.mockReturnValueOnce(pending.promise)
    const stop = h.runtime.watchSource(input, 10000)
    expect(h.read).toHaveBeenCalledOnce()
    if (change === 'revocation') h.runtime.revokeSourceAccess()
    else if (change === 'account') h.runtime.clearAuthorization()
    else if (change === 'policy') {
      const state = h.runtime.state.getSnapshot()
      h.read.mockResolvedValue(ok({ ...value, status: 'withheld', readVersion: 'new' as never, envelope: undefined, items: [], nextCursor: undefined }))
      h.runtime.state.set({ ...state, observation: { ...state.observation, value: { ...state.observation.value!, readVersion: 'new' as never } } })
    } else stop()
    pending.resolve(ok(value))
    await vi.waitFor(() => { expect(h.runtime.state.getSnapshot().source.loading).toBe(false) })
    expect(h.runtime.state.getSnapshot().source.value?.items.some(row => row.body.status === 'text')).not.toBe(true)
    stop()
  } finally { await h.ctx.fiber.dispose() }
})
it('waits for a deep-linked run handshake and keeps ordinary failed reads visibly stale', async () => {
  const h = setup()
  try {
    const state = h.runtime.state.getSnapshot()
    h.runtime.state.set({ ...state, run: { loading: false, stale: false } })
    const stop = h.runtime.watchSource(input, 10000)
    expect(h.read).not.toHaveBeenCalled()
    h.runtime.state.set({ ...h.runtime.state.getSnapshot(), run: state.run })
    await vi.waitFor(() => { expect(h.runtime.state.getSnapshot().source.value).toBeDefined() })
    h.read.mockRejectedValueOnce(new Error('offline'))
    await h.runtime.refreshSource()
    expect(h.runtime.state.getSnapshot().source).toMatchObject({ error: 'network', stale: true, value })
    stop()
  } finally { await h.ctx.fiber.dispose() }
})

it('keeps replacement selection installed by an old request abort callback', async () => {
  const h = setup()
  try {
    const pending = deferred<Awaited<ReturnType<typeof h.api.simulations.inspectSource>>>()
    h.read.mockImplementation(async selection => ok({ ...value, decisionId: selection.decisionId }))
      .mockImplementationOnce((_input, signal) => {
        signal?.addEventListener('abort', () => { h.runtime.watchSource({ ...input, decisionId: 'replacement' as never }, 10000) }, { once: true })
        return pending.promise
      })
    const oldStop = h.runtime.watchSource(input, 10000)
    h.runtime.watchSource(input, 10000)
    pending.resolve(ok(value))
    await vi.waitFor(() => { expect(h.runtime.state.getSnapshot().source.value?.decisionId).toBe('replacement') })
    oldStop()
    expect(h.runtime.state.getSnapshot().source.value?.decisionId).toBe('replacement')
  } finally { await h.ctx.fiber.dispose() }
})
