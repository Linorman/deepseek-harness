import { fingerprintChannelSummarySources, teamEnvelopeSchema } from '@clocky/clocky-team'
/** Channel receipt and summary provenance through real stored WAL/checkpoint recovery. @module */

import { describe, expect, it } from 'vitest'
import { channelIdSchema, channelRecordSchema, channelManifestSchema } from '@clocky/clocky-team'
import type { TeamChannelAdapter } from '@clocky/clocky-team'
import { channelProjectionData, foldChannelRecord } from '../src/fold.ts'
import { createdTeam, participant, participantChanged, teamId, teamPhase } from './fixtures.ts'
import { recover } from './durable-replay-fixtures.ts'
import { channelAdmissionPrefix } from './durable-channel-fixtures.ts'

/** A stateless fixture protocol with ordinary audience-derived recipient delivery. */
const adapter: TeamChannelAdapter = {
  type: 'durable-replay', version: 1,
  validateCreate() {}, initialState() { return null }, validateSend() {}, fold(state) { return state },
  afterAccept() { return [] }, expectedNext() { return { kind: 'none' } }, projectView() { return {} },
  deliveryPlan({ manifest, envelope }) {
    const recipients = envelope.audience ?? manifest.participants.map(member => member.id).filter(id => id !== envelope.senderId)
    return recipients.map(participantId => ({ participantId, envelopeId: envelope.id, delivery: envelope.delivery }))
  },
}
const channelId = channelIdSchema.parse('channel-a')

function journal() {
  const a = participant({ id: 'sender', role: 'sender' })
  const b = participant({ id: 'recipient', role: 'recipient' })
  return [createdTeam(), teamPhase(),
    participantChanged({ participant: a, createdAt: 12 }),
    participantChanged({ participant: { ...a, phase: 'provisioning' }, createdAt: 13 }),
    participantChanged({ participant: { ...a, phase: 'active' }, createdAt: 14 }),
    participantChanged({ participant: b, createdAt: 15 }),
    participantChanged({ participant: { ...b, phase: 'provisioning' }, createdAt: 16 }),
    participantChanged({ participant: { ...b, phase: 'active' }, createdAt: 17 }),
    { type: 'channel/attached', channelId, createdAt: 18 },
  ]
}

function wal() {
  const manifest = channelManifestSchema.parse({ id: channelId, teamId, adapter: { type: adapter.type, version: adapter.version },
    participants: [{ id: 'sender', role: 'sender' }, { id: 'recipient', role: 'recipient' }], limits: {} })
  const prefix = channelAdmissionPrefix(manifest, 18, 30)
  const envelope = teamEnvelopeSchema.parse({ id: 'message-1', teamId, channelId, sequence: prefix.length,
    senderId: 'sender', audience: ['recipient'], kind: 'message', payload: { text: 'Retain this delivery.' },
    delivery: 'context', priority: 'normal', ttlMs: 10, createdAt: 20 })
  const records = [...prefix, channelRecordSchema.parse({ type: 'channel/envelope', envelope,
    deliveryIntents: [{ participantId: 'recipient', envelopeId: envelope.id, delivery: 'context' }] })]
  checkpoint(records)
  return records
}

function sourceEnvelope() {
  const record = wal().find(record => record.type === 'channel/envelope')
  if (record?.type !== 'channel/envelope') throw new Error('channel fixture requires its source Envelope')
  return record.envelope
}

function summary(sequence = wal().length) {
  const source = sourceEnvelope()
  return { type: 'channel/summary', sequence, createdAt: 20 + sequence, coveredSequenceRange: { from: source.sequence, to: source.sequence },
    sourceEnvelopeIds: [source.id], sourceFingerprint: fingerprintChannelSummarySources([source]), text: 'One retained delivery.',
    policy: { type: 'brief', version: 1 }, idempotencyKey: 'summary-1' }
}

function checkpoint(records: readonly unknown[]) {
  let projection
  for (const [cursor, value] of records.entries()) {
    projection = foldChannelRecord(projection, channelRecordSchema.parse(value), cursor, channelId, adapter)
  }
  if (projection === undefined) throw new Error('channel checkpoint requires an opening record')
  return channelProjectionData(projection)
}

for (const backend of ['json', 'sqlite'] as const) {
  describe(`durable channel replay (${backend})`, () => {
    it('rejects an expiry whose source sequence differs from its pending Envelope', async () => {
      const rows = [...wal(), { type: 'channel/delivery-expired', sequence: wal().length, createdAt: 30,
        participantId: 'recipient', envelopeId: 'message-1', envelopeSequence: sourceEnvelope().sequence - 1 }]
      const ctx = await recover(backend, journal(), undefined, teamId, [{ id: channelId, records: rows }])
      ctx.teams.registerAdapter(adapter)
      await expect(ctx.teams.getChannel({ channelId })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' })
    })

    it('rejects summary self-inclusion and duplicate durable summary keys', async () => {
      const variants = [
        [...wal(), { ...summary(), coveredSequenceRange: { from: sourceEnvelope().sequence, to: summary().sequence } }],
        [...wal(), summary(), summary(summary().sequence + 1)],
      ]
      for (const records of variants) {
        const ctx = await recover(backend, journal(), undefined, teamId, [{ id: channelId, records }])
        ctx.teams.registerAdapter(adapter)
        await expect(ctx.teams.getChannel({ channelId })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' })
      }
    })

    it('rejects a summary whose stored fingerprint differs from its actual source content', async () => {
      const records = [...wal(), { ...summary(), sourceFingerprint: `sha256:${'0'.repeat(64)}` }]
      const ctx = await recover(backend, journal(), undefined, teamId, [{ id: channelId, records }])
      ctx.teams.registerAdapter(adapter)
      await expect(ctx.teams.getChannel({ channelId })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' })
    })

    it('rejects a private-source summary even when its stored fingerprint is accurate', async () => {
      const records = wal()
      const source = teamEnvelopeSchema.parse({ ...sourceEnvelope(), audience: [] })
      const rewritten = records.map(record => record.type === 'channel/envelope' ? { type: 'channel/envelope', envelope: source, deliveryIntents: [] } : record)
      const forged = { ...summary(), sourceFingerprint: fingerprintChannelSummarySources([source]) }
      const ctx = await recover(backend, journal(), undefined, teamId, [{ id: channelId, records: [...rewritten, forged] }])
      ctx.teams.registerAdapter(adapter)
      await expect(ctx.teams.getChannel({ channelId })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' })
    })

    it('falls back from duplicate pending or summary checkpoint identities without losing the original delivery', async () => {
      const rows = [...wal(), summary(), { type: 'channel/phase', sequence: summary().sequence + 1, createdAt: summary().createdAt + 1, phase: 'closing' },
        { type: 'channel/closed', sequence: summary().sequence + 2, createdAt: summary().createdAt + 2, phase: 'closed' }]
      const valid = checkpoint(rows)
      const pending = valid.pendingDeliveries[0]
      if (pending === undefined) throw new Error('fixture omitted its pending recipient')
      const variants = [
        { ...valid, pendingDeliveries: [pending, { ...pending, envelopeSequence: sourceEnvelope().sequence + 1 }] },
        { ...valid, summaries: [{ ...summary(), coveredSequenceRange: { from: sourceEnvelope().sequence, to: summary().sequence } }] },
        { ...valid, summaries: [summary(), summary(summary().sequence + 1)] },
        { ...valid, summaries: [{ ...summary(), sourceFingerprint: `sha256:${'0'.repeat(64)}` }] },
      ]
      for (const data of variants) {
        const ctx = await recover(backend, journal(), undefined, teamId, [{ id: channelId, records: rows, checkpoint: data }])
        ctx.teams.registerAdapter(adapter)
        expect(await ctx.teams.getChannel({ channelId })).toMatchObject({ phase: 'closed', cursor: rows.length - 1 })
        const retained = await ctx.teams.readChannel({ channelId, afterCursor: -1 })
        expect(retained.records.filter(record => record.type === 'channel/envelope')).toHaveLength(1)
      }
    })
  })
}
