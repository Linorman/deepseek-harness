import { simulationWorldEvidenceFieldSchema } from './world-evidence.ts'
/** Strict existing-person hiring preserves the original Entity, cognition, profile and canonical execution identity. */
import { z } from 'zod'
import { simulationEntityIdSchema, simulationRelationIdSchema } from './entity.ts'
import { simulationWorldDomainPinSchema } from './world-domain.ts'

/** Model request excludes Persona, Participant, Session and authorization conclusions. */
export const simulationWorldHireExistingPayloadSchema = z.strictObject({
  organizationEntityId: simulationEntityIdSchema,
  positionEntityId: simulationEntityIdSchema,
  personId: simulationEntityIdSchema,
  description: z.string().min(1),
})
/** Original request is also the complete apply payload; a director cannot substitute another person. */
export const simulationWorldHireExistingPlanPayloadSchema = simulationWorldHireExistingPayloadSchema
/** Pure local mutation repeats the exact accepted request without identity or profile fields. */
export const simulationWorldHireExistingMutationPayloadSchema = simulationWorldHireExistingPayloadSchema
/** Committed identity references reuse the existing person and one deterministic new assignment. */
export const simulationWorldHireExistingCommittedResultPayloadSchema = z.strictObject({
  entityId: simulationEntityIdSchema, relationId: simulationRelationIdSchema,
})
/** Public results contain only committed identity references or an empty non-commit outcome. */
export const simulationWorldHireExistingResultPayloadSchema = z.union([
  simulationWorldHireExistingCommittedResultPayloadSchema, z.strictObject({}),
])
/** Exact installed artifact; no compatibility name or generation fallback is permitted. */
export const WORLD_HIRE_EXISTING_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({
  domain: 'organization', operation: 'hire-existing', version: '1', schemaRef: 'clocky.organization.hire-existing/schema/1',
  implementationRef: 'clocky.organization.hire-existing/native/1', generation: 1,
}))
/** Shared strict parser set for Native, model tools and SDK consumers. */
export const WORLD_HIRE_EXISTING_DEFINITION = Object.freeze({ domain: 'organization', operation: 'hire-existing', version: '1',
  schemaRef: WORLD_HIRE_EXISTING_PIN.schemaRef,
  evidenceFields: Object.freeze([Object.freeze(simulationWorldEvidenceFieldSchema.parse({
    code: 'requirements', description: 'Clarify the requirements and constraints for this original hiring request.' }))]), schemas: Object.freeze({ request: simulationWorldHireExistingPayloadSchema,
    plan: simulationWorldHireExistingPlanPayloadSchema, mutation: simulationWorldHireExistingMutationPayloadSchema,
    result: simulationWorldHireExistingResultPayloadSchema }) })
/** Complete immutable existing-person hiring request, independent of a requester identity. */
export type SimulationWorldHireExistingPayload = z.infer<typeof simulationWorldHireExistingPayloadSchema>
