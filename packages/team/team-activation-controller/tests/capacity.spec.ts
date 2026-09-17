/** Startup admission and termination evidence through real JSON/SQLite Team journals. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@clocky/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import type { AgentRuntimeActivationRequest } from '@clocky/clocky-agent-runtime'
import { SessionId } from '@clocky/clocky-session'
import { activationIdSchema, liveActivationCapacity, teamClosureIdempotencyKeySchema } from '@clocky/clocky-team'
import type { ParticipantSnapshot, TeamSystemActivationProof, TeamSystemClosureProof, TeamSystemClosureDriverProof, TeamSystemClosureDriverScope } from '@clocky/clocky-team'
import TeamHub from '@clocky/clocky-team-hub'
import * as Controller from '../src/index.ts'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  const results = await Promise.allSettled(cleanups.splice(0).reverse().map(dispose => dispose()))
  const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
  if (failures.length > 0) throw new AggregateError(failures)
})

async function setup(backend: 'json' | 'sqlite', ceiling: number | undefined, hooks: {
  start?: (request: AgentRuntimeActivationRequest) => Promise<void>
  dispose?: () => Promise<void>
  grantLimit?: number
} = {}) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp/live-capacity-'))
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'team.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  const hub = await ctx.plugin(TeamHub, { maxTeamDepth: 3 })
  await ctx.plugin(AgentRuntime)
  const starts: AgentRuntimeActivationRequest[] = []
  const stops: string[] = []
  ctx.agentRuntimes.registerProvider({
    name: 'capacity-provider', terminationMode: 'owned-process',
    async activate(request) {
      starts.push(request)
      await hooks.start?.(request)
      const activation = { id: activationIdSchema.parse(`capacity-${starts.length}`), teamId: request.teamId,
        participantId: request.participant.id, status: 'idle' as const }
      let stopped = false
      return { activation, sessionId: request.sessionId, localAgent: undefined,
        health: async () => ({ ...activation, status: stopped ? 'offline' as const : 'idle' as const }),
        onStatus: () => () => {}, interrupt() {},
        async dispose() { await hooks.dispose?.(); stopped = true; stops.push(activation.id) },
      }
    },
  })
  const controller = await ctx.plugin(Controller)
  cleanups.push(async () => { await controller.dispose() })
  const team = await createTestRootTeam(ctx, { goal: { objective: 'Bound startup capacity', budgets: {} },
    rules: {}, budgets: ceiling === undefined ? {} : { maxLiveActivations: ceiling },
    ...hooks.grantLimit === undefined ? {} : { authorityGrant: {
      operations: ['register', 'invite', 'activate', 'close'], workspaceModes: ['shared'], readScopes: [], writeScopes: [],
      budgets: { maxLiveActivations: hooks.grantLimit },
    } } })
  const teamId = team.team.id
  async function member(role: string, maxLiveActivations?: number) {
    const state = await ctx.teams.getTeam({ teamId })
    const participant = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: state.team.cursor,
      kind: 'local-agent', displayName: role, role, capabilities: [], provider: 'capacity-provider',
      ...maxLiveActivations === undefined ? {} : { authorityGrant: {
        ...state.team.authorityGrant!, budgets: { ...state.team.authorityGrant?.budgets, maxLiveActivations },
      } } })
    for (const phase of ['provisioning', 'active'] as const) {
      await transitionBootstrapParticipant(ctx, { teamId, participantId: participant.id,
        expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, phase })
    }
    return participant
  }
  async function activate(participant: ParticipantSnapshot) {
    return await ctx.teamActivations.activate({ teamId, participantId: participant.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, provider: 'capacity-provider',
      sessionId: SessionId(`capacity-session-${participant.id}`), seed: { kind: 'fresh' },
      agent: { options: {} }, signal: new AbortController().signal })
  }
  async function capacity() {
    const state = await ctx.teams.getTeam({ teamId })
    return liveActivationCapacity(state.participants, state.activations, state.tasks)
  }
  return { ctx, hub, controller, teamId, starts, stops, member, activate, capacity }
}

describe('live Activation startup capacity', () => {
  it.each(['reservation-response', 'missing-provider'] as const)('retries failed capacity release when startup never ran (%s)', async (failure) => {
    const h = await setup('json', 1)
    const member = await h.member('worker')
    if (failure === 'reservation-response') {
      const reserve = h.ctx.teams.reserveActivation.bind(h.ctx.teams)
      vi.spyOn(h.ctx.teams, 'reserveActivation').mockImplementationOnce(async (input) => {
        await reserve(input)
        throw new Error('Reservation response lost')
      })
    } else vi.spyOn(h.ctx.agentRuntimes, 'getProvider').mockReturnValueOnce(undefined)
    vi.spyOn(h.ctx.teams, 'releaseActivationReservation').mockRejectedValueOnce(new Error('Release storage unavailable'))
    await expect(h.activate(member)).rejects.toBeInstanceOf(AggregateError)
    expect(h.starts).toHaveLength(0)
    expect(await h.capacity()).toBe(1)
    await expect(h.activate(member)).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
    expect(h.starts).toHaveLength(0)
    expect(await h.capacity()).toBe(0)
    const next = await h.activate(member)
    await next.dispose()
  })

  it('honors the tighter inherited Team grant and zero Participant authority before startup', async () => {
    const h = await setup('json', 8, { grantLimit: 1 })
    const first = await h.member('coordinator')
    const second = await h.member('worker')
    const forbidden = await h.member('disabled', 0)
    await expect(h.activate(forbidden)).rejects.toMatchObject({ code: 'TEAM_BUDGET_EXCEEDED' })
    expect(h.starts).toHaveLength(0)
    const lease = await h.activate(first)
    await expect(h.activate(second)).rejects.toMatchObject({ code: 'TEAM_BUDGET_EXCEEDED' })
    expect(h.starts).toHaveLength(1)
    await lease.dispose()
  })

  it.each(['json', 'sqlite'] as const)('reserves before provider startup and holds idle/stopping epochs until termination (%s)', async (backend) => {
    const entered = Promise.withResolvers<undefined>()
    const startup = Promise.withResolvers<undefined>()
    const termination = Promise.withResolvers<undefined>()
    const h = await setup(backend, 1, { start: async () => { entered.resolve(undefined); await startup.promise },
      dispose: async () => { await termination.promise } })
    cleanups.push(async () => { startup.resolve(undefined); termination.resolve(undefined) })
    const first = await h.member('coordinator')
    const second = await h.member('worker')
    const starting = h.activate(first)
    await Promise.race([entered.promise, starting.then(() => {})])
    expect(await h.capacity()).toBe(1)
    await expect(h.activate(second)).rejects.toMatchObject({ code: 'TEAM_BUDGET_EXCEEDED' })
    expect(h.starts).toHaveLength(1)
    startup.resolve(undefined)
    const lease = await starting
    expect(lease.binding.reservationId).toBeDefined()
    expect(await h.capacity()).toBe(1)
    const stopping = lease.dispose()
    await expect.poll(async () => (await h.ctx.teams.getTeam({ teamId: h.teamId })).activations[0]?.activation.status).toBe('stopping')
    await expect(h.activate(second)).rejects.toMatchObject({ code: 'TEAM_BUDGET_EXCEEDED' })
    termination.resolve(undefined)
    await stopping
    expect(await h.capacity()).toBe(0)
    const next = await h.activate(second)
    expect(await h.capacity()).toBe(1)
    await next.dispose()
  })

  it.each(['json', 'sqlite'] as const)('retains unknown startup across controller and Hub restart (%s)', async (backend) => {
    const h = await setup(backend, 1, { start: async () => { throw new Error('Connection lost during startup') } })
    const first = await h.member('coordinator')
    const second = await h.member('worker')
    await expect(h.activate(first)).rejects.toThrow('Connection lost')
    expect(await h.capacity()).toBe(1)
    await h.controller.dispose()
    await h.hub.dispose()
    await h.ctx.plugin(TeamHub)
    const restarted = await h.ctx.plugin(Controller)
    cleanups.push(async () => { await restarted.dispose() })
    expect(await h.capacity()).toBe(1)
    await expect(h.activate(first)).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_CONFLICT' })
    await expect(h.activate(second)).rejects.toMatchObject({ code: 'TEAM_BUDGET_EXCEEDED' })
    expect(h.starts).toHaveLength(1)
    const failureActor = {} as TeamSystemClosureProof
    const unregisterFailure = h.ctx.teams.registerSystemClosureProofSource({ name: 'team-run',
      resolveClosureProof: actor => actor === failureActor ? { kind: 'team-run-create-failure', teamId: h.teamId } : undefined })
    try {
      await h.ctx.teams.failTeam({ actor: failureActor, teamId: h.teamId,
        expectedCursor: (await h.ctx.teams.getTeam({ teamId: h.teamId })).team.cursor,
        idempotencyKey: teamClosureIdempotencyKeySchema.parse('unknown-start-failure'),
        reason: { code: 'START_FAILED', message: 'Provider startup failed.' } })
    } finally { unregisterFailure() }
    for (let pass = 0; pass < 2; pass += 1) {
      const before = await h.ctx.teams.getTeam({ teamId: h.teamId })
      const closure = before.team.closure!
      const actor = {} as TeamSystemClosureDriverProof
      const scope: TeamSystemClosureDriverScope = { kind: 'closure-recover-fail', teamId: h.teamId,
        expectedCursor: before.team.cursor, closureIdempotencyKey: closure.idempotencyKey, closureRequestedAt: closure.requestedAt }
      const unregister = h.ctx.teams.registerSystemClosureDriverProofSource({ name: 'team-closure-driver',
        resolveClosureDriverProof: value => value === actor ? scope : undefined })
      try { await h.ctx.teamActivations.recoverClosure({ actor, teamId: h.teamId, expectedCursor: before.team.cursor }) }
      finally { unregister() }
      const after = await h.ctx.teams.getTeam({ teamId: h.teamId })
      expect(after.team.phase).toBe('stalled')
      expect(after.team.stallReason?.code).toBe('ACTIVATION_STARTUP_UNCONFIRMED')
      if (pass === 1) expect(after.team.cursor).toBe(before.team.cursor)
      expect(await h.capacity()).toBe(1)
    }
  })

  it('releases an unpublished binding failure only after its raw handle disposes', async () => {
    const h = await setup('json', 1)
    const member = await h.member('worker')
    vi.spyOn(h.ctx.teams, 'bindActivation').mockRejectedValueOnce(new Error('Binding append failed'))
    await expect(h.activate(member)).rejects.toThrow('Binding append failed')
    expect(h.stops).toHaveLength(1)
    expect(await h.capacity()).toBe(0)
    const next = await h.activate(member)
    expect(h.starts).toHaveLength(2)
    await next.dispose()
  })

  it.each([
    { backend: 'json', ceiling: 1 }, { backend: 'sqlite', ceiling: 1 },
    { backend: 'json', ceiling: undefined }, { backend: 'sqlite', ceiling: undefined },
  ] as const)('settles a binding whose durable commit succeeded but response was lost ($backend, ceiling $ceiling)', async ({ backend, ceiling }) => {
    const h = await setup(backend, ceiling)
    const member = await h.member('worker')
    const bind = h.ctx.teams.bindActivation.bind(h.ctx.teams)
    const failure = new Error('Binding response lost')
    vi.spyOn(h.ctx.teams, 'bindActivation').mockImplementationOnce(async (input) => {
      await bind(input)
      throw failure
    })
    await expect(h.activate(member)).rejects.toBe(failure)
    expect(h.stops).toHaveLength(1)
    expect(await h.capacity()).toBe(0)
    const state = await h.ctx.teams.getTeam({ teamId: h.teamId })
    expect(state.activations).toHaveLength(1)
    expect(state.activations[0]?.quiescedAt).toBeDefined()
    const next = await h.activate(member)
    expect(next.binding.activation.id).not.toBe(state.activations[0]?.activation.id)
    await next.dispose()
  })

  it.each(['quiescence', 'readback', 'termination'] as const)('retains lost-response binding cleanup after a %s failure', async (failure) => {
    let disposals = 0
    const h = await setup('json', 1, { dispose: async () => {
      disposals++
      if (failure === 'termination' && disposals === 1) throw new Error('Termination unavailable')
    } })
    const member = await h.member('worker')
    const bind = h.ctx.teams.bindActivation.bind(h.ctx.teams)
    vi.spyOn(h.ctx.teams, 'bindActivation').mockImplementationOnce(async (input) => {
      await bind(input)
      if (failure === 'readback') vi.spyOn(h.ctx.teams, 'getTeam').mockRejectedValueOnce(new Error('Readback unavailable'))
      throw new Error('Binding response lost')
    })
    if (failure === 'quiescence') vi.spyOn(h.ctx.teams, 'quiesceActivation').mockRejectedValueOnce(new Error('Quiescence unavailable'))
    await expect(h.activate(member)).rejects.toBeInstanceOf(AggregateError)
    expect(await h.capacity()).toBe(1)
    await expect(h.activate(member)).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
    expect(h.starts).toHaveLength(1)
    expect(h.stops).toHaveLength(1)
    expect(disposals).toBe(failure === 'termination' ? 2 : 1)
    expect(await h.capacity()).toBe(0)
    const next = await h.activate(member)
    await next.dispose()
  })

  it('retains and retries a raw handle when publication and its first cleanup fail', async () => {
    let disposals = 0
    const h = await setup('json', 1, { dispose: async () => {
      disposals += 1
      if (disposals === 1) throw new Error('Termination not confirmed')
    } })
    const member = await h.member('worker')
    vi.spyOn(h.ctx.teams, 'bindActivation').mockRejectedValueOnce(new Error('Binding append failed'))
    await expect(h.activate(member)).rejects.toThrow('raw handle cleanup also failed')
    expect(await h.capacity()).toBe(1)
    await expect(h.activate(member)).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
    expect(h.starts).toHaveLength(1)
    expect(disposals).toBe(2)
    expect(await h.capacity()).toBe(0)
    const next = await h.activate(member)
    await next.dispose()
  })

  it.each(['json', 'sqlite'] as const)('cleans rejected raw handles before replacement without a capacity ceiling (%s)', async (backend) => {
    let live = 0
    let peak = 0
    let disposals = 0
    const h = await setup(backend, undefined, {
      start: async () => { live++; peak = Math.max(peak, live) },
      dispose: async () => {
        disposals++
        if (disposals === 1) throw new Error('Termination not confirmed')
        live--
      },
    })
    const member = await h.member('worker')
    vi.spyOn(h.ctx.teams, 'bindActivation').mockRejectedValueOnce(new Error('Binding append failed'))
    await expect(h.activate(member)).rejects.toThrow('raw handle cleanup also failed')
    const next = await h.activate(member)
    try {
      expect(disposals).toBe(2)
      expect(peak).toBe(1)
      expect(next.binding.reservationId).toBeUndefined()
    } finally { await next.dispose() }
    expect(live).toBe(0)
  })

  it.each(['json', 'sqlite'] as const)('retries reservation release without disposing an already terminated raw handle again (%s)', async (backend) => {
    const h = await setup(backend, 1)
    const member = await h.member('worker')
    vi.spyOn(h.ctx.teams, 'bindActivation').mockRejectedValueOnce(new Error('Binding append failed'))
    vi.spyOn(h.ctx.teams, 'releaseActivationReservation').mockRejectedValueOnce(new Error('Reservation storage unavailable'))
    const failed = await h.activate(member).catch((error: unknown) => error)
    expect(failed).toBeInstanceOf(AggregateError)
    expect((failed as AggregateError).errors.map((error: Error) => error.message))
      .toEqual(['Binding append failed', 'Reservation storage unavailable'])
    expect(h.stops).toHaveLength(1)
    expect(await h.capacity()).toBe(1)
    await expect(h.activate(member)).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
    expect(h.stops).toHaveLength(1)
    expect(h.starts).toHaveLength(1)
    expect(await h.capacity()).toBe(0)
    const next = await h.activate(member)
    await next.dispose()
  })

  it.each([undefined, 1])('retries failed shutdown cleanup while keeping activation admission closed (ceiling %s)', async (ceiling) => {
    let disposals = 0
    const h = await setup('json', ceiling, { dispose: async () => {
      if (++disposals < 3) throw new Error('Termination not confirmed')
    } })
    const member = await h.member('worker')
    vi.spyOn(h.ctx.teams, 'bindActivation').mockRejectedValueOnce(new Error('Binding append failed'))
    await expect(h.activate(member)).rejects.toThrow('raw handle cleanup also failed')
    const first = h.ctx.teamActivations.close()
    expect(h.ctx.teamActivations.close()).toBe(first)
    await expect(first).rejects.toThrow('controller disposal failed')
    await expect(h.activate(member)).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
    await h.ctx.teamActivations.close()
    expect(disposals).toBe(3)
    expect(h.stops).toHaveLength(1)
    expect(await h.capacity()).toBe(0)
  })

  it('preserves an already admitted startup-release proof while the controller closes', async () => {
    const h = await setup('json', 1)
    const member = await h.member('worker')
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    cleanups.push(async () => { release.resolve(undefined) })
    vi.spyOn(h.ctx.teams, 'bindActivation').mockRejectedValueOnce(new Error('Binding append failed'))
    const original = h.ctx.teams.releaseActivationReservation.bind(h.ctx.teams)
    vi.spyOn(h.ctx.teams, 'releaseActivationReservation').mockImplementation(async (request) => {
      entered.resolve(undefined)
      await release.promise
      return await original(request)
    })
    const starting = h.activate(member).catch((error: unknown) => error)
    await entered.promise
    const closing = h.ctx.teamActivations.close().catch((error: unknown) => error)
    release.resolve(undefined)
    expect(await starting).toMatchObject({ message: 'Binding append failed' })
    expect(await closing).toBeInstanceOf(AggregateError)
    expect(await h.capacity()).toBe(0)
    expect(h.stops).toHaveLength(1)
  })

  it('rejects forged startup release and a zero ceiling before calling the provider', async () => {
    const h = await setup('json', 0)
    const participant = await h.member('coordinator')
    await expect(h.activate(participant)).rejects.toMatchObject({ code: 'TEAM_BUDGET_EXCEEDED' })
    expect(h.starts).toHaveLength(0)
    const state = await h.ctx.teams.getTeam({ teamId: h.teamId })
    await expect(h.ctx.teams.releaseActivationReservation({ actor: {} as TeamSystemActivationProof,
      teamId: h.teamId, participantId: participant.id, expectedCursor: state.team.cursor,
      reservationId: 'forged' as NonNullable<ParticipantSnapshot['activationReservation']>['id'],
      sessionId: SessionId('forged-session'), provider: 'capacity-provider' })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  })
})
