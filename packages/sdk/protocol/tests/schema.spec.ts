import {
  activationDisposeParamsSchema,
  activationDisposeResultSchema,
  activationInterruptParamsSchema,
  activationInterruptResultSchema,
  activationLinkEnrollParamsSchema,
  activationLinkEnrollResultSchema,
  activationOpenParamsSchema,
  activationOpenResultSchema,
  activationStatusNotificationSchema,
  activationStatusParamsSchema,
  activationStatusResultSchema,
  initializeParamsSchema,
  initializeResultSchema,
  sdkActivationInterruptCauseSchema,
  sdkActivationSeedSchema,
  sdkActivationStateSchema,
  sdkActivationStatusSchema,
  sdkActivationTargetSchema,
  sdkTeamLinkBindingSchema,
  sdkTeamLinkEnrollmentSchema,
  shutdownParamsSchema,
  teamArchiveParamsSchema,
  teamArchiveResultSchema,
  teamResumeParamsSchema,
  teamCancelParamsSchema,
  teamCancelResultSchema,
  teamCreateParamsSchema,
  teamCreateResultSchema,
  teamWaitFinalParamsSchema,
  teamWaitFinalResultSchema,
  teamListParamsSchema,
  teamListResultSchema,
  teamGoalUpdateParamsSchema,
  teamGoalTransitionParamsSchema,
  teamMemberListParamsSchema,
  teamMemberListResultSchema,
  teamChannelReadParamsSchema,
  teamChannelReadResultSchema,
  teamTaskListParamsSchema,
  teamTaskListResultSchema,
  teamTaskCreateParamsSchema,
  teamTaskReviewParamsSchema,
  teamArtifactReadParamsSchema,
  teamArtifactReadResultSchema,
} from '../src/index.ts'
import { describe, expect, it } from 'vitest'

const target = {
  activationId: 'activation-schema',
  teamId: 'team-schema',
  participantId: 'participant-schema',
  sessionId: 'session-schema',
}

const state = { ...target, status: 'idle' as const, statusSequence: 3 }

describe('SDK protocol wire schemas', () => {
  it('parses strict bootstrap and product-Team frames while retaining extension block fields', () => {
    expect(initializeParamsSchema.parse({ credential: 'sdk-secret', cwd: '/workspace', provider: 'provider', model: 'model' }))
      .toEqual({ credential: 'sdk-secret', cwd: '/workspace', provider: 'provider', model: 'model' })
    expect(initializeParamsSchema.parse({ credential: 'sdk-secret', cwd: '/workspace', provider: 'provider', model: 'model', maxTokens: 1 }))
      .toMatchObject({ maxTokens: 1 })
    expect(initializeResultSchema.parse({ serverInfo: { name: 'clocky-sdk-runtime', version: '0.0.1' } }))
      .toEqual({ serverInfo: { name: 'clocky-sdk-runtime', version: '0.0.1' } })
    expect(teamCreateParamsSchema.parse({
      objective: 'Review the change.',
      contentBlocks: [{ type: 'plugin-block', payload: { value: true } }],
    })).toMatchObject({ contentBlocks: [{ type: 'plugin-block', payload: { value: true } }] })
    expect(teamCreateResultSchema.parse({
      teamId: 'team', coordinatorSessionId: 'coordinator-session', envelopeId: 'envelope',
    })).toEqual({ teamId: 'team', coordinatorSessionId: 'coordinator-session', envelopeId: 'envelope' })
    expect(teamWaitFinalParamsSchema.parse({ teamId: 'team' })).toEqual({ teamId: 'team' })
    expect(teamWaitFinalResultSchema.parse({
      teamId: 'team', channelId: 'channel', envelopeId: 'final-envelope', text: 'Done.',
    })).toEqual({ teamId: 'team', channelId: 'channel', envelopeId: 'final-envelope', text: 'Done.' })
    expect(teamCancelParamsSchema.parse({ teamId: 'team' })).toEqual({ teamId: 'team' })
    expect(teamCancelResultSchema.parse({ phase: 'cancelled' })).toEqual({ phase: 'cancelled' })
    expect(teamResumeParamsSchema.parse({ teamId: 'team', expectedCursor: 2 })).toEqual({ teamId: 'team', expectedCursor: 2 })
    expect(teamArchiveParamsSchema.parse({ teamId: 'team', expectedCursor: 3 })).toEqual({ teamId: 'team', expectedCursor: 3 })
    expect(teamArchiveResultSchema.parse({ teamId: 'team', archivedAt: 7 })).toEqual({ teamId: 'team', archivedAt: 7 })
    expect(teamListParamsSchema.parse({ afterCursor: -1, limit: 2 })).toEqual({ afterCursor: -1, limit: 2 })
    expect(teamListResultSchema.parse({ items: [], scanned: 1, nextCursor: 'scan-next' }))
      .toEqual({ items: [], scanned: 1, nextCursor: 'scan-next' })
    expect(teamListParamsSchema.safeParse({ afterCursor: 0 }).success).toBe(false)
    expect(teamListResultSchema.safeParse({ items: [], scanned: 0, nextCursor: 'scan-next' }).success).toBe(false)
    expect(teamGoalUpdateParamsSchema.parse({
      teamId: 'team', expectedRevision: 1, objective: 'Update the objective.', budgets: { turns: 4 },
    })).toMatchObject({ objective: 'Update the objective.', budgets: { turns: 4 } })
    expect(teamGoalTransitionParamsSchema.parse({
      teamId: 'team', expectedRevision: 2, phase: 'blocked', blocker: { code: 'external', message: 'Waiting on approval.' },
    })).toMatchObject({ phase: 'blocked', blocker: { code: 'external' } })
    expect(teamMemberListParamsSchema.parse({ teamId: 'team', afterCursor: -1, limit: 2 }))
      .toEqual({ teamId: 'team', afterCursor: -1, limit: 2 })
    expect(teamMemberListResultSchema.parse({ items: [], nextCursor: 0 })).toEqual({ items: [], nextCursor: 0 })
    expect(teamTaskListParamsSchema.parse({ teamId: 'team', afterCursor: -1, limit: 2 }))
      .toEqual({ teamId: 'team', afterCursor: -1, limit: 2 })
    expect(teamTaskListResultSchema.parse({ items: [], nextCursor: 0 })).toEqual({ items: [], nextCursor: 0 })
    expect(teamArtifactReadParamsSchema.parse({ teamId: 'team', artifactId: 'artifact' }))
      .toEqual({ teamId: 'team', artifactId: 'artifact' })
    expect(teamArtifactReadResultSchema.parse({
      artifact: { id: 'artifact', provider: 'local', kind: 'report', uri: 'artifact://report', visibility: 'team' },
      bytes: 4,
      data: 'dGVzdA==',
    })).toMatchObject({ bytes: 4, data: 'dGVzdA==' })
    expect(teamTaskCreateParamsSchema.parse({
      teamId: 'team', expectedCursor: 1, idempotencyKey: 'sdk-schema-task-create', subject: 'Integrate', description: 'Apply the source change.', blockedBy: [],
      requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'worktree', budget: {},
      integration: {
        sourceTaskId: 'source-task', sourceAttemptId: 'source-attempt', provider: 'worktree', target: 'main',
        expectedTarget: 'base-commit', mode: 'integrate',
      },
      reviewPolicy: { kind: 'none' }, maxAttempts: 1,
    })).toMatchObject({ integration: { sourceTaskId: 'source-task', expectedTarget: 'base-commit' } })
    expect(teamTaskCreateParamsSchema.safeParse({
      teamId: 'team', expectedCursor: 1, subject: 'Task', description: 'Do the task.', blockedBy: [], requiredCapabilities: [],
      priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
    }).success).toBe(false)
    expect(teamTaskReviewParamsSchema.safeParse({
      teamId: 'team', taskId: 'task', expectedRevision: 1, participantId: 'reviewer', decision: 'accepted', reason: 'Looks good.',
    }).success).toBe(false)
    expect(teamChannelReadParamsSchema.parse({ channelId: 'channel', afterCursor: -1, limit: 2 }))
      .toEqual({ channelId: 'channel', afterCursor: -1, limit: 2 })
    expect(teamChannelReadResultSchema.parse({
      value: {
        channel: {
          manifest: { id: 'channel', teamId: 'team', adapter: { type: 'direct', version: 1 }, participants: [], limits: {} },
          phase: 'active', cursor: 0,
        },
        records: [],
        nextCursor: 0,
      },
    })).toMatchObject({ value: { nextCursor: 0 } })
    expect(shutdownParamsSchema.parse({})).toEqual({})

    for (const value of [
      { cwd: '', provider: 'provider', model: 'model', credential: 'sdk-secret' },
      { cwd: '/workspace', provider: 'provider', model: 'model' },
      { cwd: '/workspace', provider: 'provider', model: 'model', credential: '', maxTokens: 1 },
      { cwd: '/workspace', provider: 'provider', model: 'model', credential: 'sdk-secret', maxTokens: 0 },
      { cwd: '/workspace', provider: 'provider', model: 'model', credential: 'sdk-secret', other: true },
    ]) expect(initializeParamsSchema.safeParse(value).success).toBe(false)
    expect(teamCreateParamsSchema.safeParse({ objective: '', contentBlocks: [{ type: 'text', text: 'x' }] }).success).toBe(false)
    expect(teamCreateParamsSchema.safeParse({ objective: 'Team', contentBlocks: [] }).success).toBe(false)
    expect(teamCreateParamsSchema.safeParse({ objective: 'Team', contentBlocks: [{}] }).success).toBe(false)
    expect(teamWaitFinalParamsSchema.safeParse({ teamId: 'team', extra: true }).success).toBe(false)
    expect(teamWaitFinalResultSchema.safeParse({ teamId: 'team', channelId: 'channel', envelopeId: 'envelope', text: '' }).success).toBe(false)
    expect(teamCancelParamsSchema.safeParse({ teamId: '' }).success).toBe(false)
    expect(teamResumeParamsSchema.safeParse({ teamId: 'team' }).success).toBe(false)
    expect(teamResumeParamsSchema.safeParse({ teamId: 'team', expectedCursor: 2, actor: {} }).success).toBe(false)
    expect(teamArchiveParamsSchema.safeParse({ teamId: 'team' }).success).toBe(false)
    expect(teamArchiveParamsSchema.safeParse({ teamId: 'team', expectedCursor: 3, actor: {} }).success).toBe(false)
    expect(teamArchiveParamsSchema.safeParse({ teamId: 'team', expectedCursor: 3, principal: 'forged' }).success).toBe(false)
    expect(teamArchiveParamsSchema.safeParse({ teamId: 'team', expectedCursor: 3, proof: {} }).success).toBe(false)
    expect(teamArchiveParamsSchema.safeParse({ teamId: 'team', expectedCursor: 3, credential: 'sdk-secret' }).success).toBe(false)
    expect(teamGoalUpdateParamsSchema.safeParse({
      teamId: 'team', expectedRevision: 1, objective: 'Forged.', actor: 'forged',
    }).success).toBe(false)
    expect(teamGoalTransitionParamsSchema.safeParse({
      teamId: 'team', expectedRevision: 1, phase: 'paused', principal: 'forged',
    }).success).toBe(false)
    expect(teamArchiveResultSchema.safeParse({ teamId: 'team', archivedAt: -1 }).success).toBe(false)
    expect(teamListParamsSchema.safeParse({ afterCursor: -1, limit: 0 }).success).toBe(false)
    expect(teamMemberListParamsSchema.safeParse({ teamId: 'team', afterCursor: -1, limit: 0 }).success).toBe(false)
    expect(teamTaskListParamsSchema.safeParse({ teamId: 'team', afterCursor: -1, limit: 0 }).success).toBe(false)
    expect(teamArtifactReadParamsSchema.safeParse({ teamId: 'team', artifactId: '' }).success).toBe(false)
    expect(teamArtifactReadResultSchema.safeParse({
      artifact: { id: 'artifact', kind: 'report', uri: 'artifact://report', visibility: 'team' },
      bytes: -1,
      data: 'dGVzdA==',
    }).success).toBe(false)
    expect(teamChannelReadParamsSchema.safeParse({ channelId: 'channel', afterCursor: -1, limit: 0 }).success).toBe(false)
    expect(shutdownParamsSchema.safeParse({ unexpected: true }).success).toBe(false)
  })

  it('parses each closed activation request, result, state, and notification form', () => {
    expect(sdkActivationTargetSchema.parse(target)).toEqual(target)
    expect(sdkActivationSeedSchema.parse({ kind: 'fresh' })).toEqual({ kind: 'fresh' })
    expect(sdkActivationSeedSchema.parse({ kind: 'resume' })).toEqual({ kind: 'resume' })
    for (const status of ['starting', 'running', 'idle', 'stopping', 'offline']) {
      expect(sdkActivationStatusSchema.parse(status)).toBe(status)
    }
    expect(sdkActivationStateSchema.parse(state)).toEqual(state)

    expect(activationOpenParamsSchema.parse({ target, seed: { kind: 'fresh' } })).toEqual({ target, seed: { kind: 'fresh' } })
    expect(activationOpenResultSchema.parse({ state })).toEqual({ state })
    const binding = { ...target, provider: 'sdk' }
    const enrollment = { provider: 'websocket', endpoint: 'wss://team.example.test/team-link', capability: 'opaque-capability' }
    expect(sdkTeamLinkBindingSchema.parse(binding)).toEqual(binding)
    expect(sdkTeamLinkEnrollmentSchema.parse(enrollment)).toEqual(enrollment)
    expect(activationLinkEnrollParamsSchema.parse({ target, binding, enrollment })).toEqual({ target, binding, enrollment })
    expect(activationLinkEnrollResultSchema.parse({})).toEqual({})
    expect(activationStatusParamsSchema.parse({ target })).toEqual({ target })
    expect(activationStatusResultSchema.parse({ state })).toEqual({ state })
    expect(activationDisposeParamsSchema.parse({ target })).toEqual({ target })
    expect(activationDisposeResultSchema.parse({ state })).toEqual({ state })
    expect(activationStatusNotificationSchema.parse({ state })).toEqual({ state })
    expect(activationInterruptParamsSchema.parse({ target, cause: { kind: 'user' } })).toEqual({ target, cause: { kind: 'user' } })
    expect(activationInterruptResultSchema.parse({})).toEqual({})
    expect(sdkActivationInterruptCauseSchema.parse({ kind: 'parent' })).toEqual({ kind: 'parent' })
    expect(sdkActivationInterruptCauseSchema.parse({ kind: 'hook', reason: 'reason' })).toEqual({ kind: 'hook', reason: 'reason' })
    expect(sdkActivationInterruptCauseSchema.parse({ kind: 'disposed' })).toEqual({ kind: 'disposed' })
  })

  it('rejects crossed, empty, extra, and non-monotonic activation frame fields', () => {
    const invalid = [
      { ...target, activationId: '' },
      { ...state, status: 'unknown' },
      { ...state, statusSequence: -1 },
      { target: { ...target, extra: true }, seed: { kind: 'fresh' } },
      { target, seed: { kind: 'fork' } },
      { target, cause: { kind: 'hook', reason: '' } },
      { target, binding: { ...target, provider: '' }, enrollment: { provider: 'websocket', endpoint: 'wss://team.example.test/team-link', capability: 'opaque' } },
      { target, binding: { ...target, provider: 'sdk' }, enrollment: { provider: 'websocket', endpoint: '', capability: 'opaque' } },
      { state, unexpected: true },
    ]
    expect(sdkActivationTargetSchema.safeParse(invalid[0]).success).toBe(false)
    expect(sdkActivationStateSchema.safeParse(invalid[1]).success).toBe(false)
    expect(sdkActivationStateSchema.safeParse(invalid[2]).success).toBe(false)
    expect(activationOpenParamsSchema.safeParse(invalid[3]).success).toBe(false)
    expect(activationOpenParamsSchema.safeParse(invalid[4]).success).toBe(false)
    expect(activationInterruptParamsSchema.safeParse(invalid[5]).success).toBe(false)
    expect(activationStatusNotificationSchema.safeParse(invalid[6]).success).toBe(false)
    expect(activationLinkEnrollParamsSchema.safeParse(invalid[7]).success).toBe(false)
    expect(activationLinkEnrollParamsSchema.safeParse(invalid[8]).success).toBe(false)
  })
})
