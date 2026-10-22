import { hasAcceptedHiringOffer, hiringMarketReservationAuthorized } from '@clocky/clocky-simulation'
import { assertAcceptedWorldPlanSource } from './world-management.ts'
import { assertWorldMutationSlot } from './world-structure-budget.ts'
/** Hiring fees reuse the conserved Native ledger while retaining their original business owner and cleanup responsibility. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { simulationResourceReservationSchema, simulationResourceReservationIdSchema, simulationTransactionSchema,
  simulationWorldReadSetSchema, simulationHiringFeePolicySchema, SimulationHiringResourceError, SimulationWorldError,
  simTimeSchema, WORLD_GENERATE_AND_HIRE_PIN, WORLD_HIRE_EXISTING_PIN, worldPlanIdSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationWorldIntent, SimulationWorldPlan, SimulationResourceReservation,
  SimulationResourceReservationId, SimulationHiringFeePolicy, SimulationWorldReadSet,
  SimulationResourceId } from '@clocky/clocky-simulation'
import { BusinessRejection } from './business-error.ts'
import { businessFingerprint } from './business.ts'
import { validateResourceFunding, applyResourceFunding } from './resource-ledger.ts'
import { requireHireApproval } from './world-hire-approval.ts'
import { worldExecutionReads } from './world.ts'
import { resourceReservationExpiryId } from './resource-reservation.ts'
import { allocateEventKey } from './scheduler.ts'
import type { SchedulerRecord } from './scheduler.ts'

/** Original pure existing-person reservation; replay reconstructs the quote from this same prefix. */
export const existingHireResourcesRecordSchema = z.strictObject({ kind: z.literal('hire-existing/resources-reserved'),
  planId: worldPlanIdSchema, hold: simulationResourceReservationSchema })
/** Exact Native-owned existing-person resource reservation fact. */
export type ExistingHireResourcesRecord = z.infer<typeof existingHireResourcesRecordSchema>

/**
 * Select only the frozen fee for the exact original hiring operation and position.
 * @param state - Original immutable World definition.
 * @param intent - Actual accepted case whose requester supplies financial authority.
 * @returns explicit installed fee or undefined for a free operation; no model-selected price is read.
 */
export function hiringFee(state: SimulationSnapshot, intent: SimulationWorldIntent): SimulationHiringFeePolicy | undefined {
  if (!isDeepStrictEqual(intent.pin, WORLD_GENERATE_AND_HIRE_PIN) && !isDeepStrictEqual(intent.pin, WORLD_HIRE_EXISTING_PIN))
    return undefined
  return state.world?.definition.hiringFees?.find(value => value.operation === intent.pin.operation
    && value.positionEntityId === intent.targetEntityId)
}
/**
 * Derive the sole financial promise identity for an immutable accepted hiring plan.
 * @param planId - Actual accepted original plan identity.
 * @returns stable Native hold identity; retries never allocate a replacement.
 */
export function hiringResourceReservationId(planId: SimulationWorldPlan['id']): SimulationResourceReservationId {
  return simulationResourceReservationIdSchema.parse(`world-hiring-resource:${planId}`)
}
function original(state: SimulationSnapshot, plan: SimulationWorldPlan): SimulationWorldIntent {
  const world = state.world, request = world?.requests[plan.requestId]
  const intent = request === undefined ? undefined : world?.intents[request.intentId]
  if (world === undefined || intent === undefined || request?.status !== 'open' || request.plans.at(-1) !== plan.id
    || plan.status !== 'accepted' || plan.proposal.resolution.kind !== 'apply'
    || !isDeepStrictEqual(world.plans[plan.id], plan))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Hiring resources require the latest original accepted apply plan')
  assertAcceptedWorldPlanSource(state, plan)
  return intent
}
function fundingActor(state: SimulationSnapshot, intent: SimulationWorldIntent) {
  if (intent.requesterEntityId !== null) return intent.requesterEntityId
  const request = intent.requestId === undefined ? undefined : state.world?.requests[intent.requestId]
  if (request?.operationId !== null || request.admission.funding === null || !isDeepStrictEqual(request.source, intent.source))
    throw new SimulationHiringResourceError('authority')
  return request.admission.funding.entityId
}
function funding<T>(run: () => T): T {
  try { return run() }
  catch (error: unknown) {
    if (!(error instanceof BusinessRejection)) throw error
    throw new SimulationHiringResourceError(error.status === 'blocked-authority' || error.code.startsWith('SIM_GRANT_')
      && error.code !== 'SIM_GRANT_RESERVED' ? 'authority'
      : error.code === 'SIM_RESOURCE_INSUFFICIENT' || error.code === 'SIM_RESOURCE_LIMIT' || error.code === 'SIM_GRANT_RESERVED'
        ? 'insufficient' : 'stale')
  }
}
/**
 * Select the debit-account hold set without an original plan's own reservation.
 * @param state - Actual global ledger, including local and World promises.
 * @param resourceId - Exact debit account whose availability matters.
 * @param intentId - Original case excluded only for its own execution-read comparison.
 * @returns deterministic original active hold records; unrelated account holds are absent.
 */
export function hiringAccountHolds(state: SimulationSnapshot, resourceId: SimulationResourceId,
  intentId?: SimulationWorldIntent['id']): readonly SimulationResourceReservation[] {
  return Object.values(state.resourceReservations).filter(value => value.phase === 'active'
    && (intentId === undefined || value.world?.intentId !== intentId)
    && value.transaction.transfers.some(transfer => transfer.from === resourceId)).sort((a, b) => a.id.localeCompare(b.id))
}
/**
 * Freeze the actual account, grant, policy and available-funds dependencies without depending on global revision.
 * @param state - Actual current Native financial prefix.
 * @param intent - Original hiring case; own reservation is excluded explicitly.
 * @returns typed immutable critical reads; missing grants remain an exact missing-set observation.
 */
export function hiringResourceReads(state: SimulationSnapshot, intent: SimulationWorldIntent): SimulationWorldReadSet {
  const fee = hiringFee(state, intent)
  if (fee === undefined) return []
  const accounts = [fee.from, fee.to].map((id) => {
    const value = state.resources[id]
    if (value === undefined) throw new SimulationHiringResourceError('stale')
    return value
  })
  return simulationWorldReadSetSchema.parse([
    { kind: 'hiring-fee-policy', id: fee.id, version: fee.version, hash: businessFingerprint(fee) },
    ...accounts.map(value => ({ kind: 'resource-account', id: value.id, hash: businessFingerprint(value) })),
    { kind: 'resource-reservation-set', resourceId: fee.from, hash: businessFingerprint(hiringAccountHolds(state, fee.from, intent.id)) },
    { kind: 'resource-grant-set', ids: fee.grants, hash: businessFingerprint(fee.grants.map(id => state.grants[id] ?? null)) },
  ])
}
/**
 * Construct and validate the complete original financial promise before any identity or provider IO.
 * @param state - Actual pre-reservation Native prefix.
 * @param plan - Exact original accepted plan whose real resolve operation is retained as source.
 * @param sequence - Actual reservation journal record position, distinct from the planning operation result.
 * @returns frozen conserved hold, or undefined when no charge was declared.
 */
export function prepareHiringResourceReservation(state: SimulationSnapshot, plan: SimulationWorldPlan,
  sequence: number): SimulationResourceReservation | undefined {
  const request = state.world?.requests[plan.requestId]
  const candidate = request === undefined ? undefined : state.world?.intents[request.intentId]
  const fee = candidate === undefined ? undefined : hiringFee(state, candidate)
  if (candidate?.pin.operation === 'hire-existing' && !hiringMarketReservationAuthorized(state, plan.id))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Hiring resources require the original offer reservation boundary')
  if (fee === undefined) return undefined
  const intent = original(state, plan)
  const id = hiringResourceReservationId(plan.id), prior = state.resourceReservations[id]
  if (prior !== undefined) {
    if (prior.world?.intentId !== intent.id || prior.world.planId !== plan.id || !isDeepStrictEqual(prior.world.fee, fee))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hiring hold changed its original case, plan or charge')
    if (candidate?.pin.operation === 'hire-existing' && prior.phase !== 'active')
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'A terminal hiring hold cannot be reused or reminted')
    return prior
  }
  if (Object.keys(state.resourceReservations).length >= state.spec.maxResourceReservationHistory)
    throw new SimulationHiringResourceError('history-limit')
  const expiresAt = simTimeSchema.parse(String(BigInt(state.time) + BigInt(fee.reservationPeriod)))
  if (BigInt(expiresAt) > BigInt(state.spec.maxTime)) throw new SimulationHiringResourceError('deadline')
  const transaction = simulationTransactionSchema.parse({ commitmentId: null,
    reads: [fee.from, fee.to].map(resourceId => ({ resourceId, revision: state.resources[resourceId]?.revision })),
    transfers: [{ from: fee.from, to: fee.to, quantity: fee.quantity }] })
  const accounts = [state.resources[fee.from], state.resources[fee.to]]
  if (accounts.some(value => value?.kind !== 'money' || value.unit !== fee.unit)) throw new SimulationHiringResourceError('stale')
  funding(() =>{  validateResourceFunding(state, fundingActor(state, intent), transaction, fee.grants) })
  return simulationResourceReservationSchema.parse({ id, actorId: fundingActor(state, intent), transaction, grants: fee.grants,
    expiresAt, createdTime: state.time, createdOperationId: plan.operationId,
    ...intent.requesterEntityId === null ? { management: intent.source } : {}, sequence, revision: 1, phase: 'active',
    world: { intentId: intent.id, planId: plan.id, fee, approvals: requireHireApproval(state, intent, plan) } })
}
/**
 * Install only the complete financial promise derived by its actual hiring owner.
 * @param state - Original pre-reservation projection.
 * @param plan - Exact latest accepted original plan.
 * @param hold - Actual record's frozen quote; absence is legal only for a free operation.
 * @param sequence - Actual atomic reservation sequence.
 * @returns prospective global hold map without a payment or invented operation.
 */
export function installHiringResourceReservation(state: SimulationSnapshot, plan: SimulationWorldPlan,
  hold: SimulationResourceReservation | undefined, sequence: number): SimulationSnapshot {
  const expected = prepareHiringResourceReservation(state, plan, sequence)
  if (!isDeepStrictEqual(hold, expected))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hiring reservation changed its original financial quote')
  return hold === undefined ? state : { ...state, resourceReservations: { ...state.resourceReservations, [hold.id]: hold } }
}
/**
 * Check the exact original funding promise at preparation/commit without refreshing its transaction.
 * @param state - Actual current account, grants and original business projection.
 * @param plan - Original accepted hiring plan.
 * @returns original active hold or undefined for a free operation.
 */
export function requireHiringResourceReservation(state: SimulationSnapshot,
  plan: SimulationWorldPlan): SimulationResourceReservation | undefined {
  const request = state.world?.requests[plan.requestId]
  const candidate = request === undefined ? undefined : state.world?.intents[request.intentId]
  const fee = candidate === undefined ? undefined : hiringFee(state, candidate)
  if (fee === undefined) return undefined
  const intent = original(state, plan)
  const hold = state.resourceReservations[hiringResourceReservationId(plan.id)]
  if (hold === undefined || hold.world?.intentId !== intent.id || hold.world.planId !== plan.id
    || hold.actorId !== fundingActor(state, intent)
    || !isDeepStrictEqual(hold.world.fee, fee) || hold.createdOperationId !== plan.operationId)
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Hiring commit requires its original pre-IO funding reservation')
  if (hold.phase === 'expired' || !hasAcceptedHiringOffer(state, plan.id)
    && (BigInt(state.time) >= BigInt(hold.expiresAt) || hold.world.expiryConsumed !== undefined))
    throw new SimulationHiringResourceError('expired')
  if (hold.phase !== 'active') throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Hiring funding already has its original settlement')
  requireHireApproval(state, intent, plan, hold.world.approvals)
  funding(() =>{  validateResourceFunding(state, hold.actorId, hold.transaction, hold.grants, hold.id) })
  return hold
}
/**
 * Settle only the original payment in the hiring owner's atomic assignment/result batch.
 * @param state - Actual pre-commit financial projection.
 * @param plan - Original validated apply plan.
 * @param sequence - Actual hiring commit or mutation record sequence.
 * @returns conserved balances, consumed original grants and one World-owned settlement.
 */
export function commitHiringResourceReservation(state: SimulationSnapshot, plan: SimulationWorldPlan,
  sequence: number): SimulationSnapshot {
  const hold = requireHiringResourceReservation(state, plan)
  if (hold === undefined) return state
  const source = hold.world
  if (source === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hiring payment lost its original World source')
  const next = funding(() => applyResourceFunding(state, hold.actorId, hold.transaction, hold.grants,
    { kind: 'world', consumption: { intentId: source.intentId, planId: plan.id, sequence, time: state.time } }, hold.id))
  return { ...next, resourceReservations: { ...next.resourceReservations, [hold.id]: { ...hold, phase: 'committed', revision: 2,
    settlement: { kind: 'world', intentId: source.intentId, planId: plan.id, transition: 'committed', sequence, time: state.time } } } }
}
/**
 * Release financial responsibility only with the business owner's known-safe cancellation or confirmed identity cleanup.
 * @param state - Actual cancellation/cleanup prefix; this function performs no IO and cannot prove cleanup itself.
 * @param intentId - Exact original business case whose owner has already established safe release.
 * @param sequence - Same atomic cancellation/cleanup transition sequence.
 * @returns retained terminal holds; committed payments are never reversed.
 */
export function cancelHiringResourceReservations(state: SimulationSnapshot, intentId: SimulationWorldIntent['id'],
  sequence: number): SimulationSnapshot {
  const reservations = { ...state.resourceReservations }
  for (const hold of Object.values(reservations)) {
    if (hold.world?.intentId !== intentId || hold.phase !== 'active') continue
    reservations[hold.id] = { ...hold, phase: 'cancelled', revision: 2, settlement: { kind: 'world', intentId,
      planId: hold.world.planId, transition: 'cancelled', sequence, time: state.time } }
  }
  return { ...state, resourceReservations: reservations }
}
/**
 * Validate frozen charge account references at the first fully resolvable Native World definition prefix.
 * @param state - Existing initial resources and canonical entities.
 * @param fees - Explicit original scene charges; grant authority is checked when a requester actually reserves.
 * @param initial - Original retained bootstrap resource declarations, validated without inventing published balances.
 */
export function validateHiringFeeAccounts(state: SimulationSnapshot, fees: readonly SimulationHiringFeePolicy[],
  initial: readonly import('@clocky/clocky-simulation').SimulationResourceSpec[] = []): void {
  for (const fee of fees) {
    simulationHiringFeePolicySchema.parse(fee)
    const account = (id: SimulationResourceId) => state.resources[id] ?? initial.find(value => value.id === id)
    if ([account(fee.from), account(fee.to)].some(value => value?.kind !== 'money' || value.unit !== fee.unit)
      || BigInt(fee.quantity) > BigInt(state.spec.maxResourceQuantity)
      || BigInt(fee.reservationPeriod) > BigInt(state.spec.maxTime) - BigInt(state.spec.origin))
      throw new SimulationWorldError('SIM_WORLD_CONFLICT',
        'Hiring fees require existing matching money accounts and supported quantity/SimTime bounds')
  }
}

/**
 * Derive source-owned expiry/cancellation duties from original World financial transitions in the same Native batch.
 * @param state - Prospective business prefix after the owner has installed or settled its hold.
 * @returns only missing original deadline duties; consumed history is never rewritten.
 */
export function hiringResourceSchedulerRecords(state: SimulationSnapshot): readonly SchedulerRecord[] {
  const records: SchedulerRecord[] = []
  for (const hold of Object.values(state.resourceReservations)) {
    if (hold.world === undefined) continue
    const id = resourceReservationExpiryId(hold.id), event = state.scheduledEvents[id]
    if (hold.phase === 'active' && event === undefined && hold.world.expiryConsumed === undefined) {
      const action = { kind: 'resource-reservation-expiry' as const, id: hold.id, revision: 1 }
      // Its actual creator is the Native reservation record. The accepted planning operation remains in hold.world,
      // rather than being mislabeled as an already-applied scheduler operation.
      records.push({ kind: 'event/queued', id, key: allocateEventKey(state, hold.expiresAt, action), action })
    } else if (hold.phase !== 'active' && event?.status === 'pending') {
      records.push({ kind: 'event/cancelled', id, reason: 'Original resource reservation settled' })
    }
  }
  return records
}

/**
 * Fold the original existing-person fee reservation without allocating or replacing any identity.
 * @param state - Original Native plan and current personnel/financial prefix.
 * @param record - Complete actual reservation fact, including its frozen original quote.
 * @param sequence - Actual reserve journal position.
 * @param runtime - Original pinned synchronous domain catalog.
 * @returns prospective shared hold map; occupied capacity and all approval/read dependencies are revalidated.
 */
export function foldExistingHireResources(state: SimulationSnapshot, record: ExistingHireResourcesRecord,
  sequence: number, runtime: import('./world-runtime.ts').NativeWorldRuntime | undefined): SimulationSnapshot {
  const plan = state.world?.plans[record.planId]
  if (plan === undefined || !isDeepStrictEqual(plan.pin, WORLD_HIRE_EXISTING_PIN))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Existing-person funding reservation requires its exact installed plan')
  const intent = original(state, plan)
  if (!hiringMarketReservationAuthorized(state, plan.id))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Hiring resources require the original offer reservation boundary')
  assertWorldMutationSlot(state, intent.id)
  const world = state.world
  if (world === undefined) throw new SimulationWorldError('SIM_WORLD_NOT_CONFIGURED', 'Existing hiring requires its original World')
  // The common read envelope retains scoped authorization and employment in addition to domain financial/identity reads.
  if (!isDeepStrictEqual(plan.reads, worldExecutionReads(state, intent, runtime)))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Existing-person funding lost its original execution reads')
  requireHireApproval(state, intent, plan)
  if (Object.values(world.reservations).some(value => value.status !== 'committed' && value.status !== 'abandoned')
    || Object.values(world.external.representatives).some(value => value.status !== 'committed' && value.status !== 'abandoned')
    || Object.values(world.personnel.reservations).some(value => value.status !== 'committed' && value.status !== 'cancelled')
    || Object.values(state.resourceReservations).some(value => value.phase === 'active' && value.world !== undefined
      && value.world.intentId !== intent.id))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Existing-person funding waits for the original structural responsibility')
  if (Object.hasOwn(state.resourceReservations, record.hold.id))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Existing-person funding already has its original reservation')
  return installHiringResourceReservation(state, plan, record.hold, sequence)
}

/**
 * Verify the original World source without relabeling its real director operation as a resource tool action.
 * @param state - Actual retained Native case, plan and financial history.
 * @param hold - Original World-owned promise, including its actual reserve sequence and requester.
 */
export function assertHiringResourceSource(state: SimulationSnapshot, hold: SimulationResourceReservation): void {
  const source = hold.world, world = state.world, plan = source === undefined ? undefined : world?.plans[source.planId]
  const request = plan === undefined ? undefined : world?.requests[plan.requestId]
  const intent = request === undefined ? undefined : world?.intents[request.intentId]
  const operation = plan?.operationId == null ? undefined : state.operations[plan.operationId]
  const fee = intent === undefined ? undefined : hiringFee(state, intent)
  if (source === undefined || world === undefined || plan === undefined || request === undefined || intent === undefined
    || source.intentId !== intent.id || hold.id !== hiringResourceReservationId(plan.id) || hold.actorId !== fundingActor(state, intent)
    || hold.createdOperationId !== plan.operationId
    || plan.operationId === null && !isDeepStrictEqual(hold.management, request.source)
    || plan.operationId !== null && (operation?.entityId !== world.definition.directorEntityId || hold.management !== undefined)
    || plan.sequence >= hold.sequence || hold.sequence > state.revision
    || !isDeepStrictEqual(fee, source.fee) || !isDeepStrictEqual(hold.grants, source.fee.grants)
    || hold.expiresAt !== String(BigInt(hold.createdTime) + BigInt(source.fee.reservationPeriod))
    || hold.transaction.commitmentId !== null || !isDeepStrictEqual(hold.transaction.transfers,
    [{ from: source.fee.from, to: source.fee.to, quantity: source.fee.quantity }])
    || hold.transaction.reads.length !== 2 || !hold.transaction.reads.some(value => value.resourceId === source.fee.from)
    || !hold.transaction.reads.some(value => value.resourceId === source.fee.to))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
      'Hiring hold lost its actual original case, plan, requester, quote or reserve source')
  assertAcceptedWorldPlanSource(state, plan)
  if (source.fee.operation === 'generate-and-hire') {
    const reservation = world.reservations[intent.id]
    if (reservation?.sequence !== hold.sequence || reservation.request.planId !== plan.id
      || reservation.resourceReservationId !== hold.id || !isDeepStrictEqual(reservation.approvals, source.approvals))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hiring hold lost its atomic original generated-identity reservation')
  }
}
/**
 * Verify financial settlement against the original hiring result or a retained consumed expiry duty.
 * @param state - Complete prospective/published Native projection.
 * @param hold - Strict World-owned financial history.
 */
export function assertHiringResourceProjection(state: SimulationSnapshot, hold: SimulationResourceReservation): void {
  assertHiringResourceSource(state, hold)
  const source = hold.world
  if (source === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hiring projection lost its World source')
  const event = state.scheduledEvents[resourceReservationExpiryId(hold.id)]
  if (event === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hiring hold lost its original deadline')
  const marker = source.expiryConsumed
  if (marker !== undefined && (event.status !== 'consumed' || marker.eventId !== event.id
    || marker.sequence !== event.settledAt || marker.time !== hold.expiresAt))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Unknown hiring IO lost its original consumed-expiry responsibility')
  if (hold.phase === 'active') {
    if (hold.revision !== 1 || (marker === undefined ? event.status !== 'pending' : event.status !== 'consumed'))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Active hiring hold lost its pending deadline or retained cleanup obligation')
    if (marker !== undefined && !hasAcceptedHiringOffer(state, source.planId) && !['preparing', 'candidate', 'cancel-requested'].includes(state.world?.reservations[source.intentId]?.status ?? ''))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Consumed expiry can retain money only for an original uncleaned identity')
    return
  }
  if (hold.phase === 'expired') {
    if (hold.revision !== 2 || hold.settlement?.kind !== 'expiry' || event.status !== 'consumed'
      || hold.settlement.eventId !== event.id || hold.settlement.sequence !== event.settledAt || hold.settlement.time !== hold.expiresAt)
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Expired hiring hold lost its actual original deadline settlement')
    return
  }
  const settlement = hold.settlement
  const result = Object.values(state.world?.results ?? {}).find(value => value.intentId === source.intentId)
  if (hold.revision !== 2 || settlement?.kind !== 'world' || settlement.intentId !== source.intentId
    || settlement.planId !== source.planId || settlement.transition !== (hold.phase === 'committed' ? 'committed' : 'cancelled')
    || result?.outcome.kind !== settlement.transition || result.sequence !== settlement.sequence || result.time !== settlement.time
    || hold.phase === 'committed' && (result.source.kind !== 'plan' || result.source.planId !== source.planId
      || !hasAcceptedHiringOffer(state, source.planId) && BigInt(settlement.time) >= BigInt(hold.expiresAt))
    || (marker === undefined ? event.status !== 'cancelled' : event.status !== 'consumed'))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hiring payment or release lost its atomic original business result')
  if (source.fee.operation === 'generate-and-hire') {
    const reservation = state.world?.reservations[source.intentId]
    if (reservation?.updatedSequence !== settlement.sequence
      || reservation.status !== (hold.phase === 'committed' ? 'committed' : 'abandoned'))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hiring finance and identity were settled in different Native transitions')
  } else if (hold.phase === 'committed' && !Object.values(state.world?.mutations ?? {}).some(value =>
    value.planId === source.planId && value.sequence === settlement.sequence && value.time === settlement.time))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Existing hiring payment lost its original atomic assignment mutation')
  if (hold.phase === 'committed') for (const id of hold.grants) {
    const grant = state.grants[id]
    if (grant?.phase !== 'consumed' || grant.consumedBy !== undefined || !isDeepStrictEqual(grant.worldConsumption,
      { intentId: source.intentId, planId: source.planId, sequence: settlement.sequence, time: settlement.time }))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hiring grant consumption lost its actual original commit record')
  }
}

/**
 * Select original existing-person financial/position reservations without duplicating generated identity capacity.
 * @param state - Actual shared hold and case projection.
 * @param exclude - Own original case only during its current validation/commit.
 * @returns exact retained uncommitted existing-person reservations; terminal history remains in the ledger.
 */
export function existingHiringResourceHolds(state: SimulationSnapshot,
  exclude?: SimulationWorldIntent['id']): readonly SimulationResourceReservation[] {
  return Object.values(state.resourceReservations).filter(value => value.phase === 'active'
    && value.world?.fee.operation === 'hire-existing'
    && value.world.intentId !== exclude).sort((a, b) => a.id.localeCompare(b.id))
}
