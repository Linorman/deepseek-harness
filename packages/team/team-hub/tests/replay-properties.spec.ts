import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  channelIdSchema,
  channelManifestSchema,
  channelRecordSchema,
  fingerprintChannelManifest,
  participantIdSchema,
  teamEnvelopeSchema,
  teamIdSchema,
} from '@clocky/clocky-team'
import type {
  ChannelRecord,
  TeamChannelAdapter,
  TeamEnvelope,
} from '@clocky/clocky-team'
import {
  channelProjectionData,
  channelProjectionFromData,
  channelReplayWatermark,
  foldChannelRecord,
} from '../src/fold.ts'
import { channelAdmissionPrefix } from './durable-channel-fixtures.ts'

const teamId = teamIdSchema.parse('team-replay-properties')
const channelId = channelIdSchema.parse('channel-replay-properties')
const senderId = participantIdSchema.parse('participant-replay-sender')
const firstRecipientId = participantIdSchema.parse('participant-replay-first')
const secondRecipientId = participantIdSchema.parse('participant-replay-second')

/** Adapter used to generate two-recipient delivery and exercise receipt order independently. */
const adapter: TeamChannelAdapter = {
  type: 'replay-properties',
  version: 1,
  validateCreate() {},
  initialState() {
    return { envelopes: 0, receipts: 0 }
  },
  validateSend() {},
  fold(state, record) {
    const current = state as { readonly envelopes?: number; readonly receipts?: number }
    return {
      envelopes: (current.envelopes ?? 0) + (record.type === 'channel/envelope' ? 1 : 0),
      receipts: (current.receipts ?? 0) + (record.type === 'channel/receipt' ? 1 : 0),
    }
  },
  afterAccept() {
    return []
  },
  expectedNext() {
    return { kind: 'none' }
  },
  deliveryPlan({ envelope }) {
    return [firstRecipientId, secondRecipientId].map(participantId => ({
      participantId,
      envelopeId: envelope.id,
      delivery: envelope.delivery,
    }))
  },
  projectView() {
    return {}
  },
}

const manifest = channelManifestSchema.parse({
  id: channelId,
  teamId,
  adapter: { type: adapter.type, version: adapter.version },
  participants: [
    { id: senderId, role: 'sender' },
    { id: firstRecipientId, role: 'first-recipient' },
    { id: secondRecipientId, role: 'second-recipient' },
  ],
  limits: {},
})

type ReceiptChoice = Readonly<{ readonly first: boolean; readonly second: boolean }>

/** Fold one valid channel record at the next storage cursor. */
function append(
  projection: ReturnType<typeof foldChannelRecord> | undefined,
  record: ChannelRecord,
  cursor: number,
): ReturnType<typeof foldChannelRecord> {
  return foldChannelRecord(projection, record, cursor, channelId, adapter)
}

/** Derive the watermark independently of the Hub implementation under test. */
function expectedReplayWatermark(projection: ReturnType<typeof foldChannelRecord>): number {
  const pending = [...projection.pendingDeliveries.values()].flatMap(deliveries => [...deliveries.values()])
  if (pending.length === 0) return projection.cursor
  return Math.min(...pending.map(delivery => delivery.envelopeSequence)) - 1
}

/** Construct one immutable Envelope whose source cursor is supplied by the caller. */
function envelope(index: number, sequence: number): TeamEnvelope {
  return teamEnvelopeSchema.parse({
    id: `envelope-replay-${String(index)}`,
    teamId,
    channelId,
    sequence,
    senderId,
    audience: [firstRecipientId, secondRecipientId],
    kind: 'message',
    payload: { index },
    delivery: 'context',
    priority: 'normal',
    createdAt: sequence,
  })
}

/** Build the opening projection before generated Envelope/receipt operations run. */
function opening(): ReturnType<typeof foldChannelRecord> {
  let projection: ReturnType<typeof foldChannelRecord> | undefined
  for (const [cursor, record] of channelAdmissionPrefix(manifest, 0, 30).entries()) {
    projection = append(projection, record, cursor)
  }
  if (projection === undefined) throw new Error('channel admission prefix did not produce a projection')
  return projection
}

describe('Team Hub replay watermark properties', () => {
  it('preserves pending order, replay watermark, and checkpoint state for arbitrary receipt interleavings', () => {
    fc.assert(fc.property(
      fc.array(fc.record({ first: fc.boolean(), second: fc.boolean() }), { maxLength: 30 }),
      (choices: readonly ReceiptChoice[]) => {
        let projection = opening()
        let cursor = projection.cursor + 1
        const sourceSequences = new Map<string, number>()

        for (const [index, choice] of choices.entries()) {
          const value = envelope(index, cursor)
          sourceSequences.set(value.id, value.sequence)
          projection = append(projection, channelRecordSchema.parse({
            type: 'channel/envelope',
            envelope: value,
            deliveryIntents: [firstRecipientId, secondRecipientId].map(participantId => ({
              participantId,
              envelopeId: value.id,
              delivery: value.delivery,
            })),
          }), cursor)
          cursor += 1
          const receipts: readonly [typeof firstRecipientId, boolean][] = [
            [firstRecipientId, choice.first],
            [secondRecipientId, choice.second],
          ]
          for (const [participantId, selected] of receipts) {
            if (!selected) continue
            projection = append(projection, channelRecordSchema.parse({
              type: 'channel/receipt',
              sequence: cursor,
              createdAt: cursor,
              participantId,
              envelopeId: value.id,
              cursor: sourceSequences.get(value.id),
            }), cursor)
            cursor += 1
          }
        }

        expect(projection.cursor).toBe(cursor - 1)
        expect(channelReplayWatermark(projection)).toBe(expectedReplayWatermark(projection))
        expect(expectedReplayWatermark(projection)).toBeGreaterThanOrEqual(-1)
        for (const deliveries of projection.pendingDeliveries.values()) {
          for (const delivery of deliveries.values()) {
            expect(delivery.envelopeSequence).toBeGreaterThan(expectedReplayWatermark(projection))
          }
        }

        const checkpoint = channelProjectionData(projection)
        const restored = channelProjectionFromData(checkpoint)
        expect(restored).toEqual(projection)
        expect(channelProjectionData(restored)).toEqual(checkpoint)
      },
    ), { numRuns: 100, seed: 20260909 })
  })

  it('keeps the empty-pending watermark at the channel cursor', () => {
    const projection = opening()
    expect(channelReplayWatermark(projection)).toBe(expectedReplayWatermark(projection))
    expect(expectedReplayWatermark(projection)).toBe(projection.cursor)
    expect(channelProjectionFromData(channelProjectionData(projection))).toEqual(projection)
  })
})

describe('Team Hub invitation revision properties', () => {
  it('accepts each endpoint at most once, preserves ack order, and rejects revision drift', () => {
    const result = fc.check(fc.property(
      fc.record({
        selected: fc.array(fc.integer({ min: 0, max: 2 }), { maxLength: 3 }).map(values => [...new Set(values)]),
        revisions: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 3, maxLength: 3 }),
      }),
      ({ selected, revisions }) => {
        const prefix = channelAdmissionPrefix(manifest, 0, 30).slice(0, 2 + manifest.participants.length)
        let projection: ReturnType<typeof foldChannelRecord> | undefined
        for (const [cursor, record] of prefix.entries()) projection = append(projection, record, cursor)
        if (projection === undefined) throw new Error('invitation prefix did not produce a projection')
        let cursor = projection.cursor + 1
        const selectedSet = new Set(selected)
        for (const index of selected) {
          const participant = manifest.participants[index]
          if (participant === undefined) throw new Error('invitation property selected an unknown participant')
          const invitation = {
            participantId: participant.id,
            role: participant.role,
            visibility: 'channel' as const,
            required: true,
            deadline: 30,
            endpoint: { kind: 'activation' as const },
            revision: revisions[index]!,
            manifestFingerprint: fingerprintChannelManifest(manifest),
            status: 'acknowledged' as const,
            acknowledgementKey: `property-ack:${String(participant.id)}`,
            settledAt: 10,
          }
          const record = channelRecordSchema.parse({ type: 'channel/acknowledged', sequence: cursor, createdAt: 10, invitation })
          if (revisions[index] !== 1) {
            expect(() => append(projection, record, cursor)).toThrow()
            return
          }
          projection = append(projection, record, cursor)
          cursor += 1
        }
        if (selectedSet.size === manifest.participants.length) {
          projection = append(projection, channelRecordSchema.parse({ type: 'channel/phase', sequence: cursor, createdAt: 10, phase: 'active' }), cursor)
        }
        if (projection === undefined) throw new Error('invitation property lost its projection')
        expect(projection.phase).toBe(selectedSet.size === manifest.participants.length ? 'active' : 'pending')
        for (const [index, participant] of manifest.participants.entries()) {
          expect(projection.invitations.get(participant.id)?.status).toBe(selectedSet.has(index) ? 'acknowledged' : 'pending')
        }
        expect(channelProjectionFromData(channelProjectionData(projection))).toEqual(projection)
      },
    ), { numRuns: 100, seed: 20260911 })
    if (result.failed) throw new Error(`invitation property counterexample: ${JSON.stringify(result)}`)
  })
})
