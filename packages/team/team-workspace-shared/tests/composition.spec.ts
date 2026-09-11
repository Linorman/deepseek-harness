import { reserveTestWorkspaceAllocation, activateTestWorkspaceAllocation, requestTestWorkspaceAllocationRelease } from '../../../core/team/tests/workspace-allocation-authority.ts'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import AgentRegistry, { Inbox } from '@clocky/clocky-agent'
import type { Agent } from '@clocky/clocky-agent'
import { activationIdSchema, teamTaskCreateIdempotencyKeySchema } from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ParticipantSnapshot,
  TeamSystemActivationProof,
  TeamSystemActivationScope,
  TeamSystemTaskLeaseProof,
  TeamSystemTaskLeaseScope,
  TeamTaskAssignInput,
  TeamTaskSnapshot,
} from '@clocky/clocky-team'
import TeamHub from '@clocky/clocky-team-hub'
import TeamWorkspaceRegistry from '@clocky/clocky-team-workspace'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@clocky/clocky-session'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as SharedWorkspace from '../src/index.ts'

const contexts = new Set<Context>()
const roots: string[] = []
const TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE = 'team-activation-controller'
const TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE = 'team-scheduler-dag'
const activationProofStores = new WeakMap<Context, WeakMap<TeamSystemActivationProof, ControllerActivationScope>>()

type ControllerActivationScope =
  | Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-bind' }>
  | Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-status' }>
  | Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-fence' }>
  | Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-quiesce' }>

type SchedulerTaskAssignScope = Extract<TeamSystemTaskLeaseScope, { readonly kind: 'scheduler-task-assign' }>

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
  if (failures.length > 0) throw new AggregateError(failures, 'shared Team workspace composition cleanup failed')
})

/** Create one repository-local temporary directory retained for this test's cleanup. */
async function freshRoot(prefix: string): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, prefix))
  roots.push(root)
  return root
}

/** Issue one nonserializable controller proof only for its exact test lifecycle operation. */
async function withActivationProof<T>(
  ctx: Context,
  scope: ControllerActivationScope,
  operation: (actor: TeamSystemActivationProof) => Promise<T>,
): Promise<T> {
  let proofs = activationProofStores.get(ctx)
  if (proofs === undefined) {
    const sourceProofs = new WeakMap<TeamSystemActivationProof, ControllerActivationScope>()
    proofs = sourceProofs
    activationProofStores.set(ctx, sourceProofs)
    ctx.teams.registerSystemActivationProofSource({
      name: TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE,
      resolveActivationProof: proof => sourceProofs.get(proof),
    })
  }
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test activation controller proofs are runtime-only') },
  })
  const actor = Object.freeze(proof) as TeamSystemActivationProof
  proofs.set(actor, scope)
  try {
    return await operation(actor)
  } finally {
    proofs.delete(actor)
  }
}

/** Assign one fixture lease through an exact one-shot scheduler authority. */
async function assignSchedulerTask(
  ctx: Context,
  input: TeamTaskAssignInput,
): Promise<TeamTaskSnapshot> {
  const proofs = new WeakMap<TeamSystemTaskLeaseProof, SchedulerTaskAssignScope>()
  const unregister = ctx.teams.registerSystemTaskLeaseProofSource({
    name: TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE,
    resolveTaskLeaseProof: proof => proofs.get(proof),
  })
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test scheduler task-lease proofs are runtime-only') },
  })
  const actor = Object.freeze(proof) as TeamSystemTaskLeaseProof
  proofs.set(actor, { kind: 'scheduler-task-assign', ...input })
  try {
    return await ctx.teams.assignTask({ actor, ...input })
  } finally {
    proofs.delete(actor)
    unregister()
  }
}

/** Build a live minimal Agent whose immutable Session header names the shared root. */
function localAgent(id: SessionId, cwd: string): Agent {
  const session = Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 1,
    cwd,
  })
  return {
    id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** Move one invited local Agent Participant to active membership. */
async function activeLocalParticipant(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  role = 'worker',
  displayName = 'Shared worker',
): Promise<ParticipantSnapshot> {
  let state = await ctx.teams.getTeam({ teamId })
  const participant = await inviteBootstrapParticipant(ctx, {
    teamId,
    expectedCursor: state.team.cursor,
    kind: 'local-agent',
    displayName,
    role,
    capabilities: [],
  })
  state = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: participant.id,
    expectedCursor: state.team.cursor,
    phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId })
  return await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: participant.id,
    expectedCursor: state.team.cursor,
    phase: 'active',
  })
}

/** Bind a local Session to one durable idle activation. */
async function bindIdle(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  participant: ParticipantSnapshot,
  sessionId: SessionId,
): Promise<ActivationBindingSnapshot> {
  const state = await ctx.teams.getTeam({ teamId })
  const binding: ActivationBindingSnapshot = {
    activation: {
      id: activationIdSchema.parse(`shared-workspace-${participant.id}`),
      teamId,
      participantId: participant.id,
      status: 'idle',
    },
    sessionId,
    provider: 'in-process',
  }
  const input = {
    expectedCursor: state.team.cursor,
    binding,
  }
  return await withActivationProof(ctx, {
    kind: 'activation-controller-bind',
    ...input,
  }, async actor => await ctx.teams.bindActivation({ actor, ...input }))
}

/** Create and assign one current shared task to the exact durable activation. */
async function assignedTask(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  participant: ParticipantSnapshot,
  binding: ActivationBindingSnapshot,
): Promise<TeamTaskSnapshot> {
  const coordinator = await activeLocalParticipant(ctx, teamId, 'coordinator', 'Shared coordinator')
  const coordinatorBinding = await bindIdle(
    ctx,
    teamId,
    coordinator,
    SessionId(`shared-workspace-coordinator-${coordinator.id}`),
  )
  const actor = ctx.teams.openActivationActorProofIssuer().issue(coordinatorBinding).proof
  let state = await ctx.teams.getTeam({ teamId })
  const task = await ctx.teams.createTask({
    actor,
    teamId,
    expectedCursor: state.team.cursor,
    createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`shared-workspace:${teamId}`) },
    subject: 'Use shared root',
    description: 'Run against the configured common checkout.',
    blockedBy: [],
    requiredCapabilities: [],
    priority: 0,
    readScopes: [],
    writeScopes: [],
    workspaceMode: 'shared',
    budget: {},
    reviewPolicy: { kind: 'none' },
    maxAttempts: 1,
  })
  state = await ctx.teams.getTeam({ teamId })
  return await assignSchedulerTask(ctx, {
    teamId,
    taskId: task.id,
    expectedRevision: task.revision,
    participantId: participant.id,
    activationId: binding.activation.id,
    leaseDurationMs: 60_000,
  })
}

describe('shared Team workspace composition', () => {
  it('uses a real Hub lease and live Agent Session, then leaves the configured root intact after HMR removal', async () => {
    const stateRoot = await freshRoot('team-workspace-shared-state-')
    const workspaceRoot = await freshRoot('team-workspace-shared-root-')
    const ctx = new Context()
    contexts.add(ctx)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: stateRoot })
    await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
    await ctx.plugin(TeamHub)
    await ctx.plugin(TeamWorkspaceRegistry)
    const providerFiber = await ctx.plugin(SharedWorkspace, { root: workspaceRoot })

    const sessionId = SessionId('shared-workspace-composition-session')
    ctx.agents.register(localAgent(sessionId, workspaceRoot))
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Allocate a shared local root.', budgets: {} }, rules: {}, budgets: {} })
    const participant = await activeLocalParticipant(ctx, created.team.id)
    const binding = await bindIdle(ctx, created.team.id, participant, sessionId)
    const assigned = await assignedTask(ctx, created.team.id, participant, binding)
    if (assigned.lease === undefined) throw new Error('Assigned task has no lease')
    const task = await ctx.teams.startTaskAttempt({ actor: ctx.teams.openActivationActorProofIssuer().issue(binding).proof,
      taskId: assigned.id, attemptId: assigned.lease.attemptId, expectedRevision: assigned.revision })
    if (task.lease === undefined) throw new Error('Team Hub did not retain a task lease')

    await expect(ctx.teamWorkspaces.eligible('shared', { task, binding })).resolves.toBe(true)
    const request = {
      teamId: created.team.id,
      taskId: task.id,
      attemptId: task.lease.attemptId,
      assignedRevision: task.lease.assignedRevision,
      participantId: participant.id,
      activationId: binding.activation.id,
      sessionId,
    }
    const preparation = await ctx.teamWorkspaces.prepare('shared', request)
    const reserved = await reserveTestWorkspaceAllocation(ctx, { teamId: request.teamId,
      expectedCursor: (await ctx.teams.getTeam({ teamId: request.teamId })).team.cursor, taskId: request.taskId,
      expectedTaskRevision: task.revision, attemptId: request.attemptId, allocation: {
        id: preparation.id, provider: preparation.provider, mode: preparation.mode, assignedRevision: preparation.assignedRevision,
        participantId: preparation.participantId, activationId: preparation.activationId, sessionId: preparation.sessionId } })
    const allocation = await ctx.teamWorkspaces.materialize('shared', request, preparation)
    const active = await activateTestWorkspaceAllocation(ctx, { teamId: request.teamId, allocationId: reserved.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: request.teamId })).team.cursor, expectedRevision: reserved.revision })
    await writeFile(join(workspaceRoot, 'observed.txt'), 'A real shared workspace edit.\n')
    expect(allocation.root).toBe(workspaceRoot)
    expect(allocation.mode).toBe('shared')
    await expect(ctx.teamWorkspaces.publish('shared', { allocation })).resolves.toMatchObject({
      teamId: task.teamId,
      taskId: task.id,
      attemptId: task.lease.attemptId,
      changedPaths: ['observed.txt'],
      artifacts: [],
      accepted: false,
    })

    const state = await ctx.teams.getTeam({ teamId: request.teamId })
    expect(state.workspaceAllocations[0]?.observation).toMatchObject({ stage: 'publish', truncated: false,
      paths: [{ path: 'observed.txt', change: 'added', classification: 'undeclared' }] })
    const audit = await ctx.teams.readAudit({ teamId: request.teamId, afterCursor: -1, limit: 128 })
    expect(audit.items.some(entry => entry.type === 'workspace/observed')).toBe(true)
    await requestTestWorkspaceAllocationRelease(ctx, { teamId: request.teamId, allocationId: active.id,
      expectedCursor: state.team.cursor, expectedRevision: active.revision })
    await allocation.release()
    expect((await ctx.teams.getTeam({ teamId: request.teamId })).workspaceAllocations[0]?.observation?.stage).toBe('release')
    await providerFiber.dispose()
    expect(() => ctx.teamWorkspaces.resolve('shared')).toThrow(/No Team workspace provider/)
    await allocation.release()
    expect((await stat(workspaceRoot)).isDirectory()).toBe(true)
  })
})
