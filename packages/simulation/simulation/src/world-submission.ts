/** Bounded Native rejection evidence; the submitted body remains in its canonical Session rather than exceeding Native byte limits. */
import { z } from 'zod'
import { createHash } from 'node:crypto'
import type { SimulationProposal } from './business-types.ts'

/** Permanent quota or lost authority facts produced by Native submission validation. */
export const simulationWorldSubmissionFailureSchema = z.discriminatedUnion('code', [
  z.strictObject({ code: z.literal('SIM_WORLD_LIMIT'), limit: z.enum(['bytes', 'requests', 'plans']) }),
  z.strictObject({ code: z.literal('SIM_WORLD_AUTHORITY') }),
])
/** Rejected body identity and exact fixed reason; no model-selected error prose is stored. */
export const simulationWorldSubmissionBlockSchema = z.strictObject({
  proposalHash: z.string().regex(/^[a-f0-9]{64}$/), failure: simulationWorldSubmissionFailureSchema,
})
/** Durable unaccepted submission retained on its cancelled decision. */
export type SimulationWorldSubmissionBlock = z.infer<typeof simulationWorldSubmissionBlockSchema>

/**
 * Fingerprint the complete schema-parsed staged input, independently of JSON field ordering supplied by the model.
 * @param proposals - Complete proposal list normalized through simulationProposalSchema before this call.
 * @returns exact SHA-256 identity; checkpoint compares it to the original staged tool input.
 */
export function simulationWorldSubmissionHash(proposals: readonly SimulationProposal[]): string {
  return createHash('sha256').update(JSON.stringify(proposals)).digest('hex')
}
