import { hasAcceptedHiringOffer } from '@clocky/clocky-simulation'
/** Financial stop projection uses actual Native blockers and retained holds; it performs no ledger arithmetic or effects. */
import { SimulationHiringResourceError } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationWorldPlan } from '@clocky/clocky-simulation'
import type { SimulationWorldDriveResult } from './types.ts'
/**
 * Project the Native resource owner's stable reason into the shared driver stop contract.
 * @param error - Actual Native financial precondition error.
 * @returns exact finite stop; ordinary failures retain their original error handling.
 */
export function hiringResourceFailureStop(error: SimulationHiringResourceError): SimulationWorldDriveResult['reason'] {
  switch (error.resourceFailure) {
    case 'authority': return 'authority-missing'
    case 'insufficient': return 'resource-capacity'
    case 'history-limit': return 'resource-history-limit'
    case 'stale': return 'plan-stale'
    case 'expired': return 'resource-reservation-expired'
    case 'deadline': return 'stale-time'
    default: return assertNever(error.resourceFailure)
  }
}
/**
 * Inspect original expiry without making a new quote or releasing unknown identity IO.
 * @param state - Actual Native snapshot; caller has the original execution lease.
 * @param plan - Original immutable accepted plan.
 * @returns expiry stop only for its uncommitted original financial promise.
 */
export function hiringResourceExpiryStop(state: SimulationSnapshot, plan: SimulationWorldPlan):
SimulationWorldDriveResult['reason'] | undefined {
  if (hasAcceptedHiringOffer(state, plan.id)) return undefined
  const hold = Object.values(state.resourceReservations).find(value => value.world?.planId === plan.id)
  return hold !== undefined && (hold.phase === 'active' || hold.phase === 'expired')
    && (hold.phase === 'expired' || hold.world?.expiryConsumed !== undefined || BigInt(state.time) >= BigInt(hold.expiresAt))
    ? 'resource-reservation-expired' : undefined
}
function assertNever(value: never): never { throw new Error(`Unknown hiring resource failure: ${String(value)}`) }
