/** Private deployment and persistence registration types; never imported by browser DTOs. */
import type { ProductPrincipalId } from '@clocky/clocky-product-principal'
import type { SimulationRunSpec } from '@clocky/clocky-simulation'
import type { SimulationProductRunId } from './types.ts'
import type { SimulationEntityId } from '@clocky/clocky-simulation/identities'
import type { SimulationOperationId } from '@clocky/clocky-simulation/identities'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type { SimulationProductOperationRetryCapability } from './operation-retry-types.ts'

/** Current administration metadata adds read-only admission to exact native fences; the callback owns no native effects. */
export type SimulationProductOperationRetryReader = (runId: SimulationProductRunId, operationId: SimulationOperationId,
  native: SimulationProductOperationRetryCapability, call: AuthenticatedProductCall) => Promise<SimulationProductOperationRetryCapability>

/** Explicit private-context disclosure, independent of registration discovery and execution permission. */
export interface SimulationProductContextReader {
  /** Authenticated owner identity; this does not authorize another principal's registration. */
  readonly principalId: ProductPrincipalId
  /** Omission grants this principal's owned registrations only; it never grants another owner's run. */
  readonly runId?: SimulationProductRunId | undefined
  /** Exact actor identities whose retained historical context text may be disclosed. */
  readonly entityIds: readonly SimulationEntityId[]
  /** Explicit disclosure domains; omission allows historical context only. Knowledge and source text need their own entries. */
  readonly content?: readonly ('context' | 'knowledge' | 'sources')[] | undefined
}

/** Trusted deployment registration; never accepted as a browser request. */
export interface SimulationProductImport {
  /** Opaque product identity exposed to readers; independent of provider storage selection. */
  readonly id: SimulationProductRunId
  /** Deployment display name; public output explicitly marks any UTF-8 truncation. */
  readonly name: string
  /** Registry provider identity resolved only for actual native history inspection. */
  readonly provider: string
  /** Exact immutable expected native run configuration, including provider-local run identity. */
  readonly spec: SimulationRunSpec
  /** Durable authenticated principal permitted to discover and inspect this registration. */
  readonly ownerPrincipalId: ProductPrincipalId
}

/** Immutable persisted registration, not a duplicate of current world facts. */
export interface SimulationProductRecord extends SimulationProductImport {
  readonly registeredAt: number
}

/** Trusted whole-run journal disclosure, including historical private inputs and deployment reservations. */
export interface SimulationProductRecordReader {
  /** Current authenticated registration owner; this grants no access to another owner's run. */
  readonly principalId: ProductPrincipalId
  /** Exact owned registration; omission permits this principal's owned registrations. */
  readonly runId?: SimulationProductRunId | undefined
}
