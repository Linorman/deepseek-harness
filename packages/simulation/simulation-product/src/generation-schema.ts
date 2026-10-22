/** Authenticated generation transport; input bytes are explicitly user-authored, never source-authorized by client labels. */
import { z } from 'zod'
import { simulationGenerationJobSchema, simulationGenerationRecordSchema, simulationGenerationJobIdSchema } from '@clocky/clocky-simulation/world-generation'
import { simulationProductRunIdSchema } from './schema-common.ts'
import { worldReadEntityIdSchema } from './world-read-schema.ts'

const key = z.string().min(1).max(256)
/** Read an owned original job without inference or Session materialization. */
export const simulationProductGenerationReadSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  jobId: simulationGenerationJobIdSchema })
/** Explicit user-authored input; the Host stamps actual principal provenance and checks fixed runtime/scope/audience. */
export const simulationProductGenerationRequestSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  job: simulationGenerationJobSchema.refine(job => job.inputs.every(input => input.source === 'user-authored'),
    'Product generation accepts only explicitly user-authored input, not claimed external source references') })
/** User controls cannot forge provider acceptance, output bytes or usage. */
export const simulationProductGenerationTransitionSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  change: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('validate'), id: simulationGenerationJobIdSchema }),
    z.strictObject({ kind: z.literal('cancel'), id: simulationGenerationJobIdSchema, reason: key }),
    z.strictObject({ kind: z.literal('incorporate'), id: simulationGenerationJobIdSchema, reference: key }),
  ]) })
/** Private original result, including retained unknown responsibility; absence does not imply deletion or authorize a new attempt. */
export const simulationProductGenerationResultSchema = z.strictObject({ apiVersion: z.literal('clocky.generation/v1'),
  runId: simulationProductRunIdSchema, job: simulationGenerationRecordSchema.nullable() })
/** Place one validated Persona into the existing finite-template A2 draft workflow. */
export const simulationProductGenerationPersonaDraftSchema = simulationProductGenerationReadSchema.extend({
  positionEntityId: worldReadEntityIdSchema, templateId: key, templateVersion: key, draftId: key,
  validUntil: z.string().regex(/^(0|[1-9][0-9]*)$/),
})
