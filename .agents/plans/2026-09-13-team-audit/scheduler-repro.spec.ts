import { recordEnvelope } from '/Volumes/projects-mac/deepseek-harness/packages/core/team/tests/channel-envelope-record.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { Context } from '@clocky/cordis'
import { openTestChannel } from '/Volumes/projects-mac/deepseek-harness/packages/core/team/tests/channel-lifecycle-authority.ts'
import {
  TASK_ASSIGNMENT_ASSIGNEE_ROLE,
  TASK_ASSIGNMENT_CHANNEL_ADAPTER,
  TASK_ASSIGNMENT_ENVELOPE_KIND,
} from '@clocky/clocky-team-channel-task-assignment'
import {
  CONSULT_CHANNEL_ADAPTER_V1,
  CONSULT_INITIATOR_ROLE,
  CONSULT_RESPONDENT_ROLE,
  CONSULT_RESPONSE_KIND,
  CONSULT_REVIEW_REQUEST_KIND,
} from '@clocky/clocky-team-channel-basic'
import {
  TeamError,
  activationBindingSnapshotSchema,
  activationIdSchema,
  channelIdSchema,
  channelSnapshotSchema,
  participantIdSchema,
  participantSnapshotSchema,
  taskAttemptIdSchema,
  taskAttemptSnapshotSchema,
  taskLeaseSnapshotSchema,
  teamClosureIdempotencyKeySchema,
  teamEventSchema,
  teamIdSchema,
  teamEnvelopeSchema,
  teamStateSnapshotSchema,
  teamTaskIdSchema,
  teamTaskSnapshotSchema,
} from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ChannelDeliveryExpiredRecord,
  ChannelDeliveryExpireResult,
  SchedulerChannelDeliveryExpireRequest,
  ChannelEnvelopePostRequest,
  ChannelCloseRequest,
  ChannelOpenRequest,
  SchedulerReviewChannelOpenRequest,
  SchedulerWakeChannelOpenRequest,
  SchedulerFailedWakeChannelCloseRequest,
  ChannelRecord,
  ChannelReadResult,
  ChannelReadPageResult,
  ChannelSnapshot,
  TeamChannelCompactRequest,
  TeamChannelCompactResult,
  TeamJournalCompactRequest,
  TeamJournalCompactResult,
  TeamPhaseTransitionRequest,
  ParticipantSnapshot,
  TeamEvent,
  TeamSnapshot,
  TeamStateSnapshot,
  TeamTaskAssignRequest,
  TeamTaskAttemptExpireRequest,
  TeamTaskReviewRecoverRequest,
  TeamTaskSnapshot,
  TeamTaskWorkspaceMode,
  TeamEnvelope,
  TeamSystemEnvelopePostProofSource,
  TeamSystemMaintenanceProofSource,
  TeamSystemMaintenanceScope,
  TeamSystemPhaseProofSource,
  TeamSystemPhaseScope,
  TeamSystemTaskReviewScope,
  TeamSystemTaskReviewProofSource,
  TeamSystemTaskLeaseProofSource,
  TeamSystemTaskLeaseProof,
  TeamSystemTaskLeaseScope,
  TeamSystemChannelLifecycleProofSource,
  TeamSystemSchedulerChannelProof,
  TeamSystemSchedulerChannelProofSource,
  TeamSystemSchedulerChannelScope,
} from '@clocky/clocky-team'
import type { TeamWorkspaceEligibilityRequest } from '@clocky/clocky-team-workspace'
import {
  TeamDagScheduler,
  apply,
} from '/Volumes/projects-mac/deepseek-harness/packages/team/team-scheduler-dag/src/index.ts'
import type {
  Config,
  TeamTaskAssignmentNotice,
} from '/Volumes/projects-mac/deepseek-harness/packages/team/team-scheduler-dag/src/index.ts'

const teamId = teamIdSchema.parse('team-scheduler')

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** Return an explicit initial scheduler configuration with test-local overrides. */
function config(overrides: Partial<Config> = {}): Config {
  return {
    leaseDurationMs: 100,
    maxAssignmentsPerDrive: 2,
    maxExpirationsPerDrive: 2,
    maxWakeDispatchesPerDrive: 2,
    maxConflictsPerDrive: 2,
    maxActiveAttemptsPerParticipant: 1,
    permittedWorkspaceModes: ['shared'],
    disposalTimeoutMs: 100,
    ...overrides,
  }
}

/** Build one active Team participant. */
function participant(
  id: string,
  overrides: Record<string, unknown> = {},
): ParticipantSnapshot {
  return participantSnapshotSchema.parse({
    id: participantIdSchema.parse(id),
    teamId,
    kind: 'local-agent',
    displayName: id,
    role: 'worker',
    capabilities: [],
    phase: 'active',
    ...overrides,
  })
}

/** Build one exact idle activation for an active participant. */
function activation(
  owner: ParticipantSnapshot,
  overrides: Record<string, unknown> = {},
): ActivationBindingSnapshot {
  return activationBindingSnapshotSchema.parse({
    activation: {
      id: activationIdSchema.parse(`activation-${owner.id}`),
      teamId,
      participantId: owner.id,
      status: 'idle',
    },
    sessionId: `session-${owner.id}`,
    provider: 'test',
    ...overrides,
  })
}

/** Build one current lease whose default deadline is after the test clock's zero origin. */
function lease(
  id: string,
  owner: ParticipantSnapshot,
  activationId: ActivationBindingSnapshot['activation']['id'],
  overrides: Record<string, unknown> = {},
) {
  const assignedAt = Date.now()
  return taskLeaseSnapshotSchema.parse({
    attemptId: taskAttemptIdSchema.parse(`attempt-${id}`),
    assignedRevision: 1,
    ordinal: 1,
    participantId: owner.id,
    activationId,
    assignedAt,
    durationMs: 100_000,
    renewedAt: assignedAt,
    expiresAt: assignedAt + 100_000,
    ...overrides,
  })
}

/** Build one valid Team task with a caller-selected task identity. */
function task(id: string, overrides: Record<string, unknown> = {}): TeamTaskSnapshot {
  return teamTaskSnapshotSchema.parse({
    id: teamTaskIdSchema.parse(id),
    teamId,
    revision: 1,
    createCommand: {
      creator: {
        teamId,
        participantId: participantIdSchema.parse('participant-scheduler-coordinator'),
        activationId: activationIdSchema.parse('activation-scheduler-coordinator'),
        sessionId: 'session-scheduler-coordinator',
        provider: 'test',
      },
      idempotencyKey: `task-create-scheduler:${id}`,
    },
    subject: id,
    description: `Execute ${id}.`,
    execution: { kind: 'participant' },
    phase: 'pending',
    blockedBy: [],
    requiredCapabilities: [],
    priority: 0,
    readScopes: [],
    writeScopes: [],
    workspaceMode: 'shared',
    budget: {},
    reviewPolicy: { kind: 'none' },
    reviewHistory: [],
    maxAttempts: 3,
    attemptCount: 0,
    attemptHistory: [],
    ...overrides,
  })
}

/** Build one valid full Team projection in first-record task order. */
function state(
  tasks: readonly TeamTaskSnapshot[],
  participants: readonly ParticipantSnapshot[],
  activations: readonly ActivationBindingSnapshot[],
  overrides: Record<string, unknown> = {},
): TeamStateSnapshot {
  return teamStateSnapshotSchema.parse({
    team: {
      id: teamId,
      depth: 0,
      maxTeamDepth: 0,
      goal: { teamId, revision: 1, objective: 'Schedule durable Team work.', phase: 'active', budgets: {} },
      phase: 'active',
      cursor: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    goal: { teamId, revision: 1, objective: 'Schedule durable Team work.', phase: 'active', budgets: {} },
    budgets: {},
    participants,
    activations,
    tasks,
    workspaceAllocations: [],
    channelIds: [],
    ...overrides,
    rules: { taskRanking: { name: 'outcome-latency', version: 1, latencyUpperBoundsMs: [100, 1000],
      costRateUpperBounds: [0, 1, 10], missingCost: 'unknown-last' }, ...(overrides.rules as Record<string, unknown> | undefined) },
  })
}

interface FakeTeams {
  readonly registerSystemEnvelopePostProofSource: Mock<(source: TeamSystemEnvelopePostProofSource) => () => void>
  readonly registerSystemMaintenanceProofSource: Mock<(source: TeamSystemMaintenanceProofSource) => () => void>
  readonly registerSystemPhaseProofSource: Mock<(source: TeamSystemPhaseProofSource) => () => void>
  readonly registerSystemTaskReviewProofSource: Mock<(source: TeamSystemTaskReviewProofSource) => () => void>
  readonly registerSystemTaskLeaseProofSource: Mock<(source: TeamSystemTaskLeaseProofSource) => () => void>
  readonly registerSystemChannelLifecycleProofSource: Mock<(source: TeamSystemChannelLifecycleProofSource) => () => void>
  readonly registerSystemSchedulerChannelProofSource: Mock<(source: TeamSystemSchedulerChannelProofSource) => () => void>
  readonly listTeamsPage: Mock<(
    request: { readonly afterCursor: number; readonly limit: number },
  ) => Promise<{
    readonly items: readonly TeamSnapshot[]
    readonly nextCursor?: number
  }>>
  readonly getTeam: Mock<(request: { readonly teamId: TeamStateSnapshot['team']['id'] }) => Promise<TeamStateSnapshot>>
  readonly transitionTeamPhase: Mock<(request: TeamPhaseTransitionRequest) => Promise<TeamStateSnapshot>>
  readonly compactTeam: Mock<(request: TeamJournalCompactRequest) => Promise<TeamJournalCompactResult>>
  readonly assignTask: Mock<(request: TeamTaskAssignRequest) => Promise<TeamTaskSnapshot>>
  readonly expireTaskAttempt: Mock<(request: TeamTaskAttemptExpireRequest) => Promise<TeamTaskSnapshot>>
  readonly expireSchedulerChannelDeliveries: Mock<(request: SchedulerChannelDeliveryExpireRequest) => Promise<ChannelDeliveryExpireResult>>
  readonly openChannel: Mock<(request: ChannelOpenRequest) => Promise<ChannelSnapshot>>
  readonly openSchedulerReviewChannel: Mock<(request: SchedulerReviewChannelOpenRequest) => Promise<ChannelSnapshot>>
  readonly openSchedulerWakeChannel: Mock<(request: SchedulerWakeChannelOpenRequest) => Promise<ChannelSnapshot>>
  readonly closeChannel: Mock<(request: ChannelCloseRequest) => Promise<ChannelSnapshot>>
  readonly closeSchedulerFailedWakeChannel: Mock<(request: SchedulerFailedWakeChannelCloseRequest) => Promise<ChannelSnapshot>>
  readonly getChannel: Mock<(request: { readonly channelId: ChannelSnapshot['manifest']['id'] }) => Promise<ChannelSnapshot>>
  readonly compactChannel: Mock<(request: TeamChannelCompactRequest) => Promise<TeamChannelCompactResult>>
  readonly readChannel: Mock<(request: {
    readonly channelId: ChannelSnapshot['manifest']['id']
    readonly afterCursor: number
  }) => Promise<ChannelReadResult>>
  readonly readChannelPage: Mock<(request: {
    readonly channelId: ChannelSnapshot['manifest']['id']
    readonly afterCursor: number
    readonly limit: number
  }) => Promise<ChannelReadPageResult>>
  readonly postChannelEnvelope: Mock<(request: ChannelEnvelopePostRequest) => Promise<ReturnType<typeof teamEnvelopeSchema.parse>>>
  readonly resolveTaskReviewFromResponse: Mock<(request: TeamTaskReviewRecoverRequest) => Promise<TeamTaskSnapshot>>
}

interface FakeChannel {
  snapshot: ChannelSnapshot
  readonly records: ChannelRecord[]
}

interface FakeWorkspaces {
  readonly eligible: Mock<(
    mode: TeamTaskWorkspaceMode,
    request: TeamWorkspaceEligibilityRequest,
  ) => Promise<boolean>>
}

interface FakeHarness {
  readonly ctx: Context
  readonly teams: FakeTeams
  readonly workspaces: FakeWorkspaces
  readonly on: ReturnType<typeof vi.fn>
  readonly warnings: ReturnType<typeof vi.fn>
  readonly callbacks: Map<string, Array<(event: TeamEvent) => void>>
  readonly assignmentListeners: Array<(...args: unknown[]) => unknown>
  readonly maintenanceScopes: TeamSystemMaintenanceScope[]
  readonly phaseScopes: TeamSystemPhaseScope[]
  readonly taskLeaseScopes: TeamSystemTaskLeaseScope[]
  readonly schedulerChannelScopes: TeamSystemSchedulerChannelScope[]
  readonly channels: Map<ChannelSnapshot['manifest']['id'], FakeChannel>
  taskLeaseSource(): TeamSystemTaskLeaseProofSource | undefined
  getState(): TeamStateSnapshot
  setState(next: TeamStateSnapshot): void
  emit(event: TeamEvent): void
}

/** Build a fake Team provider that applies successful assignment and expiry CAS operations. */
function setup(initial: TeamStateSnapshot): FakeHarness {
  let current = initial
  let channelNumber = 0
  let envelopeNumber = 0
  const callbacks = new Map<string, Array<(event: TeamEvent) => void>>()
  const assignmentListeners: Array<(...args: unknown[]) => unknown> = []
  const channels = new Map<ChannelSnapshot['manifest']['id'], FakeChannel>()
  const warnings = vi.fn()
  let envelopePostSource: TeamSystemEnvelopePostProofSource | undefined
  let maintenanceSource: TeamSystemMaintenanceProofSource | undefined
  let phaseSource: TeamSystemPhaseProofSource | undefined
  let taskReviewSource: TeamSystemTaskReviewProofSource | undefined
  let taskLeaseSource: TeamSystemTaskLeaseProofSource | undefined
  let channelLifecycleSource: TeamSystemChannelLifecycleProofSource | undefined
  let schedulerChannelSource: TeamSystemSchedulerChannelProofSource | undefined
  const maintenanceScopes: TeamSystemMaintenanceScope[] = []
  const phaseScopes: TeamSystemPhaseScope[] = []
  const taskLeaseScopes: TeamSystemTaskLeaseScope[] = []
  const schedulerChannelScopes: TeamSystemSchedulerChannelScope[] = []
  const workspaces: FakeWorkspaces = {
    eligible: vi.fn(async () => true),
  }
  const teams: FakeTeams = {
    registerSystemEnvelopePostProofSource: vi.fn((source: TeamSystemEnvelopePostProofSource) => {
      envelopePostSource = source
      return () => {
        if (envelopePostSource === source) envelopePostSource = undefined
      }
    }),
    registerSystemMaintenanceProofSource: vi.fn((source: TeamSystemMaintenanceProofSource) => {
      maintenanceSource = source
      return () => {
        if (maintenanceSource === source) maintenanceSource = undefined
      }
    }),
    registerSystemPhaseProofSource: vi.fn((source: TeamSystemPhaseProofSource) => {
      phaseSource = source
      return () => {
        if (phaseSource === source) phaseSource = undefined
      }
    }),
    registerSystemTaskReviewProofSource: vi.fn((source: TeamSystemTaskReviewProofSource) => {
      taskReviewSource = source
      return () => {
        if (taskReviewSource === source) taskReviewSource = undefined
      }
    }),
    registerSystemTaskLeaseProofSource: vi.fn((source: TeamSystemTaskLeaseProofSource) => {
      taskLeaseSource = source
      return () => {
        if (taskLeaseSource === source) taskLeaseSource = undefined
      }
    }),
    registerSystemChannelLifecycleProofSource: vi.fn((source: TeamSystemChannelLifecycleProofSource) => {
      channelLifecycleSource = source
      return () => {
        if (channelLifecycleSource === source) channelLifecycleSource = undefined
      }
    }),
    registerSystemSchedulerChannelProofSource: vi.fn((source: TeamSystemSchedulerChannelProofSource) => {
      schedulerChannelSource = source
      return () => {
        if (schedulerChannelSource === source) schedulerChannelSource = undefined
      }
    }),
    listTeamsPage: vi.fn(async ({ afterCursor }) => afterCursor === -1 ? { items: [current.team] } : { items: [] }),
    getTeam: vi.fn(async () => current),
    transitionTeamPhase: vi.fn(async (input) => {
      const scope = phaseSource?.resolvePhaseProof(input.actor)
      if (scope === undefined
        || scope.kind !== 'scheduler-stall'
        || scope.teamId !== input.teamId
        || scope.phase !== input.phase
        || JSON.stringify(scope.reason) !== JSON.stringify(input.reason)) {
        throw new TeamError('scheduler stall proof is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
      }
      phaseScopes.push(scope)
      const { stallReason: _priorStallReason, ...team } = current.team
      current = state(current.tasks, current.participants, current.activations, {
        team: {
          ...team,
          phase: input.phase,
          ...input.reason === undefined ? {} : { stallReason: input.reason },
          cursor: current.team.cursor + 1,
          updatedAt: current.team.updatedAt + 1,
        },
        goal: current.goal,
        channelIds: current.channelIds,
      })
      return current
    }),
    compactTeam: vi.fn(async (input) => {
      const scope = maintenanceSource?.resolveMaintenanceProof(input.actor)
      if (scope === undefined
        || scope.kind !== 'scheduler-team-journal-compaction'
        || scope.teamId !== input.teamId
        || scope.expectedCursor !== input.expectedCursor
        || scope.throughSequence !== input.throughSequence) {
        throw new TeamError('scheduler maintenance proof is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
      }
      maintenanceScopes.push(scope)
      return { team: current, compactedThrough: input.throughSequence }
    }),
    assignTask: vi.fn(async (input) => {
      const scope = taskLeaseSource?.resolveTaskLeaseProof(input.actor)
      if (taskLeaseSource !== undefined && (scope === undefined
        || scope.kind !== 'scheduler-task-assign'
        || scope.teamId !== input.teamId
        || scope.taskId !== input.taskId
        || scope.expectedRevision !== input.expectedRevision
        || scope.participantId !== input.participantId
        || scope.activationId !== input.activationId
        || scope.wakeChannelId !== input.wakeChannelId
        || scope.leaseDurationMs !== input.leaseDurationMs)) {
        throw new TeamError('scheduler task-lease proof is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
      }
      if (scope !== undefined) taskLeaseScopes.push(scope)
      const prior = findTask(current, input.taskId)
      if (prior.revision !== input.expectedRevision) {
        throw new TeamError('stale task', 'TEAM_TASK_STALE_REVISION')
      }
      if (input.activationId === undefined) throw new Error('scheduler fake requires an agent activation')
      const next = taskAttemptAssignment(prior, input)
      current = replaceTask(current, next)
      return next
    }),
    expireTaskAttempt: vi.fn(async (input) => {
      const scope = taskLeaseSource?.resolveTaskLeaseProof(input.actor)
      if (taskLeaseSource !== undefined && (scope === undefined
        || scope.kind !== 'scheduler-task-expire'
        || scope.teamId !== input.teamId
        || scope.taskId !== input.taskId
        || scope.expectedRevision !== input.expectedRevision
        || scope.attemptId !== input.attemptId)) {
        throw new TeamError('scheduler task-lease proof is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
      }
      if (scope !== undefined) taskLeaseScopes.push(scope)
      const prior = findTask(current, input.taskId)
      if (prior.revision !== input.expectedRevision || prior.lease?.attemptId !== input.attemptId) {
        throw new TeamError('stale task', 'TEAM_TASK_STALE_REVISION')
      }
      const next = expiredTaskAttempt(prior)
      current = replaceTask(current, next)
      return next
    }),
    expireSchedulerChannelDeliveries: vi.fn(async (input) => {
      const scope = schedulerChannelSource?.resolveSchedulerChannelProof(input.actor)
      if (schedulerChannelSource !== undefined && (scope === undefined
        || scope.kind !== 'scheduler-channel-delivery-expire'
        || scope.teamId !== input.teamId
        || scope.channelId !== input.channelId
        || scope.expectedTeamCursor !== input.expectedTeamCursor
        || scope.expectedChannelCursor !== input.expectedChannelCursor
        || scope.now !== input.now
        || scope.limit !== input.limit)) {
        throw new TeamError('scheduler delivery expiry proof is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
      }
      if (scope !== undefined) schedulerChannelScopes.push(scope)
      const channel = channels.get(input.channelId)
      if (channel === undefined) throw new TeamError('missing channel', 'TEAM_CHANNEL_NOT_FOUND')
      if (current.team.cursor !== input.expectedTeamCursor) {
        throw new TeamError('stale Team', 'TEAM_CURSOR_CONFLICT')
      }
      if (channel.snapshot.cursor !== input.expectedChannelCursor) {
        throw new TeamError('stale channel', 'TEAM_CHANNEL_CURSOR_CONFLICT')
      }
      return { channel: channel.snapshot, expired: [] }
    }),
    openChannel: vi.fn(async (input) => {
      const scope = channelLifecycleSource?.resolveChannelLifecycleProof(input.actor as never)
      if (input.authorityKind !== 'channel-lifecycle'
        || scope === undefined
        || scope.kind !== 'channel-open'
        || scope.teamId !== input.teamId
        || scope.expectedCursor !== input.expectedCursor
        || JSON.stringify(scope.adapter) !== JSON.stringify(input.adapter)
        || JSON.stringify(scope.viewPolicy) !== JSON.stringify(input.viewPolicy)
        || JSON.stringify(scope.participants) !== JSON.stringify(input.participants)
        || JSON.stringify(scope.limits) !== JSON.stringify(input.limits)) {
        throw new TeamError('generic channel lifecycle proof is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
      }
      const id = channelIdSchema.parse(`channel-scheduler-${channelNumber += 1}`)
      const channel = channelSnapshotSchema.parse({
        manifest: {
          id,
          teamId: input.teamId,
          adapter: input.adapter,
          participants: input.participants,
          limits: input.limits,
        },
        phase: 'active',
        cursor: 1,
      })
      channels.set(id, { snapshot: channel, records: [] })
      current = state(current.tasks, current.participants, current.activations, {
        team: { ...current.team, cursor: current.team.cursor + 1, updatedAt: current.team.updatedAt + 1 },
        goal: current.goal,
        channelIds: [...current.channelIds, id],
      })
      return channel
    }),
    openSchedulerReviewChannel: vi.fn(async (input) => {
      const scope = schedulerChannelSource?.resolveSchedulerChannelProof(input.actor)
      if (schedulerChannelSource !== undefined && (scope === undefined
        || scope.kind !== 'scheduler-review-channel-open'
        || scope.teamId !== input.teamId
        || scope.expectedTeamCursor !== input.expectedTeamCursor
        || scope.taskId !== input.taskId
        || scope.expectedRevision !== input.expectedRevision
        || scope.attemptId !== input.attemptId
        || scope.initiatorId !== input.initiatorId
        || scope.reviewerId !== input.reviewerId
        || scope.reviewerActivationId !== input.reviewerActivationId
        || scope.reviewerSessionId !== input.reviewerSessionId
        || scope.reviewerProvider !== input.reviewerProvider)) {
        throw new TeamError('scheduler review channel proof is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
      }
      if (scope !== undefined) schedulerChannelScopes.push(scope)
      const id = channelIdSchema.parse(`channel-scheduler-${channelNumber += 1}`)
      const channel = channelSnapshotSchema.parse({
        manifest: {
          id,
          teamId: input.teamId,
          adapter: CONSULT_CHANNEL_ADAPTER_V1,
          participants: [
            { id: input.initiatorId, role: CONSULT_INITIATOR_ROLE },
            { id: input.reviewerId, role: CONSULT_RESPONDENT_ROLE },
          ],
          limits: {},
        },
        phase: 'active',
        cursor: 1,
      })
      channels.set(id, { snapshot: channel, records: [] })
      current = state(current.tasks, current.participants, current.activations, {
        team: { ...current.team, cursor: current.team.cursor + 1, updatedAt: current.team.updatedAt + 1 },
        goal: current.goal,
        channelIds: [...current.channelIds, id],
      })
      return channel
    }),
    openSchedulerWakeChannel: vi.fn(async (input) => {
      const scope = schedulerChannelSource?.resolveSchedulerChannelProof(input.actor)
      if (schedulerChannelSource !== undefined && (scope === undefined
        || scope.kind !== 'scheduler-wake-channel-open'
        || scope.teamId !== input.teamId
        || scope.expectedTeamCursor !== input.expectedTeamCursor
        || scope.taskId !== input.taskId
        || scope.expectedRevision !== input.expectedRevision
        || scope.participantId !== input.participantId
        || scope.activationId !== input.activationId
        || scope.sessionId !== input.sessionId)) {
        throw new TeamError('scheduler wake channel proof is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
      }
      if (scope !== undefined) schedulerChannelScopes.push(scope)
      const id = channelIdSchema.parse(`channel-scheduler-${channelNumber += 1}`)
      const channel = channelSnapshotSchema.parse({
        manifest: {
          id,
          teamId: input.teamId,
          adapter: TASK_ASSIGNMENT_CHANNEL_ADAPTER,
          participants: [{ id: input.participantId, role: TASK_ASSIGNMENT_ASSIGNEE_ROLE }],
          limits: {
            taskId: input.taskId,
            activationId: input.activationId,
            sessionId: input.sessionId,
          },
        },
        phase: 'active',
        cursor: 1,
      })
      channels.set(id, { snapshot: channel, records: [] })
      current = state(current.tasks, current.participants, current.activations, {
        team: { ...current.team, cursor: current.team.cursor + 1, updatedAt: current.team.updatedAt + 1 },
        goal: current.goal,
        channelIds: [...current.channelIds, id],
      })
      return channel
    }),
    closeChannel: vi.fn(async ({ channelId, expectedCursor }) => {
      const channel = channels.get(channelId)
      if (channel === undefined) throw new TeamError('missing channel', 'TEAM_CHANNEL_NOT_FOUND')
      if (channel.snapshot.cursor !== expectedCursor) {
        throw new TeamError('stale channel', 'TEAM_CHANNEL_CURSOR_CONFLICT')
      }
      channel.snapshot = channelSnapshotSchema.parse({
        ...channel.snapshot,
        phase: 'closed',
        cursor: channel.snapshot.cursor + 2,
      })
      return channel.snapshot
    }),
    closeSchedulerFailedWakeChannel: vi.fn(async (input) => {
      const scope = schedulerChannelSource?.resolveSchedulerChannelProof(input.actor)
      if (schedulerChannelSource !== undefined && (scope === undefined
        || scope.kind !== 'scheduler-failed-wake-channel-close'
        || scope.teamId !== input.teamId
        || scope.taskId !== input.taskId
        || scope.participantId !== input.participantId
        || scope.activationId !== input.activationId
        || scope.sessionId !== input.sessionId
        || scope.channelId !== input.channelId
        || scope.expectedChannelCursor !== input.expectedChannelCursor)) {
        throw new TeamError('scheduler failed wake cleanup proof is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
      }
      if (scope !== undefined) schedulerChannelScopes.push(scope)
      const channel = channels.get(input.channelId)
      if (channel === undefined) throw new TeamError('missing channel', 'TEAM_CHANNEL_NOT_FOUND')
      if (channel.snapshot.cursor !== input.expectedChannelCursor) {
        throw new TeamError('stale channel', 'TEAM_CHANNEL_CURSOR_CONFLICT')
      }
      channel.snapshot = channelSnapshotSchema.parse({
        ...channel.snapshot,
        phase: 'closed',
        cursor: channel.snapshot.cursor + 2,
      })
      return channel.snapshot
    }),
    getChannel: vi.fn(async ({ channelId }) => {
      const channel = channels.get(channelId)
      if (channel === undefined) throw new TeamError('missing channel', 'TEAM_CHANNEL_NOT_FOUND')
      return channel.snapshot
    }),
    compactChannel: vi.fn(async (input) => {
      const channel = channels.get(input.channelId)
      if (channel === undefined) throw new TeamError('missing channel', 'TEAM_CHANNEL_NOT_FOUND')
      if (channel.snapshot.cursor !== input.expectedCursor) {
        throw new TeamError('stale channel', 'TEAM_CHANNEL_CURSOR_CONFLICT')
      }
      const scope = maintenanceSource?.resolveMaintenanceProof(input.actor)
      if (scope === undefined
        || scope.kind !== 'scheduler-channel-compaction'
        || scope.teamId !== input.teamId
        || scope.channelId !== input.channelId
        || scope.expectedCursor !== input.expectedCursor
        || scope.throughSequence !== input.throughSequence) {
        throw new TeamError('scheduler maintenance proof is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
      }
      maintenanceScopes.push(scope)
      channel.snapshot = channelSnapshotSchema.parse({ ...channel.snapshot, firstCursor: input.throughSequence + 1 })
      return { channel: channel.snapshot, compactedThrough: input.throughSequence }
    }),
    readChannel: vi.fn(async ({ channelId, afterCursor }) => {
      const channel = channels.get(channelId)
      if (channel === undefined) throw new TeamError('missing channel', 'TEAM_CHANNEL_NOT_FOUND')
      return { channel: channel.snapshot, records: channel.records.filter(record => record.type === 'channel/envelope'
        ? record.envelope.sequence > afterCursor
        : true) }
    }),
    readChannelPage: vi.fn(async ({ channelId, afterCursor, limit }) => {
      const channel = channels.get(channelId)
      if (channel === undefined) throw new TeamError('missing channel', 'TEAM_CHANNEL_NOT_FOUND')
      const records = channel.records.filter(record => record.type === 'channel/envelope'
        ? record.envelope.sequence > afterCursor
        : true)
      const selected = records.slice(0, limit + 1)
      const page = selected.slice(0, limit)
      const last = page.at(-1)
      return {
        channel: channel.snapshot,
        records: page,
        ...selected.length > limit && last?.type === 'channel/envelope'
          ? { nextCursor: last.envelope.sequence }
          : {},
      }
    }),
    postChannelEnvelope: vi.fn(async (input) => {
      const channel = channels.get(input.draft.channelId)
      if (channel === undefined) throw new TeamError('missing channel', 'TEAM_CHANNEL_NOT_FOUND')
      if (channel.snapshot.cursor !== input.expectedCursor) {
        throw new TeamError('stale channel', 'TEAM_CHANNEL_CURSOR_CONFLICT')
      }
      if (!('actor' in input)) throw new TeamError('scheduler post proof is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
      const senderId = typeof input.draft.payload.initiatorId === 'string'
        ? input.draft.payload.initiatorId as never
        : input.draft.audience?.[0]
      if (senderId === undefined) throw new TeamError('scheduler post has no derived sender', 'TEAM_ACTOR_PROOF_INVALID')
      const envelope = teamEnvelopeSchema.parse({
        id: `envelope-scheduler-${envelopeNumber += 1}`,
        teamId: channel.snapshot.manifest.teamId,
        channelId: channel.snapshot.manifest.id,
        sequence: channel.snapshot.cursor + 1,
        senderId,
        audience: input.draft.audience,
        kind: input.draft.kind,
        payload: input.draft.payload,
        delivery: input.draft.delivery,
        ...input.draft.taskId === undefined ? {} : { taskId: input.draft.taskId },
        priority: input.draft.priority ?? 'normal',
        createdAt: 1,
      })
      channel.records.push(recordEnvelope(envelope))
      channel.snapshot = channelSnapshotSchema.parse({ ...channel.snapshot, cursor: envelope.sequence })
      return envelope
    }),
    resolveTaskReviewFromResponse: vi.fn(async ({ actor }) => {
      const scope = taskReviewSource?.resolveTaskReviewProof(actor)
      if (scope === undefined) throw new TeamError('scheduler review proof is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
      const prior = findTask(current, scope.taskId)
      if (prior.phase !== 'review' || prior.revision !== scope.expectedRevision) {
        throw new TeamError('stale review', 'TEAM_TASK_STALE_REVISION')
      }
      const next = taskAttemptResolvedForReview(prior, scope)
      current = replaceTask(current, next)
      return next
    }),
  }
  const on = vi.fn((event: string, callback: (value: TeamEvent) => void) => {
    const listeners = callbacks.get(event) ?? []
    listeners.push(callback)
    callbacks.set(event, listeners)
    return () => {
      const index = listeners.indexOf(callback)
      if (index >= 0) listeners.splice(index, 1)
    }
  })
  const ctx = {
    get: () => undefined,
    teams,
    teamChannelAdmission: {
      async waitUntilActive({ channelId, signal }: { readonly channelId: ChannelSnapshot['manifest']['id']; readonly signal: AbortSignal }) {
        signal.throwIfAborted()
        const channel = await teams.getChannel({ channelId })
        if (channel.phase !== 'active') throw new Error('Scheduler unit fixture channel is not active')
        return channel
      },
    },
    teamWorkspaces: workspaces,
    on,
    events: {
      dispatch: vi.fn((_mode: string, args: unknown[]) =>
        args[1] === 'team-scheduler/assigned' ? assignmentListeners : []),
    },
    logger: { warn: warnings },
  } as unknown as Context
  return {
    ctx,
    teams,
    workspaces,
    on,
    warnings,
    callbacks,
    assignmentListeners,
    maintenanceScopes,
    phaseScopes,
    taskLeaseScopes,
    schedulerChannelScopes,
    channels,
    taskLeaseSource: () => taskLeaseSource,
    getState: () => current,
    setState(next) { current = next },
    emit(event) {
      for (const callback of callbacks.get('team/changed') ?? []) callback(event)
    },
  }
}

/** Replace one task in its existing durable creation-order slot. */
function replaceTask(current: TeamStateSnapshot, next: TeamTaskSnapshot): TeamStateSnapshot {
  return state(
    current.tasks.map(item => item.id === next.id ? next : item),
    current.participants,
    current.activations,
    {
      team: { ...current.team, cursor: current.team.cursor + 1, updatedAt: current.team.updatedAt + 1 },
      goal: current.goal,
      channelIds: current.channelIds,
    },
  )
}

/** Return one known task or fail the fake provider's test setup. */
function findTask(current: TeamStateSnapshot, id: TeamTaskSnapshot['id']): TeamTaskSnapshot {
  const found = current.tasks.find(task => task.id === id)
  if (found === undefined) throw new Error(`unknown task '${id}'`)
  return found
}

/** Apply the fake provider's durable task-assignment effect. */
function taskAttemptAssignment(
  prior: TeamTaskSnapshot,
  input: {
    readonly participantId: ParticipantSnapshot['id']
    readonly activationId: ActivationBindingSnapshot['activation']['id']
    readonly wakeChannelId?: ChannelSnapshot['manifest']['id']
    readonly leaseDurationMs: number
  },
): TeamTaskSnapshot {
  const assignedAt = Date.now()
  return teamTaskSnapshotSchema.parse({
    ...prior,
    revision: prior.revision + 1,
    phase: 'assigned',
    attemptCount: prior.attemptCount + 1,
    lease: {
      attemptId: taskAttemptIdSchema.parse(`attempt-${prior.id}-${prior.attemptCount + 1}`),
      assignedRevision: prior.revision + 1,
      ordinal: prior.attemptCount + 1,
      participantId: input.participantId,
      activationId: input.activationId,
      ...input.wakeChannelId === undefined ? {} : { wakeChannelId: input.wakeChannelId },
      assignedAt,
      durationMs: input.leaseDurationMs,
      renewedAt: assignedAt,
      expiresAt: assignedAt + input.leaseDurationMs,
    },
  })
}

/** Apply the fake provider's explicit lease-expiry effect. */
function expiredTaskAttempt(prior: TeamTaskSnapshot): TeamTaskSnapshot {
  const currentLease = prior.lease
  if (currentLease === undefined) throw new Error(`task '${prior.id}' has no lease`)
  const settled = taskAttemptSnapshotSchema.parse({
    id: currentLease.attemptId,
    teamId,
    taskId: prior.id,
    ordinal: currentLease.ordinal,
    participantId: currentLease.participantId,
    activationId: currentLease.activationId,
    assignedAt: currentLease.assignedAt,
    ...currentLease.startedAt === undefined ? {} : { startedAt: currentLease.startedAt },
    leaseExpiresAt: currentLease.expiresAt,
    settledAt: currentLease.expiresAt,
    outcome: { kind: 'lease-expired' },
  })
  const { lease: _lease, ...withoutLease } = prior
  return teamTaskSnapshotSchema.parse({
    ...withoutLease,
    revision: prior.revision + 1,
    phase: prior.attemptCount >= prior.maxAttempts ? 'failed' : 'pending',
    attemptHistory: [...prior.attemptHistory, settled],
  })
}

/** Apply the fake provider's scheduler-owned durable review-response recovery. */
function taskAttemptResolvedForReview(
  prior: TeamTaskSnapshot,
  scope: TeamSystemTaskReviewScope,
): TeamTaskSnapshot {
  return teamTaskSnapshotSchema.parse({
    ...prior,
    revision: prior.revision + 1,
    phase: scope.nextPhase,
    reviewHistory: [...prior.reviewHistory, {
      attemptId: scope.attemptId,
      reviewerId: scope.reviewerId,
      nextPhase: scope.nextPhase,
      reason: scope.reason,
      decidedAt: Date.now(),
    }],
  })
}

/** Open one fake task-assignment channel whose immutable limits match an Agent-bound task. */
async function openWakeChannel(
  harness: FakeHarness,
  currentTask: TeamTaskSnapshot,
  owner: ParticipantSnapshot,
  binding: ActivationBindingSnapshot,
): Promise<ChannelSnapshot> {
  const current = harness.getState()
  return await openTestChannel(harness.ctx, {
    teamId,
    expectedCursor: current.team.cursor,
    adapter: TASK_ASSIGNMENT_CHANNEL_ADAPTER,
    participants: [{ id: owner.id, role: TASK_ASSIGNMENT_ASSIGNEE_ROLE }],
    limits: { taskId: currentTask.id, activationId: binding.activation.id, sessionId: binding.sessionId },
  })
}

/** Replace a pending task with an assignment whose lease points at its already-open wake channel. */
function assignedWakeTask(
  currentTask: TeamTaskSnapshot,
  owner: ParticipantSnapshot,
  binding: ActivationBindingSnapshot,
  channel: ChannelSnapshot,
): TeamTaskSnapshot {
  return task(String(currentTask.id), {
    ...currentTask,
    phase: 'assigned',
    attemptCount: 1,
    lease: lease(`wake-${currentTask.id}`, owner, binding.activation.id, {
      assignedRevision: currentTask.revision,
      wakeChannelId: channel.manifest.id,
    }),
  })
}

/** Build an otherwise-valid task-assignment Envelope for controlled recovery corruption tests. */
function assignmentEnvelope(
  channel: ChannelSnapshot,
  currentTask: TeamTaskSnapshot,
  binding: ActivationBindingSnapshot,
  overrides: Record<string, unknown> = {},
): TeamEnvelope {
  const activeLease = currentTask.lease
  if (activeLease === undefined) throw new Error('assigned wake task has no lease')
  return teamEnvelopeSchema.parse({
    id: `envelope-existing-${activeLease.attemptId}`,
    teamId,
    channelId: channel.manifest.id,
    sequence: channel.cursor + 1,
    senderId: activeLease.participantId,
    audience: [activeLease.participantId],
    kind: TASK_ASSIGNMENT_ENVELOPE_KIND,
    payload: {
      taskId: currentTask.id,
      attemptId: activeLease.attemptId,
      assignedRevision: activeLease.assignedRevision,
      activationId: binding.activation.id,
      sessionId: binding.sessionId,
    },
    delivery: 'turn',
    taskId: currentTask.id,
    priority: 'normal',
    createdAt: 1,
    ...overrides,
  })
}

/** Build one fake Team whose sole current task lease needs task-assignment channel recovery. */
async function recoveryHarness(label: string) {
  const worker = participant(`participant-${label}`)
  const binding = activation(worker)
  const pending = task(`task-${label}`)
  const harness = setup(state([pending], [worker], [binding]))
  const channel = await openWakeChannel(harness, pending, worker, binding)
  const assigned = assignedWakeTask(pending, worker, binding, channel)
  harness.setState(state([assigned], [worker], [binding], {
    team: harness.getState().team,
    channelIds: harness.getState().channelIds,
  }))
  return { worker, binding, pending, harness, channel, assigned }
}


it.each([1,2])('repro: existing assigned wakes do not starve another idle participant (wake budget %s)', async (wakeBudget) => {
  vi.spyOn(Date, 'now').mockReturnValue(10)
  const first = await recoveryHarness('wake-first')
  const secondWorker = participant('participant-wake-second')
  const secondBinding = activation(secondWorker)
  const secondPending = task('task-wake-second')
  const thirdWorker = participant('participant-idle-third')
  const thirdBinding = activation(thirdWorker)
  const thirdPending = task('task-ready-third')
  first.harness.setState(state([first.assigned, secondPending, thirdPending], [first.worker, secondWorker, thirdWorker], [first.binding, secondBinding, thirdBinding], {team:first.harness.getState().team,channelIds:first.harness.getState().channelIds}))
  const secondChannel = await openWakeChannel(first.harness, secondPending, secondWorker, secondBinding)
  const secondAssigned = assignedWakeTask(secondPending, secondWorker, secondBinding, secondChannel)
  first.harness.setState(state([first.assigned,secondAssigned,thirdPending], [first.worker,secondWorker,thirdWorker], [first.binding,secondBinding,thirdBinding], {team:first.harness.getState().team,channelIds:first.harness.getState().channelIds}))
  const scheduler = new TeamDagScheduler(first.harness.ctx,config({maxWakeDispatchesPerDrive:wakeBudget}))
  try {
    for(let i=0;i<5;i++) await scheduler.drive({teamId})
    expect(first.harness.teams.postChannelEnvelope.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(first.harness.getState().tasks.find(t=>t.id===thirdPending.id)?.phase).toBe('assigned')
  } finally {await scheduler.close()}
})

it('repro: review request retries reuse the already attached review channel', async () => {
  const initiator=participant('participant-review-initiator')
  const reviewer=participant('participant-reviewer')
  const reviewTaskId=teamTaskIdSchema.parse('task-review-recovery')
  const attempt=taskAttemptSnapshotSchema.parse({id:'attempt-review-recovery',teamId,taskId:reviewTaskId,ordinal:1,participantId:initiator.id,assignedAt:1,leaseExpiresAt:3,settledAt:2,outcome:{kind:'completed',result:{summary:'Ready for review'}}})
  const reviewTask=task(String(reviewTaskId),{revision:2,phase:'review',reviewPolicy:{kind:'participant',reviewerId:reviewer.id},attemptCount:1,attemptHistory:[attempt]})
  const harness=setup(state([reviewTask],[initiator,reviewer],[activation(initiator),activation(reviewer)]))
  harness.teams.postChannelEnvelope.mockRejectedValueOnce(new Error('transient append failure'))
  const scheduler=new TeamDagScheduler(harness.ctx,config())
  try {
    await expect(scheduler.drive({teamId})).rejects.toThrow('transient append failure')
    expect(harness.getState().channelIds).toHaveLength(1)
    await scheduler.drive({teamId})
    expect(harness.getState().channelIds).toHaveLength(1)
  } finally {await scheduler.close()}
})
