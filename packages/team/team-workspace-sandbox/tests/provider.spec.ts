import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import TeamWorkspaceRegistry from '@clocky/clocky-team-workspace'
import type {
  TeamWorkspaceAllocation,
  TeamWorkspacePrepareRequest,
  TeamWorkspaceSourceIntegrateRequest,
} from '@clocky/clocky-team-workspace'
import type { TaskAttemptId, TeamTaskSnapshot } from '@clocky/clocky-team'
import * as SandboxWorkspace from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function freshRoot(prefix: string): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  const root = await mkdtemp(join(parent, prefix))
  roots.push(root)
  return root
}

function fixture(sourceRoot: string, allocationParent: string) {
  const teamId = 'sandbox-team' as never
  const taskId = 'sandbox-task' as never
  const attemptId = 'sandbox-attempt' as never
  const participantId = 'sandbox-participant' as never
  const activationId = 'sandbox-activation' as never
  const sessionId = 'sandbox-session' as never
  const binding = {
    activation: { id: activationId, teamId, participantId, status: 'idle' as const },
    sessionId,
    provider: 'in-process',
  }
  const task = {
    id: taskId,
    teamId,
    revision: 2,
    workspaceMode: 'sandbox' as const,
    phase: 'assigned' as const,
    lease: {
      attemptId,
      assignedRevision: 3,
      participantId,
      activationId,
      expiresAt: Date.now() + 60_000,
    },
  } as unknown as TeamTaskSnapshot
  const state = {
    team: { id: teamId, phase: 'active' as const },
    tasks: [task],
    participants: [{ id: participantId, teamId, kind: 'local-agent' as const, phase: 'active' as const }],
    activations: [binding],
  }
  const teams = {
    getTeam: vi.fn(async () => state),
    authorize: vi.fn(async () => ({ kind: 'allow' as const })),
  }
  const agent = { session: { id: sessionId } }
  const agents = { get: vi.fn(() => agent) }
  const artifactBytes = new Map<string, Uint8Array>()
  const saves = vi.fn(async (_provider: string, request: {
    readonly name?: string
    readonly sourceAttemptId?: TaskAttemptId
    readonly kind: 'file' | 'patch'
    readonly visibility: 'team'
    readonly data: Uint8Array | string
  }) => {
    const id = `artifact:${request.kind}:${request.name}`
    artifactBytes.set(id, typeof request.data === 'string' ? new TextEncoder().encode(request.data) : Uint8Array.from(request.data))
    return {
      id,
      provider: 'test-artifacts',
      kind: request.kind,
      uri: `artifact://${request.name}`,
      sourceAttemptId: request.sourceAttemptId,
      visibility: request.visibility,
    }
  })
  const request: TeamWorkspacePrepareRequest = {
    teamId,
    taskId,
    attemptId,
    assignedRevision: 3,
    participantId,
    activationId,
    sessionId,
  }
  const reads = vi.fn(async (_provider: string, input: { readonly reference: { readonly id: string } }) => {
    const bytes = artifactBytes.get(input.reference.id)
    if (bytes === undefined) throw new Error(`missing artifact ${input.reference.id}`)
    return Uint8Array.from(bytes)
  })
  return { state, teams, agents, saves, reads, request, task, binding, sourceRoot, allocationParent }
}

async function setup(options: {
  readonly source?: boolean
  readonly artifact?: boolean
  readonly integration?: boolean
  readonly maxArtifactBytes?: number
  readonly maxIntegrationBytes?: number
} = {}) {
  const sourceRoot = await freshRoot('team-workspace-sandbox-source-')
  const allocationParent = await freshRoot('team-workspace-sandbox-allocations-')
  const integrationRoot = await freshRoot('team-workspace-sandbox-integration-')
  if (options.source !== false) await writeFile(join(sourceRoot, 'seed.txt'), 'seed\n')
  const harness = fixture(sourceRoot, allocationParent)
  const ctx = new Context()
  ctx.provide('teams', harness.teams as never)
  ctx.provide('agents', harness.agents as never)
  if (options.artifact === true) ctx.provide('teamArtifacts', { save: harness.saves, read: harness.reads } as never)
  await ctx.plugin(TeamWorkspaceRegistry)
  await ctx.plugin(SandboxWorkspace, {
    allocationParent,
    ...(options.source === false ? {} : { sourceRoot }),
    ...(options.artifact === true || options.integration === true ? { artifactProvider: 'test-artifacts' } : {}),
    ...(options.integration === true ? { integrationRoot, integrationEnabled: true } : {}),
    maxArtifactBytes: options.maxArtifactBytes ?? 128,
    maxIntegrationBytes: options.maxIntegrationBytes ?? 4096,
  })
  return { ctx, harness, integrationRoot }
}

describe('local Team sandbox workspace provider', () => {
  it('allocates after the Team check, restores from its manifest, publishes changes, and releases only its own root', async () => {
    const { ctx, harness } = await setup({ artifact: true })
    const preparation = await ctx.teamWorkspaces.prepare('sandbox', harness.request)
    expect('root' in preparation).toBe(false)
    const allocation = await ctx.teamWorkspaces.materialize('sandbox', harness.request, preparation)
    expect(allocation.root).toContain(harness.allocationParent)
    expect(await readFile(join(allocation.root, 'seed.txt'), 'utf8')).toBe('seed\n')

    await writeFile(join(allocation.root, 'changed.txt'), 'changed\n')
    await writeFile(join(allocation.root, 'seed.txt'), 'updated\n')
    const published = await ctx.teamWorkspaces.publish('sandbox', { allocation })
    expect(published).toMatchObject({
      teamId: harness.request.teamId,
      taskId: harness.request.taskId,
      attemptId: harness.request.attemptId,
      accepted: false,
      changedPaths: ['changed.txt', 'seed.txt'],
    })
    expect(published.artifacts).toHaveLength(2)
    expect(harness.saves).toHaveBeenCalledTimes(2)

    const provider = ctx.teamWorkspaces.getProvider('sandbox-local')
    if (provider === undefined) throw new Error('sandbox provider was not registered')
    const internals = provider as unknown as {
      readonly allocations: Map<string, TeamWorkspaceAllocation>
      readonly preparations: Map<string, unknown>
    }
    internals.allocations.clear()
    internals.preparations.clear()
    const restored = await ctx.teamWorkspaces.restore('sandbox', harness.request, allocation)
    expect(restored.root).toBe(allocation.root)
    expect(await readFile(join(restored.root, 'changed.txt'), 'utf8')).toBe('changed\n')

    await restored.release()
    await expect(stat(restored.root)).rejects.toMatchObject({ code: 'ENOENT' })
    const remaining = await readdir(harness.allocationParent)
    expect(remaining).toEqual([])
    await ctx.fiber.dispose()
  })

  it('reuses an existing sandbox root, reconciles its live allocation, and bounds large artifacts', async () => {
    const { ctx, harness } = await setup({ artifact: true })
    const preparation = await ctx.teamWorkspaces.prepare('sandbox', harness.request)
    const allocation = await ctx.teamWorkspaces.materialize('sandbox', harness.request, preparation)
    const provider = ctx.teamWorkspaces.getProvider('sandbox-local')
    if (provider === undefined) throw new Error('sandbox provider was not registered')
    const internals = provider as unknown as {
      readonly allocations: Map<string, TeamWorkspaceAllocation>
    }
    internals.allocations.clear()
    const reopened = await preparation.materialize()
    expect(reopened.root).toBe(allocation.root)
    await writeFile(join(reopened.root, 'large.bin'), 'a'.repeat(129))
    await expect(ctx.teamWorkspaces.publish('sandbox', { allocation: reopened })).resolves.toMatchObject({
      changedPaths: ['large.bin'],
      artifacts: [],
    })
    await provider.reconcileRelease(harness.request, reopened)
    await reopened.release()
    await allocation.release()
    await ctx.fiber.dispose()
  })

  it('covers eligibility fences, reservation reuse, abandonment, and release reconciliation', async () => {
    const { ctx, harness } = await setup()
    const provider = ctx.teamWorkspaces.getProvider('sandbox-local')
    if (provider === undefined) throw new Error('sandbox provider was not registered')
    expect(provider.name).toBe('sandbox-local')
    await expect(ctx.teamWorkspaces.eligible('sandbox', { task: harness.task, binding: harness.binding })).resolves.toBe(true)
    await expect(provider.eligible({
      task: { ...harness.task, workspaceMode: 'shared' } as never,
      binding: harness.binding,
    })).resolves.toBe(false)

    const variants = [
      { ...harness.state, team: { ...harness.state.team, phase: 'completed' } },
      { ...harness.state, tasks: [] },
      { ...harness.state, tasks: [{ ...harness.task, revision: harness.task.revision + 1 }] },
      { ...harness.state, tasks: [{ ...harness.task, workspaceMode: 'shared' as const }] },
      { ...harness.state, participants: [{ ...harness.state.participants[0], phase: 'left' as const }] },
      { ...harness.state, activations: [] },
      { ...harness.state, activations: [{ ...harness.binding, provider: 'other' }] },
      { ...harness.state, activations: [{ ...harness.binding, activation: { ...harness.binding.activation, status: 'offline' as const } }] },
    ]
    for (const state of variants) {
      harness.teams.getTeam.mockResolvedValue(state as never)
      await expect(provider.eligible({ task: harness.task, binding: harness.binding })).resolves.toBe(false)
    }
    harness.teams.getTeam.mockResolvedValue(harness.state)
    harness.agents.get.mockReturnValue({ session: { id: 'other-session' } } as never)
    await expect(provider.eligible({ task: harness.task, binding: harness.binding })).resolves.toBe(false)
    harness.agents.get.mockReturnValue({ session: { id: harness.request.sessionId } } as never)

    const abandoned = await ctx.teamWorkspaces.prepare('sandbox', harness.request)
    const internals = provider as unknown as {
      readonly allocations: Map<string, TeamWorkspaceAllocation>
      readonly preparations: Map<string, unknown>
    }
    internals.preparations.clear()
    await abandoned.abandon()
    await abandoned.abandon()

    const preparation = await ctx.teamWorkspaces.prepare('sandbox', harness.request)
    await expect(ctx.teamWorkspaces.prepare('sandbox', harness.request)).resolves.toBe(preparation)
    await preparation.abandon()
    await preparation.abandon()
    await expect(preparation.materialize()).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const replacement = await ctx.teamWorkspaces.prepare('sandbox', harness.request)
    const [allocation, concurrent] = await Promise.all([
      ctx.teamWorkspaces.materialize('sandbox', harness.request, replacement),
      replacement.materialize(),
    ])
    expect(concurrent).toBe(allocation)
    await expect(ctx.teamWorkspaces.restore('sandbox', harness.request, allocation)).resolves.toBe(allocation)
    internals.allocations.clear()
    internals.preparations.clear()
    const restored = await ctx.teamWorkspaces.restore('sandbox', harness.request, allocation)
    expect(restored.root).toBe(allocation.root)
    await expect(provider.restore(harness.request, { ...allocation, id: 'forged' as never })).rejects.toMatchObject({
      code: 'TEAM_INVALID_ARGUMENT',
    })
    await expect(provider.reconcileRelease(harness.request, { ...allocation, id: 'forged' as never })).rejects.toMatchObject({
      code: 'TEAM_INVALID_ARGUMENT',
    })
    internals.allocations.clear()
    internals.preparations.clear()
    await ctx.teamWorkspaces.reconcileRelease('sandbox', harness.request, allocation)
    await expect(ctx.teamWorkspaces.reconcileRelease('sandbox', harness.request, allocation)).resolves.toBeUndefined()

    await rm(harness.sourceRoot, { recursive: true, force: true })
    await expect(provider.eligible({ task: harness.task, binding: harness.binding })).resolves.toBe(false)
    await rm(harness.allocationParent, { recursive: true, force: true })
    await expect(provider.eligible({ task: harness.task, binding: harness.binding })).resolves.toBe(false)
    await ctx.fiber.dispose()
  })

  it('returns provider-local artifacts when no Team artifact store is mounted and rejects an unowned root', async () => {
    const { ctx, harness } = await setup({ source: false })
    const preparation = await ctx.teamWorkspaces.prepare('sandbox', harness.request)
    const allocation = await ctx.teamWorkspaces.materialize('sandbox', harness.request, preparation)
    await writeFile(join(allocation.root, 'output.log'), 'output\n')
    const published = await ctx.teamWorkspaces.publish('sandbox', { allocation })
    expect(published.artifacts).toMatchObject([{
      kind: 'file',
      uri: join(allocation.root, 'output.log'),
      sourceAttemptId: harness.request.attemptId,
    }])

    await expect(ctx.teamWorkspaces.publish('sandbox', {
      allocation: { ...allocation, root: join(harness.allocationParent, 'other') },
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await allocation.release()
    await ctx.fiber.dispose()
  })

  it('publishes a portable patch and integrates it into a provider target with CAS and restart recovery', async () => {
    const { ctx, harness, integrationRoot } = await setup({ artifact: true, integration: true })
    await symlink('seed.txt', join(harness.sourceRoot, 'link.txt'))
    const preparation = await ctx.teamWorkspaces.prepare('sandbox', harness.request)
    const allocation = await ctx.teamWorkspaces.materialize('sandbox', harness.request, preparation)
    await expect(ctx.teamWorkspaces.publish('sandbox', { allocation })).resolves.toMatchObject({
      changedPaths: [],
      artifacts: [],
      accepted: false,
    })
    await writeFile(join(allocation.root, 'new.txt'), 'new\n')
    await rm(join(allocation.root, 'seed.txt'))
    await rm(join(allocation.root, 'link.txt'))
    await symlink('new.txt', join(allocation.root, 'link.txt'))
    const published = await ctx.teamWorkspaces.publish('sandbox', { allocation })
    const patch = published.artifacts.find(artifact => artifact.kind === 'patch')
    if (patch === undefined) throw new Error('sandbox patch artifact was not published')
    expect(published.artifacts).toHaveLength(2)

    const request: TeamWorkspaceSourceIntegrateRequest = {
      source: { teamId: harness.request.teamId, taskId: harness.request.taskId, attemptId: harness.request.attemptId, artifacts: [patch] },
      integrationTaskId: 'sandbox-integration-task' as never,
      integrationAttemptId: 'sandbox-integration-attempt' as never,
      target: 'main',
      expectedTarget: 'missing',
      mode: 'integrate',
      actorId: harness.request.participantId,
    }
    const integrated = await ctx.teamWorkspaces.integrateSource('sandbox-local', request)
    expect(integrated).toMatchObject({ status: 'integrated', target: 'main', artifact: patch })
    expect(await readFile(join(integrationRoot, 'main', 'new.txt'), 'utf8')).toBe('new\n')
    await expect(readFile(join(integrationRoot, 'main', 'link.txt'), 'utf8')).resolves.toBe('new\n')
    await expect(stat(join(integrationRoot, 'main', 'seed.txt'))).rejects.toMatchObject({ code: 'ENOENT' })

    const retry = await ctx.teamWorkspaces.integrateSource('sandbox-local', request)
    expect(retry).toEqual(integrated)
    await expect(ctx.teamWorkspaces.integrateSource('sandbox-local', { ...request, expectedTarget: 'wrong' }))
      .resolves.toMatchObject({ status: 'conflict', artifact: patch })

    const markerRoot = join(harness.allocationParent, '.clocky-team-sandbox-integrations')
    const markerName = (await readdir(markerRoot)).find(name => name.endsWith('.json'))
    if (markerName === undefined) throw new Error('sandbox integration marker was not written')
    const markerPath = join(markerRoot, markerName)
    const marker = JSON.parse(await readFile(markerPath, 'utf8')) as Record<string, unknown>
    await writeFile(markerPath, JSON.stringify({ ...marker, status: 'prepared', expectedVersion: marker.targetVersion, targetVersion: 'not-current' }))
    await expect(ctx.teamWorkspaces.integrateSource('sandbox-local', request))
      .resolves.toMatchObject({ status: 'conflict', artifact: patch })

    const recoveryTarget = join(integrationRoot, 'crash-recovery')
    await mkdir(recoveryTarget)
    const recoveryRequest: TeamWorkspaceSourceIntegrateRequest = {
      ...request,
      target: 'crash-recovery',
      expectedTarget: undefined,
      integrationTaskId: 'sandbox-crash-recovery-task' as never,
      integrationAttemptId: 'sandbox-crash-recovery-attempt' as never,
    }
    await expect(ctx.teamWorkspaces.integrateSource('sandbox-local', recoveryRequest))
      .resolves.toMatchObject({ status: 'integrated' })
    let recoveryMarkerEntry: string | undefined
    for (const name of await readdir(markerRoot)) {
      const path = join(markerRoot, name)
      try {
        if ((await readFile(path, 'utf8')).includes('"target":"crash-recovery"')) {
          recoveryMarkerEntry = path
          break
        }
      } catch {
        continue
      }
    }
    if (recoveryMarkerEntry === undefined) throw new Error('sandbox crash-recovery marker was not written')
    const recoveryMarker = JSON.parse(await readFile(recoveryMarkerEntry, 'utf8')) as Record<string, unknown>
    const recoveryBackup = join(integrationRoot, `.clocky-team-sandbox-backup-${createHash('sha256').update(recoveryMarkerEntry).digest('hex')}`)
    await rename(recoveryTarget, recoveryBackup)
    await rm(recoveryBackup, { recursive: true, force: true })
    await mkdir(recoveryBackup)
    await writeFile(recoveryMarkerEntry, JSON.stringify({ ...recoveryMarker, status: 'prepared' }))
    await expect(ctx.teamWorkspaces.integrateSource('sandbox-local', recoveryRequest))
      .resolves.toMatchObject({ status: 'integrated' })
    expect(await readFile(join(recoveryTarget, 'new.txt'), 'utf8')).toBe('new\n')
    await ctx.fiber.dispose()
  })

  it('records non-file changes without reading them as artifacts and respects large-file bounds', async () => {
    const { ctx, harness } = await setup({ artifact: true })
    const preparation = await ctx.teamWorkspaces.prepare('sandbox', harness.request)
    const allocation = await ctx.teamWorkspaces.materialize('sandbox', harness.request, preparation)
    await writeFile(join(allocation.root, 'large.bin'), 'a'.repeat(129))
    const socket = process.platform === 'win32' ? undefined : createServer()
    if (socket !== undefined) {
      const previousCwd = process.cwd()
      try {
        process.chdir(allocation.root)
        await new Promise<void>((resolve, reject) => {
          socket.once('error', reject)
          socket.listen('socket-entry', () => { resolve() })
        })
      } finally {
        process.chdir(previousCwd)
      }
    }
    try {
      await expect(ctx.teamWorkspaces.publish('sandbox', { allocation })).resolves.toMatchObject({
        changedPaths: socket === undefined ? ['large.bin'] : ['large.bin', 'socket-entry'],
        artifacts: [],
      })
    } finally {
      if (socket !== undefined) await new Promise<void>((resolve) => { socket.close(() => { resolve() }) })
      await allocation.release()
      await ctx.fiber.dispose()
    }
  })

  it('rejects integration policy, malformed artifacts, unsafe targets, missing stores, and marker tampering', async () => {
    const { ctx, harness, integrationRoot } = await setup({ artifact: true, integration: true })
    const preparation = await ctx.teamWorkspaces.prepare('sandbox', harness.request)
    const allocation = await ctx.teamWorkspaces.materialize('sandbox', harness.request, preparation)
    await writeFile(join(allocation.root, 'output.txt'), 'output\n')
    const published = await ctx.teamWorkspaces.publish('sandbox', { allocation })
    const patch = published.artifacts.find(artifact => artifact.kind === 'patch')
    if (patch === undefined) throw new Error('sandbox patch artifact was not published')
    const request: TeamWorkspaceSourceIntegrateRequest = {
      source: { teamId: harness.request.teamId, taskId: harness.request.taskId, attemptId: harness.request.attemptId, artifacts: [patch] },
      integrationTaskId: 'sandbox-boundary-task' as never,
      integrationAttemptId: 'sandbox-boundary-attempt' as never,
      target: 'main',
      expectedTarget: 'missing',
      mode: 'integrate',
    }

    harness.teams.authorize.mockResolvedValue({ kind: 'deny', message: 'integration denied' } as never)
    await expect(ctx.teamWorkspaces.integrateSource('sandbox-local', request)).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    harness.teams.authorize.mockResolvedValue({ kind: 'allow' } as never)
    await expect(ctx.teamWorkspaces.integrateSource('sandbox-local', { ...request, mode: 'proposal', expectedTarget: undefined }))
      .resolves.toMatchObject({ status: 'proposed', artifact: patch })
    await expect(ctx.teamWorkspaces.integrateSource('sandbox-local', {
      ...request,
      target: '../escape',
      integrationTaskId: 'sandbox-unsafe-target' as never,
      integrationAttemptId: 'sandbox-unsafe-attempt' as never,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.teamWorkspaces.integrateSource('sandbox-local', {
      ...request,
      source: { ...request.source, teamId: '' as never },
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const malformed = await harness.saves('test-artifacts', {
      name: 'malformed',
      sourceAttemptId: harness.request.attemptId,
      kind: 'patch',
      visibility: 'team',
      data: 'not-json',
    })
    await expect(ctx.teamWorkspaces.integrateSource('sandbox-local', {
      ...request,
      source: { ...request.source, artifacts: [malformed] },
      integrationTaskId: 'sandbox-malformed-task' as never,
      integrationAttemptId: 'sandbox-malformed-attempt' as never,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const withoutStore = await setup({ integration: true })
    await expect(withoutStore.ctx.teamWorkspaces.integrateSource('sandbox-local', request)).rejects.toMatchObject({
      code: 'TEAM_INVALID_ARGUMENT',
    })
    await withoutStore.ctx.fiber.dispose()

    const integrated = await ctx.teamWorkspaces.integrateSource('sandbox-local', request)
    const markerRoot = join(harness.allocationParent, '.clocky-team-sandbox-integrations')
    const markerName = (await readdir(markerRoot))[0]
    if (markerName === undefined) throw new Error('sandbox integration marker was not written')
    const markerPath = join(markerRoot, markerName)
    const marker = JSON.parse(await readFile(markerPath, 'utf8')) as Record<string, unknown>
    await writeFile(markerPath, JSON.stringify({ ...marker, status: 'prepared' }))
    await expect(ctx.teamWorkspaces.integrateSource('sandbox-local', request)).resolves.toEqual(integrated)
    await writeFile(markerPath, JSON.stringify({ ...marker, sourceTaskId: 'wrong-source' }))
    await expect(ctx.teamWorkspaces.integrateSource('sandbox-local', request)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await writeFile(markerPath, '{}')
    await expect(ctx.teamWorkspaces.integrateSource('sandbox-local', request)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    await mkdir(join(integrationRoot, 'existing'), { recursive: true })
    await writeFile(join(integrationRoot, 'existing', 'old.txt'), 'old\n')
    const existingRequest: TeamWorkspaceSourceIntegrateRequest = {
      ...request,
      target: 'existing',
      expectedTarget: undefined,
      integrationTaskId: 'sandbox-existing-task' as never,
      integrationAttemptId: 'sandbox-existing-attempt' as never,
    }
    await expect(ctx.teamWorkspaces.integrateSource('sandbox-local', existingRequest)).resolves.toMatchObject({ status: 'integrated' })
    expect(await readFile(join(integrationRoot, 'existing', 'old.txt'), 'utf8')).toBe('old\n')

    await symlink(join(integrationRoot, 'existing'), join(integrationRoot, 'symlink-target'))
    await expect(ctx.teamWorkspaces.integrateSource('sandbox-local', {
      ...existingRequest,
      target: 'symlink-target',
      integrationTaskId: 'sandbox-symlink-target' as never,
      integrationAttemptId: 'sandbox-symlink-attempt' as never,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await ctx.fiber.dispose()
  })

  it('fails closed for policy denial, tampered manifests, stale tasks, and invalid roots', async () => {
    const { ctx, harness } = await setup()
    harness.teams.authorize.mockResolvedValue({ kind: 'deny', message: 'sandbox denied' } as never)
    await expect(ctx.teamWorkspaces.prepare('sandbox', harness.request)).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })

    harness.teams.authorize.mockResolvedValue({ kind: 'allow' } as never)
    const prep = await ctx.teamWorkspaces.prepare('sandbox', harness.request)
    const allocation = await ctx.teamWorkspaces.materialize('sandbox', harness.request, prep)
    const manifest = (await readdir(harness.allocationParent)).find(entry => entry.endsWith('.manifest.json'))
    if (manifest === undefined) throw new Error('sandbox manifest was not written')
    await writeFile(join(harness.allocationParent, manifest), '{}')
    await expect(allocation.release()).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const staleState = structuredClone(harness.state) as { readonly tasks: Array<{ phase: string }> }
    const staleTask = staleState.tasks[0]
    if (staleTask === undefined) throw new Error('sandbox fixture lost its task')
    staleTask.phase = 'pending'
    harness.teams.getTeam.mockResolvedValue(staleState as never)
    await expect(ctx.teamWorkspaces.prepare('sandbox', harness.request)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await ctx.fiber.dispose()
  })

  it('rejects a source root that overlaps the allocation parent', async () => {
    const parent = await freshRoot('team-workspace-sandbox-overlap-')
    const ctx = new Context()
    ctx.provide('teams', { getTeam: async () => ({}) } as never)
    ctx.provide('agents', { get: () => undefined } as never)
    await ctx.plugin(TeamWorkspaceRegistry)
    await expect(Promise.resolve().then(async () => await ctx.plugin(SandboxWorkspace, {
      allocationParent: parent,
      sourceRoot: parent,
    }))).rejects.toThrow(/sourceRoot/)
    await ctx.fiber.dispose()
  })

  it('rejects invalid configuration before registering a provider', async () => {
    const allocationParent = await freshRoot('team-workspace-sandbox-config-parent-')
    const sourceRoot = await freshRoot('team-workspace-sandbox-config-source-')
    const integrationRoot = await freshRoot('team-workspace-sandbox-config-integration-')

    const reject = async (config: Parameters<typeof SandboxWorkspace.apply>[1], message: RegExp): Promise<void> => {
      const ctx = new Context()
      ctx.provide('teams', { getTeam: async () => ({}) } as never)
      ctx.provide('agents', { get: () => undefined } as never)
      await ctx.plugin(TeamWorkspaceRegistry)
      await expect(ctx.plugin(SandboxWorkspace, config)).rejects.toThrow(message)
      await ctx.fiber.dispose()
    }

    await reject({ allocationParent: 'relative' }, /allocationParent must be an absolute path/)
    await reject({ allocationParent, integrationEnabled: true }, /integrationRoot is required/)
    await reject({ allocationParent, integrationRoot, integrationEnabled: true }, /artifactProvider is required/)
    await reject({ allocationParent, sourceRoot: allocationParent }, /sourceRoot and allocationParent must not overlap/)
    await reject({ allocationParent, sourceRoot, integrationRoot: sourceRoot }, /sourceRoot and integrationRoot must not overlap/)
  })
})
