import { WORLD_GENERATE_AND_HIRE_PIN } from '@clocky/clocky-simulation'
/** Paused World bootstrap from an already accepted portable scenario compilation. */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { simulationChangeSchema, simulationEntityIdSchema, simulationChannelSpecSchema,
  simulationParticipantSpecSchema, simulationCheckpointRequestSchema, simulationWakeRequestSchema,
  simulationWorldDefinitionSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationSnapshot, SimulationEntityBinding, SimulationEntityId,
  SimulationCheckpointOperation, SimulationCheckpointRequest, SimulationWorldIntent, SimulationWakeRequest,
  SimulationParticipantSpec } from '@clocky/clocky-simulation'
import type { ResolvedWorldScenario, ResolvedWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import { simulationWorldBootstrapRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationTeams } from '@clocky/clocky-simulation-team'
import type { TeamId, ChannelId, TeamStateSnapshot } from '@clocky/clocky-team'

/** Trusted accepted compilation and caller-owned initial checkpoint configuration. */
export interface SimulationWorldPreparation {
  /** Complete original compiler output; the caller must durably retain it before bootstrap IO. */
  readonly resolved: ResolvedWorldScenario | ResolvedWorldScenarioV1
  /** Deployment-selected lifecycle namespace unique to this run; the complete resolved artifact is bound below it. */
  readonly ownerName: string
  /** Initial checkpoint identity and bounds, persisted with the original creation request. */
  readonly checkpoint: Omit<SimulationCheckpointRequest, 'implementationVersion'>
}
/** Original Native, Team and scheduler identities; every initial person is ready but has no Agent. */
export interface SimulationWorldPrepared {
  /** Confirmed root Team reserved in Native before its creation IO. */
  readonly teamId: TeamId
  /** Exact durable lifecycle owner used for subsequent attachment. */
  readonly ownerName: string
  /** Permanent Participant and unmaterialized Session bindings for every initial person, including the director. */
  readonly actors: Readonly<Record<SimulationEntityId, SimulationEntityBinding>>
  /** Confirmed private channels indexed by original symbolic scenario keys. */
  readonly channels: Readonly<Record<string, ChannelId>>
  /** Native business identities paired with their still-pending original administrative wakes. */
  readonly initialEvents: readonly { readonly intentId: SimulationWorldIntent['id']; readonly wakeId: SimulationWakeRequest['id'] }[]
  /** Complete initial cross-owner manifest; preparation never starts scheduling or inference. */
  readonly checkpoint: Extract<SimulationCheckpointOperation, { status: 'completed' }>
}

/** Explicit Host-derived checkpoint retry; original identity and source metadata remain unchanged. */
export interface SimulationWorldCheckpointAttempt {
  /** Fresh or previously retained checkpoint for this exact accepted preparation command. */
  readonly current: SimulationCheckpointRequest
  /** Exact earlier accepted preparation command checkpoints in this same original run. */
  readonly permittedHistory: readonly SimulationCheckpointRequest[]
}

const ownerSchema = z.string().trim().min(1)
const pending = new WeakMap<SimulationRun, {
  request: SimulationWorldPreparation
  attempt?: SimulationWorldCheckpointAttempt | undefined
  work: Promise<SimulationWorldPrepared>
}>()

/** Complete resolved metadata participates in the original Native root reservation, including unmaterialized fields. */
function ownerIdentity(request: SimulationWorldPreparation): string {
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, item]) => [key, sorted(item)])) : value
  const fingerprint = createHash('sha256').update(JSON.stringify(sorted({
    resolved: request.resolved, checkpoint: request.checkpoint,
  }))).digest('hex')
  return `${request.ownerName}/resolved-${fingerprint}`
}

function participantSpec(actor: ResolvedWorldScenario['actors'][number]): SimulationParticipantSpec {
  return simulationParticipantSpecSchema.parse({ displayName: actor.persona.name, role: actor.role,
    capabilities: actor.runtime.capabilities, provider: actor.runtime.provider, preset: actor.runtime.preset,
    model: `${actor.runtime.model.provider}/${actor.runtime.model.name}` })
}
function channelSpecs(resolved: ResolvedWorldScenario | ResolvedWorldScenarioV1) {
  return resolved.channels.map(channel => simulationChannelSpecSchema.parse({ ...channel, limits: {} }))
}
function initialWake(intent: SimulationWorldIntent, event: ResolvedWorldScenario['initialEvents'][number]): SimulationWakeRequest {
  return simulationWakeRequestSchema.parse({ id: `world-initial:${intent.id}`, time: event.at,
    entityId: event.request.requesterEntityId, reason: event.description })
}
function originalCheckpoint(request: SimulationWorldPreparation): SimulationCheckpointRequest {
  return simulationCheckpointRequestSchema.parse({ ...request.checkpoint, implementationVersion: 'world/1' })
}

/**
 * Reconcile one original World topology and publish its initial paused checkpoint.
 * @param teams - Actual canonical Team provisioning and checkpoint owner.
 * @param run - Exclusive caller-owned run created with exactly resolved.native; drain preparation before close.
 * @param input - Trusted same-process compiler output, durably retained by the caller together with ownerName and
 * checkpoint before any identity IO. This function never recompiles against current deployment defaults.
 * @param attempt - Explicit accepted management retry after the original checkpoint failed; it cannot replace any original identity.
 * @returns original bindings and pending initial wakes with a completed checkpoint, after draining the temporary
 * attachment. Equal concurrent calls share work. Changed resolved artifacts, changed retained identities, progressed
 * history and implicit retries of failed original checkpoints reject. An explicit accepted attempt retains the original
 * failure and lifecycle identity while collecting its own checkpoint; Native/Team reservations survive response loss.
 */
export function prepareSimulationWorld(teams: Pick<SimulationTeams, 'ensureTeam' | 'attach'>,
  run: SimulationRun, input: SimulationWorldPreparation, attempt?: SimulationWorldCheckpointAttempt): Promise<SimulationWorldPrepared> {
  const request = { ...structuredClone(input), ownerName: ownerSchema.parse(input.ownerName),
    checkpoint: originalCheckpoint(input) }
  const retry = attempt === undefined ? undefined : structuredClone(attempt)
  const active = pending.get(run)
  if (active !== undefined) {
    if (!isDeepStrictEqual(active.request,
      request) || !isDeepStrictEqual(active.attempt, retry)) return Promise.reject(new Error('World preparation has another original request in flight'))
    return active.work
  }
  validate(run.snapshot(), request, retry)
  const work = Promise.resolve().then(() => prepare(teams, run, request, retry)).finally(() => { pending.delete(run) })
  pending.set(run, { request, attempt: retry, work })
  return work
}

/** Admit only the unchanged bootstrap prefix; pending original initial events are inert preparation facts. */
function validate(state: SimulationSnapshot, request: SimulationWorldPreparation, attempt?: SimulationWorldCheckpointAttempt): void {
  const { resolved } = request
  if (resolved.apiVersion === 'clocky.world/v1') { validateV1(state, request, resolved, attempt); return }
  const { runId: _runId, ...native } = state.spec
  if (!isDeepStrictEqual(native, resolved.native)) throw new Error('World run differs from the original resolved Native definition')
  const empty = ['decisions', 'operations', 'resources', 'interactions', 'commitments', 'grants', 'ingresses',
    'windows', 'knowledge', 'taskExecutions', 'taskCancellations', 'taskDecisionOwners', 'management', 'maintenance',
    'capacityGrants', 'budgetGrants', 'tokenReservations', 'wakes'] as const
  if (state.phase !== 'paused' || state.time !== '0' || state.nextDecisionSlot !== '0' || state.lastEventKey !== undefined
    || state.activeDecisionId !== undefined || state.activeWindowId !== undefined || state.stall !== undefined
    || state.decisionDispatch !== undefined || empty.some(key => Object.keys(state[key] ?? {}).length !== 0)) {
    throw new Error('World preparation requires unstarted paused history')
  }
  const owner = ownerIdentity(request)
  if (state.teamReservation !== undefined && (state.teamReservation.creation.rules['activationLifecycleOwner'] !== owner
    || state.teamReservation.creation.goal.objective !== resolved.definition.metadata.description.trim())) {
    throw new Error('World retained Team differs from the original resolved definition')
  }
  const entities = new Map(resolved.entities.map(command => [command.id, command]))
  const actors = new Map(resolved.actors.map(actor => [actor.entityId, actor]))
  const channels = new Map(channelSpecs(resolved).map(channel => [channel.key, channel]))
  for (const entity of Object.values(state.entities)) {
    const original = entities.get(entity.id), actor = actors.get(entity.id)
    if (original === undefined || entity.kind !== original.entityKind || entity.cognition !== original.cognition
      || entity.phase !== 'active' || entity.writer !== undefined || entity.profileRevision !== 1
      || entity.readiness === 'abandoned' || !isDeepStrictEqual(entity.profile, original.profile)
      || entity.revision !== 1 + (entity.binding === undefined ? 0 : 1) + (actor !== undefined && entity.readiness === 'ready' ? 1 : 0)
      || actor === undefined && (entity.readiness !== 'ready' || entity.binding !== undefined
        || entity.participantReservation !== undefined)
      || entity.participantReservation !== undefined && (actor === undefined
        || !isDeepStrictEqual(entity.participantReservation.participant, participantSpec(actor)))
      || entity.binding !== undefined && !isDeepStrictEqual(entity.binding, entity.participantReservation?.binding)) {
      throw new Error('World retained entity differs from the original preparation')
    }
    if (actor !== undefined && entity.readiness === 'ready' && (entity.binding === undefined
      || resolved.entities.some(original => !Object.hasOwn(state.entities, original.id))
      || resolved.actors.some(actor => state.entities[simulationEntityIdSchema.parse(actor.entityId)]?.binding === undefined)
      || [...channels.values()].some(channel => state.channelReservations?.[channel.key]?.confirmed !== true))) {
      throw new Error('World ready actor has incomplete original identity preparation')
    }
  }
  const relations = new Map(resolved.relations.map(command => [command.id, simulationChangeSchema.parse(command)]))
  for (const relation of Object.values(state.relations)) {
    const original = relations.get(relation.id)
    if (original?.kind !== 'relation/create') throw new Error('World retained relation differs from the original preparation')
    const { kind: _kind, ...fields } = original
    const { revision, ...retained } = relation
    if (revision !== 1 || !isDeepStrictEqual(retained,
      fields)) throw new Error('World retained relation differs from the original preparation')
  }
  for (const reservation of Object.values(state.channelReservations ?? {})) {
    if (!isDeepStrictEqual(reservation.spec, channels.get(reservation.spec.key))) {
      throw new Error('World retained channel differs from the original preparation')
    }
  }
  if (state.world !== undefined) {
    if (!isDeepStrictEqual(state.world.definition, resolved.world)
      || Object.keys(state.world.requests).length !== 0 || Object.keys(state.world.plans).length !== 0
      || Object.keys(state.world.results).length !== 0 || Object.keys(state.world.cancellations).length !== 0
      || Object.keys(state.world.reservations).length !== 0) {
      throw new Error('World retained authority or cases differ from unstarted preparation')
    }
    for (const intent of Object.values(state.world.intents)) {
      if (!resolved.initialEvents.some(event => intent.requesterEntityId === event.request.requesterEntityId
        && intent.businessKey === event.request.applicationId
        && intent.scopeEntityId === event.request.organizationEntityId && intent.description === event.description)) {
        throw new Error('World retained HireIntent differs from the original preparation')
      }
    }
  }
  const expectedEvents = new Map(resolved.initialEvents.flatMap((event, index) => {
    const intent = Object.values(state.world?.intents ?? {}).find(intent =>
      intent.requesterEntityId === event.request.requesterEntityId && intent.businessKey === event.request.applicationId
      && intent.scopeEntityId === event.request.organizationEntityId && intent.description === event.description)
    if (intent === undefined) return []
    const wake = initialWake(intent, event)
    return [[wake.id, { id: wake.id, key: { time: wake.time, microstep: '0', phase: 'decision', slot: String(index) },
      action: { kind: 'wake', entityId: wake.entityId, reason: wake.reason }, status: 'pending' }] as const]
  }))
  if (state.nextEventSlot !== String(Object.keys(state.scheduledEvents).length)
    || Object.values(state.scheduledEvents).some(event => !isDeepStrictEqual(event, expectedEvents.get(event.id)))) {
    throw new Error('World retained initial wake differs from unstarted preparation')
  }
  validateCheckpoints(state, request, attempt)
}

/** Initial v1 effects remain inert and source-bound; arbitrary progressed state cannot masquerade as preparation. */
function validateV1(state: SimulationSnapshot, request: SimulationWorldPreparation, resolved: ResolvedWorldScenarioV1,
  attempt?: SimulationWorldCheckpointAttempt): void {
  const { runId: _runId, ...native } = state.spec
  if (!isDeepStrictEqual(native, resolved.native) || state.phase !== 'paused' || state.time !== '0'
    || state.activeDecisionId !== undefined || state.activeWindowId !== undefined || state.lastEventKey !== undefined
    || Object.keys(state.decisions).length || Object.keys(state.operations).length || Object.keys(state.windows ?? {}).length
    || Object.keys(state.wakes).length || Object.keys(state.interactions).length || Object.keys(state.commitments).length
    || Object.keys(state.management ?? {}).length || Object.keys(state.maintenance ?? {}).length)
    throw new Error('V1 preparation requires its original unstarted paused Native definition')
  const owner = ownerIdentity(request)
  if (state.teamReservation !== undefined && (state.teamReservation.creation.rules['activationLifecycleOwner'] !== owner
    || state.teamReservation.creation.goal.objective !== resolved.definition.metadata.description.trim()))
    throw new Error('V1 retained Team differs from its original resolved definition')
  const originals = new Map(resolved.entities.map(value => [value.id, value]))
  const actors = new Map(resolved.actors.map(value => [value.entityId, value]))
  for (const entity of Object.values(state.entities)) {
    const original = originals.get(entity.id), actor = actors.get(entity.id)
    if (original === undefined || entity.kind !== original.entityKind || entity.cognition !== original.cognition
      || entity.phase !== 'active' || entity.writer !== undefined || entity.profileRevision !== 1
      || !isDeepStrictEqual(entity.profile, original.profile)
      || entity.binding !== undefined && !isDeepStrictEqual(entity.binding, entity.participantReservation?.binding)
      || entity.participantReservation !== undefined && (actor === undefined
        || !isDeepStrictEqual(entity.participantReservation.participant, participantSpec(actor))))
      throw new Error('V1 preparation retained a changed original entity or identity')
    if (actor !== undefined && (entity.readiness === 'abandoned'
      || entity.readiness === 'ready' && state.worldBootstrap?.status !== 'applied'))
      throw new Error('V1 cognitive identity became ready before complete original initialization')
  }
  const relations = new Map(resolved.relations.map(value => [value.id, simulationChangeSchema.parse(value)]))
  for (const value of Object.values(state.relations)) {
    const original = relations.get(value.id)
    if (original?.kind !== 'relation/create') throw new Error('V1 retained an undeclared relation')
    const { kind: _kind, ...fields } = original, { revision, ...retained } = value
    if (revision !== 1 || !isDeepStrictEqual(fields, retained)) throw new Error('V1 retained relation changed its original interval')
  }
  const channels = new Map(channelSpecs(resolved).map(value => [value.key, value]))
  for (const value of Object.values(state.channelReservations ?? {})) if (!isDeepStrictEqual(value.spec, channels.get(value.spec.key)))
    throw new Error('V1 retained Channel differs from its original members or limits')
  const expected = simulationWorldBootstrapRequestSchema.parse({ definitionHash: resolved.definitionHash,
    definition: resolved.world, actorIds: resolved.actors.map(value => value.entityId), data: resolved.bootstrap })
  const book = state.worldBootstrap
  if (book !== undefined && !isDeepStrictEqual(book.request, expected)) throw new Error('V1 bootstrap changed its original complete data')
  if (book?.status === 'applied') {
    if (Object.keys(state.entities).length !== resolved.entities.length || Object.keys(state.relations).length !== resolved.relations.length
      || Object.values(state.channelReservations ?? {}).some(value => !value.confirmed) || book.occurrences.length
      || state.world === undefined || !isDeepStrictEqual(state.world.definition, resolved.world)
      || Object.values(state.scheduledEvents).some(value => value.status !== 'pending')
      || Object.keys(state.world.intents).length || Object.keys(state.world.requests).length || Object.keys(state.world.plans).length
      || Object.keys(state.world.results).length || Object.keys(state.world.governance.proposals).length)
      throw new Error('V1 applied preparation contains progressed or incomplete world history')
    const data = expected.data, sequence = book.appliedSequence
    if (Object.keys(state.resources).length !== data.resources.length || data.resources.some((value) => {
      const actual = state.resources[value.id], { revision: _revision, ...fields } = actual ?? {}
      return actual?.revision !== 1 || !isDeepStrictEqual(fields, value)
    }) || Object.values(state.world.facts).flat().length !== data.facts.length
      || Object.values(state.world.facts).flat().some(value => value.sequence !== sequence)
      || Object.values(state.world.norms.versions).flat().length !== data.norms.length
      || Object.values(state.world.norms.versions).flat().some(value => value.sequence !== sequence || value.origin !== 'scenario')
      || Object.values(state.knowledge ?? {}).flat().length !== data.knowledge.length
      || Object.values(state.knowledge ?? {}).flat().some(value => value.sequence !== sequence)
      || Object.keys(state.world.external.identities).length !== data.externalIdentities.length)
      throw new Error('V1 initial data differs from its sole original atomic application')
  } else if (state.world !== undefined || Object.keys(state.resources).length || Object.keys(state.knowledge ?? {}).length
    || Object.keys(state.scheduledEvents).length) throw new Error('V1 incomplete bootstrap published partial original data')
  validateCheckpoints(state, request, attempt)
}

/** Validate checkpoint provenance separately from the immutable identity/topology request. */
function validateCheckpoints(state: SimulationSnapshot, request: SimulationWorldPreparation,
  attempt?: SimulationWorldCheckpointAttempt): void {
  const original = originalCheckpoint(request)
  const allowed = attempt === undefined ? [original] : [original, ...attempt.permittedHistory, attempt.current]
  if (attempt !== undefined) {
    if (state.checkpoints?.[original.id]?.status !== 'failed') throw new Error('Explicit preparation retry requires its original failed checkpoint')
    const { id: _id, ...policy } = original
    for (const input of [...attempt.permittedHistory, attempt.current]) {
      const parsed = simulationCheckpointRequestSchema.parse(input), { id, ...current } = parsed
      if (id === original.id || !isDeepStrictEqual(current, policy))
        throw new Error('Checkpoint retry changed its original collection policy or reused its failed identity')
    }
  }
  if (Object.values(state.checkpoints ?? {}).some(value => !allowed.some(input => isDeepStrictEqual(value.request, input)))
    || state.latestCheckpointId !== undefined && !allowed.some(input => input.id === state.latestCheckpointId))
    throw new Error('World retained checkpoint differs from its original or accepted preparation attempt')
}

/** Team views cannot contain unrelated membership or any executed work before the initial checkpoint. */
function validateTeam(team: TeamStateSnapshot, state: SimulationSnapshot, request: SimulationWorldPreparation): void {
  if (team.team.phase !== 'active' || team.team.parentTeamId !== undefined || team.team.closure !== undefined
    || team.team.cancellation !== undefined || team.team.goal.revision !== 1 || team.team.goal.phase !== 'active'
    || team.activations.length !== 0 || team.tasks.length !== 0
    || !isDeepStrictEqual(team.rules['teamLimits'], request.resolved.limits.team)) {
    throw new Error('World Team history or frozen deployment limits differ from the original preparation')
  }
  for (const participant of team.participants) {
    const actor = request.resolved.actors.find(actor =>
      state.entities[simulationEntityIdSchema.parse(actor.entityId)]?.participantReservation?.binding.participantId === participant.id)
    if (actor === undefined || participant.kind !== 'local-agent'
      || !['invited', 'provisioning', 'active'].includes(participant.phase)
      || Object.entries(participantSpec(actor)).some(([key, value]) =>
        !isDeepStrictEqual(participant[key as keyof typeof participant], value))) {
      throw new Error('World retained Participant differs from its original reserved identity')
    }
  }
  const retainedChannels = new Set(Object.values(state.channelReservations ?? {}).map(reservation => reservation.channelId))
  if (team.channelIds.some(id => !retainedChannels.has(id))) throw new Error('World Team retains an unreserved channel')
}

/** Every external identity operation delegates reservation and reconciliation to its actual Native/Team owner. */
async function prepare(teams: Pick<SimulationTeams, 'ensureTeam' | 'attach'>, run: SimulationRun,
  request: SimulationWorldPreparation, attempt?: SimulationWorldCheckpointAttempt): Promise<SimulationWorldPrepared> {
  validate(run.snapshot(), request, attempt)
  const { resolved } = request, ownerName = ownerIdentity(request)
  const team = await teams.ensureTeam(run, { goal: { objective: resolved.definition.metadata.description, budgets: {} },
    budgets: {}, limits: resolved.limits.team }, ownerName)
  validateTeam(team, run.snapshot(), request)
  const connection = await teams.attach(run, team.team.id, ownerName)
  try {
    for (const command of resolved.entities) {
      if (!Object.hasOwn(run.snapshot().entities, command.id)) {
        await run.change(simulationChangeSchema.parse(command), run.snapshot().revision)
      }
    }
    const actors: Array<[SimulationEntityId, SimulationEntityBinding]> = []
    for (const actor of resolved.actors) {
      const id = simulationEntityIdSchema.parse(actor.entityId)
      const retained = resolved.apiVersion === 'clocky.world/v1' && run.snapshot().worldBootstrap?.status === 'retained'
        ? run.inspectEntity(id).entity?.binding : undefined
      actors.push([id, retained ?? await connection.ensureParticipant(id, participantSpec(actor))])
    }
    const channels: Array<[string, ChannelId]> = []
    for (const channel of channelSpecs(resolved)) {
      const retained = resolved.apiVersion === 'clocky.world/v1' && run.snapshot().worldBootstrap?.status === 'retained'
        ? Object.values(run.snapshot().channelReservations ?? {}).find(value =>
          value.spec.key === channel.key && value.confirmed) : undefined
      channels.push([channel.key, retained?.channelId ?? (await connection.ensureChannel(channel)).manifest.id])
    }
    for (const command of resolved.relations) {
      if (!Object.hasOwn(run.snapshot().relations, command.id)) {
        await run.change(simulationChangeSchema.parse(command), run.snapshot().revision)
      }
    }
    const initialEvents: SimulationWorldPrepared['initialEvents'][number][] = []
    if (resolved.apiVersion === 'clocky.world/v1') {
      await run.initializeWorld(simulationWorldBootstrapRequestSchema.parse({ definitionHash: resolved.definitionHash,
        definition: resolved.world, actorIds: resolved.actors.map(value => value.entityId),
        data: resolved.bootstrap }), run.snapshot().revision)
    } else {
      for (const actor of resolved.actors) {
        const id = simulationEntityIdSchema.parse(actor.entityId), entity = run.inspectEntity(id).entity
        if (entity?.readiness === 'preparing') await run.change(simulationChangeSchema.parse({ kind: 'entity/readiness', id,
          entityRevision: entity.revision, readiness: 'ready' }), run.snapshot().revision)
      }
      await run.configureWorld(simulationWorldDefinitionSchema.parse(resolved.world), run.snapshot().revision)
      for (const event of resolved.initialEvents) {
        const intent = await run.openWorldIntent(simulationEntityIdSchema.parse(event.request.requesterEntityId),
          { kind: 'world/request', domain: WORLD_GENERATE_AND_HIRE_PIN.domain,
            operation: WORLD_GENERATE_AND_HIRE_PIN.operation, version: WORLD_GENERATE_AND_HIRE_PIN.version,
            businessKey: event.request.applicationId, expectedTime: null, evidence: [],
            payload: { organizationEntityId: event.request.organizationEntityId,
              positionEntityId: event.request.positionEntityId, description: event.description,
            } })
        const wake = initialWake(intent, event)
        await run.scheduleWake(wake, run.snapshot().revision)
        initialEvents.push({ intentId: intent.id, wakeId: wake.id })
      }
    }
    validate(run.snapshot(), request, attempt)
    const checkpoint = await connection.checkpoint(attempt?.current ?? originalCheckpoint(request))
    if (checkpoint.status !== 'completed') throw new Error('World initial checkpoint is incomplete')
    return { teamId: team.team.id, ownerName, actors: Object.fromEntries(actors),
      channels: Object.fromEntries(channels), initialEvents, checkpoint }
  } finally { await connection.close() }
}
