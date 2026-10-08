import { describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import {
  activationBindingSnapshotSchema,
  participantSnapshotSchema,
  taskAttemptIdSchema,
  teamWorkspaceAllocationIdSchema,
  teamTaskIdSchema,
  teamTaskSnapshotSchema,
} from '@clocky/clocky-team'
import TeamWorkspaceRegistry, { TeamWorkspaceError, TeamWorkspaceReservations, isStoredTeamWorkspaceManifestHeader, isTeamWorkspaceIntegrationMarkerBase } from '../src/index.ts'
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
  createdAt: 0,
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


it.each([undefined, null, [], 1, 'invalid'])('refuses a non-object durable integration marker %j', (value) => {
  expect(isTeamWorkspaceIntegrationMarkerBase(value)).toBe(false)
  expect(isStoredTeamWorkspaceManifestHeader(value, 1)).toBe(false)
})

it('retains a replacement physical creation when late cleanup of a terminated earlier attempt runs', async () => {
  const reservations = new TeamWorkspaceReservations()
  const retired = Promise.withResolvers<TeamWorkspaceAllocation>()
  const current = Promise.withResolvers<TeamWorkspaceAllocation>()
  const allocation: TeamWorkspaceAllocation = { id: teamWorkspaceAllocationIdSchema.parse('generation'), provider: 'shared-local',
    mode: 'shared', ...request, root: process.cwd(), async release() {} }
  const failure = new Error('Physical creation terminated')
  const first = reservations.materialize('key', () => retired.promise)
  const rejected = expect(first).rejects.toBe(failure)
  retired.reject(failure)
  // The owning provider withdraws a known-terminated operation before its Promise cleanup is scheduled.
  reservations.materializations.delete('key')
  const second = reservations.materialize('key', () => current.promise)
  await rejected
  expect(reservations.materializations.has('key')).toBe(true)
  current.resolve(allocation)
  await expect(second).resolves.toBe(allocation)
  expect(reservations.materializations.has('key')).toBe(false)
})


it('refuses duplicate live allocation publishers and leaves a replacement live after repeated old retirement', async () => {
  const { ctx } = await setup()
  const owner = {}
  const publisher = { publish: vi.fn(async () => undefined) }
  const input = { taskId: task.id, attemptId: request.attemptId, allocationId: teamWorkspaceAllocationIdSchema.parse('allocation'),
    expectedRevision: 1, signal: new AbortController().signal }
  try {
    const retire = ctx.teamWorkspaces.registerAllocationPublisher(owner, publisher)
    expect(() => ctx.teamWorkspaces.registerAllocationPublisher(owner, publisher))
      .toThrow(expect.objectContaining({ code: 'TEAM_WORKSPACE_ALLOCATION_MISMATCH' }))
    retire()
    const replacement = { publish: vi.fn(async () => undefined) }
    ctx.teamWorkspaces.registerAllocationPublisher(owner, replacement)
    retire()
    await expect(ctx.teamWorkspaces.publishForOwner(owner, input)).resolves.toBeUndefined()
    expect(replacement.publish).toHaveBeenCalledWith(input)
    expect(publisher.publish).not.toHaveBeenCalled()
  } finally { await ctx.fiber.dispose() }
})

it('accepts a provider without preflight while preserving an explicit route and participant request', async () => {
  const { ctx } = await setup()
  try {
    ctx.teamWorkspaces.registerProvider(provider())
    const participant = participantSnapshotSchema.parse({ id: request.participantId, teamId: task.teamId, kind: 'local-agent',
      displayName: 'Worker', role: 'worker', capabilities: [], phase: 'active' })
    await expect(ctx.teamWorkspaces.preflight('shared', { task, participant,
      route: { provider: 'test', model: 'model', cwd: process.cwd() } })).resolves.toBe(true)
  } finally { await ctx.fiber.dispose() }
})

it('observes abandonment failure together with the original invalid preparation identity', async () => {
  const { ctx } = await setup()
  const abandonFailure = new Error('Abandonment failed')
  const valid = await provider().prepare(request)
  try {
    ctx.teamWorkspaces.registerProvider(provider({ prepare: async () => ({ ...valid, provider: 'foreign',
      abandon: async () => { throw abandonFailure } }) }))
    await expect(ctx.teamWorkspaces.prepare('shared', request)).rejects.toMatchObject({ errors: [
      expect.objectContaining({ code: 'TEAM_WORKSPACE_ALLOCATION_MISMATCH' }), abandonFailure,
    ] })
  } finally { await ctx.fiber.dispose() }
})

it('refuses mismatched reservation metadata before invoking physical materialization', async () => {
  const { ctx } = await setup()
  const valid = await provider().prepare(request)
  const materialize = vi.fn(async () => await valid.materialize())
  try {
    ctx.teamWorkspaces.registerProvider(provider())
    await expect(ctx.teamWorkspaces.materialize('shared', request, { ...valid, provider: 'foreign', materialize }))
      .rejects.toMatchObject({ code: 'TEAM_WORKSPACE_ALLOCATION_MISMATCH' })
    expect(materialize).not.toHaveBeenCalled()
  } finally { await ctx.fiber.dispose() }
})

it('refuses foreign recovery metadata before restore, then releases a foreign restored allocation', async () => {
  const { ctx } = await setup()
  const valid = await provider().prepare(request)
  const allocation = await valid.materialize()
  const releaseFailure = new Error('Restore cleanup failed')
  const release = vi.fn(async () => {})
  const restore = vi.fn(async () => ({ ...allocation, provider: 'foreign', release }))
  try {
    ctx.teamWorkspaces.registerProvider(provider({ restore }))
    await expect(ctx.teamWorkspaces.restore('shared', request, { ...valid, provider: 'foreign' }))
      .rejects.toMatchObject({ code: 'TEAM_WORKSPACE_ALLOCATION_MISMATCH' })
    expect(restore).not.toHaveBeenCalled()
    await expect(ctx.teamWorkspaces.restore('shared', request, valid)).rejects.toMatchObject({ code: 'TEAM_WORKSPACE_ALLOCATION_MISMATCH' })
    expect(release).toHaveBeenCalledOnce()
    release.mockRejectedValueOnce(releaseFailure)
    await expect(ctx.teamWorkspaces.restore('shared', request, valid)).rejects.toMatchObject({ errors: [
      expect.objectContaining({ code: 'TEAM_WORKSPACE_ALLOCATION_MISMATCH' }), releaseFailure,
    ] })
  } finally { await ctx.fiber.dispose() }
})

it('refuses unavailable publication and integration capabilities rather than implying successful effects', async () => {
  const { ctx } = await setup()
  const allocation = await (await provider().prepare(request)).materialize()
  try {
    ctx.teamWorkspaces.registerProvider(provider())
    await expect(ctx.teamWorkspaces.publish('shared', { allocation })).rejects.toMatchObject({ code: 'TEAM_WORKSPACE_MODE_UNAVAILABLE' })
    await expect(ctx.teamWorkspaces.integrate('shared', { allocation, target: 'main', mode: 'proposal' }))
      .rejects.toMatchObject({ code: 'TEAM_WORKSPACE_MODE_UNAVAILABLE' })
    await expect(ctx.teamWorkspaces.integrateSource('shared-local', { source: { teamId: task.teamId, taskId: task.id,
      attemptId: request.attemptId, artifacts: [] }, integrationTaskId: task.id, integrationAttemptId: request.attemptId,
    target: 'main', mode: 'proposal' })).rejects.toMatchObject({ code: 'TEAM_WORKSPACE_MODE_UNAVAILABLE' })
  } finally { await ctx.fiber.dispose() }
})

it('requires integrated allocation results to preserve their exact owner tuple and target', async () => {
  const { ctx } = await setup()
  const allocation = await (await provider().prepare(request)).materialize()
  const result = { teamId: task.teamId, taskId: task.id, attemptId: request.attemptId, target: 'main',
    status: 'proposed' as const, accepted: true }
  const integrate = vi.fn(async () => result)
  try {
    ctx.teamWorkspaces.registerProvider(provider({ integrate }))
    const input = { allocation, target: 'main', mode: 'proposal' as const }
    await expect(ctx.teamWorkspaces.integrate('shared', input)).resolves.toBe(result)
    integrate.mockResolvedValueOnce({ ...result, target: 'foreign' })
    await expect(ctx.teamWorkspaces.integrate('shared', input)).rejects.toMatchObject({ code: 'TEAM_WORKSPACE_ALLOCATION_MISMATCH' })
  } finally { await ctx.fiber.dispose() }
})


it('releases a mismatched physical allocation successfully before retaining its primary refusal', async () => {
  const { ctx } = await setup()
  const valid = await provider().prepare(request)
  const allocation = await valid.materialize()
  const release = vi.fn(async () => {})
  const malformed = { ...allocation, taskId: teamTaskIdSchema.parse('foreign-task'), release }
  try {
    ctx.teamWorkspaces.registerProvider(provider())
    await expect(ctx.teamWorkspaces.materialize('shared', request, { ...valid, materialize: async () => malformed }))
      .rejects.toMatchObject({ code: 'TEAM_WORKSPACE_ALLOCATION_MISMATCH' })
    expect(release).toHaveBeenCalledOnce()
  } finally { await ctx.fiber.dispose() }
})

it('restores the exact retained allocation rather than generating another physical root', async () => {
  const { ctx } = await setup()
  const valid = await provider().prepare(request)
  const allocation = await valid.materialize()
  const restore = vi.fn(async () => allocation)
  try {
    ctx.teamWorkspaces.registerProvider(provider({ restore }))
    await expect(ctx.teamWorkspaces.restore('shared', request, valid)).resolves.toBe(allocation)
    expect(restore).toHaveBeenCalledWith(request, valid)
  } finally { await ctx.fiber.dispose() }
})


it('refuses an unregistered owner object even when its public identity matches another live owner', async () => {
  const { ctx } = await setup()
  const owner = { id: 'same-agent' }
  const publisher = { publish: vi.fn(async () => undefined) }
  try {
    ctx.teamWorkspaces.registerAllocationPublisher(owner, publisher)
    await expect(ctx.teamWorkspaces.publishForOwner({ id: owner.id }, { taskId: task.id, attemptId: request.attemptId,
      allocationId: teamWorkspaceAllocationIdSchema.parse('allocation'), expectedRevision: 1, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'TEAM_WORKSPACE_ALLOCATION_MISMATCH' })
    expect(publisher.publish).not.toHaveBeenCalled()
  } finally { await ctx.fiber.dispose() }
})

it('delegates explicit preflight refusals rather than replacing them with the default compatibility result', async () => {
  const { ctx } = await setup()
  const preflight = vi.fn(async () => false)
  try {
    ctx.teamWorkspaces.registerProvider(provider({ preflight }))
    const input = { task, participant: participantSnapshotSchema.parse({ id: request.participantId, teamId: task.teamId,
      kind: 'local-agent', displayName: 'Worker', role: 'worker', capabilities: [], phase: 'active' }),
    route: { provider: 'test', model: 'model', cwd: process.cwd() } }
    await expect(ctx.teamWorkspaces.preflight('shared', input)).resolves.toBe(false)
    expect(preflight).toHaveBeenCalledWith(input)
  } finally { await ctx.fiber.dispose() }
})
