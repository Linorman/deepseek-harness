/** Frozen budget behavior through a real Hub and the scheduler's own runtime proof sources. @module */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import * as TaskAssignment from '@clocky/clocky-team-channel-task-assignment'
import TeamChannelAdmission from '@clocky/clocky-team-channel-admission'
import TeamWorkspaces from '@clocky/clocky-team-workspace'
import { activationIdSchema, teamUsageSampleIdSchema } from '@clocky/clocky-team'
import type { JsonObject, TeamId, TeamTaskSnapshot } from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { acknowledgeTestChannelActivations } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { assignTestTask, bindTestActivation, createTestCoordinatorTask, provisionTestCoordinator } from '../../team-hub/tests/fixtures.ts'
import { TeamDagScheduler } from '../src/index.ts'

const contexts = new Set<Context>()
const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function setup(
  backend: 'json' | 'sqlite', budgets: JsonObject,
  hubConfig: { maxModelTokensPerTeam?: number; maxRetriesPerTeam?: number; maxWallTimeMsPerTeam?: number } = {},
  schedulerTaskLeases = true,
) {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'scheduler-budget-'))
  roots.push(root)
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'teams.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TeamHub, hubConfig)
  await ctx.plugin(TeamChannelAdmission)
  await ctx.plugin(TaskAssignment)
  await ctx.plugin(TeamWorkspaces)
  const waitUntilActive = ctx.teamChannelAdmission.waitUntilActive.bind(ctx.teamChannelAdmission)
  vi.spyOn(ctx.teamChannelAdmission, 'waitUntilActive').mockImplementation(async (input) => {
    await acknowledgeTestChannelActivations(ctx, input.channelId)
    return await waitUntilActive(input)
  })
  ctx.teamWorkspaces.registerProvider({
    name: 'budget-eligibility', modes: ['shared'], async eligible() { return true },
    async prepare() { throw new Error('budget selection must not allocate a workspace') },
    async restore() { throw new Error('budget selection must not restore a workspace') },
    async reconcileRelease() { throw new Error('budget selection must not release a workspace') },
  })
  const state = await createTestRootTeam(ctx, { goal: { objective: 'Respect frozen scheduling limits.', budgets: {} }, rules: {}, budgets })
  const scheduler = new TeamDagScheduler(ctx, {
    leaseDurationMs: 60_000, maxAssignmentsPerDrive: 1, maxExpirationsPerDrive: 2, maxWakeDispatchesPerDrive: 2,
    maxConflictsPerDrive: 2, maxActiveAttemptsPerParticipant: 1, permittedWorkspaceModes: ['shared'], disposalTimeoutMs: 100,
    stallAfterUnassignableDrives: 3,
  })
  ctx.effect(() => {
    const disposers = [
      ctx.teams.registerSystemEnvelopePostProofSource(scheduler.envelopePostProofSource),
      ctx.teams.registerSystemTaskReviewProofSource(scheduler.taskReviewProofSource),
      ctx.teams.registerSystemPhaseProofSource(scheduler.phaseProofSource),
      ctx.teams.registerSystemMaintenanceProofSource(scheduler.maintenanceProofSource),
      ...schedulerTaskLeases ? [ctx.teams.registerSystemTaskLeaseProofSource(scheduler.taskLeaseProofSource)] : [],
      ctx.teams.registerSystemSchedulerChannelProofSource(scheduler.schedulerChannelProofSource),
    ]
    return async () => {
      try { await scheduler.close() }
      finally { for (const dispose of disposers.reverse()) dispose() }
    }
  })
  return { ctx, scheduler, teamId: state.team.id }
}

async function worker(ctx: Context, teamId: TeamId, name: string) {
  let state = await ctx.teams.getTeam({ teamId })
  const participant = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: state.team.cursor,
    kind: 'local-agent', displayName: name, role: 'worker', capabilities: ['work'] })
  for (const phase of ['provisioning', 'active'] as const) {
    state = await ctx.teams.getTeam({ teamId })
    await transitionBootstrapParticipant(ctx, { teamId, participantId: participant.id, expectedCursor: state.team.cursor, phase })
  }
  state = await ctx.teams.getTeam({ teamId })
  return await bindTestActivation(ctx, { expectedCursor: state.team.cursor, binding: {
    activation: { id: activationIdSchema.parse(`budget-${participant.id}`), teamId, participantId: participant.id, status: 'idle' },
    sessionId: SessionId(`budget-${participant.id}`), provider: 'in-process' } })
}

async function pendingTask(ctx: Context, teamId: TeamId, subject: string, requiredCapabilities: readonly string[] = ['work']) {
  await provisionTestCoordinator(ctx, teamId)
  const state = await ctx.teams.getTeam({ teamId })
  return await createTestCoordinatorTask(ctx, { teamId, expectedCursor: state.team.cursor, subject, description: subject,
    blockedBy: [], requiredCapabilities, priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
    budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 3 })
}

async function settleAttempt(ctx: Context, task: TeamTaskSnapshot, kind: 'released' | 'cancelled') {
  if (task.lease === undefined) throw new Error('budget test requires an assigned lease')
  const state = await ctx.teams.getTeam({ teamId: task.teamId })
  const binding = state.activations.find(candidate => candidate.activation.id === task.lease?.activationId)
  if (binding === undefined) throw new Error('budget test requires the current lease owner')
  const actor = ctx.teams.openActivationActorProofIssuer().issue(binding)
  try {
    return await ctx.teams.settleTaskAttempt({ actor: actor.proof, taskId: task.id, attemptId: task.lease.attemptId,
      expectedRevision: task.revision, outcome: { kind } })
  } finally { actor.revoke() }
}

const consumed = [
  ['maxInputTokens', 'TEAM_INPUT_TOKENS_BUDGET_EXCEEDED'],
  ['maxOutputTokens', 'TEAM_TOKEN_BUDGET_EXCEEDED'],
  ['maxTotalTokens', 'TEAM_TOTAL_TOKENS_BUDGET_EXCEEDED'],
  ['maxTurns', 'TEAM_TURN_BUDGET_EXCEEDED'],
  ['maxCostUnits', 'TEAM_COST_BUDGET_EXCEEDED'],
  ['maxWallTimeMs', 'TEAM_WALL_TIME_BUDGET_EXCEEDED'],
] as const

for (const backend of ['json', 'sqlite'] as const) {
  describe(`scheduler budget boundaries (${backend})`, () => {
    it.each(consumed)('stalls when the admitted %s consumption ceiling is zero', async (key, code) => {
      const f = await setup(backend, { [key]: 0 })
      await f.scheduler.drive({ teamId: f.teamId })
      expect((await f.ctx.teams.getTeam({ teamId: f.teamId })).team).toMatchObject({ phase: 'stalled', stallReason: { code } })
    })

    it.each([0.25, 0.5])('compares a fractional cost ceiling against actual cost %s', async (costUnits) => {
      const f = await setup(backend, { maxCostUnits: 0.5 })
      const actor = await provisionTestCoordinator(f.ctx, f.teamId)
      const state = await f.ctx.teams.getTeam({ teamId: f.teamId })
      await f.ctx.teams.recordUsage({ actor, expectedCursor: state.team.cursor,
        sample: { id: teamUsageSampleIdSchema.parse('fractional-cost'), provider: 'mock', model: 'model',
          turn: 1, step: 1, usage: { inputTokens: 0, outputTokens: 0 }, costUnits } })
      await f.scheduler.drive({ teamId: f.teamId })
      expect((await f.ctx.teams.getTeam({ teamId: f.teamId })).team.phase).toBe(costUnits === 0.5 ? 'stalled' : 'active')
    })

    it('uses the tighter legacy ceiling when the typed output ceiling is larger', async () => {
      const f = await setup(backend, { maxOutputTokens: 20 }, { maxModelTokensPerTeam: 1 })
      const actor = await provisionTestCoordinator(f.ctx, f.teamId)
      const state = await f.ctx.teams.getTeam({ teamId: f.teamId })
      await f.ctx.teams.recordUsage({ actor, expectedCursor: state.team.cursor,
        sample: { id: teamUsageSampleIdSchema.parse('legacy-output'), provider: 'mock', model: 'model',
          turn: 1, step: 1, usage: { inputTokens: 0, outputTokens: 1 } } })
      await f.scheduler.drive({ teamId: f.teamId })
      expect((await f.ctx.teams.getTeam({ teamId: f.teamId })).team).toMatchObject({
        phase: 'stalled', stallReason: { code: 'TEAM_TOKEN_BUDGET_EXCEEDED',
          message: `Team '${f.teamId}' reached its maxOutputTokens budget of 1` } })
    })

    it('keeps admitted work active at concurrency capacity and waits before another assignment', async () => {
      const f = await setup(backend, { maxConcurrency: 1 })
      await worker(f.ctx, f.teamId, 'First worker')
      await worker(f.ctx, f.teamId, 'Second worker')
      const first = await pendingTask(f.ctx, f.teamId, 'First task')
      const second = await pendingTask(f.ctx, f.teamId, 'Second task')
      await f.scheduler.drive({ teamId: f.teamId })
      const state = await f.ctx.teams.getTeam({ teamId: f.teamId })
      expect(state.team.phase).toBe('active')
      expect(state.tasks.filter(task => task.lease !== undefined)).toHaveLength(1)
      await f.scheduler.drive({ teamId: f.teamId })
      expect((await f.ctx.teams.getTeam({ teamId: f.teamId })).tasks.filter(task => task.lease !== undefined)).toHaveLength(1)
      await settleAttempt(f.ctx, await f.ctx.teams.getTask({ teamId: f.teamId, taskId: first.id }), 'cancelled')
      await f.scheduler.drive({ teamId: f.teamId })
      expect(await f.ctx.teams.getTask({ teamId: f.teamId, taskId: second.id })).toMatchObject({ phase: 'assigned', attemptCount: 1 })
      expect((await f.ctx.teams.getTeam({ teamId: f.teamId })).team.phase).toBe('active')
    })

    it('stalls pending work explicitly when concurrency capacity is zero', async () => {
      const f = await setup(backend, { maxConcurrency: 0 })
      await worker(f.ctx, f.teamId, 'Worker')
      await pendingTask(f.ctx, f.teamId, 'No available slots')
      await f.scheduler.drive({ teamId: f.teamId })
      const state = await f.ctx.teams.getTeam({ teamId: f.teamId })
      expect(state.team).toMatchObject({ phase: 'stalled', stallReason: { code: 'TEAM_CONCURRENCY_BUDGET_EXCEEDED' } })
      expect(state.tasks[0]).toMatchObject({ phase: 'pending', attemptCount: 0 })
      expect(state.channelIds).toEqual([])
    })

    it('keeps an empty Team active with zero concurrency capacity', async () => {
      const f = await setup(backend, { maxConcurrency: 0 })
      await f.scheduler.drive({ teamId: f.teamId })
      const state = await f.ctx.teams.getTeam({ teamId: f.teamId })
      expect(state.team.phase).toBe('active')
      expect(state.tasks).toEqual([])
    })

    it('resets earlier unassignable observations while admitted work occupies concurrency capacity', async () => {
      const f = await setup(backend, { maxConcurrency: 1 })
      await worker(f.ctx, f.teamId, 'Worker')
      await pendingTask(f.ctx, f.teamId, 'Unavailable work', ['unavailable'])
      await f.scheduler.drive({ teamId: f.teamId })
      await f.scheduler.drive({ teamId: f.teamId })
      const live = await pendingTask(f.ctx, f.teamId, 'Available work')
      await f.scheduler.drive({ teamId: f.teamId })
      await f.scheduler.drive({ teamId: f.teamId })
      await settleAttempt(f.ctx, await f.ctx.teams.getTask({ teamId: f.teamId, taskId: live.id }), 'cancelled')
      for (let drive = 0; drive < 2; drive += 1) {
        await f.scheduler.drive({ teamId: f.teamId })
        expect((await f.ctx.teams.getTeam({ teamId: f.teamId })).team.phase).toBe('active')
      }
      await f.scheduler.drive({ teamId: f.teamId })
      expect((await f.ctx.teams.getTeam({ teamId: f.teamId })).team).toMatchObject({
        phase: 'stalled', stallReason: { code: 'TASK_NO_ELIGIBLE_OWNER' } })
    })

    it('allows a first attempt with zero retries and stalls only its later retry', async () => {
      const f = await setup(backend, { maxRetries: 0 })
      await worker(f.ctx, f.teamId, 'Worker')
      const task = await pendingTask(f.ctx, f.teamId, 'First attempt')
      await expect(f.scheduler.drive({ teamId: f.teamId })).resolves.toBeUndefined()
      expect(await f.ctx.teams.getTask({ teamId: f.teamId, taskId: task.id })).toMatchObject({ phase: 'assigned', attemptCount: 1 })
      await settleAttempt(f.ctx, await f.ctx.teams.getTask({ teamId: f.teamId, taskId: task.id }), 'released')
      await f.scheduler.drive({ teamId: f.teamId })
      expect(await f.ctx.teams.getTask({ teamId: f.teamId, taskId: task.id })).toMatchObject({ phase: 'pending', attemptCount: 1 })
      expect((await f.ctx.teams.getTeam({ teamId: f.teamId })).team).toMatchObject({
        phase: 'stalled', stallReason: { code: 'TEAM_RETRIES_BUDGET_EXCEEDED' } })
    })

    it('lets the last admitted retry run without stalling its Team', async () => {
      const f = await setup(backend, { maxRetries: 1 })
      await worker(f.ctx, f.teamId, 'Worker')
      const task = await pendingTask(f.ctx, f.teamId, 'One retry')
      await f.scheduler.drive({ teamId: f.teamId })
      await settleAttempt(f.ctx, await f.ctx.teams.getTask({ teamId: f.teamId, taskId: task.id }), 'released')
      await f.scheduler.drive({ teamId: f.teamId })
      const state = await f.ctx.teams.getTeam({ teamId: f.teamId })
      expect(state.tasks.find(candidate => candidate.id === task.id)).toMatchObject({ phase: 'assigned', attemptCount: 2 })
      expect(state.team.phase).toBe('active')
    })

    it('skips an exhausted retry, runs a later first attempt, then diagnoses the remaining blocked retry', async () => {
      const f = await setup(backend, { maxRetries: 0 })
      await worker(f.ctx, f.teamId, 'Worker')
      const retry = await pendingTask(f.ctx, f.teamId, 'Retry blocked')
      const fresh = await pendingTask(f.ctx, f.teamId, 'Fresh work')
      await f.scheduler.drive({ teamId: f.teamId })
      await settleAttempt(f.ctx, await f.ctx.teams.getTask({ teamId: f.teamId, taskId: retry.id }), 'released')
      await f.scheduler.drive({ teamId: f.teamId })
      expect(await f.ctx.teams.getTask({ teamId: f.teamId, taskId: fresh.id })).toMatchObject({ phase: 'assigned', attemptCount: 1 })
      expect((await f.ctx.teams.getTeam({ teamId: f.teamId })).team.phase).toBe('active')
      await settleAttempt(f.ctx, await f.ctx.teams.getTask({ teamId: f.teamId, taskId: fresh.id }), 'cancelled')
      await f.scheduler.drive({ teamId: f.teamId })
      expect((await f.ctx.teams.getTeam({ teamId: f.teamId })).team).toMatchObject({
        phase: 'stalled', stallReason: { code: 'TEAM_RETRIES_BUDGET_EXCEEDED' } })
      expect(await f.ctx.teams.getTask({ teamId: f.teamId, taskId: retry.id })).toMatchObject({ phase: 'pending', attemptCount: 1 })
    })

    it('honors the tighter frozen legacy retry allowance without stopping the admitted retry', async () => {
      const f = await setup(backend, { maxRetries: 2 }, { maxRetriesPerTeam: 1 })
      await worker(f.ctx, f.teamId, 'Worker')
      const retry = await pendingTask(f.ctx, f.teamId, 'Legacy retry bound')
      await f.scheduler.drive({ teamId: f.teamId })
      await settleAttempt(f.ctx, await f.ctx.teams.getTask({ teamId: f.teamId, taskId: retry.id }), 'released')
      await f.scheduler.drive({ teamId: f.teamId })
      expect((await f.ctx.teams.getTeam({ teamId: f.teamId })).team.phase).toBe('active')
      await settleAttempt(f.ctx, await f.ctx.teams.getTask({ teamId: f.teamId, taskId: retry.id }), 'released')
      await f.scheduler.drive({ teamId: f.teamId })
      expect((await f.ctx.teams.getTeam({ teamId: f.teamId })).team).toMatchObject({
        phase: 'stalled', stallReason: { code: 'TEAM_RETRIES_BUDGET_EXCEEDED',
          message: `Team '${f.teamId}' reached its maxRetries budget of 1` } })
      expect(await f.ctx.teams.getTask({ teamId: f.teamId, taskId: retry.id })).toMatchObject({ phase: 'pending', attemptCount: 2 })
    })

    it.each(['typed-zero', 'legacy-tighter'] as const)('enforces retry admission for direct Hub callers (%s)', async (kind) => {
      const f = await setup(backend, { maxRetries: kind === 'typed-zero' ? 0 : 2 },
        kind === 'typed-zero' ? {} : { maxRetriesPerTeam: 1 }, false)
      const binding = await worker(f.ctx, f.teamId, 'Worker')
      const task = await pendingTask(f.ctx, f.teamId, 'Direct retry admission')
      const fresh = await pendingTask(f.ctx, f.teamId, 'Direct first attempt')
      const assign = async (current: TeamTaskSnapshot) => await assignTestTask(f.ctx, {
        teamId: f.teamId, taskId: current.id, expectedRevision: current.revision,
        participantId: binding.activation.participantId, activationId: binding.activation.id, leaseDurationMs: 60_000 })
      let current = await settleAttempt(f.ctx, await assign(task), 'released')
      if (kind === 'legacy-tighter') current = await settleAttempt(f.ctx, await assign(current), 'released')
      await expect(assign(current)).rejects.toMatchObject({
        code: kind === 'typed-zero' ? 'TEAM_BUDGET_EXCEEDED' : 'TEAM_CHANNEL_BACKPRESSURE' })
      expect(await assign(fresh)).toMatchObject({ phase: 'assigned', attemptCount: 1 })
    })

    it('rejects zero-wall-time task creation before changing the Team journal', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(1_000)
      const f = await setup(backend, { maxWallTimeMs: 0 }, {}, false)
      await provisionTestCoordinator(f.ctx, f.teamId)
      const before = await f.ctx.teams.getTeam({ teamId: f.teamId })
      await expect(pendingTask(f.ctx, f.teamId, 'No time for new work')).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
      const after = await f.ctx.teams.getTeam({ teamId: f.teamId })
      expect(after.team.cursor).toBe(before.team.cursor)
      expect(after.tasks).toEqual([])
      expect(after.channelIds).toEqual([])
    })

    it.each([
      { cap: 10, elapsed: 9, accepts: true, legacy: undefined },
      { cap: 10, elapsed: 10, accepts: false, legacy: undefined },
      { cap: 10, elapsed: 11, accepts: false, legacy: undefined },
      { cap: 20, elapsed: 10, accepts: false, legacy: 10 },
    ])('enforces a public Hub assignment deadline at cap=$cap elapsed=$elapsed legacy=$legacy', async ({ cap, elapsed, accepts, legacy }) => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
      const f = await setup(backend, { maxWallTimeMs: cap }, legacy === undefined ? {} : { maxWallTimeMsPerTeam: legacy }, false)
      const binding = await worker(f.ctx, f.teamId, 'Deadline worker')
      const task = await pendingTask(f.ctx, f.teamId, 'Deadline admission')
      now.mockReturnValue(1_000 + elapsed)
      const assignment = assignTestTask(f.ctx, { teamId: f.teamId, taskId: task.id, expectedRevision: task.revision,
        participantId: binding.activation.participantId, activationId: binding.activation.id, leaseDurationMs: 60_000 })
      if (accepts) await expect(assignment).resolves.toMatchObject({ phase: 'assigned' })
      else await expect(assignment).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
    })
  })
}
