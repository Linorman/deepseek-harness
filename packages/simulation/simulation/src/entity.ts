/** JSON schemas for authoritative entity and organization commands. @module @clocky/clocky-simulation/entity */
import { z } from 'zod'
import type { SimulationEntityId, SimulationRelationId } from './identities.ts'
import { simTimeSchema } from './time.ts'

/** Stable entity identity, independent of residency and organizational roles. */
export const simulationEntityIdSchema = z.string().min(1).transform(value => value as SimulationEntityId)
/** Stable identity of one revisioned organization relation. */
export const simulationRelationIdSchema = z.string().min(1).transform(value => value as SimulationRelationId)
/** Opaque JSON metadata; non-JSON values reject before journal append. */
export const simulationProfileSchema = z.record(z.string(), z.json())
/** Entity lifecycle has one irreversible terminal state. */
export const simulationEntityPhaseSchema = z.enum(['active', 'inactive', 'terminated'])
/** Execution readiness is independent of entity lifecycle and never inferred from Team membership. */
export const simulationEntityReadinessSchema = z.enum(['preparing', 'ready', 'abandoned'])
/** Scenario-defined endpoint/scope kinds and temporal cycle policy; absent optional policy stays absent in JSON. */
export const simulationRelationRuleSchema = z.strictObject({
  relation: z.string().min(1),
  subjectKinds: z.array(z.string().min(1)).min(1),
  objectKinds: z.array(z.string().min(1)).min(1),
  scopeKinds: z.array(z.string().min(1)).min(1).optional(),
  acyclic: z.boolean(),
}).transform(({ scopeKinds, ...rule }) => ({ ...rule, ...scopeKinds === undefined ? {} : { scopeKinds } }))
const relationFields = {
  id: simulationRelationIdSchema,
  subject: simulationEntityIdSchema,
  relation: z.string().min(1),
  object: simulationEntityIdSchema,
  scope: simulationEntityIdSchema.optional(),
  validFrom: simTimeSchema,
  validUntil: simTimeSchema.nullable(),
}
/** Closed administrative mutations; model proposal tools must not expose this entry point. */
export const simulationChangeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('entity/create'),
    id: simulationEntityIdSchema,
    entityKind: z.string().min(1),
    cognition: z.enum(['none', 'agent']),
    readiness: simulationEntityReadinessSchema.exclude(['abandoned']),
    profile: simulationProfileSchema,
  }),
  z.strictObject({
    kind: z.literal('entity/readiness'),
    id: simulationEntityIdSchema,
    entityRevision: z.number().int().positive(),
    readiness: simulationEntityReadinessSchema.exclude(['preparing']),
  }),
  z.strictObject({
    kind: z.literal('entity/profile'),
    id: simulationEntityIdSchema,
    entityRevision: z.number().int().positive(),
    profile: simulationProfileSchema,
  }),
  z.strictObject({
    kind: z.literal('entity/phase'),
    id: simulationEntityIdSchema,
    entityRevision: z.number().int().positive(),
    phase: simulationEntityPhaseSchema,
  }),
  z.strictObject({ kind: z.literal('relation/create'), ...relationFields }),
  z.strictObject({
    kind: z.literal('relation/update'), ...relationFields,
    relationRevision: z.number().int().positive(),
  }),
])
