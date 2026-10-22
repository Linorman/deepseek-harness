/** Persistent exclusive structural maintenance; callers own external IO and retirement. @module @clocky/clocky-simulation/maintenance */
import { z } from 'zod'
import type { SimulationMaintenanceId, SimulationMaintenanceRequest } from './maintenance-types.ts'
export type { SimulationMaintenanceId, SimulationMaintenanceRequest } from './maintenance-types.ts'
import type { SimulationSnapshot } from './types.ts'

/** Stable maintenance identity retained through retries and coordinator replacement. */
export const simulationMaintenanceIdSchema = z.string().min(1).transform(value => value as SimulationMaintenanceId)
/** Trusted owner identity is immutable; model proposals cannot invoke maintenance. */
export const simulationMaintenanceRequestSchema = z.strictObject({
  id: simulationMaintenanceIdSchema,
  owner: z.string().trim().min(1),
})
/** Quiescence is a recorded observation, not a timeout or an automatic resume permission. */
export type SimulationMaintenanceOperation = {
  readonly request: SimulationMaintenanceRequest
  readonly startedSequence: number
} & (
  | { readonly status: 'draining' }
  | { readonly status: 'quiescent'; readonly quiescentSequence: number }
  | { readonly status: 'completed'; readonly quiescentSequence: number; readonly finishedSequence: number }
)
/** Stable maintenance failures distinguish blocked admission, identity conflicts and unproven shutdown. */
export class SimulationMaintenanceError extends Error {
  /**
   * Preserve a stable classification without granting any owner authority.
   * @param code - Closed maintenance failure category.
   * @param message - Diagnostic detail for the trusted caller.
   */
  constructor(readonly code: 'SIM_MAINTENANCE_ACTIVE' | 'SIM_MAINTENANCE_CONFLICT' | 'SIM_MAINTENANCE_NOT_QUIESCENT', message: string) {
    super(message)
    this.name = 'SimulationMaintenanceError'
  }
}
/**
 * Find the retained owner that still closes ordinary admission.
 * @param state - Authoritative run projection; the Native fold permits at most one unsettled owner.
 * @returns draining or quiescent maintenance, or undefined after completion.
 */
export function activeSimulationMaintenance(state: SimulationSnapshot): SimulationMaintenanceOperation | undefined {
  return Object.values(state.maintenance ?? {}).find(value => value.status !== 'completed')
}
/**
 * Reject new execution while structural maintenance owns the run; retirement is deliberately independent.
 * @param state - Current authoritative projection at the admission point.
 */
export function assertSimulationMaintenanceAdmission(state: SimulationSnapshot): void {
  if (activeSimulationMaintenance(state) !== undefined) {
    throw new SimulationMaintenanceError('SIM_MAINTENANCE_ACTIVE', 'Simulation maintenance blocks new execution')
  }
}
