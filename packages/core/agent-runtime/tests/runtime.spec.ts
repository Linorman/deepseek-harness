import { describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import {
  activationIdSchema,
  participantSnapshotSchema,
  teamIdSchema,
} from '@clocky/clocky-team'
import AgentRuntime, {
  AgentRuntimeError,
  AgentRuntimeTerminationUnconfirmedError,
  isAgentRuntimeTerminationUnconfirmed,
} from '../src/index.ts'
import type {
  ActivationHandle,
  AgentRuntimeActivationRequest,
  AgentRuntimeFencer,
  AgentRuntimeProvider,
} from '../src/index.ts'

const teamId = teamIdSchema.parse('team-runtime')
const participant = participantSnapshotSchema.parse({
  id: 'participant-runtime',
  teamId,
  kind: 'local-agent',
  displayName: 'Runtime worker',
  role: 'worker',
  capabilities: [],
  phase: 'active',
})

function request(overrides: Partial<AgentRuntimeActivationRequest> = {}): AgentRuntimeActivationRequest {
  return {
    provider: 'in-process',
    teamId,
    participant,
    sessionId: 'session-runtime' as AgentRuntimeActivationRequest['sessionId'],
    seed: { kind: 'fresh' },
    agent: { options: { provider: 'mock', model: 'mock' } },
    signal: new AbortController().signal,
    ...overrides,
  }
}

function handle(overrides: Partial<ActivationHandle> = {}): ActivationHandle {
  return {
    activation: {
      id: activationIdSchema.parse('activation-runtime'),
      teamId,
      participantId: participant.id,
      status: 'running',
    },
    sessionId: request().sessionId,
    localAgent: undefined,
    async health() { return this.activation },
    onStatus() { return () => {} },
    interrupt() {},
    async dispose() {},
    ...overrides,
  }
}

function provider(overrides: Partial<AgentRuntimeProvider> = {}): AgentRuntimeProvider {
  return {
    name: 'in-process',
    terminationMode: 'cooperative',
    async activate() { return handle() },
    ...overrides,
  }
}

async function setup(): Promise<{ ctx: Context; fiber: Context['fiber'] }> {
  const ctx = new Context()
  const fiber = await ctx.plugin(AgentRuntime)
  return { ctx, fiber }
}

describe('AgentRuntime service definition', () => {
  it('classifies a provider failure that cannot prove remote termination', () => {
    const error = new AgentRuntimeTerminationUnconfirmedError('remote endpoint did not confirm termination')
    expect(error).toMatchObject({ code: 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED' })
    expect(isAgentRuntimeTerminationUnconfirmed(error)).toBe(true)
    expect(isAgentRuntimeTerminationUnconfirmed(new AgentRuntimeError('other', 'AGENT_RUNTIME_PROVIDER_INVALID'))).toBe(false)
  })

  it('registers effect-scoped providers and keeps stale disposers from removing replacements', async () => {
    const { ctx, fiber } = await setup()
    const events: string[] = []
    ctx.on('agent-runtime/provider-added', (ref) => { events.push(`added:${ref.name}`) })
    ctx.on('agent-runtime/provider-removed', (ref) => { events.push(`removed:${ref.name}`) })
    const registered = provider()
    const dispose = ctx.agentRuntimes.registerProvider(registered)
    expect(ctx.agentRuntimes.getProvider('in-process')).toBe(registered)
    expect(ctx.agentRuntimes.listProviders()).toEqual([{ name: 'in-process' }])
    expect(() => ctx.agentRuntimes.registerProvider(registered)).toThrow(expect.objectContaining<Partial<AgentRuntimeError>>({
      code: 'AGENT_RUNTIME_PROVIDER_DUPLICATE',
    }))

    const internals = ctx.agentRuntimes as unknown as { providers: Map<string, AgentRuntimeProvider> }
    const replacement = provider()
    internals.providers.set('in-process', replacement)
    dispose()
    expect(ctx.agentRuntimes.getProvider('in-process')).toBe(replacement)
    internals.providers.clear()
    expect(events).toEqual(['added:in-process'])
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('registers effect-scoped stale-epoch fencers without treating them as activation providers', async () => {
    const { ctx, fiber } = await setup()
    const fence = vi.fn(async () => {})
    const registered: AgentRuntimeFencer = { provider: 'sdk', validate() {}, fence }
    const dispose = ctx.agentRuntimes.registerFencer(registered)
    expect(ctx.agentRuntimes.getFencer('sdk')).toBe(registered)
    expect(() => ctx.agentRuntimes.registerFencer(registered)).toThrow(expect.objectContaining<Partial<AgentRuntimeError>>({
      code: 'AGENT_RUNTIME_FENCER_DUPLICATE',
    }))

    const internals = ctx.agentRuntimes as unknown as { fencers: Map<string, AgentRuntimeFencer> }
    const replacement: AgentRuntimeFencer = { provider: 'sdk', validate() {}, fence: async () => {} }
    internals.fencers.set('sdk', replacement)
    dispose()
    expect(ctx.agentRuntimes.getFencer('sdk')).toBe(replacement)
    internals.fencers.clear()
    expect(() => ctx.agentRuntimes.registerFencer({ provider: ' bad ', validate() {}, fence: async () => {} }))
      .toThrow(expect.objectContaining<Partial<AgentRuntimeError>>({ code: 'AGENT_RUNTIME_FENCER_INVALID' }))
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('removes the exact fencer instance when its effect is disposed', async () => {
    const { ctx, fiber } = await setup()
    const registered: AgentRuntimeFencer = { provider: 'sdk', validate() {}, fence: async () => {} }
    const dispose = ctx.agentRuntimes.registerFencer(registered)
    expect(ctx.agentRuntimes.getFencer('sdk')).toBe(registered)
    dispose()
    expect(ctx.agentRuntimes.getFencer('sdk')).toBeUndefined()
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('dispatches published and later observed activation status while containing listener failures', async () => {
    const { ctx, fiber } = await setup()
    ctx.on('agent-runtime/activation-changed', () => { throw new Error('observer failed') })
    ctx.on('agent-runtime/activation-changed', () => { throw Object.create(null) })
    // oxlint-disable-next-line typescript/no-misused-promises -- verifies containment of rejected observers.
    ctx.on('agent-runtime/activation-changed', () => Promise.reject(new Error('observer rejected')))
    const observed: ActivationHandle['activation'][] = []
    ctx.on('agent-runtime/activation-changed', function (activation) {
      expect(this).toBeInstanceOf(AgentRuntime)
      expect(Object.isFrozen(activation)).toBe(true)
      observed.push(activation)
    })
    let emitStatus: ((activation: ActivationHandle['activation']) => void) | undefined
    const unsubscribe = vi.fn()
    const monitored = handle({
      onStatus(listener) {
        emitStatus = listener
        return unsubscribe
      },
    })
    const registered = provider({ async activate() { return monitored } })
    ctx.agentRuntimes.registerProvider(registered)
    const activated = await ctx.agentRuntimes.activate(request())
    expect(activated.activation).toMatchObject({ id: 'activation-runtime', status: 'running' })
    expect(observed).toEqual([expect.objectContaining({ participantId: participant.id, status: 'running' })])
    if (emitStatus === undefined) throw new Error('AgentRuntime did not subscribe to handle status')
    emitStatus({ ...activated.activation, status: 'running' })
    emitStatus({ ...activated.activation, status: 'starting' })
    expect(observed).toHaveLength(1)
    emitStatus({ ...activated.activation, status: 'idle' })
    emitStatus({ ...activated.activation, status: 'offline' })
    expect(observed).toEqual([
      expect.objectContaining({ status: 'running' }),
      expect.objectContaining({ status: 'idle' }),
      expect.objectContaining({ status: 'offline' }),
    ])
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    emitStatus({ ...activated.activation, id: activationIdSchema.parse('other-activation'), status: 'running' })
    await Promise.resolve()
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('announces a shared handle once across repeated activation requests', async () => {
    const { ctx, fiber } = await setup()
    const shared = handle()
    let observed = 0
    ctx.on('agent-runtime/activation-changed', () => { observed += 1 })
    ctx.agentRuntimes.registerProvider(provider({ async activate() { return shared } }))
    const [first, second] = await Promise.all([
      ctx.agentRuntimes.activate(request()),
      ctx.agentRuntimes.activate(request()),
    ])
    expect(first).toBe(shared)
    expect(second).toBe(shared)
    expect(observed).toBe(1)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects missing providers and provider handles that disagree with the request binding', async () => {
    const { ctx, fiber } = await setup()
    await expect(ctx.agentRuntimes.activate(request())).rejects.toMatchObject({
      code: 'AGENT_RUNTIME_PROVIDER_NOT_FOUND',
    })
    await expect(ctx.agentRuntimes.activate(request({ participant: { ...participant, teamId: teamIdSchema.parse('other-team') } })))
      .rejects.toMatchObject({ code: 'AGENT_RUNTIME_ACTIVATION_MISMATCH' })

    let activationMismatchDisposals = 0
    ctx.agentRuntimes.registerProvider(provider({
      async activate() {
        return handle({ activation: { ...handle().activation, participantId: participantSnapshotSchema.parse({
          ...participant, id: 'other-participant',
        }).id }, async dispose() { activationMismatchDisposals += 1 } })
      },
    }))
    await expect(ctx.agentRuntimes.activate(request())).rejects.toMatchObject({
      code: 'AGENT_RUNTIME_ACTIVATION_MISMATCH',
    })
    expect(activationMismatchDisposals).toBe(1)

    const sessionMismatch = await setup()
    let sessionMismatchDisposals = 0
    sessionMismatch.ctx.agentRuntimes.registerProvider(provider({
      async activate() {
        return handle({
          sessionId: 'another-session' as ActivationHandle['sessionId'],
          async dispose() {
            sessionMismatchDisposals += 1
            throw new Error('cleanup failed')
          },
        })
      },
    }))
    await expect(sessionMismatch.ctx.agentRuntimes.activate(request())).rejects.toMatchObject({
      code: 'AGENT_RUNTIME_ACTIVATION_MISMATCH',
    })
    expect(sessionMismatchDisposals).toBe(1)
    await sessionMismatch.fiber.dispose()
    await sessionMismatch.ctx.fiber.dispose()
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it.each(['offline', 'stopping'] as const)('rejects a provider that publishes %s as the initial status', async (status) => {
    const { ctx, fiber } = await setup()
    let disposed = 0
    ctx.agentRuntimes.registerProvider(provider({
      async activate() {
        return handle({
          activation: { ...handle().activation, status },
          async dispose() { disposed += 1 },
        })
      },
    }))

    await expect(ctx.agentRuntimes.activate(request())).rejects.toMatchObject({
      code: 'AGENT_RUNTIME_ACTIVATION_STATUS_INVALID',
    })
    expect(disposed).toBe(1)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects a provider status observed before initial publication', async () => {
    const { ctx, fiber } = await setup()
    const unobserved = handle()
    const runtime = ctx.agentRuntimes as unknown as {
      observeStatus(handle: ActivationHandle, initial: ActivationHandle['activation'], next: ActivationHandle['activation']): void
    }
    expect(() => runtime.observeStatus(unobserved, unobserved.activation, { ...unobserved.activation, status: 'idle' })).not.toThrow()
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects malformed provider names before publishing a registry entry', async () => {
    const { ctx, fiber } = await setup()
    expect(() => ctx.agentRuntimes.registerProvider(provider({ name: ' bad ' }))).toThrow(expect.objectContaining<Partial<AgentRuntimeError>>({
      code: 'AGENT_RUNTIME_PROVIDER_INVALID',
    }))
    expect(ctx.agentRuntimes.listProviders()).toEqual([])
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
