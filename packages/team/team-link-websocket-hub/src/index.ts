import { channelInvitationAcknowledgeInputSchema, channelGetRequestSchema } from '@clocky/clocky-team'
/** Authenticated WebSocket entry point for remote Team Link clients. @module @clocky/clocky-team-link-websocket-hub */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@clocky/cordis'
import type {} from '@clocky/clocky-host-webserver'
import {
  TeamError,
  channelIdSchema,
  channelPostIdempotencyKeySchema,
  envelopeIdSchema,
  taskAttemptIdSchema,
  teamEnvelopeDraftSchema,
  teamInterruptIdSchema,
  teamTaskAttemptSettleInputSchema,
  teamTaskAttemptHeartbeatInputSchema,
  teamTaskAttemptStartClaimInputSchema,
  teamTaskIdSchema,
} from '@clocky/clocky-team'
import { executeTeamIntegrationTask } from '@clocky/clocky-team-workspace'
import type {} from '@clocky/clocky-team-workspace'
import type {
  ActivationBindingSnapshot,
  ActivationActorProofIssuer,
  ChannelId,
  ChannelWatchResult,
  EnvelopeId,
  JsonObject,
  JsonValue,
  ParticipantInterruptSnapshot,
  TeamInterruptId,
  TeamEnvelope,
  TeamActorProofLease,
  TeamWatchResult,
} from '@clocky/clocky-team'
import {
  TeamLinkError,
  TEAM_LINK_FRAME_VERSION,
  parseTeamLinkClientFrame,
  parseTeamLinkServerFrame,
  teamLinkBindingIdentitySchema,
  teamLinkDeliveryIdSchema,
} from '@clocky/clocky-team-link'
import type {
  TeamLinkBindingIdentity,
  TeamLinkClientFrame,
  TeamLinkDeliveryId,
  TeamLinkEnrollment,
  TeamLinkEnrollmentProvider,
  TeamLinkResponseError,
  TeamLinkServerFrame,
  TeamLinkTerminationReason,
} from '@clocky/clocky-team-link'
import z from '@clocky/schemastery'
import WebSocket, { WebSocketServer } from 'ws'
import { z as schema } from 'zod'
import { EnrollmentLedger, EnrollmentLedgerError } from './enrollment-ledger.ts'

/** Cordis plugin name. */
export const name = 'team-link-websocket-hub'
/** The authoritative Team provider, Link registry, HTTP upgrade carrier, and durable enrollment log must exist first. */
export const inject = ['teams', 'teamLinks', 'webServer', 'storageLog']

const DEFAULT_PATH = '/team-link'
const DEFAULT_PAGE_SIZE = 64
const DEFAULT_MAX_FRAME_BYTES = 64 * 1024
const DEFAULT_MAX_CONNECTIONS = 1_024
const DEFAULT_MAX_PENDING_REQUESTS = 32
const DEFAULT_MAX_QUEUED_BYTES = 256 * 1024
const DEFAULT_MAX_OUTSTANDING_DELIVERIES = 128
const DEFAULT_REQUEST_WINDOW_MS = 1_000
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 128
const DEFAULT_CLOSE_TIMEOUT_MS = 5_000
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000
const DEFAULT_RETRYABLE_NACK_DELAY_MS = 100
const DEFAULT_BACKPRESSURE_RETRY_AFTER_MS = 100
const DEFAULT_ENROLLMENT_PROVIDER_NAME = 'websocket'
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** One environment-backed remote capability and its immutable Team activation identity. */
export interface CapabilityBindingConfig {
  /** Environment-variable name holding this binding's capability. */
  readonly capabilityEnv: string
  /** Durable activation epoch. */
  readonly activationId: string
  /** Team owning the activation. */
  readonly teamId: string
  /** Participant owning the activation. */
  readonly participantId: string
  /** Session durably bound to the activation. */
  readonly sessionId: string
  /** AgentRuntime provider that published the activation. */
  readonly provider: string
}

/** Deployment configuration for the authenticated WebSocket Hub listener. */
export interface Config {
  /** Exact WebSocket upgrade pathname. */
  readonly path: string
  /** Complete public WebSocket endpoint returned to dynamically enrolled children. */
  readonly endpoint: string
  /** Registry name used by dynamically enrolled remote children. */
  readonly enrollmentProviderName: string
  /** One immutable identity for each capability environment-variable name. */
  readonly bindings: CapabilityBindingConfig[]
  /** Maximum pending deliveries read in one authoritative Hub page. */
  readonly pageSize: number
  /** Maximum inbound or outbound JSON frame size in bytes. */
  readonly maxFrameBytes: number
  /** Maximum accepted sockets, including clients that have not authenticated. */
  readonly maxConnections: number
  /** Maximum inbound frames awaiting serial processing on one socket. */
  readonly maxPendingRequests: number
  /** Maximum combined application queue and socket buffered bytes before close. */
  readonly maxQueuedBytes: number
  /**
   * Maximum combined Envelope deliveries, interrupt deliveries, and cached interrupt acknowledgements retained for one socket.
   * Live deliveries evict cached acknowledgements before close.
   */
  readonly maxOutstandingDeliveries: number
  /** Fixed request-rate accounting interval. */
  readonly requestWindowMs: number
  /** Maximum inbound frames admitted during one accounting interval. */
  readonly maxRequestsPerWindow: number
  /** Maximum close wait before an owned socket is terminated. */
  readonly closeTimeoutMs: number
  /** Maximum attach-and-subscribe handshake time before an untrusted socket closes. */
  readonly handshakeTimeoutMs: number
  /** Interval between server-originated WebSocket heartbeat pings. */
  readonly heartbeatIntervalMs: number
  /** Maximum wait for a heartbeat pong before the socket closes. */
  readonly heartbeatTimeoutMs: number
  /** Delay before a retryable client nack can reissue its pending delivery. */
  readonly retryableNackDelayMs: number
  /** Advisory delay returned when the authoritative Team channel is backpressured. */
  readonly backpressureRetryAfterMs: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  path: z.string().default(DEFAULT_PATH),
  endpoint: z.string().min(1).required(),
  enrollmentProviderName: z.string().min(1).default(DEFAULT_ENROLLMENT_PROVIDER_NAME),
  bindings: z.array(z.object({
    capabilityEnv: z.string().required(),
    activationId: z.string().required(),
    teamId: z.string().required(),
    participantId: z.string().required(),
    sessionId: z.string().required(),
    provider: z.string().required(),
  })).default([]),
  pageSize: z.number().step(1).min(1).default(DEFAULT_PAGE_SIZE),
  maxFrameBytes: z.number().step(1).min(1).default(DEFAULT_MAX_FRAME_BYTES),
  maxConnections: z.number().step(1).min(1).default(DEFAULT_MAX_CONNECTIONS),
  maxPendingRequests: z.number().step(1).min(1).default(DEFAULT_MAX_PENDING_REQUESTS),
  maxQueuedBytes: z.number().step(1).min(1).default(DEFAULT_MAX_QUEUED_BYTES),
  maxOutstandingDeliveries: z.number().step(1).min(1).default(DEFAULT_MAX_OUTSTANDING_DELIVERIES),
  requestWindowMs: z.number().step(1).min(1).default(DEFAULT_REQUEST_WINDOW_MS),
  maxRequestsPerWindow: z.number().step(1).min(1).default(DEFAULT_MAX_REQUESTS_PER_WINDOW),
  closeTimeoutMs: z.number().step(1).min(1).default(DEFAULT_CLOSE_TIMEOUT_MS),
  handshakeTimeoutMs: z.number().step(1).min(1).default(DEFAULT_HANDSHAKE_TIMEOUT_MS),
  heartbeatIntervalMs: z.number().step(1).min(1).default(DEFAULT_HEARTBEAT_INTERVAL_MS),
  heartbeatTimeoutMs: z.number().step(1).min(1).default(DEFAULT_HEARTBEAT_TIMEOUT_MS),
  retryableNackDelayMs: z.number().step(1).min(1).default(DEFAULT_RETRYABLE_NACK_DELAY_MS),
  backpressureRetryAfterMs: z.number().step(1).min(1).default(DEFAULT_BACKPRESSURE_RETRY_AFTER_MS),
})

interface ResolvedCapabilityBinding {
  readonly identity: TeamLinkBindingIdentity
  readonly capabilityHash: Buffer
}

interface ResolvedConfig extends Omit<Config, 'bindings'> {
  readonly bindings: readonly ResolvedCapabilityBinding[]
  readonly endpointUrl: URL
}

interface OutstandingDelivery {
  readonly channelId: ChannelId
  readonly envelopeId: EnvelopeId
  readonly envelope: TeamEnvelope
}

interface InterruptDelivery {
  readonly deliveryId: TeamLinkDeliveryId
  readonly interrupt: ParticipantInterruptSnapshot
}

interface Settled<T> {
  readonly kind: 'fulfilled' | 'rejected'
  readonly value?: T
  readonly reason?: unknown
}

/** One pending endpoint acknowledgement for a Hub-originated cancellation. */
interface PendingCancellation {
  readonly resolve: (accepted: boolean) => void
  readonly reject: (error: Error) => void
}

class ProtocolError extends Error {
  constructor(readonly response: TeamLinkResponseError) {
    super(response.message)
  }
}

const postInputSchema = schema.object({
  expectedCursor: schema.number().int().min(0).optional(),
  idempotencyKey: channelPostIdempotencyKeySchema,
  draft: teamEnvelopeDraftSchema,
}).strict()

const directFinalInputSchema = schema.object({
  channelId: channelIdSchema,
  idempotencyKey: channelPostIdempotencyKeySchema,
  text: schema.string().min(1),
}).strict()

const claimInputSchema = schema.object({
  channelId: channelIdSchema,
  envelopeId: envelopeIdSchema,
}).strict()

const taskReviewInputSchema = schema.object({
  taskId: teamTaskIdSchema,
  expectedRevision: schema.number().int().min(1),
  nextPhase: schema.enum(['pending', 'completed']),
  reason: schema.string().min(1),
}).strict()

const taskIntegrationInputSchema = schema.object({
  taskId: teamTaskIdSchema,
  attemptId: taskAttemptIdSchema,
  expectedRevision: schema.number().int().min(1),
  verification: schema.string().min(1).optional(),
}).strict()

const receiptInputSchema = schema.object({
  channelId: channelIdSchema,
  envelopeId: envelopeIdSchema,
  expectedCursor: schema.number().int().min(0),
}).strict()

const interruptAckInputSchema = schema.object({
  deliveryId: teamLinkDeliveryIdSchema,
  interruptId: teamInterruptIdSchema,
}).strict()

/** Owns one `ws` acceptor, dynamic credential issuer, and every accepted socket. */
class WebSocketTeamLinkHub implements TeamLinkEnrollmentProvider {
  private readonly server: WebSocketServer
  private readonly connections = new Set<TeamLinkSocket>()
  private readonly bindings = new Map<string, TeamLinkSocket>()
  private closed = false

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
    private readonly enrollments: EnrollmentLedger,
    private readonly actorIssuer: ActivationActorProofIssuer,
  ) {
    this.server = new WebSocketServer({
      noServer: true,
      maxPayload: config.maxFrameBytes,
      perMessageDeflate: false,
    })
    this.server.on('error', () => undefined)
    this.server.on('wsClientError', (_error, socket) => { socket.destroy() })
  }

  /** Registry name selected by remote activation owners. */
  get name(): string {
    return this.config.enrollmentProviderName
  }

  /** Issue one opaque credential only for a current durable activation binding. */
  async reserve(binding: ActivationBindingSnapshot): Promise<TeamLinkEnrollment> {
    if (this.closed) {
      throw new TeamLinkError('WebSocket Team Link Hub is closed', 'TEAM_LINK_ENROLLMENT_MISMATCH')
    }
    const identity = identityForBinding(binding)
    const current = await this.ctx.teams.getActivation({
      teamId: identity.teamId,
      activationId: identity.activationId,
    })
    if (!sameBinding(current, identity) || !isDeliverable(current)) {
      throw new TeamLinkError('Team Link enrollment requires a current deliverable activation binding', 'TEAM_LINK_ENROLLMENT_MISMATCH')
    }
    const key = identityKey(identity)
    if (this.config.bindings.some(candidate => sameIdentity(candidate.identity, identity))) {
      throw new TeamLinkError(`Team Link enrollment already exists for activation '${identity.activationId}'`, 'TEAM_LINK_ENROLLMENT_MISMATCH')
    }
    const capability = randomBytes(32).toString('base64url')
    const previous = this.enrollments.get(identity)
    const issued = previous?.state === 'issued'
      ? await this.enrollments.rotate(identity, previous.generation, capability)
      : await this.enrollments.issue(identity, capability)
    if (previous?.state === 'issued') {
      const connection = this.bindings.get(key)
      if (connection !== undefined) {
        await connection.requestCancellation({
          code: 'TEAM_LINK_CREDENTIAL_ROTATED',
          message: 'the remote Team Link credential was rotated',
        }).catch((error: unknown) => {
          this.ctx.logger.warn(`team-link-websocket-hub: cooperative credential-rotation cancellation failed: ${renderError(error)}`)
        })
        await connection.close(1008, 'credential rotated')
      }
    }
    let revoked = false
    return {
      provider: this.name,
      endpoint: this.config.endpointUrl.toString(),
      capability,
      revoke: async () => {
        if (revoked) return
        revoked = true
        try {
          const current = this.enrollments.get(identity)
          if (current?.generation !== issued.generation || current.state !== 'issued') return
          await this.enrollments.revoke(identity, issued.generation)
          const connection = this.bindings.get(key)
          if (connection !== undefined) {
            await connection.requestCancellation({
              code: 'TEAM_LINK_CREDENTIAL_REVOKED',
              message: 'the remote Team Link credential was revoked',
            }).catch((error: unknown) => {
              this.ctx.logger.warn(`team-link-websocket-hub: cooperative credential-revocation cancellation failed: ${renderError(error)}`)
            })
            await connection.close(1008, 'credential revoked')
          }
        } catch (cause: unknown) {
          if (cause instanceof EnrollmentLedgerError && cause.code === 'TEAM_LINK_ENROLLMENT_LEDGER_CLOSED') return
          throw cause
        }
      },
    }
  }

  /** Accept an already-routed HTTP upgrade. */
  handle(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (this.closed || this.connections.size >= this.config.maxConnections) {
      socket.destroy()
      return
    }
    try {
      this.server.handleUpgrade(req, socket, head, (websocket) => {
        if (this.closed || this.connections.size >= this.config.maxConnections) {
          websocket.terminate()
          return
        }
        const connection = new TeamLinkSocket(this.ctx, websocket, this.config, this.actorIssuer, (binding) => {
          this.connections.delete(connection)
          if (binding !== undefined && this.bindings.get(identityKey(binding)) === connection) {
            this.bindings.delete(identityKey(binding))
          }
        }, (binding) => {
          if (this.closed || this.bindings.has(identityKey(binding))) return false
          this.bindings.set(identityKey(binding), connection)
          return true
        }, (identity, capability) => this.resolveCredential(identity, capability))
        this.connections.add(connection)
      })
    } catch {
      socket.destroy()
    }
  }

  /** Close every accepted socket before closing the no-server acceptor. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await Promise.all([...this.connections].map(connection => connection.close(1001, 'server closing')))
    await new Promise<void>((resolve) => {
      this.server.close(() => { resolve() })
    })
    await this.enrollments.close()
    this.actorIssuer.close()
  }

  /** Return a static or dynamic binding only after its opaque credential matches. */
  private resolveCredential(identity: TeamLinkBindingIdentity, capability: string): TeamLinkBindingIdentity | undefined {
    const staticBinding = this.config.bindings.find(candidate => sameIdentity(candidate.identity, identity))
    if (staticBinding !== undefined && constantTimeCapabilityMatch(staticBinding.capabilityHash, capability)) {
      return staticBinding.identity
    }
    const dynamic = this.enrollments.resolve(identity, capability)
    if (dynamic !== undefined) return dynamic.binding
    return undefined
  }
}

/** Owns frame admission, replay, and bounded outbound state for one remote activation. */
class TeamLinkSocket {
  private readonly closed = Promise.withResolvers<void>()
  private readonly abort = new AbortController()
  private readonly channels = new Set<ChannelId>()
  private readonly watchers = new Set<Promise<void>>()
  private readonly seenRequestIds = new Set<string>()
  private readonly deliveries = new Map<string, OutstandingDelivery>()
  private readonly deliveryKeys = new Map<string, string>()
  private readonly causationDeliveries = new Map<EnvelopeId, OutstandingDelivery>()
  private readonly invitationRevisions = new Map<ChannelId, number>()
  private readonly taskCancellationRevisions = new Map<string, number>()
  private readonly interruptDeliveries = new Map<TeamLinkDeliveryId, InterruptDelivery>()
  private readonly interruptIds = new Map<TeamInterruptId, TeamLinkDeliveryId>()
  private readonly acknowledgedInterrupts = new Map<TeamLinkDeliveryId, InterruptDelivery>()
  /** Hub-originated cancellation requests awaiting an endpoint result. */
  private readonly pendingCancellations = new Map<string, PendingCancellation>()
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>()
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined
  private heartbeatDeadline: ReturnType<typeof setTimeout> | undefined
  private inbound = Promise.resolve()
  private outbound = Promise.resolve()
  private binding: TeamLinkBindingIdentity | undefined
  /** Revocable actor authority held only after credential and binding verification. */
  private actorLease: TeamActorProofLease | undefined
  private pendingRequests = 0
  private queuedBytes = 0
  private requestsInWindow = 0
  private windowStartedAt = Date.now()
  private subscribed = false
  private closing = false
  private finished = false
  private shutdown: Promise<void> | undefined
  private interruptReplay: Promise<void> | undefined
  private interruptReplayRequested = false

  constructor(
    private readonly ctx: Context,
    private readonly socket: WebSocket,
    private readonly config: ResolvedConfig,
    private readonly actorIssuer: ActivationActorProofIssuer,
    private readonly onClose: (binding: TeamLinkBindingIdentity | undefined) => void,
    private readonly claimBinding: (binding: TeamLinkBindingIdentity) => boolean,
    private readonly resolveCredential: (identity: TeamLinkBindingIdentity, capability: string) => TeamLinkBindingIdentity | undefined,
  ) {
    socket.on('message', (data, isBinary) => { this.enqueueInbound(data, isBinary) })
    socket.on('pong', () => { this.acknowledgeHeartbeat() })
    socket.once('close', () => { this.finish() })
    socket.once('error', () => { this.finish() })
    this.handshakeTimer = setTimeout(() => {
      this.handshakeTimer = undefined
      void this.close(1008, 'handshake timeout')
    }, config.handshakeTimeoutMs)
  }

  /** Stop socket admission and wait only up to the configured close bound. */
  close(code: number, reason: string): Promise<void> {
    this.shutdown ??= this.shutdownSocket(code, reason)
    return this.shutdown
  }

  /** Ask an attached endpoint to stop Link-owned admission before closing its socket. */
  async requestCancellation(reason: TeamLinkTerminationReason): Promise<boolean> {
    if (this.closing || !this.subscribed || this.binding === undefined) return false
    const id = `team-link-cancel-${randomUUID()}`
    const completion = Promise.withResolvers<boolean>()
    this.pendingCancellations.set(id, completion)
    try {
      await this.send({ v: TEAM_LINK_FRAME_VERSION, type: 'cancel', id, reason })
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          void this.close(1011, 'cancellation timeout')
          reject(new Error('remote Team Link cancellation acknowledgement timed out'))
        }, this.config.closeTimeoutMs)
      })
      try {
        return await Promise.race([completion.promise, timeout])
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    } finally {
      this.pendingCancellations.delete(id)
    }
  }

  private enqueueInbound(data: WebSocket.RawData, isBinary: boolean): void {
    if (this.closing) return
    this.pendingRequests += 1
    if (this.pendingRequests > this.config.maxPendingRequests) {
      void this.close(1008, 'request limit')
      return
    }
    const process = async (): Promise<void> => {
      try {
        if (this.closing) return
        await this.processInbound(data, isBinary)
      } finally {
        this.pendingRequests -= 1
      }
    }
    this.inbound = this.inbound.then(process, process).catch(() => {
      void this.close(1011, 'server failure')
    })
  }

  private async processInbound(data: WebSocket.RawData, isBinary: boolean): Promise<void> {
    if (isBinary || !this.admitRate()) {
      await this.close(1008, isBinary ? 'binary frame' : 'rate limit')
      return
    }
    const text = decodeFrame(data)
    if (text === undefined || Buffer.byteLength(text) > this.config.maxFrameBytes) {
      await this.close(1009, 'frame too large')
      return
    }
    let frame: TeamLinkClientFrame
    try {
      frame = parseTeamLinkClientFrame(JSON.parse(text) as unknown)
    } catch {
      await this.close(1008, 'invalid frame')
      return
    }
    if ('id' in frame && !this.claimRequestId(frame.id)) {
      await this.close(1008, 'duplicate request')
      return
    }
    await this.handleFrame(frame)
  }

  private async handleFrame(frame: TeamLinkClientFrame): Promise<void> {
    if (frame.type === 'attach') {
      if (this.binding !== undefined) {
        await this.respondError(frame.id, invalidState())
        return
      }
      try {
        const attached = await this.attach(frame)
        const actorLease = this.actorIssuer.issue(attached.binding)
        if (!this.claimBinding(attached.identity)) {
          actorLease.revoke()
          throw new ProtocolError(bindingInUse())
        }
        this.binding = attached.identity
        this.actorLease = actorLease
        await this.send({
          v: TEAM_LINK_FRAME_VERSION,
          type: 'attached',
          id: frame.id,
          binding: this.binding,
        })
      } catch (error: unknown) {
        await this.respondError(frame.id, responseError(error, this.config.backpressureRetryAfterMs))
      }
      return
    }

    if (frame.type === 'subscribe') {
      if (this.binding === undefined) {
        await this.respondError(frame.id, unauthorized())
        return
      }
      if (this.subscribed) {
        await this.respondError(frame.id, invalidState())
        return
      }
      this.subscribed = true
      await this.respond(frame.id, { subscribed: true })
      this.stopHandshake()
      this.startHeartbeat()
      this.scheduleInterruptReplay()
      this.track(this.watchTeam())
      return
    }

    if (frame.type === 'nack') {
      await this.handleNack(frame)
      return
    }

    if (frame.type === 'cancelled') {
      this.handleCancellationResult(frame)
      return
    }

    if (this.binding === undefined) {
      await this.respondError(frame.id, unauthorized())
      return
    }
    try {
      await this.respond(frame.id, await this.dispatch(frame.op, frame.input))
    } catch (error: unknown) {
      await this.respondError(frame.id, responseError(error, this.config.backpressureRetryAfterMs))
    }
  }

  private async attach(frame: Extract<TeamLinkClientFrame, { readonly type: 'attach' }>): Promise<{
    readonly identity: TeamLinkBindingIdentity
    readonly binding: ActivationBindingSnapshot
  }> {
    const binding = this.resolveCredential(frame.binding, frame.capability)
    if (binding === undefined) {
      throw new ProtocolError(unauthorized())
    }
    const current = await this.ctx.teams.getActivation({
      teamId: binding.teamId,
      activationId: binding.activationId,
    })
    if (!sameBinding(current, binding) || !isDeliverable(current)) {
      throw new ProtocolError(unauthorized())
    }
    return { identity: binding, binding: current }
  }

  private async dispatch(operation: Extract<TeamLinkClientFrame, { readonly type: 'request' }>['op'], input: JsonObject): Promise<JsonValue> {
    this.requireBinding()
    switch (operation) {
      case 'channel-get': {
        const request = parseInput(channelGetRequestSchema, input)
        return await this.ctx.teams.getChannelForActor({ actor: this.requireActorLease().proof, ...request }) as unknown as JsonValue
      }
      case 'invitation-ack': {
        const request = parseInput(channelInvitationAcknowledgeInputSchema, input)
        const result = await this.ctx.teams.acknowledgeChannelInvitation({ actor: this.requireActorLease().proof, ...request })
        this.invitationRevisions.delete(request.channelId)
        return result as unknown as JsonValue
      }
      case 'post': {
        const request = parseInput(postInputSchema, input)
        const channel = await this.ctx.teams.getChannel({ channelId: request.draft.channelId })
        const accepted = await this.ctx.teams.postChannelEnvelope({
          actor: this.requireActorLease().proof,
          expectedCursor: request.expectedCursor ?? channel.cursor,
          idempotencyKey: request.idempotencyKey,
          draft: request.draft,
        })
        this.clearCausationDelivery(request.draft.causationId)
        return accepted as unknown as JsonValue
      }
      case 'final-result': {
        const request = parseInput(directFinalInputSchema, input)
        return await this.ctx.teams.postChannelFinalEnvelope({
          actor: this.requireActorLease().proof,
          channelId: request.channelId,
          idempotencyKey: request.idempotencyKey,
          text: request.text,
        }) as unknown as JsonValue
      }
      case 'claim': {
        const request = parseInput(claimInputSchema, input)
        const claim = await this.ctx.teams.claimChannelDelivery({
          actor: this.requireActorLease().proof,
          channelId: request.channelId,
          envelopeId: request.envelopeId,
        })
        return claim === undefined ? null : claim as unknown as JsonValue
      }
      case 'task-start': {
        const request = parseInput(teamTaskAttemptStartClaimInputSchema, input)
        return await this.ctx.teams.claimTaskAttemptStart({
          actor: this.requireActorLease().proof,
          ...request,
        }) as unknown as JsonValue
      }
      case 'task-cancellation-ack': {
        const request = parseInput(schema.object({
          taskId: teamTaskIdSchema, attemptId: taskAttemptIdSchema, expectedRevision: schema.number().int().positive(),
        }).strict(), input)
        const binding = this.requireBinding()
        const task = await this.ctx.teams.getTask({ teamId: binding.teamId, taskId: request.taskId })
        const target = task.cancellation?.target
        if (target?.kind !== 'attempt' || target.attemptId !== request.attemptId
          || target.activationId !== binding.activationId || target.participantId !== binding.participantId) {
          throw new TeamError('task cancellation does not select this exact binding', 'TEAM_INVALID_ARGUMENT')
        }
        const settled = await this.ctx.teams.settleTaskAttempt({ actor: this.requireActorLease().proof, ...request, outcome: { kind: 'cancelled' } })
        this.taskCancellationRevisions.delete(request.taskId)
        return settled as unknown as JsonValue
      }
      case 'task-settle': {
        const request = parseInput(teamTaskAttemptSettleInputSchema, input)
        return await this.ctx.teams.settleTaskAttempt({
          actor: this.requireActorLease().proof,
          ...request,
        }) as unknown as JsonValue
      }
      case 'task-integrate': {
        const request = parseInput(taskIntegrationInputSchema, input)
        const binding = this.requireBinding()
        const workspaces = this.ctx.get('teamWorkspaces')
        if (workspaces === undefined) {
          throw new TeamError('Team Link integration requires a Team workspace provider registry', 'TEAM_INVALID_ARGUMENT')
        }
        return await executeTeamIntegrationTask(this.ctx.teams, workspaces, {
          actor: this.requireActorLease().proof,
          teamId: binding.teamId,
          participantId: binding.participantId,
          activationId: binding.activationId,
          ...request,
        }) as unknown as JsonValue
      }
      case 'task-heartbeat': {
        const request = parseInput(teamTaskAttemptHeartbeatInputSchema, input)
        return await this.ctx.teams.heartbeatTaskAttempt({
          actor: this.requireActorLease().proof,
          ...request,
        }) as unknown as JsonValue
      }
      case 'task-review': {
        const request = parseInput(taskReviewInputSchema, input)
        return await this.ctx.teams.resolveTaskReview({
          actor: this.requireActorLease().proof,
          ...request,
        }) as unknown as JsonValue
      }
      case 'receipt': {
        const request = parseInput(receiptInputSchema, input)
        const receipt = await this.ctx.teams.ackChannelEnvelope({
          actor: this.requireActorLease().proof,
          ...request,
        })
        this.clearDelivery(request.channelId, request.envelopeId)
        return receipt as unknown as JsonValue
      }
      case 'interrupt-ack': {
        const request = parseInput(interruptAckInputSchema, input)
        return await this.acknowledgeInterrupt(request.deliveryId, request.interruptId) as unknown as JsonValue
      }
    }
  }

  private async handleNack(frame: Extract<TeamLinkClientFrame, { readonly type: 'nack' }>): Promise<void> {
    const binding = this.binding
    if (binding === undefined || !this.subscribed) return
    if (!await this.isCurrentDeliveryBinding()) return
    const delivery = this.deliveries.get(frame.deliveryId)
    if (delivery === undefined || delivery.channelId !== frame.channelId || delivery.envelopeId !== frame.envelopeId) return
    this.clearDelivery(frame.channelId, frame.envelopeId)
    if (frame.retryable) this.scheduleRetry(delivery)
  }

  /** Resolve one Hub-owned cancellation request and reject unsolicited results. */
  private handleCancellationResult(frame: Extract<TeamLinkClientFrame, { readonly type: 'cancelled' }>): void {
    const pending = this.pendingCancellations.get(frame.id)
    if (pending === undefined) throw new ProtocolError(unexpectedCancellation())
    pending.resolve(frame.accepted)
  }

  private scheduleRetry(delivery: OutstandingDelivery): void {
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer)
      if (this.abort.signal.aborted) return
      this.track(this.retryDelivery(delivery))
    }, this.config.retryableNackDelayMs)
    this.retryTimers.add(timer)
  }

  private async retryDelivery(delivery: OutstandingDelivery): Promise<void> {
    if (!await this.isCurrentDeliveryBinding()) return
    const claim = await this.ctx.teams.claimChannelDelivery({
      actor: this.requireActorLease().proof,
      channelId: delivery.channelId,
      envelopeId: delivery.envelopeId,
    })
    if (claim !== undefined) await this.notify(delivery.envelope)
  }

  private async watchTeam(): Promise<void> {
    const binding = this.requireBinding()
    let state = await this.ctx.teams.getTeam({ teamId: binding.teamId })
    this.startChannels(state.channelIds)
    while (!this.abort.signal.aborted) {
      const watched = settle(this.ctx.teams.watchTeam({
        teamId: binding.teamId,
        afterCursor: state.team.cursor,
        signal: this.abort.signal,
      }))
      const result = await watched
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- abort can race the settled cursor watch.
      if (this.abort.signal.aborted) return
      if (result.kind === 'rejected') throw result.reason
      if (result.value?.kind === 'closed') return
      assertTeamWatchCursor(result.value, state.team.cursor)
      state = await this.ctx.teams.getTeam({ teamId: binding.teamId })
      this.startChannels(state.channelIds)
      this.scheduleInterruptReplay()
    }
  }

  private startChannels(channelIds: readonly ChannelId[]): void {
    for (const channelId of channelIds) {
      if (this.abort.signal.aborted || this.channels.has(channelId)) continue
      this.channels.add(channelId)
      this.track(this.startChannel(channelId))
    }
  }

  private async startChannel(channelId: ChannelId): Promise<void> {
    const binding = this.requireBinding()
    const channel = await this.ctx.teams.getChannel({ channelId })
    if (channel.manifest.teamId !== binding.teamId) throw new Error('invalid Team channel')
    if (!channel.manifest.participants.some(participant => participant.id === binding.participantId)) return
    await this.watchChannel(channelId)
  }

  private async watchChannel(channelId: ChannelId): Promise<void> {
    const binding = this.requireBinding()
    let afterCursor = -1
    while (!this.abort.signal.aborted) {
      if (!await this.isCurrentDeliveryBinding()) return
      const watchAfterCursor = afterCursor
      const watched = settle(this.ctx.teams.watchChannel({ channelId, afterCursor, signal: this.abort.signal }))
      const current = await this.ctx.teams.getChannel({ channelId })
      if (current.manifest.teamId !== binding.teamId) throw new Error('invalid Team channel')
      if (afterCursor === -1 && current.replayWatermark !== undefined) {
        afterCursor = current.replayWatermark
      }
      await this.notifyInvitation(channelId)
      if (current.phase === 'pending') {
        afterCursor = current.cursor
        const observed = await watched
        if (observed.kind === 'rejected') throw observed.reason
        assertWatchCursor(observed.value, watchAfterCursor, channelId)
        if (observed.value?.kind === 'closed') return
        continue
      }
      if ((current.phase !== 'active' && current.phase !== 'closed')) {
        const observed = await watched
        if (observed.kind === 'rejected') throw observed.reason
        assertWatchCursor(observed.value, watchAfterCursor, channelId)
        return
      }
      let page
      try {
        page = await this.ctx.teams.listChannelPendingDeliveries({
          channelId,
          participantId: binding.participantId,
          afterCursor,
          limit: this.config.pageSize,
        })
      } catch (error: unknown) {
        const current = await this.ctx.teams.getChannel({ channelId })
        if (current.manifest.teamId !== binding.teamId) throw new Error('invalid Team channel')
        if (current.phase !== 'active') {
          const observed = await watched
          if (observed.kind === 'rejected') throw observed.reason
          assertWatchCursor(observed.value, watchAfterCursor, channelId)
          return
        }
        throw error
      }
      if (page.channel.manifest.teamId !== binding.teamId || page.nextCursor < afterCursor) {
        throw new Error('invalid pending-delivery page')
      }
      for (const delivery of page.deliveries) {
        if (delivery.envelope.channelId !== channelId || delivery.envelope.teamId !== binding.teamId) {
          throw new Error('invalid pending delivery')
        }
        await this.notify(delivery.envelope)
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- notification handoff can race socket close.
        if (this.abort.signal.aborted) return
      }
      afterCursor = page.nextCursor
      const result = await watched
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- abort can race the settled channel watch.
      if (this.abort.signal.aborted) return
      if (result.kind === 'rejected') throw result.reason
      assertWatchCursor(result.value, watchAfterCursor, channelId)
      if (page.channel.phase === 'closed') {
        if (afterCursor < page.channel.cursor) continue
        return
      }
      if (result.value?.kind === 'closed') return
    }
  }

  /** Replay only this binding's pending manifest, retaining bounded state until acknowledgement or expiry. */
  private async notifyInvitation(channelId: ChannelId): Promise<void> {
    if (!await this.isCurrentDeliveryBinding()) return
    const binding = this.requireBinding()
    const admission = await this.ctx.teams.getChannelAdmission({ channelId })
    const invitation = admission.invitations.find(value => value.participantId === binding.participantId)
    if (invitation === undefined) return
    if (invitation.status !== 'pending') {
      if (this.invitationRevisions.delete(channelId)) {
        await this.send({ v: TEAM_LINK_FRAME_VERSION, type: 'invitation', notification: { channel: admission.channel, invitation } })
      }
      return
    }
    if (invitation.endpoint.kind !== 'activation'
      || (invitation.endpoint.activationId !== undefined && invitation.endpoint.activationId !== binding.activationId)
      || (invitation.endpoint.sessionId !== undefined && invitation.endpoint.sessionId !== binding.sessionId)
      || this.invitationRevisions.get(channelId) === invitation.revision) return
    if (!this.invitationRevisions.has(channelId) && !this.makeLiveDeliveryCapacity()) {
      void this.close(1008, 'slow invitation consumer')
      return
    }
    this.invitationRevisions.set(channelId, invitation.revision)
    await this.send({ v: TEAM_LINK_FRAME_VERSION, type: 'invitation', notification: { channel: admission.channel, invitation } })
  }

  private async notify(envelope: TeamEnvelope): Promise<void> {
    if (!await this.isCurrentDeliveryBinding()) return
    const key = deliveryKey(envelope.channelId, envelope.id)
    if (this.deliveryKeys.has(key) || this.closing) return
    if (!this.makeLiveDeliveryCapacity()) {
      void this.close(1008, 'slow consumer')
      return
    }
    const deliveryId = teamLinkDeliveryIdSchema.parse(randomUUID())
    const delivery: OutstandingDelivery = { channelId: envelope.channelId, envelopeId: envelope.id, envelope }
    this.deliveries.set(deliveryId, delivery)
    this.deliveryKeys.set(key, deliveryId)
    this.causationDeliveries.set(envelope.id, delivery)
    try {
      await this.send({
        v: TEAM_LINK_FRAME_VERSION,
        type: 'notify',
        deliveryId,
        envelope,
      })
    } catch (error: unknown) {
      this.clearDelivery(envelope.channelId, envelope.id)
      throw error
    }
  }

  private clearDelivery(channelId: ChannelId, envelopeId: EnvelopeId): void {
    const key = deliveryKey(channelId, envelopeId)
    const deliveryId = this.deliveryKeys.get(key)
    if (deliveryId === undefined) return
    this.deliveryKeys.delete(key)
    this.deliveries.delete(deliveryId)
    this.causationDeliveries.delete(envelopeId)
  }

  private clearCausationDelivery(causationId: EnvelopeId | undefined): void {
    if (causationId === undefined) return
    const delivery = this.causationDeliveries.get(causationId)
    if (delivery === undefined) return
    this.clearDelivery(delivery.channelId, delivery.envelopeId)
  }

  private scheduleInterruptReplay(): void {
    if (this.closing || this.abort.signal.aborted) return
    this.interruptReplayRequested = true
    if (this.interruptReplay !== undefined) return
    const replay = this.drainInterruptReplay()
    this.interruptReplay = replay
    this.track(replay)
  }

  /** Replay each interrupt wake that arrives while a prior durable read is still in flight. */
  private async drainInterruptReplay(): Promise<void> {
    try {
      while (!this.closing && !this.abort.signal.aborted) {
        this.interruptReplayRequested = false
        await this.replayPendingInterrupts()
        await this.replayTaskCancellations()
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- a Team watch can re-mark replay during the awaited durable read.
        if (!this.interruptReplayRequested) return
      }
    } finally {
      this.interruptReplay = undefined
    }
  }

  /** Replay exact task stops from durable state after attach and every Team journal change. */
  private async replayTaskCancellations(): Promise<void> {
    if (!await this.isCurrentDeliveryBinding()) return
    const binding = this.requireBinding()
    const state = await this.ctx.teams.getTeam({ teamId: binding.teamId })
    const pending = new Set<string>()
    for (const task of state.tasks) {
      const cancellation = task.cancellation
      const target = cancellation?.target
      if (task.lease === undefined || (task.phase !== 'assigned' && task.phase !== 'running') || cancellation === undefined || target?.kind !== 'attempt'
        || target.activationId !== binding.activationId || target.participantId !== binding.participantId) continue
      pending.add(task.id)
      if (this.taskCancellationRevisions.get(task.id) === task.revision) continue
      if (!this.taskCancellationRevisions.has(task.id) && !this.makeLiveDeliveryCapacity()) {
        void this.close(1008, 'slow consumer')
        return
      }
      this.taskCancellationRevisions.set(task.id, task.revision)
      await this.send({ v: TEAM_LINK_FRAME_VERSION, type: 'task-cancellation', notification: {
        taskId: task.id, phase: task.phase, revision: task.revision, cancellation,
      } })
    }
    for (const taskId of this.taskCancellationRevisions.keys()) {
      if (!pending.has(taskId)) this.taskCancellationRevisions.delete(taskId)
    }
  }

  private async replayPendingInterrupts(): Promise<void> {
    if (!await this.isCurrentDeliveryBinding()) return
    const binding = this.requireBinding()
    const interrupts = await this.ctx.teams.listPendingParticipantInterrupts({
      actor: this.requireActorLease().proof,
    })
    for (const interrupt of interrupts) {
      if (!sameInterruptTarget(interrupt, binding)) throw new Error('invalid pending interrupt')
      if (this.interruptIds.has(interrupt.id)) continue
      if (!this.makeLiveDeliveryCapacity()) {
        void this.close(1008, 'slow consumer')
        return
      }
      const delivery: InterruptDelivery = {
        deliveryId: teamLinkDeliveryIdSchema.parse(randomUUID()),
        interrupt,
      }
      this.interruptDeliveries.set(delivery.deliveryId, delivery)
      this.interruptIds.set(interrupt.id, delivery.deliveryId)
      try {
        await this.send({
          v: TEAM_LINK_FRAME_VERSION,
          type: 'interrupt',
          deliveryId: delivery.deliveryId,
          interrupt,
        })
      } catch (error: unknown) {
        this.interruptDeliveries.delete(delivery.deliveryId)
        this.interruptIds.delete(interrupt.id)
        throw error
      }
    }
  }

  private async acknowledgeInterrupt(
    deliveryId: TeamLinkDeliveryId,
    interruptId: TeamInterruptId,
  ): Promise<ParticipantInterruptSnapshot> {
    const binding = this.requireBinding()
    const delivery = this.interruptDeliveries.get(deliveryId) ?? this.acknowledgedInterrupts.get(deliveryId)
    if (delivery === undefined || delivery.interrupt.id !== interruptId || !sameInterruptTarget(delivery.interrupt, binding)) {
      throw new ProtocolError(invalidRequest())
    }
    const acknowledged = await this.ctx.teams.acknowledgeParticipantInterrupt({
      actor: this.requireActorLease().proof,
      interruptId,
    })
    if (!sameInterruptTarget(acknowledged, binding) || acknowledged.id !== interruptId) {
      throw new Error('invalid interrupt acknowledgement')
    }
    if (this.interruptDeliveries.delete(deliveryId)) {
      this.interruptIds.delete(interruptId)
      this.rememberAcknowledgedInterrupt(delivery)
    }
    return acknowledged
  }

  private rememberAcknowledgedInterrupt(delivery: InterruptDelivery): void {
    this.acknowledgedInterrupts.delete(delivery.deliveryId)
    this.acknowledgedInterrupts.set(delivery.deliveryId, delivery)
  }

  private retainedDeliveryCount(): number {
    return this.deliveries.size + this.interruptDeliveries.size + this.taskCancellationRevisions.size
      + this.invitationRevisions.size + this.acknowledgedInterrupts.size
  }

  private makeLiveDeliveryCapacity(): boolean {
    while (this.retainedDeliveryCount() >= this.config.maxOutstandingDeliveries && this.acknowledgedInterrupts.size > 0) {
      const oldest = this.acknowledgedInterrupts.keys().next().value
      this.acknowledgedInterrupts.delete(oldest as TeamLinkDeliveryId)
    }
    return this.retainedDeliveryCount() < this.config.maxOutstandingDeliveries
  }

  /** Begin half-open detection only after the remote peer has completed its authenticated handshake. */
  private startHeartbeat(): void {
    this.heartbeatTimer ??= setInterval(() => { this.sendHeartbeat() }, this.config.heartbeatIntervalMs)
  }

  /** Verify a live socket has not become half-open since its preceding ping. */
  private sendHeartbeat(): void {
    this.heartbeatDeadline = setTimeout(() => {
      this.heartbeatDeadline = undefined
      void this.close(1008, 'heartbeat timeout')
    }, this.config.heartbeatTimeoutMs)
    this.socket.ping()
  }

  /** Clear the one pending heartbeat deadline when the peer proves reachability. */
  private acknowledgeHeartbeat(): void {
    clearTimeout(this.heartbeatDeadline)
    this.heartbeatDeadline = undefined
  }

  /** Release the pre-authentication deadline once the remote peer has subscribed. */
  private stopHandshake(): void {
    clearTimeout(this.handshakeTimer)
    this.handshakeTimer = undefined
  }

  /** Stop heartbeat ownership before socket shutdown or a peer-originated close settles. */
  private stopHeartbeat(): void {
    clearInterval(this.heartbeatTimer)
    clearTimeout(this.heartbeatDeadline)
    this.heartbeatTimer = undefined
    this.heartbeatDeadline = undefined
  }

  private track(operation: Promise<void>): void {
    this.watchers.add(operation)
    void operation.then(
      () => { this.watchers.delete(operation) },
      () => {
        this.watchers.delete(operation)
        if (!this.abort.signal.aborted) void this.close(1011, 'server failure')
      },
    )
  }

  private async respond(id: string, result: JsonValue): Promise<void> {
    await this.send({ v: TEAM_LINK_FRAME_VERSION, type: 'response', id, ok: true, result })
  }

  private async respondError(id: string, error: TeamLinkResponseError): Promise<void> {
    await this.send({ v: TEAM_LINK_FRAME_VERSION, type: 'response', id, ok: false, error })
  }

  private async send(frame: TeamLinkServerFrame): Promise<void> {
    const encoded = JSON.stringify(parseTeamLinkServerFrame(frame))
    const bytes = Buffer.byteLength(encoded)
    if (bytes > this.config.maxFrameBytes) {
      void this.close(1009, 'frame too large')
      throw new Error('outbound frame exceeds configured maximum')
    }
    if (this.queuedBytes + this.socket.bufferedAmount + bytes > this.config.maxQueuedBytes) {
      void this.close(1008, 'slow consumer')
      throw new Error('outbound queue exceeds configured maximum')
    }
    this.queuedBytes += bytes
    const sent = this.outbound.then(async () => {
      if (this.closing || this.socket.readyState !== WebSocket.OPEN) {
        throw new Error('socket closed')
      }
      if (this.socket.bufferedAmount + bytes > this.config.maxQueuedBytes) {
        void this.close(1008, 'slow consumer')
        throw new Error('socket buffer exceeds configured maximum')
      }
      await new Promise<void>((resolve, reject) => {
        this.socket.send(encoded, (error?: Error | null) => {
          if (error === undefined || error === null) resolve()
          else reject(error)
        })
      })
    })
    this.outbound = sent.catch(() => undefined)
    try {
      await sent
    } finally {
      this.queuedBytes -= bytes
    }
  }

  private requireBinding(): TeamLinkBindingIdentity {
    /* v8 ignore next -- every caller is reached only after the attached-binding state guard. */
    if (this.binding === undefined) throw new ProtocolError(unauthorized())
    return this.binding
  }

  /** Return the private proof lease that was minted only for this authenticated socket binding. */
  private requireActorLease(): TeamActorProofLease {
    if (this.actorLease === undefined) throw new ProtocolError(unauthorized())
    return this.actorLease
  }

  private async isCurrentDeliveryBinding(): Promise<boolean> {
    const binding = this.requireBinding()
    const current = await this.ctx.teams.getActivation({
      teamId: binding.teamId,
      activationId: binding.activationId,
    })
    if (sameBinding(current, binding) && isDeliverable(current)) return true
    void this.close(1008, 'binding unavailable')
    return false
  }

  private admitRate(): boolean {
    const now = Date.now()
    if (now - this.windowStartedAt >= this.config.requestWindowMs) {
      this.windowStartedAt = now
      this.requestsInWindow = 0
      this.seenRequestIds.clear()
    }
    this.requestsInWindow += 1
    return this.requestsInWindow <= this.config.maxRequestsPerWindow
  }

  private claimRequestId(id: string): boolean {
    if (this.seenRequestIds.has(id)) return false
    this.seenRequestIds.add(id)
    return true
  }

  private async shutdownSocket(code: number, reason: string): Promise<void> {
    this.closing = true
    this.stopHandshake()
    this.stopHeartbeat()
    this.abort.abort()
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      try {
        this.socket.close(code, reason)
      } catch {
        this.socket.terminate()
      }
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.socket.terminate()
        this.finish()
        resolve()
      }, this.config.closeTimeoutMs)
      void this.closed.promise.then(() => {
        clearTimeout(timer)
        resolve()
      })
    })
    await Promise.allSettled([...this.watchers])
  }

  private finish(): void {
    if (this.finished) return
    this.finished = true
    this.closing = true
    this.stopHandshake()
    this.stopHeartbeat()
    this.abort.abort()
    for (const timer of this.retryTimers) clearTimeout(timer)
    this.retryTimers.clear()
    for (const pending of this.pendingCancellations.values()) {
      pending.reject(new Error('remote Team Link socket closed before cancellation was acknowledged'))
    }
    this.pendingCancellations.clear()
    this.actorLease?.revoke()
    this.actorLease = undefined
    this.closed.resolve()
    this.onClose(this.binding)
  }
}

/** Register the configured exact-path authenticated Team Link WebSocket listener. */
export const apply = (ctx: Context, config: Config) => {
  const resolved = resolveConfig(config)
  return (async function* () {
    const enrollments = await EnrollmentLedger.open(ctx, {
      enrollmentProviderName: resolved.enrollmentProviderName,
      recoveryPageSize: resolved.pageSize,
    })
    const actorIssuer = ctx.teams.openActivationActorProofIssuer()
    const hub = new WebSocketTeamLinkHub(ctx, resolved, enrollments, actorIssuer)
    const unregisterEnrollment = ctx.teamLinks.registerEnrollmentProvider(hub)
    const unregisterUpgrade = ctx.webServer.registerUpgrade({
      path: resolved.path,
      handler: (req, socket, head) => { hub.handle(req, socket, head) },
    })
    yield async () => {
      unregisterUpgrade()
      unregisterEnrollment()
      await hub.close()
    }
  })()
}

/** Resolve configuration without retaining a plaintext capability after plugin load. */
function resolveConfig(config: Config): ResolvedConfig {
  assertPath(config.path)
  const endpointUrl = parseEndpoint(config.endpoint, config.path)
  assertProviderName(config.enrollmentProviderName)
  assertPositive(config.pageSize, 'pageSize')
  assertPositive(config.maxFrameBytes, 'maxFrameBytes')
  assertPositive(config.maxConnections, 'maxConnections')
  assertPositive(config.maxPendingRequests, 'maxPendingRequests')
  assertPositive(config.maxQueuedBytes, 'maxQueuedBytes')
  assertPositive(config.maxOutstandingDeliveries, 'maxOutstandingDeliveries')
  assertPositive(config.requestWindowMs, 'requestWindowMs')
  assertPositive(config.maxRequestsPerWindow, 'maxRequestsPerWindow')
  assertTimerDelay(config.closeTimeoutMs, 'closeTimeoutMs')
  assertTimerDelay(config.handshakeTimeoutMs, 'handshakeTimeoutMs')
  assertTimerDelay(config.heartbeatIntervalMs, 'heartbeatIntervalMs')
  assertTimerDelay(config.heartbeatTimeoutMs, 'heartbeatTimeoutMs')
  assertTimerDelay(config.retryableNackDelayMs, 'retryableNackDelayMs')
  assertTimerDelay(config.backpressureRetryAfterMs, 'backpressureRetryAfterMs')
  if (config.maxQueuedBytes < config.maxFrameBytes) {
    throw new TypeError('team-link-websocket-hub: maxQueuedBytes must cover maxFrameBytes')
  }
  if (config.heartbeatTimeoutMs >= config.heartbeatIntervalMs) {
    throw new TypeError('team-link-websocket-hub: heartbeatTimeoutMs must be less than heartbeatIntervalMs')
  }
  const environments = new Set<string>()
  const identities = new Set<string>()
  const bindings = config.bindings.map((entry) => {
    if (!environmentName.test(entry.capabilityEnv)) {
      throw new TypeError('team-link-websocket-hub: capabilityEnv must be an environment-variable name')
    }
    if (environments.has(entry.capabilityEnv)) {
      throw new TypeError('team-link-websocket-hub: capabilityEnv must identify one binding')
    }
    environments.add(entry.capabilityEnv)
    const capability = process.env[entry.capabilityEnv]
    if (capability === undefined || capability.length === 0) {
      throw new TypeError('team-link-websocket-hub: configured capability environment variable is unavailable')
    }
    const identity = teamLinkBindingIdentitySchema.parse({
      activationId: entry.activationId,
      teamId: entry.teamId,
      participantId: entry.participantId,
      sessionId: entry.sessionId,
      provider: entry.provider,
    })
    if (identities.has(identityKey(identity))) {
      throw new TypeError('team-link-websocket-hub: binding identity must be unique')
    }
    identities.add(identityKey(identity))
    return { identity: Object.freeze(identity), capabilityHash: capabilityHash(capability) }
  })
  return {
    path: config.path,
    endpoint: endpointUrl.toString(),
    endpointUrl,
    enrollmentProviderName: config.enrollmentProviderName,
    bindings: Object.freeze(bindings),
    pageSize: config.pageSize,
    maxFrameBytes: config.maxFrameBytes,
    maxConnections: config.maxConnections,
    maxPendingRequests: config.maxPendingRequests,
    maxQueuedBytes: config.maxQueuedBytes,
    maxOutstandingDeliveries: config.maxOutstandingDeliveries,
    requestWindowMs: config.requestWindowMs,
    maxRequestsPerWindow: config.maxRequestsPerWindow,
    closeTimeoutMs: config.closeTimeoutMs,
    handshakeTimeoutMs: config.handshakeTimeoutMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    heartbeatTimeoutMs: config.heartbeatTimeoutMs,
    retryableNackDelayMs: config.retryableNackDelayMs,
    backpressureRetryAfterMs: config.backpressureRetryAfterMs,
  }
}

const environmentName = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Parse one untrusted operation input or return a sanitized protocol rejection. */
function parseInput<T>(validator: schema.ZodType<T>, value: unknown): T {
  const parsed = validator.safeParse(value)
  if (!parsed.success) throw new ProtocolError(invalidRequest())
  return parsed.data
}

/** Wait for one operation without leaving its rejection unobserved. */
function settle<T>(operation: Promise<T>): Promise<Settled<T>> {
  return operation.then(
    value => ({ kind: 'fulfilled', value }),
    (reason: unknown) => ({ kind: 'rejected', reason }),
  )
}

/** Reject a changed watch that repeats or rewinds the cursor it was asked to observe. */
function assertWatchCursor(result: ChannelWatchResult | undefined, afterCursor: number, channelId: ChannelId): void {
  if (result === undefined) throw new Error(`channel '${channelId}' watch returned no result`)
  if (result.kind === 'changed' && result.cursor <= afterCursor) {
    throw new Error(`channel '${channelId}' watch cursor did not advance`)
  }
}

/** Reject a Team watch that repeats or rewinds the cursor it was asked to observe. */
function assertTeamWatchCursor(result: TeamWatchResult | undefined, afterCursor: number): void {
  if (result === undefined) throw new Error('Team watch returned no result')
  if (result.kind === 'changed' && result.cursor <= afterCursor) {
    throw new Error('Team watch cursor did not advance')
  }
}

/** Decode one text WebSocket payload without accepting fragmented binary data. */
function decodeFrame(data: WebSocket.RawData): string | undefined {
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

/** Render a cancellation transport failure without letting a hostile value interrupt cleanup. */
function renderError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable cancellation failure]'
  }
}

/** Return a fixed-length digest for constant-time comparison without retaining plaintext capability data. */
function capabilityHash(capability: string): Buffer {
  return createHash('sha256').update(capability).digest()
}

/** Compare a supplied capability against a configured fixed-length digest. */
function constantTimeCapabilityMatch(expected: Buffer, supplied: string): boolean {
  return timingSafeEqual(expected, capabilityHash(supplied))
}

/** Compare the immutable identity fields configured for a capability. */
function sameIdentity(left: TeamLinkBindingIdentity, right: TeamLinkBindingIdentity): boolean {
  return identityKey(left) === identityKey(right)
}

/** Extract a complete immutable Link identity from one durable activation binding. */
function identityForBinding(binding: ActivationBindingSnapshot): TeamLinkBindingIdentity {
  return {
    activationId: binding.activation.id,
    teamId: binding.activation.teamId,
    participantId: binding.activation.participantId,
    sessionId: binding.sessionId,
    provider: binding.provider,
  }
}

/** Confirm a current durable binding still represents the configured identity. */
function sameBinding(binding: ActivationBindingSnapshot, identity: TeamLinkBindingIdentity): boolean {
  return binding.activation.id === identity.activationId
    && binding.activation.teamId === identity.teamId
    && binding.activation.participantId === identity.participantId
    && binding.sessionId === identity.sessionId
    && binding.provider === identity.provider
}

/** Confirm a pending interrupt targets this Link's exact immutable binding. */
function sameInterruptTarget(interrupt: ParticipantInterruptSnapshot, binding: TeamLinkBindingIdentity): boolean {
  return interrupt.target.teamId === binding.teamId
    && interrupt.target.participantId === binding.participantId
    && interrupt.target.activationId === binding.activationId
    && interrupt.target.sessionId === binding.sessionId
    && interrupt.target.provider === binding.provider
}

/** Return whether the current durable activation can receive remote delivery. */
function isDeliverable(binding: ActivationBindingSnapshot): boolean {
  return binding.activation.status === 'idle' || binding.activation.status === 'running'
}

/** Return the collision-free map key for one immutable binding. */
function identityKey(binding: TeamLinkBindingIdentity): string {
  return JSON.stringify([
    binding.activationId,
    binding.teamId,
    binding.participantId,
    binding.sessionId,
    binding.provider,
  ])
}

/** Return one recipient-delivery key. */
function deliveryKey(channelId: ChannelId, envelopeId: EnvelopeId): string {
  return JSON.stringify([channelId, envelopeId])
}

/** Validate a positive safe-integer configuration limit. */
function assertPositive(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`team-link-websocket-hub: ${field} must be a positive safe integer`)
  }
}

/** Validate one Node timer delay. */
function assertTimerDelay(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new TypeError(`team-link-websocket-hub: ${field} must be a positive safe integer within the Node timer range`)
  }
}

/** Validate one exact HTTP upgrade pathname. */
function assertPath(path: string): void {
  if (path.length === 0 || !path.startsWith('/') || path.includes('?') || path.includes('#') || (path.length > 1 && path.endsWith('/'))) {
    throw new TypeError('team-link-websocket-hub: path must be an exact absolute pathname')
  }
}

/** Validate the deployment-owned endpoint returned to dynamically enrolled children. */
function parseEndpoint(endpoint: string, path: string): URL {
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    throw new TypeError('team-link-websocket-hub: endpoint must be a complete ws: or wss: URL')
  }
  if ((parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:')
    || parsed.username.length > 0
    || parsed.password.length > 0
    || parsed.search.length > 0
    || parsed.hash.length > 0
    || parsed.pathname !== path) {
    throw new TypeError('team-link-websocket-hub: endpoint must be a credential-free ws: or wss: URL for path')
  }
  return parsed
}

/** Validate the stable registry name selected by remote activation owners. */
function assertProviderName(name: string): void {
  if (name.length === 0 || name.trim() !== name) {
    throw new TypeError('team-link-websocket-hub: enrollmentProviderName must be non-empty without surrounding whitespace')
  }
}

/** Build a generic response for unauthenticated or stale-identity requests. */
function unauthorized(): TeamLinkResponseError {
  return { code: 'unauthorized', message: 'request is not authorized' }
}

/** Build a generic response for a syntactically valid but malformed operation body. */
function invalidRequest(): TeamLinkResponseError {
  return { code: 'invalid-request', message: 'request input is invalid' }
}

/** Build a generic response for an operation invalid in this connection state. */
function invalidState(): TeamLinkResponseError {
  return { code: 'invalid-state', message: 'request is invalid in the current connection state' }
}

/** Build a generic response when an activation binding already owns another socket. */
function bindingInUse(): TeamLinkResponseError {
  return { code: 'binding-in-use', message: 'activation binding already has an active connection' }
}

/** Build a protocol rejection for a cancellation result without a matching Hub request. */
function unexpectedCancellation(): TeamLinkResponseError {
  return { code: 'unexpected-cancellation', message: 'cancellation result has no pending Hub request' }
}

/** Convert internal failures to an intentionally non-sensitive wire response. */
function responseError(error: unknown, backpressureRetryAfterMs: number): TeamLinkResponseError {
  if (error instanceof ProtocolError) return error.response
  if (error instanceof TeamError) {
    if (error.code === 'TEAM_CURSOR_CONFLICT'
      || error.code === 'TEAM_CHANNEL_CURSOR_CONFLICT'
      || error.code === 'TEAM_CHANNEL_IDEMPOTENCY_CONFLICT') {
      return { code: 'conflict', message: 'request conflicts with current durable state' }
    }
    if (error.code === 'TEAM_CHANNEL_BACKPRESSURE') {
      return { code: 'backpressure', message: 'channel cannot accept more work', retryAfterMs: backpressureRetryAfterMs }
    }
  }
  return { code: 'rejected', message: 'request was rejected' }
}
