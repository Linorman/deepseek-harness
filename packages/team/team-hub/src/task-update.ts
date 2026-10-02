/** Durable task-update admissions bind exact editable changes to their original author and revision. */
import { isDeepStrictEqual } from 'node:util'
import { TeamHubError } from './error.ts'
import type { TeamTaskSnapshot, TeamTaskUpdateCommandId, TeamTaskUpdateCommandReceipt, TeamTaskUpdateCommand } from '@clocky/clocky-team'
import type { TeamProjection } from './types.ts'

/**
 * Validate private receipt ownership against retained Team facts.
 * @param projection - Authoritative Team, task and activation maps.
 * @param receipt - Parsed durable input and author.
 * @param active - Whether validating a new admission rather than historical checkpoint data.
 */
export function assertTaskUpdateReceiptOwner(projection: TeamProjection, receipt: TeamTaskUpdateCommand, active: boolean): void {
  const { creator, input } = receipt
  const revision = receipt.kind === 'applied' ? receipt.appliedRevision : receipt.observedRevision
  const observedAt = receipt.kind === 'applied' ? receipt.appliedAt : receipt.rejectedAt
  const member = projection.participants.get(creator.participantId)
  const task = projection.tasks.get(input.taskId)
  if (input.teamId !== projection.team.id || creator.teamId !== projection.team.id || member === undefined
    || active && member.phase !== 'active' || task === undefined || task.revision < revision
    || observedAt < task.createdAt || observedAt > projection.team.updatedAt) malformed('Task update command has invalid Team, author, task revision or time')
  if ('activationId' in creator) {
    const binding = projection.activations.get(creator.activationId)
    if ((member.kind !== 'local-agent' && member.kind !== 'remote-agent') || member.role !== 'coordinator'
      || binding === undefined || binding.activation.participantId !== member.id || binding.sessionId !== creator.sessionId
      || binding.provider !== creator.provider || active && binding.activation.status !== 'idle' && binding.activation.status !== 'running') {
      malformed('Task update receipt has no matching coordinator activation')
    }
  } else if (member.kind !== 'human') malformed('Task update receipt has no matching human participant')
}

/**
 * Admit one receipt only beside its exact editable task replacement.
 * @param previous - Projection before this journal record.
 * @param current - Prior task value; first task publication cannot contain an update command.
 * @param next - Candidate task after the command.
 * @param receipt - Optional command metadata on this task revision.
 * @param createdAt - Timestamp shared by the task journal record and receipt.
 * @param projection - Candidate projection containing the replaced task.
 * @returns unchanged receipts or the newly validated command map.
 */
export function foldTaskUpdateCommand(previous: TeamProjection, current: TeamTaskSnapshot | undefined, next: TeamTaskSnapshot,
  receipt: TeamTaskUpdateCommandReceipt | undefined, createdAt: number,
  projection: TeamProjection): Map<TeamTaskUpdateCommandId, TeamTaskUpdateCommand> {
  if (receipt === undefined) return previous.taskUpdateCommands
  const { input } = receipt
  if (current === undefined || input.taskId !== next.id || input.expectedRevision !== current.revision
    || receipt.appliedRevision !== next.revision || receipt.appliedAt !== createdAt
    || previous.taskUpdateCommands.has(input.commandId)) malformed('Task update command does not identify a fresh exact task revision')
  const expected = { ...current, revision: current.revision + 1,
    ...input.subject === undefined ? {} : { subject: input.subject },
    ...input.description === undefined ? {} : { description: input.description },
    ...input.blockedBy === undefined ? {} : { blockedBy: input.blockedBy } }
  if (!isDeepStrictEqual(expected, next)) malformed('Task update command changed fields outside its retained editable payload')
  assertTaskUpdateReceiptOwner(projection, receipt, true)
  const commands = new Map(previous.taskUpdateCommands)
  commands.set(input.commandId, structuredClone(receipt))
  return commands
}

/** Invalid receipts cannot authorize a retry or survive recovery. */
function malformed(message: string): never { throw new TeamHubError(message, 'TEAM_JOURNAL_MALFORMED') }
