import type { ChannelProtocolStatus, ChannelHumanAdmissionSnapshot } from './types.ts'
import type { ChannelHumanEnvelopeGetInput } from './types.ts'
import type { TeamChannelListInput, TeamChannelListPage } from './types.ts'
import type { ChannelInvitationExpireInput, TeamSystemChannelAdmissionProofResolution } from './types.ts'
import type { TeamWorkspaceExecutionWorldId, TeamWorkspaceLoss, TeamWorkspaceAllocationLossInput } from './types.ts'
import type { TeamDelegationId } from './types.ts'
import type { TeamTaskExecution, TeamTaskDelegationSnapshot, TeamSystemDelegationScope } from './types.ts'
import type { ChannelInvitationIdempotencyKey, ChannelManifestFingerprint, ChannelInvitationSnapshot, ChannelInvitationAcknowledgeInput, ChannelAdmissionSnapshot, ChannelInvitationRecord } from './types.ts'
import type { TeamWorkspaceObservationId, TeamWorkspaceContentVersion, TeamWorkspaceScanVersion, TeamWorkspaceObservationInput, TeamWorkspaceObservation } from './types.ts'
/** Runtime parsers for Team identities and lossless durable or wire records. @module @clocky/clocky-team/schema */

import { z } from 'zod'
import type { SessionId, TeamChannelViewEventData } from '@clocky/clocky-session/types'
import { TEAM_LATENCY_BUCKETS_MS } from './metrics.ts'
import type {
  TeamFinalAdmission,
  TeamFinalAdmissionInput,
  TeamFinalAdmissionIdempotencyKey,
  TeamFinalContentFingerprint,
  ActivationBindInput,
  ActivationBindingSnapshot,
  ActivationFenceInput,
  ActivationQuiesceInput,
  ActivationRecoverySnapshot,
  ActivationGetRequest,
  ActivationId,
  ActivationSnapshot,
  ActivationStatus,
  ActivationStatusUpdateInput,
  ChannelCloseInput,
  TeamCancellationChannelCloseInput,
  ChannelDeliveryClaim,
  ChannelDeliveryClaimInput,
  ChannelDeliveryExpireResult,
  ChannelDeliveryExpiredRecord,
  ChannelSummaryRecord,
  ChannelSummarizeInput,
  ChannelSummarySelectionInput,
  ChannelSummarySourceFingerprint,
  ChannelFinalPostInput,
  ChannelEnvelopePostInput,
  ChannelEnvelopeReceiptInput,
  ChannelEnvelopeRecord,
  ChannelEvent,
  ChannelGetRequest,
  ChannelId,
  ChannelAdapterRecord,
  ChannelAdapterRecordDraft,
  ChannelClosedRecord,
  ChannelManifest,
  ChannelOpenInput,
  ChannelOpenedRecord,
  ChannelPendingDeliveryListRequest,
  ChannelPendingDeliveryPage,
  ChannelPendingEnvelopeDelivery,
  ChannelPhaseRecord,
  ChannelPostIdempotencyKey,
  ChannelSummaryIdempotencyKey,
  ChannelPhase,
  ChannelReadRequest,
  ChannelReadPageRequest,
  ChannelReadPageResult,
  ChannelReadResult,
  TeamChannelCompactInput,
  TeamChannelCompactResult,
  TeamJournalCompactInput,
  TeamJournalCompactResult,
  ChannelRecord,
  ChannelReceiptRecord,
  ChannelParticipant,
  ChannelSnapshot,
  ChannelWatchRequest,
  ChannelWatchResult,
  DeliveryIntent,
  EnvelopeDelivery,
  EnvelopeId,
  EnvelopePriority,
  JsonObject,
  JsonValue,
  ParticipantKind,
  TeamParticipantOwner,
  ParticipantInviteInput,
  ParticipantInterruptAcknowledgeInput,
  ParticipantInterruptListPendingInput,
  ParticipantInterruptRequestInput,
  ParticipantInterruptSnapshot,
  ParticipantInterruptTarget,
  ParticipantId,
  ParticipantPhaseTransitionInput,
  ParticipantPhase,
  ParticipantSnapshot,
  TeamMemberListPageRequest,
  TeamMemberListPage,
  ParticipantStats,
  TeamTaskRankingPolicy,
  TeamTaskExecutionStats,
  TeamTaskPlacement,
  TeamAdapterRef,
  TeamViewPolicyRef,
  TeamArchiveInput,
  TeamResumeInput,
  TeamAuthorityGrant,
  TeamCancelInput,
  TeamCreationActor,
  TeamClosureActor,
  TeamClosureContinuationInput,
  TeamClosureInput,
  TeamClosureIdempotencyKey,
  TeamClosureKind,
  TeamClosureSnapshot,
  TeamCancellationSnapshot,
  TeamAuditEntry,
  TeamAuditReadRequest,
  TeamAuditReadResult,
  TeamAuditStream,
  TeamCreateInput,
  TeamChildCreateInput,
  TeamRootCreateInput,
  TeamCompleteInput,
  TeamEnvelope,
  TeamEnvelopeDraft,
  TeamEvent,
  TeamGetRequest,
  TeamGoalBlocker,
  TeamGoalPhase,
  TeamGoalPhaseTransitionInput,
  TeamGoalSeed,
  TeamGoalSnapshot,
  TeamGoalUpdateInput,
  TeamHumanActionId,
  TeamHumanActionKind,
  TeamHumanActionPhase,
  TeamHumanActionSnapshot,
  TeamHumanActionSourceId,
  TeamHumanActionResolveInput,
  TeamHumanActionUpsertInput,
  TeamHumanActorPayloadFingerprint,
  TeamHumanActorProofFence,
  TeamHumanActorProofInput,
  TeamHumanActorProofResolution,
  TeamHumanActorScope,
  TeamTokenUsage,
  TeamUsageRecordInput,
  TeamUsageSample,
  TeamUsageSampleInput,
  TeamUsageRate,
  TeamUsageSampleId,
  TeamUsageCharge,
  TeamUsageChargeId,
  TeamUsageSnapshot,
  TeamResourceBudget,
  TeamWorkflowCondition,
  TeamWorkflowGraph,
  TeamWorkflowPlan,
  TeamWorkflowPlanAdmissionInput,
  TeamWorkflowPlanBounds,
  TeamWorkflowPlanChannelBindInput,
  TeamWorkflowChannelPlan,
  TeamWorkflowPlanGetRequest,
  TeamWorkflowPlanId,
  TeamWorkflowPlanIdempotencyKey,
  TeamWorkflowPlanListPageRequest,
  TeamWorkflowPlanListPage,
  TeamWorkflowPlanPhase,
  TeamWorkflowPlanPhaseInput,
  TeamWorkflowPlanResult,
  TeamWorkflowPlanSnapshot,
  TeamWorkflowPlanTaskBindInput,
  TeamWorkflowChannelCloseInput,
  TeamWorkflowProjectedTaskResult,
  TeamWorkflowResultProjection,
  TeamWorkflowTarget,
  TeamWorkflowTaskReviewPolicy,
  TeamWorkflowTaskTemplate,
  TeamWorkflowTaskTemplateId,
  TeamWorkflowTaskBinding,
  TeamWorkflowTransition,
  TeamId,
  TeamFailInput,
  TeamInterruptId,
  TeamPhaseTransitionInput,
  TeamPhase,
  TeamStallReason,
  TeamPolicyDecision,
  TeamPolicyHook,
  TeamPolicyRequest,
  TeamSnapshot,
  TeamListPageRequest,
  TeamListPage,
  TeamStateSnapshot,
  TeamQuiescenceSnapshot,
  TeamMetricsSnapshot,
  TeamTaskAssignInput,
  TeamTaskAttemptExpireInput,
  TeamTaskAttemptFence,
  TeamTaskAttemptHeartbeatInput,
  TeamTaskAttemptStartInput,
  TeamTaskAttemptStartClaimInput,
  TeamTaskAttemptOwnerFence,
  TeamTaskAttemptSettleInput,
  TeamTaskCancelInput,
  TeamTaskCancellationReconcileInput,
  TeamTaskCancellationSnapshot,
  TeamTaskDependencyOutcome,
  TeamCancellationTaskCancelInput,
  TeamFinalizationChannelCloseInput,
  SchedulerReviewChannelOpenInput,
  SchedulerWakeChannelOpenInput,
  SchedulerFailedWakeChannelCloseInput,
  SchedulerChannelDeliveryExpireInput,
  TeamTaskCreateInput,
  TeamTaskCreateCommand,
  TeamTaskCreateCommandInput,
  TeamTaskCreateIdempotencyKey,
  TeamTaskCommandCreator,
  TeamTaskCreator,
  TeamHumanTaskCreator,
  TaskAttemptIntegrationResult,
  TeamTaskDeleteInput,
  TeamTaskDetailsUpdateInput,
  TeamTaskGetRequest,
  TeamTaskListPageRequest,
  TeamTaskListPage,
  TeamTaskOwnerProposalInput,
  TeamTaskPhase,
  TeamTaskId,
  TeamTaskReviewDecision,
  TeamTaskReviewPolicy,
  TeamTaskSnapshot,
  TeamTaskIntegrationSpec,
  TeamTaskWorkspaceMode,
  TeamTaskReviewResolveInput,
  TeamWorkspaceAllocationId,
  TeamWorkspaceAllocationLifecycle,
  TeamWorkspaceAllocationSnapshot,
  TeamWorkspaceAllocationBindingInput,
  TeamWorkspaceAllocationReserveInput,
  TeamWorkspaceAllocationActivateInput,
  TeamWorkspaceAllocationReleaseRequestInput,
  TeamWorkspaceAllocationPreserveInput,
  TeamWorkspaceAllocationReleaseInput,
  TeamSystemFinalReceiptProofResolution,
  TeamSystemFinalReceiptScope,
  TeamSystemActivationProofResolution,
  TeamSystemActivationScope,
  TeamSystemHumanActionProofResolution,
  TeamSystemHumanActionScope,
  TeamSystemTaskLeaseProofResolution,
  TeamSystemTaskLeaseScope,
  TeamSystemTaskControlProofResolution,
  TeamSystemTaskControlScope,
  TeamSystemRootCreationProofResolution,
  TeamSystemRootCreationScope,
  TeamSystemChildCreationProofResolution,
  TeamSystemChildCreationScope,
  TeamSystemChannelSummaryProofResolution,
  TeamSystemChannelSummaryScope,
  TeamSystemChannelLifecycleScope,
  TeamSystemWorkspaceAllocationProofResolution,
  TeamSystemWorkspaceAllocationScope,
  TeamSystemArchiveProofResolution,
  TeamSystemArchiveScope,
  TeamSystemTopologyProofResolution,
  TeamSystemTopologyScope,
  TeamSystemSchedulerChannelProofResolution,
  TeamSystemSchedulerChannelScope,
  TeamSystemCancellationCleanupProofResolution,
  TeamSystemCancellationCleanupScope,
  TeamSystemFinalizationCleanupProofResolution,
  TeamSystemFinalizationCleanupScope,
  TeamSystemWorkflowProofResolution,
  TeamSystemWorkflowScope,
  TeamSystemClosureProofResolution,
  TeamSystemClosureScope,
  TeamSystemClosureDriverProofResolution,
  TeamSystemClosureDriverScope,
  TeamSystemPhaseProofResolution,
  TeamSystemPhaseScope,
  TeamSystemMaintenanceProofResolution,
  TeamSystemMaintenanceScope,
  TeamSystemInterruptProofResolution,
  TeamSystemInterruptScope,
  TeamSystemEnvelopePostProofResolution,
  TeamSystemEnvelopePostScope,
  TeamSystemTaskReviewProofResolution,
  TeamSystemTaskReviewScope,
  TeamWatchRequest,
  TeamWatchResult,
  TaskAttemptId,
  TaskAttemptFailure,
  TaskAttemptOutcome,
  TaskAttemptResult,
  TeamArtifactReference,
  TeamArtifactGetRequest,
  TeamArtifactListPageRequest,
  TeamArtifactListPage,
  TaskAttemptSnapshot,
  TaskLeaseSnapshot,
} from './types.ts'
import { validateTeamWorkflowPlan } from './workflow.ts'

const nonEmptyStringSchema = z.string().min(1)
const nonNegativeSafeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const nonNegativeNumberSchema = z.number().refine(Number.isFinite, { message: 'number must be finite' }).min(0).max(Number.MAX_SAFE_INTEGER)
const positiveSafeIntegerSchema = nonNegativeSafeIntegerSchema.min(1)
const observedCursorSchema = z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER)
const channelSequenceRangeSchema = z.object({
  from: nonNegativeSafeIntegerSchema,
  to: nonNegativeSafeIntegerSchema,
}).strict().refine(range => range.from <= range.to, {
  message: 'channel summary sequence range must be ordered',
})
const trimmedTextSchema = nonEmptyStringSchema.refine(value => value.trim() === value, {
  message: 'text must not have surrounding whitespace',
})
const trimmedNameSchema = nonEmptyStringSchema.refine(value => value.trim() === value, {
  message: 'name must not have surrounding whitespace',
})
/** Parse an opaque Session-owned identifier without importing Session runtime behavior. */
const sessionIdSchema = nonEmptyStringSchema.transform(value => value as SessionId)

/** Parse one independently stored Team identifier. */
export const teamIdSchema = nonEmptyStringSchema.transform(value => value as TeamId)
/** Parse the independent durable retry identity of one parent-task delegation. */
export const teamDelegationIdSchema = nonEmptyStringSchema.transform(value => value as TeamDelegationId)
/** Parse one independently stored participant identifier. */
export const participantIdSchema = nonEmptyStringSchema.transform(value => value as ParticipantId)
/** Parse one independently stored activation identifier. */
export const activationIdSchema = nonEmptyStringSchema.transform(value => value as ActivationId)
/** Parse one independently stored Team participant-interrupt identifier. */
export const teamInterruptIdSchema = nonEmptyStringSchema.transform(value => value as TeamInterruptId)
/** Parse one opaque retry key for a Team closure command. */
export const teamClosureIdempotencyKeySchema = nonEmptyStringSchema.transform(value => value as TeamClosureIdempotencyKey)
/** Parse one independently stored channel identifier. */
export const channelIdSchema = nonEmptyStringSchema.transform(value => value as ChannelId)
/** Parse one independently stored envelope identifier. */
export const envelopeIdSchema = nonEmptyStringSchema.transform(value => value as EnvelopeId)
/** Parse one opaque sender-scoped retry key for a channel post. */
export const channelPostIdempotencyKeySchema = nonEmptyStringSchema.transform(value => value as ChannelPostIdempotencyKey)
/** Parse one opaque retry key for a channel summary command. */
export const channelSummaryIdempotencyKeySchema = nonEmptyStringSchema.transform(value => value as ChannelSummaryIdempotencyKey)
/** Parse the exact SHA-256 digest of a summary's ordered source Envelope values. */
export const channelSummarySourceFingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u)
  .transform(value => value as ChannelSummarySourceFingerprint)
/** Parse one opaque creator-scoped retry key for a Team task creation. */
export const teamTaskCreateIdempotencyKeySchema = nonEmptyStringSchema.transform(value => value as TeamTaskCreateIdempotencyKey)
/** Parse one independently stored Team task identifier. */
export const teamTaskIdSchema = nonEmptyStringSchema.transform(value => value as TeamTaskId)
/** Parse one independently stored task-attempt identifier. */
export const taskAttemptIdSchema = nonEmptyStringSchema.transform(value => value as TaskAttemptId)
/** Parse one provider-minted Team workspace allocation identity. */
export const teamWorkspaceAllocationIdSchema = nonEmptyStringSchema.transform(value => value as TeamWorkspaceAllocationId)
/** Parse one Team-owned durable human-action identifier. */
export const teamHumanActionIdSchema = nonEmptyStringSchema.transform(value => value as TeamHumanActionId)
/** Parse one opaque approval/question source request identity. */
export const teamHumanActionSourceIdSchema = nonEmptyStringSchema.transform(value => value as TeamHumanActionSourceId)
/** Parse one idempotent Team model-usage sample identifier. */
export const teamUsageSampleIdSchema = nonEmptyStringSchema.transform(value => value as TeamUsageSampleId)
/** Parse one idempotent child-usage charge identifier. */
export const teamUsageChargeIdSchema = nonEmptyStringSchema.transform(value => value as TeamUsageChargeId)
/** Parse one durable workflow-plan identifier. */
export const teamWorkflowPlanIdSchema = nonEmptyStringSchema.transform(value => value as TeamWorkflowPlanId)
/** Parse one retry identity for a workflow-plan admission. */
export const teamWorkflowPlanIdempotencyKeySchema = nonEmptyStringSchema.transform(value => value as TeamWorkflowPlanIdempotencyKey)
/** Parse one plan-local workflow task-template identifier. */
export const teamWorkflowTaskTemplateIdSchema = nonEmptyStringSchema.transform(value => value as TeamWorkflowTaskTemplateId)

/** Parse one stable system final-receipt proof-source registration name. */
export const teamSystemFinalReceiptProofSourceNameSchema = trimmedNameSchema

/** Parse the exact Team topology a system final-receipt proof may select. */
export const teamSystemFinalReceiptScopeSchema = z.object({
  teamId: teamIdSchema,
  channelId: channelIdSchema,
  humanId: participantIdSchema,
  coordinatorId: participantIdSchema,
}).strict().refine(scope => scope.humanId !== scope.coordinatorId, {
  message: 'system final-receipt scope must name distinct human and coordinator participants',
}) satisfies z.ZodType<TeamSystemFinalReceiptScope>

/** Parse one detached source attribution resolved from a runtime-only final-receipt proof. */
export const teamSystemFinalReceiptProofResolutionSchema = z.object({
  sourceName: teamSystemFinalReceiptProofSourceNameSchema,
  scope: teamSystemFinalReceiptScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemFinalReceiptProofResolution>

/** Parse one stable system ordinary-Envelope-post proof-source registration name. */
export const teamSystemEnvelopePostProofSourceNameSchema = trimmedNameSchema

/** Parse one source-owned default-topology human-input Envelope-post scope. */
const teamRunHumanInputEnvelopePostScopeSchema = z.object({
  kind: z.literal('team-run-human-input'),
  teamId: teamIdSchema,
  channelId: channelIdSchema,
  humanId: participantIdSchema,
  coordinatorId: participantIdSchema,
}).strict().refine(scope => scope.humanId !== scope.coordinatorId, {
  message: 'team-run human-input scope must name distinct human and coordinator participants',
})

/** Parse one source-owned task-assignment Envelope-post scope. */
const schedulerAssignmentEnvelopePostScopeSchema = z.object({
  kind: z.literal('scheduler-assignment'),
  teamId: teamIdSchema,
  channelId: channelIdSchema,
  taskId: teamTaskIdSchema,
  attemptId: taskAttemptIdSchema,
  assignedRevision: positiveSafeIntegerSchema,
  assigneeId: participantIdSchema,
  activationId: activationIdSchema,
  sessionId: sessionIdSchema,
}).strict()

/** Parse one source-owned completed-task review-request Envelope-post scope. */
const schedulerReviewRequestEnvelopePostScopeSchema = z.object({
  kind: z.literal('scheduler-review-request'),
  teamId: teamIdSchema,
  channelId: channelIdSchema,
  taskId: teamTaskIdSchema,
  attemptId: taskAttemptIdSchema,
  reviewRevision: positiveSafeIntegerSchema,
  initiatorId: participantIdSchema,
  reviewerId: participantIdSchema,
  reviewerActivationId: activationIdSchema,
  reviewerSessionId: sessionIdSchema,
  reviewerProvider: trimmedNameSchema,
}).strict().refine(scope => scope.initiatorId !== scope.reviewerId, {
  message: 'scheduler review-request scope must name distinct initiator and reviewer participants',
})

/** Parse the closed durable topology a system ordinary-Envelope-post proof may select. */
export const teamSystemEnvelopePostScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('team-delegation-request'), binding: z.lazy(() => teamChildRunBindingSchema), objective: nonEmptyStringSchema }).strict(),
  teamRunHumanInputEnvelopePostScopeSchema,
  schedulerAssignmentEnvelopePostScopeSchema,
  schedulerReviewRequestEnvelopePostScopeSchema,
]) satisfies z.ZodType<TeamSystemEnvelopePostScope>

/** Parse one detached source attribution resolved from a runtime-only ordinary-Envelope-post proof. */
export const teamSystemEnvelopePostProofResolutionSchema = z.object({
  sourceName: teamSystemEnvelopePostProofSourceNameSchema,
  scope: teamSystemEnvelopePostScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemEnvelopePostProofResolution>

/** Parse one stable system task-review proof-source registration name. */
export const teamSystemTaskReviewProofSourceNameSchema = trimmedNameSchema

/** Parse one source-owned scheduler recovery from a durable consult review response. */
const schedulerReviewResponseTaskReviewScopeSchema = z.object({
  kind: z.literal('scheduler-review-response'),
  teamId: teamIdSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  attemptId: taskAttemptIdSchema,
  reviewerId: participantIdSchema,
  initiatorId: participantIdSchema,
  channelId: channelIdSchema,
  requestEnvelopeId: envelopeIdSchema,
  responseEnvelopeId: envelopeIdSchema,
  nextPhase: z.enum(['completed', 'pending'] as const),
  reason: nonEmptyStringSchema,
}).strict().refine(scope => scope.reviewerId !== scope.initiatorId, {
  message: 'scheduler review-response scope must name distinct reviewer and initiator participants',
}).refine(scope => scope.requestEnvelopeId !== scope.responseEnvelopeId, {
  message: 'scheduler review-response scope must name distinct request and response Envelopes',
})

/** Parse the closed durable scope a system task-review proof may select. */
export const teamSystemTaskReviewScopeSchema = (
  schedulerReviewResponseTaskReviewScopeSchema
) satisfies z.ZodType<TeamSystemTaskReviewScope>

/** Parse one detached source attribution resolved from a runtime-only task-review proof. */
export const teamSystemTaskReviewProofResolutionSchema = z.object({
  sourceName: teamSystemTaskReviewProofSourceNameSchema,
  scope: teamSystemTaskReviewScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemTaskReviewProofResolution>

/** Parse one stable system Team-closure proof-source registration name. */
export const teamSystemClosureProofSourceNameSchema = trimmedNameSchema

/** Parse one source-owned TeamRun completion scope. */
const teamRunCompleteClosureScopeSchema = z.object({
  kind: z.literal('team-run-complete'),
  teamId: teamIdSchema,
  channelId: channelIdSchema,
  humanId: participantIdSchema,
  coordinatorId: participantIdSchema,
  finalEnvelopeId: envelopeIdSchema,
}).strict().refine(scope => scope.humanId !== scope.coordinatorId, {
  message: 'team-run completion scope must name distinct human and coordinator participants',
})

/** Parse one source-owned TeamRun cancellation scope. */
const teamRunCancelClosureScopeSchema = z.object({
  kind: z.literal('team-run-cancel'),
  teamId: teamIdSchema,
  channelId: channelIdSchema,
  humanId: participantIdSchema,
  coordinatorId: participantIdSchema,
}).strict().refine(scope => scope.humanId !== scope.coordinatorId, {
  message: 'team-run cancellation scope must name distinct human and coordinator participants',
})

/** Parse one source-owned TeamRun creation-failure scope. */
const teamRunCreateFailureClosureScopeSchema = z.object({
  kind: z.literal('team-run-create-failure'),
  teamId: teamIdSchema,
}).strict()

/** Parse the closed durable scope a system Team-closure proof may select. */
export const teamSystemClosureScopeSchema = z.discriminatedUnion('kind', [
  teamRunCompleteClosureScopeSchema,
  teamRunCancelClosureScopeSchema,
  teamRunCreateFailureClosureScopeSchema,
]) satisfies z.ZodType<TeamSystemClosureScope>

/** Parse one detached source attribution resolved from a runtime-only Team-closure proof. */
export const teamSystemClosureProofResolutionSchema = z.object({
  sourceName: teamSystemClosureProofSourceNameSchema,
  scope: teamSystemClosureScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemClosureProofResolution>

/** Parse one stable system closure-driver proof-source registration name. */
export const teamSystemClosureDriverProofSourceNameSchema = trimmedNameSchema

/** Parse the durable reason retained while a Team is stalled. */
export const teamStallReasonSchema = z.object({
  code: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<TeamStallReason>

/** Parse one source-owned continuation of a durable completion intent. */
const teamClosureRecoverCompleteScopeSchema = z.object({
  kind: z.literal('closure-recover-complete'),
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  closureIdempotencyKey: teamClosureIdempotencyKeySchema,
  closureRequestedAt: nonNegativeSafeIntegerSchema,
  finalChannelId: channelIdSchema,
  finalEnvelopeId: envelopeIdSchema,
}).strict()

/** Parse one source-owned continuation of a durable failure intent. */
const teamClosureRecoverFailScopeSchema = z.object({
  kind: z.literal('closure-recover-fail'),
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  closureIdempotencyKey: teamClosureIdempotencyKeySchema,
  closureRequestedAt: nonNegativeSafeIntegerSchema,
}).strict()

/** Parse one source-owned continuation of a durable cancellation admission. */
const teamClosureRecoverCancelScopeSchema = z.object({
  kind: z.literal('closure-recover-cancel'),
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  cancellationIdempotencyKey: teamClosureIdempotencyKeySchema,
  cancellationRequestedAt: nonNegativeSafeIntegerSchema,
}).strict()

/** Parse the exact reason for a current coordinator turn that omitted a final. */
const closureMissingFinalReasonSchema = z.object({
  code: z.literal('FINAL_ANSWER_MISSING'),
  message: nonEmptyStringSchema,
}).strict()

/** Fields that bind a current coordinator observer to one activation epoch. */
const closureObservedTurnFields = {
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  coordinatorId: participantIdSchema,
  activationId: activationIdSchema,
  sessionId: sessionIdSchema,
  provider: trimmedNameSchema,
  turn: nonNegativeSafeIntegerSchema,
}

/** Parse the optional canonical final-channel fence carried by a Team observer. */
const closureObservedFinalFields = {
  finalChannelId: channelIdSchema.optional(),
  humanId: participantIdSchema.optional(),
}

/** Require the canonical final channel and human recipient to be supplied together. */
function requireObservedFinalFields(
  scope: { readonly finalChannelId?: unknown; readonly humanId?: unknown },
  context: z.RefinementCtx,
): void {
  if ((scope.finalChannelId === undefined) === (scope.humanId === undefined)) return
  context.addIssue({ code: 'custom', path: ['finalChannelId'], message: 'observed final channel and human must be supplied together' })
}

/** Parse one current-observer missing-final intent scope. */
const teamClosureStallMissingFinalScopeSchema = z.object({
  kind: z.literal('closure-stall-missing-final'),
  ...closureObservedTurnFields,
  ...closureObservedFinalFields,
  reason: closureMissingFinalReasonSchema,
}).strict().superRefine(requireObservedFinalFields)

/** Parse one current-observer structured turn-failure intent scope. */
const teamClosureFailTurnScopeSchema = z.object({
  kind: z.literal('closure-fail-turn'),
  ...closureObservedTurnFields,
  ...closureObservedFinalFields,
  reason: z.object({
    code: nonEmptyStringSchema,
    message: nonEmptyStringSchema,
  }).strict(),
}).strict().superRefine(requireObservedFinalFields)

/** Parse one current-observer frozen-budget stall intent scope. */
const teamClosureStallBudgetScopeSchema = z.object({
  kind: z.literal('closure-stall-budget'),
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  reason: teamStallReasonSchema,
}).strict()

/** Parse one orphaned quiescing-phase stall scope. */
const teamClosureStallQuiescingScopeSchema = z.object({
  kind: z.literal('closure-stall-quiescing'),
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  reason: teamStallReasonSchema,
}).strict()

/** Parse the closed durable recovery scope a closure-driver proof may select. */
export const teamSystemClosureDriverScopeSchema = z.discriminatedUnion('kind', [
  teamClosureRecoverCompleteScopeSchema,
  teamClosureRecoverFailScopeSchema,
  teamClosureRecoverCancelScopeSchema,
  teamClosureStallMissingFinalScopeSchema,
  teamClosureFailTurnScopeSchema,
  teamClosureStallBudgetScopeSchema,
  teamClosureStallQuiescingScopeSchema,
]) satisfies z.ZodType<TeamSystemClosureDriverScope>

/** Parse one detached source attribution resolved from a runtime-only closure-driver proof. */
export const teamSystemClosureDriverProofResolutionSchema = z.object({
  sourceName: teamSystemClosureDriverProofSourceNameSchema,
  scope: teamSystemClosureDriverScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemClosureDriverProofResolution>

/** Closed Team lifecycle parser. */
export const teamPhaseSchema = z.enum([
  'provisioning', 'active', 'quiescing', 'stalled', 'completed', 'failed', 'cancelled',
] as const) satisfies z.ZodType<TeamPhase>

/** Parse one stable system Team-phase proof-source registration name. */
export const teamSystemPhaseProofSourceNameSchema = trimmedNameSchema

/** Parse one source-owned TeamRun stalled-Team recovery scope. */
const teamRunResumePhaseScopeSchema = z.object({
  kind: z.literal('team-run-resume'),
  teamId: teamIdSchema,
  phase: z.literal('active'),
}).strict()

/** Parse one source-owned TeamRun final-result admission fence. */
const teamRunFinalizationQuiescePhaseScopeSchema = z.object({
  kind: z.literal('team-run-finalization-quiesce'),
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  phase: z.literal('quiescing'),
  finalChannelId: channelIdSchema,
  finalEnvelopeId: envelopeIdSchema,
  humanId: participantIdSchema,
  coordinatorId: participantIdSchema,
}).strict().refine(scope => scope.humanId !== scope.coordinatorId, {
  message: 'finalization quiesce scope must name distinct human and coordinator participants',
})

/** Parse one source-owned scheduler Team-stall scope. */
const schedulerStallPhaseScopeSchema = z.object({
  kind: z.literal('scheduler-stall'),
  teamId: teamIdSchema,
  phase: z.literal('stalled'),
  reason: teamStallReasonSchema,
}).strict()

/** Parse one controller-owned cancellation stall caused by a remote activation without termination proof. */
const activationControllerCancellationStallPhaseScopeSchema = z.object({
  kind: z.literal('activation-controller-cancellation-stall'),
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  phase: z.literal('stalled'),
  reason: z.object({
    code: z.literal('REMOTE_CANCELLATION_UNCONFIRMED'),
    message: nonEmptyStringSchema,
  }).strict(),
  cancellationIdempotencyKey: teamClosureIdempotencyKeySchema,
  cancellationRequestedAt: nonNegativeSafeIntegerSchema,
  activationId: activationIdSchema,
  participantId: participantIdSchema,
  sessionId: sessionIdSchema,
  provider: trimmedNameSchema,
}).strict()

/** Parse one controller closure stall bound to an existing intent and exact epoch. */
export const activationSupervisorDescriptorSchema = z.object({
  name: trimmedNameSchema, version: positiveSafeIntegerSchema,
  hostId: trimmedNameSchema, endpointId: trimmedNameSchema,
  generation: activationIdSchema,
  terminationMode: z.enum(['owned-process', 'externally-fenced', 'cooperative']),
}).strict()

/** Parse one controller recovery stall caused by unavailable supervisor evidence. */
const activationControllerRecoveryStallPhaseScopeSchema = z.object({
  kind: z.literal('activation-controller-recovery-stall'),
  teamId: teamIdSchema, expectedCursor: nonNegativeSafeIntegerSchema, phase: z.literal('stalled'),
  activationId: activationIdSchema, participantId: participantIdSchema,
  sessionId: sessionIdSchema, provider: trimmedNameSchema,
  supervisor: activationSupervisorDescriptorSchema.optional(),
  reason: z.object({
    code: z.enum([
      'SUPERVISOR_UNAVAILABLE', 'SUPERVISOR_INVALID', 'SUPERVISOR_GENERATION_MISMATCH',
      'SUPERVISOR_UNREACHABLE', 'SUPERVISOR_UNKNOWN', 'SUPERVISOR_TERMINATION_UNCONFIRMED',
      'AGENT_RUNTIME_PROVIDER_UNAVAILABLE', 'AGENT_RUNTIME_FENCER_UNAVAILABLE', 'AGENT_RUNTIME_FENCE_FAILED',
    ]),
    message: nonEmptyStringSchema,
  }).strict(),
}).strict()

/** Parse one controller closure stall bound to an existing intent and exact epoch. */
const activationControllerClosureStallPhaseScopeSchema = z.object({
  kind: z.literal('activation-controller-closure-stall'),
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  phase: z.literal('stalled'),
  closureKind: z.enum(['complete', 'fail', 'cancel']),
  idempotencyKey: teamClosureIdempotencyKeySchema,
  requestedAt: nonNegativeSafeIntegerSchema,
  activationId: activationIdSchema,
  participantId: participantIdSchema,
  sessionId: sessionIdSchema,
  provider: trimmedNameSchema,
  reason: z.object({
    code: z.enum(['ACTIVATION_TERMINATION_UNCONFIRMED', 'REMOTE_CANCELLATION_UNCONFIRMED', 'WORKSPACE_RELEASE_RECOVERY_FAILED']),
    message: nonEmptyStringSchema,
  }).strict(),
}).strict()

/** Parse the closed durable scope a system Team-phase proof may select. */
export const teamSystemPhaseScopeSchema = z.discriminatedUnion('kind', [
  teamRunResumePhaseScopeSchema,
  teamRunFinalizationQuiescePhaseScopeSchema,
  schedulerStallPhaseScopeSchema,
  activationControllerCancellationStallPhaseScopeSchema,
  activationControllerClosureStallPhaseScopeSchema,
  activationControllerRecoveryStallPhaseScopeSchema,
]) satisfies z.ZodType<TeamSystemPhaseScope>

/** Parse one detached source attribution resolved from a runtime-only Team-phase proof. */
export const teamSystemPhaseProofResolutionSchema = z.object({
  sourceName: teamSystemPhaseProofSourceNameSchema,
  scope: teamSystemPhaseScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemPhaseProofResolution>

/** Parse one stable system Team-maintenance proof-source registration name. */
export const teamSystemMaintenanceProofSourceNameSchema = trimmedNameSchema

/** Parse one source-owned scheduler Team-journal compaction scope. */
const schedulerTeamJournalCompactionScopeSchema = z.object({
  kind: z.literal('scheduler-team-journal-compaction'),
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  throughSequence: nonNegativeSafeIntegerSchema,
}).strict()

/** Parse one source-owned scheduler channel-WAL compaction scope. */
const schedulerChannelCompactionScopeSchema = z.object({
  kind: z.literal('scheduler-channel-compaction'),
  teamId: teamIdSchema,
  channelId: channelIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  throughSequence: nonNegativeSafeIntegerSchema,
}).strict()

/** Parse the closed durable scope a system Team-maintenance proof may select. */
export const teamSystemMaintenanceScopeSchema = z.discriminatedUnion('kind', [
  schedulerTeamJournalCompactionScopeSchema,
  schedulerChannelCompactionScopeSchema,
]) satisfies z.ZodType<TeamSystemMaintenanceScope>

/** Parse one detached source attribution resolved from a runtime-only Team-maintenance proof. */
export const teamSystemMaintenanceProofResolutionSchema = z.object({
  sourceName: teamSystemMaintenanceProofSourceNameSchema,
  scope: teamSystemMaintenanceScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemMaintenanceProofResolution>

/** Parse one stable system Team-interrupt proof-source registration name. */
export const teamSystemInterruptProofSourceNameSchema = trimmedNameSchema

/** Parse one source-owned TeamRun human-to-coordinator soft-interrupt scope. */
const teamRunHumanInterruptScopeSchema = z.object({
  kind: z.literal('team-run-human-interrupt'),
  teamId: teamIdSchema,
  channelId: channelIdSchema,
  humanId: participantIdSchema,
  coordinatorId: participantIdSchema,
}).strict().refine(scope => scope.humanId !== scope.coordinatorId, {
  message: 'team-run interrupt scope must name distinct human and coordinator participants',
})

/** Parse the closed durable scope a system Team-interrupt proof may select. */
export const teamSystemInterruptScopeSchema = (
  teamRunHumanInterruptScopeSchema
) satisfies z.ZodType<TeamSystemInterruptScope>

/** Parse one detached source attribution resolved from a runtime-only Team-interrupt proof. */
export const teamSystemInterruptProofResolutionSchema = z.object({
  sourceName: teamSystemInterruptProofSourceNameSchema,
  scope: teamSystemInterruptScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemInterruptProofResolution>

/** Parse an authenticated actor allowed to request a Team closure. */
export const teamClosureActorSchema: z.ZodType<TeamClosureActor> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('participant'), participantId: participantIdSchema }).strict(),
  z.object({ kind: z.literal('system'), name: nonEmptyStringSchema }).strict(),
])

/** Parse durable non-secret system provenance for proof-owned root creation. */
export const teamCreationActorSchema: z.ZodType<TeamCreationActor> = z.object({
  kind: z.literal('system'),
  name: nonEmptyStringSchema,
}).strict()

/** Parse the closed closure operation discriminator. */
export const teamClosureKindSchema = z.enum(['complete', 'fail', 'cancel'] as const) satisfies z.ZodType<TeamClosureKind>

/** Parse one durable Team closure intent. */
export const teamClosureSnapshotSchema = z.object({
  teamId: teamIdSchema,
  kind: teamClosureKindSchema,
  idempotencyKey: teamClosureIdempotencyKeySchema,
  actor: teamClosureActorSchema,
  reason: teamStallReasonSchema,
  finalChannelId: channelIdSchema.optional(),
  finalEnvelopeId: envelopeIdSchema.optional(),
  requestedAt: nonNegativeSafeIntegerSchema,
}).strict().superRefine((closure, context) => {
  const hasFinalChannel = closure.finalChannelId !== undefined
  const hasFinalEnvelope = closure.finalEnvelopeId !== undefined
  if (closure.kind === 'complete' && (!hasFinalChannel || !hasFinalEnvelope)) {
    context.addIssue({
      code: 'custom',
      path: ['finalChannelId'],
      message: 'completed Team closure requires final channel and Envelope identities',
    })
  }
  if (closure.kind !== 'complete' && (hasFinalChannel || hasFinalEnvelope)) {
    context.addIssue({
      code: 'custom',
      path: ['finalChannelId'],
      message: 'only completed Team closures may name a final result',
    })
  }
}) as z.ZodType<TeamClosureSnapshot>

/** Parse one durable Team cancellation request. */
export const teamCancellationSnapshotSchema = z.object({
  teamId: teamIdSchema,
  idempotencyKey: teamClosureIdempotencyKeySchema,
  actor: teamClosureActorSchema,
  reason: teamStallReasonSchema,
  requestedAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamCancellationSnapshot>

/** Closed Team objective lifecycle parser. */
export const teamGoalPhaseSchema = z.enum([
  'active', 'paused', 'blocked', 'complete',
] as const) satisfies z.ZodType<TeamGoalPhase>

/** Closed participant-membership lifecycle parser. */
export const participantPhaseSchema = z.enum([
  'invited', 'provisioning', 'active', 'left', 'failed',
] as const) satisfies z.ZodType<ParticipantPhase>

/** Closed live activation-status parser. */
export const activationStatusSchema = z.enum([
  'starting', 'running', 'idle', 'offline', 'stopping',
] as const) satisfies z.ZodType<ActivationStatus>

/** Closed channel lifecycle parser. */
export const channelPhaseSchema = z.enum([
  'pending', 'active', 'closing', 'closed', 'expired', 'failed',
] as const) satisfies z.ZodType<ChannelPhase>

/** Closed Team task lifecycle parser. */
export const teamTaskPhaseSchema = z.enum([
  'pending', 'assigned', 'running', 'review', 'completed', 'failed', 'cancelled', 'deleted',
] as const) satisfies z.ZodType<TeamTaskPhase>

/** Closed execution-world requirement for one Team task. */
export const teamTaskWorkspaceModeSchema = z.enum([
  'shared', 'worktree', 'sandbox', 'remote',
] as const) satisfies z.ZodType<TeamTaskWorkspaceMode>

/** Closed durable settlement state for one Team workspace allocation. */
export const teamWorkspaceAllocationLifecycleSchema = z.enum([
  'reserved', 'active', 'release-requested', 'released', 'preserved', 'unavailable',
] as const) satisfies z.ZodType<TeamWorkspaceAllocationLifecycle>

/** Parse an opaque provider observation identity. */
export const teamWorkspaceObservationIdSchema = nonEmptyStringSchema.transform(value => value as TeamWorkspaceObservationId)
/** Parse the immutable remote world without treating a path as ownership. */
export const teamWorkspaceExecutionWorldSchema = z.object({
  kind: z.literal('e2b'), id: trimmedNameSchema.transform(value => value as TeamWorkspaceExecutionWorldId),
}).strict()
/** Parse a provider-observed loss; only confirmed expiry proves execution termination. */
export const teamWorkspaceLossSchema = z.object({
  executionWorld: teamWorkspaceExecutionWorldSchema,
  reason: z.enum(['sandbox-expired', 'manifest-missing', 'world-changed']),
  terminationProven: z.boolean(),
  artifacts: z.array(z.lazy(() => teamArtifactReferenceSchema)),
}).strict().refine(value => value.terminationProven === (value.reason === 'sandbox-expired'), {
  message: 'only confirmed sandbox expiry proves execution termination',
}) satisfies z.ZodType<TeamWorkspaceLoss>
/** Parse a bounded content fingerprint. */
export const teamWorkspaceContentVersionSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u)
  .transform(value => value as TeamWorkspaceContentVersion)
/** Parse the completeness and actual time window of one bounded scan. */
export const teamWorkspaceScanVersionSchema = z.object({
  digest: teamWorkspaceContentVersionSchema, complete: z.boolean(),
  startedAt: nonNegativeSafeIntegerSchema, finishedAt: nonNegativeSafeIntegerSchema,
  scannedEntries: nonNegativeSafeIntegerSchema, hashedBytes: nonNegativeSafeIntegerSchema,
  knownOmittedEntries: nonNegativeSafeIntegerSchema, incompleteReasons: z.array(nonEmptyStringSchema),
}).strict().superRefine((value, ctx) => {
  if (value.finishedAt < value.startedAt || value.complete !== (value.incompleteReasons.length === 0)
    || (value.complete && value.knownOmittedEntries !== 0)) ctx.addIssue({ code: 'custom', message: 'Workspace scan completeness or time window is inconsistent' })
}) satisfies z.ZodType<TeamWorkspaceScanVersion>
const workspaceObservedPathFields = {
  path: nonEmptyStringSchema.refine(value => !value.includes('\\') && !value.includes('\0')
    && !value.startsWith('/') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'Expected a portable relative workspace path'),
  change: z.enum(['added', 'modified', 'deleted']),
}
const workspaceObservationFields = {
  teamId: teamIdSchema, allocationId: teamWorkspaceAllocationIdSchema, expectedRevision: positiveSafeIntegerSchema,
  previousObservationId: teamWorkspaceObservationIdSchema.optional(), id: teamWorkspaceObservationIdSchema,
  stage: z.enum(['baseline', 'restore', 'periodic', 'publish', 'release', 'integration']), base: teamWorkspaceScanVersionSchema.nullable(),
  baselineAvailable: z.boolean(),
  final: teamWorkspaceScanVersionSchema, paths: z.array(z.object(workspaceObservedPathFields).strict()),
  omittedPaths: nonNegativeSafeIntegerSchema,
}
/** Parse exact JSON-only facts from a provider observation. */
export const teamWorkspaceObservationInputSchema = z.object(workspaceObservationFields)
  .strict() satisfies z.ZodType<TeamWorkspaceObservationInput>
/** Parse one retained latest observation with Hub-derived provenance and classification. */
export const teamWorkspaceObservationSchema = z.object({
  ...workspaceObservationFields, taskId: teamTaskIdSchema, attemptId: taskAttemptIdSchema, truncated: z.boolean(),
  paths: z.array(z.object({ ...workspaceObservedPathFields, classification: z.enum(['declared', 'undeclared', 'external-window']) }).strict()),
  observedAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamWorkspaceObservation>

/** Parse provider-owned durable metadata for one Team task-attempt workspace allocation. */
export const teamWorkspaceAllocationSnapshotSchema = z.object({
  observation: teamWorkspaceObservationSchema.optional(),
  id: teamWorkspaceAllocationIdSchema,
  revision: positiveSafeIntegerSchema,
  teamId: teamIdSchema,
  taskId: teamTaskIdSchema,
  attemptId: taskAttemptIdSchema,
  assignedRevision: positiveSafeIntegerSchema,
  participantId: participantIdSchema,
  activationId: activationIdSchema,
  sessionId: sessionIdSchema,
  provider: trimmedNameSchema,
  mode: teamTaskWorkspaceModeSchema,
  baseVersion: nonEmptyStringSchema.optional(),
  executionWorld: teamWorkspaceExecutionWorldSchema.optional(),
  loss: teamWorkspaceLossSchema.safeExtend({ observedAt: nonNegativeSafeIntegerSchema }).optional(),
  lifecycle: teamWorkspaceAllocationLifecycleSchema,
  reservedAt: nonNegativeSafeIntegerSchema,
  updatedAt: nonNegativeSafeIntegerSchema,
  activatedAt: nonNegativeSafeIntegerSchema.optional(),
  releaseRequestedAt: nonNegativeSafeIntegerSchema.optional(),
  preservedAt: nonNegativeSafeIntegerSchema.optional(),
  releasedAt: nonNegativeSafeIntegerSchema.optional(),
  preservationReason: teamStallReasonSchema.optional(),
}).strict().superRefine((allocation, context) => {
  if (allocation.lifecycle === 'unavailable' && allocation.loss === undefined) {
    context.addIssue({ code: 'custom', path: ['loss'], message: 'unavailable allocation requires exact provider loss' })
  }
  if (allocation.loss !== undefined && (allocation.executionWorld?.id !== allocation.loss.executionWorld.id
    || allocation.loss.observedAt < allocation.reservedAt
    || allocation.loss.artifacts.some(artifact => artifact.provider === undefined || artifact.sourceAttemptId !== allocation.attemptId))) {
    context.addIssue({ code: 'custom', path: ['loss'], message: 'workspace loss must retain its exact world and provider-backed attempt artifacts' })
  }
  if (allocation.updatedAt < allocation.reservedAt) {
    context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'workspace allocation update cannot precede reservation' })
  }
  if (allocation.lifecycle === 'active' && allocation.activatedAt === undefined) {
    context.addIssue({ code: 'custom', path: ['activatedAt'], message: 'active workspace allocation requires its timestamp' })
  }
  if (allocation.lifecycle === 'release-requested' && allocation.releaseRequestedAt === undefined) {
    context.addIssue({ code: 'custom', path: ['releaseRequestedAt'], message: 'release-requested workspace allocation requires its timestamp' })
  }
  const preserved = allocation.lifecycle === 'preserved'
  if (preserved && (allocation.preservedAt === undefined || allocation.preservationReason === undefined)) {
    context.addIssue({ code: 'custom', path: ['preservedAt'], message: 'preserved workspace allocation requires its timestamp and reason' })
  }
  const released = allocation.lifecycle === 'released'
  if (released && allocation.releasedAt === undefined) {
    context.addIssue({ code: 'custom', path: ['releasedAt'], message: 'released workspace allocation requires its timestamp' })
  }
  if (allocation.activatedAt !== undefined && allocation.activatedAt < allocation.reservedAt) {
    context.addIssue({ code: 'custom', path: ['activatedAt'], message: 'workspace activation cannot precede reservation' })
  }
  if (allocation.releaseRequestedAt !== undefined && allocation.releaseRequestedAt < allocation.reservedAt) {
    context.addIssue({ code: 'custom', path: ['releaseRequestedAt'], message: 'workspace release request cannot precede reservation' })
  }
  if (allocation.preservedAt !== undefined && allocation.preservedAt < allocation.reservedAt) {
    context.addIssue({ code: 'custom', path: ['preservedAt'], message: 'workspace preservation cannot precede reservation' })
  }
  if (allocation.releasedAt !== undefined && allocation.releasedAt < allocation.reservedAt) {
    context.addIssue({ code: 'custom', path: ['releasedAt'], message: 'workspace release cannot precede reservation' })
  }
}) satisfies z.ZodType<TeamWorkspaceAllocationSnapshot>

/** Parse the minimal durable report retained for a completed task attempt. */
export const teamArtifactReferenceSchema = z.object({
  id: nonEmptyStringSchema,
  provider: nonEmptyStringSchema.optional(),
  kind: z.enum(['file', 'patch', 'log', 'screenshot', 'report'] as const),
  uri: nonEmptyStringSchema,
  contentHash: nonEmptyStringSchema.optional(),
  sourceAttemptId: taskAttemptIdSchema.optional(),
  visibility: z.enum(['private', 'team', 'human'] as const),
}).strict() satisfies z.ZodType<TeamArtifactReference>

/** Parse one authoritative visible-artifact lookup request. */
export const teamArtifactGetRequestSchema: z.ZodType<TeamArtifactGetRequest> = z.object({
  teamId: teamIdSchema,
  artifactId: nonEmptyStringSchema,
}).strict()

/** Parse one bounded visible artifact page request. */
export const teamArtifactListPageRequestSchema: z.ZodType<TeamArtifactListPageRequest> = z.object({
  teamId: teamIdSchema,
  afterCursor: observedCursorSchema,
  limit: positiveSafeIntegerSchema,
}).strict()

/** Parse one bounded visible artifact page. */
export const teamArtifactListPageSchema: z.ZodType<TeamArtifactListPage> = z.object({
  items: z.array(teamArtifactReferenceSchema),
  nextCursor: nonNegativeSafeIntegerSchema.optional(),
}).strict()

/** Parse the immutable source and target selected by a Team integration task. */
export const teamTaskIntegrationSpecSchema = z.object({
  sourceTaskId: teamTaskIdSchema,
  sourceAttemptId: taskAttemptIdSchema,
  provider: nonEmptyStringSchema,
  target: nonEmptyStringSchema,
  expectedTarget: nonEmptyStringSchema.optional(),
  mode: z.enum(['proposal', 'integrate'] as const),
}).strict() satisfies z.ZodType<TeamTaskIntegrationSpec>

/** Parse the provider result retained by one explicit integration attempt. */
export const taskAttemptIntegrationResultSchema = z.object({
  target: nonEmptyStringSchema,
  expectedTarget: nonEmptyStringSchema.optional(),
  status: z.enum(['proposed', 'integrated', 'conflict'] as const),
  targetVersion: nonEmptyStringSchema.optional(),
  proposalArtifact: teamArtifactReferenceSchema.optional(),
  conflictPaths: z.array(nonEmptyStringSchema).optional(),
  verification: nonEmptyStringSchema.optional(),
  artifacts: z.array(teamArtifactReferenceSchema).optional(),
}).strict().superRefine((result, context) => {
  if (result.status === 'integrated' && result.targetVersion === undefined) {
    context.addIssue({ code: 'custom', path: ['targetVersion'], message: 'integrated result requires the resulting target version' })
  }
  if (result.status !== 'integrated' && result.targetVersion !== undefined) {
    context.addIssue({ code: 'custom', path: ['targetVersion'], message: 'only an integrated result may retain a target version' })
  }
  if (result.status === 'conflict'
    && (result.conflictPaths === undefined || result.conflictPaths.length === 0)
    && result.expectedTarget === undefined) {
    context.addIssue({ code: 'custom', path: ['conflictPaths'], message: 'conflict result requires conflicting paths or an expected target fence' })
  }
  if (result.status !== 'conflict' && result.conflictPaths !== undefined) {
    context.addIssue({ code: 'custom', path: ['conflictPaths'], message: 'only a conflict result may retain conflict paths' })
  }
  if (result.status === 'conflict' && result.targetVersion !== undefined) {
    context.addIssue({ code: 'custom', path: ['targetVersion'], message: 'conflict result must not retain a target version' })
  }
}) satisfies z.ZodType<TaskAttemptIntegrationResult>

/** Parse the minimal durable report retained for a completed task attempt. */
export const taskAttemptResultSchema = z.object({
  summary: nonEmptyStringSchema,
  evidence: z.array(nonEmptyStringSchema).optional(),
  artifacts: z.array(teamArtifactReferenceSchema).optional(),
  changedPaths: z.array(nonEmptyStringSchema).optional(),
  verification: nonEmptyStringSchema.optional(),
  integration: taskAttemptIntegrationResultSchema.optional(),
}).strict() satisfies z.ZodType<TaskAttemptResult>

/** Parse the minimal durable failure fact retained for a failed task attempt. */
export const taskAttemptFailureSchema = z.object({
  code: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<TaskAttemptFailure>

/** Parse the terminal fact retained for one settled Team task attempt. */
export const taskAttemptOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('released') }).strict(),
  z.object({ kind: z.literal('lease-expired') }).strict(),
  z.object({ kind: z.literal('failed'), failure: taskAttemptFailureSchema }).strict(),
  z.object({ kind: z.literal('completed'), result: taskAttemptResultSchema }).strict(),
  z.object({ kind: z.literal('cancelled') }).strict(),
]) satisfies z.ZodType<TaskAttemptOutcome>

/** Closed participant-kind parser. */
export const participantKindSchema = z.enum([
  'human', 'local-agent', 'remote-agent', 'service',
] as const) satisfies z.ZodType<ParticipantKind>

/** Parse the closed durable owner of a human Team participant. */
export const teamParticipantOwnerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('product-principal'),
    principalId: trimmedTextSchema,
  }).strict(),
  z.object({ kind: z.literal('system') }).strict(),
]) as z.ZodType<TeamParticipantOwner>

/** Require a durable owner exactly for human participants. */
function requireParticipantOwner(
  participant: { readonly kind: ParticipantKind; readonly owner?: TeamParticipantOwner | undefined },
  context: z.RefinementCtx,
): void {
  if (participant.kind === 'human' && participant.owner === undefined) {
    context.addIssue({ code: 'custom', path: ['owner'], message: 'human participants require a durable owner' })
  }
  if (participant.kind !== 'human' && participant.owner !== undefined) {
    context.addIssue({ code: 'custom', path: ['owner'], message: 'only human participants may retain an owner' })
  }
}

/** Parse a participant's immutable, duplicate-free scheduler capabilities. */
export const participantCapabilitiesSchema = z.array(nonEmptyStringSchema).superRefine((capabilities, context) => {
  const seen = new Set<string>()
  for (const [index, capability] of capabilities.entries()) {
    if (seen.has(capability)) {
      context.addIssue({
        code: 'custom', path: [index],
        message: 'participant capabilities must not contain duplicates',
      })
    }
    seen.add(capability)
  }
})

/** Parse a provider-frozen integer-bucket scheduling policy. */
export const teamTaskRankingPolicySchema = z.object({
  name: z.literal('outcome-latency'),
  version: z.literal(1),
  latencyUpperBoundsMs: z.array(nonNegativeSafeIntegerSchema).min(1),
  costRateUpperBounds: z.array(nonNegativeSafeIntegerSchema).min(1),
  missingCost: z.literal('unknown-last'),
}).strict().superRefine((policy, context) => {
  for (const key of ['latencyUpperBoundsMs', 'costRateUpperBounds'] as const) {
    if (policy[key].some((value, index, values) => {
      const prior = values[index - 1]
      return prior !== undefined && value <= prior
    })) {
      context.addIssue({ code: 'custom', path: [key], message: 'ranking bucket bounds must strictly increase' })
    }
  }
}) satisfies z.ZodType<TeamTaskRankingPolicy>

/** Parse one exact capability-set attempt aggregate. */
export const teamTaskExecutionStatsSchema = z.object({
  participantId: participantIdSchema,
  requiredCapabilities: z.array(nonEmptyStringSchema),
  completedAttempts: nonNegativeSafeIntegerSchema,
  failedAttempts: nonNegativeSafeIntegerSchema,
  totalLatencyMs: nonNegativeSafeIntegerSchema,
  latencyBucketCounts: z.array(nonNegativeSafeIntegerSchema).min(1),
}).strict().superRefine((stats, context) => {
  if (stats.requiredCapabilities.some((value, index, values) => {
    const prior = values[index - 1]
    return prior !== undefined && value <= prior
  })) {
    context.addIssue({ code: 'custom', path: ['requiredCapabilities'], message: 'execution statistics require sorted unique capabilities' })
  }
  const attempts = stats.completedAttempts + stats.failedAttempts
  if (!Number.isSafeInteger(attempts) || stats.latencyBucketCounts.reduce((sum, count) => sum + count, 0) !== attempts) {
    context.addIssue({ code: 'custom', path: ['latencyBucketCounts'], message: 'latency counts must cover every settled attempt exactly once' })
  }
}) satisfies z.ZodType<TeamTaskExecutionStats>

/** Parse Hub-derived participant operating statistics. */
export const participantStatsSchema = z.object({
  taskOutcomes: z.array(teamTaskExecutionStatsSchema).optional(),
  activeAttempts: nonNegativeSafeIntegerSchema,
  completedAttempts: nonNegativeSafeIntegerSchema,
  failedAttempts: nonNegativeSafeIntegerSchema,
  totalLatencyMs: nonNegativeSafeIntegerSchema,
  updatedAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<ParticipantStats>

/** Closed recipient-delivery intent parser. */
export const envelopeDeliverySchema = z.enum([
  'context', 'turn', 'steer',
] as const) satisfies z.ZodType<EnvelopeDelivery>

/** Closed queue-priority parser. */
export const envelopePrioritySchema = z.enum([
  'background', 'normal', 'urgent',
] as const) satisfies z.ZodType<EnvelopePriority>

/** Parse lossless JSON recursively, excluding undefined values, non-finite numbers, and -0. */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().refine(value => !Object.is(value, -0), { message: 'JSON does not preserve -0' }),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]))

/** Parse a lossless JSON object. */
export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema)

const teamResourceBudgetFields = {
  maxInputTokens: nonNegativeSafeIntegerSchema.optional(),
  maxOutputTokens: nonNegativeSafeIntegerSchema.optional(),
  maxTotalTokens: nonNegativeSafeIntegerSchema.optional(),
  maxTurns: nonNegativeSafeIntegerSchema.optional(),
  maxWallTimeMs: nonNegativeSafeIntegerSchema.optional(),
  maxCostUnits: nonNegativeNumberSchema.optional(),
  maxRetries: nonNegativeSafeIntegerSchema.optional(),
  maxConcurrency: nonNegativeSafeIntegerSchema.optional(),
  maxArtifactBytes: nonNegativeSafeIntegerSchema.optional(),
  extensions: jsonObjectSchema.optional(),
}

/** Parse the typed resource-ceiling portion of a Team or task budget object. */
export const teamResourceBudgetSchema = z.object(teamResourceBudgetFields).strict() as unknown as z.ZodType<TeamResourceBudget>

const authorityOperationSchema = z.enum([
  'register', 'invite', 'activate', 'channel-open', 'send', 'human-action', 'usage', 'dispatch',
  'goal-mutate', 'task-mutate', 'task-assign', 'interrupt', 'workspace-allocate', 'workspace-integrate', 'close',
] as const)

/** Parse immutable placement restrictions shared by tasks and authority grants. */
const placementRestrictionsSchema = z.object({
  participantIds: z.array(participantIdSchema).optional(),
  roles: z.array(nonEmptyStringSchema).optional(),
  providers: z.array(nonEmptyStringSchema).optional(),
  presets: z.array(nonEmptyStringSchema).optional(),
  models: z.array(nonEmptyStringSchema).optional(),
}).strict().superRefine((placement, context) => {
  for (const [key, values] of Object.entries(placement)) {
    if (values !== undefined && new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', path: [key], message: 'placement restrictions must be duplicate-free' })
    }
  }
})

/** Parse an immutable Team or Participant authority grant. */
export const teamAuthorityGrantSchema = z.object({
  operations: z.array(authorityOperationSchema),
  workspaceModes: z.array(teamTaskWorkspaceModeSchema),
  readScopes: z.array(nonEmptyStringSchema),
  writeScopes: z.array(nonEmptyStringSchema),
  placement: placementRestrictionsSchema.optional(),
  budgets: teamResourceBudgetSchema,
}).strict().superRefine((grant, context) => {
  if (new Set(grant.operations).size !== grant.operations.length) {
    context.addIssue({ code: 'custom', path: ['operations'], message: 'authority operations must be distinct' })
  }
  if (new Set(grant.workspaceModes).size !== grant.workspaceModes.length) {
    context.addIssue({ code: 'custom', path: ['workspaceModes'], message: 'authority workspace modes must be distinct' })
  }
  if (new Set(grant.readScopes).size !== grant.readScopes.length) {
    context.addIssue({ code: 'custom', path: ['readScopes'], message: 'authority read scopes must be distinct' })
  }
  if (new Set(grant.writeScopes).size !== grant.writeScopes.length) {
    context.addIssue({ code: 'custom', path: ['writeScopes'], message: 'authority write scopes must be distinct' })
  }
}) as unknown as z.ZodType<TeamAuthorityGrant>

/** Closed host-mediated human-action kind parser. */
export const teamHumanActionKindSchema = z.enum(['approval', 'question'] as const) satisfies z.ZodType<TeamHumanActionKind>

/** Closed durable human-action lifecycle parser. */
export const teamHumanActionPhaseSchema = z.enum(['pending', 'resolved', 'cancelled'] as const) satisfies z.ZodType<TeamHumanActionPhase>

/** Parse a closed human response; question semantics remain owned by the live continuation. */
export const teamHumanActionAnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('approval'), outcome: z.enum(['allowed-once', 'rejected']) }).strict(),
  z.object({ kind: z.literal('question'), answers: z.array(z.object({ id: z.string(), selected: z.array(z.string()), custom: z.string().optional() }).strict()) }).strict(),
])
/** Parse a response retry identity independently of action ids. */
export const teamHumanActionResponseIdempotencyKeySchema = z.string().trim().min(1).max(256)
  .transform(value => value as import('./human-delivery-types.ts').TeamHumanActionResponseIdempotencyKey)
/** Parse the complete actor-free response and request revision. */
export const teamHumanActionResponseInputSchema = z.object({
  teamId: teamIdSchema, actionId: teamHumanActionIdSchema,
  expectedUpdatedAt: nonNegativeSafeIntegerSchema, idempotencyKey: teamHumanActionResponseIdempotencyKeySchema,
  answer: teamHumanActionAnswerSchema,
}).strict()
/** Parse durable answer acceptance without claiming tool completion. */
const teamHumanActionResponseSnapshotSchema = z.object({
  expectedUpdatedAt: nonNegativeSafeIntegerSchema, idempotencyKey: teamHumanActionResponseIdempotencyKeySchema,
  answer: teamHumanActionAnswerSchema, respondedBy: participantIdSchema, acceptedAt: nonNegativeSafeIntegerSchema,
}).strict()
/** Parse one durable Team-wide approval/question projection. */
export const teamHumanActionSnapshotSchema = z.object({
  id: teamHumanActionIdSchema,
  teamId: teamIdSchema,
  kind: teamHumanActionKindSchema,
  phase: teamHumanActionPhaseSchema,
  sessionId: sessionIdSchema,
  participantId: participantIdSchema,
  taskId: teamTaskIdSchema.optional(),
  attemptId: taskAttemptIdSchema.optional(),
  sourceId: teamHumanActionSourceIdSchema,
  details: jsonObjectSchema,
  outcome: jsonObjectSchema.optional(),
  response: teamHumanActionResponseSnapshotSchema.optional(),
  createdAt: nonNegativeSafeIntegerSchema,
  updatedAt: nonNegativeSafeIntegerSchema,
}).strict().superRefine((action, context) => {
  if (action.attemptId !== undefined && action.taskId === undefined) {
    context.addIssue({ code: 'custom', path: ['attemptId'], message: 'human action attempt requires its task' })
  }
  if (action.response !== undefined && (action.response.answer.kind !== action.kind
    || action.response.acceptedAt < action.createdAt || action.response.acceptedAt > action.updatedAt
    || action.response.expectedUpdatedAt < action.createdAt || action.response.expectedUpdatedAt > action.response.acceptedAt)) {
    context.addIssue({ code: 'custom', path: ['response'], message: 'response must select this action kind and valid request lifetime' })
  }
  if (action.updatedAt < action.createdAt) {
    context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'human action updatedAt must not precede createdAt' })
  }
  if (action.phase === 'pending' && action.outcome !== undefined) {
    context.addIssue({ code: 'custom', path: ['outcome'], message: 'pending human action cannot carry an outcome' })
  }
  if (action.phase !== 'pending' && action.outcome === undefined) {
    context.addIssue({ code: 'custom', path: ['outcome'], message: 'settled human action requires an outcome' })
  }
}) as z.ZodType<TeamHumanActionSnapshot>

/** Parse one stable system human-action proof-source registration name. */
export const teamSystemHumanActionProofSourceNameSchema = trimmedNameSchema

/** Parse the Host-derived pending action facts allowed in one system proof scope. */
const pendingHostHumanActionSchema = teamHumanActionSnapshotSchema.superRefine((action, context) => {
  if (action.phase !== 'pending') {
    context.addIssue({ code: 'custom', path: ['phase'], message: 'system human-action scope must retain a pending action' })
  }
  if (action.createdAt !== 0 || action.updatedAt !== 0) {
    context.addIssue({ code: 'custom', path: ['createdAt'], message: 'system human-action scope timestamps must be Hub-derived placeholders' })
  }
})

/** Parse an exact Host admission of one verified pending human action. */
const hostHumanActionUpsertScopeSchema = z.object({
  kind: z.literal('host-human-action-upsert'),
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  action: pendingHostHumanActionSchema,
}).strict().superRefine((scope, context) => {
  if (scope.action.teamId !== scope.teamId) {
    context.addIssue({ code: 'custom', path: ['action', 'teamId'], message: 'human-action scope action must belong to its Team' })
  }
})

/** Parse an exact Host resolution of one verified pending human action. */
const hostHumanActionResolveScopeSchema = z.object({
  kind: z.literal('host-human-action-resolve'),
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  action: pendingHostHumanActionSchema,
  phase: z.enum(['resolved', 'cancelled'] as const),
  outcome: jsonObjectSchema,
}).strict().superRefine((scope, context) => {
  if (scope.action.teamId !== scope.teamId) {
    context.addIssue({ code: 'custom', path: ['action', 'teamId'], message: 'human-action scope action must belong to its Team' })
  }
})

/** Parse the closed Host human-action operation selected by one system proof. */
export const teamSystemHumanActionScopeSchema = z.discriminatedUnion('kind', [
  hostHumanActionUpsertScopeSchema,
  hostHumanActionResolveScopeSchema,
  z.object({ kind: z.literal('host-human-action-response-accept'), teamId: teamIdSchema, expectedCursor: nonNegativeSafeIntegerSchema,
    action: pendingHostHumanActionSchema, input: teamHumanActionResponseInputSchema,
    principalId: nonEmptyStringSchema.transform(value => value as import('@clocky/clocky-product-principal').ProductPrincipalId), humanId: participantIdSchema }).strict(),
  z.object({ kind: z.literal('host-human-action-unavailable'), teamId: teamIdSchema, expectedCursor: nonNegativeSafeIntegerSchema,
    action: teamHumanActionSnapshotSchema }).strict(),
]) satisfies z.ZodType<TeamSystemHumanActionScope>

/** Parse one detached source attribution resolved from a runtime-only human-action proof. */
export const teamSystemHumanActionProofResolutionSchema = z.object({
  sourceName: teamSystemHumanActionProofSourceNameSchema,
  scope: teamSystemHumanActionScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemHumanActionProofResolution>

/** Parse one stable system task-lease proof-source registration name. */
export const teamSystemTaskLeaseProofSourceNameSchema = trimmedNameSchema

/** Parse an exact scheduler assignment scope for one ready Team task. */
const schedulerTaskAssignLeaseScopeSchema = z.object({
  kind: z.literal('scheduler-task-assign'),
  teamId: teamIdSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  participantId: participantIdSchema,
  activationId: activationIdSchema.optional(),
  wakeChannelId: channelIdSchema.optional(),
  leaseDurationMs: positiveSafeIntegerSchema,
}).strict()

/** Parse an exact scheduler expiry scope for one elapsed current lease. */
const schedulerTaskExpireLeaseScopeSchema = z.object({
  kind: z.literal('scheduler-task-expire'),
  teamId: teamIdSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  attemptId: taskAttemptIdSchema,
}).strict()

/** Parse the exact revision selection of an already accepted task stop. */
export const teamTaskCancellationReconcileInputSchema = z.object({
  teamId: teamIdSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  requestedRevision: positiveSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamTaskCancellationReconcileInput>

/** Parse the closed scheduler task-lease operation selected by one system proof. */
export const teamSystemTaskLeaseScopeSchema = z.discriminatedUnion('kind', [
  schedulerTaskAssignLeaseScopeSchema,
  schedulerTaskExpireLeaseScopeSchema,
  teamTaskCancellationReconcileInputSchema.extend({ kind: z.literal('scheduler-task-cancellation-reconcile') }).strict(),
]) satisfies z.ZodType<TeamSystemTaskLeaseScope>

/** Parse one detached source attribution resolved from a runtime-only task-lease proof. */
export const teamSystemTaskLeaseProofResolutionSchema = z.object({
  sourceName: teamSystemTaskLeaseProofSourceNameSchema,
  scope: teamSystemTaskLeaseScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemTaskLeaseProofResolution>

/** Parse provider-reported token buckets for one model step. */
export const teamTokenUsageSchema = z.object({
  inputTokens: nonNegativeSafeIntegerSchema,
  outputTokens: nonNegativeSafeIntegerSchema,
  cacheReadTokens: nonNegativeSafeIntegerSchema.optional(),
  cacheWriteTokens: nonNegativeSafeIntegerSchema.optional(),
  reasoningTokens: nonNegativeSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<TeamTokenUsage>

/** Parse the durable aggregate of model usage observed by one Team. */
export const teamUsageSnapshotSchema = z.object({
  inputTokens: nonNegativeSafeIntegerSchema,
  outputTokens: nonNegativeSafeIntegerSchema,
  cacheReadTokens: nonNegativeSafeIntegerSchema,
  cacheWriteTokens: nonNegativeSafeIntegerSchema,
  turns: nonNegativeSafeIntegerSchema,
  costUnits: nonNegativeNumberSchema,
  updatedAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamUsageSnapshot>

/** Parse one provider/model per-token pricing entry. */
export const teamUsageRateSchema = z.object({
  input: nonNegativeNumberSchema,
  output: nonNegativeNumberSchema,
  cacheRead: nonNegativeNumberSchema,
  cacheWrite: nonNegativeNumberSchema,
}).strict() satisfies z.ZodType<TeamUsageRate>

const teamUsageSampleInputFields = {
  id: teamUsageSampleIdSchema,
  provider: nonEmptyStringSchema.optional(),
  model: nonEmptyStringSchema.optional(),
  turn: nonNegativeSafeIntegerSchema,
  step: nonNegativeSafeIntegerSchema,
  taskId: teamTaskIdSchema.optional(),
  attemptId: taskAttemptIdSchema.optional(),
  usage: teamTokenUsageSchema,
  costUnits: nonNegativeNumberSchema.optional(),
}

/** Validate optional task/attempt usage provenance as an inseparable pair. */
function validateUsageTaskProvenance(
  sample: { readonly taskId?: TeamTaskId | undefined; readonly attemptId?: TaskAttemptId | undefined },
  context: z.RefinementCtx,
): void {
  if ((sample.taskId === undefined) !== (sample.attemptId === undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['attemptId'],
      message: 'task usage provenance requires both taskId and attemptId',
    })
  }
}

/** Parse JSON-only provider/model usage facts for one activation-owned model step. */
export const teamUsageSampleInputSchema = z.object(teamUsageSampleInputFields).strict()
  .superRefine(validateUsageTaskProvenance) as z.ZodType<TeamUsageSampleInput>

/** Parse one exact durable Team/Participant/Session provider usage observation. */
export const teamUsageSampleSchema = z.object({
  ...teamUsageSampleInputFields,
  teamId: teamIdSchema,
  participantId: participantIdSchema,
  sessionId: sessionIdSchema,
  observedAt: nonNegativeSafeIntegerSchema,
}).strict().superRefine(validateUsageTaskProvenance) as z.ZodType<TeamUsageSample>

/** Parse one child-usage charge propagated to a parent Team. */
export const teamUsageChargeSchema = z.object({
  id: teamUsageChargeIdSchema,
  sourceTeamId: teamIdSchema,
  parentTaskId: teamTaskIdSchema,
  originTeamId: teamIdSchema,
  sourceSampleId: teamUsageSampleIdSchema,
  participantId: participantIdSchema,
  sessionId: sessionIdSchema,
  provider: nonEmptyStringSchema.optional(),
  model: nonEmptyStringSchema.optional(),
  turn: nonNegativeSafeIntegerSchema,
  step: nonNegativeSafeIntegerSchema,
  usage: teamTokenUsageSchema,
  costUnits: nonNegativeNumberSchema.optional(),
  observedAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamUsageCharge>

/** Parse one frozen adapter identity. */
export const teamAdapterRefSchema = z.object({
  type: nonEmptyStringSchema,
  version: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamAdapterRef>

/** Parse one frozen channel view-policy identity. */
export const teamViewPolicyRefSchema = z.object({
  type: nonEmptyStringSchema,
  version: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamViewPolicyRef>

const teamWorkflowExtensionFields = {
  name: trimmedTextSchema,
  version: positiveSafeIntegerSchema,
  config: jsonValueSchema,
}

/** Parse the exact Agent binding that may author a workflow plan. */
const teamWorkflowPlanActorSchema: z.ZodType<TeamTaskCreator> = z.object({
  teamId: teamIdSchema,
  participantId: participantIdSchema,
  activationId: activationIdSchema,
  sessionId: sessionIdSchema,
  provider: nonEmptyStringSchema,
}).strict()

/** Parse one built-in or versioned extension condition in a workflow plan. */
export const teamWorkflowConditionSchema: z.ZodType<TeamWorkflowCondition> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('always') }).strict(),
  z.object({ kind: z.literal('envelope-kind'), value: trimmedTextSchema }).strict(),
  z.object({ kind: z.literal('payload-present'), path: trimmedTextSchema }).strict(),
  z.object({ kind: z.literal('payload-equals'), path: trimmedTextSchema, value: jsonValueSchema }).strict(),
  z.object({ kind: z.literal('extension'), ...teamWorkflowExtensionFields }).strict(),
])

/** Parse one role, round-robin, or versioned extension target in a workflow plan. */
export const teamWorkflowTargetSchema: z.ZodType<TeamWorkflowTarget> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('participant'), role: trimmedTextSchema }).strict(),
  z.object({ kind: z.literal('round-robin') }).strict(),
  z.object({ kind: z.literal('stay') }).strict(),
  z.object({ kind: z.literal('return-to-initiator') }).strict(),
  z.object({ kind: z.literal('terminate') }).strict(),
  z.object({ kind: z.literal('extension'), ...teamWorkflowExtensionFields }).strict(),
])

/** Parse one ordered transition in a workflow channel graph. */
export const teamWorkflowTransitionSchema: z.ZodType<TeamWorkflowTransition> = z.object({
  condition: teamWorkflowConditionSchema,
  target: teamWorkflowTargetSchema,
}).strict()

/** Parse the bounded transition graph retained by a workflow plan. */
export const teamWorkflowGraphSchema: z.ZodType<TeamWorkflowGraph> = z.object({
  initial: teamWorkflowTargetSchema,
  transitions: z.array(teamWorkflowTransitionSchema),
  defaultTarget: teamWorkflowTargetSchema.optional(),
  maxTurns: positiveSafeIntegerSchema,
}).strict()

/** Parse the role roster and graph selected for one workflow channel. */
export const teamWorkflowChannelPlanSchema: z.ZodType<TeamWorkflowChannelPlan> = z.object({
  participantRoles: z.array(trimmedTextSchema),
  graph: teamWorkflowGraphSchema,
  viewPolicy: teamViewPolicyRefSchema.optional(),
}).strict()

/** Parse a task-template review route before its reviewer role is resolved. */
export const teamWorkflowTaskReviewPolicySchema: z.ZodType<TeamWorkflowTaskReviewPolicy> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('participant'), reviewerRole: trimmedTextSchema }).strict(),
])

/** Parse one complete task template in a declarative workflow plan. */
export const teamWorkflowTaskTemplateSchema: z.ZodType<TeamWorkflowTaskTemplate> = z.object({
  id: teamWorkflowTaskTemplateIdSchema,
  subject: trimmedTextSchema,
  description: trimmedTextSchema,
  blockedBy: z.array(teamWorkflowTaskTemplateIdSchema),
  requiredCapabilities: z.array(trimmedTextSchema),
  priority: nonNegativeSafeIntegerSchema,
  readScopes: z.array(trimmedTextSchema),
  writeScopes: z.array(trimmedTextSchema),
  workspaceMode: teamTaskWorkspaceModeSchema,
  budget: jsonObjectSchema,
  reviewPolicy: teamWorkflowTaskReviewPolicySchema,
  maxAttempts: positiveSafeIntegerSchema,
}).strict()

/** Parse the explicit task/concurrency ceilings for one workflow plan. */
export const teamWorkflowPlanBoundsSchema: z.ZodType<TeamWorkflowPlanBounds> = z.object({
  maxTasks: positiveSafeIntegerSchema,
  maxParallelism: positiveSafeIntegerSchema,
  maxTotalAttempts: positiveSafeIntegerSchema,
}).strict()

/** Parse the plan-authored result selection. */
export const teamWorkflowResultProjectionSchema: z.ZodType<TeamWorkflowResultProjection> = z.object({
  kind: z.literal('task-results'),
  taskTemplateIds: z.array(teamWorkflowTaskTemplateIdSchema),
}).strict()

/** Parse and semantically validate one complete declarative workflow plan. */
export const teamWorkflowPlanSchema: z.ZodType<TeamWorkflowPlan> = z.object({
  version: z.literal(1),
  name: trimmedTextSchema,
  tasks: z.array(teamWorkflowTaskTemplateSchema),
  bounds: teamWorkflowPlanBoundsSchema,
  channel: teamWorkflowChannelPlanSchema,
  result: teamWorkflowResultProjectionSchema,
}).strict().superRefine((plan, context) => {
  try {
    validateTeamWorkflowPlan(plan)
  } catch (error: unknown) {
    context.addIssue({ code: 'custom', path: [], message: error instanceof Error ? error.message : String(error) })
  }
}) satisfies z.ZodType<TeamWorkflowPlan>

/** Parse one durable plan-to-task binding. */
export const teamWorkflowTaskBindingSchema: z.ZodType<TeamWorkflowTaskBinding> = z.object({
  templateId: teamWorkflowTaskTemplateIdSchema,
  taskId: teamTaskIdSchema,
}).strict()

/** Parse an unsatisfied terminal prerequisite retained by an unstarted workflow task. */
export const teamTaskDependencyOutcomeSchema = z.object({
  taskId: teamTaskIdSchema,
  revision: positiveSafeIntegerSchema,
  phase: z.enum(['failed', 'cancelled', 'deleted']),
}).strict() satisfies z.ZodType<TeamTaskDependencyOutcome>

/** Parse one task result retained by a terminal workflow plan. */
export const teamWorkflowProjectedTaskResultSchema: z.ZodType<TeamWorkflowProjectedTaskResult> = z.discriminatedUnion('phase', [
  z.object({
    templateId: teamWorkflowTaskTemplateIdSchema,
    taskId: teamTaskIdSchema,
    phase: z.literal('completed'),
    result: taskAttemptResultSchema,
  }).strict(),
  z.object({
    templateId: teamWorkflowTaskTemplateIdSchema,
    taskId: teamTaskIdSchema,
    phase: z.literal('failed'),
    failure: taskAttemptFailureSchema.optional(),
  }).strict(),
  z.object({
    templateId: teamWorkflowTaskTemplateIdSchema,
    taskId: teamTaskIdSchema,
    phase: z.enum(['cancelled', 'deleted'] as const),
    blockedByOutcome: teamTaskDependencyOutcomeSchema.optional(),
  }).strict(),
])

/** Parse the terminal task-result projection retained by a workflow plan. */
export const teamWorkflowPlanResultSchema: z.ZodType<TeamWorkflowPlanResult> = z.object({
  kind: z.literal('task-results'),
  tasks: z.array(teamWorkflowProjectedTaskResultSchema),
}).strict()

/** Parse one complete durable workflow plan snapshot. */
export const teamWorkflowPlanSnapshotSchema: z.ZodType<TeamWorkflowPlanSnapshot> = z.object({
  id: teamWorkflowPlanIdSchema,
  teamId: teamIdSchema,
  revision: positiveSafeIntegerSchema,
  idempotencyKey: teamWorkflowPlanIdempotencyKeySchema,
  actor: teamWorkflowPlanActorSchema.optional(),
  plan: teamWorkflowPlanSchema,
  phase: z.enum(['compiling', 'ready', 'completed', 'failed', 'cancelled'] as const) satisfies z.ZodType<TeamWorkflowPlanPhase>,
  taskBindings: z.array(teamWorkflowTaskBindingSchema),
  channelId: channelIdSchema.optional(),
  result: teamWorkflowPlanResultSchema.optional(),
  failure: teamStallReasonSchema.optional(),
  cancellation: teamStallReasonSchema.optional(),
}).strict().superRefine((snapshot, context) => {
  const templateIds = new Set(snapshot.plan.tasks.map(task => task.id))
  if (snapshot.actor !== undefined && snapshot.actor.teamId !== snapshot.teamId) {
    context.addIssue({ code: 'custom', path: ['actor', 'teamId'], message: 'workflow plan actor must retain the owning Team id' })
  }
  const bindings = new Set<TeamWorkflowTaskTemplateId>()
  const taskIds = new Set<TeamTaskId>()
  for (const [index, binding] of snapshot.taskBindings.entries()) {
    if (!templateIds.has(binding.templateId)) context.addIssue({ code: 'custom', path: ['taskBindings', index, 'templateId'], message: 'workflow binding references an unknown template' })
    if (bindings.has(binding.templateId)) context.addIssue({ code: 'custom', path: ['taskBindings', index, 'templateId'], message: 'workflow template is bound more than once' })
    if (taskIds.has(binding.taskId)) context.addIssue({ code: 'custom', path: ['taskBindings', index, 'taskId'], message: 'workflow task is bound more than once' })
    bindings.add(binding.templateId)
    taskIds.add(binding.taskId)
  }
  if (snapshot.phase === 'completed' && snapshot.result === undefined) context.addIssue({ code: 'custom', path: ['result'], message: 'completed workflow plan requires a result projection' })
  if ((snapshot.phase === 'compiling' || snapshot.phase === 'ready') && snapshot.result !== undefined) context.addIssue({ code: 'custom', path: ['result'], message: 'only terminal workflow plans may retain a result projection' })
  if (snapshot.phase === 'failed' && snapshot.failure === undefined) context.addIssue({ code: 'custom', path: ['failure'], message: 'failed workflow plan requires a failure' })
  if (snapshot.phase !== 'failed' && snapshot.failure !== undefined) context.addIssue({ code: 'custom', path: ['failure'], message: 'only a failed workflow plan may retain a failure' })
  if (snapshot.phase !== 'cancelled' && snapshot.cancellation !== undefined) context.addIssue({ code: 'custom', path: ['cancellation'], message: 'only a cancelled workflow plan may retain a cancellation reason' })
  if ((snapshot.phase === 'ready' || snapshot.result !== undefined) && bindings.size !== snapshot.plan.tasks.length) {
    context.addIssue({ code: 'custom', path: ['taskBindings'], message: 'ready workflow plan must bind every task template' })
  }
  if (snapshot.result !== undefined) {
    const resultIds = new Set(snapshot.result.tasks.map(task => task.templateId))
    if (resultIds.size !== snapshot.result.tasks.length) context.addIssue({ code: 'custom', path: ['result', 'tasks'], message: 'workflow result repeats a task template' })
    for (const templateId of snapshot.plan.result.taskTemplateIds) {
      if (!resultIds.has(templateId)) context.addIssue({ code: 'custom', path: ['result', 'tasks'], message: `workflow result omits '${templateId}'` })
    }
  }
})

/** Parse one channel participant and its adapter-defined role. */
export const channelParticipantSchema = z.object({
  id: participantIdSchema,
  role: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<ChannelParticipant>

/** Parse a structured reason that currently blocks a Team objective. */
export const teamGoalBlockerSchema = z.object({
  code: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<TeamGoalBlocker>

/** Parse fields that seed a Team's first durable objective revision. */
export const teamGoalSeedSchema = z.object({
  objective: nonEmptyStringSchema,
  budgets: jsonObjectSchema,
}).strict() satisfies z.ZodType<TeamGoalSeed>

/** Parse one immutable revisioned Team objective. */
export const teamGoalSnapshotSchema = z.object({
  teamId: teamIdSchema,
  revision: positiveSafeIntegerSchema,
  objective: nonEmptyStringSchema,
  phase: teamGoalPhaseSchema,
  blocker: teamGoalBlockerSchema.optional(),
  budgets: jsonObjectSchema,
}).strict().superRefine((goal, context) => {
  if ((goal.phase === 'blocked') !== (goal.blocker !== undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['blocker'],
      message: 'Team goal blocker must be present exactly while phase is blocked',
    })
  }
}) as z.ZodType<TeamGoalSnapshot>

/** Parse one immutable child-runtime endpoint binding. */
export const teamChildRunBindingSchema = z.object({
  parentTeamId: teamIdSchema, parentTaskId: teamTaskIdSchema, childTeamId: teamIdSchema,
  delegationId: teamDelegationIdSchema, parentServiceId: participantIdSchema,
  coordinatorId: participantIdSchema, channelId: channelIdSchema,
}).strict().refine(binding => binding.parentTeamId !== binding.childTeamId && binding.parentServiceId !== binding.coordinatorId, {
  message: 'child runtime identities must name distinct Teams and endpoints',
})

const teamSnapshotFields = {
  id: teamIdSchema,
  goal: teamGoalSnapshotSchema,
  workspacePath: nonEmptyStringSchema.optional(),
  phase: teamPhaseSchema,
  stallReason: teamStallReasonSchema.optional(),
  closure: teamClosureSnapshotSchema.optional(),
  cancellation: teamCancellationSnapshotSchema.optional(),
  authorityGrant: teamAuthorityGrantSchema.optional(),
  createdBy: teamCreationActorSchema.optional(),
  cursor: nonNegativeSafeIntegerSchema,
  createdAt: nonNegativeSafeIntegerSchema,
  updatedAt: nonNegativeSafeIntegerSchema,
  archivedAt: nonNegativeSafeIntegerSchema.optional(),
}

/** Parse one Team read model. */
export const teamSnapshotSchema = z.union([
  z.object({
    ...teamSnapshotFields,
    depth: z.literal(0),
    maxTeamDepth: nonNegativeSafeIntegerSchema,
  }).strict(),
  z.object({
    ...teamSnapshotFields,
    parentTeamId: teamIdSchema,
    parentTaskId: teamTaskIdSchema,
    childRun: teamChildRunBindingSchema.optional(),
    childResultAdmission: z.lazy(() => teamChildResultAdmissionSchema).optional(),
    depth: positiveSafeIntegerSchema,
    maxTeamDepth: nonNegativeSafeIntegerSchema,
  }).strict().refine(team => team.depth <= team.maxTeamDepth, {
    message: 'nested Team depth must not exceed maxTeamDepth',
  }),
]).superRefine((team, context) => {
  if ('childRun' in team && team.childRun !== undefined
    && (team.childRun.childTeamId !== team.id || team.childRun.parentTeamId !== team.parentTeamId
      || team.childRun.parentTaskId !== team.parentTaskId)) {
    context.addIssue({ code: 'custom', path: ['childRun'], message: 'child runtime binding must retain its Team lineage' })
  }
  if (team.goal.teamId !== team.id) {
    context.addIssue({
      code: 'custom',
      path: ['goal', 'teamId'],
      message: 'Team goal must retain its owning Team id',
    })
  }
  if (team.closure !== undefined && team.closure.teamId !== team.id) {
    context.addIssue({
      code: 'custom',
      path: ['closure', 'teamId'],
      message: 'Team closure must retain its owning Team id',
    })
  }
  if (team.cancellation !== undefined && team.cancellation.teamId !== team.id) {
    context.addIssue({
      code: 'custom',
      path: ['cancellation', 'teamId'],
      message: 'Team cancellation must retain its owning Team id',
    })
  }
  if (team.closure?.kind === 'cancel' && team.cancellation === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['cancellation'],
      message: 'cancelled Team closure requires its durable cancellation request',
    })
  }
  if (team.cancellation !== undefined && team.closure !== undefined && team.closure.kind !== 'cancel') {
    context.addIssue({
      code: 'custom',
      path: ['closure'],
      message: 'Team cancellation cannot coexist with completion or failure closure',
    })
  }
}).superRefine((team, context) => {
  if ((team.phase === 'stalled') !== (team.stallReason !== undefined)) {
    context.addIssue({
      code: 'custom', path: ['stallReason'],
      message: 'Team stall reason must be present exactly while phase is stalled',
    })
  }
}) as z.ZodType<TeamSnapshot>

/** Parse a bounded Team-summary page request. */
export const teamListPageRequestSchema = z.object({
  afterCursor: observedCursorSchema,
  limit: positiveSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamListPageRequest>

/** Parse a bounded Team-summary page. */
export const teamListPageSchema = z.object({
  items: z.array(teamSnapshotSchema),
  nextCursor: nonNegativeSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<TeamListPage>

/** Parse one participant read model. */
export const participantSnapshotSchema = z.object({
  id: participantIdSchema,
  teamId: teamIdSchema,
  kind: participantKindSchema,
  displayName: nonEmptyStringSchema,
  role: nonEmptyStringSchema,
  capabilities: participantCapabilitiesSchema,
  phase: participantPhaseSchema,
  owner: teamParticipantOwnerSchema.optional(),
  provider: trimmedTextSchema.optional(),
  preset: trimmedTextSchema.optional(),
  model: trimmedTextSchema.optional(),
  authScheme: trimmedTextSchema.optional(),
  authorityGrant: teamAuthorityGrantSchema.optional(),
  stats: participantStatsSchema.optional(),
}).strict().superRefine(requireParticipantOwner) as unknown as z.ZodType<ParticipantSnapshot>

/** Parse a bounded Team participant-list page request. */
export const teamMemberListPageRequestSchema = z.object({
  teamId: teamIdSchema,
  afterCursor: observedCursorSchema,
  limit: positiveSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamMemberListPageRequest>

/** Parse a bounded Team participant-list page. */
export const teamMemberListPageSchema = z.object({
  items: z.array(participantSnapshotSchema),
  nextCursor: nonNegativeSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<TeamMemberListPage>

/** Parse one live activation read model. */
export const activationSnapshotSchema = z.object({
  id: activationIdSchema,
  teamId: teamIdSchema,
  participantId: participantIdSchema,
  status: activationStatusSchema,
}).strict() satisfies z.ZodType<ActivationSnapshot>

/** Parse the exact process identity retained by a provider-owned recovery plan. */
const activationRecoveryProcessSchema = z.object({
  hostId: trimmedTextSchema,
  pid: positiveSafeIntegerSchema,
  started: trimmedTextSchema,
  processGroupId: positiveSafeIntegerSchema.optional(),
}).strict()

/** Parse provider-specific facts that authorize one activation cold replacement. */
export const activationRecoverySnapshotSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sdk-local-cold-replace'),
    version: z.literal(1),
    runtimeProvider: trimmedTextSchema,
    supervisor: activationSupervisorDescriptorSchema.optional(),
    profile: trimmedTextSchema,
    agent: z.object({
      provider: trimmedTextSchema,
      model: trimmedTextSchema,
      maxTokens: positiveSafeIntegerSchema.optional(),
    }).strict(),
    process: activationRecoveryProcessSchema,
  }).strict(),
  z.object({
    kind: z.literal('acp-local-cold-replace'),
    version: z.literal(1),
    runtimeProvider: trimmedTextSchema,
    supervisor: activationSupervisorDescriptorSchema.optional(),
    profile: trimmedTextSchema,
    cwd: trimmedTextSchema,
    process: activationRecoveryProcessSchema,
  }).strict(),
]) satisfies z.ZodType<ActivationRecoverySnapshot>

/** Parse the trusted actor that proved an activation epoch quiescent. */
export const activationQuiescenceSourceSchema = z.union([
  z.literal('fenced'),
  z.literal('quiesced'),
])

/** Parse one durable activation-to-Session placement binding. */
export const activationBindingSnapshotSchema = z.object({
  activation: activationSnapshotSchema,
  sessionId: sessionIdSchema,
  provider: nonEmptyStringSchema,
  selection: z.object({ preset: nonEmptyStringSchema.optional(), provider: nonEmptyStringSchema.optional(),
    model: nonEmptyStringSchema.optional() }).strict().optional(),
  recovery: activationRecoverySnapshotSchema.optional(),
  fencedAt: nonNegativeSafeIntegerSchema.optional(),
  quiescedAt: nonNegativeSafeIntegerSchema.optional(),
  quiescenceSource: activationQuiescenceSourceSchema.optional(),
  quiescedWakeChannelIds: z.array(channelIdSchema).optional(),
}).strict().superRefine((binding, context) => {
  if (binding.recovery?.supervisor !== undefined
    && (binding.recovery.supervisor.generation !== binding.activation.id
      || binding.recovery.supervisor.hostId !== binding.recovery.process.hostId)) {
    context.addIssue({ code: 'custom', path: ['recovery', 'supervisor'], message: 'activation supervisor must match the activation generation and execution host' })
  }
  if (binding.recovery?.runtimeProvider !== undefined && binding.recovery.runtimeProvider !== binding.provider) {
    context.addIssue({
      code: 'custom',
      path: ['recovery', 'runtimeProvider'],
      message: 'activation recovery runtimeProvider must match binding provider',
    })
  }
  if (binding.fencedAt !== undefined
    && (binding.recovery === undefined || (binding.activation.status !== 'stopping' && binding.activation.status !== 'offline'))) {
    context.addIssue({ code: 'custom', path: ['fencedAt'], message: 'activation fence proof requires a recovery descriptor and a stopping or offline epoch' })
  }
  if (binding.fencedAt !== undefined && binding.quiescedAt !== undefined && binding.fencedAt > binding.quiescedAt) {
    context.addIssue({ code: 'custom', path: ['fencedAt'], message: 'activation fence proof cannot follow complete quiescence' })
  }
  if (binding.quiescedAt !== undefined && binding.activation.status !== 'offline') {
    context.addIssue({
      code: 'custom',
      path: ['quiescedAt'],
      message: 'activation quiescence proof requires offline status',
    })
  }
  if (binding.quiescedAt !== undefined && binding.quiescedWakeChannelIds === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['quiescedWakeChannelIds'],
      message: 'activation quiescence proof requires a complete wake-channel list',
    })
  }
  if (binding.quiescedAt !== undefined && binding.quiescenceSource === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['quiescenceSource'],
      message: 'activation quiescence proof requires its trusted source',
    })
  }
  if (binding.quiescenceSource !== undefined && binding.quiescedAt === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['quiescenceSource'],
      message: 'activation quiescence source requires a quiescence proof',
    })
  }
  if (binding.quiescedWakeChannelIds !== undefined && binding.quiescedAt === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['quiescedWakeChannelIds'],
      message: 'quiesced wake channels require a quiescence proof',
    })
  }
  if (binding.quiescedWakeChannelIds !== undefined
    && new Set(binding.quiescedWakeChannelIds).size !== binding.quiescedWakeChannelIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['quiescedWakeChannelIds'],
      message: 'quiesced wake channels must be distinct',
    })
  }
}) satisfies z.ZodType<ActivationBindingSnapshot>

/** Parse one stable system activation-proof source registration name. */
export const teamSystemActivationProofSourceNameSchema = trimmedNameSchema

/** Parse an exact controller-owned activation binding publication scope. */
const activationControllerBindScopeSchema = z.object({
  kind: z.literal('activation-controller-bind'),
  expectedCursor: nonNegativeSafeIntegerSchema,
  binding: activationBindingSnapshotSchema,
}).strict()

/** Parse an exact controller-owned activation residency-status scope. */
const activationControllerStatusScopeSchema = z.object({
  kind: z.literal('activation-controller-status'),
  teamId: teamIdSchema,
  activationId: activationIdSchema,
  participantId: participantIdSchema,
  sessionId: sessionIdSchema,
  provider: nonEmptyStringSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  status: activationStatusSchema,
}).strict()

/** Parse an exact controller-owned externally fenced activation scope. */
const activationControllerFenceScopeSchema = z.object({
  kind: z.literal('activation-controller-fence'),
  teamId: teamIdSchema,
  activationId: activationIdSchema,
  participantId: participantIdSchema,
  sessionId: sessionIdSchema,
  provider: nonEmptyStringSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
}).strict()

/** Parse an exact controller-owned locally quiesced activation scope. */
const activationControllerQuiesceScopeSchema = z.object({
  kind: z.literal('activation-controller-quiesce'),
  teamId: teamIdSchema,
  activationId: activationIdSchema,
  participantId: participantIdSchema,
  sessionId: sessionIdSchema,
  provider: nonEmptyStringSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
}).strict()

/** Parse an exact startup-recovery wake-cleanup activation scope. */
const activationRecoveryQuiesceScopeSchema = z.object({
  kind: z.literal('activation-recovery-quiesce'),
  teamId: teamIdSchema,
  activationId: activationIdSchema,
  participantId: participantIdSchema,
  sessionId: sessionIdSchema,
  provider: nonEmptyStringSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
}).strict()

/** Parse the closed activation lifecycle operation a system proof may select. */
export const teamSystemActivationScopeSchema = z.discriminatedUnion('kind', [
  activationControllerBindScopeSchema,
  activationControllerStatusScopeSchema,
  activationControllerFenceScopeSchema,
  activationControllerQuiesceScopeSchema,
  activationRecoveryQuiesceScopeSchema,
]) satisfies z.ZodType<TeamSystemActivationScope>

/** Parse one detached source attribution resolved from a runtime-only activation proof. */
export const teamSystemActivationProofResolutionSchema = z.object({
  sourceName: teamSystemActivationProofSourceNameSchema,
  scope: teamSystemActivationScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemActivationProofResolution>

/** Parse the immutable activation binding selected for a soft participant interrupt. */
export const participantInterruptTargetSchema = z.object({
  teamId: teamIdSchema,
  participantId: participantIdSchema,
  activationId: activationIdSchema,
  sessionId: sessionIdSchema,
  provider: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<ParticipantInterruptTarget>

/** Parse a durable soft participant interrupt and its optional acknowledgement. */
export const participantInterruptSnapshotSchema = z.object({
  id: teamInterruptIdSchema,
  actorId: participantIdSchema,
  target: participantInterruptTargetSchema,
  requestedAt: nonNegativeSafeIntegerSchema,
  acknowledgedAt: nonNegativeSafeIntegerSchema.optional(),
}).strict().superRefine((interrupt, context) => {
  if (interrupt.acknowledgedAt !== undefined && interrupt.acknowledgedAt < interrupt.requestedAt) {
    context.addIssue({
      code: 'custom', path: ['acknowledgedAt'],
      message: 'participant interrupt acknowledgement must not precede its request',
    })
  }
}) as z.ZodType<ParticipantInterruptSnapshot>

/** Parse the exact activation binding identity that authorized one task-creation command. */
export const teamTaskCreatorSchema = z.object({
  teamId: teamIdSchema,
  participantId: participantIdSchema,
  activationId: activationIdSchema,
  sessionId: sessionIdSchema,
  provider: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<TeamTaskCreator>

/** Parse one authenticated human participant that created a Team task. */
export const teamHumanTaskCreatorSchema = z.object({
  teamId: teamIdSchema,
  participantId: participantIdSchema,
}).strict() satisfies z.ZodType<TeamHumanTaskCreator>

/** Parse one activation or authenticated-human source for a Team task creation. */
export const teamTaskCommandCreatorSchema = z.union([
  teamTaskCreatorSchema,
  teamHumanTaskCreatorSchema,
]) satisfies z.ZodType<TeamTaskCommandCreator>

/** Parse one activation- or human-authorized retry identity for a Team task creation. */
export const teamTaskCreateCommandSchema = z.object({
  creator: teamTaskCommandCreatorSchema,
  idempotencyKey: teamTaskCreateIdempotencyKeySchema,
}).strict() satisfies z.ZodType<TeamTaskCreateCommand>

/** Parse JSON-only retry identity for one Team task creation. */
export const teamTaskCreateCommandInputSchema = z.object({
  idempotencyKey: teamTaskCreateIdempotencyKeySchema,
}).strict() satisfies z.ZodType<TeamTaskCreateCommandInput>

/** Parse the current lease of one assigned or running Team task. */
export const taskLeaseSnapshotSchema = z.object({
  attemptId: taskAttemptIdSchema,
  assignedRevision: positiveSafeIntegerSchema,
  ordinal: positiveSafeIntegerSchema,
  participantId: participantIdSchema,
  activationId: activationIdSchema.optional(),
  wakeChannelId: channelIdSchema.optional(),
  assignedAt: nonNegativeSafeIntegerSchema,
  startedAt: nonNegativeSafeIntegerSchema.optional(),
  durationMs: positiveSafeIntegerSchema,
  renewedAt: nonNegativeSafeIntegerSchema,
  expiresAt: nonNegativeSafeIntegerSchema,
}).strict().superRefine((lease, context) => {
  if (lease.renewedAt < lease.assignedAt) {
    context.addIssue({
      code: 'custom', path: ['renewedAt'],
      message: 'task lease renewal must not precede assignment',
    })
  }
  if (lease.startedAt !== undefined && lease.startedAt < lease.assignedAt) {
    context.addIssue({
      code: 'custom', path: ['startedAt'],
      message: 'task attempt start must not precede assignment',
    })
  }
  if (lease.expiresAt !== lease.renewedAt + lease.durationMs) {
    context.addIssue({
      code: 'custom', path: ['expiresAt'],
      message: 'task lease expiry must equal its renewal time plus duration',
    })
  }
  if (lease.startedAt !== undefined && lease.startedAt > lease.expiresAt) {
    context.addIssue({
      code: 'custom', path: ['startedAt'],
      message: 'task attempt start must not follow lease expiry',
    })
  }
}) as z.ZodType<TaskLeaseSnapshot>

/** Parse one settled Team task attempt retained in durable task history. */
export const taskAttemptSnapshotSchema = z.object({
  id: taskAttemptIdSchema,
  teamId: teamIdSchema,
  taskId: teamTaskIdSchema,
  ordinal: positiveSafeIntegerSchema,
  participantId: participantIdSchema,
  activationId: activationIdSchema.optional(),
  wakeChannelId: channelIdSchema.optional(),
  assignedAt: nonNegativeSafeIntegerSchema,
  startedAt: nonNegativeSafeIntegerSchema.optional(),
  leaseExpiresAt: nonNegativeSafeIntegerSchema,
  settledAt: nonNegativeSafeIntegerSchema,
  outcome: taskAttemptOutcomeSchema,
}).strict().superRefine((attempt, context) => {
  if (attempt.leaseExpiresAt <= attempt.assignedAt) {
    context.addIssue({
      code: 'custom', path: ['leaseExpiresAt'],
      message: 'settled task attempt expiry must follow assignment',
    })
  }
  if (attempt.startedAt !== undefined && attempt.startedAt < attempt.assignedAt) {
    context.addIssue({
      code: 'custom', path: ['startedAt'],
      message: 'settled task attempt start must not precede assignment',
    })
  }
  if (attempt.startedAt !== undefined && attempt.startedAt > attempt.leaseExpiresAt) {
    context.addIssue({
      code: 'custom', path: ['startedAt'],
      message: 'settled task attempt start must not follow lease expiry',
    })
  }
  if (attempt.settledAt < attempt.assignedAt) {
    context.addIssue({
      code: 'custom', path: ['settledAt'],
      message: 'settled task attempt outcome must not precede assignment',
    })
  }
  if (attempt.startedAt !== undefined && attempt.settledAt < attempt.startedAt) {
    context.addIssue({
      code: 'custom', path: ['settledAt'],
      message: 'settled task attempt outcome must not precede execution start',
    })
  }
  if (attempt.outcome.kind === 'lease-expired' && attempt.settledAt < attempt.leaseExpiresAt) {
    context.addIssue({
      code: 'custom', path: ['settledAt'],
      message: 'lease-expired task attempt must settle at or after lease expiry',
    })
  }
  if (attempt.outcome.kind !== 'lease-expired' && attempt.outcome.kind !== 'cancelled' && attempt.settledAt >= attempt.leaseExpiresAt) {
    context.addIssue({
      code: 'custom', path: ['settledAt'],
      message: 'non-expiry task attempt must settle before lease expiry',
    })
  }
}) as z.ZodType<TaskAttemptSnapshot>

/** Parse one frozen task review route. */
export const teamTaskReviewPolicySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('participant'), reviewerId: participantIdSchema }).strict(),
]) satisfies z.ZodType<TeamTaskReviewPolicy>

/** Parse one durable review decision for a completed task attempt. */
export const teamTaskReviewDecisionSchema = z.object({
  attemptId: taskAttemptIdSchema,
  reviewerId: participantIdSchema,
  nextPhase: z.enum(['completed', 'pending'] as const),
  reason: nonEmptyStringSchema,
  decidedAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamTaskReviewDecision>

/** Parse the durable exact-work selection of a single-task cancellation. */
export const teamTaskCancellationSnapshotSchema = z.object({
  requestedRevision: positiveSafeIntegerSchema,
  requestedBy: participantIdSchema,
  reason: nonEmptyStringSchema.optional(),
  requestedAt: nonNegativeSafeIntegerSchema,
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('delegation'), delegationId: teamDelegationIdSchema, childTeamId: teamIdSchema.optional() }).strict(),
    z.object({ kind: z.literal('pending') }).strict(),
    z.object({ kind: z.literal('review'), attemptId: taskAttemptIdSchema, reviewerId: participantIdSchema }).strict(),
    z.object({ kind: z.literal('attempt'), attemptId: taskAttemptIdSchema, participantId: participantIdSchema, activationId: activationIdSchema }).strict(),
  ]),
  expiredAt: nonNegativeSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<TeamTaskCancellationSnapshot>

/** Parse immutable placement restrictions; an explicitly empty set permits no candidate. */
export const teamTaskPlacementSchema = placementRestrictionsSchema satisfies z.ZodType<TeamTaskPlacement>

/** Parse the immutable task executor without inferring another product mode. */
export const teamTaskExecutionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('participant') }).strict(),
  z.object({ kind: z.literal('child-team'), templateId: trimmedNameSchema, templateVersion: positiveSafeIntegerSchema,
    authorityGrant: teamAuthorityGrantSchema, budget: teamResourceBudgetSchema }).strict(),
]) satisfies z.ZodType<TeamTaskExecution>

/** Parse parent-owned durable child reservation and saga progress. */
export const teamTaskDelegationSnapshotSchema = z.object({
  id: teamDelegationIdSchema,
  phase: z.enum(['requested', 'creating', 'active', 'settling', 'completed', 'failed', 'cancelled', 'stalled']),
  requestedAt: nonNegativeSafeIntegerSchema, updatedAt: nonNegativeSafeIntegerSchema,
  startedAt: nonNegativeSafeIntegerSchema.optional(), childTeamId: teamIdSchema.optional(),
  creation: z.lazy(() => teamChildCreateInputSchema).optional(), childCursor: nonNegativeSafeIntegerSchema.optional(),
  failure: teamStallReasonSchema.optional(),
  result: z.lazy(() => teamDelegationResultAdmissionSchema).optional(),
}).strict() satisfies z.ZodType<TeamTaskDelegationSnapshot>

/** Parse one Team task read model and its current lease or bounded settled-attempt history. */
export const teamTaskSnapshotSchema = z.object({
  id: teamTaskIdSchema,
  teamId: teamIdSchema,
  revision: positiveSafeIntegerSchema,
  execution: teamTaskExecutionSchema,
  delegation: teamTaskDelegationSnapshotSchema.optional(),
  parentTaskId: teamTaskIdSchema.optional(),
  workflowPlanId: teamWorkflowPlanIdSchema.optional(),
  workflowTemplateId: teamWorkflowTaskTemplateIdSchema.optional(),
  createCommand: teamTaskCreateCommandSchema,
  proposedOwnerId: participantIdSchema.optional(),
  placement: teamTaskPlacementSchema.optional(),
  subject: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
  integration: teamTaskIntegrationSpecSchema.optional(),
  phase: teamTaskPhaseSchema,
  blockedBy: z.array(teamTaskIdSchema),
  requiredCapabilities: z.array(nonEmptyStringSchema),
  priority: nonNegativeSafeIntegerSchema,
  readScopes: z.array(nonEmptyStringSchema),
  writeScopes: z.array(nonEmptyStringSchema),
  workspaceMode: teamTaskWorkspaceModeSchema,
  budget: jsonObjectSchema,
  reviewPolicy: teamTaskReviewPolicySchema,
  reviewHistory: z.array(teamTaskReviewDecisionSchema),
  maxAttempts: positiveSafeIntegerSchema,
  attemptCount: nonNegativeSafeIntegerSchema,
  attemptHistory: z.array(taskAttemptSnapshotSchema),
  lease: taskLeaseSnapshotSchema.optional(),
  cancellation: teamTaskCancellationSnapshotSchema.optional(),
  blockedByOutcome: teamTaskDependencyOutcomeSchema.optional(),
}).strict().superRefine((task, context) => {
  if (task.blockedByOutcome !== undefined && (task.phase !== 'cancelled'
    || task.attemptCount !== 0 || task.lease !== undefined || task.cancellation !== undefined
    || !task.blockedBy.includes(task.blockedByOutcome.taskId))) {
    context.addIssue({ code: 'custom', path: ['blockedByOutcome'], message: 'dependency cancellation requires an unstarted task and direct prerequisite' })
  }
  const cancellation = task.cancellation
  for (const [index, attempt] of task.attemptHistory.entries()) {
    if (attempt.outcome.kind === 'cancelled' && attempt.settledAt >= attempt.leaseExpiresAt
      && (cancellation?.target.kind !== 'attempt' || cancellation.target.attemptId !== attempt.id)) {
      context.addIssue({ code: 'custom', path: ['attemptHistory', index, 'settledAt'], message: 'cancellation after lease expiry requires the matching durable stop intent' })
    }
  }
  if (cancellation !== undefined) {
    const target = cancellation.target
    const selectedAttempt = target.kind === 'attempt'
      ? task.lease?.attemptId === target.attemptId ? task.lease : task.attemptHistory.find(attempt => attempt.id === target.attemptId)
      : undefined
    const invalid = cancellation.requestedRevision >= task.revision
      || (task.phase !== 'pending' && task.phase !== 'assigned' && task.phase !== 'running' && task.phase !== 'review' && task.phase !== 'cancelled')
      || (target.kind === 'delegation' && (task.execution.kind !== 'child-team' || task.delegation?.id !== target.delegationId || task.delegation.childTeamId !== target.childTeamId))
      || (target.kind === 'pending' && task.phase !== 'pending' && task.phase !== 'cancelled')
      || (target.kind === 'review' && (task.reviewPolicy.kind !== 'participant'
        || task.reviewPolicy.reviewerId !== target.reviewerId || task.attemptHistory.at(-1)?.id !== target.attemptId))
      || (target.kind === 'attempt' && (selectedAttempt === undefined
        || selectedAttempt.participantId !== target.participantId || selectedAttempt.activationId !== target.activationId))
      || (cancellation.expiredAt !== undefined && (target.kind !== 'attempt'
        || cancellation.expiredAt < cancellation.requestedAt
        || (selectedAttempt !== undefined && cancellation.expiredAt < ('expiresAt' in selectedAttempt ? selectedAttempt.expiresAt : selectedAttempt.leaseExpiresAt))))
    if (invalid) context.addIssue({ code: 'custom', path: ['cancellation'], message: 'task cancellation must retain its exact selected phase, attempt, and activation' })
  }
  if (task.createCommand.creator.teamId !== task.teamId) {
    context.addIssue({
      code: 'custom', path: ['createCommand', 'creator', 'teamId'],
      message: 'task creation command creator must retain the owning Team id',
    })
  }
  if ((task.workflowPlanId === undefined) !== (task.workflowTemplateId === undefined)) {
    context.addIssue({
      code: 'custom', path: ['workflowTemplateId'],
      message: 'workflowPlanId and workflowTemplateId must be provided together',
    })
  }
  if (task.integration !== undefined) {
    if (task.integration.sourceTaskId === task.id) {
      context.addIssue({ code: 'custom', path: ['integration', 'sourceTaskId'], message: 'integration task cannot integrate itself' })
    }
    if (task.integration.mode === 'integrate' && task.integration.expectedTarget === undefined) {
      context.addIssue({ code: 'custom', path: ['integration', 'expectedTarget'], message: 'integrating task requires an expected target revision' })
    }
    if (task.workflowPlanId !== undefined) {
      context.addIssue({ code: 'custom', path: ['integration'], message: 'workflow tasks cannot be integration tasks' })
    }
  }
  if (task.execution.kind === 'child-team') {
    const delegation = task.delegation
    const reserved = delegation?.startedAt !== undefined
    const terminal = delegation?.phase === 'completed' || delegation?.phase === 'failed' || delegation?.phase === 'cancelled'
    const phaseMatches = delegation !== undefined && (task.phase === 'deleted' ? terminal
      : terminal ? task.phase === delegation.phase : reserved ? task.phase === 'running' : task.phase === 'pending')
    if (delegation === undefined || !phaseMatches || task.lease !== undefined || task.attemptHistory.length !== 0
      || task.reviewHistory.length !== 0 || task.reviewPolicy.kind !== 'none' || task.maxAttempts !== 1
      || task.attemptCount !== (reserved ? 1 : 0) || task.placement !== undefined || task.integration !== undefined
      || task.workspaceMode !== 'shared' || task.workflowPlanId !== undefined
      || (reserved && (delegation.childTeamId === undefined || delegation.creation === undefined))
      || delegation.updatedAt < delegation.requestedAt
      || (delegation.creation !== undefined && (delegation.creation.parentTeamId !== task.teamId
        || delegation.creation.parentTaskId !== task.id || delegation.creation.delegationId !== delegation.id))) {
      context.addIssue({ code: 'custom', path: ['delegation'], message: 'child-Team tasks require one exact shared delegation and no Participant lease' })
    }
    const result = delegation?.result
    if (result !== undefined && (delegation === undefined || delegation.phase === 'requested' || delegation.phase === 'creating' || delegation.phase === 'active'
      || result.binding.parentTeamId !== task.teamId || result.binding.parentTaskId !== task.id
      || result.binding.delegationId !== delegation.id || result.binding.childTeamId !== delegation.childTeamId
      || result.parentTaskRevision > task.revision
      || result.admittedAt > delegation.updatedAt || result.admittedAt < delegation.requestedAt)) {
      context.addIssue({ code: 'custom', path: ['delegation', 'result'],
        message: 'child result must retain its exact parent task, child reservation, and admission bounds' })
    }
    return
  }
  if (task.delegation !== undefined) context.addIssue({ code: 'custom', path: ['delegation'], message: 'Participant tasks cannot retain child delegation' })
  const expectedAttemptCount = task.attemptHistory.length + (task.lease === undefined ? 0 : 1)
  if (task.attemptCount !== expectedAttemptCount) {
    context.addIssue({
      code: 'custom', path: ['attemptCount'],
      message: 'task attemptCount must equal settled history plus the current lease',
    })
  }
  if (task.attemptCount > task.maxAttempts) {
    context.addIssue({
      code: 'custom', path: ['attemptCount'],
      message: 'task attemptCount must not exceed maxAttempts',
    })
  }
  const active = task.phase === 'assigned' || task.phase === 'running'
  if (active !== (task.lease !== undefined)) {
    context.addIssue({
      code: 'custom', path: ['lease'],
      message: 'only assigned and running tasks carry a current lease',
    })
  }
  if (task.phase === 'assigned' && task.lease?.startedAt !== undefined) {
    context.addIssue({
      code: 'custom', path: ['lease', 'startedAt'],
      message: 'assigned task lease must not retain an execution start',
    })
  }
  if (task.phase === 'running' && task.lease?.startedAt === undefined) {
    context.addIssue({
      code: 'custom', path: ['lease', 'startedAt'],
      message: 'running task lease must retain an execution start',
    })
  }
  if (task.lease !== undefined && task.lease.assignedRevision > task.revision) {
    context.addIssue({
      code: 'custom', path: ['lease', 'assignedRevision'],
      message: 'task lease assignment revision must not follow the current task revision',
    })
  }
  if (task.phase === 'running' && task.lease !== undefined && task.lease.assignedRevision >= task.revision) {
    context.addIssue({
      code: 'custom', path: ['lease', 'assignedRevision'],
      message: 'running task lease assignment revision must precede the current task revision',
    })
  }
  const attemptIds = new Set<TaskAttemptId>()
  const attemptsById = new Map<TaskAttemptId, TaskAttemptSnapshot>()
  for (const [index, attempt] of task.attemptHistory.entries()) {
    if (attempt.teamId !== task.teamId) {
      context.addIssue({
        code: 'custom', path: ['attemptHistory', index, 'teamId'],
        message: 'task attempt history must retain its owning Team id',
      })
    }
    if (attempt.taskId !== task.id) {
      context.addIssue({
        code: 'custom', path: ['attemptHistory', index, 'taskId'],
        message: 'task attempt history must retain its owning task id',
      })
    }
    if (attempt.ordinal !== index + 1) {
      context.addIssue({
        code: 'custom', path: ['attemptHistory', index, 'ordinal'],
        message: 'task attempt history ordinals must be contiguous from one',
      })
    }
    if (attemptIds.has(attempt.id)) {
      context.addIssue({
        code: 'custom', path: ['attemptHistory', index, 'id'],
        message: 'task attempt history must not reuse an attempt id',
      })
    }
    attemptIds.add(attempt.id)
    attemptsById.set(attempt.id, attempt)
  }
  const reviewedAttemptIds = new Set<TaskAttemptId>()
  let priorReviewedOrdinal = 0
  let priorDecisionAt = 0
  for (const [index, decision] of task.reviewHistory.entries()) {
    if (task.reviewPolicy.kind === 'none') {
      context.addIssue({
        code: 'custom', path: ['reviewHistory', index],
        message: 'tasks without review must not retain review decisions',
      })
      continue
    }
    if (decision.reviewerId !== task.reviewPolicy.reviewerId) {
      context.addIssue({
        code: 'custom', path: ['reviewHistory', index, 'reviewerId'],
        message: 'review decision reviewer must match the task review policy',
      })
    }
    const attempt = attemptsById.get(decision.attemptId)
    if (attempt === undefined || attempt.outcome.kind !== 'completed') {
      context.addIssue({
        code: 'custom', path: ['reviewHistory', index, 'attemptId'],
        message: 'review decision must resolve one completed task attempt',
      })
      continue
    }
    if (reviewedAttemptIds.has(decision.attemptId)) {
      context.addIssue({
        code: 'custom', path: ['reviewHistory', index, 'attemptId'],
        message: 'task review history must not resolve an attempt twice',
      })
    }
    if (attempt.ordinal <= priorReviewedOrdinal) {
      context.addIssue({
        code: 'custom', path: ['reviewHistory', index, 'attemptId'],
        message: 'task review decisions must follow completed-attempt order',
      })
    }
    if (decision.decidedAt < attempt.settledAt) {
      context.addIssue({
        code: 'custom', path: ['reviewHistory', index, 'decidedAt'],
        message: 'task review decision must not precede its completed attempt',
      })
    }
    if (decision.decidedAt < priorDecisionAt) {
      context.addIssue({
        code: 'custom', path: ['reviewHistory', index, 'decidedAt'],
        message: 'task review decisions must be chronological',
      })
    }
    reviewedAttemptIds.add(decision.attemptId)
    priorReviewedOrdinal = attempt.ordinal
    priorDecisionAt = decision.decidedAt
  }
  const completedAttempts = task.attemptHistory.filter(attempt => attempt.outcome.kind === 'completed')
  const unresolvedCompletedAttempts = completedAttempts.filter(attempt => !reviewedAttemptIds.has(attempt.id))
  if (task.phase === 'review') {
    if (task.reviewPolicy.kind === 'none') {
      context.addIssue({
        code: 'custom', path: ['reviewPolicy'],
        message: 'tasks without review must not enter review',
      })
    }
    const latestAttempt = task.attemptHistory.at(-1)
    if (
      latestAttempt?.outcome.kind !== 'completed'
      || unresolvedCompletedAttempts.length !== 1
      || unresolvedCompletedAttempts[0]?.id !== latestAttempt.id
    ) {
      context.addIssue({
        code: 'custom', path: ['reviewHistory'],
        message: 'review tasks must await one unresolved completed attempt',
      })
    }
  } else if (task.phase !== 'cancelled' && task.reviewPolicy.kind === 'participant' && unresolvedCompletedAttempts.length > 0) {
    context.addIssue({
      code: 'custom', path: ['reviewHistory'],
      message: 'participant-reviewed tasks must resolve completed attempts before leaving review',
    })
  }
  if (task.phase === 'completed' && task.reviewPolicy.kind === 'participant') {
    const latestDecision = task.reviewHistory.at(-1)
    if (latestDecision?.nextPhase !== 'completed') {
      context.addIssue({
        code: 'custom', path: ['reviewHistory'],
        message: 'participant-reviewed completed tasks require a completed review decision',
      })
    }
  }
  if (task.lease !== undefined) {
    if (task.lease.ordinal !== task.attemptCount) {
      context.addIssue({
        code: 'custom', path: ['lease', 'ordinal'],
        message: 'current task lease ordinal must equal attemptCount',
      })
    }
    if (attemptIds.has(task.lease.attemptId)) {
      context.addIssue({
        code: 'custom', path: ['lease', 'attemptId'],
        message: 'current task lease must not reuse a settled attempt id',
      })
    }
  }
}) as z.ZodType<TeamTaskSnapshot>

/** Parse one complete detached Team state projection. */
export const teamStateSnapshotSchema = z.object({
  team: teamSnapshotSchema,
  goal: teamGoalSnapshotSchema,
  rules: jsonObjectSchema,
  budgets: jsonObjectSchema,
  participants: z.array(participantSnapshotSchema),
  activations: z.array(activationBindingSnapshotSchema),
  tasks: z.array(teamTaskSnapshotSchema),
  workspaceAllocations: z.array(teamWorkspaceAllocationSnapshotSchema),
  channelIds: z.array(channelIdSchema),
  humanActions: z.array(teamHumanActionSnapshotSchema).optional(),
  usage: teamUsageSnapshotSchema.optional(),
  workflowPlans: z.array(teamWorkflowPlanSnapshotSchema).optional(),
}).strict().superRefine((state, context) => {
  if (JSON.stringify(state.goal) !== JSON.stringify(state.team.goal)) {
    context.addIssue({
      code: 'custom',
      path: ['goal'],
      message: 'Team state goal must match its Team snapshot goal',
    })
  }
  const plans = state.workflowPlans ?? []
  if (new Set(plans.map(plan => plan.id)).size !== plans.length) {
    context.addIssue({ code: 'custom', path: ['workflowPlans'], message: 'Team state repeats a workflow plan identity' })
  }
  for (const [index, plan] of plans.entries()) {
    if (plan.teamId !== state.team.id) {
      context.addIssue({ code: 'custom', path: ['workflowPlans', index, 'teamId'], message: 'workflow plan must retain its owning Team id' })
    }
  }
  for (const [index, task] of state.tasks.entries()) {
    if (task.workflowPlanId === undefined || task.workflowTemplateId === undefined) continue
    const plan = plans.find(candidate => candidate.id === task.workflowPlanId)
    if (plan === undefined) {
      context.addIssue({ code: 'custom', path: ['tasks', index, 'workflowPlanId'], message: 'workflow task references an unknown plan' })
      continue
    }
    if (!plan.plan.tasks.some(template => template.id === task.workflowTemplateId)) {
      context.addIssue({ code: 'custom', path: ['tasks', index, 'workflowTemplateId'], message: 'workflow task references an unknown template' })
    }
  }
  const allocations = new Set<TeamWorkspaceAllocationId>()
  const attempts = new Set<string>()
  for (const [index, allocation] of state.workspaceAllocations.entries()) {
    if (allocation.teamId !== state.team.id) {
      context.addIssue({ code: 'custom', path: ['workspaceAllocations', index, 'teamId'], message: 'workspace allocation must retain its owning Team id' })
    }
    if (allocations.has(allocation.id)) {
      context.addIssue({ code: 'custom', path: ['workspaceAllocations', index, 'id'], message: 'Team state repeats a workspace allocation identity' })
    }
    allocations.add(allocation.id)
    const attemptKey = JSON.stringify([allocation.taskId, allocation.attemptId])
    if (attempts.has(attemptKey)) {
      context.addIssue({ code: 'custom', path: ['workspaceAllocations', index, 'attemptId'], message: 'Team state repeats a task-attempt workspace allocation' })
    }
    attempts.add(attemptKey)
    const task = state.tasks.find(candidate => candidate.id === allocation.taskId)
    const attempt = task?.lease?.attemptId === allocation.attemptId
      ? task.lease
      : task?.attemptHistory.find(candidate => candidate.id === allocation.attemptId)
    if (task === undefined || task.workspaceMode !== allocation.mode || attempt === undefined
      || attempt.participantId !== allocation.participantId || attempt.activationId !== allocation.activationId) {
      context.addIssue({ code: 'custom', path: ['workspaceAllocations', index], message: 'workspace allocation must match its task attempt and workspace mode' })
    }
    const binding = state.activations.find(candidate => candidate.activation.id === allocation.activationId)
    if (binding === undefined || binding.activation.participantId !== allocation.participantId
      || binding.sessionId !== allocation.sessionId) {
      context.addIssue({ code: 'custom', path: ['workspaceAllocations', index, 'activationId'], message: 'workspace allocation must match its activation Session binding' })
    }
  }
}) as z.ZodType<TeamStateSnapshot>

/** Parse read-only Team quiescence diagnostics. */
export const teamQuiescenceSnapshotSchema = z.object({
  teamId: teamIdSchema,
  quiescent: z.boolean(),
  reasons: z.array(nonEmptyStringSchema),
  activeTaskIds: z.array(teamTaskIdSchema),
  activeActivationIds: z.array(activationIdSchema),
  activeWorkspaceAllocationIds: z.array(teamWorkspaceAllocationIdSchema),
  openChannelIds: z.array(channelIdSchema),
}).strict() satisfies z.ZodType<TeamQuiescenceSnapshot>

const teamLatencyBucketSchema = z.object({
  upperBoundMs: z.union([nonNegativeSafeIntegerSchema, z.null()]),
  count: nonNegativeSafeIntegerSchema,
}).strict()

/** Parse one fixed-boundary cumulative latency histogram. */
export const teamLatencyHistogramSchema = z.object({
  count: nonNegativeSafeIntegerSchema,
  sumMs: nonNegativeSafeIntegerSchema,
  buckets: z.array(teamLatencyBucketSchema).length(TEAM_LATENCY_BUCKETS_MS.length + 1),
}).strict().superRefine((histogram, context) => {
  const expectedBounds: readonly (number | null)[] = [...TEAM_LATENCY_BUCKETS_MS, null]
  let previous = 0
  for (const [index, bucket] of histogram.buckets.entries()) {
    if (bucket.upperBoundMs !== expectedBounds[index]) {
      context.addIssue({ code: 'custom', path: ['buckets', index, 'upperBoundMs'], message: 'latency bucket boundary is not the Team protocol boundary' })
    }
    if (bucket.count < previous) {
      context.addIssue({ code: 'custom', path: ['buckets', index, 'count'], message: 'latency bucket counts must be cumulative' })
    }
    previous = bucket.count
  }
  if (histogram.buckets.at(-1)?.count !== histogram.count) {
    context.addIssue({ code: 'custom', path: ['buckets'], message: 'positive-infinity latency bucket must equal histogram count' })
  }
})

/** Parse monotonic in-process Team operational counters. */
export const teamMetricsSnapshotSchema = z.object({
  activeAdmissions: nonNegativeSafeIntegerSchema,
  pendingDeliveries: nonNegativeSafeIntegerSchema,
  activeActivations: nonNegativeSafeIntegerSchema,
  activeTasks: nonNegativeSafeIntegerSchema,
  stalledTeams: nonNegativeSafeIntegerSchema,
  replayLag: nonNegativeSafeIntegerSchema,
  lastTaskLatencyMs: nonNegativeSafeIntegerSchema,
  lastReceiptLatencyMs: nonNegativeSafeIntegerSchema,
  taskLatency: teamLatencyHistogramSchema,
  receiptLatency: teamLatencyHistogramSchema,
  workspaceConflicts: nonNegativeSafeIntegerSchema,
  teamEvents: nonNegativeSafeIntegerSchema,
  channelEvents: nonNegativeSafeIntegerSchema,
  policyDenials: nonNegativeSafeIntegerSchema,
  adapterFailures: nonNegativeSafeIntegerSchema,
  deliveryClaims: nonNegativeSafeIntegerSchema,
  taskAssignments: nonNegativeSafeIntegerSchema,
  taskRetries: nonNegativeSafeIntegerSchema,
  teamCompactions: nonNegativeSafeIntegerSchema,
  channelCompactions: nonNegativeSafeIntegerSchema,
  checkpointFailures: nonNegativeSafeIntegerSchema,
  auditProjectionRepairs: nonNegativeSafeIntegerSchema,
  auditProjectionFailures: nonNegativeSafeIntegerSchema,
  updatedAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamMetricsSnapshot>

/** Parse one immutable channel manifest. */
export const channelManifestSchema = z.object({
  id: channelIdSchema,
  teamId: teamIdSchema,
  adapter: teamAdapterRefSchema,
  viewPolicy: teamViewPolicyRefSchema.optional(),
  workflowPlanId: teamWorkflowPlanIdSchema.optional(),
  participants: z.array(channelParticipantSchema),
  limits: jsonObjectSchema,
}).strict() satisfies z.ZodType<ChannelManifest>

/** Parse one channel-scoped acknowledgement retry identity. */
export const channelInvitationIdempotencyKeySchema = nonEmptyStringSchema.transform(value => value as ChannelInvitationIdempotencyKey)
/** Parse one exact channel-manifest SHA-256 fingerprint. */
export const channelManifestFingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
  .transform(value => value as ChannelManifestFingerprint)

/** Parse one frozen invitation and its durable acknowledgement result. */
export const channelInvitationSnapshotSchema = z.object({
  participantId: participantIdSchema,
  role: nonEmptyStringSchema,
  visibility: z.literal('channel'),
  required: z.boolean(),
  deadline: nonNegativeSafeIntegerSchema,
  endpoint: z.union([
    z.object({ kind: z.literal('activation'), activationId: activationIdSchema.optional(), sessionId: sessionIdSchema.optional() }).strict(),
    z.object({ kind: z.literal('human') }).strict(),
    z.object({ kind: z.literal('service'), name: nonEmptyStringSchema }).strict(),
  ]),
  revision: positiveSafeIntegerSchema,
  manifestFingerprint: channelManifestFingerprintSchema,
  status: z.enum(['pending', 'acknowledged', 'expired', 'cancelled'] as const),
  reason: teamStallReasonSchema.optional(),
  acknowledgementKey: channelInvitationIdempotencyKeySchema.optional(),
  settledAt: nonNegativeSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<ChannelInvitationSnapshot>

/** Parse endpoint-supplied consent without caller-selected participant identity. */
export const channelInvitationAcknowledgeInputSchema = z.object({
  channelId: channelIdSchema,
  revision: positiveSafeIntegerSchema,
  manifestFingerprint: channelManifestFingerprintSchema,
  idempotencyKey: channelInvitationIdempotencyKeySchema,
}).strict() satisfies z.ZodType<ChannelInvitationAcknowledgeInput>

/** Parse one durable invitation transition. */
export const channelInvitationRecordSchema = z.object({
  type: z.enum(['channel/invitation', 'channel/acknowledged', 'channel/invitation-ended'] as const),
  sequence: nonNegativeSafeIntegerSchema,
  createdAt: nonNegativeSafeIntegerSchema,
  invitation: channelInvitationSnapshotSchema,
}).strict() satisfies z.ZodType<ChannelInvitationRecord>

/** Parse one detached channel state projection. */
export const channelSnapshotSchema = z.object({
  manifest: channelManifestSchema,
  phase: channelPhaseSchema,
  cursor: nonNegativeSafeIntegerSchema,
  firstCursor: nonNegativeSafeIntegerSchema.optional(),
  replayWatermark: nonNegativeSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<ChannelSnapshot>

/** Parse the exact retained Envelope selected by an authenticated Team human. */
export const channelHumanEnvelopeGetInputSchema = z.object({ teamId: teamIdSchema,
  channelId: channelIdSchema, envelopeId: envelopeIdSchema, envelopeSequence: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<ChannelHumanEnvelopeGetInput>

/** Parse an actor-free channel page selection before resolving provider defaults. */
export const teamChannelListInputSchema = z.object({ teamId: teamIdSchema,
  afterCursor: observedCursorSchema.optional(), limit: positiveSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<TeamChannelListInput>
/** Parse a bounded channel page with stable insertion-index continuation. */
export const teamChannelListPageSchema = z.object({ items: z.array(channelSnapshotSchema),
  nextCursor: nonNegativeSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<TeamChannelListPage>

/** Parse only the authenticated human invitation and complete channel manifest. */
export const channelHumanInvitationSnapshotSchema = z.object({
  channel: channelSnapshotSchema,
  invitation: channelInvitationSnapshotSchema,
}).strict()

/** Parse the complete durable invitation projection. */
export const channelAdmissionSnapshotSchema = z.object({
  channel: channelSnapshotSchema,
  invitations: z.array(channelInvitationSnapshotSchema),
}).strict() satisfies z.ZodType<ChannelAdmissionSnapshot>

/** Parse built-in protocol status without exposing arbitrary adapter state. */
export const channelProtocolStatusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('consult'), phase: z.enum(['request', 'response', 'complete']),
    request: z.object({ teamId: teamIdSchema, channelId: channelIdSchema, envelopeId: envelopeIdSchema,
      envelopeSequence: nonNegativeSafeIntegerSchema, taskId: teamTaskIdSchema.optional(), review: z.boolean(),
    }).strict().optional(),
  }).strict(),
  z.object({ kind: z.literal('discussion'), turnCount: nonNegativeSafeIntegerSchema, maxTurns: positiveSafeIntegerSchema,
    speakerPolicy: z.enum(['round-robin', 'free-form']),
  }).strict(),
  z.object({ kind: z.literal('other') }).strict(),
]) satisfies z.ZodType<ChannelProtocolStatus>
/** Parse the authenticated human inspection without changing endpoint consent replies. */
export const channelHumanAdmissionSnapshotSchema = channelAdmissionSnapshotSchema.extend({
  expectedNext: z.discriminatedUnion('kind', [z.object({ kind: z.literal('none') }).strict(),
    z.object({ kind: z.literal('participant'), participantId: participantIdSchema }).strict()]),
  protocolStatus: channelProtocolStatusSchema,
}).strict() satisfies z.ZodType<ChannelHumanAdmissionSnapshot>

/** Parse one bounded invitation expiry selection, excluding its source-owned clock. */
export const channelInvitationExpireInputSchema = z.object({
  teamId: teamIdSchema, channelId: channelIdSchema,
  expectedTeamCursor: nonNegativeSafeIntegerSchema, expectedChannelCursor: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<ChannelInvitationExpireInput>

/** Parse a registered channel-admission source identity. */
export const teamSystemChannelAdmissionProofSourceNameSchema = trimmedNameSchema

/** Parse a named endpoint confirmation or admission-owned expiry observation. */
export const teamSystemChannelAdmissionProofResolutionSchema = z.object({
  sourceName: teamSystemChannelAdmissionProofSourceNameSchema,
  scope: z.discriminatedUnion('kind', [
    channelInvitationAcknowledgeInputSchema.extend({ kind: z.literal('channel-invitation-acknowledge'),
      teamId: teamIdSchema, participantId: participantIdSchema }).strict(),
    channelInvitationExpireInputSchema.extend({ kind: z.literal('channel-invitations-expire'), now: nonNegativeSafeIntegerSchema }).strict(),
  ]),
}).strict() satisfies z.ZodType<TeamSystemChannelAdmissionProofResolution>

/** Parse a client-supplied envelope before Hub stamping. */
export const teamEnvelopeDraftSchema = z.object({
  channelId: channelIdSchema,
  audience: z.array(participantIdSchema).nullable(),
  kind: nonEmptyStringSchema,
  payload: jsonObjectSchema,
  delivery: envelopeDeliverySchema,
  causationId: envelopeIdSchema.optional(),
  correlationId: nonEmptyStringSchema.optional(),
  taskId: teamTaskIdSchema.optional(),
  traceId: nonEmptyStringSchema.optional(),
  priority: envelopePrioritySchema.optional(),
  ttlMs: positiveSafeIntegerSchema.optional(),
}).strict() as z.ZodType<TeamEnvelopeDraft>

/** Parse a Hub-stamped immutable channel envelope. */
export const teamEnvelopeSchema = z.object({
  id: envelopeIdSchema,
  teamId: teamIdSchema,
  channelId: channelIdSchema,
  sequence: nonNegativeSafeIntegerSchema,
  senderId: participantIdSchema,
  audience: z.array(participantIdSchema).nullable(),
  kind: nonEmptyStringSchema,
  payload: jsonObjectSchema,
  delivery: envelopeDeliverySchema,
  causationId: envelopeIdSchema.optional(),
  correlationId: nonEmptyStringSchema.optional(),
  taskId: teamTaskIdSchema.optional(),
  traceId: nonEmptyStringSchema.optional(),
  priority: envelopePrioritySchema,
  createdAt: nonNegativeSafeIntegerSchema,
  ttlMs: positiveSafeIntegerSchema.optional(),
}).strict() as z.ZodType<TeamEnvelope>

/** Parse JSON-only fields submitted to admit one ordinary client draft to a channel WAL. */
export const channelEnvelopePostInputSchema = z.object({
  expectedCursor: nonNegativeSafeIntegerSchema,
  idempotencyKey: channelPostIdempotencyKeySchema.optional(),
  draft: teamEnvelopeDraftSchema,
}).strict() satisfies z.ZodType<ChannelEnvelopePostInput>

/** Parse JSON-only fields for an adapter-owned final post without a caller-observed channel cursor. */
export const channelFinalPostInputSchema = z.object({
  channelId: channelIdSchema,
  idempotencyKey: channelPostIdempotencyKeySchema,
  text: nonEmptyStringSchema,
}).strict() as z.ZodType<ChannelFinalPostInput>

/** Parse JSON-only fields that select one recipient's durable Envelope admission. */
export const channelEnvelopeReceiptInputSchema = z.object({
  channelId: channelIdSchema,
  envelopeId: envelopeIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
}).strict() as z.ZodType<ChannelEnvelopeReceiptInput>

/** Parse JSON-only fields that select one channel delivery claim. */
export const channelDeliveryClaimInputSchema = z.object({
  channelId: channelIdSchema,
  envelopeId: envelopeIdSchema,
}).strict() as z.ZodType<ChannelDeliveryClaimInput>

/** One JSON-safe model-content block with a merge-extensible type discriminant. */
const teamChannelViewContentBlockSchema = z.object({
  type: nonEmptyStringSchema,
}).catchall(jsonValueSchema).transform(value => value as unknown as TeamChannelViewEventData['content'][number])

/** Parse the optional review fence retained with one model-delivery view. */
const teamChannelViewReviewFenceSchema = z.object({
  attemptId: taskAttemptIdSchema,
  reviewRevision: positiveSafeIntegerSchema,
  reviewerId: participantIdSchema,
  initiatorId: participantIdSchema.optional(),
}).strict()

/**
 * Parse one Hub-rendered channel view before a consumer appends it
 * as a required `team/channel-view` Session event.
 */
export const teamChannelViewEventDataSchema = z.object({
  teamId: teamIdSchema,
  channelId: channelIdSchema,
  adapter: teamAdapterRefSchema,
  viewPolicy: teamViewPolicyRefSchema,
  triggeringEnvelopeId: envelopeIdSchema,
  sourceEnvelopeIds: z.array(envelopeIdSchema).min(1).superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'channel view sourceEnvelopeIds must be duplicate-free' })
    }
  }),
  delivery: envelopeDeliverySchema,
  content: z.array(teamChannelViewContentBlockSchema).min(1),
  causationId: envelopeIdSchema.optional(),
  taskId: teamTaskIdSchema.optional(),
  review: teamChannelViewReviewFenceSchema.optional(),
}).strict().superRefine((view, context) => {
  if (view.sourceEnvelopeIds.at(-1) !== view.triggeringEnvelopeId) {
    context.addIssue({
      code: 'custom',
      path: ['sourceEnvelopeIds'],
      message: 'channel view sourceEnvelopeIds must end at its triggering Envelope',
    })
  }
  for (const field of ['causationId', 'taskId', 'review'] as const) {
    if (Object.hasOwn(view, field) && view[field] === undefined) {
      context.addIssue({ code: 'custom', path: [field], message: `channel view ${field} must be omitted instead of undefined` })
    }
  }
}).transform(view => ({
  teamId: view.teamId,
  channelId: view.channelId,
  adapter: view.adapter,
  viewPolicy: view.viewPolicy,
  triggeringEnvelopeId: view.triggeringEnvelopeId,
  sourceEnvelopeIds: view.sourceEnvelopeIds,
  delivery: view.delivery,
  content: view.content,
  ...view.causationId === undefined ? {} : { causationId: view.causationId },
  ...view.taskId === undefined ? {} : { taskId: view.taskId },
  ...view.review === undefined ? {} : { review: view.review },
})) satisfies z.ZodType<TeamChannelViewEventData>

/** Parse one ephemeral Hub-issued channel delivery claim. */
export const channelDeliveryClaimSchema = z.object({
  binding: activationBindingSnapshotSchema,
  channel: channelSnapshotSchema,
  envelopeId: envelopeIdSchema,
  delivery: envelopeDeliverySchema,
  view: teamChannelViewEventDataSchema.optional(),
}).strict().superRefine((claim, context) => {
  if (Object.hasOwn(claim, 'view') && claim.view === undefined) {
    context.addIssue({ code: 'custom', path: ['view'], message: 'channel delivery claim view must be omitted instead of undefined' })
    return
  }
  const view = claim.view
  const manifest = claim.channel.manifest
  const requiresView = manifest.adapter.type === 'consult'
    || manifest.adapter.type === 'discussion'
    || manifest.adapter.type === 'workflow'
  if (view === undefined) {
    if (requiresView) {
      context.addIssue({
        code: 'custom',
        path: ['view'],
        message: 'non-direct channel delivery claims require a durable model view',
      })
    }
    return
  }
  if (manifest.viewPolicy === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['view', 'viewPolicy'],
      message: 'channel delivery view requires an explicit channel view policy',
    })
  } else if (view.viewPolicy.type !== manifest.viewPolicy.type || view.viewPolicy.version !== manifest.viewPolicy.version) {
    context.addIssue({
      code: 'custom',
      path: ['view', 'viewPolicy'],
      message: 'channel delivery view policy must match the channel manifest',
    })
  }
  if (view.teamId !== manifest.teamId) {
    context.addIssue({ code: 'custom', path: ['view', 'teamId'], message: 'channel delivery view Team must match the channel manifest' })
  }
  if (view.channelId !== manifest.id) {
    context.addIssue({ code: 'custom', path: ['view', 'channelId'], message: 'channel delivery view channel must match the claim channel' })
  }
  if (view.adapter.type !== manifest.adapter.type || view.adapter.version !== manifest.adapter.version) {
    context.addIssue({ code: 'custom', path: ['view', 'adapter'], message: 'channel delivery view adapter must match the channel manifest' })
  }
  if (view.triggeringEnvelopeId !== claim.envelopeId) {
    context.addIssue({ code: 'custom', path: ['view', 'triggeringEnvelopeId'], message: 'channel delivery view trigger must match the claim Envelope' })
  }
  if (view.delivery !== claim.delivery) {
    context.addIssue({ code: 'custom', path: ['view', 'delivery'], message: 'channel delivery view treatment must match the claim delivery' })
  }
}).transform(claim => ({
  binding: claim.binding,
  channel: claim.channel,
  envelopeId: claim.envelopeId,
  delivery: claim.delivery,
  ...claim.view === undefined ? {} : { view: claim.view },
})) satisfies z.ZodType<ChannelDeliveryClaim>

/** Parse a bounded pending-delivery page request for one channel recipient. */
export const channelPendingDeliveryListRequestSchema = z.object({
  channelId: channelIdSchema,
  participantId: participantIdSchema,
  afterCursor: observedCursorSchema,
  limit: positiveSafeIntegerSchema,
}).strict() as z.ZodType<ChannelPendingDeliveryListRequest>

/** Parse one pending recipient delivery with its accepted source Envelope. */
export const channelPendingEnvelopeDeliverySchema = z.object({
  envelope: teamEnvelopeSchema,
  delivery: envelopeDeliverySchema,
}).strict() as z.ZodType<ChannelPendingEnvelopeDelivery>

/** Parse one detached bounded pending-delivery page. */
export const channelPendingDeliveryPageSchema = z.object({
  channel: channelSnapshotSchema,
  deliveries: z.array(channelPendingEnvelopeDeliverySchema),
  nextCursor: nonNegativeSafeIntegerSchema,
}).strict() as z.ZodType<ChannelPendingDeliveryPage>

/** Parse one channel-open WAL record. */
export const channelOpenedRecordSchema = z.object({
  type: z.literal('channel/opened'),
  sequence: nonNegativeSafeIntegerSchema,
  createdAt: nonNegativeSafeIntegerSchema,
  manifest: channelManifestSchema,
}).strict() satisfies z.ZodType<ChannelOpenedRecord>

/** Parse one channel WAL lifecycle transition. */
export const channelPhaseRecordSchema = z.object({
  type: z.literal('channel/phase'),
  sequence: nonNegativeSafeIntegerSchema,
  createdAt: nonNegativeSafeIntegerSchema,
  phase: channelPhaseSchema,
}).strict() satisfies z.ZodType<ChannelPhaseRecord>

/** Parse one adapter delivery intent. */
export const deliveryIntentSchema = z.object({
  participantId: participantIdSchema,
  envelopeId: envelopeIdSchema,
  delivery: envelopeDeliverySchema,
}).strict() satisfies z.ZodType<DeliveryIntent>

/** Parse one channel-envelope WAL record. */
export const channelEnvelopeRecordSchema = z.object({
  deliveryIntents: z.array(deliveryIntentSchema),
  type: z.literal('channel/envelope'),
  envelope: teamEnvelopeSchema,
  idempotencyKey: channelPostIdempotencyKeySchema.optional(),
}).strict() as z.ZodType<ChannelEnvelopeRecord>

/** Parse one channel-receipt WAL record. */
export const channelReceiptRecordSchema = z.object({
  type: z.literal('channel/receipt'),
  sequence: nonNegativeSafeIntegerSchema,
  createdAt: nonNegativeSafeIntegerSchema,
  participantId: participantIdSchema,
  envelopeId: envelopeIdSchema,
  cursor: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<ChannelReceiptRecord>

/** Parse one durable pending-delivery expiry WAL record. */
export const channelDeliveryExpiredRecordSchema = z.object({
  type: z.literal('channel/delivery-expired'),
  sequence: nonNegativeSafeIntegerSchema,
  createdAt: nonNegativeSafeIntegerSchema,
  participantId: participantIdSchema,
  envelopeId: envelopeIdSchema,
  envelopeSequence: nonNegativeSafeIntegerSchema,
  reason: z.enum(['cancellation', 'closure'] as const).optional(),
}).strict() satisfies z.ZodType<ChannelDeliveryExpiredRecord>

/** Parse one durable channel summary WAL record. */
export const channelSummaryRecordSchema = z.object({
  type: z.literal('channel/summary'),
  sequence: nonNegativeSafeIntegerSchema,
  createdAt: nonNegativeSafeIntegerSchema,
  coveredSequenceRange: channelSequenceRangeSchema,
  sourceFingerprint: channelSummarySourceFingerprintSchema,
  sourceEnvelopeIds: z.array(envelopeIdSchema).min(1).superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'channel summary source Envelope ids must be unique' })
    }
  }),
  text: trimmedTextSchema,
  policy: teamViewPolicyRefSchema,
  idempotencyKey: channelSummaryIdempotencyKeySchema,
}).strict() satisfies z.ZodType<ChannelSummaryRecord>

/** Parse one adapter-owned WAL record. */
export const channelAdapterRecordSchema = z.object({
  type: z.literal('channel/adapter'),
  sequence: nonNegativeSafeIntegerSchema,
  createdAt: nonNegativeSafeIntegerSchema,
  adapter: teamAdapterRefSchema,
  payload: jsonObjectSchema,
}).strict() satisfies z.ZodType<ChannelAdapterRecord>

/** Parse one terminal channel WAL record. */
export const channelClosedRecordSchema = z.object({
  type: z.literal('channel/closed'),
  sequence: nonNegativeSafeIntegerSchema,
  createdAt: nonNegativeSafeIntegerSchema,
  phase: z.enum(['closed', 'expired', 'failed'] as const),
  reason: nonEmptyStringSchema.optional(),
}).strict() as z.ZodType<ChannelClosedRecord>

/** Parse one closed channel WAL record. */
export const channelRecordSchema: z.ZodType<ChannelRecord> = z.union([
  channelInvitationRecordSchema,
  channelOpenedRecordSchema,
  channelPhaseRecordSchema,
  channelEnvelopeRecordSchema,
  channelReceiptRecordSchema,
  channelDeliveryExpiredRecordSchema,
  channelSummaryRecordSchema,
  channelAdapterRecordSchema,
  channelClosedRecordSchema,
])

/** Parse the result of a durable TTL delivery-expiry drive. */
export const channelDeliveryExpireResultSchema = z.object({
  channel: channelSnapshotSchema,
  expired: z.array(channelDeliveryExpiredRecordSchema),
}).strict() satisfies z.ZodType<ChannelDeliveryExpireResult>

/** Parse an explicit channel/range selection without caller-controlled summary text. */
export const channelSummarySelectionInputSchema = z.object({
  channelId: channelIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  coveredSequenceRange: channelSequenceRangeSchema,
  idempotencyKey: channelSummaryIdempotencyKeySchema,
}).strict() satisfies z.ZodType<ChannelSummarySelectionInput>

/** Parse a durable channel summary request. */
export const channelSummarizeInputSchema = z.object({
  channelId: channelIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  coveredSequenceRange: channelSequenceRangeSchema,
  sourceFingerprint: channelSummarySourceFingerprintSchema,
  sourceEnvelopeIds: z.array(envelopeIdSchema).min(1).superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'channel summary source Envelope ids must be unique' })
    }
  }),
  text: trimmedTextSchema,
  policy: teamViewPolicyRefSchema,
  idempotencyKey: channelSummaryIdempotencyKeySchema,
}).strict() satisfies z.ZodType<ChannelSummarizeInput>

/** Parse one identified post-commit channel WAL notification. */
export const channelEventSchema = z.object({
  channelId: channelIdSchema,
  record: channelRecordSchema,
}).strict() satisfies z.ZodType<ChannelEvent>

/** Parse one detached incremental channel-WAL read response. */
export const channelReadResultSchema = z.object({
  channel: channelSnapshotSchema,
  records: z.array(channelRecordSchema),
  view: jsonObjectSchema.optional(),
}).strict() satisfies z.ZodType<ChannelReadResult>

/** Parse a bounded channel-WAL page request. */
export const channelReadPageRequestSchema = z.object({
  channelId: channelIdSchema,
  afterCursor: observedCursorSchema,
  limit: positiveSafeIntegerSchema,
}).strict() satisfies z.ZodType<ChannelReadPageRequest>

/** Parse a bounded channel-WAL page. */
export const channelReadPageResultSchema = z.object({
  channel: channelSnapshotSchema,
  records: z.array(channelRecordSchema),
  view: jsonObjectSchema.optional(),
  nextCursor: nonNegativeSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<ChannelReadPageResult>

/** Parse JSON-only fields for checkpoint-gated terminal channel compaction. */
export const teamChannelCompactInputSchema = z.object({
  teamId: teamIdSchema,
  channelId: channelIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  throughSequence: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamChannelCompactInput>

/** Parse the detached result of one terminal channel compaction. */
export const teamChannelCompactResultSchema = z.object({
  channel: channelSnapshotSchema,
  compactedThrough: nonNegativeSafeIntegerSchema,
  auditCompactedThrough: nonNegativeSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<TeamChannelCompactResult>

/** Parse JSON-only fields for checkpoint-gated terminal Team-journal compaction. */
export const teamJournalCompactInputSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  throughSequence: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamJournalCompactInput>

/** Parse the detached result of one terminal Team-journal compaction. */
export const teamJournalCompactResultSchema = z.object({
  team: teamStateSnapshotSchema,
  compactedThrough: nonNegativeSafeIntegerSchema,
  auditCompactedThrough: nonNegativeSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<TeamJournalCompactResult>

const teamRootCreateInputFields = {
  goal: teamGoalSeedSchema,
  rules: jsonObjectSchema,
  budgets: jsonObjectSchema,
  authorityGrant: teamAuthorityGrantSchema.optional(),
}

/** Parse JSON-only fields accepted when a provider creates a root Team. */
export const teamRootCreateInputSchema = (
  z.object(teamRootCreateInputFields).strict()
) satisfies z.ZodType<TeamRootCreateInput>

/** Cursor and task revision retained by every parent delegation command. */
const teamTaskDelegationInputFields = {
  teamId: teamIdSchema, taskId: teamTaskIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema, expectedRevision: positiveSafeIntegerSchema, delegationId: teamDelegationIdSchema,
}
/** Parse a reservation before the child stream exists. */
export const teamTaskDelegationBeginInputSchema = z.object({
  ...teamTaskDelegationInputFields, child: teamRootCreateInputSchema,
}).strict()
/** Parse a child binding under the parent task's current revision. */
export const teamTaskDelegationBindInputSchema = z.object({ ...teamTaskDelegationInputFields, childTeamId: teamIdSchema }).strict()
/** Parse a terminal child settlement under the parent task's current revision. */
export const teamTaskDelegationSettleInputSchema = z.object({ ...teamTaskDelegationInputFields, childTeamId: teamIdSchema }).strict()
/** Parse a live child operation request without caller-selected filesystem authority. */
export const teamChildRunAuthorizeInputSchema = z.object({
  ...teamTaskDelegationInputFields, operation: z.enum(['start', 'cancel']),
}).strict()
/** Parse an operational stall while preserving its exact reservation. */
export const teamTaskDelegationStallInputSchema = z.object({ ...teamTaskDelegationInputFields, reason: teamStallReasonSchema }).strict()

/** Parse a source-owned parent delegation mutation scope. */
export const teamSystemDelegationScopeSchema = z.discriminatedUnion('kind', [
  z.lazy(() => teamTaskDelegationResultAdmitInputSchema.extend({ kind: z.literal('delegation-result-admit') })),
  teamTaskDelegationBeginInputSchema.extend({ kind: z.literal('delegation-begin') }),
  teamTaskDelegationBindInputSchema.extend({ kind: z.literal('delegation-bind') }),
  teamTaskDelegationSettleInputSchema.extend({ kind: z.literal('delegation-settle') }),
  teamTaskDelegationStallInputSchema.extend({ kind: z.literal('delegation-stall') }),
  teamChildRunAuthorizeInputSchema.extend({ kind: z.literal('delegation-authorize-run') }),
]) satisfies z.ZodType<TeamSystemDelegationScope>

const teamChildCreateInputFields = {
  ...teamRootCreateInputFields,
  parentTeamId: teamIdSchema,
  parentTaskId: teamTaskIdSchema,
  delegationId: teamDelegationIdSchema,
}

/** Parse JSON-only fields accepted when a provider creates a child Team. */
export const teamChildCreateInputSchema = z.object(teamChildCreateInputFields).strict() satisfies z.ZodType<TeamChildCreateInput>

/** Parse the JSON-only portion of a root or child Team creation request. */
export const teamCreateRequestSchema = z.union([
  teamRootCreateInputSchema,
  teamChildCreateInputSchema,
]) satisfies z.ZodType<TeamCreateInput>

/** Parse a request for the complete state of one Team. */
export const teamGetRequestSchema = z.object({
  teamId: teamIdSchema,
}).strict() satisfies z.ZodType<TeamGetRequest>

/** Parse JSON-only routing fields for one pending Host human action. */
export const teamHumanActionUpsertInputSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamHumanActionUpsertInput>

/** Parse JSON-only routing fields for one Host human-action resolution. */
export const teamHumanActionResolveInputSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamHumanActionResolveInput>

/** Parse JSON-only fields for one activation-authorized provider usage record. */
export const teamUsageRecordInputSchema = z.object({
  expectedCursor: nonNegativeSafeIntegerSchema,
  sample: teamUsageSampleInputSchema,
}).strict() satisfies z.ZodType<TeamUsageRecordInput>

/** Parse JSON-only compare-and-set fields for one terminal Team archive. */
export const teamArchiveInputSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamArchiveInput>

/** Parse JSON-only cursor-fenced fields for one authenticated human Team recovery. */
export const teamResumeInputSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamResumeInput>

const teamClosureInputFields = {
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  idempotencyKey: teamClosureIdempotencyKeySchema,
  reason: teamStallReasonSchema,
}

/** Parse JSON-only fields shared by every typed Team closure command. */
export const teamClosureInputSchema = z.object(teamClosureInputFields).strict() satisfies z.ZodType<TeamClosureInput>

/** Parse JSON-only fields that select a Team completion result. */
export const teamCompleteInputSchema = z.object({
  ...teamClosureInputFields,
  finalChannelId: channelIdSchema,
  finalEnvelopeId: envelopeIdSchema,
}).strict() satisfies z.ZodType<TeamCompleteInput>

/** Parse JSON-only fields for a typed Team failure command. */
export const teamFailInputSchema = z.object(teamClosureInputFields).strict() satisfies z.ZodType<TeamFailInput>

/** Parse JSON-only fields for a typed Team cancellation command. */
export const teamCancelInputSchema = z.object(teamClosureInputFields).strict() satisfies z.ZodType<TeamCancelInput>

/** Parse JSON-only cursor fields for one closure-driver continuation pass. */
export const teamClosureContinuationInputSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamClosureContinuationInput>

/** Parse the authoritative stream selected by an audit read. */
export const teamAuditStreamSchema = z.enum(['team', 'channel'] as const) satisfies z.ZodType<TeamAuditStream>

/** Parse one read-only audit projection entry. */
export const teamAuditEntrySchema = z.object({
  teamId: teamIdSchema,
  stream: teamAuditStreamSchema,
  channelId: channelIdSchema.optional(),
  cursor: nonNegativeSafeIntegerSchema,
  type: nonEmptyStringSchema,
  createdAt: nonNegativeSafeIntegerSchema,
  facts: jsonObjectSchema,
}).strict().superRefine((entry, context) => {
  if ((entry.stream === 'channel') !== (entry.channelId !== undefined)) {
    context.addIssue({ code: 'custom', path: ['channelId'], message: 'channel audit entries require exactly one channelId' })
  }
}) as z.ZodType<TeamAuditEntry>

/** Parse a bounded Team or channel audit read request. */
export const teamAuditReadRequestSchema = z.object({
  teamId: teamIdSchema,
  channelId: channelIdSchema.optional(),
  afterCursor: observedCursorSchema,
  limit: positiveSafeIntegerSchema,
}).strict() as unknown as z.ZodType<TeamAuditReadRequest>

/** Parse one bounded Team or channel audit page. */
export const teamAuditReadResultSchema = z.object({
  teamId: teamIdSchema,
  channelId: channelIdSchema.optional(),
  firstCursor: nonNegativeSafeIntegerSchema.optional(),
  items: z.array(teamAuditEntrySchema),
  nextCursor: nonNegativeSafeIntegerSchema.optional(),
}).strict() as z.ZodType<TeamAuditReadResult>

/** Parse JSON-only fields for a Team lifecycle transition. */
export const teamPhaseTransitionInputSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  phase: teamPhaseSchema,
  reason: teamStallReasonSchema.optional(),
}).strict().superRefine((request, context) => {
  if ((request.phase === 'stalled') !== (request.reason !== undefined)) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'Team stall reason is required exactly for stalled phase' })
  }
}) satisfies z.ZodType<TeamPhaseTransitionInput>

/** Parse JSON-only fields for a Team objective definition update. */
export const teamGoalUpdateInputSchema = z.object({
  teamId: teamIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  objective: nonEmptyStringSchema.optional(),
  budgets: jsonObjectSchema.optional(),
}).strict().superRefine((request, context) => {
  if (request.objective === undefined && request.budgets === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'Team goal update requires at least one replacement field',
    })
  }
}) as z.ZodType<TeamGoalUpdateInput>

/** Parse JSON-only fields for a Team objective lifecycle transition. */
export const teamGoalPhaseTransitionInputSchema = z.object({
  teamId: teamIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  phase: teamGoalPhaseSchema,
  blocker: teamGoalBlockerSchema.optional(),
}).strict().superRefine((request, context) => {
  if ((request.phase === 'blocked') !== (request.blocker !== undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['blocker'],
      message: 'Team goal transition blocker must be present exactly while phase is blocked',
    })
  }
}) as z.ZodType<TeamGoalPhaseTransitionInput>

/** Parse JSON-only Team-journal cursor watch fields after a provider omits any local cancellation signal. */
export const teamWatchRequestSchema = z.object({
  teamId: teamIdSchema,
  afterCursor: observedCursorSchema,
}).strict() satisfies z.ZodType<TeamWatchRequest>

/** Parse the outcome of a Team-journal cursor watch. */
export const teamWatchResultSchema: z.ZodType<TeamWatchResult> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('changed'), cursor: nonNegativeSafeIntegerSchema }).strict(),
  z.object({ kind: z.literal('closed') }).strict(),
])

/** Parse JSON-only fields for one complete declarative workflow-plan admission. */
export const teamWorkflowPlanAdmissionInputSchema: z.ZodType<TeamWorkflowPlanAdmissionInput> = z.object({
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  idempotencyKey: teamWorkflowPlanIdempotencyKeySchema,
  plan: teamWorkflowPlanSchema,
}).strict()

/** Parse JSON-only fields for a compare-and-set workflow template/task binding. */
export const teamWorkflowPlanTaskBindInputSchema: z.ZodType<TeamWorkflowPlanTaskBindInput> = z.object({
  teamId: teamIdSchema,
  planId: teamWorkflowPlanIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  expectedRevision: positiveSafeIntegerSchema,
  templateId: teamWorkflowTaskTemplateIdSchema,
  taskId: teamTaskIdSchema,
}).strict()

/** Parse JSON-only fields for a compare-and-set workflow plan/channel binding. */
export const teamWorkflowPlanChannelBindInputSchema: z.ZodType<TeamWorkflowPlanChannelBindInput> = z.object({
  teamId: teamIdSchema,
  planId: teamWorkflowPlanIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  expectedRevision: positiveSafeIntegerSchema,
  channelId: channelIdSchema,
}).strict()

/** Parse JSON-only fields for a workflow-plan ready or terminal phase transition. */
export const teamWorkflowPlanPhaseInputSchema: z.ZodType<TeamWorkflowPlanPhaseInput> = z.object({
  teamId: teamIdSchema,
  planId: teamWorkflowPlanIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  expectedRevision: positiveSafeIntegerSchema,
  phase: z.enum(['ready', 'completed', 'failed', 'cancelled'] as const),
  result: teamWorkflowPlanResultSchema.optional(),
  failure: teamStallReasonSchema.optional(),
  cancellation: teamStallReasonSchema.optional(),
}).strict().superRefine((request, context) => {
  if (request.phase === 'completed' && request.result === undefined) {
    context.addIssue({ code: 'custom', path: ['result'], message: 'completed workflow phase requires exactly one result' })
  }
  if ((request.phase === 'failed') !== (request.failure !== undefined)) {
    context.addIssue({ code: 'custom', path: ['failure'], message: 'failed workflow phase requires exactly one failure' })
  }
  if (request.phase !== 'cancelled' && request.cancellation !== undefined) {
    context.addIssue({ code: 'custom', path: ['cancellation'], message: 'only cancelled workflow phases accept a cancellation reason' })
  }
  if (request.phase === 'ready' && request.result !== undefined) {
    context.addIssue({ code: 'custom', path: ['result'], message: 'only terminal workflow phases accept a result' })
  }
  if (request.phase !== 'failed' && request.failure !== undefined) {
    context.addIssue({ code: 'custom', path: ['failure'], message: 'only failed workflow phases accept a failure' })
  }
})

/** Parse a read request for one durable workflow plan. */
export const teamWorkflowPlanGetRequestSchema: z.ZodType<TeamWorkflowPlanGetRequest> = z.object({
  teamId: teamIdSchema,
  planId: teamWorkflowPlanIdSchema,
}).strict()

/** Parse one bounded workflow-plan page request. */
export const teamWorkflowPlanListPageRequestSchema: z.ZodType<TeamWorkflowPlanListPageRequest> = z.object({
  teamId: teamIdSchema,
  afterCursor: z.number().int().min(-1),
  limit: positiveSafeIntegerSchema,
}).strict()

/** Parse one bounded workflow-plan page. */
export const teamWorkflowPlanListPageSchema: z.ZodType<TeamWorkflowPlanListPage> = z.object({
  items: z.array(teamWorkflowPlanSnapshotSchema),
  nextCursor: nonNegativeSafeIntegerSchema.optional(),
}).strict()

/** Fields shared by participant invitations and topology-authority scopes. */
const participantInviteFields = {
  kind: participantKindSchema,
  displayName: nonEmptyStringSchema,
  role: nonEmptyStringSchema,
  capabilities: participantCapabilitiesSchema,
  owner: teamParticipantOwnerSchema.optional(),
  provider: trimmedTextSchema.optional(),
  preset: trimmedTextSchema.optional(),
  model: trimmedTextSchema.optional(),
  authScheme: trimmedTextSchema.optional(),
  authorityGrant: teamAuthorityGrantSchema.optional(),
}

/** Parse JSON-only fields accepted when a provider invites a participant. */
export const participantInviteInputSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  ...participantInviteFields,
}).strict().superRefine(requireParticipantOwner) satisfies z.ZodType<ParticipantInviteInput>

/** Parse JSON-only fields for a compare-and-set participant-membership lifecycle transition. */
export const participantPhaseTransitionInputSchema = z.object({
  teamId: teamIdSchema,
  participantId: participantIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  phase: participantPhaseSchema,
}).strict() satisfies z.ZodType<ParticipantPhaseTransitionInput>

/** Parse JSON-only fields for one activation binding publication. */
export const activationBindInputSchema = z.object({
  expectedCursor: nonNegativeSafeIntegerSchema,
  binding: activationBindingSnapshotSchema,
}).strict() satisfies z.ZodType<ActivationBindInput>

/** Parse JSON-only fields for one activation residency-status update. */
export const activationStatusUpdateInputSchema = z.object({
  teamId: teamIdSchema,
  activationId: activationIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  status: activationStatusSchema,
}).strict() satisfies z.ZodType<ActivationStatusUpdateInput>

/** Parse JSON-only fields for one exact activation lease-release operation. */
export const activationFenceInputSchema = z.object({
  teamId: teamIdSchema,
  activationId: activationIdSchema,
  participantId: participantIdSchema,
  sessionId: sessionIdSchema,
  provider: nonEmptyStringSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<ActivationFenceInput>

/** Parse JSON-only fields for one exact locally quiesced activation lease release. */
export const activationQuiesceInputSchema = activationFenceInputSchema satisfies z.ZodType<ActivationQuiesceInput>

/** Parse a request for one durable activation binding. */
export const activationGetRequestSchema = z.object({
  teamId: teamIdSchema,
  activationId: activationIdSchema,
}).strict() satisfies z.ZodType<ActivationGetRequest>

/** Parse JSON-only fields for a TeamRun or authenticated-human soft-interrupt request. */
export const participantInterruptRequestInputSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  participantId: participantIdSchema.optional(),
}).strict() satisfies z.ZodType<ParticipantInterruptRequestInput>

/** Parse JSON-only fields for pending interrupts at the current Link target. */
export const participantInterruptListPendingInputSchema = (
  z.object({}).strict()
) satisfies z.ZodType<ParticipantInterruptListPendingInput>

/** Parse JSON-only acknowledgement fields for one participant interrupt. */
export const participantInterruptAcknowledgeInputSchema = z.object({
  interruptId: teamInterruptIdSchema,
}).strict() satisfies z.ZodType<ParticipantInterruptAcknowledgeInput>

/** Parse JSON-only fields accepted when a coordinator creates a Team task. */
export const teamTaskCreateInputSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  createCommand: teamTaskCreateCommandInputSchema,
  execution: teamTaskExecutionSchema.optional(),
  placement: teamTaskPlacementSchema.optional(),
  parentTaskId: teamTaskIdSchema.optional(),
  workflowPlanId: teamWorkflowPlanIdSchema.optional(),
  workflowTemplateId: teamWorkflowTaskTemplateIdSchema.optional(),
  subject: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
  integration: teamTaskIntegrationSpecSchema.optional(),
  blockedBy: z.array(teamTaskIdSchema),
  requiredCapabilities: z.array(nonEmptyStringSchema),
  priority: nonNegativeSafeIntegerSchema,
  readScopes: z.array(nonEmptyStringSchema),
  writeScopes: z.array(nonEmptyStringSchema),
  workspaceMode: teamTaskWorkspaceModeSchema,
  budget: jsonObjectSchema,
  reviewPolicy: teamTaskReviewPolicySchema,
  maxAttempts: positiveSafeIntegerSchema,
}).strict().superRefine((request, context) => {
  if (request.execution?.kind === 'child-team' && (request.workspaceMode !== 'shared' || request.maxAttempts !== 1
    || request.reviewPolicy.kind !== 'none' || request.placement !== undefined || request.integration !== undefined
    || request.workflowPlanId !== undefined)) {
    context.addIssue({ code: 'custom', path: ['execution'], message: 'child-Team execution uses one shared delegation; retries and review belong to its template' })
  }
  if ((request.workflowPlanId === undefined) !== (request.workflowTemplateId === undefined)) {
    context.addIssue({
      code: 'custom', path: ['workflowTemplateId'],
      message: 'workflowPlanId and workflowTemplateId must be provided together',
    })
  }
  if (request.integration !== undefined) {
    if (request.integration.mode === 'integrate' && request.integration.expectedTarget === undefined) {
      context.addIssue({ code: 'custom', path: ['integration', 'expectedTarget'], message: 'integrating task requires an expected target revision' })
    }
    if (request.workflowPlanId !== undefined) {
      context.addIssue({ code: 'custom', path: ['integration'], message: 'workflow tasks cannot be integration tasks' })
    }
  }
}) as z.ZodType<TeamTaskCreateInput>

/** Parse a request for one detached Team task projection. */
export const teamTaskGetRequestSchema = z.object({
  teamId: teamIdSchema,
  taskId: teamTaskIdSchema,
}).strict() satisfies z.ZodType<TeamTaskGetRequest>

/** Parse a bounded Team task-list page request. */
export const teamTaskListPageRequestSchema = z.object({
  teamId: teamIdSchema,
  afterCursor: observedCursorSchema,
  limit: positiveSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamTaskListPageRequest>

/** Parse a bounded Team task-list page. */
export const teamTaskListPageSchema = z.object({
  items: z.array(teamTaskSnapshotSchema),
  nextCursor: nonNegativeSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<TeamTaskListPage>

/** Parse a narrow compare-and-set Team task details edit. */
export const teamTaskDetailsUpdateInputSchema = z.object({
  teamId: teamIdSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  subject: nonEmptyStringSchema.optional(),
  description: nonEmptyStringSchema.optional(),
  blockedBy: z.array(teamTaskIdSchema).optional(),
}).strict().superRefine((request, context) => {
  if (
    request.subject === undefined
    && request.description === undefined
    && request.blockedBy === undefined
  ) {
    context.addIssue({
      code: 'custom',
      message: 'task details update requires at least one replacement field',
    })
  }
}) as z.ZodType<TeamTaskDetailsUpdateInput>

/** Parse JSON-only fields for a compare-and-set advisory owner proposal for a pending Team task. */
export const teamTaskOwnerProposalInputSchema = z.object({
  teamId: teamIdSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  proposedOwnerId: participantIdSchema.optional(),
}).strict() satisfies z.ZodType<TeamTaskOwnerProposalInput>

/** Parse a compare-and-set task tombstone request. */
export const teamTaskDeleteInputSchema = z.object({
  teamId: teamIdSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamTaskDeleteInput>

/** Parse JSON-only fields for a compare-and-set cancellation of an unleased pending task. */
export const teamTaskCancelInputSchema = z.object({
  teamId: teamIdSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  reason: nonEmptyStringSchema.optional(),
}).strict() satisfies z.ZodType<TeamTaskCancelInput>

/** Parse JSON-only post-release cancellation cleanup of one pending Team task. */
export const teamCancellationTaskCancelInputSchema = z.object({
  teamId: teamIdSchema,
  cancellationIdempotencyKey: teamClosureIdempotencyKeySchema,
  cancellationRequestedAt: nonNegativeSafeIntegerSchema,
  expectedTeamCursor: nonNegativeSafeIntegerSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamCancellationTaskCancelInput>

/** Parse the JSON-only fields that select one current review resolution. */
export const teamTaskReviewResolveInputSchema = z.object({
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  nextPhase: z.enum(['completed', 'pending'] as const),
  reason: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<TeamTaskReviewResolveInput>

/** Fields shared by both activation-bound and activation-free assignment requests. */
const teamTaskAssignFields = {
  teamId: teamIdSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  participantId: participantIdSchema,
  wakeChannelId: channelIdSchema.optional(),
  leaseDurationMs: positiveSafeIntegerSchema,
}

/** Parse JSON-only fields for one scheduler-selected task assignment. */
export const teamTaskAssignInputSchema = z.union([
  z.object({ ...teamTaskAssignFields, activationId: activationIdSchema }).strict(),
  z.object(teamTaskAssignFields).strict(),
]) as z.ZodType<TeamTaskAssignInput>

/** Fields shared by every post-assignment task attempt fence. */
const teamTaskAttemptFenceFields = {
  teamId: teamIdSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  attemptId: taskAttemptIdSchema,
}

/** Parse the revision-and-attempt fence used after a task receives a lease. */
export const teamTaskAttemptFenceSchema = (
  z.object(teamTaskAttemptFenceFields).strict()
) satisfies z.ZodType<TeamTaskAttemptFence>

/** Fields shared by activation-bound and activation-free owner attempt fences. */
const teamTaskAttemptOwnerFenceFields = {
  ...teamTaskAttemptFenceFields,
  participantId: participantIdSchema,
}
const teamTaskAttemptOwnerFenceWithActivationSchema = z.object({
  ...teamTaskAttemptOwnerFenceFields,
  activationId: activationIdSchema,
}).strict()
const teamTaskAttemptOwnerFenceWithoutActivationSchema = z.object(teamTaskAttemptOwnerFenceFields).strict()

/** Parse an owner-authorized revision-and-attempt fence. */
export const teamTaskAttemptOwnerFenceSchema = z.union([
  teamTaskAttemptOwnerFenceWithActivationSchema,
  teamTaskAttemptOwnerFenceWithoutActivationSchema,
]) as z.ZodType<TeamTaskAttemptOwnerFence>

/** Parse JSON-only fields for a fenced transition from assignment to running execution. */
export const teamTaskAttemptStartInputSchema = z.object({
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  attemptId: taskAttemptIdSchema,
}).strict() satisfies z.ZodType<TeamTaskAttemptStartInput>

/** Parse JSON-only fields that select one channel-delivery-bound, idempotent task-agent attempt-start claim. */
export const teamTaskAttemptStartClaimInputSchema = z.object({
  taskId: teamTaskIdSchema,
  attemptId: taskAttemptIdSchema,
  assignedRevision: positiveSafeIntegerSchema,
  channelId: channelIdSchema,
  envelopeId: envelopeIdSchema,
}).strict() satisfies z.ZodType<TeamTaskAttemptStartClaimInput>

/** Parse JSON-only fields that select the current task attempt whose fixed lease is renewed. */
export const teamTaskAttemptHeartbeatInputSchema = z.object({
  taskId: teamTaskIdSchema,
  attemptId: taskAttemptIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamTaskAttemptHeartbeatInput>

/** Parse JSON-only fields that select and settle the current task attempt. */
export const teamTaskAttemptSettleInputSchema = z.object({
  taskId: teamTaskIdSchema,
  attemptId: taskAttemptIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  outcome: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('released') }).strict(),
    z.object({ kind: z.literal('failed'), failure: taskAttemptFailureSchema }).strict(),
    z.object({ kind: z.literal('completed'), result: taskAttemptResultSchema }).strict(),
    z.object({ kind: z.literal('cancelled') }).strict(),
  ]),
}).strict() satisfies z.ZodType<TeamTaskAttemptSettleInput>

/** Parse JSON-only fields for one scheduler-selected elapsed lease expiry. */
export const teamTaskAttemptExpireInputSchema = (
  teamTaskAttemptFenceSchema
) as z.ZodType<TeamTaskAttemptExpireInput>

/** Parse live-provider metadata that may become a durable workspace allocation binding. */
export const teamWorkspaceAllocationBindingInputSchema = z.object({
  id: teamWorkspaceAllocationIdSchema,
  provider: trimmedNameSchema,
  mode: teamTaskWorkspaceModeSchema,
  assignedRevision: positiveSafeIntegerSchema,
  participantId: participantIdSchema,
  activationId: activationIdSchema,
  sessionId: sessionIdSchema,
  baseVersion: nonEmptyStringSchema.optional(),
  executionWorld: teamWorkspaceExecutionWorldSchema.optional(),
}).strict() satisfies z.ZodType<TeamWorkspaceAllocationBindingInput>

/** Parse one source-owned workspace allocation reservation request. */
export const teamWorkspaceAllocationReserveInputSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  taskId: teamTaskIdSchema,
  expectedTaskRevision: positiveSafeIntegerSchema,
  attemptId: taskAttemptIdSchema,
  allocation: teamWorkspaceAllocationBindingInputSchema,
}).strict() satisfies z.ZodType<TeamWorkspaceAllocationReserveInput>

/** Fields shared by preserve and release transitions for one bound workspace allocation. */
const teamWorkspaceAllocationLifecycleFields = {
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  allocationId: teamWorkspaceAllocationIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
}

/** Parse one source-owned allocation activation after provider materialization or restore. */
export const teamWorkspaceAllocationActivateInputSchema = z.object(
  teamWorkspaceAllocationLifecycleFields,
).strict() satisfies z.ZodType<TeamWorkspaceAllocationActivateInput>

/** Parse one source-owned release intent before provider cleanup starts. */
export const teamWorkspaceAllocationReleaseRequestInputSchema = z.object(
  teamWorkspaceAllocationLifecycleFields,
).strict() satisfies z.ZodType<TeamWorkspaceAllocationReleaseRequestInput>

/** Parse one source-owned preservation of an unreleased workspace allocation. */
export const teamWorkspaceAllocationPreserveInputSchema = z.object({
  ...teamWorkspaceAllocationLifecycleFields,
  reason: teamStallReasonSchema,
}).strict() satisfies z.ZodType<TeamWorkspaceAllocationPreserveInput>

/** Parse an exact provider observation before recording allocation loss. */
export const teamWorkspaceAllocationLossInputSchema = z.object({
  ...teamWorkspaceAllocationLifecycleFields, loss: teamWorkspaceLossSchema,
}).strict() satisfies z.ZodType<TeamWorkspaceAllocationLossInput>

/** Parse one source-owned successful workspace allocation release. */
export const teamWorkspaceAllocationReleaseInputSchema = z.object(
  teamWorkspaceAllocationLifecycleFields,
).strict() satisfies z.ZodType<TeamWorkspaceAllocationReleaseInput>

/** Fields accepted when a provider opens a channel. */
const channelOpenInputFields = {
  invitations: z.array(z.object({ participantId: participantIdSchema, required: z.boolean() }).strict()).optional(),
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  adapter: teamAdapterRefSchema,
  viewPolicy: teamViewPolicyRefSchema.optional(),
  workflowPlanId: teamWorkflowPlanIdSchema.optional(),
  expectedPlanRevision: positiveSafeIntegerSchema.optional(),
  participants: z.array(channelParticipantSchema),
  limits: jsonObjectSchema,
}

/** Parse JSON-only fields accepted when a provider opens a channel. */
export const channelOpenInputSchema = z.object(channelOpenInputFields).strict().superRefine((input, context) => {
  if ((input.workflowPlanId === undefined) !== (input.expectedPlanRevision === undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['expectedPlanRevision'],
      message: 'workflowPlanId and expectedPlanRevision must be provided together',
    })
  }
}) satisfies z.ZodType<ChannelOpenInput>

/** Parse a request for one detached channel projection. */
export const channelGetRequestSchema = z.object({
  channelId: channelIdSchema,
}).strict() satisfies z.ZodType<ChannelGetRequest>

/** Parse a request for the unseen suffix of one channel WAL. */
export const channelReadRequestSchema = z.object({
  channelId: channelIdSchema,
  afterCursor: observedCursorSchema,
}).strict() satisfies z.ZodType<ChannelReadRequest>

/** Parse a compare-and-set channel closure request. */
export const channelCloseInputSchema = z.object({
  channelId: channelIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  reason: nonEmptyStringSchema.optional(),
}).strict() as z.ZodType<ChannelCloseInput>

/** Parse a stable generic channel lifecycle proof-source identity. */
export const teamSystemChannelLifecycleProofSourceNameSchema = trimmedNameSchema
/** Parse one exact generic channel opening or closure scope retained by a source. */
export const teamSystemChannelLifecycleScopeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('channel-open'),
    ...channelOpenInputFields,
    workflowPlanId: z.undefined().optional(),
    expectedPlanRevision: z.undefined().optional(),
  }).strict(),
  z.object({
    kind: z.literal('channel-close'), teamId: teamIdSchema, channelId: channelIdSchema,
    expectedCursor: nonNegativeSafeIntegerSchema, reason: nonEmptyStringSchema.optional(),
  }).strict(),
]) as z.ZodType<TeamSystemChannelLifecycleScope>
/** Parse immutable source attribution for one generic channel lifecycle proof. */
export const teamSystemChannelLifecycleProofResolutionSchema = z.object({
  sourceName: teamSystemChannelLifecycleProofSourceNameSchema,
  scope: teamSystemChannelLifecycleScopeSchema,
}).strict()

/** Parse a stable workspace-allocation proof-source identity. */
export const teamSystemWorkspaceAllocationProofSourceNameSchema = trimmedNameSchema

/** Parse one exact workspace allocation lifecycle scope retained by a source. */
export const teamSystemWorkspaceAllocationScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace-observe'), ...workspaceObservationFields }).strict(),
  z.object({ kind: z.literal('workspace-allocation-reserve'),
    teamId: teamIdSchema,
    expectedCursor: nonNegativeSafeIntegerSchema,
    taskId: teamTaskIdSchema,
    expectedTaskRevision: positiveSafeIntegerSchema,
    attemptId: taskAttemptIdSchema,
    allocation: teamWorkspaceAllocationBindingInputSchema,
  }).strict(),
  z.object({ kind: z.literal('workspace-allocation-activate'),
    ...teamWorkspaceAllocationLifecycleFields,
  }).strict(),
  z.object({ kind: z.literal('workspace-allocation-release-request'),
    ...teamWorkspaceAllocationLifecycleFields,
  }).strict(),
  z.object({ kind: z.literal('workspace-allocation-preserve'),
    ...teamWorkspaceAllocationLifecycleFields,
    reason: teamStallReasonSchema,
  }).strict(),
  z.object({ kind: z.literal('workspace-allocation-release'),
    ...teamWorkspaceAllocationLifecycleFields,
  }).strict(),
  z.object({ kind: z.literal('workspace-allocation-loss'),
    ...teamWorkspaceAllocationLifecycleFields, loss: teamWorkspaceLossSchema,
  }).strict(),
]) as z.ZodType<TeamSystemWorkspaceAllocationScope>

/** Parse immutable source attribution for one workspace allocation proof. */
export const teamSystemWorkspaceAllocationProofResolutionSchema = z.object({
  sourceName: teamSystemWorkspaceAllocationProofSourceNameSchema,
  scope: teamSystemWorkspaceAllocationScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemWorkspaceAllocationProofResolution>

/** Parse JSON-only scheduler fields for one participant-review consult channel. */
export const schedulerReviewChannelOpenInputSchema = z.object({
  teamId: teamIdSchema,
  expectedTeamCursor: nonNegativeSafeIntegerSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  attemptId: taskAttemptIdSchema,
  initiatorId: participantIdSchema,
  reviewerId: participantIdSchema,
  reviewerActivationId: activationIdSchema,
  reviewerSessionId: sessionIdSchema,
  reviewerProvider: trimmedNameSchema,
}).strict() satisfies z.ZodType<SchedulerReviewChannelOpenInput>

/** Parse JSON-only scheduler fields for one task-assignment wake channel. */
export const schedulerWakeChannelOpenInputSchema = z.object({
  teamId: teamIdSchema,
  expectedTeamCursor: nonNegativeSafeIntegerSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  participantId: participantIdSchema,
  activationId: activationIdSchema,
  sessionId: sessionIdSchema,
}).strict() satisfies z.ZodType<SchedulerWakeChannelOpenInput>

/** Parse JSON-only scheduler fields for one failed task-assignment wake cleanup. */
export const schedulerFailedWakeChannelCloseInputSchema = z.object({
  teamId: teamIdSchema,
  taskId: teamTaskIdSchema,
  participantId: participantIdSchema,
  activationId: activationIdSchema,
  sessionId: sessionIdSchema,
  channelId: channelIdSchema,
  expectedChannelCursor: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<SchedulerFailedWakeChannelCloseInput>

/** Parse JSON-only scheduler fields for one bounded due-delivery expiry batch. */
export const schedulerChannelDeliveryExpireInputSchema = z.object({
  teamId: teamIdSchema,
  channelId: channelIdSchema,
  expectedTeamCursor: nonNegativeSafeIntegerSchema,
  expectedChannelCursor: nonNegativeSafeIntegerSchema,
  now: nonNegativeSafeIntegerSchema,
  limit: positiveSafeIntegerSchema,
}).strict() satisfies z.ZodType<SchedulerChannelDeliveryExpireInput>

/** Parse JSON-only post-release cancellation cleanup closure of one active Team channel. */
export const teamCancellationChannelCloseInputSchema = z.object({
  teamId: teamIdSchema,
  cancellationIdempotencyKey: teamClosureIdempotencyKeySchema,
  cancellationRequestedAt: nonNegativeSafeIntegerSchema,
  expectedTeamCursor: nonNegativeSafeIntegerSchema,
  channelId: channelIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  reason: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<TeamCancellationChannelCloseInput>

/** Parse JSON-only post-release finalization cleanup closure of one active Team channel. */
export const teamFinalizationChannelCloseInputSchema = z.object({
  teamId: teamIdSchema,
  finalChannelId: channelIdSchema,
  finalEnvelopeId: envelopeIdSchema,
  expectedTeamCursor: nonNegativeSafeIntegerSchema,
  channelId: channelIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  reason: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<TeamFinalizationChannelCloseInput>

/** Parse JSON-only fields for one TeamRun cleanup of an unbound workflow channel. */
export const teamWorkflowChannelCloseInputSchema: z.ZodType<TeamWorkflowChannelCloseInput> = z.object({
  teamId: teamIdSchema,
  planId: teamWorkflowPlanIdSchema,
  expectedTeamCursor: nonNegativeSafeIntegerSchema,
  expectedRevision: positiveSafeIntegerSchema,
  channelId: channelIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  reason: nonEmptyStringSchema.optional(),
}).strict()

/** Parse one stable system workflow proof-source registration name. */
export const teamSystemWorkflowProofSourceNameSchema = trimmedNameSchema

/** Parse an exact TeamRun workflow-channel opening scope. */
const teamRunWorkflowChannelOpenScopeSchema = z.object({
  kind: z.literal('team-run-workflow-channel-open'),
  teamId: teamIdSchema,
  coordinator: teamTaskCreatorSchema,
  planId: teamWorkflowPlanIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  expectedRevision: positiveSafeIntegerSchema,
  adapter: teamAdapterRefSchema,
  viewPolicy: teamViewPolicyRefSchema.optional(),
  participants: z.array(channelParticipantSchema),
  limits: jsonObjectSchema,
}).strict()

/** Parse an exact TeamRun workflow-plan/channel binding scope. */
const teamRunWorkflowChannelBindScopeSchema = z.object({
  kind: z.literal('team-run-workflow-channel-bind'),
  teamId: teamIdSchema,
  coordinator: teamTaskCreatorSchema,
  planId: teamWorkflowPlanIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  expectedRevision: positiveSafeIntegerSchema,
  channelId: channelIdSchema,
}).strict()

/** Parse an exact TeamRun workflow-plan/task binding scope. */
const teamRunWorkflowTaskBindScopeSchema = z.object({
  kind: z.literal('team-run-workflow-task-bind'),
  teamId: teamIdSchema,
  coordinator: teamTaskCreatorSchema,
  planId: teamWorkflowPlanIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  expectedRevision: positiveSafeIntegerSchema,
  templateId: teamWorkflowTaskTemplateIdSchema,
  taskId: teamTaskIdSchema,
}).strict()

/** Parse an exact TeamRun workflow-plan ready or terminal phase scope. */
const teamRunWorkflowPlanPhaseScopeSchema = z.object({
  kind: z.literal('team-run-workflow-plan-phase'),
  teamId: teamIdSchema,
  coordinator: teamTaskCreatorSchema,
  planId: teamWorkflowPlanIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  expectedRevision: positiveSafeIntegerSchema,
  phase: z.enum(['ready', 'completed', 'failed'] as const),
  result: teamWorkflowPlanResultSchema.optional(),
  failure: teamStallReasonSchema.optional(),
}).strict().superRefine((scope, context) => {
  if (scope.phase === 'completed' && scope.result === undefined) {
    context.addIssue({ code: 'custom', path: ['result'], message: 'completed workflow phase requires exactly one result' })
  }
  if ((scope.phase === 'failed') !== (scope.failure !== undefined)) {
    context.addIssue({ code: 'custom', path: ['failure'], message: 'failed workflow phase requires exactly one failure' })
  }
  if (scope.phase === 'ready' && scope.result !== undefined) {
    context.addIssue({ code: 'custom', path: ['result'], message: 'only terminal workflow phases accept a result' })
  }
  if (scope.phase !== 'failed' && scope.failure !== undefined) {
    context.addIssue({ code: 'custom', path: ['failure'], message: 'only failed workflow phases accept a failure' })
  }
})

/** Parse an exact TeamRun cleanup scope for an unbound workflow channel. */
const teamRunWorkflowChannelCloseScopeSchema = z.object({
  kind: z.literal('team-run-workflow-channel-close'),
  teamId: teamIdSchema,
  coordinator: teamTaskCreatorSchema,
  planId: teamWorkflowPlanIdSchema,
  expectedTeamCursor: nonNegativeSafeIntegerSchema,
  expectedRevision: positiveSafeIntegerSchema,
  channelId: channelIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  reason: nonEmptyStringSchema.optional(),
}).strict()

/** Parse the closed TeamRun workflow compiler operation selected by one system proof. */
export const teamSystemWorkflowScopeSchema = z.discriminatedUnion('kind', [
  teamRunWorkflowChannelOpenScopeSchema,
  teamRunWorkflowChannelBindScopeSchema,
  teamRunWorkflowTaskBindScopeSchema,
  teamRunWorkflowPlanPhaseScopeSchema,
  teamRunWorkflowChannelCloseScopeSchema,
]) satisfies z.ZodType<TeamSystemWorkflowScope>

/** Parse one detached source attribution resolved from a runtime-only workflow compiler proof. */
export const teamSystemWorkflowProofResolutionSchema = z.object({
  sourceName: teamSystemWorkflowProofSourceNameSchema,
  scope: teamSystemWorkflowScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemWorkflowProofResolution>

/** Parse one stable system default-worker task-control proof-source registration name. */
export const teamSystemTaskControlProofSourceNameSchema = trimmedNameSchema

/** Parse an exact TeamRun default-worker advisory owner proposal scope. */
const teamRunDefaultWorkerOwnerProposalScopeSchema = z.object({
  kind: z.literal('team-run-default-worker-owner-proposal'),
  teamId: teamIdSchema,
  coordinator: teamTaskCreatorSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  proposedOwnerId: participantIdSchema.optional(),
}).strict()

/** Parse an exact TeamRun current-coordinator default-worker cancellation scope. */
const teamRunDefaultWorkerCancelScopeSchema = z.object({
  kind: z.literal('team-run-default-worker-cancel'),
  teamId: teamIdSchema,
  coordinator: teamTaskCreatorSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  reason: nonEmptyStringSchema.optional(),
}).strict()

/** Parse the closed TeamRun default-worker task-control operation selected by one system proof. */
export const teamSystemTaskControlScopeSchema = z.discriminatedUnion('kind', [
  teamRunDefaultWorkerOwnerProposalScopeSchema,
  teamRunDefaultWorkerCancelScopeSchema,
  teamRunDefaultWorkerCancelScopeSchema.extend({ kind: z.literal('team-run-workflow-task-cancel'), planId: teamWorkflowPlanIdSchema }).strict(),
]) satisfies z.ZodType<TeamSystemTaskControlScope>

/** Parse one detached source attribution resolved from a runtime-only coordinator task-control proof. */
export const teamSystemTaskControlProofResolutionSchema = z.object({
  sourceName: teamSystemTaskControlProofSourceNameSchema,
  scope: teamSystemTaskControlScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemTaskControlProofResolution>

/** Parse one stable system root-creation proof-source registration name. */
export const teamSystemRootCreationProofSourceNameSchema = trimmedNameSchema

/** Parse one exact TeamRun root creation before a Team identity exists. */
const teamRunRootCreationScopeSchema = z.object({
  kind: z.literal('team-run-root-create'),
  ...teamRootCreateInputFields,
}).strict()

/** Parse the closed root-Team creation operation selected by one system proof. */
export const teamSystemRootCreationScopeSchema = (
  teamRunRootCreationScopeSchema
) satisfies z.ZodType<TeamSystemRootCreationScope>

/** Parse one detached source attribution resolved from a runtime-only root-creation proof. */
export const teamSystemRootCreationProofResolutionSchema = z.object({
  sourceName: teamSystemRootCreationProofSourceNameSchema,
  scope: teamSystemRootCreationScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemRootCreationProofResolution>

/** Parse one stable system child-creation proof-source registration name. */
export const teamSystemChildCreationProofSourceNameSchema = trimmedNameSchema

/** Parse one exact delegated child Team creation under an observed parent cursor. */
const teamChildCreationScopeSchema = z.object({
  kind: z.literal('team-child-create'),
  ...teamChildCreateInputFields,
  expectedParentCursor: nonNegativeSafeIntegerSchema,
}).strict()

/** Parse the closed nested-Team creation operation selected by one system proof. */
export const teamSystemChildCreationScopeSchema = (
  teamChildCreationScopeSchema
) satisfies z.ZodType<TeamSystemChildCreationScope>

/** Parse one detached source attribution resolved from a runtime-only child-creation proof. */
export const teamSystemChildCreationProofResolutionSchema = z.object({
  sourceName: teamSystemChildCreationProofSourceNameSchema,
  scope: teamSystemChildCreationScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemChildCreationProofResolution>

/** Parse one stable system channel-summary proof-source registration name. */
export const teamSystemChannelSummaryProofSourceNameSchema = trimmedNameSchema

/** Parse one exact source-owned durable channel summary append. */
const teamChannelSummaryScopeSchema = channelSummarizeInputSchema.extend({
  kind: z.literal('channel-summary'),
}).strict()

/** Parse the closed channel summary append selected by one system proof. */
export const teamSystemChannelSummaryScopeSchema = (
  teamChannelSummaryScopeSchema
) satisfies z.ZodType<TeamSystemChannelSummaryScope>

/** Parse one detached source attribution resolved from a runtime-only channel summary proof. */
export const teamSystemChannelSummaryProofResolutionSchema = z.object({
  sourceName: teamSystemChannelSummaryProofSourceNameSchema,
  scope: teamSystemChannelSummaryScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemChannelSummaryProofResolution>

/** Parse one stable system terminal-archive proof-source registration name. */
export const teamSystemArchiveProofSourceNameSchema = trimmedNameSchema

/** Parse one exact TeamRun archive of a locally owned terminal Team. */
const teamRunTerminalArchiveScopeSchema = z.object({
  kind: z.literal('team-run-terminal-archive'),
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
}).strict()

/** Parse the closed terminal Team archive operation selected by one system proof. */
export const teamSystemArchiveScopeSchema = (
  teamRunTerminalArchiveScopeSchema
) satisfies z.ZodType<TeamSystemArchiveScope>

/** Parse one detached source attribution resolved from a runtime-only terminal archive proof. */
export const teamSystemArchiveProofResolutionSchema = z.object({
  sourceName: teamSystemArchiveProofSourceNameSchema,
  scope: teamSystemArchiveScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemArchiveProofResolution>

/** Parse one stable system topology proof-source registration name. */
export const teamSystemTopologyProofSourceNameSchema = trimmedNameSchema

/** Parse the immutable participant descriptor selected by one topology source. */
const topologyParticipantSchema = z.object(participantInviteFields).strict().superRefine(requireParticipantOwner)

/** Recognize the durable worker-pool role namespace at the topology proof boundary. */
function isWorkerTopologyRole(role: string): boolean {
  return role === 'worker' || /^worker-(?:[2-9]|[1-9][0-9]+)$/u.test(role)
}

/** Require a topology phase scope to advance exactly one supported membership edge. */
function topologyPhaseScope(
  scope: { readonly expectedPhase: 'invited' | 'provisioning'; readonly phase: 'provisioning' | 'active' },
  context: z.RefinementCtx,
): void {
  if ((scope.expectedPhase === 'invited' && scope.phase === 'provisioning')
    || (scope.expectedPhase === 'provisioning' && scope.phase === 'active')) return
  context.addIssue({
    code: 'custom',
    path: ['phase'],
    message: 'topology phase scope must advance invited to provisioning or provisioning to active',
  })
}

/** Parse an exact TeamRun bootstrap invitation of one default-topology participant. */
const teamRunBootstrapParticipantInviteScopeSchema = z.object({
  kind: z.literal('team-run-bootstrap-participant-invite'),
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  participant: topologyParticipantSchema,
}).strict()

/** Parse an exact TeamRun bootstrap phase transition for one default-topology participant. */
const teamRunBootstrapParticipantPhaseScopeSchema = z.object({
  kind: z.literal('team-run-bootstrap-participant-phase'),
  teamId: teamIdSchema,
  participantId: participantIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  expectedPhase: z.enum(['invited', 'provisioning'] as const),
  phase: z.enum(['provisioning', 'active'] as const),
}).strict().superRefine(topologyPhaseScope)

/** Parse an exact TeamRun bootstrap opening of the default human/coordinator channel. */
const teamRunBootstrapChannelOpenScopeSchema = z.object({
  kind: z.literal('team-run-bootstrap-channel-open'),
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  humanId: participantIdSchema,
  coordinatorId: participantIdSchema,
  adapter: teamAdapterRefSchema,
  viewPolicy: teamViewPolicyRefSchema.optional(),
  participants: z.array(channelParticipantSchema),
  limits: jsonObjectSchema,
}).strict().refine(scope => scope.humanId !== scope.coordinatorId, {
  message: 'bootstrap channel scope must name distinct human and coordinator participants',
})

/** Parse an exact TeamRun invitation of one coordinator-selected worker. */
const teamRunWorkerInviteScopeSchema = z.object({
  kind: z.literal('team-run-worker-invite'),
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  participant: topologyParticipantSchema,
}).strict().refine(scope => scope.participant.kind === 'local-agent' && isWorkerTopologyRole(scope.participant.role), {
  message: 'worker invitation scope must name a local worker participant',
})

/** Parse an exact TeamRun activation of one worker-pool participant. */
const teamRunWorkerActivateScopeSchema = z.object({
  kind: z.literal('team-run-worker-activate'),
  teamId: teamIdSchema,
  participantId: participantIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  expectedPhase: z.enum(['invited', 'provisioning'] as const),
  phase: z.enum(['provisioning', 'active'] as const),
}).strict().superRefine(topologyPhaseScope)

/** Parse an exact TeamRun retirement of one idle worker-pool participant. */
const teamRunWorkerRetireScopeSchema = z.object({
  kind: z.literal('team-run-worker-retire'),
  teamId: teamIdSchema,
  participantId: participantIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  expectedPhase: z.enum(['invited', 'provisioning', 'active'] as const),
  phase: z.literal('left'),
}).strict()

/** Parse an exact TeamRun invitation of one lazily provisioned reviewer. */
const teamRunReviewerInviteScopeSchema = z.object({
  kind: z.literal('team-run-reviewer-invite'),
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  participant: topologyParticipantSchema,
}).strict()

/** Parse an exact TeamRun phase transition for one lazily provisioned reviewer. */
const teamRunReviewerPhaseScopeSchema = z.object({
  kind: z.literal('team-run-reviewer-phase'),
  teamId: teamIdSchema,
  participantId: participantIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  expectedPhase: z.enum(['invited', 'provisioning'] as const),
  phase: z.enum(['provisioning', 'active'] as const),
}).strict().superRefine(topologyPhaseScope)

/** Parse the closed TeamRun topology operation selected by one system proof. */
export const teamSystemTopologyScopeSchema = z.discriminatedUnion('kind', [
  teamRunBootstrapParticipantInviteScopeSchema,
  teamRunBootstrapParticipantPhaseScopeSchema,
  teamRunBootstrapChannelOpenScopeSchema,
  teamRunWorkerInviteScopeSchema,
  teamRunWorkerActivateScopeSchema,
  teamRunWorkerRetireScopeSchema,
  teamRunReviewerInviteScopeSchema,
  teamRunReviewerPhaseScopeSchema,
]) satisfies z.ZodType<TeamSystemTopologyScope>

/** Parse one detached source attribution resolved from a runtime-only topology proof. */
export const teamSystemTopologyProofResolutionSchema = z.object({
  sourceName: teamSystemTopologyProofSourceNameSchema,
  scope: teamSystemTopologyScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemTopologyProofResolution>

/** Parse one stable scheduler channel proof-source registration name. */
export const teamSystemSchedulerChannelProofSourceNameSchema = trimmedNameSchema

/** Parse an exact scheduler participant-review consult channel opening scope. */
const schedulerReviewChannelOpenScopeSchema = z.object({
  kind: z.literal('scheduler-review-channel-open'),
  teamId: teamIdSchema,
  expectedTeamCursor: nonNegativeSafeIntegerSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  attemptId: taskAttemptIdSchema,
  initiatorId: participantIdSchema,
  reviewerId: participantIdSchema,
  reviewerActivationId: activationIdSchema,
  reviewerSessionId: sessionIdSchema,
  reviewerProvider: trimmedNameSchema,
}).strict().refine(scope => scope.initiatorId !== scope.reviewerId, {
  message: 'scheduler review channel scope must name distinct initiator and reviewer participants',
})

/** Parse an exact scheduler task-assignment wake channel opening scope. */
const schedulerWakeChannelOpenScopeSchema = z.object({
  kind: z.literal('scheduler-wake-channel-open'),
  teamId: teamIdSchema,
  expectedTeamCursor: nonNegativeSafeIntegerSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  participantId: participantIdSchema,
  activationId: activationIdSchema,
  sessionId: sessionIdSchema,
}).strict()

/** Parse an exact scheduler cleanup of a wake channel whose assignment did not commit. */
const schedulerFailedWakeChannelCloseScopeSchema = z.object({
  kind: z.literal('scheduler-failed-wake-channel-close'),
  teamId: teamIdSchema,
  taskId: teamTaskIdSchema,
  participantId: participantIdSchema,
  activationId: activationIdSchema,
  sessionId: sessionIdSchema,
  channelId: channelIdSchema,
  expectedChannelCursor: nonNegativeSafeIntegerSchema,
  reason: z.literal('Task assignment did not commit'),
}).strict()

/** Parse an exact scheduler expiry of a bounded due-delivery channel batch. */
const schedulerChannelDeliveryExpireScopeSchema = z.object({
  kind: z.literal('scheduler-channel-delivery-expire'),
  teamId: teamIdSchema,
  channelId: channelIdSchema,
  expectedTeamCursor: nonNegativeSafeIntegerSchema,
  expectedChannelCursor: nonNegativeSafeIntegerSchema,
  now: nonNegativeSafeIntegerSchema,
  limit: positiveSafeIntegerSchema,
}).strict()

/** Parse the closed scheduler channel operation selected by one system proof. */
export const teamSystemSchedulerChannelScopeSchema = z.discriminatedUnion('kind', [
  schedulerReviewChannelOpenScopeSchema,
  schedulerWakeChannelOpenScopeSchema,
  schedulerFailedWakeChannelCloseScopeSchema,
  schedulerChannelDeliveryExpireScopeSchema,
]) satisfies z.ZodType<TeamSystemSchedulerChannelScope>

/** Parse one detached source attribution resolved from a runtime-only scheduler channel proof. */
export const teamSystemSchedulerChannelProofResolutionSchema = z.object({
  sourceName: teamSystemSchedulerChannelProofSourceNameSchema,
  scope: teamSystemSchedulerChannelScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemSchedulerChannelProofResolution>

/** Parse one stable system cancellation-cleanup proof-source registration name. */
export const teamSystemCancellationCleanupProofSourceNameSchema = trimmedNameSchema

/** Parse an exact TeamRun post-release pending-task cancellation cleanup scope. */
const teamRunCancellationTaskCleanupScopeSchema = z.object({
  kind: z.literal('team-run-cancellation-task-cancel'),
  teamId: teamIdSchema,
  cancellationIdempotencyKey: teamClosureIdempotencyKeySchema,
  cancellationRequestedAt: nonNegativeSafeIntegerSchema,
  expectedTeamCursor: nonNegativeSafeIntegerSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
}).strict()

/** Parse an exact TeamRun post-release channel cancellation cleanup scope. */
const teamRunCancellationChannelCleanupScopeSchema = z.object({
  kind: z.literal('team-run-cancellation-channel-close'),
  teamId: teamIdSchema,
  cancellationIdempotencyKey: teamClosureIdempotencyKeySchema,
  cancellationRequestedAt: nonNegativeSafeIntegerSchema,
  expectedTeamCursor: nonNegativeSafeIntegerSchema,
  channelId: channelIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  reason: nonEmptyStringSchema,
}).strict()

/** Parse the closed TeamRun post-release cancellation cleanup operation selected by one system proof. */
export const teamSystemCancellationCleanupScopeSchema = z.discriminatedUnion('kind', [
  teamRunCancellationTaskCleanupScopeSchema,
  teamRunCancellationChannelCleanupScopeSchema,
]) satisfies z.ZodType<TeamSystemCancellationCleanupScope>

/** Parse one detached source attribution resolved from a runtime-only cancellation-cleanup proof. */
export const teamSystemCancellationCleanupProofResolutionSchema = z.object({
  sourceName: teamSystemCancellationCleanupProofSourceNameSchema,
  scope: teamSystemCancellationCleanupScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemCancellationCleanupProofResolution>

/** Parse one stable system finalization-cleanup proof-source registration name. */
export const teamSystemFinalizationCleanupProofSourceNameSchema = trimmedNameSchema

/** Parse an exact TeamRun post-release channel closure after a durably accepted final result. */
const teamRunFinalizationChannelCleanupScopeSchema = z.object({
  kind: z.literal('team-run-finalization-channel-close'),
  teamId: teamIdSchema,
  finalChannelId: channelIdSchema,
  finalEnvelopeId: envelopeIdSchema,
  humanId: participantIdSchema,
  coordinatorId: participantIdSchema,
  expectedTeamCursor: nonNegativeSafeIntegerSchema,
  channelId: channelIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  reason: nonEmptyStringSchema,
}).strict().refine(scope => scope.humanId !== scope.coordinatorId, {
  message: 'finalization-cleanup scope must name distinct human and coordinator participants',
})

/** Parse the closed TeamRun post-release finalization cleanup operation selected by one system proof. */
export const teamSystemFinalizationCleanupScopeSchema = (
  teamRunFinalizationChannelCleanupScopeSchema
) satisfies z.ZodType<TeamSystemFinalizationCleanupScope>

/** Parse one detached source attribution resolved from a runtime-only finalization-cleanup proof. */
export const teamSystemFinalizationCleanupProofResolutionSchema = z.object({
  sourceName: teamSystemFinalizationCleanupProofSourceNameSchema,
  scope: teamSystemFinalizationCleanupScopeSchema,
}).strict() satisfies z.ZodType<TeamSystemFinalizationCleanupProofResolution>

/** Parse JSON-only channel-WAL cursor watch fields after a provider omits any local cancellation signal. */
export const channelWatchRequestSchema = z.object({
  channelId: channelIdSchema,
  afterCursor: observedCursorSchema,
}).strict() satisfies z.ZodType<ChannelWatchRequest>

/** Parse the outcome of a channel-WAL cursor watch. */
export const channelWatchResultSchema: z.ZodType<ChannelWatchResult> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('changed'), cursor: nonNegativeSafeIntegerSchema }).strict(),
  z.object({ kind: z.literal('closed') }).strict(),
])

/** Parse one adapter-owned record draft. */
export const channelAdapterRecordDraftSchema = z.object({
  payload: jsonObjectSchema,
}).strict() satisfies z.ZodType<ChannelAdapterRecordDraft>

/** Parse a closed Team policy hook. */
export const teamPolicyHookSchema = z.enum([
  'register', 'invite', 'activate', 'channel-open', 'send', 'human-action', 'usage', 'dispatch', 'goal-mutate', 'task-mutate', 'task-assign', 'interrupt', 'workspace-allocate', 'workspace-integrate', 'close',
] as const) satisfies z.ZodType<TeamPolicyHook>

/** Parse one stable human proof-source registration name. */
export const teamHumanActorProofSourceNameSchema = trimmedNameSchema

/** Parse one SHA-256 digest binding a human proof to a complete JSON-only mutation input. */
export const teamHumanActorPayloadFingerprintSchema = z.string()
  .regex(/^sha256:[a-f0-9]{64}$/u)
  .transform(value => value as TeamHumanActorPayloadFingerprint)

/** Parse one cursor or revision fence observed before a human mutation proof is minted. */
export const teamHumanActorProofFenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('read') }).strict(),
  z.object({ kind: z.literal('cursor'), cursor: nonNegativeSafeIntegerSchema }).strict(),
  z.object({ kind: z.literal('revision'), revision: positiveSafeIntegerSchema }).strict(),
]) satisfies z.ZodType<TeamHumanActorProofFence>

/** Parse the JSON-only facts that a human proof fingerprint binds. */
export const teamHumanActorProofInputSchema = z.object({
  teamId: teamIdSchema,
  operation: z.union([teamPolicyHookSchema, z.literal('channel-invitation-read'), z.literal('channel-admission-read'), z.literal('channel-list-read'), z.literal('channel-content-read')]),
  fence: teamHumanActorProofFenceSchema,
  payload: jsonValueSchema,
}).strict() satisfies z.ZodType<TeamHumanActorProofInput>

/** Parse one exact active human attribution and payload fence resolved from a runtime proof. */
export const teamHumanActorScopeSchema = z.object({
  teamId: teamIdSchema,
  participantId: participantIdSchema,
  operation: z.union([teamPolicyHookSchema, z.literal('channel-invitation-read'), z.literal('channel-admission-read'), z.literal('channel-list-read'), z.literal('channel-content-read')]),
  payloadFingerprint: teamHumanActorPayloadFingerprintSchema,
  fence: teamHumanActorProofFenceSchema,
}).strict() satisfies z.ZodType<TeamHumanActorScope>

/** Parse one detached source attribution resolved from a runtime-only human proof. */
export const teamHumanActorProofResolutionSchema = z.object({
  sourceName: teamHumanActorProofSourceNameSchema,
  scope: teamHumanActorScopeSchema,
}).strict() satisfies z.ZodType<TeamHumanActorProofResolution>

/** Parse one policy request supplied by a provider. */
export const teamPolicyRequestSchema = z.object({
  hook: teamPolicyHookSchema,
  teamId: teamIdSchema.optional(),
  actorId: participantIdSchema.optional(),
  facts: jsonObjectSchema,
}).strict() as z.ZodType<TeamPolicyRequest>

/** Parse an allow or deny policy decision. */
export const teamPolicyDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('allow') }).strict(),
  z.object({ kind: z.literal('deny'), code: nonEmptyStringSchema, message: nonEmptyStringSchema }).strict(),
]) satisfies z.ZodType<TeamPolicyDecision>

/** Parse a post-commit Team notification. */
export const teamEventSchema: z.ZodType<TeamEvent> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('team/created'), team: teamSnapshotSchema }).strict(),
  z.object({ type: z.literal('team/changed'), team: teamSnapshotSchema }).strict(),
  z.object({
    type: z.literal('goal/changed'),
    goal: teamGoalSnapshotSchema,
    cursor: nonNegativeSafeIntegerSchema,
    createdAt: nonNegativeSafeIntegerSchema,
  }).strict(),
  z.object({
    type: z.literal('participant/changed'),
    participant: participantSnapshotSchema,
    cursor: nonNegativeSafeIntegerSchema,
    createdAt: nonNegativeSafeIntegerSchema,
  }).strict(),
  z.object({
    type: z.literal('activation/changed'),
    binding: activationBindingSnapshotSchema,
    cursor: nonNegativeSafeIntegerSchema,
    createdAt: nonNegativeSafeIntegerSchema,
  }).strict(),
  z.object({
    type: z.literal('participant-interrupt/changed'),
    interrupt: participantInterruptSnapshotSchema,
    cursor: nonNegativeSafeIntegerSchema,
    createdAt: nonNegativeSafeIntegerSchema,
  }).strict(),
  z.object({
    type: z.literal('human-action/changed'),
    action: teamHumanActionSnapshotSchema,
    cursor: nonNegativeSafeIntegerSchema,
    createdAt: nonNegativeSafeIntegerSchema,
  }).strict(),
  z.object({
    type: z.literal('usage/changed'),
    teamId: teamIdSchema,
    usage: teamUsageSnapshotSchema,
    cursor: nonNegativeSafeIntegerSchema,
    createdAt: nonNegativeSafeIntegerSchema,
  }).strict(),
  z.object({
    type: z.literal('workflow-plan/changed'),
    plan: teamWorkflowPlanSnapshotSchema,
    cursor: nonNegativeSafeIntegerSchema,
    createdAt: nonNegativeSafeIntegerSchema,
  }).strict(),
  z.object({
    type: z.literal('task/changed'),
    task: teamTaskSnapshotSchema,
    cursor: nonNegativeSafeIntegerSchema,
    createdAt: nonNegativeSafeIntegerSchema,
  }).strict(),
  z.object({ type: z.literal('workspace/observed'), observation: teamWorkspaceObservationSchema,
    cursor: nonNegativeSafeIntegerSchema, createdAt: nonNegativeSafeIntegerSchema }).strict(),
  z.object({
    type: z.literal('workspace-allocation/changed'),
    allocation: teamWorkspaceAllocationSnapshotSchema,
    cursor: nonNegativeSafeIntegerSchema,
    createdAt: nonNegativeSafeIntegerSchema,
  }).strict(),
  z.object({
    type: z.literal('policy/denied'),
    teamId: teamIdSchema,
    hook: teamPolicyHookSchema,
    actorId: participantIdSchema.optional(),
    code: nonEmptyStringSchema,
    message: nonEmptyStringSchema,
    cursor: nonNegativeSafeIntegerSchema,
    createdAt: nonNegativeSafeIntegerSchema,
  }).strict(),
])

/** Parse a Team-scoped final-result retry identity. */
export const teamFinalAdmissionIdempotencyKeySchema = z.string().trim().min(1).max(256)
  .transform(value => value as TeamFinalAdmissionIdempotencyKey)

/** Parse a canonical final-content SHA-256 fingerprint. */
export const teamFinalContentFingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
  .transform(value => value as TeamFinalContentFingerprint)

const teamFinalAdmissionSelectionFields = {
  teamId: teamIdSchema,
  channelId: channelIdSchema,
  envelopeId: envelopeIdSchema,
  envelopeSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  contentFingerprint: teamFinalContentFingerprintSchema,
  idempotencyKey: teamFinalAdmissionIdempotencyKeySchema,
}

/** Parse an exact durable final selection without its runtime proof. */
export const teamFinalAdmissionInputSchema = z.object(teamFinalAdmissionSelectionFields)
  .strict() satisfies z.ZodType<TeamFinalAdmissionInput>

/** Parse durable acceptance by the closed TeamRun result sink. */
export const teamFinalAdmissionSchema = z.object({
  ...teamFinalAdmissionSelectionFields,
  sink: z.enum(['team-run-result', 'principal-inbox']),
  inboxSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  recipientId: participantIdSchema,
  owner: teamParticipantOwnerSchema,
  admittedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict().refine(value => value.sink === 'principal-inbox'
  ? value.owner.kind === 'product-principal' && value.inboxSequence !== undefined
  : value.owner.kind === 'system' && value.inboxSequence === undefined,
{ message: 'final sink must match its human owner and inbox position' }) satisfies z.ZodType<TeamFinalAdmission>

/** Parse actor-free principal inbox pagination. */
export const teamHumanInboxReadInputSchema = z.object({
  afterCursor: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict()
/** Parse a principal-wide display acknowledgement. */
export const teamHumanInboxAcknowledgeInputSchema = z.object({
  throughCursor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict()
/** Parse exact durable content admitted to a principal inbox. */
export const teamHumanFinalInputSchema = teamFinalAdmissionInputSchema.extend({
  principalId: nonEmptyStringSchema.transform(value => value as import('@clocky/clocky-product-principal').ProductPrincipalId),
  recipientId: participantIdSchema,
  text: z.string().min(1),
})
/** Parse one retained final delivery and its inbox sequence. */
export const teamHumanInboxFinalSchema = teamHumanFinalInputSchema.extend({ kind: z.literal('final'), sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })
/** Parse an exact ordinary Envelope admitted to a principal without a Session. */
export const teamHumanMessageInputSchema = z.object({
  principalId: nonEmptyStringSchema.transform(value => value as import('@clocky/clocky-product-principal').ProductPrincipalId),
  recipientId: participantIdSchema, teamId: teamIdSchema, channelId: channelIdSchema, envelopeId: envelopeIdSchema,
  envelope: teamEnvelopeSchema, view: teamChannelViewEventDataSchema.optional(), text: z.string(),
}).strict().refine(value => value.envelope.kind !== 'final' && value.envelope.teamId === value.teamId
  && value.envelope.channelId === value.channelId && value.envelope.id === value.envelopeId,
{ message: 'human message must preserve its exact non-final Envelope identity' })
/** Parse a durable ordinary message and its independent inbox sequence. */
export const teamHumanInboxMessageSchema = teamHumanMessageInputSchema.safeExtend({
  kind: z.literal('message'), sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
})
/** Parse the closed principal inbox delivery union. */
export const teamHumanInboxActionSchema = z.object({ kind: z.literal('action'), sequence: nonNegativeSafeIntegerSchema,
  principalId: nonEmptyStringSchema.transform(value => value as import('@clocky/clocky-product-principal').ProductPrincipalId),
  recipientId: participantIdSchema, teamId: teamIdSchema, action: teamHumanActionSnapshotSchema, text: z.string(),
}).strict().refine(value => value.action.teamId === value.teamId, { message: 'action inbox record must retain its owning Team' })
/** Parse every supported principal delivery kind. */
export const teamHumanInboxItemSchema = z.discriminatedUnion('kind', [teamHumanInboxFinalSchema, teamHumanInboxMessageSchema, teamHumanInboxActionSchema])
/** Parse one exact human delivery source scope independently from its runtime proof. */
export const teamSystemHumanDeliveryScopeSchema = z.object({
  principalId: nonEmptyStringSchema.transform(value => value as import('@clocky/clocky-product-principal').ProductPrincipalId),
  recipientId: participantIdSchema, teamId: teamIdSchema, channelId: channelIdSchema, envelopeId: envelopeIdSchema,
  expectedCursor: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER),
}).strict()
/** Parse a bounded inbox projection without treating display as delivery receipt. */
export const teamHumanInboxPageSchema = z.object({
  items: z.array(teamHumanInboxItemSchema), displayCursor: z.number().int().min(-1),
  cursor: z.number().int().min(-1), nextCursor: z.number().int().min(-1).optional(),
}).strict()
/** Parse the durable shared display cursor. */
export const teamHumanInboxAcknowledgementSchema = z.object({ displayCursor: z.number().int().min(-1) }).strict()

/** Parse explicit answer acceptance or failure to recover its continuation. */
export const teamHumanActionResponseResultSchema = z.object({ kind: z.enum(['accepted', 'unavailable']), action: teamHumanActionSnapshotSchema }).strict()

/** Parse one canonical child result content identity. */
export const teamChildResultFingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
  .transform(value => value as import('./child-result-types.ts').TeamChildResultFingerprint)
/** Parse a complete parent-task result receipt, including its source journal position. */
export const teamDelegationResultAdmissionSchema = z.object({
  binding: teamChildRunBindingSchema, requestEnvelopeId: envelopeIdSchema, requestSequence: nonNegativeSafeIntegerSchema,
  responseEnvelopeId: envelopeIdSchema, responseSequence: nonNegativeSafeIntegerSchema,
  contentFingerprint: teamChildResultFingerprintSchema, text: z.string().refine(value => value.trim().length > 0),
  artifacts: z.array(teamArtifactReferenceSchema), parentTaskRevision: positiveSafeIntegerSchema,
  parentCursor: nonNegativeSafeIntegerSchema, admittedAt: nonNegativeSafeIntegerSchema,
}).strict().refine(value => value.requestEnvelopeId !== value.responseEnvelopeId && value.requestSequence < value.responseSequence
  && value.artifacts.every(artifact => artifact.visibility !== 'private'),
{ message: 'child result must follow its request and cannot publish private artifacts' })
/** Parse the child-side copy of the independently committed parent sink admission. */
export const teamChildResultAdmissionSchema = z.object({
  parent: teamDelegationResultAdmissionSchema, admittedAt: nonNegativeSafeIntegerSchema,
}).strict().refine(value => value.admittedAt >= value.parent.admittedAt, { message: 'child result cannot precede parent acceptance' })
/** Parse a parent task's exact child response selection. */
export const teamTaskDelegationResultAdmitInputSchema = z.object({
  teamId: teamIdSchema, taskId: teamTaskIdSchema, expectedCursor: nonNegativeSafeIntegerSchema,
  expectedRevision: positiveSafeIntegerSchema, delegationId: teamDelegationIdSchema,
  childTeamId: teamIdSchema, responseEnvelopeId: envelopeIdSchema,
}).strict()
/** Parse complete child-result or missing-response owner scopes. */
export const teamSystemChildResultScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('child-result-complete'), binding: teamChildRunBindingSchema,
    admission: teamDelegationResultAdmissionSchema, expectedCursor: nonNegativeSafeIntegerSchema }).strict(),
  z.object({ kind: z.literal('child-result-missing'), binding: teamChildRunBindingSchema, expectedCursor: nonNegativeSafeIntegerSchema,
    activationId: activationIdSchema, sessionId: sessionIdSchema,
    provider: nonEmptyStringSchema, turn: nonNegativeSafeIntegerSchema }).strict(),
])
/** Parse actor-free child result command routing. */
export const teamChildResultCommandInputSchema = z.object({
  childTeamId: teamIdSchema, expectedCursor: nonNegativeSafeIntegerSchema,
}).strict()
/** Parse child cancellation separately from its provider-owned capability. */
export const teamChildCancelInputSchema = teamChildResultCommandInputSchema.extend({
  idempotencyKey: teamClosureIdempotencyKeySchema, reason: teamStallReasonSchema,
})

/** Public summary bounds, without lifecycle implementation settings. */
export const channelSummaryCapabilitiesSchema = z.object({
  allowedPolicies: z.array(z.string().min(1)).min(1),
  maxSourceEnvelopes: z.number().int().positive(),
  maxSourceBytes: z.number().int().positive(),
  maxSummaryBytes: z.number().int().positive(),
  maxHistorySpan: z.number().int().positive(),
}).strict() satisfies z.ZodType<import('./types.ts').ChannelSummaryCapabilities>

/** Discovery of accepting protocol and view-policy registrations. */
export const teamChannelCatalogSchema = z.object({
  adapters: z.array(teamAdapterRefSchema),
  viewPolicies: z.array(teamViewPolicyRefSchema),
  summary: channelSummaryCapabilitiesSchema.optional(),
}).strict() satisfies z.ZodType<import('./types.ts').TeamChannelCatalog>
