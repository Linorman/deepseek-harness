/** Durable child task ownership facts used by usage and terminal replay fixtures. @module */
import { teamTaskSnapshotSchema } from '@clocky/clocky-team'
import type { TeamId, TeamTaskSnapshot } from '@clocky/clocky-team'
import { participant, teamId } from './fixtures.ts'

/**
 * Build an active human creator and its exact child reservation, without Participant attempts.
 * @param childTeamId - Direct child that will originate the accepted charge.
 * @param taskId - Parent task that owns this child.
 * @param createdAt - Timestamp of the already active parent's reservation batch.
 * @param ownerTeamId - Team whose journal receives the task and charge.
 * @returns Owner records and the reserved task used for later durable settlement.
 */
export function childUsageReservation(childTeamId: string, taskId: string, createdAt: number, ownerTeamId: TeamId = teamId) {
  const grant = { operations: ['register', 'usage', 'close'], workspaceModes: ['shared'], readScopes: [], writeScopes: [], budgets: {} }
  const owner = participant({ teamId: ownerTeamId, id: `charge-owner:${taskId}`, kind: 'human', role: 'human',
    owner: { kind: 'system' }, authorityGrant: grant })
  const initial = teamTaskSnapshotSchema.parse({ id: taskId, teamId: ownerTeamId, revision: 1,
    execution: { kind: 'child-team', templateId: 'durable-fixture', templateVersion: 1, authorityGrant: grant, budget: {} },
    createCommand: { creator: { teamId: ownerTeamId, participantId: owner.id }, idempotencyKey: `create:${taskId}` },
    subject: 'Delegated work', description: 'Complete the delegated work.', phase: 'pending', blockedBy: [], requiredCapabilities: [],
    priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' },
    reviewHistory: [], maxAttempts: 1, attemptCount: 0, attemptHistory: [],
    delegation: { id: `delegation:${taskId}`, phase: 'requested', requestedAt: createdAt, updatedAt: createdAt } })
  const reserved = teamTaskSnapshotSchema.parse({ ...initial, revision: 2, phase: 'running', attemptCount: 1,
    delegation: { ...initial.delegation, phase: 'creating', childTeamId, startedAt: createdAt, updatedAt: createdAt,
      creation: { parentTeamId: ownerTeamId, parentTaskId: initial.id, delegationId: initial.delegation!.id,
        goal: { objective: initial.description, budgets: {} }, rules: {}, budgets: {}, authorityGrant: grant } } })
  return { reserved, records: [
    ...['invited', 'provisioning', 'active'].map(phase => ({ type: 'participant/changed', createdAt, participant: { ...owner, phase } })),
    { type: 'task/changed', task: initial, createdAt }, { type: 'task/changed', task: reserved, createdAt },
  ] }
}

/**
 * Retain a child's failed terminal outcome without inventing a worker attempt.
 * @param reserved - Exact current parent reservation.
 * @param createdAt - Timestamp at which its failed child has settled.
 * @returns The parent task settlement record.
 */
export function failedChildUsageReservation(reserved: TeamTaskSnapshot, createdAt: number) {
  return { type: 'task/changed', createdAt, task: teamTaskSnapshotSchema.parse({ ...reserved, revision: reserved.revision + 1, phase: 'failed',
    delegation: { ...reserved.delegation, phase: 'failed', updatedAt: createdAt,
      failure: { code: 'CHILD_FAILED', message: 'The child stopped after reporting its usage.' } } }) }
}
