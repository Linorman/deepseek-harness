import { hasAcceptedHiringOffer } from '@clocky/clocky-simulation'
/** Simulated deadline facts remain owned by the original conserved resource hold. */
import { isDeepStrictEqual } from 'node:util'
import { simulationResourceReservationSchema, simulationEventIdSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationResourceReservation, SimulationResourceReservationId,
  SimulationScheduledEvent, SimulationEventId } from '@clocky/clocky-simulation'
import { resourceAvailable } from './resource-ledger.ts'
import { assertHiringResourceSource, assertHiringResourceProjection } from './world-hiring-resources.ts'
/**
 * Derive the only scheduled expiry identity for an original resource business reservation.
 * @param id - Original run-local hold identity.
 * @returns exact source-owned deadline identity.
 */
export function resourceReservationExpiryId(id: SimulationResourceReservationId): SimulationEventId {
  return simulationEventIdSchema.parse(`simulation-resource-reservation-expiry:${id}`)
}
/**
 * Check the immutable deadline against its actual original applied reserve operation.
 * @param state - Native prefix retaining the original hold and operation.
 * @param event - Proposed or historical source-owned deadline.
 * @returns original hold; copied IDs, changed time, actor or revision reject.
 */
export function assertResourceReservationExpirySource(state: SimulationSnapshot,
  event: Pick<SimulationScheduledEvent, 'id' | 'action' | 'key'> & { readonly sourceOperationId?:
  import('@clocky/clocky-simulation').SimulationOperationId | undefined }): SimulationResourceReservation {
  if (event.action.kind !== 'resource-reservation-expiry') throw new Error('Resource expiry requires its original action')
  const hold = state.resourceReservations[event.action.id]
  const operation = hold?.createdOperationId == null ? undefined : state.operations[hold.createdOperationId]
  if (hold?.world !== undefined) {
    assertHiringResourceSource(state, hold)
    if (event.id !== resourceReservationExpiryId(hold.id) || event.sourceOperationId !== undefined
      || event.key.time !== hold.expiresAt || event.key.phase !== 'deadline' || event.action.revision !== 1)
      throw new Error('Hiring expiry lost its original reserve source, time, phase or identity')
    return hold
  }
  if (hold === undefined || operation?.action.kind !== 'resource/reserve' || operation.result?.status !== 'applied'
    || event.id !== resourceReservationExpiryId(hold.id) || event.sourceOperationId !== operation.id
    || event.key.time !== hold.expiresAt || event.key.phase !== 'deadline' || event.action.revision !== 1
    || operation.entityId !== hold.actorId || operation.result.sequence !== hold.sequence
    || operation.action.id !== hold.id || operation.action.expiresAt !== hold.expiresAt
    || !isDeepStrictEqual(operation.action.transaction, hold.transaction) || !isDeepStrictEqual(operation.action.grants, hold.grants))
    throw new Error('Resource expiry lost its original applied hold, deadline or operation source')
  return hold
}
/**
 * Release only a local hold at its actual consumed simulated deadline; no wall-clock timer or IO is involved.
 * @param state - Already consumed original event prefix at its exact deadline clock.
 * @param event - Original resource expiry duty.
 * @param sequence - Actual Native consumption sequence.
 * @returns terminal retained hold and spendable funds in the same atomic event.
 */
export function consumeResourceReservationExpiry(state: SimulationSnapshot, event: SimulationScheduledEvent,
  sequence: number): SimulationSnapshot {
  const hold = assertResourceReservationExpirySource(state, event)
  if (hold.phase !== 'active' || hold.revision !== 1 || state.time !== hold.expiresAt)
    throw new Error('Resource expiry cannot release a settled or differently timed hold')
  if (hold.world !== undefined && (hasAcceptedHiringOffer(state, hold.world.planId) || ['preparing', 'candidate', 'cancel-requested'].includes(
    state.world?.reservations[hold.world.intentId]?.status ?? ''))) {
    return { ...state, resourceReservations: { ...state.resourceReservations, [hold.id]: { ...hold,
      world: { ...hold.world, expiryConsumed: { eventId: event.id, sequence, time: state.time } } } } }
  }
  return { ...state, resourceReservations: { ...state.resourceReservations, [hold.id]: { ...hold, phase: 'expired', revision: 2,
    settlement: { kind: 'expiry', eventId: event.id, sequence, time: state.time } } } }
}
/**
 * Verify owned balances, immutable creation and every terminal settlement/expiry responsibility.
 * @param state - Complete published Native projection.
 */
export function assertResourceReservationProjection(state: SimulationSnapshot): void {
  if (Object.keys(state.resourceReservations).length > state.spec.maxResourceReservationHistory)
    throw new Error('Resource reservation history exceeds its original bound')
  for (const [id, stored] of Object.entries(state.resourceReservations)) {
    const hold = simulationResourceReservationSchema.parse(stored),
      source = hold.createdOperationId === null ? undefined : state.operations[hold.createdOperationId]
    const event = state.scheduledEvents[resourceReservationExpiryId(hold.id)]
    if (hold.world !== undefined) {
      if (id !== hold.id || event === undefined) throw new Error('Hiring resource identity or original deadline is absent')
      assertResourceReservationExpirySource(state, event)
      assertHiringResourceProjection(state, hold)
      continue
    }
    if (id !== hold.id || source?.action.kind !== 'resource/reserve' || source.result?.status !== 'applied'
      || source.entityId !== hold.actorId || source.result.sequence !== hold.sequence || source.result.time !== hold.createdTime
      || event === undefined) throw new Error('Resource hold lost its actual original reserve operation')
    assertResourceReservationExpirySource(state, event)
    if (hold.phase === 'active') {
      if (hold.revision !== 1 || event.status !== 'pending') throw new Error('Active resource hold lost its pending deadline')
    } else if (hold.phase === 'expired') {
      if (hold.revision !== 2 || hold.settlement?.kind !== 'expiry' || hold.settlement.eventId !== event.id
        || event.status !== 'consumed' || event.settledAt !== hold.settlement.sequence || hold.settlement.time !== hold.expiresAt)
        throw new Error('Expired resource hold lost its consumed simulated deadline')
    } else {
      const settlement = hold.settlement,
        operation = settlement?.kind === 'operation' ? state.operations[settlement.operationId] : undefined
      const expected = hold.phase === 'committed' ? 'resource/commit-reservation' : 'resource/cancel-reservation'
      if (hold.revision !== 2 || operation?.action.kind !== expected || operation.action.id !== hold.id
        || operation.action.expectedRevision !== 1 || operation.entityId !== hold.actorId || operation.result?.status !== 'applied'
        || settlement?.kind !== 'operation' || operation.result.sequence !== settlement.sequence
          || operation.result.time !== settlement.time
        || hold.phase === 'committed' && BigInt(settlement.time) >= BigInt(hold.expiresAt) || event.status !== 'cancelled')
        throw new Error('Settled resource hold lost its exact original conserved operation')
    }
  }
  for (const value of Object.values(state.resources)) if (resourceAvailable(state, value.id) < 0n)
    throw new Error('Resource available balance is negative after original active reservations')
  const locked = Object.values(state.resourceReservations).filter(value => value.phase === 'active').flatMap(value => value.grants)
  if (new Set(locked).size !== locked.length) throw new Error('One-use resource grant belongs to multiple active holds')
}
