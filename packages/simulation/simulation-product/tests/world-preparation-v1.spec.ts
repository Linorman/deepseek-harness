/** V1 compilation drives real canonical preparation, original retry and paused initial checkpoint. */
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema } from '@clocky/clocky-simulation'
import { compileWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import { sample, deployment } from '../../simulation-scenario/tests/v1-fixtures.ts'
import { simulationTemp } from '../../simulation-local/tests/temp.ts'
import { createContext } from '../../simulation-team/tests/harness.ts'
import { prepareSimulationWorld } from '../src/world-preparation.ts'
import type { LogStream } from '@clocky/clocky-storage'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close() })
async function fixture(backend: 'json' | 'sqlite') {
  const definition = structuredClone(sample), scope = definition.organization.rootId
  const member = definition.entities.find(value => value.kind === 'person' && value.cognition === 'agent' && value.role === 'member')!
  definition.facts = [{ id: 'initial-fact', subjectId: scope, scopeId: scope, body: 'Original fact', effectiveFrom: '1',
    effectiveUntil: null, availableAt: '0', audience: { kind: 'public' } }]
  definition.knowledge = [{ id: 'private-belief', ownerId: member.id, body: 'Original private belief', observedAt: '0',
    availableAt: '0', validFrom: '0', validUntil: null, readers: [] }]
  definition.governance.norms = [{ id: 'initial-norm', scopeId: scope, body: 'Authored advisory rule', effectiveFrom: '0',
    effectiveUntil: null, availableAt: '0', audience: { kind: 'public' }, enforcement: { kind: 'advisory' } }]
  const compiled = await compileWorldScenarioV1(definition, deployment)
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const root = await simulationTemp('world-preparation-v1'), h = await createContext(root, backend)
  await h.ctx.plugin(Direct)
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create',
    spec: { runId: 'v1-original', ...compiled.resolved.native } })
  const run = await h.ctx.simulations.open(selection)
  cleanups.push(async () => { await run.close(); await h.ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const request = { resolved: compiled.resolved, ownerName: 'world/v1-original',
    checkpoint: { id: simulationCheckpointIdSchema.parse('original-checkpoint'), maxDrainRounds: 4, maxAttempts: 3 } }
  const prepare = () => prepareSimulationWorld(h.ctx.simulationTeams, run, request)
  return { ...h, run, prepare, selection, request, member }
}

describe.each(['json', 'sqlite'] as const)('%s compiled v1 preparation', (backend) => {
  it('publishes the original authored data and inert canonical identities before a paused checkpoint', async () => {
    const h = await fixture(backend), result = await h.prepare(), state = h.run.snapshot()
    expect(result.checkpoint.status).toBe('completed')
    expect(state.phase).toBe('paused')
    expect(state.time).toBe('0')
    expect(state.worldBootstrap?.request.data).toEqual(h.request.resolved.bootstrap)
    expect(Object.values(state.entities).every(value => value.readiness === 'ready' && value.writer === undefined)).toBe(true)
    expect(state.world?.intents).toEqual({})
    expect(state.decisions).toEqual({})
    expect(state.operations).toEqual({})
    expect(Object.values(state.world!.facts)[0]![0]!.payload).toEqual({ body: 'Original fact' })
    expect(Object.values(state.world!.norms.versions)[0]![0]!.origin).toBe('scenario')
    expect(state.knowledge?.['private-belief' as never]?.[0]?.readers).toEqual([])
    expect(result.checkpoint.manifest.sessions.every(value => value.kind === 'unmaterialized')).toBe(true)
    expect(await h.ctx.sessionPersistence.list()).toEqual([])
    expect(h.ctx.simulationTeams.modelUsage().active).toBe(0)
    expect(h.run.population().chargedActors).toBe(0)
    const revision = state.revision
    expect(await h.prepare()).toEqual(result)
    expect(h.run.snapshot().revision).toBe(revision)
  })
  it('collects an explicit checkpoint attempt without replacing the failed original or any canonical identity', async () => {
    const h = await fixture(backend)
    const cut = vi.spyOn(h.run, 'acquireCheckpointCut').mockRejectedValueOnce(new Error('Checkpoint storage unavailable'))
    await expect(h.prepare()).rejects.toThrow('World initial checkpoint is incomplete')
    cut.mockRestore()
    const before = h.run.snapshot(), original = before.checkpoints![h.request.checkpoint.id]
    const attempt = { current: { ...h.request.checkpoint,
      id: simulationCheckpointIdSchema.parse('accepted-prepare-checkpoint'), implementationVersion: 'world/1' }, permittedHistory: [] }
    expect(original?.status).toBe('failed')
    const result = await prepareSimulationWorld(h.ctx.simulationTeams, h.run, h.request, attempt)
    const after = h.run.snapshot()
    expect(result.checkpoint.request.id).toBe(attempt.current.id)
    expect(after.checkpoints![h.request.checkpoint.id]).toEqual(original)
    expect(after.entities).toEqual(before.entities)
    expect(after.teamReservation).toEqual(before.teamReservation)
    expect(after.channelReservations).toEqual(before.channelReservations)
    expect(after.worldBootstrap).toEqual(before.worldBootstrap)
    expect(await prepareSimulationWorld(h.ctx.simulationTeams, h.run, h.request, attempt)).toEqual(result)
    expect(h.run.snapshot()).toEqual(after)
    expect(await h.ctx.sessionPersistence.list()).toEqual([])
    expect(h.ctx.simulationTeams.modelUsage().active).toBe(0)
  })
  it('requires retained accepted history when successive explicit checkpoint attempts fail', async () => {
    const h = await fixture(backend)
    const cut = vi.spyOn(h.run, 'acquireCheckpointCut').mockRejectedValue(new Error('Checkpoint storage unavailable'))
    await expect(h.prepare()).rejects.toThrow('World initial checkpoint is incomplete')
    const first = { ...h.request.checkpoint, id: simulationCheckpointIdSchema.parse('first-accepted-attempt'), implementationVersion: 'world/1' }
    await expect(prepareSimulationWorld(h.ctx.simulationTeams, h.run, h.request, { current: first, permittedHistory: [] }))
      .rejects.toThrow('World initial checkpoint is incomplete')
    cut.mockRestore()
    const before = h.run.snapshot()
    const current = { ...first, id: simulationCheckpointIdSchema.parse('second-accepted-attempt') }
    expect(() => prepareSimulationWorld(h.ctx.simulationTeams, h.run, h.request, { current, permittedHistory: [] }))
      .toThrow(/accepted preparation attempt/)
    expect(h.run.snapshot()).toEqual(before)
    const result = await prepareSimulationWorld(h.ctx.simulationTeams, h.run, h.request, { current, permittedHistory: [first] })
    expect(result.checkpoint.request.id).toBe(current.id)
    for (const id of [h.request.checkpoint.id, first.id]) expect(h.run.snapshot().checkpoints![id]).toEqual(before.checkpoints![id])
    expect(h.run.snapshot().entities).toEqual(before.entities)
  })
  it('rejects an attempt before original failure and rejects policy or checkpoint identity substitution without appending', async () => {
    const h = await fixture(backend)
    const attempt = { current: { ...h.request.checkpoint,
      id: simulationCheckpointIdSchema.parse('accepted-prepare-checkpoint'), implementationVersion: 'world/1' }, permittedHistory: [] }
    const empty = h.run.snapshot()
    expect(() => prepareSimulationWorld(h.ctx.simulationTeams, h.run, h.request, attempt)).toThrow(/original failed checkpoint/)
    expect(h.run.snapshot()).toEqual(empty)
    const cut = vi.spyOn(h.run, 'acquireCheckpointCut').mockRejectedValueOnce(new Error('Checkpoint storage unavailable'))
    await expect(h.prepare()).rejects.toThrow('World initial checkpoint is incomplete')
    cut.mockRestore()
    const before = h.run.snapshot()
    for (const current of [{ ...attempt.current, id: h.request.checkpoint.id },
      { ...attempt.current, maxAttempts: attempt.current.maxAttempts + 1 }]) {
      expect(() => prepareSimulationWorld(h.ctx.simulationTeams, h.run, h.request, { ...attempt, current }))
        .toThrow(/collection policy|failed identity/)
      expect(h.run.snapshot()).toEqual(before)
    }
  })
  it('reuses original identities and the retained complete book after an actual failed atomic append', async () => {
    const h = await fixture(backend), stream = Reflect.get(h.run, 'stream') as LogStream, append = stream.append.bind(stream)
    const spy = vi.spyOn(stream, 'append').mockImplementation(async (...args) => {
      if (args[1].some(value => (value as { change?: { kind?: string } }).change?.kind === 'world-bootstrap/applied'))
        throw new Error('Original bootstrap persistence interrupted')
      return append(...args)
    })
    await expect(h.prepare()).rejects.toThrow(/interrupted/)
    const retained = h.run.snapshot()
    expect(retained.worldBootstrap?.status).toBe('retained')
    expect(retained.world).toBeUndefined()
    expect(Object.values(retained.entities).filter(value => value.cognition === 'agent')
      .every(value => value.readiness === 'preparing' && value.binding !== undefined)).toBe(true)
    spy.mockRestore()
    await h.prepare()
    const applied = h.run.snapshot()
    expect(applied.worldBootstrap?.sequence).toBe(retained.worldBootstrap!.sequence)
    for (const original of Object.values(retained.entities)) expect(applied.entities[original.id]?.binding).toEqual(original.binding)
    expect(await h.ctx.sessionPersistence.list()).toEqual([])
    expect(Object.values(applied.world!.facts)[0]).toHaveLength(1)
  })
})
