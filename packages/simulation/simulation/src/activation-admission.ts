/** Canonical Team history refusal retained by the run owner before another startup can be attempted. */
import { z } from 'zod'
import { teamActivationHistoryLimitDetailsSchema } from '@clocky/clocky-team'
import { simulationEntityIdSchema } from './entity.ts'
import type { SimulationWriterEpoch } from './writer-types.ts'

/** Trusted Team/controller refusal; pending cleanup does not establish a Native settlement. */
export const simulationActivationAdmissionRequestSchema = z.strictObject({
  entityId: simulationEntityIdSchema,
  details: teamActivationHistoryLimitDetailsSchema,
}).refine(value => value.details.cleanup !== 'pending', 'Controller must report confirmed or unconfirmed cleanup')
/** Fully parsed original startup refusal. */
export type SimulationActivationAdmissionRequest = z.infer<typeof simulationActivationAdmissionRequestSchema>
/** Exact retained writer epoch and immutable original history-limit rejection. */
export interface SimulationActivationAdmissionBlock extends SimulationActivationAdmissionRequest {
  readonly epoch: SimulationWriterEpoch
}
