/** Replayable startup slots and subtree capacity held by live child delegations. */
import type { ActivationBindingSnapshot, JsonObject, ParticipantSnapshot, TeamAuthorityGrant, TeamTaskSnapshot } from './types.ts'
import { taskHasActiveExecution } from './task-execution.ts'

/** Resolve the tighter Team deployment and authority ceiling for live epochs.
 * @param budgets - Frozen Team resource configuration.
 * @param grant - Immutable authority inherited by the Team.
 * @returns the effective ceiling, or undefined when neither owner sets one.
 */
export function liveActivationLimit(budgets: JsonObject, grant?: TeamAuthorityGrant): number | undefined {
  const values = [budgets.maxLiveActivations, grant?.budgets.maxLiveActivations].filter(value => value !== undefined)
  if (values.length === 0) return undefined
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('Live Activation ceiling is invalid')
  }
  return Math.min(...values as number[])
}

/** Count reserved startup slots, unquiesced epochs and live child subtree allowances.
 * @param participants - Current durable participant reservations.
 * @param activations - Historical bindings with authoritative quiescence evidence.
 * @param tasks - Current parent task reservations.
 * @returns total occupied capacity; unknown termination never releases a slot.
 */
export function liveActivationCapacity(
  participants: Iterable<ParticipantSnapshot>, activations: Iterable<ActivationBindingSnapshot>, tasks: Iterable<TeamTaskSnapshot>,
): number {
  let count = 0
  const bound = new Set<string>()
  for (const binding of activations) {
    if (binding.reservationId !== undefined) bound.add(binding.reservationId)
    if (binding.quiescedAt === undefined) count += 1
  }
  for (const participant of participants) {
    const reservation = participant.activationReservation
    if (reservation !== undefined && reservation.releasedAt === undefined && !bound.has(reservation.id)) count += 1
  }
  for (const task of tasks) count += taskLiveActivationReservation(task)
  if (!Number.isSafeInteger(count)) throw new TypeError('Live Activation capacity is not representable')
  return count
}

/** Read the live capacity delegated to an unresolved child subtree.
 * @param task - Authoritative parent task, including stalled and settling children.
 * @returns the frozen child allowance, or zero when no live child owns capacity.
 */
export function taskLiveActivationReservation(task: TeamTaskSnapshot): number {
  if (task.execution.kind !== 'child-team' || !taskHasActiveExecution(task)) return 0
  const limit = task.delegation?.creation?.budgets.maxLiveActivations
  if (limit === undefined) return 0
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0) throw new TypeError('Child live Activation ceiling is invalid')
  return limit
}
