import type { Context } from '@clocky/cordis'
import type { Agent, AgentHandle } from '@clocky/clocky-agent'
import type { Session } from '@clocky/clocky-session'
import type { JsonRpcTransportPeer, SdkActivationTarget } from '@clocky/clocky-sdk-protocol'
import { JsonRpcRequestError } from '@clocky/clocky-sdk-protocol'
import { describe, expect, it, vi } from 'vitest'
import { HarnessSdkJsonRpcServer } from '../src/index.ts'
import { SDK_TEST_CREDENTIAL, testProductPrincipals } from './product-auth.ts'

interface FakeAgent extends Agent {
  status: 'idle' | 'running'
}

interface FakeSession extends Session {
  header: Session['header']
}

/** Capture one server's outbound JSON-RPC notifications. */
class FakeTransport implements JsonRpcTransportPeer {
  readonly notifications: { method: string; params?: object }[] = []

  request(method: string, params: object): Promise<unknown> {
    return Promise.reject(new Error(`unexpected host request ${method}: ${JSON.stringify(params)}`))
  }

  notify(method: string, params?: object): void {
    this.notifications.push(params === undefined ? { method } : { method, params })
  }
}

/** Test-owned Context with exact Agent publication and lifecycle edges. */
class FakeRuntime {
  readonly transport = new FakeTransport()
  readonly listeners = new Map<string, ((payload: unknown) => void)[]>()
  readonly live = new Map<string, FakeAgent>()
  readonly cancels = new Map<string, ReturnType<typeof vi.fn>>()
  readonly persisted = new Map<string, Pick<Session['header'], 'teamId' | 'participantId'>>()
  readonly create = vi.fn()
  readonly resume = vi.fn()
  readonly materializeHeader = vi.fn(async (session: Session) => {
    this.persisted.set(String(session.id), persistedProvenance(session))
  })
  persistenceAvailable = true
  createWait: Promise<void> | undefined
  disposeFailure: Error | undefined
  publishCreates = true
  missingSetupAgent = false
  readonly ctx: Context

  constructor() {
    this.create.mockImplementation(async (options: {
      sessionId: string
      meta?: { cwd?: string; teamId?: string; participantId?: string }
      setup?: (ctx: { agent: Agent | undefined }) => Promise<void> | void
    }) => {
      const agent = this.newAgent(options.sessionId, options.meta)
      await this.createWait
      await options.setup?.({ agent: this.missingSetupAgent ? undefined : agent })
      if (this.publishCreates) this.live.set(String(agent.id), agent)
      this.emit('session/created', agent.session)
      return this.handle(agent)
    })
    this.resume.mockImplementation(async (options: {
      resumeSessionId: string
      setup?: (ctx: { agent: Agent | undefined }) => Promise<void> | void
    }) => {
      const meta = this.persisted.get(options.resumeSessionId)
      if (meta === undefined) throw new Error(`missing persisted Session '${options.resumeSessionId}'`)
      const agent = this.newAgent(options.resumeSessionId, meta)
      await options.setup?.({ agent: this.missingSetupAgent ? undefined : agent })
      if (this.publishCreates) this.live.set(String(agent.id), agent)
      this.emit('session/created', agent.session)
      return this.handle(agent)
    })
    this.ctx = {
      on: (name: string, listener: (payload: unknown) => void) => { // The harness exposes only emit-style listeners here.
        const listeners = this.listeners.get(name) ?? []
        listeners.push(listener)
        this.listeners.set(name, listeners)
        return () => {
          const index = listeners.indexOf(listener)
          if (index >= 0) listeners.splice(index, 1)
        }
      },
      get: (name: string) => {
        if (name === 'llm') return { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] }
        if (name === 'productPrincipals') return testProductPrincipals()
        if (name === 'sessionPersistence') return this.persistenceAvailable
          ? { materializeHeader: this.materializeHeader }
          : undefined
        return undefined
      },
      agents: {
        create: this.create,
        resume: this.resume,
        get: (id: string) => this.live.get(id),
      },
    } as unknown as Context
  }

  /** Build a server and select a route that the fake LLM registry owns. */
  async server(): Promise<HarnessSdkJsonRpcServer> {
    const server = new HarnessSdkJsonRpcServer(this.ctx, this.transport)
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })
    return server
  }

  /** Emit one exact Agent status edge through the server's registered listener. */
  emitStatus(agent: FakeAgent, status: FakeAgent['status']): void {
    agent.status = status
    this.emit('agent/status', { agent, status })
  }

  /** Emit one ordinary Context event to the listeners currently attached. */
  emit(name: string, payload: unknown): void {
    for (const listener of [...this.listeners.get(name) ?? []]) listener(payload)
  }

  /** Build one unregistered Agent that must not affect an activation's state. */
  createUnmanagedAgent(id: string): FakeAgent {
    return this.newAgent(id)
  }

  private newAgent(id: string, meta?: { cwd?: string; teamId?: string; participantId?: string }): FakeAgent {
    const session = {
      id,
      header: {
        id,
        version: 0,
        createdAt: 0,
        cwd: meta?.cwd,
        teamId: meta?.teamId,
        participantId: meta?.participantId,
      },
    } as unknown as FakeSession
    const cancel = vi.fn()
    this.cancels.set(id, cancel)
    return {
      id,
      session,
      status: 'idle',
      cancel,
      followup: vi.fn(),
    } as unknown as FakeAgent
  }

  private handle(agent: FakeAgent): AgentHandle {
    return {
      agent,
      dispose: vi.fn(async () => {
        if (this.disposeFailure !== undefined) throw this.disposeFailure
        this.live.delete(String(agent.id))
        this.emit('agent/disposed', { agent })
      }),
    }
  }
}

/** Copy only present provenance fields into an exact-optional test header. */
function persistedProvenance(session: Session): Pick<Session['header'], 'teamId' | 'participantId'> {
  return {
    ...session.header.teamId === undefined ? {} : { teamId: session.header.teamId },
    ...session.header.participantId === undefined ? {} : { participantId: session.header.participantId },
  }
}

/** Build a distinct complete activation target for one test epoch. */
function target(overrides: Partial<SdkActivationTarget> = {}): SdkActivationTarget {
  return {
    activationId: 'activation-1',
    teamId: 'team-1',
    participantId: 'participant-1',
    sessionId: 'session-1',
    ...overrides,
  }
}

/** Assert a structured server lifecycle rejection. */
async function expectActivationError(operation: Promise<unknown>, code: string): Promise<void> {
  const error = await operation.then(
    () => { throw new Error('operation unexpectedly succeeded') },
    (failure: unknown) => failure,
  )
  expect(error).toBeInstanceOf(JsonRpcRequestError)
  expect(error).toMatchObject({ code: -32_001, data: { code } })
}

describe('SDK remote activation lifecycle', () => {
  it('materializes fresh provenance, streams exact state transitions, interrupts without release, and retains an offline tombstone', async () => {
    const runtime = new FakeRuntime()
    const server = await runtime.server()
    const first = target()

    const opened = await server.openActivation({ target: first, seed: { kind: 'fresh' } })
    expect(opened.state).toMatchObject({ ...first, status: 'idle', statusSequence: 1 })
    expect(runtime.materializeHeader).toHaveBeenCalledOnce()
    expect(runtime.persisted.get(first.sessionId)).toEqual({ teamId: first.teamId, participantId: first.participantId })
    expect(runtime.transport.notifications.filter(item => item.method === 'activation.status'))
      .toEqual([
        { method: 'activation.status', params: { state: { ...first, status: 'starting', statusSequence: 0 } } },
        { method: 'activation.status', params: { state: { ...first, status: 'idle', statusSequence: 1 } } },
      ])

    const agent = runtime.live.get(first.sessionId)
    if (agent === undefined) throw new Error('fresh activation did not publish its Agent')
    runtime.emitStatus(agent, 'running')
    expect(server.activationStatus({ target: first }).state).toMatchObject({ status: 'running', statusSequence: 2 })
    server.interruptActivation({ target: first, cause: { kind: 'hook', reason: 'operator request' } })
    expect(runtime.cancels.get(first.sessionId)).toHaveBeenCalledWith(
      { kind: 'hook', reason: 'operator request' },
      { keepInbox: true },
    )

    const unrelated = runtime.createUnmanagedAgent('unrelated')
    runtime.emitStatus(unrelated, 'running')
    expect(runtime.transport.notifications.filter(item => item.method === 'activation.status')).toHaveLength(3)

    const disposed = await server.disposeActivation({ target: first })
    expect(disposed.state).toMatchObject({ status: 'offline', statusSequence: 4 })
    expect(runtime.live.has(first.sessionId)).toBe(false)
    await expect(server.disposeActivation({ target: first })).resolves.toEqual(disposed)
    await expect(server.openActivation({ target: first, seed: { kind: 'fresh' } })).resolves.toEqual(disposed)
    await server.shutdown()
  })

  it('rejects competing or changed activation identities and admits a cold-resume replacement after offline', async () => {
    const runtime = new FakeRuntime()
    const server = await runtime.server()
    const first = target()
    const opened = await server.openActivation({ target: first, seed: { kind: 'fresh' } })
    await expect(server.openActivation({ target: first, seed: { kind: 'fresh' } })).resolves.toEqual(opened)
    expect(runtime.create).toHaveBeenCalledOnce()

    await expectActivationError(server.openActivation({
      target: { ...first, teamId: 'other-team' }, seed: { kind: 'fresh' },
    }), 'SDK_ACTIVATION_TARGET_MISMATCH')
    await expectActivationError(server.openActivation({
      target: first, seed: { kind: 'resume' },
    }), 'SDK_ACTIVATION_SEED_MISMATCH')
    await expectActivationError(server.openActivation({
      target: { ...first, activationId: 'activation-session-conflict' }, seed: { kind: 'fresh' },
    }), 'SDK_ACTIVATION_SESSION_CONFLICT')
    await expectActivationError(server.openActivation({
      target: { ...first, activationId: 'activation-participant-conflict', sessionId: 'other-session' }, seed: { kind: 'fresh' },
    }), 'SDK_ACTIVATION_PARTICIPANT_CONFLICT')
    await expect(server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })).resolves.toBeDefined()
    await expect(server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model', maxTokens: 7 }))
      .rejects.toThrow('SDK route cannot change while a remote activation is resident')
    await expect(server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'another-model' }))
      .rejects.toThrow('SDK route cannot change while a remote activation is resident')

    await server.disposeActivation({ target: first })
    await expect(server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'another-model' })).resolves.toBeDefined()
    const resumedTarget = { ...first, activationId: 'activation-resumed' }
    const resumed = await server.openActivation({ target: resumedTarget, seed: { kind: 'resume' } })
    expect(resumed.state).toMatchObject({ ...resumedTarget, status: 'idle', statusSequence: 1 })
    expect(runtime.resume).toHaveBeenCalledOnce()
    await server.shutdown()
  })

  it('passes an initialized output cap into both fresh and resumed activation Agents', async () => {
    const runtime = new FakeRuntime()
    const server = await runtime.server()
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model', maxTokens: 19 })
    const fresh = target({ activationId: 'activation-capped-fresh', sessionId: 'session-capped' })
    await server.openActivation({ target: fresh, seed: { kind: 'fresh' } })
    expect(runtime.create).toHaveBeenLastCalledWith(expect.objectContaining({
      agentOptions: { provider: 'test-provider', model: 'test-model', maxTokens: 19 },
    }))
    await server.disposeActivation({ target: fresh })
    const resumed = { ...fresh, activationId: 'activation-capped-resume' }
    await server.openActivation({ target: resumed, seed: { kind: 'resume' } })
    expect(runtime.resume).toHaveBeenLastCalledWith(expect.objectContaining({
      agentOptions: { provider: 'test-provider', model: 'test-model', maxTokens: 19 },
    }))
    await server.shutdown()
  })

  it('rejects malformed raw commands before side effects and retries an unpublished fresh failure', async () => {
    const runtime = new FakeRuntime()
    const server = await runtime.server()
    const first = target()
    for (const [method, params] of [
      ['activation/open', { target: first, seed: { kind: 'fresh' }, unexpected: true }],
      ['activation/link-enroll', {
        target: first,
        binding: { ...first, provider: 'sdk' },
        enrollment: { provider: 'websocket', endpoint: 'wss://team.example.test/team-link', capability: 'opaque' },
        unexpected: true,
      }],
      ['activation/status', { target: { activationId: first.activationId } }],
      ['activation/interrupt', { target: first, cause: { kind: 'hook' } }],
      ['activation/dispose', { target: first, extra: true }],
    ] as const) {
      await expect(server.handleRequest(method, params)).rejects.toMatchObject({
        code: -32_602,
      })
    }
    expect(runtime.create).not.toHaveBeenCalled()

    runtime.persistenceAvailable = false
    await expectActivationError(server.openActivation({ target: first, seed: { kind: 'fresh' } }), 'SDK_ACTIVATION_PERSISTENCE_REQUIRED')
    expect((server as unknown as { activations: Map<string, unknown> }).activations.size).toBe(0)
    runtime.persistenceAvailable = true
    await expect(server.openActivation({ target: first, seed: { kind: 'fresh' } })).resolves.toMatchObject({
      state: { status: 'idle' },
    })
    await expectActivationError(server.enrollActivationLink({
      target: first,
      binding: { ...first, provider: 'sdk' },
      enrollment: { provider: 'websocket', endpoint: 'wss://team.example.test/team-link', capability: 'opaque' },
    }), 'SDK_ACTIVATION_LINK_UNAVAILABLE')
    await server.shutdown()
  })

  it('rejects a persisted resume with mismatched provenance before publication', async () => {
    const runtime = new FakeRuntime()
    const server = await runtime.server()

    const resumed = target({ activationId: 'activation-wrong-header', sessionId: 'persisted-session' })
    runtime.persisted.set(resumed.sessionId, { teamId: 'another-team', participantId: resumed.participantId })
    await expectActivationError(server.openActivation({ target: resumed, seed: { kind: 'resume' } }), 'SDK_ACTIVATION_PROVENANCE_MISMATCH')
    expect(runtime.live.has(resumed.sessionId)).toBe(false)
    runtime.persisted.set(resumed.sessionId, { teamId: resumed.teamId, participantId: resumed.participantId })
    await expect(server.openActivation({ target: resumed, seed: { kind: 'resume' } })).resolves.toMatchObject({
      state: { status: 'idle' },
    })
    await server.shutdown()
  })

  it('coalesces an opening epoch, serializes disposal, and marks an externally departed Agent offline', async () => {
    const runtime = new FakeRuntime()
    let release!: () => void
    runtime.createWait = new Promise<void>((resolve) => { release = resolve })
    const server = await runtime.server()
    const first = target()
    const opening = server.openActivation({ target: first, seed: { kind: 'fresh' } })
    const retry = server.openActivation({ target: first, seed: { kind: 'fresh' } })
    expect(runtime.create).toHaveBeenCalledOnce()
    expect(server.activationStatus({ target: first }).state).toMatchObject({ status: 'starting', statusSequence: 0 })
    const disposing = server.disposeActivation({ target: first })
    release()
    const [opened, retried, disposed] = await Promise.all([opening, retry, disposing])
    expect(opened).toEqual(retried)
    expect(disposed.state.status).toBe('offline')

    const replacement = target({ activationId: 'activation-external', sessionId: 'session-external' })
    const active = await server.openActivation({ target: replacement, seed: { kind: 'fresh' } })
    expect(active.state.status).toBe('idle')
    const agent = runtime.live.get(replacement.sessionId)
    if (agent === undefined) throw new Error('replacement activation did not publish')
    runtime.live.delete(replacement.sessionId)
    await expectActivationError(Promise.resolve().then(() => server.interruptActivation({
      target: replacement,
      cause: { kind: 'user' },
    })), 'SDK_ACTIVATION_NOT_LIVE')
    expect(server.activationStatus({ target: replacement }).state.status).toBe('offline')
    await expectActivationError(Promise.resolve().then(() => server.interruptActivation({
      target: replacement,
      cause: { kind: 'user' },
    })), 'SDK_ACTIVATION_NOT_LIVE')
    await server.shutdown()
  })

  it('rejects unavailable and stale activation paths without leaking their reservation', async () => {
    const uninitialized = new FakeRuntime()
    const uninitializedServer = new HarnessSdkJsonRpcServer(uninitialized.ctx, uninitialized.transport)
    await expectActivationError(uninitializedServer.openActivation({ target: target(), seed: { kind: 'fresh' } }), 'SDK_ACTIVATION_NOT_INITIALIZED')
    await uninitializedServer.shutdown()

    const runtime = new FakeRuntime()
    const server = await runtime.server()
    await expectActivationError(Promise.resolve().then(() => server.activationStatus({ target: target() })), 'SDK_ACTIVATION_NOT_FOUND')
    await expectActivationError(Promise.resolve().then(() => server.interruptActivation({
      target: target(), cause: { kind: 'disposed' },
    })), 'SDK_ACTIVATION_NOT_FOUND')

    runtime.publishCreates = false
    const unpublished = target({ activationId: 'activation-unpublished', sessionId: 'session-unpublished' })
    await expectActivationError(server.openActivation({ target: unpublished, seed: { kind: 'fresh' } }), 'SDK_ACTIVATION_NOT_LIVE')
    expect((server as unknown as { activations: Map<string, unknown> }).activations.has(unpublished.activationId)).toBe(false)
    runtime.publishCreates = true

    runtime.missingSetupAgent = true
    const freshSetup = target({ activationId: 'activation-fresh-setup', sessionId: 'session-fresh-setup' })
    await expect(server.openActivation({ target: freshSetup, seed: { kind: 'fresh' } })).rejects.toThrow('SDK activation creation setup has no scoped Agent')
    const resumeSetup = target({ activationId: 'activation-resume-setup', sessionId: 'session-resume-setup' })
    runtime.persisted.set(resumeSetup.sessionId, { teamId: resumeSetup.teamId, participantId: resumeSetup.participantId })
    await expect(server.openActivation({ target: resumeSetup, seed: { kind: 'resume' } })).rejects.toThrow('SDK activation resume setup has no scoped Agent')
    runtime.missingSetupAgent = false

    const activeTarget = target({ activationId: 'activation-manual', sessionId: 'session-manual' })
    await server.openActivation({ target: activeTarget, seed: { kind: 'fresh' } })
    const internal = server as unknown as {
      activations: Map<string, {
        handle: AgentHandle | undefined
        opening: Promise<unknown> | undefined
        status: string
      }>
      disposeActivationRecord(record: {
        handle: AgentHandle | undefined
        opening: Promise<unknown> | undefined
        status: string
      }): Promise<unknown>
      transitionActivation(record: { status: string }, status: string): unknown
    }
    const record = internal.activations.get(activeTarget.activationId)
    if (record === undefined) throw new Error('active test record was not retained')
    record.handle = undefined
    record.opening = undefined
    await expect(internal.disposeActivationRecord(record)).rejects.toMatchObject({ data: { code: 'SDK_ACTIVATION_NOT_LIVE' } })
    record.status = 'offline'
    internal.transitionActivation(record, 'running')
    await expect((internal as unknown as { releaseActivation(record: { status: string }): Promise<unknown> }).releaseActivation(record))
      .resolves.toBeDefined()
    await expect(server.handleRequest('activation/status', { target: activeTarget })).resolves.toMatchObject({
      state: { status: 'offline' },
    })
    await server.shutdown()
  })

  it('keeps distinct Team participants in independent slots and waits for an in-flight activation before shutdown', async () => {
    const runtime = new FakeRuntime()
    const server = await runtime.server()
    const first = target()
    const second = target({ activationId: 'activation-second', participantId: 'participant-second', sessionId: 'session-second' })
    await Promise.all([
      server.openActivation({ target: first, seed: { kind: 'fresh' } }),
      server.openActivation({ target: second, seed: { kind: 'fresh' } }),
    ])
    await server.disposeActivation({ target: first })
    expect(server.activationStatus({ target: second }).state.status).toBe('idle')
    await server.disposeActivation({ target: second })

    const waitingRuntime = new FakeRuntime()
    let release!: () => void
    waitingRuntime.createWait = new Promise<void>((resolve) => { release = resolve })
    const waitingServer = await waitingRuntime.server()
    const opening = waitingServer.openActivation({ target: target({ activationId: 'activation-waiting', sessionId: 'session-waiting' }), seed: { kind: 'fresh' } })
    const shuttingDown = waitingServer.shutdown()
    release()
    await Promise.all([opening, shuttingDown])
    await expect(waitingServer.openActivation({
      target: target({ activationId: 'after-shutdown', sessionId: 'after-shutdown' }),
      seed: { kind: 'fresh' },
    })).rejects.toThrow('SDK server is shutting down')
  })

  it('settles activation cleanup during server shutdown, preserving a disposal failure', async () => {
    const runtime = new FakeRuntime()
    const server = await runtime.server()
    const first = target()
    await server.openActivation({ target: first, seed: { kind: 'fresh' } })
    await server.shutdown()
    expect(runtime.live.size).toBe(0)

    const failingRuntime = new FakeRuntime()
    const failing = await failingRuntime.server()
    await failing.openActivation({ target: first, seed: { kind: 'fresh' } })
    failingRuntime.disposeFailure = new Error('activation dispose failed')
    await expect(failing.disposeActivation({ target: first })).rejects.toThrow('activation dispose failed')
    await expect(failing.shutdown()).rejects.toThrow('activation dispose failed')
  })
})
