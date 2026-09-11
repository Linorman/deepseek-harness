/** Terminal Team facts must agree with their attached channel WALs after recovery. @module */

import { describe, expect, it, vi } from 'vitest'
import { channelIdSchema, channelRecordSchema, fingerprintTeamFinalContent, jsonValueSchema, participantIdSchema } from '@clocky/clocky-team'
import type { TeamChannelAdapter } from '@clocky/clocky-team'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { channelAdmissionPrefix } from './durable-channel-fixtures.ts'
import { createdTeam, goal, goalChanged, otherTeamId, participant, participantChanged, teamId, teamPhase } from './fixtures.ts'
import { channelProjectionData, foldChannelRecord } from '../src/fold.ts'
import { CHANNEL_WAL_FORMAT_VERSION } from '../src/types.ts'

const channelId = channelIdSchema.parse('terminal-channel')
const senderId = participantIdSchema.parse('sender')
const recipientId = participantIdSchema.parse('recipient')
const adapter: TeamChannelAdapter = {
  type: 'terminal-replay', version: 1,
  validateCreate() {}, initialState() { return null }, validateSend() {}, fold(state) { return state },
  afterAccept() { return [] }, expectedNext() { return { kind: 'none' } }, projectView() { return {} },
  deliveryPlan({ envelope }) {
    return (envelope.audience ?? []).map(participantId => ({ participantId, envelopeId: envelope.id, delivery: envelope.delivery }))
  },
}

function members(final = false) {
  const sender = participant({ id: 'sender', role: final ? 'coordinator' : 'sender' })
  const recipient = participant({ id: 'recipient', role: final ? 'human' : 'recipient', ...final ? { kind: 'human' } : {} })
  return [createdTeam(), teamPhase(),
    participantChanged({ participant: sender, createdAt: 12 }),
    participantChanged({ participant: { ...sender, phase: 'provisioning' }, createdAt: 13 }),
    participantChanged({ participant: { ...sender, phase: 'active' }, createdAt: 14 }),
    participantChanged({ participant: recipient, createdAt: 15 }),
    participantChanged({ participant: { ...recipient, phase: 'provisioning' }, createdAt: 16 }),
    participantChanged({ participant: { ...recipient, phase: 'active' }, createdAt: 17 }),
    { type: 'channel/attached', channelId, createdAt: 18 },
  ]
}

function journal(terminal: boolean) {
  return [...members(),
    { type: 'team/closure', createdAt: 20, closure: { teamId, kind: 'fail', idempotencyKey: 'terminal-replay',
      actor: { kind: 'system', name: 'team-run' }, reason: { code: 'RUN_FAILED', message: 'The run failed.' }, requestedAt: 20 } },
    { type: 'team/phase', phase: 'quiescing', createdAt: 21 },
    ...terminal ? [{ type: 'team/phase', phase: 'failed', createdAt: 30 }] : [],
  ]
}

function completedFixture(damage?: 'sink' | 'receipt' | 'envelope' | 'fingerprint') {
  const payload = { text: 'The retained final result.' }
  const envelopeId = damage === 'envelope' ? 'different-final' : 'final-a'
  const records = [
    ...members(true),
    goalChanged({ goal: goal({ phase: 'complete', revision: 2 }), createdAt: 20 }),
    { type: 'team/closure', createdAt: 21, closure: { teamId, kind: 'complete', idempotencyKey: 'terminal-final',
      actor: { kind: 'system', name: 'team-run' }, reason: { code: 'FINAL_ACCEPTED', message: 'The final was accepted.' },
      requestedAt: 21, finalChannelId: channelId, finalEnvelopeId: 'final-a' } },
    { type: 'team/phase', phase: 'quiescing', createdAt: 22 },
    ...damage === 'sink' ? [] : [{ type: 'team/final-admitted', createdAt: 23, admission: {
      sink: 'team-run-result', teamId, channelId, envelopeId: 'final-a', envelopeSequence: 7,
      contentFingerprint: fingerprintTeamFinalContent(damage === 'fingerprint' ? { text: 'Another result.' } : payload),
      recipientId: 'recipient', owner: { kind: 'system' }, idempotencyKey: 'terminal-final', admittedAt: 23,
    } }],
    { type: 'team/phase', phase: 'completed', createdAt: 30 },
  ]
  const manifest = {
    id: channelId,
    teamId,
    adapter: { type: adapter.type, version: adapter.version },
    participants: [
      { id: senderId, role: 'coordinator' },
      { id: recipientId, role: 'human' },
    ],
    limits: {},
  }
  const channel = [
    ...channelAdmissionPrefix(manifest, 18, 19, [recipientId]),
    { type: 'channel/envelope', deliveryIntents: [{ participantId: recipientId, envelopeId, delivery: 'turn' }],
      envelope: { id: envelopeId, teamId, channelId, sequence: 7,
        senderId, audience: [recipientId], kind: 'final', payload,
        delivery: 'turn', priority: 'normal', createdAt: 20 } },
    damage === 'receipt'
      ? { type: 'channel/delivery-expired', sequence: 8, createdAt: 24, participantId: recipientId, envelopeId, envelopeSequence: 7, reason: 'closure' }
      : { type: 'channel/receipt', sequence: 8, createdAt: 24, participantId: recipientId, envelopeId, cursor: 7 },
    { type: 'channel/phase', sequence: 9, createdAt: 25, phase: 'closing' },
    { type: 'channel/closed', sequence: 10, createdAt: 26, phase: 'closed' },
  ]
  let projection
  for (const [cursor, record] of channel.entries()) {
    projection = foldChannelRecord(projection, channelRecordSchema.parse(record), cursor, channelId, adapter)
  }
  if (projection === undefined) throw new Error('fixture did not fold a channel')
  checkpointFor(records)
  return { records, channel, checkpoint: channelProjectionData(projection) }
}

function wal(state: 'active' | 'pending' | 'settled') {
  const manifest = {
    id: channelId,
    teamId,
    adapter: { type: adapter.type, version: adapter.version },
    participants: [
      { id: senderId, role: 'sender' },
      { id: recipientId, role: 'recipient' },
    ],
    limits: {},
  }
  const rows: unknown[] = [...channelAdmissionPrefix(manifest, 18, 19)]
  if (state === 'active') return rows
  rows.push({ type: 'channel/envelope', deliveryIntents: [{ participantId: recipientId, envelopeId: 'delivery-a', delivery: 'context' }],
    envelope: { id: 'delivery-a', teamId, channelId, sequence: 7,
      senderId, audience: [recipientId], kind: 'message', payload: { text: 'An owned delivery.' },
      delivery: 'context', priority: 'normal', createdAt: 20 } })
  if (state === 'settled') rows.push({ type: 'channel/receipt', sequence: rows.length, createdAt: 22,
    participantId: recipientId, envelopeId: 'delivery-a', cursor: 7 })
  rows.push({ type: 'channel/phase', sequence: rows.length, createdAt: 23, phase: 'closing' })
  rows.push({ type: 'channel/closed', sequence: rows.length, createdAt: 24, phase: 'closed' })
  return rows
}

for (const backend of ['json', 'sqlite'] as const) {
  describe(`terminal channel recovery (${backend})`, () => {
    for (const damage of ['sink', 'receipt', 'envelope', 'fingerprint'] as const) {
      it(`rejects a completed Team with invalid ${damage} evidence across streams`, async () => {
        const fixture = completedFixture(damage)
        const ctx = await recover(backend, fixture.records, undefined, teamId, [{ id: channelId, records: fixture.channel }])
        ctx.teams.registerAdapter(adapter)
        await expect(ctx.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
      })
    }

    for (const compacted of [false, true]) {
      it(`reads a completed result from its retained WAL ${compacted ? 'suffix' : 'and checkpoint'}`, async () => {
        const fixture = completedFixture()
        const ctx = await recover(backend, fixture.records, checkpointFor(fixture.records), teamId,
          [{ id: channelId, records: fixture.channel, checkpoint: fixture.checkpoint }])
        ctx.teams.registerAdapter(adapter)
        if (compacted) {
          const stream = await ctx.storageLog.open({ name: `channel/${channelId}`, version: CHANNEL_WAL_FORMAT_VERSION })
          await stream.compact({ throughSequence: 1, expectedCheckpointSequence: fixture.channel.length - 1 })
          await stream.close()
        }
        expect((await ctx.teams.getTeam({ teamId })).team.phase).toBe('completed')
      })
    }

    for (const state of ['active', 'pending'] as const) {
      it(`rejects a terminal Team whose attached channel remains ${state}`, async () => {
        const ctx = await recover(backend, journal(true), undefined, teamId, [{ id: channelId, records: wal(state) }])
        ctx.teams.registerAdapter(adapter)
        await expect(ctx.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
      })
    }

    it('rejects an attached terminal WAL owned by a different Team', async () => {
      const records = wal('settled').map((value) => {
        const record = channelRecordSchema.parse(value)
        if (record.type === 'channel/opened') return { ...record, manifest: { ...record.manifest, teamId: otherTeamId } }
        if (record.type === 'channel/envelope') return { ...record, envelope: { ...record.envelope, teamId: otherTeamId } }
        return record
      })
      const ctx = await recover(backend, journal(true), undefined, teamId, [{ id: channelId, records }])
      ctx.teams.registerAdapter(adapter)
      await expect(ctx.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' })
    })

    it('replays the source journal when a completed checkpoint names different final content', async () => {
      const fixture = completedFixture()
      const data = checkpointFor(fixture.records)
      const checkpoint = { ...data, finalAdmission: { ...data.finalAdmission,
        contentFingerprint: fingerprintTeamFinalContent({ text: 'A result absent from the WAL.' }) } }
      const ctx = await recover(backend, fixture.records, checkpoint, teamId, [{ id: channelId, records: fixture.channel }])
      ctx.teams.registerAdapter(adapter)
      expect((await ctx.teams.getTeam({ teamId })).team.phase).toBe('completed')
    })

    it('reports an unavailable exact channel implementation while reading a terminal checkpoint', async () => {
      const rows = journal(true)
      const ctx = await recover(backend, rows, checkpointFor(rows), teamId, [{ id: channelId, records: wal('settled') }])
      await expect(ctx.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_ADAPTER_NOT_FOUND' })
    })

    it('keeps a closed channel with pending delivery legal until the Team is terminal', async () => {
      const ctx = await recover(backend, journal(false), undefined, teamId, [{ id: channelId, records: wal('pending') }])
      ctx.teams.registerAdapter(adapter)
      expect((await ctx.teams.getTeam({ teamId })).team.phase).toBe('quiescing')
      expect((await ctx.teams.getChannel({ channelId })).phase).toBe('closed')
    })

    it('accepts a terminal Team only after the channel and its delivery have settled', async () => {
      const ctx = await recover(backend, journal(true), undefined, teamId, [{ id: channelId, records: wal('settled') }])
      ctx.teams.registerAdapter(adapter)
      const [state, channel] = await Promise.all([ctx.teams.getTeam({ teamId }), ctx.teams.getChannel({ channelId })])
      expect(state.team.phase).toBe('failed')
      expect(channel.phase).toBe('closed')
    })

    it('replays a nonterminal journal when its checkpoint falsely claims channel settlement', async () => {
      const rows = journal(false)
      const data = checkpointFor(rows)
      const checkpoint = { ...data, team: { ...data.team, phase: 'failed' } }
      const ctx = await recover(backend, rows, checkpoint, teamId, [{ id: channelId, records: wal('pending') }])
      ctx.teams.registerAdapter(adapter)
      expect((await ctx.teams.getTeam({ teamId })).team.phase).toBe('quiescing')
    })

    it('preserves a channel storage failure instead of treating the Team checkpoint as damaged', async () => {
      const rows = journal(true)
      const ctx = await recover(backend, rows, checkpointFor(rows), teamId, [{ id: channelId, records: wal('settled') }])
      ctx.teams.registerAdapter(adapter)
      const failure = new Error('channel storage read is unavailable')
      const open = ctx.storageLog.open.bind(ctx.storageLog)
      let attempts = 0
      const observer = vi.spyOn(ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
        if (descriptor.name === `channel/${channelId}`) { attempts += 1; throw failure }
        return await open(descriptor)
      })
      try {
        await expect(ctx.teams.getTeam({ teamId })).rejects.toBe(failure)
        expect(attempts).toBe(1)
      } finally { observer.mockRestore() }
    })

    it('does not publish a terminal suffix appended outside Hub commands before validating channels', async () => {
      const rows = journal(false)
      const ctx = await recover(backend, rows, undefined, teamId, [{ id: channelId, records: wal('pending') }])
      ctx.teams.registerAdapter(adapter)
      const open = ctx.storageLog.open.bind(ctx.storageLog)
      let stream: Awaited<ReturnType<typeof open>> | undefined
      const observer = vi.spyOn(ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
        const opened = await open(descriptor)
        if (descriptor.name === `team/${teamId}`) stream = opened
        return opened
      })
      expect((await ctx.teams.getTeam({ teamId })).team.phase).toBe('quiescing')
      observer.mockRestore()
      if (stream === undefined) throw new Error('Hub did not open the observed source journal')
      await stream.append(rows.length - 1, [jsonValueSchema.parse({ type: 'team/phase', phase: 'failed', createdAt: 30 })])
      await expect(ctx.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
    })
  })
}
