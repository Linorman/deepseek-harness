/** Narrow local mutation contract: only a non-cognitive object's display name can change. */
import { z } from 'zod'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationWorldDomainPinSchema } from './world-domain.ts'

/** Original target revision and name; no arbitrary profile or authority fields are admitted. */
export const localObjectRenameSchema = z.strictObject({ scopeEntityId: simulationEntityIdSchema,
  targetEntityId: simulationEntityIdSchema, entityRevision: z.number().int().nonnegative(), name: z.string().min(1).max(256) })
/** Visible reasons for falling back to the original whole-run maintenance path. */
export const localObjectFallbackReasonSchema = z.enum(['related-object', 'window-read-set-unknown', 'window-overlap', 'provider-unsupported'])
/** Closed fallback cause recorded by the original owner. */
export type LocalObjectFallbackReason = z.infer<typeof localObjectFallbackReasonSchema>
/** Private Native footprint; public result disclosure does not include unrelated owner references. */
export const localObjectFootprintSchema = z.strictObject({ entityId: simulationEntityIdSchema,
  entityRevision: z.number().int().nonnegative(), writerEpoch: z.null(), relations: z.array(z.string()),
  resources: z.array(z.string()), channels: z.array(z.string()), permissionRelations: z.array(z.string()), owner: z.literal('native') })
/** Complete Native-only dependency observation retained in the journal. */
export type LocalObjectFootprint = z.infer<typeof localObjectFootprintSchema>
/** Actual execution scope is recorded in the atomic public result without private footprint references. */
export const localObjectRenameResultSchema = localObjectRenameSchema.extend({ previousName: z.string(),
  execution: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('local'), owner: z.literal('native') }),
    z.strictObject({ kind: z.literal('maintenance'), reason: localObjectFallbackReasonSchema })]) })
/** Immutable capability identity; other domain providers do not inherit window concurrency. */
export const WORLD_LOCAL_OBJECT_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({ domain: 'organization',
  operation: 'rename-object', version: '1', schemaRef: 'clocky.organization.rename-object/schema/1',
  implementationRef: 'clocky.organization.rename-object/native/1', generation: 1 }))
/** Closed payloads preserve every profile field except the display name. */
export const WORLD_LOCAL_OBJECT_DEFINITION = Object.freeze({ domain: WORLD_LOCAL_OBJECT_PIN.domain,
  operation: WORLD_LOCAL_OBJECT_PIN.operation, version: WORLD_LOCAL_OBJECT_PIN.version,
  schemaRef: WORLD_LOCAL_OBJECT_PIN.schemaRef, schemas: Object.freeze({ request: localObjectRenameSchema,
    plan: localObjectRenameSchema, mutation: localObjectRenameSchema, result: localObjectRenameResultSchema }) })
