/** Domain windows retain bounded metadata while retiring private bodies and late responses independently. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { simulationProductWatchResultSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductWorldDomainInputSchema, simulationProductWorldDomainResultSchema } from '@clocky/clocky-simulation-product/world-read-schema'
import { SimulationRuntime } from '../src/client/simulations/service.ts'
import { FakeApiClient, ok } from './fake-api.client.ts'

const input = simulationProductWorldDomainInputSchema.parse({ runId: 'run', kind: 'person', personId: 'person', section: 'identity', limit: 1 })
const text = (value: string) => ({ text: value, truncated: false })
const result = () => simulationProductWorldDomainResultSchema.parse({ apiVersion: 'clocky.world-read/v1', runId: 'run', kind: 'person',
  selection: input, snapshotRevision: 3, readVersion: 'policy', observedAt: 1, status: 'found',
  coverage: { loaded: 1, total: 1, revision: 3, scope: 'person/identity', complete: true },
  value: { runId: 'run', personId: 'person', revision: 1, name: text('Public name'), employment: 'employed', residency: 'unknown',
    entity: { kind: 'entity', id: 'person' }, persona: { state: 'allowed', value: { summary: text('Private persona canary') } },
    tenures: [], obligations: [], actions: [], sources: [] } })
function fixture() {
  const ctx = new Context(), api = new FakeApiClient(), source = new SimulationRuntime(ctx, api)
  source.connected('credential' as never)
  const observed = (version = 'policy', revision = 3) => {
    source.state.set({ ...source.state.getSnapshot(), run: { scope: JSON.stringify(['run', 'run']), loading: false, stale: false },
      observation: { loading: false, stale: false, value: simulationProductWatchResultSchema.parse({ runId: 'run', readVersion: version,
        status: 'changed', cursor: 'cursor', observedAt: 1, world: { status: 'observed', revision } }) } })
  }
  observed()
  const reader = source.worldDomainReader(ctx)
  return { ctx, api, source, reader, observed }
}

it('reads only the bounded original domain selection and preserves independent windows without issuing commands', async () => {
  const h = fixture()
  try {
    const read = vi.spyOn(h.api.simulations, 'readWorldDomain').mockResolvedValue(ok(result()))
    const manage = vi.spyOn(h.api.simulations, 'manage'), restore = vi.spyOn(h.api.simulations, 'restore')
    await h.reader.read(input)
    expect(read).toHaveBeenCalledWith(input, expect.any(AbortSignal))
    expect(h.reader.state.getSnapshot().person.value).toEqual(result())
    expect(h.reader.state.getSnapshot().organization.value).toBeUndefined()
    expect(manage).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled()
    h.reader.close('person')
    expect(h.reader.state.getSnapshot().person).toEqual({ loading: false, stale: false })
  } finally { await h.ctx.fiber.dispose() }
})

it.each(['policy', 'native'] as const)('keeps stale public metadata but removes private bodies and late replies after %s change', async (change) => {
  const h = fixture(), pending = Promise.withResolvers<ReturnType<typeof ok<ReturnType<typeof result>>>>()
  try {
    const read = vi.spyOn(h.api.simulations, 'readWorldDomain').mockResolvedValueOnce(ok(result())).mockReturnValueOnce(pending.promise)
    await h.reader.read(input)
    const late = h.reader.read(input)
    h.observed(change === 'policy' ? 'replacement' : 'policy', change === 'native' ? 4 : 3)
    expect(read.mock.calls[1]?.[1]?.aborted).toBe(change === 'policy')
    const state = h.reader.state.getSnapshot().person
    expect(state.stale).toBe(true)
    expect(JSON.stringify(state)).toContain('Public name')
    expect(JSON.stringify(state)).not.toContain('Private persona canary')
    pending.resolve(ok(result())); await late
    expect(JSON.stringify(h.reader.state.getSnapshot())).not.toContain('Private persona canary')
  } finally { pending.resolve(ok(result())); await h.ctx.fiber.dispose() }
})

it('retains an offline page as stale and rejects its late in-flight response after credential replacement', async () => {
  const h = fixture(), pending = Promise.withResolvers<ReturnType<typeof ok<ReturnType<typeof result>>>>()
  try {
    const read = vi.spyOn(h.api.simulations, 'readWorldDomain').mockResolvedValueOnce(ok(result())).mockReturnValueOnce(pending.promise)
    await h.reader.read(input)
    const late = h.reader.read(input)
    h.source.disconnected()
    expect(read.mock.calls[1]?.[1]?.aborted).toBe(true)
    expect(h.reader.state.getSnapshot().person).toMatchObject({ stale: true, loading: false, value: result() })
    h.source.connected('replacement' as never)
    expect(h.reader.state.getSnapshot().person.value).toBeUndefined()
    pending.resolve(ok(result())); await late
    expect(h.reader.state.getSnapshot().person.value).toBeUndefined()
  } finally { pending.resolve(ok(result())); await h.ctx.fiber.dispose() }
})

it('refuses a schema-valid domain response whose echoed selector names another original', async () => {
  const h = fixture()
  try {
    const value = result()
    if (value.kind !== 'person' || value.value === undefined) throw new Error('Original person fixture is absent')
    const other = simulationProductWorldDomainResultSchema.parse({ ...value,
      selection: { ...input, personId: 'other' },
      value: { ...value.value, personId: 'other', entity: { kind: 'entity', id: 'other' } } })
    vi.spyOn(h.api.simulations, 'readWorldDomain').mockResolvedValue(ok(other))
    await h.reader.read(input)
    expect(h.reader.state.getSnapshot().person).toMatchObject({ stale: true, loading: false, error: 'stale' })
    expect(h.reader.state.getSnapshot().person.value).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})

it('keeps a current result fresh while an older metadata observer catches up to the same Native prefix', async () => {
  const h = fixture()
  try {
    h.observed('policy', 1)
    vi.spyOn(h.api.simulations, 'readWorldDomain').mockResolvedValue(ok(result()))
    await h.reader.read(input)
    for (const revision of [2, 3]) {
      h.observed('policy', revision)
      expect(h.reader.state.getSnapshot().person.stale).toBe(false)
      expect(JSON.stringify(h.reader.state.getSnapshot().person)).toContain('Private persona canary')
    }
  } finally { await h.ctx.fiber.dispose() }
})

it('does not discard an initial in-flight read while the metadata observer catches up', async () => {
  const h = fixture(), pending = Promise.withResolvers<ReturnType<typeof ok<ReturnType<typeof result>>>>()
  try {
    h.observed('policy', 1)
    const read = vi.spyOn(h.api.simulations, 'readWorldDomain').mockReturnValue(pending.promise)
    const loading = h.reader.read(input)
    h.observed('policy', 2)
    expect(read.mock.calls[0]?.[1]?.aborted).toBe(false)
    expect(h.reader.state.getSnapshot().person.loading).toBe(true)
    pending.resolve(ok(result())); await loading
    expect(h.reader.state.getSnapshot().person).toMatchObject({ loading: false, stale: false, value: result() })
    expect(read).toHaveBeenCalledOnce()
  } finally { pending.resolve(ok(result())); await h.ctx.fiber.dispose() }
})
