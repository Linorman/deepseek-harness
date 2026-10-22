/** Institution execution preserves the original approved payload and delegates only closed Native effects. */
import { WORLD_NORM_ENACT_DEFINITION, WORLD_NORM_ENACT_PIN, WORLD_NORM_REVOKE_DEFINITION,
  WORLD_NORM_REVOKE_PIN, SimulationNormError } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldPlan } from '@clocky/clocky-simulation'
import type { WorldExecutionHandler } from './execution.ts'
import type { SimulationWorldDriveResult } from './types.ts'

/** Pure-local institution adapter; no provider IO, regeneration or alternate document can enter the mutation. */
export class NormWorldExecution implements WorldExecutionHandler {
  readonly definition
  readonly ref
  readonly generation

  /**
   * @param run - Original exclusive Native execution owner.
   * @param operation - Exact installed institution transition; its accepted payload selects all supported dates and policy.
   */
  constructor(private readonly run: SimulationRun, operation: 'enact' | 'revoke') {
    const pin = operation === 'enact' ? WORLD_NORM_ENACT_PIN : WORLD_NORM_REVOKE_PIN
    this.definition = operation === 'enact' ? WORLD_NORM_ENACT_DEFINITION : WORLD_NORM_REVOKE_DEFINITION
    this.ref = pin.implementationRef
    this.generation = pin.generation
  }

  reconciliationPlans(): readonly SimulationWorldPlan['id'][] { return [] }

  retainsResponsibility(_plan: SimulationWorldPlan): boolean { return false }

  async execute(plan: SimulationWorldPlan): Promise<SimulationWorldDriveResult['reason'] | undefined> {
    if (plan.proposal.resolution.kind !== 'apply') throw new Error('Institution mutation requires its accepted apply disposition')
    try { await this.run.commitWorldMutation({ planId: plan.id, payload: plan.proposal.resolution.payload }) }
    catch (error) {
      if (!(error instanceof SimulationNormError) || error.code !== 'SIM_NORM_EXISTING_OBLIGATIONS') throw error
      return 'existing-obligations'
    }
    return undefined
  }

  async reconcile(plan: SimulationWorldPlan): Promise<void> {
    const stopped = await this.execute(plan)
    if (stopped !== undefined) throw new Error('Original institution migration retains unresolved obligations')
  }
}
