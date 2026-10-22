/** Pure local environment and experience execution through the existing single Native commit queue. */
import { WORLD_ENVIRONMENT_DEFINITION, WORLD_ENVIRONMENT_PIN, WORLD_EXPERIENCE_DEFINITION, WORLD_EXPERIENCE_PIN,
  environmentRequestSchema, environmentStateSchema, sampleEnvironment } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldPlan } from '@clocky/clocky-simulation'
import type { WorldExecutionHandler } from './execution.ts'

/** Records actual samples before projection; replay only consumes Native's retained mutation. */
export class EvolutionWorldExecution implements WorldExecutionHandler {
  readonly definition
  readonly ref
  readonly generation = 1
  /** @param run - Exclusive original Native owner. @param kind - Installed immutable operation. */
  constructor(private readonly run: SimulationRun, private readonly kind: 'supply' | 'experience') {
    this.definition = kind === 'supply' ? WORLD_ENVIRONMENT_DEFINITION : WORLD_EXPERIENCE_DEFINITION
    this.ref = (kind === 'supply' ? WORLD_ENVIRONMENT_PIN : WORLD_EXPERIENCE_PIN).implementationRef
  }
  reconciliationPlans(): readonly SimulationWorldPlan['id'][] { return [] }
  retainsResponsibility(_plan: SimulationWorldPlan): boolean { return false }
  async execute(plan: SimulationWorldPlan): Promise<undefined> {
    if (plan.proposal.resolution.kind !== 'apply') throw new Error('Evolution requires accepted apply plan')
    let payload = plan.proposal.resolution.payload
    if (this.kind === 'supply') {
      const input = environmentRequestSchema.parse(payload), state = this.run.snapshot()
      payload = sampleEnvironment(environmentStateSchema.parse(state.entities[input.targetEntityId]?.profile.environment),
        input, state.time)
    }
    await this.run.commitWorldMutation({ planId: plan.id, payload })
    return undefined
  }
  async reconcile(plan: SimulationWorldPlan): Promise<void> { await this.execute(plan) }
}
