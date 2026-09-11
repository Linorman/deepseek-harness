import { createUserMessage } from '@clocky/clocky-llm'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import AgentRegistry, { type Agent } from '@clocky/clocky-agent'
import AgentLoop from '@clocky/clocky-agent-loop'
import LlmRuntime, { type Message, type UserMessage } from '@clocky/clocky-llm'
import SessionStore, { SessionId } from '@clocky/clocky-session'
import type { TeamChannelViewEventData } from '@clocky/clocky-session'
import SystemPrompt from '@clocky/clocky-system-prompt'
import ToolRuntime from '@clocky/clocky-tools'
import { MockAdapter, textResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

function isUserMessage(message: Message | null): message is UserMessage {
  return message !== null && message.role === 'user'
}

/** Build one exact non-direct Team channel view that has already entered a Session. */
function teamChannelView(): TeamChannelViewEventData {
  return {
    teamId: 'team-loop-view',
    channelId: 'channel-loop-view',
    adapter: { type: 'discussion', version: 1 },
    viewPolicy: { type: 'recent-window', version: 1 },
    triggeringEnvelopeId: 'envelope-loop-view',
    sourceEnvelopeIds: ['envelope-loop-view'],
    delivery: 'turn',
    content: [{ type: 'text', text: 'Persisted Team view.' }],
  }
}

describe('Agent', () => {
  it('idle inject() durably stages context without opening a turn', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    agent.inject(createUserMessage({ content: [{ type: 'text', text: 'context' }], source: { kind: 'plugin', plugin: 'p' } }))

    expect(agent.session.events.map(event => event.type)).toEqual(['agent/inbox/spliced'])
    expect(agent.status).toBe('idle')
    expect(adapter.requests).toHaveLength(0)
    await agent.whenIdle()
  })

  it('inject() preserves an explicitly empty plugin source', async () => {
    const ctx = await harness(new MockAdapter([textResponse('ok')]))
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    agent.inject(createUserMessage({ content: [{ type: 'text', text: 'empty plugin source' }], source: { kind: 'plugin', plugin: '' } }))

    const injected = agent.session.events.at(-1)
    expect(injected?.type === 'agent/inbox/spliced' && injected.data.inserted[0]?.source)
      .toEqual({ kind: 'plugin', plugin: '' })
  })

  it('emits exact inserted, claimed, and discarded inbox messages', async () => {
    const ctx = await harness(new MockAdapter([textResponse('ok')]))
    const agent = ctx.agentLoop.create(SessionId('inbox-events'), { provider: 'mock', model: 'mock' })
    const inserted: unknown[] = []
    const claimed: unknown[] = []
    const discarded: unknown[] = []
    const lifecycle: string[] = []
    ctx.on('session/event', (session, event) => {
      if (session === agent.session && event.type === 'turn/start') lifecycle.push('turn/start')
    })
    ctx.on('agent/inbox/inserted', ({ agent: subject, message }) => {
      if (subject === agent) inserted.push({ message })
    })
    ctx.on('agent/inbox/claimed', ({ agent: subject, message, turn }) => {
      if (subject === agent) {
        lifecycle.push('agent/inbox/claimed')
        claimed.push({ message, turn })
      }
    })
    ctx.on('agent/inbox/discarded', ({ agent: subject, message }) => {
      if (subject === agent) discarded.push({ message })
    })
    const context = createUserMessage({
      content: [{ type: 'text', text: 'discard me' }],
      source: { kind: 'plugin', plugin: 'test' },
    })
    agent.inject(context)
    agent.inbox.remove(context.id)
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'run' }], source: { kind: 'user' } })
    agent.followup(prompt)
    await agent.whenIdle()

    expect(inserted).toEqual([{ message: context }, { message: prompt }])
    expect(discarded).toEqual([{ message: context }])
    expect(claimed).toEqual([{ message: prompt, turn: 1 }])
    expect(lifecycle).toEqual(['turn/start', 'agent/inbox/claimed'])
  })

  it('idle inject() rejects invalid input before enqueue', async () => {
    const ctx = await harness(new MockAdapter([textResponse('ok')]))
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    expect(() => {
      agent.inject(createUserMessage({ content: [{ type: 'text', text: 'x', bad: 1n } as never], source: { kind: 'plugin', plugin: 'p' } }))
    }).toThrow(/non-JSON-serializable/)
    expect(agent.session.events).toHaveLength(0)
  })

  it('steer() while idle becomes a woken prompt turn', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    agent.steer(createUserMessage({ content: [{ type: 'text', text: 'steer idle' }], source: { kind: 'plugin', plugin: 'test' } }))
    await agent.whenIdle()

    expect(agent.session.events.some(event => event.type === 'user/message')).toBe(true)
    expect(adapter.requests).toHaveLength(1)
  })

  it('uses a persisted Team channel view without appending a second user/message', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('team-channel-view'), { provider: 'mock', model: 'mock' })
    const event = agent.session.append('team/channel-view', teamChannelView(), { surfaceOp: 'append' })
    const message = agent.session.deriveEventMessage(event)
    if (!isUserMessage(message)) {
      throw new Error('Team channel-view event did not derive a user message')
    }
    if (message.source.kind !== 'team-channel-view') {
      throw new Error('Team channel-view event did not derive a Team channel-view source')
    }
    const userMessage: UserMessage = message

    agent.followup(userMessage)
    await agent.whenIdle()

    expect(adapter.requests[0]?.messages).toEqual([userMessage])
    expect(agent.session.events.filter(candidate => candidate.type === 'user/message')).toHaveLength(0)
  })

  it('rejects an unlogged Team channel view instead of silently omitting it from history', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('unlogged-team-channel-view'), { provider: 'mock', model: 'mock' })
    const failures: Error[] = []
    ctx.on('agent/error', ({ agent: subject, error }) => {
      if (subject === agent && error instanceof Error) failures.push(error)
    })
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Forged view.' }],
      source: {
        kind: 'team-channel-view',
        teamId: 'team-loop-view',
        channelId: 'channel-loop-view',
        adapter: { type: 'discussion', version: 1 },
        viewPolicy: { type: 'recent-window', version: 1 },
        triggeringEnvelopeId: 'envelope-loop-view',
        sourceEnvelopeIds: ['envelope-loop-view'],
        delivery: 'turn',
      },
    }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(0)
    expect(failures.map(error => error.message)).toEqual([
      'agent "unlogged-team-channel-view" received a Team channel view that is absent from its Session',
    ])
    expect(agent.session.events.filter(candidate => candidate.type === 'user/message')).toHaveLength(0)
  })

  it('emits one running and idle transition for one completed turn', async () => {
    const ctx = await harness(new MockAdapter([textResponse('ok')]))
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    const statuses: string[] = []
    ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent) statuses.push(status)
    })

    send(agent, 'hi')
    await agent.whenIdle()

    expect(statuses).toEqual(['running', 'idle'])
  })

  it('whenIdle() resolves immediately without active work', async () => {
    const ctx = await harness(new MockAdapter([textResponse('ok')]))
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    await agent.whenIdle()

    expect(agent.status).toBe('idle')
  })

  it('whenIdle() waits for active work until explicit cancellation', async () => {
    const ctx = await harness(new MockAdapter(['hang']))
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    send(agent, 'queued')
    let settled = false
    const idle = agent.whenIdle().then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    agent.cancel({ kind: 'user' })
    await idle
    expect(agent.status).toBe('idle')
  })

  it('contains a throwing status listener on both transitions', async () => {
    const ctx = await harness(new MockAdapter([textResponse('ok')]))
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/status', ({ status }) => {
      throw new Error(`bad ${status} listener`)
    })

    send(agent, 'go')
    await agent.whenIdle()

    expect(agent.status).toBe('idle')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('agent event "agent/status" listener threw'),
    )
  })
})
