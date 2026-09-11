import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import type { AgentRuntimeActivationRequest } from '@clocky/clocky-agent-runtime'
import { SessionId } from '@clocky/clocky-session'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import { activationIdSchema, matchesTaskPlacement, teamTaskCreateIdempotencyKeySchema, teamTaskPlacementSchema } from '@clocky/clocky-team'
import type { ParticipantInviteInput, TeamActorProof, TeamId, TeamTaskPlacement, TeamSystemTaskLeaseProof, TeamSystemTaskLeaseScope } from '@clocky/clocky-team'
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
  workspaceEligible = true,
  workspacePreflight = true,
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
    eligible: async () => workspaceEligible,
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
        onStatus() { return () => {} }, interrupt() {}, async dispose() { stopped = true; disposed.push(request.participant.id) } }
    },
  })
  const team = await createTestRootTeam(ctx, { goal: { objective: 'Task-driven placement', budgets: {} }, rules: {}, budgets: {} })
  const teamId = team.team.id
  async function invite(role: string, capabilities: string[] = ['code']) {
    const state = await ctx.teams.getTeam({ teamId })
    const input: ParticipantInviteInput = { teamId, expectedCursor: state.team.cursor, kind: 'local-agent',
      displayName: role, role, capabilities, provider: 'placement-test', model: 'test/model', preset: 'worker' }
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
  maxActivationsPerDrive: 8, maxCursorRetries: 3 }
  await ctx.plugin(Placement, config)
  return { ctx, teamId, invite, requests, disposed, actor: issued.proof, config }
}

async function createTask(ctx: Context, teamId: TeamId, actor: TeamActorProof, key: string, placement?: TeamTaskPlacement) {
  const state = await ctx.teams.getTeam({ teamId })
  return await ctx.teams.createTask({ actor, teamId, expectedCursor: state.team.cursor,
    createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(key) },
    subject: key, description: key, requiredCapabilities: ['code'], priority: 1, blockedBy: [], readScopes: [], writeScopes: [],
    workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 3,
    ...placement === undefined ? {} : { placement } })
}

describe('task-driven placement', () => {
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
