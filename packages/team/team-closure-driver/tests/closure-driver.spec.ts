import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import type {
  ChannelSnapshot,
  JsonObject,
  TeamEvent,
  TeamId,
  TeamSnapshot,
  TeamStateSnapshot,
  TeamSystemClosureDriverScope,
  TeamSystemClosureDriverProofSource,
} from '@clocky/clocky-team'
import {
  TeamClosureDriveBackendRegistry,
  TeamClosureDriveError,
  TeamClosureDriver,
} from '../src/index.ts'
import type {
  Config,
  TeamClosureDriveBackend,
  TeamClosureDriveRequest,
  TeamClosureDriverTurnEndRequest,
} from '../src/index.ts'
import * as ClosureDriverPlugin from '../src/index.ts'

const contexts = new Set<Context>()

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  vi.useRealTimers()
})

/** Build one small detached Team summary with only the closure fields this Consumer reads. */
function team(
  id: string,
  options: {
    readonly phase?: TeamSnapshot['phase']
    readonly cursor?: number
    readonly closure?: boolean
    readonly cancellation?: boolean
  } = {},
): TeamSnapshot {
  return {
    id: id as TeamId,
    depth: 0,
    maxTeamDepth: 0,
    goal: { teamId: id as TeamId, revision: 1, objective: id, phase: 'active', budgets: {} },
    phase: options.phase ?? 'active',
    cursor: options.cursor ?? 1,
    createdAt: 1,
    updatedAt: 1,
    ...options.closure === true ? {
      closure: {
        teamId: id as TeamId,
        kind: 'fail',
        idempotencyKey: `closure-${id}`,
        actor: { kind: 'system', name: 'team-run' },
        reason: { code: 'TEST_FAILURE', message: 'Test closure recovery.' },
        requestedAt: 1,
      },
    } : {},
    ...options.cancellation === true ? {
      cancellation: {
        teamId: id as TeamId,
        idempotencyKey: `cancellation-${id}`,
        actor: { kind: 'system', name: 'team-run' },
        reason: { code: 'TEST_CANCEL', message: 'Test cancellation recovery.' },
        requestedAt: 1,
      },
    } : {},
  } as TeamSnapshot
}

/** Wrap a Team summary in the detached state shape exposed to a closure backend. */
function state(snapshot: TeamSnapshot): TeamStateSnapshot {
  return {
    team: snapshot,
    goal: snapshot.goal,
    rules: {},
    budgets: {},
    participants: [],
    activations: [],
    tasks: [],
    workspaceAllocations: [],
    channelIds: [],
  }
}

/** Standard explicit driver limits used by each focused harness. */
function config(overrides: Partial<Config> = {}): Config {
  return {
    backend: 'hub',
    maxTeamsPerDrive: 8,
    pageSize: 2,
    disposalTimeoutMs: 100,
    ...overrides,
  }
}

/** Create a Team context with deterministic pages, current state, and channel routing. */
async function harness(options: {
  readonly pages?: readonly { readonly items: readonly TeamSnapshot[]; readonly nextCursor?: string }[]
  readonly states?: Map<string, TeamStateSnapshot>
  readonly backend?: TeamClosureDriveBackend
  readonly channelTeamId?: TeamId
}) {
  const ctx = new Context()
  contexts.add(ctx)
  const pages = options.pages ?? []
  const states = options.states ?? new Map<string, TeamStateSnapshot>()
  let pageIndex = 0
  let closureDriverSource: TeamSystemClosureDriverProofSource | undefined
  const teams = {
    listTeamsPage: vi.fn(async () => {
      const page = pages[pageIndex++] ?? { items: [] }
      return { ...page, scanned: page.items.length }
    }),
    getTeam: vi.fn(async ({ teamId }: { readonly teamId: TeamId }) => {
      const current = states.get(String(teamId))
      if (current === undefined) throw new Error(`missing Team '${teamId}'`)
      return current
    }),
    getChannel: vi.fn(async (): Promise<ChannelSnapshot> => ({
      manifest: { teamId: options.channelTeamId ?? ('channel-team' as TeamId) },
      phase: 'active',
      cursor: 1,
    } as ChannelSnapshot)),
    registerSystemClosureDriverProofSource: vi.fn((source: TeamSystemClosureDriverProofSource) => {
      closureDriverSource = source
      return () => {
        if (closureDriverSource === source) closureDriverSource = undefined
      }
    }),
  }
  ctx.provide('teams', teams as never)
  ctx.provide('teamClosureDriverHub', { backend: 'hub' } as never)
  await ctx.plugin(TeamClosureDriveBackendRegistry)
  if (options.backend !== undefined) ctx.teamClosureDrives.registerBackend(options.backend)
  return {
    ctx,
    teams,
    states,
    closureDriverSource: (): TeamSystemClosureDriverProofSource | undefined => closureDriverSource,
    resetPages: (): void => { pageIndex = 0 },
  }
}

/** Return one backend that retains every request for direct proof assertions. */
function recordingBackend(calls: TeamClosureDriveRequest[]): TeamClosureDriveBackend {
  return {
    name: 'hub',
    async drive(request) { calls.push(request) },
  }
}


/** Current coordinator result with an exact activation and optional final destination. */
function turnEnd(teamId: TeamId, overrides: Partial<TeamClosureDriverTurnEndRequest> = {}): TeamClosureDriverTurnEndRequest {
  return {
    teamId,
    coordinatorId: 'coordinator' as never,
    activationId: 'activation' as never,
    sessionId: 'session' as never,
    provider: 'in-process',
    turn: 1,
    reason: { code: 'FINAL_ANSWER_MISSING', message: 'The coordinator ended without a final.' },
    outcome: 'missing-final',
    ...overrides,
  }
}

describe('Team closure driver', () => {
  it('scans bounded pages and invokes a backend only for nonterminal closure candidates', async () => {
    const ordinary = team('ordinary')
    const quiescing = team('quiescing', { phase: 'quiescing', cursor: 4 })
    const terminal = team('terminal', { phase: 'completed', closure: true })
    const cancelled = team('cancelled', { cancellation: true, cursor: 6 })
    const calls: TeamClosureDriveRequest[] = []
    const mounted = await harness({
      pages: [
        { items: [ordinary, quiescing], nextCursor: '8' },
        { items: [terminal, cancelled] },
      ],
      states: new Map([
        [String(quiescing.id), state(quiescing)],
        [String(cancelled.id), state(cancelled)],
      ]),
      backend: recordingBackend(calls),
    })

    const fiber = await mounted.ctx.plugin(ClosureDriverPlugin, config({ maxTeamsPerDrive: 4, pageSize: 2 }))

    expect(mounted.teams.listTeamsPage).toHaveBeenNthCalledWith(1, { afterCursor: -1, limit: 2 })
    expect(mounted.teams.listTeamsPage).toHaveBeenNthCalledWith(2, { afterCursor: '8', limit: 2 })
    expect(calls.map(call => call.state.team.id)).toEqual([quiescing.id, cancelled.id])
    expect(calls.map(call => call.triggers)).toEqual([['startup'], ['startup']])
    await fiber.dispose()
  })

  it('rotates the bounded discovery cursor so later Teams are reached on the next drive', async () => {
    const first = team('rotating-first', { closure: true })
    const second = team('rotating-second', { closure: true })
    const calls: TeamClosureDriveRequest[] = []
    const mounted = await harness({
      pages: [
        { items: [first], nextCursor: '1' },
        { items: [second] },
      ],
      states: new Map([
        [String(first.id), state(first)],
        [String(second.id), state(second)],
      ]),
      backend: recordingBackend(calls),
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config({ maxTeamsPerDrive: 1 }))
    await driver.start()
    await driver.drive()
    expect(calls.map(call => call.state.team.id)).toEqual([first.id, second.id])
    await driver.close()
  })

  it('fails closed on a repeated discovery cursor', async () => {
    const candidate = team('repeated-discovery-cursor', { closure: true })
    const calls: TeamClosureDriveRequest[] = []
    const mounted = await harness({
      pages: [
        { items: [candidate], nextCursor: '0' },
        { items: [candidate], nextCursor: '0' },
      ],
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: recordingBackend(calls),
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await expect(driver.start()).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
    expect(mounted.teams.listTeamsPage).toHaveBeenCalledTimes(2)
    await driver.close()
  })

  it('retains the discovery cursor after a transient budget hydration failure', async () => {
    const candidate = team('budget-retry')
    const mounted = await harness({
      pages: [{ items: [candidate], nextCursor: '7' }, { items: [] }],
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: { name: 'hub', async drive() {} },
    })
    mounted.teams.getTeam.mockRejectedValueOnce(new Error('budget hydration failed'))
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config({ maxTeamsPerDrive: 1 }))
    await driver.start()
    await driver.drive()
    expect(mounted.teams.listTeamsPage).toHaveBeenNthCalledWith(1, { afterCursor: -1, limit: 1 })
    expect(mounted.teams.listTeamsPage).toHaveBeenNthCalledWith(2, { afterCursor: -1, limit: 1 })
    await driver.close()
  })

  it('binds a nonserializable proof to one current state observation and revokes it after the backend returns', async () => {
    const candidate = team('proof', { closure: true, cursor: 9 })
    const calls: TeamClosureDriveRequest[] = []
    const mounted = await harness({
      pages: [{ items: [candidate] }],
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: {
        name: 'hub',
        async drive(request) {
          calls.push(request)
          expect(mounted.closureDriverSource()?.resolveClosureDriverProof(request.actor)).toEqual({
            kind: 'closure-recover-fail',
            teamId: candidate.id,
            expectedCursor: 9,
            closureIdempotencyKey: 'closure-proof',
            closureRequestedAt: 1,
          })
          expect(Object.isFrozen(request.state)).toBe(true)
          expect(() => JSON.stringify(request.actor)).toThrow('runtime-only')
        },
      },
    })

    const fiber = await mounted.ctx.plugin(ClosureDriverPlugin, config())
    const request = calls[0]
    if (request === undefined) throw new Error('closure backend was not called')
    expect(mounted.closureDriverSource()?.resolveClosureDriverProof(request.actor)).toBeUndefined()
    await fiber.dispose()
  })

  it('serializes concurrent startup calls behind one proof-source registration and discovery pass', async () => {
    const candidate = team('concurrent-start', { closure: true })
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const mounted = await harness({
      pages: [{ items: [candidate] }],
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: {
        name: 'hub',
        async drive() {
          entered.resolve(undefined)
          await release.promise
        },
      },
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    const first = driver.start()
    let secondSettled = false
    const second = driver.start().then(() => { secondSettled = true })
    await entered.promise
    await Promise.resolve()
    expect(secondSettled).toBe(false)
    expect(mounted.teams.registerSystemClosureDriverProofSource).toHaveBeenCalledTimes(1)
    expect(mounted.teams.listTeamsPage).toHaveBeenCalledTimes(1)
    release.resolve(undefined)
    await Promise.all([first, second])
    await driver.close()
  })

  it('coalesces Team and channel notifications behind one per-Team serializer', async () => {
    const candidate = team('serialized', { closure: true, cursor: 3 })
    const firstEntered = Promise.withResolvers<undefined>()
    const releaseFirst = Promise.withResolvers<undefined>()
    const calls: TeamClosureDriveRequest[] = []
    const mounted = await harness({
      pages: [{ items: [candidate] }],
      states: new Map([[String(candidate.id), state(candidate)]]),
      channelTeamId: candidate.id,
      backend: {
        name: 'hub',
        async drive(request) {
          calls.push(request)
          if (calls.length === 1) {
            firstEntered.resolve(undefined)
            await releaseFirst.promise
          }
        },
      },
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    const starting = driver.start()
    await firstEntered.promise

    mounted.ctx.emit('team/changed', { type: 'team/changed', team: candidate })
    mounted.ctx.emit('team/changed', { type: 'team/changed', team: candidate })
    mounted.ctx.emit('channel/changed', { channelId: 'serialized-channel' as never, record: {} as never })
    releaseFirst.resolve(undefined)
    await starting
    await vi.waitFor(() => { expect(calls).toHaveLength(2) })

    expect(calls[1]?.triggers).toEqual(['team-event', 'channel-event'])
    await driver.close()
  })

  it('keeps a notification for a later pass when the current backend pass fails', async () => {
    const candidate = team('retry-after-failure', { closure: true })
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const calls: TeamClosureDriveRequest[] = []
    const mounted = await harness({
      pages: [{ items: [] }],
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: {
        name: 'hub',
        async drive(request) {
          calls.push(request)
          if (calls.length === 1) {
            entered.resolve(undefined)
            await release.promise
            throw new Error('first closure pass failed')
          }
        },
      },
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    const driving = driver.drive({ teamId: candidate.id })
    await entered.promise
    mounted.ctx.emit('team/changed', { type: 'team/changed', team: candidate })
    release.resolve(undefined)
    await expect(driving).rejects.toThrow('first closure pass failed')
    await vi.waitFor(() => { expect(calls).toHaveLength(2) })
    expect(calls[1]?.triggers).toEqual(['team-event'])
    await driver.close()
  })

  it('re-reads durable recovery after its proof is invalidated by a concurrent append', async () => {
    const candidate = team('recovery-cursor-race', { phase: 'quiescing', closure: true })
    const calls: TeamClosureDriveRequest[] = []
    const mounted = await harness({
      pages: [{ items: [] }],
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: {
        name: 'hub',
        async drive(request) {
          calls.push(request)
          if (calls.length === 1) throw { code: 'TEAM_ACTOR_PROOF_INVALID' }
        },
      },
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    await expect(driver.drive({ teamId: candidate.id })).resolves.toBeUndefined()
    expect(calls).toHaveLength(2)
    await driver.close()
  })

  it('settles every candidate branch before aggregating discovery failures', async () => {
    const first = team('discovery-failure-first', { closure: true })
    const second = team('discovery-failure-second', { cancellation: true })
    const mounted = await harness({
      pages: [{ items: [] }, { items: [first, second] }],
      states: new Map([
        [String(first.id), state(first)],
        [String(second.id), state(second)],
      ]),
      backend: {
        name: 'hub',
        async drive(request) { throw new Error(`failed ${String(request.state.team.id)}`) },
      },
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    await expect(driver.drive()).rejects.toSatisfy((error: unknown) =>
      error instanceof AggregateError
      && error.errors.length === 2
      && error.errors.every((item: unknown) => item instanceof Error && item.message.startsWith('failed ')),
    )
    await driver.close()
  })

  it('uses the optional pulse for later eligible Team discovery', async () => {
    vi.useFakeTimers()
    try {
      const candidate = team('pulse', { phase: 'quiescing', closure: true })
      let eligible = false
      const calls: TeamClosureDriveRequest[] = []
      const mounted = await harness({
        states: new Map([[String(candidate.id), state(candidate)]]),
        backend: recordingBackend(calls),
      })
      mounted.teams.listTeamsPage.mockImplementation(async () => eligible ? { items: [candidate], scanned: 1 } : { items: [], scanned: 0 })
      const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config({ pulseIntervalMs: 5 }))
      await driver.start()
      eligible = true
      await vi.advanceTimersByTimeAsync(5)
      await vi.waitFor(() => { expect(calls).toHaveLength(1) })
      expect(calls[0]?.triggers).toEqual(['pulse'])
      await driver.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('turns an expired frozen wall-time budget into a durable-driver action during discovery', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10)
    const candidate = team('budget-pulse')
    const calls: TeamClosureDriveRequest[] = []
    const scopes: string[] = []
    const mounted = await harness({
      pages: [{ items: [candidate] }],
      states: new Map([[String(candidate.id), { ...state(candidate), budgets: { maxWallTimeMs: 1 } }]]),
      backend: {
        name: 'hub',
        async drive(request) {
          calls.push(request)
          const scope = mounted.closureDriverSource()?.resolveClosureDriverProof(request.actor)
          if (scope === undefined) throw new Error('budget pulse proof was not retained')
          scopes.push(scope.kind)
        },
      },
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    expect(calls).toHaveLength(1)
    expect(scopes).toEqual(['closure-stall-budget'])
    await driver.close()
  })

  it('does not turn a temporarily full concurrency cap into a durable stall', async () => {
    const candidate = team('concurrency-cap')
    const activeTask = { attemptCount: 1, lease: {} } as unknown as TeamStateSnapshot['tasks'][number]
    const calls: TeamClosureDriveRequest[] = []
    const mounted = await harness({
      pages: [{ items: [candidate] }],
      states: new Map([[
        String(candidate.id),
        { ...state(candidate), budgets: { maxConcurrency: 1 }, tasks: [activeTask] },
      ]]),
      backend: recordingBackend(calls),
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    expect(calls).toHaveLength(0)
    await driver.close()
  })

  it('keeps an optional pulse single-flight while provider paging is slow', async () => {
    vi.useFakeTimers()
    try {
      const slowPage = Promise.withResolvers<{ readonly items: readonly TeamSnapshot[]; readonly scanned: number }>()
      const mounted = await harness({ backend: { name: 'hub', async drive() {} } })
      let calls = 0
      mounted.teams.listTeamsPage.mockImplementation(async () => {
        calls += 1
        return calls === 1 ? { items: [], scanned: 0 } : await slowPage.promise
      })
      const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config({ pulseIntervalMs: 1 }))
      await driver.start()
      await vi.advanceTimersByTimeAsync(3)
      expect(calls).toBe(2)
      slowPage.resolve({ items: [], scanned: 0 })
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1)
      expect(calls).toBe(3)
      await driver.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails loudly for a missing or removed backend instead of silently skipping recovery', async () => {
    const candidate = team('unavailable', { cancellation: true })
    const mounted = await harness({
      pages: [{ items: [] }],
      states: new Map([[String(candidate.id), state(candidate)]]),
    })
    await expect(mounted.ctx.plugin(ClosureDriverPlugin, config())).rejects.toMatchObject({
      code: 'TEAM_CLOSURE_DRIVE_BACKEND_UNAVAILABLE',
    })

    const remove = mounted.ctx.teamClosureDrives.registerBackend({ name: 'hub', async drive() {} })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    remove()
    await expect(driver.drive({ teamId: candidate.id })).rejects.toMatchObject({
      code: 'TEAM_CLOSURE_DRIVE_BACKEND_UNAVAILABLE',
    })
    await driver.close()
  })

  it('admits current missing-final and turn-failure observations through scoped driver proofs', async () => {
    const candidate = team('turn-observation')
    const calls: TeamClosureDriveRequest[] = []
    const scopes: string[] = []
    const mounted = await harness({
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: {
        name: 'hub',
        async drive(request) {
          calls.push(request)
          const scope = mounted.closureDriverSource()?.resolveClosureDriverProof(request.actor)
          if (scope === undefined) throw new Error('turn observation proof was not retained')
          scopes.push(scope.kind)
        },
      },
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    await driver.recordTurnEnd({
      teamId: candidate.id,
      coordinatorId: 'coordinator' as never,
      activationId: 'activation' as never,
      sessionId: 'session' as never,
      provider: 'in-process',
      turn: 3,
      reason: { code: 'FINAL_ANSWER_MISSING', message: 'The coordinator ended without a final.' },
      outcome: 'missing-final',
    })
    await driver.recordTurnEnd({
      teamId: candidate.id,
      coordinatorId: 'coordinator' as never,
      activationId: 'activation' as never,
      sessionId: 'session' as never,
      provider: 'in-process',
      turn: 4,
      reason: { code: 'MODEL_UNAVAILABLE', message: 'The provider failed.' },
      outcome: 'failure',
    })
    expect(scopes).toEqual([
      'closure-stall-missing-final',
      'closure-fail-turn',
    ])
    await driver.close()
  })

  it('admits an exact budget observation without treating it as a closure intent', async () => {
    const candidate = team('budget-observation')
    const calls: TeamClosureDriveRequest[] = []
    let scope: TeamSystemClosureDriverScope | undefined
    const mounted = await harness({
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: {
        name: 'hub',
        async drive(request) {
          calls.push(request)
          scope = mounted.closureDriverSource()?.resolveClosureDriverProof(request.actor)
        },
      },
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    await driver.recordBudgetStall({
      teamId: candidate.id,
      reason: { code: 'TEAM_WALL_TIME_BUDGET_EXCEEDED', message: 'The wall-time ceiling expired.' },
    })
    const request = calls[0]
    if (request === undefined) throw new Error('budget observation was not admitted')
    expect(scope).toMatchObject({
      kind: 'closure-stall-budget', teamId: candidate.id, reason: { code: 'TEAM_WALL_TIME_BUDGET_EXCEEDED' },
    })
    await driver.close()
  })

  it('drains distinct queued observations and coalesces duplicate observations before settling their callers', async () => {
    const candidate = team('queued-observations')
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const scopes: TeamSystemClosureDriverScope[] = []
    const mounted = await harness({
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: {
        name: 'hub',
        async drive(request) {
          const scope = mounted.closureDriverSource()?.resolveClosureDriverProof(request.actor)
          if (scope === undefined) throw new Error('observer proof was not retained')
          scopes.push(scope)
          if (scopes.length === 1) {
            entered.resolve(undefined)
            await release.promise
          }
        },
      },
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    const observe = (turn: number): Promise<void> => driver.recordTurnEnd({
      teamId: candidate.id,
      coordinatorId: 'coordinator' as never,
      activationId: 'activation' as never,
      sessionId: 'session' as never,
      provider: 'in-process',
      turn,
      reason: { code: 'MODEL_UNAVAILABLE', message: 'The provider failed.' },
      outcome: 'failure',
    })
    const first = observe(1)
    await entered.promise
    const observations = [observe(2), observe(2), observe(3)]
    release.resolve(undefined)
    await Promise.all([first, ...observations])
    expect(scopes.map(scope => 'turn' in scope ? scope.turn : undefined)).toEqual([1, 2, 3])
    await driver.close()
  })

  it('stalls an orphaned quiescing Team instead of leaving discovery with no producer', async () => {
    const candidate = team('orphaned-quiescing', { phase: 'quiescing' })
    const scopes: string[] = []
    const mounted = await harness({
      pages: [{ items: [candidate] }],
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: {
        name: 'hub',
        async drive(request) {
          const scope = mounted.closureDriverSource()?.resolveClosureDriverProof(request.actor)
          if (scope === undefined) throw new Error('orphaned Team proof was not retained')
          scopes.push(scope.kind)
        },
      },
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    expect(scopes).toEqual(['closure-stall-quiescing'])
    await driver.close()
  })

  it('rejects malformed and duplicate backend registrations and removes a provider on disposal', async () => {
    const mounted = await harness({})
    expect(() => mounted.ctx.teamClosureDrives.registerBackend({ name: ' ', async drive() {} }))
      .toThrow(TeamClosureDriveError)
    const first = { name: 'hub', async drive() {} }
    const unregister = mounted.ctx.teamClosureDrives.registerBackend(first)
    expect(mounted.ctx.teamClosureDrives.listBackends()).toEqual([{ name: 'hub' }])
    expect(() => mounted.ctx.teamClosureDrives.registerBackend(first)).toThrow('already registered')
    unregister()
    expect(mounted.ctx.teamClosureDrives.getBackend('hub')).toBeUndefined()
  })

  it('aborts new work but retains an admitted Core proof until its backend call settles', async () => {
    const candidate = team('shutdown', { closure: true })
    const entered = Promise.withResolvers<TeamClosureDriveRequest>()
    const release = Promise.withResolvers<undefined>()
    const mounted = await harness({
      pages: [{ items: [] }],
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: {
        name: 'hub',
        async drive(request) {
          entered.resolve(request)
          await release.promise
        },
      },
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    const driving = driver.drive({ teamId: candidate.id })
    const request = await entered.promise
    const closing = driver.close()
    expect(request.signal.aborted).toBe(true)
    expect(mounted.closureDriverSource()?.resolveClosureDriverProof(request.actor)).toMatchObject({
      kind: 'closure-recover-fail', teamId: candidate.id,
    })
    release.resolve(undefined)
    await expect(driving).resolves.toBeUndefined()
    await expect(closing).resolves.toBeUndefined()
    expect(mounted.closureDriverSource()).toBeUndefined()
  })

  it('waits for a channel-event pass during disposal', async () => {
    const candidate = team('channel-shutdown', { cancellation: true })
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const mounted = await harness({
      pages: [{ items: [] }],
      states: new Map([[String(candidate.id), state(candidate)]]),
      channelTeamId: candidate.id,
      backend: {
        name: 'hub',
        async drive() {
          entered.resolve(undefined)
          await release.promise
        },
      },
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    mounted.ctx.emit('channel/changed', { channelId: 'shutdown-channel' as never, record: {} as never })
    await entered.promise
    const closing = driver.close()
    let settled = false
    void closing.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    release.resolve(undefined)
    await expect(closing).resolves.toBeUndefined()
  })

  it('retains an admitted proof after a disposal timeout until its backend settles', async () => {
    vi.useFakeTimers()
    try {
      const candidate = team('proof-timeout', { closure: true })
      const entered = Promise.withResolvers<TeamClosureDriveRequest>()
      const release = Promise.withResolvers<undefined>()
      const mounted = await harness({
        pages: [{ items: [] }],
        states: new Map([[String(candidate.id), state(candidate)]]),
        backend: {
          name: 'hub',
          async drive(request) {
            entered.resolve(request)
            await release.promise
          },
        },
      })
      const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config({ disposalTimeoutMs: 5 }))
      await driver.start()
      const driving = driver.drive({ teamId: candidate.id })
      const request = await entered.promise
      const closing = driver.close()
      void closing.catch(() => undefined)
      await vi.advanceTimersByTimeAsync(5)
      await expect(closing).rejects.toThrow('disposal exceeded 5ms')
      expect(mounted.closureDriverSource()?.resolveClosureDriverProof(request.actor)).toMatchObject({
        kind: 'closure-recover-fail',
        teamId: candidate.id,
      })
      release.resolve(undefined)
      await expect(driving).resolves.toBeUndefined()
      await vi.waitFor(() => { expect(mounted.closureDriverSource()).toBeUndefined() })
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds shutdown and safely logs unrenderable background failures', async () => {
    vi.useFakeTimers()
    try {
      const candidate = team('timeout', { closure: true })
      const never = new Promise<void>(() => {})
      const entered = Promise.withResolvers<undefined>()
      const mounted = await harness({
        pages: [{ items: [] }],
        states: new Map([[String(candidate.id), state(candidate)]]),
        backend: {
          name: 'hub',
          async drive() {
            entered.resolve(undefined)
            await never
          },
        },
      })
      const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config({ disposalTimeoutMs: 5 }))
      await driver.start()
      const driving = driver.drive({ teamId: candidate.id })
      void driving.catch(() => undefined)
      await entered.promise
      const closing = driver.close()
      void closing.catch(() => undefined)
      await vi.advanceTimersByTimeAsync(5)
      await expect(closing).rejects.toThrow('disposal exceeded 5ms')
    } finally {
      vi.useRealTimers()
    }

    const candidate = team('unrenderable', { closure: true })
    const mounted = await harness({
      pages: [{ items: [] }],
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: {
        name: 'hub',
        async drive() { throw { toString: (): never => { throw new Error('cannot render') } } },
      },
    })
    const warning = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    mounted.ctx.emit('team/changed', { type: 'team/changed', team: candidate })
    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('[unrenderable thrown value]'))
    })
    await driver.close().catch(() => undefined)
  })

  it('rejects invalid configuration before it starts listeners or accepts a pass', async () => {
    const mounted = await harness({ backend: { name: 'hub', async drive() {} } })
    const invalid = (overrides: Partial<Config>): void => {
      expect(() => new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config(overrides))).toThrow('positive safe integer')
    }
    invalid({ maxTeamsPerDrive: 0 })
    invalid({ pageSize: 0 })
    invalid({ disposalTimeoutMs: 0 })
    invalid({ pulseIntervalMs: 0 })
    invalid({ observerRetryAttempts: 0 })
    expect(() => new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config({ backend: ' hub' })))
      .toThrow('backend must be non-empty')
  })

  it('rejects startup without its selected Hub marker, Team runtime, or backend registry', async () => {
    const ctx = new Context()
    contexts.add(ctx)
    await expect(ClosureDriverPlugin.apply(ctx, config())).rejects.toMatchObject({
      code: 'TEAM_CLOSURE_DRIVE_BACKEND_UNAVAILABLE',
    })
    await ctx.plugin(TeamClosureDriveBackendRegistry)
    ctx.teamClosureDrives.registerBackend({ name: 'hub', async drive() {} })
    const markerMissing = new TeamClosureDriver(ctx, ctx.teamClosureDrives, config())
    await expect(markerMissing.start()).rejects.toThrow('not provided by the mounted Hub bridge')
    await markerMissing.close()
    ctx.provide('teamClosureDriverHub', { backend: 'hub' } as never)
    const teamsMissing = new TeamClosureDriver(ctx, ctx.teamClosureDrives, config())
    await expect(teamsMissing.start()).rejects.toThrow('requires an active Team runtime')
    await teamsMissing.close()
  })

  it('makes successful startup idempotent and rejects observations before startup or after retirement', async () => {
    const mounted = await harness({ backend: { name: 'hub', async drive() {} } })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    const observation = turnEnd('inactive-observer' as TeamId)
    await expect(driver.recordTurnEnd(observation)).rejects.toThrow('not accepting current turn observations')
    await expect(driver.recordBudgetStall(observation)).rejects.toThrow('not accepting budget observations')
    await driver.start()
    await driver.start()
    expect(mounted.teams.listTeamsPage).toHaveBeenCalledTimes(1)
    await driver.close()
    expect(driver.close()).toBe(driver.close())
    await expect(driver.start()).rejects.toThrow('is disposing')
    await expect(driver.recordTurnEnd(observation)).rejects.toThrow('not accepting current turn observations')
    await expect(driver.recordBudgetStall(observation)).rejects.toThrow('not accepting budget observations')
    await expect(driver.drive()).resolves.toBeUndefined()
    expect(mounted.teams.listTeamsPage).toHaveBeenCalledTimes(1)
  })

  it('unregisters the exposed driver even when its admitted backend fails during disposal', async () => {
    const candidate = team('plugin-disposal-failure', { closure: true })
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const mounted = await harness({
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: { name: 'hub', async drive() { entered.resolve(undefined); await release.promise } },
    })
    const stop = await ClosureDriverPlugin.apply(mounted.ctx, config())
    const driver = mounted.ctx.teamClosureDriver
    const driving = driver.drive({ teamId: candidate.id })
    const driveFailure = expect(driving).rejects.toThrow('backend cleanup failed')
    await entered.promise
    const closing = stop()
    const closeFailure = expect(closing).rejects.toSatisfy((error: unknown) =>
      error instanceof AggregateError && error.errors.length === 1,
    )
    release.reject(new Error('backend cleanup failed'))
    await Promise.all([driveFailure, closeFailure])
    expect(mounted.ctx.get('teamClosureDriver') === undefined).toBe(true)
    expect(mounted.closureDriverSource()).toBeUndefined()
  })

  it('continues queued observers after a failed pass and reports every accepted failure together', async () => {
    const candidate = team('observer-errors')
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const scopes: TeamSystemClosureDriverScope[] = []
    const mounted = await harness({
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: {
        name: 'hub',
        async drive(request) {
          const scope = mounted.closureDriverSource()?.resolveClosureDriverProof(request.actor)
          if (scope === undefined) throw new Error('observer proof was not retained')
          scopes.push(scope)
          if (scopes.length === 1) { entered.resolve(undefined); await release.promise }
          if (scopes.length < 3) throw new Error(`observer failure ${scopes.length}`)
        },
      },
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    const first = driver.recordTurnEnd(turnEnd(candidate.id))
    await entered.promise
    const second = driver.recordTurnEnd(turnEnd(candidate.id, { turn: 2 }))
    const third = driver.recordBudgetStall({ teamId: candidate.id, reason: { code: 'TEAM_TURN_BUDGET_EXCEEDED', message: 'Turn ceiling reached.' } })
    mounted.ctx.emit('team/changed', { type: 'team/changed', team: candidate })
    release.resolve(undefined)
    const results = await Promise.allSettled([first, second, third])
    expect(scopes.map(scope => scope.kind)).toEqual(['closure-stall-missing-final', 'closure-stall-missing-final', 'closure-stall-budget'])
    for (const result of results) {
      expect(result).toMatchObject({ status: 'rejected', reason: { errors: [expect.any(Error), expect.any(Error)] } })
    }
    await driver.close()
  })

  it.each(['turn', 'budget'] as const)('re-reads %s observations after a Team cursor conflict', async (kind) => {
    const candidate = team(`observer-cursor-${kind}`)
    const scopes: TeamSystemClosureDriverScope[] = []
    const mounted = await harness({
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: {
        name: 'hub',
        async drive(request) {
          const scope = mounted.closureDriverSource()?.resolveClosureDriverProof(request.actor)
          if (scope === undefined) throw new Error('observer proof was not retained')
          scopes.push(scope)
          if (scopes.length === 1) {
            mounted.states.set(String(candidate.id), state({ ...candidate, cursor: 2 }))
            throw { code: 'TEAM_CURSOR_CONFLICT' }
          }
        },
      },
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    await (kind === 'turn'
      ? driver.recordTurnEnd(turnEnd(candidate.id))
      : driver.recordBudgetStall({ teamId: candidate.id, reason: { code: 'TEAM_TURN_BUDGET_EXCEEDED', message: 'Turn ceiling reached.' } }))
    expect(scopes.map(scope => scope.expectedCursor)).toEqual([1, 2])
    await driver.close()
  })

  it('bounds repeated recovery races and does not retry rejected observer authority', async () => {
    const candidate = team('recovery-retry-limit', { closure: true })
    const drive = vi.fn(async () => { throw { code: 'TEAM_ACTOR_PROOF_INVALID' } })
    const mounted = await harness({ states: new Map([[String(candidate.id), state(candidate)]]), backend: { name: 'hub', drive } })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config({ observerRetryAttempts: 1 }))
    await driver.start()
    await expect(driver.drive({ teamId: candidate.id })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(drive).toHaveBeenCalledTimes(2)
    mounted.states.set(String(candidate.id), state(team(String(candidate.id))))
    await expect(driver.recordTurnEnd(turnEnd(candidate.id))).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(drive).toHaveBeenCalledTimes(3)
    await driver.close()
  })

  it.each([
    { provider: '' }, { provider: ' in-process' }, { turn: -1 }, { turn: 0.5 },
    { reason: { code: '', message: 'Failure.' } }, { reason: { code: 'FAILURE', message: '' } },
    { finalChannelId: 'final-channel' as never }, { humanId: 'human' as never },
    { reason: { code: 'OTHER_FAILURE', message: 'Not a missing final.' } },
  ])('rejects a malformed observation before retaining it: %j', async (override) => {
    const mounted = await harness({ backend: { name: 'hub', async drive() {} } })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    expect(() => driver.recordTurnEnd(turnEnd('invalid-observer' as TeamId, override))).toThrow(TeamClosureDriveError)
    await driver.close()
  })

  it.each([{ code: '', message: 'Budget exceeded.' }, { code: 'TEAM_TURN_BUDGET_EXCEEDED', message: '' }])(
    'rejects an incomplete budget reason: %j', async (reason) => {
      const mounted = await harness({ backend: { name: 'hub', async drive() {} } })
      const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
      expect(() => driver.recordBudgetStall({ teamId: 'budget-invalid' as TeamId, reason })).toThrow('budget observation is malformed')
      await driver.close()
    },
  )

  it.each(['missing-final', 'failure'] as const)('binds an optional final destination to a %s observation', async (outcome) => {
    const candidate = team(`observer-destination-${outcome}`)
    const scopes: TeamSystemClosureDriverScope[] = []
    const mounted = await harness({
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: { name: 'hub', async drive(request) {
        const scope = mounted.closureDriverSource()?.resolveClosureDriverProof(request.actor)
        if (scope === undefined) throw new Error('observer proof was not retained')
        scopes.push(scope)
      } },
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    await driver.recordTurnEnd(turnEnd(candidate.id, { outcome, finalChannelId: 'final' as never, humanId: 'human' as never }))
    expect(scopes).toEqual([expect.objectContaining({ finalChannelId: 'final', humanId: 'human' })])
    await driver.close()
  })


  it('rolls back a rejected startup sweep and removes the proof source before reporting its error', async () => {
    const candidate = team('startup-failure', { closure: true })
    const mounted = await harness({
      pages: [{ items: [candidate] }],
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: { name: 'hub', async drive() { throw new Error('startup recovery failed') } },
    })
    await expect(ClosureDriverPlugin.apply(mounted.ctx, config())).rejects.toThrow('startup recovery failed')
    expect(mounted.closureDriverSource()).toBeUndefined()
    expect(mounted.ctx.get('teamClosureDriver') === undefined).toBe(true)
    const reads = mounted.teams.getTeam.mock.calls.length
    mounted.ctx.emit('team/changed', { type: 'team/changed', team: candidate })
    expect(mounted.teams.getTeam).toHaveBeenCalledTimes(reads)
  })

  it('retries a failed pulse on the next timer without retaining the rejected discovery', async () => {
    vi.useFakeTimers()
    const mounted = await harness({ backend: { name: 'hub', async drive() {} } })
    const warning = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config({ pulseIntervalMs: 1 }))
    await driver.start()
    mounted.teams.listTeamsPage.mockRejectedValueOnce(new Error('pulse page unavailable'))
    await vi.advanceTimersByTimeAsync(1)
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('pulse page unavailable'))
    await vi.advanceTimersByTimeAsync(1)
    expect(mounted.teams.listTeamsPage).toHaveBeenCalledTimes(3)
    await driver.close()
    await vi.advanceTimersByTimeAsync(5)
    expect(mounted.teams.listTeamsPage).toHaveBeenCalledTimes(3)
  })

  it.each([false, true])('contains a pending budget scan rejection when retirement is %s', async (retire) => {
    const candidate = team('budget-read-failure')
    const read = Promise.withResolvers<TeamStateSnapshot>()
    const entered = Promise.withResolvers<undefined>()
    const mounted = await harness({
      pages: [{ items: [] }, { items: [candidate] }],
      backend: { name: 'hub', async drive() {} },
    })
    mounted.teams.getTeam.mockImplementation(async () => { entered.resolve(undefined); return await read.promise })
    const warning = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    const driving = driver.drive()
    await entered.promise
    const closing = retire ? driver.close() : undefined
    read.reject(new Error('budget read failed'))
    await driving
    if (retire) expect(warning).not.toHaveBeenCalled()
    else expect(warning).toHaveBeenCalledWith(expect.stringContaining('budget read failed'))
    await (closing ?? driver.close())
  })

  it.each(['channel-success', 'channel-failure', 'team-read'] as const)(
    'waits for %s reads during retirement without admitting another backend pass', async (source) => {
      const candidate = team(`retiring-${source}`, { closure: true })
      const read = Promise.withResolvers<TeamStateSnapshot | ChannelSnapshot>()
      const entered = Promise.withResolvers<undefined>()
      const calls: TeamClosureDriveRequest[] = []
      const mounted = await harness({ backend: recordingBackend(calls) })
      if (source === 'team-read') {
        mounted.teams.getTeam.mockImplementation(async () => { entered.resolve(undefined); return await read.promise as TeamStateSnapshot })
      } else {
        mounted.teams.getChannel.mockImplementation(async () => {
          entered.resolve(undefined)
          return await read.promise as ChannelSnapshot
        })
      }
      const warning = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
      const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
      await driver.start()
      const driving = source === 'team-read' ? driver.drive({ teamId: candidate.id }) : undefined
      if (source !== 'team-read') mounted.ctx.emit('channel/changed', { channelId: 'retiring-channel' as never, record: {} as never })
      await entered.promise
      const closing = driver.close()
      if (source === 'channel-failure') read.reject(new Error('channel unavailable'))
      else read.resolve(source === 'team-read' ? state(candidate) : { manifest: { teamId: candidate.id } } as ChannelSnapshot)
      await Promise.all([driving, closing])
      expect(calls).toEqual([])
      expect(warning).not.toHaveBeenCalled()
    },
  )

  it('contains a channel lookup failure and keeps later notifications usable', async () => {
    const candidate = team('channel-read-recovery', { closure: true })
    const calls: TeamClosureDriveRequest[] = []
    const mounted = await harness({
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: recordingBackend(calls),
      channelTeamId: candidate.id,
    })
    const warning = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    mounted.teams.getChannel.mockRejectedValueOnce(new Error('channel lookup failed'))
    mounted.ctx.emit('channel/changed', { channelId: 'channel-read-recovery' as never, record: {} as never })
    await vi.waitFor(() => { expect(warning).toHaveBeenCalledWith(expect.stringContaining('channel lookup failed')) })
    mounted.ctx.emit('channel/changed', { channelId: 'channel-read-recovery' as never, record: {} as never })
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    await driver.close()
  })

  it.each(['completed', 'failed', 'cancelled'] as const)('does not recover a %s Team', async (phase) => {
    const candidate = team(`terminal-${phase}`, { phase, closure: true })
    const calls: TeamClosureDriveRequest[] = []
    const mounted = await harness({
      pages: [{ items: [candidate] }],
      states: new Map([[String(candidate.id), state(candidate)]]),
      backend: recordingBackend(calls),
    })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    await driver.drive({ teamId: candidate.id })
    expect(calls).toEqual([])
    await driver.close()
  })

  it.each(['closure', 'cancellation'] as const)('preserves a newer %s instead of overwriting it with an observer', async (intent) => {
    const candidate = team(`observer-after-${intent}`, { [intent]: true })
    const calls: TeamClosureDriveRequest[] = []
    const mounted = await harness({ states: new Map([[String(candidate.id), state(candidate)]]), backend: recordingBackend(calls) })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    await driver.recordTurnEnd(turnEnd(candidate.id))
    expect(calls).toEqual([])
    await driver.close()
  })

  it('continues a TeamRun closure after recovery advances its cursor without a pulse', async () => {
    const base = team('cursor-progress', { phase: 'quiescing', closure: true })
    const candidate = {
      ...base,
      goal: { ...base.goal, phase: 'complete' },
      closure: { ...base.closure, kind: 'complete', finalChannelId: 'final', finalEnvelopeId: 'answer' },
    } as TeamSnapshot
    const cursors: number[] = []
    const states = new Map([[String(candidate.id), state(candidate)]])
    const mounted = await harness({ states, backend: {
      name: 'hub',
      async drive(request) {
        cursors.push(request.state.team.cursor)
        if (cursors.length === 1) {
          const recovered = { ...candidate, cursor: candidate.cursor + 1, updatedAt: 2 }
          states.set(String(candidate.id), state(recovered))
          mounted.ctx.emit('team/changed', { type: 'team/changed', team: recovered })
        }
      },
    } })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    try {
      await driver.drive({ teamId: candidate.id })
      expect(cursors).toEqual([candidate.cursor, candidate.cursor + 1])
    } finally {
      await driver.close()
    }
  })

  it.each([
    { actor: { kind: 'system', name: 'team-run' } },
    { actor: { kind: 'system', name: 'team-closure-driver' } },
    { actor: { kind: 'participant', participantId: 'coordinator' } },
  ] as const)('drives accepted completion on Team events for $actor', async ({ actor }) => {
    const base = team('completion-window', { closure: true })
    const candidate = { ...base, closure: { ...base.closure, kind: 'complete', actor, finalChannelId: 'final', finalEnvelopeId: 'answer' } } as TeamSnapshot
    const calls: TeamClosureDriveRequest[] = []
    const scopes: TeamSystemClosureDriverScope[] = []
    const mounted = await harness({ states: new Map([[String(candidate.id), state(candidate)]]), backend: {
      name: 'hub', async drive(request) {
        calls.push(request)
        const scope = mounted.closureDriverSource()?.resolveClosureDriverProof(request.actor)
        if (scope === undefined) throw new Error('completion proof was not retained')
        scopes.push(scope)
      },
    } })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    mounted.ctx.emit('team/changed', { type: 'team/changed', team: candidate })
    await vi.waitFor(() => { expect(mounted.teams.getTeam).toHaveBeenCalledTimes(1) })
    await Promise.resolve()
    expect(calls).toHaveLength(1)
    expect(scopes.at(-1)).toMatchObject({ kind: 'closure-recover-complete', finalChannelId: 'final', finalEnvelopeId: 'answer' })
    await driver.close()
  })

  it.each([
    { kind: 'complete' },
    { kind: 'complete', finalChannelId: 'final' },
    { kind: 'cancel' },
  ] as const)('rejects a durable closure that cannot grant recovery authority: %j', async (closure) => {
    const base = team('incomplete-intent', { closure: true })
    const candidate = { ...base, closure: { ...base.closure, ...closure } } as TeamSnapshot
    const mounted = await harness({ states: new Map([[String(candidate.id), state(candidate)]]), backend: { name: 'hub', async drive() {} } })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    await expect(driver.drive({ teamId: candidate.id })).rejects.toMatchObject({ code: 'TEAM_CLOSURE_DRIVE_STATE_INVALID' })
    await driver.close()
  })

  it.each([
    { budgets: { maxInputTokens: 1 }, code: 'TEAM_INPUT_TOKENS_BUDGET_EXCEEDED' },
    { budgets: { maxOutputTokens: 1 }, code: 'TEAM_TOKEN_BUDGET_EXCEEDED' },
    { budgets: { maxTotalTokens: 2 }, code: 'TEAM_TOTAL_TOKENS_BUDGET_EXCEEDED' },
    { budgets: { maxTurns: 1 }, code: 'TEAM_TURN_BUDGET_EXCEEDED' },
    { budgets: { maxCostUnits: 1 }, code: 'TEAM_COST_BUDGET_EXCEEDED' },
  ])('stalls at the exact cumulative budget limit: $code', async ({ budgets, code }) => {
    const candidate = team(`budget-${code}`)
    const scopes: TeamSystemClosureDriverScope[] = []
    const mounted = await harness({ pages: [{ items: [candidate] }], states: new Map([[String(candidate.id), {
      ...state(candidate), budgets,
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 1, costUnits: 1, updatedAt: 1 },
      tasks: [{ attemptCount: 2 }, { attemptCount: 0 }] as unknown as TeamStateSnapshot['tasks'],
    }]]), backend: { name: 'hub', async drive(request) {
      const scope = mounted.closureDriverSource()?.resolveClosureDriverProof(request.actor)
      if (scope === undefined) throw new Error('budget proof was not retained')
      scopes.push(scope)
    } } })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    expect(scopes).toMatchObject([{ kind: 'closure-stall-budget', reason: { code } }])
    await driver.close()
  })

  it('uses the stricter legacy ceiling while leaving positive budget headroom unstalled', async () => {
    const under = team('budget-under')
    const legacy = team('budget-legacy')
    const calls: TeamClosureDriveRequest[] = []
    const mounted = await harness({ pages: [{ items: [under, legacy] }], states: new Map([
      [String(under.id), { ...state(under), budgets: { maxWallTimeMs: 100, maxOutputTokens: 10 },
        rules: { teamLimits: { maxWallTimeMsPerTeam: 200, maxModelTokensPerTeam: 20 } },
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 1, costUnits: 1, updatedAt: 1 } }],
      [String(legacy.id), { ...state(legacy), budgets: { maxOutputTokens: 20 },
        rules: { teamLimits: { maxModelTokensPerTeam: 1 } },
        usage: { inputTokens: 0, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 0, costUnits: 0, updatedAt: 1 } }],
    ]), backend: recordingBackend(calls) })
    vi.spyOn(Date, 'now').mockReturnValue(10)
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    expect(calls.map(call => call.state.team.id)).toEqual([legacy.id])
    await driver.close()
  })

  it.each([null, [], false] as const)('ignores non-object legacy rules while preserving valid modern budgets: %j', async (teamLimits) => {
    const candidate = team('budget-legacy-structure')
    const calls: TeamClosureDriveRequest[] = []
    const mounted = await harness({ pages: [{ items: [candidate] }], states: new Map([[String(candidate.id), {
      ...state(candidate), rules: { teamLimits } as JsonObject, budgets: { maxTurns: 2 },
    }]]), backend: recordingBackend(calls) })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    expect(calls).toEqual([])
    await driver.close()
  })

  it('routes every durable Team notification to the Team identity owned by its payload', async () => {
    const candidate = team('all-team-notifications', { closure: true })
    const calls: TeamClosureDriveRequest[] = []
    const mounted = await harness({ states: new Map([[String(candidate.id), state(candidate)]]), backend: recordingBackend(calls) })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    const events = [
      { type: 'team/created', team: candidate },
      { type: 'goal/changed', goal: { teamId: candidate.id } },
      { type: 'participant/changed', participant: { teamId: candidate.id } },
      { type: 'activation/changed', binding: { activation: { teamId: candidate.id } } },
      { type: 'participant-interrupt/changed', interrupt: { target: { teamId: candidate.id } } },
      { type: 'human-action/changed', action: { teamId: candidate.id } },
      { type: 'usage/changed', teamId: candidate.id },
      { type: 'workflow-plan/changed', plan: { teamId: candidate.id } },
      { type: 'task/changed', task: { teamId: candidate.id } },
      { type: 'workspace-allocation/changed', allocation: { teamId: candidate.id } },
      { type: 'policy/denied', teamId: candidate.id },
    ] as readonly TeamEvent[]
    for (const event of events) {
      const count = calls.length
      mounted.ctx.emit('team/changed', event)
      await vi.waitFor(() => { expect(calls).toHaveLength(count + 1) })
      expect(calls.at(-1)).toMatchObject({ state: { team: { id: candidate.id } }, triggers: ['team-event'] })
    }
    await driver.close()
  })


  it('reserves orphaned-quiescing recovery for explicit discovery triggers', async () => {
    vi.useFakeTimers()
    const candidate = team('orphaned-discovery-triggers', { phase: 'quiescing' })
    const calls: TeamClosureDriveRequest[] = []
    const mounted = await harness({ pages: [{ items: [] }, { items: [candidate] }],
      states: new Map([[String(candidate.id), state(candidate)]]), backend: recordingBackend(calls), channelTeamId: candidate.id })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config({ pulseIntervalMs: 5 }))
    await driver.start()
    mounted.ctx.emit('team/changed', { type: 'team/changed', team: candidate })
    mounted.ctx.emit('channel/changed', { channelId: 'orphaned-channel' as never, record: {} as never })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toEqual([])
    await driver.drive({ teamId: candidate.id })
    await vi.advanceTimersByTimeAsync(5)
    expect(calls.map(call => call.triggers)).toEqual([['manual'], ['pulse']])
    await driver.close()
  })


  it.each(['turn', 'budget'] as const)('detaches a queued %s reason from the caller before another pass can retain it', async (kind) => {
    const candidate = team(`detached-observer-${kind}`)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const scopes: TeamSystemClosureDriverScope[] = []
    const mounted = await harness({ states: new Map([[String(candidate.id), state(candidate)]]), backend: {
      name: 'hub', async drive(request) {
        const scope = mounted.closureDriverSource()?.resolveClosureDriverProof(request.actor)
        if (scope === undefined) throw new Error('observer proof was not retained')
        scopes.push(scope)
        if (scopes.length === 1) { entered.resolve(undefined); await release.promise }
      },
    } })
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    const first = driver.recordTurnEnd(turnEnd(candidate.id))
    await entered.promise
    const reason = { code: 'FINAL_ANSWER_MISSING', message: 'Accepted observation.' }
    const second = kind === 'turn'
      ? driver.recordTurnEnd(turnEnd(candidate.id, { turn: 2, reason }))
      : driver.recordBudgetStall({ teamId: candidate.id, reason })
    reason.code = 'ANOTHER_OBSERVATION'
    reason.message = 'Caller reused its reason object.'
    release.resolve(undefined)
    await Promise.all([first, second])
    expect(scopes[1]).toMatchObject({ reason: { code: 'FINAL_ANSWER_MISSING', message: 'Accepted observation.' } })
    await driver.close()
  })


  it.each(['reading', 'queued'] as const)('rejects an observer still %s when retirement closes backend admission', async (phase) => {
    const candidate = team(`retiring-observer-${phase}`)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const mounted = await harness({ states: new Map([[String(candidate.id), state(candidate)]]), backend: {
      name: 'hub', async drive() { entered.resolve(undefined); await release.promise },
    } })
    if (phase === 'reading') {
      mounted.teams.getTeam.mockImplementation(async () => {
        entered.resolve(undefined)
        await release.promise
        return state(candidate)
      })
    }
    const driver = new TeamClosureDriver(mounted.ctx, mounted.ctx.teamClosureDrives, config())
    await driver.start()
    const first = driver.recordTurnEnd(turnEnd(candidate.id))
    await entered.promise
    const observations = phase === 'queued'
      ? [first, driver.recordTurnEnd(turnEnd(candidate.id, { turn: 2 }))]
      : [first]
    const outcomes = Promise.allSettled(observations)
    const closing = driver.close()
    const completion = Promise.allSettled([closing])
    release.resolve(undefined)
    const [results, [closed]] = await Promise.all([outcomes, completion])
    for (const result of results) expect(result).toMatchObject({
      status: 'rejected', reason: { code: 'TEAM_CLOSURE_DRIVE_BACKEND_UNAVAILABLE' },
    })
    expect(closed?.status === 'rejected' && closed.reason instanceof AggregateError).toBe(true)
    expect(mounted.closureDriverSource()).toBeUndefined()
  })

})
