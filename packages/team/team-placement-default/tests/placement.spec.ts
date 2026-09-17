import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import type { AgentRuntimeActivationRequest } from '@clocky/clocky-agent-runtime'
import { SessionId } from '@clocky/clocky-session'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import { activationIdSchema, fingerprintTeamHumanActorPayload, jsonObjectSchema, matchesTaskPlacement, teamTaskCreateIdempotencyKeySchema, teamTaskPlacementSchema } from '@clocky/clocky-team'
import type { ParticipantInviteInput, TeamActorProof, TeamHumanActorProof, TeamHumanActorScope, TeamId, TeamTaskId, TeamTaskPlacement, TeamSystemTaskLeaseProof, TeamSystemTaskLeaseScope } from '@clocky/clocky-team'
import * as Controller from '@clocky/clocky-team-activation-controller'
import WorkspaceRegistry from '@clocky/clocky-team-workspace'
import type { TeamWorkspaceProvider } from '@clocky/clocky-team-workspace'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import * as Placement from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  const results = await Promise.allSettled(cleanups.splice(0).reverse().map(dispose => dispose()))
  const failures: unknown[] = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
  if (failures.length) throw new AggregateError(failures)
})

async function harness(
  beforeWorker?: (request: AgentRuntimeActivationRequest) => Promise<void>,
  workspaceEligible: boolean | (() => Promise<boolean>) = true,
  workspacePreflight = true,
  maxActivationsPerDrive = 8,
  beforeDispose?: () => Promise<void>,
  configure?: (routes: Placement.PlacementRoute[]) => Placement.PlacementRoute[],
) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'placement-'))
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  await ctx.plugin(TeamHub, { maxTeamDepth: 1 })
  await ctx.plugin(AgentRuntime)
  await ctx.plugin(Controller)
  await ctx.plugin(WorkspaceRegistry)
  const workspaceProvider: TeamWorkspaceProvider = {
    name: 'placement-workspace', modes: ['shared'],
    preflight: async () => workspacePreflight,
    eligible: async () => typeof workspaceEligible === 'function' ? await workspaceEligible() : workspaceEligible,
    prepare: async () => { throw new Error('placement test does not materialize workspaces') },
    restore: async () => { throw new Error('placement test does not restore workspaces') },
    reconcileRelease: async () => {},
  }
  ctx.teamWorkspaces.registerProvider(workspaceProvider)
  const requests: AgentRuntimeActivationRequest[] = []
  const disposed: string[] = []
  ctx.agentRuntimes.registerProvider({
    name: 'placement-test', terminationMode: 'owned-process',
    async activate(request) {
      requests.push(request)
      if (request.participant.role !== 'coordinator') await beforeWorker?.(request)
      const activation = { id: activationIdSchema.parse(`placement-${requests.length}`),
        teamId: request.teamId, participantId: request.participant.id, status: 'idle' as const }
      let stopped = false
      return { activation, sessionId: request.sessionId, localAgent: undefined,
        async health() { return { ...activation, status: stopped ? 'offline' as const : 'idle' as const } },
        onStatus() { return () => {} }, interrupt() {}, async dispose() {
          if (request.participant.role !== 'coordinator') await beforeDispose?.()
          stopped = true; disposed.push(request.participant.id)
        } }
    },
  })
  const team = await createTestRootTeam(ctx, { goal: { objective: 'Task-driven placement', budgets: {} }, rules: {}, budgets: {} })
  const teamId = team.team.id
  async function invite(role: string, capabilities: string[] = ['code'],
    kind: 'local-agent' | 'remote-agent' | 'service' = 'local-agent', preset: string | null = 'worker') {
    const state = await ctx.teams.getTeam({ teamId })
    const input: ParticipantInviteInput = { teamId, expectedCursor: state.team.cursor, kind,
      displayName: role, role, capabilities, ...kind === 'service' ? {} : { provider: 'placement-test', model: 'test/model',
        ...preset === null ? {} : { preset } } }
    const participant = await inviteBootstrapParticipant(ctx, input)
    for (const phase of ['provisioning', 'active'] as const) {
      const current = await ctx.teams.getTeam({ teamId })
      await transitionBootstrapParticipant(ctx, { teamId, participantId: participant.id, expectedCursor: current.team.cursor, phase })
    }
    return (await ctx.teams.getTeam({ teamId })).participants.find(value => value.id === participant.id)!
  }
  const coordinator = await invite('coordinator', [])
  const current = await ctx.teams.getTeam({ teamId })
  const lease = await ctx.teamActivations.activate({ teamId, participantId: coordinator.id, expectedCursor: current.team.cursor,
    provider: 'placement-test', sessionId: SessionId('placement-coordinator'), seed: { kind: 'fresh' },
    agent: { options: {} }, signal: new AbortController().signal })
  const issuer = ctx.teams.openActivationActorProofIssuer()
  const issued = issuer.issue(lease.binding)
  const config: Placement.Config = { routes: [{ provider: 'placement-test', roles: ['builder', 'second-builder'],
    model: 'test/model', modelProvider: 'test', modelId: 'model', preset: 'worker', cwd: root, maxTokens: 1000 }],
  maxActivationsPerDrive, maxCursorRetries: 3 }
  const placementScope = await ctx.plugin(Placement, { routes: configure?.(config.routes) ?? config.routes,
    maxActivationsPerDrive: config.maxActivationsPerDrive, maxCursorRetries: config.maxCursorRetries })
  cleanups.push(async () => { await placementScope.dispose() })
  return { ctx, teamId, invite, requests, disposed, actor: issued.proof, config, placementScope }
}

async function createTask(ctx: Context, teamId: TeamId, actor: TeamActorProof, key: string,
  placement?: TeamTaskPlacement, blockedBy: TeamTaskId[] = []) {
  const state = await ctx.teams.getTeam({ teamId })
  return await ctx.teams.createTask({ actor, teamId, expectedCursor: state.team.cursor,
    createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(key) },
    subject: key, description: key, requiredCapabilities: ['code'], priority: 1, blockedBy, readScopes: [], writeScopes: [],
    workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 3,
    ...placement === undefined ? {} : { placement } })
}

describe('task-driven placement', () => {
  it.each([
    ['model mismatch', (routes: Placement.PlacementRoute[]) => routes.map(route => ({ ...route, modelId: 'different' })),
      'Placement model must equal modelProvider/modelId'],
    ['missing provider', (routes: Placement.PlacementRoute[]) => routes.map(route => ({ ...route, provider: 'uninstalled' })),
      "Placement provider 'uninstalled' is unavailable"],
    ['overlapping routes', (routes: Placement.PlacementRoute[]) => [...routes, ...routes],
      "Placement role 'builder' has overlapping execution routes"],
  ] as const)('rejects %s when loading deployment routes', async (_name, configure, message) => {
    await expect(harness(undefined, true, true, 8, undefined, configure)).rejects.toThrow(message)
  })

  it('rejects cancelled and closed preparation before starting a provider', async () => {
    const { ctx, teamId, invite, actor, requests } = await harness()
    await invite('builder')
    await createTask(ctx, teamId, actor, 'cancelled-admission')
    const placement = ctx.teamPlacement
    const reason = new Error('Caller cancelled')
    await expect(placement.prepare(teamId, AbortSignal.abort(reason))).rejects.toBe(reason)
    await expect(placement.prepareRoles(teamId, ['builder'], AbortSignal.abort(reason))).rejects.toBe(reason)
    await placement.close()
    await expect(placement.prepare(teamId)).rejects.toThrow('Team placement is closed')
    expect(requests).toHaveLength(1)
  })

  it('applies the per-drive activation limit while retaining an idle owner for the next task', async () => {
    const { ctx, teamId, invite, actor, requests } = await harness(undefined, true, true, 1)
    await invite('builder')
    await invite('second-builder')
    await createTask(ctx, teamId, actor, 'first-budgeted', { roles: ['builder'] })
    await createTask(ctx, teamId, actor, 'second-budgeted', { roles: ['second-builder'] })
    expect(await ctx.teamPlacement.prepare(teamId)).toBe(1)
    expect(requests).toHaveLength(2)
    expect(await ctx.teamPlacement.prepare(teamId)).toBe(1)
    expect(requests).toHaveLength(3)
    expect(await ctx.teamPlacement.prepare(teamId)).toBe(0)
  })

  it.each([1, 3])('retries admission cursor conflicts up to its configured limit (%i conflicts)', async (conflicts) => {
    const { ctx, teamId, invite, actor, requests } = await harness()
    await invite('builder')
    await createTask(ctx, teamId, actor, 'cursor-contention')
    const admit = ctx.teamActivations.activate.bind(ctx.teamActivations)
    const activate = vi.spyOn(ctx.teamActivations, 'activate')
    for (let index = 0; index < conflicts; index++) activate.mockImplementationOnce(async (input) => {
      await invite(`concurrent-${index}`, [])
      return await admit(input)
    })
    try {
      const pending = ctx.teamPlacement.prepare(teamId)
      if (conflicts === 3) {
        await expect(pending).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
        await expect(pending).rejects.toThrow('exhausted cursor retries')
      }
      else expect(await pending).toBe(1)
      expect(activate).toHaveBeenCalledTimes(conflicts === 3 ? 3 : 2)
      const cursors = activate.mock.calls.map(([input]) => input.expectedCursor)
      expect(cursors[1]).toBeGreaterThan(cursors[0]!)
      expect(requests).toHaveLength(conflicts === 3 ? 1 : 2)
    } finally { activate.mockRestore() }
  })

  it.each(['roles', 'tasks'] as const)('awaits %s startup and termination before releasing the plugin service', async (mode) => {
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const { ctx, teamId, invite, actor, disposed, placementScope } = await harness(async () => { entered(); await blocked })
    const member = await invite('builder')
    if (mode === 'tasks') await createTask(ctx, teamId, actor, 'unload-during-start')
    const preparing = mode === 'roles' ? ctx.teamPlacement.prepareRoles(teamId, ['builder']) : ctx.teamPlacement.prepare(teamId)
    const observed = preparing.catch((error: unknown) => error)
    await started
    const disposal = placementScope.dispose()
    release()
    const outcome = await observed
    await disposal
    expect(disposed, String(outcome)).toContain(member.id)
    expect(ctx.get('teamPlacement')).toBeUndefined()
    expect((await ctx.teams.getTeam({ teamId })).activations.at(-1)?.quiescedAt).toBeDefined()
  })

  it.each(['local-agent', 'remote-agent'] as const)('prepares dormant %s workflow roles before tasks exist and reuses their bindings', async (kind) => {
    const { ctx, teamId, invite, requests } = await harness()
    const builder = await invite('builder', ['code'], kind)
    const reviewer = await invite('second-builder', ['review'], kind)
    await Promise.all([
      ctx.teamPlacement.prepareRoles(teamId, ['builder', 'second-builder']),
      ctx.teamPlacement.prepareRoles(teamId, ['second-builder']),
    ])
    const state = await ctx.teams.getTeam({ teamId })
    expect(state.tasks).toEqual([])
    expect(state.activations.map(value => value.activation.participantId)).toEqual([
      state.participants.find(value => value.role === 'coordinator')?.id, builder.id, reviewer.id,
    ])
    expect(requests).toHaveLength(3)
  })

  it('leaves active service roles with their service owner instead of creating an agent activation', async () => {
    const { ctx, teamId, invite, requests } = await harness()
    await invite('external-service', [], 'service')
    await ctx.teamPlacement.prepareRoles(teamId, ['external-service'])
    expect(requests).toHaveLength(1)
  })

  it('refuses a workflow role whose membership ends after the role snapshot was read', async () => {
    const { ctx, teamId, invite, requests } = await harness()
    const worker = await invite('builder')
    const human = await inviteBootstrapParticipant(ctx, {
      teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      kind: 'human', displayName: 'Owner', role: 'owner', capabilities: [],
      owner: { kind: 'product-principal', principalId: 'placement-owner' as never },
      authorityGrant: { operations: ['close'], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} },
    })
    for (const phase of ['provisioning', 'active'] as const) {
      await transitionBootstrapParticipant(ctx, { teamId, participantId: human.id,
        expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, phase })
    }
    const proof = Object.freeze({}) as TeamHumanActorProof
    let scope: TeamHumanActorScope | undefined
    const unregister = ctx.teams.registerHumanActorProofSource({ name: 'placement-owner',
      resolveHumanActorProof: candidate => candidate === proof ? scope : undefined })
    const get = ctx.teams.getTeam.bind(ctx.teams)
    const read = vi.spyOn(ctx.teams, 'getTeam').mockImplementationOnce(async (input) => {
      const before = await get(input)
      const removal = { teamId, participantId: worker.id, expectedCursor: before.team.cursor, phase: 'left' as const }
      const fence = { kind: 'cursor' as const, cursor: before.team.cursor }
      scope = { teamId, participantId: human.id, operation: 'close', fence,
        payloadFingerprint: fingerprintTeamHumanActorPayload({ teamId, operation: 'close', fence, payload: jsonObjectSchema.parse(removal) }) }
      await ctx.teams.transitionParticipantPhase({ actor: proof, ...removal })
      return before
    })
    try {
      await expect(ctx.teamPlacement.prepareRoles(teamId, ['builder'])).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_CONFLICT' })
      expect(requests).toHaveLength(1)
      expect((await ctx.teams.getTeam({ teamId })).participants.find(member => member.id === worker.id)?.phase).toBe('left')
    } finally { read.mockRestore(); unregister() }
  })

  it('reuses an activation admitted by task placement while workflow role selection was in progress', async () => {
    const { ctx, teamId, invite, actor, requests } = await harness()
    const worker = await invite('builder')
    await createTask(ctx, teamId, actor, 'concurrent-role-readiness')
    const get = ctx.teams.getTeam.bind(ctx.teams)
    const read = vi.spyOn(ctx.teams, 'getTeam').mockImplementationOnce(async (input) => {
      const before = await get(input)
      expect(await ctx.teamPlacement.prepare(teamId)).toBe(1)
      return before
    })
    try {
      await ctx.teamPlacement.prepareRoles(teamId, ['builder'])
      expect(requests.filter(request => request.participant.id === worker.id)).toHaveLength(1)
      expect((await ctx.teams.getTeam({ teamId })).activations.at(-1)?.activation.participantId).toBe(worker.id)
    } finally { read.mockRestore() }
  })

  it('keeps an explicitly preset-free route absent from preflight and runtime admission', async () => {
    const { ctx, teamId, invite, actor, requests } = await harness(undefined, true, true, 8, undefined,
      routes => routes.map(({ preset: _preset, ...route }) => route))
    await invite('builder', ['code'], 'local-agent', null)
    await createTask(ctx, teamId, actor, 'preset-free-route')
    const preflight = vi.spyOn(ctx.teamWorkspaces, 'preflight')
    try {
      expect(await ctx.teamPlacement.prepare(teamId)).toBe(1)
      expect(preflight.mock.calls[0]?.[1].route).not.toHaveProperty('preset')
      expect(requests.at(-1)?.agent).not.toHaveProperty('preset')
    } finally { preflight.mockRestore() }
  })

  it('rejects missing workflow routes and excessive role batches before starting any participant', async () => {
    const { ctx, teamId, invite, requests } = await harness(undefined, true, true, 1)
    await invite('builder')
    await invite('unconfigured')
    await expect(ctx.teamPlacement.prepareRoles(teamId, ['builder', 'unconfigured']))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.teamPlacement.prepareRoles(teamId, ['absent']))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await invite('second-builder')
    await expect(ctx.teamPlacement.prepareRoles(teamId, ['builder', 'second-builder']))
      .rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
    expect(requests).toHaveLength(1)
  })

  it('leaves an unquiesced workflow epoch with its recovery owner', async () => {
    let release!: () => void
    const terminating = new Promise<void>((resolve) => { release = resolve })
    const { ctx, teamId, invite, requests } = await harness(undefined, true, true, 8, async () => { await terminating })
    await invite('builder')
    await ctx.teamPlacement.prepareRoles(teamId, ['builder'])
    const state = await ctx.teams.getTeam({ teamId })
    const binding = state.activations.at(-1)!
    const lease = await ctx.teamActivations.activate({ teamId, participantId: binding.activation.participantId,
      expectedCursor: state.team.cursor, provider: binding.provider, sessionId: binding.sessionId,
      seed: { kind: 'resume' }, agent: { options: {} }, signal: new AbortController().signal })
    const disposal = lease.dispose()
    try {
      await expect.poll(async () => (await ctx.teams.getTeam({ teamId })).activations.at(-1)?.activation.status).toBe('stopping')
      await expect(ctx.teamPlacement.prepareRoles(teamId, ['builder']))
        .rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_CONFLICT' })
      expect(requests).toHaveLength(2)
    } finally { release(); await disposal }
  })

  it('selects one eligible descriptor in stable identifier order when several routes can own the task', async () => {
    const { ctx, teamId, invite, actor, requests } = await harness()
    const members = [await invite('builder'), await invite('second-builder'), await invite('builder')]
    await createTask(ctx, teamId, actor, 'stable-owner-selection')
    expect(await ctx.teamPlacement.prepare(teamId)).toBe(1)
    const ordered = members.map(member => member.id).sort((a, b) => a.localeCompare(b))
    expect(requests.at(-1)?.participant.id).toBe(ordered[0])
    expect(requests).toHaveLength(2)
  })

  it('resumes the same Session after a confirmed prior termination', async () => {
    const { ctx, teamId, invite, actor, requests } = await harness()
    const worker = await invite('builder')
    await ctx.teamPlacement.prepareRoles(teamId, ['builder'])
    const state = await ctx.teams.getTeam({ teamId })
    const binding = state.activations.at(-1)!
    const lease = await ctx.teamActivations.activate({ teamId, participantId: worker.id,
      expectedCursor: state.team.cursor, provider: binding.provider, sessionId: binding.sessionId,
      seed: { kind: 'resume' }, agent: { options: {} }, signal: new AbortController().signal })
    await lease.dispose()
    await createTask(ctx, teamId, actor, 'resume-quiesced-owner')
    expect(await ctx.teamPlacement.prepare(teamId)).toBe(1)
    expect(requests.at(-1)).toMatchObject({ participant: { id: worker.id }, sessionId: binding.sessionId, seed: { kind: 'resume' } })
    const recovered = (await ctx.teams.getTeam({ teamId })).activations.at(-1)!
    expect(recovered.activation.id).not.toBe(binding.activation.id)
    expect(recovered.sessionId).toBe(binding.sessionId)
  })

  it('coalesces concurrent preparation and publishes one durable owner with the exact route', async () => {
    const { ctx, teamId, invite, actor, requests } = await harness()
    const worker = await invite('builder')
    await createTask(ctx, teamId, actor, 'compile', { participantIds: [worker.id], providers: ['placement-test'] })
    const first = ctx.teamPlacement.prepare(teamId)
    expect(ctx.teamPlacement.prepare(teamId)).toBe(first)
    expect(await first).toBe(1)
    expect(await ctx.teamPlacement.prepare(teamId)).toBe(0)
    expect(requests.filter(request => request.participant.id === worker.id)).toHaveLength(1)
    expect(requests.at(-1)?.agent).toMatchObject({ preset: 'worker', options: { provider: 'test', model: 'model', maxTokens: 1000 } })
    const state = await ctx.teams.getTeam({ teamId })
    expect(state.activations.find(binding => binding.activation.participantId === worker.id)?.activation.status).toBe('idle')
    expect(state.tasks[0]?.lease).toBeUndefined()
  })

  it('prepares distinct owners for independent tasks and preserves creation restrictions', async () => {
    const { ctx, teamId, invite, actor } = await harness()
    await invite('builder')
    const second = await invite('second-builder')
    const task = await createTask(ctx, teamId, actor, 'second', { roles: ['second-builder'] })
    await createTask(ctx, teamId, actor, 'first', { roles: ['builder'] })
    expect(await ctx.teamPlacement.prepare(teamId)).toBe(2)
    expect((await ctx.teams.getTask({ teamId, taskId: task.id })).placement).toEqual({ roles: ['second-builder'] })
    expect(matchesTaskPlacement(task.placement, second)).toBe(true)
    expect(matchesTaskPlacement({ providers: ['other'] }, second, 'placement-test')).toBe(false)
    expect(matchesTaskPlacement({ participantIds: [] }, second)).toBe(false)
  })

  it('does not provision an owner for a task whose dependency remains pending', async () => {
    const { ctx, teamId, invite, actor, requests } = await harness()
    await invite('builder')
    const blocked = await createTask(ctx, teamId, actor, 'unrouted-dependency', { roles: ['unconfigured'] })
    await createTask(ctx, teamId, actor, 'dependent-task', { roles: ['builder'] }, [blocked.id])
    expect(await ctx.teamPlacement.prepare(teamId)).toBe(0)
    expect(requests).toHaveLength(1)
    await createTask(ctx, teamId, actor, 'independent-task', { roles: ['builder'] })
    expect(await ctx.teamPlacement.prepare(teamId)).toBe(1)
    expect(requests).toHaveLength(2)
  })

  it.each(['selection', 'admission'] as const)('rechecks task deletion after %s without starting a provider', async (stage) => {
    const { ctx, teamId, invite, actor, requests } = await harness()
    await invite('builder')
    const task = await createTask(ctx, teamId, actor, `delete-before-${stage}`)
    const remove = async () => { await ctx.teams.deleteTask({ actor, teamId, taskId: task.id, expectedRevision: task.revision }) }
    let restore: () => void
    if (stage === 'selection') {
      const get = ctx.teams.getTeam.bind(ctx.teams)
      const read = vi.spyOn(ctx.teams, 'getTeam').mockImplementationOnce(async (input) => {
        const snapshot = await get(input)
        await remove()
        return snapshot
      })
      restore = () => { read.mockRestore() }
    } else {
      const admit = ctx.teamActivations.activate.bind(ctx.teamActivations)
      const activate = vi.spyOn(ctx.teamActivations, 'activate').mockImplementationOnce(async (input) => {
        await remove()
        return await admit(input)
      })
      restore = () => { activate.mockRestore() }
    }
    try {
      expect(await ctx.teamPlacement.prepare(teamId)).toBe(0)
      expect(requests).toHaveLength(1)
      expect((await ctx.teams.getTask({ teamId, taskId: task.id })).phase).toBe('deleted')
    } finally { restore() }
  })

  it('does not start a descriptor excluded by task restrictions or a deployment route', async () => {
    const { ctx, teamId, invite, actor, requests } = await harness()
    await invite('builder')
    await invite('unconfigured')
    await createTask(ctx, teamId, actor, 'blocked', { roles: ['unconfigured'] })
    expect(await ctx.teamPlacement.prepare(teamId)).toBe(0)
    expect(requests).toHaveLength(1)
  })

  it('does not activate a matching Participant route for a child-Team task', async () => {
    const { ctx, teamId, actor, requests } = await harness()
    const state = await ctx.teams.getTeam({ teamId })
    await ctx.teams.createTask({ actor, teamId, expectedCursor: state.team.cursor,
      createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('child-only-placement') },
      subject: 'Delegated child', description: 'The child Team owns this execution.',
      execution: { kind: 'child-team', templateId: 'fixture', templateVersion: 1,
        authorityGrant: { operations: ['register', 'send', 'close'], workspaceModes: ['shared'], readScopes: [], writeScopes: [], budgets: {} }, budget: {} },
      blockedBy: [], requiredCapabilities: [], priority: 1, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {},
      reviewPolicy: { kind: 'none' }, maxAttempts: 1 })
    expect(await ctx.teamPlacement.prepare(teamId)).toBe(0)
    expect(requests.filter(request => request.participant.role !== 'coordinator')).toHaveLength(0)
  })

  it('releases an activation immediately when the mounted workspace provider rejects the route', async () => {
    const { ctx, teamId, invite, actor, disposed } = await harness(undefined, false)
    const worker = await invite('builder')
    await createTask(ctx, teamId, actor, 'incompatible-workspace')
    expect(await ctx.teamPlacement.prepare(teamId)).toBe(0)
    expect(disposed).toContain(worker.id)
  })

  it.each(['roles', 'tasks'] as const)('reports a %s preparation failure that arrives during close', async (mode) => {
    const { ctx, teamId, invite, actor, requests } = await harness()
    await invite('builder')
    if (mode === 'tasks') await createTask(ctx, teamId, actor, 'storage-failure-during-close')
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const failure = new Error('Team storage unavailable')
    const read = vi.spyOn(ctx.teams, 'getTeam').mockImplementationOnce(async () => {
      entered.resolve(undefined)
      await release.promise
      throw failure
    })
    const placement = ctx.teamPlacement
    try {
      const preparing = mode === 'roles' ? placement.prepareRoles(teamId, ['builder']) : placement.prepare(teamId)
      const prepareFailed = expect(preparing).rejects.toBe(failure)
      await entered.promise
      const closeFailed = expect(placement.close()).rejects.toMatchObject({ errors: [failure] })
      release.resolve(undefined)
      await Promise.all([prepareFailed, closeFailed])
      await placement.close()
      expect(requests).toHaveLength(1)
    } finally { release.resolve(undefined); read.mockRestore() }
  })

  it('allows a later close to retry retained leases after a provider termination failure', async () => {
    let stops = 0
    const failure = new Error('Provider termination temporarily unavailable')
    const { ctx, teamId, invite, disposed } = await harness(undefined, true, true, 8, async () => {
      if (++stops === 1) throw failure
    })
    const worker = await invite('builder')
    await ctx.teamPlacement.prepareRoles(teamId, ['builder'])
    const placement = ctx.teamPlacement
    const closing = placement.close()
    expect(placement.close()).toBe(closing)
    await expect(closing).rejects.toMatchObject({ errors: [failure] })
    expect(disposed).not.toContain(worker.id)
    expect((await ctx.teams.getTeam({ teamId })).activations.at(-1)?.quiescedAt).toBeUndefined()
    await placement.close()
    expect(stops).toBe(2)
    expect(disposed).toContain(worker.id)
    expect((await ctx.teams.getTeam({ teamId })).activations.at(-1)?.quiescedAt).toBeDefined()
    await expect(placement.prepare(teamId)).rejects.toThrow('Team placement is closed')
  })

  it('preserves a workspace eligibility error after successful cleanup without terminating twice', async () => {
    const failure = new Error('Workspace eligibility could not be determined')
    const { ctx, teamId, invite, actor, disposed, placementScope } = await harness(undefined, async () => { throw failure })
    const worker = await invite('builder')
    await createTask(ctx, teamId, actor, 'eligibility-error-cleaned')
    await expect(ctx.teamPlacement.prepare(teamId)).rejects.toBe(failure)
    expect((await ctx.teams.getTeam({ teamId })).activations.at(-1)?.quiescedAt).toBeDefined()
    await placementScope.dispose()
    expect(disposed.filter(id => id === worker.id)).toHaveLength(1)
  })

  it.each(['reject', 'throw'] as const)('retries workspace activation termination after eligibility %s when placement unloads', async (mode) => {
    let stops = 0
    const failure = new Error('Provider termination temporarily unavailable')
    const eligibilityFailure = new Error('Workspace provider failed')
    const eligibility = async () => { if (mode === 'throw') throw eligibilityFailure; return false }
    const { ctx, teamId, invite, actor, disposed, placementScope } = await harness(undefined, eligibility, true, 8, async () => {
      if (++stops === 1) throw failure
    })
    const worker = await invite('builder')
    await createTask(ctx, teamId, actor, 'workspace-rejected-stop-retry')
    const pending = ctx.teamPlacement.prepare(teamId)
    if (mode === 'reject') await expect(pending).rejects.toBe(failure)
    else await expect(pending).rejects.toMatchObject({ errors: [eligibilityFailure, failure] })
    expect(disposed).not.toContain(worker.id)
    expect((await ctx.teams.getTeam({ teamId })).activations.at(-1)?.quiescedAt).toBeUndefined()
    await placementScope.dispose()
    expect(stops).toBe(2)
    expect(disposed).toContain(worker.id)
    expect((await ctx.teams.getTeam({ teamId })).activations.at(-1)?.quiescedAt).toBeDefined()
  })

  it('rejects an incompatible workspace route before publishing an activation', async () => {
    const { ctx, teamId, invite, actor, requests, disposed } = await harness(undefined, true, false)
    const worker = await invite('builder')
    await createTask(ctx, teamId, actor, 'preflight-incompatible')
    expect(await ctx.teamPlacement.prepare(teamId)).toBe(0)
    expect(requests.filter(request => request.participant.id === worker.id)).toHaveLength(0)
    expect(disposed).not.toContain(worker.id)
  })

  it('releases a published activation when the requesting task is deleted during provider startup', async () => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const { ctx, teamId, invite, actor, disposed } = await harness(async () => { entered.resolve(undefined); await release.promise })
    const worker = await invite('builder')
    const task = await createTask(ctx, teamId, actor, 'cancel-during-start')
    const prepare = ctx.teamPlacement.prepare(teamId)
    await entered.promise
    await ctx.teams.deleteTask({ actor, teamId, taskId: task.id, expectedRevision: task.revision })
    release.resolve(undefined)
    expect(await prepare).toBe(0)
    expect(disposed).toContain(worker.id)
    const after = await ctx.teams.getTeam({ teamId })
    expect(after.activations.find(binding => binding.activation.participantId === worker.id)?.quiescedAt).toBeDefined()
  })

  it('rejects duplicate and unknown placement fields at the request parser', () => {
    expect(teamTaskPlacementSchema.safeParse({ roles: ['builder', 'builder'] }).success).toBe(false)
    expect(teamTaskPlacementSchema.safeParse({ model: 'ambient' }).success).toBe(false)
  })

  it('propagates the scheduling owner cancellation into provider admission without publishing an epoch', async () => {
    const entered = Promise.withResolvers<undefined>()
    const { ctx, teamId, invite, actor, requests } = await harness(async (request) => {
      entered.resolve(undefined)
      await new Promise<never>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => { reject(request.signal.reason as Error) }, { once: true })
      })
    })
    const worker = await invite('builder')
    await createTask(ctx, teamId, actor, 'owner-cancellation')
    const owner = new AbortController()
    const cancelled = new Error('Scheduler stopped')
    const pending = ctx.teamPlacement.prepare(teamId, owner.signal)
    await entered.promise
    owner.abort(cancelled)
    await expect(pending).rejects.toBe(cancelled)
    expect(requests.at(-1)?.signal.aborted).toBe(true)
    expect((await ctx.teams.getTeam({ teamId })).activations.some(binding => binding.activation.participantId === worker.id)).toBe(false)
  })

  it('rejects direct assignment when the actual preset differs from the participant hint', async () => {
    const { ctx, teamId, invite, actor } = await harness()
    const worker = await invite('builder')
    const task = await createTask(ctx, teamId, actor, 'actual-preset', { presets: ['worker'], models: ['test/model'] })
    const state = await ctx.teams.getTeam({ teamId })
    const lease = await ctx.teamActivations.activate({ teamId, participantId: worker.id, expectedCursor: state.team.cursor,
      provider: 'placement-test', sessionId: SessionId('different-preset'), seed: { kind: 'fresh' },
      agent: { preset: 'other', options: { provider: 'test', model: 'model' } }, signal: new AbortController().signal })
    expect(lease.binding.selection?.preset).toBe('other')
    const input = { teamId, taskId: task.id, expectedRevision: task.revision, participantId: worker.id,
      activationId: lease.binding.activation.id, leaseDurationMs: 1000 }
    const proof = Object.freeze({}) as TeamSystemTaskLeaseProof
    const scope: TeamSystemTaskLeaseScope = { kind: 'scheduler-task-assign', ...input }
    const unregister = ctx.teams.registerSystemTaskLeaseProofSource({ name: 'team-scheduler-dag',
      resolveTaskLeaseProof: value => value === proof ? scope : undefined })
    try {
      await expect(ctx.teams.assignTask({ actor: proof, ...input })).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
      expect((await ctx.teams.getTask({ teamId, taskId: task.id })).lease).toBeUndefined()
    } finally { unregister() }
  })
})
