import { once } from 'node:events'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import type { Context } from '@clocky/cordis'
import type { WebUpgradeRoute } from '@clocky/clocky-host-webserver'
import { parseTeamLinkServerFrame, TEAM_LINK_FRAME_VERSION } from '@clocky/clocky-team-link'
import { participantInterruptSnapshotSchema, teamEnvelopeSchema, TeamError } from '@clocky/clocky-team'
import type {
  ActivationActorProofIssuer,
  ActivationBindingSnapshot,
  TeamActorProof,
  TeamActorProofLease,
} from '@clocky/clocky-team'
import type { LogStream } from '@clocky/clocky-storage-log'
import * as WebSocketHub from '../src/index.ts'

const capabilityEnv = 'CLOCKY_TEAM_LINK_WEBSOCKET_HUB_EDGE_CAPABILITY'
const capability = 'edge-capability'
const harnesses = new Set<FakeHarness>()

afterEach(async () => {
  await Promise.all([...harnesses].map(async harness => harness.close()))
  harnesses.clear()
  Reflect.deleteProperty(process.env, capabilityEnv)
})

interface FakeTeams {
  readonly openActivationActorProofIssuer: ReturnType<typeof vi.fn>
  readonly getActivation: ReturnType<typeof vi.fn>
  readonly getTeam: ReturnType<typeof vi.fn>
  readonly getChannel: ReturnType<typeof vi.fn>
  readonly getChannelAdmission: ReturnType<typeof vi.fn>
  readonly listPendingParticipantInterrupts: ReturnType<typeof vi.fn>
  readonly acknowledgeParticipantInterrupt: ReturnType<typeof vi.fn>
  readonly watchTeam: ReturnType<typeof vi.fn>
  readonly watchChannel: ReturnType<typeof vi.fn>
  readonly listChannelPendingDeliveries: ReturnType<typeof vi.fn>
  readonly postChannelEnvelope: ReturnType<typeof vi.fn>
  readonly postChannelFinalEnvelope: ReturnType<typeof vi.fn>
  readonly claimChannelDelivery: ReturnType<typeof vi.fn>
  readonly claimTaskAttemptStart: ReturnType<typeof vi.fn>
  readonly heartbeatTaskAttempt: ReturnType<typeof vi.fn>
  readonly settleTaskAttempt: ReturnType<typeof vi.fn>
  readonly ackChannelEnvelope: ReturnType<typeof vi.fn>
}

/** Test-only issuer state, including the opaque leases minted for attached sockets. */
interface FakeActorProofIssuer {
  readonly issuer: ActivationActorProofIssuer
  readonly leases: readonly TeamActorProofLease[]
}

/** Create a test-only issuer that models runtime-only, revocable Link authority. */
function createActorProofIssuer(): FakeActorProofIssuer {
  const leases: TeamActorProofLease[] = []
  const issuer = Object.freeze({
    issue: (_binding: ActivationBindingSnapshot): TeamActorProofLease => {
      const proof = Object.freeze(Object.defineProperty({}, 'toJSON', {
        value: (): never => { throw new TypeError('test actor proofs are runtime-only') },
      })) as TeamActorProof
      const lease = Object.freeze({ proof, revoke: vi.fn() })
      leases.push(lease)
      return lease
    },
    close: vi.fn(),
  })
  return { issuer, leases }
}

interface FakeHarness {
  readonly teams: FakeTeams
  readonly actorProofIssuer: FakeActorProofIssuer
  readonly port: number
  readonly route: WebUpgradeRoute
  close(): Promise<void>
}

const binding = {
  activation: {
    id: 'activation-edge',
    teamId: 'team-edge',
    participantId: 'participant-edge',
    status: 'idle',
  },
  sessionId: 'session-edge',
  provider: 'edge-runtime',
} as unknown as ActivationBindingSnapshot

const envelope = teamEnvelopeSchema.parse({
  id: 'envelope-edge',
  teamId: binding.activation.teamId,
  channelId: 'channel-edge',
  sequence: 2,
  senderId: 'sender-edge',
  audience: [binding.activation.participantId],
  kind: 'message',
  payload: { text: 'pending edge delivery' },
  delivery: 'turn',
  priority: 'normal',
  createdAt: 1,
})

function interruptWith(id: string, overrides: Record<string, unknown> = {}) {
  return participantInterruptSnapshotSchema.parse({
    id,
    actorId: 'actor-edge',
    target: {
      teamId: binding.activation.teamId,
      participantId: binding.activation.participantId,
      activationId: binding.activation.id,
      sessionId: binding.sessionId,
      provider: binding.provider,
    },
    requestedAt: 1,
    ...overrides,
  })
}

const interrupt = interruptWith('interrupt-edge')

function config(overrides: Partial<WebSocketHub.Config> = {}): WebSocketHub.Config {
  return {
    path: '/team-link',
    endpoint: 'ws://127.0.0.1:1/team-link',
    enrollmentProviderName: 'websocket',
    bindings: [{
      capabilityEnv,
      activationId: binding.activation.id,
      teamId: binding.activation.teamId,
      participantId: binding.activation.participantId,
      sessionId: binding.sessionId,
      provider: binding.provider,
    }],
    pageSize: 1,
    maxFrameBytes: 4_096,
    maxConnections: 8,
    maxPendingRequests: 4,
    maxQueuedBytes: 8_192,
    maxOutstandingDeliveries: 4,
    requestWindowMs: 1_000,
    maxRequestsPerWindow: 8,
    closeTimeoutMs: 50,
    handshakeTimeoutMs: 100,
    heartbeatIntervalMs: 1_000,
    heartbeatTimeoutMs: 100,
    retryableNackDelayMs: 1,
    backpressureRetryAfterMs: 100,
    ...overrides,
  }
}

function teams(actorProofIssuer: FakeActorProofIssuer): FakeTeams {
  return {
    openActivationActorProofIssuer: vi.fn(() => actorProofIssuer.issuer),
    getActivation: vi.fn(async () => binding),
    getTeam: vi.fn(async () => ({ team: { cursor: 0 }, channelIds: [], tasks: [] })),
    getChannel: vi.fn(async () => ({
      phase: 'active',
      cursor: 0,
      manifest: {
        teamId: binding.activation.teamId,
        participants: [{ id: binding.activation.participantId }],
      },
    })),
    getChannelAdmission: vi.fn(async () => ({ invitations: [] })),
    listPendingParticipantInterrupts: vi.fn(async () => []),
    acknowledgeParticipantInterrupt: vi.fn(async () => ({})),
    watchTeam: vi.fn(async ({ signal }: { signal?: AbortSignal }) => await untilAbort(signal)),
    watchChannel: vi.fn(async ({ signal }: { signal?: AbortSignal }) => await untilAbort(signal)),
    listChannelPendingDeliveries: vi.fn(async () => ({
      channel: { manifest: { teamId: binding.activation.teamId }, cursor: 0 },
      deliveries: [],
      nextCursor: 0,
    })),
    postChannelEnvelope: vi.fn(async () => ({ accepted: true })),
    postChannelFinalEnvelope: vi.fn(async () => ({ accepted: true })),
    claimChannelDelivery: vi.fn(async () => undefined),
    claimTaskAttemptStart: vi.fn(async () => ({ phase: 'running' })),
    heartbeatTaskAttempt: vi.fn(async () => ({ phase: 'running' })),
    settleTaskAttempt: vi.fn(async () => ({ phase: 'completed' })),
    ackChannelEnvelope: vi.fn(async () => ({ type: 'channel/receipt' })),
  }
}

async function untilAbort(signal: AbortSignal | undefined): Promise<never> {
  return await new Promise<never>((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      const reason: unknown = signal.reason
      reject(reason instanceof Error ? reason : new Error('aborted'))
    }, { once: true })
  })
}

async function setup(overrides: Partial<WebSocketHub.Config> = {}): Promise<FakeHarness> {
  process.env[capabilityEnv] = capability
  let route: WebUpgradeRoute | undefined
  const effects: Array<() => unknown> = []
  const actorProofIssuer = createActorProofIssuer()
  const fakeTeams = teams(actorProofIssuer)
  const enrollmentProviders = new Map<string, unknown>()
  const ctx = {
    teams: fakeTeams,
    teamLinks: {
      registerEnrollmentProvider: vi.fn((provider: { readonly name: string }) => {
        enrollmentProviders.set(provider.name, provider)
        return () => { enrollmentProviders.delete(provider.name) }
      }),
    },
    webServer: {
      registerUpgrade: vi.fn((next: WebUpgradeRoute) => {
        route = next
        return () => { route = undefined }
      }),
    },
    storageLog: inMemoryStorageLog(),
    effect: vi.fn((install: () => unknown) => {
      const dispose: unknown = install()
      if (typeof dispose === 'function') effects.push(dispose as () => unknown)
      return dispose
    }),
  } as unknown as Context
  const lifecycle = WebSocketHub.apply(ctx, config(overrides))
  const iterator = lifecycle[Symbol.asyncIterator]()
  const first = await iterator.next()
  if (first.done || typeof first.value !== 'function') {
    throw new Error('WebSocket Hub did not register its lifecycle disposer')
  }
  effects.push(first.value)
  await iterator.next()
  if (route === undefined) throw new Error('WebSocket Hub did not register an upgrade route')
  const server = createServer()
  server.on('upgrade', (request, socket, head) => {
    if (route === undefined) {
      socket.destroy()
      return
    }
    void route.handler(request, socket, head)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const harness: FakeHarness = {
    teams: fakeTeams,
    actorProofIssuer,
    port: (server.address() as AddressInfo).port,
    route,
    async close() {
      for (const dispose of effects.toReversed()) await dispose()
      await closeServer(server)
    },
  }
  harnesses.add(harness)
  return harness
}

/** Provide the one durable log stream the WebSocket Hub ledger needs in fake edge contexts. */
function inMemoryStorageLog(): { open(descriptor: { readonly name: string; readonly version: number }): Promise<LogStream> } {
  const records: unknown[] = []
  return {
    async open(descriptor) {
      let closed = false
      return {
        name: descriptor.name,
        version: descriptor.version,
        get firstSequence() { return 0 },
        get tailSequence() { return records.length - 1 },
        async append(expectedSequence, values) {
          if (closed) throw new Error('fake enrollment stream is closed')
          if (expectedSequence !== records.length - 1) throw new Error('fake enrollment stream has a stale tail')
          records.push(...structuredClone(values))
          return { tailSequence: records.length - 1 }
        },
        async read(afterSequence, limit) {
          if (closed) throw new Error('fake enrollment stream is closed')
          return records.slice(afterSequence + 1, afterSequence + 1 + limit)
            .map((value, index) => ({ sequence: afterSequence + index + 1, value: structuredClone(value) }))
        },
        async readCheckpoint() { return undefined },
        async writeCheckpoint() {},
        async compact() {},
        async close() { closed = true },
      }
    },
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => { resolve() }))
}

async function socket(harness: FakeHarness): Promise<WebSocket> {
  const client = new WebSocket(`ws://127.0.0.1:${String(harness.port)}/team-link`)
  await once(client, 'open')
  return client
}

async function serverSocket(harness: FakeHarness): Promise<{
  readonly client: WebSocket
  readonly server: WebSocket
  readonly acceptor: WebSocketServer
}> {
  const accepted = Promise.withResolvers<WebSocket>()
  const acceptorKey = Symbol('acceptor')
  const original: unknown = Reflect.get(WebSocketServer.prototype, 'handleUpgrade')
  if (typeof original !== 'function') throw new Error('WebSocketServer has no handleUpgrade method')
  const spy = vi.spyOn(WebSocketServer.prototype, 'handleUpgrade').mockImplementation(function (this: WebSocketServer, request, raw, head, callback) {
    Reflect.apply(original, this, [request, raw, head, (websocket: WebSocket) => {
      Reflect.set(websocket, acceptorKey, this)
      accepted.resolve(websocket)
      callback(websocket, request)
    }])
  })
  try {
    const client = await socket(harness)
    const server = await accepted.promise
    const acceptor: unknown = Reflect.get(server, acceptorKey)
    if (!(acceptor instanceof WebSocketServer)) throw new Error('test Hub did not construct a WebSocket acceptor')
    return { client, server, acceptor }
  } finally {
    spy.mockRestore()
  }
}

async function frame(client: WebSocket) {
  return await new Promise<ReturnType<typeof parseTeamLinkServerFrame>>((resolve, reject) => {
    client.once('message', (data: WebSocket.RawData) => {
      try {
        resolve(parseTeamLinkServerFrame(JSON.parse(messageText(data)) as unknown))
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error('frame parser failed'))
      }
    })
    client.once('error', reject)
  })
}

function messageText(data: WebSocket.RawData): string {
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

function attach(client: WebSocket, id = 'attach'): void {
  client.send(JSON.stringify({
    v: TEAM_LINK_FRAME_VERSION,
    type: 'attach',
    id,
    binding: {
      activationId: binding.activation.id,
      teamId: binding.activation.teamId,
      participantId: binding.activation.participantId,
      sessionId: binding.sessionId,
      provider: binding.provider,
    },
    capability,
  }))
}

async function subscribe(client: WebSocket, frames: ReturnType<typeof frameQueue>, id = 'subscribe'): Promise<void> {
  client.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id }))
  await expect(frames.next(next => next.type === 'response' && next.id === id)).resolves.toMatchObject({
    ok: true,
    result: { subscribed: true },
  })
}

function post(client: WebSocket, id: string): void {
  client.send(JSON.stringify({
    v: TEAM_LINK_FRAME_VERSION,
    type: 'request',
    id,
    op: 'post',
    input: {
      expectedCursor: 0,
      idempotencyKey: `post-${id}`,
      draft: {
        channelId: 'channel-edge',
        audience: ['sender-edge'],
        kind: 'message',
        payload: { text: 'edge post' },
        delivery: 'turn',
      },
    },
  }))
}

function closed(client: WebSocket): Promise<[number, Buffer]> {
  return once(client, 'close') as Promise<[number, Buffer]>
}

function frameQueue(client: WebSocket): {
  next(predicate: (next: ReturnType<typeof parseTeamLinkServerFrame>) => boolean): Promise<ReturnType<typeof parseTeamLinkServerFrame>>
} {
  const frames: ReturnType<typeof parseTeamLinkServerFrame>[] = []
  const waiters = new Set<{
    readonly predicate: (next: ReturnType<typeof parseTeamLinkServerFrame>) => boolean
    readonly resolve: (next: ReturnType<typeof parseTeamLinkServerFrame>) => void
    readonly reject: (error: Error) => void
  }>()
  client.on('message', (data: WebSocket.RawData) => {
    try {
      const next = parseTeamLinkServerFrame(JSON.parse(messageText(data)) as unknown)
      for (const waiter of waiters) {
        if (!waiter.predicate(next)) continue
        waiters.delete(waiter)
        waiter.resolve(next)
        return
      }
      frames.push(next)
    } catch (error: unknown) {
      const failure = error instanceof Error ? error : new Error('frame parser failed')
      for (const waiter of waiters) waiter.reject(failure)
      waiters.clear()
    }
  })
  return {
    next(predicate) {
      const index = frames.findIndex(predicate)
      if (index >= 0) return Promise.resolve(frames.splice(index, 1)[0] as ReturnType<typeof parseTeamLinkServerFrame>)
      return new Promise((resolve, reject) => { waiters.add({ predicate, resolve, reject }) })
    },
  }
}

describe('WebSocket Team Link Hub protocol edges', () => {
  it('rejects invalid configuration before registering an upgrade route', () => {
    process.env[capabilityEnv] = capability
    const registerUpgrade = vi.fn()
    const ctx = {
      webServer: { registerUpgrade },
      effect: vi.fn(),
      teams: teams(createActorProofIssuer()),
      teamLinks: { registerEnrollmentProvider: vi.fn(() => () => {}) },
    } as unknown as Context
    expect(() => { WebSocketHub.apply(ctx, config({ path: '/team-link/' })) }).toThrow(/exact absolute pathname/)
    expect(() => { WebSocketHub.apply(ctx, config({ endpoint: 'https://example.test/team-link' })) }).toThrow(/ws: or wss/)
    expect(() => { WebSocketHub.apply(ctx, config({ maxQueuedBytes: 1 })) }).toThrow(/cover maxFrameBytes/)
    expect(() => { WebSocketHub.apply(ctx, config({ maxFrameBytes: 0 })) }).toThrow(/positive safe integer/)
    expect(() => { WebSocketHub.apply(ctx, config({ maxConnections: 0 })) }).toThrow(/positive safe integer/)
    expect(() => { WebSocketHub.apply(ctx, config({ retryableNackDelayMs: 0 })) }).toThrow(/Node timer range/)
    expect(() => { WebSocketHub.apply(ctx, config({ handshakeTimeoutMs: 0 })) }).toThrow(/Node timer range/)
    expect(() => { WebSocketHub.apply(ctx, config({ heartbeatTimeoutMs: 1_000 })) }).toThrow(/less than heartbeatIntervalMs/)
    expect(() => { WebSocketHub.apply(ctx, config({ backpressureRetryAfterMs: 2_147_483_648 })) }).toThrow(/Node timer range/)
    expect(() => { WebSocketHub.apply(ctx, config({ bindings: [{ ...config().bindings[0]!, capabilityEnv: '1INVALID' }] })) })
      .toThrow(/environment-variable name/)
    process.env.CLOCKY_TEAM_LINK_WEBSOCKET_HUB_EDGE_SECOND = 'second-capability'
    const first = config().bindings[0]!
    expect(() => {
      WebSocketHub.apply(ctx, config({ bindings: [first, { ...first, participantId: 'second-participant' }] }))
    }).toThrow(/capabilityEnv must identify one binding/)
    expect(() => {
      WebSocketHub.apply(ctx, config({ bindings: [first, {
        ...first,
        capabilityEnv: 'CLOCKY_TEAM_LINK_WEBSOCKET_HUB_EDGE_SECOND',
      }] }))
    }).toThrow(/binding identity must be unique/)
    Reflect.deleteProperty(process.env, 'CLOCKY_TEAM_LINK_WEBSOCKET_HUB_EDGE_SECOND')
    Reflect.deleteProperty(process.env, capabilityEnv)
    expect(() => { WebSocketHub.apply(ctx, config()) }).toThrow(/environment variable is unavailable/)
    expect(registerUpgrade).not.toHaveBeenCalled()
  })

  it('contains native acceptor errors and accepts every text payload carrier', async () => {
    const harness = await setup()
    const connection = await serverSocket(harness)
    const destroyed = vi.fn()
    connection.acceptor.emit('error', new Error('acceptor error'))
    connection.acceptor.emit('wsClientError', new Error('client error'), { destroy: destroyed })
    expect(destroyed).toHaveBeenCalledOnce()
    const listener = connection.server.listeners('message')[0] as ((data: WebSocket.RawData, isBinary: boolean) => void) | undefined
    if (listener === undefined) throw new Error('server socket has no protocol listener')

    const attached = frame(connection.client)
    listener([Buffer.from(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'attach',
      id: 'fragmented-attach',
      binding: {
        activationId: binding.activation.id,
        teamId: binding.activation.teamId,
        participantId: binding.activation.participantId,
        sessionId: binding.sessionId,
        provider: binding.provider,
      },
      capability,
    }))], false)
    await expect(attached).resolves.toMatchObject({ type: 'attached', id: 'fragmented-attach' })

    const subscribed = frame(connection.client)
    const payload = Buffer.from(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'array-buffer-subscribe' }))
    listener(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength), false)
    await expect(subscribed).resolves.toMatchObject({ id: 'array-buffer-subscribe', ok: true })

    const stringFrame = frame(connection.client)
    Reflect.apply(listener, undefined, [JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'repeat-subscribe' }), false])
    await expect(stringFrame).resolves.toMatchObject({ id: 'repeat-subscribe', ok: false, error: { code: 'invalid-state' } })
    connection.server.emit('error', new Error('socket error'))
    connection.client.close()

    const oversizedHarness = await setup()
    const oversized = await serverSocket(oversizedHarness)
    const oversizedListener = oversized.server.listeners('message')[0] as ((data: WebSocket.RawData, isBinary: boolean) => void) | undefined
    if (oversizedListener === undefined) throw new Error('server socket has no protocol listener')
    const closedSocket = closed(oversized.client)
    oversizedListener(Buffer.alloc(4_097), false)
    await expect(closedSocket).resolves.toEqual([1009, Buffer.from('frame too large')])
  })

  it('rejects retained upgrades after the Hub closes and makes close idempotent', async () => {
    const harness = await setup()
    const retained = harness.route
    await harness.close()
    await harness.close()
    const raw = { destroy: vi.fn() }
    void retained.handler({} as never, raw as never, Buffer.alloc(0))
    expect(raw.destroy).toHaveBeenCalledOnce()
  })

  it('bounds pre-authenticated sockets and expires an attached client that never subscribes', async () => {
    const saturation = await setup({ maxConnections: 1 })
    const first = await socket(saturation)
    const rejected = new WebSocket(`ws://127.0.0.1:${String(saturation.port)}/team-link`)
    const rejectedOutcome = Promise.race([
      once(rejected, 'error').then(() => 'error' as const),
      once(rejected, 'close').then(() => 'closed' as const),
    ])
    await expect(rejectedOutcome).resolves.toMatch(/error|closed/u)
    const firstClosed = closed(first)
    first.close()
    await firstClosed
    const replacement = await socket(saturation)
    replacement.close()

    const handshake = await setup({ handshakeTimeoutMs: 10 })
    const client = await socket(handshake)
    attach(client)
    await expect(frame(client)).resolves.toMatchObject({ type: 'attached' })
    await expect(closed(client)).resolves.toEqual([1008, Buffer.from('handshake timeout')])
    const replacementAfterTimeout = await socket(handshake)
    replacementAfterTimeout.close()
  })

  it('replays exact-target interrupt commands after v4 subscription and persists idempotent acknowledgements', async () => {
    const harness = await setup()
    harness.teams.listPendingParticipantInterrupts.mockResolvedValueOnce([interrupt])
    harness.teams.acknowledgeParticipantInterrupt.mockResolvedValue({ ...interrupt, acknowledgedAt: 2 })
    const client = await socket(harness)
    const frames = frameQueue(client)
    attach(client)
    await expect(frames.next(next => next.type === 'attached')).resolves.toMatchObject({ type: 'attached' })
    const [actorLease] = harness.actorProofIssuer.leases
    if (actorLease === undefined) throw new Error('WebSocket Link did not retain an actor proof lease')
    expect(harness.teams.listPendingParticipantInterrupts).not.toHaveBeenCalled()
    await subscribe(client, frames)
    const delivered = await frames.next(next => next.type === 'interrupt')
    if (delivered.type !== 'interrupt') throw new Error('expected interrupt delivery')
    expect(delivered.interrupt).toEqual(interrupt)
    expect(harness.teams.listPendingParticipantInterrupts).toHaveBeenCalledWith({ actor: actorLease.proof })
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'interrupt-ack',
      op: 'interrupt-ack',
      input: { deliveryId: delivered.deliveryId, interruptId: interrupt.id },
    }))
    await expect(frames.next(next => next.type === 'response' && next.id === 'interrupt-ack')).resolves.toMatchObject({
      ok: true,
      result: { id: interrupt.id, acknowledgedAt: 2 },
    })
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'interrupt-ack-repeat',
      op: 'interrupt-ack',
      input: { deliveryId: delivered.deliveryId, interruptId: interrupt.id },
    }))
    await expect(frames.next(next => next.type === 'response' && next.id === 'interrupt-ack-repeat')).resolves.toMatchObject({
      ok: true,
      result: { id: interrupt.id, acknowledgedAt: 2 },
    })
    expect(harness.teams.acknowledgeParticipantInterrupt).toHaveBeenNthCalledWith(1, {
      actor: actorLease.proof,
      interruptId: interrupt.id,
    })
    expect(harness.teams.acknowledgeParticipantInterrupt).toHaveBeenCalledTimes(2)
    client.close()
  })

  it('replays an interrupt wake that arrives while its preceding durable read is pending', async () => {
    const second = interruptWith('interrupt-during-replay')
    const firstList = Promise.withResolvers<readonly unknown[]>()
    const changed = Promise.withResolvers<{ readonly kind: 'changed'; readonly cursor: number }>()
    const harness = await setup()
    harness.teams.listPendingParticipantInterrupts
      .mockReturnValueOnce(firstList.promise)
      .mockResolvedValue([second])
    harness.teams.watchTeam.mockReturnValueOnce(changed.promise)
    const client = await socket(harness)
    const frames = frameQueue(client)
    attach(client)
    await frames.next(next => next.type === 'attached')
    await subscribe(client, frames, 'interrupt-race-subscribe')
    await vi.waitFor(() => { expect(harness.teams.listPendingParticipantInterrupts).toHaveBeenCalledTimes(1) })

    changed.resolve({ kind: 'changed', cursor: 1 })
    await vi.waitFor(() => { expect(harness.teams.watchTeam).toHaveBeenCalledTimes(2) })
    firstList.resolve([])

    await expect(frames.next(next => next.type === 'interrupt')).resolves.toMatchObject({
      interrupt: { id: second.id },
    })
    await vi.waitFor(() => { expect(harness.teams.listPendingParticipantInterrupts).toHaveBeenCalledTimes(2) })
    client.close()
  })

  it('closes a subscription when the Team watch repeats its cursor', async () => {
    const harness = await setup()
    harness.teams.watchTeam.mockResolvedValueOnce({ kind: 'changed', cursor: 0 })
    const client = await socket(harness)
    const frames = frameQueue(client)
    attach(client)
    await frames.next(next => next.type === 'attached')
    await subscribe(client, frames, 'repeated-team-watch-subscribe')
    await expect(closed(client)).resolves.toEqual([1011, Buffer.from('server failure')])
  })

  it('rejects v1 and peer-issued interrupt requests without invoking Team interruption authority', async () => {
    const v1Harness = await setup()
    const v1 = await socket(v1Harness)
    const v1Closed = closed(v1)
    v1.send(JSON.stringify({
      v: 1,
      type: 'attach',
      id: 'v1-attach',
      binding: {
        activationId: binding.activation.id,
        teamId: binding.activation.teamId,
        participantId: binding.activation.participantId,
        sessionId: binding.sessionId,
        provider: binding.provider,
      },
      capability,
    }))
    await expect(v1Closed).resolves.toEqual([1008, Buffer.from('invalid frame')])

    const harness = await setup()
    const client = await socket(harness)
    attach(client)
    await frame(client)
    const closedClient = closed(client)
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'peer-interrupt',
      op: 'interrupt',
      input: {},
    }))
    await expect(closedClient).resolves.toEqual([1008, Buffer.from('invalid frame')])
    expect(harness.teams.acknowledgeParticipantInterrupt).not.toHaveBeenCalled()
  })

  it('rejects malformed direct-final input without invoking Team final admission', async () => {
    const harness = await setup()
    const client = await socket(harness)
    attach(client)
    await frame(client)
    const response = frame(client)
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'malformed-direct-final',
      op: 'final-result',
      input: { channelId: '', idempotencyKey: 'final', text: '' },
    }))
    await expect(response).resolves.toMatchObject({
      id: 'malformed-direct-final', ok: false, error: { code: 'invalid-request' },
    })
    expect(harness.teams.postChannelFinalEnvelope).not.toHaveBeenCalled()
    client.close()
  })

  it('does not acknowledge an unknown or foreign-target interrupt delivery', async () => {
    const unknownHarness = await setup()
    const unknownClient = await socket(unknownHarness)
    attach(unknownClient)
    await frame(unknownClient)
    unknownClient.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'unknown-interrupt',
      op: 'interrupt-ack',
      input: { deliveryId: 'unknown-delivery', interruptId: interrupt.id },
    }))
    await expect(frame(unknownClient)).resolves.toMatchObject({
      id: 'unknown-interrupt', ok: false, error: { code: 'invalid-request' },
    })
    expect(unknownHarness.teams.acknowledgeParticipantInterrupt).not.toHaveBeenCalled()
    unknownClient.close()

    const foreignHarness = await setup()
    foreignHarness.teams.listPendingParticipantInterrupts.mockResolvedValueOnce([{
      ...interrupt,
      target: { ...interrupt.target, sessionId: 'other-session' },
    }])
    const foreignClient = await socket(foreignHarness)
    const foreignFrames = frameQueue(foreignClient)
    attach(foreignClient)
    await foreignFrames.next(next => next.type === 'attached')
    const foreignClosed = closed(foreignClient)
    foreignClient.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'foreign-subscribe' }))
    await expect(foreignClosed).resolves.toEqual([1011, Buffer.from('server failure')])
  })

  it('deduplicates interrupt replay and bounds a slow interrupt consumer', async () => {
    const first = interruptWith('interrupt-first')
    const second = interruptWith('interrupt-second')
    const harness = await setup({ maxOutstandingDeliveries: 1 })
    harness.teams.listPendingParticipantInterrupts.mockResolvedValueOnce([first, first, second])
    const client = await socket(harness)
    const frames = frameQueue(client)
    const slow = closed(client)
    attach(client)
    await frames.next(next => next.type === 'attached')
    await subscribe(client, frames)
    await expect(frames.next(next => next.type === 'interrupt')).resolves.toMatchObject({
      interrupt: { id: first.id },
    })
    await expect(slow).resolves.toEqual([1008, Buffer.from('slow consumer')])
  })

  it('shares one retained-delivery cap between Envelope and interrupt replays', async () => {
    const pendingInterrupts = Promise.withResolvers<readonly unknown[]>()
    const harness = await setup({ maxOutstandingDeliveries: 1 })
    harness.teams.getTeam.mockResolvedValueOnce({ team: { cursor: 0 }, channelIds: ['channel-edge'], tasks: [] })
    harness.teams.watchTeam.mockResolvedValueOnce({ kind: 'closed' })
    harness.teams.watchChannel.mockResolvedValueOnce({ kind: 'closed' })
    harness.teams.listChannelPendingDeliveries.mockResolvedValueOnce({
      channel: { manifest: { teamId: binding.activation.teamId }, cursor: 2 },
      deliveries: [{ envelope }],
      nextCursor: 2,
    })
    harness.teams.listPendingParticipantInterrupts.mockReturnValueOnce(pendingInterrupts.promise)
    const client = await socket(harness)
    const frames = frameQueue(client)
    const slow = closed(client)
    attach(client)
    await frames.next(next => next.type === 'attached')
    await subscribe(client, frames)
    await vi.waitFor(() => { expect(harness.teams.listPendingParticipantInterrupts).toHaveBeenCalledOnce() })
    await expect(frames.next(next => next.type === 'notify')).resolves.toMatchObject({ type: 'notify' })
    pendingInterrupts.resolve([interrupt])
    await expect(slow).resolves.toEqual([1008, Buffer.from('slow consumer')])
  })

  it('evicts cached interrupt acknowledgements before Envelope replays under the shared delivery cap', async () => {
    const pendingPage = Promise.withResolvers<unknown>()
    const first = interruptWith('interrupt-cached-before-envelope')
    const harness = await setup({ maxOutstandingDeliveries: 1 })
    harness.teams.getTeam.mockResolvedValueOnce({ team: { cursor: 0 }, channelIds: ['channel-edge'], tasks: [] })
    harness.teams.watchTeam.mockResolvedValueOnce({ kind: 'closed' })
    harness.teams.watchChannel.mockResolvedValueOnce({ kind: 'closed' })
    harness.teams.listPendingParticipantInterrupts.mockResolvedValueOnce([first])
    harness.teams.listChannelPendingDeliveries.mockReturnValueOnce(pendingPage.promise)
    harness.teams.acknowledgeParticipantInterrupt.mockResolvedValueOnce({ ...first, acknowledgedAt: 2 })
    const client = await socket(harness)
    const frames = frameQueue(client)
    attach(client)
    await frames.next(next => next.type === 'attached')
    await subscribe(client, frames)
    const delivered = await frames.next(next => next.type === 'interrupt')
    if (delivered.type !== 'interrupt') throw new Error('expected interrupt delivery')
    await vi.waitFor(() => { expect(harness.teams.listChannelPendingDeliveries).toHaveBeenCalledOnce() })
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'cache-interrupt-ack',
      op: 'interrupt-ack',
      input: { deliveryId: delivered.deliveryId, interruptId: first.id },
    }))
    await expect(frames.next(next => next.type === 'response' && next.id === 'cache-interrupt-ack')).resolves.toMatchObject({ ok: true })
    pendingPage.resolve({
      channel: { manifest: { teamId: binding.activation.teamId }, cursor: 2 },
      deliveries: [{ envelope }],
      nextCursor: 2,
    })
    await expect(frames.next(next => next.type === 'notify')).resolves.toMatchObject({ type: 'notify' })
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'evicted-interrupt-ack',
      op: 'interrupt-ack',
      input: { deliveryId: delivered.deliveryId, interruptId: first.id },
    }))
    await expect(frames.next(next => next.type === 'response' && next.id === 'evicted-interrupt-ack')).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    })
    client.close()
  })

  it('clears a failed interrupt send and rejects a malformed durable acknowledgement', async () => {
    const oversized = interruptWith('interrupt-oversized', { actorId: 'x'.repeat(2_000) })
    const oversizedHarness = await setup({ maxFrameBytes: 512, maxQueuedBytes: 1_024 })
    oversizedHarness.teams.listPendingParticipantInterrupts.mockResolvedValueOnce([oversized])
    const oversizedClient = await socket(oversizedHarness)
    const oversizedFrames = frameQueue(oversizedClient)
    const oversizedClosed = closed(oversizedClient)
    attach(oversizedClient)
    await oversizedFrames.next(next => next.type === 'attached')
    oversizedClient.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'oversized-subscribe' }))
    await expect(oversizedClosed).resolves.toEqual([1009, Buffer.from('frame too large')])

    const malformedHarness = await setup()
    malformedHarness.teams.listPendingParticipantInterrupts.mockResolvedValueOnce([interrupt])
    malformedHarness.teams.acknowledgeParticipantInterrupt.mockResolvedValueOnce({
      ...interrupt,
      target: { ...interrupt.target, provider: 'wrong-provider' },
      acknowledgedAt: 2,
    })
    const malformedClient = await socket(malformedHarness)
    const frames = frameQueue(malformedClient)
    attach(malformedClient)
    await frames.next(next => next.type === 'attached')
    await subscribe(malformedClient, frames)
    const delivered = await frames.next(next => next.type === 'interrupt')
    if (delivered.type !== 'interrupt') throw new Error('expected interrupt delivery')
    malformedClient.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'malformed-ack',
      op: 'interrupt-ack',
      input: { deliveryId: delivered.deliveryId, interruptId: interrupt.id },
    }))
    await expect(frames.next(next => next.type === 'response' && next.id === 'malformed-ack')).resolves.toMatchObject({
      ok: false,
      error: { code: 'rejected' },
    })
    malformedClient.close()
  })

  it('evicts retained idempotent interrupt acknowledgements before a new interrupt replay', async () => {
    const first = interruptWith('interrupt-retained-first')
    const second = interruptWith('interrupt-retained-second')
    const harness = await setup({ maxOutstandingDeliveries: 1 })
    harness.teams.listPendingParticipantInterrupts
      .mockResolvedValueOnce([first])
      .mockResolvedValue([second])
    harness.teams.acknowledgeParticipantInterrupt
      .mockResolvedValueOnce({ ...first, acknowledgedAt: 2 })
      .mockResolvedValue({ ...second, acknowledgedAt: 2 })
    const changed = Promise.withResolvers<{ readonly kind: 'changed'; readonly cursor: number }>()
    harness.teams.watchTeam.mockReturnValueOnce(changed.promise)
    const client = await socket(harness)
    const frames = frameQueue(client)
    attach(client)
    await frames.next(next => next.type === 'attached')
    await subscribe(client, frames, 'interrupt-subscribe')
    const firstDelivery = await frames.next(next => next.type === 'interrupt')
    if (firstDelivery.type !== 'interrupt') throw new Error('expected first interrupt')
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'first-ack',
      op: 'interrupt-ack',
      input: { deliveryId: firstDelivery.deliveryId, interruptId: first.id },
    }))
    await frames.next(next => next.type === 'response' && next.id === 'first-ack')
    changed.resolve({ kind: 'changed', cursor: 1 })
    const secondDelivery = await frames.next(next => next.type === 'interrupt' && next.interrupt.id === second.id)
    if (secondDelivery.type !== 'interrupt') throw new Error('expected second interrupt')
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'evicted-first-ack',
      op: 'interrupt-ack',
      input: { deliveryId: firstDelivery.deliveryId, interruptId: first.id },
    }))
    await expect(frames.next(next => next.type === 'response' && next.id === 'evicted-first-ack')).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    })
    client.close()
  })

  it('contains a close race during upgrade and destroys a raw upgrade failure', async () => {
    const raceHarness = await setup()
    const terminated = vi.fn()
    const race = vi.spyOn(WebSocketServer.prototype, 'handleUpgrade').mockImplementation(function (_request, _raw, _head, callback) {
      void raceHarness.close()
      callback({ terminate: terminated }, {})
    })
    try {
      void raceHarness.route.handler({} as never, {} as never, Buffer.alloc(0))
      await vi.waitFor(() => { expect(terminated).toHaveBeenCalledOnce() })
    } finally {
      race.mockRestore()
    }

    const failedHarness = await setup()
    const raw = { destroy: vi.fn() }
    const failure = vi.spyOn(WebSocketServer.prototype, 'handleUpgrade').mockImplementation(() => {
      throw new Error('upgrade failed')
    })
    try {
      void failedHarness.route.handler({} as never, raw as never, Buffer.alloc(0))
      expect(raw.destroy).toHaveBeenCalledOnce()
    } finally {
      failure.mockRestore()
    }
  })

  it('closes preflight, queued, callback, throw, and timeout outbound socket failures', async () => {
    const preflightHarness = await setup()
    const preflight = await serverSocket(preflightHarness)
    attach(preflight.client)
    await frame(preflight.client)
    Object.defineProperty(preflight.server, 'bufferedAmount', { configurable: true, get: () => 8_192 })
    const preflightClosed = closed(preflight.client)
    preflight.client.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'preflight' }))
    await expect(preflightClosed).resolves.toEqual([1008, Buffer.from('slow consumer')])

    const queuedHarness = await setup()
    const queued = await serverSocket(queuedHarness)
    attach(queued.client)
    await frame(queued.client)
    let reads = 0
    Object.defineProperty(queued.server, 'bufferedAmount', {
      configurable: true,
      get: () => {
        reads += 1
        return reads === 1 ? 0 : 8_192
      },
    })
    const queuedClosed = closed(queued.client)
    queued.client.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'queued-buffer' }))
    await expect(queuedClosed).resolves.toEqual([1008, Buffer.from('slow consumer')])

    const callbackHarness = await setup()
    const callback = await serverSocket(callbackHarness)
    attach(callback.client)
    await frame(callback.client)
    Object.defineProperty(callback.server, 'send', {
      configurable: true,
      value: (_frame: unknown, done: (error: Error) => void) => { done(new Error('send callback failed')) },
    })
    const callbackClosed = closed(callback.client)
    callback.client.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'callback-error' }))
    await expect(callbackClosed).resolves.toEqual([1011, Buffer.from('server failure')])

    const throwingHarness = await setup()
    const throwing = await serverSocket(throwingHarness)
    attach(throwing.client)
    await frame(throwing.client)
    const throwingListener = throwing.server.listeners('message')[0] as ((data: WebSocket.RawData, isBinary: boolean) => void) | undefined
    if (throwingListener === undefined) throw new Error('server socket has no protocol listener')
    const terminated = vi.spyOn(throwing.server, 'terminate')
    Object.defineProperty(throwing.server, 'close', { configurable: true, value: () => { throw new Error('close failed') } })
    const throwingClosed = closed(throwing.client)
    throwingListener(Buffer.from('binary'), true)
    await expect(throwingClosed).resolves.toEqual([1006, Buffer.alloc(0)])
    expect(terminated).toHaveBeenCalled()

    const timeoutHarness = await setup({ closeTimeoutMs: 1 })
    const timeout = await serverSocket(timeoutHarness)
    attach(timeout.client)
    await frame(timeout.client)
    const timeoutListener = timeout.server.listeners('message')[0] as ((data: WebSocket.RawData, isBinary: boolean) => void) | undefined
    if (timeoutListener === undefined) throw new Error('server socket has no protocol listener')
    const timeoutTerminate = vi.spyOn(timeout.server, 'terminate')
    Object.defineProperty(timeout.server, 'close', { configurable: true, value: () => {} })
    const timeoutClosed = closed(timeout.client)
    timeoutListener(Buffer.from('binary'), true)
    await expect(timeoutClosed).resolves.toEqual([1006, Buffer.alloc(0)])
    expect(timeoutTerminate).toHaveBeenCalled()
  })

  it('requires attach before operation frames and rejects duplicate lifecycle requests', async () => {
    const harness = await setup()
    const client = await socket(harness)
    client.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'early' }))
    await expect(frame(client)).resolves.toMatchObject({ id: 'early', ok: false, error: { code: 'unauthorized' } })
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'early-request',
      op: 'claim',
      input: { channelId: 'channel-edge', envelopeId: 'envelope-edge' },
    }))
    await expect(frame(client)).resolves.toMatchObject({ id: 'early-request', ok: false, error: { code: 'unauthorized' } })
    attach(client)
    await expect(frame(client)).resolves.toMatchObject({ type: 'attached', id: 'attach' })
    attach(client, 'attach-again')
    await expect(frame(client)).resolves.toMatchObject({ id: 'attach-again', ok: false, error: { code: 'invalid-state' } })
    client.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'subscribe' }))
    await expect(frame(client)).resolves.toMatchObject({ id: 'subscribe', ok: true })
    client.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'subscribe-again' }))
    await expect(frame(client)).resolves.toMatchObject({ id: 'subscribe-again', ok: false, error: { code: 'invalid-state' } })
    client.close()
  })

  it('returns operation validation failures and null missing claims without accepting client authority', async () => {
    const harness = await setup()
    const client = await socket(harness)
    attach(client)
    await frame(client)
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'invalid',
      op: 'claim',
      input: { channelId: 'channel-edge', envelopeId: 'envelope-edge', participantId: 'spoof' },
    }))
    await expect(frame(client)).resolves.toMatchObject({ id: 'invalid', ok: false, error: { code: 'invalid-request' } })
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'empty-claim',
      op: 'claim',
      input: { channelId: 'channel-edge', envelopeId: 'envelope-edge' },
    }))
    await expect(frame(client)).resolves.toEqual({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'response',
      id: 'empty-claim',
      ok: true,
      result: null,
    })
    const [actorLease] = harness.actorProofIssuer.leases
    if (actorLease === undefined) throw new Error('WebSocket Link did not retain an actor proof lease')
    expect(harness.teams.claimChannelDelivery).toHaveBeenCalledWith({
      actor: actorLease.proof,
      channelId: 'channel-edge',
      envelopeId: 'envelope-edge',
    })
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'task-start',
      op: 'task-start',
      input: {
        taskId: 'task-edge',
        attemptId: 'attempt-edge',
        assignedRevision: 1,
        channelId: 'channel-edge',
        envelopeId: 'envelope-edge',
      },
    }))
    await expect(frame(client)).resolves.toMatchObject({
      id: 'task-start', ok: true, result: { phase: 'running' },
    })
    expect(harness.teams.claimTaskAttemptStart).toHaveBeenCalledWith({
      actor: actorLease.proof,
      taskId: 'task-edge',
      attemptId: 'attempt-edge',
      assignedRevision: 1,
      channelId: 'channel-edge',
      envelopeId: 'envelope-edge',
    })
    client.close()
  })

  it('forwards proof-only task heartbeat and settlement while rejecting wire identity fields', async () => {
    const harness = await setup()
    const client = await socket(harness)
    attach(client)
    await frame(client)
    const [actorLease] = harness.actorProofIssuer.leases
    if (actorLease === undefined) throw new Error('WebSocket Link did not retain an actor proof lease')

    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'task-heartbeat',
      op: 'task-heartbeat',
      input: { taskId: 'task-edge', attemptId: 'attempt-edge', expectedRevision: 1 },
    }))
    await expect(frame(client)).resolves.toMatchObject({
      id: 'task-heartbeat', ok: true, result: { phase: 'running' },
    })
    expect(harness.teams.heartbeatTaskAttempt).toHaveBeenCalledWith({
      actor: actorLease.proof,
      taskId: 'task-edge',
      attemptId: 'attempt-edge',
      expectedRevision: 1,
    })

    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'task-settle',
      op: 'task-settle',
      input: {
        taskId: 'task-edge',
        attemptId: 'attempt-edge',
        expectedRevision: 1,
        outcome: { kind: 'completed', result: { summary: 'edge work complete' } },
      },
    }))
    await expect(frame(client)).resolves.toMatchObject({
      id: 'task-settle', ok: true, result: { phase: 'completed' },
    })
    expect(harness.teams.settleTaskAttempt).toHaveBeenCalledWith({
      actor: actorLease.proof,
      taskId: 'task-edge',
      attemptId: 'attempt-edge',
      expectedRevision: 1,
      outcome: { kind: 'completed', result: { summary: 'edge work complete' } },
    })

    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'spoof-task-owner',
      op: 'task-heartbeat',
      input: {
        taskId: 'task-edge',
        attemptId: 'attempt-edge',
        expectedRevision: 1,
        teamId: 'spoofed-team',
        participantId: 'spoofed-participant',
        activationId: 'spoofed-activation',
      },
    }))
    await expect(frame(client)).resolves.toMatchObject({
      id: 'spoof-task-owner', ok: false, error: { code: 'invalid-request' },
    })
    expect(harness.teams.heartbeatTaskAttempt).toHaveBeenCalledTimes(1)
    client.close()
  })

  it('maps Team operation failures to sanitized conflict, backpressure, and rejected responses', async () => {
    const harness = await setup({ backpressureRetryAfterMs: 37 })
    const client = await socket(harness)
    attach(client)
    await frame(client)
    const [actorLease] = harness.actorProofIssuer.leases
    if (actorLease === undefined) throw new Error('WebSocket Link did not retain an actor proof lease')
    harness.teams.postChannelEnvelope
      .mockRejectedValueOnce(new TeamError('cursor', 'TEAM_CURSOR_CONFLICT'))
      .mockRejectedValueOnce(new TeamError('full', 'TEAM_CHANNEL_BACKPRESSURE'))
      .mockRejectedValueOnce(new TeamError('denied', 'TEAM_POLICY_DENIED'))
      .mockRejectedValueOnce(new TeamError('key', 'TEAM_CHANNEL_IDEMPOTENCY_CONFLICT'))
    post(client, 'conflict')
    await expect(frame(client)).resolves.toMatchObject({ id: 'conflict', ok: false, error: { code: 'conflict' } })
    expect(harness.teams.postChannelEnvelope).toHaveBeenNthCalledWith(1, {
      actor: actorLease.proof,
      expectedCursor: 0,
      idempotencyKey: 'post-conflict',
      draft: {
        channelId: 'channel-edge',
        audience: ['sender-edge'],
        kind: 'message',
        payload: { text: 'edge post' },
        delivery: 'turn',
      },
    })
    post(client, 'backpressure')
    await expect(frame(client)).resolves.toMatchObject({
      id: 'backpressure', ok: false, error: { code: 'backpressure', retryAfterMs: 37 },
    })
    post(client, 'rejected')
    await expect(frame(client)).resolves.toMatchObject({ id: 'rejected', ok: false, error: { code: 'rejected' } })
    post(client, 'idempotency')
    await expect(frame(client)).resolves.toMatchObject({ id: 'idempotency', ok: false, error: { code: 'conflict' } })
    client.close()
  })

  it('derives receipt authority from its private lease and rejects wire identity fields', async () => {
    const receiptHarness = await setup()
    const receiptClient = await socket(receiptHarness)
    attach(receiptClient)
    await frame(receiptClient)
    const [actorLease] = receiptHarness.actorProofIssuer.leases
    if (actorLease === undefined) throw new Error('WebSocket Link did not retain an actor proof lease')
    receiptClient.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'receipt',
      op: 'receipt',
      input: { channelId: 'channel-edge', envelopeId: 'envelope-edge', expectedCursor: 0 },
    }))
    await expect(frame(receiptClient)).resolves.toMatchObject({ id: 'receipt', ok: true })
    expect(receiptHarness.teams.ackChannelEnvelope).toHaveBeenCalledWith({
      actor: actorLease.proof,
      channelId: 'channel-edge',
      envelopeId: 'envelope-edge',
      expectedCursor: 0,
    })
    receiptClient.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'spoof-receipt-identity',
      op: 'receipt',
      input: {
        channelId: 'channel-edge',
        envelopeId: 'envelope-edge',
        expectedCursor: 0,
        actor: {},
        participantId: 'spoofed-participant',
        activationId: 'spoofed-activation',
        sessionId: 'spoofed-session',
      },
    }))
    await expect(frame(receiptClient)).resolves.toMatchObject({
      id: 'spoof-receipt-identity', ok: false, error: { code: 'invalid-request' },
    })
    expect(receiptHarness.teams.ackChannelEnvelope).toHaveBeenCalledTimes(1)
    receiptClient.close()
  })

  it('closes oversized outbound notifications', async () => {
    const oversizedHarness = await setup({ maxFrameBytes: 512, maxQueuedBytes: 1_024 })
    oversizedHarness.teams.getTeam.mockResolvedValueOnce({ team: { cursor: 0 }, channelIds: ['channel-edge'], tasks: [] })
    oversizedHarness.teams.watchTeam.mockResolvedValueOnce({ kind: 'closed' })
    oversizedHarness.teams.watchChannel.mockResolvedValueOnce({ kind: 'closed' })
    oversizedHarness.teams.listChannelPendingDeliveries.mockResolvedValueOnce({
      channel: { manifest: { teamId: binding.activation.teamId }, cursor: 2 },
      deliveries: [{ envelope: { ...envelope, payload: { text: 'x'.repeat(2_000) } } }],
      nextCursor: 2,
    })
    const oversizedClient = await socket(oversizedHarness)
    attach(oversizedClient)
    await frame(oversizedClient)
    const oversizedClosed = closed(oversizedClient)
    oversizedClient.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'oversized' }))
    await frame(oversizedClient)
    await expect(oversizedClosed).resolves.toEqual([1009, Buffer.from('frame too large')])
  })

  it('keeps non-retryable, stale, and missing nack frames outside durable receipt handling', async () => {
    const harness = await setup({ retryableNackDelayMs: 25 })
    harness.teams.getTeam.mockResolvedValueOnce({ team: { cursor: 0 }, channelIds: ['channel-edge'], tasks: [] })
    harness.teams.watchTeam.mockResolvedValueOnce({ kind: 'closed' })
    harness.teams.watchChannel.mockResolvedValueOnce({ kind: 'closed' })
    harness.teams.listChannelPendingDeliveries.mockResolvedValueOnce({
      channel: { manifest: { teamId: binding.activation.teamId }, cursor: 2 },
      deliveries: [{ envelope }],
      nextCursor: 2,
    })
    const client = await socket(harness)
    const frames = frameQueue(client)
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'nack',
      deliveryId: 'before-attach',
      channelId: envelope.channelId,
      envelopeId: envelope.id,
      retryable: true,
    }))
    await new Promise(resolve => setImmediate(resolve))
    attach(client)
    await frames.next(next => next.type === 'attached')
    client.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'subscribe' }))
    await frames.next(next => next.type === 'response' && next.id === 'subscribe')
    const notice = await frames.next(next => next.type === 'notify')
    if (notice.type !== 'notify') throw new Error('expected pending notification')
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'nack',
      deliveryId: notice.deliveryId,
      channelId: 'other-channel',
      envelopeId: envelope.id,
      retryable: true,
    }))
    harness.teams.claimChannelDelivery.mockResolvedValueOnce({})
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'nack',
      deliveryId: notice.deliveryId,
      channelId: envelope.channelId,
      envelopeId: envelope.id,
      retryable: true,
    }))
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(harness.teams.claimChannelDelivery).not.toHaveBeenCalled()
    const retried = await frames.next(next => next.type === 'notify' && next.deliveryId !== notice.deliveryId)
    if (retried.type !== 'notify') throw new Error('expected retried notification')
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'nack',
      deliveryId: retried.deliveryId,
      channelId: envelope.channelId,
      envelopeId: envelope.id,
      retryable: false,
    }))
    await new Promise(resolve => setImmediate(resolve))
    expect(harness.teams.claimChannelDelivery).toHaveBeenCalledTimes(1)
    expect(harness.teams.ackChannelEnvelope).not.toHaveBeenCalled()
    client.close()
  })

  it('clears a scheduled retryable nack when its socket closes', async () => {
    const harness = await setup({ retryableNackDelayMs: 100 })
    harness.teams.getTeam.mockResolvedValueOnce({ team: { cursor: 0 }, channelIds: ['channel-edge'], tasks: [] })
    harness.teams.watchTeam.mockResolvedValueOnce({ kind: 'closed' })
    harness.teams.watchChannel.mockResolvedValueOnce({ kind: 'closed' })
    harness.teams.listChannelPendingDeliveries.mockResolvedValueOnce({
      channel: { manifest: { teamId: binding.activation.teamId }, cursor: 2 },
      deliveries: [{ envelope }],
      nextCursor: 2,
    })
    const client = await socket(harness)
    const frames = frameQueue(client)
    attach(client)
    await frames.next(next => next.type === 'attached')
    client.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'subscribe' }))
    await frames.next(next => next.type === 'response' && next.id === 'subscribe')
    const notice = await frames.next(next => next.type === 'notify')
    if (notice.type !== 'notify') throw new Error('expected pending notification')
    const activationReads = harness.teams.getActivation.mock.calls.length
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'nack',
      deliveryId: notice.deliveryId,
      channelId: notice.envelope.channelId,
      envelopeId: notice.envelope.id,
      retryable: true,
    }))
    await vi.waitFor(() => {
      expect(harness.teams.getActivation.mock.calls.length).toBeGreaterThanOrEqual(activationReads + 1)
    }, { interval: 1 })
    const closedClient = closed(client)
    client.close()
    await closedClient
    await new Promise<void>((resolve) => { setTimeout(resolve, 125) })
    expect(harness.teams.claimChannelDelivery).not.toHaveBeenCalled()
  })

  it('suppresses a retry timer while shutdown waits for socket termination', async () => {
    const harness = await setup({ retryableNackDelayMs: 100, closeTimeoutMs: 150 })
    harness.teams.getTeam.mockResolvedValueOnce({ team: { cursor: 0 }, channelIds: ['channel-edge'], tasks: [] })
    harness.teams.watchTeam.mockResolvedValueOnce({ kind: 'closed' })
    harness.teams.watchChannel.mockResolvedValueOnce({ kind: 'closed' })
    harness.teams.listChannelPendingDeliveries.mockResolvedValueOnce({
      channel: { manifest: { teamId: binding.activation.teamId }, cursor: 2 },
      deliveries: [{ envelope }],
      nextCursor: 2,
    })
    const connection = await serverSocket(harness)
    const frames = frameQueue(connection.client)
    attach(connection.client)
    await frames.next(next => next.type === 'attached')
    connection.client.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'subscribe' }))
    await frames.next(next => next.type === 'response' && next.id === 'subscribe')
    const notice = await frames.next(next => next.type === 'notify')
    if (notice.type !== 'notify') throw new Error('expected pending notification')
    const activationReads = harness.teams.getActivation.mock.calls.length
    connection.client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'nack',
      deliveryId: notice.deliveryId,
      channelId: notice.envelope.channelId,
      envelopeId: notice.envelope.id,
      retryable: true,
    }))
    await vi.waitFor(() => {
      expect(harness.teams.getActivation.mock.calls.length).toBeGreaterThanOrEqual(activationReads + 1)
    }, { interval: 1 })
    Object.defineProperty(connection.server, 'close', { configurable: true, value: () => {} })
    await harness.close()
    harnesses.delete(harness)
    expect(harness.teams.claimChannelDelivery).not.toHaveBeenCalled()
  })

  it('does not reissue a delayed nack after its durable binding goes offline', async () => {
    const harness = await setup({ retryableNackDelayMs: 200 })
    harness.teams.getTeam.mockResolvedValueOnce({ team: { cursor: 0 }, channelIds: ['channel-edge'], tasks: [] })
    harness.teams.watchTeam.mockResolvedValueOnce({ kind: 'closed' })
    harness.teams.watchChannel.mockResolvedValueOnce({ kind: 'closed' })
    harness.teams.listChannelPendingDeliveries.mockResolvedValueOnce({
      channel: { manifest: { teamId: binding.activation.teamId }, cursor: 2 },
      deliveries: [{ envelope }],
      nextCursor: 2,
    })
    const client = await socket(harness)
    const frames = frameQueue(client)
    attach(client)
    await frames.next(next => next.type === 'attached')
    client.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'subscribe' }))
    await frames.next(next => next.type === 'response' && next.id === 'subscribe')
    const notice = await frames.next(next => next.type === 'notify')
    if (notice.type !== 'notify') throw new Error('expected pending notification')
    const activationReads = harness.teams.getActivation.mock.calls.length
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'nack',
      deliveryId: notice.deliveryId,
      channelId: notice.envelope.channelId,
      envelopeId: notice.envelope.id,
      retryable: true,
    }))
    await vi.waitFor(() => {
      expect(harness.teams.getActivation.mock.calls.length).toBeGreaterThanOrEqual(activationReads + 1)
    }, { interval: 1 })
    harness.teams.getActivation.mockResolvedValue({
      ...binding,
      activation: { ...binding.activation, status: 'offline' },
    })
    await expect(closed(client)).resolves.toEqual([1008, Buffer.from('binding unavailable')])
    expect(harness.teams.claimChannelDelivery).not.toHaveBeenCalled()
  })

  it('closes a nack when its authenticated activation becomes unavailable', async () => {
    const harness = await setup()
    const client = await socket(harness)
    attach(client)
    await frame(client)
    client.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'subscribe' }))
    await frame(client)
    harness.teams.getActivation.mockResolvedValue({
      ...binding,
      activation: { ...binding.activation, status: 'offline' },
    })
    const unavailable = closed(client)
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'nack',
      deliveryId: 'unavailable',
      channelId: envelope.channelId,
      envelopeId: envelope.id,
      retryable: true,
    }))
    await expect(unavailable).resolves.toEqual([1008, Buffer.from('binding unavailable')])
  })

  it('drops non-retryable and no-longer-pending nack deliveries', async () => {
    const retryHarness = await setup()
    retryHarness.teams.getTeam.mockResolvedValueOnce({ team: { cursor: 0 }, channelIds: ['channel-edge'], tasks: [] })
    retryHarness.teams.watchTeam.mockResolvedValueOnce({ kind: 'closed' })
    retryHarness.teams.watchChannel.mockResolvedValueOnce({ kind: 'closed' })
    retryHarness.teams.listChannelPendingDeliveries.mockResolvedValueOnce({
      channel: { manifest: { teamId: binding.activation.teamId }, cursor: 2 },
      deliveries: [{ envelope }],
      nextCursor: 2,
    })
    retryHarness.teams.claimChannelDelivery.mockResolvedValueOnce(undefined)
    const retryClient = await socket(retryHarness)
    const retryFrames = frameQueue(retryClient)
    attach(retryClient)
    await retryFrames.next(next => next.type === 'attached')
    retryClient.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'retry' }))
    await retryFrames.next(next => next.type === 'response' && next.id === 'retry')
    const retryNotice = await retryFrames.next(next => next.type === 'notify')
    if (retryNotice.type !== 'notify') throw new Error('expected retry notification')
    retryClient.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'nack',
      deliveryId: retryNotice.deliveryId,
      channelId: retryNotice.envelope.channelId,
      envelopeId: retryNotice.envelope.id,
      retryable: true,
    }))
    await vi.waitFor(() => { expect(retryHarness.teams.claimChannelDelivery).toHaveBeenCalledOnce() })
    retryClient.close()

    const finalHarness = await setup()
    finalHarness.teams.getTeam.mockResolvedValueOnce({ team: { cursor: 0 }, channelIds: ['channel-edge'], tasks: [] })
    finalHarness.teams.watchTeam.mockResolvedValueOnce({ kind: 'closed' })
    finalHarness.teams.watchChannel.mockResolvedValueOnce({ kind: 'closed' })
    finalHarness.teams.listChannelPendingDeliveries.mockResolvedValueOnce({
      channel: { manifest: { teamId: binding.activation.teamId }, cursor: 2 },
      deliveries: [{ envelope }],
      nextCursor: 2,
    })
    const finalClient = await socket(finalHarness)
    const finalFrames = frameQueue(finalClient)
    attach(finalClient)
    await finalFrames.next(next => next.type === 'attached')
    finalClient.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'final' }))
    await finalFrames.next(next => next.type === 'response' && next.id === 'final')
    const finalNotice = await finalFrames.next(next => next.type === 'notify')
    if (finalNotice.type !== 'notify') throw new Error('expected final notification')
    finalHarness.teams.getActivation.mockResolvedValue(binding)
    const activationReads = finalHarness.teams.getActivation.mock.calls.length
    finalClient.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'nack',
      deliveryId: finalNotice.deliveryId,
      channelId: finalNotice.envelope.channelId,
      envelopeId: finalNotice.envelope.id,
      retryable: false,
    }))
    await vi.waitFor(() => { expect(finalHarness.teams.getActivation).toHaveBeenCalledTimes(activationReads + 1) })
    expect(finalHarness.teams.claimChannelDelivery).not.toHaveBeenCalled()
    finalClient.close()
  })

  it('rejects a post without the required idempotency key', async () => {
    const harness = await setup()
    const client = await socket(harness)
    attach(client)
    await frame(client)
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'missing-post-key',
      op: 'post',
      input: {
        expectedCursor: 0,
        draft: {
          channelId: 'channel-edge',
          audience: ['sender-edge'],
          kind: 'message',
          payload: { text: 'missing retry key' },
          delivery: 'turn',
        },
      },
    }))
    await expect(frame(client)).resolves.toMatchObject({
      id: 'missing-post-key', ok: false, error: { code: 'invalid-request' },
    })
    expect(harness.teams.postChannelEnvelope).not.toHaveBeenCalled()
    client.close()
  })

  it('does not release a delivery for a causation id absent from this socket', async () => {
    const harness = await setup()
    const client = await socket(harness)
    attach(client)
    await frame(client)
    client.send(JSON.stringify({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'missing-causation',
      op: 'post',
      input: {
        expectedCursor: 0,
        idempotencyKey: 'missing-causation',
        draft: {
          channelId: 'channel-edge',
          audience: ['sender-edge'],
          kind: 'message',
          payload: { text: 'causation is not a socket delivery' },
          delivery: 'turn',
          causationId: 'other-envelope',
        },
      },
    }))
    await expect(frame(client)).resolves.toMatchObject({ id: 'missing-causation', ok: true })
    client.close()
  })

  it('fails foreign replay channels and closes when notification-time binding validation fails', async () => {
    const foreignHarness = await setup()
    foreignHarness.teams.getTeam.mockResolvedValueOnce({ team: { cursor: 0 }, channelIds: ['channel-edge'], tasks: [] })
    foreignHarness.teams.watchTeam.mockResolvedValueOnce({ kind: 'closed' })
    foreignHarness.teams.getChannel.mockResolvedValueOnce({
      manifest: { teamId: 'other-team', participants: [{ id: binding.activation.participantId }] },
    })
    const foreignClient = await socket(foreignHarness)
    attach(foreignClient)
    await frame(foreignClient)
    const foreignClosed = closed(foreignClient)
    foreignClient.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'foreign-channel' }))
    await frame(foreignClient)
    await expect(foreignClosed).resolves.toEqual([1011, Buffer.from('server failure')])

    const unavailableHarness = await setup()
    unavailableHarness.teams.getTeam.mockResolvedValueOnce({ team: { cursor: 0 }, channelIds: ['channel-edge'], tasks: [] })
    unavailableHarness.teams.watchTeam.mockResolvedValueOnce({ kind: 'closed' })
    unavailableHarness.teams.getChannel.mockResolvedValueOnce({
      manifest: { teamId: binding.activation.teamId, participants: [{ id: binding.activation.participantId }] },
    })
    unavailableHarness.teams.watchChannel.mockResolvedValueOnce({ kind: 'closed' })
    unavailableHarness.teams.listChannelPendingDeliveries.mockResolvedValueOnce({
      channel: { manifest: { teamId: binding.activation.teamId }, cursor: 2 },
      deliveries: [{ envelope }],
      nextCursor: 2,
    })
    const unavailableClient = await socket(unavailableHarness)
    attach(unavailableClient)
    await frame(unavailableClient)
    unavailableHarness.teams.getActivation
      .mockResolvedValueOnce(binding)
      .mockResolvedValueOnce(binding)
      .mockResolvedValueOnce({ ...binding, activation: { ...binding.activation, status: 'offline' } })
    const unavailableClosed = closed(unavailableClient)
    unavailableClient.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'unavailable-notify' }))
    await frame(unavailableClient)
    await expect(unavailableClosed).resolves.toEqual([1008, Buffer.from('binding unavailable')])

    const beforePageHarness = await setup()
    beforePageHarness.teams.getTeam.mockResolvedValueOnce({ team: { cursor: 0 }, channelIds: ['channel-edge'], tasks: [] })
    beforePageHarness.teams.watchTeam.mockResolvedValueOnce({ kind: 'closed' })
    beforePageHarness.teams.getChannel.mockResolvedValueOnce({
      manifest: { teamId: binding.activation.teamId, participants: [{ id: binding.activation.participantId }] },
    })
    const beforePageClient = await socket(beforePageHarness)
    attach(beforePageClient)
    await frame(beforePageClient)
    beforePageHarness.teams.getActivation
      .mockResolvedValueOnce(binding)
      .mockResolvedValueOnce({ ...binding, activation: { ...binding.activation, status: 'offline' } })
    const beforePageClosed = closed(beforePageClient)
    beforePageClient.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'unavailable-page' }))
    await frame(beforePageClient)
    await expect(beforePageClosed).resolves.toEqual([1008, Buffer.from('binding unavailable')])
  })

  it('tracks changed Team state, rejects malformed delivery pages, and suppresses duplicate pending deliveries', async () => {
    const changedHarness = await setup()
    changedHarness.teams.watchTeam
      .mockResolvedValueOnce({ kind: 'changed', cursor: 1 })
      .mockResolvedValueOnce({ kind: 'closed' })
    const changedClient = await socket(changedHarness)
    attach(changedClient)
    await frame(changedClient)
    changedClient.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'changed' }))
    await frame(changedClient)
    await vi.waitFor(() => { expect(changedHarness.teams.getTeam.mock.calls.length).toBeGreaterThanOrEqual(2) })
    changedClient.close()

    const duplicateHarness = await setup()
    duplicateHarness.teams.getTeam.mockResolvedValueOnce({ team: { cursor: 0 }, channelIds: ['channel-edge'], tasks: [] })
    duplicateHarness.teams.watchTeam.mockResolvedValueOnce({ kind: 'closed' })
    duplicateHarness.teams.watchChannel.mockResolvedValueOnce({ kind: 'closed' })
    duplicateHarness.teams.listChannelPendingDeliveries.mockResolvedValueOnce({
      channel: { manifest: { teamId: binding.activation.teamId }, cursor: 2 },
      deliveries: [{ envelope }, { envelope }],
      nextCursor: 2,
    })
    const duplicateClient = await socket(duplicateHarness)
    const duplicateFrames = frameQueue(duplicateClient)
    attach(duplicateClient)
    await duplicateFrames.next(next => next.type === 'attached')
    duplicateClient.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'duplicate' }))
    await duplicateFrames.next(next => next.type === 'response' && next.id === 'duplicate')
    await expect(duplicateFrames.next(next => next.type === 'notify')).resolves.toMatchObject({ type: 'notify' })
    await new Promise(resolve => setImmediate(resolve))
    duplicateClient.close()

    const invalidHarness = await setup()
    invalidHarness.teams.getTeam.mockResolvedValueOnce({ team: { cursor: 0 }, channelIds: ['channel-edge'], tasks: [] })
    invalidHarness.teams.watchTeam.mockResolvedValueOnce({ kind: 'closed' })
    invalidHarness.teams.watchChannel.mockResolvedValueOnce({ kind: 'closed' })
    invalidHarness.teams.listChannelPendingDeliveries.mockResolvedValueOnce({
      channel: { manifest: { teamId: binding.activation.teamId }, cursor: 0 },
      deliveries: [{ envelope: { ...envelope, teamId: 'other-team' } }],
      nextCursor: -1,
    })
    const invalidClient = await socket(invalidHarness)
    attach(invalidClient)
    await frame(invalidClient)
    const invalidClosed = closed(invalidClient)
    invalidClient.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'bad-page' }))
    await frame(invalidClient)
    await expect(invalidClosed).resolves.toEqual([1011, Buffer.from('server failure')])

    const rejectedHarness = await setup()
    rejectedHarness.teams.watchTeam.mockRejectedValueOnce(new Error('watch failed'))
    const rejectedClient = await socket(rejectedHarness)
    attach(rejectedClient)
    await frame(rejectedClient)
    const rejectedClosed = closed(rejectedClient)
    rejectedClient.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'rejected' }))
    await frame(rejectedClient)
    await expect(rejectedClosed).resolves.toEqual([1011, Buffer.from('server failure')])

    const channelRejectedHarness = await setup()
    channelRejectedHarness.teams.getTeam.mockResolvedValueOnce({
      team: { cursor: 0 }, channelIds: ['channel-edge', 'channel-edge'], tasks: [],
    })
    channelRejectedHarness.teams.watchTeam.mockResolvedValueOnce({ kind: 'closed' })
    channelRejectedHarness.teams.watchChannel.mockRejectedValueOnce(new Error('channel watch failed'))
    channelRejectedHarness.teams.listChannelPendingDeliveries.mockResolvedValueOnce({
      channel: { manifest: { teamId: binding.activation.teamId }, cursor: 0 },
      deliveries: [],
      nextCursor: 0,
    })
    const channelRejectedClient = await socket(channelRejectedHarness)
    attach(channelRejectedClient)
    await frame(channelRejectedClient)
    const channelRejectedClosed = closed(channelRejectedClient)
    channelRejectedClient.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'channel-rejected' }))
    await frame(channelRejectedClient)
    await expect(channelRejectedClosed).resolves.toEqual([1011, Buffer.from('server failure')])
  })

  it('bounds queued frame admission while an earlier attach still resolves', async () => {
    const harness = await setup({ maxPendingRequests: 1 })
    const activation = Promise.withResolvers<ActivationBindingSnapshot>()
    harness.teams.getActivation.mockReturnValueOnce(activation.promise)
    const client = await socket(harness)
    attach(client)
    const overflow = closed(client)
    client.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'queued' }))
    await expect(overflow).resolves.toEqual([1008, Buffer.from('request limit')])
    activation.resolve(binding)
  })

  it('resets frame-rate accounting at the next configured window', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0)
    try {
      const harness = await setup({ maxRequestsPerWindow: 1, requestWindowMs: 10 })
      const client = await socket(harness)
      attach(client)
      await frame(client)
      clock.mockReturnValue(10)
      client.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'next-window' }))
      await expect(frame(client)).resolves.toMatchObject({ id: 'next-window', ok: true })
      client.close()
    } finally {
      clock.mockRestore()
    }
  })

  it('stops replay on closed and invalid authoritative channel watches', async () => {
    const closedHarness = await setup()
    closedHarness.teams.getTeam.mockResolvedValueOnce({ team: { cursor: 0 }, channelIds: ['channel-edge'], tasks: [] })
    closedHarness.teams.watchTeam.mockResolvedValueOnce({ kind: 'closed' })
    closedHarness.teams.watchChannel.mockResolvedValueOnce({ kind: 'closed' })
    closedHarness.teams.listChannelPendingDeliveries.mockResolvedValueOnce({
      channel: { manifest: { teamId: binding.activation.teamId }, cursor: 0 },
      deliveries: [],
      nextCursor: 0,
    })
    const closedClient = await socket(closedHarness)
    attach(closedClient)
    await frame(closedClient)
    closedClient.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'closed' }))
    await expect(frame(closedClient)).resolves.toMatchObject({ id: 'closed', ok: true })
    await vi.waitFor(() => { expect(closedHarness.teams.watchChannel).toHaveBeenCalledTimes(1) })
    closedClient.close()

    const invalidHarness = await setup()
    invalidHarness.teams.getTeam.mockResolvedValueOnce({ team: { cursor: 0 }, channelIds: ['channel-edge'], tasks: [] })
    invalidHarness.teams.watchTeam.mockResolvedValueOnce({ kind: 'closed' })
    invalidHarness.teams.watchChannel.mockResolvedValueOnce({ kind: 'closed' })
    invalidHarness.teams.listChannelPendingDeliveries.mockResolvedValueOnce({
      channel: { manifest: { teamId: 'other-team' }, cursor: 0 },
      deliveries: [],
      nextCursor: 0,
    })
    const invalidClient = await socket(invalidHarness)
    attach(invalidClient)
    await frame(invalidClient)
    const invalidClosed = closed(invalidClient)
    invalidClient.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'invalid' }))
    await frame(invalidClient)
    await expect(invalidClosed).resolves.toEqual([1011, Buffer.from('server failure')])
  })

  it('closes malformed, binary, duplicate, and rate-limited frame streams', async () => {
    const malformedHarness = await setup()
    const malformed = await socket(malformedHarness)
    const malformedClosed = closed(malformed)
    malformed.send('{')
    await expect(malformedClosed).resolves.toEqual([1008, Buffer.from('invalid frame')])

    const binaryHarness = await setup()
    const binary = await socket(binaryHarness)
    const binaryClosed = closed(binary)
    binary.send(Buffer.from('binary'))
    await expect(binaryClosed).resolves.toEqual([1008, Buffer.from('binary frame')])

    const duplicateHarness = await setup()
    const duplicate = await socket(duplicateHarness)
    attach(duplicate)
    await frame(duplicate)
    const duplicateClosed = closed(duplicate)
    duplicate.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'attach' }))
    await expect(duplicateClosed).resolves.toEqual([1008, Buffer.from('duplicate request')])

    const rateHarness = await setup({ maxRequestsPerWindow: 1 })
    const rate = await socket(rateHarness)
    attach(rate)
    await frame(rate)
    const rateClosed = closed(rate)
    rate.send(JSON.stringify({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'later' }))
    await expect(rateClosed).resolves.toEqual([1008, Buffer.from('rate limit')])
  })

  it('closes accepted sockets when its owning listener disposes', async () => {
    const harness = await setup()
    const client = await socket(harness)
    attach(client)
    await frame(client)
    const done = closed(client)
    await harness.close()
    harnesses.delete(harness)
    await expect(done).resolves.toEqual([1001, Buffer.from('server closing')])
  })

  it('keeps a pong-responsive socket and releases a heartbeat timeout', async () => {
    const responsiveHarness = await setup({ heartbeatIntervalMs: 30, heartbeatTimeoutMs: 10 })
    const responsive = await serverSocket(responsiveHarness)
    const responsiveFrames = frameQueue(responsive.client)
    attach(responsive.client)
    await responsiveFrames.next(next => next.type === 'attached')
    const responsivePing = vi.spyOn(responsive.server, 'ping').mockImplementation(() => {
      responsive.server.emit('pong', Buffer.alloc(0))
    })
    await subscribe(responsive.client, responsiveFrames, 'responsive-subscribe')
    await new Promise<void>((resolve) => { setTimeout(resolve, 65) })
    expect(responsivePing).toHaveBeenCalled()
    expect(responsive.client.readyState).toBe(WebSocket.OPEN)
    const responsiveClosed = closed(responsive.client)
    responsive.client.close()
    await responsiveClosed

    const timeoutHarness = await setup({ heartbeatIntervalMs: 20, heartbeatTimeoutMs: 10 })
    const timedOut = await serverSocket(timeoutHarness)
    const timeoutFrames = frameQueue(timedOut.client)
    attach(timedOut.client)
    await timeoutFrames.next(next => next.type === 'attached')
    const timeoutPing = vi.spyOn(timedOut.server, 'ping').mockImplementation(() => {})
    await subscribe(timedOut.client, timeoutFrames, 'timeout-subscribe')
    const timeoutClosed = closed(timedOut.client)
    await expect(timeoutClosed).resolves.toEqual([1008, Buffer.from('heartbeat timeout')])
    expect(timeoutPing).toHaveBeenCalledOnce()
  })
})
