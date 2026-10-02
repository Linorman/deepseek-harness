/** Actual Hub membership controls each queued SDK Team, channel and Session notification. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@clocky/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import SessionStore, { SessionId } from '@clocky/clocky-session'
import AgentRegistry from '@clocky/clocky-agent'
import ProductPrincipals, { ProductPrincipalError, productPrincipalId } from '@clocky/clocky-product-principal'
import Storage from '@clocky/clocky-storage'
import * as Json from '@clocky/clocky-storage-json'
import * as Log from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import * as HumanActors from '@clocky/clocky-team-human-actor'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { activationIdSchema } from '@clocky/clocky-team'
import type { JsonRpcTransportPeer } from '@clocky/clocky-sdk-protocol'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { bindTestActivation } from '../../../team/team-hub/tests/fixtures.ts'
import { HarnessSdkJsonRpcServer } from '../src/server.ts'
import type { SdkNotificationOptions } from '../src/server.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function fixture(options: SdkNotificationOptions = {}) {
  const directory = join(process.cwd(), '.tmp')
  await mkdir(directory, { recursive: true })
  const root = await mkdtemp(join(directory, 'sdk-notifications-'))
  const ctx = new Context()
  const servers: HarnessSdkJsonRpcServer[] = []
  cleanup.push(async () => {
    for (const server of servers) await server.shutdown()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(Storage)
  await ctx.plugin(Json, { root })
  await ctx.plugin(Log, { backend: 'json', routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(HumanActors)
  await ctx.plugin(Direct)
  await ctx.plugin(ProductPrincipals)
  const controllers = new Map<string, AbortController[]>()
  const retireProvider = ctx.productPrincipals.registerProvider({ name: 'local', async authenticate(request) {
    const owner = request.credential
    if (owner !== 'alice' && owner !== 'bob') throw new ProductPrincipalError('Invalid credential', 'PRODUCT_AUTH_INVALID')
    const controller = new AbortController()
    controllers.set(owner, [...controllers.get(owner) ?? [], controller])
    return { principal: { id: productPrincipalId(owner), issuer: 'local', subject: owner,
      assurance: 'test', credentialGeneration: 1 }, signal: controller.signal, revoke: () => { controller.abort() } }
  } })
  ctx.provide('llm', { listProviders: () => [{ id: 'test', name: 'test' }] } as never)
  const connect = async (owner: string) => {
    const frames: { method: string; params?: object }[] = []
    const server = new HarnessSdkJsonRpcServer(ctx, { notify: (method: string, params?: object) => {
      frames.push(params === undefined ? { method } : { method, params })
    } } as JsonRpcTransportPeer, 'local', options)
    servers.push(server)
    await server.initialize({ credential: owner, provider: 'test', model: 'test', cwd: root })
    return { server, frames }
  }
  const team = async (owner: string) => {
    const state = await createTestRootTeam(ctx, { goal: { objective: owner, budgets: {} }, budgets: {}, rules: {} })
    const teamId = state.team.id
    const invite = async (kind: 'human' | 'local-agent') => {
      const participant = await inviteBootstrapParticipant(ctx, { teamId, kind, role: kind, displayName: owner,
        capabilities: [], ...kind === 'human' ? { owner } : {}, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor })
      for (const phase of ['provisioning', 'active'] as const) {
        await transitionBootstrapParticipant(ctx, { teamId, participantId: participant.id, phase,
          expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor })
      }
      return participant
    }
    const human = await invite('human')
    const member = await invite('local-agent')
    const sessionId = SessionId(`${owner}-session`)
    await bindTestActivation(ctx, { expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      binding: { activation: { id: activationIdSchema.parse(`${owner}-epoch`), teamId, participantId: member.id, status: 'idle' },
        sessionId, provider: 'test' } })
    const session = ctx.sessions.create(sessionId, { meta: { teamId, participantId: member.id } })
    const channel = await openTestChannel(ctx, { teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      adapter: { type: 'direct', version: 4 }, participants: [human, member].map(p => ({ id: p.id, role: p.role })), limits: {} })
    return { teamId, human, member, session, channel }
  }
  return { ctx, root, connect, team, controllers, retireProvider }
}

it('sends Team, channel and bound Session facts only to the current member principal', async () => {
  const { ctx, connect, team } = await fixture()
  const own = await team('alice')
  const privateTeam = await team('bob')
  const alice = await connect('alice')
  const bob = await connect('bob')
  for (const target of [own, privateTeam]) {
    ctx.emit('team/changed', { type: 'team/changed', team: (await ctx.teams.getTeam({ teamId: target.teamId })).team })
    ctx.emit('channel/changed', { channelId: target.channel.manifest.id,
      record: { type: 'channel/closed', sequence: 1, createdAt: 1, phase: 'closed' } })
    ctx.emit('session/event', target.session, { type: 'session/end-seed', data: {}, time: 1, seq: 0 })
  }
  await Promise.all([alice.server.drainNotifications(), bob.server.drainNotifications()])
  for (const [connection, allowed, denied] of [[alice, own, privateTeam], [bob, privateTeam, own]] as const) {
    expect(connection.frames.map(frame => frame.method)).toEqual(['team.event', 'channel.event', 'session.event'])
    expect(JSON.stringify(connection.frames)).toContain(allowed.session.id)
    expect(JSON.stringify(connection.frames)).not.toContain(denied.teamId)
    expect(JSON.stringify(connection.frames)).not.toContain(denied.session.id)
  }
})

it('resolves Session ancestry and withholds unbound, missing and cyclic provenance', async () => {
  const { ctx, connect, team } = await fixture()
  const own = await team('alice')
  const alice = await connect('alice')
  const child = ctx.sessions.create(SessionId('owned-child'), { meta: { parentSession: own.session.id } })
  const fake = ctx.sessions.create(SessionId('forged-binding'), { meta: { teamId: own.teamId, participantId: own.member.id } })
  const missing = ctx.sessions.create(SessionId('missing-parent'), { meta: { parentSession: SessionId('absent') } })
  const cycle = ctx.sessions.create(SessionId('cycle'), { meta: { parentSession: SessionId('cycle') } })
  for (const session of [child, fake, missing, cycle]) {
    ctx.emit('session/event', session, { type: 'session/end-seed', data: {}, time: 1, seq: 0 })
  }
  await alice.server.drainNotifications()
  expect(alice.frames).toEqual([{ method: 'session.event', params: { sessionId: child.id,
    event: { type: 'session/end-seed', data: {}, time: 1, seq: 0 } } }])
})

it('rechecks membership after queued IO and drops the backlog after human withdrawal', async () => {
  const { ctx, connect, team } = await fixture()
  const own = await team('alice')
  const alice = await connect('alice')
  const held = Promise.withResolvers<undefined>()
  const entered = Promise.withResolvers<undefined>()
  const resolve = ctx.teams.resolveIdentities.bind(ctx.teams)
  const read = vi.spyOn(ctx.teams, 'resolveIdentities').mockImplementationOnce(async (input) => {
    await resolve(input)
    entered.resolve(undefined)
    await held.promise
    return await resolve(input)
  })
  ctx.emit('team/changed', { type: 'team/changed', team: (await ctx.teams.getTeam({ teamId: own.teamId })).team })
  await entered.promise
  ctx.emit('session/event', own.session, { type: 'session/end-seed', data: {}, time: 1, seq: 0 })
  await alice.server.removeTeamMember({ teamId: own.teamId, participantId: own.human.id,
    expectedCursor: (await ctx.teams.getTeam({ teamId: own.teamId })).team.cursor })
  held.resolve(undefined)
  await alice.server.drainNotifications()
  expect(alice.frames).toEqual([])
  read.mockRestore()
})

it('retires idle connections and waiting publishers when the credential or provider is withdrawn', async () => {
  const failure = vi.fn()
  const { ctx, connect, team, controllers, retireProvider } = await fixture({ onFailure: failure })
  const own = await team('alice')
  const alice = await connect('alice')
  controllers.get('alice')![0]!.abort()
  expect(failure).toHaveBeenCalledOnce()
  ctx.emit('session/event', own.session, { type: 'session/end-seed', data: {}, time: 1, seq: 0 })
  await alice.server.drainNotifications()
  expect(alice.frames).toEqual([])
  await expect(alice.server.handleRequest('team/metrics', {})).rejects.toMatchObject({ data: { code: 'PRODUCT_AUTH_REQUIRED' } })
  const active = await connect('alice')
  const held = Promise.withResolvers<undefined>()
  const entered = Promise.withResolvers<undefined>()
  const resolve = ctx.teams.resolveIdentities.bind(ctx.teams)
  vi.spyOn(ctx.teams, 'resolveIdentities').mockImplementationOnce(async (input) => {
    entered.resolve(undefined)
    await held.promise
    return await resolve(input)
  })
  ctx.emit('team/changed', { type: 'team/changed', team: (await ctx.teams.getTeam({ teamId: own.teamId })).team })
  await entered.promise
  const retirement = retireProvider()
  expect(failure).toHaveBeenCalledTimes(2)
  held.resolve(undefined)
  await active.server.drainNotifications()
  await retirement
  expect(active.frames).toEqual([])
})

it('withholds an old generation after another principal initializes the same connection', async () => {
  const { ctx, root, connect, team } = await fixture()
  const own = await team('alice')
  const other = await team('bob')
  const alice = await connect('alice')
  const held = Promise.withResolvers<undefined>()
  const entered = Promise.withResolvers<undefined>()
  const resolve = ctx.teams.resolveIdentities.bind(ctx.teams)
  vi.spyOn(ctx.teams, 'resolveIdentities').mockImplementationOnce(async (input) => {
    entered.resolve(undefined)
    await held.promise
    return await resolve(input)
  })
  ctx.emit('team/changed', { type: 'team/changed', team: (await ctx.teams.getTeam({ teamId: own.teamId })).team })
  await entered.promise
  await alice.server.initialize({ credential: 'bob', provider: 'test', model: 'test', cwd: root })
  ctx.emit('session/event', other.session, { type: 'session/end-seed', data: {}, time: 1, seq: 0 })
  held.resolve(undefined)
  await alice.server.drainNotifications()
  expect(alice.frames).toEqual([{ method: 'session.event', params: { sessionId: other.session.id,
    event: { type: 'session/end-seed', data: {}, time: 1, seq: 0 } } }])
})

it.each([false, true])('withholds an old-principal management response after reinitialization (provider failure: %s)', async (fail) => {
  const { ctx, root, connect, team } = await fixture()
  const own = await team('alice')
  const other = await team('bob')
  const alice = await connect('alice')
  const entered = Promise.withResolvers<undefined>()
  const held = Promise.withResolvers<undefined>()
  const read = ctx.teams.getTeam.bind(ctx.teams)
  vi.spyOn(ctx.teams, 'getTeam').mockImplementationOnce(async (input) => {
    const state = await read(input)
    entered.resolve(undefined)
    await held.promise
    if (fail) throw new Error('Private provider diagnostic')
    return state
  })
  const previous = alice.server.getTeam({ teamId: own.teamId })
  await entered.promise
  await alice.server.initialize({ credential: 'bob', provider: 'test', model: 'test', cwd: root })
  const rejection = expect(previous).rejects.toMatchObject({ data: { code: 'PRODUCT_AUTH_INVALID' } })
  held.resolve(undefined)
  await rejection
  expect((await alice.server.getTeam({ teamId: other.teamId })).state.team.id).toBe(other.teamId)
})

it.each(['frames', 'bytes'] as const)('fails the SDK stream when its %s bound is exceeded while authorization waits', async (limit) => {
  const failure = vi.fn()
  const { ctx, connect, team } = await fixture({ onFailure: failure, maxPendingFrames: limit === 'frames' ? 1 : 100,
    maxPendingBytes: 8192 })
  const own = await team('alice')
  const alice = await connect('alice')
  const entered = Promise.withResolvers<undefined>()
  const held = Promise.withResolvers<undefined>()
  const resolve = ctx.teams.resolveIdentities.bind(ctx.teams)
  vi.spyOn(ctx.teams, 'resolveIdentities').mockImplementationOnce(async (input) => {
    entered.resolve(undefined)
    await held.promise
    return await resolve(input)
  })
  ctx.emit('team/changed', { type: 'team/changed', team: (await ctx.teams.getTeam({ teamId: own.teamId })).team })
  await entered.promise
  for (let index = 0; index < 128; index++) {
    ctx.emit('session/event', own.session, { type: 'session/end-seed', data: {}, time: 1, seq: index })
  }
  held.resolve(undefined)
  await alice.server.drainNotifications()
  expect(failure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'SDK notification backlog exceeded its configured allowance' }))
  expect(alice.frames).toEqual([])
  await expect(alice.server.listTeams({})).rejects.toMatchObject({ data: { code: 'SDK_NOTIFICATION_UNAVAILABLE' } })
})

it('releases transport-drain waiting on overflow without publishing the next packet', async () => {
  const held = Promise.withResolvers<undefined>()
  const draining = Promise.withResolvers<undefined>()
  const failure = vi.fn()
  const { ctx, connect, team } = await fixture({ maxPendingFrames: 1, onFailure: failure,
    drain: async () => { draining.resolve(undefined); await held.promise } })
  const own = await team('alice')
  const alice = await connect('alice')
  const event = { type: 'team/changed' as const, team: (await ctx.teams.getTeam({ teamId: own.teamId })).team }
  ctx.emit('team/changed', event)
  await draining.promise
  ctx.emit('team/changed', event)
  await alice.server.drainNotifications()
  expect(failure).toHaveBeenCalledOnce()
  expect(alice.frames).toEqual([{ method: 'team.event', params: { event } }])
  held.resolve(undefined)
})
