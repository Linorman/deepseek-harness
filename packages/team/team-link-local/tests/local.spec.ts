import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@clocky/cordis'
import {
  TeamError,
  activationBindingSnapshotSchema,
  channelDeliveryClaimSchema,
  channelIdSchema,
  channelPostIdempotencyKeySchema,
  channelReceiptRecordSchema,
  channelSnapshotSchema,
  envelopeIdSchema,
  participantInterruptSnapshotSchema,
  participantIdSchema,
  taskAttemptIdSchema,
  teamEnvelopeSchema,
  teamIdSchema,
  teamStateSnapshotSchema,
  teamTaskIdSchema,
  teamTaskSnapshotSchema,
} from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ActivationActorProofIssuer,
  ChannelDeliveryClaim,
  ChannelPendingDeliveryPage,
  ChannelReceiptRecord,
  ChannelSnapshot,
  ParticipantInterruptSnapshot,
  TeamActorProof,
  TeamActorProofLease,
  TeamEnvelope,
  TeamStateSnapshot,
  TeamTaskSnapshot,
} from '@clocky/clocky-team'
import type {
  TeamLinkDeliveryId,
  TeamLinkInterruptNotification,
  TeamLinkConnectRequest,
  TeamLinkProvider,
  TeamLinkTaskAttemptSettleRequest,
} from '@clocky/clocky-team-link'
import * as TeamLinkLocal from '../src/index.ts'

const teamId = teamIdSchema.parse('team-link-local')
const otherTeamId = teamIdSchema.parse('team-link-local-other')
const participantId = participantIdSchema.parse('participant-link-local')
const senderId = participantIdSchema.parse('participant-link-local-sender')
const channelId = channelIdSchema.parse('channel-link-local')
const envelopeId = envelopeIdSchema.parse('envelope-link-local')
const taskId = teamTaskIdSchema.parse('task-link-local')
const attemptId = taskAttemptIdSchema.parse('attempt-link-local')
const postIdempotencyKey = channelPostIdempotencyKeySchema.parse('post-link-local')

/** Build one exact durable binding accepted by the local provider. */
function binding(overrides: Record<string, unknown> = {}): ActivationBindingSnapshot {
  return activationBindingSnapshotSchema.parse({
    activation: {
      id: 'activation-link-local',
      teamId,
      participantId,
      status: 'idle',
    },
    sessionId: 'session-link-local',
    provider: 'in-process',
    ...overrides,
  })
}

/** Build one active channel attached to the selected Team. */
function channel(overrides: Record<string, unknown> = {}): ChannelSnapshot {
  return channelSnapshotSchema.parse({
    manifest: {
      id: channelId,
      teamId,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: senderId, role: 'sender' }, { id: participantId, role: 'recipient' }],
      limits: {},
    },
    phase: 'active',
    cursor: 2,
    ...overrides,
  })
}

/** Build one Hub-stamped Envelope pending for the bound recipient. */
function envelope(overrides: Record<string, unknown> = {}): TeamEnvelope {
  return teamEnvelopeSchema.parse({
    id: envelopeId,
    teamId,
    channelId,
    sequence: 2,
    senderId,
    audience: [participantId],
    kind: 'message',
    payload: { text: 'pending local delivery' },
    delivery: 'turn',
    priority: 'normal',
    createdAt: 2,
    ...overrides,
  })
}

/** Build one durable soft interrupt targeting the local test binding. */
function interrupt(overrides: Record<string, unknown> = {}): ParticipantInterruptSnapshot {
  return participantInterruptSnapshotSchema.parse({
    id: 'interrupt-link-local',
    actorId: senderId,
    target: {
      teamId,
      participantId,
      activationId: binding().activation.id,
      sessionId: binding().sessionId,
      provider: binding().provider,
    },
    requestedAt: 2,
    ...overrides,
  })
}

/** Build one complete Team state with selected attached channel ids. */
function teamState(channelIds: readonly ChannelSnapshot['manifest']['id'][] = []): TeamStateSnapshot {
  return teamStateSnapshotSchema.parse({
    team: {
      id: teamId,
      depth: 0,
      maxTeamDepth: 0,
      goal: { teamId, revision: 1, objective: 'Deliver local Link notifications.', phase: 'active', budgets: {} },
      phase: 'active',
      cursor: 4,
      createdAt: 1,
      updatedAt: 4,
    },
    goal: { teamId, revision: 1, objective: 'Deliver local Link notifications.', phase: 'active', budgets: {} },
    rules: {},
    budgets: {},
    participants: [],
    activations: [binding()],
    tasks: [],
    workspaceAllocations: [],
    channelIds,
  })
}

/** Build one current pending-delivery page. */
function pendingPage(
  deliveries: readonly TeamEnvelope[] = [],
  overrides: Record<string, unknown> = {},
): ChannelPendingDeliveryPage {
  return {
    channel: channel(),
    deliveries: deliveries.map(item => ({ envelope: item, delivery: item.delivery })),
    nextCursor: deliveries.at(-1)?.sequence ?? channel().cursor,
    ...overrides,
  }
}

/** Build one delivery claim that echoes the exact binding and pending Envelope. */
function claim(overrides: Record<string, unknown> = {}): ChannelDeliveryClaim {
  return channelDeliveryClaimSchema.parse({
    binding: binding(),
    channel: channel(),
    envelopeId,
    delivery: 'turn',
    ...overrides,
  })
}

/** Build one accepted recipient receipt. */
function receipt(overrides: Record<string, unknown> = {}): ChannelReceiptRecord {
  return channelReceiptRecordSchema.parse({
    type: 'channel/receipt',
    sequence: 3,
    createdAt: 3,
    participantId,
    envelopeId,
    cursor: 3,
    ...overrides,
  })
}

/** Build the active attempt projection returned after a bound task-start claim. */
function runningTask(overrides: Record<string, unknown> = {}): TeamTaskSnapshot {
  return teamTaskSnapshotSchema.parse({
    id: taskId,
    teamId,
    revision: 2,
    createCommand: {
      creator: {
        teamId,
        participantId,
        activationId: binding().activation.id,
        sessionId: binding().sessionId,
        provider: binding().provider,
      },
      idempotencyKey: 'task-create-local-link',
    },
    subject: 'Run local Team Link task.',
    description: 'Start from the bound task-assignment delivery.',
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
      attemptId,
      assignedRevision: 1,
      ordinal: 1,
      participantId,
      activationId: binding().activation.id,
      wakeChannelId: channelId,
      assignedAt: 1,
      startedAt: 2,
      durationMs: 10,
      renewedAt: 1,
      expiresAt: 11,
    },
    ...overrides,
  })
}

/** Build a provider-selected connection request. */
function request(overrides: Partial<TeamLinkConnectRequest> = {}): TeamLinkConnectRequest {
  return { provider: 'local', binding: binding(), ...overrides }
}

interface FakeTeams {
  readonly openActivationActorProofIssuer: ReturnType<typeof vi.fn>
  readonly getActivation: ReturnType<typeof vi.fn>
  readonly getTeam: ReturnType<typeof vi.fn>
  readonly getChannel: ReturnType<typeof vi.fn>
  readonly getChannelAdmission: ReturnType<typeof vi.fn>
  readonly postChannelEnvelope: ReturnType<typeof vi.fn>
  readonly postChannelFinalEnvelope: ReturnType<typeof vi.fn>
  readonly claimChannelDelivery: ReturnType<typeof vi.fn>
  readonly claimTaskAttemptStart: ReturnType<typeof vi.fn>
  readonly heartbeatTaskAttempt: ReturnType<typeof vi.fn>
  readonly settleTaskAttempt: ReturnType<typeof vi.fn>
  readonly resolveTaskReview: ReturnType<typeof vi.fn>
  readonly ackChannelEnvelope: ReturnType<typeof vi.fn>
  readonly acknowledgeParticipantInterrupt: ReturnType<typeof vi.fn>
  readonly listChannelPendingDeliveries: ReturnType<typeof vi.fn>
  readonly listPendingParticipantInterrupts: ReturnType<typeof vi.fn>
  readonly watchTeam: ReturnType<typeof vi.fn>
  readonly watchChannel: ReturnType<typeof vi.fn>
}

/** Test lease retaining the mock revoker that Link close must call exactly once. */
interface FakeActorProofLease extends TeamActorProofLease {
  readonly revoke: ReturnType<typeof vi.fn<() => void>>
}

interface FakeActorProofIssuer {
  readonly issuer: ActivationActorProofIssuer
  readonly issue: ReturnType<typeof vi.fn>
  readonly close: ReturnType<typeof vi.fn>
  readonly leases: readonly FakeActorProofLease[]
}

interface FakeHarness {
  readonly ctx: Context
  readonly teams: FakeTeams
  readonly actorProofIssuer: FakeActorProofIssuer
  readonly provider: TeamLinkProvider
  readonly unregister: ReturnType<typeof vi.fn>
  readonly disposeRegistration: () => void
  readonly warn: ReturnType<typeof vi.fn>
}

interface RetryRecord {
  readonly notification: TeamEnvelope
  readonly signal: AbortSignal
  timer: ReturnType<typeof setTimeout> | undefined
}

interface LocalNotificationSubscription {
  readonly listener: (envelope: TeamEnvelope) => Promise<void>
  readonly retries: Map<string, RetryRecord>
}

interface LocalLinkInternals {
  readonly channels: Map<ChannelSnapshot['manifest']['id'], Promise<void>>
  readonly listeners: Set<LocalNotificationSubscription>
  readonly interruptListeners: Set<{
    readonly listener: (notification: TeamLinkInterruptNotification) => Promise<void>
    readonly retries: Map<string, {
      readonly notification: TeamLinkInterruptNotification
      readonly signal: AbortSignal
      timer: ReturnType<typeof setTimeout> | undefined
    }>
  }>
  readonly interruptDeliveries: Map<TeamLinkDeliveryId, TeamLinkInterruptNotification>
  readonly interruptDeliveryIds: Map<ParticipantInterruptSnapshot['id'], TeamLinkDeliveryId>
  notificationAbort: AbortController | undefined
  closing: boolean
  startChannels(state: TeamStateSnapshot, signal: AbortSignal): void
  watchChannel(channelId: ChannelSnapshot['manifest']['id'], signal: AbortSignal): Promise<void>
  watchInterrupts(signal: AbortSignal): Promise<void>
  replayInterrupts(signal: AbortSignal): Promise<void>
  notify(envelope: TeamEnvelope, signal: AbortSignal): Promise<void>
  notifyInterrupt(notification: TeamLinkInterruptNotification, signal: AbortSignal): Promise<void>
  interruptDelivery(interrupt: ParticipantInterruptSnapshot): TeamLinkInterruptNotification
  forgetInterruptDelivery(notification: TeamLinkInterruptNotification): void
  notifyListeners(
    subscriptions: ReadonlySet<LocalNotificationSubscription>,
    notification: TeamEnvelope,
    key: string,
    subject: string,
    signal: AbortSignal,
  ): Promise<void>
  scheduleRetry(
    subscriptions: ReadonlySet<LocalNotificationSubscription>,
    subscription: LocalNotificationSubscription,
    notification: TeamEnvelope,
    key: string,
    subject: string,
    signal: AbortSignal,
  ): void
  clearRetry(
    subscription: LocalNotificationSubscription,
    key: string,
  ): void
}

/** Create a test-only issuer whose proof identity cannot carry caller-controlled Team authority. */
function createActorProofIssuer(): FakeActorProofIssuer {
  const leases: FakeActorProofLease[] = []
  const issue = vi.fn<(binding: ActivationBindingSnapshot) => FakeActorProofLease>((_binding) => {
    const proof = Object.freeze(Object.defineProperty({}, 'toJSON', {
      value: (): never => { throw new TypeError('test actor proofs are runtime-only') },
    })) as TeamActorProof
    const lease: FakeActorProofLease = {
      proof,
      revoke: vi.fn<() => void>(),
    }
    leases.push(lease)
    return lease
  })
  const close = vi.fn<() => void>()
  return {
    issuer: Object.freeze({ issue, close }),
    issue,
    close,
    leases,
  }
}

/** Mount the function plugin into a minimal context and capture its registered provider. */
function setup(config: TeamLinkLocal.Config = {
  providerName: 'local', pageSize: 2, disposalTimeoutMs: 100, notificationRetryDelayMs: 1,
}): FakeHarness {
  const actorProofIssuer = createActorProofIssuer()
  const teams: FakeTeams = {
    openActivationActorProofIssuer: vi.fn(() => actorProofIssuer.issuer),
    getActivation: vi.fn(async () => binding()),
    getTeam: vi.fn(async () => teamState()),
    getChannel: vi.fn(async () => channel()),
    getChannelAdmission: vi.fn(async () => ({ channel: channel(), invitations: [] })),
    postChannelEnvelope: vi.fn(async () => envelope()),
    postChannelFinalEnvelope: vi.fn(async () => envelope({
      senderId: participantId,
      audience: [senderId],
      kind: 'final',
      payload: { text: 'local final' },
    })),
    claimChannelDelivery: vi.fn(async () => claim()),
    claimTaskAttemptStart: vi.fn(async () => runningTask()),
    heartbeatTaskAttempt: vi.fn(async () => runningTask()),
    settleTaskAttempt: vi.fn(async () => runningTask()),
    resolveTaskReview: vi.fn(async () => runningTask()),
    ackChannelEnvelope: vi.fn(async () => receipt()),
    acknowledgeParticipantInterrupt: vi.fn(async () => interrupt({ acknowledgedAt: 3 })),
    listChannelPendingDeliveries: vi.fn(async () => pendingPage()),
    listPendingParticipantInterrupts: vi.fn(async () => []),
    watchTeam: vi.fn(async () => ({ kind: 'closed' })),
    watchChannel: vi.fn(async () => ({ kind: 'closed' })),
  }
  let captured: TeamLinkProvider | undefined
  const unregister = vi.fn()
  let disposeRegistration: (() => void) | undefined
  const warn = vi.fn()
  const ctx = {
    teams,
    teamLinks: {
      registerProvider: vi.fn((provider: TeamLinkProvider) => {
        captured = provider
        return unregister
      }),
    },
    effect: vi.fn((install: () => () => void) => {
      disposeRegistration = install()
      return disposeRegistration
    }),
    get: vi.fn(() => undefined),
    logger: { warn },
  } as unknown as Context
  TeamLinkLocal.apply(ctx, config)
  if (captured === undefined || disposeRegistration === undefined) {
    throw new Error('local Team Link plugin did not register a provider')
  }
  return { ctx, teams, actorProofIssuer, provider: captured, unregister, disposeRegistration, warn }
}

/** Let queued async watch/replay continuations settle. */
async function settleWork(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

/** Normalize an AbortSignal's unknown reason for Promise rejection assertions. */
function abortError(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason
  return reason instanceof Error ? reason : new Error('watch aborted')
}

describe('local Team Link provider', () => {
  it('registers its configured provider name and closes only future connection admission on plugin disposal', async () => {
    const harness = setup({ providerName: 'configured-local', pageSize: 2, disposalTimeoutMs: 100, notificationRetryDelayMs: 1 })
    expect(harness.provider.name).toBe('configured-local')
    const connected = await harness.provider.connect({ ...request(), provider: 'configured-local' })

    harness.disposeRegistration()
    expect(harness.unregister).toHaveBeenCalledTimes(1)
    await expect(harness.provider.connect({ ...request(), provider: 'configured-local' })).rejects.toMatchObject({
      code: 'TEAM_LINK_LOCAL_PROVIDER_CLOSED',
    })
    await expect(connected.close()).resolves.toBeUndefined()
  })

  it('rejects pre-publication cancellation and a durable binding that differs from the request', async () => {
    const harness = setup()
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(harness.provider.connect(request({ signal: controller.signal }))).rejects.toMatchObject({
      code: 'TEAM_LINK_LOCAL_ABORTED',
    })

    harness.teams.getActivation.mockResolvedValueOnce(binding({ sessionId: 'another-session' }))
    await expect(harness.provider.connect(request())).rejects.toMatchObject({
      code: 'TEAM_LINK_LOCAL_BINDING_MISMATCH',
    })

    const offline = binding({ activation: { ...binding().activation, status: 'offline' } })
    harness.teams.getActivation.mockResolvedValueOnce(offline)
    await expect(harness.provider.connect(request({ binding: offline }))).rejects.toMatchObject({
      code: 'TEAM_LINK_LOCAL_ACTIVATION_UNAVAILABLE',
    })
  })

  it('fails integration before Team authority when no workspace provider is mounted', async () => {
    const harness = setup()
    const link = await harness.provider.connect(request())
    await expect(link.integrateTask({ taskId, attemptId, expectedRevision: 2 })).rejects.toMatchObject({
      code: 'TEAM_LINK_LOCAL_FAILED',
      message: 'local Team Link integration requires a Team workspace provider registry',
    })
    expect(harness.teams.getChannel).not.toHaveBeenCalled()
    await link.close()
  })

  it('observes cancellation that arrives while durable activation verification is pending', async () => {
    const harness = setup()
    const deferred = Promise.withResolvers<ActivationBindingSnapshot>()
    harness.teams.getActivation.mockReturnValueOnce(deferred.promise)
    const controller = new AbortController()
    const connecting = harness.provider.connect(request({ signal: controller.signal }))
    controller.abort(new Error('cancelled during lookup'))
    deferred.resolve(binding())

    await expect(connecting).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_ABORTED' })
  })

  it('does not publish a Link when provider disposal wins an in-flight activation lookup', async () => {
    const harness = setup()
    const deferred = Promise.withResolvers<ActivationBindingSnapshot>()
    harness.teams.getActivation.mockReturnValueOnce(deferred.promise)
    const connecting = harness.provider.connect(request())
    harness.disposeRegistration()
    deferred.resolve(binding())

    await expect(connecting).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_PROVIDER_CLOSED' })
  })

  it('accepts an idle-to-running activation transition during connection without changing the Link identity', async () => {
    const harness = setup()
    const requested = request()
    harness.teams.getActivation.mockResolvedValueOnce(binding({
      activation: { ...binding().activation, status: 'running' },
    }))

    const link = await harness.provider.connect(requested)
    expect(link.binding).toEqual(binding({
      activation: { ...requested.binding.activation, status: 'running' },
    }))
    await link.close()
  })

  it('replays one exact binding-targeted soft interrupt and acknowledges it only through its delivered correlation', async () => {
    const harness = setup()
    const command = interrupt()
    harness.teams.listPendingParticipantInterrupts.mockResolvedValueOnce([command])
    const link = await harness.provider.connect(request())
    const [actorLease] = harness.actorProofIssuer.leases
    if (actorLease === undefined) throw new Error('local Link did not retain an actor proof lease')
    let delivered: TeamLinkInterruptNotification | undefined
    link.onInterrupt(async (notification) => {
      delivered = notification
      await link.acknowledgeInterrupt(notification.deliveryId, notification.interrupt.id)
    })

    await vi.waitFor(() => {
      expect(delivered).toMatchObject({ interrupt: command })
      expect(harness.teams.listPendingParticipantInterrupts).toHaveBeenCalledWith({
        actor: actorLease.proof,
      })
      expect(harness.teams.acknowledgeParticipantInterrupt).toHaveBeenCalledWith({
        actor: actorLease.proof,
        interruptId: command.id,
      })
    })
    if (delivered === undefined) throw new Error('interrupt notification was not delivered')
    await expect(link.acknowledgeInterrupt(delivered.deliveryId, command.id)).rejects.toMatchObject({
      code: 'TEAM_LINK_LOCAL_INTERRUPT_DELIVERY_INVALID',
    })
    await expect(link.acknowledgeInterrupt('unknown-delivery' as TeamLinkDeliveryId, command.id)).rejects.toMatchObject({
      code: 'TEAM_LINK_LOCAL_INTERRUPT_DELIVERY_INVALID',
    })
    await link.close()
  })

  it('retries a failed soft-interrupt callback without acknowledging its durable command', async () => {
    vi.useFakeTimers()
    try {
      const harness = setup({ providerName: 'local', pageSize: 1, disposalTimeoutMs: 100, notificationRetryDelayMs: 10 })
      const command = interrupt()
      harness.teams.listPendingParticipantInterrupts.mockResolvedValueOnce([command])
      const link = await harness.provider.connect(request())
      let attempts = 0
      link.onInterrupt(async () => {
        attempts += 1
        throw new Error('retry interrupt delivery')
      })

      await settleWork()
      expect(attempts).toBe(1)
      expect(harness.teams.acknowledgeParticipantInterrupt).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(10)
      expect(attempts).toBe(2)
      await link.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps one interrupt delivery correlation across Team changes and stops replay after its last subscriber leaves', async () => {
    const harness = setup()
    const command = interrupt()
    const received: TeamLinkInterruptNotification[] = []
    harness.teams.listPendingParticipantInterrupts.mockResolvedValue([command])
    harness.teams.watchTeam
      .mockResolvedValueOnce({ kind: 'changed', cursor: 5 })
      .mockResolvedValueOnce({ kind: 'closed' })
    const link = await harness.provider.connect(request())
    const unsubscribe = link.onInterrupt(async (notification) => {
      received.push(notification)
    })
    const secondUnsubscribe = link.onInterrupt(async () => {})

    await vi.waitFor(() => { expect(received).toHaveLength(2) })
    expect(received[0]?.deliveryId).toBe(received[1]?.deliveryId)
    const internals = link as unknown as LocalLinkInternals
    expect(internals.interruptDeliveries).toHaveLength(1)
    unsubscribe()
    secondUnsubscribe()
    secondUnsubscribe()
    expect(internals.interruptDeliveries).toHaveLength(0)
    await link.close()
  })

  it('fails the Link when a pending interrupt escapes its exact durable binding', async () => {
    const harness = setup()
    harness.teams.listPendingParticipantInterrupts.mockResolvedValueOnce([interrupt({
      target: { ...interrupt().target, sessionId: 'another-session' },
    })])
    const link = await harness.provider.connect(request())
    link.onInterrupt(async () => {})

    await expect(link.done).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_BINDING_MISMATCH' })
    await expect(link.close()).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_FAILED' })
  })

  it('contains interrupted replay and retains a newer interrupt-delivery mapping after an older acknowledgement returns', async () => {
    const harness = setup()
    const link = await harness.provider.connect(request())
    const internals = link as unknown as LocalLinkInternals
    const command = interrupt()
    const delivery = internals.interruptDelivery(command)
    internals.interruptDeliveries.delete(delivery.deliveryId)
    expect(internals.interruptDelivery(command)).not.toBe(delivery)

    const current = internals.interruptDelivery(command)
    const replacement: TeamLinkInterruptNotification = {
      deliveryId: 'replacement-delivery' as TeamLinkDeliveryId,
      interrupt: current.interrupt,
    }
    internals.interruptDeliveries.set(current.deliveryId, replacement)
    internals.interruptDeliveryIds.set(command.id, replacement.deliveryId)
    internals.forgetInterruptDelivery(current)
    expect(internals.interruptDeliveries.get(current.deliveryId)).toBe(replacement)
    expect(internals.interruptDeliveryIds.get(command.id)).toBe(replacement.deliveryId)

    harness.teams.watchTeam.mockRejectedValueOnce(new Error('interrupt watch failed'))
    await expect(internals.watchInterrupts(new AbortController().signal)).rejects.toThrow('interrupt watch failed')

    const pending = Promise.withResolvers<readonly ParticipantInterruptSnapshot[]>()
    harness.teams.listPendingParticipantInterrupts.mockReturnValueOnce(pending.promise)
    const controller = new AbortController()
    const stopped = internals.watchInterrupts(controller.signal)
    await vi.waitFor(() => { expect(harness.teams.listPendingParticipantInterrupts).toHaveBeenCalledTimes(2) })
    controller.abort()
    pending.resolve([command])
    await expect(stopped).resolves.toBeUndefined()

    internals.closing = true
    await internals.notifyInterrupt(current, new AbortController().signal)
    internals.closing = false
    const aborted = new AbortController()
    aborted.abort()
    await internals.notifyInterrupt(current, aborted.signal)
    await link.close()
    link.onInterrupt(async () => {})()
  })

  it('derives authenticated Team operations from its verified binding and rejects foreign channels', async () => {
    const harness = setup()
    const link = await harness.provider.connect(request())
    const posted = await link.post({
      expectedCursor: 2,
      idempotencyKey: postIdempotencyKey,
      draft: {
        channelId,
        audience: [senderId],
        kind: 'message',
        payload: { text: 'reply' },
        delivery: 'context',
      },
    })
    expect(posted).toEqual(envelope())
    const [actorLease] = harness.actorProofIssuer.leases
    if (actorLease === undefined) throw new Error('local Link did not retain an actor proof lease')
    expect(harness.teams.postChannelEnvelope).toHaveBeenCalledWith({
      actor: actorLease.proof,
      expectedCursor: 2,
      idempotencyKey: postIdempotencyKey,
      draft: {
        channelId,
        audience: [senderId],
        kind: 'message',
        payload: { text: 'reply' },
        delivery: 'context',
      },
    })
    await expect(link.claim(channelId, envelopeId)).resolves.toEqual(claim())
    expect(harness.teams.claimChannelDelivery).toHaveBeenCalledWith({
      actor: actorLease.proof,
      channelId,
      envelopeId,
    })
    await expect(link.claimTaskAttemptStart({
      taskId,
      attemptId,
      assignedRevision: 1,
      channelId,
      envelopeId,
    })).resolves.toEqual(runningTask())
    expect(harness.teams.claimTaskAttemptStart).toHaveBeenCalledWith({
      actor: actorLease.proof,
      taskId,
      attemptId,
      assignedRevision: 1,
      channelId,
      envelopeId,
    })
    await expect(link.heartbeatTaskAttempt({
      taskId,
      attemptId,
      expectedRevision: 2,
    })).resolves.toEqual(runningTask())
    expect(harness.teams.heartbeatTaskAttempt).toHaveBeenCalledWith({
      actor: actorLease.proof,
      taskId,
      attemptId,
      expectedRevision: 2,
    })
    await expect(link.resolveTaskReview({
      taskId,
      expectedRevision: 2,
      nextPhase: 'completed',
      reason: 'The reviewer accepted the durable result.',
    })).resolves.toEqual(runningTask())
    expect(harness.teams.resolveTaskReview).toHaveBeenCalledWith({
      actor: actorLease.proof,
      taskId,
      expectedRevision: 2,
      nextPhase: 'completed',
      reason: 'The reviewer accepted the durable result.',
    })
    await expect(link.settleTaskAttempt({
      taskId,
      attemptId,
      expectedRevision: 2,
      outcome: { kind: 'completed', result: { summary: 'Completed local task.' } },
    })).resolves.toEqual(runningTask())
    expect(harness.teams.settleTaskAttempt).toHaveBeenCalledWith({
      actor: actorLease.proof,
      taskId,
      attemptId,
      expectedRevision: 2,
      outcome: { kind: 'completed', result: { summary: 'Completed local task.' } },
    })
    await expect(link.acknowledge(channelId, envelopeId, 2)).resolves.toEqual(receipt())
    expect(harness.teams.ackChannelEnvelope).toHaveBeenCalledWith({
      actor: actorLease.proof,
      channelId,
      envelopeId,
      expectedCursor: 2,
    })

    harness.teams.getChannel.mockResolvedValue(channel({ manifest: { ...channel().manifest, teamId: otherTeamId } }))
    await expect(link.post({
      expectedCursor: 2,
      idempotencyKey: postIdempotencyKey,
      draft: { channelId, audience: [senderId], kind: 'message', payload: { text: 'no' }, delivery: 'context' },
    })).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_CHANNEL_TEAM_MISMATCH' })
    await expect(link.claim(channelId, envelopeId)).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_CHANNEL_TEAM_MISMATCH' })
    await expect(link.claimTaskAttemptStart({
      taskId,
      attemptId,
      assignedRevision: 1,
      channelId,
      envelopeId,
    })).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_CHANNEL_TEAM_MISMATCH' })
    await expect(link.acknowledge(channelId, envelopeId, 2)).rejects.toMatchObject({
      code: 'TEAM_LINK_LOCAL_CHANNEL_TEAM_MISMATCH',
    })
    await link.close()
  })

  it('forwards a direct final without reading a channel cursor or recipient', async () => {
    const harness = setup()
    const link = await harness.provider.connect(request())
    const lease = harness.actorProofIssuer.leases.at(-1)
    if (lease === undefined) throw new Error('local Team Link did not issue an actor proof lease')
    await expect(link.postFinalResult({
      channelId,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('final-link-local'),
      text: 'local final',
    })).resolves.toMatchObject({ kind: 'final', senderId: participantId, audience: [senderId] })
    expect(harness.teams.getChannel).not.toHaveBeenCalled()
    expect(harness.teams.postChannelFinalEnvelope).toHaveBeenCalledWith({
      actor: lease.proof,
      channelId,
      idempotencyKey: 'final-link-local',
      text: 'local final',
    })
    await link.close()
    expect(lease.revoke.mock.calls).toHaveLength(1)
  })

  it('forwards every worker-permitted task settlement outcome without a channel lookup', async () => {
    const harness = setup()
    const link = await harness.provider.connect(request())
    const actorLease = harness.actorProofIssuer.leases.at(-1)
    if (actorLease === undefined) throw new Error('local Team Link did not retain an actor proof lease')
    const outcomes: readonly TeamLinkTaskAttemptSettleRequest['outcome'][] = [
      { kind: 'released' },
      { kind: 'failed', failure: { code: 'worker-failed', message: 'Worker could not complete the task.' } },
      { kind: 'completed', result: { summary: 'Completed local task.' } },
    ]

    for (const [index, outcome] of outcomes.entries()) {
      await link.settleTaskAttempt({ taskId, attemptId, expectedRevision: index + 1, outcome })
    }

    expect(harness.teams.getChannel).not.toHaveBeenCalled()
    expect(harness.teams.settleTaskAttempt).toHaveBeenNthCalledWith(1, {
      actor: actorLease.proof,
      taskId,
      attemptId,
      expectedRevision: 1,
      outcome: { kind: 'released' },
    })
    expect(harness.teams.settleTaskAttempt).toHaveBeenNthCalledWith(2, {
      actor: actorLease.proof,
      taskId,
      attemptId,
      expectedRevision: 2,
      outcome: { kind: 'failed', failure: { code: 'worker-failed', message: 'Worker could not complete the task.' } },
    })
    expect(harness.teams.settleTaskAttempt).toHaveBeenNthCalledWith(3, {
      actor: actorLease.proof,
      taskId,
      attemptId,
      expectedRevision: 3,
      outcome: { kind: 'completed', result: { summary: 'Completed local task.' } },
    })
    await link.close()
  })

  it('starts cursor watches before replay, emits real pending Envelopes, and contains listener failures', async () => {
    const harness = setup()
    const accepted = envelope()
    harness.teams.getTeam.mockResolvedValue(teamState([channelId]))
    harness.teams.watchTeam
      .mockResolvedValueOnce({ kind: 'changed', cursor: 5 })
      .mockResolvedValueOnce({ kind: 'closed' })
    harness.teams.watchChannel
      .mockResolvedValueOnce({ kind: 'changed', cursor: accepted.sequence })
      .mockResolvedValueOnce({ kind: 'closed' })
    harness.teams.listChannelPendingDeliveries
      .mockResolvedValueOnce(pendingPage([accepted]))
      .mockResolvedValueOnce(pendingPage([], { nextCursor: accepted.sequence }))
    const link = await harness.provider.connect(request())
    const observed: TeamEnvelope[] = []
    link.onNotify(async () => { throw Object.create(null) })
    link.onNotify(async (item) => { observed.push(item) })

    await vi.waitFor(() => { expect(observed).toEqual([accepted]) })
    expect(harness.teams.watchTeam).toHaveBeenCalledBefore(harness.teams.listChannelPendingDeliveries)
    expect(harness.teams.watchChannel).toHaveBeenCalledBefore(harness.teams.listChannelPendingDeliveries)
    expect(harness.warn).toHaveBeenCalledWith(expect.stringContaining(`Envelope '${accepted.id}' listener failed`))
    await link.close()
  })

  it('stops a notification recovery cycle after the last listener leaves and restarts it for a later subscriber', async () => {
    const harness = setup()
    const signals: AbortSignal[] = []
    // oxlint-disable-next-line typescript/no-misused-promises -- the mocked Team watch stays pending until Link cancellation.
    harness.teams.watchTeam.mockImplementation((input: { readonly signal?: AbortSignal }) => new Promise((resolve, reject) => {
      if (input.signal !== undefined) {
        signals.push(input.signal)
        input.signal.addEventListener('abort', () => { reject(abortError(input.signal)) }, { once: true })
      }
      void resolve
    }))
    const link = await harness.provider.connect(request())
    const listener = async () => {}
    const first = link.onNotify(listener)
    const duplicate = link.onNotify(listener)
    await settleWork()
    first()
    first()
    expect(signals[0]?.aborted).toBe(false)
    duplicate()
    await vi.waitFor(() => { expect(signals[0]?.aborted).toBe(true) })

    const second = link.onNotify(listener)
    await vi.waitFor(() => { expect(signals).toHaveLength(2) })
    second()
    await expect(link.close()).resolves.toBeUndefined()
  })

  it('treats a closed channel as a terminal notification source rather than a Link failure', async () => {
    const harness = setup()
    harness.teams.getTeam.mockResolvedValue(teamState([channelId]))
    harness.teams.watchTeam.mockResolvedValue({ kind: 'closed' })
    harness.teams.watchChannel.mockResolvedValue({ kind: 'closed' })
    harness.teams.getChannel.mockResolvedValue(channel({ phase: 'closed' }))
    const link = await harness.provider.connect(request())
    link.onNotify(async () => {})

    await settleWork()
    expect(harness.teams.listChannelPendingDeliveries).toHaveBeenCalledTimes(1)
    await expect(link.close()).resolves.toBeUndefined()
  })

  it('terminates a channel watcher when its pending page races channel closure', async () => {
    const harness = setup()
    harness.teams.getTeam.mockResolvedValue(teamState([channelId]))
    harness.teams.watchTeam.mockResolvedValue({ kind: 'closed' })
    harness.teams.watchChannel.mockResolvedValue({ kind: 'closed' })
    harness.teams.getChannel
      .mockResolvedValueOnce(channel())
      .mockResolvedValueOnce(channel({ phase: 'closed' }))
    harness.teams.listChannelPendingDeliveries.mockRejectedValueOnce(new Error('channel changed'))
    const link = await harness.provider.connect(request())
    link.onNotify(async () => {})

    await settleWork()
    await expect(link.close()).resolves.toBeUndefined()
  })

  it('records background replay failure as observable Link lifecycle state and stops future public calls', async () => {
    const harness = setup()
    harness.teams.getTeam.mockResolvedValue(teamState([channelId]))
    harness.teams.watchTeam.mockResolvedValue({ kind: 'closed' })
    harness.teams.watchChannel.mockResolvedValue({ kind: 'closed' })
    const failure = new Error('pending lookup failed')
    harness.teams.listChannelPendingDeliveries.mockRejectedValue(failure)
    const link = await harness.provider.connect(request())
    link.onNotify(async () => {})

    await vi.waitFor(async () => {
      await expect(link.claim(channelId, envelopeId)).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_FAILED' })
    })
    expect(harness.warn).toHaveBeenCalledWith(expect.stringContaining('notification watch failed'))
    await expect(link.done).rejects.toBe(failure)
    await expect(link.close()).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_FAILED' })
  })

  it('makes close idempotent, aborts its owned waits, and rejects later operations', async () => {
    const harness = setup()
    const teamWait = Promise.withResolvers<{ readonly kind: 'changed'; readonly cursor: number }>()
    harness.teams.getTeam.mockResolvedValue(teamState())
    // oxlint-disable-next-line typescript/no-misused-promises -- the mocked Team watch stays pending until Link cancellation.
    harness.teams.watchTeam.mockImplementation((input: { readonly signal?: AbortSignal }) => new Promise((resolve, reject) => {
      input.signal?.addEventListener('abort', () => { reject(abortError(input.signal)) }, { once: true })
      void resolve
    }))
    const link = await harness.provider.connect(request())
    link.onNotify(async () => {})
    await settleWork()
    const first = link.close()
    const second = link.close()
    expect(second).toBe(first)
    await expect(first).resolves.toBeUndefined()
    await expect(link.post({
      expectedCursor: 2,
      idempotencyKey: postIdempotencyKey,
      draft: { channelId, audience: [senderId], kind: 'message', payload: { text: 'closed' }, delivery: 'context' },
    })).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_CLOSED' })
    await expect(link.claim(channelId, envelopeId)).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_CLOSED' })
    await expect(link.settleTaskAttempt({
      taskId,
      attemptId,
      expectedRevision: 2,
      outcome: { kind: 'released' },
    })).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_CLOSED' })
    await expect(link.acknowledge(channelId, envelopeId, 2)).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_CLOSED' })
    const noop = link.onNotify(async () => {})
    noop()
    expect(teamWait.promise).toBeInstanceOf(Promise)
  })

  it('bounds close when an accepted listener does not settle', async () => {
    const harness = setup({ providerName: 'local', pageSize: 2, disposalTimeoutMs: 1, notificationRetryDelayMs: 1 })
    const accepted = envelope()
    const listenerStarted = Promise.withResolvers<undefined>()
    const listenerNeverSettles = new Promise<void>(() => {})
    harness.teams.getTeam.mockResolvedValue(teamState([channelId]))
    harness.teams.watchTeam.mockResolvedValue({ kind: 'closed' })
    harness.teams.watchChannel.mockResolvedValue({ kind: 'closed' })
    harness.teams.listChannelPendingDeliveries.mockResolvedValue(pendingPage([accepted]))
    const link = await harness.provider.connect(request())
    link.onNotify(async () => {
      listenerStarted.resolve(undefined)
      await listenerNeverSettles
    })
    await listenerStarted.promise

    await expect(link.close()).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_DISPOSAL_TIMEOUT' })
  })

  it('makes malformed replay cursors, foreign pending Envelopes, and rejected watches observable failures', async () => {
    const malformed = setup()
    malformed.teams.getTeam.mockResolvedValue(teamState([channelId]))
    malformed.teams.watchTeam.mockResolvedValue({ kind: 'closed' })
    malformed.teams.watchChannel.mockResolvedValue({ kind: 'changed', cursor: 2 })
    malformed.teams.listChannelPendingDeliveries.mockResolvedValue(pendingPage([], { nextCursor: -2 }))
    const malformedLink = await malformed.provider.connect(request())
    malformedLink.onNotify(async () => {})
    await vi.waitFor(() => { expect(malformed.warn).toHaveBeenCalledWith(expect.stringContaining('notification watch failed')) })
    await expect(malformedLink.close()).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_FAILED' })

    const repeatedWatch = setup()
    repeatedWatch.teams.getTeam.mockResolvedValue(teamState([channelId]))
    repeatedWatch.teams.watchTeam.mockResolvedValue({ kind: 'closed' })
    repeatedWatch.teams.watchChannel.mockResolvedValue({ kind: 'changed', cursor: 0 })
    repeatedWatch.teams.listChannelPendingDeliveries.mockResolvedValue(pendingPage())
    const repeatedWatchLink = await repeatedWatch.provider.connect(request())
    repeatedWatchLink.onNotify(async () => {})
    await vi.waitFor(() => { expect(repeatedWatch.warn).toHaveBeenCalledWith(expect.stringContaining('notification watch failed')) })
    await expect(repeatedWatchLink.close()).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_FAILED' })

    const repeatedTeamWatch = setup()
    repeatedTeamWatch.teams.getTeam.mockResolvedValue(teamState([channelId]))
    repeatedTeamWatch.teams.watchTeam.mockResolvedValue({ kind: 'changed', cursor: 4 })
    const repeatedTeamWatchLink = await repeatedTeamWatch.provider.connect(request())
    repeatedTeamWatchLink.onNotify(async () => {})
    await vi.waitFor(() => { expect(repeatedTeamWatch.warn).toHaveBeenCalledWith(expect.stringContaining('notification watch failed')) })
    await expect(repeatedTeamWatchLink.close()).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_FAILED' })

    const foreign = setup()
    foreign.teams.getTeam.mockResolvedValue(teamState([channelId]))
    foreign.teams.watchTeam.mockResolvedValue({ kind: 'closed' })
    foreign.teams.watchChannel.mockResolvedValue({ kind: 'closed' })
    foreign.teams.listChannelPendingDeliveries.mockResolvedValue(pendingPage([
      envelope({ teamId: otherTeamId }),
    ]))
    const foreignLink = await foreign.provider.connect(request())
    foreignLink.onNotify(async () => {})
    await vi.waitFor(() => { expect(foreign.warn).toHaveBeenCalledWith(expect.stringContaining('notification watch failed')) })
    await expect(foreignLink.close()).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_FAILED' })

    const rejected = setup()
    const failure = new Error('team watch failed')
    rejected.teams.watchTeam.mockRejectedValue(failure)
    const rejectedLink = await rejected.provider.connect(request())
    rejectedLink.onNotify(async () => {})
    await vi.waitFor(() => { expect(rejected.warn).toHaveBeenCalledWith(expect.stringContaining('notification watch failed')) })
    await expect(rejectedLink.close()).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_FAILED' })
  })

  it('handles direct watch and listener shutdown branches without leaking a stale channel task', async () => {
    const harness = setup()
    const link = await harness.provider.connect(request())
    const internals = link as unknown as LocalLinkInternals
    const cancelled = new AbortController()
    cancelled.abort()
    internals.startChannels(teamState([channelId]), cancelled.signal)
    expect(internals.channels).toEqual(new Map())

    const retained = Promise.resolve()
    internals.channels.set(channelId, retained)
    internals.startChannels(teamState([channelId]), new AbortController().signal)
    expect(internals.channels.get(channelId)).toBe(retained)
    internals.channels.clear()

    harness.teams.getChannel.mockResolvedValue(channel({ phase: 'closed' }))
    harness.teams.watchChannel.mockRejectedValueOnce(new Error('closed watch rejected'))
    await expect(internals.watchChannel(channelId, new AbortController().signal)).rejects.toThrow('closed watch rejected')

    harness.teams.getChannel
      .mockResolvedValueOnce(channel())
      .mockResolvedValueOnce(channel({ phase: 'closed' }))
    harness.teams.watchChannel.mockRejectedValueOnce(new Error('closure watch rejected'))
    harness.teams.listChannelPendingDeliveries.mockRejectedValueOnce(new Error('channel closed while reading'))
    await expect(internals.watchChannel(channelId, new AbortController().signal)).rejects.toThrow('closure watch rejected')

    harness.teams.getChannel.mockResolvedValue(channel())
    harness.teams.watchChannel.mockRejectedValueOnce(new Error('changed watch rejected'))
    harness.teams.listChannelPendingDeliveries.mockResolvedValueOnce(pendingPage())
    await expect(internals.watchChannel(channelId, new AbortController().signal)).rejects.toThrow('changed watch rejected')

    const page = Promise.withResolvers<ChannelPendingDeliveryPage>()
    const signal = new AbortController()
    harness.teams.getChannel.mockResolvedValue(channel())
    // oxlint-disable-next-line typescript/no-misused-promises -- the mocked channel watch stays pending until test cancellation.
    harness.teams.watchChannel.mockImplementationOnce((input: { readonly signal?: AbortSignal }) => new Promise((resolve, reject) => {
      input.signal?.addEventListener('abort', () => { reject(abortError(input.signal)) }, { once: true })
      void resolve
    }))
    harness.teams.listChannelPendingDeliveries.mockReturnValueOnce(page.promise)
    const stopping = internals.watchChannel(channelId, signal.signal)
    await vi.waitFor(() => { expect(harness.teams.listChannelPendingDeliveries).toHaveBeenCalled() })
    signal.abort()
    page.resolve(pendingPage())
    await expect(stopping).resolves.toBeUndefined()

    internals.closing = true
    void internals.notify(envelope(), new AbortController().signal)
    internals.closing = false
    const aborted = new AbortController()
    aborted.abort()
    const listener = vi.fn(async () => {})
    internals.listeners.add({ listener, retries: new Map() })
    const ignored = envelope()
    await internals.notifyListeners(
      internals.listeners,
      ignored,
      JSON.stringify([ignored.channelId, ignored.id]),
      `Envelope '${ignored.id}'`,
      aborted.signal,
    )
    expect(listener).not.toHaveBeenCalled()
    internals.listeners.clear()
    await link.close()
  })

  it('keeps a replacement channel task when an earlier task settles after a new registration', async () => {
    const harness = setup()
    const link = await harness.provider.connect(request())
    const internals = link as unknown as LocalLinkInternals
    const deferred = Promise.withResolvers<ChannelSnapshot>()
    harness.teams.getChannel.mockReturnValueOnce(deferred.promise)
    internals.startChannels(teamState([channelId]), new AbortController().signal)
    const first = internals.channels.get(channelId)
    if (first === undefined) throw new Error('channel task did not start')
    const replacement = Promise.resolve()
    internals.channels.set(channelId, replacement)
    deferred.reject(new Error('first task failed'))
    await settleWork()
    expect(internals.channels.get(channelId)).toBe(replacement)
    await expect(link.close()).rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_FAILED' })
  })

  it('holds later pages until the current notification settles', async () => {
    const harness = setup({ providerName: 'local', pageSize: 1, disposalTimeoutMs: 100, notificationRetryDelayMs: 10 })
    const first = envelope({ id: 'envelope-page-first', sequence: 2 })
    const second = envelope({ id: 'envelope-page-second', sequence: 3 })
    const firstDelivery = Promise.withResolvers<undefined>()
    const firstStarted = Promise.withResolvers<undefined>()
    let notified = 0
    harness.teams.getTeam.mockResolvedValue(teamState([channelId]))
    harness.teams.watchTeam.mockResolvedValue({ kind: 'closed' })
    harness.teams.watchChannel
      .mockResolvedValueOnce({ kind: 'changed', cursor: 2 })
      .mockResolvedValueOnce({ kind: 'closed' })
    harness.teams.listChannelPendingDeliveries
      .mockResolvedValueOnce(pendingPage([first], { nextCursor: first.sequence }))
      .mockResolvedValueOnce(pendingPage([second], { nextCursor: second.sequence }))
    const link = await harness.provider.connect(request())
    link.onNotify(async () => {
      notified += 1
      if (notified === 1) {
        firstStarted.resolve(undefined)
        await firstDelivery.promise
      }
    })

    await firstStarted.promise
    expect(harness.teams.listChannelPendingDeliveries).toHaveBeenCalledTimes(1)
    firstDelivery.resolve(undefined)
    await vi.waitFor(() => {
      expect(harness.teams.listChannelPendingDeliveries).toHaveBeenCalledTimes(2)
      expect(notified).toBe(2)
    })
    await link.close()
  })

  it('retries only a failed listener notification after its configured delay and cancels that retry on unsubscribe', async () => {
    vi.useFakeTimers()
    try {
      const harness = setup({ providerName: 'local', pageSize: 2, disposalTimeoutMs: 100, notificationRetryDelayMs: 10 })
      const failed = envelope({ id: 'envelope-retry-failed', sequence: 2 })
      const delivered = envelope({ id: 'envelope-retry-delivered', sequence: 3 })
      const attempts = new Map<string, number>()
      harness.teams.getTeam.mockResolvedValue(teamState([channelId]))
      harness.teams.watchTeam.mockResolvedValue({ kind: 'closed' })
      harness.teams.watchChannel.mockResolvedValue({ kind: 'closed' })
      harness.teams.listChannelPendingDeliveries.mockResolvedValue(pendingPage([failed, delivered], { nextCursor: 3 }))
      const link = await harness.provider.connect(request())
      const unsubscribe = link.onNotify(async (item) => {
        const attempt = (attempts.get(item.id) ?? 0) + 1
        attempts.set(item.id, attempt)
        if ((item.id === failed.id && attempt === 1) || item.id === 'envelope-retry-cancelled') {
          throw new Error('transient target failure')
        }
      })

      await settleWork()
      await vi.advanceTimersByTimeAsync(0)
      await settleWork()
      expect(attempts).toEqual(new Map([[failed.id, 1], [delivered.id, 1]]))
      await vi.advanceTimersByTimeAsync(9)
      expect(attempts.get(failed.id)).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(attempts).toEqual(new Map([[failed.id, 2], [delivered.id, 1]]))

      const failureAgain = envelope({ id: 'envelope-retry-cancelled', sequence: 4 })
      const internals = link as unknown as LocalLinkInternals
      await internals.notify(failureAgain, new AbortController().signal)
      unsubscribe()
      await vi.advanceTimersByTimeAsync(10)
      expect(attempts.get(failureAgain.id)).toBe(1)
      await link.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops a permanently invalidated delivery instead of retrying a closed-channel claim', async () => {
    vi.useFakeTimers()
    try {
      const harness = setup({ providerName: 'local', pageSize: 1, disposalTimeoutMs: 100, notificationRetryDelayMs: 10 })
      const link = await harness.provider.connect(request())
      const internals = link as unknown as LocalLinkInternals
      const closed = envelope({ id: 'envelope-closed-before-claim', sequence: 2 })
      let attempts = 0
      link.onNotify(async () => {
        attempts += 1
        throw new TeamError(`channel '${closed.channelId}' is not active`, 'TEAM_INVALID_ARGUMENT')
      })

      await internals.notify(closed, new AbortController().signal)
      expect(attempts).toBe(1)
      await vi.advanceTimersByTimeAsync(20)
      expect(attempts).toBe(1)
      await link.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops stale, aborted, removed, and closed retry callbacks without retaining timer state', async () => {
    vi.useFakeTimers()
    try {
      const harness = setup({ providerName: 'local', pageSize: 1, disposalTimeoutMs: 100, notificationRetryDelayMs: 10 })
      const link = await harness.provider.connect(request())
      const internals = link as unknown as LocalLinkInternals
      const unsubscribe = link.onNotify(async () => {})
      const subscription = [...internals.listeners][0]
      if (subscription === undefined) throw new Error('notification subscription was not retained')
      const signal = new AbortController().signal
      const first = envelope({ id: 'envelope-stale-retry', sequence: 2 })
      const firstKey = JSON.stringify([first.channelId, first.id])
      internals.scheduleRetry(internals.listeners, subscription, first, firstKey, `Envelope '${first.id}'`, signal)
      internals.scheduleRetry(internals.listeners, subscription, first, firstKey, `Envelope '${first.id}'`, signal)
      expect(subscription.retries).toHaveLength(1)
      subscription.retries.delete(firstKey)
      await vi.advanceTimersByTimeAsync(10)
      expect(subscription.retries).toHaveLength(0)

      const blocked = envelope({ id: 'envelope-blocked-retry', sequence: 3 })
      const blockedKey = JSON.stringify([blocked.channelId, blocked.id])
      internals.scheduleRetry(internals.listeners, subscription, blocked, blockedKey, `Envelope '${blocked.id}'`, signal)
      internals.closing = true
      await vi.advanceTimersByTimeAsync(10)
      internals.closing = false
      expect(subscription.retries).toHaveLength(0)

      const noTimer = envelope({ id: 'envelope-no-timer', sequence: 4 })
      const noTimerKey = JSON.stringify([noTimer.channelId, noTimer.id])
      subscription.retries.set(noTimerKey, { notification: noTimer, signal, timer: undefined })
      internals.clearRetry(subscription, noTimerKey)
      expect(subscription.retries).toHaveLength(0)

      const aborted = new AbortController()
      aborted.abort()
      const abortedEnvelope = envelope({ id: 'envelope-aborted-retry', sequence: 5 })
      internals.scheduleRetry(
        internals.listeners,
        subscription,
        abortedEnvelope,
        JSON.stringify([abortedEnvelope.channelId, abortedEnvelope.id]),
        `Envelope '${abortedEnvelope.id}'`,
        aborted.signal,
      )
      expect(subscription.retries).toHaveLength(0)
      unsubscribe()
      const removedEnvelope = envelope({ id: 'envelope-removed-retry', sequence: 6 })
      internals.scheduleRetry(
        internals.listeners,
        subscription,
        removedEnvelope,
        JSON.stringify([removedEnvelope.channelId, removedEnvelope.id]),
        `Envelope '${removedEnvelope.id}'`,
        signal,
      )
      expect(subscription.retries).toHaveLength(0)
      await link.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects invalid direct plugin limits before registering a provider', () => {
    const page = setup as unknown as (config: TeamLinkLocal.Config) => FakeHarness
    expect(() => page({ providerName: 'local', pageSize: 0, disposalTimeoutMs: 1, notificationRetryDelayMs: 1 })).toThrow(/pageSize/)
    expect(() => page({ providerName: 'local', pageSize: 1, disposalTimeoutMs: 0, notificationRetryDelayMs: 1 })).toThrow(/disposalTimeoutMs/)
    expect(() => page({ providerName: 'local', pageSize: 1, disposalTimeoutMs: 1, notificationRetryDelayMs: 0 }))
      .toThrow(/notificationRetryDelayMs/)
  })
})
