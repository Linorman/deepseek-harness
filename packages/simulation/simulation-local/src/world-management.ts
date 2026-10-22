import { assertRunControlRequest } from './run-control.ts'
/** Sole Native authenticated-user admission; no model operation, replacement identity or second business ledger. */
import { isDeepStrictEqual } from 'node:util'
import { simulationWorldManagementPreviewRequestSchema, simulationWorldManagementPreviewSchema,
  simulationWorldManagementSubmitRequestSchema, simulationWorldManagementReceiptSchema,
  simulationWorldAuthenticatedUserSourceSchema, simulationWorldManagementFundingAuthoritySchema,
  simulationWorldIntentSchema, simulationWorldReadSetSchema, worldRequestIdSchema, worldPlanIdSchema,
  SimulationWorldError, PersonnelDomainError, effectiveNorms, activeSimulationMaintenance,
  budgetInterval, activePersonnelFences, simulationTransactionSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationWorldIntent, SimulationWorldRequest, SimulationWorldPlan,
  SimulationWorldManagementAction, SimulationWorldManagementAuthority,
  SimulationWorldManagementPreview, SimulationWorldManagementPreviewRequest, SimulationWorldManagementSubmitRequest,
  SimulationWorldManagementReceipt, SimulationWorldManagementImpact,
  WorldManagementCommandId, WorldExecutionReason } from '@clocky/clocky-simulation'
type ProductPrincipalId = import('@clocky/clocky-simulation').SimulationWorldAuthenticatedUserSource['principalId']
import type { z } from 'zod'
import type { simulationWorldManagementAcceptedSchema } from '@clocky/clocky-simulation'
import type { NativeWorldRuntime } from './world-runtime.ts'
import { requireWorldRuntime } from './world-runtime.ts'
import { businessFingerprint } from './business.ts'
import { requireWorld, worldIntentIdentity } from './world.ts'
import { acceptDepartureFence } from './world-personnel.ts'
import { parseSimulationWorldSchema } from '@clocky/clocky-simulation'
import { validateResourceFunding } from './resource-ledger.ts'
import { BusinessRejection } from './business-error.ts'
import { personnelRoleAuthorities } from './world-personnel-domain.ts'

type AcceptedRecord = z.infer<typeof simulationWorldManagementAcceptedSchema>
function manifest(state: SimulationSnapshot, action: SimulationWorldManagementAction, runtime: NativeWorldRuntime | undefined) {
  const world = requireWorld(state), pin = world.definition.operations.find(value => value.domain === 'organization'
    && value.operation === action.kind && value.version === '1')
  if (pin === undefined)
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Management operation is absent from the original World manifest')
  const module = requireWorldRuntime(runtime).admitting(pin)
  if (module.admitManagementRequest === undefined)
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Original implementation does not admit authenticated personnel management')
  return { world, pin, module }
}
function liveAuthority(state: SimulationSnapshot, action: SimulationWorldManagementAction, authority: SimulationWorldManagementAuthority) {
  const value = authority.resolve()
  if (value === undefined || value.actionHash !== businessFingerprint(action))
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Current authenticated management authority does not cover this exact action')
  const source = parseSimulationWorldSchema(simulationWorldAuthenticatedUserSourceSchema,
    { ...value.source, commandId: 'preview', time: state.time })
  const funding = value.funding === null ? null : parseSimulationWorldSchema(simulationWorldManagementFundingAuthoritySchema, value.funding)
  return { ...value, source: { kind: source.kind, principalId: source.principalId, credentialGeneration: source.credentialGeneration,
    policyRef: source.policyRef, policyGeneration: source.policyGeneration }, funding }
}
function actionDescription(action: SimulationWorldManagementAction): string {
  return action.kind === 'hiring-market' ? action.payload.kind === 'review' ? action.payload.reason
    : `Finite Persona draft: ${action.payload.id}` : action.payload.description
}
function inputFor(action: SimulationWorldManagementAction, businessKey: string) {
  return { kind: 'world/request' as const, domain: 'organization', operation: action.kind, version: '1', businessKey,
    expectedTime: action.kind === 'hire-existing' || action.kind === 'hiring-market' ? null : action.payload.requestedEffectiveAt, evidence: [], payload: action.payload }
}
function originalIds(state: SimulationSnapshot, principalId: ProductPrincipalId, commandId: WorldManagementCommandId) {
  const key = businessFingerprint([state.spec.runId, principalId, commandId])
  return { key, requestId: worldRequestIdSchema.parse(`world-management-request:${key.slice(7)}`),
    planId: worldPlanIdSchema.parse(`world-management-plan:${key.slice(7)}`) }
}
function pendingConflict(state: SimulationSnapshot, action: SimulationWorldManagementAction,
  runtime: NativeWorldRuntime | undefined): boolean {
  if (action.kind === 'hiring-market') return false
  const world = requireWorld(state), personId = action.payload.personId
  return Object.values(world.executions).some((observation) => {
    if (observation.phase !== 'armed' && observation.phase !== 'outcome-unknown') return false
    const intent = world.intents[observation.intentId]
    if (intent === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Unconfirmed execution lost its actual original intent')
    const subjects = requireWorldRuntime(runtime).original(intent.pin).personnelSubjects(intent)
    const target = action.kind === 'transfer' ? action.payload.targetPositionId
      : action.kind === 'hire-existing' ? action.payload.positionEntityId : undefined
    return subjects.includes(personId) || intent.requesterEntityId === personId
      || target !== undefined && intent.targetEntityId === target
  })
}
function impact(state: SimulationSnapshot, action: SimulationWorldManagementAction): SimulationWorldManagementImpact | null {
  if (action.kind === 'hiring-market') return { kind: action.kind, organizationEntityId: action.payload.organizationEntityId,
    targetPositionId: action.payload.positionEntityId, draftId: action.payload.id,
    draftRevision: action.payload.kind === 'draft' ? action.payload.expectedRevision : action.payload.revision }
  const { personId, organizationEntityId } = action.payload
  const authorityRelationIds = personnelRoleAuthorities(state, personId, organizationEntityId).map(value => value.id)
  if (action.kind === 'hire-existing') return { kind: action.kind, personId, organizationEntityId,
    targetPositionId: action.payload.positionEntityId, authorityRelationIds: [] }
  const assignment = state.relations[action.payload.assignmentId]
  if (assignment?.relation !== 'assignment' || assignment.subject !== personId
    || assignment.revision !== action.payload.assignmentRevision) return null
  const common = { personId, organizationEntityId, assignmentId: assignment.id, assignmentRevision: assignment.revision,
    previousPositionId: assignment.object, requestedEffectiveAt: action.payload.requestedEffectiveAt, authorityRelationIds }
  return action.kind === 'transfer' ? { ...common, kind: action.kind, targetPositionId: action.payload.targetPositionId }
    : { ...common, kind: action.kind, retire: action.payload.retire }
}
function blocker(error: unknown): WorldExecutionReason {
  if (error instanceof PersonnelDomainError) return error.code === 'SIM_PERSONNEL_AUTHORITY' ? 'authority-missing'
    : error.code === 'SIM_PERSONNEL_WAITING_TIME' ? 'waiting-effective-time'
      : error.code === 'SIM_PERSONNEL_STALE_TIME' ? 'stale-time'
        : error.code === 'SIM_PERSONNEL_HANDOFF_REQUIRED' ? 'handoff-required' : 'plan-stale'
  if (!(error instanceof SimulationWorldError)) throw error
  if (error.code === 'SIM_WORLD_AUTHORITY') return 'authority-missing'
  if (error.code === 'SIM_WORLD_CONFLICT') return 'plan-stale'
  if (error.failure.code === 'SIM_WORLD_LIMIT') return error.failure.limit === 'position' ? 'position-capacity'
    : error.failure.limit === 'bytes' ? 'world-byte-limit' : error.failure.limit === 'requests' ? 'world-request-limit' : 'plan-budget'
  throw error
}
/**
 * Preview one exact Native prefix without allocating requests or execution work.
 * @param state - Original observed prefix containing the person and assignment.
 * @param request - Complete action and expected prefix selected by the caller.
 * @param authority - Live trusted policy and canonical source observation.
 * @param runtime - Installed immutable domain implementations, when available.
 * @returns fixed impact, dependencies, blockers and hash for this action and source.
 */
export function previewWorldManagement(state: SimulationSnapshot, request: SimulationWorldManagementPreviewRequest,
  authority: SimulationWorldManagementAuthority, runtime: NativeWorldRuntime | undefined): SimulationWorldManagementPreview {
  const input = parseSimulationWorldSchema(simulationWorldManagementPreviewRequestSchema, request)
  if (input.expectedRevision !== state.revision)
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Management preview requires its exact observed Native revision')
  const auth = liveAuthority(state, input.action, authority), { world, pin, module } = manifest(state, input.action, runtime)
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > world.definition.limits.maxBytesPerRequest)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Management preview input exceeds the original request allowance', 'bytes')
  const source = simulationWorldAuthenticatedUserSourceSchema.parse({ ...auth.source, commandId: 'preview', time: state.time })
  const proposed = inputFor(input.action, businessFingerprint(['management-preview', auth.source.principalId, input.action]))
  assertRunControlRequest(state, proposed, runtime)
  const blockers: WorldExecutionReason[] = [], settlementRequirements: WorldExecutionReason[] = []
  let reads: SimulationWorldManagementPreview['reads'] = [], projectedImpact: SimulationWorldManagementImpact | null = null
  if (!auth.sourceComplete) blockers.push('existing-obligations')
  if (pendingConflict(state, input.action, runtime)) blockers.push('outcome-unknown')
  if (input.action.kind !== 'hiring-market' && activePersonnelFences(state, input.action.payload.personId).length) blockers.push('existing-obligations')
  if (state.activeWindowId !== undefined || activeSimulationMaintenance(state) !== undefined) blockers.push('maintenance-blocked')
  if (Object.keys(world.requests).length >= world.definition.limits.maxRequests
    || Object.keys(world.intents).length >= world.definition.limits.maxRequests) blockers.push('world-request-limit')
  const used = Object.values(world.requests).filter(value => value.operationId === null
    && value.source.principalId === auth.source.principalId
    && budgetInterval(state, value.source.time) === budgetInterval(state, state.time)).length
  if (used >= world.definition.limits.maxRequestsPerActorPerInterval) blockers.push('world-request-limit')
  try {
    const admitted = module.admitManagementRequest?.(state, proposed, source)
    if (admitted === undefined) throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Management admission capability disappeared')
    const candidate = parseSimulationWorldSchema(simulationWorldIntentSchema, { id: worldIntentIdentity(state, proposed), pin,
      businessKey: proposed.businessKey, requesterEntityId: null, source, scopeEntityId: admitted.scopeEntityId,
      targetEntityId: admitted.targetEntityId, expectedTime: proposed.expectedTime, evidence: [], description: admitted.description,
      payload: admitted.payload, sequence: state.revision + 1 })
    const { scenarioTrigger: _roleTrigger, requestId: _requestId, ...userCandidate } = candidate
    reads = parseSimulationWorldSchema(simulationWorldReadSetSchema, [{ kind: 'world-definition',
      id: `world-definition:${state.spec.runId}`, revision: world.sequence }, ...module.executionReads(state,
      { ...userCandidate, requesterEntityId: null, source })])
    projectedImpact = impact(state, input.action)
  } catch (error) { blockers.push(blocker(error)) }
  const hiringPosition = input.action.kind === 'hire-existing' ? input.action.payload.positionEntityId : undefined
  const fee = input.action.kind === 'hire-existing' ? world.definition.hiringFees?.find(value => value.operation === 'hire-existing'
    && value.positionEntityId === hiringPosition) ?? null : null
  if (fee !== null) {
    if (auth.funding === null) blockers.push('authority-missing')
    else {
      const transaction = simulationTransactionSchema.parse({ commitmentId: null, reads: [fee.from, fee.to].map(resourceId =>
        ({ resourceId, revision: state.resources[resourceId]?.revision })), transfers: [{ from: fee.from, to: fee.to,
        quantity: fee.quantity }] })
      try { validateResourceFunding(state, auth.funding.entityId, transaction, fee.grants) }
      catch (error) {
        if (!(error instanceof BusinessRejection)) throw error
        blockers.push(error.status === 'blocked-authority' ? 'authority-missing' : 'resource-capacity')
      }
    }
  }
  if (input.action.kind === 'hire-existing' && effectiveNorms(state, input.action.payload.organizationEntityId, state.time, state.revision)
    .some(value => value.enforcement.kind === 'validated')) settlementRequirements.push('approval-required')
  const body = { action: input.action, snapshotRevision: state.revision, pin, reads, sourceFingerprint: auth.sourceFingerprint,
    admission: blockers.length ? 'blocked' as const : 'allowed' as const, blockers: [...new Set(blockers)],
    settlementRequirements, impact: projectedImpact, hiringFee: fee }
  const result = parseSimulationWorldSchema(simulationWorldManagementPreviewSchema,
    { ...body, previewHash: businessFingerprint({ ...body, source: { kind: auth.source.kind, principalId: auth.source.principalId,
      policyRef: auth.source.policyRef, policyGeneration: auth.source.policyGeneration }, funding: auth.funding }) })
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > world.definition.limits.maxBytesPerPlan)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Complete management preview exceeds its original plan allowance', 'bytes')
  return result
}
/**
 * Read the sole retained user original and its independently owned business/callback receipts.
 * @param state - Prefix to inspect without writable recovery.
 * @param commandId - Original run-local user command identity.
 * @param principalId - Authenticated owner of that original command.
 * @returns original business identities and current receipts, or absence in this prefix.
 */
export function inspectWorldManagement(state: SimulationSnapshot, commandId: WorldManagementCommandId,
  principalId: ProductPrincipalId): SimulationWorldManagementReceipt | undefined {
  const ids = originalIds(state, principalId, commandId), request = state.world?.requests[ids.requestId]
  if (request === undefined) return undefined
  if (request.operationId !== null || request.source.commandId !== commandId || request.source.principalId !== principalId)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Management identity is occupied by a different original source')
  const result = Object.values(state.world?.results ?? {}).find(value => value.requestId === request.id)
  const execution = state.world?.executions[ids.planId]
  return parseSimulationWorldSchema(simulationWorldManagementReceiptSchema, { commandId, principalId,
    inputHash: request.admission.inputHash, acceptedSequence: request.sequence, intentId: request.intentId, requestId: request.id,
    planId: ids.planId, ...execution === undefined ? {} : { execution }, ...result === undefined ? {} : { result } })
}
/**
 * Prepare an exact original event while live authorization is current; identical retries retain the prior source.
 * @param state - Current prefix at the serialized admission position.
 * @param request - Complete retained action, command and preview commitment.
 * @param authority - Trusted authority rechecked at admission.
 * @param runtime - Installed immutable implementations used by validation.
 * @returns an acceptance event to append or the existing original receipt.
 */
export function prepareWorldManagement(state: SimulationSnapshot, request: SimulationWorldManagementSubmitRequest,
  authority: SimulationWorldManagementAuthority,
  runtime: NativeWorldRuntime | undefined): AcceptedRecord | SimulationWorldManagementReceipt {
  const input = parseSimulationWorldSchema(simulationWorldManagementSubmitRequestSchema, request),
    auth = liveAuthority(state, input.action, authority)
  const prior = inspectWorldManagement(state, input.commandId, auth.source.principalId)
  if (prior !== undefined) {
    const original = state.world?.requests[prior.requestId]
    if (original?.operationId !== null || !isDeepStrictEqual(original.admission.input, input))
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Management command changed its exact original input')
    return prior
  }
  const preview = previewWorldManagement(state, { action: input.action, expectedRevision: input.expectedRevision }, authority, runtime)
  if (preview.previewHash !== input.previewHash || preview.admission !== 'allowed')
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Management preview changed or has actual admission blockers')
  return { kind: 'world/management-accepted', admission: { input, inputHash: businessFingerprint(input),
    sourceFingerprint: auth.sourceFingerprint, funding: auth.funding }, pin: preview.pin,
  source: simulationWorldAuthenticatedUserSourceSchema.parse({ ...auth.source, commandId: input.commandId, time: state.time }) }
}
/**
 * Derive exactly one request, direct plan and personnel fence from authenticated acceptance.
 * @param state - Prefix immediately preceding the acceptance event.
 * @param record - Persisted immutable acceptance and provenance.
 * @param sequence - Actual next Native sequence assigned to the acceptance.
 * @param runtime - Exact installed implementations required to validate replay.
 * @returns the next snapshot with the sole original request and direct plan.
 */
export function foldWorldManagement(state: SimulationSnapshot, record: AcceptedRecord, sequence: number,
  runtime: NativeWorldRuntime | undefined): SimulationSnapshot {
  const input = record.admission.input, { world, module, pin } = manifest(state, input.action, runtime)
  const { principalId } = record.source, ids = originalIds(state, principalId, input.commandId)
  if (record.source.commandId !== input.commandId || record.source.time !== state.time || input.expectedRevision !== state.revision
    || record.admission.inputHash !== businessFingerprint(input) || !isDeepStrictEqual(record.pin, pin)
    || world.requests[ids.requestId] !== undefined || sequence !== state.revision + 1)
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Management acceptance changed its exact original source or queue position')
  const authority: SimulationWorldManagementAuthority = { resolve: () => ({ source: record.source,
    actionHash: businessFingerprint(input.action), sourceFingerprint: record.admission.sourceFingerprint,
    sourceComplete: true, funding: record.admission.funding }) }
  const preview = previewWorldManagement(state, { action: input.action, expectedRevision: input.expectedRevision }, authority, runtime)
  if (preview.admission !== 'allowed' || preview.previewHash !== input.previewHash)
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Retained management acceptance differs from its actual preview')
  const proposed = inputFor(input.action, `authenticated-user:${ids.key}`)
  const admitted = module.admitManagementRequest?.(state, proposed, record.source)
  if (admitted === undefined) throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Original domain has no management admission')
  const intent: SimulationWorldIntent = { id: worldIntentIdentity(state, proposed), pin, businessKey: proposed.businessKey,
    requesterEntityId: null, source: record.source, scopeEntityId: admitted.scopeEntityId, targetEntityId: admitted.targetEntityId,
    expectedTime: proposed.expectedTime, evidence: [], description: admitted.description, payload: admitted.payload,
    sequence, requestId: ids.requestId }
  if (Object.hasOwn(world.intents, intent.id))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Management business identity already has another original source')
  const request: SimulationWorldRequest = { id: ids.requestId, intentId: intent.id, operationId: null,
    notificationOperationId: null, requesterEntityId: null, proposal: proposed, pin, source: record.source,
    admission: record.admission, description: admitted.description, payloadHash: businessFingerprint(proposed), sequence,
    plans: [ids.planId], status: 'open' }
  let next: SimulationSnapshot = { ...state, world: { ...world, intents: { ...world.intents, [intent.id]: intent },
    requests: { ...world.requests, [request.id]: request } } }
  if (input.action.kind === 'depart') next = acceptDepartureFence(next, intent, request.id, sequence)
  const resolution = { kind: 'apply' as const, payload: admitted.payload, rationale: actionDescription(input.action) }
  module.validatePlan(next, intent, resolution)
  const proposal = { kind: 'world/management-apply' as const, requestId: request.id, supersedes: null, resolution }
  const plan: SimulationWorldPlan = { id: ids.planId, requestId: request.id, operationId: null, source: record.source, proposal,
    pin, reads: parseSimulationWorldSchema(simulationWorldReadSetSchema, [{ kind: 'world-definition',
      id: `world-definition:${state.spec.runId}`, revision: world.sequence },
    ...module.executionReads(next, intent)]), baseRevision: state.revision, sequence, hash: businessFingerprint(proposal),
    status: 'accepted' }
  if (Buffer.byteLength(JSON.stringify({ intent, request }), 'utf8') > world.definition.limits.maxBytesPerRequest
    || Buffer.byteLength(JSON.stringify({ record, plan }), 'utf8') > world.definition.limits.maxBytesPerPlan)
    throw new SimulationWorldError('SIM_WORLD_LIMIT',
      'Complete original management acceptance exceeds its retained byte allowance', 'bytes')
  return { ...next, world: { ...requireWorld(next), plans: { ...world.plans, [plan.id]: plan } } }
}
/**
 * Verify a plan's original accepted source before mutation or funding, without inventing model operations.
 * @param state - Current prefix containing the original request and plan.
 * @param plan - Accepted plan whose immutable provenance must agree with its request.
 */
export function assertAcceptedWorldPlanSource(state: SimulationSnapshot, plan: SimulationWorldPlan): void {
  const world = requireWorld(state), request = world.requests[plan.requestId]
  if (plan.operationId === null) {
    if (request?.operationId !== null || request.plans.length !== 1 || request.plans[0] !== plan.id
      || !isDeepStrictEqual(plan.source, request.source) || !isDeepStrictEqual(plan.proposal.resolution.payload, request.proposal.payload)
      || plan.hash !== businessFingerprint(plan.proposal) || request.admission.inputHash !== businessFingerprint(request.admission.input)
      || request.source.commandId !== request.admission.input.commandId
      || request.proposal.operation !== request.admission.input.action.kind
      || !isDeepStrictEqual(request.proposal.payload, request.admission.input.action.payload)
      || plan.proposal.resolution.rationale !== actionDescription(request.admission.input.action)
      || plan.baseRevision !== request.admission.input.expectedRevision || plan.sequence !== request.sequence)
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'User plan lost its original immutable authenticated acceptance')
    const ids = originalIds(state, request.source.principalId, request.source.commandId)
    if (ids.planId !== plan.id || ids.requestId !== request.id)
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'User plan changed its deterministic original IDs')
    return
  }
  const operation = state.operations[plan.operationId]
  if (operation?.action.kind !== 'world/resolve' || !isDeepStrictEqual(operation.action, plan.proposal)
    || state.decisions[operation.decisionId]?.status !== 'accepted'
    || operation.result !== undefined && operation.result.status !== 'applied')
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Role plan lost its actual accepted operation and decision')
}
