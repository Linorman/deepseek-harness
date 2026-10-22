/** Closed external semantic claims and slim provenance, shared by facts and mediation without importing either owner. */
import { z } from 'zod'
import { simulationQuantitySchema, simulationResourceIdSchema } from './business.ts'
import { simulationCommitmentIdSchema } from './interaction.ts'
import { simTimeSchema } from './time.ts'
import { worldExternalIdentityIdSchema, worldIntentIdSchema } from './world-domain.ts'
import { worldRequestIdSchema, worldPlanIdSchema } from './world.ts'
import type { SimulationEventId } from './scheduler-types.ts'
const simulationEventIdSchema = z.string().min(1).transform(value => value as SimulationEventId)
const key = z.string().min(1).max(256).regex(/^[\p{L}\p{N}._-]+$/u)
/** Closed installed non-resource condition bodies; inventory, money and obligations cannot hide in arbitrary JSON. */
export const simulationExternalConditionSchema = z.discriminatedUnion('predicate', [
  z.strictObject({ kind: z.literal('condition'), predicate: z.literal('weather'), schemaRef: z.literal('weather/1'),
    value: z.strictObject({ status: z.enum(['clear', 'rain']) }) }),
  z.strictObject({ kind: z.literal('condition'), predicate: z.literal('lead-time'), schemaRef: z.literal('lead-time/1'),
    value: z.strictObject({ ticks: simTimeSchema }) }),
  z.strictObject({ kind: z.literal('condition'), predicate: z.literal('meeting-status'), schemaRef: z.literal('meeting-status/1'),
    value: z.strictObject({ status: z.enum(['scheduled', 'declined', 'cancelled']) }) }),
])
/** Authoritative semantic claims whose existing Native resource/contract constraints require independent verification. */
export const simulationExternalClaimSchema = z.union([simulationExternalConditionSchema,
  z.strictObject({ kind: z.literal('inventory-as-of'), unit: key, availability: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('unknown') }), z.strictObject({ status: z.literal('known'), quantity: simulationQuantitySchema }),
  ]) }),
  z.strictObject({ kind: z.literal('balance-as-of'), resourceId: simulationResourceIdSchema, quantity: simulationQuantitySchema }),
  z.strictObject({ kind: z.literal('commitment-as-of'), commitmentId: simulationCommitmentIdSchema,
    phase: z.enum(['open', 'fulfilled', 'cancelled']) }),
])
/** Closed external observation, distinct from unverified price reports. */
export type SimulationExternalClaim = z.infer<typeof simulationExternalClaimSchema>

/** Slim exact origin. Actor/policy/model versions remain in the original Native record, not copied private context. */
export const simulationExternalAdjudicatedFactProvenanceSchema = z.strictObject({ kind: z.literal('external-adjudication'),
  identityId: worldExternalIdentityIdSchema, intentId: worldIntentIdSchema, requestId: worldRequestIdSchema, planId: worldPlanIdSchema,
  adjudicationSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  policyFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  event: z.strictObject({ eventId: simulationEventIdSchema,
    consumedSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).optional(),
})
/** Safe structured publication body with an exact slim Native source, excluding private cognition material. */
export const simulationExternalAdjudicatedFactPayloadSchema = z.strictObject({ claim: simulationExternalClaimSchema, asOf: simTimeSchema,
  provenance: simulationExternalAdjudicatedFactProvenanceSchema })
/** Original adjudication reference and optional actual delayed consumption position. */
export type SimulationExternalAdjudicatedFactProvenance = z.infer<typeof simulationExternalAdjudicatedFactProvenanceSchema>
/** Safe authoritative claim and its original observed time and Native provenance. */
export type SimulationExternalAdjudicatedFactPayload = z.infer<typeof simulationExternalAdjudicatedFactPayloadSchema>
