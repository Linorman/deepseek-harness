/** Interval accounting derived from durable admissions and accepted intents. @module @clocky/clocky-simulation-local/budget */
import { z } from 'zod'
import { simulationTokenCount, simulationBudgetGrantRequestSchema, simulationBudgetKindSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationBudgetKind, SimulationBudgetUsage, SimulationBudgetGrantRequest, SimTime } from '@clocky/clocky-simulation'

const grantRequest: z.ZodType<SimulationBudgetGrantRequest> = simulationBudgetGrantRequestSchema

/** Durable administrative additions and rejected budget demands. */
export const budgetRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('budget/extended'), request: grantRequest }),
  z.strictObject({ kind: z.literal('budget/exhausted'), budget: simulationBudgetKindSchema, requested: z.number().int().positive() }),
])
/** Parsed interval budget mutation. */
export type BudgetRecord = z.infer<typeof budgetRecordSchema>
/** Failed demand captured by the run queue before returning the failure to its caller. */
export class SimulationBudgetExceeded extends Error {
  constructor(readonly budget: SimulationBudgetKind, readonly requested: number) {
    super(`Simulation ${budget} interval budget exhausted; extend the budget and explicitly resume`)
  }
}
/**
 * Resolve the canonical start of a simulation-time budget interval.
 * @param state - Immutable interval width.
 * @param time - Simulation time to classify.
 * @returns interval start without floating-point conversion.
 */
export function budgetInterval(state: SimulationSnapshot, time: SimTime): SimTime {
  const width = BigInt(state.spec.budgetInterval)
  return simTimeSchema.parse(String(BigInt(time) / width * width))
}
/**
 * Derive usage from durable work; retries, cancellation and writer replacement cannot refund it.
 * @param state - Retained decisions, message intents and explicit grants.
 * @param interval - Canonical interval start to inspect.
 * @returns independent decision, message and token usage with additive granted limits.
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
  const tokens = Object.values(state.tokenReservations ?? {}).filter(value => value.interval === interval)
    .reduce((sum, value) => sum + (value.status === 'not-dispatched' ? 0 : value.usage === undefined
      ? Math.max(value.reserved, value.observedUsage === undefined ? 0 : simulationTokenCount(value.observedUsage))
      : simulationTokenCount(value.usage)), 0)
  return { interval, tokens: { used: tokens, limit: limit('tokens', state.spec.maxTokensPerInterval) }, decisions: { used: decisions.length, limit: limit('decisions', state.spec.maxDecisionsPerInterval) },
    messages: { used: Object.values(state.operations).filter(operation => operation.action.kind === 'communication/post'
      && ids.has(operation.decisionId)).length, limit: limit('messages', state.spec.maxMessagesPerInterval) } }
}
/**
 * Reject work before admission when it cannot fit in the current interval.
 * @param state - Current durable usage and grants.
 * @param kind - Independent budget charged by the action.
 * @param requested - Complete action demand; zero is allowed for message-free proposals.
 */
export function assertBudget(state: SimulationSnapshot, kind: SimulationBudgetKind, requested: number): void {
  const usage = budgetUsage(state)[kind]
  if (requested > usage.limit - usage.used) throw new SimulationBudgetExceeded(kind, requested)
}
/**
 * Validate and apply a durable budget mutation.
 * @param state - Authoritative projection before mutation.
 * @param record - Parsed budget addition or exhausted demand.
 * @returns updated grants or an explicit recoverable stall with unchanged consumption.
 */
export function foldBudget(state: SimulationSnapshot, record: BudgetRecord): SimulationSnapshot {
  switch (record.kind) {
    case 'budget/extended': {
      const request = record.request
      if (Object.hasOwn(state.budgetGrants ?? {}, request.id) || request.interval !== budgetInterval(state, request.interval)
        || BigInt(request.interval) > BigInt(state.spec.maxTime)) throw new Error('Simulation budget addition identity or interval is invalid')
      const next = { ...state, budgetGrants: { ...state.budgetGrants, [request.id]: request } }
      budgetUsage(next, request.interval)
      return next
    }
    case 'budget/exhausted': {
      const usage = budgetUsage(state)
      const available = usage[record.budget]
      if (record.requested <= available.limit - available.used) throw new Error('Simulation budget demand is not exhausted')
      return { ...state, phase: 'stalled', stall: { code: 'SIM_BUDGET_LIMIT', budget: record.budget,
        interval: usage.interval, ...available, requested: record.requested, recovery: 'extend-budget-and-resume' } }
    }
    /* v8 ignore next -- the persisted discriminant is validated before this closed-union fold. */
    default: return assertNever(record)
  }
}
/* v8 ignore next -- only the statically unreachable closed-union arm calls this helper. */
function assertNever(value: never): never { throw new Error(`Unknown budget record: ${String(value)}`) }
/**
 * Check every retained interval against independently persisted policy and additions.
 * @param state - Complete durable projection after a commit or replay.
 */
export function assertBudgetProjection(state: SimulationSnapshot): void {
  const intervals = new Set(Object.values(state.decisions).map(decision => budgetInterval(state, decision.time)))
  for (const interval of intervals) {
    const usage = budgetUsage(state, interval)
    if (usage.decisions.used > usage.decisions.limit || usage.messages.used > usage.messages.limit) {
      throw new Error('Simulation retained work exceeds its granted interval budget')
    }
  }
}
