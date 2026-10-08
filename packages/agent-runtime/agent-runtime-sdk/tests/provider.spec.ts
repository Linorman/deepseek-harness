import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import type { AgentRuntimeActivationRequest } from '@clocky/clocky-agent-runtime'
import {
  HarnessClient,
  TransportClosedError,
  type HarnessClientOptions,
  type HarnessNotification,
  type NotificationSubscription,
  type SdkActivationState,
  type SdkActivationTarget,
} from '@clocky/clocky-sdk-client'
import { SessionId } from '@clocky/clocky-session'
import type { ProcessIdentity, ProcessInspector } from '@clocky/clocky-subprocess-local'
import { activationBindingSnapshotSchema, participantSnapshotSchema, teamEventSchema, teamIdSchema,
  type ActivationBindingSnapshot } from '@clocky/clocky-team'
import TeamLinkRegistry from '@clocky/clocky-team-link'
import type { TeamLinkEnrollmentProvider } from '@clocky/clocky-team-link'
import * as SdkRuntime from '../src/index.ts'
import {
  harnessSdkActivationClientFactory,
  type SdkActivationClient,
  type SdkActivationClientFactory,
} from '../src/client.ts'

const contexts = new Set<Context>()
const teamId = teamIdSchema.parse('sdk-team')
const participant = participantSnapshotSchema.parse({
  id: 'sdk-remote-participant',
  teamId,
  kind: 'remote-agent',
  displayName: 'SDK remote worker',
  role: 'worker',
  capabilities: [],
  phase: 'active',
})

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
  if (failures.length > 0) throw new AggregateError(failures, 'SDK AgentRuntime test cleanup failed')
})

/** In-memory SDK notification subscription controlled by one scripted runtime client. */
class FakeSubscription implements NotificationSubscription {
  private readonly queue: HarnessNotification[] = []
  private readonly waiters: { resolve: (item: HarnessNotification) => void; reject: (error: Error) => void }[] = []
  private failure: Error | undefined

  /** Number of notifications waiting before the bridge consumes them. */
  get pending(): number {
    return this.queue.length
  }

  next(): Promise<HarnessNotification> {
    const queued = this.queue.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    if (this.failure !== undefined) return Promise.reject(this.failure)
    return new Promise((resolve, reject) => { this.waiters.push({ resolve, reject }) })
  }

  tryNext(): HarnessNotification | undefined {
    return this.queue.shift()
  }

  close(): void {
    this.queue.length = 0
    this.fail(new TransportClosedError('scripted subscription closed'))
  }

  /** Deliver a raw JSON-RPC notification in wire order. */
  push(notification: HarnessNotification): void {
    if (this.failure !== undefined) return
    const waiter = this.waiters.shift()
    if (waiter !== undefined) waiter.resolve(notification)
    else this.queue.push(notification)
  }

  /** End the stream as a child-process transport loss. */
  fail(error: Error): void {
    this.failure ??= error
    for (const waiter of this.waiters.splice(0)) waiter.reject(this.failure)
  }

  /** Iterate the same queue used by the production client's subscription API. */
  async * [Symbol.asyncIterator](): AsyncIterator<HarnessNotification> {
    for (;;) yield await this.next()
  }
}

/** Scripted `HarnessClient` substitute that records every lifecycle call. */
class FakeClient implements SdkActivationClient {
  pid = 42
  readonly subscription = new FakeSubscription()
  readonly calls: string[] = []
  readonly initializeRequests: Parameters<SdkActivationClient['initialize']>[0][] = []
  readonly openRequests: Parameters<SdkActivationClient['openActivation']>[0][] = []
  readonly statusRequests: Parameters<SdkActivationClient['getActivationStatus']>[0][] = []
  readonly interruptRequests: Parameters<SdkActivationClient['interruptActivation']>[0][] = []
  readonly disposeRequests: Parameters<SdkActivationClient['disposeActivation']>[0][] = []
  readonly enrollRequests: Parameters<SdkActivationClient['enrollActivationLink']>[0][] = []
  openGate: Promise<void> | undefined
  disposeGate: Promise<void> | undefined
  openHandler: ((params: Parameters<SdkActivationClient['openActivation']>[0]) => Promise<SdkActivationState>) | undefined
  openOverride: ((target: SdkActivationTarget) => SdkActivationState) | undefined
  status: SdkActivationState | undefined
  disposeState: SdkActivationState | undefined
  initializeError: unknown
  openError: unknown
  statusError: unknown
  interruptError: unknown
  disposeError: unknown
  enrollError: unknown
  enrollGate: Promise<void> | undefined
  closeError: unknown

  readonly initialize: SdkActivationClient['initialize'] = async (params) => {
    this.calls.push('initialize')
    this.initializeRequests.push(params)
    if (this.initializeError !== undefined) throw this.initializeError
    return { serverInfo: { name: 'scripted-sdk-runtime', version: '1' } }
  }

  readonly openActivation: SdkActivationClient['openActivation'] = async (params) => {
    this.calls.push('open')
    this.openRequests.push(params)
    if (this.openHandler !== undefined) return await this.openHandler(params)
    await this.openGate
    if (this.openError !== undefined) throw this.openError
    const state = this.openOverride?.(params.target) ?? activationState(params.target, 'idle', 1)
    this.status = state
    return state
  }

  readonly getActivationStatus: SdkActivationClient['getActivationStatus'] = async (params) => {
    this.calls.push('status')
    this.statusRequests.push(params)
    if (this.statusError !== undefined) throw this.statusError
    return this.status ?? activationState(params.target, 'idle', 1)
  }

  readonly interruptActivation: SdkActivationClient['interruptActivation'] = async (params) => {
    this.calls.push('interrupt')
    this.interruptRequests.push(params)
    if (this.interruptError !== undefined) throw this.interruptError
  }

  readonly disposeActivation: SdkActivationClient['disposeActivation'] = async (params) => {
    this.calls.push('remote-dispose')
    this.disposeRequests.push(params)
    await this.disposeGate
    if (this.disposeError !== undefined) throw this.disposeError
    return this.disposeState ?? activationState(params.target, 'offline', 4)
  }

  readonly enrollActivationLink: SdkActivationClient['enrollActivationLink'] = async (params) => {
    this.calls.push('link-enroll')
    this.enrollRequests.push(params)
    await this.enrollGate
    if (this.enrollError !== undefined) throw this.enrollError
  }

  readonly subscribe: SdkActivationClient['subscribe'] = () => {
    this.calls.push('subscribe')
    return this.subscription
  }

  readonly close: SdkActivationClient['close'] = async () => {
    this.calls.push('process-close')
    if (this.closeError !== undefined) throw this.closeError
  }

  /** Emit one parsed remote activation notification. */
  emit(state: SdkActivationState): void {
    this.subscription.push({ method: 'activation.status', params: { state } })
  }

  /** Fail its subscription as if child stdio reached a terminal edge. */
  loseTransport(): void {
    this.subscription.fail(new TransportClosedError('scripted SDK child exited'))
  }
}

/** Exact process-table substitute for local cold-replacement tests. */
class FakeProcessInspector implements ProcessInspector {
  readonly hasExactIdentity = true
  root: ProcessIdentity | undefined = { pid: 42, started: 'start-a' }
  readonly members: ProcessIdentity[] = []
  readonly alive = new Set<string>(['42:start-a'])
  readonly groups: Array<[number, 'SIGTERM' | 'SIGKILL']> = []
  readonly processes: Array<[ProcessIdentity, 'SIGTERM' | 'SIGKILL']> = []

  foregroundPgid(): number | undefined { return undefined }
  isStdinWaiting(): boolean { return false }
  processTree(rootPid: number): ProcessIdentity[] {
    return this.root?.pid === rootPid ? [this.root, ...this.members] : []
  }
  processSession(): ProcessIdentity[] { return [] }
  isAlive(identity: ProcessIdentity): boolean { return this.alive.has(`${identity.pid}:${identity.started}`) }
  signalGroup(group: number, signal: 'SIGTERM' | 'SIGKILL'): void {
    this.groups.push([group, signal])
    this.alive.clear()
  }
  signalProcess(identity: ProcessIdentity, signal: 'SIGTERM' | 'SIGKILL'): void {
    this.processes.push([identity, signal])
    this.alive.delete(`${identity.pid}:${identity.started}`)
  }
}

/** Per-activation fake-client factory. */
class FakeClientFactory implements SdkActivationClientFactory {
  readonly options: HarnessClientOptions[] = []
  readonly clients: FakeClient[] = []
  next: (() => FakeClient) | undefined

  create(options: HarnessClientOptions): SdkActivationClient {
    this.options.push(options)
    const client = this.next?.() ?? new FakeClient()
    this.clients.push(client)
    return client
  }
}

/** Create one exact protocol state for a target and monotonic sequence. */
function activationState(
  target: SdkActivationTarget,
  status: SdkActivationState['status'],
  statusSequence: number,
): SdkActivationState {
  return { ...target, status, statusSequence }
}

/** Package configuration with explicit subprocess deployment fields. */
function config(overrides: Partial<SdkRuntime.Config> = {}): SdkRuntime.Config {
  return {
    providerName: 'sdk',
    command: 'clocky-jsonrpc-agent',
    args: ['--config', 'remote.yml'],
    cwd: process.cwd(),
    env: { SDK_RUNTIME_EXPLICIT_TOKEN: 'child-only' },
    credential: 'agent-runtime-sdk-test-credential',
    requestTimeoutMs: 2_000,
    shutdownTimeoutMs: 100,
    disposeEofGraceMs: 200,
    disposeGraceMs: 300,
    ...overrides,
  }
}

/** Create a real AgentRuntime registry with an SDK provider that uses scripted clients. */
async function setup(options: {
  readonly config?: SdkRuntime.Config
  readonly factory?: FakeClientFactory
  readonly enrollmentProvider?: TeamLinkEnrollmentProvider
  readonly processInspector?: ProcessInspector
} = {}) {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(AgentRuntime)
  let enrollmentDispose: (() => void) | undefined
  if (options.enrollmentProvider !== undefined) {
    await ctx.plugin(TeamLinkRegistry)
    enrollmentDispose = ctx.teamLinks.registerEnrollmentProvider(options.enrollmentProvider)
  }
  const factory = options.factory ?? new FakeClientFactory()
  const provider = SdkRuntime.createSdkAgentRuntimeProvider(ctx, options.config ?? config(), factory, options.processInspector)
  const unregisterFencer = provider.fencer === undefined ? undefined : ctx.agentRuntimes.registerFencer(provider.fencer)
  const unregister = ctx.agentRuntimes.registerProvider(provider)
  return { ctx, factory, provider, unregister, unregisterFencer, enrollmentDispose }
}

/** Build one Team-resolved remote activation request. */
function request(
  sessionId = SessionId('sdk-session'),
  overrides: Partial<AgentRuntimeActivationRequest> = {},
): AgentRuntimeActivationRequest {
  return {
    provider: 'sdk',
    teamId,
    participant,
    sessionId,
    seed: { kind: 'fresh' },
    agent: { options: { provider: 'remote-route', model: 'remote-model', maxTokens: 4096 } },
    signal: new AbortController().signal,
    ...overrides,
  }
}

function enrollmentProvider(revoke: () => Promise<void>, capability = 'opaque-capability'): TeamLinkEnrollmentProvider {
  return {
    name: 'websocket',
    async reserve() {
      return {
        provider: 'websocket',
        endpoint: 'wss://team.example.test/team-link',
        capability,
        revoke: async () => { await revoke() },
      }
    },
  }
}

function emitRemoteBinding(ctx: Context, target: SdkActivationTarget, status: 'idle' | 'running' | 'offline' = 'idle'): ActivationBindingSnapshot {
  const binding = activationBindingSnapshotSchema.parse({
    activation: { id: target.activationId, teamId: target.teamId, participantId: target.participantId, status },
    sessionId: target.sessionId, provider: 'sdk',
  })
  ctx.emit('team/changed', teamEventSchema.parse({ type: 'activation/changed', binding, cursor: 1, createdAt: 1 }))
  return binding
}

describe('SDK AgentRuntime provider', () => {
  it('fails closed before spawning a remote child when no product credential is configured', async () => {
    const { credential: _credential, ...withoutCredential } = config()
    const { ctx, factory } = await setup({ config: withoutCredential })

    await expect(ctx.agentRuntimes.activate(request())).rejects.toMatchObject({
      code: 'AGENT_RUNTIME_SDK_PRODUCT_AUTH_REQUIRED',
    })
    expect(factory.clients).toEqual([])
  })

  it('registers its configured local fencer with the AgentRuntime registry', async () => {
    const ctx = new Context()
    contexts.add(ctx)
    await ctx.plugin(AgentRuntime)
    const provider = SdkRuntime.createSdkAgentRuntimeProvider(
      ctx,
      config({ recoveryProfile: 'local-sdk-v1', recoveryHostId: 'host-a' }),
      new FakeClientFactory(),
      new FakeProcessInspector(),
    )
    const fencer = provider.fencer
    if (fencer === undefined) throw new Error('recovery-enabled SDK provider has no fencer')
    const unregister = ctx.agentRuntimes.registerFencer(fencer)
    expect(ctx.agentRuntimes.getFencer('sdk')).toBe(fencer)
    unregister()
    expect(ctx.agentRuntimes.getFencer('sdk')).toBeUndefined()
  })

  it('rejects recovery on an inspector without an exact creation identity', async () => {
    const ctx = new Context()
    contexts.add(ctx)
    await ctx.plugin(AgentRuntime)
    const inspector = new FakeProcessInspector() as ProcessInspector & { hasExactIdentity?: boolean }
    Object.defineProperty(inspector, 'hasExactIdentity', { value: false })
    expect(() => SdkRuntime.createSdkAgentRuntimeProvider(
      ctx,
      config({ recoveryProfile: 'local-sdk-v1', recoveryHostId: 'host-a' }),
      new FakeClientFactory(),
      inspector,
    )).toThrow('requires exact local process creation identities')
  })

  it('rejects a partial local cold-replacement configuration before provider registration', async () => {
    const ctx = new Context()
    contexts.add(ctx)
    await ctx.plugin(AgentRuntime)
    expect(() => SdkRuntime.createSdkAgentRuntimeProvider(
      ctx,
      config({ recoveryProfile: 'local-sdk-v1' }),
      new FakeClientFactory(),
      new FakeProcessInspector(),
    )).toThrow('recoveryProfile and recoveryHostId must be configured together')
    expect(() => SdkRuntime.createSdkAgentRuntimeProvider(
      ctx,
      config({ recoveryFenceGraceMs: 1 }),
      new FakeClientFactory(),
      new FakeProcessInspector(),
    )).toThrow('recoveryFenceGraceMs requires recoveryProfile and recoveryHostId')
    expect(() => SdkRuntime.createSdkAgentRuntimeProvider(
      ctx,
      config({ recoverySupervisor: { kind: 'local-process', provider: 'sdk' } as never }),
      new FakeClientFactory(),
      new FakeProcessInspector(),
    )).toThrow('recoverySupervisor requires recoveryProfile and recoveryHostId')
    expect(SdkRuntime.createSdkAgentRuntimeProvider(
      ctx,
      config({ recoveryProfile: 'local-sdk-v1', recoveryHostId: 'host-a' }),
      new FakeClientFactory(),
    ).fencer).toBeDefined()
  })

  it('rejects surrounding whitespace in local recovery identities', async () => {
    const ctx = new Context()
    contexts.add(ctx)
    await ctx.plugin(AgentRuntime)
    expect(() => SdkRuntime.createSdkAgentRuntimeProvider(
      ctx,
      config({ recoveryProfile: ' local-sdk-v1', recoveryHostId: 'host-a' }),
      new FakeClientFactory(),
      new FakeProcessInspector(),
    )).toThrow('recoveryProfile must be non-empty without surrounding whitespace')
    expect(() => SdkRuntime.createSdkAgentRuntimeProvider(
      ctx,
      config({ recoveryProfile: 'local-sdk-v1', recoveryHostId: 'host-a ' }),
      new FakeClientFactory(),
      new FakeProcessInspector(),
    )).toThrow('recoveryHostId must be non-empty without surrounding whitespace')
  })

  it('publishes a configured local cold-replacement plan and registers its matching fencer', async () => {
    const inspector = new FakeProcessInspector()
    const { ctx, provider, factory } = await setup({
      config: config({ recoveryProfile: 'local-sdk-v1', recoveryHostId: 'host-a', recoveryFenceGraceMs: 1 }),
      processInspector: inspector,
    })
    const handle = await ctx.agentRuntimes.activate(request())
    const recovery = handle.recovery
    if (recovery === undefined) throw new Error('SDK activation did not publish a recovery plan')
    expect(recovery).toMatchObject({
      kind: 'sdk-local-cold-replace',
      runtimeProvider: 'sdk',
      profile: 'local-sdk-v1',
      agent: { provider: 'remote-route', model: 'remote-model', maxTokens: 4096 },
      process: { hostId: 'host-a', pid: 42, started: 'start-a' },
    })
    expect(factory.options[0]?.detached).toBe(true)
    expect(ctx.agentRuntimes.getFencer('sdk')).toBe(provider.fencer)
    await handle.dispose()
    const withoutLimit = await ctx.agentRuntimes.activate(request(SessionId('sdk-recovery-no-token-limit'), {
      agent: { options: { provider: 'remote-route', model: 'remote-model' } },
    }))
    expect(withoutLimit.recovery).toMatchObject({ agent: { provider: 'remote-route', model: 'remote-model' } })
    expect(JSON.stringify(withoutLimit.recovery)).not.toContain('maxTokens')
    await withoutLimit.dispose()
  })

  it('omits a POSIX process group from a Windows recovery plan', async () => {
    const { ctx } = await setup({ config: config({ recoveryProfile: 'local-sdk-v1', recoveryHostId: 'host-a' }),
      processInspector: new FakeProcessInspector() })
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    if (platform === undefined) throw new Error('Process platform descriptor is unavailable')
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
    let handle: Awaited<ReturnType<typeof ctx.agentRuntimes.activate>> | undefined
    try {
      handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-windows-recovery-plan')))
      expect(handle.recovery).toMatchObject({ process: { pid: 42, started: 'start-a' } })
      expect(JSON.stringify(handle.recovery)).not.toContain('processGroupId')
    } finally {
      Object.defineProperty(process, 'platform', platform)
      await handle?.dispose()
    }
  })

  it('rejects recovery when the child process identity is unavailable', async () => {
    const inspector = new FakeProcessInspector()
    const factory = new FakeClientFactory()
    const { ctx } = await setup({
      config: config({ recoveryProfile: 'local-sdk-v1', recoveryHostId: 'host-a' }),
      factory,
      processInspector: inspector,
    })
    factory.next = () => {
      const client = new FakeClient()
      client.pid = undefined as never
      return client
    }
    await expect(ctx.agentRuntimes.activate(request(SessionId('sdk-recovery-no-pid')))).rejects.toMatchObject({
      code: 'AGENT_RUNTIME_SDK_RECOVERY_UNAVAILABLE',
    })
    inspector.root = undefined
    factory.next = () => new FakeClient()
    await expect(ctx.agentRuntimes.activate(request(SessionId('sdk-recovery-no-identity')))).rejects.toMatchObject({
      code: 'AGENT_RUNTIME_SDK_RECOVERY_UNAVAILABLE',
    })
  })

  it('rejects supervised recovery when the execution-host supervisor owner is absent', async () => {
    const factory = new FakeClientFactory()
    const { ctx } = await setup({
      config: config({
        recoveryProfile: 'local-sdk-v1', recoveryHostId: 'host-a',
        recoverySupervisor: { name: 'http-supervisor', version: 1, endpointId: 'endpoint-a' },
      }),
      factory,
      processInspector: new FakeProcessInspector(),
    })
    await expect(ctx.agentRuntimes.activate(request(SessionId('sdk-supervisor-missing')))).rejects.toMatchObject({
      code: 'AGENT_RUNTIME_SDK_RECOVERY_UNAVAILABLE',
    })
    expect(factory.clients[0]?.calls).toContain('process-close')
  })

  it('admits a supervised local recovery epoch through the mounted execution-host owner', async () => {
    const factory = new FakeClientFactory()
    const { ctx } = await setup({
      config: config({
        recoveryProfile: 'local-sdk-v1', recoveryHostId: 'host-a',
        recoverySupervisor: { name: 'http-supervisor', version: 1, endpointId: 'endpoint-a' },
      }),
      factory,
      processInspector: new FakeProcessInspector(),
    })
    const admitted = vi.fn(async () => {})
    const unregister = ctx.provide('activationSupervisors', { admitOwned: admitted } as never)
    try {
      const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-supervisor-admitted')))
      expect(admitted).toHaveBeenCalledOnce()
      await handle.dispose()
    } finally {
      unregister()
    }
  })

  it('fences only the exact persisted local process identity before cold replacement', async () => {
    const inspector = new FakeProcessInspector()
    const fencer = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 1,
    }, inspector, 'linux', () => false)
    const binding = activationBindingSnapshotSchema.parse({
      activation: { id: 'activation-fence', teamId, participantId: participant.id, status: 'idle' },
      sessionId: 'sdk-session',
      provider: 'sdk',
      recovery: {
        kind: 'sdk-local-cold-replace', version: 1, runtimeProvider: 'sdk', profile: 'local-sdk-v1',
        agent: { provider: 'remote-route', model: 'remote-model' },
        process: { hostId: 'host-a', pid: 42, started: 'start-a', processGroupId: 42 },
      },
    })
    await expect(fencer.fence(binding)).resolves.toBeUndefined()
    expect(inspector.groups).toEqual([[42, 'SIGTERM']])

    inspector.root = { pid: 42, started: 'recycled' }
    inspector.alive.add('42:recycled')
    await expect(fencer.fence(binding)).resolves.toBeUndefined()
    expect(inspector.groups).toEqual([[42, 'SIGTERM']])

    const drainingInspector = new FakeProcessInspector()
    let groupChecks = 0
    const draining = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 100,
    }, drainingInspector, 'linux', () => {
      groupChecks += 1
      return groupChecks === 1
    })
    await expect(draining.fence(binding)).resolves.toBeUndefined()
    expect(drainingInspector.groups).toEqual([[42, 'SIGTERM']])

    const unsafeInspector = new FakeProcessInspector()
    const unsafe = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 1,
    }, unsafeInspector, 'linux', () => true)
    await expect(unsafe.fence(binding)).rejects.toMatchObject({ code: 'AGENT_RUNTIME_SDK_RECOVERY_FENCE_FAILED' })
    expect(unsafeInspector.groups).toEqual([[42, 'SIGTERM']])

    const windowsInspector = new FakeProcessInspector()
    windowsInspector.alive.clear()
    const windows = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 1,
    }, windowsInspector, 'win32')
    await expect(windows.fence(binding)).rejects.toMatchObject({ code: 'AGENT_RUNTIME_SDK_RECOVERY_FENCE_FAILED' })
    expect(windowsInspector.processes).toEqual([])
    const survivingGroupInspector = new FakeProcessInspector()
    survivingGroupInspector.alive.clear()
    const survivingGroup = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 1,
    }, survivingGroupInspector, 'linux', () => true)
    await expect(survivingGroup.fence(binding)).rejects.toMatchObject({ code: 'AGENT_RUNTIME_SDK_RECOVERY_FENCE_FAILED' })
    class MismatchInspector extends FakeProcessInspector {
      override isAlive(identity: ProcessIdentity): boolean { return identity.pid === 42 }
      override processTree(_rootPid: number): ProcessIdentity[] { return [{ pid: 42, started: 'reused-start' }] }
    }
    const mismatch = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 1,
    }, new MismatchInspector(), 'linux', () => false)
    await expect(mismatch.fence(binding)).rejects.toMatchObject({ code: 'AGENT_RUNTIME_SDK_RECOVERY_FENCE_FAILED' })
    const noRecoveryBinding = { ...binding, recovery: undefined } as typeof binding
    expect(() => fencer.health(noRecoveryBinding)).toThrow(expect.objectContaining({ code: 'AGENT_RUNTIME_SDK_RECOVERY_BINDING_INVALID' }))
    const noIdentityInspector = new FakeProcessInspector() as ProcessInspector & { hasExactIdentity?: boolean }
    Object.defineProperty(noIdentityInspector, 'hasExactIdentity', { value: false })
    const noIdentityFencer = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 1,
    }, noIdentityInspector, 'linux')
    expect(() => noIdentityFencer.health(binding)).toThrow(expect.objectContaining({ code: 'AGENT_RUNTIME_SDK_RECOVERY_FENCE_FAILED' }))
  })

  it('reports local recovery health states and escalates a Windows process tree after graceful timeout', async () => {
    const binding = activationBindingSnapshotSchema.parse({
      activation: { id: 'activation-health', teamId, participantId: participant.id, status: 'idle' },
      sessionId: 'sdk-session-health',
      provider: 'sdk',
      recovery: {
        kind: 'sdk-local-cold-replace', version: 1, runtimeProvider: 'sdk', profile: 'local-sdk-v1',
        agent: { provider: 'remote-route', model: 'remote-model' },
        process: { hostId: 'host-a', pid: 42, started: 'start-a', processGroupId: 42 },
      },
    })
    const inspector = new FakeProcessInspector()
    const fencer = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 1,
    }, inspector, 'linux', () => false)
    expect(fencer.health(binding)).toBe('reachable')
    inspector.alive.clear()
    expect(fencer.health(binding)).toBe('terminated')
    const unreachableGroupBinding = activationBindingSnapshotSchema.parse({
      ...binding,
      recovery: {
        ...binding.recovery!,
        process: { ...binding.recovery!.process, processGroupId: 2_000_000_000 },
      },
    })
    const defaultGroupProbe = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 1,
    }, inspector, 'linux')
    expect(defaultGroupProbe.health(unreachableGroupBinding)).toBe('terminated')
    const malformedBinding = { ...binding, recovery: {} } as typeof binding
    expect(() => fencer.health(malformedBinding)).toThrow(expect.objectContaining({ code: 'AGENT_RUNTIME_SDK_RECOVERY_BINDING_INVALID' }))
    const foreignBinding = {
      ...binding,
      recovery: { ...binding.recovery!, profile: 'foreign-profile' },
    } as typeof binding
    expect(() => fencer.health(foreignBinding)).toThrow(expect.objectContaining({ code: 'AGENT_RUNTIME_SDK_RECOVERY_BINDING_INVALID' }))
    const otherKindFencer = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 1, kind: 'acp-local-cold-replace',
    }, inspector, 'linux')
    expect(() => otherKindFencer.health(binding)).toThrow(expect.objectContaining({ code: 'AGENT_RUNTIME_SDK_RECOVERY_BINDING_INVALID' }))
    const missingGroupBinding = {
      ...binding,
      recovery: { ...binding.recovery!, process: { ...binding.recovery!.process, processGroupId: undefined } },
    } as typeof binding
    const missingGroupFencer = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 1,
    }, new FakeProcessInspector(), 'linux')
    await expect(missingGroupFencer.fence(missingGroupBinding)).rejects.toMatchObject({ code: 'AGENT_RUNTIME_SDK_RECOVERY_BINDING_INVALID' })
    const unknown = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 1,
    }, inspector, 'linux', () => true)
    expect(unknown.health(binding)).toBe('unknown')
    const windows = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 1,
    }, inspector, 'win32')
    expect(windows.health(binding)).toBe('unknown')
    const gracefulWindowsInspector = new FakeProcessInspector()
    const gracefulWindows = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 1,
    }, gracefulWindowsInspector, 'win32')
    await expect(gracefulWindows.fence(binding)).resolves.toBeUndefined()
    expect(gracefulWindowsInspector.processes.map(([, signal]) => signal)).toEqual(['SIGTERM'])

    class StickyInspector extends FakeProcessInspector {
      override signalProcess(identity: ProcessIdentity, signal: 'SIGTERM' | 'SIGKILL'): void {
        this.processes.push([identity, signal])
        if (signal === 'SIGKILL') this.alive.delete(`${identity.pid}:${identity.started}`)
      }
    }
    const sticky = new StickyInspector()
    const escalating = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 1,
    }, sticky, 'win32')
    await expect(escalating.fence(binding)).resolves.toBeUndefined()
    expect(sticky.processes.map(([, signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL'])
    class StickyGroupInspector extends FakeProcessInspector {
      override signalGroup(group: number, signal: 'SIGTERM' | 'SIGKILL'): void {
        this.groups.push([group, signal])
        if (signal === 'SIGKILL') this.alive.clear()
      }
    }
    let groupChecks = 0
    const stickyGroup = new StickyGroupInspector()
    const posixEscalating = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 20,
    }, stickyGroup, 'linux', () => {
      groupChecks += 1
      return groupChecks === 1
    })
    await expect(posixEscalating.fence(binding)).resolves.toBeUndefined()
    expect(stickyGroup.groups).toEqual([[42, 'SIGTERM'], [42, 'SIGKILL']])
    class LostRootInspector extends FakeProcessInspector {
      private aliveChecks = 0
      override isAlive(_identity: ProcessIdentity): boolean {
        this.aliveChecks += 1
        return this.aliveChecks < 4
      }
      override signalGroup(group: number, signal: 'SIGTERM' | 'SIGKILL'): void {
        this.groups.push([group, signal])
      }
    }
    const lostRoot = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 1,
    }, new LostRootInspector(), 'linux', () => true)
    await expect(lostRoot.fence(binding)).rejects.toMatchObject({ code: 'AGENT_RUNTIME_SDK_RECOVERY_FENCE_FAILED' })
    class OrphanChildInspector extends FakeProcessInspector {
      constructor() {
        super()
        this.members.push({ pid: 43, started: 'child-start' })
        this.alive.add('43:child-start')
      }
      override signalGroup(group: number, signal: 'SIGTERM' | 'SIGKILL'): void {
        this.groups.push([group, signal])
        this.alive.delete('42:start-a')
      }
    }
    const orphanChild = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 1,
    }, new OrphanChildInspector(), 'linux', () => false)
    await expect(orphanChild.fence(binding)).rejects.toMatchObject({ code: 'AGENT_RUNTIME_SDK_RECOVERY_FENCE_FAILED' })
    class NeverGoneGroupInspector extends FakeProcessInspector {
      override signalGroup(group: number, signal: 'SIGTERM' | 'SIGKILL'): void {
        this.groups.push([group, signal])
      }
    }
    const neverGoneGroup = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 1,
    }, new NeverGoneGroupInspector(), 'linux', () => true)
    await expect(neverGoneGroup.fence(binding)).rejects.toMatchObject({ code: 'AGENT_RUNTIME_SDK_RECOVERY_FENCE_FAILED' })
    class NeverExitInspector extends FakeProcessInspector {
      override signalProcess(identity: ProcessIdentity, signal: 'SIGTERM' | 'SIGKILL'): void {
        this.processes.push([identity, signal])
      }
    }
    const neverExit = new NeverExitInspector()
    const stuck = new SdkRuntime.SdkLocalProcessFencer({
      provider: 'sdk', profile: 'local-sdk-v1', hostId: 'host-a', fenceGraceMs: 1,
    }, neverExit, 'win32')
    await expect(stuck.fence(binding)).rejects.toMatchObject({ code: 'AGENT_RUNTIME_SDK_RECOVERY_FENCE_FAILED' })
    expect(neverExit.processes.map(([, signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('enrolls a fixed remote Link only after the exact durable binding commits and revokes it on disposal', async () => {
    const revoke = vi.fn(async () => {})
    const { ctx, factory } = await setup({
      config: config({ teamLinkEnrollmentProvider: 'websocket' }),
      enrollmentProvider: enrollmentProvider(revoke),
    })
    const handle = await ctx.agentRuntimes.activate(request())
    const client = factory.clients[0]
    if (client === undefined) throw new Error('SDK provider did not create a client')
    const target = client.openRequests[0]?.target
    if (target === undefined) throw new Error('SDK provider did not open an activation target')

    expect(client.enrollRequests).toEqual([])
    ctx.emit('team/changed', teamEventSchema.parse({ type: 'participant/changed', participant, cursor: 1, createdAt: 1 }))
    expect(client.enrollRequests).toEqual([])
    ctx.emit('team/changed', teamEventSchema.parse({
      type: 'activation/changed',
      binding: activationBindingSnapshotSchema.parse({
        activation: { id: target.activationId, teamId: target.teamId, participantId: target.participantId, status: 'idle' },
        sessionId: target.sessionId,
        provider: 'sdk',
      }),
      cursor: 1,
      createdAt: 1,
    }))
    await vi.waitFor(() => {
      expect(client.enrollRequests).toEqual([{
        target,
        binding: { ...target, provider: 'sdk' },
        enrollment: {
          provider: 'websocket',
          endpoint: 'wss://team.example.test/team-link',
          capability: 'opaque-capability',
        },
      }])
    })
    emitRemoteBinding(ctx, target, 'running')
    await Promise.resolve()
    expect(client.enrollRequests).toHaveLength(1)

    await handle.dispose()
    expect(revoke).toHaveBeenCalledOnce()
    expect(client.calls.indexOf('remote-dispose')).toBeLessThan(client.calls.indexOf('process-close'))
  })

  it('drops a queued initial Link enrollment when disposal wins before reservation', async () => {
    const revoke = vi.fn(async () => {})
    const { ctx, factory } = await setup({
      config: config({ teamLinkEnrollmentProvider: 'websocket' }),
      enrollmentProvider: enrollmentProvider(revoke),
    })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-link-queued-disposal')))
    const client = factory.clients[0], target = client?.openRequests[0]?.target
    if (client === undefined || target === undefined) throw new Error('Queued enrollment fixture has no target')
    ctx.emit('team/changed', teamEventSchema.parse({ type: 'activation/changed',
      binding: activationBindingSnapshotSchema.parse({
        activation: { id: target.activationId, teamId: target.teamId, participantId: target.participantId, status: 'idle' },
        sessionId: target.sessionId, provider: 'sdk',
      }), cursor: 1, createdAt: 1 }))
    await handle.dispose()
    expect(client.enrollRequests).toEqual([])
    expect(revoke).not.toHaveBeenCalled()
  })

  it('drops queued Link renewal after the current credential is retired by disposal', async () => {
    const firstRevoke = vi.fn(async () => {}), secondRevoke = vi.fn(async () => {})
    const { ctx, factory, enrollmentDispose } = await setup({
      config: config({ teamLinkEnrollmentProvider: 'websocket' }),
      enrollmentProvider: enrollmentProvider(firstRevoke, 'first-capability'),
    })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-link-queued-renewal')))
    const client = factory.clients[0], target = client?.openRequests[0]?.target
    if (client === undefined || target === undefined || enrollmentDispose === undefined) throw new Error('Queued renewal fixture has no issuer')
    const binding = activationBindingSnapshotSchema.parse({
      activation: { id: target.activationId, teamId: target.teamId, participantId: target.participantId, status: 'idle' },
      sessionId: target.sessionId, provider: 'sdk',
    })
    ctx.emit('team/changed', teamEventSchema.parse({ type: 'activation/changed', binding, cursor: 1, createdAt: 1 }))
    await vi.waitFor(() => { expect(client.enrollRequests).toHaveLength(1) })
    enrollmentDispose()
    ctx.teamLinks.registerEnrollmentProvider(enrollmentProvider(secondRevoke, 'second-capability'))
    await handle.dispose()
    expect(client.enrollRequests).toHaveLength(1)
    expect(firstRevoke).toHaveBeenCalledOnce()
    expect(secondRevoke).not.toHaveBeenCalled()
  })

  it('revokes a newly reserved Link credential when disposal begins before child enrollment', async () => {
    const reserved = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    const revoke = vi.fn(async () => {})
    const issuer: TeamLinkEnrollmentProvider = { name: 'websocket', reserve: async () => {
      reserved.resolve(undefined)
      await release.promise
      return { provider: 'websocket', endpoint: 'wss://team.example.test/team-link', capability: 'late-capability', revoke }
    } }
    const { ctx, factory } = await setup({ config: config({ teamLinkEnrollmentProvider: 'websocket' }), enrollmentProvider: issuer })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-link-reserve-race')))
    const client = factory.clients[0], target = client?.openRequests[0]?.target
    if (client === undefined || target === undefined) throw new Error('Reserve race fixture has no target')
    emitRemoteBinding(ctx, target)
    await reserved.promise
    const disposing = handle.dispose()
    release.resolve(undefined)
    await disposing
    expect(client.enrollRequests).toEqual([])
    expect(revoke).toHaveBeenCalledOnce()
  })

  it('revokes a Link credential whose child enrollment returns after disposal begins', async () => {
    const release = Promise.withResolvers<undefined>()
    const revoke = vi.fn(async () => {})
    const { ctx, factory } = await setup({ config: config({ teamLinkEnrollmentProvider: 'websocket' }),
      enrollmentProvider: enrollmentProvider(revoke) })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-link-enroll-race')))
    const client = factory.clients[0], target = client?.openRequests[0]?.target
    if (client === undefined || target === undefined) throw new Error('Enrollment race fixture has no target')
    client.enrollGate = release.promise
    emitRemoteBinding(ctx, target)
    await vi.waitFor(() => { expect(client.enrollRequests).toHaveLength(1) })
    const disposing = handle.dispose()
    release.resolve(undefined)
    await disposing
    expect(revoke).toHaveBeenCalledOnce()
    expect(client.calls.indexOf('link-enroll')).toBeLessThan(client.calls.indexOf('remote-dispose'))
  })

  it('contains Link revocation failure while completing a confirmed remote disposal', async () => {
    const revoke = vi.fn(async () => {})
    const { ctx, factory } = await setup({ config: config({ teamLinkEnrollmentProvider: 'websocket' }),
      enrollmentProvider: enrollmentProvider(revoke) })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-link-revoke-disposal')))
    const client = factory.clients[0], target = client?.openRequests[0]?.target
    if (client === undefined || target === undefined) throw new Error('Revocation fixture has no target')
    emitRemoteBinding(ctx, target)
    await vi.waitFor(() => { expect(client.enrollRequests).toHaveLength(1) })
    revoke.mockRejectedValueOnce(new Error('issuer unavailable during disposal'))
    await expect(handle.dispose()).resolves.toBeUndefined()
    expect(revoke).toHaveBeenCalledOnce()
    expect(client.calls).toContain('process-close')
  })

  it('turns a post-bind Link enrollment failure into a contained offline transition', async () => {
    const revoke = vi.fn(async () => {})
    const { ctx, factory } = await setup({
      config: config({ teamLinkEnrollmentProvider: 'websocket' }),
      enrollmentProvider: enrollmentProvider(revoke),
    })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-link-enrollment-failure')))
    const client = factory.clients[0]
    if (client === undefined) throw new Error('SDK provider did not create a client')
    const target = client.openRequests[0]?.target
    if (target === undefined) throw new Error('SDK provider did not open a target')
    client.enrollError = new Error('link enrollment rejected')
    const statuses: string[] = []
    handle.onStatus((next) => { statuses.push(next.status) })
    ctx.emit('team/changed', teamEventSchema.parse({
      type: 'activation/changed',
      binding: activationBindingSnapshotSchema.parse({
        activation: { id: target.activationId, teamId: target.teamId, participantId: target.participantId, status: 'idle' },
        sessionId: target.sessionId,
        provider: 'sdk',
      }),
      cursor: 1,
      createdAt: 1,
    }))
    await vi.waitFor(() => { expect(statuses).toEqual(['offline']) })
    await expect(handle.health()).resolves.toMatchObject({ status: 'offline' })
    expect(revoke).toHaveBeenCalledOnce()
    await expect(handle.dispose()).resolves.toBeUndefined()
  })

  it('contains a Link credential revoke failure while publishing offline', async () => {
    const revoke = vi.fn(async () => {})
    const { ctx, factory } = await setup({
      config: config({ teamLinkEnrollmentProvider: 'websocket' }),
      enrollmentProvider: enrollmentProvider(revoke),
    })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-link-revoke-failure')))
    const client = factory.clients[0]
    if (client === undefined) throw new Error('SDK provider did not create a client')
    const target = client.openRequests[0]?.target
    if (target === undefined) throw new Error('SDK provider did not open a target')
    ctx.emit('team/changed', teamEventSchema.parse({
      type: 'activation/changed',
      binding: activationBindingSnapshotSchema.parse({
        activation: { id: target.activationId, teamId: target.teamId, participantId: target.participantId, status: 'idle' },
        sessionId: target.sessionId,
        provider: 'sdk',
      }),
      cursor: 1,
      createdAt: 1,
    }))
    await vi.waitFor(() => { expect(client.enrollRequests).toHaveLength(1) })
    revoke.mockRejectedValueOnce(new Error('credential revoke failed'))
    const statuses: string[] = []
    handle.onStatus((next) => { statuses.push(next.status) })
    client.emit(activationState(target, 'offline', 2))
    await vi.waitFor(() => { expect(statuses).toEqual(['offline']) })
    expect(revoke).toHaveBeenCalledOnce()
    await expect(handle.dispose()).resolves.toBeUndefined()
  })

  it('contains a pending Link revoke failure when an already offline handle is disposed', async () => {
    const release = Promise.withResolvers<undefined>()
    const revoke = vi.fn(() => release.promise)
    const { ctx, factory } = await setup({ config: config({ teamLinkEnrollmentProvider: 'websocket' }),
      enrollmentProvider: enrollmentProvider(revoke) })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-link-offline-revoke-race')))
    const client = factory.clients[0], target = client?.openRequests[0]?.target
    if (client === undefined || target === undefined) throw new Error('Offline revoke fixture has no target')
    try {
      emitRemoteBinding(ctx, target)
      await vi.waitFor(() => { expect(client.enrollRequests).toHaveLength(1) })
      client.emit(activationState(target, 'offline', 2))
      await vi.waitFor(() => { expect(revoke).toHaveBeenCalledOnce() })
      const disposing = handle.dispose()
      release.reject(new Error('issuer revoke completed with error'))
      await expect(disposing).resolves.toBeUndefined()
      expect((await handle.health()).status).toBe('offline')
    } finally { release.resolve(undefined) }
  })

  it('re-enrolls a current remote binding after its issuer is replaced without another Team binding event', async () => {
    const firstRevoke = vi.fn(async () => {})
    const secondRevoke = vi.fn(async () => {})
    const { ctx, factory, enrollmentDispose } = await setup({
      config: config({ teamLinkEnrollmentProvider: 'websocket' }),
      enrollmentProvider: enrollmentProvider(firstRevoke, 'first-capability'),
    })
    const handle = await ctx.agentRuntimes.activate(request())
    const client = factory.clients[0]
    if (client === undefined || enrollmentDispose === undefined) throw new Error('SDK provider did not create an enrollment-capable client')
    const target = client.openRequests[0]?.target
    if (target === undefined) throw new Error('SDK provider did not open an activation target')
    const binding = activationBindingSnapshotSchema.parse({
      activation: { id: target.activationId, teamId: target.teamId, participantId: target.participantId, status: 'idle' },
      sessionId: target.sessionId,
      provider: 'sdk',
    })

    ctx.emit('team/changed', teamEventSchema.parse({
      type: 'activation/changed', binding, cursor: 1, createdAt: 1,
    }))
    await vi.waitFor(() => { expect(client.enrollRequests).toHaveLength(1) })

    enrollmentDispose()
    ctx.teamLinks.registerEnrollmentProvider(enrollmentProvider(secondRevoke, 'second-capability'))

    await vi.waitFor(() => {
      expect(client.enrollRequests).toHaveLength(2)
      expect(client.enrollRequests.map(entry => entry.enrollment.capability)).toEqual(['first-capability', 'second-capability'])
      expect(firstRevoke).toHaveBeenCalledOnce()
    })

    await handle.dispose()
    expect(secondRevoke).toHaveBeenCalledOnce()
  })

  it('ignores unrelated issuer changes and clears renewal eligibility after a terminal binding', async () => {
    const firstRevoke = vi.fn(async () => {}), replacementRevoke = vi.fn(async () => {})
    const { ctx, factory, enrollmentDispose } = await setup({
      config: config({ teamLinkEnrollmentProvider: 'websocket' }),
      enrollmentProvider: enrollmentProvider(firstRevoke),
    })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-link-unrelated-issuer')))
    const client = factory.clients[0], target = client?.openRequests[0]?.target
    if (client === undefined || target === undefined || enrollmentDispose === undefined) throw new Error('Issuer event fixture has no target')
    emitRemoteBinding(ctx, target)
    await vi.waitFor(() => { expect(client.enrollRequests).toHaveLength(1) })
    const removeAlternate = ctx.teamLinks.registerEnrollmentProvider({ ...enrollmentProvider(async () => {}), name: 'alternate' })
    removeAlternate()
    expect(client.enrollRequests).toHaveLength(1)
    enrollmentDispose()
    emitRemoteBinding(ctx, target, 'offline')
    ctx.teamLinks.registerEnrollmentProvider(enrollmentProvider(replacementRevoke, 'replacement'))
    await Promise.resolve()
    expect(client.enrollRequests).toHaveLength(1)
    await handle.dispose()
    expect(firstRevoke).toHaveBeenCalledOnce()
    expect(replacementRevoke).not.toHaveBeenCalled()
  })

  it('does not start renewal before the initial issuer reservation settles', async () => {
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    const firstRevoke = vi.fn(async () => {}), secondRevoke = vi.fn(async () => {})
    const firstIssuer: TeamLinkEnrollmentProvider = { name: 'websocket', reserve: async () => {
      entered.resolve(undefined)
      await release.promise
      return { provider: 'websocket', endpoint: 'wss://team.example.test/team-link', capability: 'first-capability', revoke: firstRevoke }
    } }
    const { ctx, factory, enrollmentDispose } = await setup({ config: config({ teamLinkEnrollmentProvider: 'websocket' }),
      enrollmentProvider: firstIssuer })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-link-pending-issuer')))
    const client = factory.clients[0], target = client?.openRequests[0]?.target
    if (client === undefined || target === undefined || enrollmentDispose === undefined) throw new Error('Pending issuer fixture has no target')
    try {
      emitRemoteBinding(ctx, target)
      await entered.promise
      enrollmentDispose()
      ctx.teamLinks.registerEnrollmentProvider(enrollmentProvider(secondRevoke, 'second-capability'))
      release.resolve(undefined)
      await vi.waitFor(() => { expect(client.enrollRequests).toHaveLength(1) })
      expect(client.enrollRequests[0]?.enrollment.capability).toBe('first-capability')
      await handle.dispose()
      expect(firstRevoke).toHaveBeenCalledOnce()
      expect(secondRevoke).not.toHaveBeenCalled()
    } finally { release.resolve(undefined) }
  })

  it('contains a re-enrollment failure after an issuer replacement', async () => {
    const firstRevoke = vi.fn(async () => {})
    const secondRevoke = vi.fn(async () => {})
    const { ctx, factory, enrollmentDispose } = await setup({
      config: config({ teamLinkEnrollmentProvider: 'websocket' }),
      enrollmentProvider: enrollmentProvider(firstRevoke, 'first-capability'),
    })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-link-renew-failure')))
    const client = factory.clients[0]
    if (client === undefined || enrollmentDispose === undefined) throw new Error('SDK provider did not create an enrollment-capable client')
    const target = client.openRequests[0]?.target
    if (target === undefined) throw new Error('SDK provider did not open a target')
    const binding = activationBindingSnapshotSchema.parse({
      activation: { id: target.activationId, teamId: target.teamId, participantId: target.participantId, status: 'idle' },
      sessionId: target.sessionId,
      provider: 'sdk',
    })
    ctx.emit('team/changed', teamEventSchema.parse({ type: 'activation/changed', binding, cursor: 1, createdAt: 1 }))
    await vi.waitFor(() => { expect(client.enrollRequests).toHaveLength(1) })
    client.enrollError = new Error('replacement enrollment failed')
    enrollmentDispose()
    ctx.teamLinks.registerEnrollmentProvider(enrollmentProvider(secondRevoke, 'second-capability'))
    await vi.waitFor(() => { expect(client.enrollRequests).toHaveLength(2) })
    await expect(handle.health()).resolves.toMatchObject({ status: 'idle' })
    await handle.dispose()
  })

  it('rejects configured Link enrollment without its registered issuer before spawning a child', async () => {
    const { ctx, factory } = await setup({ config: config({ teamLinkEnrollmentProvider: 'websocket' }) })
    await expect(ctx.agentRuntimes.activate(request())).rejects.toMatchObject({
      code: 'AGENT_RUNTIME_SDK_TEAM_LINK_UNAVAILABLE',
    })
    expect(factory.clients).toEqual([])
  })

  it('owns one full-target child process, maps remote status, and disposes in remote-before-process order', async () => {
    process.env.SDK_RUNTIME_AMBIENT_TOKEN = 'must-not-leak'
    try {
      const { ctx, factory } = await setup()
      const handle = await ctx.agentRuntimes.activate(request())
      const client = factory.clients[0]
      if (client === undefined) throw new Error('SDK provider did not create a client')
      const target = client.openRequests[0]?.target
      if (target === undefined) throw new Error('SDK provider did not open an activation target')

      expect(handle.localAgent).toBeUndefined()
      expect(handle.activation).toMatchObject({
        id: target.activationId,
        teamId,
        participantId: participant.id,
        status: 'idle',
      })
      expect(handle.sessionId).toBe(request().sessionId)
      expect(target).toEqual({
        activationId: String(handle.activation.id),
        teamId: String(teamId),
        participantId: String(participant.id),
        sessionId: String(handle.sessionId),
      })
      expect(client.initializeRequests).toEqual([{
        credential: 'agent-runtime-sdk-test-credential',
        cwd: process.cwd(),
        provider: 'remote-route',
        model: 'remote-model',
        maxTokens: 4096,
      }])
      expect(factory.options[0]).toMatchObject({
        command: 'clocky-jsonrpc-agent',
        args: ['--config', 'remote.yml'],
        cwd: process.cwd(),
        requestTimeoutMs: 2_000,
        shutdownTimeoutMs: 100,
        disposeEofGraceMs: 200,
        disposeGraceMs: 300,
      })
      expect(factory.options[0]?.env).toMatchObject({ SDK_RUNTIME_EXPLICIT_TOKEN: 'child-only' })
      expect(factory.options[0]?.env?.SDK_RUNTIME_AMBIENT_TOKEN).toBeUndefined()

      const statuses: string[] = []
      handle.onStatus((next) => { statuses.push(next.status) })
      handle.onStatus(() => { throw new Error('contained listener failure') })
      client.emit(activationState(target, 'running', 2))
      await vi.waitFor(() => { expect(statuses).toEqual(['running']) })
      client.emit(activationState(target, 'idle', 1))
      await Promise.resolve()
      expect(statuses).toEqual(['running'])

      client.status = activationState(target, 'idle', 3)
      await expect(handle.health()).resolves.toMatchObject({ status: 'idle' })
      expect(statuses).toEqual(['running', 'idle'])
      handle.interrupt({ kind: 'hook', reason: 'operator request' })
      await vi.waitFor(() => {
        expect(client.interruptRequests).toEqual([{ target, cause: { kind: 'hook', reason: 'operator request' } }])
      })

      await handle.dispose()
      expect(statuses).toEqual(['running', 'idle', 'stopping', 'offline'])
      expect(client.disposeRequests).toEqual([{ target }])
      expect(client.calls.indexOf('remote-dispose')).toBeLessThan(client.calls.indexOf('process-close'))
      await expect(handle.health()).resolves.toMatchObject({ status: 'offline' })
    } finally {
      delete process.env.SDK_RUNTIME_AMBIENT_TOKEN
    }
  })

  it('rejects unsupported Participants, seeds, presets, route options, and pre-abort before creating a client', async () => {
    const { ctx, factory } = await setup()
    const inactive = participantSnapshotSchema.parse({ ...participant, phase: 'provisioning' })
    const local = participantSnapshotSchema.parse({ ...participant, kind: 'local-agent' })
    const controller = new AbortController()
    controller.abort(new Error('test pre-abort'))
    const cases: readonly [AgentRuntimeActivationRequest, string][] = [
      [request(SessionId('sdk-inactive'), { participant: inactive }), 'AGENT_RUNTIME_SDK_PARTICIPANT_UNSUPPORTED'],
      [request(SessionId('sdk-local'), { participant: local }), 'AGENT_RUNTIME_PARTICIPANT_UNSUPPORTED'],
      [request(SessionId('sdk-fork'), { seed: { kind: 'fork', sourceSessionId: SessionId('source'), events: [] } }), 'AGENT_RUNTIME_SDK_SEED_UNSUPPORTED'],
      [request(SessionId('sdk-preset'), { agent: { preset: 'remote', options: { provider: 'p', model: 'm' } } }), 'AGENT_RUNTIME_SDK_PRESET_UNSUPPORTED'],
      [request(SessionId('sdk-no-provider'), { agent: { options: { model: 'm' } } }), 'AGENT_RUNTIME_SDK_AGENT_OPTIONS_INVALID'],
      [request(SessionId('sdk-no-model'), { agent: { options: { provider: 'p' } } }), 'AGENT_RUNTIME_SDK_AGENT_OPTIONS_INVALID'],
      [request(SessionId('sdk-bad-cap'), { agent: { options: { provider: 'p', model: 'm', maxTokens: 0 } } }), 'AGENT_RUNTIME_SDK_AGENT_OPTIONS_INVALID'],
      [request(SessionId('sdk-pre-abort'), { signal: controller.signal }), 'test pre-abort'],
    ]
    for (const [input, expected] of cases) {
      await expect(ctx.agentRuntimes.activate(input)).rejects.toMatchObject(
        expected.startsWith('AGENT_') ? { code: expected } : { message: expected },
      )
    }
    expect(factory.clients).toEqual([])
  })

  it('coalesces one Team participant/session, rejects another Session, and preserves a returned handle through provider unload', async () => {
    const { ctx, factory, provider, unregister } = await setup()
    const sessionId = SessionId('sdk-shared-session')
    const [first, second] = await Promise.all([
      ctx.agentRuntimes.activate(request(sessionId)),
      ctx.agentRuntimes.activate(request(sessionId)),
    ])
    expect(first).toBe(second)
    expect(factory.clients).toHaveLength(1)
    await expect(ctx.agentRuntimes.activate(request(SessionId('sdk-other-session'))))
      .rejects.toMatchObject({ code: 'AGENT_RUNTIME_SDK_SESSION_MISMATCH' })

    provider.closeAdmission()
    unregister()
    expect(ctx.agentRuntimes.getProvider('sdk')).toBeUndefined()
    await expect(provider.activate(request(SessionId('sdk-after-unload'))))
      .rejects.toMatchObject({ code: 'AGENT_RUNTIME_SDK_CLOSED' })
    expect(first.localAgent).toBeUndefined()
    await first.dispose()
    expect(factory.clients[0]?.calls).toContain('process-close')
  })

  it('reaps an unpublished target mismatch and frees the slot for a replacement epoch', async () => {
    const factory = new FakeClientFactory()
    factory.next = () => {
      const client = new FakeClient()
      client.openOverride = target => activationState({ ...target, participantId: 'another-participant' }, 'idle', 1)
      factory.next = undefined
      return client
    }
    const { ctx } = await setup({ factory })
    const sessionId = SessionId('sdk-target-retry')
    await expect(ctx.agentRuntimes.activate(request(sessionId)))
      .rejects.toMatchObject({ code: 'AGENT_RUNTIME_SDK_TARGET_MISMATCH' })
    expect(factory.clients[0]?.calls).toContain('process-close')

    const replacement = await ctx.agentRuntimes.activate(request(sessionId))
    expect(replacement.activation.id).not.toBeUndefined()
    expect(factory.clients).toHaveLength(2)
    await replacement.dispose()
  })

  it('rejects terminal initial states and pre-publication terminal notifications before publishing a handle', async () => {
    const terminal = new FakeClientFactory()
    terminal.next = () => {
      const client = new FakeClient()
      client.openOverride = target => activationState(target, 'offline', 1)
      terminal.next = undefined
      return client
    }
    const first = await setup({ factory: terminal })
    await expect(first.ctx.agentRuntimes.activate(request(SessionId('sdk-open-offline'))))
      .rejects.toMatchObject({ code: 'AGENT_RUNTIME_SDK_STATUS_INVALID' })
    expect(terminal.clients[0]?.calls).toContain('process-close')

    const buffered = new FakeClientFactory()
    buffered.next = () => {
      const client = new FakeClient()
      client.openHandler = async (params) => {
        client.emit(activationState(params.target, 'offline', 2))
        const state = activationState(params.target, 'idle', 1)
        client.status = state
        return state
      }
      buffered.next = undefined
      return client
    }
    const second = await setup({ factory: buffered })
    await expect(second.ctx.agentRuntimes.activate(request(SessionId('sdk-notify-offline'))))
      .rejects.toMatchObject({ code: 'AGENT_RUNTIME_SDK_STATUS_INVALID' })
    expect(buffered.clients[0]?.calls).toContain('process-close')
  })

  it('marks transport loss offline once, reaps its process, and allows a new activation epoch', async () => {
    const { ctx, factory } = await setup()
    const sessionId = SessionId('sdk-transport-loss')
    const handle = await ctx.agentRuntimes.activate(request(sessionId))
    const client = factory.clients[0]
    if (client === undefined) throw new Error('SDK provider did not create a client')
    const statuses: string[] = []
    handle.onStatus((next) => { statuses.push(next.status) })
    client.loseTransport()
    await vi.waitFor(() => {
      expect(statuses).toEqual(['offline'])
      expect(client.calls).toContain('process-close')
    })
    await expect(handle.health()).resolves.toMatchObject({ status: 'offline' })

    const replacement = await ctx.agentRuntimes.activate(request(sessionId))
    expect(replacement).not.toBe(handle)
    expect(factory.clients).toHaveLength(2)
    await replacement.dispose()
  })

  it('fails closed on conflicting sequence or invalid lifecycle transition before forwarding either status', async () => {
    const { ctx, factory } = await setup()
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-invalid-status')))
    const client = factory.clients[0]
    if (client === undefined) throw new Error('SDK provider did not create a client')
    const target = client.openRequests[0]?.target
    if (target === undefined) throw new Error('SDK provider did not open a target')
    const statuses: string[] = []
    handle.onStatus((next) => { statuses.push(next.status) })
    client.emit(activationState(target, 'starting', 2))
    await vi.waitFor(() => { expect(statuses).toEqual(['offline']) })
    client.emit(activationState(target, 'running', 3))
    await Promise.resolve()
    expect(statuses).toEqual(['offline'])
    expect(client.calls).toContain('process-close')
    await handle.dispose()
  })

  it('aborts a private opening process only after reaping it', async () => {
    const factory = new FakeClientFactory()
    let releaseOpen!: () => void
    const openGate = new Promise<void>((resolveOpen) => { releaseOpen = resolveOpen })
    factory.next = () => {
      const client = new FakeClient()
      client.openGate = openGate
      factory.next = undefined
      return client
    }
    const { ctx } = await setup({ factory })
    const controller = new AbortController()
    const opening = ctx.agentRuntimes.activate(request(SessionId('sdk-opening-abort'), { signal: controller.signal }))
    await vi.waitFor(() => { expect(factory.clients).toHaveLength(1) })
    controller.abort(new Error('opening aborted'))
    await expect(opening).rejects.toThrow('opening aborted')
    expect(factory.clients[0]?.calls).toContain('process-close')
    releaseOpen()
  })

  it('validates local launch configuration before provider registration and unregisters the loader-shaped plugin', async () => {
    const ctx = new Context()
    contexts.add(ctx)
    await ctx.plugin(AgentRuntime)
    await expect(Promise.resolve().then(() => SdkRuntime.createSdkAgentRuntimeProvider(ctx, config({ cwd: '' }))))
      .rejects.toThrow('cwd must be a non-empty existing directory')
    await expect(Promise.resolve().then(() => SdkRuntime.createSdkAgentRuntimeProvider(ctx, config({ requestTimeoutMs: 0 }))))
      .rejects.toThrow('requestTimeoutMs must be a positive finite')

    const plugin = Object.assign(
      (pluginCtx: Context): void => { SdkRuntime.apply(pluginCtx, config()) },
      { inject: SdkRuntime.inject },
    )
    const fiber = await ctx.plugin(plugin)
    expect(ctx.agentRuntimes.getProvider('sdk')).toBeDefined()
    expect(SdkRuntime.inject).toEqual(['agentRuntimes'])
    await fiber.dispose()
    expect(ctx.agentRuntimes.getProvider('sdk')).toBeUndefined()
    const recoveryPlugin = Object.assign(
      (pluginCtx: Context): void => { SdkRuntime.apply(pluginCtx, config({ recoveryProfile: 'local-sdk-v1', recoveryHostId: 'host-a' })) },
      { inject: SdkRuntime.inject },
    )
    const recoveryFiber = await ctx.plugin(recoveryPlugin)
    expect(ctx.agentRuntimes.getFencer('sdk')).toBeDefined()
    await recoveryFiber.dispose()
    expect(ctx.agentRuntimes.getFencer('sdk')).toBeUndefined()
  })

  it('opens resume without a deadline or token cap and exercises the production client factory', async () => {
    const { requestTimeoutMs: _ignored, ...withoutDeadline } = config()
    const { ctx, factory } = await setup({ config: withoutDeadline })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-resume'), {
      seed: { kind: 'resume' },
      agent: { options: { provider: 'resume-route', model: 'resume-model' } },
    }))
    const client = factory.clients[0]
    if (client === undefined) throw new Error('SDK provider did not create a client')
    expect(client.initializeRequests).toEqual([{
      credential: 'agent-runtime-sdk-test-credential',
      cwd: process.cwd(), provider: 'resume-route', model: 'resume-model',
    }])
    expect(client.openRequests[0]?.seed).toEqual({ kind: 'resume' })
    expect(factory.options[0]?.requestTimeoutMs).toBeUndefined()
    await handle.dispose()

    const production = harnessSdkActivationClientFactory.create({ command: process.execPath })
    expect(production).toBeInstanceOf(HarnessClient)
    await production.close()
  })

  it('accepts equal pre-publication status, ignores unrelated notifications, and rejects conflicts or loss before publication', async () => {
    const acceptedFactory = new FakeClientFactory()
    acceptedFactory.next = () => {
      const client = new FakeClient()
      client.openHandler = async (params) => {
        client.subscription.push({ method: 'session.status', params: { sessionId: 'other', status: 'idle' } })
        client.emit(activationState(params.target, 'idle', 1))
        await Promise.resolve()
        return activationState(params.target, 'idle', 1)
      }
      acceptedFactory.next = undefined
      return client
    }
    const accepted = await setup({ factory: acceptedFactory })
    const handle = await accepted.ctx.agentRuntimes.activate(request(SessionId('sdk-prepublish-equal')))
    await handle.dispose()

    const advancedFactory = new FakeClientFactory()
    advancedFactory.next = () => {
      const client = new FakeClient()
      client.openHandler = async (params) => {
        client.emit(activationState(params.target, 'running', 2))
        await vi.waitFor(() => { expect(client.subscription.pending).toBe(0) })
        return activationState(params.target, 'idle', 1)
      }
      advancedFactory.next = undefined
      return client
    }
    const advanced = await setup({ factory: advancedFactory })
    const advancedHandle = await advanced.ctx.agentRuntimes.activate(request(SessionId('sdk-prepublish-advanced')))
    await expect(advancedHandle.health()).resolves.toMatchObject({ status: 'running' })
    await advancedHandle.dispose()

    const conflictingFactory = new FakeClientFactory()
    conflictingFactory.next = () => {
      const client = new FakeClient()
      client.openHandler = async (params) => {
        client.emit(activationState(params.target, 'running', 1))
        await vi.waitFor(() => { expect(client.subscription.pending).toBe(0) })
        return activationState(params.target, 'idle', 1)
      }
      conflictingFactory.next = undefined
      return client
    }
    const conflicting = await setup({ factory: conflictingFactory })
    await expect(conflicting.ctx.agentRuntimes.activate(request(SessionId('sdk-prepublish-conflict'))))
      .rejects.toMatchObject({ code: 'AGENT_RUNTIME_SDK_STATUS_INVALID' })
    expect(conflictingFactory.clients[0]?.calls).toContain('process-close')

    const recordConflictFactory = new FakeClientFactory()
    recordConflictFactory.next = () => {
      const client = new FakeClient()
      client.openHandler = async (params) => {
        client.emit(activationState(params.target, 'running', 1))
        await vi.waitFor(() => { expect(client.subscription.pending).toBe(0) })
        client.emit(activationState(params.target, 'idle', 1))
        await vi.waitFor(() => { expect(client.subscription.pending).toBe(0) })
        return activationState(params.target, 'idle', 1)
      }
      recordConflictFactory.next = undefined
      return client
    }
    const recordConflict = await setup({ factory: recordConflictFactory })
    await expect(recordConflict.ctx.agentRuntimes.activate(request(SessionId('sdk-prepublish-record-conflict'))))
      .rejects.toMatchObject({ code: 'AGENT_RUNTIME_SDK_STATUS_INVALID' })

    const failedFactory = new FakeClientFactory()
    failedFactory.next = () => {
      const client = new FakeClient()
      client.openHandler = async (params) => {
        client.subscription.fail('prepublication transport failure' as unknown as Error)
        await new Promise<void>((resolve) => { setImmediate(resolve) })
        return activationState(params.target, 'idle', 1)
      }
      failedFactory.next = undefined
      return client
    }
    const failed = await setup({ factory: failedFactory })
    await expect(failed.ctx.agentRuntimes.activate(request(SessionId('sdk-prepublish-failure'))))
      .rejects.toThrow('prepublication transport failure')
    expect(failedFactory.clients[0]?.calls).toContain('process-close')
  })

  it('fails closed for status-read errors and ignores returned status subscriptions after offline', async () => {
    const { ctx, factory } = await setup()
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-health-failure')))
    const client = factory.clients[0]
    if (client === undefined) throw new Error('SDK provider did not create a client')
    const statuses: string[] = []
    handle.onStatus((next) => { statuses.push(next.status) })
    client.statusError = new Error('malformed status response')
    await expect(handle.health()).rejects.toThrow('malformed status response')
    await vi.waitFor(() => { expect(statuses).toEqual(['offline']) })
    const unsubscribe = handle.onStatus(() => { throw new Error('offline listener must not register') })
    unsubscribe()
    handle.interrupt({ kind: 'user' })
    await handle.dispose()
    expect(client.calls.filter(call => call === 'interrupt')).toHaveLength(0)
  })

  it('contains remote interruption failures and turns transport failures into offline status', async () => {
    const { ctx, factory } = await setup()
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-interrupt-failure')))
    const client = factory.clients[0]
    if (client === undefined) throw new Error('SDK provider did not create a client')
    client.interruptError = new Error('remote interrupt rejected')
    handle.interrupt({ kind: 'parent' })
    await vi.waitFor(() => { expect(client.interruptRequests).toHaveLength(1) })
    await Promise.resolve()
    await expect(handle.health()).resolves.toMatchObject({ status: 'idle' })

    client.interruptError = {
      toString(): string { throw new Error('hostile interruption rendering') },
    }
    handle.interrupt({ kind: 'hook', reason: 'hostile error' })
    await vi.waitFor(() => { expect(client.interruptRequests).toHaveLength(2) })
    await Promise.resolve()

    const statuses: string[] = []
    handle.onStatus((next) => { statuses.push(next.status) })
    client.interruptError = new TransportClosedError('remote interruption lost transport')
    handle.interrupt({ kind: 'user' })
    await vi.waitFor(() => { expect(statuses).toEqual(['offline']) })
    await handle.dispose()
  })

  it('rejects synchronous interruption errors, remote target mismatches, and remote offline close failures without reviving the epoch', async () => {
    const { ctx, factory } = await setup()
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-sync-interrupt')))
    const client = factory.clients[0]
    if (client === undefined) throw new Error('SDK provider did not create a client')
    const synchronous = client as unknown as { interruptActivation: SdkActivationClient['interruptActivation'] }
    synchronous.interruptActivation = () => { throw new Error('synchronous interruption failure') }
    handle.interrupt({ kind: 'user' })
    await Promise.resolve()
    await expect(handle.health()).resolves.toMatchObject({ status: 'idle' })

    synchronous.interruptActivation = () => { throw new TransportClosedError('synchronous interruption transport loss') }
    const synchronousStatuses: string[] = []
    handle.onStatus((next) => { synchronousStatuses.push(next.status) })
    handle.interrupt({ kind: 'user' })
    await vi.waitFor(() => { expect(synchronousStatuses).toEqual(['offline']) })

    const targetMismatch = await ctx.agentRuntimes.activate(request(SessionId('sdk-target-mismatch')))
    const mismatchClient = factory.clients[1]
    if (mismatchClient === undefined) throw new Error('SDK provider did not create a target-mismatch client')
    const target = mismatchClient.openRequests[0]?.target
    if (target === undefined) throw new Error('SDK provider did not open a target')
    const statuses: string[] = []
    targetMismatch.onStatus((next) => { statuses.push(next.status) })
    mismatchClient.emit(activationState({ ...target, participantId: 'wrong-participant' }, 'running', 2))
    await vi.waitFor(() => { expect(statuses).toEqual(['offline']) })
    expect(mismatchClient.calls).toContain('process-close')

    const replacement = await ctx.agentRuntimes.activate(request(SessionId('sdk-offline-close-failure')))
    const replacementClient = factory.clients[2]
    if (replacementClient === undefined) throw new Error('SDK provider did not create a replacement client')
    const replacementTarget = replacementClient.openRequests[0]?.target
    if (replacementTarget === undefined) throw new Error('SDK provider did not open a replacement target')
    replacementClient.closeError = new Error('offline close failed')
    const replacementStatuses: string[] = []
    replacement.onStatus((next) => { replacementStatuses.push(next.status) })
    replacementClient.emit(activationState(replacementTarget, 'idle', 1))
    replacementClient.emit(activationState(replacementTarget, 'offline', 2))
    await vi.waitFor(() => { expect(replacementStatuses).toEqual(['offline']) })
    await expect(replacement.dispose()).resolves.toBeUndefined()
  })

  it('memoizes disposal and leaves termination unconfirmed when neither remote nor process teardown proves it stopped', async () => {
    const { ctx, factory } = await setup()
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-dispose-memoized')))
    const client = factory.clients[0]
    if (client === undefined) throw new Error('SDK provider did not create a client')
    let releaseDispose!: () => void
    client.disposeGate = new Promise<void>((resolveDispose) => { releaseDispose = resolveDispose })
    const first = handle.dispose()
    const second = handle.dispose()
    expect(second).toBe(first)
    releaseDispose()
    await first
    expect(client.calls.filter(call => call === 'remote-dispose')).toHaveLength(1)

    const invalid = await ctx.agentRuntimes.activate(request(SessionId('sdk-dispose-invalid')))
    const invalidClient = factory.clients[1]
    if (invalidClient === undefined) throw new Error('SDK provider did not create an invalid-dispose client')
    const invalidTarget = invalidClient.openRequests[0]?.target
    if (invalidTarget === undefined) throw new Error('SDK provider did not open an invalid-dispose target')
    invalidClient.disposeState = activationState(invalidTarget, 'running', 2)
    await expect(invalid.dispose()).resolves.toBeUndefined()
    await expect(invalid.health()).resolves.toMatchObject({ status: 'offline' })

    const aggregate = await ctx.agentRuntimes.activate(request(SessionId('sdk-dispose-aggregate')))
    const aggregateClient = factory.clients[2]
    if (aggregateClient === undefined) throw new Error('SDK provider did not create an aggregate-dispose client')
    aggregateClient.disposeError = new Error('remote disposal failure')
    aggregateClient.closeError = new Error('process disposal failure')
    const aggregateStatuses: string[] = []
    aggregate.onStatus((next) => { aggregateStatuses.push(next.status) })
    await expect(aggregate.dispose()).rejects.toMatchObject({ code: 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED' })
    await expect(aggregate.health()).rejects.toMatchObject({ code: 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED' })
    expect(aggregateStatuses).toEqual(['stopping'])
  })

  it('reaps initialization failure, accepts non-Error abort reasons, and validates absent or invalid launch timeouts', async () => {
    const failedFactory = new FakeClientFactory()
    failedFactory.next = () => {
      const client = new FakeClient()
      client.initializeError = new Error('initialization failed')
      client.closeError = new Error('initialization cleanup failed')
      failedFactory.next = undefined
      return client
    }
    const failed = await setup({ factory: failedFactory })
    await expect(failed.ctx.agentRuntimes.activate(request(SessionId('sdk-init-failure')))).rejects.toThrow('initialization failed')
    expect(failedFactory.clients[0]?.calls).toContain('process-close')

    const abortFactory = new FakeClientFactory()
    let releaseOpen!: () => void
    const openGate = new Promise<void>((resolveOpen) => { releaseOpen = resolveOpen })
    abortFactory.next = () => {
      const client = new FakeClient()
      client.openGate = openGate
      abortFactory.next = undefined
      return client
    }
    const aborted = await setup({ factory: abortFactory })
    const controller = new AbortController()
    const opening = aborted.ctx.agentRuntimes.activate(request(SessionId('sdk-string-abort'), { signal: controller.signal }))
    await vi.waitFor(() => { expect(abortFactory.clients).toHaveLength(1) })
    controller.abort('operator stopped opening')
    await expect(opening).rejects.toThrow('SDK AgentRuntime activation was aborted before publication')
    releaseOpen()

    const timeoutContext = new Context()
    contexts.add(timeoutContext)
    await timeoutContext.plugin(AgentRuntime)
    const { requestTimeoutMs: _ignored, ...withoutDeadline } = config()
    expect(() => SdkRuntime.createSdkAgentRuntimeProvider(timeoutContext, withoutDeadline)).not.toThrow()
    await expect(Promise.resolve().then(() => SdkRuntime.createSdkAgentRuntimeProvider(timeoutContext, config({ disposeGraceMs: 0 }))))
      .rejects.toThrow('disposeGraceMs must be a positive finite')
    await expect(Promise.resolve().then(() => SdkRuntime.createSdkAgentRuntimeProvider(timeoutContext, config({ cwd: '.tmp/no-such-sdk-runtime-directory' }))))
      .rejects.toThrow('cwd is not an existing directory')
  })

  it('maps transport health loss and validates duplicate, conflicting, and remote-stopping lifecycle observations', async () => {
    const { ctx, factory } = await setup()
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-observation-edges')))
    const client = factory.clients[0]
    if (client === undefined) throw new Error('SDK provider did not create a client')
    const target = client.openRequests[0]?.target
    if (target === undefined) throw new Error('SDK provider did not open a target')
    const statuses: string[] = []
    handle.onStatus((next) => { statuses.push(next.status) })
    client.emit(activationState(target, 'idle', 1))
    client.emit(activationState(target, 'stopping', 2))
    await vi.waitFor(() => { expect(statuses).toEqual(['stopping']) })
    await handle.dispose()
    expect(statuses).toEqual(['stopping', 'offline'])

    const conflicting = await ctx.agentRuntimes.activate(request(SessionId('sdk-equal-sequence-conflict')))
    const conflictingClient = factory.clients[1]
    if (conflictingClient === undefined) throw new Error('SDK provider did not create a conflicting client')
    const conflictingTarget = conflictingClient.openRequests[0]?.target
    if (conflictingTarget === undefined) throw new Error('SDK provider did not open a conflicting target')
    const conflictingStatuses: string[] = []
    conflicting.onStatus((next) => { conflictingStatuses.push(next.status) })
    conflictingClient.emit(activationState(conflictingTarget, 'running', 1))
    await vi.waitFor(() => { expect(conflictingStatuses).toEqual(['offline']) })

    const transport = await ctx.agentRuntimes.activate(request(SessionId('sdk-status-transport-loss')))
    const transportClient = factory.clients[2]
    if (transportClient === undefined) throw new Error('SDK provider did not create a transport client')
    const transportStatuses: string[] = []
    transport.onStatus((next) => { transportStatuses.push(next.status) })
    transportClient.statusError = new TransportClosedError('status transport lost')
    await expect(transport.health()).resolves.toMatchObject({ status: 'offline' })
    expect(transportStatuses).toEqual(['offline'])
  })

  it('continues cleanup after remote status and transport close diagnostics fail', async () => {
    const { ctx, factory } = await setup()
    const protocol = await ctx.agentRuntimes.activate(request(SessionId('sdk-protocol-close-error')))
    const protocolClient = factory.clients[0]
    if (protocolClient === undefined) throw new Error('SDK provider did not create a protocol client')
    protocolClient.closeError = new Error('protocol close failure')
    protocolClient.statusError = new Error('protocol status failure')
    await expect(protocol.health()).rejects.toThrow('protocol status failure')
    await expect(protocol.dispose()).rejects.toMatchObject({ code: 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED' })
    await expect(protocol.health()).rejects.toMatchObject({ code: 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED' })
    await expect(ctx.agentRuntimes.activate(request(SessionId('sdk-protocol-retry'))))
      .rejects.toMatchObject({ code: 'AGENT_RUNTIME_SDK_SESSION_MISMATCH' })

    const { ctx: transportCtx, factory: transportFactory } = await setup()
    const transport = await transportCtx.agentRuntimes.activate(request(SessionId('sdk-transport-close-error')))
    const transportClient = transportFactory.clients[0]
    if (transportClient === undefined) throw new Error('SDK provider did not create a transport client')
    const transportStatuses: string[] = []
    transport.onStatus((next) => { transportStatuses.push(next.status) })
    transportClient.closeError = new Error('transport close failure')
    transportClient.loseTransport()
    await vi.waitFor(() => { expect(transportClient.calls).toContain('process-close') })
    await expect(transport.dispose()).rejects.toMatchObject({ code: 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED' })
    await expect(transport.health()).rejects.toMatchObject({ code: 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED' })
    expect(transportStatuses).toEqual(['stopping'])
  })

  it('permits an offline disposal response at the current sequence and preserves completion after a contained logger failure', async () => {
    const { ctx, factory } = await setup()
    const logger = ctx.logger as unknown as { warn(message: string): void }
    logger.warn = () => { throw new Error('logger unavailable') }
    const handle = await ctx.agentRuntimes.activate(request(SessionId('sdk-current-dispose-sequence')))
    const client = factory.clients[0]
    if (client === undefined) throw new Error('SDK provider did not create a client')
    const target = client.openRequests[0]?.target
    if (target === undefined) throw new Error('SDK provider did not open a target')
    client.disposeState = activationState(target, 'offline', 1)
    await expect(handle.dispose()).resolves.toBeUndefined()
  })
})
