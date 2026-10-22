import { assertRunControlRequest } from './run-control.ts'
import { simulationGeneratedPlanSchema, generationPlanInput, generationRecordAt, WORLD_HIRING_REQUEST_ENVELOPE } from '@clocky/clocky-simulation'
import { governanceRouteMaterial } from '@clocky/clocky-simulation'
import { candidateMembership } from '@clocky/clocky-simulation'
import { WORLD_HIRING_MARKET_PIN, hasAcceptedHiringOffer } from '@clocky/clocky-simulation'
import { worldDecisionSource } from '@clocky/clocky-simulation'
import { simulationWorldManagementAcceptedSchema } from '@clocky/clocky-simulation'
import { foldWorldManagement, assertAcceptedWorldPlanSource } from './world-management.ts'
import { assertWorldExecutionProjection } from './world-execution.ts'
import { parseSimulationWorldSchema } from '@clocky/clocky-simulation'
import { currentWorldAssignments as currentAssignments, currentWorldOperationGrants as operationGrants } from '@clocky/clocky-simulation'
import { latestWorldEvidence, validateWorldEvidenceAsk, validateWorldEvidenceSupply, worldEvidenceContext,
  worldEvidenceNotice, worldEvidenceRevisionNotice, assertWorldEvidenceProjection } from './world-evidence.ts'
import { worldEvidenceChallengeIdSchema, worldEvidenceRevisionIdSchema } from '@clocky/clocky-simulation'
import { assertWorldStructureBudgetProjection } from './world-structure-budget.ts'
import { worldRequestBudget, assertWorldRequestBudget, assertWorldRequestBudgetProjection } from './world-request-budget.ts'
import { worldResultNotificationActor } from './world-result-role.ts'
import { simulationMaintenanceRequestSchema } from '@clocky/clocky-simulation'
import { acceptExternalActorIdentity } from './world-external-actor.ts'
import { acceptExternalIdentity } from './world-external.ts'
import { acceptExternalMediatedIdentity } from './world-external-mediated.ts'
import { acceptDepartureFence, cancelPersonnelDisposition, personnelCancellationPending } from './world-personnel.ts'
import { activePersonnelFences, PersonnelDomainError } from '@clocky/clocky-simulation'
import type { SimulationContextReference } from '@clocky/clocky-session'
import { projectWorldFacts } from '@clocky/clocky-simulation'
import { normContextMaterial } from './world-norms.ts'
import { governanceProposalMaterial } from '@clocky/clocky-simulation'
import { prepareGovernanceRoute, prepareGovernanceDelegation, prepareGovernanceProposal, prepareGovernanceVote, foldWorldGovernance } from './world-governance.ts'
/** Native world authority, fixed context reads and deterministic request expansion. */
import { isDeepStrictEqual } from 'node:util'
import { validateHiringFeeAccounts, cancelHiringResourceReservations } from './world-hiring-resources.ts'
import { z } from 'zod'
import { simulationWorldDefinitionSchema, simulationWorldIntentSchema, worldIntentIdSchema,
  worldRequestIdSchema, worldPlanIdSchema, SimulationWorldError, WORLD_EXTERNAL_MEDIATED_PIN,
  parseSimTime } from '@clocky/clocky-simulation'
import { simulationWorldCancelRequestSchema, simulationWorldResultSchema, simulationWorldCancellationSchema,
  worldResultIdSchema, worldResultNotification } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationDecision, SimulationProposal, SimulationOperation, SimulationEntityId,
  SimulationWorldState, SimulationWorldIntent, SimulationWorldContext,
  SimulationWorldReadSet, SimulationContextRequest, SimulationWorldRequest, SimulationWorldPlan } from '@clocky/clocky-simulation'
import type { SimulationWorldResult } from '@clocky/clocky-simulation'
import { businessFingerprint, operationId } from './business.ts'
import { simulationWorldDomainRequestSchema } from '@clocky/clocky-simulation'
import { requireWorldRuntime } from './world-runtime.ts'
import type { NativeWorldRuntime } from './world-runtime.ts'
import { simulationWorldReadSetSchema } from '@clocky/clocky-simulation'
import type { SimulationWorldDirectorTrigger } from '@clocky/clocky-simulation'
import { assertDirectorTrigger, directorRequestCount, directorEventBusinessKey,
  directorTriggerFromWake, directorEventReason } from './world-director-event.ts'

/** Only trusted run APIs write the definition and business applications. */
export const worldRecordSchema = z.discriminatedUnion('kind', [
  simulationWorldManagementAcceptedSchema,
  z.strictObject({ kind: z.literal('world/defined'), definition: simulationWorldDefinitionSchema }),
  z.strictObject({ kind: z.literal('world/intent'), intent: simulationWorldIntentSchema }),
  z.strictObject({ kind: z.literal('world/cancelled'), request: simulationWorldCancelRequestSchema }),
  z.strictObject({ kind: z.literal('world/plan-stale'), planId: worldPlanIdSchema,
    reason: z.enum(['read-set-changed', 'authority-unavailable']) }),
])
/** Validated administrative world record. */
export type WorldRecord = z.infer<typeof worldRecordSchema>

function assertWorldExecutionReconciled(world: SimulationWorldState, requestId: import('@clocky/clocky-simulation').WorldRequestId): void {
  if (Object.values(world.executions).some(value => value.requestId === requestId
    && (value.phase === 'armed' || value.phase === 'outcome-unknown')))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'The original callback must reconcile before another plan or planning context')
}

function lookup<T>(values: Readonly<Record<string, T>>, id: string): T | undefined {
  return Object.hasOwn(values, id) ? values[id] : undefined
}

/**
 * Read the installed immutable world authority.
 * @param state - Authoritative projection.
 * @returns installed frozen world policy, or rejects an unconfigured run.
 */
export function requireWorld(state: SimulationSnapshot): SimulationWorldState {
  if (state.world === undefined) throw new SimulationWorldError('SIM_WORLD_NOT_CONFIGURED', 'Simulation world is not configured')
  return state.world
}
/**
 * Derive an operation-scoped business identity independently of technical decision IDs.
 * @param state - Original run identity.
 * @param request - Explicit registered selector and business key.
 * @returns deterministic domain intent identity.
 */
export function worldIntentIdentity(state: SimulationSnapshot,
  request: Pick<import('@clocky/clocky-simulation').SimulationWorldDomainRequest,
    'domain' | 'operation' | 'businessKey'>): import('@clocky/clocky-simulation').WorldIntentId {
  return worldIntentIdSchema.parse(`world-intent:${businessFingerprint([state.spec.runId, request.domain,
    request.operation, request.businessKey]).slice(7)}`)
}
function cognitive(state: SimulationSnapshot, id: SimulationEntityId) {
  const entity = lookup(state.entities, id)
  if (entity?.phase !== 'active' || entity.cognition !== 'agent' || entity.readiness !== 'ready' || entity.binding === undefined)
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'World authority requires a ready canonical actor')
  return { ...entity, binding: entity.binding }
}
function marketMembership(state: SimulationSnapshot, actor: SimulationEntityId, scope: SimulationEntityId,
  pin: import('@clocky/clocky-simulation').SimulationWorldDomainPin) {
  const employed = currentAssignments(state, actor, scope)
  return employed.length || !isDeepStrictEqual(pin, WORLD_HIRING_MARKET_PIN) ? employed : candidateMembership(state, actor, scope)
}
function installed(state: SimulationSnapshot, pin: import('@clocky/clocky-simulation').SimulationWorldDomainPin,
  runtime: NativeWorldRuntime | undefined) {
  if (!requireWorld(state).definition.operations.some(value => isDeepStrictEqual(value, pin)))
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Operation is absent from the original World manifest')
  return requireWorldRuntime(runtime).original(pin)
}
/**
 * Derive a strict domain intent with current canonical actor, employment and exact installed permission.
 * @param state - Original authoritative run.
 * @param actor - Trusted current decision or bootstrap actor.
 * @param proposed - Proposed body, excluding caller identity.
 * @param pin - Original manifest pin selected by Native.
 * @param sequence - Exact candidate append position.
 * @param runtime - Original explicit parser/reducer catalog.
 * @param scenarioTrigger - Native-selected original directive; ordinary callers supply none.
 * @returns normalized candidate; matching originals retain their original sequence and payload.
 */
export function createWorldIntent(state: SimulationSnapshot, actor: SimulationEntityId, proposed: unknown,
  pin: import('@clocky/clocky-simulation').SimulationWorldDomainPin, sequence: number,
  runtime: NativeWorldRuntime | undefined, scenarioTrigger?: SimulationWorldDirectorTrigger): SimulationWorldIntent {
  const request = parseSimulationWorldSchema(simulationWorldDomainRequestSchema, proposed), module = installed(state, pin, runtime)
  if (request.domain !== pin.domain || request.operation !== pin.operation || request.version !== pin.version)
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'World request differs from its consumed installed selector')
  const normalized = { ...request, payload: parseSimulationWorldSchema(z.json(),
    parseSimulationWorldSchema(module.definition.schemas.request, request.payload)) }
  const original = lookup(requireWorld(state).intents, worldIntentIdentity(state, request))
  if (original !== undefined) {
    if (!isDeepStrictEqual(original.pin, pin) || original.requesterEntityId !== actor
      || !isDeepStrictEqual(original.payload, normalized.payload) || original.expectedTime !== request.expectedTime
      || !isDeepStrictEqual(original.evidence, request.evidence) || !isDeepStrictEqual(original.scenarioTrigger, scenarioTrigger))
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Business key changed its original actor, input or evidence')
    return original
  }
  assertRunControlRequest(state, request, runtime)
  const world = requireWorld(state)
  if (Object.keys(world.intents).length >= world.definition.limits.maxRequests)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World request history limit exceeded', 'requests')
  cognitive(state, actor)
  if (activePersonnelFences(state, actor).length)
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Original employment closes new world requests')
  const admitted = module.admitRequest(state, actor, normalized)
  if (scenarioTrigger !== undefined) {
    const declaration = assertDirectorTrigger(state, scenarioTrigger)
    if (actor !== requireWorld(state).definition.directorEntityId || module.definition.directorEvents !== true
      || declaration.domain !== pin.domain || declaration.operation !== pin.operation || declaration.version !== pin.version
      || declaration.scopeId !== admitted.scopeEntityId || declaration.targetId !== admitted.targetEntityId
      || request.businessKey !== directorEventBusinessKey(scenarioTrigger))
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY',
        'Director request differs from its exact scenario selector, scope, target or business key')
    if (directorRequestCount(state, declaration.id) >= declaration.maxRequests
      || Object.values(requireWorld(state).intents).some(value => isDeepStrictEqual(value.scenarioTrigger, scenarioTrigger)))
      throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Scenario director request budget or occurrence is already consumed', 'requests')
  } else if (!marketMembership(state, actor, admitted.scopeEntityId, pin).length
    || !operationGrants(state, actor, pin, admitted.scopeEntityId, admitted.targetEntityId).length)
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'World request requires current employment and its exact scoped operation grant')
  const candidate = parseSimulationWorldSchema(simulationWorldIntentSchema, {
    id: worldIntentIdentity(state, request), pin, businessKey: request.businessKey,
    requesterEntityId: actor, scopeEntityId: admitted.scopeEntityId, targetEntityId: admitted.targetEntityId,
    expectedTime: request.expectedTime, evidence: request.evidence,
    description: admitted.description, payload: admitted.payload, sequence, ...scenarioTrigger === undefined ? {} : { scenarioTrigger } })
  const { requestId: _absent, ...normalizedCandidate } = candidate
  if (normalizedCandidate.requesterEntityId === null)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Role admission produced a user source')
  return normalizedCandidate
}
/**
 * Compare critical domain reads together with current core authority and employment.
 * @param state - Current authoritative projection.
 * @param intent - Original pinned business identity.
 * @param runtime - Original parser/reducer catalog.
 * @returns exact typed dependencies; unrelated journal revisions remain irrelevant.
 */
export function worldExecutionReads(state: SimulationSnapshot, intent: SimulationWorldIntent,
  runtime?: NativeWorldRuntime): SimulationWorldReadSet {
  const module = installed(state, intent.pin, runtime)
  const revision = intent.requestId === undefined ? undefined : latestWorldEvidence(state, intent.requestId)
  const evidenceReads: SimulationWorldReadSet = intent.requestId === undefined
    || !Object.values(requireWorld(state).evidence.challenges).some(value => value.requestId === intent.requestId) ? []
    : [{ kind: 'world-input', id: intent.id, revision: revision?.revision ?? 0, hash: revision?.hash ?? businessFingerprint(null) }]
  const request = { kind: 'world/request' as const, ...intent.pin, businessKey: intent.businessKey,
    expectedTime: intent.expectedTime, evidence: [...intent.evidence], payload: intent.payload }
  if (intent.requesterEntityId === null) {
    if (module.admitManagementRequest === undefined)
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Original user management implementation is unavailable')
    module.admitManagementRequest(state, request, intent.source, intent)
    return parseSimulationWorldSchema(simulationWorldReadSetSchema, [
      { kind: 'world-definition', id: `world-definition:${state.spec.runId}`, revision: requireWorld(state).sequence },
      ...module.executionReads(state, intent),
    ])
  }
  const admitted = module.admitRequest(state, intent.requesterEntityId, request, intent)
  if (intent.scenarioTrigger !== undefined) {
    const declaration = assertDirectorTrigger(state, intent.scenarioTrigger)
    cognitive(state, intent.requesterEntityId)
    if (intent.requesterEntityId !== requireWorld(state).definition.directorEntityId || module.definition.directorEvents !== true
      || declaration.scopeId !== admitted.scopeEntityId || declaration.targetId !== admitted.targetEntityId
      || intent.targetEntityId !== admitted.targetEntityId || declaration.domain !== intent.pin.domain
      || declaration.operation !== intent.pin.operation || declaration.version !== intent.pin.version)
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Execution lost its original scenario-directed environment authority')
    return parseSimulationWorldSchema(simulationWorldReadSetSchema, [
      { kind: 'world-definition', id: `world-definition:${state.spec.runId}`, revision: requireWorld(state).sequence },
      ...evidenceReads, ...module.executionReads(state, intent),
    ])
  }
  const grants = operationGrants(state, intent.requesterEntityId, intent.pin, intent.scopeEntityId, admitted.targetEntityId)
  if (!grants.length) throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'World execution lost its original scoped operation grant')
  const assignments = marketMembership(state, intent.requesterEntityId, intent.scopeEntityId, intent.pin)
  if (!assignments.length) throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'World execution lost current employment')
  return parseSimulationWorldSchema(simulationWorldReadSetSchema, [
    { kind: 'world-definition', id: `world-definition:${state.spec.runId}`, revision: requireWorld(state).sequence },
    ...grants.map(({ relation }) => ({ kind: 'relation', id: relation.id, revision: relation.revision,
      effectiveFrom: relation.validFrom, effectiveUntil: relation.validUntil })),
    ...assignments.map(value => ({ kind: 'relation', id: value.id, revision: value.revision,
      effectiveFrom: value.validFrom, effectiveUntil: value.validUntil })),
    ...evidenceReads, ...module.executionReads(state, intent),
  ])
}
/**
 * Resolve critical read invalidation without depending on unrelated global revisions.
 * @param state - Current authoritative projection.
 * @param plan - Exact immutable plan.
 * @param runtime - Original parser/reducer catalog.
 * @returns explicit invalidation cause or undefined.
 */
export function worldPlanStaleReason(state: SimulationSnapshot, plan: SimulationWorldPlan, runtime?: NativeWorldRuntime):
NonNullable<SimulationWorldPlan['stale']>['reason'] | undefined {
  const request = lookup(requireWorld(state).requests, plan.requestId)
  const intent = request === undefined ? undefined : lookup(requireWorld(state).intents, request.intentId)
  if (intent === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Plan lost its original business intent')
  let reads: SimulationWorldReadSet
  try { reads = worldExecutionReads(state, intent, runtime) }
  catch (error: unknown) {
    if (error instanceof PersonnelDomainError) return error.code === 'SIM_PERSONNEL_AUTHORITY'
      ? 'authority-unavailable' : 'read-set-changed'
    if (error instanceof SimulationWorldError && error.failure.code === 'SIM_WORLD_LIMIT' && error.failure.limit === 'position')
      return 'read-set-changed'
    if (!(error instanceof SimulationWorldError) || error.code !== 'SIM_WORLD_AUTHORITY' && error.code !== 'SIM_WORLD_CONFLICT') throw error
    return error.code === 'SIM_WORLD_AUTHORITY' ? 'authority-unavailable' : 'read-set-changed'
  }
  return isDeepStrictEqual(plan.reads, reads) ? undefined : 'read-set-changed'
}
/**
 * Apply trusted world bootstrap and application records to the Native projection.
 * @param state - Prior projection.
 * @param record - Strict administrative record.
 * @param sequence - Durable position.
 * @param runtime - Original explicit World parser/reducer catalog; absent only for base simulation operations.
 * @returns new world projection.
 */
export function foldWorld(state: SimulationSnapshot, record: WorldRecord, sequence: number,
  runtime?: NativeWorldRuntime): SimulationSnapshot {
  if (record.kind === 'world/management-accepted') return foldWorldManagement(state, record, sequence, runtime)
  if (record.kind === 'world/defined') {
    const bootstrap = state.worldBootstrap
    validateHiringFeeAccounts(state, record.definition.hiringFees ?? [], bootstrap?.status === 'retained'
      && isDeepStrictEqual(bootstrap.request.definition, record.definition) ? bootstrap.request.data.resources : [])
    if (state.world !== undefined || state.phase !== 'paused' || state.activeWindowId !== undefined || Object.keys(state.decisions).length)
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'World definition requires an unstarted paused run')
    requireWorldRuntime(runtime).manifest(record.definition)
    const definition = record.definition, director = cognitive(state, definition.directorEntityId)
    if (definition.operations.some(pin => isDeepStrictEqual(pin, WORLD_EXTERNAL_MEDIATED_PIN))) {
      const policy = definition.externalAdjudicationPolicy
      if (policy === undefined)
        throw new SimulationWorldError('SIM_WORLD_CONFLICT',
          'Mediated external operation requires its complete frozen policy at World definition')
      parseSimTime(policy.maxDelay, state.spec.maxTime)
      if (policy.actorDisclosure.some(id => !Object.hasOwn(state.entities, id)))
        throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Mediated disclosure policy requires existing reader identities')
    }
    const organization = lookup(state.entities, definition.organizationEntityId)
    if (organization?.phase !== 'active' || organization.cognition !== 'none')
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'World organization must be a noncognitive entity')
    const world: SimulationWorldState = { definition, sequence,
      evidence: { challenges: {}, revisions: {} },
      external: { identities: {}, interactions: {}, representatives: {}, contacts: {}, adjudications: {}, events: {} },
      personnel: { reservations: {}, fences: {}, generations: {}, operationGrants: [] },
      channels: {}, intents: {}, requests: {}, plans: {}, results: {},
      cancellations: {}, reservations: {}, executions: {}, mutations: {}, facts: {},
      governance: { proposals: {}, votes: {}, resolutions: {} },
      norms: { versions: {}, closures: [], announcements: {} } }
    const channels: Record<SimulationEntityId, import('@clocky/clocky-team').ChannelId> = {}
    for (const role of definition.positionRolePermissions) {
      const position = state.entities[role.positionEntityId]
      if (position?.kind !== 'position' || position.phase !== 'active')
        throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'World role permissions require an actual active declared position')
      for (const permission of role.permissions) {
        const target = state.entities[permission.targetEntityId], scope = state.entities[permission.scopeEntityId]
        const rule = state.spec.relationRules.find(value => value.relation === permission.relation)
        if (target?.phase !== 'active' || scope?.phase !== 'active' || rule === undefined
          || !rule.subjectKinds.includes('person') || !rule.objectKinds.includes(target.kind)
          || !rule.scopeKinds?.includes(scope.kind))
          throw new SimulationWorldError('SIM_WORLD_AUTHORITY',
            'World role permission targets and relation rules must be executable at definition load')
      }
    }
    for (const grant of definition.operationGrants) {
      const requester = cognitive(state, grant.requesterEntityId), target = lookup(state.entities, grant.targetEntityId)
      const pin = definition.operations.find(value => value.domain === grant.domain
        && value.operation === grant.operation && value.version === grant.version)
      if (pin === undefined || requester.id === director.id || requester.binding.teamId !== director.binding.teamId
        || target?.phase !== 'active'
        || operationGrants({ ...state, world }, requester.id, pin, grant.scopeEntityId, grant.targetEntityId).length === 0)
        throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'World grant lacks its canonical actor, live target or permission relation')
      const channel = Object.values(state.channelReservations ?? {}).find(value => value.confirmed && value.spec.members.length === 2
        && value.spec.members.some(member => member.entityId === requester.id)
          && value.spec.members.some(member => member.entityId === director.id))
      if (channel === undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT',
        'World requester requires a confirmed private director Channel')
      Object.defineProperty(channels, requester.id, { value: channel.channelId, enumerable: true, configurable: true })
    }
    return { ...state, world: { ...world, channels } }
  }
  if (record.kind === 'world/cancelled') return foldCancellation(state, record.request, sequence, runtime)
  const world = requireWorld(state)
  if (record.kind === 'world/plan-stale') {
    const plan = lookup(world.plans, record.planId), request = plan === undefined ? undefined : lookup(world.requests, plan.requestId)
    if (plan?.status !== 'accepted' || request?.status !== 'open' || request.plans.at(-1) !== plan.id
      || worldPlanStaleReason(state, plan, runtime) !== record.reason)
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Invalidation requires its latest open plan and exact changed reads')
    return { ...state, world: { ...world, plans: { ...world.plans, [plan.id]: { ...plan, status: 'stale',
      stale: { phase: 'execution', reason: record.reason, sequence } } } } }
  }
  const intent = record.intent
  if (intent.sequence !== sequence || intent.requestId !== undefined || Object.hasOwn(world.intents, intent.id))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'World intent requires its exact new append identity')
  if (intent.requesterEntityId === null)
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'User originals require their atomic management acceptance')
  const candidate = createWorldIntent(state, intent.requesterEntityId, { kind: 'world/request', domain: intent.pin.domain,
    operation: intent.pin.operation, version: intent.pin.version,
    businessKey: intent.businessKey, expectedTime: intent.expectedTime, evidence: [...intent.evidence], payload: intent.payload },
  intent.pin, sequence, runtime)
  if (!isDeepStrictEqual(candidate, intent)) throw new SimulationWorldError('SIM_WORLD_CONFLICT',
    'World bootstrap intent changed its owned derivation')
  return { ...state, world: { ...world, intents: { ...world.intents, [intent.id]: intent } } }
}

/**
 * Derive the sole terminal business result identity from the application, independent of plan or command retries.
 * @param intentId - Original immutable business application.
 * @returns run-local terminal result identity.
 */
export function worldResultIdentity(intentId: import('@clocky/clocky-simulation').WorldIntentId): import('@clocky/clocky-simulation').WorldResultId {
  return worldResultIdSchema.parse(`world-result:${intentId}`)
}

/**
 * Retain the sole terminal result without copying private rationale into a notification.
 * @param state - Authoritative unresolved case.
 * @param result - Deterministic terminal result supplied by its Native owner fold.
 * @param runtime - Original explicit World parser/reducer catalog; absent only for base simulation operations.
 * @returns a new terminal case projection; competing results reject.
 */
export function withWorldResult(state: SimulationSnapshot, result: SimulationWorldResult,
  runtime?: NativeWorldRuntime): SimulationSnapshot {
  const world = requireWorld(state), request = lookup(world.requests, result.requestId)
  if (request === undefined || request.status !== 'open' && request.status !== 'awaiting-evidence'
    && !(request.status === 'cancel-requested' && result.outcome.kind === 'cancelled')
    || request.intentId !== result.intentId
    || result.id !== worldResultIdentity(request.intentId) || Object.hasOwn(world.results, result.id)) {
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'World result requires its unresolved original business application')
  }
  parseSimulationWorldSchema(installed(state, request.pin, runtime).definition.schemas.result, result.payload)
  return { ...state, world: { ...world, evidence: { ...world.evidence, challenges: Object.fromEntries(
    Object.entries(world.evidence.challenges).map(([id, challenge]) => [id, challenge.requestId === request.id
      && challenge.status === 'awaiting'
      ? { ...challenge, status: 'cancelled' as const, settledSequence: result.sequence } : challenge])) },
  results: { ...world.results, [result.id]: parseSimulationWorldSchema(simulationWorldResultSchema, result) },
  requests: { ...world.requests, [request.id]: { ...request, status: result.outcome.kind } } } }
}

function foldCancellation(state: SimulationSnapshot, command: import('@clocky/clocky-simulation').SimulationWorldCancelRequest,
  sequence: number, runtime?: NativeWorldRuntime): SimulationSnapshot {
  const world = requireWorld(state), request = lookup(world.requests, command.requestId)
  if (request === undefined || Object.hasOwn(world.cancellations, command.id)) {
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'World cancellation requires an original case and unused command identity')
  }
  if (Object.keys(world.cancellations).length >= world.definition.limits.maxRequests)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World cancellation history limit exceeded', 'commands')
  if (Buffer.byteLength(JSON.stringify(command), 'utf8') > world.definition.limits.maxBytesPerRequest)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World cancellation command byte limit exceeded', 'bytes')
  const resultId = worldResultIdentity(request.intentId), prior = lookup(world.results, resultId)
  if (prior === undefined && request.plans.some(id => hasAcceptedHiringOffer(state, id)))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'An accepted candidate obligation cannot be cancelled as an unaccepted request')
  const personnel = world.personnel.reservations[request.intentId]
  if (prior === undefined && personnel !== undefined
    && (personnel.status === 'cancel-requested' || personnelCancellationPending(state, personnel.id))) {
    const cancellation = simulationWorldCancellationSchema.parse({ request: command, sequence, status: 'cancel-requested' })
    return { ...state, world: { ...world,
      requests: { ...world.requests, [request.id]: { ...request, status: 'cancel-requested' } },
      personnel: { ...world.personnel, reservations: { ...world.personnel.reservations,
        [personnel.id]: { ...personnel, status: 'cancel-requested', updatedSequence: sequence } } },
      cancellations: { ...world.cancellations, [command.id]: cancellation } } }
  }
  const contact = world.external.contacts[request.intentId]
  if (prior === undefined && (contact?.status === 'reserved' || contact?.status === 'cancel-requested')) {
    const cancellation = simulationWorldCancellationSchema.parse({ request: command, sequence, status: 'cancel-requested' })
    return { ...state, world: { ...world, requests: { ...world.requests, [request.id]: { ...request, status: 'cancel-requested' } },
      external: { ...world.external, contacts: { ...world.external.contacts, [contact.id]: { ...contact, status: 'cancel-requested',
        cancellation: contact.cancellation ?? { sequence,
          maintenance: simulationMaintenanceRequestSchema.parse({ id: `world/1/external-contact/${contact.id}`,
            owner: state.teamReservation?.creation.rules['activationLifecycleOwner'] }) }, updatedSequence: sequence } } },
      cancellations: { ...world.cancellations, [command.id]: cancellation } } }
  }
  const representative = world.external.representatives[request.intentId]
  if (prior === undefined && (representative?.status === 'preparing' || representative?.status === 'cancel-requested')) {
    const cancellation = simulationWorldCancellationSchema.parse({ request: command, sequence, status: 'cancel-requested' })
    return { ...state, world: { ...world, requests: { ...world.requests, [request.id]: { ...request, status: 'cancel-requested' } },
      external: { ...world.external, representatives: { ...world.external.representatives,
        [representative.id]: { ...representative, status: 'cancel-requested', updatedSequence: sequence } } },
      cancellations: { ...world.cancellations, [command.id]: cancellation } } }
  }
  if (prior === undefined && representative?.status === 'reserved') {
    state = { ...state, world: { ...world, external: { ...world.external, representatives: { ...world.external.representatives,
      [representative.id]: { ...representative, status: 'abandoned', updatedSequence: sequence } } } } }
  }
  const reservation = world.reservations[request.intentId]
  if (prior === undefined && (reservation?.status === 'preparing' || reservation?.status === 'cancel-requested')) {
    const cancellation = simulationWorldCancellationSchema.parse({ request: command, sequence, status: 'cancel-requested' })
    return { ...state, world: { ...world,
      requests: { ...world.requests, [request.id]: { ...request, status: 'cancel-requested' } },
      reservations: { ...world.reservations, [reservation.id]: { ...reservation, status: 'cancel-requested', updatedSequence: sequence } },
      cancellations: { ...world.cancellations, [command.id]: cancellation } } }
  }
  const settled = reservation?.status === 'candidate' ? { ...state, world: { ...world, reservations: { ...world.reservations,
    [reservation.id]: { ...reservation, status: 'abandoned' as const, updatedSequence: sequence } } } }
    : reservation?.status === 'reserved' ? { ...state, world: { ...world, reservations: { ...world.reservations,
      [reservation.id]: { ...reservation, status: 'abandoned' as const, updatedSequence: sequence } } } } : state
  const released = prior === undefined ? cancelHiringResourceReservations(settled, request.intentId, sequence) : settled
  const cancellable = prior === undefined ? cancelPersonnelDisposition(released, request.intentId, sequence) : released
  const next = prior === undefined ? withWorldResult(cancellable, { id: resultId, requestId: request.id, intentId: request.intentId,
    source: { kind: 'cancel', commandId: command.id }, outcome: { kind: 'cancelled' }, payload: {}, time: state.time, sequence },
  runtime) : state
  const cancellation = simulationWorldCancellationSchema.parse({ request: command, resultId, sequence,
    status: prior === undefined ? 'cancelled' : prior.outcome.kind === 'committed' ? 'already-committed' : 'already-resolved' })
  return { ...next, world: { ...requireWorld(next), cancellations: { ...world.cancellations, [command.id]: cancellation } } }
}
/**
 * Select the current authorized case, frozen templates and explicit execution reads.
 * @param state - Current world.
 * @param decision - Current writer.
 * @param selection - Trusted context purpose.
 * @param runtime - Original explicit World parser/reducer catalog; absent only for base simulation operations.
 * @returns frozen authorized world facts.
 */
export function worldContext(state: SimulationSnapshot, decision: SimulationDecision,
  selection: NonNullable<SimulationContextRequest['world']>, runtime?: NativeWorldRuntime): {
  authority: SimulationWorldContext
  text: string
  sources: SimulationContextReference[]
  worldScopeAccess: readonly SimulationEntityId[]
} {
  const selected = worldContextSelection(state, decision, selection, runtime)
  const worldFacts = projectWorldFacts(state, { viewer: decision.entityId, cursor: decision.snapshotRevision,
    time: decision.time, limit: state.spec.maxKnowledgePerQuery })
  const knownNorms = normContextMaterial(state, decision.entityId, decision.time, decision.snapshotRevision)
  const sources = [...selected.sources, ...knownNorms.sources.filter(source =>
    !selected.sources.some(value => isDeepStrictEqual(value, source)))]
  const world = requireWorld(state)
  const budgetSource: SimulationContextReference = { kind: 'run-event', runId: state.spec.runId, sequence: decision.snapshotRevision }
  if (!sources.some(value => isDeepStrictEqual(value, budgetSource))) sources.push(budgetSource)
  const votingPins = world.definition.operations.filter(pin =>
    installed(state, pin, runtime).acceptedResponsibility === 'governance-vote')
  const governance = Object.values(world.governance.proposals).filter(proposal =>
    proposal.sequence <= decision.snapshotRevision && proposal.electorate.some(member => member.entityId === decision.entityId)
    && votingPins.some(pin => operationGrants(state, decision.entityId, pin, proposal.scopeId, proposal.committeeId).length !== 0))
  for (const proposal of governance) {
    const source: SimulationContextReference = { kind: 'run-event', runId: state.spec.runId, sequence: proposal.sequence }
    if (!sources.some(value => isDeepStrictEqual(value, source))) sources.push(source)
  }
  for (const { fact } of worldFacts.items) {
    for (const source of [{ kind: 'run-event' as const, runId: state.spec.runId, sequence: fact.sequence }, ...fact.source.references]) {
      if (!sources.some(value => isDeepStrictEqual(value, source))) sources.push(source)
    }
  }
  // The Native context-view stores this exact JSON and source set before model submission; later publications cannot rewrite it.
  const body = JSON.parse(selected.text) as Record<string, unknown>
  const governanceRoutes = Object.values(world.governance.routes ?? {}).filter(route => route.sequence <= decision.snapshotRevision
    && route.proposals.some(proposal => governance.some(value => value.id === proposal.id)))
  if (governanceRoutes.length > 0) {
    body.governanceRoutes = governanceRoutes.map(governanceRouteMaterial)
    body.governanceRouteProgress = governanceRoutes.map(route => ({ id: route.id, hash: route.hash,
      progress: route.steps.map((step) => {
        const resolution = Object.values(world.governance.resolutions).find(value => value.proposalId === step.proposalId
          && value.sequence <= decision.snapshotRevision)
        if (resolution !== undefined) sources.push({ kind: 'run-event', runId: state.spec.runId, sequence: resolution.sequence })
        return { id: step.id, outcome: resolution?.outcome ?? 'pending', resolutionId: resolution?.id ?? null,
          resolutionHash: resolution?.hash ?? null }
      }) }))
    for (const route of governanceRoutes) sources.push({ kind: 'run-event', runId: state.spec.runId, sequence: route.sequence })
  }

  const authority = governance.length === 0 ? selected.authority : { ...selected.authority,
    governance: governance.map(proposal => ({ proposalId: proposal.id, proposalRevision: proposal.revision,
      bodyHash: proposal.bodyHash })),
    governanceAccess: governance.map((proposal) => {
      const pin = votingPins.find(value => operationGrants(state, decision.entityId, value,
        proposal.scopeId, proposal.committeeId).length !== 0) as (typeof votingPins)[number]
      return { proposal: { proposalId: proposal.id, proposalRevision: proposal.revision, bodyHash: proposal.bodyHash }, pin,
        grants: operationGrants(state, decision.entityId, pin, proposal.scopeId, proposal.committeeId).map(({ relation }) => ({
          kind: 'relation' as const, id: relation.id, revision: relation.revision,
          effectiveFrom: relation.validFrom, effectiveUntil: relation.validUntil })) }
    }) }
  const worldScopeAccess = [...new Set([
    ...worldFacts.items.filter(value => value.fact.audience.kind === 'scope-members').map(value => value.fact.scope),
    ...knownNorms.material.items.filter(value => value.norm.audience.kind === 'scope-members').map(value => value.norm.scope),
  ])]
  return { authority, sources, worldScopeAccess, text: JSON.stringify({ ...body, authority, worldFacts, norms: knownNorms.material,
    worldLimits: world.definition.limits,
    requestBudget: worldRequestBudget(state, decision.entityId, decision.time, decision.snapshotRevision),
    ...governance.length === 0 ? {} : { governance: governance.map(governanceProposalMaterial) } }) }
}

/** The original accepted request authorizes only an exact receipt retry, never another domain admission. */
function retainedRequest(state: SimulationSnapshot, intent: SimulationWorldIntent): SimulationWorldRequest | undefined {
  if (intent.requestId === undefined) return undefined
  const request = lookup(requireWorld(state).requests, intent.requestId)
  const operation = request?.operationId == null ? undefined : lookup(state.operations, request.operationId)
  if (request?.intentId !== intent.id || request.requesterEntityId !== intent.requesterEntityId
    || !isDeepStrictEqual(request.pin, intent.pin) || request.payloadHash !== businessFingerprint(request.proposal)
    || operation?.entityId !== intent.requesterEntityId || !isDeepStrictEqual(operation.action, request.proposal))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Request receipt lost its original accepted actor, payload or operation')
  return request
}

function worldContextSelection(state: SimulationSnapshot, decision: SimulationDecision,
  selection: NonNullable<SimulationContextRequest['world']>,
  runtime?: NativeWorldRuntime): { authority: SimulationWorldContext; text: string; sources: SimulationContextReference[] } {
  switch (selection.kind) {
    case 'evidence': return worldEvidenceContext(state, decision, selection.challengeId)
    case 'director-event': return directorWorldContext(state, decision, runtime)
    case 'scenario-resolve': return scenarioResolveContext(state, decision, selection.requestId, runtime)
    case 'scenario-result': return scenarioResultContext(state, decision, selection.resultId, selection.externalEventId)
    case 'goal': return goalWorldContext(state, decision, runtime)
    case 'result':
    case 'first-action': return terminalWorldContext(state, decision, selection, runtime)
    case 'request':
    case 'resolve': break
    default: return assertNever(selection)
  }
  const world = requireWorld(state)
  const request = selection.kind === 'resolve' ? lookup(world.requests, selection.requestId) : undefined
  const intentId = selection.kind === 'request' ? selection.intentId : request?.intentId
  const intent = intentId === undefined ? undefined : lookup(world.intents, intentId)
  if (intent === undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'World context has no recorded business application')
  let authority: SimulationWorldContext
  if (selection.kind === 'request') {
    if (intent.requesterEntityId !== decision.entityId)
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'World request context belongs to another actor')
    const receipt = retainedRequest(state, intent)
    if (receipt !== undefined) {
      installed(state, intent.pin, runtime)
      authority = { kind: 'request', pin: intent.pin, intentId: intent.id, reads: [], baseRevision: state.revision }
      return { authority, sources: [
        { kind: 'run-event', runId: state.spec.runId, sequence: world.sequence },
        { kind: 'run-event', runId: state.spec.runId, sequence: intent.sequence },
        { kind: 'run-event', runId: state.spec.runId, sequence: receipt.sequence },
      ], text: JSON.stringify({ kind: 'world-context', operation: intent.pin, authority,
        receipt: { requestId: receipt.id, status: receipt.status, proposal: receipt.proposal } }) }
    }
    authority = { kind: 'request', pin: intent.pin,
      intentId: intent.id, reads: worldExecutionReads(state, intent, runtime), baseRevision: state.revision }
  } else {
    if (request?.notificationOperationId === null)
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Scenario cases cannot impersonate Channel-delivered resolution')
    if (world.definition.directorEntityId !== decision.entityId || request?.status !== 'open')
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'World resolution requires its trusted director and open request')
    assertWorldExecutionReconciled(world, request.id)
    const attempts = Object.values(state.decisions).filter(value => value.id !== decision.id
      && value.context?.status === 'prepared' && value.context.world?.kind === 'resolve'
      && value.context.world.requestId === request.id)
    if (attempts.length >= world.definition.limits.maxPlansPerRequest) {
      throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World planning attempt limit exceeded', 'plans')
    }
    const notificationId = latestWorldEvidence(state, request.id)?.notificationOperationId ?? request.notificationOperationId
    const notification = lookup(state.operations, notificationId)
    if (notification?.delivery?.receipt === undefined
    || notification.delivery.sessionId !== lookup(state.entities, decision.entityId)?.binding?.sessionId
      || notification.outbox?.receipt === undefined || notification.result?.status !== 'applied'
      || notification.action.kind !== 'communication/post' || BigInt(notification.action.deliverAt) > BigInt(state.time)) {

      throw new SimulationWorldError('SIM_WORLD_DELIVERY',
        'World resolution requires its original due notification and persisted recipient input')
    }
    authority = { kind: 'resolve', pin: request.pin, intentId: intent.id, reads: worldExecutionReads(state, intent, runtime),
      baseRevision: state.revision,
      requestId: request.id, notificationOperationId: notificationId }
  }
  const sources: SimulationContextReference[] = [
    { kind: 'run-event', runId: state.spec.runId, sequence: world.sequence },
    { kind: 'run-event', runId: state.spec.runId, sequence: intent.sequence },
  ]
  if (request !== undefined) {
    if (request.notificationOperationId === null)
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Role context lost its actual notification')
    sources.push({ kind: 'run-event', runId: state.spec.runId, sequence: request.sequence })
    const revision = latestWorldEvidence(state, request.id)
    if (revision !== undefined) sources.push({ kind: 'run-event', runId: state.spec.runId, sequence: revision.sequence })
    const receipt = lookup(state.operations, latestWorldEvidence(state, request.id)?.notificationOperationId
      ?? request.notificationOperationId)?.outbox?.receipt
    if (receipt === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World context lost its original publication')
    sources.push({ kind: 'team-envelope', teamId: receipt.teamId, channelId: receipt.channelId, envelopeId: receipt.envelopeId })
  }
  return { authority, sources, text: JSON.stringify({ kind: 'world-context', operation: intent.pin, authority,
    ...requireWorldRuntime(runtime).context(intent.pin, state.revision).planningContext(state, intent, decision.entityId) as object,
    ...request === undefined ? {} : { request: { id: request.id, description: request.description,
      evidence: latestWorldEvidence(state, request.id) ?? null,
      evidenceFields: installed(state, intent.pin, runtime).definition.evidenceFields ?? [],
      priorPlan: request.plans.at(-1) === undefined ? null : lookup(world.plans,
        request.plans.at(-1) as import('@clocky/clocky-simulation').WorldPlanId) } } }) }
}

function assertScenarioWake(state: SimulationSnapshot, decision: SimulationDecision, id: string,
  reason: string, time: import('@clocky/clocky-simulation').SimTime): void {
  const event = lookup(state.scheduledEvents, id), wake = lookup(state.wakes, id)
  if (decision.wakeId !== id || event?.action.kind !== 'wake' || event.status !== 'consumed'
    || event.action.entityId !== decision.entityId || event.action.reason !== reason || event.key.time !== time
    || wake?.decisionId !== decision.id || wake.status !== 'claimed' && wake.status !== 'completed')
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Scenario context requires its exact claimed Native causal wake')
}

function directorWorldContext(state: SimulationSnapshot, decision: SimulationDecision, runtime?: NativeWorldRuntime): {
  authority: Extract<SimulationWorldContext, { kind: 'director-event' }>
  text: string
  sources: SimulationContextReference[]
} {
  const world = requireWorld(state)
  if (decision.entityId !== world.definition.directorEntityId || decision.wakeId === undefined)
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Director environment requests require their actual original wake')
  cognitive(state, decision.entityId)
  if (activePersonnelFences(state, decision.entityId).length)
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Retiring director cannot start another scenario request')
  const trigger = directorTriggerFromWake(state, decision.wakeId), declaration = assertDirectorTrigger(state, trigger)
  assertScenarioWake(state, decision, decision.wakeId, directorEventReason(state, trigger), trigger.time)
  const pin = world.definition.operations.find(value => value.domain === declaration.domain
    && value.operation === declaration.operation && value.version === declaration.version)
  if (pin === undefined || installed(state, pin, runtime).definition.directorEvents !== true)
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Original operation does not support scenario-directed environment requests')
  const authority = { kind: 'director-event' as const, trigger, pin, businessKey: directorEventBusinessKey(trigger),
    scopeEntityId: declaration.scopeId, targetEntityId: declaration.targetId, baseRevision: state.revision }
  return { authority, sources: [
    { kind: 'run-event', runId: state.spec.runId, sequence: trigger.bootstrapSequence },
    { kind: 'run-event', runId: state.spec.runId, sequence: trigger.sequence },
  ], text: JSON.stringify({ kind: 'world-context', authority,
    budget: { maxRequests: declaration.maxRequests, charged: directorRequestCount(state, declaration.id) },
    subject: publicEntity(state, declaration.targetId),
    externalIdentities: Object.values(world.external.identities).filter(value => value.scope === declaration.scopeId
      && value.subjectRef === declaration.targetId).map(value => ({ externalKey: value.externalKey, subjectRef: value.subjectRef })),
    requestSchema: z.toJSONSchema(installed(state, pin, runtime).definition.schemas.request, { io: 'input' }),
    instruction: 'Only this recorded scene declaration permits an environment request. Use its exact business key, selector, scope and target. '
      + 'Submit no actions when its independent request budget is exhausted.' }) }
}

function scenarioResolveContext(state: SimulationSnapshot, decision: SimulationDecision,
  requestId: import('@clocky/clocky-simulation').WorldRequestId, runtime?: NativeWorldRuntime): {
  authority: Extract<SimulationWorldContext, { kind: 'scenario-resolve' }>
  text: string
  sources: SimulationContextReference[]
} {
  const world = requireWorld(state), request = world.requests[requestId]
  const intent = request === undefined ? undefined : world.intents[request.intentId]
  if (decision.entityId !== world.definition.directorEntityId || request?.status !== 'open'
    || request.notificationOperationId !== null || intent?.scenarioTrigger === undefined
    || !isDeepStrictEqual(worldDecisionSource(request).trigger, intent.scenarioTrigger))
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Scenario resolution requires its original director request and Native source')
  assertWorldExecutionReconciled(world, request.id)
  if (decision.wakeId === undefined) {
    const last = request.plans.at(-1), previous = last === undefined ? undefined : world.plans[last]
    if (previous?.status !== 'stale')
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Scenario replan requires its retained stale plan')
  } else {
    const source = state.decisions[worldDecisionSource(request).decisionId]
    if (source === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Scenario planning lost its original request decision')
    assertScenarioWake(state, decision, `simulation-world-scenario-resolve:${request.id}`,
      JSON.stringify({ scenarioRequestId: request.id }), source.time)
  }
  const attempts = Object.values(state.decisions).filter(value => value.id !== decision.id && value.context?.status === 'prepared'
    && value.context.world?.kind === 'scenario-resolve' && value.context.world.requestId === requestId)
  if (attempts.length >= world.definition.limits.maxPlansPerRequest)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Scenario planning attempt limit exceeded', 'plans')
  const authority = { kind: 'scenario-resolve' as const, pin: intent.pin, trigger: intent.scenarioTrigger,
    intentId: intent.id, requestId, reads: worldExecutionReads(state, intent, runtime), baseRevision: state.revision }
  return { authority, sources: [
    { kind: 'run-event', runId: state.spec.runId, sequence: intent.scenarioTrigger.bootstrapSequence },
    { kind: 'run-event', runId: state.spec.runId, sequence: intent.scenarioTrigger.sequence },
    { kind: 'run-event', runId: state.spec.runId, sequence: request.sequence },
  ], text: JSON.stringify({ kind: 'world-context', authority,
    ...requireWorldRuntime(runtime).context(intent.pin, state.revision).planningContext(state, intent, decision.entityId) as object,
    request: { id: request.id, description: request.description, priorPlan: request.plans.at(-1) === undefined ? null
      : lookup(world.plans, String(request.plans.at(-1))) } }) }
}

function scenarioResultContext(state: SimulationSnapshot, decision: SimulationDecision,
  resultId: import('@clocky/clocky-simulation').WorldResultId,
  externalEventId?: import('@clocky/clocky-simulation').SimulationEventId): {
  authority: Extract<SimulationWorldContext, { kind: 'scenario-result' }>
  text: string
  sources: SimulationContextReference[]
} {
  const world = requireWorld(state), initial = world.results[resultId]
  const duty = externalEventId === undefined ? undefined : world.external.events[externalEventId]
  if (externalEventId !== undefined && (duty?.status !== 'consumed' || duty.consumption === undefined
    || duty.original.initialResultId !== initial?.id || duty.original.intentId !== initial.intentId
    || duty.consumption.sequence > decision.snapshotRevision))
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Scenario follow-up requires its original consumed environment leaf')
  const result = duty?.consumption === undefined || initial === undefined ? initial : { ...initial,
    payload: duty.consumption.resultPayload, time: duty.consumption.time, sequence: duty.consumption.sequence }
  const intent = result === undefined ? undefined : world.intents[result.intentId]
  if (decision.entityId !== world.definition.directorEntityId || intent?.scenarioTrigger === undefined || result === undefined
    || world.requests[result.requestId]?.notificationOperationId !== null)
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Scenario result belongs only to its actual originating director')
  assertDirectorTrigger(state, intent.scenarioTrigger)
  assertScenarioWake(state, decision, externalEventId === undefined ? `simulation-world-result:${result.id}`
    : `simulation-external-adjudication-result:${externalEventId}`,
  JSON.stringify({ resultId: result.id, ...externalEventId === undefined ? {} : { externalEventId } }), result.time)
  const authority = { kind: 'scenario-result' as const, intentId: intent.id, resultId,
    trigger: intent.scenarioTrigger, baseRevision: state.revision,
    ...externalEventId === undefined ? {} : { externalEventId } }
  return { authority, sources: [{ kind: 'run-event', runId: state.spec.runId, sequence: result.sequence }],
    text: JSON.stringify({ kind: 'world-context', authority, result: { id: result.id, outcome: result.outcome, payload: result.payload },
      instruction: 'This is the Native result of the recorded environment event. No fabricated Channel response is required.' }) }
}

function goalWorldContext(state: SimulationSnapshot, decision: SimulationDecision, runtime?: NativeWorldRuntime): {
  authority: Extract<SimulationWorldContext, { kind: 'goal' }>
  text: string
  sources: SimulationContextReference[]
} {
  const world = requireWorld(state)
  cognitive(state, decision.entityId)
  if (activePersonnelFences(state, decision.entityId).length)
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Original employment closes new role goals')
  const employed = currentAssignments(state, decision.entityId, world.definition.organizationEntityId)
  const assignments = employed.length ? employed : candidateMembership(state, decision.entityId, world.definition.organizationEntityId)
  if (!assignments.length) throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'World goal requires current employment')
  const operations = world.definition.operations.flatMap((pin) => {
    if (!employed.length && !isDeepStrictEqual(pin, WORLD_HIRING_MARKET_PIN)) return []
    installed(state, pin, runtime)
    const grants = operationGrants(state, decision.entityId, pin).map(({ relation }) => ({ kind: 'relation' as const,
      id: relation.id, revision: relation.revision, effectiveFrom: relation.validFrom, effectiveUntil: relation.validUntil }))
    return grants.length ? [{ pin, grants }] : []
  })
  if (!operations.length) throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'World goal has no installed operation permission')
  const authority = { kind: 'goal' as const, baseRevision: state.revision, operations,
    assignments: assignments.map(value => ({ id: value.id, revision: value.revision })) }
  return { authority, sources: [ { kind: 'run-event', runId: state.spec.runId, sequence: world.sequence },
    { kind: 'run-event', runId: state.spec.runId, sequence: decision.snapshotRevision } ],
  text: JSON.stringify({ kind: 'world-context', authority, operations: operations.map(value => ({ ...value,
    ...world.definition.modelProtocol === 'bounded-v1' && value.pin.domain === 'organization'
      && value.pin.operation === 'generate-and-hire' && value.pin.version === '1'
      ? { requestEnvelope: WORLD_HIRING_REQUEST_ENVELOPE } : {},
    targets: operationGrants(state, decision.entityId, value.pin).map(({ grant }) => ({ targetEntityId: grant.targetEntityId,
      scopeEntityId: grant.scopeEntityId })),
    material: requireWorldRuntime(runtime).context(value.pin, state.revision).goalContext?.(state, decision.entityId) ?? null,
    requestSchema: z.toJSONSchema(installed(state, value.pin, runtime).definition.schemas.request, { io: 'input' }) })),
  organizationEntityId: world.definition.organizationEntityId,
  positions: world.definition.positions,
  instruction: 'Propose only an installed operation with a stable business key. A goal grants no new authority.' }) }
}

function publicEntity(state: SimulationSnapshot, id: SimulationEntityId) {
  const profile = lookup(state.entities, id)?.profile
  return { id, ...typeof profile?.name === 'string' ? { name: profile.name } : {},
    ...typeof profile?.description === 'string' ? { description: profile.description } : {} }
}

function terminalWorldContext(state: SimulationSnapshot, decision: SimulationDecision,
  selection: Extract<NonNullable<SimulationContextRequest['world']>, { kind: 'result' | 'first-action' }>, runtime?: NativeWorldRuntime) {
  const world = requireWorld(state), initial = lookup(world.results, selection.resultId)
  if (initial === undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'World context has no original terminal result')
  const externalEventId = selection.kind === 'result' ? selection.externalEventId : undefined
  const duty = externalEventId === undefined ? undefined : world.external.events[externalEventId]
  if (externalEventId !== undefined && (duty?.status !== 'consumed' || duty.consumption === undefined
    || duty.original.initialResultId !== initial.id || duty.original.intentId !== initial.intentId
    || !isDeepStrictEqual(world.requests[initial.requestId]?.pin, WORLD_EXTERNAL_MEDIATED_PIN)
    || duty.consumption.sequence > decision.snapshotRevision))
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Adjudication follow-up requires its actual original consumed leaf')
  const result = duty?.consumption === undefined ? initial : { ...initial, payload: duty.consumption.resultPayload,
    time: duty.consumption.time, sequence: duty.consumption.sequence }
  const request = lookup(world.requests, result.requestId), intent = lookup(world.intents, result.intentId)
  if (request?.intentId !== result.intentId || request.status !== result.outcome.kind || intent?.requestId !== request.id)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World result lost its original business identity')
  const projected = externalEventId === undefined
    ? installed(state, intent.pin, runtime).resultContext?.(state, intent, result, selection.kind) : undefined
  if (selection.kind === 'first-action' && projected === undefined)
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Installed domain has no first-action consequence')
  const expectedActor = selection.kind === 'result' ? worldResultNotificationActor(state, result, runtime)
    : projected?.expectedActorId ?? request.requesterEntityId
  if (projected !== undefined && projected.expectedActorId !== expectedActor)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Result context disagrees with its original pinned notification role')
  const expectedWake = externalEventId !== undefined ? `simulation-external-adjudication-result:${externalEventId}`
    : selection.kind === 'result' ? `simulation-world-result:${result.id}` : `simulation-world-first:${result.intentId}`
  const event = lookup(state.scheduledEvents, expectedWake), wake = lookup(state.wakes, expectedWake)
  if (expectedActor !== decision.entityId || decision.wakeId !== expectedWake || event?.action.kind !== 'wake'
    || event.status !== 'consumed' || event.action.entityId !== expectedActor || event.key.time !== result.time
    || event.action.reason !== JSON.stringify({ resultId: result.id, ...externalEventId === undefined ? {} : { externalEventId } })
    || wake?.decisionId !== decision.id
    || wake.status !== 'claimed' && wake.status !== 'completed')
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'World result requires its original actor and claimed causal wake')
  if (decision.status !== 'accepted') cognitive(state, decision.entityId)
  const recipient = projected?.recipient ?? (expectedActor === world.definition.directorEntityId
    ? request.requesterEntityId : world.definition.directorEntityId)
  const channelId = projected?.channelId ?? (request.requesterEntityId === null ? undefined : lookup(world.channels,
    request.requesterEntityId))
  if (channelId === undefined || recipient === null)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World result lost its original private Channel')
  const channel = Object.values(state.channelReservations ?? {}).find(value => value.channelId === channelId)
  if (channel?.confirmed !== true || channel.spec.members.length !== 2 || expectedActor === recipient
    || !channel.spec.members.some(member => member.entityId === expectedActor)
    || !channel.spec.members.some(member => member.entityId === recipient))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World result notification lost its exact canonical private endpoints')
  const authority: Extract<SimulationWorldContext, { kind: 'result' | 'first-action' }> = selection.kind === 'result'
    ? { kind: 'result', resultId: result.id, intentId: intent.id, baseRevision: state.revision,
      ...externalEventId === undefined ? {} : { externalEventId },
      notification: { kind: 'communication/post', recipient, channelId, text: worldResultNotification(result), deliverAt: state.time } }
    : { kind: 'first-action', resultId: result.id, intentId: intent.id, baseRevision: state.revision }
  return { authority, communication: { recipient, channelId }, sources: [
    { kind: 'run-event' as const, runId: state.spec.runId, sequence: world.sequence },
    { kind: 'run-event' as const, runId: state.spec.runId, sequence: intent.sequence },
    { kind: 'run-event' as const, runId: state.spec.runId, sequence: result.sequence } ],
  text: JSON.stringify({ kind: 'world-context', authority, result: { id: result.id, outcome: result.outcome,
    payload: result.payload, time: result.time },
  organization: publicEntity(state, intent.scopeEntityId), requesterEntityId: request.requesterEntityId,
  ...projected?.facts as object, ...selection.kind === 'first-action' ? { communication: { recipient, channelId } } : {} }) }
}

function assertNever(value: never): never {
  throw new Error(`Unknown world context purpose: ${String(value)}`)
}
function consumed(decision: SimulationDecision): SimulationWorldContext {
  if (decision.context?.status !== 'prepared' || decision.context.world === undefined || decision.consumption === undefined) {
    throw new SimulationWorldError('SIM_WORLD_CONTEXT', 'World operation requires its consumed Native-selected context')
  }
  return decision.context.world
}

function proposedWorldIntent(state: SimulationSnapshot, decision: SimulationDecision,
  action: Extract<SimulationOperation['action'], { kind: 'world/request' }>, runtime?: NativeWorldRuntime) {
  const context = consumed(decision)
  const pin = context.kind === 'goal' ? context.operations.find(value => value.pin.domain === action.domain
    && value.pin.operation === action.operation && value.pin.version === action.version)?.pin : 'pin' in context ? context.pin : undefined
  if (pin === undefined) throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Request has no consumed installed operation')
  const intent = createWorldIntent(state, decision.entityId, action, pin, state.revision + 1, runtime,
    context.kind === 'director-event' ? context.trigger : undefined)
  if (context.kind === 'director-event') {
    if (decision.status !== 'accepted') {
      const current = directorWorldContext(state, decision, runtime).authority
      if (!isDeepStrictEqual(current.trigger, context.trigger) || !isDeepStrictEqual(current.pin, context.pin)
        || current.businessKey !== context.businessKey)
        throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Director event lost its consumed original scenario authority')
    }
    return { intent, admitted: { description: intent.description } }
  }
  if (context.kind === 'goal' && decision.status !== 'accepted') {
    if (retainedRequest(state, intent) === undefined) {
      const retained = lookup(requireWorld(state).intents, intent.id)
      const current = installed(state, intent.pin, runtime).admitRequest(state, decision.entityId, action, retained)
      if (current.scopeEntityId !== intent.scopeEntityId || current.targetEntityId !== intent.targetEntityId)
        throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Unaccepted intent lost its original domain scope or target')
    }
    const current = goalWorldContext(state, decision, runtime).authority
    const original = context.operations.find(value => isDeepStrictEqual(value.pin, pin))
    const live = current.operations.find(value => isDeepStrictEqual(value.pin, pin))
    if (!isDeepStrictEqual(context.assignments, current.assignments) || !isDeepStrictEqual(original, live))
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Request lost its consumed employment or operation grant')
  } else if (context.kind !== 'goal' && (context.kind !== 'request' || context.intentId !== intent.id))
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Request requires its consumed goal or original intent context')
  if (context.kind === 'request' && decision.status !== 'accepted') {
    const receipt = retainedRequest(state, intent)
    const reads = receipt !== undefined && receipt.sequence <= context.baseRevision ? [] : worldExecutionReads(state, intent, runtime)
    if (!isDeepStrictEqual(context.reads, reads))
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'World request lost its consumed scoped authority')
  }
  return { intent, admitted: { description: intent.description } }
}
function requestId(state: SimulationSnapshot, decision: SimulationDecision) {
  return worldRequestIdSchema.parse(`world-request:${businessFingerprint([state.spec.runId, decision.id, 0]).slice(7)}`)
}
/**
 * Render only the canonical request identity and payload fingerprint.
 * @param request - Original case identity.
 * @returns canonical index-only private notification text.
 */
export function worldNotification(request: Pick<SimulationWorldRequest, 'id' | 'payloadHash'>): string {
  return JSON.stringify({ requestId: request.id, hash: request.payloadHash })
}
/**
 * Authorize one logical world action and expand its standard private notification.
 * @param state - Current authority.
 * @param decision - Owned decision.
 * @param proposals - Logical model proposals.
 * @param runtime - Original explicit World parser/reducer catalog; absent only for base simulation operations.
 * @returns frozen executor proposals after trusted expansion.
 */
export function expandWorldProposals(state: SimulationSnapshot, decision: SimulationDecision,
  proposals: readonly SimulationProposal[], runtime?: NativeWorldRuntime):
readonly SimulationProposal[] {
  const scope = decision.context?.status === 'prepared' ? decision.context.world : undefined
  if (scope !== undefined) {
    switch (scope.kind) {
      case 'director-event':
        consumed(decision)
        if (proposals.length === 0) return proposals
        if (proposals.length !== 1 || proposals[0]?.action.kind !== 'world/request')
          throw new SimulationWorldError('SIM_WORLD_AUTHORITY',
            'A scenario event accepts only its original environment request or no effect')
        break
      case 'scenario-resolve':
        if (proposals.length !== 1 || proposals[0]?.action.kind !== 'world/resolve')
          throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Scenario planning requires its exact recorded case')
        break
      case 'scenario-result': {
        consumed(decision)
        const selected = scenarioResultContext(state, decision, scope.resultId, scope.externalEventId)
        if (selected.authority.intentId !== scope.intentId || !isDeepStrictEqual(selected.authority.trigger, scope.trigger))
          throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Scenario result changed its consumed business authority')
        if (proposals.length !== 0)
          throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Scenario result observation cannot fabricate another action')
        return proposals
      }
      case 'evidence':
        consumed(decision)
        if (proposals.length === 0) return proposals
        if (proposals.length !== 1 || proposals[0]?.action.kind !== 'world/evidence')
          throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Evidence context accepts only its original answer or no effect')
        break
      case 'goal': consumed(decision); break
      case 'request':
      case 'resolve': {
        const expected = scope.kind === 'request' ? 'world/request' : 'world/resolve'
        if (proposals.length !== 1 || proposals[0]?.action.kind !== expected) {
          throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'World-scoped decisions require their exact request or resolution')
        }
        break
      }
      case 'result':
      case 'first-action': {
        consumed(decision)
        const selected = terminalWorldContext(state, decision, { kind: scope.kind, resultId: scope.resultId,
          ...scope.kind === 'result' && scope.externalEventId !== undefined ? { externalEventId: scope.externalEventId } : {} }, runtime)
        const result = requireWorld(state).results[scope.resultId]
        const proposal = proposals[0]
        if (selected.authority.intentId !== scope.intentId || result === undefined
          || scope.baseRevision < result.sequence || scope.baseRevision > state.revision
          || proposals.length !== 1 || proposal?.after.length !== 0 || proposal.action.kind !== 'communication/post') {
          throw new SimulationWorldError('SIM_WORLD_AUTHORITY',
            'World terminal decisions require one consumed, original-purpose private communication')
        }
        if (scope.kind === 'result') {
          if (selected.authority.kind !== 'result'
            || !isDeepStrictEqual(scope.notification, { ...selected.authority.notification, deliverAt: scope.notification.deliverAt })
            || !isDeepStrictEqual(proposal.action, scope.notification)) {
            throw new SimulationWorldError('SIM_WORLD_AUTHORITY',
              'World result communication differs from its exact frozen Native notification')
          }
        } else if (proposal.action.recipient !== selected.communication.recipient
          || proposal.action.channelId !== selected.communication.channelId) {
          throw new SimulationWorldError('SIM_WORLD_AUTHORITY',
            'World first action must introduce the generated person to its original requester')
        }
        return proposals
      }
      default: return assertNever(scope)
    }
  } else if (state.world?.definition.directorEntityId === decision.entityId) {
    if (proposals.some(proposal => proposal.action.kind !== 'communication/post')) {
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY',
        'Director world plans require their resolution context; ordinary decisions allow private communication only')
    }
  }
  if (!proposals.some(value => value.action.kind.startsWith('world/'))) return proposals
  if (proposals.length !== 1 || proposals[0]?.after.length !== 0)
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'A world decision accepts one unmixed logical operation')
  const proposal = proposals[0], action = proposal.action, world = requireWorld(state), context = consumed(decision)
  if (action.kind === 'world/request') {
    const selected = proposedWorldIntent(state, decision, action, runtime)
    const intent = selected.intent
    if (context.kind !== 'request' && context.kind !== 'goal' && context.kind !== 'director-event'
      || context.kind === 'request' && context.intentId !== intent.id
      || intent.requesterEntityId !== decision.entityId) {
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'World request cannot change its actor or business application')
    }
    const prior = intent.requestId === undefined ? undefined : lookup(world.requests, intent.requestId)
    const payloadHash = businessFingerprint(action)
    if (prior !== undefined && prior.payloadHash !== payloadHash)
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'World business application changed its request payload')
    if (prior !== undefined && prior.operationId !== operationId(state.spec.runId, decision.id, 0)) return proposals
    if (prior === undefined) assertWorldRequestBudget(state, decision.entityId, decision.time)
    if (Buffer.byteLength(JSON.stringify(action), 'utf8') > world.definition.limits.maxBytesPerRequest)
      throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World request byte limit exceeded', 'bytes')
    if (context.kind === 'director-event') return [proposal]
    const channelId = lookup(world.channels, decision.entityId)
    if (channelId === undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'World request has no private director channel')
    return [proposal, { after: [0], action: { kind: 'communication/post', recipient: world.definition.directorEntityId,
      channelId, text: worldNotification({ id: requestId(state, decision), payloadHash }), deliverAt: decision.time } }]
  }
  if (action.kind === 'world/evidence') {
    const original = Object.values(world.evidence.revisions).find(value =>
      value.source.operationId === operationId(state.spec.runId, decision.id, 0))
    if (decision.status === 'accepted' && original !== undefined) {
      if (original.hash !== businessFingerprint(action))
        throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Accepted evidence changed on retry')
      const notice = world.evidence.revisions[original.id] === undefined ? undefined : state.operations[original.notificationOperationId]
      if (notice?.action.kind !== 'communication/post')
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Original evidence notice is missing')
      return [proposal, { after: [0], action: notice.action }]
    }
    validateWorldEvidenceSupply(state, decision, action)
    const request = world.requests[action.requestId]
    if (request === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence lost its original request')
    const channelId = world.channels[decision.entityId]
    if (channelId === undefined) throw new SimulationWorldError('SIM_WORLD_DELIVERY', 'Evidence answer lost its private director Channel')
    const revisionId = worldEvidenceRevisionIdSchema.parse(`world-evidence-input:${operationId(state.spec.runId, decision.id, 0)}`)
    return [proposal, { after: [0], action: { kind: 'communication/post', recipient: world.definition.directorEntityId,
      channelId, text: worldEvidenceRevisionNotice(revisionId, request.id), deliverAt: decision.time } }]
  }
  if (action.kind !== 'world/resolve') throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Unknown world operation')
  if ((context.kind !== 'resolve' && context.kind !== 'scenario-resolve') || context.requestId !== action.requestId
    || decision.entityId !== world.definition.directorEntityId
    || context.kind === 'resolve' && decision.consumption?.notification?.operationId !== context.notificationOperationId) {

    throw new SimulationWorldError('SIM_WORLD_AUTHORITY',
      'World resolution requires the actual trusted director and exact delivered request')
  }
  const retained = lookup(world.plans, worldPlanIdSchema.parse(`world-plan:${operationId(state.spec.runId, decision.id, 0)}`))
  if (decision.status === 'accepted' && retained !== undefined) {
    if (!isDeepStrictEqual(retained.proposal, action))
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'World accepted plan changed its payload')
    if (action.resolution.kind === 'awaiting-evidence') {
      const question = Object.values(world.evidence.challenges).find(value => value.planId === retained.id)
      const notice = question === undefined ? undefined : state.operations[question.notificationOperationId]
      if (notice?.action.kind !== 'communication/post')
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Original evidence question notice is missing')
      return [proposal, { after: [0], action: notice.action }]
    }
    return proposals
  }
  const request = lookup(world.requests, action.requestId)
  if (request === undefined || request.status !== 'open')
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'World resolution has no open case')
  assertWorldExecutionReconciled(world, request.id)
  if (request.plans.some(id => hasAcceptedHiringOffer(state, id)))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'An accepted offer freezes its original hiring plan')
  if (Buffer.byteLength(JSON.stringify(action), 'utf8') > world.definition.limits.maxBytesPerPlan)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World plan byte limit exceeded', 'bytes')
  const planId = worldPlanIdSchema.parse(`world-plan:${operationId(state.spec.runId, decision.id, 0)}`)
  if (!Object.hasOwn(world.plans, planId)) {
    if (request.plans.length >= world.definition.limits.maxPlansPerRequest)
      throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World planning attempt limit exceeded', 'plans')
    if ((request.plans.at(-1) ?? null) !== action.supersedes)
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'World plan must identify its exact predecessor')
  }
  const intent = lookup(world.intents, request.intentId)
  if (intent === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Plan lost its original intent')
  const module = installed(state, request.pin, runtime)
  if (action.resolution.kind === 'awaiting-evidence') {
    validateWorldEvidenceAsk(state, decision, request, action.resolution, requireWorldRuntime(runtime))
    if (request.requesterEntityId === null)
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'User direct plans are not model resolutions')
    const channelId = world.channels[request.requesterEntityId]
    if (channelId === undefined) throw new SimulationWorldError('SIM_WORLD_DELIVERY', 'Evidence question lost the original private Channel')
    const challengeId = worldEvidenceChallengeIdSchema.parse(`world-evidence:${planId}`)
    return [proposal, { after: [0], action: { kind: 'communication/post', recipient: request.requesterEntityId,
      channelId, text: worldEvidenceNotice(challengeId, request.id), deliverAt: decision.time } }]
  }
  if (action.resolution.kind === 'apply') parseSimulationWorldSchema(module.definition.schemas.plan, action.resolution.payload)
  module.validatePlan(state, intent, action.resolution)
  return proposals
}
/**
 * Close fresh Native acceptance when an operation registration retires, while replay keeps original pure leases.
 * @param state - Current authoritative projection.
 * @param proposals - Actual proposed actions, without caller-selected implementation pins.
 * @param runtime - Explicit original owner catalog.
 */
export function assertWorldAdmission(state: SimulationSnapshot, proposals: readonly SimulationProposal[],
  runtime?: NativeWorldRuntime): void {
  for (const { action } of proposals) {
    if (action.kind !== 'world/request' && action.kind !== 'world/resolve' && action.kind !== 'world/evidence') continue
    const world = requireWorld(state)
    const pin = action.kind === 'world/request' ? world.definition.operations.find(value => value.domain === action.domain
      && value.operation === action.operation && value.version === action.version) : world.requests[action.requestId]?.pin
    if (pin === undefined) throw new SimulationWorldError('SIM_WORLD_AUTHORITY',
      'Operation is absent from the original installed World manifest')
    requireWorldRuntime(runtime).admitting(pin)
  }
}

/**
 * Retain accepted request or complete plan metadata without allocating a person.
 * @param state - Projection including this intent.
 * @param operation - Accepted exact operation.
 * @param sequence - Durable position.
 * @param runtime - Original explicit World parser/reducer catalog; absent only for base simulation operations.
 * @returns request or complete plan metadata, with no hiring effect.
 */
export function acceptWorldOperation(state: SimulationSnapshot, operation: SimulationOperation, sequence: number,
  runtime?: NativeWorldRuntime): SimulationSnapshot {
  const decision = lookup(state.decisions, operation.decisionId)
  if (decision === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World operation lost its accepted decision')
  const action = operation.action, world = requireWorld(state), context = consumed(decision)
  const expectedPin = context.kind === 'goal' ? context.operations.find(value => isDeepStrictEqual(value.pin, operation.worldPin))?.pin
    : 'pin' in context ? context.pin : undefined
  if (operation.worldPin === undefined || !isDeepStrictEqual(operation.worldPin, expectedPin))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World operation has no original consumed implementation pin')
  const expanded = expandWorldProposals(state, decision, [{ after: [], action }], runtime)
  if (operation.index !== 0 || operation.dependencies.length !== 0 || decision.operationIds.length !== expanded.length) {
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World intent differs from its sole logical operation expansion')
  }
  if (action.kind === 'world/request') {
    const { intent, admitted } = proposedWorldIntent(state, decision, action, runtime)
    if (intent.requestId !== undefined) return state
    assertWorldRequestBudget(state, decision.entityId, decision.time)
    const actor = cognitive(state, decision.entityId)
    const request: SimulationWorldRequest = { id: requestId(state, decision), intentId: intent.id, operationId: operation.id,
      notificationOperationId: intent.scenarioTrigger === undefined ? operationId(state.spec.runId, decision.id, 1) : null,
      requesterEntityId: decision.entityId,
      proposal: action, pin: operation.worldPin,
      source: { kind: 'decision', decisionId: decision.id, epoch: decision.epoch, binding: actor.binding,
        ...intent.scenarioTrigger === undefined ? {} : { trigger: intent.scenarioTrigger } },
      description: admitted.description, payloadHash: businessFingerprint(action), sequence, plans: [], status: 'open' }
    let next = { ...state, world: { ...world, intents: { ...world.intents, [intent.id]: { ...intent, requestId: request.id } },
      requests: { ...world.requests, [request.id]: request } } }
    const responsibility = installed(state, intent.pin, runtime).acceptedResponsibility
    switch (responsibility) {
      case 'external-actor-identity':
        next = { ...next, world: { ...next.world, external: acceptExternalActorIdentity(next, intent, request.id, sequence) } }
        break
      case 'external-identity':
        next = { ...next, world: { ...next.world, external: acceptExternalIdentity(next, intent, request.id, sequence) } }
        break
      case 'external-mediated-identity':
        next = { ...next, world: { ...next.world, external: acceptExternalMediatedIdentity(next, intent, request.id, sequence) } }
        break
      case 'personnel-departure':
        next = { ...next, world: requireWorld(acceptDepartureFence(next, intent, request.id, sequence)) }
        break
      case 'governance-route': {
        const route = prepareGovernanceRoute(next, operation, sequence)
        if (Buffer.byteLength(JSON.stringify(route), 'utf8') > world.definition.limits.maxBytesPerRequest)
          throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Complete route exceeds its retained request allowance', 'bytes')
        next = { ...next, world: { ...next.world, governance: { ...world.governance,
          routes: { ...world.governance.routes, [route.id]: route } } } }
        break
      }
      case 'governance-delegation': {
        const grant = prepareGovernanceDelegation(next, operation, sequence)
        if (Buffer.byteLength(JSON.stringify(grant), 'utf8') > world.definition.limits.maxBytesPerRequest)
          throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Complete delegation exceeds its retained request allowance', 'bytes')
        next = { ...next, world: { ...next.world, governance: { ...world.governance,
          delegations: [...world.governance.delegations ?? [], grant] } } }
        break
      }
      case 'governance-proposal':
      case 'governance-vote': {
        const change = responsibility === 'governance-proposal'
          ? { kind: 'world/governance-proposed' as const,
            proposal: prepareGovernanceProposal(next, world.governance, operation, sequence) }
          : { kind: 'world/governance-voted' as const,
            vote: prepareGovernanceVote(next, world.governance, operation, sequence) }
        if (Buffer.byteLength(JSON.stringify(change), 'utf8') > world.definition.limits.maxBytesPerRequest)
          throw new SimulationWorldError('SIM_WORLD_LIMIT',
            'Complete governance contribution exceeds its retained request allowance', 'bytes')
        next = { ...next, world: { ...next.world, governance: foldWorldGovernance(next, world.governance, change, sequence) } }
        break
      }
      case undefined: break
      default: return assertNever(responsibility)
    }
    return next
  }
  if (action.kind === 'world/evidence') return state
  if (action.kind !== 'world/resolve' || context.kind !== 'resolve' && context.kind !== 'scenario-resolve')
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'World intent has no matching operation')
  const request = lookup(world.requests, action.requestId)
  const intent = request === undefined ? undefined : lookup(world.intents, request.intentId)
  if (request === undefined || intent === undefined)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World plan lost its accepted business request')
  assertWorldExecutionReconciled(world, request.id)
  let planningReads = context.reads
  if (action.generationJobId !== undefined) {
    const generated = generationRecordAt(state, action.generationJobId)
    const proposal = generated?.content === undefined ? undefined : simulationGeneratedPlanSchema.parse(JSON.parse(generated.content))
    const decision = state.decisions[operation.decisionId]
    const material = generated === undefined ? undefined : generationPlanInput(generated)
    if (generated?.status !== 'validated' || generated.cancellation !== undefined || proposal === undefined
      || BigInt(generated.job.deadline) <= BigInt(state.time) || !generated.job.audience.includes(world.definition.directorEntityId)
      || proposal.requestId !== request.id || proposal.domain !== request.pin.domain || proposal.scope !== intent.scopeEntityId
      || generated.job.planner?.requestId !== request.id || !isDeepStrictEqual(proposal.readSet, generated.planningReads)
      || proposal.effects[0]?.kind !== request.pin.operation || action.resolution.kind !== 'apply'
      || !isDeepStrictEqual(proposal.effects[0].payload, action.resolution.payload)
      || decision?.context?.status !== 'prepared' || !decision.context.view.content.some(section => section.blocks.some(block => block.type === 'text' && block.text === material)))
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Director must consume the exact validated helper plan before selecting it')
    planningReads = proposal.readSet
  }
  const plan: SimulationWorldPlan = { id: worldPlanIdSchema.parse(`world-plan:${operation.id}`), requestId: request.id,
    operationId: operation.id, proposal: action, pin: request.pin, reads: planningReads, baseRevision: context.baseRevision,
    sequence, hash: businessFingerprint(action), status: 'accepted' }
  if (request.plans.some(id => hasAcceptedHiringOffer(state, id))) {
    const original = world.plans[plan.id]
    if (hasAcceptedHiringOffer(state, plan.id) && original !== undefined && isDeepStrictEqual(original.proposal, action)) return state
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'An accepted offer freezes its original hiring plan')
  }
  const reason = action.resolution.kind === 'awaiting-evidence' ? undefined : worldPlanStaleReason(state, plan, runtime)
  const accepted: SimulationWorldPlan = reason === undefined ? plan : { ...plan, status: 'stale',
    stale: { phase: 'acceptance', reason, sequence } }
  return { ...state, world: { ...world, plans: { ...world.plans, [plan.id]: accepted },
    requests: { ...world.requests, [request.id]: { ...request, plans: [...request.plans, plan.id] } } } }
}

/**
 * Settle local request/plan recording; an apply plan does not execute a hire.
 * @param state - Accepted world records.
 * @param operation - Local request/plan intent.
 * @param runtime - Original explicit World parser/reducer catalog; absent only for base simulation operations.
 * @returns its deterministic recording outcome; never hires a person.
 */
export function settleWorldOperation(state: SimulationSnapshot, operation: SimulationOperation,
  runtime?: NativeWorldRuntime): SimulationSnapshot {
  const world = requireWorld(state)
  if (operation.action.kind === 'world/evidence') return state
  if (operation.action.kind === 'world/request') {
    if (!Object.values(world.requests).some(value => value.operationId === operation.id
      || isDeepStrictEqual(value.proposal, operation.action)))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World request lost its accepted case')
    return state
  }
  const plan = lookup(world.plans, worldPlanIdSchema.parse(`world-plan:${operation.id}`))
  if (plan === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World resolution lost its accepted plan')
  if (plan.status === 'stale' || plan.proposal.resolution.kind !== 'reject') return state
  const request = lookup(world.requests, plan.requestId)
  if (request === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World plan lost its request')
  if (request.status !== 'open') return state
  return withWorldResult(state, { id: worldResultIdentity(request.intentId), requestId: request.id, intentId: request.intentId,
    source: { kind: 'plan', planId: plan.id }, outcome: { kind: 'rejected', reason: plan.proposal.resolution.reason },
    payload: {}, time: state.time, sequence: state.revision + 1 }, runtime)
}
/**
 * Verify accepted expansion, byte budgets and request/notification/plan relationships.
 * @param state - Complete accepted batch or replay tail. Verify authoritative request, notification, plan and expansion relationships.
 * @param runtime - Original explicit World parser/reducer catalog; absent only for base simulation operations.
 */
export function assertWorldProjection(state: SimulationSnapshot, runtime?: NativeWorldRuntime): void {
  assertWorldExecutionProjection(state)
  assertWorldEvidenceProjection(state, runtime)
  for (const decision of Object.values(state.decisions)) {
    if (decision.status !== 'accepted') continue
    const first = decision.operationIds[0]
    const worldOperation = first !== undefined && lookup(state.operations, first)?.action.kind.startsWith('world/') === true
    const scope = decision.context?.status === 'prepared' ? decision.context.world : undefined
    if ((scope?.kind === 'request' || scope?.kind === 'resolve') && !worldOperation) {
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'World-scoped decision accepted an unauthorized ordinary action')
    }
    if (scope?.kind === 'result' || scope?.kind === 'first-action'
      || scope === undefined && state.world?.definition.directorEntityId === decision.entityId) {
      const proposals = decision.operationIds.map((id) => {
        const operation = lookup(state.operations, id)
        if (operation === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
          'World terminal communication lost its accepted intent')
        return { after: [...operation.dependencies], action: operation.action }
      })
      expandWorldProposals(state, decision, proposals, runtime)
    }
    if (worldOperation !== (decision.worldExpansion !== undefined)
      || worldOperation && (decision.worldExpansion?.logicalIndex !== 0
        || !isDeepStrictEqual(decision.worldExpansion.operationIds, decision.operationIds)))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World logical expansion differs from its accepted operation mapping')
    if (worldOperation) {
      const limits = requireWorld(state).definition.limits
      const intents = decision.operationIds.map((id) => {
        const operation = lookup(state.operations, id)
        if (operation === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World accepted batch lost an intent')
        return { kind: 'operation/intent', id, decisionId: decision.id, index: operation.index,
          action: operation.action, dependencies: operation.dependencies, fingerprint: operation.fingerprint,
          ...operation.worldPin === undefined ? {} : { worldPin: operation.worldPin } }
      })
      const acceptance = { kind: 'decision/accepted', id: decision.id, operationIds: decision.operationIds,
        worldExpansion: decision.worldExpansion, fingerprint: decision.fingerprint }
      const limit = intents[0]?.action.kind === 'world/resolve' ? limits.maxBytesPerPlan : limits.maxBytesPerRequest
      if (Buffer.byteLength(JSON.stringify([acceptance, ...intents]), 'utf8') > limit) {
        throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World accepted batch exceeds its retained byte limit', 'bytes')
      }
    }
  }
  const world = state.world
  if (world === undefined) {
    if (Object.values(state.operations).some(value => value.action.kind.startsWith('world/')))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World operations have no frozen definition')
    return
  }
  requireWorldRuntime(runtime).manifest(world.definition)
  assertWorldRequestBudgetProjection(state)
  assertWorldStructureBudgetProjection(state)
  for (const intent of Object.values(world.intents)) {
    const module = installed(state, intent.pin, runtime)
    parseSimulationWorldSchema(module.definition.schemas.request, intent.payload)
    if (intent.id !== worldIntentIdentity(state, { ...intent.pin, businessKey: intent.businessKey }))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World intent lost its original operation-scoped business identity')
    if (intent.scenarioTrigger !== undefined) {
      const declaration = assertDirectorTrigger(state, intent.scenarioTrigger)
      if (intent.requesterEntityId !== world.definition.directorEntityId || intent.sequence <= intent.scenarioTrigger.sequence
        || intent.businessKey !== directorEventBusinessKey(intent.scenarioTrigger) || module.definition.directorEvents !== true
        || intent.scopeEntityId !== declaration.scopeId || intent.targetEntityId !== declaration.targetId
        || intent.pin.domain !== declaration.domain || intent.pin.operation !== declaration.operation
        || intent.pin.version !== declaration.version
        || directorRequestCount(state, declaration.id) > declaration.maxRequests)
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
          'Scenario intent lost its original source, independent budget or exact permitted operation')
    }
  }
  for (const request of Object.values(world.requests)) {
    if (request.operationId === null) {
      const intent = world.intents[request.intentId], firstPlanId = request.plans[0],
        plan = firstPlanId === undefined ? undefined : world.plans[firstPlanId]
      if (intent?.requesterEntityId !== null || !isDeepStrictEqual(intent.source, request.source)
        || intent.requestId !== request.id
        || !isDeepStrictEqual(intent.pin, request.pin) || !isDeepStrictEqual(intent.payload, request.proposal.payload)
        || request.payloadHash !== businessFingerprint(request.proposal) || plan === undefined)
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Management request lost its sole original intent and direct plan')
      assertAcceptedWorldPlanSource(state, plan)
      const result = world.results[worldResultIdentity(intent.id)]
      if ((request.status === 'open' || request.status === 'cancel-requested') !== (result === undefined)
        || result !== undefined && result.outcome.kind !== request.status)
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Management case differs from its sole original business result')
      continue
    }
    const source = lookup(state.operations, request.operationId)
    const notification = request.notificationOperationId === null ? undefined : lookup(state.operations, request.notificationOperationId)
    const intent = lookup(world.intents, request.intentId)
    const selected = source?.action.kind === 'world/request' && intent !== undefined
      ? { description: intent.description, payload: parseSimulationWorldSchema(installed(state, intent.pin,
        runtime).definition.schemas.request, source.action.payload),
      scopeEntityId: intent.scopeEntityId } : undefined
    const decision = source === undefined ? undefined : lookup(state.decisions, source.decisionId)
    if (intent?.requestId !== request.id || source?.action.kind !== 'world/request'
      || !isDeepStrictEqual(source.action, request.proposal) || !isDeepStrictEqual(request.pin, intent.pin)
      || !isDeepStrictEqual(source.worldPin, request.pin)
      || source.entityId !== request.requesterEntityId || selected?.description !== request.description
      || worldDecisionSource(request).decisionId !== decision?.id || request.source.epoch !== decision.epoch
      || !isDeepStrictEqual(request.source.binding, lookup(state.entities, request.requesterEntityId)?.binding)
      || !isDeepStrictEqual(selected.payload, intent.payload) || source.action.businessKey !== intent.businessKey
      || selected.scopeEntityId !== intent.scopeEntityId
      || businessFingerprint(source.action) !== request.payloadHash)
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World request lost its original accepted decision or pinned input')
    if (request.notificationOperationId === null) {
      const wake = lookup(state.scheduledEvents, `simulation-world-scenario-resolve:${request.id}`)
      const context = decision.context?.status === 'prepared' ? decision.context.world : undefined
      if (intent.scenarioTrigger === undefined || !isDeepStrictEqual(worldDecisionSource(request).trigger, intent.scenarioTrigger)
        || context?.kind !== 'director-event' || !isDeepStrictEqual(context.trigger, intent.scenarioTrigger)
        || wake?.action.kind !== 'wake' || wake.action.entityId !== world.definition.directorEntityId
        || wake.action.reason !== JSON.stringify({ scenarioRequestId: request.id }) || wake.key.time !== decision.time)
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Scenario request lost its actual Native planning duty')
    } else if (intent.scenarioTrigger !== undefined || worldDecisionSource(request).trigger !== undefined
      || notification?.action.kind !== 'communication/post'
      || notification.action.text !== worldNotification(request)
      || notification.action.channelId !== lookup(world.channels, request.requesterEntityId)
      || notification.action.recipient !== world.definition.directorEntityId || notification.decisionId !== source.decisionId
      || notification.action.deliverAt !== lookup(state.decisions, source.decisionId)?.time
      || !isDeepStrictEqual(notification.dependencies, [source.id]))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World request lost its exact accepted private notification')
    if (request.plans.length > world.definition.limits.maxPlansPerRequest)
      throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World case exceeds its planning limit', 'plans')
    for (const [index, id] of request.plans.entries()) {
      const plan = lookup(world.plans, id), operation = plan?.operationId == null ? undefined : lookup(state.operations, plan.operationId)
      if (plan?.requestId !== request.id || operation?.action.kind !== 'world/resolve'
        || !isDeepStrictEqual(plan.pin, request.pin)
        || !isDeepStrictEqual(operation.worldPin, plan.pin)
        || !isDeepStrictEqual(plan.proposal, operation.action) || plan.hash !== businessFingerprint(operation.action)
        || (plan.status === 'stale') !== (plan.stale !== undefined)
        || plan.stale !== undefined && (plan.stale.sequence < plan.sequence || plan.stale.sequence > state.revision
          || plan.stale.phase === 'acceptance' && plan.stale.sequence !== plan.sequence)
        || plan.proposal.supersedes !== (request.plans[index - 1] ?? null))
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World plan lost its accepted output or predecessor')
    }
    const result = lookup(world.results, worldResultIdentity(request.intentId))
    if ((request.status === 'open' || request.status === 'awaiting-evidence'
      || request.status === 'cancel-requested') !== (result === undefined)
      || result !== undefined && result.outcome.kind !== request.status) {
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World terminal case differs from its sole business result')
    }
  }
  for (const [id, stored] of Object.entries(world.results)) {
    const result = parseSimulationWorldSchema(simulationWorldResultSchema, stored), request = lookup(world.requests, result.requestId)
    const plan = result.source.kind === 'plan' ? lookup(world.plans, result.source.planId) : undefined
    const command = result.source.kind === 'cancel' ? lookup(world.cancellations, result.source.commandId) : undefined
    const firstCancellation = result.source.kind === 'cancel'
      ? Object.values(world.cancellations).filter(value => value.request.requestId === result.requestId)
        .sort((first, second) => first.sequence - second.sequence)[0]
      : undefined
    const intent = request === undefined ? undefined : lookup(world.intents, request.intentId)
    if (intent === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Result lost its original pinned intent')
    parseSimulationWorldSchema(installed(state, intent.pin, runtime).definition.schemas.result, result.payload)
    const event = lookup(state.scheduledEvents, `simulation-world-result:${id}`)
    if (id !== result.id || request?.intentId !== result.intentId || id !== worldResultIdentity(result.intentId)
      || result.sequence > state.revision
      || result.source.kind === 'plan' && (plan?.requestId !== result.requestId || plan.status !== 'accepted'
        || result.outcome.kind === 'rejected' && (plan.proposal.resolution.kind !== 'reject'
          || plan.proposal.resolution.reason !== result.outcome.reason))
      || result.source.kind === 'evidence-deadline' && (world.evidence.challenges[result.source.challengeId]?.requestId !== result.requestId
        || world.evidence.challenges[result.source.challengeId]?.status !== 'expired'
        || world.evidence.challenges[result.source.challengeId]?.settledSequence !== result.sequence
        || state.scheduledEvents[result.source.eventId]?.status !== 'consumed'
        || state.scheduledEvents[result.source.eventId]?.settledAt !== result.sequence)
      || result.source.kind === 'evidence-exhausted'
        && (world.evidence.challenges[result.source.challengeId]?.requestId !== result.requestId
        || world.evidence.challenges[result.source.challengeId]?.status !== 'exhausted'
        || world.evidence.challenges[result.source.challengeId]?.settledSequence !== result.sequence)
      || result.source.kind === 'cancel' && (command?.request.requestId !== result.requestId || command.status !== 'cancelled'
        || command.sequence > result.sequence || firstCancellation?.request.id !== result.source.commandId)
      || (request.operationId === null ? event !== undefined : event?.action.kind !== 'wake'
        || event.action.entityId !== worldResultNotificationActor(state, result, runtime)
        || event.action.reason !== JSON.stringify({ resultId: result.id }) || event.key.time !== result.time
        || event.sourceOperationId !== undefined)) {
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World result lost its exact source or safe notification wake')
    }
  }
  for (const [id, stored] of Object.entries(world.cancellations)) {
    const cancellation = simulationWorldCancellationSchema.parse(stored)
    if (id !== cancellation.request.id || cancellation.sequence > state.revision) {
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World cancellation lost its original identity or transition order')
    }
    if (Buffer.byteLength(JSON.stringify(cancellation.request), 'utf8') > world.definition.limits.maxBytesPerRequest)
      throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World cancellation exceeds its original command byte limit', 'bytes')
    if (cancellation.status === 'cancel-requested') {
      const request = world.requests[cancellation.request.requestId]
      if (request?.status !== 'cancel-requested' || world.reservations[request.intentId]?.status !== 'cancel-requested'
        && world.personnel.reservations[request.intentId]?.status !== 'cancel-requested'
        && world.external.representatives[request.intentId]?.status !== 'cancel-requested'
        && world.external.contacts[request.intentId]?.status !== 'cancel-requested'
        || Object.hasOwn(world.results, worldResultIdentity(request.intentId))) {
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Pending cancellation lost its cleanup and capacity responsibility')
      }
      continue
    }
    if (cancellation.resultId === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Terminal cancellation lost its result')
    const result = lookup(world.results, cancellation.resultId)
    if (result?.requestId !== cancellation.request.requestId
      || cancellation.status === 'cancelled' && (result.source.kind !== 'cancel' || result.source.commandId !== id)
      || cancellation.status === 'already-committed' && result.outcome.kind !== 'committed'
      || cancellation.status === 'already-resolved' && result.outcome.kind === 'committed') {
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World cancellation lost its original terminal result')
    }
  }
  if (Object.keys(world.cancellations).length > world.definition.limits.maxRequests)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World cancellation history exceeds its retained command limit', 'commands')
}
