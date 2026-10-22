import { applyResourceOperation } from './resource-ledger.ts'
import type { NativeWorldRuntime } from './world-runtime.ts'
import { settleWorldOperation } from './world.ts'
/** Pure settlement of conserved resource effects and exact one-use grants. @module @clocky/clocky-simulation-local/business */
import { createHash } from 'node:crypto'
import stringify from 'fast-json-stable-stringify'
import { BusinessRejection, denyBusiness as deny } from './business-error.ts'
import { applyInteraction } from './interactions.ts'
import {
  simulationOperationIdSchema,
} from '@clocky/clocky-simulation'
import type {
  SimulationDecisionId, SimulationEntityId, SimulationOperation, SimulationOperationId, SimulationOperationResult,
  SimulationResourceSpec, SimulationRunId, SimulationSnapshot,
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

function applyAction(state: SimulationSnapshot, operation: SimulationOperation, runtime?: NativeWorldRuntime): SimulationSnapshot {
  if (!entityActive(state, operation.entityId)) deny('SIM_ENTITY_UNAVAILABLE')
  const action = operation.action
  switch (action.kind) {
    case 'world/request': case 'world/resolve': case 'world/evidence': return settleWorldOperation(state, operation, runtime)
    case 'task/create': case 'communication/post': throw new Error('Simulation communication requires its outbox transport')
    case 'interaction/request':
    case 'interaction/accept':
    case 'interaction/reject':
    case 'interaction/defer':
    case 'interaction/cancel':
    case 'interaction/confirm':
    case 'interaction/result': return applyInteraction(state, operation)
    case 'resource/reserve': case 'resource/commit-reservation': case 'resource/cancel-reservation':
    case 'resource/grant': case 'resource/revoke-grant': case 'resource/transfer': return applyResourceOperation(state, operation)
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
 * @param runtime - Original explicit World parser/reducer catalog; absent only for base simulation operations.
 * @returns the prospective atomic effect and its explicit outcome.
 */
export function computeOperation(state: SimulationSnapshot, operation: SimulationOperation, runtime?: NativeWorldRuntime): BusinessOutcome {
  for (const id of operation.dependencies) {
    const dependency = state.operations[id]
    if (dependency?.result === undefined) throw new Error('Simulation operation dependency is pending')
    if (dependency.result.status !== 'applied') return { state, status: 'blocked-dependency', code: 'SIM_DEPENDENCY_FAILED' }
  }
  try {
    const reused = operation.action.kind === 'resource/reserve' && state.resourceReservations[operation.action.id] !== undefined
    return { state: applyAction(state, operation, runtime), status: 'applied', code: reused ? 'SIM_RESOURCE_RESERVATION_REUSED' : 'SIM_APPLIED' }
  }
  catch (error) {
    if (!(error instanceof BusinessRejection)) throw error
    return { state, status: error.status, code: error.code }
  }
}
/* v8 ignore next 3 -- only the statically unreachable closed-union arm calls this helper. */
function assertNever(value: never): never {
  throw new Error(`Unknown business action: ${String(value)}`)
}
