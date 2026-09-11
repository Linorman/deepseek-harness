/** Complete admission facts shared by serialized channel replay fixtures. @module */
import { channelRecordSchema, fingerprintChannelManifest } from '@clocky/clocky-team'
import type { ChannelManifest, ChannelRecord, ParticipantId } from '@clocky/clocky-team'

/**
 * Build a channel prefix with explicit consent from every immutable endpoint.
 * @param manifest - Exact channel manifest retained by the fixture.
 * @param createdAt - Timestamp of the opening and consent facts.
 * @param deadline - Invitation expiry after the accepted consent timestamp.
 * @param humanIds - Members whose endpoints are human rather than activation-backed.
 * @returns Parsed opening, invitation, acknowledgement, and activation records.
 */
export function channelAdmissionPrefix(
  manifest: ChannelManifest, createdAt: number, deadline: number, humanIds: readonly ParticipantId[] = [],
): readonly ChannelRecord[] {
  const invitations = manifest.participants.map(member => ({ participantId: member.id, role: member.role,
    visibility: 'channel', required: true, deadline,
    endpoint: { kind: humanIds.includes(member.id) ? 'human' : 'activation' }, revision: 1,
    manifestFingerprint: fingerprintChannelManifest(manifest), status: 'pending' }))
  return [
    { type: 'channel/opened', sequence: 0, createdAt, manifest },
    { type: 'channel/phase', sequence: 1, phase: 'pending', createdAt },
    ...invitations.map((invitation, index) => ({ type: 'channel/invitation', sequence: 2 + index, createdAt, invitation })),
    ...invitations.map((invitation, index) => ({ type: 'channel/acknowledged', sequence: 2 + invitations.length + index,
      createdAt, invitation: { ...invitation, status: 'acknowledged', acknowledgementKey: `fixture-consent:${invitation.participantId}`, settledAt: createdAt } })),
    { type: 'channel/phase', sequence: 2 + invitations.length * 2, phase: 'active', createdAt },
  ].map(record => channelRecordSchema.parse(record))
}
