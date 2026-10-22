import { worldLimitStop } from './world-limit-stop.ts'
/** Original personnel execution: Native reserves before IO and the canonical Team cut owns settlement. */
import { isDeepStrictEqual } from 'node:util'
import { activeSimulationMaintenance, PersonnelDomainError, personnelReserveRequestSchema, SimulationWorldError,
  SimulationCheckpointError, SimulationCheckpointCleanupError,
  WORLD_TRANSFER_PIN, WORLD_DEPART_PIN, WORLD_TRANSFER_DEFINITION, WORLD_DEPART_DEFINITION } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldPlan, PersonnelReservation } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { WorldExecutionHandler } from './execution.ts'
import type { SimulationWorldDriverAnchor, SimulationWorldDriveResult } from './types.ts'

/** One exact installed transfer or departure adapter; it never invents a replacement assignee or identity. */
export class PersonnelWorldExecution implements WorldExecutionHandler {
  readonly definition
  readonly ref
  readonly generation

  /**
   * @param run - Original Native reservation owner.
   * @param connection - Canonical Team connection providing actual controller retirement and held source cuts.
   * @param anchor - Original bounded maintenance policy and lifecycle owner.
   * @param lifetime - Owner lifetime; interruption retains accepted reservations and duties.
   * @param operation - Explicit installed operation selector.
   */
  constructor(private readonly run: SimulationRun, private readonly connection: SimulationTeamConnection,
    private readonly anchor: SimulationWorldDriverAnchor, private readonly lifetime: AbortSignal,
    operation: 'transfer' | 'depart') {
    const pin = operation === 'transfer' ? WORLD_TRANSFER_PIN : WORLD_DEPART_PIN
    this.definition = operation === 'transfer' ? WORLD_TRANSFER_DEFINITION : WORLD_DEPART_DEFINITION
    this.ref = pin.implementationRef
    this.generation = pin.generation
  }

  reconciliationPlans(): readonly SimulationWorldPlan['id'][] {
    const state = this.run.snapshot(), maintenance = activeSimulationMaintenance(state)
    return Object.values(state.world?.personnel.reservations ?? {}).filter(value =>
      state.world?.plans[value.request.planId]?.pin.operation === this.definition.operation
      && maintenance !== undefined && isDeepStrictEqual(value.request.maintenance, maintenance.request))
      .map(value => value.request.planId)
  }

  retainsResponsibility(plan: SimulationWorldPlan): boolean {
    const state = this.run.snapshot(), maintenance = activeSimulationMaintenance(state)
    return Object.values(state.world?.personnel.reservations ?? {}).some(value => value.request.planId === plan.id
      && (value.status !== 'committed' && value.status !== 'cancelled'
        || maintenance !== undefined && isDeepStrictEqual(value.request.maintenance, maintenance.request)))
  }

  readiness(plan: SimulationWorldPlan): SimulationWorldDriveResult['reason'] | undefined {
    const state = this.run.snapshot(), request = state.world?.requests[plan.requestId]
    const expected = request === undefined ? undefined : state.world?.intents[request.intentId]?.expectedTime
    if (expected !== null && expected !== undefined) {
      if (BigInt(expected) < BigInt(state.time)) return 'stale-time'
      if (BigInt(expected) > BigInt(state.time)) return 'waiting-effective-time'
    }
    return undefined
  }

  async execute(plan: SimulationWorldPlan): Promise<SimulationWorldDriveResult['reason'] | undefined> {
    try {
      const reservation = await this.run.reservePersonnel(personnelReserveRequestSchema.parse({ planId: plan.id,
        maintenance: { id: `world/1/personnel/${plan.id}`, owner: this.anchor.ownerName } }))
      await this.settle(reservation, true)
    } catch (error) {
      const current = this.run.snapshot().world
      if (current?.requests[plan.requestId]?.status === 'cancelled'
        && Object.values(current.results).some(value => value.requestId === plan.requestId && value.outcome.kind === 'cancelled')) return
      if (error instanceof SimulationCheckpointError || error instanceof SimulationCheckpointCleanupError) {
        if (error.diagnostic.stage === 'retire' || error.diagnostic.code === 'owner-not-quiescent'
          || error.diagnostic.cleanup === 'unconfirmed') return 'retirement-unknown'
        throw error
      }
      if (error instanceof SimulationWorldError) {
        if (error.code === 'SIM_WORLD_AUTHORITY') return 'authority-missing'
        if (error.failure.code === 'SIM_WORLD_LIMIT') return worldLimitStop(error.failure.limit)
        if (this.run.snapshot().world?.plans[plan.id]?.status === 'stale') return 'plan-stale'
        return 'recovery-required'
      }
      if (!(error instanceof PersonnelDomainError)) throw error
      switch (error.code) {
        case 'SIM_PERSONNEL_WAITING_TIME': return 'waiting-effective-time'
        case 'SIM_PERSONNEL_STALE_TIME': return 'stale-time'
        case 'SIM_PERSONNEL_AUTHORITY': return 'authority-missing'
        case 'SIM_PERSONNEL_HANDOFF_REQUIRED': return 'handoff-required'
        case 'SIM_PERSONNEL_CONFLICT': return this.run.snapshot().world?.plans[plan.id]?.status === 'stale' ? 'plan-stale' : 'recovery-required'
      }
    }
    return undefined
  }

  async reconcile(plan: SimulationWorldPlan): Promise<void> {
    const reservation = Object.values(this.run.snapshot().world?.personnel.reservations ?? {})
      .find(value => value.request.planId === plan.id)
    if (reservation === undefined) throw new Error('Personnel reconciliation lost its original reservation')
    await this.settle(reservation, false)
  }

  private async settle(original: PersonnelReservation, resume: boolean): Promise<void> {
    const before = this.run.snapshot(), management = JSON.stringify(before.management ?? {})
    const cancellations = JSON.stringify(before.world?.cancellations)
    await this.connection.quiesceForMaintenance(original.request.maintenance,
      this.anchor.maxDrainRounds, this.anchor.maxAttempts, this.lifetime)
    this.lifetime.throwIfAborted()
    const current = this.run.snapshot().world?.personnel.reservations[original.id]
    if (current?.status === 'cancel-requested') await this.run.settlePersonnelCancellation(original.id)
    else if (current?.status !== 'cancelled') {
      try { await this.connection.commitPersonnel(original.id) }
      catch (error) {
        const latest = this.run.snapshot().world?.personnel.reservations[original.id]
        if (latest?.status === 'cancel-requested') await this.run.settlePersonnelCancellation(original.id)
        else if (latest?.status !== 'cancelled') throw error
      }
    }
    await this.run.finishMaintenance(original.request.maintenance)
    const state = this.run.snapshot()
    if (resume && before.phase === 'running' && !this.lifetime.aborted
      && JSON.stringify(state.management ?? {}) === management && JSON.stringify(state.world?.cancellations) === cancellations)
      await this.run.setPhase('running', state.revision)
  }
}
