import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import type { TeamWorkspaceProvider } from '@clocky/clocky-team-workspace'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import AgentRuntime, { AgentRuntimeTerminationUnconfirmedError } from '@clocky/clocky-agent-runtime'
import type { ActivationHandle } from '@clocky/clocky-agent-runtime'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import * as DirectChannel from '@clocky/clocky-team-channel-direct'
import { acknowledgeTestChannelActivations, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { SessionId } from '@clocky/clocky-session'
import { activationIdSchema, channelInvitationIdempotencyKeySchema, envelopeIdSchema, fingerprintChannelManifest, teamClosureIdempotencyKeySchema, teamIdSchema, teamTaskCreateIdempotencyKeySchema, teamWorkspaceAllocationIdSchema, channelIdSchema } from '@clocky/clocky-team'
import type { ActivationBindingSnapshot, ChannelId, ParticipantSnapshot, TeamClosureContinuationRequest, TeamId, TeamSystemActivationProof, TeamSystemActivationScope, TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope, TeamSystemClosureDriverProof, TeamSystemClosureDriverScope, TeamSystemClosureProof, TeamSystemClosureScope, TeamSystemWorkspaceAllocationProof, TeamSystemWorkspaceAllocationScope, TeamPhaseTransitionRequest, TeamSystemPhaseProof, TeamSystemPhaseScope, TeamSystemPhaseProofSource } from '@clocky/clocky-team'
import TeamWorkspaces from '@clocky/clocky-team-workspace'
import * as WorkspaceRecovery from '@clocky/clocky-team-workspace-recovery'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { assignTestTask } from '../../team-hub/tests/fixtures.ts'
import * as Controller from '../src/index.ts'
import type { TeamActivationLease } from '../src/index.ts'

const contexts = new Set<Context>()
const roots: string[] = []
const liveLeases = new Map<TeamId, TeamActivationLease>()
const channelAdmissionProofStores = new WeakMap<Context, WeakMap<TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope>>()

/** Issue one test-owned system-human endpoint proof for exact channel consent. */
function systemHumanAdmissionActor(
  ctx: Context,
  scope: TeamSystemChannelAdmissionScope,
): { readonly proof: TeamSystemChannelAdmissionProof; revoke(): void } {
  let proofs = channelAdmissionProofStores.get(ctx)
  if (proofs === undefined) {
    const sourceProofs = new WeakMap<TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope>()
    proofs = sourceProofs
    channelAdmissionProofStores.set(ctx, sourceProofs)
    ctx.teams.registerSystemChannelAdmissionProofSource({
      name: 'team-run',
      resolveChannelAdmissionProof: proof => sourceProofs.get(proof),
    })
  }
  const token: object = {}
  Object.defineProperty(token, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test system-human admission proofs are runtime-only') },
  })
  const proof = Object.freeze(token) as TeamSystemChannelAdmissionProof
  proofs.set(proof, scope)
  return Object.freeze({ proof, revoke: () => { proofs?.delete(proof) } })
}

/** Acknowledge one current system-owned human invitation through the TeamRun endpoint. */
async function acknowledgeSystemHumanChannel(
  ctx: Context,
  channelId: ChannelId,
  participantId: ParticipantSnapshot['id'],
): Promise<void> {
  const channel = await ctx.teams.getChannel({ channelId })
  const admission = await ctx.teams.getChannelAdmission({ channelId })
  const invitation = admission.invitations.find(item => item.participantId === participantId)
  if (invitation === undefined || invitation.status === 'acknowledged') return
  const idempotencyKey = channelInvitationIdempotencyKeySchema.parse(`closure-human-consent:${String(participantId)}`)
  const authority = systemHumanAdmissionActor(ctx, {
    kind: 'channel-invitation-acknowledge',
    teamId: channel.manifest.teamId,
    channelId,
    participantId,
    revision: invitation.revision,
    manifestFingerprint: fingerprintChannelManifest(channel.manifest),
    idempotencyKey,
  })
  try {
    await ctx.teams.acknowledgeChannelInvitation({
      actor: authority.proof,
      channelId,
      revision: invitation.revision,
      manifestFingerprint: fingerprintChannelManifest(channel.manifest),
      idempotencyKey,
    })
  } finally {
    authority.revoke()
  }
}
afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  liveLeases.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Reopen an actual journal with a fresh controller, so no old activation handles survive. */
async function setup(backend: 'json' | 'sqlite', root?: string) {
  if (root === undefined) {
    await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
    root = await mkdtemp(join(process.cwd(), '.tmp', 'closure-resources-'))
    roots.push(root)
  }
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'team.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(AgentRuntime)
  return { ctx, root, async close() { await ctx.fiber.dispose(); contexts.delete(ctx) } }
}

/** Retain a runtime proof only for one trusted fixture operation. */
async function activation(ctx: Context, binding: ActivationBindingSnapshot) {
  const controller = ctx.get('teamActivations')
  if (controller !== undefined) {
    const lease = await controller.activate({
      teamId: binding.activation.teamId, participantId: binding.activation.participantId,
      expectedCursor: (await ctx.teams.getTeam({ teamId: binding.activation.teamId })).team.cursor,
      provider: binding.provider, sessionId: binding.sessionId, seed: { kind: 'fresh' },
      agent: { options: {} }, signal: new AbortController().signal,
    })
    liveLeases.set(binding.activation.teamId, lease)
    return lease.binding
  }
  const proof = Object.freeze({}) as TeamSystemActivationProof
  const input = { binding, expectedCursor: (await ctx.teams.getTeam({ teamId: binding.activation.teamId })).team.cursor }
  const scope: TeamSystemActivationScope = { kind: 'activation-controller-bind', ...input }
  const unregister = ctx.teams.registerSystemActivationProofSource({ name: 'team-activation-controller',
    resolveActivationProof: value => value === proof ? scope : undefined })
  try { return await ctx.teams.bindActivation({ actor: proof, ...input }) } finally { unregister() }
}

/** Publish actual controller leases through a controllable external provider lifecycle. */
function liveProvider(ctx: Context, dispose: () => Promise<void>) {
  const subscriptions = new Map<TeamId, Set<(status: ActivationHandle['activation']) => void>>()
  const handles: ActivationHandle[] = []
  const interrupt = vi.fn()
  ctx.agentRuntimes.registerProvider({
    name: 'recovery-runtime',
    terminationMode: 'cooperative',
    async activate(request) {
      const listeners = new Set<(status: ActivationHandle['activation']) => void>()
      subscriptions.set(request.teamId, listeners)
      const activation = {
        id: activationIdSchema.parse(`live-${request.teamId}`), teamId: request.teamId,
        participantId: request.participant.id, status: 'running' as const,
      }
      const handle: ActivationHandle = {
        activation, sessionId: request.sessionId, localAgent: undefined,
        async health() { return activation },
        onStatus(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
        interrupt, dispose,
      }
      handles.push(handle)
      return handle
    },
  })
  return {
    handles, interrupt,
    offline(teamId = handles[0]?.activation.teamId) {
      const handle = handles.find(candidate => candidate.activation.teamId === teamId)
      if (handle === undefined) throw new Error('provider has not published an activation')
      for (const listener of subscriptions.get(handle.activation.teamId) ?? []) listener({ ...handle.activation, status: 'offline' })
    },
  }
}

/** Create a running attempt and optionally an active allocation before its owner disappears. */
async function seed(
  ctx: Context,
  kind: 'local-agent' | 'remote-agent',
  recoverable: boolean,
  workspace = false,
  closureKind: 'fail' | 'cancel' | 'none' = 'fail',
  wake = false,
) {
  const created = await createTestRootTeam(ctx,
    { goal: { objective: 'Settle an interrupted owner.',
      budgets: {} },
    rules: {},
    budgets: {} })
  const teamId = created.team.id
  const participant = await inviteBootstrapParticipant(ctx,
    { teamId,
      expectedCursor: created.team.cursor,
      kind,
      displayName: 'Coordinator',
      role: 'coordinator',
      capabilities: [] })
  for (const phase of ['provisioning', 'active'] as const) {
    await transitionBootstrapParticipant(ctx,
      { teamId,
        participantId: participant.id,
        expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
        phase })
  }
  const binding = await activation(ctx, {
    activation: { id: activationIdSchema.parse(`epoch-${teamId}`), teamId, participantId: participant.id, status: 'running' },
    sessionId: SessionId(`session-${teamId}`), provider: 'recovery-runtime',
    ...recoverable ? { recovery: {
      kind: 'sdk-local-cold-replace' as const, version: 1 as const, runtimeProvider: 'recovery-runtime', profile: 'closure',
      agent: { provider: 'test', model: 'test' }, process: { hostId: 'closure-host', pid: 123, started: 'exact-generation' },
    } } : {},
  })
  const issuer = ctx.teams.openActivationActorProofIssuer()
  const owner = issuer.issue(binding)
  const task = await ctx.teams.createTask({
    actor: owner.proof, teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`task-${teamId}`) },
    subject: 'Interrupted task',
    description: 'Retain completed work when its owner exits.',
    blockedBy: [],
    requiredCapabilities: [],
    priority: 0,
    readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 2,
  })
  let wakeChannelId: ChannelId | undefined
  if (wake) {
    const observer = await inviteBootstrapParticipant(ctx, {
      teamId: created.team.id, expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
      kind: 'human', displayName: 'Observer', role: 'human', capabilities: [], owner: { kind: 'system' },
    })
    for (const phase of ['provisioning', 'active'] as const) {
      await transitionBootstrapParticipant(ctx, {
        teamId: created.team.id, participantId: observer.id,
        expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor, phase,
      })
    }
    await ctx.plugin(DirectChannel)
    const channel = await openTestChannel(ctx, {
      teamId: created.team.id, expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
      adapter: { type: 'direct', version: 3 },
      participants: [{ id: participant.id, role: 'coordinator' }, { id: observer.id, role: 'human' }], limits: {},
    })
    await acknowledgeTestChannelActivations(ctx, channel.manifest.id)
    await acknowledgeSystemHumanChannel(ctx, channel.manifest.id, observer.id)
    wakeChannelId = channel.manifest.id
  }
  const assigned = await assignTestTask(ctx,
    { teamId,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: participant.id,
      activationId: binding.activation.id,
      leaseDurationMs: 60_000, ...wakeChannelId === undefined ? {} : { wakeChannelId } })
  if (assigned.lease === undefined) throw new Error('task lease is missing')
  const running = await ctx.teams.startTaskAttempt({ actor: owner.proof,
    taskId: task.id,
    expectedRevision: assigned.revision,
    attemptId: assigned.lease.attemptId })
  if (workspace) {
    const input = {
      teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, taskId: task.id,
      expectedTaskRevision: running.revision, attemptId: assigned.lease.attemptId,
      allocation: {
        id: teamWorkspaceAllocationIdSchema.parse(`allocation-${teamId}`), provider: 'recovery-workspace', mode: 'shared' as const,
        assignedRevision: assigned.lease.assignedRevision,
        participantId: participant.id,
        activationId: binding.activation.id,
        sessionId: binding.sessionId,
      },
    }
    const reserved = await workspaceProof(ctx,
      { kind: 'workspace-allocation-reserve',
        ...input },
      async actor => await ctx.teams.reserveWorkspaceAllocation({ actor,
        ...input }))
    const activate = { teamId,
      expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      allocationId: reserved.id,
      expectedRevision: reserved.revision }
    await workspaceProof(ctx,
      { kind: 'workspace-allocation-activate',
        ...activate },
      async actor => await ctx.teams.activateWorkspaceAllocation({ actor,
        ...activate }))
  }
  if (closureKind === 'none') {
    owner.revoke()
    issuer.close()
    return { teamId, binding, taskId: task.id, wakeChannelId }
  }
  if (closureKind === 'cancel') {
    await ctx.teams.cancelTeam({
      actor: owner.proof, teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse(`cancel-${teamId}`),
      reason: { code: 'USER_CANCELLED', message: 'Cancel the interrupted work.' },
    })
    owner.revoke()
    issuer.close()
    return { teamId, binding, taskId: task.id, wakeChannelId }
  }
  owner.revoke()
  issuer.close()
  const proof = Object.freeze({}) as TeamSystemClosureProof
  const scope: TeamSystemClosureScope = { kind: 'team-run-create-failure', teamId }
  const unregister = ctx.teams.registerSystemClosureProofSource({ name: 'team-run',
    resolveClosureProof: value => value === proof ? scope : undefined })
  try {
    await ctx.teams.failTeam({ actor: proof, teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse(`fail-${teamId}`),
      reason: { code: 'MODEL_FAILED',
        message: 'The coordinator failed.' } })
  } finally { unregister() }
  return { teamId, binding, taskId: task.id, wakeChannelId }
}

/** Bind a closure-driver token to one selected durable scope for a single operation. */
async function withDriverScope<T>(
  ctx: Context,
  scope: TeamSystemClosureDriverScope,
  operation: (request: TeamClosureContinuationRequest) => Promise<T>,
) {
  const actor = Object.freeze({}) as TeamSystemClosureDriverProof
  const unregister = ctx.teams.registerSystemClosureDriverProofSource({
    name: 'team-closure-driver', resolveClosureDriverProof: value => value === actor ? scope : undefined,
  })
  try { return await operation({ actor, teamId: scope.teamId, expectedCursor: scope.expectedCursor }) } finally { unregister() }
}

/** Request failure while an independent provider operation remains in flight. */
async function failDuringRecovery(ctx: Context, teamId: TeamId): Promise<void> {
  const actor = Object.freeze({}) as TeamSystemClosureProof
  const unregister = ctx.teams.registerSystemClosureProofSource({
    name: 'team-run', resolveClosureProof: value => value === actor ? { kind: 'team-run-create-failure', teamId } : undefined,
  })
  try {
    await ctx.teams.failTeam({ actor, teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse(`racing-fail-${teamId}`),
      reason: { code: 'PROVIDER_FAILED', message: 'Failure interrupted recovery.' } })
  } finally { unregister() }
}

/** Issue an exact fixture allocation proof without sharing it with recovery. */
async function workspaceProof<T>(ctx: Context,
  scope: TeamSystemWorkspaceAllocationScope,
  operation: (actor: TeamSystemWorkspaceAllocationProof) => Promise<T>): Promise<T> {
  const proof = Object.freeze({}) as TeamSystemWorkspaceAllocationProof
  const unregister = ctx.teams.registerSystemWorkspaceAllocationProofSource({ name: 'fixture',
    resolveWorkspaceAllocationProof: value => value === proof ? scope : undefined })
  try { return await operation(proof) } finally { unregister() }
}

/** Drive the production controller and Hub with a fresh closure proof after each cursor advance. */
async function drive(ctx: Context, teamId: TeamId, operation?: (request: TeamClosureContinuationRequest) => Promise<void>) {
  const before = await ctx.teams.getTeam({ teamId })
  const closure = before.team.closure
  const cancellation = before.team.cancellation
  if (closure?.kind !== 'fail' && cancellation === undefined) throw new Error('recovery intent is missing')
  const actor = Object.freeze({}) as TeamSystemClosureDriverProof
  const scope: TeamSystemClosureDriverScope = cancellation === undefined ? {
    kind: 'closure-recover-fail', teamId, expectedCursor: before.team.cursor,
    closureIdempotencyKey: closure!.idempotencyKey, closureRequestedAt: closure!.requestedAt,
  } : {
    kind: 'closure-recover-cancel', teamId, expectedCursor: before.team.cursor,
    cancellationIdempotencyKey: cancellation.idempotencyKey, cancellationRequestedAt: cancellation.requestedAt,
  }
  const unregister = ctx.teams.registerSystemClosureDriverProofSource({ name: 'team-closure-driver',
    resolveClosureDriverProof: value => value === actor ? scope : undefined })
  const request = { actor, teamId, expectedCursor: before.team.cursor }
  try {
    if (operation !== undefined) await operation(request)
    else await ctx.teamActivations.recoverClosure(request)
    const after = await ctx.teams.getTeam({ teamId })
    if (after.team.cursor === before.team.cursor) await ctx.teams.continueTeamClosure(request)
  } finally { unregister() }
  return await ctx.teams.getTeam({ teamId })
}

for (const backend of ['json', 'sqlite'] as const) describe(`closure resource recovery on ${backend}`, () => {
  it('recovers an exact stall after SIGKILL removes a live controller during provider disposal', async () => {
    const target = await setup(backend)
    await target.close()
    const fixture = fileURLToPath(new URL('./fixtures/closure-kill.ts', import.meta.url))
    const launch = resolveExampleLaunch({ srcBin: fixture,
      libBin: fixture,
      tsconfigPath: join(process.cwd(),
        'tsconfig.base.json'),
      configArgs: [target.root,
        backend] })
    const child = spawn(launch.command,
      launch.args,
      { cwd: process.cwd(),
        env: { ...process.env,
          ...launch.env },
        stdio: ['ignore',
          'pipe',
          'pipe',
          'ipc'] })
    let stderr = ''
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    const exited = once(child, 'exit')
    try {
      const message = await Promise.race([
        once(child, 'message').then(([value]) => value as { readonly teamId: string; readonly activationId: string }),
        exited.then(() => { throw new Error(`child exited before the disposal checkpoint: ${stderr}`) }),
      ])
      child.kill('SIGKILL')
      await exited
      const recovered = await setup(backend, target.root)
      await recovered.ctx.plugin(Controller)
      const teamId = teamIdSchema.parse(message.teamId)
      const before = await recovered.ctx.teams.getTeam({ teamId })
      expect(before.team).toMatchObject({ phase: 'quiescing', closure: { kind: 'fail' } })
      expect(before.activations[0]).toMatchObject({ activation: { id: message.activationId, status: 'stopping' } })
      expect(before.tasks[0]?.phase).toBe('running')
      const stalled = await drive(recovered.ctx, teamId)
      expect(stalled.team).toMatchObject({ phase: 'stalled', stallReason: { code: 'ACTIVATION_TERMINATION_UNCONFIRMED' } })
      expect(stalled.activations[0]?.quiescedAt).toBeUndefined()
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }
    }
  }, 15_000)

  for (const kind of ['local-agent', 'remote-agent'] as const) {
    it(`records an exact stall for an unfenced ${kind} with a lost live handle`, async () => {
      const first = await setup(backend)
      const { teamId, binding } = await seed(first.ctx, kind, false)
      await first.close()
      const recovered = await setup(backend, first.root)
      await recovered.ctx.plugin(Controller)
      const stalled = await drive(recovered.ctx, teamId)
      expect(stalled.team).toMatchObject({ phase: 'stalled',
        stallReason: { code: kind === 'remote-agent' ? 'REMOTE_CANCELLATION_UNCONFIRMED' : 'ACTIVATION_TERMINATION_UNCONFIRMED' } })
      expect(stalled.team.stallReason?.message).toContain(binding.activation.id)
      expect(stalled.activations[0]).toMatchObject({ activation: { status: 'running' } })
      expect(stalled.activations[0]?.quiescedAt).toBeUndefined()
      expect(stalled.tasks[0]?.phase).toBe('running')
      expect((await drive(recovered.ctx, teamId)).team.cursor).toBe(stalled.team.cursor)
    })
  }

  it('fences the exact stale epoch and cancels its retryable attempt without creating a replacement', async () => {
    const first = await setup(backend)
    const { teamId, binding } = await seed(first.ctx, 'local-agent', true)
    await first.close()
    const recovered = await setup(backend, first.root)
    await recovered.ctx.plugin(Controller)
    expect((await drive(recovered.ctx, teamId)).team.phase).toBe('stalled')
    const fence = vi.fn(async () => {})
    recovered.ctx.agentRuntimes.registerFencer({ provider: binding.provider, validate() {}, fence })
    const settled = await drive(recovered.ctx, teamId)
    expect(fence).toHaveBeenCalledWith(binding)
    expect(settled.activations).toHaveLength(1)
    expect(settled.activations[0]).toMatchObject({ activation: { status: 'offline' }, quiescenceSource: 'fenced' })
    expect(settled.tasks[0]).toMatchObject({ phase: 'cancelled', attemptCount: 1, attemptHistory: [{ outcome: { kind: 'released' } }] })
    expect((await drive(recovered.ctx, teamId)).team.phase).toBe('failed')
  })

  it('retains a confirmed fence across restart before releasing its active workspace', async () => {
    const first = await setup(backend)
    const { teamId, binding } = await seed(first.ctx, 'local-agent', true, true)
    await first.close()
    const recovery = await setup(backend, first.root)
    const fence = vi.fn(async () => {})
    recovery.ctx.agentRuntimes.registerFencer({ provider: binding.provider, validate() {}, fence })
    await recovery.ctx.plugin(Controller)
    const requested = await drive(recovery.ctx, teamId)
    expect(requested.activations[0]).toMatchObject({ activation: { status: 'stopping' } })
    expect(requested.activations[0]?.fencedAt).toBeTypeOf('number')
    expect(requested.activations[0]?.quiescedAt).toBeUndefined()
    expect(requested.workspaceAllocations[0]?.lifecycle).toBe('release-requested')
    await recovery.close()

    const reopened = await setup(backend, first.root)
    await reopened.ctx.plugin(Controller)
    await reopened.ctx.plugin(TeamWorkspaces)
    const released = new Set<string>()
    const reconcileRelease = vi.fn<TeamWorkspaceProvider['reconcileRelease']>(async (_request, metadata) => { released.add(metadata.id) })
    reopened.ctx.teamWorkspaces.registerProvider({ name: 'recovery-workspace',
      modes: ['shared'],
      async eligible() { return true },
      async prepare() { throw new Error('must not prepare') },
      async restore() { throw new Error('must not restore') },
      reconcileRelease })
    const confirmation = vi.spyOn(reopened.ctx.teams, 'confirmWorkspaceAllocationRelease')
      .mockRejectedValueOnce(new Error('release confirmation append interrupted'))
    await reopened.ctx.plugin(WorkspaceRecovery, {
      maxTeamsPerDrive: 8, pageSize: 4, confirmationAttempts: 2, confirmationRetryDelayMs: 1,
    })
    expect(confirmation).toHaveBeenCalledTimes(2)
    expect(reconcileRelease).toHaveBeenCalledOnce()
    expect(released.size).toBe(1)
    const quiesced = await drive(reopened.ctx, teamId)
    expect(quiesced.activations[0]?.fencedAt).toBe(requested.activations[0]?.fencedAt)
    expect(quiesced.activations[0]).toMatchObject({ activation: { status: 'offline' }, quiescenceSource: 'fenced' })
    expect(fence).toHaveBeenCalledOnce()
    expect((await drive(reopened.ctx, teamId)).team.phase).toBe('failed')
  })

  it('continues cancellation after missing termination proof becomes available', async () => {
    const owner = await setup(backend)
    const { teamId, binding } = await seed(owner.ctx, 'remote-agent', true, false, 'cancel')
    await owner.ctx.plugin(Controller)
    const failedFence = owner.ctx.agentRuntimes.registerFencer({
      provider: binding.provider, validate() {}, async fence() { throw new Error('endpoint is disconnected') },
    })
    expect((await drive(owner.ctx, teamId)).team).toMatchObject({
      phase: 'stalled', stallReason: { code: 'REMOTE_CANCELLATION_UNCONFIRMED' },
    })
    failedFence()
    owner.ctx.agentRuntimes.registerFencer({ provider: binding.provider, validate() {}, async fence() {} })
    expect((await drive(owner.ctx, teamId)).tasks[0]?.phase).toBe('cancelled')
    expect((await drive(owner.ctx, teamId)).team.phase).toBe('cancelled')
  })

  it('keeps a provider-preserved allocation and records its exact closure stall', async () => {
    const owner = await setup(backend)
    const { teamId, binding } = await seed(owner.ctx, 'local-agent', true, true)
    await owner.ctx.plugin(Controller)
    owner.ctx.agentRuntimes.registerFencer({ provider: binding.provider, validate() {}, async fence() {} })
    const requested = await drive(owner.ctx, teamId)
    const allocation = requested.workspaceAllocations[0]
    if (allocation === undefined) throw new Error('allocation is missing')
    const input = {
      teamId, expectedCursor: requested.team.cursor, allocationId: allocation.id, expectedRevision: allocation.revision,
      reason: { code: 'WORKSPACE_RELEASE_RECOVERY_FAILED', message: 'Keep the unreviewed worktree.' },
    }
    await workspaceProof(owner.ctx, { kind: 'workspace-allocation-preserve', ...input }, async actor =>
      await owner.ctx.teams.preserveWorkspaceAllocation({ actor, ...input }))
    const preserved = await drive(owner.ctx, teamId)
    expect(preserved.team).toMatchObject({ phase: 'stalled', stallReason: { code: 'WORKSPACE_RELEASE_RECOVERY_FAILED' } })
    expect(preserved.team.stallReason?.message).toContain(allocation.id)
    expect(preserved.workspaceAllocations[0]?.lifecycle).toBe('preserved')
    expect(preserved.activations[0]?.activation.status).toBe('stopping')
  })

  it('checks workspace release policy before committing a fence and release request', async () => {
    const owner = await setup(backend)
    const { teamId, binding } = await seed(owner.ctx, 'local-agent', true, true)
    await owner.ctx.plugin(Controller)
    owner.ctx.agentRuntimes.registerFencer({ provider: binding.provider, validate() {}, async fence() {} })
    const policy = vi.fn(async () => ({ kind: 'deny' as const, code: 'KEEP_WORKSPACE', message: 'Workspace release needs review.' }))
    owner.ctx.teams.registerPolicy('workspace-allocate', { name: 'preserve-closure-workspace', apply: policy })
    const rejected = await drive(owner.ctx, teamId)
    expect(policy).toHaveBeenCalledOnce()
    expect(rejected.team.phase).toBe('stalled')
    expect(rejected.workspaceAllocations[0]?.lifecycle).toBe('active')
    expect(rejected.activations[0]?.fencedAt).toBeUndefined()
    expect(rejected.activations[0]?.quiescedAt).toBeUndefined()
  })

  it('joins live-handle closure recovery and rejects admission after controller close', async () => {
    const owner = await setup(backend)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const dispose = vi.fn(async () => { entered.resolve(undefined); await release.promise })
    const provider = liveProvider(owner.ctx, dispose)
    await owner.ctx.plugin(Controller)
    owner.ctx.teamActivations.start()
    const { teamId, binding } = await seed(owner.ctx, 'local-agent', false)
    await entered.promise
    let retained: TeamClosureContinuationRequest | undefined
    const result = await drive(owner.ctx, teamId, async (request) => {
      retained = request
      const first = owner.ctx.teamActivations.recoverClosure(request)
      const second = owner.ctx.teamActivations.recoverClosure(request)
      release.resolve(undefined)
      await Promise.all([first, second])
    })
    expect(result.activations[0]?.activation.status).toBe('offline')
    expect(dispose).toHaveBeenCalledOnce()
    expect(provider.interrupt).not.toHaveBeenCalled()
    await owner.ctx.teamActivations.close()
    if (retained === undefined) throw new Error('recovery input was not retained')
    await expect(owner.ctx.teamActivations.recoverClosure(retained)).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
    await expect(owner.ctx.teamActivations.coldReplace({
      teamId, participantId: binding.activation.participantId,
      activationId: binding.activation.id, signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
  })

  it('records an owned handle failure and retries it without losing the activation', async () => {
    const owner = await setup(backend)
    let unconfirmed = true
    const failed = Promise.withResolvers<undefined>()
    liveProvider(owner.ctx, async () => {
      if (unconfirmed) {
        failed.resolve(undefined)
        throw new Error('provider close failed')
      }
    })
    await owner.ctx.plugin(Controller)
    const { teamId } = await seed(owner.ctx, 'local-agent', false)
    await failed.promise
    const stalled = await drive(owner.ctx, teamId)
    expect(stalled.team).toMatchObject({ phase: 'stalled', stallReason: { code: 'ACTIVATION_TERMINATION_UNCONFIRMED' } })
    expect(stalled.activations[0]?.activation.status).toBe('stopping')
    unconfirmed = false
    expect((await drive(owner.ctx, teamId)).activations[0]?.activation.status).toBe('offline')
  })

  it('keeps runtime proofs unserializable and accepts a late remote termination proof', async () => {
    const owner = await setup(backend)
    const provider = liveProvider(owner.ctx, async () => {
      throw new AgentRuntimeTerminationUnconfirmedError('endpoint has not confirmed exit')
    })
    await owner.ctx.plugin(Controller)
    const bind = owner.ctx.teams.bindActivation.bind(owner.ctx.teams)
    vi.spyOn(owner.ctx.teams, 'bindActivation').mockImplementation(async (request) => {
      expect(() => JSON.stringify(request.actor)).toThrow('runtime-only')
      return await bind(request)
    })
    const phases: TeamPhaseTransitionRequest[] = []
    const transition = owner.ctx.teams.transitionTeamPhase.bind(owner.ctx.teams)
    vi.spyOn(owner.ctx.teams, 'transitionTeamPhase').mockImplementation(async (request) => {
      expect(() => JSON.stringify(request.actor)).toThrow('runtime-only')
      phases.push(request)
      return await transition(request)
    })
    const { teamId } = await seed(owner.ctx, 'remote-agent', false, false, 'cancel')
    await vi.waitFor(async () => {
      expect((await owner.ctx.teams.getTeam({ teamId })).team.phase).toBe('stalled')
    })
    const before = await owner.ctx.teams.getTeam({ teamId })
    expect((await drive(owner.ctx, teamId)).team.cursor).toBe(before.team.cursor)
    provider.offline()
    await vi.waitFor(async () => {
      expect((await owner.ctx.teams.getTeam({ teamId })).activations[0]?.quiescedAt).toBeTypeOf('number')
    })
    expect((await drive(owner.ctx, teamId)).team.phase).toBe('cancelled')
    const oldProof = phases[0]
    if (oldProof === undefined) throw new Error('stall proof was not observed')
    await expect(owner.ctx.teams.transitionTeamPhase(oldProof)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  })

  it('keeps a stopping activation stall proof live while controller close waits for its policy', async () => {
    const owner = await setup(backend)
    const provider = liveProvider(owner.ctx, async () => {
      throw new AgentRuntimeTerminationUnconfirmedError('endpoint has not confirmed exit')
    })
    await owner.ctx.plugin(Controller)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    owner.ctx.teams.registerPolicy('close', {
      name: 'defer-termination-stall',
      async apply(request, next) {
        if (request.facts.operation === 'cancellation-termination-unconfirmed') {
          entered.resolve(undefined)
          await release.promise
        }
        return await next()
      },
    })
    const { teamId } = await seed(owner.ctx, 'remote-agent', false, false, 'cancel')
    await entered.promise
    const disposal = owner.ctx.teamActivations.close().catch((error: unknown) => error)
    release.resolve(undefined)
    expect(await disposal).toBeInstanceOf(AggregateError)
    expect((await owner.ctx.teams.getTeam({ teamId })).team).toMatchObject({
      phase: 'stalled', stallReason: { code: 'REMOTE_CANCELLATION_UNCONFIRMED' },
    })
    provider.offline()
    await vi.waitFor(async () => {
      expect((await owner.ctx.teams.getTeam({ teamId })).activations[0]?.quiescedAt).toBeTypeOf('number')
    })
    await owner.ctx.fiber.dispose()
    contexts.delete(owner.ctx)
  })

  for (const boundary of ['fenceActivation', 'transitionTeamPhase'] as const) {
    for (const outcome of ['retry', 'exhaust'] as const) {
      it(`${outcome}s actual cursor conflicts during ${boundary}`, async () => {
        const owner = await setup(backend)
        const { teamId, binding } = await seed(owner.ctx, 'local-agent', boundary === 'fenceActivation', true)
        await owner.ctx.plugin(Controller, { statusSyncAttempts: 2 })
        if (boundary === 'fenceActivation') {
          owner.ctx.agentRuntimes.registerFencer({ provider: binding.provider, validate() {}, async fence() {} })
        }
        let remaining = outcome === 'retry' ? 1 : 2
        const interfere = async (): Promise<void> => {
          if (remaining-- <= 0) return
          const state = await owner.ctx.teams.getTeam({ teamId })
          const allocation = state.workspaceAllocations[0]
          if (allocation === undefined) throw new Error('allocation is missing')
          const input = { teamId, expectedCursor: state.team.cursor, allocationId: allocation.id, expectedRevision: allocation.revision }
          if (allocation.lifecycle === 'preserved') {
            await workspaceProof(owner.ctx, { kind: 'workspace-allocation-release-request', ...input }, async actor =>
              await owner.ctx.teams.requestWorkspaceAllocationRelease({ actor, ...input }))
          } else {
            const preserve = { ...input, reason: { code: 'REVIEW_PENDING', message: 'Retain the workspace while its owner changes.' } }
            await workspaceProof(owner.ctx, { kind: 'workspace-allocation-preserve', ...preserve }, async actor =>
              await owner.ctx.teams.preserveWorkspaceAllocation({ actor, ...preserve }))
          }
        }
        const fence = owner.ctx.teams.fenceActivation.bind(owner.ctx.teams)
        const phase = owner.ctx.teams.transitionTeamPhase.bind(owner.ctx.teams)
        const calls = boundary === 'fenceActivation'
          ? vi.spyOn(owner.ctx.teams, 'fenceActivation').mockImplementation(async (request) => { await interfere(); return await fence(request) })
          : vi.spyOn(owner.ctx.teams, 'transitionTeamPhase').mockImplementation(async (request) => { await interfere(); return await phase(request) })
        if (outcome === 'exhaust' && boundary === 'transitionTeamPhase') {
          await expect(drive(owner.ctx, teamId)).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
        } else {
          const state = await drive(owner.ctx, teamId)
          expect(state.team.phase).toBe(boundary === 'fenceActivation' && outcome === 'retry' ? 'quiescing' : 'stalled')
        }
        expect(calls).toHaveBeenCalledTimes(2)
      })
    }
  }

  it('does not retry a policy denial as a cursor conflict', async () => {
    const owner = await setup(backend)
    const { teamId } = await seed(owner.ctx, 'local-agent', false)
    await owner.ctx.plugin(Controller, { statusSyncAttempts: 2 })
    const policy = vi.fn(async () => ({ kind: 'deny' as const, code: 'REJECT_STALL', message: 'Policy denies this stall.' }))
    owner.ctx.teams.registerPolicy('close', { name: 'deny-controller-stall', apply: policy })
    await expect(drive(owner.ctx, teamId)).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    expect(policy).toHaveBeenCalledOnce()
  })

  it('does not signal a second fence while an earlier cold replacement owns the epoch', async () => {
    const owner = await setup(backend)
    const { teamId, binding } = await seed(owner.ctx, 'local-agent', true, false, 'none')
    liveProvider(owner.ctx, async () => {})
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const fence = vi.fn(async () => { entered.resolve(undefined); await release.promise })
    owner.ctx.agentRuntimes.registerFencer({ provider: binding.provider, validate() {}, fence })
    await owner.ctx.plugin(Controller)
    const replacement = owner.ctx.teamActivations.coldReplace({
      teamId, activationId: binding.activation.id, participantId: binding.activation.participantId,
      signal: new AbortController().signal,
    }).catch((error: unknown) => error)
    await entered.promise
    await failDuringRecovery(owner.ctx, teamId)
    expect((await drive(owner.ctx, teamId)).activations[0]?.activation.status).toBe('running')
    expect(fence).toHaveBeenCalledOnce()
    release.resolve(undefined)
    expect(await replacement).toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect((await drive(owner.ctx, teamId)).team.phase).toBe('failed')
  })

  it('checks an accepted completion scope against its exact final before recording an activation stall', async () => {
    const owner = await setup(backend)
    const { teamId, binding } = await seed(owner.ctx, 'local-agent', false, false, 'none')
    const runtime = owner.ctx.teams.openActivationActorProofIssuer().issue(binding)
    const task = (await owner.ctx.teams.getTeam({ teamId })).tasks[0]
    if (task?.lease === undefined) throw new Error('running attempt is missing')
    await owner.ctx.teams.settleTaskAttempt({ actor: runtime.proof, taskId: task.id,
      expectedRevision: task.revision, attemptId: task.lease.attemptId,
      outcome: { kind: 'completed', result: { summary: 'Task is complete.' } } })
    const human = await inviteBootstrapParticipant(owner.ctx, {
      teamId, expectedCursor: (await owner.ctx.teams.getTeam({ teamId })).team.cursor,
      kind: 'human', role: 'human', displayName: 'Human', capabilities: [], owner: { kind: 'system' },
    })
    for (const phase of ['provisioning', 'active'] as const) {
      await transitionBootstrapParticipant(owner.ctx, { teamId, participantId: human.id,
        expectedCursor: (await owner.ctx.teams.getTeam({ teamId })).team.cursor, phase })
    }
    await owner.ctx.plugin(DirectChannel)
    const opened = await openTestChannel(owner.ctx, { teamId,
      expectedCursor: (await owner.ctx.teams.getTeam({ teamId })).team.cursor,
      adapter: DirectChannel.DIRECT_CHANNEL_ADAPTER_V4, participants: [
        { id: human.id, role: 'human' }, { id: binding.activation.participantId, role: 'coordinator' },
      ], limits: {} })
    await acknowledgeTestChannelActivations(owner.ctx, opened.manifest.id)
    await acknowledgeSystemHumanChannel(owner.ctx, opened.manifest.id, human.id)
    const channel = await owner.ctx.teams.getChannel({ channelId: opened.manifest.id })
    const final = await owner.ctx.teams.postChannelEnvelope({ actor: runtime.proof, expectedCursor: channel.cursor,
      draft: { channelId: channel.manifest.id, audience: [human.id], kind: 'final', payload: { text: 'Accepted completion.' }, delivery: 'turn' } })
    runtime.revoke()
    const actor = Object.freeze({}) as TeamSystemClosureProof
    const unregister = owner.ctx.teams.registerSystemClosureProofSource({
      name: 'team-run', resolveClosureProof: value => value === actor ? {
        kind: 'team-run-complete', teamId, channelId: channel.manifest.id, humanId: human.id,
        coordinatorId: binding.activation.participantId, finalEnvelopeId: final.id,
      } : undefined,
    })
    const accepted = await owner.ctx.teams.completeTeam({ actor, teamId,
      expectedCursor: (await owner.ctx.teams.getTeam({ teamId })).team.cursor,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse(`complete-${teamId}`),
      reason: { code: 'FINAL_ACCEPTED', message: 'The final result is accepted.' },
      finalChannelId: channel.manifest.id, finalEnvelopeId: final.id })
    unregister()
    const closure = accepted.team.closure
    if (closure === undefined) throw new Error('completion intent is missing')
    await owner.ctx.plugin(Controller)
    const scope = { kind: 'closure-recover-complete' as const, teamId, expectedCursor: accepted.team.cursor,
      closureIdempotencyKey: closure.idempotencyKey, closureRequestedAt: closure.requestedAt,
      finalChannelId: channel.manifest.id, finalEnvelopeId: final.id }
    for (const invalid of [
      { ...scope, finalChannelId: channelIdSchema.parse('wrong-final-channel') },
      { ...scope, finalEnvelopeId: envelopeIdSchema.parse('wrong-final-envelope') },
      { ...scope, closureRequestedAt: scope.closureRequestedAt + 1 },
    ]) {
      await expect(withDriverScope(owner.ctx, invalid, async (request) =>{  await owner.ctx.teamActivations.recoverClosure(request) }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    }
    await withDriverScope(owner.ctx, scope, async (request) =>{  await owner.ctx.teamActivations.recoverClosure(request) })
    expect((await owner.ctx.teams.getTeam({ teamId })).team).toMatchObject({
      phase: 'stalled', stallReason: { code: 'ACTIVATION_TERMINATION_UNCONFIRMED' }, closure: { kind: 'complete' },
    })
  })

  it('rejects observer authority and a stalled Team that has no durable closure intent', async () => {
    const owner = await setup(backend)
    const { teamId } = await seed(owner.ctx, 'local-agent', false, false, 'none')
    await owner.ctx.plugin(Controller)
    let current = await owner.ctx.teams.getTeam({ teamId })
    await expect(withDriverScope(owner.ctx, { kind: 'closure-stall-budget', teamId, expectedCursor: current.team.cursor,
      reason: { code: 'WAITING', message: 'No resource cleanup authority.' } }, async (request) =>{
      await owner.ctx.teamActivations.recoverClosure(request) })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const actor = Object.freeze({}) as TeamSystemPhaseProof
    const phase: TeamSystemPhaseScope = { kind: 'scheduler-stall', teamId, phase: 'stalled',
      reason: { code: 'WAITING', message: 'Scheduler is waiting for work.' } }
    const unregister = owner.ctx.teams.registerSystemPhaseProofSource({
      name: 'team-scheduler-dag', resolvePhaseProof: proof => proof === actor ? phase : undefined,
    })
    await owner.ctx.teams.transitionTeamPhase({ actor, teamId, expectedCursor: current.team.cursor,
      phase: 'stalled', reason: phase.reason })
    unregister()
    current = await owner.ctx.teams.getTeam({ teamId })
    await expect(withDriverScope(owner.ctx, { kind: 'closure-recover-fail', teamId, expectedCursor: current.team.cursor,
      closureIdempotencyKey: teamClosureIdempotencyKeySchema.parse('unaccepted-failure'), closureRequestedAt: current.team.updatedAt,
    }, async (request) =>{  await owner.ctx.teamActivations.recoverClosure(request) })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  })

  it('does not let a delayed stall response overwrite a later quiescence or revoke another Team proof', async () => {
    const owner = await setup(backend)
    const provider = liveProvider(owner.ctx, async () => {
      throw new AgentRuntimeTerminationUnconfirmedError('termination reply was delayed')
    })
    let phaseSource: TeamSystemPhaseProofSource | undefined
    const register = owner.ctx.teams.registerSystemPhaseProofSource.bind(owner.ctx.teams)
    vi.spyOn(owner.ctx.teams, 'registerSystemPhaseProofSource').mockImplementation((source) => {
      if (source.name === 'team-activation-controller') phaseSource = source
      return register(source)
    })
    await owner.ctx.plugin(Controller)
    const responses = new Map<TeamId, ReturnType<typeof Promise.withResolvers<undefined>>>()
    const requests = new Map<TeamId, TeamPhaseTransitionRequest>()
    const transition = owner.ctx.teams.transitionTeamPhase.bind(owner.ctx.teams)
    vi.spyOn(owner.ctx.teams, 'transitionTeamPhase').mockImplementation(async (request) => {
      const response = await transition(request)
      requests.set(request.teamId, request)
      const release = Promise.withResolvers<undefined>()
      responses.set(request.teamId, release)
      await release.promise
      return response
    })
    const first = await seed(owner.ctx, 'remote-agent', false, false, 'cancel')
    const second = await seed(owner.ctx, 'remote-agent', false, false, 'cancel')
    await vi.waitFor(() => { expect(responses.size).toBe(2) })
    const firstLease = liveLeases.get(first.teamId)
    const firstRequest = requests.get(first.teamId)
    const secondRequest = requests.get(second.teamId)
    if (firstLease === undefined || firstRequest === undefined || secondRequest === undefined || phaseSource === undefined) {
      throw new Error('the two accepted stall operations are missing')
    }
    const firstDisposal = firstLease.dispose().catch((error: unknown) => error)
    provider.offline(first.teamId)
    await vi.waitFor(() => { expect(firstLease.binding.activation.status).toBe('offline') })
    expect(phaseSource.resolvePhaseProof(firstRequest.actor)).toBeUndefined()
    expect(phaseSource.resolvePhaseProof(secondRequest.actor)).toBeDefined()
    for (const response of responses.values()) response.resolve(undefined)
    expect(await firstDisposal).toMatchObject({ code: 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED' })
    expect(firstLease.binding.activation.status).toBe('offline')
    provider.offline(second.teamId)
    await vi.waitFor(async () => {
      expect((await owner.ctx.teams.getTeam({ teamId: second.teamId })).activations[0]?.quiescedAt).toBeTypeOf('number')
    })
  })

  it('keeps an admitted fence proof live while its Hub policy and controller close overlap', async () => {
    const owner = await setup(backend)
    const { teamId, binding } = await seed(owner.ctx, 'local-agent', true)
    await owner.ctx.plugin(Controller)
    owner.ctx.agentRuntimes.registerFencer({ provider: binding.provider, validate() {}, async fence() {} })
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    owner.ctx.teams.registerPolicy('activate', {
      name: 'hold-accepted-fence-policy',
      async apply(_request, next) { entered.resolve(undefined); await release.promise; return await next() },
    })
    const recovery = drive(owner.ctx, teamId)
    await entered.promise
    let closed = false
    const close = owner.ctx.teamActivations.close().then(() => { closed = true })
    expect(closed).toBe(false)
    release.resolve(undefined)
    expect((await recovery).activations[0]?.activation.status).toBe('offline')
    await close
    expect(closed).toBe(true)
  })

  for (const retrySucceeds of [true, false]) {
    it(`preserves both termination and stall failures before a late proof; retry success=${String(retrySucceeds)}`, async () => {
      const owner = await setup(backend)
      let confirmed = false
      const provider = liveProvider(owner.ctx, async () => {
        if (!confirmed) throw new AgentRuntimeTerminationUnconfirmedError('termination reply unavailable')
      })
      await owner.ctx.plugin(Controller)
      const rejectStall = owner.ctx.teams.registerPolicy('close', {
        name: 'reject-stall-persistence',
        async apply(request, next) {
          if (request.facts.phase === 'stalled') return { kind: 'deny', code: 'STALL_REJECTED', message: 'Stall write rejected.' }
          return await next()
        },
      })
      const { teamId } = await seed(owner.ctx, 'remote-agent', false, false, 'cancel')
      const lease = liveLeases.get(teamId)
      if (lease === undefined) throw new Error('published controller lease is missing')
      const failed = await lease.dispose().catch((error: unknown) => error)
      expect(failed).toBeInstanceOf(AggregateError)
      const errors: readonly unknown[] = (failed as AggregateError).errors
      expect(errors).toHaveLength(2)
      expect(errors[0]).toMatchObject({ code: 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED' })
      expect(errors[1]).toMatchObject({ code: 'TEAM_POLICY_DENIED' })
      expect((await owner.ctx.teams.getTeam({ teamId })).activations[0]?.activation.status).toBe('stopping')
      rejectStall()
      provider.offline(teamId)
      await vi.waitFor(() => { expect(lease.binding.activation.status).toBe('offline') })
      expect((await drive(owner.ctx, teamId)).team.phase).toBe('cancelled')
      const cursor = (await owner.ctx.teams.getTeam({ teamId })).team.cursor
      confirmed = retrySucceeds
      if (retrySucceeds) await lease.dispose()
      else await expect(lease.dispose()).rejects.toMatchObject({ code: 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED' })
      expect((await owner.ctx.teams.getTeam({ teamId })).team.cursor).toBe(cursor)
    })
  }

  it('rejects a late wake-cleanup proof after the successful disposer releases its epoch', async () => {
    const owner = await setup(backend)
    let confirmed = false
    const provider = liveProvider(owner.ctx, async () => {
      if (!confirmed) throw new AgentRuntimeTerminationUnconfirmedError('termination reply unavailable')
    })
    await owner.ctx.plugin(Controller)
    const { teamId, binding, wakeChannelId } = await seed(owner.ctx, 'remote-agent', false, false, 'cancel', true)
    const lease = liveLeases.get(teamId)
    if (lease === undefined || wakeChannelId === undefined) throw new Error('wake-bearing controller lease is missing')
    await expect(lease.dispose()).rejects.toMatchObject({ code: 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED' })
    confirmed = true
    let heldRead = false
    const read = owner.ctx.teams.getTeam.bind(owner.ctx.teams)
    vi.spyOn(owner.ctx.teams, 'getTeam').mockImplementation(async (input) => {
      const state = await read(input)
      if (!heldRead && state.activations.some(candidate =>
        candidate.activation.id === binding.activation.id && candidate.quiescedAt !== undefined)) {
        heldRead = true
        await disposing
      }
      return state
    })
    const rejected = Promise.withResolvers<unknown>()
    const quiesce = owner.ctx.teams.quiesceActivation.bind(owner.ctx.teams)
    let calls = 0
    vi.spyOn(owner.ctx.teams, 'quiesceActivation').mockImplementation(async (input) => {
      if (++calls === 1) provider.offline(teamId)
      try { return await quiesce(input) } catch (error: unknown) { rejected.resolve(error); throw error }
    })
    const warnings = vi.spyOn(owner.ctx.logger, 'warn').mockImplementation(() => undefined)
    const disposing = lease.dispose()
    await disposing
    expect(await rejected.promise).toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await vi.waitFor(() => { expect(warnings).toHaveBeenCalledWith(expect.stringContaining('System activation proof is invalid')) })
    expect(calls).toBe(2)
    expect(lease.binding.activation.status).toBe('offline')
    expect((await owner.ctx.teams.getChannel({ channelId: wakeChannelId })).phase).toBe('closed')
  })

  it('drains an accepted closure fence before controller teardown revokes its proof source', async () => {
    const owner = await setup(backend)
    const { teamId, binding } = await seed(owner.ctx, 'local-agent', true)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    owner.ctx.agentRuntimes.registerFencer({
      provider: binding.provider,
      validate() {},
      async fence() { entered.resolve(undefined); await release.promise },
    })
    await owner.ctx.plugin(Controller)
    const recovery = drive(owner.ctx, teamId)
    await entered.promise
    let closed = false
    const disposal = owner.ctx.teamActivations.close().then(() => { closed = true })
    expect(closed).toBe(false)
    release.resolve(undefined)
    const settled = await recovery
    await disposal
    expect(settled.activations[0]).toMatchObject({ activation: { status: 'offline' }, quiescenceSource: 'fenced' })
    expect(closed).toBe(true)
  })

  it('rejects forged and mismatched recovery proofs before reaching a provider', async () => {
    const first = await setup(backend)
    const { teamId, binding } = await seed(first.ctx, 'local-agent', true)
    const fence = vi.fn(async () => {})
    first.ctx.agentRuntimes.registerFencer({ provider: binding.provider, validate() {}, fence })
    await first.ctx.plugin(Controller)
    const current = await first.ctx.teams.getTeam({ teamId })
    await expect(first.ctx.teamActivations.recoverClosure({ actor: {} as TeamSystemClosureDriverProof,
      teamId,
      expectedCursor: current.team.cursor })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await drive(first.ctx, teamId, async (request) => {
      await expect(first.ctx.teamActivations.recoverClosure({ ...request,
        expectedCursor: request.expectedCursor + 1 })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    })
    expect(fence).not.toHaveBeenCalled()
  })
})
