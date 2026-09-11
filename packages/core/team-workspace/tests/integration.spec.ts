import { describe, expect, it, vi } from 'vitest'
import {
  activationIdSchema,
  participantIdSchema,
  taskAttemptIdSchema,
  taskAttemptSnapshotSchema,
  teamTaskIdSchema,
  teamTaskSnapshotSchema,
} from '@clocky/clocky-team'
import type { TeamRuntime, TeamTaskSnapshot } from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import { executeTeamIntegrationTask } from '../src/index.ts'
import type { TeamWorkspaceRegistry } from '../src/index.ts'

const teamId = 'integration-executor-team' as TeamTaskSnapshot['teamId']
const participantId = participantIdSchema.parse('integration-executor-participant')
const activationId = activationIdSchema.parse('integration-executor-activation')
const integrationTaskId = teamTaskIdSchema.parse('integration-executor-task')
const integrationAttemptId = taskAttemptIdSchema.parse('integration-executor-attempt')
const sourceTaskId = teamTaskIdSchema.parse('integration-executor-source')
const sourceAttemptId = taskAttemptIdSchema.parse('integration-executor-source-attempt')
const actor = Object.freeze({}) as never

/** Build one source task with the exact patch provenance consumed by the executor. */
function sourceTask(): TeamTaskSnapshot {
  const attempt = taskAttemptSnapshotSchema.parse({
    id: sourceAttemptId,
    teamId,
    taskId: sourceTaskId,
    ordinal: 1,
    participantId,
    assignedAt: 1,
    leaseExpiresAt: 100,
    settledAt: 10,
    outcome: {
      kind: 'completed',
      result: {
        summary: 'Source change is ready.',
        artifacts: [{
          id: 'local:source-patch',
          kind: 'patch',
          uri: 'artifact://source-patch',
          sourceAttemptId,
          visibility: 'team',
        }],
      },
    },
  })
  return task(sourceTaskId, {
    revision: 3,
    phase: 'completed',
    attemptCount: 1,
    attemptHistory: [attempt],
  })
}

/** Build one running integration task with its current owner lease. */
function integrationTask(overrides: Record<string, unknown> = {}): TeamTaskSnapshot {
  return task(integrationTaskId, {
    revision: 3,
    phase: 'running',
    integration: {
      sourceTaskId,
      sourceAttemptId,
      provider: 'worktree',
      target: 'main',
      expectedTarget: 'base-commit',
      mode: 'integrate',
    },
    attemptCount: 1,
    lease: {
      attemptId: integrationAttemptId,
      assignedRevision: 2,
      ordinal: 1,
      participantId,
      activationId,
      assignedAt: 1,
      durationMs: 100,
      renewedAt: 1,
      expiresAt: 101,
      startedAt: 2,
    },
    ...overrides,
  })
}

/** Build the shared task fields accepted by the Team task snapshot schema. */
function task(id: TeamTaskSnapshot['id'], overrides: Record<string, unknown> = {}): TeamTaskSnapshot {
  return teamTaskSnapshotSchema.parse({
    id,
    teamId,
    revision: 1,
    createCommand: {
      creator: {
        teamId,
        participantId,
        activationId,
        sessionId: SessionId('integration-executor-session'),
        provider: 'in-process',
      },
      idempotencyKey: `integration-executor-create-${String(id)}`,
    },
    subject: 'Run integration.',
    description: 'Apply the source attempt to the target.',
    execution: { kind: 'participant' },
    phase: 'pending',
    blockedBy: [],
    requiredCapabilities: [],
    priority: 0,
    readScopes: [],
    writeScopes: [],
    workspaceMode: 'worktree',
    budget: {},
    reviewPolicy: { kind: 'none' },
    reviewHistory: [],
    maxAttempts: 1,
    attemptCount: 0,
    attemptHistory: [],
    ...overrides,
  })
}

describe('Team artifact-sourced integration executor', () => {
  it('executes through the selected provider and settles the exact integration attempt', async () => {
    const current = integrationTask()
    const source = sourceTask()
    const result = {
      teamId,
      sourceTaskId,
      sourceAttemptId,
      integrationTaskId,
      integrationAttemptId,
      target: 'main',
      status: 'integrated' as const,
      targetVersion: 'merged-commit',
      artifact: source.attemptHistory[0]!.outcome.kind === 'completed'
        ? source.attemptHistory[0]!.outcome.result.artifacts?.[0]
        : undefined,
    }
    const integrateSource = vi.fn(async () => result)
    const settled = teamTaskSnapshotSchema.parse({ ...current, phase: 'completed', lease: undefined, revision: 4, attemptCount: 1, attemptHistory: [{
      id: integrationAttemptId,
      teamId,
      taskId: integrationTaskId,
      ordinal: current.lease!.ordinal,
      participantId,
      activationId,
      assignedAt: current.lease!.assignedAt,
      settledAt: 20,
      leaseExpiresAt: current.lease!.expiresAt,
      outcome: { kind: 'completed', result: { summary: 'Integrated source task.', integration: {
        target: 'main', expectedTarget: 'base-commit', status: 'integrated', targetVersion: 'merged-commit',
      } } },
    }] })
    const settleTaskAttempt = vi.fn(async () => settled)
    const teams = {
      getTask: vi.fn(async ({ taskId }: { readonly taskId: TeamTaskSnapshot['id'] }) => taskId === current.id ? current : source),
      getActivation: vi.fn(async () => ({
        activation: { id: activationId, teamId, participantId, status: 'idle' as const },
        sessionId: SessionId('integration-executor-session'),
        provider: 'in-process',
      })),
      settleTaskAttempt,
    }
    const workspaces = { integrateSource } as unknown as TeamWorkspaceRegistry

    await expect(executeTeamIntegrationTask(teams as unknown as TeamRuntime, workspaces, {
      actor,
      teamId,
      participantId,
      activationId,
      taskId: integrationTaskId,
      attemptId: integrationAttemptId,
      expectedRevision: current.revision,
      verification: 'integration tests passed',
    })).resolves.toBe(settled)
    expect(integrateSource).toHaveBeenCalledWith('worktree', {
      source: {
        teamId,
        taskId: sourceTaskId,
        attemptId: sourceAttemptId,
        artifacts: source.attemptHistory[0]!.outcome.kind === 'completed'
          ? source.attemptHistory[0]!.outcome.result.artifacts
          : [],
      },
      integrationTaskId,
      integrationAttemptId,
      target: 'main',
      expectedTarget: 'base-commit',
      mode: 'integrate',
      actorId: participantId,
    })
    expect(settleTaskAttempt).toHaveBeenCalledOnce()
    const settlement = (settleTaskAttempt.mock.calls as unknown[][])[0]?.[0]
    expect(settlement).toMatchObject({
      taskId: integrationTaskId,
      attemptId: integrationAttemptId,
      expectedRevision: current.revision,
      outcome: {
        kind: 'completed',
        result: {
          integration: { status: 'integrated', targetVersion: 'merged-commit' },
          verification: 'integration tests passed',
        },
      },
    })
  })

  it('does not invoke the provider when the exact integration attempt was already settled', async () => {
    const recorded = taskAttemptSnapshotSchema.parse({
      id: integrationAttemptId,
      teamId,
      taskId: integrationTaskId,
      ordinal: 1,
      participantId,
      activationId,
      assignedAt: 1,
      leaseExpiresAt: 101,
      settledAt: 20,
      outcome: { kind: 'completed', result: { summary: 'Integrated source task.', integration: {
        target: 'main', expectedTarget: 'base-commit', status: 'integrated', targetVersion: 'merged-commit',
      } } },
    })
    const current = integrationTask({ phase: 'completed', lease: undefined, attemptHistory: [recorded], attemptCount: 1, revision: 3 })
    const integrateSource = vi.fn()
    const teams = {
      getTask: vi.fn(async () => current),
      getActivation: vi.fn(async () => ({
        activation: { id: activationId, teamId, participantId, status: 'idle' as const },
        sessionId: SessionId('integration-executor-session'),
        provider: 'in-process',
      })),
    }
    await expect(executeTeamIntegrationTask(teams as unknown as TeamRuntime, { integrateSource } as unknown as TeamWorkspaceRegistry, {
      actor,
      teamId,
      participantId,
      activationId,
      taskId: integrationTaskId,
      attemptId: integrationAttemptId,
      expectedRevision: 2,
    })).resolves.toBe(current)
    expect(integrateSource).not.toHaveBeenCalled()
  })

  it('rejects padded verification before provider execution', async () => {
    const current = integrationTask()
    const source = sourceTask()
    const integrateSource = vi.fn()
    const teams = {
      getTask: vi.fn(async ({ taskId }: { readonly taskId: TeamTaskSnapshot['id'] }) => taskId === current.id ? current : source),
      getActivation: vi.fn(async () => ({
        activation: { id: activationId, teamId, participantId, status: 'idle' as const },
        sessionId: SessionId('integration-executor-session'),
        provider: 'in-process',
      })),
    }
    await expect(executeTeamIntegrationTask(teams as unknown as TeamRuntime, { integrateSource } as unknown as TeamWorkspaceRegistry, {
      actor,
      teamId,
      participantId,
      activationId,
      taskId: integrationTaskId,
      attemptId: integrationAttemptId,
      expectedRevision: current.revision,
      verification: ' padded ',
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(integrateSource).not.toHaveBeenCalled()
  })
})
