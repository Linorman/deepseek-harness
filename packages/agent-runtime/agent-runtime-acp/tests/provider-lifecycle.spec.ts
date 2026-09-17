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
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import LocalSubprocessRuntime from '@clocky/clocky-subprocess-local'
import type { ProcessInspector } from '@clocky/clocky-subprocess-local'
import {
  activationBindingSnapshotSchema,
  channelSnapshotSchema,
  envelopeIdSchema,
  participantSnapshotSchema,
  teamEnvelopeSchema,
  teamEventSchema,
  teamIdSchema,
} from '@clocky/clocky-team'
import type { ActivationBindingSnapshot, ChannelDeliveryClaim, TeamChannelViewEventData, TeamEnvelope } from '@clocky/clocky-team'
import type { TeamLink, TeamLinkConnectRequest } from '@clocky/clocky-team-link'
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
): Promise<Context> {
  const ctx = new Context()
  contexts.add(ctx)
  if (teamLinks !== undefined) ctx.provide('teamLinks', teamLinks as never)
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
async function supervisedSetup(admit?: (binding: ActivationBindingSnapshot) => Promise<void>) {
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
    processTree: pid => [{ pid, started: 'controlled-creation-identity' }],
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

describe('ACP AgentRuntime provider lifecycle', () => {
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
    expect(first.localAgent).toBeUndefined()
    expect(first.activation).toMatchObject({ teamId, participantId: participant.id, status: 'idle' })

    const statuses: string[] = []
    first.onStatus((next) => { statuses.push(next.status) })
    first.interrupt({ kind: 'user' })
    await Promise.all([first.dispose(), first.dispose()])

    expect(statuses).toEqual(['stopping', 'offline'])
    expect(existsSync(flushed)).toBe(true)
    await expect(first.health()).resolves.toMatchObject({ status: 'offline' })
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

    await expect(handle.dispose()).resolves.toBeUndefined()
    await expect(handle.health()).resolves.toMatchObject({ status: 'offline' })
  })

  it('aborts a stalled ACP session handshake and reaps the unpublished child', async () => {
    const root = await freshRoot()
    const ready = join(root, 'new-session-ready')
    const go = join(root, 'new-session-go')
    const controller = new AbortController()
    const ctx = await setup({ MOCK_NEWSESSION_READY: ready, MOCK_NEWSESSION_GO: go }, 200)
    const activation = ctx.agentRuntimes.activate(request(SessionId('acp-runtime-abort-session'), controller.signal))
    await waitForFile(ready)

    const reason = new Error('cancel ACP startup')
    controller.abort(reason)
    await expect(activation).rejects.toBe(reason)
  })

  it('waits for an in-flight enrollment to revoke its credential before disposal settles', async () => {
    const reserved = Promise.withResolvers<{
      provider: string
      endpoint: string
      capability: string
      revoke: () => Promise<void>
    }>()
    const revoked = Promise.withResolvers<undefined>()
    const revoke = vi.fn(async () => { revoked.resolve(undefined) })
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

    deliveryClaim = { ...validClaim, view: { ...view, adapter: { type: 'wrong-adapter', version: 1 } } }
    await expect(deliver(envelope)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(prompt).toHaveBeenCalledOnce()
    expect(acknowledge).toHaveBeenCalledTimes(3)

    await handle.dispose()
    expect(revoke).toHaveBeenCalledOnce()
  })
})
