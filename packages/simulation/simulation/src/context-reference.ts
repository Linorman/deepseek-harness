/** Strict source references without aggregate World or context schema dependencies. */
import { z } from 'zod'
import type { Branded } from '@clocky/clocky-brand'
import type { SimulationContextReference } from '@clocky/clocky-session/types'
import { teamIdSchema, channelIdSchema, envelopeIdSchema } from '@clocky/clocky-team/schema'

/** Original scoped source identity; parsing does not establish visibility or authorize a read. */
export const simulationContextReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('run-event'),
    runId: z.string().min(1).transform(value => value as Branded<'SimulationRunId'>), sequence: z.number().int().positive() }),
  z.strictObject({ kind: z.literal('team-envelope'), teamId: teamIdSchema, channelId: channelIdSchema, envelopeId: envelopeIdSchema }),
]) satisfies z.ZodType<SimulationContextReference>
