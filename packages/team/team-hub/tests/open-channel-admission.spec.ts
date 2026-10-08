import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import { channelOpenInputSchema, jsonObjectSchema, teamWorkflowPlanIdempotencyKeySchema, teamWorkflowPlanSchema } from '@clocky/clocky-team'
import type { ChannelOpenInput, ChannelOpenRequest, ParticipantId, TeamSystemWorkflowProof, TeamSystemWorkflowScope,
  TeamSystemTopologyProof, TeamSystemTopologyScope, TeamSystemChannelLifecycleProof, TeamSystemChannelLifecycleScope,
  TeamWorkflowPlanSnapshot } from '@clocky/clocky-team'
import { directChannelAdapter, directChannelV4Adapter, DIRECT_CHANNEL_ADAPTER_V4,
  DIRECTED_VIEW_POLICY, FULL_TRANSCRIPT_VIEW_POLICY } from '../../team-channel-direct/src/index.ts'
import { consultChannelAdapter } from '../../team-channel-basic/src/index.ts'
import { workflowChannelAdapter } from '../../team-channel-workflow/src/index.ts'
import { createTestChildTeam, createTestRootTeam, inviteBootstrapParticipant,
  transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import TeamHub from '../src/index.ts'
import { postActor } from './fixtures.ts'
import { delegationFixture } from './delegation-fixtures.ts'

type Backend = 'json' | 'sqlite'
const roots: string[] = []
const contexts = new Set<Context>()

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function hub(backend: Backend, root: string, maxChannelsPerTeam: number) {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TeamHub, { maxChannelsPerTeam, maxTeamDepth: 2, maxEnvelopeBytes: 4096 })
  ctx.teams.registerAdapter(directChannelAdapter)
  ctx.teams.registerAdapter(directChannelV4Adapter)
  ctx.teams.registerAdapter(workflowChannelAdapter)
  ctx.teams.registerViewPolicy(DIRECTED_VIEW_POLICY)
  return ctx
}

async function dispose(ctx: Context) {
  await ctx.fiber.dispose()
  contexts.delete(ctx)
}

/** Create actual participant and activation records before any workflow authority is issued. */
async function seed(backend: Backend) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'open-channel-admission-'))
  roots.push(root)
  const ctx = await hub(backend, root, 1)
  const created = await createTestRootTeam(ctx, {
    goal: { objective: 'Admit channels with exact workflow and capacity authority.', budgets: {} }, rules: {}, budgets: {},
  })
  const teamId = created.team.id
  const members: ParticipantId[] = []
  for (const role of ['coordinator', 'worker']) {
    const member = await inviteBootstrapParticipant(ctx, {
      teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      kind: 'local-agent', displayName: role, role, capabilities: [],
    })
    for (const phase of ['provisioning', 'active'] as const) {
      await transitionBootstrapParticipant(ctx, { teamId, participantId: member.id,
        expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, phase })
    }
    members.push(member.id)
  }
  const [coordinator, worker] = members
  if (coordinator === undefined || worker === undefined) throw new Error('Workflow admission requires coordinator and worker')
  const author = await postActor(ctx, teamId, coordinator)
  return { ctx, root, teamId, author, coordinator, worker }
}

/** Supply a bounded declarative plan with real roles but no scheduled task execution. */
async function planFor(fixture: Awaited<ReturnType<typeof seed>>) {
  const plan = teamWorkflowPlanSchema.parse({
    name: 'Channel admission plan', version: 1,
    tasks: [{ id: 'first', subject: 'First', description: 'Run the admitted work.', blockedBy: [], requiredCapabilities: [],
      priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 }],
    bounds: { maxTasks: 1, maxParallelism: 1, maxTotalAttempts: 1 },
    channel: { participantRoles: ['coordinator', 'worker'], viewPolicy: { type: 'directed', version: 1 },
      graph: { initial: { kind: 'participant', role: 'coordinator' },
        transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 1 } },
    result: { kind: 'task-results', taskTemplateIds: ['first'] },
  })
  return await fixture.ctx.teams.admitWorkflowPlan({ actor: fixture.author, teamId: fixture.teamId,
    expectedCursor: (await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).team.cursor,
    idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('channel-admission-plan'), plan })
}

/** Keep the runtime proof separate from the serialized, parsed channel-opening input. */
async function inputFor(
  fixture: Awaited<ReturnType<typeof seed>>, plan: TeamWorkflowPlanSnapshot, overrides: Partial<ChannelOpenInput> = {},
) {
  const input = channelOpenInputSchema.parse(JSON.parse(JSON.stringify({
    teamId: fixture.teamId, expectedCursor: (await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).team.cursor,
    adapter: { type: 'workflow', version: 1 }, viewPolicy: { type: 'directed', version: 1 },
    workflowPlanId: plan.id, expectedPlanRevision: plan.revision,
    participants: [{ id: fixture.coordinator, role: 'coordinator' }, { id: fixture.worker, role: 'worker' }],
    limits: { graph: { initial: { kind: 'participant', participantId: fixture.coordinator },
      transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 1 } },
    ...overrides,
  })))
  return { ...input, workflowPlanId: plan.id, expectedPlanRevision: plan.revision }
}

/** Register only the current TeamRun workflow source and retain an exact scope for one public command. */
async function withWorkflow<T>(
  ctx: Context, scope: TeamSystemWorkflowScope, run: (actor: TeamSystemWorkflowProof) => Promise<T>,
): Promise<T> {
  const token: object = {}
  Object.defineProperty(token, 'toJSON', { value: (): never => { throw new TypeError('Workflow proof is runtime-only') } })
  const proof = Object.freeze(token) as TeamSystemWorkflowProof
  const retained = structuredClone(scope)
  const unregister = ctx.teams.registerSystemWorkflowProofSource({ name: 'team-run',
    resolveWorkflowProof: candidate => candidate === proof ? retained : undefined })
  try { return await run(proof) }
  finally { unregister() }
}

async function openWorkflow(ctx: Context, plan: TeamWorkflowPlanSnapshot, input: Awaited<ReturnType<typeof inputFor>>) {
  if (plan.actor === undefined) throw new Error('Workflow admission requires its durable author')
  return await withWorkflow(ctx, { kind: 'team-run-workflow-channel-open', teamId: input.teamId,
    coordinator: plan.actor, planId: plan.id, expectedCursor: input.expectedCursor, expectedRevision: plan.revision,
    adapter: input.adapter, viewPolicy: input.viewPolicy, participants: input.participants, limits: input.limits },
  async actor => await ctx.teams.openChannel({ actor, ...input }))
}

describe('workflow channel and frozen capacity admission', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`rejects a child-result channel proof when its Team has no parent reservation on ${backend}`, async () => {
      const fixture = await seed(backend)
      fixture.ctx.teams.registerAdapter(consultChannelAdapter)
      fixture.ctx.teams.registerViewPolicy(FULL_TRANSCRIPT_VIEW_POLICY)
      const before = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
      const input = { teamId: fixture.teamId, expectedCursor: before.team.cursor,
        adapter: { type: 'consult' as const, version: 1 as const },
        viewPolicy: { type: 'full-transcript' as const, version: 1 as const },
        participants: [{ id: fixture.coordinator, role: 'initiator' }, { id: fixture.worker, role: 'respondent' }], limits: {} }
      const scope: TeamSystemChannelLifecycleScope = { kind: 'channel-open', ...input }
      const proof = Object.freeze({}) as TeamSystemChannelLifecycleProof
      const unregister = fixture.ctx.teams.registerSystemChannelLifecycleProofSource({ name: 'team-run-child',
        resolveChannelLifecycleProof: candidate => candidate === proof ? scope : undefined })
      try {
        await expect(fixture.ctx.teams.openChannel({ actor: proof, authorityKind: 'channel-lifecycle', ...input }))
          .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
        expect(await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).toEqual(before)
      } finally { unregister() }
    })
    it(`opens a child result consult channel only under its live delegated parent on ${backend}`, async () => {
      await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
      const root = await mkdtemp(join(process.cwd(), '.tmp', 'child-open-admission-'))
      roots.push(root)
      const ctx = await hub(backend, root, 2)
      ctx.teams.registerAdapter(consultChannelAdapter)
      ctx.teams.registerViewPolicy(FULL_TRANSCRIPT_VIEW_POLICY)
      const delegation = await delegationFixture(ctx, root)
      const child = await createTestChildTeam(ctx, delegation.creation)
      const members: ParticipantId[] = []
      for (const [kind, role] of [['service', 'parent-service'], ['local-agent', 'coordinator']] as const) {
        const member = await inviteBootstrapParticipant(ctx, { teamId: child.team.id,
          expectedCursor: (await ctx.teams.getTeam({ teamId: child.team.id })).team.cursor,
          kind, role, displayName: role, capabilities: [] })
        for (const phase of ['provisioning', 'active'] as const) {
          await transitionBootstrapParticipant(ctx, { teamId: child.team.id, participantId: member.id,
            expectedCursor: (await ctx.teams.getTeam({ teamId: child.team.id })).team.cursor, phase })
        }
        members.push(member.id)
      }
      const [serviceId, coordinatorId] = members
      if (serviceId === undefined || coordinatorId === undefined) throw new Error('Child result endpoints are missing')
      const input = { teamId: child.team.id, expectedCursor: (await ctx.teams.getTeam({ teamId: child.team.id })).team.cursor,
        adapter: { type: 'consult' as const, version: 1 as const },
        viewPolicy: { type: 'full-transcript' as const, version: 1 as const },
        participants: [{ id: serviceId, role: 'initiator' }, { id: coordinatorId, role: 'respondent' }], limits: {} }
      const scope: TeamSystemChannelLifecycleScope = { kind: 'channel-open', ...input }
      const proof = Object.freeze({}) as TeamSystemChannelLifecycleProof
      const unregister = ctx.teams.registerSystemChannelLifecycleProofSource({ name: 'team-run-child',
        resolveChannelLifecycleProof: candidate => candidate === proof ? scope : undefined })
      try {
        const opened = await ctx.teams.openChannel({ actor: proof, authorityKind: 'channel-lifecycle', ...input })
        expect(opened).toMatchObject({ phase: 'pending', manifest: { adapter: input.adapter,
          participants: input.participants } })
        expect((await ctx.teams.getTeam({ teamId: child.team.id })).channelIds).toContain(opened.manifest.id)
      } finally { unregister() }
    })
    it(`opens the exact TeamRun human/coordinator bootstrap channel through its topology proof on ${backend}`, async () => {
      await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
      const root = await mkdtemp(join(process.cwd(), '.tmp', 'topology-channel-admission-'))
      roots.push(root)
      const ctx = await hub(backend, root, 2)
      const created = await createTestRootTeam(ctx, { goal: { objective: 'Open the default human channel.', budgets: {} },
        rules: {}, budgets: {} })
      const teamId = created.team.id
      const scopes = new Map<TeamSystemTopologyProof, TeamSystemTopologyScope>()
      const unregister = ctx.teams.registerSystemTopologyProofSource({ name: 'team-run',
        resolveTopologyProof: candidate => scopes.get(candidate) })
      const authorized = async <T>(scope: TeamSystemTopologyScope,
        operation: (proof: TeamSystemTopologyProof) => Promise<T>): Promise<T> => {
        const proof = Object.freeze({}) as TeamSystemTopologyProof
        scopes.set(proof, scope)
        try { return await operation(proof) }
        finally { scopes.delete(proof) }
      }
      try {
        const members: ParticipantId[] = []
        for (const [kind, role] of [['human', 'human'], ['local-agent', 'coordinator']] as const) {
          const participant = { kind, role, displayName: role, capabilities: [],
            ...(kind === 'human' ? { owner: { kind: 'system' as const } } : {}) }
          const expectedCursor = (await ctx.teams.getTeam({ teamId })).team.cursor
          const member = await authorized({ kind: 'team-run-bootstrap-participant-invite', teamId,
            expectedCursor, participant }, actor => ctx.teams.inviteParticipant({ actor, teamId, expectedCursor, ...participant }))
          for (const phase of ['provisioning', 'active'] as const) {
            const cursor = (await ctx.teams.getTeam({ teamId })).team.cursor
            const selection = { teamId, participantId: member.id, expectedCursor: cursor, phase }
            await authorized({ kind: 'team-run-bootstrap-participant-phase', ...selection,
              expectedPhase: phase === 'provisioning' ? 'invited' : 'provisioning' },
            actor => ctx.teams.transitionParticipantPhase({ actor, ...selection }))
          }
          members.push(member.id)
        }
        const [humanId, coordinatorId] = members
        if (humanId === undefined || coordinatorId === undefined) throw new Error('Topology fixture has no two members')
        const input = { teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
          adapter: DIRECT_CHANNEL_ADAPTER_V4, viewPolicy: { type: 'directed' as const, version: 1 as const },
          participants: [{ id: humanId, role: 'human' }, { id: coordinatorId, role: 'coordinator' }], limits: {} }
        const scope: TeamSystemTopologyScope = { kind: 'team-run-bootstrap-channel-open', ...input, humanId, coordinatorId }
        const opened = await authorized(scope, actor => ctx.teams.openChannel({ actor, ...input }))
        expect(opened).toMatchObject({ phase: 'pending', manifest: { adapter: DIRECT_CHANNEL_ADAPTER_V4,
          participants: input.participants } })
        const attached = await ctx.teams.getTeam({ teamId })
        expect(attached.channelIds).toContain(opened.manifest.id)
        const repeated = { ...input, expectedCursor: attached.team.cursor }
        await expect(authorized({ ...scope, expectedCursor: attached.team.cursor },
          actor => ctx.teams.openChannel({ actor, ...repeated })))
          .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
        expect(await ctx.teams.getTeam({ teamId })).toEqual(attached)
      } finally { unregister() }
    })
    it(`rejects workflow opening with generic lifecycle authority or caller-selected invitations on ${backend}`, async () => {
      const fixture = await seed(backend)
      const plan = await planFor(fixture)
      if (plan.actor === undefined) throw new Error('Workflow admission requires its retained author')
      const input = await inputFor(fixture, plan)
      const scope: TeamSystemWorkflowScope = { kind: 'team-run-workflow-channel-open', teamId: input.teamId,
        coordinator: plan.actor, planId: plan.id, expectedCursor: input.expectedCursor,
        expectedRevision: plan.revision, adapter: input.adapter, viewPolicy: input.viewPolicy,
        participants: input.participants, limits: input.limits }
      const before = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
      const streams = await fixture.ctx.storageLog.list()
      await expect(withWorkflow(fixture.ctx, scope, async actor => await fixture.ctx.teams.openChannel(
        // Exercise the runtime fence against an impossible typed route assembled at an external boundary.
        { actor, authorityKind: 'channel-lifecycle', ...input } as unknown as ChannelOpenRequest,
      ))).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      await expect(withWorkflow(fixture.ctx, scope, async actor => await fixture.ctx.teams.openChannel({
        actor, ...input, invitations: [{ participantId: fixture.worker, required: true }],
      }))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      expect(await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).toEqual(before)
      expect(await fixture.ctx.storageLog.list()).toEqual(streams)
    })
    it(`reuses an unbound workflow channel at capacity and rejects changed retry manifests on ${backend}`, async () => {
      const fixture = await seed(backend)
      const plan = await planFor(fixture)
      const input = await inputFor(fixture, plan)
      const channel = await openWorkflow(fixture.ctx, plan, input)
      const before = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
      const streams = await fixture.ctx.storageLog.list()
      const policy = vi.fn()
      fixture.ctx.teams.registerPolicy('channel-open', { name: 'observe-idempotent-open', async apply(request, next) {
        policy(request)
        return await next()
      } })
      expect(before.team.cursor).toBeGreaterThan(input.expectedCursor)
      expect(await openWorkflow(fixture.ctx, plan, input)).toEqual(channel)
      const changes: Partial<ChannelOpenInput>[] = [
        { adapter: { type: 'direct', version: 1 } }, { adapter: { type: 'workflow', version: 2 } },
        { viewPolicy: undefined }, { participants: [...input.participants].reverse() },
        { limits: { graph: { ...jsonObjectSchema.parse(input.limits.graph), maxTurns: 2 } } },
      ]
      for (const change of changes) {
        await expect(openWorkflow(fixture.ctx, plan, await inputFor(fixture, plan, change)))
          .rejects.toMatchObject({ code: 'TEAM_WORKFLOW_PLAN_IDEMPOTENCY_CONFLICT' })
      }
      expect(policy).not.toHaveBeenCalled()
      expect(await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).toEqual(before)
      expect(await fixture.ctx.storageLog.list()).toEqual(streams)
    })

    it(`reuses the pending workflow invitation after restart without consuming another channel slot on ${backend}`, async () => {
      const fixture = await seed(backend)
      const plan = await planFor(fixture)
      const input = await inputFor(fixture, plan)
      const channel = await openWorkflow(fixture.ctx, plan, input)
      expect(channel.phase).toBe('pending')
      const before = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
      await dispose(fixture.ctx)
      const restarted = await hub(backend, fixture.root, 1)
      expect(await openWorkflow(restarted, plan, input)).toEqual(channel)
      expect(await restarted.teams.getTeam({ teamId: fixture.teamId })).toEqual(before)
    })

    it(`rejects a non-workflow adapter and a failed plan before any channel WAL is opened on ${backend}`, async () => {
      const fixture = await seed(backend)
      const plan = await planFor(fixture)
      const before = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
      const streams = await fixture.ctx.storageLog.list()
      for (const adapter of [{ type: 'direct', version: 1 }, { type: 'workflow', version: 2 }]) {
        await expect(openWorkflow(fixture.ctx, plan, await inputFor(fixture, plan, { adapter })))
          .rejects.toMatchObject({ code: 'TEAM_WORKFLOW_PLAN_INVALID' })
      }
      expect(await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).toEqual(before)
      expect(await fixture.ctx.storageLog.list()).toEqual(streams)
      if (plan.actor === undefined) throw new Error('Plan transition requires its durable author')
      const transition = { teamId: fixture.teamId, planId: plan.id, expectedCursor: before.team.cursor,
        expectedRevision: plan.revision, phase: 'failed' as const, failure: { code: 'COMPILATION_FAILED', message: 'Compilation cannot continue.' } }
      const failed = await withWorkflow(fixture.ctx, { kind: 'team-run-workflow-plan-phase', coordinator: plan.actor, ...transition },
        async actor => await fixture.ctx.teams.transitionWorkflowPlan({ actor, ...transition }))
      const afterFailure = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
      const failedStreams = await fixture.ctx.storageLog.list()
      await expect(openWorkflow(fixture.ctx, failed, await inputFor(fixture, failed)))
        .rejects.toMatchObject({ code: 'TEAM_WORKFLOW_PLAN_INVALID' })
      expect(await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).toEqual(afterFailure)
      expect(await fixture.ctx.storageLog.list()).toEqual(failedStreams)
      expect(afterFailure.channelIds).toEqual([])
    })

    it(`keeps the creation-time channel count limit after recovery under a higher deployment limit on ${backend}`, async () => {
      const fixture = await seed(backend)
      const input = { teamId: fixture.teamId, expectedCursor: (await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).team.cursor,
        adapter: { type: 'direct', version: 1 }, participants: [{ id: fixture.coordinator, role: 'sender' }, { id: fixture.worker, role: 'recipient' }], limits: {} }
      const channel = await openTestChannel(fixture.ctx, input)
      const before = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
      const policy = vi.fn()
      const rejectAtCapacity = async (ctx: Context) => {
        ctx.teams.registerPolicy('channel-open', { name: 'observe-count-limit', async apply(request, next) {
          policy(request)
          return await next()
        } })
        const streams = await ctx.storageLog.list()
        await expect(openTestChannel(ctx, { ...input, expectedCursor: before.team.cursor }))
          .rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
        expect(await ctx.teams.getTeam({ teamId: fixture.teamId })).toEqual(before)
        expect(await ctx.storageLog.list()).toEqual(streams)
      }
      await rejectAtCapacity(fixture.ctx)
      await dispose(fixture.ctx)
      const recovered = await hub(backend, fixture.root, 32)
      await rejectAtCapacity(recovered)
      expect(before.channelIds).toEqual([channel.manifest.id])
      expect(policy).not.toHaveBeenCalled()
    })
  }
})
