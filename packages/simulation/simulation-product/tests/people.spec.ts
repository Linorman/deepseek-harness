/** Personnel metadata reads real Native and canonical Team history without allocating or inferring. */
import { expect, it, vi } from 'vitest'
import { simulationChangeSchema, simulationEntityIdSchema } from '@clocky/clocky-simulation'
import SimulationProducts from '../src/index.ts'
import { simulationProductPeopleCountsSchema } from '../src/people-schema.ts'
import { companyFixture } from './company-driver-fixture.ts'
import { call, registration } from './fixtures.ts'

async function fixture(backend: 'json' | 'sqlite') {
  const h = await companyFixture(backend, true, { relationRules: [{ relation: 'assignment', subjectKinds: ['person'],
    objectKinds: ['position'], scopeKinds: ['organization'], acyclic: false }] })
  try {
    for (const [id, entityKind] of [['organization', 'organization'], ['position', 'position']]) {
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind, cognition: 'none',
        readiness: 'ready', profile: {} }), h.run.snapshot().revision)
    }
    await h.run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'original-assignment', subject: 'buyer',
      relation: 'assignment', object: 'position', scope: 'organization', validFrom: '0', validUntil: null }), h.run.snapshot().revision)
    const record = { ...registration(), provider: h.selection.provider, spec: h.selection.spec }
    await h.ctx.plugin(SimulationProducts, { directoryStream: 'personnel-product-counts', imports: [record] })
    return { ...h, record, products: h.ctx.simulationProducts }
  } catch (error) { await h.close(); throw error }
}

it.each(['json', 'sqlite'] as const)('%s reads complete actual history and separates resident admission from retained identities', async (backend) => {
  const h = await fixture(backend)
  const open = vi.spyOn(h.ctx.simulations, 'open')
  try {
    const before = h.run.snapshot(), teamId = before.teamReservation!.teamId
    const team = await h.ctx.teams.getTeam({ teamId })
    const initial = await h.products.inspect({ runId: h.record.id }, call())
    expect(initial.world?.people).toEqual({ scope: 'run', snapshotRevision: before.revision, time: before.time,
      employed: 1, nonTerminalPersons: 2, resident: 0, residentLimit: 2, unreleasedWriters: 0,
      history: { status: 'observed', teamCursor: team.team.cursor, participants: team.participants.length, activations: team.activations.length } })
    expect(h.run.snapshot()).toEqual(before)
    expect((await h.ctx.teams.getTeam({ teamId })).team.cursor).toBe(team.team.cursor)
    await h.start()
    const buyer = simulationEntityIdSchema.parse('buyer')
    await h.connection.ensureResident(buyer, { activation: { provider: 'in-process', seed: { kind: 'fresh' },
      agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: h.lifetime.signal }, evict: [] })
    const active = (await h.products.inspect({ runId: h.record.id }, call())).world!.people!
    expect(active).toMatchObject({ employed: 1, nonTerminalPersons: 2, resident: 1, unreleasedWriters: 1 })
    expect(active.history).toMatchObject({ status: 'observed', participants: team.participants.length,
      activations: team.activations.length + 1 })
    await h.connection.hibernate(buyer)
    const stopped = (await h.products.inspect({ runId: h.record.id }, call())).world!.people!
    expect(stopped).toMatchObject({ resident: 0, unreleasedWriters: 0, employed: 1, nonTerminalPersons: 2 })
    expect(stopped.history).toMatchObject({ status: 'observed', participants: team.participants.length,
      activations: team.activations.length + 1 })
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: buyer,
      entityRevision: h.run.snapshot().entities[buyer]!.revision, phase: 'inactive' }), h.run.snapshot().revision)
    expect((await h.products.inspect({ runId: h.record.id }, call())).world?.people).toMatchObject({ employed: 1, nonTerminalPersons: 2 })
    expect(open).not.toHaveBeenCalled()
    expect(h.requests).toHaveLength(0)
    for (const privateValue of [teamId, before.entities[buyer]!.binding!.sessionId, before.spec.runId]) {
      expect(JSON.stringify(initial.world?.people)).not.toContain(privateValue)
    }
  } finally { open.mockRestore(); await h.close() }
})

it('keeps unavailable and displaced Team history unknown and rechecks credential retirement after its IO', async () => {
  const h = await fixture('json')
  const getTeam = h.ctx.teams.getTeam.bind(h.ctx.teams)
  const read = vi.spyOn(h.ctx.teams, 'getTeam')
  try {
    read.mockRejectedValueOnce(new Error('Private Team provider diagnostic'))
    expect((await h.products.inspect({ runId: h.record.id }, call())).world?.people?.history)
      .toEqual({ status: 'unavailable', reason: 'unavailable' })
    read.mockImplementationOnce(async (input) => {
      const team = await getTeam(input)
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: 'buyer',
        entityRevision: h.run.snapshot().entities[simulationEntityIdSchema.parse('buyer')]!.revision, profile: { changed: true } }),
      h.run.snapshot().revision)
      return team
    })
    expect((await h.products.inspect({ runId: h.record.id }, call())).world?.people?.history)
      .toEqual({ status: 'unavailable', reason: 'source-moved' })
    const controller = new AbortController()
    read.mockImplementationOnce(async (input) => { const team = await getTeam(input); controller.abort(); return team })
    await expect(h.products.inspect({ runId: h.record.id }, call(controller))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    expect(h.requests).toHaveLength(0)
  } finally { read.mockRestore(); await h.close() }
})

it('rejects fabricated count relationships, partial histories and credential-shaped extra fields', () => {
  const value = { scope: 'run', snapshotRevision: 1, time: '9007199254740993', employed: 1, nonTerminalPersons: 2,
    resident: 0, residentLimit: 2, unreleasedWriters: 1, history: { status: 'unavailable', reason: 'unsupported' } }
  expect(simulationProductPeopleCountsSchema.parse(value)).toEqual(value)
  for (const changed of [{ employed: 3 }, { resident: 2 }, { unreleasedWriters: 3 }, { residentLimit: 0 },
    { nonTerminalPersons: 9007199254740992 }, { history: { status: 'observed', participants: 0 } },
    { history: { status: 'unavailable', reason: 'unavailable', participants: 0 } }, { principal: 'forged' }]) {
    expect(() => simulationProductPeopleCountsSchema.parse({ ...value, ...changed })).toThrow()
  }
})
