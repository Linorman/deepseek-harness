/** Strict simulated mediation executes through the original Native mutation or representative preparation owner. */
import { isDeepStrictEqual } from 'node:util'
import { activeSimulationMaintenance, simulationExternalMediatedPlanSchema, simulationWorldHireReserveRequestSchema,
  WORLD_EXTERNAL_MEDIATED_DEFINITION, WORLD_EXTERNAL_MEDIATED_PIN } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldPlan } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { ResolvedWorldScenario, ResolvedWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import type { WorldExecutionHandler } from './execution.ts'
import type { SimulationWorldDriverAnchor, SimulationWorldDriveResult } from './types.ts'
import { reconcileExternalRepresentative } from './external-actor-preparation.ts'
import { externalExecutionStop } from './external-execution-error.ts'

/** No new model call or outside IO occurs while applying an original accepted adjudication. */
export class ExternalMediatedWorldExecution implements WorldExecutionHandler {
  readonly definition = WORLD_EXTERNAL_MEDIATED_DEFINITION
  readonly ref = WORLD_EXTERNAL_MEDIATED_PIN.implementationRef
  readonly generation = WORLD_EXTERNAL_MEDIATED_PIN.generation

  /**
   * @param run - Exclusive Native owner retaining the original adjudication and finite plan.
   * @param connection - Original canonical Team topology and lifecycle owner.
   * @param resolved - Frozen generated-actor runtime configuration.
   * @param anchor - Original bounded preparation owner.
   * @param lifetime - Adapter lifetime; interruption retains accepted preparation responsibility.
   */
  constructor(private readonly run: SimulationRun, private readonly connection: SimulationTeamConnection,
    private readonly resolved: ResolvedWorldScenario | ResolvedWorldScenarioV1, private readonly anchor: SimulationWorldDriverAnchor,
    private readonly lifetime: AbortSignal) {}

  reconciliationPlans(): readonly SimulationWorldPlan['id'][] {
    const state = this.run.snapshot(), maintenance = activeSimulationMaintenance(state)
    return Object.values(state.world?.external.representatives ?? {}).filter(value => value.adjudication !== undefined
      && (maintenance === undefined ? value.status !== 'committed' && value.status !== 'abandoned'
        : isDeepStrictEqual(value.request.maintenance, maintenance.request))).map(value => value.request.planId)
  }

  /** @returns whether this exact original mediated reservation still owns preparation or unfinished maintenance. */
  retainsResponsibility(plan: SimulationWorldPlan): boolean {
    const state = this.run.snapshot(), maintenance = activeSimulationMaintenance(state)
    return Object.values(state.world?.external.representatives ?? {}).some(value => value.adjudication !== undefined
      && value.request.planId === plan.id && (value.status !== 'committed' && value.status !== 'abandoned'
        || maintenance !== undefined && isDeepStrictEqual(value.request.maintenance, maintenance.request)))
  }

  /** Reconcile original preparation without resuming a paused run or generating another plan. */
  async reconcile(plan: SimulationWorldPlan): Promise<void> {
    const original = Object.values(this.run.snapshot().world?.external.representatives ?? {})
      .find(value => value.request.planId === plan.id && value.adjudication !== undefined)
    if (original === undefined) throw new Error('Mediated reconciliation lost its original finite representative reservation')
    await reconcileExternalRepresentative(this.run, this.connection, this.anchor, this.lifetime, original, false)
  }

  /** Apply the exact retained leaf or execute its finite canonical representative preparation. */
  async execute(plan: SimulationWorldPlan): Promise<SimulationWorldDriveResult['reason'] | undefined> {
    try { await this.applyOriginal(plan) }
    catch (error: unknown) { return externalExecutionStop(this.run, plan, error) }
    return undefined
  }

  private async applyOriginal(plan: SimulationWorldPlan): Promise<undefined> {
    if (plan.proposal.resolution.kind !== 'apply') throw new Error('Mediated execution requires its original apply plan')
    const selected = simulationExternalMediatedPlanSchema.parse(plan.proposal.resolution.payload).outcome
    if (selected.kind !== 'representative-preparation-plan') {
      await this.run.commitWorldMutation({ planId: plan.id, payload: { kind: 'apply-original-adjudication' } })
      return undefined
    }
    const runtime = this.resolved.generatedActorRuntime
    const request = simulationWorldHireReserveRequestSchema.parse({ planId: plan.id,
      maintenance: { id: `world/1/external/${plan.id}`, owner: this.anchor.ownerName },
      member: { displayName: selected.preparation.persona.name, role: 'member', capabilities: [], provider: runtime.provider,
        preset: runtime.preset, model: `${runtime.model.provider}/${runtime.model.name}`, modelVersion: runtime.model.version } })
    await reconcileExternalRepresentative(this.run, this.connection, this.anchor, this.lifetime,
      await this.run.reserveExternalRepresentative(request), true)
    return undefined
  }
}
