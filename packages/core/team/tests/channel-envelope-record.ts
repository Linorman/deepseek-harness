/** Explicit recipient metadata for adapter and delivery notification fixtures. */
import type { ChannelEnvelopeRecord, ParticipantId, TeamEnvelope } from '@clocky/clocky-team'

/**
 * Preserve an Envelope's actual audience without assuming a roster for broadcast.
 * @param envelope - stamped protocol input under test.
 * @param participants - exact manifest member ids, required only for null broadcast.
 * @returns a record with ordered, recipient-specific delivery intents.
 */
export function recordEnvelope(envelope: TeamEnvelope, participants?: readonly ParticipantId[]): ChannelEnvelopeRecord {
  if (envelope.audience === null && participants === undefined) throw new Error('Broadcast record requires its actual manifest roster')
  const recipients = envelope.audience ?? participants!.filter(id => id !== envelope.senderId)
  return { type: 'channel/envelope', envelope,
    deliveryIntents: recipients.map(participantId => ({ participantId, envelopeId: envelope.id, delivery: envelope.delivery })) }
}
