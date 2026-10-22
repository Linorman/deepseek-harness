/** Local display-name mutation with an explicit original whole-run fallback for uncertain dependencies. */
import { WORLD_LOCAL_OBJECT_DEFINITION, WORLD_LOCAL_OBJECT_PIN, localObjectRenameSchema,
  simulationMaintenanceRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldPlan } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { WorldExecutionHandler } from './execution.ts'
import type { SimulationWorldDriverAnchor } from './types.ts'

/** Native remains the only commit owner; this adapter never acquires another mutable owner lock. */
export class LocalObjectWorldExecution implements WorldExecutionHandler {
  readonly definition = WORLD_LOCAL_OBJECT_DEFINITION
  readonly ref = WORLD_LOCAL_OBJECT_PIN.implementationRef
  readonly generation = WORLD_LOCAL_OBJECT_PIN.generation
  /** @param run - Original Native owner. @param connection - Canonical fallback collector.
   * @param anchor - Original bounded maintenance configuration. @param lifetime - Admission cancellation. */
  constructor(private readonly run: SimulationRun, private readonly connection: SimulationTeamConnection,
    private readonly anchor: SimulationWorldDriverAnchor, private readonly lifetime: AbortSignal) {}
  reconciliationPlans(): readonly SimulationWorldPlan['id'][] {
    const state = this.run.snapshot()
    return Object.values(state.world?.plans ?? {}).filter((plan) => {
      const operation = state.maintenance?.[`local-object:${plan.id}` as never]
      return operation !== undefined && operation.status !== 'completed'
    }).map(plan => plan.id)
  }
  retainsResponsibility(plan: SimulationWorldPlan): boolean { return this.reconciliationPlans().includes(plan.id) }
  async execute(plan: SimulationWorldPlan): Promise<undefined> {
    this.lifetime.throwIfAborted()
    if (plan.proposal.resolution.kind !== 'apply') throw new Error('Local rename requires original apply plan')
    const payload = localObjectRenameSchema.parse(plan.proposal.resolution.payload), before = this.run.snapshot()
    const controls = JSON.stringify([before.management, before.world?.cancellations])
    const original = before.maintenance?.[`local-object:${plan.id}` as never]
    if (Object.values(before.world?.mutations ?? {}).some(value => value.planId === plan.id)) {
      await this.run.commitWorldMutation({ planId: plan.id, payload }, () => { this.lifetime.throwIfAborted() })
      if (original !== undefined && original.status !== 'completed') await this.run.finishMaintenance(original.request)
      return undefined
    }
    const outcome = typeof this.run.inspectLocalObjectMutation === 'function' ? this.run.inspectLocalObjectMutation(payload.targetEntityId)
      : { kind: 'maintenance' as const, reason: 'provider-unsupported' as const }
    if (outcome.kind === 'maintenance' || original !== undefined && original.status !== 'completed') {
      const request = original?.request ?? simulationMaintenanceRequestSchema.parse({ id: `local-object:${plan.id}`,
        owner: `local-object-fallback:${outcome.kind === 'maintenance' ? outcome.reason : 'window-read-set-unknown'}` })
      await this.connection.quiesceForMaintenance(request, this.anchor.maxDrainRounds, this.anchor.maxAttempts, this.lifetime)
      this.lifetime.throwIfAborted()
      await this.run.commitWorldMutation({ planId: plan.id, payload }, () => { this.lifetime.throwIfAborted() })
      await this.run.finishMaintenance(request)
      const after = this.run.snapshot()
      if (before.phase === 'running' && !this.lifetime.aborted
        && controls === JSON.stringify([after.management, after.world?.cancellations]))
        await this.run.setPhase('running', after.revision, () => { this.lifetime.throwIfAborted() })
    } else await this.run.commitWorldMutation({ planId: plan.id, payload }, () => { this.lifetime.throwIfAborted() })
    return undefined
  }
  async reconcile(plan: SimulationWorldPlan): Promise<void> { await this.execute(plan) }
}
