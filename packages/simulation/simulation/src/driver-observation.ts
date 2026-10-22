/** Safe durable scheduler observations do not authorize inference or alter Native phase. */
import { z } from 'zod'

/** Closed public failure facts; diagnostic provider text and opaque provider IDs are excluded. */
export const simulationDriverFailureSchema = z.strictObject({ failureId: z.uuid(), ownerId: z.uuid(), batchId: z.uuid(),
  occurredAt: z.number().int().nonnegative(), revision: z.number().int().nonnegative(),
  category: z.enum(['payment-required', 'insufficient-balance', 'rate-limited', 'network', 'provider-unavailable', 'context-limit',
    'request-budget', 'token-overrun', 'protocol-unavailable', 'history-limit', 'storage', 'integrity', 'unknown']),
  retryDisposition: z.enum(['explicit-resume', 'account-action', 'repair-required', 'unknown']),
  actionCode: z.enum(['resume-explicitly', 'check-account', 'review-context', 'review-budget', 'repair-protocol', 'raise-read-limit',
    'repair-storage', 'inspect-integrity', 'inspect-failure']), providerRetryAfterMs: z.number().positive().max(86400000).optional(),
})
/** Whitelisted failure metadata; retry advice never grants automatic execution. */
export type SimulationDriverFailure = z.infer<typeof simulationDriverFailureSchema>
const identity = { ownerId: z.uuid(), batchId: z.uuid(), observedAt: z.number().int().nonnegative() }
/** One batch start or exact matching settlement; replay rejects foreign or stale terminal callbacks. */
export const simulationDriverObservationSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...identity, status: z.literal('advancing') }),
  z.strictObject({ ...identity, status: z.literal('settled') }),
  z.strictObject({ ...identity, status: z.literal('failed'), failure: simulationDriverFailureSchema }),
]).refine(value => value.status !== 'failed' || value.failure.ownerId === value.ownerId && value.failure.batchId === value.batchId,
  'Failure belongs to another owner batch')
/** Historical observation is separate from live owner availability and Native phase. */
export type SimulationDriverObservation = z.infer<typeof simulationDriverObservationSchema>
