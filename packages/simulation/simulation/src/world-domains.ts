import { simulationWorldEvidenceFieldSchema } from './world-evidence.ts'
/** Built-in domain schemas shared by Native admission and browser/SDK consumers; no provider IO. */
import { z } from 'zod'
import { simulationEntityIdSchema, simulationRelationIdSchema } from './entity.ts'
import { simulationWorldPersonaSchema, worldRequestIdSchema } from './world.ts'
import { simulationWorldDomainPinSchema } from './world-domain.ts'
import { SimulationWorldDomainRegistry } from './world-domain-registry.ts'

/** Exact installed organization operation; no alias or version fallback is admitted. */
export const WORLD_GENERATE_AND_HIRE = Object.freeze({ domain: 'organization', operation: 'generate-and-hire', version: '1' })
/** Installed schema/provider identity selected by trusted composition, never by a requester. */
export const WORLD_GENERATE_AND_HIRE_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({
  ...WORLD_GENERATE_AND_HIRE, schemaRef: 'clocky.organization.generate-and-hire/schema/3',
  implementationRef: 'clocky.organization.generate-and-hire/native/5', generation: 1,
}))
/** Proposed hiring payload excludes actor, Session, writer, generated identity and authorization fields. */
export const simulationWorldHirePayloadSchema = z.strictObject({
  organizationEntityId: simulationEntityIdSchema, positionEntityId: simulationEntityIdSchema,
  description: z.string().min(1), priorRequestId: worldRequestIdSchema.optional(),
})
/** Finite template selection shared by organization hiring and external identity preparation. */
export const simulationWorldFinitePersonaSelectionSchema = z.strictObject({
  templateId: z.string().min(1),
  templateVersion: z.string().min(1),
  persona: simulationWorldPersonaSchema,
})
/** Complete hiring selection; reviewed scenes additionally require its immutable original draft reference. */
export const simulationWorldHirePlanPayloadSchema = simulationWorldFinitePersonaSelectionSchema.extend({
  personaDraft: z.strictObject({ id: z.string().min(1).max(256), revision: z.number().int().min(1).max(16),
    bodyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).optional(),
})
/** Exact safe identity references required by a committed hiring result. */
export const simulationWorldHireCommittedResultPayloadSchema = z.strictObject({ entityId: simulationEntityIdSchema,
  relationId: simulationRelationIdSchema })

/** Safe hiring outcome payload; Native requires IDs for committed outcomes and an empty payload otherwise. */
export const simulationWorldHireResultPayloadSchema = z.union([
  simulationWorldHireCommittedResultPayloadSchema,
  z.strictObject({}),
])
/** Hire preparation responsibility refers to the accepted plan; identity allocation remains Native-owned. */
export const simulationWorldHireMutationPayloadSchema = z.strictObject({ maintenanceId: z.string().min(1) })

/** Fixed outer request fields advertised alongside the installed hiring operation. */
export const WORLD_HIRING_REQUEST_ENVELOPE = Object.freeze({
  expectedTime: null, evidence: Object.freeze([]),
  instruction: 'Use expectedTime: null and evidence: []. Hiring runs at the next safe boundary; Native checks current grants and policies.',
})

/** Check the fixed hiring envelope before staging and again at Native admission.
 * @param request - Full outer request, distinct from its operation-specific payload.
 * @throws when a caller supplies a requested time or supplemental evidence.
 */
export function validateWorldHiringEnvelope(request: { expectedTime: unknown; evidence: readonly unknown[] }): void {
  if (request.expectedTime !== null || request.evidence.length !== 0)
    throw new Error('organization/generate-and-hire/1 requires expectedTime: null and evidence: []; Native checks authorization.')
}

/** Complete built-in parser registration shared by the Native catalog and its execution provider. */
export const WORLD_GENERATE_AND_HIRE_DEFINITION = Object.freeze({ ...WORLD_GENERATE_AND_HIRE,
  schemaRef: WORLD_GENERATE_AND_HIRE_PIN.schemaRef,
  evidenceFields: Object.freeze([Object.freeze(simulationWorldEvidenceFieldSchema.parse({
    code: 'requirements', description: 'Clarify the requirements and constraints for this original hiring request.' }))]), schemas: Object.freeze({ request: simulationWorldHirePayloadSchema,
    plan: simulationWorldHirePlanPayloadSchema, result: simulationWorldHireResultPayloadSchema,
    mutation: simulationWorldHireMutationPayloadSchema }) })

/**
 * Install the built-in schema set without starting a run, acquiring an owner or invoking a model.
 * @returns caller-owned registry; plugin owners wrap subsequent registrations in ctx.effect().
 */
export function createSimulationWorldDomainRegistry(): SimulationWorldDomainRegistry {
  const registry = new SimulationWorldDomainRegistry()
  registry.register(WORLD_GENERATE_AND_HIRE_DEFINITION,
    { ref: WORLD_GENERATE_AND_HIRE_PIN.implementationRef, generation: WORLD_GENERATE_AND_HIRE_PIN.generation })
  return registry
}
