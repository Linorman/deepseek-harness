/** Ranking checkpoints remain derived from immutable attempts, including deleted-task tombstones. */
import { describe, expect, it } from 'vitest'
import { teamTaskRankingPolicySchema } from '@clocky/clocky-team'
import { taskOwnerRank } from '../../team-scheduler-dag/src/ranking.ts'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, task, taskChanged, taskCreatorActivationId, taskCreatorId,
  taskCreatorSessionId, taskLease, teamId, teamPhase } from './fixtures.ts'

function records() {
  const member = participant({ id: taskCreatorId, role: 'coordinator', capabilities: ['a', 'b'] })
  const initial = task({ requiredCapabilities: ['b', 'a'], budget: { maxCostUnits: 1 } })
  const lease = taskLease({ participantId: taskCreatorId, activationId: taskCreatorActivationId,
    assignedAt: 18, renewedAt: 18, expiresAt: 28 })
  const assigned = task({ ...initial, revision: 2, phase: 'assigned', attemptCount: 1, lease })
  const running = task({ ...assigned, revision: 3, phase: 'running', lease: { ...lease, startedAt: 19 } })
  const retryable = task({ ...running, revision: 4, phase: 'pending', lease: undefined, attemptHistory: [{
    id: lease.attemptId, teamId, taskId: initial.id, ordinal: 1, participantId: taskCreatorId,
    activationId: taskCreatorActivationId, assignedAt: 18, startedAt: 19, leaseExpiresAt: 28,
    settledAt: 21, outcome: { kind: 'failed', failure: { code: 'FAILED', message: 'Retained failed attempt.' } },
  }] })
  return [createdTeam({ rules: { taskRanking: { name: 'outcome-latency', version: 1,
    latencyUpperBoundsMs: [1, 5], costRateUpperBounds: [1, 10], missingCost: 'unknown-last' } } }), teamPhase(),
  participantChanged({ participant: member, createdAt: 12 }),
  participantChanged({ participant: { ...member, phase: 'provisioning' }, createdAt: 13 }),
  participantChanged({ participant: { ...member, phase: 'active' }, createdAt: 14 }),
  { type: 'activation/changed', createdAt: 15, binding: {
    activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
    sessionId: taskCreatorSessionId, provider: 'in-process',
  } }, taskChanged({ task: initial, createdAt: 16 }), taskChanged({ task: assigned, createdAt: 18 }),
  taskChanged({ task: running, createdAt: 19 }), taskChanged({ task: retryable, createdAt: 21 }),
  taskChanged({ task: { ...retryable, revision: 5, phase: 'deleted' }, createdAt: 22 })]
}
for (const backend of ['json', 'sqlite'] as const) {
  describe(`ranking source recovery on ${backend}`, () => {
    it('retains a deleted task’s failed attempt and rejects invented checkpoint counters or buckets', async () => {
      const rows = records()
      const checkpoint = checkpointFor(rows)
      const stats = checkpoint.taskExecutionStats![0]!
      const invalidVersionCheckpoint = JSON.parse(JSON.stringify(checkpoint)) as typeof checkpoint
      const ranking = invalidVersionCheckpoint.rules?.taskRanking as { version: number } | undefined
      if (ranking === undefined) throw new Error('ranking checkpoint fixture has no policy')
      ranking.version = 2
      expect(stats).toMatchObject({ requiredCapabilities: ['a', 'b'], completedAttempts: 0, failedAttempts: 1,
        totalLatencyMs: 3, latencyBucketCounts: [0, 1, 0] })
      for (const value of [undefined, checkpoint,
        { ...checkpoint, taskExecutionStats: [{ ...stats, completedAttempts: 2 }] },
        { ...checkpoint, taskExecutionStats: [{ ...stats, latencyBucketCounts: [1, 0, 0] }] },
        { ...checkpoint, taskExecutionStats: [] }]) {
        const ctx = await recover(backend, rows, value)
        const state = await ctx.teams.getTeam({ teamId })
        expect(state.tasks[0]?.phase).toBe('deleted')
        expect(state.participants.find(member => member.id === taskCreatorId)?.stats?.taskOutcomes).toEqual([stats])
      }
    })

    it('rejects an unsupported ranking policy version instead of selecting a fallback policy', async () => {
      const rows = records()
      const checkpoint = checkpointFor(rows)
      const invalidVersionCheckpoint = JSON.parse(JSON.stringify(checkpoint)) as typeof checkpoint
      const ranking = invalidVersionCheckpoint.rules?.taskRanking as { version: number } | undefined
      if (ranking === undefined) throw new Error('ranking checkpoint fixture has no policy')
      ranking.version = 2
      const ctx = await recover(backend, rows, invalidVersionCheckpoint)
      await expect(ctx.teams.getTeam({ teamId })).rejects.toThrow(/expected 1/)
    })

    it('replays the same ranking tuple and keeps missing recovery routes in the unknown bucket', async () => {
      const rows = records()
      const checkpoint = checkpointFor(rows)
      const cold = await recover(backend, rows)
      const restored = await recover(backend, rows, checkpoint)
      const rank = (state: Awaited<ReturnType<typeof cold.teams.getTeam>>) => {
        const selectedTask = state.tasks[0]
        const selectedParticipant = state.participants.find(member => member.id === taskCreatorId)
        const selectedBinding = state.activations.find(binding => binding.activation.participantId === taskCreatorId)
        const ranking = state.rules.taskRanking === undefined ? undefined : teamTaskRankingPolicySchema.parse(state.rules.taskRanking)
        if (selectedTask === undefined || selectedParticipant === undefined || selectedBinding === undefined || ranking === undefined) {
          throw new Error('ranking replay fixture is incomplete')
        }
        return taskOwnerRank(selectedTask, selectedParticipant, {
          ...selectedBinding, selection: { provider: 'hint-provider', model: 'hint-model' },
        }, ranking, { usageRates: { 'provider/model': { input: 2, output: 1, cacheRead: 0, cacheWrite: 0 } } })
      }
      const first = rank(await cold.teams.getTeam({ teamId }))
      const second = rank(await restored.teams.getTeam({ teamId }))
      expect(second).toEqual(first)
      expect(first.costBucket).toBe(3)
    })
  })
}
