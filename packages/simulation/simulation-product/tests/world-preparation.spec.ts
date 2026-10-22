import { hiringIntentFields } from '../../../../examples/simulation-company/tests/world-domain-input.ts'
/** Real Native/Team bootstrap, original-identity recovery and paused no-inference evidence. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile, rm } from 'node:fs/promises'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { simulationChangeSchema, simulationCheckpointIdSchema, simulationEntityIdSchema,
  simulationRunSelectionSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationSnapshot } from '@clocky/clocky-simulation'
import { compileWorldScenario } from '@clocky/clocky-simulation-scenario'
import { catalog } from '../../simulation-scenario/tests/fixtures.ts'
import { simulationTemp } from '../../simulation-local/tests/temp.ts'
import { createContext } from '../../simulation-team/tests/harness.ts'
import { SimulationWorldExecutions } from '@clocky/clocky-simulation-world'
import { prepareSimulationWorld } from '../src/world-preparation.ts'
import type { SimulationWorldPreparation, SimulationWorldPrepared } from '../src/world-preparation.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture(backend: 'json' | 'sqlite', scenario: 'company' | 'laboratory' = 'company') {
  const root = await simulationTemp('world-preparation')
  const h = await createContext(root, backend)
  await h.ctx.plugin(SimulationWorldExecutions)
  await h.ctx.plugin(Direct)
  const input: unknown = JSON.parse(await readFile(`examples/simulation-company/scenarios/world-${scenario}.json`, 'utf8'))
  const compiled = await compileWorldScenario(input, catalog())
  if (!compiled.ok) throw new Error('World preparation fixture failed compilation')
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: { runId: scenario, ...compiled.resolved.native } })
  const run = await h.ctx.simulations.open(selection)
  cleanups.push(async () => { await run.close(); await h.ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const request: SimulationWorldPreparation = { resolved: compiled.resolved, ownerName: `world/${scenario}`,
    checkpoint: { id: simulationCheckpointIdSchema.parse('initial-world'), maxDrainRounds: 4, maxAttempts: 3 } }
  const prepare = (target = run, settings = request) => prepareSimulationWorld(h.ctx.simulationTeams, target, settings)
  return { ...h, root, run, selection, request, resolved: compiled.resolved, prepare }
}
type Fixture = Awaited<ReturnType<typeof fixture>>

async function assertInert(h: Fixture, run: SimulationRun, result?: SimulationWorldPrepared) {
  const state = run.snapshot()
  expect(state.phase).toBe('paused')
  expect(state.time).toBe('0')
  expect(state.decisions).toEqual({})
  expect(state.operations).toEqual({})
  expect(state.wakes).toEqual({})
  expect(Object.values(state.entities).every(entity => entity.writer === undefined)).toBe(true)
  expect(run.population().chargedActors).toBe(0)
  expect(h.ctx.simulationTeams.modelUsage().active).toBe(0)
  expect(h.ctx.simulationTeams.modelUsage().queued).toBe(0)
  expect(await h.ctx.sessionPersistence.list()).toEqual([])
  if (result === undefined) return
  expect(result.checkpoint.status).toBe('completed')
  expect(result.checkpoint.manifest.sessions).toHaveLength(h.resolved.actors.length)
  expect(result.checkpoint.manifest.sessions.every(session => session.kind === 'unmaterialized')).toBe(true)
  expect(result.checkpoint.manifest.channels).toHaveLength(h.resolved.channels.length)
  expect(Object.values(state.entities).map(entity => entity.readiness)).toEqual(h.resolved.entities.map(() => 'ready'))
  const team = await h.ctx.teams.getTeam({ teamId: result.teamId })
  expect(team.rules.teamLimits).toEqual(h.resolved.limits.team)
  expect(team.participants).toHaveLength(h.resolved.actors.length)
  expect(team.activations).toEqual([])
  expect(team.tasks).toEqual([])
  expect(Object.values(state.world?.intents ?? {}).map(intent => hiringIntentFields(intent)))
    .toEqual(h.resolved.initialEvents.map(event => event.request))
  expect(Object.keys(state.scheduledEvents)).toEqual(result.initialEvents.map(event => event.wakeId))
  for (const [index, event] of result.initialEvents.entries()) {
    expect(state.scheduledEvents[event.wakeId]).toMatchObject({ status: 'pending', key: { time: h.resolved.initialEvents[index]!.at },
      action: { kind: 'wake', entityId: h.resolved.initialEvents[index]!.request.requesterEntityId,
        reason: h.resolved.initialEvents[index]!.description } })
  }
  for (const id of Object.values(result.channels)) {
    const admission = await h.ctx.teams.getChannelAdmission({ channelId: id })
    expect(admission.channel.phase).toBe('active')
    expect(admission.invitations.every(invitation => invitation.status === 'acknowledged')).toBe(true)
  }
}

/** Interrupt one actual owner method once, either before its commit or after losing its response. */
function interrupt<Args extends unknown[], Result>(original: (...args: Args) => Promise<Result>,
  matches: (...args: Args) => boolean, when: 'before' | 'after') {
  let reached = false
  return async (...args: Args): Promise<Result> => {
    const fail = !reached && matches(...args)
    if (fail) reached = true
    if (fail && when === 'before') throw new Error('World preparation boundary interrupted')
    const result = await original(...args)
    if (fail) throw new Error('World preparation boundary interrupted')
    return result
  }
}

type Boundary = {
  stage: 'team-reserve' | 'team-create' | 'team-confirm' | 'entity' | 'participant-reserve' | 'invite'
    | 'provisioning' | 'membership-active' | 'binding' | 'channel-reserve' | 'channel-open' | 'consent-member'
    | 'consent-director' | 'channel-confirm' | 'relation' | 'ready' | 'world' | 'intent' | 'wake'
  id: string
}
const boundaries: Boundary[] = [
  ...(['team-reserve', 'team-create', 'team-confirm', 'world', 'intent', 'wake'] as const).map(stage => ({ stage, id: '' })),
  ...['studio', 'engineering', 'director', 'requester', 'observer'].map(id => ({ stage: 'entity' as const, id })),
  ...['director', 'requester', 'observer'].flatMap(id =>
    (['participant-reserve', 'invite', 'provisioning', 'membership-active', 'binding', 'ready'] as const).map(stage => ({ stage, id }))),
  ...['world-director:requester', 'world-director:observer'].flatMap(id =>
    (['channel-reserve', 'channel-open', 'consent-member', 'consent-director', 'channel-confirm'] as const).map(stage => ({ stage, id }))),
  ...['initial-assignment', 'hiring-authority'].map(id => ({ stage: 'relation' as const, id })),
]
function inject(h: Fixture, boundary: Boundary, when: 'before' | 'after') {
  const { run, ctx } = h, { stage, id } = boundary
  const original = { reserveTeam: run.reserveTeam.bind(run), createTeam: ctx.teams.createTeam.bind(ctx.teams),
    confirmTeam: run.confirmTeam.bind(run), change: run.change.bind(run), reserveParticipant: run.reserveParticipant.bind(run),
    inviteParticipant: ctx.teams.inviteParticipant.bind(ctx.teams),
    transitionParticipantPhase: ctx.teams.transitionParticipantPhase.bind(ctx.teams), bindEntity: run.bindEntity.bind(run),
    reserveChannel: run.reserveChannel.bind(run), openChannel: ctx.teams.openChannel.bind(ctx.teams),
    acknowledgeChannelInvitation: ctx.teams.acknowledgeChannelInvitation.bind(ctx.teams),
    confirmChannel: run.confirmChannel.bind(run), configureWorld: run.configureWorld.bind(run),
    openWorldIntent: run.openWorldIntent.bind(run), scheduleWake: run.scheduleWake.bind(run) }
  const participantId = () => run.inspectEntity(simulationEntityIdSchema.parse(id)).entity?.participantReservation?.binding.participantId
  const channel = () => Object.values(run.snapshot().channelReservations ?? {}).find(channel => channel.spec.key === id)
  switch (stage) {
    case 'team-reserve': vi.spyOn(run, 'reserveTeam').mockImplementation(interrupt(original.reserveTeam, () => true, when)); return
    case 'team-create': vi.spyOn(ctx.teams, 'createTeam').mockImplementation(interrupt(original.createTeam, () => true, when)); return
    case 'team-confirm': vi.spyOn(run, 'confirmTeam').mockImplementation(interrupt(original.confirmTeam, () => true, when)); return
    case 'entity':
    case 'relation':
    case 'ready': vi.spyOn(run, 'change').mockImplementation(interrupt(original.change, command =>
      command.kind === (stage === 'entity' ? 'entity/create' : stage === 'relation' ? 'relation/create' : 'entity/readiness') && command.id === id, when)); return
    case 'participant-reserve': vi.spyOn(run, 'reserveParticipant').mockImplementation(interrupt(original.reserveParticipant, entityId => entityId === id, when)); return
    case 'invite': vi.spyOn(ctx.teams, 'inviteParticipant').mockImplementation(interrupt(original.inviteParticipant, input =>
      input.displayName === h.resolved.actors.find(actor => actor.entityId === id)?.persona.name, when)); return
    case 'provisioning':
    case 'membership-active': vi.spyOn(ctx.teams, 'transitionParticipantPhase').mockImplementation(interrupt(original.transitionParticipantPhase, input =>
      input.participantId === participantId() && input.phase === (stage === 'provisioning' ? 'provisioning' : 'active'), when)); return
    case 'binding': vi.spyOn(run, 'bindEntity').mockImplementation(interrupt(original.bindEntity, entityId => entityId === id, when)); return
    case 'channel-reserve': vi.spyOn(run, 'reserveChannel').mockImplementation(interrupt(original.reserveChannel, input => input.key === id, when)); return
    case 'channel-open': vi.spyOn(ctx.teams, 'openChannel').mockImplementation(interrupt(original.openChannel, (input) => {
      const reserved = channel()
      return reserved !== undefined && input.participants.every(endpoint => reserved.spec.members.some(member =>
        run.inspectEntity(member.entityId).entity?.binding?.participantId === endpoint.id))
    }, when)); return
    case 'consent-member':
    case 'consent-director': vi.spyOn(ctx.teams, 'acknowledgeChannelInvitation').mockImplementation(interrupt(original.acknowledgeChannelInvitation, (input) => {
      const reserved = channel()
      if (reserved?.channelId !== input.channelId) return false
      // A proof-owned endpoint acknowledgement calls the real owner in member/director order.
      const own = reserved.spec.members[stage === 'consent-member' ? 0 : 1]
      return own !== undefined && JSON.stringify(input.idempotencyKey).includes(own.entityId)
    }, when)); return
    case 'channel-confirm': vi.spyOn(run, 'confirmChannel').mockImplementation(interrupt(original.confirmChannel, key => key === id, when)); return
    case 'world': vi.spyOn(run, 'configureWorld').mockImplementation(interrupt(original.configureWorld, () => true, when)); return
    case 'intent': vi.spyOn(run, 'openWorldIntent').mockImplementation(interrupt(original.openWorldIntent, () => true, when)); return
    case 'wake': vi.spyOn(run, 'scheduleWake').mockImplementation(interrupt(original.scheduleWake, () => true, when)); return
  }
}

function assertOriginalIdentities(prefix: SimulationSnapshot, completed: SimulationSnapshot) {
  if (prefix.teamReservation !== undefined) expect(completed.teamReservation?.teamId).toBe(prefix.teamReservation.teamId)
  for (const entity of Object.values(prefix.entities)) {
    const actual = completed.entities[entity.id]
    if (entity.participantReservation !== undefined) expect(actual?.participantReservation).toEqual(entity.participantReservation)
    if (entity.binding !== undefined) expect(actual?.binding).toEqual(entity.binding)
  }
  for (const channel of Object.values(prefix.channelReservations ?? {})) {
    expect(completed.channelReservations?.[channel.spec.key]?.channelId).toBe(channel.channelId)
  }
  for (const intent of Object.values(prefix.world?.intents ?? {})) {
    expect(completed.world?.intents[intent.id]).toEqual(intent)
  }
  for (const event of Object.values(prefix.scheduledEvents)) expect(completed.scheduledEvents[event.id]).toEqual(event)
}

describe.each(['json', 'sqlite'] as const)('%s World preparation', (backend) => {
  it.each(['company', 'laboratory'] as const)('prepares the %s scene with an inert checkpoint, exact retry and durable reopen', async (scenario) => {
    const h = await fixture(backend, scenario)
    const inference = vi.spyOn(h.ctx.agentRuntimes, 'activate')
    const change = h.run.change.bind(h.run)
    vi.spyOn(h.run, 'change').mockImplementation(async (command, revision) => {
      if (command.kind === 'entity/readiness') {
        const state = h.run.snapshot()
        expect(h.resolved.actors.every(actor =>
          state.entities[simulationEntityIdSchema.parse(actor.entityId)]?.binding !== undefined)).toBe(true)
        expect(Object.values(state.channelReservations ?? {}).every(channel => channel.confirmed)).toBe(true)
        expect(Object.keys(state.channelReservations ?? {})).toHaveLength(h.resolved.channels.length)
      }
      return await change(command, revision)
    })
    const result = await h.prepare()
    await assertInert(h, h.run, result)
    expect(inference).not.toHaveBeenCalled()
    const before = h.run.snapshot()
    expect(await h.prepare()).toEqual(result)
    expect(h.run.snapshot()).toEqual(before)
    vi.restoreAllMocks()
    await h.run.close()
    const reopened = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
    cleanups.push(() => reopened.close())
    expect(await h.prepare(reopened)).toEqual(result)
    expect(reopened.snapshot()).toEqual(before)
    await reopened.close()
    const restored = await h.ctx.simulationTeams.restore({ ...h.selection, mode: 'open' }, {
      id: result.checkpoint.request.id, implementationVersion: result.checkpoint.request.implementationVersion, maxAttempts: 3,
    })
    cleanups.push(() => restored.run.close())
    await assertInert(h, restored.run)
  })

  it.each(boundaries.flatMap(boundary => (['before', 'after'] as const).map(when => ({ ...boundary, when }))))
  ('recovers $when $stage $id without replacing original identities or admitting inference', async (boundary) => {
    const h = await fixture(backend)
    inject(h, boundary, boundary.when)
    await expect(h.prepare()).rejects.toThrow('World preparation boundary interrupted')
    const prefix = h.run.snapshot()
    await assertInert(h, h.run)
    vi.restoreAllMocks()
    await h.run.close()
    const reopened = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
    cleanups.push(() => reopened.close())
    const result = await h.prepare(reopened)
    assertOriginalIdentities(prefix, reopened.snapshot())
    await assertInert(h, reopened, result)
    const completed = reopened.snapshot()
    expect(await h.prepare(reopened)).toEqual(result)
    expect(reopened.snapshot()).toEqual(completed)
  })

  it('shares accepted equal work and rejects another original resolved payload while target IO is pending', async () => {
    const h = await fixture(backend), entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    const create = h.ctx.teams.createTeam.bind(h.ctx.teams)
    vi.spyOn(h.ctx.teams, 'createTeam').mockImplementationOnce(async (input) => {
      const team = await create(input)
      entered.resolve(undefined); await release.promise
      return team
    })
    const first = h.prepare()
    await entered.promise
    expect(h.prepare()).toBe(first)
    const changed = { ...h.request, resolved: { ...h.resolved, catalogGeneration: 'different-generation' } }
    await expect(h.prepare(h.run, changed)).rejects.toThrow('another original request')
    release.resolve(undefined)
    await assertInert(h, h.run, await first)
  })

  it.each(['metadata', 'generation', 'future-model', 'checkpoint'] as const)('rejects changed original %s after a committed root reservation', async (kind) => {
    const h = await fixture(backend)
    inject(h, { stage: 'team-reserve', id: '' }, 'after')
    await expect(h.prepare()).rejects.toThrow('interrupted')
    vi.restoreAllMocks()
    const changed: SimulationWorldPreparation = kind === 'checkpoint'
      ? { ...h.request, checkpoint: { ...h.request.checkpoint, id: simulationCheckpointIdSchema.parse('other') } }
      : { ...h.request, resolved: { ...h.resolved,
        ...kind === 'metadata' ? { definition: { ...h.resolved.definition, metadata: { ...h.resolved.definition.metadata, name: 'Changed' } } } : {},
        ...kind === 'generation' ? { catalogGeneration: 'Changed' } : {},
        ...kind === 'future-model' ? { generatedActorRuntime: { ...h.resolved.generatedActorRuntime,
          model: { ...h.resolved.generatedActorRuntime.model, version: 'changed' } } } : {},
      } }
    const before = h.run.snapshot()
    expect(() => h.prepare(h.run, changed)).toThrow('retained Team differs')
    expect(h.run.snapshot()).toEqual(before)
    await assertInert(h, h.run, await h.prepare())
  })

  it('retains a failed original checkpoint and never silently substitutes another identity', async () => {
    const h = await fixture(backend)
    vi.spyOn(h.run, 'acquireCheckpointCut').mockRejectedValueOnce(new Error('Checkpoint storage unavailable'))
    await expect(h.prepare()).rejects.toThrow('World initial checkpoint is incomplete')
    vi.restoreAllMocks()
    const before = h.run.snapshot()
    expect(before.checkpoints?.[h.request.checkpoint.id]?.status).toBe('failed')
    await expect(h.prepare()).rejects.toThrow('World initial checkpoint is incomplete')
    expect(h.run.snapshot()).toEqual(before)
  })

  it.each(['before', 'after'] as const)('retains the durable outcome when checkpoint publication fails %s commit', async (when) => {
    const h = await fixture(backend)
    const acquire = h.run.acquireCheckpointCut.bind(h.run)
    vi.spyOn(h.run, 'acquireCheckpointCut').mockImplementationOnce(async (...args) => {
      const cut = await acquire(...args)
      return { ...cut, publish: interrupt(cut.publish.bind(cut), manifest => manifest.id === h.request.checkpoint.id, when) }
    })
    if (when === 'before') await expect(h.prepare()).rejects.toThrow('World initial checkpoint is incomplete')
    else await assertInert(h, h.run, await h.prepare())
    vi.restoreAllMocks()
    const before = h.run.snapshot()
    expect(before.checkpoints?.[h.request.checkpoint.id]?.status).toBe(when === 'before' ? 'failed' : 'completed')
    if (when === 'before') await expect(h.prepare()).rejects.toThrow('World initial checkpoint is incomplete')
    else await assertInert(h, h.run, await h.prepare())
    expect(h.run.snapshot()).toEqual(before)
  })

  it('rejects progressed scheduling even after returning to paused at initial time', async () => {
    const h = await fixture(backend)
    await h.prepare()
    await h.run.setPhase('running', h.run.snapshot().revision)
    await h.run.drive({ until: simTimeSchema.parse('0') })
    await h.run.setPhase('paused', h.run.snapshot().revision)
    const before = h.run.snapshot()
    expect(() => h.prepare()).toThrow('unstarted paused history')
    expect(h.run.snapshot()).toEqual(before)
  })

  it('rejects changed retained actor before any further preparation writes', async () => {
    const h = await fixture(backend)
    await h.prepare()
    const id = simulationEntityIdSchema.parse('requester'), entity = h.run.inspectEntity(id).entity!
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id, entityRevision: entity.revision, profile: { name: 'Changed' } }), h.run.snapshot().revision)
    const before = h.run.snapshot()
    expect(() => h.prepare()).toThrow('retained entity differs')
    expect(h.run.snapshot()).toEqual(before)
  })

  it('rejects a changed retained authorization relation before further preparation writes', async () => {
    const h = await fixture(backend)
    await h.prepare()
    const original = h.resolved.relations.find(relation => relation.relation === 'can-hire')!
    await h.run.change(simulationChangeSchema.parse({ ...original, kind: 'relation/update', relationRevision: 1,
      validUntil: '10' }), h.run.snapshot().revision)
    const before = h.run.snapshot()
    expect(() => h.prepare()).toThrow('retained relation differs')
    expect(h.run.snapshot()).toEqual(before)
  })

  it('rejects a cancelled original initial wake instead of rescheduling the application', async () => {
    const h = await fixture(backend), result = await h.prepare()
    await h.run.cancelEvent(result.initialEvents[0]!.wakeId, 'Withdraw original application', h.run.snapshot().revision)
    const before = h.run.snapshot()
    expect(() => h.prepare()).toThrow('retained initial wake differs')
    expect(h.run.snapshot()).toEqual(before)
  })

  it('rejects any prior real actor activation even after its writer has been released', async () => {
    const h = await fixture(backend), result = await h.prepare()
    const connection = await h.ctx.simulationTeams.attach(h.run, result.teamId, result.ownerName)
    const actor = await connection.activate(simulationEntityIdSchema.parse('requester'), { provider: 'in-process',
      seed: { kind: 'fresh' }, agent: { options: {} }, signal: new AbortController().signal })
    await actor.dispose()
    await connection.close()
    const before = h.run.snapshot()
    expect(() => h.prepare()).toThrow('retained entity differs')
    expect(h.run.snapshot()).toEqual(before)
  })
})
