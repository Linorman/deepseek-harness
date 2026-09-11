/** Real terminal channels share one manual retention slot before their owning Team journal. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { TeamDagScheduler } from '@clocky/clocky-team-scheduler-dag'
import type { Config as SchedulerConfig } from '@clocky/clocky-team-scheduler-dag'
import type { TeamId } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-storage-log'
import { MODEL, QuestionModel, runQuestionProducer } from './headless-human-question-driver.ts'

const SCHEDULING = {
  leaseDurationMs: 3_600_000, maxAssignmentsPerDrive: 1, maxExpirationsPerDrive: 1,
  maxWakeDispatchesPerDrive: 1, maxConflictsPerDrive: 4, maxActiveAttemptsPerParticipant: 1,
  permittedWorkspaceModes: ['shared'], disposalTimeoutMs: 5000,
} satisfies SchedulerConfig
const TAIL = 1

/** Own exactly the public source objects created by one real scheduler instance. */
function ownScheduler(ctx: Context, config: SchedulerConfig) {
  const scheduler = new TeamDagScheduler(ctx, config)
  const dispose = ctx.effect(() => {
    const unregister = [
      ctx.teams.registerSystemEnvelopePostProofSource(scheduler.envelopePostProofSource),
      ctx.teams.registerSystemTaskReviewProofSource(scheduler.taskReviewProofSource),
      ctx.teams.registerSystemPhaseProofSource(scheduler.phaseProofSource),
      ctx.teams.registerSystemMaintenanceProofSource(scheduler.maintenanceProofSource),
      ctx.teams.registerSystemTaskLeaseProofSource(scheduler.taskLeaseProofSource),
      ctx.teams.registerSystemSchedulerChannelProofSource(scheduler.schedulerChannelProofSource),
    ]
    return async () => {
      try { await scheduler.close() }
      finally { for (const release of unregister.reverse()) release() }
    }
  }, 'retention fixture: scheduler and original proof-source lifetime')
  return { scheduler, async close() { await dispose() } }
}

/** Read actual public retained-prefix observations and operation counters. */
async function watermarks(ctx: Context, teamId: TeamId) {
  const state = await ctx.teams.getTeam({ teamId })
  // Diagnostics borrow the live handle; Hub remains its sole open/close owner.
  const source = ctx.storageLog.get(`team/${teamId}`)
  assert(source !== undefined)
  const teamFirst = source.firstSequence
  const channels = await Promise.all(state.channelIds.map(async (id) => {
    const channel = await ctx.teams.getChannel({ channelId: id })
    return { id, adapter: channel.manifest.adapter.type, phase: channel.phase,
      cursor: channel.cursor, first: channel.firstCursor ?? 0 }
  }))
  const metrics = ctx.teams.getMetrics()
  return { teamCursor: state.team.cursor, teamFirst, channels,
    channelCompactions: metrics.channelCompactions, teamCompactions: metrics.teamCompactions }
}

async function run(ctx: Context, model: QuestionModel): Promise<Record<string, unknown>> {
  await ctx.get('loader')?.await()
  const ordinary = ownScheduler(ctx, SCHEDULING)
  let producer: Record<string, unknown>
  try {
    ordinary.scheduler.start()
    producer = await runQuestionProducer(ctx, model)
  } finally { await ordinary.close() }
  const teams = await ctx.teams.listTeamsPage({ afterCursor: -1, limit: 2 })
  assert.equal(teams.items.length, 1)
  const teamId = teams.items[0]!.id
  const originalState = await ctx.teams.getTeam({ teamId })
  assert.equal(originalState.team.phase, 'cancelled')
  const initial = await watermarks(ctx, teamId)
  assert.equal(initial.channels.length, 2)
  assert(initial.channels.every(channel => channel.phase === 'closed' && channel.first === 0 && channel.cursor > TAIL))
  assert.equal(initial.teamFirst, 0)
  const manual = ownScheduler(ctx, { ...SCHEDULING, terminalChannelRetentionTail: TAIL, maxCompactionsPerDrive: 1 })
  const steps: Record<string, unknown>[] = []
  try {
    let previous = initial
    for (const [index, target] of initial.channels.entries()) {
      await manual.scheduler.drive({ teamId })
      const current = await watermarks(ctx, teamId)
      assert.equal(current.teamCursor, initial.teamCursor)
      assert.equal(current.teamFirst, 0)
      assert.equal(current.channelCompactions, initial.channelCompactions + index + 1)
      assert.equal(current.teamCompactions, initial.teamCompactions)
      for (const [position, channel] of current.channels.entries()) {
        assert.equal(channel.cursor, initial.channels[position]!.cursor)
        assert.equal(channel.first, position <= index ? channel.cursor - TAIL : 0)
      }
      const advanced = current.channels.filter((channel, position) => channel.first > previous.channels[position]!.first)
      assert.deepEqual(advanced.map(channel => channel.id), [target.id])
      steps.push({ target: target.adapter, advancedChannels: advanced.length,
        retainedChannels: current.channels.map(channel => channel.first > 0), teamAdvanced: false })
      previous = current
    }
    await manual.scheduler.drive({ teamId })
    const terminal = await watermarks(ctx, teamId)
    assert.deepEqual(terminal.channels, previous.channels)
    assert.equal(terminal.teamFirst, initial.teamCursor - TAIL)
    assert.equal(terminal.teamCompactions, initial.teamCompactions + 1)
    assert.equal(terminal.channelCompactions, initial.channelCompactions + initial.channels.length)
    steps.push({ target: 'team-journal', advancedChannels: 0,
      retainedChannels: terminal.channels.map(channel => channel.first > 0), teamAdvanced: true })
    await manual.scheduler.drive({ teamId })
    const extra = await watermarks(ctx, teamId)
    assert.deepEqual(extra.channels, terminal.channels)
    assert.equal(extra.channelCompactions, terminal.channelCompactions, 'removed channel prefixes must not consume another retention slot')
    assert.equal(extra.teamFirst, terminal.teamFirst)
    const extraTeamCompactions = extra.teamCompactions - terminal.teamCompactions
    assert(extraTeamCompactions >= 0 && extraTeamCompactions <= 1)
    assert.deepEqual(await ctx.teams.getTeam({ teamId }), originalState)
    return { scenario: 'terminal-retention', producer, maxCompactionsPerDrive: 1, configuredTail: TAIL,
      steps, retainedChannelRecords: terminal.channels.map(channel => channel.cursor - channel.first + 1),
      retainedTeamRecords: terminal.teamCursor - terminal.teamFirst + 1,
      channelCompactions: terminal.channelCompactions - initial.channelCompactions,
      teamCompactions: terminal.teamCompactions - initial.teamCompactions,
      extraDrive: { channelCompactions: 0, teamCompactions: extraTeamCompactions }, repeatedChannelPrefixConsumesBudget: false,
      terminalStateRetained: true }
  } finally { await manual.close() }
}

/** Test-only Loader identity. */
export const name = 'retention-driver'
/** Formal Host and scheduler dependencies precede ordinary production. */
export const inject = ['apiProxy', 'teamRuns', 'teams', 'teamWorkspaces', 'storageLog', 'llm', 'agents', 'sessions']
/** Complete ordinary work before starting explicit retention. @param ctx - Loader context. */
export function apply(ctx: Context): void {
  const model = new QuestionModel()
  ctx.llm.registerAdapter([MODEL], model)
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  void run(ctx, model).then((output) => { process.stdout.write(`${JSON.stringify(output, null, 2)}\n`); exit(0) }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
