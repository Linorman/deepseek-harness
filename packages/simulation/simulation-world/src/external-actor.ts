import { reconcileExternalRepresentative } from './external-actor-preparation.ts'
import { externalExecutionStop } from './external-execution-error.ts'
/** External representatives prepare canonical independent actors under their original Native reservation. */
import { isDeepStrictEqual } from 'node:util'
import { activeSimulationMaintenance, simulationChannelSpecSchema,
  simulationWorldHireReserveRequestSchema, simulationExternalActorPlanSchema, SimulationWorldError,
  WORLD_EXTERNAL_ACTOR_DEFINITION, WORLD_EXTERNAL_ACTOR_PIN } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldPlan } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { ResolvedWorldScenario, ResolvedWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import type { WorldExecutionHandler } from './execution.ts'
import type { SimulationWorldDriverAnchor, SimulationWorldDriveResult } from './types.ts'

/** Preparing IO never infers, invents an external observation or releases unresolved cancellation responsibility. */
export class ExternalActorWorldExecution implements WorldExecutionHandler {
  readonly definition = WORLD_EXTERNAL_ACTOR_DEFINITION
  readonly ref = WORLD_EXTERNAL_ACTOR_PIN.implementationRef
  readonly generation = WORLD_EXTERNAL_ACTOR_PIN.generation

  /**
   * @param run - Exclusive Native owner retaining the identity and accepted plan.
   * @param connection - Original canonical Team topology and lifecycle owner.
   * @param resolved - Frozen generated-actor runtime configuration.
   * @param anchor - Original bounded maintenance owner.
   * @param lifetime - Adapter lifetime; interruption retains accepted IO responsibility.
   */
  constructor(private readonly run: SimulationRun, private readonly connection: SimulationTeamConnection,
    private readonly resolved: ResolvedWorldScenario | ResolvedWorldScenarioV1, private readonly anchor: SimulationWorldDriverAnchor,
    private readonly lifetime: AbortSignal) {}

  reconciliationPlans(): readonly SimulationWorldPlan['id'][] {
    const state = this.run.snapshot(), maintenance = activeSimulationMaintenance(state)
    const representatives = Object.values(state.world?.external.representatives ?? {})
      .filter(value => value.adjudication === undefined && (maintenance === undefined ? value.status !== 'committed' && value.status !== 'abandoned'
        : isDeepStrictEqual(value.request.maintenance, maintenance.request))).map(value => value.request.planId)
    const contacts = Object.values(state.world?.external.contacts ?? {}).filter(value => value.status === 'cancel-requested'
      || maintenance !== undefined && value.cancellation !== undefined
        && isDeepStrictEqual(value.cancellation.maintenance, maintenance.request)).map(value => value.planId)
    return [...new Set([...representatives, ...contacts])]
  }

  /** @returns whether the exact original reservation still owns preparation or unfinished maintenance. */
  retainsResponsibility(plan: SimulationWorldPlan): boolean {
    const state = this.run.snapshot(), maintenance = activeSimulationMaintenance(state)
    if (Object.values(state.world?.external.contacts ?? {}).some(value => value.planId === plan.id
      && (value.status !== 'committed' && value.status !== 'cancelled'
        || maintenance !== undefined && value.cancellation !== undefined
          && isDeepStrictEqual(maintenance.request, value.cancellation.maintenance)))) return true
    return Object.values(state.world?.external.representatives ?? {}).some(value => value.request.planId === plan.id
      && value.adjudication === undefined
      && (value.status !== 'committed' && value.status !== 'abandoned'
        || maintenance !== undefined && isDeepStrictEqual(maintenance.request, value.request.maintenance)))
  }

  /** Reconcile existing topology only; paused recovery never infers or resumes the run. */
  async reconcile(plan: SimulationWorldPlan): Promise<void> {
    const contact = Object.values(this.run.snapshot().world?.external.contacts ?? {}).find(value => value.planId === plan.id)
    if (contact?.cancellation !== undefined) {
      await this.cleanupContact(contact.id)
      return
    }
    const original = Object.values(this.run.snapshot().world?.external.representatives ?? {})
      .find(value => value.request.planId === plan.id)
    if (original === undefined) throw new Error('External reconciliation lost its original representative reservation')
    await reconcileExternalRepresentative(this.run, this.connection, this.anchor, this.lifetime, original, false)
  }

  readiness(plan: SimulationWorldPlan): SimulationWorldDriveResult['reason'] | undefined {
    if (plan.proposal.resolution.kind !== 'apply') return
    const selected = simulationExternalActorPlanSchema.parse(plan.proposal.resolution.payload)
    if (!('kind' in selected)) return
    const value = Object.values(this.run.snapshot().world?.external.representatives ?? {}).find(candidate =>
      candidate.identityId === selected.identityId && candidate.status !== 'abandoned')
    const world = this.run.snapshot().world, request = world?.requests[plan.requestId]
    if (request !== undefined && Object.values(world?.external.contacts ?? {}).some(contact => contact.identityId === selected.identityId
      && contact.requesterEntityId === request.requesterEntityId && contact.status === 'cancel-requested')) return 'maintenance-blocked'
    return value?.status === 'committed' ? undefined : 'maintenance-blocked'
  }

  private async contact(plan: SimulationWorldPlan): Promise<void> {
    const original = await this.run.reserveExternalContact(plan.id)
    if (original.status === 'committed') return
    if (original.status === 'cancel-requested') {
      await this.cleanupContact(original.id)
      return
    }
    if (original.status !== 'reserved') return
    const value = this.run.snapshot().world?.external.representatives[original.representativeIntentId]
    if (value?.status !== 'committed') throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Original representative is still preparing')
    try {
      await this.connection.ensureChannel(simulationChannelSpecSchema.parse({ key: original.channel.key, limits: {}, members: [
        { entityId: value.identities.entityId, role: 'member' }, { entityId: original.requesterEntityId, role: 'requester' },
      ] }))
      await this.run.commitExternalContact(original.id)
    } catch (error: unknown) {
      if (this.run.snapshot().world?.external.contacts[original.id]?.status !== 'cancel-requested') throw error
      await this.cleanupContact(original.id)
    }
  }

  private async cleanupContact(id: import('@clocky/clocky-simulation').WorldIntentId): Promise<void> {
    const contact = this.run.snapshot().world?.external.contacts[id]
    if (contact?.cancellation === undefined) throw new Error('Contact cleanup lost its original maintenance ownership')
    await this.connection.quiesceForMaintenance(contact.cancellation.maintenance,
      this.anchor.maxDrainRounds, this.anchor.maxAttempts, this.lifetime)
    this.lifetime.throwIfAborted()
    if (this.run.snapshot().world?.external.contacts[id]?.status === 'cancel-requested')
      await this.run.settleExternalContactCancellation(id)
    if (this.run.snapshot().world?.external.contacts[id]?.status !== 'cancelled')
      throw new Error('Contact cleanup lost its original cancellation result')
    await this.run.finishMaintenance(contact.cancellation.maintenance)
  }

  /** Execute the exact accepted finite-template Persona; Native owns all identities and result facts. */
  async execute(plan: SimulationWorldPlan): Promise<SimulationWorldDriveResult['reason'] | undefined> {
    if (plan.proposal.resolution.kind !== 'apply') throw new Error('External representative requires its original apply plan')
    const selected = simulationExternalActorPlanSchema.parse(plan.proposal.resolution.payload)
    try {
      if ('kind' in selected) {
        await this.contact(plan)
      } else {
        const runtime = this.resolved.generatedActorRuntime
        const request = simulationWorldHireReserveRequestSchema.parse({ planId: plan.id,
          maintenance: { id: `world/1/external/${plan.id}`, owner: this.anchor.ownerName },
          member: { displayName: selected.persona.name, role: 'member', capabilities: [], provider: runtime.provider,
            preset: runtime.preset, model: `${runtime.model.provider}/${runtime.model.name}`, modelVersion: runtime.model.version } })
        await reconcileExternalRepresentative(this.run, this.connection, this.anchor, this.lifetime,
          await this.run.reserveExternalRepresentative(request), true)
      }
    }
    catch (error: unknown) {
      return externalExecutionStop(this.run, plan, error)
    }
    return undefined
  }

}
