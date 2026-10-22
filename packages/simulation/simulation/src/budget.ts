/** Durable simulation-interval budgets and explicit administrative additions. @module @clocky/clocky-simulation/budget */
import { z } from 'zod'
import type { Branded } from '@clocky/clocky-brand'
import { simTimeSchema } from './time.ts'
import { simulationTokenCount } from './tokens.ts'
import type { SimulationSnapshot } from './types.ts'
import type { SimTime } from './time-types.ts'

/** Independent decision, accepted-message and model-token accounting. */
export const simulationBudgetKindSchema = z.enum(['decisions', 'messages', 'tokens'])
/** Run-local retry identity for an administrative budget addition. */
export const simulationBudgetGrantIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationBudgetGrantId'>)
/** Explicit additional capacity for one interval; it never resets consumed work. */
export const simulationBudgetGrantRequestSchema = z.strictObject({
  id: simulationBudgetGrantIdSchema, interval: simTimeSchema, budget: simulationBudgetKindSchema,
  amount: z.number().int().positive(), reason: z.string().trim().min(1),
})
/** Run-local budget addition identity. */
export type SimulationBudgetGrantId = z.infer<typeof simulationBudgetGrantIdSchema>
/** Administrative, idempotent budget addition. */
export type SimulationBudgetGrantRequest = z.infer<typeof simulationBudgetGrantRequestSchema>
/** Independently charged budget kind. */
export type SimulationBudgetKind = z.infer<typeof simulationBudgetKindSchema>
/** Current interval totals, including grants and held model reservations. */
export interface SimulationBudgetUsage {
  readonly interval: z.infer<typeof simTimeSchema>
  readonly decisions: { readonly used: number; readonly limit: number }
  readonly tokens: { readonly used: number; readonly limit: number }
  readonly messages: { readonly used: number; readonly limit: number }
}

/**
 * Resolve the canonical simulation-time budget interval without Number conversion.
 * @param state - Authoritative immutable interval width.
 * @param time - Exact simulation time to classify.
 * @returns decimal interval start.
 */
export function budgetInterval(state: SimulationSnapshot, time: SimTime): SimTime {
  const width = BigInt(state.spec.budgetInterval)
  return simTimeSchema.parse(String(BigInt(time) / width * width))
}

/**
 * Derive authoritative interval admissions, grants and held token charges.
 * @param state - Retained decisions, accepted message intents, token reservations and additions.
 * @param interval - Canonical interval start; defaults to the current simulation interval.
 * @returns exact safe-integer charges and granted limits; cancellation and retries cannot refund admitted work.
 * @throws when a total exceeds safe integer capacity; readers must report unavailable rather than rounded usage.
 */
export function budgetUsage(state: SimulationSnapshot, interval = budgetInterval(state, state.time)): SimulationBudgetUsage {
  const grants = Object.values(state.budgetGrants ?? {}).filter(grant => grant.interval === interval)
  const limit = (kind: SimulationBudgetKind, initial: number): number => {
    const total = grants.filter(grant => grant.budget === kind).reduce((sum, grant) => sum + BigInt(grant.amount), BigInt(initial))
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Simulation granted budget exceeds safe integer capacity')
    return Number(total)
  }
  const decisions = Object.values(state.decisions).filter(decision => budgetInterval(state, decision.time) === interval)
  const ids = new Set(decisions.map(decision => decision.id))
  const total = Object.values(state.tokenReservations ?? {}).filter(value => value.interval === interval)
    .reduce((sum, value) => sum + BigInt(value.status === 'not-dispatched' ? 0 : value.usage === undefined
      ? Math.max(value.reserved, value.observedUsage === undefined ? 0 : simulationTokenCount(value.observedUsage))
      : simulationTokenCount(value.usage)), 0n)
    + Object.values(state.generationJobs ?? {}).filter(value => value.interval === interval)
      .reduce((sum, value) => sum + BigInt(value.status === 'cancelled' && value.sessionSequence === undefined ? 0 : value.usage === undefined
        ? Math.max(value.job.budget.maxTokens, value.observedUsage === undefined ? 0 : simulationTokenCount(value.observedUsage))
        : simulationTokenCount(value.usage)), 0n)
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Simulation charged tokens exceed safe integer capacity')
  return { interval, tokens: { used: Number(total), limit: limit('tokens', state.spec.maxTokensPerInterval) },
    decisions: { used: decisions.length, limit: limit('decisions', state.spec.maxDecisionsPerInterval) },
    messages: { used: Object.values(state.operations).filter(operation => operation.action.kind === 'communication/post'
      && ids.has(operation.decisionId)).length, limit: limit('messages', state.spec.maxMessagesPerInterval) } }
}
