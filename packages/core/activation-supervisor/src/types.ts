/** Exact-epoch health and fencing contracts for execution hosts. */

import type { ActivationBindingSnapshot, ActivationSupervisorDescriptor } from '@clocky/clocky-team'

/** Reachability is independent from proof that execution has terminated. */
export type ActivationSupervisorHealth = 'reachable' | 'unreachable' | 'terminated' | 'unknown'

/** Result whose generation must match the requested durable binding. */
export interface ActivationSupervisorObservation {
  /** Exact descriptor observed by the execution owner. */
  readonly descriptor: ActivationSupervisorDescriptor
  /** Execution state; only terminated proves that no execution remains. */
  readonly status: ActivationSupervisorHealth
}

/** Versioned execution owner resolved by the recovery Consumer. */
export interface ActivationSupervisorProvider {
  /** Registered implementation name. */
  readonly name: string
  /** Exact descriptor implementation version. */
  readonly version: number
  /** Optional execution-host admission, called only by a trusted local runtime provider.
   * @param binding - exact process facts produced by the runtime that created this epoch.
   * @returns resolution once endpoint ownership survives restart.
   */
  admitOwned?(binding: ActivationBindingSnapshot): Promise<void>
  /** Validate deployment ownership without performing network or process operations.
   * @param binding - durable activation and execution identity.
   */
  validate(binding: ActivationBindingSnapshot): void
  /** Observe one exact epoch without treating transport failure as termination.
   * @param binding - validated durable epoch.
   * @param signal - cancellation of this observation.
   * @returns exact descriptor and execution state.
   */
  health(binding: ActivationBindingSnapshot, signal: AbortSignal): Promise<ActivationSupervisorObservation>
  /** Stop all execution owned by one exact epoch and prove its termination.
   * @param binding - validated durable epoch and fence generation.
   * @param signal - cancellation of this request; accepted remote fencing remains owned by the endpoint.
   * @returns a terminated observation only after model, tool, and process work stops.
   */
  fence(binding: ActivationBindingSnapshot, signal: AbortSignal): Promise<ActivationSupervisorObservation>
}
