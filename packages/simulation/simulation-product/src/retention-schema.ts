/** Authenticated full-history retention; preview/receipt metadata never substitutes for private record-read authority. */
import { z } from 'zod'
import { simulationProductRunIdSchema, simulationProductCommandIdSchema } from './schema-common.ts'
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
/** Source must already be paused and quiescent; pure preview does not retire writers or call models. */
export const simulationProductRetentionPreviewInputSchema = z.strictObject({ runId: simulationProductRunIdSchema })
/** Exact conservative full closure selected by the current owner, without exposing source bodies or filesystem paths. */
export const simulationProductRetentionPlanSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  version: z.literal(1), planHash: hash, snapshotRevision: count, bytes: count,
  nativeEntries: count, ownerStreams: count, materializedSessions: count, unmaterializedSessions: count, attachments: count,
  destructive: z.literal(false), reclaimableBytes: z.literal(0), pinPolicy: z.literal('complete-owner-history'),
})
/** An explicit original user command cannot silently substitute a newer source cut. */
export const simulationProductRetentionExecuteInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  commandId: simulationProductCommandIdSchema, expectedRevision: count, planHash: hash })
/** Original command lookup, including responsibility retained after interrupted publication. */
export const simulationProductRetentionReadInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  commandId: simulationProductCommandIdSchema })
/** Bounded durable outcome; failure codes remain public while underlying owner diagnostics stay Host-owned. */
export const simulationProductRetentionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...simulationProductRetentionReadInputSchema.shape, status: z.literal('not-found') }),
  z.strictObject({ ...simulationProductRetentionReadInputSchema.shape, status: z.literal('accepted'), plan: simulationProductRetentionPlanSchema }),
  z.strictObject({ ...simulationProductRetentionReadInputSchema.shape, status: z.literal('completed'), plan: simulationProductRetentionPlanSchema, archiveHash: hash }),
  z.strictObject({ ...simulationProductRetentionReadInputSchema.shape, status: z.literal('failed'), plan: simulationProductRetentionPlanSchema,
    code: z.enum(['source-moved', 'source-unavailable', 'archive-unavailable', 'integrity', 'cancelled']) }),
]).refine(value => value.status === 'not-found' || value.plan.runId === value.runId,
  'Retention result plan belongs to another run')
/** Whole-record grants are independently required before resolving any original archived owner identity. */
export const simulationProductRetentionRecordsInputSchema = z.strictObject({ ...simulationProductRetentionReadInputSchema.shape,
  owner: z.enum(['native', 'team', 'channel', 'session']), ownerId: z.string().min(1).max(256),
  afterSequence: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER), limit: z.number().int().min(1).max(128) })
/** Owner records preserve original sequence and exact body; the complete response obeys Product byte bounds. */
export const simulationProductRetentionRecordsResultSchema = z.strictObject({ ...simulationProductRetentionReadInputSchema.shape,
  archiveHash: hash, owner: z.enum(['native', 'team', 'channel', 'session']), ownerId: z.string().min(1).max(256),
  entries: z.array(z.strictObject({ sequence: count, value: z.json() })).max(128), hasMore: z.boolean() })

/** Read the original completed private bundle; requires independent whole-record disclosure. */
export const simulationProductBackupExportInputSchema = simulationProductRetentionReadInputSchema
/** Exact portable bytes; response bounds include JSON string escaping and metadata. */
export const simulationProductBackupExportResultSchema = z.strictObject({ ...simulationProductRetentionReadInputSchema.shape,
  archiveHash: hash, bundleHash: hash, kind: z.literal('full-private-backup'), bundle: z.string().min(1) })
