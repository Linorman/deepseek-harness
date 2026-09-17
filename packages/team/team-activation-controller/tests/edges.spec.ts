import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@clocky/cordis'
import { openAgentWorkspaceLease } from '@clocky/clocky-agent'
import type { Agent } from '@clocky/clocky-agent'
import { AgentRuntimeTerminationUnconfirmedError } from '@clocky/clocky-agent-runtime'
import type { ActivationHandle, AgentRuntimeFencer } from '@clocky/clocky-agent-runtime'
import { SessionId } from '@clocky/clocky-session'
import {
  TeamError,
  activationBindingSnapshotSchema,
  activationIdSchema,
  participantSnapshotSchema,
  teamClosureIdempotencyKeySchema,
  teamIdSchema,
  teamStateSnapshotSchema,
} from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ActivationRecoverySnapshot,
  ActivationStatus,
  ParticipantSnapshot,
  TeamStateSnapshot,
} from '@clocky/clocky-team'
import {
  apply,
  TeamActivationController,
} from '../src/index.ts'
import type { TeamActivationRequest } from '../src/index.ts'

const teamId = teamIdSchema.parse('team-controller-edges')
const participant = participantSnapshotSchema.parse({
  id: 'participant-controller-edges',
  teamId,
  kind: 'local-agent',
  displayName: 'Controller worker',
  role: 'worker',
  capabilities: [],
  phase: 'active',
})

interface Entry {
  readonly key: string
  readonly raw: ActivationHandle
  readonly localAgent: Agent | undefined
  binding: ActivationBindingSnapshot
  statusTail: Promise<void>
  statusUnsubscribe: () => void
  stopping: boolean
  disposal: Promise<void> | undefined
  lease: unknown
}

interface Internals {
  entries: Map<string, Entry>
  pending: Map<string, { readonly sessionId: SessionId; readonly operation: Promise<unknown> }>
  recoveries: Map<string, Promise<unknown>>
  accepted: Set<Promise<unknown>>
  closing: boolean
  syncStatus(entry: Entry, status: ActivationStatus): Promise<void>
  syncRawHealth(entry: Entry): Promise<void>
  observeHandleStatus(entry: Entry, status: ActivationHandle['activation']): void
  release(entry: Entry): void
  track(operation: Promise<unknown>, subject: string): void
}

interface FakeContext {
  readonly ctx: Context
  readonly callbacks: Map<string, ((payload: unknown) => void)[]>
  readonly teams: {
    readonly getTeam: ReturnType<typeof vi.fn>
    readonly bindActivation: ReturnType<typeof vi.fn>
    readonly updateActivationStatus: ReturnType<typeof vi.fn>
    readonly fenceActivation: ReturnType<typeof vi.fn>
    readonly quiesceActivation: ReturnType<typeof vi.fn>
    readonly transitionTeamPhase: ReturnType<typeof vi.fn>
    readonly registerSystemActivationProofSource: ReturnType<typeof vi.fn>
    readonly registerSystemPhaseProofSource: ReturnType<typeof vi.fn>
  }
  readonly agentRuntimes: {
    readonly activate: ReturnType<typeof vi.fn>
    readonly getProvider: ReturnType<typeof vi.fn>
    readonly getFencer: ReturnType<typeof vi.fn>
  }
  readonly warn: ReturnType<typeof vi.fn>
}

/** Build one minimal Team/AgentRuntime context whose durable state tests can control. */
function fakeContext(): FakeContext {
  const callbacks = new Map<string, ((payload: unknown) => void)[]>()
  const teams = {
    getTeam: vi.fn(),
    bindActivation: vi.fn(),
    updateActivationStatus: vi.fn(),
    fenceActivation: vi.fn(),
    quiesceActivation: vi.fn(),
    transitionTeamPhase: vi.fn(),
    registerSystemActivationProofSource: vi.fn(() => () => {}),
    registerSystemPhaseProofSource: vi.fn(() => () => {}),
  }
  const agentRuntimes = { activate: vi.fn(), getProvider: vi.fn(), getFencer: vi.fn() }
  const warn = vi.fn()
  const ctx = {
    get: vi.fn(() => undefined),
    on: vi.fn((event: string, callback: (payload: unknown) => void) => {
      const handlers = callbacks.get(event) ?? []
      handlers.push(callback)
      callbacks.set(event, handlers)
      return () => { callbacks.set(event, (callbacks.get(event) ?? []).filter(handler => handler !== callback)) }
    }),
    reflect: { provide: vi.fn() },
    logger: { warn },
    teams,
    agentRuntimes,
    agents: {},
  } as unknown as Context
  return { ctx, callbacks, teams, agentRuntimes, warn }
}

/** Make one local Agent-shaped value with a Session identity shared by its handle. */
function localAgent(sessionId: SessionId): Agent {
  return {
    id: sessionId,
    session: { id: sessionId, header: { id: sessionId, version: 0, createdAt: 0, teamId, participantId: participant.id } },
    status: 'idle',
    inbox: {},
    ctx: { get: () => undefined } as unknown as Context,
    options: {},
    cancel() {},
    whenIdle: async () => {},
    runMaintenance: async <T>(task: (signal: AbortSignal) => Promise<T>) => await task(new AbortController().signal),
    send() {},
    followup() {},
    steer() {},
    inject() {},
  } as unknown as Agent
}

/** Make one durable Team activation binding. */
function binding(
  sessionId: SessionId,
  status: ActivationStatus = 'idle',
  overrides: Record<string, unknown> = {},
): ActivationBindingSnapshot {
  return activationBindingSnapshotSchema.parse({
    activation: {
      id: activationIdSchema.parse('activation-controller-edges'),
      teamId,
      participantId: participant.id,
      status,
    },
    sessionId,
    provider: 'in-process',
    ...overrides,
  })
}

/** Build one persisted SDK recovery plan for activation-controller edge coverage. */
function recoveryPlan(pid = 123): ActivationRecoverySnapshot {
  return {
    kind: 'sdk-local-cold-replace',
    version: 1,
    runtimeProvider: 'in-process',
    profile: 'controller-edges',
    agent: { provider: 'mock', model: 'mock' },
    process: { hostId: 'test-host', pid, started: `test-start-${String(pid)}` },
  }
}

/** Make one complete Team state for a controlled current activation projection. */
function state(
  cursor: number,
  activations: readonly ActivationBindingSnapshot[] = [],
  overrides: Partial<TeamStateSnapshot['team']> = {},
  participants: readonly ParticipantSnapshot[] = [participant],
): TeamStateSnapshot {
  const goal = {
    teamId,
    revision: 1,
    objective: 'Controller edge tests',
    phase: 'active' as const,
    budgets: {},
  }
  const team = {
    id: teamId,
    depth: 0,
    maxTeamDepth: 0,
    goal,
    phase: 'active' as const,
    cursor,
    createdAt: 0,
    updatedAt: cursor,
    ...overrides,
  }
  return teamStateSnapshotSchema.parse({
    team,
    goal: team.goal,
    rules: {},
    budgets: {},
    participants,
    activations,
    tasks: [],
    workspaceAllocations: [],
    channelIds: [],
  })
}

/** Build one mutable raw handle whose health and disposal outcomes are controllable. */
function rawHandle(sessionId: SessionId, options: {
  readonly local?: Agent | null
  readonly status?: ActivationStatus
  readonly dispose?: () => Promise<void>
  readonly health?: () => ActivationHandle['activation']
  readonly activationId?: ActivationHandle['activation']['id']
  readonly recovery?: ActivationRecoverySnapshot | undefined
} = {}): ActivationHandle & {
  setStatus(status: ActivationStatus): void
  readonly interrupt: ReturnType<typeof vi.fn>
  readonly disposeSpy: ReturnType<typeof vi.fn>
} {
  let status = options.status ?? 'idle'
  const local = options.local === undefined ? localAgent(sessionId) : options.local ?? undefined
  const activation = {
    ...binding(sessionId, status).activation,
    ...options.activationId === undefined ? {} : { id: options.activationId },
  }
  const interrupt = vi.fn()
  const dispose = vi.fn(options.dispose ?? (async () => {}))
  const statusListeners = new Set<(next: ActivationHandle['activation']) => void>()
  return {
    activation,
    sessionId,
    localAgent: local,
    ...options.recovery === undefined ? {} : { recovery: options.recovery },
    setStatus(next: ActivationStatus) {
      status = next
      const observed = { ...activation, status }
      for (const listener of statusListeners) listener(observed)
    },
    health: async () => options.health?.() ?? { ...activation, status },
    onStatus(listener) {
      statusListeners.add(listener)
      return () => { statusListeners.delete(listener) }
    },
    interrupt,
    dispose,
    disposeSpy: dispose,
  }
}

/** Build one request against the default active fixture Team. */
function request(sessionId: SessionId, expectedCursor = 3): TeamActivationRequest {
  return {
    teamId,
    participantId: participant.id,
    expectedCursor,
    provider: 'in-process',
    sessionId,
    seed: { kind: 'fresh' },
    agent: { options: {} },
    signal: new AbortController().signal,
  }
}

/** Couple mock Team operations to one mutable durable activation projection. */
function configureDurableBinding(
  fake: FakeContext,
  raw: ActivationHandle,
  cursor = 3,
  participants: readonly ParticipantSnapshot[] = [participant],
) {
  let current: ActivationBindingSnapshot | undefined
  const additional: ActivationBindingSnapshot[] = []
  let currentCursor = cursor
  let teamOverrides: Partial<TeamStateSnapshot['team']> = {}
  // oxlint-disable-next-line typescript/no-misused-promises -- Vitest models an asynchronous Team read.
  fake.teams.getTeam.mockImplementation(async () => state(currentCursor, [
    ...(current === undefined ? [] : [current]),
    ...additional,
  ], teamOverrides, participants))
  // oxlint-disable-next-line typescript/no-misused-promises -- Vitest models an asynchronous Team mutation.
  fake.teams.bindActivation.mockImplementation(async ({ binding: next }: { readonly binding: ActivationBindingSnapshot }) => {
    current = next
    currentCursor += 1
    return current
  })
  // oxlint-disable-next-line typescript/no-misused-promises -- Vitest models an asynchronous Team mutation.
  fake.teams.updateActivationStatus.mockImplementation(async ({ status }: { readonly status: ActivationStatus }) => {
    if (current === undefined) throw new Error('missing durable activation')
    current = { ...current, activation: { ...current.activation, status } }
    currentCursor += 1
    return current
  })
  // oxlint-disable-next-line typescript/no-misused-promises -- Vitest models one atomic Hub recovery transition.
  fake.teams.fenceActivation.mockImplementation(async () => {
    if (current === undefined) throw new Error('missing durable activation')
    if (current.quiescedAt !== undefined) return state(currentCursor, [current])
    current = {
      ...current,
      activation: { ...current.activation, status: 'offline' },
      quiescedAt: currentCursor + 1,
      quiescenceSource: 'fenced',
      quiescedWakeChannelIds: [],
    }
    currentCursor += 1
    return state(currentCursor, [current])
  })
  // oxlint-disable-next-line typescript/no-misused-promises -- Vitest models one atomic Hub quiescence transition.
  fake.teams.quiesceActivation.mockImplementation(async () => {
    if (current === undefined) throw new Error('missing durable activation')
    if (current.quiescedAt !== undefined) return state(currentCursor, [current])
    current = {
      ...current,
      activation: { ...current.activation, status: 'offline' },
      quiescedAt: currentCursor + 1,
      quiescenceSource: 'quiesced',
      quiescedWakeChannelIds: [],
    }
    currentCursor += 1
    return state(currentCursor, [current])
  })
  // oxlint-disable-next-line typescript/no-misused-promises -- Vitest models one controller-owned cancellation stall transition.
  fake.teams.transitionTeamPhase.mockImplementation(async ({ phase, reason }: {
    readonly phase: TeamStateSnapshot['team']['phase']
    readonly reason?: TeamStateSnapshot['team']['stallReason']
  }) => {
    teamOverrides = {
      ...teamOverrides,
      phase,
      ...phase === 'stalled' && reason !== undefined ? { stallReason: reason } : {},
    }
    currentCursor += 1
    return state(currentCursor, current === undefined ? [] : [current], teamOverrides, participants)
  })
  fake.agentRuntimes.activate.mockResolvedValue(raw)
  fake.agentRuntimes.getProvider.mockReturnValue({
    name: 'in-process', terminationMode: 'owned-process', activate: fake.agentRuntimes.activate,
  })
  return {
    current: () => current,
    cursor: () => currentCursor,
    replace(next: ActivationBindingSnapshot | undefined) { current = next },
    append(next: ActivationBindingSnapshot) { additional.push(next) },
    setCursor(next: number) { currentCursor = next },
    setTeam(next: Partial<TeamStateSnapshot['team']>) { teamOverrides = { ...teamOverrides, ...next } },
  }
}

describe('Team activation controller edges', () => {
  it('passes the cold-replacement cancellation signal to a supervisor fence', async () => {
    const fake = fakeContext()
    const signal = new AbortController().signal
    const supervisor = {
      resolve: vi.fn(),
      fence: vi.fn(async (_candidate: ActivationBindingSnapshot, observed: AbortSignal) => {
        expect(observed).toBe(signal)
      }),
    }
    const contextGet = Reflect.get(fake.ctx, 'get') as ReturnType<typeof vi.fn>
    contextGet.mockReturnValue(supervisor)
    const controller = new TeamActivationController(fake.ctx)
    const candidate = binding(SessionId('controller-supervisor-signal'), 'offline', {
      recovery: {
        ...recoveryPlan(),
        supervisor: {
          name: 'test-supervisor', version: 1, hostId: 'test-host', endpointId: 'test-endpoint',
          generation: activationIdSchema.parse('activation-controller-edges'), terminationMode: 'owned-process',
        },
      },
    })
    const fencer = (controller as unknown as {
      recoveryFencer(value: ActivationBindingSnapshot, cancellation?: AbortSignal): AgentRuntimeFencer | undefined
    }).recoveryFencer(candidate, signal)
    if (fencer === undefined) throw new Error('supervisor fencer was not resolved')
    fencer.validate(candidate)
    await fencer.fence(candidate)
    expect(supervisor.fence).toHaveBeenCalledOnce()
    await controller.close()
  })

  it('fences one stale external epoch before persisting it offline and publishing a persisted-resume replacement', async () => {
    const fake = fakeContext()
    const sessionId = SessionId('controller-cold-replace')
    const old = binding(sessionId, 'idle', { recovery: recoveryPlan() })
    const replacementId = activationIdSchema.parse('activation-controller-replacement')
    const replacementRecovery = recoveryPlan(456)
    const replacement = rawHandle(sessionId, {
      local: null,
      activationId: replacementId,
      recovery: replacementRecovery,
    })
    const durable = configureDurableBinding(fake, replacement)
    durable.replace(old)
    const fenced: ActivationBindingSnapshot[] = []
    const fencer: AgentRuntimeFencer = {
      provider: 'in-process',
      validate() {},
      async fence(value) { fenced.push(value) },
    }
    fake.agentRuntimes.getFencer.mockReturnValue(fencer)
    const controller = new TeamActivationController(fake.ctx)

    const lease = await controller.coldReplace({
      teamId,
      participantId: participant.id,
      activationId: old.activation.id,
      signal: new AbortController().signal,
    })

    expect(fenced).toHaveLength(1)
    expect(fenced[0]?.activation).toEqual(old.activation)
    expect(fenced[0]?.sessionId).toBe(sessionId)
    expect(fenced[0]?.provider).toBe('in-process')
    expect(fake.teams.fenceActivation).toHaveBeenCalledWith(expect.objectContaining({
      activationId: old.activation.id,
      participantId: participant.id,
    }))
    expect(fake.agentRuntimes.activate).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'in-process',
      sessionId,
      seed: { kind: 'resume' },
    }))
    expect(lease.binding.activation.id).toBe(replacementId)
    expect(durable.current()?.activation.id).toBe(replacementId)
    expect(durable.current()?.recovery).toEqual(replacementRecovery)

    const unavailable = fakeContext()
    const unavailableDurable = configureDurableBinding(unavailable, replacement)
    unavailableDurable.replace(old)
    await expect(new TeamActivationController(unavailable.ctx).coldReplace({
      teamId,
      participantId: participant.id,
      activationId: old.activation.id,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_FENCE_UNAVAILABLE' })

    const failed = fakeContext()
    const failedDurable = configureDurableBinding(failed, replacement)
    failedDurable.replace(old)
    failed.agentRuntimes.getFencer.mockReturnValue({
      provider: 'in-process',
      validate() {},
      async fence() { throw new Error('external process still reachable') },
    })
    await expect(new TeamActivationController(failed.ctx).coldReplace({
      teamId,
      participantId: participant.id,
      activationId: old.activation.id,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_FENCE_FAILED' })
    expect(failed.teams.fenceActivation).not.toHaveBeenCalled()
  })

  it('retries replacement publication after a cursor race leaves the fenced epoch offline', async () => {
    const fake = fakeContext()
    const sessionId = SessionId('controller-cold-replace-race')
    const old = binding(sessionId, 'idle', { recovery: recoveryPlan() })
    const rejected = rawHandle(sessionId, {
      local: null,
      activationId: activationIdSchema.parse('activation-controller-cold-replace-rejected'),
    })
    const replacement = rawHandle(sessionId, {
      local: null,
      activationId: activationIdSchema.parse('activation-controller-cold-replace-retry'),
      recovery: recoveryPlan(789),
    })
    const durable = configureDurableBinding(fake, replacement)
    durable.replace(old)
    fake.agentRuntimes.activate.mockReset()
    fake.agentRuntimes.activate.mockResolvedValueOnce(rejected).mockResolvedValueOnce(replacement)
    fake.agentRuntimes.getFencer.mockReturnValue({ provider: 'in-process', validate() {}, async fence() {} })
    fake.teams.bindActivation.mockRejectedValueOnce(new TeamError('concurrent Team update', 'TEAM_CURSOR_CONFLICT'))

    const lease = await new TeamActivationController(fake.ctx).coldReplace({
      teamId,
      participantId: participant.id,
      activationId: old.activation.id,
      signal: new AbortController().signal,
    })

    expect(rejected.disposeSpy).toHaveBeenCalledOnce()
    expect(fake.agentRuntimes.activate).toHaveBeenCalledTimes(2)
    expect(lease.binding.activation.id).toBe(replacement.activation.id)
    expect(durable.current()?.activation.id).toBe(replacement.activation.id)
  })

  it('reserves an accepted cold replacement through fenced teardown', async () => {
    const fake = fakeContext()
    const sessionId = SessionId('controller-cold-replace-close')
    const old = binding(sessionId, 'idle', { recovery: recoveryPlan() })
    const replacement = rawHandle(sessionId, {
      local: null,
      activationId: activationIdSchema.parse('activation-controller-cold-replace-close'),
      recovery: recoveryPlan(654),
    })
    const durable = configureDurableBinding(fake, replacement)
    durable.replace(old)
    let releaseFence: (() => void) | undefined
    fake.agentRuntimes.getFencer.mockReturnValue({
      provider: 'in-process',
      validate() {},
      async fence() {
        await new Promise<void>((resolve) => { releaseFence = resolve })
      },
    } satisfies AgentRuntimeFencer)
    const controller = new TeamActivationController(fake.ctx)
    const replacing = controller.coldReplace({
      teamId,
      participantId: participant.id,
      activationId: old.activation.id,
      signal: new AbortController().signal,
    })
    void replacing.catch(() => {})
    await vi.waitFor(() => { expect(releaseFence).toBeTypeOf('function') })

    await expect(controller.activate(request(sessionId, durable.cursor()))).rejects.toMatchObject({
      code: 'TEAM_ACTIVATION_RECOVERY_CONFLICT',
    })
    await expect(controller.coldReplace({
      teamId,
      participantId: participant.id,
      activationId: old.activation.id,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_CONFLICT' })

    let closed = false
    const closing = controller.close().then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)
    releaseFence?.()
    await expect(replacing).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
    await expect(closing).resolves.toBeUndefined()
    expect(fake.teams.fenceActivation).not.toHaveBeenCalled()
    expect(fake.agentRuntimes.activate).not.toHaveBeenCalled()
  })

  it('retries an already-fenced offline epoch without a second process fence', async () => {
    const fake = fakeContext()
    const sessionId = SessionId('controller-cold-replace-retry')
    const old = binding(sessionId, 'idle', { recovery: recoveryPlan() })
    const replacement = rawHandle(sessionId, {
      local: null,
      activationId: activationIdSchema.parse('activation-controller-cold-replace-retry'),
      recovery: recoveryPlan(987),
    })
    const durable = configureDurableBinding(fake, replacement)
    durable.replace(old)
    const fence = vi.fn(async () => {})
    fake.agentRuntimes.getFencer.mockReturnValue({ provider: 'in-process', validate() {}, fence })
    fake.agentRuntimes.activate.mockReset()
    fake.agentRuntimes.activate.mockRejectedValueOnce(new Error('replacement allocation failed'))
    fake.agentRuntimes.activate.mockResolvedValueOnce(replacement)
    const controller = new TeamActivationController(fake.ctx)

    await expect(controller.coldReplace({
      teamId,
      participantId: participant.id,
      activationId: old.activation.id,
      signal: new AbortController().signal,
    })).rejects.toThrow('replacement allocation failed')
    expect(durable.current()).toMatchObject({ activation: { status: 'offline' } })

    const lease = await controller.coldReplace({
      teamId,
      participantId: participant.id,
      activationId: old.activation.id,
      signal: new AbortController().signal,
    })
    expect(fence).toHaveBeenCalledTimes(1)
    expect(fake.teams.fenceActivation).toHaveBeenCalledTimes(1)
    expect(lease.binding.activation.id).toBe(replacement.activation.id)
    await lease.dispose()
    await controller.close()
  })

  it('retries wake cleanup only for an externally fenced epoch', async () => {
    const fake = fakeContext()
    const sessionId = SessionId('controller-fenced-wake-retry')
    const old = binding(sessionId, 'offline', {
      recovery: recoveryPlan(),
      quiescedAt: 4,
      quiescenceSource: 'fenced',
      quiescedWakeChannelIds: ['channel-controller-fenced-wake'],
    })
    const replacement = rawHandle(sessionId, {
      local: null,
      activationId: activationIdSchema.parse('activation-controller-fenced-wake-replacement'),
      recovery: recoveryPlan(988),
    })
    const durable = configureDurableBinding(fake, replacement)
    durable.replace(old)
    const fence = vi.fn(async () => {})
    fake.agentRuntimes.getFencer.mockReturnValue({ provider: 'in-process', validate() {}, fence })
    const controller = new TeamActivationController(fake.ctx)

    const lease = await controller.coldReplace({
      teamId,
      participantId: participant.id,
      activationId: old.activation.id,
      signal: new AbortController().signal,
    })

    expect(fence).not.toHaveBeenCalled()
    expect(fake.teams.fenceActivation).toHaveBeenCalledOnce()
    expect(lease.binding.activation.id).toBe(replacement.activation.id)
    await lease.dispose()
    await controller.close()
  })

  it('rejects cold replacement of a locally quiesced epoch', async () => {
    const fake = fakeContext()
    const sessionId = SessionId('controller-local-quiescence')
    const old = binding(sessionId, 'offline', {
      recovery: recoveryPlan(),
      quiescedAt: 4,
      quiescenceSource: 'quiesced',
      quiescedWakeChannelIds: [],
    })
    const durable = configureDurableBinding(fake, rawHandle(sessionId, { local: null }))
    durable.replace(old)
    const controller = new TeamActivationController(fake.ctx)

    await expect(controller.coldReplace({
      teamId,
      participantId: participant.id,
      activationId: old.activation.id,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_CONFLICT' })
    expect(fake.agentRuntimes.getFencer).not.toHaveBeenCalled()
    expect(fake.teams.fenceActivation).not.toHaveBeenCalled()
    expect(fake.agentRuntimes.activate).not.toHaveBeenCalled()
    await controller.close()
  })

  it('rechecks quiescence provenance after asynchronous fencing', async () => {
    const fake = fakeContext()
    const sessionId = SessionId('controller-quiescence-race')
    const old = binding(sessionId, 'idle', { recovery: recoveryPlan() })
    const locallyQuiesced = binding(sessionId, 'offline', {
      recovery: recoveryPlan(),
      quiescedAt: 4,
      quiescenceSource: 'quiesced',
      quiescedWakeChannelIds: [],
    })
    const durable = configureDurableBinding(fake, rawHandle(sessionId, { local: null }))
    durable.replace(old)
    const fence = vi.fn(async () => { durable.replace(locallyQuiesced) })
    fake.agentRuntimes.getFencer.mockReturnValue({ provider: 'in-process', validate() {}, fence })
    const controller = new TeamActivationController(fake.ctx)

    await expect(controller.coldReplace({
      teamId,
      participantId: participant.id,
      activationId: old.activation.id,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_CONFLICT' })
    expect(fence).toHaveBeenCalledOnce()
    expect(fake.teams.fenceActivation).not.toHaveBeenCalled()
    expect(fake.agentRuntimes.activate).not.toHaveBeenCalled()
    await controller.close()
  })

  it('rejects replacement when another epoch supersedes the fenced predecessor', async () => {
    const fake = fakeContext()
    const sessionId = SessionId('controller-newer-epoch-race')
    const old = binding(sessionId, 'idle', { recovery: recoveryPlan() })
    const newer = binding(sessionId, 'offline', {
      recovery: recoveryPlan(989),
      activation: { ...old.activation, id: activationIdSchema.parse('activation-controller-newer-epoch'), status: 'offline' },
      quiescedAt: 4,
      quiescenceSource: 'fenced',
      quiescedWakeChannelIds: [],
    })
    const durable = configureDurableBinding(fake, rawHandle(sessionId, { local: null }))
    durable.replace(old)
    const fence = vi.fn(async () => { durable.append(newer) })
    fake.agentRuntimes.getFencer.mockReturnValue({ provider: 'in-process', validate() {}, fence })
    const controller = new TeamActivationController(fake.ctx)

    await expect(controller.coldReplace({
      teamId,
      participantId: participant.id,
      activationId: old.activation.id,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_CONFLICT' })
    expect(fence).toHaveBeenCalledOnce()
    expect(fake.teams.fenceActivation).toHaveBeenCalledOnce()
    expect(fake.agentRuntimes.activate).not.toHaveBeenCalled()
    await controller.close()
  })

  it('requires a matching fencer before replacing an offline epoch without fence proof', async () => {
    const fake = fakeContext()
    const sessionId = SessionId('controller-offline-unfenced')
    const old = binding(sessionId, 'offline', { recovery: recoveryPlan() })
    const replacement = rawHandle(sessionId, { local: null })
    const durable = configureDurableBinding(fake, replacement)
    durable.replace(old)
    const controller = new TeamActivationController(fake.ctx)

    await expect(controller.activate(request(sessionId, durable.cursor()))).rejects.toMatchObject({
      code: 'TEAM_ACTIVATION_RECOVERY_CONFLICT',
    })
    expect(fake.agentRuntimes.activate).not.toHaveBeenCalled()

    await expect(controller.coldReplace({
      teamId,
      participantId: participant.id,
      activationId: old.activation.id,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_FENCE_UNAVAILABLE' })

    fake.agentRuntimes.getFencer.mockReturnValue({
      provider: 'in-process',
      validate() { throw new Error('wrong recovery host') },
      async fence() {},
    } satisfies AgentRuntimeFencer)
    await expect(controller.coldReplace({
      teamId,
      participantId: participant.id,
      activationId: old.activation.id,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_FENCE_FAILED' })
    expect(fake.teams.fenceActivation).not.toHaveBeenCalled()
  })

  it('joins same-Session callers, mirrors handle status, and releases a lease through stopping/offline', async () => {
    const fake = fakeContext()
    const raw = rawHandle(SessionId('controller-edge-session'))
    const durable = configureDurableBinding(fake, raw)
    const controller = new TeamActivationController(fake.ctx)
    const internal = controller as unknown as Internals
    controller.start()

    const first = await controller.activate(request(raw.sessionId))
    const second = await controller.activate(request(raw.sessionId))
    expect(second).toBe(first)
    await expect(first.health()).resolves.toMatchObject({ activation: { status: 'idle' } })
    raw.setStatus('running')
    first.interrupt({ kind: 'user' })
    await vi.waitFor(() => {
      expect(durable.current()?.activation.status).toBe('running')
    })
    expect(raw.interrupt).toHaveBeenCalledWith({ kind: 'user' })
    raw.setStatus('idle')
    await vi.waitFor(() => {
      expect(durable.current()?.activation.status).toBe('idle')
    })
    raw.setStatus('offline')
    await vi.waitFor(() => {
      expect(durable.current()?.activation.status).toBe('offline')
      expect(internal.entries).toHaveLength(0)
    })

    const rawReplacement = rawHandle(raw.sessionId)
    configureDurableBinding(fake, rawReplacement, durable.cursor())
    const replacement = await controller.activate(request(raw.sessionId, durable.cursor()))
    const replacementDispose = replacement.dispose()
    replacement.interrupt({ kind: 'user' })
    rawReplacement.setStatus('idle')
    expect(rawReplacement.interrupt).not.toHaveBeenCalled()
    await expect(replacementDispose).resolves.toBeUndefined()
    await controller.close()
  })

  it('records durable quiescence only after a raw handle settles', async () => {
    const fake = fakeContext()
    const raw = rawHandle(SessionId('controller-quiescence'))
    const durable = configureDurableBinding(fake, raw)
    const controller = new TeamActivationController(fake.ctx)
    const lease = await controller.activate(request(raw.sessionId))

    await lease.dispose()

    expect(raw.disposeSpy).toHaveBeenCalledOnce()
    expect(fake.teams.quiesceActivation).toHaveBeenCalledOnce()
    expect(durable.current()).toMatchObject({ activation: { status: 'offline' } })
    expect(durable.current()?.quiescedAt).toEqual(expect.any(Number))
    expect(durable.current()?.quiescenceSource).toBe('quiesced')
    await controller.close()
  })

  it('settles agent-scoped workspace ownership after local idleness and before raw disposal', async () => {
    const fake = fakeContext()
    const sessionId = SessionId('controller-workspace-settlement')
    const agent = localAgent(sessionId)
    const cancel = vi.fn()
    const whenIdle = vi.fn(async () => {})
    Object.assign(agent, { cancel, whenIdle })
    const settler = {
      settleForActivationDisposal: vi.fn(async () => {}),
    }
    const workspaceLease = openAgentWorkspaceLease(agent, settler)
    const raw = rawHandle(sessionId, { local: agent })
    const durable = configureDurableBinding(fake, raw)
    const lease = await new TeamActivationController(fake.ctx).activate(request(sessionId))

    await lease.dispose()

    expect(fake.teams.updateActivationStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'stopping' }))
    const order = [
      fake.teams.updateActivationStatus.mock.invocationCallOrder[0],
      cancel.mock.invocationCallOrder[0],
      whenIdle.mock.invocationCallOrder[0],
      settler.settleForActivationDisposal.mock.invocationCallOrder[0],
      raw.disposeSpy.mock.invocationCallOrder[0],
      fake.teams.quiesceActivation.mock.invocationCallOrder[0],
    ].map((value) => {
      if (value === undefined) throw new Error('activation disposal did not reach every required stage')
      return value
    })
    expect(order).toEqual([...order].sort((left, right) => left - right))
    expect(durable.current()).toMatchObject({ activation: { status: 'offline' }, quiescenceSource: 'quiesced' })
    workspaceLease.dispose()
  })

  it('routes an unexpected provider offline observation through workspace settlement before release', async () => {
    const fake = fakeContext()
    const sessionId = SessionId('controller-observed-offline-workspace')
    const settler = { settleForActivationDisposal: vi.fn(async () => {}) }
    const agent = localAgent(sessionId)
    const workspaceLease = openAgentWorkspaceLease(agent, settler)
    const raw = rawHandle(sessionId, { local: agent })
    const durable = configureDurableBinding(fake, raw)
    const controller = new TeamActivationController(fake.ctx)
    const internals = controller as unknown as Internals
    await controller.activate(request(sessionId))

    raw.setStatus('offline')

    await vi.waitFor(() => {
      expect(settler.settleForActivationDisposal).toHaveBeenCalledOnce()
      expect(raw.disposeSpy).toHaveBeenCalledOnce()
      expect(fake.teams.quiesceActivation).toHaveBeenCalledOnce()
      expect(internals.entries).toHaveLength(0)
    })
    expect(durable.current()).toMatchObject({ activation: { status: 'offline' }, quiescenceSource: 'quiesced' })
    workspaceLease.dispose()
  })

  it('retains a stopping entry for retry when raw disposal or durable quiescence fails', async () => {
    const workspaceFailure = fakeContext()
    const workspaceSession = SessionId('controller-workspace-settlement-retry')
    const settleForActivationDisposal = vi.fn<() => Promise<void>>(async () => { throw new Error('workspace settlement failed') })
    const failingSettler = { settleForActivationDisposal }
    const workspaceAgent = localAgent(workspaceSession)
    const workspaceRegistration = openAgentWorkspaceLease(workspaceAgent, failingSettler)
    const workspaceRaw = rawHandle(workspaceSession, { local: workspaceAgent })
    const workspaceDurable = configureDurableBinding(workspaceFailure, workspaceRaw)
    const workspaceController = new TeamActivationController(workspaceFailure.ctx)
    const workspaceInternals = workspaceController as unknown as Internals
    const workspaceLease = await workspaceController.activate(request(workspaceSession))

    await expect(workspaceLease.dispose()).rejects.toThrow('workspace settlement failed')
    expect(workspaceRaw.disposeSpy).not.toHaveBeenCalled()
    expect(workspaceDurable.current()).toMatchObject({ activation: { status: 'stopping' } })
    expect(workspaceInternals.entries).toHaveLength(1)
    settleForActivationDisposal.mockResolvedValueOnce()
    await workspaceLease.dispose()
    expect(workspaceDurable.current()).toMatchObject({ activation: { status: 'offline' }, quiescenceSource: 'quiesced' })
    expect(workspaceInternals.entries).toHaveLength(0)
    workspaceRegistration.dispose()

    const rawFailure = fakeContext()
    const raw = rawHandle(SessionId('controller-raw-disposal-retry'), {
      dispose: async () => { throw new Error('raw disposal failed') },
    })
    const rawDurable = configureDurableBinding(rawFailure, raw)
    const rawController = new TeamActivationController(rawFailure.ctx)
    const rawInternals = rawController as unknown as Internals
    const rawLease = await rawController.activate(request(raw.sessionId))

    await expect(rawLease.dispose()).rejects.toThrow('raw disposal failed')
    expect(rawDurable.current()).toMatchObject({ activation: { status: 'stopping' } })
    expect(rawFailure.teams.quiesceActivation).not.toHaveBeenCalled()
    expect(rawInternals.entries).toHaveLength(1)

    raw.disposeSpy.mockResolvedValueOnce(undefined)
    await rawLease.dispose()
    expect(raw.disposeSpy).toHaveBeenCalledTimes(2)
    expect(rawDurable.current()).toMatchObject({ activation: { status: 'offline' }, quiescenceSource: 'quiesced' })
    expect(rawInternals.entries).toHaveLength(0)

    const quiesceFailure = fakeContext()
    const quiesceRaw = rawHandle(SessionId('controller-quiescence-retry'))
    const quiesceDurable = configureDurableBinding(quiesceFailure, quiesceRaw)
    quiesceFailure.teams.quiesceActivation.mockRejectedValueOnce(new Error('quiescence failed'))
    const quiesceController = new TeamActivationController(quiesceFailure.ctx)
    const quiesceInternals = quiesceController as unknown as Internals
    const quiesceLease = await quiesceController.activate(request(quiesceRaw.sessionId))

    await expect(quiesceLease.dispose()).rejects.toThrow('quiescence failed')
    expect(quiesceDurable.current()).toMatchObject({ activation: { status: 'stopping' } })
    expect(quiesceInternals.entries).toHaveLength(1)
    await quiesceLease.dispose()
    expect(quiesceRaw.disposeSpy).toHaveBeenCalledOnce()
    expect(quiesceDurable.current()).toMatchObject({ activation: { status: 'offline' }, quiescenceSource: 'quiesced' })
    expect(quiesceInternals.entries).toHaveLength(0)
  })

  it('durably stalls a cancelling Team when a remote provider cannot prove termination', async () => {
    const fake = fakeContext()
    const sessionId = SessionId('controller-remote-termination-unconfirmed')
    const raw = rawHandle(sessionId, {
      local: null,
      dispose: async () => {
        throw new AgentRuntimeTerminationUnconfirmedError('remote process did not confirm termination')
      },
    })
    const durable = configureDurableBinding(fake, raw)
    const controller = new TeamActivationController(fake.ctx)
    controller.start()
    const lease = await controller.activate(request(sessionId))
    const cancellation = {
      teamId,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse('controller-remote-termination-unconfirmed'),
      actor: { kind: 'system' as const, name: 'team-run' },
      reason: { code: 'USER_CANCELLED', message: 'Cancel the remote activation.' },
      requestedAt: 10,
    }
    durable.setTeam({
      phase: 'quiescing',
      cancellation,
    })

    for (const callback of fake.callbacks.get('team/changed') ?? []) {
      callback({ type: 'team/changed', team: { id: teamId, cancellation } })
    }

    await vi.waitFor(() => {
      expect(raw.disposeSpy).toHaveBeenCalledOnce()
      expect(fake.teams.transitionTeamPhase).toHaveBeenCalledOnce()
    })

    await expect(lease.dispose()).rejects.toMatchObject({ code: 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED' })

    expect(fake.teams.updateActivationStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'stopping' }))
    expect(fake.teams.transitionTeamPhase).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'stalled',
    }))
    expect(fake.teams.quiesceActivation).not.toHaveBeenCalled()
    expect(durable.current()).toMatchObject({ activation: { status: 'stopping' } })
    expect(await fake.ctx.teams.getTeam({ teamId })).toMatchObject({
      team: { phase: 'stalled', stallReason: { code: 'REMOTE_CANCELLATION_UNCONFIRMED' } },
    })
    expect((controller as unknown as Internals).entries).toHaveLength(1)

    raw.setStatus('offline')
    await vi.waitFor(() => {
      expect((controller as unknown as Internals).entries).toHaveLength(0)
      expect(durable.current()).toMatchObject({ activation: { status: 'offline' }, quiescenceSource: 'quiesced' })
    })
  })

  it('rejects closed, mismatched, invalid, and unpublished local placement paths while cleaning raw handles', async () => {
    const fake = fakeContext()
    expect(() => new TeamActivationController(fake.ctx, { disposalTimeoutMs: 0 })).toThrow('positive safe integer')
    expect(() => new TeamActivationController(fake.ctx, { statusSyncAttempts: 0 })).toThrow('positive safe integer')

    const raw = rawHandle(SessionId('controller-validation'))
    configureDurableBinding(fake, raw)
    const controller = new TeamActivationController(fake.ctx)
    const internal = controller as unknown as Internals
    await controller.close()
    await expect(controller.activate(request(raw.sessionId))).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
    internal.closing = false

    fake.teams.getTeam.mockResolvedValue(state(4))
    await expect(controller.activate(request(raw.sessionId, 3))).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
    fake.teams.getTeam.mockResolvedValue(state(3, [], { phase: 'quiescing' }))
    await expect(controller.activate(request(raw.sessionId))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    fake.teams.getTeam.mockResolvedValue(state(3, [], {}, []))
    await expect(controller.activate(request(raw.sessionId))).rejects.toMatchObject({ code: 'TEAM_PARTICIPANT_NOT_FOUND' })
    fake.teams.getTeam.mockResolvedValue(state(3, [], {}, [{ ...participant, kind: 'service' }]))
    await expect(controller.activate(request(raw.sessionId))).rejects.toMatchObject({ code: 'TEAM_PARTICIPANT_NOT_FOUND' })
    fake.teams.getTeam.mockResolvedValue(state(3, [binding(raw.sessionId, 'idle')]))
    await expect(controller.activate(request(raw.sessionId))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(fake.agentRuntimes.activate).not.toHaveBeenCalled()
    fake.teams.getTeam.mockResolvedValue(state(3, [binding(SessionId('another-historical-session'), 'offline')]))
    await expect(controller.activate(request(raw.sessionId))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const remote = { ...participant, kind: 'remote-agent' as const }
    const noLocal = rawHandle(SessionId('controller-remote'), { local: null })
    configureDurableBinding(fake, noLocal, 3, [remote])
    const remoteLease = await controller.activate(request(noLocal.sessionId))
    expect(remoteLease.localAgent).toBeUndefined()
    await remoteLease.dispose()
    expect(noLocal.disposeSpy).toHaveBeenCalledTimes(1)
    const wrongAgent = localAgent(SessionId('other-local-session'))
    const wrongSession = rawHandle(SessionId('controller-wrong-local'), { local: wrongAgent })
    configureDurableBinding(fake, wrongSession)
    await expect(controller.activate(request(wrongSession.sessionId))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const mismatched = rawHandle(SessionId('controller-mismatched-health'), {
      health: () => ({ ...binding(SessionId('controller-mismatched-health')).activation, id: activationIdSchema.parse('other-activation') }),
    })
    configureDurableBinding(fake, mismatched)
    await expect(controller.activate(request(mismatched.sessionId))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const statusSubscriptionFailure = rawHandle(SessionId('controller-status-subscription-failure'))
    statusSubscriptionFailure.onStatus = () => { throw new Error('status subscription failed') }
    configureDurableBinding(fake, statusSubscriptionFailure)
    await expect(controller.activate(request(statusSubscriptionFailure.sessionId))).rejects.toThrow('status subscription failed')
    expect(statusSubscriptionFailure.disposeSpy).toHaveBeenCalledTimes(1)
    expect(internal.entries).toHaveLength(0)

    const cleanupFailure = new Error('raw cleanup failed')
    const rejected = rawHandle(SessionId('controller-bind-rejected'), {
      dispose: async () => { throw cleanupFailure },
    })
    configureDurableBinding(fake, rejected)
    fake.teams.bindActivation.mockRejectedValueOnce(new Error('Hub bind failed'))
    await expect(controller.activate(request(rejected.sessionId))).rejects.toThrow('Team activation binding failed')
  })

  it('serializes pending callers and treats stale/missing/invalid durable status observations as no-ops', async () => {
    const fake = fakeContext()
    const sessionId = SessionId('controller-pending')
    const raw = rawHandle(sessionId)
    const durable = configureDurableBinding(fake, raw)
    let release: (() => void) | undefined
    // oxlint-disable-next-line typescript/no-misused-promises -- Vitest models delayed provider publication.
    fake.agentRuntimes.activate.mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return raw
    })
    const controller = new TeamActivationController(fake.ctx, { statusSyncAttempts: 2 })
    const internal = controller as unknown as Internals
    const first = controller.activate(request(sessionId))
    const second = controller.activate(request(sessionId))
    await expect(controller.activate(request(SessionId('controller-other-session')))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    if (release === undefined) throw new Error('provider activation did not begin')
    internal.pending.set(JSON.stringify([teamId, participant.id]), {
      sessionId,
      operation: Promise.resolve(),
    })
    release()
    expect(await second).toBe(await first)
    internal.pending.clear()
    const entry = [...internal.entries.values()][0]
    if (entry === undefined) throw new Error('controller did not retain accepted entry')

    durable.replace(undefined)
    await internal.syncStatus(entry, 'running')
    durable.replace(binding(sessionId, 'offline'))
    await internal.syncStatus(entry, 'running')
    durable.replace(binding(sessionId, 'idle', { sessionId: SessionId('other-session') }))
    await internal.syncStatus(entry, 'running')
    durable.replace(binding(sessionId, 'idle'))
    fake.teams.updateActivationStatus.mockRejectedValueOnce(new TeamError('stale Team cursor', 'TEAM_CURSOR_CONFLICT'))
    await internal.syncStatus(entry, 'running')
    expect(durable.current()?.activation.status).toBe('running')
    durable.replace(binding(sessionId, 'running'))
    fake.teams.updateActivationStatus.mockRejectedValueOnce(new TeamError('stale Team cursor', 'TEAM_CURSOR_CONFLICT'))
    fake.teams.updateActivationStatus.mockRejectedValueOnce(new TeamError('stale Team cursor', 'TEAM_CURSOR_CONFLICT'))
    await expect(internal.syncStatus(entry, 'idle')).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
    fake.teams.updateActivationStatus.mockRejectedValueOnce(new Error('status persistence failed'))
    await expect(internal.syncStatus(entry, 'idle')).rejects.toThrow('status persistence failed')
    entry.statusTail = Promise.reject(new Error('prior status persistence failed'))
    void entry.statusTail.catch(() => {})
    durable.replace(binding(sessionId, 'idle'))
    await internal.syncStatus(entry, 'idle')

    entry.disposal = Promise.resolve()
    entry.binding = binding(sessionId, 'offline')
    await internal.syncRawHealth(entry)
    const unrenderable = Object.assign(new Error('diagnostic'), {
      [Symbol.toPrimitive]() { throw new Error('unrenderable') },
    })
    internal.track(Promise.reject(unrenderable), 'diagnostic')
    await vi.waitFor(() => {
      expect(fake.warn).toHaveBeenCalledWith(expect.stringContaining('[unrenderable thrown value]'))
    })
    internal.closing = true
    internal.track(Promise.reject(new Error('quiet diagnostic')), 'quiet diagnostic')
    await Promise.resolve()
    internal.release(entry)
    internal.release(entry)
  })

  it('disposes raw handles after close starts during publication and retains failed entries for retry', async () => {
    const fake = fakeContext()
    const raw = rawHandle(SessionId('controller-closing-publication'))
    configureDurableBinding(fake, raw)
    const controller = new TeamActivationController(fake.ctx)
    const internal = controller as unknown as Internals
    // oxlint-disable-next-line typescript/no-misused-promises -- Vitest models provider publication after controller admission closes.
    fake.agentRuntimes.activate.mockImplementation(async () => {
      internal.closing = true
      return raw
    })
    const activation = controller.activate(request(raw.sessionId))
    await expect(activation).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
    expect(raw.disposeSpy).toHaveBeenCalledTimes(1)

    const failing = fakeContext()
    const stoppingFailure = new Error('stopping failed')
    const rawDisposalFailure = new Error('raw failed')
    const failedRaw = rawHandle(SessionId('controller-disposal-failures'), {
      dispose: async () => { throw rawDisposalFailure },
    })
    configureDurableBinding(failing, failedRaw)
    const failureController = new TeamActivationController(failing.ctx)
    const failureLease = await failureController.activate(request(failedRaw.sessionId))
    failing.teams.updateActivationStatus.mockRejectedValueOnce(stoppingFailure)
    await expect(failureLease.dispose()).rejects.toThrow('stopping failed')
    expect(failedRaw.disposeSpy).not.toHaveBeenCalled()
    await expect(failureLease.dispose()).rejects.toThrow('raw failed')

    const single = fakeContext()
    const rawSingle = rawHandle(SessionId('controller-disposal-single'), {
      dispose: async () => { throw new Error('raw-only failure') },
    })
    configureDurableBinding(single, rawSingle)
    const singleController = new TeamActivationController(single.ctx)
    const singleLease = await singleController.activate(request(rawSingle.sessionId))
    await expect(singleLease.dispose()).rejects.toThrow('raw-only failure')
  })

  it('applies as a plugin and reports bounded close timeout after handle admission closes', async () => {
    const fake = fakeContext()
    const effects: Array<() => Promise<void>> = []
    Object.assign(fake.ctx, { effect: (setup: () => Iterable<() => unknown>) => {
      const disposers = [...setup()]
      effects.push(async () => { for (const dispose of disposers.reverse()) await dispose() })
    } })
    apply(fake.ctx)
    const cleanup = effects.pop()!
    expect(fake.teams.registerSystemActivationProofSource).toHaveBeenCalledOnce()
    expect(fake.teams.registerSystemPhaseProofSource).toHaveBeenCalledOnce()
    expect(fake.callbacks.get('team/changed')).toHaveLength(1)
    await cleanup()
    expect(fake.callbacks.get('team/changed')).toHaveLength(0)
    apply(fake.ctx)
    await effects.pop()!()

    const timed = new TeamActivationController(fake.ctx, { disposalTimeoutMs: 1 })
    const internal = timed as unknown as Internals
    internal.accepted.add(new Promise<void>(() => {}))
    await expect(timed.close()).rejects.toThrow('disposal exceeded 1ms')

    const closeEntries = fakeContext()
    const closeRaw = rawHandle(SessionId('controller-close-entry'))
    configureDurableBinding(closeEntries, closeRaw)
    const closeController = new TeamActivationController(closeEntries.ctx)
    await closeController.activate(request(closeRaw.sessionId))
    const closeInternal = closeController as unknown as Internals
    closeInternal.pending.set('completed-pending', { sessionId: closeRaw.sessionId, operation: Promise.resolve() })
    await closeController.close()
    expect(closeRaw.disposeSpy).toHaveBeenCalledTimes(1)

    const failingClose = new TeamActivationController(fake.ctx)
    const failingInternal = failingClose as unknown as Internals
    const acceptedFailure = Promise.reject(new Error('accepted close failure'))
    void acceptedFailure.catch(() => {})
    failingInternal.accepted.add(acceptedFailure)
    await expect(failingClose.close()).rejects.toThrow('Team activation controller disposal failed')

    const timer = vi.spyOn(global, 'setTimeout').mockReturnValue(undefined as never)
    const noTimer = new TeamActivationController(fake.ctx)
    await noTimer.close()
    timer.mockRestore()
  })
})
