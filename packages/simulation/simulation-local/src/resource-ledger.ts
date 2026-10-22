/** Conserved resource holds share the same owner and transfer arithmetic as immediate transactions. */
import { isDeepStrictEqual } from 'node:util'
import { simulationQuantitySchema, simulationResourceReservationSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationResourceId, SimulationResource, SimulationTransaction,
  SimulationOperation, SimulationResourceReservationId, SimulationResourceReservation, SimulationResourceGrant,
  SimulationEntityId, SimulationGrantId } from '@clocky/clocky-simulation'
import { rejectBusiness as reject, denyBusiness as deny } from './business-error.ts'
import { businessFingerprint } from './business.ts'
import { recordTransferEvidence } from './interactions.ts'
function active(state: SimulationSnapshot, id: SimulationEntityId): boolean {
  return Object.hasOwn(state.entities, id) && state.entities[id]?.phase === 'active'
}
function resource(state: SimulationSnapshot, id: SimulationResourceId): SimulationResource {
  const value = Object.hasOwn(state.resources, id) ? state.resources[id] : undefined
  if (value === undefined) reject('SIM_RESOURCE_NOT_FOUND')
  return value
}
function distinct(values: readonly string[]): boolean { return new Set(values).size === values.length }
/**
 * Compute spendable amount from the exact conserved balance and all unsettled holds.
 * @param state - Current authoritative resource ledger.
 * @param id - Actual debit account.
 * @param exclude - Own hold only while replacing it with its atomic transfer.
 * @returns available units; an overdue unsatisfied expiry still retains its recorded responsibility.
 */
export function resourceAvailable(state: SimulationSnapshot, id: SimulationResourceId,
  exclude?: SimulationResourceReservationId): bigint {
  let result = BigInt(resource(state, id).quantity)
  for (const hold of Object.values(state.resourceReservations)) {
    if (hold.phase !== 'active' || hold.id === exclude) continue
    for (const transfer of hold.transaction.transfers) if (transfer.from === id) result -= BigInt(transfer.quantity)
  }
  return result
}
/**
 * Validate all units, touched accounts and frozen quantity revisions before constructing any effect.
 * @param state - Actual account projection.
 * @param transaction - Original complete read set and transfers.
 */
export function validateResourceTransaction(state: SimulationSnapshot, transaction: SimulationTransaction): void {
  if (!distinct(transaction.reads.map(read => read.resourceId))) reject('SIM_RESOURCE_READ_SET_INVALID')
  const touched = new Set(transaction.transfers.flatMap(transfer => [transfer.from, transfer.to]))
  if (transaction.reads.length !== touched.size || transaction.reads.some(read => !touched.has(read.resourceId)))
    reject('SIM_RESOURCE_READ_SET_INVALID')
  for (const read of transaction.reads) if (resource(state, read.resourceId).revision !== read.revision)
    reject('SIM_RESOURCE_REVISION_CONFLICT')
  const debits = new Set(transaction.transfers.map(transfer => transfer.from))
  if (transaction.transfers.some(transfer => debits.has(transfer.to))) reject('SIM_RESOURCE_CYCLIC_TRANSFER')
  for (const transfer of transaction.transfers) {
    const from = resource(state, transfer.from), to = resource(state, transfer.to)
    if (from.kind !== to.kind || from.unit !== to.unit) reject('SIM_RESOURCE_UNIT_MISMATCH')
    if (BigInt(transfer.quantity) > BigInt(state.spec.maxResourceQuantity)) reject('SIM_RESOURCE_LIMIT')
  }
}
function authority(state: SimulationSnapshot, actor: SimulationEntityId, transaction: SimulationTransaction,
  ids: readonly SimulationGrantId[], exclude?: SimulationResourceReservationId): SimulationResourceGrant[] {
  if (!distinct(ids)) reject('SIM_GRANT_DUPLICATE')
  const fingerprint = businessFingerprint(transaction)
  const grants = ids.map((id) => {
    const grant = Object.hasOwn(state.grants, id) ? state.grants[id] : undefined
    if (grant === undefined) reject('SIM_GRANT_NOT_FOUND')
    if (grant.phase !== 'available') reject('SIM_GRANT_USED')
    if (grant.grantee !== actor || grant.transactionFingerprint !== fingerprint) deny('SIM_GRANT_MISMATCH')
    if (Object.values(state.resourceReservations).some(hold => hold.id !== exclude && hold.phase === 'active' && hold.grants.includes(id)))
      reject('SIM_GRANT_RESERVED')
    if (!active(state, grant.issuer) || grant.resources.some(resourceId => !resource(state, resourceId).controllers.includes(grant.issuer)))
      deny('SIM_GRANT_AUTHORITY')
    return grant
  })
  for (const transfer of transaction.transfers) {
    if (!resource(state, transfer.from).controllers.includes(actor) && !grants.some(grant => grant.resources.includes(transfer.from)))
      deny('SIM_RESOURCE_AUTHORITY')
  }
  return grants
}
function balances(state: SimulationSnapshot, transaction: SimulationTransaction, exclude?: SimulationResourceReservationId) {
  const amounts = new Map<SimulationResourceId, bigint>(), debits = new Map<SimulationResourceId, bigint>()
  for (const read of transaction.reads) amounts.set(read.resourceId, BigInt(resource(state, read.resourceId).quantity))
  for (const transfer of transaction.transfers) {
    debits.set(transfer.from, (debits.get(transfer.from) ?? 0n) + BigInt(transfer.quantity))
    amounts.set(transfer.from, (amounts.get(transfer.from) ?? 0n) - BigInt(transfer.quantity))
    amounts.set(transfer.to, (amounts.get(transfer.to) ?? 0n) + BigInt(transfer.quantity))
  }
  for (const [id, amount] of debits) if (amount > resourceAvailable(state, id, exclude)) reject('SIM_RESOURCE_INSUFFICIENT')
  for (const amount of amounts.values()) {
    if (amount < 0n) reject('SIM_RESOURCE_INSUFFICIENT')
    if (amount > BigInt(state.spec.maxResourceQuantity)) reject('SIM_RESOURCE_LIMIT')
  }
  return amounts
}
/**
 * Validate an authenticated owner's exact funding promise against this shared ledger.
 * @param state - Actual Native account, grant and hold projection.
 * @param actor - Original owner-derived actor; this function does not derive request authority.
 * @param transaction - Complete frozen read-set, debit and credit terms.
 * @param grants - Exact one-use grants selected by the original promise.
 * @param exclude - Own hold only while settling that same promise.
 */
export function validateResourceFunding(state: SimulationSnapshot, actor: SimulationEntityId,
  transaction: SimulationTransaction, grants: readonly SimulationGrantId[], exclude?: SimulationResourceReservationId): void {
  validateResourceTransaction(state, transaction)
  authority(state, actor, transaction, grants, exclude)
  balances(state, transaction, exclude)
}
/**
 * Construct the conserved payment under its authenticated Native owner without publishing or recording evidence.
 * @param state - Original account, hold and grant projection.
 * @param actor - Actual owner-derived payer authority.
 * @param transaction - Immutable original terms and account revisions.
 * @param grantIds - Original one-use grant identities.
 * @param source - Actual transfer operation or hiring commit record owning consumed grants.
 * @param exclude - Exact hold replaced by this payment.
 * @returns prospective balances and consumed grants; the caller settles its own responsibility in the same append.
 */
export function applyResourceFunding(state: SimulationSnapshot, actor: SimulationEntityId,
  transaction: SimulationTransaction, grantIds: readonly SimulationGrantId[],
  source: { readonly kind: 'operation'; readonly operationId: import('@clocky/clocky-simulation').SimulationOperationId }
    | { readonly kind: 'world'; readonly consumption: NonNullable<SimulationResourceGrant['worldConsumption']> },
  exclude?: SimulationResourceReservationId): SimulationSnapshot {
  validateResourceTransaction(state, transaction)
  const grants = authority(state, actor, transaction, grantIds, exclude)
  const amounts = balances(state, transaction, exclude), resources = { ...state.resources }, updatedGrants = { ...state.grants }
  for (const [id, amount] of amounts) resources[id] = { ...resource(state, id),
    quantity: simulationQuantitySchema.parse(String(amount)), revision: resource(state, id).revision + 1 }
  for (const grant of grants) updatedGrants[grant.id] = { ...grant, phase: 'consumed', revision: grant.revision + 1,
    ...source.kind === 'operation' ? { consumedBy: source.operationId } : { worldConsumption: source.consumption } }
  return { ...state, resources, grants: updatedGrants }
}
function reservation(state: SimulationSnapshot, id: SimulationResourceReservationId): SimulationResourceReservation {
  const value = Object.hasOwn(state.resourceReservations, id) ? state.resourceReservations[id] : undefined
  if (value === undefined) reject('SIM_RESOURCE_RESERVATION_NOT_FOUND')
  return value
}
function replace(state: SimulationSnapshot, hold: SimulationResourceReservation): SimulationSnapshot {
  return { ...state, resourceReservations: { ...state.resourceReservations, [hold.id]: hold } }
}
/**
 * Apply only the resource-owned actions under the actual accepted actor and complete ledger.
 * @param state - Actual pre-settlement Native prefix.
 * @param operation - Original accepted actor, transaction and reservation identity.
 * @returns one prospective local effect; failures publish neither money nor holds.
 */
export function applyResourceOperation(state: SimulationSnapshot, operation: SimulationOperation): SimulationSnapshot {
  const action = operation.action
  switch (action.kind) {
    case 'resource/reserve': {
      const previous = state.resourceReservations[action.id]
      if (previous !== undefined) {
        if (previous.world !== undefined) deny('SIM_RESOURCE_RESERVATION_OWNER')
        if (previous.actorId !== operation.entityId || previous.expiresAt !== action.expiresAt
          || !isDeepStrictEqual(previous.transaction, action.transaction) || !isDeepStrictEqual(previous.grants, action.grants))
          reject('SIM_RESOURCE_RESERVATION_CONFLICT')
        return state
      }
      if (Object.keys(state.resourceReservations).length >= state.spec.maxResourceReservationHistory)
        reject('SIM_RESOURCE_RESERVATION_HISTORY_LIMIT')
      if (BigInt(action.expiresAt) <= BigInt(state.time) || BigInt(action.expiresAt) > BigInt(state.spec.maxTime))
        reject('SIM_RESOURCE_RESERVATION_DEADLINE_INVALID')
      validateResourceTransaction(state, action.transaction)
      authority(state, operation.entityId, action.transaction, action.grants)
      balances(state, action.transaction)
      return replace(state, simulationResourceReservationSchema.parse({ id: action.id, actorId: operation.entityId,
        transaction: action.transaction, grants: action.grants, expiresAt: action.expiresAt, createdTime: state.time,
        createdOperationId: operation.id, sequence: state.revision + 1, revision: 1, phase: 'active' }))
    }
    case 'resource/cancel-reservation':
    case 'resource/commit-reservation': {
      const hold = reservation(state, action.id)
      if (hold.world !== undefined) deny('SIM_RESOURCE_RESERVATION_OWNER')
      if (hold.actorId !== operation.entityId) deny('SIM_RESOURCE_RESERVATION_AUTHORITY')
      if (hold.revision !== action.expectedRevision || hold.phase !== 'active') reject('SIM_RESOURCE_RESERVATION_REVISION_CONFLICT')
      if (action.kind === 'resource/cancel-reservation') return replace(state, { ...hold, revision: hold.revision + 1, phase: 'cancelled',
        settlement: { kind: 'operation', operationId: operation.id, sequence: state.revision + 1, time: state.time } })
      if (BigInt(state.time) >= BigInt(hold.expiresAt)) reject('SIM_RESOURCE_RESERVATION_EXPIRED')
      const next = replace(applyResourceFunding(state, operation.entityId, hold.transaction, hold.grants,
        { kind: 'operation', operationId: operation.id }, hold.id), { ...hold, phase: 'committed', revision: hold.revision + 1,
        settlement: { kind: 'operation', operationId: operation.id, sequence: state.revision + 1, time: state.time } })
      return recordTransferEvidence(next, operation)
    }
    case 'resource/transfer': {
      return recordTransferEvidence(applyResourceFunding(state, operation.entityId, action.transaction, action.grants,
        { kind: 'operation', operationId: operation.id }), operation)
    }
    case 'resource/grant': {
      if (Object.hasOwn(state.grants, action.id)) reject('SIM_GRANT_CONFLICT')
      if (!active(state, action.grantee)) reject('SIM_GRANTEE_UNAVAILABLE')
      if (!distinct(action.resources)) reject('SIM_GRANT_RESOURCES_INVALID')
      validateResourceTransaction(state, action.transaction)
      for (const id of action.resources) {
        if (!action.transaction.transfers.some(transfer => transfer.from === id)) reject('SIM_GRANT_RESOURCES_INVALID')
        if (!resource(state, id).controllers.includes(operation.entityId)) deny('SIM_RESOURCE_AUTHORITY')
      }
      return { ...state, grants: { ...state.grants, [action.id]: { id: action.id, issuer: operation.entityId, grantee: action.grantee,
        resources: action.resources, transactionFingerprint: businessFingerprint(action.transaction), revision: 1,
        phase: 'available', operationId: operation.id } } }
    }
    case 'resource/revoke-grant': {
      const grant = Object.hasOwn(state.grants, action.id) ? state.grants[action.id] : undefined
      if (grant === undefined) reject('SIM_GRANT_NOT_FOUND')
      if (grant.issuer !== operation.entityId) deny('SIM_GRANT_AUTHORITY')
      if (grant.revision !== action.expectedRevision || grant.phase !== 'available') reject('SIM_GRANT_REVISION_CONFLICT')
      return { ...state, grants: { ...state.grants, [grant.id]: { ...grant, revision: grant.revision + 1, phase: 'revoked' } } }
    }
    default: throw new Error('Resource owner received a non-resource operation')
  }
}
