/** Read-only canonical owner collection and explicit incomplete coverage use real Native/Team/channel providers. */
import { readFile, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { teamTaskSnapshotSchema, teamWorkspaceAllocationSnapshotSchema, activationIdSchema,
  activationReservationIdSchema } from '@clocky/clocky-team/schema'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { personnelObligationQuerySchema, simulationChangeSchema, simulationEntityIdSchema, simulationChannelSpecSchema,
  simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import { catalog } from '../../simulation-scenario/tests/fixtures.ts'
import { collectPersonnelTeamSources } from '../src/personnel-sources.ts'
import { projectPersonnelObligations } from '../src/personnel-obligations.ts'
import { createContext } from './harness.ts'
import { simulationTemp } from '../../simulation-local/tests/temp.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup(backend: 'json' | 'sqlite') {
  const root = await simulationTemp('personnel-query')
  const { ctx } = await createContext(root, backend)
  await ctx.plugin(Direct)
  const compiled = await compileWorldScenario(worldScenarioSchema.parse(JSON.parse(
    await readFile('examples/simulation-company/scenarios/world-company.json', 'utf8'))), catalog())
  if (!compiled.ok) throw new Error('Personnel query fixture requires the valid author example')
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: { runId: 'personnel-query',
    ...compiled.resolved.native } })
  const run = await ctx.simulations.open(selection)
  cleanups.push(async () => { await run.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Inspect original responsibilities', budgets: {} },
    budgets: {} }, 'personnel/query')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'personnel/query')
  for (const name of ['buyer', 'supplier', 'observer']) {
    const id = simulationEntityIdSchema.parse(name)
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'person', cognition: 'agent',
      readiness: 'ready', profile: { private: 'PERSONNEL-PRIVATE-PROFILE-CANARY' } }), run.snapshot().revision)
    await connection.ensureParticipant(id, { displayName: name, role: name, capabilities: [], provider: 'in-process',
      preset: 'simulation', model: 'mock/default' })
  }
  for (const other of ['supplier', 'observer']) await connection.ensureChannel(simulationChannelSpecSchema.parse({
    key: `buyer-${other}`, members: [{ entityId: 'buyer', role: 'buyer' }, { entityId: other, role: 'supplier' }], limits: {} }))
  const id = simulationEntityIdSchema.parse('buyer')
  const query = () => personnelObligationQuerySchema.parse({ selector: { kind: 'person', personId: id,
    personRevision: run.snapshot().entities[id]?.revision }, limit: 100, maxBytes: 65536 })
  return { ctx, run, connection, teamId: team.team.id, query }
}

describe.each(['json', 'sqlite'] as const)('%s canonical personnel inventory', (backend) => {
  it('observes complete empty owner books without inferring, mutating or publishing private profile contents', async () => {
    const h = await setup(backend), before = h.run.snapshot(), team = await h.ctx.teams.getTeam({ teamId: h.teamId })
    const activate = vi.spyOn(h.ctx.teamActivations, 'activate')
    const report = await h.connection.inspectPersonnelObligations(h.query())
    expect(report).toMatchObject({ status: 'covered', complete: true, items: [], totalCount: 0,
      coverage: { team: { kind: 'observed', teamId: h.teamId, cursor: team.team.cursor } } })
    expect(report.coverage.team.kind === 'observed' && report.coverage.team.channels).toHaveLength(2)
    expect(JSON.stringify(report)).not.toContain('PERSONNEL-PRIVATE-PROFILE-CANARY')
    expect(h.run.snapshot()).toEqual(before)
    expect(await h.ctx.teams.getTeam({ teamId: h.teamId })).toEqual(team)
    expect(activate).not.toHaveBeenCalled()
    const native = h.run.inspectPersonnelObligations(h.query())
    expect(native).toMatchObject({ status: 'native-only', complete: false, coverage: { team: { kind: 'required' } } })
  })

  it('reports finite channel/page read limits as partial rather than empty full clearance', async () => {
    const h = await setup(backend)
    const selected = h.run.snapshot().entities[simulationEntityIdSchema.parse('buyer')]
    if (selected?.binding === undefined) throw new Error('Fixture requires its actual canonical binding')
    for (const [limits, reason] of [[{ maxChannels: 1, maxPages: 100, pageSize: 32, maxBytes: 65536 }, 'channel-limit'],
      [{ maxChannels: 100, maxPages: 1, pageSize: 32, maxBytes: 65536 }, 'page-limit']] as const) {
      const sources = await collectPersonnelTeamSources(h.ctx, selected.binding, limits, () => {})
      const report = projectPersonnelObligations(h.run.snapshot(), h.run.inspectPersonnelObligations(h.query()), sources, h.query())
      expect(report).toMatchObject({ complete: false, status: 'partial', coverage: { team: { kind: 'partial', reason } } })
    }
  })

  it('retains source movement as incomplete even if the observed task list was empty', async () => {
    const h = await setup(backend), original = h.ctx.teams.getTeam.bind(h.ctx.teams)
    let reads = 0
    vi.spyOn(h.ctx.teams, 'getTeam').mockImplementation(async (...args) => {
      const snapshot = await original(...args)
      return ++reads === 1 ? snapshot : { ...snapshot, team: { ...snapshot.team, cursor: snapshot.team.cursor + 1 } }
    })
    const report = await h.connection.inspectPersonnelObligations(h.query())
    expect(report).toMatchObject({ complete: false, status: 'partial', coverage: { team: { kind: 'partial', reason: 'source-moved' } } })
  })

  it('projects typed owner-book roles and unknown activation/workspace cleanup without treating an ownership hint as acceptance', async () => {
    const h = await setup(backend), state = h.run.snapshot(), native = h.run.inspectPersonnelObligations(h.query())
    const person = state.entities[simulationEntityIdSchema.parse('buyer')]!
    if (person.binding === undefined) throw new Error('Fixture requires its actual canonical binding')
    const binding = person.binding
    const original = await collectPersonnelTeamSources(h.ctx, binding, { maxChannels: 100, maxPages: 100,
      pageSize: 32, maxBytes: 65536 }, () => {})
    // Unit-only typed provider facts exercise projection; real creation/IO provenance is verified by the Loader fixture.
    const task = teamTaskSnapshotSchema.parse({ id: 'owned-task', teamId: h.teamId, createdAt: 0, revision: 2,
      execution: { kind: 'participant' }, createCommand: { creator: { teamId: h.teamId, participantId: binding.participantId },
        idempotencyKey: 'unit-owner-book' }, proposedOwnerId: binding.participantId,
      subject: 'TASK-BODY-CANARY', description: 'TASK-DESCRIPTION-CANARY', phase: 'assigned', blockedBy: [], requiredCapabilities: [],
      priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {},
      reviewPolicy: { kind: 'participant', reviewerId: binding.participantId }, reviewHistory: [], maxAttempts: 2,
      attemptCount: 1, attemptHistory: [], lease: { attemptId: 'original-attempt', assignedRevision: 2, ordinal: 1,
        participantId: binding.participantId, assignedAt: 0, durationMs: 100, renewedAt: 0, expiresAt: 100 } })
    const allocation = teamWorkspaceAllocationSnapshotSchema.parse({ id: 'original-allocation', revision: 1, teamId: h.teamId,
      taskId: task.id, attemptId: task.lease?.attemptId, assignedRevision: 2, participantId: binding.participantId,
      activationId: 'unconfirmed-activation', sessionId: binding.sessionId, provider: 'shared', mode: 'shared',
      lifecycle: 'release-requested', reservedAt: 0, updatedAt: 0, releaseRequestedAt: 0 })
    const sources = { ...original, team: { ...original.team, tasks: [task], workspaceAllocations: [allocation], activations: [{
      activation: { id: activationIdSchema.parse('unconfirmed-activation'), teamId: h.teamId,
        participantId: binding.participantId, status: 'offline' as const },
      sessionId: binding.sessionId, provider: 'in-process', boundAt: 0,
    }] } }
    const report = projectPersonnelObligations(state, native, sources, h.query())
    expect(report.complete).toBe(true)
    for (const relation of ['creator', 'proposed-owner', 'reviewer', 'owner']) expect(report.items.some(value =>
      value.ref.kind === 'team-task' && value.ref.taskId === task.id && value.ref.relation === relation)).toBe(true)
    expect(report.items.find(value => value.ref.kind === 'team-task' && value.ref.relation === 'proposed-owner')?.dispositions)
      .toEqual(['update-supported'])
    expect(report.items.some(value => value.ref.kind === 'team-attempt')).toBe(true)
    expect(report.items.find(value => value.ref.kind === 'team-activation')).toMatchObject({
      ref: { reservationId: null }, certainty: 'outcome-unknown', state: 'offline' })
    expect(report.items.find(value => value.ref.kind === 'team-workspace')).toMatchObject({
      state: 'release-requested', certainty: 'outcome-unknown', dispositions: ['wait'] })
    expect(JSON.stringify(report)).not.toContain('TASK-BODY-CANARY')
    expect(JSON.stringify(report)).not.toContain('TASK-DESCRIPTION-CANARY')
    const participant = original.team.participants.find(value => value.id === binding.participantId)!
    const startup = { ...original, team: { ...original.team, participants: [
      { ...participant, activationReservation: { id: activationReservationIdSchema.parse('unpublished-startup'),
        reservedAt: 0, sessionId: binding.sessionId, provider: 'in-process' } },
      ...original.team.participants.filter(value => value.id !== participant.id),
    ] } }
    expect(projectPersonnelObligations(state, native, startup, h.query()).items.find(value => value.ref.kind === 'team-startup'))
      .toMatchObject({ state: 'unpublished', certainty: 'outcome-unknown', dispositions: ['wait'] })
  })

  it('closes read admission immediately and drains the original in-flight owner observation without returning a late report', async () => {
    const h = await setup(backend), source = await h.ctx.teams.getTeam({ teamId: h.teamId })
    const pending = Promise.withResolvers<typeof source>(), entered = Promise.withResolvers<undefined>()
    vi.spyOn(h.ctx.teams, 'getTeam').mockImplementationOnce(() => { entered.resolve(undefined); return pending.promise })
    const reading = h.connection.inspectPersonnelObligations(h.query())
    await entered.promise
    let closed = false
    const closing = h.connection.close().then(() => { closed = true })
    expect(() => h.connection.inspectPersonnelObligations(h.query())).toThrow(/closed/)
    expect(closed).toBe(false)
    pending.resolve(source)
    await expect(reading).rejects.toThrow(/closed/)
    await closing
    expect(closed).toBe(true)
  })

  it('rejects stale person selection and a bound too small for its explicit overflow envelope before external owner IO', async () => {
    const h = await setup(backend), read = vi.spyOn(h.ctx.teams, 'getTeam'), query = h.query()
    await expect(h.connection.inspectPersonnelObligations({ ...query,
      selector: { ...query.selector, personRevision: query.selector.personRevision + 1 } })).rejects.toMatchObject({ code: 'SIM_PERSONNEL_STALE' })
    await expect(h.connection.inspectPersonnelObligations({ ...query, maxBytes: 10 })).rejects.toMatchObject({ code: 'SIM_PERSONNEL_INVENTORY_LIMIT' })
    expect(read).not.toHaveBeenCalled()
  })
})
