import { recordEnvelope } from '../../../core/team/tests/channel-envelope-record.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { Context } from '@clocky/cordis'
import { openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
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
} from '../src/index.ts'
import type {
  Config,
  TeamTaskAssignmentNotice,
} from '../src/index.ts'

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

describe('TeamDagScheduler', () => {
  it('discovers Teams on the configured pulse and stops discovery after disposal', async () => {
    vi.useFakeTimers()
    const harness = setup(state([], [], []))
    const scheduler = new TeamDagScheduler(harness.ctx, config({ pulseIntervalMs: 10 }))
    scheduler.start()
    await scheduler.drive()
    const initialScans = harness.teams.listTeamsPage.mock.calls.length

    await vi.advanceTimersByTimeAsync(30)
    expect(harness.teams.listTeamsPage).toHaveBeenCalledTimes(initialScans + 3)
    await scheduler.close()
    await vi.advanceTimersByTimeAsync(30)
    expect(harness.teams.listTeamsPage).toHaveBeenCalledTimes(initialScans + 3)
  })

  it('durably stalls an expired Team budget without waiting for another mutation', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(101)
    const initial = state([], [], [], {
      team: { ...state([], [], []).team, createdAt: 1 },
      rules: { teamLimits: { maxWallTimeMsPerTeam: 100 } },
    })
    const harness = setup(initial)
    const scheduler = new TeamDagScheduler(harness.ctx, config())
    const unregisterPhase = harness.teams.registerSystemPhaseProofSource(scheduler.phaseProofSource)
    scheduler.start()

    await scheduler.drive({ teamId })

    expect(harness.teams.transitionTeamPhase).toHaveBeenCalledWith(expect.objectContaining({
      teamId,
      phase: 'stalled',
      reason: {
        code: 'TEAM_WALL_TIME_BUDGET_EXCEEDED',
        message: `Team '${teamId}' exceeded its 100ms wall-time budget`,
      },
    }))
    expect(harness.getState().team.phase).toBe('stalled')
    await scheduler.close()
    unregisterPhase()
  })

  it('selects higher priority work and the least-specialized idle capability match', async () => {
    const broad = participant('participant-broad', { capabilities: ['lint', 'test'] })
    const exact = participant('participant-exact', { capabilities: ['lint'] })
    const low = task('task-low', { priority: 1, requiredCapabilities: ['lint'] })
    const high = task('task-high', { priority: 2, requiredCapabilities: ['lint'] })
    const harness = setup(state([low, high], [broad, exact], [activation(broad), activation(exact)]))
    const scheduler = new TeamDagScheduler(harness.ctx, config({ maxAssignmentsPerDrive: 1 }))

    await scheduler.drive({ teamId })

    expect(harness.teams.assignTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: high.id,
      participantId: exact.id,
      activationId: activation(exact).activation.id,
      leaseDurationMs: 100,
    }))
    expect(harness.getState().tasks.find(item => item.id === high.id)).toMatchObject({ phase: 'assigned' })
    expect(() => JSON.stringify(harness.teams.assignTask.mock.calls[0]?.[0].actor)).toThrow('runtime-only')
    expect(() => JSON.stringify(harness.teams.openSchedulerWakeChannel.mock.calls[0]?.[0].actor)).toThrow('runtime-only')
    await scheduler.close()
  })

  it('uses a valid owner proposal as a tie-breaker without bypassing capability eligibility', async () => {
    const broad = participant('participant-proposed-broad', { capabilities: ['lint', 'test'] })
    const exact = participant('participant-proposed-exact', { capabilities: ['lint'] })
    const preferred = task('task-proposed-owner', { requiredCapabilities: ['lint'], proposedOwnerId: broad.id })
    const harness = setup(state([preferred], [broad, exact], [activation(broad), activation(exact)]))
    const scheduler = new TeamDagScheduler(harness.ctx, config({ maxAssignmentsPerDrive: 1 }))

    await scheduler.drive({ teamId })

    expect(harness.teams.assignTask).toHaveBeenCalledWith(expect.objectContaining({ participantId: broad.id }))
    await scheduler.close()

    const incompatible = participant('participant-incompatible-proposal', { capabilities: ['test'] })
    const fallbackTask = task('task-incompatible-proposal', { requiredCapabilities: ['lint'], proposedOwnerId: incompatible.id })
    const fallback = setup(state([fallbackTask], [incompatible, exact], [activation(incompatible), activation(exact)]))
    const fallbackScheduler = new TeamDagScheduler(fallback.ctx, config({ maxAssignmentsPerDrive: 1 }))
    await fallbackScheduler.drive({ teamId })
    expect(fallback.teams.assignTask).toHaveBeenCalledWith(expect.objectContaining({ participantId: exact.id }))
    await fallbackScheduler.close()
  })

  it('fans out independent ready tasks across eligible workers and leaves the fan-in task blocked', async () => {
    const left = participant('participant-fanout-left', { capabilities: ['worker'] })
    const right = participant('participant-fanout-right', { capabilities: ['worker'] })
    const first = task('task-fanout-first', { requiredCapabilities: ['worker'] })
    const second = task('task-fanout-second', { requiredCapabilities: ['worker'] })
    const join = task('task-fanout-join', { requiredCapabilities: ['worker'], blockedBy: [first.id, second.id] })
    const harness = setup(state([first, second, join], [left, right], [activation(left), activation(right)]))
    const scheduler = new TeamDagScheduler(harness.ctx, config({ maxAssignmentsPerDrive: 2 }))

    await scheduler.drive({ teamId })

    expect(harness.teams.assignTask).toHaveBeenCalledTimes(2)
    expect(harness.teams.assignTask.mock.calls.map(([request]) => request.participantId))
      .toEqual(expect.arrayContaining([left.id, right.id]))
    expect(harness.getState().tasks.find(item => item.id === join.id)?.phase).toBe('pending')
    await scheduler.close()
  })

  it('queries workspace eligibility before ranking and skips a declined activation without allocating', async () => {
    const broad = participant('participant-workspace-broad', { capabilities: ['lint', 'test'] })
    const exact = participant('participant-workspace-exact', { capabilities: ['lint'] })
    const scheduled = task('task-workspace', { requiredCapabilities: ['lint'] })
    const harness = setup(state([scheduled], [broad, exact], [activation(broad), activation(exact)]))
    const checked: string[] = []
    harness.workspaces.eligible.mockImplementation(async (_mode, request) => {
      checked.push(request.binding.activation.participantId)
      return request.binding.activation.participantId !== exact.id
    })
    const scheduler = new TeamDagScheduler(harness.ctx, config({ maxAssignmentsPerDrive: 1 }))

    await scheduler.drive({ teamId })

    expect(checked).toEqual([broad.id, exact.id])
    expect(harness.teams.assignTask).toHaveBeenCalledWith(expect.objectContaining({ participantId: broad.id }))
    expect('allocate' in harness.workspaces).toBe(false)
    await scheduler.close()
  })

  it('leaves a ready task pending when every workspace provider eligibility check returns false', async () => {
    const worker = participant('participant-workspace-rejected')
    const scheduled = task('task-workspace-rejected')
    const harness = setup(state([scheduled], [worker], [activation(worker)]))
    harness.workspaces.eligible.mockResolvedValue(false)
    const scheduler = new TeamDagScheduler(harness.ctx, config())

    await scheduler.drive({ teamId })

    expect(harness.workspaces.eligible).toHaveBeenCalledWith('shared', {
      task: scheduled,
      binding: activation(worker),
    })
    expect(harness.teams.openChannel).not.toHaveBeenCalled()
    expect(harness.teams.assignTask).not.toHaveBeenCalled()
    await scheduler.close()
  })

  it('propagates an unavailable workspace provider before channel or task mutation', async () => {
    const worker = participant('participant-workspace-unavailable')
    const scheduled = task('task-workspace-unavailable')
    const harness = setup(state([scheduled], [worker], [activation(worker)]))
    harness.workspaces.eligible.mockRejectedValue(new Error('shared workspace unavailable'))
    const scheduler = new TeamDagScheduler(harness.ctx, config())

    await expect(scheduler.drive({ teamId })).rejects.toThrow('shared workspace unavailable')
    expect(harness.teams.openChannel).not.toHaveBeenCalled()
    expect(harness.teams.assignTask).not.toHaveBeenCalled()
    await scheduler.close()
  })

  for (const mode of ['negative', 'capability-set', 'specificity', 'cost', 'unknown-cost', 'proposal'] as const) {
    it(`ranks ${mode} evidence without changing earlier eligibility and tuple priorities`, async () => {
      const observations = (id: string, capabilities: string[], completedAttempts: number, failedAttempts: number) => ({
        activeAttempts: 0, completedAttempts, failedAttempts, totalLatencyMs: 20, updatedAt: 10,
        taskOutcomes: [{ participantId: id, requiredCapabilities: capabilities, completedAttempts, failedAttempts,
          totalLatencyMs: 20, latencyBucketCounts: [completedAttempts + failedAttempts, 0, 0] }],
      })
      const alpha = participant('participant-alpha', { capabilities: ['lint'], model: 'cheap-unverified-hint',
        stats: observations('participant-alpha', mode === 'capability-set' ? ['other'] : ['lint'], 0, 1) })
      const beta = participant('participant-beta', { capabilities: mode === 'specificity' ? ['lint', 'test'] : ['lint'],
        ...mode === 'negative' ? {} : { stats: observations('participant-beta', ['lint'], 1, 0) } })
      const cost = mode === 'cost' || mode === 'unknown-cost'
      const owners = cost ? [participant('participant-alpha', { capabilities: ['lint'], model: 'cheap-unverified-hint' }),
        participant('participant-beta', { capabilities: ['lint'] })] : [alpha, beta]
      const bindings = owners.map(owner => activation(owner, cost && (mode !== 'unknown-cost' || owner.id === beta.id) ? {
        recovery: { kind: 'sdk-local-cold-replace', version: 1, runtimeProvider: 'test', profile: 'ranking-test',
          agent: { provider: 'price-provider', model: owner.id === beta.id ? 'low' : 'high' },
          process: { hostId: 'ranking-host', pid: 42, started: 'recorded-start' } },
      } : {}))
      const scheduled = task('task-ranked', { requiredCapabilities: ['lint'],
        ...mode === 'proposal' ? { proposedOwnerId: alpha.id } : {}, ...cost ? { budget: { maxCostUnits: 100 } } : {} })
      const harness = setup(state([scheduled], owners, bindings, { rules: { usageRates: {
        'price-provider/low': { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
        'price-provider/high': { input: 9, output: 9, cacheRead: 9, cacheWrite: 9 },
      } } }))
      const scheduler = new TeamDagScheduler(harness.ctx, config())
      try {
        await scheduler.drive({ teamId })
        expect(harness.teams.assignTask).toHaveBeenCalledWith(expect.objectContaining({
          participantId: mode === 'specificity' || mode === 'proposal' ? alpha.id : beta.id,
        }))
      } finally { await scheduler.close() }
    })
  }

  it('uses durable task creation order and current load before participant identity ties', async () => {
    const alpha = participant('participant-alpha', { capabilities: ['lint'] })
    const beta = participant('participant-beta', { capabilities: ['lint'] })
    const alphaActivation = activation(alpha)
    const betaActivation = activation(beta)
    const reservedLease = lease('reserved', alpha, alphaActivation.activation.id)
    const reserved = task('task-reserved', {
      phase: 'assigned', attemptCount: 1, lease: reservedLease, writeScopes: ['other'],
    })
    const first = task('task-first', { requiredCapabilities: ['lint'], writeScopes: ['src'] })
    const second = task('task-second', { requiredCapabilities: ['lint'], writeScopes: ['lib'] })
    const harness = setup(state([reserved, first, second], [alpha, beta], [alphaActivation, betaActivation]))
    const scheduler = new TeamDagScheduler(harness.ctx, config({
      maxAssignmentsPerDrive: 1,
      maxActiveAttemptsPerParticipant: 2,
    }))

    await scheduler.drive({ teamId })

    expect(harness.teams.assignTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: first.id,
      participantId: beta.id,
    }))
    await scheduler.close()
  })

  it('filters blocked, non-shared, conflicted, unavailable, and over-capacity candidates', async () => {
    const unavailable = participant('participant-unavailable', { capabilities: ['lint'], phase: 'provisioning' })
    const human = participant('participant-human', {
      kind: 'human', capabilities: ['lint'], owner: { kind: 'product-principal', principalId: 'scheduler-human' },
    })
    const running = participant('participant-running', { capabilities: ['lint'] })
    const worker = participant('participant-worker', { capabilities: ['lint'] })
    const unavailableActivation = activation(unavailable)
    const runningActivation = activation(running, { activation: {
      ...activation(running).activation,
      status: 'running',
    } })
    const workerActivation = activation(worker)
    const blocker = task('task-blocker', { phase: 'failed' })
    const blocked = task('task-blocked', { blockedBy: [blocker.id], priority: 5 })
    const remote = task('task-remote', { workspaceMode: 'remote', priority: 4 })
    const reservation = task('task-reservation', {
      revision: 2,
      phase: 'running',
      attemptCount: 1,
      lease: lease('reservation', worker, workerActivation.activation.id, { startedAt: Date.now() }),
      writeScopes: ['src'],
    })
    const conflict = task('task-conflict', { priority: 3, writeScopes: ['.'] })
    const selected = task('task-selected', { priority: 2, requiredCapabilities: ['lint'], writeScopes: ['docs'] })
    const harness = setup(state(
      [blocker, blocked, remote, reservation, conflict, selected],
      [unavailable, human, running, worker],
      [unavailableActivation, runningActivation, workerActivation],
    ))
    const scheduler = new TeamDagScheduler(harness.ctx, config({
      maxAssignmentsPerDrive: 1,
      maxActiveAttemptsPerParticipant: 2,
    }))

    await scheduler.drive({ teamId })

    expect(harness.teams.assignTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: selected.id, participantId: worker.id }))
    await scheduler.close()
  })

  it('expires due leases before assignment and stops assignment while an expiry cap leaves a due lease', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100)
    const worker = participant('participant-expiry')
    const workerActivation = activation(worker)
    const firstDue = task('task-first-due', {
      phase: 'assigned',
      requiredCapabilities: ['missing'],
      attemptCount: 1,
      lease: lease('first-due', worker, workerActivation.activation.id, {
        assignedAt: 1, renewedAt: 1, expiresAt: 50, durationMs: 49,
      }),
    })
    const secondDue = task('task-second-due', {
      phase: 'assigned',
      requiredCapabilities: ['missing'],
      attemptCount: 1,
      lease: lease('second-due', worker, workerActivation.activation.id, {
        assignedAt: 1, renewedAt: 1, expiresAt: 50, durationMs: 49,
      }),
    })
    const ready = task('task-ready')
    const harness = setup(state([firstDue, secondDue, ready], [worker], [workerActivation]))
    const scheduler = new TeamDagScheduler(harness.ctx, config({ maxExpirationsPerDrive: 1, maxAssignmentsPerDrive: 1 }))

    await scheduler.drive({ teamId })

    expect(harness.teams.expireTaskAttempt).toHaveBeenCalledWith(expect.objectContaining({ taskId: firstDue.id }))
    expect(harness.teams.assignTask).not.toHaveBeenCalled()
    await scheduler.drive({ teamId })
    expect(harness.teams.expireTaskAttempt).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: secondDue.id }))
    expect(harness.teams.assignTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: ready.id }))
    await scheduler.close()
  })

  it('drives TTL delivery expiry before selecting task work', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100)
    const worker = participant('participant-delivery-expiry')
    const binding = activation(worker)
    const pending = task('task-delivery-expiry', { requiredCapabilities: ['unavailable'] })
    const harness = setup(state([pending], [worker], [binding]))
    const channel = await openWakeChannel(harness, pending, worker, binding)
    const expired: ChannelDeliveryExpiredRecord = {
      type: 'channel/delivery-expired',
      sequence: channel.cursor + 1,
      createdAt: 100,
      participantId: worker.id,
      envelopeId: 'expired-envelope' as never,
      envelopeSequence: 2,
    }
    const originalExpiry = harness.teams.expireSchedulerChannelDeliveries.getMockImplementation()
    if (originalExpiry === undefined) throw new Error('fake scheduler delivery expiry lost its implementation')
    harness.teams.expireSchedulerChannelDeliveries.mockImplementationOnce(async (input) => {
      await originalExpiry(input)
      return { channel, expired: [expired] }
    })
    const scheduler = new TeamDagScheduler(harness.ctx, config({ maxExpirationsPerDrive: 1 }))
    const unregister = harness.teams.registerSystemSchedulerChannelProofSource(scheduler.schedulerChannelProofSource)
    try {
      await scheduler.drive({ teamId })

      expect(harness.teams.expireSchedulerChannelDeliveries).toHaveBeenCalledWith(expect.objectContaining({
        teamId,
        channelId: channel.manifest.id,
        expectedTeamCursor: harness.getState().team.cursor,
        expectedChannelCursor: channel.cursor,
        now: 100,
        limit: 1,
      }))
      expect(harness.schedulerChannelScopes).toEqual([expect.objectContaining({
        kind: 'scheduler-channel-delivery-expire',
        teamId,
        channelId: channel.manifest.id,
        now: 100,
      })])
      expect(harness.teams.assignTask).not.toHaveBeenCalled()
    } finally {
      unregister()
      await scheduler.close()
    }
  })

  it('drives only TTL delivery expiry while a cancellation remains quiescing', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100)
    const worker = participant('participant-cancellation-delivery-expiry')
    const binding = activation(worker)
    const pending = task('task-cancellation-delivery-expiry', { requiredCapabilities: ['unavailable'] })
    const harness = setup(state([pending], [worker], [binding]))
    const channel = await openWakeChannel(harness, pending, worker, binding)
    const active = harness.getState()
    harness.setState(state([pending], [worker], [binding], {
      team: {
        ...active.team,
        phase: 'quiescing',
        cancellation: {
          teamId,
          idempotencyKey: teamClosureIdempotencyKeySchema.parse('scheduler-cancellation-delivery-expiry'),
          actor: { kind: 'system', name: 'team-run' },
          reason: { code: 'USER_CANCELLED', message: 'Drain only due TTL delivery before cancellation closes.' },
          requestedAt: 1,
        },
      },
      goal: active.goal,
      channelIds: active.channelIds,
    }))
    const expired: ChannelDeliveryExpiredRecord = {
      type: 'channel/delivery-expired',
      sequence: channel.cursor + 1,
      createdAt: 100,
      participantId: worker.id,
      envelopeId: 'cancellation-expired-envelope' as never,
      envelopeSequence: 2,
    }
    const originalExpiry = harness.teams.expireSchedulerChannelDeliveries.getMockImplementation()
    if (originalExpiry === undefined) throw new Error('fake scheduler delivery expiry lost its implementation')
    harness.teams.expireSchedulerChannelDeliveries.mockImplementationOnce(async (input) => {
      await originalExpiry(input)
      return { channel, expired: [expired] }
    })
    const scheduler = new TeamDagScheduler(harness.ctx, config({ maxExpirationsPerDrive: 1 }))
    const unregister = harness.teams.registerSystemSchedulerChannelProofSource(scheduler.schedulerChannelProofSource)
    try {
      await scheduler.drive({ teamId })

      expect(harness.teams.expireSchedulerChannelDeliveries).toHaveBeenCalledTimes(1)
      expect(harness.schedulerChannelScopes).toEqual([expect.objectContaining({
        kind: 'scheduler-channel-delivery-expire', teamId, channelId: channel.manifest.id, now: 100,
      })])
      expect(harness.teams.assignTask).not.toHaveBeenCalled()
      expect(harness.teams.expireTaskAttempt).not.toHaveBeenCalled()
      expect(harness.teams.openSchedulerReviewChannel).not.toHaveBeenCalled()
      expect(harness.teams.openSchedulerWakeChannel).not.toHaveBeenCalled()
    } finally {
      unregister()
      await scheduler.close()
    }

    const nonCancelling = setup(state([pending], [worker], [binding], {
      team: { ...active.team, phase: 'quiescing' }, goal: active.goal, channelIds: active.channelIds,
    }))
    nonCancelling.channels.set(channel.manifest.id, { snapshot: channel, records: [] })
    const inactiveScheduler = new TeamDagScheduler(nonCancelling.ctx, config())
    try {
      await inactiveScheduler.drive({ teamId })
      expect(nonCancelling.teams.expireSchedulerChannelDeliveries).not.toHaveBeenCalled()
    } finally {
      await inactiveScheduler.close()
    }
  })

  it('reissues a scheduler delivery-expiry proof after a channel cursor race with one scan clock', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100)
    const worker = participant('participant-delivery-expiry-race')
    const binding = activation(worker)
    const pending = task('task-delivery-expiry-race', { requiredCapabilities: ['unavailable'] })
    const harness = setup(state([pending], [worker], [binding]))
    const channel = await openWakeChannel(harness, pending, worker, binding)
    harness.teams.expireSchedulerChannelDeliveries.mockRejectedValueOnce(
      new TeamError('channel changed', 'TEAM_CHANNEL_CURSOR_CONFLICT'),
    )
    const scheduler = new TeamDagScheduler(harness.ctx, config({ maxConflictsPerDrive: 1 }))
    const unregister = harness.teams.registerSystemSchedulerChannelProofSource(scheduler.schedulerChannelProofSource)
    try {
      await scheduler.drive({ teamId })
      expect(harness.teams.expireSchedulerChannelDeliveries).toHaveBeenCalledTimes(2)
      for (const call of harness.teams.expireSchedulerChannelDeliveries.mock.calls) {
        expect(call[0]).toMatchObject({
          teamId,
          channelId: channel.manifest.id,
          now: 100,
        })
      }
    } finally {
      unregister()
      await scheduler.close()
    }
  })

  it('runs bounded terminal-channel retention when explicitly configured', async () => {
    const worker = participant('participant-retention')
    const channelId = channelIdSchema.parse('channel-retention')
    const channel = channelSnapshotSchema.parse({
      manifest: {
        id: channelId,
        teamId,
        adapter: TASK_ASSIGNMENT_CHANNEL_ADAPTER,
        participants: [{ id: worker.id, role: TASK_ASSIGNMENT_ASSIGNEE_ROLE }],
        limits: {},
      },
      phase: 'closed',
      cursor: 8,
    })
    const initial = state([], [worker], [activation(worker)])
    const harness = setup(state([], [worker], [activation(worker)], {
      team: { ...initial.team, phase: 'completed', cursor: 8 },
      channelIds: [channelId],
    }))
    harness.channels.set(channelId, { snapshot: channel, records: [] })
    const dispose = apply(harness.ctx, config({
      terminalChannelRetentionTail: 2,
      maxCompactionsPerDrive: 2,
    }))

    await vi.waitFor(() => {
      expect(harness.teams.compactTeam).toHaveBeenCalledTimes(1)
      expect(harness.teams.compactChannel).toHaveBeenCalledTimes(1)
    })

    expect(harness.teams.compactTeam).toHaveBeenCalledWith(expect.objectContaining({
      teamId,
      expectedCursor: 8,
      throughSequence: 5,
    }))
    expect(harness.teams.compactChannel).toHaveBeenCalledWith(expect.objectContaining({
      teamId,
      channelId,
      expectedCursor: 8,
      throughSequence: 5,
    }))
    expect(harness.teams.registerSystemMaintenanceProofSource).toHaveBeenCalledWith(expect.objectContaining({
      name: 'team-scheduler-dag',
    }))
    expect(() => JSON.stringify(harness.teams.compactTeam.mock.calls[0]?.[0].actor)).toThrow('runtime-only')
    expect(harness.maintenanceScopes).toEqual([
      {
        kind: 'scheduler-channel-compaction',
        teamId,
        channelId,
        expectedCursor: 8,
        throughSequence: 5,
      },
      {
        kind: 'scheduler-team-journal-compaction',
        teamId,
        expectedCursor: 8,
        throughSequence: 5,
      },
    ])
    await dispose()
  })

  it('uses a one-command retention budget for a channel before its terminal Team journal', async () => {
    const worker = participant('participant-bounded-retention')
    const channelId = channelIdSchema.parse('channel-bounded-retention')
    const channel = channelSnapshotSchema.parse({ manifest: {
      id: channelId, teamId, adapter: TASK_ASSIGNMENT_CHANNEL_ADAPTER,
      participants: [{ id: worker.id, role: TASK_ASSIGNMENT_ASSIGNEE_ROLE }], limits: {},
    }, phase: 'closed', cursor: 8 })
    const initial = state([], [worker], [])
    const harness = setup(state([], [worker], [], {
      team: { ...initial.team, phase: 'failed', cursor: 8 }, channelIds: [channelId],
    }))
    harness.channels.set(channelId, { snapshot: channel, records: [] })
    const scheduler = new TeamDagScheduler(harness.ctx, config({ terminalChannelRetentionTail: 2, maxCompactionsPerDrive: 1 }))
    const unregister = harness.teams.registerSystemMaintenanceProofSource(scheduler.maintenanceProofSource)
    try {
      await scheduler.drive({ teamId })
      expect(harness.teams.compactChannel).toHaveBeenCalledOnce()
      expect(harness.teams.compactTeam).not.toHaveBeenCalled()
      await scheduler.drive({ teamId })
      expect(harness.teams.compactChannel).toHaveBeenCalledOnce()
      expect(harness.teams.compactTeam).toHaveBeenCalledOnce()
    } finally {
      await scheduler.close()
      unregister()
    }
  })

  it('repairs a missing assignment Envelope from its attached wake channel exactly once on later drives', async () => {
    const worker = participant('participant-wake-recovery')
    const binding = activation(worker)
    const pending = task('task-wake-recovery')
    const harness = setup(state([pending], [worker], [binding]))
    const channel = await openWakeChannel(harness, pending, worker, binding)
    const assigned = assignedWakeTask(pending, worker, binding, channel)
    harness.setState(state([assigned], [worker], [binding], {
      team: harness.getState().team,
      channelIds: harness.getState().channelIds,
    }))
    const scheduler = new TeamDagScheduler(harness.ctx, config({ maxWakeDispatchesPerDrive: 1 }))

    await scheduler.drive({ teamId })

    expect(harness.teams.openChannel).toHaveBeenCalledTimes(1)
    const posted = harness.teams.postChannelEnvelope.mock.calls[0]?.[0]
    if (posted === undefined || assigned.lease === undefined) throw new Error('scheduler did not publish its assignment Envelope')
    expect(posted.actor).toBeDefined()
    expect(() => JSON.stringify(posted.actor)).toThrow('runtime-only')
    expect(posted).toMatchObject({
      draft: {
        channelId: channel.manifest.id,
        audience: [worker.id],
        kind: TASK_ASSIGNMENT_ENVELOPE_KIND,
        delivery: 'turn',
        taskId: assigned.id,
        payload: {
          taskId: assigned.id,
          attemptId: assigned.lease.attemptId,
          assignedRevision: assigned.lease.assignedRevision,
          activationId: binding.activation.id,
          sessionId: binding.sessionId,
        },
      },
    })
    expect(harness.channels.get(channel.manifest.id)?.records.filter(record => record.type === 'channel/envelope')).toHaveLength(1)

    await scheduler.drive({ teamId })
    expect(harness.teams.openChannel).toHaveBeenCalledTimes(1)
    expect(harness.teams.postChannelEnvelope).toHaveBeenCalledTimes(1)
    await scheduler.close()
  })

  it('rejects malformed wake bindings, duplicate task assignment Envelopes, and stale attempt facts', async () => {
    const worker = participant('participant-wake-invalid')
    const binding = activation(worker)
    const pending = task('task-wake-invalid')

    const missingBinding = setup(state([pending], [worker], []))
    const missingChannel = await openWakeChannel(missingBinding, pending, worker, binding)
    const missingAssigned = assignedWakeTask(pending, worker, binding, missingChannel)
    missingBinding.setState(state([missingAssigned], [worker], [], {
      team: missingBinding.getState().team,
      channelIds: missingBinding.getState().channelIds,
    }))
    const missingScheduler = new TeamDagScheduler(missingBinding.ctx, config())
    await expect(missingScheduler.drive({ teamId })).rejects.toThrow(/matching durable activation/)
    await missingScheduler.close()

    const duplicate = setup(state([pending], [worker], [binding]))
    const duplicateChannel = await openWakeChannel(duplicate, pending, worker, binding)
    const duplicateAssigned = assignedWakeTask(pending, worker, binding, duplicateChannel)
    duplicate.setState(state([duplicateAssigned], [worker], [binding], {
      team: duplicate.getState().team,
      channelIds: duplicate.getState().channelIds,
    }))
    const stored = duplicate.channels.get(duplicateChannel.manifest.id)
    if (stored === undefined) throw new Error('fake wake channel disappeared')
    stored.records.push(
      recordEnvelope(assignmentEnvelope(duplicateChannel, duplicateAssigned, binding)),
      recordEnvelope(assignmentEnvelope(duplicateChannel, duplicateAssigned, binding, {
        id: 'envelope-duplicate', sequence: duplicateChannel.cursor + 2,
      })),
    )
    const duplicateScheduler = new TeamDagScheduler(duplicate.ctx, config({ channelPageSize: 1 }))
    await expect(duplicateScheduler.drive({ teamId })).rejects.toThrow(/multiple assignment Envelopes/)
    expect(duplicate.teams.readChannelPage).toHaveBeenCalledTimes(2)
    await duplicateScheduler.close()

    const stale = setup(state([pending], [worker], [binding]))
    const staleChannel = await openWakeChannel(stale, pending, worker, binding)
    const staleAssigned = assignedWakeTask(pending, worker, binding, staleChannel)
    stale.setState(state([staleAssigned], [worker], [binding], {
      team: stale.getState().team,
      channelIds: stale.getState().channelIds,
    }))
    const staleStored = stale.channels.get(staleChannel.manifest.id)
    if (staleStored === undefined) throw new Error('fake wake channel disappeared')
    staleStored.records.push(recordEnvelope(assignmentEnvelope(staleChannel, staleAssigned, binding, {
      payload: {
        taskId: staleAssigned.id,
        attemptId: 'attempt-other',
        assignedRevision: staleAssigned.lease?.assignedRevision,
        activationId: binding.activation.id,
        sessionId: binding.sessionId,
      },
    })))
    const staleScheduler = new TeamDagScheduler(stale.ctx, config())
    await expect(staleScheduler.drive({ teamId })).rejects.toThrow(/does not match its current task attempt fence/)
    await staleScheduler.close()
  })

  it('bounds and rotates wake-channel repair, retries a channel cursor race, and stops a denied repair', async () => {
    const first = await recoveryHarness('wake-first')
    const secondWorker = participant('participant-wake-second')
    const secondBinding = activation(secondWorker)
    const secondPending = task('task-wake-second')
    const stateWithSecond = state(
      [first.assigned, secondPending],
      [first.worker, secondWorker],
      [first.binding, secondBinding],
      { team: first.harness.getState().team, channelIds: first.harness.getState().channelIds },
    )
    first.harness.setState(stateWithSecond)
    const secondChannel = await openWakeChannel(first.harness, secondPending, secondWorker, secondBinding)
    const secondAssigned = assignedWakeTask(secondPending, secondWorker, secondBinding, secondChannel)
    first.harness.setState(state(
      [first.assigned, secondAssigned],
      [first.worker, secondWorker],
      [first.binding, secondBinding],
      { team: first.harness.getState().team, channelIds: first.harness.getState().channelIds },
    ))
    const bounded = new TeamDagScheduler(first.harness.ctx, config({ maxWakeDispatchesPerDrive: 1 }))
    await bounded.drive({ teamId })
    expect(first.harness.teams.postChannelEnvelope).toHaveBeenCalledTimes(1)
    await bounded.drive({ teamId })
    expect(first.harness.teams.postChannelEnvelope).toHaveBeenCalledTimes(2)
    await bounded.close()

    const raced = await recoveryHarness('wake-race')
    const originalPost = raced.harness.teams.postChannelEnvelope.getMockImplementation()
    if (originalPost === undefined) throw new Error('fake postChannelEnvelope lost its implementation')
    raced.harness.teams.postChannelEnvelope.mockImplementationOnce(async () => {
      throw new TeamError('stale channel', 'TEAM_CHANNEL_CURSOR_CONFLICT')
    }).mockImplementation(originalPost)
    const racedScheduler = new TeamDagScheduler(raced.harness.ctx, config())
    await racedScheduler.drive({ teamId })
    expect(raced.harness.teams.postChannelEnvelope).toHaveBeenCalledTimes(2)
    await racedScheduler.close()

    const denied = await recoveryHarness('wake-denied')
    denied.harness.teams.postChannelEnvelope.mockRejectedValue(new TeamError('denied', 'TEAM_POLICY_DENIED'))
    const deniedScheduler = new TeamDagScheduler(denied.harness.ctx, config())
    await expect(deniedScheduler.drive({ teamId })).resolves.toBeUndefined()
    expect(denied.harness.teams.postChannelEnvelope).toHaveBeenCalledTimes(1)
    await deniedScheduler.close()
  })

  it('rejects a missing wake lease response plus inactive or misbound assignment channel manifests', async () => {
    const missingLease = setup(state([task('task-missing-wake-lease')], [participant('participant-missing-wake-lease')], [
      activation(participant('participant-missing-wake-lease')),
    ]))
    const missingLeaseScheduler = new TeamDagScheduler(missingLease.ctx, config())
    missingLease.teams.assignTask.mockResolvedValue(task('task-missing-wake-lease', {
      revision: 2,
      phase: 'assigned',
      attemptCount: 1,
      lease: lease(
        'missing-wake-lease',
        participant('participant-missing-wake-lease'),
        activation(participant('participant-missing-wake-lease')).activation.id,
      ),
    }))
    await expect(missingLeaseScheduler.drive({ teamId })).rejects.toThrow(/did not retain an activation-bound wake lease/)
    await missingLeaseScheduler.close()

    const mismatchWorker = participant('participant-mismatched-wake-lease')
    const mismatchBinding = activation(mismatchWorker)
    const mismatchPending = task('task-mismatched-wake-lease')
    const mismatch = setup(state([mismatchPending], [mismatchWorker], [mismatchBinding]))
    mismatch.teams.assignTask.mockResolvedValue(task('task-mismatched-wake-lease', {
      revision: 2,
      phase: 'assigned',
      attemptCount: 1,
      lease: lease('mismatched-wake-lease', mismatchWorker, mismatchBinding.activation.id, {
        assignedRevision: 2,
        wakeChannelId: channelIdSchema.parse('channel-another-wake'),
      }),
    }))
    const mismatchScheduler = new TeamDagScheduler(mismatch.ctx, config())
    await expect(mismatchScheduler.drive({ teamId })).rejects.toThrow(/does not match its selected wake channel and activation/)
    await mismatchScheduler.close()

    const inactive = await recoveryHarness('wake-inactive')
    const inactiveStored = inactive.harness.channels.get(inactive.channel.manifest.id)
    if (inactiveStored === undefined) throw new Error('fake wake channel disappeared')
    inactiveStored.snapshot = channelSnapshotSchema.parse({ ...inactiveStored.snapshot, phase: 'closed' })
    const inactiveScheduler = new TeamDagScheduler(inactive.harness.ctx, config())
    await expect(inactiveScheduler.drive({ teamId })).rejects.toThrow(/is not active/)
    await inactiveScheduler.close()

    const misbound = await recoveryHarness('wake-misbound')
    const misboundStored = misbound.harness.channels.get(misbound.channel.manifest.id)
    if (misboundStored === undefined) throw new Error('fake wake channel disappeared')
    misboundStored.snapshot = channelSnapshotSchema.parse({
      ...misboundStored.snapshot,
      manifest: {
        ...misboundStored.snapshot.manifest,
        limits: {
          ...misboundStored.snapshot.manifest.limits,
          taskId: 'task-another',
        },
      },
    })
    const misboundScheduler = new TeamDagScheduler(misbound.harness.ctx, config())
    await expect(misboundScheduler.drive({ teamId })).rejects.toThrow(/does not match its task lease and activation binding/)
    await misboundScheduler.close()
  })

  it('rereads after a retryable CAS race but does not fall through a policy denial', async () => {
    const first = participant('participant-first')
    const second = participant('participant-second')
    const firstActivation = activation(first)
    const secondActivation = activation(second)
    const one = task('task-one')
    const two = task('task-two')
    const harness = setup(state([one, two], [first, second], [firstActivation, secondActivation]))
    const original = harness.teams.assignTask.getMockImplementation()
    if (original === undefined) throw new Error('fake assignTask lost its implementation')
    harness.teams.assignTask.mockImplementationOnce(async () => {
      throw new TeamError('stale Team cursor', 'TEAM_CURSOR_CONFLICT')
    }).mockImplementation(original)
    const scheduler = new TeamDagScheduler(harness.ctx, config({ maxAssignmentsPerDrive: 1 }))

    await scheduler.drive({ teamId })

    expect(harness.teams.assignTask).toHaveBeenCalledTimes(2)
    const denied = setup(state([one, two], [first, second], [firstActivation, secondActivation]))
    denied.teams.assignTask.mockRejectedValue(new TeamError('denied', 'TEAM_POLICY_DENIED'))
    const deniedScheduler = new TeamDagScheduler(denied.ctx, config({ maxAssignmentsPerDrive: 2 }))
    await expect(deniedScheduler.drive({ teamId })).resolves.toBeUndefined()
    expect(denied.teams.assignTask).toHaveBeenCalledTimes(1)
    await Promise.all([scheduler.close(), deniedScheduler.close()])
  })

  it('fails after bounded retryable conflicts and contains observer failures after assignment commits', async () => {
    const worker = participant('participant-observer')
    const workerActivation = activation(worker)
    const ready = task('task-observer')
    const harness = setup(state([ready], [worker], [workerActivation]))
    harness.teams.assignTask.mockRejectedValue(new TeamError('stale', 'TEAM_TASK_STALE_REVISION'))
    const scheduler = new TeamDagScheduler(harness.ctx, config({ maxConflictsPerDrive: 1 }))

    await expect(scheduler.drive({ teamId })).rejects.toMatchObject({ code: 'TEAM_TASK_STALE_REVISION' })
    // One complete scan is retried after the per-drive conflict budget is
    // exhausted, so the surfaced bounded failure includes both scans.
    expect(harness.teams.assignTask).toHaveBeenCalledTimes(4)

    const observed = setup(state([ready], [worker], [workerActivation]))
    const notices: TeamTaskAssignmentNotice[] = []
    observed.assignmentListeners.push(
      (_scheduler: unknown, _name: unknown, notice: unknown) => { notices.push(notice as TeamTaskAssignmentNotice) },
      () => { throw new Error('listener threw') },
      () => Promise.reject(new Error('listener rejected')),
    )
    const observedScheduler = new TeamDagScheduler(observed.ctx, config({ maxAssignmentsPerDrive: 1 }))
    await observedScheduler.drive({ teamId })
    await Promise.resolve()
    expect(notices).toHaveLength(1)
    expect(Object.isFrozen(notices[0])).toBe(true)
    expect(Object.isFrozen(notices[0]?.task)).toBe(true)
    expect(observed.warnings).toHaveBeenCalledWith(expect.stringContaining('assignment listener threw'))
    expect(observed.warnings).toHaveBeenCalledWith(expect.stringContaining('assignment listener rejected'))
    await Promise.all([scheduler.close(), observedScheduler.close()])
  })

  it('registers Team and channel observation before its initial scan, coalesces later changes, and stops on close', async () => {
    const worker = participant('participant-lifecycle')
    const workerActivation = activation(worker)
    const ready = task('task-lifecycle')
    const harness = setup(state([ready], [worker], [workerActivation]))
    const scheduler = new TeamDagScheduler(harness.ctx, config({ maxAssignmentsPerDrive: 1 }))

    scheduler.start()
    const registrationOrder = harness.on.mock.invocationCallOrder[0]
    const scanOrder = harness.teams.listTeamsPage.mock.invocationCallOrder[0]
    expect(registrationOrder).toBeLessThan(scanOrder ?? Number.POSITIVE_INFINITY)
    await vi.waitFor(() => { expect(harness.teams.assignTask).toHaveBeenCalledTimes(1) })
    scheduler.start()
    expect(harness.on.mock.calls).toHaveLength(2)

    const events = [
      teamEventSchema.parse({ type: 'team/created', team: harness.getState().team }),
      teamEventSchema.parse({ type: 'team/changed', team: harness.getState().team }),
      teamEventSchema.parse({
        type: 'participant/changed', participant: worker, cursor: 2, createdAt: 2,
      }),
      teamEventSchema.parse({
        type: 'activation/changed', binding: workerActivation, cursor: 2, createdAt: 2,
      }),
      teamEventSchema.parse({
        type: 'participant-interrupt/changed',
        interrupt: {
          id: 'interrupt-lifecycle',
          actorId: worker.id,
          target: {
            teamId,
            participantId: worker.id,
            activationId: workerActivation.activation.id,
            sessionId: workerActivation.sessionId,
            provider: workerActivation.provider,
          },
          requestedAt: 2,
        },
        cursor: 2,
        createdAt: 2,
      }),
      teamEventSchema.parse({ type: 'task/changed', task: harness.getState().tasks[0], cursor: 2, createdAt: 2 }),
    ]
    for (const event of events) {
      const callsBeforeEvent = harness.teams.getTeam.mock.calls.length
      harness.emit(event)
      await vi.waitFor(() => { expect(harness.teams.getTeam.mock.calls.length).toBeGreaterThan(callsBeforeEvent) })
    }
    const callsBeforeClose = harness.teams.getTeam.mock.calls.length
    await scheduler.close()
    harness.emit(teamEventSchema.parse({ type: 'team/changed', team: harness.getState().team }))
    await scheduler.drive({ teamId })
    expect(harness.teams.getTeam).toHaveBeenCalledTimes(callsBeforeClose)
  })

  it('drives newly pending same-Team work after a goal change', async () => {
    const worker = participant('participant-goal-change')
    const workerActivation = activation(worker)
    const initial = task('task-goal-change-initial')
    const harness = setup(state([initial], [worker], [workerActivation]))
    const scheduler = new TeamDagScheduler(harness.ctx, config({
      maxAssignmentsPerDrive: 1,
      maxActiveAttemptsPerParticipant: 2,
    }))

    scheduler.start()
    await vi.waitFor(() => { expect(harness.teams.assignTask).toHaveBeenCalledTimes(1) })

    const current = harness.getState()
    const goal = {
      ...current.goal,
      revision: current.goal.revision + 1,
      objective: 'Schedule the task created with this goal update.',
    }
    const followup = task('task-goal-change-followup')
    harness.setState(state([...current.tasks, followup], current.participants, current.activations, {
      team: {
        ...current.team,
        goal,
        cursor: current.team.cursor + 1,
        updatedAt: current.team.updatedAt + 1,
      },
      goal,
      channelIds: current.channelIds,
    }))

    const changed = harness.getState()
    const readsBeforeGoalChange = harness.teams.getTeam.mock.calls.length
    harness.emit(teamEventSchema.parse({
      type: 'goal/changed',
      goal: changed.goal,
      cursor: changed.team.cursor,
      createdAt: changed.team.updatedAt,
    }))

    await vi.waitFor(() => { expect(harness.teams.getTeam.mock.calls.length).toBeGreaterThan(readsBeforeGoalChange) })
    await vi.waitFor(() => { expect(harness.teams.assignTask).toHaveBeenCalledTimes(2) })
    expect(harness.teams.getTeam).toHaveBeenLastCalledWith({ teamId })
    expect(harness.teams.assignTask).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: followup.id }))
    expect(harness.getState().tasks.find(item => item.id === followup.id)).toMatchObject({ phase: 'assigned' })
    await scheduler.close()
  })

  it('joins a current Team drive, retries each state-race class, and returns on an inactive Team', async () => {
    const worker = participant('participant-races')
    const workerActivation = activation(worker)
    const ready = task('task-races')
    const races = [
      'TEAM_INVALID_ARGUMENT',
      'TEAM_PARTICIPANT_NOT_FOUND',
      'TEAM_ACTIVATION_NOT_FOUND',
    ] as const
    for (const code of races) {
      const harness = setup(state([ready], [worker], [workerActivation]))
      const original = harness.teams.assignTask.getMockImplementation()
      if (original === undefined) throw new Error('fake assignTask lost its implementation')
      harness.teams.assignTask.mockImplementationOnce(async () => {
        throw new TeamError('state changed', code)
      }).mockImplementation(original)
      const scheduler = new TeamDagScheduler(harness.ctx, config({ maxAssignmentsPerDrive: 1 }))
      await scheduler.drive({ teamId })
      expect(harness.teams.assignTask).toHaveBeenCalledTimes(2)
      await scheduler.close()
    }

    const inactive = setup(state([ready], [worker], [workerActivation], {
      team: { ...state([], [], []).team, phase: 'completed' },
    }))
    const inactiveScheduler = new TeamDagScheduler(inactive.ctx, config())
    await inactiveScheduler.drive({ teamId })
    expect(inactive.teams.assignTask).not.toHaveBeenCalled()
    await inactiveScheduler.close()
  })

  it('closes a newly opened wake channel when assignment authority does not commit', async () => {
    const worker = participant('participant-unassigned-wake')
    const workerActivation = activation(worker)
    const ready = task('task-unassigned-wake')
    const harness = setup(state([ready], [worker], [workerActivation]))
    harness.teams.assignTask.mockRejectedValueOnce(new TeamError('scheduler proof was revoked', 'TEAM_ACTOR_PROOF_INVALID'))
    const scheduler = new TeamDagScheduler(harness.ctx, config({ maxAssignmentsPerDrive: 1 }))

    await expect(scheduler.drive({ teamId })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })

    expect(harness.teams.openSchedulerWakeChannel).toHaveBeenCalledOnce()
    expect(harness.teams.closeSchedulerFailedWakeChannel).toHaveBeenCalledWith(expect.objectContaining({
      taskId: ready.id,
      activationId: workerActivation.activation.id,
    }))
    const wake = [...harness.channels.values()][0]
    expect(wake?.snapshot.phase).toBe('closed')
    await scheduler.close()
  })

  it('retries a due expiry race, stops an expiry policy denial, and enforces participant load capacity', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100)
    const worker = participant('participant-expiry-race')
    const workerActivation = activation(worker)
    const due = task('task-expiry-race', {
      phase: 'assigned',
      requiredCapabilities: ['missing'],
      attemptCount: 1,
      lease: lease('expiry-race', worker, workerActivation.activation.id, {
        assignedAt: 1, renewedAt: 1, durationMs: 49, expiresAt: 50,
      }),
    })
    const raced = setup(state([due], [worker], [workerActivation]))
    const originalExpiry = raced.teams.expireTaskAttempt.getMockImplementation()
    if (originalExpiry === undefined) throw new Error('fake expireTaskAttempt lost its implementation')
    raced.teams.expireTaskAttempt.mockImplementationOnce(async () => {
      throw new TeamError('activation changed', 'TEAM_INVALID_ARGUMENT')
    }).mockImplementation(originalExpiry)
    const racedScheduler = new TeamDagScheduler(raced.ctx, config())
    await racedScheduler.drive({ teamId })
    expect(raced.teams.expireTaskAttempt).toHaveBeenCalledTimes(2)
    await racedScheduler.close()

    const denied = setup(state([due], [worker], [workerActivation]))
    denied.teams.expireTaskAttempt.mockRejectedValue(new TeamError('denied', 'TEAM_POLICY_DENIED'))
    const deniedScheduler = new TeamDagScheduler(denied.ctx, config())
    await expect(deniedScheduler.drive({ teamId })).resolves.toBeUndefined()
    expect(denied.teams.expireTaskAttempt).toHaveBeenCalledTimes(1)
    await deniedScheduler.close()

    const unexpected = setup(state([due], [worker], [workerActivation]))
    unexpected.teams.expireTaskAttempt.mockRejectedValue(new Error('storage failed'))
    const unexpectedScheduler = new TeamDagScheduler(unexpected.ctx, config())
    await expect(unexpectedScheduler.drive({ teamId })).rejects.toThrow('storage failed')
    await unexpectedScheduler.close()

    const reserved = task('task-capacity-reservation', {
      phase: 'assigned',
      attemptCount: 1,
      lease: lease('capacity', worker, workerActivation.activation.id),
    })
    const capacity = setup(state([reserved, task('task-capacity-ready')], [worker], [workerActivation]))
    const capacityScheduler = new TeamDagScheduler(capacity.ctx, config({ maxActiveAttemptsPerParticipant: 1 }))
    await capacityScheduler.drive({ teamId })
    expect(capacity.teams.assignTask).not.toHaveBeenCalled()
    await capacityScheduler.close()
  })

  it('coalesces a second request behind an in-flight Team read and lets disposal finish it without new mutation', async () => {
    const worker = participant('participant-coalesced')
    const workerActivation = activation(worker)
    const ready = task('task-coalesced')
    const harness = setup(state([ready], [worker], [workerActivation]))
    const gate = Promise.withResolvers<TeamStateSnapshot>()
    harness.teams.getTeam.mockImplementationOnce(async () => await gate.promise)
    const scheduler = new TeamDagScheduler(harness.ctx, config({ maxAssignmentsPerDrive: 1 }))
    const first = scheduler.drive({ teamId })
    const second = scheduler.drive({ teamId })
    expect(second).toBe(first)
    gate.resolve(harness.getState())
    await first
    expect(harness.teams.getTeam.mock.calls.length).toBeGreaterThanOrEqual(3)

    const closingGate = Promise.withResolvers<TeamStateSnapshot>()
    harness.teams.getTeam.mockImplementationOnce(async () => await closingGate.promise)
    const pending = scheduler.drive({ teamId })
    const closing = scheduler.close()
    closingGate.resolve(harness.getState())
    await Promise.all([pending, closing])
    expect(harness.teams.assignTask).toHaveBeenCalledTimes(1)
  })

  it('abandons an initial discovery scan that completes after close', async () => {
    const worker = participant('participant-discovery-close')
    const harness = setup(state([], [worker], [activation(worker)]))
    const listed = Promise.withResolvers<{ readonly items: readonly TeamStateSnapshot['team'][] }>()
    harness.teams.listTeamsPage.mockImplementationOnce(async () => await listed.promise)
    const scheduler = new TeamDagScheduler(harness.ctx, config())
    const initial = scheduler.drive()
    const closing = scheduler.close()
    listed.resolve({ items: [harness.getState().team] })
    await Promise.all([initial, closing])
    expect(harness.teams.getTeam).not.toHaveBeenCalled()
  })

  it('waits only for accepted drives during close, aggregates their rejection, and bounds a hung drive', async () => {
    const worker = participant('participant-disposal')
    const workerActivation = activation(worker)
    const ready = task('task-disposal')
    const failure = setup(state([ready], [worker], [workerActivation]))
    const failedRead = Promise.withResolvers<TeamStateSnapshot>()
    failure.teams.getTeam.mockImplementationOnce(async () => await failedRead.promise)
    const failingScheduler = new TeamDagScheduler(failure.ctx, config())
    const failedDrive = failingScheduler.drive({ teamId })
    const failedClose = failingScheduler.close()
    failedRead.reject(new Error('read failed'))
    await expect(failedDrive).rejects.toThrow('read failed')
    await expect(failedClose).rejects.toMatchObject({ name: 'AggregateError' })

    vi.useFakeTimers()
    const hung = setup(state([ready], [worker], [workerActivation]))
    const hungRead = Promise.withResolvers<TeamStateSnapshot>()
    hung.teams.getTeam.mockImplementationOnce(async () => await hungRead.promise)
    const hungScheduler = new TeamDagScheduler(hung.ctx, config({ disposalTimeoutMs: 10 }))
    const hungDrive = hungScheduler.drive({ teamId })
    const hungClose = hungScheduler.close()
    const hungCloseFailure = expect(hungClose).rejects.toThrow('disposal exceeded 10ms')
    await vi.advanceTimersByTimeAsync(10)
    await hungCloseFailure
    hungRead.resolve(hung.getState())
    await hungDrive
  })

  it('invalidates every retained task-lease proof when the scheduler closes', async () => {
    const worker = participant('participant-task-lease-close')
    const workerActivation = activation(worker)
    const ready = task('task-lease-close')
    const harness = setup(state([ready], [worker], [workerActivation]))
    const scheduler = new TeamDagScheduler(harness.ctx, config())
    const internal = scheduler as unknown as {
      withTaskLeaseProof<T>(
        scope: TeamSystemTaskLeaseScope,
        operation: (actor: TeamSystemTaskLeaseProof) => Promise<T>,
      ): Promise<T>
    }
    const gate = Promise.withResolvers<undefined>()
    let retained: TeamSystemTaskLeaseProof | undefined
    const inFlight = internal.withTaskLeaseProof({
      kind: 'scheduler-task-assign',
      teamId,
      taskId: ready.id,
      expectedRevision: ready.revision,
      participantId: worker.id,
      activationId: workerActivation.activation.id,
      leaseDurationMs: 100,
    }, async (actor) => {
      retained = actor
      await gate.promise
    })
    await vi.waitFor(() => { expect(retained).toBeDefined() })
    const proof = retained
    if (proof === undefined) throw new Error('scheduler did not retain a task-lease proof')
    expect(scheduler.taskLeaseProofSource.resolveTaskLeaseProof(proof)).toMatchObject({
      kind: 'scheduler-task-assign', taskId: ready.id,
    })

    await scheduler.close()

    expect(scheduler.taskLeaseProofSource.resolveTaskLeaseProof(proof)).toBeUndefined()
    gate.resolve(undefined)
    await inFlight
  })

  it('invalidates every retained scheduler channel proof when the scheduler closes', async () => {
    const worker = participant('participant-scheduler-channel-close')
    const workerActivation = activation(worker)
    const ready = task('task-scheduler-channel-close')
    const harness = setup(state([ready], [worker], [workerActivation]))
    const scheduler = new TeamDagScheduler(harness.ctx, config())
    const internal = scheduler as unknown as {
      withSchedulerChannelProof<T>(
        scope: TeamSystemSchedulerChannelScope,
        operation: (actor: TeamSystemSchedulerChannelProof) => Promise<T>,
      ): Promise<T>
    }
    const gate = Promise.withResolvers<undefined>()
    let retained: TeamSystemSchedulerChannelProof | undefined
    const inFlight = internal.withSchedulerChannelProof({
      kind: 'scheduler-channel-delivery-expire',
      teamId,
      channelId: 'channel-scheduler-delivery-close' as never,
      expectedTeamCursor: 1,
      expectedChannelCursor: 2,
      now: 3,
      limit: 1,
    }, async (actor) => {
      retained = actor
      await gate.promise
    })
    await vi.waitFor(() => { expect(retained).toBeDefined() })
    const proof = retained
    if (proof === undefined) throw new Error('scheduler did not retain a scheduler-channel proof')
    expect(scheduler.schedulerChannelProofSource.resolveSchedulerChannelProof(proof)).toMatchObject({
      kind: 'scheduler-channel-delivery-expire', channelId: 'channel-scheduler-delivery-close',
    })

    await scheduler.close()

    expect(scheduler.schedulerChannelProofSource.resolveSchedulerChannelProof(proof)).toBeUndefined()
    gate.resolve(undefined)
    await inFlight
  })

  it('installs through the function-plugin entry and contains an unrenderable observer failure', async () => {
    const worker = participant('participant-apply')
    const workerActivation = activation(worker)
    const ready = task('task-apply')
    const harness = setup(state([ready], [worker], [workerActivation]))
    const unrenderable = { toString() { throw new Error('cannot render') } }
    harness.assignmentListeners.push(() => { throw unrenderable })
    const dispose = apply(harness.ctx, config({ maxAssignmentsPerDrive: 1 }))
    await vi.waitFor(() => { expect(harness.teams.assignTask).toHaveBeenCalledTimes(1) })
    expect(harness.teams.registerSystemTaskLeaseProofSource).toHaveBeenCalledWith(expect.objectContaining({
      name: 'team-scheduler-dag',
    }))
    expect(harness.teams.registerSystemSchedulerChannelProofSource).toHaveBeenCalledWith(expect.objectContaining({
      name: 'team-scheduler-dag',
    }))
    expect(harness.taskLeaseScopes).toEqual([expect.objectContaining({
      kind: 'scheduler-task-assign',
      teamId,
      taskId: ready.id,
      participantId: worker.id,
      activationId: workerActivation.activation.id,
      leaseDurationMs: 100,
    })])
    expect(harness.taskLeaseSource()).toBeDefined()
    expect(harness.schedulerChannelScopes).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: 'scheduler-wake-channel-open',
      teamId,
      taskId: ready.id,
      activationId: workerActivation.activation.id,
    })]))
    await Promise.resolve()
    expect(harness.warnings).toHaveBeenCalledWith(expect.stringContaining('[unrenderable thrown value]'))
    await dispose()
    expect(harness.taskLeaseSource()).toBeUndefined()
  })

  it('registers a private scheduler phase source and stalls unassignable work through its exact proof', async () => {
    const unassignable = task('task-stall-proof')
    const harness = setup(state([unassignable], [], []))
    const dispose = apply(harness.ctx, config({ stallAfterUnassignableDrives: 1 }))
    await vi.waitFor(() => { expect(harness.teams.transitionTeamPhase).toHaveBeenCalledTimes(1) })
    expect(harness.teams.registerSystemPhaseProofSource).toHaveBeenCalledWith(expect.objectContaining({
      name: 'team-scheduler-dag',
    }))
    const transition = harness.teams.transitionTeamPhase.mock.calls[0]?.[0]
    if (transition === undefined) throw new Error('scheduler did not submit a stalled phase transition')
    expect(transition).toMatchObject({
      teamId,
      expectedCursor: 1,
      phase: 'stalled',
      reason: {
        code: 'TASK_NO_ELIGIBLE_OWNER',
        message: 'Ready Team tasks have no eligible active participant or workspace.',
      },
    })
    expect(typeof transition.actor).toBe('object')
    expect(() => JSON.stringify(transition.actor)).toThrow('runtime-only')
    expect(harness.phaseScopes).toEqual([{
      kind: 'scheduler-stall',
      teamId,
      phase: 'stalled',
      reason: {
        code: 'TASK_NO_ELIGIBLE_OWNER',
        message: 'Ready Team tasks have no eligible active participant or workspace.',
      },
    }])
    expect(harness.getState().team).toMatchObject({
      phase: 'stalled',
      stallReason: { code: 'TASK_NO_ELIGIBLE_OWNER' },
    })
    await dispose()
  })

  it.each(['cursor-race', 'storage-failure'] as const)('retries stall admission on a later drive after %s', async (kind) => {
    const harness = setup(state([task('task-stall-admission-retry')], [], []))
    const failure = kind === 'cursor-race'
      ? new TeamError('Team changed before stall admission', 'TEAM_CURSOR_CONFLICT')
      : new Error('Stall append failed')
    harness.teams.transitionTeamPhase.mockRejectedValueOnce(failure)
    const scheduler = new TeamDagScheduler(harness.ctx, config({ stallAfterUnassignableDrives: 1 }))
    const unregister = harness.teams.registerSystemPhaseProofSource(scheduler.phaseProofSource)
    try {
      const first = scheduler.drive({ teamId })
      if (kind === 'cursor-race') await expect(first).resolves.toBeUndefined()
      else await expect(first).rejects.toBe(failure)
      expect(harness.getState().team.phase).toBe('active')
      expect(harness.teams.transitionTeamPhase).toHaveBeenCalledTimes(1)

      await scheduler.drive({ teamId })
      expect(harness.teams.transitionTeamPhase).toHaveBeenCalledTimes(2)
      expect(harness.teams.transitionTeamPhase.mock.calls[1]?.[0].actor)
        .not.toBe(harness.teams.transitionTeamPhase.mock.calls[0]?.[0].actor)
      expect(harness.getState().team).toMatchObject({ phase: 'stalled', stallReason: { code: 'TASK_NO_ELIGIBLE_OWNER' } })
    } finally {
      await scheduler.close()
      unregister()
    }
  })

  it('recovers a durable consult response before requiring an idle reviewer activation', async () => {
    const initiator = participant('participant-review-initiator')
    const reviewer = participant('participant-reviewer')
    const reviewTaskId = teamTaskIdSchema.parse('task-review-recovery')
    const attempt = taskAttemptSnapshotSchema.parse({
      id: 'attempt-review-recovery',
      teamId,
      taskId: reviewTaskId,
      ordinal: 1,
      participantId: initiator.id,
      assignedAt: 1,
      leaseExpiresAt: 3,
      settledAt: 2,
      outcome: { kind: 'completed', result: { summary: 'Ready for recovery.' } },
    })
    const reviewTask = task(String(reviewTaskId), {
      revision: 2,
      phase: 'review',
      reviewPolicy: { kind: 'participant', reviewerId: reviewer.id },
      attemptCount: 1,
      attemptHistory: [attempt],
    })
    const reviewChannelId = channelIdSchema.parse('channel-review-recovery')
    const channel = channelSnapshotSchema.parse({
      manifest: {
        id: reviewChannelId,
        teamId,
        adapter: CONSULT_CHANNEL_ADAPTER_V1,
        participants: [{ id: initiator.id, role: CONSULT_INITIATOR_ROLE }, { id: reviewer.id, role: CONSULT_RESPONDENT_ROLE }],
        limits: {},
      },
      phase: 'closed',
      cursor: 3,
    })
    const request = teamEnvelopeSchema.parse({
      id: 'envelope-review-request-recovery',
      teamId,
      channelId: reviewChannelId,
      sequence: 2,
      senderId: initiator.id,
      audience: [reviewer.id],
      kind: CONSULT_REVIEW_REQUEST_KIND,
      payload: {
        text: 'Review the completed result.',
        taskId: reviewTaskId,
        attemptId: attempt.id,
        reviewRevision: reviewTask.revision,
        reviewerId: reviewer.id,
        initiatorId: initiator.id,
        result: { summary: 'Ready for recovery.' },
      },
      delivery: 'turn',
      taskId: reviewTaskId,
      priority: 'normal',
      createdAt: 1,
    })
    const response = teamEnvelopeSchema.parse({
      id: 'envelope-review-response-recovery',
      teamId,
      channelId: reviewChannelId,
      sequence: 3,
      senderId: reviewer.id,
      audience: [initiator.id],
      kind: CONSULT_RESPONSE_KIND,
      payload: { text: 'Accepted after restart.', decision: 'accepted' },
      delivery: 'turn',
      causationId: request.id,
      taskId: reviewTaskId,
      priority: 'normal',
      createdAt: 2,
    })
    const harness = setup(state([reviewTask], [initiator, reviewer], [], { channelIds: [reviewChannelId] }))
    harness.channels.set(reviewChannelId, {
      snapshot: channel,
      records: [recordEnvelope(request), recordEnvelope(response)],
    })
    const scheduler = new TeamDagScheduler(harness.ctx, config())
    const unregister = harness.teams.registerSystemTaskReviewProofSource(scheduler.taskReviewProofSource)
    try {
      await scheduler.drive({ teamId })
      expect(harness.teams.resolveTaskReviewFromResponse).toHaveBeenCalledTimes(1)
      expect(() => JSON.stringify(harness.teams.resolveTaskReviewFromResponse.mock.calls[0]?.[0].actor)).toThrow('runtime-only')
      expect(harness.getState().tasks).toMatchObject([{
        id: reviewTaskId,
        phase: 'completed',
        reviewHistory: [{ attemptId: attempt.id, reviewerId: reviewer.id, nextPhase: 'completed', reason: 'Accepted after restart.' }],
      }])
    } finally {
      unregister()
      await scheduler.close()
    }
  })

  it('rejects malformed direct configuration before Team operations begin', async () => {
    const worker = participant('participant-config')
    const harness = setup(state([], [worker], [activation(worker)]))
    const invalid = [
      { leaseDurationMs: 0 },
      { maxAssignmentsPerDrive: 0 },
      { maxExpirationsPerDrive: 0 },
      { maxWakeDispatchesPerDrive: 0 },
      { maxConflictsPerDrive: 0 },
      { maxActiveAttemptsPerParticipant: 0 },
      { disposalTimeoutMs: 0 },
      { channelPageSize: 0 },
      { permittedWorkspaceModes: [] },
      { permittedWorkspaceModes: ['shared', 'shared'] },
      { permittedWorkspaceModes: ['worktree'] },
      { terminalChannelRetentionTail: 1 },
      { maxCompactionsPerDrive: 1 },
      { terminalChannelRetentionTail: 0, maxCompactionsPerDrive: 1 },
    ]
    for (const override of invalid) {
      expect(() => new TeamDagScheduler(harness.ctx, Object.assign({}, config(), override) as Config))
        .toThrow(/team-scheduler-dag/)
    }
    expect(harness.teams.getTeam).not.toHaveBeenCalled()
  })
})
