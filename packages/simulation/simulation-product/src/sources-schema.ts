/** Strict source selectors carry no principal, channel selector or body-disclosure switch. */
import { z } from 'zod'
import type { SimulationDecisionId } from '@clocky/clocky-simulation/identities'
import type { TeamId, ChannelId, EnvelopeId } from '@clocky/clocky-team/types'
import { simulationProductRunIdSchema, simulationProductCursorSchema, simulationProductTextSchema } from './schema-common.ts'
import { simulationProductReadVersionSchema } from './watch-schema.ts'
import type { SimulationProductSourceInput, SimulationProductSourceInspection } from './sources-types.ts'
const integer = z.number().int().nonnegative()
const decisionId = z.string().min(1).transform(value => value as SimulationDecisionId)
/** Lookup pages and exact body pages share the original frozen source identity. */
export const simulationProductSourceInputSchema = z.strictObject({ runId: simulationProductRunIdSchema, decisionId,
  sourceIndex: integer, envelopeSequence: integer.optional(), expectedRevision: integer.optional(),
  cursor: simulationProductCursorSchema.optional(), limit: z.number().int().positive().optional(),
}) satisfies z.ZodType<SimulationProductSourceInput>
/** Every public source result is redacted unless current Simulation and Team authority both permit it. */
export const simulationProductSourceInspectionSchema = z.strictObject({ runId: simulationProductRunIdSchema, decisionId,
  sourceIndex: integer, snapshotRevision: integer, readVersion: simulationProductReadVersionSchema, observedAt: integer,
  source: z.strictObject({ kind: z.literal('team-envelope'), teamId: z.string().min(1).transform(value => value as TeamId),
    channelId: z.string().min(1).transform(value => value as ChannelId),
    envelopeId: z.string().min(1).transform(value => value as EnvelopeId) }).optional(),
  status: z.enum(['missing', 'withheld', 'unavailable', 'searching', 'found']),
  envelope: z.strictObject({ sequence: integer, kind: simulationProductTextSchema, createdAt: integer }).optional(),
  items: z.array(z.strictObject({ block: integer, body: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('withheld') }), z.strictObject({ status: z.literal('unsupported') }),
    z.strictObject({ status: z.literal('text'), text: z.string(), part: integer, parts: z.number().int().positive() })
      .refine(value => value.part < value.parts, 'Source text part exceeds its count'),
  ]) })), nextCursor: simulationProductCursorSchema.optional(),
}).refine(value => value.status === 'found' ? value.source !== undefined && value.envelope !== undefined
  : value.envelope === undefined && value.items.length === 0, 'Only found sources carry content')
  .refine(value => value.status === 'searching' ? value.nextCursor !== undefined && value.source !== undefined
    : value.status === 'found' || value.nextCursor === undefined, 'Only found or searching sources continue') satisfies z.ZodType<SimulationProductSourceInspection>
