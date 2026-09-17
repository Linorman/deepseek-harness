import { describe, expect, it, vi } from 'vitest'
import { FiberState, type Context } from '@clocky/cordis'
import type { Agent, PreStepDecision } from '@clocky/clocky-agent'
import type { UserMessage } from '@clocky/clocky-llm'
import { SessionId } from '@clocky/clocky-session'
import type {
  TeamLink,
  TeamLinkConnectRequest,
  TeamLinkDeliveryId,
  TeamLinkInterruptNotification,
  TeamLinkTaskCancellationNotification,
} from '@clocky/clocky-team-link'
import {
  activationBindingSnapshotSchema,
  activationIdSchema,
  channelDeliveryClaimSchema,
  channelSnapshotSchema,
  participantSnapshotSchema,
  participantInterruptSnapshotSchema,
  participantIdSchema,
  teamEnvelopeSchema,
  teamIdSchema,
  teamStateSnapshotSchema,
} from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ChannelDeliveryClaim,
  ChannelSnapshot,
  ParticipantId,
  ParticipantInterruptSnapshot,
  ParticipantSnapshot,
  TeamEnvelope,
  TeamId,
  TeamTaskSnapshot,
  TaskAttemptId,
} from '@clocky/clocky-team'
import {
  apply,
  Config,
  FixedBindingTeamAgentLinkDelivery,
  TeamAgentClient,
} from '../src/index.ts'

const teamId = teamIdSchema.parse('team-edges')
const senderId = participantIdSchema.parse('participant-sender')
const recipientId = participantIdSchema.parse('participant-recipient')

interface Binding {
  readonly agent: Agent
  readonly teamId: TeamId
  readonly participantId: ParticipantId
  readonly activationId: ActivationBindingSnapshot['activation']['id']
  readonly sessionId: Agent['session']['id']
  readonly durableBinding: ActivationBindingSnapshot
}

interface LinkConnection {
  readonly binding: Binding
  readonly controller: AbortController
  readonly released: Promise<void>
  readonly release: () => void
  link?: TeamLink
  unsubscribe: (() => void) | undefined
  unsubscribeInterrupt: (() => void) | undefined
  stopping: boolean
}

interface DeliveryInternals {
  bindings: Map<string, Binding>
  connections: Map<string, LinkConnection>
  deliveryTails: Map<string, Promise<void>>
  flushBarriers: Map<string, unknown>
  flushedEnvelopeSources: Map<string, Agent['session']['id']>
  reconnectTimers: Map<string, ReturnType<typeof setTimeout>>
  accepted: Set<Promise<void>>
  closing: boolean
  listeners: (() => void)[]
  scheduleConnection(binding: Binding): void
  scheduleReconnect(binding: Binding): void
  clearReconnect(key: string): void
  notify(connection: LinkConnection, envelope: TeamEnvelope): Promise<void>
  interrupt(connection: LinkConnection, notification: TeamLinkInterruptNotification): Promise<void>
  connect(binding: Binding): Promise<void>
  disconnect(connection: LinkConnection): void
  disconnectBinding(binding: Binding): void
  disconnectAgent(agent: Agent): void
  track(operation: Promise<void>, subject: string): void
  serialize(agent: Agent, operation: () => Promise<void>): Promise<void>
  deliver(connection: LinkConnection, envelope: TeamEnvelope): Promise<void>
  admitEnvelope(connection: LinkConnection, envelope: TeamEnvelope, claim: ChannelDeliveryClaim, message: UserMessage): Promise<void>
  removeMessageFlushBarrier(agent: Agent, message: UserMessage): void
  clearFlushBarriers(agent: Agent): void
  clearFlushedEnvelopeSources(agent: Agent): void
  installFlushBarrier(agent: Agent, envelopeId: TeamEnvelope['id']): {
    readonly settled: Promise<void>
    readonly resolve: () => void
    readonly reject: (reason?: unknown) => void
  }
}

interface DiscoveryInternals {
  bindings: Map<string, Binding>
  deliveries: Map<string, FixedBindingTeamAgentLinkDelivery>
  closingDeliveries: Set<Promise<void>>
  closing: boolean
  scheduleReconciliation(agent: Agent): void
  reconcile(agent: Agent): Promise<void>
  reconcileBinding(binding: ActivationBindingSnapshot): void
  bind(agent: Agent, teamId: TeamId, participantId: ParticipantId, activation: ActivationBindingSnapshot): void
  releaseBinding(key: string, binding: Binding): void
}

type PreStepListener = (
  payload: { readonly agent: Agent; readonly messages: UserMessage[] },
  next: () => Promise<PreStepDecision>,
) => Promise<PreStepDecision>

type AgentSpies = {
  readonly inject: ReturnType<typeof vi.fn>
  readonly followup: ReturnType<typeof vi.fn>
  readonly steer: ReturnType<typeof vi.fn>
  readonly cancel: ReturnType<typeof vi.fn>
  readonly whenIdle: ReturnType<typeof vi.fn>
}

type TestAgent = Agent & {
  readonly inputCalls: unknown[]
  readonly spies: AgentSpies
}

type TestLink = TeamLink & {
  readonly claim: ReturnType<typeof vi.fn>
  readonly claimTaskAttemptStart: ReturnType<typeof vi.fn>
  readonly acknowledge: ReturnType<typeof vi.fn>
  readonly acknowledgeInterrupt: ReturnType<typeof vi.fn>
  readonly acknowledgeTaskCancellation: ReturnType<typeof vi.fn>
  readonly close: ReturnType<typeof vi.fn>
  readonly onNotify: ReturnType<typeof vi.fn>
  readonly onInterrupt: ReturnType<typeof vi.fn>
  readonly terminal: PromiseWithResolvers<undefined>
  emit(envelope: TeamEnvelope): Promise<void>
  emitInterrupt(notification: TeamLinkInterruptNotification): Promise<void>
  emitTaskCancellation(notification: TeamLinkTaskCancellationNotification): Promise<void>
  listenerCount(): number
  interruptListenerCount(): number
}

interface FakeContext {
  readonly ctx: Context
  readonly callbacks: Map<string, ((payload: unknown) => void)[]>
  readonly warn: ReturnType<typeof vi.fn>
  readonly fiber: { state: FiberState }
  readonly agents: { readonly list: ReturnType<typeof vi.fn>; readonly get: ReturnType<typeof vi.fn> }
  readonly teams: {
    readonly getTeam: ReturnType<typeof vi.fn>
    readonly openActivationActorProofIssuer: ReturnType<typeof vi.fn>
  }
  readonly usageProofIssuer: { readonly issue: ReturnType<typeof vi.fn>; readonly close: ReturnType<typeof vi.fn> }
  readonly usageProofLeases: readonly { readonly revoke: ReturnType<typeof vi.fn> }[]
  readonly teamLinks: {
    readonly connect: ReturnType<typeof vi.fn>
    readonly registerBoundLinkBorrower: ReturnType<typeof vi.fn>
    readonly getBoundLinkBorrower: ReturnType<typeof vi.fn>
  }
  readonly sessions: { readonly flush: ReturnType<typeof vi.fn> }
  readonly links: TestLink[]
}

/** Create one exact direct claim for a local binding and accepted Envelope. */
function deliveryClaim(
  durable: ActivationBindingSnapshot,
  accepted = envelope(),
  overrides: Record<string, unknown> = {},
): ChannelDeliveryClaim {
  return channelDeliveryClaimSchema.parse({
    binding: durable,
    channel: channel(),
    envelopeId: accepted.id,
    delivery: accepted.delivery,
    ...overrides,
  })
}

/** Build a Team Link test double with explicit subscriber fan-out. */
function link(binding: ActivationBindingSnapshot): TestLink {
  const listeners = new Set<(envelope: TeamEnvelope) => Promise<void>>()
  const interruptListeners = new Set<(notification: TeamLinkInterruptNotification) => Promise<void>>()
  const cancellationListeners = new Set<(notification: TeamLinkTaskCancellationNotification) => Promise<void>>()
  const terminal = Promise.withResolvers<undefined>()
  const subject = {
    provider: 'local',
    binding,
    done: terminal.promise,
    terminal,
    onInvitation: vi.fn(() => () => {}),
    onNotify: vi.fn((listener: (envelope: TeamEnvelope) => Promise<void>) => {
      listeners.add(listener)
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        listeners.delete(listener)
      }
    }),
    onInterrupt: vi.fn((listener: (notification: TeamLinkInterruptNotification) => Promise<void>) => {
      interruptListeners.add(listener)
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        interruptListeners.delete(listener)
      }
    }),
    onTaskCancellation: vi.fn((listener: (notification: TeamLinkTaskCancellationNotification) => Promise<void>) => {
      cancellationListeners.add(listener)
      return () => { cancellationListeners.delete(listener) }
    }),
    acknowledgeTaskCancellation: vi.fn(async () => ({} as TeamTaskSnapshot)),
    post: vi.fn(async () => envelope()),
    postFinalResult: vi.fn(async () => envelope()),
    claim: vi.fn(async (_channelId: string, envelopeId: string) =>
      deliveryClaim(binding, envelope({ id: envelopeId }))),
    claimTaskAttemptStart: vi.fn(async () => ({} as TeamTaskSnapshot)),
    acknowledge: vi.fn(async () => ({})),
    acknowledgeInterrupt: vi.fn(async () => ({})),
    close: vi.fn(async () => {}),
    async emit(accepted: TeamEnvelope): Promise<void> {
      for (const listener of listeners) await listener(accepted)
    },
    async emitTaskCancellation(notification: TeamLinkTaskCancellationNotification): Promise<void> {
      for (const listener of cancellationListeners) await listener(notification)
    },
    async emitInterrupt(notification: TeamLinkInterruptNotification): Promise<void> {
      for (const listener of interruptListeners) await listener(notification)
    },
    listenerCount: () => listeners.size,
    interruptListenerCount: () => interruptListeners.size,
  }
  return subject as unknown as TestLink
}

/** Build a minimal Consumer context with Link connections kept directly observable. */
function fakeContext(): FakeContext {
  const callbacks = new Map<string, ((payload: unknown) => void)[]>()
  const warn = vi.fn()
  const fiber = { state: FiberState.ACTIVE }
  const agents = { list: vi.fn(() => []), get: vi.fn() }
  const usageProofLeases: Array<{ readonly revoke: ReturnType<typeof vi.fn> }> = []
  const usageProofIssuer = {
    issue: vi.fn((_binding: ActivationBindingSnapshot) => {
      const lease = { proof: Object.freeze({}), revoke: vi.fn() }
      usageProofLeases.push(lease)
      return lease
    }),
    close: vi.fn(),
  }
  const teams = {
    getTeam: vi.fn(async () => teamState()),
    openActivationActorProofIssuer: vi.fn(() => usageProofIssuer),
  }
  const links: TestLink[] = []
  const borrowers = new WeakMap<object, unknown>()
  const teamLinks = {
    connect: vi.fn(async (request: TeamLinkConnectRequest) => {
      const connected = link(request.binding)
      links.push(connected)
      return connected
    }),
    registerBoundLinkBorrower: vi.fn((owner: object, borrower: unknown) => {
      if (borrowers.has(owner)) throw new Error('duplicate bound-Link borrower')
      borrowers.set(owner, borrower)
      return () => {
        if (borrowers.get(owner) === borrower) borrowers.delete(owner)
      }
    }),
    getBoundLinkBorrower: vi.fn((owner: object) => borrowers.get(owner)),
  }
  const sessions = { flush: vi.fn(async () => true) }
  const ctx = {
    on: vi.fn((event: string, callback: (payload: unknown) => void) => {
      const registered = callbacks.get(event) ?? []
      registered.push(callback)
      callbacks.set(event, registered)
      return () => {
        const current = callbacks.get(event) ?? []
        callbacks.set(event, current.filter(item => item !== callback))
      }
    }),
    logger: { warn },
    fiber,
    agents,
    teams,
    teamLinks,
    sessions,
  } as unknown as Context
  return { ctx, callbacks, warn, fiber, agents, teams, usageProofIssuer, usageProofLeases, teamLinks, sessions, links }
}

/** Make one live Agent-shaped test value with controllable public inbox methods. */
function agent(
  id: string,
  header: { readonly teamId?: string; readonly participantId?: string } = { teamId, participantId: recipientId },
): TestAgent {
  const session = { id, header: { id, version: 0, createdAt: 0, ...header }, events: [] }
  const inputCalls: unknown[] = []
  const inbox = { nextStep: [] as UserMessage[], nextTurn: [] as UserMessage[] }
  const inject = vi.fn((message: UserMessage) => {
    inputCalls.push(message)
    inbox.nextStep.push(message)
  })
  const followup = vi.fn((message: UserMessage) => {
    inputCalls.push(message)
    inbox.nextTurn.push(message)
  })
  const steer = vi.fn((message: UserMessage) => {
    inputCalls.push(message)
    inbox.nextStep.push(message)
  })
  const cancel = vi.fn()
  const whenIdle = vi.fn(async () => {})
  return {
    id,
    session,
    inbox,
    inject,
    followup,
    steer,
    cancel,
    whenIdle,
    inputCalls,
    spies: { inject, followup, steer, cancel, whenIdle },
  } as unknown as TestAgent
}

/** Make one active direct channel projection. */
function channel(overrides: Record<string, unknown> = {}): ChannelSnapshot {
  return channelSnapshotSchema.parse({
    manifest: {
      id: 'channel-edges',
      teamId,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: senderId, role: 'sender' }, { id: recipientId, role: 'recipient' }],
      limits: {},
    },
    phase: 'active',
    cursor: 2,
    ...overrides,
  })
}

/** Make one accepted direct Envelope. */
function envelope(overrides: Record<string, unknown> = {}): TeamEnvelope {
  return teamEnvelopeSchema.parse({
    id: 'envelope-edges',
    teamId,
    channelId: 'channel-edges',
    sequence: 2,
    senderId,
    audience: [recipientId],
    kind: 'message',
    payload: { text: 'edge delivery' },
    delivery: 'context',
    priority: 'normal',
    createdAt: 1,
    ...overrides,
  })
}

/** Make one active task-assignment channel for the exact local activation binding. */
function taskAssignmentChannel(
  durable: ActivationBindingSnapshot,
  overrides: Record<string, unknown> = {},
): ChannelSnapshot {
  return channelSnapshotSchema.parse({
    manifest: {
      id: 'channel-task-assignment-edges',
      teamId,
      adapter: { type: 'task-assignment', version: 1 },
      participants: [{ id: recipientId, role: 'assignee' }],
      limits: { taskId: 'task-edges', activationId: durable.activation.id, sessionId: durable.sessionId },
    },
    phase: 'active',
    cursor: 2,
    ...overrides,
  })
}

/** Make one accepted task-assignment Envelope whose payload matches its immutable channel limits. */
function taskAssignmentEnvelope(
  durable: ActivationBindingSnapshot,
  overrides: Record<string, unknown> = {},
): TeamEnvelope {
  return teamEnvelopeSchema.parse({
    id: 'envelope-task-assignment-edges',
    teamId,
    channelId: 'channel-task-assignment-edges',
    sequence: 2,
    senderId: recipientId,
    audience: [recipientId],
    kind: 'assignment',
    payload: {
      taskId: 'task-edges',
      attemptId: 'attempt-edges',
      assignedRevision: 1,
      activationId: durable.activation.id,
      sessionId: durable.sessionId,
    },
    delivery: 'turn',
    taskId: 'task-edges',
    priority: 'normal',
    createdAt: 1,
    ...overrides,
  })
}

/** Make one exact durable binding for a local test Session. */
function activation(
  sessionId: Agent['session']['id'],
  overrides: Record<string, unknown> = {},
): ActivationBindingSnapshot {
  return activationBindingSnapshotSchema.parse({
    activation: {
      id: activationIdSchema.parse('activation-edges'),
      teamId,
      participantId: recipientId,
      status: 'idle',
    },
    sessionId,
    provider: 'in-process',
    ...overrides,
  })
}

/** Make one pending soft interrupt that targets one exact local activation binding. */
function interrupt(
  durable: ActivationBindingSnapshot,
  overrides: Record<string, unknown> = {},
): ParticipantInterruptSnapshot {
  return participantInterruptSnapshotSchema.parse({
    id: 'interrupt-edges',
    actorId: senderId,
    target: {
      teamId: durable.activation.teamId,
      participantId: durable.activation.participantId,
      activationId: durable.activation.id,
      sessionId: durable.sessionId,
      provider: durable.provider,
    },
    requestedAt: 1,
    ...overrides,
  })
}

/** Make one active local Agent participant for durable binding discovery. */
function participant(overrides: Record<string, unknown> = {}): ParticipantSnapshot {
  return participantSnapshotSchema.parse({
    id: recipientId,
    teamId,
    kind: 'local-agent',
    displayName: 'Recipient',
    role: 'recipient',
    capabilities: [],
    phase: 'active',
    ...overrides,
  })
}

/** Make one complete Team state for durable activation reconciliation. */
function teamState(
  activations: readonly ActivationBindingSnapshot[] = [],
  participants: readonly ParticipantSnapshot[] = [participant()],
) {
  return teamStateSnapshotSchema.parse({
    team: {
      id: teamId,
      depth: 0,
      maxTeamDepth: 0,
      goal: { teamId, revision: 1, objective: 'Test local Link delivery.', phase: 'active', budgets: {} },
      phase: 'active',
      cursor: 1,
      createdAt: 0,
      updatedAt: 1,
    },
    goal: { teamId, revision: 1, objective: 'Test local Link delivery.', phase: 'active', budgets: {} },
    rules: {},
    budgets: {},
    participants,
    activations,
    tasks: [],
    workspaceAllocations: [],
    channelIds: [],
  })
}

/** Build one Client binding record for white-box lifecycle tests. */
function binding(subject: Agent, durable = activation(subject.session.id)): Binding {
  return {
    agent: subject,
    teamId: durable.activation.teamId,
    participantId: durable.activation.participantId,
    activationId: durable.activation.id,
    sessionId: durable.sessionId,
    durableBinding: durable,
  }
}

/** Address Client maps with their collision-safe binding key. */
function key(team: TeamId, participant: ParticipantId): string {
  return JSON.stringify([team, participant])
}

/** Make a full connection record for direct delivery tests that bypass connect(). */
function connection(local: Binding, connected: TestLink): LinkConnection {
  const released = Promise.withResolvers<undefined>()
  return {
    binding: local,
    controller: new AbortController(),
    released: released.promise,
    release: () => { released.resolve(undefined) },
    link: connected,
    unsubscribe: undefined,
    unsubscribeInterrupt: undefined,
    stopping: false,
  }
}

/** Build an exact Team-derived message for the persistence-barrier listener. */
function envelopeMessageForPreStep(accepted = envelope()): UserMessage {
  return {
    id: `team-envelope:${accepted.id}`,
    role: 'user',
    content: [],
    source: {
      kind: 'team-envelope',
      teamId: accepted.teamId,
      channelId: accepted.channelId,
      envelopeId: accepted.id,
      senderId: accepted.senderId,
    },
  } as unknown as UserMessage
}

/** Establish an active Client-owned Link connection for one local binding. */
async function connect(
  internal: DeliveryInternals,
  fake: FakeContext,
  local: Binding,
): Promise<TestLink> {
  internal.scheduleConnection(local)
  await vi.waitFor(() => {
    expect(fake.teamLinks.connect).toHaveBeenCalled()
  })
  const connected = internal.connections.get(key(local.teamId, local.participantId))?.link
  if (connected === undefined) throw new Error('client did not retain its connected Team Link')
  return connected as TestLink
}

/** Construct one fixed-binding delivery owner and expose its exact internal binding for edge probes. */
function fixed(
  fake: FakeContext,
  target: Agent,
  durable: ActivationBindingSnapshot,
  config: Config = {},
): { readonly client: FixedBindingTeamAgentLinkDelivery; readonly internal: DeliveryInternals; readonly binding: Binding } {
  const client = new FixedBindingTeamAgentLinkDelivery(fake.ctx, { agent: target, binding: durable }, config)
  const internal = client as unknown as DeliveryInternals
  const binding = internal.bindings.get(key(durable.activation.teamId, durable.activation.participantId))
  if (binding === undefined) throw new Error('fixed binding did not attach')
  return { client, internal, binding }
}

describe('Team Agent Client Link lifecycle edges', () => {
  it('connects an exact binding without Team discovery or a team-change listener', async () => {
    const fake = fakeContext()
    const target = agent('agent-fixed-binding')
    const durable = activation(target.session.id)
    fake.agents.get.mockReturnValue(target)
    const { client } = fixed(fake, target, durable)
    client.start()

    await vi.waitFor(() => {
      expect(fake.teamLinks.connect).toHaveBeenCalledWith(expect.objectContaining({ binding: durable }))
    })
    expect(fake.teams.getTeam).not.toHaveBeenCalled()
    expect(fake.callbacks.get('team/changed')).toBeUndefined()
    await client.close()

    const misbound = fixed(fake, target, activation(SessionId('foreign-session')))
    misbound.client.start()
    await Promise.resolve()
    expect(fake.teamLinks.connect).toHaveBeenCalledTimes(1)
    await misbound.client.close()
  })

  it('passes a cooperative endpoint-termination handler that stops the exact Agent work', async () => {
    const fake = fakeContext()
    const target = agent('agent-termination-handler')
    const durable = activation(target.session.id)
    fake.agents.get.mockReturnValue(target)
    const { client } = fixed(fake, target, durable)
    client.start()

    await vi.waitFor(() => { expect(fake.teamLinks.connect).toHaveBeenCalledTimes(1) })
    const request = fake.teamLinks.connect.mock.calls[0]?.[0] as TeamLinkConnectRequest | undefined
    if (request?.onTerminate === undefined) throw new Error('fixed delivery did not install endpoint termination')
    await request.onTerminate({ code: 'TEAM_LINK_CREDENTIAL_REVOKED', message: 'stop delivery' })

    expect(target.spies.cancel).toHaveBeenCalledWith({ kind: 'disposed' }, { keepInbox: true })
    expect(target.spies.whenIdle).toHaveBeenCalledOnce()
    await client.close()
  })

  it('lends only its current fixed Link to the exact Agent owner and withdraws it on close', async () => {
    const fake = fakeContext()
    const target = agent('agent-fixed-borrower')
    const durable = activation(target.session.id)
    fake.agents.get.mockReturnValue(target)
    const { client } = fixed(fake, target, durable)
    client.start()
    const getBorrower = fake.teamLinks.getBoundLinkBorrower as unknown as (owner: object) => {
      withLink<T>(operation: (link: TeamLink) => Promise<T>): Promise<T>
    } | undefined
    const borrower = await vi.waitFor(() => {
      const current = getBorrower(target)
      expect(current).toBeDefined()
      return current
    })
    await expect(borrower!.withLink(async current => current.binding)).resolves.toBe(durable)
    await client.close()
    expect(getBorrower(target)).toBeUndefined()
  })

  it('isolates fixed-binding listeners and tears down when its target departs', async () => {
    const fake = fakeContext()
    const target = agent('agent-fixed-listeners')
    const durable = activation(target.session.id)
    const other = agent('agent-fixed-other')
    fake.agents.get.mockReturnValue(target)
    const { client, internal, binding: local } = fixed(fake, target, durable)
    client.start()
    client.start()
    expect(fake.callbacks.get('agent/pre-step')).toHaveLength(1)
    expect(fake.callbacks.get('agent/disposed')).toHaveLength(1)
    expect(fake.callbacks.get('agent/inbox/discarded')).toHaveLength(1)

    const preStep = fake.callbacks.get('agent/pre-step')?.[0] as unknown as PreStepListener | undefined
    const disposed = fake.callbacks.get('agent/disposed')?.[0]
    const discarded = fake.callbacks.get('agent/inbox/discarded')?.[0]
    if (preStep === undefined || disposed === undefined || discarded === undefined) {
      throw new Error('fixed binding did not install target listeners')
    }
    const delegated = vi.fn(async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: [] }))
    await expect(preStep({ agent: other, messages: [] }, delegated)).resolves.toEqual({ kind: 'enter', messages: [] })
    disposed({ agent: other })
    discarded({ agent: other, message: envelopeMessageForPreStep() })
    expect(internal.bindings.get(key(local.teamId, local.participantId))).toBe(local)

    const barrier = internal.installFlushBarrier(target, envelope({ id: 'fixed-target-departure' }).id)
    disposed({ agent: target })
    await expect(barrier.settled).rejects.toThrow('was disposed')
    expect(internal.bindings).toHaveLength(0)
    await client.close()
    client.start()
  })

  it('binds live Agents to the configured Link provider without direct channel-event ingress', async () => {
    const fake = fakeContext()
    const live = agent('agent-live')
    const durable = activation(live.session.id)
    fake.agents.list.mockReturnValue([live, agent('invalid-header', {})])
    fake.agents.get.mockImplementation((id: string) => id === live.id ? live : undefined)
    fake.teams.getTeam.mockResolvedValue(teamState([durable]))
    const client = new TeamAgentClient(fake.ctx, { linkProvider: 'configured-local' })
    const internal = client as unknown as DiscoveryInternals
    client.start()

    await vi.waitFor(() => {
      expect(internal.bindings.get(key(teamId, recipientId))?.agent).toBe(live)
      expect(fake.teamLinks.connect).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'configured-local',
        binding: durable,
      }))
    })
    const firstUsageLease = fake.usageProofLeases[0]
    if (firstUsageLease === undefined) throw new Error('client did not issue a usage proof for its first binding')
    expect(fake.usageProofIssuer.issue).toHaveBeenCalledWith(durable)
    expect(fake.callbacks.get('channel/changed')).toBeUndefined()
    const created = fake.callbacks.get('agent/created')?.[0]
    const disposed = fake.callbacks.get('agent/disposed')?.[0]
    const teamChanged = fake.callbacks.get('team/changed')?.[0]
    if (created === undefined || disposed === undefined || teamChanged === undefined) {
      throw new Error('client did not register its binding listeners')
    }
    created({ agent: live })
    created({ agent: agent('still-invalid', {}) })
    teamChanged({ type: 'activation/changed', binding: durable, cursor: 2, createdAt: 2 })
    internal.reconcileBinding(activation(SessionId('absent-agent')))
    expect(fake.teamLinks.connect).toHaveBeenCalledTimes(1)
    const connected = fake.links[0]
    if (connected === undefined) throw new Error('client did not connect a Team Link')
    const replacement = activation(live.session.id, {
      activation: { ...durable.activation, id: activationIdSchema.parse('activation-live-replacement'), status: 'running' },
    })
    fake.teams.getTeam.mockResolvedValue(teamState([replacement]))
    teamChanged({ type: 'activation/changed', binding: replacement, cursor: 3, createdAt: 3 })
    await vi.waitFor(() => {
      expect(connected.close).toHaveBeenCalledTimes(1)
      expect(fake.teamLinks.connect).toHaveBeenCalledTimes(2)
      expect(internal.bindings.get(key(teamId, recipientId))?.activationId).toBe(replacement.activation.id)
    })
    expect(firstUsageLease.revoke).toHaveBeenCalledOnce()
    const replacementLink = fake.links[1]
    if (replacementLink === undefined) throw new Error('client did not replace its Team Link')
    const replacementUsageLease = fake.usageProofLeases[1]
    if (replacementUsageLease === undefined) throw new Error('client did not issue a usage proof for its replacement binding')
    teamChanged({
      type: 'participant/changed',
      participant: participant({ phase: 'left' }),
      cursor: 4,
      createdAt: 4,
    })
    await vi.waitFor(() => {
      expect(replacementLink.close).toHaveBeenCalledTimes(1)
      expect(internal.bindings).toHaveLength(0)
    })
    expect(replacementUsageLease.revoke).toHaveBeenCalledOnce()
    fake.agents.get.mockReturnValue(undefined)
    disposed({ agent: live })
    await client.close()
    expect(fake.usageProofIssuer.close).toHaveBeenCalledOnce()
  })

  it('requires an active local or remote Agent participant before issuing a usage proof', async () => {
    const fake = fakeContext()
    const target = agent('agent-participant-eligibility')
    const durable = activation(target.session.id)
    fake.agents.get.mockReturnValue(target)
    const client = new TeamAgentClient(fake.ctx)
    const internal = client as unknown as DiscoveryInternals

    fake.teams.getTeam.mockResolvedValueOnce(teamState([durable], [participant({ phase: 'left' })]))
    await internal.reconcile(target)
    expect(internal.bindings).toHaveLength(0)
    expect(fake.usageProofIssuer.issue).not.toHaveBeenCalled()

    fake.teams.getTeam.mockResolvedValueOnce(teamState([durable], [participant({ kind: 'service' })]))
    await internal.reconcile(target)
    expect(internal.bindings).toHaveLength(0)
    expect(fake.usageProofIssuer.issue).not.toHaveBeenCalled()

    fake.teams.getTeam.mockResolvedValueOnce(teamState([durable], [participant({ kind: 'remote-agent' })]))
    await internal.reconcile(target)
    expect(internal.bindings.get(key(teamId, recipientId))?.agent).toBe(target)
    expect(fake.usageProofIssuer.issue).toHaveBeenCalledWith(durable)

    await client.close()
  })

  it('keeps local discovery failures and binding eligibility outside fixed delivery', async () => {
    const fake = fakeContext()
    const target = agent('agent-discovery-edges')
    const invalid = agent('agent-discovery-invalid', {})
    const durable = activation(target.session.id)
    fake.agents.get.mockImplementation((id: string) => id === target.id ? target : id === invalid.id ? invalid : undefined)
    const client = new TeamAgentClient(fake.ctx)
    const internal = client as unknown as DiscoveryInternals
    client.start()
    client.start()

    internal.closing = true
    await internal.reconcile(target)
    expect(fake.teams.getTeam).not.toHaveBeenCalled()
    internal.closing = false

    await internal.reconcile(invalid)
    fake.agents.get.mockReturnValue(undefined)
    await internal.reconcile(target)
    fake.agents.get.mockReturnValue(target)

    fake.teams.getTeam.mockResolvedValueOnce(teamState([]))
    await internal.reconcile(target)
    expect(internal.deliveries).toHaveLength(0)

    internal.bind(target, teamIdSchema.parse('team-foreign'), recipientId, durable)
    internal.bind(target, teamId, participantIdSchema.parse('participant-foreign'), durable)
    internal.bind(target, teamId, recipientId, activation(SessionId('foreign-session')))
    internal.bind(target, teamId, recipientId, activation(target.session.id, {
      activation: { ...durable.activation, status: 'offline' },
    }))
    expect(internal.deliveries).toHaveLength(0)

    const read = Promise.withResolvers<ReturnType<typeof teamState>>()
    fake.teams.getTeam.mockReturnValueOnce(read.promise)
    const racing = internal.reconcile(target)
    internal.closing = true
    read.resolve(teamState([durable]))
    await racing
    internal.closing = false

    fake.teams.getTeam.mockResolvedValueOnce(teamState([durable]))
    await internal.reconcile(target)
    expect(internal.deliveries).toHaveLength(1)
    internal.bind(target, teamId, recipientId, durable)
    internal.releaseBinding('missing-binding', binding(target, durable))
    const missingDeliveryKey = key(teamIdSchema.parse('team-missing-delivery'), recipientId)
    const missingDeliveryBinding = binding(target, activation(target.session.id, {
      activation: { ...durable.activation, teamId: teamIdSchema.parse('team-missing-delivery') },
    }))
    internal.bindings.set(missingDeliveryKey, missingDeliveryBinding)
    internal.releaseBinding(missingDeliveryKey, missingDeliveryBinding)

    fake.teams.getTeam.mockRejectedValueOnce(new Error('Team read failed'))
    internal.scheduleReconciliation(target)
    await vi.waitFor(() => {
      expect(fake.warn).toHaveBeenCalledWith(expect.stringContaining('activation reconciliation failed'))
    })

    const rejectedKey = key(teamIdSchema.parse('team-rejected-close'), recipientId)
    const rejectedBinding = binding(target, activation(target.session.id, {
      activation: { ...durable.activation, teamId: teamIdSchema.parse('team-rejected-close') },
    }))
    internal.bindings.set(rejectedKey, rejectedBinding)
    internal.deliveries.set(rejectedKey, {
      close: () => Promise.reject(new Error('released close failed')),
    } as unknown as FixedBindingTeamAgentLinkDelivery)
    internal.releaseBinding(rejectedKey, rejectedBinding)
    await vi.waitFor(() => {
      expect(fake.warn).toHaveBeenCalledWith(expect.stringContaining('released binding close failed'))
    })

    const warnings = fake.warn.mock.calls.length
    const quietKey = key(teamIdSchema.parse('team-quiet-close'), recipientId)
    const quietBinding = binding(target, activation(target.session.id, {
      activation: { ...durable.activation, teamId: teamIdSchema.parse('team-quiet-close') },
    }))
    internal.closing = true
    internal.bindings.set(quietKey, quietBinding)
    internal.deliveries.set(quietKey, {
      close: () => Promise.reject(new Error('quiet close failed')),
    } as unknown as FixedBindingTeamAgentLinkDelivery)
    internal.releaseBinding(quietKey, quietBinding)
    await vi.waitFor(() => { expect(internal.closingDeliveries).toHaveLength(0) })
    expect(fake.warn).toHaveBeenCalledTimes(warnings)
    internal.closing = false

    const quietRead = Promise.withResolvers<ReturnType<typeof teamState>>()
    fake.teams.getTeam.mockReturnValueOnce(quietRead.promise)
    const reads = fake.teams.getTeam.mock.calls.length
    internal.scheduleReconciliation(target)
    await vi.waitFor(() => { expect(fake.teams.getTeam).toHaveBeenCalledTimes(reads + 1) })
    internal.closing = true
    quietRead.reject(new Error('quiet Team read failed'))
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    internal.closing = false

    const rejecting = new TeamAgentClient(fake.ctx)
    const rejectingInternal = rejecting as unknown as DiscoveryInternals
    const rejectingKey = key(teamIdSchema.parse('team-active-close'), recipientId)
    const rejectingBinding = binding(target, activation(target.session.id, {
      activation: { ...durable.activation, teamId: teamIdSchema.parse('team-active-close') },
    }))
    rejectingInternal.bindings.set(rejectingKey, rejectingBinding)
    rejectingInternal.deliveries.set(rejectingKey, {
      close: () => Promise.reject(new Error('active close failed')),
    } as unknown as FixedBindingTeamAgentLinkDelivery)
    await expect(rejecting.close()).rejects.toThrow('Team Agent Client disposal failed')

    await client.close()
    client.start()
  })

  it('uses Link notifications, claim, and acknowledgement for local direct delivery', async () => {
    const fake = fakeContext()
    const target = agent('agent-link-delivery')
    const durable = activation(target.session.id)
    fake.agents.get.mockReturnValue(target)
    const { client, internal, binding: local } = fixed(fake, target, durable, { reconnectDelayMs: 1 })
    const connected = await connect(internal, fake, local)
    const accepted = envelope({ causationId: 'envelope-parent' })
    connected.claim.mockResolvedValue(deliveryClaim(durable, accepted))

    await connected.emit(accepted)
    const injected = target.inputCalls[0]
    if (injected === undefined || typeof injected !== 'object' || injected === null) {
      throw new Error('Link delivery did not enter the target inbox')
    }
    expect((injected as { readonly source?: { readonly causationId?: unknown } }).source?.causationId).toBe('envelope-parent')
    expect(connected.claim).toHaveBeenCalledWith(accepted.channelId, accepted.id)
    expect(fake.sessions.flush).toHaveBeenCalledWith(target.session)
    expect(connected.acknowledge).toHaveBeenCalledWith(accepted.channelId, accepted.id, 2)

    const calls = target.spies.inject.mock.calls.length
    connected.claim.mockResolvedValueOnce(undefined)
    await connected.emit(envelope({ id: 'envelope-already-acknowledged' }))
    expect(target.spies.inject).toHaveBeenCalledTimes(calls)
    await client.close()
  })

  it('cancels only the exact local target with keepInbox before acknowledging a soft interrupt', async () => {
    const fake = fakeContext()
    const target = agent('agent-soft-interrupt')
    const durable = activation(target.session.id)
    fake.agents.get.mockReturnValue(target)
    const { client, internal, binding: local } = fixed(fake, target, durable)
    const connected = await connect(internal, fake, local)
    const notification: TeamLinkInterruptNotification = {
      deliveryId: 'interrupt-delivery-edges' as TeamLinkDeliveryId,
      interrupt: interrupt(durable),
    }

    await connected.emitInterrupt(notification)
    expect(target.spies.cancel).toHaveBeenCalledExactlyOnceWith({ kind: 'user' }, { keepInbox: true })
    expect(connected.acknowledgeInterrupt).toHaveBeenCalledExactlyOnceWith(
      notification.deliveryId,
      notification.interrupt.id,
    )

    await expect(connected.emitInterrupt({
      ...notification,
      interrupt: interrupt(durable, { target: { ...notification.interrupt.target, sessionId: 'foreign-session' } }),
    })).rejects.toThrow('does not target the current Link binding')
    await expect(connected.emitInterrupt({
      ...notification,
      interrupt: interrupt(durable, { acknowledgedAt: 2 }),
    })).rejects.toThrow('does not target the current Link binding')

    target.spies.cancel.mockImplementationOnce(() => {
      fake.agents.get.mockReturnValue(undefined)
    })
    await connected.emitInterrupt({ ...notification, deliveryId: 'interrupt-after-departure' as TeamLinkDeliveryId })
    expect(connected.acknowledgeInterrupt).toHaveBeenCalledTimes(1)
    await internal.interrupt(connection(local, connected), notification)
    fake.agents.get.mockReturnValue(undefined)
    await connected.emitInterrupt(notification)
    expect(target.spies.cancel).toHaveBeenCalledTimes(2)
    await client.close()
  })

  it('rejects unsupported Link claims and stale local ownership before changing an inbox', async () => {
    const fake = fakeContext()
    const target = agent('agent-stale-claim')
    const durable = activation(target.session.id)
    fake.agents.get.mockReturnValue(target)
    const { client, internal, binding: local } = fixed(fake, target, durable, { reconnectDelayMs: 1 })
    const connected = link(durable)
    const current = connection(local, connected)
    internal.connections.set(key(teamId, recipientId), current)

    await internal.deliver(current, envelope({ payload: { text: '' } }))
    expect(fake.warn).toHaveBeenCalledWith(expect.stringContaining('has no admissible message payload'))
    connected.claim.mockResolvedValueOnce(deliveryClaim(durable, envelope(), {
      channel: channel({ manifest: { ...channel().manifest, adapter: { type: 'other', version: 1 } } }),
    }))
    await expect(internal.deliver(current, envelope())).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    connected.claim.mockResolvedValueOnce(deliveryClaim(durable, envelope(), {
      channel: channel({
        manifest: {
          ...channel().manifest,
          adapter: { type: 'direct', version: 2 },
          participants: [
            ...channel().manifest.participants,
            { id: participantIdSchema.parse('participant-third'), role: 'third' },
          ],
        },
      }),
    }))
    await internal.deliver(current, envelope())
    const malformedV3 = envelope({ id: 'envelope-v3-malformed', payload: { content: [] } })
    connected.claim.mockResolvedValueOnce(deliveryClaim(durable, malformedV3, {
      channel: channel({ manifest: { ...channel().manifest, adapter: { type: 'direct', version: 3 } } }),
    }))
    await internal.deliver(current, malformedV3)
    connected.claim.mockResolvedValueOnce(deliveryClaim(durable, envelope(), {
      channel: channel({
        manifest: {
          ...channel().manifest,
          adapter: { type: 'direct', version: 3 },
          participants: [
            ...channel().manifest.participants,
            { id: participantIdSchema.parse('participant-third-v3'), role: 'third' },
          ],
        },
      }),
    }))
    await internal.deliver(current, envelope())
    connected.claim.mockResolvedValueOnce(deliveryClaim(durable, envelope(), {
      binding: activation(target.session.id, { activation: { ...durable.activation, status: 'offline' } }),
    }))
    await internal.deliver(current, envelope())
    connected.claim.mockResolvedValueOnce(deliveryClaim(durable, envelope(), { envelopeId: 'another-envelope' }))
    await internal.deliver(current, envelope())
    connected.claim.mockResolvedValueOnce(deliveryClaim(durable, envelope(), { delivery: 'turn' }))
    await internal.deliver(current, envelope())
    expect(target.spies.inject).not.toHaveBeenCalled()

    internal.connections.delete(key(teamId, recipientId))
    await internal.deliver(current, envelope())
    internal.connections.set(key(teamId, recipientId), current)
    fake.agents.get.mockReturnValue(undefined)
    await internal.deliver(current, envelope())
    expect(target.spies.inject).not.toHaveBeenCalled()
    await client.close()
  })

  it('fails closed when a non-direct delivery claim omits its required model view', async () => {
    const fake = fakeContext()
    const target = agent('agent-generic-view-required')
    const durable = activation(target.session.id)
    fake.agents.get.mockReturnValue(target)
    const { client, internal, binding: local } = fixed(fake, target, durable)
    const connected = link(durable)
    const current = connection(local, connected)
    internal.connections.set(key(teamId, recipientId), current)
    const generic = envelope({ channelId: 'channel-generic-view', kind: 'request' })
    const genericChannel = channel({
      manifest: {
        ...channel().manifest,
        id: generic.channelId,
        adapter: { type: 'consult', version: 1 },
        viewPolicy: { type: 'recent-window', version: 1 },
      },
    })
    connected.claim.mockResolvedValueOnce({
      binding: durable,
      channel: genericChannel,
      envelopeId: generic.id,
      delivery: generic.delivery,
    })

    await expect(internal.deliver(current, generic)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(fake.sessions.flush).not.toHaveBeenCalled()
    expect(connected.acknowledge).not.toHaveBeenCalled()
    await client.close()
  })

  it('abandons a post-claim stale binding and a mismatched task-start response before inbox admission', async () => {
    const fake = fakeContext()
    const target = agent('agent-post-claim-stale')
    const durable = activation(target.session.id)
    const bindingKey = key(teamId, recipientId)
    fake.agents.get.mockReturnValue(target)
    const { client, internal, binding: local } = fixed(fake, target, durable)
    const connected = link(durable)
    const current = connection(local, connected)
    internal.connections.set(bindingKey, current)

    const { link: _link, ...withoutLink } = current
    internal.connections.set(bindingKey, withoutLink)
    await internal.interrupt(withoutLink, {
      deliveryId: 'interrupt-without-link' as TeamLinkDeliveryId,
      interrupt: interrupt(durable),
    })
    await internal.deliver(withoutLink, envelope())
    internal.connections.set(bindingKey, current)
    fake.agents.get.mockReturnValueOnce(target).mockReturnValueOnce(undefined)
    await internal.deliver(current, envelope())
    fake.agents.get.mockReturnValue(target)

    // oxlint-disable-next-line typescript/no-misused-promises -- the test double changes ownership during the awaited claim.
    connected.claim.mockImplementationOnce(async () => {
      fake.agents.get.mockReturnValue(undefined)
      return deliveryClaim(durable)
    })
    await internal.deliver(current, envelope())
    expect(target.inputCalls).toHaveLength(0)
    fake.agents.get.mockReturnValue(target)

    const assigned = taskAssignmentEnvelope(durable)
    connected.claim.mockResolvedValueOnce(channelDeliveryClaimSchema.parse({
      binding: durable,
      channel: taskAssignmentChannel(durable),
      envelopeId: assigned.id,
      delivery: 'turn',
    }))
    connected.claimTaskAttemptStart.mockResolvedValueOnce({})
    await internal.deliver(current, assigned)
    expect(connected.claimTaskAttemptStart).toHaveBeenCalledWith({
      taskId: 'task-edges',
      attemptId: 'attempt-edges',
      assignedRevision: 1,
      channelId: assigned.channelId,
      envelopeId: assigned.id,
    })
    expect(target.inputCalls).toHaveLength(0)
    expect(connected.acknowledge).not.toHaveBeenCalled()

    connected.claim.mockResolvedValueOnce(channelDeliveryClaimSchema.parse({
      binding: durable,
      channel: taskAssignmentChannel(durable),
      envelopeId: 'another-task-assignment-envelope',
      delivery: 'turn',
    }))
    await internal.deliver(current, assigned)
    expect(connected.claimTaskAttemptStart).toHaveBeenCalledTimes(1)

    const wrongManifestBinding = taskAssignmentChannel(durable, {
      manifest: {
        ...taskAssignmentChannel(durable).manifest,
        limits: {
          ...taskAssignmentChannel(durable).manifest.limits,
          activationId: 'activation-other',
        },
      },
    })
    const misbound = taskAssignmentEnvelope(durable, {
      id: 'envelope-task-assignment-misbound',
      payload: {
        ...taskAssignmentEnvelope(durable).payload,
        activationId: 'activation-other',
      },
    })
    connected.claim.mockResolvedValueOnce(channelDeliveryClaimSchema.parse({
      binding: durable,
      channel: wrongManifestBinding,
      envelopeId: misbound.id,
      delivery: 'turn',
    }))
    await internal.deliver(current, misbound)
    expect(connected.claimTaskAttemptStart).toHaveBeenCalledTimes(1)

    const { link: _removedLink, ...admissionWithoutLink } = current
    await internal.admitEnvelope(admissionWithoutLink, envelope(), deliveryClaim(durable), envelopeMessageForPreStep())
    await client.close()
  })

  it('holds Team-envelope pre-steps at their matching Session flush barrier and rejects a failed source', async () => {
    const fake = fakeContext()
    const target = agent('agent-pre-step')
    const durable = activation(target.session.id)
    fake.agents.get.mockReturnValue(target)
    const { client, internal } = fixed(fake, target, durable)
    client.start()
    const listener = fake.callbacks.get('agent/pre-step')?.[0] as unknown as PreStepListener | undefined
    if (listener === undefined) throw new Error('client did not register its pre-step listener')
    const entered = vi.fn(async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: [] }))
    const accepted = envelope()
    const barrier = internal.installFlushBarrier(target, accepted.id)
    expect(internal.installFlushBarrier(target, accepted.id)).toBe(barrier)
    const waiting = listener({ agent: target, messages: [envelopeMessageForPreStep(accepted)] }, entered)
    await Promise.resolve()
    expect(entered).not.toHaveBeenCalled()
    barrier.resolve()
    await expect(waiting).resolves.toEqual({ kind: 'enter', messages: [] })

    const failed = envelope({ id: 'envelope-flush-failed' })
    const failedBarrier = internal.installFlushBarrier(target, failed.id)
    const rejected = listener({ agent: target, messages: [envelopeMessageForPreStep(failed)] }, entered)
    failedBarrier.reject(new Error('flush failed'))
    await expect(rejected).resolves.toEqual({ kind: 'reject' })
    await expect(listener({
      agent: target,
      messages: [{ source: { kind: 'user' } } as unknown as UserMessage],
    }, entered)).resolves.toEqual({ kind: 'enter', messages: [] })
    await expect(listener({
      agent: target,
      messages: [envelopeMessageForPreStep(envelope({ id: 'envelope-without-barrier' }))],
    }, entered)).resolves.toEqual({ kind: 'enter', messages: [] })
    await client.close()
  })

  it('rejects a failed context source at pre-step and clears its barrier', async () => {
    const fake = fakeContext()
    const target = agent('agent-flush-failure')
    const durable = activation(target.session.id)
    fake.agents.get.mockReturnValue(target)
    fake.sessions.flush.mockRejectedValue(new Error('flush failed'))
    const { client, internal, binding: local } = fixed(fake, target, durable)
    const connected = link(durable)
    const current = connection(local, connected)
    internal.connections.set(key(teamId, recipientId), current)
    client.start()
    await expect(internal.deliver(current, envelope())).rejects.toThrow('flush failed')
    expect(connected.acknowledge).not.toHaveBeenCalled()
    const listener = fake.callbacks.get('agent/pre-step')?.[0] as unknown as PreStepListener | undefined
    if (listener === undefined) throw new Error('client did not register its pre-step listener')
    await expect(listener({ agent: target, messages: [envelopeMessageForPreStep()] }, async () => ({ kind: 'enter', messages: [] })))
      .resolves.toEqual({ kind: 'reject' })
    expect(internal.flushBarriers).toHaveLength(0)
    await client.close()
  })

  it('closes a late Link after fixed delivery closes and reconnects after a connection failure', async () => {
    const fake = fakeContext()
    const target = agent('agent-reconnect')
    const durable = activation(target.session.id)
    const first = Promise.withResolvers<TeamLink>()
    const stale = link(durable)
    const recovered = link(durable)
    const failure = new Error('connection failed')
    fake.agents.get.mockReturnValue(target)
    fake.teamLinks.connect
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(recovered)
    const initial = fixed(fake, target, durable, { reconnectDelayMs: 1 })
    initial.internal.scheduleConnection(initial.binding)
    await vi.waitFor(() => { expect(fake.teamLinks.connect).toHaveBeenCalledTimes(1) })
    const closing = initial.client.close()
    first.resolve(stale)
    await vi.waitFor(() => {
      expect(stale.close).toHaveBeenCalledTimes(1)
      expect(stale.onNotify).not.toHaveBeenCalled()
    })
    await closing

    const retry = fixed(fake, target, durable, { reconnectDelayMs: 1 })
    retry.internal.scheduleConnection(retry.binding)
    await vi.waitFor(() => { expect(fake.teamLinks.connect).toHaveBeenCalledTimes(2) })
    await vi.waitFor(() => { expect(fake.warn).toHaveBeenCalledWith(expect.stringContaining('connection failed')) })
    await vi.waitFor(() => {
      expect(fake.teamLinks.connect).toHaveBeenCalledTimes(3)
      expect(recovered.listenerCount()).toBe(1)
    })
    await retry.client.close()
  })

  it('reconnects one exact current binding after its published Link reaches a terminal failure', async () => {
    const fake = fakeContext()
    const target = agent('agent-terminal-reconnect')
    const durable = activation(target.session.id)
    const first = link(durable)
    const recovered = link(durable)
    const afterFailure = link(durable)
    fake.agents.get.mockReturnValue(target)
    fake.teamLinks.connect
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(recovered)
      .mockResolvedValueOnce(afterFailure)
    const { client, internal, binding: local } = fixed(fake, target, durable, { reconnectDelayMs: 1 })
    internal.scheduleConnection(local)
    await vi.waitFor(() => { expect(first.listenerCount()).toBe(1) })

    first.terminal.resolve(undefined)
    await vi.waitFor(() => {
      expect(first.close).toHaveBeenCalledTimes(1)
      expect(fake.teamLinks.connect).toHaveBeenCalledTimes(2)
      expect(recovered.listenerCount()).toBe(1)
    })
    recovered.close.mockRejectedValueOnce(new Error('close after terminal failure'))
    recovered.terminal.reject(new Error('transport ended'))
    await vi.waitFor(() => {
      expect(recovered.close).toHaveBeenCalledTimes(1)
      expect(fake.teamLinks.connect).toHaveBeenCalledTimes(3)
      expect(afterFailure.listenerCount()).toBe(1)
    })
    await client.close()
  })

  it('bounds and cancels reconnect timers when a binding becomes stale or client admission closes', async () => {
    vi.useFakeTimers()
    try {
      const fake = fakeContext()
      const target = agent('agent-reconnect-timer')
      const durable = activation(target.session.id)
      const bindingKey = key(teamId, recipientId)
      fake.agents.get.mockReturnValue(target)
      const { client, internal, binding: local } = fixed(fake, target, durable, { reconnectDelayMs: 10 })

      internal.scheduleReconnect(local)
      internal.scheduleReconnect(local)
      expect(internal.reconnectTimers).toHaveLength(1)
      const staleTimer = internal.reconnectTimers.get(bindingKey)
      if (staleTimer === undefined) throw new Error('reconnect timer was not registered')
      const replacementTimer = setTimeout(() => {}, 100)
      internal.reconnectTimers.set(bindingKey, replacementTimer)
      await vi.advanceTimersByTimeAsync(10)
      expect(internal.reconnectTimers.get(bindingKey)).toBe(replacementTimer)
      internal.clearReconnect(bindingKey)
      expect(internal.reconnectTimers).toHaveLength(0)
      internal.scheduleReconnect(local)
      internal.clearReconnect('missing-reconnect')
      await vi.advanceTimersByTimeAsync(10)
      expect(fake.teamLinks.connect).toHaveBeenCalledTimes(1)

      const connected = internal.connections.get(bindingKey)
      if (connected === undefined) throw new Error('timer reconnect did not publish a connection')
      internal.scheduleReconnect(local)
      expect(internal.reconnectTimers).toHaveLength(0)
      internal.disconnect(connected)
      internal.connections.delete(bindingKey)
      internal.bindings.set(bindingKey, local)
      internal.scheduleReconnect(local)
      internal.bindings.delete(bindingKey)
      await vi.advanceTimersByTimeAsync(10)
      expect(fake.teamLinks.connect).toHaveBeenCalledTimes(1)

      internal.bindings.set(bindingKey, local)
      internal.scheduleReconnect(local)
      internal.closing = true
      await vi.advanceTimersByTimeAsync(10)
      expect(fake.teamLinks.connect).toHaveBeenCalledTimes(1)
      internal.closing = false
      internal.closing = true
      internal.scheduleReconnect(local)
      expect(internal.reconnectTimers).toHaveLength(0)
      internal.closing = false
      internal.bindings.set(bindingKey, local)
      internal.scheduleReconnect(local)
      expect(internal.reconnectTimers).toHaveLength(1)
      await client.close()
      await vi.advanceTimersByTimeAsync(10)
      expect(fake.teamLinks.connect).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not read Agents after its context begins unloading before a delayed reconnect', async () => {
    vi.useFakeTimers()
    try {
      const fake = fakeContext()
      const target = agent('agent-reconnect-unloading')
      const durable = activation(target.session.id)
      fake.agents.get.mockReturnValue(target)
      const { client, internal, binding: local } = fixed(fake, target, durable, { reconnectDelayMs: 10 })

      internal.scheduleReconnect(local)
      expect(internal.reconnectTimers).toHaveLength(1)
      fake.agents.get.mockClear()
      fake.fiber.state = FiberState.UNLOADING
      fake.agents.get.mockImplementation(() => {
        throw new Error('Agents read after context disposal')
      })

      await vi.advanceTimersByTimeAsync(10)
      expect(fake.agents.get).not.toHaveBeenCalled()
      expect(fake.teamLinks.connect).not.toHaveBeenCalled()
      expect(internal.reconnectTimers).toHaveLength(0)
      await client.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not reconnect after close while a terminal Link retry is pending', async () => {
    vi.useFakeTimers()
    try {
      const fake = fakeContext()
      const target = agent('agent-close-before-reconnect')
      const durable = activation(target.session.id)
      const first = link(durable)
      fake.agents.get.mockReturnValue(target)
      fake.teamLinks.connect.mockResolvedValue(first)
      const { client, internal, binding: local } = fixed(fake, target, durable, { reconnectDelayMs: 10 })

      internal.scheduleConnection(local)
      await vi.advanceTimersByTimeAsync(0)
      expect(first.listenerCount()).toBe(1)
      first.terminal.resolve(undefined)
      await vi.advanceTimersByTimeAsync(0)
      expect(internal.reconnectTimers).toHaveLength(1)

      await client.close()
      await vi.advanceTimersByTimeAsync(10)
      expect(fake.teamLinks.connect).toHaveBeenCalledTimes(1)
      expect(internal.reconnectTimers).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps closing pending until its connected Link reaches close quiescence', async () => {
    const fake = fakeContext()
    const target = agent('agent-close')
    const durable = activation(target.session.id)
    const delayed = link(durable)
    const close = Promise.withResolvers<undefined>()
    delayed.close.mockReturnValueOnce(close.promise)
    fake.agents.get.mockReturnValue(target)
    fake.teamLinks.connect.mockResolvedValue(delayed)
    const { client, internal, binding: local } = fixed(fake, target, durable)
    await connect(internal, fake, local)

    let settled = false
    const closing = client.close().then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    close.resolve(undefined)
    await closing
    expect(delayed.close).toHaveBeenCalledTimes(1)
  })

  it('surfaces a Link close failure after an explicit binding disconnect', async () => {
    const fake = fakeContext()
    const target = agent('agent-close-failure')
    const durable = activation(target.session.id)
    const failing = link(durable)
    failing.close.mockRejectedValueOnce(new Error('link close failed'))
    fake.agents.get.mockReturnValue(target)
    fake.teamLinks.connect.mockResolvedValueOnce(failing)
    const { client, internal, binding: local } = fixed(fake, target, durable)
    const connecting = internal.connect(local)
    await vi.waitFor(() => { expect(failing.listenerCount()).toBe(1) })
    const current = internal.connections.get(key(teamId, recipientId))
    if (current === undefined) throw new Error('close failure connection did not attach')
    internal.disconnect(current)
    await expect(connecting).rejects.toThrow('link close failed')
    await client.close()
  })

  it.each([{ maxTaskReportReminders: -1 }, { maxTaskHandoffBytes: 127 }])('rejects invalid task recovery limits %o', (config) => {
    const fake = fakeContext()
    const target = agent('task-recovery-config')
    expect(() => Config(config)).toThrow()
    expect(() => new FixedBindingTeamAgentLinkDelivery(fake.ctx, { agent: target, binding: activation(target.session.id) }, config))
      .toThrow()
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid workspace mutation attempt limit: %s', (workspaceMutationMaxAttempts) => {
    const fake = fakeContext()
    const target = agent('workspace-mutation-config')
    expect(() => Config({ workspaceMutationMaxAttempts })).toThrow()
    expect(() => new FixedBindingTeamAgentLinkDelivery(fake.ctx, { agent: target, binding: activation(target.session.id) },
      { workspaceMutationMaxAttempts })).toThrow('workspaceMutationMaxAttempts must be a positive safe integer')
    expect(() => new TeamAgentClient(fake.ctx, { workspaceMutationMaxAttempts })).toThrow('workspaceMutationMaxAttempts must be a positive safe integer')
  })

  it('resolves the default and positive workspace mutation attempt limits', async () => {
    expect(Config({}).workspaceMutationMaxAttempts).toBe(3)
    const fake = fakeContext()
    const target = agent('workspace-mutation-config-positive')
    for (const workspaceMutationMaxAttempts of [1, Number.MAX_SAFE_INTEGER]) {
      expect(Config({ workspaceMutationMaxAttempts }).workspaceMutationMaxAttempts).toBe(workspaceMutationMaxAttempts)
      const delivery = new FixedBindingTeamAgentLinkDelivery(fake.ctx, { agent: target, binding: activation(target.session.id) },
        { workspaceMutationMaxAttempts })
      await delivery.close()
    }
  })

  it('validates configuration and settles normal, failed, and timed-out accepted work during close', async () => {
    const fake = fakeContext()
    const target = agent('agent-serialized')
    const durable = activation(target.session.id)
    expect(() => new FixedBindingTeamAgentLinkDelivery(fake.ctx, { agent: target, binding: durable }, { disposalTimeoutMs: 0 })).toThrow('positive safe integer')
    expect(() => new FixedBindingTeamAgentLinkDelivery(fake.ctx, { agent: target, binding: durable }, { reconnectDelayMs: 0 })).toThrow('positive safe integer')
    expect(() => new FixedBindingTeamAgentLinkDelivery(fake.ctx, { agent: target, binding: durable }, { linkProvider: ' local' })).toThrow('linkProvider')
    const { client, internal } = fixed(fake, target, durable, { disposalTimeoutMs: 1 })
    const first = internal.serialize(target, async () => {})
    const second = internal.serialize(target, async () => {})
    await Promise.all([first, second])
    expect(internal.deliveryTails).toHaveLength(0)

    const failed = Promise.reject(new Error('delivery failed'))
    void failed.catch(() => {})
    internal.accepted.add(failed)
    await expect(client.close()).rejects.toThrow('Team Agent Client disposal failed')

    const timed = fixed(fake, agent('agent-timeout'), activation(SessionId('agent-timeout')), { disposalTimeoutMs: 1 })
    const timedInternal = timed.internal
    timedInternal.accepted.add(new Promise<void>(() => {}))
    await expect(timed.client.close()).rejects.toThrow('disposal exceeded 1ms')

    const cleanup = apply(fake.ctx)
    await cleanup()
    await apply(fake.ctx)()
  })

  it('rejects an in-flight pre-step when client teardown cancels its unresolved flush barrier', async () => {
    const fake = fakeContext()
    const target = agent('agent-teardown-barrier')
    fake.agents.get.mockReturnValue(target)
    const { client, internal } = fixed(fake, target, activation(target.session.id))
    client.start()
    const listener = fake.callbacks.get('agent/pre-step')?.[0] as unknown as PreStepListener | undefined
    if (listener === undefined) throw new Error('client did not register its pre-step listener')
    const barrier = internal.installFlushBarrier(target, envelope().id)
    const proposed = listener({ agent: target, messages: [envelopeMessageForPreStep()] }, async () => ({
      kind: 'enter', messages: [],
    }))
    await Promise.resolve()

    await client.close()
    await expect(proposed).resolves.toEqual({ kind: 'reject' })
    barrier.resolve()
  })

  it('keeps one fixed binding current while refusing unavailable or ineligible work', async () => {
    const fake = fakeContext()
    const target = agent('agent-binding-edges')
    const durable = activation(target.session.id)
    const unavailable = fixed(fake, target, durable)
    unavailable.internal.scheduleConnection(unavailable.binding)
    expect(fake.teamLinks.connect).not.toHaveBeenCalled()

    fake.agents.get.mockReturnValue(target)
    const offline = fixed(fake, target, activation(target.session.id, {
      activation: { ...durable.activation, status: 'offline' },
    }))
    offline.client.start()
    expect(fake.teamLinks.connect).not.toHaveBeenCalled()

    const { client, internal, binding: local } = fixed(fake, target, durable)

    const currentLink = link(durable)
    const current = connection(local, currentLink)
    internal.connections.set(key(teamId, recipientId), current)
    internal.scheduleConnection(local)
    expect(fake.teamLinks.connect).not.toHaveBeenCalled()
    internal.closing = true
    internal.scheduleConnection(local)
    expect(fake.teamLinks.connect).not.toHaveBeenCalled()
    internal.closing = false

    await internal.notify(current, envelope({ audience: null }))
    await internal.notify(current, envelope({ audience: [senderId] }))
    expect(currentLink.claim).toHaveBeenCalledOnce()
    expect(target.spies.inject).not.toHaveBeenCalled()

    const other = binding(agent('agent-binding-other'))
    internal.disconnectBinding(other)
    expect(internal.connections.get(key(teamId, recipientId))).toBe(current)
    internal.disconnect(current)
    internal.disconnect(current)
    expect(current.controller.signal.aborted).toBe(true)
    await offline.client.close()
    await client.close()
  })

  it('replaces stale Link connections and contains late stale connection failures', async () => {
    const fake = fakeContext()
    const target = agent('agent-connection-edges')
    const durable = activation(target.session.id)
    const bindingKey = key(teamId, recipientId)
    fake.agents.get.mockReturnValue(target)
    const { client, internal, binding: local } = fixed(fake, target, durable)

    const displaced = connection(local, link(durable))
    internal.connections.set(bindingKey, displaced)
    const replacement = link(durable)
    fake.teamLinks.connect.mockResolvedValueOnce(replacement)
    const replacing = internal.connect(local)
    await vi.waitFor(() => {
      expect(replacement.onNotify).toHaveBeenCalledTimes(1)
      expect(displaced.controller.signal.aborted).toBe(true)
    })
    const replacementConnection = internal.connections.get(bindingKey)
    if (replacementConnection === undefined) throw new Error('replacement Link did not remain current')
    internal.disconnect(replacementConnection)
    await replacing

    internal.bindings.set(bindingKey, local)
    const staleAfterSubscription = link(durable)
    const unsubscribe = vi.fn()
    staleAfterSubscription.onNotify.mockImplementationOnce(() => {
      internal.connections.delete(bindingKey)
      return unsubscribe
    })
    fake.teamLinks.connect.mockResolvedValueOnce(staleAfterSubscription)
    await internal.connect(local)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(staleAfterSubscription.close).toHaveBeenCalledTimes(1)

    internal.bindings.set(bindingKey, local)
    const late = Promise.withResolvers<TeamLink>()
    fake.teamLinks.connect.mockReturnValueOnce(late.promise)
    const connecting = internal.connect(local)
    await vi.waitFor(() => {
      expect(internal.connections.get(bindingKey)).toBeDefined()
    })
    internal.disconnectBinding(local)
    late.reject(new Error('late stale connection failure'))
    await expect(connecting).resolves.toBeUndefined()
    await client.close()
  })

  it('rejects malformed local delivery before inbox admission and clears only its matching barriers', async () => {
    const fake = fakeContext()
    const target = agent('agent-delivery-edges')
    const durable = activation(target.session.id)
    const bindingKey = key(teamId, recipientId)
    fake.agents.get.mockReturnValue(target)
    const { client, internal, binding: local } = fixed(fake, target, durable)
    const connected = link(durable)
    const current = connection(local, connected)
    internal.connections.set(bindingKey, current)

    const withoutLink: LinkConnection = {
      binding: current.binding,
      controller: current.controller,
      released: current.released,
      release: current.release,
      unsubscribe: current.unsubscribe,
      unsubscribeInterrupt: current.unsubscribeInterrupt,
      stopping: current.stopping,
    }
    internal.connections.set(bindingKey, withoutLink)
    await internal.deliver(withoutLink, envelope())
    internal.connections.set(bindingKey, current)

    internal.connections.delete(bindingKey)
    await internal.notify(current, envelope())
    internal.connections.set(bindingKey, current)

    const throwing = envelope({ id: 'envelope-inbox-throws' })
    connected.claim.mockResolvedValueOnce(deliveryClaim(durable, throwing))
    target.spies.inject.mockImplementationOnce(() => {
      throw new Error('inbox rejected source')
    })
    await expect(internal.deliver(current, throwing)).rejects.toThrow('inbox rejected source')
    expect(internal.flushBarriers).toHaveLength(0)

    const recorded = envelope({ id: 'envelope-already-recorded' })
    const events = target.session.events as unknown as { type: string; data: unknown }[]
    events.push({
      type: 'user/message',
      data: envelopeMessageForPreStep(recorded),
    })
    connected.claim.mockResolvedValueOnce(deliveryClaim(durable, recorded))
    await internal.deliver(current, recorded)
    expect(target.spies.inject).toHaveBeenCalledTimes(1)
    expect(connected.acknowledge).toHaveBeenCalledWith(recorded.channelId, recorded.id, 2)

    const other = agent('agent-delivery-other')
    const first = internal.installFlushBarrier(target, envelope({ id: 'envelope-target-barrier' }).id)
    const second = internal.installFlushBarrier(other, envelope({ id: 'envelope-other-barrier' }).id)
    internal.removeMessageFlushBarrier(target, { source: { kind: 'user' } } as unknown as UserMessage)
    expect(internal.flushBarriers).toHaveLength(2)
    internal.removeMessageFlushBarrier(target, envelopeMessageForPreStep(envelope({ id: 'envelope-target-barrier' })))
    expect(internal.flushBarriers).toHaveLength(1)
    internal.clearFlushBarriers(target)
    expect(internal.flushBarriers).toHaveLength(1)
    internal.clearFlushBarriers(other)
    expect(internal.flushBarriers).toHaveLength(0)
    first.resolve()
    second.resolve()

    internal.flushedEnvelopeSources.set(JSON.stringify([target.session.id, 'envelope-flushed-source']), target.session.id)
    internal.flushedEnvelopeSources.set(JSON.stringify([other.session.id, 'envelope-other-flushed-source']), other.session.id)
    internal.clearFlushedEnvelopeSources(target)
    expect(internal.flushedEnvelopeSources).toHaveLength(1)
    internal.clearFlushedEnvelopeSources(other)
    expect(internal.flushedEnvelopeSources).toHaveLength(0)

    const unrenderable = Object.assign(new Error('unrenderable failure'), {
      toString: () => { throw new Error('cannot render') },
    })
    internal.track(Promise.reject(unrenderable), 'unrenderable failure')
    await vi.waitFor(() => {
      expect(fake.warn).toHaveBeenCalledWith(expect.stringContaining('[unrenderable thrown value]'))
      expect(internal.accepted).toHaveLength(0)
    })
    const warnings = fake.warn.mock.calls.length
    internal.closing = true
    internal.track(Promise.reject(new Error('quiet during close')), 'quiet failure')
    await vi.waitFor(() => { expect(internal.accepted).toHaveLength(0) })
    expect(fake.warn).toHaveBeenCalledTimes(warnings)
    await client.close()
  })
})


it('rejects an owner acknowledgement without exact stopped-task Session evidence', async () => {
  const fake = fakeContext()
  const target = agent('agent-late-task-cancel')
  const durable = activation(target.session.id)
  fake.agents.get.mockReturnValue(target)
  const { client, internal, binding: local } = fixed(fake, target, durable)
  const connected = await connect(internal, fake, local)
  const notification: TeamLinkTaskCancellationNotification = {
    taskId: 'old-task' as TeamLinkTaskCancellationNotification['taskId'], revision: 4, phase: 'running',
    cancellation: { requestedRevision: 3, requestedBy: durable.activation.participantId, requestedAt: 1,
      target: { kind: 'attempt', attemptId: 'old-attempt' as TaskAttemptId,
        participantId: durable.activation.participantId, activationId: durable.activation.id } },
  }
  await expect(connected.emitTaskCancellation(notification)).rejects.toThrow('no exact Session evidence')
  expect(target.spies.cancel).not.toHaveBeenCalled()
  expect(target.spies.whenIdle).not.toHaveBeenCalled()
  expect(connected.acknowledgeTaskCancellation).not.toHaveBeenCalled()
  await client.close()
})
