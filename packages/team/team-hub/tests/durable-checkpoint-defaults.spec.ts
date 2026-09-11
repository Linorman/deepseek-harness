/** Optional checkpoint fields preserve their durable recovery semantics. @module */

import { describe, expect, it } from 'vitest'
import { TEAM_JOURNAL_FORMAT_VERSION } from '../src/types.ts'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, teamId, teamPhase } from './fixtures.ts'
import { childUsageReservation, failedChildUsageReservation } from './durable-child-fixtures.ts'

function archivedRows(records: readonly unknown[] = [], requestedAt = 12) {
  return [createdTeam({ maxTeamDepth: 2 }), teamPhase(), ...records,
    { type: 'team/closure', closure: { teamId, kind: 'fail', idempotencyKey: 'archived-checkpoint',
      actor: { kind: 'system', name: 'team-run' }, reason: { code: 'FAILED', message: 'The run failed.' },
      requestedAt }, createdAt: requestedAt },
    { type: 'team/phase', phase: 'quiescing', createdAt: requestedAt + 1 },
    { type: 'team/phase', phase: 'failed', createdAt: requestedAt + 2 },
    { type: 'team/archived', createdAt: requestedAt + 3 },
  ]
}

/** Remove the archived journal prefix so a rejected checkpoint cannot masquerade as successful recovery. */
async function recoverCompacted(backend: 'json' | 'sqlite', records: readonly unknown[], checkpoint: unknown) {
  const ctx = await recover(backend, records, checkpoint)
  const stream = await ctx.storageLog.open({ name: `team/${teamId}`, version: TEAM_JOURNAL_FORMAT_VERSION })
  await stream.compact({ throughSequence: records.length - 2, expectedCheckpointSequence: records.length - 1 })
  await stream.close()
  return await ctx.teams.getTeam({ teamId })
}

for (const backend of ['json', 'sqlite'] as const) {
  describe(`optional Team checkpoint fields (${backend})`, () => {
    it('recovers omitted empty collections and usage after the archived journal prefix is compacted', async () => {
      const records = archivedRows()
      const checkpoint = checkpointFor(records)
      const fields = ['humanActions', 'usage', 'usageSamples', 'usageCharges', 'pendingParentCharges', 'workflowPlans']
      for (const omitted of [...fields.map(field => [field]), fields]) {
        const data = Object.fromEntries(Object.entries(checkpoint).filter(([key]) => !omitted.includes(key)))
        const state = await recoverCompacted(backend, records, data)
        expect(state.team).toEqual(checkpoint.team)
        expect(state.humanActions).toEqual([])
        expect(state.usage).toEqual(checkpoint.usage)
        expect(state.workflowPlans).toBeUndefined()
      }
    })

    it('retains a nonzero usage aggregate when both optional usage ledgers are omitted', async () => {
      const usage = { inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0,
        turns: 1, costUnits: 1, updatedAt: 12 }
      const charge = { id: 'charge-a', sourceTeamId: 'child-team', parentTaskId: 'charge-task', originTeamId: 'origin-team',
        sourceSampleId: 'sample-a', participantId: 'participant-child', sessionId: 'session-child',
        provider: 'mock', model: 'model', turn: 1, step: 1,
        usage: { inputTokens: 2, outputTokens: 3 }, costUnits: 1, observedAt: 12 }
      const reservation = childUsageReservation('child-team', 'charge-task', 11)
      const records = archivedRows([...reservation.records, { type: 'usage/child-charged', charge, usage, createdAt: 12 },
        failedChildUsageReservation(reservation.reserved, 12)], 13)
      const checkpoint = checkpointFor(records)
      const data = { ...checkpoint, usageSamples: undefined, usageCharges: undefined }
      const state = await recoverCompacted(backend, records, data)
      expect(state.team).toEqual(checkpoint.team)
      expect(state.usage).toEqual(usage)
    })
  })
}
