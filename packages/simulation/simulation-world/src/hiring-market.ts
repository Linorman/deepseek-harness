/** Native hiring market execution does no identity IO and preserves the original actor decision. */
import { WORLD_HIRING_MARKET_DEFINITION, WORLD_HIRING_MARKET_PIN, pendingCandidateCancellation, simulationWorldCancelRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldPlan } from '@clocky/clocky-simulation'
import type { WorldExecutionHandler } from './execution.ts'

/** Atomic result owner; retries reuse the Native mutation and result identity. */
export class HiringMarketWorldExecution implements WorldExecutionHandler {
  readonly definition = WORLD_HIRING_MARKET_DEFINITION
  readonly ref = WORLD_HIRING_MARKET_PIN.implementationRef
  readonly generation = WORLD_HIRING_MARKET_PIN.generation
  /** @param run - Original exclusive Native run. */
  constructor(private readonly run: SimulationRun) {}
  reconciliationPlans(): readonly SimulationWorldPlan['id'][] {
    const state = this.run.snapshot()
    return Object.values(state.world?.plans ?? {}).filter(plan => pendingCandidateCancellation(state, plan.id) !== undefined)
      .map(plan => plan.id)
  }
  retainsResponsibility(plan: SimulationWorldPlan): boolean {
    return pendingCandidateCancellation(this.run.snapshot(), plan.id) !== undefined
  }
  async execute(plan: SimulationWorldPlan): Promise<undefined> {
    if (plan.proposal.resolution.kind !== 'apply') throw new Error('Market execution requires its original apply plan')
    await this.run.commitWorldMutation({ planId: plan.id, payload: plan.proposal.resolution.payload })
    const requestId = pendingCandidateCancellation(this.run.snapshot(), plan.id)
    if (requestId !== undefined) await this.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({
      id: `market-candidate-end:${plan.id}`, requestId }))
    return undefined
  }
  async reconcile(plan: SimulationWorldPlan): Promise<void> { await this.execute(plan) }
}
