/** Real Native/Team initialization preserves complete initial data and inert canonical identities on both durable media. */
import { readFile, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { simulationChangeSchema, simulationChannelSpecSchema, simulationEntityIdSchema, simulationParticipantSpecSchema,
  simulationRunSelectionSchema, simulationWorldDefinitionSchema, simulationWorldBootstrapRequestSchema,
  WORLD_EXTERNAL_INTERACT_PIN, simulationDriveRequestSchema, checkpointWorldState, projectNormImpact, WORLD_CALENDAR_TZDB_VERSION,
  simulationResourceIdSchema, simulationQuantitySchema, simTimeSchema, simulationWakeRequestSchema,
  simulationEventIdSchema, WORLD_GENERATE_AND_HIRE_PIN, WORLD_GOVERNANCE_PROPOSE_PIN, SimulationWorldDomainRegistry } from '@clocky/clocky-simulation'
import { activationReservationIdSchema } from '@clocky/clocky-team'
import { compileWorldScenario } from '@clocky/clocky-simulation-scenario'
import { catalog } from '../../simulation-scenario/tests/fixtures.ts'
import { createContext } from '../../simulation-team/tests/harness.ts'
import { simulationTemp } from './temp.ts'
import type { LogStream } from '@clocky/clocky-storage'
import { assertWorldFactsProjection } from '../src/world-facts.ts'
import { directorTriggerFromWake, assertDirectorTrigger, directorEventBusinessKey } from '../src/world-director-event.ts'
import { assertWorldCalendarProjection } from '../src/world-calendar.ts'
import type { NativeWorldDomain } from '@clocky/clocky-simulation'
import { NativeWorldRuntime } from '../src/world-runtime.ts'
import { ExternalInteractNativeWorldDomain } from '../src/world-external.ts'
import { createWorldIntent } from '../src/world.ts'
import { frozenCommitteeProposalPolicies } from '../src/world-norm-bootstrap.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close() })
async function fixture(backend: 'json' | 'sqlite', proposalPermission = false) {
  const root = await simulationTemp('world-bootstrap'), h = await createContext(root, backend)
  await h.ctx.plugin(Direct)
  const input: unknown = JSON.parse(await readFile('examples/simulation-company/scenarios/world-company.json', 'utf8'))
  const compiled = await compileWorldScenario(input, catalog())
  if (!compiled.ok) throw new Error('Bootstrap reference scene failed compilation')
  const resolved = compiled.resolved
  const spec = { ...resolved.native, relationRules: [...resolved.native.relationRules,
    ...['committee-member', 'can-propose-norm'].map(relation => ({ relation, subjectKinds: ['person'],
      objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }))] }
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: { runId: 'bootstrap', ...spec } })
  const run = await h.ctx.simulations.open(selection)
  const owner = 'original-bootstrap-owner'
  const team = await h.ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Complete paused initialization', budgets: {} },
    budgets: {}, limits: resolved.limits.team }, owner)
  const connection = await h.ctx.simulationTeams.attach(run, team.team.id, owner)
  cleanups.push(async () => {
    await connection.close(); await run.close(); await h.ctx.fiber.dispose(); await rm(root, { recursive: true, force: true })
  })
  for (const command of resolved.entities) await run.change(simulationChangeSchema.parse(command), run.snapshot().revision)
  for (const id of ['committee', 'supplier']) await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id,
    entityKind: 'organization', cognition: 'none', readiness: 'ready', profile: { name: id } }), run.snapshot().revision)
  for (const actor of resolved.actors) await connection.ensureParticipant(simulationEntityIdSchema.parse(actor.entityId),
    simulationParticipantSpecSchema.parse({ displayName: actor.persona.name, role: actor.role, capabilities: actor.runtime.capabilities,
      provider: actor.runtime.provider, preset: actor.runtime.preset, model: `${actor.runtime.model.provider}/${actor.runtime.model.name}` }))
  for (const channel of resolved.channels) await connection.ensureChannel(simulationChannelSpecSchema.parse({ ...channel, limits: {} }))
  for (const command of resolved.relations) await run.change(simulationChangeSchema.parse(command), run.snapshot().revision)
  const member = resolved.actors.find(value => value.role === 'member')!, scope = resolved.world.organizationEntityId
  await run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'committee-member-original', subject: member.entityId,
    relation: 'committee-member', object: 'committee', scope, validFrom: '0', validUntil: null }), run.snapshot().revision)
  if (proposalPermission) await run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'committee-proposal-permission',
    subject: member.entityId, relation: 'can-propose-norm', object: 'committee', scope, validFrom: '0', validUntil: null }), run.snapshot().revision)
  const definition = simulationWorldDefinitionSchema.parse({ ...resolved.world,
    operations: [...resolved.world.operations, WORLD_EXTERNAL_INTERACT_PIN, ...proposalPermission ? [WORLD_GOVERNANCE_PROPOSE_PIN] : []],
    operationGrants: [...resolved.world.operationGrants, ...proposalPermission ? [{ requesterEntityId: member.entityId,
      domain: WORLD_GOVERNANCE_PROPOSE_PIN.domain, operation: WORLD_GOVERNANCE_PROPOSE_PIN.operation,
      version: WORLD_GOVERNANCE_PROPOSE_PIN.version, scopeEntityId: scope, targetEntityId: 'committee',
      relationId: 'committee-proposal-permission', relation: 'can-propose-norm' }] : []] })
  const request = simulationWorldBootstrapRequestSchema.parse({ definitionHash: resolved.definitionHash, definition,
    actorIds: resolved.actors.map(value => value.entityId), data: {
      resources: [{ id: 'stock', owner: 'supplier', kind: 'inventory', unit: 'widget', quantity: '7', controllers: [member.entityId] }],
      facts: [{ id: 'announcement', subjectId: scope, scopeId: scope, body: 'Known now, effective tomorrow.', effectiveFrom: '2',
        effectiveUntil: null, availableAt: '0', audience: { kind: 'public' } }],
      knowledge: [{ id: 'private', ownerId: member.entityId, body: 'Private authored belief.', observedAt: '0', availableAt: '0',
        validFrom: '0', validUntil: null, readers: [] }],
      norms: [{ id: 'rule', scopeId: scope, body: 'Scenario-authored advisory rule.', effectiveFrom: '0', effectiveUntil: null,
        availableAt: '0', audience: { kind: 'public' }, enforcement: { kind: 'advisory' } }],
      committeePolicies: [{ id: 'committee', name: 'Committee', description: 'Independent membership', scopeId: scope,
        members: [{ id: 'committee-member-original', personId: member.entityId, validFrom: '0', validUntil: null }],
        rule: { kind: 'unanimity' }, quorum: 1 }],
      externalIdentities: [{ scopeId: scope, externalKey: 'vendor', subjectId: 'supplier', representation: 'simulated-rule' }],
      behavior: { initialGoals: [], directorEvents: [], calendars: [{ id: 'role-calendar', target: { kind: 'position',
        positionId: resolved.world.positions[0]!.entityId }, body: 'Request new work through installed operations.',
      startsAt: '1', endsAt: '5', period: '2', maxOccurrences: 3 }] },
    } })
  return { ...h, root, run, selection, connection, request, member, scope, resolved }
}

describe.each(['json', 'sqlite'] as const)('%s original world initialization', (backend) => {
  it('exposes only actual applied committee rule and quorum through a live actor proposal permission', async () => {
    const h = await fixture(backend, true), actor = simulationEntityIdSchema.parse(h.member.entityId)
    expect(frozenCommitteeProposalPolicies(h.run.snapshot(), actor, WORLD_GOVERNANCE_PROPOSE_PIN)).toEqual([])
    const state = await h.run.initializeWorld(h.request, h.run.snapshot().revision)
    expect(frozenCommitteeProposalPolicies(state, actor, WORLD_GOVERNANCE_PROPOSE_PIN)).toEqual([{ committeeId: 'committee',
      scopeId: h.scope, rule: { kind: 'unanimity' }, quorum: 1,
      source: { bootstrapSequence: state.worldBootstrap!.sequence, definitionHash: h.request.definitionHash } }])
    expect(frozenCommitteeProposalPolicies(state, simulationEntityIdSchema.parse('foreign'), WORLD_GOVERNANCE_PROPOSE_PIN)).toEqual([])
    expect(frozenCommitteeProposalPolicies(state, actor, WORLD_GENERATE_AND_HIRE_PIN)).toEqual([])
    for (const id of [actor, simulationEntityIdSchema.parse('committee'), h.scope]) {
      const entity = state.entities[id]!
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id, entityRevision: entity.revision,
        phase: 'inactive' }), h.run.snapshot().revision)
      expect(frozenCommitteeProposalPolicies(h.run.snapshot(), actor, WORLD_GOVERNANCE_PROPOSE_PIN)).toEqual([])
      const current = h.run.snapshot().entities[id]!
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id, entityRevision: current.revision,
        phase: 'active' }), h.run.snapshot().revision)
    }
    expect(frozenCommitteeProposalPolicies({ ...state, spec: { ...state.spec,
      relationRules: state.spec.relationRules.filter(value => value.relation !== 'can-propose-norm') } }, actor,
    WORLD_GOVERNANCE_PROPOSE_PIN)).toEqual([])
    const relation = Object.values(state.relations).find(value => value.relation === 'can-propose-norm')!
    await h.run.change(simulationChangeSchema.parse({ kind: 'relation/update', id: relation.id, relationRevision: relation.revision,
      subject: relation.subject, object: 'supplier', relation: relation.relation, scope: relation.scope,
      validFrom: relation.validFrom, validUntil: relation.validUntil }), h.run.snapshot().revision)
    expect(frozenCommitteeProposalPolicies(h.run.snapshot(), actor, WORLD_GOVERNANCE_PROPOSE_PIN)).toEqual([])
    expect(h.ctx.simulationTeams.modelUsage().active).toBe(0)
  })
  it('publishes complete initial data and ready together, with no fabricated governance or inference', async () => {
    const h = await fixture(backend), before = h.run.snapshot()
    expect(Object.values(before.entities).filter(value => value.cognition === 'agent').every(value => value.readiness === 'preparing')).toBe(true)
    const state = await h.run.initializeWorld(h.request, before.revision)
    expect(state.phase).toBe('paused')
    expect(state.worldBootstrap).toMatchObject({ sequence: before.revision + 1, appliedSequence: before.revision + 2, status: 'applied' })
    expect(state.world?.sequence).toBe(state.worldBootstrap!.appliedSequence)
    expect(state.resources[simulationResourceIdSchema.parse('stock')]).toMatchObject({ quantity: '7', owner: 'supplier' })
    expect(Object.values(state.world!.facts)[0]![0]).toMatchObject({ sequence: state.worldBootstrap!.appliedSequence,
      source: { references: [{ kind: 'run-event', sequence: state.worldBootstrap!.sequence }] } })
    expect(Object.values(state.knowledge!)[0]![0]).toMatchObject({ source: { kind: 'belief' }, readers: [], revision: 1 })
    expect(Object.values(state.world!.norms.versions)[0]![0]).toMatchObject({ origin: 'scenario', version: '1',
      sequence: state.worldBootstrap!.appliedSequence, source: { bootstrapSequence: state.worldBootstrap!.sequence } })
    expect(state.world!.governance).toEqual({ proposals: {}, votes: {}, resolutions: {} })
    expect(Object.values(state.world!.external.identities)[0]).toMatchObject({ source: { kind: 'scenario',
      definitionHash: h.request.definitionHash, bootstrapSequence: state.worldBootstrap!.sequence } })
    expect(Object.values(state.scheduledEvents).filter(value => value.action.kind === 'world-calendar')).toHaveLength(1)
    expect(state.world!.intents).toEqual({})
    expect(state.decisions).toEqual({})
    expect(state.operations).toEqual({})
    expect(h.run.population().chargedActors).toBe(0)
    expect(h.ctx.simulationTeams.modelUsage().active).toBe(0)
    for (const entity of Object.values(state.entities)) if (entity.binding !== undefined)
      expect(await h.ctx.sessionPersistence.isUnmaterialized(entity.binding.sessionId)).toBe(true)
    const manifest = checkpointWorldState(state)!
    expect(() => { assertWorldFactsProjection(state) }).not.toThrow()
    const corrupted = structuredClone(state), initial = Object.values(corrupted.world!.facts)[0]![0]!
    initial.payload = { body: 'A forged scenario publication' }
    expect(() => { assertWorldFactsProjection(corrupted) }).toThrow(/provenance/)
    const { worldBootstrap: _book, ...missingBook } = state
    expect(() => { assertWorldFactsProjection(missingBook) }).toThrow(/provenance/)
    expect(manifest.records.filter(value => value.kind === 'bootstrap')).toHaveLength(1)
    const revision = state.revision
    expect(await h.run.initializeWorld(h.request, before.revision)).toEqual(state)
    expect(h.run.snapshot().revision).toBe(revision)
    const changed = structuredClone(h.request); changed.data.resources[0]!.quantity = simulationQuantitySchema.parse('8')
    await expect(h.run.initializeWorld(changed, revision)).rejects.toThrow(/changed/)
    expect(h.run.snapshot()).toEqual(state)
  })
  it('retains original unresolved preparation after a failed append and rejects activation until its exact retry applies', async () => {
    const h = await fixture(backend), revision = h.run.snapshot().revision
    const stream = Reflect.get(h.run, 'stream') as LogStream, append = stream.append.bind(stream)
    const spy = vi.spyOn(stream, 'append').mockImplementation(async (...args) => {
      if (args[1].some(value => (value as { change?: { kind?: string } }).change?.kind === 'world-bootstrap/applied'))
        throw new Error('Actual append refused before persistence')
      return append(...args)
    })
    await expect(h.run.initializeWorld(h.request, revision)).rejects.toThrow(/refused/)
    const retained = h.run.snapshot()
    expect(retained.worldBootstrap?.status).toBe('retained')
    expect(retained.world).toBeUndefined()
    expect(retained.resources).toEqual({})
    expect(retained.entities[simulationEntityIdSchema.parse(h.member.entityId)]!.readiness).toBe('preparing')
    await expect(h.run.setPhase('running', retained.revision)).rejects.toThrow(/initialization/)
    await expect(h.run.reserveWriter(simulationEntityIdSchema.parse(h.member.entityId), 'in-process',
      activationReservationIdSchema.parse('must-not-start'), retained.revision)).rejects.toThrow()
    spy.mockRestore()
    const applied = await h.run.initializeWorld(h.request, revision)
    expect(applied.worldBootstrap?.sequence).toBe(retained.worldBootstrap!.sequence)
    expect(applied.worldBootstrap?.status).toBe('applied')
    expect(applied.revision).toBe(retained.revision + 1)
  })
  it('retains finite shift exceptions through durable reopen without duplicating occurrences', async () => {
    const h = await fixture(backend)
    h.request.data.norms[0]!.availableAt = simTimeSchema.parse('10')
    h.request.data.behavior.calendars[0]!.recurrence = {
      version: 1, clock: 'simulation', shifts: [simTimeSchema.parse('0'), simTimeSchema.parse('1')],
      exceptions: [simTimeSchema.parse('2'), simTimeSchema.parse('3'), simTimeSchema.parse('4')], additions: [],
    }
    await h.run.initializeWorld(h.request, h.run.snapshot().revision)
    await h.run.setPhase('running', h.run.snapshot().revision)
    await h.run.drive(simulationDriveRequestSchema.parse({ until: '1' }))
    const before = h.run.snapshot()
    expect(before.worldBootstrap!.occurrences.map(value => value.time)).toEqual(['1'])
    expect(Object.values(before.scheduledEvents).filter(value => value.action.kind === 'world-calendar'
      && value.status === 'pending').map(value => value.key.time)).toEqual(['5'])
    await h.connection.close(); await h.run.close()
    const restored = await h.ctx.simulations.open(simulationRunSelectionSchema.parse({ ...h.selection, mode: 'open' }))
    try {
      expect(restored.snapshot().worldBootstrap).toEqual(before.worldBootstrap)
      assertWorldCalendarProjection(restored.snapshot())
    } finally { await restored.close() }
  })
  it('compiles civil shifts from bundled tzdb and previews every lazy future occurrence', async () => {
    const h = await fixture(backend)
    h.request.data.norms[0]!.availableAt = simTimeSchema.parse('10')
    const calendar = h.request.data.behavior.calendars[0]!
    calendar.civil = { version: 1, timeZone: 'Etc/UTC', tzdbVersion: WORLD_CALENDAR_TZDB_VERSION,
      disambiguation: 'reject', origin: '2026-10-19T00:00:00Z', tickMilliseconds: 60000,
      from: '2026-10-19', until: '2026-10-19', weekdays: [1], shifts: ['00:01:00', '00:03:00', '00:05:00'],
      exceptDates: [], additions: [] }
    calendar.priority = 11
    await h.run.initializeWorld(h.request, h.run.snapshot().revision)
    const state = h.run.snapshot()
    const report = projectNormImpact(state, { normId: 'preview-only', scope: state.world!.definition.organizationEntityId,
      effectiveFrom: state.time, effectiveUntil: null, enforcement: { kind: 'advisory' }, impact: 'future-admissions' })
    expect(report.futureCalendar).toMatchObject([{ firstAt: '1', lastAt: '5', occurrences: 3, ruleRevision: 1 }])
    expect(report.futureCalendar[0]?.pendingEventIds).toHaveLength(1)
    expect(projectNormImpact(state, { normId: 'preview-only', scope: state.world!.definition.organizationEntityId,
      effectiveFrom: simTimeSchema.parse('2'), effectiveUntil: simTimeSchema.parse('5'), enforcement: { kind: 'advisory' },
      impact: 'future-admissions' }).futureCalendar).toMatchObject([{ firstAt: '3', lastAt: '3', occurrences: 1 }])
    await h.connection.close(); await h.run.close()
    const restored = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
    try { expect(restored.snapshot().worldBootstrap).toEqual(state.worldBootstrap); assertWorldCalendarProjection(restored.snapshot()) }
    finally { await restored.close() }
  })
  it('retains an unexecuted original across Native reopen and refuses a competing tab replacement', async () => {
    const h = await fixture(backend)
    await h.run.initializeWorld(h.request, h.run.snapshot().revision)
    const before = h.run.snapshot()
    const command = { commandId: 'durable-original', expectedRuleRevision: 1,
      calendar: { ...h.request.data.behavior.calendars[0]!, priority: 7,
        startsAt: simTimeSchema.parse('6'), endsAt: simTimeSchema.parse('8'), maxOccurrences: 2 } }
    const retained = await h.run.retainWorldCalendarCommand(command, before.revision, `sha256:${'a'.repeat(64)}`, 'author')
    expect(h.run.snapshot().worldBootstrap?.calendarRevisions).toBeUndefined()
    await expect(h.run.retainWorldCalendarCommand({ ...command, commandId: 'other-tab' },
      h.run.snapshot().revision, `sha256:${'b'.repeat(64)}`, 'author')).rejects.toThrow()
    await h.connection.close(); await h.run.close()
    const restored = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
    try {
      expect(restored.snapshot().worldBootstrap?.calendarCommands).toEqual([retained])
      const applied = await restored.reviseWorldCalendar(command, before.revision, 'author')
      expect(applied.worldBootstrap?.calendarRevisions).toHaveLength(1)
      expect(Object.values(applied.scheduledEvents).filter(event => event.status === 'pending'
        && event.action.kind === 'world-calendar').map(event => event.key.priority)).toEqual([7])
      const cancelled = await restored.cancelWorldCalendarCommand(command.commandId, 'author')
      expect(cancelled.worldBootstrap?.calendarRevisions).toHaveLength(1)
      expect(cancelled.worldBootstrap?.calendarCommands?.[0]?.cancelledAt).toBeUndefined()
      expect(checkpointWorldState(cancelled)?.records.filter(record => record.kind === 'calendar-command')).toHaveLength(1)
    } finally { await restored.close() }
  })
  it('replaces only pending future schedule with CAS and preserves original wake recipients across reopen', async () => {
    const h = await fixture(backend)
    h.request.data.norms[0]!.availableAt = simTimeSchema.parse('10')
    await h.run.initializeWorld(h.request, h.run.snapshot().revision)
    await h.run.setPhase('running', h.run.snapshot().revision)
    await h.run.drive(simulationDriveRequestSchema.parse({ until: '1' }))
    await h.run.setPhase('paused', h.run.snapshot().revision)
    const before = h.run.snapshot(), original = before.worldBootstrap!.occurrences[0]!
    const command = { commandId: 'reschedule', expectedRuleRevision: 1,
      calendar: { ...h.request.data.behavior.calendars[0]!, startsAt: simTimeSchema.parse('6'), endsAt: simTimeSchema.parse('8'), maxOccurrences: 2 } }
    const revised = await h.run.reviseWorldCalendar(command, before.revision)
    expect(revised.worldBootstrap!.occurrences[0]).toEqual(original)
    expect(checkpointWorldState(revised)?.records.filter(value => value.kind === 'calendar-revision')).toHaveLength(1)
    expect(Object.values(revised.scheduledEvents).filter(value => value.action.kind === 'world-calendar' && value.status === 'pending')
      .map(value => value.key.time)).toEqual(['6'])
    expect(await h.run.reviseWorldCalendar(command, before.revision)).toEqual(revised)
    await expect(h.run.reviseWorldCalendar({ ...command, commandId: 'stale' }, revised.revision)).rejects.toThrow(/conflicts/)
    await expect(h.run.reviseWorldCalendar({ ...command, calendar: { ...command.calendar, body: 'changed' } }, revised.revision)).rejects.toThrow(/identity/)
    await h.connection.close(); await h.run.close()
    const restored = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
    try { expect(restored.snapshot().worldBootstrap).toEqual(revised.worldBootstrap); assertWorldCalendarProjection(restored.snapshot()) }
    finally { await restored.close() }
  })
  it('freezes position recipients at actual occurrence and queues only one finite successor', async () => {
    const h = await fixture(backend)
    h.request.data.norms[0]!.availableAt = simTimeSchema.parse('10')
    await h.run.initializeWorld(h.request, h.run.snapshot().revision)
    await h.run.setPhase('running', h.run.snapshot().revision)
    const result = await h.run.drive(simulationDriveRequestSchema.parse({ until: '1' }))
    expect(result.reason).toBe('decision-required')
    const state = h.run.snapshot(), occurrence = state.worldBootstrap!.occurrences[0]!
    expect(occurrence).toMatchObject({ occurrence: 0, time: '1', recipients: [h.member.entityId] })
    const pending = Object.values(state.scheduledEvents).filter(value => value.action.kind === 'world-calendar' && value.status === 'pending')
    expect(pending).toHaveLength(1)
    expect(pending[0]!.key.time).toBe('3')
    expect(state.world!.intents).toEqual({})
    expect(state.decisions).toEqual({})
    expect(Object.values(state.wakes).some(value => value.reason.includes('Request new work'))).toBe(true)
  })
})


describe.each(['json', 'sqlite'] as const)('%s original director scene authority', (backend) => {
  it('requires an installed environmental capability and a bounded original declaration before retaining data', async () => {
    const h = await fixture(backend), before = h.run.snapshot()
    const declaration = { id: 'scene', calendarId: 'role-calendar', domain: 'organization', operation: 'generate-and-hire', version: '1',
      scopeId: h.scope, targetId: h.request.definition.positions[0]!.entityId, maxRequests: 1 }
    const bad = simulationWorldBootstrapRequestSchema.parse({ ...h.request, data: { ...h.request.data,
      behavior: { ...h.request.data.behavior, directorEvents: [declaration] } } })
    expect(bad.definition.operations).toContainEqual(WORLD_GENERATE_AND_HIRE_PIN)
    await expect(h.run.initializeWorld(bad, before.revision)).rejects.toThrow(/installed environment capability/i)
    expect(h.run.snapshot()).toEqual(before)
    const tooMany = simulationWorldBootstrapRequestSchema.parse({ ...bad, data: { ...bad.data,
      behavior: { ...bad.data.behavior, directorEvents: [{ ...declaration, domain: 'external', operation: 'interact', maxRequests: 4 }] } } })
    await expect(h.run.initializeWorld(tooMany, before.revision)).rejects.toThrow(/budget|occurrence/i)
    expect(h.run.snapshot()).toEqual(before)
    for (const maxRequests of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(simulationWorldBootstrapRequestSchema.safeParse({ ...bad, data: { ...bad.data,
        behavior: { ...bad.data.behavior, directorEvents: [{ ...declaration, maxRequests }] } } }).success).toBe(false)
    }
  })
  it('derives one exact wake from a consumed finite occurrence and refuses copied or edited source authority', async () => {
    const h = await fixture(backend), director = h.request.definition.directorEntityId
    h.request.data.norms[0]!.availableAt = simTimeSchema.parse('10')
    h.request.data.behavior.calendars[0]!.target = { kind: 'person', personId: director }
    h.request.data.behavior.directorEvents = simulationWorldBootstrapRequestSchema.parse({ ...h.request, data: { ...h.request.data,
      behavior: { ...h.request.data.behavior, directorEvents: [{ id: 'scene', calendarId: 'role-calendar', domain: 'external',
        operation: 'interact', version: '1', scopeId: h.scope, targetId: 'supplier', maxRequests: 2 }] } } }).data.behavior.directorEvents
    await h.run.initializeWorld(h.request, h.run.snapshot().revision)
    await h.run.setPhase('running', h.run.snapshot().revision)
    expect((await h.run.drive(simulationDriveRequestSchema.parse({ until: '1' }))).reason).toBe('decision-required')
    const state = h.run.snapshot(), occurrence = state.worldBootstrap!.occurrences[0]!, entry = occurrence.directorEvents[0]!
    expect(occurrence.recipients).toEqual([]); expect(entry.status).toBe('eligible')
    if (entry.status !== 'eligible') throw new Error('Actual scene did not retain its original wake')
    const wakeId = entry.wakeId, trigger = directorTriggerFromWake(state, wakeId)
    expect(trigger).toMatchObject({ declarationId: 'scene', calendarId: 'role-calendar', occurrence: 0, sequence: occurrence.sequence,
      bootstrapSequence: state.worldBootstrap!.sequence, time: '1', eventId: occurrence.eventId })
    expect(assertDirectorTrigger(state, trigger).maxRequests).toBe(2)
    expect(directorEventBusinessKey(trigger)).toMatch(/^scenario:/)
    const registry = new SimulationWorldDomainRegistry<NativeWorldDomain>(), module = new ExternalInteractNativeWorldDomain()
    const unregister = registry.register(module.definition, module), runtime = new NativeWorldRuntime(registry)
    const proposal = { kind: 'world/request', domain: 'external', operation: 'interact', version: '1',
      businessKey: directorEventBusinessKey(trigger), expectedTime: null, evidence: [], payload: { scope: h.scope,
        subjectRef: 'supplier', externalKey: 'vendor', sourceKind: 'simulated-rule', policyRef: 'clocky.external.availability/1',
        input: { kind: 'availability', unit: 'widget' } } }
    try {
      const original = createWorldIntent(state, director, proposal, WORLD_EXTERNAL_INTERACT_PIN, state.revision + 1, runtime, trigger)
      expect(original).toMatchObject({ requesterEntityId: director, scenarioTrigger: trigger, targetEntityId: 'supplier' })
      expect(() => createWorldIntent(state, director, proposal, WORLD_EXTERNAL_INTERACT_PIN,
        state.revision + 1, runtime)).toThrow(/employment/)
      expect(() => createWorldIntent(state, simulationEntityIdSchema.parse(h.member.entityId), proposal,
        WORLD_EXTERNAL_INTERACT_PIN, state.revision + 1, runtime, trigger)).toThrow(/scenario/)
      expect(() => createWorldIntent(state, director, { ...proposal, businessKey: 'another-id' },
        WORLD_EXTERNAL_INTERACT_PIN, state.revision + 1, runtime, trigger)).toThrow(/business key/)
      expect(() => createWorldIntent(state, director, { ...proposal, payload: { ...proposal.payload, scope: 'committee' } },
        WORLD_EXTERNAL_INTERACT_PIN, state.revision + 1, runtime, trigger)).toThrow()
      expect(() => createWorldIntent(state, director, { ...proposal, payload: { ...proposal.payload, subjectRef: 'committee' } },
        WORLD_EXTERNAL_INTERACT_PIN, state.revision + 1, runtime, trigger)).toThrow()
      expect(() => createWorldIntent(state, director, { ...proposal, director: true },
        WORLD_EXTERNAL_INTERACT_PIN, state.revision + 1, runtime, trigger)).toThrow()
      const retained = { ...structuredClone(state), world: { ...structuredClone(state.world!),
        intents: { ...state.world!.intents, [original.id]: original } } }
      expect(createWorldIntent(retained, director, proposal, WORLD_EXTERNAL_INTERACT_PIN,
        retained.revision + 1, runtime, trigger)).toEqual(original)
      expect(() => createWorldIntent(retained, director, { ...proposal, payload: { ...proposal.payload,
        input: { kind: 'availability', unit: 'other' } } }, WORLD_EXTERNAL_INTERACT_PIN, retained.revision + 1, runtime, trigger)).toThrow(/changed/)
      expect(() => createWorldIntent(retained, director, proposal, WORLD_EXTERNAL_INTERACT_PIN,
        retained.revision + 1, runtime)).toThrow(/changed/)
      expect(h.run.snapshot()).toEqual(state)
    } finally { runtime.close(); await unregister() }
    expect(() =>{  assertWorldCalendarProjection(state) }).not.toThrow()
    for (const change of ['actor', 'reason', 'phase', 'time', 'parent', 'declaration', 'entry'] as const) {
      let corrupted = structuredClone(state)
      const wake = corrupted.scheduledEvents[wakeId]!
      if (wake.action.kind !== 'wake') throw new Error('Original scene wake lost its action')
      if (change === 'actor') wake.action.entityId = simulationEntityIdSchema.parse(h.member.entityId)
      else if (change === 'reason') wake.action.reason = JSON.stringify({ kind: 'world-director-event', declarationId: 'scene' })
      else if (change === 'phase') wake.key.phase = 'delivery'
      else if (change === 'time') wake.key.time = simTimeSchema.parse('2')
      else if (change === 'parent') corrupted = { ...corrupted, scheduledEvents: { ...corrupted.scheduledEvents,
        [occurrence.eventId]: { ...corrupted.scheduledEvents[occurrence.eventId]!, status: 'pending' } } }
      else if (change === 'declaration') corrupted.worldBootstrap!.request.data.behavior.directorEvents = []
      else corrupted.worldBootstrap!.occurrences[0]!.directorEvents = []
      expect(() =>{  assertWorldCalendarProjection(corrupted) }, change).toThrow()
    }
    expect(() => assertDirectorTrigger(state, { ...trigger, sequence: trigger.sequence + 1 })).toThrow(/trigger/)
    expect(() => directorTriggerFromWake(state, simulationEventIdSchema.parse(`${wakeId}:copy`))).toThrow(/actual/)
    await expect(h.run.scheduleWake(simulationWakeRequestSchema.parse({ id: `${wakeId}:copy`, entityId: director,
      time: '1', reason: state.scheduledEvents[wakeId]!.action.kind === 'wake' ? state.scheduledEvents[wakeId]!.action.reason : '' }),
    state.revision)).rejects.toThrow()
    expect(h.run.snapshot()).toEqual(state)
  })
})
