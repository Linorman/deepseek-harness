/** Strict personnel changes preserve original people and assignments; Native owns quiescence, fencing and retirement. */
import { z } from 'zod'
import { simulationEntityIdSchema, simulationRelationIdSchema } from './entity.ts'
import { simulationWorldDomainPinSchema } from './world-domain.ts'
import { simTimeSchema } from './time.ts'

const originalAssignment = {
  organizationEntityId: simulationEntityIdSchema,
  personId: simulationEntityIdSchema,
  assignmentId: simulationRelationIdSchema,
  assignmentRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  requestedEffectiveAt: simTimeSchema.nullable(),
  description: z.string().min(1),
}
/** Proposed transfer names the exact existing assignment and one declared target position, without replacement identity fields. */
export const simulationWorldTransferPayloadSchema = z.strictObject({ ...originalAssignment,
  targetPositionId: simulationEntityIdSchema })
/** Proposed departure names the original assignment; retire requests a separately confirmed stop of cognition, never termination. */
export const simulationWorldDepartPayloadSchema = z.strictObject({ ...originalAssignment, retire: z.boolean() })
/** Transfer apply and mutation must repeat the complete original request. */
export const simulationWorldTransferPlanPayloadSchema = simulationWorldTransferPayloadSchema
/** Departure apply and mutation must repeat the complete original request. */
export const simulationWorldDepartPlanPayloadSchema = simulationWorldDepartPayloadSchema
/** Exact transfer mutation payload excludes arbitrary relation commands and obligation dispositions. */
export const simulationWorldTransferMutationPayloadSchema = simulationWorldTransferPayloadSchema
/** Exact departure mutation payload excludes arbitrary entity phases, cancellation or successor identities. */
export const simulationWorldDepartMutationPayloadSchema = simulationWorldDepartPayloadSchema

const resultFields = { entityId: simulationEntityIdSchema, organizationEntityId: simulationEntityIdSchema,
  closedAssignmentId: simulationRelationIdSchema, previousPositionId: simulationEntityIdSchema,
  requestedEffectiveAt: simTimeSchema.nullable(), actualEffectiveAt: simTimeSchema,
  closedAuthorityRelationIds: z.array(simulationRelationIdSchema)
    .refine(values => new Set(values).size === values.length, 'Closed authority references must be distinct'),
  revokedAuthorityRelationIds: z.array(simulationRelationIdSchema)
    .refine(values => new Set(values).size === values.length, 'Revoked authority references must be distinct') }
/** Committed transfer reports both original closure and deterministic replacement assignment, including actual safe-boundary time. */
export const simulationWorldTransferCommittedResultPayloadSchema = z.strictObject({ ...resultFields,
  newAssignmentId: simulationRelationIdSchema, targetPositionId: simulationEntityIdSchema })
/** Committed departure records the requested retirement choice; Native independently proves any requested retirement before commit. */
export const simulationWorldDepartCommittedResultPayloadSchema = z.strictObject({ ...resultFields, retire: z.boolean() })
/** Noncommitted transfer has no invented effects. */
export const simulationWorldTransferResultPayloadSchema = z.union([
  simulationWorldTransferCommittedResultPayloadSchema, z.strictObject({}),
])
/** Noncommitted departure has no invented effects. */
export const simulationWorldDepartResultPayloadSchema = z.union([
  simulationWorldDepartCommittedResultPayloadSchema, z.strictObject({}),
])
/** Exact installed transfer parser and pure reducer identity. */
export const WORLD_TRANSFER_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({ domain: 'organization', operation: 'transfer',
  version: '1', schemaRef: 'clocky.organization.transfer/schema/1', implementationRef: 'clocky.organization.transfer/native/1', generation: 1 }))
/** Exact installed departure parser and pure reducer identity. */
export const WORLD_DEPART_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({ domain: 'organization', operation: 'depart',
  version: '1', schemaRef: 'clocky.organization.depart/schema/1', implementationRef: 'clocky.organization.depart/native/1', generation: 1 }))
/** Shared transfer parsers used by Native, model tools and SDK consumers. */
export const WORLD_TRANSFER_DEFINITION = Object.freeze({ domain: 'organization', operation: 'transfer', version: '1',
  schemaRef: WORLD_TRANSFER_PIN.schemaRef, schemas: Object.freeze({ request: simulationWorldTransferPayloadSchema,
    plan: simulationWorldTransferPlanPayloadSchema, mutation: simulationWorldTransferMutationPayloadSchema,
    result: simulationWorldTransferResultPayloadSchema }) })
/** Shared departure parsers used by Native, model tools and SDK consumers. */
export const WORLD_DEPART_DEFINITION = Object.freeze({ domain: 'organization', operation: 'depart', version: '1',
  schemaRef: WORLD_DEPART_PIN.schemaRef, schemas: Object.freeze({ request: simulationWorldDepartPayloadSchema,
    plan: simulationWorldDepartPlanPayloadSchema, mutation: simulationWorldDepartMutationPayloadSchema,
    result: simulationWorldDepartResultPayloadSchema }) })
/** Complete immutable transfer request. */
export type SimulationWorldTransferPayload = z.infer<typeof simulationWorldTransferPayloadSchema>
/** Complete immutable departure request. */
export type SimulationWorldDepartPayload = z.infer<typeof simulationWorldDepartPayloadSchema>
/** One strict original personnel request, selected by its installed operation. */
export type SimulationWorldPersonnelPayload = SimulationWorldTransferPayload | SimulationWorldDepartPayload
/** Personnel rejection categories stay independent of private descriptions and existing World failure envelopes. */
export class PersonnelDomainError extends Error {
  /** @param code - Exact failed personnel precondition. @param message - Trusted diagnosis without private obligation bodies. */
  constructor(readonly code: 'SIM_PERSONNEL_WAITING_TIME' | 'SIM_PERSONNEL_STALE_TIME'
    | 'SIM_PERSONNEL_CONFLICT' | 'SIM_PERSONNEL_AUTHORITY'
    | 'SIM_PERSONNEL_HANDOFF_REQUIRED', message: string) { super(message); this.name = 'PersonnelDomainError' }
}
