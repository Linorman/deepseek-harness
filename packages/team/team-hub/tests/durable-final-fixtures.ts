/** Retained final-result facts for durable terminal Team fixtures. @module */

import { channelIdSchema, channelRecordSchema, fingerprintTeamFinalContent, fingerprintChannelManifest, channelManifestSchema } from '@clocky/clocky-team'
import type { ParticipantId, TeamChannelAdapter } from '@clocky/clocky-team'
import { channelProjectionData, foldChannelRecord } from '../src/fold.ts'
import { teamJournalRecordSchema } from '../src/schema.ts'
import type { DurableChannelFixture } from './durable-replay-fixtures.ts'
import { participant, participantChanged, teamId } from './fixtures.ts'

/** A stateless channel protocol that derives delivery from the persisted final audience. */
export const retainedFinalAdapter: TeamChannelAdapter = {
  type: 'durable-final-replay', version: 1,
  validateCreate() {}, initialState() { return null }, validateSend() {}, fold(state) { return state },
  afterAccept() { return [] }, expectedNext() { return { kind: 'none' } }, projectView() { return {} },
  deliveryPlan({ envelope }) {
    return (envelope.audience ?? []).map(participantId => ({ participantId, envelopeId: envelope.id, delivery: envelope.delivery }))
  },
}

interface FinalFixtureInput {
  readonly channelId: string
  readonly senderId: ParticipantId
  readonly memberAt: number
  readonly createdAt: number
  readonly admittedAt: number
  readonly receiptAt: number
}

/**
 * Construct a final WAL, independent result admission, human receipt, and attached recipient roster.
 * @param input - Exact sender, channel, and timestamps inserted by the owning Team fixture.
 * @returns Separate Team and channel facts, including the pending WAL prefix before admission.
 */
export function retainedFinalFixture(input: FinalFixtureInput) {
  const channelId = channelIdSchema.parse(input.channelId)
  const owner = { kind: 'system' as const }
  const human = participant({ id: 'retained-final-human', kind: 'human', role: 'human', owner })
  const memberRecords = [
    participantChanged({ participant: human, createdAt: input.memberAt }),
    participantChanged({ participant: { ...human, phase: 'provisioning' }, createdAt: input.memberAt }),
    participantChanged({ participant: { ...human, phase: 'active' }, createdAt: input.memberAt }),
  ]
  const payload = { text: 'The retained final result.' }
  const envelopeId = 'final-a'
  const manifest = channelManifestSchema.parse({ id: channelId, teamId,
    adapter: { type: retainedFinalAdapter.type, version: retainedFinalAdapter.version },
    participants: [{ id: input.senderId, role: 'coordinator' }, { id: human.id, role: 'human' }], limits: {} })
  const invitations = manifest.participants.map(member => ({ participantId: member.id, role: member.role,
    visibility: 'channel', required: true, deadline: input.receiptAt + 1,
    endpoint: { kind: member.id === human.id ? 'human' : 'activation' }, revision: 1,
    manifestFingerprint: fingerprintChannelManifest(manifest), status: 'pending' }))
  const prefix = [
    { type: 'channel/opened', sequence: 0, createdAt: input.createdAt, manifest },
    { type: 'channel/phase', sequence: 1, phase: 'pending', createdAt: input.createdAt },
    ...invitations.map((invitation, index) => ({ type: 'channel/invitation', sequence: 2 + index,
      createdAt: input.createdAt, invitation })),
    ...invitations.map((invitation, index) => ({ type: 'channel/acknowledged', sequence: 2 + invitations.length + index,
      createdAt: input.createdAt, invitation: { ...invitation, status: 'acknowledged',
        acknowledgementKey: `retained-final-consent:${invitation.participantId}`, settledAt: input.createdAt } })),
    { type: 'channel/phase', sequence: 2 + invitations.length * 2, phase: 'active', createdAt: input.createdAt },
  ]
  const envelopeSequence = prefix.length
  const attachment = teamJournalRecordSchema.parse({ type: 'channel/attached', channelId, createdAt: input.createdAt })
  const admission = teamJournalRecordSchema.parse({ type: 'team/final-admitted', createdAt: input.admittedAt, admission: {
    sink: 'team-run-result', teamId, channelId, envelopeId, envelopeSequence,
    contentFingerprint: fingerprintTeamFinalContent(payload), recipientId: human.id, owner,
    idempotencyKey: 'retained-final-fixture', admittedAt: input.admittedAt,
  } })
  const records = [
    ...prefix,
    { type: 'channel/envelope', deliveryIntents: [{ participantId: human.id, envelopeId, delivery: 'turn' }], envelope: { id: envelopeId, teamId, channelId, sequence: envelopeSequence,
      senderId: input.senderId, audience: [human.id], kind: 'final', payload, delivery: 'turn', priority: 'normal', createdAt: input.createdAt } },
    { type: 'channel/receipt', sequence: envelopeSequence + 1, createdAt: input.receiptAt, participantId: human.id, envelopeId, cursor: envelopeSequence },
    { type: 'channel/phase', sequence: envelopeSequence + 2, createdAt: input.receiptAt, phase: 'closing' },
    { type: 'channel/closed', sequence: envelopeSequence + 3, createdAt: input.receiptAt, phase: 'closed' },
  ]
  let projection
  for (const [cursor, record] of records.entries()) {
    projection = foldChannelRecord(projection, channelRecordSchema.parse(record), cursor, channelId, retainedFinalAdapter)
  }
  if (projection === undefined) throw new Error('final fixture requires a channel projection')
  const channel: DurableChannelFixture = { id: channelId, records, checkpoint: channelProjectionData(projection) }
  const pendingChannel: DurableChannelFixture = { id: channelId, records: records.slice(0, envelopeSequence + 1) }
  return { memberRecords, attachment, admission, channel, pendingChannel }
}
