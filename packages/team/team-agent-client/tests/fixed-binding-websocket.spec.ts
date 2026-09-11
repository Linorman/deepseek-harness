import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { acknowledgeTestChannelActivations, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import WebServer from '@clocky/clocky-host-webserver'
import { SessionId } from '@clocky/clocky-session'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import { activationIdSchema, channelInvitationIdempotencyKeySchema, fingerprintChannelManifest } from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ParticipantSnapshot,
  TeamEnvelope,
  TeamSystemActivationProof,
  TeamSystemActivationScope,
  TeamSystemChannelAdmissionProof,
  TeamSystemChannelAdmissionScope,
  TeamSystemInterruptProof,
  TeamSystemInterruptScope,
} from '@clocky/clocky-team'
import TeamHub from '@clocky/clocky-team-hub'
import TeamLinkRegistry from '@clocky/clocky-team-link'
import * as DirectChannel from '@clocky/clocky-team-channel-direct'
import * as WebSocketHub from '@clocky/clocky-team-link-websocket-hub'

const contexts = new Set<Context>()
const roots: string[] = []
const children = new Set<FixedBindingChild>()
const capabilityEnv = 'CLOCKY_TEAM_AGENT_CLIENT_WEBSOCKET_E2E_CAPABILITY'
const capability = 'fixed-binding-websocket-capability'
const childScript = fileURLToPath(new URL('./fixtures/fixed-binding-websocket-child.ts', import.meta.url))
const tsxLoader = fileURLToPath(import.meta.resolve('tsx'))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
const deadlineMs = 5_000
const TEAM_RUN_INTERRUPT_PROOF_SOURCE = 'team-run'
const TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE = 'team-activation-controller'
type ControllerActivationBindScope = Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-bind' }>
const teamRunInterruptProofStores = new WeakMap<Context, WeakMap<TeamSystemInterruptProof, TeamSystemInterruptScope>>()
const channelAdmissionProofStores = new WeakMap<Context, WeakMap<TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope>>()
const activationProofStores = new WeakMap<Context, WeakMap<TeamSystemActivationProof, ControllerActivationBindScope>>()
let priorCapability: string | undefined

interface Fixture {
  readonly ctx: Context
  readonly childRoot: string
  readonly sender: ParticipantSnapshot
  readonly recipient: ParticipantSnapshot
  readonly channelId: string
  readonly senderBinding: ActivationBindingSnapshot
  readonly binding: ActivationBindingSnapshot
}

type ChildCommand =
  | { readonly kind: 'boot'; readonly endpoint: string; readonly binding: ActivationBindingSnapshot; readonly persistenceRoot: string }
  | { readonly kind: 'drop' | 'drop-interrupt-ack' | 'release-receipt' | 'start-turn' | 'wait-interrupted' | 'observed' | 'close' }

type ChildMessage =
  | { readonly kind: 'ready' }
  | { readonly kind: 'booted' | 'dropped' | 'released' | 'turn-started' | 'interrupted' | 'closed'; readonly requestId: number }
  | { readonly kind: 'persisted'; readonly envelopeId: string; readonly durableEnvelopeIds: readonly string[] }
  | { readonly kind: 'observed'; readonly requestId: number; readonly durableEnvelopeIds: readonly string[] }
  | { readonly kind: 'error'; readonly requestId: number; readonly message: string }

interface Request {
  readonly resolve: (message: ChildMessage) => void
  readonly reject: (error: Error) => void
}

interface Waiter {
  readonly predicate: (message: ChildMessage) => boolean
  readonly resolve: (message: ChildMessage) => void
  readonly reject: (error: Error) => void
}

afterEach(async () => {
  const failures: unknown[] = []
  for (const child of [...children]) {
    try {
      await child.dispose()
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  children.clear()
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
  if (priorCapability === undefined) process.env[capabilityEnv] = undefined
  else process.env[capabilityEnv] = priorCapability
  priorCapability = undefined
  if (failures.length > 0) throw new AggregateError(failures, 'fixed-binding WebSocket test cleanup failed')
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requestId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('child IPC requestId must be a non-negative safe integer')
  }
  return value
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`child IPC ${field} must be a non-empty string`)
  return value
}

function textArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`child IPC ${field} must be a string array`)
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') throw new Error(`child IPC ${field} must be a string array`)
    items.push(item)
  }
  return items
}

function parseMessage(value: unknown): ChildMessage {
  if (!isRecord(value) || typeof value.kind !== 'string') throw new Error('child IPC message must have a kind')
  switch (value.kind) {
    case 'ready': return { kind: 'ready' }
    case 'booted':
    case 'dropped':
    case 'released':
    case 'turn-started':
    case 'interrupted':
    case 'closed': return { kind: value.kind, requestId: requestId(value.requestId) }
    case 'persisted': return {
      kind: 'persisted',
      envelopeId: text(value.envelopeId, 'envelopeId'),
      durableEnvelopeIds: textArray(value.durableEnvelopeIds, 'durableEnvelopeIds'),
    }
    case 'observed': return {
      kind: 'observed',
      requestId: requestId(value.requestId),
      durableEnvelopeIds: textArray(value.durableEnvelopeIds, 'durableEnvelopeIds'),
    }
    case 'error': return { kind: 'error', requestId: requestId(value.requestId), message: text(value.message, 'message') }
    default: throw new Error('child IPC message kind is invalid')
  }
}

async function withDeadline<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(`${label} exceeded ${String(deadlineMs)}ms`)) }, deadlineMs)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

class FixedBindingChild {
  private readonly messages: ChildMessage[] = []
  private readonly waiters = new Set<Waiter>()
  private readonly requests = new Map<number, Request>()
  private readonly exited = Promise.withResolvers<undefined>()
  private readonly stderr: string[] = []
  private requestSequence = 0
  private failed: Error | undefined
  private exitedCleanly = false
  private disposing: Promise<void> | undefined

  constructor(private readonly child: ChildProcess) {
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => { this.stderr.push(chunk) })
    child.on('message', (value: unknown) => { this.accept(value) })
    child.once('error', (error) => { this.fail(this.diagnostic(error.message)) })
    child.once('exit', (code, signal) => {
      this.exitedCleanly = code === 0
      this.exited.resolve(undefined)
      if (code !== 0) this.fail(this.diagnostic(`fixed-binding child exited (${code === null ? String(signal) : String(code)})`))
    })
  }

  async command(command: ChildCommand): Promise<ChildMessage> {
    if (this.failed !== undefined) throw this.failed
    const request = Promise.withResolvers<ChildMessage>()
    const id = ++this.requestSequence
    this.requests.set(id, request)
    try {
      this.child.send({ ...command, requestId: id }, (error) => {
        if (error !== null && error !== undefined) this.rejectRequest(id, this.diagnostic(error.message))
      })
    } catch (error: unknown) {
      this.rejectRequest(id, this.diagnostic(error instanceof Error ? error.message : String(error)))
    }
    return await request.promise
  }

  next(predicate: (message: ChildMessage) => boolean): Promise<ChildMessage> {
    if (this.failed !== undefined) return Promise.reject(this.failed)
    const index = this.messages.findIndex(predicate)
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0] as ChildMessage)
    const waiter = Promise.withResolvers<ChildMessage>()
    this.waiters.add({ predicate, ...waiter })
    return waiter.promise
  }

  dispose(): Promise<void> {
    this.disposing ??= this.disposeOnce()
    return this.disposing
  }

  private async disposeOnce(): Promise<void> {
    try {
      if (this.child.exitCode !== null) return
      const closing = this.command({ kind: 'close' })
      void closing.catch(() => {})
      try {
        await withDeadline(closing, 'fixed-binding child close IPC')
        await withDeadline(this.exited.promise, 'fixed-binding child exit')
      } catch (error: unknown) {
        this.forceStop()
        await withDeadline(this.exited.promise, 'fixed-binding child forced exit')
        throw error
      }
      if (!this.exitedCleanly) throw this.failed ?? this.diagnostic('fixed-binding child did not exit cleanly')
    } finally {
      children.delete(this)
    }
  }

  private forceStop(): void {
    if (this.child.exitCode === null) this.child.kill('SIGKILL')
  }

  private accept(value: unknown): void {
    try {
      const message = parseMessage(value)
      if ('requestId' in message) {
        const request = this.requests.get(message.requestId)
        if (request === undefined) throw new Error(`child IPC replied to unknown request ${String(message.requestId)}`)
        this.requests.delete(message.requestId)
        if (message.kind === 'error') request.reject(this.diagnostic(message.message))
        else request.resolve(message)
        return
      }
      for (const waiter of this.waiters) {
        if (!waiter.predicate(message)) continue
        this.waiters.delete(waiter)
        waiter.resolve(message)
        return
      }
      this.messages.push(message)
    } catch (error: unknown) {
      this.fail(this.diagnostic(error instanceof Error ? error.message : String(error)))
    }
  }

  private rejectRequest(id: number, error: Error): void {
    const request = this.requests.get(id)
    if (request === undefined) return
    this.requests.delete(id)
    request.reject(error)
  }

  private fail(error: Error): void {
    if (this.failed !== undefined) return
    this.failed = error
    for (const request of this.requests.values()) request.reject(error)
    this.requests.clear()
    for (const waiter of this.waiters) waiter.reject(error)
    this.waiters.clear()
  }

  private diagnostic(message: string): Error {
    const stderr = this.stderr.join('')
    return new Error(stderr.length === 0 ? message : `${message}\nchild stderr:\n${stderr}`)
  }
}

async function startChild(): Promise<FixedBindingChild> {
  const child = spawn(process.execPath, ['--import', tsxLoader, childScript], {
    cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
    env: { ...process.env, TSX_TSCONFIG_PATH: repoTsconfig },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  const client = new FixedBindingChild(child)
  children.add(client)
  await withDeadline(client.next(message => message.kind === 'ready'), 'fixed-binding child ready IPC')
  return client
}

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
  displayName: string,
  kind: ParticipantSnapshot['kind'] = 'local-agent',
  role = 'worker',
): Promise<ParticipantSnapshot> {
  let state = await ctx.teams.getTeam({ teamId: teamId as never })
  const participant = await inviteBootstrapParticipant(ctx, {
    teamId: state.team.id,
    expectedCursor: state.team.cursor,
    kind,
    displayName,
    role,
    capabilities: [],
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

/** Persist one test-owned activation binding through a single-call controller proof. */
async function bindActivation(
  ctx: Context,
  input: { readonly expectedCursor: number; readonly binding: ActivationBindingSnapshot },
): Promise<ActivationBindingSnapshot> {
  let proofs = activationProofStores.get(ctx)
  if (proofs === undefined) {
    const sourceProofs = new WeakMap<TeamSystemActivationProof, ControllerActivationBindScope>()
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
  proofs.set(actor, { kind: 'activation-controller-bind', ...input })
  try {
    return await ctx.teams.bindActivation({ actor, ...input })
  } finally {
    proofs.delete(actor)
  }
}

async function setup(): Promise<Fixture> {
  priorCapability = process.env[capabilityEnv]
  process.env[capabilityEnv] = capability
  const root = await freshRoot('team-agent-client-websocket-hub-')
  const childRoot = await freshRoot('team-agent-client-websocket-child-')
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(TeamLinkRegistry)
  await ctx.plugin(DirectChannel)
  const created = await createTestRootTeam(ctx, { goal: { objective: 'Deliver one fixed remote input.', budgets: {} }, rules: {}, budgets: {} })
  const sender = await activeParticipant(ctx, created.team.id, 'Sender')
  const recipient = await activeParticipant(ctx, created.team.id, 'Recipient', 'local-agent', 'coordinator')
  let state = await ctx.teams.getTeam({ teamId: created.team.id })
  const channel = await openTestChannel(ctx, {
    teamId: state.team.id,
    expectedCursor: state.team.cursor,
    adapter: { type: 'direct', version: 1 },
    participants: [{ id: sender.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }],
    limits: {},
  })
  state = await ctx.teams.getTeam({ teamId: created.team.id })
  const binding = await bindActivation(ctx, {
    expectedCursor: state.team.cursor,
    binding: {
      activation: {
        id: activationIdSchema.parse('activation-fixed-binding-websocket'),
        teamId: created.team.id,
        participantId: recipient.id,
        status: 'idle',
      },
      sessionId: SessionId('fixed-binding-websocket-recipient'),
      provider: 'in-process',
    },
  })
  state = await ctx.teams.getTeam({ teamId: created.team.id })
  const senderBinding = await bindActivation(ctx, {
    expectedCursor: state.team.cursor,
    binding: {
      activation: {
        id: activationIdSchema.parse('activation-fixed-binding-websocket-sender'),
        teamId: created.team.id,
        participantId: sender.id,
        status: 'idle',
      },
      sessionId: SessionId('fixed-binding-websocket-sender'),
      provider: 'fixed-binding-websocket-test',
    },
  })
  await acknowledgeTestChannelActivations(ctx, channel.manifest.id)
  await ctx.plugin(WebSocketHub, {
    path: '/team-link',
    endpoint: `ws://127.0.0.1:${String(ctx.webServer.port)}/team-link`,
    enrollmentProviderName: 'websocket',
    bindings: [{
      capabilityEnv,
      activationId: binding.activation.id,
      teamId: binding.activation.teamId,
      participantId: binding.activation.participantId,
      sessionId: binding.sessionId,
      provider: binding.provider,
    }],
    pageSize: 2,
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
  })
  return { ctx, childRoot, sender, recipient, channelId: channel.manifest.id, senderBinding, binding }
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

/** Issue one system-owned proof for the human endpoint of a TeamRun interrupt channel. */
function teamRunChannelAdmissionActor(
  ctx: Context,
  scope: Extract<TeamSystemChannelAdmissionScope, { readonly kind: 'channel-invitation-acknowledge' }>,
): TeamSystemChannelAdmissionProof {
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
  const proof = Object.freeze({}) as TeamSystemChannelAdmissionProof
  proofs.set(proof, Object.freeze(structuredClone(scope)))
  return proof
}

/** Acknowledge one pending system-owned human endpoint for an interrupt channel. */
async function acknowledgeSystemHumanChannel(
  ctx: Context,
  channelId: string,
  participantId: ParticipantSnapshot['id'],
): Promise<void> {
  const channel = await ctx.teams.getChannel({ channelId: channelId as never })
  const invitation = (await ctx.teams.getChannelAdmission({ channelId: channelId as never })).invitations
    .find(candidate => candidate.participantId === participantId)
  if (invitation === undefined || invitation.status === 'acknowledged') return
  const idempotencyKey = channelInvitationIdempotencyKeySchema.parse(`interrupt-human:${String(participantId)}`)
  const manifestFingerprint = fingerprintChannelManifest(channel.manifest)
  await ctx.teams.acknowledgeChannelInvitation({
    actor: teamRunChannelAdmissionActor(ctx, {
      kind: 'channel-invitation-acknowledge',
      teamId: channel.manifest.teamId,
      channelId: channel.manifest.id,
      participantId,
      revision: invitation.revision,
      manifestFingerprint,
      idempotencyKey,
    }),
    channelId: channel.manifest.id,
    revision: invitation.revision,
    manifestFingerprint,
    idempotencyKey,
  })
}

/** Commit one source-authorized human-to-coordinator soft interrupt for a current fixture target. */
async function requestTeamRunInterrupt(fixture: Fixture, target: ParticipantSnapshot) {
  const human = await activeParticipant(fixture.ctx, fixture.binding.activation.teamId, 'Interrupt human', 'human', 'human')
  let state = await fixture.ctx.teams.getTeam({ teamId: fixture.binding.activation.teamId })
  const channel = await openTestChannel(fixture.ctx, {
    teamId: state.team.id,
    expectedCursor: state.team.cursor,
    adapter: DirectChannel.DIRECT_CHANNEL_ADAPTER_V4,
    participants: [{ id: human.id, role: 'human' }, { id: target.id, role: 'coordinator' }],
    limits: {},
  })
  await acknowledgeTestChannelActivations(fixture.ctx, channel.manifest.id)
  await acknowledgeSystemHumanChannel(fixture.ctx, channel.manifest.id, human.id)
  state = await fixture.ctx.teams.getTeam({ teamId: fixture.binding.activation.teamId })
  const authority = teamRunInterruptActor(fixture.ctx, {
    kind: 'team-run-human-interrupt',
    teamId: fixture.binding.activation.teamId,
    channelId: channel.manifest.id,
    humanId: human.id,
    coordinatorId: target.id,
  })
  try {
    return await fixture.ctx.teams.requestParticipantInterrupt({
      actor: authority.proof,
      teamId: state.team.id,
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

async function post(ctx: Context, fixture: Fixture): Promise<TeamEnvelope> {
  const channel = await ctx.teams.getChannel({ channelId: fixture.channelId as never })
  return await ctx.teams.postChannelEnvelope({
    actor: ctx.teams.openActivationActorProofIssuer().issue(fixture.senderBinding).proof,
    expectedCursor: channel.cursor,
    draft: {
      channelId: channel.manifest.id,
      audience: [fixture.recipient.id],
      kind: 'message',
      payload: { text: 'Persist this exact remote input before receipt.' },
      delivery: 'context',
    },
  })
}

async function receiptCount(ctx: Context, envelope: TeamEnvelope, participantId: string): Promise<number> {
  const records = await ctx.teams.readChannel({ channelId: envelope.channelId, afterCursor: -1 })
  return records.records.filter(record => record.type === 'channel/receipt'
    && record.participantId === participantId
    && record.envelopeId === envelope.id).length
}

describe('FixedBindingTeamAgentLinkDelivery over WebSocket', () => {
  it('persists one direct input before its receipt, reconnects without duplication, and handles a soft interrupt', async () => {
    const fixture = await setup()
    const child = await startChild()
    const endpoint = `ws://127.0.0.1:${String(fixture.ctx.webServer.port)}/team-link`
    expect(await child.command({
      kind: 'boot', endpoint, binding: fixture.binding, persistenceRoot: fixture.childRoot,
    })).toMatchObject({ kind: 'booted' })

    const envelope = await post(fixture.ctx, fixture)
    const persisted = await withDeadline(child.next(message => (
      message.kind === 'persisted' && message.envelopeId === envelope.id
    )), 'fixed-binding durable input IPC')
    if (persisted.kind !== 'persisted') throw new Error('child did not report persisted input')
    expect(persisted.durableEnvelopeIds).toEqual([envelope.id])
    expect(await receiptCount(fixture.ctx, envelope, fixture.recipient.id)).toBe(0)
    await expect(fixture.ctx.teams.listChannelPendingDeliveries({
      channelId: fixture.channelId as never,
      participantId: fixture.recipient.id,
      afterCursor: -1,
      limit: 8,
    })).resolves.toMatchObject({ deliveries: [{ envelope: { id: envelope.id } }] })

    expect(await child.command({ kind: 'drop' })).toMatchObject({ kind: 'dropped' })
    expect(await child.command({ kind: 'release-receipt' })).toMatchObject({ kind: 'released' })
    await vi.waitFor(async () => {
      expect(await receiptCount(fixture.ctx, envelope, fixture.recipient.id)).toBe(1)
    }, { interval: 10, timeout: deadlineMs })
    const observed = await child.command({ kind: 'observed' })
    if (observed.kind !== 'observed') throw new Error('child did not report durable input')
    expect(observed.durableEnvelopeIds).toEqual([envelope.id])

    expect(await child.command({ kind: 'start-turn' })).toMatchObject({ kind: 'turn-started' })
    await requestTeamRunInterrupt(fixture, fixture.recipient)
    expect(await child.command({ kind: 'wait-interrupted' })).toMatchObject({ kind: 'interrupted' })
    await vi.waitFor(async () => {
      await expect(pendingInterrupts(fixture.ctx, fixture.binding)).resolves.toEqual([])
    }, { interval: 10, timeout: deadlineMs })
    await child.dispose()
  }, 30_000)

  it('converges after losing an interrupt acknowledgement response without acknowledging another participant', async () => {
    const fixture = await setup()
    const child = await startChild()
    const endpoint = `ws://127.0.0.1:${String(fixture.ctx.webServer.port)}/team-link`
    expect(await child.command({
      kind: 'boot', endpoint, binding: fixture.binding, persistenceRoot: fixture.childRoot,
    })).toMatchObject({ kind: 'booted' })

    const other = await activeParticipant(fixture.ctx, fixture.binding.activation.teamId, 'Other recipient', 'local-agent', 'coordinator')
    const state = await fixture.ctx.teams.getTeam({ teamId: fixture.binding.activation.teamId })
    const otherBinding = await bindActivation(fixture.ctx, {
      expectedCursor: state.team.cursor,
      binding: {
        activation: {
          id: activationIdSchema.parse('activation-fixed-binding-websocket-other'),
          teamId: fixture.binding.activation.teamId,
          participantId: other.id,
          status: 'idle',
        },
        sessionId: SessionId('fixed-binding-websocket-other'),
        provider: 'in-process',
      },
    })
    const otherInterrupt = await requestTeamRunInterrupt(fixture, other)

    const durableAcknowledged = Promise.withResolvers<undefined>()
    const releaseResponse = Promise.withResolvers<undefined>()
    const originalAcknowledge = fixture.ctx.teams.acknowledgeParticipantInterrupt.bind(fixture.ctx.teams)
    const acknowledge = vi.spyOn(fixture.ctx.teams, 'acknowledgeParticipantInterrupt').mockImplementation(async (request) => {
      const acknowledged = await originalAcknowledge(request)
      if (request.interruptId !== otherInterrupt.id) {
        durableAcknowledged.resolve(undefined)
        await releaseResponse.promise
      }
      return acknowledged
    })
    try {
      expect(await child.command({ kind: 'start-turn' })).toMatchObject({ kind: 'turn-started' })
      const targetInterrupt = await requestTeamRunInterrupt(fixture, fixture.recipient)

      await withDeadline(durableAcknowledged.promise, 'durable interrupt acknowledgement')
      expect(await child.command({ kind: 'wait-interrupted' })).toMatchObject({ kind: 'interrupted' })
      await expect(pendingInterrupts(fixture.ctx, fixture.binding)).resolves.toEqual([])

      expect(await child.command({ kind: 'drop-interrupt-ack' })).toMatchObject({ kind: 'dropped' })
      releaseResponse.resolve(undefined)
      await vi.waitFor(async () => {
        await expect(pendingInterrupts(fixture.ctx, fixture.binding)).resolves.toEqual([])
      }, { interval: 10, timeout: deadlineMs })
      await expect(pendingInterrupts(fixture.ctx, otherBinding)).resolves.toMatchObject([{ id: otherInterrupt.id }])
      expect(targetInterrupt.target.participantId).toBe(fixture.recipient.id)
    } finally {
      releaseResponse.resolve(undefined)
      acknowledge.mockRestore()
      await child.dispose()
    }
  }, 30_000)
})
