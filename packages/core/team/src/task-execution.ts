/** Task execution reservations shared by the Hub and deterministic schedulers. */
import type { TeamTaskSnapshot } from './types.ts'

/** Determine whether a task retains a Participant attempt or an unresolved child reservation.
 * @param task - durable current task projection.
 * @returns whether this task consumes one parent execution slot.
 */
export function taskHasActiveExecution(task: TeamTaskSnapshot): boolean {
  if (task.lease !== undefined) return true
  const delegation = task.delegation
  return delegation?.childTeamId !== undefined && (delegation.phase === 'creating' || delegation.phase === 'active'
    || delegation.phase === 'settling' || delegation.phase === 'stalled')
}

/** Count concurrency reserved by one task, including the child's frozen inner task ceiling.
 * @param task - current authoritative task.
 * @returns reserved parent concurrency units, or zero when execution is inactive.
 */
export function taskConcurrencyUsage(task: TeamTaskSnapshot): number {
  if (!taskHasActiveExecution(task)) return 0
  if (task.lease !== undefined) return 1
  const ceiling = task.delegation?.creation?.budgets.maxConcurrency
  if (ceiling === undefined) return 1
  if (typeof ceiling !== 'number' || !Number.isSafeInteger(ceiling) || ceiling < 0) throw new TypeError('Child concurrency ceiling is invalid')
  return Math.max(1, ceiling)
}

/** Find overlapping declared shared-work mutations, including lease-free child Teams.
 * @param task - proposed task whose own reservation is excluded.
 * @param tasks - authoritative current Team task projections.
 * @returns whether another active shared task reserves an overlapping write prefix.
 */
export function taskHasSharedWriteConflict(task: TeamTaskSnapshot, tasks: Iterable<TeamTaskSnapshot>): boolean {
  if (task.workspaceMode !== 'shared') return false
  for (const other of tasks) {
    if (other.id === task.id || other.workspaceMode !== 'shared' || !taskHasActiveExecution(other)) continue
    if (task.writeScopes.some(left => other.writeScopes.some(right =>
      left === '.' || right === '.' || left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)))) return true
  }
  return false
}
