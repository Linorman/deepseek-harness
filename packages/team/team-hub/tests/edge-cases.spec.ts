import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestChildTeam, createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { acknowledgeTestChannelActivations, closeTestChannel, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import Storage from '@clocky/clocky-storage'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import { activationIdSchema, channelIdSchema, participantIdSchema, teamIdSchema, teamTaskCreateIdempotencyKeySchema, teamTaskIdSchema, teamTaskSnapshotSchema } from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ParticipantId,
  ParticipantSnapshot,
  TeamActorProof,
  TeamChannelAdapter,
  TeamPolicy,
  TeamPolicyRequest,
  TeamSystemEnvelopePostProof,
  TeamSystemEnvelopePostScope,
  TeamSystemPhaseProof,
  TeamSystemPhaseScope,
  TeamSystemTaskReviewProof,
  TeamSystemTaskReviewScope,
  TeamSystemTaskControlProof,
  TeamSystemTaskControlScope,
  TeamSystemDelegationProof,
  TeamSystemDelegationScope,
} from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import TeamHub, { CHANNEL_WAL_FORMAT_VERSION, TEAM_JOURNAL_FORMAT_VERSION } from '../src/index.ts'
import type { Config as TeamHubConfig } from '../src/index.ts'
import type { TeamJournalRecord, TeamProjection } from '../src/types.ts'
import { assignTestTask, bindTestActivation, createTestCoordinatorTask, deleteTestCoordinatorTask, expireTestTask, fenceTestActivation, postActor, provisionTestCoordinator, seedTeamPhase, updateTestActivationStatus, updateTestCoordinatorTask } from './fixtures.ts'

const roots: string[] = []
const contexts = new Set<Context>()
const delegationAuthorities = new WeakMap<Context, WeakMap<TeamSystemDelegationProof, TeamSystemDelegationScope>>()

/** Retain the exact delegation Consumer proof used by child-creation fixtures. */
function delegationProof(ctx: Context, scope: TeamSystemDelegationScope): TeamSystemDelegationProof {
  let proofs = delegationAuthorities.get(ctx)
  if (proofs === undefined) {
    const sourceProofs = new WeakMap<TeamSystemDelegationProof, TeamSystemDelegationScope>()
    proofs = sourceProofs
    delegationAuthorities.set(ctx, sourceProofs)
    ctx.teams.registerSystemDelegationProofSource({
      name: 'team-delegation',
      resolveDelegationProof: proof => sourceProofs.get(proof),
      resolveChildWorkspace: async () => process.cwd(),
    })
  }
  const proof = Object.freeze({}) as TeamSystemDelegationProof
  proofs.set(proof, scope)
  return proof
}

afterEach(async () => {
  vi.useRealTimers()
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
  if (failures.length > 0) throw new AggregateError(failures, 'Team Hub edge-test cleanup failed')
})

/** Mount one real SQLite-backed Hub at a test-local durable path. */
async function setup(root?: string, config?: TeamHubConfig): Promise<{ ctx: Context; root: string }> {
  const durableRoot = root ?? await freshRoot()
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageSqlite, { path: join(durableRoot, 'hub.db') })
  await ctx.plugin(StorageLog, { backend: 'sqlite', routes: {} })
  await ctx.plugin(TeamHub, config)
  ctx.teams.registerAdapter(directAdapter)
  ctx.teams.registerAdapter(consultAdapter)
  ctx.teams.registerViewPolicy(directedViewPolicy)
  return { ctx, root: durableRoot }
}

/** Allocate project-local storage for one real durable backend. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-hub-edges-'))
  roots.push(root)
  return root
}

const directAdapter: TeamChannelAdapter = {
  type: 'direct',
  version: 1,
  validateCreate() {},
  initialState() { return {} },
  validateSend() {},
  fold(state) { return state },
  afterAccept() { return [] },
  expectedNext() { return { kind: 'none' } },
  deliveryPlan() { return [] },
  projectView() { return {} },
}

/** Minimal consult protocol used to exercise Hub-owned review-response recovery. */
const consultAdapter: TeamChannelAdapter = {
  type: 'consult',
  version: 1,
  validateCreate() {},
  initialState() { return null },
  validateSend() {},
  fold(state) { return state },
  afterAccept() { return [] },
  expectedNext() { return { kind: 'none' } },
  deliveryPlan() { return [] },
  projectView() { return {} },
  closeAfterAccept({ record }) {
    return record.type === 'channel/envelope' && record.envelope.kind === 'response'
      ? 'consult response accepted'
      : undefined
  },
}

const directedViewPolicy = {
  type: 'directed',
  version: 1,
  project() { return {} },
}

const taskDefaults = {
  requiredCapabilities: [],
  priority: 0,
  readScopes: [],
  workspaceMode: 'shared' as const,
  budget: {},
  reviewPolicy: { kind: 'none' as const },
  maxAttempts: 3,
}

/** Add one active participant, which is required by the Phase2 channel owner. */
async function activeParticipant(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  options: {
    readonly kind?: 'human' | 'local-agent' | 'remote-agent' | 'service'
    readonly capabilities?: readonly string[]
    readonly role?: string
    readonly displayName?: string
  } = {},
) {
  const team = await ctx.teams.getTeam({ teamId })
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId,
    expectedCursor: team.team.cursor,
    kind: options.kind ?? 'local-agent',
    displayName: options.displayName ?? 'Worker',
    role: options.role ?? 'worker',
    capabilities: options.capabilities ?? [],
  })
  let current = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: current.team.cursor,
    phase: 'provisioning',
  })
  current = await ctx.teams.getTeam({ teamId })
  return await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: current.team.cursor,
    phase: 'active',
  })
}

/** Seed a terminal participant departure without fabricating topology authority for that edge. */
async function seedParticipantPhase(
  ctx: Context,
  teamId: ParticipantSnapshot['teamId'],
  participantId: ParticipantSnapshot['id'],
  phase: 'left' | 'failed',
): Promise<void> {
  const hub = ctx.teams as unknown as {
    readonly teams: ReadonlyMap<ParticipantSnapshot['teamId'], {
      readonly queue: { run<T>(operation: () => Promise<T>): Promise<T> }
      readonly projection: {
        readonly team: { readonly updatedAt: number }
        readonly participants: ReadonlyMap<ParticipantSnapshot['id'], ParticipantSnapshot>
      }
    }>
    commitTeamCommand(
      loaded: unknown,
      records: readonly TeamJournalRecord[],
      code: 'TEAM_INVALID_ARGUMENT',
    ): Promise<void>
  }
  const loaded = hub.teams.get(teamId)
  if (loaded === undefined) throw new Error(`Team Hub did not retain participant fixture Team '${teamId}'`)
  await loaded.queue.run(async () => {
    const participant = loaded.projection.participants.get(participantId)
    if (participant === undefined) throw new Error(`Team '${teamId}' has no fixture participant '${participantId}'`)
    await hub.commitTeamCommand(loaded, [{
      type: 'participant/changed',
      participant: { ...participant, phase },
      createdAt: Math.max(Date.now(), loaded.projection.team.updatedAt + 1),
    }], 'TEAM_INVALID_ARGUMENT')
  })
}

/** Bind one idle local activation so a task attempt can fence its exact residency epoch. */
async function taskActivation(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  participantId: Awaited<ReturnType<typeof activeParticipant>>['id'],
  name: string,
) {
  const current = await ctx.teams.getTeam({ teamId })
  const binding = await bindTestActivation(ctx, {
    expectedCursor: current.team.cursor,
    binding: {
      activation: {
        id: activationIdSchema.parse(`task-${name}-activation`),
        teamId,
        participantId,
        status: 'idle',
      },
      sessionId: SessionId(`task-${name}-session`),
      provider: 'in-process',
    },
  })
  return binding.activation.id
}

/** Issue one runtime-only proof for an already durable task-owner activation. */
async function taskActor(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  activationId: ReturnType<typeof activationIdSchema.parse>,
): Promise<TeamActorProof> {
  const binding = await ctx.teams.getActivation({ teamId, activationId })
  return ctx.teams.openActivationActorProofIssuer().issue(binding).proof
}

/** Register individually revocable test-local TeamRun default-worker task-control proofs. */
function taskControlAuthority(ctx: Context): {
  issue(scope: TeamSystemTaskControlScope): { readonly proof: TeamSystemTaskControlProof; revoke(): void }
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemTaskControlProof, TeamSystemTaskControlScope>()
  const dispose = ctx.teams.registerSystemTaskControlProofSource({
    name: 'team-run',
    resolveTaskControlProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof: object = {}
      Object.defineProperty(proof, 'toJSON', {
        enumerable: true,
        value: (): never => { throw new TypeError('test task-control proofs are runtime-only') },
      })
      const actor = Object.freeze(proof) as TeamSystemTaskControlProof
      proofs.set(actor, Object.freeze(structuredClone(scope)))
      return Object.freeze({ proof: actor, revoke: (): void => { proofs.delete(actor) } })
    },
    dispose,
  })
}

/** Register test-only scheduler sources that retain post and review-recovery proofs separately. */
function schedulerReviewAuthority(ctx: Context): {
  post(scope: TeamSystemEnvelopePostScope): TeamSystemEnvelopePostProof
  recover(scope: TeamSystemTaskReviewScope): TeamSystemTaskReviewProof
  revoke(proof: TeamSystemTaskReviewProof): void
} {
  const postProofs = new WeakMap<TeamSystemEnvelopePostProof, TeamSystemEnvelopePostScope>()
  const reviewProofs = new WeakMap<TeamSystemTaskReviewProof, TeamSystemTaskReviewScope>()
  ctx.teams.registerSystemEnvelopePostProofSource({
    name: 'team-scheduler-dag',
    resolveEnvelopePostProof: proof => postProofs.get(proof),
  })
  ctx.teams.registerSystemTaskReviewProofSource({
    name: 'team-scheduler-dag',
    resolveTaskReviewProof: proof => reviewProofs.get(proof),
  })
  const opaque = (label: string): object => {
    const proof: object = {}
    Object.defineProperty(proof, 'toJSON', {
      enumerable: true,
      value: (): never => { throw new TypeError(`${label} proofs are runtime-only`) },
    })
    return Object.freeze(proof)
  }
  return Object.freeze({
    post(scope) {
      const proof = opaque('scheduler post') as TeamSystemEnvelopePostProof
      postProofs.set(proof, scope)
      return proof
    },
    recover(scope) {
      const proof = opaque('scheduler review') as TeamSystemTaskReviewProof
      reviewProofs.set(proof, scope)
      return proof
    },
    revoke(proof) {
      reviewProofs.delete(proof)
    },
  })
}

/** Register one named source with independently revocable opaque phase proofs. */
function phaseAuthority(ctx: Context, name: string): {
  issue(scope: TeamSystemPhaseScope): { readonly proof: TeamSystemPhaseProof; revoke(): void }
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemPhaseProof, TeamSystemPhaseScope>()
  const dispose = ctx.teams.registerSystemPhaseProofSource({
    name,
    resolvePhaseProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof: object = {}
      Object.defineProperty(proof, 'toJSON', {
        enumerable: true,
        value: (): never => { throw new TypeError('Team phase proofs are runtime-only') },
      })
      const opaque = Object.freeze(proof) as TeamSystemPhaseProof
      proofs.set(opaque, scope)
      return Object.freeze({ proof: opaque, revoke: (): void => { proofs.delete(opaque) } })
    },
    dispose,
  })
}

/** Bind one active Agent residency that may authorize an activation-fenced Team-goal mutation. */
async function goalActivation(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  participantId: Awaited<ReturnType<typeof activeParticipant>>['id'],
  name: string,
): Promise<ActivationBindingSnapshot> {
  const current = await ctx.teams.getTeam({ teamId })
  return await bindTestActivation(ctx, {
    expectedCursor: current.team.cursor,
    binding: {
      activation: {
        id: activationIdSchema.parse(`goal-${name}-activation`),
        teamId,
        participantId,
        status: 'idle',
      },
      sessionId: SessionId(`goal-${name}-session`),
      provider: 'in-process',
    },
  })
}

/** Issue one runtime-only proof for an exact durable Team-goal activation. */
function goalActor(ctx: Context, binding: ActivationBindingSnapshot) {
  return ctx.teams.openActivationActorProofIssuer().issue(binding)
}

/** Create one pending task that can anchor a child-Team link. */
async function childAnchorTask(ctx: Context, teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id']) {
  await provisionTestCoordinator(ctx, teamId)
  const state = await ctx.teams.getTeam({ teamId })
  if (state.team.authorityGrant === undefined) throw new Error('child fixture parent has no authority grant')
  const authorityGrant = { ...state.team.authorityGrant, workspaceModes: ['shared'] as const, readScopes: [], writeScopes: [] }
  const task = await createTestCoordinatorTask(ctx, {
    teamId,
    expectedCursor: state.team.cursor,
    subject: 'Delegate nested work',
    description: 'Create a child Team for this task.',
    blockedBy: [],
    writeScopes: [],
    ...taskDefaults,
    maxAttempts: 1,
    execution: { kind: 'child-team', templateId: 'edge-child', templateVersion: 1, authorityGrant, budget: {} },
  })
  const current = await ctx.teams.getTeam({ teamId })
  const child = {
    goal: { objective: 'Create a child Team for this task.', budgets: {} },
    rules: { workspacePath: process.cwd() },
    budgets: {},
    authorityGrant,
  }
  const input = {
    teamId,
    taskId: task.id,
    expectedCursor: current.team.cursor,
    expectedRevision: task.revision,
    delegationId: task.delegation!.id,
    child,
  }
  const reserved = await ctx.teams.beginTaskDelegation({
    actor: delegationProof(ctx, { kind: 'delegation-begin', ...input }),
    ...input,
  })
  const creation = reserved.delegation?.creation
  if (creation === undefined) throw new Error('child fixture reservation did not retain creation input')
  return { task: reserved, creation }
}

describe('TeamHub public edge cases', () => {
  it('rejects a discovered Team stream with an unsupported journal format', async () => {
    const { ctx } = await setup()
    const stream = await ctx.storageLog.open({
      name: 'team/unsupported-format',
      version: TEAM_JOURNAL_FORMAT_VERSION - 1,
    })
    await stream.append(-1, [{ foreign: true }])
    await stream.close()
    await expect(ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
  })

  it('persists bounded child-Team lineage across restart', async () => {
    const first = await setup(undefined, { maxTeamDepth: 2 })
    const root = await createTestRootTeam(first.ctx, { goal: { objective: 'Root work', budgets: {} }, rules: {}, budgets: {} })
    const rootTask = await childAnchorTask(first.ctx, root.team.id)
    const child = await createTestChildTeam(first.ctx, rootTask.creation)
    const childTask = await childAnchorTask(first.ctx, child.team.id)
    const grandchild = await createTestChildTeam(first.ctx, childTask.creation)
    expect(root.team).toMatchObject({ depth: 0, maxTeamDepth: 2 })
    expect(child.team).toMatchObject({
      parentTeamId: root.team.id,
      parentTaskId: rootTask.task.id,
      depth: 1,
      maxTeamDepth: 2,
    })
    expect(grandchild.team).toMatchObject({
      parentTeamId: child.team.id,
      parentTaskId: childTask.task.id,
      depth: 2,
      maxTeamDepth: 2,
    })
    const durableRoot = first.root
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)

    const restored = await setup(durableRoot, { maxTeamDepth: 0 })
    await expect(restored.ctx.teams.getTeam({ teamId: child.team.id })).resolves.toMatchObject({
      team: {
        parentTeamId: root.team.id,
        parentTaskId: rootTask.task.id,
        depth: 1,
        maxTeamDepth: 2,
      },
    })
    await expect(restored.ctx.teams.getTeam({ teamId: grandchild.team.id })).resolves.toMatchObject({
      team: {
        parentTeamId: child.team.id,
        parentTaskId: childTask.task.id,
        depth: 2,
        maxTeamDepth: 2,
      },
    })
  })

  it('freezes omitted task placement from the Team product template while preserving explicit placement', async () => {
    const { ctx } = await setup()
    const root = await createTestRootTeam(ctx, {
      goal: { objective: 'Freeze placement defaults.', budgets: {} },
      rules: { productTemplate: { id: 'test-template', version: 1, placement: { roles: ['worker'] } } },
      budgets: {},
    })
    await provisionTestCoordinator(ctx, root.team.id)
    let state = await ctx.teams.getTeam({ teamId: root.team.id })
    const inherited = await createTestCoordinatorTask(ctx, {
      teamId: root.team.id,
      expectedCursor: state.team.cursor,
      subject: 'Inherited placement',
      description: 'The omitted placement must use the frozen template default.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
    })
    expect(inherited.placement).toEqual({ roles: ['worker'] })

    state = await ctx.teams.getTeam({ teamId: root.team.id })
    const explicit = await createTestCoordinatorTask(ctx, {
      teamId: root.team.id,
      expectedCursor: state.team.cursor,
      subject: 'Explicit placement',
      description: 'An explicit placement overrides the template default.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
      placement: { roles: ['reviewer'] },
    })
    expect(explicit.placement).toEqual({ roles: ['reviewer'] })
  })

  it('rejects placement outside the creator authority grant', async () => {
    const { ctx } = await setup()
    const seed = await createTestRootTeam(ctx, { goal: { objective: 'Seed the full grant.', budgets: {} }, rules: {}, budgets: {} })
    if (seed.team.authorityGrant === undefined) throw new Error('seed Team has no authority grant')
    const root = await createTestRootTeam(ctx, {
      goal: { objective: 'Narrow placement authority.', budgets: {} },
      rules: { productTemplate: { id: 'test-template', version: 1, placement: { roles: ['worker'] } } },
      budgets: {},
      authorityGrant: { ...seed.team.authorityGrant, placement: { roles: ['worker'] } },
    })
    await provisionTestCoordinator(ctx, root.team.id)
    const state = await ctx.teams.getTeam({ teamId: root.team.id })
    await expect(createTestCoordinatorTask(ctx, {
      teamId: root.team.id,
      expectedCursor: state.team.cursor,
      subject: 'Outside grant',
      description: 'This placement must be rejected.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
      placement: { roles: ['reviewer'] },
    })).rejects.toMatchObject({ code: 'TEAM_GRANT_DENIED' })
  })

  it.each(['failed', 'cancelled', 'deleted'] as const)('cancels an unstarted child reservation after a %s prerequisite becomes terminal', async (outcome) => {
    const { ctx } = await setup(undefined, { maxTeamDepth: 1 })
    const root = await createTestRootTeam(ctx, { goal: { objective: 'Propagate child dependency outcomes.', budgets: {} }, rules: {}, budgets: {} })
    await provisionTestCoordinator(ctx, root.team.id)
    let state = await ctx.teams.getTeam({ teamId: root.team.id })
    const blocker = await createTestCoordinatorTask(ctx, {
      teamId: root.team.id,
      expectedCursor: state.team.cursor,
      subject: 'Terminal prerequisite',
      description: 'This task reaches a terminal phase before the child starts.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
      maxAttempts: 1,
    })
    state = await ctx.teams.getTeam({ teamId: root.team.id })
    if (state.team.authorityGrant === undefined) throw new Error('child dependency fixture has no parent grant')
    const authorityGrant = { ...state.team.authorityGrant, workspaceModes: ['shared'] as const, readScopes: [], writeScopes: [] }
    const child = await createTestCoordinatorTask(ctx, {
      teamId: root.team.id,
      expectedCursor: state.team.cursor,
      subject: 'Blocked child',
      description: 'This child must retain its terminal dependency cause.',
      blockedBy: [blocker.id],
      writeScopes: [],
      ...taskDefaults,
      maxAttempts: 1,
      execution: { kind: 'child-team', templateId: 'edge-child', templateVersion: 1, authorityGrant, budget: {} },
    })
    expect(child.delegation).toMatchObject({ phase: 'requested' })

    let terminal = blocker
    if (outcome === 'deleted') {
      terminal = await deleteTestCoordinatorTask(ctx, { teamId: root.team.id, taskId: blocker.id, expectedRevision: blocker.revision })
    } else if (outcome === 'cancelled') {
      const controls = taskControlAuthority(ctx)
      const creator = blocker.createCommand.creator
      if (!('activationId' in creator)) throw new Error('child dependency fixture requires an activation-backed creator')
      const issued = controls.issue({ kind: 'team-run-default-worker-cancel', teamId: root.team.id,
        taskId: blocker.id, expectedRevision: blocker.revision, coordinator: creator })
      try {
        terminal = await ctx.teams.cancelTask({ actor: issued.proof, teamId: root.team.id, taskId: blocker.id,
          expectedRevision: blocker.revision })
      } finally { issued.revoke(); controls.dispose() }
    } else {
      const owner = await activeParticipant(ctx, root.team.id)
      const activation = await taskActivation(ctx, root.team.id, owner.id, 'child-dependency-failed')
      const actor = await taskActor(ctx, root.team.id, activation)
      const assigned = await assignTestTask(ctx, { teamId: root.team.id, taskId: blocker.id,
        expectedRevision: blocker.revision, participantId: owner.id, activationId: activation, leaseDurationMs: 1_000 })
      if (assigned.lease === undefined) throw new Error('child dependency failure fixture requires a lease')
      terminal = await ctx.teams.settleTaskAttempt({ actor, taskId: blocker.id, expectedRevision: assigned.revision,
        attemptId: assigned.lease.attemptId, outcome: { kind: 'failed', failure: { code: 'fixture-failed', message: 'Fixture blocker failed.' } } })
    }
    const settled = await ctx.teams.getTask({ teamId: root.team.id, taskId: child.id })
    expect(terminal.phase).toBe(outcome)
    expect(settled).toMatchObject({
      phase: 'cancelled',
      blockedByOutcome: { taskId: blocker.id, revision: terminal.revision, phase: outcome },
      delegation: { phase: 'cancelled' },
    })
    expect(settled.delegation?.childTeamId).toBeUndefined()
  })

  it('rejects child links with missing tasks, inactive parents, or exhausted depth', async () => {
    const { ctx } = await setup(undefined, { maxTeamDepth: 1 })
    const root = await createTestRootTeam(ctx, { goal: { objective: 'Root work', budgets: {} }, rules: {}, budgets: {} })
    await expect(createTestChildTeam(ctx, {
      goal: { objective: 'Missing task', budgets: {} },
      rules: {},
      budgets: {},
      parentTeamId: root.team.id,
      parentTaskId: teamTaskIdSchema.parse('missing-task'),
    })).rejects.toMatchObject({ code: 'TEAM_TASK_NOT_FOUND' })

    const rootTask = await childAnchorTask(ctx, root.team.id)
    const child = await createTestChildTeam(ctx, rootTask.creation)
    await expect(childAnchorTask(ctx, child.team.id)).rejects.toMatchObject({ code: 'TEAM_DELEGATION_INVALID' })

    const inactive = await createTestRootTeam(ctx, { goal: { objective: 'Inactive parent', budgets: {} }, rules: {}, budgets: {} })
    const inactiveTask = await childAnchorTask(ctx, inactive.team.id)
    await seedTeamPhase(ctx, inactive.team.id, 'quiescing')
    await expect(createTestChildTeam(ctx, inactiveTask.creation)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const overflow = await createTestRootTeam(ctx, { goal: { objective: 'Overflow parent', budgets: {} }, rules: {}, budgets: {} })
    const overflowTask = await childAnchorTask(ctx, overflow.team.id)
    const overflowCursor = (await ctx.teams.getTeam({ teamId: overflow.team.id })).team.cursor
    const internals = ctx.teams as unknown as {
      teams: Map<string, { projection: TeamProjection }>
    }
    const loaded = internals.teams.get(overflow.team.id)
    if (loaded === undefined) throw new Error('overflow Team was not loaded')
    loaded.projection = {
      ...loaded.projection,
      team: {
        ...loaded.projection.team,
        depth: Number.MAX_SAFE_INTEGER,
        maxTeamDepth: Number.MAX_SAFE_INTEGER,
      },
    }
    await expect(createTestChildTeam(ctx, overflowTask.creation, overflowCursor)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  })

  it('requires an exact source-owned proof for lifecycle stalls and resumes', async () => {
    const { ctx } = await setup()
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Lifecycle', budgets: {} }, rules: {}, budgets: {} })
    const scheduler = phaseAuthority(ctx, 'team-scheduler-dag')
    const teamRun = phaseAuthority(ctx, 'team-run')
    const reason = { code: 'TASK_NO_ELIGIBLE_OWNER', message: 'Ready work has no eligible owner.' }
    await expect(ctx.teams.transitionTeamPhase({
      teamId: created.team.id,
      actor: {} as TeamSystemPhaseProof,
      expectedCursor: created.team.cursor,
      phase: 'stalled',
      reason,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(ctx.teams.transitionTeamPhase({
      teamId: created.team.id,
      actor: scheduler.issue({ kind: 'scheduler-stall', teamId: created.team.id, phase: 'stalled', reason }).proof,
      expectedCursor: created.team.cursor - 1,
      phase: 'stalled',
      reason,
    })).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
    const stalled = await ctx.teams.transitionTeamPhase({
      teamId: created.team.id,
      actor: scheduler.issue({ kind: 'scheduler-stall', teamId: created.team.id, phase: 'stalled', reason }).proof,
      expectedCursor: created.team.cursor,
      phase: 'stalled',
      reason,
    })
    await expect(ctx.teams.transitionTeamPhase({
      teamId: created.team.id,
      actor: scheduler.issue({ kind: 'scheduler-stall', teamId: created.team.id, phase: 'stalled', reason }).proof,
      expectedCursor: stalled.team.cursor,
      phase: 'active',
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(openTestChannel(ctx, {
      teamId: created.team.id,
      expectedCursor: stalled.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [],
      limits: {},
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const resumed = await ctx.teams.transitionTeamPhase({
      teamId: created.team.id,
      actor: teamRun.issue({ kind: 'team-run-resume', teamId: created.team.id, phase: 'active' }).proof,
      expectedCursor: stalled.team.cursor,
      phase: 'active',
    })
    expect(resumed.team.phase).toBe('active')
    teamRun.dispose()
    scheduler.dispose()
  })

  it('persists proof-authorized Team goals through CAS updates, lifecycle changes, policy, and restart', async () => {
    const first = await setup()
    const created = await createTestRootTeam(first.ctx, {
      goal: { objective: 'Initial objective', budgets: { turns: 2 } },
      rules: {},
      budgets: { tokens: 100 },
    })
    expect(created.goal).toMatchObject({
      teamId: created.team.id,
      revision: 1,
      objective: 'Initial objective',
      phase: 'active',
      budgets: { turns: 2 },
    })
    const actor = await activeParticipant(first.ctx, created.team.id)
    const actorBinding = await goalActivation(first.ctx, created.team.id, actor.id, 'cas')
    const actorProof = goalActor(first.ctx, actorBinding).proof
    const inactiveState = await first.ctx.teams.getTeam({ teamId: created.team.id })
    const inactiveActor = await inviteBootstrapParticipant(first.ctx, {
      teamId: created.team.id,
      expectedCursor: inactiveState.team.cursor,
      kind: 'service',
      displayName: 'Inactive goal actor',
      role: 'observer',
      capabilities: [],
    })
    await expect(first.ctx.teams.updateTeamGoal({
      teamId: created.team.id,
      actor: {} as TeamActorProof,
      expectedRevision: created.goal.revision,
      objective: 'Rejected missing actor',
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(first.ctx.teams.updateTeamGoal({
      teamId: created.team.id,
      actor: { kind: 'participant', participantId: inactiveActor.id } as never,
      expectedRevision: created.goal.revision,
      objective: 'Rejected inactive actor',
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const updated = await first.ctx.teams.updateTeamGoal({
      teamId: created.team.id,
      actor: actorProof,
      expectedRevision: created.goal.revision,
      objective: ' Updated objective ',
      budgets: { turns: 3 },
    })
    expect(updated.goal).toMatchObject({ revision: 2, objective: 'Updated objective', phase: 'active', budgets: { turns: 3 } })
    await expect(first.ctx.teams.updateTeamGoal({
      teamId: created.team.id,
      actor: actorProof,
      expectedRevision: created.goal.revision,
      objective: 'Stale update',
    })).rejects.toMatchObject({ code: 'TEAM_GOAL_STALE_REVISION' })
    const blocked = await first.ctx.teams.transitionTeamGoalPhase({
      teamId: created.team.id,
      actor: actorProof,
      expectedRevision: updated.goal.revision,
      phase: 'blocked',
      blocker: { code: 'needs-input', message: 'Need a user decision.' },
    })
    expect(blocked.goal).toMatchObject({
      revision: 3,
      phase: 'blocked',
      blocker: { code: 'needs-input', message: 'Need a user decision.' },
    })
    const resumed = await first.ctx.teams.transitionTeamGoalPhase({
      teamId: created.team.id,
      actor: actorProof,
      expectedRevision: blocked.goal.revision,
      phase: 'active',
    })
    expect(resumed.goal).toMatchObject({ revision: 4, phase: 'active' })
    expect(resumed.goal.blocker).toBeUndefined()
    const budgetUpdated = await first.ctx.teams.updateTeamGoal({
      teamId: created.team.id,
      actor: actorProof,
      expectedRevision: resumed.goal.revision,
      budgets: { turns: 4 },
    })
    expect(budgetUpdated.goal).toMatchObject({ revision: 5, objective: 'Updated objective', budgets: { turns: 4 } })
    const deny = first.ctx.teams.registerPolicy('goal-mutate', {
      name: 'deny-goal-edit',
      async apply(request) {
        expect(request.actorId).toBe(actor.id)
        expect(request.facts).not.toHaveProperty('participantId')
        return { kind: 'deny', code: 'denied', message: 'Goal edits are paused' }
      },
    })
    await expect(first.ctx.teams.updateTeamGoal({
      teamId: created.team.id,
      actor: actorProof,
      expectedRevision: budgetUpdated.goal.revision,
      objective: 'Denied',
    })).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    deny()
    const completed = await first.ctx.teams.transitionTeamGoalPhase({
      teamId: created.team.id,
      actor: actorProof,
      expectedRevision: budgetUpdated.goal.revision,
      phase: 'complete',
    })
    await expect(first.ctx.teams.transitionTeamGoalPhase({
      teamId: created.team.id,
      actor: actorProof,
      expectedRevision: completed.goal.revision,
      phase: 'active',
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const root = first.root
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)

    const recovered = await setup(root)
    await expect(recovered.ctx.teams.getTeam({ teamId: created.team.id })).resolves.toMatchObject({
      team: { goal: { revision: 6, phase: 'complete' } },
      goal: { revision: 6, phase: 'complete', objective: 'Updated objective', budgets: { turns: 4 } },
    })
  })

  it('derives Team-goal authority from one current opaque activation proof', async () => {
    const { ctx } = await setup()
    const created = await createTestRootTeam(ctx, {
      goal: { objective: 'Fence the Team goal.', budgets: {} },
      rules: {},
      budgets: {},
    })
    const coordinator = await activeParticipant(ctx, created.team.id)
    const binding = await goalActivation(ctx, created.team.id, coordinator.id, 'coordinator')
    const actorLease = goalActor(ctx, binding)
    const policy = vi.fn<TeamPolicy['apply']>(async (_request, next) => await next())
    ctx.teams.registerPolicy('goal-mutate', { name: 'observe-goal-activation-actor', apply: policy })

    const updated = await ctx.teams.updateTeamGoal({
      teamId: created.team.id,
      actor: actorLease.proof,
      expectedRevision: created.goal.revision,
      objective: 'Use the current coordinator activation.',
    })
    expect(updated.goal).toMatchObject({ revision: 2, objective: 'Use the current coordinator activation.' })
    expect(policy).toHaveBeenCalledWith(expect.objectContaining({
      hook: 'goal-mutate',
      teamId: created.team.id,
      actorId: coordinator.id,
    }), expect.any(Function))

    const foreign = await createTestRootTeam(ctx, {
      goal: { objective: 'Supply a foreign goal proof.', budgets: {} }, rules: {}, budgets: {},
    })
    const foreignCoordinator = await activeParticipant(ctx, foreign.team.id)
    const foreignBinding = await goalActivation(ctx, foreign.team.id, foreignCoordinator.id, 'foreign')
    const foreignLease = goalActor(ctx, foreignBinding)
    const beforeInvalid = await ctx.teams.getTeam({ teamId: created.team.id })
    for (const actor of [{}, foreignLease.proof]) {
      await expect(ctx.teams.updateTeamGoal({
        teamId: created.team.id,
        actor: actor as TeamActorProof,
        expectedRevision: updated.goal.revision,
        objective: 'Rejected forged goal update.',
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    }
    expect((await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor).toBe(beforeInvalid.team.cursor)
    expect(policy).toHaveBeenCalledTimes(1)

    actorLease.revoke()
    await expect(ctx.teams.transitionTeamGoalPhase({
      teamId: created.team.id,
      actor: actorLease.proof,
      expectedRevision: updated.goal.revision,
      phase: 'blocked',
      blocker: { code: 'needs-input', message: 'Need a human decision.' },
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })

    const staleLease = goalActor(ctx, binding)
    let current = await ctx.teams.getTeam({ teamId: created.team.id })
    await updateTestActivationStatus(ctx, {
      teamId: created.team.id,
      activationId: binding.activation.id,
      expectedCursor: current.team.cursor,
      status: 'offline',
    })
    current = await ctx.teams.getTeam({ teamId: created.team.id })
    await expect(ctx.teams.transitionTeamGoalPhase({
      teamId: created.team.id,
      actor: staleLease.proof,
      expectedRevision: current.goal.revision,
      phase: 'blocked',
      blocker: { code: 'needs-input', message: 'Need a human decision.' },
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await ctx.teams.getTeam({ teamId: created.team.id })).goal).toMatchObject({ revision: 2, phase: 'active' })
  })

  it('rejects invalid durable activation-binding commands without changing Team state', async () => {
    const { ctx } = await setup()
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Activation binding', budgets: {} }, rules: {}, budgets: {} })
    const participant = await activeParticipant(ctx, created.team.id)
    let current = await ctx.teams.getTeam({ teamId: created.team.id })
    const binding = {
      activation: {
        id: activationIdSchema.parse('activation-edge'),
        teamId: current.team.id,
        participantId: participant.id,
        status: 'idle' as const,
      },
      sessionId: SessionId('activation-edge-session'),
      provider: 'in-process',
    }

    await expect(bindTestActivation(ctx, {
      expectedCursor: current.team.cursor - 1,
      binding,
    })).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
    await expect(bindTestActivation(ctx, {
      expectedCursor: current.team.cursor,
      binding: {
        ...binding,
        activation: { ...binding.activation, participantId: 'missing-participant' as typeof participant.id },
      },
    })).rejects.toMatchObject({ code: 'TEAM_PARTICIPANT_NOT_FOUND' })

    const accepted = await bindTestActivation(ctx, { expectedCursor: current.team.cursor, binding })
    current = await ctx.teams.getTeam({ teamId: current.team.id })
    await expect(bindTestActivation(ctx, { expectedCursor: current.team.cursor, binding }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(bindTestActivation(ctx, {
      expectedCursor: current.team.cursor,
      binding: {
        ...binding,
        activation: { ...binding.activation, id: activationIdSchema.parse('activation-edge-concurrent') },
      },
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(updateTestActivationStatus(ctx, {
      teamId: current.team.id,
      activationId: activationIdSchema.parse('missing-activation'),
      expectedCursor: current.team.cursor,
      status: 'running',
    })).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_NOT_FOUND' })
    await expect(ctx.teams.getActivation({
      teamId: current.team.id,
      activationId: activationIdSchema.parse('missing-activation'),
    })).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_NOT_FOUND' })
    await updateTestActivationStatus(ctx, {
      teamId: current.team.id,
      activationId: accepted.activation.id,
      expectedCursor: current.team.cursor,
      status: 'offline',
    })
    current = await ctx.teams.getTeam({ teamId: current.team.id })
    const otherParticipant = await activeParticipant(ctx, current.team.id)
    current = await ctx.teams.getTeam({ teamId: current.team.id })
    await bindTestActivation(ctx, {
      expectedCursor: current.team.cursor,
      binding: {
        activation: {
          id: activationIdSchema.parse('activation-edge-other'),
          teamId: current.team.id,
          participantId: otherParticipant.id,
          status: 'idle',
        },
        sessionId: SessionId('other-participant-session'),
        provider: 'in-process',
      },
    })
    current = await ctx.teams.getTeam({ teamId: current.team.id })
    const resumed = await bindTestActivation(ctx, {
      expectedCursor: current.team.cursor,
      binding: {
        ...binding,
        activation: { ...binding.activation, id: activationIdSchema.parse('activation-edge-resumed') },
      },
    })
    current = await ctx.teams.getTeam({ teamId: current.team.id })
    await expect(bindTestActivation(ctx, {
      expectedCursor: current.team.cursor,
      binding: {
        ...binding,
        activation: { ...binding.activation, id: activationIdSchema.parse('activation-edge-other-session') },
        sessionId: SessionId('another-session'),
      },
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.teams.getActivation({
      teamId: current.team.id,
      activationId: accepted.activation.id,
    })).resolves.toMatchObject({ activation: { status: 'offline' } })
    await expect(ctx.teams.getActivation({
      teamId: current.team.id,
      activationId: resumed.activation.id,
    })).resolves.toMatchObject({ activation: { status: 'idle' } })
    expect(accepted.activation.id).toBe(binding.activation.id)

    const inactive = await createTestRootTeam(ctx, { goal: { objective: 'Inactive activation binding', budgets: {} }, rules: {}, budgets: {} })
    const inactiveParticipant = await activeParticipant(ctx, inactive.team.id)
    const quiescing = await seedTeamPhase(ctx, inactive.team.id, 'quiescing')
    await expect(bindTestActivation(ctx, {
      expectedCursor: quiescing.team.cursor,
      binding: {
        activation: {
          id: activationIdSchema.parse('inactive-activation'),
          teamId: inactive.team.id,
          participantId: inactiveParticipant.id,
          status: 'idle',
        },
        sessionId: SessionId('inactive-activation-session'),
        provider: 'in-process',
      },
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  })

  it('binds active remote-agent epochs while rejecting human Participants', async () => {
    const { ctx } = await setup()
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Remote activation', budgets: {} }, rules: {}, budgets: {} })
    const remote = await inviteBootstrapParticipant(ctx, {
      teamId: team.team.id,
      expectedCursor: team.team.cursor,
      kind: 'remote-agent',
      displayName: 'Remote worker',
      role: 'worker',
      capabilities: [],
    })
    let current = await ctx.teams.getTeam({ teamId: team.team.id })
    await transitionBootstrapParticipant(ctx, {
      teamId: current.team.id,
      participantId: remote.id,
      expectedCursor: current.team.cursor,
      phase: 'provisioning',
    })
    current = await ctx.teams.getTeam({ teamId: team.team.id })
    await transitionBootstrapParticipant(ctx, {
      teamId: current.team.id,
      participantId: remote.id,
      expectedCursor: current.team.cursor,
      phase: 'active',
    })
    current = await ctx.teams.getTeam({ teamId: team.team.id })
    await expect(bindTestActivation(ctx, {
      expectedCursor: current.team.cursor,
      binding: {
        activation: {
          id: activationIdSchema.parse('remote-activation'),
          teamId: current.team.id,
          participantId: remote.id,
          status: 'idle',
        },
        sessionId: SessionId('remote-session'),
        provider: 'sdk',
      },
    })).resolves.toMatchObject({ activation: { participantId: remote.id, status: 'idle' } })

    current = await ctx.teams.getTeam({ teamId: team.team.id })
    const human = await inviteBootstrapParticipant(ctx, {
      teamId: current.team.id,
      expectedCursor: current.team.cursor,
      kind: 'human',
      displayName: 'Reviewer',
      role: 'reviewer',
      capabilities: [],
    })
    current = await ctx.teams.getTeam({ teamId: team.team.id })
    await transitionBootstrapParticipant(ctx, {
      teamId: current.team.id,
      participantId: human.id,
      expectedCursor: current.team.cursor,
      phase: 'provisioning',
    })
    current = await ctx.teams.getTeam({ teamId: team.team.id })
    await transitionBootstrapParticipant(ctx, {
      teamId: current.team.id,
      participantId: human.id,
      expectedCursor: current.team.cursor,
      phase: 'active',
    })
    current = await ctx.teams.getTeam({ teamId: team.team.id })
    await expect(bindTestActivation(ctx, {
      expectedCursor: current.team.cursor,
      binding: {
        activation: {
          id: activationIdSchema.parse('human-activation'),
          teamId: current.team.id,
          participantId: human.id,
          status: 'idle',
        },
        sessionId: SessionId('human-session'),
        provider: 'sdk',
      },
    })).rejects.toMatchObject({ code: 'TEAM_PARTICIPANT_NOT_FOUND' })
  })

  it('rejects missing member/task inputs, invalid text, duplicate scopes, and inactive channel participants', async () => {
    const { ctx } = await setup()
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Validation', budgets: {} }, rules: {}, budgets: {} })
    await provisionTestCoordinator(ctx, created.team.id)
    const initial = await ctx.teams.getTeam({ teamId: created.team.id })
    await expect(ctx.teams.transitionParticipantPhase({
      actor: {} as never,
      teamId: created.team.id,
      participantId: 'missing-participant' as never,
      expectedCursor: initial.team.cursor,
      phase: 'provisioning',
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(createTestCoordinatorTask(ctx, {
      teamId: created.team.id,
      expectedCursor: initial.team.cursor,
      subject: ' ',
      description: 'detail',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(createTestCoordinatorTask(ctx, {
      teamId: created.team.id,
      expectedCursor: initial.team.cursor,
      subject: 'Capabilities',
      description: 'Normalizes duplicate capabilities.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
      requiredCapabilities: ['lint', ' lint '],
    })).rejects.toMatchObject({ code: 'TEAM_TASK_GRAPH_INVALID' })
    await expect(createTestCoordinatorTask(ctx, {
      teamId: created.team.id,
      expectedCursor: initial.team.cursor,
      subject: 'Read scopes',
      description: 'Normalizes duplicate read scopes.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
      readScopes: ['src', './src'],
    })).rejects.toMatchObject({ code: 'TEAM_TASK_GRAPH_INVALID' })
    await expect(createTestCoordinatorTask(ctx, {
      teamId: created.team.id,
      expectedCursor: initial.team.cursor,
      subject: 'Scopes',
      description: 'detail',
      blockedBy: [],
      writeScopes: ['src', './src'],
      ...taskDefaults,
    })).rejects.toMatchObject({ code: 'TEAM_TASK_GRAPH_INVALID' })
    await expect(createTestCoordinatorTask(ctx, {
      teamId: created.team.id,
      expectedCursor: initial.team.cursor,
      subject: 'Absolute scope',
      description: 'Rejects non-workspace-relative write scopes.',
      blockedBy: [],
      writeScopes: ['/outside'],
      ...taskDefaults,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const idle = await inviteBootstrapParticipant(ctx, {
      teamId: created.team.id,
      expectedCursor: initial.team.cursor,
      kind: 'local-agent',
      displayName: 'Idle worker',
      role: 'worker',
      capabilities: [],
    })
    const current = await ctx.teams.getTeam({ teamId: created.team.id })
    await expect(openTestChannel(ctx, {
      teamId: created.team.id,
      expectedCursor: current.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: idle.id, role: 'worker' }],
      limits: {},
    })).rejects.toMatchObject({ code: 'TEAM_PARTICIPANT_NOT_FOUND' })
    await expect(ctx.teams.getTask({ teamId: created.team.id, taskId: 'missing-task' as never }))
      .rejects.toMatchObject({ code: 'TEAM_TASK_NOT_FOUND' })
    await expect(updateTestCoordinatorTask(ctx, {
      teamId: created.team.id,
      taskId: 'missing-task' as never,
      expectedRevision: 1,
      subject: 'Missing',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_NOT_FOUND' })
  })

  it('lists task projections and applies named policy denials before a durable mutation', async () => {
    const { ctx } = await setup()
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Policies', budgets: {} }, rules: {}, budgets: {} })
    await provisionTestCoordinator(ctx, created.team.id)
    const state = await ctx.teams.getTeam({ teamId: created.team.id })
    const task = await createTestCoordinatorTask(ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      subject: 'Listed task',
      description: 'Visible through both task reads.',
      blockedBy: [],
      ...taskDefaults,
      readScopes: ['.'],
      writeScopes: ['.'],
    })
    expect(task.readScopes).toEqual(['.'])
    expect(task.writeScopes).toEqual(['.'])
    await expect(ctx.teams.getTask({ teamId: created.team.id, taskId: task.id }))
      .resolves.toEqual(expect.objectContaining({ id: task.id }))
    await expect(ctx.teams.listTasksPage({ teamId: created.team.id, afterCursor: -1, limit: 128 }))
      .resolves.toMatchObject({ items: [expect.objectContaining({ id: task.id })] })
    const deny: TeamPolicy = {
      name: 'deny-invites',
      async apply() { return { kind: 'deny', code: 'test-denied', message: 'invites are disabled' } },
    }
    const unregister = ctx.teams.registerPolicy('invite', deny)
    const current = await ctx.teams.getTeam({ teamId: created.team.id })
    await expect(inviteBootstrapParticipant(ctx, {
      teamId: created.team.id,
      expectedCursor: current.team.cursor,
      kind: 'service',
      displayName: 'Denied',
      role: 'none',
      capabilities: [],
    })).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    unregister()
  })

  it('serializes assignment and fences owner attempt writes, settlement, and retries', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const { ctx } = await setup()
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Lease fences', budgets: {} }, rules: {}, budgets: {} })
    await provisionTestCoordinator(ctx, team.team.id)
    const owner = await activeParticipant(ctx, team.team.id)
    const other = await activeParticipant(ctx, team.team.id)
    const ownerActivation = await taskActivation(ctx, team.team.id, owner.id, 'fence-owner')
    const otherActivation = await taskActivation(ctx, team.team.id, other.id, 'fence-other')
    const issuer = ctx.teams.openActivationActorProofIssuer()
    const ownerActor = issuer.issue(await ctx.teams.getActivation({ teamId: team.team.id, activationId: ownerActivation })).proof
    const otherActor = issuer.issue(await ctx.teams.getActivation({ teamId: team.team.id, activationId: otherActivation })).proof
    const state = await ctx.teams.getTeam({ teamId: team.team.id })
    const task = await createTestCoordinatorTask(ctx, {
      teamId: state.team.id,
      expectedCursor: state.team.cursor,
      subject: 'Lease one task',
      description: 'Exercise owner and revision fences.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
      maxAttempts: 1,
    })
    const assignments = await Promise.allSettled([
      assignTestTask(ctx, {
        teamId: task.teamId,
        taskId: task.id,
        expectedRevision: task.revision,
        participantId: owner.id,
        activationId: ownerActivation,
        leaseDurationMs: 100,
      }),
      assignTestTask(ctx, {
        teamId: task.teamId,
        taskId: task.id,
        expectedRevision: task.revision,
        participantId: other.id,
        activationId: otherActivation,
        leaseDurationMs: 100,
      }),
    ])
    const winner = assignments.find((result): result is PromiseFulfilledResult<typeof task> => result.status === 'fulfilled')
    if (winner === undefined) throw new Error('one assignment must win the task revision race')
    expect(assignments.filter(result => result.status === 'rejected')).toHaveLength(1)
    const assigned = winner.value
    const lease = assigned.lease
    if (lease === undefined) throw new Error('assigned task must retain its lease')
    const attemptActor = lease.participantId === owner.id ? ownerActor : otherActor
    const otherAttemptActor = lease.participantId === owner.id ? otherActor : ownerActor
    await expect(assignTestTask(ctx, {
      teamId: assigned.teamId,
      taskId: assigned.id,
      expectedRevision: assigned.revision,
      participantId: lease.participantId,
      activationId: lease.activationId,
      leaseDurationMs: 100,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.teams.startTaskAttempt({
      actor: attemptActor,
      taskId: assigned.id,
      expectedRevision: assigned.revision,
      attemptId: 'wrong-attempt' as typeof lease.attemptId,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.teams.startTaskAttempt({
      actor: otherAttemptActor,
      taskId: assigned.id,
      expectedRevision: assigned.revision,
      attemptId: lease.attemptId,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const started = await ctx.teams.startTaskAttempt({
      actor: attemptActor,
      taskId: assigned.id,
      expectedRevision: assigned.revision,
      attemptId: lease.attemptId,
    })
    await expect(ctx.teams.startTaskAttempt({
      actor: attemptActor,
      taskId: started.id,
      expectedRevision: started.revision,
      attemptId: lease.attemptId,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(updateTestCoordinatorTask(ctx, {
      teamId: started.teamId,
      taskId: started.id,
      expectedRevision: started.revision,
      subject: 'Rejected while leased',
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(deleteTestCoordinatorTask(ctx, {
      teamId: started.teamId,
      taskId: started.id,
      expectedRevision: started.revision,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const settlement = {
      actor: attemptActor,
      taskId: started.id,
      expectedRevision: started.revision,
      attemptId: lease.attemptId,
      outcome: { kind: 'released' },
    } as const
    const released = await ctx.teams.settleTaskAttempt(settlement)
    expect(released).toMatchObject({
      phase: 'failed',
      attemptCount: 1,
      attemptHistory: [{ id: lease.attemptId, outcome: { kind: 'released' } }],
    })
    expect(released.lease).toBeUndefined()
    const afterSettlement = await ctx.teams.getTeam({ teamId: released.teamId })
    await expect(ctx.teams.settleTaskAttempt(settlement)).resolves.toEqual(released)
    await expect(ctx.teams.settleTaskAttempt({
      ...settlement,
      outcome: { kind: 'failed', failure: { code: 'OTHER', message: 'different terminal report' } },
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.teams.settleTaskAttempt({
      ...settlement,
      actor: otherAttemptActor,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.teams.getTeam({ teamId: released.teamId })).resolves.toMatchObject({
      team: { cursor: afterSettlement.team.cursor },
      tasks: [{ id: released.id, revision: released.revision, attemptHistory: [{ id: lease.attemptId, outcome: { kind: 'released' } }] }],
    })
    await expect(ctx.teams.heartbeatTaskAttempt({
      actor: attemptActor,
      taskId: released.id,
      expectedRevision: released.revision,
      attemptId: lease.attemptId,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(assignTestTask(ctx, {
      teamId: released.teamId,
      taskId: released.id,
      expectedRevision: released.revision,
      participantId: lease.participantId,
      activationId: lease.activationId,
      leaseDurationMs: 100,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  })

  it('derives heartbeat and settlement authority and policy facts from a current actor proof', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_050_000)
    const { ctx } = await setup()
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Proof-owned lease work', budgets: {} }, rules: {}, budgets: {} })
    await provisionTestCoordinator(ctx, team.team.id)
    const owner = await activeParticipant(ctx, team.team.id)
    const other = await activeParticipant(ctx, team.team.id)
    const ownerActivation = await taskActivation(ctx, team.team.id, owner.id, 'proof-owner')
    const otherActivation = await taskActivation(ctx, team.team.id, other.id, 'proof-other')
    const ownerBinding = await ctx.teams.getActivation({ teamId: team.team.id, activationId: ownerActivation })
    const otherBinding = await ctx.teams.getActivation({ teamId: team.team.id, activationId: otherActivation })
    const issuer = ctx.teams.openActivationActorProofIssuer()
    const ownerProof = issuer.issue(ownerBinding).proof
    const otherProof = issuer.issue(otherBinding).proof
    const revokedProof = issuer.issue(ownerBinding)
    revokedProof.revoke()
    const state = await ctx.teams.getTeam({ teamId: team.team.id })
    const task = await createTestCoordinatorTask(ctx, {
      teamId: state.team.id,
      expectedCursor: state.team.cursor,
      subject: 'Proof-owned attempt',
      description: 'The Hub resolves its owner only from the Link-held proof.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
      maxAttempts: 1,
    })
    const assigned = await assignTestTask(ctx, {
      teamId: task.teamId,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: owner.id,
      activationId: ownerActivation,
      leaseDurationMs: 5_000,
    })
    const lease = assigned.lease
    if (lease === undefined) throw new Error('proof-owned task must retain a lease')
    const started = await ctx.teams.startTaskAttempt({
      actor: ownerProof,
      taskId: assigned.id,
      expectedRevision: assigned.revision,
      attemptId: lease.attemptId,
    })
    const policies: TeamPolicyRequest[] = []
    const unregister = ctx.teams.registerPolicy('task-mutate', {
      name: 'observe-proof-owned-attempts',
      async apply(request, next) {
        policies.push(request)
        return await next()
      },
    })
    const heartbeat = {
      taskId: started.id,
      expectedRevision: started.revision,
      attemptId: lease.attemptId,
    }
    await expect(ctx.teams.heartbeatTaskAttempt({ ...heartbeat, actor: {} as TeamActorProof }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(ctx.teams.heartbeatTaskAttempt({ ...heartbeat, actor: revokedProof.proof }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(ctx.teams.heartbeatTaskAttempt({ ...heartbeat, actor: otherProof }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(policies).toEqual([])

    const renewed = await ctx.teams.heartbeatTaskAttempt({ ...heartbeat, actor: ownerProof })
    expect(policies).toHaveLength(1)
    expect(policies[0]).toMatchObject({
      hook: 'task-mutate',
      teamId: team.team.id,
      actorId: owner.id,
      facts: {
        taskId: task.id,
        expectedRevision: started.revision,
        attemptId: lease.attemptId,
        participantId: owner.id,
        activationId: ownerActivation,
        sessionId: ownerBinding.sessionId,
        provider: ownerBinding.provider,
      },
    })

    const settlement = {
      actor: ownerProof,
      taskId: renewed.id,
      expectedRevision: renewed.revision,
      attemptId: lease.attemptId,
      outcome: { kind: 'released' as const },
    }
    await expect(ctx.teams.settleTaskAttempt({ ...settlement, actor: {} as TeamActorProof }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(ctx.teams.settleTaskAttempt({ ...settlement, actor: revokedProof.proof }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(ctx.teams.settleTaskAttempt({ ...settlement, actor: otherProof }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const settled = await ctx.teams.settleTaskAttempt(settlement)
    expect(policies).toHaveLength(2)
    expect(policies[1]).toMatchObject({
      hook: 'task-mutate',
      teamId: team.team.id,
      actorId: owner.id,
      facts: {
        taskId: task.id,
        expectedRevision: renewed.revision,
        attemptId: lease.attemptId,
        participantId: owner.id,
        activationId: ownerActivation,
        sessionId: ownerBinding.sessionId,
        provider: ownerBinding.provider,
        outcome: { kind: 'released' },
        nextPhase: 'failed',
      },
    })

    let current = await ctx.teams.getTeam({ teamId: team.team.id })
    await updateTestActivationStatus(ctx, {
      teamId: current.team.id,
      activationId: ownerActivation,
      expectedCursor: current.team.cursor,
      status: 'offline',
    })
    current = await ctx.teams.getTeam({ teamId: team.team.id })
    await bindTestActivation(ctx, {
      expectedCursor: current.team.cursor,
      binding: {
        activation: {
          id: activationIdSchema.parse('task-proof-owner-replacement'),
          teamId: team.team.id,
          participantId: owner.id,
          status: 'idle',
        },
        sessionId: ownerBinding.sessionId,
        provider: ownerBinding.provider,
      },
    })
    await expect(ctx.teams.heartbeatTaskAttempt({
      actor: ownerProof,
      taskId: settled.id,
      expectedRevision: settled.revision,
      attemptId: lease.attemptId,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(ctx.teams.settleTaskAttempt({
      ...settlement,
      expectedRevision: settled.revision,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(policies).toHaveLength(2)
    unregister()
  })

  it('binds an idempotent task-start claim to its proof-derived owner and durable assignment Envelope', async () => {
    const { ctx } = await setup()
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Claim task delivery', budgets: {} }, rules: {}, budgets: {} })
    await provisionTestCoordinator(ctx, team.team.id)
    const owner = await activeParticipant(ctx, team.team.id)
    const sender = await activeParticipant(ctx, team.team.id)
    const foreign = await activeParticipant(ctx, team.team.id)
    const activationId = await taskActivation(ctx, team.team.id, owner.id, 'claim-owner')
    await taskActivation(ctx, team.team.id, sender.id, 'claim-sender')
    const foreignChannelActivation = await taskActivation(ctx, team.team.id, foreign.id, 'claim-foreign-channel')
    const beforeChannel = await ctx.teams.getTeam({ teamId: team.team.id })
    let channel = await openTestChannel(ctx, {
      teamId: beforeChannel.team.id,
      expectedCursor: beforeChannel.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [
        { id: owner.id, role: 'worker' },
        { id: sender.id, role: 'scheduler' },
        { id: foreign.id, role: 'worker' },
      ],
      limits: {},
    })
    channel = await acknowledgeTestChannelActivations(ctx, channel.manifest.id)
    const beforeOtherChannel = await ctx.teams.getTeam({ teamId: team.team.id })
    let otherChannel = await openTestChannel(ctx, {
      teamId: beforeOtherChannel.team.id,
      expectedCursor: beforeOtherChannel.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [
        { id: owner.id, role: 'worker' },
        { id: sender.id, role: 'scheduler' },
      ],
      limits: {},
    })
    otherChannel = await acknowledgeTestChannelActivations(ctx, otherChannel.manifest.id)
    const beforeTask = await ctx.teams.getTeam({ teamId: team.team.id })
    const task = await createTestCoordinatorTask(ctx, {
      teamId: beforeTask.team.id,
      expectedCursor: beforeTask.team.cursor,
      subject: 'Claimed task',
      description: 'Start only from its durable assignment delivery.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
    })
    const assigned = await assignTestTask(ctx, {
      teamId: task.teamId,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: owner.id,
      activationId,
      wakeChannelId: channel.manifest.id,
      leaseDurationMs: 5_000,
    })
    const lease = assigned.lease
    if (lease === undefined) throw new Error('assigned task must retain a lease')
    expect(lease).toMatchObject({
      assignedRevision: assigned.revision,
      wakeChannelId: channel.manifest.id,
    })
    const rejectedEnvelope = await ctx.teams.postChannelEnvelope({
      actor: await postActor(ctx, team.team.id, sender.id),
      expectedCursor: channel.cursor,
      draft: {
        channelId: channel.manifest.id,
        audience: null,
        kind: 'task-assignment',
        payload: {},
        delivery: 'turn',
      },
    })
    const binding = await ctx.teams.getActivation({ teamId: team.team.id, activationId })
    const issuer = ctx.teams.openActivationActorProofIssuer()
    const actorLease = issuer.issue(binding)
    const claimInput = {
      taskId: assigned.id,
      attemptId: lease.attemptId,
      assignedRevision: lease.assignedRevision,
      channelId: channel.manifest.id,
      envelopeId: rejectedEnvelope.id,
    }
    const claim = { actor: actorLease.proof, ...claimInput }
    await expect(ctx.teams.claimTaskAttemptStart({
      ...claim,
      attemptId: 'wrong-claim-attempt' as typeof lease.attemptId,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.teams.claimTaskAttemptStart({ ...claim, assignedRevision: claim.assignedRevision + 1 }))
      .rejects.toMatchObject({ code: 'TEAM_TASK_STALE_REVISION' })
    const injectedIdentity = { ...claim, teamId: assigned.teamId, participantId: sender.id, sessionId: binding.sessionId }
    await expect(ctx.teams.claimTaskAttemptStart(injectedIdentity))
      .rejects.toMatchObject({ name: 'ZodError' })
    await expect(ctx.teams.claimTaskAttemptStart({ ...claimInput, actor: {} as TeamActorProof }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const revokedLease = issuer.issue(binding)
    revokedLease.revoke()
    await expect(ctx.teams.claimTaskAttemptStart({ ...claimInput, actor: revokedLease.proof }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const foreignActivationId = foreignChannelActivation
    const foreignBinding = await ctx.teams.getActivation({ teamId: team.team.id, activationId: foreignActivationId })
    const foreignLease = issuer.issue(foreignBinding)
    await expect(ctx.teams.claimTaskAttemptStart({ ...claimInput, actor: foreignLease.proof }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.teams.claimTaskAttemptStart({ ...claim, envelopeId: 'missing-claim-envelope' as typeof rejectedEnvelope.id }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.teams.claimTaskAttemptStart({ ...claim, channelId: otherChannel.manifest.id }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.teams.claimTaskAttemptStart(claim)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.teams.claimTaskAttemptStart({ ...claim, sessionId: SessionId('wrong-claim-session') } as never))
      .rejects.toMatchObject({ name: 'ZodError' })
    const wrongAudienceEnvelope = await ctx.teams.postChannelEnvelope({
      actor: await postActor(ctx, team.team.id, owner.id),
      expectedCursor: rejectedEnvelope.sequence,
      draft: {
        channelId: channel.manifest.id,
        audience: [sender.id],
        kind: 'task-assignment',
        payload: {},
        delivery: 'turn',
        taskId: task.id,
      },
    })
    await expect(ctx.teams.claimTaskAttemptStart({ ...claim, envelopeId: wrongAudienceEnvelope.id }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const acceptedEnvelope = await ctx.teams.postChannelEnvelope({
      actor: await postActor(ctx, team.team.id, sender.id),
      expectedCursor: wrongAudienceEnvelope.sequence,
      draft: {
        channelId: channel.manifest.id,
        audience: null,
        kind: 'task-assignment',
        payload: {},
        delivery: 'turn',
        taskId: task.id,
      },
    })
    const policyRequests: TeamPolicyRequest[] = []
    const unregister = ctx.teams.registerPolicy('task-mutate', {
      name: 'observe-proof-derived-task-start',
      async apply(request, next) {
        policyRequests.push(request)
        return await next()
      },
    })
    const started = await ctx.teams.claimTaskAttemptStart({ ...claim, envelopeId: acceptedEnvelope.id })
    expect(started).toMatchObject({ phase: 'running', revision: assigned.revision + 1 })
    expect(policyRequests).toHaveLength(1)
    expect(policyRequests[0]).toMatchObject({
      hook: 'task-mutate',
      teamId: team.team.id,
      actorId: owner.id,
      facts: {
        taskId: task.id,
        attemptId: lease.attemptId,
        assignedRevision: lease.assignedRevision,
        participantId: owner.id,
        activationId,
        sessionId: binding.sessionId,
        channelId: channel.manifest.id,
        envelopeId: acceptedEnvelope.id,
      },
    })
    unregister()
    const afterStart = await ctx.teams.getTeam({ teamId: team.team.id })
    await expect(ctx.teams.claimTaskAttemptStart({ ...claim, envelopeId: acceptedEnvelope.id }))
      .resolves.toEqual(started)
    await expect(ctx.teams.getTeam({ teamId: team.team.id })).resolves.toMatchObject({
      team: { cursor: afterStart.team.cursor },
      tasks: [expect.objectContaining({ id: task.id, revision: started.revision })],
    })
    const beforeClosedWake = await ctx.teams.getTeam({ teamId: team.team.id })
    const rejectedWakeTask = await createTestCoordinatorTask(ctx, {
      teamId: beforeClosedWake.team.id,
      expectedCursor: beforeClosedWake.team.cursor,
      subject: 'Closed wake channel',
      description: 'A closed channel cannot receive a task assignment wake-up.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
    })
    await closeTestChannel(ctx, { channelId: otherChannel.manifest.id, expectedCursor: otherChannel.cursor })
    await expect(assignTestTask(ctx, {
      teamId: rejectedWakeTask.teamId,
      taskId: rejectedWakeTask.id,
      expectedRevision: rejectedWakeTask.revision,
      participantId: owner.id,
      activationId,
      wakeChannelId: otherChannel.manifest.id,
      leaseDurationMs: 100,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const beforeReplacement = await ctx.teams.getTeam({ teamId: team.team.id })
    await updateTestActivationStatus(ctx, {
      teamId: beforeReplacement.team.id,
      activationId,
      expectedCursor: beforeReplacement.team.cursor,
      status: 'offline',
    })
    const beforeBindReplacement = await ctx.teams.getTeam({ teamId: team.team.id })
    await bindTestActivation(ctx, {
      expectedCursor: beforeBindReplacement.team.cursor,
      binding: {
        activation: {
          id: activationIdSchema.parse('claim-owner-replacement'),
          teamId: team.team.id,
          participantId: owner.id,
          status: 'idle',
        },
        sessionId: binding.sessionId,
        provider: 'in-process',
      },
    })
    await expect(ctx.teams.claimTaskAttemptStart({
      ...claim,
      envelopeId: acceptedEnvelope.id,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await closeTestChannel(ctx, { channelId: channel.manifest.id, expectedCursor: acceptedEnvelope.sequence })
    await expect(ctx.teams.claimTaskAttemptStart({ ...claim, envelopeId: acceptedEnvelope.id }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await seedTeamPhase(ctx, team.team.id, 'quiescing')
    await expect(ctx.teams.claimTaskAttemptStart({ ...claim, envelopeId: acceptedEnvelope.id }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  })

  it('enforces assignment readiness and records each permitted terminal attempt outcome', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_100_000)
    const { ctx } = await setup()
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Attempt outcomes', budgets: {} }, rules: {}, budgets: {} })
    const owner = await activeParticipant(ctx, team.team.id)
    const ownerActivation = await taskActivation(ctx, team.team.id, owner.id, 'outcome-owner')
    const ownerActor = await taskActor(ctx, team.team.id, ownerActivation)
    const coordinator = await activeParticipant(ctx, team.team.id, {
      kind: 'local-agent', role: 'coordinator', displayName: 'Coordinator',
    })
    const coordinatorActivation = await taskActivation(ctx, team.team.id, coordinator.id, 'outcome-coordinator')
    const coordinatorActor = await taskActor(ctx, team.team.id, coordinatorActivation)
    const coordinatorBinding = await ctx.teams.getActivation({ teamId: team.team.id, activationId: coordinatorActivation })
    const controls = taskControlAuthority(ctx)
    const cancelScope = (task: { readonly id: string; readonly revision: number }): TeamSystemTaskControlScope => ({
      kind: 'team-run-default-worker-cancel',
      teamId: team.team.id,
      coordinator: {
        teamId: coordinatorBinding.activation.teamId,
        participantId: coordinatorBinding.activation.participantId,
        activationId: coordinatorBinding.activation.id,
        sessionId: coordinatorBinding.sessionId,
        provider: coordinatorBinding.provider,
      },
      taskId: task.id as never,
      expectedRevision: task.revision,
    })
    const createPending = async (
      subject: string,
      options: {
        readonly blockedBy?: readonly string[]
        readonly maxAttempts?: number
        readonly reviewPolicy?: { readonly kind: 'none' } | { readonly kind: 'participant'; readonly reviewerId: ParticipantId }
      } = {},
    ) => {
      const current = await ctx.teams.getTeam({ teamId: team.team.id })
      return await createTestCoordinatorTask(ctx, {
        teamId: current.team.id,
        expectedCursor: current.team.cursor,
        subject,
        description: `${subject} durable description.`,
        blockedBy: (options.blockedBy ?? []) as never,
        writeScopes: [],
        ...taskDefaults,
        ...options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts },
        ...options.reviewPolicy === undefined ? {} : { reviewPolicy: options.reviewPolicy },
      })
    }
    const blocker = await createPending('Block assignment')
    const blocked = await createPending('Blocked assignment', { blockedBy: [blocker.id] })
    await expect(assignTestTask(ctx, {
      teamId: blocked.teamId,
      taskId: blocked.id,
      expectedRevision: blocked.revision,
      participantId: owner.id,
      activationId: ownerActivation,
      leaseDurationMs: 20,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const failedTask = await createPending('Fail while assigned', { maxAttempts: 1 })
    const failedAssigned = await assignTestTask(ctx, {
      teamId: failedTask.teamId,
      taskId: failedTask.id,
      expectedRevision: failedTask.revision,
      participantId: owner.id,
      activationId: ownerActivation,
      leaseDurationMs: 20,
    })
    const failedLease = failedAssigned.lease
    if (failedLease === undefined) throw new Error('assignment must retain a lease')
    const failed = await ctx.teams.settleTaskAttempt({
      actor: ownerActor,
      taskId: failedAssigned.id,
      expectedRevision: failedAssigned.revision,
      attemptId: failedLease.attemptId,
      outcome: { kind: 'failed', failure: { code: 'worker-unavailable', message: 'Worker unavailable.' } },
    })
    expect(failed).toMatchObject({
      phase: 'failed',
      attemptHistory: [{ outcome: { kind: 'failed', failure: { code: 'worker-unavailable', message: 'Worker unavailable.' } } }],
    })

    const reviewer = await activeParticipant(ctx, team.team.id)
    const reviewerActivation = await taskActivation(ctx, team.team.id, reviewer.id, 'reviewer')
    const reviewerActor = await taskActor(ctx, team.team.id, reviewerActivation)
    await expect(createPending('Reject unavailable reviewer', {
      reviewPolicy: { kind: 'participant', reviewerId: participantIdSchema.parse('participant-missing-reviewer') },
    })).rejects.toMatchObject({ code: 'TEAM_PARTICIPANT_NOT_FOUND' })
    const reviewTask = await createPending('Complete into review', {
      reviewPolicy: { kind: 'participant', reviewerId: reviewer.id },
    })
    const reviewAssigned = await assignTestTask(ctx, {
      teamId: reviewTask.teamId,
      taskId: reviewTask.id,
      expectedRevision: reviewTask.revision,
      participantId: owner.id,
      activationId: ownerActivation,
      leaseDurationMs: 20,
    })
    const reviewLease = reviewAssigned.lease
    if (reviewLease === undefined) throw new Error('assignment must retain a lease')
    const reviewRunning = await ctx.teams.startTaskAttempt({
      actor: ownerActor,
      taskId: reviewAssigned.id,
      expectedRevision: reviewAssigned.revision,
      attemptId: reviewLease.attemptId,
    })
    const reviewing = await ctx.teams.settleTaskAttempt({
      actor: ownerActor,
      taskId: reviewRunning.id,
      expectedRevision: reviewRunning.revision,
      attemptId: reviewLease.attemptId,
      outcome: { kind: 'completed', result: { summary: 'Review-ready result.' } },
    })
    expect(reviewing).toMatchObject({
      phase: 'review',
      attemptHistory: [{ outcome: { kind: 'completed', result: { summary: 'Review-ready result.' } } }],
    })
    await expect(deleteTestCoordinatorTask(ctx, {
      teamId: reviewing.teamId,
      taskId: reviewing.id,
      expectedRevision: reviewing.revision,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.teams.resolveTaskReview({
      actor: ownerActor,
      taskId: reviewing.id,
      expectedRevision: reviewing.revision,
      nextPhase: 'completed',
      reason: 'Worker cannot approve its own result.',
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.teams.resolveTaskReview({
      actor: reviewerActor,
      taskId: reviewing.id,
      expectedRevision: reviewing.revision,
      nextPhase: 'completed',
      reason: 'Reviewed and accepted.',
    })).resolves.toMatchObject({
      phase: 'completed',
      reviewHistory: [{ reviewerId: reviewer.id, nextPhase: 'completed', reason: 'Reviewed and accepted.' }],
    })

    const directTask = await createPending('Complete without review')
    const directAssigned = await assignTestTask(ctx, {
      teamId: directTask.teamId,
      taskId: directTask.id,
      expectedRevision: directTask.revision,
      participantId: owner.id,
      activationId: ownerActivation,
      leaseDurationMs: 20,
    })
    const directLease = directAssigned.lease
    if (directLease === undefined) throw new Error('assignment must retain a lease')
    const directRunning = await ctx.teams.startTaskAttempt({
      actor: ownerActor,
      taskId: directAssigned.id,
      expectedRevision: directAssigned.revision,
      attemptId: directLease.attemptId,
    })
    await expect(ctx.teams.settleTaskAttempt({
      actor: ownerActor,
      taskId: directRunning.id,
      expectedRevision: directRunning.revision,
      attemptId: directLease.attemptId,
      outcome: { kind: 'completed', result: { summary: 'No reviewer required.' } },
    })).resolves.toMatchObject({ phase: 'completed', reviewHistory: [] })

    const departedReviewer = await activeParticipant(ctx, team.team.id, { kind: 'human' })
    const departedReviewTask = await createPending('Reject departed reviewer', {
      reviewPolicy: { kind: 'participant', reviewerId: departedReviewer.id },
    })
    const departedAssigned = await assignTestTask(ctx, {
      teamId: departedReviewTask.teamId,
      taskId: departedReviewTask.id,
      expectedRevision: departedReviewTask.revision,
      participantId: owner.id,
      activationId: ownerActivation,
      leaseDurationMs: 20,
    })
    const departedLease = departedAssigned.lease
    if (departedLease === undefined) throw new Error('assignment must retain a lease')
    const departedRunning = await ctx.teams.startTaskAttempt({
      actor: ownerActor,
      taskId: departedAssigned.id,
      expectedRevision: departedAssigned.revision,
      attemptId: departedLease.attemptId,
    })
    await seedParticipantPhase(ctx, team.team.id, departedReviewer.id, 'left')
    await expect(ctx.teams.settleTaskAttempt({
      actor: ownerActor,
      taskId: departedRunning.id,
      expectedRevision: departedRunning.revision,
      attemptId: departedLease.attemptId,
      outcome: { kind: 'completed', result: { summary: 'Reviewer departed.' } },
    })).rejects.toMatchObject({ code: 'TEAM_PARTICIPANT_NOT_FOUND' })

    const reworkTask = await createPending('Review into rework', {
      reviewPolicy: { kind: 'participant', reviewerId: reviewer.id },
    })
    const reworkAssigned = await assignTestTask(ctx, {
      teamId: reworkTask.teamId,
      taskId: reworkTask.id,
      expectedRevision: reworkTask.revision,
      participantId: owner.id,
      activationId: ownerActivation,
      leaseDurationMs: 20,
    })
    const reworkLease = reworkAssigned.lease
    if (reworkLease === undefined) throw new Error('assignment must retain a lease')
    const reworkRunning = await ctx.teams.startTaskAttempt({
      actor: ownerActor,
      taskId: reworkTask.id,
      expectedRevision: reworkAssigned.revision,
      attemptId: reworkLease.attemptId,
    })
    const reworking = await ctx.teams.settleTaskAttempt({
      actor: ownerActor,
      taskId: reworkRunning.id,
      expectedRevision: reworkRunning.revision,
      attemptId: reworkLease.attemptId,
      outcome: { kind: 'completed', result: { summary: 'Needs review.' } },
    })
    const reworked = await ctx.teams.resolveTaskReview({
      actor: reviewerActor,
      taskId: reworking.id,
      expectedRevision: reworking.revision,
      nextPhase: 'pending',
      reason: 'Please address the missing validation.',
    })
    expect(reworked).toMatchObject({
      phase: 'pending',
      reviewHistory: [{ reviewerId: reviewer.id, nextPhase: 'pending', reason: 'Please address the missing validation.' }],
    })
    await expect(assignTestTask(ctx, {
      teamId: reworked.teamId,
      taskId: reworked.id,
      expectedRevision: reworked.revision,
      participantId: owner.id,
      activationId: ownerActivation,
      leaseDurationMs: 20,
    })).resolves.toMatchObject({ phase: 'assigned', attemptCount: 2 })

    const beforeCancellable = await ctx.teams.getTeam({ teamId: team.team.id })
    const cancellable = await ctx.teams.createTask({
      actor: coordinatorActor,
      teamId: team.team.id,
      expectedCursor: beforeCancellable.team.cursor,
      createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('edge-default-worker-cancel') },
      subject: 'Cancel without a lease',
      description: 'Cancel this coordinator-owned default-worker task.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
    })
    const pendingCancel = controls.issue(cancelScope(cancellable))
    const cancelledPending = await ctx.teams.cancelTask({
      actor: pendingCancel.proof,
      teamId: cancellable.teamId,
      taskId: cancellable.id,
      expectedRevision: cancellable.revision,
    })
    pendingCancel.revoke()
    expect(cancelledPending.phase).toBe('cancelled')
    const terminalCancel = controls.issue(cancelScope(cancelledPending))
    await expect(ctx.teams.cancelTask({
      actor: terminalCancel.proof,
      teamId: cancelledPending.teamId,
      taskId: cancelledPending.id,
      expectedRevision: cancelledPending.revision,
    })).resolves.toEqual(cancelledPending)
    terminalCancel.revoke()
    controls.dispose()

    const unresolved = await createPending('Reject non-review resolution')
    await expect(ctx.teams.resolveTaskReview({
      actor: ownerActor,
      taskId: unresolved.id,
      expectedRevision: unresolved.revision,
      nextPhase: 'pending',
      reason: 'A pending task is not ready for review.',
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const hub = ctx.teams as unknown as { teams: Map<string, { projection: TeamProjection }> }
    const loaded = hub.teams.get(team.team.id)
    if (loaded === undefined) throw new Error('Team Hub did not retain the unresolved review task')
    const originalProjection = loaded.projection
    const impossibleReview = loaded.projection.tasks.get(unresolved.id)
    if (impossibleReview === undefined) throw new Error('unresolved task was not retained')
    loaded.projection = {
      ...loaded.projection,
      tasks: new Map([...loaded.projection.tasks, [unresolved.id, {
        ...impossibleReview,
        phase: 'review',
        reviewPolicy: { kind: 'participant', reviewerId: owner.id },
      }]]),
    }
    await expect(ctx.teams.resolveTaskReview({
      actor: ownerActor,
      taskId: unresolved.id,
      expectedRevision: unresolved.revision,
      nextPhase: 'pending',
      reason: 'No completed attempt exists.',
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    loaded.projection = originalProjection

    const cancelledTask = await createPending('Cancel while assigned')
    const cancelledAssigned = await assignTestTask(ctx, {
      teamId: cancelledTask.teamId,
      taskId: cancelledTask.id,
      expectedRevision: cancelledTask.revision,
      participantId: owner.id,
      activationId: ownerActivation,
      leaseDurationMs: 20,
    })
    const cancelledLease = cancelledAssigned.lease
    if (cancelledLease === undefined) throw new Error('assignment must retain a lease')
    const cancelled = await ctx.teams.settleTaskAttempt({
      actor: ownerActor,
      taskId: cancelledAssigned.id,
      expectedRevision: cancelledAssigned.revision,
      attemptId: cancelledLease.attemptId,
      outcome: { kind: 'cancelled' },
    })
    expect(cancelled).toMatchObject({ phase: 'cancelled', attemptHistory: [{ outcome: { kind: 'cancelled' } }] })

    const expiringTask = await createPending('Reject premature expiry')
    const expiringAssigned = await assignTestTask(ctx, {
      teamId: expiringTask.teamId,
      taskId: expiringTask.id,
      expectedRevision: expiringTask.revision,
      participantId: owner.id,
      activationId: ownerActivation,
      leaseDurationMs: 1_000,
    })
    const expiringLease = expiringAssigned.lease
    if (expiringLease === undefined) throw new Error('assignment must retain a lease')
    await expect(expireTestTask(ctx, {
      teamId: expiringAssigned.teamId,
      taskId: expiringAssigned.id,
      expectedRevision: expiringAssigned.revision,
      attemptId: expiringLease.attemptId,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    vi.advanceTimersByTime(1_001)
    await expect(ctx.teams.heartbeatTaskAttempt({
      actor: ownerActor,
      taskId: expiringAssigned.id,
      expectedRevision: expiringAssigned.revision,
      attemptId: expiringLease.attemptId,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expireTestTask(ctx, {
      teamId: expiringAssigned.teamId,
      taskId: expiringAssigned.id,
      expectedRevision: expiringAssigned.revision,
      attemptId: expiringLease.attemptId,
    })
  })

  it('recovers one closed scheduler review response without a live reviewer activation', async () => {
    const { ctx } = await setup()
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Recover one review.', budgets: {} }, rules: {}, budgets: {} })
    await provisionTestCoordinator(ctx, created.team.id)
    const initiator = await activeParticipant(ctx, created.team.id)
    const reviewer = await activeParticipant(ctx, created.team.id)
    const initiatorActivation = await taskActivation(ctx, created.team.id, initiator.id, 'review-recovery-initiator')
    const initiatorActor = await taskActor(ctx, created.team.id, initiatorActivation)
    let state = await ctx.teams.getTeam({ teamId: created.team.id })
    const task = await createTestCoordinatorTask(ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      subject: 'Review durable response recovery',
      description: 'Recover a review decision after the reviewer activation leaves.',
      blockedBy: [],
      requiredCapabilities: [],
      priority: 0,
      readScopes: [],
      writeScopes: [],
      workspaceMode: 'shared',
      budget: {},
      reviewPolicy: { kind: 'participant', reviewerId: reviewer.id },
      maxAttempts: 1,
    })
    const assigned = await assignTestTask(ctx, {
      teamId: task.teamId,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: initiator.id,
      activationId: initiatorActivation,
      leaseDurationMs: 1_000,
    })
    const lease = assigned.lease
    if (lease === undefined) throw new Error('review-recovery task must retain a lease')
    const running = await ctx.teams.startTaskAttempt({
      actor: initiatorActor,
      taskId: task.id,
      expectedRevision: assigned.revision,
      attemptId: lease.attemptId,
    })
    const reviewing = await ctx.teams.settleTaskAttempt({
      actor: initiatorActor,
      taskId: task.id,
      expectedRevision: running.revision,
      attemptId: lease.attemptId,
      outcome: { kind: 'completed', result: { summary: 'Ready for reviewer recovery.' } },
    })
    const reviewerActivation = await taskActivation(ctx, created.team.id, reviewer.id, 'review-recovery-reviewer')
    const reviewerBinding = await ctx.teams.getActivation({ teamId: created.team.id, activationId: reviewerActivation })
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    let channel = await openTestChannel(ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: 'consult', version: 1 },
      viewPolicy: { type: directedViewPolicy.type, version: directedViewPolicy.version },
      participants: [{ id: initiator.id, role: 'initiator' }, { id: reviewer.id, role: 'respondent' }],
      limits: {},
    })
    channel = await acknowledgeTestChannelActivations(ctx, channel.manifest.id)
    const authority = schedulerReviewAuthority(ctx)
    const request = await ctx.teams.postChannelEnvelope({
      actor: authority.post({
        kind: 'scheduler-review-request',
        teamId: created.team.id,
        channelId: channel.manifest.id,
        taskId: task.id,
        attemptId: lease.attemptId,
        reviewRevision: reviewing.revision,
        initiatorId: initiator.id,
        reviewerId: reviewer.id,
        reviewerActivationId: reviewerBinding.activation.id,
        reviewerSessionId: reviewerBinding.sessionId,
        reviewerProvider: reviewerBinding.provider,
      }),
      expectedCursor: channel.cursor,
      draft: {
        channelId: channel.manifest.id,
        audience: [reviewer.id],
        kind: 'review-request',
        payload: {
          text: 'Review the durable result.',
          taskId: task.id,
          attemptId: lease.attemptId,
          reviewRevision: reviewing.revision,
          reviewerId: reviewer.id,
          initiatorId: initiator.id,
          result: { summary: 'Ready for reviewer recovery.' },
        },
        delivery: 'turn',
        taskId: task.id,
      },
    })
    const reviewerActor = await taskActor(ctx, created.team.id, reviewerActivation)
    const responseChannel = await ctx.teams.getChannel({ channelId: channel.manifest.id })
    const response = await ctx.teams.postChannelEnvelope({
      actor: reviewerActor,
      expectedCursor: responseChannel.cursor,
      draft: {
        channelId: channel.manifest.id,
        audience: [initiator.id],
        kind: 'response',
        payload: { text: 'Accepted after a durable response.', decision: 'accepted' },
        delivery: 'turn',
        causationId: request.id,
        taskId: task.id,
      },
    })
    await expect(ctx.teams.getChannel({ channelId: channel.manifest.id })).resolves.toMatchObject({ phase: 'closed' })
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    await updateTestActivationStatus(ctx, {
      teamId: created.team.id,
      activationId: reviewerActivation,
      expectedCursor: state.team.cursor,
      status: 'offline',
    })
    const scope: TeamSystemTaskReviewScope = {
      kind: 'scheduler-review-response',
      teamId: created.team.id,
      taskId: task.id,
      expectedRevision: reviewing.revision,
      attemptId: lease.attemptId,
      reviewerId: reviewer.id,
      initiatorId: initiator.id,
      channelId: channel.manifest.id,
      requestEnvelopeId: request.id,
      responseEnvelopeId: response.id,
      nextPhase: 'completed',
      reason: 'Accepted after a durable response.',
    }
    await expect(ctx.teams.resolveTaskReviewFromResponse({ actor: {} as TeamSystemTaskReviewProof }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(ctx.teams.resolveTaskReviewFromResponse({ actor: authority.recover({
      ...scope,
      reason: 'A forged response reason.',
    }) })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const revokedAfterPolicy = authority.recover(scope)
    const beforePolicyRevocation = await ctx.teams.getTeam({ teamId: created.team.id })
    const unregister = ctx.teams.registerPolicy('task-mutate', {
      name: 'revoke-scheduler-review-recovery-after-policy',
      async apply(_request, next) {
        authority.revoke(revokedAfterPolicy)
        return await next()
      },
    })
    try {
      await expect(ctx.teams.resolveTaskReviewFromResponse({ actor: revokedAfterPolicy }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    } finally {
      unregister()
    }
    const afterPolicyRevocation = await ctx.teams.getTeam({ teamId: created.team.id })
    expect(afterPolicyRevocation.team.cursor).toBe(beforePolicyRevocation.team.cursor)
    expect(afterPolicyRevocation.tasks.find(candidate => candidate.id === task.id)).toMatchObject({ phase: 'review' })
    await expect(ctx.teams.resolveTaskReviewFromResponse({ actor: authority.recover(scope) })).resolves.toMatchObject({
      phase: 'completed',
      reviewHistory: [{ reviewerId: reviewer.id, nextPhase: 'completed', reason: 'Accepted after a durable response.' }],
    })
  })

  it('requires eligible capabilities and an exact live agent epoch for task attempts', async () => {
    const { ctx } = await setup()
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Task authorization', budgets: {} }, rules: {}, budgets: {} })
    await provisionTestCoordinator(ctx, team.team.id)
    const unqualified = await activeParticipant(ctx, team.team.id)
    const qualified = await activeParticipant(ctx, team.team.id, { capabilities: ['lint'] })
    const qualifiedActivation = await taskActivation(ctx, team.team.id, qualified.id, 'qualified')
    const qualifiedActor = await taskActor(ctx, team.team.id, qualifiedActivation)
    const createTask = async (subject: string) => {
      const current = await ctx.teams.getTeam({ teamId: team.team.id })
      return await createTestCoordinatorTask(ctx, {
        teamId: current.team.id,
        expectedCursor: current.team.cursor,
        subject,
        description: `${subject} requires lint capability.`,
        blockedBy: [],
        writeScopes: [],
        ...taskDefaults,
        requiredCapabilities: ['lint'],
      })
    }
    const capabilityTask = await createTask('Reject missing capability')
    await expect(assignTestTask(ctx, {
      teamId: capabilityTask.teamId,
      taskId: capabilityTask.id,
      expectedRevision: capabilityTask.revision,
      participantId: unqualified.id,
      leaseDurationMs: 100,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(assignTestTask(ctx, {
      teamId: capabilityTask.teamId,
      taskId: capabilityTask.id,
      expectedRevision: capabilityTask.revision,
      participantId: qualified.id,
      leaseDurationMs: 100,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(assignTestTask(ctx, {
      teamId: capabilityTask.teamId,
      taskId: capabilityTask.id,
      expectedRevision: capabilityTask.revision,
      participantId: qualified.id,
      activationId: activationIdSchema.parse('missing-task-activation'),
      leaseDurationMs: 100,
    })).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_NOT_FOUND' })
    const assigned = await assignTestTask(ctx, {
      teamId: capabilityTask.teamId,
      taskId: capabilityTask.id,
      expectedRevision: capabilityTask.revision,
      participantId: qualified.id,
      activationId: qualifiedActivation,
      leaseDurationMs: 100,
    })
    const lease = assigned.lease
    if (lease === undefined) throw new Error('qualified assignment must retain its lease')
    const current = await ctx.teams.getTeam({ teamId: team.team.id })
    await updateTestActivationStatus(ctx, {
      teamId: current.team.id,
      activationId: qualifiedActivation,
      expectedCursor: current.team.cursor,
      status: 'offline',
    })
    await expect(ctx.teams.startTaskAttempt({
      actor: qualifiedActor,
      taskId: assigned.id,
      expectedRevision: assigned.revision,
      attemptId: lease.attemptId,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const afterOffline = await ctx.teams.getTeam({ teamId: team.team.id })
    const replacement = await bindTestActivation(ctx, {
      expectedCursor: afterOffline.team.cursor,
      binding: {
        activation: {
          id: activationIdSchema.parse('qualified-replacement-activation'),
          teamId: afterOffline.team.id,
          participantId: qualified.id,
          status: 'idle',
        },
        sessionId: SessionId('task-qualified-session'),
        provider: 'in-process',
      },
    })
    const replacementActor = ctx.teams.openActivationActorProofIssuer().issue(replacement).proof
    await expect(ctx.teams.startTaskAttempt({
      actor: replacementActor,
      taskId: assigned.id,
      expectedRevision: assigned.revision,
      attemptId: lease.attemptId,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const human = await activeParticipant(ctx, team.team.id, { kind: 'human', capabilities: ['lint'] })
    const humanTask = await createTask('Reject human epoch')
    await expect(assignTestTask(ctx, {
      teamId: humanTask.teamId,
      taskId: humanTask.id,
      expectedRevision: humanTask.revision,
      participantId: human.id,
      activationId: qualifiedActivation,
      leaseDurationMs: 100,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(assignTestTask(ctx, {
      teamId: humanTask.teamId,
      taskId: humanTask.id,
      expectedRevision: humanTask.revision,
      participantId: human.id,
      leaseDurationMs: 100,
    })).resolves.toMatchObject({ lease: { participantId: human.id } })
  })

  it('keeps human attempts unclaimed until an authenticated product principal can issue a proof', async () => {
    const { ctx } = await setup()
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Human task ownership', budgets: {} }, rules: {}, budgets: {} })
    await provisionTestCoordinator(ctx, team.team.id)
    const human = await activeParticipant(ctx, team.team.id, { kind: 'human', capabilities: ['lint'] })
    const createTask = async (subject: string, overrides: Record<string, unknown> = {}) => {
      const current = await ctx.teams.getTeam({ teamId: team.team.id })
      return await createTestCoordinatorTask(ctx, {
        teamId: current.team.id,
        expectedCursor: current.team.cursor,
        subject,
        description: `${subject} durable description.`,
        blockedBy: [],
        writeScopes: [],
        ...taskDefaults,
        requiredCapabilities: ['lint'],
        ...overrides,
      })
    }
    const parent = await createTask('Human parent', { reviewPolicy: { kind: 'participant', reviewerId: human.id } })
    const child = await createTask('Human child', { parentTaskId: parent.id, blockedBy: [parent.id] })
    const parentAssigned = await assignTestTask(ctx, {
      teamId: parent.teamId,
      taskId: parent.id,
      expectedRevision: parent.revision,
      participantId: human.id,
      leaseDurationMs: 100,
    })
    expect(parentAssigned.lease?.activationId).toBeUndefined()
    const parentLease = parentAssigned.lease
    if (parentLease === undefined) throw new Error('human assignment must retain its lease')
    await expect(ctx.teams.startTaskAttempt({
      actor: {} as TeamActorProof,
      taskId: parentAssigned.id,
      expectedRevision: parentAssigned.revision,
      attemptId: parentLease.attemptId,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(assignTestTask(ctx, {
      teamId: child.teamId,
      taskId: child.id,
      expectedRevision: child.revision,
      participantId: human.id,
      leaseDurationMs: 100,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const overflow = await createTask('Overflow timestamp')
    await expect(assignTestTask(ctx, {
      teamId: overflow.teamId,
      taskId: overflow.id,
      expectedRevision: overflow.revision,
      participantId: human.id,
      leaseDurationMs: Number.MAX_SAFE_INTEGER,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const inactive = await inviteBootstrapParticipant(ctx, {
      teamId: (await ctx.teams.getTeam({ teamId: team.team.id })).team.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: team.team.id })).team.cursor,
      kind: 'human',
      displayName: 'Inactive reviewer',
      role: 'reviewer',
      capabilities: ['lint'],
    })
    const inactiveTask = await createTask('Inactive owner')
    await expect(assignTestTask(ctx, {
      teamId: inactiveTask.teamId,
      taskId: inactiveTask.id,
      expectedRevision: inactiveTask.revision,
      participantId: inactive.id,
      leaseDurationMs: 100,
    })).rejects.toMatchObject({ code: 'TEAM_PARTICIPANT_NOT_FOUND' })
    const quiescingTask = await createTask('Reject quiescing assignment')
    await seedTeamPhase(ctx, team.team.id, 'quiescing')
    await expect(assignTestTask(ctx, {
      teamId: quiescingTask.teamId,
      taskId: quiescingTask.id,
      expectedRevision: quiescingTask.revision,
      participantId: human.id,
      leaseDurationMs: 100,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  })

  it('maps an external SQLite tail winner to a Team cursor conflict and closes stale watches', async () => {
    const first = await setup()
    const created = await createTestRootTeam(first.ctx, { goal: { objective: 'Conflict', budgets: {} }, rules: {}, budgets: {} })
    const second = await setup(first.root)
    const secondState = await second.ctx.teams.getTeam({ teamId: created.team.id })
    const firstState = await first.ctx.teams.getTeam({ teamId: created.team.id })
    const staleWatch = second.ctx.teams.watchTeam({ teamId: created.team.id, afterCursor: secondState.team.cursor })
    await inviteBootstrapParticipant(first.ctx, {
      teamId: created.team.id,
      expectedCursor: firstState.team.cursor,
      kind: 'service',
      displayName: 'First writer',
      role: 'writer',
      capabilities: [],
    })
    await expect(inviteBootstrapParticipant(second.ctx, {
      teamId: created.team.id,
      expectedCursor: secondState.team.cursor,
      kind: 'service',
      displayName: 'Second writer',
      role: 'writer',
      capabilities: [],
    })).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
    await expect(staleWatch).resolves.toEqual({ kind: 'closed' })
  })

  it('reconciles externally appended Team and channel suffixes before later reads', async () => {
    const first = await setup()
    const created = await createTestRootTeam(first.ctx, { goal: { objective: 'Cross-host read recovery', budgets: {} }, rules: {}, budgets: {} })
    const participant = await activeParticipant(first.ctx, created.team.id)
    await postActor(first.ctx, created.team.id, participant.id)
    const beforeChannel = await first.ctx.teams.getTeam({ teamId: created.team.id })
    let channel = await openTestChannel(first.ctx, {
      teamId: created.team.id,
      expectedCursor: beforeChannel.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: participant.id, role: 'worker' }],
      limits: {},
    })
    channel = await acknowledgeTestChannelActivations(first.ctx, channel.manifest.id)

    const second = await setup(first.root)
    // Prime both second-Hub projections before the first Hub appends new facts.
    await second.ctx.teams.getTeam({ teamId: created.team.id })
    await second.ctx.teams.getChannel({ channelId: channel.manifest.id })

    const firstBeforeInvite = await first.ctx.teams.getTeam({ teamId: created.team.id })
    const invited = await inviteBootstrapParticipant(first.ctx, {
      teamId: created.team.id,
      expectedCursor: firstBeforeInvite.team.cursor,
      kind: 'service',
      displayName: 'External host service',
      role: 'observer',
      capabilities: [],
    })
    const refreshedTeam = await second.ctx.teams.getTeam({ teamId: created.team.id })
    expect(refreshedTeam.participants.some(candidate => candidate.id === invited.id)).toBe(true)

    const firstChannel = await first.ctx.teams.getChannel({ channelId: channel.manifest.id })
    const posted = await first.ctx.teams.postChannelEnvelope({
      actor: await postActor(first.ctx, created.team.id, participant.id),
      expectedCursor: firstChannel.cursor,
      draft: {
        channelId: channel.manifest.id,
        audience: [participant.id],
        kind: 'message',
        payload: { text: 'external channel append' },
        delivery: 'context',
      },
    })
    const refreshedChannel = await second.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
    expect(refreshedChannel.records.some(record => record.type === 'channel/envelope' && record.envelope.id === posted.id))
      .toBe(true)

    const secondBeforeInvite = await second.ctx.teams.getTeam({ teamId: created.team.id })
    await inviteBootstrapParticipant(second.ctx, {
      teamId: created.team.id,
      expectedCursor: secondBeforeInvite.team.cursor,
      kind: 'service',
      displayName: 'Second host service',
      role: 'observer',
      capabilities: [],
    })
    const firstAfterSecondWrite = await first.ctx.teams.getTeam({ teamId: created.team.id })
    expect(firstAfterSecondWrite.participants.some(candidate => candidate.displayName === 'Second host service')).toBe(true)
  })

  it('maps an external channel-WAL tail winner to a channel cursor conflict', async () => {
    const first = await setup()
    const team = await createTestRootTeam(first.ctx, { goal: { objective: 'Channel conflict', budgets: {} }, rules: {}, budgets: {} })
    const participant = await activeParticipant(first.ctx, team.team.id)
    const state = await first.ctx.teams.getTeam({ teamId: team.team.id })
    const channel = await openTestChannel(first.ctx, {
      teamId: team.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: participant.id, role: 'worker' }],
      limits: {},
    })
    const second = await setup(first.root)
    await second.ctx.teams.getChannel({ channelId: channel.manifest.id })
    await closeTestChannel(first.ctx, { channelId: channel.manifest.id, expectedCursor: channel.cursor })
    await expect(closeTestChannel(second.ctx, { channelId: channel.manifest.id, expectedCursor: channel.cursor }))
      .rejects.toMatchObject({ code: 'TEAM_CHANNEL_CURSOR_CONFLICT' })
  })

  it('shares cold Team and channel recovery among concurrent callers', async () => {
    const first = await setup()
    const team = await createTestRootTeam(first.ctx, { goal: { objective: 'Shared recovery', budgets: {} }, rules: {}, budgets: {} })
    const participant = await activeParticipant(first.ctx, team.team.id)
    const state = await first.ctx.teams.getTeam({ teamId: team.team.id })
    const channel = await openTestChannel(first.ctx, {
      teamId: team.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: participant.id, role: 'worker' }],
      limits: {},
    })
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)

    const second = await setup(first.root)
    const [leftTeam, rightTeam, leftChannel, rightChannel] = await Promise.all([
      second.ctx.teams.getTeam({ teamId: team.team.id }),
      second.ctx.teams.getTeam({ teamId: team.team.id }),
      second.ctx.teams.getChannel({ channelId: channel.manifest.id }),
      second.ctx.teams.getChannel({ channelId: channel.manifest.id }),
    ])
    expect(leftTeam.team.id).toBe(rightTeam.team.id)
    expect(leftChannel.manifest.id).toBe(rightChannel.manifest.id)
  })

  it('contains checkpoint persistence failures after the durable append has succeeded', async () => {
    const { ctx } = await setup()
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Checkpoint errors', budgets: {} }, rules: {}, budgets: {} })
    const participant = await activeParticipant(ctx, team.team.id)
    const state = await ctx.teams.getTeam({ teamId: team.team.id })
    const channel = await openTestChannel(ctx, {
      teamId: team.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: participant.id, role: 'worker' }],
      limits: {},
    })
    const teamStream = ctx.storageLog.get(`team/${team.team.id}`)
    const channelStream = ctx.storageLog.get(`channel/${channel.manifest.id}`)
    if (teamStream === undefined || channelStream === undefined) throw new Error('Hub stream handle is not open')
    const failing = async (): Promise<void> => { throw new Error('checkpoint unavailable') }
    const faultedTeam = teamStream as unknown as { writeCheckpoint: typeof failing }
    const faultedChannel = channelStream as unknown as { writeCheckpoint: typeof failing }
    const writeTeam = faultedTeam.writeCheckpoint
    const writeChannel = faultedChannel.writeCheckpoint
    faultedTeam.writeCheckpoint = failing
    faultedChannel.writeCheckpoint = failing
    try {
      const closed = await closeTestChannel(ctx, { channelId: channel.manifest.id, expectedCursor: channel.cursor })
      const quiescing = await seedTeamPhase(ctx, team.team.id, 'quiescing')
      expect(quiescing.team.phase).toBe('quiescing')
      expect(closed.phase).toBe('closed')
    } finally {
      faultedTeam.writeCheckpoint = writeTeam
      faultedChannel.writeCheckpoint = writeChannel
    }
  })

  it('returns immediate read/watch results and closes a channel with a reason', async () => {
    const { ctx } = await setup()
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Channel', budgets: {} }, rules: {}, budgets: {} })
    const participant = await activeParticipant(ctx, created.team.id)
    const state = await ctx.teams.getTeam({ teamId: created.team.id })
    const channel = await openTestChannel(ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: participant.id, role: 'worker' }],
      limits: {},
    })
    await expect(ctx.teams.watchChannel({ channelId: channel.manifest.id, afterCursor: -1 }))
      .resolves.toMatchObject({ kind: 'changed', cursor: channel.cursor })
    await expect(ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: channel.cursor + 10 }))
      .resolves.toMatchObject({ records: [] })
    const closed = await closeTestChannel(ctx, {
      channelId: channel.manifest.id,
      expectedCursor: channel.cursor,
      reason: 'finished',
    })
    await expect(closeTestChannel(ctx, { channelId: channel.manifest.id, expectedCursor: closed.cursor }))
      .rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' })
    await expect(closeTestChannel(ctx, { channelId: channel.manifest.id, expectedCursor: channel.cursor }))
      .rejects.toMatchObject({ code: 'TEAM_CHANNEL_CURSOR_CONFLICT' })
  })

  it('closes an admitted cursor watch while disposing its Hub', async () => {
    const { ctx } = await setup()
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Dispose', budgets: {} }, rules: {}, budgets: {} })
    const watch = ctx.teams.watchTeam({ teamId: created.team.id, afterCursor: created.team.cursor })
    const hub = ctx.teams as TeamHub
    await Promise.resolve()
    await Promise.resolve()
    await ctx.fiber.dispose()
    contexts.delete(ctx)
    await expect(watch).resolves.toEqual({ kind: 'closed' })
    await expect(hub.getTeam({ teamId: created.team.id })).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
  })

  it('fails loudly for materialized foreign Team stream formats', async () => {
    const { ctx } = await setup()
    const stream = await ctx.storageLog.open({ name: 'team/foreign-format', version: 9 })
    await stream.append(-1, [{ foreign: true }])
    await stream.close()
    await expect(ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
  })

  it('rejects empty/malformed Team journals and ignores valid orphan channel WALs', async () => {
    const { ctx } = await setup()
    const empty = await ctx.storageLog.open({ name: 'team/empty-journal', version: TEAM_JOURNAL_FORMAT_VERSION })
    await empty.writeCheckpoint({ sequence: -1, value: { empty: true } })
    await empty.close()
    await expect(ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })

    const missing = teamIdSchema.parse('missing-team')
    await expect(ctx.teams.getTeam({ teamId: missing })).rejects.toMatchObject({ code: 'TEAM_NOT_FOUND' })

    const malformed = teamIdSchema.parse('malformed-team')
    const malformedStream = await ctx.storageLog.open({ name: `team/${malformed}`, version: TEAM_JOURNAL_FORMAT_VERSION })
    await malformedStream.append(-1, [{ not: 'a Team record' }])
    await malformedStream.close()
    await expect(ctx.teams.getTeam({ teamId: malformed })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })

    const team = await createTestRootTeam(ctx, { goal: { objective: 'Orphan owner', budgets: {} }, rules: {}, budgets: {} })
    const orphanId = channelIdSchema.parse('orphan-channel')
    const orphan = await ctx.storageLog.open({ name: `channel/${orphanId}`, version: CHANNEL_WAL_FORMAT_VERSION })
    await orphan.append(-1, [
      {
        type: 'channel/opened',
        sequence: 0,
        createdAt: 1,
        manifest: {
          id: orphanId,
          teamId: team.team.id,
          adapter: { type: 'direct', version: 1 },
          participants: [],
          limits: {},
        },
      },
      { type: 'channel/phase', sequence: 1, createdAt: 1, phase: 'active' },
    ])
    await orphan.close()
    await expect(ctx.teams.getChannel({ channelId: orphanId })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_NOT_FOUND' })
    const hub = ctx.teams as unknown as { readonly channels: Map<string, unknown> }
    expect(hub.channels.has(orphanId)).toBe(false)
    expect(ctx.teams.getImplementationLeaseMetrics()).toMatchObject({ activeAdapterLeases: 0 })

    const missingTeamOrphanId = channelIdSchema.parse('missing-team-orphan')
    const missingTeamOrphan = await ctx.storageLog.open({
      name: `channel/${missingTeamOrphanId}`,
      version: CHANNEL_WAL_FORMAT_VERSION,
    })
    await missingTeamOrphan.append(-1, [
      {
        type: 'channel/opened',
        sequence: 0,
        createdAt: 1,
        manifest: {
          id: missingTeamOrphanId,
          teamId: missing,
          adapter: { type: 'direct', version: 1 },
          participants: [],
          limits: {},
        },
      },
      { type: 'channel/phase', sequence: 1, createdAt: 1, phase: 'active' },
    ])
    await missingTeamOrphan.close()
    await expect(ctx.teams.postChannelEnvelope({
      actor: {} as TeamActorProof,
      expectedCursor: 1,
      draft: {
        channelId: missingTeamOrphanId,
        audience: null,
        kind: 'message',
        payload: { text: 'unreachable orphan' },
        delivery: 'context',
      },
    })).rejects.toMatchObject({ code: 'TEAM_NOT_FOUND' })
    expect(hub.channels.has(missingTeamOrphanId)).toBe(false)
    expect(ctx.teams.getImplementationLeaseMetrics()).toMatchObject({ activeAdapterLeases: 0 })
    await expect(ctx.teams.getChannel({ channelId: missingTeamOrphanId })).rejects.toMatchObject({ code: 'TEAM_NOT_FOUND' })
    expect(hub.channels.has(missingTeamOrphanId)).toBe(false)
    expect(ctx.teams.getImplementationLeaseMetrics()).toMatchObject({ activeAdapterLeases: 0 })

    const malformedChannel = channelIdSchema.parse('malformed-channel')
    const malformedChannelStream = await ctx.storageLog.open({ name: `channel/${malformedChannel}`, version: CHANNEL_WAL_FORMAT_VERSION })
    await malformedChannelStream.append(-1, [{ not: 'a channel record' }])
    await malformedChannelStream.close()
    await expect(ctx.teams.getChannel({ channelId: malformedChannel })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' })
  })

  it('honors checkpoint cadence and rejects invalid configuration values', async () => {
    const { ctx } = await setup(undefined, { checkpointEvery: 10 })
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Checkpoint cadence', budgets: {} }, rules: {}, budgets: {} })
    const teamStream = ctx.storageLog.get(`team/${team.team.id}`)
    if (teamStream === undefined) throw new Error('Team journal stream is not open')
    await expect(teamStream.readCheckpoint()).resolves.toBeUndefined()
    const participant = await activeParticipant(ctx, team.team.id)
    const state = await ctx.teams.getTeam({ teamId: team.team.id })
    const channel = await openTestChannel(ctx, {
      teamId: team.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: participant.id, role: 'worker' }],
      limits: {},
    })
    const channelStream = ctx.storageLog.get(`channel/${channel.manifest.id}`)
    if (channelStream === undefined) throw new Error('channel WAL stream is not open')
    await expect(channelStream.readCheckpoint()).resolves.toBeUndefined()
    const explicitContext = new Context()
    const explicit = new TeamHub(explicitContext, {
      recoveryPageSize: 2,
      checkpointEvery: 2,
      disposalTimeoutMs: 2,
      maxPendingDeliveriesPerChannel: 2,
      maxPendingDeliveryPageSize: 2,
    })
    expect(explicit).toBeInstanceOf(TeamHub)
    await explicitContext.fiber.dispose()
    const defaultContext = new Context()
    const defaults = new TeamHub(defaultContext)
    expect(defaults).toBeInstanceOf(TeamHub)
    await defaultContext.fiber.dispose()
    expect(() => { void new TeamHub(new Context(), { checkpointEvery: 0 }) }).toThrow(/checkpointEvery/)
    expect(() => { void new TeamHub(new Context(), { maxTeamDepth: -1 }) }).toThrow(/maxTeamDepth/)
    expect(() => { void new TeamHub(new Context(), { maxPendingDeliveriesPerChannel: 0 }) })
      .toThrow(/maxPendingDeliveriesPerChannel/)
    expect(() => { void new TeamHub(new Context(), { maxPendingDeliveryPageSize: 0 }) })
      .toThrow(/maxPendingDeliveryPageSize/)
    expect(() => { void new TeamHub(new Context(), { maxPostIdempotencyEntriesPerChannel: 0 }) })
      .toThrow(/maxPostIdempotencyEntriesPerChannel/)
    expect(() => { void new TeamHub(new Context(), { maxTaskAttemptsPerTask: 0 }) })
      .toThrow(/maxTaskAttemptsPerTask/)
    expect(() => { void new TeamHub(new Context(), { maxTaskLeaseDurationMs: 0 }) })
      .toThrow(/maxTaskLeaseDurationMs/)
  })

  it('caps task attempt history and lease duration through Hub configuration', async () => {
    const { ctx } = await setup(undefined, { maxTaskAttemptsPerTask: 1, maxTaskLeaseDurationMs: 10 })
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Configured task limits', budgets: {} }, rules: {}, budgets: {} })
    await provisionTestCoordinator(ctx, team.team.id)
    const human = await activeParticipant(ctx, team.team.id, { kind: 'human' })
    await expect(createTestCoordinatorTask(ctx, {
      teamId: team.team.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: team.team.id })).team.cursor,
      subject: 'Too many attempts',
      description: 'Exceeds the configured attempt cap.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
      maxAttempts: 2,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const current = await ctx.teams.getTeam({ teamId: team.team.id })
    const task = await createTestCoordinatorTask(ctx, {
      teamId: current.team.id,
      expectedCursor: current.team.cursor,
      subject: 'Bounded lease',
      description: 'Respects the configured lease duration cap.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
      maxAttempts: 1,
    })
    await expect(assignTestTask(ctx, {
      teamId: task.teamId,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: human.id,
      leaseDurationMs: 11,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(assignTestTask(ctx, {
      teamId: task.teamId,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: human.id,
      leaseDurationMs: 10,
    })).resolves.toMatchObject({ lease: { durationMs: 10 } })
  })

  it('caps retries across the Team while allowing the initial attempt', async () => {
    const { ctx } = await setup(undefined, { maxRetriesPerTeam: 1, maxTaskAttemptsPerTask: 3, maxTaskLeaseDurationMs: 10_000 })
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Bound retries', budgets: {} }, rules: {}, budgets: {} })
    await provisionTestCoordinator(ctx, team.team.id)
    const owner = await activeParticipant(ctx, team.team.id)
    const ownerActivation = await taskActivation(ctx, team.team.id, owner.id, 'retry-owner')
    const ownerActor = await taskActor(ctx, team.team.id, ownerActivation)
    const task = await createTestCoordinatorTask(ctx, {
      teamId: team.team.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: team.team.id })).team.cursor,
      subject: 'Retry bounded work',
      description: 'The Team permits one retry after the initial attempt.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
    })
    const failAttempt = async (current: Awaited<ReturnType<Context['teams']['getTask']>>) => {
      const assigned = await assignTestTask(ctx, {
        teamId: current.teamId,
        taskId: current.id,
        expectedRevision: current.revision,
        participantId: owner.id,
        activationId: ownerActivation,
        leaseDurationMs: 1_000,
      })
      const lease = assigned.lease
      if (lease === undefined) throw new Error('retry test assignment lost its lease')
      const running = await ctx.teams.startTaskAttempt({
        actor: ownerActor,
        taskId: assigned.id,
        expectedRevision: assigned.revision,
        attemptId: lease.attemptId,
      })
      const runningLease = running.lease
      if (runningLease === undefined) throw new Error('retry test start lost its lease')
      return await ctx.teams.settleTaskAttempt({
        actor: ownerActor,
        taskId: running.id,
        expectedRevision: running.revision,
        attemptId: runningLease.attemptId,
        outcome: { kind: 'failed', failure: { code: 'TEST_RETRY', message: 'retry me' } },
      })
    }
    const firstFailure = await failAttempt(task)
    expect(firstFailure.phase).toBe('pending')
    const secondFailure = await failAttempt(firstFailure)
    expect(secondFailure.phase).toBe('pending')
    await expect(assignTestTask(ctx, {
      teamId: secondFailure.teamId,
      taskId: secondFailure.id,
      expectedRevision: secondFailure.revision,
      participantId: owner.id,
      activationId: ownerActivation,
      leaseDurationMs: 1_000,
    })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
  })

  it('rejects new channel work after the Team wall-time budget expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_001_000_000)
    const { ctx } = await setup(undefined, { maxWallTimeMsPerTeam: 10 })
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Bound wall time', budgets: {} }, rules: {}, budgets: {} })
    const sender = await activeParticipant(ctx, team.team.id)
    const recipient = await activeParticipant(ctx, team.team.id, { kind: 'human' })
    let current = await ctx.teams.getTeam({ teamId: team.team.id })
    const channel = await openTestChannel(ctx, {
      teamId: team.team.id,
      expectedCursor: current.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: sender.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }],
      limits: {},
    })
    vi.advanceTimersByTime(11)
    current = await ctx.teams.getTeam({ teamId: team.team.id })
    await expect(ctx.teams.postChannelEnvelope({
      actor: await postActor(ctx, team.team.id, sender.id),
      expectedCursor: channel.cursor,
      draft: {
        channelId: channel.manifest.id,
        audience: [recipient.id],
        kind: 'message',
        payload: { text: 'too late' },
        delivery: 'context',
      },
    })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
    expect(current.team.phase).toBe('active')
  })

  it('rejects a lease deadline that exceeds the representable timestamp range', async () => {
    const { ctx } = await setup(undefined, { maxTaskLeaseDurationMs: Number.MAX_SAFE_INTEGER })
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Lease timestamp range', budgets: {} }, rules: {}, budgets: {} })
    await provisionTestCoordinator(ctx, team.team.id)
    const human = await activeParticipant(ctx, team.team.id, { kind: 'human' })
    const current = await ctx.teams.getTeam({ teamId: team.team.id })
    const task = await createTestCoordinatorTask(ctx, {
      teamId: current.team.id,
      expectedCursor: current.team.cursor,
      subject: 'Overflowing deadline',
      description: 'Rejects an unrepresentable lease expiry timestamp.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
    })
    await expect(assignTestTask(ctx, {
      teamId: task.teamId,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: human.id,
      leaseDurationMs: Number.MAX_SAFE_INTEGER,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  })
})


describe('single-task cancellation ownership', () => {
  for (const phase of ['pending', 'assigned', 'running', 'review', 'expired', 'fenced'] as const) {
    it(`retains exact cancellation ownership from ${phase} while the Team remains active`, async () => {
      vi.useFakeTimers()
      vi.setSystemTime(1_800_000_000_000)
      const { ctx, root } = await setup()
      const team = await createTestRootTeam(ctx, { goal: { objective: 'Cancel one task', budgets: {} }, rules: {}, budgets: {} })
      const owner = await activeParticipant(ctx, team.team.id)
      const activationId = await taskActivation(ctx, team.team.id, owner.id, 'cancel-owner')
      const actor = await taskActor(ctx, team.team.id, activationId)
      const coordinatorActor = await provisionTestCoordinator(ctx, team.team.id)
      const state = await ctx.teams.getTeam({ teamId: team.team.id })
      const coordinator = state.activations.find(binding => state.participants.find(participant => participant.id === binding.activation.participantId)?.role === 'coordinator')!
      const controls = taskControlAuthority(ctx)
      let task = await ctx.teams.createTask({ actor: coordinatorActor, teamId: team.team.id, expectedCursor: state.team.cursor,
        createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('single-cancel') },
        subject: 'Stop this task', description: 'Keep the Team available.', blockedBy: [], writeScopes: [], ...taskDefaults,
        reviewPolicy: phase === 'review' ? { kind: 'participant', reviewerId: coordinator.activation.participantId } : { kind: 'none' } })
      if (phase !== 'pending') task = await assignTestTask(ctx, { teamId: task.teamId, taskId: task.id, expectedRevision: task.revision,
        participantId: owner.id, activationId, leaseDurationMs: 1000 })
      if (phase === 'running' || phase === 'review' || phase === 'expired' || phase === 'fenced') task = await ctx.teams.startTaskAttempt({ actor, taskId: task.id,
        attemptId: task.lease!.attemptId, expectedRevision: task.revision })
      if (phase === 'review') task = await ctx.teams.settleTaskAttempt({ actor, taskId: task.id, attemptId: task.lease!.attemptId,
        expectedRevision: task.revision, outcome: { kind: 'completed', result: { summary: 'Review this result.' } } })
      const prior = task
      const cancel = async (selected: typeof task) => {
        const scope: TeamSystemTaskControlScope = { kind: 'team-run-default-worker-cancel', teamId: selected.teamId,
          taskId: selected.id, expectedRevision: selected.revision, reason: 'Only this task.',
          coordinator: { teamId: selected.teamId, participantId: coordinator.activation.participantId,
            activationId: coordinator.activation.id, sessionId: coordinator.sessionId, provider: coordinator.provider } }
        const proof = controls.issue(scope)
        try { return await ctx.teams.cancelTask({ actor: proof.proof, teamId: selected.teamId, taskId: selected.id,
          expectedRevision: selected.revision, reason: 'Only this task.' }) }
        finally { proof.revoke() }
      }
      task = await cancel(task)
      expect(task.cancellation).toMatchObject({ requestedRevision: prior.revision, requestedBy: coordinator.activation.participantId, reason: 'Only this task.' })
      expect(task.attemptHistory).toEqual(prior.attemptHistory)
      await expect(cancel(prior)).resolves.toEqual(task)
      if (prior.lease !== undefined) {
        expect(task.phase).toBe(prior.phase)
        expect(task.lease).toEqual(prior.lease)
        const fence = { actor, taskId: task.id, attemptId: prior.lease.attemptId, expectedRevision: task.revision }
        await expect(ctx.teams.heartbeatTaskAttempt(fence)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
        await expect(ctx.teams.settleTaskAttempt({ ...fence, outcome: { kind: 'completed', result: { summary: 'Late completion' } } })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
        if (phase === 'assigned') await expect(ctx.teams.startTaskAttempt(fence)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
        if (phase === 'expired') {
          vi.setSystemTime(prior.lease.expiresAt + 1)
          task = await expireTestTask(ctx, {
            teamId: task.teamId, taskId: task.id, attemptId: prior.lease.attemptId, expectedRevision: task.revision,
          })
          expect(task.phase).toBe('running')
          expect(task.lease).toEqual(prior.lease)
          expect(task.cancellation?.expiredAt).toBeGreaterThanOrEqual(prior.lease.expiresAt)
          expect(teamTaskSnapshotSchema.safeParse({
            ...task, cancellation: { ...task.cancellation, expiredAt: prior.lease.expiresAt - 1 },
          }).success).toBe(false)
          expect(task.attemptHistory).toEqual([])
        }
        if (phase === 'fenced') {
          const binding = await ctx.teams.getActivation({ teamId: task.teamId, activationId })
          const current = await ctx.teams.getTeam({ teamId: task.teamId })
          await fenceTestActivation(ctx, { teamId: task.teamId, expectedCursor: current.team.cursor, activationId,
            participantId: owner.id, sessionId: binding.sessionId, provider: binding.provider })
          task = await ctx.teams.getTask({ teamId: task.teamId, taskId: task.id })
          expect(task.attemptHistory.at(-1)).toMatchObject({ id: prior.lease.attemptId, outcome: { kind: 'released' } })
        } else {
          task = await ctx.teams.settleTaskAttempt({ actor, taskId: task.id, attemptId: prior.lease.attemptId,
            expectedRevision: task.revision, outcome: { kind: 'cancelled' } })
          expect(task.attemptHistory.at(-1)).toMatchObject({ id: prior.lease.attemptId, outcome: { kind: 'cancelled' } })
        }
      } else if (phase === 'review') {
        await expect(ctx.teams.resolveTaskReview({ actor: coordinatorActor, taskId: task.id, expectedRevision: task.revision,
          nextPhase: 'completed', reason: 'Old review cannot complete cancelled work.' })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
        expect(task.attemptHistory).toEqual(prior.attemptHistory)
      }
      expect(task.phase).toBe('cancelled')
      expect((await ctx.teams.getTeam({ teamId: task.teamId })).team).toMatchObject({ phase: 'active' })
      controls.dispose()
      await ctx.fiber.dispose()
      contexts.delete(ctx)
      const reopened = await setup(root)
      await expect(reopened.ctx.teams.getTask({ teamId: task.teamId, taskId: task.id })).resolves.toEqual(task)
    })
  }
})
