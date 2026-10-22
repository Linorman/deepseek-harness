/** Immutable experiment provenance; this declaration grants no parent-run authority. */
import { z } from 'zod'
import { simTimeSchema } from './time.ts'
import { simulationRunIdSchema, simulationRunSpecSchema } from './schema.ts'

/** Retained before any branch-owned identity or business fact is initialized. */
export const simulationExperimentInitSchema = z.strictObject({
  version: z.literal(2), parentRunId: simulationRunIdSchema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), sourceRevision: z.number().int().nonnegative(),
  namespace: z.uuid(), memoryPolicy: z.enum(['public-facts', 'authorized-memory']),
  variables: z.record(z.string().min(1), z.json()),
  budget: z.strictObject({ maxTokens: z.number().int().nonnegative(), maxTime: z.string().regex(/^(0|[1-9][0-9]*)$/) }),
  realEffects: z.literal(false), cutTime: simTimeSchema, seedPolicy: z.enum(['initial-world-cut', 'settled-world-cut']),
})
/** Immutable provenance, never a capability to reuse any source proof. */
export type SimulationExperimentInit = z.infer<typeof simulationExperimentInitSchema>

/** Strict complete original Native prefix for model-free semantic validation by its installed provider. */
export const simulationArchivePrefixSchema = z.strictObject({ version: z.number().int().positive(),
  spec: simulationRunSpecSchema, entries: z.array(z.strictObject({ sequence: z.number().int().nonnegative(), value: z.json() })).min(1) })
/** Bounded parser input; installed provider owns format versions and fold semantics. */
export type SimulationArchivePrefix = z.infer<typeof simulationArchivePrefixSchema>
