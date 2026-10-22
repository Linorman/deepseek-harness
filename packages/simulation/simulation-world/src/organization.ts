import { WORLD_HIRING_MARKET_PIN, hasAcceptedHiringOffer } from '@clocky/clocky-simulation'
import { worldLimitStop } from './world-limit-stop.ts'
/** Organization execution over retained Native identities; preparation IO remains outside the Native queue. */
import { simulationWorldHirePlanPayloadSchema, simulationChannelSpecSchema, simulationWorldHireReserveRequestSchema, SimulationWorldError,
  SimulationHireApprovalError, SimulationHiringResourceError,
  WORLD_GENERATE_AND_HIRE_PIN, WORLD_GENERATE_AND_HIRE_DEFINITION, activeSimulationMaintenance } from '@clocky/clocky-simulation'
import { isDeepStrictEqual } from 'node:util'
import type { SimulationRun, SimulationWorldHireReservation, SimulationWorldPlan } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { ResolvedWorldScenario, ResolvedWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import type { SimulationWorldDriverAnchor, SimulationWorldDriveResult } from './types.ts'
import type { WorldExecutionHandler } from './execution.ts'
import { hiringResourceFailureStop, hiringResourceExpiryStop } from './hiring-resources.ts'

/** Generated hiring handler; every identity, Persona and result is retained by Native rather than this adapter. */
export class OrganizationWorldExecution implements WorldExecutionHandler {
  readonly definition = WORLD_GENERATE_AND_HIRE_DEFINITION
  readonly ref = WORLD_GENERATE_AND_HIRE_PIN.implementationRef
  readonly generation = WORLD_GENERATE_AND_HIRE_PIN.generation

  /**
   * @param run - Exclusive original Native owner.
   * @param connection - Canonical Team adapter with exact cleanup/retirement capabilities.
   * @param resolved - Original frozen actor routes.
   * @param anchor - Original bounded maintenance owner configuration.
   * @param lifetime - Execution owner's signal; accepted IO keeps its Native responsibility after cancellation.
   */
  constructor(private readonly run: SimulationRun, private readonly connection: SimulationTeamConnection,
    private readonly resolved: ResolvedWorldScenario | ResolvedWorldScenarioV1, private readonly anchor: SimulationWorldDriverAnchor,
    private readonly lifetime: AbortSignal) {}

  reconciliationPlans(): readonly SimulationWorldPlan['id'][] {
    const state = this.run.snapshot(), maintenance = activeSimulationMaintenance(state)
    return maintenance === undefined ? [] : Object.values(state.world?.reservations ?? {})
      .filter(value => isDeepStrictEqual(value.request.maintenance, maintenance.request)
        || isDeepStrictEqual(value.candidate?.maintenance, maintenance.request)).map(value => value.request.planId)
  }

  readiness(plan: SimulationWorldPlan): SimulationWorldDriveResult['reason'] | undefined {
    const candidate = Object.values(this.run.snapshot().world?.reservations ?? {}).find(value => value.request.planId === plan.id)
    if (candidate?.status === 'candidate' && !hasAcceptedHiringOffer(this.run.snapshot(), plan.id)) return 'approval-required'
    const expired = hiringResourceExpiryStop(this.run.snapshot(), plan)
    if (expired !== undefined) return expired
    const authorization = this.run.inspectWorldHireAuthorization(plan.id)
    return !authorization.allowed && authorization.reason === 'approval-required' ? 'approval-required' : undefined
  }

  /**
   * Inspect the original reservation and its exact unfinished maintenance responsibility.
   * @param plan - Original accepted plan.
   * @returns true for unsettled IO or maintenance, including committed IO awaiting maintenance completion.
   */
  retainsResponsibility(plan: SimulationWorldPlan): boolean {
    const state = this.run.snapshot(), maintenance = activeSimulationMaintenance(state)
    return Object.values(state.world?.reservations ?? {}).some(value => value.request.planId === plan.id
      && (value.status !== 'candidate' && value.status !== 'committed' && value.status !== 'abandoned'
        || maintenance !== undefined && (isDeepStrictEqual(maintenance.request, value.request.maintenance)
          || isDeepStrictEqual(maintenance.request, value.candidate?.maintenance))))
  }

  /**
   * Reconcile an already-retained mutation without inferring or resuming.
   * @param plan - Original accepted plan selected by its exact execution pin.
   * @returns completion after original maintenance settles; unknown IO rejects and retains responsibility.
   */
  async reconcile(plan: SimulationWorldPlan): Promise<void> {
    if (hiringResourceExpiryStop(this.run.snapshot(), plan) !== undefined) return
    const original = Object.values(this.run.snapshot().world?.reservations ?? {}).find(value => value.request.planId === plan.id)
    if (original === undefined) throw new Error('World reconciliation lost its original reservation')
    await this.prepare(original, false)
  }

  /**
   * Execute only the original accepted Persona and current Native-authorized plan.
   * @param plan - Exact retained plan; this adapter neither replaces nor regenerates its payload.
   * @returns a stable quota/authority/stale stop, or undefined after settlement; unknown IO rejects.
   */
  async execute(plan: SimulationWorldPlan): Promise<SimulationWorldDriveResult['reason'] | undefined> {
    if (plan.proposal.resolution.kind !== 'apply') throw new Error('World hire requires its accepted apply plan')
    const selected = simulationWorldHirePlanPayloadSchema.parse(plan.proposal.resolution.payload)
    const runtime = this.resolved.generatedActorRuntime
    const request = simulationWorldHireReserveRequestSchema.parse({ planId: plan.id,
      maintenance: { id: `world/1/hire/${plan.id}`, owner: this.anchor.ownerName },
      member: { displayName: selected.persona.name, role: 'member', capabilities: [], provider: runtime.provider,
        preset: runtime.preset, model: `${runtime.model.provider}/${runtime.model.name}`, modelVersion: runtime.model.version } })
    try {
      const reservation = await this.run.reserveWorldHire(request)
      await this.prepare(reservation, true)
      if (this.run.snapshot().world?.reservations[reservation.id]?.status === 'candidate') return 'approval-required'
    } catch (error: unknown) {
      if (error instanceof SimulationHiringResourceError) return hiringResourceFailureStop(error)
      if (error instanceof SimulationHireApprovalError) return error.code === 'SIM_HIRE_APPROVAL_REQUIRED' ? 'approval-required'
        : error.code === 'SIM_HIRE_APPROVAL_STALE' ? 'plan-stale' : 'authority-missing'
      if (!(error instanceof SimulationWorldError)) throw error
      // Cancellation may win after selection but before Native reserves; the original terminal result owns further work.
      const current = this.run.snapshot().world
      if (error.code === 'SIM_WORLD_CONFLICT' && current?.requests[plan.requestId]?.status === 'cancelled'
        && Object.values(current.results).some(result => result.requestId === plan.requestId && result.outcome.kind === 'cancelled')) return
      if (error.failure.code === 'SIM_WORLD_LIMIT') {
        return worldLimitStop(error.failure.limit)
      }
      if (error.code === 'SIM_WORLD_AUTHORITY') return 'authority-missing'
      if (error.code === 'SIM_WORLD_CONFLICT' && this.run.snapshot().world?.plans[plan.id]?.status === 'stale') return 'plan-stale'
      throw error
    }
    return undefined
  }

  private async prepare(original: SimulationWorldHireReservation, resume: boolean): Promise<void> {
    const before = this.run.snapshot(), management = JSON.stringify(before.management ?? {})
    const cancellations = JSON.stringify(before.world?.cancellations)
    const retained = activeSimulationMaintenance(before)
    if (original.status === 'candidate' && retained?.request.id === original.request.maintenance.id) {
      await this.run.finishMaintenance(original.request.maintenance)
      return
    }
    if (original.status === 'candidate' && !hasAcceptedHiringOffer(before, original.request.planId)) return
    const maintenance = original.candidate?.maintenance ?? original.request.maintenance
    await this.connection.quiesceForMaintenance(maintenance,
      this.anchor.maxDrainRounds, this.anchor.maxAttempts, this.lifetime)
    this.lifetime.throwIfAborted()
    let current = this.run.snapshot().world?.reservations[original.id]
    if (current === undefined) throw new Error('World maintenance lost its original reservation')
    if (current.status === 'cancel-requested') {
      const command = Object.values(this.run.snapshot().world?.cancellations ?? {}).find(value =>
        value.request.requestId === current?.requestId && value.status === 'cancel-requested')
      if (command === undefined) throw new Error('World cleanup lost its original cancellation')
      await this.connection.cancelWorldCase(command.request)
    } else if (current.status === 'candidate') {
      await this.run.commitWorldHire(current.id)
    } else if (current.status !== 'committed' && current.status !== 'abandoned') {
      current = await this.run.prepareWorldHire(original.id)
      const { modelVersion: _version, ...member } = current.request.member
      try {
        await this.connection.ensureParticipant(current.identities.entityId, member)
        const world = this.run.snapshot().world, intent = world?.intents[current.id]
        if (world === undefined || intent === undefined) throw new Error('World preparation lost its original application')
        for (const channel of current.identities.channels) {
          await this.connection.ensureChannel(simulationChannelSpecSchema.parse({ key: channel.key,
            members: [{ entityId: current.identities.entityId, role: 'member' },
              { entityId: channel.purpose === 'director' ? world.definition.directorEntityId : intent.requesterEntityId,
                role: channel.purpose }], limits: {} }))
        }
        if (world.definition.operations.some(pin => pin.implementationRef === WORLD_HIRING_MARKET_PIN.implementationRef))
          await this.run.readyWorldCandidate(current.id)
        else await this.run.commitWorldHire(current.id)
      } catch (error: unknown) {
        // A recorded cancellation withdraws preparation authority; its cleanup owner must account for accepted IO.
        const command = Object.values(this.run.snapshot().world?.cancellations ?? {}).find(value =>
          value.request.requestId === current?.requestId && value.status === 'cancel-requested')
        if (command === undefined) throw error
        await this.connection.cancelWorldCase(command.request)
      }
    }
    await this.run.finishMaintenance(maintenance)
    const state = this.run.snapshot()
    if (resume && before.phase === 'running' && !this.lifetime.aborted
      && JSON.stringify(state.management ?? {}) === management && JSON.stringify(state.world?.cancellations) === cancellations) {
      await this.run.setPhase('running', state.revision)
    }
  }

}
