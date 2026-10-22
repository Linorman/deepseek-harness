/** Simulated-only external identities and recorded deterministic availability; no network or resource mutation capability. */
import { z } from 'zod'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationResourceIdSchema, simulationQuantitySchema } from './business.ts'
import { simulationWorldDomainPinSchema, worldExternalIdentityIdSchema, worldIntentIdSchema,
  worldMutationIdSchema } from './world-domain.ts'
import { worldRequestIdSchema, worldPlanIdSchema } from './world.ts'
import { simTimeSchema } from './time.ts'

const text = z.string().min(1).max(256)
const sequence = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
/** Only an installed deterministic simulation policy may answer this operation. */
export const WORLD_EXTERNAL_INTERACT_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({ domain: 'external', operation: 'interact',
  version: '1', schemaRef: 'clocky.external.interact/schema/1', implementationRef: 'clocky.external.interact/native/1', generation: 1 }))
/** Exact subject and stable key; executable URLs, credentials, sender claims and source/sink effects have no fields. */
export const simulationExternalInteractRequestSchema = z.strictObject({ scope: simulationEntityIdSchema,
  externalKey: text.regex(/^[\p{L}\p{N}._-]+$/u), subjectRef: simulationEntityIdSchema,
  sourceKind: z.literal('simulated-rule'), policyRef: z.literal('clocky.external.availability/1'),
  input: z.strictObject({ kind: z.literal('availability'), unit: text }),
})
/** A plan acknowledges exact rule execution; it cannot choose observations or amounts. */
export const simulationExternalInteractPlanSchema = z.strictObject({ kind: z.literal('evaluate-rule') })
/** Unknown inventory remains unknown; known quantities are derived exclusively from original Native accounts. */
export const simulationExternalAvailabilitySchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unknown'), unit: text }),
  z.strictObject({ status: z.literal('known'), unit: text, quantity: simulationQuantitySchema }),
])
/** Trusted public rule projection contains references and typed quantities, never a director's free text. */
export const simulationExternalInteractResultSchema = z.union([z.strictObject({ identityId: worldExternalIdentityIdSchema,
  subjectRef: simulationEntityIdSchema, sourceKind: z.literal('simulated-rule'), policyRef: z.literal('clocky.external.availability/1'),
  disclosure: z.literal('requester'), availability: simulationExternalAvailabilitySchema }), z.strictObject({})])
/** Run-local identity binds a scope and business key to exactly one original noncognitive subject. */
const identityFields = { id: worldExternalIdentityIdSchema,
  scope: simulationEntityIdSchema, externalKey: text, subjectRef: simulationEntityIdSchema, revision: z.literal(1),
  source: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('request'), requestId: worldRequestIdSchema }),
    z.strictObject({ kind: z.literal('scenario'), definitionHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      bootstrapSequence: sequence }),
  ]), sequence }
/** Stable original external identity and immutable rule/actor representation policy. */
export const simulationExternalIdentitySchema = z.discriminatedUnion('representation', [
  z.strictObject({ ...identityFields, representation: z.literal('simulated-rule'),
    policyRef: z.literal('clocky.external.availability/1') }),
  z.strictObject({ ...identityFields, representation: z.literal('simulated-actor'),
    policyRef: z.literal('clocky.external.representative/1') }),
  z.strictObject({ ...identityFields, representation: z.literal('director-mediated'),
    policyRef: z.literal('clocky.external.adjudication/1') }),
])
/** Actual rule inputs and result are retained with the sole mutation; replay performs no external observation or sampling. */
export const simulationExternalInteractionSchema = z.strictObject({ intentId: worldIntentIdSchema,
  identityId: worldExternalIdentityIdSchema, requestId: worldRequestIdSchema, planId: worldPlanIdSchema,
  mutationId: worldMutationIdSchema, input: simulationExternalInteractRequestSchema,
  resources: z.array(z.strictObject({ id: simulationResourceIdSchema, revision: sequence,
    owner: simulationEntityIdSchema, unit: text, quantity: simulationQuantitySchema })),
  result: simulationExternalInteractResultSchema.options[0], time: simTimeSchema, recordedAt: z.number().int().nonnegative(), sequence,
})
/** Closed Native effect permits only evaluation of retained input, with no caller-selected outcome. */
export const simulationExternalEffectSchema = z.strictObject({ kind: z.literal('external/evaluate'),
  input: simulationExternalInteractRequestSchema })
/** Installed strict parsers for request, acknowledgement, outcome and mutation. */
export const WORLD_EXTERNAL_INTERACT_DEFINITION = Object.freeze({ domain: 'external', operation: 'interact', version: '1',
  directorEvents: true as const,
  schemaRef: WORLD_EXTERNAL_INTERACT_PIN.schemaRef, schemas: Object.freeze({ request: simulationExternalInteractRequestSchema,
    plan: simulationExternalInteractPlanSchema, mutation: simulationExternalInteractPlanSchema,
    result: simulationExternalInteractResultSchema }) })
