/** Authoritative slot and interval projections shared by admission and product readers. @module @clocky/clocky-simulation/metrics */
import type { SimulationSnapshot } from './types.ts'
import type { SimulationOwnerObservation } from './inspection.ts'
import type { SimulationResidentSlots, SimulationRuntimeMetrics } from './metrics-types.ts'
import { attributeSimulationTokens } from './token-attribution.ts'
import { budgetUsage } from './budget.ts'
import { simTimeSchema } from './time.ts'
export type * from './metrics-types.ts'

/**
 * Count slots using the same durable writer predicate as reservation admission.
 * @param state - Native writer projection and immutable actor ceiling.
 * @param owner - Current provider owner observation; unavailable or unowned cannot confirm retained residency.
 * @returns occupied capacity and slots needing owner confirmation or nonactive-writer recovery.
 */
export function simulationResidentSlots(state: SimulationSnapshot, owner: SimulationOwnerObservation = 'this-provider'): SimulationResidentSlots {
  const writers = Object.values(state.entities).flatMap(entity => entity.writer === undefined || entity.writer.phase === 'released'
    ? [] : [entity.writer])
  return { used: writers.length, limit: state.spec.maxResidentActors,
    recoveryRequired: writers.filter(writer => writer.phase !== 'active' || owner === 'unowned' || owner === 'unavailable').length }
}

/**
 * Inspect actual interval consumption and pending work without taking execution ownership.
 * @param state - Authoritative detached native snapshot.
 * @param owner - Provider observation used only to classify retained writer confirmation.
 * @returns safe administrative metrics; unknown consumption remains charged and no histories or paths are exposed.
 * @throws when a numeric charge or granted limit cannot be represented exactly as a safe integer.
 */
export function simulationRuntimeMetrics(state: SimulationSnapshot, owner: SimulationOwnerObservation): SimulationRuntimeMetrics {
  const usage = budgetUsage(state)
  const decisions = Object.values(state.decisions), operations = Object.values(state.operations)
  return { tokenAttribution: attributeSimulationTokens(Object.values(state.tokenReservations ?? {}), state.decisions),
    budgets: { interval: usage.interval, width: simTimeSchema.parse(state.spec.budgetInterval),
      tokens: { charged: usage.tokens.used, limit: usage.tokens.limit,
        unknownAttempts: Object.values(state.tokenReservations ?? {}).filter(value => value.interval === usage.interval
        && value.status === 'unknown').length }, decisions: usage.decisions, messages: usage.messages },
    residentSlots: simulationResidentSlots(state, owner),
    pendingDecisionCount: decisions.filter(value => value.status === 'open' || value.status === 'submitted').length
    + Object.values(state.decisionDispatch?.tickets ?? {}).filter(value => value.status === 'queued' || value.status === 'reserved').length,
    pendingExternalOperationCount: operations.filter(value => value.result === undefined
    && (value.action.kind === 'communication/post' || value.action.kind === 'task/create')).length,
    unknownOperationCount: operations.filter(value => value.status === 'outcome-unknown').length }
}
