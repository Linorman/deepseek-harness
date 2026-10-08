import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import LocalSubprocessRuntime from '@clocky/clocky-subprocess-local'
import TeamArtifactStore from '@clocky/clocky-team-artifact'
import * as LocalTeamArtifacts from '@clocky/clocky-team-artifact-local'
import {
  activationIdSchema,
  participantIdSchema,
  taskAttemptIdSchema,
  teamIdSchema,
  teamTaskCreateIdempotencyKeySchema,
  teamTaskIdSchema,
} from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import TeamWorkspaceRegistry from '@clocky/clocky-team-workspace'
import type {
  ActivationBindingSnapshot,
  TeamArtifactReference,
  ParticipantSnapshot,
  TeamStateSnapshot,
  TeamTaskSnapshot,
} from '@clocky/clocky-team'
import type {
  TeamWorkspaceAllocation,
  TeamWorkspacePrepareRequest,
  TeamWorkspaceProvider,
  TeamWorkspaceSourceIntegrateRequest,
} from '@clocky/clocky-team-workspace'
import * as WorktreeWorkspace from '../src/index.ts'

const removalFault = vi.hoisted(() => ({ pathPart: undefined as string | undefined }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, async rm(...args: Parameters<typeof original.rm>) {
    if (removalFault.pathPart !== undefined && String(args[0]).includes(removalFault.pathPart)) {
      throw Object.assign(new Error('temporary file removal unavailable'), { code: 'EACCES' })
    }
    await original.rm(...args)
  } }
})

const teamId = teamIdSchema.parse('worktree-workspace-team')
const participantId = participantIdSchema.parse('worktree-workspace-worker')
const activationId = activationIdSchema.parse('worktree-workspace-activation')
const sessionId = SessionId('worktree-workspace-session')
const taskId = teamTaskIdSchema.parse('worktree-workspace-task')
const attemptId = taskAttemptIdSchema.parse('worktree-workspace-attempt')

const contexts = new Set<Context>()
const roots: string[] = []

afterEach(async () => {
  const failures: unknown[] = []
  for (const ctx of [...contexts]) {
    try {
      await ctx.fiber.dispose()
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  contexts.clear()
  for (const root of roots.splice(0)) {
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'worktree Team workspace provider cleanup failed')
})

/** One mutable fake Team/Agent world exposed through a real Git subprocess and workspace registry. */
interface FakeHarness {
  readonly ctx: Context
  readonly provider: TeamWorkspaceProvider
  readonly request: TeamWorkspacePrepareRequest
  readonly task: TeamTaskSnapshot
  readonly binding: ActivationBindingSnapshot
  readonly repoRoot: string
  readonly allocationParent: string
  readonly live: Map<string, { readonly id: SessionId; readonly session: { readonly id: SessionId } }>
  readonly authorizations: unknown[]
  policy: { readonly kind: 'allow' } | { readonly kind: 'deny'; readonly code: string; readonly message: string }
  state: TeamStateSnapshot
}

/** Create a repository-local temporary directory retained for this test's cleanup. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-workspace-worktree-'))
  roots.push(root)
  return root
}

/** Build a fully current worktree task, lease, local participant, and activation projection. */
function baseline(): {
  readonly task: TeamTaskSnapshot
  readonly binding: ActivationBindingSnapshot
  readonly request: TeamWorkspacePrepareRequest
  readonly state: TeamStateSnapshot
} {
  const binding: ActivationBindingSnapshot = {
    activation: { id: activationId, teamId, participantId, status: 'idle' },
    sessionId,
    provider: 'in-process',
  }
  const task: TeamTaskSnapshot = {
    createdAt: 0,
    execution: { kind: 'participant' },
    id: taskId,
    teamId,
    revision: 2,
    createCommand: {
      creator: { teamId, participantId, activationId, sessionId, provider: 'in-process' },
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('worktree-workspace-provider-task'),
    },
    subject: 'Worktree task',
    description: 'Execute in an isolated detached Git worktree.',
    phase: 'assigned',
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
    attemptCount: 1,
    attemptHistory: [],
    lease: {
      attemptId,
      assignedRevision: 2,
      ordinal: 1,
      participantId,
      activationId,
      assignedAt: 1,
      durationMs: 60_000,
      renewedAt: 1,
      expiresAt: Date.now() + 60_000,
    },
  }
  const participant: ParticipantSnapshot = {
    id: participantId,
    teamId,
    kind: 'local-agent',
    displayName: 'Worktree worker',
    role: 'worker',
    capabilities: [],
    phase: 'active',
  }
  const state = {
    team: {
      id: teamId,
      depth: 0,
      maxTeamDepth: 0,
      goal: { teamId, revision: 1, objective: 'Run isolated work.', phase: 'active', budgets: {} },
      phase: 'active',
      cursor: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    goal: { teamId, revision: 1, objective: 'Run isolated work.', phase: 'active', budgets: {} },
    rules: {},
    budgets: {},
    participants: [participant],
    activations: [binding],
    tasks: [task],
    workspaceAllocations: [],
    channelIds: [],
  } as TeamStateSnapshot
  return {
    task,
    binding,
    state,
    request: {
      teamId,
      taskId,
      attemptId,
      assignedRevision: 2,
      participantId,
      activationId,
      sessionId,
    },
  }
}

/** Execute one finite Git argv through the test's mounted subprocess capability. */
async function git(ctx: Context, cwd: string, args: readonly string[]): Promise<string> {
  const executable = await ctx.subprocess.resolveExecutable('git')
  const handle = ctx.subprocess.spawn({
    argv: [executable, ...args],
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 16 * 1024 },
      stderr: { maxBytes: 16 * 1024 },
    },
    graceMs: 100,
    env: { GIT_TERMINAL_PROMPT: '0', GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined },
  })
  const [outcome, exited] = await Promise.all([handle.done, handle.waitForExit()])
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  if (!exited || stdout === undefined || stderr === undefined
    || stdout.lossy || stderr.lossy || outcome.exitCode !== 0 || outcome.signal !== null) {
    throw new Error(`Git fixture command ${args.join(' ')} failed: ${stderr?.text ?? ''}`)
  }
  return stdout.text
}

/** Initialize a real disposable repository with one unsigned initial commit. */
async function createRepository(ctx: Context, root: string): Promise<string> {
  const repo = join(root, 'repository')
  await mkdir(repo)
  await git(ctx, repo, ['init'])
  await git(ctx, repo, ['config', 'user.email', 'worktree@example.test'])
  await git(ctx, repo, ['config', 'user.name', 'Worktree Test'])
  await writeFile(join(repo, 'README.md'), 'initial\n')
  await git(ctx, repo, ['add', 'README.md'])
  await git(ctx, repo, ['-c', 'commit.gpgSign=false', 'commit', '-m', 'initial'])
  return repo
}

/** Mount the provider around a mutable Team/Agent projection and a real Git repository. */
async function setup(options: {
  readonly artifacts?: boolean
  readonly integration?: boolean
  readonly outputMaxBytes?: number
} = {}): Promise<FakeHarness> {
  const root = await freshRoot()
  const allocationParent = join(root, 'allocations')
  await mkdir(allocationParent)
  const initial = baseline()
  const live = new Map<string, { readonly id: SessionId; readonly session: { readonly id: SessionId } }>([
    [String(sessionId), { id: sessionId, session: { id: sessionId } }],
  ])
  const harness: Omit<FakeHarness, 'ctx' | 'provider' | 'repoRoot' | 'allocationParent'> = {
    ...initial,
    live,
    authorizations: [],
    policy: { kind: 'allow' },
  }
  const ctx = new Context()
  contexts.add(ctx)
  ctx.provide('teams', {
    getTeam: async () => harness.state,
    authorize: async (request: unknown) => {
      harness.authorizations.push(request)
      return harness.policy
    },
    reportWorkspaceConflict: () => {},
  } as never)
  ctx.provide('agents', { get: (id: SessionId) => live.get(String(id)) } as never)
  await ctx.plugin(LocalSubprocessRuntime)
  const subprocess = ctx.subprocess as LocalSubprocessRuntime
  subprocess.internals.spillDir = root
  const repoRoot = await createRepository(ctx, root)
  await ctx.plugin(TeamWorkspaceRegistry)
  if (options.artifacts === true) {
    await ctx.plugin(TeamArtifactStore)
    await ctx.plugin(LocalTeamArtifacts, { root: join(root, 'artifacts') })
  }
  await ctx.plugin(WorktreeWorkspace, {
    providerName: 'worktree-local',
    repoRoot,
    allocationParent,
    baseRef: 'HEAD',
    gitExecutable: 'git',
    processGraceMs: 100,
    commandTimeoutMs: 1_000,
    outputMaxBytes: options.outputMaxBytes ?? 16 * 1024,
    ...options.artifacts === true ? { artifactProvider: 'local' } : {},
    ...options.integration === true ? { integrationEnabled: true } : {},
  })
  const provider = ctx.teamWorkspaces.getProvider('worktree-local')
  if (provider === undefined) throw new Error('worktree workspace provider did not register')
  return Object.assign(harness, { ctx, provider, repoRoot, allocationParent })
}

/** Materialize one provider root through the public reservation-first workspace seam. */
async function materialize(harness: FakeHarness): Promise<TeamWorkspaceAllocation> {
  const preparation = await harness.ctx.teamWorkspaces.prepare('worktree', harness.request)
  return await harness.ctx.teamWorkspaces.materialize('worktree', harness.request, preparation)
}

describe('worktree Team workspace provider', () => {
  it('preflights only active worktree tasks while repository and allocation roots remain available', async () => {
    const harness = await setup()
    const participant = harness.state.participants[0]
    if (participant === undefined) throw new Error('worktree fixture has no participant')
    if (harness.provider.preflight === undefined) throw new Error('worktree provider has no preflight')
    const providerPreflight = harness.provider.preflight.bind(harness.provider)
    const route = { provider: 'in-process', model: 'test-model', cwd: harness.repoRoot }
    const preflight = (task = harness.task, candidate = participant) =>
      providerPreflight({ task, participant: candidate, route })
    expect(await preflight()).toBe(true)
    expect(await preflight({ ...harness.task, workspaceMode: 'shared' })).toBe(false)
    expect(await preflight(harness.task, { ...participant, phase: 'provisioning' })).toBe(false)
    await rm(harness.allocationParent, { recursive: true, force: true })
    expect(await preflight()).toBe(false)
  })

  it('publishes only the exact live allocation owned by this provider', async () => {
    const harness = await setup()
    if (harness.provider.publish === undefined) throw new Error('worktree provider has no publish')
    const publish = harness.provider.publish.bind(harness.provider)
    const allocation = await materialize(harness)
    await expect(publish({ allocation: { ...allocation, root: harness.repoRoot } }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(publish({ allocation: { ...allocation, assignedRevision: allocation.assignedRevision + 1 } }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await allocation.release()
    await expect(publish({ allocation })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  })

  it('allocates one exact detached worktree through the subprocess seam, calls policy, then normally releases it', async () => {
    const harness = await setup()
    await expect(harness.ctx.teamWorkspaces.eligible('worktree', { task: harness.task, binding: harness.binding })).resolves.toBe(true)

    const first = await materialize(harness)
    const second = await materialize(harness)
    expect(second).toBe(first)
    expect(first).toMatchObject({
      mode: 'worktree', teamId, taskId, attemptId, assignedRevision: 2,
    })
    expect(first.root).not.toBe(harness.repoRoot)
    expect(Object.isFrozen(first)).toBe(true)
    expect((await stat(first.root)).isDirectory()).toBe(true)
    expect((await git(harness.ctx, first.root, ['rev-parse', '--show-toplevel'])).trim()).toBe(first.root)
    expect(await git(harness.ctx, harness.repoRoot, ['worktree', 'list', '--porcelain'])).toContain(`worktree ${first.root}`)
    expect(harness.authorizations).toHaveLength(5)
    expect(harness.authorizations[0]).toMatchObject({
      hook: 'workspace-allocate',
      facts: { workspaceMode: 'worktree', repoRoot: harness.repoRoot, allocationParent: harness.allocationParent, root: first.root },
    })

    await first.release()
    await first.release()
    await expect(stat(first.root)).rejects.toMatchObject({ code: 'ENOENT' })
    const next = await materialize(harness)
    expect(next).not.toBe(first)
    expect(next.root).toBe(first.root)
    await next.release()
  })

  it('reserves root-free metadata before materialization and restores only its exact provider-minted worktree', async () => {
    const harness = await setup()
    const preparation = await harness.ctx.teamWorkspaces.prepare('worktree', harness.request)
    expect(preparation).toMatchObject({
      provider: 'worktree-local',
      mode: 'worktree',
      teamId,
      taskId,
      attemptId,
    })
    expect(preparation.baseVersion).toBeTypeOf('string')
    expect('root' in preparation).toBe(false)
    const before = await git(harness.ctx, harness.repoRoot, ['worktree', 'list', '--porcelain'])
    expect(before).not.toContain('clocky-team-worktree-')

    const allocation = await harness.ctx.teamWorkspaces.materialize('worktree', harness.request, preparation)
    const internals = harness.provider as unknown as {
      readonly allocations: Map<string, Promise<TeamWorkspaceAllocation>>
      readonly preparations: Map<string, unknown>
    }
    internals.allocations.clear()
    internals.preparations.clear()

    const restored = await harness.ctx.teamWorkspaces.restore('worktree', harness.request, allocation)
    expect(restored).not.toBe(allocation)
    expect(restored.root).toBe(allocation.root)
    expect((await git(harness.ctx, restored.root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])).trim())
      .toMatch(/^[\da-f]{40,64}$/iu)
    await restored.release()
  })

  it('keeps abandoned reservations root-free and rejects metadata from another provider', async () => {
    const harness = await setup()
    const first = await harness.provider.prepare(harness.request)
    expect(await harness.provider.prepare(harness.request)).toBe(first)
    await first.abandon()
    await first.abandon()
    await expect(first.materialize()).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(await git(harness.ctx, harness.repoRoot, ['worktree', 'list', '--porcelain'])).not.toContain('clocky-team-worktree-')

    const second = await harness.provider.prepare(harness.request)
    const allocation = await second.materialize()
    await expect(harness.provider.restore(harness.request, {
      ...allocation,
      provider: 'other-worktree-provider',
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(await harness.provider.restore(harness.request, allocation)).toBe(allocation)
    await allocation.release()
  })

  it('reconciles a live allocation and a restorable root through the same release authority', async () => {
    const harness = await setup()
    const allocation = await materialize(harness)
    await harness.provider.reconcileRelease(harness.request, allocation)
    await expect(stat(allocation.root)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(harness.provider.reconcileRelease(harness.request, {
      ...allocation,
      provider: 'other-worktree-provider',
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const restoredSource = await materialize(harness)
    const internals = harness.provider as unknown as {
      readonly allocations: Map<string, Promise<TeamWorkspaceAllocation>>
      readonly preparations: Map<string, unknown>
    }
    internals.allocations.clear()
    internals.preparations.clear()
    await harness.provider.reconcileRelease(harness.request, restoredSource)
    await expect(stat(restoredSource.root)).rejects.toMatchObject({ code: 'ENOENT' })
    await harness.provider.reconcileRelease(harness.request, restoredSource)
    const recreated = await harness.provider.restore(harness.request, restoredSource)
    expect(recreated.root).toBe(restoredSource.root)
    await recreated.release()
    await writeFile(restoredSource.root, 'not a Git worktree\n')
    await expect(harness.provider.restore(harness.request, restoredSource)).rejects.toThrow('non-directory')
    await rm(restoredSource.root)

    const failed = await materialize(harness)
    const dirty = join(failed.root, 'reconcile-dirty.txt')
    await writeFile(dirty, 'dirty\n')
    internals.allocations.clear()
    internals.preparations.clear()
    await expect(harness.provider.reconcileRelease(harness.request, failed)).rejects.toThrow('contains modified or untracked files')
    await expect(harness.provider.restore(harness.request, failed)).rejects.toThrow('contains modified or untracked files')
    await rm(dirty)
    await harness.provider.reconcileRelease(harness.request, failed)
  })

  it('refuses release reconciliation that becomes live while restore holds the attempt queue', async () => {
    const harness = await setup()
    const allocation = await materialize(harness)
    const internals = harness.provider as unknown as {
      readonly allocations: Map<string, Promise<TeamWorkspaceAllocation>>
      readonly preparations: Map<string, unknown>
    }
    internals.allocations.clear()
    internals.preparations.clear()
    const entered = Promise.withResolvers<undefined>()
    const proceed = Promise.withResolvers<undefined>()
    let held = false
    const originalSpawn = harness.ctx.subprocess.spawn.bind(harness.ctx.subprocess)
    const spawn = vi.spyOn(harness.ctx.subprocess, 'spawn').mockImplementation((spec) => {
      const handle = originalSpawn(spec)
      if (!held && spec.cwd === allocation.root && spec.argv.includes('rev-parse')) {
        held = true
        entered.resolve(undefined)
        return { ...handle, done: proceed.promise.then(async () => await handle.done) }
      }
      return handle
    })
    try {
      const restoring = harness.provider.restore(harness.request, allocation)
      await entered.promise
      const reconciling = harness.provider.reconcileRelease(harness.request, allocation)
      proceed.resolve(undefined)
      const restored = await restoring
      await expect(reconciling).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      await restored.release()
    } finally { spawn.mockRestore(); proceed.resolve(undefined) }
  })

  it('rejects a restored root with a changed base or without provider Git registration', async () => {
    const harness = await setup()
    const allocation = await materialize(harness)
    await writeFile(join(allocation.root, 'README.md'), 'changed base\n')
    await git(harness.ctx, allocation.root, ['add', 'README.md'])
    await git(harness.ctx, allocation.root, [
      '-c', 'user.name=Restore Test', '-c', 'user.email=restore@example.test',
      'commit', '-m', 'changed restore base',
    ])
    const internals = harness.provider as unknown as {
      readonly allocations: Map<string, Promise<TeamWorkspaceAllocation>>
      readonly preparations: Map<string, unknown>
    }
    internals.allocations.clear()
    internals.preparations.clear()
    await expect(harness.provider.restore(harness.request, allocation)).rejects.toThrow('does not retain provider base')

    await git(harness.ctx, allocation.root, ['reset', '--hard', allocation.baseVersion!])
    await git(harness.ctx, harness.repoRoot, ['worktree', 'remove', '--force', allocation.root])
    await git(harness.ctx, harness.repoRoot, ['clone', harness.repoRoot, allocation.root])
    await expect(harness.provider.restore(harness.request, allocation)).rejects.toThrow('is not registered by Git')
    await rm(allocation.root, { recursive: true, force: true })
  })

  it('validates source integration provenance before reading or changing a target', async () => {
    const harness = await setup()
    const patch: TeamArtifactReference = {
      id: 'worktree-source-validation-patch',
      provider: 'local',
      kind: 'patch',
      uri: 'artifact://local/worktree-source-validation-patch',
      sourceAttemptId: attemptId,
      visibility: 'team',
    }
    const request: TeamWorkspaceSourceIntegrateRequest = {
      source: { teamId, taskId, attemptId, artifacts: [patch] },
      integrationTaskId: teamTaskIdSchema.parse('worktree-source-validation-task'),
      integrationAttemptId: taskAttemptIdSchema.parse('worktree-source-validation-attempt'),
      target: 'main',
      mode: 'proposal',
      actorId: participantId,
    }

    await expect(harness.ctx.teamWorkspaces.integrateSource('worktree-local', {
      ...request,
      source: { ...request.source, teamId: '' as never },
    })).rejects.toThrow('source integration identities must be non-empty')
    await expect(harness.ctx.teamWorkspaces.integrateSource('worktree-local', {
      ...request,
      target: ' main',
    })).rejects.toThrow('integration target must be non-empty')
    await expect(harness.ctx.teamWorkspaces.integrateSource('worktree-local', request)).resolves.toMatchObject({
      status: 'proposed',
      artifact: patch,
    })

    await expect(harness.ctx.teamWorkspaces.integrateSource('worktree-local', {
      ...request,
      mode: 'integrate',
    })).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })

    const enabled = await setup({ integration: true })
    await expect(enabled.ctx.teamWorkspaces.integrateSource('worktree-local', {
      ...request,
      mode: 'integrate',
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  })

  it('rejects empty and oversized source patch artifacts within the configured read bound', async () => {
    const harness = await setup({ artifacts: true, integration: true })
    const source = { teamId, taskId, attemptId }
    const base = {
      source,
      integrationTaskId: teamTaskIdSchema.parse('worktree-source-bounds-task'),
      integrationAttemptId: taskAttemptIdSchema.parse('worktree-source-bounds-attempt'),
      target: 'main',
      mode: 'integrate' as const,
      actorId: participantId,
    }
    const empty = await harness.ctx.teamArtifacts.save('local', {
      teamId,
      sourceAttemptId: attemptId,
      kind: 'patch',
      visibility: 'team',
      data: new Uint8Array(),
    })
    await expect(harness.ctx.teamWorkspaces.integrateSource('worktree-local', {
      ...base,
      source: { ...source, artifacts: [empty] },
    })).rejects.toThrow('empty or exceeds')

    const oversized = await harness.ctx.teamArtifacts.save('local', {
      teamId,
      sourceAttemptId: attemptId,
      kind: 'patch',
      visibility: 'team',
      data: new Uint8Array(16 * 1024 + 1),
    })
    await expect(harness.ctx.teamWorkspaces.integrateSource('worktree-local', {
      ...base,
      source: { ...source, artifacts: [oversized] },
    })).rejects.toThrow('empty or exceeds')
  })

  it('propagates a malformed source patch after bounded detached-worktree cleanup', async () => {
    const harness = await setup({ artifacts: true, integration: true })
    await git(harness.ctx, harness.repoRoot, ['branch', 'source-integration-malformed'])
    const artifact = await harness.ctx.teamArtifacts.save('local', {
      teamId,
      sourceAttemptId: attemptId,
      kind: 'patch',
      visibility: 'team',
      data: 'this is not a Git patch\n',
    })
    const request: TeamWorkspaceSourceIntegrateRequest = {
      source: { teamId, taskId, attemptId, artifacts: [artifact] },
      integrationTaskId: teamTaskIdSchema.parse('worktree-source-malformed-task'),
      integrationAttemptId: taskAttemptIdSchema.parse('worktree-source-malformed-attempt'),
      target: 'source-integration-malformed',
      mode: 'integrate',
      actorId: participantId,
    }

    const originalSpawn = harness.ctx.subprocess.spawn.bind(harness.ctx.subprocess)
    const reset = vi.spyOn(harness.ctx.subprocess, 'spawn').mockImplementation((spec) => {
      if (spec.argv.includes('reset') && spec.argv.includes('--hard')) throw new Error('reset unavailable')
      return originalSpawn(spec)
    })
    try {
      await expect(harness.ctx.teamWorkspaces.integrateSource('worktree-local', request)).rejects.toThrow('failed with exit')
    } finally { reset.mockRestore() }
    expect((await git(harness.ctx, harness.repoRoot, ['show', 'refs/heads/source-integration-malformed:README.md'])).trim())
      .toBe('initial')
  })

  it('reports detached worktree cleanup failure after a rejected source patch', async () => {
    const harness = await setup({ artifacts: true, integration: true })
    await git(harness.ctx, harness.repoRoot, ['branch', 'source-integration-remove-error'])
    const artifact = await harness.ctx.teamArtifacts.save('local', {
      teamId, sourceAttemptId: attemptId, kind: 'patch', visibility: 'team', data: 'not a Git patch\n',
    })
    const request: TeamWorkspaceSourceIntegrateRequest = {
      source: { teamId, taskId, attemptId, artifacts: [artifact] },
      integrationTaskId: teamTaskIdSchema.parse('worktree-source-remove-task'),
      integrationAttemptId: taskAttemptIdSchema.parse('worktree-source-remove-attempt'),
      target: 'source-integration-remove-error', mode: 'integrate', actorId: participantId,
    }
    const originalSpawn = harness.ctx.subprocess.spawn.bind(harness.ctx.subprocess)
    const spawn = vi.spyOn(harness.ctx.subprocess, 'spawn').mockImplementation((spec) => {
      if (spec.argv.includes('worktree') && spec.argv.includes('remove') && spec.argv.includes('--force')) {
        throw new Error('detached worktree removal unavailable')
      }
      return originalSpawn(spec)
    })
    try {
      await expect(harness.ctx.teamWorkspaces.integrateSource('worktree-local', request))
        .rejects.toThrow('source integration cleanup failed')
    } finally { spawn.mockRestore() }
  })

  it('reports a source-integration target conflict when the target ref advances during compare-and-set', async () => {
    const harness = await setup({ artifacts: true, integration: true })
    await git(harness.ctx, harness.repoRoot, ['branch', 'source-integration-race'])
    const raceRoot = join(harness.allocationParent, 'source-race')
    await git(harness.ctx, harness.repoRoot, ['worktree', 'add', '--detach', raceRoot, 'source-integration-race'])
    await writeFile(join(raceRoot, 'README.md'), 'concurrent source target change\n')
    await git(harness.ctx, raceRoot, ['add', 'README.md'])
    await git(harness.ctx, raceRoot, [
      '-c', 'user.name=Concurrent Source Target', '-c', 'user.email=concurrent-source-target@example.test',
      'commit', '-m', 'concurrent source target change',
    ])
    const competingCommit = (await git(harness.ctx, raceRoot, ['rev-parse', 'HEAD'])).trim()
    await git(harness.ctx, harness.repoRoot, ['worktree', 'remove', '--force', raceRoot])

    const allocation = await materialize(harness)
    await writeFile(join(allocation.root, 'README.md'), 'source patch before race\n')
    const published = await harness.ctx.teamWorkspaces.publish('worktree', { allocation })
    const patch = published.artifacts.find(artifact => artifact.kind === 'patch')
    if (patch === undefined) throw new Error('source integration race fixture did not publish a patch')
    const targetBefore = (await git(harness.ctx, harness.repoRoot, ['rev-parse', 'refs/heads/source-integration-race'])).trim()
    const request: TeamWorkspaceSourceIntegrateRequest = {
      source: { teamId, taskId, attemptId, artifacts: published.artifacts },
      integrationTaskId: teamTaskIdSchema.parse('worktree-source-race-task'),
      integrationAttemptId: taskAttemptIdSchema.parse('worktree-source-race-attempt'),
      target: 'source-integration-race',
      expectedTarget: targetBefore,
      mode: 'integrate',
      actorId: participantId,
    }
    let raced = false
    const originalSpawn = harness.ctx.subprocess.spawn.bind(harness.ctx.subprocess)
    const spawn = vi.spyOn(harness.ctx.subprocess, 'spawn').mockImplementation((spec) => {
      if (!raced && spec.argv.includes('update-ref') && spec.argv.includes('refs/heads/source-integration-race')) {
        raced = true
        execFileSync('git', ['-C', harness.repoRoot, 'update-ref', 'refs/heads/source-integration-race', competingCommit, targetBefore])
      }
      return originalSpawn(spec)
    })
    try {
      await expect(harness.ctx.teamWorkspaces.integrateSource('worktree-local', request)).resolves.toMatchObject({
        status: 'conflict', target: request.target, artifact: patch,
      })
    } finally {
      spawn.mockRestore()
    }
    expect((await git(harness.ctx, harness.repoRoot, ['show', 'refs/heads/source-integration-race:README.md'])).trim())
      .toBe('concurrent source target change')
    await writeFile(join(allocation.root, 'README.md'), 'initial\n')
    await allocation.release()
  })

  it('recovers source integration when its target update settles before the command reports failure', async () => {
    const harness = await setup({ artifacts: true, integration: true })
    await git(harness.ctx, harness.repoRoot, ['branch', 'source-integration-settlement-race'])
    const allocation = await materialize(harness)
    await writeFile(join(allocation.root, 'README.md'), 'settled source change\n')
    const published = await harness.ctx.teamWorkspaces.publish('worktree', { allocation })
    const patch = published.artifacts.find(artifact => artifact.kind === 'patch')
    if (patch === undefined) throw new Error('source settlement fixture did not publish a patch')
    const targetBefore = (await git(harness.ctx, harness.repoRoot, ['rev-parse', 'refs/heads/source-integration-settlement-race'])).trim()
    const request: TeamWorkspaceSourceIntegrateRequest = {
      source: { teamId, taskId, attemptId, artifacts: published.artifacts },
      integrationTaskId: teamTaskIdSchema.parse('worktree-source-settled-task'),
      integrationAttemptId: taskAttemptIdSchema.parse('worktree-source-settled-attempt'),
      target: 'source-integration-settlement-race', expectedTarget: targetBefore,
      mode: 'integrate', actorId: participantId,
    }
    let integrationRoot: string | undefined
    const originalSpawn = harness.ctx.subprocess.spawn.bind(harness.ctx.subprocess)
    const spawn = vi.spyOn(harness.ctx.subprocess, 'spawn').mockImplementation((spec) => {
      if (spec.argv.includes('worktree') && spec.argv.includes('add') && spec.argv.includes('--detach')) {
        integrationRoot = spec.argv.at(-2)
      }
      if (spec.argv.includes('update-ref') && spec.argv.includes('refs/heads/source-integration-settlement-race')) {
        if (integrationRoot === undefined) throw new Error('source integration root was not observed')
        const commit = execFileSync('git', ['-C', integrationRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
        execFileSync('git', ['-C', harness.repoRoot, 'update-ref', 'refs/heads/source-integration-settlement-race', commit, targetBefore])
      }
      return originalSpawn(spec)
    })
    try {
      await expect(harness.ctx.teamWorkspaces.integrateSource('worktree-local', request))
        .resolves.toMatchObject({ status: 'integrated', artifact: patch })
    } finally { spawn.mockRestore() }
    await writeFile(join(allocation.root, 'README.md'), 'initial\n')
    await allocation.release()
  })

  it.each(['unchanged', 'lookup-failed'] as const)(
    'preserves source target update failure after a %s target observation', async (observation) => {
      const harness = await setup({ artifacts: true, integration: true })
      await git(harness.ctx, harness.repoRoot, ['branch', 'source-integration-cas-error'])
      const allocation = await materialize(harness)
      await writeFile(join(allocation.root, 'README.md'), 'source CAS error\n')
      const published = await harness.ctx.teamWorkspaces.publish('worktree', { allocation })
      const request: TeamWorkspaceSourceIntegrateRequest = {
        source: { teamId, taskId, attemptId, artifacts: published.artifacts },
        integrationTaskId: teamTaskIdSchema.parse(`worktree-source-cas-${observation}-task`),
        integrationAttemptId: taskAttemptIdSchema.parse(`worktree-source-cas-${observation}-attempt`),
        target: 'source-integration-cas-error', mode: 'integrate', actorId: participantId,
      }
      let updateFailed = false
      const originalSpawn = harness.ctx.subprocess.spawn.bind(harness.ctx.subprocess)
      const spawn = vi.spyOn(harness.ctx.subprocess, 'spawn').mockImplementation((spec) => {
        if (spec.argv.includes('update-ref') && spec.argv.includes('refs/heads/source-integration-cas-error')) {
          updateFailed = true
          throw new Error('source compare-and-set unavailable')
        }
        if (updateFailed && observation === 'lookup-failed' && spec.argv.includes('rev-parse')
          && spec.argv.some(arg => arg.includes('refs/heads/source-integration-cas-error'))) {
          throw new Error('source target lookup unavailable')
        }
        return originalSpawn(spec)
      })
      try {
        const operation = harness.ctx.teamWorkspaces.integrateSource('worktree-local', request)
        if (observation === 'lookup-failed') {
          await expect(operation).resolves.toMatchObject({ status: 'conflict' })
        } else {
          await expect(operation).rejects.toThrow('source compare-and-set unavailable')
        }
      } finally { spawn.mockRestore() }
      await writeFile(join(allocation.root, 'README.md'), 'initial\n')
      await allocation.release()
    },
  )

  it('reports conflicted paths when a source patch and target commit change the same file', async () => {
    const harness = await setup({ artifacts: true, integration: true })
    const allocation = await materialize(harness)
    await writeFile(join(allocation.root, 'README.md'), 'source change\n')
    const published = await harness.ctx.teamWorkspaces.publish('worktree', { allocation })
    const patch = published.artifacts.find(artifact => artifact.kind === 'patch')
    if (patch === undefined) throw new Error('source conflict fixture did not publish a patch')
    const originalBranch = (await git(harness.ctx, harness.repoRoot, ['branch', '--show-current'])).trim()
    await git(harness.ctx, harness.repoRoot, ['checkout', '-b', 'source-patch-conflict'])
    await writeFile(join(harness.repoRoot, 'README.md'), 'target change\n')
    await git(harness.ctx, harness.repoRoot, ['add', 'README.md'])
    await git(harness.ctx, harness.repoRoot, ['-c', 'commit.gpgSign=false', 'commit', '-m', 'conflicting target'])
    await git(harness.ctx, harness.repoRoot, ['checkout', originalBranch])
    const request: TeamWorkspaceSourceIntegrateRequest = {
      source: { teamId, taskId, attemptId, artifacts: published.artifacts },
      integrationTaskId: teamTaskIdSchema.parse('worktree-source-conflict-task'),
      integrationAttemptId: taskAttemptIdSchema.parse('worktree-source-conflict-attempt'),
      target: 'source-patch-conflict', mode: 'integrate', actorId: participantId,
    }
    await expect(harness.ctx.teamWorkspaces.integrateSource('worktree-local', request))
      .resolves.toMatchObject({ status: 'conflict', artifact: patch, conflictPaths: ['README.md'] })
    await writeFile(join(allocation.root, 'README.md'), 'initial\n')
    await allocation.release()
  })

  it('reports source patch temporary-file cleanup failure after a successful target update', async () => {
    const harness = await setup({ artifacts: true, integration: true })
    await git(harness.ctx, harness.repoRoot, ['branch', 'source-patch-cleanup-error'])
    const allocation = await materialize(harness)
    await writeFile(join(allocation.root, 'README.md'), 'source cleanup change\n')
    const published = await harness.ctx.teamWorkspaces.publish('worktree', { allocation })
    const request: TeamWorkspaceSourceIntegrateRequest = {
      source: { teamId, taskId, attemptId, artifacts: published.artifacts },
      integrationTaskId: teamTaskIdSchema.parse('worktree-source-cleanup-task'),
      integrationAttemptId: taskAttemptIdSchema.parse('worktree-source-cleanup-attempt'),
      target: 'source-patch-cleanup-error', mode: 'integrate', actorId: participantId,
    }
    removalFault.pathPart = '.clocky-team-source-patch-'
    try {
      await expect(harness.ctx.teamWorkspaces.integrateSource('worktree-local', request))
        .rejects.toThrow('source integration cleanup failed')
    } finally { removalFault.pathPart = undefined }
    await writeFile(join(allocation.root, 'README.md'), 'initial\n')
    await allocation.release()
  })

  it('materializes bounded file artifact references with attempt provenance', async () => {
    const harness = await setup()
    const allocation = await materialize(harness)
    const path = join(allocation.root, 'artifact.txt')
    await writeFile(path, 'artifact\n')
    const published = await harness.ctx.teamWorkspaces.publish('worktree', { allocation })
    expect(published).toMatchObject({
      teamId,
      taskId,
      attemptId,
      accepted: false,
      changedPaths: ['artifact.txt'],
      artifacts: [{ kind: 'file', uri: path, sourceAttemptId: attemptId, visibility: 'team' }],
    })
    expect(published.artifacts[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/)
    await rm(path)
    await allocation.release()
  })

  it('retains a bounded fallback reference without hashing an oversized binary file', async () => {
    const harness = await setup({ outputMaxBytes: 1_024 })
    const allocation = await materialize(harness)
    await writeFile(join(allocation.root, 'large.bin'), Buffer.alloc(1_025))
    const published = await harness.ctx.teamWorkspaces.publish('worktree', { allocation })
    expect(published).toMatchObject({ changedPaths: ['large.bin'], artifacts: [{ kind: 'file', uri: join(allocation.root, 'large.bin') }] })
    expect(published.artifacts[0]?.contentHash).toBeUndefined()
    await rm(join(allocation.root, 'large.bin'))
    await allocation.release()
  })

  it('persists changed files and a tracked patch through the configured artifact provider', async () => {
    const harness = await setup({ artifacts: true })
    const allocation = await materialize(harness)
    await writeFile(join(allocation.root, 'README.md'), 'changed\n')
    const published = await harness.ctx.teamWorkspaces.publish('worktree', { allocation })
    expect(published.artifacts.map(artifact => artifact.kind)).toEqual(['file', 'patch'])
    const file = published.artifacts.find(artifact => artifact.kind === 'file')
    const patch = published.artifacts.find(artifact => artifact.kind === 'patch')
    if (file === undefined || patch === undefined) throw new Error('artifact provider did not persist file and patch')
    await expect(harness.ctx.teamArtifacts.read('local', { reference: file })).resolves.toEqual(new TextEncoder().encode('changed\n'))
    const patchBytes = await harness.ctx.teamArtifacts.read('local', { reference: patch })
    expect(new TextDecoder().decode(patchBytes)).toContain('changed')
    await writeFile(join(allocation.root, 'README.md'), 'initial\n')
    await allocation.release()
  })

  it('publishes an unchanged worktree without inventing a patch artifact', async () => {
    const harness = await setup({ artifacts: true })
    const allocation = await materialize(harness)
    await expect(harness.ctx.teamWorkspaces.publish('worktree', { allocation }))
      .resolves.toMatchObject({ changedPaths: [], artifacts: [], accepted: false })
    await allocation.release()
  })

  it('reports a changed symbolic link without treating it as a regular file artifact', async () => {
    const harness = await setup({ artifacts: true })
    const allocation = await materialize(harness)
    const link = join(allocation.root, 'readme-link')
    await symlink('README.md', link)
    const published = await harness.ctx.teamWorkspaces.publish('worktree', { allocation })
    expect(published.changedPaths).toContain('readme-link')
    expect(published.artifacts.map(artifact => artifact.kind)).toEqual(['patch'])
    await rm(link)
    await allocation.release()
  })

  it('refuses to materialize a Git-reported path outside the worktree root', async () => {
    const harness = await setup()
    const allocation = await materialize(harness)
    const originalSpawn = harness.ctx.subprocess.spawn.bind(harness.ctx.subprocess)
    const spawn = vi.spyOn(harness.ctx.subprocess, 'spawn').mockImplementation((spec) => {
      const handle = originalSpawn(spec)
      if (!spec.argv.includes('--name-only') || !spec.argv.includes('-z')) return handle
      const stdout = handle.collected.stdout
      if (stdout === undefined) throw new Error('Git path output was not collected')
      return { ...handle, collected: { ...handle.collected, stdout: {
        readFrom(offset: number) { return { ...stdout.readFrom(offset), text: '../outside-worktree\0' } },
      } } }
    })
    try {
      await expect(harness.ctx.teamWorkspaces.publish('worktree', { allocation }))
        .resolves.toMatchObject({ changedPaths: ['../outside-worktree'], artifacts: [] })
    } finally { spawn.mockRestore() }
    await allocation.release()
  })

  it('returns an explicit proposal and refuses merge mode without a dedicated authority', async () => {
    const harness = await setup()
    const allocation = await materialize(harness)
    await expect(harness.ctx.teamWorkspaces.integrate('worktree', {
      allocation,
      target: 'main',
      mode: 'proposal',
    })).resolves.toMatchObject({
      teamId,
      taskId,
      attemptId,
      target: 'main',
      status: 'proposed',
      accepted: true,
    })
    await expect(harness.ctx.teamWorkspaces.integrate('worktree', {
      allocation,
      target: 'main',
      mode: 'integrate',
    })).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    await allocation.release()
  })

  it('returns a patch-backed proposal and denies an integration policy decision before authority checks', async () => {
    const harness = await setup({ artifacts: true })
    const allocation = await materialize(harness)
    await writeFile(join(allocation.root, 'README.md'), 'proposal change\n')
    await expect(harness.ctx.teamWorkspaces.integrate('worktree', {
      allocation,
      target: ' main',
      mode: 'proposal',
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const proposed = await harness.ctx.teamWorkspaces.integrate('worktree', {
      allocation,
      target: 'main',
      mode: 'proposal',
    })
    expect(proposed).toMatchObject({ status: 'proposed', accepted: true, artifact: { kind: 'patch' } })

    harness.policy = { kind: 'deny', code: 'forbidden', message: 'integration is forbidden' }
    await expect(harness.ctx.teamWorkspaces.integrate('worktree', {
      allocation,
      target: 'main',
      mode: 'integrate',
      actorId: participantId,
    })).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED', message: 'integration is forbidden' })
    expect(harness.authorizations.at(-1)).toMatchObject({ hook: 'workspace-integrate', actorId: participantId })
    await writeFile(join(allocation.root, 'README.md'), 'initial\n')
    await allocation.release()
  })

  it('integrates through a detached merge authority with an expected target ref', async () => {
    const harness = await setup({ integration: true, artifacts: true })
    await git(harness.ctx, harness.repoRoot, ['branch', 'integration-target'])
    const allocation = await materialize(harness)
    await writeFile(join(allocation.root, 'README.md'), 'integrated by Team\n')
    const targetBefore = (await git(harness.ctx, harness.repoRoot, ['rev-parse', 'refs/heads/integration-target'])).trim()

    const integrated = await harness.ctx.teamWorkspaces.integrate('worktree', {
      allocation,
      target: 'integration-target',
      expectedTarget: targetBefore,
      mode: 'integrate',
    })
    expect(integrated).toMatchObject({
      teamId,
      taskId,
      attemptId,
      target: 'integration-target',
      status: 'integrated',
      accepted: true,
    })
    expect(integrated.targetVersion).toMatch(/^[0-9a-f]{40}$/)
    expect((await git(harness.ctx, harness.repoRoot, ['show', 'refs/heads/integration-target:README.md'])).trim())
      .toBe('integrated by Team')
    expect((await git(harness.ctx, harness.repoRoot, ['rev-parse', 'HEAD'])).trim()).toBe(targetBefore)

    // Integration does not silently clean the provider-owned source checkout;
    // the task owner decides when its worktree can be released.
    await writeFile(join(allocation.root, 'README.md'), 'initial\n')
    await allocation.release()
  })

  it('reports temporary index cleanup failure after an owned integration', async () => {
    const harness = await setup({ integration: true })
    await git(harness.ctx, harness.repoRoot, ['branch', 'integration-index-cleanup-error'])
    const allocation = await materialize(harness)
    await writeFile(join(allocation.root, 'README.md'), 'owned cleanup change\n')
    removalFault.pathPart = '.clocky-team-index-'
    try {
      await expect(harness.ctx.teamWorkspaces.integrate('worktree', {
        allocation, target: 'integration-index-cleanup-error', mode: 'integrate',
      })).rejects.toThrow('integration cleanup failed')
    } finally { removalFault.pathPart = undefined }
    await writeFile(join(allocation.root, 'README.md'), 'initial\n')
    await allocation.release()
  })

  it('returns a no-op target revision and rejects an allocation whose source head changed', async () => {
    const harness = await setup({ integration: true })
    await git(harness.ctx, harness.repoRoot, ['branch', 'integration-noop'])
    const invalidTarget = await materialize(harness)
    await expect(harness.ctx.teamWorkspaces.integrate('worktree', {
      allocation: invalidTarget,
      target: '-invalid-target',
      mode: 'integrate',
    })).rejects.toThrow('valid local branch name')
    await invalidTarget.release()

    const noOp = await materialize(harness)
    const target = (await git(harness.ctx, harness.repoRoot, ['rev-parse', 'refs/heads/integration-noop'])).trim()
    await expect(harness.ctx.teamWorkspaces.integrate('worktree', {
      allocation: noOp,
      target: 'integration-noop',
      expectedTarget: target,
      mode: 'integrate',
    })).resolves.toMatchObject({ status: 'integrated', accepted: true, targetVersion: target })
    await noOp.release()

    const checkedOut = await materialize(harness)
    await writeFile(join(checkedOut.root, 'README.md'), 'checked out target\n')
    const currentBranch = (await git(harness.ctx, harness.repoRoot, ['branch', '--show-current'])).trim()
    await expect(harness.ctx.teamWorkspaces.integrate('worktree', {
      allocation: checkedOut,
      target: currentBranch,
      mode: 'integrate',
    })).rejects.toThrow('checked out and cannot be updated safely')
    await writeFile(join(checkedOut.root, 'README.md'), 'initial\n')
    await checkedOut.release()

    await git(harness.ctx, harness.repoRoot, ['branch', 'integration-source-head'])
    const changed = await materialize(harness)
    await writeFile(join(changed.root, 'README.md'), 'source head changed\n')
    await git(harness.ctx, changed.root, ['add', 'README.md'])
    await git(harness.ctx, changed.root, [
      '-c', 'user.name=Source Head Test', '-c', 'user.email=source-head@example.test',
      'commit', '-m', 'source head changed',
    ])
    await expect(harness.ctx.teamWorkspaces.integrate('worktree', {
      allocation: changed,
      target: 'integration-source-head',
      mode: 'integrate',
    })).rejects.toThrow('changed its base commit')
    await changed.release()
  })

  it('reports a target conflict when the detached integration ref advances during compare-and-set', async () => {
    const harness = await setup({ integration: true, artifacts: true })
    await git(harness.ctx, harness.repoRoot, ['branch', 'integration-race'])
    const raceRoot = join(harness.allocationParent, 'race-source')
    await git(harness.ctx, harness.repoRoot, ['worktree', 'add', '--detach', raceRoot, 'integration-race'])
    await writeFile(join(raceRoot, 'README.md'), 'concurrent target change\n')
    await git(harness.ctx, raceRoot, ['add', 'README.md'])
    await git(harness.ctx, raceRoot, [
      '-c', 'user.name=Concurrent Target', '-c', 'user.email=concurrent-target@example.test',
      'commit', '-m', 'concurrent target change',
    ])
    const competingCommit = (await git(harness.ctx, raceRoot, ['rev-parse', 'HEAD'])).trim()
    await git(harness.ctx, harness.repoRoot, ['worktree', 'remove', '--force', raceRoot])

    const allocation = await materialize(harness)
    await writeFile(join(allocation.root, 'README.md'), 'source integration change\n')
    const targetBefore = (await git(harness.ctx, harness.repoRoot, ['rev-parse', 'refs/heads/integration-race'])).trim()
    let raced = false
    const originalSpawn = harness.ctx.subprocess.spawn.bind(harness.ctx.subprocess)
    const spawn = vi.spyOn(harness.ctx.subprocess, 'spawn').mockImplementation((spec) => {
      if (!raced && spec.argv.includes('update-ref') && spec.argv.includes('refs/heads/integration-race')) {
        raced = true
        execFileSync('git', ['-C', harness.repoRoot, 'update-ref', 'refs/heads/integration-race', competingCommit, targetBefore])
      }
      return originalSpawn(spec)
    })
    try {
      await expect(harness.ctx.teamWorkspaces.integrate('worktree', {
        allocation,
        target: 'integration-race',
        expectedTarget: targetBefore,
        mode: 'integrate',
      })).resolves.toMatchObject({ status: 'conflict', accepted: false, target: 'integration-race', artifact: { kind: 'patch' } })
    } finally {
      spawn.mockRestore()
    }
    expect((await git(harness.ctx, harness.repoRoot, ['show', 'refs/heads/integration-race:README.md'])).trim())
      .toBe('concurrent target change')
    await writeFile(join(allocation.root, 'README.md'), 'initial\n')
    await allocation.release()
  })

  it('preserves a merge failure when conflict inspection and abort are unavailable', async () => {
    const harness = await setup({ integration: true })
    await git(harness.ctx, harness.repoRoot, ['branch', 'integration-merge-error'])
    const allocation = await materialize(harness)
    await writeFile(join(allocation.root, 'README.md'), 'source change before merge failure\n')
    const originalSpawn = harness.ctx.subprocess.spawn.bind(harness.ctx.subprocess)
    const spawn = vi.spyOn(harness.ctx.subprocess, 'spawn').mockImplementation((spec) => {
      if (spec.argv.includes('merge') && spec.argv.includes('--no-commit')) throw new Error('merge command unavailable')
      if (spec.argv.includes('diff') && spec.argv.includes('--diff-filter=U')) throw new Error('conflict inspection unavailable')
      if (spec.argv.includes('merge') && spec.argv.includes('--abort')) throw new Error('merge abort unavailable')
      return originalSpawn(spec)
    })
    try {
      await expect(harness.ctx.teamWorkspaces.integrate('worktree', {
        allocation, target: 'integration-merge-error', mode: 'integrate',
      })).rejects.toThrow('merge command unavailable')
    } finally { spawn.mockRestore() }
    await writeFile(join(allocation.root, 'README.md'), 'initial\n')
    await allocation.release()
  })

  it('propagates a target update failure when the compare-and-set ref remains unchanged', async () => {
    const harness = await setup({ integration: true })
    await git(harness.ctx, harness.repoRoot, ['branch', 'integration-lock'])
    const allocation = await materialize(harness)
    await writeFile(join(allocation.root, 'README.md'), 'locked target integration\n')
    const lockPath = join(harness.repoRoot, '.git', 'refs', 'heads', 'integration-lock.lock')
    const originalSpawn = harness.ctx.subprocess.spawn.bind(harness.ctx.subprocess)
    const spawn = vi.spyOn(harness.ctx.subprocess, 'spawn').mockImplementation((spec) => {
      if (spec.argv.includes('update-ref') && spec.argv.includes('refs/heads/integration-lock')) writeFileSync(lockPath, '')
      return originalSpawn(spec)
    })
    try {
      await expect(harness.ctx.teamWorkspaces.integrate('worktree', {
        allocation,
        target: 'integration-lock',
        mode: 'integrate',
      })).rejects.toThrow('cannot lock ref')
    } finally {
      spawn.mockRestore()
      await rm(lockPath, { force: true })
    }
    await writeFile(join(allocation.root, 'README.md'), 'initial\n')
    await allocation.release()
  })

  it('returns a conflict when a failed target update also prevents ref observation', async () => {
    const harness = await setup({ integration: true })
    await git(harness.ctx, harness.repoRoot, ['branch', 'integration-ref-unavailable'])
    const allocation = await materialize(harness)
    await writeFile(join(allocation.root, 'README.md'), 'unobserved integration\n')
    let updateFailed = false
    const originalSpawn = harness.ctx.subprocess.spawn.bind(harness.ctx.subprocess)
    const spawn = vi.spyOn(harness.ctx.subprocess, 'spawn').mockImplementation((spec) => {
      if (spec.argv.includes('update-ref') && spec.argv.includes('refs/heads/integration-ref-unavailable')) {
        updateFailed = true
        throw new Error('target update unavailable')
      }
      if (updateFailed && spec.argv.includes('rev-parse')
        && spec.argv.some(arg => arg.includes('refs/heads/integration-ref-unavailable'))) {
        throw new Error('target ref observation unavailable')
      }
      return originalSpawn(spec)
    })
    try {
      await expect(harness.ctx.teamWorkspaces.integrate('worktree', {
        allocation, target: 'integration-ref-unavailable', mode: 'integrate',
      })).resolves.toMatchObject({ status: 'conflict', accepted: false })
    } finally { spawn.mockRestore() }
    await writeFile(join(allocation.root, 'README.md'), 'initial\n')
    await allocation.release()
  })

  it('integrates a completed source patch artifact without retaining the source allocation and replays the operation idempotently', async () => {
    const harness = await setup({ artifacts: true, integration: true })
    await git(harness.ctx, harness.repoRoot, ['branch', 'source-integration-target'])
    const allocation = await materialize(harness)
    await rm(join(allocation.root, 'README.md'))
    await writeFile(join(allocation.root, 'source-added.txt'), 'source artifact change\n')
    await git(harness.ctx, allocation.root, ['add', '--all'])
    await git(harness.ctx, allocation.root, [
      '-c', 'user.name=Source Test', '-c', 'user.email=source@example.test',
      'commit', '-m', 'source worktree checkpoint',
    ])
    await writeFile(join(allocation.root, 'source-untracked.txt'), 'source artifact untracked\n')
    const published = await harness.ctx.teamWorkspaces.publish('worktree', { allocation })
    const patch = published.artifacts.find(artifact => artifact.kind === 'patch')
    if (patch === undefined) throw new Error('source integration fixture did not publish a patch')
    expect(published.changedPaths).toEqual(['README.md', 'source-added.txt', 'source-untracked.txt'])
    expect(await git(harness.ctx, allocation.root, ['diff', '--cached'])).toBe('')
    const targetBefore = (await git(harness.ctx, harness.repoRoot, ['rev-parse', 'refs/heads/source-integration-target'])).trim()
    const request = {
      source: { teamId, taskId, attemptId, artifacts: published.artifacts },
      integrationTaskId: teamTaskIdSchema.parse('worktree-source-integration-task'),
      integrationAttemptId: taskAttemptIdSchema.parse('worktree-source-integration-attempt'),
      target: 'source-integration-target',
      expectedTarget: targetBefore,
      mode: 'integrate' as const,
      actorId: participantId,
    }
    const integrated = await harness.ctx.teamWorkspaces.integrateSource('worktree-local', request)
    expect(integrated).toMatchObject({
      teamId,
      sourceTaskId: taskId,
      sourceAttemptId: attemptId,
      integrationTaskId: request.integrationTaskId,
      integrationAttemptId: request.integrationAttemptId,
      target: request.target,
      status: 'integrated',
      artifact: patch,
    })
    expect(integrated.targetVersion).toMatch(/^[0-9a-f]{40}$/)
    const integratedFiles = await git(harness.ctx, harness.repoRoot, ['ls-tree', '-r', '--name-only', 'refs/heads/source-integration-target'])
    expect(integratedFiles.split('\n').filter(Boolean)).toEqual(['source-added.txt', 'source-untracked.txt'])
    expect((await git(harness.ctx, harness.repoRoot, ['show', 'refs/heads/source-integration-target:source-added.txt'])).trim())
      .toBe('source artifact change')

    const retry = await harness.ctx.teamWorkspaces.integrateSource('worktree-local', request)
    expect(retry).toEqual(integrated)
    await rm(join(allocation.root, 'source-untracked.txt'))
    await allocation.release()
  })

  it('records a target-fence conflict and rejects source integration without a provenance-bound patch', async () => {
    const harness = await setup({ artifacts: true, integration: true })
    await git(harness.ctx, harness.repoRoot, ['branch', 'source-integration-conflict'])
    const allocation = await materialize(harness)
    await writeFile(join(allocation.root, 'README.md'), 'source artifact conflict\n')
    const published = await harness.ctx.teamWorkspaces.publish('worktree', { allocation })
    const request = {
      source: { teamId, taskId, attemptId, artifacts: published.artifacts },
      integrationTaskId: teamTaskIdSchema.parse('worktree-source-conflict-task'),
      integrationAttemptId: taskAttemptIdSchema.parse('worktree-source-conflict-attempt'),
      target: 'source-integration-conflict',
      expectedTarget: '0'.repeat(40),
      mode: 'integrate' as const,
      actorId: participantId,
    }
    await expect(harness.ctx.teamWorkspaces.integrateSource('worktree-local', request)).resolves.toMatchObject({
      status: 'conflict', target: request.target,
    })
    await expect(harness.ctx.teamWorkspaces.integrateSource('worktree-local', {
      ...request,
      integrationTaskId: teamTaskIdSchema.parse('worktree-source-missing-patch-task'),
      source: { ...request.source, artifacts: published.artifacts.filter(artifact => artifact.kind !== 'patch') },
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await writeFile(join(allocation.root, 'README.md'), 'initial\n')
    await allocation.release()
  })

  it('captures untracked additions and tracked deletions without staging the source allocation', async () => {
    const harness = await setup({ integration: true })
    await git(harness.ctx, harness.repoRoot, ['branch', 'integration-mixed'])
    const allocation = await materialize(harness)
    await rm(join(allocation.root, 'README.md'))
    await writeFile(join(allocation.root, 'new-file.txt'), 'new content\n')
    const integrated = await harness.ctx.teamWorkspaces.integrate('worktree', {
      allocation,
      target: 'integration-mixed',
      mode: 'integrate',
    })
    expect(integrated).toMatchObject({ status: 'integrated', accepted: true })
    const files = await git(harness.ctx, harness.repoRoot, ['ls-tree', '-r', '--name-only', 'refs/heads/integration-mixed'])
    expect(files.split('\n').filter(Boolean)).toEqual(['new-file.txt'])
    await writeFile(join(allocation.root, 'README.md'), 'initial\n')
    await rm(join(allocation.root, 'new-file.txt'))
    await allocation.release()
  })

  it('reports an expected-target mismatch without changing the target branch', async () => {
    const harness = await setup({ integration: true })
    await git(harness.ctx, harness.repoRoot, ['branch', 'integration-conflict'])
    const allocation = await materialize(harness)
    await writeFile(join(allocation.root, 'README.md'), 'conflicting source\n')
    const conflict = await harness.ctx.teamWorkspaces.integrate('worktree', {
      allocation,
      target: 'integration-conflict',
      expectedTarget: '0'.repeat(40),
      mode: 'integrate',
    })
    expect(conflict).toMatchObject({ status: 'conflict', accepted: false, target: 'integration-conflict' })
    expect((await git(harness.ctx, harness.repoRoot, ['show', 'refs/heads/integration-conflict:README.md'])).trim())
      .toBe('initial')
    await writeFile(join(allocation.root, 'README.md'), 'initial\n')
    await allocation.release()
  })

  it('returns conflicting paths when the target branch changed the same file', async () => {
    const harness = await setup({ integration: true })
    const targetRoot = join(harness.repoRoot, '..', 'integration-conflict-checkout')
    await git(harness.ctx, harness.repoRoot, ['worktree', 'add', '--detach', targetRoot, 'HEAD'])
    await writeFile(join(targetRoot, 'README.md'), 'target branch change\n')
    await git(harness.ctx, targetRoot, ['-c', 'user.name=Target Test', '-c', 'user.email=target@example.test', 'add', 'README.md'])
    await git(harness.ctx, targetRoot, ['-c', 'user.name=Target Test', '-c', 'user.email=target@example.test', 'commit', '-m', 'target change'])
    const targetCommit = (await git(harness.ctx, targetRoot, ['rev-parse', 'HEAD'])).trim()
    await git(harness.ctx, harness.repoRoot, ['branch', 'integration-path-conflict', targetCommit])
    await git(harness.ctx, harness.repoRoot, ['worktree', 'remove', targetRoot])

    const allocation = await materialize(harness)
    await writeFile(join(allocation.root, 'README.md'), 'source branch change\n')
    const conflict = await harness.ctx.teamWorkspaces.integrate('worktree', {
      allocation,
      target: 'integration-path-conflict',
      expectedTarget: targetCommit,
      mode: 'integrate',
    })
    expect(conflict).toMatchObject({
      status: 'conflict',
      accepted: false,
      conflictPaths: ['README.md'],
    })
    expect((await git(harness.ctx, harness.repoRoot, ['show', 'refs/heads/integration-path-conflict:README.md'])).trim())
      .toBe('target branch change')
    await writeFile(join(allocation.root, 'README.md'), 'initial\n')
    await allocation.release()
  })

  it('leaves a dirty worktree allocated and retryable instead of force-removing it', async () => {
    const harness = await setup()
    const allocation = await materialize(harness)
    const dirty = join(allocation.root, 'dirty.txt')
    await writeFile(dirty, 'uncommitted\n')
    await expect(allocation.release()).rejects.toThrow('git -C')
    expect((await stat(allocation.root)).isDirectory()).toBe(true)
    await expect(materialize(harness)).rejects.toThrow('contains modified or untracked files')
    await rm(dirty)
    await allocation.release()
    await expect(stat(allocation.root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('shares one normal removal and rejects policy or missing-root allocation before Git publication', async () => {
    const harness = await setup()
    harness.policy = { kind: 'deny', code: 'forbidden', message: 'allocation is forbidden' }
    await expect(materialize(harness))
      .rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED', message: 'allocation is forbidden' })

    harness.policy = { kind: 'allow' }
    const allocation = await materialize(harness)
    await Promise.all([allocation.release(), allocation.release()])
    await expect(stat(allocation.root)).rejects.toMatchObject({ code: 'ENOENT' })

    await rm(harness.allocationParent, { recursive: true, force: true })
    await expect(materialize(harness))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  })

  it('returns false rather than adapting stale, non-local, unavailable, or non-worktree eligibility', async () => {
    const harness = await setup()
    const eligible = (): Promise<boolean> => harness.provider.eligible({ task: harness.task, binding: harness.binding })
    expect(await harness.provider.eligible({ task: { ...harness.task, workspaceMode: 'shared' }, binding: harness.binding })).toBe(false)
    harness.state = { ...harness.state, tasks: [{ ...harness.task, revision: 3 }] }
    expect(await eligible()).toBe(false)
    harness.state = { ...baseline().state, participants: [{ ...baseline().state.participants[0]!, kind: 'remote-agent' }] }
    expect(await eligible()).toBe(false)
    harness.state = { ...baseline().state, participants: [{ ...baseline().state.participants[0]!, phase: 'provisioning' }] }
    expect(await eligible()).toBe(false)
    harness.state = { ...baseline().state, activations: [{ ...harness.binding, provider: 'other' }] }
    expect(await eligible()).toBe(false)
    harness.state = { ...baseline().state, activations: [{ ...harness.binding, activation: { ...harness.binding.activation, status: 'offline' } }] }
    expect(await eligible()).toBe(false)
    harness.live.clear()
    expect(await eligible()).toBe(false)
    harness.live.set(String(sessionId), { id: SessionId('other-session'), session: { id: sessionId } })
    expect(await eligible()).toBe(false)
    harness.live.set(String(sessionId), { id: sessionId, session: { id: sessionId } })
    harness.state = { ...baseline().state, team: { ...baseline().state.team, phase: 'quiescing' } }
    expect(await eligible()).toBe(false)
    harness.state = baseline().state
    await rm(harness.allocationParent, { recursive: true, force: true })
    expect(await eligible()).toBe(false)
  })

  it('rejects stale ownership before it creates a worktree and preserves an existing non-provider path', async () => {
    const harness = await setup()
    const reject = async (message: string): Promise<void> => {
      await expect(materialize(harness)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      await expect(materialize(harness)).rejects.toThrow(message)
    }
    harness.state = { ...baseline().state, tasks: [] }
    await reject('not available')
    harness.state = { ...baseline().state, team: { ...baseline().state.team, phase: 'quiescing' } }
    await reject('not active')
    harness.state = { ...baseline().state, tasks: [{ ...baseline().task, workspaceMode: 'shared' }] }
    await reject('does not request')
    harness.state = { ...baseline().state, tasks: [{ ...baseline().task, phase: 'pending' }] }
    await reject('does not hold')
    const { lease: removedLease, ...leaseFreeTask } = baseline().task
    if (removedLease === undefined) throw new Error('baseline task must retain a lease')
    harness.state = { ...baseline().state, tasks: [leaseFreeTask] }
    await reject('has no current')
    harness.state = { ...baseline().state, tasks: [{ ...baseline().task, lease: { ...baseline().task.lease!, expiresAt: 0 } }] }
    await reject('has expired')
    harness.state = { ...baseline().state, tasks: [{ ...baseline().task, lease: { ...baseline().task.lease!, attemptId: taskAttemptIdSchema.parse('other') } }] }
    await reject('attempt does not match')
    harness.state = { ...baseline().state, tasks: [{ ...baseline().task, lease: { ...baseline().task.lease!, assignedRevision: 7 } }] }
    await reject('assigned revision does not match')
    harness.state = { ...baseline().state, tasks: [{ ...baseline().task, lease: { ...baseline().task.lease!, participantId: participantIdSchema.parse('other') } }] }
    await reject('participant does not match')
    harness.state = { ...baseline().state, tasks: [{ ...baseline().task, lease: { ...baseline().task.lease!, activationId: activationIdSchema.parse('other') } }] }
    await reject('activation does not match')
    harness.state = { ...baseline().state, participants: [{ ...baseline().state.participants[0]!, kind: 'human' }] }
    await reject('not an active local Agent')
    harness.state = { ...baseline().state, activations: [] }
    await reject('does not match')
    harness.state = { ...baseline().state, activations: [{ ...baseline().binding, sessionId: SessionId('other-session') }] }
    await reject('does not match')
    harness.state = { ...baseline().state, activations: [{ ...baseline().binding, activation: { ...baseline().binding.activation, status: 'starting' } }] }
    await reject('does not match')
    harness.state = baseline().state
    harness.live.clear()
    await reject('not a live local Agent')

    harness.live.set(String(sessionId), { id: sessionId, session: { id: sessionId } })
    const allocation = await materialize(harness)
    const root = allocation.root
    await allocation.release()
    await mkdir(root)
    await expect(materialize(harness)).rejects.toThrow('already exists')
    expect((await stat(root)).isDirectory()).toBe(true)
  })

  it('rejects invalid mount configuration before it registers a provider', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    contexts.add(ctx)
    await ctx.plugin(LocalSubprocessRuntime)
    const subprocess = ctx.subprocess as LocalSubprocessRuntime
    subprocess.internals.spillDir = root
    const repo = await createRepository(ctx, root)
    const parent = join(root, 'allocations')
    await mkdir(parent)
    const valid = {
      providerName: 'worktree-local', repoRoot: repo, allocationParent: parent,
      baseRef: 'HEAD', gitExecutable: 'git', processGraceMs: 100, commandTimeoutMs: 1_000, outputMaxBytes: 16 * 1024,
    }
    await expect(WorktreeWorkspace.apply(ctx, { ...valid, providerName: ' ' })).rejects.toThrow('providerName must be non-empty')
    await expect(WorktreeWorkspace.apply(ctx, { ...valid, baseRef: ' ' })).rejects.toThrow('baseRef must be non-empty')
    await expect(WorktreeWorkspace.apply(ctx, { ...valid, gitExecutable: ' ' })).rejects.toThrow('gitExecutable must be non-empty')
    await expect(WorktreeWorkspace.apply(ctx, { ...valid, processGraceMs: 0 })).rejects.toThrow('processGraceMs must be a positive integer')
    await expect(WorktreeWorkspace.apply(ctx, { ...valid, commandTimeoutMs: 0 })).rejects.toThrow('commandTimeoutMs must be a positive integer')
    await expect(WorktreeWorkspace.apply(ctx, { ...valid, outputMaxBytes: 0 })).rejects.toThrow('outputMaxBytes must be a positive integer')
    await expect(WorktreeWorkspace.apply(ctx, { ...valid, repoRoot: 'relative' })).rejects.toThrow('repoRoot must be an absolute path')
    await expect(WorktreeWorkspace.apply(ctx, { ...valid, allocationParent: join(root, 'missing') })).rejects.toThrow('cannot be canonicalized')
    const file = join(root, 'not-a-directory')
    await writeFile(file, 'not a directory')
    await expect(WorktreeWorkspace.apply(ctx, { ...valid, allocationParent: file })).rejects.toThrow('is not a directory')
    await expect(WorktreeWorkspace.apply(ctx, { ...valid, repoRoot: parent })).rejects.toThrow('not the canonical Git repository top-level')
    await expect(WorktreeWorkspace.apply(ctx, { ...valid, baseRef: 'missing-ref' })).rejects.toThrow('rev-parse')
    await expect(WorktreeWorkspace.apply(ctx, { ...valid, gitExecutable: join(root, 'missing-git') })).rejects.toThrow('not an executable file')
  })
})
