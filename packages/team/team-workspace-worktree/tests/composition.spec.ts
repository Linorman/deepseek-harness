import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import AgentRegistry, { Inbox } from '@clocky/clocky-agent'
import type { Agent } from '@clocky/clocky-agent'
import LocalSubprocessRuntime from '@clocky/clocky-subprocess-local'
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
import * as WorktreeWorkspace from '../src/index.ts'

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
  if (failures.length > 0) throw new AggregateError(failures, 'worktree Team workspace composition cleanup failed')
})

/** Create a repository-local temporary directory retained for this test's cleanup. */
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

/** Execute one finite Git command through the mounted subprocess capability. */
async function git(ctx: Context, cwd: string, args: readonly string[]): Promise<string> {
  const executable = await ctx.subprocess.resolveExecutable('git')
  const handle = ctx.subprocess.spawn({
    argv: [executable, ...args],
    cwd,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 16 * 1024 }, stderr: { maxBytes: 16 * 1024 } },
    graceMs: 100,
    env: { GIT_TERMINAL_PROMPT: '0', GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined },
  })
  const [outcome, exited] = await Promise.all([handle.done, handle.waitForExit()])
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  if (!exited || stdout === undefined || stderr === undefined || stdout.lossy || stderr.lossy
    || outcome.exitCode !== 0 || outcome.signal !== null) {
    throw new Error(`Git fixture command ${args.join(' ')} failed: ${stderr?.text ?? ''}`)
  }
  return stdout.text
}

/** Create one real repository with a local identity and initial unsigned commit. */
async function repository(ctx: Context, root: string): Promise<string> {
  const repo = join(root, 'repository')
  await mkdir(repo)
  await git(ctx, repo, ['init'])
  await git(ctx, repo, ['config', 'user.email', 'composition@example.test'])
  await git(ctx, repo, ['config', 'user.name', 'Composition Test'])
  await writeFile(join(repo, 'README.md'), 'initial\n')
  await git(ctx, repo, ['add', 'README.md'])
  await git(ctx, repo, ['-c', 'commit.gpgSign=false', 'commit', '-m', 'initial'])
  return repo
}

/** Build a live minimal local Agent. Its Session remains at the main repository until a future Consumer applies the allocation root. */
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

/** Move one local Agent participant through the durable active membership transition. */
async function activeLocalParticipant(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  role = 'worker',
  displayName = 'Worktree worker',
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

/** Persist a local Session binding for one idle activation. */
async function bindIdle(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  participant: ParticipantSnapshot,
  sessionId: SessionId,
): Promise<ActivationBindingSnapshot> {
  const state = await ctx.teams.getTeam({ teamId })
  const binding: ActivationBindingSnapshot = {
    activation: {
      id: activationIdSchema.parse(`worktree-workspace-${participant.id}`),
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

/** Create and assign one current `worktree` task to the exact durable activation. */
async function assignedTask(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  participant: ParticipantSnapshot,
  binding: ActivationBindingSnapshot,
): Promise<TeamTaskSnapshot> {
  const coordinator = await activeLocalParticipant(ctx, teamId, 'coordinator', 'Worktree coordinator')
  const coordinatorBinding = await bindIdle(
    ctx,
    teamId,
    coordinator,
    SessionId(`worktree-workspace-coordinator-${coordinator.id}`),
  )
  const actor = ctx.teams.openActivationActorProofIssuer().issue(coordinatorBinding).proof
  let state = await ctx.teams.getTeam({ teamId })
  const task = await ctx.teams.createTask({
    actor,
    teamId,
    expectedCursor: state.team.cursor,
    createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`worktree-workspace:${teamId}`) },
    subject: 'Use an isolated worktree',
    description: 'Run against a detached checkout created from the configured Git base.',
    blockedBy: [],
    requiredCapabilities: [],
    priority: 0,
    readScopes: [],
    writeScopes: [],
    workspaceMode: 'worktree',
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

describe('worktree Team workspace composition', () => {
  it('uses a real Hub lease and local Agent, then releases an accepted detached worktree after HMR unregistration', async () => {
    const stateRoot = await freshRoot('team-workspace-worktree-state-')
    const checkoutRoot = await freshRoot('team-workspace-worktree-checkout-')
    const allocationParent = join(checkoutRoot, 'allocations')
    await mkdir(allocationParent)
    const ctx = new Context()
    contexts.add(ctx)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalSubprocessRuntime)
    const subprocess = ctx.subprocess as LocalSubprocessRuntime
    subprocess.internals.spillDir = checkoutRoot
    const repoRoot = await repository(ctx, checkoutRoot)
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: stateRoot })
    await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
    await ctx.plugin(TeamHub)
    await ctx.plugin(TeamWorkspaceRegistry)
    const providerFiber = await ctx.plugin(WorktreeWorkspace, {
      providerName: 'composition-worktree',
      repoRoot,
      allocationParent,
      baseRef: 'HEAD',
      gitExecutable: 'git',
      processGraceMs: 100,
      commandTimeoutMs: 1_000,
      outputMaxBytes: 16 * 1024,
    })

    const workerSession = SessionId('worktree-workspace-composition-session')
    ctx.agents.register(localAgent(workerSession, repoRoot))
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Allocate isolated work.', budgets: {} }, rules: {}, budgets: {} })
    const participant = await activeLocalParticipant(ctx, created.team.id)
    const binding = await bindIdle(ctx, created.team.id, participant, workerSession)
    const task = await assignedTask(ctx, created.team.id, participant, binding)
    if (task.lease === undefined) throw new Error('Team Hub did not retain a task lease')

    await expect(ctx.teamWorkspaces.eligible('worktree', { task, binding })).resolves.toBe(true)
    const request = {
      teamId: created.team.id,
      taskId: task.id,
      attemptId: task.lease.attemptId,
      assignedRevision: task.lease.assignedRevision,
      participantId: participant.id,
      activationId: binding.activation.id,
      sessionId: workerSession,
    }
    const preparation = await ctx.teamWorkspaces.prepare('worktree', request)
    const allocation = await ctx.teamWorkspaces.materialize('worktree', request, preparation)
    expect((await git(ctx, allocation.root, ['rev-parse', '--show-toplevel'])).trim()).toBe(allocation.root)

    await providerFiber.dispose()
    expect(() => ctx.teamWorkspaces.resolve('worktree')).toThrow(/No Team workspace provider/)
    await allocation.release()
    await expect(stat(allocation.root)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
