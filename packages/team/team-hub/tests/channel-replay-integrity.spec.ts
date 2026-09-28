import { describe, expect, it } from 'vitest'
import { channelRecordSchema } from '@clocky/clocky-team'
import type { ChannelRecord, TeamChannelAdapter } from '@clocky/clocky-team'
import { channelProjectionData, channelProjectionFromData, channelReplayWatermark, foldChannelRecord } from '../src/fold.ts'
import type { ChannelProjection } from '../src/types.ts'
import { channelAdmissionPrefix } from './durable-channel-fixtures.ts'
import { channelAdapter, channelEnvelope, channelOpened, channelReceipt, manifest, otherParticipantId, participantId } from './fixtures.ts'

const adapter: TeamChannelAdapter = {
  type: 'direct', version: 1, validateCreate() {}, validateSend() {}, initialState: () => null, fold: state => state,
  afterAccept: () => [], expectedNext: () => ({ kind: 'none' }), projectView: () => ({}),
  deliveryPlan: ({ envelope }) => [{ participantId, envelopeId: envelope.id, delivery: envelope.delivery }],
}

/** Replay only parsed records, preserving the stream cursor assigned by each append. */
function replay(records: readonly ChannelRecord[], protocol = adapter): ChannelProjection {
  let projection: ChannelProjection | undefined
  for (const record of records) projection = foldChannelRecord(projection, record, (projection?.cursor ?? -1) + 1, manifest().id, protocol)
  if (projection === undefined) throw new Error('Missing fixture opening')
  return projection
}

/** Append a durable JSON candidate through its real parser before validating cross-record relationships. */
function append(projection: ChannelProjection, record: unknown, protocol = adapter) {
  return foldChannelRecord(projection, channelRecordSchema.parse(record), projection.cursor + 1, projection.manifest.id, protocol)
}

const prefix = channelAdmissionPrefix(manifest(), 20, 30)
const pendingInvitation = prefix.find(record => record.type === 'channel/invitation')!
if (pendingInvitation.type !== 'channel/invitation') throw new Error('Missing fixture invitation')
const invitation = pendingInvitation.invitation

/** Demand the intended replay rejection rather than any parser or adapter failure. */
function rejects(operation: () => unknown, message: string) {
  expect(operation).toThrow(message)
  expect(operation).toThrow(expect.objectContaining({ code: 'TEAM_CHANNEL_WAL_MALFORMED' }))
}

describe('Channel WAL consent and delivery integrity', () => {
  it('rejects a second opening in an existing channel', () => {
    const opened = replay([channelOpened()])
    rejects(() => append(opened, { ...channelOpened(), sequence: 1 }), 'channel/opened appears after the first record')
  })

  it.each([
    ['duplicate invitation', {}],
    ['deadline already reached', { deadline: 20 }],
    ['revision does not start at one', { revision: 2 }],
  ])('rejects %s', (name, patch) => {
    const opened = replay(name === 'duplicate invitation' ? prefix.slice(0, 3) : prefix.slice(0, 2))
    rejects(() => append(opened, { type: 'channel/invitation', sequence: opened.cursor + 1, createdAt: 20,
      invitation: { ...invitation, ...patch } }), 'invalid opening invitation')
  })

  it.each([
    ['changed deadline', { deadline: 31 }],
    ['changed role', { role: 'other' }],
    ['changed fingerprint', { manifestFingerprint: 'sha256:' + 'a'.repeat(64) }],
  ])('rejects acknowledgement with %s', (_name, patch) => {
    const pending = replay(prefix.slice(0, 3))
    const message = 'role' in patch || 'manifestFingerprint' in patch ? 'invitation does not match its manifest' : 'invalid invitation transition'
    rejects(() => append(pending, { type: 'channel/acknowledged', sequence: pending.cursor + 1, createdAt: 21,
      invitation: { ...invitation, ...patch, status: 'acknowledged', acknowledgementKey: 'consent', settledAt: 21 } }), message)
  })

  it.each(['missing invitation', 'already acknowledged', 'closing', 'deadline reached'])('rejects acknowledgement after %s', (phase) => {
    let previous = replay(phase === 'missing invitation' ? prefix.slice(0, 2)
      : phase === 'already acknowledged' ? prefix : prefix.slice(0, 3))
    if (phase === 'closing') previous = append(previous, { type: 'channel/phase', sequence: previous.cursor + 1, createdAt: 21, phase: 'closing' })
    const createdAt = phase === 'deadline reached' ? 30 : 22
    rejects(() => append(previous, { type: 'channel/acknowledged', sequence: previous.cursor + 1, createdAt,
      invitation: { ...invitation, status: 'acknowledged', acknowledgementKey: 'consent', settledAt: createdAt } }),
    phase === 'closing' || phase === 'deadline reached' ? 'invitation status does not match its record' : 'invalid invitation transition')
  })

  it('rejects early invitation expiry', () => {
    const pending = replay(prefix.slice(0, 3))
    rejects(() => append(pending, { type: 'channel/invitation-ended', sequence: pending.cursor + 1, createdAt: 29,
      invitation: { ...invitation, status: 'expired', settledAt: 29, reason: { code: 'expired', message: 'Deadline reached' } } }),
    'invitation ended without a due deadline or structured reason')
  })

  it('requires protocol authorization before dropping an optional expired endpoint', () => {
    const optional = { ...invitation, required: false }
    const pending = append(replay(prefix.slice(0, 2)), { type: 'channel/invitation', sequence: 2, createdAt: 20, invitation: optional })
    const ended = { type: 'channel/invitation-ended', sequence: 3, createdAt: 30,
      invitation: { ...optional, status: 'expired', settledAt: 30, reason: { code: 'expired', message: 'Deadline reached' } } }
    rejects(() => append(pending, ended), 'optional invitation removal is not authorized by the protocol')
    expect(append(pending, ended, { ...adapter, allowParticipantRemoval: () => true }).invitations.get(participantId)?.status).toBe('expired')
  })

  it('rejects activation or closure while required invitations remain pending', () => {
    const pending = replay(prefix.slice(0, 3))
    rejects(() => append(pending, { type: 'channel/phase', sequence: 3, createdAt: 21, phase: 'active' }),
      'channel activated without every required endpoint acknowledgement')
    const closing = append(pending, { type: 'channel/phase', sequence: 3, createdAt: 21, phase: 'closing' })
    rejects(() => append(closing, { type: 'channel/closed', sequence: 4, createdAt: 22, phase: 'closed' }),
      'channel closed with pending invitations')
  })

  it('refuses messages before channel activation', () => {
    const pending = replay(prefix.slice(0, 3))
    rejects(() => append(pending, channelEnvelope({ envelope: { sequence: pending.cursor + 1 } })), 'Envelope accepted before channel admission')
  })

  it('rejects recipient-intent drift and duplicate pending deliveries', () => {
    const active = replay(prefix)
    const envelope = channelEnvelope({ envelope: { sequence: active.cursor + 1 } })
    rejects(() => append(active, { ...envelope, deliveryIntents: [] }), 'Envelope recipient intents differ from admitted endpoint plan')
    const delivered = append(active, envelope)
    rejects(() => append(delivered, channelEnvelope({ envelope: { sequence: delivered.cursor + 1 } })), 'repeats a pending delivery')
  })

  it.each([
    ['foreign message Team', () => channelEnvelope({ envelope: { teamId: 'other' } }), 'does not belong to channel'],
    ['foreign adapter', () => channelAdapter({ adapter: { type: 'other', version: 1 } }), 'adapter record does not match'],
    ['foreign receipt participant', () => channelReceipt({ participantId: otherParticipantId }), 'does not belong to channel'],
  ] as const)('rejects %s before calling the adapter', (_name, record, message) => {
    const active = replay(prefix)
    const next = record()
    const candidate = next.type === 'channel/envelope' ? { ...next, envelope: { ...next.envelope, sequence: active.cursor + 1 } }
      : { ...next, sequence: active.cursor + 1 }
    rejects(() => append(active, candidate), message)
  })

  it('requires a receipt to select a pending Envelope at its retained cursor', () => {
    const active = replay(prefix)
    rejects(() => append(active, channelReceipt({ sequence: active.cursor + 1 })), 'has no pending delivery')
    const delivered = append(active, channelEnvelope({ envelope: { sequence: active.cursor + 1 } }))
    rejects(() => append(delivered, channelReceipt({ sequence: delivered.cursor + 1, cursor: 0 })), 'does not match')
  })

  it('rejects repeated or unacknowledged invitations in an active checkpoint', () => {
    const active = replay(prefix)
    const checkpoint = channelProjectionData(active)
    expect(channelProjectionFromData(checkpoint).phase).toBe('active')
    rejects(() => channelProjectionFromData({ ...checkpoint, invitations: [...checkpoint.invitations, ...checkpoint.invitations] }),
      'checkpoint repeats a channel invitation')
    rejects(() => channelProjectionFromData({ ...checkpoint, invitations: [invitation] }), 'checkpoint activated an unacknowledged channel')
  })

  it('requires consent from a message sender and every explicit recipient', () => {
    const channelManifest = manifest({ adapter: { type: 'direct', version: 4 },
      participants: [{ id: participantId, role: 'reviewer' }, { id: otherParticipantId, role: 'observer' }] })
    const protocol = { ...adapter, version: 4 }
    const records = channelAdmissionPrefix(channelManifest, 20, 30)
    const selected = records.filter(record => record.type !== 'channel/acknowledged' || record.invitation.participantId === participantId)
      .map(record => record.type === 'channel/invitation' && record.invitation.participantId === otherParticipantId
        ? { ...record, invitation: { ...record.invitation, required: false } } : record)
      .map((record, sequence) => channelRecordSchema.parse({ ...record, sequence }))
    const active = replay(selected, protocol)
    rejects(() => append(active, channelEnvelope({ envelope: { sequence: active.cursor + 1, senderId: otherParticipantId } }), protocol),
      'Envelope sender has not acknowledged its invitation')
    const targetsAbsent = { ...protocol, deliveryPlan: ({ envelope }: Parameters<TeamChannelAdapter['deliveryPlan']>[0]) => [
      { participantId: otherParticipantId, envelopeId: envelope.id, delivery: envelope.delivery },
    ] }
    const explicit = channelEnvelope({ envelope: { sequence: active.cursor + 1, audience: [otherParticipantId] } })
    rejects(() => append(active, explicit, targetsAbsent),
      'Envelope targets an unacknowledged protocol recipient')
    rejects(() => append(active, channelEnvelope({ envelope: { sequence: active.cursor + 1 } }), targetsAbsent),
      'Envelope has no admitted recipient')
  })
})

it.each([
  { settledAt: 21 },
  { acknowledgementKey: 'consent' },
  { reason: { code: 'cancelled', message: 'Not cancelled' } },
])('rejects invitation settlement fields while status is pending: %j', (patch) => {
  const pending = replay(prefix.slice(0, 2))
  rejects(() => append(pending, { type: 'channel/invitation', sequence: pending.cursor + 1, createdAt: 20,
    invitation: { ...invitation, ...patch } }), 'invitation settlement fields do not match its status')
})

it('keeps a fully consumed recipient row from lowering the replay watermark', () => {
  const active = replay(prefix)
  const projection = { ...active, pendingDeliveries: new Map([[participantId, new Map()]]) }
  expect(channelReplayWatermark(projection)).toBe(active.cursor)
})
