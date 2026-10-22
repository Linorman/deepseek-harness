import { worldLimitStop } from './world-limit-stop.ts'
/** Typed external execution stops preserve original responsibility; uncertain canonical IO remains an error. */
import { SimulationWorldError } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldPlan } from '@clocky/clocky-simulation'
import type { SimulationWorldDriveResult } from './types.ts'

/**
 * Translate an actual Native refusal without interpreting its diagnostic prose or releasing retained work.
 * @param run - Original Native owner, queried only for the exact cancellation or stale marker.
 * @param plan - Original admitted execution plan.
 * @param error - Actual execution failure; unknown IO and integrity failures propagate unchanged.
 * @returns the typed stop, or undefined when the exact original cancellation already won.
 */
export function externalExecutionStop(run: SimulationRun, plan: SimulationWorldPlan,
  error: unknown): SimulationWorldDriveResult['reason'] | undefined {
  if (!(error instanceof SimulationWorldError)) throw error
  const world = run.snapshot().world
  if (error.code === 'SIM_WORLD_CONFLICT' && world?.requests[plan.requestId]?.status === 'cancelled'
    && Object.values(world.results).some(value => value.requestId === plan.requestId && value.outcome.kind === 'cancelled')) return
  if (error.failure.code === 'SIM_WORLD_LIMIT') {
    return worldLimitStop(error.failure.limit)
  }
  if (error.code === 'SIM_WORLD_AUTHORITY') return 'authority-missing'
  if (error.code === 'SIM_WORLD_CONFLICT' && world?.plans[plan.id]?.status === 'stale') return 'plan-stale'
  throw error
}
