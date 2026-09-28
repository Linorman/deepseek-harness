/** Pure settlement of conserved resource effects and exact one-use grants. @module @clocky/clocky-simulation-local/business */
import { createHash } from 'node:crypto'
import stringify from 'fast-json-stable-stringify'
import { BusinessRejection, rejectBusiness as reject, denyBusiness as deny } from './business-error.ts'
import { applyInteraction, recordTransferEvidence } from './interactions.ts'
import {
  simulationOperationIdSchema, simulationQuantitySchema,
} from '@clocky/clocky-simulation'
import type {
  SimulationDecisionId, SimulationEntityId, SimulationOperation, SimulationOperationId, SimulationOperationResult,
  SimulationResource, SimulationResourceId, SimulationResourceSpec, SimulationRunId, SimulationSnapshot, SimulationTransaction,
} from '@clocky/clocky-simulation'

/**
 * Canonical JSON fingerprint for already schema-validated business data.
 * @param value - JSON-safe value.
 * @returns SHA-256 identity.
 */
export function businessFingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(stringify(value)).digest('hex')}`
}
/**
 * Derive an operation identity without delimiter or Unicode ambiguity.
 * @param run - Run namespace.
 * @param decision - Decision identity.
 * @param index - Ordered operation index.
 * @returns stable retry identity.
 */
export function operationId(run: SimulationRunId, decision: SimulationDecisionId, index: number): SimulationOperationId {
  return simulationOperationIdSchema.parse(`simulation-operation:${businessFingerprint([run, decision, index]).slice(7)}`)
}
function entityActive(state: SimulationSnapshot, id: SimulationEntityId): boolean {
  return Object.hasOwn(state.entities, id) && state.entities[id]?.phase === 'active'
}
function resource(state: SimulationSnapshot, id: SimulationResourceId): SimulationResource {
  const value = Object.hasOwn(state.resources, id) ? state.resources[id] : undefined
  if (value === undefined) reject('SIM_RESOURCE_NOT_FOUND')
  return value
}
function distinct(values: readonly string[]): boolean { return new Set(values).size === values.length }

/**
 * Create an administrative resource without a model-facing mint operation.
 * @param state - Current run projection.
 * @param spec - Parsed initial account and authority.
 * @returns updated projection before publication.
 */
export function createResource(state: SimulationSnapshot, spec: SimulationResourceSpec): SimulationSnapshot {
  if (Object.hasOwn(state.resources, spec.id)) throw new Error('Simulation resource already exists')
  if (!entityActive(state, spec.owner) || spec.controllers.some(id => !entityActive(state, id))) throw new Error('Resource identities must name active entities')
  if (!distinct(spec.controllers)) throw new Error('Resource controllers must be distinct')
  if (BigInt(spec.quantity) > BigInt(state.spec.maxResourceQuantity)) throw new Error('Resource quantity exceeds the configured maximum')
  return { ...state, resources: { ...state.resources, [spec.id]: { ...spec, revision: 1 } } }
}

/** Validate the complete read set before constructing any balance changes. */
function validateTransaction(state: SimulationSnapshot, transaction: SimulationTransaction): void {
  if (!distinct(transaction.reads.map(read => read.resourceId))) reject('SIM_RESOURCE_READ_SET_INVALID')
  const touched = new Set(transaction.transfers.flatMap(transfer => [transfer.from, transfer.to]))
  if (transaction.reads.length !== touched.size || transaction.reads.some(read => !touched.has(read.resourceId))) reject('SIM_RESOURCE_READ_SET_INVALID')
  for (const read of transaction.reads) {
    if (resource(state, read.resourceId).revision !== read.revision) reject('SIM_RESOURCE_REVISION_CONFLICT')
  }
  const debits = new Set(transaction.transfers.map(transfer => transfer.from))
  if (transaction.transfers.some(transfer => debits.has(transfer.to))) reject('SIM_RESOURCE_CYCLIC_TRANSFER')
  for (const transfer of transaction.transfers) {
    const from = resource(state, transfer.from)
    const to = resource(state, transfer.to)
    if (from.kind !== to.kind || from.unit !== to.unit) reject('SIM_RESOURCE_UNIT_MISMATCH')
    if (BigInt(transfer.quantity) > BigInt(state.spec.maxResourceQuantity)) reject('SIM_RESOURCE_LIMIT')
  }
}
function applyAction(state: SimulationSnapshot, operation: SimulationOperation): SimulationSnapshot {
  if (!entityActive(state, operation.entityId)) deny('SIM_ENTITY_UNAVAILABLE')
  const action = operation.action
  switch (action.kind) {
    case 'task/create': case 'communication/post': throw new Error('Simulation communication requires its outbox transport')
    case 'interaction/request':
    case 'interaction/accept':
    case 'interaction/reject':
    case 'interaction/defer':
    case 'interaction/cancel':
    case 'interaction/confirm':
    case 'interaction/result': return applyInteraction(state, operation)
    case 'resource/grant': {
      if (Object.hasOwn(state.grants, action.id)) reject('SIM_GRANT_CONFLICT')
      if (!entityActive(state, action.grantee)) reject('SIM_GRANTEE_UNAVAILABLE')
      if (!distinct(action.resources)) reject('SIM_GRANT_RESOURCES_INVALID')
      validateTransaction(state, action.transaction)
      for (const id of action.resources) {
        if (!action.transaction.transfers.some(transfer => transfer.from === id)) reject('SIM_GRANT_RESOURCES_INVALID')
        if (!resource(state, id).controllers.includes(operation.entityId)) deny('SIM_RESOURCE_AUTHORITY')
      }
      return { ...state, grants: { ...state.grants, [action.id]: {
        id: action.id, issuer: operation.entityId, grantee: action.grantee, resources: action.resources,
        transactionFingerprint: businessFingerprint(action.transaction), revision: 1, phase: 'available', operationId: operation.id,
      } } }
    }
    case 'resource/revoke-grant': {
      const grant = Object.hasOwn(state.grants, action.id) ? state.grants[action.id] : undefined
      if (grant === undefined) reject('SIM_GRANT_NOT_FOUND')
      if (grant.issuer !== operation.entityId) deny('SIM_GRANT_AUTHORITY')
      if (grant.revision !== action.expectedRevision || grant.phase !== 'available') reject('SIM_GRANT_REVISION_CONFLICT')
      return { ...state, grants: { ...state.grants, [grant.id]: { ...grant, revision: grant.revision + 1, phase: 'revoked' } } }
    }
    case 'resource/transfer': {
      validateTransaction(state, action.transaction)
      if (!distinct(action.grants)) reject('SIM_GRANT_DUPLICATE')
      const fingerprint = businessFingerprint(action.transaction)
      const grants = action.grants.map((id) => {
        const grant = Object.hasOwn(state.grants, id) ? state.grants[id] : undefined
        if (grant === undefined) reject('SIM_GRANT_NOT_FOUND')
        if (grant.phase !== 'available') reject('SIM_GRANT_USED')
        if (grant.grantee !== operation.entityId || grant.transactionFingerprint !== fingerprint) deny('SIM_GRANT_MISMATCH')
        if (!entityActive(state, grant.issuer) || grant.resources.some(id => !resource(state, id).controllers.includes(grant.issuer))) {
          deny('SIM_GRANT_AUTHORITY')
        }
        return grant
      })
      const balances = new Map<SimulationResourceId, bigint>()
      for (const read of action.transaction.reads) balances.set(read.resourceId, BigInt(resource(state, read.resourceId).quantity))
      for (const transfer of action.transaction.transfers) {
        if (!resource(state, transfer.from).controllers.includes(operation.entityId)
          && !grants.some(grant => grant.resources.includes(transfer.from))) deny('SIM_RESOURCE_AUTHORITY')
        balances.set(transfer.from, (balances.get(transfer.from) as bigint) - BigInt(transfer.quantity))
        balances.set(transfer.to, (balances.get(transfer.to) as bigint) + BigInt(transfer.quantity))
      }
      const resources = { ...state.resources }
      for (const [id, quantity] of balances) {
        if (quantity < 0n) reject('SIM_RESOURCE_INSUFFICIENT')
        if (quantity > BigInt(state.spec.maxResourceQuantity)) reject('SIM_RESOURCE_LIMIT')
        const previous = resource(state, id)
        resources[id] = { ...previous, quantity: simulationQuantitySchema.parse(String(quantity)), revision: previous.revision + 1 }
      }
      const updatedGrants = { ...state.grants }
      for (const grant of grants) updatedGrants[grant.id] = { ...grant, phase: 'consumed', revision: grant.revision + 1, consumedBy: operation.id }
      return recordTransferEvidence({ ...state, resources, grants: updatedGrants }, operation)
    }
    /* v8 ignore next 2 -- operation actions cross the strict discriminated schema before execution. */
    default:
      return assertNever(action)
  }
}

/** One projected effect and the outcome that must be recorded with it. */
export interface BusinessOutcome {
  readonly state: SimulationSnapshot
  readonly status: SimulationOperationResult['status']
  readonly code: string
}
/**
 * Compute a complete local effect; business failures keep every resource and grant unchanged.
 * @param state - Current authoritative projection.
 * @param operation - Accepted immutable intent.
 * @returns the prospective atomic effect and its explicit outcome.
 */
export function computeOperation(state: SimulationSnapshot, operation: SimulationOperation): BusinessOutcome {
  for (const id of operation.dependencies) {
    const dependency = state.operations[id]
    if (dependency?.result === undefined) throw new Error('Simulation operation dependency is pending')
    if (dependency.result.status !== 'applied') return { state, status: 'blocked-dependency', code: 'SIM_DEPENDENCY_FAILED' }
  }
  try { return { state: applyAction(state, operation), status: 'applied', code: 'SIM_APPLIED' } }
  catch (error) {
    if (!(error instanceof BusinessRejection)) throw error
    return { state, status: error.status, code: error.code }
  }
}
/* v8 ignore next 3 -- only the statically unreachable closed-union arm calls this helper. */
function assertNever(value: never): never {
  throw new Error(`Unknown business action: ${String(value)}`)
}
