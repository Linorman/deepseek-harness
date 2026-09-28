/** Bounded coordination over journal-owned scheduling and Team IO. @module @clocky/clocky-simulation-team/driver */
import type { SimulationDriveRequest, SimulationEntityId, SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection, SimulationTeamDriveResult } from './types.ts'

/**
 * Alternate local scheduling with one required publication or receipt per round.
 * @param run - Exclusive durable run.
 * @param connection - Owner-bound publication and receive operations.
 * @param request - Explicit simulation horizon.
 * @param clock - Real time used only for technical retries.
 * @param maxRounds - Deployment's positive coordination limit.
 * @param residency - Current local recipient availability.
 * @param observeFailure - Read durable recipient abandonment before requiring residency.
 * @param assertCurrent - Reject further rounds after the connection retires.
 * @param ensureResident - Optional caller-selected automatic recipient placement.
 * @returns the first external requirement, scheduler stop or exhausted coordination bound.
 */
export async function driveTeam(run: SimulationRun, connection: Pick<SimulationTeamConnection, 'dispatchOperation' | 'receiveOperation'>,
  request: SimulationDriveRequest, clock: () => number, maxRounds: number,
  residency: (id: SimulationEntityId) => 'ready' | 'unavailable' | 'busy',
  observeFailure: (id: import('@clocky/clocky-simulation').SimulationOperationId) => Promise<boolean>, assertCurrent: () => void,
  ensureResident?: (id: SimulationEntityId) => Promise<'resident' | 'capacity' | 'recovery-required'>): Promise<SimulationTeamDriveResult> {
  let steps = 0
  for (let rounds = 1; rounds <= maxRounds; rounds += 1) {
    assertCurrent()
    const result = await run.drive(request)
    steps += result.steps
    if (result.reason !== 'dispatch-required' && result.reason !== 'delivery-required') return { ...result, reason: result.reason, rounds, steps }
    const operationId = result.operationId
    if (operationId === undefined) throw new Error('Simulation scheduling omitted its required operation')
    if (result.reason === 'dispatch-required') {
      const posted = await connection.dispatchOperation(operationId, clock)
      if (posted.status === 'retry') return { reason: 'retry', rounds, steps, operationId,
        revision: run.snapshot().revision, nextAttemptAt: posted.nextAttemptAt }
      if (posted.status === 'outcome-unknown') return { reason: 'outcome-unknown', rounds, steps, operationId, revision: run.snapshot().revision }
    } else {
      const operation = run.snapshot().operations[operationId]
      if (operation?.action.kind !== 'communication/post') throw new Error('Simulation delivery requirement has no communication intent')
      if (await observeFailure(operationId)) return { reason: 'stalled', rounds, steps, operationId, revision: run.snapshot().revision }
      const entityId = operation.action.recipient
      const current = residency(entityId)
      if (current === 'unavailable' && ensureResident !== undefined) {
        const placed = await ensureResident(entityId)
        if (placed === 'resident') continue
        return { reason: placed === 'capacity' ? 'resident-capacity' : 'residency-recovery-required',
          rounds, steps, operationId, entityId, revision: run.snapshot().revision }
      }
      if (current !== 'ready') return { reason: current === 'busy' ? 'recipient-busy' : 'recipient-required',
        rounds, steps, operationId, entityId, revision: run.snapshot().revision }
      await connection.receiveOperation(operationId)
    }
  }
  return { reason: 'coordination-limit', rounds: maxRounds, steps, revision: run.snapshot().revision }
}
