/** Host-owned conservative cross-run time evidence; models cannot serialize the live authority callback. */
import { z } from 'zod'
import { simTimeSchema } from './time.ts'
import { simulationRunIdSchema } from './schema.ts'
/** One retained bridge cut; limit is exclusive and zero freezes initial time.
 * A permanent stop blocks all subsequent Native clock and scheduled event consumption. */
export const simulationFederationTimeSchema = z.strictObject({ ownerId: z.string().min(1).max(128),
  runId: simulationRunIdSchema, generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sourceSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  limit: simTimeSchema, blockedPeers: z.array(z.string().min(1).max(128)).max(1000), sourceHash: z.string().regex(/^[a-f0-9]{64}$/) })
/** Exact original Host bridge evidence retained in the Native journal. */
export type SimulationFederationTime = z.infer<typeof simulationFederationTimeSchema>
/** Nonserializable authority installed by a trusted Host bridge, never through a model action. */
export interface SimulationFederationTimeBinding {
  /** Re-resolve current Host evidence inside the Native commit queue and retain it before returning. */
  sync(): Promise<import('./types.ts').SimulationSnapshot>
  /** Remove live update authority; the last durable fence remains enforced. */
  dispose(): void
}
