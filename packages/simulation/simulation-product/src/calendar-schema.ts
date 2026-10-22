/** Strict authenticated calendar quotes and exact-retry commands; principal identity remains Host-owned. */
import { z } from 'zod'
import { simulationCalendarRevisionRequestSchema } from '@clocky/clocky-simulation/world-authoring'
import { simulationProductRunIdSchema } from './schema-common.ts'
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** One complete calendar command, also used unchanged during preview and retry. */
export const simulationProductCalendarInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  request: simulationCalendarRevisionRequestSchema })
/** Actual affected pending events; existing accepted wake identities remain unchanged. */
export const simulationProductCalendarPreviewSchema = z.strictObject({ input: simulationProductCalendarInputSchema,
  revision, previewHash: z.string().regex(/^sha256:[a-f0-9]{64}$/), cancelled: z.array(z.string()),
  queued: z.array(z.strictObject({ id: z.string(), time: z.string().regex(/^(0|[1-9][0-9]*)$/) })) })
/** Submit retains the entire exact quote; transport loss retries never substitute a new command identity. */
export const simulationProductCalendarSubmitSchema = z.strictObject({ input: simulationProductCalendarInputSchema,
  revision, previewHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) })
/** Native acceptance is complete when this receipt is returned; read-only inspection never fabricates completion. */
export const simulationProductCalendarReceiptSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  commandId: z.string().min(1), revision, ruleRevision: revision.positive(), sequence: revision.positive() })

/** Query one original user command, or recover the author's latest unresolved intent without acquiring execution. */
export const simulationProductCalendarCommandInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  commandId: z.string().min(1).max(256).optional() })
/** Original retained quote and independently observed outcome; no caller may substitute another request. */
export const simulationProductCalendarCommandViewSchema = z.strictObject({ preview: simulationProductCalendarPreviewSchema,
  status: z.enum(['retained', 'applied', 'cancelled']), retainedSequence: revision.positive(),
  receipt: simulationProductCalendarReceiptSchema.nullable() }).refine(value =>
  (value.status === 'applied') === (value.receipt !== null)
  && (value.receipt === null || value.receipt.runId === value.preview.input.runId
    && value.receipt.commandId === value.preview.input.request.commandId
    && value.receipt.ruleRevision === value.preview.input.request.expectedRuleRevision + 1),
'Calendar outcome must retain its original quote and matching application receipt')
/** Missing and unauthorized original commands both return null. */
export const simulationProductCalendarCommandResultSchema = z.strictObject({
  command: simulationProductCalendarCommandViewSchema.nullable() })
/** Explicitly withdraw only an original retained command that has not executed. */
export const simulationProductCalendarCancelSchema = simulationProductCalendarCommandInputSchema.required({ commandId: true })
