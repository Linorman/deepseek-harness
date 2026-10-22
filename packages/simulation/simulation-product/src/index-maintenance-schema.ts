/** Public index maintenance exposes source identity, never journal bodies or filesystem paths. */
import { z } from 'zod'
import { simulationProductRunIdSchema } from './schema-common.ts'

/** Exact retained run revision; repeating this request only rebuilds the same derived prefix. */
export const simulationProductRebuildIndexInputSchema = z.strictObject({
  runId: simulationProductRunIdSchema, expectedRevision: z.number().int().nonnegative(),
})
/** Published reference-index metadata; this does not attest to current execution ownership. */
export const simulationProductRebuildIndexResultSchema = z.strictObject({
  runId: simulationProductRunIdSchema, snapshotRevision: z.number().int().nonnegative(),
  schema: z.literal('clocky/simulation-inspection-index'), version: z.literal(1),
  journalVersion: z.number().int().positive(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
})
/** Parsed source-bound rebuild selection. */
export type SimulationProductRebuildIndexInput = z.infer<typeof simulationProductRebuildIndexInputSchema>
/** Original prefix metadata after atomic derived publication. */
export type SimulationProductRebuildIndexResult = z.infer<typeof simulationProductRebuildIndexResultSchema>
