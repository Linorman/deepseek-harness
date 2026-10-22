/** Explicit memoryless representation switch through the original Native commit order. */
import { representationSwitchRequestSchema, representationSwitchResultSchema, WORLD_REPRESENTATION_DEFINITION,
  WORLD_REPRESENTATION_PIN } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldPlan } from '@clocky/clocky-simulation'
import type { WorldExecutionHandler } from './execution.ts'

/** No asynchronous external IO or unrecorded identity preparation is needed by this finite switch. */
export class RepresentationWorldExecution implements WorldExecutionHandler {
  readonly definition = WORLD_REPRESENTATION_DEFINITION
  readonly ref = WORLD_REPRESENTATION_PIN.implementationRef
  readonly generation = WORLD_REPRESENTATION_PIN.generation
  /** @param run - Exclusive original Native owner. */
  constructor(private readonly run: SimulationRun) {}
  reconciliationPlans(): readonly SimulationWorldPlan['id'][] { return [] }
  retainsResponsibility(_plan: SimulationWorldPlan): boolean { return false }
  async execute(plan: SimulationWorldPlan): Promise<undefined> {
    if (plan.proposal.resolution.kind !== 'apply') throw new Error('Representation switch requires an apply plan')
    const input = representationSwitchRequestSchema.parse(plan.proposal.resolution.payload), state = this.run.snapshot()
    const identity = state.world?.external.identities[input.identityId]
    if (identity === undefined) throw new Error('Representation switch lost original identity')
    await this.run.commitWorldMutation({ planId: plan.id, payload: representationSwitchResultSchema.parse({ ...input,
      generation: input.expectedGeneration + 1, sourceRevision: state.revision, identitySequence: identity.sequence,
      time: state.time, memory: 'none', obligations: 'no-pending-representation-io' }) })
    return undefined
  }
  async reconcile(plan: SimulationWorldPlan): Promise<void> { await this.execute(plan) }
}
