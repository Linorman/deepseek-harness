import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import AgentRegistry, { type Agent, type AgentHandle } from '@clocky/clocky-agent'

import SessionStore, { SessionId } from '@clocky/clocky-session'
import * as agentCore from '@clocky/clocky-agent-spine-demo'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import * as LlmPiAi from '@clocky/clocky-llm-pi-ai'
import SubagentRuntime, { type SubagentResult, type SubagentRunEndInfo } from '@clocky/clocky-subagent'
import { channelSummaryHumanProofInput, emptyTeamLatencyHistogram, TeamError } from '@clocky/clocky-team'
import { TeamArtifactError } from '@clocky/clocky-team-artifact'
import { ProductPrincipalError, productPrincipalId } from '@clocky/clocky-product-principal'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type { TeamHumanActorProof, TeamHumanActorProofInput } from '@clocky/clocky-team'
import type { JsonRpcTransportPeer } from '@clocky/clocky-sdk-protocol'
import { HarnessSdkJsonRpcServer } from '../src/index.ts'
import {
  SDK_TEST_CREDENTIAL,
  installTestProductPrincipals,
  testProductPrincipals,
} from './product-auth.ts'

class FakeTransport implements JsonRpcTransportPeer {
  notifications: { method: string; params?: Record<string, unknown> }[] = []

  async request(method: string, params: object): Promise<unknown> {
    throw new Error(`the SDK server should not call host JSON-RPC method ${method} with ${JSON.stringify(params)}`)
  }

  notify(method: string, params?: object): void {
    this.notifications.push(params === undefined ? { method } : { method, params: params as Record<string, unknown> })
  }
}

afterEach(async () => {
  vi.unstubAllEnvs()
})

const TEST_MODEL_IDS = ['dsagent-model', 'plain-model', 'preinstalled-model', 'model', 'new-model', 'test-model']

async function makeHarness(storageDir: string, endpoint = 'http://127.0.0.1:9') {
  const ctx = new Context()
  await installTestProductPrincipals(ctx)
  await ctx.plugin(agentCore, { workspaceContext: false })
  await ctx.plugin(LlmPiAi, {
    providers: {
      'test-provider': {
        apiKeyEnv: 'TEST_API_KEY',
        api: 'openai-completions',
        baseURL: endpoint,
        models: TEST_MODEL_IDS.map(id => ({ id, maxTokens: 8192 })),
      },
    },
  })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(JsonlSessionPersistence, { root: storageDir })
  await new Promise(resolve => setTimeout(resolve, 50))
  return ctx
}

/** Drive the owning service so test lifecycle events carry the real parent scope. */
async function settleSubagent(
  ctx: Context,
  parent: Agent,
  info: Omit<SubagentRunEndInfo, 'runId' | 'local'> & { localAgent: Agent | undefined },
  beforeSettle?: () => Promise<void>,
): Promise<void> {
  const result = Promise.withResolvers<SubagentResult>()
  const disposeProvider = ctx.subagents.registerProvider({
    name: info.provider,
    capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
    async start() {
      return {
        id: info.id,
        localAgent: info.localAgent,
        result: result.promise,
        dispose: () => Promise.resolve(),
      }
    },
  })
  try {
    const run = await ctx.subagents.start(info.provider, {
      parent,
      prompt: [],
      signal: new AbortController().signal,
    })
    await beforeSettle?.()
    if (info.lastAssistantMessage === undefined) {
      result.reject(new Error('synthetic infrastructure failure'))
    } else {
      result.resolve({ output: info.lastAssistantMessage, stopReason: info.stopReason })
    }
    await run.result.then(() => undefined, () => undefined)
    await run.dispose()
  } finally {
    disposeProvider()
  }
}

describe('HarnessSdkJsonRpcServer', () => {
  it('refuses Team creation before the SDK handshake selects a model', async () => {
    const teamRuns = { create: vi.fn() }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns,
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

    await expect(server.createTeam({
      objective: 'Before initialization.',
      contentBlocks: [{ type: 'text', text: 'hello' }],
    })).rejects.toThrow('SDK server is not initialized with a provider and model')
    expect(teamRuns.create).not.toHaveBeenCalled()
    await server.shutdown()
  })

  it('retains an authenticated connection context for every post-initialization dispatch and fails closed after revocation', async () => {
    const controller = new AbortController()
    let invalid = false
    const withCall = vi.fn(async <T>(operation: (call: unknown) => Promise<T>): Promise<T> => {
      if (invalid) throw new ProductPrincipalError('credential reflected only by the provider', 'PRODUCT_AUTH_INVALID')
      return await operation(Object.freeze({
        principal: Object.freeze({
          id: productPrincipalId('sdk-dispatch-principal'),
          issuer: 'local',
          subject: 'sdk-dispatch-user',
          assurance: 'test',
          credentialGeneration: 1,
        }),
        credentialGeneration: 1,
        signal: controller.signal,
      }))
    })
    const release = vi.fn(async () => { invalid = true; controller.abort() })
    const authenticate = vi.fn(async ({ credential }: { readonly credential: string }) => {
      if (credential !== SDK_TEST_CREDENTIAL) throw new Error(credential)
      return { withCall, revoke: release }
    })
    const teams = { getMetrics: vi.fn(() => ({ activeAdmissions: 0 })) }
    const inbox = { read: vi.fn(async () => ({ items: [], displayCursor: -1, cursor: -1 })),
      watch: vi.fn(async () => ({ items: [], displayCursor: -1, cursor: -1 })),
      acknowledge: vi.fn(async () => ({ displayCursor: 2 })) }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns: {},
      get: (name: string) => name === 'productPrincipals'
        ? { authenticate }
        : name === 'teamHumanDelivery' ? inbox : name === 'teams'
          ? teams
          : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

    await expect(server.handleRequest('team/metrics', {})).rejects.toMatchObject({
      data: { code: 'PRODUCT_AUTH_REQUIRED' },
    })
    await expect(server.handleRequest('initialize', {
      credential: SDK_TEST_CREDENTIAL,
      cwd: process.cwd(),
      provider: 'test-provider',
      model: 'test-model',
    })).resolves.toMatchObject({ serverInfo: { name: 'clocky-sdk-runtime' } })
    await expect(server.handleRequest('team/metrics', {})).resolves.toEqual({ activeAdmissions: 0 })
    expect(authenticate).toHaveBeenCalledWith({ provider: 'local', credential: SDK_TEST_CREDENTIAL })
    expect(withCall).toHaveBeenCalledOnce()
    await expect(server.handleRequest('team/inbox-read', {})).resolves.toEqual({ items: [], displayCursor: -1, cursor: -1 })
    await expect(server.handleRequest('team/inbox-watch', { afterCursor: -1, limit: 1 })).resolves.toEqual({ items: [], displayCursor: -1, cursor: -1 })
    await expect(server.handleRequest('team/inbox-acknowledge', { throughCursor: 2 })).resolves.toEqual({ displayCursor: 2 })
    expect(inbox.read).toHaveBeenCalledWith(expect.objectContaining({ principal: expect.objectContaining({ id: 'sdk-dispatch-principal' }) }), {})
    await expect(server.handleRequest('team/inbox-read', { principalId: 'forged' })).rejects.toMatchObject({ code: -32602 })
    expect(inbox.read).toHaveBeenCalledOnce()

    invalid = true
    await expect(server.handleRequest('team/metrics', {})).rejects.toMatchObject({
      data: { code: 'PRODUCT_AUTH_INVALID' },
      message: 'Product authentication is invalid',
    })
    await expect(server.handleRequest('team/metrics', {})).rejects.toMatchObject({
      data: { code: 'PRODUCT_AUTH_REQUIRED' },
    })
    await server.shutdown()
  })

  it('keeps current TeamRun wait and cancel operations bound to their creating principal across reinitialization', async () => {
    const ownerCredential = 'sdk-owner-credential'
    const otherCredential = 'sdk-other-credential'
    const authenticate = vi.fn(async ({ credential }: { readonly credential?: string }) => {
      const principal = credential === ownerCredential
        ? Object.freeze({
          id: productPrincipalId('sdk-owner-principal'), issuer: 'test', subject: 'owner', assurance: 'test', credentialGeneration: 1,
        })
        : credential === otherCredential
          ? Object.freeze({
            id: productPrincipalId('sdk-other-principal'), issuer: 'test', subject: 'other', assurance: 'test', credentialGeneration: 1,
          })
          : undefined
      if (principal === undefined) throw new ProductPrincipalError('Product authentication is invalid', 'PRODUCT_AUTH_INVALID')
      const controller = new AbortController()
      let revoked = false
      return {
        async withCall<T>(operation: (call: AuthenticatedProductCall) => Promise<T>): Promise<T> {
          if (revoked || controller.signal.aborted) {
            throw new ProductPrincipalError('Product authentication is invalid', 'PRODUCT_AUTH_INVALID')
          }
          return await operation(Object.freeze({
            principal,
            credentialGeneration: principal.credentialGeneration,
            signal: controller.signal,
          }))
        },
        async revoke(): Promise<void> {
          revoked = true
          controller.abort()
        },
      }
    })
    let serial = 0
    const teamRuns = {
      create: vi.fn(async () => ({
        teamId: `owner-team-${++serial}`,
        coordinatorLease: { localAgent: { session: { id: SessionId(`owner-coordinator-${serial}`) } } },
      })),
      postHumanInput: vi.fn(async ({ teamId }: { readonly teamId: string }) => ({ id: `input-${teamId}` })),
      waitForFinal: vi.fn(async ({ teamId }: { readonly teamId: string }) => ({
        teamId, channelId: `channel-${teamId}`, envelopeId: `final-${teamId}`, text: `Finished ${teamId}.`,
      })),
      cancel: vi.fn(async () => undefined),
    }
    const teams = {
      getTeam: vi.fn(async ({ teamId }: { readonly teamId: string }) => ({
        team: { id: teamId, cursor: 1, phase: 'cancelled' as const },
      })),
    }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns,
      get: (name: string) => name === 'productPrincipals'
        ? { authenticate }
        : name === 'teams'
          ? teams
          : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    const initialize = async (credential: string): Promise<void> => {
      await server.initialize({ credential, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })
    }

    await initialize(ownerCredential)
    const waited = await server.createTeam({ objective: 'Wait under owner.', contentBlocks: [{ type: 'text', text: 'Wait.' }] })
    const cancelled = await server.createTeam({ objective: 'Cancel under owner.', contentBlocks: [{ type: 'text', text: 'Cancel.' }] })
    const records = (server as unknown as {
      productTeams: Map<string, { readonly owner: ReturnType<typeof productPrincipalId> }>
    }).productTeams
    expect(records.get(waited.teamId)?.owner).toBe(productPrincipalId('sdk-owner-principal'))
    expect(JSON.stringify([...records.values()])).not.toContain(ownerCredential)

    await initialize(otherCredential)
    const deniedWait = await server.handleRequest('team/wait-final', { teamId: waited.teamId }).then(
      () => { throw new Error('other principal unexpectedly waited for owner Team') },
      (error: unknown) => error,
    )
    expect(deniedWait).toMatchObject({
      data: { code: 'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE' },
    })
    const deniedCancel = await server.cancelTeam({ teamId: cancelled.teamId }).then(
      () => { throw new Error('other principal unexpectedly cancelled owner Team') },
      (error: unknown) => error,
    )
    expect(deniedCancel).toMatchObject({
      data: { code: 'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE' },
    })
    expect(String(deniedWait)).not.toContain(ownerCredential)
    expect(String(deniedWait)).not.toContain(otherCredential)
    expect(String(deniedCancel)).not.toContain(ownerCredential)
    expect(String(deniedCancel)).not.toContain(otherCredential)
    expect(teamRuns.waitForFinal).not.toHaveBeenCalled()
    expect(teamRuns.cancel).not.toHaveBeenCalled()

    await initialize(ownerCredential)
    await expect(server.waitForTeamFinal({ teamId: waited.teamId })).resolves.toMatchObject({ teamId: waited.teamId })
    await expect(server.handleRequest('team/cancel', { teamId: cancelled.teamId })).resolves.toEqual({ phase: 'cancelled' })
    expect(teamRuns.waitForFinal).toHaveBeenCalledWith({
      teamId: waited.teamId,
      humanOwner: { kind: 'product-principal', principalId: productPrincipalId('sdk-owner-principal') },
    })
    expect(teamRuns.cancel).toHaveBeenCalledWith(cancelled.teamId, {
      kind: 'product-principal', principalId: productPrincipalId('sdk-owner-principal'),
    })
    await server.shutdown()
  })

  it('keeps an actor-free SDK resume authorization live through TeamRun provider preflight', async () => {
    let proofLive = false
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const authorization = {
      isLive: vi.fn(() => proofLive),
      assert: vi.fn(async () => {
        if (!proofLive) throw new TeamError('Human resume authorization is revoked', 'TEAM_ACTOR_PROOF_INVALID')
        return { team: { id: 'resumed-team', cursor: 4, phase: 'active' } }
      }),
      close: vi.fn(),
    }
    const humanActors = {
      async withProof<T>(
        call: AuthenticatedProductCall,
        input: TeamHumanActorProofInput,
        operation: (actor: TeamHumanActorProof) => Promise<T>,
      ): Promise<T> {
        expect(call.principal.id).toBe(productPrincipalId('sdk-test-principal'))
        expect(input).toEqual({
          teamId: 'resumed-team',
          operation: 'activate',
          fence: { kind: 'cursor', cursor: 4 },
          payload: { teamId: 'resumed-team', expectedCursor: 4 },
        })
        proofLive = true
        try {
          return await operation(Object.freeze({}) as TeamHumanActorProof)
        } finally {
          proofLive = false
        }
      },
    }
    const teams = {
      authorizeHumanResume: vi.fn(async (request: Record<string, unknown>) => {
        expect(request).toMatchObject({ teamId: 'resumed-team', expectedCursor: 4 })
        expect(Object.hasOwn(request, 'actor')).toBe(true)
        return authorization
      }),
    }
    const teamRuns = {
      resume: vi.fn(async (request: {
        readonly teamId: string
        readonly authorization?: { readonly isLive: () => boolean; readonly assert: () => Promise<unknown> }
      }) => {
        expect(request.teamId).toBe('resumed-team')
        const retained = request.authorization
        if (retained === undefined) throw new Error('SDK resume did not retain human authorization')
        expect(retained.isLive()).toBe(true)
        await retained.assert()
        entered.resolve(undefined)
        await release.promise
        return {
          teamId: 'resumed-team',
          coordinatorLease: { localAgent: { session: { id: SessionId('resumed-coordinator') } } },
        }
      }),
      waitForFinal: vi.fn(async ({ teamId }: { readonly teamId: string }) => ({
        teamId,
        channelId: 'resumed-channel',
        envelopeId: 'resumed-final',
        text: 'Resumed final.',
      })),
    }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns,
      get: (name: string) => name === 'productPrincipals'
        ? testProductPrincipals()
        : name === 'teamHumanActors'
          ? humanActors
          : name === 'teams'
            ? teams
            : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })

    const pending = server.resumeTeam({ teamId: 'resumed-team', expectedCursor: 4 })
    await entered.promise
    expect(proofLive).toBe(true)
    expect(authorization.isLive()).toBe(true)
    release.resolve(undefined)
    await expect(pending).resolves.toEqual({ teamId: 'resumed-team', coordinatorSessionId: 'resumed-coordinator' })
    expect(authorization.close).toHaveBeenCalledOnce()
    await expect(server.waitForTeamFinal({ teamId: 'resumed-team' }))
      .resolves.toMatchObject({ teamId: 'resumed-team' })
    expect(teamRuns.waitForFinal).toHaveBeenCalledWith({
      teamId: 'resumed-team',
      humanOwner: { kind: 'product-principal', principalId: productPrincipalId('sdk-test-principal') },
    })
    await expect(server.handleRequest('team/resume', {
      teamId: 'resumed-team', expectedCursor: 4, actor: 'forged',
    })).rejects.toMatchObject({ code: -32_602 })
    await server.shutdown()
  })

  it('rejects foreign, stale, revoked, and binderless SDK resume before coordinator recovery', async () => {
    const foreign = new TeamError('Authenticated principal owns no active human Team participant', 'TEAM_HUMAN_ACTOR_NOT_FOUND')
    const stale = new TeamError('Team cursor is stale', 'TEAM_CURSOR_CONFLICT')
    const revoked = new TeamError('Human resume authorization is revoked', 'TEAM_ACTOR_PROOF_INVALID')
    let mode: 'foreign' | 'stale' | 'revoked' = 'foreign'
    const authorization = {
      isLive: () => false,
      assert: async () => { throw revoked },
      close: vi.fn(),
    }
    const humanActors = {
      async withProof<T>(
        _call: AuthenticatedProductCall,
        _input: TeamHumanActorProofInput,
        operation: (actor: TeamHumanActorProof) => Promise<T>,
      ): Promise<T> {
        return await operation(Object.freeze({}) as TeamHumanActorProof)
      },
    }
    const teams = {
      authorizeHumanResume: vi.fn(async () => {
        if (mode === 'foreign') throw foreign
        if (mode === 'stale') throw stale
        return authorization
      }),
    }
    const teamRuns = {
      resume: vi.fn(async (request: { readonly authorization?: { readonly assert: () => Promise<unknown> } }) => {
        const retained = request.authorization
        if (retained === undefined) throw new Error('SDK resume did not retain authorization')
        await retained.assert()
        throw new Error('revoked authorization unexpectedly reached coordinator provider')
      }),
    }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns,
      get: (name: string) => name === 'productPrincipals'
        ? testProductPrincipals()
        : name === 'teamHumanActors'
          ? humanActors
          : name === 'teams'
            ? teams
            : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })
    for (const expected of [foreign, stale]) {
      const failure = await server.handleRequest('team/resume', { teamId: 'resumed-team', expectedCursor: 4 }).then(
        () => { throw new Error('resume unexpectedly succeeded') },
        (error: unknown) => error,
      )
      expect(failure).toBe(expected)
      expect(String(failure)).not.toContain(SDK_TEST_CREDENTIAL)
      mode = 'stale'
    }
    mode = 'revoked'
    await expect(server.handleRequest('team/resume', { teamId: 'resumed-team', expectedCursor: 4 })).rejects.toBe(revoked)
    expect(teamRuns.resume).toHaveBeenCalledOnce()
    expect(authorization.close).toHaveBeenCalledOnce()
    await server.shutdown()
  })

  it('rejects SDK resume before Team lookup when the human binder is absent', async () => {
    const authorizeHumanResume = vi.fn()
    const get = vi.fn((name: string) => {
      if (name === 'productPrincipals') return testProductPrincipals()
      if (name === 'teamHumanActors') return undefined
      if (name === 'teams') return { authorizeHumanResume }
      return { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] }
    })
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns: {},
      get,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })
    get.mockClear()
    await expect(server.handleRequest('team/resume', { teamId: 'resumed-team', expectedCursor: 4 })).rejects.toMatchObject({
      data: { code: 'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE' },
    })
    expect(get).not.toHaveBeenCalledWith('teams')
    expect(authorizeHumanResume).not.toHaveBeenCalled()
    await server.shutdown()
  })

  it('binds one actor-free SDK channel post to the current authenticated human proof', async () => {
    const postRequests: Record<string, unknown>[] = []
    const postChannelEnvelope = vi.fn(async (request: Record<string, unknown>) => {
      postRequests.push(request)
      return {
        id: 'envelope-1',
        teamId: 'team-1',
        channelId: 'channel-1',
        senderId: 'human-1',
        audience: ['coordinator-1'],
        kind: 'message',
        payload: { text: 'SDK-authenticated post.' },
        delivery: 'turn',
        priority: 'normal',
        sequence: 1,
        createdAt: 1,
        ...request,
      }
    })
    const humanActors = {
      async withProof<T>(
        call: AuthenticatedProductCall,
        input: TeamHumanActorProofInput,
        operation: (actor: TeamHumanActorProof) => Promise<T>,
      ): Promise<T> {
        expect(call.principal.id).toBe(productPrincipalId('sdk-test-principal'))
        expect(input).toMatchObject({
          teamId: 'team-1',
          operation: 'send',
          fence: { kind: 'cursor', cursor: 3 },
          payload: {
            expectedCursor: 3,
            draft: {
              channelId: 'channel-1',
              audience: ['coordinator-1'],
              kind: 'message',
              payload: { text: 'SDK-authenticated post.' },
            },
          },
        })
        return await operation(Object.freeze({}) as TeamHumanActorProof)
      },
    }
    const teams = {
      getChannel: vi.fn(async () => ({ manifest: { teamId: 'team-1' } })),
      postChannelEnvelope,
    }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns: {},
      get: (name: string) => name === 'productPrincipals'
        ? testProductPrincipals()
        : name === 'teamHumanActors'
          ? humanActors
          : name === 'teams'
            ? teams
            : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })

    await expect(server.handleRequest('team/channel-post', {
      channelId: 'channel-1',
      expectedCursor: 3,
      audience: ['coordinator-1'],
      kind: 'message',
      payload: { text: 'SDK-authenticated post.' },
      delivery: 'turn',
    })).resolves.toMatchObject({ value: { senderId: 'human-1' } })
    const postRequest = postRequests[0]
    if (postRequest === undefined) throw new Error('SDK channel post did not reach the Team provider')
    expect(postRequest['expectedCursor']).toBe(3)
    const draft = postRequest['draft']
    if (typeof draft !== 'object' || draft === null || Array.isArray(draft)) {
      throw new Error('SDK channel post has no object draft')
    }
    expect((draft as Record<string, unknown>)['channelId']).toBe('channel-1')
    expect(postRequest['actor']).toBeDefined()

    await expect(server.handleRequest('team/channel-post', {
      channelId: 'channel-1',
      expectedCursor: 3,
      audience: ['coordinator-1'],
      kind: 'message',
      payload: { text: 'SDK-authenticated post.' },
      delivery: 'turn',
      actor: 'forged',
    })).rejects.toMatchObject({ code: -32_602 })
    await server.shutdown()
  })

  it('binds actor-free SDK member and channel lifecycle writes to the current authenticated human proof', async () => {
    const inputs: TeamHumanActorProofInput[] = []
    const humanActors = {
      async withProof<T>(
        call: AuthenticatedProductCall,
        input: TeamHumanActorProofInput,
        operation: (actor: TeamHumanActorProof) => Promise<T>,
      ): Promise<T> {
        expect(call.principal.id).toBe(productPrincipalId('sdk-test-principal'))
        inputs.push(input)
        return await operation(Object.freeze({}) as TeamHumanActorProof)
      },
    }
    const teams = {
      inviteParticipant: vi.fn(async (request: Record<string, unknown>) => ({ id: 'invited', ...request })),
      transitionParticipantPhase: vi.fn(async (request: Record<string, unknown>) => ({ id: 'member', ...request })),
      requestParticipantInterrupt: vi.fn(async (request: Record<string, unknown>) => ({ id: 'interrupt', ...request })),
      openChannel: vi.fn(async (request: Record<string, unknown>) => ({ manifest: { id: 'opened', ...request } })),
      getChannel: vi.fn(async () => ({ manifest: { teamId: 'team-1' } })),
      closeChannel: vi.fn(async (request: Record<string, unknown>) => ({ phase: 'closed', ...request })),
    }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns: {},
      get: (name: string) => name === 'productPrincipals'
        ? testProductPrincipals()
        : name === 'teamHumanActors'
          ? humanActors
          : name === 'teams'
            ? teams
            : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })

    await expect(server.handleRequest('team/member-invite', {
      teamId: 'team-1', expectedCursor: 1, kind: 'local-agent', displayName: 'Worker', role: 'worker', capabilities: [],
    })).resolves.toMatchObject({ value: { id: 'invited' } })
    await expect(server.handleRequest('team/member-activate', {
      teamId: 'team-1', participantId: 'member-1', expectedCursor: 2,
    })).resolves.toMatchObject({ value: { phase: 'active' } })
    await expect(server.handleRequest('team/member-remove', {
      teamId: 'team-1', participantId: 'member-1', expectedCursor: 3,
    })).resolves.toMatchObject({ value: { phase: 'left' } })
    await expect(server.handleRequest('team/member-interrupt', {
      teamId: 'team-1', participantId: 'member-1', expectedCursor: 4,
    })).resolves.toMatchObject({ value: { id: 'interrupt' } })
    await expect(server.handleRequest('team/channel-open', {
      teamId: 'team-1', expectedCursor: 5, adapter: { type: 'direct', version: 1 }, participants: [], limits: {},
    })).resolves.toMatchObject({ value: { manifest: { authorityKind: 'human' } } })
    await expect(server.handleRequest('team/channel-close', {
      channelId: 'channel-1', expectedCursor: 6, reason: 'done',
    })).resolves.toMatchObject({ value: { phase: 'closed' } })

    expect(inputs.map(input => [input.operation, input.teamId, input.fence])).toEqual([
      ['invite', 'team-1', { kind: 'cursor', cursor: 1 }],
      ['activate', 'team-1', { kind: 'cursor', cursor: 2 }],
      ['close', 'team-1', { kind: 'cursor', cursor: 3 }],
      ['interrupt', 'team-1', { kind: 'cursor', cursor: 4 }],
      ['channel-open', 'team-1', { kind: 'cursor', cursor: 5 }],
      ['close', 'team-1', { kind: 'cursor', cursor: 6 }],
    ])
    expect(inputs[0]?.payload).toMatchObject({ displayName: 'Worker', role: 'worker' })
    expect(inputs[4]?.payload).toMatchObject({ adapter: { type: 'direct', version: 1 }, participants: [] })
    expect(inputs[5]?.payload).toMatchObject({ channelId: 'channel-1', reason: 'done' })

    await expect(server.handleRequest('team/member-invite', {
      teamId: 'team-1', expectedCursor: 1, kind: 'local-agent', displayName: 'Worker', role: 'worker', capabilities: [], actor: 'forged',
    })).rejects.toMatchObject({ code: -32_602 })
    await server.shutdown()
  })

  it('binds actor-free SDK task writes to the current authenticated human proof', async () => {
    const inputs: TeamHumanActorProofInput[] = []
    const reviewRequests: Record<string, unknown>[] = []
    const humanActors = {
      async withProof<T>(
        call: AuthenticatedProductCall,
        input: TeamHumanActorProofInput,
        operation: (actor: TeamHumanActorProof) => Promise<T>,
      ): Promise<T> {
        expect(call.principal.id).toBe(productPrincipalId('sdk-test-principal'))
        inputs.push(input)
        return await operation(Object.freeze({}) as TeamHumanActorProof)
      },
    }
    const teams = {
      createTask: vi.fn(async (request: Record<string, unknown>) => ({ id: 'task-create', ...request })),
      updateTaskDetails: vi.fn(async (request: Record<string, unknown>) => ({ id: 'task-update', ...request })),
      cancelTask: vi.fn(async (request: Record<string, unknown>) => ({ id: 'task-cancel', ...request })),
      deleteTask: vi.fn(async (request: Record<string, unknown>) => ({ id: 'task-delete', ...request })),
      resolveTaskReview: vi.fn(async (request: Record<string, unknown>) => {
        reviewRequests.push(request)
        return { id: 'task-review', ...request }
      }),
    }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns: {},
      get: (name: string) => name === 'productPrincipals'
        ? testProductPrincipals()
        : name === 'teamHumanActors'
          ? humanActors
          : name === 'teams'
            ? teams
            : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })

    await expect(server.handleRequest('team/task-create', {
      teamId: 'team-1', expectedCursor: 1, idempotencyKey: 'sdk-task-create-1', subject: 'Task', description: 'Do the task.',
      blockedBy: [], requiredCapabilities: ['typescript'], priority: 2, readScopes: ['source'], writeScopes: ['source'],
      workspaceMode: 'shared', budget: { turns: 2 }, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
    })).resolves.toMatchObject({ value: { id: 'task-create' } })
    await expect(server.handleRequest('team/task-update', {
      teamId: 'team-1', taskId: 'task-1', expectedRevision: 2, subject: 'Task revised', blockedBy: ['task-0'],
    })).resolves.toMatchObject({ value: { id: 'task-update' } })
    await expect(server.handleRequest('team/task-cancel', {
      teamId: 'team-1', taskId: 'task-1', expectedRevision: 3, reason: 'Only this task.',
    })).resolves.toMatchObject({ value: { id: 'task-cancel' } })
    await expect(server.handleRequest('team/task-delete', {
      teamId: 'team-1', taskId: 'task-1', expectedRevision: 4,
    })).resolves.toMatchObject({ value: { id: 'task-delete' } })
    await expect(server.handleRequest('team/task-review', {
      teamId: 'team-1', taskId: 'task-1', expectedRevision: 5, decision: 'accepted', reason: 'Reviewed.',
    })).resolves.toMatchObject({ value: { id: 'task-review' } })

    expect(inputs.map(input => [input.operation, input.teamId, input.fence])).toEqual([
      ['task-mutate', 'team-1', { kind: 'cursor', cursor: 1 }],
      ['task-mutate', 'team-1', { kind: 'revision', revision: 2 }],
      ['task-mutate', 'team-1', { kind: 'revision', revision: 3 }],
      ['task-mutate', 'team-1', { kind: 'revision', revision: 4 }],
      ['task-mutate', 'team-1', { kind: 'revision', revision: 5 }],
    ])
    expect(inputs[0]?.payload).toMatchObject({
      teamId: 'team-1', expectedCursor: 1, createCommand: { idempotencyKey: 'sdk-task-create-1' }, subject: 'Task',
      requiredCapabilities: ['typescript'], budget: { turns: 2 },
    })
    expect(inputs[1]?.payload).toMatchObject({ teamId: 'team-1', taskId: 'task-1', expectedRevision: 2, subject: 'Task revised' })
    expect(inputs[2]?.payload).toEqual({ teamId: 'team-1', taskId: 'task-1', expectedRevision: 3, reason: 'Only this task.' })
    expect(inputs[4]?.payload).toEqual({
      teamId: 'team-1', taskId: 'task-1', expectedRevision: 5, nextPhase: 'completed', reason: 'Reviewed.',
    })
    const reviewRequest = reviewRequests[0]
    if (reviewRequest === undefined) throw new Error('SDK task review did not reach the Team provider')
    expect(reviewRequest).not.toHaveProperty('participantId')

    await expect(server.handleRequest('team/task-create', {
      teamId: 'team-1', expectedCursor: 1, idempotencyKey: 'sdk-task-create-2', subject: 'Task', description: 'Do the task.',
      blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {},
      reviewPolicy: { kind: 'none' }, maxAttempts: 1, actor: 'forged',
    })).rejects.toMatchObject({ code: -32_602 })
    await expect(server.handleRequest('team/task-review', {
      teamId: 'team-1', taskId: 'task-1', expectedRevision: 5, participantId: 'forged-reviewer', decision: 'accepted', reason: 'Reviewed.',
    })).rejects.toMatchObject({ code: -32_602 })
    await server.shutdown()
  })

  it('binds actor-free SDK goal mutations to the current authenticated human proof', async () => {
    const inputs: TeamHumanActorProofInput[] = []
    const humanActors = {
      async withProof<T>(
        call: AuthenticatedProductCall,
        input: TeamHumanActorProofInput,
        operation: (actor: TeamHumanActorProof) => Promise<T>,
      ): Promise<T> {
        expect(call.principal.id).toBe(productPrincipalId('sdk-test-principal'))
        inputs.push(input)
        return await operation(Object.freeze({}) as TeamHumanActorProof)
      },
    }
    const teams = {
      updateTeamGoal: vi.fn(async (request: Record<string, unknown>) => ({
        team: { id: 'team-1', goal: { revision: 8 }, ...request },
      })),
      transitionTeamGoalPhase: vi.fn(async (request: Record<string, unknown>) => ({
        team: { id: 'team-1', goal: { revision: 9 }, ...request },
      })),
    }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns: {},
      get: (name: string) => name === 'productPrincipals'
        ? testProductPrincipals()
        : name === 'teamHumanActors'
          ? humanActors
          : name === 'teams'
            ? teams
            : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })

    await expect(server.handleRequest('team/goal-update', {
      teamId: 'team-1', expectedRevision: 7, objective: 'Ship the authenticated goal.', budgets: { turns: 4 },
    })).resolves.toMatchObject({ state: { team: { id: 'team-1' } } })
    await expect(server.handleRequest('team/goal-transition', {
      teamId: 'team-1', expectedRevision: 8, phase: 'blocked', blocker: { code: 'external', message: 'Waiting on approval.' },
    })).resolves.toMatchObject({ state: { team: { id: 'team-1' } } })

    expect(inputs).toEqual([
      {
        teamId: 'team-1',
        operation: 'goal-mutate',
        fence: { kind: 'revision', revision: 7 },
        payload: { teamId: 'team-1', expectedRevision: 7, objective: 'Ship the authenticated goal.', budgets: { turns: 4 } },
      },
      {
        teamId: 'team-1',
        operation: 'goal-mutate',
        fence: { kind: 'revision', revision: 8 },
        payload: {
          teamId: 'team-1', expectedRevision: 8, phase: 'blocked', blocker: { code: 'external', message: 'Waiting on approval.' },
        },
      },
    ])
    await expect(server.handleRequest('team/goal-update', {
      teamId: 'team-1', expectedRevision: 7, objective: 'Forged.', actor: 'forged',
    })).rejects.toMatchObject({ code: -32_602 })
    await expect(server.handleRequest('team/goal-transition', {
      teamId: 'team-1', expectedRevision: 8, phase: 'paused', participantId: 'forged',
    })).rejects.toMatchObject({ code: -32_602 })
    await server.shutdown()
  })

  it('rejects SDK channel posting before Team lookup when the human binder is absent', async () => {
    const getChannel = vi.fn()
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns: {},
      get: (name: string) => {
        if (name === 'productPrincipals') return testProductPrincipals()
        if (name === 'teamHumanActors') return undefined
        if (name === 'teams') return { getChannel }
        return { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] }
      },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })
    await expect(server.handleRequest('team/channel-post', {
      channelId: 'channel-1',
      expectedCursor: 3,
      audience: ['coordinator-1'],
      kind: 'message',
      payload: { text: 'Denied before lookup.' },
      delivery: 'turn',
    })).rejects.toMatchObject({ data: { code: 'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE' } })
    expect(getChannel).not.toHaveBeenCalled()
    await server.shutdown()
  })

  it('rejects SDK member and channel lifecycle writes before Team lookup when the human binder is absent', async () => {
    const teams = {
      inviteParticipant: vi.fn(),
      transitionParticipantPhase: vi.fn(),
      requestParticipantInterrupt: vi.fn(),
      openChannel: vi.fn(),
      getChannel: vi.fn(),
      closeChannel: vi.fn(),
    }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns: {},
      get: (name: string) => {
        if (name === 'productPrincipals') return testProductPrincipals()
        if (name === 'teamHumanActors') return undefined
        if (name === 'teams') return teams
        return { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] }
      },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })
    const writes: readonly [string, Record<string, unknown>][] = [
      ['team/member-invite', { teamId: 'team-1', expectedCursor: 1, kind: 'local-agent', displayName: 'Worker', role: 'worker', capabilities: [] }],
      ['team/member-activate', { teamId: 'team-1', participantId: 'member-1', expectedCursor: 2 }],
      ['team/member-remove', { teamId: 'team-1', participantId: 'member-1', expectedCursor: 3 }],
      ['team/member-interrupt', { teamId: 'team-1', participantId: 'member-1', expectedCursor: 4 }],
      ['team/channel-open', { teamId: 'team-1', expectedCursor: 5, adapter: { type: 'direct', version: 1 }, participants: [], limits: {} }],
      ['team/channel-close', { channelId: 'channel-1', expectedCursor: 6 }],
    ]
    for (const [method, params] of writes) {
      await expect(server.handleRequest(method, params)).rejects.toMatchObject({
        data: { code: 'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE' },
      })
    }
    expect(teams.inviteParticipant).not.toHaveBeenCalled()
    expect(teams.transitionParticipantPhase).not.toHaveBeenCalled()
    expect(teams.requestParticipantInterrupt).not.toHaveBeenCalled()
    expect(teams.openChannel).not.toHaveBeenCalled()
    expect(teams.getChannel).not.toHaveBeenCalled()
    expect(teams.closeChannel).not.toHaveBeenCalled()
    await server.shutdown()
  })

  it('rejects SDK task writes before Team lookup when the human binder is absent', async () => {
    const teams = {
      createTask: vi.fn(),
      updateTaskDetails: vi.fn(),
      cancelTask: vi.fn(),
      deleteTask: vi.fn(),
      resolveTaskReview: vi.fn(),
    }
    const get = vi.fn((name: string) => {
      if (name === 'productPrincipals') return testProductPrincipals()
      if (name === 'teamHumanActors') return undefined
      if (name === 'teams') return teams
      return { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] }
    })
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns: {},
      get,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })
    get.mockClear()
    const writes: readonly [string, Record<string, unknown>][] = [
      ['team/task-create', {
        teamId: 'team-1', expectedCursor: 1, idempotencyKey: 'sdk-task-create-missing-binder', subject: 'Task', description: 'Do the task.',
        blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
      }],
      ['team/task-update', { teamId: 'team-1', taskId: 'task-1', expectedRevision: 2, subject: 'Task revised' }],
      ['team/task-cancel', { teamId: 'team-1', taskId: 'task-1', expectedRevision: 3 }],
      ['team/task-delete', { teamId: 'team-1', taskId: 'task-1', expectedRevision: 4 }],
      ['team/task-review', { teamId: 'team-1', taskId: 'task-1', expectedRevision: 5, decision: 'accepted', reason: 'Reviewed.' }],
    ]
    for (const [method, params] of writes) {
      await expect(server.handleRequest(method, params)).rejects.toMatchObject({
        data: { code: 'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE' },
      })
    }
    expect(get).not.toHaveBeenCalledWith('teams')
    expect(teams.createTask).not.toHaveBeenCalled()
    expect(teams.updateTaskDetails).not.toHaveBeenCalled()
    expect(teams.cancelTask).not.toHaveBeenCalled()
    expect(teams.deleteTask).not.toHaveBeenCalled()
    expect(teams.resolveTaskReview).not.toHaveBeenCalled()
    await server.shutdown()
  })

  it('rejects SDK goal mutations before Team lookup when the human binder is absent', async () => {
    const teams = {
      updateTeamGoal: vi.fn(),
      transitionTeamGoalPhase: vi.fn(),
    }
    const get = vi.fn((name: string) => {
      if (name === 'productPrincipals') return testProductPrincipals()
      if (name === 'teamHumanActors') return undefined
      if (name === 'teams') return teams
      return { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] }
    })
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns: {},
      get,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })
    get.mockClear()
    const writes: readonly [string, Record<string, unknown>][] = [
      ['team/goal-update', { teamId: 'team-1', expectedRevision: 7, objective: 'Denied before lookup.' }],
      ['team/goal-transition', { teamId: 'team-1', expectedRevision: 8, phase: 'paused' }],
    ]
    for (const [method, params] of writes) {
      await expect(server.handleRequest(method, params)).rejects.toMatchObject({
        data: { code: 'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE' },
      })
    }
    expect(get).not.toHaveBeenCalledWith('teams')
    expect(teams.updateTeamGoal).not.toHaveBeenCalled()
    expect(teams.transitionTeamGoalPhase).not.toHaveBeenCalled()
    await server.shutdown()
  })

  it('never reflects an initialization credential when a product provider fails', async () => {
    const secret = 'sdk-provider-secret-must-not-leak'
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns: {},
      get: (name: string) => name === 'productPrincipals'
        ? { authenticate: async () => { throw new Error(secret) } }
        : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

    const failure = await server.handleRequest('initialize', {
      credential: secret,
      cwd: process.cwd(),
      provider: 'test-provider',
      model: 'test-model',
    }).then(
      () => { throw new Error('initialization unexpectedly succeeded') },
      (error: unknown) => error,
    )
    expect(failure).toMatchObject({ data: { code: 'PRODUCT_AUTH_INVALID' }, message: 'Product authentication is invalid' })
    expect(String(failure)).not.toContain(secret)
    await server.shutdown()
  })

  it('serves process-local Team metrics through the SDK control plane', async () => {
    const metrics = {
      activeAdmissions: 0,
      pendingDeliveries: 0,
      activeActivations: 0,
      activeTasks: 0,
      stalledTeams: 0,
      replayLag: 0,
      lastTaskLatencyMs: 0,
      lastReceiptLatencyMs: 0,
      taskLatency: emptyTeamLatencyHistogram(),
      receiptLatency: emptyTeamLatencyHistogram(),
      workspaceConflicts: 0,
      teamEvents: 4,
      channelEvents: 3,
      policyDenials: 1,
      adapterFailures: 0,
      deliveryClaims: 2,
      taskAssignments: 1,
      taskRetries: 0,
      teamCompactions: 0,
      channelCompactions: 0,
      checkpointFailures: 0,
      auditProjectionRepairs: 5,
      auditProjectionFailures: 0,
      updatedAt: 42,
    }
    const teams = { getMetrics: vi.fn(() => metrics) }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns: {},
      get: (name: string) => name === 'teams'
        ? teams
        : name === 'productPrincipals'
          ? testProductPrincipals()
          : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })

    await expect(server.handleRequest('team/metrics', {})).resolves.toEqual(metrics)
    expect(teams.getMetrics).toHaveBeenCalledOnce()
    await server.shutdown()
  })

  it('forwards every bounded Team page cursor and limit to the provider', async () => {
    const teams = {
      listTeamsPage: vi.fn(async (request: unknown) => ({ items: [], nextCursor: 4, request })),
      listParticipantsPage: vi.fn(async (request: unknown) => ({ items: [], nextCursor: 5, request })),
      readChannelPage: vi.fn(async (request: unknown) => ({ channel: {}, records: [], nextCursor: 6, request })),
      listTasksPage: vi.fn(async (request: unknown) => ({ items: [], nextCursor: 7, request })),
      listArtifactsPage: vi.fn(async (request: unknown) => ({ items: [], nextCursor: 8, request })),
      listWorkflowPlansPage: vi.fn(async (request: unknown) => ({ items: [], nextCursor: 10, request })),
      readAudit: vi.fn(async (request: unknown) => ({ teamId: 'team', firstCursor: 8, items: [], nextCursor: 9, request })),
    }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns: {},
      get: (name: string) => name === 'teams'
        ? teams
        : name === 'productPrincipals'
          ? testProductPrincipals()
          : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })

    await expect(server.handleRequest('team/list', { afterCursor: 2, limit: 3 })).resolves.toMatchObject({ items: [], nextCursor: 4 })
    await expect(server.handleRequest('team/member-list', { teamId: 'team', afterCursor: 3, limit: 4 })).resolves.toMatchObject({ items: [], nextCursor: 5 })
    await expect(server.handleRequest('team/channel-read', { channelId: 'channel', afterCursor: 4, limit: 5 })).resolves.toMatchObject({ value: { records: [], nextCursor: 6 } })
    await expect(server.handleRequest('team/task-list', { teamId: 'team', afterCursor: 5, limit: 6 })).resolves.toMatchObject({ items: [], nextCursor: 7 })
    await expect(server.handleRequest('team/workflow-plan-list', { teamId: 'team', afterCursor: 6, limit: 7 })).resolves.toMatchObject({ items: [] })
    await expect(server.handleRequest('team/artifact-list', { teamId: 'team', afterCursor: 7, limit: 8 })).resolves.toMatchObject({ items: [] })
    await expect(server.handleRequest('team/audit-read', { teamId: 'team', afterCursor: 6, limit: 7 }))
      .resolves.toMatchObject({ teamId: 'team', firstCursor: 8, items: [], nextCursor: 9 })
    expect(teams.listTeamsPage).toHaveBeenCalledWith({ afterCursor: 2, limit: 3 })
    expect(teams.listParticipantsPage).toHaveBeenCalledWith({ teamId: 'team', afterCursor: 3, limit: 4 })
    expect(teams.readChannelPage).toHaveBeenCalledWith({ channelId: 'channel', afterCursor: 4, limit: 5 })
    expect(teams.listTasksPage).toHaveBeenCalledWith({ teamId: 'team', afterCursor: 5, limit: 6 })
    expect(teams.listArtifactsPage).toHaveBeenCalledWith({ teamId: 'team', afterCursor: 7, limit: 8 })
    expect(teams.listWorkflowPlansPage).toHaveBeenCalledWith({ teamId: 'team', afterCursor: 6, limit: 7 })
    expect(teams.readAudit).toHaveBeenCalledWith({ teamId: 'team', afterCursor: 6, limit: 7 })
    await server.shutdown()
  })

  it('reads only visible durable Team artifacts and maps provider failures', async () => {
    const visible = { id: 'visible', provider: 'local', kind: 'report' as const, uri: 'artifact://visible', visibility: 'team' as const }
    const artifactsById = new Map([
      ['visible', visible],
      ['proposal', { ...visible, id: 'proposal' }],
      ['retained-loss-artifact', { ...visible, id: 'retained-loss-artifact' }],
      ['child-report', { ...visible, id: 'child-report' }],
    ])
    const teams = {
      getArtifact: vi.fn(async ({ artifactId }: { readonly artifactId: string }) => artifactsById.get(artifactId)),
    }
    const artifacts = {
      getProvider: vi.fn(() => ({ name: 'local' })),
      read: vi.fn(async () => new Uint8Array([116, 101, 115, 116])),
    }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns: {},
      get: (name: string) => name === 'teams'
        ? teams
        : name === 'teamArtifacts'
          ? artifacts
          : name === 'productPrincipals'
            ? testProductPrincipals()
            : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })

    await expect(server.handleRequest('team/artifact-read', { teamId: 'team', artifactId: 'visible' })).resolves.toEqual({
      artifact: visible,
      bytes: 4,
      data: 'dGVzdA==',
    })
    await expect(server.handleRequest('team/artifact-read', { teamId: 'team', artifactId: 'proposal' }))
      .resolves.toMatchObject({ artifact: { id: 'proposal' }, bytes: 4 })
    await expect(server.handleRequest('team/artifact-read', { teamId: 'team', artifactId: 'retained-loss-artifact' }))
      .resolves.toMatchObject({ artifact: { id: 'retained-loss-artifact' }, bytes: 4 })
    await expect(server.handleRequest('team/artifact-read', { teamId: 'team', artifactId: 'private-loss-artifact' })).rejects.toMatchObject({
      data: { code: 'SDK_TEAM_ARTIFACT_NOT_FOUND' },
    })
    await expect(server.handleRequest('team/artifact-read', { teamId: 'team', artifactId: 'private' })).rejects.toMatchObject({
      data: { code: 'SDK_TEAM_ARTIFACT_NOT_FOUND' },
    })
    await expect(server.handleRequest('team/artifact-read', { teamId: 'team', artifactId: 'missing' })).rejects.toMatchObject({
      data: { code: 'SDK_TEAM_ARTIFACT_NOT_FOUND' },
    })

    await expect(server.handleRequest('team/artifact-read', { teamId: 'team', artifactId: 'child-report' }))
      .resolves.toMatchObject({ artifact: { id: 'child-report', uri: 'artifact://visible' }, bytes: 4 })
    expect(artifacts.read).toHaveBeenLastCalledWith('local', { reference: { ...visible, id: 'child-report' } })
    const readsBeforeCollision = artifacts.read.mock.calls.length
    await expect(server.handleRequest('team/artifact-read', { teamId: 'team', artifactId: 'ambiguous-report' })).rejects.toMatchObject({
      data: { code: 'SDK_TEAM_ARTIFACT_NOT_FOUND' },
    })
    expect(artifacts.read).toHaveBeenCalledTimes(readsBeforeCollision)

    artifacts.getProvider.mockReturnValue(undefined as never)
    await expect(server.handleRequest('team/artifact-read', { teamId: 'team', artifactId: 'visible' })).rejects.toMatchObject({
      data: { code: 'SDK_TEAM_ARTIFACT_UNAVAILABLE' },
    })
    artifacts.getProvider.mockReturnValue({ name: 'local' })
    artifacts.read.mockRejectedValueOnce(new TeamArtifactError('missing', 'TEAM_ARTIFACT_NOT_FOUND'))
    await expect(server.handleRequest('team/artifact-read', { teamId: 'team', artifactId: 'visible' })).rejects.toMatchObject({
      data: { code: 'SDK_TEAM_ARTIFACT_NOT_FOUND' },
    })
    await server.shutdown()
  })

  it('does not expose generic Team phase mutation through the SDK control plane', async () => {
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns: {},
      get: (name: string) => name === 'productPrincipals'
        ? testProductPrincipals()
        : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })

    await expect(server.handleRequest('team/phase', {})).rejects.toThrow('unknown SDK runtime method')
    await server.shutdown()
  })

  it('rejects every still-generic Team write until the SDK carries an authenticated actor', async () => {
    const teamRuns = {
      waitForFinal: vi.fn(),
      cancel: vi.fn(),
    }
    const get = vi.fn((name: string) => name === 'teams'
      ? {}
      : name === 'productPrincipals'
        ? testProductPrincipals()
        : name === 'teamHumanActors'
          ? undefined
          : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] })
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns,
      get,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })
    get.mockClear()

    const genericWrites: readonly (readonly [string, Record<string, unknown>])[] = [
      ['team/resume', { teamId: 'detached', expectedCursor: 0 }],
      ['team/wait-final', { teamId: 'detached' }],
      ['team/cancel', { teamId: 'detached' }],
    ]
    for (const [method, params] of genericWrites) {
      await expect(server.handleRequest(method, params)).rejects.toMatchObject({
        code: -32_002,
        data: { code: 'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE' },
        message: 'SDK Team management requires an authenticated human-proof route, but the mounted Team provider does not expose one.',
      })
    }
    expect(get).not.toHaveBeenCalledWith('teams')
    expect(teamRuns.waitForFinal).not.toHaveBeenCalled()
    expect(teamRuns.cancel).not.toHaveBeenCalled()
    await server.shutdown()
  })

  it('discovers installed channel capabilities and scopes explicit summaries to the authenticated human', async () => {
    const actor = Object.freeze({}) as TeamHumanActorProof
    let revoked = false
    const scopes: TeamHumanActorProofInput[] = []
    const humanActors = { async withProof<T>(call: AuthenticatedProductCall, input: TeamHumanActorProofInput,
      operation: (proof: TeamHumanActorProof) => Promise<T>): Promise<T> {
      call.signal.throwIfAborted()
      if (revoked) throw new TeamError('Membership revoked', 'TEAM_ACTOR_PROOF_INVALID')
      scopes.push(input)
      return await operation(actor)
    } }
    const capabilities = { allowedPolicies: ['summarized-window'], maxSourceEnvelopes: 8,
      maxSourceBytes: 65536, maxSummaryBytes: 1024, maxHistorySpan: 32 }
    const value = { type: 'channel/summary', sequence: 9, createdAt: 2,
      coveredSequenceRange: { from: 3, to: 5 }, sourceFingerprint: `sha256:${'0'.repeat(64)}`,
      sourceEnvelopeIds: ['source'], text: 'Saved.', policy: { type: 'summarized-window', version: 1 }, idempotencyKey: 'selection' }
    const summaries = { describe: () => capabilities, summarize: vi.fn(async (input: { requester: TeamHumanActorProof }) => {
      expect(input.requester).toBe(actor)
      return value
    }) }
    const teams = { listAdapters: () => [{ type: 'discussion', version: 1 }], listViewPolicies: () => [{ type: 'summarized-window', version: 1 }],
      getChannel: vi.fn(async () => ({ manifest: { teamId: 'team-1' } })) }
    const ctx = { on: vi.fn(() => () => undefined), agents: { create: vi.fn(), get: vi.fn() }, teamRuns: {},
      get: (name: string) => name === 'productPrincipals' ? testProductPrincipals() : name === 'teamHumanActors' ? humanActors
        : name === 'teams' ? teams : name === 'teamChannelSummaries' ? summaries : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await expect(server.handleRequest('team/channel-catalog', {})).rejects.toBeDefined()
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })
    expect(await server.handleRequest('team/channel-catalog', {})).toEqual({ adapters: teams.listAdapters(), viewPolicies: teams.listViewPolicies(), summary: capabilities })
    expect(scopes).toEqual([])
    const params = { channelId: 'channel-1', expectedCursor: 8, coveredSequenceRange: { from: 3, to: 5 }, idempotencyKey: 'selection' }
    await expect(server.handleRequest('team/channel-summarize', params)).resolves.toEqual({ value })
    expect(scopes).toEqual([channelSummaryHumanProofInput('team-1' as never, params as never)])
    expect(summaries.summarize).toHaveBeenCalledWith({ requester: actor, ...params })
    await expect(server.handleRequest('team/channel-summarize', { ...params, requester: 'forged' })).rejects.toMatchObject({ code: -32_602 })
    await expect(server.handleRequest('team/channel-catalog', { actor: 'forged' })).rejects.toMatchObject({ code: -32_602 })
    revoked = true
    await expect(server.handleRequest('team/channel-summarize', params)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(summaries.summarize).toHaveBeenCalledTimes(1)
    await server.shutdown()
  })

  it('binds channel pagination to exact authenticated membership and rejects forged or foreign selections', async () => {
    const actor = Object.freeze({}) as TeamHumanActorProof
    const scopes: TeamHumanActorProofInput[] = []
    let revoked = false
    const humanActors = { async withProof<T>(call: AuthenticatedProductCall, input: TeamHumanActorProofInput,
      operation: (proof: TeamHumanActorProof) => Promise<T>): Promise<T> {
      expect(call.principal.id).toBe(productPrincipalId('sdk-test-principal'))
      scopes.push(input)
      if (revoked) throw new TeamError('Membership revoked', 'TEAM_ACTOR_PROOF_INVALID')
      if (input.teamId !== 'team-1') throw new TeamError('Not a member', 'TEAM_HUMAN_ACTOR_NOT_FOUND')
      return await operation(actor)
    } }
    const teams = { listTeamChannels: vi.fn(async (input: { actor: TeamHumanActorProof }) => {
      expect(input.actor).toBe(actor)
      return { items: [], nextCursor: 4 }
    }) }
    const ctx = { on: vi.fn(() => () => undefined), agents: { create: vi.fn(), get: vi.fn() }, teamRuns: {},
      get: (name: string) => name === 'productPrincipals' ? testProductPrincipals() : name === 'teamHumanActors' ? humanActors
        : name === 'teams' ? teams : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })
    const params = { teamId: 'team-1', afterCursor: 2, limit: 2 }
    await expect(server.handleRequest('team/channel-list', params)).resolves.toEqual({ items: [], nextCursor: 4 })
    expect(scopes).toEqual([{ teamId: 'team-1', operation: 'channel-list-read', fence: { kind: 'read' }, payload: params }])
    await expect(server.handleRequest('team/channel-list', { ...params, actor: 'forged' })).rejects.toMatchObject({ code: -32_602 })
    await expect(server.handleRequest('team/channel-list', { ...params, limit: 0 })).rejects.toMatchObject({ code: -32_602 })
    await expect(server.handleRequest('team/channel-list', { ...params, teamId: 'foreign' })).rejects.toMatchObject({ code: 'TEAM_HUMAN_ACTOR_NOT_FOUND' })
    revoked = true
    await expect(server.handleRequest('team/channel-list', params)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(teams.listTeamChannels).toHaveBeenCalledTimes(1)
    await server.shutdown()
  })

  it('reads channel admission only through current membership proofs and rejects forged, foreign, and revoked calls', async () => {
    const actor = Object.freeze({}) as TeamHumanActorProof
    const foreign = new TeamError('Principal is not a Team member', 'TEAM_HUMAN_ACTOR_NOT_FOUND')
    const revoked = new TeamError('Channel metadata proof was revoked', 'TEAM_ACTOR_PROOF_INVALID')
    const crossTeam = new TeamError('Channel belongs to another Team', 'TEAM_INVALID_ARGUMENT')
    let mode: 'allow' | 'foreign' | 'revoked' = 'allow'
    let live = false
    const scopes: TeamHumanActorProofInput[] = []
    const value = { channel: { phase: 'pending' }, invitations: [{ status: 'pending' }], expectedNext: { kind: 'none' }, protocolStatus: { kind: 'other' } }
    const humanActors = {
      async withProof<T>(call: AuthenticatedProductCall, input: TeamHumanActorProofInput, operation: (proof: TeamHumanActorProof) => Promise<T>): Promise<T> {
        expect(call.principal.id).toBe(productPrincipalId('sdk-test-principal'))
        scopes.push(input)
        if (mode === 'foreign') throw foreign
        live = mode !== 'revoked'
        try { return await operation(actor) } finally { live = false }
      },
    }
    const teams = {
      getChannelAdmission: vi.fn(),
      getHumanChannelAdmission: vi.fn(async (input: { actor: TeamHumanActorProof; teamId: string; channelId: string }) => {
        expect(input.actor).toBe(actor)
        if (!live) throw revoked
        if (input.teamId !== 'team-1') throw crossTeam
        return value
      }),
    }
    const ctx = { on: vi.fn(() => () => undefined), agents: { create: vi.fn(), get: vi.fn() }, teamRuns: {},
      get: (name: string) => name === 'productPrincipals' ? testProductPrincipals() : name === 'teamHumanActors' ? humanActors
        : name === 'teams' ? teams : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })
    const params = { teamId: 'team-1', channelId: 'channel-1' }
    await expect(server.handleRequest('team/channel-admission', params)).resolves.toEqual({ value })
    expect(scopes).toEqual([{ teamId: 'team-1', operation: 'channel-admission-read', fence: { kind: 'read' }, payload: params }])
    expect(live).toBe(false)
    await expect(server.handleRequest('team/channel-admission', { ...params, actor: 'forged' })).rejects.toMatchObject({ code: -32_602 })
    expect(scopes).toHaveLength(1)
    await expect(server.handleRequest('team/channel-admission', { ...params, teamId: 'other-team' })).rejects.toBe(crossTeam)
    mode = 'foreign'
    await expect(server.handleRequest('team/channel-admission', params)).rejects.toBe(foreign)
    mode = 'revoked'
    await expect(server.handleRequest('team/channel-admission', params)).rejects.toBe(revoked)
    expect(teams.getChannelAdmission).not.toHaveBeenCalled()
    await server.shutdown()
  })

  it('archives a detached terminal Team through an exact authenticated human proof', async () => {
    const inputs: TeamHumanActorProofInput[] = []
    const archiveRequests: Record<string, unknown>[] = []
    const humanActors = {
      async withProof<T>(
        call: AuthenticatedProductCall,
        input: TeamHumanActorProofInput,
        operation: (actor: TeamHumanActorProof) => Promise<T>,
      ): Promise<T> {
        expect(call.principal.id).toBe(productPrincipalId('sdk-test-principal'))
        inputs.push(input)
        return await operation(Object.freeze({}) as TeamHumanActorProof)
      },
    }
    const teams = {
      archiveTeam: vi.fn(async (request: Record<string, unknown>) => {
        archiveRequests.push(request)
        return { team: { id: 'detached-terminal', archivedAt: 12 } }
      }),
    }
    const teamRuns = { archiveTerminal: vi.fn() }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns,
      get: (name: string) => name === 'productPrincipals'
        ? testProductPrincipals()
        : name === 'teamHumanActors'
          ? humanActors
          : name === 'teams'
            ? teams
            : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })

    await expect(server.handleRequest('team/archive', {
      teamId: 'detached-terminal', expectedCursor: 8,
    })).resolves.toEqual({ teamId: 'detached-terminal', archivedAt: 12 })
    expect(inputs).toEqual([{
      teamId: 'detached-terminal',
      operation: 'close',
      fence: { kind: 'cursor', cursor: 8 },
      payload: { teamId: 'detached-terminal', expectedCursor: 8 },
    }])
    expect(archiveRequests).toHaveLength(1)
    const archiveRequest = archiveRequests[0]
    if (archiveRequest === undefined) throw new Error('SDK archive did not reach the Team provider')
    expect(archiveRequest).toMatchObject({ teamId: 'detached-terminal', expectedCursor: 8 })
    expect(Object.hasOwn(archiveRequest, 'actor')).toBe(true)
    expect(teamRuns.archiveTerminal).not.toHaveBeenCalled()

    await expect(server.handleRequest('team/archive', {
      teamId: 'detached-terminal', expectedCursor: 8, actor: 'forged',
    })).rejects.toMatchObject({ code: -32_602 })
    await server.shutdown()
  })

  it('rejects SDK archive before Team lookup when the human binder is absent', async () => {
    const archiveTeam = vi.fn()
    const get = vi.fn((name: string) => {
      if (name === 'productPrincipals') return testProductPrincipals()
      if (name === 'teamHumanActors') return undefined
      if (name === 'teams') return { archiveTeam }
      return { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] }
    })
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns: {},
      get,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })
    get.mockClear()

    await expect(server.handleRequest('team/archive', {
      teamId: 'detached-terminal', expectedCursor: 8,
    })).rejects.toMatchObject({ data: { code: 'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE' } })
    expect(get).not.toHaveBeenCalledWith('teams')
    expect(archiveTeam).not.toHaveBeenCalled()
    await server.shutdown()
  })

  it('propagates foreign and stale archive rejections without TeamRun fallback', async () => {
    const foreign = new TeamError('Authenticated principal owns no active human Team participant', 'TEAM_HUMAN_ACTOR_NOT_FOUND')
    const stale = new TeamError('Team cursor is stale', 'TEAM_CURSOR_CONFLICT')
    let mode: 'foreign' | 'stale' = 'foreign'
    const humanActors = {
      async withProof<T>(
        _call: AuthenticatedProductCall,
        _input: TeamHumanActorProofInput,
        operation: (actor: TeamHumanActorProof) => Promise<T>,
      ): Promise<T> {
        if (mode === 'foreign') throw foreign
        return await operation(Object.freeze({}) as TeamHumanActorProof)
      },
    }
    const teams = { archiveTeam: vi.fn(async () => { throw stale }) }
    const teamRuns = { archiveTerminal: vi.fn() }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns,
      get: (name: string) => name === 'productPrincipals'
        ? testProductPrincipals()
        : name === 'teamHumanActors'
          ? humanActors
          : name === 'teams'
            ? teams
            : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })

    await expect(server.handleRequest('team/archive', {
      teamId: 'foreign-terminal', expectedCursor: 8,
    })).rejects.toBe(foreign)
    expect(teams.archiveTeam).not.toHaveBeenCalled()
    mode = 'stale'
    await expect(server.handleRequest('team/archive', {
      teamId: 'stale-terminal', expectedCursor: 9,
    })).rejects.toBe(stale)
    expect(teams.archiveTeam).toHaveBeenCalledOnce()
    expect(teamRuns.archiveTerminal).not.toHaveBeenCalled()
    await server.shutdown()
  })

  it('creates, completes, and cancels only Teams owned by this runtime', async () => {
    let serial = 0
    const teamRuns = {
      create: vi.fn(async () => ({
        teamId: `team-${++serial}`,
        coordinatorLease: { localAgent: { session: { id: SessionId(`coordinator-${serial}`) } } },
      })),
      postHumanInput: vi.fn(async ({ teamId }: { teamId: string }) => ({ id: `input-${teamId}` })),
      waitForFinal: vi.fn(async ({ teamId }: { teamId: string }) => ({
        teamId,
        channelId: `channel-${teamId}`,
        envelopeId: `final-${teamId}`,
        text: `Finished ${teamId}.`,
      })),
      cancel: vi.fn(async () => undefined),
    }
    const teams = {
      getTeam: vi.fn(async ({ teamId }: { teamId: string }) => ({
        team: { id: teamId, cursor: 4, phase: 'cancelled' as const },
      })),
    }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns,
      get: (name: string) => name === 'teams'
        ? teams
        : name === 'productPrincipals'
          ? testProductPrincipals()
          : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model', maxTokens: 321 })
    const created = await server.createTeam({ objective: 'Fix it.', contentBlocks: [{ type: 'text', text: 'Fix it.' }] })
    expect(created).toEqual({ teamId: 'team-1', coordinatorSessionId: 'coordinator-1', envelopeId: 'input-team-1' })
    expect(teamRuns.create).toHaveBeenCalledWith({
      admitHumanChannel: expect.any(Function) as (request: unknown) => Promise<void>,
      signal: expect.any(AbortSignal) as AbortSignal,
      objective: 'Fix it.',
      cwd: process.cwd(),
      selection: { provider: 'test-provider', model: 'test-model' },
      humanOwner: { kind: 'product-principal', principalId: productPrincipalId('sdk-test-principal') },
      maxTokens: 321,
    })
    expect(teamRuns.postHumanInput).toHaveBeenCalledWith({
      teamId: 'team-1', content: [{ type: 'text', text: 'Fix it.' }], delivery: 'turn',
      humanOwner: { kind: 'product-principal', principalId: productPrincipalId('sdk-test-principal') },
    })
    await expect(server.waitForTeamFinal({ teamId: created.teamId })).resolves.toEqual({
      teamId: 'team-1', channelId: 'channel-team-1', envelopeId: 'final-team-1', text: 'Finished team-1.',
    })
    await expect(server.cancelTeam({ teamId: created.teamId })).rejects.toMatchObject({
      data: { code: 'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE' },
    })
    await expect(server.handleRequest('team/create', {
      objective: 'Reject tool payload.',
      contentBlocks: [{ type: 'tool-call', id: 'call', name: 'bash', arguments: '{}' }],
    })).rejects.toMatchObject({ code: -32_602 })
    expect(teamRuns.create).toHaveBeenCalledTimes(1)

    const active = await server.createTeam({ objective: 'Cancel it.', contentBlocks: [{ type: 'text', text: 'Cancel it.' }] })
    await expect(server.cancelTeam({ teamId: active.teamId })).resolves.toEqual({ phase: 'cancelled' })
    expect(teamRuns.cancel).toHaveBeenCalledWith('team-2', {
      kind: 'product-principal', principalId: productPrincipalId('sdk-test-principal'),
    })
    await server.shutdown()
  })

  it('waits for an in-flight product Team creation before cancelling active ownership on shutdown', async () => {
    const createEntered = Promise.withResolvers<undefined>()
    const create = Promise.withResolvers<{
      teamId: string
      coordinatorLease: { localAgent: { session: { id: SessionId } } }
    }>()
    const inputEntered = Promise.withResolvers<undefined>()
    const input = Promise.withResolvers<{ id: string }>()
    const teamRuns = {
      create: vi.fn(() => {
        createEntered.resolve(undefined)
        return create.promise
      }),
      postHumanInput: vi.fn(() => {
        inputEntered.resolve(undefined)
        return input.promise
      }),
      cancel: vi.fn(async () => undefined),
    }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: vi.fn() },
      teamRuns,
      get: (name: string) => name === 'productPrincipals'
        ? testProductPrincipals()
        : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })

    const creating = server.createTeam({ objective: 'Race shutdown.', contentBlocks: [{ type: 'text', text: 'Race shutdown.' }] })
    await createEntered.promise
    const shuttingDown = server.shutdown()
    create.resolve({
      teamId: 'race-team',
      coordinatorLease: { localAgent: { session: { id: SessionId('race-coordinator') } } },
    })
    await inputEntered.promise
    input.resolve({ id: 'race-input' })

    await expect(creating).resolves.toEqual({
      teamId: 'race-team', coordinatorSessionId: 'race-coordinator', envelopeId: 'race-input',
    })
    await expect(shuttingDown).resolves.toEqual({})
    expect(teamRuns.cancel).toHaveBeenCalledWith('race-team', {
      kind: 'product-principal', principalId: productPrincipalId('sdk-test-principal'),
    })
  })

  it('forwards whole-agent status without attributing a turn outcome', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const transport = new FakeTransport()
    const server = new HarnessSdkJsonRpcServer(ctx, transport)
    const session = ctx.sessions.create(SessionId('message-outcome'))
    const agent = ({
      id: SessionId('message-outcome'),
      session,
    } satisfies Pick<Agent, 'id' | 'session'>) as Agent

    ctx.emit('agent/status', { agent, status: 'running' })
    ctx.emit('agent/status', { agent, status: 'idle' })

    expect(transport.notifications.filter(notification => notification.method === 'session.status'))
      .toEqual([
        { method: 'session.status', params: { sessionId: 'message-outcome', status: 'running' } },
        { method: 'session.status', params: { sessionId: 'message-outcome', status: 'idle' } },
      ])
    await server.shutdown()
    await ctx.fiber.dispose()
  })

  it('does not project child-session lineage onto the SDK wire', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'clocky-jsonrpc-subagent-'))
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)

      ctx.sessions.create(SessionId('root-session'), {
        meta: { cwd: storageDir },
      })
      ctx.sessions.create(SessionId('child-session'), {
        meta: { cwd: storageDir, parentSession: SessionId('main') },
      })

      expect(transport.notifications).toEqual([])

      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('does not project direct-subagent completion onto the SDK wire', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'clocky-jsonrpc-subagent-end-'))
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)

      const parentHandle = await ctx.agents.create({
        sessionId: SessionId('main'),
        meta: { cwd: storageDir },
        agentOptions: { provider: 'test-provider', model: 'test-model' },
      })
      // A custom in-process provider may own its child at the provider/root
      // scope while preserving durable parent lineage.
      const handle = await ctx.agents.create({
        sessionId: SessionId('child-session'),
        meta: { cwd: storageDir, parentSession: SessionId('main') },
        agentOptions: { provider: 'test-provider', model: 'test-model' },
      })
      expect(ctx.agents.roots()).toContain(handle.agent)
      const parentlessHandle = await parentHandle.agent.ctx.agents.create({
        sessionId: SessionId('parentless-child-session'),
        meta: { cwd: storageDir },
        agentOptions: { model: 'test-model' },
      })
      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'spawn',
        id: SessionId('child-session'),
        localAgent: handle.agent,
        stopReason: 'completed',
        lastAssistantMessage: [{ type: 'text', text: 'child done' }],
      }, () => handle.dispose())
      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'spawn',
        id: SessionId('parentless-child-session'),
        localAgent: parentlessHandle.agent,
        stopReason: 'error',
      }, () => parentlessHandle.dispose())

      expect(transport.notifications).toEqual([])

      await parentHandle.dispose()
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('ignores a remote run id that collides with a local child of the same parent', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'clocky-jsonrpc-subagent-remote-collision-'))
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)
      const parentHandle = await ctx.agents.create({
        sessionId: SessionId('collision-parent'),
        meta: { cwd: storageDir },
        agentOptions: { model: 'test-model' },
      })
      const collidingChild = await parentHandle.agent.ctx.agents.create({
        sessionId: SessionId('remote-run-id'),
        meta: { cwd: storageDir, parentSession: SessionId('collision-parent') },
        agentOptions: { model: 'test-model' },
      })

      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'remote',
        id: SessionId('remote-run-id'),
        localAgent: undefined,
        stopReason: 'completed',
        lastAssistantMessage: [],
      })

      expect(transport.notifications.some(notification =>
        notification.method === 'subagent.finished'
        && notification.params?.agentId === 'remote-run-id',
      )).toBe(false)

      await collidingChild.dispose()
      await parentHandle.dispose()
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('does not publish continuation-run lifecycle details', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'clocky-jsonrpc-subagent-continuation-'))
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)
      const parentHandle = await ctx.agents.create({
        sessionId: SessionId('continuation-parent'),
        meta: { cwd: storageDir },
        agentOptions: { model: 'test-model' },
      })
      const childHandle = await parentHandle.agent.ctx.agents.create({
        sessionId: SessionId('continuation-child'),
        meta: { cwd: storageDir, parentSession: SessionId('continuation-parent') },
        agentOptions: { model: 'test-model' },
      })

      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'continuation',
        id: SessionId('continuation-child'),
        localAgent: childHandle.agent,
        stopReason: 'completed',
        lastAssistantMessage: [{ type: 'text', text: 'first' }],
      })
      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'continuation',
        id: SessionId('continuation-child'),
        localAgent: childHandle.agent,
        stopReason: 'completed',
        lastAssistantMessage: [{ type: 'text', text: 'second' }],
      }, () => childHandle.dispose())

      expect(transport.notifications).toEqual([])

      await parentHandle.dispose()
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('does not publish reused direct-subagent ids', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'clocky-jsonrpc-subagent-reuse-'))
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)
      const oldParent = await ctx.agents.create({
        sessionId: SessionId('old-parent'),
        meta: { cwd: storageDir },
        agentOptions: { model: 'test-model' },
      })
      const oldChild = await oldParent.agent.ctx.agents.create({
        sessionId: SessionId('reused-child'),
        meta: { cwd: storageDir, parentSession: SessionId('old-parent') },
        agentOptions: { model: 'test-model' },
      })
      const first = Promise.withResolvers<SubagentResult>()
      const sameLifetime = Promise.withResolvers<SubagentResult>()
      const replacement = Promise.withResolvers<SubagentResult>()
      const results = [first.promise, sameLifetime.promise, replacement.promise]
      let starts = 0
      let currentLocalAgent = oldChild.agent
      const disposeProvider = ctx.subagents.registerProvider({
        name: 'reused',
        capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
        inheritsParentContext: false,
        start() {
          const result = results[starts]
          starts += 1
          if (result === undefined) throw new Error('unexpected fourth reused-id run')
          return Promise.resolve({ id: SessionId('reused-child'), localAgent: currentLocalAgent, result, dispose: () => Promise.resolve() })
        },
      })

      const firstRun = await ctx.subagents.start('reused', {
        parent: oldParent.agent,
        prompt: [],
        signal: new AbortController().signal,
      })
      const sameLifetimeRun = await ctx.subagents.start('reused', {
        parent: oldParent.agent,
        prompt: [],
        signal: new AbortController().signal,
      })
      sameLifetime.resolve({ output: [{ type: 'text', text: 'same lifetime' }], stopReason: 'completed' })
      await sameLifetimeRun.result
      await oldChild.dispose()
      const newParent = await ctx.agents.create({
        sessionId: SessionId('new-parent'),
        meta: { cwd: storageDir },
        agentOptions: { model: 'test-model' },
      })
      const newChild = await newParent.agent.ctx.agents.create({
        sessionId: SessionId('reused-child'),
        meta: { cwd: storageDir, parentSession: SessionId('new-parent') },
        agentOptions: { model: 'test-model' },
      })
      currentLocalAgent = newChild.agent
      const secondRun = await ctx.subagents.start('reused', {
        parent: newParent.agent,
        prompt: [],
        signal: new AbortController().signal,
      })

      replacement.resolve({ output: [{ type: 'text', text: 'new lifetime' }], stopReason: 'completed' })
      await secondRun.result
      first.resolve({ output: [{ type: 'text', text: 'old lifetime' }], stopReason: 'completed' })
      await firstRun.result
      await Promise.resolve()

      expect(transport.notifications).toEqual([])

      await firstRun.dispose()
      await sameLifetimeRun.dispose()
      await secondRun.dispose()
      disposeProvider()
      await newChild.dispose()
      await oldParent.dispose()
      await newParent.dispose()
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('does not publish direct-subagent details across provider re-registration', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'clocky-jsonrpc-subagent-provider-reuse-'))
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)
      const parent = await ctx.agents.create({
        sessionId: SessionId('provider-reuse-parent'),
        meta: { cwd: storageDir },
        agentOptions: { model: 'test-model' },
      })
      const child = await parent.agent.ctx.agents.create({
        sessionId: SessionId('provider-reuse-child'),
        meta: { cwd: storageDir, parentSession: SessionId('provider-reuse-parent') },
        agentOptions: { model: 'test-model' },
      })
      const localResult = Promise.withResolvers<SubagentResult>()
      const remoteResult = Promise.withResolvers<SubagentResult>()
      const unregisterLocal = ctx.subagents.registerProvider({
        name: 'reused-provider',
        capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
        inheritsParentContext: false,
        start: () => Promise.resolve({
          id: SessionId('provider-reuse-child'),
          localAgent: child.agent,
          result: localResult.promise,
          dispose: () => Promise.resolve(),
        }),
      })
      const localRun = await ctx.subagents.start('reused-provider', {
        parent: parent.agent,
        prompt: [],
        signal: new AbortController().signal,
      })
      unregisterLocal()

      const unregisterRemote = ctx.subagents.registerProvider({
        name: 'reused-provider',
        capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
        inheritsParentContext: false,
        start: () => Promise.resolve({
          id: SessionId('provider-reuse-child'),
          localAgent: undefined,
          result: remoteResult.promise,
          dispose: () => Promise.resolve(),
        }),
      })
      const remoteRun = await ctx.subagents.start('reused-provider', {
        parent: parent.agent,
        prompt: [],
        signal: new AbortController().signal,
      })

      remoteResult.resolve({ output: [{ type: 'text', text: 'remote' }], stopReason: 'completed' })
      await remoteRun.result
      await Promise.resolve()
      expect(transport.notifications.some(notification =>
        notification.method === 'subagent.finished'
        && notification.params?.lastAssistantMessage !== undefined,
      )).toBe(false)

      await child.dispose()
      localResult.resolve({ output: [{ type: 'text', text: 'local' }], stopReason: 'completed' })
      await localRun.result
      await Promise.resolve()
      expect(transport.notifications).toEqual([])

      await localRun.dispose()
      await remoteRun.dispose()
      unregisterRemote()
      await parent.dispose()
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('does not publish direct-subagent details when the server misses run start', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'clocky-jsonrpc-subagent-fallback-'))
    const ctx = await makeHarness(storageDir)
    let parentHandle: AgentHandle | undefined
    let handle: AgentHandle | undefined
    let failedHandle: AgentHandle | undefined
    try {
      parentHandle = await ctx.agents.create({
        sessionId: SessionId('fallback-parent'),
        meta: { cwd: storageDir },
        agentOptions: { provider: 'test-provider', model: 'test-model' },
      })
      handle = await parentHandle.agent.ctx.agents.create({
        sessionId: SessionId('fallback-child-session'),
        meta: { cwd: storageDir, parentSession: SessionId('fallback-parent') },
        agentOptions: { provider: 'test-provider', model: 'test-model' },
      })
      const fallbackChild = handle.agent
      failedHandle = await parentHandle.agent.ctx.agents.create({
        sessionId: SessionId('failed-child-session'),
        meta: { cwd: storageDir },
        agentOptions: { provider: 'test-provider', model: 'test-model' },
      })
      const missedStartResult = Promise.withResolvers<SubagentResult>()
      const disposeMissedStartProvider = ctx.subagents.registerProvider({
        name: 'fork',
        capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
        inheritsParentContext: true,
        start: () => Promise.resolve({
          id: SessionId('fallback-child-session'),
          localAgent: fallbackChild,
          result: missedStartResult.promise,
          dispose: () => Promise.resolve(),
        }),
      })
      // Start before the server subscribes. The terminal payload still carries
      // this run's exact local child without reconstructing it from ids.
      const missedStartRun = await ctx.subagents.start('fork', {
        parent: parentHandle.agent,
        prompt: [],
        signal: new AbortController().signal,
      })
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)

      missedStartResult.resolve({ output: [], stopReason: 'max-tokens' })
      await missedStartRun.result
      await Promise.resolve()
      await missedStartRun.dispose()
      disposeMissedStartProvider()
      // The server also missed this agent's creation but sees the exact child
      // on the run lifecycle payload.
      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'fork-live-fallback',
        id: SessionId('fallback-child-session'),
        localAgent: fallbackChild,
        stopReason: 'completed',
        lastAssistantMessage: [],
      })
      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'fork',
        id: SessionId('failed-child-session'),
        localAgent: failedHandle.agent,
        stopReason: 'error',
      })
      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'fork',
        id: SessionId('missing-child-agent'),
        localAgent: undefined,
        stopReason: 'error',
      })

      expect(transport.notifications).toEqual([])

      await server.shutdown()
    } finally {
      await handle?.dispose()
      await failedHandle?.dispose()
      await parentHandle?.dispose()
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('does not re-register an LLM adapter whose provider already has an owner', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'clocky-jsonrpc-existing-llm-'))
    const ctx = await makeHarness(storageDir)
    vi.stubEnv('TEST_API_KEY', 'test-key')
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
      const inspect = server as unknown as { hasAdapterFor(provider: string): boolean }

      expect(inspect.hasAdapterFor('test-provider')).toBe(true)
      expect(inspect.hasAdapterFor('missing-provider')).toBe(false)
      await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: storageDir, provider: 'test-provider', model: 'preinstalled-model' })

      expect(ctx.get('llm')?.listProviders().filter(provider => provider.id === 'test-provider')).toEqual([{ id: 'test-provider', name: 'test-provider' }])
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('rejects a missing provider when an LLM service already exists', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'clocky-jsonrpc-new-llm-'))
    const ctx = await makeHarness(storageDir)
    vi.stubEnv('TEST_API_KEY', 'test-key')
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

      await expect(server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: storageDir, provider: 'private', model: 'new-model' }))
        .rejects.toThrow('no adapter registered for provider "private"')

      expect(ctx.get('llm')?.listProviders()).toEqual([{ id: 'test-provider', name: 'test-provider' }])
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid initialize maxTokens %s at the wire boundary',
    async (maxTokens) => {
      const storageDir = await mkdtemp(join(tmpdir(), 'clocky-jsonrpc-invalid-max-tokens-'))
      const ctx = await makeHarness(storageDir)
      try {
        const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
        await expect(server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: storageDir,
          provider: 'test-provider',
          model: 'model',
          maxTokens,
        })).rejects.toThrow('initialize maxTokens must be a positive safe integer')
        await server.shutdown()
      } finally {
        await ctx.fiber.dispose()
        await rm(storageDir, { recursive: true, force: true })
      }
    },
  )

  it('reports no adapter when the LLM service is absent', async () => {
    const ctx = new Context()
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport()) as unknown as {
        hasAdapterFor(model: string): boolean
        shutdown(): Promise<Record<string, never>>
      }

      expect(server.hasAdapterFor('missing-model')).toBe(false)
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects unknown JSON-RPC runtime methods', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'clocky-jsonrpc-unknown-'))
    const ctx = await makeHarness(storageDir)
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
      await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: storageDir, provider: 'test-provider', model: 'test-model' })

      await expect(server.handleRequest('does/not/exist', {}))
        .rejects
        .toThrow('unknown SDK runtime method: does/not/exist')

      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('settles every product-Team teardown and aggregates multiple failures', async () => {
    const firstCancel = vi.fn(() => { throw new Error('first teardown failed') })
    const secondCancel = vi.fn(() => Promise.reject(new Error('second teardown failed')))
    const cancel = vi.fn((teamId: string) => teamId === 'first' ? firstCancel() : secondCancel())
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: () => undefined },
      teamRuns: { cancel },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport()) as unknown as {
      productTeams: Map<string, { run: { teamId: string }; state: 'active' | 'terminal' }>
      shutdown(): Promise<Record<string, never>>
    }
    server.productTeams.set('first', { run: { teamId: 'first' }, state: 'active' })
    server.productTeams.set('second', { run: { teamId: 'second' }, state: 'active' })
    server.productTeams.set('terminal', { run: { teamId: 'terminal' }, state: 'terminal' })

    await expect(server.shutdown()).rejects.toThrow('SDK server teardown failed')
    expect(firstCancel).toHaveBeenCalledOnce()
    expect(secondCancel).toHaveBeenCalledOnce()
    expect(cancel).not.toHaveBeenCalledWith('terminal')
  })

  it('continues teardown after a subscription disposer fails', async () => {
    let subscription = 0
    const listenerFailure = new Error('listener teardown failed')
    const on = vi.fn(() => {
      subscription += 1
      return subscription === 1 ? () => { throw listenerFailure } : () => undefined
    })
    const ctx = {
      on,
      agents: { create: vi.fn(), get: () => undefined },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

    await expect(server.shutdown()).rejects.toBe(listenerFailure)
    expect(on).toHaveBeenCalledTimes(5)
  })
})
