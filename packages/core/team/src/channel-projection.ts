/** Pure transcript fields shared by protocol-owned channel views. */
import type { ChannelRecord, DeliveryIntent, JsonObject, ParticipantId, TeamEnvelope } from './types.ts'

/** Resolve multicast recipients after the protocol has validated its Envelope.
 * @param envelope - Validated Envelope with explicit or broadcast audience.
 * @param participants - Protocol-validated participant identities in manifest order.
 * @returns frozen delivery intents in audience order, excluding the sender from a broadcast.
 */
export function channelAudienceDeliveryIntents(
  envelope: TeamEnvelope, participants: readonly ParticipantId[],
): readonly DeliveryIntent[] {
  const audience = envelope.audience === null
    ? participants.filter(participantId => participantId !== envelope.senderId)
    : [...envelope.audience]
  return Object.freeze(audience.map(participantId => Object.freeze({
    participantId, envelopeId: envelope.id, delivery: envelope.delivery,
  } satisfies DeliveryIntent)))
}

/**
 * Project accepted Envelopes in WAL order, leaving protocol state and visibility to the caller.
 * @param records - Validated channel records selected by the owning adapter.
 * @returns A frozen message list containing each Envelope's id, sender, kind and original payload.
 */
export function channelEnvelopeMessages(records: readonly ChannelRecord[]): readonly JsonObject[] {
  return Object.freeze(records.flatMap(record => record.type === 'channel/envelope'
    ? [{ id: record.envelope.id, senderId: record.envelope.senderId, kind: record.envelope.kind, payload: record.envelope.payload }]
    : []))
}
