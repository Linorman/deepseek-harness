/** Actual worker reports train the durable scheduler across independent Loader restarts. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { teamIdSchema, participantIdSchema, teamTaskCreateIdempotencyKeySchema, teamTaskRankingPolicySchema } from '@clocky/clocky-team'
import type { TeamId, ParticipantId, TeamStateSnapshot } from '@clocky/clocky-team'
import { TeamDagScheduler } from '@clocky/clocky-team-scheduler-dag'
import type {} from '@clocky/clocky-team-run'

const MODEL = 'task-ranking-model'
const INPUT = 'RANKING_COORDINATOR'
function text(): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'Ranking work observed.' } }, { type: 'finish', reason: { kind: 'stop' } }]
}
class RankingModel extends LlmAdapter {
  readonly coordinatorStarted = Promise.withResolvers<undefined>()
  readonly releaseCoordinator = Promise.withResolvers<undefined>()
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') { yield* text(); return }
    const input = options.messages.filter(message => message.role === 'user').flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text).join('\n')
    if (input.includes(INPUT)) {
      this.coordinatorStarted.resolve(undefined)
      await this.releaseCoordinator.promise
      yield* text(); return
    }
    const assignment = [...input.matchAll(/\nTask: (\S+)\nAttempt: (\S+)/gu)].at(-1)
    assert(assignment?.[1] !== undefined && assignment[2] !== undefined)
    const id = `ranking-report-${assignment[2]}`
    const prior = options.messages.flatMap(message => message.content).find(block => block.type === 'tool-result' && block.toolCallId === id)
    if (prior !== undefined) { assert(prior.type === 'tool-result' && !prior.isError, JSON.stringify(prior)); yield* text(); return }
    if (input.includes('RANK_SLOW')) await new Promise<void>((resolve) => { setTimeout(resolve, 1200) })
    const args = JSON.stringify({ task_id: assignment[1], attempt_id: assignment[2], outcome: 'completed', summary: 'Actual ranking training result.' })
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id: CallId(id), name: 'team_task_report', argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(id), name: 'team_task_report', arguments: args } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}
function ownScheduler(ctx: Context) {
  const scheduler = new TeamDagScheduler(ctx, { leaseDurationMs: 60_000, maxAssignmentsPerDrive: 1, maxExpirationsPerDrive: 1,
    maxWakeDispatchesPerDrive: 1, maxConflictsPerDrive: 4, maxActiveAttemptsPerParticipant: 1,
    permittedWorkspaceModes: ['shared'], disposalTimeoutMs: 5000 })
  const release = ctx.effect(() => {
    const disposers = [ctx.teams.registerSystemEnvelopePostProofSource(scheduler.envelopePostProofSource),
      ctx.teams.registerSystemTaskReviewProofSource(scheduler.taskReviewProofSource),
      ctx.teams.registerSystemPhaseProofSource(scheduler.phaseProofSource),
      ctx.teams.registerSystemMaintenanceProofSource(scheduler.maintenanceProofSource),
      ctx.teams.registerSystemTaskLeaseProofSource(scheduler.taskLeaseProofSource),
      ctx.teams.registerSystemSchedulerChannelProofSource(scheduler.schedulerChannelProofSource)]
    return async () => { try { await scheduler.close() } finally { for (const dispose of disposers.reverse()) dispose() } }
  }, 'ranking fixture scheduler and real proof-source lifetime')
  return { scheduler, close: async () => { await release() } }
}
async function until(ctx: Context, teamId: TeamId, predicate: (state: TeamStateSnapshot) => boolean) {
  let state = await ctx.teams.getTeam({ teamId })
  while (!predicate(state)) {
    await ctx.teams.watchTeam({ teamId, afterCursor: state.team.cursor })
    state = await ctx.teams.getTeam({ teamId })
  }
  return state
}
async function run(ctx: Context, model: RankingModel) {
  await ctx.get('loader')?.await()
  const stage = process.env.CLOCKY_RANKING_STAGE
  const metadataPath = join(process.cwd(), 'ranking-input.json')
  const metadata = stage === 'train' ? undefined : JSON.parse(await readFile(metadataPath, 'utf8')) as { teamId: string; fastId: string; slowId: string }
  const run = metadata === undefined
    ? await ctx.teamRuns.create({ objective: 'Rank actual worker execution history.', cwd: process.cwd() })
    : await ctx.teamRuns.resume({ teamId: teamIdSchema.parse(metadata.teamId) })
  const coordinator = run.coordinatorLease.localAgent
  assert(coordinator !== undefined)
  await ctx.teamRuns.postHumanInput({ teamId: run.teamId, content: [{ type: 'text', text: INPUT }] })
  await model.coordinatorStarted.promise
  const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
  const workers = [...run.workers].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const slowId = metadata === undefined ? workers[0]!.id : participantIdSchema.parse(metadata.slowId)
  const fastId = metadata === undefined ? workers[1]!.id : participantIdSchema.parse(metadata.fastId)
  const owned = ownScheduler(ctx)
  let sequence = 0
  const execute = async (subject: string, proposedOwnerId?: ParticipantId) => {
    const task = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, {
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`ranking-${stage}-${sequence++}`), subject,
      instructions: subject, readScopes: [], writeScopes: [],
    }))
    if (proposedOwnerId !== undefined) {
      await ctx.agents.withInitiator(coordinator,
        async () => await ctx.teamRuns.proposeDefaultWorkerTaskOwner(authority, { taskId: task.id, proposedOwnerId }))
    }
    await owned.scheduler.drive({ teamId: run.teamId })
    const done = await until(ctx, run.teamId, state => state.tasks.find(value => value.id === task.id)?.phase === 'completed'
      && state.workspaceAllocations.filter(value => value.taskId === task.id).every(value => value.lifecycle === 'released')
      && state.activations.filter(binding => binding.activation.status !== 'offline' && workers.some(worker => worker.id === binding.activation.participantId))
        .every(binding => binding.activation.status === 'idle'))
    return done.tasks.find(value => value.id === task.id)!.attemptHistory.at(-1)!.participantId
  }
  try {
    if (stage === 'train') {
      assert.equal(await execute('RANK_FAST_1', fastId), fastId)
      assert.equal(await execute('RANK_OUTCOME_PROBE'), fastId)
      assert.equal(await execute('RANK_SLOW_1', slowId), slowId)
      assert.equal(await execute('RANK_SLOW_2', slowId), slowId)
      const state = await ctx.teams.getTeam({ teamId: run.teamId })
      const fast = state.participants.find(value => value.id === fastId)!.stats!.taskOutcomes![0]!
      const slow = state.participants.find(value => value.id === slowId)!.stats!.taskOutcomes![0]!
      assert.equal(fast.completedAttempts, 2)
      assert.equal(slow.completedAttempts, 2)
      assert.deepEqual(fast.latencyBucketCounts, [2, 0])
      assert.deepEqual(slow.latencyBucketCounts, [0, 2])
      await writeFile(metadataPath, JSON.stringify({ teamId: run.teamId, fastId, slowId }))
      model.releaseCoordinator.resolve(undefined)
      await coordinator.whenIdle()
      await ctx.teamRuns.close()
      assert((await ctx.teams.getTeam({ teamId: run.teamId })).activations.every(binding => binding.activation.status === 'offline' && binding.quiescedAt !== undefined))
      return { stage: 'train', completed: [2, 2], latencyBuckets: [[2, 0], [0, 2]], outcomeBeatsUnseen: true, explicitProposalWins: true }
    }
    const before = await ctx.teams.getTeam({ teamId: run.teamId })
    const policy = teamTaskRankingPolicySchema.parse(before.rules.taskRanking)
    assert.equal(policy.version, 1)
    assert.deepEqual(policy.latencyUpperBoundsMs, [1000])
    assert.equal(await execute('RANK_RESTART_PROBE'), fastId)
    model.releaseCoordinator.resolve(undefined)
    await coordinator.whenIdle()
    await ctx.teamRuns.cancel(run.teamId)
    return { stage: 'restart', selected: 'fast-owner', samePersistedFacts: true, team: 'cancelled' }
  } finally { model.releaseCoordinator.resolve(undefined); await owned.close() }
}

/** Loader identity. */
export const name = 'task-ranking-driver'
/** Actual Team, scheduler, and Agent owners. */
export const inject = ['teamRuns', 'teams', 'teamWorkspaces', 'teamChannelAdmission', 'llm', 'agents']
/** Execute one training or independent replay process. @param ctx - Loader-owned context. */
export function apply(ctx: Context): void {
  const model = new RankingModel()
  ctx.llm.registerAdapter([MODEL], model)
  const failure = Promise.withResolvers<never>()
  ctx.on('agent/error', ({ error }) => { failure.reject(error) })
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  void Promise.race([run(ctx, model), failure.promise]).then((value) => { process.stdout.write(`${JSON.stringify(value)}\n`); exit(0) },
    (error: unknown) => { model.releaseCoordinator.resolve(undefined); process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); exit(1) })
}
