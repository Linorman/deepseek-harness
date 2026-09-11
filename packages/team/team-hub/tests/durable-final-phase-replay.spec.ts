/** Final admission, closure, and objective ordering through serialized Team recovery. @module */

import { describe, expect, it } from 'vitest'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { retainedFinalAdapter, retainedFinalFixture } from './durable-final-fixtures.ts'
import { createdTeam, goal, goalChanged, participant, participantChanged, taskCreatorActivationId,
  taskCreatorId, taskCreatorSessionId, teamId, teamPhase } from './fixtures.ts'

function closure(kind: 'complete' | 'fail', createdAt: number) {
  return { type: 'team/closure', createdAt, closure: { teamId, kind,
    idempotencyKey: `close-${kind}`, actor: { kind: 'system', name: 'team-run' },
    reason: { code: 'RUN_SETTLED', message: 'The run has settled.' }, requestedAt: createdAt,
    ...kind === 'complete' ? { finalChannelId: 'phase-final', finalEnvelopeId: 'final-a' } : {},
  } }
}

function finalPrefix(admittedAt = 19, receiptAt = 20) {
  const final = retainedFinalFixture({ channelId: 'phase-final', senderId: taskCreatorId,
    memberAt: 14, createdAt: 16, admittedAt, receiptAt })
  if (final.admission.type !== 'team/final-admitted') throw new Error('final fixture requires an admission record')
  const coordinator = participant({ id: taskCreatorId, role: 'coordinator' })
  const binding = { activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
    sessionId: taskCreatorSessionId, provider: 'in-process' }
  const records = [createdTeam(), teamPhase(),
    participantChanged({ participant: coordinator, createdAt: 12 }),
    participantChanged({ participant: { ...coordinator, phase: 'provisioning' }, createdAt: 13 }),
    participantChanged({ participant: { ...coordinator, phase: 'active' }, createdAt: 14 }),
    ...final.memberRecords, { type: 'activation/changed', binding, createdAt: 15 }, final.attachment]
  checkpointFor(records)
  const quiesced = (createdAt: number) => ({ type: 'activation/changed', createdAt,
    binding: { ...binding, activation: { ...binding.activation, status: 'offline' },
      quiescedAt: createdAt, quiescenceSource: 'quiesced', quiescedWakeChannelIds: [] } })
  return { records, final, admission: final.admission, quiesced }
}

for (const backend of ['json', 'sqlite'] as const) {
  describe(`final and closure phase replay (${backend})`, () => {
    it('rejects a second durable admission after retaining the exact completion result', async () => {
      const f = finalPrefix()
      const rows = [...f.records, closure('complete', 17),
        goalChanged({ goal: goal({ revision: 2, phase: 'complete' }), createdAt: 18 }),
        { type: 'team/phase', phase: 'quiescing', createdAt: 18 }, f.admission]
      const checkpoint = checkpointFor(rows)
      const valid = await recover(backend, rows, checkpoint, teamId, [f.final.pendingChannel])
      valid.teams.registerAdapter(retainedFinalAdapter)
      expect((await valid.teams.getTeam({ teamId })).team).toMatchObject({ phase: 'quiescing', goal: { phase: 'complete' } })
      const invalid = await recover(backend, [...rows, f.admission], checkpoint, teamId,
        [f.final.pendingChannel], rows.length - 1)
      invalid.teams.registerAdapter(retainedFinalAdapter)
      await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow('more than one final admission')
    })

    it('rejects new final admission during failure cleanup and after the Team has failed', async () => {
      const f = finalPrefix(22, 23)
      const quiescing = [...f.records, closure('fail', 17), { type: 'team/phase', phase: 'quiescing', createdAt: 18 }]
      const failed = [...quiescing, f.quiesced(20), { type: 'team/phase', phase: 'failed', createdAt: 21 }]
      const channel = { id: f.final.channel.id, records: [...f.final.pendingChannel.records,
        { type: 'channel/delivery-expired', sequence: f.final.pendingChannel.records.length, createdAt: 19, reason: 'closure',
          participantId: f.admission.admission.recipientId, envelopeId: f.admission.admission.envelopeId, envelopeSequence: f.admission.admission.envelopeSequence },
        { type: 'channel/phase', phase: 'closing', sequence: f.final.pendingChannel.records.length + 1, createdAt: 19 },
        { type: 'channel/closed', phase: 'closed', sequence: f.final.pendingChannel.records.length + 2, createdAt: 20 },
      ] }
      for (const rows of [quiescing, failed]) {
        const checkpoint = checkpointFor(rows)
        const valid = await recover(backend, rows, checkpoint, teamId, [channel])
        valid.teams.registerAdapter(retainedFinalAdapter)
        expect((await valid.teams.getTeam({ teamId })).team.phase).toBe(checkpoint.team.phase)
        const invalid = await recover(backend, [...rows, f.admission], checkpoint, teamId, [channel], rows.length - 1)
        invalid.teams.registerAdapter(retainedFinalAdapter)
        await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow('final admission requires active work or its accepted completion intent')
      }
    })

    it('retains partial completion intent but refuses the terminal marker until its objective completes', async () => {
      const f = finalPrefix()
      const rows = [...f.records, closure('complete', 17), { type: 'team/phase', phase: 'quiescing', createdAt: 18 },
        f.admission, f.quiesced(20)]
      const partial = checkpointFor(rows)
      const valid = await recover(backend, rows, partial, teamId, [f.final.channel])
      valid.teams.registerAdapter(retainedFinalAdapter)
      expect((await valid.teams.getTeam({ teamId })).team).toMatchObject({ phase: 'quiescing', goal: { phase: 'active' } })
      const invalid = await recover(backend, [...rows, { type: 'team/phase', phase: 'completed', createdAt: 21 }],
        partial, teamId, [f.final.channel], rows.length - 1)
      invalid.teams.registerAdapter(retainedFinalAdapter)
      await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow('cannot complete before its objective is complete')

      const settled = [...rows, goalChanged({ goal: goal({ revision: 2, phase: 'complete' }), createdAt: 21 }),
        { type: 'team/phase', phase: 'completed', createdAt: 22 }]
      const checkpoint = checkpointFor(settled)
      for (const phase of ['active', 'failed', 'completed']) {
        const currentGoal = phase === 'completed' ? { ...checkpoint.goal, phase: 'active' } : checkpoint.goal
        const damaged = { ...checkpoint, goal: currentGoal, team: { ...checkpoint.team, phase, goal: currentGoal } }
        const restored = await recover(backend, settled, damaged, teamId, [f.final.channel])
        restored.teams.registerAdapter(retainedFinalAdapter)
        expect((await restored.teams.getTeam({ teamId })).team).toEqual(checkpoint.team)
      }
    })

    it('rejects objective updates excluded by a retained closure intent', async () => {
      for (const kind of ['complete', 'fail'] as const) {
        const rows = [createdTeam(), teamPhase(), closure(kind, 12),
          { type: 'team/phase', phase: 'quiescing', createdAt: 13 }]
        checkpointFor(rows)
        const valid = await recover(backend, rows)
        expect((await valid.teams.getTeam({ teamId })).team.closure?.kind).toBe(kind)
        const phase = kind === 'complete' ? 'active' : 'complete'
        const invalid = await recover(backend, [...rows,
          goalChanged({ goal: goal({ revision: 2, phase, objective: 'A changed objective.' }), createdAt: 14 })])
        await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow('closure does not permit this goal change')
      }
    })

    it('continues an accepted completion through repeated stalls and a fresh quiescing transition', async () => {
      const f = finalPrefix(22, 23)
      const rows = [...f.records, closure('complete', 17),
        goalChanged({ goal: goal({ revision: 2, phase: 'complete' }), createdAt: 18 }),
        { type: 'team/phase', phase: 'quiescing', createdAt: 18 },
        { type: 'team/phase', phase: 'stalled', createdAt: 19, reason: { code: 'WAIT', message: 'The activation is still stopping.' } },
        { type: 'team/phase', phase: 'stalled', createdAt: 20, reason: { code: 'WAIT', message: 'Quiescence is still pending.' } },
        f.admission]
      const checkpoint = checkpointFor(rows)
      const settled = [...rows, f.quiesced(23),
        { type: 'team/phase', phase: 'quiescing', createdAt: 24 },
        { type: 'team/phase', phase: 'completed', createdAt: 24 }]
      const valid = await recover(backend, settled, checkpoint, teamId, [f.final.channel], rows.length - 1)
      valid.teams.registerAdapter(retainedFinalAdapter)
      expect((await valid.teams.getTeam({ teamId })).team).toMatchObject({ phase: 'completed', goal: { phase: 'complete' } })
    })

    it('rejects new failure and cancellation requests after a recovered terminal phase without an intent', async () => {
      const rows = [createdTeam(), teamPhase(),
        { type: 'team/phase', phase: 'quiescing', createdAt: 12 },
        { type: 'team/phase', phase: 'failed', createdAt: 13 }]
      const checkpoint = checkpointFor(rows)
      const valid = await recover(backend, rows, checkpoint)
      const state = await valid.teams.getTeam({ teamId })
      expect(state.team.phase).toBe('failed')
      expect(state.team.closure).toBeUndefined()
      const cancellation = { type: 'team/cancellation', createdAt: 14, cancellation: {
        teamId, idempotencyKey: 'late-cancellation', actor: { kind: 'system', name: 'team-run' },
        reason: { code: 'CANCEL', message: 'Cancellation was requested.' }, requestedAt: 14,
      } }
      for (const [record, message] of [
        [closure('fail', 14), "cannot request fail from 'failed'"],
        [cancellation, "cannot request cancellation from 'failed'"],
      ] as const) {
        const invalid = await recover(backend, [...rows, record], checkpoint, teamId, [], rows.length - 1)
        await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow(message)
      }
    })
  })
}
