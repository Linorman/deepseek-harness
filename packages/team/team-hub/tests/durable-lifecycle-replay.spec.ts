/** Serialized lifecycle and usage relationships at the Hub's storage boundary. @module */

import { describe, expect, it } from 'vitest'
import { createdTeam, goal, goalChanged, participant, participantChanged, taskCreatorId,
  taskCreatorActivationId, taskCreatorSessionId, teamId, teamPhase } from './fixtures.ts'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { retainedFinalAdapter, retainedFinalFixture } from './durable-final-fixtures.ts'
import { childUsageReservation } from './durable-child-fixtures.ts'

function closure(kind: 'complete' | 'fail' | 'cancel', createdAt: number) {
  return { type: 'team/closure', createdAt, closure: {
    teamId, kind, idempotencyKey: `close-${kind}`, actor: { kind: 'system', name: 'team-run' },
    reason: { code: 'RUN_SETTLED', message: 'The run has settled.' }, requestedAt: createdAt,
    ...kind === 'complete' ? { finalChannelId: 'channel-final', finalEnvelopeId: 'final-1' } : {},
  } }
}

function cancellation(createdAt: number) {
  return { type: 'team/cancellation', createdAt, cancellation: {
    teamId, idempotencyKey: 'cancel-team', actor: { kind: 'system', name: 'team-run' },
    reason: { code: 'CANCELLED', message: 'Cancellation was requested.' }, requestedAt: createdAt,
  } }
}

function usageCharge(observedAt = 12) {
  return { id: 'charge-1', sourceTeamId: 'child-team', parentTaskId: 'charge-task', originTeamId: 'origin-team', sourceSampleId: 'sample-1',
    participantId: 'participant-child', sessionId: 'session-child', provider: 'mock', model: 'model',
    turn: 1, step: 1, usage: { inputTokens: 2, outputTokens: 3 }, costUnits: 1, observedAt }
}

function usage(observedAt = 12, inputTokens = 2) {
  return { inputTokens, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 1, costUnits: 1, updatedAt: observedAt }
}

for (const backend of ['json', 'sqlite'] as const) {
  describe(`durable lifecycle replay (${backend})`, () => {
    const prefix = [createdTeam(), teamPhase()]
    for (const kind of ['complete', 'fail'] as const) {
      it(`refuses ${kind} intent revisions and prohibited post-intent business records`, async () => {
        const intent = closure(kind, 12)
        checkpointFor([...prefix, intent])
        const suffixes = [
          { records: [intent, closure(kind, 13)], message: 'more than one closure intent' },
          { records: [intent, { type: 'channel/attached', channelId: 'new-work', createdAt: 13 }], message: 'business records after its closure intent' },
          { records: [intent, { type: 'team/phase', phase: 'active', createdAt: 13 }], message: 'cannot transition' },
        ]
        for (const suffix of suffixes) {
          const ctx = await recover(backend, [...prefix, ...suffix.records])
          await expect(ctx.teams.getTeam({ teamId })).rejects.toThrow(suffix.message)
        }
      })
    }

    it('refuses incompatible cancellation/closure order and premature archive', async () => {
      const cases = [
        [closure('cancel', 12)],
        [cancellation(12), closure('complete', 13)],
        [cancellation(12), cancellation(13)],
        [cancellation(12), { type: 'channel/attached', channelId: 'late-channel', createdAt: 13 }],
        [cancellation(12), { type: 'team/phase', phase: 'completed', createdAt: 13 }],
        [cancellation(12), { type: 'team/phase', phase: 'cancelled', createdAt: 13 }],
        [{ type: 'team/archived', createdAt: 12 }],
      ]
      for (const suffix of cases) {
        const ctx = await recover(backend, [...prefix, ...suffix])
        await expect(ctx.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
      }
    })

    it('retains one terminal archive marker and rejects every later journal mutation', async () => {
      const archived = [...prefix, closure('fail', 12),
        { type: 'team/phase', phase: 'quiescing', createdAt: 13 },
        { type: 'team/phase', phase: 'failed', createdAt: 14 },
        { type: 'team/archived', createdAt: 15 }]
      const valid = await recover(backend, archived, checkpointFor(archived))
      expect((await valid.teams.getTeam({ teamId })).team).toMatchObject({ phase: 'failed', archivedAt: 15 })
      for (const value of [
        { record: { type: 'team/archived', createdAt: 16 }, message: 'archived twice' },
        { record: { type: 'channel/attached', channelId: 'late-channel', createdAt: 16 }, message: 'records after archival' },
      ]) {
        const invalid = await recover(backend, [...archived, value.record])
        await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow(value.message)
      }
    })

    it('rejects closure and cancellation identities routed to another Team journal', async () => {
      const close = closure('fail', 12)
      const cancel = cancellation(12)
      for (const value of [
        { record: { ...close, closure: { ...close.closure, teamId: 'foreign-team' } }, message: 'Team closure belongs to' },
        { record: { ...cancel, cancellation: { ...cancel.cancellation, teamId: 'foreign-team' } }, message: 'Team cancellation belongs to' },
      ]) {
        const invalid = await recover(backend, [...prefix, value.record])
        await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow(value.message)
      }
    })

    it('requires new completion intent to leave a stalled Team through an authorized phase transition', async () => {
      const stalled = [...prefix, { type: 'team/phase', phase: 'stalled', createdAt: 12,
        reason: { code: 'WAITING', message: 'The Team is waiting for recovery.' } }]
      checkpointFor(stalled)
      const invalid = await recover(backend, [...stalled, closure('complete', 13)])
      await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow("cannot request completion from 'stalled'")
    })

    it('rejects final admission and goal changes at the cancellation whitelist', async () => {
      const final = retainedFinalFixture({ channelId: 'cancelled-final-channel', senderId: taskCreatorId,
        memberAt: 14, createdAt: 16, admittedAt: 18, receiptAt: 19 })
      const coordinator = participant({ id: taskCreatorId, role: 'coordinator' })
      const admitted = [...prefix,
        participantChanged({ participant: coordinator, createdAt: 12 }),
        participantChanged({ participant: { ...coordinator, phase: 'provisioning' }, createdAt: 13 }),
        participantChanged({ participant: { ...coordinator, phase: 'active' }, createdAt: 14 }),
        ...final.memberRecords,
        { type: 'activation/changed', createdAt: 15, binding: {
          activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
          sessionId: taskCreatorSessionId, provider: 'in-process',
        } },
        final.attachment, cancellation(17), { type: 'team/phase', phase: 'quiescing', createdAt: 17 }]
      checkpointFor(admitted)
      for (const record of [final.admission, goalChanged({ goal: goal({ revision: 2, objective: 'Work after cancellation.' }), createdAt: 18 })]) {
        const ctx = await recover(backend, [...admitted, record], undefined, teamId, [final.pendingChannel])
        ctx.teams.registerAdapter(retainedFinalAdapter)
        await expect(ctx.teams.getTeam({ teamId })).rejects.toThrow('unsupported records after its cancellation request')
      }
    })

    it('falls back from internally inconsistent closure checkpoints without masking a bad journal', async () => {
      const original = checkpointFor(prefix)
      const completeGoal = { ...original.goal, phase: 'complete' }
      const variants = [
        { ...original, team: { ...original.team, closure: closure('cancel', 11).closure } },
        { ...original, team: { ...original.team, cancellation: cancellation(11).cancellation, closure: closure('fail', 11).closure } },
        { ...original, goal: completeGoal, team: { ...original.team, goal: completeGoal, phase: 'failed', closure: closure('complete', 11).closure } },
        { ...original, team: { ...original.team, phase: 'quiescing', closure: closure('complete', 11).closure } },
        { ...original, team: { ...original.team, closure: closure('fail', 11).closure } },
      ]
      for (const value of variants) {
        const ctx = await recover(backend, prefix, value)
        expect((await ctx.teams.getTeam({ teamId })).team).toMatchObject({ phase: 'active', cursor: 1 })
      }
      const bad = await recover(backend, [...prefix, closure('cancel', 12)], { ...original, team: { ...original.team, cursor: 2, closure: closure('fail', 11).closure } })
      await expect(bad.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
    })

    it('rejects malformed human ownership at journal and checkpoint parsing', async () => {
      const human = participant({ kind: 'human' })
      const rows = [...prefix, participantChanged({ participant: human, createdAt: 12 })]
      const checkpoint = checkpointFor(rows)
      const invalidOwners = [
        { ...human, owner: undefined },
        { ...human, owner: { kind: 'unknown-owner' } },
        { ...human, kind: 'local-agent' },
      ]
      for (const value of invalidOwners) {
        const invalid = await recover(backend, [...prefix, { type: 'participant/changed', participant: value, createdAt: 12 }])
        await expect(invalid.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
        const restored = await recover(backend, rows, { ...checkpoint, participants: [value] })
        expect((await restored.teams.getTeam({ teamId })).participants).toMatchObject([human])
      }
    })

    it('rejects self-origin child charges and inconsistent aggregates in durable records', async () => {
      const chargePrefix = [createdTeam({ maxTeamDepth: 2 }), teamPhase(), ...childUsageReservation('child-team', 'charge-task', 11).records,
        ...childUsageReservation('different-child', 'different-parent', 11).records]
      const charge = usageCharge()
      const accepted = { type: 'usage/child-charged', charge, usage: usage(), createdAt: 12 }
      for (const fields of [{ sourceTeamId: teamId }, { originTeamId: teamId }]) {
        const invalid = await recover(backend, [...chargePrefix, { ...accepted, charge: { ...charge, ...fields } }])
        await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow('must originate outside Team')
      }
      const badUsage = await recover(backend, [...chargePrefix, { ...accepted, usage: usage(12, 999) }])
      await expect(badUsage.teams.getTeam({ teamId })).rejects.toThrow('child usage aggregate')
      const rows = [...chargePrefix, accepted]
      const checkpoint = checkpointFor(rows)
      for (const charges of [[charge, charge], [{ ...charge, sourceTeamId: teamId }], [{ ...charge, originTeamId: teamId }]]) {
        const restored = await recover(backend, rows, { ...checkpoint, usageCharges: charges })
        expect((await restored.teams.getTeam({ teamId })).usage).toEqual(usage())
      }
    })

    it('keeps a repeated child-usage observation attached to its immutable origin', async () => {
      const chargePrefix = [createdTeam({ maxTeamDepth: 2 }), teamPhase(), ...childUsageReservation('child-team', 'charge-task', 11).records,
        ...childUsageReservation('different-child', 'different-parent', 11).records]
      const first = usageCharge()
      const replacement = { ...first, observedAt: 13, usage: { inputTokens: 5, outputTokens: 3 } }
      const rows = [...chargePrefix,
        { type: 'usage/child-charged', charge: first, usage: usage(), createdAt: 12 },
        { type: 'usage/child-charged', charge: replacement, usage: usage(13, 5), createdAt: 13 },
      ]
      const ctx = await recover(backend, rows)
      expect((await ctx.teams.getTeam({ teamId })).usage).toEqual(usage(13, 5))
      for (const fields of [{ sourceTeamId: 'different-child', parentTaskId: 'different-parent' }, { originTeamId: 'different-origin' },
        { sourceSampleId: 'different-sample' }, { participantId: 'different-participant' }, { sessionId: 'different-session' },
        { provider: 'different-provider' }, { model: 'different-model' }, { turn: 2 }, { step: 2 }]) {
        const invalid = await recover(backend, [...rows.slice(0, -1), {
          type: 'usage/child-charged', charge: { ...replacement, ...fields }, usage: usage(13, 5), createdAt: 13,
        }])
        await expect(invalid.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
      }
    })

    it('preserves pending parent charges through checkpoint recovery and rejects foreign or duplicate ownership', async () => {
      const childPrefix = [createdTeam({ parentTeamId: 'parent-team', parentTaskId: 'parent-task', depth: 1, maxTeamDepth: 2 }), teamPhase()]
      const charge = { ...usageCharge(), sourceTeamId: teamId, parentTaskId: 'parent-task' }
      const pending = { type: 'usage/parent-charge-pending', charge, createdAt: 12 }
      const changed = { ...pending, charge: { ...charge, observedAt: 13, usage: { inputTokens: 5, outputTokens: 3 } }, createdAt: 13 }
      const data = checkpointFor([...childPrefix, pending, changed])
      const valid = await recover(backend, [...childPrefix, pending, changed], data)
      expect((await valid.teams.getTeam({ teamId })).team.parentTeamId).toBe('parent-team')
      for (const badCharges of [[{ ...charge, sourceTeamId: 'foreign-team' }], [charge, charge]]) {
        const restored = await recover(backend, [...childPrefix, pending], {
          ...checkpointFor([...childPrefix, pending]), pendingParentCharges: badCharges,
        })
        expect((await restored.teams.getTeam({ teamId })).team.parentTeamId).toBe('parent-team')
      }
      const root = await recover(backend, prefix, { ...checkpointFor(prefix), pendingParentCharges: [charge] })
      expect((await root.teams.getTeam({ teamId })).team.parentTeamId).toBeUndefined()
      for (const rows of [
        [...prefix, pending],
        [...childPrefix, { ...pending, charge: { ...charge, sourceTeamId: 'foreign-team' } }],
        [...childPrefix, pending, { ...changed, charge: { ...changed.charge, model: 'different-model' } }],
        [...childPrefix, { type: 'usage/parent-charge-settled', chargeId: charge.id, createdAt: 12 }],
      ]) {
        const invalid = await recover(backend, rows)
        await expect(invalid.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
      }
    })
  })
}
