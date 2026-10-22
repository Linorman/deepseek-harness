/** Browser-safe product read parsing contains no runtime service or private run-spec imports. */
import { z } from 'zod'
import type { SimTime } from '@clocky/clocky-simulation/time-types'
import type { SimulationProductListInput,
  SimulationProductInspectInput, SimulationProductRunPage, SimulationProductRunInspection,
  SimulationProductRunStatusesInput, SimulationProductRunStatus, SimulationProductRunStatusesPage } from './types.ts'

import { simulationProductRunIdSchema, simulationProductCursorSchema, simulationProductTextSchema } from './schema-common.ts'
import { simulationProductOperationalStatusSchema, simulationProductModelPoolObservationSchema, simulationProductReadFailureSchema, simulationProductReadLimitSchema } from './control-schema.ts'
import { simulationProductPeopleCountsSchema } from './people-schema.ts'
export * from './people-schema.ts'
export * from './schema-common.ts'
export * from './collections-schema.ts'
export * from './administration-schema.ts'
export * from './control-schema.ts'
export * from './maintenance-schema.ts'
export * from './watch-schema.ts'
/** Parse actor-free bounded directory parameters. */
export const simulationProductListInputSchema = z.object({ cursor: simulationProductCursorSchema.optional(),
  limit: z.number().int().positive().optional(), search: z.string().optional() }).strict() satisfies z.ZodType<SimulationProductListInput>
/** Parse an exact actor-free directory target. */
export const simulationProductInspectInputSchema = z.object({ runId: simulationProductRunIdSchema }).strict() satisfies
  z.ZodType<SimulationProductInspectInput>
/** Directory summaries contain neither principal association nor provider/spec/knowledge. */
export const simulationProductRunSummarySchema = z.object({ id: simulationProductRunIdSchema, name: simulationProductTextSchema,
  registeredAt: z.number().int().nonnegative(), observation: z.literal('not-observed') }).strict()
/** Parse the complete public window. */
export const simulationProductRunPageSchema = z.object({ items: z.array(simulationProductRunSummarySchema),
  nextCursor: simulationProductCursorSchema.optional() }).strict() satisfies z.ZodType<SimulationProductRunPage>
/** Canonical decimal simulation time must not pass through JavaScript Number. */
const timeSchema: z.ZodType<SimTime> = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(value => value as SimTime)
const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const usageSchema = z.object({ used: countSchema, limit: countSchema }).strict()
const attributionUsageSchema = z.object({ inputTokens: countSchema, outputTokens: countSchema,
  cacheReadTokens: countSchema, cacheWriteTokens: countSchema }).strict()
const attributionBucketSchema = z.object({ attempts: countSchema,
  statuses: z.object({ reserved: countSchema, unknown: countSchema, settled: countSchema, 'not-dispatched': countSchema }).strict(),
  outstandingReservedTokens: countSchema, settled: attributionUsageSchema, unknownReported: attributionUsageSchema }).strict()
const tokenAttributionSchema = z.object({ total: attributionBucketSchema, categories: z.object({
  'business-choice': attributionBucketSchema, adjudication: attributionBucketSchema, 'result-closeout': attributionBucketSchema,
  communication: attributionBucketSchema, compaction: attributionBucketSchema, unknown: attributionBucketSchema }).strict() }).strict()
  .superRefine((value, ctx) => {
    const flatten = (bucket: z.infer<typeof attributionBucketSchema>): number[] => [bucket.attempts,
      ...Object.values(bucket.statuses), bucket.outstandingReservedTokens,
      ...Object.values(bucket.settled), ...Object.values(bucket.unknownReported)]
    const buckets = Object.values(value.categories)
    const totals = flatten(value.total)
    const reconciled = totals.every((amount, index) =>
      buckets.reduce((sum, bucket) => sum + BigInt(flatten(bucket)[index] ?? 0), 0n) === BigInt(amount))
    const statusesMatch = [value.total, ...buckets].every(bucket =>
      Object.values(bucket.statuses).reduce((sum, count) => sum + BigInt(count), 0n) === BigInt(bucket.attempts))
    if (!reconciled || !statusesMatch) ctx.addIssue({ code: 'custom', message: 'Token attribution categories and statuses must reconcile' })
  })
/** Exact native consumption and unresolved work; reserved or unknown usage is never inferred from history totals. */
export const simulationProductRuntimeMetricsSchema = z.object({ tokenAttribution: tokenAttributionSchema,
  budgets: z.object({ interval: timeSchema,
    width: timeSchema.refine(value => value !== '0', 'Budget interval width must be positive'),
    tokens: z.object({ charged: countSchema, limit: countSchema, unknownAttempts: countSchema }).strict(),
    decisions: usageSchema, messages: usageSchema }).strict(),
  residentSlots: usageSchema.extend({ recoveryRequired: countSchema }).strict().refine(value => value.recoveryRequired <= value.used),
  pendingDecisionCount: countSchema, pendingExternalOperationCount: countSchema, unknownOperationCount: countSchema }).strict()
/** Parse a public observation without private world bodies. */
export const simulationProductRunInspectionSchema = z.object({ run: simulationProductRunSummarySchema,
  status: z.enum(['observed', 'missing']), operational: simulationProductOperationalStatusSchema.optional(),
  world: z.object({ worldInitialized: z.boolean().optional(), revision: z.number().int().nonnegative(),
    phase: z.enum(['paused', 'running', 'stalled']), time: timeSchema, tickUnit: simulationProductTextSchema,
    rulesVersion: simulationProductTextSchema.optional(), policyVersion: simulationProductTextSchema.optional(),
    metrics: simulationProductRuntimeMetricsSchema.optional(),
    people: simulationProductPeopleCountsSchema.optional(),
    schedulerStop: z.object({ code: z.string().min(1), recovery: z.string().min(1) }).strict().optional(),
    owner: z.enum(['this-provider', 'unowned', 'other-owner', 'unavailable']), entityCount: z.number().int().nonnegative(),
    decisionCount: z.number().int().nonnegative(), operationCount: z.number().int().nonnegative(),
    observedAt: z.number().int().nonnegative(),
  }).strict().optional() }).strict().refine(value => (value.status === 'observed') === (value.world !== undefined), {
  message: 'World observation must be present exactly when provider history is observed',
}).refine(value => value.world?.people === undefined || value.world.people.snapshotRevision === value.world.revision
  && value.world.people.time === value.world.time, 'Personnel metadata must belong to the observed Native revision and time') satisfies
  z.ZodType<SimulationProductRunInspection>
/** Parse an exact finite run-status request without principal, provider, spec or physical path parameters. */
export const simulationProductRunStatusesInputSchema = z.object({ runIds: z.array(simulationProductRunIdSchema)
  .refine(ids => new Set(ids).size === ids.length, 'Run status identities must be distinct') }).strict() satisfies
  z.ZodType<SimulationProductRunStatusesInput>
/** Parse isolated safe unavailability independently of observed or missing history. */
export const simulationProductRunStatusSchema = z.union([simulationProductRunInspectionSchema,
  z.object({ run: simulationProductRunSummarySchema, status: z.literal('unavailable'),
    errorSummary: simulationProductTextSchema, reason: simulationProductReadFailureSchema.optional(),
    readLimit: simulationProductReadLimitSchema.optional(),
    operational: simulationProductOperationalStatusSchema.optional() }).strict()]) satisfies
  z.ZodType<SimulationProductRunStatus>
/** Parse the complete finite response, preserving request ordering. */
export const simulationProductRunStatusesPageSchema = z.object({ items: z.array(simulationProductRunStatusSchema),
  modelPool: simulationProductModelPoolObservationSchema.optional() }).strict() satisfies
  z.ZodType<SimulationProductRunStatusesPage>
export * from './records-schema.ts'
export * from './sources-schema.ts'
export * from './review-schema.ts'
export * from './task-control-schema.ts'
export * from './operation-retry-schema.ts'
export * from './case-schema.ts'
export * from './case-cancel-schema.ts'
export { simulationProductWorldCreateInputSchema, simulationProductWorldPreflightInputSchema,
  simulationProductWorldPreflightResultSchema, simulationProductWorldExportResultSchema } from './world-schema.ts'

export * from './world-read-schema.ts'
export * from './world-management-schema.ts'

export { scenarioDraftSaveSchema, scenarioDraftReadSchema, scenarioDraftRevisionSchema, scenarioDraftSaveResultSchema, scenarioDraftReadResultSchema } from './draft-schema.ts'
export * from './calendar-schema.ts'

export * from './index-maintenance-schema.ts'

export * from './generation-schema.ts'
export * from './retention-schema.ts'

export * from './experiment-schema.ts'
export * from './run-control-schema.ts'
export * from './raw-archive-schema.ts'
