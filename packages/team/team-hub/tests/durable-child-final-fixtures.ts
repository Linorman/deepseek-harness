/** Parent-service results for terminal child-Team resource fixtures. @module */
import { channelIdSchema, channelManifestSchema, channelRecordSchema, fingerprintChannelManifest,
  fingerprintTeamChildResultContent, teamChildRunBindingSchema, teamDelegationResultAdmissionSchema,
  teamIdSchema, teamTaskSnapshotSchema } from '@clocky/clocky-team'
import type { ParticipantId } from '@clocky/clocky-team'
import type { SessionId } from '@clocky/clocky-session'
import { consultChannelAdapter } from '@clocky/clocky-team-channel-basic'
import { FULL_TRANSCRIPT_VIEW_POLICY } from '@clocky/clocky-team-channel-direct'
import { channelProjectionData, foldChannelRecord } from '../src/fold.ts'
import { teamJournalRecordSchema } from '../src/schema.ts'
import { childUsageReservation } from './durable-child-fixtures.ts'
import { createdTeam, goal, participant, participantChanged, teamId, teamPhase } from './fixtures.ts'
import type { DurableChannelFixture, DurableTeamFixture } from './durable-replay-fixtures.ts'

export { consultChannelAdapter, FULL_TRANSCRIPT_VIEW_POLICY }

/**
 * Build the independently persisted parent sink and child service response for a terminal child.
 * @param senderId - Child coordinator that owns the final response.
 * @param sourceSessionId - Session that produced the outbound usage sample.
 * @returns Child roster/binding/result records, the settled consult WAL, and the parent journal.
 */
export function retainedChildFinalFixture(senderId: ParticipantId, sourceSessionId: SessionId) {
  const parentId = teamIdSchema.parse('parent-team')
  const reservation = childUsageReservation(teamId, 'parent-task', 6, parentId)
  const service = participant({ id: 'retained-parent-service', kind: 'service', role: 'parent-service' })
  const channelId = channelIdSchema.parse('final-channel')
  const binding = teamChildRunBindingSchema.parse({ parentTeamId: parentId, parentTaskId: reservation.reserved.id,
    childTeamId: teamId, delegationId: reservation.reserved.delegation!.id, parentServiceId: service.id, coordinatorId: senderId, channelId })
  const memberRecords = [participantChanged({ participant: service, createdAt: 14 }),
    participantChanged({ participant: { ...service, phase: 'provisioning' }, createdAt: 14 }),
    participantChanged({ participant: { ...service, phase: 'active' }, createdAt: 14 })]
  const manifest = channelManifestSchema.parse({ id: channelId, teamId, adapter: { type: 'consult', version: 1 },
    viewPolicy: { type: FULL_TRANSCRIPT_VIEW_POLICY.type, version: FULL_TRANSCRIPT_VIEW_POLICY.version },
    participants: [{ id: service.id, role: 'initiator' }, { id: senderId, role: 'respondent' }], limits: {} })
  const invitations = manifest.participants.map(member => ({ participantId: member.id, role: member.role,
    visibility: 'channel', required: true, deadline: 40,
    endpoint: member.id === service.id ? { kind: 'service', name: 'parent-service' } : { kind: 'activation' },
    revision: 1, manifestFingerprint: fingerprintChannelManifest(manifest), status: 'pending' }))
  const prefix = [{ type: 'channel/opened', sequence: 0, createdAt: 26, manifest },
    { type: 'channel/phase', sequence: 1, phase: 'pending', createdAt: 26 },
    ...invitations.map((invitation, index) => ({ type: 'channel/invitation', sequence: index + 2, createdAt: 26, invitation })),
    ...invitations.map((invitation, index) => ({ type: 'channel/acknowledged', sequence: index + 2 + invitations.length, createdAt: 26,
      invitation: { ...invitation, status: 'acknowledged', acknowledgementKey: `child-resource:${invitation.participantId}`, settledAt: 26 } })),
    { type: 'channel/phase', sequence: 2 + invitations.length * 2, phase: 'active', createdAt: 26 }]
  const request = { id: 'resource-child-request', teamId, channelId, sequence: prefix.length, senderId: service.id,
    audience: [senderId], kind: 'request', payload: { text: 'Complete the delegated work.' }, delivery: 'turn', priority: 'normal', createdAt: 26 }
  const response = { id: 'final-a', teamId, channelId, sequence: prefix.length + 2, senderId,
    audience: [service.id], kind: 'response', payload: { text: 'The retained child result.' }, delivery: 'turn', priority: 'normal', createdAt: 26,
    causationId: request.id }
  const records = [...prefix,
    { type: 'channel/envelope', envelope: request, deliveryIntents: [{ participantId: senderId, envelopeId: request.id, delivery: 'turn' }] },
    { type: 'channel/receipt', sequence: request.sequence + 1, createdAt: 26, participantId: senderId, envelopeId: request.id, cursor: request.sequence },
    { type: 'channel/envelope', envelope: response, deliveryIntents: [{ participantId: service.id, envelopeId: response.id, delivery: 'turn' }] },
    { type: 'channel/phase', phase: 'closing', sequence: response.sequence + 1, createdAt: 26 },
    { type: 'channel/closed', phase: 'closed', sequence: response.sequence + 2, createdAt: 26 },
    { type: 'channel/receipt', sequence: response.sequence + 3, createdAt: 31, participantId: service.id, envelopeId: response.id, cursor: response.sequence }]
  const charge = { id: 'charge-a', sourceTeamId: teamId, parentTaskId: reservation.reserved.id, originTeamId: teamId,
    sourceSampleId: 'sample-a', participantId: senderId, sessionId: sourceSessionId, provider: 'mock', model: 'model',
    turn: 1, step: 1, usage: { inputTokens: 2, outputTokens: 3 }, observedAt: 25 }
  const parentRecords = [createdTeam({ teamId: parentId, goal: goal({ teamId: parentId }), maxTeamDepth: 2, createdAt: 0 }),
    teamPhase({ createdAt: 1 }), ...reservation.records,
    { type: 'usage/child-charged', charge, createdAt: 25,
      usage: { inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 1, costUnits: 0, updatedAt: 25 } }]

  const parent = teamDelegationResultAdmissionSchema.parse({ binding, requestEnvelopeId: request.id, requestSequence: request.sequence,
    responseEnvelopeId: response.id, responseSequence: response.sequence, contentFingerprint: fingerprintTeamChildResultContent(response.payload),
    text: response.payload.text, artifacts: [], parentTaskRevision: reservation.reserved.revision + 1,
    parentCursor: parentRecords.length, admittedAt: 31 })
  const parentTask = teamTaskSnapshotSchema.parse({ ...reservation.reserved, revision: parent.parentTaskRevision,
    delegation: { ...reservation.reserved.delegation, phase: 'settling', result: parent, updatedAt: 31 } })
  const parentTeam: DurableTeamFixture = { id: parentId, records: [...parentRecords, { type: 'task/changed', task: parentTask, createdAt: 31 }] }
  let projection
  for (const [cursor, record] of records.entries()) projection = foldChannelRecord(projection, channelRecordSchema.parse(record), cursor, channelId, consultChannelAdapter)
  if (projection === undefined) throw new Error('Child final fixture requires a consult projection')
  const channel: DurableChannelFixture = { id: channelId, records, checkpoint: channelProjectionData(projection) }
  return { memberRecords, channel, parentTeam,
    attachment: teamJournalRecordSchema.parse({ type: 'channel/attached', channelId, createdAt: 26 }),
    bindingRecord: teamJournalRecordSchema.parse({ type: 'team/child-run-bound', binding, createdAt: 26 }),
    admission: teamJournalRecordSchema.parse({ type: 'team/child-result-admitted', admission: { parent, admittedAt: 31 }, createdAt: 31 }) }
}
