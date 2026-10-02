/** Real topology owners preserve canonical reservations and initial checkpoint responsibility. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { simulationChangeSchema, simulationEntityIdSchema, simulationResourceSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import { prepareSimulationCompany, simulationCompanyPreparationSchema } from '../src/company-preparation.ts'
import { createContext } from '../../simulation-team/tests/harness.ts'
import { registration } from './fixtures.ts'

const settings = simulationCompanyPreparationSchema.parse({ version: '1', ownerName: 'company/product',
  objective: 'Deliver one inventory unit', buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2',
  participant: { provider: 'in-process', preset: 'simulation', model: 'scripted/model' },
  checkpoint: { id: 'initial', maxDrainRounds: 4, maxAttempts: 3 } })
async function fixture(backend: 'json' | 'sqlite' = 'json', overrides: Record<string, unknown> = {}) {
  await mkdir('.tmp', { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'company-preparation-'))
  const h = await createContext(root, backend)
  await h.ctx.plugin(Direct)
  const selection = h.ctx.simulations.resolve({ provider: 'local', mode: 'create', spec: { ...registration().spec, ...overrides } })
  const run = await h.ctx.simulations.open(selection)
  return { ...h, run, selection, async close() {
    await run.close(); await h.ctx.fiber.dispose(); await rm(root, { recursive: true, force: true })
  } }
}

it.each(['json', 'sqlite'] as const)('prepares and retries a paused company with a complete initial checkpoint and no actor (%s)', async (backend) => {
  const h = await fixture(backend)
  try {
    const result = await prepareSimulationCompany(h.ctx.simulationTeams, h.run, settings)
    expect(result.checkpoint.status).toBe('completed')
    expect(result.checkpoint.manifest.sessions).toHaveLength(2)
    expect(result.checkpoint.manifest.sessions.every(value => value.kind === 'unmaterialized')).toBe(true)
    expect(result.checkpoint.manifest.channels).toHaveLength(1)
    expect(h.run.snapshot().phase).toBe('paused')
    expect(h.run.population().chargedActors).toBe(0)
    expect(h.ctx.simulationTeams.modelUsage().active).toBe(0)
    expect(await h.ctx.sessionPersistence.list()).toEqual([])
    const before = h.run.snapshot()
    const retried = await prepareSimulationCompany(h.ctx.simulationTeams, h.run, settings)
    expect(retried).toEqual(result)
    expect(h.run.snapshot()).toEqual(before)
    const team = await h.ctx.teams.getTeam({ teamId: result.teamId })
    expect(team.participants).toHaveLength(2)
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('reconciles a third actor and second channel into one inert complete checkpoint (%s)', async (backend) => {
  const h = await fixture(backend)
  const topology = { actors: [{ id: 'reviewer', name: 'Independent reviewer' }], channels: [{ key: 'audit', members: [
    { entityId: 'buyer', role: 'author' }, { entityId: 'reviewer', role: 'reviewer' },
  ] }] }
  const request = simulationCompanyPreparationSchema.parse({ ...settings, topology })
  try {
    const invitation = h.ctx.teams.inviteParticipant.bind(h.ctx.teams)
    vi.spyOn(h.ctx.teams, 'inviteParticipant').mockImplementation(async (input) => {
      const participant = await invitation(input)
      if (input.displayName === 'Independent reviewer') throw new Error('Third invitation response lost')
      return participant
    })
    await expect(prepareSimulationCompany(h.ctx.simulationTeams, h.run, request)).rejects.toThrow('Third invitation response lost')
    const before = h.run.snapshot().entities[simulationEntityIdSchema.parse('reviewer')]?.participantReservation
    vi.restoreAllMocks()
    const result = await prepareSimulationCompany(h.ctx.simulationTeams, h.run, request)
    expect(h.run.snapshot().entities[simulationEntityIdSchema.parse('reviewer')]?.binding).toEqual(before?.binding)
    expect(result.checkpoint.manifest.sessions).toHaveLength(3)
    expect(result.checkpoint.manifest.sessions.every(value => value.kind === 'unmaterialized')).toBe(true)
    expect(result.checkpoint.manifest.channels).toHaveLength(2)
    const retained = h.run.snapshot()
    expect(await prepareSimulationCompany(h.ctx.simulationTeams, h.run, request)).toEqual(result)
    expect(h.run.snapshot()).toEqual(retained)
    expect(h.run.population().chargedActors).toBe(0)
    expect(await h.ctx.sessionPersistence.list()).toEqual([])
    expect((await h.ctx.teams.getTeam({ teamId: result.teamId })).participants).toHaveLength(3)
  } finally { await h.close() }
})

it('reconciles a committed invitation whose response was lost, sharing identical in-flight preparation', async () => {
  const h = await fixture()
  try {
    const invite = h.ctx.teams.inviteParticipant.bind(h.ctx.teams)
    const gate = Promise.withResolvers<undefined>()
    vi.spyOn(h.ctx.teams, 'inviteParticipant').mockImplementationOnce(async (request) => {
      const response = await invite(request)
      await gate.promise
      expect(response.phase).toBe('invited')
      throw new Error('lost-response')
    })
    const first = prepareSimulationCompany(h.ctx.simulationTeams, h.run, settings)
    expect(prepareSimulationCompany(h.ctx.simulationTeams, h.run, settings)).toBe(first)
    await expect(prepareSimulationCompany(h.ctx.simulationTeams, h.run, { ...settings, buyerName: 'Changed' })).rejects.toThrow('another immutable')
    gate.resolve(undefined)
    await expect(first).rejects.toThrow('lost-response')
    const reserved = h.run.snapshot().entities[simulationEntityIdSchema.parse('buyer')]!.participantReservation!
    const result = await prepareSimulationCompany(h.ctx.simulationTeams, h.run, settings)
    expect(result.buyer).toEqual(reserved.binding)
    expect((await h.ctx.teams.getTeam({ teamId: result.teamId })).participants).toHaveLength(2)
  } finally { await h.close() }
})

it('retains a failed initial checkpoint and requires an explicitly different checkpoint request', async () => {
  const h = await fixture()
  try {
    vi.spyOn(h.run, 'acquireCheckpointCut').mockRejectedValueOnce(new Error('cut-unavailable'))
    await expect(prepareSimulationCompany(h.ctx.simulationTeams, h.run, settings)).rejects.toThrow('initial checkpoint is incomplete')
    const before = h.run.snapshot()
    expect(before.checkpoints?.[settings.checkpoint.id]?.status).toBe('failed')
    await expect(prepareSimulationCompany(h.ctx.simulationTeams, h.run, settings)).rejects.toThrow('initial checkpoint is incomplete')
    expect(h.run.snapshot()).toEqual(before)
    const result = await prepareSimulationCompany(h.ctx.simulationTeams, h.run, { ...settings,
      checkpoint: { ...settings.checkpoint, id: 'initial-retry' as never } })
    expect(result.checkpoint.request.id).toBe('initial-retry')
    expect(h.run.snapshot().checkpoints?.[settings.checkpoint.id]?.status).toBe('failed')
  } finally { await h.close() }
})

it('refuses changed retained entity and resource facts before any further topology writes', async () => {
  const h = await fixture()
  try {
    const id = simulationEntityIdSchema.parse('buyer')
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'person', cognition: 'agent',
      profile: { name: 'Different' } }), h.run.snapshot().revision)
    const before = h.run.snapshot()
    expect(() => prepareSimulationCompany(h.ctx.simulationTeams, h.run, settings)).toThrow('retained entity differs')
    expect(h.run.snapshot()).toEqual(before)
  } finally { await h.close() }
  const resource = await fixture()
  try {
    await resource.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'buyer', entityKind: 'person', cognition: 'agent',
      profile: { name: settings.buyerName } }), resource.run.snapshot().revision)
    await resource.run.createResource(simulationResourceSpecSchema.parse({ id: 'received', owner: 'buyer', quantity: '1',
      kind: 'inventory', unit: 'item', controllers: ['buyer'] }), resource.run.snapshot().revision)
    const before = resource.run.snapshot()
    expect(() => prepareSimulationCompany(resource.ctx.simulationTeams, resource.run, settings)).toThrow('retained resource differs')
    expect(resource.run.snapshot()).toEqual(before)
  } finally { await resource.close() }
})

it('rejects progressed history, unexpected channels and insufficient bootstrap allowances', async () => {
  const h = await fixture()
  try {
    const state = h.run.snapshot()
    const snapshots: SimulationSnapshot[] = [
      { ...state, phase: 'running' }, { ...state, time: '1' as never }, { ...state, nextEventSlot: '1' as never },
      { ...state, nextDecisionSlot: '1' as never }, { ...state, activeWindowId: 'active' as never },
      { ...state, decisions: { existing: {} } as never }, { ...state, operations: { existing: {} } as never },
      { ...state, ingresses: { existing: {} } as never }, { ...state, relations: { existing: {} } as never },
    ]
    for (const snapshot of snapshots) {
      vi.spyOn(h.run, 'snapshot').mockReturnValueOnce(snapshot)
      expect(() => prepareSimulationCompany(h.ctx.simulationTeams, h.run, settings)).toThrow('unstarted paused history')
    }
    for (const spec of [{ ...state.spec, maxEntities: 1 }, { ...state.spec, maxResourceQuantity: '1' as never }]) {
      vi.spyOn(h.run, 'snapshot').mockReturnValueOnce({ ...state, spec })
      expect(() => prepareSimulationCompany(h.ctx.simulationTeams, h.run, settings)).toThrow('exceeds run capacity')
    }
    vi.spyOn(h.run, 'snapshot').mockReturnValueOnce({ ...state, channelReservations: { other: { spec: { key: 'other' } } } as never })
    expect(() => prepareSimulationCompany(h.ctx.simulationTeams, h.run, settings)).toThrow('retained channel differs')
    expect(h.run.snapshot()).toEqual(state)
  } finally { await h.close() }
})
