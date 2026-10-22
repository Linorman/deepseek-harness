import { hiringMarketAcceptance } from '@clocky/clocky-simulation'
/** Existing-person hiring commits only the original Native-authorized assignment, with no identity preparation IO. */
import { WORLD_HIRE_EXISTING_DEFINITION, WORLD_HIRE_EXISTING_PIN, SimulationHireApprovalError, SimulationWorldError, SimulationHiringResourceError } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldPlan } from '@clocky/clocky-simulation'
import type { WorldExecutionHandler } from './execution.ts'
import type { SimulationWorldDriveResult } from './types.ts'
import { hiringResourceFailureStop, hiringResourceExpiryStop } from './hiring-resources.ts'

/** Execution provider for exact existing-person plans; all effects and onboarding responsibilities share the Native append. */
export class ExistingHireWorldExecution implements WorldExecutionHandler {
  readonly definition = WORLD_HIRE_EXISTING_DEFINITION
  readonly ref = WORLD_HIRE_EXISTING_PIN.implementationRef
  readonly generation = WORLD_HIRE_EXISTING_PIN.generation

  /** @param run - Exclusive original Native owner; the handler never allocates or replaces a Person or Session. */
  constructor(private readonly run: SimulationRun) {}

  reconciliationPlans(): readonly SimulationWorldPlan['id'][] {
    return Object.values(this.run.snapshot().resourceReservations).flatMap(value => value.phase === 'active'
      && value.world?.fee.operation === 'hire-existing' ? [value.world.planId] : [])
  }

  retainsResponsibility(plan: SimulationWorldPlan): boolean {
    return this.reconciliationPlans().includes(plan.id)
  }

  readiness(plan: SimulationWorldPlan): SimulationWorldDriveResult['reason'] | undefined {
    if (!hiringMarketAcceptance(this.run.snapshot(), plan.id)) return 'approval-required'
    const expired = hiringResourceExpiryStop(this.run.snapshot(), plan)
    if (expired !== undefined) return expired
    const authorization = this.run.inspectWorldHireAuthorization(plan.id)
    return !authorization.allowed && authorization.reason === 'approval-required' ? 'approval-required' : undefined
  }

  async execute(plan: SimulationWorldPlan): Promise<SimulationWorldDriveResult['reason'] | undefined> {
    if (plan.proposal.resolution.kind !== 'apply') throw new Error('Existing hire requires its original accepted apply plan')
    try {
      await this.run.reserveExistingHireResources(plan.id)
      await this.run.commitWorldMutation({ planId: plan.id, payload: plan.proposal.resolution.payload })
    }
    catch (error) {
      if (error instanceof SimulationHiringResourceError) return hiringResourceFailureStop(error)
      if (error instanceof SimulationHireApprovalError) return error.code === 'SIM_HIRE_APPROVAL_REQUIRED' ? 'approval-required'
        : error.code === 'SIM_HIRE_APPROVAL_STALE' ? 'plan-stale' : 'authority-missing'
      if (!(error instanceof SimulationWorldError)) throw error
      const world = this.run.snapshot().world
      if (error.code === 'SIM_WORLD_CONFLICT' && world?.requests[plan.requestId]?.status === 'cancelled'
        && Object.values(world.results).some(value => value.requestId === plan.requestId && value.outcome.kind === 'cancelled')) return undefined
      if (error.code === 'SIM_WORLD_AUTHORITY') return 'authority-missing'
      if (error.code === 'SIM_WORLD_LIMIT' && error.failure.code === 'SIM_WORLD_LIMIT' && error.failure.limit === 'position')
        return 'position-capacity'
      if (error.code === 'SIM_WORLD_CONFLICT' && this.run.snapshot().world?.plans[plan.id]?.status === 'stale') return 'plan-stale'
      throw error
    }
    return undefined
  }

  async reconcile(plan: SimulationWorldPlan): Promise<void> {
    if (!this.retainsResponsibility(plan)) throw new Error('Existing hiring reconciliation lost its original financial responsibility')
    if (plan.operationId === null) {
      // The retained user promise owns only this local atomic payment/assignment. Reconcile the same
      // accepted payload; no new reservation, actor, model or identity IO is introduced.
      await this.run.commitWorldMutation({ planId: plan.id, payload: plan.proposal.resolution.payload })
    }
    // Role reservations still require their original explicit productive drive.
  }
}
