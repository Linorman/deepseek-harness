import { describe, expect, it } from 'vitest'
import { fingerprintTeamFinalContent, fingerprintChannelManifest } from '@clocky/clocky-team'
import {
  channelAttachedJournalRecordSchema,
  goalChangedJournalRecordSchema,
  channelProjectionDataSchema,
  channelProjectionCheckpointSchema,
  participantChangedJournalRecordSchema,
  participantInterruptAcknowledgedJournalRecordSchema,
  participantInterruptRequestedJournalRecordSchema,
  taskChangedJournalRecordSchema,
  teamArchiveJournalRecordSchema,
  teamCreatedJournalRecordSchema,
  teamJournalRecordSchema,
  teamPhaseJournalRecordSchema,
  teamProjectionCheckpointSchema,
  teamProjectionDataSchema,
} from '../src/schema.ts'
import {
  CHANNEL_CHECKPOINT_FORMAT_VERSION,
  TEAM_CHECKPOINT_FORMAT_VERSION,
} from '../src/types.ts'
import {
  channelAttached,
  createdTeam,
  goal,
  goalChanged,
  manifest,
  otherTaskId,
  otherTeamId,
  participant,
  participantChanged,
  task,
  taskChanged,
  teamId,
  teamPhase,
} from './fixtures.ts'

const projection = {
  finalAdmission: null,
  team: {
    id: teamId,
    depth: 0,
    maxTeamDepth: 0,
    goal: goal(),
    phase: 'active',
    cursor: 4,
    createdAt: 10,
    updatedAt: 14,
  },
  goal: goal(),
  rules: { mode: 'local' },
  budgets: { tokens: 50 },
  participants: [participant({ phase: 'active' })],
  tasks: [task()],
  activations: [],
  interrupts: [],
  channelIds: ['channel-a'],
}

describe('Team-Hub durable schemas', () => {
  it('parses every current Team record and checkpoint form', () => {
    const interrupt = {
      id: 'interrupt-a',
      actorId: participant().id,
      target: {
        teamId,
        participantId: participant().id,
        activationId: 'activation-a',
        sessionId: 'session-a',
        provider: 'in-process',
      },
      requestedAt: 14,
    }
    const requested = { type: 'participant-interrupt/requested' as const, interrupt, createdAt: 14 }
    const acknowledged = {
      type: 'participant-interrupt/acknowledged' as const,
      interruptId: interrupt.id,
      target: interrupt.target,
      createdAt: 15,
    }
    const records = [
      createdTeam(), teamPhase(), { type: 'team/archived' as const, createdAt: 16 }, goalChanged(), participantChanged(), taskChanged(), requested, acknowledged, channelAttached(),
    ]

    expect(teamCreatedJournalRecordSchema.parse(records[0])).toEqual(records[0])
    expect(teamCreatedJournalRecordSchema.parse({
      ...createdTeam(),
      parentTeamId: otherTeamId,
      parentTaskId: otherTaskId,
      depth: 1,
      maxTeamDepth: 2,
    })).toMatchObject({ parentTeamId: otherTeamId, parentTaskId: otherTaskId, depth: 1 })
    expect(teamPhaseJournalRecordSchema.parse(records[1])).toEqual(records[1])
    expect(teamArchiveJournalRecordSchema.parse(records[2])).toEqual(records[2])
    expect(goalChangedJournalRecordSchema.parse(records[3])).toEqual(records[3])
    expect(participantChangedJournalRecordSchema.parse(records[4])).toEqual(records[4])
    expect(taskChangedJournalRecordSchema.parse(records[5])).toEqual(records[5])
    expect(participantInterruptRequestedJournalRecordSchema.parse(records[6])).toEqual(records[6])
    expect(participantInterruptAcknowledgedJournalRecordSchema.parse(records[7])).toEqual(records[7])
    expect(channelAttachedJournalRecordSchema.parse(records[8])).toEqual(records[8])
    expect(records.map(record => teamJournalRecordSchema.parse(record))).toEqual(records)

    expect(teamProjectionDataSchema.parse({ ...projection, workspaceAllocations: [] }))
      .toEqual({ ...projection, workspaceAllocations: [] })
    expect(teamProjectionCheckpointSchema.parse({
      kind: 'team-projection',
      version: TEAM_CHECKPOINT_FORMAT_VERSION,
      teamId,
      projection: { ...projection, workspaceAllocations: [] },
    })).toMatchObject({ teamId, projection: { ...projection, workspaceAllocations: [] } })

    const channelManifest = manifest()
    const channelProjection = {
      manifest: channelManifest,
      invitations: channelManifest.participants.map(member => ({
        participantId: member.id, role: member.role, visibility: 'channel' as const, required: true, deadline: 30,
        endpoint: { kind: 'activation' as const }, revision: 1, manifestFingerprint: fingerprintChannelManifest(channelManifest),
        status: 'acknowledged' as const, acknowledgementKey: 'fixture-consent', settledAt: 1,
      })),
      phase: 'active',
      cursor: 1,
      state: { opened: true },
      pendingDeliveries: [{
        participantId: participant().id,
        envelopeId: 'envelope-a',
        envelopeSequence: 0,
        delivery: 'turn' as const,
        expiresAt: 30,
      }],
      receiptCursors: [],
      postIdempotency: [],
      summaries: [],
    }
    expect(channelProjectionDataSchema.parse(channelProjection)).toEqual(channelProjection)
    expect(channelProjectionCheckpointSchema.parse({
      kind: 'channel-projection',
      version: CHANNEL_CHECKPOINT_FORMAT_VERSION,
      channelId: manifest().id,
      projection: channelProjection,
    })).toMatchObject({ channelId: 'channel-a', projection: channelProjection })
  })

  it('rejects serialized journal timestamps that disagree with their owned facts', () => {
    const closure = { teamId, kind: 'fail', idempotencyKey: 'closure-1', actor: { kind: 'system', name: 'team-run' },
      reason: { code: 'FAILED', message: 'The run failed.' }, requestedAt: 10 }
    const cancellation = { teamId, idempotencyKey: 'cancel-1', actor: closure.actor, reason: closure.reason, requestedAt: 10 }
    const allocation = { id: 'allocation-1', revision: 1, teamId, taskId: 'task-1', attemptId: 'attempt-1', assignedRevision: 1,
      participantId: 'worker-1', activationId: 'activation-1', sessionId: 'session-1', provider: 'shared', mode: 'shared',
      lifecycle: 'reserved', reservedAt: 10, updatedAt: 10 }
    const action = { id: 'action-1', teamId, kind: 'question', phase: 'pending', sessionId: 'session-1', participantId: 'worker-1',
      sourceId: 'source-1', details: { question: 'Continue?' }, createdAt: 10, updatedAt: 10 }
    const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 1, costUnits: 0, updatedAt: 10 }
    const sample = { id: 'sample-1', teamId, participantId: 'worker-1', sessionId: 'session-1', turn: 1, step: 1,
      usage: { inputTokens: 1, outputTokens: 1 }, observedAt: 10 }
    const charge = { id: 'charge-1', sourceTeamId: 'child-team', parentTaskId: 'parent-task', originTeamId: 'child-team', sourceSampleId: sample.id,
      participantId: sample.participantId, sessionId: sample.sessionId, turn: 1, step: 1, usage: sample.usage, observedAt: 10 }
    const admission = { teamId, channelId: 'final-channel', envelopeId: 'final-1', envelopeSequence: 1,
      contentFingerprint: fingerprintTeamFinalContent({ text: 'Final result' }), idempotencyKey: 'final-admit-1',
      sink: 'team-run-result', recipientId: 'human-1', owner: { kind: 'system' }, admittedAt: 10 }
    const records = [
      { type: 'team/closure', closure, createdAt: 10 },
      { type: 'team/cancellation', cancellation, createdAt: 10 },
      { type: 'workspace-allocation/changed', allocation, createdAt: 10 },
      { type: 'human-action/changed', action, createdAt: 10 },
      { type: 'usage/changed', sample, usage, createdAt: 10 },
      { type: 'usage/parent-charge-pending', charge, createdAt: 10 },
      { type: 'usage/child-charged', charge, usage, createdAt: 10 },
      { type: 'team/final-admitted', admission, createdAt: 10 },
    ]
    for (const record of records) {
      expect(teamJournalRecordSchema.parse(record)).toEqual(record)
      const persisted: unknown = JSON.parse(JSON.stringify({ ...record, createdAt: 11 }))
      expect(teamJournalRecordSchema.safeParse(persisted).success, record.type).toBe(false)
    }
    expect(teamPhaseJournalRecordSchema.safeParse({ type: 'team/phase', phase: 'stalled', createdAt: 10 }).success).toBe(false)
    expect(teamPhaseJournalRecordSchema.safeParse({
      type: 'team/phase', phase: 'active', reason: closure.reason, createdAt: 10,
    }).success).toBe(false)
  })

  it('rejects malformed records and incompatible checkpoint encodings', () => {
    expect(teamCreatedJournalRecordSchema.safeParse({ ...createdTeam(), extra: true }).success).toBe(false)
    expect(teamCreatedJournalRecordSchema.safeParse({
      ...createdTeam(),
      parentTeamId: otherTeamId,
      parentTaskId: otherTaskId,
      depth: 2,
      maxTeamDepth: 1,
    }).success).toBe(false)
    expect(teamPhaseJournalRecordSchema.safeParse({ ...teamPhase(), createdAt: -1 }).success).toBe(false)
    expect(participantChangedJournalRecordSchema.safeParse({ ...participantChanged(), participant: { id: 'only-id' } }).success).toBe(false)
    expect(taskChangedJournalRecordSchema.safeParse({ ...taskChanged(), task: { ...task(), revision: 0 } }).success).toBe(false)
    const { createCommand: _createCommand, ...unattributedTask } = task()
    expect(taskChangedJournalRecordSchema.safeParse({ ...taskChanged(), task: unattributedTask }).success).toBe(false)
    expect(channelAttachedJournalRecordSchema.safeParse({ ...channelAttached(), channelId: '' }).success).toBe(false)
    expect(participantInterruptRequestedJournalRecordSchema.safeParse({
      type: 'participant-interrupt/requested',
      interrupt: {
        id: 'interrupt-a', actorId: participant().id,
        target: { teamId, participantId: participant().id, activationId: 'activation-a', sessionId: 'session-a', provider: 'in-process' },
        requestedAt: 12,
      },
      createdAt: 13,
    }).success).toBe(false)
    expect(teamJournalRecordSchema.safeParse({ type: 'unknown', createdAt: 1 }).success).toBe(false)

    expect(teamProjectionDataSchema.safeParse({ ...projection, channelIds: [''] }).success).toBe(false)
    expect(teamProjectionDataSchema.safeParse({ ...projection, tasks: [unattributedTask] }).success).toBe(false)
    expect(teamProjectionCheckpointSchema.safeParse({
      kind: 'team-projection',
      version: TEAM_CHECKPOINT_FORMAT_VERSION + 1,
      teamId,
      projection,
    }).success).toBe(false)
    expect(channelProjectionDataSchema.safeParse({
      manifest: manifest(),
      invitations: [],
      phase: 'active',
      cursor: -1,
      state: undefined,
      pendingDeliveries: [],
      receiptCursors: [],
      postIdempotency: [],
    }).success).toBe(false)
    expect(channelProjectionCheckpointSchema.safeParse({
      kind: 'team-projection',
      version: CHANNEL_CHECKPOINT_FORMAT_VERSION,
      channelId: 'channel-a',
      projection: {},
    }).success).toBe(false)
  })
})
