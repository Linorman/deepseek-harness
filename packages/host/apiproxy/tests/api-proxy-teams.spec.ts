import { task as inspectionTaskFixture, settledAttempt as inspectionAttemptFixture } from '../../../team/team-hub/tests/fixtures.ts'
import * as BasicChannel from '@clocky/clocky-team-channel-basic'
import * as ChannelSummary from '@clocky/clocky-team-channel-summary'
import AttachmentLocal from '@clocky/clocky-attachment-local'
import { foldTeamRecord } from '../../../team/team-hub/src/fold.ts'
import { teamJournalRecordSchema } from '../../../team/team-hub/src/schema.ts'
import ApprovalService from '@clocky/clocky-user-approval'
import { teamHumanActionResponseIdempotencyKeySchema } from '@clocky/clocky-team'
import * as TeamHumanInbox from '../../../team/team-human-client/src/index.ts'
import { createPrincipalChannelAdmission } from '@clocky/clocky-team-channel-admission/principal'
import { join } from 'node:path'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, onTestFailed, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import AgentDefaultModelConfig from '@clocky/clocky-agent-default-model'
import type {} from '@clocky/clocky-agent-presets'
import AgentLoop from '@clocky/clocky-agent-loop'
import { mountAgentLoopTestDependencies } from '@clocky/clocky-agent-loop-testkit'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import * as InProcessRuntime from '@clocky/clocky-agent-runtime-in-process'
import { LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { MessageId } from '@clocky/clocky-llm/brand'
import { AttachmentError } from '@clocky/clocky-attachment'
import { SessionId } from '@clocky/clocky-session'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import ProductPrincipalRegistry from '@clocky/clocky-product-principal'
import TeamChannelAdmission from '@clocky/clocky-team-channel-admission'
import TeamHub from '@clocky/clocky-team-hub'
import TeamClosureDriverHub from '@clocky/clocky-team-closure-driver/hub'
import TeamClosureDriveBackendRegistry from '@clocky/clocky-team-closure-driver/registry'
import { TeamError, channelIdSchema, channelPostIdempotencyKeySchema, teamClosureIdempotencyKeySchema, teamIdSchema, teamTaskCreateIdempotencyKeySchema } from '@clocky/clocky-team'
import type { ActivationBindingSnapshot, ParticipantSnapshot, TeamId, TeamStateSnapshot, TeamSystemClosureProof, TeamSystemClosureScope } from '@clocky/clocky-team'
import * as TeamActivationController from '@clocky/clocky-team-activation-controller'
import * as TeamAgentClient from '@clocky/clocky-team-agent-client'
import { DIRECT_CHANNEL_FINAL_ENVELOPE_KIND, DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND } from '@clocky/clocky-team-channel-direct'
import * as DirectChannel from '@clocky/clocky-team-channel-direct'
import * as TeamHumanActor from '@clocky/clocky-team-human-actor'
import TeamLinkRegistry from '@clocky/clocky-team-link'
import * as TeamLinkLocal from '@clocky/clocky-team-link-local'
import * as TeamClosureDriver from '../../../team/team-closure-driver/src/index.ts'
import * as TeamRun from '@clocky/clocky-team-run'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import { postActor, assignTestTask, seedTeamPhase } from '../../../team/team-hub/tests/fixtures.ts'
import UserQuestionService from '@clocky/clocky-user-questions'
import type { ApiProxy, MuxFrame, RpcResponse } from '../src/api/index.ts'
import { RpcId } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import { withAuthenticatedProductCall } from '../src/authenticated-product-call.ts'
import { InProcessApiClient } from '../src/fetch/client.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'

const CHANNEL_MEDIA_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC'
const contexts = new Set<Context>()
const roots: string[] = []
const adapters = new Set<GateAdapter>()
const productCallSignal = new AbortController().signal
const authenticatedProductCall: AuthenticatedProductCall = {
  principal: {
    id: 'test-product-principal' as never,
    issuer: 'test',
    subject: 'test-user',
    assurance: 'test',
    credentialGeneration: 1,
  },
  credentialGeneration: 1,
  signal: productCallSignal,
}
const foreignAuthenticatedProductCall: AuthenticatedProductCall = {
  ...authenticatedProductCall,
  principal: {
    ...authenticatedProductCall.principal,
    id: 'other-product-principal' as never,
    subject: 'other-test-user',
  },
}

/** Route in-process Team calls through the same runtime-only context as the Host transport. */
function authenticatedFetch(
  api: ApiProxy,
  productCall = authenticatedProductCall,
): ReturnType<typeof toFetchHandler> {
  return toFetchHandler(api, { authenticatedProductCall: productCall })
}

afterEach(async () => {
  const failures: unknown[] = []
  for (const adapter of adapters) adapter.release.resolve(undefined)
  adapters.clear()
  for (const ctx of contexts) {
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
  if (failures.length > 0) throw new AggregateError(failures, 'Team API test cleanup failed')
})

class GateAdapter extends LlmAdapter {
  readonly started = Promise.withResolvers<undefined>()
  readonly release = Promise.withResolvers<undefined>()

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Team API test' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Team API test' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    this.started.resolve(undefined)
    await this.release.promise
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function setup(
  adapter: GateAdapter,
  seedBeforeTeamRun?: (ctx: Context) => Promise<void>,
  mountTeamRun = true,
  rootOverride?: string,
  channelInvitationTimeoutMs?: number,
): Promise<Context> {
  const root = rootOverride ?? await freshRoot()
  const ctx = new Context()
  contexts.add(ctx)
  adapters.add(adapter)
  await mountAgentLoopTestDependencies(ctx)
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'mock', model: 'mock' })
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'hub') })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  await ctx.plugin(TeamHub, channelInvitationTimeoutMs === undefined ? {} : { channelInvitationTimeoutMs })
  await ctx.plugin(TeamChannelAdmission)
  await ctx.plugin(ProductPrincipalRegistry)
  await ctx.plugin(TeamHumanActor)
  await ctx.plugin(TeamHumanInbox, { storagePageSize: 2, maxPageSize: 2, maxDeliveryBytes: 65536,
    maxPendingOperations: 16, watchTimeoutMs: 100, pollIntervalMs: 5 })
  await ctx.plugin(DirectChannel)
  await ctx.plugin(AgentRuntime)
  await ctx.plugin(InProcessRuntime, { providerName: 'in-process' })
  await ctx.plugin(TeamActivationController)
  await ctx.plugin(TeamLinkRegistry)
  await ctx.plugin(TeamLinkLocal, {
    providerName: 'local', pageSize: 32, disposalTimeoutMs: 100, notificationRetryDelayMs: 1,
  })
  await ctx.plugin(TeamAgentClient, { reconnectDelayMs: 1, disposalTimeoutMs: 100 })
  await seedBeforeTeamRun?.(ctx)
  if (mountTeamRun) await ctx.plugin(TeamRun)
  await ctx.plugin(TeamClosureDriveBackendRegistry)
  await ctx.plugin(TeamClosureDriverHub, { backend: 'hub' })
  await ctx.plugin(TeamClosureDriver, {
    backend: 'hub', maxTeamsPerDrive: 8, pageSize: 4, disposalTimeoutMs: 100,
  })
  return ctx
}

async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'api-proxy-team-'))
  roots.push(root)
  return root
}

function value<T>(response: RpcResponse<T>): T {
  if (!response.result.ok) throw new Error(response.result.error.message)
  return response.result.value
}

function expectTeamActorUnavailable<T>(response: RpcResponse<T>, teamId?: TeamId): void {
  expect(response.result).toEqual({
    ok: false,
    error: {
      code: 'team-run-unavailable',
      message: 'This Host Team control operation requires an authenticated Team actor, but none is available.',
      details: teamId === undefined ? {} : { teamId },
    },
  })
}

function required<T>(item: T | undefined, name: string): T {
  if (item === undefined) throw new Error(`${name} was not persisted`)
  return item
}

async function postFinal(
  ctx: Context,
  state: TeamStateSnapshot,
  human: ParticipantSnapshot,
  binding: ActivationBindingSnapshot,
): Promise<void> {
  const channelId = required(state.channelIds[0], 'default Team channel')
  const link = await ctx.teamLinks.connect({ provider: 'local', binding })
  try {
    const channel = await ctx.teams.getChannel({ channelId })
    await link.post({
      expectedCursor: channel.cursor,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('host-team-final'),
      draft: {
        channelId,
        audience: [human.id],
        kind: DIRECT_CHANNEL_FINAL_ENVELOPE_KIND,
        payload: { text: 'Final result from the coordinator.' },
        delivery: 'turn',
      },
    })
  } finally {
    await link.close()
  }
}

/** Admit setup failure for a detached Team with one immutable human operation grant. */
async function failHumanTeam(ctx: Context, operation: 'close' | 'send'): Promise<TeamStateSnapshot> {
  const created = await createTestRootTeam(ctx, {
    goal: { objective: 'Archive a detached terminal Team.', budgets: {} }, rules: {}, budgets: {},
  })
  let state = await ctx.teams.getTeam({ teamId: created.team.id })
  const human = await inviteBootstrapParticipant(ctx, {
    teamId: created.team.id,
    expectedCursor: state.team.cursor,
    kind: 'human',
    displayName: 'Detached terminal owner',
    role: 'owner',
    capabilities: [],
    owner: { kind: 'product-principal', principalId: authenticatedProductCall.principal.id },
    authorityGrant: { operations: [operation], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} },
  })
  state = await ctx.teams.getTeam({ teamId: created.team.id })
  await transitionBootstrapParticipant(ctx, {
    teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId: created.team.id })
  await transitionBootstrapParticipant(ctx, {
    teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'active',
  })
  const actor = Object.freeze({}) as TeamSystemClosureProof
  const scopes = new WeakMap<TeamSystemClosureProof, TeamSystemClosureScope>([
    [actor, { kind: 'team-run-create-failure', teamId: created.team.id }],
  ])
  const unregister = ctx.teams.registerSystemClosureProofSource({
    name: 'team-run', resolveClosureProof: proof => scopes.get(proof),
  })
  try {
    return await ctx.teams.failTeam({ actor, teamId: created.team.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse('detached-owner-setup-failure'),
      reason: { code: 'SETUP_FAILED', message: 'The fixture owner stopped before creating an activation.' },
    })
  } finally { unregister() }
}

describe('Team API', () => {
  it('refuses TeamRun mutations without a runtime product call before TeamRun work begins', async () => {
    const ctx = await setup(new GateAdapter())
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })
    if (api.teams === undefined) throw new Error('Team API was not registered')
    const create = vi.spyOn(ctx.teamRuns, 'create').mockRejectedValue(new TeamRun.TeamRunError(
      'test TeamRun route', 'TEAM_RUN_WORKER_PRESET_REQUIRED',
    ))
    const request = { rpcId: RpcId('missing-product-auth'), payload: { objective: 'Require product authentication.' } }

    await expect(api.teams.create(request, new AbortController().signal)).resolves.toMatchObject({
      result: { ok: false, error: { code: 'PRODUCT_AUTH_REQUIRED' } },
    })
    expect(create).not.toHaveBeenCalled()

    const response = await authenticatedFetch(api).fetch(new Request('http://x/api/team.create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'with-product-auth', method: 'team.create', payload: request.payload }),
    }))
    expect(await response.json()).toMatchObject({
      result: { ok: false, error: { code: 'team-run-unavailable', message: 'test TeamRun route' } },
    })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('fails a principal callback without durable consent and retries the same start key through the real endpoint', async () => {
    const adapter = new GateAdapter()
    const ctx = await setup(adapter)
    const input = { objective: 'Require real endpoint consent.', cwd: process.cwd(),
      humanOwner: { kind: 'product-principal' as const, principalId: authenticatedProductCall.principal.id },
      idempotencyKey: channelPostIdempotencyKeySchema.parse('principal-admission-retry'),
      content: [{ type: 'text' as const, text: 'Start after endpoint consent.' }] }
    await expect(ctx.teamRuns.start({ ...input, admitHumanChannel: () => Promise.resolve() })).rejects.toThrow()
    const failed = (await ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).items[0]!
    expect(failed.phase).toBe('failed')
    const failedState = await ctx.teams.getTeam({ teamId: failed.id })
    expect(failedState.activations).toEqual([])
    const failedAdmission = await ctx.teams.getChannelAdmission({ channelId: failedState.channelIds[0]! })
    expect(failedAdmission.channel.phase).toBe('closed')
    expect(failedAdmission.invitations.every(value => value.status === 'cancelled')).toBe(true)
    const accepted = await ctx.teamRuns.start({ ...input,
      admitHumanChannel: createPrincipalChannelAdmission(ctx, authenticatedProductCall) })
    expect(accepted.handle.teamId).not.toBe(failed.id)
    expect(accepted.handle.channel.phase).toBe('active')
    expect(accepted.input.kind).toBe('message')
    expect(await ctx.teamRuns.start({ ...input,
      admitHumanChannel: createPrincipalChannelAdmission(ctx, authenticatedProductCall) })).toEqual(accepted)
  })

  for (const kind of ['question', 'approval'] as const) {
    it(`answers a durable ${kind} through the principal inbox and retains same-key retries`, async () => {
      const adapter = new GateAdapter()
      const ctx = await setup(adapter)
      if (kind === 'approval') await ctx.plugin(ApprovalService)
      const api = createApiProxy(ctx, { defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(), cwd: process.cwd() })
      const client = new InProcessApiClient(authenticatedFetch(api))
      const foreign = new InProcessApiClient(authenticatedFetch(api, foreignAuthenticatedProductCall))
      const state = value(await client.teams.create({ objective: 'Answer one human request.', cwd: process.cwd() }))
      const coordinator = required(state.participants.find(member => member.role === 'coordinator'), 'coordinator')
      const binding = required(state.activations.find(value => value.activation.participantId === coordinator.id), 'coordinator binding')
      const agent = required(ctx.agents.get(binding.sessionId), 'coordinator Agent')
      if (kind === 'approval') {
        value(await client.teams.postInput({ teamId: state.team.id, text: 'Start an approval-bearing turn.' }))
        await adapter.started.promise
      }
      const asked = kind === 'approval' ? ctx.approval.request({ agent, toolName: 'bash', reason: 'Run the requested check' })
        : ctx.userQuestions.ask({ agent, questions: [{ id: 'continue', question: 'Continue?', options: [{ label: 'Proceed' }] }] })
      let action: import('@clocky/clocky-team').TeamHumanActionSnapshot | undefined
      await vi.waitFor(async () => {
        const page = value(await client.teams.inboxRead({}))
        action = page.items.find(item => item.kind === 'action' && item.action.phase === 'pending')?.kind === 'action'
          ? (page.items.find(item => item.kind === 'action' && item.action.phase === 'pending') as import('@clocky/clocky-team').TeamHumanInboxAction).action : undefined
        expect(action?.kind).toBe(kind)
      })
      const current = required(action, 'inbox action')
      const answer: import('@clocky/clocky-team').TeamHumanActionAnswer = kind === 'approval'
        ? { kind: 'approval', outcome: 'allowed-once' }
        : { kind: 'question', answers: [{ id: 'continue', selected: ['Proceed'] }] }
      const input = { teamId: state.team.id, actionId: current.id, expectedUpdatedAt: current.updatedAt,
        idempotencyKey: teamHumanActionResponseIdempotencyKeySchema.parse(`inbox-${kind}-answer`), answer }
      expect((await foreign.teams.inboxRespond(input)).result.ok).toBe(false)
      expect((await client.teams.inboxRespond({ ...input, expectedUpdatedAt: input.expectedUpdatedAt - 1 })).result.ok).toBe(false)
      const accepted = value(await client.teams.inboxRespond(input))
      expect(accepted.kind).toBe('accepted')
      expect(accepted.action.response).toMatchObject({ idempotencyKey: input.idempotencyKey, answer })
      await expect(asked).resolves.toEqual(kind === 'approval' ? 'allowed-once' : { answers: [{ id: 'continue', selected: ['Proceed'] }] })
      await vi.waitFor(async () => {
        expect((await ctx.teams.getTeam({ teamId: state.team.id })).humanActions?.find(value => value.id === current.id)?.phase).toBe('resolved')
      })
      const stream = required(ctx.storageLog.get(`team/${state.team.id}`), 'Team journal')
      let projection: ReturnType<typeof foldTeamRecord> | undefined
      let rejectedMissingAcceptance = false
      for (const row of await stream.read(-1, 128)) {
        const record = teamJournalRecordSchema.parse(row.value)
        if (record.type === 'human-action/changed' && record.action.phase === 'pending' && record.action.response !== undefined) {
          expect(() => foldTeamRecord(projection, { ...record, action: { ...record.action, phase: 'resolved', outcome: { kind: 'answered' } } },
            row.sequence, state.team.id)).toThrow('invalid terminal or response transition')
          rejectedMissingAcceptance = true
        }
        projection = foldTeamRecord(projection, record, row.sequence, state.team.id)
      }
      expect(rejectedMissingAcceptance).toBe(true)
      expect(value(await client.teams.inboxRespond(input)).kind).toBe('accepted')
      expect((await client.teams.inboxRespond({ ...input,
        idempotencyKey: teamHumanActionResponseIdempotencyKeySchema.parse('different-answer-key') })).result.ok).toBe(false)
      adapter.release.resolve(undefined)
    })
  }

  for (const window of ['pending', 'accepted'] as const) {
    it(`stalls a restarted Host with an unrecoverable ${window} question continuation`, async () => {
      const first = await setup(new GateAdapter())
      const api = createApiProxy(first, { defaultModelSelection: () => first.agentDefaultModel.currentSelection(), cwd: process.cwd() })
      const client = new InProcessApiClient(authenticatedFetch(api))
      const state = value(await client.teams.create({ objective: 'Recover a human question.', cwd: process.cwd() }))
      const coordinator = required(state.participants.find(member => member.role === 'coordinator'), 'coordinator')
      const binding = required(state.activations.find(value => value.activation.participantId === coordinator.id), 'coordinator binding')
      const agent = required(first.agents.get(binding.sessionId), 'coordinator Agent')
      const abort = new AbortController()
      const asked = first.userQuestions.ask({ agent, signal: abort.signal,
        questions: [{ id: 'continue', question: 'Continue?', options: [{ label: 'Proceed' }] }] }).catch((error: unknown) => error)
      let action: import('@clocky/clocky-team').TeamHumanActionSnapshot | undefined
      await vi.waitFor(async () => {
        action = (await first.teams.getTeam({ teamId: state.team.id })).humanActions?.find(value => value.phase === 'pending')
        expect(action).toBeDefined()
      })
      const pending = required(action, 'pending action')
      expect(value(await client.teams.actionRead({ teamId: state.team.id, actionId: pending.id }))).toEqual(pending)
      const input = { teamId: state.team.id, actionId: pending.id, expectedUpdatedAt: pending.updatedAt,
        idempotencyKey: teamHumanActionResponseIdempotencyKeySchema.parse('restart-question-answer'),
        answer: { kind: 'question' as const, answers: [{ id: 'continue', selected: ['Proceed'] }] } }
      const release = Promise.withResolvers<undefined>()
      let responding: ReturnType<typeof client.teams.inboxRespond> | undefined
      if (window === 'accepted') {
        const accepted = Promise.withResolvers<undefined>()
        const original = first.teams.acceptHumanActionResponse.bind(first.teams)
        vi.spyOn(first.teams, 'acceptHumanActionResponse').mockImplementation(async (request) => {
          const result = await original(request)
          accepted.resolve(undefined)
          await release.promise
          return result
        })
        responding = client.teams.inboxRespond(input)
        await accepted.promise
      }
      const restoredRoot = await freshRoot()
      const copy = new StorageJson.JsonStorageBackend(join(restoredRoot, 'hub'))
      try {
        // Replaying accepted business prefixes models process loss without copying a live JSON owner lock.
        for (const info of await first.storageLog.list()) {
          if (info.name.startsWith('principal-inbox/')) continue
          const source = required(first.storageLog.get(info.name), 'owned source stream')
          const target = await copy.log.open({ name: info.name, version: info.version })
          try {
            let cursor = -1
            let projection: ReturnType<typeof foldTeamRecord> | undefined
            for (;;) {
              const rows = await source.read(cursor, 32)
              if (rows.length === 0) break
              if (info.name.startsWith('team/')) {
                const teamId = teamIdSchema.parse(info.name.slice('team/'.length))
                for (const row of rows) {
                  projection = foldTeamRecord(projection, teamJournalRecordSchema.parse(row.value), row.sequence, teamId)
                }
              }
              await target.append(target.tailSequence, rows.map(row => row.value),
                projection === undefined ? undefined : { summary: projection.team })
              cursor = rows[rows.length - 1]!.sequence
            }
          } finally { await target.close() }
        }
      } finally { await copy.close(); release.resolve(undefined) }
      if (responding !== undefined) value(await responding)
      else abort.abort()
      await asked
      await vi.waitFor(async () => {
        expect((await first.teams.getTeam({ teamId: state.team.id })).humanActions?.find(value => value.id === pending.id)?.phase).not.toBe('pending')
      })
      await first.fiber.dispose()
      contexts.delete(first)
      const recovered = await setup(new GateAdapter(), undefined, false, restoredRoot)
      const recoveredClient = new InProcessApiClient(authenticatedFetch(createApiProxy(recovered, {
        defaultModelSelection: () => recovered.agentDefaultModel.currentSelection(), cwd: process.cwd(),
      })))
      const replay = await recovered.teams.getTeam({ teamId: state.team.id })
      expect(replay.humanActions?.find(value => value.id === pending.id)?.phase).toBe('pending')
      const result = value(await recoveredClient.teams.inboxRespond(input))
      expect(result).toMatchObject({ kind: 'unavailable', action: { id: pending.id, phase: 'cancelled',
        outcome: { code: 'HUMAN_ACTION_CONTINUATION_UNAVAILABLE' } } })
      const stalled = await recovered.teams.getTeam({ teamId: state.team.id })
      expect(stalled.team).toMatchObject({ phase: 'stalled', stallReason: { code: 'HUMAN_ACTION_CONTINUATION_UNAVAILABLE' } })
      expect(stalled.activations).toEqual(replay.activations)
      expect(value(await recoveredClient.teams.inboxRespond(input))).toEqual(result)
      await vi.waitFor(async () => {
        expect(value(await recoveredClient.teams.inboxRead({ limit: 2 })).items.some(item => item.kind === 'action')).toBe(true)
      })
    })
  }

  it('delivers an ordinary coordinator message to the principal inbox without a human Session', async () => {
    const ctx = await setup(new GateAdapter())
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(), cwd: process.cwd(),
    })))
    const state = value(await client.teams.create({ objective: 'Receive a progress update.', cwd: process.cwd() }))
    const human = required(state.participants.find(member => member.role === 'human'), 'human')
    const coordinator = required(state.participants.find(member => member.role === 'coordinator'), 'coordinator')
    const binding = required(state.activations.find(value => value.activation.participantId === coordinator.id), 'coordinator binding')
    const channelId = required(state.channelIds[0], 'default channel')
    const link = await ctx.teamLinks.connect({ provider: 'local', binding })
    try {
      const channel = await ctx.teams.getChannel({ channelId })
      const envelope = await link.post({ expectedCursor: channel.cursor,
        idempotencyKey: channelPostIdempotencyKeySchema.parse('human-progress-message'),
        draft: { channelId, audience: [human.id], kind: 'message', delivery: 'context',
          payload: { content: [{ type: 'text', text: 'Work is in progress.' }] } } })
      await vi.waitFor(async () => {
        const page = value(await client.teams.inboxRead({}))
        expect(page.items).toMatchObject([{ kind: 'message', envelopeId: envelope.id, envelope }])
      })
      const pending = await ctx.teams.listChannelPendingDeliveries({ channelId, participantId: human.id, afterCursor: -1, limit: 2 })
      expect(pending.deliveries).toEqual([])
      const current = await ctx.teams.getTeam({ teamId: state.team.id })
      expect(current.activations.some(value => value.activation.participantId === human.id)).toBe(false)
      expect(current.team.phase).toBe('active')
      const sink = vi.spyOn(ctx.teamHumanDelivery, 'admitMessage')
      await expect(ctx.teams.admitHumanChannelDelivery({ actor: {} as never, teamId: state.team.id, channelId,
        envelopeId: envelope.id, recipientId: human.id, principalId: authenticatedProductCall.principal.id,
        expectedCursor: pending.channel.cursor })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      expect(sink).not.toHaveBeenCalled()
    } finally { await link.close() }
  })

  it('runs the default local topology through the full fetch carrier', async () => {
    let phase = 'setup'
    const failureState: { read?: () => Promise<unknown> } = {}
    onTestFailed(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const details = await Promise.race([
          failureState.read?.().catch((error: unknown) => error instanceof Error ? error.message : String(error)),
          new Promise((resolve) => {
            timer = setTimeout(() => { resolve('state read did not settle') }, 500)
          }),
        ])
        process.stderr.write(`Team fetch scenario stopped at: ${phase}; ${JSON.stringify(details)}\n`)
      } finally { if (timer !== undefined) clearTimeout(timer) }
    })
    const adapter = new GateAdapter()
    const ctx = await setup(adapter)
    phase = 'initial reads'
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })))

    expect(value(await client.teams.list({})).items).toEqual([])
    const startRequest = {
      objective: 'Return an explicit final result.',
      text: 'Start the Team task.',
      idempotencyKey: channelPostIdempotencyKeySchema.parse('host-team-start'),
      cwd: process.cwd(),
    }
    phase = 'Team start'
    const started = value(await client.teams.start(startRequest))
    const created = started.state
    const teamId = created.team.id
    const channelId = required(created.channelIds[0], 'default Team channel')
    failureState.read = async () => {
      const current = await ctx.teams.getTeam({ teamId })
      return { team: current.team.phase, closure: current.team.closure?.kind,
        activations: current.activations.map(item => ({ session: item.sessionId, status: item.activation.status })),
        quiescence: await ctx.teams.inspectQuiescence(teamId) }
    }

    phase = 'admission reads'
    const admission = await ctx.teams.getChannelAdmission({ channelId })
    expect(admission.channel.phase).toBe('active')
    expect(admission.invitations.map(invitation => invitation.status)).toEqual(['acknowledged', 'acknowledged'])
    expect(admission.invitations[0]?.acknowledgementKey).toContain('principal:test-product-principal:')
    expect(admission.invitations[1]?.acknowledgementKey).toContain('agent-client:')
    const memberPage = value(await client.teams.memberList({ teamId, afterCursor: -1, limit: 1 }))
    expect(memberPage.items).toHaveLength(1)
    expect(memberPage.nextCursor).toBeDefined()
    expect(value(await client.teams.workflowPlanList({ teamId, afterCursor: -1, limit: 1 })).items).toEqual([])
    const channelPage = value(await client.teams.channelRead({ channelId, afterCursor: -1, limit: 1 }))
    expect(channelPage.records).toHaveLength(1)
    expect(channelPage.nextCursor).toBe(0)
    expect(created).toMatchObject({
      team: { id: teamId, phase: 'active' },
      participants: [
        { kind: 'human', role: 'human', phase: 'active' },
        { kind: 'local-agent', role: 'coordinator', phase: 'active' },
        { kind: 'local-agent', role: 'worker', phase: 'provisioning' },
      ],
    })
    phase = 'selection reads'
    const selection = value(await client.teams.selection({ teamId }))
    expect(selection).toMatchObject({ team: { id: teamId, phase: 'active' }, coordinator: { kind: 'bound' }, counts: { participants: 3 } })
    expect(selection).not.toHaveProperty('participants')
    expect(selection).not.toHaveProperty('activations')
    const detailedSelection = value(await client.teams.selection({ teamId, includeMetadata: true }))
    expect(detailedSelection.metadata).toMatchObject({ kind: 'available', goal: created.goal, budgets: created.budgets })
    expect(detailedSelection).not.toHaveProperty('tasks')
    const memberSummaries = value(await client.teams.browse({ teamId, kind: 'members', limit: 1 }))
    expect(memberSummaries).toMatchObject({ kind: 'members', teamId, total: 3, nextCursor: 0 })
    expect(memberSummaries.items).toHaveLength(1)
    expect(memberSummaries.items[0]).not.toHaveProperty('capabilities')
    expect(memberSummaries.items[0]).not.toHaveProperty('authorityGrant')

    if (selection.coordinator.kind !== 'bound') throw new Error('Coordinator binding missing')
    expect(value(await client.teams.memberSession({ teamId, participantId: selection.coordinator.binding.activation.participantId })))
      .toEqual(selection.coordinator.binding)
    expect(value(await client.teams.memberInspect({ teamId, participantId: selection.coordinator.binding.activation.participantId })))
      .toMatchObject({ record: { id: selection.coordinator.binding.activation.participantId, teamId, role: 'coordinator' } })

    expect(value(await client.teams.get({ teamId })).team).toMatchObject({ id: teamId, phase: 'active' })
    expect(value(await client.teams.auditRead({ teamId, afterCursor: -1, limit: 1 })).items[0]).toMatchObject({
      teamId, stream: 'team', cursor: 0, type: 'team/created',
    })

    expect(started.envelopeId).toBeTruthy()
    phase = 'start retry'
    const retried = value(await client.teams.start(startRequest))
    expect(retried.state.team.id).toBe(teamId)
    expect(retried.envelopeId).toBe(started.envelopeId)
    const conflict = await client.teams.start({
      ...startRequest,
      objective: 'Different Team objective.',
    })
    expect(conflict.result).toMatchObject({ ok: false, error: { code: 'team-start-conflict' } })
    phase = 'model entry'
    await adapter.started.promise

    const human = required(created.participants.find(item => item.role === 'human'), 'human participant')
    const coordinator = required(created.participants.find(item => item.role === 'coordinator'), 'coordinator participant')
    const binding = required(
      created.activations.find(item => item.activation.participantId === coordinator.id),
      'coordinator activation',
    )
    const final = client.teams.waitFinal({ teamId })
    phase = 'final post'
    await postFinal(ctx, created, human, binding)
    phase = 'closure intent'
    await vi.waitFor(async () => {
      expect((await ctx.teams.getTeam({ teamId })).team.closure?.kind).toBe('complete')
    })
    phase = 'release model'
    adapter.release.resolve(undefined)
    phase = 'final receipt'
    const finalValue = value(await final)
    expect(finalValue.teamId).toBe(teamId)
    expect(finalValue.channelId).toBe(channelId)
    expect(finalValue.envelopeId).toBeTruthy()
    expect(finalValue.text).toBe('Final result from the coordinator.')
    phase = 'inbox read'
    const inbox = value(await client.teams.inboxRead({}))
    expect(inbox.items).toMatchObject([{ kind: 'final', teamId, envelopeId: finalValue.envelopeId, text: finalValue.text }])
    expect(inbox.displayCursor).toBe(-1)
    expect(value(await client.teams.inboxAcknowledge({ throughCursor: inbox.items[0]!.sequence })))
      .toEqual({ displayCursor: inbox.items[0]!.sequence })
    expect(value(await client.teams.inboxRead({})).items).toEqual([])
    expect(value(await client.teams.get({ teamId })).team.phase).toBe('completed')
    const noOwner = await client.teams.postInput({ teamId, text: 'This run is already settled.' })
    expect(noOwner.result.ok).toBe(false)
    if (noOwner.result.ok) throw new Error('unreachable')
    expect(noOwner.result.error.code).toBe('team-run-unavailable')
    expect(noOwner.result.error.message).toContain('not owned by this local Team-run instance')
    expect(noOwner.result.error.details).toEqual({ teamId })
    const orphanedPrompt = await client.sessions.prompt({
      sessionId: binding.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'Do not revive this Team coordinator directly.' }],
    })
    expect(orphanedPrompt.result).toMatchObject({
      ok: false,
      error: { code: 'team-run-unavailable', details: { teamId } },
    })
    const orphanedCancel = await client.sessions.cancel({ sessionId: binding.sessionId })
    expect(orphanedCancel.result).toMatchObject({
      ok: false,
      error: { code: 'team-run-unavailable', details: { teamId } },
    })
    const missing = await client.teams.get({ teamId: 'missing-team' as never })
    expect(missing.result.ok).toBe(false)
    if (missing.result.ok) throw new Error('unreachable')
    expect(missing.result.error.code).toBe('team-not-found')
    expect(missing.result.error.message).toContain('missing-team')
    expect(missing.result.error.details).toEqual({ teamId: 'missing-team' })

    phase = 'create cancellable'
    const cancellable = value(await client.teams.create({ objective: 'Cancel this Team.', cwd: process.cwd() }))
    phase = 'cancel Team'
    expect(value(await client.teams.cancel({ teamId: cancellable.team.id }))).toEqual({ accepted: true, phase: 'cancelled' })
    const cancelled = value(await client.teams.get({ teamId: cancellable.team.id }))
    expect(cancelled.team.phase).toBe('cancelled')
    phase = 'archive Team'
    const archived = value(await client.teams.archive({
      teamId: cancellable.team.id,
      expectedCursor: cancelled.team.cursor,
    }))
    expect(archived.team.id).toBe(cancellable.team.id)
    expect(archived.team.phase).toBe('cancelled')
    expect(typeof archived.team.archivedAt).toBe('number')
    expect(value(await client.teams.list({})).items).not.toContainEqual(expect.objectContaining({ id: cancellable.team.id }))
    const retriedArchive = value(await client.teams.archive({
      teamId: cancellable.team.id,
      expectedCursor: archived.team.cursor,
    }))
    expect(retriedArchive.team.archivedAt).toBe(archived.team.archivedAt)
  })

  it('requires the current TeamRun caller to own the active human participant before every direct route', async () => {
    const adapter = new GateAdapter()
    const ctx = await setup(adapter)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })
    const owner = new InProcessApiClient(authenticatedFetch(api))
    const foreign = new InProcessApiClient(authenticatedFetch(api, foreignAuthenticatedProductCall))
    const created = value(await owner.teams.create({ objective: 'Reject another product principal.', cwd: process.cwd() }))
    const teamId = created.team.id
    const coordinator = required(created.participants.find(participant => participant.role === 'coordinator'), 'coordinator participant')
    const binding = required(
      created.activations.find(item => item.activation.participantId === coordinator.id),
      'coordinator activation',
    )
    const postHumanInput = vi.spyOn(ctx.teamRuns, 'postHumanInput')
    const waitForFinal = vi.spyOn(ctx.teamRuns, 'waitForFinal')
    const cancel = vi.spyOn(ctx.teamRuns, 'cancel')
    const archiveTerminal = vi.spyOn(ctx.teamRuns, 'archiveTerminal')

    const denied = await Promise.all([
      foreign.teams.postInput({ teamId, text: 'Other principal input.' }),
      foreign.teams.waitFinal({ teamId }),
      foreign.teams.cancel({ teamId }),
      foreign.teams.archive({ teamId, expectedCursor: created.team.cursor }),
      foreign.sessions.prompt({
        sessionId: binding.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: 'Other principal coordinator input.' }],
      }),
    ])
    for (const response of denied) {
      expect(response.result).toMatchObject({
        ok: false,
        error: { code: 'TEAM_HUMAN_ACTOR_NOT_FOUND', details: { teamId } },
      })
    }
    expect(postHumanInput).not.toHaveBeenCalled()
    expect(waitForFinal).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    expect(archiveTerminal).not.toHaveBeenCalled()

    const accepted = value(await owner.teams.postInput({ teamId, text: 'Owner input.' }))
    expect(accepted.envelopeId).toBeTruthy()
    expect(postHumanInput).toHaveBeenCalledTimes(1)
    await adapter.started.promise
    adapter.release.resolve(undefined)
  })

  it('rejects caller-selected human ownership on the member-invite wire', async () => {
    const ctx = await setup(new GateAdapter())
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })
    const created = value(await new InProcessApiClient(authenticatedFetch(api)).teams.create({
      objective: 'Reject caller-selected human ownership.',
      cwd: process.cwd(),
    }))
    const response = await authenticatedFetch(api).fetch(new Request('http://x/api/team.member.invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'member-invite-human-owner',
        method: 'team.member.invite',
        payload: {
          teamId: created.team.id,
          expectedCursor: created.team.cursor,
          kind: 'human',
          displayName: 'Caller-selected human',
          role: 'human',
          capabilities: [],
          owner: { kind: 'product-principal', principalId: authenticatedProductCall.principal.id },
        },
      }),
    }))
    expect(await response.json()).toMatchObject({ result: { ok: false, error: { code: 'bad-request' } } })
  })

  it('archives a detached terminal Team after a Host restart through an authenticated human proof', async () => {
    const root = await freshRoot()
    const first = await setup(new GateAdapter(), undefined, true, root)
    const firstClient = new InProcessApiClient(authenticatedFetch(createApiProxy(first, {
      defaultModelSelection: () => first.agentDefaultModel.currentSelection(), cwd: process.cwd(),
    })))
    const created = value(await firstClient.teams.create({ objective: 'Archive a detached completed Team.', cwd: process.cwd() }))
    const human = required(created.participants.find(member => member.role === 'human'), 'human participant')
    const coordinator = required(created.participants.find(member => member.role === 'coordinator'), 'coordinator participant')
    const binding = required(created.activations.find(item => item.activation.participantId === coordinator.id), 'coordinator binding')
    const final = firstClient.teams.waitFinal({ teamId: created.team.id })
    await postFinal(first, created, human, binding)
    expect(value(await final).teamId).toBe(created.team.id)
    const terminal = value(await firstClient.teams.get({ teamId: created.team.id }))
    expect(terminal.team.phase).toBe('completed')
    await first.fiber.dispose()
    contexts.delete(first)

    const ctx = await setup(new GateAdapter(), undefined, false, root)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })
    if (api.teams === undefined) throw new Error('Team API was not registered')
    const client = new InProcessApiClient(authenticatedFetch(api))
    const foreign = new InProcessApiClient(authenticatedFetch(api, foreignAuthenticatedProductCall))
    const replayed = value(await client.teams.inboxRead({}))
    expect(replayed.items).toMatchObject([{ teamId: terminal.team.id, text: 'Final result from the coordinator.' }])
    expect(replayed.displayCursor).toBe(-1)
    expect(value(await foreign.teams.inboxRead({})).items).toEqual([])
    expect(value(await client.teams.inboxAcknowledge({ throughCursor: replayed.items[0]!.sequence })).displayCursor)
      .toBe(replayed.items[0]!.sequence)
    expect(value(await client.teams.inboxRead({})).items).toEqual([])
    const input = { teamId: terminal.team.id, expectedCursor: terminal.team.cursor }
    const archiveTeam = vi.spyOn(ctx.teams, 'archiveTeam')

    await expect(api.teams.archive({ rpcId: RpcId('archive-without-auth'), payload: input })).resolves.toMatchObject({
      result: { ok: false, error: { code: 'PRODUCT_AUTH_REQUIRED' } },
    })
    expect(archiveTeam).not.toHaveBeenCalled()
    await expect(foreign.teams.archive(input)).resolves.toMatchObject({
      result: { ok: false, error: { code: 'TEAM_HUMAN_ACTOR_NOT_FOUND', details: { teamId: input.teamId } } },
    })
    await expect(client.teams.archive({ ...input, expectedCursor: input.expectedCursor - 1 })).resolves.toMatchObject({
      result: { ok: false },
    })
    expect((await ctx.teams.getTeam({ teamId: input.teamId })).team.archivedAt).toBeUndefined()

    const forged = await authenticatedFetch(api).fetch(new Request('http://x/api/team.archive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'archive-forged-actor',
        method: 'team.archive',
        payload: { ...input, actor: 'forged' },
      }),
    }))
    expect(await forged.json()).toMatchObject({ result: { ok: false, error: { code: 'bad-request' } } })

    const archived = value(await client.teams.archive(input))
    expect(archived.team.id).toBe(input.teamId)
    expect(archived.team.phase).toBe('completed')
    expect(typeof archived.team.archivedAt).toBe('number')
    expect(archiveTeam).toHaveBeenCalledTimes(2)
  })

  it('denies detached terminal archive when the active human grant omits close', async () => {
    let terminal: TeamStateSnapshot | undefined
    const ctx = await setup(new GateAdapter(), async (seed) => {
      terminal = await failHumanTeam(seed, 'send')
    }, false)
    if (terminal === undefined) throw new Error('restricted detached terminal Team fixture was not created')
    terminal = await ctx.teams.getTeam({ teamId: terminal.team.id })
    expect(terminal.team.phase).toBe('failed')
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })))
    const archive = vi.spyOn(ctx.teams, 'archiveTeam')
    await expect(client.teams.archive({ teamId: terminal.team.id, expectedCursor: terminal.team.cursor })).resolves.toMatchObject({
      result: { ok: false, error: { code: 'TEAM_HUMAN_ACTOR_FORBIDDEN', details: { teamId: terminal.team.id } } },
    })
    expect(archive).not.toHaveBeenCalled()
  })

  it('resumes an offline coordinator only through an authenticated human proof and provider preflight', async () => {
    const ctx = await setup(new GateAdapter())
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })
    if (api.teams === undefined) throw new Error('Team API was not registered')
    const teams = api.teams
    const owner = new InProcessApiClient(authenticatedFetch(api))
    const foreign = new InProcessApiClient(authenticatedFetch(api, foreignAuthenticatedProductCall))
    const created = value(await owner.teams.create({ objective: 'Resume only with authenticated authority.', cwd: process.cwd() }))
    const internals = ctx.teamRuns as unknown as { readonly runs: Map<TeamId, { readonly handle: TeamRun.TeamRunHandle }> }
    const owned = required(internals.runs.get(created.team.id), 'Team-run state')
    await owned.handle.coordinatorLease.dispose()
    internals.runs.delete(created.team.id)
    const state = await ctx.teams.getTeam({ teamId: created.team.id })
    const input = { teamId: created.team.id, expectedCursor: state.team.cursor }

    await expect(teams.resume({ rpcId: RpcId('resume-without-auth'), payload: input }, new AbortController().signal)).resolves.toMatchObject({
      result: { ok: false, error: { code: 'PRODUCT_AUTH_REQUIRED' } },
    })
    await expect(foreign.teams.resume(input)).resolves.toMatchObject({
      result: { ok: false, error: { code: 'TEAM_HUMAN_ACTOR_NOT_FOUND', details: { teamId: input.teamId } } },
    })
    await expect(owner.teams.resume({ ...input, expectedCursor: input.expectedCursor - 1 })).resolves.toMatchObject({
      result: { ok: false },
    })
    expect((await ctx.teams.getTeam({ teamId: input.teamId })).activations.every(binding => binding.activation.status === 'offline')).toBe(true)

    const controller = new AbortController()
    const revocableCall = { ...authenticatedProductCall, signal: controller.signal }
    const unregister = ctx.teams.registerPolicy('activate', {
      name: 'revoke-host-human-resume-proof-after-policy',
      async apply(request, next) {
        if (request.facts.operation === 'team-resume') controller.abort()
        return await next()
      },
    })
    try {
      await expect(withAuthenticatedProductCall(revocableCall, async () => await teams.resume({
        rpcId: RpcId('resume-revoked'), payload: input,
      }, new AbortController().signal))).resolves.toMatchObject({
        result: { ok: false, error: { code: 'TEAM_ACTOR_PROOF_INVALID' } },
      })
    } finally {
      unregister()
    }
    expect((await ctx.teams.getTeam({ teamId: input.teamId })).activations.every(binding => binding.activation.status === 'offline')).toBe(true)

    const preflight = vi.spyOn(ctx.teamActivations, 'preflightResume').mockRejectedValueOnce(new TeamError(
      'test provider recovery preflight failed', 'TEAM_ACTIVATION_RECOVERY_UNSUPPORTED',
    ))
    await expect(owner.teams.resume(input)).resolves.toMatchObject({ result: { ok: false } })
    preflight.mockRestore()
    expect((await ctx.teams.getTeam({ teamId: input.teamId })).activations.every(binding => binding.activation.status === 'offline')).toBe(true)

    const actualPreflight = ctx.teamActivations.preflightResume.bind(ctx.teamActivations)
    const preflightWitness = vi.spyOn(ctx.teamActivations, 'preflightResume').mockImplementation(async (request) => {
      expect(request.authorization.isLive()).toBe(true)
      await actualPreflight(request)
    })
    const [firstResume, joinedResume] = await Promise.all([
      owner.teams.resume(input),
      owner.teams.resume(input),
    ])
    const resumed = value(firstResume)
    expect(value(joinedResume).team.id).toBe(input.teamId)
    expect(preflightWitness).toHaveBeenCalledWith(expect.objectContaining({
      teamId: input.teamId,
      participantId: owned.handle.coordinator.id,
    }))
    expect(preflightWitness).toHaveBeenCalledTimes(1)
    expect(resumed.team).toMatchObject({ id: input.teamId, phase: 'active' })
    expect(resumed.activations.some(binding => binding.activation.status !== 'offline')).toBe(true)

    const forged = await authenticatedFetch(api).fetch(new Request('http://x/api/team.resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'resume-forged-actor',
        method: 'team.resume',
        payload: { ...input, actor: 'forged' },
      }),
    }))
    expect(await forged.json()).toMatchObject({ result: { ok: false, error: { code: 'bad-request' } } })
  })

  it('rejects a human resume when its proof revokes before the stalled phase append', async () => {
    const ctx = await setup(new GateAdapter())
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })
    if (api.teams === undefined) throw new Error('Team API was not registered')
    const teams = api.teams
    const owner = new InProcessApiClient(authenticatedFetch(api))
    const created = value(await owner.teams.create({ objective: 'Fence revoked stalled Team resume.', cwd: process.cwd() }))
    const internals = ctx.teamRuns as unknown as { readonly runs: Map<TeamId, { readonly handle: TeamRun.TeamRunHandle }> }
    const owned = required(internals.runs.get(created.team.id), 'Team-run state')
    await owned.handle.coordinatorLease.dispose()
    internals.runs.delete(created.team.id)
    const beforeStall = await ctx.teams.getTeam({ teamId: created.team.id })
    const stalled = await seedTeamPhase(ctx, created.team.id, 'stalled', {
      code: 'TASK_NO_ELIGIBLE_OWNER',
      message: 'Exercise the human resume phase-proof fence.',
    })
    expect(stalled.team.cursor).toBeGreaterThan(beforeStall.team.cursor)
    const controller = new AbortController()
    const revocableCall = { ...authenticatedProductCall, signal: controller.signal }
    const transition = ctx.teams.transitionTeamPhase.bind(ctx.teams)
    const transitionSpy = vi.spyOn(ctx.teams, 'transitionTeamPhase').mockImplementation(async (request) => {
      controller.abort()
      return await transition(request)
    })
    try {
      await expect(withAuthenticatedProductCall(revocableCall, async () => await teams.resume({
        rpcId: RpcId('resume-phase-revoked'),
        payload: { teamId: created.team.id, expectedCursor: stalled.team.cursor },
      }, new AbortController().signal))).resolves.toMatchObject({
        result: { ok: false, error: { code: 'TEAM_ACTOR_PROOF_INVALID' } },
      })
    } finally {
      transitionSpy.mockRestore()
    }
    await expect(ctx.teams.getTeam({ teamId: created.team.id })).resolves.toMatchObject({
      team: { phase: 'stalled' },
      activations: [{ activation: { status: 'offline' } }],
    })
  })

  it('disposes a resumed raw coordinator when the human proof revokes before durable bind', async () => {
    const ctx = await setup(new GateAdapter())
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })
    if (api.teams === undefined) throw new Error('Team API was not registered')
    const teams = api.teams
    const owner = new InProcessApiClient(authenticatedFetch(api))
    const created = value(await owner.teams.create({ objective: 'Dispose raw coordinator before revoked bind.', cwd: process.cwd() }))
    const internals = ctx.teamRuns as unknown as { readonly runs: Map<TeamId, { readonly handle: TeamRun.TeamRunHandle }> }
    const owned = required(internals.runs.get(created.team.id), 'Team-run state')
    await owned.handle.coordinatorLease.dispose()
    internals.runs.delete(created.team.id)
    const state = await ctx.teams.getTeam({ teamId: created.team.id })
    const controller = new AbortController()
    const revocableCall = { ...authenticatedProductCall, signal: controller.signal }
    const bind = ctx.teams.bindActivation.bind(ctx.teams)
    const bindSpy = vi.spyOn(ctx.teams, 'bindActivation').mockImplementation(async (request) => {
      controller.abort()
      return await bind(request)
    })
    try {
      await expect(withAuthenticatedProductCall(revocableCall, async () => await teams.resume({
        rpcId: RpcId('resume-bind-revoked'),
        payload: { teamId: created.team.id, expectedCursor: state.team.cursor },
      }, new AbortController().signal))).resolves.toMatchObject({
        result: { ok: false, error: { code: 'TEAM_ACTOR_PROOF_INVALID' } },
      })
    } finally {
      bindSpy.mockRestore()
    }
    expect(internals.runs.has(created.team.id)).toBe(false)
    await expect(ctx.teams.getTeam({ teamId: created.team.id })).resolves.toMatchObject({
      activations: [{ activation: { status: 'offline' } }],
    })
  })

  it('routes authenticated actor-free Team goal updates and transitions through human proofs', async () => {
    const ctx = await setup(new GateAdapter())
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })
    if (api.teams === undefined) throw new Error('Team API was not registered')
    const teams = api.teams
    const client = new InProcessApiClient(authenticatedFetch(api))
    const created = value(await client.teams.create({ objective: 'Control Team goals through product authentication.', cwd: process.cwd() }))
    const updateInput = {
      teamId: created.team.id,
      expectedRevision: created.goal.revision,
      objective: 'Updated by the authenticated human.',
    }
    const updateGoal = vi.spyOn(ctx.teams, 'updateTeamGoal')
    const transitionGoal = vi.spyOn(ctx.teams, 'transitionTeamGoalPhase')
    await expect(teams.goalUpdate({ rpcId: RpcId('goal-update-without-auth'), payload: updateInput })).resolves.toMatchObject({
      result: { ok: false, error: { code: 'PRODUCT_AUTH_REQUIRED' } },
    })
    await expect(teams.goalTransition({
      rpcId: RpcId('goal-transition-without-auth'),
      payload: { teamId: created.team.id, expectedRevision: created.goal.revision, phase: 'paused' },
    })).resolves.toMatchObject({ result: { ok: false, error: { code: 'PRODUCT_AUTH_REQUIRED' } } })
    expect(updateGoal).not.toHaveBeenCalled()
    expect(transitionGoal).not.toHaveBeenCalled()

    const updated = value(await client.teams.goalUpdate(updateInput))
    expect(updated.goal).toMatchObject({ revision: updateInput.expectedRevision + 1, objective: updateInput.objective })
    const transitioned = value(await client.teams.goalTransition({
      teamId: updated.team.id,
      expectedRevision: updated.goal.revision,
      phase: 'paused',
    }))
    expect(transitioned.goal).toMatchObject({ phase: 'paused', revision: updated.goal.revision + 1 })

    await expect(client.teams.goalUpdate({
      ...updateInput,
      objective: 'Stale goal update.',
    })).resolves.toMatchObject({ result: { ok: false } })
    expect((await ctx.teams.getTeam({ teamId: created.team.id })).goal).toMatchObject({
      revision: transitioned.goal.revision,
      objective: transitioned.goal.objective,
      phase: 'paused',
    })

    const controller = new AbortController()
    const revocableCall = { ...authenticatedProductCall, signal: controller.signal }
    const revocableInput = {
      teamId: transitioned.team.id,
      expectedRevision: transitioned.goal.revision,
      objective: 'This policy-revoked goal must not persist.',
    }
    const unregister = ctx.teams.registerPolicy('goal-mutate', {
      name: 'revoke-host-human-goal-proof-after-policy',
      async apply(_request, next) {
        controller.abort()
        return await next()
      },
    })
    try {
      await expect(withAuthenticatedProductCall(revocableCall, async () => await teams.goalUpdate({
        rpcId: RpcId('goal-update-revoked'),
        payload: revocableInput,
      }))).resolves.toMatchObject({
        result: { ok: false, error: { code: 'TEAM_ACTOR_PROOF_INVALID' } },
      })
    } finally {
      unregister()
    }

    const forged = await authenticatedFetch(api).fetch(new Request('http://x/api/team.goal.update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'goal-update-forged-actor',
        method: 'team.goal.update',
        payload: { ...revocableInput, actor: 'forged' },
      }),
    }))
    expect(await forged.json()).toMatchObject({ result: { ok: false, error: { code: 'bad-request' } } })
  })

  it('denies Team goal mutation when the active human grant omits goal-mutate', async () => {
    let state: TeamStateSnapshot | undefined
    const ctx = await setup(new GateAdapter(), async (seed) => {
      const created = await createTestRootTeam(seed, {
        goal: { objective: 'Deny an ungranted Team goal mutation.', budgets: {} }, rules: {}, budgets: {},
      })
      let current = await seed.teams.getTeam({ teamId: created.team.id })
      const human = await inviteBootstrapParticipant(seed, {
        teamId: created.team.id,
        expectedCursor: current.team.cursor,
        kind: 'human',
        displayName: 'Restricted goal owner',
        role: 'owner',
        capabilities: [],
        owner: { kind: 'product-principal', principalId: authenticatedProductCall.principal.id },
        authorityGrant: { operations: ['send'], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} },
      })
      current = await seed.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(seed, {
        teamId: created.team.id, participantId: human.id, expectedCursor: current.team.cursor, phase: 'provisioning',
      })
      current = await seed.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(seed, {
        teamId: created.team.id, participantId: human.id, expectedCursor: current.team.cursor, phase: 'active',
      })
      state = await seed.teams.getTeam({ teamId: created.team.id })
    }, false)
    if (state === undefined) throw new Error('restricted Team goal fixture was not created')
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })))
    const updateGoal = vi.spyOn(ctx.teams, 'updateTeamGoal')
    await expect(client.teams.goalUpdate({
      teamId: state.team.id,
      expectedRevision: state.goal.revision,
      objective: 'Denied objective update.',
    })).resolves.toMatchObject({
      result: { ok: false, error: { code: 'TEAM_HUMAN_ACTOR_FORBIDDEN', details: { teamId: state.team.id } } },
    })
    expect(updateGoal).not.toHaveBeenCalled()
  })

  it('rejects Host human Team goal mutation after Team terminalization', async () => {
    const ctx = await setup(new GateAdapter())
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })))
    const created = value(await client.teams.create({ objective: 'Reject terminal human Team goal mutation.', cwd: process.cwd() }))
    value(await client.teams.cancel({ teamId: created.team.id }))
    await expect(client.teams.goalUpdate({
      teamId: created.team.id,
      expectedRevision: created.goal.revision,
      objective: 'Forbidden terminal objective update.',
    })).resolves.toMatchObject({ result: { ok: false, error: { code: 'TEAM_ACTOR_PROOF_INVALID' } } })
  })

  it('routes authenticated actor-free task create, update, cancel, and delete mutations through human proofs', async () => {
    const ctx = await setup(new GateAdapter())
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })
    if (api.teams === undefined) throw new Error('Team API was not registered')
    const client = new InProcessApiClient(authenticatedFetch(api))
    const created = value(await client.teams.create({ objective: 'Control task mutations through product authentication.', cwd: process.cwd() }))
    const teamId = created.team.id
    const human = required(created.participants.find(item => item.role === 'human'), 'human participant')
    const initial = {
      teamId,
      expectedCursor: created.team.cursor,
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('host-human-task-create'),
      subject: 'Authenticated task',
      description: 'Create this task through an authenticated human proof.',
      blockedBy: [],
      requiredCapabilities: [],
      priority: 0,
      readScopes: [],
      writeScopes: [],
      workspaceMode: 'shared' as const,
      budget: {},
      reviewPolicy: { kind: 'none' as const },
      maxAttempts: 1,
    }
    const createTask = vi.spyOn(ctx.teams, 'createTask')
    const unauthenticated = await api.teams.taskCreate({ rpcId: RpcId('task-create-without-auth'), payload: initial })
    expect(unauthenticated.result).toMatchObject({ ok: false, error: { code: 'PRODUCT_AUTH_REQUIRED' } })
    expect(createTask).not.toHaveBeenCalled()

    const task = value(await client.teams.taskCreate(initial))
    expect(task).toMatchObject({ teamId, subject: initial.subject, phase: 'pending' })
    expect(task.createCommand.creator).toEqual({ teamId, participantId: human.id })
    const inspected = value(await client.teams.taskInspect({ teamId, taskId: task.id, section: 'record' }))
    expect(inspected).toMatchObject({ section: 'record', revision: task.revision, task: { id: task.id, subject: task.subject } })
    expect(inspected).not.toHaveProperty('task.attemptHistory')
    expect((await client.teams.taskInspect({ teamId, taskId: 'foreign-task' as never, section: 'record' })).result)
      .toMatchObject({ ok: false, error: { code: 'team-task-not-found' } })
    expect(value(await client.teams.taskInspect({ teamId, taskId: task.id, section: 'attempts', expectedRevision: task.revision, limit: 1 })))
      .toMatchObject({ section: 'attempts', total: 0, items: [] })
    expect((await client.teams.taskInspect({ teamId, taskId: task.id, section: 'record', expectedRevision: task.revision + 1 })).result)
      .toMatchObject({ ok: false, error: { code: 'team-task-stale-revision' } })


    const privateArtifact = { id: 'private-proposal', provider: 'local', kind: 'patch', uri: 'private/proposal', visibility: 'private' }
    const completedView = inspectionTaskFixture({ id: task.id, teamId, phase: 'completed', attemptCount: 1,
      attemptHistory: [inspectionAttemptFixture({ teamId, taskId: task.id, outcome: { kind: 'completed', result: {
        summary: 'Completed', artifacts: [privateArtifact], integration: { target: 'main', status: 'proposed', proposalArtifact: privateArtifact },
      } } })] })
    const readTask = vi.spyOn(ctx.teams, 'getTask').mockResolvedValueOnce(completedView)
    const visibleTask = value(await client.teams.taskGet({ teamId, taskId: task.id }))
    expect(JSON.stringify(visibleTask)).not.toContain('private/proposal')
    expect(JSON.stringify(completedView)).toContain('private/proposal')
    readTask.mockRestore()

    const updated = value(await client.teams.taskUpdate({
      teamId,
      taskId: task.id,
      expectedRevision: task.revision,
      subject: 'Updated authenticated task',
    }))
    expect(updated).toMatchObject({ revision: task.revision + 1, subject: 'Updated authenticated task' })

    const cancelled = value(await client.teams.taskCancel({
      teamId,
      taskId: updated.id,
      expectedRevision: updated.revision,
      reason: 'Only this task.',
    }))
    expect(cancelled.phase).toBe('cancelled')
    expect(cancelled.cancellation).toMatchObject({ requestedRevision: updated.revision, requestedBy: human.id, reason: 'Only this task.', target: { kind: 'pending' } })
    expect((await ctx.teams.getTeam({ teamId })).team.phase).toBe('active')

    const current = await ctx.teams.getTeam({ teamId })
    const deletable = value(await client.teams.taskCreate({
      ...initial,
      expectedCursor: current.team.cursor,
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('host-human-task-delete'),
      subject: 'Deletable authenticated task',
    }))
    const deleted = value(await client.teams.taskDelete({
      teamId,
      taskId: deletable.id,
      expectedRevision: deletable.revision,
    }))
    expect(deleted.phase).toBe('deleted')

    const forged = await authenticatedFetch(api).fetch(new Request('http://x/api/team.task.create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'task-create-forged-actor',
        method: 'team.task.create',
        payload: { ...initial, idempotencyKey: 'host-human-task-forged', actor: 'forged' },
      }),
    }))
    expect(await forged.json()).toMatchObject({ result: { ok: false, error: { code: 'bad-request' } } })
  })

  it('derives the Host task reviewer from authentication and enforces the durable review policy', async () => {
    const ctx = await setup(new GateAdapter())
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })
    const owner = new InProcessApiClient(authenticatedFetch(api))
    const foreign = new InProcessApiClient(authenticatedFetch(api, foreignAuthenticatedProductCall))
    const created = value(await owner.teams.create({ objective: 'Review a task through Host authentication.', cwd: process.cwd() }))
    const human = required(created.participants.find(participant => participant.role === 'human'), 'human participant')
    const coordinator = required(created.participants.find(participant => participant.role === 'coordinator'), 'coordinator participant')
    const binding = required(
      created.activations.find(item => item.activation.participantId === coordinator.id),
      'coordinator activation',
    )
    const task = value(await owner.teams.taskCreate({
      teamId: created.team.id,
      expectedCursor: created.team.cursor,
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('host-human-task-review'),
      subject: 'Reviewed Host task',
      description: 'The configured reviewer must come from the authenticated product principal.',
      blockedBy: [],
      requiredCapabilities: [],
      priority: 0,
      readScopes: [],
      writeScopes: [],
      workspaceMode: 'shared',
      budget: {},
      reviewPolicy: { kind: 'participant', reviewerId: human.id },
      maxAttempts: 1,
    }))
    const assigned = await assignTestTask(ctx, {
      teamId: task.teamId,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: coordinator.id,
      activationId: binding.activation.id,
      leaseDurationMs: 1_000,
    })
    const lease = required(assigned.lease, 'task lease')
    const coordinatorActor = ctx.teams.openActivationActorProofIssuer().issue(binding).proof
    const running = await ctx.teams.startTaskAttempt({
      actor: coordinatorActor,
      taskId: assigned.id,
      expectedRevision: assigned.revision,
      attemptId: lease.attemptId,
    })
    const reviewing = await ctx.teams.settleTaskAttempt({
      actor: coordinatorActor,
      taskId: running.id,
      expectedRevision: running.revision,
      attemptId: lease.attemptId,
      outcome: { kind: 'completed', result: { summary: 'Ready for Host review.' } },
    })

    const reviewInput = {
      teamId: reviewing.teamId,
      taskId: reviewing.id,
      expectedRevision: reviewing.revision,
      decision: 'accepted' as const,
      reason: 'Accepted through the configured reviewer.',
    }
    await expect(foreign.teams.taskReview(reviewInput)).resolves.toMatchObject({ result: { ok: false } })
    await expect(owner.teams.taskReview(reviewInput)).resolves.toMatchObject({
      result: { ok: true, value: { phase: 'completed', reviewHistory: [{ reviewerId: human.id, nextPhase: 'completed' }] } },
    })
    const forged = await authenticatedFetch(api).fetch(new Request('http://x/api/team.task.review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'task-review-forged-actor',
        method: 'team.task.review',
        payload: { ...reviewInput, actor: 'forged' },
      }),
    }))
    expect(await forged.json()).toMatchObject({ result: { ok: false, error: { code: 'bad-request' } } })
  })

  it('denies an authenticated task mutation when the active human grant omits task-mutate', async () => {
    let denied: { readonly teamId: TeamId; readonly expectedCursor: number } | undefined
    const ctx = await setup(new GateAdapter(), async (seed) => {
      const created = await createTestRootTeam(seed, {
        goal: { objective: 'Deny an ungranted task mutation.', budgets: {} }, rules: {}, budgets: {},
      })
      let state = await seed.teams.getTeam({ teamId: created.team.id })
      const human = await inviteBootstrapParticipant(seed, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        kind: 'human',
        displayName: 'Restricted authenticated human',
        role: 'owner',
        capabilities: [],
        owner: { kind: 'product-principal', principalId: authenticatedProductCall.principal.id },
        authorityGrant: { operations: ['send'], workspaceModes: ['shared'], readScopes: [], writeScopes: [], budgets: {} },
      })
      state = await seed.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(seed, {
        teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'provisioning',
      })
      state = await seed.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(seed, {
        teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'active',
      })
      denied = { teamId: created.team.id, expectedCursor: (await seed.teams.getTeam({ teamId: created.team.id })).team.cursor }
    }, false)
    if (denied === undefined) throw new Error('restricted Team fixture was not created')
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })))
    const createTask = vi.spyOn(ctx.teams, 'createTask')
    const response = await client.teams.taskCreate({
      teamId: denied.teamId,
      expectedCursor: denied.expectedCursor,
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('host-human-task-denied'),
      subject: 'Denied task',
      description: 'The immutable human grant omits task-mutate.',
      blockedBy: [],
      requiredCapabilities: [],
      priority: 0,
      readScopes: [],
      writeScopes: [],
      workspaceMode: 'shared',
      budget: {},
      reviewPolicy: { kind: 'none' },
      maxAttempts: 1,
    })
    expect(response.result).toMatchObject({ ok: false, error: { code: 'TEAM_HUMAN_ACTOR_FORBIDDEN' } })
    expect(createTask).not.toHaveBeenCalled()
  })

  it('rejects Host human task mutation after Team terminalization', async () => {
    const ctx = await setup(new GateAdapter())
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })))
    const created = value(await client.teams.create({ objective: 'Reject terminal human task mutation.', cwd: process.cwd() }))
    const task = value(await client.teams.taskCreate({
      teamId: created.team.id,
      expectedCursor: created.team.cursor,
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('terminal-human-task'),
      subject: 'Terminal task',
      description: 'Do not mutate this task after Team terminalization.',
      blockedBy: [],
      requiredCapabilities: [],
      priority: 0,
      readScopes: [],
      writeScopes: [],
      workspaceMode: 'shared',
      budget: {},
      reviewPolicy: { kind: 'none' },
      maxAttempts: 1,
    }))
    value(await client.teams.cancel({ teamId: created.team.id }))
    await expect(client.teams.taskUpdate({
      teamId: task.teamId,
      taskId: task.id,
      expectedRevision: task.revision,
      subject: 'Forbidden terminal update',
    })).resolves.toMatchObject({ result: { ok: false, error: { code: 'TEAM_ACTOR_PROOF_INVALID' } } })
  })

  it('admits ordered channel images once and reads bytes only through their exact retained Envelope', async () => {
    const root = await freshRoot()
    const ctx = await setup(new GateAdapter(), async (seed) => { await seed.plugin(AttachmentLocal, { clockyHome: root }) }, true, root)
    const api = createApiProxy(ctx, { defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(), cwd: process.cwd() })
    const client = new InProcessApiClient(authenticatedFetch(api))
    const foreign = new InProcessApiClient(authenticatedFetch(api, foreignAuthenticatedProductCall))
    const team = value(await client.teams.create({ objective: 'Read ordered channel media.', cwd: process.cwd() }))
    const channelId = required(team.channelIds[0], 'channel')
    const input = { channelId, expectedCursor: (await ctx.teams.getChannel({ channelId })).cursor,
      audience: null, delivery: 'context' as const, idempotencyKey: 'ordered-media' as never,
      content: [{ type: 'text' as const, text: 'Before image' },
        { type: 'image' as const, mediaType: 'image/png' as const, name: 'pixel.png', data: CHANNEL_MEDIA_PNG },
        { type: 'text' as const, text: 'After image' }],
    }
    const accepted = value(await client.teams.channelInput(input))
    expect(accepted.audience).toBeNull()
    const content = DirectChannel.parseDirectChannelV4MessagePayload(accepted.payload).content
    expect(content.map(block => block.type)).toEqual(['text', 'image', 'text'])
    const image = content[1]
    if (image?.type !== 'image') throw new Error('Image position was not retained')
    expect(image.attachment).toMatchObject({ width: 1, height: 1, name: 'pixel.png' })
    expect(JSON.stringify(accepted.payload)).not.toContain(CHANNEL_MEDIA_PNG)
    const replay = value(await client.teams.channelInput({ ...input,
      expectedCursor: (await ctx.teams.getChannel({ channelId })).cursor }))
    expect(replay.id).toBe(accepted.id)
    expect(replay.payload).toEqual(accepted.payload)
    value(await client.teams.channelClose({ channelId, expectedCursor: (await ctx.teams.getChannel({ channelId })).cursor }))
    const closedReplay = value(await client.teams.channelInput({ ...input,
      expectedCursor: (await ctx.teams.getChannel({ channelId })).cursor }))
    expect(closedReplay.id).toBe(accepted.id)
    expect(closedReplay.payload).toEqual(accepted.payload)
    const selection = { teamId: team.team.id, channelId, envelopeId: accepted.id,
      envelopeSequence: accepted.sequence, attachmentId: image.attachment.attachmentId }
    const stored = await ctx.attachments.readImage(image.attachment)
    expect(value(await client.teams.channelAttachment(selection))).toEqual({ attachment: stored.ref, data: Buffer.from(stored.data).toString('base64') })
    await vi.waitFor(async () => {
      const page = await ctx.teams.readChannelPage({ channelId, afterCursor: -1, limit: 128 })
      expect(page.records.some(record => record.type === 'channel/receipt' && record.envelopeId === accepted.id)).toBe(true)
    })
    const read = vi.spyOn(ctx.attachments, 'readImage')
    expect((await client.teams.channelAttachment({ ...selection, attachmentId: `sha256:${'0'.repeat(64)}` as never })).result)
      .toMatchObject({ ok: false, error: { code: 'attachment-error', details: { reason: 'ATTACHMENT_NOT_REFERENCED' } } })
    expect((await client.teams.channelAttachment({ ...selection, envelopeSequence: 0 })).result)
      .toMatchObject({ ok: false, error: { code: 'attachment-error' } })
    expect((await foreign.teams.channelAttachment(selection)).result)
      .toMatchObject({ ok: false, error: { code: 'TEAM_HUMAN_ACTOR_NOT_FOUND' } })
    const other = value(await client.teams.create({ objective: 'Another media Team.', cwd: process.cwd() }))
    expect((await client.teams.channelAttachment({ ...selection, teamId: other.team.id })).result.ok).toBe(false)
    expect(read).not.toHaveBeenCalled()
    const controller = new AbortController()
    read.mockRestore()
    const readOriginal = ctx.attachments.readImage.bind(ctx.attachments)
    const revokedRead = vi.spyOn(ctx.attachments, 'readImage').mockImplementation(async (ref, signal) => {
      const result = await readOriginal(ref, signal)
      controller.abort()
      return result
    })
    try {
      const result = await withAuthenticatedProductCall({ ...authenticatedProductCall, signal: controller.signal }, async () =>
        await required(api.teams, 'Team API').channelAttachment({ rpcId: RpcId('revoked-media-read'), payload: selection }))
      expect(result.result).toMatchObject({ ok: false, error: { code: 'TEAM_ACTOR_PROOF_INVALID' } })
      expect(revokedRead).toHaveBeenCalledOnce()
    } finally { revokedRead.mockRestore() }
  })

  it('rejects unauthorized and malformed channel image batches before writing attachments', async () => {
    const root = await freshRoot()
    const ctx = await setup(new GateAdapter(), async (seed) => { await seed.plugin(AttachmentLocal, { clockyHome: root }) }, true, root)
    const api = createApiProxy(ctx, { defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(), cwd: process.cwd() })
    const client = new InProcessApiClient(authenticatedFetch(api))
    const foreign = new InProcessApiClient(authenticatedFetch(api, foreignAuthenticatedProductCall))
    const team = value(await client.teams.create({ objective: 'Refuse invalid channel media.', cwd: process.cwd() }))
    const channelId = required(team.channelIds[0], 'channel')
    const input = { channelId, expectedCursor: (await ctx.teams.getChannel({ channelId })).cursor,
      audience: null, delivery: 'context' as const,
      content: [{ type: 'image' as const, mediaType: 'image/png' as const, data: CHANNEL_MEDIA_PNG }],
    }
    const save = vi.spyOn(ctx.attachments, 'saveImages')
    expect((await foreign.teams.channelInput(input)).result).toMatchObject({ ok: false, error: { code: 'TEAM_HUMAN_ACTOR_NOT_FOUND' } })
    expect((await client.teams.channelInput({ ...input, content: [...input.content,
      { type: 'image', mediaType: 'image/png', data: 'not canonical base64' }] })).result)
      .toMatchObject({ ok: false, error: { code: 'attachment-error', details: { reason: 'INVALID_IMAGE_BASE64' } } })
    expect(save).not.toHaveBeenCalled()
    const forged = await authenticatedFetch(api).fetch(new Request('http://x/api/team.channel.input', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        type: 'client-request', rpcId: 'forged-image-reference', method: 'team.channel.input',
        payload: { ...input, content: [{ ...input.content[0], attachment: { attachmentId: 'forged' } }] },
      }),
    }))
    expect(await forged.json()).toMatchObject({ result: { ok: false, error: { code: 'bad-request' } } })
    expect(save).not.toHaveBeenCalled()
    const coordinator = required(team.participants.find(participant => participant.role === 'coordinator'), 'coordinator')
    const member = value(await client.teams.memberInvite({ teamId: team.team.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: team.team.id })).team.cursor,
      kind: 'local-agent', displayName: 'Other endpoint', role: 'member', capabilities: [] }))
    value(await client.teams.memberActivate({ teamId: team.team.id, participantId: member.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: team.team.id })).team.cursor }))
    const agentChannel = value(await client.teams.channelOpen({ teamId: team.team.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: team.team.id })).team.cursor,
      adapter: { type: 'direct', version: 4 }, participants: [{ id: coordinator.id, role: 'member' }, { id: member.id, role: 'member' }], limits: {} }))
    expect((await client.teams.channelInput({ ...input, channelId: agentChannel.manifest.id,
      expectedCursor: agentChannel.cursor })).result).toMatchObject({ ok: false, error: { code: 'TEAM_ACTOR_PROOF_INVALID' } })
    expect(save).not.toHaveBeenCalled()
    expect((await ctx.teams.readChannelPage({ channelId, afterCursor: -1, limit: 128 })).records.some(record => record.type === 'channel/envelope')).toBe(false)
  })

  it('discovers installed channel protocols and summary capabilities through authenticated catalog reads', async () => {
    const ctx = await setup(new GateAdapter(), async (seed) => {
      await seed.plugin(BasicChannel)
      await seed.plugin(ChannelSummary, { allowedPolicies: ['summarized-window'], maxSourceEnvelopes: 8,
        maxSourceBytes: 65536, maxSummaryBytes: 1024, maxHistorySpan: 32, disposalTimeoutMs: 100 })
    })
    const api = createApiProxy(ctx, { defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(), cwd: process.cwd() })
    const client = new InProcessApiClient(authenticatedFetch(api))
    const catalog = value(await client.teams.channelCatalog({}))
    expect(catalog.adapters).toEqual(expect.arrayContaining([{ type: 'consult', version: 1 }, { type: 'discussion', version: 1 }]))
    expect(catalog.summary).toEqual({ allowedPolicies: ['summarized-window'], maxSourceEnvelopes: 8,
      maxSourceBytes: 65536, maxSummaryBytes: 1024, maxHistorySpan: 32 })
    const anonymous = new InProcessApiClient(toFetchHandler(api))
    expect((await anonymous.teams.channelCatalog({})).result.ok).toBe(false)
    const temporary = ctx.teams.registerViewPolicy({ type: 'temporary-catalog', version: 1, project: () => ({}) })
    expect(value(await client.teams.channelCatalog({})).viewPolicies).toContainEqual({ type: 'temporary-catalog', version: 1 })
    temporary()
    expect(value(await client.teams.channelCatalog({})).viewPolicies).not.toContainEqual({ type: 'temporary-catalog', version: 1 })
  })

  it('derives human consult responses from the retained request and enforces discussion text and turn constraints', async () => {
    const ctx = await setup(new GateAdapter(), async (seed) => {
      await seed.plugin(BasicChannel)
      await seed.plugin(ChannelSummary, { allowedPolicies: ['summarized-window'], maxSourceEnvelopes: 8,
        maxSourceBytes: 65536, maxSummaryBytes: 1024, maxHistorySpan: 32, disposalTimeoutMs: 100 })
    })
    const api = createApiProxy(ctx, { defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(), cwd: process.cwd() })
    const client = new InProcessApiClient(authenticatedFetch(api))
    const created = value(await client.teams.create({ objective: 'Human protocol input.', cwd: process.cwd() }))
    const human = required(created.participants.find(p => p.role === 'human'), 'human')
    const coordinator = required(created.participants.find(p => p.role === 'coordinator'), 'coordinator')
    const agent = await postActor(ctx, created.team.id, coordinator.id)
    const open = async (type: 'consult' | 'discussion', humanInitiates = false) => {
      const channel = value(await client.teams.channelOpen({ teamId: created.team.id,
        expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
        adapter: { type, version: 1 }, viewPolicy: { type: 'summarized-window', version: 1 },
        participants: [{ id: coordinator.id, role: humanInitiates ? 'respondent' : 'initiator' },
          { id: human.id, role: humanInitiates ? 'initiator' : 'respondent' }],
        limits: type === 'consult' ? {} : { maxTurns: 3, speakerPolicy: 'round-robin' } }))
      const own = value(await client.teams.channelInvitation({ channelId: channel.manifest.id }))
      value(await client.teams.channelInvitationAcknowledge({ channelId: channel.manifest.id, revision: own.invitation.revision,
        manifestFingerprint: own.invitation.manifestFingerprint, idempotencyKey: `accept-${type}` as never }))
      await vi.waitFor(async () => { expect((await ctx.teams.getChannel({ channelId: channel.manifest.id })).phase).toBe('active') })
      return channel.manifest.id
    }
    const consultId = await open('consult')
    const input = async (channelId: typeof consultId, overrides: Partial<import('../src/api/teams.ts').TeamChannelInput> = {}) => await client.teams.channelInput({
      channelId, expectedCursor: (await ctx.teams.getChannel({ channelId })).cursor,
      audience: null, delivery: 'turn', content: [{ type: 'text', text: 'Human response.' }], ...overrides,
    })
    const early = (await input(consultId)).result
    expect(early).toMatchObject({ ok: false, error: { code: 'team-invalid-argument', message: 'The channel is not awaiting this participant' } })
    const request = await ctx.teams.postChannelEnvelope({ actor: agent,
      expectedCursor: (await ctx.teams.getChannel({ channelId: consultId })).cursor,
      draft: { channelId: consultId, audience: [human.id], delivery: 'turn', kind: 'request', payload: { text: 'Question.' } } })
    const inspection = value(await client.teams.channelAdmission({ teamId: created.team.id, channelId: consultId }))
    expect(inspection).toMatchObject({ expectedNext: { kind: 'participant', participantId: human.id },
      protocolStatus: { kind: 'consult', phase: 'response', request: { envelopeId: request.id, envelopeSequence: request.sequence, review: false } } })
    expect((await input(consultId, { causationId: 'forged-request' as never })).result.ok).toBe(false)
    expect((await input(consultId, { content: [{ type: 'image', mediaType: 'image/png', data: CHANNEL_MEDIA_PNG }] })).result.ok).toBe(false)
    const response = value(await input(consultId, { idempotencyKey: 'human-consult-response-retry' as never }))
    expect(response).toMatchObject({ kind: 'response', causationId: request.id, audience: [coordinator.id], payload: { text: 'Human response.' } })
    expect((await ctx.teams.getChannel({ channelId: consultId })).phase).toBe('closed')
    expect(value(await input(consultId, { idempotencyKey: 'human-consult-response-retry' as never }))).toEqual(response)
    expect(value(await input(consultId, { audience: [coordinator.id], idempotencyKey: 'human-consult-response-retry' as never }))).toEqual(response)
    expect((await input(consultId, {
      idempotencyKey: 'human-consult-response-retry' as never,
      content: [{ type: 'text', text: 'Changed response.' }],
    })).result).toMatchObject({ ok: false, error: { code: 'team-channel-idempotency-conflict' } })
    expect((await input(consultId)).result.ok).toBe(false)
    const discussionId = await open('discussion')
    expect((await input(discussionId)).result.ok).toBe(false)
    const firstDiscussion = await ctx.teams.postChannelEnvelope({ actor: agent,
      expectedCursor: (await ctx.teams.getChannel({ channelId: discussionId })).cursor,
      draft: { channelId: discussionId, audience: [human.id], delivery: 'context', kind: 'message', payload: { text: 'First turn.' } } })
    expect((await input(discussionId, { delivery: 'steer' })).result.ok).toBe(false)
    expect((await input(discussionId, { audience: [] })).result.ok).toBe(false)
    const discussion = value(await input(discussionId, { delivery: 'context' }))
    expect(discussion).toMatchObject({ kind: 'message', audience: [coordinator.id], payload: { text: 'Human response.' } })
    await vi.waitFor(async () => {
      const delivered = await ctx.teams.readChannel({ channelId: discussionId, afterCursor: -1 })
      expect(delivered.records).toEqual(expect.arrayContaining([expect.objectContaining({
        type: 'channel/receipt', envelopeId: discussion.id, participantId: coordinator.id,
      }), expect.objectContaining({ type: 'channel/receipt', envelopeId: firstDiscussion.id, participantId: human.id })]))
    })
    const selection = { channelId: discussionId, expectedCursor: (await ctx.teams.getChannel({ channelId: discussionId })).cursor,
      coveredSequenceRange: { from: discussion.sequence, to: discussion.sequence }, idempotencyKey: 'human-selected-summary' as never }
    const summary = value(await client.teams.channelSummarize(selection))
    expect(summary).toMatchObject({ sourceEnvelopeIds: [discussion.id], coveredSequenceRange: selection.coveredSequenceRange })
    expect(summary.text).toContain('Human response.')
    expect(value(await client.teams.channelSummarize(selection))).toEqual(summary)
    expect((await client.teams.channelSummarize({ ...selection, coveredSequenceRange: { from: 0, to: discussion.sequence } })).result.ok)
      .toBe(false)

    const task = value(await client.teams.taskCreate({
      teamId: created.team.id, expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('consult-linked-task'),
      subject: 'Consult task', description: 'Task linked to a human consult request.', blockedBy: [], requiredCapabilities: [],
      priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
    }))
    const initiated = await open('consult', true)
    const keyed = { taskId: task.id, idempotencyKey: 'human-consult-task-retry' as never }
    const question = value(await input(initiated, keyed))
    expect(question).toMatchObject({ kind: 'request', taskId: task.id })
    expect(value(await input(initiated, keyed))).toEqual(question)
    expect(value(await input(initiated, { idempotencyKey: keyed.idempotencyKey }))).toEqual(question)
    expect((await input(initiated, { ...keyed, taskId: 'changed-task' as never })).result)
      .toMatchObject({ ok: false, error: { code: 'team-channel-idempotency-conflict' } })
    await ctx.teams.postChannelEnvelope({ actor: agent,
      expectedCursor: (await ctx.teams.getChannel({ channelId: initiated })).cursor,
      draft: { channelId: initiated, audience: [human.id], delivery: 'turn', kind: 'response', taskId: task.id,
        causationId: question.id, payload: { text: 'Task answer.' } } })
    expect((await ctx.teams.getChannel({ channelId: initiated })).phase).toBe('closed')
    expect(value(await input(initiated, keyed))).toEqual(question)
    const records = await ctx.teams.readChannelPage({ channelId: initiated, afterCursor: -1, limit: 32 })
    expect(records.records.filter(record => record.type === 'channel/envelope')).toHaveLength(2)

  })

  it('pages attached channels through the current human Team membership', async () => {
    const ctx = await setup(new GateAdapter())
    const api = createApiProxy(ctx, { defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(), cwd: process.cwd() })
    const client = new InProcessApiClient(authenticatedFetch(api))
    const foreign = new InProcessApiClient(authenticatedFetch(api, foreignAuthenticatedProductCall))
    const created = value(await client.teams.create({ objective: 'Page channels.', cwd: process.cwd() }))
    const human = required(created.participants.find(p => p.role === 'human'), 'human')
    const coordinator = required(created.participants.find(p => p.role === 'coordinator'), 'coordinator')
    const added: string[] = []
    for (let index = 0; index < 2; index++) {
      const channel = value(await client.teams.channelOpen({ teamId: created.team.id,
        expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
        adapter: { type: 'direct', version: 4 }, viewPolicy: { type: 'directed', version: 1 },
        participants: [{ id: human.id, role: 'human' }, { id: coordinator.id, role: 'coordinator' }], limits: {} }))
      added.push(channel.manifest.id)
    }
    const first = value(await client.teams.channelList({ teamId: created.team.id, limit: 1 }))
    expect(first.items.map(channel => channel.manifest.id)).toEqual([created.channelIds[0]])
    expect(first.nextCursor).toBe(0)
    const next = value(await client.teams.channelList({ teamId: created.team.id, afterCursor: first.nextCursor!, limit: 1 }))
    expect(next.items.map(channel => channel.manifest.id)).toEqual([added[0]])
    expect(next.nextCursor).toBe(1)
    const last = value(await client.teams.channelList({ teamId: created.team.id, afterCursor: next.nextCursor!, limit: 1 }))
    expect(last.items.map(channel => channel.manifest.id)).toEqual([added[1]])
    expect(last.nextCursor).toBeUndefined()
    expect((await foreign.teams.channelList({ teamId: created.team.id })).result)
      .toMatchObject({ ok: false, error: { code: 'TEAM_HUMAN_ACTOR_NOT_FOUND' } })
    expect((await client.teams.channelList({ teamId: created.team.id, limit: 0 })).result)
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    const forged = await authenticatedFetch(api).fetch(new Request('http://x/api/team.channel.list', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        type: 'client-request', rpcId: 'forged-channel-list', method: 'team.channel.list',
        payload: { teamId: created.team.id, actor: 'forged' },
      }),
    }))
    expect(await forged.json()).toMatchObject({ result: { ok: false, error: { code: 'bad-request' } } })
  })

  it('inspects channel admission as a Team human without consenting or widening invitation ownership', async () => {
    const ctx = await setup(new GateAdapter())
    const api = createApiProxy(ctx, { defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(), cwd: process.cwd() })
    const client = new InProcessApiClient(authenticatedFetch(api))
    const foreign = new InProcessApiClient(authenticatedFetch(api, foreignAuthenticatedProductCall))
    const created = value(await client.teams.create({ objective: 'Inspect channel consent.', cwd: process.cwd() }))
    const coordinator = required(created.participants.find(p => p.role === 'coordinator'), 'coordinator')
    const member = value(await client.teams.memberInvite({ teamId: created.team.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
      kind: 'local-agent', displayName: 'Member', role: 'member', capabilities: [] }))
    value(await client.teams.memberActivate({ teamId: created.team.id, participantId: member.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor }))
    const channel = value(await client.teams.channelOpen({ teamId: created.team.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
      adapter: { type: 'direct', version: 4 }, viewPolicy: { type: 'directed', version: 1 },
      participants: [{ id: coordinator.id, role: 'member' }, { id: member.id, role: 'member' }], limits: {} }))
    const input = { teamId: created.team.id, channelId: channel.manifest.id }
    await vi.waitFor(async () => {
      const admission = await ctx.teams.getChannelAdmission({ channelId: input.channelId })
      expect(admission.invitations.find(invitation => invitation.participantId === coordinator.id)?.status).toBe('acknowledged')
    })
    const before = await ctx.teams.getChannelAdmission({ channelId: input.channelId })
    expect(value(await client.teams.channelAdmission(input))).toEqual({ ...before, expectedNext: { kind: 'none' }, protocolStatus: { kind: 'other' } })
    expect(await ctx.teams.getChannelAdmission({ channelId: input.channelId })).toEqual(before)
    expect((await client.teams.channelInvitation({ channelId: input.channelId })).result.ok).toBe(false)
    const endpoint = required(before.invitations[0], 'endpoint invitation')
    expect((await client.teams.channelInvitationAcknowledge({ channelId: input.channelId,
      revision: endpoint.revision, manifestFingerprint: endpoint.manifestFingerprint, idempotencyKey: 'foreign-endpoint' as never,
    })).result.ok).toBe(false)
    expect(await ctx.teams.getChannelAdmission({ channelId: input.channelId })).toEqual(before)
    expect((await foreign.teams.channelAdmission(input)).result).toMatchObject({ ok: false, error: { code: 'TEAM_HUMAN_ACTOR_NOT_FOUND' } })
    const other = value(await client.teams.create({ objective: 'Other Team.', cwd: process.cwd() }))
    expect((await client.teams.channelAdmission({ ...input, teamId: other.team.id })).result.ok).toBe(false)
    const raw = await authenticatedFetch(api).fetch(new Request('http://x/api/team.channel.admission', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        type: 'client-request', rpcId: 'forged-admission', method: 'team.channel.admission', payload: { ...input, actor: 'forged' },
      }),
    }))
    expect(await raw.json()).toMatchObject({ result: { ok: false, error: { code: 'bad-request' } } })
    const teams = required(api.teams, 'Team API')
    expect((await teams.channelAdmission({ rpcId: RpcId('unauthenticated-admission'), payload: input })).result.ok).toBe(false)
    const original = ctx.teams.getHumanChannelAdmission.bind(ctx.teams)
    const controller = new AbortController()
    const spy = vi.spyOn(ctx.teams, 'getHumanChannelAdmission').mockImplementation(async (request) => {
      controller.abort()
      return await original(request)
    })
    try {
      const revoked = await withAuthenticatedProductCall({ ...authenticatedProductCall, signal: controller.signal }, async () =>
        await teams.channelAdmission({ rpcId: RpcId('revoked-admission'), payload: input }))
      expect(revoked.result).toMatchObject({ ok: false, error: { code: 'TEAM_ACTOR_PROOF_INVALID' } })
    } finally { spy.mockRestore() }
  })

  it('discovers and explicitly accepts an ordinary human invitation before a real Session receipt', async () => {
    const adapter = new GateAdapter()
    const ctx = await setup(adapter)
    const api = createApiProxy(ctx, { defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(), cwd: process.cwd() })
    const client = new InProcessApiClient(authenticatedFetch(api))
    const foreign = new InProcessApiClient(authenticatedFetch(api, foreignAuthenticatedProductCall))
    const created = value(await client.teams.create({ objective: 'Explicit ordinary channel consent.', cwd: process.cwd() }))
    const human = required(created.participants.find(p => p.role === 'human'), 'human')
    const coordinator = required(created.participants.find(p => p.role === 'coordinator'), 'coordinator')
    const invited = value(await client.teams.memberInvite({ teamId: created.team.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
      kind: 'local-agent', displayName: 'Group member', role: 'member', capabilities: [] }))
    value(await client.teams.memberActivate({ teamId: created.team.id, participantId: invited.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor }))
    await ctx.teamActivations.activate({ teamId: created.team.id, participantId: invited.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor, provider: 'in-process',
      sessionId: SessionId('host-human-invitation-group'), seed: { kind: 'fresh' }, agent: { options: {} },
      signal: new AbortController().signal })
    const channel = value(await client.teams.channelOpen({ teamId: created.team.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
      adapter: { type: 'direct', version: 4 }, viewPolicy: { type: 'directed', version: 1 },
      participants: [{ id: human.id, role: 'owner' }, { id: coordinator.id, role: 'member' },
        { id: invited.id, role: 'member' }], limits: {} }))
    const channelId = channel.manifest.id
    const own = value(await client.teams.channelInvitation({ channelId }))
    expect(own.channel.phase).toBe('pending')
    expect(own.invitation).toMatchObject({ participantId: human.id, status: 'pending' })
    expect(Object.keys(own).sort()).toEqual(['channel', 'invitation'])
    expect(value(await client.teams.channelInvitation({ channelId })).invitation.status).toBe('pending')
    expect((await foreign.teams.channelInvitation({ channelId })).result).toMatchObject({ ok: false })
    const input = { channelId, revision: own.invitation.revision, manifestFingerprint: own.invitation.manifestFingerprint,
      idempotencyKey: 'explicit-human-acceptance' as never }
    expect((await foreign.teams.channelInvitationAcknowledge(input)).result).toMatchObject({ ok: false })
    expect((await client.teams.channelInvitationAcknowledge({ ...input, revision: input.revision + 1 })).result)
      .toMatchObject({ ok: false, error: { code: 'team-channel-cursor-conflict', details: { channelId } } })
    expect((await client.teams.channelInvitationAcknowledge({ ...input,
      manifestFingerprint: `sha256:${'0'.repeat(64)}` as never })).result).toMatchObject({ ok: false })
    const forged = await authenticatedFetch(api).fetch(new Request('http://x/api/team.channel.invitation.acknowledge', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request',
        rpcId: 'forged-human-invitation', method: 'team.channel.invitation.acknowledge', payload: { ...input, participantId: coordinator.id } }) }))
    expect(await forged.json()).toMatchObject({ result: { ok: false, error: { code: 'bad-request' } } })
    const accepted = value(await client.teams.channelInvitationAcknowledge(input))
    expect(accepted.invitation.status).toBe('acknowledged')
    expect(value(await client.teams.channelInvitationAcknowledge(input)).invitation).toEqual(accepted.invitation)
    await vi.waitFor(async () => { expect((await ctx.teams.getChannel({ channelId })).phase).toBe('active') })
    expect((await client.teams.channelPost({ channelId, expectedCursor: 0, audience: null,
      kind: DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND, payload: { content: [{ type: 'text', text: 'Stale send.' }] }, delivery: 'context',
    })).result).toMatchObject({ ok: false, error: { code: 'team-channel-cursor-conflict', details: { channelId } } })
    const posted = value(await client.teams.channelPost({ channelId,
      expectedCursor: (await ctx.teams.getChannel({ channelId })).cursor, audience: null,
      kind: DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND, payload: { content: [{ type: 'text', text: 'Accepted ordinary channel message.' }] }, delivery: 'context' }))
    await vi.waitFor(async () => {
      const page = await ctx.teams.readChannel({ channelId, afterCursor: 0 })
      expect(page.records.filter(record => record.type === 'channel/receipt' && record.envelopeId === posted.id)).toHaveLength(2)
    })
    value(await client.teams.channelClose({ channelId, expectedCursor: (await ctx.teams.getChannel({ channelId })).cursor }))
    expect((await client.teams.channelInvitationAcknowledge(input)).result).toMatchObject({ ok: false })
  })

  it('rejects authenticated consent after the actual configured invitation deadline', async () => {
    const ctx = await setup(new GateAdapter(), undefined, true, undefined, 500)
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(), cwd: process.cwd(),
    })))
    const created = value(await client.teams.create({ objective: 'Expired human invitation.', cwd: process.cwd() }))
    const human = required(created.participants.find(p => p.role === 'human'), 'human')
    const coordinator = required(created.participants.find(p => p.role === 'coordinator'), 'coordinator')
    const channel = value(await client.teams.channelOpen({ teamId: created.team.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
      adapter: { type: 'direct', version: 4 }, participants: [{ id: human.id, role: 'owner' },
        { id: coordinator.id, role: 'member' }], limits: {} }))
    const own = value(await client.teams.channelInvitation({ channelId: channel.manifest.id }))
    await new Promise(resolve => setTimeout(resolve, Math.max(0, own.invitation.deadline - Date.now())))
    expect((await client.teams.channelInvitationAcknowledge({ channelId: channel.manifest.id,
      revision: own.invitation.revision, manifestFingerprint: own.invitation.manifestFingerprint,
      idempotencyKey: 'after-real-deadline' as never })).result).toMatchObject({ ok: false })
  })

  it('opens and closes ordinary channels through authenticated actor-free Host routes', async () => {
    const ctx = await setup(new GateAdapter())
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })
    if (api.teams === undefined) throw new Error('Team API was not registered')
    const client = new InProcessApiClient(authenticatedFetch(api))
    const created = value(await client.teams.create({ objective: 'Control ordinary channel lifecycle.', cwd: process.cwd() }))
    const human = required(created.participants.find(participant => participant.role === 'human'), 'human participant')
    const coordinator = required(created.participants.find(participant => participant.role === 'coordinator'), 'coordinator participant')
    const state = await ctx.teams.getTeam({ teamId: created.team.id })
    const openInput = {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: human.id, role: 'owner' }, { id: coordinator.id, role: 'recipient' }],
      limits: {},
    }
    const openChannel = vi.spyOn(ctx.teams, 'openChannel')
    const unauthenticatedOpen = await api.teams.channelOpen({
      rpcId: RpcId('channel-open-without-auth'),
      payload: openInput,
    })
    expect(unauthenticatedOpen.result).toMatchObject({ ok: false, error: { code: 'PRODUCT_AUTH_REQUIRED' } })
    expect(openChannel).not.toHaveBeenCalled()

    const forgedOpen = await authenticatedFetch(api).fetch(new Request('http://x/api/team.channel.open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'channel-open-forged-actor',
        method: 'team.channel.open',
        payload: { ...openInput, actor: 'forged' },
      }),
    }))
    expect(await forgedOpen.json()).toMatchObject({ result: { ok: false, error: { code: 'bad-request' } } })

    const opened = value(await client.teams.channelOpen(openInput))
    expect(opened.manifest).toMatchObject({ teamId: created.team.id, participants: openInput.participants })
    const staleOpen = await client.teams.channelOpen(openInput)
    expect(staleOpen.result).toMatchObject({ ok: false, error: { code: 'TEAM_ACTOR_PROOF_INVALID' } })

    await vi.waitFor(async () => {
      const admission = await ctx.teams.getChannelAdmission({ channelId: opened.manifest.id })
      expect(admission.invitations.find(invitation => invitation.participantId === coordinator.id)?.status).toBe('acknowledged')
    })
    const current = await ctx.teams.getChannel({ channelId: opened.manifest.id })
    const closeInput = {
      channelId: opened.manifest.id,
      expectedCursor: current.cursor,
      reason: 'Authenticated Host close.',
    }
    const closeChannel = vi.spyOn(ctx.teams, 'closeChannel')
    const unauthenticatedClose = await api.teams.channelClose({
      rpcId: RpcId('channel-close-without-auth'),
      payload: closeInput,
    })
    expect(unauthenticatedClose.result).toMatchObject({ ok: false, error: { code: 'PRODUCT_AUTH_REQUIRED' } })
    expect(closeChannel).not.toHaveBeenCalled()

    const forgedClose = await authenticatedFetch(api).fetch(new Request('http://x/api/team.channel.close', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'channel-close-forged-actor',
        method: 'team.channel.close',
        payload: { ...closeInput, actor: 'forged', teamId: created.team.id },
      }),
    }))
    expect(await forgedClose.json()).toMatchObject({ result: { ok: false, error: { code: 'bad-request' } } })

    const closed = value(await client.teams.channelClose(closeInput))
    expect(closed.phase).toBe('closed')
    expect(closeChannel).toHaveBeenCalledTimes(1)
  })

  it('rejects ordinary channel admission when the authenticated human grant omits channel-open', async () => {
    let denied: { readonly teamId: TeamId; readonly humanId: ParticipantSnapshot['id']; readonly expectedCursor: number } | undefined
    const ctx = await setup(new GateAdapter(), async (seed) => {
      const created = await createTestRootTeam(seed, {
        goal: { objective: 'Deny an ungranted ordinary channel open.', budgets: {} }, rules: {}, budgets: {},
      })
      let state = await seed.teams.getTeam({ teamId: created.team.id })
      const human = await inviteBootstrapParticipant(seed, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        kind: 'human',
        displayName: 'Restricted authenticated human',
        role: 'owner',
        capabilities: [],
        owner: { kind: 'product-principal', principalId: authenticatedProductCall.principal.id },
        authorityGrant: { operations: ['close'], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} },
      })
      state = await seed.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(seed, {
        teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'provisioning',
      })
      state = await seed.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(seed, {
        teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'active',
      })
      state = await seed.teams.getTeam({ teamId: created.team.id })
      denied = { teamId: created.team.id, humanId: human.id, expectedCursor: state.team.cursor }
    }, false)
    if (denied === undefined) throw new Error('restricted Team fixture was not created')
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })
    const client = new InProcessApiClient(authenticatedFetch(api))
    const openChannel = vi.spyOn(ctx.teams, 'openChannel')
    const response = await client.teams.channelOpen({
      teamId: denied.teamId,
      expectedCursor: denied.expectedCursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: denied.humanId, role: 'owner' }],
      limits: {},
    })
    expect(response.result).toMatchObject({ ok: false, error: { code: 'TEAM_HUMAN_ACTOR_FORBIDDEN' } })
    expect(openChannel).not.toHaveBeenCalled()
  })

  it('routes authenticated member mutations through complete human proof inputs', async () => {
    const ctx = await setup(new GateAdapter())
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })
    const client = new InProcessApiClient(authenticatedFetch(api))
    const created = value(await client.teams.create({ objective: 'Control Team members through product authentication.', cwd: process.cwd() }))
    const teamId = created.team.id
    const coordinator = required(created.participants.find(participant => participant.role === 'coordinator'), 'coordinator participant')
    if (api.teams === undefined) throw new Error('Team API was not registered')
    const inviteParticipant = vi.spyOn(ctx.teams, 'inviteParticipant')
    const unauthenticated = await api.teams.memberInvite({
      rpcId: RpcId('member-invite-without-auth'),
      payload: {
        teamId,
        expectedCursor: created.team.cursor,
        kind: 'local-agent',
        displayName: 'Unauthenticated member',
        role: 'member',
        capabilities: [],
      },
    })
    expect(unauthenticated.result).toMatchObject({ ok: false, error: { code: 'PRODUCT_AUTH_REQUIRED' } })
    expect(inviteParticipant).not.toHaveBeenCalled()

    const inviteInput = {
      teamId,
      expectedCursor: created.team.cursor,
      kind: 'local-agent' as const,
      displayName: 'Managed member',
      role: 'member',
      capabilities: [],
    }
    const invited = value(await client.teams.memberInvite(inviteInput))
    expect(invited).toMatchObject({ teamId, phase: 'invited', displayName: inviteInput.displayName })
    expect(inviteParticipant).toHaveBeenCalledTimes(1)

    const stale = await client.teams.memberInvite({ ...inviteInput, displayName: 'Stale member' })
    expect(stale.result).toMatchObject({ ok: false, error: { code: 'TEAM_ACTOR_PROOF_INVALID' } })

    let state = await ctx.teams.getTeam({ teamId })
    const activated = value(await client.teams.memberActivate({
      teamId,
      participantId: invited.id,
      expectedCursor: state.team.cursor,
    }))
    expect(activated.phase).toBe('active')

    state = await ctx.teams.getTeam({ teamId })
    const removed = value(await client.teams.memberRemove({
      teamId,
      participantId: invited.id,
      expectedCursor: state.team.cursor,
    }))
    expect(removed.phase).toBe('left')

    state = await ctx.teams.getTeam({ teamId })
    const interrupt = value(await client.teams.memberInterrupt({
      teamId,
      participantId: coordinator.id,
      expectedCursor: state.team.cursor,
    }))
    expect(interrupt).toMatchObject({ target: { participantId: coordinator.id } })

    const response = await authenticatedFetch(api).fetch(new Request('http://x/api/team.member.invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'member-invite-forged-actor',
        method: 'team.member.invite',
        payload: { ...inviteInput, actor: 'forged' },
      }),
    }))
    expect(await response.json()).toMatchObject({ result: { ok: false, error: { code: 'bad-request' } } })
  })

  it('posts one authenticated human Envelope through the actor-free channel route', async () => {
    const adapter = new GateAdapter()
    const ctx = await setup(adapter)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })
    const client = new InProcessApiClient(authenticatedFetch(api))
    const created = value(await client.teams.create({ objective: 'Post an authenticated human channel message.', cwd: process.cwd() }))
    const human = required(created.participants.find(participant => participant.role === 'human'), 'human participant')
    const coordinator = required(created.participants.find(participant => participant.role === 'coordinator'), 'coordinator participant')
    const channelId = required(created.channelIds[0], 'default Team channel')
    const channel = await ctx.teams.getChannel({ channelId })
    const input = {
      channelId,
      expectedCursor: channel.cursor,
      audience: [coordinator.id],
      kind: DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND,
      payload: { content: [{ type: 'text', text: 'Authenticated generic channel post.' }] },
      delivery: 'context' as const,
    }

    if (api.teams === undefined) throw new Error('Team API was not registered')
    const getChannel = vi.spyOn(ctx.teams, 'getChannel')
    const unauthenticated = await api.teams.channelPost({ rpcId: RpcId('channel-post-without-auth'), payload: input })
    expect(unauthenticated.result).toMatchObject({ ok: false, error: { code: 'PRODUCT_AUTH_REQUIRED' } })
    expect(getChannel).not.toHaveBeenCalled()
    getChannel.mockRestore()

    const posted = value(await client.teams.channelPost(input))
    expect(posted).toMatchObject({
      teamId: created.team.id,
      channelId,
      senderId: human.id,
      audience: [coordinator.id],
      payload: input.payload,
    })

    const response = await authenticatedFetch(api).fetch(new Request('http://x/api/team.channel.post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'channel-post-forged-actor',
        method: 'team.channel.post',
        payload: { ...input, actor: 'forged' },
      }),
    }))
    expect(await response.json()).toMatchObject({ result: { ok: false, error: { code: 'bad-request' } } })
  })

  it('refuses a system-owned detached Team before TeamRun cancellation', async () => {
    let detached: TeamStateSnapshot | undefined
    const ctx = await setup(new GateAdapter(), async (seed) => {
      detached = await createTestRootTeam(seed, {
        goal: { objective: 'Remain active without a local TeamRun owner.', budgets: {} },
        rules: {},
        budgets: {},
      })
    })
    if (detached === undefined) throw new Error('detached Team fixture did not create before TeamRun mounted')
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })))
    const cancelTeam = vi.spyOn(ctx.teams, 'cancelTeam')
    const cancelRun = vi.spyOn(ctx.teamRuns, 'cancel')

    await expect(client.teams.cancel({ teamId: detached.team.id })).resolves.toMatchObject({
      result: {
        ok: false,
        error: { code: 'TEAM_HUMAN_ACTOR_NOT_FOUND', details: { teamId: detached.team.id } },
      },
    })
    expect(cancelTeam).not.toHaveBeenCalled()
    expect(cancelRun).not.toHaveBeenCalled()
    expect((await ctx.teams.getTeam({ teamId: detached.team.id })).team.phase).toBe('active')
  })

  it('recovers a detached product-owned Team before cancelling it', async () => {
    const ctx = await setup(new GateAdapter())
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })
    const client = new InProcessApiClient(authenticatedFetch(api))
    const created = value(await client.teams.create({ objective: 'Cancel after a host restart.', cwd: process.cwd() }))
    const internals = ctx.teamRuns as unknown as {
      readonly runs: Map<TeamId, { readonly handle: TeamRun.TeamRunHandle }>
    }
    const owned = required(internals.runs.get(created.team.id), 'Team-run state')
    await owned.handle.coordinatorLease.dispose()
    internals.runs.delete(created.team.id)

    await expect(client.teams.cancel({ teamId: created.team.id })).resolves.toMatchObject({
      result: { ok: true, value: { accepted: true, phase: 'cancelled' } },
    })
    expect((await ctx.teams.getTeam({ teamId: created.team.id })).team.phase).toBe('cancelled')
  })

  it('reuses a human input Envelope after a cursor-moving delivery receipt', async () => {
    const adapter = new GateAdapter()
    const ctx = await setup(adapter)
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })))
    const created = value(await client.teams.create({ objective: 'Retry one human input.', cwd: process.cwd() }))
    const request = {
      teamId: created.team.id,
      text: 'Retry this human input once.',
      idempotencyKey: channelPostIdempotencyKeySchema.parse('host-team-input'),
    }

    const first = value(await client.teams.postInput(request))
    await adapter.started.promise
    const retry = value(await client.teams.postInput(request))
    expect(retry.envelopeId).toBe(first.envelopeId)
  })

  it('routes a live coordinator Session prompt through the Team human channel', async () => {
    const adapter = new GateAdapter()
    const ctx = await setup(adapter)
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })))
    const created = value(await client.teams.create({ objective: 'Route the Session prompt.', cwd: process.cwd() }))
    const teamId = created.team.id
    const human = required(created.participants.find(participant => participant.role === 'human'), 'human participant')
    expect(human.owner).toEqual({ kind: 'product-principal', principalId: authenticatedProductCall.principal.id })
    const coordinator = required(created.participants.find(participant => participant.role === 'coordinator'), 'coordinator participant')
    const binding = required(
      created.activations.find(item => item.activation.participantId === coordinator.id),
      'coordinator activation',
    )
    expect(value(await client.sessions.list({})).items.find(item => item.sessionId === binding.sessionId)?.team)
      .toEqual({ teamId, participantId: coordinator.id })
    const coordinatorAgent = required(ctx.agents.get(binding.sessionId), 'coordinator Agent')
    const postHumanInput = vi.spyOn(ctx.teamRuns, 'postHumanInput')

    expect(value(await client.sessions.prompt({
      sessionId: binding.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'Use the Team channel.' }],
    }))).toEqual({ accepted: true })
    await adapter.started.promise

    expect(postHumanInput).toHaveBeenCalledWith({
      teamId,
      content: [{ type: 'text', text: 'Use the Team channel.' }],
      delivery: 'turn',
      humanOwner: { kind: 'product-principal', principalId: 'test-product-principal' },
    })
    const channelId = required(created.channelIds[0], 'default Team channel')
    const records = await ctx.teams.readChannel({ channelId, afterCursor: -1 })
    const envelope = required(
      records.records.find(record => record.type === 'channel/envelope'),
      'human Team Envelope',
    )
    if (envelope.type !== 'channel/envelope') throw new Error('human Team Envelope has the wrong record type')
    expect(envelope.envelope).toMatchObject({
      senderId: human.id,
      audience: [coordinator.id],
      payload: { content: [{ type: 'text', text: 'Use the Team channel.' }] },
      delivery: 'turn',
    })
    await vi.waitFor(() => {
      const delivered = coordinatorAgent.session.events.find(event => event.type === 'user/message')
      expect(delivered?.data.source).toMatchObject({ kind: 'team-envelope', envelopeId: envelope.envelope.id, delivery: 'turn' })
    })
    adapter.release.resolve(undefined)
  })

  it('projects Team steer delivery as pending steering in the Session queue', async () => {
    const adapter = new GateAdapter()
    const ctx = await setup(adapter)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })
    const teams = api.teams
    if (teams === undefined) throw new Error('Team API was not registered')
    const created = value(await withAuthenticatedProductCall(authenticatedProductCall, async () =>
      await teams.create({
        rpcId: RpcId('team-queue-create'),
        payload: { objective: 'Project Team steering.', cwd: process.cwd() },
      }, new AbortController().signal)))
    const coordinator = required(created.participants.find(participant => participant.role === 'coordinator'), 'coordinator participant')
    const binding = required(
      created.activations.find(item => item.activation.participantId === coordinator.id),
      'coordinator activation',
    )
    const queueAbort = new AbortController()
    const queued = (async (): Promise<Extract<MuxFrame, { type: 'session/queue' }>> => {
      for await (const envelope of api.events.mux({ rpcId: RpcId('team-queue-mux'), payload: {} }, queueAbort.signal)) {
        const frame = envelope.payload
        if (frame.type === 'session/queue' && frame.sessionId === binding.sessionId && frame.items.length > 0) {
          queueAbort.abort()
          return frame
        }
      }
      throw new Error('Team queue stream closed before the steering frame')
    })()

    const posted = await withAuthenticatedProductCall(authenticatedProductCall, async () =>
      await teams.postInput({
        rpcId: RpcId('team-queue-input'),
        payload: { teamId: created.team.id, text: 'Steer the coordinator.', delivery: 'steer' },
      }))
    expect(posted.result.ok).toBe(true)
    const frame = await queued
    const item = frame.items[0]
    if (item === undefined) throw new Error('Team steering queue projection has no item')
    expect(item.placement).toBe('steering')
    const source = item.message.source as unknown as { readonly kind: string; readonly delivery?: string }
    expect(source.kind).toBe('team-envelope')
    expect(source.delivery).toBe('steer')
    adapter.release.resolve(undefined)
  })

  it('rejects cancellation of a live Team coordinator Session without an authenticated actor', async () => {
    const adapter = new GateAdapter()
    const ctx = await setup(adapter)
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })))
    const created = value(await client.teams.create({ objective: 'Interrupt the coordinator.', cwd: process.cwd() }))
    const teamId = created.team.id
    const coordinator = required(created.participants.find(participant => participant.role === 'coordinator'), 'coordinator participant')
    const binding = required(
      created.activations.find(item => item.activation.participantId === coordinator.id),
      'coordinator activation',
    )
    const requestInterrupt = vi.spyOn(ctx.teams, 'requestParticipantInterrupt')
    const cancelRun = vi.spyOn(ctx.teamRuns, 'cancel')

    value(await client.sessions.prompt({
      sessionId: binding.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'Wait for the cancellation request.' }],
    }))
    await adapter.started.promise
    expectTeamActorUnavailable(await client.sessions.cancel({ sessionId: binding.sessionId }), teamId)

    expect(requestInterrupt).not.toHaveBeenCalled()
    expect(cancelRun).not.toHaveBeenCalled()
    adapter.release.resolve(undefined)
  })

  it('keeps prompt and raw queue mutation behind Team ownership while allowing model reads', async () => {
    const adapter = new GateAdapter()
    const ctx = await setup(adapter)
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })))
    const created = value(await client.teams.create({ objective: 'Keep the coordinator Team-owned.', cwd: process.cwd() }))
    const coordinator = required(created.participants.find(participant => participant.role === 'coordinator'), 'coordinator participant')
    const binding = required(
      created.activations.find(item => item.activation.participantId === coordinator.id),
      'coordinator activation',
    )
    const agent = required(ctx.agents.get(binding.sessionId), 'coordinator Agent')
    const queuedId = MessageId('team-owned-queued-message')
    ;(agent.inbox.nextTurn as unknown[]).push({
      id: queuedId,
      role: 'user',
      source: { kind: 'team-envelope' },
      content: [{ type: 'text', text: 'Do not mutate this pending Team input.' }],
    })
    const resume = vi.spyOn(ctx.agents, 'resume')
    const remove = vi.spyOn(agent.inbox, 'remove')

    const models = await client.sessions.models({ sessionId: binding.sessionId })
    expect(models.result).toMatchObject({
      ok: true,
      value: { current: { provider: 'mock', model: 'mock' }, routable: true },
    })
    expect(await client.sessions.selectModel({
      sessionId: binding.sessionId,
      provider: 'mock',
      model: 'mock',
    })).toMatchObject({ result: { ok: true, value: { selected: { provider: 'mock', model: 'mock' } } } })
    const queue = await client.sessions.updateQueue({
      sessionId: binding.sessionId,
      itemId: queuedId,
      action: { kind: 'remove' },
    })
    expect(queue.result).toMatchObject({
      ok: false,
      error: { code: 'team-run-unavailable', details: {} },
    })
    expect(resume).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    adapter.release.resolve(undefined)
  })

  it('allows model metadata reads for a live Team worker without granting coordinator controls', async () => {
    const adapter = new GateAdapter()
    const ctx = await setup(adapter, undefined, false)
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })))
    const worker = await ctx.agents.create({
      sessionId: SessionId('team-worker-model-read'),
      meta: { teamId: 'team-worker-model-read', participantId: 'participant-worker' },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const models = await client.sessions.models({ sessionId: worker.agent.session.id })
    expect(models.result).toMatchObject({
      ok: true,
      value: { current: { provider: 'mock', model: 'mock' }, routable: true },
    })
    await expect(client.sessions.selectModel({
      sessionId: worker.agent.session.id,
      provider: 'mock',
      model: 'mock',
    })).resolves.toMatchObject({ result: { ok: false, error: { code: 'team-run-unavailable' } } })
    await worker.dispose()
  })

  it('keeps an ordinary Session on the direct prompt and cancellation path', async () => {
    const adapter = new GateAdapter()
    const ctx = await setup(adapter)
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })))
    const ordinary = await ctx.agents.create({
      sessionId: SessionId('ordinary-host-session'),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const postHumanInput = vi.spyOn(ctx.teamRuns, 'postHumanInput')
    const requestInterrupt = vi.spyOn(ctx.teams, 'requestParticipantInterrupt')
    const cancel = vi.spyOn(ordinary.agent, 'cancel')

    expect(value(await client.sessions.prompt({
      sessionId: ordinary.agent.id,
      mode: 'queue',
      content: [{ type: 'text', text: 'Use the ordinary Session path.' }],
    }))).toEqual({ accepted: true })
    await adapter.started.promise
    expect(value(await client.sessions.cancel({ sessionId: ordinary.agent.id }))).toEqual({ accepted: true })

    expect(postHumanInput).not.toHaveBeenCalled()
    expect(requestInterrupt).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
    expect(ordinary.agent.session.events.find(event => event.type === 'user/message')?.data.source.kind).toBe('user')
    adapter.release.resolve(undefined)
  })

  it('rejects invalid payloads and absent Team composition with typed errors', async () => {
    const client = new InProcessApiClient(authenticatedFetch({} as ApiProxy))
    const invalid = await client.teams.create({ objective: '   ' })
    expect(invalid.result.ok).toBe(false)
    if (!invalid.result.ok) expect(invalid.result.error.code).toBe('bad-request')

    const unavailable = await client.teams.list({})
    expect(unavailable.result).toEqual({
      ok: false,
      error: {
        code: 'team-service-unavailable',
        message: 'Team RPC is unavailable: this host does not compose a Team provider',
        details: {},
      },
    })
  })

  it('maps unavailable local Team task capabilities onto the public run error', async () => {
    const ctx = await setup(new GateAdapter())
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })))
    const owned = value(await client.teams.create({ objective: 'Hold one owned Team for the run error.' }))
    vi.spyOn(ctx.teamRuns, 'create').mockRejectedValueOnce(new TeamRun.TeamRunError(
      'worker preset is unavailable',
      'TEAM_RUN_WORKER_PRESET_REQUIRED',
    ))
    vi.spyOn(ctx.teamRuns, 'postHumanInput').mockRejectedValueOnce(new TeamRun.TeamRunError(
      'coordinator activation is unavailable',
      'TEAM_RUN_COORDINATOR_INVALID',
    ))

    const create = await client.teams.create({ objective: 'Start a Team task.' })
    expect(create.result).toEqual({
      ok: false,
      error: { code: 'team-run-unavailable', message: 'worker preset is unavailable', details: {} },
    })
    const teamId = owned.team.id
    const input = await client.teams.postInput({ teamId, text: 'Continue the Team task.' })
    expect(input.result).toEqual({
      ok: false,
      error: {
        code: 'team-run-unavailable',
        message: 'coordinator activation is unavailable',
        details: { teamId },
      },
    })
  })

  it('maps Team-route attachment failures onto the public attachment error', async () => {
    const ctx = await setup(new GateAdapter())
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })))
    const created = value(await client.teams.create({ objective: 'Reject one Team attachment.' }))
    vi.spyOn(ctx.teamRuns, 'postHumanInput').mockRejectedValueOnce(new AttachmentError(
      'Image exceeds the configured per-side limit.',
      'IMAGE_DIMENSION_TOO_LARGE',
    ))

    const result = await client.teams.postInput({ teamId: created.team.id, text: 'This will be rejected.' })
    expect(result.result).toEqual({
      ok: false,
      error: {
        code: 'attachment-error',
        message: 'Image exceeds the configured per-side limit.',
        details: { reason: 'IMAGE_DIMENSION_TOO_LARGE' },
      },
    })
  })

  it('preserves the principal inbox retention cursor through the authenticated fetch carrier', async () => {
    const ctx = await setup(new GateAdapter())
    vi.spyOn(ctx.teamHumanDelivery, 'read').mockRejectedValueOnce(new TeamError('Inbox history compacted',
      'TEAM_INBOX_COMPACTED', { details: { firstCursor: 8 } }))
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(), cwd: process.cwd(),
    })))
    await expect(client.teams.inboxRead({ afterCursor: -1 })).resolves.toMatchObject({ result: {
      ok: false, error: { code: 'team-inbox-compacted', details: { firstCursor: 8 } },
    } })
  })

  it('preserves compaction error codes and retained cursors across the Host boundary', async () => {
    const ctx = await setup(new GateAdapter())
    const teamId = teamIdSchema.parse('team-compaction-error')
    const channelId = channelIdSchema.parse('channel-compaction-error')
    vi.spyOn(ctx.teams, 'readChannelPage').mockRejectedValueOnce(new TeamError(
      'channel no longer retains the requested cursor',
      'TEAM_CHANNEL_COMPACTED',
      { details: { teamId, channelId, firstCursor: 4 } },
    ))
    vi.spyOn(ctx.teams, 'readAudit').mockRejectedValueOnce(new TeamError(
      'audit no longer retains the requested cursor',
      'TEAM_AUDIT_COMPACTED',
      { details: { teamId, channelId, firstCursor: 7 } },
    ))
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })))

    await expect(client.teams.channelRead({ channelId, afterCursor: -1, limit: 4 })).resolves.toMatchObject({
      result: {
        ok: false,
        error: {
          code: 'team-channel-compacted',
          details: { teamId, channelId, firstCursor: 4 },
        },
      },
    })
    await expect(client.teams.auditRead({ teamId, channelId, afterCursor: -1, limit: 4 })).resolves.toMatchObject({
      result: {
        ok: false,
        error: {
          code: 'team-audit-compacted',
          details: { teamId, channelId, firstCursor: 7 },
        },
      },
    })
  })

  it('reads only visible durable Team artifacts through their named provider', async () => {
    let state: TeamStateSnapshot | undefined
    const ctx = await setup(new GateAdapter(), async (seed) => {
      state = await createTestRootTeam(seed, {
        goal: { objective: 'Read one visible artifact.', budgets: {} },
        rules: {}, budgets: {},
      })
    })
    if (state === undefined) throw new Error('artifact Team fixture was not created')
    const visible = {
      id: 'local:visible-report', provider: 'local', kind: 'report' as const,
      uri: 'artifact-local://local/visible-report', visibility: 'team' as const,
    }
    const privateArtifact = {
      id: 'local:private-report', provider: 'local', kind: 'report' as const,
      uri: 'artifact-local://local/private-report', visibility: 'private' as const,
    }
    const stateWithArtifacts = {
      ...state,
      workspaceAllocations: [{ loss: { artifacts: [{ ...visible, id: 'retained-loss-report' }, { ...privateArtifact, id: 'private-loss-report' }] } }],
      tasks: [{ attemptHistory: [{ outcome: { kind: 'completed', result: { artifacts: [visible, privateArtifact] } } }] },
        { attemptHistory: [], delegation: { result: { artifacts: [{ ...visible, id: 'child-report' }] } } }],
    } as unknown as TeamStateSnapshot
    vi.spyOn(ctx.teams, 'getTeam').mockResolvedValue(stateWithArtifacts)
    const getArtifact = vi.spyOn(ctx.teams, 'getArtifact').mockImplementation(async ({ artifactId }) => {
      const values = [
        { ...visible, id: 'retained-loss-report' },
        visible,
        { ...visible, id: 'child-report' },
      ]
      return values.find(reference => reference.id === artifactId)
    })
    vi.spyOn(ctx.teams, 'listArtifactsPage').mockImplementation(async ({ afterCursor, limit }) => {
      const items = [
        { ...visible, id: 'retained-loss-report' },
        visible,
        { ...visible, id: 'child-report' },
      ]
      const start = afterCursor + 1
      const selected = items.slice(start, start + limit + 1)
      return {
        items: selected.slice(0, limit),
        ...(selected.length > limit ? { nextCursor: start + limit - 1 } : {}),
      }
    })
    const read = vi.fn(async (
      _provider: string,
      _request: { readonly reference: typeof visible; readonly signal?: AbortSignal },
    ) => new TextEncoder().encode('visible bytes'))
    ctx.root.provide('teamArtifacts', {
      getProvider: (name: string) => name === 'local' ? { name } : undefined,
      read,
    } as never)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })
    if (api.teams === undefined) throw new Error('Team API was not composed')
    const projection = await api.teams.get({ rpcId: RpcId('artifact-projection'), payload: { teamId: state.team.id } })
    if (!projection.result.ok) throw new Error(projection.result.error.message)
    const projectedResult = projection.result.value.tasks[0]?.attemptHistory[0]?.outcome
    if (projectedResult?.kind !== 'completed') throw new Error('artifact projection fixture was not retained')
    expect(projectedResult.result.artifacts).toEqual([visible])
    if (projection.result.ok) {
      expect(projection.result.value.workspaceAllocations[0]?.loss?.artifacts.map(reference => reference.id)).toEqual(['retained-loss-report'])
    }
    const client = new InProcessApiClient(authenticatedFetch(api))

    await expect(client.teams.artifactRead({ teamId: state.team.id, artifactId: visible.id })).resolves.toMatchObject({
      result: {
        ok: true,
        value: { artifact: visible, bytes: 13, data: Buffer.from('visible bytes').toString('base64') },
      },
    })
    await expect(client.teams.artifactRead({ teamId: state.team.id, artifactId: 'retained-loss-report' })).resolves.toMatchObject({
      result: { ok: true, value: { artifact: { id: 'retained-loss-report' }, bytes: 13 } },
    })
    await expect(client.teams.artifactRead({ teamId: state.team.id, artifactId: 'private-loss-report' })).resolves.toMatchObject({
      result: { ok: false, error: { code: 'team-artifact-not-found' } },
    })
    await expect(client.teams.artifactRead({ teamId: state.team.id, artifactId: privateArtifact.id })).resolves.toMatchObject({
      result: { ok: false, error: { code: 'team-artifact-not-found', details: { teamId: state.team.id, artifactId: privateArtifact.id } } },
    })
    await expect(client.teams.artifactRead({ teamId: state.team.id, artifactId: 'missing-report' })).resolves.toMatchObject({
      result: { ok: false, error: { code: 'team-artifact-not-found', details: { teamId: state.team.id, artifactId: 'missing-report' } } },
    })
    await expect(client.teams.artifactRead({ teamId: state.team.id, artifactId: 'child-report' })).resolves.toMatchObject({
      result: { ok: true, value: { artifact: { id: 'child-report' }, bytes: 13 } },
    })
    await expect(client.teams.artifactList({ teamId: state.team.id, afterCursor: -1, limit: 2 })).resolves.toMatchObject({
      result: { ok: true, value: { items: [{ id: 'retained-loss-report' }, { id: visible.id }], nextCursor: 1 } },
    })
    await expect(client.teams.artifactList({ teamId: state.team.id, afterCursor: 1, limit: 2 })).resolves.toMatchObject({
      result: { ok: true, value: { items: [{ id: 'child-report' }] } },
    })
    getArtifact.mockResolvedValueOnce(undefined)
    await expect(client.teams.artifactRead({ teamId: state.team.id, artifactId: visible.id })).resolves.toMatchObject({
      result: { ok: false, error: { code: 'team-artifact-not-found' } },
    })
    expect(read).toHaveBeenCalledTimes(3)
    const firstCall = read.mock.calls[0]
    if (firstCall === undefined) throw new Error('artifact provider was not called')
    expect(firstCall[0]).toBe('local')
    expect(firstCall[1].reference).toEqual(visible)
    expect(firstCall[1].signal).toBeInstanceOf(AbortSignal)
  })

  it('reports unavailable providers and maps an aborted artifact read to cancellation', async () => {
    let state: TeamStateSnapshot | undefined
    const ctx = await setup(new GateAdapter(), async (seed) => {
      state = await createTestRootTeam(seed, {
        goal: { objective: 'Exercise artifact read failure boundaries.', budgets: {} },
        rules: {}, budgets: {},
      })
    })
    if (state === undefined) throw new Error('artifact failure Team fixture was not created')
    const artifact = {
      id: 'remote:report', provider: 'remote', kind: 'report' as const,
      uri: 'artifact://remote/report', visibility: 'human' as const,
    }
    vi.spyOn(ctx.teams, 'getArtifact').mockResolvedValue(artifact)
    let providerAvailable = false
    let readImplementation: (request: { readonly signal?: AbortSignal }) => Promise<Uint8Array> = async () => new Uint8Array()
    ctx.root.provide('teamArtifacts', {
      getProvider: () => providerAvailable ? { name: 'remote' } : undefined,
      read: async (_provider: string, request: { readonly signal?: AbortSignal }) => await readImplementation(request),
    } as never)
    const api = createApiProxy(ctx, { defaultModelSelection: () => undefined, cwd: process.cwd() })
    if (api.teams === undefined) throw new Error('Team API was not composed')
    const teams = api.teams
    await expect(teams.artifactRead({ rpcId: RpcId('artifact-unavailable'), payload: { teamId: state.team.id, artifactId: artifact.id } }, new AbortController().signal)).resolves.toMatchObject({
      result: { ok: false, error: { code: 'team-artifact-unavailable' } },
    })

    const controller = new AbortController()
    providerAvailable = true
    readImplementation = async ({ signal }) => await new Promise<Uint8Array>((_resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new Error('read aborted'))
        return
      }
      signal?.addEventListener('abort', () => { reject(new Error('read aborted')) }, { once: true })
    })
    const pending = teams.artifactRead({ rpcId: RpcId('artifact-cancel'), payload: { teamId: state.team.id, artifactId: artifact.id } }, controller.signal)
    controller.abort()
    await expect(pending).resolves.toMatchObject({ result: { ok: false, error: { code: 'cancelled' } } })
  })

  it('resolves a caller preset before the roster default', async () => {
    let durable: TeamStateSnapshot | undefined
    const ctx = await setup(new GateAdapter(), async (seed) => {
      durable = await createTestRootTeam(seed, {
        goal: { objective: 'Hold the Host preset test.', budgets: {} },
        rules: {},
        budgets: {},
      })
    })
    if (durable === undefined) throw new Error('preset Team fixture did not create before TeamRun mounted')
    ctx.root.provide('agentPresets', { defaultId: 'roster-default' } as never)
    const create = vi.spyOn(ctx.teamRuns, 'create').mockResolvedValue({
      teamId: durable.team.id,
    } as TeamRun.TeamRunHandle)
    const client = new InProcessApiClient(authenticatedFetch(createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
    })))

    value(await client.teams.create({
      objective: 'Use the caller preset.',
      agentPreset: 'caller-preset',
    }))
    value(await client.teams.create({ objective: 'Use the roster default.' }))
    expect(create.mock.calls.map(([request]) => request.preset)).toEqual([
      'caller-preset',
      'roster-default',
    ])
  })
})
