/** Bounded personnel responsibility inventory; coverage and unresolved work are separate from retirement authorization. */
import { z } from 'zod'
import { teamIdSchema, participantIdSchema, teamTaskIdSchema, taskAttemptIdSchema,
  channelIdSchema, envelopeIdSchema, activationIdSchema, activationReservationIdSchema,
  teamWorkspaceAllocationIdSchema } from '@clocky/clocky-team/schema'
import { simulationEntityIdSchema, simulationRelationIdSchema } from './entity.ts'
import { simulationRunIdSchema } from './schema.ts'
import { simulationDecisionIdSchema, simulationOperationIdSchema, simulationDecisionSlotSchema,
  simulationResourceIdSchema, simulationGrantIdSchema } from './business.ts'
import { simulationInteractionIdSchema, simulationCommitmentIdSchema } from './interaction.ts'
import { simulationWriterEpochSchema } from './writer.ts'
import { simulationEventIdSchema, simulationEventKeySchema } from './scheduler.ts'
import { worldIntentIdSchema } from './world-domain.ts'
import { worldRequestIdSchema, worldPlanIdSchema } from './world.ts'
import { simTimeSchema } from './time.ts'

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const revision = count.positive()
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/)
/** Control-plane inventory has its own finite per-call item cap; entries contain references, never task or message bodies. */
export const PERSONNEL_OBLIGATION_MAX_ITEMS = 1024
/** Maximum complete JSON envelope protects API/SDK consumers from an unbounded one-call inventory response. */
export const PERSONNEL_OBLIGATION_MAX_BYTES = 1024 * 1024

/** Caller-selected identity/revision fence; an assignment selector verifies both its subject and original revision. */
export const personnelObligationSelectorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('person'), personId: simulationEntityIdSchema, personRevision: revision }),
  z.strictObject({ kind: z.literal('assignment'), personId: simulationEntityIdSchema, personRevision: revision,
    assignmentId: simulationRelationIdSchema, assignmentRevision: revision }),
])
/** Strict read-only inventory request; finite limits apply to the complete result, including coverage metadata. */
export const personnelObligationQuerySchema = z.strictObject({ selector: personnelObligationSelectorSchema,
  limit: revision.max(PERSONNEL_OBLIGATION_MAX_ITEMS), maxBytes: revision.max(PERSONNEL_OBLIGATION_MAX_BYTES) })
/** Exact owned responsibilities; no arbitrary object path or invented Team revision can act as a reference. */
export const personnelObligationReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('decision'), id: simulationDecisionIdSchema, epoch: simulationWriterEpochSchema,
    slot: simulationDecisionSlotSchema }),
  z.strictObject({ kind: z.literal('operation'), id: simulationOperationIdSchema, decisionId: simulationDecisionIdSchema,
    index: count, fingerprint: z.string().min(1) }),
  z.strictObject({ kind: z.literal('outbox'), operationId: simulationOperationIdSchema, fingerprint: z.string().min(1),
    attempt: count.positive().nullable() }),
  z.strictObject({ kind: z.literal('task-assignment'), teamId: teamIdSchema, taskId: teamTaskIdSchema,
    attemptId: taskAttemptIdSchema, operationId: simulationOperationIdSchema, selectedRevision: revision, reservedSequence: revision }),
  z.strictObject({ kind: z.literal('task-execution'), teamId: teamIdSchema, taskId: teamTaskIdSchema,
    attemptId: taskAttemptIdSchema, selectedRevision: revision, observedRevision: revision.nullable() }),
  z.strictObject({ kind: z.literal('task-target'), teamId: teamIdSchema, taskId: teamTaskIdSchema,
    operationId: simulationOperationIdSchema, fingerprint: z.string().min(1) }),
  z.strictObject({ kind: z.literal('interaction'), id: simulationInteractionIdSchema, revision }),
  z.strictObject({ kind: z.literal('commitment'), id: simulationCommitmentIdSchema, revision }),
  z.strictObject({ kind: z.literal('resource'), id: simulationResourceIdSchema, revision, relation: z.enum(['owner', 'controller']) }),
  z.strictObject({ kind: z.literal('resource-grant'), id: simulationGrantIdSchema, revision, relation: z.enum(['issuer', 'grantee']) }),
  z.strictObject({ kind: z.literal('scheduled-event'), id: simulationEventIdSchema, key: simulationEventKeySchema }),
  z.strictObject({ kind: z.literal('wake'), eventId: simulationEventIdSchema, decisionId: simulationDecisionIdSchema.nullable() }),
  z.strictObject({ kind: z.literal('message'), operationId: simulationOperationIdSchema, channelId: channelIdSchema,
    recipientEntityId: simulationEntityIdSchema, direction: z.enum(['incoming', 'outgoing']), envelopeId: envelopeIdSchema.nullable() }),
  z.strictObject({ kind: z.literal('relation'), id: simulationRelationIdSchema, revision, relation: z.string().min(1),
    subject: simulationEntityIdSchema, object: simulationEntityIdSchema, scope: simulationEntityIdSchema.nullable(),
    validFrom: simTimeSchema, validUntil: simTimeSchema.nullable() }),
  z.strictObject({ kind: z.literal('writer'), entityId: simulationEntityIdSchema, epoch: simulationWriterEpochSchema,
    reservationId: activationReservationIdSchema, activationId: activationIdSchema.nullable() }),
  z.strictObject({ kind: z.literal('world-reservation'), intentId: worldIntentIdSchema, requestId: worldRequestIdSchema,
    planId: worldPlanIdSchema, updatedSequence: revision }),
  z.strictObject({ kind: z.literal('world-case'), requestId: worldRequestIdSchema, intentId: worldIntentIdSchema, sequence: revision }),
  z.strictObject({ kind: z.literal('team-task'), teamId: teamIdSchema, taskId: teamTaskIdSchema, revision,
    relation: z.enum(['creator', 'owner', 'executor', 'reviewer', 'proposed-owner']) }),
  z.strictObject({ kind: z.literal('team-attempt'), teamId: teamIdSchema, taskId: teamTaskIdSchema,
    attemptId: taskAttemptIdSchema, revision }),
  z.strictObject({ kind: z.literal('channel-delivery'), channelId: channelIdSchema, envelopeId: envelopeIdSchema,
    recipientId: participantIdSchema, sequence: count, direction: z.enum(['incoming', 'outgoing']) }),
  z.strictObject({ kind: z.literal('team-activation'), teamId: teamIdSchema, activationId: activationIdSchema,
    reservationId: activationReservationIdSchema.nullable() }),
  z.strictObject({ kind: z.literal('team-startup'), teamId: teamIdSchema, participantId: participantIdSchema,
    reservationId: activationReservationIdSchema }),
  z.strictObject({ kind: z.literal('team-workspace'), teamId: teamIdSchema, allocationId: teamWorkspaceAllocationIdSchema,
    taskId: teamTaskIdSchema, attemptId: taskAttemptIdSchema, revision }),
])
/** Original responsibility owner; inventory never impersonates its cancellation or cleanup authority. */
export const personnelObligationOwnerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('native'), runId: simulationRunIdSchema,
    subsystem: z.enum(['decision', 'operation', 'outbox', 'interaction', 'resource', 'scheduler', 'relation', 'writer', 'world', 'task']) }),
  z.strictObject({ kind: z.literal('team'), teamId: teamIdSchema }),
  z.strictObject({ kind: z.literal('channel'), channelId: channelIdSchema }),
])
/** Candidate dispositions name existing owner actions; none is performed by inspection. */
export const personnelObligationDispositionSchema = z.enum(['wait', 'cancel-supported', 'update-supported', 'handoff-required'])
/** One stable reference and its original owner, with current state and observed/unknown distinction. */
export const personnelObligationSchema = z.strictObject({ ref: personnelObligationReferenceSchema,
  owner: personnelObligationOwnerSchema, category: z.enum(['decision', 'operation', 'outbox', 'task-assignment', 'task-execution',
    'task-target', 'interaction', 'commitment', 'resource-control', 'resource-grant', 'scheduled-event', 'wake', 'message',
    'authority-relation', 'structural-relation', 'writer', 'world-reservation', 'world-case',
    'team-task', 'team-attempt', 'channel-delivery', 'team-activation', 'team-startup', 'team-workspace']),
  state: z.string().min(1), certainty: z.enum(['recorded', 'outcome-unknown', 'external-observation-required']),
  dispositions: z.array(personnelObligationDispositionSchema).min(1)
    .refine(values => new Set(values).size === values.length, 'Dispositions must be distinct') })
/** Pure Native inspection cannot cover the actual Team task/attempt/activation or channel delivery books. */
export const personnelObligationTeamCoverageSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('required'), teamId: teamIdSchema.nullable(), participantId: participantIdSchema.nullable() }),
  z.strictObject({ kind: z.literal('observed'), teamId: teamIdSchema, participantId: participantIdSchema, cursor: count,
    channels: z.array(z.strictObject({ channelId: channelIdSchema, cursor: count })), hash }),
  z.strictObject({ kind: z.literal('partial'), teamId: teamIdSchema, participantId: participantIdSchema, cursor: count,
    channels: z.array(z.strictObject({ channelId: channelIdSchema, cursor: count })), hash,
    reason: z.enum(['channel-limit', 'page-limit', 'byte-limit', 'source-moved']) }),
])
/** Bounded inventory result; complete means covered sources, never that obligations are empty or departure is authorized. */
export const personnelObligationReportSchema = z.strictObject({
  runId: simulationRunIdSchema, cursor: count, time: simTimeSchema, selector: personnelObligationSelectorSchema,
  status: z.enum(['native-only', 'covered', 'partial', 'overflow']), complete: z.boolean(),
  coverage: z.strictObject({ native: z.literal('complete'), team: personnelObligationTeamCoverageSchema }),
  items: z.array(personnelObligationSchema).max(PERSONNEL_OBLIGATION_MAX_ITEMS), totalCount: count,
  overflow: z.strictObject({ reason: z.enum(['item-limit', 'byte-limit', 'item-and-byte-limit']), requiredBytes: count,
    omittedCount: count }).nullable(),
}).refine(value => value.complete === (value.status === 'covered' && value.coverage.team.kind === 'observed' && value.overflow === null)
  && (value.status === 'overflow' ? value.overflow !== null : value.overflow === null)
  && (value.status !== 'native-only' || value.coverage.team.kind === 'required')
  && (value.status !== 'partial' || value.coverage.team.kind === 'partial')
  && (value.status !== 'covered' || value.coverage.team.kind === 'observed')
  && (value.status === 'overflow' ? value.totalCount >= value.items.length : value.totalCount === value.items.length),
'Coverage, overflow and completeness must agree')
/** Strict caller identity and bounded read limits. */
export type PersonnelObligationQuery = z.infer<typeof personnelObligationQuerySchema>
/** Branded stable source reference, independently owned by Native, Team or Channel. */
export type PersonnelObligationReference = z.infer<typeof personnelObligationReferenceSchema>
/** One original responsibility with current permissible owner dispositions. */
export type PersonnelObligation = z.infer<typeof personnelObligationSchema>
/** Complete bounded projection; Native-only reports remain incomplete even when no local entries exist. */
export type PersonnelObligationReport = z.infer<typeof personnelObligationReportSchema>
/** Stable selector and complete-output bound failures; inspection never writes a fence, cancellation or settlement. */
export class PersonnelObligationError extends Error {
  /**
   * @param code - Violated identity, revision or complete-result bound.
   * @param message - Trusted diagnosis without task, message or private profile bodies.
   */
  constructor(readonly code: 'SIM_PERSONNEL_SELECTOR' | 'SIM_PERSONNEL_STALE' | 'SIM_PERSONNEL_SOURCE'
    | 'SIM_PERSONNEL_INVENTORY_LIMIT', message: string) {
    super(message)
    this.name = 'PersonnelObligationError'
  }
}

/**
 * Bound one complete Native/Team inventory envelope without treating an omitted item as discharged work.
 * @param input - All discovered references plus their actual source coverage and cursors.
 * @param query - Original strict selector and finite caller limits.
 * @returns complete bounded report or explicit incomplete overflow; an oversized minimum envelope rejects.
 */
export function boundPersonnelObligationReport(input: PersonnelObligationReport,
  query: PersonnelObligationQuery): PersonnelObligationReport {
  const requested = personnelObligationQuerySchema.parse(query)
  if (JSON.stringify(personnelObligationSelectorSchema.parse(input.selector)) !== JSON.stringify(requested.selector)) {
    throw new PersonnelObligationError('SIM_PERSONNEL_SELECTOR', 'Combined inventory changed its original selected person or assignment revision')
  }
  const bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength
  const itemLimit = input.items.length > requested.limit, byteLimit = bytes > requested.maxBytes
  if (!itemLimit && !byteLimit) return personnelObligationReportSchema.parse(input)
  const overflow = personnelObligationReportSchema.parse({ ...input, status: 'overflow', complete: false, items: [],
    totalCount: input.totalCount, overflow: { reason: itemLimit && byteLimit ? 'item-and-byte-limit' : itemLimit ? 'item-limit' : 'byte-limit',
      requiredBytes: bytes, omittedCount: input.totalCount } })
  if (new TextEncoder().encode(JSON.stringify(overflow)).byteLength > requested.maxBytes) {
    throw new PersonnelObligationError('SIM_PERSONNEL_INVENTORY_LIMIT', 'Inventory limit cannot hold the complete selector and explicit overflow summary')
  }
  return overflow
}
