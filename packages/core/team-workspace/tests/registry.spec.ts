import { describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import {
  activationBindingSnapshotSchema,
  taskAttemptIdSchema,
  teamWorkspaceAllocationIdSchema,
  teamTaskIdSchema,
  teamTaskSnapshotSchema,
} from '@clocky/clocky-team'
import TeamWorkspaceRegistry, { TeamWorkspaceError } from '../src/index.ts'
import type {
  TeamWorkspaceAllocation,
  TeamWorkspaceAllocationMetadata,
  TeamWorkspaceEligibilityRequest,
  TeamWorkspacePreparation,
  TeamWorkspacePrepareRequest,
  TeamWorkspaceProvider,
  TeamWorkspacePublishResult,
  TeamWorkspaceSourceIntegrateResult,
} from '../src/index.ts'

const task = teamTaskSnapshotSchema.parse({
  id: 'task-workspace-registry',
  teamId: 'team-workspace-registry',
  revision: 1,
  execution: { kind: 'participant' },
  createCommand: {
    creator: {
      teamId: 'team-workspace-registry',
      participantId: 'participant-workspace-registry',
      activationId: 'activation-workspace-registry',
      sessionId: 'session-workspace-registry',
      provider: 'test',
    },
    idempotencyKey: 'task-create-workspace-registry',
  },
  subject: 'Provide a workspace.',
  description: 'Resolve a provider by immutable workspace mode.',
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
  maxAttempts: 1,
  attemptCount: 0,
  attemptHistory: [],
})
const binding = activationBindingSnapshotSchema.parse({
  activation: {
    id: 'activation-workspace-registry',
    teamId: task.teamId,
    participantId: 'participant-workspace-registry',
    status: 'idle',
  },
  sessionId: 'session-workspace-registry',
  provider: 'test',
})
const eligibility: TeamWorkspaceEligibilityRequest = { task, binding }
const request: TeamWorkspacePrepareRequest = {
  teamId: task.teamId,
  taskId: task.id,
  attemptId: taskAttemptIdSchema.parse('attempt-workspace-registry'),
  assignedRevision: 2,
  participantId: binding.activation.participantId,
  activationId: binding.activation.id,
  sessionId: binding.sessionId,
}

/** Return one provider with observable eligibility and allocation delegation. */
function provider(overrides: Partial<TeamWorkspaceProvider> = {}): TeamWorkspaceProvider {
  const metadata: TeamWorkspaceAllocationMetadata = {
    id: teamWorkspaceAllocationIdSchema.parse('workspace-registry-allocation'),
    provider: 'shared-local',
    mode: 'shared',
    teamId: request.teamId,
    taskId: request.taskId,
    attemptId: request.attemptId,
    assignedRevision: request.assignedRevision,
    participantId: request.participantId,
    activationId: request.activationId,
    sessionId: request.sessionId,
  }
  const allocation: TeamWorkspaceAllocation = {
    ...metadata,
    root: '/workspace',
    async release() {},
  }
  const preparation: TeamWorkspacePreparation = {
    ...metadata,
    async materialize() { return allocation },
    async abandon() {},
  }
  return {
    name: 'shared-local',
    modes: ['shared'],
    eligible: vi.fn(async () => true),
    prepare: vi.fn(async () => preparation),
    restore: vi.fn(async () => allocation),
    reconcileRelease: vi.fn(async () => {}),
    ...overrides,
  }
}

/** Mount the service definition into an isolated Cordis root. */
async function setup(): Promise<{ readonly ctx: Context; readonly fiber: Context['fiber'] }> {
  const ctx = new Context()
  const fiber = await ctx.plugin(TeamWorkspaceRegistry)
  return { ctx, fiber }
}

describe('TeamWorkspaceRegistry service definition', () => {
  it('registers effect-scoped providers, resolves each declared mode, and delegates requests', async () => {
    const { ctx, fiber } = await setup()
    const shared = provider()
    const dispose = ctx.teamWorkspaces.registerProvider(shared)

    expect(ctx.teamWorkspaces.getProvider(shared.name)).toBe(shared)
    expect(ctx.teamWorkspaces.listProviders()).toEqual([{ name: shared.name, modes: ['shared'] }])
    expect(ctx.teamWorkspaces.resolve('shared')).toBe(shared)
    await expect(ctx.teamWorkspaces.eligible('shared', eligibility)).resolves.toBe(true)
    const preparation = await ctx.teamWorkspaces.prepare('shared', request)
    await expect(ctx.teamWorkspaces.materialize('shared', request, preparation)).resolves.toMatchObject({ root: '/workspace' })

    const internals = ctx.teamWorkspaces as unknown as {
      readonly providersByMode: Map<'shared', TeamWorkspaceProvider>
    }
    const replacement = provider({ name: 'mode-replacement' })
    internals.providersByMode.set('shared', replacement)
    dispose()
    expect(ctx.teamWorkspaces.getProvider(shared.name)).toBeUndefined()
    expect(ctx.teamWorkspaces.listProviders()).toEqual([])
    expect(ctx.teamWorkspaces.resolve('shared')).toBe(replacement)
    internals.providersByMode.clear()
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects invalid names, empty/repeated modes, and duplicate provider or mode ownership before publication', async () => {
    const { ctx, fiber } = await setup()
    expect(() => ctx.teamWorkspaces.registerProvider(provider({ name: '' }))).toThrow(expect.objectContaining<Partial<TeamWorkspaceError>>({
      code: 'TEAM_WORKSPACE_PROVIDER_INVALID',
    }))
    expect(() => ctx.teamWorkspaces.registerProvider(provider({ name: ' local ' }))).toThrow(expect.objectContaining<Partial<TeamWorkspaceError>>({
      code: 'TEAM_WORKSPACE_PROVIDER_INVALID',
    }))
    expect(() => ctx.teamWorkspaces.registerProvider(provider({ modes: [] }))).toThrow(
      expect.objectContaining<Partial<TeamWorkspaceError>>({ code: 'TEAM_WORKSPACE_PROVIDER_INVALID' }),
    )
    expect(() => ctx.teamWorkspaces.registerProvider(provider({ modes: ['shared', 'shared'] }))).toThrow(expect.objectContaining<Partial<TeamWorkspaceError>>({
      code: 'TEAM_WORKSPACE_PROVIDER_INVALID',
    }))
    expect(() => ctx.teamWorkspaces.registerProvider(provider({ modes: ['unknown' as never] }))).toThrow(expect.objectContaining<Partial<TeamWorkspaceError>>({
      code: 'TEAM_WORKSPACE_PROVIDER_INVALID',
    }))

    const first = provider()
    ctx.teamWorkspaces.registerProvider(first)
    expect(() => ctx.teamWorkspaces.registerProvider(provider())).toThrow(expect.objectContaining<Partial<TeamWorkspaceError>>({
      code: 'TEAM_WORKSPACE_PROVIDER_DUPLICATE',
    }))
    expect(() => ctx.teamWorkspaces.registerProvider(provider({ name: 'other', modes: ['shared'] }))).toThrow(
      expect.objectContaining<Partial<TeamWorkspaceError>>({ code: 'TEAM_WORKSPACE_MODE_DUPLICATE' }),
    )
    expect(ctx.teamWorkspaces.listProviders()).toEqual([{ name: first.name, modes: ['shared'] }])

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('does not let a stale disposer remove a replacement provider and reports an absent mode precisely', async () => {
    const { ctx, fiber } = await setup()
    const first = provider()
    const dispose = ctx.teamWorkspaces.registerProvider(first)
    const replacement = provider({ name: 'replacement' })
    const internals = ctx.teamWorkspaces as unknown as {
      readonly providersByName: Map<string, TeamWorkspaceProvider>
      readonly providersByMode: Map<'shared', TeamWorkspaceProvider>
    }
    internals.providersByName.set(first.name, replacement)
    internals.providersByMode.set('shared', replacement)

    dispose()
    expect(ctx.teamWorkspaces.getProvider(first.name)).toBe(replacement)
    expect(ctx.teamWorkspaces.resolve('shared')).toBe(replacement)
    expect(() => ctx.teamWorkspaces.resolve('worktree')).toThrow(expect.objectContaining<Partial<TeamWorkspaceError>>({
      code: 'TEAM_WORKSPACE_MODE_UNAVAILABLE',
    }))
    internals.providersByName.clear()
    internals.providersByMode.clear()

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('removes a provider when its contributing Cordis fiber unloads', async () => {
    const { ctx, fiber } = await setup()
    const shared = provider()
    const contribution = await ctx.plugin(Object.assign(
      (context: Context) => { context.teamWorkspaces.registerProvider(shared) },
      { inject: ['teamWorkspaces'] },
    ))

    expect(ctx.teamWorkspaces.resolve('shared')).toBe(shared)
    await contribution.dispose()
    expect(ctx.teamWorkspaces.getProvider(shared.name)).toBeUndefined()
    expect(() => ctx.teamWorkspaces.resolve('shared')).toThrow(expect.objectContaining<Partial<TeamWorkspaceError>>({
      code: 'TEAM_WORKSPACE_MODE_UNAVAILABLE',
    }))
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('abandons and rejects prepared metadata that does not preserve the selected attempt identity', async () => {
    const { ctx, fiber } = await setup()
    const abandon = vi.fn(async () => {})
    const malformed: TeamWorkspacePreparation = {
      id: teamWorkspaceAllocationIdSchema.parse('workspace-registry-malformed'),
      provider: 'shared-local',
      mode: 'shared',
      teamId: request.teamId,
      taskId: request.taskId,
      attemptId: taskAttemptIdSchema.parse('other-attempt'),
      assignedRevision: request.assignedRevision,
      participantId: request.participantId,
      activationId: request.activationId,
      sessionId: request.sessionId,
      async materialize() { throw new Error('malformed preparation must not materialize') },
      abandon,
    }
    ctx.teamWorkspaces.registerProvider(provider({ prepare: vi.fn(async () => malformed) }))

    await expect(ctx.teamWorkspaces.prepare('shared', request)).rejects.toMatchObject({
      code: 'TEAM_WORKSPACE_ALLOCATION_MISMATCH',
    })
    expect(abandon).toHaveBeenCalledTimes(1)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('contains a mismatched materialization cleanup failure with the primary identity error', async () => {
    const { ctx, fiber } = await setup()
    const cleanupFailure = new Error('release failed')
    const malformed: TeamWorkspaceAllocation = {
      id: teamWorkspaceAllocationIdSchema.parse('workspace-registry-allocation'),
      provider: 'shared-local',
      mode: 'shared',
      teamId: request.teamId,
      taskId: request.taskId,
      attemptId: request.attemptId,
      assignedRevision: request.assignedRevision + 1,
      participantId: request.participantId,
      activationId: request.activationId,
      sessionId: request.sessionId,
      root: '/workspace',
      async release() { throw cleanupFailure },
    }
    const preparation: TeamWorkspacePreparation = {
      id: teamWorkspaceAllocationIdSchema.parse('workspace-registry-allocation'),
      provider: 'shared-local',
      mode: 'shared',
      teamId: request.teamId,
      taskId: request.taskId,
      attemptId: request.attemptId,
      assignedRevision: request.assignedRevision,
      participantId: request.participantId,
      activationId: request.activationId,
      sessionId: request.sessionId,
      async materialize() { return malformed },
      async abandon() {},
    }
    ctx.teamWorkspaces.registerProvider(provider({ prepare: vi.fn(async () => preparation) }))

    const accepted = await ctx.teamWorkspaces.prepare('shared', request)
    const result = await ctx.teamWorkspaces.materialize('shared', request, accepted).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(result).toBeInstanceOf(AggregateError)
    if (!(result instanceof AggregateError)) throw new Error('allocation cleanup did not retain both errors')
    const errors = [...(result.errors as Iterable<unknown>)]
    expect(errors[0]).toMatchObject({ code: 'TEAM_WORKSPACE_ALLOCATION_MISMATCH' })
    expect(errors[1]).toBe(cleanupFailure)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('delegates release reconciliation only for exact provider-owned metadata', async () => {
    const { ctx, fiber } = await setup()
    const reconcileRelease = vi.fn(async () => {})
    ctx.teamWorkspaces.registerProvider(provider({ reconcileRelease }))
    const preparation = await ctx.teamWorkspaces.prepare('shared', request)

    await ctx.teamWorkspaces.reconcileRelease('shared', request, preparation)
    expect(reconcileRelease).toHaveBeenCalledWith(request, preparation)

    await expect(ctx.teamWorkspaces.reconcileRelease('shared', request, {
      ...preparation,
      provider: 'other-provider',
    })).rejects.toMatchObject({ code: 'TEAM_WORKSPACE_ALLOCATION_MISMATCH' })
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('accepts publish provenance only for the selected allocation attempt', async () => {
    const { ctx, fiber } = await setup()
    const preparation = await provider().prepare(request)
    const allocation = await preparation.materialize()
    const published: TeamWorkspacePublishResult = {
      teamId: request.teamId,
      taskId: request.taskId,
      attemptId: request.attemptId,
      changedPaths: ['src/index.ts'],
      artifacts: [],
      accepted: false,
    }
    const publish = vi.fn(async () => published)
    const disposeInitial = ctx.teamWorkspaces.registerProvider(provider({ publish }))
    await expect(ctx.teamWorkspaces.publish('shared', { allocation })).resolves.toEqual(published)
    expect(publish).toHaveBeenCalledOnce()

    const malformed = { ...published, attemptId: taskAttemptIdSchema.parse('other-attempt') }
    disposeInitial()
    const badProvider = provider({ name: 'bad-publish', publish: vi.fn(async () => malformed) })
    const dispose = ctx.teamWorkspaces.registerProvider(badProvider)
    await expect(ctx.teamWorkspaces.publish('shared', { allocation })).rejects.toMatchObject({
      code: 'TEAM_WORKSPACE_ALLOCATION_MISMATCH',
    })
    dispose()
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('accepts source-artifact integration only when every task attempt identity is preserved', async () => {
    const { ctx, fiber } = await setup()
    const integrationTaskId = teamTaskIdSchema.parse('integration-workspace-registry')
    const integrationAttemptId = taskAttemptIdSchema.parse('integration-attempt-workspace-registry')
    const source = {
      source: {
        teamId: request.teamId,
        taskId: request.taskId,
        attemptId: request.attemptId,
        artifacts: [{ id: 'artifact', kind: 'patch' as const, uri: 'artifact://patch', sourceAttemptId: request.attemptId, visibility: 'team' as const }],
      },
      integrationTaskId,
      integrationAttemptId,
      target: 'main',
      expectedTarget: 'base-commit',
      mode: 'integrate' as const,
      actorId: request.participantId,
    }
    const result: TeamWorkspaceSourceIntegrateResult = {
      teamId: request.teamId,
      sourceTaskId: request.taskId,
      sourceAttemptId: request.attemptId,
      integrationTaskId,
      integrationAttemptId,
      target: source.target,
      status: 'integrated',
      targetVersion: 'target-version',
    }
    const integrateSource = vi.fn(async () => result)
    const dispose = ctx.teamWorkspaces.registerProvider(provider({ integrateSource }))
    await expect(ctx.teamWorkspaces.integrateSource('shared-local', source)).resolves.toEqual(result)
    expect(integrateSource).toHaveBeenCalledWith(source)

    dispose()
    const malformed = provider({
      name: 'bad-source-integration',
      integrateSource: vi.fn(async () => ({ ...result, sourceTaskId: teamTaskIdSchema.parse('other-source-task') })),
    })
    const badDispose = ctx.teamWorkspaces.registerProvider(malformed)
    await expect(ctx.teamWorkspaces.integrateSource('bad-source-integration', source)).rejects.toMatchObject({
      code: 'TEAM_WORKSPACE_SOURCE_MISMATCH',
    })
    badDispose()
    const artifactMismatch = provider({
      name: 'bad-source-artifact',
      integrateSource: vi.fn(async () => ({
        ...result,
        artifact: {
          id: 'unrelated-artifact',
          kind: 'patch' as const,
          uri: 'artifact://unrelated',
          sourceAttemptId: taskAttemptIdSchema.parse('unrelated-attempt'),
          visibility: 'team' as const,
        },
      })),
    })
    const artifactDispose = ctx.teamWorkspaces.registerProvider(artifactMismatch)
    await expect(ctx.teamWorkspaces.integrateSource('bad-source-artifact', source)).rejects.toMatchObject({
      code: 'TEAM_WORKSPACE_SOURCE_MISMATCH',
    })
    artifactDispose()
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
