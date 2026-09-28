/** Ordered external text inputs without implicit world authority. @module @clocky/clocky-simulation/ingress */
import { z } from 'zod'
import type { Branded } from '@clocky/clocky-brand'
import { simulationEntityIdSchema } from './entity.ts'
import { simTimeSchema } from './time.ts'

/** Caller-retained idempotency identity within one run. */
export const simulationIngressIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationIngressId'>)
/** External input; source is attribution text, not an authority grant. */
export const simulationIngressRequestSchema = z.strictObject({
  id: simulationIngressIdSchema, entityId: simulationEntityIdSchema,
  source: z.string().trim().min(1), text: z.string().min(1), availableAt: simTimeSchema,
})
/** Stable run-local input identity. */
export type SimulationIngressId = z.infer<typeof simulationIngressIdSchema>
/** Explicit external input request. */
export type SimulationIngressRequest = z.infer<typeof simulationIngressRequestSchema>
