/** Simulated-only availability execution retains actual outcomes through the sole Native mutation owner. */
import { WORLD_EXTERNAL_INTERACT_DEFINITION, WORLD_EXTERNAL_INTERACT_PIN } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldPlan } from '@clocky/clocky-simulation'
import type { WorldExecutionHandler } from './execution.ts'

/** Pure rule adapter; no network, model generation, external sender or resource transfer is available. */
export class ExternalWorldExecution implements WorldExecutionHandler {
  readonly definition = WORLD_EXTERNAL_INTERACT_DEFINITION
  readonly ref = WORLD_EXTERNAL_INTERACT_PIN.implementationRef
  readonly generation = WORLD_EXTERNAL_INTERACT_PIN.generation
  /** @param run - Exclusive original Native owner whose exact accepted plan is executed. */
  constructor(private readonly run: SimulationRun) {}
  reconciliationPlans(): readonly SimulationWorldPlan['id'][] { return [] }
  retainsResponsibility(_plan: SimulationWorldPlan): boolean { return false }
  async execute(plan: SimulationWorldPlan): Promise<undefined> {
    await this.run.commitWorldMutation({ planId: plan.id, payload: { kind: 'evaluate-rule' } })
    return undefined
  }
  async reconcile(plan: SimulationWorldPlan): Promise<void> { await this.execute(plan) }
}
