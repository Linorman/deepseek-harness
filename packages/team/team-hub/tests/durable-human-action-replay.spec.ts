import { projectHumanAction } from '@clocky/clocky-team/selection'
import { teamHumanActionIdSchema, teamHumanActionSnapshotSchema, teamHumanActionReadRequestSchema } from '@clocky/clocky-team/schema'
/** Human-action admission and late settlement across durable Team closure. @module */

import { describe, expect, it, vi } from 'vitest'
import { retainedFinalAdapter, retainedFinalFixture } from './durable-final-fixtures.ts'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import type { DurableChannelFixture } from './durable-replay-fixtures.ts'
import { createdTeam, goal, goalChanged, participant, participantChanged, taskCreatorActivationId, taskCreatorId,
  taskCreatorSessionId, teamId, teamPhase } from './fixtures.ts'

function action(createdAt = 16) {
  return { id: 'question-a', teamId, kind: 'question', phase: 'pending', participantId: taskCreatorId,
    sessionId: taskCreatorSessionId, sourceId: 'rpc-a', details: { questionRpcId: 'rpc-a', questions: [] },
    createdAt, updatedAt: createdAt }
}

function actionRecord(value: object, createdAt: number) {
  return { type: 'human-action/changed', action: value, createdAt }
}

function closure(kind: 'complete' | 'fail' | 'cancel', createdAt: number) {
  return { type: 'team/closure', createdAt, closure: { teamId, kind, idempotencyKey: `close-${kind}`,
    actor: { kind: 'system', name: 'team-run' }, reason: { code: 'RUN_SETTLED', message: 'The run settled.' },
    requestedAt: createdAt, ...kind === 'complete' ? { finalChannelId: 'human-channel', finalEnvelopeId: 'final-a' } : {},
  } }
}

function fixture(kind: 'complete' | 'fail' | 'cancel', pending: boolean) {
  const final = kind === 'complete' ? retainedFinalFixture({ channelId: 'human-channel', senderId: taskCreatorId,
    memberAt: 14, createdAt: 17, admittedAt: 20, receiptAt: 21 }) : undefined
  const member = participant({ id: taskCreatorId, role: 'coordinator' })
  const binding = { activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
    sessionId: taskCreatorSessionId, provider: 'in-process' }
  const prefix = [createdTeam(), teamPhase(),
    participantChanged({ participant: member, createdAt: 12 }),
    participantChanged({ participant: { ...member, phase: 'provisioning' }, createdAt: 13 }),
    participantChanged({ participant: { ...member, phase: 'active' }, createdAt: 14 }),
    ...final?.memberRecords ?? [],
    { type: 'activation/changed', binding, createdAt: 15 },
    ...pending ? [actionRecord(action(), 16)] : [],
    ...final === undefined ? [] : [final.attachment],
    ...kind === 'complete' ? [goalChanged({ goal: goal({ phase: 'complete', revision: 2 }), createdAt: 17 })] : [],
  ]
  const intent = kind === 'cancel'
    ? { type: 'team/cancellation', createdAt: 18, cancellation: { teamId, idempotencyKey: 'close-cancel',
      actor: { kind: 'system', name: 'team-run' }, reason: { code: 'CANCELLED', message: 'Cancellation requested.' }, requestedAt: 18 } }
    : closure(kind, 18)
  const closing = [...prefix, intent, { type: 'team/phase', phase: 'quiescing', createdAt: 19 }]
  const offline = { type: 'activation/changed', binding: { ...binding, activation: { ...binding.activation, status: 'offline' },
    quiescedAt: 21, quiescenceSource: 'quiesced', quiescedWakeChannelIds: [] }, createdAt: 21 }
  const terminalPhase = kind === 'complete' ? 'completed' : kind === 'fail' ? 'failed' : 'cancelled'
  const terminal = [...pending ? [actionRecord({ ...action(), phase: 'cancelled', outcome: { reason: 'Run closed.' }, updatedAt: 20 }, 20)] : [],
    ...final === undefined ? [] : [final.admission],
    offline, ...kind === 'cancel' ? [closure('cancel', 22)] : [], { type: 'team/phase', phase: terminalPhase, createdAt: 23 }]
  checkpointFor([...closing, ...terminal])
  return { closing, terminal, terminalPhase,
    channels: final === undefined ? [] : [final.channel],
    pendingChannels: final === undefined ? [] : [final.pendingChannel],
  }
}

async function recoverHuman(
  backend: 'json' | 'sqlite',
  records: readonly unknown[],
  channels: readonly DurableChannelFixture[],
  checkpoint?: unknown,
  checkpointCursor?: number,
) {
  const ctx = await recover(backend, records, checkpoint, teamId, channels, checkpointCursor)
  if (channels.length > 0) ctx.teams.registerAdapter(retainedFinalAdapter)
  return ctx
}

for (const backend of ['json', 'sqlite'] as const) {
  describe(`durable human-action closure (${backend})`, () => {
    it('refuses a new question in a terminal journal without a closure intent', async () => {
      const { closing, terminal } = fixture('fail', false)
      const rows = [...closing, ...terminal].filter(record => record.type !== 'team/closure')
      checkpointFor(rows)
      const ctx = await recover(backend, [...rows, actionRecord(action(24), 24)])
      await expect(ctx.teams.getTeam({ teamId })).rejects.toThrow('terminal Team retains pending human action')
    })

    for (const kind of ['complete', 'fail', 'cancel'] as const) {
      it(`refuses new human work after ${kind} intent or terminal settlement`, async () => {
        const { closing, terminal, channels, pendingChannels } = fixture(kind, false)
        for (const value of [{ prefix: closing, channels: pendingChannels }, { prefix: [...closing, ...terminal], channels }]) {
          const late = action(24)
          const ctx = await recoverHuman(backend, [...value.prefix, actionRecord(late, 24)], value.channels)
          await expect(ctx.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
        }
      })

      it(`keeps pre-${kind} pending work recoverable until its exact late settlement`, async () => {
        const { closing, pendingChannels } = fixture(kind, true)
        const checkpoint = checkpointFor(closing)
        const pending = await recoverHuman(backend, closing, pendingChannels, checkpoint)
        expect((await pending.teams.getTeam({ teamId })).humanActions).toEqual([action()])
        for (const phase of ['resolved', 'cancelled'] as const) {
          const settled = { ...action(), phase, outcome: { answer: 'The request settled.' }, updatedAt: 20 }
          const rows = [...closing, actionRecord(settled, 20)]
          const reader = await recoverHuman(backend, rows, pendingChannels, checkpoint, closing.length - 1)
          expect((await reader.teams.getTeam({ teamId })).humanActions).toEqual([settled])
          const reopened = await recoverHuman(backend, [...rows, actionRecord({ ...action(), updatedAt: 21 }, 21)], pendingChannels)
          await expect(reopened.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
        }
      })

      it(`refuses ${kind} terminal journals and checkpoints that retain pending human work`, async () => {
        const { closing, terminal, terminalPhase, channels } = fixture(kind, true)
        const withoutSettlement = terminal.filter(record => record.type !== 'human-action/changed')
        const invalid = await recoverHuman(backend, [...closing, ...withoutSettlement], channels)
        await expect(invalid.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
        const rows = [...closing, ...terminal]
        const checkpoint = checkpointFor(rows)
        const restored = await recoverHuman(backend, rows, channels, { ...checkpoint, humanActions: [action()] })
        const state = await restored.teams.getTeam({ teamId })
        expect(state.team.phase).toBe(terminalPhase)
        expect(state.humanActions?.[0]?.phase).toBe('cancelled')
      })
    }
  })
}

it.each(['json', 'sqlite'] as const)('reads one durable action without copying the Team state (%s)', async (backend) => {
  const input = fixture('fail', true)
  const ctx = await recoverHuman(backend, input.closing, [])
  const expected = teamHumanActionSnapshotSchema.parse(action())
  const completeRead = vi.spyOn(ctx.teams, 'getTeam').mockRejectedValue(new Error('Full Team materialization forbidden'))
  const actual = await ctx.teams.getHumanAction({ teamId, actionId: expected.id })
  expect(actual).toEqual(expected)
  expect(Object.isFrozen(actual)).toBe(true)
  expect(completeRead).not.toHaveBeenCalled()
  await expect(ctx.teams.getHumanAction({ teamId, actionId: teamHumanActionIdSchema.parse('missing') }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  expect(teamHumanActionReadRequestSchema.safeParse({ teamId, actionId: expected.id, extra: true }).success).toBe(false)
  expect(projectHumanAction(expected, 1)).toEqual({ ok: false, reason: 'too-large' })
  expect(projectHumanAction(undefined, 16384)).toEqual({ ok: false, reason: 'missing' })
  const projected = projectHumanAction(expected, 16384)
  expect(projected).toEqual({ ok: true, value: expected })
  expect(projected.ok && projected.value === expected).toBe(false)
})

it.each(['json', 'sqlite'] as const)('rejects an oversized durable action (%s)', async (backend) => {
  const input = fixture('fail', true)
  const records = input.closing.map(record => record.type === 'human-action/changed'
    ? { ...record, action: { ...action(), details: { prompt: 'x'.repeat(20000) } } } : record)
  const ctx = await recoverHuman(backend, records, [])
  await expect(ctx.teams.getHumanAction({ teamId, actionId: teamHumanActionIdSchema.parse('question-a') }))
    .rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
})
