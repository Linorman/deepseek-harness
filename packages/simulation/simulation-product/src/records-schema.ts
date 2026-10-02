/** Strict public journal selectors and text-only output; deployment identities and native values never cross as arbitrary objects. */
import { z } from 'zod'
import { simulationProductRunIdSchema, simulationProductCursorSchema, simulationProductTextSchema } from './schema-common.ts'
import { simulationProductReadVersionSchema } from './watch-schema.ts'
import type { SimulationProductRecordsInput, SimulationProductRecordsPage } from './records-types.ts'
const integer = z.number().int().nonnegative()
/** Actor-free query keeps exact source sequence and revision, with no physical paths or permission hints. */
export const simulationProductRecordsInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  mode: z.enum(['metadata', 'original']), kind: z.string().min(1).max(128).optional(), sequence: integer.optional(),
  expectedRevision: integer.optional(), limit: z.number().int().positive().optional(), cursor: simulationProductCursorSchema.optional(),
}) satisfies z.ZodType<SimulationProductRecordsInput>
/** Complete records response retains policy identity and explicit body redaction. */
export const simulationProductRecordsPageSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  snapshotRevision: integer, readVersion: simulationProductReadVersionSchema, observedAt: integer,
  mode: z.enum(['metadata', 'original']), bodyAccess: z.enum(['allowed', 'withheld']), totalRecords: integer,
  selection: z.strictObject({ kind: z.string().min(1).max(128).optional(), sequence: integer.optional() }),
  items: z.array(z.strictObject({ sequence: integer, kind: simulationProductTextSchema, action: simulationProductTextSchema.optional(),
    body: z.discriminatedUnion('status', [z.strictObject({ status: z.literal('withheld') }),
      z.strictObject({ status: z.literal('text'), text: z.string(), part: integer, parts: z.number().int().positive() })
        .refine(value => value.part < value.parts, 'Record text part exceeds its count')]) })),
  nextCursor: simulationProductCursorSchema.optional(),
}).refine(page => (page.mode === 'original' && page.bodyAccess === 'allowed')
  || page.items.every(item => item.body.status === 'withheld'), 'Record text requires original-content permission') satisfies z.ZodType<SimulationProductRecordsPage>
