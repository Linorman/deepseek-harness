import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Loader from '@clocky/cordis-plugin-loader'
import WebSocket from 'ws'
import TeamLinkRegistry from '@clocky/clocky-team-link'
import {
  activationBindingSnapshotSchema,
  channelPostIdempotencyKeySchema,
  channelDeliveryClaimSchema,
  channelReceiptRecordSchema,
  participantInterruptSnapshotSchema,
  teamEnvelopeSchema,
  teamTaskSnapshotSchema,
} from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  JsonValue,
  TeamEnvelope,
} from '@clocky/clocky-team'
import {
  TEAM_LINK_FRAME_VERSION,
  teamLinkDeliveryIdSchema,
} from '@clocky/clocky-team-link'
import type {
  TeamLink,
  TeamLinkDeliveryId,
  TeamLinkInterruptNotification,
  TeamLinkConnectRequest,
  TeamLinkServerFrame,
} from '@clocky/clocky-team-link'
import * as TeamLinkWebSocket from '../src/index.ts'
import { TestWebSocketPeer, receiveFrame, sendFrame, sendRaw } from './peer.ts'

const CAPABILITY_ENV = 'CLOCKY_TEAM_LINK_WEBSOCKET_TEST_CAPABILITY'
const CAPABILITY = 'opaque-test-capability'
const POST_IDEMPOTENCY_KEY = channelPostIdempotencyKeySchema.parse('post-websocket')
const contexts = new Set<Context>()
const peers = new Set<TestWebSocketPeer>()
let priorCapability: string | undefined

const binding = activationBindingSnapshotSchema.parse({
  activation: {
    id: 'activation-websocket',
    teamId: 'team-websocket',
    participantId: 'participant-websocket',
    status: 'idle',
  },
  sessionId: 'session-websocket',
  provider: 'sdk',
})

const envelope = teamEnvelopeSchema.parse({
  id: 'envelope-websocket',
  teamId: binding.activation.teamId,
  channelId: 'channel-websocket',
  sequence: 2,
  senderId: 'sender-websocket',
  audience: [binding.activation.participantId],
  kind: 'message',
  payload: { text: 'remote Team Link notification' },
  delivery: 'turn',
  priority: 'normal',
  createdAt: 2,
})

const claim = channelDeliveryClaimSchema.parse({
  binding,
  channel: {
    manifest: {
      id: envelope.channelId,
      teamId: binding.activation.teamId,
      adapter: { type: 'direct', version: 1 },
      participants: [
        { id: envelope.senderId, role: 'sender' },
        { id: binding.activation.participantId, role: 'recipient' },
      ],
      limits: {},
    },
    phase: 'active',
    cursor: 2,
  },
  envelopeId: envelope.id,
  delivery: 'turn',
})

const receipt = channelReceiptRecordSchema.parse({
  type: 'channel/receipt',
  sequence: 3,
  createdAt: 3,
  participantId: binding.activation.participantId,
  envelopeId: envelope.id,
  cursor: 3,
})

const task = teamTaskSnapshotSchema.parse({
  id: 'task-websocket',
  teamId: binding.activation.teamId,
  revision: 2,
  createCommand: {
    creator: {
      teamId: binding.activation.teamId,
      participantId: binding.activation.participantId,
      activationId: binding.activation.id,
      sessionId: binding.sessionId,
      provider: binding.provider,
    },
    idempotencyKey: 'task-create-websocket',
  },
  subject: 'Handle remote Team Link work.',
  description: 'Start from the authenticated assignment delivery.',
  execution: { kind: 'participant' },
  phase: 'running',
  blockedBy: [],
  requiredCapabilities: [],
  priority: 0,
  readScopes: [],
  writeScopes: [],
  workspaceMode: 'shared',
  budget: {},
  reviewPolicy: { kind: 'none' },
  reviewHistory: [],
  maxAttempts: 1,
  attemptCount: 1,
  attemptHistory: [],
  lease: {
    attemptId: 'attempt-websocket',
    assignedRevision: 1,
    ordinal: 1,
    participantId: binding.activation.participantId,
    activationId: binding.activation.id,
    wakeChannelId: envelope.channelId,
    assignedAt: 1,
    startedAt: 2,
    durationMs: 10,
    renewedAt: 1,
    expiresAt: 11,
  },
})

const interrupt = participantInterruptSnapshotSchema.parse({
  id: 'interrupt-websocket',
  actorId: 'actor-websocket',
  target: {
    teamId: binding.activation.teamId,
    participantId: binding.activation.participantId,
    activationId: binding.activation.id,
    sessionId: binding.sessionId,
    provider: binding.provider,
  },
  requestedAt: 1,
})
const interruptDeliveryId = teamLinkDeliveryIdSchema.parse('interrupt-delivery-websocket')

interface LinkInternals {
  socket: { readyState: number }
  readonly config: unknown
  readonly provider: string
  readonly binding: ActivationBindingSnapshot
  readonly notifications: Extract<TeamLinkServerFrame, { readonly type: 'notify' }>[]
  readonly listeners: Set<(envelope: TeamEnvelope) => Promise<void>>
  readonly interrupts: TeamLinkInterruptNotification[]
  readonly interruptListeners: Set<(notification: TeamLinkInterruptNotification) => Promise<void>>
  readonly interruptDeliveries: Map<TeamLinkDeliveryId, TeamLinkInterruptNotification>
  readonly pending: Map<string, unknown>
  closing: boolean
  openingSettled: boolean
  onOpen(): void
  onError(): void
  terminate(error?: Error): void
  onMessage(data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean): void
  acceptFrame(frame: TeamLinkServerFrame): void
  acceptAttached(frame: Extract<TeamLinkServerFrame, { readonly type: 'attached' }>): void
  acceptInterrupt(frame: Extract<TeamLinkServerFrame, { readonly type: 'interrupt' }>): void
  resolvePending(id: string, frame: TeamLinkServerFrame): void
  rejectPending(id: string, error: Error): void
  resolveOpening(): void
  rejectOpening(error: Error): void
  waitForOpen(signal: AbortSignal): Promise<void>
  awaitSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T>
  scheduleDrain(): void
  drainNotifications(): Promise<void>
  scheduleInterruptDrain(): void
  drainInterrupts(): Promise<void>
  sendNack(notification: Extract<TeamLinkServerFrame, { readonly type: 'notify' }>): void
  dispatch(encoded: string): void
}

function internal(link: TeamLink): LinkInternals {
  return link as unknown as LinkInternals
}

class FakeSocket {
  readyState: number
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  constructor(
    readyState: number,
    private readonly throwOnSend = false,
    private readonly callbackError: Error | null = null,
  ) {
    this.readyState = readyState
  }

  on(event: string, listener: (...args: unknown[]) => void): this {
    let listeners = this.listeners.get(event)
    if (listeners === undefined) {
      listeners = new Set()
      this.listeners.set(event, listeners)
    }
    listeners.add(listener)
    return this
  }

  once(event: string, listener: (...args: unknown[]) => void): this {
    const once = (...args: unknown[]) => {
      this.removeListener(event, once)
      listener(...args)
    }
    return this.on(event, once)
  }

  removeListener(event: string, listener: (...args: unknown[]) => void): this {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  send(_value: string, _options: object, callback: (error: Error | null) => void): void {
    if (this.throwOnSend) throw new Error('synthetic send throw')
    callback(this.callbackError)
  }

  terminate(): void {
    this.readyState = WebSocket.CLOSED
    this.emit('error', new Error('synthetic close error'))
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

function fakeLink(source: TeamLink, socket: FakeSocket): LinkInternals {
  const Constructor = (source as unknown as {
    constructor: new (socket: unknown, provider: string, binding: ActivationBindingSnapshot, config: unknown) => LinkInternals
  }).constructor
  return new Constructor(socket, source.provider, source.binding, internal(source).config)
}

beforeEach(() => {
  priorCapability = process.env[CAPABILITY_ENV]
  process.env[CAPABILITY_ENV] = CAPABILITY
})

afterEach(async () => {
  const failures: unknown[] = []
  for (const ctx of contexts) {
    try {
      await ctx.fiber.dispose()
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  contexts.clear()
  for (const peer of peers) {
    try {
      await peer.close()
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  peers.clear()
  if (priorCapability === undefined) delete process.env.CLOCKY_TEAM_LINK_WEBSOCKET_TEST_CAPABILITY
  else process.env[CAPABILITY_ENV] = priorCapability
  if (failures.length > 0) throw new AggregateError(failures, 'WebSocket Team Link test cleanup failed')
})

async function peer(): Promise<TestWebSocketPeer> {
  const value = await TestWebSocketPeer.create()
  peers.add(value)
  return value
}

async function setup(remote: TestWebSocketPeer, overrides: Partial<TeamLinkWebSocket.Config> = {}): Promise<Context> {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(TeamLinkRegistry)
  await ctx.plugin(TeamLinkWebSocket, {
    providerName: 'websocket',
    endpoint: remote.endpoint,
    capabilityEnv: CAPABILITY_ENV,
    connectTimeoutMs: 1_000,
    responseTimeoutMs: 1_000,
    maxFrameBytes: 1_024,
    maxPendingRequests: 8,
    maxBufferedNotifications: 8,
    ...overrides,
  })
  return ctx
}

function identity(value: ActivationBindingSnapshot = binding) {
  return {
    activationId: value.activation.id,
    teamId: value.activation.teamId,
    participantId: value.activation.participantId,
    sessionId: value.sessionId,
    provider: value.provider,
  }
}

function deliveryId(value: string): TeamLinkDeliveryId {
  return teamLinkDeliveryIdSchema.parse(value)
}

async function connect(
  ctx: Context,
  remote: TestWebSocketPeer,
  signal?: AbortSignal,
  onTerminate?: TeamLinkConnectRequest['onTerminate'],
): Promise<{
  readonly link: TeamLink
  readonly socket: Awaited<ReturnType<TestWebSocketPeer['accept']>>
  readonly attachId: string
  readonly subscribeId: string
}> {
  const connecting = ctx.teamLinks.connect({
    provider: 'websocket',
    binding,
    ...signal === undefined ? {} : { signal },
    ...onTerminate === undefined ? {} : { onTerminate },
  })
  const socket = await remote.accept()
  const attach = await receiveFrame(socket)
  expect(attach).toMatchObject({
    v: TEAM_LINK_FRAME_VERSION,
    type: 'attach',
    binding: identity(),
    capability: CAPABILITY,
  })
  if (attach.type !== 'attach') throw new Error('client did not attach')
  expect(attach.id).toEqual(expect.any(String))
  await sendFrame(socket, { v: TEAM_LINK_FRAME_VERSION, type: 'attached', id: attach.id, binding: identity() })
  const subscribe = await receiveFrame(socket)
  expect(subscribe).toMatchObject({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe' })
  if (subscribe.type !== 'subscribe') throw new Error('client did not subscribe')
  await sendFrame(socket, { v: TEAM_LINK_FRAME_VERSION, type: 'response', id: subscribe.id, ok: true, result: { subscribed: true } })
  return { link: await connecting, socket, attachId: attach.id, subscribeId: subscribe.id }
}

function responseResult(op: Extract<Awaited<ReturnType<typeof receiveFrame>>, { readonly type: 'request' }>['op']): JsonValue {
  switch (op) {
    case 'channel-get':
      return claim.channel as unknown as JsonValue
    case 'invitation-ack':
      throw new Error('This response fixture has no channel invitation')
    case 'post':
    case 'final-result':
      return envelope as unknown as JsonValue
    case 'claim':
      return claim as unknown as JsonValue
    case 'task-start':
    case 'task-cancellation-ack':
    case 'task-settle':
    case 'task-integrate':
    case 'task-heartbeat':
    case 'task-review':
      return task as unknown as JsonValue
    case 'receipt':
      return receipt
    case 'interrupt-ack':
      return interrupt as unknown as JsonValue
  }
}

describe('WebSocket Team Link provider', () => {
  it('attaches the exact binding, subscribes, and multiplexes strict operation responses', async () => {
    const remote = await peer()
    const ctx = await setup(remote, { maxFrameBytes: 4_096 })
    const { link, socket } = await connect(ctx, remote)
    const loader = Object.create(Loader.prototype) as Loader
    expect(TeamLinkWebSocket.name).toBe('team-link-websocket')
    expect(TeamLinkWebSocket.inject).toEqual(['teamLinks'])
    expect('default' in TeamLinkWebSocket).toBe(false)
    expect(loader.unwrapExports(TeamLinkWebSocket)).toBe(TeamLinkWebSocket)

    const post = link.post({
      expectedCursor: 1,
      idempotencyKey: POST_IDEMPOTENCY_KEY,
      draft: {
        channelId: envelope.channelId,
        audience: [binding.activation.participantId],
        kind: 'message',
        payload: { text: 'outbound remote message' },
        delivery: 'turn',
      },
    })
    const final = link.postFinalResult({
      channelId: envelope.channelId,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('final-websocket'),
      text: 'Remote final output.',
    })
    const claimed = link.claim(envelope.channelId, envelope.id)
    const lease = task.lease
    if (lease === undefined) throw new Error('task fixture must retain an active lease')
    const started = link.claimTaskAttemptStart({
      taskId: task.id,
      attemptId: lease.attemptId,
      assignedRevision: lease.assignedRevision,
      channelId: envelope.channelId,
      envelopeId: envelope.id,
    })
    const settled = link.settleTaskAttempt({
      taskId: task.id,
      attemptId: lease.attemptId,
      expectedRevision: task.revision,
      outcome: { kind: 'released' },
    })
    const integrated = link.integrateTask({
      taskId: task.id,
      attemptId: lease.attemptId,
      expectedRevision: task.revision,
      verification: 'integration tests passed',
    })
    const reviewed = link.resolveTaskReview({
      taskId: task.id,
      expectedRevision: task.revision,
      nextPhase: 'completed',
      reason: 'The remote reviewer accepted the result.',
    })
    const acknowledged = link.acknowledge(envelope.channelId, envelope.id, 2)

    const requests = []
    for (let index = 0; index < 8; index += 1) requests.push(await receiveFrame(socket))
    const operationRequests = requests.filter((frame): frame is Extract<typeof frame, { readonly type: 'request' }> => frame.type === 'request')
    expect(operationRequests.map(frame => frame.op).sort()).toEqual([
      'claim', 'final-result', 'post', 'receipt', 'task-integrate', 'task-review', 'task-settle', 'task-start',
    ])
    const postRequest = operationRequests.find(frame => frame.op === 'post')
    expect(postRequest?.input).toEqual({
      expectedCursor: 1,
      idempotencyKey: POST_IDEMPOTENCY_KEY,
      draft: {
        channelId: envelope.channelId,
        audience: [binding.activation.participantId],
        kind: 'message',
        payload: { text: 'outbound remote message' },
        delivery: 'turn',
      },
    })
    expect(postRequest?.input).not.toHaveProperty('senderId')
    const finalRequest = operationRequests.find(frame => frame.op === 'final-result')
    expect(finalRequest?.input).toEqual({
      channelId: envelope.channelId,
      idempotencyKey: 'final-websocket',
      text: 'Remote final output.',
    })
    const reviewRequest = operationRequests.find(frame => frame.op === 'task-review')
    expect(reviewRequest?.input).toEqual({
      taskId: task.id,
      expectedRevision: task.revision,
      nextPhase: 'completed',
      reason: 'The remote reviewer accepted the result.',
    })
    expect(reviewRequest?.input).not.toHaveProperty('teamId')
    expect(reviewRequest?.input).not.toHaveProperty('participantId')
    const integrateRequest = operationRequests.find(frame => frame.op === 'task-integrate')
    expect(integrateRequest?.input).toEqual({
      taskId: task.id,
      attemptId: lease.attemptId,
      expectedRevision: task.revision,
      verification: 'integration tests passed',
    })
    expect(integrateRequest?.input).not.toHaveProperty('sourceTaskId')
    for (const request of [...operationRequests].reverse()) {
      await sendFrame(socket, { v: TEAM_LINK_FRAME_VERSION, type: 'response', id: request.id, ok: true, result: responseResult(request.op) })
    }

    await expect(Promise.all([post, final, claimed, started, settled, integrated, reviewed, acknowledged])).resolves.toEqual([
      envelope,
      envelope,
      claim,
      task,
      task,
      task,
      task,
      receipt,
    ])
    await link.close()
  })

  it('rejects a notification before subscription completes', async () => {
    const remote = await peer()
    const ctx = await setup(remote)
    const connecting = ctx.teamLinks.connect({ provider: 'websocket', binding })
    const socket = await remote.accept()
    const attach = await receiveFrame(socket)
    if (attach.type !== 'attach') throw new Error('client did not attach')
    await sendFrame(socket, { v: TEAM_LINK_FRAME_VERSION, type: 'attached', id: attach.id, binding: identity() })
    const subscribe = await receiveFrame(socket)
    if (subscribe.type !== 'subscribe') throw new Error('client did not subscribe')
    await sendFrame(socket, { v: TEAM_LINK_FRAME_VERSION, type: 'notify', deliveryId: deliveryId('delivery-before-subscribe'), envelope })
    await expect(connecting).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_OUT_OF_ORDER_FRAME' })
  })

  it('runs an endpoint termination handler and reports both accepted and rejected cancellation results', async () => {
    const remote = await peer()
    const ctx = await setup(remote)
    const onTerminate = vi.fn<NonNullable<TeamLinkConnectRequest['onTerminate']>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('endpoint is already stopping'))
    const { link, socket } = await connect(ctx, remote, undefined, onTerminate)

    await sendFrame(socket, {
      v: TEAM_LINK_FRAME_VERSION,
      type: 'cancel',
      id: 'cancel-accepted',
      reason: { code: 'TEAM_LINK_CREDENTIAL_REVOKED', message: 'stop Link-owned work' },
    })
    await expect(receiveFrame(socket)).resolves.toEqual({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'cancelled',
      id: 'cancel-accepted',
      accepted: true,
    })

    await sendFrame(socket, {
      v: TEAM_LINK_FRAME_VERSION,
      type: 'cancel',
      id: 'cancel-rejected',
      reason: { code: 'TEAM_LINK_CREDENTIAL_ROTATED', message: 'replace this Link' },
    })
    await expect(receiveFrame(socket)).resolves.toEqual({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'cancelled',
      id: 'cancel-rejected',
      accepted: false,
    })
    expect(onTerminate).toHaveBeenNthCalledWith(1, {
      code: 'TEAM_LINK_CREDENTIAL_REVOKED',
      message: 'stop Link-owned work',
    })
    expect(onTerminate).toHaveBeenNthCalledWith(2, {
      code: 'TEAM_LINK_CREDENTIAL_ROTATED',
      message: 'replace this Link',
    })
    await link.close()
  })

  it('retains a post-subscription notification until onNotify and sends a retryable nack after listener failure', async () => {
    const remote = await peer()
    const ctx = await setup(remote)
    const { link, socket } = await connect(ctx, remote)
    await sendFrame(socket, { v: TEAM_LINK_FRAME_VERSION, type: 'notify', deliveryId: deliveryId('delivery-websocket'), envelope })

    const listener = vi.fn(async () => { throw new Error('retry delivery') })
    const dispose = link.onNotify(listener)
    const nack = await receiveFrame(socket)
    expect(listener).toHaveBeenCalledWith(envelope)
    expect(nack).toEqual({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'nack',
      deliveryId: deliveryId('delivery-websocket'),
      channelId: envelope.channelId,
      envelopeId: envelope.id,
      retryable: true,
    })
    dispose()
    dispose()
    await link.close()
  })

  it('buffers a target-exact interrupt, delivers it, and acknowledges it through v4', async () => {
    const remote = await peer()
    const ctx = await setup(remote)
    const { link, socket } = await connect(ctx, remote)
    await sendFrame(socket, {
      v: TEAM_LINK_FRAME_VERSION,
      type: 'interrupt',
      deliveryId: interruptDeliveryId,
      interrupt,
    })

    const listener = vi.fn(async () => {})
    const dispose = link.onInterrupt(listener)
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith({ deliveryId: interruptDeliveryId, interrupt })
    })
    const acknowledged = link.acknowledgeInterrupt(interruptDeliveryId, interrupt.id)
    const request = await receiveFrame(socket)
    expect(request).toMatchObject({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      op: 'interrupt-ack',
      input: { deliveryId: interruptDeliveryId, interruptId: interrupt.id },
    })
    if (request.type !== 'request') throw new Error('client did not request an interrupt acknowledgement')
    expect(request.id).toEqual(expect.any(String))
    await sendFrame(socket, {
      v: TEAM_LINK_FRAME_VERSION,
      type: 'response',
      id: request.id,
      ok: true,
      result: { ...interrupt, acknowledgedAt: 2 } as unknown as JsonValue,
    })
    await expect(acknowledged).resolves.toEqual({ ...interrupt, acknowledgedAt: 2 })
    dispose()
    dispose()
    await link.close()
  })

  it('rejects interrupt frames that are early, foreign, duplicate, or over the shared buffer limit', async () => {
    const earlyPeer = await peer()
    const earlyContext = await setup(earlyPeer)
    const earlyConnect = earlyContext.teamLinks.connect({ provider: 'websocket', binding })
    const earlySocket = await earlyPeer.accept()
    const earlyAttach = await receiveFrame(earlySocket)
    if (earlyAttach.type !== 'attach') throw new Error('client did not attach')
    await sendFrame(earlySocket, { v: TEAM_LINK_FRAME_VERSION, type: 'attached', id: earlyAttach.id, binding: identity() })
    const earlySubscribe = await receiveFrame(earlySocket)
    if (earlySubscribe.type !== 'subscribe') throw new Error('client did not subscribe')
    await sendFrame(earlySocket, { v: TEAM_LINK_FRAME_VERSION, type: 'interrupt', deliveryId: interruptDeliveryId, interrupt })
    await expect(earlyConnect).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_OUT_OF_ORDER_FRAME' })

    const foreignPeer = await peer()
    const foreignContext = await setup(foreignPeer)
    const foreign = await connect(foreignContext, foreignPeer)
    await sendFrame(foreign.socket, {
      v: TEAM_LINK_FRAME_VERSION,
      type: 'interrupt',
      deliveryId: interruptDeliveryId,
      interrupt: participantInterruptSnapshotSchema.parse({
        ...interrupt,
        target: { ...interrupt.target, participantId: 'other-participant' },
      }),
    })
    await expect(foreign.link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_BINDING_MISMATCH' })

    const duplicatePeer = await peer()
    const duplicateContext = await setup(duplicatePeer)
    const duplicate = await connect(duplicateContext, duplicatePeer)
    await sendFrame(duplicate.socket, { v: TEAM_LINK_FRAME_VERSION, type: 'interrupt', deliveryId: interruptDeliveryId, interrupt })
    await sendFrame(duplicate.socket, { v: TEAM_LINK_FRAME_VERSION, type: 'interrupt', deliveryId: interruptDeliveryId, interrupt })
    await expect(duplicate.link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_UNEXPECTED_FRAME' })

    const limitedPeer = await peer()
    const limitedContext = await setup(limitedPeer, { maxBufferedNotifications: 1 })
    const limited = await connect(limitedContext, limitedPeer)
    await sendFrame(limited.socket, { v: TEAM_LINK_FRAME_VERSION, type: 'interrupt', deliveryId: interruptDeliveryId, interrupt })
    await sendFrame(limited.socket, {
      v: TEAM_LINK_FRAME_VERSION,
      type: 'interrupt',
      deliveryId: teamLinkDeliveryIdSchema.parse('other-interrupt-delivery'),
      interrupt: participantInterruptSnapshotSchema.parse({ ...interrupt, id: 'other-interrupt' }),
    })
    await expect(limited.link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_NOTIFICATION_LIMIT' })
  })

  it('bounds delivered unacknowledged interrupts and releases their shared notification capacity after acknowledgement', async () => {
    const overflowPeer = await peer()
    const overflowContext = await setup(overflowPeer, { maxBufferedNotifications: 1 })
    const overflow = await connect(overflowContext, overflowPeer)
    const overflowListener = vi.fn(async () => {})
    overflow.link.onInterrupt(overflowListener)
    await sendFrame(overflow.socket, { v: TEAM_LINK_FRAME_VERSION, type: 'interrupt', deliveryId: interruptDeliveryId, interrupt })
    await vi.waitFor(() => {
      expect(overflowListener).toHaveBeenCalledWith({ deliveryId: interruptDeliveryId, interrupt })
      expect(internal(overflow.link).interrupts).toEqual([])
      expect(internal(overflow.link).interruptDeliveries.size).toBe(1)
    })
    await sendFrame(overflow.socket, { v: TEAM_LINK_FRAME_VERSION, type: 'notify', deliveryId: deliveryId('blocked-by-interrupt'), envelope })
    await expect(overflow.link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_NOTIFICATION_LIMIT' })

    const acknowledgedPeer = await peer()
    const acknowledgedContext = await setup(acknowledgedPeer, { maxBufferedNotifications: 1 })
    const acknowledged = await connect(acknowledgedContext, acknowledgedPeer)
    const acknowledgedListener = vi.fn(async () => {})
    acknowledged.link.onInterrupt(acknowledgedListener)
    await sendFrame(acknowledged.socket, { v: TEAM_LINK_FRAME_VERSION, type: 'interrupt', deliveryId: interruptDeliveryId, interrupt })
    await vi.waitFor(() => { expect(acknowledgedListener).toHaveBeenCalledWith({ deliveryId: interruptDeliveryId, interrupt }) })
    const receipt = acknowledged.link.acknowledgeInterrupt(interruptDeliveryId, interrupt.id)
    const request = await receiveFrame(acknowledged.socket)
    if (request.type !== 'request') throw new Error('client did not request an interrupt acknowledgement')
    await sendFrame(acknowledged.socket, {
      v: TEAM_LINK_FRAME_VERSION,
      type: 'response',
      id: request.id,
      ok: true,
      result: { ...interrupt, acknowledgedAt: 2 } as unknown as JsonValue,
    })
    await expect(receipt).resolves.toEqual({ ...interrupt, acknowledgedAt: 2 })
    const afterAcknowledgement = participantInterruptSnapshotSchema.parse({ ...interrupt, id: 'interrupt-after-acknowledgement' })
    const afterAcknowledgementDelivery = teamLinkDeliveryIdSchema.parse('interrupt-delivery-after-acknowledgement')
    await sendFrame(acknowledged.socket, {
      v: TEAM_LINK_FRAME_VERSION,
      type: 'interrupt',
      deliveryId: afterAcknowledgementDelivery,
      interrupt: afterAcknowledgement,
    })
    await vi.waitFor(() => {
      expect(acknowledgedListener).toHaveBeenCalledWith({
        deliveryId: afterAcknowledgementDelivery,
        interrupt: afterAcknowledgement,
      })
    })
    await acknowledged.link.close()
  })

  it('terminates without acknowledgement when an interrupt listener fails', async () => {
    const remote = await peer()
    const ctx = await setup(remote)
    const { link, socket } = await connect(ctx, remote)
    link.onInterrupt(async () => { throw new Error('interrupt handoff failed') })
    await sendFrame(socket, { v: TEAM_LINK_FRAME_VERSION, type: 'interrupt', deliveryId: interruptDeliveryId, interrupt })
    await expect(link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED' })
    expect(internal(link).interruptDeliveries).toEqual(new Map())
  })

  it('contains removed interrupt listeners without acknowledging the delivery', async () => {
    const remote = await peer()
    const ctx = await setup(remote)
    const { link, socket } = await connect(ctx, remote)
    const skipped = vi.fn(async () => {})
    let disposeSkipped: () => void = () => {}
    const removing = vi.fn(async () => { disposeSkipped() })
    link.onInterrupt(removing)
    disposeSkipped = link.onInterrupt(skipped)
    await sendFrame(socket, { v: TEAM_LINK_FRAME_VERSION, type: 'interrupt', deliveryId: interruptDeliveryId, interrupt })
    await vi.waitFor(() => { expect(removing).toHaveBeenCalledWith({ deliveryId: interruptDeliveryId, interrupt }) })
    expect(skipped).not.toHaveBeenCalled()
    await link.close()
  })

  it('rejects an unknown interrupt delivery and an invalid interrupt acknowledgement response', async () => {
    const remote = await peer()
    const ctx = await setup(remote)
    const { link, socket } = await connect(ctx, remote)
    await expect(link.acknowledgeInterrupt(interruptDeliveryId, interrupt.id))
      .rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_INVALID_REQUEST' })
    await sendFrame(socket, { v: TEAM_LINK_FRAME_VERSION, type: 'interrupt', deliveryId: interruptDeliveryId, interrupt })
    await vi.waitFor(() => {
      expect(internal(link).interruptDeliveries.has(interruptDeliveryId)).toBe(true)
    })
    const acknowledgement = link.acknowledgeInterrupt(interruptDeliveryId, interrupt.id)
    const request = await receiveFrame(socket)
    if (request.type !== 'request') throw new Error('client did not request an interrupt acknowledgement')
    await sendFrame(socket, {
      v: TEAM_LINK_FRAME_VERSION,
      type: 'response',
      id: request.id,
      ok: true,
      result: participantInterruptSnapshotSchema.parse({
        ...interrupt,
        target: { ...interrupt.target, provider: 'other-provider' },
        acknowledgedAt: 2,
      }) as unknown as JsonValue,
    })
    await expect(acknowledgement).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_MALFORMED_RESULT' })
    await expect(link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_MALFORMED_RESULT' })
  })

  it('contains removed listeners and stops a rejected handoff during close', async () => {
    const firstPeer = await peer()
    const firstContext = await setup(firstPeer)
    const first = await connect(firstContext, firstPeer)
    const skipped = vi.fn(async () => {})
    const removing = vi.fn(async () => { removeSkipped() })
    let removeSkipped: () => void = () => {}
    first.link.onNotify(removing)
    removeSkipped = first.link.onNotify(skipped)
    await sendFrame(first.socket, { v: TEAM_LINK_FRAME_VERSION, type: 'notify', deliveryId: deliveryId('skip-listener'), envelope })
    await vi.waitFor(() => { expect(removing).toHaveBeenCalledWith(envelope) })
    await vi.waitFor(() => { expect(skipped).not.toHaveBeenCalled() })
    await first.link.close()

    const closingPeer = await peer()
    const closingContext = await setup(closingPeer)
    const closing = await connect(closingContext, closingPeer)
    closing.link.onNotify(async () => {
      await closing.link.close()
      throw new Error('closed handoff')
    })
    await sendFrame(closing.socket, { v: TEAM_LINK_FRAME_VERSION, type: 'notify', deliveryId: deliveryId('close-listener'), envelope })
    await expect(closing.link.done).resolves.toBeUndefined()
  })

  it('rejects a mismatched attached binding before publishing a Link', async () => {
    const remote = await peer()
    const ctx = await setup(remote)
    const connecting = ctx.teamLinks.connect({ provider: 'websocket', binding })
    const socket = await remote.accept()
    const attach = await receiveFrame(socket)
    if (attach.type !== 'attach') throw new Error('client did not attach')
    await sendFrame(socket, {
      v: TEAM_LINK_FRAME_VERSION,
      type: 'attached',
      id: attach.id,
      binding: { ...identity(), sessionId: 'other-session' as ActivationBindingSnapshot['sessionId'] },
    })
    await expect(connecting).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_BINDING_MISMATCH' })
  })

  it('rejects attach and subscription responses that violate their expected order or result', async () => {
    const firstPeer = await peer()
    const firstContext = await setup(firstPeer)
    const rejectedAttach = firstContext.teamLinks.connect({ provider: 'websocket', binding })
    const firstSocket = await firstPeer.accept()
    const firstAttach = await receiveFrame(firstSocket)
    if (firstAttach.type !== 'attach') throw new Error('client did not attach')
    await sendFrame(firstSocket, {
      v: TEAM_LINK_FRAME_VERSION,
      type: 'response',
      id: firstAttach.id,
      ok: false,
      error: { code: 'unauthorized', message: 'binding is not authorized' },
    })
    await expect(rejectedAttach).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_REMOTE_REJECTED' })

    const prematurePeer = await peer()
    const prematureContext = await setup(prematurePeer)
    const prematureAttach = prematureContext.teamLinks.connect({ provider: 'websocket', binding })
    const prematureSocket = await prematurePeer.accept()
    const prematureFrame = await receiveFrame(prematureSocket)
    if (prematureFrame.type !== 'attach') throw new Error('client did not attach')
    await sendFrame(prematureSocket, { v: TEAM_LINK_FRAME_VERSION, type: 'response', id: prematureFrame.id, ok: true, result: {} })
    await expect(prematureAttach).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_OUT_OF_ORDER_FRAME' })

    const secondPeer = await peer()
    const secondContext = await setup(secondPeer)
    const invalidSubscription = secondContext.teamLinks.connect({ provider: 'websocket', binding })
    const secondSocket = await secondPeer.accept()
    const secondAttach = await receiveFrame(secondSocket)
    if (secondAttach.type !== 'attach') throw new Error('client did not attach')
    await sendFrame(secondSocket, { v: TEAM_LINK_FRAME_VERSION, type: 'attached', id: secondAttach.id, binding: identity() })
    const subscribe = await receiveFrame(secondSocket)
    if (subscribe.type !== 'subscribe') throw new Error('client did not subscribe')
    await sendFrame(secondSocket, { v: TEAM_LINK_FRAME_VERSION, type: 'response', id: subscribe.id, ok: true, result: { subscribed: false } })
    await expect(invalidSubscription).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_MALFORMED_RESULT' })

    const nullPeer = await peer()
    const nullContext = await setup(nullPeer)
    const nullSubscription = nullContext.teamLinks.connect({ provider: 'websocket', binding })
    const nullSocket = await nullPeer.accept()
    const nullAttach = await receiveFrame(nullSocket)
    if (nullAttach.type !== 'attach') throw new Error('client did not attach')
    await sendFrame(nullSocket, { v: TEAM_LINK_FRAME_VERSION, type: 'attached', id: nullAttach.id, binding: identity() })
    const nullSubscribe = await receiveFrame(nullSocket)
    if (nullSubscribe.type !== 'subscribe') throw new Error('client did not subscribe')
    await sendFrame(nullSocket, { v: TEAM_LINK_FRAME_VERSION, type: 'response', id: nullSubscribe.id, ok: true, result: null })
    await expect(nullSubscription).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_MALFORMED_RESULT' })
  })

  it('keeps a Link usable after a sanitized remote operation rejection', async () => {
    const remote = await peer()
    const ctx = await setup(remote)
    const { link, socket } = await connect(ctx, remote)
    const rejected = link.claim(envelope.channelId, envelope.id)
    const first = await receiveFrame(socket)
    if (first.type !== 'request') throw new Error('client did not request a claim')
    await sendFrame(socket, {
      v: TEAM_LINK_FRAME_VERSION,
      type: 'response',
      id: first.id,
      ok: false,
      error: { code: 'not-pending', message: 'delivery is no longer pending' },
    })
    await expect(rejected).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_REMOTE_REJECTED' })

    const retried = link.claim(envelope.channelId, envelope.id)
    const second = await receiveFrame(socket)
    if (second.type !== 'request') throw new Error('client did not retry a claim')
    await sendFrame(socket, { v: TEAM_LINK_FRAME_VERSION, type: 'response', id: second.id, ok: true, result: null })
    await expect(retried).resolves.toBeUndefined()
    await link.close()
  })

  it('fails terminally on malformed and duplicate response frames', async () => {
    const remote = await peer()
    const ctx = await setup(remote)
    const { link, socket } = await connect(ctx, remote)
    const operation = link.claim(envelope.channelId, envelope.id)
    const request = await receiveFrame(socket)
    if (request.type !== 'request') throw new Error('client did not request a claim')
    const response = { v: TEAM_LINK_FRAME_VERSION, type: 'response' as const, id: request.id, ok: true as const, result: null } as const
    await sendFrame(socket, response)
    await expect(operation).resolves.toBeUndefined()
    await sendFrame(socket, response)
    await expect(link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_UNEXPECTED_FRAME' })
    await expect(link.claim(envelope.channelId, envelope.id)).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_UNEXPECTED_FRAME' })
  })

  it('fails terminally on an invalid operation result', async () => {
    const remote = await peer()
    const ctx = await setup(remote, { maxBufferedNotifications: 1 })
    const { link, socket } = await connect(ctx, remote)
    const operation = link.post({
      expectedCursor: 1,
      idempotencyKey: POST_IDEMPOTENCY_KEY,
      draft: {
        channelId: envelope.channelId,
        audience: [binding.activation.participantId],
        kind: 'message',
        payload: {},
        delivery: 'turn',
      },
    })
    const request = await receiveFrame(socket)
    if (request.type !== 'request') throw new Error('client did not request a post')
    await sendFrame(socket, { v: TEAM_LINK_FRAME_VERSION, type: 'response', id: request.id, ok: true, result: { id: 'incomplete' } })
    await expect(operation).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_MALFORMED_RESULT' })
    await expect(link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_MALFORMED_RESULT' })
  })

  it('rejects malformed, binary, duplicate attach, and overflowing notification frames', async () => {
    const malformedPeer = await peer()
    const malformedContext = await setup(malformedPeer)
    const malformed = await connect(malformedContext, malformedPeer)
    await sendRaw(malformed.socket, '{not-json')
    await expect(malformed.link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_MALFORMED_FRAME' })

    const binaryPeer = await peer()
    const binaryContext = await setup(binaryPeer)
    const binary = await connect(binaryContext, binaryPeer)
    await sendRaw(binary.socket, Buffer.from('{}'), true)
    await expect(binary.link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_MALFORMED_FRAME' })

    const duplicatePeer = await peer()
    const duplicateContext = await setup(duplicatePeer)
    const duplicate = await connect(duplicateContext, duplicatePeer)
    await sendFrame(duplicate.socket, { v: TEAM_LINK_FRAME_VERSION, type: 'attached', id: duplicate.attachId, binding: identity() })
    await expect(duplicate.link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_UNEXPECTED_FRAME' })

    const overflowPeer = await peer()
    const overflowContext = await setup(overflowPeer, { maxBufferedNotifications: 1 })
    const overflow = await connect(overflowContext, overflowPeer)
    await sendFrame(overflow.socket, { v: TEAM_LINK_FRAME_VERSION, type: 'notify', deliveryId: deliveryId('delivery-one'), envelope })
    await sendFrame(overflow.socket, { v: TEAM_LINK_FRAME_VERSION, type: 'notify', deliveryId: deliveryId('delivery-two'), envelope })
    await expect(overflow.link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_NOTIFICATION_LIMIT' })

    const legacyPeer = await peer()
    const legacyContext = await setup(legacyPeer)
    const legacy = await connect(legacyContext, legacyPeer)
    await sendRaw(legacy.socket, JSON.stringify({
      v: 1,
      type: 'response',
      id: 'legacy',
      ok: true,
      result: null,
    }))
    await expect(legacy.link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_MALFORMED_FRAME' })
  })

  it('rejects notifications outside the bound Team and recipient identity', async () => {
    const foreignPeer = await peer()
    const foreignContext = await setup(foreignPeer)
    const foreign = await connect(foreignContext, foreignPeer)
    await sendFrame(foreign.socket, {
      v: TEAM_LINK_FRAME_VERSION,
      type: 'notify',
      deliveryId: deliveryId('foreign-team'),
      envelope: teamEnvelopeSchema.parse({ ...envelope, teamId: 'other-team' }),
    })
    await expect(foreign.link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_BINDING_MISMATCH' })

    const audiencePeer = await peer()
    const audienceContext = await setup(audiencePeer)
    const audience = await connect(audienceContext, audiencePeer)
    await sendFrame(audience.socket, {
      v: TEAM_LINK_FRAME_VERSION,
      type: 'notify',
      deliveryId: deliveryId('foreign-audience'),
      envelope: teamEnvelopeSchema.parse({ ...envelope, audience: [] }),
    })
    await expect(audience.link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_BINDING_MISMATCH' })
  })

  it('rejects a missing capability and a stalled connect without logging the capability', async () => {
    const remote = await peer()
    const ctx = await setup(remote, { connectTimeoutMs: 25 })
    delete process.env.CLOCKY_TEAM_LINK_WEBSOCKET_TEST_CAPABILITY
    await expect(ctx.teamLinks.connect({ provider: 'websocket', binding })).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_CAPABILITY_MISSING' })
    process.env[CAPABILITY_ENV] = CAPABILITY

    const stalled = ctx.teamLinks.connect({ provider: 'websocket', binding })
    await remote.accept()
    await expect(stalled).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_CONNECT_TIMEOUT' })
  })

  it('times out a black-hole operation and clears its pending request', async () => {
    const remote = await peer()
    const ctx = await setup(remote, { responseTimeoutMs: 25 })
    const { link, socket } = await connect(ctx, remote)
    const waiting = link.claim(envelope.channelId, envelope.id)
    const request = await receiveFrame(socket)
    expect(request).toMatchObject({ type: 'request', op: 'claim' })
    await expect(waiting).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_RESPONSE_TIMEOUT' })
    expect(internal(link).pending.size).toBe(0)
    await expect(link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_RESPONSE_TIMEOUT' })
  })

  it('rejects cancellation, invalid endpoint configuration, and remote close', async () => {
    const remote = await peer()
    const ctx = await setup(remote)
    const aborted = new AbortController()
    aborted.abort()
    await expect(ctx.teamLinks.connect({ provider: 'websocket', binding, signal: aborted.signal })).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_ABORTED' })

    const invalidContext = new Context()
    contexts.add(invalidContext)
    await invalidContext.plugin(TeamLinkRegistry)
    await expect(invalidContext.plugin(TeamLinkWebSocket, {
      providerName: 'websocket',
      endpoint: 'http://127.0.0.1:1',
      capabilityEnv: CAPABILITY_ENV,
      connectTimeoutMs: 1_000,
      responseTimeoutMs: 1_000,
      maxFrameBytes: 1_024,
      maxPendingRequests: 8,
      maxBufferedNotifications: 8,
    })).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_CONFIGURATION_INVALID' })

    const active = await connect(ctx, remote)
    active.socket.close()
    await expect(active.link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_TRANSPORT_CLOSED' })
  })

  it('validates every endpoint form and accepts an un-aborted external signal', async () => {
    const remote = await peer()
    const ctx = await setup(remote)
    const signal = new AbortController()
    const active = await connect(ctx, remote, signal.signal)
    await active.link.close()

    for (const endpoint of ['not a URL', 'ws://user@127.0.0.1:1', 'ws://127.0.0.1:1/#fragment']) {
      const invalid = new Context()
      contexts.add(invalid)
      await invalid.plugin(TeamLinkRegistry)
      await expect(invalid.plugin(TeamLinkWebSocket, {
        providerName: 'websocket',
        endpoint,
        capabilityEnv: CAPABILITY_ENV,
        connectTimeoutMs: 1_000,
        responseTimeoutMs: 1_000,
        maxFrameBytes: 1_024,
        maxPendingRequests: 8,
        maxBufferedNotifications: 8,
      })).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_CONFIGURATION_INVALID' })
    }

    const secure = new Context()
    contexts.add(secure)
    await secure.plugin(TeamLinkRegistry)
    const fiber = await secure.plugin(TeamLinkWebSocket, {
      providerName: 'secure',
      endpoint: 'wss://127.0.0.1:443/team-link',
      capabilityEnv: CAPABILITY_ENV,
      connectTimeoutMs: 1_000,
      responseTimeoutMs: 1_000,
      maxFrameBytes: 1_024,
      maxPendingRequests: 8,
      maxBufferedNotifications: 8,
    })
    const provider = secure.teamLinks.getProvider('secure')
    if (provider === undefined) throw new Error('WebSocket provider was not registered')
    await fiber.dispose()
    await expect(provider.connect({ provider: 'secure', binding })).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_PROVIDER_CLOSED' })
  })

  it('enforces request and outbound frame limits without accepting an insecure TLS override', async () => {
    const remote = await peer()
    const ctx = await setup(remote, { maxPendingRequests: 1, maxFrameBytes: 512 })
    const { link, socket } = await connect(ctx, remote)
    const first = link.claim(envelope.channelId, envelope.id)
    const request = await receiveFrame(socket)
    if (request.type !== 'request') throw new Error('client did not request a claim')
    await expect(link.claim(envelope.channelId, envelope.id)).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_REQUEST_LIMIT' })
    await sendFrame(socket, { v: TEAM_LINK_FRAME_VERSION, type: 'response', id: request.id, ok: true, result: null })
    await expect(first).resolves.toBeUndefined()

    await expect(link.post({
      expectedCursor: 2,
      idempotencyKey: POST_IDEMPOTENCY_KEY,
      draft: {
        channelId: envelope.channelId,
        audience: [binding.activation.participantId],
        kind: 'message',
        payload: { text: 'x'.repeat(1_024) },
        delivery: 'turn',
      },
    })).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_FRAME_TOO_LARGE' })
    await link.close()
  })

  it('resolves done on caller close and rejects subsequent operations', async () => {
    const remote = await peer()
    const ctx = await setup(remote)
    const { link } = await connect(ctx, remote)
    await expect(link.close()).resolves.toBeUndefined()
    await expect(link.done).resolves.toBeUndefined()
    const ignored = link.onNotify(async () => {})
    ignored()
    const ignoredInterrupt = link.onInterrupt(async () => {})
    ignoredInterrupt()
    await expect(link.claim(envelope.channelId, envelope.id)).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_CLOSED' })
  })

  it('accepts all text raw-data representations and rejects oversized frames', async () => {
    const fragmentsPeer = await peer()
    const fragmentsContext = await setup(fragmentsPeer)
    const fragments = await connect(fragmentsContext, fragmentsPeer)
    const fragmentsInternal = internal(fragments.link)
    const notification = { v: TEAM_LINK_FRAME_VERSION, type: 'notify' as const, deliveryId: deliveryId('fragments'), envelope }
    fragmentsInternal.onMessage([Buffer.from(JSON.stringify(notification))], false)
    expect(fragmentsInternal.notifications).toEqual([notification])
    await fragments.link.close()
    fragmentsInternal.onMessage(Buffer.from(JSON.stringify(notification)), false)

    const arrayPeer = await peer()
    const arrayContext = await setup(arrayPeer)
    const array = await connect(arrayContext, arrayPeer)
    const bytes = Buffer.from(JSON.stringify(notification))
    internal(array.link).onMessage(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), false)
    expect(internal(array.link).notifications).toEqual([notification])
    await array.link.close()

    const oversizedPeer = await peer()
    const oversizedContext = await setup(oversizedPeer)
    const oversized = await connect(oversizedContext, oversizedPeer)
    internal(oversized.link).onMessage(Buffer.alloc(1_025), false)
    await expect(oversized.link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_FRAME_TOO_LARGE' })
  })

  it('rejects type-invalid outbound input and mismatched frame state', async () => {
    const invalidPeer = await peer()
    const invalidContext = await setup(invalidPeer)
    const invalid = await connect(invalidContext, invalidPeer)
    await expect(invalid.link.post({
      expectedCursor: Number.NaN,
      idempotencyKey: POST_IDEMPOTENCY_KEY,
      draft: {
        channelId: envelope.channelId,
        audience: [binding.activation.participantId],
        kind: 'message',
        payload: {},
        delivery: 'turn',
      },
    })).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_INVALID_REQUEST' })
    await invalid.link.close()

    const mismatchPeer = await peer()
    const mismatchContext = await setup(mismatchPeer)
    const mismatch = await connect(mismatchContext, mismatchPeer)
    const claimOperation = mismatch.link.claim(envelope.channelId, envelope.id)
    const request = await receiveFrame(mismatch.socket)
    if (request.type !== 'request') throw new Error('client did not request a claim')
    await sendFrame(mismatch.socket, { v: TEAM_LINK_FRAME_VERSION, type: 'attached', id: request.id, binding: identity() })
    await expect(claimOperation).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_OUT_OF_ORDER_FRAME' })
    await expect(mismatch.link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_OUT_OF_ORDER_FRAME' })
  })

  it('contains terminal helper paths without accepting an unknown frame', async () => {
    const remote = await peer()
    const ctx = await setup(remote)
    const { link } = await connect(ctx, remote)
    const state = internal(link)
    expect(() => { state.acceptFrame({ v: TEAM_LINK_FRAME_VERSION, type: 'unknown' } as never) }).toThrow(/unknown Team Link WebSocket frame/)
    expect(() => { state.acceptAttached({ v: TEAM_LINK_FRAME_VERSION, type: 'attached', id: 'unknown', binding: identity() }) }).toThrow(/unexpected or duplicate attach completion/)
    state.resolvePending('unknown', { v: TEAM_LINK_FRAME_VERSION, type: 'response', id: 'unknown', ok: true, result: null })
    state.rejectPending('unknown', new Error('unknown pending frame'))
    state.resolveOpening()
    state.rejectOpening(new Error('already open'))

    const completed = new AbortController()
    await expect(state.awaitSignal(Promise.resolve('ready'), completed.signal)).resolves.toBe('ready')
    await expect(state.awaitSignal(Promise.reject(new Error('opening failed')), completed.signal)).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED' })
    const cancelled = new AbortController()
    const waiting = state.awaitSignal(new Promise<void>(() => {}), cancelled.signal)
    cancelled.abort()
    await expect(waiting).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_ABORTED' })
    const alreadyCancelled = new AbortController()
    alreadyCancelled.abort()
    await expect(state.awaitSignal(Promise.resolve(), alreadyCancelled.signal)).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_ABORTED' })
    await link.close()
  })

  it('fails closed when local drain or nack dispatch cannot complete', async () => {
    const drainPeer = await peer()
    const drainContext = await setup(drainPeer)
    const drain = await connect(drainContext, drainPeer)
    const drainState = internal(drain.link)
    drainState.listeners.add(async () => {})
    drainState.notifications.push({ v: TEAM_LINK_FRAME_VERSION, type: 'notify', deliveryId: deliveryId('drain'), envelope })
    drainState.drainNotifications = async () => { throw new Error('drain failure') }
    drainState.scheduleDrain()
    await expect(drain.link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED' })

    const nackPeer = await peer()
    const nackContext = await setup(nackPeer)
    const nack = await connect(nackContext, nackPeer)
    const nackState = internal(nack.link)
    nackState.dispatch = () => { throw new Error('nack dispatch failure') }
    nackState.sendNack({ v: TEAM_LINK_FRAME_VERSION, type: 'notify', deliveryId: deliveryId('nack'), envelope })
    await expect(nack.link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED' })
  })

  it('turns a transport error into a terminal failure', async () => {
    const remote = await peer()
    const ctx = await setup(remote)
    const { link } = await connect(ctx, remote)
    internal(link).onError()
    await expect(link.done).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED' })
  })

  it('handles synchronous socket states and send failures without exposing a Link', async () => {
    const remote = await peer()
    const ctx = await setup(remote)
    const { link } = await connect(ctx, remote)

    const openSocket = new FakeSocket(WebSocket.OPEN)
    const opened = fakeLink(link, openSocket)
    await expect(opened.waitForOpen(new AbortController().signal)).resolves.toBeUndefined()
    opened.onOpen()
    opened.terminate()
    opened.terminate()

    const openingSocket = new FakeSocket(WebSocket.CONNECTING)
    const opening = fakeLink(link, openingSocket)
    opening.onError()
    await expect(opening.waitForOpen(new AbortController().signal)).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED' })
    opening.openingSettled = false
    opening.rejectOpening(new Error('synthetic opening rejection'))

    const closedSocket = new FakeSocket(WebSocket.CLOSED)
    const closed = fakeLink(link, closedSocket)
    expect(() => { closed.dispatch('frame') }).toThrow(/not open/)
    closed.terminate()

    const throwingSocket = new FakeSocket(WebSocket.OPEN, true)
    const throwing = fakeLink(link, throwingSocket)
    await expect((throwing as unknown as TeamLink).claim(envelope.channelId, envelope.id)).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED' })

    const callbackSocket = new FakeSocket(WebSocket.OPEN, false, new Error('synthetic send callback'))
    const callback = fakeLink(link, callbackSocket)
    await expect((callback as unknown as TeamLink).claim(envelope.channelId, envelope.id)).rejects.toMatchObject({ code: 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED' })
    await link.close()
  })
})
