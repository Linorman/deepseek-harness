/** Raw preservation is never parsed as or labelled a validated Native snapshot/checkpoint. */
import { z } from 'zod'
import { simulationProductRunIdSchema, simulationProductCursorSchema } from './schema-common.ts'
import { simulationProductReadVersionSchema } from './watch-schema.ts'
import type { SimulationProductRawArchiveInput, SimulationProductRawArchivePage } from './raw-archive-types.ts'
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** Exact registered source and bounded text-window selection; no source override is accepted. */
export const simulationProductRawArchiveInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  limit: z.number().int().positive().optional(), cursor: simulationProductCursorSchema.optional(),
}) satisfies z.ZodType<SimulationProductRawArchiveInput>
/** Original source identity and explicit non-validation accompany every body part. */
export const simulationProductRawArchivePageSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  readVersion: simulationProductReadVersionSchema, observedAt: integer,
  source: z.strictObject({ journalVersion: integer, firstSequence: integer, tailSequence: z.number().int().min(-1), entryCount: integer,
    representation: z.enum(['json-document-bytes', 'sqlite-logical-frames']), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    nativeValidation: z.literal('not-performed'), physicalDatabaseCopy: z.literal(false) }),
  totalParts: integer, items: z.array(z.strictObject({ part: integer, text: z.string() })),
  nextCursor: simulationProductCursorSchema.optional(),
}).refine(value => value.items.every((item, index) => item.part < value.totalParts
  && (index === 0 || item.part === (value.items[index - 1]?.part ?? -2) + 1)), 'Raw archive body parts must be ordered within their declared coverage') satisfies
  z.ZodType<SimulationProductRawArchivePage>
