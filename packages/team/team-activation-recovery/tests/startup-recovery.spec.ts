import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { consentChannelEndpoints } from '../../../core/team/tests/channel-endpoint-consent.ts'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import ActivationSupervisors, { ActivationSupervisorError } from '@clocky/clocky-activation-supervisor'
import type {
  ActivationHandle,
  AgentRuntimeActivationRequest,
  AgentRuntimeFencer,
  AgentRuntimeProvider,
} from '@clocky/clocky-agent-runtime'
import { SessionId } from '@clocky/clocky-session'
import { TeamError } from '@clocky/clocky-team'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import {
  activationBindingSnapshotSchema,
  activationIdSchema,
  participantIdSchema,
  participantSnapshotSchema,
  teamTaskCreateIdempotencyKeySchema,
  teamIdSchema,
  teamStateSnapshotSchema,
} from '@clocky/clocky-team'
import TeamHub from '@clocky/clocky-team-hub'
import * as TeamActivationController from '@clocky/clocky-team-activation-controller'
import type { TeamActivationColdReplaceRequest } from '@clocky/clocky-team-activation-controller'
import type {
  ActivationBindingSnapshot,
  ActivationQuiesceRequest,
  ActivationStatus,
  ParticipantSnapshot,
  TeamChannelAdapter,
  TeamActorProof,
  TeamPhase,
  TeamPolicy,
  TeamSnapshot,
  TeamStateSnapshot,
  TeamSystemActivationProof,
  TeamSystemActivationProofSource,
  TeamSystemActivationScope,
  TeamSystemTaskLeaseProof,
  TeamSystemTaskLeaseScope,
  TeamTaskAssignInput,
  TeamTaskSnapshot,
  TeamSystemPhaseProof,
  TeamSystemPhaseScope,
} from '@clocky/clocky-team'
import * as TeamActivationRecovery from '../src/index.ts'
import type { Config } from '../src/index.ts'

const contexts = new Set<Context>()
const roots: string[] = []
const TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE = 'team-scheduler-dag'
type SchedulerTaskAssignScope = Extract<TeamSystemTaskLeaseScope, { readonly kind: 'scheduler-task-assign' }>
const taskDefaults = {
  requiredCapabilities: [],
  priority: 0,
  readScopes: [],
  workspaceMode: 'shared' as const,
  budget: {},
  reviewPolicy: { kind: 'none' as const },
  maxAttempts: 3,
}
const wakeAdapter: TeamChannelAdapter = {
  type: 'recovery-wake',
  version: 1,
  validateCreate() {},
  initialState() { return {} },
  validateSend() {},
  fold(state) { return state },
  afterAccept() { return [] },
  expectedNext() { return { kind: 'none' } },
  deliveryPlan() { return [] },
  projectView() { return {} },
}

afterEach(async () => {
  const failures: unknown[] = []
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
      await rm(root, { recursive: true, force: true })
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'startup recovery test cleanup failed')
})

/** Return the only explicit deployment configuration accepted by the Consumer. */
function config(overrides: Partial<Config> = {}): Config {
  return { provider: 'sdk', profile: 'local-sdk', hostId: 'host-local', ...overrides }
}

/** Build one durable participant retained by a controlled Team projection. */
function participant(
  teamId: TeamSnapshot['id'],
  id: string,
  overrides: Partial<Pick<ParticipantSnapshot, 'kind' | 'phase'>> = {},
): ParticipantSnapshot {
  const kind = overrides.kind ?? 'remote-agent'
  return participantSnapshotSchema.parse({
    id: participantIdSchema.parse(id),
    teamId,
    kind,
    displayName: id,
    role: 'worker',
    capabilities: [],
    phase: 'active',
    ...kind === 'human' ? { owner: { kind: 'system' } } : {},
    ...overrides,
  })
}

/** Build one activation with an optional durable SDK cold-replacement plan. */
function binding(
  teamId: TeamSnapshot['id'],
  owner: ParticipantSnapshot,
  id: string,
  options: {
    readonly provider?: string
    readonly kind?: 'sdk-local-cold-replace' | 'acp-local-cold-replace'
    readonly profile?: string
    readonly hostId?: string
    readonly status?: ActivationStatus
    readonly recovery?: boolean
    readonly quiesced?: boolean
    readonly quiescenceSource?: 'fenced' | 'quiesced'
    readonly quiescedWakeCleanup?: boolean
  } = {},
): ActivationBindingSnapshot {
  const provider = options.provider ?? 'sdk'
  const status = options.quiesced ? 'offline' : options.status ?? 'running'
  return activationBindingSnapshotSchema.parse({
    activation: {
      id: activationIdSchema.parse(id),
      teamId,
      participantId: owner.id,
      status,
    },
    sessionId: `session-${id}`,
    provider,
    ...options.recovery === false ? {} : {
      recovery: options.kind === 'acp-local-cold-replace'
        ? {
          kind: 'acp-local-cold-replace' as const,
          version: 1 as const,
          runtimeProvider: provider,
          profile: options.profile ?? 'local-sdk',
          cwd: '/workspace',
          process: { hostId: options.hostId ?? 'host-local', pid: 10, started: `started-${id}`, processGroupId: 10 },
        }
        : {
          kind: 'sdk-local-cold-replace' as const,
          version: 1 as const,
          runtimeProvider: provider,
          profile: options.profile ?? 'local-sdk',
          agent: { provider: 'mock', model: 'mock' },
          process: { hostId: options.hostId ?? 'host-local', pid: 10, started: `started-${id}`, processGroupId: 10 },
        },
    },
    ...options.quiesced ? {
      quiescedAt: 9,
      quiescenceSource: options.quiescenceSource ?? 'quiesced',
      quiescedWakeChannelIds: options.quiescedWakeCleanup ? [`wake-${id}`] : [],
    } : {},
  })
}

/** Build a complete Team state and retain its durable activation creation order. */
function state(
  id: string,
  phase: TeamPhase,
  participants: readonly ParticipantSnapshot[],
  activations: readonly ActivationBindingSnapshot[],
): TeamStateSnapshot {
  const teamId = teamIdSchema.parse(id)
  const goal = { teamId, revision: 1, objective: `Recover ${id}.`, phase: 'active' as const, budgets: {} }
  return teamStateSnapshotSchema.parse({
    team: {
      id: teamId,
      depth: 0,
      maxTeamDepth: 0,
      goal,
      phase,
      cursor: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    goal,
    rules: {},
    budgets: {},
    participants,
    activations,
    tasks: [],
    workspaceAllocations: [],
    channelIds: [],
  })
}

/** Mount the Consumer against controlled Team snapshots and a spy controller. */
function harness(
  listed: readonly TeamSnapshot[],
  states: readonly TeamStateSnapshot[],
  channels = new Map<string, 'active' | 'closed' | 'expired' | 'failed'>(),
) {
  const ctx = new Context()
  contexts.add(ctx)
  const byId = new Map(states.map(item => [item.team.id, item]))
  const listTeams = vi.fn(async () => listed)
  const listTeamsPage = vi.fn(async ({ afterCursor, limit }: { readonly afterCursor: number; readonly limit: number }) => {
    const all = await listTeams()
    const items = all.slice(afterCursor + 1, afterCursor + 1 + limit)
    const next = afterCursor + items.length
    return { items, ...(next + 1 < all.length ? { nextCursor: next } : {}) }
  })
  const getTeam = vi.fn(async ({ teamId }: { readonly teamId: TeamSnapshot['id'] }) => {
    const current = byId.get(teamId)
    if (current === undefined) throw new Error(`unexpected Team '${teamId}'`)
    return current
  })
  const getChannel = vi.fn(async ({ channelId }: { readonly channelId: string }) => {
    const phase = channels.get(channelId)
    if (phase === undefined) throw new Error(`unexpected channel '${channelId}'`)
    return { phase }
  })
  const coldReplace = vi.fn<(request: TeamActivationColdReplaceRequest) => Promise<void>>(async () => {})
  const quiesceActivation = vi.fn<(request: ActivationQuiesceRequest) => Promise<void>>(async () => {})
  const activationProofSources = new Map<string, TeamSystemActivationProofSource>()
  const registerSystemActivationProofSource = vi.fn((source: TeamSystemActivationProofSource): (() => void) => {
    activationProofSources.set(source.name, source)
    return () => { activationProofSources.delete(source.name) }
  })
  ctx.provide('teams', {
    listTeams,
    listTeamsPage,
    getTeam,
    getChannel,
    quiesceActivation,
    registerSystemActivationProofSource,
  } as never)
  ctx.provide('teamActivations', { coldReplace } as never)
  return {
    ctx,
    listTeams,
    listTeamsPage,
    getTeam,
    getChannel,
    coldReplace,
    quiesceActivation,
    activationProofSources,
    registerSystemActivationProofSource,
    replaceState: (next: TeamStateSnapshot): void => { byId.set(next.team.id, next) },
    mount: async (options: Config = config()) => {
      return await ctx.plugin(TeamActivationRecovery, options)
    },
  }
}

/** Persist a fully active remote participant in the real Team Hub. */
async function activeRemoteParticipant(ctx: Context, teamId: TeamSnapshot['id']): Promise<ParticipantSnapshot> {
  let current = await ctx.teams.getTeam({ teamId })
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId,
    expectedCursor: current.team.cursor,
    kind: 'remote-agent',
    displayName: 'Recovery worker',
    role: 'worker',
    capabilities: [],
  })
  current = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: current.team.cursor,
    phase: 'provisioning',
  })
  current = await ctx.teams.getTeam({ teamId })
  return await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: current.team.cursor,
    phase: 'active',
  })
}

/** Provision one active coordinator and issue the current activation proof required for task creation. */
async function coordinatorTaskActor(ctx: Context, teamId: TeamSnapshot['id']): Promise<TeamActorProof> {
  let current = await ctx.teams.getTeam({ teamId })
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId,
    expectedCursor: current.team.cursor,
    kind: 'local-agent',
    displayName: 'Recovery coordinator',
    role: 'coordinator',
    capabilities: [],
  })
  current = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: current.team.cursor,
    phase: 'provisioning',
  })
  current = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: current.team.cursor,
    phase: 'active',
  })
  current = await ctx.teams.getTeam({ teamId })
  const input = {
    expectedCursor: current.team.cursor,
    binding: {
      activation: {
        id: activationIdSchema.parse('activation-startup-recovery-coordinator'),
        teamId,
        participantId: invited.id,
        status: 'idle' as const,
      },
      sessionId: SessionId('session-startup-recovery-coordinator'),
      provider: 'in-process',
    },
  }
  const binding = await withControllerActivationProof<ActivationBindingSnapshot>(
    ctx,
    { kind: 'activation-controller-bind', ...input },
    async actor => await ctx.teams.bindActivation({ actor, ...input }),
  )
  return ctx.teams.openActivationActorProofIssuer().issue(binding).proof
}

/** Return a non-secret recovery plan that the real controller supplies to the test fencer. */
function recoveryPlan(provider = 'sdk', pid = 10) {
  return {
    kind: 'sdk-local-cold-replace' as const,
    version: 1 as const,
    runtimeProvider: provider,
    profile: 'local-sdk',
    agent: { provider: 'mock', model: 'mock' },
    process: { hostId: 'host-local', pid, started: `started-real-${String(pid)}`, processGroupId: pid },
  }
}

/** Publish one remote handle whose resume identity is entirely derived from the controller request. */
function replacementHandle(request: AgentRuntimeActivationRequest): ActivationHandle {
  const activation = {
    id: activationIdSchema.parse('activation-startup-recovery-replacement'),
    teamId: request.teamId,
    participantId: request.participant.id,
    status: 'idle' as const,
  }
  return {
    activation,
    sessionId: request.sessionId,
    localAgent: undefined,
    recovery: recoveryPlan('sdk', 11),
    async health() { return activation },
    onStatus() { return () => {} },
    interrupt() {},
    async dispose() {},
  }
}

/** Compose one real durable Hub with its SDK placement and recovery owner. */
async function realRecoveryContext(root: string) {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(AgentRuntime)
  await ctx.plugin(TeamActivationController)
  const activations: AgentRuntimeActivationRequest[] = []
  const fences: ActivationBindingSnapshot[] = []
  const provider: AgentRuntimeProvider = {
    name: 'sdk',
    terminationMode: 'owned-process',
    async activate(request) {
      activations.push(request)
      return replacementHandle(request)
    },
  }
  const fencer: AgentRuntimeFencer = {
    provider: 'sdk',
    validate(binding) {
      expect(binding.recovery).toEqual(recoveryPlan())
    },
    async fence(binding) {
      fences.push(binding)
    },
  }
  const unregisterFencer = ctx.agentRuntimes.registerFencer(fencer)
  const unregisterProvider = ctx.agentRuntimes.registerProvider(provider)
  return { ctx, activations, fences, unregisterProvider, unregisterFencer }
}

/** Compose the real Team Hub, activation controller, provider, and fencer around one durable stale epoch. */
async function realRecoveryHarness(supervised = false) {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-activation-recovery-'))
  roots.push(root)
  const runtime = await realRecoveryContext(root)
  const { ctx } = runtime
  const created = await createTestRootTeam(ctx, { goal: { objective: 'Recover a real SDK worker.', budgets: {} }, rules: {}, budgets: {} })
  const worker = await activeRemoteParticipant(ctx, created.team.id)
  const current = await ctx.teams.getTeam({ teamId: created.team.id })
  const input = {
    expectedCursor: current.team.cursor,
    binding: {
      activation: {
        id: activationIdSchema.parse('activation-startup-recovery-stale'),
        teamId: created.team.id,
        participantId: worker.id,
        status: 'running' as const,
      },
      sessionId: SessionId('session-startup-recovery'),
      provider: 'sdk',
      recovery: {
        ...recoveryPlan(),
        ...supervised ? {
          process: { ...recoveryPlan().process, hostId: 'host-remote' },
          supervisor: {
            name: 'remote-sdk', version: 1, hostId: 'host-remote', endpointId: 'endpoint-remote',
            generation: activationIdSchema.parse('activation-startup-recovery-stale'), terminationMode: 'owned-process' as const,
          },
        } : {},
      },
    },
  }
  const stale = await withControllerActivationProof<ActivationBindingSnapshot>(ctx, { kind: 'activation-controller-bind', ...input }, async actor =>
    await ctx.teams.bindActivation({ actor, ...input }))
  return { ...runtime, created, worker, stale, root }
}

/** Issue one real controller-owned proof through its private single-call issuer for a focused Hub fixture. */
async function withControllerActivationProof<T>(
  ctx: Context,
  scope: TeamSystemActivationScope,
  operation: (actor: TeamSystemActivationProof) => Promise<T>,
): Promise<T> {
  const controller = ctx.teamActivations as unknown as {
    withActivationProof<U>(
      sourceScope: TeamSystemActivationScope,
      action: (actor: TeamSystemActivationProof) => Promise<U>,
    ): Promise<U>
  }
  return await controller.withActivationProof(scope, operation)
}

/** Assign one wake-cleanup fixture lease through an exact one-shot scheduler authority. */
async function assignSchedulerTask(
  ctx: Context,
  input: TeamTaskAssignInput,
): Promise<TeamTaskSnapshot> {
  const proofs = new WeakMap<TeamSystemTaskLeaseProof, SchedulerTaskAssignScope>()
  const unregister = ctx.teams.registerSystemTaskLeaseProofSource({
    name: TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE,
    resolveTaskLeaseProof: proof => proofs.get(proof),
  })
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test scheduler task-lease proofs are runtime-only') },
  })
  const actor = Object.freeze(proof) as TeamSystemTaskLeaseProof
  proofs.set(actor, { kind: 'scheduler-task-assign', ...input })
  try {
    return await ctx.teams.assignTask({ actor, ...input })
  } finally {
    proofs.delete(actor)
    unregister()
  }
}

describe('@clocky/clocky-team-activation-recovery', () => {
  it('reports a named cursor conflict for a repeated Team page', async () => {
    const teamId = teamIdSchema.parse('team-startup-recovery-cursor')
    const worker = participant(teamId, 'participant-recovery-cursor')
    const active = state('team-startup-recovery-cursor', 'active', [worker], [
      binding(teamId, worker, 'activation-recovery-cursor'),
    ])
    const test = harness([active.team], [active])
    test.listTeamsPage
      .mockResolvedValueOnce({ items: [active.team], nextCursor: 0 })
      .mockResolvedValueOnce({ items: [active.team], nextCursor: 0 })

    await expect(test.mount()).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
    expect(test.listTeamsPage).toHaveBeenCalledTimes(2)
  })

  it.each(['unknown', 'unreachable'] as const)('durably stalls %s remote execution without fencing or replacing its epoch', async (status) => {
    const test = await realRecoveryHarness(true)
    await test.ctx.plugin(ActivationSupervisors)
    const fence = vi.fn(async () => ({ descriptor: test.stale.recovery!.supervisor!, status: 'terminated' as const }))
    test.ctx.activationSupervisors.registerProvider({
      name: 'remote-sdk', version: 1, validate() {},
      async health() { return { descriptor: test.stale.recovery!.supervisor!, status } }, fence,
    })
    await test.ctx.plugin(TeamActivationRecovery, config({ supervisorHosts: ['host-remote'], pageSize: 1 }))
    const current = await test.ctx.teams.getTeam({ teamId: test.created.team.id })
    expect(current.team.phase).toBe('stalled')
    expect(current.team.stallReason?.code).toBe(status === 'unknown' ? 'SUPERVISOR_UNKNOWN' : 'SUPERVISOR_UNREACHABLE')
    expect(current.activations[0]?.activation.status).toBe('running')
    expect(fence).not.toHaveBeenCalled()
    expect(test.activations).toHaveLength(0)
    expect(test.fences).toHaveLength(0)
  })

  it.each([false, true])('preserves a stale epoch when its runtime provider is retired (supervised: %s)', async (supervised) => {
    const test = await realRecoveryHarness(supervised)
    await test.ctx.plugin(ActivationSupervisors)
    const health = vi.fn(async () => ({ descriptor: test.stale.recovery!.supervisor!, status: 'reachable' as const }))
    const fence = vi.fn(async () => ({ descriptor: test.stale.recovery!.supervisor!, status: 'terminated' as const }))
    test.ctx.activationSupervisors.registerProvider({ name: 'remote-sdk', version: 1, validate() {}, health, fence })
    test.unregisterProvider()

    await test.ctx.plugin(TeamActivationRecovery, config({ supervisorHosts: ['host-remote'] }))

    const current = await test.ctx.teams.getTeam({ teamId: test.created.team.id })
    expect(current.team).toMatchObject({ phase: 'stalled', stallReason: { code: 'AGENT_RUNTIME_PROVIDER_UNAVAILABLE' } })
    expect(current.activations).toEqual([test.stale])
    expect(health).not.toHaveBeenCalled()
    expect(fence).not.toHaveBeenCalled()
    expect(test.fences).toHaveLength(0)
    expect(test.activations).toHaveLength(0)
  })

  it.each([false, true])('records provider retirement during fencing without losing termination proof (supervised: %s)', async (supervised) => {
    const test = await realRecoveryHarness(supervised)
    const fence = vi.fn(async () => {
      test.unregisterProvider()
      return { descriptor: test.stale.recovery!.supervisor!, status: 'terminated' as const }
    })
    if (supervised) {
      await test.ctx.plugin(ActivationSupervisors)
      test.ctx.activationSupervisors.registerProvider({ name: 'remote-sdk', version: 1, validate() {},
        async health() { return { descriptor: test.stale.recovery!.supervisor!, status: 'reachable' } }, fence })
    } else {
      test.unregisterFencer()
      test.ctx.agentRuntimes.registerFencer({ provider: 'sdk', validate() {}, async fence() { await fence() } })
    }

    await test.ctx.plugin(TeamActivationRecovery, config({ supervisorHosts: ['host-remote'] }))

    const current = await test.ctx.teams.getTeam({ teamId: test.created.team.id })
    expect(current.team).toMatchObject({ phase: 'stalled', stallReason: { code: 'AGENT_RUNTIME_PROVIDER_UNAVAILABLE' } })
    expect(current.activations).toHaveLength(1)
    expect(current.activations[0]).toMatchObject({ quiescenceSource: 'fenced', activation: { id: test.stale.activation.id, status: 'offline' } })
    expect(fence).toHaveBeenCalledOnce()
    expect(test.activations).toHaveLength(0)
    await test.ctx.fiber.dispose()
    contexts.delete(test.ctx)
    const restarted = await realRecoveryContext(test.root)
    const replayed = await restarted.ctx.teams.getTeam({ teamId: test.created.team.id })
    expect(replayed.team).toEqual(current.team)
    expect(replayed.activations).toEqual(current.activations)
  })

  it('selects the exact remote supervisor for replacement and never invokes a same-host fencer', async () => {
    const test = await realRecoveryHarness(true)
    await test.ctx.plugin(ActivationSupervisors)
    const fence = vi.fn(async () => ({ descriptor: test.stale.recovery!.supervisor!, status: 'terminated' as const }))
    test.ctx.activationSupervisors.registerProvider({ name: 'remote-sdk', version: 1, validate() {},
      async health() { return { descriptor: test.stale.recovery!.supervisor!, status: 'reachable' } }, fence })
    await test.ctx.plugin(TeamActivationRecovery, config({ supervisorHosts: ['host-remote'] }))
    expect(fence).toHaveBeenCalledOnce()
    expect(test.fences).toHaveLength(0)
    expect(test.activations).toHaveLength(1)
    const current = await test.ctx.teams.getTeam({ teamId: test.created.team.id })
    expect(current.activations.find(item => item.activation.id === test.stale.activation.id)).toMatchObject({ quiescenceSource: 'fenced', activation: { status: 'offline' } })
  })

  it('records unavailable exact versions instead of selecting another registered supervisor', async () => {
    const test = await realRecoveryHarness(true)
    await test.ctx.plugin(ActivationSupervisors)
    const health = vi.fn(async () => ({ descriptor: test.stale.recovery!.supervisor!, status: 'reachable' as const }))
    test.ctx.activationSupervisors.registerProvider({ name: 'remote-sdk', version: 2, validate() {}, health, async fence() { return { descriptor: test.stale.recovery!.supervisor!, status: 'terminated' } } })
    await test.ctx.plugin(TeamActivationRecovery, config({ supervisorHosts: ['host-remote'] }))
    expect(health).not.toHaveBeenCalled()
    const current = await test.ctx.teams.getTeam({ teamId: test.created.team.id })
    expect(current.team.stallReason?.code).toBe('SUPERVISOR_UNAVAILABLE')
  })

  it('preserves supervisor generation mismatch as a durable recovery stall', async () => {
    const test = await realRecoveryHarness(true)
    await test.ctx.plugin(ActivationSupervisors)
    const fence = vi.fn(async () => ({ descriptor: test.stale.recovery!.supervisor!, status: 'terminated' as const }))
    test.ctx.activationSupervisors.registerProvider({
      name: 'remote-sdk', version: 1, validate() {},
      async health() {
        throw new ActivationSupervisorError('generation changed', 'SUPERVISOR_GENERATION_MISMATCH')
      },
      fence,
    })
    await test.ctx.plugin(TeamActivationRecovery, config({ supervisorHosts: ['host-remote'], pageSize: 1 }))
    const current = await test.ctx.teams.getTeam({ teamId: test.created.team.id })
    expect(current.team.phase).toBe('stalled')
    expect(current.team.stallReason?.code).toBe('SUPERVISOR_GENERATION_MISMATCH')
    expect(current.activations[0]?.activation.status).toBe('running')
    expect(fence).not.toHaveBeenCalled()
    expect(test.activations).toHaveLength(0)
  })

  it('rejects recovery-stall proofs with another generation or an unrelated reason before policy', async () => {
    const test = await realRecoveryHarness(true)
    const current = await test.ctx.teams.getTeam({ teamId: test.created.team.id })
    const controller = test.ctx.teamActivations as unknown as {
      recoveryStallProofs: Map<TeamSystemPhaseProof, TeamSystemPhaseScope>
    }
    const proofs = controller.recoveryStallProofs
    const policy = vi.fn(async () => ({ kind: 'allow' as const }))
    test.ctx.teams.registerPolicy('close', { name: 'observe-recovery-stall', apply: policy })
    const base = {
      kind: 'activation-controller-recovery-stall' as const, teamId: current.team.id, expectedCursor: current.team.cursor, phase: 'stalled' as const,
      activationId: test.stale.activation.id, participantId: test.worker.id, sessionId: test.stale.sessionId, provider: test.stale.provider,
      supervisor: test.stale.recovery!.supervisor!, reason: { code: 'SUPERVISOR_UNKNOWN', message: 'Execution state is unknown.' },
    }
    for (const scope of [
      { ...base, supervisor: { ...base.supervisor, endpointId: 'foreign-endpoint' } },
      { ...base, participantId: participantIdSchema.parse('foreign-worker') },
    ]) {
      const proof = {} as TeamSystemPhaseProof
      proofs.set(proof, scope)
      await expect(test.ctx.teams.transitionTeamPhase({ actor: proof, teamId: current.team.id, expectedCursor: current.team.cursor, phase: 'stalled', reason: base.reason })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      proofs.delete(proof)
    }
    expect(policy).not.toHaveBeenCalled()
    expect((await test.ctx.teams.getTeam({ teamId: current.team.id })).team.cursor).toBe(current.team.cursor)
  })

  it('recovers only matching latest unfinished epochs, one at a time', async () => {
    const teamId = teamIdSchema.parse('team-startup-recovery')
    const alpha = participant(teamId, 'participant-recovery-alpha')
    const beta = participant(teamId, 'participant-recovery-beta')
    const active = state('team-startup-recovery', 'active', [alpha, beta], [
      binding(teamId, alpha, 'activation-recovery-retired', { quiesced: true }),
      binding(teamId, alpha, 'activation-recovery-alpha'),
      binding(teamId, beta, 'activation-recovery-beta', { status: 'offline' }),
    ])
    const completed = state('team-startup-completed', 'completed', [], [])
    const stale = state('team-startup-stale', 'completed', [], [])
    const test = harness([
      active.team,
      completed.team,
      { ...stale.team, phase: 'active' },
    ], [active, completed, stale])
    let activeCalls = 0
    let maximumCalls = 0
    test.coldReplace.mockImplementation(async () => {
      activeCalls += 1
      maximumCalls = Math.max(maximumCalls, activeCalls)
      await Promise.resolve()
      activeCalls -= 1
    })

    await test.mount()

    expect(TeamActivationRecovery).toMatchObject({
      name: 'team-activation-recovery',
      inject: ['teams', 'teamActivations'],
    })
    expect('default' in TeamActivationRecovery).toBe(false)
    expect(test.getTeam).toHaveBeenCalledTimes(4)
    expect(test.getTeam).toHaveBeenNthCalledWith(1, { teamId: active.team.id })
    expect(test.getTeam).toHaveBeenNthCalledWith(2, { teamId: active.team.id })
    expect(test.getTeam).toHaveBeenNthCalledWith(3, { teamId: active.team.id })
    expect(test.getTeam).toHaveBeenNthCalledWith(4, { teamId: stale.team.id })
    expect(test.coldReplace).toHaveBeenCalledTimes(2)
    const [first, second] = test.coldReplace.mock.calls.map(([request]) => request)
    expect(first).toMatchObject({
      teamId: active.team.id,
      participantId: alpha.id,
      activationId: activationIdSchema.parse('activation-recovery-alpha'),
    })
    expect(second).toMatchObject({
      teamId: active.team.id,
      participantId: beta.id,
      activationId: activationIdSchema.parse('activation-recovery-beta'),
    })
    expect(first?.signal).toBeInstanceOf(AbortSignal)
    expect(second?.signal).toBeInstanceOf(AbortSignal)
    expect(maximumCalls).toBe(1)
  })

  it('ignores plans outside the configured host/profile and completed epochs', async () => {
    const teamId = teamIdSchema.parse('team-startup-filtered')
    const noPlan = participant(teamId, 'participant-recovery-none')
    const otherProvider = participant(teamId, 'participant-recovery-provider')
    const otherProfile = participant(teamId, 'participant-recovery-profile')
    const otherHost = participant(teamId, 'participant-recovery-host')
    const quiesced = participant(teamId, 'participant-recovery-quiesced')
    const inactive = participant(teamId, 'participant-recovery-inactive', { phase: 'left' })
    const human = participant(teamId, 'participant-recovery-human', { kind: 'human' })
    const active = state('team-startup-filtered', 'active', [
      noPlan, otherProvider, otherProfile, otherHost, quiesced, inactive, human,
    ], [
      binding(teamId, noPlan, 'activation-recovery-none', { recovery: false }),
      binding(teamId, otherProvider, 'activation-recovery-provider', { provider: 'other-sdk' }),
      binding(teamId, otherProfile, 'activation-recovery-profile', { profile: 'other-profile' }),
      binding(teamId, otherHost, 'activation-recovery-host', { hostId: 'other-host' }),
      binding(teamId, quiesced, 'activation-recovery-quiesced', { quiesced: true }),
      binding(teamId, inactive, 'activation-recovery-inactive'),
      binding(teamId, human, 'activation-recovery-human'),
    ])
    const test = harness([active.team], [active])

    await test.mount()

    expect(test.coldReplace).not.toHaveBeenCalled()
  })

  it('selects the explicitly configured ACP recovery kind without treating it as an SDK epoch', async () => {
    const teamId = teamIdSchema.parse('team-startup-acp-kind')
    const worker = participant(teamId, 'participant-recovery-acp-kind')
    const active = state('team-startup-acp-kind', 'active', [worker], [
      binding(teamId, worker, 'activation-recovery-acp-kind', {
        provider: 'acp', kind: 'acp-local-cold-replace', profile: 'local-acp',
      }),
    ])
    const test = harness([active.team], [active])

    await test.mount(config({ provider: 'acp', kind: 'acp-local-cold-replace', profile: 'local-acp' }))

    expect(test.coldReplace).toHaveBeenCalledWith(expect.objectContaining({
      activationId: activationIdSchema.parse('activation-recovery-acp-kind'),
    }))
  })

  it('retries wake cleanup without replacing a quiesced epoch', async () => {
    const teamId = teamIdSchema.parse('team-startup-wake-retry')
    const worker = participant(teamId, 'participant-recovery-wake-retry')
    const active = state('team-startup-wake-retry', 'active', [worker], [
      binding(teamId, worker, 'activation-recovery-wake-retry', {
        quiesced: true,
        quiescedWakeCleanup: true,
      }),
    ])
    const test = harness([active.team], [active], new Map([
      ['wake-activation-recovery-wake-retry', 'active'],
    ]))

    await test.mount()

    expect(test.quiesceActivation).toHaveBeenCalledWith(expect.objectContaining({
      activationId: activationIdSchema.parse('activation-recovery-wake-retry'),
    }))
    const request = test.quiesceActivation.mock.calls[0]?.[0]
    const source = test.activationProofSources.get('team-activation-recovery')
    expect(source).toBeDefined()
    expect(request?.actor).toBeDefined()
    expect(() => JSON.stringify(request?.actor)).toThrow(/runtime-only/u)
    expect(source?.resolveActivationProof(request?.actor as never)).toBeUndefined()
    expect(test.coldReplace).not.toHaveBeenCalled()
  })

  it('removes its activation proof source when the recovery plugin fiber tears down', async () => {
    const test = harness([], [])
    const fiber = await test.mount()
    expect(test.activationProofSources.has('team-activation-recovery')).toBe(true)
    await fiber.dispose()
    expect(test.activationProofSources.has('team-activation-recovery')).toBe(false)
  })

  it('skips a quiesced epoch once its recorded wake channel is terminal', async () => {
    const teamId = teamIdSchema.parse('team-startup-wake-terminal')
    const worker = participant(teamId, 'participant-recovery-wake-terminal')
    const active = state('team-startup-wake-terminal', 'active', [worker], [
      binding(teamId, worker, 'activation-recovery-wake-terminal', {
        quiesced: true,
        quiescedWakeCleanup: true,
      }),
    ])
    const test = harness([active.team], [active], new Map([
      ['wake-activation-recovery-wake-terminal', 'closed'],
    ]))

    await test.mount()

    expect(test.quiesceActivation).not.toHaveBeenCalled()
    expect(test.coldReplace).not.toHaveBeenCalled()
  })

  it('cold-replaces a fenced epoch after its wake cleanup was interrupted', async () => {
    const teamId = teamIdSchema.parse('team-startup-fenced-wake')
    const worker = participant(teamId, 'participant-recovery-fenced-wake')
    const active = state('team-startup-fenced-wake', 'active', [worker], [
      binding(teamId, worker, 'activation-recovery-fenced-wake', {
        quiesced: true,
        quiescenceSource: 'fenced',
        quiescedWakeCleanup: true,
      }),
    ])
    const test = harness([active.team], [active], new Map([
      ['wake-activation-recovery-fenced-wake', 'active'],
    ]))

    await test.mount()

    expect(test.coldReplace).toHaveBeenCalledWith(expect.objectContaining({
      activationId: activationIdSchema.parse('activation-recovery-fenced-wake'),
    }))
    expect(test.quiesceActivation).not.toHaveBeenCalled()
  })

  it('skips a candidate superseded between the initial and current Team reads', async () => {
    const teamId = teamIdSchema.parse('team-startup-superseded')
    const worker = participant(teamId, 'participant-recovery-superseded')
    const predecessor = binding(teamId, worker, 'activation-recovery-superseded')
    const initial = state('team-startup-superseded', 'active', [worker], [predecessor])
    const successor = binding(teamId, worker, 'activation-recovery-superseded-next', { status: 'idle' })
    const current = state('team-startup-superseded', 'active', [worker], [
      { ...predecessor, activation: { ...predecessor.activation, status: 'offline' } },
      successor,
    ])
    const test = harness([initial.team], [initial])
    test.getTeam.mockResolvedValueOnce(initial).mockResolvedValueOnce(current)

    await test.mount()

    expect(test.coldReplace).not.toHaveBeenCalled()
    expect(test.quiesceActivation).not.toHaveBeenCalled()
  })

  it('abandons a candidate when the current Team is inactive or its binding disappeared', async () => {
    const teamId = teamIdSchema.parse('team-startup-current-state-fence')
    const first = participant(teamId, 'participant-recovery-current-inactive')
    const second = participant(teamId, 'participant-recovery-current-missing')
    const firstBinding = binding(teamId, first, 'activation-recovery-current-inactive')
    const secondBinding = binding(teamId, second, 'activation-recovery-current-missing')
    const initial = state('team-startup-current-state-fence', 'active', [first, second], [firstBinding, secondBinding])
    const inactive = state('team-startup-current-state-fence', 'completed', [first, second], [firstBinding, secondBinding])
    const missing = state('team-startup-current-state-fence', 'active', [first, second], [])
    const test = harness([initial.team], [initial])
    test.getTeam
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(inactive)
      .mockResolvedValueOnce(missing)

    await test.mount()

    expect(test.getTeam).toHaveBeenCalledTimes(3)
    expect(test.coldReplace).not.toHaveBeenCalled()
    expect(test.quiesceActivation).not.toHaveBeenCalled()
  })

  it('uses a fresh Team cursor when cleanup follows another participant replacement', async () => {
    const teamId = teamIdSchema.parse('team-startup-mixed-recovery')
    const stale = participant(teamId, 'participant-recovery-mixed-stale')
    const quiesced = participant(teamId, 'participant-recovery-mixed-quiesced')
    const active = state('team-startup-mixed-recovery', 'active', [stale, quiesced], [
      binding(teamId, stale, 'activation-recovery-mixed-stale'),
      binding(teamId, quiesced, 'activation-recovery-mixed-quiesced', {
        quiesced: true,
        quiescedWakeCleanup: true,
      }),
    ])
    const test = harness([active.team], [active], new Map([
      ['wake-activation-recovery-mixed-quiesced', 'active'],
    ]))
    test.coldReplace.mockImplementation(async () => {
      test.replaceState({
        ...active,
        team: { ...active.team, cursor: active.team.cursor + 1 },
      })
    })

    await test.mount()

    expect(test.coldReplace).toHaveBeenCalledWith(expect.objectContaining({
      activationId: activationIdSchema.parse('activation-recovery-mixed-stale'),
    }))
    expect(test.quiesceActivation).toHaveBeenCalledWith(expect.objectContaining({
      activationId: activationIdSchema.parse('activation-recovery-mixed-quiesced'),
      expectedCursor: active.team.cursor + 1,
    }))
  })

  it('rejects invalid deployment identities before scanning', async () => {
    const test = harness([], [])

    await expect(test.mount(config({ provider: ' ' }))).rejects.toThrow(
      'team-activation-recovery: provider must be non-empty without surrounding whitespace',
    )
    await expect(test.mount(config({ profile: ' local-sdk' }))).rejects.toThrow(
      'team-activation-recovery: profile must be non-empty without surrounding whitespace',
    )
    await expect(test.mount(config({ hostId: ' host-local' }))).rejects.toThrow(
      'team-activation-recovery: hostId must be non-empty without surrounding whitespace',
    )
    expect(test.listTeams).not.toHaveBeenCalled()
  })

  it('rejects invalid recurring intervals before registering recovery state', async () => {
    const test = harness([], [])

    await expect(TeamActivationRecovery.apply(test.ctx, config({ pulseIntervalMs: 0 }))).rejects.toThrow(
      'team-activation-recovery: pulseIntervalMs must be a positive safe integer',
    )
    await expect(TeamActivationRecovery.apply(test.ctx, config({ pulseIntervalMs: Number.MAX_SAFE_INTEGER + 1 }))).rejects.toThrow(
      'team-activation-recovery: pulseIntervalMs must be a positive safe integer',
    )
    expect(test.registerSystemActivationProofSource).not.toHaveBeenCalled()
  })

  it('single-flights a recurring scan and retains accepted wake cleanup until disposal settles', async () => {
    vi.useFakeTimers()
    try {
      const teamId = teamIdSchema.parse('team-startup-pulse-disposal')
      const worker = participant(teamId, 'participant-recovery-pulse-disposal')
      const initial = state('team-startup-pulse-disposal', 'active', [worker], [])
      const recoverable = state('team-startup-pulse-disposal', 'active', [worker], [
        binding(teamId, worker, 'activation-recovery-pulse-disposal', {
          quiesced: true,
          quiescedWakeCleanup: true,
        }),
      ])
      const test = harness([initial.team], [initial], new Map([
        ['wake-activation-recovery-pulse-disposal', 'active'],
      ]))
      const channelStarted = Promise.withResolvers<undefined>()
      const channelRelease = Promise.withResolvers<undefined>()
      test.getChannel.mockImplementation(async () => {
        channelStarted.resolve(undefined)
        await channelRelease.promise
        return { phase: 'active' }
      })
      const warn = vi.spyOn(test.ctx.logger, 'warn').mockImplementation(() => undefined)
      const fiber = await test.mount(config({ pulseIntervalMs: 10 }))
      test.replaceState(recoverable)

      await vi.advanceTimersByTimeAsync(10)
      await channelStarted.promise
      expect(test.getChannel).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(10)
      expect(test.getChannel).toHaveBeenCalledOnce()

      const disposal = fiber.dispose()
      channelRelease.resolve(undefined)
      await disposal
      await vi.advanceTimersByTimeAsync(0)
      expect(test.quiesceActivation).toHaveBeenCalledOnce()
      expect(warn).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not reread a Team after a recovery scan is cancelled during cold replacement', async () => {
    vi.useFakeTimers()
    try {
      const teamId = teamIdSchema.parse('team-startup-cancelled-recovery')
      const worker = participant(teamId, 'participant-recovery-cancelled')
      const initial = state('team-startup-cancelled-recovery', 'active', [worker], [])
      const recoverable = state('team-startup-cancelled-recovery', 'active', [worker], [
        binding(teamId, worker, 'activation-recovery-cancelled'),
      ])
      const test = harness([initial.team], [initial])
      const entered = Promise.withResolvers<undefined>()
      test.coldReplace.mockImplementation(async ({ signal }) => {
        entered.resolve(undefined)
        await new Promise<void>((_, reject) => {
          const reason = (): Error => signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason))
          if (signal.aborted) { reject(reason()); return }
          signal.addEventListener('abort', () => { reject(reason()) }, { once: true })
        })
      })
      const fiber = await test.mount(config({ pulseIntervalMs: 10 }))
      test.replaceState(recoverable)
      await vi.advanceTimersByTimeAsync(10)
      await entered.promise
      const readsBeforeDisposal = test.getTeam.mock.calls.length

      await fiber.dispose()
      expect(test.getTeam).toHaveBeenCalledTimes(readsBeforeDisposal)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops processing later recovery candidates after the scan signal is cancelled', async () => {
    vi.useFakeTimers()
    try {
      const teamId = teamIdSchema.parse('team-startup-cancelled-candidates')
      const first = participant(teamId, 'participant-recovery-cancelled-first')
      const second = participant(teamId, 'participant-recovery-cancelled-second')
      const initial = state('team-startup-cancelled-candidates', 'active', [first, second], [])
      const recoverable = state('team-startup-cancelled-candidates', 'active', [first, second], [
        binding(teamId, first, 'activation-recovery-cancelled-first'),
        binding(teamId, second, 'activation-recovery-cancelled-second'),
      ])
      const test = harness([initial.team], [initial])
      const calls: string[] = []
      const fiberRef: { value?: Awaited<ReturnType<typeof test.mount>> } = {}
      test.coldReplace.mockImplementation(async ({ participantId }) => {
        calls.push(String(participantId))
        if (calls.length === 1) void fiberRef.value?.dispose()
      })
      fiberRef.value = await test.mount(config({ pulseIntervalMs: 10 }))
      test.replaceState(recoverable)
      await vi.advanceTimersByTimeAsync(10)
      await vi.waitFor(() => { expect(calls).toHaveLength(1) })
      await fiberRef.value?.dispose()
      expect(calls).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes and unregisters a proof issuer after startup wake cleanup fails', async () => {
    const teamId = teamIdSchema.parse('team-startup-proof-close')
    const worker = participant(teamId, 'participant-recovery-proof-close')
    const active = state('team-startup-proof-close', 'active', [worker], [
      binding(teamId, worker, 'activation-recovery-proof-close', {
        quiesced: true,
        quiescedWakeCleanup: true,
      }),
    ])
    const test = harness([active.team], [active], new Map([
      ['wake-activation-recovery-proof-close', 'active'],
    ]))
    let proof: TeamSystemActivationProof | undefined
    test.quiesceActivation.mockImplementation(async ({ actor }) => {
      proof = actor
      throw new Error('startup wake cleanup failed')
    })

    await expect(test.mount()).rejects.toThrow('startup wake cleanup failed')

    const source = test.registerSystemActivationProofSource.mock.calls[0]?.[0]
    if (source === undefined || proof === undefined) throw new Error('startup proof was not issued')
    expect(source.resolveActivationProof(proof)).toBeUndefined()
    expect(test.activationProofSources.has('team-activation-recovery')).toBe(false)
  })

  it('propagates a controller or fencer failure and does not continue the scan', async () => {
    const teamId = teamIdSchema.parse('team-startup-failure')
    const first = participant(teamId, 'participant-recovery-failure-first')
    const second = participant(teamId, 'participant-recovery-failure-second')
    const active = state('team-startup-failure', 'active', [first, second], [
      binding(teamId, first, 'activation-recovery-failure-first'),
      binding(teamId, second, 'activation-recovery-failure-second'),
    ])
    const test = harness([active.team], [active])
    test.coldReplace.mockRejectedValue(new Error('exact stale process could not be fenced'))

    await expect(test.mount()).rejects.toThrow('exact stale process could not be fenced')
    expect(test.coldReplace).toHaveBeenCalledOnce()
    expect(test.coldReplace).toHaveBeenCalledWith(expect.objectContaining({
      activationId: activationIdSchema.parse('activation-recovery-failure-first'),
    }))
  })

  it('continues to later Teams after a local named recovery stall is durably recorded', async () => {
    const firstTeamId = teamIdSchema.parse('team-startup-local-stall-first')
    const secondTeamId = teamIdSchema.parse('team-startup-local-stall-second')
    const firstWorker = participant(firstTeamId, 'participant-local-stall-first')
    const secondWorker = participant(secondTeamId, 'participant-local-stall-second')
    const first = state(firstTeamId, 'active', [firstWorker], [
      binding(firstTeamId, firstWorker, 'activation-local-stall-first'),
    ])
    const second = state(secondTeamId, 'active', [secondWorker], [
      binding(secondTeamId, secondWorker, 'activation-local-stall-second'),
    ])
    const test = harness([first.team, second.team], [first, second])
    test.coldReplace.mockImplementationOnce(async (request) => {
      const current = await test.getTeam({ teamId: request.teamId })
      test.replaceState({
        ...current,
        team: {
          ...current.team,
          phase: 'stalled',
          cursor: current.team.cursor + 1,
          updatedAt: current.team.updatedAt + 1,
          stallReason: { code: 'AGENT_RUNTIME_FENCE_FAILED', message: 'The local fencer could not prove termination.' },
        },
      })
      throw new TeamError('local fence failed', 'TEAM_ACTIVATION_FENCE_FAILED')
    })

    await test.mount()

    expect(test.coldReplace).toHaveBeenCalledTimes(2)
    expect(test.coldReplace.mock.calls[0]?.[0].teamId).toBe(firstTeamId)
    expect(test.coldReplace.mock.calls[1]?.[0].teamId).toBe(secondTeamId)
  })

  it('uses the real Hub and controller to fence and replace one stale SDK binding', async () => {
    const test = await realRecoveryHarness()

    await test.ctx.plugin(TeamActivationRecovery, config())

    expect(test.fences).toHaveLength(1)
    expect(test.fences[0]?.activation.id).toBe(test.stale.activation.id)
    expect(test.activations).toHaveLength(1)
    expect(test.activations[0]).toMatchObject({
      provider: 'sdk',
      teamId: test.created.team.id,
      participant: { id: test.worker.id },
      sessionId: test.stale.sessionId,
      seed: { kind: 'resume' },
      agent: { options: { provider: 'mock', model: 'mock' } },
    })
    const state = await test.ctx.teams.getTeam({ teamId: test.created.team.id })
    const stale = state.activations.find(binding => binding.activation.id === test.stale.activation.id)
    const replacement = state.activations.find(
      binding => binding.activation.id === activationIdSchema.parse('activation-startup-recovery-replacement'),
    )
    if (stale === undefined || replacement === undefined) throw new Error('real recovery did not retain both activation epochs')
    expect(stale.activation.status).toBe('offline')
    expect(stale.quiescedAt).toEqual(expect.any(Number))
    expect(stale.quiescenceSource).toBe('fenced')
    expect(stale.quiescedWakeChannelIds).toEqual([])
    expect(replacement.activation.status).toBe('idle')
    expect(replacement.sessionId).toBe(test.stale.sessionId)
  })

  it('replaces a fenced epoch after restart completes interrupted wake cleanup', async () => {
    const first = await realRecoveryHarness()
    first.ctx.teams.registerAdapter(wakeAdapter)
    const coordinatorActor = await coordinatorTaskActor(first.ctx, first.created.team.id)
    let state = await first.ctx.teams.getTeam({ teamId: first.created.team.id })
    const wake = await openTestChannel(first.ctx, {
      teamId: first.created.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: 'recovery-wake', version: 1 },
      participants: [{ id: first.worker.id, role: 'assignee' }],
      limits: {},
    })
    const endpoint = first.ctx.teams.openActivationActorProofIssuer().issue(first.stale)
    await consentChannelEndpoints(first.ctx, wake, [{ participantId: first.worker.id, actor: endpoint.proof }], (manifest) => {
      wakeAdapter.validateCreate(manifest)
    })
    endpoint.revoke()
    state = await first.ctx.teams.getTeam({ teamId: first.created.team.id })
    const task = await first.ctx.teams.createTask({
      actor: coordinatorActor,
      teamId: first.created.team.id,
      expectedCursor: state.team.cursor,
      createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('startup-recovery-wake-task') },
      subject: 'Recover interrupted wake cleanup',
      description: 'The replacement must not reuse this wake channel.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
    })
    state = await first.ctx.teams.getTeam({ teamId: first.created.team.id })
    await assignSchedulerTask(first.ctx, {
      teamId: first.created.team.id,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: first.worker.id,
      activationId: first.stale.activation.id,
      wakeChannelId: wake.manifest.id,
      leaseDurationMs: 10_000,
    })
    const denyClose: TeamPolicy = {
      name: 'deny-recovery-wake-close',
      async apply() { return { kind: 'deny', code: 'test-denied', message: 'simulate Hub shutdown during wake cleanup' } },
    }
    const unregisterDeny = first.ctx.teams.registerPolicy('close', denyClose)
    state = await first.ctx.teams.getTeam({ teamId: first.created.team.id })
    const fenceInput = {
      teamId: first.created.team.id,
      activationId: first.stale.activation.id,
      participantId: first.worker.id,
      sessionId: first.stale.sessionId,
      provider: 'sdk',
      expectedCursor: state.team.cursor,
    }
    await expect(withControllerActivationProof(first.ctx, {
      kind: 'activation-controller-fence',
      ...fenceInput,
    }, async actor => await first.ctx.teams.fenceActivation({ actor, ...fenceInput })))
      .rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    unregisterDeny()
    state = await first.ctx.teams.getTeam({ teamId: first.created.team.id })
    expect(state.activations.find(binding => binding.activation.id === first.stale.activation.id))
      .toMatchObject({ quiescenceSource: 'fenced', quiescedWakeChannelIds: [wake.manifest.id] })

    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)
    const restarted = await realRecoveryContext(first.root)
    restarted.ctx.teams.registerAdapter(wakeAdapter)
    await restarted.ctx.plugin(TeamActivationRecovery, config())

    state = await restarted.ctx.teams.getTeam({ teamId: first.created.team.id })
    expect(restarted.fences).toEqual([])
    expect(restarted.activations).toHaveLength(1)
    expect(state.activations.find(binding => binding.activation.id === first.stale.activation.id))
      .toMatchObject({ quiescenceSource: 'fenced' })
    expect(state.activations.find(binding => binding.activation.id === activationIdSchema.parse('activation-startup-recovery-replacement')))
      .toMatchObject({ sessionId: first.stale.sessionId })
    expect((await restarted.ctx.teams.getChannel({ channelId: wake.manifest.id })).phase).toBe('closed')
  })
})
