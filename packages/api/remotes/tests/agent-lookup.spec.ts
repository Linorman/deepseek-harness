import { describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import AgentRegistry from '@clocky/clocky-agent'
import type { Agent } from '@clocky/clocky-agent'
import SessionStore from '@clocky/clocky-session'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@clocky/clocky-session'
import { createApiRemoteAgentResolver } from '@clocky/clocky-api-remotes'
import { TypertLookupFailure } from '@clocky/clocky-typert-protocol'
import TypertRegistry from '@clocky/clocky-typert-registry'

const sid = (value: string): SessionId => value as SessionId

function header(id: SessionId, overrides: Partial<Omit<SessionHeader, 'id'>> = {}): SessionHeader {
  return { version: 0, id, createdAt: 1, cwd: '/proj', ...overrides }
}

async function createContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  return ctx
}

function provideSession(
  ctx: Context,
  meta: SessionHeader,
  inspect: () => Promise<{ meta: SessionHeader; events: SessionEvent[] }>,
): void {
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve([meta]),
    inspect,
    locate: () => undefined,
  } as never)
}

function stubAgent(ctx: Context, session: Session): Agent {
  return { id: session.id, session, status: 'idle', ctx } as Agent
}

/** Mark a live session with the durable subagent identity used by the owner fence. */
function markSubagent(session: Session): void {
  const append = session.append.bind(session) as unknown as (type: string, data: unknown) => void
  append('subagent/descriptor', {
    version: 3, mode: 'continuable', provider: 'test', depth: 1, label: 'test child',
  })
}

describe('API Remote Agent resolver races', () => {
  it('maps an inspected session without a cwd to session-not-found', async () => {
    const ctx = await createContext()
    const sessionId = sid('missing-after-inspect')
    const meta = header(sessionId)
    provideSession(ctx, meta, () => Promise.resolve({
      meta: { ...meta, cwd: undefined } as unknown as SessionHeader,
      events: [],
    }))

    const result = await createApiRemoteAgentResolver(ctx, {})(sessionId)

    expect(result).toMatchObject({ error: { code: 'session-not-found', details: { sessionId } } })
    await ctx.fiber.dispose()
  })

  it('resumes through a concurrently attached ordinary Session without optional defaults', async () => {
    const ctx = await createContext()
    const sessionId = sid('ordinary-attach-race')
    const meta = header(sessionId)
    let published: Session | undefined
    provideSession(ctx, meta, () => {
      published = ctx.sessions.create(sessionId, { meta: { cwd: '/proj' } })
      return Promise.resolve({ meta, events: [] })
    })
    const resume = vi.spyOn(ctx.agents, 'resume').mockImplementation(async () => {
      if (published === undefined) throw new Error('Session was not published')
      return { agent: stubAgent(ctx, published), dispose: () => Promise.resolve() }
    })

    const result = await createApiRemoteAgentResolver(ctx, {})(sessionId)

    expect(result).toMatchObject({ agent: { id: sessionId } })
    expect(resume).toHaveBeenCalledWith({ resumeSessionId: sessionId })
    await ctx.fiber.dispose()
  })

  it('rejects a subagent Session published after durable inspection', async () => {
    const ctx = await createContext()
    const sessionId = sid('owned-attach-race')
    const meta = header(sessionId)
    provideSession(ctx, meta, () => {
      const session = ctx.sessions.create(sessionId, { meta: { cwd: '/proj' } })
      markSubagent(session)
      return Promise.resolve({ meta, events: [] })
    })
    const resume = vi.spyOn(ctx.agents, 'resume')

    const result = await createApiRemoteAgentResolver(ctx, {})(sessionId)

    expect(result).toMatchObject({ error: { code: 'agent-busy' } })
    expect(resume).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('keeps Team-provenanced sessions out of generic cold resume and Typert lookup', async () => {
    const ctx = await createContext()
    const sessionId = sid('team-cold-session')
    const meta = header(sessionId, { teamId: 'team-1', participantId: 'participant-1' })
    provideSession(ctx, meta, () => Promise.resolve({ meta, events: [] }))
    const resume = vi.spyOn(ctx.agents, 'resume')
    const resolver = createApiRemoteAgentResolver(ctx, {})

    await expect(resolver(sessionId)).resolves.toMatchObject({
      error: { code: 'team-run-unavailable', details: {} },
    })
    expect(resume).not.toHaveBeenCalled()

    const lookup = ctx.typert.lookups.get('agent')
    if (lookup === undefined) throw new Error('Agent lookup was not configured')
    await expect(lookup.resolve(sessionId)).rejects.toMatchObject({
      failure: { code: 'team-run-unavailable', details: {} },
    })
    expect(resume).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('reclassifies failed resumes after a live or attached subagent wins publication', async () => {
    for (const winner of ['agent', 'session'] as const) {
      const ctx = await createContext()
      const sessionId = sid(`owned-${winner}-resume-race`)
      const meta = header(sessionId)
      provideSession(ctx, meta, () => Promise.resolve({ meta, events: [] }))
      vi.spyOn(ctx.agents, 'resume').mockImplementationOnce(async () => {
        const session = ctx.sessions.create(sessionId, { meta: { cwd: '/proj' } })
        markSubagent(session)
        if (winner === 'agent') ctx.agents.register(stubAgent(ctx, session))
        throw new Error('session id already published')
      })

      const result = await createApiRemoteAgentResolver(ctx, {})(sessionId)

      expect(result).toMatchObject({ error: { code: 'agent-busy' } })
      await ctx.fiber.dispose()
    }
  })

  it('uses the shared cold-resume policy for the Agent Host Context', async () => {
    const ctx = await createContext()
    const sessionId = sid('context-cold-resume')
    const meta = header(sessionId)
    let published: Session | undefined
    provideSession(ctx, meta, () => {
      published = ctx.sessions.create(sessionId, { meta: { cwd: '/proj' } })
      return Promise.resolve({ meta, events: [] })
    })
    const agentCtx = ctx.extend()
    vi.spyOn(ctx.agents, 'resume').mockImplementation(async () => {
      if (published === undefined) throw new Error('Session was not published')
      return { agent: stubAgent(agentCtx, published), dispose: () => Promise.resolve() }
    })
    const defaultProvider = ctx.typert.contexts.getHost('agent')
    createApiRemoteAgentResolver(ctx, {})
    await vi.waitFor(() => { expect(ctx.typert.contexts.getHost('agent')).not.toBe(defaultProvider) })
    const provider = ctx.typert.contexts.getHost('agent')
    if (provider === undefined) throw new Error('Agent Host Context provider was not mounted')

    await expect(provider.resolve(sessionId)).resolves.toBe(agentCtx)
    await ctx.fiber.dispose()
  })

  it('applies the subagent ownership fence to the Agent Host Context', async () => {
    const ctx = await createContext()
    const sessionId = sid('context-owned-subagent')
    const session = ctx.sessions.create(sessionId, { meta: { cwd: '/proj' } })
    markSubagent(session)
    ctx.agents.register(stubAgent(ctx.extend(), session))
    const defaultProvider = ctx.typert.contexts.getHost('agent')
    createApiRemoteAgentResolver(ctx, {})
    await vi.waitFor(() => { expect(ctx.typert.contexts.getHost('agent')).not.toBe(defaultProvider) })
    const provider = ctx.typert.contexts.getHost('agent')
    if (provider === undefined) throw new Error('Agent Host Context provider was not mounted')

    const resolution = provider.resolve(sessionId)
    await expect(resolution).rejects.toBeInstanceOf(TypertLookupFailure)
    await expect(resolution).rejects.toMatchObject({ failure: { code: 'agent-busy' } })
    await ctx.fiber.dispose()
  })
})
