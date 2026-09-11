import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import Include from '@clocky/cordis-plugin-include'
import Loader from '@clocky/cordis-plugin-loader'
import { assembleContextFor } from '@clocky/clocky-agent'
import AgentLoop from '@clocky/clocky-agent-loop'
import { mountAgentLoopTestDependencies } from '@clocky/clocky-agent-loop-testkit'
import AgentPresets from '@clocky/clocky-agent-presets'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import type { AgentRuntimeActivationRequest } from '@clocky/clocky-agent-runtime'
import { createUserMessage, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { SessionId } from '@clocky/clocky-session'
import type { SessionEvent } from '@clocky/clocky-session'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import { participantSnapshotSchema, teamIdSchema } from '@clocky/clocky-team'
import * as InProcessRuntime from '../src/index.ts'

const contexts = new Set<Context>()
const roots: string[] = []
const agentLoopFibers = new WeakMap<Context, Context['fiber']>()
const teamId = teamIdSchema.parse('team-in-process')
const participant = participantSnapshotSchema.parse({
  id: 'participant-in-process',
  teamId,
  kind: 'local-agent',
  displayName: 'In-process worker',
  role: 'worker',
  capabilities: [],
  phase: 'active',
})
const secondParticipant = participantSnapshotSchema.parse({
  ...participant,
  id: 'participant-in-process-second',
  displayName: 'Second in-process worker',
})
const completedTurnSeed: readonly SessionEvent[] = [
  { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
  { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
]
const sourceSessionId = SessionId('activation-fork-source')
const collisionTeamA = teamIdSchema.parse('a')
const collisionTeamB = teamIdSchema.parse('a\u0000b')
const collisionParticipantA = participantSnapshotSchema.parse({
  ...participant,
  id: 'b\u0000c',
  teamId: collisionTeamA,
})
const collisionParticipantB = participantSnapshotSchema.parse({
  ...participant,
  id: 'c',
  teamId: collisionTeamB,
})
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const PRESET_ROOTS = [{ path: join(FIXTURES, 'presets'), trust: 'system' as const }]

/** Adapter whose first stream remains active until the provider interrupts it. */
class HangingAdapter extends LlmAdapter {
  readonly started = Promise.withResolvers<undefined>()

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.started.resolve(undefined)
    await new Promise<void>((_resolve, reject) => {
      const abort = (): Error => options.signal?.reason instanceof Error
        ? options.signal.reason
        : new Error('test stream aborted', { cause: options.signal?.reason })
      if (options.signal?.aborted === true) {
        reject(abort())
        return
      }
      options.signal?.addEventListener('abort', () => { reject(abort()) }, { once: true })
    })
  }
}

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
  for (const root of roots.splice(0)) {
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'in-process AgentRuntime test cleanup failed')
})

/** Mount an Agent factory, activation registry, and local provider. */
async function setup(options: {
  readonly persistenceRoot?: string
  readonly adapter?: LlmAdapter
  readonly presets?: boolean
} = {}): Promise<Context> {
  const ctx = new Context()
  contexts.add(ctx)
  if (options.presets) {
    ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
  }
  await mountAgentLoopTestDependencies(ctx)
  if (options.adapter !== undefined) ctx.llm.registerAdapter(['mock'], options.adapter)
  const persistenceRoot = options.persistenceRoot ?? await freshRoot()
  await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
  const agentLoopFiber = await ctx.plugin(AgentLoop, { agents: [] })
  agentLoopFibers.set(ctx, agentLoopFiber)
  if (options.presets) {
    await ctx.plugin(AgentPresets, { default: 'coordinator', roots: PRESET_ROOTS, includeUserRoot: false })
  }
  await ctx.plugin(AgentRuntime)
  await ctx.plugin(InProcessRuntime, { providerName: 'in-process' })
  return ctx
}

/** Build one Team-resolved activation request for a unique Session. */
function request(
  sessionId: ReturnType<typeof SessionId>,
  overrides: Partial<AgentRuntimeActivationRequest> = {},
): AgentRuntimeActivationRequest {
  return {
    provider: 'in-process',
    teamId,
    participant,
    sessionId,
    seed: { kind: 'fresh' },
    agent: { options: { provider: 'mock', model: 'mock' } },
    signal: new AbortController().signal,
    ...overrides,
  }
}

/** Create a project-local durable root for a resume test. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'agent-runtime-in-process-'))
  roots.push(root)
  return root
}

describe('in-process AgentRuntime provider', () => {
  it('publishes a fresh activation, shares a concurrent participant activation, interrupts, and releases its Agent', async () => {
    const ctx = await setup()
    const sessionId = SessionId('activation-fresh')
    const agent = { cwd: process.cwd(), options: { provider: 'mock', model: 'mock' } }
    const [first, second] = await Promise.all([
      ctx.agentRuntimes.activate(request(sessionId, { agent })),
      ctx.agentRuntimes.activate(request(sessionId, { agent })),
    ])
    expect(first).toBe(second)
    expect(first.activation).toMatchObject({ teamId, participantId: participant.id, status: 'idle' })
    expect(first.localAgent).toBe(ctx.agents.get(sessionId))
    await expect(first.health()).resolves.toMatchObject({
      teamId,
      participantId: participant.id,
      status: 'idle',
    })
    await expect(ctx.sessionPersistence.inspect(sessionId)).resolves.toMatchObject({
      meta: { teamId, participantId: participant.id, cwd: process.cwd() },
      events: [],
    })
    first.interrupt({ kind: 'user' })
    await Promise.all([first.dispose(), first.dispose()])
    first.interrupt({ kind: 'user' })
    expect(ctx.agents.get(sessionId)).toBeUndefined()

    const replacement = await ctx.agentRuntimes.activate(request(sessionId, { agent }))
    expect(replacement).not.toBe(first)
    expect(replacement.activation.id).not.toBe(first.activation.id)
    const replacementDisposal = replacement.dispose()
    await expect(replacement.health()).resolves.toMatchObject({ status: 'stopping' })
    await replacementDisposal
    await expect(replacement.health()).resolves.toMatchObject({ status: 'offline' })
  })

  it('uses a fork seed without a parent Agent', async () => {
    const ctx = await setup()
    const forked = await ctx.agentRuntimes.activate(request(SessionId('activation-fork'), {
      seed: { kind: 'fork', sourceSessionId, events: completedTurnSeed },
    }))
    expect(forked.localAgent?.session.events.map(event => event.type)).toEqual([
      'turn/start',
      'turn/end',
      'session/end-seed',
    ])
    expect(forked.localAgent?.session.header).toMatchObject({
      parentSession: sourceSessionId,
      seedLength: completedTurnSeed.length,
      teamId,
      participantId: participant.id,
    })
    await forked.dispose()
  })

  it('rejects a named preset when no preset roster is composed', async () => {
    const ctx = await setup()
    await expect(ctx.agentRuntimes.activate(request(SessionId('activation-preset'), {
      agent: { preset: 'worker', options: { provider: 'mock', model: 'mock' } },
    }))).rejects.toMatchObject({ code: 'AGENT_RUNTIME_IN_PROCESS_PRESET_UNAVAILABLE' })
    expect(ctx.agents.list()).toEqual([])
  })

  it('reports an unknown named preset as a typed provider failure', async () => {
    const ctx = await setup({ presets: true })
    await expect(ctx.agentRuntimes.activate(request(SessionId('activation-missing-preset'), {
      agent: { preset: 'missing', options: { provider: 'mock', model: 'mock' } },
    }))).rejects.toMatchObject({ code: 'AGENT_RUNTIME_IN_PROCESS_PRESET_UNAVAILABLE' })
    expect(ctx.agents.list()).toEqual([])
  })

  it('mounts a requested preset before publishing the local Agent', async () => {
    const ctx = await setup({ presets: true })
    const sessionId = SessionId('activation-preset')
    const activation = await ctx.agentRuntimes.activate(request(sessionId, {
      agent: { preset: 'coordinator', options: { provider: 'mock', model: 'mock' } },
    }))
    const agent = activation.localAgent
    if (agent === undefined) throw new Error('in-process provider did not publish its local Agent')
    expect(agent.session.header.agentPreset).toBe('coordinator')
    expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe('coordinator')
    expect(ctx.tools.schemas(agent).map(schema => schema.name)).toEqual(['coordinator'])
    const prompt = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(prompt.sections.map(section => section.name)).toContain('preset:coordinator')
    await expect(ctx.sessionPersistence.inspect(sessionId)).resolves.toMatchObject({
      meta: { agentPreset: 'coordinator' },
    })
    await activation.dispose()
  })

  it('rejects non-local Participants before allocating an Agent', async () => {
    const ctx = await setup()
    const human = participantSnapshotSchema.parse({
      ...participant,
      id: 'human-in-process',
      kind: 'human',
      owner: { kind: 'product-principal', principalId: 'product-principal-agent-runtime' },
    })
    await expect(ctx.agentRuntimes.activate(request(SessionId('activation-human'), {
      participant: human,
    }))).rejects.toMatchObject({ code: 'AGENT_RUNTIME_IN_PROCESS_PARTICIPANT_UNSUPPORTED' })
    expect(ctx.agents.list()).toEqual([])
  })

  it('does not inherit ambient parent-Agent ownership or fork lineage', async () => {
    const ctx = await setup()
    const parent = await ctx.agents.create({
      sessionId: SessionId('activation-parent'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const activation = await ctx.agents.withInitiator(parent.agent, () => {
      return ctx.agentRuntimes.activate(request(SessionId('activation-with-parent')))
    })
    expect(ctx.agents.isOwnedBy(activation.sessionId, parent.agent)).toBe(false)
    expect(activation.localAgent?.session.header.parentSession).toBeUndefined()
    await activation.dispose()
    await parent.dispose()
  })

  it('interrupts a running local Agent and waits for it to become idle', async () => {
    const adapter = new HangingAdapter()
    const ctx = await setup({ adapter })
    const activation = await ctx.agentRuntimes.activate(request(SessionId('activation-interrupt-running')))
    const agent = activation.localAgent
    if (agent === undefined) throw new Error('in-process provider did not publish its local Agent')
    const observed: string[] = []
    activation.onStatus((next) => { observed.push(next.status) })
    activation.onStatus(() => { throw new Error('status listener failure') })
    const unrenderable = new Error('unrenderable status listener failure')
    unrenderable.toString = () => { throw new Error('cannot render status listener failure') }
    activation.onStatus(() => { throw unrenderable })
    const unrelated = await ctx.agents.create({
      sessionId: SessionId('activation-unrelated-status'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    ctx.emit('agent/status', { agent: unrelated.agent, status: 'idle' })
    await unrelated.dispose()
    const idle = new Promise<void>((resolve) => {
      const dispose = ctx.on('agent/status', ({ agent: changed, status }) => {
        if (changed === agent && status === 'idle') {
          dispose()
          resolve()
        }
      })
    })
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'run until interrupted' }],
      source: { kind: 'user' },
    }))
    await adapter.started.promise
    expect(agent.status).toBe('running')
    expect(observed).toEqual(['running'])
    await expect(activation.health()).resolves.toMatchObject({ status: 'running' })
    activation.interrupt({ kind: 'user' })
    await idle
    expect(agent.status).toBe('idle')
    expect(observed).toEqual(['running', 'idle'])
    await expect(activation.health()).resolves.toMatchObject({ status: 'idle' })
    await activation.dispose()
    expect(observed).toEqual(['running', 'idle', 'stopping', 'offline'])
    const afterOffline = activation.onStatus(() => { throw new Error('offline listener must not register') })
    afterOffline()
  })

  it('cold-resumes a persisted local Session into a new activation epoch', async () => {
    const root = await freshRoot()
    const first = await setup({ persistenceRoot: root, presets: true })
    const sessionId = SessionId('activation-resume')
    const agent = { preset: 'coordinator', options: { provider: 'mock', model: 'mock' } }
    const firstActivation = await first.agentRuntimes.activate(request(sessionId, { agent }))
    await expect(first.sessionPersistence.inspect(sessionId)).resolves.toMatchObject({
      meta: { teamId, participantId: participant.id, agentPreset: 'coordinator' },
      events: [],
    })
    await firstActivation.dispose()
    await first.fiber.dispose()
    contexts.delete(first)

    const second = await setup({ persistenceRoot: root, presets: true })
    const resumed = await second.agentRuntimes.activate(request(sessionId, { seed: { kind: 'resume' }, agent }))
    expect(resumed.localAgent?.id).toBe(sessionId)
    expect(second.agentPresets.composedPreset(resumed.localAgent!.ctx)).toBe('coordinator')
    expect(resumed.activation.id).not.toBe(firstActivation.activation.id)
    await resumed.dispose()
  })

  it('restores two independent Participant epochs without parent Session ownership', async () => {
    const root = await freshRoot()
    const first = await setup({ persistenceRoot: root })
    const firstSession = SessionId('activation-two-first')
    const secondSession = SessionId('activation-two-second')
    const [firstActivation, secondActivation] = await Promise.all([
      first.agentRuntimes.activate(request(firstSession)),
      first.agentRuntimes.activate(request(secondSession, { participant: secondParticipant })),
    ])
    expect(firstActivation.localAgent?.session.header.parentSession).toBeUndefined()
    expect(secondActivation.localAgent?.session.header.parentSession).toBeUndefined()
    await Promise.all([firstActivation.dispose(), secondActivation.dispose()])
    await first.fiber.dispose()
    contexts.delete(first)

    const second = await setup({ persistenceRoot: root })
    const [resumedFirst, resumedSecond] = await Promise.all([
      second.agentRuntimes.activate(request(firstSession, { seed: { kind: 'resume' } })),
      second.agentRuntimes.activate(request(secondSession, {
        participant: secondParticipant,
        seed: { kind: 'resume' },
      })),
    ])
    expect(resumedFirst.localAgent?.id).toBe(firstSession)
    expect(resumedSecond.localAgent?.id).toBe(secondSession)
    await Promise.all([resumedFirst.dispose(), resumedSecond.dispose()])
  })

  it('rejects a persisted Session bound to another Team participant before publication', async () => {
    const root = await freshRoot()
    const first = await setup({ persistenceRoot: root })
    const sessionId = SessionId('activation-wrong-provenance')
    const wrong = await first.agents.create({
      sessionId,
      meta: { teamId: 'another-team', participantId: 'another-participant' },
      seed: completedTurnSeed,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await first.sessions.flush(wrong.agent.session)
    await wrong.dispose()
    await first.fiber.dispose()
    contexts.delete(first)

    const second = await setup({ persistenceRoot: root })
    await expect(second.agentRuntimes.activate(request(sessionId, { seed: { kind: 'resume' } })))
      .rejects.toMatchObject({ code: 'AGENT_RUNTIME_IN_PROCESS_SESSION_PROVENANCE_MISMATCH' })
    expect(second.agents.get(sessionId)).toBeUndefined()
  })

  it('rejects another Session for an active participant', async () => {
    const ctx = await setup()
    const active = await ctx.agentRuntimes.activate(request(SessionId('activation-first-session')))
    await expect(ctx.agentRuntimes.activate(request(SessionId('activation-second-session'))))
      .rejects.toMatchObject({ code: 'AGENT_RUNTIME_IN_PROCESS_SESSION_MISMATCH' })
    await active.dispose()
  })

  it('keeps NUL-containing Team and Participant identities in separate activation slots', async () => {
    const ctx = await setup()
    const first = await ctx.agentRuntimes.activate(request(SessionId('activation-nul-first'), {
      teamId: collisionTeamA,
      participant: collisionParticipantA,
    }))
    const second = await ctx.agentRuntimes.activate(request(SessionId('activation-nul-second'), {
      teamId: collisionTeamB,
      participant: collisionParticipantB,
    }))
    expect(second).not.toBe(first)
    await Promise.all([first.dispose(), second.dispose()])
  })

  it('releases a failed activation attempt so the participant can be retried', async () => {
    const ctx = await setup()
    const sessionId = SessionId('activation-aborted')
    await expect(ctx.agentRuntimes.activate(request(sessionId, {
      signal: AbortSignal.abort(new Error('test cancellation')),
    }))).rejects.toThrow('test cancellation')
    const retried = await ctx.agentRuntimes.activate(request(sessionId))
    await retried.dispose()
  })

  it('releases a structurally disposed Agent slot before AgentLoop reload reactivates it', async () => {
    const ctx = await setup()
    const sessionId = SessionId('activation-loop-reload')
    const first = await ctx.agentRuntimes.activate(request(sessionId))
    await agentLoopFibers.get(ctx)!.dispose()
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    await expect(first.health()).resolves.toMatchObject({ status: 'offline' })

    const reloadedLoop = await ctx.plugin(AgentLoop, { agents: [] })
    agentLoopFibers.set(ctx, reloadedLoop)
    const replacement = await ctx.agentRuntimes.activate(request(sessionId))
    expect(replacement).not.toBe(first)
    expect(ctx.agents.get(sessionId)).toBe(replacement.localAgent)
    await first.dispose()
    expect(await ctx.agentRuntimes.activate(request(sessionId))).toBe(replacement)
    await replacement.dispose()
  })

  it('closes provider admission on unload while a previously returned handle stays caller-owned', async () => {
    const ctx = await setup()
    const providerFiber = await ctx.plugin(InProcessRuntime, { providerName: 'secondary' })
    const active = await ctx.agentRuntimes.activate(request(SessionId('activation-provider-dispose'), {
      provider: 'secondary',
    }))
    const provider = ctx.agentRuntimes.getProvider('secondary')
    expect(provider).toBeDefined()
    await providerFiber.dispose()
    expect(ctx.agentRuntimes.getProvider('secondary')).toBeUndefined()
    await expect(provider!.activate(request(SessionId('activation-provider-closed'), {
      provider: 'secondary',
    }))).rejects.toMatchObject({ code: 'AGENT_RUNTIME_IN_PROCESS_CLOSED' })
    expect(active.localAgent).toBeDefined()
    expect(ctx.agents.get(active.sessionId)).toBe(active.localAgent)
    await active.dispose()
  })
})
