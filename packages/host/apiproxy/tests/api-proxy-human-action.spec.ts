import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import AgentRegistry, { type Agent } from '@clocky/clocky-agent'
import SessionStore from '@clocky/clocky-session'
import SystemPrompt from '@clocky/clocky-system-prompt'
import UserQuestionService from '@clocky/clocky-user-questions'
import ApprovalService from '@clocky/clocky-user-approval'
import { TeamError } from '@clocky/clocky-team'
import type {
  ParticipantId,
  TeamHumanActionResolveRequest,
  TeamHumanActionSnapshot,
  TeamHumanActionUpsertRequest,
  TeamId,
  TeamStateSnapshot,
  TeamSystemHumanActionProof,
  TeamSystemHumanActionProofSource,
  TeamSystemHumanActionScope,
} from '@clocky/clocky-team'
import type { ApiProxy, MuxFrame, RpcRequest } from '@clocky/clocky-host-apiproxy/api'
import { RpcId } from '@clocky/clocky-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'
import { withAuthenticatedProductCall } from '../src/authenticated-product-call.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'

type RequestedFrame = Extract<MuxFrame, { type: 'question/requested' | 'approval/requested' }>

const productCall = {
  principal: {
    id: 'human-action-product-principal' as never,
    issuer: 'test',
    subject: 'test-user',
    assurance: 'test',
    credentialGeneration: 1,
  },
  credentialGeneration: 1,
  signal: new AbortController().signal,
} as const

const foreignProductCall = {
  ...productCall,
  principal: { ...productCall.principal, id: 'foreign-human-action-product-principal' as never },
} as const

interface MuxCapture {
  readonly envelopes: RpcRequest<MuxFrame>[]
  waitFor<T extends MuxFrame['type']>(type: T): Promise<Extract<MuxFrame, { type: T }>>
}

interface HumanActionHarness {
  readonly ctx: Context
  readonly api: ApiProxy
  readonly teamId: TeamId
  readonly participantId: ParticipantId
  readonly upserts: TeamHumanActionUpsertRequest[]
  readonly resolutions: TeamHumanActionResolveRequest[]
  readonly scopes: TeamSystemHumanActionScope[]
  source(): TeamSystemHumanActionProofSource | undefined
}

/** Open one mux and retain the exact envelopes needed to answer its interactions. */
function openMux(api: ApiProxy, abort: AbortController): MuxCapture {
  const envelopes: RpcRequest<MuxFrame>[] = []
  const waiters: Array<{
    readonly type: MuxFrame['type']
    readonly resolve: (frame: MuxFrame) => void
  }> = []
  void (async () => {
    for await (const envelope of api.events.mux({ rpcId: RpcId('human-action-mux'), payload: {} }, abort.signal)) {
      envelopes.push(envelope)
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        const waiter = waiters[index] as (typeof waiters)[number]
        if (waiter.type !== envelope.payload.type) continue
        waiters.splice(index, 1)
        waiter.resolve(envelope.payload)
      }
    }
  })()
  return {
    envelopes,
    waitFor: (type) => {
      const current = envelopes.find(envelope => envelope.payload.type === type)
      if (current !== undefined) return Promise.resolve(current.payload as Extract<MuxFrame, { type: typeof type }>)
      return new Promise((resolve) => {
        waiters.push({
          type,
          resolve: (frame) => {
            resolve(frame as Extract<MuxFrame, { type: typeof type }>)
          },
        })
      })
    },
  }
}

/** Wait for a fire-and-forget Team projection write that follows a mux settlement. */
async function waitForCount(values: readonly unknown[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 200 && values.length < count; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(values).toHaveLength(count)
}

/** Return the requested envelope for one already observed mux frame. */
function envelopeFor(capture: MuxCapture, frame: RequestedFrame): RpcRequest<RequestedFrame> {
  const envelope = capture.envelopes.find(item => item.payload === frame)
  if (envelope === undefined) throw new Error('requested mux envelope was not retained')
  return envelope as RpcRequest<RequestedFrame>
}

/** Create an active host agent whose immutable Session header carries Team provenance. */
function teamAgent(ctx: Context, teamId: TeamId, participantId: ParticipantId): Agent {
  const session = ctx.sessions.create(undefined, { meta: { teamId, participantId } })
  session.append('turn/start', { turn: 1 })
  const agent = { id: session.id, session, status: 'idle', ctx } as Agent
  ctx.agents.register(agent)
  return agent
}

/** Resolve a source-owned proof while a fake Hub call is in flight. */
function scopeFor(
  source: TeamSystemHumanActionProofSource | undefined,
  proof: TeamSystemHumanActionProof,
): TeamSystemHumanActionScope {
  const scope = source?.resolveHumanActionProof(proof)
  if (scope === undefined) throw new Error('api-proxy did not provide a live human-action proof')
  return scope
}

/** Narrow one proof scope to the only pending-action operation the Host may issue. */
function pendingScope(
  scope: TeamSystemHumanActionScope | undefined,
): Extract<TeamSystemHumanActionScope, { kind: 'host-human-action-upsert' }> {
  if (scope?.kind !== 'host-human-action-upsert') throw new Error('expected a pending human-action scope')
  return scope
}

/** Narrow one proof scope to the only terminal-action operation the Host may issue. */
function terminalScope(
  scope: TeamSystemHumanActionScope | undefined,
): Extract<TeamSystemHumanActionScope, { kind: 'host-human-action-resolve' }> {
  if (scope?.kind !== 'host-human-action-resolve') throw new Error('expected a terminal human-action scope')
  return scope
}

/** Build a host/API proxy composition with a Hub-shaped proof-checking Team fake. */
async function harness(options: {
  readonly rejectFirstUpsert?: boolean
  readonly includeForeignHuman?: boolean
} = {}): Promise<HumanActionHarness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ApprovalService)

  const teamId = 'team-human-action' as TeamId
  const participantId = 'participant-human-action' as ParticipantId
  let cursor = 4
  let remainingUpsertConflicts = options.rejectFirstUpsert === true ? 1 : 0
  let registered: TeamSystemHumanActionProofSource | undefined
  const actions = new Map<string, TeamHumanActionSnapshot>()
  const upserts: TeamHumanActionUpsertRequest[] = []
  const resolutions: TeamHumanActionResolveRequest[] = []
  const scopes: TeamSystemHumanActionScope[] = []
  const teams = {
    registerSystemHumanActionProofSource(source: TeamSystemHumanActionProofSource): () => void {
      registered = source
      return () => {
        if (registered === source) registered = undefined
      }
    },
    async getTeam(): Promise<TeamStateSnapshot> {
      return {
        team: { cursor },
        participants: [
          {
            id: participantId,
            teamId,
            kind: 'human',
            displayName: 'Team action owner',
            role: 'human',
            capabilities: [],
            phase: 'active',
            owner: { kind: 'product-principal', principalId: productCall.principal.id },
            authorityGrant: { operations: ['human-action'], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} },
          },
          ...options.includeForeignHuman ? [{
            id: 'participant-foreign-human-action' as ParticipantId,
            teamId,
            kind: 'human' as const,
            displayName: 'Foreign action owner',
            role: 'human' as const,
            capabilities: [],
            phase: 'active' as const,
            owner: { kind: 'product-principal' as const, principalId: foreignProductCall.principal.id },
            authorityGrant: { operations: ['human-action'], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} },
          }] : [],
        ],
      } as unknown as TeamStateSnapshot
    },
    async upsertHumanAction(request: TeamHumanActionUpsertRequest): Promise<TeamHumanActionSnapshot> {
      upserts.push(request)
      const scope = scopeFor(registered, request.actor)
      if (scope.kind !== 'host-human-action-upsert'
        || scope.teamId !== request.teamId
        || scope.expectedCursor !== request.expectedCursor) {
        throw new TeamError('human-action upsert proof does not match its JSON input', 'TEAM_ACTOR_PROOF_INVALID')
      }
      scopes.push(scope)
      if (remainingUpsertConflicts > 0) {
        remainingUpsertConflicts -= 1
        cursor += 1
        throw new TeamError('synthetic cursor conflict', 'TEAM_CURSOR_CONFLICT')
      }
      actions.set(String(scope.action.id), scope.action)
      cursor += 1
      return scope.action
    },
    async resolveHumanAction(request: TeamHumanActionResolveRequest): Promise<TeamHumanActionSnapshot> {
      resolutions.push(request)
      const scope = scopeFor(registered, request.actor)
      if (scope.kind !== 'host-human-action-resolve'
        || scope.teamId !== request.teamId
        || scope.expectedCursor !== request.expectedCursor) {
        throw new TeamError('human-action resolution proof does not match its JSON input', 'TEAM_ACTOR_PROOF_INVALID')
      }
      const action = actions.get(String(scope.action.id))
      if (action === undefined || JSON.stringify(action) !== JSON.stringify(scope.action)) {
        throw new TeamError('human-action resolution did not retain the pending action', 'TEAM_ACTOR_PROOF_INVALID')
      }
      scopes.push(scope)
      cursor += 1
      return { ...scope.action, phase: scope.phase, outcome: scope.outcome, updatedAt: cursor }
    },
  }
  ctx.provide('teams', teams as never)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
    cwd: '/tmp',
  })
  return {
    ctx,
    api,
    teamId,
    participantId,
    upserts,
    resolutions,
    scopes,
    source: () => registered,
  }
}

function questionResponse(
  envelope: RpcRequest<Extract<MuxFrame, { type: 'question/requested' }>>,
): Parameters<ApiProxy['respond']>[0] {
  return {
    type: 'client-response',
    rpcId: envelope.rpcId,
    result: {
      ok: true,
      value: {
        sessionId: envelope.payload.sessionId,
        answer: { answers: [{ id: envelope.payload.questions[0]?.id, selected: ['Proceed'] }] },
      },
    },
  }
}

function approvalResponse(
  envelope: RpcRequest<Extract<MuxFrame, { type: 'approval/requested' }>>,
): Parameters<ApiProxy['respond']>[0] {
  return {
    type: 'client-response',
    rpcId: envelope.rpcId,
    result: {
      ok: true,
      value: {
        sessionId: envelope.payload.sessionId,
        approvalId: envelope.payload.approvalId,
        outcome: 'allowed-once',
      },
    },
  }
}

describe('Team-bound human actions', () => {
  it('persists a Team question as pending, retries its cursor fence, then resolves its retained action', async () => {
    const team = await harness({ rejectFirstUpsert: true })
    const abort = new AbortController()
    const mux = openMux(team.api, abort)
    const agent = teamAgent(team.ctx, team.teamId, team.participantId)

    const asked = team.ctx.userQuestions.ask({
      agent,
      questions: [{ id: 'continue', question: 'Continue the Team task?', options: [{ label: 'Proceed' }] }],
    })
    const requested = await mux.waitFor('question/requested')
    if (requested.type !== 'question/requested') throw new Error('unreachable')
    const request = envelopeFor(mux, requested) as RpcRequest<Extract<MuxFrame, { type: 'question/requested' }>>

    expect(team.source()?.name).toBe('host-api-proxy')
    expect(team.upserts.map(({ actor: _actor, ...input }) => input)).toEqual([
      { teamId: team.teamId, expectedCursor: 4 },
      { teamId: team.teamId, expectedCursor: 5 },
    ])
    const initial = pendingScope(team.scopes[0])
    const retried = pendingScope(team.scopes[1])
    expect(initial).toMatchObject({ teamId: team.teamId, expectedCursor: 4 })
    expect(initial.action).toMatchObject({
      kind: 'question',
      phase: 'pending',
      sessionId: agent.session.id,
      participantId: team.participantId,
      sourceId: request.rpcId,
      createdAt: 0,
      updatedAt: 0,
    })
    expect(initial.action.details).toMatchObject({ questionRpcId: request.rpcId })
    expect(retried).toMatchObject({ teamId: team.teamId, expectedCursor: 5 })
    for (const requestAttempt of team.upserts) {
      expect(team.source()?.resolveHumanActionProof(requestAttempt.actor)).toBeUndefined()
    }

    const unauthenticated = await toFetchHandler(team.api).fetch(new Request('http://x/api/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(questionResponse(request)),
    }))
    await expect(unauthenticated.json()).resolves.toEqual({ accepted: false, reason: 'not-pending' })
    expect(team.resolutions).toEqual([])

    expect(await withAuthenticatedProductCall(foreignProductCall, async () => await team.api.respond(questionResponse(request))))
      .toEqual({ accepted: false, reason: 'not-pending' })
    expect(team.resolutions).toEqual([])

    const revoked = new AbortController()
    revoked.abort()
    expect(await withAuthenticatedProductCall({ ...productCall, signal: revoked.signal }, async () =>
      await team.api.respond(questionResponse(request))))
      .toEqual({ accepted: false, reason: 'not-pending' })
    expect(team.resolutions).toEqual([])

    expect(await withAuthenticatedProductCall(productCall, async () => await team.api.respond(questionResponse(request))))
      .toEqual({ accepted: true })
    await expect(asked).resolves.toEqual({ answers: [{ id: 'continue', selected: ['Proceed'] }] })
    await waitForCount(team.resolutions, 1)

    expect(team.resolutions.map(({ actor: _actor, ...input }) => input)).toEqual([
      { teamId: team.teamId, expectedCursor: 6 },
    ])
    const resolved = terminalScope(team.scopes[2])
    expect(resolved).toMatchObject({
      teamId: team.teamId,
      expectedCursor: 6,
      phase: 'resolved',
      outcome: { kind: 'answered', answer: { answers: [{ id: 'continue', selected: ['Proceed'] }] } },
    })
    expect(resolved.action).toMatchObject({
      kind: 'question',
      phase: 'pending',
      sessionId: agent.session.id,
      participantId: team.participantId,
      sourceId: request.rpcId,
    })
    expect(resolved.action.details).toMatchObject({ questionRpcId: request.rpcId })
    expect(team.source()?.resolveHumanActionProof(team.resolutions[0]?.actor as TeamSystemHumanActionProof)).toBeUndefined()

    abort.abort()
    await team.ctx.fiber.dispose()
    expect(team.source()).toBeUndefined()
  })

  it('persists a cancelled Team approval with its original pending action facts', async () => {
    const team = await harness()
    const abort = new AbortController()
    const mux = openMux(team.api, abort)
    const agent = teamAgent(team.ctx, team.teamId, team.participantId)
    const cancel = new AbortController()

    const asked = team.ctx.approval.request({ agent, toolName: 'bash', reason: 'Team approval', signal: cancel.signal })
    const requested = await mux.waitFor('approval/requested')
    if (requested.type !== 'approval/requested') throw new Error('unreachable')
    const request = envelopeFor(mux, requested) as RpcRequest<Extract<MuxFrame, { type: 'approval/requested' }>>

    expect(team.upserts.map(({ actor: _actor, ...input }) => input)).toEqual([
      { teamId: team.teamId, expectedCursor: 4 },
    ])
    cancel.abort()
    await expect(asked).resolves.toBe('cancelled')
    await waitForCount(team.resolutions, 1)

    expect(team.resolutions.map(({ actor: _actor, ...input }) => input)).toEqual([
      { teamId: team.teamId, expectedCursor: 5 },
    ])
    const pending = pendingScope(team.scopes[0])
    const cancelled = terminalScope(team.scopes[1])
    expect(pending.action).toMatchObject({
      kind: 'approval',
      phase: 'pending',
      sessionId: agent.session.id,
      participantId: team.participantId,
      sourceId: requested.approvalId,
    })
    expect(pending.action.details).toMatchObject({ approvalId: requested.approvalId, rpcId: request.rpcId })
    expect(cancelled).toMatchObject({ phase: 'cancelled', outcome: { kind: 'cancelled' } })
    expect(cancelled.action).toMatchObject({
      kind: 'approval',
      phase: 'pending',
      sessionId: agent.session.id,
      participantId: team.participantId,
      sourceId: requested.approvalId,
    })
    expect(cancelled.action.details).toMatchObject({ approvalId: requested.approvalId, rpcId: request.rpcId })
    expect(team.source()?.resolveHumanActionProof(team.upserts[0]?.actor as TeamSystemHumanActionProof)).toBeUndefined()
    expect(team.source()?.resolveHumanActionProof(team.resolutions[0]?.actor as TeamSystemHumanActionProof)).toBeUndefined()

    abort.abort()
    await team.ctx.fiber.dispose()
    expect(team.source()).toBeUndefined()
  })

  it('allows the authenticated human to answer a question asked by a worker participant', async () => {
    const team = await harness()
    const teams = team.ctx.get('teams') as unknown as {
      getTeam(): Promise<TeamStateSnapshot>
    }
    const originalGetTeam = teams.getTeam.bind(teams)
    teams.getTeam = async () => {
      const state = await originalGetTeam()
      const source = state.participants.find(participant => participant.id === team.participantId)
      if (source === undefined) throw new Error('worker source participant was not seeded')
      return {
        ...state,
        participants: [
          { ...source, kind: 'local-agent', role: 'worker', owner: undefined },
          {
            id: 'participant-human-answerer' as ParticipantId,
            teamId: team.teamId,
            kind: 'human',
            displayName: 'Team action owner',
            role: 'human',
            capabilities: [],
            phase: 'active',
            owner: { kind: 'product-principal', principalId: productCall.principal.id },
            authorityGrant: { operations: ['human-action'], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} },
          },
        ],
      }
    }
    const abort = new AbortController()
    const mux = openMux(team.api, abort)
    const agent = teamAgent(team.ctx, team.teamId, team.participantId)
    const asked = team.ctx.userQuestions.ask({
      agent,
      questions: [{ id: 'worker-question', question: 'Worker asks?', options: [{ label: 'Proceed' }] }],
    })
    const requested = await mux.waitFor('question/requested')
    if (requested.type !== 'question/requested') throw new Error('unreachable')
    const request = envelopeFor(mux, requested) as RpcRequest<Extract<MuxFrame, { type: 'question/requested' }>>
    await expect(withAuthenticatedProductCall(productCall, async () => await team.api.respond(questionResponse(request))))
      .resolves.toEqual({ accepted: true })
    await expect(asked).resolves.toEqual({ answers: [{ id: 'worker-question', selected: ['Proceed'] }] })
    abort.abort()
    await team.ctx.fiber.dispose()
  })

  it('rejects a foreign principal before resolving a Team approval', async () => {
    const team = await harness()
    const abort = new AbortController()
    const mux = openMux(team.api, abort)
    const agent = teamAgent(team.ctx, team.teamId, team.participantId)
    const asked = team.ctx.approval.request({ agent, toolName: 'bash', reason: 'Team approval' })
    const requested = await mux.waitFor('approval/requested')
    if (requested.type !== 'approval/requested') throw new Error('unreachable')
    const request = envelopeFor(mux, requested) as RpcRequest<Extract<MuxFrame, { type: 'approval/requested' }>>

    expect(await withAuthenticatedProductCall(foreignProductCall, async () => await team.api.respond(approvalResponse(request))))
      .toEqual({ accepted: false, reason: 'not-pending' })
    expect(team.resolutions).toEqual([])
    expect(await withAuthenticatedProductCall(productCall, async () => await team.api.respond(approvalResponse(request))))
      .toEqual({ accepted: true })
    await expect(asked).resolves.toBe('allowed-once')

    abort.abort()
    await team.ctx.fiber.dispose()
  })

  it('requires the authenticated principal to own the pending action participant', async () => {
    const team = await harness({ includeForeignHuman: true })
    const abort = new AbortController()
    const mux = openMux(team.api, abort)
    const agent = teamAgent(team.ctx, team.teamId, team.participantId)
    const asked = team.ctx.approval.request({ agent, toolName: 'bash', reason: 'Team approval' })
    const requested = await mux.waitFor('approval/requested')
    if (requested.type !== 'approval/requested') throw new Error('unreachable')
    const request = envelopeFor(mux, requested) as RpcRequest<Extract<MuxFrame, { type: 'approval/requested' }>>

    expect(await withAuthenticatedProductCall(foreignProductCall, async () => await team.api.respond(approvalResponse(request))))
      .toEqual({ accepted: false, reason: 'not-pending' })
    expect(await withAuthenticatedProductCall(productCall, async () => await team.api.respond(approvalResponse(request))))
      .toEqual({ accepted: true })
    await expect(asked).resolves.toBe('allowed-once')

    abort.abort()
    await team.ctx.fiber.dispose()
  })
})
