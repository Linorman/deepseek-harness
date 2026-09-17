import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { acknowledgeTestChannelActivations, closeTestChannel, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import {
  activationIdSchema,
  teamTaskCreateIdempotencyKeySchema,
} from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
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
import * as TeamChannelBasic from '@clocky/clocky-team-channel-basic'
import * as TeamChannelDirect from '@clocky/clocky-team-channel-direct'
import * as TeamChannelTaskAssignment from '@clocky/clocky-team-channel-task-assignment'
import TeamChannelAdmission from '@clocky/clocky-team-channel-admission'
import TeamWorkspaceRegistry from '@clocky/clocky-team-workspace'
import type { TeamWorkspaceProvider } from '@clocky/clocky-team-workspace'
import * as TeamSchedulerDag from '../src/index.ts'
import type { Config } from '../src/index.ts'

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
  if (failures.length > 0) throw new AggregateError(failures, 'Team scheduler composition cleanup failed')
})

/** Return a fully explicit scheduler configuration for real Team-Hub composition. */
function config(overrides: Partial<Config> = {}): Config {
  return {
    leaseDurationMs: 1_000,
    maxAssignmentsPerDrive: 1,
    maxExpirationsPerDrive: 2,
    maxWakeDispatchesPerDrive: 2,
    maxConflictsPerDrive: 2,
    maxActiveAttemptsPerParticipant: 1,
    permittedWorkspaceModes: ['shared'],
    disposalTimeoutMs: 100,
    ...overrides,
  }
}

/** Compose the real JSON Team Hub without an Agent, Link, or channel Consumer. */
async function setup(storageRoot?: string, workspaceAvailable = true): Promise<Context> {
  const root = storageRoot ?? await freshRoot()
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(TeamChannelAdmission)
  await ctx.plugin(TeamChannelTaskAssignment)
  await ctx.plugin(TeamWorkspaceRegistry)
  const waitUntilActive = ctx.teamChannelAdmission.waitUntilActive.bind(ctx.teamChannelAdmission)
  vi.spyOn(ctx.teamChannelAdmission, 'waitUntilActive').mockImplementation(async (input) => {
    await acknowledgeTestChannelActivations(ctx, input.channelId)
    return await waitUntilActive(input)
  })
  if (workspaceAvailable) ctx.teamWorkspaces.registerProvider(workspaceProvider)
  return ctx
}

/** Test-only shared workspace provider: selection may query it but never allocates through it. */
const workspaceProvider: TeamWorkspaceProvider = {
  name: 'scheduler-test-workspace',
  modes: ['shared'],
  async eligible() { return true },
  async prepare() { throw new Error('scheduler must not prepare a workspace') },
  async restore() { throw new Error('scheduler must not restore a workspace') },
  async reconcileRelease() { throw new Error('scheduler must not reconcile a workspace') },
}

/** Allocate durable test data under the repository workspace. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-scheduler-dag-'))
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

/** Invite and activate one local agent participant with immutable capabilities. */
async function activeParticipant(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  displayName: string,
  capabilities: readonly string[],
  role = 'worker',
): Promise<ParticipantSnapshot> {
  let state = await ctx.teams.getTeam({ teamId })
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId,
    expectedCursor: state.team.cursor,
    kind: 'local-agent',
    displayName,
    role,
    capabilities,
  })
  state = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId })
  return await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'active',
  })
}

/** Persist an idle local activation binding that can own a scheduler lease. */
async function bindIdle(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  participant: ParticipantSnapshot,
): Promise<ActivationBindingSnapshot> {
  const state = await ctx.teams.getTeam({ teamId })
  const binding: ActivationBindingSnapshot = {
    activation: {
      id: activationIdSchema.parse(`activation-${participant.id}`),
      teamId,
      participantId: participant.id,
      status: 'idle',
    },
    sessionId: SessionId(`session-${participant.id}`),
    provider: 'test',
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

/** Create one shared-workspace pending task from the Team's latest journal cursor. */
async function createTask(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  subject: string,
  overrides: Partial<Pick<TeamTaskSnapshot, 'priority' | 'requiredCapabilities' | 'writeScopes' | 'reviewPolicy' | 'blockedBy' | 'maxAttempts'>> = {},
): Promise<TeamTaskSnapshot> {
  const coordinator = await activeParticipant(ctx, teamId, 'Task coordinator', [], 'coordinator')
  let state = await ctx.teams.getTeam({ teamId })
  const binding = await bindIdle(ctx, teamId, coordinator)
  const actor = ctx.teams.openActivationActorProofIssuer().issue(binding).proof
  state = await ctx.teams.getTeam({ teamId })
  const task = await ctx.teams.createTask({
    actor,
    teamId,
    expectedCursor: state.team.cursor,
    createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`scheduler-composition:${subject}`) },
    subject,
    description: `Execute ${subject}.`,
    blockedBy: [],
    requiredCapabilities: [],
    priority: 0,
    readScopes: [],
    writeScopes: [],
    workspaceMode: 'shared',
    budget: {},
    reviewPolicy: { kind: 'none' },
    maxAttempts: 3,
    ...overrides,
  })
  state = await ctx.teams.getTeam({ teamId })
  const statusInput = {
    teamId,
    activationId: binding.activation.id,
    expectedCursor: state.team.cursor,
    status: 'offline' as const,
  }
  await withActivationProof(ctx, {
    kind: 'activation-controller-status',
    participantId: coordinator.id,
    sessionId: binding.sessionId,
    provider: binding.provider,
    ...statusInput,
  }, async statusActor => await ctx.teams.updateActivationStatus({ actor: statusActor, ...statusInput }))
  return task
}

describe('Team DAG scheduler composition', () => {
  it('preserves pending work across absent-provider retries and assigns once after provider registration', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 1, max: 5 }),
      fc.integer({ min: 1, max: 3 }),
      async (absentDrives, readyDrives) => {
        const root = await freshRoot()
        const ctx = await setup(root, false)
        const created = await createTestRootTeam(ctx, { goal: { objective: 'Recover workspace admission.', budgets: {} }, rules: {}, budgets: {} })
        const worker = await activeParticipant(ctx, created.team.id, 'Worker', ['implement'])
        await bindIdle(ctx, created.team.id, worker)
        const task = await createTask(ctx, created.team.id, 'Recoverable work', { requiredCapabilities: ['implement'] })
        const baseline = await ctx.teams.getTeam({ teamId: created.team.id })
        const scheduler = new TeamSchedulerDag.TeamDagScheduler(ctx, config())
        const disposers = [
          ctx.teams.registerSystemEnvelopePostProofSource(scheduler.envelopePostProofSource),
          ctx.teams.registerSystemTaskReviewProofSource(scheduler.taskReviewProofSource),
          ctx.teams.registerSystemPhaseProofSource(scheduler.phaseProofSource),
          ctx.teams.registerSystemTaskLeaseProofSource(scheduler.taskLeaseProofSource),
          ctx.teams.registerSystemSchedulerChannelProofSource(scheduler.schedulerChannelProofSource),
        ]
        try {
          for (let count = 0; count < absentDrives; count++) {
            await expect(scheduler.drive({ teamId: created.team.id })).rejects.toMatchObject({ code: 'TEAM_WORKSPACE_MODE_UNAVAILABLE' })
            expect(await ctx.teams.getTeam({ teamId: created.team.id })).toEqual(baseline)
          }
          disposers.push(ctx.teamWorkspaces.registerProvider(workspaceProvider))
          for (let count = 0; count < readyDrives; count++) await scheduler.drive({ teamId: created.team.id })
          const assigned = await ctx.teams.getTask({ teamId: created.team.id, taskId: task.id })
          expect(assigned).toMatchObject({ phase: 'assigned', attemptCount: 1, lease: { participantId: worker.id } })
          const current = await ctx.teams.getTeam({ teamId: created.team.id })
          expect(current.channelIds).toHaveLength(1)
          const rows = await ctx.teams.readChannel({ channelId: current.channelIds[0]!, afterCursor: -1 })
          const envelopes = rows.records.filter(row => row.type === 'channel/envelope')
          expect(envelopes).toHaveLength(1)
          expect(envelopes[0]?.envelope).toMatchObject({ taskId: task.id,
            payload: { taskId: task.id, attemptId: assigned.lease!.attemptId } })
          await scheduler.close()
          await ctx.fiber.dispose()
          contexts.delete(ctx)
          const restored = await setup(root, false)
          try {
            expect(await restored.teams.getTask({ teamId: created.team.id, taskId: task.id })).toEqual(assigned)
            expect(await restored.teams.readChannel({ channelId: current.channelIds[0]!, afterCursor: -1 })).toEqual(rows)
          } finally {
            await restored.fiber.dispose()
            contexts.delete(restored)
          }
        } finally {
          await scheduler.close()
          for (const dispose of disposers.reverse()) dispose()
          await ctx.fiber.dispose()
          contexts.delete(ctx)
        }
      },
    ), { seed: 20260916, numRuns: 20 })
  })

  it.each(['capable', 'wrong-capability', 'unavailable-workspace', 'closing'] as const)('distinguishes a temporarily busy owner from unavailable work (%s)', async (kind) => {
    const ctx = await setup()
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Wait for a usable busy owner.', budgets: {} }, rules: {}, budgets: {} })
    const worker = await activeParticipant(ctx, created.team.id, 'Worker', kind === 'wrong-capability' ? ['review'] : ['implement'])
    const binding = await bindIdle(ctx, created.team.id, worker)
    const task = await createTask(ctx, created.team.id, 'Queued work', { requiredCapabilities: ['implement'] })
    const updateStatus = async (status: 'running' | 'idle') => {
      const state = await ctx.teams.getTeam({ teamId: created.team.id })
      const input = { teamId: created.team.id, activationId: binding.activation.id,
        expectedCursor: state.team.cursor, status }
      await withActivationProof(ctx, { kind: 'activation-controller-status', ...input,
        participantId: worker.id, sessionId: binding.sessionId, provider: binding.provider },
      async proof => await ctx.teams.updateActivationStatus({ actor: proof, ...input }))
    }
    await updateStatus('running')
    if (kind === 'unavailable-workspace') vi.spyOn(ctx.teamWorkspaces, 'eligible').mockResolvedValue(false)
    const eligibility = kind === 'closing'
      ? { started: Promise.withResolvers<undefined>(), result: Promise.withResolvers<boolean>() } : undefined
    if (eligibility !== undefined) vi.spyOn(ctx.teamWorkspaces, 'eligible').mockImplementation(async () => {
      eligibility.started.resolve(undefined)
      return await eligibility.result.promise
    })
    const scheduler = new TeamSchedulerDag.TeamDagScheduler(ctx, config({ stallAfterUnassignableDrives: 1 }))
    const disposers = [
      ctx.teams.registerSystemEnvelopePostProofSource(scheduler.envelopePostProofSource),
      ctx.teams.registerSystemTaskReviewProofSource(scheduler.taskReviewProofSource),
      ctx.teams.registerSystemPhaseProofSource(scheduler.phaseProofSource),
      ctx.teams.registerSystemTaskLeaseProofSource(scheduler.taskLeaseProofSource),
      ctx.teams.registerSystemSchedulerChannelProofSource(scheduler.schedulerChannelProofSource),
    ]
    try {
      if (eligibility !== undefined) {
        const drive = scheduler.drive({ teamId: created.team.id })
        await eligibility.started.promise
        const closing = scheduler.close()
        eligibility.result.resolve(false)
        await Promise.all([drive, closing])
        expect((await ctx.teams.getTeam({ teamId: created.team.id })).team.phase).toBe('active')
        expect((await ctx.teams.getTask({ teamId: created.team.id, taskId: task.id })).phase).toBe('pending')
        return
      }
      await scheduler.drive({ teamId: created.team.id })
      if (kind !== 'capable') {
        expect((await ctx.teams.getTeam({ teamId: created.team.id })).team).toMatchObject({
          phase: 'stalled', stallReason: { code: 'TASK_NO_ELIGIBLE_OWNER' },
        })
        return
      }
      await scheduler.drive({ teamId: created.team.id })
      expect((await ctx.teams.getTeam({ teamId: created.team.id })).team.phase).toBe('active')
      expect((await ctx.teams.getTask({ teamId: created.team.id, taskId: task.id })).phase).toBe('pending')
      await updateStatus('idle')
      await scheduler.drive({ teamId: created.team.id })
      expect(await ctx.teams.getTask({ teamId: created.team.id, taskId: task.id })).toMatchObject({
        phase: 'assigned', lease: { participantId: worker.id },
      })
    } finally {
      await scheduler.close()
      for (const dispose of disposers.reverse()) dispose()
    }
  })

  it('advances bounded channel retention past a prefix compacted by an earlier drive', async () => {
    const ctx = await setup()
    await ctx.plugin(TeamChannelDirect)
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Retain each terminal channel fairly.', budgets: {} }, rules: {}, budgets: {} })
    const worker = await activeParticipant(ctx, created.team.id, 'Worker', [])
    const recipient = await activeParticipant(ctx, created.team.id, 'Recipient', [])
    const binding = await bindIdle(ctx, created.team.id, worker)
    const recipientBinding = await bindIdle(ctx, created.team.id, recipient)
    const issuer = ctx.teams.openActivationActorProofIssuer()
    const actor = issuer.issue(binding)
    const recipientActor = issuer.issue(recipientBinding)
    const channels = []
    for (let index = 0; index < 2; index += 1) {
      const state = await ctx.teams.getTeam({ teamId: created.team.id })
      let channel = await openTestChannel(ctx, { teamId: created.team.id, expectedCursor: state.team.cursor,
        adapter: { type: 'direct', version: 1 },
        participants: [{ id: worker.id, role: 'worker' }, { id: recipient.id, role: 'worker' }], limits: {} })
      await acknowledgeTestChannelActivations(ctx, channel.manifest.id)
      channel = await ctx.teams.getChannel({ channelId: channel.manifest.id })
      for (const text of ['one', 'two', 'three']) {
        const envelope = await ctx.teams.postChannelEnvelope({ actor: actor.proof, expectedCursor: channel.cursor,
          draft: { channelId: channel.manifest.id, audience: [recipient.id], kind: 'message', payload: { text }, delivery: 'context' } })
        channel = await ctx.teams.getChannel({ channelId: channel.manifest.id })
        await ctx.teams.ackChannelEnvelope({ actor: recipientActor.proof, channelId: channel.manifest.id,
          envelopeId: envelope.id, expectedCursor: channel.cursor })
        channel = await ctx.teams.getChannel({ channelId: channel.manifest.id })
      }
      channels.push(await closeTestChannel(ctx, { channelId: channel.manifest.id, expectedCursor: channel.cursor }))
    }
    const compactChannel = vi.spyOn(ctx.teams, 'compactChannel')
    const scheduler = new TeamSchedulerDag.TeamDagScheduler(ctx, config({
      terminalChannelRetentionTail: 2, maxCompactionsPerDrive: 1,
    }))
    const disposers = [
      ctx.teams.registerSystemSchedulerChannelProofSource(scheduler.schedulerChannelProofSource),
      ctx.teams.registerSystemMaintenanceProofSource(scheduler.maintenanceProofSource),
    ]
    try {
      for (const channel of channels) {
        await scheduler.drive({ teamId: created.team.id })
        const retained = await ctx.teams.getChannel({ channelId: channel.manifest.id })
        expect(retained.firstCursor, JSON.stringify({ channelIndex: channels.indexOf(channel),
          compactedIds: compactChannel.mock.calls.map(([request]) => request.channelId) })).toBe(channel.cursor - 2)
      }
      expect(compactChannel.mock.calls.map(([request]) => request.channelId)).toEqual(channels.map(channel => channel.manifest.id))
      await scheduler.drive({ teamId: created.team.id })
      expect(compactChannel).toHaveBeenCalledTimes(2)
    } finally {
      await scheduler.close()
      for (const dispose of disposers.reverse()) dispose()
      recipientActor.revoke()
      actor.revoke()
      issuer.close()
    }
  })

  it('assigns active Team work without requesting Team-journal compaction', async () => {
    const ctx = await setup()
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Retain terminal history without stopping work.', budgets: {} }, rules: {}, budgets: {} })
    const worker = await activeParticipant(ctx, created.team.id, 'Worker', ['implement'])
    await bindIdle(ctx, created.team.id, worker)
    const task = await createTask(ctx, created.team.id, 'Active work with retention', { requiredCapabilities: ['implement'] })
    const compactTeam = vi.spyOn(ctx.teams, 'compactTeam')
    const scheduler = new TeamSchedulerDag.TeamDagScheduler(ctx, config({
      terminalChannelRetentionTail: 2, maxCompactionsPerDrive: 2,
    }))
    const disposers = [
      ctx.teams.registerSystemEnvelopePostProofSource(scheduler.envelopePostProofSource),
      ctx.teams.registerSystemTaskReviewProofSource(scheduler.taskReviewProofSource),
      ctx.teams.registerSystemPhaseProofSource(scheduler.phaseProofSource),
      ctx.teams.registerSystemTaskLeaseProofSource(scheduler.taskLeaseProofSource),
      ctx.teams.registerSystemSchedulerChannelProofSource(scheduler.schedulerChannelProofSource),
      ctx.teams.registerSystemMaintenanceProofSource(scheduler.maintenanceProofSource),
    ]
    try {
      await expect(scheduler.drive({ teamId: created.team.id })).resolves.toBeUndefined()
      expect(compactTeam).not.toHaveBeenCalled()
      const state = await ctx.teams.getTeam({ teamId: created.team.id })
      expect(state.team.phase).toBe('active')
      expect(state.tasks.find(item => item.id === task.id)).toMatchObject({
        phase: 'assigned', lease: { participantId: worker.id },
      })
    } finally {
      await scheduler.close()
      for (const dispose of disposers.reverse()) dispose()
    }
  })

  it('starts a new unassignable-work interval after a running task settles', async () => {
    const ctx = await setup()
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Reset stalled diagnosis after progress.', budgets: {} }, rules: {}, budgets: {} })
    const worker = await activeParticipant(ctx, created.team.id, 'Worker', ['implement'])
    const binding = await bindIdle(ctx, created.team.id, worker)
    await createTask(ctx, created.team.id, 'Unavailable work', { requiredCapabilities: ['unavailable'] })
    const scheduler = new TeamSchedulerDag.TeamDagScheduler(ctx, config({ stallAfterUnassignableDrives: 3 }))
    const unregister = ctx.teams.registerSystemPhaseProofSource(scheduler.phaseProofSource)
    const issuer = ctx.teams.openActivationActorProofIssuer()
    const actor = issuer.issue(binding)
    try {
      await scheduler.drive({ teamId: created.team.id })
      await scheduler.drive({ teamId: created.team.id })
      expect((await ctx.teams.getTeam({ teamId: created.team.id })).team.phase).toBe('active')

      const task = await createTask(ctx, created.team.id, 'Work that progresses', { requiredCapabilities: ['implement'] })
      const assigned = await assignSchedulerTask(ctx, {
        teamId: created.team.id, taskId: task.id, expectedRevision: task.revision,
        participantId: worker.id, activationId: binding.activation.id, leaseDurationMs: 100_000,
      })
      if (assigned.lease === undefined) throw new Error('progressing task has no lease')
      const running = await ctx.teams.startTaskAttempt({ actor: actor.proof, taskId: task.id,
        expectedRevision: assigned.revision, attemptId: assigned.lease.attemptId })
      await scheduler.drive({ teamId: created.team.id })
      expect((await ctx.teams.getTeam({ teamId: created.team.id })).team.phase).toBe('active')

      await ctx.teams.settleTaskAttempt({ actor: actor.proof, taskId: task.id,
        expectedRevision: running.revision, attemptId: assigned.lease.attemptId,
        outcome: { kind: 'completed', result: { summary: 'Independent work completed.' } } })
      await scheduler.drive({ teamId: created.team.id })
      await scheduler.drive({ teamId: created.team.id })
      expect((await ctx.teams.getTeam({ teamId: created.team.id })).team.phase).toBe('active')
      await scheduler.drive({ teamId: created.team.id })
      expect((await ctx.teams.getTeam({ teamId: created.team.id })).team).toMatchObject({
        phase: 'stalled', stallReason: { code: 'TASK_NO_ELIGIBLE_OWNER' },
      })
    } finally {
      await scheduler.close()
      unregister()
      actor.revoke()
      issuer.close()
    }
  })

  it.each(['running', 'review', 'missing-reviewer', 'failed'] as const)('distinguishes live prerequisite work from an unavailable owner or failed dependency (%s)', async (phase) => {
    const ctx = await setup()
    await ctx.plugin(TeamChannelBasic)
    await ctx.plugin(TeamChannelDirect)
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Wait for live prerequisite work.', budgets: {} }, rules: {}, budgets: {} })
    const worker = await activeParticipant(ctx, created.team.id, 'Worker', ['implement'])
    const reviewer = await activeParticipant(ctx, created.team.id, 'Reviewer', ['review'], 'reviewer')
    const workerBinding = await bindIdle(ctx, created.team.id, worker)
    const reviewerBinding = phase === 'missing-reviewer' ? undefined : await bindIdle(ctx, created.team.id, reviewer)
    const task = await createTask(ctx, created.team.id, 'Live prerequisite', {
      requiredCapabilities: ['implement'], reviewPolicy: { kind: 'participant', reviewerId: reviewer.id }, maxAttempts: 1,
    })
    const assigned = await assignSchedulerTask(ctx, {
      teamId: created.team.id, taskId: task.id, expectedRevision: task.revision,
      participantId: worker.id, activationId: workerBinding.activation.id, leaseDurationMs: 100_000,
    })
    if (assigned.lease === undefined) throw new Error('prerequisite task has no lease')
    const issuer = ctx.teams.openActivationActorProofIssuer()
    const actor = issuer.issue(workerBinding)
    const scheduler = new TeamSchedulerDag.TeamDagScheduler(ctx, config({ stallAfterUnassignableDrives: 1 }))
    const disposers = [
      ctx.teams.registerSystemEnvelopePostProofSource(scheduler.envelopePostProofSource),
      ctx.teams.registerSystemTaskReviewProofSource(scheduler.taskReviewProofSource),
      ctx.teams.registerSystemPhaseProofSource(scheduler.phaseProofSource),
      ctx.teams.registerSystemTaskLeaseProofSource(scheduler.taskLeaseProofSource),
      ctx.teams.registerSystemSchedulerChannelProofSource(scheduler.schedulerChannelProofSource),
    ]
    try {
      const running = await ctx.teams.startTaskAttempt({ actor: actor.proof, taskId: task.id,
        expectedRevision: assigned.revision, attemptId: assigned.lease.attemptId })
      if (phase !== 'running') {
        await ctx.teams.settleTaskAttempt({ actor: actor.proof, taskId: task.id,
          expectedRevision: running.revision, attemptId: assigned.lease.attemptId,
          outcome: phase === 'failed'
            ? { kind: 'failed', failure: { code: 'PREREQUISITE_FAILED', message: 'The prerequisite cannot complete.' } }
            : { kind: 'completed', result: { summary: 'Ready for the live reviewer.' } } })
      }
      await scheduler.drive({ teamId: created.team.id })
      if (phase === 'missing-reviewer') {
        const stalled = await ctx.teams.getTeam({ teamId: created.team.id })
        expect(stalled.team).toMatchObject({ phase: 'stalled', stallReason: { code: 'TASK_NO_ELIGIBLE_OWNER' } })
        expect(stalled.tasks.find(item => item.id === task.id)?.phase).toBe('review')
        return
      }
      if (phase === 'review') {
        if (reviewerBinding === undefined) throw new Error('live review fixture has no reviewer binding')
        const state = await ctx.teams.getTeam({ teamId: created.team.id })
        const input = { teamId: created.team.id, activationId: reviewerBinding.activation.id,
          expectedCursor: state.team.cursor, status: 'running' as const }
        await withActivationProof(ctx, { kind: 'activation-controller-status', ...input,
          participantId: reviewer.id, sessionId: reviewerBinding.sessionId, provider: reviewerBinding.provider },
        async proof => await ctx.teams.updateActivationStatus({ actor: proof, ...input }))
        await scheduler.drive({ teamId: created.team.id })
        expect((await ctx.teams.getTeam({ teamId: created.team.id })).team.phase).toBe('active')
      }
      const blocked = await createTask(ctx, created.team.id, 'Dependent work', {
        blockedBy: [task.id], requiredCapabilities: ['implement'],
      })
      await scheduler.drive({ teamId: created.team.id })
      const waiting = await ctx.teams.getTeam({ teamId: created.team.id })
      expect(waiting.team.phase).toBe(phase === 'failed' ? 'stalled' : 'active')
      if (phase === 'failed') expect(waiting.team.stallReason?.code).toBe('TASK_DEPENDENCY_DEADLOCK')
      expect(waiting.tasks.find(item => item.id === blocked.id)).toMatchObject({ phase: 'pending', blockedBy: [task.id] })
      expect(waiting.tasks.find(item => item.id === task.id)?.phase).toBe(phase)
    } finally {
      await scheduler.close()
      for (const dispose of disposers.reverse()) dispose()
      actor.revoke()
      issuer.close()
    }
  })

  it('reuses a persisted empty review channel after publication failure and Hub restart', async () => {
    const ctx = await setup()
    await ctx.plugin(TeamChannelBasic)
    await ctx.plugin(TeamChannelDirect)
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Review durable worker evidence.', budgets: {} }, rules: {}, budgets: {} })
    const worker = await activeParticipant(ctx, created.team.id, 'Worker', ['implement'])
    const reviewer = await activeParticipant(ctx, created.team.id, 'Reviewer', ['review'], 'reviewer')
    const workerBinding = await bindIdle(ctx, created.team.id, worker)
    await bindIdle(ctx, created.team.id, reviewer)
    const task = await createTask(ctx, created.team.id, 'Review implementation', {
      requiredCapabilities: ['implement'], reviewPolicy: { kind: 'participant', reviewerId: reviewer.id },
    })
    const assigned = await assignSchedulerTask(ctx, {
      teamId: created.team.id, taskId: task.id, expectedRevision: task.revision,
      participantId: worker.id, activationId: workerBinding.activation.id, leaseDurationMs: 100_000,
    })
    if (assigned.lease === undefined) throw new Error('worker task has no assigned attempt')
    const issuer = ctx.teams.openActivationActorProofIssuer()
    const workerActor = issuer.issue(workerBinding)
    const running = await ctx.teams.startTaskAttempt({ actor: workerActor.proof, taskId: task.id,
      expectedRevision: assigned.revision, attemptId: assigned.lease.attemptId })
    await ctx.teams.settleTaskAttempt({ actor: workerActor.proof, taskId: task.id,
      expectedRevision: running.revision, attemptId: assigned.lease.attemptId,
      outcome: { kind: 'completed', result: { summary: 'Review this result.' } } })
    workerActor.revoke()
    issuer.close()
    const drive = async (owner: Context, fail: boolean) => {
      const scheduler = new TeamSchedulerDag.TeamDagScheduler(owner, config())
      const disposers = [
        owner.teams.registerSystemEnvelopePostProofSource(scheduler.envelopePostProofSource),
        owner.teams.registerSystemTaskReviewProofSource(scheduler.taskReviewProofSource),
        owner.teams.registerSystemPhaseProofSource(scheduler.phaseProofSource),
        owner.teams.registerSystemTaskLeaseProofSource(scheduler.taskLeaseProofSource),
        owner.teams.registerSystemSchedulerChannelProofSource(scheduler.schedulerChannelProofSource),
      ]
      try {
        if (fail) {
          const post = vi.spyOn(owner.teams, 'postChannelEnvelope').mockRejectedValueOnce(new Error('temporary review write failure'))
          await expect(scheduler.drive({ teamId: created.team.id })).rejects.toThrow('temporary review write failure')
          post.mockRestore()
        } else await scheduler.drive({ teamId: created.team.id })
      } finally {
        await scheduler.close()
        for (const dispose of disposers.reverse()) dispose()
      }
    }
    await drive(ctx, true)
    const ids = (await ctx.teams.getTeam({ teamId: created.team.id })).channelIds
    expect(ids).toHaveLength(1)
    const channelId = ids[0]!
    expect((await ctx.teams.readChannel({ channelId, afterCursor: -1 })).records
      .filter(record => record.type === 'channel/envelope')).toHaveLength(0)
    const root = roots.at(-1)!
    await ctx.fiber.dispose()
    contexts.delete(ctx)
    const restored = await setup(root)
    await restored.plugin(TeamChannelBasic)
    await restored.plugin(TeamChannelDirect)
    await drive(restored, false)
    expect((await restored.teams.getTeam({ teamId: created.team.id })).channelIds).toEqual(ids)
    expect((await restored.teams.readChannel({ channelId, afterCursor: -1 })).records
      .filter(record => record.type === 'channel/envelope')).toHaveLength(1)
  })

  it.each(['accepted', 'rework'] as const)('opens a real review consult and settles the completed attempt from a %s response', async (decision) => {
    const ctx = await setup()
    await ctx.plugin(TeamChannelBasic)
    await ctx.plugin(TeamChannelDirect)
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Review durable worker evidence.', budgets: {} }, rules: {}, budgets: {} })
    const worker = await activeParticipant(ctx, created.team.id, 'Worker', ['implement'])
    const reviewer = await activeParticipant(ctx, created.team.id, 'Reviewer', ['review'], 'reviewer')
    const workerBinding = await bindIdle(ctx, created.team.id, worker)
    const reviewerBinding = await bindIdle(ctx, created.team.id, reviewer)
    const task = await createTask(ctx, created.team.id, 'Review implementation', {
      requiredCapabilities: ['implement'], reviewPolicy: { kind: 'participant', reviewerId: reviewer.id },
    })
    const assigned = await assignSchedulerTask(ctx, {
      teamId: created.team.id, taskId: task.id, expectedRevision: task.revision,
      participantId: worker.id, activationId: workerBinding.activation.id, leaseDurationMs: 100_000,
    })
    if (assigned.lease === undefined) throw new Error('worker task has no assigned attempt')
    const issuer = ctx.teams.openActivationActorProofIssuer()
    const workerActor = issuer.issue(workerBinding)
    const reviewerActor = issuer.issue(reviewerBinding)
    try {
      const running = await ctx.teams.startTaskAttempt({
        actor: workerActor.proof, taskId: task.id, expectedRevision: assigned.revision, attemptId: assigned.lease.attemptId,
      })
      const reviewing = await ctx.teams.settleTaskAttempt({
        actor: workerActor.proof, taskId: task.id, expectedRevision: running.revision, attemptId: assigned.lease.attemptId,
        outcome: { kind: 'completed', result: { summary: 'Implementation and its checks are ready.' } },
      })
      expect(reviewing.phase).toBe('review')
      await ctx.plugin(TeamSchedulerDag, config({ leaseDurationMs: 100_000 }))
      await vi.waitFor(async () => {
        expect((await ctx.teams.getTeam({ teamId: created.team.id })).channelIds).toHaveLength(1)
      })
      const state = await ctx.teams.getTeam({ teamId: created.team.id })
      const channelId = state.channelIds[0]
      if (channelId === undefined) throw new Error('scheduler did not attach the review channel')
      await vi.waitFor(async () => {
        const read = await ctx.teams.readChannel({ channelId, afterCursor: -1 })
        expect(read.records.filter(record => record.type === 'channel/envelope')).toHaveLength(1)
      })
      const read = await ctx.teams.readChannel({ channelId, afterCursor: -1 })
      const request = read.records.find(record => record.type === 'channel/envelope')
      if (request?.type !== 'channel/envelope') throw new Error('scheduler did not post its review request')
      expect(read.channel.manifest).toMatchObject({
        adapter: TeamChannelBasic.CONSULT_CHANNEL_ADAPTER,
        participants: [
          { id: worker.id, role: TeamChannelBasic.CONSULT_INITIATOR_ROLE },
          { id: reviewer.id, role: TeamChannelBasic.CONSULT_RESPONDENT_ROLE },
        ],
      })
      expect(TeamChannelBasic.parseConsultReviewAssignmentPayload(request.envelope.payload)).toMatchObject({
        taskId: task.id, attemptId: assigned.lease.attemptId, reviewRevision: reviewing.revision,
        reviewerId: reviewer.id, initiatorId: worker.id, result: { summary: 'Implementation and its checks are ready.' },
      })
      await ctx.teams.postChannelEnvelope({
        actor: reviewerActor.proof, expectedCursor: read.channel.cursor,
        draft: {
          channelId, audience: [worker.id], kind: TeamChannelBasic.CONSULT_RESPONSE_KIND, delivery: 'turn',
          causationId: request.envelope.id, taskId: task.id,
          payload: { text: decision === 'accepted' ? 'The completed attempt meets the requirements.' : 'Add evidence for the error case.', decision },
        },
      })
      await vi.waitFor(async () => {
        await expect(ctx.teams.getTask({ teamId: created.team.id, taskId: task.id })).resolves.toMatchObject({
          phase: decision === 'accepted' ? 'completed' : 'assigned',
          reviewHistory: [{ attemptId: assigned.lease?.attemptId, reviewerId: reviewer.id, nextPhase: decision === 'accepted' ? 'completed' : 'pending' }],
        })
      })
      const settled = await ctx.teams.getTask({ teamId: created.team.id, taskId: task.id })
      expect(settled.attemptHistory).toEqual(reviewing.attemptHistory)
      expect(settled.reviewHistory).toHaveLength(1)
      if (decision === 'rework') {
        expect(settled.lease?.participantId).toBe(worker.id)
        expect(settled.lease?.attemptId).not.toBe(assigned.lease.attemptId)
        const nextLease = settled.lease
        if (nextLease === undefined) throw new Error('rework task has no new attempt')
        const nextRunning = await ctx.teams.startTaskAttempt({ actor: workerActor.proof, taskId: task.id,
          expectedRevision: settled.revision, attemptId: nextLease.attemptId })
        await ctx.teams.settleTaskAttempt({ actor: workerActor.proof, taskId: task.id,
          expectedRevision: nextRunning.revision, attemptId: nextLease.attemptId,
          outcome: { kind: 'completed', result: { summary: 'Error-case evidence is now included.' } } })
        await vi.waitFor(async () => {
          const snapshot = await ctx.teams.getTeam({ teamId: created.team.id })
          const current = await Promise.all(snapshot.channelIds.map(id => ctx.teams.getChannel({ channelId: id })))
          expect(current.filter(channel => channel.manifest.adapter.type === TeamChannelBasic.CONSULT_CHANNEL_TYPE),
            JSON.stringify({ task: snapshot.tasks.find(candidate => candidate.id === task.id), activations: snapshot.activations }),
          ).toHaveLength(2)
        })
        const ids = (await ctx.teams.getTeam({ teamId: created.team.id })).channelIds
        const current = await Promise.all(ids.map(id => ctx.teams.getChannel({ channelId: id })))
        const nextChannel = current.find(channel => channel.manifest.adapter.type === TeamChannelBasic.CONSULT_CHANNEL_TYPE
          && channel.manifest.id !== channelId)
        if (nextChannel === undefined) throw new Error('rework completion has no fresh review channel')
        await vi.waitFor(async () => {
          const records = await ctx.teams.readChannel({ channelId: nextChannel.manifest.id, afterCursor: -1 })
          expect(records.records.some(record => record.type === 'channel/envelope'
            && record.envelope.kind === TeamChannelBasic.CONSULT_REVIEW_REQUEST_KIND)).toBe(true)
        })
        const nextRead = await ctx.teams.readChannel({ channelId: nextChannel.manifest.id, afterCursor: -1 })
        const nextRequest = nextRead.records.find(record => record.type === 'channel/envelope'
          && record.envelope.kind === TeamChannelBasic.CONSULT_REVIEW_REQUEST_KIND)
        if (nextRequest?.type !== 'channel/envelope') throw new Error('second review request is absent')
        expect(TeamChannelBasic.parseConsultReviewAssignmentPayload(nextRequest.envelope.payload).attemptId).toBe(nextLease.attemptId)
        await ctx.teams.postChannelEnvelope({ actor: reviewerActor.proof, expectedCursor: nextRead.channel.cursor,
          draft: { channelId: nextChannel.manifest.id, audience: [worker.id], kind: TeamChannelBasic.CONSULT_RESPONSE_KIND,
            delivery: 'turn', causationId: nextRequest.envelope.id, taskId: task.id,
            payload: { text: 'The second attempt satisfies the review.', decision: 'accepted' } } })
        await vi.waitFor(async () => {
          const finished = await ctx.teams.getTask({ teamId: created.team.id, taskId: task.id })
          expect(finished.phase).toBe('completed')
          expect(finished.reviewHistory.map(review => [review.attemptId, review.nextPhase])).toEqual([
            [assigned.lease?.attemptId, 'pending'], [nextLease.attemptId, 'completed'],
          ])
        })
      }
      const channels = await Promise.all((await ctx.teams.getTeam({ teamId: created.team.id })).channelIds
        .map(id => ctx.teams.getChannel({ channelId: id })))
      expect(channels.filter(channel => channel.manifest.adapter.type === TeamChannelBasic.CONSULT_CHANNEL_TYPE)
        .map(channel => channel.manifest.id)).toHaveLength(decision === 'rework' ? 2 : 1)
    } finally { workerActor.revoke(); reviewerActor.revoke(); issuer.close() }
  })

  it('uses only the real Team Hub to assign the highest-priority task to an exact idle capability match', async () => {
    const ctx = await setup()
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Schedule real durable work.', budgets: {} }, rules: {}, budgets: {} })
    const broad = await activeParticipant(ctx, created.team.id, 'Broad worker', ['lint', 'test'])
    const exact = await activeParticipant(ctx, created.team.id, 'Exact worker', ['lint'])
    await bindIdle(ctx, created.team.id, broad)
    await bindIdle(ctx, created.team.id, exact)
    const first = await createTask(ctx, created.team.id, 'First creation', {
      priority: 1,
      requiredCapabilities: ['lint'],
    })
    const high = await createTask(ctx, created.team.id, 'Highest priority', {
      priority: 2,
      requiredCapabilities: ['lint'],
    })
    const notices: TeamSchedulerDag.TeamTaskAssignmentNotice[] = []
    ctx.on('team-scheduler/assigned', (notice) => { notices.push(notice) })

    await ctx.plugin(TeamSchedulerDag, config())

    await vi.waitFor(async () => {
      await expect(ctx.teams.getTask({ teamId: created.team.id, taskId: high.id })).resolves.toMatchObject({
        phase: 'assigned',
        lease: { participantId: exact.id },
      })
    })
    const assigned = await ctx.teams.getTask({ teamId: created.team.id, taskId: high.id })
    if (assigned.lease?.wakeChannelId === undefined) throw new Error('scheduler assignment did not retain a wake channel')
    // The lease precedes the channel append; this notification confirms both durable commits.
    await vi.waitFor(() => { expect(notices.some(notice => notice.task.id === high.id)).toBe(true) })
    const channel = await ctx.teams.getChannel({ channelId: assigned.lease.wakeChannelId })
    expect(channel.manifest).toMatchObject({
      adapter: TeamChannelTaskAssignment.TASK_ASSIGNMENT_CHANNEL_ADAPTER,
      participants: [{ id: exact.id, role: TeamChannelTaskAssignment.TASK_ASSIGNMENT_ASSIGNEE_ROLE }],
      limits: { taskId: high.id, activationId: `activation-${exact.id}`, sessionId: `session-${exact.id}` },
    })
    const read = await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
    const envelope = read.records.find(record => record.type === 'channel/envelope')
    if (envelope?.type !== 'channel/envelope') throw new Error('scheduler did not append the assignment Envelope')
    expect(TeamChannelTaskAssignment.parseTaskAssignmentEnvelope(channel.manifest, envelope.envelope)).toMatchObject({
      taskId: high.id,
      attemptId: assigned.lease.attemptId,
      assignedRevision: assigned.lease.assignedRevision,
      activationId: `activation-${exact.id}`,
      sessionId: `session-${exact.id}`,
      assigneeId: exact.id,
    })
    const firstState = await ctx.teams.getTask({ teamId: created.team.id, taskId: first.id })
    expect(['pending', 'assigned']).toContain(firstState.phase)
    const highNotice = notices.find(notice => notice.task.id === high.id)
    if (highNotice === undefined) throw new Error('scheduler did not emit the high-priority assignment notice')
    expect(highNotice).toMatchObject({
      task: { id: high.id },
      activation: { activation: { id: `activation-${exact.id}` } },
      channel: { manifest: { id: channel.manifest.id } },
      envelope: { envelopeId: envelope.envelope.id },
    })
  })

  it('repairs an assigned wake channel with no assignment Envelope without creating another channel or Envelope', async () => {
    const ctx = await setup()
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Recover a durable assignment turn.', budgets: {} }, rules: {}, budgets: {} })
    const worker = await activeParticipant(ctx, created.team.id, 'Recovery worker', [])
    const binding = await bindIdle(ctx, created.team.id, worker)
    const task = await createTask(ctx, created.team.id, 'Recovered assignment')
    let state = await ctx.teams.getTeam({ teamId: created.team.id })
    const channel = await openTestChannel(ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: TeamChannelTaskAssignment.TASK_ASSIGNMENT_CHANNEL_ADAPTER,
      participants: [{ id: worker.id, role: TeamChannelTaskAssignment.TASK_ASSIGNMENT_ASSIGNEE_ROLE }],
      limits: { taskId: task.id, activationId: binding.activation.id, sessionId: binding.sessionId },
    })
    await acknowledgeTestChannelActivations(ctx, channel.manifest.id)
    const assigned = await assignSchedulerTask(ctx, {
      teamId: created.team.id,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: worker.id,
      activationId: binding.activation.id,
      wakeChannelId: channel.manifest.id,
      leaseDurationMs: 100_000,
    })
    if (assigned.lease === undefined) throw new Error('manual assignment did not retain its lease')
    await vi.waitFor(async () => {
      const read = await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
      expect(read.records.filter(record => record.type === 'channel/envelope')).toHaveLength(0)
    })

    await ctx.plugin(TeamSchedulerDag, config({ maxAssignmentsPerDrive: 1, maxWakeDispatchesPerDrive: 1 }))

    await vi.waitFor(async () => {
      const read = await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
      expect(read.records.filter(record => record.type === 'channel/envelope')).toHaveLength(1)
    })
    const repaired = await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
    const record = repaired.records.find(item => item.type === 'channel/envelope')
    if (record?.type !== 'channel/envelope') throw new Error('recovery did not retain its assignment Envelope')
    expect(TeamChannelTaskAssignment.parseTaskAssignmentEnvelope(channel.manifest, record.envelope)).toMatchObject({
      taskId: task.id,
      attemptId: assigned.lease.attemptId,
      assignedRevision: assigned.lease.assignedRevision,
      activationId: binding.activation.id,
      sessionId: binding.sessionId,
    })

    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const runningInput = {
      teamId: created.team.id,
      activationId: binding.activation.id,
      expectedCursor: state.team.cursor,
      status: 'running' as const,
    }
    await withActivationProof(ctx, {
      kind: 'activation-controller-status',
      ...runningInput,
      participantId: binding.activation.participantId,
      sessionId: binding.sessionId,
      provider: binding.provider,
    }, async actor => await ctx.teams.updateActivationStatus({ actor, ...runningInput }))
    await vi.waitFor(async () => {
      const read = await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
      expect(read.records.filter(item => item.type === 'channel/envelope')).toHaveLength(1)
    })
  })

  it('records real lease expiry before any later scheduler retry and never wakes an Agent directly', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const ctx = await setup()
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Expire an abandoned lease.', budgets: {} }, rules: {}, budgets: {} })
    const worker = await activeParticipant(ctx, created.team.id, 'Worker', [])
    const binding = await bindIdle(ctx, created.team.id, worker)
    const abandoned = await createTask(ctx, created.team.id, 'Abandoned task')
    let state = await ctx.teams.getTeam({ teamId: created.team.id })
    const assigned = await assignSchedulerTask(ctx, {
      teamId: created.team.id,
      taskId: abandoned.id,
      expectedRevision: abandoned.revision,
      participantId: worker.id,
      activationId: binding.activation.id,
      leaseDurationMs: 10,
    })
    if (assigned.lease === undefined) throw new Error('real Team Hub did not retain the assigned lease')
    const attemptId = assigned.lease.attemptId
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const offlineInput = {
      teamId: created.team.id,
      activationId: binding.activation.id,
      expectedCursor: state.team.cursor,
      status: 'offline' as const,
    }
    await withActivationProof(ctx, {
      kind: 'activation-controller-status',
      ...offlineInput,
      participantId: binding.activation.participantId,
      sessionId: binding.sessionId,
      provider: binding.provider,
    }, async actor => await ctx.teams.updateActivationStatus({ actor, ...offlineInput }))
    await vi.advanceTimersByTimeAsync(10)

    await ctx.plugin(TeamSchedulerDag, config())

    await vi.waitFor(async () => {
      await expect(ctx.teams.getTask({ teamId: created.team.id, taskId: abandoned.id })).resolves.toMatchObject({
        phase: 'pending',
        revision: assigned.revision + 1,
        attemptHistory: [{ id: attemptId, outcome: { kind: 'lease-expired' } }],
      })
    })
  })
})
