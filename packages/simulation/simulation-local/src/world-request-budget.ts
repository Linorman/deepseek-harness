/** Actor request budgets derive from original accepted decisions, never mutable counters or wall-clock time. */
import { budgetInterval, SimulationWorldError } from '@clocky/clocky-simulation'
import type { SimulationEntityId, SimulationSnapshot, SimTime, SimulationWorldRequest } from '@clocky/clocky-simulation'

function requestTime(state: SimulationSnapshot, request: SimulationWorldRequest): SimTime {
  if (request.source.kind === 'authenticated-user') return request.source.time
  const decision = state.decisions[request.source.decisionId]
  if (decision?.status !== 'accepted' || decision.entityId !== request.requesterEntityId)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World request budget lost its original accepted actor decision')
  return decision.time
}

/**
 * Select this actor's consumed business admissions in one original simulation budget interval.
 * @param state - Authoritative Native request/decision history and immutable interval width.
 * @param actorId - Actual decision actor; no model-supplied requester is accepted.
 * @param time - Exact decision time, including a frozen window slot.
 * @param cursor - Original readable Native prefix; admission uses the complete current projection.
 * @returns current interval, fixed period and quota with all original accepted requests still charged.
 */
export function worldRequestBudget(state: SimulationSnapshot, actorId: SimulationEntityId, time: SimTime, cursor = state.revision): {
  readonly actorId: SimulationEntityId
  readonly interval: SimTime
  readonly period: SimulationSnapshot['spec']['budgetInterval']
  readonly used: number
  readonly limit: number
} {
  const world = state.world
  if (world === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World request budget requires its frozen definition')
  const interval = budgetInterval(state, time)
  const used = Object.values(world.requests).filter(request => request.sequence <= cursor && request.requesterEntityId === actorId
    && budgetInterval(state, requestTime(state, request)) === interval).length
  return { actorId, interval, period: state.spec.budgetInterval, used, limit: world.definition.limits.maxRequestsPerActorPerInterval }
}

/**
 * Refuse a new business identity once this actual actor has used its frozen interval allowance.
 * @param state - Preacceptance projection, before this new request has been inserted.
 * @param actorId - Original decision actor.
 * @param time - Original simulation decision time.
 */
export function assertWorldRequestBudget(state: SimulationSnapshot, actorId: SimulationEntityId, time: SimTime): void {
  const budget = worldRequestBudget(state, actorId, time)
  if (budget.used >= budget.limit)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Actor World request budget is exhausted for this simulation interval', 'requests')
}

/**
 * Validate every actor/interval group at the durable projection boundary without refunding terminal cases.
 * @param state - Complete journal-owned requests and their original accepted decision sources.
 */
export function assertWorldRequestBudgetProjection(state: SimulationSnapshot): void {
  if (state.world === undefined) return
  const counts = new Map<string, number>()
  for (const request of Object.values(state.world.requests)) {
    const key = JSON.stringify([request.source.kind === 'authenticated-user' ? ['authenticated-user', request.source.principalId]
      : ['actor', request.requesterEntityId], budgetInterval(state, requestTime(state, request))])
    const used = (counts.get(key) ?? 0) + 1
    if (used > state.world.definition.limits.maxRequestsPerActorPerInterval)
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Retained actor requests exceed their original simulation-interval allowance')
    counts.set(key, used)
  }
}
