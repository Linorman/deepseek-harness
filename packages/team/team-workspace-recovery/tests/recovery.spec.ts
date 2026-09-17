import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import {
  TeamError,
  activationIdSchema,
  teamTaskCreateIdempotencyKeySchema,
  teamWorkspaceAllocationIdSchema,
  teamWorkspaceExecutionWorldSchema,
} from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  TeamSystemActivationProof,
  TeamSystemActivationProofSource,
  TeamSystemActivationScope,
  TeamSystemTaskLeaseProof,
  TeamSystemTaskLeaseProofSource,
  TeamSystemTaskLeaseScope,
  TeamSystemWorkspaceAllocationProof,
  TeamSystemWorkspaceAllocationProofSource,
  TeamSystemWorkspaceAllocationScope,
  TeamStateSnapshot,
  TeamWorkspaceAllocationSnapshot,
} from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import TeamWorkspaceRegistry from '@clocky/clocky-team-workspace'
import { TeamWorkspaceLostError } from '@clocky/clocky-team-workspace'
import type { TeamWorkspaceProvider, TeamWorkspacePrepareRequest, TeamWorkspaceAllocationMetadata } from '@clocky/clocky-team-workspace'
import * as WorkspaceRecovery from '../src/index.ts'

const contexts = new Set<Context>()
const roots: string[] = []

afterEach(async () => {
  for (const ctx of [...contexts]) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Create one provider-private persistence root under the repository test area. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-workspace-recovery-'))
  roots.push(root)
  return root
}

/** One direct proof source whose scopes exist only for an exact fixture Hub operation. */
async function withWorkspaceProof<T>(
  ctx: Context,
  scope: TeamSystemWorkspaceAllocationScope,
  operation: (actor: TeamSystemWorkspaceAllocationProof) => Promise<T>,
): Promise<T> {
  const proofs = new Map<TeamSystemWorkspaceAllocationProof, TeamSystemWorkspaceAllocationScope>()
  const source: TeamSystemWorkspaceAllocationProofSource = {
    name: 'workspace-recovery-fixture',
    resolveWorkspaceAllocationProof: proof => proofs.get(proof),
  }
  const unregister = ctx.teams.registerSystemWorkspaceAllocationProofSource(source)
  const proof = opaqueProof('fixture workspace proofs') as TeamSystemWorkspaceAllocationProof
  proofs.set(proof, Object.freeze(structuredClone(scope)))
  try {
    return await operation(proof)
  } finally {
    proofs.delete(proof)
    unregister()
  }
}

/** Bind one fixture activation through a source-owned controller-shaped proof. */
async function bindActivation(ctx: Context, binding: ActivationBindingSnapshot): Promise<ActivationBindingSnapshot> {
  const proofs = new Map<TeamSystemActivationProof, TeamSystemActivationScope>()
  const source: TeamSystemActivationProofSource = {
    name: 'team-activation-controller',
    resolveActivationProof: proof => proofs.get(proof),
  }
  const unregister = ctx.teams.registerSystemActivationProofSource(source)
  const state = await ctx.teams.getTeam({ teamId: binding.activation.teamId })
  const input = { expectedCursor: state.team.cursor, binding }
  const proof = opaqueProof('fixture activation proofs') as TeamSystemActivationProof
  proofs.set(proof, { kind: 'activation-controller-bind', ...input })
  try {
    return await ctx.teams.bindActivation({ actor: proof, ...input })
  } finally {
    proofs.delete(proof)
    unregister()
  }
}

/** Assign one task through a one-shot scheduler lease proof. */
async function assignTask(
  ctx: Context,
  input: Parameters<Context['teams']['assignTask']>[0] extends infer Request
    ? Omit<Request, 'actor'>
    : never,
) {
  const proofs = new Map<TeamSystemTaskLeaseProof, TeamSystemTaskLeaseScope>()
  const source: TeamSystemTaskLeaseProofSource = {
    name: 'team-scheduler-dag',
    resolveTaskLeaseProof: proof => proofs.get(proof),
  }
  const unregister = ctx.teams.registerSystemTaskLeaseProofSource(source)
  const proof = opaqueProof('fixture scheduler proofs') as TeamSystemTaskLeaseProof
  proofs.set(proof, { kind: 'scheduler-task-assign', ...input })
  try {
    return await ctx.teams.assignTask({ actor: proof, ...input })
  } finally {
    proofs.delete(proof)
    unregister()
  }
}

/** Create one opaque runtime-only proof fixture. */
function opaqueProof(message = 'fixture proof'): object {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError(`${message} are runtime-only`) },
  })
  return Object.freeze(proof)
}

/** Mount a real local Hub with a controllable release reconciler. */
async function setup(reconcileRelease: TeamWorkspaceProvider['reconcileRelease']): Promise<Context> {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: await freshRoot() })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(TeamWorkspaceRegistry)
  const provider: TeamWorkspaceProvider = {
    name: 'recovery-workspace',
    modes: ['shared', 'remote'],
    async eligible() { return true },
    async prepare() { throw new Error('recovery fixture never prepares a new workspace') },
    async restore() { throw new Error('recovery fixture never restores an active workspace') },
    reconcileRelease,
  }
  ctx.teamWorkspaces.registerProvider(provider)
  return ctx
}

/** Build a lightweight Team/Workspace context for bounded recovery-drive branches. */
function fakeDriveContext(options: {
  readonly pages: readonly { readonly items: readonly { readonly id: string }[]; readonly nextCursor?: string }[]
  readonly state: TeamStateSnapshot
  readonly reconcileRelease?: TeamWorkspaceProvider['reconcileRelease']
  readonly confirmRelease?: (input: Record<string, unknown>) => Promise<void>
  readonly preserve?: (input: Record<string, unknown>) => Promise<void>
}) {
  let pageIndex = 0
  const unregistered = vi.fn()
  let proofSource: TeamSystemWorkspaceAllocationProofSource | undefined
  const teams = {
    listTeamsPage: vi.fn(async () => {
      const page = options.pages[pageIndex++] ?? { items: [] }
      return { ...page, scanned: page.items.length }
    }),
    getTeam: vi.fn(async () => options.state),
    registerSystemWorkspaceAllocationProofSource: vi.fn((source: TeamSystemWorkspaceAllocationProofSource) => {
      proofSource = source
      return unregistered
    }),
    confirmWorkspaceAllocationRelease: vi.fn(async (input: Record<string, unknown>) => await options.confirmRelease?.(input)),
    preserveWorkspaceAllocation: vi.fn(async (input: Record<string, unknown>) => await options.preserve?.(input)),
  }
  const providerReconcile = options.reconcileRelease ?? (async () => {})
  const reconcileRelease = vi.fn(async (
    _mode: TeamWorkspaceAllocationSnapshot['mode'],
    request: TeamWorkspacePrepareRequest,
    metadata: TeamWorkspaceAllocationMetadata,
  ) => { await providerReconcile(request, metadata) })
  const teamWorkspaces = {
    reconcileRelease,
  }
  const ctx = new Context()
  ctx.provide('teams', teams as never)
  ctx.provide('teamWorkspaces', teamWorkspaces as never)
  return { ctx, teams, teamWorkspaces, unregistered, proofSource: () => proofSource }
}

/** Build one minimally complete release-requested allocation for a fake drive. */
function driveAllocation(
  lifecycle: TeamWorkspaceAllocationSnapshot['lifecycle'] = 'release-requested',
  baseVersion?: string,
): TeamWorkspaceAllocationSnapshot {
  return {
    id: teamWorkspaceAllocationIdSchema.parse('workspace-recovery-drive-allocation'),
    revision: 2,
    teamId: 'workspace-recovery-drive-team' as never,
    taskId: 'workspace-recovery-drive-task' as never,
    attemptId: 'workspace-recovery-drive-attempt' as never,
    assignedRevision: 1,
    participantId: 'workspace-recovery-drive-participant' as never,
    activationId: activationIdSchema.parse('workspace-recovery-drive-activation'),
    sessionId: SessionId('workspace-recovery-drive-session'),
    provider: 'recovery-workspace',
    mode: 'shared',
    lifecycle,
    reservedAt: 1,
    updatedAt: 2,
    ...lifecycle === 'release-requested' ? { releaseRequestedAt: 2 } : {},
    ...baseVersion === undefined ? {} : { baseVersion },
  }
}

/** Wrap a fake allocation in the smallest Team state shape recovery reads. */
function driveState(allocation: TeamWorkspaceAllocationSnapshot): TeamStateSnapshot {
  return {
    team: { id: allocation.teamId, cursor: 7 } as never,
    workspaceAllocations: [allocation],
  } as unknown as TeamStateSnapshot
}

/** Build one durable release-requested allocation for recovery ownership. */
async function releaseRequested(ctx: Context, requestRelease = true, remote = false): Promise<TeamWorkspaceAllocationSnapshot> {
  const created = await createTestRootTeam(ctx, { goal: { objective: 'Recover workspace cleanup.', budgets: {} }, rules: {}, budgets: {} })
  let state = await ctx.teams.getTeam({ teamId: created.team.id })
  const participant = await inviteBootstrapParticipant(ctx, {
    teamId: created.team.id,
    expectedCursor: state.team.cursor,
    kind: 'local-agent',
    displayName: 'Recovery worker',
    role: 'coordinator',
    capabilities: [],
  })
  state = await ctx.teams.getTeam({ teamId: created.team.id })
  await transitionBootstrapParticipant(ctx, {
    teamId: created.team.id,
    participantId: participant.id,
    expectedCursor: state.team.cursor,
    phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId: created.team.id })
  await transitionBootstrapParticipant(ctx, {
    teamId: created.team.id,
    participantId: participant.id,
    expectedCursor: state.team.cursor,
    phase: 'active',
  })
  const binding = await bindActivation(ctx, {
    activation: {
      id: activationIdSchema.parse(`workspace-recovery-${participant.id}`),
      teamId: created.team.id,
      participantId: participant.id,
      status: 'idle',
    },
    sessionId: SessionId(`workspace-recovery-${participant.id}`),
    provider: 'in-process',
  })
  state = await ctx.teams.getTeam({ teamId: created.team.id })
  const actor = ctx.teams.openActivationActorProofIssuer().issue(binding).proof
  const task = await ctx.teams.createTask({
    actor,
    teamId: created.team.id,
    expectedCursor: state.team.cursor,
    createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`workspace-recovery:${created.team.id}`) },
    subject: 'Recover workspace release',
    description: 'Retain an exact allocation for recovery.',
    blockedBy: [],
    requiredCapabilities: [],
    priority: 0,
    readScopes: [],
    writeScopes: [],
    workspaceMode: remote ? 'remote' : 'shared',
    budget: {},
    reviewPolicy: { kind: 'none' },
    maxAttempts: 1,
  })
  const assigned = await assignTask(ctx, {
    teamId: created.team.id,
    taskId: task.id,
    expectedRevision: task.revision,
    participantId: participant.id,
    activationId: binding.activation.id,
    leaseDurationMs: 1_000,
  })
  if (assigned.lease === undefined) throw new Error('recovery fixture did not retain a lease')
  const running = await ctx.teams.startTaskAttempt({
    actor,
    taskId: task.id,
    expectedRevision: assigned.revision,
    attemptId: assigned.lease.attemptId,
  })
  const reserveInput = {
    teamId: created.team.id,
    expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
    taskId: task.id,
    expectedTaskRevision: running.revision,
    attemptId: assigned.lease.attemptId,
    allocation: {
      id: teamWorkspaceAllocationIdSchema.parse(`workspace-recovery-allocation:${created.team.id}`),
      provider: 'recovery-workspace',
      mode: remote ? 'remote' as const : 'shared' as const,
      ...remote ? { executionWorld: teamWorkspaceExecutionWorldSchema.parse({ kind: 'e2b', id: 'recovery-world' }) } : {},
      assignedRevision: assigned.lease.assignedRevision,
      participantId: participant.id,
      activationId: binding.activation.id,
      sessionId: binding.sessionId,
    },
  }
  const reserved = await withWorkspaceProof(ctx, { kind: 'workspace-allocation-reserve', ...reserveInput }, async actor =>
    await ctx.teams.reserveWorkspaceAllocation({ actor, ...reserveInput }))
  const activateInput = {
    teamId: created.team.id,
    expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
    allocationId: reserved.id,
    expectedRevision: reserved.revision,
  }
  const active = await withWorkspaceProof(ctx, { kind: 'workspace-allocation-activate', ...activateInput }, async actor =>
    await ctx.teams.activateWorkspaceAllocation({ actor, ...activateInput }))
  if (!requestRelease) return active
  const releaseInput = {
    teamId: created.team.id,
    expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
    allocationId: active.id,
    expectedRevision: active.revision,
  }
  return await withWorkspaceProof(ctx, { kind: 'workspace-allocation-release-request', ...releaseInput }, async actor =>
    await ctx.teams.requestWorkspaceAllocationRelease({ actor, ...releaseInput }))
}

describe('Team workspace release recovery', () => {
  it('records definite loss before confirming a cold provider release', async () => {
    const reconcile = vi.fn(async () => {})
    const ctx = await setup(reconcile)
    const allocation = await releaseRequested(ctx, true, true)
    if (allocation.executionWorld === undefined) throw new Error('Expected exact remote world')
    reconcile.mockRejectedValueOnce(new TeamWorkspaceLostError({
      executionWorld: allocation.executionWorld, reason: 'sandbox-expired', terminationProven: true, artifacts: [],
    }))
    await WorkspaceRecovery.apply(ctx, { maxTeamsPerDrive: 8, pageSize: 4 })
    const current = (await ctx.teams.getTeam({ teamId: allocation.teamId })).workspaceAllocations[0]
    expect(current).toMatchObject({ lifecycle: 'released', loss: { reason: 'sandbox-expired', terminationProven: true } })
    expect(reconcile).toHaveBeenCalledTimes(2)
  })

  it('repairs a crash after loss admission before the renewed release intent', async () => {
    const reconcile = vi.fn(async () => {})
    const ctx = await setup(reconcile)
    const allocation = await releaseRequested(ctx, true, true)
    if (allocation.executionWorld === undefined) throw new Error('Expected exact remote world')
    reconcile.mockRejectedValueOnce(new TeamWorkspaceLostError({
      executionWorld: allocation.executionWorld, reason: 'sandbox-expired', terminationProven: true, artifacts: [],
    }))
    const release = vi.spyOn(ctx.teams, 'requestWorkspaceAllocationRelease').mockRejectedValueOnce(new Error('interrupted after loss'))
    await expect(WorkspaceRecovery.apply(ctx, { maxTeamsPerDrive: 8, pageSize: 4 })).rejects.toThrow()
    expect((await ctx.teams.getTeam({ teamId: allocation.teamId })).workspaceAllocations[0]).toMatchObject({
      lifecycle: 'unavailable', loss: { terminationProven: true }, releaseRequestedAt: allocation.releaseRequestedAt,
    })
    release.mockRestore()
    await WorkspaceRecovery.apply(ctx, { maxTeamsPerDrive: 8, pageSize: 4 })
    expect((await ctx.teams.getTeam({ teamId: allocation.teamId })).workspaceAllocations[0]?.lifecycle).toBe('released')
    expect(reconcile).toHaveBeenCalledTimes(2)
  })

  it('recovers a release request committed after startup without a periodic pulse', async () => {
    const reconcile = vi.fn(async () => {})
    const ctx = await setup(reconcile)
    const active = await releaseRequested(ctx, false)
    await WorkspaceRecovery.apply(ctx, { maxTeamsPerDrive: 8, pageSize: 4 })
    expect(reconcile).not.toHaveBeenCalled()
    const input = {
      teamId: active.teamId,
      expectedCursor: (await ctx.teams.getTeam({ teamId: active.teamId })).team.cursor,
      allocationId: active.id,
      expectedRevision: active.revision,
    }
    await withWorkspaceProof(ctx, { kind: 'workspace-allocation-release-request', ...input }, async actor =>
      await ctx.teams.requestWorkspaceAllocationRelease({ actor, ...input }))
    await vi.waitFor(async () => {
      expect((await ctx.teams.getTeam({ teamId: active.teamId })).workspaceAllocations[0]?.lifecycle).toBe('released')
    })
    expect(reconcile).toHaveBeenCalledOnce()
  })

  it('retries a failed confirmation append without another release event or provider call', async () => {
    const reconcile = vi.fn(async () => {})
    const ctx = await setup(reconcile)
    await WorkspaceRecovery.apply(ctx, {
      maxTeamsPerDrive: 8, pageSize: 4, confirmationAttempts: 2, confirmationRetryDelayMs: 1,
    })
    const active = await releaseRequested(ctx, false)
    const failed = Promise.withResolvers<undefined>()
    const confirm = vi.spyOn(ctx.teams, 'confirmWorkspaceAllocationRelease').mockImplementationOnce(async () => {
      failed.resolve(undefined)
      throw new Error('confirmation append interrupted')
    })
    const input = {
      teamId: active.teamId, expectedCursor: (await ctx.teams.getTeam({ teamId: active.teamId })).team.cursor,
      allocationId: active.id, expectedRevision: active.revision,
    }
    await withWorkspaceProof(ctx, { kind: 'workspace-allocation-release-request', ...input }, async actor =>
      await ctx.teams.requestWorkspaceAllocationRelease({ actor, ...input }))
    await failed.promise
    await vi.waitFor(async () => {
      expect((await ctx.teams.getTeam({ teamId: active.teamId })).workspaceAllocations[0]?.lifecycle).toBe('released')
    })
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(reconcile).toHaveBeenCalledOnce()
  })

  for (const error of [new Error('temporary storage read failure'), new TeamError('projection changed', 'TEAM_CURSOR_CONFLICT')]) {
    it(`retries ${error.message} without requiring a new release event`, async () => {
      const reconcile = vi.fn(async () => {})
      const ctx = await setup(reconcile)
      await WorkspaceRecovery.apply(ctx, { maxTeamsPerDrive: 8, pageSize: 4, readAttempts: 2, readRetryDelayMs: 1 })
      const active = await releaseRequested(ctx, false)
      const input = {
        teamId: active.teamId, expectedCursor: (await ctx.teams.getTeam({ teamId: active.teamId })).team.cursor,
        allocationId: active.id, expectedRevision: active.revision,
      }
      const failed = Promise.withResolvers<undefined>()
      const reads = vi.spyOn(ctx.teams, 'getTeam').mockImplementationOnce(async () => {
        failed.resolve(undefined)
        throw error
      })
      await withWorkspaceProof(ctx, { kind: 'workspace-allocation-release-request', ...input }, async actor =>
        await ctx.teams.requestWorkspaceAllocationRelease({ actor, ...input }))
      await failed.promise
      await vi.waitFor(() => { expect(reconcile).toHaveBeenCalledOnce() })
      await vi.waitFor(async () => {
        expect((await ctx.teams.getTeam({ teamId: active.teamId })).workspaceAllocations[0]?.lifecycle).toBe('released')
      })
      expect(reads.mock.calls.length).toBeGreaterThanOrEqual(3)
    })
  }

  for (const code of ['TEAM_JOURNAL_MALFORMED', 'TEAM_CHANNEL_WAL_MALFORMED', 'TEAM_CHECKPOINT_INVALID', 'EACCES', 'EPERM']) {
    it(`reports permanent ${code} reads without retrying`, async () => {
      const reconcile = vi.fn(async () => {})
      const ctx = await setup(reconcile)
      const pending = await releaseRequested(ctx)
      const failure = Object.assign(new Error('permanent storage failure'), { code })
      const read = vi.spyOn(ctx.teams, 'getTeam').mockRejectedValue(failure)
      const recovery = WorkspaceRecovery.apply(ctx, { maxTeamsPerDrive: 8, pageSize: 4, readAttempts: 3, readRetryDelayMs: 1 })
      await expect(recovery).rejects.toThrow('Team workspace recovery settlement failed')
      expect(read).toHaveBeenCalledOnce()
      expect(reconcile).not.toHaveBeenCalled()
      read.mockRestore()
      expect((await ctx.teams.getTeam({ teamId: pending.teamId })).workspaceAllocations[0]?.lifecycle).toBe('release-requested')
    })
  }

  it('reports an event-drive read rejection and stops after the configured attempts', async () => {
    const reconcile = vi.fn(async () => {})
    const ctx = await setup(reconcile)
    await WorkspaceRecovery.apply(ctx, { maxTeamsPerDrive: 8, pageSize: 4, readAttempts: 2, readRetryDelayMs: 1 })
    const active = await releaseRequested(ctx, false)
    const input = {
      teamId: active.teamId, expectedCursor: (await ctx.teams.getTeam({ teamId: active.teamId })).team.cursor,
      allocationId: active.id, expectedRevision: active.revision,
    }
    const reads = vi.spyOn(ctx.teams, 'getTeam').mockRejectedValue(new Error('storage remains unavailable'))
    const warning = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    await withWorkspaceProof(ctx, { kind: 'workspace-allocation-release-request', ...input }, async actor =>
      await ctx.teams.requestWorkspaceAllocationRelease({ actor, ...input }))
    await vi.waitFor(() => { expect(warning).toHaveBeenCalledWith(expect.stringContaining('drive failed')) })
    expect(reads).toHaveBeenCalledTimes(2)
    expect(reconcile).not.toHaveBeenCalled()
    reads.mockRestore()
  })

  it('reports permanent Team read rejection without consuming the I/O retry allowance', async () => {
    const ctx = await setup(async () => {})
    await releaseRequested(ctx)
    const read = vi.spyOn(ctx.teams, 'getTeam').mockRejectedValue(new TeamError('read forbidden', 'TEAM_POLICY_DENIED'))
    await expect(WorkspaceRecovery.apply(ctx, { maxTeamsPerDrive: 8, pageSize: 4, readAttempts: 3, readRetryDelayMs: 1 }))
      .rejects.toThrow('Team workspace recovery settlement failed')
    expect(read).toHaveBeenCalledOnce()
    read.mockRestore()
  })

  it('reports all confirmation and preservation failures after provider release succeeds', async () => {
    const reconcile = vi.fn(async () => {})
    const ctx = await setup(reconcile)
    await releaseRequested(ctx)
    const confirm = vi.spyOn(ctx.teams, 'confirmWorkspaceAllocationRelease').mockRejectedValue(new Error('confirmation unavailable'))
    const preserve = vi.spyOn(ctx.teams, 'preserveWorkspaceAllocation').mockRejectedValue(new Error('preservation unavailable'))
    await expect(WorkspaceRecovery.apply(ctx, { maxTeamsPerDrive: 8, pageSize: 4, confirmationAttempts: 2, confirmationRetryDelayMs: 1 }))
      .rejects.toThrow('Team workspace recovery settlement failed')
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(preserve).toHaveBeenCalledOnce()
    expect(reconcile).toHaveBeenCalledOnce()
  })

  it('recovers queue overflow through bounded durable pages after accepted release work drains', async () => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let blocked = false
    const reconcile = vi.fn(async () => {
      if (blocked) return
      blocked = true
      entered.resolve(undefined)
      await release.promise
    })
    const ctx = await setup(reconcile)
    await WorkspaceRecovery.apply(ctx, { maxTeamsPerDrive: 1, pageSize: 1, maxPendingTeams: 1 })
    const allocations: TeamWorkspaceAllocationSnapshot[] = []
    for (let index = 0; index < 3; index += 1) allocations.push(await releaseRequested(ctx, false))
    const pages = vi.spyOn(ctx.teams, 'listTeamsPage')
    for (const [index, allocation] of allocations.entries()) {
      const input = {
        teamId: allocation.teamId, expectedCursor: (await ctx.teams.getTeam({ teamId: allocation.teamId })).team.cursor,
        allocationId: allocation.id, expectedRevision: allocation.revision,
      }
      await withWorkspaceProof(ctx, { kind: 'workspace-allocation-release-request', ...input }, async actor =>
        await ctx.teams.requestWorkspaceAllocationRelease({ actor, ...input }))
      if (index === 0) await entered.promise
    }
    release.resolve(undefined)
    await vi.waitFor(async () => {
      for (const allocation of allocations) {
        expect((await ctx.teams.getTeam({ teamId: allocation.teamId })).workspaceAllocations[0]?.lifecycle).toBe('released')
      }
    })
    expect(pages).toHaveBeenCalledWith({ afterCursor: -1, limit: 1 })
    expect(pages.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(reconcile).toHaveBeenCalledTimes(3)
  })

  it('persists preservation when every configured confirmation attempt fails', async () => {
    const reconcile = vi.fn(async () => {})
    const ctx = await setup(reconcile)
    const pending = await releaseRequested(ctx)
    const confirm = vi.spyOn(ctx.teams, 'confirmWorkspaceAllocationRelease').mockRejectedValue(new Error('confirmation unavailable'))
    await WorkspaceRecovery.apply(ctx, { maxTeamsPerDrive: 8, pageSize: 4, confirmationAttempts: 2, confirmationRetryDelayMs: 1 })
    expect((await ctx.teams.getTeam({ teamId: pending.teamId })).workspaceAllocations[0]).toMatchObject({
      lifecycle: 'preserved', preservationReason: { code: 'WORKSPACE_RELEASE_RECOVERY_FAILED' },
    })
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(reconcile).toHaveBeenCalledOnce()
  })

  it('confirms a durable release request after provider reconciliation', async () => {
    const reconcile = vi.fn(async () => {})
    const ctx = await setup(reconcile)
    const pending = await releaseRequested(ctx)

    await WorkspaceRecovery.apply(ctx, { maxTeamsPerDrive: 8, pageSize: 4 })

    await expect(ctx.teams.getTeam({ teamId: pending.teamId })).resolves.toMatchObject({
      workspaceAllocations: [{ id: pending.id, lifecycle: 'released' }],
    })
    expect(reconcile).toHaveBeenCalledOnce()
  })

  it('preserves a release request when its provider cannot prove cleanup', async () => {
    const reconcile = vi.fn(async () => { throw new Error('dirty worktree') })
    const ctx = await setup(reconcile)
    const pending = await releaseRequested(ctx)

    await WorkspaceRecovery.apply(ctx, { maxTeamsPerDrive: 8, pageSize: 4 })

    await expect(ctx.teams.getTeam({ teamId: pending.teamId })).resolves.toMatchObject({
      workspaceAllocations: [{
        id: pending.id,
        lifecycle: 'preserved',
        preservationReason: { code: 'WORKSPACE_RELEASE_RECOVERY_FAILED' },
      }],
    })
    expect(reconcile).toHaveBeenCalledOnce()
  })

  it('bounds Team pages, follows cursors, and skips non-release allocations', async () => {
    const active = driveAllocation('active')
    const first = fakeDriveContext({
      pages: [
        { items: [{ id: String(active.teamId) }], nextCursor: '11' },
        { items: [] },
      ],
      state: driveState(active),
    })
    await WorkspaceRecovery.apply(first.ctx, { maxTeamsPerDrive: 2, pageSize: 1 })
    expect(first.teams.listTeamsPage).toHaveBeenNthCalledWith(1, { afterCursor: -1, limit: 1 })
    expect(first.teams.listTeamsPage).toHaveBeenNthCalledWith(2, { afterCursor: '11', limit: 1 })
    await first.ctx.fiber.dispose()

    const bounded = fakeDriveContext({
      pages: [{ items: [{ id: 'one' }], nextCursor: '99' }, { items: [{ id: 'two' }] }],
      state: driveState(active),
    })
    await WorkspaceRecovery.apply(bounded.ctx, { maxTeamsPerDrive: 1, pageSize: 8 })
    await vi.waitFor(() => {
      expect(bounded.teams.listTeamsPage).toHaveBeenNthCalledWith(2, { afterCursor: '99', limit: 1 })
    })
    const boundedProofSource = bounded.proofSource()
    if (boundedProofSource === undefined) throw new Error('recovery proof source was not registered')
    expect(boundedProofSource.resolveWorkspaceAllocationProof(opaqueProof() as TeamSystemWorkspaceAllocationProof)).toBeUndefined()
    await bounded.ctx.fiber.dispose()
    expect(boundedProofSource.resolveWorkspaceAllocationProof(opaqueProof() as TeamSystemWorkspaceAllocationProof)).toBeUndefined()
  })

  it('fails closed when a Team-list continuation cursor does not advance', async () => {
    const candidate = driveAllocation('active')
    const context = fakeDriveContext({
      pages: [
        { items: [{ id: 'one' }], nextCursor: '0' },
        { items: [{ id: 'two' }], nextCursor: '0' },
      ],
      state: driveState(candidate),
    })
    await expect(WorkspaceRecovery.apply(context.ctx, { maxTeamsPerDrive: 8, pageSize: 1, readAttempts: 1 }))
      .rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
    expect(context.teams.listTeamsPage).toHaveBeenCalledTimes(2)
    expect(context.unregistered).toHaveBeenCalledOnce()
  })

  it('leaves stale releases untouched and preserves an exhausted confirmation failure', async () => {
    const candidate = driveAllocation()
    const stale = fakeDriveContext({
      pages: [{ items: [{ id: String(candidate.teamId) }] }],
      state: driveState(candidate),
    })
    stale.teams.getTeam
      .mockResolvedValueOnce(driveState(candidate))
      .mockResolvedValueOnce(driveState({ ...candidate, lifecycle: 'active', activatedAt: 2 }))
    await WorkspaceRecovery.apply(stale.ctx, { maxTeamsPerDrive: 1, pageSize: 1 })
    expect(stale.teamWorkspaces.reconcileRelease).toHaveBeenCalledOnce()
    await stale.ctx.fiber.dispose()

    const warning = fakeDriveContext({
      pages: [{ items: [{ id: String(candidate.teamId) }] }],
      state: driveState(candidate),
      confirmRelease: async ({ actor }) => { JSON.stringify(actor) },
    })
    vi.spyOn(warning.ctx.logger, 'warn').mockImplementation(() => undefined)
    await WorkspaceRecovery.apply(warning.ctx, { maxTeamsPerDrive: 8, pageSize: 4, confirmationAttempts: 2, confirmationRetryDelayMs: 1 })
    expect(warning.teams.confirmWorkspaceAllocationRelease).toHaveBeenCalledTimes(2)
    expect(warning.teams.preserveWorkspaceAllocation).toHaveBeenCalledOnce()
    await warning.ctx.fiber.dispose()
  })

  it('preserves an unrenderable provider failure without losing its durable reason', async () => {
    const candidate = driveAllocation()
    const preserved: Record<string, unknown>[] = []
    const context = fakeDriveContext({
      pages: [{ items: [{ id: String(candidate.teamId) }] }],
      state: driveState(candidate),
      reconcileRelease: async () => {
        throw { toString: (): never => { throw new Error('cannot render') } }
      },
      preserve: async (input) => { preserved.push(input) },
    })
    await WorkspaceRecovery.apply(context.ctx, { maxTeamsPerDrive: 1, pageSize: 1 })
    expect(preserved).toMatchObject([{ reason: { message: '[unrenderable thrown value]' } }])
    await context.ctx.fiber.dispose()

    const stalePreserve = fakeDriveContext({
      pages: [{ items: [{ id: String(candidate.teamId) }] }],
      state: driveState(candidate),
      reconcileRelease: async () => { throw new Error('stale provider failure') },
      preserve: async (input) => { preserved.push(input) },
    })
    stalePreserve.teams.getTeam
      .mockResolvedValueOnce(driveState(candidate))
      .mockResolvedValueOnce({ ...driveState(candidate), workspaceAllocations: [] })
    await WorkspaceRecovery.apply(stalePreserve.ctx, { maxTeamsPerDrive: 1, pageSize: 1 })
    expect(stalePreserve.teams.preserveWorkspaceAllocation).not.toHaveBeenCalled()
    await stalePreserve.ctx.fiber.dispose()
  })

  it('cleans up proof registration on an initial drive failure and logs recurring failures', async () => {
    const failed = fakeDriveContext({ pages: [], state: driveState(driveAllocation()) })
    failed.teams.listTeamsPage.mockRejectedValue(new Error('startup scan failed'))
    await expect(WorkspaceRecovery.apply(failed.ctx, { maxTeamsPerDrive: 8, pageSize: 4, readAttempts: 1 }))
      .rejects.toThrow('Team list recovery read failed')
    expect(failed.unregistered).toHaveBeenCalledOnce()
    await failed.ctx.fiber.dispose()

    let calls = 0
    const recurring = fakeDriveContext({ pages: [], state: driveState(driveAllocation()) })
    recurring.teams.listTeamsPage.mockImplementation(async () => {
      calls += 1
      if (calls === 1) return { items: [], scanned: 0 }
      await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
      throw new Error('recurring scan failed')
    })
    vi.spyOn(recurring.ctx.logger, 'warn').mockImplementation(() => undefined)
    await WorkspaceRecovery.apply(recurring.ctx, { maxTeamsPerDrive: 1, pageSize: 1, pulseIntervalMs: 1, readAttempts: 1 })
    await new Promise<void>((resolve) => { setTimeout(resolve, 30) })
    expect(calls).toBeGreaterThan(1)
    expect(recurring.ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('drive failed'))
    await recurring.ctx.fiber.dispose()
  })

  it('drains a recurring provider reconciliation before revoking its proof source', async () => {
    vi.useFakeTimers()
    try {
      const candidate = driveAllocation('release-requested', 'provider-base-version')
      const pages: { readonly items: readonly { readonly id: string }[]; readonly nextCursor?: string }[] = [{ items: [] }]
      const reconciliationStarted = Promise.withResolvers<undefined>()
      const reconciliationRelease = Promise.withResolvers<undefined>()
      const context = fakeDriveContext({
        pages,
        state: driveState(candidate),
        reconcileRelease: async () => {
          reconciliationStarted.resolve(undefined)
          await reconciliationRelease.promise
        },
      })
      const warning = vi.spyOn(context.ctx.logger, 'warn').mockImplementation(() => undefined)
      const fiber = await context.ctx.plugin(WorkspaceRecovery, { maxTeamsPerDrive: 1, pageSize: 1, pulseIntervalMs: 1 })
      pages.push({ items: [{ id: String(candidate.teamId) }] })

      await vi.advanceTimersByTimeAsync(1)
      await reconciliationStarted.promise
      let disposed = false
      const disposal = fiber.dispose().then(() => { disposed = true })
      await vi.advanceTimersByTimeAsync(0)
      expect(disposed).toBe(false)
      expect(context.unregistered).not.toHaveBeenCalled()
      reconciliationRelease.resolve(undefined)
      await vi.advanceTimersByTimeAsync(0)
      await disposal
      expect(context.teams.confirmWorkspaceAllocationRelease).toHaveBeenCalledOnce()
      expect(context.unregistered).toHaveBeenCalledOnce()
      expect(warning).not.toHaveBeenCalled()
      await context.ctx.fiber.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('retains proof admission when disposal begins during an accepted Team reread', async () => {
    const candidate = driveAllocation()
    const context = fakeDriveContext({
      pages: [{ items: [] }],
      state: driveState(candidate),
    })
    const owner = { dispose: undefined as (() => Promise<void>) | undefined }
    let teamReads = 0
    context.teams.getTeam.mockImplementation(async () => {
      teamReads += 1
      if (teamReads === 2) {
        void owner.dispose?.()
        await new Promise<void>((resolve) => { setImmediate(resolve) })
      }
      return driveState(candidate)
    })
    const warning = vi.spyOn(context.ctx.logger, 'warn').mockImplementation(() => undefined)
    const fiber = await context.ctx.plugin(WorkspaceRecovery, { maxTeamsPerDrive: 1, pageSize: 1, pulseIntervalMs: 1 })
    owner.dispose = fiber.dispose
    const pages = context.teams.listTeamsPage
    pages.mockImplementationOnce(async () => ({ items: [{ id: String(candidate.teamId) }], scanned: 1 }))
    await vi.waitFor(() => {
      expect(context.teams.confirmWorkspaceAllocationRelease).toHaveBeenCalledOnce()
    }, { timeout: 1_000 })
    expect(warning).not.toHaveBeenCalled()
    await context.ctx.fiber.dispose()
  })

  it('settles a sibling allocation before reporting a failed preservation append', async () => {
    const first = driveAllocation()
    const second = { ...first, id: teamWorkspaceAllocationIdSchema.parse('second-recovery-allocation') }
    const current = { ...driveState(first), workspaceAllocations: [first, second] }
    const harness = fakeDriveContext({
      pages: [{ items: [{ id: first.teamId }] }],
      state: current,
      reconcileRelease: async (_request, metadata) => {
        if (metadata.id === first.id) throw new Error('first release cannot be proven')
      },
      preserve: async () => { throw new Error('preservation append unavailable') },
    })
    await expect(WorkspaceRecovery.apply(harness.ctx, { maxTeamsPerDrive: 1, pageSize: 1 }))
      .rejects.toThrow('Team workspace recovery settlement failed')
    expect(harness.teams.confirmWorkspaceAllocationRelease).toHaveBeenCalledOnce()
    expect(harness.teams.confirmWorkspaceAllocationRelease).toHaveBeenCalledWith(expect.objectContaining({ allocationId: second.id }))
    expect(harness.unregistered).toHaveBeenCalledOnce()
    await harness.ctx.fiber.dispose()
  })

  it('accepts Node timer limits and rejects durations that Node would coerce to one millisecond', async () => {
    const timerLimit = 2_147_483_647
    const fields = ['readRetryDelayMs', 'confirmationRetryDelayMs', 'pulseIntervalMs'] as const
    for (const field of fields) {
      const ctx = await setup(async () => {})
      const config = { maxTeamsPerDrive: 1, pageSize: 1, [field]: timerLimit }
      expect(WorkspaceRecovery.Config(config)[field]).toBe(timerLimit)
      await WorkspaceRecovery.apply(ctx, config)
      await expect(WorkspaceRecovery.apply(ctx, { ...config, [field]: timerLimit + 1 }))
        .rejects.toThrow(`${field} must not exceed ${timerLimit}ms`)
      expect(() => WorkspaceRecovery.Config({ ...config, [field]: timerLimit + 1 })).toThrow()
    }
  })

  it('rejects invalid recovery bounds before registering a source', async () => {
    const ctx = new Context()
    await expect(WorkspaceRecovery.apply(ctx, { maxTeamsPerDrive: 0, pageSize: 1 }))
      .rejects.toThrow('maxTeamsPerDrive must be a positive safe integer')
    await expect(WorkspaceRecovery.apply(ctx, { maxTeamsPerDrive: 1, pageSize: 0 }))
      .rejects.toThrow('pageSize must be a positive safe integer')
    for (const field of ['maxPendingTeams', 'readAttempts', 'readRetryDelayMs', 'confirmationAttempts', 'confirmationRetryDelayMs'] as const) {
      await expect(WorkspaceRecovery.apply(ctx, { maxTeamsPerDrive: 1, pageSize: 1, [field]: 0 }))
        .rejects.toThrow(`${field} must be a positive safe integer`)
    }
    await expect(WorkspaceRecovery.apply(ctx, { maxTeamsPerDrive: 1, pageSize: 1, pulseIntervalMs: 0 }))
      .rejects.toThrow('pulseIntervalMs must be a positive safe integer')
  })

})
