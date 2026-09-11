/** Execute one Team integration task from its durable source-attempt artifacts. */

import {
  TeamError,
  taskAttemptIntegrationResultSchema,
} from '@clocky/clocky-team'
import type {
  ActivationId,
  ParticipantId,
  TaskAttemptId,
  TeamActorProof,
  TeamId,
  TeamRuntime,
  TeamTaskId,
  TeamTaskSnapshot,
} from '@clocky/clocky-team'
import type { TeamWorkspaceRegistry, TeamWorkspaceSourceIntegrateResult } from './index.ts'

/** Runtime-only request for one current activation-owned integration attempt. */
export interface TeamIntegrationTaskExecutionRequest {
  /** Current activation proof that owns the integration task attempt. */
  readonly actor: TeamActorProof
  /** Team identity derived from the Link binding that owns the proof. */
  readonly teamId: TeamId
  /** Participant identity derived from the Link binding that owns the proof. */
  readonly participantId: ParticipantId
  /** Activation epoch derived from the Link binding that owns the proof. */
  readonly activationId: ActivationId
  /** Integration task selected by its durable assignment source. */
  readonly taskId: TeamTaskId
  /** Current integration attempt selected by its durable assignment source. */
  readonly attemptId: TaskAttemptId
  /** Current task revision selected before provider execution. */
  readonly expectedRevision: number
  /** Optional non-empty verification fact retained with the integration result. */
  readonly verification?: string | undefined
}

/**
 * Execute and settle one integration task using only the completed source
 * attempt's artifact manifest. A previously settled attempt is returned
 * without invoking the provider again; an unowned or stale current lease is
 * rejected before any provider-side target mutation.
 * @param teams - authoritative Team runtime owning task and attempt state.
 * @param workspaces - workspace registry resolving the task's provider.
 * @param request - current activation proof, task fence, and optional verification.
 * @returns the detached task snapshot after the durable integration result settles.
 */
export async function executeTeamIntegrationTask(
  teams: TeamRuntime,
  workspaces: TeamWorkspaceRegistry,
  request: TeamIntegrationTaskExecutionRequest,
): Promise<TeamTaskSnapshot> {
  assertIntegrationVerification(request.verification)
  const task = await teams.getTask({ teamId: request.teamId, taskId: request.taskId })
  const binding = await teams.getActivation({ teamId: request.teamId, activationId: request.activationId })
  if (binding.activation.teamId !== request.teamId
    || binding.activation.participantId !== request.participantId
    || (binding.activation.status !== 'idle' && binding.activation.status !== 'running')) {
    throw new TeamError(
      `Team integration task '${request.taskId}' is not owned by a deliverable activation binding`,
      'TEAM_INVALID_ARGUMENT',
    )
  }
  const recorded = task.attemptHistory.find(attempt => attempt.id === request.attemptId)
  if (recorded !== undefined) {
    if (recorded.outcome.kind === 'completed' && recorded.outcome.result.integration !== undefined) return task
    throw new TeamError(
      `Team task '${task.id}' attempt '${request.attemptId}' already retains a non-integration outcome`,
      'TEAM_INVALID_ARGUMENT',
    )
  }
  if (task.phase !== 'running'
    || task.teamId !== request.teamId
    || task.revision !== request.expectedRevision
    || task.lease?.attemptId !== request.attemptId
    || task.lease.participantId !== request.participantId
    || task.lease.activationId !== request.activationId) {
    throw new TeamError(
      `Team integration task '${request.taskId}' is not owned by the current activation attempt`,
      'TEAM_INVALID_ARGUMENT',
    )
  }
  const specification = task.integration
  if (specification === undefined) {
    throw new TeamError(
      `Team task '${task.id}' is not an integration task`,
      'TEAM_INVALID_ARGUMENT',
    )
  }
  const sourceTask = await teams.getTask({ teamId: task.teamId, taskId: specification.sourceTaskId })
  const sourceAttempt = sourceTask.attemptHistory.find(attempt => attempt.id === specification.sourceAttemptId)
  if (sourceTask.teamId !== task.teamId
    || sourceTask.phase !== 'completed'
    || sourceAttempt?.outcome.kind !== 'completed') {
    throw new TeamError(
      `integration source '${specification.sourceTaskId}/${specification.sourceAttemptId}' is not a completed task result`,
      'TEAM_INVALID_ARGUMENT',
    )
  }
  const providerResult = await workspaces.integrateSource(specification.provider, {
    source: {
      teamId: task.teamId,
      taskId: specification.sourceTaskId,
      attemptId: specification.sourceAttemptId,
      artifacts: sourceAttempt.outcome.result.artifacts ?? [],
    },
    integrationTaskId: task.id,
    integrationAttemptId: request.attemptId,
    target: specification.target,
    ...specification.expectedTarget === undefined ? {} : { expectedTarget: specification.expectedTarget },
    mode: specification.mode,
    actorId: request.participantId,
  })
  const integration = integrationResult(specification, providerResult)
  const result = {
    summary: integrationSummary(specification, providerResult),
    ...request.verification === undefined ? {} : { verification: request.verification },
    integration,
  }
  return await teams.settleTaskAttempt({
    actor: request.actor,
    taskId: task.id,
    attemptId: request.attemptId,
    expectedRevision: request.expectedRevision,
    outcome: { kind: 'completed', result: taskAttemptResult(result) },
  })
}

/** Reject blank or padded verification before a provider can perform a side effect. */
function assertIntegrationVerification(value: string | undefined): void {
  if (value !== undefined && (value.length === 0 || value.trim() !== value)) {
    throw new TeamError('integration verification must be non-empty without surrounding whitespace', 'TEAM_INVALID_ARGUMENT')
  }
}

/** Map provider-owned source integration provenance into the durable Team result. */
function integrationResult(
  specification: NonNullable<TeamTaskSnapshot['integration']>,
  providerResult: TeamWorkspaceSourceIntegrateResult,
) {
  return taskAttemptIntegrationResultSchema.parse({
    target: specification.target,
    ...specification.expectedTarget === undefined ? {} : { expectedTarget: specification.expectedTarget },
    status: providerResult.status,
    ...providerResult.targetVersion === undefined ? {} : { targetVersion: providerResult.targetVersion },
    ...(providerResult.status === 'proposed' && providerResult.artifact !== undefined
      ? { proposalArtifact: providerResult.artifact }
      : {}),
    ...(providerResult.status !== 'proposed' && providerResult.artifact !== undefined
      ? { artifacts: [providerResult.artifact] }
      : {}),
    ...providerResult.conflictPaths === undefined ? {} : { conflictPaths: [...providerResult.conflictPaths] },
  })
}

/** Render the bounded durable summary for one provider result. */
function integrationSummary(
  specification: NonNullable<TeamTaskSnapshot['integration']>,
  providerResult: TeamWorkspaceSourceIntegrateResult,
): string {
  if (providerResult.status === 'integrated') return `Integrated source task '${specification.sourceTaskId}' into '${specification.target}'.`
  if (providerResult.status === 'conflict') return `Integration of source task '${specification.sourceTaskId}' into '${specification.target}' has conflicts.`
  return `Prepared an integration proposal for source task '${specification.sourceTaskId}' targeting '${specification.target}'.`
}

/** Parse one complete result before it reaches the Team settlement command. */
function taskAttemptResult(value: {
  readonly summary: string
  readonly verification?: string
  readonly integration: ReturnType<typeof taskAttemptIntegrationResultSchema.parse>
}) {
  return {
    summary: value.summary,
    ...value.verification === undefined ? {} : { verification: value.verification },
    integration: value.integration,
  }
}
