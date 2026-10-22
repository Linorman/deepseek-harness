/** Extract terminal metadata only from the original canonical Team source while its settlement cut is held. */
import { personnelTaskTerminalEvidenceSchema, PersonnelObligationError } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, PersonnelObligationReport, PersonnelTaskTerminalEvidence } from '@clocky/clocky-simulation'
import type { TeamStateSnapshot } from '@clocky/clocky-team'
import { projectTaskEvidence } from './task-evidence.ts'

/**
 * Project actual terminal task sources without running, cancelling, acknowledging or changing any owner.
 * @param state - Exact original Native prefix containing applied task/create receipts.
 * @param team - Actual canonical Team snapshot obtained under its held serializer.
 * @param native - Original inventory selecting the person's outstanding external task-target references.
 * @returns strict lease-free terminal metadata; active or missing tasks remain unresolved in the inventory.
 */
export function projectPersonnelTaskTerminalEvidence(state: SimulationSnapshot, team: TeamStateSnapshot,
  native: PersonnelObligationReport): readonly PersonnelTaskTerminalEvidence[] {
  if (native.runId !== state.spec.runId || native.cursor !== state.revision || team.rules['simulationRunId'] !== state.spec.runId
    || state.entities[native.selector.personId]?.binding?.teamId !== team.team.id)
    throw new PersonnelObligationError('SIM_PERSONNEL_SOURCE', 'Personnel terminal source differs from its original Native and canonical Team prefix')
  return native.items.flatMap((item) => {
    const ref = item.ref
    if (ref.kind !== 'task-target') return []
    const task = team.tasks.find(value => value.id === ref.taskId && value.teamId === ref.teamId)
    if (task === undefined) return []
    const observation = projectTaskEvidence(state, task), creator = task.createCommand.creator
    const operation = state.operations[ref.operationId], receipt = operation?.outbox?.taskReceipt
    if (!('kind' in creator) || operation === undefined || receipt === undefined
      || observation.operationId !== ref.operationId || creator.runId !== state.spec.runId
      || receipt.fingerprint !== operation.fingerprint || receipt.fingerprint !== ref.fingerprint
      || state.decisions[operation.decisionId]?.status !== 'accepted')
      throw new PersonnelObligationError('SIM_PERSONNEL_SOURCE', 'Personnel terminal task lost its exact accepted Native creation fingerprint')
    if (task.lease !== undefined || !['completed', 'failed', 'cancelled', 'deleted'].includes(task.phase)) return []
    return [personnelTaskTerminalEvidenceSchema.parse({ teamId: task.teamId, taskId: task.id, revision: task.revision,
      phase: task.phase, runId: creator.runId, operationId: creator.operationId, creatorParticipantId: creator.participantId,
      idempotencyKey: task.createCommand.idempotencyKey, fingerprint: receipt.fingerprint, teamCursor: team.team.cursor })]
  })
}
