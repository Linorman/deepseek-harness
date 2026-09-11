import { teamChildResultAdmissionSchema } from '@clocky/clocky-team'
import { channelInvitationSnapshotSchema } from '@clocky/clocky-team'
/** Runtime parsers for Team-Hub journal and checkpoint values. @module @clocky/clocky-team-hub/schema */

import { z } from 'zod'
import {
  activationBindingSnapshotSchema,
  channelIdSchema,
  channelManifestSchema,
  channelPhaseSchema,
  channelPostIdempotencyKeySchema,
  channelSummaryRecordSchema,
  envelopeDeliverySchema,
  envelopeIdSchema,
  jsonObjectSchema,
  jsonValueSchema,
  participantIdSchema,
  participantInterruptSnapshotSchema,
  participantInterruptTargetSchema,
  participantSnapshotSchema,
  teamGoalSnapshotSchema,
  teamClosureSnapshotSchema,
  teamFinalAdmissionSchema,
  teamCancellationSnapshotSchema,
  teamCreationActorSchema,
  teamAuthorityGrantSchema,
  teamHumanActionSnapshotSchema,
  teamUsageChargeSchema,
  teamUsageSampleSchema,
  teamUsageSnapshotSchema,
  teamIdSchema,
  teamInterruptIdSchema,
  teamPhaseSchema,
  teamStallReasonSchema,
  teamSnapshotSchema,
  teamChildRunBindingSchema,
  teamTaskIdSchema,
  teamTaskSnapshotSchema,
  teamTaskExecutionStatsSchema,
  teamWorkspaceAllocationSnapshotSchema,
  teamWorkspaceObservationSchema,
  teamEnvelopeSchema,
  teamPolicyHookSchema,
  teamWorkflowPlanSnapshotSchema,
} from '@clocky/clocky-team'
import type {
  ActivationChangedJournalRecord,
  ChannelProjectionData,
  ChannelProjectionCheckpoint,
  ChannelPostIdempotencyData,
  ChannelReceiptCursorData,
  ChannelAttachedJournalRecord,
  GoalChangedJournalRecord,
  HumanActionChangedJournalRecord,
  UsageChangedJournalRecord,
  UsageParentChargePendingJournalRecord,
  UsageChildChargeJournalRecord,
  UsageParentChargeSettledJournalRecord,
  ParticipantChangedJournalRecord,
  ParticipantInterruptAcknowledgedJournalRecord,
  ParticipantInterruptRequestedJournalRecord,
  TaskChangedJournalRecord,
  WorkspaceAllocationChangedJournalRecord,
  WorkspaceObservedJournalRecord,
  TeamCreatedJournalRecord,
  TeamClosureJournalRecord,
  TeamFinalAdmissionJournalRecord,
  TeamCancellationJournalRecord,
  TeamArchiveJournalRecord,
  TeamJournalRecord,
  TeamPhaseJournalRecord,
  WorkflowPlanChangedJournalRecord,
  PolicyDeniedJournalRecord,
  TeamProjectionCheckpoint,
  TeamProjectionData,
  PendingChannelDeliveryData,
} from './types.ts'
import {
  CHANNEL_CHECKPOINT_FORMAT_VERSION,
  TEAM_CHECKPOINT_FORMAT_VERSION,
} from './types.ts'

const nonNegativeSafeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const positiveSafeIntegerSchema = nonNegativeSafeIntegerSchema.min(1)

/** Parse the first record in one Team journal. */
const teamCreatedJournalRecordFields = {
  type: z.literal('team/created'),
  teamId: teamIdSchema,
  goal: teamGoalSnapshotSchema,
  rules: jsonObjectSchema,
  budgets: jsonObjectSchema,
  authorityGrant: teamAuthorityGrantSchema.optional(),
  createdBy: teamCreationActorSchema.optional(),
  createdAt: nonNegativeSafeIntegerSchema,
}

/** Parse the first record in one Team journal. */
export const teamCreatedJournalRecordSchema = z.union([
  z.object({
    ...teamCreatedJournalRecordFields,
    depth: z.literal(0),
    maxTeamDepth: nonNegativeSafeIntegerSchema,
  }).strict(),
  z.object({
    ...teamCreatedJournalRecordFields,
    parentTeamId: teamIdSchema,
    parentTaskId: teamTaskIdSchema,
    depth: positiveSafeIntegerSchema,
    maxTeamDepth: nonNegativeSafeIntegerSchema,
  }).strict().refine(record => record.depth <= record.maxTeamDepth, {
    message: 'nested Team depth must not exceed maxTeamDepth',
  }),
]) satisfies z.ZodType<TeamCreatedJournalRecord>

/** Parse one Team lifecycle record. */
export const teamPhaseJournalRecordSchema = z.object({
  type: z.literal('team/phase'),
  phase: teamPhaseSchema,
  reason: teamStallReasonSchema.optional(),
  createdAt: nonNegativeSafeIntegerSchema,
}).strict().superRefine((record, context) => {
  if ((record.phase === 'stalled') !== (record.reason !== undefined)) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'Team stall reason is required exactly for stalled phase' })
  }
}) satisfies z.ZodType<TeamPhaseJournalRecord>

/** Parse one independent closed-sink result admission. */
export const teamFinalAdmissionJournalRecordSchema = z.object({
  type: z.literal('team/final-admitted'),
  admission: teamFinalAdmissionSchema,
  createdAt: nonNegativeSafeIntegerSchema,
}).strict().refine(record => record.admission.admittedAt === record.createdAt, {
  message: 'final admission timestamp must match its journal timestamp',
}) satisfies z.ZodType<TeamFinalAdmissionJournalRecord>

/** Parse one typed Team closure intent. */
export const teamClosureJournalRecordSchema = z.object({
  type: z.literal('team/closure'),
  closure: teamClosureSnapshotSchema,
  createdAt: nonNegativeSafeIntegerSchema,
}).strict().superRefine((record, context) => {
  if (record.closure.requestedAt !== record.createdAt) {
    context.addIssue({
      code: 'custom',
      path: ['closure', 'requestedAt'],
      message: 'Team closure requestedAt must match its journal timestamp',
    })
  }
}) satisfies z.ZodType<TeamClosureJournalRecord>

/** Parse one durable cancellation request before terminal Team closure. */
export const teamCancellationJournalRecordSchema = z.object({
  type: z.literal('team/cancellation'),
  cancellation: teamCancellationSnapshotSchema,
  createdAt: nonNegativeSafeIntegerSchema,
}).strict().superRefine((record, context) => {
  if (record.cancellation.requestedAt !== record.createdAt) {
    context.addIssue({
      code: 'custom',
      path: ['cancellation', 'requestedAt'],
      message: 'Team cancellation requestedAt must match its journal timestamp',
    })
  }
}) satisfies z.ZodType<TeamCancellationJournalRecord>

/** Parse one durable Team archive marker. */
export const teamArchiveJournalRecordSchema = z.object({
  type: z.literal('team/archived'),
  createdAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamArchiveJournalRecord>

/** Parse one whole Team goal revision. */
export const goalChangedJournalRecordSchema = z.object({
  type: z.literal('goal/changed'),
  goal: teamGoalSnapshotSchema,
  createdAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<GoalChangedJournalRecord>

/** Parse one whole participant snapshot record. */
export const participantChangedJournalRecordSchema = z.object({
  type: z.literal('participant/changed'),
  participant: participantSnapshotSchema,
  createdAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<ParticipantChangedJournalRecord>

/** Parse one whole task snapshot record. */
export const taskChangedJournalRecordSchema = z.object({
  type: z.literal('task/changed'),
  task: teamTaskSnapshotSchema,
  createdAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TaskChangedJournalRecord>

/** Parse one whole durable workspace allocation lifecycle revision. */
export const workspaceAllocationChangedJournalRecordSchema = z.object({
  type: z.literal('workspace-allocation/changed'),
  allocation: teamWorkspaceAllocationSnapshotSchema,
  createdAt: nonNegativeSafeIntegerSchema,
}).strict().superRefine((record, context) => {
  if (record.allocation.updatedAt !== record.createdAt) {
    context.addIssue({ code: 'custom', path: ['allocation', 'updatedAt'], message: 'workspace allocation update timestamp must match its journal timestamp' })
  }
}) satisfies z.ZodType<WorkspaceAllocationChangedJournalRecord>

/** Parse a bounded observation appended independently of allocation lifecycle. */
export const workspaceObservedJournalRecordSchema = z.object({
  type: z.literal('workspace/observed'), observation: teamWorkspaceObservationSchema, createdAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<WorkspaceObservedJournalRecord>

/** Parse one whole durable activation binding record. */
export const activationChangedJournalRecordSchema = z.object({
  type: z.literal('activation/changed'),
  binding: activationBindingSnapshotSchema,
  createdAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<ActivationChangedJournalRecord>

/** Parse one durable soft-interrupt request targeted at an exact activation binding. */
export const participantInterruptRequestedJournalRecordSchema = z.object({
  type: z.literal('participant-interrupt/requested'),
  interrupt: participantInterruptSnapshotSchema,
  createdAt: nonNegativeSafeIntegerSchema,
}).strict().superRefine((record, context) => {
  if (record.interrupt.requestedAt !== record.createdAt || record.interrupt.acknowledgedAt !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['interrupt'],
      message: 'participant interrupt request must be unacknowledged at its record timestamp',
    })
  }
}) as z.ZodType<ParticipantInterruptRequestedJournalRecord>

/** Parse one durable acknowledgement of an exact prior soft-interrupt target. */
export const participantInterruptAcknowledgedJournalRecordSchema = z.object({
  type: z.literal('participant-interrupt/acknowledged'),
  interruptId: teamInterruptIdSchema,
  target: participantInterruptTargetSchema,
  createdAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<ParticipantInterruptAcknowledgedJournalRecord>

/** Parse one Team-journal reference to a durable channel WAL. */
export const channelAttachedJournalRecordSchema = z.object({
  type: z.literal('channel/attached'),
  channelId: channelIdSchema,
  createdAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<ChannelAttachedJournalRecord>

/** Parse one complete durable Team human-action revision. */
export const humanActionChangedJournalRecordSchema = z.object({
  type: z.literal('human-action/changed'),
  action: teamHumanActionSnapshotSchema,
  createdAt: nonNegativeSafeIntegerSchema,
}).strict().superRefine((record, context) => {
  if (record.action.updatedAt !== record.createdAt) {
    context.addIssue({ code: 'custom', path: ['action', 'updatedAt'], message: 'human action update timestamp must match record timestamp' })
  }
}) satisfies z.ZodType<HumanActionChangedJournalRecord>

/** Parse one provider usage sample and its post-fold aggregate. */
export const usageChangedJournalRecordSchema = z.object({
  type: z.literal('usage/changed'),
  sample: teamUsageSampleSchema,
  usage: teamUsageSnapshotSchema,
  createdAt: nonNegativeSafeIntegerSchema,
}).strict().superRefine((record, context) => {
  if (record.sample.observedAt !== record.createdAt) {
    context.addIssue({ code: 'custom', path: ['sample', 'observedAt'], message: 'usage sample timestamp must match record timestamp' })
  }
}) satisfies z.ZodType<UsageChangedJournalRecord>

/** Parse one durable child-usage charge retained until its parent accepts it. */
export const usageParentChargePendingJournalRecordSchema = z.object({
  type: z.literal('usage/parent-charge-pending'),
  charge: teamUsageChargeSchema,
  createdAt: nonNegativeSafeIntegerSchema,
}).strict().superRefine((record, context) => {
  if (record.charge.observedAt !== record.createdAt) {
    context.addIssue({ code: 'custom', path: ['charge', 'observedAt'], message: 'pending charge timestamp must match its journal timestamp' })
  }
}) satisfies z.ZodType<UsageParentChargePendingJournalRecord>

/** Parse one durable child-usage charge and its parent post-fold aggregate. */
export const usageChildChargeJournalRecordSchema = z.object({
  type: z.literal('usage/child-charged'),
  charge: teamUsageChargeSchema,
  usage: teamUsageSnapshotSchema,
  createdAt: nonNegativeSafeIntegerSchema,
}).strict().superRefine((record, context) => {
  if (record.charge.observedAt !== record.createdAt || record.usage.updatedAt !== record.createdAt) {
    context.addIssue({ code: 'custom', path: ['createdAt'], message: 'child charge aggregate timestamps must match its journal timestamp' })
  }
}) satisfies z.ZodType<UsageChildChargeJournalRecord>

/** Parse one durable acknowledgement of a settled parent usage charge. */
export const usageParentChargeSettledJournalRecordSchema = z.object({
  type: z.literal('usage/parent-charge-settled'),
  chargeId: teamUsageChargeSchema.shape.id,
  createdAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<UsageParentChargeSettledJournalRecord>

/** Parse one complete workflow-plan revision in the Team journal. */
export const workflowPlanChangedJournalRecordSchema = z.object({
  type: z.literal('workflow-plan/changed'),
  plan: teamWorkflowPlanSnapshotSchema,
  createdAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<WorkflowPlanChangedJournalRecord>

/** Parse one durable governance denial used by audit and restart diagnostics. */
export const policyDeniedJournalRecordSchema = z.object({
  type: z.literal('policy/denied'),
  hook: teamPolicyHookSchema,
  actorId: participantIdSchema.optional(),
  code: z.string().min(1),
  message: z.string().min(1),
  facts: jsonObjectSchema,
  createdAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<PolicyDeniedJournalRecord>

/** Parse any supported Team journal record. */
export const teamJournalRecordSchema: z.ZodType<TeamJournalRecord> = z.union([
  z.object({ type: z.literal('team/child-result-admitted'), admission: teamChildResultAdmissionSchema, createdAt: nonNegativeSafeIntegerSchema }).strict()
    .refine(value => value.createdAt === value.admission.admittedAt, { message: 'child result journal timestamp must equal its admission timestamp' }),
  z.object({ type: z.literal('team/child-run-bound'), binding: teamChildRunBindingSchema, createdAt: nonNegativeSafeIntegerSchema }).strict(),
  teamCreatedJournalRecordSchema,
  teamPhaseJournalRecordSchema,
  teamFinalAdmissionJournalRecordSchema,
  teamClosureJournalRecordSchema,
  teamCancellationJournalRecordSchema,
  teamArchiveJournalRecordSchema,
  goalChangedJournalRecordSchema,
  participantChangedJournalRecordSchema,
  taskChangedJournalRecordSchema,
  workspaceAllocationChangedJournalRecordSchema,
  workspaceObservedJournalRecordSchema,
  activationChangedJournalRecordSchema,
  participantInterruptRequestedJournalRecordSchema,
  participantInterruptAcknowledgedJournalRecordSchema,
  channelAttachedJournalRecordSchema,
  humanActionChangedJournalRecordSchema,
  usageChangedJournalRecordSchema,
  usageParentChargePendingJournalRecordSchema,
  usageChildChargeJournalRecordSchema,
  usageParentChargeSettledJournalRecordSchema,
  workflowPlanChangedJournalRecordSchema,
  policyDeniedJournalRecordSchema,
])

/** Parse the JSON-safe state retained by a Team projection checkpoint. */
export const teamProjectionDataSchema = z.object({
  finalAdmission: teamFinalAdmissionSchema.nullable(),
  team: teamSnapshotSchema,
  goal: teamGoalSnapshotSchema,
  rules: jsonObjectSchema,
  budgets: jsonObjectSchema,
  participants: z.array(participantSnapshotSchema),
  tasks: z.array(teamTaskSnapshotSchema),
  taskExecutionStats: z.array(teamTaskExecutionStatsSchema).optional(),
  workspaceAllocations: z.array(teamWorkspaceAllocationSnapshotSchema),
  activations: z.array(activationBindingSnapshotSchema),
  interrupts: z.array(participantInterruptSnapshotSchema),
  humanActions: z.array(teamHumanActionSnapshotSchema).optional(),
  usage: teamUsageSnapshotSchema.optional(),
  usageSamples: z.array(teamUsageSampleSchema).optional(),
  usageCharges: z.array(teamUsageChargeSchema).optional(),
  pendingParentCharges: z.array(teamUsageChargeSchema).optional(),
  workflowPlans: z.array(teamWorkflowPlanSnapshotSchema).optional(),
  channelIds: z.array(channelIdSchema),
}).strict() as z.ZodType<TeamProjectionData>

/** Parse a Team journal checkpoint written by this Hub version. */
export const teamProjectionCheckpointSchema = z.object({
  kind: z.literal('team-projection'),
  version: z.literal(TEAM_CHECKPOINT_FORMAT_VERSION),
  teamId: teamIdSchema,
  projection: teamProjectionDataSchema,
}).strict() as z.ZodType<TeamProjectionCheckpoint>

/** Parse one pending recipient delivery retained in a channel checkpoint. */
export const pendingChannelDeliveryDataSchema = z.object({
  participantId: participantIdSchema,
  envelopeId: envelopeIdSchema,
  envelopeSequence: nonNegativeSafeIntegerSchema,
  delivery: envelopeDeliverySchema,
  expiresAt: nonNegativeSafeIntegerSchema.optional(),
}).strict() as z.ZodType<PendingChannelDeliveryData>

/** Parse one recipient receipt high-water retained in a channel checkpoint. */
export const channelReceiptCursorDataSchema = z.object({
  participantId: participantIdSchema,
  cursor: nonNegativeSafeIntegerSchema,
}).strict() as z.ZodType<ChannelReceiptCursorData>

/** Parse one sender-scoped idempotent channel post checkpoint entry. */
export const channelPostIdempotencyDataSchema = z.object({
  senderId: participantIdSchema,
  idempotencyKey: channelPostIdempotencyKeySchema,
  envelope: teamEnvelopeSchema,
}).strict() as z.ZodType<ChannelPostIdempotencyData>

/** Parse the JSON-safe state retained by a channel-WAL projection checkpoint. */
export const channelProjectionDataSchema = z.object({
  invitations: z.array(channelInvitationSnapshotSchema),
  manifest: channelManifestSchema,
  phase: channelPhaseSchema,
  cursor: nonNegativeSafeIntegerSchema,
  state: jsonValueSchema,
  pendingDeliveries: z.array(pendingChannelDeliveryDataSchema),
  receiptCursors: z.array(channelReceiptCursorDataSchema),
  postIdempotency: z.array(channelPostIdempotencyDataSchema),
  summaries: z.array(channelSummaryRecordSchema),
}).strict() as z.ZodType<ChannelProjectionData>

/** Parse a channel WAL checkpoint written by this Hub version. */
export const channelProjectionCheckpointSchema = z.object({
  kind: z.literal('channel-projection'),
  version: z.literal(CHANNEL_CHECKPOINT_FORMAT_VERSION),
  channelId: channelIdSchema,
  projection: channelProjectionDataSchema,
}).strict() as z.ZodType<ChannelProjectionCheckpoint>
