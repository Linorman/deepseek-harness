/** Durable callback responsibility; observations never fabricate a terminal business result or a physical stop receipt. */
import { z } from 'zod'
import { worldPlanIdSchema, worldRequestIdSchema } from './world.ts'
import { simulationWorldDomainPinSchema, worldIntentIdSchema } from './world-domain.ts'
import { simTimeSchema } from './time.ts'

/** Finite execution observations shared by Native and execution providers without importing a provider package. */
export const worldExecutionReasonSchema = z.enum([
  'until', 'work-limit', 'decision-required', 'paused', 'stalled',
  'retry', 'outcome-unknown', 'recipient-required', 'recipient-busy', 'coordination-limit',
  'resident-capacity', 'residency-recovery-required', 'idle', 'recovery-required', 'maintenance-blocked',
  'position-capacity', 'authority-missing', 'approval-required', 'existing-obligations', 'plan-stale', 'plan-budget',
  'entity-capacity', 'identity-capacity', 'channel-capacity', 'world-byte-limit', 'world-request-limit', 'world-command-limit',
  'world-birth-limit', 'world-expansion-limit', 'world-mutation-limit', 'budget-limit', 'message-rejected', 'context-integrity', 'decision-timeout', 'token-overrun', 'request-budget', 'context-limit', 'microstep-limit',
  'model-pool-capacity', 'activation-history-limit', 'message-byte-limit', 'stale-time', 'waiting-effective-time',
  'handoff-required', 'retirement-unknown', 'resource-capacity', 'resource-history-limit', 'resource-reservation-expired',
  'callback-unconfirmed', 'implementation-unavailable',
])
const sequence = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const transition = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('armed'), reason: z.null() }),
  z.strictObject({ phase: z.literal('settled'), reason: z.null() }),
  z.strictObject({ phase: z.literal('blocked'), reason: worldExecutionReasonSchema }),
  z.strictObject({ phase: z.literal('outcome-unknown'), reason: worldExecutionReasonSchema }),
])
const requestFields = {
  planId: worldPlanIdSchema,
  mode: z.enum(['execute', 'reconcile']),
  expectedSequence: sequence.nullable(),
}
/** Trusted owner transition; models cannot supply execution facts through their proposal vocabulary. */
export const worldExecutionRequestSchema = z.discriminatedUnion('phase', [
  z.strictObject({ ...requestFields, ...transition.options[0].shape }),
  z.strictObject({ ...requestFields, ...transition.options[1].shape }),
  z.strictObject({ ...requestFields, ...transition.options[2].shape }),
  z.strictObject({ ...requestFields, ...transition.options[3].shape }),
])
/** Native-assigned original references and bounded per-plan transition count. */
const observationFields = {
  ...requestFields, requestId: worldRequestIdSchema, intentId: worldIntentIdSchema,
  pin: simulationWorldDomainPinSchema, sequence, updates: sequence, time: simTimeSchema,
}
/** Parsed retained fact; only blocked and unknown observations carry a reason. */
export const worldExecutionObservationSchema = z.discriminatedUnion('phase', [
  z.strictObject({ ...observationFields, ...transition.options[0].shape }),
  z.strictObject({ ...observationFields, ...transition.options[1].shape }),
  z.strictObject({ ...observationFields, ...transition.options[2].shape }),
  z.strictObject({ ...observationFields, ...transition.options[3].shape }),
])
/** Stable reason independent of private provider diagnostics. */
export type WorldExecutionReason = z.infer<typeof worldExecutionReasonSchema>
/** Exact compare-and-set transition requested by the trusted execution owner. */
export type WorldExecutionRequest = z.infer<typeof worldExecutionRequestSchema>
/** Latest durable callback responsibility; armed and outcome-unknown remain nonterminal until reconciliation. */
export type WorldExecutionObservation = z.infer<typeof worldExecutionObservationSchema>
