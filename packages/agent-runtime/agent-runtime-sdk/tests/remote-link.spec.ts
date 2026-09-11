import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { acknowledgeTestChannelActivations, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import { SessionId } from '@clocky/clocky-session'
import WebServer from '@clocky/clocky-host-webserver'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import { activationIdSchema, channelInvitationIdempotencyKeySchema, fingerprintChannelManifest, teamTaskCreateIdempotencyKeySchema } from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  TeamActorProof,
  TeamSystemEnvelopePostProof,
  TeamSystemEnvelopePostScope,
  TeamSystemActivationProof,
  TeamSystemActivationScope,
  TeamSystemChannelAdmissionProof,
  TeamSystemChannelAdmissionScope,
  TeamSystemInterruptProof,
  TeamSystemInterruptScope,
  TeamSystemTaskLeaseProof,
  TeamSystemTaskLeaseScope,
  TeamTaskAssignInput,
  TeamTaskId,
} from '@clocky/clocky-team'
import * as TeamActivationController from '@clocky/clocky-team-activation-controller'
import * as DirectChannel from '@clocky/clocky-team-channel-direct'
import * as TaskAssignmentChannel from '@clocky/clocky-team-channel-task-assignment'
import TeamLinkRegistry from '@clocky/clocky-team-link'
import * as WebSocketHub from '@clocky/clocky-team-link-websocket-hub'
import * as SdkRuntime from '../src/index.ts'

const contexts = new Set<Context>()
const roots: string[] = []
const fixture = fileURLToPath(new URL('./fixtures/remote-link-runtime.ts', import.meta.url))
const tsxLoader = fileURLToPath(import.meta.resolve('tsx'))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
const TEAM_SCHEDULER_ENVELOPE_POST_PROOF_SOURCE = 'team-scheduler-dag'
const TEAM_RUN_ENVELOPE_POST_PROOF_SOURCE = 'team-run'
const TEAM_RUN_INTERRUPT_PROOF_SOURCE = 'team-run'
const TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE = 'team-activation-controller'
const TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE = 'team-scheduler-dag'
const schedulerPostAuthorities = new WeakMap<Context, {
  issue(scope: TeamSystemEnvelopePostScope): TeamSystemEnvelopePostProof
}>()
const teamRunEnvelopePostProofStores = new WeakMap<Context, WeakMap<TeamSystemEnvelopePostProof, TeamSystemEnvelopePostScope>>()
const teamRunInterruptProofStores = new WeakMap<Context, WeakMap<TeamSystemInterruptProof, TeamSystemInterruptScope>>()
const activationProofStores = new WeakMap<Context, WeakMap<TeamSystemActivationProof, ControllerActivationScope>>()
const channelAdmissionProofStores = new WeakMap<Context, WeakMap<TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope>>()

type ControllerActivationScope =
  | Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-bind' }>
  | Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-status' }>
  | Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-fence' }>
  | Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-quiesce' }>

type SchedulerTaskAssignScope = Extract<TeamSystemTaskLeaseScope, { readonly kind: 'scheduler-task-assign' }>

interface ControllerProofIssuer {
  withActivationProof<T>(
    scope: ControllerActivationScope,
    operation: (actor: TeamSystemActivationProof) => Promise<T>,
  ): Promise<T>
}

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
  if (failures.length > 0) throw new AggregateError(failures, 'SDK remote Link E2E cleanup failed')
})

async function freshRoot(prefix: string): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, prefix))
  roots.push(root)
  return root
}

async function activeParticipant(
  ctx: Context,
  teamId: string,
  kind: 'human' | 'local-agent' | 'remote-agent',
  displayName: string,
  role = 'worker',
) {
  let state = await ctx.teams.getTeam({ teamId: teamId as never })
  const participant = await inviteBootstrapParticipant(ctx, {
    teamId: state.team.id,
    expectedCursor: state.team.cursor,
    kind,
    displayName,
    role,
    capabilities: [],
    ...kind === 'human' ? { owner: { kind: 'system' as const } } : {},
  })
  state = await ctx.teams.getTeam({ teamId: state.team.id })
  await transitionBootstrapParticipant(ctx, {
    teamId: state.team.id,
    participantId: participant.id,
    expectedCursor: state.team.cursor,
    phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId: state.team.id })
  return await transitionBootstrapParticipant(ctx, {
    teamId: state.team.id,
    participantId: participant.id,
    expectedCursor: state.team.cursor,
    phase: 'active',
  })
}

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
  return Object.freeze({ proof, revoke: () => proofs?.delete(proof) })
}

/** Acknowledge the current human invitation through the system-owned TeamRun endpoint. */
async function acknowledgeSystemHumanChannel(
  ctx: Context,
  channelId: string,
  participantId: string,
): Promise<void> {
  const channel = await ctx.teams.getChannel({ channelId: channelId as never })
  const admission = await ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })
  const invitation = admission.invitations.find(item => item.participantId === participantId)
  if (invitation === undefined || invitation.status === 'acknowledged') return
  const idempotencyKey = channelInvitationIdempotencyKeySchema.parse(`test-human-consent:${participantId}`)
  const authority = systemHumanAdmissionActor(ctx, {
    kind: 'channel-invitation-acknowledge',
    teamId: channel.manifest.teamId,
    channelId: channel.manifest.id,
    participantId: participantId as never,
    revision: invitation.revision,
    manifestFingerprint: fingerprintChannelManifest(channel.manifest),
    idempotencyKey,
  })
  try {
    await ctx.teams.acknowledgeChannelInvitation({
      actor: authority.proof,
      channelId: channel.manifest.id,
      revision: invitation.revision,
      manifestFingerprint: fingerprintChannelManifest(channel.manifest),
      idempotencyKey,
    })
  } finally {
    authority.revoke()
  }
}

/** Issue one nonserializable controller proof only for its exact test lifecycle operation. */
async function withTestActivationProof<T>(
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

/** Use the mounted controller's private issuer when it owns this Context, otherwise register a test-local source. */
async function withActivationProof<T>(
  ctx: Context,
  scope: ControllerActivationScope,
  operation: (actor: TeamSystemActivationProof) => Promise<T>,
): Promise<T> {
  const controller = ctx.get('teamActivations') as ControllerProofIssuer | undefined
  return controller === undefined
    ? await withTestActivationProof(ctx, scope, operation)
    : await controller.withActivationProof(scope, operation)
}

/** Assign one test fixture lease through a one-shot canonical scheduler proof. */
async function assignSchedulerLease(ctx: Context, input: TeamTaskAssignInput) {
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

/** Issue an opaque Hub actor proof for one active post sender. */
async function activeActor(ctx: Context, teamId: string, participantId: string): Promise<TeamActorProof> {
  const current = await ctx.teams.getTeam({ teamId: teamId as never })
  const existing = current.activations.find(candidate => candidate.activation.participantId === participantId as never)
  const binding = existing ?? await (async () => {
    const bindingInput: ActivationBindingSnapshot = {
      activation: {
        id: activationIdSchema.parse(`activation-remote-link-post-${participantId}`),
        teamId: current.team.id,
        participantId: participantId as never,
        status: 'idle',
      },
      sessionId: SessionId(`session-remote-link-post-${participantId}`),
      provider: 'remote-link-post-test',
    }
    const input = {
      expectedCursor: current.team.cursor,
      binding: bindingInput,
    }
    return await withActivationProof(ctx, {
      kind: 'activation-controller-bind',
      ...input,
    }, async actor => await ctx.teams.bindActivation({ actor, ...input }))
  })()
  return ctx.teams.openActivationActorProofIssuer().issue(binding).proof
}

/** Issue a test-only opaque scheduler proof for one exact durable post scope. */
function schedulerPostActor(ctx: Context, scope: TeamSystemEnvelopePostScope): TeamSystemEnvelopePostProof {
  let authority = schedulerPostAuthorities.get(ctx)
  if (authority === undefined) {
    const proofs = new WeakMap<TeamSystemEnvelopePostProof, TeamSystemEnvelopePostScope>()
    ctx.teams.registerSystemEnvelopePostProofSource({
      name: TEAM_SCHEDULER_ENVELOPE_POST_PROOF_SOURCE,
      resolveEnvelopePostProof: proof => proofs.get(proof),
    })
    authority = Object.freeze({
      issue(nextScope) {
        const proof: object = {}
        Object.defineProperty(proof, 'toJSON', {
          enumerable: true,
          value: (): never => { throw new TypeError('scheduler post proofs are runtime-only') },
        })
        const opaque = Object.freeze(proof) as TeamSystemEnvelopePostProof
        proofs.set(opaque, nextScope)
        return opaque
      },
    })
    schedulerPostAuthorities.set(ctx, authority)
  }
  return authority.issue(scope)
}

/** Issue one test-only TeamRun proof for the exact durable human-input topology. */
function teamRunHumanInputActor(
  ctx: Context,
  scope: TeamSystemEnvelopePostScope,
): { readonly proof: TeamSystemEnvelopePostProof; revoke(): void } {
  let proofs = teamRunEnvelopePostProofStores.get(ctx)
  if (proofs === undefined) {
    const sourceProofs = new WeakMap<TeamSystemEnvelopePostProof, TeamSystemEnvelopePostScope>()
    proofs = sourceProofs
    teamRunEnvelopePostProofStores.set(ctx, sourceProofs)
    ctx.teams.registerSystemEnvelopePostProofSource({
      name: TEAM_RUN_ENVELOPE_POST_PROOF_SOURCE,
      resolveEnvelopePostProof: proof => sourceProofs.get(proof),
    })
  }
  if (proofs === undefined) throw new Error('TeamRun human-input proof store was not initialized')
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('TeamRun human-input proofs are runtime-only') },
  })
  const opaque = Object.freeze(proof) as TeamSystemEnvelopePostProof
  proofs.set(opaque, scope)
  return Object.freeze({ proof: opaque, revoke: () => proofs.delete(opaque) })
}

/** Issue one test-only TeamRun interrupt proof for the exact durable human/coordinator topology. */
function teamRunInterruptActor(
  ctx: Context,
  scope: TeamSystemInterruptScope,
): { readonly proof: TeamSystemInterruptProof; revoke(): void } {
  let proofs = teamRunInterruptProofStores.get(ctx)
  if (proofs === undefined) {
    const sourceProofs = new WeakMap<TeamSystemInterruptProof, TeamSystemInterruptScope>()
    proofs = sourceProofs
    teamRunInterruptProofStores.set(ctx, sourceProofs)
    ctx.teams.registerSystemInterruptProofSource({
      name: TEAM_RUN_INTERRUPT_PROOF_SOURCE,
      resolveInterruptProof: proof => sourceProofs.get(proof),
    })
  }
  if (proofs === undefined) throw new Error('TeamRun interrupt proof store was not initialized')
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('TeamRun interrupt proofs are runtime-only') },
  })
  const opaque = Object.freeze(proof) as TeamSystemInterruptProof
  proofs.set(opaque, scope)
  return Object.freeze({ proof: opaque, revoke: () => proofs.delete(opaque) })
}

/** Commit one source-authorized human-to-coordinator soft interrupt for an exact durable topology. */
async function requestTeamRunInterrupt(ctx: Context, scope: TeamSystemInterruptScope) {
  const state = await ctx.teams.getTeam({ teamId: scope.teamId })
  const authority = teamRunInterruptActor(ctx, scope)
  try {
    return await ctx.teams.requestParticipantInterrupt({
      actor: authority.proof,
      teamId: scope.teamId,
      expectedCursor: state.team.cursor,
    })
  } finally {
    authority.revoke()
  }
}

/** Read pending soft interrupts through one transient proof for the exact durable target binding. */
async function pendingInterrupts(ctx: Context, binding: ActivationBindingSnapshot) {
  const lease = ctx.teams.openActivationActorProofIssuer().issue(binding)
  try {
    return await ctx.teams.listPendingParticipantInterrupts({ actor: lease.proof })
  } finally {
    lease.revoke()
  }
}

function hubConfig(ctx: Context): WebSocketHub.Config {
  return {
    path: '/team-link',
    endpoint: `ws://127.0.0.1:${String(ctx.webServer.port)}/team-link`,
    enrollmentProviderName: 'websocket',
    bindings: [],
    pageSize: 8,
    maxFrameBytes: 16 * 1024,
    maxConnections: 8,
    handshakeTimeoutMs: 1_000,
    maxPendingRequests: 8,
    maxQueuedBytes: 64 * 1024,
    maxOutstandingDeliveries: 8,
    requestWindowMs: 1_000,
    maxRequestsPerWindow: 32,
    closeTimeoutMs: 100,
    heartbeatIntervalMs: 1_000,
    heartbeatTimeoutMs: 100,
    retryableNackDelayMs: 1,
    backpressureRetryAfterMs: 100,
  }
}

describe('SDK remote Link enrollment', () => {
  it('delivers a post-bind direct Envelope through a dynamically issued capability and records its receipt', async () => {
    const root = await freshRoot('sdk-remote-link-host-')
    const childRoot = await freshRoot('sdk-remote-link-child-')
    const ctx = new Context()
    contexts.add(ctx)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
    await ctx.plugin(TeamHub)
    await ctx.plugin(TeamLinkRegistry)
    await ctx.plugin(DirectChannel)
    await ctx.plugin(AgentRuntime)
    await ctx.plugin(WebSocketHub, hubConfig(ctx))
    await ctx.plugin(SdkRuntime, {
      providerName: 'sdk',
      credential: 'sdk-remote-test-credential',
      command: process.execPath,
      args: ['--import', tsxLoader, fixture],
      cwd: process.cwd(),
      env: {
        CLOCKY_REMOTE_LINK_SESSION_ROOT: childRoot,
        TSX_TSCONFIG_PATH: repoTsconfig,
      },
      requestTimeoutMs: 5_000,
      shutdownTimeoutMs: 1_000,
      disposeEofGraceMs: 1_000,
      disposeGraceMs: 1_000,
      teamLinkEnrollmentProvider: 'websocket',
    })

    const created = await createTestRootTeam(ctx, { goal: { objective: 'Deliver remote input.', budgets: {} }, rules: {}, budgets: {} })
    const sender = await activeParticipant(ctx, created.team.id, 'local-agent', 'Sender')
    const recipient = await activeParticipant(ctx, created.team.id, 'remote-agent', 'Remote recipient')
    let state = await ctx.teams.getTeam({ teamId: created.team.id })
    let channel = await openTestChannel(ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: sender.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }],
      limits: {},
    })

    await ctx.plugin(TeamActivationController)
    const controller = ctx.teamActivations
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const lease = await controller.activate({
      teamId: created.team.id,
      participantId: recipient.id,
      expectedCursor: state.team.cursor,
      provider: 'sdk',
      sessionId: SessionId('sdk-remote-link-session'),
      seed: { kind: 'fresh' },
      agent: { options: { provider: 'mock', model: 'mock' } },
      signal: new AbortController().signal,
    })
    await activeActor(ctx, created.team.id, sender.id)
    channel = await acknowledgeTestChannelActivations(ctx, channel.manifest.id)

    const accepted = await ctx.teams.postChannelEnvelope({
      actor: await activeActor(ctx, created.team.id, sender.id),
      expectedCursor: channel.cursor,
      draft: {
        channelId: channel.manifest.id,
        audience: [recipient.id],
        kind: 'message',
        payload: { text: 'Persist this remote Envelope before its receipt.' },
        delivery: 'context',
      },
    })
    await vi.waitFor(async () => {
      const records = await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
      expect(records.records.some(record => record.type === 'channel/receipt'
        && record.participantId === recipient.id
        && record.envelopeId === accepted.id)).toBe(true)
    }, { interval: 20, timeout: 10_000 })

    await lease.dispose()
    await controller.close()
  }, 30_000)

  it('lets an SDK remote coordinator post team_final through its existing fixed Link without local Team authority', async () => {
    const root = await freshRoot('sdk-remote-final-host-')
    const childRoot = await freshRoot('sdk-remote-final-child-')
    const ctx = new Context()
    contexts.add(ctx)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
    await ctx.plugin(TeamHub)
    await ctx.plugin(TeamLinkRegistry)
    await ctx.plugin(DirectChannel)
    await ctx.plugin(AgentRuntime)
    await ctx.plugin(WebSocketHub, hubConfig(ctx))
    await ctx.plugin(SdkRuntime, {
      providerName: 'sdk',
      credential: 'sdk-remote-test-credential',
      command: process.execPath,
      args: ['--import', tsxLoader, fixture],
      cwd: process.cwd(),
      env: {
        CLOCKY_REMOTE_LINK_SESSION_ROOT: childRoot,
        TSX_TSCONFIG_PATH: repoTsconfig,
      },
      requestTimeoutMs: 5_000,
      shutdownTimeoutMs: 1_000,
      disposeEofGraceMs: 1_000,
      disposeGraceMs: 1_000,
      teamLinkEnrollmentProvider: 'websocket',
    })

    const created = await createTestRootTeam(ctx, { goal: { objective: 'Receive a remote coordinator final.', budgets: {} }, rules: {}, budgets: {} })
    const human = await activeParticipant(ctx, created.team.id, 'local-agent', 'Human')
    const coordinator = await activeParticipant(ctx, created.team.id, 'remote-agent', 'Remote coordinator')
    let state = await ctx.teams.getTeam({ teamId: created.team.id })
    let channel = await openTestChannel(ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: DirectChannel.DIRECT_CHANNEL_ADAPTER_V3,
      participants: [{ id: human.id, role: 'human' }, { id: coordinator.id, role: 'coordinator' }],
      limits: {},
    })
    await ctx.plugin(TeamActivationController)
    const controller = ctx.teamActivations
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const lease = await controller.activate({
      teamId: created.team.id,
      participantId: coordinator.id,
      expectedCursor: state.team.cursor,
      provider: 'sdk',
      sessionId: SessionId('sdk-remote-final-session'),
      seed: { kind: 'fresh' },
      agent: { options: { provider: 'mock', model: 'mock' } },
      signal: new AbortController().signal,
    })
    await activeActor(ctx, created.team.id, human.id)
    channel = await acknowledgeTestChannelActivations(ctx, channel.manifest.id)
    const accepted = await ctx.teams.postChannelEnvelope({
      actor: await activeActor(ctx, created.team.id, human.id),
      expectedCursor: channel.cursor,
      draft: {
        channelId: channel.manifest.id,
        audience: [coordinator.id],
        kind: 'message',
        payload: { content: [{ type: 'text', text: 'Emit a remote final.' }] },
        delivery: 'turn',
      },
    })
    await vi.waitFor(async () => {
      const records = await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
      expect(records.records.some(record => record.type === 'channel/receipt'
        && record.participantId === coordinator.id
        && record.envelopeId === accepted.id)).toBe(true)
      expect(records.records.filter(record => record.type === 'channel/envelope').map(record => record.envelope)).toContainEqual(expect.objectContaining({
        senderId: coordinator.id,
        audience: [human.id],
        kind: 'final',
        payload: { text: 'SDK remote coordinator final.' },
        delivery: 'turn',
      }))
    }, { interval: 20, timeout: 10_000 })

    await lease.dispose()
    await controller.close()
  }, 30_000)

  it('runs an SDK child task assignment through its existing Link and settles the remote worker attempt', async () => {
    const root = await freshRoot('sdk-remote-task-host-')
    const childRoot = await freshRoot('sdk-remote-task-child-')
    const ctx = new Context()
    contexts.add(ctx)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
    await ctx.plugin(TeamHub)
    await ctx.plugin(TeamLinkRegistry)
    await ctx.plugin(TaskAssignmentChannel)
    await ctx.plugin(AgentRuntime)
    await ctx.plugin(WebSocketHub, hubConfig(ctx))
    await ctx.plugin(SdkRuntime, {
      providerName: 'sdk',
      credential: 'sdk-remote-test-credential',
      command: process.execPath,
      args: ['--import', tsxLoader, fixture],
      cwd: process.cwd(),
      env: {
        CLOCKY_REMOTE_LINK_SESSION_ROOT: childRoot,
        TSX_TSCONFIG_PATH: repoTsconfig,
      },
      requestTimeoutMs: 5_000,
      shutdownTimeoutMs: 1_000,
      disposeEofGraceMs: 1_000,
      disposeGraceMs: 1_000,
      teamLinkEnrollmentProvider: 'websocket',
    })

    const created = await createTestRootTeam(ctx, { goal: { objective: 'Complete one remote task.', budgets: {} }, rules: {}, budgets: {} })
    const worker = await activeParticipant(ctx, created.team.id, 'remote-agent', 'Remote worker')
    const coordinator = await activeParticipant(ctx, created.team.id, 'local-agent', 'Coordinator', 'coordinator')
    await ctx.plugin(TeamActivationController)
    const controller = ctx.teamActivations
    const coordinatorActor = await activeActor(ctx, created.team.id, coordinator.id)
    let state = await ctx.teams.getTeam({ teamId: created.team.id })
    const lease = await controller.activate({
      teamId: created.team.id,
      participantId: worker.id,
      expectedCursor: state.team.cursor,
      provider: 'sdk',
      sessionId: SessionId('sdk-remote-task-session'),
      seed: { kind: 'fresh' },
      agent: { options: { provider: 'mock', model: 'mock' } },
      signal: new AbortController().signal,
    })
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const task = await ctx.teams.createTask({
      actor: coordinatorActor,
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('remote-link-completion-task') },
      subject: 'Report remote task completion.',
      description: 'Use team_task_report through the assigned remote Team Link.',
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
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const channel = await openTestChannel(ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: TaskAssignmentChannel.TASK_ASSIGNMENT_CHANNEL_ADAPTER,
      participants: [{ id: worker.id, role: TaskAssignmentChannel.TASK_ASSIGNMENT_ASSIGNEE_ROLE }],
      limits: {
        taskId: task.id,
        activationId: lease.binding.activation.id,
        sessionId: lease.binding.sessionId,
      },
    })
    await acknowledgeTestChannelActivations(ctx, channel.manifest.id)
    const assigned = await assignSchedulerLease(ctx, {
      teamId: created.team.id,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: worker.id,
      activationId: lease.binding.activation.id,
      wakeChannelId: channel.manifest.id,
      leaseDurationMs: 5_000,
    })
    const taskLease = assigned.lease
    if (taskLease === undefined) throw new Error('remote task assignment did not retain a lease')
    const currentChannel = await ctx.teams.getChannel({ channelId: channel.manifest.id })
    await ctx.teams.postChannelEnvelope({
      actor: schedulerPostActor(ctx, {
        kind: 'scheduler-assignment',
        teamId: created.team.id,
        channelId: channel.manifest.id,
        taskId: task.id,
        attemptId: taskLease.attemptId,
        assignedRevision: taskLease.assignedRevision,
        assigneeId: worker.id,
        activationId: lease.binding.activation.id,
        sessionId: lease.binding.sessionId,
      }),
      expectedCursor: currentChannel.cursor,
      draft: {
        channelId: channel.manifest.id,
        audience: [worker.id],
        kind: TaskAssignmentChannel.TASK_ASSIGNMENT_ENVELOPE_KIND,
        payload: {
          taskId: task.id,
          attemptId: taskLease.attemptId,
          assignedRevision: taskLease.assignedRevision,
          activationId: lease.binding.activation.id,
          sessionId: lease.binding.sessionId,
        },
        delivery: 'turn',
        taskId: task.id,
      },
    })
    await vi.waitFor(async () => {
      await expect(ctx.teams.getTask({ teamId: created.team.id, taskId: task.id })).resolves.toMatchObject({
        phase: 'completed',
        revision: assigned.revision + 2,
        attemptHistory: [{
          id: taskLease.attemptId,
          outcome: { kind: 'completed', result: { summary: 'SDK remote worker completed its assigned task.' } },
        }],
      })
    }, { interval: 20, timeout: 10_000 })

    await lease.dispose()
    await controller.close()
  }, 30_000)

  it('settles dependent Team tasks through separately spawned SDK children with isolated Session storage', async () => {
    const root = await freshRoot('sdk-remote-handoff-host-')
    const firstChildRoot = await freshRoot('sdk-remote-handoff-first-child-')
    const secondChildRoot = await freshRoot('sdk-remote-handoff-second-child-')
    const ctx = new Context()
    contexts.add(ctx)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
    await ctx.plugin(TeamHub)
    await ctx.plugin(TeamLinkRegistry)
    await ctx.plugin(TaskAssignmentChannel)
    await ctx.plugin(AgentRuntime)
    await ctx.plugin(WebSocketHub, hubConfig(ctx))
    for (const [providerName, childRoot] of [
      ['sdk-first', firstChildRoot],
      ['sdk-second', secondChildRoot],
    ] as const) {
      await ctx.plugin(SdkRuntime, {
        providerName,
        credential: 'sdk-remote-test-credential',
        command: process.execPath,
        args: ['--import', tsxLoader, fixture],
        cwd: process.cwd(),
        env: {
          CLOCKY_REMOTE_LINK_SESSION_ROOT: childRoot,
          TSX_TSCONFIG_PATH: repoTsconfig,
        },
        requestTimeoutMs: 5_000,
        shutdownTimeoutMs: 1_000,
        disposeEofGraceMs: 1_000,
        disposeGraceMs: 1_000,
        teamLinkEnrollmentProvider: 'websocket',
      })
    }

    const created = await createTestRootTeam(ctx, { goal: { objective: 'Complete a remote task handoff.', budgets: {} }, rules: {}, budgets: {} })
    const firstWorker = await activeParticipant(ctx, created.team.id, 'remote-agent', 'First remote worker')
    const secondWorker = await activeParticipant(ctx, created.team.id, 'remote-agent', 'Second remote worker')
    const coordinator = await activeParticipant(ctx, created.team.id, 'local-agent', 'Coordinator', 'coordinator')
    await ctx.plugin(TeamActivationController)
    const controller = ctx.teamActivations
    let state = await ctx.teams.getTeam({ teamId: created.team.id })
    const firstLease = await controller.activate({
      teamId: created.team.id,
      participantId: firstWorker.id,
      expectedCursor: state.team.cursor,
      provider: 'sdk-first',
      sessionId: SessionId('sdk-remote-handoff-first-session'),
      seed: { kind: 'fresh' },
      agent: { options: { provider: 'mock', model: 'mock' } },
      signal: new AbortController().signal,
    })
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const secondLease = await controller.activate({
      teamId: created.team.id,
      participantId: secondWorker.id,
      expectedCursor: state.team.cursor,
      provider: 'sdk-second',
      sessionId: SessionId('sdk-remote-handoff-second-session'),
      seed: { kind: 'fresh' },
      agent: { options: { provider: 'mock', model: 'mock' } },
      signal: new AbortController().signal,
    })
    const coordinatorActor = await activeActor(ctx, created.team.id, coordinator.id)

    const createTask = async (subject: string, blockedBy: readonly TeamTaskId[]) => {
      const current = await ctx.teams.getTeam({ teamId: created.team.id })
      return await ctx.teams.createTask({
        actor: coordinatorActor,
        teamId: created.team.id,
        expectedCursor: current.team.cursor,
        createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`remote-link-handoff:${subject}`) },
        subject,
        description: 'Report completion through the assigned remote Team Link.',
        blockedBy,
        requiredCapabilities: [],
        priority: 0,
        readScopes: [],
        writeScopes: [],
        workspaceMode: 'shared',
        budget: {},
        reviewPolicy: { kind: 'none' },
        maxAttempts: 1,
      })
    }
    const firstTask = await createTask('Complete the first remote task.', [])
    const secondTask = await createTask('Complete the dependent remote task.', [firstTask.id])
    const assign = async (task: typeof firstTask, worker: typeof firstWorker, lease: typeof firstLease) => {
      const current = await ctx.teams.getTeam({ teamId: created.team.id })
      const channel = await openTestChannel(ctx, {
        teamId: created.team.id,
        expectedCursor: current.team.cursor,
        adapter: TaskAssignmentChannel.TASK_ASSIGNMENT_CHANNEL_ADAPTER,
        participants: [{ id: worker.id, role: TaskAssignmentChannel.TASK_ASSIGNMENT_ASSIGNEE_ROLE }],
        limits: {
          taskId: task.id,
          activationId: lease.binding.activation.id,
          sessionId: lease.binding.sessionId,
        },
      })
      await acknowledgeTestChannelActivations(ctx, channel.manifest.id)
      const assigned = await assignSchedulerLease(ctx, {
        teamId: created.team.id,
        taskId: task.id,
        expectedRevision: task.revision,
        participantId: worker.id,
        activationId: lease.binding.activation.id,
        wakeChannelId: channel.manifest.id,
        leaseDurationMs: 5_000,
      })
      const taskLease = assigned.lease
      if (taskLease === undefined) throw new Error('remote task assignment did not retain a lease')
      const currentChannel = await ctx.teams.getChannel({ channelId: channel.manifest.id })
      await ctx.teams.postChannelEnvelope({
        actor: schedulerPostActor(ctx, {
          kind: 'scheduler-assignment',
          teamId: created.team.id,
          channelId: channel.manifest.id,
          taskId: task.id,
          attemptId: taskLease.attemptId,
          assignedRevision: taskLease.assignedRevision,
          assigneeId: worker.id,
          activationId: lease.binding.activation.id,
          sessionId: lease.binding.sessionId,
        }),
        expectedCursor: currentChannel.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [worker.id],
          kind: TaskAssignmentChannel.TASK_ASSIGNMENT_ENVELOPE_KIND,
          payload: {
            taskId: task.id,
            attemptId: taskLease.attemptId,
            assignedRevision: taskLease.assignedRevision,
            activationId: lease.binding.activation.id,
            sessionId: lease.binding.sessionId,
          },
          delivery: 'turn',
          taskId: task.id,
        },
      })
      return assigned
    }

    await expect(assign(secondTask, secondWorker, secondLease)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const firstAssigned = await assign(firstTask, firstWorker, firstLease)
    await vi.waitFor(async () => {
      await expect(ctx.teams.getTask({ teamId: created.team.id, taskId: firstTask.id })).resolves.toMatchObject({
        phase: 'completed',
        revision: firstAssigned.revision + 2,
        attemptHistory: [{ outcome: { kind: 'completed', result: { summary: 'SDK remote worker completed its assigned task.' } } }],
      })
    }, { interval: 20, timeout: 10_000 })

    const secondAssigned = await assign(secondTask, secondWorker, secondLease)
    await vi.waitFor(async () => {
      await expect(ctx.teams.getTask({ teamId: created.team.id, taskId: secondTask.id })).resolves.toMatchObject({
        phase: 'completed',
        revision: secondAssigned.revision + 2,
        attemptHistory: [{ outcome: { kind: 'completed', result: { summary: 'SDK remote worker completed its assigned task.' } } }],
      })
    }, { interval: 20, timeout: 10_000 })
    expect(firstLease.binding.provider).toBe('sdk-first')
    expect(secondLease.binding.provider).toBe('sdk-second')
    expect(firstLease.binding.sessionId).not.toBe(secondLease.binding.sessionId)
    expect(firstChildRoot).not.toBe(secondChildRoot)
    expect(await readdir(firstChildRoot)).not.toEqual([])
    expect(await readdir(secondChildRoot)).not.toEqual([])

    await secondLease.dispose()
    await firstLease.dispose()
    await controller.close()
  }, 45_000)

  it('delivers a Hub soft interrupt to its exact SDK child over a v4 fixed Link and durably acknowledges it', async () => {
    const root = await freshRoot('sdk-remote-interrupt-host-')
    const childRoot = await freshRoot('sdk-remote-interrupt-child-')
    const ctx = new Context()
    contexts.add(ctx)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
    await ctx.plugin(TeamHub)
    await ctx.plugin(TeamLinkRegistry)
    await ctx.plugin(DirectChannel)
    await ctx.plugin(AgentRuntime)
    await ctx.plugin(WebSocketHub, hubConfig(ctx))
    await ctx.plugin(SdkRuntime, {
      providerName: 'sdk',
      credential: 'sdk-remote-test-credential',
      command: process.execPath,
      args: ['--import', tsxLoader, fixture],
      cwd: process.cwd(),
      env: {
        CLOCKY_REMOTE_LINK_SESSION_ROOT: childRoot,
        TSX_TSCONFIG_PATH: repoTsconfig,
      },
      requestTimeoutMs: 5_000,
      shutdownTimeoutMs: 1_000,
      disposeEofGraceMs: 1_000,
      disposeGraceMs: 1_000,
      teamLinkEnrollmentProvider: 'websocket',
    })

    const created = await createTestRootTeam(ctx, { goal: { objective: 'Interrupt one remote coordinator.', budgets: {} }, rules: {}, budgets: {} })
    const human = await activeParticipant(ctx, created.team.id, 'human', 'Human', 'human')
    const target = await activeParticipant(ctx, created.team.id, 'remote-agent', 'Interrupted coordinator', 'coordinator')
    const other = await activeParticipant(ctx, created.team.id, 'remote-agent', 'Other coordinator', 'coordinator')
    let state = await ctx.teams.getTeam({ teamId: created.team.id })
    const targetChannel = await openTestChannel(ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: DirectChannel.DIRECT_CHANNEL_ADAPTER_V4,
      participants: [{ id: human.id, role: 'human' }, { id: target.id, role: 'coordinator' }],
      limits: {},
    })
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const otherChannel = await openTestChannel(ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: DirectChannel.DIRECT_CHANNEL_ADAPTER_V4,
      participants: [{ id: human.id, role: 'human' }, { id: other.id, role: 'coordinator' }],
      limits: {},
    })
    await ctx.plugin(TeamActivationController)
    const controller = ctx.teamActivations
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const targetLease = await controller.activate({
      teamId: created.team.id,
      participantId: target.id,
      expectedCursor: state.team.cursor,
      provider: 'sdk',
      sessionId: SessionId('sdk-remote-interrupt-target'),
      seed: { kind: 'fresh' },
      agent: { options: { provider: 'mock', model: 'mock' } },
      signal: new AbortController().signal,
    })
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const otherLease = await controller.activate({
      teamId: created.team.id,
      participantId: other.id,
      expectedCursor: state.team.cursor,
      provider: 'sdk',
      sessionId: SessionId('sdk-remote-interrupt-other'),
      seed: { kind: 'fresh' },
      agent: { options: { provider: 'mock', model: 'mock' } },
      signal: new AbortController().signal,
    })
    await acknowledgeTestChannelActivations(ctx, targetChannel.manifest.id)
    await acknowledgeTestChannelActivations(ctx, otherChannel.manifest.id)
    await acknowledgeSystemHumanChannel(ctx, targetChannel.manifest.id, human.id)
    await acknowledgeSystemHumanChannel(ctx, otherChannel.manifest.id, human.id)
    const post = async (channelId: string, recipientId: typeof target.id, text: string) => {
      const channel = await ctx.teams.getChannel({ channelId: channelId as never })
      const authority = teamRunHumanInputActor(ctx, {
        kind: 'team-run-human-input',
        teamId: created.team.id,
        channelId: channel.manifest.id,
        humanId: human.id,
        coordinatorId: recipientId,
      })
      try {
        return await ctx.teams.postChannelEnvelope({
          actor: authority.proof,
          expectedCursor: channel.cursor,
          draft: {
            channelId: channel.manifest.id,
            audience: [recipientId],
            kind: 'message',
            payload: { content: [{ type: 'text', text }] },
            delivery: 'turn',
          },
        })
      } finally {
        authority.revoke()
      }
    }
    const waitForReceipt = async (channelId: string, envelopeId: string, recipientId: typeof target.id) => {
      await vi.waitFor(async () => {
        const records = await ctx.teams.readChannel({ channelId: channelId as never, afterCursor: -1 })
        expect(records.records.some(record => record.type === 'channel/receipt'
          && record.participantId === recipientId
          && record.envelopeId === envelopeId)).toBe(true)
      }, { interval: 20, timeout: 10_000 })
    }

    const otherEnvelope = await post(otherChannel.manifest.id, other.id, 'Confirm this separate fixed Link.')
    await waitForReceipt(otherChannel.manifest.id, otherEnvelope.id, other.id)
    const targetEnvelope = await post(targetChannel.manifest.id, target.id, 'Wait for a remote soft interrupt.')
    await waitForReceipt(targetChannel.manifest.id, targetEnvelope.id, target.id)
    await vi.waitFor(async () => {
      await expect(targetLease.health()).resolves.toMatchObject({ activation: { status: 'running' } })
    }, { interval: 20, timeout: 10_000 })

    const interrupt = await requestTeamRunInterrupt(ctx, {
      kind: 'team-run-human-interrupt',
      teamId: created.team.id,
      channelId: targetChannel.manifest.id,
      humanId: human.id,
      coordinatorId: target.id,
    })
    expect(interrupt.target).toEqual({
      teamId: targetLease.binding.activation.teamId,
      participantId: targetLease.binding.activation.participantId,
      activationId: targetLease.binding.activation.id,
      sessionId: targetLease.binding.sessionId,
      provider: targetLease.binding.provider,
    })
    await vi.waitFor(async () => {
      await expect(pendingInterrupts(ctx, targetLease.binding)).resolves.toEqual([])
      await expect(targetLease.health()).resolves.toMatchObject({ activation: { status: 'idle' } })
      await expect(otherLease.health()).resolves.toMatchObject({ activation: { status: 'idle' } })
    }, { interval: 20, timeout: 10_000 })
    const journal = ctx.storageLog.get(`team/${created.team.id}`)
    if (journal === undefined) throw new Error('Team journal is not open')
    const entries = await journal.read(-1, 128)
    expect(entries.map(entry => entry.value)).toContainEqual(expect.objectContaining({
      type: 'participant-interrupt/acknowledged',
      interruptId: interrupt.id,
      target: interrupt.target,
    }))

    await otherLease.dispose()
    await targetLease.dispose()
    await controller.close()
  }, 45_000)

  it('fences a recovered SDK child before resuming its Session under a new binding and Link', async () => {
    const root = await freshRoot('sdk-remote-recovery-host-')
    const childRoot = await freshRoot('sdk-remote-recovery-child-')
    const first = new Context()
    contexts.add(first)
    await first.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await first.plugin(Storage)
    await first.plugin(StorageJson, { root })
    await first.plugin(StorageLog, { backend: 'json', routes: {} })
    await first.plugin(TeamHub)
    await first.plugin(TeamLinkRegistry)
    await first.plugin(DirectChannel)
    await first.plugin(AgentRuntime)
    await first.plugin(WebSocketHub, hubConfig(first))
    await first.plugin(SdkRuntime, {
      providerName: 'sdk',
      credential: 'sdk-remote-test-credential',
      command: process.execPath,
      args: ['--import', tsxLoader, fixture],
      cwd: process.cwd(),
      env: {
        CLOCKY_REMOTE_LINK_SESSION_ROOT: childRoot,
        TSX_TSCONFIG_PATH: repoTsconfig,
      },
      requestTimeoutMs: 5_000,
      shutdownTimeoutMs: 1_000,
      disposeEofGraceMs: 1_000,
      disposeGraceMs: 1_000,
      teamLinkEnrollmentProvider: 'websocket',
      recoveryProfile: 'sdk-remote-recovery-e2e',
      recoveryHostId: 'test-host',
      recoveryFenceGraceMs: 500,
    })

    const created = await createTestRootTeam(first, { goal: { objective: 'Recover one remote Session.', budgets: {} }, rules: {}, budgets: {} })
    const sender = await activeParticipant(first, created.team.id, 'local-agent', 'Sender')
    const recipient = await activeParticipant(first, created.team.id, 'remote-agent', 'Recoverable recipient')
    const coordinator = await activeParticipant(first, created.team.id, 'local-agent', 'Coordinator', 'coordinator')
    let state = await first.teams.getTeam({ teamId: created.team.id })
    const channel = await openTestChannel(first, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: sender.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }],
      limits: {},
    })
    await first.plugin(TeamActivationController)
    const firstController = first.teamActivations
    state = await first.teams.getTeam({ teamId: created.team.id })
    const oldLease = await firstController.activate({
      teamId: created.team.id,
      participantId: recipient.id,
      expectedCursor: state.team.cursor,
      provider: 'sdk',
      sessionId: SessionId('sdk-remote-recovery-session'),
      seed: { kind: 'fresh' },
      agent: { options: { provider: 'mock', model: 'mock' } },
      signal: new AbortController().signal,
    })
    await activeActor(first, created.team.id, sender.id)
    await acknowledgeTestChannelActivations(first, channel.manifest.id)
    const oldRecovery = oldLease.binding.recovery
    if (oldRecovery === undefined) throw new Error('recovery-enabled SDK activation did not persist a recovery plan')
    if (oldRecovery.kind !== 'sdk-local-cold-replace') throw new Error('recovery-enabled SDK activation returned an ACP plan')
    const coordinatorActor = await activeActor(first, created.team.id, coordinator.id)
    state = await first.teams.getTeam({ teamId: created.team.id })
    const staleTask = await first.teams.createTask({
      actor: coordinatorActor,
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('remote-link-recovery-task') },
      subject: 'Release the fenced remote lease.',
      description: 'This assignment remains undelivered when the Hub restarts.',
      blockedBy: [],
      requiredCapabilities: [],
      priority: 0,
      readScopes: [],
      writeScopes: [],
      workspaceMode: 'shared',
      budget: {},
      reviewPolicy: { kind: 'none' },
      maxAttempts: 2,
    })
    state = await first.teams.getTeam({ teamId: created.team.id })
    const staleAssigned = await assignSchedulerLease(first, {
      teamId: created.team.id,
      taskId: staleTask.id,
      expectedRevision: staleTask.revision,
      participantId: recipient.id,
      activationId: oldLease.binding.activation.id,
      leaseDurationMs: 10_000,
    })
    const staleLease = staleAssigned.lease
    if (staleLease === undefined) throw new Error('fenced recovery test task did not retain a lease')
    await first.fiber.dispose()
    contexts.delete(first)

    const second = new Context()
    contexts.add(second)
    await second.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await second.plugin(Storage)
    await second.plugin(StorageJson, { root })
    await second.plugin(StorageLog, { backend: 'json', routes: {} })
    await second.plugin(TeamHub)
    await second.plugin(TeamLinkRegistry)
    await second.plugin(DirectChannel)
    await second.plugin(AgentRuntime)
    await second.plugin(WebSocketHub, hubConfig(second))
    await second.plugin(SdkRuntime, {
      providerName: 'sdk',
      credential: 'sdk-remote-test-credential',
      command: process.execPath,
      args: ['--import', tsxLoader, fixture],
      cwd: process.cwd(),
      env: {
        CLOCKY_REMOTE_LINK_SESSION_ROOT: childRoot,
        TSX_TSCONFIG_PATH: repoTsconfig,
      },
      requestTimeoutMs: 5_000,
      shutdownTimeoutMs: 1_000,
      disposeEofGraceMs: 1_000,
      disposeGraceMs: 1_000,
      teamLinkEnrollmentProvider: 'websocket',
      recoveryProfile: 'sdk-remote-recovery-e2e',
      recoveryHostId: 'test-host',
      recoveryFenceGraceMs: 500,
    })
    await second.plugin(TeamActivationController)
    const secondController = second.teamActivations
    const replacement = await secondController.coldReplace({
      teamId: created.team.id,
      participantId: recipient.id,
      activationId: oldLease.binding.activation.id,
      signal: new AbortController().signal,
    })
    expect(replacement.binding.activation.id).not.toBe(oldLease.binding.activation.id)
    expect(replacement.binding.sessionId).toBe(oldLease.binding.sessionId)
    expect(replacement.binding.recovery).toMatchObject({
      profile: oldRecovery.profile,
      agent: oldRecovery.agent,
    })

    const currentChannel = await second.teams.getChannel({ channelId: channel.manifest.id })
    const accepted = await second.teams.postChannelEnvelope({
      actor: await activeActor(second, created.team.id, sender.id),
      expectedCursor: currentChannel.cursor,
      draft: {
        channelId: channel.manifest.id,
        audience: [recipient.id],
        kind: 'message',
        payload: { text: 'Deliver this only after SDK cold replacement.' },
        delivery: 'context',
      },
    })
    await vi.waitFor(async () => {
      const records = await second.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
      expect(records.records.filter(record => record.type === 'channel/receipt' && record.envelopeId === accepted.id)).toHaveLength(1)
    }, { interval: 20, timeout: 10_000 })

    const recovered = await second.teams.getTeam({ teamId: created.team.id })
    expect(recovered.activations.find(binding => binding.activation.id === oldLease.binding.activation.id))
      .toMatchObject({ activation: { status: 'offline' } })
    const releasedTask = recovered.tasks.find(task => task.id === staleTask.id)
    expect(releasedTask).toMatchObject({
      phase: 'pending',
      attemptHistory: [{ id: staleLease.attemptId, outcome: { kind: 'released' } }],
    })
    expect(releasedTask?.lease).toBeUndefined()
    await replacement.dispose()
    await secondController.close()
  }, 60_000)

  it('re-enrolls one current SDK activation after the WebSocket issuer reloads', async () => {
    const root = await freshRoot('sdk-remote-link-hmr-host-')
    const childRoot = await freshRoot('sdk-remote-link-hmr-child-')
    const ctx = new Context()
    contexts.add(ctx)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
    await ctx.plugin(TeamHub)
    await ctx.plugin(TeamLinkRegistry)
    await ctx.plugin(DirectChannel)
    await ctx.plugin(AgentRuntime)
    let hub = await ctx.plugin(WebSocketHub, hubConfig(ctx))
    await ctx.plugin(SdkRuntime, {
      providerName: 'sdk',
      credential: 'sdk-remote-test-credential',
      command: process.execPath,
      args: ['--import', tsxLoader, fixture],
      cwd: process.cwd(),
      env: {
        CLOCKY_REMOTE_LINK_SESSION_ROOT: childRoot,
        TSX_TSCONFIG_PATH: repoTsconfig,
      },
      requestTimeoutMs: 5_000,
      shutdownTimeoutMs: 1_000,
      disposeEofGraceMs: 1_000,
      disposeGraceMs: 1_000,
      teamLinkEnrollmentProvider: 'websocket',
    })

    const created = await createTestRootTeam(ctx, { goal: { objective: 'Re-enroll remote delivery.', budgets: {} }, rules: {}, budgets: {} })
    const sender = await activeParticipant(ctx, created.team.id, 'local-agent', 'Sender')
    const recipient = await activeParticipant(ctx, created.team.id, 'remote-agent', 'Remote recipient')
    let state = await ctx.teams.getTeam({ teamId: created.team.id })
    const channel = await openTestChannel(ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: sender.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }],
      limits: {},
    })
    await ctx.plugin(TeamActivationController)
    const controller = ctx.teamActivations
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const lease = await controller.activate({
      teamId: created.team.id,
      participantId: recipient.id,
      expectedCursor: state.team.cursor,
      provider: 'sdk',
      sessionId: SessionId('sdk-remote-link-hmr-session'),
      seed: { kind: 'fresh' },
      agent: { options: { provider: 'mock', model: 'mock' } },
      signal: new AbortController().signal,
    })
    await activeActor(ctx, created.team.id, sender.id)
    await acknowledgeTestChannelActivations(ctx, channel.manifest.id)

    const post = async (text: string) => {
      const current = await ctx.teams.getChannel({ channelId: channel.manifest.id })
      return await ctx.teams.postChannelEnvelope({
        actor: await activeActor(ctx, created.team.id, sender.id),
        expectedCursor: current.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [recipient.id],
          kind: 'message',
          payload: { text },
          delivery: 'context',
        },
      })
    }
    const first = await post('Before WebSocket issuer reload.')
    await vi.waitFor(async () => {
      const records = await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
      expect(records.records.some(record => record.type === 'channel/receipt'
        && record.participantId === recipient.id
        && record.envelopeId === first.id)).toBe(true)
    }, { interval: 20, timeout: 10_000 })

    await hub.dispose()
    hub = await ctx.plugin(WebSocketHub, hubConfig(ctx))
    const second = await post('After WebSocket issuer reload.')
    await vi.waitFor(async () => {
      const records = await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
      expect(records.records.some(record => record.type === 'channel/receipt'
        && record.participantId === recipient.id
        && record.envelopeId === second.id)).toBe(true)
    }, { interval: 20, timeout: 10_000 })
    const current = await ctx.teams.getActivation({ teamId: created.team.id, activationId: lease.binding.activation.id })
    expect(current.activation.id).toBe(lease.binding.activation.id)

    await hub.dispose()
    await lease.dispose()
    await controller.close()
  }, 45_000)
})
