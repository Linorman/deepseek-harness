/** Browser-safe product read parsing contains no runtime service or private run-spec imports. */
import { z } from 'zod'
import type { SimulationProductListInput,
  SimulationProductInspectInput, SimulationProductRunPage, SimulationProductRunInspection,
  SimulationProductRunStatusesInput, SimulationProductRunStatus, SimulationProductRunStatusesPage } from './types.ts'

import { simulationProductRunIdSchema, simulationProductCursorSchema, simulationProductTextSchema } from './schema-common.ts'
import { simulationProductOperationalStatusSchema, simulationProductModelPoolObservationSchema } from './control-schema.ts'
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
const timeSchema = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(value => value as import('@clocky/clocky-simulation/time-types').SimTime)
const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const usageSchema = z.object({ used: countSchema, limit: countSchema }).strict()
/** Exact native consumption and unresolved work; reserved or unknown usage is never inferred from history totals. */
export const simulationProductRuntimeMetricsSchema = z.object({ budgets: z.object({ interval: timeSchema,
  width: timeSchema.refine(value => value !== '0', 'Budget interval width must be positive'),
  tokens: z.object({ charged: countSchema, limit: countSchema, unknownAttempts: countSchema }).strict(),
  decisions: usageSchema, messages: usageSchema }).strict(),
residentSlots: usageSchema.extend({ recoveryRequired: countSchema }).strict().refine(value => value.recoveryRequired <= value.used),
pendingDecisionCount: countSchema, pendingExternalOperationCount: countSchema, unknownOperationCount: countSchema }).strict()
/** Parse a public observation without private world bodies. */
export const simulationProductRunInspectionSchema = z.object({ run: simulationProductRunSummarySchema,
  status: z.enum(['observed', 'missing']), operational: simulationProductOperationalStatusSchema.optional(),
  world: z.object({ revision: z.number().int().nonnegative(),
    phase: z.enum(['paused', 'running', 'stalled']), time: timeSchema, tickUnit: simulationProductTextSchema,
    rulesVersion: simulationProductTextSchema.optional(), policyVersion: simulationProductTextSchema.optional(),
    metrics: simulationProductRuntimeMetricsSchema.optional(),
    schedulerStop: z.object({ code: z.string().min(1), recovery: z.string().min(1) }).strict().optional(),
    owner: z.enum(['this-provider', 'unowned', 'other-owner', 'unavailable']), entityCount: z.number().int().nonnegative(),
    decisionCount: z.number().int().nonnegative(), operationCount: z.number().int().nonnegative(),
    observedAt: z.number().int().nonnegative(),
  }).strict().optional() }).strict().refine(value => (value.status === 'observed') === (value.world !== undefined), {
  message: 'World observation must be present exactly when provider history is observed',
}) satisfies z.ZodType<SimulationProductRunInspection>
/** Parse an exact finite run-status request without principal, provider, spec or physical path parameters. */
export const simulationProductRunStatusesInputSchema = z.object({ runIds: z.array(simulationProductRunIdSchema)
  .refine(ids => new Set(ids).size === ids.length, 'Run status identities must be distinct') }).strict() satisfies
  z.ZodType<SimulationProductRunStatusesInput>
/** Parse isolated safe unavailability independently of observed or missing history. */
export const simulationProductRunStatusSchema = z.union([simulationProductRunInspectionSchema,
  z.object({ run: simulationProductRunSummarySchema, status: z.literal('unavailable'),
    errorSummary: simulationProductTextSchema, operational: simulationProductOperationalStatusSchema.optional() }).strict()]) satisfies
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
