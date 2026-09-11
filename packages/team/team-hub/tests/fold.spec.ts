import { describe, expect, it } from 'vitest'
import { activationBindingSnapshotSchema, activationIdSchema, channelIdSchema, channelPostIdempotencyKeySchema, envelopeIdSchema, taskAttemptIdSchema, teamClosureIdempotencyKeySchema, teamHumanActionIdSchema, teamHumanActionSnapshotSchema, teamHumanActionSourceIdSchema, teamInterruptIdSchema, teamTaskCreateIdempotencyKeySchema, teamUsageSampleIdSchema } from '@clocky/clocky-team'
import type { ActivationBindingSnapshot, ChannelManifest, JsonValue, TeamChannelAdapter, TeamHumanActionSnapshot, TeamTaskSnapshot, TeamUsageSample } from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import { TeamHubError } from '../src/error.ts'
import { teamJournalRecordSchema, teamProjectionDataSchema } from '../src/schema.ts'
import {
  channelRecordCursor,
  channelProjectionData,
  channelProjectionFromData,
  foldChannelRecord,
  foldTeamRecord,
  teamProjectionData,
  teamProjectionFromData,
  usageFromSamples,
} from '../src/fold.ts'
import type { TeamJournalRecord, TeamProjection } from '../src/types.ts'
import {
  channelAdapter,
  channelAttached,
  channelClosed,
  channelEnvelope,
  channelOpened,
  channelPhase,
  channelReceipt,
  createdTeam,
  goal,
  goalChanged,
  manifest,
  otherTaskId,
  otherParticipantId,
  otherTeamId,
  participant,
  participantChanged,
  participantId,
  settledAttempt,
  task,
  taskCreatorActivationId,
  taskCreatorId,
  taskCreatorSessionId,
  taskChanged,
  taskLease,
  taskId,
  teamId,
  teamPhase,
} from './fixtures.ts'
import { channelAdmissionPrefix } from './durable-channel-fixtures.ts'

type DurableCode = 'TEAM_JOURNAL_MALFORMED' | 'TEAM_CHANNEL_WAL_MALFORMED'

function failure(operation: () => unknown, code: DurableCode): TeamHubError {
  try {
    operation()
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(TeamHubError)
    if (error instanceof TeamHubError) {
      expect(error.code).toBe(code)
      return error
    }
    throw error
  }
  throw new Error(`expected ${code}`)
}

/** Bypass the durable parser only when a fold test needs an otherwise schema-invalid record. */
function rawTaskChanged(task: TeamTaskSnapshot, createdAt: number): TeamJournalRecord {
  return { type: 'task/changed', task, createdAt }
}

function baseTeam(): TeamProjection {
  const created = foldTeamRecord(undefined, createdTeam(), 0, teamId)
  return foldTeamRecord(created, teamPhase(), 1, teamId)
}

function closureRecord(kind: 'complete' | 'fail', createdAt: number): TeamJournalRecord {
  return {
    type: 'team/closure',
    closure: {
      teamId,
      kind,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse(`closure-${kind}`),
      actor: { kind: 'system', name: 'team-run' },
      reason: { code: `TEST_${kind.toUpperCase()}`, message: `Test ${kind} closure.` },
      ...kind === 'complete' ? {
        finalChannelId: channelIdSchema.parse('channel-final'),
        finalEnvelopeId: envelopeIdSchema.parse('envelope-final'),
      } : {},
      requestedAt: createdAt,
    },
    createdAt,
  }
}

/** Build a compact active coordinator relation for task-provenance fold scenarios. */
function taskBaseTeam(): TeamProjection {
  const projection = baseTeam()
  const creator = participant({
    id: taskCreatorId,
    kind: 'local-agent',
    displayName: 'Task creator',
    role: 'coordinator',
    phase: 'active',
  })
  const binding = activationBinding({
    activation: {
      id: taskCreatorActivationId,
      teamId,
      participantId: taskCreatorId,
      status: 'idle',
    },
    sessionId: taskCreatorSessionId,
    provider: 'in-process',
  })
  return {
    ...projection,
    participants: new Map([[creator.id, creator]]),
    activations: new Map([[binding.activation.id, binding]]),
  }
}

/** Build one durable local activation binding for a fixture participant. */
function activationBinding(overrides: Record<string, unknown> = {}): ActivationBindingSnapshot {
  return activationBindingSnapshotSchema.parse({
    activation: {
      id: activationIdSchema.parse('activation-a'),
      teamId,
      participantId,
      status: 'idle',
    },
    sessionId: SessionId('activation-session-a'),
    provider: 'in-process',
    ...overrides,
  })
}

function sdkRecovery(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'sdk-local-cold-replace' as const,
    version: 1 as const,
    runtimeProvider: 'sdk',
    profile: 'local-sdk-v1',
    agent: { provider: 'mock', model: 'mock', maxTokens: 32 },
    process: { hostId: 'host-a', pid: 42, started: 'start-a', processGroupId: 42 },
    ...overrides,
  }
}

function taskCreateCommand(
  binding: ActivationBindingSnapshot,
  idempotencyKey = 'task-create-a',
): NonNullable<TeamTaskSnapshot['createCommand']> {
  return {
    creator: {
      teamId: binding.activation.teamId,
      participantId: binding.activation.participantId,
      activationId: binding.activation.id,
      sessionId: binding.sessionId,
      provider: binding.provider,
    },
    idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(idempotencyKey),
  }
}

/** Fold the durable opening/consent prefix required before a channel can become active. */
function admittedChannel(channelManifest: ChannelManifest, adapter: TeamChannelAdapter) {
  let projection: ReturnType<typeof foldChannelRecord> | undefined
  for (const [cursor, record] of channelAdmissionPrefix(channelManifest, 20, 30).entries()) {
    projection = foldChannelRecord(projection, record, cursor, channelManifest.id, adapter)
  }
  if (projection === undefined) throw new Error('channel admission prefix did not produce a projection')
  return projection
}

/** Rebase one fixture Envelope on the next cursor after channel admission. */
function channelEnvelopeAt(sequence: number, overrides: Record<string, unknown> = {}) {
  const original = channelEnvelope()
  if (original.type !== 'channel/envelope') throw new Error('fixture must create an envelope')
  const envelopeOverrides = (overrides.envelope ?? {}) as Record<string, unknown>
  return channelEnvelope({ ...overrides, envelope: { ...original.envelope, ...envelopeOverrides, sequence } })
}

/** Build a Team projection with one active local participant and one idle activation. */
function interruptProjection() {
  let projection = foldTeamRecord(baseTeam(), participantChanged({ createdAt: 12 }), 2, teamId)
  projection = foldTeamRecord(projection, participantChanged({ participant: participant({ phase: 'provisioning' }), createdAt: 13 }), 3, teamId)
  projection = foldTeamRecord(projection, participantChanged({ participant: participant({ phase: 'active' }), createdAt: 14 }), 4, teamId)
  const binding = activationBinding()
  projection = foldTeamRecord(projection, { type: 'activation/changed', binding, createdAt: 15 }, 5, teamId)
  return { projection, binding }
}

/** Build one schema-valid pending Team human action for fold tests. */
function humanAction(binding: ActivationBindingSnapshot, overrides: Partial<TeamHumanActionSnapshot> = {}): TeamHumanActionSnapshot {
  return teamHumanActionSnapshotSchema.parse({
    id: teamHumanActionIdSchema.parse('human-action-a'),
    teamId,
    kind: 'question',
    phase: 'pending',
    sessionId: binding.sessionId,
    participantId,
    sourceId: teamHumanActionSourceIdSchema.parse('rpc-a'),
    details: { questionRpcId: 'rpc-a', questions: [] },
    createdAt: 20,
    updatedAt: 20,
    ...overrides,
  })
}

/** Build one schema-valid provider usage sample for fold tests. */
function usageSample(overrides: Partial<TeamUsageSample> = {}): TeamUsageSample {
  return {
    id: teamUsageSampleIdSchema.parse('usage-a'),
    teamId,
    participantId,
    sessionId: SessionId('usage-session-a'),
    turn: 1,
    step: 0,
    usage: { inputTokens: 2, outputTokens: 3 },
    observedAt: 20,
    ...overrides,
  }
}

/** Build one durable soft-interrupt request for the fixture activation. */
function interruptRequested(
  binding: ActivationBindingSnapshot,
  overrides: Record<string, unknown> = {},
): Extract<TeamJournalRecord, { readonly type: 'participant-interrupt/requested' }> {
  return {
    type: 'participant-interrupt/requested',
    interrupt: {
      id: teamInterruptIdSchema.parse('interrupt-a'),
      actorId: participantId,
      target: {
        teamId,
        participantId,
        activationId: binding.activation.id,
        sessionId: binding.sessionId,
        provider: binding.provider,
      },
      requestedAt: 16,
      ...overrides,
    },
    createdAt: 16,
  }
}

/** Build one exact-target acknowledgement for the fixture soft interrupt. */
function interruptAcknowledged(
  binding: ActivationBindingSnapshot,
  overrides: Record<string, unknown> = {},
): Extract<TeamJournalRecord, { readonly type: 'participant-interrupt/acknowledged' }> {
  return {
    type: 'participant-interrupt/acknowledged',
    interruptId: teamInterruptIdSchema.parse('interrupt-a'),
    target: {
      teamId,
      participantId,
      activationId: binding.activation.id,
      sessionId: binding.sessionId,
      provider: binding.provider,
    },
    createdAt: 17,
    ...overrides,
  }
}

function adapter(options: { readonly failure?: 'validate' | 'initial' | 'fold'; readonly nonJson?: boolean } = {}) {
  const folds: string[] = []
  const frozen: boolean[] = []
  const value: TeamChannelAdapter = {
    type: 'direct',
    version: 1,
    validateCreate(input) {
      frozen.push(Object.isFrozen(input), Object.isFrozen(input.participants), Object.isFrozen(input.participants[0]))
      if (options.failure === 'validate') throw new Error('adapter rejects manifest')
    },
    initialState(input) {
      frozen.push(Object.isFrozen(input), Object.isFrozen(input.limits))
      if (options.failure === 'initial') throw new Error('adapter cannot initialize')
      return { opened: true }
    },
    validateSend() {},
    fold(state, record) {
      frozen.push(Object.isFrozen(state), Object.isFrozen(record))
      folds.push(record.type)
      if (options.failure === 'fold') throw new Error('adapter cannot fold')
      if (options.nonJson === true) return undefined as unknown as JsonValue
      return { lastRecord: record.type, priorState: state }
    },
    afterAccept() { return [] },
    expectedNext() { return { kind: 'none' } },
    deliveryPlan({ envelope }) {
      return [{ participantId, envelopeId: envelope.id, delivery: envelope.delivery }]
    },
    projectView() { return {} },
  }
  return { value, folds, frozen }
}

describe('Team journal fold', () => {
  it('replays a valid Team, participants, task graph, and attached channel', () => {
    let projection = taskBaseTeam()
    projection = foldTeamRecord(projection, participantChanged({ participant: participant({ kind: 'human' }), createdAt: 12 }), 2, teamId)
    projection = foldTeamRecord(projection, participantChanged({ participant: participant({ kind: 'human', phase: 'provisioning' }), createdAt: 13 }), 3, teamId)
    projection = foldTeamRecord(projection, participantChanged({ participant: participant({ kind: 'human', phase: 'active' }), createdAt: 14 }), 4, teamId)
    projection = foldTeamRecord(projection, taskChanged({ createdAt: 15 }), 5, teamId)
    projection = foldTeamRecord(projection, taskChanged({
      task: task({ id: otherTaskId, blockedBy: [taskId] }),
      createdAt: 16,
    }), 6, teamId)
    projection = foldTeamRecord(projection, taskChanged({
      task: task({
        revision: 2,
        phase: 'assigned',
        attemptCount: 1,
        lease: taskLease({ assignedAt: 17, renewedAt: 17, expiresAt: 27 }),
      }),
      createdAt: 17,
    }), 7, teamId)
    projection = foldTeamRecord(projection, channelAttached({ createdAt: 18 }), 8, teamId)

    expect(projection.team).toMatchObject({ id: teamId, phase: 'active', cursor: 8, createdAt: 10, updatedAt: 18 })
    expect(projection.participants.get(participantId)).toMatchObject({ phase: 'active' })
    expect(projection.tasks.get(taskId)).toMatchObject({ revision: 2, phase: 'assigned' })
    expect(projection.tasks.get(otherTaskId)).toMatchObject({ blockedBy: [taskId] })
    expect(projection.channelIds).toEqual(new Set(['channel-a']))

    const data = teamProjectionData(projection)
    const restored = teamProjectionFromData(data)
    expect(restored).not.toBe(projection)
    expect(restored.team).not.toBe(data.team)
    expect(restored.participants.get(participantId)).toEqual(projection.participants.get(participantId))
    expect(restored.tasks.get(taskId)).toEqual(projection.tasks.get(taskId))
    expect(restored.channelIds).toEqual(projection.channelIds)
  })

  it('folds human actions and replaceable usage samples with strict provenance', () => {
    const { projection, binding } = interruptProjection()
    const action = humanAction(binding)
    const withAction = foldTeamRecord(projection, { type: 'human-action/changed', action, createdAt: 20 }, 6, teamId)
    expect(withAction.humanActions.get(action.id)).toEqual(action)
    const settled = humanAction(binding, {
      phase: 'resolved',
      outcome: { kind: 'answered' },
      updatedAt: 21,
    })
    const withSettled = foldTeamRecord(withAction, { type: 'human-action/changed', action: settled, createdAt: 21 }, 7, teamId)
    expect(withSettled.humanActions.get(action.id)?.phase).toBe('resolved')

    const sample = usageSample({ observedAt: 22 })
    const withUsage = foldTeamRecord(withSettled, {
      type: 'usage/changed', sample, usage: {
        inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0,
        turns: 1, costUnits: 0, updatedAt: 22,
      }, createdAt: 22,
    }, 8, teamId)
    expect(withUsage.usage).toMatchObject({ inputTokens: 2, outputTokens: 3, turns: 1 })
    const replacement = usageSample({ usage: { inputTokens: 4, outputTokens: 5 }, observedAt: 23 })
    const replaced = foldTeamRecord(withUsage, {
      type: 'usage/changed', sample: replacement, usage: {
        inputTokens: 4, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0,
        turns: 1, costUnits: 0, updatedAt: 23,
      }, createdAt: 23,
    }, 9, teamId)
    expect(replaced.usage).toMatchObject({ inputTokens: 4, outputTokens: 5, turns: 1 })
  })

  it('rejects malformed human-action and usage fold relations', () => {
    const { projection, binding } = interruptProjection()
    const action = humanAction(binding)
    failure(() => foldTeamRecord(projection, {
      type: 'human-action/changed', action: { ...action, teamId: otherTeamId }, createdAt: 20,
    }, 6, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(projection, {
      type: 'human-action/changed', action: { ...action, participantId: otherParticipantId }, createdAt: 20,
    }, 6, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(projection, {
      type: 'human-action/changed', action: { ...action, taskId }, createdAt: 20,
    }, 6, teamId), 'TEAM_JOURNAL_MALFORMED')
    const withAction = foldTeamRecord(projection, { type: 'human-action/changed', action, createdAt: 20 }, 6, teamId)
    failure(() => foldTeamRecord(withAction, {
      type: 'human-action/changed', action: { ...action, phase: 'resolved', outcome: { kind: 'answered' }, details: { changed: true }, updatedAt: 21 }, createdAt: 21,
    }, 7, teamId), 'TEAM_JOURNAL_MALFORMED')

    const sample = usageSample({ observedAt: 22 })
    const usage = { inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 1, costUnits: 0, updatedAt: 22 }
    failure(() => foldTeamRecord(withAction, {
      type: 'usage/changed', sample: { ...sample, teamId: otherTeamId }, usage, createdAt: 22,
    }, 7, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(withAction, {
      type: 'usage/changed', sample: { ...sample, participantId: otherParticipantId }, usage, createdAt: 22,
    }, 7, teamId), 'TEAM_JOURNAL_MALFORMED')
    const withUsage = foldTeamRecord(withAction, { type: 'usage/changed', sample, usage, createdAt: 22 }, 7, teamId)
    failure(() => foldTeamRecord(withUsage, {
      type: 'usage/changed', sample: { ...sample, sessionId: SessionId('other-session') }, usage: { ...usage, updatedAt: 23 }, createdAt: 23,
    }, 8, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(withUsage, {
      type: 'usage/changed', sample: { ...sample, usage: { inputTokens: 99, outputTokens: 99 }, observedAt: 23 }, usage, createdAt: 23,
    }, 8, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(withUsage, {
      type: 'usage/changed', sample: { ...sample, observedAt: 22 }, usage, createdAt: 23,
    }, 8, teamId), 'TEAM_JOURNAL_MALFORMED')
  })

  it('rejects duplicate, foreign, and inconsistent human-action/usage checkpoint rows', () => {
    const { projection, binding } = interruptProjection()
    const action = humanAction(binding)
    const sample = usageSample({ observedAt: 22 })
    const data = teamProjectionData(projection)
    failure(() => teamProjectionFromData({ ...data, humanActions: [action, action] }), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({ ...data, humanActions: [{ ...action, teamId: otherTeamId }] }), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({ ...data, humanActions: [{ ...action, participantId: otherParticipantId }] }), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({ ...data, humanActions: [{ ...action, taskId }] }), 'TEAM_JOURNAL_MALFORMED')
    const usage = usageFromSamples(new Map([[sample.id, sample]]))
    failure(() => teamProjectionFromData({ ...data, usage, usageSamples: [sample, sample] }), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({ ...data, usage: { ...usage, outputTokens: 99 }, usageSamples: [sample] }), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({ ...data, usageSamples: [{ ...sample, teamId: otherTeamId }] }), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({ ...data, usageSamples: [{ ...sample, participantId: otherParticipantId }] }), 'TEAM_JOURNAL_MALFORMED')
    expect(() => usageFromSamples(new Map([[sample.id, {
      ...sample,
      usage: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 },
    }], [teamUsageSampleIdSchema.parse('usage-overflow'), {
      ...sample,
      id: teamUsageSampleIdSchema.parse('usage-overflow'),
      usage: { inputTokens: 1, outputTokens: 1 },
    }]]))).toThrow('safe integer range')
    expect(() => usageFromSamples(new Map([[sample.id, {
      ...sample,
      costUnits: Number.MAX_SAFE_INTEGER,
      usage: { inputTokens: 1, outputTokens: 1 },
    }], [teamUsageSampleIdSchema.parse('usage-b'), {
      ...sample,
      id: teamUsageSampleIdSchema.parse('usage-b'),
      costUnits: 1,
      usage: { inputTokens: 1, outputTokens: 1 },
    }]]))).toThrow('cost aggregate')
  })

  it('rejects malformed Team journal sequence, identity, lifecycle, and attachment relations', () => {
    failure(() => foldTeamRecord(undefined, teamPhase(), 0, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(undefined, createdTeam(), 1, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(undefined, createdTeam({ teamId: otherTeamId }), 0, teamId), 'TEAM_JOURNAL_MALFORMED')
    const active = baseTeam()
    failure(() => foldTeamRecord(active, teamPhase({ phase: 'provisioning', createdAt: 12 }), 2, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(active, channelAttached({ createdAt: 10 }), 2, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(active, createdTeam({ createdAt: 12 }), 2, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(active, channelAttached(), 3, teamId), 'TEAM_JOURNAL_MALFORMED')

    const attached = foldTeamRecord(active, channelAttached({ createdAt: 12 }), 2, teamId)
    failure(() => foldTeamRecord(attached, channelAttached({ createdAt: 13 }), 3, teamId), 'TEAM_JOURNAL_MALFORMED')

    failure(() => foldTeamRecord(active, participantChanged({
      participant: participant({ teamId: otherTeamId }),
    }), 2, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(active, participantChanged({
      participant: participant({ phase: 'active' }),
    }), 2, teamId), 'TEAM_JOURNAL_MALFORMED')
    const invited = foldTeamRecord(active, participantChanged(), 2, teamId)
    failure(() => foldTeamRecord(invited, participantChanged({
      participant: participant({ phase: 'provisioning', role: 'different' }),
      createdAt: 13,
    }), 3, teamId), 'TEAM_JOURNAL_MALFORMED')
  })

  it('requires completion and failure intents to quiesce before their terminal phase', () => {
    const completeIntent = foldTeamRecord(baseTeam(), closureRecord('complete', 12), 2, teamId)
    failure(() => foldTeamRecord(completeIntent, teamPhase({ phase: 'completed', createdAt: 13 }), 3, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData(teamProjectionData(completeIntent)), 'TEAM_JOURNAL_MALFORMED')
    const completionGoal = foldTeamRecord(completeIntent, goalChanged({
      goal: goal({ revision: 2, phase: 'complete' }), createdAt: 13,
    }), 3, teamId)
    const completionQuiescing = foldTeamRecord(completionGoal, teamPhase({ phase: 'quiescing', createdAt: 14 }), 4, teamId)
    expect(foldTeamRecord(completionQuiescing, teamPhase({ phase: 'completed', createdAt: 15 }), 5, teamId).team.phase)
      .toBe('completed')

    const failureIntent = foldTeamRecord(baseTeam(), closureRecord('fail', 12), 2, teamId)
    failure(() => foldTeamRecord(failureIntent, teamPhase({ phase: 'failed', createdAt: 13 }), 3, teamId), 'TEAM_JOURNAL_MALFORMED')
    const failureQuiescing = foldTeamRecord(failureIntent, teamPhase({ phase: 'quiescing', createdAt: 13 }), 3, teamId)
    expect(foldTeamRecord(failureQuiescing, teamPhase({ phase: 'failed', createdAt: 14 }), 4, teamId).team.phase)
      .toBe('failed')
  })

  it('replays only contiguous valid Team-goal revisions and checkpoint copies', () => {
    failure(() => foldTeamRecord(undefined, {
      ...createdTeam(), goal: { ...goal(), revision: 2 },
    } as TeamJournalRecord, 0, teamId), 'TEAM_JOURNAL_MALFORMED')
    const active = baseTeam()
    const edited = foldTeamRecord(active, goalChanged({
      goal: goal({ revision: 2, objective: 'Updated objective', budgets: { tokens: 60 } }),
      createdAt: 12,
    }), 2, teamId)
    expect(edited.team.goal).toMatchObject({ revision: 2, objective: 'Updated objective', phase: 'active' })
    const blocked = foldTeamRecord(edited, goalChanged({
      goal: goal({
        revision: 3,
        objective: 'Updated objective',
        phase: 'blocked',
        blocker: { code: 'needs-input', message: 'Need a decision.' },
        budgets: { tokens: 60 },
      }),
      createdAt: 13,
    }), 3, teamId)
    expect(blocked.team.goal.blocker).toEqual({ code: 'needs-input', message: 'Need a decision.' })
    const checkpoint = teamProjectionData(blocked)
    expect(checkpoint.goal).toEqual(blocked.team.goal)
    expect(teamProjectionFromData(checkpoint).team.goal).toEqual(blocked.team.goal)

    failure(() => foldTeamRecord(active, goalChanged({
      goal: goal({ revision: 3 }), createdAt: 12,
    }), 2, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(active, {
      type: 'goal/changed',
      goal: { ...goal({ revision: 2 }), teamId: otherTeamId },
      createdAt: 12,
    } as unknown as TeamJournalRecord, 2, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(active, {
      type: 'goal/changed',
      goal: { ...goal({ revision: 2 }), phase: 'blocked', blocker: undefined },
      createdAt: 12,
    } as unknown as TeamJournalRecord, 2, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(active, {
      type: 'goal/changed',
      goal: { ...goal({ revision: 2 }), objective: 42 },
      createdAt: 12,
    } as unknown as TeamJournalRecord, 2, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(active, {
      type: 'goal/changed',
      goal: { ...goal({ revision: 2 }), budgets: [] },
      createdAt: 12,
    } as unknown as TeamJournalRecord, 2, teamId), 'TEAM_JOURNAL_MALFORMED')
    const completed = foldTeamRecord(active, goalChanged({
      goal: goal({ revision: 2, phase: 'complete' }), createdAt: 12,
    }), 2, teamId)
    failure(() => foldTeamRecord(completed, goalChanged({
      goal: goal({ revision: 3, phase: 'active' }), createdAt: 13,
    }), 3, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({ ...checkpoint, goal: goal({ revision: 1 }) }), 'TEAM_JOURNAL_MALFORMED')
  })

  it('defensively rejects impossible root-or-child creation lineage after parsing', () => {
    const invalid: readonly TeamJournalRecord[] = [
      { ...createdTeam(), parentTeamId: otherTeamId } as TeamJournalRecord,
      { ...createdTeam(), depth: 1 } as TeamJournalRecord,
      {
        ...createdTeam(),
        parentTeamId: otherTeamId,
        parentTaskId: otherTaskId,
        depth: 0,
      } as TeamJournalRecord,
      {
        ...createdTeam(),
        parentTeamId: otherTeamId,
        parentTaskId: otherTaskId,
        depth: 2,
        maxTeamDepth: 1,
      } as TeamJournalRecord,
    ]
    for (const record of invalid) {
      failure(() => foldTeamRecord(undefined, record, 0, teamId), 'TEAM_JOURNAL_MALFORMED')
    }
  })

  it('rejects invalid persisted task identity, lifecycle, revision, and dependency graphs', () => {
    const active = taskBaseTeam()
    failure(() => foldTeamRecord(active, taskChanged({ task: task({ teamId: otherTeamId }) }), 2, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(active, taskChanged({ task: task({ revision: 2 }) }), 2, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(active, rawTaskChanged({ ...task(), phase: 'running' }, 13), 2, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(active, taskChanged({ task: task({ blockedBy: [taskId] }) }), 2, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(active, taskChanged({ task: task({ blockedBy: [otherTaskId] }) }), 2, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(active, taskChanged({ task: task({ writeScopes: ['packages/team', 'packages/team'] }) }), 2, teamId), 'TEAM_JOURNAL_MALFORMED')

    const first = foldTeamRecord(active, taskChanged(), 2, teamId)
    const lease = taskLease({ assignedAt: 14, renewedAt: 14, expiresAt: 24 })
    const assigned = task({ revision: 2, phase: 'assigned', attemptCount: 1, lease })
    failure(() => foldTeamRecord(first, taskChanged({
      task: { ...assigned, revision: 3 },
      createdAt: 14,
    }), 3, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(first, rawTaskChanged({ ...task(), revision: 2, phase: 'running' }, 14), 3, teamId), 'TEAM_JOURNAL_MALFORMED')

    const second = foldTeamRecord(first, taskChanged({
      task: task({ id: otherTaskId, blockedBy: [taskId] }),
      createdAt: 14,
    }), 3, teamId)
    failure(() => foldTeamRecord(second, taskChanged({
      task: task({ revision: 2, blockedBy: [otherTaskId] }),
      createdAt: 15,
    }), 4, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(second, taskChanged({ task: task({ revision: 2, phase: 'deleted' }), createdAt: 15 }), 4, teamId), 'TEAM_JOURNAL_MALFORMED')

    const deleted = foldTeamRecord(first, taskChanged({
      task: task({ revision: 2, phase: 'deleted' }),
      createdAt: 14,
    }), 3, teamId)
    expect(deleted.tasks.get(taskId)?.phase).toBe('deleted')
  })

  it('folds unique activation-authorized task-create commands and validates their checkpoint relations', () => {
    const { projection: active, binding } = interruptProjection()
    const createCommand = taskCreateCommand(binding)
    const created = task({ createCommand })
    const { createCommand: _unattributedCommand, ...unattributed } = created
    const missingCommandRecord: unknown = JSON.parse(JSON.stringify({ type: 'task/changed', task: unattributed, createdAt: 16 }))
    expect(() => teamJournalRecordSchema.parse(missingCommandRecord)).toThrow()
    const projection = foldTeamRecord(active, taskChanged({ task: created, createdAt: 16 }), 6, teamId)
    expect(projection.tasks.get(taskId)?.createCommand).toEqual(createCommand)
    expect(teamProjectionFromData(teamProjectionData(projection)).tasks.get(taskId)?.createCommand).toEqual(createCommand)

    failure(() => foldTeamRecord(projection, taskChanged({
      task: task({
        ...created,
        revision: 2,
        createCommand: taskCreateCommand(binding, 'task-create-b'),
      }),
      createdAt: 17,
    }), 7, teamId), 'TEAM_JOURNAL_MALFORMED')

    failure(() => foldTeamRecord(projection, taskChanged({
      task: task({ id: otherTaskId, createCommand }),
      createdAt: 17,
    }), 7, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(active, taskChanged({
      task: task({
        createCommand: {
          ...createCommand,
          creator: { ...createCommand.creator, sessionId: SessionId('other-creator-session') },
        },
      }),
      createdAt: 16,
    }), 6, teamId), 'TEAM_JOURNAL_MALFORMED')
    const offline = foldTeamRecord(active, {
      type: 'activation/changed',
      binding: {
        ...binding,
        activation: { ...binding.activation, status: 'offline' },
      },
      createdAt: 16,
    }, 6, teamId)
    failure(() => foldTeamRecord(offline, taskChanged({
      task: task({ createCommand }),
      createdAt: 17,
    }), 7, teamId), 'TEAM_JOURNAL_MALFORMED')
    const checkpoint = teamProjectionData(projection)
    const missingCreationCommand: unknown = JSON.parse(JSON.stringify({
      ...checkpoint,
      tasks: [{ ...checkpoint.tasks[0]!, createCommand: undefined }],
    }))
    expect(() => teamProjectionDataSchema.parse(missingCreationCommand)).toThrow()
    failure(() => teamProjectionFromData({
      ...checkpoint,
      tasks: [{
        ...checkpoint.tasks[0]!,
        createCommand: {
          ...createCommand,
          creator: { ...createCommand.creator, activationId: activationIdSchema.parse('missing-creator-activation') },
        },
      }],
    }), 'TEAM_JOURNAL_MALFORMED')
  })

  it('replays and rejects exact task-attempt lease and history transitions', () => {
    let projection = taskBaseTeam()
    projection = foldTeamRecord(projection, participantChanged({ participant: participant({ kind: 'human' }), createdAt: 12 }), 2, teamId)
    projection = foldTeamRecord(projection, participantChanged({ participant: participant({ kind: 'human', phase: 'provisioning' }), createdAt: 13 }), 3, teamId)
    projection = foldTeamRecord(projection, participantChanged({ participant: participant({ kind: 'human', phase: 'active' }), createdAt: 14 }), 4, teamId)
    const pending = task({ reviewPolicy: { kind: 'participant', reviewerId: participantId } })
    projection = foldTeamRecord(projection, taskChanged({ task: pending, createdAt: 15 }), 5, teamId)
    const lease = taskLease({ assignedAt: 16, renewedAt: 16, expiresAt: 26 })
    const assigned = task({ ...pending, revision: 2, phase: 'assigned', attemptCount: 1, lease })
    failure(() => foldTeamRecord(projection, taskChanged({
      task: task({
        ...assigned,
        lease: taskLease({ ...lease, activationId: activationIdSchema.parse('forbidden-human-activation') }),
      }),
      createdAt: 16,
    }), 6, teamId), 'TEAM_JOURNAL_MALFORMED')
    projection = foldTeamRecord(projection, taskChanged({ task: assigned, createdAt: 16 }), 6, teamId)
    const unchangedLease = task({ ...assigned, revision: 3 })
    projection = foldTeamRecord(projection, taskChanged({ task: unchangedLease, createdAt: 17 }), 7, teamId)
    const startedLease = taskLease({ ...lease, startedAt: 18 })
    const running = task({ ...unchangedLease, revision: 4, phase: 'running', lease: startedLease })
    projection = foldTeamRecord(projection, taskChanged({ task: running, createdAt: 18 }), 8, teamId)
    const renewedLease = taskLease({ ...startedLease, renewedAt: 19, expiresAt: 29 })
    const renewed = task({ ...running, revision: 5, lease: renewedLease })
    projection = foldTeamRecord(projection, taskChanged({ task: renewed, createdAt: 19 }), 9, teamId)
    const reviewerGone = foldTeamRecord(projection, participantChanged({
      participant: participant({ kind: 'human', phase: 'left' }),
      createdAt: 20,
    }), 10, teamId)
    const { lease: _reviewerGoneLease, ...reviewerGoneBase } = renewed
    failure(() => foldTeamRecord(reviewerGone, taskChanged({
      task: task({
        ...reviewerGoneBase,
        revision: 6,
        phase: 'review',
        attemptHistory: [settledAttempt({
          assignedAt: 16,
          startedAt: 18,
          leaseExpiresAt: 29,
          settledAt: 21,
          outcome: { kind: 'completed', result: { summary: 'Reviewer departed.' } },
        })],
      }),
      createdAt: 21,
    }), 11, teamId), 'TEAM_JOURNAL_MALFORMED')
    const { lease: _settledLease, ...releasedBase } = renewed
    const released = task({
      ...releasedBase,
      revision: 6,
      phase: 'pending',
      attemptHistory: [settledAttempt({
        assignedAt: 16,
        startedAt: 18,
        leaseExpiresAt: 29,
        settledAt: 20,
        outcome: { kind: 'released' },
      })],
    })
    projection = foldTeamRecord(projection, taskChanged({ task: released, createdAt: 20 }), 10, teamId)
    const releasedProjection = projection
    expect(projection.tasks.get(taskId)).toMatchObject({
      revision: 6,
      phase: 'pending',
      attemptCount: 1,
      attemptHistory: [{ outcome: { kind: 'released' } }],
    })
    const releasedCheckpoint = teamProjectionData(releasedProjection)
    failure(() => foldTeamRecord(baseTeam(), taskChanged({
      task: task({ reviewPolicy: { kind: 'participant', reviewerId: participantId } }),
      createdAt: 15,
    }), 2, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({
      ...releasedCheckpoint,
      tasks: [{ ...releasedCheckpoint.tasks[0]!, phase: 'review' }],
    }), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({
      ...releasedCheckpoint,
      tasks: [{ ...releasedCheckpoint.tasks[0]!, phase: 'completed' }],
    }), 'TEAM_JOURNAL_MALFORMED')
    const firstAttempt = releasedCheckpoint.tasks[0]?.attemptHistory[0]
    if (firstAttempt === undefined) throw new Error('released checkpoint must retain its terminal attempt')
    const { taskExecutionStats: _retainedStats, ...reviewCheckpoint } = releasedCheckpoint
    expect(teamProjectionFromData({
      ...reviewCheckpoint,
      tasks: [{
        ...releasedCheckpoint.tasks[0]!,
        phase: 'review',
        reviewPolicy: { kind: 'participant', reviewerId: participantId },
        attemptHistory: [{ ...firstAttempt, outcome: { kind: 'completed', result: { summary: 'Completed work.' } } }],
      }],
    }).tasks.get(taskId)?.phase).toBe('review')
    const pendingReviewProjection = teamProjectionFromData({
      ...reviewCheckpoint,
      tasks: [{
        ...releasedCheckpoint.tasks[0]!,
        phase: 'review',
        reviewPolicy: { kind: 'participant', reviewerId: participantId },
        attemptHistory: [{ ...firstAttempt, outcome: { kind: 'completed', result: { summary: 'Completed work.' } } }],
      }],
    })
    const pendingReview = pendingReviewProjection.tasks.get(taskId)
    if (pendingReview === undefined) throw new Error('review checkpoint must retain the task')
    const cancelledReview = foldTeamRecord(pendingReviewProjection, rawTaskChanged({
      ...pendingReview,
      revision: pendingReview.revision + 1,
      phase: 'cancelled',
    }, 21), pendingReviewProjection.team.cursor + 1, teamId)
    expect(cancelledReview.tasks.get(taskId)?.phase).toBe('cancelled')
    failure(() => foldTeamRecord(pendingReviewProjection, rawTaskChanged({
      ...pendingReview,
      revision: pendingReview.revision + 1,
      phase: 'deleted',
    }, 21), pendingReviewProjection.team.cursor + 1, teamId), 'TEAM_JOURNAL_MALFORMED')
    const reviewedCheckpoint = {
      ...reviewCheckpoint,
      tasks: [{
        ...releasedCheckpoint.tasks[0]!,
        phase: 'completed' as const,
        reviewPolicy: { kind: 'participant' as const, reviewerId: participantId },
        attemptHistory: [{ ...firstAttempt, outcome: { kind: 'completed' as const, result: { summary: 'Completed work.' } } }],
        reviewHistory: [{
          attemptId: firstAttempt.id,
          reviewerId: participantId,
          nextPhase: 'completed' as const,
          reason: 'Accepted work.',
          decidedAt: 21,
        }],
      }],
    }
    expect(teamProjectionFromData(reviewedCheckpoint).tasks.get(taskId)?.phase).toBe('completed')
    failure(() => teamProjectionFromData({
      ...reviewedCheckpoint,
      tasks: [{
        ...reviewedCheckpoint.tasks[0]!,
        reviewHistory: [
          reviewedCheckpoint.tasks[0]!.reviewHistory[0]!,
          reviewedCheckpoint.tasks[0]!.reviewHistory[0]!,
        ],
      }],
    }), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({
      ...reviewedCheckpoint,
      tasks: [{
        ...reviewedCheckpoint.tasks[0]!,
        reviewHistory: [{
          ...reviewedCheckpoint.tasks[0]!.reviewHistory[0]!,
          attemptId: taskAttemptIdSchema.parse('attempt-missing-review'),
        }],
      }],
    }), 'TEAM_JOURNAL_MALFORMED')
    expect(teamProjectionFromData({
      ...releasedCheckpoint,
      tasks: [{
        ...releasedCheckpoint.tasks[0]!,
        phase: 'cancelled',
        attemptHistory: [{ ...firstAttempt, outcome: { kind: 'cancelled' } }],
      }],
    }).tasks.get(taskId)?.phase).toBe('cancelled')

    const inactivePending = task()
    const inactive = foldTeamRecord(taskBaseTeam(), taskChanged({ task: inactivePending, createdAt: 15 }), 2, teamId)
    const inactiveAssigned = task({ revision: 2, phase: 'assigned', attemptCount: 1, lease })
    failure(() => foldTeamRecord(inactive, taskChanged({ task: inactiveAssigned, createdAt: 16 }), 3, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(projection, rawTaskChanged({
      ...released,
      revision: 7,
      attemptCount: 2,
      attemptHistory: [...released.attemptHistory, settledAttempt({
        id: taskAttemptIdSchema.parse('attempt-b'),
        ordinal: 2,
        assignedAt: 21,
        leaseExpiresAt: 31,
        settledAt: 22,
      })],
    }, 21), 11, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(projection, taskChanged({
      task: task({ ...released, revision: 7, priority: 1 }),
      createdAt: 21,
    }), 11, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(projection, taskChanged({
      task: task({ id: otherTaskId, parentTaskId: otherTaskId }),
      createdAt: 21,
    }), 11, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(projection, taskChanged({
      task: task({ id: otherTaskId, parentTaskId: 'missing-parent' }),
      createdAt: 21,
    }), 11, teamId), 'TEAM_JOURNAL_MALFORMED')
    const child = foldTeamRecord(projection, taskChanged({
      task: task({ id: otherTaskId, parentTaskId: taskId }),
      createdAt: 21,
    }), 11, teamId)
    failure(() => foldTeamRecord(child, taskChanged({
      task: task({ ...released, revision: 7, phase: 'deleted' }),
      createdAt: 22,
    }), 12, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(projection, rawTaskChanged({
      ...released,
      revision: 7,
      attemptHistory: [],
      attemptCount: 0,
    }, 21), 11, teamId), 'TEAM_JOURNAL_MALFORMED')

    const secondLease = taskLease({
      attemptId: taskAttemptIdSchema.parse('attempt-b'),
      assignedRevision: 7,
      ordinal: 2,
      assignedAt: 21,
      renewedAt: 21,
      expiresAt: 31,
    })
    const reassigned = task({ ...released, revision: 7, phase: 'assigned', attemptCount: 2, lease: secondLease })
    projection = foldTeamRecord(projection, taskChanged({ task: reassigned, createdAt: 21 }), 11, teamId)
    failure(() => foldTeamRecord(projection, taskChanged({
      task: task({ ...reassigned, revision: 8, lease: taskLease({ ...secondLease, assignedAt: 22, renewedAt: 22, expiresAt: 32 }) }),
      createdAt: 22,
    }), 12, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(projection, rawTaskChanged({ ...reassigned, revision: 8, phase: 'running' }, 22), 12, teamId), 'TEAM_JOURNAL_MALFORMED')
    const secondStarted = taskLease({ ...secondLease, startedAt: 22 })
    const rerunning = task({ ...reassigned, revision: 8, phase: 'running', lease: secondStarted })
    projection = foldTeamRecord(projection, taskChanged({ task: rerunning, createdAt: 22 }), 12, teamId)
    failure(() => foldTeamRecord(projection, taskChanged({
      task: task({ ...rerunning, revision: 9, lease: taskLease({ ...secondStarted, startedAt: 23 }) }),
      createdAt: 23,
    }), 13, teamId), 'TEAM_JOURNAL_MALFORMED')

    const { lease: _runningLease, ...settleBase } = rerunning
    failure(() => foldTeamRecord(projection, rawTaskChanged({
      ...settleBase,
      revision: 9,
      phase: 'pending',
      attemptHistory: [...rerunning.attemptHistory, {
        id: secondLease.attemptId,
        teamId,
        taskId,
        ordinal: 2,
        participantId,
        assignedAt: 21,
        startedAt: 22,
        leaseExpiresAt: 31,
        settledAt: 30,
        outcome: { kind: 'lease-expired' },
      }],
    }, 30), 13, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(projection, rawTaskChanged(
      {
        ...settleBase,
        revision: 9,
        phase: 'pending',
        attemptHistory: [...rerunning.attemptHistory, {
          id: secondLease.attemptId,
          teamId,
          taskId,
          ordinal: 2,
          participantId,
          assignedAt: 21,
          startedAt: 22,
          leaseExpiresAt: 31,
          settledAt: 31,
          outcome: { kind: 'released' },
        }],
      },
      31,
    ), 13, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(projection, taskChanged({
      task: task({
        ...settleBase,
        revision: 9,
        phase: 'failed',
        attemptHistory: [...rerunning.attemptHistory, settledAttempt({
          id: secondLease.attemptId,
          ordinal: 2,
          assignedAt: 21,
          startedAt: 22,
          leaseExpiresAt: 31,
          settledAt: 24,
          outcome: { kind: 'released' },
        })],
      }),
      createdAt: 24,
    }), 13, teamId), 'TEAM_JOURNAL_MALFORMED')
  })

  it('enforces task capability and activation authority in journal folds and checkpoints', () => {
    const agentLeaseProjection = (capabilities: readonly string[] = ['lint']) => {
      let projection = taskBaseTeam()
      projection = foldTeamRecord(projection, participantChanged({
        participant: participant({ capabilities: [...capabilities] }), createdAt: 12,
      }), 2, teamId)
      projection = foldTeamRecord(projection, participantChanged({
        participant: participant({ capabilities: [...capabilities], phase: 'provisioning' }), createdAt: 13,
      }), 3, teamId)
      projection = foldTeamRecord(projection, participantChanged({
        participant: participant({ capabilities: [...capabilities], phase: 'active' }), createdAt: 14,
      }), 4, teamId)
      const binding = activationBinding()
      projection = foldTeamRecord(projection, { type: 'activation/changed', binding, createdAt: 15 }, 5, teamId)
      const pending = task({ requiredCapabilities: ['lint'] })
      projection = foldTeamRecord(projection, taskChanged({ task: pending, createdAt: 16 }), 6, teamId)
      const lease = taskLease({
        activationId: binding.activation.id,
        assignedAt: 17,
        renewedAt: 17,
        expiresAt: 27,
      })
      const assigned = task({ revision: 2, phase: 'assigned', attemptCount: 1, lease, requiredCapabilities: ['lint'] })
      return { projection, binding, assigned, lease }
    }

    const ineligible = agentLeaseProjection([])
    failure(() => foldTeamRecord(ineligible.projection, taskChanged({ task: ineligible.assigned, createdAt: 17 }), 7, teamId), 'TEAM_JOURNAL_MALFORMED')

    const valid = agentLeaseProjection()
    const assigned = foldTeamRecord(valid.projection, taskChanged({ task: valid.assigned, createdAt: 17 }), 7, teamId)
    failure(() => foldTeamRecord(assigned, taskChanged({
      task: task({ ...valid.assigned, revision: 3, subject: 'Changed while leased' }),
      createdAt: 18,
    }), 8, teamId), 'TEAM_JOURNAL_MALFORMED')
    const offline = foldTeamRecord(assigned, {
      type: 'activation/changed',
      binding: activationBinding({ activation: { ...valid.binding.activation, status: 'offline' } }),
      createdAt: 18,
    }, 8, teamId)
    failure(() => foldTeamRecord(offline, taskChanged({
      task: task({
        ...valid.assigned,
        revision: 3,
        phase: 'running',
        lease: taskLease({ ...valid.lease, startedAt: 19 }),
      }),
      createdAt: 19,
    }), 9, teamId), 'TEAM_JOURNAL_MALFORMED')
    expect(teamProjectionFromData(teamProjectionData(offline)).tasks.get(taskId)?.lease?.activationId)
      .toBe(valid.binding.activation.id)
    const checkpoint = teamProjectionData(offline)
    const lease = checkpoint.tasks[0]?.lease
    if (lease === undefined) throw new Error('checkpoint fixture must retain its lease')
    const { activationId: _activationId, ...leaseWithoutActivation } = lease
    failure(() => teamProjectionFromData({
      ...checkpoint,
      tasks: [{ ...checkpoint.tasks[0]!, lease: leaseWithoutActivation }],
    }), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({
      ...checkpoint,
      tasks: [{ ...checkpoint.tasks[0]!, lease: { ...lease, wakeChannelId: channelIdSchema.parse('unattached-wake-channel') } }],
    }), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({
      ...checkpoint,
      participants: [{ ...checkpoint.participants[0]!, capabilities: [] }],
    }), 'TEAM_JOURNAL_MALFORMED')

    const beforeExpiry = agentLeaseProjection()
    const assignedBeforeExpiry = foldTeamRecord(
      beforeExpiry.projection,
      taskChanged({ task: beforeExpiry.assigned, createdAt: 17 }),
      7,
      teamId,
    )
    failure(() => foldTeamRecord(assignedBeforeExpiry, rawTaskChanged({
      ...beforeExpiry.assigned,
      revision: 3,
      phase: 'running',
      lease: { ...beforeExpiry.lease, startedAt: 27 },
    }, 27), 8, teamId), 'TEAM_JOURNAL_MALFORMED')
  })

  it('rejects checkpoint data with repeated or foreign durable identities', () => {
    const team = foldTeamRecord(taskBaseTeam(), participantChanged(), 2, teamId)
    const withTask = foldTeamRecord(team, taskChanged(), 3, teamId)
    const data = teamProjectionData(foldTeamRecord(withTask, channelAttached(), 4, teamId))

    failure(() => teamProjectionFromData({ ...data, participants: [participant(), participant()] }), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({ ...data, tasks: [task(), task()] }), 'TEAM_JOURNAL_MALFORMED')
    const attached = channelAttached()
    if (attached.type !== 'channel/attached') throw new Error('fixture must create a channel attachment')
    failure(() => teamProjectionFromData({
      ...data,
      channelIds: [attached.channelId, attached.channelId],
    }), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({
      ...data,
      participants: [participant({ teamId: otherTeamId })],
    }), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({
      ...data,
      tasks: [task({ teamId: otherTeamId })],
    }), 'TEAM_JOURNAL_MALFORMED')
  })

  it('folds exact participant interrupts and rejects malformed durable targets', () => {
    const { projection: initial, binding } = interruptProjection()
    const requested = interruptRequested(binding)
    const pending = foldTeamRecord(initial, requested, 6, teamId)
    expect(pending.interrupts.get(requested.interrupt.id)).toEqual(requested.interrupt)
    const acknowledged = interruptAcknowledged(binding)
    const complete = foldTeamRecord(pending, acknowledged, 7, teamId)
    expect(complete.interrupts.get(requested.interrupt.id)).toMatchObject({ acknowledgedAt: acknowledged.createdAt })

    failure(() => foldTeamRecord(initial, interruptRequested(binding, {
      requestedAt: 15,
    }), 6, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(pending, requested, 7, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(initial, interruptRequested(binding, {
      actorId: otherParticipantId,
    }), 6, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(initial, interruptAcknowledged(binding), 6, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(pending, interruptAcknowledged(binding, {
      target: { ...requested.interrupt.target, provider: 'other-provider' },
    }), 7, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(complete, interruptAcknowledged(binding, {
      createdAt: 18,
    }), 8, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(initial, interruptRequested(binding, {
      target: { ...requested.interrupt.target, activationId: activationIdSchema.parse('missing-activation') },
    }), 6, teamId), 'TEAM_JOURNAL_MALFORMED')

    const offline = foldTeamRecord(initial, {
      type: 'activation/changed',
      binding: activationBinding({ activation: { ...binding.activation, status: 'offline' } }),
      createdAt: 16,
    }, 6, teamId)
    failure(() => foldTeamRecord(offline, {
      ...interruptRequested(binding, { requestedAt: 17 }),
      createdAt: 17,
    }, 7, teamId), 'TEAM_JOURNAL_MALFORMED')

    const checkpoint = teamProjectionData(complete)
    expect(teamProjectionFromData(checkpoint).interrupts.get(requested.interrupt.id)).toMatchObject({
      acknowledgedAt: acknowledged.createdAt,
    })
    failure(() => teamProjectionFromData({
      ...checkpoint,
      interrupts: [...checkpoint.interrupts, ...checkpoint.interrupts],
    }), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({
      ...checkpoint,
      interrupts: [{ ...checkpoint.interrupts[0]!, actorId: otherParticipantId }],
    }), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({
      ...checkpoint,
      interrupts: [{
        ...checkpoint.interrupts[0]!,
        target: { ...checkpoint.interrupts[0]!.target, sessionId: SessionId('other-session') },
      }],
    }), 'TEAM_JOURNAL_MALFORMED')
  })

  it('retains an immutable closure fence before full activation quiescence', () => {
    let active = foldTeamRecord(baseTeam(), participantChanged({ createdAt: 12 }), 2, teamId)
    active = foldTeamRecord(active, participantChanged({ participant: participant({ phase: 'provisioning' }), createdAt: 13 }), 3, teamId)
    active = foldTeamRecord(active, participantChanged({ participant: participant({ phase: 'active' }), createdAt: 14 }), 4, teamId)
    const binding = activationBinding({ provider: 'sdk', recovery: sdkRecovery() })
    active = foldTeamRecord(active, { type: 'activation/changed', binding, createdAt: 15 }, 5, teamId)
    const fenced = { ...binding, activation: { ...binding.activation, status: 'stopping' as const }, fencedAt: 18 }
    expect(() => foldTeamRecord(active, { type: 'activation/changed', binding: fenced, createdAt: 18 }, 6, teamId))
      .toThrow('closure-owned fence proof')
    active = foldTeamRecord(active, closureRecord('fail', 16), 6, teamId)
    active = foldTeamRecord(active, { type: 'team/phase', phase: 'quiescing', createdAt: 17 }, 7, teamId)
    const settled = foldTeamRecord(active, { type: 'activation/changed', binding: fenced, createdAt: 18 }, 8, teamId)
    const checkpoint = teamProjectionData(settled)
    expect(teamProjectionFromData(checkpoint).activations.get(binding.activation.id)?.fencedAt).toBe(18)
    for (const fencedAt of [undefined, 19]) {
      expect(() => foldTeamRecord(settled, {
        type: 'activation/changed', binding: { ...fenced, fencedAt }, createdAt: 19,
      }, 9, teamId)).toThrow('immutable binding fields')
    }
    expect(() => foldTeamRecord(active, {
      type: 'activation/changed', binding: { ...fenced, fencedAt: 19 }, createdAt: 18,
    }, 8, teamId)).toThrow('closure-owned fence proof')
    expect(() => teamProjectionFromData({
      ...checkpoint, activations: [{ ...fenced, fencedAt: 19 }],
    })).toThrow('closure-owned fence proof')
  })

  it('folds activation bindings with immutable identity and checkpoint validation', () => {
    let active = foldTeamRecord(baseTeam(), participantChanged({ createdAt: 12 }), 2, teamId)
    active = foldTeamRecord(active, participantChanged({
      participant: participant({ phase: 'provisioning' }),
      createdAt: 13,
    }), 3, teamId)
    active = foldTeamRecord(active, participantChanged({
      participant: participant({ phase: 'active' }),
      createdAt: 14,
    }), 4, teamId)
    const binding = activationBinding({ provider: 'sdk', recovery: sdkRecovery() })
    active = foldTeamRecord(active, {
      type: 'activation/changed', binding, createdAt: 15,
    }, 5, teamId)
    expect(active.activations.get(binding.activation.id)).toEqual(binding)
    active = foldTeamRecord(active, {
      type: 'activation/changed',
      binding: { ...binding, activation: { ...binding.activation, status: 'running' } },
      createdAt: 16,
    }, 6, teamId)
    expect(active.activations.get(binding.activation.id)?.activation.status).toBe('running')
    failure(() => foldTeamRecord(active, {
      type: 'activation/changed',
      binding: {
        ...binding,
        activation: { ...binding.activation, status: 'idle' },
        recovery: sdkRecovery({ profile: 'other-sdk-v1' }),
      },
      createdAt: 17,
    }, 7, teamId), 'TEAM_JOURNAL_MALFORMED')
    const quiesced = {
      ...binding,
      activation: { ...binding.activation, status: 'offline' as const },
      quiescedAt: 17,
      quiescenceSource: 'fenced' as const,
      quiescedWakeChannelIds: [],
    }
    active = foldTeamRecord(active, {
      type: 'activation/changed', binding: quiesced, createdAt: 17,
    }, 7, teamId)
    failure(() => foldTeamRecord(active, {
      type: 'activation/changed',
      binding: { ...quiesced, quiescenceSource: 'quiesced' },
      createdAt: 18,
    }, 8, teamId), 'TEAM_JOURNAL_MALFORMED')
    const resumed = activationBinding({
      activation: {
        ...binding.activation,
        id: activationIdSchema.parse('activation-b'),
        status: 'idle',
      },
    })
    active = foldTeamRecord(active, {
      type: 'activation/changed', binding: resumed, createdAt: 18,
    }, 8, teamId)
    active = foldTeamRecord(active, {
      type: 'activation/changed',
      binding: activationBinding({ activation: { ...resumed.activation, status: 'running' } }),
      createdAt: 19,
    }, 9, teamId)
    expect(active.activations.get(binding.activation.id)?.activation.status).toBe('offline')
    expect(active.activations.get(resumed.activation.id)?.activation.status).toBe('running')

    const checkpoint = teamProjectionData(active)
    const restored = teamProjectionFromData(checkpoint)
    expect(restored.activations.get(binding.activation.id)?.activation.status).toBe('offline')
    expect(restored.activations.get(binding.activation.id)?.recovery).toEqual(binding.recovery)
    expect(restored.activations.get(binding.activation.id)?.quiescenceSource).toBe('fenced')
    expect(restored.activations.get(resumed.activation.id)?.activation.status).toBe('running')
    failure(() => teamProjectionFromData({
      ...checkpoint,
      activations: [...checkpoint.activations, ...checkpoint.activations],
    }), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({
      ...checkpoint,
      activations: [
        checkpoint.activations[1]!,
        {
          ...checkpoint.activations[1]!,
          activation: {
            ...checkpoint.activations[1]!.activation,
            id: activationIdSchema.parse('activation-c'),
            status: 'idle',
          },
        },
      ],
    }), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({
      ...checkpoint,
      activations: [
        checkpoint.activations[0]!,
        {
          ...checkpoint.activations[1]!,
          sessionId: SessionId('other-session'),
        },
      ],
    }), 'TEAM_JOURNAL_MALFORMED')
    failure(() => teamProjectionFromData({
      ...checkpoint,
      activations: [{
        ...checkpoint.activations[0]!,
        activation: { ...checkpoint.activations[0]!.activation, teamId: otherTeamId },
      }],
    }), 'TEAM_JOURNAL_MALFORMED')

    const inactive = baseTeam()
    failure(() => foldTeamRecord(inactive, {
      type: 'activation/changed', binding, createdAt: 12,
    }, 2, teamId), 'TEAM_JOURNAL_MALFORMED')
    const invited = foldTeamRecord(baseTeam(), participantChanged({ createdAt: 12 }), 2, teamId)
    failure(() => foldTeamRecord(invited, {
      type: 'activation/changed', binding, createdAt: 13,
    }, 3, teamId), 'TEAM_JOURNAL_MALFORMED')
    let secondParticipant = foldTeamRecord(active, participantChanged({
      participant: participant({ id: otherParticipantId }),
      createdAt: 20,
    }), 10, teamId)
    secondParticipant = foldTeamRecord(secondParticipant, participantChanged({
      participant: participant({ id: otherParticipantId, phase: 'provisioning' }),
      createdAt: 21,
    }), 11, teamId)
    secondParticipant = foldTeamRecord(secondParticipant, participantChanged({
      participant: participant({ id: otherParticipantId, phase: 'active' }),
      createdAt: 22,
    }), 12, teamId)
    failure(() => foldTeamRecord(secondParticipant, {
      type: 'activation/changed',
      binding: activationBinding({
        activation: { ...resumed.activation, participantId: otherParticipantId, status: 'idle' },
      }),
      createdAt: 23,
    }, 13, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(active, {
      type: 'activation/changed',
      binding: activationBinding({ sessionId: SessionId('other-session'), activation: { ...resumed.activation, status: 'idle' } }),
      createdAt: 20,
    }, 10, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(active, {
      type: 'activation/changed',
      binding: activationBinding({
        activation: { ...resumed.activation, id: activationIdSchema.parse('activation-c'), status: 'idle' },
      }),
      createdAt: 20,
    }, 10, teamId), 'TEAM_JOURNAL_MALFORMED')
    failure(() => foldTeamRecord(active, {
      type: 'activation/changed',
      binding: activationBinding({
        sessionId: SessionId('other-session'),
        activation: { ...resumed.activation, id: activationIdSchema.parse('activation-d'), status: 'idle' },
      }),
      createdAt: 20,
    }, 10, teamId), 'TEAM_JOURNAL_MALFORMED')
    const otherBinding = activationBinding({
      sessionId: SessionId('other-participant-session'),
      activation: {
        ...resumed.activation,
        id: activationIdSchema.parse('activation-other'),
        participantId: otherParticipantId,
        status: 'idle',
      },
    })
    const withOtherActivation = foldTeamRecord(secondParticipant, {
      type: 'activation/changed', binding: otherBinding, createdAt: 23,
    }, 13, teamId)
    expect(withOtherActivation.activations.get(otherBinding.activation.id)).toEqual(otherBinding)
  })
})

describe('channel WAL fold', () => {
  it('replays every record type through an immutable adapter boundary', () => {
    const baseManifest = manifest()
    const probe = adapter()
    let projection = admittedChannel(baseManifest, probe.value)
    projection = foldChannelRecord(projection, channelEnvelopeAt(5), 5, baseManifest.id, probe.value)
    projection = foldChannelRecord(projection, channelReceipt({ sequence: 6, cursor: 5 }), 6, baseManifest.id, probe.value)
    projection = foldChannelRecord(projection, channelAdapter({ sequence: 7 }), 7, baseManifest.id, probe.value)
    projection = foldChannelRecord(projection, channelPhase({ sequence: 8, createdAt: 25, phase: 'closing' }), 8, baseManifest.id, probe.value)
    projection = foldChannelRecord(projection, channelClosed({ sequence: 9, createdAt: 26 }), 9, baseManifest.id, probe.value)

    expect(projection).toMatchObject({ manifest: baseManifest, phase: 'closed', cursor: 9, state: { lastRecord: 'channel/closed' } })
    expect(probe.folds).toEqual([
      'channel/opened', 'channel/phase', 'channel/invitation', 'channel/acknowledged', 'channel/phase',
      'channel/envelope', 'channel/receipt', 'channel/adapter', 'channel/phase', 'channel/closed',
    ])
    expect(probe.frozen).toEqual(expect.arrayContaining([true]))
    expect(probe.frozen.every(Boolean)).toBe(true)
    expect(projection.pendingDeliveries).toEqual(new Map())
    expect(projection.receiptCursors).toEqual(new Map([[participantId, 5]]))
    const checkpoint = channelProjectionData(projection)
    const restored = channelProjectionFromData(checkpoint)
    expect(restored.pendingDeliveries).toEqual(projection.pendingDeliveries)
    expect(restored.receiptCursors).toEqual(projection.receiptCursors)
    expect(restored.postIdempotency).toEqual(projection.postIdempotency)
    expect([
      ...channelAdmissionPrefix(baseManifest, 20, 30),
      channelEnvelopeAt(5),
      channelReceipt({ sequence: 6, cursor: 5 }),
      channelAdapter({ sequence: 7 }),
      channelClosed({ sequence: 8 }),
    ].map(channelRecordCursor)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('derives TTL deadlines into pending state and folds durable delivery expiry', () => {
    const baseManifest = manifest()
    const probe = adapter()
    const active = admittedChannel(baseManifest, probe.value)
    const original = channelEnvelopeAt(5)
    if (original.type !== 'channel/envelope') throw new Error('fixture must create an envelope')
    const accepted = channelEnvelopeAt(5, { envelope: { ...original.envelope, ttlMs: 10 } })
    if (accepted.type !== 'channel/envelope') throw new Error('fixture must create an envelope')
    const pending = foldChannelRecord(active, accepted, 5, baseManifest.id, probe.value)
    expect(pending.pendingDeliveries.get(participantId)?.get(accepted.envelope.id)).toMatchObject({ expiresAt: 32 })
    const checkpoint = channelProjectionData(pending)
    expect(channelProjectionFromData(checkpoint).pendingDeliveries.get(participantId)?.get(accepted.envelope.id))
      .toMatchObject({ expiresAt: 32 })
    const expiry = {
      type: 'channel/delivery-expired' as const,
      sequence: 6,
      createdAt: 32,
      participantId,
      envelopeId: accepted.envelope.id,
      envelopeSequence: accepted.envelope.sequence,
    }
    const expired = foldChannelRecord(pending, expiry, 6, baseManifest.id, probe.value)
    expect(expired.pendingDeliveries).toEqual(new Map())
    expect(probe.folds).toContain('channel/delivery-expired')
  })

  it('retains sender-scoped idempotent post keys through a channel checkpoint', () => {
    const baseManifest = manifest()
    const key = channelPostIdempotencyKeySchema.parse('post-key')
    const probe = adapter()
    const active = admittedChannel(baseManifest, probe.value)
    const accepted = channelEnvelopeAt(5, { idempotencyKey: key })
    if (accepted.type !== 'channel/envelope') throw new Error('fixture must create an envelope')
    const projection = foldChannelRecord(active, accepted, 5, baseManifest.id, probe.value)
    expect(projection.postIdempotency.get(participantId)?.get(key)).toMatchObject({ id: 'envelope-a' })

    const checkpoint = channelProjectionData(projection)
    const restored = channelProjectionFromData(checkpoint)
    expect(restored.postIdempotency).toEqual(projection.postIdempotency)
    const duplicate = channelEnvelope({
      envelope: { ...accepted.envelope, id: 'envelope-b', sequence: 6 },
      idempotencyKey: key,
    })
    failure(() => foldChannelRecord(projection, duplicate, 6, baseManifest.id, probe.value), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => channelProjectionFromData({
      ...checkpoint,
      postIdempotency: [...checkpoint.postIdempotency, ...checkpoint.postIdempotency],
    }), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => channelProjectionFromData({
      ...checkpoint,
      postIdempotency: [...checkpoint.postIdempotency, {
        ...checkpoint.postIdempotency[0]!,
        idempotencyKey: channelPostIdempotencyKeySchema.parse('other-post-key'),
      }],
    }), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => channelProjectionFromData({
      ...checkpoint,
      postIdempotency: [{ ...checkpoint.postIdempotency[0]!, senderId: otherParticipantId }],
    }), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => channelProjectionFromData({
      ...checkpoint,
      postIdempotency: [{
        ...checkpoint.postIdempotency[0]!,
        envelope: { ...checkpoint.postIdempotency[0]!.envelope, sequence: checkpoint.cursor + 1 },
      }],
    }), 'TEAM_CHANNEL_WAL_MALFORMED')
  })

  it('rejects invalid WAL ordering, owner identity, lifecycle, and adapter results', () => {
    const baseManifest = manifest()
    const validAdapter = adapter().value
    failure(() => foldChannelRecord(undefined, channelPhase({ sequence: 0 }), 0, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(undefined, channelOpened({ manifest: baseManifest }), 1, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(undefined, channelOpened({
      manifest: manifest({ id: 'channel-other' }),
    }), 0, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(undefined, channelOpened({
      manifest: manifest({ participants: [{ id: participantId, role: 'reviewer' }, { id: participantId, role: 'observer' }] }),
    }), 0, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(undefined, channelOpened({ manifest: baseManifest }), 0, baseManifest.id, adapter({ failure: 'validate' }).value), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(undefined, channelOpened({ manifest: baseManifest }), 0, baseManifest.id, adapter({ failure: 'initial' }).value), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(undefined, channelOpened({ manifest: baseManifest }), 0, baseManifest.id, adapter({ failure: 'fold' }).value), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(undefined, channelOpened({ manifest: baseManifest }), 0, baseManifest.id, adapter({ nonJson: true }).value), 'TEAM_CHANNEL_WAL_MALFORMED')

    const active = admittedChannel(baseManifest, validAdapter)
    const canonicalEnvelope = channelEnvelopeAt(5)
    if (canonicalEnvelope.type !== 'channel/envelope') throw new Error('fixture must create an envelope')
    failure(() => foldChannelRecord(active, channelEnvelope(), 1, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(active, channelEnvelope({
      envelope: { ...canonicalEnvelope.envelope, sequence: 3 },
    }), 3, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(active, channelOpened({ sequence: 2, manifest: baseManifest }), 2, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(active, channelPhase({ sequence: 2, phase: 'pending' }), 2, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(active, channelEnvelope({
      envelope: { ...canonicalEnvelope.envelope, channelId: 'channel-other' },
    }), 2, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(active, channelEnvelope({
      envelope: { ...canonicalEnvelope.envelope, teamId: otherTeamId },
    }), 2, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(active, channelAdapter({
      sequence: 2,
      adapter: { type: 'other', version: 1 },
    }), 2, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')

    const delivered = foldChannelRecord(active, canonicalEnvelope, 5, baseManifest.id, validAdapter)
    failure(() => foldChannelRecord(delivered, channelReceipt({
      participantId: 'missing-participant',
      cursor: 5,
    }), 6, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(delivered, channelReceipt({
      envelopeId: 'missing-envelope',
      cursor: 5,
    }), 6, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(delivered, channelReceipt({ cursor: 1 }), 6, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    const ttlEnvelope = channelEnvelopeAt(5, { envelope: { ...canonicalEnvelope.envelope, ttlMs: 10 } })
    const ttlPending = foldChannelRecord(active, ttlEnvelope, 5, baseManifest.id, validAdapter)
    failure(() => foldChannelRecord(ttlPending, {
      type: 'channel/delivery-expired', sequence: 6, createdAt: 31, participantId, envelopeId: canonicalEnvelope.envelope.id,
      envelopeSequence: canonicalEnvelope.envelope.sequence,
    }, 6, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(ttlPending, {
      type: 'channel/delivery-expired', sequence: 6, createdAt: 32, participantId: 'missing-participant' as never,
      envelopeId: canonicalEnvelope.envelope.id, envelopeSequence: canonicalEnvelope.envelope.sequence,
    }, 6, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(ttlPending, {
      type: 'channel/delivery-expired', sequence: 6, createdAt: 32, participantId,
      envelopeId: 'missing-envelope' as never, envelopeSequence: canonicalEnvelope.envelope.sequence,
    }, 6, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(active, {
      type: 'channel/delivery-expired', sequence: 5, createdAt: 32, participantId,
      envelopeId: canonicalEnvelope.envelope.id, envelopeSequence: canonicalEnvelope.envelope.sequence,
    }, 5, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => foldChannelRecord(active, channelEnvelopeAt(5, {
      envelope: { ...canonicalEnvelope.envelope, ttlMs: Number.MAX_SAFE_INTEGER },
    }), 5, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    const checkpoint = channelProjectionData(delivered)
    failure(() => channelProjectionFromData({
      ...checkpoint,
      pendingDeliveries: [
        ...checkpoint.pendingDeliveries,
        ...checkpoint.pendingDeliveries,
      ],
    }), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => channelProjectionFromData({
      ...checkpoint,
      pendingDeliveries: [{ ...checkpoint.pendingDeliveries[0]!, participantId: 'missing-participant' as never }],
    }), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => channelProjectionFromData({
      ...checkpoint,
      pendingDeliveries: [{ ...checkpoint.pendingDeliveries[0]!, envelopeSequence: checkpoint.cursor + 1 }],
    }), 'TEAM_CHANNEL_WAL_MALFORMED')
    const laterEnvelope = channelEnvelopeAt(6, {
      envelope: { ...canonicalEnvelope.envelope, id: 'envelope-later' },
    })
    const twoPending = foldChannelRecord(delivered, laterEnvelope, 6, baseManifest.id, validAdapter)
    const twoPendingCheckpoint = channelProjectionData(twoPending)
    expect([...channelProjectionFromData(twoPendingCheckpoint).pendingDeliveries.get(participantId)?.values() ?? []]
      .map(delivery => delivery.envelopeSequence)).toEqual([5, 6])
    failure(() => channelProjectionFromData({
      ...twoPendingCheckpoint,
      pendingDeliveries: [...twoPendingCheckpoint.pendingDeliveries].reverse(),
    }), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => channelProjectionFromData({
      ...checkpoint,
      receiptCursors: [{ participantId: 'missing-participant' as never, cursor: 2 }],
    }), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => channelProjectionFromData({
      ...checkpoint,
      receiptCursors: [{ participantId, cursor: checkpoint.cursor + 1 }],
    }), 'TEAM_CHANNEL_WAL_MALFORMED')
    failure(() => channelProjectionFromData({
      ...checkpoint,
      receiptCursors: [{ participantId, cursor: 2 }, { participantId, cursor: 2 }],
    }), 'TEAM_CHANNEL_WAL_MALFORMED')

    const invalidPlans: readonly unknown[] = [
      null,
      [{}],
      [{ participantId, envelopeId: 'other-envelope', delivery: 'context' }],
      [{ participantId: 'missing-participant', envelopeId: 'envelope-a', delivery: 'context' }],
      [
        { participantId, envelopeId: 'envelope-a', delivery: 'context' },
        { participantId, envelopeId: 'envelope-a', delivery: 'context' },
      ],
    ]
    for (const plan of invalidPlans) {
      const planAdapter: TeamChannelAdapter = {
        ...adapter().value,
        deliveryPlan() { return plan as never },
      }
      failure(() => foldChannelRecord(active, channelEnvelope(), 2, baseManifest.id, planAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
    }
    const repeated = foldChannelRecord(active, canonicalEnvelope, 5, baseManifest.id, validAdapter)
    const duplicateEnvelope = channelEnvelope()
    if (duplicateEnvelope.type !== 'channel/envelope') throw new Error('fixture must create an envelope')
    failure(() => foldChannelRecord(repeated, channelEnvelope({
      envelope: { ...duplicateEnvelope.envelope, sequence: 6 },
    }), 6, baseManifest.id, validAdapter), 'TEAM_CHANNEL_WAL_MALFORMED')
  })
})
