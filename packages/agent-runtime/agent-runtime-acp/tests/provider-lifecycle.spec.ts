import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientSideConnection } from '@agentclientprotocol/sdk'
import { Context } from '@clocky/cordis'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import ActivationSupervisors, { ActivationSupervisorError } from '@clocky/clocky-activation-supervisor'
import type { AgentRuntimeActivationRequest } from '@clocky/clocky-agent-runtime'
import SessionStore, { SessionId } from '@clocky/clocky-session'
import type { SessionEvent } from '@clocky/clocky-session'
import { createUserMessage } from '@clocky/clocky-llm'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import LocalSubprocessRuntime from '@clocky/clocky-subprocess-local'
import type { ProcessInspector } from '@clocky/clocky-subprocess-local'
import {
  activationBindingSnapshotSchema,
  channelIdSchema,
  channelSnapshotSchema,
  envelopeIdSchema,
  participantSnapshotSchema,
  participantInterruptSnapshotSchema,
  teamEnvelopeSchema,
  teamEventSchema,
  teamIdSchema,
} from '@clocky/clocky-team'
import type { ActivationBindingSnapshot, ChannelDeliveryClaim, TeamChannelViewEventData, TeamEnvelope } from '@clocky/clocky-team'
import type { TeamLink, TeamLinkConnectRequest, TeamLinkEnrollment } from '@clocky/clocky-team-link'
import * as AcpRuntime from '../src/index.ts'

const mockServer = fileURLToPath(new URL('../../../compat/subagent-acp/tests/mock-acp-server.ts', import.meta.url))
const teamId = teamIdSchema.parse('acp-runtime-lifecycle-team')
const participant = participantSnapshotSchema.parse({
  id: 'acp-runtime-lifecycle-participant',
  teamId,
  kind: 'remote-agent',
  displayName: 'ACP lifecycle worker',
  role: 'worker',
  capabilities: [],
  phase: 'active',
})

const contexts = new Set<Context>()
const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  const failures: unknown[] = []
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
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'ACP AgentRuntime lifecycle cleanup failed')
})

/** Create a disposable root for the ACP proxy Session persistence backend. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'agent-runtime-acp-lifecycle-'))
  roots.push(root)
  return root
}

/** Mount the real AgentRuntime, Session persistence, and local subprocess seams. */
async function setup(
  env: Record<string, string>,
  disposeEofGraceMs: number,
  teamLinks?: Record<string, unknown>,
  config: Partial<AcpRuntime.Config> = {},
  onLinksProvided?: (remove: () => void) => void,
): Promise<Context> {
  const ctx = new Context()
  contexts.add(ctx)
  if (teamLinks !== undefined) {
    const remove = ctx.provide('teamLinks', teamLinks as never)
    onLinksProvided?.(remove)
  }
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root: await freshRoot(), compression: 'none' })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(AgentRuntime)
  await ctx.plugin(AcpRuntime, {
    providerName: 'acp',
    command: process.execPath,
    args: [mockServer],
    env,
    disposeEofGraceMs,
    ...config,
  })
  return ctx
}

/** Build the exact Team-resolved activation request consumed by the provider. */
function request(
  sessionId = SessionId('acp-runtime-lifecycle-session'),
  signal: AbortSignal = new AbortController().signal,
): AgentRuntimeActivationRequest {
  return {
    provider: 'acp',
    teamId,
    participant,
    sessionId,
    seed: { kind: 'fresh' },
    agent: { cwd: process.cwd(), options: {} },
    signal,
  }
}

/** Wait for a child fixture's explicit lifecycle marker instead of sleeping blindly. */
async function waitForFile(path: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`ACP child did not publish lifecycle marker '${path}'`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/** Real ACP subprocess with a controlled creation-identity observation on every host. */
async function supervisedSetup(admit?: (binding: ActivationBindingSnapshot) => Promise<void>,
  processTree?: ProcessInspector['processTree']) {
  const ctx = await setup({}, 200)
  if (admit !== undefined) {
    await ctx.plugin(ActivationSupervisors)
    ctx.activationSupervisors.registerProvider({
      name: 'acp-supervisor', version: 1,
      validate() {},
      admitOwned: admit,
      async health() { throw new Error('Admission must not call health') },
      async fence() { throw new Error('Admission must not fence an epoch') },
    })
  }
  const inspector: ProcessInspector = {
    hasExactIdentity: true,
    foregroundPgid: () => undefined,
    isStdinWaiting: () => false,
    processTree: processTree ?? (pid => [{ pid, started: 'controlled-creation-identity' }]),
    processSession: () => [],
    isAlive: () => true,
    signalGroup() { throw new Error('Admission must not signal a process group') },
    signalProcess() { throw new Error('Admission must not signal a process') },
  }
  const provider = new AcpRuntime.AcpProvider(ctx, 'supervised-acp', {
    providerName: 'supervised-acp', command: process.execPath, args: [mockServer], env: {},
    disposeEofGraceMs: 200, teamLinkProviderPrefix: 'acp-link', teamLinkReconnectDelayMs: 100,
    recovery: { profile: 'local-acp-v1', hostId: 'host-local', fenceGraceMs: 200 },
    recoverySupervisor: { name: 'acp-supervisor', version: 1, endpointId: 'acp-endpoint' },
  }, inspector)
  ctx.agentRuntimes.registerProvider(provider)
  const spawn = vi.spyOn(ctx.subprocess, 'spawn')
  const activationRequest = { ...request(), provider: 'supervised-acp' }
  const child = () => {
    const result = spawn.mock.results[0]
    if (result?.type !== 'return') throw new Error('ACP subprocess was not spawned')
    return result.value
  }
  return { ctx, activationRequest, child, spawn }
}

/** Real ACP child with a controllable external Team Link; ownership remains public. */
async function linkedFixture(env: Record<string, string> = {},
  teamReader?: (request: { teamId: typeof teamId }) => Promise<{ activations: ActivationBindingSnapshot[] }>,
  reconnectDelayMs = 1, failInitialRegistration: false | 'error' | 'text' = false) {
  const notifications: Array<NonNullable<Parameters<TeamLink['onNotify']>[0]>> = []
  const interrupts: Array<NonNullable<Parameters<TeamLink['onInterrupt']>[0]>> = []
  const terminations: Array<TeamLinkConnectRequest['onTerminate']> = []
  const claim = vi.fn(async (): Promise<ChannelDeliveryClaim | undefined> => undefined)
  const claimTaskAttemptStart = vi.fn<TeamLink['claimTaskAttemptStart']>()
  const acknowledge = vi.fn(async () => ({} as never))
  const acknowledgeInterrupt = vi.fn(async () => ({} as never))
  const revoke = vi.fn(async () => {})
  const close = vi.fn(async () => {})
  const unregister = vi.fn()
  const registerProvider = vi.fn(() => unregister)
  if (failInitialRegistration) registerProvider.mockImplementationOnce(() => {
    throw failInitialRegistration === 'text' ? 'Initial Link registration unavailable' : new Error('Initial Link registration unavailable')
  })
  const connections: Array<ReturnType<typeof Promise.withResolvers<undefined>>> = []
  const teamLinks = {
    getEnrollmentProvider: () => ({ name: 'websocket' }),
    reserveEnrollment: vi.fn(async () => ({ provider: 'websocket', endpoint: 'ws://127.0.0.1:1/team-link',
      capability: 'opaque-capability', revoke })),
    registerProvider,
    connect: vi.fn(async ({ provider, binding, onTerminate }: TeamLinkConnectRequest): Promise<TeamLink> => {
      const terminal = Promise.withResolvers<undefined>()
      connections.push(terminal)
      terminations.push(onTerminate)
      return {
        provider, binding, done: terminal.promise,
        onNotify(listener) { notifications.push(listener); return () => {} },
        onInterrupt(listener) { interrupts.push(listener); return () => {} },
        onInvitation() { return () => {} }, onTaskCancellation() { return () => {} },
        getChannel: async () => { throw new Error('Unused fixture channel query') },
        acknowledgeChannelInvitation: async () => { throw new Error('Unused fixture invitation') },
        acknowledgeTaskCancellation: async () => { throw new Error('Unused fixture cancellation') },
        post: async () => { throw new Error('Unused fixture post') },
        postFinalResult: async () => { throw new Error('Unused fixture final result') },
        settleTaskAttempt: async () => { throw new Error('Unused fixture settlement') },
        integrateTask: async () => { throw new Error('Unused fixture integration') },
        heartbeatTaskAttempt: async () => { throw new Error('Unused fixture heartbeat') },
        resolveTaskReview: async () => { throw new Error('Unused fixture review') },
        claim, claimTaskAttemptStart, acknowledge, acknowledgeInterrupt, close,
      }
    }),
  }
  const ctx = await setup(env, 200, teamLinks, { teamLinkEnrollmentProvider: 'websocket', teamLinkReconnectDelayMs: reconnectDelayMs })
  if (teamReader !== undefined) ctx.provide('teams', { getTeam: teamReader } as never)
  const spawn = vi.spyOn(ctx.subprocess, 'spawn')
  const handle = await ctx.agentRuntimes.activate(request(SessionId(`acp-linked-${crypto.randomUUID()}`)))
  const binding = activationBindingSnapshotSchema.parse({ activation: handle.activation, sessionId: handle.sessionId, provider: 'acp' })
  const announce = () => {
    ctx.emit('team/changed', teamEventSchema.parse({ type: 'activation/changed', binding, cursor: 1, createdAt: 1 }))
  }
  announce()
  await vi.waitFor(() => { expect(notifications).toHaveLength(1) })
  const deliver = notifications[0]
  if (deliver === undefined) throw new Error('ACP notification owner was not installed')
  return { ctx, handle, binding, teamLinks, claim, claimTaskAttemptStart, acknowledge, acknowledgeInterrupt,
    revoke, close, unregister, connections, interrupts, terminations, notifications, announce, deliver, spawn }
}

describe('ACP AgentRuntime provider lifecycle', () => {
  it.each(['missing', 'empty creation time'] as const)('reaps an ACP child whose exact process identity is %s', async (kind) => {
    const { ctx, activationRequest, child } = await supervisedSetup(undefined,
      kind === 'missing' ? () => [] : pid => [{ pid, started: '' }])
    await expect(ctx.agentRuntimes.activate(activationRequest)).rejects.toThrow('no observable process identity')
    await expect(child().waitForExit(new AbortController().signal)).resolves.toBe(true)
    expect(ctx.sessions.get(activationRequest.sessionId)).toBeUndefined()
  })

  it('rejects unsupported participants and missing workspaces before spawning a child', async () => {
    const ctx = await setup({}, 200)
    const provider = ctx.agentRuntimes.getProvider('acp')
    if (provider === undefined) throw new Error('ACP provider was not registered')
    const spawn = vi.spyOn(ctx.subprocess, 'spawn')
    await expect(provider.activate({ ...request(), participant: { ...participant, kind: 'human' } }))
      .rejects.toThrow('cannot activate participant')
    await expect(provider.activate({ ...request(SessionId('acp-missing-workspace')),
      participant: { ...participant, id: 'acp-other-participant' as never }, agent: { cwd: '', options: {} },
    })).rejects.toThrow('explicit workspace cwd')
    const caller = new AbortController(), reason = new Error('ACP caller retired before activation')
    caller.abort(reason)
    await expect(provider.activate({ ...request(SessionId('acp-retired-before-start'), caller.signal),
      participant: { ...participant, id: 'acp-retired-participant' as never },
    })).rejects.toBe(reason)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reuses the same Link when a delayed canonical Team lookup finds its current activation binding', async () => {
    const lookup = Promise.withResolvers<{ activations: ActivationBindingSnapshot[] }>()
    const reader = vi.fn(() => lookup.promise)
    const f = await linkedFixture({}, reader)
    lookup.resolve({ activations: [f.binding] })
    await vi.waitFor(() => { expect(reader).toHaveBeenCalledOnce() })
    await Promise.resolve()
    expect(f.teamLinks.connect).toHaveBeenCalledOnce()
    await f.handle.dispose()
  })

  it.each(['error', 'text'] as const)('keeps event-driven Link enrollment when Team lookup fails with a %s', async (kind) => {
    const reader = vi.fn(async () => { throw kind === 'error' ? new Error('Private Team lookup failure') : 'Private Team lookup failure' })
    const f = await linkedFixture({}, reader)
    expect(reader).toHaveBeenCalledOnce()
    expect(f.teamLinks.connect).toHaveBeenCalledOnce()
    await f.handle.dispose()
  })

  it('publishes a supervised ACP epoch only after its exact process ownership is admitted', async () => {
    const admitted = Promise.withResolvers<ActivationBindingSnapshot>()
    const persisted = Promise.withResolvers<undefined>()
    const admit = vi.fn(async (binding: ActivationBindingSnapshot) => {
      admitted.resolve(binding)
      await persisted.promise
    })
    const { ctx, activationRequest, child } = await supervisedSetup(admit)
    let published = false
    const pending = ctx.agentRuntimes.activate(activationRequest).then((handle) => { published = true; return handle })
    const binding = await admitted.promise
    expect(published).toBe(false)
    expect(ctx.sessions.get(activationRequest.sessionId)).toBeUndefined()
    expect(binding).toMatchObject({ provider: 'supervised-acp', sessionId: activationRequest.sessionId,
      activation: { teamId, participantId: participant.id, status: 'idle' },
      recovery: { kind: 'acp-local-cold-replace', process: { pid: child().pid, started: 'controlled-creation-identity' },
        supervisor: { generation: binding.activation.id, hostId: 'host-local', endpointId: 'acp-endpoint' } } })
    persisted.resolve(undefined)
    const handle = await pending
    expect(handle.recovery).toEqual(binding.recovery)
    expect(handle.activation).toEqual(binding.activation)
    expect(admit).toHaveBeenCalledOnce()
    await handle.dispose()
    await expect(child().waitForExit(new AbortController().signal)).resolves.toBe(true)
  })

  it.each(['missing', 'rejected'] as const)('reaps an unpublished ACP child when its supervisor owner is %s', async (mode) => {
    const { ctx, activationRequest, child } = await supervisedSetup(mode === 'missing' ? undefined : async () => {
      throw new ActivationSupervisorError('Ownership rejected', 'SUPERVISOR_GENERATION_MISMATCH')
    })
    await expect(ctx.agentRuntimes.activate(activationRequest)).rejects.toMatchObject({
      code: mode === 'missing' ? 'SUPERVISOR_UNAVAILABLE' : 'SUPERVISOR_GENERATION_MISMATCH',
    })
    await expect(child().waitForExit(new AbortController().signal)).resolves.toBe(true)
    expect(ctx.sessions.get(activationRequest.sessionId)).toBeUndefined()
  })

  it('waits for accepted supervisor ownership before reaping an ACP activation cancelled during admission', async () => {
    const admitted = Promise.withResolvers<undefined>()
    const persisted = Promise.withResolvers<undefined>()
    const { ctx, activationRequest, child } = await supervisedSetup(async () => {
      admitted.resolve(undefined)
      await persisted.promise
    })
    const controller = new AbortController()
    const pending = ctx.agentRuntimes.activate({ ...activationRequest, signal: controller.signal })
    const reason = new Error('Cancelled during ownership persistence')
    const rejected = expect(pending).rejects.toBe(reason)
    await admitted.promise
    controller.abort(reason)
    persisted.resolve(undefined)
    await rejected
    await expect(child().waitForExit(new AbortController().signal)).resolves.toBe(true)
    expect(ctx.sessions.get(activationRequest.sessionId)).toBeUndefined()
  })

  it('reports unconfirmed termination when supervisor rejection cannot reap its unpublished ACP child', async () => {
    const failure = new ActivationSupervisorError('Ownership rejected', 'SUPERVISOR_INVALID')
    const { ctx, activationRequest, child, spawn } = await supervisedSetup(async () => {
      vi.spyOn(child(), 'waitForExit').mockResolvedValue(false)
      throw failure
    })
    await expect(ctx.agentRuntimes.activate(activationRequest)).rejects.toMatchObject({
      code: 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED',
      cause: { errors: [failure, expect.any(Error)] },
    })
    await expect(ctx.agentRuntimes.activate(activationRequest)).rejects.toMatchObject({ code: 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED' })
    expect(spawn).toHaveBeenCalledOnce()
  })

  it('owns a real ACP child, coalesces concurrent activation, and gives EOF flush a bounded window', async () => {
    const root = await freshRoot()
    const flushed = join(root, 'flushed')
    const ctx = await setup({ MOCK_FLUSH_ON_EOF: flushed, MOCK_FLUSH_DELAY_MS: '10' }, 200)
    const first = await ctx.agentRuntimes.activate(request())
    const second = await ctx.agentRuntimes.activate(request())
    expect(second).toBe(first)
    await expect(ctx.agentRuntimes.activate(request(SessionId('another-bound-session')))).rejects.toThrow('another Session')
    expect(first.localAgent).toBeUndefined()
    expect(first.activation).toMatchObject({ teamId, participantId: participant.id, status: 'idle' })

    const statuses: string[] = []
    first.onStatus(() => { throw new Error('Observer failure is contained') })
    const removed = vi.fn()
    first.onStatus(removed)()
    first.onStatus((next) => { statuses.push(next.status) })
    first.interrupt({ kind: 'user' })
    await Promise.all([first.dispose(), first.dispose()])

    expect(statuses).toEqual(['stopping', 'offline'])
    expect(removed).not.toHaveBeenCalled()
    expect(existsSync(flushed)).toBe(true)
    await expect(first.health()).resolves.toMatchObject({ status: 'offline' })
  })

  it('contains a failed cooperative ACP cancel without losing the live activation', async () => {
    const ctx = await setup({}, 200)
    const handle = await ctx.agentRuntimes.activate(request(SessionId('acp-runtime-interrupt-failure')))
    const cancel = vi.spyOn(ClientSideConnection.prototype, 'cancel').mockRejectedValueOnce(new Error('ACP cancel unavailable'))
    handle.interrupt({ kind: 'user' })
    await vi.waitFor(() => { expect(cancel).toHaveBeenCalledOnce() })
    await Promise.resolve()
    await expect(handle.health()).resolves.toMatchObject({ status: 'idle' })
    cancel.mockRestore()
    await handle.dispose()
    await expect(handle.health()).resolves.toMatchObject({ status: 'offline' })
  })

  it('still proves child termination when ACP cancel fails during disposal', async () => {
    const ctx = await setup({}, 200)
    const handle = await ctx.agentRuntimes.activate(request(SessionId('acp-runtime-dispose-cancel-failure')))
    const cancel = vi.spyOn(ClientSideConnection.prototype, 'cancel').mockRejectedValueOnce(new Error('ACP cancel unavailable'))
    await expect(handle.dispose()).resolves.toBeUndefined()
    expect(cancel).toHaveBeenCalledOnce()
    await expect(handle.health()).resolves.toMatchObject({ status: 'offline' })
  })

  it('fences the exact ACP process before resuming its proxy Session under a new activation', async () => {
    const ctx = await setup({}, 200, undefined, {
      recoveryProfile: 'local-acp-v1',
      recoveryHostId: 'host-local',
    })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('acp-runtime-recovery-session')))

    const recovery = handle.recovery
    expect(recovery).toBeDefined()
    if (recovery === undefined || recovery.kind !== 'acp-local-cold-replace') throw new Error('ACP recovery descriptor was not published')
    expect(recovery.profile).toBe('local-acp-v1')
    expect(recovery.cwd).toBe(process.cwd())
    expect(recovery.process.hostId).toBe('host-local')
    expect(recovery.process.pid).toBeGreaterThan(0)
    expect(recovery.process.started.length).toBeGreaterThan(0)
    expect(recovery.supervisor).toBeUndefined()
    const fencer = ctx.agentRuntimes.getFencer('acp')
    expect(fencer).toBeDefined()
    await fencer!.fence({ activation: handle.activation, sessionId: handle.sessionId, provider: 'acp', recovery })
    await vi.waitFor(async () => { expect(await handle.health()).toMatchObject({ status: 'offline' }) })
    const next = await ctx.agentRuntimes.activate({ ...request(handle.sessionId), seed: { kind: 'resume' } })
    expect(next.sessionId).toBe(handle.sessionId)
    expect(next.activation.id).not.toBe(handle.activation.id)
    expect(next.recovery?.process.started).not.toBe(recovery.process.started)
    await next.dispose()
    await handle.dispose()
  })

  it('escalates a non-cooperative ACP child through the real process-tree termination seam', async () => {
    const root = await freshRoot()
    const armed = join(root, 'armed')
    const ctx = await setup({ MOCK_TRAP_SIGTERM: '1', MOCK_READY_FILE: armed }, 1_000)
    const handle = await ctx.agentRuntimes.activate(request(SessionId('acp-runtime-trap-session')))
    await waitForFile(armed)

    await handle.dispose().catch(() => undefined)
    await expect(handle.health()).resolves.toMatchObject({ status: 'offline' })
  })

  it('retains an unconfirmed-termination error when child exit observation fails after forced cleanup', async () => {
    const ctx = await setup({}, 20)
    const spawned = vi.spyOn(ctx.subprocess, 'spawn')
    const handle = await ctx.agentRuntimes.activate(request(SessionId('acp-runtime-unconfirmed-dispose')))
    const result = spawned.mock.results[0]
    if (result?.type !== 'return') throw new Error('ACP child was not spawned')
    const child = result.value
    vi.spyOn(child, 'waitForExit').mockResolvedValue(false)
    await expect(handle.dispose()).rejects.toMatchObject({ code: 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED' })
    await expect(handle.health()).rejects.toMatchObject({ code: 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED' })
    await child.done
  })

  it.each(['error', 'text'] as const)('aborts a stalled ACP session handshake with a %s reason and reaps the child', async (kind) => {
    const root = await freshRoot()
    const ready = join(root, 'new-session-ready')
    const go = join(root, 'new-session-go')
    const controller = new AbortController()
    const ctx = await setup({ MOCK_NEWSESSION_READY: ready, MOCK_NEWSESSION_GO: go }, 200)
    const activation = ctx.agentRuntimes.activate(request(SessionId('acp-runtime-abort-session'), controller.signal))
    await waitForFile(ready)

    const reason = kind === 'error' ? new Error('cancel ACP startup') : 'cancel ACP startup'
    controller.abort(reason)
    if (reason instanceof Error) await expect(activation).rejects.toBe(reason)
    else await expect(activation).rejects.toMatchObject({ message: 'ACP AgentRuntime activation was aborted before publication', cause: reason })
  })

  it.each([false, true])('waits for in-flight enrollment disposal when revoke fails=%s', async (revokeFails) => {
    const reserved = Promise.withResolvers<{
      provider: string
      endpoint: string
      capability: string
      revoke: () => Promise<void>
    }>()
    const revoked = Promise.withResolvers<undefined>()
    const revoke = vi.fn(async () => {
      revoked.resolve(undefined)
      if (revokeFails) throw new Error('Credential revoke failed after disposal')
    })
    const teamLinks = {
      getEnrollmentProvider: vi.fn(() => ({ name: 'websocket' })),
      reserveEnrollment: vi.fn(() => reserved.promise),
      registerProvider: vi.fn(() => () => undefined),
      connect: vi.fn(async () => ({})),
    }
    const ctx = await setup({}, 200, teamLinks, { teamLinkEnrollmentProvider: 'websocket' })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('acp-runtime-enrollment-race-session')))
    const binding = activationBindingSnapshotSchema.parse({
      activation: handle.activation,
      sessionId: handle.sessionId,
      provider: 'acp',
    })
    ctx.emit('team/changed', teamEventSchema.parse({
      type: 'activation/changed', binding, cursor: 1, createdAt: 1,
    }))
    await vi.waitFor(() => { expect(teamLinks.reserveEnrollment).toHaveBeenCalledOnce() })
    ctx.emit('team/changed', teamEventSchema.parse({ type: 'activation/changed', binding, cursor: 2, createdAt: 2 }))
    await Promise.resolve()
    expect(teamLinks.reserveEnrollment).toHaveBeenCalledOnce()

    let disposalSettled = false
    const disposing = handle.dispose().then(() => { disposalSettled = true })
    await Promise.resolve()
    expect(revoke).not.toHaveBeenCalled()

    reserved.resolve({
      provider: 'websocket',
      endpoint: 'ws://127.0.0.1:1/team-link',
      capability: 'pending-capability',
      revoke,
    })
    await expect(revoked.promise).resolves.toBeUndefined()
    expect(disposalSettled).toBe(false)
    await expect(disposing).resolves.toBeUndefined()
    expect(revoke).toHaveBeenCalledOnce()
  })

  it('does not reconnect when an in-flight enrollment issuer fails after disposal starts', async () => {
    const reserved = Promise.withResolvers<TeamLinkEnrollment>()
    const teamLinks = {
      getEnrollmentProvider: () => ({ name: 'websocket' }),
      reserveEnrollment: vi.fn(() => reserved.promise),
      registerProvider: vi.fn(), connect: vi.fn(),
    }
    const ctx = await setup({}, 200, teamLinks, { teamLinkEnrollmentProvider: 'websocket' })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('acp-enrollment-retirement-race')))
    const binding = activationBindingSnapshotSchema.parse({ activation: handle.activation, sessionId: handle.sessionId, provider: 'acp' })
    ctx.emit('team/changed', teamEventSchema.parse({ type: 'activation/changed', binding, cursor: 1, createdAt: 1 }))
    await vi.waitFor(() => { expect(teamLinks.reserveEnrollment).toHaveBeenCalledOnce() })
    const disposing = handle.dispose()
    reserved.reject(new Error('Enrollment issuer retired during disposal'))
    await expect(disposing).resolves.toBeUndefined()
    expect(teamLinks.connect).not.toHaveBeenCalled()
    expect(teamLinks.registerProvider).not.toHaveBeenCalled()
    await expect(handle.health()).resolves.toMatchObject({ status: 'offline' })
  })

  it.each([false, true])('closes a Link returned after disposal began even when cleanup fails=%s', async (cleanupFails) => {
    const connecting = Promise.withResolvers<TeamLink>()
    const revoke = vi.fn(async () => {}), unregister = vi.fn(), close = vi.fn(async () => {})
    if (cleanupFails) {
      revoke.mockRejectedValueOnce(new Error('Credential revoke failed'))
      close.mockRejectedValueOnce(new Error('Late Link close failed'))
    }
    const teamLinks = {
      getEnrollmentProvider: () => ({ name: 'websocket' }),
      reserveEnrollment: vi.fn(async () => ({ provider: 'websocket', endpoint: 'ws://127.0.0.1:1/team-link',
        capability: 'pending-connect-capability', revoke })),
      registerProvider: vi.fn(() => unregister),
      connect: vi.fn(() => connecting.promise),
    }
    const ctx = await setup({}, 200, teamLinks, { teamLinkEnrollmentProvider: 'websocket' })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('acp-runtime-connect-race-session')))
    const binding = activationBindingSnapshotSchema.parse({ activation: handle.activation, sessionId: handle.sessionId, provider: 'acp' })
    ctx.emit('team/changed', teamEventSchema.parse({ type: 'activation/changed', binding, cursor: 1, createdAt: 1 }))
    await vi.waitFor(() => { expect(teamLinks.connect).toHaveBeenCalledOnce() })
    const disposing = handle.dispose()
    connecting.resolve({ close } as unknown as TeamLink)
    await disposing
    expect(close).toHaveBeenCalledOnce()
    expect(unregister).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledOnce()
    await expect(handle.health()).resolves.toMatchObject({ status: 'offline' })
  })

  it('finishes ACP disposal when external Link revoke and close both fail', async () => {
    const f = await linkedFixture()
    f.revoke.mockRejectedValueOnce(new Error('Credential issuer unavailable'))
    f.close.mockRejectedValueOnce(new Error('Link transport unavailable'))
    await expect(f.handle.dispose()).resolves.toBeUndefined()
    expect(f.unregister).toHaveBeenCalledOnce()
    await expect(f.handle.health()).resolves.toMatchObject({ status: 'offline' })
  })


  it('recovers the durable proxy Session and forks its model-visible events under a new Session identity', async () => {
    const ctx = await setup({}, 200)
    const firstRequest = request(SessionId('acp-recovery-seed'))
    const first = await ctx.agentRuntimes.activate({ ...firstRequest, agent: { ...firstRequest.agent, preset: 'retained-preset' } })
    const proxy = ctx.sessions.get(first.sessionId)
    if (proxy === undefined) throw new Error('Proxy Session was not entered')
    proxy.append('turn/start', { turn: 2 })
    await ctx.sessions.flush(proxy)
    await first.dispose()
    const restored = await ctx.agentRuntimes.activate({ ...firstRequest, seed: { kind: 'resume' } })
    expect(ctx.sessions.get(restored.sessionId)?.events.find(event => event.type === 'turn/start'))
      .toMatchObject({ type: 'turn/start', data: { turn: 2 } })
    await restored.dispose()
    const source = await ctx.sessionPersistence.load(first.sessionId)
    const forkRequest = request(SessionId('acp-fork-seed'))
    const fork = await ctx.agentRuntimes.activate({ ...forkRequest,
      seed: { kind: 'fork', sourceSessionId: first.sessionId, events: source.events } })
    const inspection = await ctx.sessionPersistence.load(fork.sessionId)
    expect(inspection.meta).toMatchObject({ parentSession: first.sessionId, seedLength: source.events.length })
    expect(inspection.events.slice(0, source.events.length)).toEqual(source.events)
    await fork.dispose()
    const foreign = participantSnapshotSchema.parse({ ...participant, id: 'foreign-worker' })
    await expect(ctx.agentRuntimes.activate({ ...firstRequest, participant: foreign, seed: { kind: 'resume' } }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(ctx.sessions.get(first.sessionId)).toBeUndefined()
  })

  it.each(['missing registry', 'missing issuer'] as const)('reaps an unpublished child when Link enrollment has a %s', async (mode) => {
    const ctx = await setup({}, 200, mode === 'missing registry' ? undefined : {
      getEnrollmentProvider: () => undefined,
    }, { teamLinkEnrollmentProvider: 'unregistered' })
    const spawn = vi.spyOn(ctx.subprocess, 'spawn')
    const input = request(SessionId(`acp-missing-issuer-${mode}`))
    await expect(ctx.agentRuntimes.activate(input)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(ctx.sessions.get(input.sessionId)).toBeUndefined()
    const child = spawn.mock.results[0]
    if (child?.type !== 'return') throw new Error('No child was spawned')
    await expect(child.value.waitForExit(new AbortController().signal)).resolves.toBe(true)
  })

  it('retains the activation while a separately mounted Team Link registry retires before enrollment', async () => {
    const teamLinks = {
      getEnrollmentProvider: vi.fn(() => ({ name: 'websocket' })),
      reserveEnrollment: vi.fn(), registerProvider: vi.fn(), connect: vi.fn(),
    }
    let removeLinks: (() => void) | undefined
    const ctx = await setup({}, 200, teamLinks, { teamLinkEnrollmentProvider: 'websocket' }, (remove) => { removeLinks = remove })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('acp-retired-link-registry')))
    if (removeLinks === undefined) throw new Error('Team Link service has no disposer')
    removeLinks()
    const binding = activationBindingSnapshotSchema.parse({ activation: handle.activation, sessionId: handle.sessionId, provider: 'acp' })
    const warned = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ctx.emit('team/changed', teamEventSchema.parse({ type: 'activation/changed', binding, cursor: 1, createdAt: 1 }))
    await vi.waitFor(() => { expect(warned).toHaveBeenCalled() })
    expect(teamLinks.reserveEnrollment).not.toHaveBeenCalled()
    await expect(handle.health()).resolves.toMatchObject({ status: 'idle' })
    await handle.dispose()
  })

  it.each(['missing stdio', 'missing Session identity'] as const)('rolls back ACP startup with %s', async (mode) => {
    const ctx = await setup(mode === 'missing Session identity' ? { MOCK_MISSING_SESSION_ID: '1' } : {}, 200)
    const original = ctx.subprocess.spawn.bind(ctx.subprocess)
    const children: import('@clocky/clocky-subprocess').SubprocessHandle[] = []
    vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((input) => {
      const child = original(input)
      children.push(child)
      return mode === 'missing stdio' ? new Proxy(child, {
        get(target, key, receiver) {
          const value: unknown = Reflect.get(target, key, receiver)
          if (key === 'stdout') return undefined
          if (typeof value !== 'function') return value
          return function(this: unknown, ...args: unknown[]) {
            return (value as (this: unknown, ...callArgs: unknown[]) => unknown).apply(target, args)
          }
        },
      }) : child
    })
    const input = request(SessionId(`acp-startup-fault-${mode}`))
    await expect(ctx.agentRuntimes.activate(input)).rejects.toThrow()
    expect(ctx.sessions.get(input.sessionId)).toBeUndefined()
    const child = children[0]
    if (child === undefined) throw new Error('No child was spawned')
    await expect(child.waitForExit(new AbortController().signal)).resolves.toBe(true)
  })

  it('reaps an unpublished ACP child and releases its Session when header persistence fails', async () => {
    const ctx = await setup({}, 200)
    const spawn = vi.spyOn(ctx.subprocess, 'spawn')
    const failure = new Error('Header storage unavailable')
    vi.spyOn(ctx.sessionPersistence, 'materializeHeader').mockRejectedValueOnce(failure)
    const input = request(SessionId('acp-header-rollback'))
    await expect(ctx.agentRuntimes.activate(input)).rejects.toBe(failure)
    expect(ctx.sessions.get(input.sessionId)).toBeUndefined()
    const spawned = spawn.mock.results[0]
    if (spawned?.type !== 'return') throw new Error('No child was spawned')
    await expect(spawned.value.waitForExit(new AbortController().signal)).resolves.toBe(true)
    const retry = await ctx.agentRuntimes.activate(input)
    await retry.dispose()
  })

  it('denies ACP permission requests through the real child protocol without completing or acknowledging its Envelope', async () => {
    const f = await linkedFixture({ MOCK_PERMISSION: '1' })
    const envelope = teamEnvelopeSchema.parse({ id: 'permission-envelope', teamId, channelId: 'permission-channel',
      sequence: 1, senderId: participant.id, audience: [participant.id], kind: 'message', payload: { text: 'request permission' },
      delivery: 'turn', priority: 'normal', createdAt: 1 })
    f.claim.mockResolvedValue({ binding: f.binding, envelopeId: envelope.id, delivery: 'turn',
      channel: channelSnapshotSchema.parse({ manifest: { id: envelope.channelId, teamId,
        adapter: { type: 'direct', version: 3 }, participants: [], limits: {} }, phase: 'active', cursor: 1 }) })
    await f.deliver(envelope)
    const events = (await f.ctx.sessionPersistence.load(f.handle.sessionId)).events
    expect(events.map(event => event.type)).toEqual(['turn/start', 'user/message', 'turn/end'])
    expect(events.at(-1)?.data).toMatchObject({ reason: { kind: 'aborted' } })
    expect(f.acknowledge).not.toHaveBeenCalled()
    await f.handle.dispose()
  })

  it.each(['error', 'text'] as const)('reconnects a failed Link with a %s failure and retires credentials on termination', async (kind) => {
    const fixture = await linkedFixture()
    const { handle, connections, teamLinks, revoke, unregister, announce } = fixture
    if (kind === 'text') revoke.mockRejectedValueOnce(new Error('Prior credential revocation failed'))
    announce()
    await Promise.resolve()
    expect(teamLinks.connect).toHaveBeenCalledOnce()
    const failed = connections[0]
    if (failed === undefined) throw new Error('Initial Link missing')
    failed.reject(kind === 'error' ? new Error('External transport closed') : 'External transport closed')
    await vi.waitFor(() => { expect(teamLinks.connect).toHaveBeenCalledTimes(2) })
    expect(revoke).toHaveBeenCalledOnce()
    expect(unregister).toHaveBeenCalledOnce()
    const terminate = fixture.terminations[1]
    if (terminate === undefined) throw new Error('Replacement termination hook missing')
    await terminate({ code: 'RETIRED', message: 'Hub requested retirement' })
    connections[1]?.reject(new Error('Retired transport closed'))
    await Promise.resolve()
    expect(teamLinks.connect).toHaveBeenCalledTimes(2)
    await handle.dispose()
    handle.interrupt({ kind: 'user' })
    const listener = vi.fn()
    handle.onStatus(listener)()
    expect(listener).not.toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledTimes(2)
  })

  it('retries a failed replacement Link dial after revoking its unpublishable credential', async () => {
    const f = await linkedFixture()
    f.teamLinks.connect.mockRejectedValueOnce(new Error('Temporary Link dial failure'))
    const first = f.connections[0]
    if (first === undefined) throw new Error('Initial Link was not connected')
    first.reject(new Error('Transport disconnected'))
    await vi.waitFor(() => { expect(f.teamLinks.connect).toHaveBeenCalledTimes(3) }, { timeout: 5000 })
    expect(f.unregister).toHaveBeenCalledTimes(2)
    expect(f.revoke).toHaveBeenCalledTimes(2)
    await f.handle.dispose()
    expect(f.revoke).toHaveBeenCalledTimes(3)
  })

  it('retries a failed enrollment issuer without leaking the prior Link credential', async () => {
    const f = await linkedFixture()
    f.teamLinks.reserveEnrollment.mockRejectedValueOnce('Issuer temporarily unavailable')
    const first = f.connections[0]
    if (first === undefined) throw new Error('Initial Link was not connected')
    first.reject(new Error('Transport disconnected'))
    await vi.waitFor(() => { expect(f.teamLinks.reserveEnrollment).toHaveBeenCalledTimes(3) }, { timeout: 5000 })
    expect(f.teamLinks.connect).toHaveBeenCalledTimes(2)
    expect(f.unregister).toHaveBeenCalledOnce()
    expect(f.revoke).toHaveBeenCalledOnce()
    await f.handle.dispose()
    expect(f.revoke).toHaveBeenCalledTimes(2)
  })

  it('retries after Link provider registration fails and revokes its unused capability', async () => {
    const f = await linkedFixture()
    f.teamLinks.registerProvider.mockImplementationOnce(() => { throw new Error('Link registration unavailable') })
    const first = f.connections[0]
    if (first === undefined) throw new Error('Initial Link was not connected')
    first.reject(new Error('Transport disconnected'))
    await vi.waitFor(() => { expect(f.teamLinks.registerProvider).toHaveBeenCalledTimes(3) }, { timeout: 5000 })
    expect(f.teamLinks.connect).toHaveBeenCalledTimes(2)
    expect(f.revoke).toHaveBeenCalledTimes(2)
    expect(f.unregister).toHaveBeenCalledOnce()
    await f.handle.dispose()
    expect(f.revoke).toHaveBeenCalledTimes(3)
  })

  it.each(['error', 'text'] as const)('recovers a failed first Link registration with a %s error', async (kind) => {
    const f = await linkedFixture({}, undefined, 1, kind)
    expect(f.teamLinks.registerProvider).toHaveBeenCalledTimes(2)
    expect(f.teamLinks.connect).toHaveBeenCalledOnce()
    expect(f.revoke).toHaveBeenCalledOnce()
    await f.handle.dispose()
    expect(f.revoke).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])('closes a connected Link when notification listener cleanup fails=%s', async (cleanupFails) => {
    const f = await linkedFixture()
    if (cleanupFails) {
      f.close.mockRejectedValueOnce(new Error('Failed Link close unavailable'))
      f.revoke.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Failed capability revoke unavailable'))
    }
    const connect = f.teamLinks.connect.getMockImplementation()
    if (connect === undefined) throw new Error('Linked fixture has no connection factory')
    f.teamLinks.connect.mockImplementationOnce(async (request) => {
      const link = await connect(request)
      return { ...link, onNotify() { throw new Error('Team Link notification listener unavailable') } }
    })
    const first = f.connections[0]
    if (first === undefined) throw new Error('Initial Link was not connected')
    first.reject(new Error('Transport disconnected'))
    await vi.waitFor(() => { expect(f.teamLinks.connect).toHaveBeenCalledTimes(3) }, { timeout: 5000 })
    expect(f.close).toHaveBeenCalled()
    expect(f.unregister).toHaveBeenCalledTimes(2)
    expect(f.revoke).toHaveBeenCalledTimes(2)
    await f.handle.dispose()
    await expect(f.handle.health()).resolves.toMatchObject({ status: 'offline' })
  })

  it('cancels a pending Link reconnect timer when its activation is disposed', async () => {
    const f = await linkedFixture({}, undefined, 10_000)
    const first = f.connections[0]
    if (first === undefined) throw new Error('Initial Link was not connected')
    first.reject(new Error('Transport disconnected'))
    await vi.waitFor(() => { expect(f.unregister).toHaveBeenCalledOnce() })
    await f.handle.dispose()
    expect(f.teamLinks.connect).toHaveBeenCalledOnce()
    expect(f.revoke).toHaveBeenCalledOnce()
  })

  it('does not retry an issuer that fails after the ACP child exits during reconnect', async () => {
    const f = await linkedFixture()
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof f.teamLinks.reserveEnrollment>>>()
    f.teamLinks.reserveEnrollment.mockImplementationOnce(() => pending.promise)
    const first = f.connections[0]
    if (first === undefined) throw new Error('Initial Link was not connected')
    first.reject(new Error('Transport disconnected'))
    await vi.waitFor(() => { expect(f.teamLinks.reserveEnrollment).toHaveBeenCalledTimes(2) })
    const spawned = f.spawn.mock.results[0]
    if (spawned?.type !== 'return') throw new Error('ACP child was not spawned')
    spawned.value.terminate()
    await spawned.value.done
    await vi.waitFor(async () => { expect(await f.handle.health()).toMatchObject({ status: 'offline' }) })
    pending.reject('Issuer failed after child exit')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(f.teamLinks.reserveEnrollment).toHaveBeenCalledTimes(2)
    expect(f.teamLinks.connect).toHaveBeenCalledOnce()
  })

  it('does not restore idle after Link termination loses a race with ACP disposal', async () => {
    const f = await linkedFixture()
    const terminate = f.terminations[0]
    if (terminate === undefined) throw new Error('Link termination hook is missing')
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    vi.spyOn(ClientSideConnection.prototype, 'cancel').mockImplementationOnce(async () => {
      entered.resolve(undefined); await release.promise
    })
    const statuses: string[] = []
    f.handle.onStatus((value) => { statuses.push(value.status) })
    const stopping = terminate({ code: 'RETIRED', message: 'Hub retired the Link' })
    await entered.promise
    const disposing = f.handle.dispose()
    release.resolve(undefined)
    await Promise.all([stopping, disposing])
    expect(statuses).toEqual(['stopping', 'offline'])
  })

  it('acknowledges a bound soft interrupt only after the ACP cancel request succeeds', async () => {
    const fixture = await linkedFixture()
    const interrupt = fixture.interrupts[0]
    if (interrupt === undefined) throw new Error('Team Link interrupt listener was not installed')
    const command = participantInterruptSnapshotSchema.parse({
      id: 'acp-soft-interrupt', actorId: participant.id,
      target: { teamId, participantId: participant.id, activationId: fixture.binding.activation.id,
        sessionId: fixture.binding.sessionId, provider: fixture.binding.provider },
      requestedAt: 1,
    })
    await interrupt({ deliveryId: 'acp-soft-interrupt-delivery' as never, interrupt: command })
    expect(fixture.acknowledgeInterrupt).toHaveBeenCalledExactlyOnceWith('acp-soft-interrupt-delivery', command.id)
    await expect(fixture.handle.health()).resolves.toMatchObject({ status: 'idle' })
    await fixture.handle.dispose()
  })

  it.each([false, true])('retires an activation and Link when the ACP child exits during a claimed prompt (unregister fails=%s)', async (unregisterFails) => {
    const f = await linkedFixture({ MOCK_CRASH_ON_PROMPT: '1' })
    if (unregisterFails) f.unregister.mockImplementationOnce(() => { throw new Error('External Link unregister failed') })
    const envelope = teamEnvelopeSchema.parse({ id: 'acp-crash-envelope', teamId, channelId: 'acp-crash-channel',
      sequence: 1, senderId: 'acp-crash-sender', audience: [participant.id], kind: 'message',
      payload: { text: 'Prompt the child' }, delivery: 'turn', priority: 'normal', createdAt: 1 })
    const channel = channelSnapshotSchema.parse({ manifest: { id: envelope.channelId, teamId,
      adapter: { type: 'direct', version: 3 }, viewPolicy: { type: 'directed', version: 1 },
      participants: [{ id: envelope.senderId, role: 'sender' }, { id: participant.id, role: 'worker' }], limits: {},
    }, phase: 'active', cursor: 1 })
    f.claim.mockResolvedValue({ binding: f.binding, channel, envelopeId: envelope.id, delivery: envelope.delivery })
    await expect(f.deliver(envelope)).rejects.toThrow()
    const spawned = f.spawn.mock.results[0]
    if (spawned?.type !== 'return') throw new Error('ACP child was not spawned')
    await spawned.value.done
    await vi.waitFor(async () => { expect(await f.handle.health()).toMatchObject({ status: 'offline' }) })
    await vi.waitFor(() => { expect(f.ctx.sessions.get(f.handle.sessionId)).toBeUndefined() })
    expect(f.acknowledge).not.toHaveBeenCalled()
    await f.handle.dispose()
    expect(f.revoke).toHaveBeenCalledOnce()
  })

  it('does not enroll a Link from stale or foreign activation-change events', async () => {
    const fixture = await linkedFixture()
    const binding = fixture.binding
    fixture.ctx.emit('team/changed', teamEventSchema.parse({ type: 'participant/changed', participant, cursor: 2, createdAt: 2 }))
    const foreign = [
      { ...binding, activation: { ...binding.activation, id: 'foreign-acp-activation' as never } },
      { ...binding, activation: { ...binding.activation, teamId: 'foreign-team' as never } },
      { ...binding, activation: { ...binding.activation, participantId: 'foreign-participant' as never } },
      { ...binding, sessionId: 'foreign-session' as never },
      { ...binding, provider: 'foreign-provider' },
      { ...binding, activation: { ...binding.activation, status: 'offline' as const } },
    ]
    for (const stale of foreign) {
      fixture.ctx.emit('team/changed', teamEventSchema.parse({ type: 'activation/changed', binding: stale, cursor: 2, createdAt: 2 }))
    }
    expect(fixture.teamLinks.connect).toHaveBeenCalledOnce()
    await fixture.handle.dispose()
    const terminate = fixture.terminations[0]
    if (terminate === undefined) throw new Error('Team Link termination callback was not installed')
    await terminate({ code: 'late', message: 'Old endpoint closed after disposal' })
    await expect(fixture.handle.health()).resolves.toMatchObject({ status: 'offline' })
    expect(fixture.teamLinks.connect).toHaveBeenCalledOnce()
  })

  it('persists exact task-assignment provenance, rejects stale running attempts, and reuses durable input after a cancelled prompt', async () => {
    const f = await linkedFixture()
    const { ctx, handle, binding, claim, deliver, claimTaskAttemptStart, acknowledge } = f
    const channel = channelSnapshotSchema.parse({ manifest: { id: 'task-channel', teamId,
      adapter: { type: 'task-assignment', version: 1 }, participants: [{ id: participant.id, role: 'assignee' }],
      limits: { taskId: 'assigned-task', activationId: binding.activation.id, sessionId: binding.sessionId } },
    phase: 'active', cursor: 3 })
    const envelope = teamEnvelopeSchema.parse({ id: 'assignment-envelope', teamId, channelId: channel.manifest.id,
      sequence: 1, senderId: participant.id, audience: [participant.id], kind: 'assignment', taskId: 'assigned-task',
      payload: { taskId: 'assigned-task', attemptId: 'assigned-attempt', assignedRevision: 1,
        activationId: binding.activation.id, sessionId: binding.sessionId }, delivery: 'turn', priority: 'normal', createdAt: 1 })
    const valid = { binding, channel, envelopeId: envelope.id, delivery: envelope.delivery }
    const invalidClaims: ReadonlyArray<ChannelDeliveryClaim> = [
      { ...valid, view: {} as TeamChannelViewEventData },
      { ...valid, envelopeId: envelopeIdSchema.parse('other-envelope') },
      { ...valid, delivery: 'steer' },
      { ...valid, channel: { ...channel, phase: 'closed' } },
      { ...valid, channel: { ...channel, manifest: { ...channel.manifest, id: channelIdSchema.parse('other-channel') } } },
      { ...valid, channel: { ...channel, manifest: { ...channel.manifest, teamId: teamIdSchema.parse('other-team') } } },
      ...['id', 'teamId', 'participantId'].map(field => ({ ...valid,
        binding: { ...binding, activation: { ...binding.activation, [field]: 'other' } },
      })),
      { ...valid, binding: { ...binding, sessionId: SessionId('other-session') } },
    ]
    for (const invalid of invalidClaims) {
      claim.mockResolvedValueOnce(invalid)
      await expect(deliver(envelope)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    }
    const foreignEnvelope = teamEnvelopeSchema.parse({ ...envelope, senderId: 'foreign-assignee', audience: ['foreign-assignee'] })
    const foreignChannel = channelSnapshotSchema.parse({ ...channel, manifest: { ...channel.manifest,
      participants: [{ id: 'foreign-assignee', role: 'assignee' }],
    } })
    claim.mockResolvedValueOnce({ ...valid, channel: foreignChannel })
    await expect(deliver(foreignEnvelope)).rejects.toThrow('not bound to this activation')
    claim.mockResolvedValue(valid)
    await expect(deliver({ ...envelope, payload: {} })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const task = { id: 'assigned-task', teamId, subject: 'Task subject', description: 'Task details', phase: 'running', revision: 2,
      lease: { attemptId: 'assigned-attempt', assignedRevision: 1, participantId: participant.id, activationId: binding.activation.id,
        wakeChannelId: channel.manifest.id, startedAt: 1 } } as unknown as import('@clocky/clocky-team').TeamTaskSnapshot
    const invalidTasks = [
      { ...task, id: 'other-task' }, { ...task, teamId: 'other-team' }, { ...task, phase: 'pending' }, { ...task, lease: undefined },
      ...['attemptId', 'assignedRevision', 'participantId', 'activationId', 'wakeChannelId', 'startedAt'].map(field => ({
        ...task, lease: { ...task.lease, [field]: field === 'startedAt' ? undefined : field === 'assignedRevision' ? 2 : 'other' },
      })),
    ]
    for (const invalid of invalidTasks) {
      claimTaskAttemptStart.mockResolvedValueOnce(invalid as typeof task)
      await expect(deliver(envelope)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    }
    expect(ctx.sessions.get(handle.sessionId)?.events).toHaveLength(0)
    claimTaskAttemptStart.mockResolvedValue(task)
    const prompt = vi.spyOn(ClientSideConnection.prototype, 'prompt').mockResolvedValueOnce({ stopReason: 'cancelled' })
    await deliver(envelope)
    expect(acknowledge).not.toHaveBeenCalled()
    const changedAssignment = teamEnvelopeSchema.parse({ ...envelope, payload: { ...envelope.payload, assignedRevision: 2 } })
    claimTaskAttemptStart.mockResolvedValueOnce({ ...task, lease: { ...task.lease!, assignedRevision: 2 } })
    await expect(deliver(changedAssignment)).rejects.toThrow('conflicting durable model input')
    expect(acknowledge).not.toHaveBeenCalled()
    await deliver(envelope)
    expect(acknowledge).toHaveBeenCalledOnce()
    const events = (await ctx.sessionPersistence.load(handle.sessionId)).events
    expect(events.filter(event => event.type === 'user/message')).toHaveLength(1)
    expect(events.find(event => event.type === 'user/message')?.data).toMatchObject({
      content: [{ type: 'text', text: 'Team task assignment: Task subject\n\nTask details\n\nTask: assigned-task\nAttempt: assigned-attempt' }],
      source: { kind: 'team-task-assignment', taskId: 'assigned-task', assignedRevision: 1, runningRevision: 2 },
    })
    await deliver(envelope)
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(acknowledge).toHaveBeenCalledTimes(2)
    await handle.dispose()
  })

  it('settles cleanup after proven termination when durable prompt completion cannot be acknowledged', async () => {
    let notify: ((envelope: TeamEnvelope) => Promise<void>) | undefined
    let link: TeamLink | undefined
    const acknowledge = vi.fn(async (..._args: Parameters<TeamLink['acknowledge']>) => ({} as never))
    const teamLinks = {
      getEnrollmentProvider: vi.fn(() => ({ name: 'websocket' })),
      reserveEnrollment: vi.fn(async () => ({
        provider: 'websocket',
        endpoint: 'ws://127.0.0.1:1/team-link',
        capability: 'opaque-capability',
        revoke: vi.fn(async () => {}),
      })),
      registerProvider: vi.fn(() => () => undefined),
      connect: vi.fn(async ({ provider, binding }: TeamLinkConnectRequest) => {
        link = {
          provider,
          binding,
          done: Promise.resolve(),
          onNotify(listener) {
            notify = listener
            return () => { notify = undefined }
          },
          onInterrupt() { return () => {} },
          onInvitation() { return () => {} },
          onTaskCancellation() { return () => {} },
          async getChannel() { throw new Error('Unused fixture channel query') },
          async acknowledgeChannelInvitation() { throw new Error('Unused fixture invitation') },
          async claim() {
            return {
              binding,
              channel: channelSnapshotSchema.parse({
                manifest: {
                  id: 'acp-cleanup-channel',
                  teamId,
                  adapter: { type: 'direct', version: 3 },
                  viewPolicy: { type: 'directed', version: 1 },
                  participants: [{ id: participant.id, role: 'worker' }],
                  limits: {},
                },
                phase: 'active',
                cursor: 11,
              }),
              envelopeId: envelopeIdSchema.parse('acp-cleanup-envelope'),
              delivery: 'turn',
            }
          },
          async acknowledge(...args: Parameters<TeamLink['acknowledge']>) {
            await acknowledge(...args)
            return {} as never
          },
          async post() { throw new Error('Unused fixture post') },
          async postFinalResult() { throw new Error('Unused fixture final result') },
          async claimTaskAttemptStart() { throw new Error('Unused fixture task claim') },
          async settleTaskAttempt() { throw new Error('Unused fixture task settlement') },
          async integrateTask() { throw new Error('Unused fixture task integration') },
          async heartbeatTaskAttempt() { throw new Error('Unused fixture task heartbeat') },
          async resolveTaskReview() { throw new Error('Unused fixture task review') },
          async acknowledgeTaskCancellation() { throw new Error('Unused fixture task cancellation') },
          async acknowledgeInterrupt() { throw new Error('Unused fixture interrupt') },
          async close() {},
        }
        return link
      }),
    }
    const ctx = await setup({ MOCK_TEXT: 'ACP cleanup response' }, 200, teamLinks, { teamLinkEnrollmentProvider: 'websocket' })
    const activation = ctx.agentRuntimes.activate(request(SessionId('acp-runtime-cleanup-session')))
    const handle = await activation
    const binding = activationBindingSnapshotSchema.parse({
      activation: handle.activation,
      sessionId: handle.sessionId,
      provider: 'acp',
    })
    ctx.emit('team/changed', teamEventSchema.parse({ type: 'activation/changed', binding, cursor: 1, createdAt: 1 }))
    const deliver = await vi.waitFor(() => {
      if (notify === undefined) throw new Error('ACP Team Link did not install its notification listener')
      return notify
    })
    const envelope = teamEnvelopeSchema.parse({
      id: 'acp-cleanup-envelope',
      teamId,
      channelId: 'acp-cleanup-channel',
      sequence: 1,
      senderId: 'acp-cleanup-sender',
      audience: [participant.id],
      kind: 'message',
      payload: { text: 'deliver before cleanup' },
      delivery: 'turn',
      priority: 'normal',
      createdAt: 1,
    })

    const originalFlush = ctx.sessions.flush.bind(ctx.sessions)
    let completionFlush = false
    const flushHeld = Promise.withResolvers<undefined>()
    vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
      if (completionFlush || session.events.at(-1)?.type !== 'turn/end') {
        return await originalFlush(session)
      }
      completionFlush = true
      flushHeld.resolve(undefined)
      await flushHeld.promise
      throw new Error('durable completion was lost')
    })
    const warned: string[] = []
    vi.spyOn(ctx.logger, 'warn').mockImplementation((message: string) => { warned.push(message) })

    const delivery = deliver(envelope)
    await flushHeld.promise
    const disposal = handle.dispose()
    flushHeld.resolve(undefined)
    await expect(delivery).rejects.toThrow('durable completion was lost')
    await expect(disposal).resolves.toBeUndefined()
    expect(acknowledge).not.toHaveBeenCalled()
    expect(warned).toEqual([])
    await expect(handle.health()).resolves.toMatchObject({ status: 'offline' })
  })

  it('persists a claimed Envelope before ACP prompt and de-duplicates a completed replay', async () => {
    let notify: ((envelope: TeamEnvelope) => Promise<void>) | undefined
    let link: TeamLink | undefined
    const revoke = vi.fn(async () => {})
    const acknowledge = vi.fn(async (..._args: Parameters<TeamLink['acknowledge']>) => ({}))
    const teamLinks = {
      getEnrollmentProvider: vi.fn(() => ({ name: 'websocket' })),
      reserveEnrollment: vi.fn(async () => ({
        provider: 'websocket',
        endpoint: 'ws://127.0.0.1:1/team-link',
        capability: 'opaque-capability',
        revoke,
      })),
      registerProvider: vi.fn(() => () => undefined),
      connect: vi.fn(async ({ provider, binding }: TeamLinkConnectRequest) => {
        link = {
          provider,
          binding,
          done: Promise.resolve(),
          onNotify(listener) {
            notify = listener
            return () => { notify = undefined }
          },
          async getChannel() { throw new Error('This fixture does not read channel metadata') },
          onInvitation() { return () => {} },
          async acknowledgeChannelInvitation() { throw new Error('This fixture has no pending channel invitation') },
          onInterrupt() { return () => {} },
          onTaskCancellation() { return () => {} },
          async acknowledgeTaskCancellation() { throw new Error('not used') },
          async post() { throw new Error('not used') },
          async postFinalResult() { throw new Error('not used') },
          async claim() {
            return {
              binding,
              channel: channelSnapshotSchema.parse({
                manifest: {
                  id: 'acp-delivery-channel',
                  teamId,
                  adapter: { type: 'direct', version: 3 },
                  viewPolicy: { type: 'directed', version: 1 },
                  participants: [
                    { id: 'acp-delivery-sender', role: 'sender' },
                    { id: participant.id, role: 'worker' },
                  ],
                  limits: {},
                },
                phase: 'active',
                cursor: 7,
              }),
              envelopeId: envelopeIdSchema.parse('acp-delivery-envelope'),
              delivery: 'turn',
            }
          },
          async claimTaskAttemptStart() { throw new Error('not used') },
          async settleTaskAttempt() { throw new Error('not used') },
          async integrateTask() { throw new Error('not used') },
          async heartbeatTaskAttempt() { throw new Error('not used') },
          async resolveTaskReview() { throw new Error('not used') },
          async acknowledge(...args: Parameters<TeamLink['acknowledge']>) {
            await acknowledge(...args)
            return {} as never
          },
          async acknowledgeInterrupt() { throw new Error('not used') },
          async close() {},
        }
        return link
      }),
    }
    const ctx = await setup({ MOCK_TEXT: 'ACP response' }, 200, teamLinks, { teamLinkEnrollmentProvider: 'websocket' })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('acp-runtime-delivery-session')))
    const binding = activationBindingSnapshotSchema.parse({
      activation: handle.activation,
      sessionId: handle.sessionId,
      provider: 'acp',
    })
    ctx.emit('team/changed', teamEventSchema.parse({
      type: 'activation/changed', binding, cursor: 1, createdAt: 1,
    }))
    await vi.waitFor(() => {
      expect(teamLinks.connect).toHaveBeenCalledOnce()
      expect(link).toBeDefined()
      expect(notify).toBeDefined()
    })
    const envelope = teamEnvelopeSchema.parse({
      id: 'acp-delivery-envelope',
      teamId,
      channelId: 'acp-delivery-channel',
      sequence: 1,
      senderId: 'acp-delivery-sender',
      audience: [participant.id],
      kind: 'message',
      payload: { text: 'deliver this' },
      delivery: 'turn',
      causationId: 'acp-delivery-cause',
      priority: 'normal',
      createdAt: 1,
    })
    const deliver = notify
    if (deliver === undefined) throw new Error('ACP Team Link did not install its notification listener')
    await deliver(envelope)
    const first = await ctx.sessionPersistence.load(handle.sessionId)
    expect(first.events.map(event => event.type)).toEqual([
      'turn/start', 'user/message', 'agent-runtime-acp/prompt-completed', 'turn/end',
    ])
    expect(acknowledge).toHaveBeenCalledWith(envelope.channelId, envelope.id, 7)

    await deliver(envelope)
    const replay = await ctx.sessionPersistence.load(handle.sessionId)
    expect(replay.events.map(event => event.type)).toEqual(first.events.map(event => event.type))
    expect(acknowledge).toHaveBeenCalledTimes(2)
    expect(revoke).not.toHaveBeenCalled()

    await handle.dispose()
    expect(revoke).toHaveBeenCalledOnce()
  })

  it('persists a non-direct channel view before forwarding its exact content and de-duplicates replay', async () => {
    let notify: ((envelope: TeamEnvelope) => Promise<void>) | undefined
    let link: TeamLink | undefined
    let deliveryClaim: ChannelDeliveryClaim | undefined
    const revoke = vi.fn(async () => {})
    const acknowledge = vi.fn(async (..._args: Parameters<TeamLink['acknowledge']>) => ({}))
    const teamLinks = {
      getEnrollmentProvider: vi.fn(() => ({ name: 'websocket' })),
      reserveEnrollment: vi.fn(async () => ({
        provider: 'websocket',
        endpoint: 'ws://127.0.0.1:1/team-link',
        capability: 'opaque-capability',
        revoke,
      })),
      registerProvider: vi.fn(() => () => undefined),
      connect: vi.fn(async ({ provider, binding }: TeamLinkConnectRequest) => {
        link = {
          provider,
          binding,
          done: Promise.resolve(),
          onNotify(listener) {
            notify = listener
            return () => { notify = undefined }
          },
          async getChannel() { throw new Error('This fixture does not read channel metadata') },
          onInvitation() { return () => {} },
          async acknowledgeChannelInvitation() { throw new Error('This fixture has no pending channel invitation') },
          onInterrupt() { return () => {} },
          onTaskCancellation() { return () => {} },
          async acknowledgeTaskCancellation() { throw new Error('not used') },
          async post() { throw new Error('not used') },
          async postFinalResult() { throw new Error('not used') },
          async claim() { return deliveryClaim },
          async claimTaskAttemptStart() { throw new Error('not used') },
          async settleTaskAttempt() { throw new Error('not used') },
          async integrateTask() { throw new Error('not used') },
          async heartbeatTaskAttempt() { throw new Error('not used') },
          async resolveTaskReview() { throw new Error('not used') },
          async acknowledge(...args: Parameters<TeamLink['acknowledge']>) {
            await acknowledge(...args)
            return {} as never
          },
          async acknowledgeInterrupt() { throw new Error('not used') },
          async close() {},
        }
        return link
      }),
    }
    const ctx = await setup({ MOCK_TEXT: 'ACP response' }, 200, teamLinks, { teamLinkEnrollmentProvider: 'websocket' })
    const handle = await ctx.agentRuntimes.activate(request(SessionId('acp-runtime-view-delivery-session')))
    const binding = activationBindingSnapshotSchema.parse({
      activation: handle.activation,
      sessionId: handle.sessionId,
      provider: 'acp',
    })
    ctx.emit('team/changed', teamEventSchema.parse({
      type: 'activation/changed', binding, cursor: 1, createdAt: 1,
    }))
    await vi.waitFor(() => {
      expect(teamLinks.connect).toHaveBeenCalledOnce()
      expect(link).toBeDefined()
      expect(notify).toBeDefined()
    })
    const envelope = teamEnvelopeSchema.parse({
      id: 'acp-view-envelope',
      teamId,
      channelId: 'acp-view-channel',
      sequence: 1,
      senderId: 'acp-view-sender',
      audience: [participant.id],
      kind: 'review-request',
      payload: {
        text: 'inspect the result',
        attemptId: 'acp-view-attempt',
        reviewRevision: 2,
        reviewerId: participant.id,
        initiatorId: 'acp-view-sender',
        result: { summary: 'the result is ready' },
      },
      delivery: 'turn',
      causationId: 'acp-view-causation',
      taskId: 'acp-view-task',
      priority: 'normal',
      createdAt: 1,
    })
    const channel = channelSnapshotSchema.parse({
      manifest: {
        id: envelope.channelId,
        teamId,
        adapter: { type: 'consult', version: 1 },
        viewPolicy: { type: 'recent-window', version: 1 },
        participants: [
          { id: envelope.senderId, role: 'initiator' },
          { id: participant.id, role: 'respondent' },
        ],
        limits: {},
      },
      phase: 'active',
      cursor: 7,
    })
    const view: TeamChannelViewEventData = {
      teamId,
      channelId: envelope.channelId,
      adapter: { type: 'consult', version: 1 },
      viewPolicy: { type: 'recent-window', version: 1 },
      triggeringEnvelopeId: envelope.id,
      sourceEnvelopeIds: ['acp-view-source', envelope.id],
      delivery: envelope.delivery,
      content: [{ type: 'text', text: 'exact pre-rendered ACP view' }],
      causationId: envelope.causationId,
      taskId: envelope.taskId,
      review: {
        attemptId: 'acp-view-attempt',
        reviewRevision: 2,
        reviewerId: participant.id,
        initiatorId: envelope.senderId,
      },
    }
    deliveryClaim = { binding, channel, envelopeId: envelope.id, delivery: envelope.delivery, view }
    const deliver = notify
    if (deliver === undefined) throw new Error('ACP Team Link did not install its notification listener')
    const validClaim = deliveryClaim
    deliveryClaim = { binding, channel, envelopeId: envelope.id, delivery: envelope.delivery }
    const proxySession = ctx.sessions.get(handle.sessionId)
    if (proxySession === undefined) throw new Error('ACP proxy Session is not live')
    await expect(deliver(envelope)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(proxySession.events).toHaveLength(0)
    const invalidClaims: ReadonlyArray<readonly [string, ChannelDeliveryClaim]> = [
      ['invalid view shape', { ...validClaim, view: {} as TeamChannelViewEventData }],
      ['unexpected direct view', { ...validClaim, channel: { ...channel,
        manifest: { ...channel.manifest, adapter: { type: 'direct', version: 3 } } } }],
      ['claim envelope', { ...validClaim, envelopeId: envelopeIdSchema.parse('other-envelope') }],
      ['claim delivery', { ...validClaim, delivery: 'steer' }],
      ['closed channel', { ...validClaim, channel: { ...channel, phase: 'closed' } }],
      ['channel identity', { ...validClaim, channel: { ...channel,
        manifest: { ...channel.manifest, id: channelIdSchema.parse('other-channel') } } }],
      ['channel Team', { ...validClaim, channel: { ...channel,
        manifest: { ...channel.manifest, teamId: teamIdSchema.parse('other-team') } } }],
      ['view Team', { ...validClaim, view: { ...view, teamId: teamIdSchema.parse('other-team') } }],
      ['view channel', { ...validClaim, view: { ...view, channelId: 'other-channel' } }],
      ['view trigger', { ...validClaim, view: { ...view, triggeringEnvelopeId: envelopeIdSchema.parse('other-envelope') } }],
      ['view delivery', { ...validClaim, view: { ...view, delivery: 'steer' } }],
      ['adapter type', { ...validClaim, view: { ...view, adapter: { type: 'discussion', version: 1 } } }],
      ['adapter version', { ...validClaim, view: { ...view, adapter: { ...view.adapter, version: 2 } } }],
      ['absent policy', { ...validClaim, channel: { ...channel,
        manifest: { ...channel.manifest, viewPolicy: undefined } } }],
      ['policy type', { ...validClaim, view: { ...view, viewPolicy: { type: 'other-policy', version: 1 } } }],
      ['policy version', { ...validClaim, view: { ...view, viewPolicy: { ...view.viewPolicy, version: 2 } } }],
      ['source tail', { ...validClaim, view: { ...view, sourceEnvelopeIds: [envelopeIdSchema.parse('other-envelope')] } }],
      ['causation', { ...validClaim, view: { ...view, causationId: envelopeIdSchema.parse('other-causation') } }],
      ['task', { ...validClaim, view: { ...view, taskId: 'other-task' } }],
      ['review fence', { ...validClaim, view: { ...view, review: { ...view.review!, reviewRevision: 3 } } }],
    ]
    for (const [label, claim] of invalidClaims) {
      deliveryClaim = claim
      await expect(deliver(envelope), label).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      expect(proxySession.events, label).toHaveLength(0)
      expect(acknowledge, label).not.toHaveBeenCalled()
    }
    const ordinary = teamEnvelopeSchema.parse({ ...envelope, id: 'acp-ordinary-view-envelope',
      kind: 'message', payload: { text: 'Ordinary message' } })
    deliveryClaim = { binding, channel, envelopeId: ordinary.id, delivery: ordinary.delivery,
      view: { ...view, triggeringEnvelopeId: ordinary.id,
        sourceEnvelopeIds: ['acp-view-source', ordinary.id] } }
    await expect(deliver(ordinary)).rejects.toThrow('unexpected review fence')
    expect(proxySession.events).toHaveLength(0)
    deliveryClaim = undefined
    await deliver(envelope)
    expect(proxySession.events).toHaveLength(0)
    deliveryClaim = validClaim

    const prompt = vi.spyOn(ClientSideConnection.prototype, 'prompt')
    const originalFlush = ctx.sessions.flush.bind(ctx.sessions)
    const flushStarted = Promise.withResolvers<undefined>()
    const releaseFlush = Promise.withResolvers<undefined>()
    let held = false
    vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
      if (session !== proxySession) return await originalFlush(session)
      if (!held) {
        held = true
        flushStarted.resolve(undefined)
        await releaseFlush.promise
      }
      return await originalFlush(session)
    })

    const delivery = deliver(envelope)
    await flushStarted.promise
    expect(prompt).not.toHaveBeenCalled()
    expect(acknowledge).not.toHaveBeenCalled()
    expect(proxySession.events.map(event => event.type)).toEqual(['turn/start', 'team/channel-view'])

    releaseFlush.resolve(undefined)
    await delivery
    const first = await ctx.sessionPersistence.load(handle.sessionId)
    expect(first.events.map(event => event.type)).toEqual([
      'turn/start', 'team/channel-view', 'agent-runtime-acp/prompt-completed', 'turn/end',
    ])
    const viewEvent = first.events.find((event): event is SessionEvent<'team/channel-view'> => event.type === 'team/channel-view')
    expect(viewEvent).toMatchObject({ type: 'team/channel-view', data: view })
    expect(viewEvent?.type === 'team/channel-view' && Object.keys(viewEvent.data).sort()).toEqual([
      'adapter', 'causationId', 'channelId', 'content', 'delivery', 'review', 'sourceEnvelopeIds',
      'taskId', 'teamId', 'triggeringEnvelopeId', 'viewPolicy',
    ].sort())
    expect(prompt).toHaveBeenCalledTimes(1)
    const promptArgs = prompt.mock.calls[0]?.[0]
    if (promptArgs === undefined || typeof promptArgs.sessionId !== 'string') {
      throw new Error('ACP prompt did not receive a session id')
    }
    expect(promptArgs.prompt).toEqual(view.content)
    expect(acknowledge).toHaveBeenCalledWith(envelope.channelId, envelope.id, 7)

    await deliver(envelope)
    const replay = await ctx.sessionPersistence.load(handle.sessionId)
    expect(replay.events.map(event => event.type)).toEqual(first.events.map(event => event.type))
    expect(prompt).toHaveBeenCalledOnce()
    expect(acknowledge).toHaveBeenCalledTimes(2)

    const reorderedView = JSON.parse(JSON.stringify(view), (_key: string, value: unknown) => {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return Object.fromEntries(Object.entries(value).reverse())
      }
      return value
    }) as TeamChannelViewEventData
    deliveryClaim = { ...validClaim, view: reorderedView }
    await deliver(envelope)
    expect(prompt).toHaveBeenCalledOnce()
    expect(acknowledge).toHaveBeenCalledTimes(3)

    deliveryClaim = { ...validClaim, view: { ...view, content: [{ type: 'text', text: 'rewritten durable input' }] } }
    await expect(deliver(envelope)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(prompt).toHaveBeenCalledOnce()
    expect(acknowledge).toHaveBeenCalledTimes(3)

    deliveryClaim = { ...validClaim, view: { ...view, adapter: { type: 'wrong-adapter', version: 1 } } }
    await expect(deliver(envelope)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(prompt).toHaveBeenCalledOnce()
    expect(acknowledge).toHaveBeenCalledTimes(3)

    await handle.dispose()
    expect(revoke).toHaveBeenCalledOnce()
  })

  it('rejects a changed non-direct view after a cancelled prompt retained its original admission', async () => {
    const f = await linkedFixture()
    const envelope = teamEnvelopeSchema.parse({ id: 'acp-cancelled-view-envelope', teamId,
      channelId: 'acp-cancelled-view-channel', sequence: 1, senderId: 'acp-view-sender', audience: [participant.id],
      kind: 'message', payload: { text: 'Original question' }, delivery: 'turn', priority: 'normal', createdAt: 1 })
    const channel = channelSnapshotSchema.parse({ manifest: { id: envelope.channelId, teamId,
      adapter: { type: 'consult', version: 1 }, viewPolicy: { type: 'recent-window', version: 1 },
      participants: [{ id: envelope.senderId, role: 'initiator' }, { id: participant.id, role: 'respondent' }], limits: {},
    }, phase: 'active', cursor: 1 })
    const view: TeamChannelViewEventData = { teamId, channelId: envelope.channelId,
      adapter: { type: 'consult', version: 1 }, viewPolicy: { type: 'recent-window', version: 1 },
      triggeringEnvelopeId: envelope.id, sourceEnvelopeIds: [envelope.id], delivery: envelope.delivery,
      content: [{ type: 'text', text: 'Original authorized view' }],
    }
    f.claim.mockResolvedValue({ binding: f.binding, channel, envelopeId: envelope.id, delivery: envelope.delivery, view })
    const prompt = vi.spyOn(ClientSideConnection.prototype, 'prompt').mockResolvedValueOnce({ stopReason: 'cancelled' })
    await f.deliver(envelope)
    expect(f.acknowledge).not.toHaveBeenCalled()
    f.claim.mockResolvedValue({ binding: f.binding, channel, envelopeId: envelope.id, delivery: envelope.delivery,
      view: { ...view, content: [{ type: 'text', text: 'Changed authorized view' }] } })
    await expect(f.deliver(envelope)).rejects.toThrow('conflicting durable model input')
    expect(prompt).toHaveBeenCalledOnce()
    f.claim.mockResolvedValue({ binding: f.binding, channel, envelopeId: envelope.id, delivery: envelope.delivery, view })
    await f.deliver(envelope)
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(f.acknowledge).toHaveBeenCalledOnce()
    await f.handle.dispose()
  })

  it('reuses the durable direct Envelope input after a cancelled ACP prompt', async () => {
    const f = await linkedFixture()
    const proxy = f.ctx.sessions.get(f.handle.sessionId)
    if (proxy === undefined) throw new Error('ACP proxy Session was not entered')
    proxy.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Unrelated prior input' }],
      source: { kind: 'user' } }), { surfaceOp: 'append' })
    await f.ctx.sessions.flush(proxy)
    const envelope = teamEnvelopeSchema.parse({ id: 'acp-cancelled-direct-envelope', teamId,
      channelId: 'acp-cancelled-direct-channel', sequence: 1, senderId: 'acp-direct-sender', audience: [participant.id],
      kind: 'message', payload: { text: 'Original direct message' }, delivery: 'turn', priority: 'normal', createdAt: 1 })
    const channel = channelSnapshotSchema.parse({ manifest: { id: envelope.channelId, teamId,
      adapter: { type: 'direct', version: 3 }, viewPolicy: { type: 'directed', version: 1 },
      participants: [{ id: envelope.senderId, role: 'sender' }, { id: participant.id, role: 'worker' }], limits: {},
    }, phase: 'active', cursor: 1 })
    f.claim.mockResolvedValue({ binding: f.binding, channel, envelopeId: envelope.id, delivery: envelope.delivery })
    const prompt = vi.spyOn(ClientSideConnection.prototype, 'prompt').mockResolvedValueOnce({ stopReason: 'cancelled' })
    await f.deliver(envelope)
    expect(f.acknowledge).not.toHaveBeenCalled()
    await f.deliver(envelope)
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(f.acknowledge).toHaveBeenCalledOnce()
    const events = (await f.ctx.sessionPersistence.load(f.handle.sessionId)).events
    expect(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'acp-team-envelope')).toHaveLength(1)
    const assignment = teamEnvelopeSchema.parse({ ...envelope, channelId: 'acp-conflicting-task-channel',
      senderId: participant.id, audience: [participant.id], kind: 'assignment', taskId: 'acp-conflicting-task',
      payload: { taskId: 'acp-conflicting-task', attemptId: 'acp-conflicting-attempt', assignedRevision: 1,
        activationId: f.binding.activation.id, sessionId: f.binding.sessionId } })
    const assignmentChannel = channelSnapshotSchema.parse({ manifest: { id: assignment.channelId, teamId,
      adapter: { type: 'task-assignment', version: 1 }, participants: [{ id: participant.id, role: 'assignee' }],
      limits: { taskId: 'acp-conflicting-task', activationId: f.binding.activation.id, sessionId: f.binding.sessionId },
    }, phase: 'active', cursor: 2 })
    f.claim.mockResolvedValue({ binding: f.binding, channel: assignmentChannel,
      envelopeId: assignment.id, delivery: assignment.delivery })
    await expect(f.deliver(assignment)).rejects.toThrow('no matching durable model input')
    expect(f.acknowledge).toHaveBeenCalledOnce()
    await f.handle.dispose()
  })

  it('rejects a restored completion fact that has no durable source admission', async () => {
    const f = await linkedFixture()
    const envelope = teamEnvelopeSchema.parse({ id: 'acp-orphan-completion-envelope', teamId,
      channelId: 'acp-orphan-completion-channel', sequence: 1, senderId: 'acp-orphan-sender', audience: [participant.id],
      kind: 'message', payload: { text: 'Original direct message' }, delivery: 'turn', priority: 'normal', createdAt: 1 })
    const proxy = f.ctx.sessions.get(f.handle.sessionId)
    if (proxy === undefined) throw new Error('ACP proxy Session was not entered')
    proxy.append('agent-runtime-acp/prompt-completed', { teamId, participantId: participant.id,
      channelId: envelope.channelId, envelopeId: envelope.id, stopReason: 'end_turn' })
    await f.ctx.sessions.flush(proxy)
    await f.handle.dispose()
    const next = await f.ctx.agentRuntimes.activate({ ...request(f.handle.sessionId), seed: { kind: 'resume' } })
    const binding = activationBindingSnapshotSchema.parse({ activation: next.activation, sessionId: next.sessionId, provider: 'acp' })
    f.ctx.emit('team/changed', teamEventSchema.parse({ type: 'activation/changed', binding, cursor: 2, createdAt: 2 }))
    await vi.waitFor(() => { expect(f.notifications).toHaveLength(2) })
    const channel = channelSnapshotSchema.parse({ manifest: { id: envelope.channelId, teamId,
      adapter: { type: 'direct', version: 3 }, viewPolicy: { type: 'directed', version: 1 },
      participants: [{ id: envelope.senderId, role: 'sender' }, { id: participant.id, role: 'worker' }], limits: {},
    }, phase: 'active', cursor: 1 })
    f.claim.mockResolvedValue({ binding, channel, envelopeId: envelope.id, delivery: envelope.delivery })
    const deliver = f.notifications.at(-1)
    if (deliver === undefined) throw new Error('Restored Link has no notification listener')
    await expect(deliver(envelope)).rejects.toThrow('no matching durable model input')
    expect(f.acknowledge).not.toHaveBeenCalled()
    await next.dispose()
  })
})
