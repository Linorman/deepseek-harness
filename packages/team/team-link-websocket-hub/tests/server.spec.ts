import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { acknowledgeTestChannelActivations, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import WebServer from '@clocky/clocky-host-webserver'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import {
  activationIdSchema,
  channelInvitationIdempotencyKeySchema,
  channelPostIdempotencyKeySchema,
  fingerprintChannelManifest,
  teamTaskCreateIdempotencyKeySchema,
  type ActivationBindingSnapshot,
  type ParticipantSnapshot,
  type TeamEnvelope,
  type TeamSystemInterruptProof,
  type TeamSystemInterruptScope,
  type TeamSystemEnvelopePostProof,
  type TeamSystemEnvelopePostScope,
  type TeamSystemActivationProof,
  type TeamSystemActivationScope,
  type TeamSystemChannelAdmissionProof,
  type TeamSystemChannelAdmissionScope,
  type TeamSystemTaskLeaseProof,
  type TeamSystemTaskLeaseScope,
  type TeamTaskAssignInput,
  type TeamSystemTaskControlScope,
  type TeamSystemTaskControlProof,
} from '@clocky/clocky-team'
import TeamLinkRegistry, { parseTeamLinkServerFrame, TEAM_LINK_FRAME_VERSION } from '@clocky/clocky-team-link'
import type { TeamLink, TeamLinkInterruptNotification, TeamLinkTaskCancellationNotification } from '@clocky/clocky-team-link'
import TeamHub from '@clocky/clocky-team-hub'
import TeamWorkspaceRegistry from '@clocky/clocky-team-workspace'
import type { TeamWorkspaceProvider } from '@clocky/clocky-team-workspace'
import * as DirectChannel from '@clocky/clocky-team-channel-direct'
import {
  TASK_ASSIGNMENT_ASSIGNEE_ROLE,
  TASK_ASSIGNMENT_CHANNEL_ADAPTER,
  TASK_ASSIGNMENT_ENVELOPE_KIND,
} from '@clocky/clocky-team-channel-task-assignment'
import * as TaskAssignmentChannel from '@clocky/clocky-team-channel-task-assignment'
import * as WebSocketClient from '@clocky/clocky-team-link-websocket'
import { runTeamLinkDeliveryContract } from '../../../core/team-link/tests/delivery-contract.ts'
import * as WebSocketHub from '../src/index.ts'

const contexts = new Set<Context>()
const roots: string[] = []
const capabilityEnv = 'CLOCKY_TEAM_LINK_WEBSOCKET_HUB_TEST_CAPABILITY'
const capability = 'socket-test-capability'
const processClients = new Set<TwoProcessClient>()
const processHubs = new Set<TwoProcessHub>()
const twoProcessClientScript = fileURLToPath(new URL('./fixtures/two-process-client.ts', import.meta.url))
const twoProcessHubScript = fileURLToPath(new URL('./fixtures/two-process-hub.ts', import.meta.url))
const tsxLoader = fileURLToPath(import.meta.resolve('tsx'))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
const TEAM_SCHEDULER_ENVELOPE_POST_PROOF_SOURCE = 'team-scheduler-dag'
const TEAM_RUN_INTERRUPT_PROOF_SOURCE = 'team-run'
const TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE = 'team-activation-controller'
const TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE = 'team-scheduler-dag'
const teamRunInterruptProofStores = new WeakMap<Context, WeakMap<TeamSystemInterruptProof, TeamSystemInterruptScope>>()
const channelAdmissionProofStores = new WeakMap<Context, WeakMap<TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope>>()
const activationProofStores = new WeakMap<Context, WeakMap<TeamSystemActivationProof, ControllerActivationScope>>()

type ControllerActivationScope =
  | Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-bind' }>
  | Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-status' }>
  | Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-fence' }>
  | Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-quiesce' }>

type SchedulerTaskAssignScope = Extract<TeamSystemTaskLeaseScope, { readonly kind: 'scheduler-task-assign' }>

afterEach(async () => {
  const failures: unknown[] = []
  for (const hub of [...processHubs]) {
    try {
      await hub.dispose()
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  processHubs.clear()
  for (const client of [...processClients]) {
    try {
      await client.dispose()
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  processClients.clear()
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
  process.env[capabilityEnv] = undefined
  if (failures.length > 0) throw new AggregateError(failures, 'WebSocket Team Link Hub cleanup failed')
})

interface Fixture {
  readonly ctx: Context
  readonly root: string
  readonly teamId: string
  readonly sender: ParticipantSnapshot
  readonly senderBinding: ActivationBindingSnapshot
  readonly recipient: ParticipantSnapshot
  readonly channelId: string
  readonly binding: ActivationBindingSnapshot
}

interface Client {
  readonly socket: WebSocket
  send(frame: unknown): void
  next(predicate?: (frame: ReturnType<typeof parseTeamLinkServerFrame>) => boolean): Promise<ReturnType<typeof parseTeamLinkServerFrame>>
}

type TwoProcessCommand =
  | { readonly kind: 'boot'; readonly endpoint: string; readonly binding: ActivationBindingSnapshot; readonly capability?: string }
  | { readonly kind: 'connect' }
  | { readonly kind: 'drop' }
  | { readonly kind: 'claim-ack'; readonly channelId: string; readonly envelopeId: string }
  | { readonly kind: 'observed' }
  | { readonly kind: 'close' }

type TwoProcessMessage =
  | { readonly kind: 'ready' }
  | { readonly kind: 'booted' | 'connected' | 'dropped' | 'closed'; readonly requestId: number }
  | { readonly kind: 'acknowledged'; readonly requestId: number; readonly envelopeId: string }
  | { readonly kind: 'observed'; readonly requestId: number; readonly envelopeIds: readonly string[] }
  | { readonly kind: 'notify'; readonly envelopeId: string }
  | { readonly kind: 'termination-requested'; readonly code: string; readonly message: string }
  | { readonly kind: 'error'; readonly requestId: number; readonly message: string }

type TwoProcessHubCommand =
  | { readonly kind: 'boot'; readonly root: string }
  | { readonly kind: 'reserve'; readonly binding: ActivationBindingSnapshot }
  | { readonly kind: 'close' }

type TwoProcessHubMessage =
  | { readonly kind: 'ready' }
  | { readonly kind: 'booted'; readonly requestId: number; readonly endpoint: string }
  | { readonly kind: 'reserved'; readonly requestId: number; readonly endpoint: string; readonly capability: string }
  | { readonly kind: 'closed'; readonly requestId: number }
  | { readonly kind: 'error'; readonly requestId: number; readonly message: string }

interface TwoProcessWaiter {
  readonly predicate: (message: TwoProcessMessage) => boolean
  readonly resolve: (message: TwoProcessMessage) => void
  readonly reject: (error: Error) => void
}

interface TwoProcessRequest {
  readonly resolve: (message: TwoProcessMessage) => void
  readonly reject: (error: Error) => void
}

type TwoProcessHubResponse = Exclude<TwoProcessHubMessage, { readonly kind: 'ready' }>

interface TwoProcessHubRequest {
  readonly resolve: (message: TwoProcessHubResponse) => void
  readonly reject: (error: Error) => void
}

const processClientCloseTimeoutMs = 5_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ipcRequestId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('child IPC requestId must be a non-negative safe integer')
  }
  return value
}

function ipcText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`child IPC ${field} must be a non-empty string`)
  return value
}

function parseTwoProcessMessage(value: unknown): TwoProcessMessage {
  if (!isRecord(value) || typeof value.kind !== 'string') throw new Error('child IPC message must have a kind')
  switch (value.kind) {
    case 'ready': return { kind: 'ready' }
    case 'booted':
    case 'connected':
    case 'dropped':
    case 'closed': return { kind: value.kind, requestId: ipcRequestId(value.requestId) }
    case 'acknowledged': return {
      kind: 'acknowledged', requestId: ipcRequestId(value.requestId), envelopeId: ipcText(value.envelopeId, 'envelopeId'),
    }
    case 'observed': {
      if (!Array.isArray(value.envelopeIds) || value.envelopeIds.some(envelopeId => typeof envelopeId !== 'string')) {
        throw new Error('child IPC envelopeIds must be a string array')
      }
      return { kind: 'observed', requestId: ipcRequestId(value.requestId), envelopeIds: value.envelopeIds }
    }
    case 'notify': return { kind: 'notify', envelopeId: ipcText(value.envelopeId, 'envelopeId') }
    case 'termination-requested': return {
      kind: 'termination-requested',
      code: ipcText(value.code, 'code'),
      message: ipcText(value.message, 'message'),
    }
    case 'error': return {
      kind: 'error', requestId: ipcRequestId(value.requestId), message: ipcText(value.message, 'message'),
    }
    default: throw new Error(`child IPC message kind is invalid: ${value.kind}`)
  }
}

function parseTwoProcessHubMessage(value: unknown): TwoProcessHubMessage {
  if (!isRecord(value) || typeof value.kind !== 'string') throw new Error('child Hub IPC message must have a kind')
  switch (value.kind) {
    case 'ready': return { kind: 'ready' }
    case 'booted': return {
      kind: 'booted',
      requestId: ipcRequestId(value.requestId),
      endpoint: ipcText(value.endpoint, 'endpoint'),
    }
    case 'reserved': return {
      kind: 'reserved',
      requestId: ipcRequestId(value.requestId),
      endpoint: ipcText(value.endpoint, 'endpoint'),
      capability: ipcText(value.capability, 'capability'),
    }
    case 'closed': return { kind: 'closed', requestId: ipcRequestId(value.requestId) }
    case 'error': return {
      kind: 'error',
      requestId: ipcRequestId(value.requestId),
      message: ipcText(value.message, 'message'),
    }
    default: throw new Error(`child Hub IPC message kind is invalid: ${value.kind}`)
  }
}

async function withProcessDeadline<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(`${label} exceeded ${String(processClientCloseTimeoutMs)}ms`)) }, processClientCloseTimeoutMs)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

class TwoProcessClient {
  private readonly messages: TwoProcessMessage[] = []
  private readonly waiters = new Set<TwoProcessWaiter>()
  private readonly requests = new Map<number, TwoProcessRequest>()
  private readonly exited = Promise.withResolvers<undefined>()
  private readonly stderr: string[] = []
  private requestSequence = 0
  private failed: Error | undefined
  private hasExited = false
  private disposing: Promise<void> | undefined

  constructor(private readonly child: ChildProcess) {
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => { this.stderr.push(chunk) })
    child.on('message', (value: unknown) => { this.accept(value) })
    child.once('error', (error) => { this.fail(this.diagnostic(error.message)) })
    child.once('exit', (code, signal) => {
      this.hasExited = true
      this.exited.resolve(undefined)
      this.fail(this.diagnostic(`Team Link child exited (${code === null ? String(signal) : String(code)})`))
    })
  }

  async command(command: TwoProcessCommand): Promise<TwoProcessMessage> {
    if (this.failed !== undefined) throw this.failed
    const requestId = ++this.requestSequence
    const completion = Promise.withResolvers<TwoProcessMessage>()
    this.requests.set(requestId, completion)
    try {
      this.child.send({ ...command, requestId }, (error) => {
        if (error !== null && error !== undefined) this.rejectRequest(requestId, this.diagnostic(error.message))
      })
    } catch (error: unknown) {
      this.rejectRequest(requestId, this.diagnostic(error instanceof Error ? error.message : String(error)))
    }
    return await completion.promise
  }

  next(predicate: (message: TwoProcessMessage) => boolean): Promise<TwoProcessMessage> {
    if (this.failed !== undefined) return Promise.reject(this.failed)
    const index = this.messages.findIndex(predicate)
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0] as TwoProcessMessage)
    const completion = Promise.withResolvers<TwoProcessMessage>()
    this.waiters.add({ predicate, ...completion })
    return completion.promise
  }

  dispose(): Promise<void> {
    this.disposing ??= this.disposeOnce()
    return this.disposing
  }

  private async disposeOnce(): Promise<void> {
    try {
      if (this.hasExited) return
      const closing = this.command({ kind: 'close' })
      void closing.catch(() => {})
      try {
        await withProcessDeadline(closing, 'Team Link child close IPC')
      } catch (error: unknown) {
        this.forceStop()
        await withProcessDeadline(this.exited.promise, 'Team Link child forced exit')
        throw error
      }
      try {
        await withProcessDeadline(this.exited.promise, 'Team Link child exit')
      } catch (error: unknown) {
        this.forceStop()
        await withProcessDeadline(this.exited.promise, 'Team Link child forced exit')
        throw error
      }
      if (this.child.exitCode !== 0) throw this.failed ?? this.diagnostic('Team Link child did not exit cleanly')
    } finally {
      processClients.delete(this)
    }
  }

  private forceStop(): void {
    if (!this.hasExited) this.child.kill('SIGKILL')
  }

  private accept(value: unknown): void {
    try {
      const message = parseTwoProcessMessage(value)
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

  private rejectRequest(requestId: number, error: Error): void {
    const request = this.requests.get(requestId)
    if (request === undefined) return
    this.requests.delete(requestId)
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

class TwoProcessHub {
  private readonly ready = Promise.withResolvers<undefined>()
  private readonly requests = new Map<number, TwoProcessHubRequest>()
  private readonly exited = Promise.withResolvers<undefined>()
  private readonly stderr: string[] = []
  private requestSequence = 0
  private failed: Error | undefined
  private hasExited = false
  private closing = false
  private disposing: Promise<void> | undefined

  constructor(private readonly child: ChildProcess) {
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => { this.stderr.push(chunk) })
    child.on('message', (value: unknown) => { this.accept(value) })
    child.once('error', (error) => { this.fail(this.diagnostic(error.message)) })
    child.once('exit', (code, signal) => {
      this.hasExited = true
      this.exited.resolve(undefined)
      if (!(this.closing && code === 0)) {
        this.fail(this.diagnostic(`Team Link Hub child exited (${code === null ? String(signal) : String(code)})`))
      }
    })
  }

  async command(command: TwoProcessHubCommand): Promise<TwoProcessHubResponse> {
    if (this.failed !== undefined) throw this.failed
    const requestId = ++this.requestSequence
    const completion = Promise.withResolvers<TwoProcessHubResponse>()
    this.requests.set(requestId, completion)
    const reject = (error: Error): void => {
      const request = this.requests.get(requestId)
      if (request !== undefined) {
        this.requests.delete(requestId)
        request.reject(error)
      }
    }
    try {
      this.child.send({ ...command, requestId }, (error) => {
        if (error !== null && error !== undefined) reject(this.diagnostic(error.message))
      })
    } catch (error: unknown) {
      reject(this.diagnostic(error instanceof Error ? error.message : String(error)))
    }
    return await completion.promise
  }

  async waitUntilReady(): Promise<void> {
    await withProcessDeadline(this.ready.promise, 'Team Link Hub child ready IPC')
  }

  async dispose(): Promise<void> {
    this.disposing ??= this.disposeOnce()
    await this.disposing
  }

  private async disposeOnce(): Promise<void> {
    this.closing = true
    try {
      if (this.hasExited) return
      const closing = this.command({ kind: 'close' })
      void closing.catch(() => {})
      try {
        await withProcessDeadline(closing, 'Team Link Hub child close IPC')
      } catch (error: unknown) {
        if (!this.hasExited) {
          this.forceStop()
          await withProcessDeadline(this.exited.promise, 'Team Link Hub child forced exit')
          throw error
        }
        if (this.child.exitCode !== 0) throw error
      }
      try {
        await withProcessDeadline(this.exited.promise, 'Team Link Hub child exit')
      } catch (error: unknown) {
        this.forceStop()
        await withProcessDeadline(this.exited.promise, 'Team Link Hub child forced exit')
        throw error
      }
      if (this.child.exitCode !== 0) throw this.failed ?? this.diagnostic('Team Link Hub child did not exit cleanly')
    } finally {
      processHubs.delete(this)
    }
  }

  private forceStop(): void {
    if (!this.hasExited) this.child.kill('SIGKILL')
  }

  private accept(value: unknown): void {
    try {
      const message = parseTwoProcessHubMessage(value)
      if (message.kind === 'ready') {
        this.ready.resolve(undefined)
        return
      }
      const request = this.requests.get(message.requestId)
      if (request === undefined) throw new Error(`child Hub replied to unknown request ${String(message.requestId)}`)
      this.requests.delete(message.requestId)
      if (message.kind === 'error') request.reject(this.diagnostic(message.message))
      else request.resolve(message)
    } catch (error: unknown) {
      this.fail(this.diagnostic(error instanceof Error ? error.message : String(error)))
    }
  }

  private fail(error: Error): void {
    if (this.failed !== undefined) return
    this.failed = error
    this.ready.reject(error)
    for (const request of this.requests.values()) request.reject(error)
    this.requests.clear()
  }

  private diagnostic(message: string): Error {
    const stderr = this.stderr.join('')
    return new Error(stderr.length === 0 ? message : `${message}\nchild stderr:\n${stderr}`)
  }
}

async function startTwoProcessClient(): Promise<TwoProcessClient> {
  const child = spawn(process.execPath, ['--import', tsxLoader, twoProcessClientScript], {
    cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
    env: { ...process.env, TSX_TSCONFIG_PATH: repoTsconfig },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  const client = new TwoProcessClient(child)
  processClients.add(client)
  await withProcessDeadline(client.next(message => message.kind === 'ready'), 'Team Link child ready IPC')
  return client
}

async function startTwoProcessHub(): Promise<TwoProcessHub> {
  const child = spawn(process.execPath, ['--import', tsxLoader, twoProcessHubScript], {
    cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
    env: { ...process.env, TSX_TSCONFIG_PATH: repoTsconfig },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  const hub = new TwoProcessHub(child)
  processHubs.add(hub)
  await hub.waitUntilReady()
  return hub
}

/** Compose the reusable authoritative Team and HTTP dependencies over one durable root. */
async function coreContext(root: string, backend: 'json' | 'sqlite' = 'json'): Promise<Context> {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'hub.sqlite') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(TeamWorkspaceRegistry)
  await ctx.plugin(TeamLinkRegistry)
  await ctx.plugin(DirectChannel)
  await ctx.plugin(TaskAssignmentChannel)
  return ctx
}

/** Register a provider-only source integration route for the remote dispatch composition. */
function registerIntegrationProvider(ctx: Context): () => void {
  const provider: TeamWorkspaceProvider = {
    name: 'fixture-remote-integration',
    modes: ['shared'],
    async eligible() { return true },
    async prepare() { throw new Error('remote integration fixture does not allocate a workspace') },
    async restore() { throw new Error('remote integration fixture does not restore a workspace') },
    async reconcileRelease() { throw new Error('remote integration fixture does not release a workspace') },
    async integrateSource(request) {
      const artifact = request.source.artifacts.find(candidate => candidate.kind === 'patch')
      return {
        teamId: request.source.teamId,
        sourceTaskId: request.source.taskId,
        sourceAttemptId: request.source.attemptId,
        integrationTaskId: request.integrationTaskId,
        integrationAttemptId: request.integrationAttemptId,
        target: request.target,
        status: 'integrated' as const,
        targetVersion: 'remote-fixture-integrated-version',
        ...artifact === undefined ? {} : { artifact },
      }
    },
  }
  return ctx.teamWorkspaces.registerProvider(provider)
}

/** Mount a static-capability remote listener for one exact durable activation. */
async function mountWebSocketHub(
  ctx: Context,
  binding: ActivationBindingSnapshot,
  overrides: Partial<WebSocketHub.Config> = {},
): Promise<void> {
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
    maxPendingRequests: 8,
    maxQueuedBytes: 64 * 1024,
    maxOutstandingDeliveries: 8,
    requestWindowMs: 1_000,
    maxRequestsPerWindow: 32,
    closeTimeoutMs: 100,
    handshakeTimeoutMs: 1_000,
    heartbeatIntervalMs: 1_000,
    heartbeatTimeoutMs: 100,
    retryableNackDelayMs: 1,
    backpressureRetryAfterMs: 100,
    ...overrides,
  })
}

/** Compose the real WebServer, JSON Team Hub, direct adapter, and remote listener. */
async function setup(overrides: Partial<WebSocketHub.Config> = {}, backend: 'json' | 'sqlite' = 'json'): Promise<Fixture> {
  process.env[capabilityEnv] = capability
  const root = await freshRoot()
  const ctx = await coreContext(root, backend)
  const opened = await openChannel(ctx)
  const senderBinding = await bindSender(ctx, opened)
  const binding = await bindRecipient(ctx, opened)
  const channel = await acknowledgeTestChannelActivations(ctx, opened.channel.manifest.id)
  await mountWebSocketHub(ctx, binding, overrides)
  return {
    ctx,
    root,
    teamId: opened.teamId,
    sender: opened.sender,
    senderBinding,
    recipient: opened.recipient,
    channelId: channel.manifest.id,
    binding,
  }
}

/** Reopen one persisted Team and listener without recreating its identities or channels. */
async function restartFixture(
  source: Fixture,
  overrides: Partial<WebSocketHub.Config> = {},
): Promise<Fixture> {
  const ctx = await coreContext(source.root)
  await mountWebSocketHub(ctx, source.binding, overrides)
  return { ...source, ctx }
}

/** Allocate a project-local JSON storage root. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-link-websocket-hub-'))
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

/** Invite one active local Team participant. */
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

/** Create one two-party direct channel. */
async function openChannel(ctx: Context) {
  const created = await createTestRootTeam(ctx, { goal: { objective: 'Route remote delivery.', budgets: {} }, rules: {}, budgets: {} })
  const sender = await activeParticipant(ctx, created.team.id, 'Sender')
  const recipient = await activeParticipant(ctx, created.team.id, 'Recipient', 'local-agent', 'coordinator')
  const state = await ctx.teams.getTeam({ teamId: created.team.id })
  const channel = await openTestChannel(ctx, {
    teamId: created.team.id,
    expectedCursor: state.team.cursor,
    adapter: { type: 'direct', version: 1 },
    participants: [{ id: sender.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }],
    limits: {},
  })
  return { teamId: created.team.id, sender, recipient, channel }
}

/** Persist one active participant binding that a local proof issuer can verify. */
async function bindParticipant(
  ctx: Context,
  input: Pick<Awaited<ReturnType<typeof openChannel>>, 'teamId'>,
  participantId: ParticipantSnapshot['id'],
  activationId: string,
  sessionId: string,
): Promise<ActivationBindingSnapshot> {
  const state = await ctx.teams.getTeam({ teamId: input.teamId })
  const binding: ActivationBindingSnapshot = {
    activation: {
      id: activationIdSchema.parse(activationId),
      teamId: input.teamId,
      participantId,
      status: 'idle',
    },
    sessionId: sessionId as ActivationBindingSnapshot['sessionId'],
    provider: 'in-process',
  }
  const bindInput = {
    expectedCursor: state.team.cursor,
    binding,
  }
  return await withActivationProof(ctx, {
    kind: 'activation-controller-bind',
    ...bindInput,
  }, async actor => await ctx.teams.bindActivation({ actor, ...bindInput }))
}

/** Persist the sender binding used only by real-Hub test fixture posts. */
async function bindSender(ctx: Context, input: Awaited<ReturnType<typeof openChannel>>): Promise<ActivationBindingSnapshot> {
  return await bindParticipant(
    ctx,
    input,
    input.sender.id,
    'activation-team-link-websocket-hub-sender',
    'session-team-link-websocket-hub-sender',
  )
}

/** Persist the remote recipient binding checked during WebSocket attach. */
async function bindRecipient(ctx: Context, input: Awaited<ReturnType<typeof openChannel>>): Promise<ActivationBindingSnapshot> {
  return await bindParticipant(
    ctx,
    input,
    input.recipient.id,
    'activation-team-link-websocket-hub',
    'session-team-link-websocket-hub',
  )
}

/** Issue a current runtime-only activation proof for a fixture-only Hub post. */
function activationActor(ctx: Context, binding: ActivationBindingSnapshot) {
  return ctx.teams.openActivationActorProofIssuer().issue(binding).proof
}

/** Issue a test-only opaque scheduler proof for one exact durable post scope. */
function schedulerPostActor(ctx: Context, scope: TeamSystemEnvelopePostScope): TeamSystemEnvelopePostProof {
  const proofs = new WeakMap<TeamSystemEnvelopePostProof, TeamSystemEnvelopePostScope>()
  ctx.teams.registerSystemEnvelopePostProofSource({
    name: TEAM_SCHEDULER_ENVELOPE_POST_PROOF_SOURCE,
    resolveEnvelopePostProof: proof => proofs.get(proof),
  })
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('scheduler post proofs are runtime-only') },
  })
  const opaque = Object.freeze(proof) as TeamSystemEnvelopePostProof
  proofs.set(opaque, scope)
  return opaque
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
  const human = await activeParticipant(fixture.ctx, fixture.teamId, 'Interrupt human', 'human', 'human')
  let state = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId as never })
  const channel = await openTestChannel(fixture.ctx, {
    teamId: state.team.id,
    expectedCursor: state.team.cursor,
    adapter: DirectChannel.DIRECT_CHANNEL_ADAPTER_V4,
    participants: [{ id: human.id, role: 'human' }, { id: target.id, role: 'coordinator' }],
    limits: {},
  })
  await acknowledgeTestChannelActivations(fixture.ctx, channel.manifest.id)
  await acknowledgeSystemHumanChannel(fixture.ctx, channel.manifest.id, human.id)
  state = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId as never })
  const authority = teamRunInterruptActor(fixture.ctx, {
    kind: 'team-run-human-interrupt',
    teamId: fixture.teamId as never,
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

/** Post one direct Envelope through the authoritative Hub. */
async function post(ctx: Context, fixture: Fixture, text: string): Promise<TeamEnvelope> {
  const channel = await ctx.teams.getChannel({ channelId: fixture.channelId as never })
  return await ctx.teams.postChannelEnvelope({
    actor: activationActor(ctx, fixture.senderBinding),
    expectedCursor: channel.cursor,
    draft: {
      channelId: channel.manifest.id,
      audience: [fixture.recipient.id],
      kind: 'message',
      payload: { text },
      delivery: 'turn',
    },
  })
}

/** Connect a framed test client to the real WebServer upgrade route. */
async function connect(fixture: Fixture): Promise<Client> {
  return await connectEndpoint(`ws://127.0.0.1:${String(fixture.ctx.webServer.port)}/team-link`)
}

/** Connect a framed test client to one explicit WebSocket Hub endpoint. */
async function connectEndpoint(endpoint: string): Promise<Client> {
  const socket = new WebSocket(endpoint)
  const frames: ReturnType<typeof parseTeamLinkServerFrame>[] = []
  const waiters = new Set<{
    readonly predicate: (frame: ReturnType<typeof parseTeamLinkServerFrame>) => boolean
    readonly resolve: (frame: ReturnType<typeof parseTeamLinkServerFrame>) => void
    readonly reject: (error: Error) => void
  }>()
  let closed: Error | undefined
  socket.on('message', (data) => {
    const frame = parseTeamLinkServerFrame(JSON.parse(messageText(data)) as unknown)
    for (const waiter of waiters) {
      if (!waiter.predicate(frame)) continue
      waiters.delete(waiter)
      waiter.resolve(frame)
      return
    }
    frames.push(frame)
  })
  socket.on('close', (code, reason) => {
    closed = new Error(`socket closed (${String(code)}): ${String(reason)}`)
    for (const waiter of waiters) waiter.reject(closed)
    waiters.clear()
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => { resolve() })
    socket.once('error', reject)
  })
  return {
    socket,
    send(frame) { socket.send(JSON.stringify(frame)) },
    next(predicate = () => true) {
      if (closed !== undefined) return Promise.reject(closed)
      const index = frames.findIndex(predicate)
      if (index >= 0) return Promise.resolve(frames.splice(index, 1)[0] as ReturnType<typeof parseTeamLinkServerFrame>)
      return new Promise((resolve, reject) => { waiters.add({ predicate, resolve, reject }) })
    },
  }
}

/** Decode one `ws` message payload for the test frame parser. */
function messageText(data: WebSocket.RawData): string {
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

/** Attach one client with the binding held by the fixture. */
async function attach(client: Client, fixture: Fixture, value = capability): Promise<void> {
  await attachBinding(client, fixture.binding, value)
}

/** Attach one raw client with a caller-selected exact durable binding and credential. */
async function attachBinding(
  client: Client,
  binding: ActivationBindingSnapshot,
  capabilityValue: string,
): Promise<void> {
  client.send({
    v: TEAM_LINK_FRAME_VERSION,
    type: 'attach',
    id: 'attach',
    binding: {
      activationId: binding.activation.id,
      teamId: binding.activation.teamId,
      participantId: binding.activation.participantId,
      sessionId: binding.sessionId,
      provider: binding.provider,
    },
    capability: capabilityValue,
  })
  await expect(client.next(frame => frame.type === 'attached' && frame.id === 'attach')).resolves.toMatchObject({
    binding: { activationId: binding.activation.id },
  })
}

/** Subscribe after attach and verify the required subscription response. */
async function subscribe(client: Client): Promise<void> {
  client.send({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'subscribe' })
  await expect(client.next(frame => frame.type === 'response' && frame.id === 'subscribe')).resolves.toEqual({
    v: TEAM_LINK_FRAME_VERSION,
    type: 'response',
    id: 'subscribe',
    ok: true,
    result: { subscribed: true },
  })
}

async function connectRemoteLink(fixture: Fixture): Promise<TeamLink> {
  return await fixture.ctx.teamLinks.connect({ provider: 'websocket', binding: fixture.binding })
}

describe('WebSocket Team Link Hub', () => {
  it('issues one dynamic capability for a durable binding and revokes its socket', async () => {
    const fixture = await setup({ bindings: [] })
    const enrollment = await fixture.ctx.teamLinks.reserveEnrollment({
      provider: 'websocket',
      binding: fixture.binding,
    })
    expect(enrollment.endpoint).toBe(`ws://127.0.0.1:${String(fixture.ctx.webServer.port)}/team-link`)

    const client = await connect(fixture)
    await attachBinding(client, fixture.binding, enrollment.capability)
    await subscribe(client)
    const closed = new Promise<[number, Buffer]>((resolve) => {
      client.socket.once('close', (code, reason) => { resolve([code, reason]) })
    })
    const revoking = enrollment.revoke()
    const cancellation = await client.next(frame => frame.type === 'cancel')
    expect(cancellation).toMatchObject({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'cancel',
      reason: { code: 'TEAM_LINK_CREDENTIAL_REVOKED' },
    })
    if (cancellation.type !== 'cancel') throw new Error('Hub did not send a cancellation request')
    client.send({ v: TEAM_LINK_FRAME_VERSION, type: 'cancelled', id: cancellation.id, accepted: true })
    await revoking
    await expect(closed).resolves.toEqual([1008, Buffer.from('credential revoked')])

    const stale = await connect(fixture)
    stale.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'attach',
      id: 'attach',
      binding: {
        activationId: fixture.binding.activation.id,
        teamId: fixture.binding.activation.teamId,
        participantId: fixture.binding.activation.participantId,
        sessionId: fixture.binding.sessionId,
        provider: fixture.binding.provider,
      },
      capability: enrollment.capability,
    })
    await expect(stale.next(frame => frame.type === 'response' && frame.id === 'attach')).resolves.toMatchObject({
      ok: false,
      error: { code: 'unauthorized' },
    })
    stale.socket.close()

    const replacement = await fixture.ctx.teamLinks.reserveEnrollment({
      provider: 'websocket',
      binding: fixture.binding,
    })
    expect(replacement.capability).not.toBe(enrollment.capability)
    await replacement.revoke()
  })

  it('treats dynamic credential revocation after Hub shutdown as already settled', async () => {
    const fixture = await setup({ bindings: [] })
    const enrollment = await fixture.ctx.teamLinks.reserveEnrollment({
      provider: 'websocket',
      binding: fixture.binding,
    })
    await fixture.ctx.fiber.dispose()
    contexts.delete(fixture.ctx)
    await expect(enrollment.revoke()).resolves.toBeUndefined()
  })

  it('rotates a dynamic credential by closing its prior attached generation', async () => {
    const fixture = await setup({ bindings: [] })
    const initial = await fixture.ctx.teamLinks.reserveEnrollment({
      provider: 'websocket',
      binding: fixture.binding,
    })
    const connected = await connect(fixture)
    await attachBinding(connected, fixture.binding, initial.capability)
    const closed = new Promise<[number, Buffer]>((resolve) => {
      connected.socket.once('close', (code, reason) => { resolve([code, reason]) })
    })

    const replacement = await fixture.ctx.teamLinks.reserveEnrollment({
      provider: 'websocket',
      binding: fixture.binding,
    })
    await expect(closed).resolves.toEqual([1008, Buffer.from('credential rotated')])

    const stale = await connect(fixture)
    stale.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'attach',
      id: 'stale-attach',
      binding: {
        activationId: fixture.binding.activation.id,
        teamId: fixture.binding.activation.teamId,
        participantId: fixture.binding.activation.participantId,
        sessionId: fixture.binding.sessionId,
        provider: fixture.binding.provider,
      },
      capability: initial.capability,
    })
    await expect(stale.next(frame => frame.type === 'response' && frame.id === 'stale-attach')).resolves.toMatchObject({
      ok: false,
      error: { code: 'unauthorized' },
    })
    stale.socket.close()

    const current = await connect(fixture)
    await attachBinding(current, fixture.binding, replacement.capability)
    current.socket.close()
    await replacement.revoke()
  })

  it('recovers a dynamic credential and its pending replay after an authoritative Hub restart', async () => {
    const first = await setup({ bindings: [] })
    const enrollment = await first.ctx.teamLinks.reserveEnrollment({
      provider: 'websocket',
      binding: first.binding,
    })
    const pending = await post(first.ctx, first, 'recover dynamic enrollment after Hub restart')
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)

    const restarted = await restartFixture(first, { bindings: [] })
    const client = await connect(restarted)
    await attachBinding(client, restarted.binding, enrollment.capability)
    await subscribe(client)
    await expect(client.next(frame => frame.type === 'notify' && frame.envelope.id === pending.id)).resolves.toMatchObject({
      type: 'notify', envelope: { id: pending.id },
    })
    client.socket.close()
  })

  it('recovers dynamic enrollment and pending replay across separate Hub processes', async () => {
    const first = await setup({ bindings: [] }, 'sqlite')
    const pending = await post(first.ctx, first, 'recover across Hub processes')
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)

    const firstHub = await startTwoProcessHub()
    const booted = await firstHub.command({ kind: 'boot', root: first.root })
    if (booted.kind !== 'booted') throw new Error('first Hub process did not boot')
    const issued = await firstHub.command({ kind: 'reserve', binding: first.binding })
    if (issued.kind !== 'reserved') throw new Error('first Hub process did not issue dynamic enrollment')
    await firstHub.dispose()

    const secondHub = await startTwoProcessHub()
    const restarted = await secondHub.command({ kind: 'boot', root: first.root })
    if (restarted.kind !== 'booted') throw new Error('restarted Hub process did not boot')
    const remote = await startTwoProcessClient()
    await remote.command({
      kind: 'boot', endpoint: restarted.endpoint, binding: first.binding, capability: issued.capability,
    })
    await remote.command({ kind: 'connect' })
    await expect(remote.next(message => message.kind === 'notify' && message.envelopeId === pending.id)).resolves.toEqual({
      kind: 'notify', envelopeId: pending.id,
    })
    const acknowledged = await remote.command({ kind: 'claim-ack', channelId: first.channelId, envelopeId: pending.id })
    expect(acknowledged.kind).toBe('acknowledged')
    if (acknowledged.kind !== 'acknowledged') throw new Error('child client did not acknowledge the pending Envelope')
    expect(acknowledged.envelopeId).toBe(pending.id)
    expect(Number.isSafeInteger(acknowledged.requestId)).toBe(true)
    await remote.dispose()
    await secondHub.dispose()
  })

  it('requests cooperative termination from a real child-process Link before dynamic revocation closes it', async () => {
    const fixture = await setup({ bindings: [] })
    const enrollment = await fixture.ctx.teamLinks.reserveEnrollment({
      provider: 'websocket',
      binding: fixture.binding,
    })
    const remote = await startTwoProcessClient()
    await remote.command({
      kind: 'boot',
      endpoint: `ws://127.0.0.1:${String(fixture.ctx.webServer.port)}/team-link`,
      binding: fixture.binding,
      capability: enrollment.capability,
    })
    await remote.command({ kind: 'connect' })

    const revoking = enrollment.revoke()
    await expect(remote.next(message => message.kind === 'termination-requested')).resolves.toEqual({
      kind: 'termination-requested',
      code: 'TEAM_LINK_CREDENTIAL_REVOKED',
      message: 'the remote Team Link credential was revoked',
    })
    await expect(revoking).resolves.toBeUndefined()
  })

  it('hard-closes a non-cooperative remote Link after the cancellation acknowledgement deadline', async () => {
    const fixture = await setup({ bindings: [], closeTimeoutMs: 10 })
    const enrollment = await fixture.ctx.teamLinks.reserveEnrollment({
      provider: 'websocket',
      binding: fixture.binding,
    })
    const client = await connect(fixture)
    await attachBinding(client, fixture.binding, enrollment.capability)
    await subscribe(client)
    const closed = new Promise<[number, Buffer]>((resolve) => {
      client.socket.once('close', (code, reason) => { resolve([code, reason]) })
    })

    const revoking = enrollment.revoke()
    await expect(client.next(frame => frame.type === 'cancel')).resolves.toMatchObject({
      type: 'cancel',
      reason: { code: 'TEAM_LINK_CREDENTIAL_REVOKED' },
    })
    await expect(revoking).resolves.toBeUndefined()
    await expect(closed).resolves.toEqual([1011, Buffer.from('cancellation timeout')])
  })

  it('keeps a revoked dynamic credential unavailable after an authoritative Hub restart', async () => {
    const first = await setup({ bindings: [] })
    const enrollment = await first.ctx.teamLinks.reserveEnrollment({
      provider: 'websocket',
      binding: first.binding,
    })
    await enrollment.revoke()
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)

    const restarted = await restartFixture(first, { bindings: [] })
    const client = await connect(restarted)
    client.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'attach',
      id: 'revoked-attach',
      binding: {
        activationId: restarted.binding.activation.id,
        teamId: restarted.binding.activation.teamId,
        participantId: restarted.binding.activation.participantId,
        sessionId: restarted.binding.sessionId,
        provider: restarted.binding.provider,
      },
      capability: enrollment.capability,
    })
    await expect(client.next(frame => frame.type === 'response' && frame.id === 'revoked-attach')).resolves.toMatchObject({
      ok: false,
      error: { code: 'unauthorized' },
    })
    client.socket.close()
  })

  it('replays an unreceipted Envelope and excludes its receipt across a real child-process Link reconnect', async () => {
    const fixture = await setup()
    const remote = await startTwoProcessClient()
    const endpoint = `ws://127.0.0.1:${String(fixture.ctx.webServer.port)}/team-link`
    expect(await remote.command({ kind: 'boot', endpoint, binding: fixture.binding })).toMatchObject({ kind: 'booted' })
    expect(await remote.command({ kind: 'connect' })).toMatchObject({ kind: 'connected' })

    const pending = await post(fixture.ctx, fixture, 'replay across process reconnect')
    await expect(remote.next(message => message.kind === 'notify' && message.envelopeId === pending.id)).resolves.toMatchObject({
      kind: 'notify', envelopeId: pending.id,
    })
    expect(await remote.command({ kind: 'drop' })).toMatchObject({ kind: 'dropped' })

    const reconnect = async (): Promise<void> => {
      await vi.waitFor(async () => {
        expect(await remote.command({ kind: 'connect' })).toMatchObject({ kind: 'connected' })
      }, { interval: 10, timeout: 1_000 })
    }
    await reconnect()
    await expect(remote.next(message => message.kind === 'notify' && message.envelopeId === pending.id)).resolves.toMatchObject({
      kind: 'notify', envelopeId: pending.id,
    })
    await expect(remote.command({
      kind: 'claim-ack', channelId: fixture.channelId, envelopeId: pending.id,
    })).resolves.toMatchObject({ kind: 'acknowledged', envelopeId: pending.id })
    await expect(fixture.ctx.teams.listChannelPendingDeliveries({
      channelId: fixture.channelId as never,
      participantId: fixture.recipient.id,
      afterCursor: -1,
      limit: 8,
    })).resolves.toMatchObject({ deliveries: [] })

    expect(await remote.command({ kind: 'drop' })).toMatchObject({ kind: 'dropped' })
    await reconnect()
    const later = await post(fixture.ctx, fixture, 'receipt must suppress replay')
    await expect(remote.next(message => message.kind === 'notify' && message.envelopeId === later.id)).resolves.toMatchObject({
      kind: 'notify', envelopeId: later.id,
    })
    const observed = await remote.command({ kind: 'observed' })
    if (observed.kind !== 'observed') throw new Error('child process did not report its current Link notifications')
    expect(observed.envelopeIds).toEqual([later.id])
    await expect(remote.command({
      kind: 'claim-ack', channelId: fixture.channelId, envelopeId: later.id,
    })).resolves.toMatchObject({ kind: 'acknowledged', envelopeId: later.id })
    await remote.dispose()
  }, 30_000)

  it('starts remote pending-delivery replay at the durable channel watermark', async () => {
    const fixture = await setup()
    const pending = await post(fixture.ctx, fixture, 'replay only the retained pending suffix')
    const channel = await fixture.ctx.teams.getChannel({ channelId: fixture.channelId as never })
    const watermark = channel.replayWatermark
    if (watermark === undefined) throw new Error('pending delivery did not retain a replay watermark')
    const pages = vi.spyOn(fixture.ctx.teams, 'listChannelPendingDeliveries')

    const client = await connect(fixture)
    await attach(client, fixture)
    await subscribe(client)
    await expect(client.next(frame => frame.type === 'notify' && frame.envelope.id === pending.id)).resolves.toMatchObject({
      type: 'notify', envelope: { id: pending.id },
    })

    expect(pages).toHaveBeenCalledWith({
      channelId: fixture.channelId,
      participantId: fixture.recipient.id,
      afterCursor: watermark,
      limit: 2,
    })
    client.socket.close()
  })

  it('replays a static-capability delivery through a restarted authoritative Hub', async () => {
    const first = await setup()
    const pending = await post(first.ctx, first, 'replay after authoritative Hub restart')
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)

    const restarted = await restartFixture(first)
    await restarted.ctx.plugin(WebSocketClient, {
      providerName: 'websocket',
      endpoint: `ws://127.0.0.1:${String(restarted.ctx.webServer.port)}/team-link`,
      capabilityEnv,
      connectTimeoutMs: 1_000,
      responseTimeoutMs: 1_000,
      maxFrameBytes: 16 * 1024,
      maxPendingRequests: 8,
      maxBufferedNotifications: 8,
    })
    const link = await connectRemoteLink(restarted)
    const replayed = Promise.withResolvers<TeamEnvelope>()
    const dispose = link.onNotify(async (envelope) => { replayed.resolve(envelope) })

    await expect(replayed.promise).resolves.toMatchObject({ id: pending.id })
    dispose()
    await link.close()
  })

  it('reuses a durable post key after the response socket drops following append', async () => {
    const fixture = await setup()
    await fixture.ctx.plugin(WebSocketClient, {
      providerName: 'websocket',
      endpoint: `ws://127.0.0.1:${String(fixture.ctx.webServer.port)}/team-link`,
      capabilityEnv,
      connectTimeoutMs: 1_000,
      responseTimeoutMs: 1_000,
      maxFrameBytes: 16 * 1024,
      maxPendingRequests: 8,
      maxBufferedNotifications: 8,
    })
    const first = await connectRemoteLink(fixture)
    const channel = await fixture.ctx.teams.getChannel({ channelId: fixture.channelId as never })
    const idempotencyKey = channelPostIdempotencyKeySchema.parse('drop-after-append')
    const request = {
      expectedCursor: channel.cursor,
      idempotencyKey,
      draft: {
        channelId: channel.manifest.id,
        audience: [fixture.sender.id],
        kind: 'message',
        payload: { text: 'return the same accepted Envelope' },
        delivery: 'turn' as const,
      },
    }
    const socket = (first as unknown as { readonly socket: WebSocket }).socket
    const dispose = fixture.ctx.on('channel/changed', ({ record }) => {
      if (record.type === 'channel/envelope' && record.idempotencyKey === idempotencyKey) socket.terminate()
    })
    await expect(first.post(request)).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_TRANSPORT_CLOSED' })
    dispose()
    await expect(first.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_TRANSPORT_CLOSED' })

    let reconnected: TeamLink | undefined
    await vi.waitFor(async () => {
      reconnected = await connectRemoteLink(fixture)
    }, { interval: 10, timeout: 1_000 })
    if (reconnected === undefined) throw new Error('remote Team Link did not reconnect after dropped response')
    const replayed = await reconnected.post(request)
    expect(replayed).toMatchObject({ channelId: fixture.channelId, senderId: fixture.recipient.id })
    const records = await fixture.ctx.teams.readChannel({ channelId: fixture.channelId as never, afterCursor: -1 })
    const envelopes = records.records.filter((record): record is Extract<typeof record, { readonly type: 'channel/envelope' }> => record.type === 'channel/envelope')
    expect(envelopes).toHaveLength(1)
    expect(envelopes[0]).toMatchObject({ idempotencyKey, envelope: { id: replayed.id } })
    await reconnected.close()
  })

  it('derives a direct final peer and current cursor at the Hub without accepting either from the remote client', async () => {
    const fixture = await setup()
    const state = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId as never })
    let channel = await openTestChannel(fixture.ctx, {
      teamId: state.team.id,
      expectedCursor: state.team.cursor,
      adapter: DirectChannel.DIRECT_CHANNEL_ADAPTER_V3,
      participants: [{ id: fixture.sender.id, role: 'human' }, { id: fixture.recipient.id, role: 'coordinator' }],
      limits: {},
    })
    channel = await acknowledgeTestChannelActivations(fixture.ctx, channel.manifest.id)
    await fixture.ctx.teams.postChannelEnvelope({
      actor: activationActor(fixture.ctx, fixture.senderBinding),
      expectedCursor: channel.cursor,
      draft: {
        channelId: channel.manifest.id,
        audience: [fixture.recipient.id],
        kind: 'message',
        payload: { content: [{ type: 'text', text: 'Input before final.' }] },
        delivery: 'turn',
      },
    })
    const client = await connect(fixture)
    await attach(client, fixture)
    client.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'final-result',
      op: 'final-result',
      input: {
        channelId: channel.manifest.id,
        idempotencyKey: 'remote-direct-final',
        text: 'Remote coordinator result.',
      },
    })
    const accepted = await client.next(frame => frame.type === 'response' && frame.id === 'final-result')
    expect(accepted).toMatchObject({
      ok: true,
      result: {
        channelId: channel.manifest.id,
        senderId: fixture.recipient.id,
        audience: [fixture.sender.id],
        kind: 'final',
        payload: { text: 'Remote coordinator result.' },
        delivery: 'turn',
      },
    })
    if (accepted.type !== 'response' || !accepted.ok || accepted.result === null || Array.isArray(accepted.result)
      || typeof accepted.result !== 'object') throw new Error('direct final response did not contain an Envelope')
    const envelopeId = (accepted.result as { readonly id: string }).id
    client.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'direct-final-retry',
      op: 'final-result',
      input: {
        channelId: channel.manifest.id,
        idempotencyKey: 'remote-direct-final',
        text: 'Remote coordinator result.',
      },
    })
    await expect(client.next(frame => frame.type === 'response' && frame.id === 'direct-final-retry')).resolves.toMatchObject({
      ok: true,
      result: { id: envelopeId },
    })
    client.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'direct-final-conflict',
      op: 'final-result',
      input: {
        channelId: channel.manifest.id,
        idempotencyKey: 'remote-direct-final',
        text: 'A different final.',
      },
    })
    await expect(client.next(frame => frame.type === 'response' && frame.id === 'direct-final-conflict')).resolves.toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    })
    client.socket.close()
  })

  it('authenticates a durable binding, replays pending delivery, claims it, and records only an explicit receipt', async () => {
    const fixture = await setup()
    const first = await post(fixture.ctx, fixture, 'first pending')
    const client = await connect(fixture)
    await attach(client, fixture)
    await subscribe(client)

    const notify = await client.next(frame => frame.type === 'notify' && frame.envelope.id === first.id)
    expect(notify).toMatchObject({ type: 'notify', envelope: { id: first.id } })
    client.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'claim',
      op: 'claim',
      input: { channelId: fixture.channelId, envelopeId: first.id },
    })
    const claim = await client.next(frame => frame.type === 'response' && frame.id === 'claim')
    expect(claim).toMatchObject({ ok: true, result: { envelopeId: first.id, binding: { sessionId: fixture.binding.sessionId } } })
    if (claim.type !== 'response' || !claim.ok || claim.result === null || typeof claim.result !== 'object' || Array.isArray(claim.result)) {
      throw new Error('claim response must contain a claim object')
    }
    const claimCursor = (claim.result as { channel: { cursor: number } }).channel.cursor
    client.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'receipt',
      op: 'receipt',
      input: { channelId: fixture.channelId, envelopeId: first.id, expectedCursor: claimCursor },
    })
    await expect(client.next(frame => frame.type === 'response' && frame.id === 'receipt')).resolves.toMatchObject({
      ok: true,
      result: { participantId: fixture.recipient.id, envelopeId: first.id },
    })
    const pending = await fixture.ctx.teams.listChannelPendingDeliveries({
      channelId: fixture.channelId as never,
      participantId: fixture.recipient.id,
      afterCursor: -1,
      limit: 8,
    })
    expect(pending.deliveries).toEqual([])
    client.socket.close()
  })

  it('nacks without advancing the receipt cursor and re-notifies the same pending Envelope', async () => {
    const fixture = await setup()
    const pending = await post(fixture.ctx, fixture, 'retry me')
    const client = await connect(fixture)
    await attach(client, fixture)
    await subscribe(client)
    const first = await client.next(frame => frame.type === 'notify' && frame.envelope.id === pending.id)
    if (first.type !== 'notify') throw new Error('expected notification')
    client.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'nack',
      deliveryId: first.deliveryId,
      channelId: fixture.channelId,
      envelopeId: pending.id,
      retryable: true,
    })
    const second = await client.next(frame => frame.type === 'notify' && frame.envelope.id === pending.id)
    expect(second).toMatchObject({ type: 'notify', envelope: { id: pending.id } })
    if (second.type !== 'notify') throw new Error('expected retry notification')
    expect(second.deliveryId).not.toBe(first.deliveryId)
    const page = await fixture.ctx.teams.listChannelPendingDeliveries({
      channelId: fixture.channelId as never,
      participantId: fixture.recipient.id,
      afterCursor: -1,
      limit: 8,
    })
    expect(page.deliveries.map(delivery => delivery.envelope.id)).toEqual([pending.id])
    client.socket.close()
  })

  it('stops delivery when the attached activation becomes unavailable before replay', async () => {
    const fixture = await setup()
    const client = await connect(fixture)
    await attach(client, fixture)
    await subscribe(client)
    const state = await fixture.ctx.teams.getTeam({ teamId: fixture.binding.activation.teamId })
    const closed = new Promise<[number, Buffer]>((resolve) => {
      client.socket.once('close', (code, reason) => { resolve([code, reason]) })
    })
    const offlineInput = {
      teamId: fixture.binding.activation.teamId,
      activationId: fixture.binding.activation.id,
      expectedCursor: state.team.cursor,
      status: 'offline' as const,
    }
    await withActivationProof(fixture.ctx, {
      kind: 'activation-controller-status',
      ...offlineInput,
      participantId: fixture.binding.activation.participantId,
      sessionId: fixture.binding.sessionId,
      provider: fixture.binding.provider,
    }, async actor => await fixture.ctx.teams.updateActivationStatus({ actor, ...offlineInput }))
    await post(fixture.ctx, fixture, 'must not reach an offline activation')
    await expect(closed).resolves.toEqual([1008, Buffer.from('binding unavailable')])
  })

  it('ignores Team channels whose roster excludes the bound recipient', async () => {
    const fixture = await setup()
    const observer = await activeParticipant(fixture.ctx, fixture.teamId, 'Observer')
    const client = await connect(fixture)
    await attach(client, fixture)
    await subscribe(client)
    const state = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId as never })
    let unrelated = await openTestChannel(fixture.ctx, {
      teamId: state.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: fixture.sender.id, role: 'sender' }, { id: observer.id, role: 'observer' }],
      limits: {},
    })
    await bindParticipant(fixture.ctx, { teamId: fixture.teamId as Awaited<ReturnType<typeof openChannel>>['teamId'] }, observer.id,
      'activation-team-link-websocket-hub-observer', 'session-team-link-websocket-hub-observer')
    unrelated = await acknowledgeTestChannelActivations(fixture.ctx, unrelated.manifest.id)
    await fixture.ctx.teams.postChannelEnvelope({
      actor: activationActor(fixture.ctx, fixture.senderBinding),
      expectedCursor: unrelated.cursor,
      draft: {
        channelId: unrelated.manifest.id,
        audience: [observer.id],
        kind: 'message',
        payload: { text: 'unrelated pending work' },
        delivery: 'turn',
      },
    })
    const visible = await post(fixture.ctx, fixture, 'recipient-visible work')
    await expect(client.next(frame => frame.type === 'notify' && frame.envelope.id === visible.id)).resolves.toMatchObject({
      type: 'notify', envelope: { id: visible.id },
    })
    client.socket.close()
  })

  it('releases a causal pending delivery only after an accepted reply', async () => {
    const fixture = await setup({ maxOutstandingDeliveries: 1 })
    const first = await post(fixture.ctx, fixture, 'first pending')
    const client = await connect(fixture)
    await attach(client, fixture)
    await subscribe(client)
    await expect(client.next(frame => frame.type === 'notify' && frame.envelope.id === first.id)).resolves.toMatchObject({
      type: 'notify', envelope: { id: first.id },
    })
    client.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'causal-reply',
      op: 'post',
      input: {
        expectedCursor: first.sequence,
        idempotencyKey: 'causal-reply',
        draft: {
          channelId: fixture.channelId,
          audience: [fixture.sender.id],
          kind: 'message',
          payload: { text: 'reply admitted durably' },
          delivery: 'turn',
          causationId: first.id,
        },
      },
    })
    await expect(client.next(frame => frame.type === 'response' && frame.id === 'causal-reply')).resolves.toMatchObject({
      ok: true,
      result: { causationId: first.id },
    })
    const second = await post(fixture.ctx, fixture, 'second pending')
    await expect(client.next(frame => frame.type === 'notify' && frame.envelope.id === second.id)).resolves.toMatchObject({
      type: 'notify', envelope: { id: second.id },
    })
    client.socket.close()
  })

  it('rejects a second socket for an immutable activation binding', async () => {
    const fixture = await setup()
    const first = await connect(fixture)
    await attach(first, fixture)
    const second = await connect(fixture)
    second.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'attach',
      id: 'second-attach',
      binding: {
        activationId: fixture.binding.activation.id,
        teamId: fixture.binding.activation.teamId,
        participantId: fixture.binding.activation.participantId,
        sessionId: fixture.binding.sessionId,
        provider: fixture.binding.provider,
      },
      capability,
    })
    await expect(second.next(frame => frame.type === 'response' && frame.id === 'second-attach')).resolves.toEqual({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'response',
      id: 'second-attach',
      ok: false,
      error: { code: 'binding-in-use', message: 'activation binding already has an active connection' },
    })
    const firstClosed = new Promise<void>((resolve) => { first.socket.once('close', () => { resolve() }) })
    first.socket.close()
    await firstClosed
    second.socket.close()
  })

  it('replays a durable target-exact interrupt after subscription and persists its idempotent acknowledgement', async () => {
    const fixture = await setup()
    const interrupt = await requestTeamRunInterrupt(fixture, fixture.recipient)
    const client = await connect(fixture)
    await attach(client, fixture)
    await subscribe(client)
    const delivery = await client.next(frame => frame.type === 'interrupt' && frame.interrupt.id === interrupt.id)
    expect(delivery).toMatchObject({
      type: 'interrupt',
      interrupt: {
        id: interrupt.id,
        target: {
          teamId: fixture.binding.activation.teamId,
          participantId: fixture.binding.activation.participantId,
          activationId: fixture.binding.activation.id,
          sessionId: fixture.binding.sessionId,
          provider: fixture.binding.provider,
        },
      },
    })
    if (delivery.type !== 'interrupt') throw new Error('expected interrupt delivery')
    client.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'interrupt-ack',
      op: 'interrupt-ack',
      input: { deliveryId: delivery.deliveryId, interruptId: interrupt.id },
    })
    const acknowledged = await client.next(frame => frame.type === 'response' && frame.id === 'interrupt-ack')
    expect(acknowledged).toMatchObject({ ok: true, result: { id: interrupt.id } })
    client.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'interrupt-ack-repeat',
      op: 'interrupt-ack',
      input: { deliveryId: delivery.deliveryId, interruptId: interrupt.id },
    })
    await expect(client.next(frame => frame.type === 'response' && frame.id === 'interrupt-ack-repeat')).resolves.toMatchObject({
      ok: true,
      result: { id: interrupt.id },
    })
    const interruptLease = fixture.ctx.teams.openActivationActorProofIssuer().issue(fixture.binding)
    await expect(fixture.ctx.teams.listPendingParticipantInterrupts({ actor: interruptLease.proof })).resolves.toEqual([])
    interruptLease.revoke()
    client.socket.close()
  })

  it('connects the real WebSocket provider before replaying and acknowledging a pending interrupt', async () => {
    const fixture = await setup()
    await fixture.ctx.plugin(WebSocketClient, {
      providerName: 'websocket',
      endpoint: `ws://127.0.0.1:${String(fixture.ctx.webServer.port)}/team-link`,
      capabilityEnv,
      connectTimeoutMs: 1_000,
      responseTimeoutMs: 1_000,
      maxFrameBytes: 16 * 1024,
      maxPendingRequests: 8,
      maxBufferedNotifications: 8,
    })
    const interrupt = await requestTeamRunInterrupt(fixture, fixture.recipient)

    const link = await connectRemoteLink(fixture)
    const acknowledged = Promise.withResolvers<undefined>()
    const received = vi.fn(async (notification: TeamLinkInterruptNotification) => {
      try {
        await link.acknowledgeInterrupt(notification.deliveryId, notification.interrupt.id)
        acknowledged.resolve(undefined)
      } catch (error: unknown) {
        acknowledged.reject(error)
      }
    })
    const dispose = link.onInterrupt(received)
    await vi.waitFor(() => { expect(received).toHaveBeenCalledOnce() })
    const notification = received.mock.calls[0]?.[0]
    if (notification === undefined) throw new Error('real WebSocket provider did not deliver the interrupt')
    expect(notification.interrupt.id).toBe(interrupt.id)
    await acknowledged.promise
    const interruptLease = fixture.ctx.teams.openActivationActorProofIssuer().issue(fixture.binding)
    await expect(fixture.ctx.teams.listPendingParticipantInterrupts({ actor: interruptLease.proof })).resolves.toEqual([])
    interruptLease.revoke()
    dispose()
    await link.close()
  })

  it('delivers an interrupt committed after v3 subscription without exposing another target command', async () => {
    const fixture = await setup()
    const other = await activeParticipant(fixture.ctx, fixture.teamId, 'Other target', 'local-agent', 'coordinator')
    const state = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId as never })
    const otherBinding: ActivationBindingSnapshot = {
      activation: {
        id: activationIdSchema.parse('activation-other-interrupt-target'),
        teamId: fixture.teamId as never,
        participantId: other.id,
        status: 'idle',
      },
      sessionId: 'session-other-interrupt-target' as ActivationBindingSnapshot['sessionId'],
      provider: 'in-process',
    }
    const bindInput = {
      expectedCursor: state.team.cursor,
      binding: otherBinding,
    }
    await withActivationProof(fixture.ctx, {
      kind: 'activation-controller-bind',
      ...bindInput,
    }, async actor => await fixture.ctx.teams.bindActivation({ actor, ...bindInput }))
    await requestTeamRunInterrupt(fixture, other)
    const client = await connect(fixture)
    await attach(client, fixture)
    await subscribe(client)
    const interrupt = await requestTeamRunInterrupt(fixture, fixture.recipient)
    await expect(client.next(frame => frame.type === 'interrupt')).resolves.toMatchObject({
      interrupt: { id: interrupt.id, target: { participantId: fixture.recipient.id } },
    })
    client.socket.close()
  })

  it('derives post authority from the attached binding and rejects supplied authority fields', async () => {
    const fixture = await setup()
    const client = await connect(fixture)
    await attach(client, fixture)
    const channel = await fixture.ctx.teams.getChannel({ channelId: fixture.channelId as never })
    client.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'post',
      op: 'post',
      input: {
        expectedCursor: channel.cursor,
        idempotencyKey: 'remote-reply',
        draft: {
          channelId: fixture.channelId,
          audience: [fixture.sender.id],
          kind: 'message',
          payload: { text: 'remote reply' },
          delivery: 'turn',
        },
      },
    })
    await expect(client.next(frame => frame.type === 'response' && frame.id === 'post')).resolves.toMatchObject({
      ok: true,
      result: { senderId: fixture.recipient.id, audience: [fixture.sender.id] },
    })
    client.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'spoof',
      op: 'post',
      input: {
        senderId: fixture.sender.id,
        expectedCursor: channel.cursor,
        idempotencyKey: 'spoofed-reply',
        draft: {
          channelId: fixture.channelId,
          audience: [fixture.sender.id],
          kind: 'message',
          payload: { text: 'spoof' },
          delivery: 'turn',
        },
      },
    })
    await expect(client.next(frame => frame.type === 'response' && frame.id === 'spoof')).resolves.toEqual({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'response',
      id: 'spoof',
      ok: false,
      error: { code: 'invalid-request', message: 'request input is invalid' },
    })
    client.socket.close()
  })

  it('forwards task-start, heartbeat, and settlement through the configured durable binding', async () => {
    const fixture = await setup()
    const coordinator = await activeParticipant(fixture.ctx, fixture.teamId, 'Coordinator', 'local-agent', 'coordinator')
    const state = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId as never })
    const coordinatorBinding: ActivationBindingSnapshot = {
      activation: {
        id: activationIdSchema.parse('activation-team-link-websocket-hub-coordinator'),
        teamId: state.team.id,
        participantId: coordinator.id,
        status: 'idle',
      },
      sessionId: 'session-team-link-websocket-hub-coordinator' as ActivationBindingSnapshot['sessionId'],
      provider: 'in-process',
    }
    const coordinatorBindInput = { expectedCursor: state.team.cursor, binding: coordinatorBinding }
    await withActivationProof(fixture.ctx, {
      kind: 'activation-controller-bind',
      ...coordinatorBindInput,
    }, async actor => await fixture.ctx.teams.bindActivation({ actor, ...coordinatorBindInput }))
    const coordinatorActor = activationActor(fixture.ctx, coordinatorBinding)
    const beforeTask = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId as never })
    const task = await fixture.ctx.teams.createTask({
      actor: coordinatorActor,
      teamId: beforeTask.team.id,
      expectedCursor: beforeTask.team.cursor,
      createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('websocket-hub-task-lifecycle') },
      subject: 'Complete remote work',
      description: 'Finish through the authenticated remote Link.',
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
    const beforeChannel = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId as never })
    let channel = await openTestChannel(fixture.ctx, {
      teamId: beforeChannel.team.id,
      expectedCursor: beforeChannel.team.cursor,
      adapter: TASK_ASSIGNMENT_CHANNEL_ADAPTER,
      participants: [{ id: fixture.recipient.id, role: TASK_ASSIGNMENT_ASSIGNEE_ROLE }],
      limits: {
        taskId: task.id,
        activationId: fixture.binding.activation.id,
        sessionId: fixture.binding.sessionId,
      },
    })
    channel = await acknowledgeTestChannelActivations(fixture.ctx, channel.manifest.id)
    const assigned = await assignSchedulerLease(fixture.ctx, {
      teamId: task.teamId,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: fixture.recipient.id,
      activationId: fixture.binding.activation.id,
      wakeChannelId: channel.manifest.id,
      leaseDurationMs: 1_000,
    })
    if (assigned.lease === undefined) throw new Error('assigned remote task must retain its lease')
    const client = await connect(fixture)
    await attach(client, fixture)
    client.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'forged-assignment-envelope',
      op: 'post',
      input: {
        expectedCursor: channel.cursor,
        idempotencyKey: 'forged-task-assignment',
        draft: {
          channelId: channel.manifest.id,
          audience: [fixture.recipient.id],
          kind: TASK_ASSIGNMENT_ENVELOPE_KIND,
          payload: {
            taskId: task.id,
            attemptId: assigned.lease.attemptId,
            assignedRevision: assigned.lease.assignedRevision,
            activationId: fixture.binding.activation.id,
            sessionId: fixture.binding.sessionId,
          },
          delivery: 'turn',
          taskId: task.id,
        },
      },
    })
    await expect(client.next(frame => frame.type === 'response' && frame.id === 'forged-assignment-envelope')).resolves.toEqual({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'response',
      id: 'forged-assignment-envelope',
      ok: false,
      error: { code: 'rejected', message: 'request was rejected' },
    })
    const assignment = await fixture.ctx.teams.postChannelEnvelope({
      actor: schedulerPostActor(fixture.ctx, {
        kind: 'scheduler-assignment',
        teamId: task.teamId,
        channelId: channel.manifest.id,
        taskId: task.id,
        attemptId: assigned.lease.attemptId,
        assignedRevision: assigned.lease.assignedRevision,
        assigneeId: fixture.recipient.id,
        activationId: fixture.binding.activation.id,
        sessionId: fixture.binding.sessionId,
      }),
      expectedCursor: channel.cursor,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('task-assignment'),
      draft: {
        channelId: channel.manifest.id,
        audience: [fixture.recipient.id],
        kind: TASK_ASSIGNMENT_ENVELOPE_KIND,
        payload: {
          taskId: task.id,
          attemptId: assigned.lease.attemptId,
          assignedRevision: assigned.lease.assignedRevision,
          activationId: fixture.binding.activation.id,
          sessionId: fixture.binding.sessionId,
        },
        delivery: 'turn',
        taskId: task.id,
      },
    })
    expect(assignment.senderId).toBe(fixture.recipient.id)
    const assignmentEnvelopeId = assignment.id
    client.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'task-start',
      op: 'task-start',
      input: {
        taskId: task.id,
        attemptId: assigned.lease.attemptId,
        assignedRevision: assigned.lease.assignedRevision,
        channelId: channel.manifest.id,
        envelopeId: assignmentEnvelopeId,
      },
    })
    const started = await client.next(frame => frame.type === 'response' && frame.id === 'task-start')
    expect(started).toMatchObject({ ok: true, result: { id: task.id, phase: 'running' } })
    if (started.type !== 'response' || !started.ok || started.result === null || typeof started.result !== 'object' || Array.isArray(started.result)) {
      throw new Error('task-start response must contain a task')
    }
    const startedRevision = (started.result as { revision: number }).revision
    client.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'task-heartbeat',
      op: 'task-heartbeat',
      input: {
        taskId: task.id,
        attemptId: assigned.lease.attemptId,
        expectedRevision: startedRevision,
      },
    })
    const renewed = await client.next(frame => frame.type === 'response' && frame.id === 'task-heartbeat')
    expect(renewed).toMatchObject({ ok: true, result: { id: task.id, phase: 'running' } })
    if (renewed.type !== 'response' || !renewed.ok || renewed.result === null || typeof renewed.result !== 'object' || Array.isArray(renewed.result)) {
      throw new Error('task-heartbeat response must contain a task')
    }
    const renewedRevision = (renewed.result as { revision: number }).revision
    client.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'task-settle',
      op: 'task-settle',
      input: {
        taskId: task.id,
        attemptId: assigned.lease.attemptId,
        expectedRevision: renewedRevision,
        outcome: { kind: 'completed', result: { summary: 'remote work complete' } },
      },
    })
    await expect(client.next(frame => frame.type === 'response' && frame.id === 'task-settle')).resolves.toMatchObject({
      ok: true,
      result: { id: task.id, phase: 'completed' },
    })
    client.socket.close()
  })

  it('executes and settles an artifact-sourced integration task through the remote Link operation', async () => {
    const fixture = await setup()
    registerIntegrationProvider(fixture.ctx)
    const coordinator = await activeParticipant(fixture.ctx, fixture.teamId, 'Integration coordinator', 'local-agent', 'coordinator')
    let state = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId as never })
    const coordinatorBinding: ActivationBindingSnapshot = {
      activation: {
        id: activationIdSchema.parse('activation-team-link-websocket-hub-integration-coordinator'),
        teamId: state.team.id,
        participantId: coordinator.id,
        status: 'idle',
      },
      sessionId: 'session-team-link-websocket-hub-integration-coordinator' as ActivationBindingSnapshot['sessionId'],
      provider: 'in-process',
    }
    const coordinatorBindInput = { expectedCursor: state.team.cursor, binding: coordinatorBinding }
    await withActivationProof(fixture.ctx, {
      kind: 'activation-controller-bind',
      ...coordinatorBindInput,
    }, async actor => await fixture.ctx.teams.bindActivation({ actor, ...coordinatorBindInput }))
    const coordinatorActor = activationActor(fixture.ctx, coordinatorBinding)
    state = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId as never })

    const source = await fixture.ctx.teams.createTask({
      actor: coordinatorActor,
      teamId: fixture.teamId as never,
      expectedCursor: state.team.cursor,
      createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('websocket-hub-integration-source') },
      subject: 'Prepare the integration source',
      description: 'Produce a patch artifact for the remote integration task.',
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
    const sourceAssigned = await assignSchedulerLease(fixture.ctx, {
      teamId: source.teamId,
      taskId: source.id,
      expectedRevision: source.revision,
      participantId: fixture.recipient.id,
      activationId: fixture.binding.activation.id,
      leaseDurationMs: 1_000,
    })
    if (sourceAssigned.lease === undefined) throw new Error('remote integration source must retain a lease')
    const sourceActor = activationActor(fixture.ctx, fixture.binding)
    const sourceRunning = await fixture.ctx.teams.startTaskAttempt({
      actor: sourceActor,
      taskId: sourceAssigned.id,
      expectedRevision: sourceAssigned.revision,
      attemptId: sourceAssigned.lease.attemptId,
    })
    const sourceArtifact = {
      id: 'fixture-remote-integration-patch',
      kind: 'patch' as const,
      uri: 'artifact://fixture-remote-integration-patch',
      sourceAttemptId: sourceAssigned.lease.attemptId,
      visibility: 'team' as const,
    }
    const completedSource = await fixture.ctx.teams.settleTaskAttempt({
      actor: sourceActor,
      taskId: sourceRunning.id,
      expectedRevision: sourceRunning.revision,
      attemptId: sourceAssigned.lease.attemptId,
      outcome: { kind: 'completed', result: { summary: 'Remote source patch is ready.', artifacts: [sourceArtifact] } },
    })
    const sourceAttempt = completedSource.attemptHistory.at(-1)
    if (sourceAttempt === undefined || sourceAttempt.outcome.kind !== 'completed') {
      throw new Error('remote integration source did not settle')
    }

    state = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId as never })
    const integration = await fixture.ctx.teams.createTask({
      actor: coordinatorActor,
      teamId: fixture.teamId as never,
      expectedCursor: state.team.cursor,
      createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('websocket-hub-integration-task') },
      subject: 'Integrate the source patch',
      description: 'Use the remote workspace provider to integrate the completed source attempt.',
      integration: {
        sourceTaskId: source.id,
        sourceAttemptId: sourceAttempt.id,
        provider: 'fixture-remote-integration',
        target: 'main',
        expectedTarget: 'remote-base',
        mode: 'integrate',
      },
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
    state = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId as never })
    let channel = await openTestChannel(fixture.ctx, {
      teamId: fixture.teamId as never,
      expectedCursor: state.team.cursor,
      adapter: TASK_ASSIGNMENT_CHANNEL_ADAPTER,
      participants: [{ id: fixture.recipient.id, role: TASK_ASSIGNMENT_ASSIGNEE_ROLE }],
      limits: {
        taskId: integration.id,
        activationId: fixture.binding.activation.id,
        sessionId: fixture.binding.sessionId,
      },
    })
    channel = await acknowledgeTestChannelActivations(fixture.ctx, channel.manifest.id)
    const assigned = await assignSchedulerLease(fixture.ctx, {
      teamId: integration.teamId,
      taskId: integration.id,
      expectedRevision: integration.revision,
      participantId: fixture.recipient.id,
      activationId: fixture.binding.activation.id,
      wakeChannelId: channel.manifest.id,
      leaseDurationMs: 1_000,
    })
    if (assigned.lease === undefined) throw new Error('remote integration task must retain a lease')
    const assignment = await fixture.ctx.teams.postChannelEnvelope({
      actor: schedulerPostActor(fixture.ctx, {
        kind: 'scheduler-assignment',
        teamId: integration.teamId,
        channelId: channel.manifest.id,
        taskId: integration.id,
        attemptId: assigned.lease.attemptId,
        assignedRevision: assigned.lease.assignedRevision,
        assigneeId: fixture.recipient.id,
        activationId: fixture.binding.activation.id,
        sessionId: fixture.binding.sessionId,
      }),
      expectedCursor: channel.cursor,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('websocket-hub-integration-assignment'),
      draft: {
        channelId: channel.manifest.id,
        audience: [fixture.recipient.id],
        kind: TASK_ASSIGNMENT_ENVELOPE_KIND,
        payload: {
          taskId: integration.id,
          attemptId: assigned.lease.attemptId,
          assignedRevision: assigned.lease.assignedRevision,
          activationId: fixture.binding.activation.id,
          sessionId: fixture.binding.sessionId,
        },
        delivery: 'turn',
        taskId: integration.id,
      },
    })

    const client = await connect(fixture)
    await attach(client, fixture)
    await subscribe(client)
    client.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'integration-task-start',
      op: 'task-start',
      input: {
        taskId: integration.id,
        attemptId: assigned.lease.attemptId,
        assignedRevision: assigned.lease.assignedRevision,
        channelId: channel.manifest.id,
        envelopeId: assignment.id,
      },
    })
    const started = await client.next(frame => frame.type === 'response' && frame.id === 'integration-task-start')
    if (started.type !== 'response' || !started.ok || started.result === null || typeof started.result !== 'object' || Array.isArray(started.result)) {
      throw new Error('remote integration task-start response must contain a task')
    }
    const startedRevision = (started.result as { revision: number }).revision
    client.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'integration-task-integrate',
      op: 'task-integrate',
      input: {
        taskId: integration.id,
        attemptId: assigned.lease.attemptId,
        expectedRevision: startedRevision,
        verification: 'remote integration verification passed',
      },
    })
    await expect(client.next(frame => frame.type === 'response' && frame.id === 'integration-task-integrate')).resolves.toMatchObject({
      ok: true,
      result: {
        id: integration.id,
        phase: 'completed',
        attemptHistory: [{ outcome: { kind: 'completed', result: {
          integration: { status: 'integrated', targetVersion: 'remote-fixture-integrated-version' },
          verification: 'remote integration verification passed',
        } } }],
      },
    })
    await expect(fixture.ctx.teams.getTask({ teamId: fixture.teamId as never, taskId: integration.id })).resolves.toMatchObject({
      phase: 'completed',
      integration: {
        sourceTaskId: source.id,
        sourceAttemptId: sourceAttempt.id,
        provider: 'fixture-remote-integration',
        target: 'main',
      },
    })
    client.socket.close()
  })

  it('returns a sanitized attach failure for an invalid capability or unavailable durable activation', async () => {
    const fixture = await setup()
    const wrong = await connect(fixture)
    wrong.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'attach',
      id: 'wrong',
      binding: {
        activationId: fixture.binding.activation.id,
        teamId: fixture.binding.activation.teamId,
        participantId: fixture.binding.activation.participantId,
        sessionId: fixture.binding.sessionId,
        provider: fixture.binding.provider,
      },
      capability: 'wrong-capability',
    })
    await expect(wrong.next(frame => frame.type === 'response' && frame.id === 'wrong')).resolves.toEqual({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'response',
      id: 'wrong',
      ok: false,
      error: { code: 'unauthorized', message: 'request is not authorized' },
    })
    wrong.socket.close()

    const state = await fixture.ctx.teams.getTeam({ teamId: fixture.binding.activation.teamId })
    const offlineInput = {
      teamId: fixture.binding.activation.teamId,
      activationId: fixture.binding.activation.id,
      expectedCursor: state.team.cursor,
      status: 'offline' as const,
    }
    await withActivationProof(fixture.ctx, {
      kind: 'activation-controller-status',
      ...offlineInput,
      participantId: fixture.binding.activation.participantId,
      sessionId: fixture.binding.sessionId,
      provider: fixture.binding.provider,
    }, async actor => await fixture.ctx.teams.updateActivationStatus({ actor, ...offlineInput }))
    const offline = await connect(fixture)
    offline.send({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'attach',
      id: 'offline',
      binding: {
        activationId: fixture.binding.activation.id,
        teamId: fixture.binding.activation.teamId,
        participantId: fixture.binding.activation.participantId,
        sessionId: fixture.binding.sessionId,
        provider: fixture.binding.provider,
      },
      capability,
    })
    await expect(offline.next(frame => frame.type === 'response' && frame.id === 'offline')).resolves.toMatchObject({
      ok: false,
      error: { code: 'unauthorized' },
    })
    offline.socket.close()
  })

  it('closes a consumer that leaves configured unacknowledged delivery bounds', async () => {
    const fixture = await setup({ maxOutstandingDeliveries: 1 })
    await post(fixture.ctx, fixture, 'one')
    await post(fixture.ctx, fixture, 'two')
    const client = await connect(fixture)
    await attach(client, fixture)
    const closed = new Promise<[number, Buffer]>((resolve) => {
      client.socket.once('close', (code, reason) => { resolve([code, reason]) })
    })
    await subscribe(client)
    await expect(client.next(frame => frame.type === 'notify')).resolves.toMatchObject({ type: 'notify' })
    await expect(closed).resolves.toEqual([1008, Buffer.from('slow consumer')])
  })
})

runTeamLinkDeliveryContract('websocket', async () => {
  const fixture = await setup()
  await fixture.ctx.plugin(WebSocketClient, {
    providerName: 'websocket',
    endpoint: `ws://127.0.0.1:${String(fixture.ctx.webServer.port)}/team-link`,
    capabilityEnv,
    connectTimeoutMs: 1_000,
    responseTimeoutMs: 1_000,
    maxFrameBytes: 16 * 1024,
    maxPendingRequests: 8,
    maxBufferedNotifications: 8,
  })
  return {
    binding: fixture.binding,
    post: async () => await post(fixture.ctx, fixture, 'delivery contract replay'),
    connect: async () => await connectRemoteLink(fixture),
    reconnect: async () => {
      let link: TeamLink | undefined
      await vi.waitFor(async () => { link = await connectRemoteLink(fixture) }, { interval: 10, timeout: 1_000 })
      if (link === undefined) throw new Error('remote Team Link did not reconnect')
      return link
    },
    pendingEnvelopeIds: async () => {
      const pending = await fixture.ctx.teams.listChannelPendingDeliveries({
        channelId: fixture.channelId as never,
        participantId: fixture.recipient.id,
        afterCursor: -1,
        limit: 8,
      })
      return pending.deliveries.map(delivery => delivery.envelope.id)
    },
  }
})


for (const backend of ['json', 'sqlite'] as const) {
  it(`replays and acknowledges an exact task cancellation over WebSocket on ${backend}`, async () => {
    const fixture = await setup({}, backend)
    const ctx = fixture.ctx
    await ctx.plugin(WebSocketClient, {
      providerName: 'websocket', endpoint: `ws://127.0.0.1:${String(ctx.webServer.port)}/team-link`, capabilityEnv,
      connectTimeoutMs: 1_000, responseTimeoutMs: 1_000, maxFrameBytes: 16 * 1024, maxPendingRequests: 8, maxBufferedNotifications: 8,
    })
    const coordinator = await activeParticipant(ctx, fixture.teamId, 'Cancel coordinator', 'local-agent', 'coordinator')
    const state = await ctx.teams.getTeam({ teamId: fixture.binding.activation.teamId })
    const coordinatorBinding: ActivationBindingSnapshot = {
      activation: { id: activationIdSchema.parse('websocket-cancel-coordinator'), teamId: state.team.id, participantId: coordinator.id, status: 'idle' },
      sessionId: 'websocket-cancel-session' as ActivationBindingSnapshot['sessionId'], provider: 'in-process',
    }
    const bindInput = { expectedCursor: state.team.cursor, binding: coordinatorBinding }
    await withActivationProof(ctx, { kind: 'activation-controller-bind', ...bindInput }, async actor => await ctx.teams.bindActivation({ actor, ...bindInput }))
    const before = await ctx.teams.getTeam({ teamId: state.team.id })
    let task = await ctx.teams.createTask({
      actor: activationActor(ctx, coordinatorBinding), teamId: state.team.id, expectedCursor: before.team.cursor,
      createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('websocket-task-cancel') }, subject: 'Cancel remote task', description: 'Only this attempt.',
      blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 2 })
    task = await assignSchedulerLease(ctx, { teamId: task.teamId, taskId: task.id, expectedRevision: task.revision,
      participantId: fixture.recipient.id, activationId: fixture.binding.activation.id, leaseDurationMs: 60_000 })
    const attemptId = task.lease!.attemptId
    const scope: TeamSystemTaskControlScope = { kind: 'team-run-default-worker-cancel', teamId: task.teamId, taskId: task.id, expectedRevision: task.revision,
      coordinator: { teamId: task.teamId, participantId: coordinator.id, activationId: coordinatorBinding.activation.id,
        sessionId: coordinatorBinding.sessionId, provider: coordinatorBinding.provider } }
    const proof = Object.freeze({}) as TeamSystemTaskControlProof
    const release = ctx.teams.registerSystemTaskControlProofSource({ name: 'team-run', resolveTaskControlProof: candidate => candidate === proof ? scope : undefined })
    const link = await connectRemoteLink(fixture)
    const pending = Promise.withResolvers<TeamLinkTaskCancellationNotification>()
    link.onTaskCancellation(async (notification) => { pending.resolve(notification) })
    task = await ctx.teams.cancelTask({ actor: proof, teamId: task.teamId, taskId: task.id, expectedRevision: task.revision })
    const notification = await pending.promise
    expect(notification.cancellation.target).toMatchObject({ attemptId, activationId: fixture.binding.activation.id })
    await link.close()
    const reconnected = await connectRemoteLink(fixture)
    const replay = Promise.withResolvers<TeamLinkTaskCancellationNotification>()
    reconnected.onTaskCancellation(async (notice) => { replay.resolve(notice) })
    expect(await replay.promise).toEqual(notification)
    const result = await reconnected.acknowledgeTaskCancellation({ taskId: task.id, attemptId, expectedRevision: notification.revision })
    expect(result.phase).toBe('cancelled')
    expect(result.attemptHistory.at(-1)).toMatchObject({ id: attemptId, outcome: { kind: 'cancelled' } })
    expect((await ctx.teams.getTeam({ teamId: task.teamId })).team.phase).toBe('active')
    await reconnected.close()
    release()
  })
}
