import { channelAdmissionSnapshotSchema, channelSnapshotSchema } from '@clocky/clocky-team'
import type { ChannelInvitationAcknowledgeInput, ChannelAdmissionSnapshot, ChannelSnapshot } from '@clocky/clocky-team'
import type { TeamLinkInvitationNotification } from '@clocky/clocky-team-link'
/** Authenticated WebSocket provider for activation-bound Team Links. @module @clocky/clocky-team-link-websocket */

import { randomUUID } from 'node:crypto'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import {
  channelDeliveryClaimSchema,
  channelReceiptRecordSchema,
  participantInterruptSnapshotSchema,
  teamEnvelopeSchema,
  teamTaskSnapshotSchema,
} from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ChannelId,
  EnvelopeId,
  JsonObject,
  JsonValue,
  ParticipantInterruptSnapshot,
  TeamInterruptId,
  TeamEnvelope,
  TeamTaskSnapshot,
} from '@clocky/clocky-team'
import {
  parseTeamLinkClientFrame,
  parseTeamLinkServerFrame,
  TEAM_LINK_FRAME_VERSION,
} from '@clocky/clocky-team-link'
import type {
  TeamLink,
  TeamLinkBindingIdentity,
  TeamLinkClientFrame,
  TeamLinkConnectRequest,
  TeamLinkFinalResultRequest,
  TeamLinkDeliveryId,
  TeamLinkInterruptNotification,
  TeamLinkTaskCancellationNotification,
  TeamLinkTaskCancellationAcknowledgeRequest,
  TeamLinkOperation,
  TeamLinkPostRequest,
  TeamLinkProvider,
  TeamLinkServerFrame,
  TeamLinkTaskAttemptSettleRequest,
  TeamLinkTaskIntegrationRequest,
  TeamLinkTaskAttemptStartClaimRequest,
  TeamLinkTaskAttemptHeartbeatRequest,
  TeamLinkTaskReviewRequest,
  TeamLinkTerminationReason,
} from '@clocky/clocky-team-link'
import WebSocket from 'ws'
import { TeamLinkWebSocketError } from './error.ts'
import type { TeamLinkWebSocketErrorCode } from './error.ts'

export { TeamLinkWebSocketError } from './error.ts'
export type { TeamLinkWebSocketErrorCode } from './error.ts'

/** Cordis plugin name. */
export const name = 'team-link-websocket'
/** The Team Link registry must exist before this provider registers itself. */
export const inject = ['teamLinks']

const DEFAULT_PROVIDER_NAME = 'websocket'
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000
const DEFAULT_RESPONSE_TIMEOUT_MS = 30_000
const DEFAULT_MAX_FRAME_BYTES = 1_048_576
const DEFAULT_MAX_PENDING_REQUESTS = 64
const DEFAULT_MAX_BUFFERED_NOTIFICATIONS = 64
const MAX_TIMER_DELAY_MS = 2_147_483_647
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Deployment configuration for the remote WebSocket Team Link provider. */
export interface Config {
  /** Registry name used to select this provider. */
  readonly providerName: string
  /** Full `ws:` or `wss:` URL of the authoritative Team Link Hub endpoint. */
  readonly endpoint: string
  /** Environment-variable name holding the opaque attach capability. */
  readonly capabilityEnv: string
  /** Deadline for opening, attaching, and subscribing one Link. */
  readonly connectTimeoutMs: number
  /** Deadline for one attach, subscribe, or Link operation response. */
  readonly responseTimeoutMs: number
  /** Maximum UTF-8 byte length of one incoming or outgoing protocol frame. */
  readonly maxFrameBytes: number
  /** Maximum concurrent attach, subscribe, or operation requests on one Link. */
  readonly maxPendingRequests: number
  /** Maximum accepted Envelope notifications and unacknowledged interrupt deliveries retained by one Link. */
  readonly maxBufferedNotifications: number
}

/** Explicit per-activation credential configuration for a dynamically enrolled provider. */
export interface CapabilityProviderConfig {
  /** Registry name selected by the fixed activation-bound delivery consumer. */
  readonly providerName?: string
  /** Full `ws:` or `wss:` URL of the authoritative Team Link Hub endpoint. */
  readonly endpoint: string
  /** Deadline for opening, attaching, and subscribing one Link. */
  readonly connectTimeoutMs?: number
  /** Deadline for one Link operation response. */
  readonly responseTimeoutMs?: number
  /** Maximum UTF-8 byte length of one incoming or outgoing protocol frame. */
  readonly maxFrameBytes?: number
  /** Maximum concurrent requests on one Link. */
  readonly maxPendingRequests?: number
  /** Maximum retained Envelope notifications and unacknowledged interrupt deliveries. */
  readonly maxBufferedNotifications?: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  providerName: z.string().min(1).pattern(/^\S(?:.*\S)?$/).default(DEFAULT_PROVIDER_NAME),
  endpoint: z.string().min(1).required(),
  capabilityEnv: z.string().required().pattern(ENVIRONMENT_NAME_PATTERN).role('credential-ref'),
  connectTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_CONNECT_TIMEOUT_MS),
  responseTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_RESPONSE_TIMEOUT_MS),
  maxFrameBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_FRAME_BYTES),
  maxPendingRequests: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_PENDING_REQUESTS),
  maxBufferedNotifications: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_BUFFERED_NOTIFICATIONS),
})

interface ResolvedConfig extends Config {
  readonly endpointUrl: URL
}

interface PendingRequest {
  readonly expected: 'attached' | 'response'
  readonly purpose: 'attach' | 'subscribe' | 'operation'
  readonly resolve: (frame: TeamLinkServerFrame) => void
  readonly reject: (error: TeamLinkWebSocketError) => void
  dispose: () => void
}

type RequestFrame = Exclude<TeamLinkClientFrame, { readonly type: 'nack' }>

function resolveConfig(config: Config): ResolvedConfig {
  let endpointUrl: URL
  try {
    endpointUrl = new URL(config.endpoint)
  } catch {
    throw new TeamLinkWebSocketError('Team Link WebSocket endpoint must be a valid URL', 'TEAM_LINK_WEBSOCKET_CONFIGURATION_INVALID')
  }
  if (!['ws:', 'wss:'].includes(endpointUrl.protocol)) {
    throw new TeamLinkWebSocketError('Team Link WebSocket endpoint must use ws: or wss:', 'TEAM_LINK_WEBSOCKET_CONFIGURATION_INVALID')
  }
  if ([endpointUrl.username, endpointUrl.password, endpointUrl.hash].some(Boolean)) {
    throw new TeamLinkWebSocketError('Team Link WebSocket endpoint must not contain credentials or a fragment', 'TEAM_LINK_WEBSOCKET_CONFIGURATION_INVALID')
  }
  return {
    providerName: config.providerName,
    endpoint: config.endpoint,
    capabilityEnv: config.capabilityEnv,
    connectTimeoutMs: config.connectTimeoutMs,
    responseTimeoutMs: config.responseTimeoutMs,
    maxFrameBytes: config.maxFrameBytes,
    maxPendingRequests: config.maxPendingRequests,
    maxBufferedNotifications: config.maxBufferedNotifications,
    endpointUrl,
  }
}

function bindingIdentity(binding: ActivationBindingSnapshot): TeamLinkBindingIdentity {
  return {
    activationId: binding.activation.id,
    teamId: binding.activation.teamId,
    participantId: binding.activation.participantId,
    sessionId: binding.sessionId,
    provider: binding.provider,
  }
}

function sameBindingIdentity(left: TeamLinkBindingIdentity, right: TeamLinkBindingIdentity): boolean {
  return left.activationId === right.activationId
    && left.teamId === right.teamId
    && left.participantId === right.participantId
    && left.sessionId === right.sessionId
    && left.provider === right.provider
}

function sameInterruptTarget(interrupt: ParticipantInterruptSnapshot, binding: ActivationBindingSnapshot): boolean {
  return interrupt.target.teamId === binding.activation.teamId
    && interrupt.target.participantId === binding.activation.participantId
    && interrupt.target.activationId === binding.activation.id
    && interrupt.target.sessionId === binding.sessionId
    && interrupt.target.provider === binding.provider
}

function immutableBinding(binding: ActivationBindingSnapshot): ActivationBindingSnapshot {
  return Object.freeze({
    ...binding,
    activation: Object.freeze({ ...binding.activation }),
  })
}

function asInput(value: object): JsonObject {
  return value as JsonObject
}

function abortError(signal: AbortSignal): TeamLinkWebSocketError {
  if (signal.reason instanceof TeamLinkWebSocketError) return signal.reason
  return new TeamLinkWebSocketError('Team Link WebSocket connection was aborted', 'TEAM_LINK_WEBSOCKET_ABORTED')
}

function ensureNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal)
}

function wireError(error: unknown, fallback: TeamLinkWebSocketErrorCode): TeamLinkWebSocketError {
  if (error instanceof TeamLinkWebSocketError) return error
  return new TeamLinkWebSocketError('Team Link WebSocket transport failed', fallback)
}

function rawDataByteLength(data: WebSocket.RawData): number {
  if (Buffer.isBuffer(data)) return data.byteLength
  if (Array.isArray(data)) return data.reduce((size, item) => size + item.byteLength, 0)
  return data.byteLength
}

function rawDataText(data: WebSocket.RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

function remoteRejected(frame: Extract<TeamLinkServerFrame, { readonly type: 'response'; readonly ok: false }>): TeamLinkWebSocketError {
  return new TeamLinkWebSocketError(
    `remote Team Link request rejected: ${frame.error.code}: ${frame.error.message}`,
    frame.error.code === 'unauthorized' ? 'TEAM_LINK_WEBSOCKET_UNAUTHORIZED' : 'TEAM_LINK_WEBSOCKET_REMOTE_REJECTED',
  )
}

function subscribedResult(value: JsonValue): boolean {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false
  const record = value as Record<string, JsonValue>
  return Object.keys(record).length === 1 && record.subscribed === true
}

function protocolError(error: unknown): TeamLinkWebSocketError {
  if (error instanceof TeamLinkWebSocketError) return error
  return new TeamLinkWebSocketError('received a malformed Team Link WebSocket frame', 'TEAM_LINK_WEBSOCKET_MALFORMED_FRAME')
}

class WebSocketTeamLinkProvider implements TeamLinkProvider {
  private closing = false

  constructor(
    readonly name: string,
    private readonly config: ResolvedConfig,
    private readonly capabilityForConnection: () => string | undefined,
  ) {}

  closeAdmission(): void {
    this.closing = true
  }

  async connect(request: TeamLinkConnectRequest): Promise<TeamLink> {
    this.assertOpen()
    ensureNotAborted(request.signal)
    const capability = this.capabilityForConnection()
    if (capability === undefined || capability.length === 0) {
      throw new TeamLinkWebSocketError(
        `Team Link capability environment variable '${this.config.capabilityEnv}' is not set`,
        'TEAM_LINK_WEBSOCKET_CAPABILITY_MISSING',
      )
    }
    const deadline = new AbortController()
    const timer = setTimeout(() => {
      deadline.abort(new TeamLinkWebSocketError(
        `Team Link WebSocket connection exceeded ${this.config.connectTimeoutMs}ms`,
        'TEAM_LINK_WEBSOCKET_CONNECT_TIMEOUT',
      ))
    }, this.config.connectTimeoutMs)
    const signal = request.signal === undefined ? deadline.signal : AbortSignal.any([request.signal, deadline.signal])
    let link: WebSocketTeamLink | undefined
    try {
      const socket = new WebSocket(this.config.endpointUrl, {
        maxPayload: this.config.maxFrameBytes,
        perMessageDeflate: false,
      })
      link = new WebSocketTeamLink(
        socket,
        this.name,
        immutableBinding(request.binding),
        this.config,
        request.onTerminate,
      )
      await link.waitForOpen(signal)
      await link.initialize(capability, signal)
      this.assertOpen()
      return link
    } catch (error: unknown) {
      const failure = wireError(error, 'TEAM_LINK_WEBSOCKET_CONNECT_FAILED')
      link?.terminate(failure)
      throw failure
    } finally {
      clearTimeout(timer)
    }
  }

  private assertOpen(): void {
    if (this.closing) {
      throw new TeamLinkWebSocketError('WebSocket Team Link provider is closed', 'TEAM_LINK_WEBSOCKET_PROVIDER_CLOSED')
    }
  }
}

/**
 * Create a provider whose credential remains in the caller's activation-local
 * closure instead of process environment state.
 * @param config - endpoint and bounded transport settings for one activation.
 * @param capability - opaque credential issued for that activation only.
 * @returns a provider ready for effect-scoped registration on `ctx.teamLinks`.
 */
export function createCapabilityWebSocketTeamLinkProvider(
  config: CapabilityProviderConfig,
  capability: string,
): TeamLinkProvider {
  if (capability.length === 0) {
    throw new TeamLinkWebSocketError('Team Link capability must be non-empty', 'TEAM_LINK_WEBSOCKET_CAPABILITY_MISSING')
  }
  const resolved = resolveConfig({
    providerName: config.providerName ?? DEFAULT_PROVIDER_NAME,
    endpoint: config.endpoint,
    capabilityEnv: 'CLOCKY_DYNAMIC_TEAM_LINK_CAPABILITY',
    connectTimeoutMs: config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    responseTimeoutMs: config.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS,
    maxFrameBytes: config.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES,
    maxPendingRequests: config.maxPendingRequests ?? DEFAULT_MAX_PENDING_REQUESTS,
    maxBufferedNotifications: config.maxBufferedNotifications ?? DEFAULT_MAX_BUFFERED_NOTIFICATIONS,
  })
  return new WebSocketTeamLinkProvider(resolved.providerName, resolved, () => capability)
}

class WebSocketTeamLink implements TeamLink {
  readonly done: Promise<void>
  private readonly terminal = Promise.withResolvers<void>()
  private readonly opening = Promise.withResolvers<void>()
  private readonly invitationListeners = new Set<(notification: TeamLinkInvitationNotification) => Promise<void>>()
  private readonly invitations = new Map<ChannelId, TeamLinkInvitationNotification>()
  private readonly deliveredInvitationRevisions = new Map<ChannelId, number>()
  private readonly taskCancellationListeners = new Set<(notification: TeamLinkTaskCancellationNotification) => Promise<void>>()
  private readonly taskCancellations = new Map<string, TeamLinkTaskCancellationNotification>()
  private readonly deliveredTaskCancellationRevisions = new Map<string, number>()
  private readonly pending = new Map<string, PendingRequest>()
  private readonly listeners = new Set<(envelope: TeamEnvelope) => Promise<void>>()
  private readonly interruptListeners = new Set<(notification: TeamLinkInterruptNotification) => Promise<void>>()
  private readonly notifications: Extract<TeamLinkServerFrame, { readonly type: 'notify' }>[] = []
  private readonly interrupts: TeamLinkInterruptNotification[] = []
  private readonly interruptDeliveries = new Map<TeamLinkDeliveryId, TeamLinkInterruptNotification>()
  private readonly interruptIds = new Set<TeamInterruptId>()
  /** Hub-issued cancellation ids currently being handled by this endpoint. */
  private readonly cancellationIds = new Set<string>()
  private sequence = 0
  private openingSettled = false
  private attached = false
  private subscribed = false
  private draining = false
  private drainingInterrupts = false
  private closing = false
  private failure: TeamLinkWebSocketError | undefined

  constructor(
    private readonly socket: WebSocket,
    readonly provider: string,
    readonly binding: ActivationBindingSnapshot,
    private readonly config: ResolvedConfig,
    private readonly onTerminate?: (reason: TeamLinkTerminationReason) => Promise<void>,
  ) {
    this.done = this.terminal.promise
    void this.done.catch(() => {})
    void this.opening.promise.catch(() => {})
    socket.on('open', this.onOpen)
    socket.on('message', this.onMessage)
    socket.on('error', this.onError)
    socket.on('close', this.onClose)
    if (socket.readyState === WebSocket.OPEN) this.resolveOpening()
  }

  async waitForOpen(signal: AbortSignal): Promise<void> {
    ensureNotAborted(signal)
    if (this.failure !== undefined) throw this.failure
    if (this.socket.readyState === WebSocket.OPEN) return
    await this.awaitSignal(this.opening.promise, signal)
  }

  async initialize(capability: string, signal: AbortSignal): Promise<void> {
    try {
      const attachId = this.nextId()
      await this.sendAndWait<Extract<TeamLinkServerFrame, { readonly type: 'attached' }>>({
        v: TEAM_LINK_FRAME_VERSION,
        type: 'attach',
        id: attachId,
        binding: bindingIdentity(this.binding),
        capability,
      }, 'attached', 'attach', signal)
      const subscribeId = this.nextId()
      await this.sendAndWait<Extract<TeamLinkServerFrame, { readonly type: 'response'; readonly ok: true }>>({
        v: TEAM_LINK_FRAME_VERSION,
        type: 'subscribe',
        id: subscribeId,
      }, 'response', 'subscribe', signal)
    } catch (error: unknown) {
      const failure = wireError(error, 'TEAM_LINK_WEBSOCKET_CONNECT_FAILED')
      this.terminate(failure)
      throw failure
    }
  }

  getChannel(channelId: ChannelId): Promise<ChannelSnapshot> {
    return this.operation('channel-get', asInput({ channelId }), value => channelSnapshotSchema.parse(value))
  }

  onInvitation(listener: (notification: TeamLinkInvitationNotification) => Promise<void>): () => void {
    if (this.closing) return () => {}
    this.invitationListeners.add(listener)
    this.scheduleInvitationDrain()
    return () => { this.invitationListeners.delete(listener) }
  }

  async acknowledgeChannelInvitation(request: ChannelInvitationAcknowledgeInput): Promise<ChannelAdmissionSnapshot> {
    const result = await this.operation('invitation-ack', asInput({ ...request }), value => channelAdmissionSnapshotSchema.parse(value))
    this.invitations.delete(request.channelId)
    this.deliveredInvitationRevisions.delete(request.channelId)
    return result
  }

  onNotify(listener: (envelope: TeamEnvelope) => Promise<void>): () => void {
    if (this.closing) return () => {}
    this.listeners.add(listener)
    this.scheduleDrain()
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.listeners.delete(listener)
    }
  }

  onInterrupt(listener: (notification: TeamLinkInterruptNotification) => Promise<void>): () => void {
    if (this.closing) return () => {}
    this.interruptListeners.add(listener)
    this.scheduleInterruptDrain()
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.interruptListeners.delete(listener)
    }
  }

  onTaskCancellation(listener: (notification: TeamLinkTaskCancellationNotification) => Promise<void>): () => void {
    if (this.closing) return () => {}
    this.taskCancellationListeners.add(listener)
    this.scheduleTaskCancellationDrain()
    return () => { this.taskCancellationListeners.delete(listener) }
  }

  async acknowledgeTaskCancellation(request: TeamLinkTaskCancellationAcknowledgeRequest): Promise<TeamTaskSnapshot> {
    const task = await this.operation('task-cancellation-ack', asInput({ ...request }), result => teamTaskSnapshotSchema.parse(result))
    this.taskCancellations.delete(request.taskId)
    this.deliveredTaskCancellationRevisions.delete(request.taskId)
    return task
  }

  async post(request: TeamLinkPostRequest): Promise<TeamEnvelope> {
    return await this.operation('post', asInput({
      ...request.expectedCursor === undefined ? {} : { expectedCursor: request.expectedCursor },
      idempotencyKey: request.idempotencyKey,
      draft: request.draft,
    }), result => teamEnvelopeSchema.parse(result))
  }

  async postFinalResult(request: TeamLinkFinalResultRequest): Promise<TeamEnvelope> {
    return await this.operation('final-result', asInput({
      channelId: request.channelId,
      idempotencyKey: request.idempotencyKey,
      text: request.text,
    }), result => teamEnvelopeSchema.parse(result))
  }

  async claim(channelId: ChannelId, envelopeId: EnvelopeId) {
    return await this.operation('claim', asInput({ channelId, envelopeId }), (result) => {
      if (result === null) return undefined
      return channelDeliveryClaimSchema.parse(result)
    })
  }

  async claimTaskAttemptStart(request: TeamLinkTaskAttemptStartClaimRequest): Promise<TeamTaskSnapshot> {
    return await this.operation('task-start', asInput({ ...request }), result => teamTaskSnapshotSchema.parse(result))
  }

  async settleTaskAttempt(request: TeamLinkTaskAttemptSettleRequest): Promise<TeamTaskSnapshot> {
    return await this.operation('task-settle', asInput({ ...request }), result => teamTaskSnapshotSchema.parse(result))
  }

  /** Execute and settle this binding's artifact-sourced integration task through the Hub. */
  async integrateTask(request: TeamLinkTaskIntegrationRequest): Promise<TeamTaskSnapshot> {
    return await this.operation('task-integrate', asInput({ ...request }), result => teamTaskSnapshotSchema.parse(result))
  }

  /** Renew this Link binding's exact current task-attempt lease. */
  async heartbeatTaskAttempt(request: TeamLinkTaskAttemptHeartbeatRequest): Promise<TeamTaskSnapshot> {
    return await this.operation('task-heartbeat', asInput({ ...request }), result => teamTaskSnapshotSchema.parse(result))
  }

  /** Resolve this Link binding's exact configured task review. */
  async resolveTaskReview(request: TeamLinkTaskReviewRequest): Promise<TeamTaskSnapshot> {
    return await this.operation('task-review', asInput({ ...request }), result => teamTaskSnapshotSchema.parse(result))
  }

  async acknowledge(channelId: ChannelId, envelopeId: EnvelopeId, expectedCursor: number) {
    return await this.operation('receipt', asInput({ channelId, envelopeId, expectedCursor }), result => channelReceiptRecordSchema.parse(result))
  }

  async acknowledgeInterrupt(
    deliveryId: TeamLinkDeliveryId,
    interruptId: TeamInterruptId,
  ): Promise<ParticipantInterruptSnapshot> {
    const notification = this.interruptDeliveries.get(deliveryId)
    if (notification === undefined || notification.interrupt.id !== interruptId) {
      throw new TeamLinkWebSocketError('Team Link interrupt acknowledgement does not match a delivered interrupt', 'TEAM_LINK_WEBSOCKET_INVALID_REQUEST')
    }
    const acknowledged = await this.operation('interrupt-ack', asInput({ deliveryId, interruptId }), (result) => {
      const interrupt = participantInterruptSnapshotSchema.parse(result)
      if (!sameInterruptTarget(interrupt, this.binding) || interrupt.id !== interruptId || interrupt.acknowledgedAt === undefined) {
        throw new TeamLinkWebSocketError('remote Team Link interrupt acknowledgement is invalid', 'TEAM_LINK_WEBSOCKET_MALFORMED_RESULT')
      }
      return interrupt
    })
    this.interruptDeliveries.delete(deliveryId)
    this.interruptIds.delete(interruptId)
    return acknowledged
  }

  close(): Promise<void> {
    this.terminate()
    return this.done
  }

  terminate(error?: TeamLinkWebSocketError): void {
    if (this.closing) return
    this.closing = true
    this.failure = error
    const pendingError = error ?? new TeamLinkWebSocketError('WebSocket Team Link is closed', 'TEAM_LINK_WEBSOCKET_CLOSED')
    if (!this.openingSettled) this.rejectOpening(pendingError)
    for (const [id] of this.pending) this.rejectPending(id, pendingError)
    this.notifications.length = 0
    this.interrupts.length = 0
    this.interruptDeliveries.clear()
    this.interruptIds.clear()
    this.invitations.clear()
    this.deliveredInvitationRevisions.clear()
    this.taskCancellations.clear()
    this.deliveredTaskCancellationRevisions.clear()
    this.taskCancellationListeners.clear()
    this.cancellationIds.clear()
    this.socket.removeListener('open', this.onOpen)
    this.socket.removeListener('message', this.onMessage)
    this.socket.removeListener('error', this.onError)
    this.socket.removeListener('close', this.onClose)
    this.socket.once('error', () => {})
    if (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN) this.socket.terminate()
    if (error === undefined) this.terminal.resolve()
    else this.terminal.reject(error)
  }

  private readonly onOpen = (): void => {
    this.resolveOpening()
  }

  private readonly onError = (): void => {
    this.terminate(new TeamLinkWebSocketError('Team Link WebSocket transport failed', 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED'))
  }

  private readonly onClose = (): void => {
    this.terminate(new TeamLinkWebSocketError('Team Link WebSocket closed remotely', 'TEAM_LINK_WEBSOCKET_TRANSPORT_CLOSED'))
  }

  private readonly onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
    if (this.closing) return
    try {
      if (isBinary) {
        throw new TeamLinkWebSocketError('received a binary Team Link WebSocket frame', 'TEAM_LINK_WEBSOCKET_MALFORMED_FRAME')
      }
      if (rawDataByteLength(data) > this.config.maxFrameBytes) {
        throw new TeamLinkWebSocketError('received an oversized Team Link WebSocket frame', 'TEAM_LINK_WEBSOCKET_FRAME_TOO_LARGE')
      }
      const frame = parseTeamLinkServerFrame(JSON.parse(rawDataText(data)))
      this.acceptFrame(frame)
    } catch (error: unknown) {
      this.terminate(protocolError(error))
    }
  }

  private acceptFrame(frame: TeamLinkServerFrame): void {
    switch (frame.type) {
      case 'attached':
        this.acceptAttached(frame)
        return
      case 'response':
        this.acceptResponse(frame)
        return
      case 'notify':
        this.acceptNotification(frame)
        return
      case 'invitation': {
        const { channel, invitation } = frame.notification
        if (!this.attached || channel.manifest.teamId !== this.binding.activation.teamId
          || invitation.participantId !== this.binding.activation.participantId
          || !channel.manifest.participants.some(member => member.id === invitation.participantId)) {
          throw new TeamLinkWebSocketError('channel invitation selected another binding', 'TEAM_LINK_WEBSOCKET_BINDING_MISMATCH')
        }
        if (invitation.status !== 'pending') {
          this.invitations.delete(channel.manifest.id)
          this.deliveredInvitationRevisions.delete(channel.manifest.id)
          return
        }
        if (!this.invitations.has(channel.manifest.id) && this.bufferedNotificationCount() >= this.config.maxBufferedNotifications) {
          throw new TeamLinkWebSocketError('channel invitation buffer is full', 'TEAM_LINK_WEBSOCKET_NOTIFICATION_LIMIT')
        }
        this.invitations.set(channel.manifest.id, frame.notification)
        this.scheduleInvitationDrain()
        return
      }
      case 'task-cancellation': {
        const notification = frame.notification
        const target = notification.cancellation.target
        if (!this.attached || target.kind !== 'attempt' || target.activationId !== this.binding.activation.id
          || target.participantId !== this.binding.activation.participantId) {
          throw new TeamLinkWebSocketError('task cancellation selected another binding', 'TEAM_LINK_WEBSOCKET_BINDING_MISMATCH')
        }
        if (!this.taskCancellations.has(notification.taskId) && this.bufferedNotificationCount() >= this.config.maxBufferedNotifications) {
          throw new TeamLinkWebSocketError('task cancellation buffer is full', 'TEAM_LINK_WEBSOCKET_NOTIFICATION_LIMIT')
        }
        this.taskCancellations.set(notification.taskId, notification)
        this.scheduleTaskCancellationDrain()
        return
      }
      case 'interrupt':
        this.acceptInterrupt(frame)
        return
      case 'cancel':
        this.acceptCancellation(frame)
        return
      default:
        return assertNever(frame)
    }
  }

  private acceptAttached(frame: Extract<TeamLinkServerFrame, { readonly type: 'attached' }>): void {
    const pending = this.pending.get(frame.id)
    if (pending === undefined) {
      throw new TeamLinkWebSocketError('received an unexpected or duplicate attach completion', 'TEAM_LINK_WEBSOCKET_UNEXPECTED_FRAME')
    }
    if (pending.expected !== 'attached' || this.attached) {
      throw new TeamLinkWebSocketError('received an out-of-order attach completion', 'TEAM_LINK_WEBSOCKET_OUT_OF_ORDER_FRAME')
    }
    if (!sameBindingIdentity(frame.binding, bindingIdentity(this.binding))) {
      throw new TeamLinkWebSocketError('remote Team Link attached a different activation binding', 'TEAM_LINK_WEBSOCKET_BINDING_MISMATCH')
    }
    this.attached = true
    this.resolvePending(frame.id, frame)
  }

  private acceptResponse(frame: Extract<TeamLinkServerFrame, { readonly type: 'response' }>): void {
    const pending = this.pending.get(frame.id)
    if (pending === undefined) {
      throw new TeamLinkWebSocketError('received an unexpected or duplicate Team Link response', 'TEAM_LINK_WEBSOCKET_UNEXPECTED_FRAME')
    }
    if (pending.expected === 'attached') {
      if (!frame.ok) {
        this.rejectPending(frame.id, remoteRejected(frame))
        return
      }
      throw new TeamLinkWebSocketError('received a response before attach completion', 'TEAM_LINK_WEBSOCKET_OUT_OF_ORDER_FRAME')
    }
    if (!frame.ok) {
      this.rejectPending(frame.id, remoteRejected(frame))
      return
    }
    if (pending.purpose === 'subscribe') {
      if (!subscribedResult(frame.result)) {
        throw new TeamLinkWebSocketError('received an invalid Team Link subscription result', 'TEAM_LINK_WEBSOCKET_MALFORMED_RESULT')
      }
      this.subscribed = true
    }
    this.resolvePending(frame.id, frame)
  }

  private acceptNotification(frame: Extract<TeamLinkServerFrame, { readonly type: 'notify' }>): void {
    if (frame.envelope.teamId !== this.binding.activation.teamId
      || (frame.envelope.audience === null
        ? frame.envelope.senderId === this.binding.activation.participantId
        : !frame.envelope.audience.includes(this.binding.activation.participantId))) {
      throw new TeamLinkWebSocketError('received a notification outside this Team Link binding', 'TEAM_LINK_WEBSOCKET_BINDING_MISMATCH')
    }
    if (!this.subscribed) {
      throw new TeamLinkWebSocketError('received a notification before subscription completed', 'TEAM_LINK_WEBSOCKET_OUT_OF_ORDER_FRAME')
    }
    if (this.bufferedNotificationCount() >= this.config.maxBufferedNotifications) {
      throw new TeamLinkWebSocketError('Team Link notification buffer limit was exceeded', 'TEAM_LINK_WEBSOCKET_NOTIFICATION_LIMIT')
    }
    this.notifications.push(frame)
    this.scheduleDrain()
  }

  private acceptInterrupt(frame: Extract<TeamLinkServerFrame, { readonly type: 'interrupt' }>): void {
    if (!this.subscribed) {
      throw new TeamLinkWebSocketError('received an interrupt before subscription completed', 'TEAM_LINK_WEBSOCKET_OUT_OF_ORDER_FRAME')
    }
    if (!sameInterruptTarget(frame.interrupt, this.binding) || frame.interrupt.acknowledgedAt !== undefined) {
      throw new TeamLinkWebSocketError('received an interrupt outside this Team Link binding', 'TEAM_LINK_WEBSOCKET_BINDING_MISMATCH')
    }
    if (this.interruptDeliveries.has(frame.deliveryId) || this.interruptIds.has(frame.interrupt.id)) {
      throw new TeamLinkWebSocketError('received a duplicate Team Link interrupt', 'TEAM_LINK_WEBSOCKET_UNEXPECTED_FRAME')
    }
    if (this.bufferedNotificationCount() >= this.config.maxBufferedNotifications) {
      throw new TeamLinkWebSocketError('Team Link notification buffer limit was exceeded', 'TEAM_LINK_WEBSOCKET_NOTIFICATION_LIMIT')
    }
    const notification: TeamLinkInterruptNotification = {
      deliveryId: frame.deliveryId,
      interrupt: frame.interrupt,
    }
    this.interruptDeliveries.set(notification.deliveryId, notification)
    this.interruptIds.add(notification.interrupt.id)
    this.interrupts.push(notification)
    this.scheduleInterruptDrain()
  }

  /** Start one endpoint-owned cooperative cancellation without blocking frame parsing. */
  private acceptCancellation(frame: Extract<TeamLinkServerFrame, { readonly type: 'cancel' }>): void {
    if (!this.subscribed) {
      throw new TeamLinkWebSocketError(
        'received a cancellation before subscription completed',
        'TEAM_LINK_WEBSOCKET_OUT_OF_ORDER_FRAME',
      )
    }
    if (this.cancellationIds.has(frame.id)) {
      throw new TeamLinkWebSocketError(
        'received a duplicate Team Link cancellation request',
        'TEAM_LINK_WEBSOCKET_UNEXPECTED_FRAME',
      )
    }
    this.cancellationIds.add(frame.id)
    void this.handleCancellation(frame).catch((error: unknown) => {
      this.terminate(wireError(error, 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED'))
    })
  }

  /** Run the endpoint handler, report its result, and leave socket shutdown to the Hub. */
  private async handleCancellation(frame: Extract<TeamLinkServerFrame, { readonly type: 'cancel' }>): Promise<void> {
    let accepted = false
    if (this.onTerminate !== undefined) {
      try {
        await this.onTerminate(frame.reason)
        accepted = true
      } catch {
        accepted = false
      }
    }
    if (this.closing) return
    const response: TeamLinkClientFrame = {
      v: TEAM_LINK_FRAME_VERSION,
      type: 'cancelled',
      id: frame.id,
      accepted,
    }
    this.dispatch(this.encode(response))
  }

  private scheduleDrain(): void {
    if (this.closing || this.draining || this.listeners.size === 0 || this.notifications.length === 0) return
    this.draining = true
    void this.drainNotifications().catch((error: unknown) => {
      this.terminate(wireError(error, 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED'))
    })
  }

  private async drainNotifications(): Promise<void> {
    try {
      while (!this.closing && this.listeners.size > 0 && this.notifications.length > 0) {
        const notification = this.notifications.shift() as Extract<TeamLinkServerFrame, { readonly type: 'notify' }>
        let rejected = false
        for (const listener of [...this.listeners]) {
          if (!this.listeners.has(listener)) continue
          try {
            await listener(notification.envelope)
          } catch {
            rejected = true
          }
        }
        if (rejected) this.sendNack(notification)
      }
    } finally {
      this.draining = false
      this.scheduleDrain()
    }
  }

  /** Dispatch independent channel invitations without blocking unrelated task cancellation callbacks. */
  private scheduleInvitationDrain(): void {
    if (this.closing || this.invitationListeners.size === 0) return
    for (const notification of this.invitations.values()) {
      const id = notification.channel.manifest.id
      if (this.deliveredInvitationRevisions.get(id) === notification.invitation.revision) continue
      this.deliveredInvitationRevisions.set(id, notification.invitation.revision)
      const delivered = Promise.all([...this.invitationListeners].map(async (listener) => {
        if (this.invitationListeners.has(listener)) await listener(notification)
      }))
      void delivered.catch((error: unknown) => { this.terminate(wireError(error, 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED')) })
    }
  }

  private scheduleTaskCancellationDrain(): void {
    if (this.closing || this.taskCancellationListeners.size === 0) return
    for (const notification of this.taskCancellations.values()) {
      if (this.deliveredTaskCancellationRevisions.get(notification.taskId) === notification.revision) continue
      this.deliveredTaskCancellationRevisions.set(notification.taskId, notification.revision)
      const delivery = Promise.all([...this.taskCancellationListeners].map(async (listener) => {
        if (this.taskCancellationListeners.has(listener)) await listener(notification)
      }))
      void delivery.catch((error: unknown) => { this.terminate(wireError(error, 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED')) })
    }
  }

  private scheduleInterruptDrain(): void {
    if (this.closing || this.drainingInterrupts || this.interruptListeners.size === 0 || this.interrupts.length === 0) return
    this.drainingInterrupts = true
    void this.drainInterrupts().catch((error: unknown) => {
      this.terminate(wireError(error, 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED'))
    })
  }

  private async drainInterrupts(): Promise<void> {
    try {
      while (!this.closing && this.interruptListeners.size > 0 && this.interrupts.length > 0) {
        const notification = this.interrupts.shift() as TeamLinkInterruptNotification
        for (const listener of [...this.interruptListeners]) {
          if (!this.interruptListeners.has(listener)) continue
          await listener(notification)
        }
      }
    } finally {
      this.drainingInterrupts = false
      this.scheduleInterruptDrain()
    }
  }

  private sendNack(notification: Extract<TeamLinkServerFrame, { readonly type: 'notify' }>): void {
    const frame: TeamLinkClientFrame = {
      v: TEAM_LINK_FRAME_VERSION,
      type: 'nack',
      deliveryId: notification.deliveryId,
      channelId: notification.envelope.channelId,
      envelopeId: notification.envelope.id,
      retryable: true,
    }
    const encoded = this.encode(frame)
    try {
      this.dispatch(encoded)
    } catch (error: unknown) {
      this.terminate(wireError(error, 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED'))
    }
  }

  private async operation<T>(
    op: TeamLinkOperation,
    input: JsonObject,
    parse: (result: JsonValue) => T,
  ): Promise<T> {
    const id = this.nextId()
    const frame = await this.sendAndWait<Extract<TeamLinkServerFrame, { readonly type: 'response'; readonly ok: true }>>({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id,
      op,
      input,
    }, 'response', 'operation')
    try {
      return parse(frame.result)
    } catch {
      const error = new TeamLinkWebSocketError('remote Team Link operation result is malformed', 'TEAM_LINK_WEBSOCKET_MALFORMED_RESULT')
      this.terminate(error)
      throw error
    }
  }

  private async sendAndWait<T extends TeamLinkServerFrame>(
    frame: RequestFrame,
    expected: PendingRequest['expected'],
    purpose: PendingRequest['purpose'],
    signal?: AbortSignal,
  ): Promise<T> {
    this.assertUsable()
    ensureNotAborted(signal)
    if (this.pending.size >= this.config.maxPendingRequests) {
      throw new TeamLinkWebSocketError('Team Link pending-request limit was exceeded', 'TEAM_LINK_WEBSOCKET_REQUEST_LIMIT')
    }
    const encoded = this.encode(frame)
    const completion = Promise.withResolvers<TeamLinkServerFrame>()
    const disposeAbort = this.bindAbort(frame.id, signal)
    const disposeDeadline = this.bindResponseDeadline(frame.id, purpose)
    const pending: PendingRequest = {
      expected,
      purpose,
      resolve: completion.resolve,
      reject: completion.reject,
      dispose: () => {
        disposeAbort()
        disposeDeadline()
      },
    }
    this.pending.set(frame.id, pending)
    try {
      this.dispatch(encoded)
    } catch (error: unknown) {
      const failure = wireError(error, 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED')
      this.rejectPending(frame.id, failure)
      this.terminate(failure)
    }
    return await completion.promise as T
  }

  private bindAbort(id: string, signal: AbortSignal | undefined): () => void {
    if (signal === undefined) return () => {}
    const abort = () => {
      this.rejectPending(id, abortError(signal))
    }
    signal.addEventListener('abort', abort, { once: true })
    return () => { signal.removeEventListener('abort', abort) }
  }

  private bindResponseDeadline(id: string, purpose: PendingRequest['purpose']): () => void {
    const timer = setTimeout(() => {
      const error = new TeamLinkWebSocketError(
        `Team Link WebSocket ${purpose} response exceeded ${this.config.responseTimeoutMs}ms`,
        'TEAM_LINK_WEBSOCKET_RESPONSE_TIMEOUT',
      )
      this.rejectPending(id, error)
      this.terminate(error)
    }, this.config.responseTimeoutMs)
    return () => { clearTimeout(timer) }
  }

  private encode(frame: TeamLinkClientFrame): string {
    let parsed: TeamLinkClientFrame
    try {
      parsed = parseTeamLinkClientFrame(frame)
    } catch {
      throw new TeamLinkWebSocketError('outgoing Team Link WebSocket frame is invalid', 'TEAM_LINK_WEBSOCKET_INVALID_REQUEST')
    }
    const encoded = JSON.stringify(parsed)
    if (Buffer.byteLength(encoded) > this.config.maxFrameBytes) {
      throw new TeamLinkWebSocketError('outgoing Team Link WebSocket frame exceeds the configured limit', 'TEAM_LINK_WEBSOCKET_FRAME_TOO_LARGE')
    }
    return encoded
  }

  private dispatch(encoded: string): void {
    this.assertUsable()
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw new TeamLinkWebSocketError('Team Link WebSocket is not open', 'TEAM_LINK_WEBSOCKET_TRANSPORT_CLOSED')
    }
    this.socket.send(encoded, { binary: false, compress: false }, (error) => {
      if (error != null) {
        this.terminate(new TeamLinkWebSocketError('Team Link WebSocket send failed', 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED'))
      }
    })
  }

  private resolvePending(id: string, frame: TeamLinkServerFrame): void {
    const pending = this.pending.get(id)
    if (pending === undefined) return
    this.pending.delete(id)
    pending.dispose()
    pending.resolve(frame)
  }

  private rejectPending(id: string, error: TeamLinkWebSocketError): void {
    const pending = this.pending.get(id)
    if (pending === undefined) return
    this.pending.delete(id)
    pending.dispose()
    pending.reject(error)
  }

  private resolveOpening(): void {
    if (this.openingSettled) return
    this.openingSettled = true
    this.opening.resolve()
  }

  private rejectOpening(error: TeamLinkWebSocketError): void {
    if (this.openingSettled) return
    this.openingSettled = true
    this.opening.reject(error)
  }

  private async awaitSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw abortError(signal)
    return await new Promise<T>((resolve, reject) => {
      const abort = () => {
        cleanup()
        reject(abortError(signal))
      }
      const cleanup = () => { signal.removeEventListener('abort', abort) }
      signal.addEventListener('abort', abort, { once: true })
      void operation.then(
        (value) => {
          cleanup()
          resolve(value)
        },
        (error: unknown) => {
          cleanup()
          reject(wireError(error, 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED'))
        },
      )
    })
  }

  private nextId(): string {
    this.sequence += 1
    return `team-link-${String(this.sequence)}-${randomUUID()}`
  }

  private bufferedNotificationCount(): number {
    return this.notifications.length + this.interruptDeliveries.size + this.taskCancellations.size + this.invitations.size
  }

  private assertUsable(): void {
    if (!this.closing) return
    throw this.failure ?? new TeamLinkWebSocketError('WebSocket Team Link is closed', 'TEAM_LINK_WEBSOCKET_CLOSED')
  }
}

function assertNever(value: never): never {
  throw new TeamLinkWebSocketError(`unknown Team Link WebSocket frame ${(value as { readonly type?: unknown }).type as string}`, 'TEAM_LINK_WEBSOCKET_MALFORMED_FRAME')
}

/** Register the remote WebSocket Team Link provider. @param ctx - Cordis context. @param config - Resolved provider configuration. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const provider = new WebSocketTeamLinkProvider(
    resolved.providerName,
    resolved,
    () => process.env[resolved.capabilityEnv],
  )
  ctx.effect(() => {
    const unregister = ctx.teamLinks.registerProvider(provider)
    return () => {
      provider.closeAdmission()
      unregister()
    }
  }, 'team-link-websocket: provider registration')
}
