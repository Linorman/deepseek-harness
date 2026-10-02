/** Interval accounting derived from durable admissions and accepted intents. @module @clocky/clocky-simulation-local/budget */
import { z } from 'zod'
import { budgetInterval, budgetUsage, simulationBudgetGrantRequestSchema, simulationBudgetKindSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationBudgetKind, SimulationBudgetGrantRequest } from '@clocky/clocky-simulation'

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
export { budgetInterval, budgetUsage } from '@clocky/clocky-simulation'
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
