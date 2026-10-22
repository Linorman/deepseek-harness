import { worldRolePlan, worldRolePlanOperationId } from '@clocky/clocky-simulation'
import assert from 'node:assert/strict'
import { simulationWorldHireCommittedResultPayloadSchema } from '@clocky/clocky-simulation'
import { NativeWorldRuntime } from '@clocky/clocky-simulation-local/src/world-runtime.ts'
import { createWorldIntent } from '@clocky/clocky-simulation-local/src/world.ts'
import { SimulationWorldExecutions } from '@clocky/clocky-simulation-world'
import { OrganizationNativeWorldDomain } from '@clocky/clocky-simulation-local/src/world-organization.ts'
import { SimulationWorldDomainRegistry } from '@clocky/clocky-simulation'
import { seedHiringIntent, hiringIntentFields } from '../../../../examples/simulation-company/tests/world-domain-input.ts'
import { WORLD_GENERATE_AND_HIRE_PIN } from '@clocky/clocky-simulation'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import * as Direct from '@clocky/clocky-team-channel-direct'
import * as Tools from '@clocky/clocky-tool-simulation'
import {
  simulationChangeSchema, simulationChannelSpecSchema, simulationDecisionIdSchema, simulationEntityIdSchema,
  simulationHireIntentRequestSchema, simulationRunSelectionSchema, simulationWorldDefinitionSchema, simTimeSchema,
  simulationWorldCancelRequestSchema, simulationCheckpointIdSchema, worldRequestIdSchema,
} from '@clocky/clocky-simulation'
import type { SimulationWorldResolveOperation, SimulationWriterLease } from '@clocky/clocky-simulation'
import type { TeamLimits } from '@clocky/clocky-team'
import { activationHistoryLimitDetails } from '@clocky/clocky-team'
import { AgentRuntimeTerminationUnconfirmedError } from '@clocky/clocky-agent-runtime'
import { MockAdapter, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { contextRequest } from '../../simulation-local/tests/context-fixture.ts'
import { createContext } from './harness.ts'
import { assertExternalRepresentativeCleanup, assertWorldHireCleanup, validateWorldCleanupHistory } from '../src/world-cleanup.ts'
import { simulationExternalRepresentativeReservationSchema } from '@clocky/clocky-simulation'
import { simulationExternalContactSchema, simulationMaintenanceRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
const projectionDomain = new OrganizationNativeWorldDomain()
const projectionCatalog = new SimulationWorldDomainRegistry<OrganizationNativeWorldDomain>()
projectionCatalog.register(projectionDomain.definition, projectionDomain)
const projectionRuntime = new NativeWorldRuntime(projectionCatalog)

const requester = simulationEntityIdSchema.parse('requester')
const director = simulationEntityIdSchema.parse('director')
const persona = { name: 'Lin', skills: ['analysis'], traits: ['patient'], goals: ['research'] }

it.each((['json', 'sqlite'] as const).flatMap(backend => (['terminal', 'retained', 'lost-close', 'unknown-read'] as const)
  .map(mode => ({ backend, mode }))))('settles $backend contact Channel ownership with mode=$mode without retiring its ready endpoint',
  async ({ backend, mode }) => {
    const h = await hireFixture(backend)
    const reservation = await h.run.reserveWorldHire(h.input)
    await h.connection.quiesceForMaintenance(h.input.maintenance, 4, 3)
    await h.run.prepareWorldHire(reservation.id)
    const { modelVersion: _version, ...member } = reservation.request.member
    await h.connection.ensureParticipant(reservation.identities.entityId, member)
    for (const channel of reservation.identities.channels) {
      await h.connection.ensureChannel(simulationChannelSpecSchema.parse({ key: channel.key,
        members: [{ entityId: reservation.identities.entityId, role: 'member' },
          { entityId: channel.purpose === 'director' ? director : requester, role: channel.purpose }], limits: {} }))
    }
    await h.run.commitWorldHire(reservation.id)
    await h.run.finishMaintenance(h.input.maintenance)
    await h.run.setPhase('paused', h.run.snapshot().revision)
    const spec = simulationChannelSpecSchema.parse({ key: 'original-caller-contact', limits: {}, members: [
      { entityId: reservation.identities.entityId, role: 'member' }, { entityId: requester, role: 'requester' },
    ] })
    const channel = await h.connection.ensureChannel(spec)
    const actor = await h.connection.activate(reservation.identities.entityId, { provider: 'in-process', seed: { kind: 'fresh' },
      agent: { options: { provider: 'requester-model', model: 'scripted' } }, signal: new AbortController().signal })
    if (actor.localAgent === undefined) throw new Error('Canonical contact endpoint has no real local Agent')
    expect(await h.ctx.sessions.flush(actor.localAgent.session)).toBe(true)
    const maintenance = simulationMaintenanceRequestSchema.parse({ id: 'original-contact-cancellation', owner: 'contact-owner' })
    await h.connection.quiesceForMaintenance(maintenance, 4, 3)
    const original = h.run.snapshot()
    const endpoint = original.entities[reservation.identities.entityId]!
    const stored = await h.ctx.sessionPersistence.readFrom(reservation.identities.binding.sessionId, 0)
    expect(await h.ctx.sessionPersistence.isUnmaterialized(reservation.identities.binding.sessionId)).toBe(false)
    await h.connection.close()
    let verify: Parameters<SimulationRun['onExternalContactCleanup']>[1] | undefined
    const register = h.run.onExternalContactCleanup.bind(h.run)
    const capture = vi.spyOn(h.run, 'onExternalContactCleanup').mockImplementation((owner, callback) => {
      verify = callback
      return register(owner, callback)
    })
    const owner = original.teamReservation!.creation.rules['activationLifecycleOwner']
    if (typeof owner !== 'string') throw new Error('Contact fixture lost its original canonical owner')
    const connection = await h.ctx.simulationTeams.attach(h.run, reservation.identities.binding.teamId, owner)
    capture.mockRestore()
    if (verify === undefined) throw new Error('Confirmed Native Team did not register its contact cleanup owner')
    const cleanup = verify
    const { approvals: _approvals, ...hire } = original.world!.reservations[reservation.id]!
    const representative = simulationExternalRepresentativeReservationSchema.parse({ ...hire, identityId: 'contact-identity', generation: 1 })
    const contact = simulationExternalContactSchema.parse({ id: 'cancelled-caller-contact', identityId: representative.identityId,
      representativeIntentId: representative.id, generation: 1, requestId: 'cancelled-contact-request', planId: representative.request.planId,
      requesterEntityId: requester, channel: { key: spec.key, channelId: channel.manifest.id }, status: 'cancel-requested',
      sequence: original.revision - 2, updatedSequence: original.revision,
      cancellation: { maintenance, sequence: original.revision - 1 } })
    const keeper = simulationExternalContactSchema.parse({ ...contact, id: 'original-contact-keeper', requestId: 'original-keeper-request',
      status: 'reserved', sequence: original.revision - 4, updatedSequence: original.revision - 3, cancellation: undefined })
    // Typed domain projections isolate the Team callback. Real external acceptance/Native settlement belong to the Loader matrix.
    const projected = { ...original, world: { ...original.world!, requests: { ...original.world!.requests,
      [contact.requestId]: { ...h.request, id: contact.requestId, intentId: contact.id, status: 'cancel-requested' as const } },
    external: { ...original.world!.external, representatives: { [representative.id]: representative },
      contacts: { [contact.id]: contact, ...mode === 'retained' ? { [keeper.id]: keeper } : {} } } } }
    const snapshot = vi.spyOn(h.run, 'snapshot').mockReturnValue(projected)
    let fault: { mockRestore(): void } | undefined
    const close = h.ctx.teams.closeChannel.bind(h.ctx.teams)
    const read = h.ctx.teams.getChannelAdmission.bind(h.ctx.teams)
    try {
      if (mode === 'lost-close') fault = vi.spyOn(h.ctx.teams, 'closeChannel').mockImplementationOnce(async (input) => {
        await close(input)
        throw new Error('Contact closure response lost after durable IO')
      })
      if (mode === 'unknown-read') fault = vi.spyOn(h.ctx.teams, 'getChannelAdmission').mockImplementationOnce(async (input) => {
        if (input.channelId === contact.channel.channelId) throw new Error('Contact source read outcome unknown')
        return await read(input)
      })
      if (mode === 'lost-close' || mode === 'unknown-read') {
        await expect(cleanup(contact)).rejects.toThrow(/lost|unknown/)
        expect(h.run.snapshot()).toEqual(projected)
        fault?.mockRestore(); fault = undefined
      }
      const evidence = await cleanup(contact)
      expect(evidence.kind).toBe(mode === 'retained' ? 'retained' : 'terminal')
      expect(evidence.channel.phase).toBe(mode === 'retained' ? 'active' : 'closed')
      expect(h.run.snapshot().entities[endpoint.id]).toEqual(endpoint)
      expect(await h.ctx.sessionPersistence.readFrom(reservation.identities.binding.sessionId, 0)).toEqual(stored)
      expect((await h.ctx.teams.getTeam({ teamId: reservation.identities.binding.teamId })).participants
        .find(value => value.id === reservation.identities.binding.participantId)?.phase).toBe('active')
      const recorded = { ...contact, status: 'cancelled' as const, updatedSequence: original.revision + 1,
        cleanup: { sequence: original.revision + 1, evidence } }
      let history = { ...projected, revision: original.revision + 1, world: { ...projected.world,
        external: { ...projected.world.external, contacts: { [contact.id]: recorded,
          ...mode === 'retained' ? { [keeper.id]: keeper } : {} } } } }
      const team = await h.ctx.teams.getTeam({ teamId: reservation.identities.binding.teamId })
      await expect(validateWorldCleanupHistory(h.ctx, history, team, () => {})).resolves.toBeUndefined()
      if (evidence.kind === 'retained') {
        // The later keeper cancellation may close the Channel; the old retained observation still owns its exact immutable prefix.
        const withdrawn = simulationExternalContactSchema.parse({ ...keeper, status: 'cancel-requested',
          updatedSequence: original.revision + 2, cancellation: { maintenance, sequence: original.revision + 2 } })
        history = { ...history, revision: original.revision + 2, world: { ...history.world,
          requests: { ...history.world.requests, [withdrawn.requestId]: {
            ...h.request, id: withdrawn.requestId, intentId: withdrawn.id, status: 'cancel-requested' as const } },
          external: { ...history.world.external, contacts: { [contact.id]: recorded, [withdrawn.id]: withdrawn } } } }
        snapshot.mockReturnValue(history)
        const retiredKeeper = await cleanup(withdrawn)
        expect(retiredKeeper.kind).toBe('terminal')
        expect(retiredKeeper.channel.phase).toBe('closed')
        const finalHistory = { ...history, revision: original.revision + 3, world: { ...history.world,
          external: { ...history.world.external, contacts: { [contact.id]: recorded, [withdrawn.id]: {
            ...withdrawn, status: 'cancelled' as const, updatedSequence: original.revision + 3,
            cleanup: { sequence: original.revision + 3, evidence: retiredKeeper } } } } } }
        await expect(validateWorldCleanupHistory(h.ctx, finalHistory,
          await h.ctx.teams.getTeam({ teamId: reservation.identities.binding.teamId }), () => {})).resolves.toBeUndefined()
        await connection.close()
        await expect(async () => await cleanup(contact)).rejects.toThrow(/closed/)
      }
    } finally { fault?.mockRestore(); snapshot.mockRestore() }
    expect(h.run.snapshot()).toEqual(original)
  })

it.each(['json', 'sqlite'] as const)('keeps %s representative cleanup authority in its own Native book', async (backend) => {
  const h = await hireFixture(backend)
  const reserved = await h.run.reserveWorldHire(h.input)
  await h.connection.quiesceForMaintenance(h.input.maintenance, 4, 3)
  await h.run.prepareWorldHire(reserved.id)
  const command = simulationWorldCancelRequestSchema.parse({ id: 'owner-book-cancellation', requestId: h.request.id })
  const pending = await h.run.cancelWorldCase(command)
  const original = h.run.snapshot(), hire = original.world!.reservations[reserved.id]!
  const { approvals: _hireApprovals, ...identity } = hire
  const representative = simulationExternalRepresentativeReservationSchema.parse({ ...identity, identityId: 'original-external', generation: 1 })
  // These typed projections isolate the domain-book guard. The Loader owns real external request acceptance and Native folds.
  const external = { ...original, world: { ...original.world!, reservations: {}, external: {
    ...original.world!.external, representatives: { [representative.id]: representative } } } }
  const snapshot = vi.spyOn(h.run, 'snapshot').mockReturnValue(external)
  try {
    expect(() => { assertExternalRepresentativeCleanup(h.run, representative, () => {}) }).not.toThrow()
    expect(() => { assertWorldHireCleanup(h.run, hire, () => {}) }).toThrow(/cancelled hire/)
    for (const row of [undefined, { ...representative, status: 'preparing' as const },
      { ...representative, identityId: simulationExternalRepresentativeReservationSchema.parse({ ...representative, identityId: 'other-external' }).identityId },
      { ...representative, requestId: worldRequestIdSchema.parse('foreign-case') },
      { ...representative, request: { ...representative.request, member: { ...representative.request.member, model: 'foreign/model' } } }]) {
      snapshot.mockReturnValue({ ...external, world: { ...external.world, external: { ...external.world.external,
        representatives: row === undefined ? {} : { [representative.id]: row } } } })
      expect(() => { assertExternalRepresentativeCleanup(h.run, representative, () => {}) }).toThrow(/cancelled representative/)
    }
    const maintenance = external.maintenance![h.input.maintenance.id]!
    if (maintenance.status !== 'quiescent') throw new Error('Cleanup fixture requires original quiescent maintenance')
    for (const changed of [
      { request: maintenance.request, startedSequence: maintenance.startedSequence, status: 'draining' as const },
      { ...maintenance, status: 'completed' as const, finishedSequence: maintenance.quiescentSequence + 1 },
    ]) {
      snapshot.mockReturnValue({ ...external, maintenance: { [h.input.maintenance.id]: changed } })
      expect(() => { assertExternalRepresentativeCleanup(h.run, representative, () => {}) }).toThrow(/quiescent maintenance/)
    }
    snapshot.mockReturnValue({ ...external, phase: 'running' })
    expect(() => { assertExternalRepresentativeCleanup(h.run, representative, () => {}) }).toThrow(/quiescent maintenance/)
    snapshot.mockReturnValue(original)
    expect(() => { assertExternalRepresentativeCleanup(h.run, representative, () => {}) }).toThrow(/cancelled representative/)
    const settleHire = vi.spyOn(h.run, 'settleWorldHireCancellation')
    const settleRepresentative = vi.spyOn(h.run, 'settleExternalRepresentativeCancellation')
    try {
      for (const retainedMaintenance of [{}, { [maintenance.request.id]: {
        request: maintenance.request, startedSequence: maintenance.startedSequence, status: 'draining' as const } }]) {
        snapshot.mockReturnValue({ ...external, maintenance: retainedMaintenance })
        expect(await h.connection.cancelWorldCase(command)).toEqual(pending)
      }
      const requesterChannel = representative.identities.channels[1]
      const contact = { id: representative.id, identityId: representative.identityId, representativeIntentId: representative.id,
        generation: 1 as const, requestId: representative.requestId, planId: representative.request.planId,
        requesterEntityId: requester, channel: { key: requesterChannel.key, channelId: requesterChannel.channelId },
        status: 'cancel-requested' as const, sequence: representative.sequence, updatedSequence: original.revision,
        cancellation: { maintenance: maintenance.request, sequence: original.revision } }
      snapshot.mockReturnValue({ ...external, maintenance: {}, world: { ...external.world, external: { ...external.world.external,
        representatives: {}, contacts: { [contact.id]: contact } } } })
      expect(await h.connection.cancelWorldCase(command)).toEqual(pending)
      expect(settleHire).not.toHaveBeenCalled()
      expect(settleRepresentative).not.toHaveBeenCalled()
    } finally { settleHire.mockRestore(); settleRepresentative.mockRestore() }
  } finally { snapshot.mockRestore() }
  expect(h.run.snapshot()).toEqual(original)
  expect((await h.connection.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'owner-book-cancellation', requestId: h.request.id }))).status)
    .toBe('cancelled')
})

it.each(['json', 'sqlite'] as const)('verifies %s retained external cleanup history against the same exact durable owners', async (backend) => {
  const h = await hireFixture(backend)
  const reservation = await h.run.reserveWorldHire(h.input)
  await h.connection.quiesceForMaintenance(h.input.maintenance, 4, 3)
  await h.run.prepareWorldHire(reservation.id)
  const { modelVersion: _modelVersion, ...member } = reservation.request.member
  await h.connection.ensureParticipant(reservation.identities.entityId, member)
  for (const channel of reservation.identities.channels) {
    await h.connection.ensureChannel(simulationChannelSpecSchema.parse({ key: channel.key,
      members: [{ entityId: reservation.identities.entityId, role: 'member' },
        { entityId: channel.purpose === 'director' ? director : requester, role: channel.purpose }], limits: {} }))
  }
  await h.connection.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'history-book-cancellation', requestId: h.request.id }))
  const original = h.run.snapshot(), hire = original.world!.reservations[reservation.id]!
  const { approvals: _hireApprovals, ...identity } = hire
  const representative = simulationExternalRepresentativeReservationSchema.parse({ ...identity, identityId: 'original-external', generation: 1 })
  const external = { ...original, world: { ...original.world!, reservations: {}, external: {
    ...original.world!.external, representatives: { [representative.id]: representative } } } }
  const team = await h.ctx.teams.getTeam({ teamId: representative.identities.binding.teamId })
  await expect(validateWorldCleanupHistory(h.ctx, external, team, () => {})).resolves.toBeUndefined()
  const read = h.ctx.teams.getChannelAdmission.bind(h.ctx.teams)
  const source = vi.spyOn(h.ctx.teams, 'getChannelAdmission').mockImplementation(async (input) => {
    if (input.channelId === representative.identities.channels[0].channelId) throw new Error('Original external channel storage unavailable')
    return await read(input)
  })
  try { await expect(validateWorldCleanupHistory(h.ctx, external, team, () => {})).rejects.toThrow(/storage unavailable/) }
  finally { source.mockRestore() }
  const persistence = vi.spyOn(h.ctx.sessionPersistence, 'isUnmaterialized').mockResolvedValueOnce(false)
  try { await expect(validateWorldCleanupHistory(h.ctx, external, team, () => {})).rejects.toThrow(/member or Session evidence/) }
  finally { persistence.mockRestore() }
  expect(h.run.snapshot()).toEqual(original)
})

it.each(['json', 'sqlite'].flatMap(backend => [false, true].map(unknown => ({ backend, unknown }))))(
  'retains $backend Activation history and unknown=$unknown cleanup without another startup', async ({ backend, unknown }) => {
    const h = await fixture(backend as 'json' | 'sqlite', { teamLimits: { maxActivations: 1 } })
    const provider = h.ctx.agentRuntimes.getProvider('in-process')
    if (provider === undefined) throw new Error('Real local provider is missing')
    const activate = provider.activate.bind(provider)
    let starts = 0
    const intercept = vi.spyOn(provider, 'activate').mockImplementation(async (request) => {
      const raw = await activate(request)
      starts++
      if (unknown) vi.spyOn(raw, 'dispose').mockRejectedValueOnce(new AgentRuntimeTerminationUnconfirmedError('Raw stop is unconfirmed'))
      return raw
    })
    const request = { provider: 'in-process', seed: { kind: 'fresh' as const },
      agent: { options: { provider: 'requester-model', model: 'scripted' } }, signal: new AbortController().signal }
    let failure: unknown
    try { await h.connection.activate(director, request) }
    catch (error) { failure = error }
    expect(activationHistoryLimitDetails(failure)?.cleanup).toBe(unknown ? 'unconfirmed' : 'confirmed')
    const state = h.run.snapshot(), block = state.activationAdmissionBlocks?.[0]
    expect(block).toMatchObject({ entityId: director, details: { used: 1, limit: 1, cleanup: unknown ? 'unconfirmed' : 'confirmed' } })
    expect(state.entities[director]?.writer?.phase).toBe(unknown ? 'revoked' : 'released')
    expect(state.phase).toBe('paused')
    expect(starts).toBe(1)
    if (block === undefined) throw new Error('Original Native refusal is missing')
    expect(await h.run.recordActivationAdmissionBlock({ entityId: director, details: block.details })).toEqual(block)
    expect(h.run.snapshot().revision).toBe(state.revision)
    await expect(h.run.recordActivationAdmissionBlock({ entityId: director,
      details: { ...block.details, used: block.details.used + 1 } })).rejects.toThrow(/changed on retry/)
    expect(() => h.run.recordActivationAdmissionBlock({ entityId: director,
      details: { ...block.details, cleanup: 'pending' } })).toThrow()
    expect(() => h.run.recordActivationAdmissionBlock({ entityId: director,
      details: { ...block.details, extra: true } } as Parameters<typeof h.run.recordActivationAdmissionBlock>[0])).toThrow()
    await expect(h.connection.activate(director, request)).rejects.toThrow(/Activation history/)
    expect(starts).toBe(1)
    expect(h.run.snapshot().revision).toBe(state.revision)
    await expect(h.run.setPhase('running', state.revision)).rejects.toThrow(/new scenario/)
    expect(h.run.snapshot().revision).toBe(state.revision)
    intercept.mockRestore()
  })

interface WorldFixtureOptions {
  candidateOnly?: boolean
  spec?: Record<string, unknown>
  limits?: Record<string, unknown>
  teamLimits?: Partial<TeamLimits>
  occupied?: boolean
  positionCapacity?: number
}

async function fixture(backend: 'json' | 'sqlite', overrides: WorldFixtureOptions = {}) {
  const scratch = join(process.cwd(), '.local/world-director-mvp')
  await mkdir(scratch, { recursive: true })
  const root = await mkdtemp(join(scratch, 'world-agent-'))
  const { ctx } = await createContext(root, backend)
  await ctx.plugin(SimulationWorldExecutions)
  await ctx.plugin(Direct)
  await ctx.plugin(Tools)
  const run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
    runId: 'world-company', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
    outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 32, maxMicrostepsPerTime: 32,
    phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536,
    maxEntities: 16, maxResidentActors: 2, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100',
    maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100, maxPendingEvents: 100, maxPendingInteractions: 100,
    maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 100, maxDispatchWaitRounds: 8,
    maxDecisionsPerWindow: 2, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '10000',
    relationRules: [
      { relation: 'can-hire', subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: true },
      { relation: 'assignment', subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: true },
    ],
    ...overrides.spec,
  } }))
  cleanups.push(async () => { await run.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Staff one company position', budgets: {} },
    budgets: {}, limits: { ...ctx.teams.getCreationLimits(), ...overrides.teamLimits } },
  'simulation/world-company')
  const teamId = team.team.id
  const connection = await ctx.simulationTeams.attach(run, teamId, 'simulation/world-company')
  for (const [id, entityKind, cognition] of [
    [requester, 'person', 'agent'], [director, 'person', 'agent'], ['organization', 'organization', 'none'], ['position', 'position', 'none'], ['requester-role', 'position', 'none'],
  ]) {
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind, cognition, readiness: 'ready', profile: {} }),
      run.snapshot().revision)
  }
  for (const id of [requester, director]) {
    const state = await ctx.teams.getTeam({ teamId })
    const participant = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: state.team.cursor,
      kind: 'local-agent', displayName: id, role: id, capabilities: [] })
    for (const phase of ['provisioning', 'active'] as const) {
      const current = await ctx.teams.getTeam({ teamId })
      await transitionBootstrapParticipant(ctx, { teamId, participantId: participant.id, expectedCursor: current.team.cursor, phase })
    }
    await connection.bind(id, participant.id)
  }
  const channel = await connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'hiring-private',
    members: [{ entityId: requester, role: 'requester' }, { entityId: director, role: 'director' }], limits: {} }))
  await run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'hiring-authority', subject: requester,
    relation: 'can-hire', object: 'position', scope: 'organization', validFrom: '0', validUntil: null }), run.snapshot().revision)
  await run.configureWorld(simulationWorldDefinitionSchema.parse({ positionRolePermissions: [], operations: [WORLD_GENERATE_AND_HIRE_PIN], operationGrants: ([{ requesterEntityId: requester, positionEntityId: 'position', relationId: 'hiring-authority' }]).map(value => ({ requesterEntityId: value.requesterEntityId, domain: WORLD_GENERATE_AND_HIRE_PIN.domain, operation: WORLD_GENERATE_AND_HIRE_PIN.operation, version: WORLD_GENERATE_AND_HIRE_PIN.version, scopeEntityId: 'organization', targetEntityId: value.positionEntityId, relationId: value.relationId, relation: 'can-hire' })),  directorEntityId: director, organizationEntityId: 'organization',
    positions: [{ entityId: 'position', capacity: overrides.positionCapacity ?? 1 }],
    authorizations: [{ requesterEntityId: requester, positionEntityId: 'position', relationId: 'hiring-authority' }],
    templates: [{ id: 'researcher', version: '1', names: ['Lin'], skills: ['analysis'], traits: ['patient'], goals: ['research'],
      description: 'A research colleague.' }], policyVersion: '1',
    limits: { maxRequests: 10,
      maxBirthsPerInterval: 10, maxExternalExpansionsPerInterval: 10, maxPendingMutations: 1,
      maxRequestsPerActorPerInterval: 10,
      maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 4096, maxBytesPerPlan: 4096, ...overrides.limits },
  }), run.snapshot().revision)
  if (overrides.occupied === true) {
    await run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'existing-assignment', subject: requester,
      relation: 'assignment', object: 'position', scope: 'organization', validFrom: '0', validUntil: null }), run.snapshot().revision)
  }
  await run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'requester-employment', subject: requester,
    relation: 'assignment', object: 'requester-role', scope: 'organization', validFrom: '0', validUntil: null }), run.snapshot().revision)
  const intent = overrides.candidateOnly
    ? createWorldIntent(run.snapshot(), simulationEntityIdSchema.parse(requester), { kind: 'world/request', domain: 'organization',
      operation: 'generate-and-hire', version: '1', businessKey: 'research-application', expectedTime: null, evidence: [],
      payload: { organizationEntityId: 'organization', positionEntityId: 'position', description: 'We need a research colleague.' } },
    WORLD_GENERATE_AND_HIRE_PIN, run.snapshot().revision + 1, projectionRuntime)
    : await seedHiringIntent(run, simulationHireIntentRequestSchema.parse({ organizationEntityId: 'organization',
      positionEntityId: 'position', requesterEntityId: requester, applicationId: 'research-application' }), 'We need a research colleague.')
  const requestAction = { kind: 'world/request', domain: 'organization', operation: 'generate-and-hire', version: '1',
    businessKey: hiringIntentFields(intent).applicationId, expectedTime: null, evidence: [], payload: {
      organizationEntityId: hiringIntentFields(intent).organizationEntityId, positionEntityId: hiringIntentFields(intent).positionEntityId,
      description: 'We need a research colleague.',
    } }
  const calls = (prefix: string, action: () => object) => [
    toolCallResponse(`${prefix}-observe`, 'simulation_observe', {}),
    () => toolCallResponse(`${prefix}-stage`, 'simulation_stage', { proposals: [{ after: [], action: action() }] }),
    toolCallResponse(`${prefix}-submit`, 'simulation_submit', {}),
  ]
  const requestModel = new MockAdapter([...calls('request', () => requestAction), ...calls('retry', () => requestAction)])
  ctx.llm.registerAdapter(['requester-model'], requestModel)
  let requesterWriter: SimulationWriterLease | undefined
  const reserve = run.reserveWriter.bind(run)
  vi.spyOn(run, 'reserveWriter').mockImplementation(async (...args) => {
    const writer = await reserve(...args)
    if (args[0] === requester && requesterWriter === undefined) requesterWriter = writer
    return writer
  })
  const requesterLease = await connection.activate(requester, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: { provider: 'requester-model', model: 'scripted' } }, signal: new AbortController().signal })
  return { ctx, run, connection, intent, channel, requestModel, requesterLease, requesterWriter: requesterWriter!, calls, requestAction }
}

async function publishedCaseFixture(backend: 'json' | 'sqlite', resolution?: SimulationWorldResolveOperation['resolution'],
  overrides?: WorldFixtureOptions) {
  const h = await fixture(backend, overrides)
  const script = resolution === undefined ? [] : h.calls('result-director', () => ({ kind: 'world/resolve',
    requestId: Object.values(h.run.snapshot().world!.requests)[0]!.id, supersedes: null, resolution }))
  const model = new MockAdapter(script)
  h.ctx.llm.registerAdapter(['result-director'], model)
  await h.connection.activate(director, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: { provider: 'result-director', model: 'scripted' } }, signal: new AbortController().signal })
  await h.run.setPhase('running', h.run.snapshot().revision)
  await h.connection.executeDecision(requester, simulationDecisionIdSchema.parse('request'),
    { ...contextRequest(), world: { kind: 'request', intentId: h.intent.id } })
  const request = Object.values(h.run.snapshot().world!.requests)[0]!
  await h.run.drive({ until: simTimeSchema.parse('0') })
  assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
  await h.connection.dispatchOperation(request.notificationOperationId, () => 100)
  return { ...h, request, model, script,
    context: { ...contextRequest(), world: { kind: 'resolve' as const, requestId: request.id } } }
}

async function caseFixture(backend: 'json' | 'sqlite', resolution?: SimulationWorldResolveOperation['resolution'],
  overrides?: WorldFixtureOptions) {
  const h = await publishedCaseFixture(backend, resolution, overrides)
  assert.ok(h.request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
  const wake = await h.connection.receiveOperation(h.request.notificationOperationId)
  await h.run.drive({ until: simTimeSchema.parse('0') })
  return { ...h, wake }
}

const rejectedResolution = { kind: 'reject' as const, reason: 'insufficient-information' as const, rationale: 'Private explanation must not become a public wake.' }

it.each(['json', 'sqlite'] as const)('lets a %s director correct a stale request ID before submission', async (backend) => {
  const h = await caseFixture(backend, rejectedResolution)
  h.script.splice(1, 0, toolCallResponse('wrong-request-stage', 'simulation_stage', {
    proposals: [{ after: [], action: { kind: 'world/resolve', requestId: 'not-the-current-request',
      supersedes: null, resolution: rejectedResolution } }],
  }))
  const decision = await h.connection.executeDecision(director, simulationDecisionIdSchema.parse('corrected-request'),
    h.context, h.wake)
  expect(decision.status).toBe('accepted')
  expect(decision.worldSubmissionBlock).toBeUndefined()
  expect(h.run.snapshot().phase).toBe('running')
  expect(Object.values(h.run.snapshot().world!.plans)).toHaveLength(1)
  expect(Object.values(h.run.snapshot().world!.plans)[0]).toMatchObject({ requestId: h.request.id, status: 'accepted' })
  expect(JSON.stringify(h.model.requests)).toContain(`Use the current requestId ${h.request.id}`)
})

it.each(['json', 'sqlite'] as const)('derives a new %s goal case and preserves its actual writer source and implementation pin', async (backend) => {
  const h = await fixture(backend, { occupied: true, positionCapacity: 2 })
  h.requestAction.businessKey = 'unplanned-staffing-goal'
  const before = Object.keys(h.run.snapshot().world!.intents)
  await h.run.setPhase('running', h.run.snapshot().revision)
  const decision = await h.connection.executeDecision(requester, simulationDecisionIdSchema.parse('ordinary-goal'),
    { ...contextRequest(), world: { kind: 'goal' } })
  expect(decision.status).toBe('accepted')
  const state = h.run.snapshot(), request = Object.values(state.world!.requests)[0]!
  expect(Object.keys(state.world!.intents)).toHaveLength(before.length + 1)
  expect(hiringIntentFields(state.world!.intents[request.intentId]).applicationId).toBe('unplanned-staffing-goal')
  expect(request.source).toEqual({ kind: 'decision', decisionId: decision.id, epoch: decision.epoch,
    binding: state.entities[requester]!.binding })
  expect(request.requesterEntityId).toBe(requester)
  expect(state.operations[worldRolePlanOperationId(request)]?.worldPin).toEqual(request.pin)
  assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
  expect(state.operations[request.notificationOperationId]?.dependencies).toEqual([request.operationId])
  assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
  expect(state.operations[request.notificationOperationId]?.worldPin).toBeUndefined()
})

it.each(['json', 'sqlite'] as const)('rejects an unassigned %s goal before preparing model context', async (backend) => {
  const h = await fixture(backend)
  const assigned = h.run.snapshot().relations['requester-employment' as import('@clocky/clocky-simulation').SimulationRelationId]!
  const { revision, ...fields } = assigned
  await h.run.change(simulationChangeSchema.parse({ ...fields, kind: 'relation/update', relation: 'can-hire', relationRevision: revision }),
    h.run.snapshot().revision)
  await h.run.setPhase('running', h.run.snapshot().revision)
  await expect(h.connection.executeDecision(requester, simulationDecisionIdSchema.parse('unassigned-goal'),
    { ...contextRequest(), world: { kind: 'goal' } })).rejects.toThrow(/current employment/)
  expect(h.run.snapshot().world!.requests).toEqual({})
  expect(h.requestModel.requests).toEqual([])
})

it.each((['json', 'sqlite'] as const).flatMap(backend => [
  { domain: 'uninstalled' }, { operation: 'uninstalled' }, { version: 'uninstalled' },
  { requesterEntityId: 'director' }, { sessionId: 'forged' }, { director: true }, { proof: { actorId: 'director' } },
  { payload: { organizationEntityId: 'foreign-organization', positionEntityId: 'position', description: 'Need help' } },
  { payload: { organizationEntityId: 'organization', positionEntityId: 'position', description: 'Need help', requesterEntityId: 'director' } },
  { payload: { organizationEntityId: 'organization', positionEntityId: 'position', description: 'Need help', sessionId: 'forged' } },
].map(change => ({ backend, change }))))(
  'rejects $backend unknown or self-authored goal request authority before creating a case: $change', async ({ backend, change }) => {
    const h = await fixture(backend, { occupied: true, positionCapacity: 2 })
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'foreign-organization', entityKind: 'organization',
      cognition: 'none', readiness: 'ready', profile: {} }), h.run.snapshot().revision)
    Object.assign(h.requestAction, change, { businessKey: 'rejected-goal' })
    const original = h.run.snapshot().world!.intents
    await h.run.setPhase('running', h.run.snapshot().revision)
    await expect(h.connection.executeDecision(requester, simulationDecisionIdSchema.parse('rejected-goal'),
      { ...contextRequest(), world: { kind: 'goal' } })).rejects.toThrow()
    expect(h.run.snapshot().world!.requests).toEqual({})
    expect(h.run.snapshot().world!.intents).toEqual(original)
    expect(h.run.snapshot().operations).toEqual({})
  })

it.each((['json', 'sqlite'] as const).flatMap(backend =>
  (['wrong-operation', 'wrong-recipient'] as const).map(alteration => ({ backend, alteration }))))(
  'refuses a $backend $alteration world publication at the real Hub proof boundary', async ({ backend, alteration }) => {
    const h = await fixture(backend)
    await h.connection.activate(director, { provider: 'in-process', seed: { kind: 'fresh' },
      agent: { options: {} }, signal: new AbortController().signal })
    await h.run.setPhase('running', h.run.snapshot().revision)
    await h.connection.executeDecision(requester, simulationDecisionIdSchema.parse('request'),
      { ...contextRequest(), world: { kind: 'request', intentId: h.intent.id } })
    const request = Object.values(h.run.snapshot().world!.requests)[0]!
    await h.run.drive({ until: simTimeSchema.parse('0') })
    const post = h.ctx.teams.postChannelEnvelope.bind(h.ctx.teams)
    const altered = vi.spyOn(h.ctx.teams, 'postChannelEnvelope').mockImplementation(async input => await post({ ...input,
      draft: { ...input.draft, ...alteration === 'wrong-operation' ? { correlationId: 'foreign-operation' }
        : { audience: [h.run.snapshot().entities[requester]!.binding!.participantId] } } }))
    assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
    try { await h.connection.dispatchOperation(request.notificationOperationId, () => 100) }
    finally { altered.mockRestore() }
    assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
    const operation = h.run.snapshot().operations[request.notificationOperationId]!
    expect(operation.outbox?.receipt).toBeUndefined()
    expect(operation.delivery).toBeUndefined()
    expect(operation.result?.status).not.toBe('applied')
    const channel = await h.ctx.teams.readChannel({ channelId: h.channel.manifest.id, afterCursor: -1 })
    expect(channel.records.filter(value => value.type === 'channel/envelope')).toEqual([])
    expect(h.run.snapshot().world!.plans).toEqual({})
    expect(h.requestModel.requests).toHaveLength(3)
  })

it.each((['json', 'sqlite'] as const).flatMap(backend =>
  (['copied-request', 'wrong-hash', 'wrong-envelope', 'wrong-sender', 'wrong-sequence',
    'wrong-channel', 'wrong-trace', 'wrong-correlation', 'wrong-audience', 'wrong-kind'] as const).map(alteration => ({ backend, alteration }))))(
  'refuses $backend $alteration private request input and requires the exact persisted original before planning', async ({ backend, alteration }) => {
    const h = await publishedCaseFixture(backend, rejectedResolution)
    assert.ok(h.request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
    const original = h.run.snapshot().operations[h.request.notificationOperationId]!
    expect(original.outbox?.receipt).toBeDefined()
    expect(original.delivery).toBeUndefined()
    const before = simulationDecisionIdSchema.parse('before-durable-input')
    await expect(h.connection.executeDecision(director, before, h.context)).rejects.toThrow(/wait for its due publication result/)
    expect(h.run.snapshot().decisions[before]).toBeUndefined()
    const pending = h.ctx.teams.listChannelPendingDeliveries.bind(h.ctx.teams)
    const corrupted = vi.spyOn(h.ctx.teams, 'listChannelPendingDeliveries').mockImplementation(async (input) => {
      const page = await pending(input)
      return { ...page, deliveries: page.deliveries.map((value) => {
        const envelope = value.envelope
        if (alteration === 'wrong-envelope') return { ...value, envelope: { ...envelope,
          id: 'other-envelope' as typeof envelope.id } }
        if (alteration === 'wrong-sender') return { ...value, envelope: { ...envelope,
          senderId: h.run.snapshot().entities[director]!.binding!.participantId } }
        if (alteration === 'wrong-sequence') return { ...value, envelope: { ...envelope, sequence: envelope.sequence + 1 } }
        if (alteration === 'wrong-channel') return { ...value, envelope: { ...envelope, channelId: 'foreign-channel' as typeof envelope.channelId } }
        if (alteration === 'wrong-trace') return { ...value, envelope: { ...envelope, traceId: 'foreign-fingerprint' } }
        if (alteration === 'wrong-correlation') return { ...value, envelope: { ...envelope, correlationId: 'foreign-operation' } }
        if (alteration === 'wrong-audience') return { ...value, envelope: { ...envelope, audience: [envelope.senderId] } }
        if (alteration === 'wrong-kind') return { ...value, envelope: { ...envelope, kind: 'foreign-kind' } }

        return { ...value, envelope: { ...envelope, payload: { content: [{ type: 'text' as const,
          text: JSON.stringify(alteration === 'copied-request' ? { requestId: h.request.id }
            : { requestId: h.request.id, hash: 'wrong' }) }] } } }
      }) }
    })
    assert.ok(h.request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
    await expect(h.connection.receiveOperation(h.request.notificationOperationId)).rejects.toThrow(/Envelope|content|position/)
    corrupted.mockRestore()
    assert.ok(h.request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
    expect(h.run.snapshot().operations[h.request.notificationOperationId]?.delivery).toBeUndefined()
    const after = simulationDecisionIdSchema.parse('after-refused-input')
    await expect(h.connection.executeDecision(director, after, h.context)).rejects.toThrow(/wait for its due publication result/)
    expect(h.run.snapshot().decisions[after]).toBeUndefined()
    expect(h.run.snapshot().world!.plans).toEqual({})
    expect(h.model.requests).toHaveLength(0)
    assert.ok(h.request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
    const wake = await h.connection.receiveOperation(h.request.notificationOperationId)
    assert.ok(h.request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
    expect(await h.connection.receiveOperation(h.request.notificationOperationId)).toBe(wake)
    await h.run.drive({ until: simTimeSchema.parse('0') })
    await h.connection.executeDecision(director, simulationDecisionIdSchema.parse('exact-persisted-input'), h.context, wake)
    expect(Object.values(h.run.snapshot().world!.plans)).toHaveLength(1)
    expect(Object.values(h.run.snapshot().world!.requests)).toHaveLength(1)
    expect(h.model.requests).toHaveLength(3)
  })

async function hireFixture(backend: 'json' | 'sqlite', overrides?: WorldFixtureOptions) {
  const h = await caseFixture(backend, { kind: 'apply', payload: { templateId: 'researcher', templateVersion: '1', persona }, rationale: 'Private director assessment must not be published.' }, overrides)
  const decision = await h.connection.executeDecision(director,
    simulationDecisionIdSchema.parse('hire-plan'), h.context, h.wake)
  const plan = Object.values(h.run.snapshot().world!.plans)[0]!
  const { simulationWorldHireReserveRequestSchema } = await import('@clocky/clocky-simulation')
  const input = simulationWorldHireReserveRequestSchema.parse({ planId: plan.id, maintenance: { id: 'hire-owner', owner: 'world-owner' },
    member: { displayName: persona.name, role: 'member', capabilities: [], provider: 'in-process', preset: 'simulation',
      model: 'requester-model/scripted', modelVersion: 'scripted-1' } })
  return { ...h, plan, decision, input }
}

it.each((['json', 'sqlite'] as const).flatMap(backend => [
  { backend, resource: 'occupied position', overrides: { occupied: true } },
  { backend, resource: 'Entity', overrides: { spec: { maxEntities: 5 } } },
  { backend, resource: 'historical Participant', overrides: { teamLimits: { maxParticipants: 2 } } },
  { backend, resource: 'historical Channel', overrides: { teamLimits: { maxChannels: 1 } } },
]))('denies $backend hire exceeding $resource capacity before preparation or retained allocation', async ({ backend, overrides }) => {
  const h = await hireFixture(backend, overrides)
  const before = h.run.snapshot()
  await expect(h.run.reserveWorldHire(h.input)).rejects.toMatchObject({ code: 'SIM_WORLD_LIMIT' })
  expect(h.run.snapshot()).toEqual(before)
  expect(h.run.snapshot().world!.reservations).toEqual({})
  expect(h.run.snapshot().world!.plans[h.plan.id]).toEqual(h.plan)
  expect(h.model.requests).toHaveLength(3)
})

async function preparedHireFixture(backend: 'json' | 'sqlite', overrides?: WorldFixtureOptions) {
  const h = await hireFixture(backend, overrides)
  const reservation = await h.run.reserveWorldHire(h.input)
  await h.connection.quiesceForMaintenance(h.input.maintenance, 4, 3)
  await h.run.prepareWorldHire(reservation.id)
  const { modelVersion: _version, ...member } = reservation.request.member
  await h.connection.ensureParticipant(reservation.identities.entityId, member)
  for (const channel of reservation.identities.channels) {
    await h.connection.ensureChannel(simulationChannelSpecSchema.parse({ key: channel.key,
      members: [{ entityId: reservation.identities.entityId, role: 'member' },
        { entityId: channel.purpose === 'director' ? director : requester, role: channel.purpose }], limits: {} }))
  }
  return { ...h, reservation }
}

it.each(['json', 'sqlite'] as const)('refuses post-commit Persona replacement before durable append on %s', async (backend) => {
  const h = await preparedHireFixture(backend)
  await h.run.commitWorldHire(h.reservation.id)
  const before = h.run.snapshot(), entity = before.entities[h.reservation.identities.entityId]!
  await expect(h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: entity.id,
    entityRevision: entity.revision, profile: { ...entity.profile, name: 'Replacement Persona' } }), before.revision))
    .rejects.toMatchObject({ code: 'SIM_WORLD_INTEGRITY' })
  expect(h.run.snapshot()).toEqual(before)
})

async function changeHireAuthorization(h: Awaited<ReturnType<typeof hireFixture>>, unavailable = false) {
  const grant = Object.values(h.run.snapshot().relations).find(value => value.relation === 'can-hire')!
  const { revision, ...fields } = grant
  await h.run.change(simulationChangeSchema.parse({ kind: 'relation/update', ...fields,
    relationRevision: revision, validFrom: unavailable ? '1' : fields.validFrom, validUntil: '100' }), h.run.snapshot().revision)
}

it.each(['json', 'sqlite'] as const)('rechecks %s original channels before committing and records employment at the current safe boundary', async (backend) => {
  const h = await hireFixture(backend)
  await h.run.drive({ until: simTimeSchema.parse('7') })
  expect(h.run.snapshot().time).toBe('7')
  const reservation = await h.run.reserveWorldHire(h.input)
  await h.connection.quiesceForMaintenance(h.input.maintenance, 4, 3)
  await h.run.prepareWorldHire(reservation.id)
  const { modelVersion: _version, ...member } = reservation.request.member
  await h.connection.ensureParticipant(reservation.identities.entityId, member)
  const channels = reservation.identities.channels.map(channel => simulationChannelSpecSchema.parse({ key: channel.key,
    members: [{ entityId: reservation.identities.entityId, role: 'member' },
      { entityId: channel.purpose === 'director' ? director : requester, role: channel.purpose }], limits: {} }))
  await h.connection.ensureChannel(channels[0]!)
  const before = h.run.snapshot()
  await expect(h.run.commitWorldHire(reservation.id)).rejects.toThrow(/confirmed channels/)
  expect(h.run.snapshot()).toEqual(before)
  await expect(h.connection.ensureChannel({ ...channels[1]!, members: channels[0]!.members }))
    .rejects.toThrow(/retry changed its membership or limits/)
  expect(h.run.snapshot()).toEqual(before)
  await h.connection.ensureChannel(channels[1]!)
  const result = await h.run.commitWorldHire(reservation.id)
  expect(result.outcome.kind).toBe('committed')
  expect(result.time).toBe('7')
  expect(h.run.snapshot().relations[reservation.identities.relationId]?.validFrom).toBe('7')
})

it.each(['json', 'sqlite'] as const)('retains a %s preparation when an assignment changes the position capacity reads before commit', async (backend) => {
  const h = await preparedHireFixture(backend, { positionCapacity: 2 })
  await h.run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'later-position-assignment', subject: requester,
    relation: 'assignment', object: 'position', scope: 'organization', validFrom: '0', validUntil: null }), h.run.snapshot().revision)
  const before = h.run.snapshot()
  await expect(h.run.commitWorldHire(h.reservation.id)).rejects.toThrow(/plan is stale/)
  expect(h.run.snapshot().world!.plans[h.plan.id]?.stale?.reason).toBe('read-set-changed')
  expect(h.run.snapshot().world!.reservations).toEqual(before.world!.reservations)
  expect(h.run.snapshot().world!.results).toEqual({})
  expect(h.run.snapshot().relations[h.reservation.identities.relationId]).toBeUndefined()
})

it.each((['json', 'sqlite'] as const).flatMap(backend => [
  { backend, reason: 'read-set-changed', unavailable: false },
  { backend, reason: 'authority-unavailable', unavailable: true },
]))('retains a $backend execution-stale plan for $reason before reservation without allocating identities', async ({ backend, reason, unavailable }) => {
  const h = await hireFixture(backend)
  await changeHireAuthorization(h, unavailable)
  await expect(h.run.reserveWorldHire(h.input)).rejects.toThrow(/plan is stale/)
  const retained = h.run.snapshot().world!.plans[h.plan.id]!
  expect(retained).toEqual({ ...h.plan, status: 'stale', stale: { phase: 'execution', reason,
    sequence: h.run.snapshot().revision } })
  expect(h.run.snapshot().world!.reservations).toEqual({})
  const revision = h.run.snapshot().revision
  await expect(h.run.reserveWorldHire(h.input)).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  await expect(h.run.reserveWorldHire(h.input)).rejects.toThrow(/latest accepted apply plan/)
  expect(h.run.snapshot().revision).toBe(revision)
  const { spec } = h.run.snapshot()
  await h.run.close()
  const reopened = await h.ctx.simulations.open({ provider: 'local', mode: 'open', spec })
  cleanups.push(() => reopened.close())
  expect(reopened.snapshot().world!.plans[h.plan.id]).toEqual(retained)
  expect(h.model.requests).toHaveLength(3)
})

it.each(['json', 'sqlite'] as const)('retains %s preparing responsibility when execution reads change before commit', async (backend) => {
  const h = await preparedHireFixture(backend)
  await changeHireAuthorization(h)
  const before = h.run.snapshot()
  await expect(h.run.commitWorldHire(h.reservation.id)).rejects.toThrow(/plan is stale/)
  expect(h.run.snapshot().world!.plans[h.plan.id]).toMatchObject({ ...h.plan, status: 'stale',
    stale: { phase: 'execution', reason: 'read-set-changed' } })
  expect(h.run.snapshot().world!.reservations).toEqual(before.world!.reservations)
  expect(h.run.snapshot().world!.results).toEqual({})
  expect(h.run.snapshot().relations[h.reservation.identities.relationId]).toBeUndefined()
  expect(h.run.snapshot().entities[h.reservation.identities.entityId]?.readiness).toBe('preparing')
  await expect(h.run.finishMaintenance(h.input.maintenance)).rejects.toThrow(/unresolved preparation/)
  await expect(h.run.commitWorldHire(h.reservation.id)).rejects.toThrow(/latest accepted apply plan/)
  const { modelVersion: _version, ...member } = h.reservation.request.member
  await expect(async () => await h.connection.ensureParticipant(h.reservation.identities.entityId, member))
    .rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  for (const channel of h.reservation.identities.channels) {
    await expect(h.connection.acknowledgeInvitation(channel.purpose === 'director' ? director : requester, channel.channelId))
      .rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  }
})

it('keeps an accepted plan when execution invalidation append fails and retries the same cause', async () => {
  const h = await hireFixture('json')
  await changeHireAuthorization(h)
  const before = h.run.snapshot()
  const stream = Reflect.get(h.run, 'stream') as import('@clocky/clocky-storage').LogStream
  const append = vi.spyOn(stream, 'append').mockRejectedValueOnce(new Error('Stale marker append refused'))
  await expect(h.run.reserveWorldHire(h.input)).rejects.toThrow('Stale marker append refused')
  expect(h.run.snapshot()).toEqual(before)
  append.mockRestore()
  await expect(h.run.reserveWorldHire(h.input)).rejects.toThrow(/plan is stale/)
  expect(h.run.snapshot().world!.plans[h.plan.id]?.stale?.reason).toBe('read-set-changed')
})

it('does not invalidate an accepted hire for unrelated later wake revisions', async () => {
  const h = await hireFixture('sqlite')
  const { simulationWakeRequestSchema } = await import('@clocky/clocky-simulation')
  await h.run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'unrelated-execution', entityId: requester,
    time: '10', reason: 'Other work' }), h.run.snapshot().revision)
  const reservation = await h.run.reserveWorldHire(h.input)
  expect(reservation.status).toBe('reserved')
  expect(h.run.snapshot().world!.plans[h.plan.id]).toEqual(h.plan)
})

it.each(['json', 'sqlite'] as const)('retains %s stale predecessors and bounds explicit model replanning without a new business case', async (backend) => {
  const h = await hireFixture(backend)
  const originals = [h.plan]
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const grant = Object.values(h.run.snapshot().relations).find(value => value.relation === 'can-hire')!
    const { revision, ...fields } = grant
    await h.run.change(simulationChangeSchema.parse({ kind: 'relation/update', ...fields,
      relationRevision: revision, validUntil: String(100 + attempt) }), h.run.snapshot().revision)
    const latest = originals.at(-1)!
    await expect(h.run.reserveWorldHire({ ...h.input, planId: latest.id })).rejects.toThrow(/plan is stale/)
    expect(h.run.snapshot().world!.plans[latest.id]).toMatchObject({ ...latest, status: 'stale' })
    h.script.push(...h.calls(`replan-${attempt}`, () => ({ kind: 'world/resolve', requestId: h.request.id,
      supersedes: latest.id, resolution: latest.proposal.resolution })))
    const action = h.connection.executeDecision(director, simulationDecisionIdSchema.parse(`explicit-replan-${attempt}`), h.context)
    if (attempt === 3) {
      await expect(action).rejects.toThrow(/planning attempt limit/)
    } else {
      await action
      const plan = Object.values(h.run.snapshot().world!.plans).at(-1)!
      expect(plan.status).toBe('accepted')
      expect(plan.proposal.supersedes).toBe(latest.id)
      originals.push(plan)
    }
  }
  expect(h.run.snapshot().world!.requests[h.request.id]?.plans).toEqual(originals.map(plan => plan.id))
  expect(Object.values(h.run.snapshot().world!.requests)).toHaveLength(1)
  expect(Object.values(h.run.snapshot().world!.intents)).toHaveLength(1)
  expect(h.run.snapshot().world!.reservations).toEqual({})
  expect(h.model.requests).toHaveLength(9)
})

it.each(['json', 'sqlite'] as const)('publishes zero %s hire facts on append refusal and one full original result after retry', async (backend) => {
  const h = await preparedHireFixture(backend)
  const stream = Reflect.get(h.run, 'stream') as import('@clocky/clocky-storage').LogStream
  const before = h.run.snapshot()
  const append = vi.spyOn(stream, 'append').mockRejectedValueOnce(new Error('Atomic hire append refused'))
  await expect(h.run.commitWorldHire(h.reservation.id)).rejects.toThrow('Atomic hire append refused')
  expect(h.run.snapshot()).toEqual(before)
  expect(h.run.snapshot().entities[h.reservation.identities.entityId]?.readiness).toBe('preparing')
  expect(h.run.snapshot().relations[h.reservation.identities.relationId]).toBeUndefined()
  expect(h.run.snapshot().world!.results).toEqual({})
  append.mockRestore()
  const result = await h.run.commitWorldHire(h.reservation.id)
  expect(result.outcome.kind).toBe('committed')
  const revision = h.run.snapshot().revision
  expect(await h.run.commitWorldHire(h.reservation.id)).toEqual(result)
  expect(h.run.snapshot().revision).toBe(revision)
  expect(Object.values(h.run.snapshot().relations).filter(value => value.id === h.reservation.identities.relationId)).toHaveLength(1)
  expect(h.model.requests).toHaveLength(3)
})

it.each(['json', 'sqlite'] as const)('reopens a %s committed-but-lost reply as one complete original hire without a generation call', async (backend) => {
  const h = await preparedHireFixture(backend)
  const stream = Reflect.get(h.run, 'stream') as import('@clocky/clocky-storage').LogStream
  const append = stream.append.bind(stream)
  vi.spyOn(stream, 'append').mockImplementationOnce(async (...args) => {
    await append(...args)
    throw new Error('Committed hire response lost')
  })
  await expect(h.run.commitWorldHire(h.reservation.id)).rejects.toThrow('Committed hire response lost')
  vi.restoreAllMocks()
  const { spec } = h.run.snapshot()
  await h.run.close()
  const reopened = await h.ctx.simulations.open({ provider: 'local', mode: 'open', spec })
  cleanups.push(() => reopened.close())
  const result = Object.values(reopened.snapshot().world!.results)[0]!
  expect({ kind: result.outcome.kind, ...simulationWorldHireCommittedResultPayloadSchema.parse(result.payload) }).toEqual({ kind: 'committed', entityId: h.reservation.identities.entityId,
    relationId: h.reservation.identities.relationId })
  expect(reopened.snapshot().phase).toBe('paused')
  expect(reopened.snapshot().entities[h.reservation.identities.entityId]?.readiness).toBe('ready')
  expect(await reopened.commitWorldHire(h.reservation.id)).toEqual(result)
  expect(Object.values(reopened.snapshot().world!.reservations)).toHaveLength(1)
  expect(h.model.requests).toHaveLength(3)
})

it('protects reserved Entity capacity from unrelated admin creation before preparation', async () => {
  const h = await hireFixture('sqlite')
  const { foldEntityChange } = await import('../../simulation-local/src/entities.ts')
  const reservation = await h.run.reserveWorldHire(h.input)
  const state = h.run.snapshot()
  const bounded = { ...state, spec: { ...state.spec, maxEntities: Object.keys(state.entities).length + 1 } }
  expect(() => { foldEntityChange(bounded, simulationChangeSchema.parse({ kind: 'entity/create', id: 'another-entity',
    entityKind: 'organization', cognition: 'none', readiness: 'ready', profile: {} })) }).toThrow(/capacity/)
  expect(() => { foldEntityChange(bounded, simulationChangeSchema.parse({ kind: 'entity/create', id: reservation.identities.entityId,
    entityKind: 'person', cognition: 'agent', readiness: 'ready', profile: {} })) }).toThrow(/maintenance owner/)
  expect(h.run.snapshot().entities[reservation.identities.entityId]).toBeUndefined()
})

it.each(['json', 'sqlite'] as const)('reserves %s capacity and every identity, then commits one complete hire after real Team preparation', async (backend) => {
  const h = await hireFixture(backend)
  const before = h.run.snapshot()
  const reservation = await h.run.reserveWorldHire(h.input)
  expect(reservation.status).toBe('reserved')
  expect(h.run.snapshot().entities).toEqual(before.entities)
  expect(await h.run.reserveWorldHire(h.input)).toEqual(reservation)
  await expect(h.run.reserveWorldHire({ ...h.input, member: { ...h.input.member, model: 'another/model' } }))
    .rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  await expect(h.run.prepareWorldHire(reservation.id)).rejects.toThrow(/quiescent maintenance/)
  await h.connection.quiesceForMaintenance(h.input.maintenance, 4, 3)
  const preparing = await h.run.prepareWorldHire(reservation.id)
  expect(preparing.identities).toEqual(reservation.identities)
  const id = preparing.identities.entityId
  expect(h.run.snapshot().entities[id]?.readiness).toBe('preparing')
  expect(h.run.snapshot().entities[id]?.participantReservation?.binding).toEqual(preparing.identities.binding)
  expect(preparing.identities.channels.every(channel =>
    h.run.snapshot().channelReservations?.[channel.key]?.channelId === channel.channelId)).toBe(true)
  await expect(h.run.finishMaintenance(h.input.maintenance)).rejects.toThrow(/unresolved preparation/)
  const { modelVersion: _version, ...member } = preparing.request.member
  expect(await h.connection.ensureParticipant(id, member)).toEqual(preparing.identities.binding)
  for (const channel of preparing.identities.channels) {
    await h.connection.ensureChannel(simulationChannelSpecSchema.parse({ key: channel.key,
      members: [{ entityId: id, role: 'member' }, { entityId: channel.purpose === 'director' ? director : requester, role: channel.purpose }],
      limits: {} }))
  }
  const entity = h.run.snapshot().entities[id]!
  await expect(h.run.change(simulationChangeSchema.parse({ kind: 'entity/readiness', id,
    entityRevision: entity.revision, readiness: 'ready' }), h.run.snapshot().revision)).rejects.toThrow(/atomic assignment/)
  await expect(h.ctx.teamActivations.activate({ ...preparing.identities.binding,
    expectedCursor: (await h.ctx.teams.getTeam({ teamId: preparing.identities.binding.teamId })).team.cursor,
    provider: 'in-process', seed: { kind: 'fresh' }, agent: { options: {} }, signal: new AbortController().signal }))
    .rejects.toThrow(/maintenance|ready entity/)
  const result = await h.run.commitWorldHire(reservation.id)
  expect({ kind: result.outcome.kind, ...simulationWorldHireCommittedResultPayloadSchema.parse(result.payload) }).toEqual({ kind: 'committed', entityId: id, relationId: preparing.identities.relationId })
  expect(h.run.snapshot().entities[id]?.readiness).toBe('ready')
  expect(h.run.snapshot().relations[preparing.identities.relationId]).toMatchObject({ subject: id, object: 'position',
    scope: 'organization', validFrom: result.time })
  expect(h.run.snapshot().world!.reservations[reservation.id]?.status).toBe('committed')
  const first = Object.values(h.run.snapshot().scheduledEvents).find(value => value.id === `simulation-world-first:${reservation.id}`)!
  expect(first.action).toEqual({ kind: 'wake', entityId: id, reason: JSON.stringify({ resultId: result.id }) })
  expect(JSON.stringify(h.run.snapshot().entities[id]?.profile)).not.toContain(h.plan.proposal.resolution.rationale)
  const revision = h.run.snapshot().revision
  expect(await h.run.commitWorldHire(reservation.id)).toEqual(result)
  expect(h.run.snapshot().revision).toBe(revision)
  const cancellation = await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'too-late-cancel', requestId: h.request.id }))
  expect(cancellation.status).toBe('already-committed')
  expect(cancellation.resultId).toBe(result.id)
  await h.run.finishMaintenance(h.input.maintenance)
  expect(h.run.snapshot().phase).toBe('paused')
  expect(h.model.requests).toHaveLength(3)
})

it.each(['json', 'sqlite'] as const)('keeps %s preparing cancellation occupied and cannot finish maintenance or commit after unknown IO', async (backend) => {
  const h = await hireFixture(backend)
  const reservation = await h.run.reserveWorldHire(h.input)
  await h.connection.quiesceForMaintenance(h.input.maintenance, 4, 3)
  await h.run.prepareWorldHire(reservation.id)
  const cancelled = await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'cancel-preparing', requestId: h.request.id }))
  expect(cancelled.status).toBe('cancel-requested')
  expect(cancelled.resultId).toBeUndefined()
  expect(h.run.snapshot().world!.reservations[reservation.id]?.status).toBe('cancel-requested')
  expect(h.run.snapshot().world!.results).toEqual({})
  const entity = h.run.snapshot().entities[reservation.identities.entityId]!
  for (const change of [
    { kind: 'entity/readiness', id: entity.id, entityRevision: entity.revision, readiness: 'abandoned' },
    { kind: 'entity/phase', id: entity.id, entityRevision: entity.revision, phase: 'terminated' },
    { kind: 'entity/profile', id: entity.id, entityRevision: entity.revision, profile: { name: 'Replacement' } },
  ]) {
    await expect(h.run.change(simulationChangeSchema.parse(change), h.run.snapshot().revision))
      .rejects.toThrow(/proven cleanup|unresolved preparation/)
  }
  await expect(h.run.commitWorldHire(reservation.id)).rejects.toThrow()
  await expect(h.run.finishMaintenance(h.input.maintenance)).rejects.toThrow(/unresolved preparation/)
  expect(h.run.snapshot().entities[reservation.identities.entityId]?.readiness).toBe('preparing')
  expect(h.run.snapshot().phase).toBe('paused')
})

it.each(['json', 'sqlite'] as const)('cancels a %s reservation before preparation without recycling its allocated identities', async (backend) => {
  const h = await hireFixture(backend)
  const reservation = await h.run.reserveWorldHire(h.input)
  const cancelled = await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'cancel-reserved', requestId: h.request.id }))
  expect(cancelled.status).toBe('cancelled')
  expect(h.run.snapshot().world!.reservations[reservation.id]).toMatchObject({ status: 'abandoned', identities: reservation.identities })
  expect(h.run.snapshot().entities[reservation.identities.entityId]).toBeUndefined()
  await expect(h.run.prepareWorldHire(reservation.id)).rejects.toThrow()
  await expect(h.run.commitWorldHire(reservation.id)).rejects.toThrow()
  await expect(h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: reservation.identities.entityId,
    entityKind: 'person', cognition: 'agent', readiness: 'ready', profile: {} }), h.run.snapshot().revision))
    .rejects.toThrow(/maintenance owner/)
  await h.run.setPhase('paused', h.run.snapshot().revision)
  await expect(h.run.reserveChannel(simulationChannelSpecSchema.parse({ key: reservation.identities.channels[0].key,
    members: [{ entityId: requester, role: 'requester' }, { entityId: director, role: 'director' }], limits: {} }),
  h.run.snapshot().revision)).rejects.toThrow(/original preparing transition/)
  await expect(h.run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: reservation.identities.relationId,
    subject: requester, relation: 'assignment', object: 'position', scope: 'organization', validFrom: '0', validUntil: null }),
  h.run.snapshot().revision)).rejects.toThrow(/original atomic hire commit/)
  expect(Object.values(h.run.snapshot().world!.results).map(value => value.outcome)).toEqual([{ kind: 'cancelled' }])
})

it.each(['json', 'sqlite'] as const)('retains one %s rejection result and safe wake; later cancellation keeps the original reason', async (backend) => {
  const h = await caseFixture(backend, rejectedResolution)
  const decision = await h.connection.executeDecision(director, simulationDecisionIdSchema.parse('resolution'), h.context, h.wake)
  expect(h.run.snapshot().world!.results).toEqual({})
  await h.run.executeOperation(decision.operationIds[0]!)
  const result = Object.values(h.run.snapshot().world!.results)[0]!
  expect(result.outcome).toEqual({ kind: 'rejected', reason: rejectedResolution.reason })
  expect(result.source.kind).toBe('plan')
  const event = h.run.snapshot().scheduledEvents[`simulation-world-result:${result.id}` as import('@clocky/clocky-simulation').SimulationEventId]!
  expect(event.action).toEqual({ kind: 'wake', entityId: requester, reason: JSON.stringify({ resultId: result.id }) })
  expect(JSON.stringify(result)).not.toContain(rejectedResolution.rationale)
  const command = simulationWorldCancelRequestSchema.parse({ id: 'late-cancel', requestId: h.request.id })
  const receipt = await h.run.cancelWorldCase(command)
  expect(receipt.status).toBe('already-resolved')
  expect(receipt.resultId).toBe(result.id)
  expect(await h.run.cancelWorldCase(command)).toEqual(receipt)
  expect(Object.values(h.run.snapshot().world!.results)).toEqual([result])
  expect(h.run.snapshot().scheduledEvents[event.id]).toEqual(event)
  expect(h.model.requests).toHaveLength(3)
})

it.each(['json', 'sqlite'] as const)('cancels a %s accepted case once and denies subsequent planning without deleting history', async (backend) => {
  const h = await caseFixture(backend)
  const command = simulationWorldCancelRequestSchema.parse({ id: 'cancel-original', requestId: h.request.id })
  const first = await h.run.cancelWorldCase(command)
  const revision = h.run.snapshot().revision
  expect(first.status).toBe('cancelled')
  expect(await h.run.cancelWorldCase(command)).toEqual(first)
  expect(h.run.snapshot().revision).toBe(revision)
  await expect(h.run.cancelWorldCase({ ...command, requestId: 'another-case' as typeof command.requestId }))
    .rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  const second = await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'cancel-again', requestId: h.request.id }))
  expect(second.status).toBe('already-resolved')
  expect(second.resultId).toBe(first.resultId)
  expect(h.run.snapshot().world!.requests[h.request.id]?.status).toBe('cancelled')
  expect(h.run.snapshot().world!.intents[h.intent.id]).toEqual({ ...h.intent, requestId: h.request.id })
  expect(Object.keys(h.run.snapshot().world!.results)).toHaveLength(1)
  await expect(h.connection.executeDecision(director, simulationDecisionIdSchema.parse('late-plan'), h.context))
    .rejects.toThrow(/trusted director and open request/)
  expect(h.model.requests).toHaveLength(0)
})

it.each(['json', 'sqlite'] as const)('cancels a %s submitted window plan before acceptance and permits window closure', async (backend) => {
  const h = await caseFixture(backend, rejectedResolution)
  const { simulationWindowRequestSchema } = await import('@clocky/clocky-simulation')
  const id = simulationDecisionIdSchema.parse('submitted-resolution')
  const window = await h.run.openWindow(simulationWindowRequestSchema.parse({ id: 'cancel-window', decisions: [
    { id, entityId: director, context: h.context, wakeId: h.wake },
  ] }), h.run.snapshot().revision)
  expect((await h.connection.executeDecision(director, id, h.context, h.wake)).status).toBe('submitted')
  expect(h.run.snapshot().world!.plans).toEqual({})
  expect((await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'cancel-window-case', requestId: h.request.id }))).status).toBe('cancelled')
  expect(h.run.snapshot().decisions[id]?.status).toBe('cancelled')
  expect(h.run.snapshot().wakes[h.wake]?.status).toBe('cancelled')
  expect((await h.run.commitWindow(window.id)).status).toBe('closed')
  expect(h.run.snapshot().world!.plans).toEqual({})
  expect(Object.values(h.run.snapshot().world!.results).map(value => value.outcome)).toEqual([{ kind: 'cancelled' }])
})

it('rejects altered terminal result sources, public reasons and notification wakes in the Native projection', async () => {
  const h = await caseFixture('sqlite', rejectedResolution)
  const decision = await h.connection.executeDecision(director, simulationDecisionIdSchema.parse('resolution'), h.context, h.wake)
  await h.run.executeOperation(decision.operationIds[0]!)
  const state = h.run.snapshot(), result = Object.values(state.world!.results)[0]!
  const { assertWorldProjection } = await import('../../simulation-local/src/world.ts')
  assertWorldProjection(state, projectionRuntime)
  for (const patch of [
    { requestId: 'copied-case' }, { intentId: 'another-intent' }, { sequence: state.revision + 1 },
    { outcome: { kind: 'rejected', reason: 'policy' } }, { source: { kind: 'plan', planId: 'unaccepted-plan' } },
  ]) {
    const invalid = structuredClone(state)
    Object.assign(invalid.world!.results[result.id]!, patch)
    expect(() => { assertWorldProjection(invalid, projectionRuntime) }).toThrow()
  }
  const id = `simulation-world-result:${result.id}` as import('@clocky/clocky-simulation').SimulationEventId
  for (const action of [
    { kind: 'wake', entityId: director, reason: JSON.stringify({ resultId: result.id }) },
    { kind: 'wake', entityId: requester, reason: rejectedResolution.rationale },
  ]) {
    const invalid = structuredClone(state)
    Object.assign(invalid.scheduledEvents[id]!, { action })
    expect(() => { assertWorldProjection(invalid, projectionRuntime) }).toThrow()
  }
  await expect(h.run.scheduleWake({ id, entityId: requester, reason: rejectedResolution.rationale, time: state.time }, state.revision))
    .rejects.toThrow(/Internal simulation event ids are reserved/)
})

it('bounds original cancellation history and complete UTF-8 batch bytes while exact retries consume neither allowance', async () => {
  const h = await fixture('sqlite', { limits: { maxRequests: 1 } })
  await h.run.setPhase('running', h.run.snapshot().revision)
  await h.connection.executeDecision(requester, simulationDecisionIdSchema.parse('bounded-cancel-request'),
    { ...contextRequest(), world: { kind: 'request', intentId: h.intent.id } })
  const request = Object.values(h.run.snapshot().world!.requests)[0]!
  const before = h.run.snapshot()
  await expect(h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: '中'.repeat(1300), requestId: request.id })))
    .rejects.toMatchObject({ code: 'SIM_WORLD_LIMIT' })
  expect(h.run.snapshot()).toEqual(before)
  const command = simulationWorldCancelRequestSchema.parse({ id: 'only-cancel', requestId: request.id })
  const receipt = await h.run.cancelWorldCase(command)
  const revision = h.run.snapshot().revision
  expect(await h.run.cancelWorldCase(command)).toEqual(receipt)
  expect(h.run.snapshot().revision).toBe(revision)
  await expect(h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'another-cancel', requestId: request.id })))
    .rejects.toMatchObject({ code: 'SIM_WORLD_LIMIT' })
  expect(Object.values(h.run.snapshot().world!.cancellations)).toEqual([receipt])
})

it.each(['json', 'sqlite'] as const)('keeps a %s accepted plan and persona after cancellation without applying its later rejection', async (backend) => {
  const h = await caseFixture(backend, rejectedResolution)
  const decision = await h.connection.executeDecision(director, simulationDecisionIdSchema.parse('resolution'), h.context, h.wake)
  const plan = Object.values(h.run.snapshot().world!.plans)[0]!
  await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'cancel-before-settlement', requestId: h.request.id }))
  await h.run.executeOperation(decision.operationIds[0]!)
  expect(h.run.snapshot().world!.plans[plan.id]).toEqual(plan)
  expect(Object.values(h.run.snapshot().world!.results).map(value => value.outcome)).toEqual([{ kind: 'cancelled' }])
  expect(h.run.snapshot().world!.requests[h.request.id]?.status).toBe('cancelled')
})

it.each(['json', 'sqlite'] as const)('publishes neither %s cancellation nor wake on failed append and reuses the original command after restore', async (backend) => {
  const h = await caseFixture(backend)
  const { LocalSimulationRun } = await import('../../simulation-local/src/run.ts')
  expect(h.run).toBeInstanceOf(LocalSimulationRun)
  const stream = Reflect.get(h.run, 'stream') as import('@clocky/clocky-storage').LogStream
  const append = vi.spyOn(stream, 'append').mockRejectedValueOnce(new Error('Cancellation append barrier failed'))
  const command = simulationWorldCancelRequestSchema.parse({ id: 'durable-cancel', requestId: h.request.id })
  const before = h.run.snapshot()
  await expect(h.run.cancelWorldCase(command)).rejects.toThrow('Cancellation append barrier failed')
  expect(h.run.snapshot()).toEqual(before)
  append.mockRestore()
  const receipt = await h.run.cancelWorldCase(command)
  const world = h.run.snapshot().world!
  const checkpoint = await h.connection.checkpoint({ id: simulationCheckpointIdSchema.parse('cancelled-case'),
    implementationVersion: 'world-results/1', maxDrainRounds: 4, maxAttempts: 3 })
  expect(checkpoint.status).toBe('completed')
  const { spec } = h.run.snapshot()
  await h.run.close()
  const restored = await h.ctx.simulationTeams.restore({ provider: 'local', mode: 'open', spec }, {
    id: checkpoint.request.id, implementationVersion: 'world-results/1', maxAttempts: 3,
  })
  cleanups.push(() => restored.run.close())
  expect(restored.run.snapshot().phase).toBe('paused')
  expect(restored.run.snapshot().world).toEqual(world)
  expect(await restored.run.cancelWorldCase(command)).toEqual(receipt)
  expect(h.requestModel.requests).toHaveLength(3)
  expect(h.model.requests).toHaveLength(0)
})

it.each([['json', 'apply'], ['sqlite', 'apply'], ['json', 'reject'], ['sqlite', 'reject']] as const)(
  'retains the %s model-selected %s plan after private request consumption', async (backend, kind) => {
    const h = await fixture(backend)
    const { ctx, run, connection, intent } = h
    const resolution: SimulationWorldResolveOperation['resolution'] = kind === 'apply'
      ? { kind: 'apply', payload: { templateId: 'researcher', templateVersion: '1', persona }, rationale: 'Private assessment.' }
      : { kind: 'reject', reason: 'insufficient-information', rationale: 'Private missing-information assessment.' }
    const model = new MockAdapter(h.calls('director', () => {
      const request = Object.values(run.snapshot().world!.requests)[0]!
      return { kind: 'world/resolve', requestId: request.id, supersedes: null, resolution }
    }))
    ctx.llm.registerAdapter(['director-model'], model)
    const lease = await connection.activate(director, { provider: 'in-process', seed: { kind: 'fresh' },
      agent: { options: { provider: 'director-model', model: 'scripted' } }, signal: new AbortController().signal })
    await run.setPhase('running', run.snapshot().revision)
    const requestContext = { ...contextRequest(), world: { kind: 'request' as const, intentId: intent.id } }
    const accepted = await connection.executeDecision(requester, simulationDecisionIdSchema.parse('request'), requestContext)
    expect(accepted.status).toBe('accepted')
    expect(accepted.operationIds).toHaveLength(2)
    const retry = await connection.executeDecision(requester, simulationDecisionIdSchema.parse('retry'), requestContext)
    expect(retry.status).toBe('accepted')
    expect(retry.operationIds).toHaveLength(1)
    expect(Object.values(run.snapshot().world!.requests)).toHaveLength(1)
    const request = Object.values(run.snapshot().world!.requests)[0]!
    await run.drive({ until: simTimeSchema.parse('0') })
    assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
    await connection.dispatchOperation(request.notificationOperationId, () => 100)
    assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
    const wake = await connection.receiveOperation(request.notificationOperationId)
    await run.drive({ until: simTimeSchema.parse('0') })
    const decisionId = simulationDecisionIdSchema.parse('resolve')
    await connection.executeDecision(director, decisionId,
      { ...contextRequest(), world: { kind: 'resolve', requestId: request.id } }, wake)
    const plan = Object.values(run.snapshot().world!.plans)[0]!
    expect(plan.proposal.resolution).toEqual(resolution)
    expect(plan.status).toBe('accepted')
    expect(run.snapshot().decisions[decisionId]?.consumption?.notification?.operationId).toBe(request.notificationOperationId)
    expect(Object.keys(run.snapshot().entities)).toHaveLength(5)
    expect(h.requestModel.requests).toHaveLength(6)
    expect(model.requests).toHaveLength(3)
    const results = lease.localAgent!.session.events.filter(event => event.type === 'tool/result')
    const result = results.at(-1)?.data.message.content.find(block => block.type === 'tool-result')
    expect(result?.isError).toBe(false)
    expect(result?.content).toEqual([{ type: 'text', text: JSON.stringify({ status: 'accepted',
      operationIds: run.snapshot().decisions[decisionId]?.operationIds, effects: 'pending' }) }])
    await run.drive({ until: simTimeSchema.parse('0') })
    expect(run.snapshot().world!.requests[request.id]?.status).toBe(kind === 'reject' ? 'rejected' : 'open')
    expect(Object.keys(run.snapshot().entities)).toHaveLength(5)
    const channelLog = await ctx.teams.readChannel({ channelId: h.channel.manifest.id, afterCursor: -1 })
    expect(channelLog.records.some(record => record.type === 'channel/receipt')).toBe(true)
    await expect(connection.executeDecision(requester, simulationDecisionIdSchema.parse('forged-director'),
      { ...contextRequest(), world: { kind: 'resolve', requestId: request.id } })).rejects.toThrow(/trusted director/)
  })


it.each(['json', 'sqlite'] as const)('rejects direct %s world submission without canonical consumed input', async (backend) => {
  const h = await fixture(backend)
  await h.run.setPhase('running', h.run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('unconsumed')
  await h.connection.openDecision(requester, id)
  await h.connection.prepareContext(requester, id, { ...contextRequest(), world: { kind: 'request', intentId: h.intent.id } })
  const { simulationProposalSchema } = await import('@clocky/clocky-simulation')
  await expect(h.connection.submitDecision(requester, id, [simulationProposalSchema.parse({ after: [], action: h.requestAction })]))
    .rejects.toThrow(/consumed Native-selected context/)
  expect(h.run.snapshot().world!.requests).toEqual({})
  expect(h.run.snapshot().operations).toEqual({})
  expect(h.requestModel.requests).toHaveLength(0)
})

it.each([
  { name: 'expanded operations', spec: { maxOperationsPerDecision: 1, maxResourceReservationHistory: 128 }, limits: {} },
  { name: 'expanded messages', spec: { maxMessagesPerInterval: 0 }, limits: {} },
  { name: 'expanded bytes', spec: {}, limits: { maxBytesPerRequest: 512 } },
])('counts $name before accepting any world case or notification', async ({ name, spec, limits }) => {
  const h = await fixture('sqlite', { spec, limits, candidateOnly: name === 'expanded bytes' })
  if (name === 'expanded bytes') expect(h.run.snapshot().world!.intents).toEqual({})
  await h.run.setPhase('running', h.run.snapshot().revision)
  const work = h.connection.executeDecision(requester, simulationDecisionIdSchema.parse('over-limit'),
    { ...contextRequest(), world: name === 'expanded bytes' ? { kind: 'goal' } : { kind: 'request', intentId: h.intent.id } })
  if (name === 'expanded bytes') {
    expect(await work).toMatchObject({ status: 'cancelled', worldSubmissionBlock: { failure: { code: 'SIM_WORLD_LIMIT', limit: 'bytes' } } })
    expect(h.run.snapshot().stall?.code).toBe('SIM_WORLD_SUBMISSION_BLOCKED')
    const snapshot = h.run.snapshot()
    await expect(h.requesterWriter.submitDecision(simulationDecisionIdSchema.parse('over-limit'),
      [{ after: [], action: h.requestAction as import('@clocky/clocky-simulation').SimulationOperationAction }]))
      .rejects.toMatchObject({ code: 'SIM_WORLD_LIMIT', failure: { code: 'SIM_WORLD_LIMIT', limit: 'bytes' } })
    expect(h.run.snapshot()).toEqual(snapshot)
    await expect(h.requesterWriter.submitDecision(simulationDecisionIdSchema.parse('over-limit'), []))
      .rejects.toThrow(/changed its original payload/)
    expect(h.run.snapshot()).toEqual(snapshot)
  } else await expect(work).rejects.toThrow()
  expect(h.run.snapshot().world!.requests).toEqual({})
  expect(h.run.snapshot().operations).toEqual({})
  expect(h.run.snapshot().decisions[simulationDecisionIdSchema.parse('over-limit')]?.status).not.toBe('accepted')
})

it.each(['json', 'sqlite'] as const)('retains a %s window byte refusal after submitted input without undoing an earlier accepted slot', async (backend) => {
  const h = await fixture(backend, { limits: { maxBytesPerRequest: 2400 } })
  const { simulationWindowRequestSchema, simulationWorldSubmissionHash } = await import('@clocky/clocky-simulation')
  const { assertBusinessProjection } = await import('../../simulation-local/src/decisions.ts')
  const { worldSubmissionEvidenceMatches } = await import('../src/world-submission-evidence.ts')
  const model = new MockAdapter([toolCallResponse('earlier-observe', 'simulation_observe', {}),
    toolCallResponse('earlier-stage', 'simulation_stage', { proposals: [] }),
    toolCallResponse('earlier-submit', 'simulation_submit', {})])
  h.ctx.llm.registerAdapter(['earlier-director'], model)
  await h.connection.activate(director, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: { provider: 'earlier-director', model: 'scripted' } }, signal: new AbortController().signal })
  await h.run.setPhase('running', h.run.snapshot().revision)
  const earlier = simulationDecisionIdSchema.parse('earlier-slot'), denied = simulationDecisionIdSchema.parse('window-byte-refusal')
  const context = { ...contextRequest(), world: { kind: 'request' as const, intentId: h.intent.id } }
  const window = await h.run.openWindow(simulationWindowRequestSchema.parse({ id: 'bounded-window', decisions: [
    { id: earlier, entityId: director, context: contextRequest() }, { id: denied, entityId: requester, context },
  ] }), h.run.snapshot().revision)
  expect((await h.connection.executeDecision(requester, denied, context)).status).toBe('submitted')
  expect((await h.run.commitWindow(window.id)).status).toBe('collecting')
  expect((await h.connection.executeDecision(director, earlier, contextRequest())).status).toBe('submitted')
  expect((await h.run.commitWindow(window.id)).status).toBe('closed')
  const state = h.run.snapshot(), blocked = state.decisions[denied]!
  expect(state.decisions[earlier]!.status).toBe('accepted')
  expect(blocked).toMatchObject({ status: 'cancelled', cancellation: 'requested', worldSubmissionBlock: {
    failure: { code: 'SIM_WORLD_LIMIT', limit: 'bytes' } } })
  expect(blocked.worldSubmissionBlock!.proposalHash).toBe(simulationWorldSubmissionHash(blocked.submission!))
  expect(state.phase).toBe('stalled')
  expect(state.stall?.code).toBe('SIM_WORLD_SUBMISSION_BLOCKED')
  expect(state.operations).toEqual({})
  expect(state.world!.requests).toEqual({})
  const agent = h.ctx.agents.get(state.entities[requester]!.binding!.sessionId)!
  expect(worldSubmissionEvidenceMatches(blocked, agent.session.events)).toBe(true)
  const invalid = { ...state, decisions: { ...state.decisions, [denied]: { ...blocked,
    worldSubmissionBlock: { ...blocked.worldSubmissionBlock!, proposalHash: '0'.repeat(64) } } } }
  expect(() => { assertBusinessProjection(invalid, projectionRuntime) }).toThrow(/cancelled consumed input/)
  expect((await h.run.commitWindow(window.id)).status).toBe('closed')
  expect(h.run.snapshot()).toEqual(state)
  expect(h.requestModel.requests).toHaveLength(3)
  expect(model.requests).toHaveLength(3)
})

it.each(['json', 'sqlite'] as const)('refuses changed %s request payloads on the same business application without overwriting accepted history', async (backend) => {
  const h = await fixture(backend)
  await h.run.setPhase('running', h.run.snapshot().revision)
  const context = { ...contextRequest(), world: { kind: 'request' as const, intentId: h.intent.id } }
  await h.connection.executeDecision(requester, simulationDecisionIdSchema.parse('original'), context)
  const original = h.run.snapshot().world!.requests
  h.requestAction.payload.description = 'Different application under the same intent'
  await expect(h.connection.executeDecision(requester, simulationDecisionIdSchema.parse('changed'), context)).rejects.toThrow()
  expect(h.run.snapshot().world!.requests).toEqual(original)
  expect(Object.keys(h.run.snapshot().operations)).toHaveLength(2)
})

it('does not elevate a profile claiming the director role or accept an operation mixed with a request', async () => {
  const h = await fixture('sqlite')
  const entity = h.run.snapshot().entities[requester]!
  await h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: requester, entityRevision: entity.revision,
    profile: { role: 'director', permissions: ['world/resolve'] } }), h.run.snapshot().revision)
  await h.run.setPhase('running', h.run.snapshot().revision)
  await h.connection.executeDecision(requester, simulationDecisionIdSchema.parse('request'),
    { ...contextRequest(), world: { kind: 'request', intentId: h.intent.id } })
  const request = Object.values(h.run.snapshot().world!.requests)[0]!
  const fake = simulationDecisionIdSchema.parse('profile-elevation')
  await h.connection.openDecision(requester, fake)
  await expect(h.connection.prepareContext(requester, fake, { ...contextRequest(), world: { kind: 'resolve', requestId: request.id } }))
    .rejects.toThrow(/trusted director/)
  const { simulationProposalSchema } = await import('@clocky/clocky-simulation')
  await expect(h.connection.submitDecision(requester, fake, [h.requestAction, h.requestAction]
    .map(action => simulationProposalSchema.parse({ after: [], action })))).rejects.toThrow(/one unmixed/)
  expect(h.run.snapshot().world!.plans).toEqual({})
})


it.each(['unrelated', 'authorization'] as const)('uses explicit read sets when %s facts change after planning context freezes', async (changed) => {
  const h = await fixture('sqlite')
  const resolution = { kind: 'apply', payload: { templateId: 'researcher', templateVersion: '1', persona }, rationale: 'Private assessment.' }
  const model = new MockAdapter(h.calls('director-read-set', () => ({ kind: 'world/resolve',
    requestId: Object.values(h.run.snapshot().world!.requests)[0]!.id, supersedes: null, resolution })))
  h.ctx.llm.registerAdapter(['director-read-set'], model)
  const directorLease = await h.connection.activate(director, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: { provider: 'director-read-set', model: 'scripted' } }, signal: new AbortController().signal })
  await h.run.setPhase('running', h.run.snapshot().revision)
  await h.connection.executeDecision(requester, simulationDecisionIdSchema.parse('request'),
    { ...contextRequest(), world: { kind: 'request', intentId: h.intent.id } })
  const request = Object.values(h.run.snapshot().world!.requests)[0]!
  const decision = simulationDecisionIdSchema.parse('resolve-read-set')
  const context = { ...contextRequest(), world: { kind: 'resolve' as const, requestId: request.id } }
  await h.connection.openDecision(director, decision)
  await expect(h.connection.prepareContext(director, decision, context)).rejects.toThrow(/original due notification/)
  await h.connection.cancelDecision(director, decision)
  await h.run.drive({ until: simTimeSchema.parse('0') })
  assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
  await h.connection.dispatchOperation(request.notificationOperationId, () => 100)
  assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
  const wake = await h.connection.receiveOperation(request.notificationOperationId)
  await h.run.drive({ until: simTimeSchema.parse('0') })
  const ready = simulationDecisionIdSchema.parse('resolve-consumed')
  await h.connection.openDecision(director, ready, wake)
  await h.connection.prepareContext(director, ready, context)
  await expect(h.ctx.simulationTeams.modelRequest(directorLease.localAgent!, { kind: 'observe' }, new AbortController().signal))
    .rejects.toThrow(/current prepared decision input/)
  if (changed === 'authorization') {
    const relation = Object.values(h.run.snapshot().relations)[0]!
    await h.run.change(simulationChangeSchema.parse({ kind: 'relation/update', id: relation.id, relationRevision: relation.revision,
      subject: relation.subject, relation: relation.relation, object: relation.object, scope: relation.scope,
      validFrom: relation.validFrom, validUntil: '100' }), h.run.snapshot().revision)
  } else {
    const { simulationWakeRequestSchema } = await import('@clocky/clocky-simulation')
    await h.run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'unrelated-later', entityId: requester, time: '10', reason: 'Other work' }),
      h.run.snapshot().revision)
  }
  await h.connection.executeDecision(director, ready, context, wake)
  const plan = Object.values(h.run.snapshot().world!.plans)[0]!
  expect(plan.status).toBe(changed === 'authorization' ? 'stale' : 'accepted')
  expect(plan.proposal.resolution).toEqual(resolution)
  expect(plan.baseRevision).toBeLessThan(h.run.snapshot().revision)
  expect(h.run.snapshot().decisions[ready]?.consumption?.notification?.operationId).toBe(request.notificationOperationId)
})

it.each(['json', 'sqlite'] as const)('returns the %s director submission before window closure and then drains maintenance', async (backend) => {
  const h = await fixture(backend)
  const resolution = { kind: 'apply' as const, payload: { templateId: 'researcher', templateVersion: '1', persona }, rationale: 'Private assessment.' }
  const model = new MockAdapter(h.calls('window-director', () => ({ kind: 'world/resolve',
    requestId: Object.values(h.run.snapshot().world!.requests)[0]!.id, supersedes: null, resolution })))
  h.ctx.llm.registerAdapter(['window-director'], model)
  await h.connection.activate(director, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: { provider: 'window-director', model: 'scripted' } }, signal: new AbortController().signal })
  await h.run.setPhase('running', h.run.snapshot().revision)
  await h.connection.executeDecision(requester, simulationDecisionIdSchema.parse('request'),
    { ...contextRequest(), world: { kind: 'request', intentId: h.intent.id } })
  const request = Object.values(h.run.snapshot().world!.requests)[0]!
  await h.run.drive({ until: simTimeSchema.parse('0') })
  assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
  await h.connection.dispatchOperation(request.notificationOperationId, () => 100)
  assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
  const wake = await h.connection.receiveOperation(request.notificationOperationId)
  await h.run.drive({ until: simTimeSchema.parse('0') })
  const { simulationWindowRequestSchema, simulationMaintenanceRequestSchema } = await import('@clocky/clocky-simulation')
  const decision = simulationDecisionIdSchema.parse('window-plan')
  const context = { ...contextRequest(), world: { kind: 'resolve' as const, requestId: request.id } }
  const window = await h.run.openWindow(simulationWindowRequestSchema.parse({ id: 'world-window', decisions: [
    { id: decision, entityId: director, context, wakeId: wake },
  ] }), h.run.snapshot().revision)
  expect((await h.connection.executeDecision(director, decision, context, wake)).status).toBe('submitted')
  expect(h.run.snapshot().world!.plans).toEqual({})
  expect(h.run.snapshot().activeWindowId).toBe(window.id)
  const maintenance = simulationMaintenanceRequestSchema.parse({ id: 'world-after-window', owner: 'world-owner' })
  await h.run.beginMaintenance(maintenance)
  expect((await h.run.commitWindow(window.id)).status).toBe('closed')
  const plan = Object.values(h.run.snapshot().world!.plans)[0]!
  expect(plan.proposal.resolution).toEqual(resolution)
  const accepted = h.run.snapshot()
  expect(await h.connection.submitDecision(director, decision, [{ after: [], action: worldRolePlan(plan).proposal }]))
    .toEqual(accepted.decisions[decision])
  expect(h.run.snapshot()).toEqual(accepted)
  await expect(h.connection.submitDecision(director, decision, [{ after: [], action: { ...worldRolePlan(plan).proposal,
    resolution: { ...resolution, payload: { ...resolution.payload, persona: { ...persona, traits: [] } } } } }]))
    .rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  expect(h.run.snapshot()).toEqual(accepted)
  expect((await h.connection.quiesceForMaintenance(maintenance, 4, 3)).status).toBe('quiescent')
  expect(h.run.snapshot().world!.plans[plan.id]).toEqual(plan)
  expect(h.run.snapshot().phase).toBe('paused')
  expect(h.run.population().chargedActors).toBe(0)
  expect(Object.keys(h.run.snapshot().entities)).toHaveLength(5)
  expect(model.requests).toHaveLength(3)
})


it('keeps business application identity independent of the actor field and rejects a changed original requester', async () => {
  const h = await fixture('sqlite')
  expect(await seedHiringIntent(h.run, hiringIntentFields(h.intent))).toEqual(h.intent)
  await expect(seedHiringIntent(h.run, { ...hiringIntentFields(h.intent), requesterEntityId: director }))
    .rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  expect(Object.values(h.run.snapshot().world!.intents)).toEqual([h.intent])
})

it.each(['json', 'sqlite'] as const)('links a %s insufficient-information resubmission without replacing the old case', async (backend) => {
  const h = await caseFixture(backend, rejectedResolution)
  await h.connection.executeDecision(director, simulationDecisionIdSchema.parse('reject-incomplete'), h.context, h.wake)
  await h.run.drive({ until: simTimeSchema.parse('0') })
  const original = h.run.snapshot().world!, input = { ...hiringIntentFields(h.intent), applicationId: 'complete-research-application' }
  expect(original.requests[h.request.id]?.status).toBe('rejected')
  await expect(seedHiringIntent(h.run, input)).rejects.toThrow(/must reference the latest insufficient-information rejection/)
  await expect(seedHiringIntent(h.run, simulationHireIntentRequestSchema.parse({ ...input, priorRequestId: 'another-case' })))
    .rejects.toThrow(/original insufficient-information rejection/)
  expect(h.run.snapshot().world).toEqual(original)
  const next = await seedHiringIntent(h.run, { ...input, priorRequestId: h.request.id })
  const revision = h.run.snapshot().revision
  expect(await seedHiringIntent(h.run, hiringIntentFields(next))).toEqual(next)
  expect(await seedHiringIntent(h.run, hiringIntentFields(h.intent))).toEqual(original.intents[h.intent.id])
  expect(h.run.snapshot().revision).toBe(revision)
  expect(h.run.snapshot().world!.requests).toEqual(original.requests)
  expect(h.run.snapshot().world!.results).toEqual(original.results)
  expect(hiringIntentFields(h.run.snapshot().world!.intents[next.id]).priorRequestId).toBe(h.request.id)
  expect(h.model.requests).toHaveLength(3)
  expect(h.requestModel.requests).toHaveLength(3)
  const retained = h.run.snapshot().world!
  const checkpoint = await h.connection.checkpoint({ id: simulationCheckpointIdSchema.parse('linked-application'),
    implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
  const { spec } = h.run.snapshot()
  await h.run.close()
  const restored = await h.ctx.simulationTeams.restore({ provider: 'local', mode: 'open', spec }, {
    id: checkpoint.request.id, implementationVersion: 'world/1', maxAttempts: 3 })
  cleanups.push(() => restored.run.close())
  expect(restored.run.snapshot().world).toEqual(retained)
  expect(restored.run.snapshot().phase).toBe('paused')
  expect(await seedHiringIntent(restored.run, hiringIntentFields(next))).toEqual(retained.intents[next.id])
  expect(h.model.requests).toHaveLength(3)
})

it.each((['json', 'sqlite'] as const).flatMap(backend => (['open', 'cancelled', 'policy'] as const).map(status => ({ backend, status }))))(
  'refuses a $backend predecessor whose original result is $status', async ({ backend, status }) => {
    const h = await caseFixture(backend, status === 'policy' ? { ...rejectedResolution, reason: 'policy' } : undefined)
    if (status === 'cancelled') await h.connection.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'prior-cancel',
      requestId: h.request.id }))
    else if (status === 'policy') {
      await h.connection.executeDecision(director, simulationDecisionIdSchema.parse('policy-rejection'), h.context, h.wake)
      await h.run.drive({ until: simTimeSchema.parse('0') })
    }
    const before = h.run.snapshot()
    await expect(seedHiringIntent(h.run, { ...hiringIntentFields(h.intent), applicationId: 'new-application', priorRequestId: h.request.id }))
      .rejects.toThrow(/original insufficient-information rejection/)
    expect(h.run.snapshot()).toEqual(before)
  })

it('denies ordinary success messages in request-scoped decisions at Native admission', async () => {
  const h = await fixture('sqlite')
  await h.connection.activate(director, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: {} }, signal: new AbortController().signal })
  await h.run.setPhase('running', h.run.snapshot().revision)
  const { simulationProposalSchema } = await import('@clocky/clocky-simulation')
  for (const actor of [requester]) {
    const id = simulationDecisionIdSchema.parse(`ordinary-${actor}`)
    await h.connection.openDecision(actor, id)
    await h.connection.prepareContext(actor, id, { ...contextRequest(),
      ...actor === requester ? { world: { kind: 'request' as const, intentId: h.intent.id } } : {} })
    await expect(h.connection.submitDecision(actor, id, [simulationProposalSchema.parse({ after: [], action: {
      kind: 'communication/post', recipient: actor === requester ? director : requester,
      channelId: h.channel.manifest.id, text: 'Already hired', deliverAt: '0',
    } })])).rejects.toMatchObject({ code: 'SIM_WORLD_AUTHORITY' })
    await h.connection.cancelDecision(actor, id)
  }
  expect(h.run.snapshot().operations).toEqual({})
  expect(h.requestModel.requests).toHaveLength(0)
})

it.each(['json', 'sqlite'] as const)('retains a cancelled %s prepared planning attempt instead of allowing new decision IDs to bypass the case limit', async (backend) => {
  const h = await fixture(backend, { limits: { maxPlansPerRequest: 1 } })
  await h.connection.activate(director, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: {} }, signal: new AbortController().signal })
  await h.run.setPhase('running', h.run.snapshot().revision)
  await h.connection.executeDecision(requester, simulationDecisionIdSchema.parse('request'),
    { ...contextRequest(), world: { kind: 'request', intentId: h.intent.id } })
  const request = Object.values(h.run.snapshot().world!.requests)[0]!
  await h.run.drive({ until: simTimeSchema.parse('0') })
  assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
  await h.connection.dispatchOperation(request.notificationOperationId, () => 100)
  assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
  const wake = await h.connection.receiveOperation(request.notificationOperationId)
  await h.run.drive({ until: simTimeSchema.parse('0') })
  const first = simulationDecisionIdSchema.parse('first-attempt')
  const context = { ...contextRequest(), world: { kind: 'resolve' as const, requestId: request.id } }
  await h.connection.openDecision(director, first, wake)
  await h.connection.prepareContext(director, first, context)
  await h.connection.cancelDecision(director, first)
  const second = simulationDecisionIdSchema.parse('different-attempt')
  await h.connection.openDecision(director, second, wake)
  await expect(h.connection.prepareContext(director, second, context)).rejects.toMatchObject({ code: 'SIM_WORLD_LIMIT' })
  expect(h.run.snapshot().world!.plans).toEqual({})
  expect(h.run.snapshot().decisions[first]?.status).toBe('cancelled')
})


it('rejects an old world writer and a replaced Agent even with the original consumed input', async () => {
  const h = await fixture('sqlite')
  await h.run.setPhase('running', h.run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('accepted-before-replacement')
  await h.connection.executeDecision(requester, id, { ...contextRequest(), world: { kind: 'request', intentId: h.intent.id } })
  const original = h.run.snapshot().world!.requests
  const old = h.requesterLease.localAgent!
  await h.connection.hibernate(requester)
  const replacement = await h.connection.resume(requester, { provider: 'in-process',
    agent: { options: { provider: 'requester-model', model: 'scripted' } }, signal: new AbortController().signal })
  expect(replacement.binding.activation.id).not.toBe(h.requesterLease.binding.activation.id)
  const { simulationProposalSchema } = await import('@clocky/clocky-simulation')
  await expect(h.requesterWriter.submitDecision(id, [simulationProposalSchema.parse({ after: [], action: h.requestAction })]))
    .rejects.toThrow(/admission|retired|stale/)
  await expect(h.ctx.simulationTeams.modelRequest(old, { kind: 'submit' }, new AbortController().signal)).rejects.toThrow(/authority/)
  await expect(h.ctx.simulationTeams.modelRequest(replacement.localAgent!, { kind: 'submit' }, new AbortController().signal))
    .rejects.toThrow(/current prepared decision input/)
  expect(h.run.snapshot().world!.requests).toEqual(original)
  expect(h.requestModel.requests).toHaveLength(3)
})

it.each(['json', 'sqlite'] as const)('retries exact %s decision identities without new effects and refuses changed request or plan payloads', async (backend) => {
  const h = await hireFixture(backend)
  const { simulationProposalSchema } = await import('@clocky/clocky-simulation')
  const originalRequest = h.run.snapshot().decisions[simulationDecisionIdSchema.parse('request')]!
  const before = h.run.snapshot()
  expect(originalRequest.operationIds).toHaveLength(2)
  expect(originalRequest.worldExpansion?.operationIds).toEqual(originalRequest.operationIds)
  expect(h.decision.worldExpansion?.operationIds).toEqual(h.decision.operationIds)
  expect(await h.connection.submitDecision(requester, originalRequest.id,
    [simulationProposalSchema.parse({ after: [], action: h.requestAction })])).toEqual(originalRequest)
  expect(await h.connection.submitDecision(director, h.decision.id,
    [simulationProposalSchema.parse({ after: [], action: h.plan.proposal })])).toEqual(h.decision)
  await expect(h.connection.submitDecision(requester, originalRequest.id,
    [simulationProposalSchema.parse({ after: [], action: { ...h.requestAction, payload: { ...h.requestAction.payload, description: 'A changed original payload.' } } })]))
    .rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  await expect(h.connection.submitDecision(director, h.decision.id,
    [simulationProposalSchema.parse({ after: [], action: { ...h.plan.proposal,
      resolution: { ...h.plan.proposal.resolution, rationale: 'A changed original assessment.' } } })]))
    .rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  expect(h.run.snapshot()).toEqual(before)
  expect(h.requestModel.requests).toHaveLength(3)
  expect(h.model.requests).toHaveLength(3)
  const channel = await h.ctx.teams.readChannel({ channelId: h.channel.manifest.id, afterCursor: -1 })
  expect(channel.records.filter(record => record.type === 'channel/receipt')).toHaveLength(1)
})

it.each(['json', 'sqlite'] as const)('keeps one complete %s hire when the original application retries with a new decision identity', async (backend) => {
  const h = await preparedHireFixture(backend)
  const result = await h.run.commitWorldHire(h.reservation.id)
  expect({ kind: result.outcome.kind, ...simulationWorldHireCommittedResultPayloadSchema.parse(result.payload) }).toEqual({ kind: 'committed', entityId: h.reservation.identities.entityId,
    relationId: h.reservation.identities.relationId })
  const committed = h.run.snapshot()
  expect(await h.run.commitWorldHire(h.reservation.id)).toEqual(result)
  expect(await h.run.reserveWorldHire(h.input)).toEqual(committed.world!.reservations[h.reservation.id])
  expect(await seedHiringIntent(h.run, hiringIntentFields(h.intent))).toEqual(committed.world!.intents[h.intent.id])
  await expect(seedHiringIntent(h.run, { ...hiringIntentFields(h.intent), requesterEntityId: director }))
    .rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  expect(h.run.snapshot()).toEqual(committed)
  await h.run.finishMaintenance(h.input.maintenance)
  await h.connection.resume(requester, { provider: 'in-process',
    agent: { options: { provider: 'requester-model', model: 'scripted' } }, signal: new AbortController().signal })
  await h.connection.resume(director, { provider: 'in-process',
    agent: { options: { provider: 'result-director', model: 'scripted' } }, signal: new AbortController().signal })
  await h.run.setPhase('running', h.run.snapshot().revision)
  await h.run.executeOperation(h.decision.operationIds[0]!)
  const duplicate = await h.connection.executeDecision(requester, simulationDecisionIdSchema.parse('after-commit-request'),
    { ...contextRequest(), world: { kind: 'request', intentId: h.intent.id } })
  expect(duplicate.status).toBe('accepted')
  expect(duplicate.operationIds).toHaveLength(1)
  await h.run.executeOperation(duplicate.operationIds[0]!)
  const anotherPlan = simulationDecisionIdSchema.parse('after-commit-plan')
  await h.connection.openDecision(director, anotherPlan)
  await expect(h.connection.prepareContext(director, anotherPlan, h.context))
    .rejects.toMatchObject({ code: 'SIM_WORLD_AUTHORITY' })
  await h.connection.cancelDecision(director, anotherPlan)
  const after = h.run.snapshot()
  expect(after.world).toEqual(committed.world)
  expect(after.entities[h.reservation.identities.entityId]).toEqual(committed.entities[h.reservation.identities.entityId])
  expect(after.relations).toEqual(committed.relations)
  expect(Object.values(after.world!.results)).toEqual([result])
  expect(Object.values(after.world!.reservations)).toHaveLength(1)
  expect(Object.values(after.scheduledEvents).filter(event => event.id === `simulation-world-first:${h.intent.id}`)).toHaveLength(1)
  expect(Object.values(after.scheduledEvents).filter(event => event.id === `simulation-world-result:${result.id}`)).toHaveLength(1)
  expect(Object.values(after.operations).filter(operation => operation.action.kind === 'communication/post')).toHaveLength(1)
  expect(h.requestModel.requests).toHaveLength(6)
  expect(h.model.requests).toHaveLength(3)
  const channel = await h.ctx.teams.readChannel({ channelId: h.channel.manifest.id, afterCursor: -1 })
  expect(channel.records.filter(record => record.type === 'channel/receipt')).toHaveLength(1)
  const world = after.world
  const { spec } = after
  await h.run.close()
  const reopened = await h.ctx.simulations.open({ provider: 'local', mode: 'open', spec })
  cleanups.push(() => reopened.close())
  expect(reopened.snapshot().world).toEqual(world)
  const revision = reopened.snapshot().revision
  expect(await reopened.commitWorldHire(h.reservation.id)).toEqual(result)
  expect(reopened.snapshot().revision).toBe(revision)
})

it.each(['json', 'sqlite'] as const)('withdraws %s Participant preparation authority when cancellation wins before or during invitation IO', async (backend) => {
  const h = await hireFixture(backend)
  const reservation = await h.run.reserveWorldHire(h.input)
  await h.connection.quiesceForMaintenance(h.input.maintenance, 4, 3)
  await h.run.prepareWorldHire(reservation.id)
  const { modelVersion: _version, ...member } = reservation.request.member
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const invite = h.ctx.teams.inviteParticipant.bind(h.ctx.teams)
  const pending = vi.spyOn(h.ctx.teams, 'inviteParticipant').mockImplementation(async (...args) => {
    entered.resolve(undefined)
    await release.promise
    return await invite(...args)
  })
  const work = h.connection.ensureParticipant(reservation.identities.entityId, member)
  const outcome = work.then(() => undefined, (error: unknown) => error)
  await entered.promise
  const queued = h.connection.ensureParticipant(reservation.identities.entityId, member)
    .then(() => undefined, (error: unknown) => error)
  await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'withdraw-invitation', requestId: h.request.id }))
  release.resolve(undefined)
  expect(await outcome).toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  expect(await queued).toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  const before = h.run.snapshot()
  await expect(async () => await h.connection.ensureParticipant(reservation.identities.entityId, member))
    .rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  expect(pending).toHaveBeenCalledTimes(1)
  const team = await h.ctx.teams.getTeam({ teamId: reservation.identities.binding.teamId })
  expect(team.participants.some(value => value.id === reservation.identities.binding.participantId)).toBe(false)
  expect(h.run.snapshot()).toEqual(before)
  expect(before.world!.reservations[reservation.id]?.status).toBe('cancel-requested')
  expect(before.entities[reservation.identities.entityId]?.binding).toBeUndefined()
  expect(before.world!.results).toEqual({})
})

it.each(['json', 'sqlite'] as const)('retains %s already-created Participant evidence after cancellation without advancing membership or binding', async (backend) => {
  const h = await hireFixture(backend)
  const reservation = await h.run.reserveWorldHire(h.input)
  await h.connection.quiesceForMaintenance(h.input.maintenance, 4, 3)
  await h.run.prepareWorldHire(reservation.id)
  const { modelVersion: _version, ...member } = reservation.request.member
  const invite = h.ctx.teams.inviteParticipant.bind(h.ctx.teams)
  vi.spyOn(h.ctx.teams, 'inviteParticipant').mockImplementation(async (...args) => {
    const target = await invite(...args)
    await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'withdraw-created-invitation', requestId: h.request.id }))
    return target
  })
  const phase = vi.spyOn(h.ctx.teams, 'transitionParticipantPhase')
  await expect(h.connection.ensureParticipant(reservation.identities.entityId, member))
    .rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  expect(phase).not.toHaveBeenCalled()
  const team = await h.ctx.teams.getTeam({ teamId: reservation.identities.binding.teamId })
  expect(team.participants.find(value => value.id === reservation.identities.binding.participantId)?.phase).toBe('invited')
  const state = h.run.snapshot()
  expect(state.entities[reservation.identities.entityId]?.binding).toBeUndefined()
  expect(state.entities[reservation.identities.entityId]?.readiness).toBe('preparing')
  expect(state.world!.reservations[reservation.id]?.identities).toEqual(reservation.identities)
  await expect(h.run.finishMaintenance(h.input.maintenance)).rejects.toThrow(/unresolved preparation/)
  await h.run.close()
  const reopened = await h.ctx.simulations.open({ provider: 'local', mode: 'open', spec: state.spec })
  cleanups.push(() => reopened.close())
  expect(reopened.snapshot().world).toEqual(state.world)
  expect(reopened.snapshot().entities[reservation.identities.entityId]).toEqual(state.entities[reservation.identities.entityId])
})

it.each(['json', 'sqlite'] as const)('withdraws %s Channel and all endpoint consent authority after cancellation while preserving original WAL responsibility', async (backend) => {
  const h = await hireFixture(backend)
  const reservation = await h.run.reserveWorldHire(h.input)
  await h.connection.quiesceForMaintenance(h.input.maintenance, 4, 3)
  await h.run.prepareWorldHire(reservation.id)
  const { modelVersion: _version, ...member } = reservation.request.member
  await h.connection.ensureParticipant(reservation.identities.entityId, member)
  const selected = reservation.identities.channels[1]
  const spec = simulationChannelSpecSchema.parse({ key: selected.key,
    members: [{ entityId: reservation.identities.entityId, role: 'member' }, { entityId: requester, role: 'requester' }], limits: {} })
  const open = h.ctx.teams.openChannel.bind(h.ctx.teams)
  const opening = vi.spyOn(h.ctx.teams, 'openChannel').mockImplementation(async (...args) => {
    const channel = await open(...args)
    await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'withdraw-created-channel', requestId: h.request.id }))
    return channel
  })
  const consent = vi.spyOn(h.ctx.teams, 'acknowledgeChannelInvitation')
  await expect(async () => await h.connection.ensureChannel(spec)).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  const before = h.run.snapshot()
  await expect(async () => await h.connection.ensureChannel(spec)).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  // The existing requester's own readiness cannot authorize consent for the cancelled hire's endpoint.
  for (const entityId of [requester, reservation.identities.entityId]) {
    await expect(h.connection.acknowledgeInvitation(entityId, selected.channelId))
      .rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  }
  const alternate = simulationChannelSpecSchema.parse({ ...spec, key: 'another-hire-channel' })
  await expect(h.run.reserveChannel(alternate, h.run.snapshot().revision)).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  expect(opening).toHaveBeenCalledTimes(1)
  expect(consent).not.toHaveBeenCalled()
  const channel = await h.ctx.teams.getChannelAdmission({ channelId: selected.channelId })
  expect(channel.channel.manifest.id).toBe(selected.channelId)
  expect(channel.invitations.every(value => value.status === 'pending')).toBe(true)
  expect(before.channelReservations![selected.key]?.confirmed).toBe(false)
  expect(h.run.snapshot()).toEqual(before)
  await expect(h.run.commitWorldHire(reservation.id)).rejects.toThrow()
  await expect(h.run.finishMaintenance(h.input.maintenance)).rejects.toThrow(/unresolved preparation/)
  expect(h.model.requests).toHaveLength(3)
})

it.each(['json', 'sqlite'] as const)('withdraws a %s already-issued endpoint consent proof when cancellation wins before Hub IO', async (backend) => {
  const h = await hireFixture(backend)
  const reservation = await h.run.reserveWorldHire(h.input)
  await h.connection.quiesceForMaintenance(h.input.maintenance, 4, 3)
  await h.run.prepareWorldHire(reservation.id)
  const { modelVersion: _version, ...member } = reservation.request.member
  await h.connection.ensureParticipant(reservation.identities.entityId, member)
  const consent = h.ctx.teams.acknowledgeChannelInvitation.bind(h.ctx.teams)
  vi.spyOn(h.ctx.teams, 'acknowledgeChannelInvitation').mockImplementation(async (...args) => {
    await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'withdraw-issued-consent', requestId: h.request.id }))
    return await consent(...args)
  })
  const channel = reservation.identities.channels[0]
  await expect(h.connection.ensureChannel(simulationChannelSpecSchema.parse({ key: channel.key,
    members: [{ entityId: reservation.identities.entityId, role: 'member' }, { entityId: director, role: 'director' }], limits: {} })))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  const admission = await h.ctx.teams.getChannelAdmission({ channelId: channel.channelId })
  expect(admission.invitations.every(value => value.status === 'pending')).toBe(true)
  expect(h.run.snapshot().channelReservations![channel.key]?.confirmed).toBe(false)
  expect(h.run.snapshot().world!.reservations[reservation.id]?.status).toBe('cancel-requested')
})

it.each((['json', 'sqlite'] as const).flatMap(backend =>
  (['absent', 'invited', 'provisioning', 'active', 'partial-channel', 'prepared'] as const).map(stage => ({ backend, stage }))))(
  'settles $backend cancellation after exact target reconciliation at preparation=$stage', async ({ backend, stage }) => {
    const h = await hireFixture(backend)
    const reservation = await h.run.reserveWorldHire(h.input)
    await h.connection.quiesceForMaintenance(h.input.maintenance, 4, 3)
    await h.run.prepareWorldHire(reservation.id)
    const id = reservation.identities.entityId
    const { modelVersion: _version, ...member } = reservation.request.member
    if (stage === 'invited') {
      const invite = h.ctx.teams.inviteParticipant.bind(h.ctx.teams)
      const lost = vi.spyOn(h.ctx.teams, 'inviteParticipant').mockImplementation(async (...args) => {
        await invite(...args)
        throw new Error('Participant response lost after durable invitation')
      })
      await expect(h.connection.ensureParticipant(id, member)).rejects.toThrow(/response lost/)
      lost.mockRestore()
    } else if (stage === 'provisioning') {
      const phase = h.ctx.teams.transitionParticipantPhase.bind(h.ctx.teams)
      const lost = vi.spyOn(h.ctx.teams, 'transitionParticipantPhase').mockImplementation(async (...args) => {
        const target = await phase(...args)
        if (target.phase === 'provisioning') throw new Error('Membership response lost after durable provisioning')
        return target
      })
      await expect(h.connection.ensureParticipant(id, member)).rejects.toThrow(/response lost/)
      lost.mockRestore()
    } else if (stage !== 'absent') await h.connection.ensureParticipant(id, member)
    if (stage === 'partial-channel' || stage === 'prepared') {
      const open = h.ctx.teams.openChannel.bind(h.ctx.teams)
      const lost = stage === 'partial-channel' ? vi.spyOn(h.ctx.teams, 'openChannel').mockImplementation(async (...args) => {
        await open(...args)
        throw new Error('Channel response lost after durable opening')
      }) : undefined
      for (const channel of reservation.identities.channels) {
        const spec = simulationChannelSpecSchema.parse({ key: channel.key, members: [{ entityId: id, role: 'member' },
          { entityId: channel.purpose === 'director' ? director : requester, role: channel.purpose }], limits: {} })
        if (lost !== undefined) { await expect(h.connection.ensureChannel(spec)).rejects.toThrow(/response lost/); break }
        await h.connection.ensureChannel(spec)
      }
      lost?.mockRestore()
    }
    const command = simulationWorldCancelRequestSchema.parse({ id: 'original-cleanup-cancel', requestId: h.request.id })
    const receipt = await h.connection.cancelWorldCase(command)
    expect(receipt.status).toBe('cancelled')
    const state = h.run.snapshot(), result = state.world!.results[receipt.resultId!]!
    const settled = state.world!.reservations[reservation.id]!
    expect(settled).toMatchObject({ identities: reservation.identities, status: 'abandoned',
      cleanup: { evidence: { binding: reservation.identities.binding, participant: stage === 'absent' ? 'absent' : 'left',
        session: 'unmaterialized' } } })
    expect(settled.cleanup!.sequence).toBe(settled.updatedSequence)
    expect(state.entities[id]).toMatchObject({ id, phase: 'terminated', readiness: 'abandoned', profile: {
      name: persona.name, description: 'A research colleague.', persona } })
    expect(result.outcome).toEqual({ kind: 'cancelled' })
    expect(state.world!.requests[h.request.id]?.status).toBe('cancelled')
    expect(state.relations[reservation.identities.relationId]).toBeUndefined()
    expect(Object.values(state.scheduledEvents).filter(value => value.id === `simulation-world-result:${result.id}`)).toHaveLength(1)
    expect(Object.values(state.scheduledEvents).filter(value => value.id === `simulation-world-first:${reservation.id}`)).toHaveLength(0)
    const team = await h.ctx.teams.getTeam({ teamId: reservation.identities.binding.teamId })
    expect(team.participants.find(value => value.id === reservation.identities.binding.participantId)?.phase)
      .toBe(stage === 'absent' ? undefined : 'left')
    expect(await h.ctx.sessionPersistence.isUnmaterialized(reservation.identities.binding.sessionId)).toBe(true)
    for (const channel of settled.cleanup!.evidence.channels) {
      if (channel.phase === 'absent') continue
      const admission = await h.ctx.teams.getChannelAdmission({ channelId: channel.channelId })
      expect(admission.channel.phase).toBe('closed')
      expect(admission.invitations.every(value => value.status !== 'pending')).toBe(true)
    }
    expect(await h.connection.cancelWorldCase(command)).toEqual(receipt)
    expect(await h.run.settleWorldHireCancellation(reservation.id)).toEqual(result)
    expect(h.run.snapshot()).toEqual(state)
    await expect(h.run.commitWorldHire(reservation.id)).rejects.toThrow()
    await h.run.finishMaintenance(h.input.maintenance)
    expect(h.run.snapshot().phase).toBe('paused')
    await h.run.setPhase('running', h.run.snapshot().revision)
    await h.run.setPhase('paused', h.run.snapshot().revision)
    const checkpoint = await h.connection.checkpoint({ id: simulationCheckpointIdSchema.parse('world-cleanup'),
      implementationVersion: 'world-cleanup/1', maxDrainRounds: 4, maxAttempts: 3 })
    expect(checkpoint.status).toBe('completed')
    const beforeRestore = h.run.snapshot(), selection = { provider: 'local', mode: 'open' as const, spec: beforeRestore.spec }
    await h.run.close()
    const restored = await h.ctx.simulationTeams.restore(selection, { id: checkpoint.request.id,
      implementationVersion: checkpoint.request.implementationVersion, maxAttempts: 3 })
    cleanups.push(() => restored.run.close())
    expect(restored.run.snapshot().world).toEqual(beforeRestore.world)
    expect(restored.run.snapshot().phase).toBe('paused')
    expect(await restored.connection.cancelWorldCase(command)).toEqual(receipt)
    expect(h.model.requests).toHaveLength(3)
    expect(h.requestModel.requests).toHaveLength(3)
  },
)

it.each((['json', 'sqlite'] as const).flatMap(backend =>
  (['channel-reply', 'membership-reply', 'native-append'] as const).map(failure => ({ backend, failure }))))(
  'retains $backend original cleanup responsibility after lost $failure and retries without repeating target effects', async ({ backend, failure }) => {
    const h = await preparedHireFixture(backend)
    const command = simulationWorldCancelRequestSchema.parse({ id: 'unknown-cleanup-cancel', requestId: h.request.id })
    const close = h.ctx.teams.closeChannel.bind(h.ctx.teams)
    const phase = h.ctx.teams.transitionParticipantPhase.bind(h.ctx.teams)
    const stream = Reflect.get(h.run, 'stream') as import('@clocky/clocky-storage').LogStream
    const append = stream.append.bind(stream)
    let lost = false
    const closing = vi.spyOn(h.ctx.teams, 'closeChannel').mockImplementation(async (...args) => {
      const result = await close(...args)
      if (failure === 'channel-reply' && !lost) { lost = true; throw new Error('Cleanup channel response lost') }
      return result
    })
    const retirement = vi.spyOn(h.ctx.teams, 'transitionParticipantPhase').mockImplementation(async (...args) => {
      const result = await phase(...args)
      if (failure === 'membership-reply' && !lost) { lost = true; throw new Error('Cleanup membership response lost') }
      return result
    })
    vi.spyOn(stream, 'append').mockImplementation(async (...args) => {
      if (failure === 'native-append' && !lost && args[1].some(value =>
        (value as { change?: { kind?: string } }).change?.kind === 'hire/abandoned')) {
        lost = true
        throw new Error('Cleanup Native append refused')
      }
      return await append(...args)
    })
    await expect(h.connection.cancelWorldCase(command)).rejects.toThrow(/response lost|append refused/)
    const pending = h.run.snapshot()
    expect(pending.world!.reservations[h.reservation.id]).toMatchObject({ status: 'cancel-requested', identities: h.reservation.identities })
    expect(pending.world!.reservations[h.reservation.id]?.cleanup).toBeUndefined()
    expect(pending.entities[h.reservation.identities.entityId]?.readiness).toBe('preparing')
    expect(pending.world!.results).toEqual({})
    await expect(h.run.finishMaintenance(h.input.maintenance)).rejects.toThrow(/unresolved preparation/)
    await expect(h.run.commitWorldHire(h.reservation.id)).rejects.toThrow()
    const receipt = await h.connection.cancelWorldCase(command)
    expect(receipt.status).toBe('cancelled')
    expect(closing).toHaveBeenCalledTimes(2)
    expect(retirement).toHaveBeenCalledTimes(1)
    expect(h.run.snapshot().world!.reservations[h.reservation.id]?.identities).toEqual(h.reservation.identities)
    const settled = h.run.snapshot()
    expect(Object.values(settled.world!.results)).toHaveLength(1)
    expect(await h.connection.cancelWorldCase(command)).toEqual(receipt)
    expect(h.run.snapshot()).toEqual(settled)
    expect(h.model.requests).toHaveLength(3)
  },
)

it.each((['json', 'sqlite'] as const).flatMap(backend => [true, false].map(cancelFirst => ({ backend, cancelFirst }))))(
  'linearizes $backend cancel/commit with cancelFirst=$cancelFirst and preserves exactly one business terminal', async ({ backend, cancelFirst }) => {
    const h = await preparedHireFixture(backend)
    const command = simulationWorldCancelRequestSchema.parse({ id: 'competing-cleanup-cancel', requestId: h.request.id })
    const closing = vi.spyOn(h.ctx.teams, 'closeChannel')
    const retirement = vi.spyOn(h.ctx.teams, 'transitionParticipantPhase')
    const commit = () => h.run.commitWorldHire(h.reservation.id).then(result => ({ result }), (error: unknown) => ({ error }))
    const [receipt, committed] = cancelFirst
      ? await Promise.all([h.connection.cancelWorldCase(command), commit()])
      : await (async () => {
        const first = commit(), cancelled = h.connection.cancelWorldCase(command)
        return await Promise.all([cancelled, first])
      })()
    const state = h.run.snapshot(), result = Object.values(state.world!.results)[0]!
    expect(Object.values(state.world!.results)).toHaveLength(1)
    expect(receipt.status).toBe(cancelFirst ? 'cancelled' : 'already-committed')
    expect(result.outcome.kind).toBe(cancelFirst ? 'cancelled' : 'committed')
    expect(Object.values(state.relations).filter(value => value.relation === 'assignment' && value.object === 'position')).toHaveLength(cancelFirst ? 0 : 1)
    expect(state.world!.reservations[h.reservation.id]?.status).toBe(cancelFirst ? 'abandoned' : 'committed')
    if (cancelFirst) expect(committed).toHaveProperty('error')
    else { expect(committed).toEqual({ result }); expect(closing).not.toHaveBeenCalled(); expect(retirement).not.toHaveBeenCalled() }
    expect(await h.connection.cancelWorldCase(command)).toEqual(receipt)
    expect(h.run.snapshot()).toEqual(state)
  },
)

it.each(['json', 'sqlite'] as const)('requires a live canonical %s cleanup owner and settles original pending commands without identity rewriting', async (backend) => {
  const h = await preparedHireFixture(backend)
  const first = simulationWorldCancelRequestSchema.parse({ id: 'first-cleanup-command', requestId: h.request.id })
  const second = simulationWorldCancelRequestSchema.parse({ id: 'second-cleanup-command', requestId: h.request.id })
  const pendingFirst = await h.run.cancelWorldCase(first), pendingSecond = await h.run.cancelWorldCase(second)
  expect(pendingFirst.status).toBe('cancel-requested')
  expect(pendingSecond.status).toBe('cancel-requested')
  expect(() => h.run.onWorldHireCleanup('foreign-owner', async () => { throw new Error('Foreign source must never run') }))
    .toThrow(/owner/)
  expect(() => h.run.onWorldHireCleanup('simulation/world-company', async () => { throw new Error('Duplicate source must never run') }))
    .toThrow(/owner|already/)
  await h.connection.close()
  const before = h.run.snapshot()
  await expect(h.run.settleWorldHireCancellation(h.reservation.id)).rejects.toThrow(/owner/)
  expect(h.run.snapshot()).toEqual(before)
  const connection = await h.ctx.simulationTeams.attach(h.run, h.reservation.identities.binding.teamId, 'simulation/world-company')
  const receipt = await connection.cancelWorldCase(second)
  expect(receipt.status).toBe('already-resolved')
  const original = await h.run.cancelWorldCase(first)
  expect(original.status).toBe('cancelled')
  expect(original.sequence).toBe(pendingFirst.sequence)
  expect(receipt.sequence).toBe(pendingSecond.sequence)
  expect(receipt.resultId).toBe(original.resultId)
})

it.each(['json', 'sqlite'] as const)('drains %s unknown accepted preparation before proving absence and leaves the Native queue usable', async (backend) => {
  const h = await hireFixture(backend)
  const reservation = await h.run.reserveWorldHire(h.input)
  await h.connection.quiesceForMaintenance(h.input.maintenance, 4, 3)
  await h.run.prepareWorldHire(reservation.id)
  const { modelVersion: _version, ...member } = reservation.request.member
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const invite = h.ctx.teams.inviteParticipant.bind(h.ctx.teams)
  vi.spyOn(h.ctx.teams, 'inviteParticipant').mockImplementation(async (...args) => {
    entered.resolve(undefined)
    await release.promise
    return await invite(...args)
  })
  const preparation = h.connection.ensureParticipant(reservation.identities.entityId, member)
    .then(() => undefined, (error: unknown) => error)
  await entered.promise
  const command = simulationWorldCancelRequestSchema.parse({ id: 'draining-cleanup-command', requestId: h.request.id })
  const pending = await h.run.cancelWorldCase(command)
  expect(pending.status).toBe('cancel-requested')
  let completed = false
  const cancellation = h.connection.cancelWorldCase(command).then((receipt) => { completed = true; return receipt })
  try {
    const second = await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'during-cleanup-command', requestId: h.request.id }))
    expect(second.status).toBe('cancel-requested')
    const reference = await h.run.getPersistenceReference(h.run.snapshot().revision)
    expect(reference.cursor).toBe(h.run.snapshot().revision)
    expect(completed).toBe(false)
    expect(h.run.snapshot().world!.reservations[reservation.id]?.status).toBe('cancel-requested')
    expect(h.run.snapshot().world!.results).toEqual({})
  } finally { release.resolve(undefined) }
  expect(await preparation).toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  expect((await cancellation).status).toBe('cancelled')
  expect(h.run.snapshot().world!.reservations[reservation.id]?.cleanup?.evidence.participant).toBe('absent')
  expect((await h.ctx.teams.getTeam({ teamId: reservation.identities.binding.teamId })).participants
    .some(value => value.id === reservation.identities.binding.participantId)).toBe(false)
})

it.each(['json', 'sqlite'] as const)('releases proven %s hire occupancy for a new real application while retaining every original identity', async (backend) => {
  const h = await hireFixture(backend, { spec: { maxEntities: 6 } })
  const reservation = await h.run.reserveWorldHire(h.input)
  await h.connection.quiesceForMaintenance(h.input.maintenance, 4, 3)
  await h.run.prepareWorldHire(reservation.id)
  const cancelled = await h.connection.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'release-occupancy', requestId: h.request.id }))
  expect(cancelled.status).toBe('cancelled')
  await h.run.finishMaintenance(h.input.maintenance)
  const next = await seedHiringIntent(h.run, { ...hiringIntentFields(h.intent), applicationId: 'explicit-new-application' }, 'A new independent application after confirmed cleanup.')
  const requestModel = new MockAdapter(h.calls('next-request', () => ({ kind: 'world/request', domain: 'organization', operation: 'generate-and-hire', version: '1',
    businessKey: hiringIntentFields(next).applicationId, expectedTime: null, evidence: [], payload: {
      organizationEntityId: hiringIntentFields(next).organizationEntityId, positionEntityId: hiringIntentFields(next).positionEntityId,
      ...hiringIntentFields(next).priorRequestId === undefined ? {} : { priorRequestId: hiringIntentFields(next).priorRequestId },
      description: 'A new independent application after confirmed cleanup.' } })))
  let requestId = h.request.id
  const directorModel = new MockAdapter(h.calls('next-plan', () => ({ ...h.plan.proposal, requestId, supersedes: null })))
  h.ctx.llm.registerAdapter(['next-requester'], requestModel)
  h.ctx.llm.registerAdapter(['next-director'], directorModel)
  await h.connection.resume(requester, { provider: 'in-process', agent: { options: { provider: 'next-requester', model: 'scripted' } },
    signal: new AbortController().signal })
  await h.connection.resume(director, { provider: 'in-process', agent: { options: { provider: 'next-director', model: 'scripted' } },
    signal: new AbortController().signal })
  await h.run.setPhase('running', h.run.snapshot().revision)
  await h.run.executeOperation(h.decision.operationIds[0]!)
  await h.run.drive({ until: simTimeSchema.parse('0') })
  const resultWake = Object.values(h.run.snapshot().wakes).find(value => value.entityId === requester && value.status === 'pending')!
  await h.connection.executeDecision(requester, simulationDecisionIdSchema.parse('next-application-request'),
    { ...contextRequest(), world: { kind: 'request', intentId: next.id } }, resultWake.eventId)
  const request = Object.values(h.run.snapshot().world!.requests).find(value => value.intentId === next.id)!
  requestId = request.id
  await h.run.collectDecisionWakes({ until: simTimeSchema.parse('0') })
  assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
  await h.connection.dispatchOperation(request.notificationOperationId, () => 100)
  assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
  const wake = await h.connection.receiveOperation(request.notificationOperationId)
  await h.run.drive({ until: simTimeSchema.parse('0') })
  expect(h.run.snapshot().wakes[wake]?.status).toBe('pending')
  await h.connection.executeDecision(director, simulationDecisionIdSchema.parse('next-application-plan'),
    { ...contextRequest(), world: { kind: 'resolve', requestId } }, wake)
  const plan = Object.values(h.run.snapshot().world!.plans).find(value => value.requestId === requestId)!
  const fresh = await h.run.reserveWorldHire({ ...h.input, planId: plan.id,
    maintenance: { ...h.input.maintenance, id: (await import('@clocky/clocky-simulation')).simulationMaintenanceIdSchema.parse('new-hire-owner') } })
  expect(fresh.status).toBe('reserved')
  expect(fresh.id).not.toBe(reservation.id)
  expect(fresh.identities.entityId).not.toBe(reservation.identities.entityId)
  expect(fresh.identities.binding.participantId).not.toBe(reservation.identities.binding.participantId)
  expect(fresh.identities.binding.sessionId).not.toBe(reservation.identities.binding.sessionId)
  expect(fresh.identities.channels.some(value => reservation.identities.channels.some(original =>
    original.channelId === value.channelId))).toBe(false)
  expect(h.run.snapshot().world!.reservations[reservation.id]?.identities).toEqual(reservation.identities)
  expect(h.run.snapshot().entities[reservation.identities.entityId]?.phase).toBe('terminated')
  expect(requestModel.requests).toHaveLength(3)
  expect(directorModel.requests).toHaveLength(3)
})

it.each(['json', 'sqlite'] as const)('refuses %s writable restore when original terminal cleanup evidence cannot be read', async (backend) => {
  const h = await preparedHireFixture(backend)
  const receipt = await h.connection.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'cleanup-restore-proof', requestId: h.request.id }))
  await h.run.finishMaintenance(h.input.maintenance)
  const checkpoint = await h.connection.checkpoint({ id: simulationCheckpointIdSchema.parse('cleanup-restore-proof'),
    implementationVersion: 'world-cleanup/1', maxDrainRounds: 4, maxAttempts: 3 })
  expect(checkpoint.status).toBe('completed')
  const original = h.run.snapshot(), selection = { provider: 'local', mode: 'open' as const, spec: original.spec }
  await h.run.close()
  const { TeamError } = await import('@clocky/clocky-team')
  const read = h.ctx.teams.getChannelAdmission.bind(h.ctx.teams)
  const missing = vi.spyOn(h.ctx.teams, 'getChannelAdmission').mockImplementation(async (request) => {
    if (request.channelId === h.reservation.identities.channels[0].channelId) {
      throw new TeamError('Original cleanup channel history unavailable', 'TEAM_CHANNEL_NOT_FOUND')
    }
    return await read(request)
  })
  await expect(h.ctx.simulationTeams.restore(selection, { id: checkpoint.request.id,
    implementationVersion: checkpoint.request.implementationVersion, maxAttempts: 3 })).rejects.toThrow(/cleanup history/)
  missing.mockRestore()
  const reopened = await h.ctx.simulations.open(selection)
  cleanups.push(() => reopened.close())
  expect(reopened.snapshot().world).toEqual(original.world)
  expect(reopened.snapshot().world!.results[receipt.resultId!]?.outcome).toEqual({ kind: 'cancelled' })
  expect(h.model.requests).toHaveLength(3)
})

it.each(['json', 'sqlite'] as const)('settles %s additional cancellation intent admitted while membership cleanup IO is unknown', async (backend) => {
  const h = await preparedHireFixture(backend)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const phase = h.ctx.teams.transitionParticipantPhase.bind(h.ctx.teams)
  vi.spyOn(h.ctx.teams, 'transitionParticipantPhase').mockImplementation(async (...args) => {
    const member = await phase(...args)
    entered.resolve(undefined)
    await release.promise
    return member
  })
  const first = simulationWorldCancelRequestSchema.parse({ id: 'first-inflight-cancel', requestId: h.request.id })
  const second = simulationWorldCancelRequestSchema.parse({ id: 'later-inflight-cancel', requestId: h.request.id })
  const completing = h.connection.cancelWorldCase(first)
  await entered.promise
  let pending: Awaited<ReturnType<typeof h.run.cancelWorldCase>>
  try {
    pending = await h.run.cancelWorldCase(second)
    expect(pending.status).toBe('cancel-requested')
    expect(h.run.snapshot().world!.results).toEqual({})
  } finally { release.resolve(undefined) }
  const receipt = await completing
  expect(receipt.status).toBe('cancelled')
  const later = await h.run.cancelWorldCase(second)
  expect(later.status).toBe('already-resolved')
  expect(later.sequence).toBe(pending.sequence)
  expect(later.resultId).toBe(receipt.resultId)
})

async function committedTerminalFixture(backend: 'json' | 'sqlite', revoke = false) {
  const h = await preparedHireFixture(backend)
  const organization = h.run.snapshot().entities[simulationEntityIdSchema.parse('organization')]!
  await h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: organization.id,
    entityRevision: organization.revision, profile: { name: 'Research organization', description: 'Public research work.',
      internalMemo: 'An unrelated private organization memo.' } }), h.run.snapshot().revision)
  const result = await h.run.commitWorldHire(h.reservation.id)
  if (revoke) await changeHireAuthorization(h, true)
  await h.run.finishMaintenance(h.input.maintenance)
  const { simulationEventIdSchema } = await import('@clocky/clocky-simulation')
  return { ...h, result, newcomer: h.reservation.identities.entityId,
    firstWake: simulationEventIdSchema.parse(`simulation-world-first:${h.intent.id}`),
    resultWake: simulationEventIdSchema.parse(`simulation-world-result:${result.id}`) }
}

function terminalNotification(h: { run: import('@clocky/clocky-simulation').SimulationRun },
  id: import('@clocky/clocky-simulation').SimulationDecisionId) {
  const context = h.run.snapshot().decisions[id]?.context
  if (context?.status !== 'prepared' || context.world?.kind !== 'result') throw new Error('Expected the original prepared result notification')
  return context.world.notification
}

async function activateTerminalActors(h: Awaited<ReturnType<typeof committedTerminalFixture>>,
  resultModel: MockAdapter, firstModel: MockAdapter, prefix: string) {
  h.ctx.llm.registerAdapter([`${prefix}-result`], resultModel)
  h.ctx.llm.registerAdapter([`${prefix}-first`], firstModel)
  const requesterLease = await h.connection.resume(requester, { provider: 'in-process',
    agent: { options: { provider: `${prefix}-result`, model: 'scripted' } }, signal: new AbortController().signal })
  const firstLease = await h.connection.activate(h.newcomer, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: { provider: `${prefix}-first`, model: 'scripted' } }, signal: new AbortController().signal })
  await h.run.setPhase('running', h.run.snapshot().revision)
  await h.run.executeOperation(h.decision.operationIds[0]!)
  await h.run.collectDecisionWakes({ until: simTimeSchema.parse('0') })
  return { requesterLease, firstLease }
}

async function assertTerminalConsumption(run: import('@clocky/clocky-simulation').SimulationRun,
  decision: import('@clocky/clocky-simulation').SimulationDecision, agent: import('@clocky/clocky-agent').Agent) {
  const { simulationContextConsumptionHash, simulationContextConsumptionSchema } = await import('@clocky/clocky-simulation')
  const { MessageId } = await import('@clocky/clocky-llm')
  const { assertBusinessProjection } = await import('../../simulation-local/src/decisions.ts')
  expect(decision.context?.status).toBe('prepared')
  if (decision.context?.status !== 'prepared') throw new Error('Expected a prepared terminal decision')
  const view = decision.context.view, receipt = decision.consumption!
  const recorded = agent.session.events.filter(event => event.type === 'simulation/context-view' && event.data.inputId === view.inputId)
  const entered = agent.session.events.filter(event => event.type === 'user/message' && event.surfaceOp === 'append'
    && event.data.id === MessageId(view.inputId))
  expect(recorded).toHaveLength(1)
  expect(entered).toHaveLength(1)
  expect(receipt).toEqual({ sessionId: agent.session.id, inputId: view.inputId,
    viewSequence: recorded[0]!.seq, consumedSequence: entered[0]!.seq, contextHash: simulationContextConsumptionHash(view) })
  expect(agent.session.events.flatMap(event => event.type === 'tool/call' && event.seq > receipt.consumedSequence ? [event.data.name] : []))
    .toEqual(['simulation_observe', 'simulation_stage', 'simulation_submit'])
  for (const patch of [{ inputId: 'another-terminal-input' }, { contextHash: '0'.repeat(64) },
    { sessionId: 'another-terminal-session' }, { notification: { operationId: 'another-notification', consumedSequence: receipt.consumedSequence } }]) {
    const state = run.snapshot()
    const invalid = { ...state, decisions: { ...state.decisions,
      [decision.id]: { ...decision, consumption: simulationContextConsumptionSchema.parse({ ...receipt, ...patch }) } } }
    expect(() => { assertBusinessProjection(invalid, projectionRuntime) }).toThrow(/exact context and canonical Session/)
  }
}

it.each(['json', 'sqlite'] as const)('authorizes %s exact terminal window inputs through three tools after the hiring grant is withdrawn', async (backend) => {
  const h = await committedTerminalFixture(backend, true)
  const { simulationProposalSchema, simulationWindowIdSchema, worldResultNotification } = await import('@clocky/clocky-simulation')
  const resultId = simulationDecisionIdSchema.parse('terminal-window-result'), firstId = simulationDecisionIdSchema.parse('terminal-window-first')
  const firstAction = { kind: 'communication/post', recipient: requester, channelId: h.reservation.identities.channels[1].channelId,
    text: 'I am Lin. I can help with analysis and research.', deliverAt: '0' }
  const resultModel = new MockAdapter(h.calls('terminal-result', () => terminalNotification(h, resultId)))
  const firstModel = new MockAdapter(h.calls('terminal-first', () => firstAction))
  const actors = await activateTerminalActors(h, resultModel, firstModel, 'terminal-window')
  const world = h.run.snapshot().world
  const resultContext = { ...contextRequest(), world: { kind: 'result' as const, resultId: h.result.id } }
  const firstContext = { ...contextRequest(), world: { kind: 'first-action' as const, resultId: h.result.id } }
  const window = await h.connection.openWindow({ id: simulationWindowIdSchema.parse('terminal-notifications'), decisions: [
    { id: resultId, entityId: requester, wakeId: h.resultWake, context: resultContext },
    { id: firstId, entityId: h.newcomer, wakeId: h.firstWake, context: firstContext },
  ] })
  await expect(h.connection.submitDecision(requester, resultId,
    [simulationProposalSchema.parse({ after: [], action: terminalNotification(h, resultId) })]))
    .rejects.toMatchObject({ code: 'SIM_WORLD_CONTEXT' })
  await expect(h.connection.submitDecision(h.newcomer, firstId,
    [simulationProposalSchema.parse({ after: [], action: firstAction })])).rejects.toMatchObject({ code: 'SIM_WORLD_CONTEXT' })
  expect(resultModel.requests).toHaveLength(0)
  expect(firstModel.requests).toHaveLength(0)
  expect((await h.connection.executeDecision(requester, resultId, resultContext, h.resultWake)).status).toBe('submitted')
  expect((await h.connection.executeDecision(h.newcomer, firstId, firstContext, h.firstWake)).status).toBe('submitted')
  await h.run.commitWindow(window.id)
  const state = h.run.snapshot(), first = state.decisions[firstId]!, notification = state.decisions[resultId]!
  expect(first.status).toBe('accepted')
  expect(notification.status).toBe('accepted')
  expect(notification.context?.status === 'prepared' && notification.context.world).toMatchObject({ kind: 'result', resultId: h.result.id,
    notification: { kind: 'communication/post', recipient: h.newcomer, channelId: h.reservation.identities.channels[1].channelId,
      text: worldResultNotification(h.result), deliverAt: '0' } })
  for (const decision of [first, notification]) {
    expect(decision.context?.status === 'prepared' && decision.context.world).not.toHaveProperty('reads')
    const view = decision.context?.status === 'prepared' ? decision.context.view : undefined
    expect(view?.sources).toContainEqual({ kind: 'run-event', runId: state.spec.runId, sequence: h.result.sequence })
    const text = JSON.stringify(view)
    expect(text).toContain('Public research work.')
    expect(text).toContain('A research colleague.')
    expect(text).toContain('analysis')
    expect(text).not.toContain('Private director assessment')
    expect(text).not.toContain('unrelated private organization memo')
    expect(text).not.toContain('team-envelope')
  }
  await assertTerminalConsumption(h.run, first, actors.firstLease.localAgent!)
  await assertTerminalConsumption(h.run, notification, actors.requesterLease.localAgent!)
  const before = h.run.snapshot()
  for (const action of [{ ...firstAction, recipient: director },
    { ...firstAction, channelId: h.reservation.identities.channels[0].channelId }]) {
    await expect(h.connection.submitDecision(h.newcomer, firstId,
      [simulationProposalSchema.parse({ after: [], action })])).rejects.toMatchObject({ code: 'SIM_WORLD_AUTHORITY' })
  }
  expect(h.run.snapshot()).toEqual(before)
  await h.run.drive({ until: simTimeSchema.parse('0') })
  for (const operationId of [...notification.operationIds, ...first.operationIds]) {
    await h.connection.dispatchOperation(operationId, () => 100)
    await h.connection.receiveOperation(operationId)
    await h.run.drive({ until: simTimeSchema.parse('0') })
    expect(h.run.snapshot().operations[operationId]?.delivery?.receipt).toBeDefined()
  }
  const channel = await h.ctx.teams.readChannel({ channelId: h.reservation.identities.channels[1].channelId, afterCursor: -1 })
  expect(channel.records.filter(record => record.type === 'channel/envelope')).toHaveLength(2)
  expect(channel.records.filter(record => record.type === 'channel/receipt')).toHaveLength(2)
  expect(h.run.snapshot().world).toEqual(world)
  expect(resultModel.requests).toHaveLength(3)
  expect(firstModel.requests).toHaveLength(3)
  expect(h.requestModel.requests).toHaveLength(3)
  expect(h.model.requests).toHaveLength(3)
})

it.each(['json', 'sqlite'] as const)('refuses %s terminal contexts for wrong actors, purposes, result identities or missing original wakes', async (backend) => {
  const h = await committedTerminalFixture(backend)
  const resultModel = new MockAdapter([]), firstModel = new MockAdapter([])
  await activateTerminalActors(h, resultModel, firstModel, 'terminal-selection')
  const { worldResultIdSchema } = await import('@clocky/clocky-simulation')
  const before = h.run.snapshot(), absent = worldResultIdSchema.parse('result-not-retained')
  await expect(h.connection.openDecision(h.newcomer, simulationDecisionIdSchema.parse('wrong-result-actor'), h.resultWake))
    .rejects.toThrow(/does not own a pending scheduled wake/)
  await expect(h.connection.openDecision(requester, simulationDecisionIdSchema.parse('wrong-first-actor'), h.firstWake))
    .rejects.toThrow(/does not own a pending scheduled wake/)
  expect(h.run.snapshot()).toEqual(before)
  const attempts = [
    { label: 'result-without-wake', actor: requester, wake: undefined, kind: 'result' as const, resultId: h.result.id, code: 'SIM_WORLD_AUTHORITY' },
    { label: 'first-without-wake', actor: h.newcomer, wake: undefined, kind: 'first-action' as const,
      resultId: h.result.id, code: 'SIM_WORLD_AUTHORITY' },
    { label: 'result-wrong-id', actor: requester, wake: h.resultWake, kind: 'result' as const, resultId: absent, code: 'SIM_WORLD_CONFLICT' },
    { label: 'first-wrong-id', actor: h.newcomer, wake: h.firstWake, kind: 'first-action' as const, resultId: absent, code: 'SIM_WORLD_CONFLICT' },
    { label: 'result-as-first', actor: requester, wake: h.resultWake, kind: 'first-action' as const,
      resultId: h.result.id, code: 'SIM_WORLD_AUTHORITY' },
    { label: 'first-as-result', actor: h.newcomer, wake: h.firstWake, kind: 'result' as const, resultId: h.result.id, code: 'SIM_WORLD_AUTHORITY' },
  ]
  for (const attempt of attempts) {
    const id = simulationDecisionIdSchema.parse(attempt.label)
    await h.connection.openDecision(attempt.actor, id, attempt.wake)
    await expect(h.connection.prepareContext(attempt.actor, id,
      { ...contextRequest(), world: { kind: attempt.kind, resultId: attempt.resultId } })).rejects.toMatchObject({ code: attempt.code })
    expect(h.run.snapshot().decisions[id]?.context).toBeUndefined()
    await h.connection.cancelDecision(attempt.actor, id)
    expect(h.run.snapshot().world).toEqual(before.world)
  }
  expect(h.run.snapshot().operations).toEqual(before.operations)
  expect(h.run.snapshot().wakes[h.resultWake]?.status).toBe('pending')
  expect(h.run.snapshot().wakes[h.firstWake]?.status).toBe('pending')
  expect(resultModel.requests).toHaveLength(0)
  expect(firstModel.requests).toHaveLength(0)
})

it.each(['json', 'sqlite'] as const)('refuses %s altered result notification content, recipient, Channel, time, outcome or dependencies at Native submission', async (backend) => {
  const h = await committedTerminalFixture(backend, true)
  const { simulationProposalSchema } = await import('@clocky/clocky-simulation')
  const { textResponse } = await import('../../../core/agent-loop/tests/mock-adapter.ts')
  const id = simulationDecisionIdSchema.parse('malformed-terminal-notification')
  const resultModel = new MockAdapter([...h.calls('malformed-result', () => ({ ...terminalNotification(h, id),
    text: 'Already hired: an invented public explanation.' })), textResponse('The private notification was refused.')])
  const firstAction = { kind: 'communication/post', recipient: requester, channelId: h.reservation.identities.channels[1].channelId,
    text: 'I am Lin and can help with research.', deliverAt: '0' }
  const firstModel = new MockAdapter(h.calls('serial-terminal-first', () => firstAction))
  const actors = await activateTerminalActors(h, resultModel, firstModel, 'malformed-terminal')
  const context = { ...contextRequest(), world: { kind: 'result' as const, resultId: h.result.id } }
  await expect(h.connection.executeDecision(requester, id, context, h.resultWake)).rejects.toThrow(/without submitting/)
  const decision = h.run.snapshot().decisions[id]!, original = terminalNotification(h, id), before = h.run.snapshot()
  expect(decision.status).toBe('open')
  await assertTerminalConsumption(h.run, decision, actors.requesterLease.localAgent!)
  const changed = [
    { after: [], action: { ...original, text: `${original.text} An invented public explanation.` } },
    { after: [], action: { ...original, recipient: director } },
    { after: [], action: { ...original, channelId: h.channel.manifest.id } },
    { after: [], action: { ...original, deliverAt: '1' } },
    { after: [], action: { ...original, text: JSON.stringify({ resultId: h.result.id, outcome: { kind: 'cancelled' } }) } },
    { after: [h.request.operationId], action: original },
    { after: [], action: h.requestAction },
  ]
  for (const proposal of changed) {
    await expect(h.connection.submitDecision(requester, id, [simulationProposalSchema.parse(proposal)]))
      .rejects.toMatchObject({ code: 'SIM_WORLD_AUTHORITY' })
    expect(h.run.snapshot()).toEqual(before)
  }
  expect(resultModel.requests).toHaveLength(4)
  expect(firstModel.requests).toHaveLength(0)
  await h.connection.cancelDecision(requester, id)
  await h.connection.hibernate(requester)
  const repairedId = simulationDecisionIdSchema.parse('repaired-terminal-notification')
  const repairedModel = new MockAdapter(h.calls('repaired-result', () => terminalNotification(h, repairedId)))
  h.ctx.llm.registerAdapter(['repaired-terminal-result'], repairedModel)
  const repaired = await h.connection.resume(requester, { provider: 'in-process',
    agent: { options: { provider: 'repaired-terminal-result', model: 'scripted' } }, signal: new AbortController().signal })
  const first = await h.connection.executeDecision(h.newcomer, simulationDecisionIdSchema.parse('serial-terminal-first'),
    { ...contextRequest(), world: { kind: 'first-action', resultId: h.result.id } }, h.firstWake)
  expect(first.status).toBe('accepted')
  expect(h.run.snapshot().operations[first.operationIds[0]!]?.action).toEqual(firstAction)
  await assertTerminalConsumption(h.run, first, actors.firstLease.localAgent!)
  const accepted = await h.connection.executeDecision(requester, repairedId, context, h.resultWake)
  expect(accepted.status).toBe('accepted')
  expect(h.run.snapshot().operations[accepted.operationIds[0]!]?.action).toEqual(original)
  expect(h.run.snapshot().world).toEqual(before.world)
  await assertTerminalConsumption(h.run, accepted, repaired.localAgent!)
  expect(repairedModel.requests).toHaveLength(3)
  expect(firstModel.requests).toHaveLength(3)
})

it.each(['json', 'sqlite'] as const)('allows %s unscoped director private communication through three tools but rejects world and resource effects', async (backend) => {
  const h = await fixture(backend)
  const { simulationProposalSchema } = await import('@clocky/clocky-simulation')
  const { textResponse } = await import('../../../core/agent-loop/tests/mock-adapter.ts')
  const note = { kind: 'communication/post', recipient: requester, channelId: h.channel.manifest.id,
    text: 'Please clarify the research responsibilities.', deliverAt: '0' }
  const model = new MockAdapter([...h.calls('ordinary-director-note', () => note),
    ...h.calls('ordinary-director-world', () => h.requestAction), textResponse('The world effect was refused.')])
  h.ctx.llm.registerAdapter(['ordinary-terminal-director'], model)
  const lease = await h.connection.activate(director, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: { provider: 'ordinary-terminal-director', model: 'scripted' } }, signal: new AbortController().signal })
  await h.run.setPhase('running', h.run.snapshot().revision)
  const world = h.run.snapshot().world
  const accepted = await h.connection.executeDecision(director, simulationDecisionIdSchema.parse('ordinary-terminal-director-note'), contextRequest())
  expect(accepted.status).toBe('accepted')
  expect(accepted.context?.status === 'prepared' && accepted.context.world).toBeUndefined()
  expect(h.run.snapshot().operations[accepted.operationIds[0]!]?.action).toEqual(note)
  await h.run.drive({ until: simTimeSchema.parse('0') })
  await h.connection.dispatchOperation(accepted.operationIds[0]!, () => 100)
  await h.connection.receiveOperation(accepted.operationIds[0]!)
  await h.run.drive({ until: simTimeSchema.parse('0') })
  expect(h.run.snapshot().operations[accepted.operationIds[0]!]?.delivery?.receipt).toBeDefined()
  const deniedId = simulationDecisionIdSchema.parse('ordinary-terminal-director-world')
  await expect(h.connection.executeDecision(director, deniedId, contextRequest())).rejects.toThrow(/without submitting/)
  const before = h.run.snapshot()
  for (const action of [h.requestAction, { kind: 'world/resolve', requestId: 'unretained-request', supersedes: null,
    resolution: rejectedResolution }, { kind: 'resource/revoke-grant', id: 'unretained-grant', expectedRevision: 1 }]) {
    await expect(h.connection.submitDecision(director, deniedId, [simulationProposalSchema.parse({ after: [], action })]))
      .rejects.toMatchObject({ code: 'SIM_WORLD_AUTHORITY' })
    expect(h.run.snapshot()).toEqual(before)
  }
  expect(lease.localAgent!.session.events.filter(event => event.type === 'tool/call').map(event => event.data.name))
    .toEqual(['simulation_observe', 'simulation_stage', 'simulation_submit', 'simulation_observe', 'simulation_stage', 'simulation_submit'])
  expect(model.requests).toHaveLength(7)
  expect(h.requestModel.requests).toHaveLength(0)
  expect(h.run.snapshot().world).toEqual(world)
  await h.connection.cancelDecision(director, deniedId)
})

it.each((['json', 'sqlite'] as const).flatMap(backend => (['rejected', 'cancelled'] as const).map(outcome => ({ backend, outcome }))))(
  'notifies the original director of a $backend $outcome result through three tools without disclosing private rationale', async ({ backend, outcome }) => {
    const h = await caseFixture(backend, outcome === 'rejected' ? rejectedResolution : undefined)
    const { simulationEventIdSchema, simulationProposalSchema, worldResultNotification } = await import('@clocky/clocky-simulation')
    if (outcome === 'rejected') {
      const plan = await h.connection.executeDecision(director, simulationDecisionIdSchema.parse('terminal-rejected-plan'), h.context, h.wake)
      await h.run.executeOperation(plan.operationIds[0]!)
    } else {
      await h.connection.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'terminal-cancelled-case', requestId: h.request.id }))
    }
    const result = Object.values(h.run.snapshot().world!.results)[0]!
    const grant = Object.values(h.run.snapshot().relations).find(relation => relation.relation === 'can-hire')!
    const { revision, ...fields } = grant
    await h.run.change(simulationChangeSchema.parse({ kind: 'relation/update', ...fields,
      relationRevision: revision, validFrom: '1', validUntil: '100' }), h.run.snapshot().revision)
    const id = simulationDecisionIdSchema.parse(`terminal-${outcome}-notification`)
    const model = new MockAdapter(h.calls(`${outcome}-result-notification`, () => terminalNotification(h, id)))
    h.ctx.llm.registerAdapter(['terminal-original-director-result'], model)
    await h.connection.hibernate(requester)
    const lease = await h.connection.resume(requester, { provider: 'in-process',
      agent: { options: { provider: 'terminal-original-director-result', model: 'scripted' } }, signal: new AbortController().signal })
    await h.run.collectDecisionWakes({ until: simTimeSchema.parse('0') })
    const wake = simulationEventIdSchema.parse(`simulation-world-result:${result.id}`)
    const impossible = simulationDecisionIdSchema.parse(`terminal-${outcome}-first-action`)
    await h.connection.openDecision(requester, impossible, wake)
    await expect(h.connection.prepareContext(requester, impossible,
      { ...contextRequest(), world: { kind: 'first-action', resultId: result.id } })).rejects.toMatchObject({ code: 'SIM_WORLD_AUTHORITY' })
    await h.connection.cancelDecision(requester, impossible)
    const context = { ...contextRequest(), world: { kind: 'result' as const, resultId: result.id } }
    const accepted = await h.connection.executeDecision(requester, id, context, wake)
    expect(accepted.status).toBe('accepted')
    const notification = terminalNotification(h, id)
    expect(notification).toEqual({ kind: 'communication/post', recipient: director, channelId: h.channel.manifest.id,
      text: worldResultNotification(result), deliverAt: '0' })
    expect(JSON.parse(notification.text)).toEqual({ resultId: result.id, outcome: result.outcome, payload: result.payload })
    expect(JSON.stringify(accepted.context)).not.toContain(rejectedResolution.rationale)
    const world = h.run.snapshot().world
    await assertTerminalConsumption(h.run, accepted, lease.localAgent!)
    await expect(h.connection.submitDecision(requester, id,
      [simulationProposalSchema.parse({ after: [], action: { ...notification,
        text: JSON.stringify({ resultId: result.id, outcome: { kind: 'committed', entityId: requester, relationId: grant.id } }) } })]))
      .rejects.toMatchObject({ code: 'SIM_WORLD_AUTHORITY' })
    await h.run.drive({ until: simTimeSchema.parse('0') })
    await h.connection.dispatchOperation(accepted.operationIds[0]!, () => 100)
    await h.connection.receiveOperation(accepted.operationIds[0]!)
    await h.run.drive({ until: simTimeSchema.parse('0') })
    expect(h.run.snapshot().operations[accepted.operationIds[0]!]?.delivery?.receipt).toBeDefined()
    expect(h.run.snapshot().world).toEqual(world)
    expect(Object.values(h.run.snapshot().world!.results)).toEqual([result])
    expect(Object.keys(h.run.snapshot().entities)).toHaveLength(5)
    expect(model.requests).toHaveLength(3)
    expect(h.requestModel.requests).toHaveLength(3)
    expect(h.model.requests).toHaveLength(outcome === 'rejected' ? 3 : 0)
  })

it.each(['json', 'sqlite'] as const)('rejects altered %s publication attribution during retained target validation', async (backend) => {
  const h = await publishedCaseFixture(backend, rejectedResolution)
  assert.ok(h.request.notificationOperationId !== null)
  const state = h.run.snapshot(), operation = state.operations[h.request.notificationOperationId]!, receipt = operation.outbox!.receipt!
  const channel = await h.ctx.teams.getChannel({ channelId: receipt.channelId })
  const reference = await h.ctx.teams.getPersistenceReference({ kind: 'channel', channelId: receipt.channelId,
    expectedCursor: channel.cursor, prefixCursor: channel.cursor })
  const { validateAcceptedTargets } = await import('../src/target-references.ts')
  await validateAcceptedTargets(h.ctx, state, [reference], [], [], () => {})
  const read = h.ctx.teams.readChannelPage.bind(h.ctx.teams)
  for (const patch of [{ traceId: 'foreign-fingerprint' }, { correlationId: 'foreign-operation' },
    { audience: [state.entities[requester]!.binding!.participantId] }, { kind: 'foreign-kind' }]) {
    const altered = vi.spyOn(h.ctx.teams, 'readChannelPage').mockImplementation(async (input) => {
      const page = await read(input)
      return { ...page, records: page.records.map(record => record.type === 'channel/envelope'
        ? { ...record, envelope: { ...record.envelope, ...patch } } : record) }
    })
    try {
      await expect(validateAcceptedTargets(h.ctx, state, [reference], [], [], () => {})).rejects.toThrow(/original accepted attribution/)
    } finally { altered.mockRestore() }
  }
  expect(h.run.snapshot()).toEqual(state)
  expect(h.model.requests).toHaveLength(0)
})
