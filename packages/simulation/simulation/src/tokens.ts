/** Model-attempt reservations and authoritative usage reconciliation. @module @clocky/clocky-simulation/tokens */
import { z } from 'zod'
import type { Branded } from '@clocky/clocky-brand'
import type { SimulationDecisionId } from './business-types.ts'
import type { SimulationEntityId } from './entity-types.ts'
import type { SimulationWriterEpoch } from './writer-types.ts'
import type { SimTime } from './types.ts'
import type { SessionId } from '@clocky/clocky-session/types'
export { simulationRequestBudgetBlockSchema } from './model-admission.ts'
export type { SimulationRequestBudgetBlock } from './model-admission.ts'

/** Stable run-local identity of one model attempt. */
export const simulationTokenReservationIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationTokenReservationId'>)
/** Explicit acknowledgement quote; it never changes a retained per-request allowance or starts scheduling. */
export const simulationTokenRecoverySchema = z.strictObject({
  reservationId: simulationTokenReservationIdSchema,
  reserved: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  used: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  interval: z.string().regex(/^(0|[1-9][0-9]*)$/),
  additionalTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).refine(value => value.used > value.reserved, 'Recovery requires an actual reservation overrun')
/** Original user-reviewed token recovery values. */
export type SimulationTokenRecovery = z.infer<typeof simulationTokenRecoverySchema>
/** Provider-reported uncached input, cache and output counts; reasoning is already included in output. */
export const simulationTokenUsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(), cacheWriteTokens: z.number().int().nonnegative().optional() })
/** Stream outcome distinguishes proven non-dispatch from unknown provider consumption. */
export const simulationTokenOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('not-dispatched') }),
  z.strictObject({ kind: z.literal('unknown'), observedUsage: simulationTokenUsageSchema.optional() }),
  z.strictObject({ kind: z.literal('complete'), usage: simulationTokenUsageSchema }),
])
/** Stream outcome retained after downstream cleanup. */
export type SimulationTokenOutcome = z.infer<typeof simulationTokenOutcomeSchema>
/** Exact durable Session prefix and resolved provider/model used by one attempt. */
export const simulationTokenRequestSchema = z.strictObject({
  sessionSequence: z.number().int().nonnegative(),
  provider: z.string().min(1), model: z.string().min(1) })
/** Model attempt identity. */
export type SimulationTokenReservationId = z.infer<typeof simulationTokenReservationIdSchema>
/** Provider-reported uncached input, cache and output usage. */
export type SimulationTokenUsage = z.infer<typeof simulationTokenUsageSchema>
/** Exact Session request-prefix reference. */
export type SimulationTokenRequest = z.infer<typeof simulationTokenRequestSchema>
/** Unknown attempts retain at least their reservation; known usage remains charged in the original interval. */
export interface SimulationTokenReservation {
  readonly id: SimulationTokenReservationId
  readonly decisionId?: SimulationDecisionId
  readonly compactionId?: Branded<'CompactionId'>
  readonly entityId: SimulationEntityId
  readonly epoch: SimulationWriterEpoch
  readonly sessionId: SessionId
  readonly request: SimulationTokenRequest
  readonly interval: SimTime
  readonly reserved: number
  readonly status: 'reserved' | 'unknown' | 'settled' | 'not-dispatched'
  readonly observedUsage?: SimulationTokenUsage
  readonly usage?: SimulationTokenUsage
  readonly overrunAcknowledged?: boolean
}

/**
 * Sum the harness's disjoint uncached-input, cache and output buckets.
 * @param usage - Complete provider usage; missing cache buckets denote zero cached tokens.
 * @returns exact total charged tokens; reasoning is already part of output.
 * @throws when a bucket or total exceeds safe integer capacity; rounded charges are never returned.
 */
export function simulationTokenCount(usage: SimulationTokenUsage): number {
  const buckets = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0]
  if (buckets.some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('Simulation token bucket exceeds safe integer capacity')
  const total = buckets.reduce((sum, value) => sum + BigInt(value), 0n)
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Simulation token usage exceeds safe integer capacity')
  return Number(total)
}

/** Exact request-log position and compaction transaction, supplied by the canonical compaction owner. */
export const simulationCompactionTokenRequestSchema = simulationTokenRequestSchema.extend({
  compactionId: z.string().min(1).transform(value => value as Branded<'CompactionId'>),
})
/** Token reservation for one owned auxiliary compaction request. */
export type SimulationCompactionTokenRequest = z.infer<typeof simulationCompactionTokenRequestSchema>
