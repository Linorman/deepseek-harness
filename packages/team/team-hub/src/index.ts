import { projectMemberInspection } from '@clocky/clocky-team/selection'
import { teamMemberInspectRequestSchema, type TeamMemberInspectRequest, type TeamMemberInspectSpec, type TeamMemberInspection } from '@clocky/clocky-team'
import { projectWorkflowInspection } from '@clocky/clocky-team/selection'
import { teamWorkflowInspectRequestSchema, type TeamWorkflowInspectRequest, type TeamWorkflowInspection } from '@clocky/clocky-team'
import { projectHumanAction } from '@clocky/clocky-team/selection'
import { teamHumanActionReadRequestSchema, type TeamHumanActionReadRequest } from '@clocky/clocky-team'
import { teamSelectionRequestSchema, type TeamSelectionRequest } from '@clocky/clocky-team'
import { projectTaskInspection } from '@clocky/clocky-team/selection'
import { teamTaskInspectRequestSchema, type TeamTaskInspectRequest, type TeamTaskInspectSpec, type TeamTaskInspection } from '@clocky/clocky-team'
import { projectTeamBrowse } from '@clocky/clocky-team/selection'
import { teamBrowseRequestSchema, type TeamBrowseRequest, type TeamBrowseSpec, type TeamBrowsePage } from '@clocky/clocky-team'
import { projectMemberSession } from '@clocky/clocky-team/selection'
import { teamMemberSessionRequestSchema, type TeamMemberSessionRequest, type TeamMemberSessionSnapshot } from '@clocky/clocky-team'
import { teamSelection } from './selection.ts'
import type { TeamSelectionSnapshot } from '@clocky/clocky-team'
import { AsyncLocalStorage } from 'node:async_hooks'
import { StorageLogError } from '@clocky/clocky-storage-log'
import type { LogNameScanCursor } from '@clocky/clocky-storage-log'
import { teamDiscoveryCursorSchema } from '@clocky/clocky-team'
import { activationReservationInputSchema, liveActivationCapacity, liveActivationLimit, taskLiveActivationReservation } from '@clocky/clocky-team'
import type { ActivationReservationRequest, ActivationReservationSnapshot } from '@clocky/clocky-team'
import { channelHumanEnvelopeGetInputSchema, channelHumanAdmissionSnapshotSchema, channelProtocolStatusSchema } from '@clocky/clocky-team/schema'
import type { ChannelExpectedNext, ChannelHumanAdmissionSnapshot, ChannelProtocolStatus } from '@clocky/clocky-team'
import type { TeamChannelListInput, TeamChannelListRequest, TeamChannelListPage } from '@clocky/clocky-team'
import { teamChannelListInputSchema, teamChannelListPageSchema } from '@clocky/clocky-team'
import type { TeamTaskDelegationResultAdmitRequest, TeamDelegationResultAdmission, TeamChildResultAdmission, TeamChildResultCommandRequest, TeamChildCancelRequest, TeamArtifactReference, TeamArtifactGetRequest, TeamArtifactListPage, TeamArtifactListPageRequest } from '@clocky/clocky-team'
import { fingerprintTeamChildResultContent, teamTaskDelegationResultAdmitInputSchema, teamChildResultCommandInputSchema, teamChildCancelInputSchema, teamDelegationResultAdmissionSchema, teamArtifactGetRequestSchema } from '@clocky/clocky-team'
import type { TeamHumanChannelDeliveryRequest, TeamHumanChannelDeliveryResult, TeamHumanMessageInput,
  TeamChildRunBindRequest, TeamChildRunBinding } from '@clocky/clocky-team'
import { teamChildRunBindingSchema } from '@clocky/clocky-team'
import { teamSystemHumanDeliveryScopeSchema } from '@clocky/clocky-team'
import type { ChannelHumanEnvelopeGetRequest, ChannelHumanAdmissionGetRequest, ChannelHumanInvitationGetRequest, ChannelHumanInvitationSnapshot, ChannelActorGetRequest } from '@clocky/clocky-team'
import { channelInvitationExpireInputSchema, channelInvitationAcknowledgeInputSchema, channelAdmissionSnapshotSchema, fingerprintChannelManifest } from '@clocky/clocky-team'
import type { ChannelAdmissionSnapshot, ChannelInvitationExpireRequest, TeamSystemChannelAdmissionProof, ChannelInvitationSnapshot, ChannelInvitationAcknowledgeRequest, ChannelInvitationOptions } from '@clocky/clocky-team'
import { prepareChannelEnvelopeRecord } from './fold.ts'
import { teamWorkspaceObservationInputSchema } from '@clocky/clocky-team'
import type { TeamWorkspaceObservationRequest, TeamWorkspaceObservation } from '@clocky/clocky-team'
import { projectWorkspaceObservation } from './workspace-observation.ts'
import { matchesTaskPlacement, teamTaskPlacementSchema } from '@clocky/clocky-team'
import type { TeamTaskPlacement } from '@clocky/clocky-team'
/**
 * Authoritative local Team provider. It owns durable Team journals and channel
 * WALs without importing Agent, Session, AgentLoop, or experimental Team code.
 * @module @clocky/clocky-team-hub
 */

import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { teamWorkspaceAllocationLossInputSchema } from '@clocky/clocky-team'
import type { TeamWorkspaceAllocationLossRequest } from '@clocky/clocky-team'
import { teamTaskExecutionSchema, teamDelegationIdSchema } from '@clocky/clocky-team'
import type { TeamTaskExecution } from '@clocky/clocky-team'
import { taskHasActiveExecution, taskHasSharedWriteConflict, taskConcurrencyUsage, taskChildTeamReservation } from '@clocky/clocky-team'
import {
  teamTaskDelegationBeginInputSchema, teamTaskDelegationBindInputSchema, teamTaskDelegationSettleInputSchema,
  teamTaskDelegationStallInputSchema, teamChildRunAuthorizeInputSchema,
} from '@clocky/clocky-team'
import type {
  TeamTaskDelegationSnapshot, TeamTaskDelegationInput, TeamSystemDelegationProof, TeamSystemDelegationScope,
  TeamTaskDelegationBeginRequest, TeamTaskDelegationBindRequest, TeamTaskDelegationSettleRequest,
  TeamTaskDelegationStallRequest, TeamChildRunAuthorizeRequest, TeamChildRunAuthorization, TeamChildRunScope,
} from '@clocky/clocky-team'
import {
  TeamError,
  TeamRuntime,
  fingerprintTeamHumanActorPayload,
  fingerprintTeamFinalContent,
  teamFinalAdmissionInputSchema,
  teamFinalAdmissionIdempotencyKeySchema,
  assertTeamGoalPhaseTransition,
  activationBindInputSchema,
  activationFenceInputSchema,
  activationGetRequestSchema,
  activationRecoverySnapshotSchema,
  activationStatusUpdateInputSchema,
  channelAdapterRecordDraftSchema,
  channelCloseInputSchema,
  schedulerReviewChannelOpenInputSchema,
  schedulerWakeChannelOpenInputSchema,
  schedulerFailedWakeChannelCloseInputSchema,
  schedulerChannelDeliveryExpireInputSchema,
  teamCancellationChannelCloseInputSchema,
  teamFinalizationChannelCloseInputSchema,
  channelOpenInputSchema,
  channelDeliveryClaimInputSchema,
  channelDeliveryClaimSchema,
  channelDeliveryExpireResultSchema,
  channelSummarizeInputSchema,
  channelSummarySelectionInputSchema,
  fingerprintChannelSummarySources,
  channelSummaryHumanProofInput,
  channelSummaryRecordSchema,
  channelEnvelopePostInputSchema,
  channelFinalPostInputSchema,
  channelEnvelopeReceiptInputSchema,
  channelGetRequestSchema,
  channelIdSchema,
  channelPendingDeliveryListRequestSchema,
  channelPendingDeliveryPageSchema,
  teamMemberListPageRequestSchema,
  teamMemberListPageSchema,
  channelReadPageRequestSchema,
  channelReadPageResultSchema,
  channelReadRequestSchema,
  channelReadResultSchema,
  teamChannelCompactInputSchema,
  teamChannelCompactResultSchema,
  teamJournalCompactInputSchema,
  teamJournalCompactResultSchema,
  channelRecordSchema,
  channelReceiptRecordSchema,
  channelSnapshotSchema,
  channelWatchRequestSchema,
  envelopeIdSchema,
  jsonObjectSchema,
  participantIdSchema,
  participantInterruptAcknowledgeInputSchema,
  participantInterruptListPendingInputSchema,
  participantInterruptRequestInputSchema,
  participantInterruptSnapshotSchema,
  participantInviteInputSchema,
  participantPhaseTransitionInputSchema,
  teamCreateRequestSchema,
  teamCancelInputSchema,
  teamClosureContinuationInputSchema,
  teamClosureIdempotencyKeySchema,
  teamCompleteInputSchema,
  teamAuthorityGrantSchema,
  teamArchiveInputSchema,
  teamResumeInputSchema,
  teamAuditReadRequestSchema,
  teamAuditReadResultSchema,
  teamAuditEntrySchema,
  teamEnvelopeDraftSchema,
  teamEnvelopeSchema,
  teamGetRequestSchema,
  teamFailInputSchema,
  teamHumanActionSnapshotSchema,
  teamHumanActionUpsertInputSchema,
  teamHumanActionResolveInputSchema,
  teamUsageRecordInputSchema,
  teamUsageChargeSchema,
  teamUsageChargeIdSchema,
  teamUsageSampleSchema,
  teamUsageRateSchema,
  teamGoalPhaseTransitionInputSchema,
  teamGoalUpdateInputSchema,
  teamIdSchema,
  teamListPageRequestSchema,
  teamListPageSchema,
  teamSnapshotSchema,
  teamInterruptIdSchema,
  teamPhaseTransitionInputSchema,
  teamStateSnapshotSchema,
  teamResourceBudgetSchema,
  taskAttemptIdSchema,
  teamTaskAssignInputSchema,
  teamTaskAttemptExpireInputSchema,
  teamTaskAttemptHeartbeatInputSchema,
  teamTaskAttemptSettleInputSchema,
  teamTaskAttemptStartClaimInputSchema,
  teamTaskAttemptStartInputSchema,
  teamTaskCancelInputSchema,
  teamTaskCancellationReconcileInputSchema,
  teamCancellationTaskCancelInputSchema,
  teamTaskCreateInputSchema,
  teamTaskDeleteInputSchema,
  teamTaskDetailsUpdateInputSchema,
  teamTaskGetRequestSchema,
  teamTaskIdSchema,
  teamTaskListPageRequestSchema,
  teamTaskListPageSchema,
  teamArtifactListPageRequestSchema,
  teamArtifactListPageSchema,
  teamTaskOwnerProposalInputSchema,
  teamTaskReviewResolveInputSchema,
  teamTaskSnapshotSchema,
  teamTaskRankingPolicySchema,
  teamWorkspaceAllocationReserveInputSchema,
  teamWorkspaceAllocationActivateInputSchema,
  teamWorkspaceAllocationReleaseRequestInputSchema,
  teamWorkspaceAllocationPreserveInputSchema,
  teamWorkspaceAllocationReleaseInputSchema,
  teamWatchRequestSchema,
  teamWorkflowPlanAdmissionInputSchema,
  teamWorkflowPlanChannelBindInputSchema,
  teamWorkflowChannelCloseInputSchema,
  teamWorkflowPlanGetRequestSchema,
  teamWorkflowPlanListPageRequestSchema,
  teamWorkflowPlanListPageSchema,
  teamWorkflowPlanPhaseInputSchema,
  teamWorkflowPlanSnapshotSchema,
  teamWorkflowPlanTaskBindInputSchema,
  teamWorkflowPlanIdSchema,
} from '@clocky/clocky-team'
import type {
  ActivationBindRequest,
  ActivationBindInput,
  ActivationBindingSnapshot,
  ActivationId,
  ActivationFenceRequest,
  ActivationFenceInput,
  ActivationQuiesceRequest,
  ActivationGetRequest,
  ActivationStatusUpdateRequest,
  ActivationStatusUpdateInput,
  ChannelCloseInput,
  ChannelCloseRequest,
  SchedulerReviewChannelOpenInput,
  SchedulerReviewChannelOpenRequest,
  SchedulerWakeChannelOpenInput,
  SchedulerWakeChannelOpenRequest,
  SchedulerFailedWakeChannelCloseInput,
  SchedulerFailedWakeChannelCloseRequest,
  SchedulerChannelDeliveryExpireInput,
  SchedulerChannelDeliveryExpireRequest,
  TeamCancellationChannelCloseInput,
  TeamCancellationChannelCloseRequest,
  TeamFinalizationChannelCloseInput,
  TeamFinalizationChannelCloseRequest,
  ChannelDeliveryClaim,
  ChannelDeliveryClaimInput,
  ChannelDeliveryClaimRequest,
  ChannelDeliveryExpireResult,
  ChannelDeliveryExpiredRecord,
  ChannelSummaryRecord,
  ChannelSummarizeRequest,
  ChannelSummarizeInput,
  ChannelSummarySelectionInput,
  ChannelSummarySourceRequest,
  ChannelSummarySource,
  ChannelPendingDeliveryListRequest,
  ChannelPendingDeliveryPage,
  ChannelReadPageRequest,
  ChannelReadPageResult,
  TeamChannelCompactRequest,
  TeamChannelCompactResult,
  TeamJournalCompactRequest,
  TeamJournalCompactResult,
  ChannelPendingEnvelopeDelivery,
  ChannelEnvelopePostActor,
  ChannelEnvelopePostInput,
  ChannelEnvelopePostRequest,
  ChannelFinalPostRequest,
  TeamActorProof,
  TeamSystemActivationProof,
  TeamSystemActivationProofResolution,
  TeamSystemHumanActionProof,
  TeamSystemTaskLeaseProof,
  TeamSystemTaskControlProof,
  TeamSystemTaskControlScope,
  TeamSystemRootCreationProof,
  TeamSystemRootCreationProofResolution,
  TeamSystemChildCreationProof,
  TeamSystemChildCreationProofResolution,
  TeamSystemChannelSummaryProof,
  TeamSystemChannelSummaryProofResolution,
  TeamSystemChannelLifecycleProof,
  TeamSystemChannelLifecycleProofResolution,
  TeamSystemWorkspaceAllocationProof,
  TeamSystemWorkspaceAllocationProofResolution,
  TeamSystemWorkspaceAllocationScope,
  TeamSystemArchiveProof,
  TeamSystemArchiveProofResolution,
  TeamSystemCancellationCleanupProof,
  TeamSystemCancellationCleanupScope,
  TeamSystemFinalizationCleanupProof,
  TeamSystemFinalizationCleanupScope,
  TeamSystemTopologyProof,
  TeamSystemTopologyScope,
  TeamSystemSchedulerChannelProof,
  TeamSystemSchedulerChannelScope,
  TeamSystemWorkflowProof,
  TeamSystemWorkflowScope,
  TeamClosureActor,
  TeamClosureAuthority,
  TeamClosureInput,
  TeamCompleteInput,
  TeamSystemEnvelopePostProof,
  TeamSystemEnvelopePostProofResolution,
  TeamSystemClosureProof,
  TeamSystemClosureProofResolution,
  TeamSystemClosureDriverProof,
  TeamSystemClosureDriverProofResolution,
  TeamSystemClosureDriverScope,
  TeamSystemFinalReceiptProof,
  TeamSystemTaskReviewProof,
  TeamSystemTaskReviewProofResolution,
  ChannelEnvelopeReceiptInput,
  ChannelEnvelopeReceiptRequest,
  ChannelEnvelopeRecord,
  ChannelReceiptRecord,
  ChannelAdapterRecord,
  ChannelAdapterRecordDraft,
  ChannelGetRequest,
  ChannelOpenRequest,
  ChannelOpenInput,
  ChannelReadRequest,
  ChannelReadResult,
  ChannelSnapshot,
  ChannelWatchRequest,
  ChannelWatchResult,
  ChannelManifest,
  ChannelRecord,
  ChannelPhaseRecord,
  JsonObject,
  JsonValue,
  TeamAuditEntry,
  ParticipantInviteInput,
  ParticipantInviteRequest,
  ParticipantInterruptAcknowledgeRequest,
  ParticipantInterruptListPendingRequest,
  ParticipantInterruptRequest,
  ParticipantInterruptRequestInput,
  ParticipantInterruptSnapshot,
  ParticipantInterruptTarget,
  ParticipantPhaseTransitionInput,
  ParticipantPhaseTransitionRequest,
  ParticipantPhase,
  ParticipantSnapshot,
  TeamMemberListPage,
  TeamMemberListPageRequest,
  TeamArchiveInput,
  TeamArchiveRequest,
  TeamHumanResumeAuthorization,
  TeamHumanResumeRequest,
  TeamResumeInput,
  TeamAuditReadRequest,
  TeamAuditReadResult,
  TeamCreateInput,
  TeamCreateRequest,
  TeamChildCreateInput,
  TeamRootCreateInput,
  TeamCancelRequest,
  TeamClosureContinuationRequest,
  TeamFinalAdmissionRequest,
  TeamFinalAdmission,
  TeamCompleteRequest,
  TeamFailRequest,
  TeamClosureSnapshot,
  TeamCancellationSnapshot,
  TeamAuthorityGrant,
  TeamAdapterLease,
  TeamChannelAdapter,
  TeamChannelAdapterRuntimeLease,
  TeamEnvelope,
  TeamEnvelopeDraft,
  TeamEvent,
  TeamErrorCode,
  TeamGetRequest,
  TeamHumanActionResolveInput,
  TeamHumanActionResolveRequest,
  TeamHumanActionSnapshot,
  TeamHumanActionUpsertInput,
  TeamHumanActionUpsertRequest,
  TeamUsageRecordRequest,
  TeamUsageCharge,
  TeamUsageSample,
  TeamUsageSnapshot,
  TeamUsageRate,
  TeamResourceBudget,
  TeamStallReason,
  TeamPolicyHook,
  TeamGoalPhaseTransitionRequest,
  TeamGoalPhaseTransitionInput,
  TeamGoalSnapshot,
  TeamGoalUpdateRequest,
  TeamGoalUpdateInput,
  TeamHumanActorProof,
  TeamHumanActorProofInput,
  TeamHumanActorScope,
  TeamId,
  TeamListPage,
  TeamListPageRequest,
  TeamInterruptId,
  TeamPhaseTransitionRequest,
  TeamSystemPhaseProofResolution,
  TeamSystemPhaseScope,
  TeamSystemInterruptProof,
  TeamSnapshot,
  TeamStateSnapshot,
  TeamMetricsSnapshot,
  TeamViewPolicy,
  TeamViewPolicyLease,
  TaskAttemptId,
  TaskAttemptOutcome,
  TaskAttemptSnapshot,
  TaskLeaseSnapshot,
  TeamTaskAssignRequest,
  TeamTaskAssignInput,
  TeamTaskAttemptExpireRequest,
  TeamTaskAttemptExpireInput,
  TeamTaskAttemptFence,
  TeamTaskAttemptHeartbeatRequest,
  TeamTaskAttemptOwnerFence,
  TeamTaskAttemptStartClaimInput,
  TeamTaskAttemptSettleRequest,
  TeamTaskAttemptStartClaimRequest,
  TeamTaskAttemptStartRequest,
  TeamTaskCancelRequest,
  TeamTaskCancellationSnapshot,
  TeamTaskCancellationReconcileRequest,
  TeamTaskCancelInput,
  TeamCancellationTaskCancelInput,
  TeamCancellationTaskCancelRequest,
  TeamTaskCreateCommand,
  TeamTaskCommandCreator,
  TeamTaskCreateInput,
  TeamTaskCreateRequest,
  TeamTaskCreator,
  TeamTaskDeleteInput,
  TeamTaskDetailsUpdateInput,
  TeamTaskDeleteRequest,
  TeamTaskDetailsUpdateRequest,
  TeamTaskGetRequest,
  TeamTaskId,
  TeamTaskListPage,
  TeamTaskListPageRequest,
  TeamTaskOwnerProposalRequest,
  TeamTaskOwnerProposalInput,
  TeamTaskReviewResolveInput,
  TeamTaskReviewResolveRequest,
  TeamTaskReviewRecoverRequest,
  TeamTaskReviewDecision,
  TeamTaskSnapshot,
  TeamTaskRankingPolicy,
  TeamTaskReviewPolicy,
  TeamTaskIntegrationSpec,
  TeamTaskWorkspaceMode,
  TeamWorkspaceAllocationReserveRequest,
  TeamWorkspaceAllocationReserveInput,
  TeamWorkspaceAllocationActivateRequest,
  TeamWorkspaceAllocationActivateInput,
  TeamWorkspaceAllocationReleaseRequest,
  TeamWorkspaceAllocationReleaseRequestInput,
  TeamWorkspaceAllocationPreserveRequest,
  TeamWorkspaceAllocationPreserveInput,
  TeamWorkspaceAllocationReleaseConfirmRequest,
  TeamWorkspaceAllocationReleaseInput,
  TeamWorkspaceAllocationSnapshot,
  TeamWorkspaceAllocationId,
  TeamWatchRequest,
  TeamWatchResult,
  TeamWorkflowPlanAdmissionRequest,
  TeamWorkflowPlanChannelBindRequest,
  TeamWorkflowPlanChannelBindInput,
  TeamWorkflowPlanGetRequest,
  TeamWorkflowPlanListPageRequest,
  TeamWorkflowPlanListPage,
  TeamWorkflowPlanPhaseRequest,
  TeamWorkflowPlanPhaseInput,
  TeamWorkflowPlanId,
  TeamWorkflowPlanSnapshot,
  TeamWorkflowPlanTaskBindRequest,
  TeamWorkflowPlanTaskBindInput,
  TeamWorkflowChannelCloseInput,
  TeamWorkflowChannelCloseRequest,
  TeamWorkflowPlan,
  TeamWorkflowPlanResult,
  TeamWorkflowTaskBinding,
  TeamWorkflowTaskTemplate,
  TeamWorkflowTaskTemplateId,
  ParticipantId,
  ChannelId,
  EnvelopeId,
} from '@clocky/clocky-team'
import type { StorageLogFacility } from '@clocky/clocky-storage-log'
import { CursorActivity, SerialQueue } from './activity.ts'
import { TeamHubError } from './error.ts'
import { workflowOutcomeRecords, workflowTerminalOutcome } from './workflow-outcomes.ts'
import {
  channelRecordCursor,
  channelProjectionData,
  channelProjectionFromData,
  channelReplayWatermark,
  foldChannelRecord,
  foldTeamRecord,
  assertTaskCancellationSettlements,
  teamProjectionData,
  teamProjectionFromData,
  usageFromSamplesAndCharges,
} from './fold.ts'
import {
  channelProjectionCheckpointSchema,
  teamJournalRecordSchema,
  teamProjectionCheckpointSchema,
} from './schema.ts'
import {
  AUDIT_PROJECTION_FORMAT_VERSION,
  CHANNEL_CHECKPOINT_FORMAT_VERSION,
  CHANNEL_WAL_FORMAT_VERSION,
  TEAM_CHECKPOINT_FORMAT_VERSION,
  TEAM_JOURNAL_FORMAT_VERSION,
} from './types.ts'
import type {
  ChannelProjection,
  ChannelProjectionCheckpoint,
  PendingChannelDelivery,
  ParticipantInterruptAcknowledgedJournalRecord,
  ParticipantInterruptRequestedJournalRecord,
  TeamJournalRecord,
  TeamProjection,
  TeamProjectionCheckpoint,
} from './types.ts'

export { TeamHubError } from './error.ts'
export type { TeamHubErrorCode } from './error.ts'
export {
  AUDIT_PROJECTION_FORMAT_VERSION,
  CHANNEL_CHECKPOINT_FORMAT_VERSION,
  CHANNEL_WAL_FORMAT_VERSION,
  TEAM_CHECKPOINT_FORMAT_VERSION,
  TEAM_JOURNAL_FORMAT_VERSION,
} from './types.ts'

const EMPTY_CURSOR = -1
const DEFAULT_RECOVERY_PAGE_SIZE = 128
const DEFAULT_CHECKPOINT_EVERY = 1
const DEFAULT_AUDIT_RETENTION_TAIL = 128
const DEFAULT_CHANNEL_INVITATION_TIMEOUT_MS = 30_000
const DEFAULT_DISPOSAL_TIMEOUT_MS = 5_000
const DEFAULT_MAX_TEAM_DEPTH = 0
const DEFAULT_MAX_ENVELOPE_BYTES = 65_536
const DEFAULT_MAX_CHANNEL_VIEW_BYTES = 131_072
const DEFAULT_MAX_PENDING_DELIVERIES_PER_CHANNEL = 1_024
const DEFAULT_MAX_PENDING_DELIVERIES_PER_PARTICIPANT = 4_096
const DEFAULT_MAX_PENDING_DELIVERY_PAGE_SIZE = 128
const DEFAULT_MAX_POST_IDEMPOTENCY_ENTRIES_PER_CHANNEL = 1_024
const DEFAULT_MAX_TASK_ATTEMPTS_PER_TASK = 16
const DEFAULT_MAX_TASK_LEASE_DURATION_MS = 3_600_000
const DEFAULT_MAX_PARTICIPANTS_PER_TEAM = 128
const DEFAULT_MAX_ACTIVATIONS_PER_TEAM = 128
const DEFAULT_MAX_TASKS_PER_TEAM = 1_024
const DEFAULT_MAX_CHANNELS_PER_TEAM = 1_024
const DEFAULT_MAX_TURNS_PER_TEAM = 10_000
const DEFAULT_MAX_MODEL_TOKENS_PER_TEAM = 10_000_000
const DEFAULT_MAX_WALL_TIME_MS_PER_TEAM = 86_400_000
const DEFAULT_MAX_COST_UNITS_PER_TEAM = 1_000_000
const DEFAULT_MAX_RETRIES_PER_TEAM = 128
const DEFAULT_MAX_INBOX_ITEMS_PER_PARTICIPANT = 4_096
const DEFAULT_MAX_RATE_PER_PARTICIPANT_PER_MINUTE = 600
const TEAM_RUN_ENVELOPE_POST_PROOF_SOURCE = 'team-run'
const TEAM_SCHEDULER_ENVELOPE_POST_PROOF_SOURCE = 'team-scheduler-dag'
const TEAM_SCHEDULER_TASK_REVIEW_PROOF_SOURCE = 'team-scheduler-dag'
const TEAM_RUN_CLOSURE_PROOF_SOURCE = 'team-run'
const TEAM_RUN_PHASE_PROOF_SOURCE = 'team-run'
const TEAM_SCHEDULER_PHASE_PROOF_SOURCE = 'team-scheduler-dag'
const TEAM_SCHEDULER_MAINTENANCE_PROOF_SOURCE = 'team-scheduler-dag'
const TEAM_RUN_INTERRUPT_PROOF_SOURCE = 'team-run'
const TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE = 'team-activation-controller'
const TEAM_ACTIVATION_RECOVERY_PROOF_SOURCE = 'team-activation-recovery'
const HOST_API_PROXY_HUMAN_ACTION_PROOF_SOURCE = 'host-api-proxy'
const TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE = 'team-scheduler-dag'
const TEAM_SCHEDULER_CHANNEL_PROOF_SOURCE = 'team-scheduler-dag'
const TEAM_RUN_WORKFLOW_PROOF_SOURCE = 'team-run'
const TEAM_RUN_TASK_CONTROL_PROOF_SOURCE = 'team-run'
const TEAM_RUN_CANCELLATION_CLEANUP_PROOF_SOURCE = 'team-run'
const TEAM_RUN_FINALIZATION_CLEANUP_PROOF_SOURCE = 'team-run'
const TEAM_RUN_TOPOLOGY_PROOF_SOURCE = 'team-run'
const DIRECT_CHANNEL_MESSAGE_KIND = 'message'
const TASK_ASSIGNMENT_CHANNEL_ADAPTER = Object.freeze({ type: 'task-assignment', version: 1 })
const TASK_ASSIGNMENT_ENVELOPE_KIND = 'assignment'
const TASK_ASSIGNMENT_ASSIGNEE_ROLE = 'assignee'
const CONSULT_CHANNEL_ADAPTER = Object.freeze({ type: 'consult', version: 1 })
const CONSULT_INITIATOR_ROLE = 'initiator'
const CONSULT_RESPONDENT_ROLE = 'respondent'
const CONSULT_REVIEW_REQUEST_KIND = 'review-request'
const CONSULT_RESPONSE_KIND = 'response'

/** The sole system owner permitted to receipt the default human-facing final. */
const TEAM_RUN_FINAL_RECEIPT_PROOF_SOURCE = 'team-run'
/** The sole system owner permitted to mint proof-owned root Teams. */
const TEAM_RUN_ROOT_CREATION_PROOF_SOURCE = 'team-run'
/** The only future delegation source permitted to create nested Teams. */
const TEAM_CHILD_CREATION_PROOF_SOURCE = 'team-child-delegation'
/** The only future summary source permitted to append durable channel summaries. */
const TEAM_CHANNEL_SUMMARY_PROOF_SOURCE = 'team-channel-summary'
/** The only source namespace accepted by the generic channel lifecycle seam. */
const TEAM_CHANNEL_LIFECYCLE_PROOF_SOURCE = 'team-channel-lifecycle'
/** The sole system owner permitted to archive one locally owned terminal Team. */
const TEAM_RUN_ARCHIVE_PROOF_SOURCE = 'team-run'
/** The product's exact human/coordinator final-answer protocol. */
const DIRECT_CHANNEL_V4_ADAPTER = Object.freeze({ type: 'direct', version: 4 })

type HubLogStream = Awaited<ReturnType<StorageLogFacility['open']>>

/** Deployment-varying Team limits frozen in each creation record. */
type TeamLimitKey =
  | 'maxParticipants'
  | 'maxActivations'
  | 'maxTasks'
  | 'maxChannels'
  | 'maxEnvelopeBytes'
  | 'maxChannelViewBytes'
  | 'maxPendingDeliveriesPerChannel'
  | 'maxPendingDeliveriesPerParticipant'
  | 'maxPendingDeliveryPageSize'
  | 'maxPostIdempotencyEntriesPerChannel'
  | 'maxTaskAttemptsPerTask'
  | 'maxTaskLeaseDurationMs'
  | 'maxTurnsPerTeam'
  | 'maxModelTokensPerTeam'
  | 'maxWallTimeMsPerTeam'
  | 'maxCostUnitsPerTeam'
  | 'maxRetriesPerTeam'
  | 'maxInboxItemsPerParticipant'
  | 'maxRatePerParticipantPerMinute'

interface LoadedTeam {
  readers: number
  readonly id: TeamId
  readonly stream: HubLogStream
  readonly queue: SerialQueue
  activity: CursorActivity
  projection: TeamProjection
  /** Durable cursors occupied only by policy-denial audit records. */
  readonly policyDenialCursors: Set<number>
  invalid: boolean
}

/** Identity and projection available to locked commands and unpublished recovery validation. */
type TeamProjectionOwner = Pick<LoadedTeam, 'id' | 'projection'>

interface LoadedChannel {
  readers: number
  readonly id: ChannelId
  readonly stream: HubLogStream
  readonly queue: SerialQueue
  activity: CursorActivity
  projection: ChannelProjection
  /** Exact retained adapter selected when this channel was opened or recovered. */
  readonly adapterLease: TeamAdapterLease
  /** Adapter wrapper bound to any workflow extensions retained by this channel. */
  readonly adapter: TeamChannelAdapter
  /** Exact retained view policy selected when this channel was opened or recovered. */
  readonly viewPolicyLease?: TeamViewPolicyLease | undefined
  /** Adapter-private implementations retained by this channel's validated protocol. */
  readonly adapterRuntimeLease?: TeamChannelAdapterRuntimeLease | undefined
  invalid: boolean
  /** Shared close-and-release operation for invalidation and Hub disposal. */
  cleanup?: Promise<void>
}

/** Validated channel projection paired with the implementations that retain it. */
interface RecoveredChannel {
  readonly projection: ChannelProjection
  readonly adapterLease: TeamAdapterLease
  readonly adapter: TeamChannelAdapter
  readonly viewPolicyLease?: TeamViewPolicyLease | undefined
  readonly adapterRuntimeLease?: TeamChannelAdapterRuntimeLease | undefined
}

/** Release every channel implementation lease even when an earlier release reports a provider failure. */
function releaseChannelImplementations(
  adapterRuntimeLease: TeamChannelAdapterRuntimeLease | undefined,
  viewPolicyLease: TeamViewPolicyLease | undefined,
  adapterLease: TeamAdapterLease | undefined,
): void {
  try {
    adapterRuntimeLease?.release()
  } finally {
    try {
      viewPolicyLease?.release()
    } finally {
      adapterLease?.release()
    }
  }
}

/** Close failed channel work before releasing its implementations, preserving every failure in order. */
async function closeChannelAfterFailure(
  stream: HubLogStream | undefined,
  error: unknown,
  releaseImplementations: () => void,
  message: string,
): Promise<never> {
  const failures: unknown[] = [error]
  if (stream !== undefined) {
    try {
      await stream.close()
    } catch (closeError: unknown) {
      failures.push(closeError)
    }
  }
  try {
    releaseImplementations()
  } catch (releaseError: unknown) {
    failures.push(releaseError)
  }
  if (failures.length > 1) throw new AggregateError(failures, message)
  throw error
}

/** A newly persisted channel waiting for its owning Team attachment to commit. */
interface CreatedChannel {
  readonly channel: LoadedChannel
  readonly records: readonly ChannelRecord[]
}

/** Sender and runtime proof revalidation retained through one Envelope append. */
interface ResolvedChannelEnvelopePost extends ChannelEnvelopePostInput {
  /** Durable sender derived from the accepted runtime authority. */
  readonly senderId: ParticipantId
  /** Re-resolve the opaque actor against this exact post before the WAL append. */
  revalidate(): ParticipantId
}

/** Receipt recipient and runtime proof revalidation retained through one receipt append. */
interface ResolvedChannelReceiptAuthority {
  /** Recipient derived from the accepted runtime authority. */
  readonly participantId: ParticipantId
  /** Participant actor used for policy only when the receipt came from an activation proof. */
  readonly policyActorId?: ParticipantId | undefined
  /** Re-resolve the opaque actor and require the same recipient before an append. */
  revalidate(): Promise<ParticipantId>
}

/** Receipt recipient plus the authority identity, when policy may attribute it to a participant. */
interface ResolvedReceiptRecipient {
  /** Recipient derived from the accepted runtime authority. */
  readonly participantId: ParticipantId
  /** Activation recipient used as the policy actor; source-scoped system receipts omit it. */
  readonly policyActorId?: ParticipantId | undefined
}

/** Delivery claimant and runtime proof revalidation retained through one claim result. */
interface ResolvedChannelDeliveryClaimAuthority {
  /** Activation binding derived from the accepted runtime authority. */
  readonly binding: ActivationBindingSnapshot
  /** Re-resolve the opaque actor and require the same active binding before use. */
  revalidate(): ActivationBindingSnapshot
}

/** Closure fields after an opaque runtime proof has been reduced to durable attribution. */
type ResolvedTeamClosureInput<T extends TeamClosureInput> = T & {
  /** Serializable attribution derived by the Hub before policy or journal acceptance. */
  readonly actor: TeamClosureActor
}

/** Root creation authority retained only through one policy and journal-admission interval. */
interface RootCreationAuthority {
  /** Source identity derived from the opaque root-creation proof. */
  readonly sourceName: string
  /** Immutable root payload derived from the initial source scope. */
  readonly input: TeamRootCreateInput
  /** Re-resolve the proof and return its exact payload before a Team journal is opened. */
  revalidate(): TeamRootCreateInput
}

/** Nested-Team creation authority retained through one parent queue, policy, and child stream-admission interval. */
interface ChildCreationAuthority {
  /** Source identity derived from the opaque child-creation proof. */
  readonly sourceName: string
  /** Re-resolve the proof and return its exact source scope before a child journal is opened. */
  revalidate(): TeamSystemChildCreationProofResolution['scope']
}

/** Channel summary authority retained through one channel lock and append interval. */
interface ChannelSummaryAuthority {
  /** Source identity derived from the opaque channel-summary proof. */
  readonly sourceName: string
  /** Immutable JSON-only summary input derived from the initial source scope. */
  readonly input: ChannelSummarizeInput
  /** Re-resolve the proof and return its exact summary input before a WAL append. */
  revalidate(): ChannelSummarizeInput
}

/** Channel lifecycle authority retained through one Team/channel lock and append interval. */
interface ChannelLifecycleAuthority {
  /** Source identity derived from the opaque lifecycle proof. */
  readonly sourceName: string
  /** Immutable JSON-only closure input derived from the initial source scope. */
  readonly input: ChannelCloseInput
  /** Re-resolve the proof and return its exact lifecycle scope before a WAL append. */
  revalidate(): Extract<TeamSystemChannelLifecycleProofResolution['scope'], { readonly kind: 'channel-close' }>
}

/** Generic channel-open authority retained through one Team lock and WAL attachment interval. */
interface ChannelOpenLifecycleAuthority {
  /** Source identity derived from the opaque lifecycle proof. */
  readonly sourceName: string
  /** Immutable JSON-only channel-open input derived from the initial source scope. */
  readonly input: ChannelOpenInput
  /** Re-resolve the proof and return its exact generic open scope before WAL attachment. */
  revalidate(): Extract<TeamSystemChannelLifecycleProofResolution['scope'], { readonly kind: 'channel-open' }>
}

/** Terminal archive authority retained only through one policy and journal-admission interval. */
interface ArchiveAuthority {
  /** Source identity derived from the opaque terminal archive proof. */
  readonly sourceName: string
  /** Immutable Team/cursor fields derived from the initial source scope. */
  readonly input: TeamArchiveInput
  /** Re-resolve the proof and return its exact Team/cursor fields before a durable archive append. */
  revalidate(): TeamArchiveInput
}

interface ParticipantRateWindow {
  startAt: number
  count: number
}

interface NormalizedTaskCreate {
  readonly execution: TeamTaskExecution
  readonly placement: TeamTaskPlacement | undefined
  readonly parentTaskId: TeamTaskId | undefined
  readonly workflowPlanId: TeamWorkflowPlanSnapshot['id'] | undefined
  readonly workflowTemplateId: TeamWorkflowTaskTemplateId | undefined
  readonly integration: TeamTaskIntegrationSpec | undefined
  readonly subject: string
  readonly description: string
  readonly blockedBy: readonly TeamTaskId[]
  readonly requiredCapabilities: readonly string[]
  readonly priority: number
  readonly readScopes: readonly string[]
  readonly writeScopes: readonly string[]
  readonly workspaceMode: TeamTaskWorkspaceMode
  readonly budget: JsonObject
  readonly reviewPolicy: TeamTaskReviewPolicy
  readonly maxAttempts: number
}

type ChildDelegationTask = TeamTaskSnapshot & {
  readonly execution: Extract<TeamTaskExecution, { kind: 'child-team' }>
  readonly delegation: TeamTaskDelegationSnapshot
}

/** Resolved immutable root-or-child hierarchy facts for one Team creation. */
type TeamLineage =
  | {
    /** Edge distance from the root Team. */
    readonly depth: 0
    /** Absolute depth cap inherited by the Team subtree. */
    readonly maxTeamDepth: number
  }

  | {
    /** Direct parent Team. */
    readonly parentTeamId: TeamId
    /** Parent task. */
    readonly parentTaskId: TeamTaskId
    /** Edge distance from the root Team. */
    readonly depth: number
    /** Absolute depth cap inherited by the Team subtree. */
    readonly maxTeamDepth: number
  }

/** Whether resolved hierarchy facts describe a child rather than a root Team. */
function isChildLineage(lineage: TeamLineage): lineage is Extract<TeamLineage, { readonly parentTeamId: TeamId }> {
  return 'parentTeamId' in lineage
}

/** Copy the JSON-only payload selected by a root-creation source scope. */
function rootCreationInput(scope: TeamSystemRootCreationProofResolution['scope']): TeamRootCreateInput {
  return {
    goal: structuredClone(scope.goal),
    rules: structuredClone(scope.rules),
    budgets: structuredClone(scope.budgets),
    ...(scope.authorityGrant === undefined ? {} : { authorityGrant: structuredClone(scope.authorityGrant) }),
  }
}

/** Require a source scope to select exactly the JSON payload supplied to root creation. */
function sameRootCreationInput(
  resolved: TeamSystemRootCreationProofResolution,
  input: TeamRootCreateInput,
): boolean {
  return isDeepStrictEqual(rootCreationInput(resolved.scope), input)
}

/** Copy the JSON-only child payload selected by a child-creation source scope. */
function childCreationInput(scope: TeamSystemChildCreationProofResolution['scope']): TeamChildCreateInput {
  return {
    goal: structuredClone(scope.goal),
    rules: structuredClone(scope.rules),
    budgets: structuredClone(scope.budgets),
    parentTeamId: scope.parentTeamId,
    parentTaskId: scope.parentTaskId,
    delegationId: scope.delegationId,
    ...(scope.authorityGrant === undefined ? {} : { authorityGrant: structuredClone(scope.authorityGrant) }),
  }
}

/** Require a source scope to select exactly the child payload supplied to creation. */
function sameChildCreationInput(
  resolved: TeamSystemChildCreationProofResolution,
  input: TeamChildCreateInput,
): boolean {
  return isDeepStrictEqual(childCreationInput(resolved.scope), input)
}

/** Copy the JSON-only channel summary fields selected by a summary source scope. */
function channelSummaryInput(
  scope: TeamSystemChannelSummaryProofResolution['scope'],
): ChannelSummarizeInput {
  return {
    channelId: scope.channelId,
    expectedCursor: scope.expectedCursor,
    coveredSequenceRange: { ...scope.coveredSequenceRange },
    sourceEnvelopeIds: [...scope.sourceEnvelopeIds],
    sourceFingerprint: scope.sourceFingerprint,
    text: scope.text,
    policy: { ...scope.policy },
    idempotencyKey: scope.idempotencyKey,
  }
}

/** Require a source scope to select exactly the channel summary supplied to admission. */
function sameChannelSummaryInput(
  resolved: TeamSystemChannelSummaryProofResolution,
  input: ChannelSummarizeInput,
): boolean {
  return isDeepStrictEqual(channelSummaryInput(resolved.scope), input)
}

/** Copy the JSON-only channel closure fields selected by a lifecycle source scope. */
function channelCloseInput(
  scope: Extract<TeamSystemChannelLifecycleProofResolution['scope'], { readonly kind: 'channel-close' }>,
): ChannelCloseInput {
  return {
    channelId: scope.channelId,
    expectedCursor: scope.expectedCursor,
    ...(scope.reason === undefined ? {} : { reason: scope.reason }),
  }
}

/** Require a lifecycle source scope to select exactly the JSON closure payload supplied to admission. */
function sameChannelCloseInput(
  resolved: TeamSystemChannelLifecycleProofResolution,
  input: ChannelCloseInput,
): boolean {
  return resolved.scope.kind === 'channel-close'
    && isDeepStrictEqual(channelCloseInput(resolved.scope), input)
}

/** Copy the JSON-only channel-open fields selected by a generic lifecycle source scope. */
function channelOpenInput(
  scope: Extract<TeamSystemChannelLifecycleProofResolution['scope'], { readonly kind: 'channel-open' }>,
): ChannelOpenInput {
  return {
    ...scope.invitations === undefined ? {} : { invitations: structuredClone(scope.invitations) },
    teamId: scope.teamId,
    expectedCursor: scope.expectedCursor,
    adapter: { ...scope.adapter },
    ...(scope.viewPolicy === undefined ? {} : { viewPolicy: { ...scope.viewPolicy } }),
    participants: scope.participants.map(participant => ({ ...participant })),
    limits: structuredClone(scope.limits),
  }
}

/** Require a lifecycle source scope to select exactly the generic channel-open payload supplied to admission. */
function sameChannelOpenInput(
  resolved: TeamSystemChannelLifecycleProofResolution,
  input: ChannelOpenInput,
): boolean {
  return resolved.scope.kind === 'channel-open'
    && isDeepStrictEqual(channelOpenInput(resolved.scope), input)
}

/** Copy the JSON-only terminal archive fields selected by an archive source scope. */
function archiveInput(scope: TeamSystemArchiveProofResolution['scope']): TeamArchiveInput {
  return {
    teamId: scope.teamId,
    expectedCursor: scope.expectedCursor,
  }
}

/** Require an archive source scope to select exactly the Team/cursor supplied to archive. */
function sameArchiveInput(
  resolved: TeamSystemArchiveProofResolution,
  input: TeamArchiveInput,
): boolean {
  return isDeepStrictEqual(archiveInput(resolved.scope), input)
}

/** Whether a Team participant kind can own an activation epoch. */
function isAgentParticipant(participant: ParticipantSnapshot): boolean {
  return participant.kind === 'local-agent' || participant.kind === 'remote-agent'
}

/** Whether a channel projection can no longer accept another WAL record. */
function isTerminalChannelPhase(phase: ChannelPhaseRecord['phase']): boolean {
  return phase === 'closed' || phase === 'expired' || phase === 'failed'
}

/** Configurable Team-Hub durability, hierarchy, task, and shutdown limits. */
export interface Config {
  /** Maximum UTF-8 bytes in the complete first-selection response. */
  readonly maxSelectionBytes?: number
  /** Maximum bytes of atomic Team discovery metadata, including its storage header. */
  readonly maxDiscoveryBytes?: number
  /** Maximum UTF-8 bytes in each first-selection display field. */
  readonly maxSelectionTextBytes?: number
  /** Milliseconds allowed for a newly invited endpoint to confirm its manifest. */
  readonly channelInvitationTimeoutMs?: number
  /** Maximum number of durable records replayed in one storage page. */
  readonly recoveryPageSize?: number
  /** Persist a projection checkpoint after each multiple of this record count. */
  readonly checkpointEvery?: number
  /** Number of audit entries retained at the end of a compacted Team or channel projection. */
  readonly auditRetentionTail?: number
  /** Maximum milliseconds allowed to settle accepted operations during disposal. */
  readonly disposalTimeoutMs?: number
  /** Maximum nested-Team depth; zero permits root Teams only. */
  readonly maxTeamDepth?: number
  /** Maximum UTF-8 bytes in one complete Hub-stamped channel Envelope. */
  readonly maxEnvelopeBytes?: number
  /** Maximum UTF-8 bytes in one model-facing rendered channel view. */
  readonly maxChannelViewBytes?: number
  /** Maximum unacknowledged recipient deliveries retained by one channel WAL. */
  readonly maxPendingDeliveriesPerChannel?: number
  /** Maximum unacknowledged deliveries retained for one channel participant. */
  readonly maxPendingDeliveriesPerParticipant?: number
  /** Maximum pending deliveries returned by one recipient page. */
  readonly maxPendingDeliveryPageSize?: number
  /** Maximum sender-scoped post retry keys retained by one channel. */
  readonly maxPostIdempotencyEntriesPerChannel?: number
  /** Maximum durable attempts that one task may retain, including a current lease. */
  readonly maxTaskAttemptsPerTask?: number
  /** Maximum fixed duration accepted for one task attempt lease. */
  readonly maxTaskLeaseDurationMs?: number
  /** Maximum durable participants admitted to one Team. */
  readonly maxParticipantsPerTeam?: number
  /** Maximum activation epochs retained by one Team. */
  readonly maxActivationsPerTeam?: number
  /** Maximum task records retained by one Team. */
  readonly maxTasksPerTeam?: number
  /** Maximum channel records attached to one Team. */
  readonly maxChannelsPerTeam?: number
  /** Maximum model-visible turns across one Team subtree. */
  readonly maxTurnsPerTeam?: number
  /** Maximum model output tokens across one Team subtree. */
  readonly maxModelTokensPerTeam?: number
  /** Maximum wall-clock lifetime of one Team in milliseconds. */
  readonly maxWallTimeMsPerTeam?: number
  /** Maximum deployment cost units across one Team subtree. */
  readonly maxCostUnitsPerTeam?: number
  /** Maximum retry attempts across one Team subtree. */
  readonly maxRetriesPerTeam?: number
  /** Maximum durable inbox items retained per participant. */
  readonly maxInboxItemsPerParticipant?: number
  /** Maximum admitted messages per participant per minute. */
  readonly maxRatePerParticipantPerMinute?: number
  /** Provider/model per-token rates used when usage samples omit cost units. */
  readonly usageRates?: Readonly<Record<string, TeamUsageRate>>
  /** Inclusive millisecond bounds for the frozen attempt-latency histogram. */
  readonly rankingLatencyBucketsMs?: number[]
  /** Inclusive maximum-per-token rate bounds for verified cost-constrained ranking. */
  readonly rankingCostRateBuckets?: number[]
}

/** Schemastery validator for the Hub deployment configuration. */
export const Config: z<Config> = z.object({
  maxDiscoveryBytes: z.number().step(1).min(1).default(65536),
  maxSelectionBytes: z.number().step(1).min(1).default(16384),
  maxSelectionTextBytes: z.number().step(1).min(0).default(512),
  channelInvitationTimeoutMs: z.number().step(1).min(1).default(DEFAULT_CHANNEL_INVITATION_TIMEOUT_MS),
  recoveryPageSize: z.number().step(1).min(1).default(DEFAULT_RECOVERY_PAGE_SIZE),
  checkpointEvery: z.number().step(1).min(1).default(DEFAULT_CHECKPOINT_EVERY),
  auditRetentionTail: z.number().step(1).min(1).default(DEFAULT_AUDIT_RETENTION_TAIL),
  disposalTimeoutMs: z.number().step(1).min(1).default(DEFAULT_DISPOSAL_TIMEOUT_MS),
  maxTeamDepth: z.number().step(1).min(0).default(DEFAULT_MAX_TEAM_DEPTH),
  maxEnvelopeBytes: z.number().step(1).min(1).default(DEFAULT_MAX_ENVELOPE_BYTES),
  maxChannelViewBytes: z.number().step(1).min(1).default(DEFAULT_MAX_CHANNEL_VIEW_BYTES),
  maxPendingDeliveriesPerChannel: z.number().step(1).min(1).default(DEFAULT_MAX_PENDING_DELIVERIES_PER_CHANNEL),
  maxPendingDeliveriesPerParticipant: z.number().step(1).min(1).default(DEFAULT_MAX_PENDING_DELIVERIES_PER_PARTICIPANT),
  maxPendingDeliveryPageSize: z.number().step(1).min(1).default(DEFAULT_MAX_PENDING_DELIVERY_PAGE_SIZE),
  maxPostIdempotencyEntriesPerChannel: z.number().step(1).min(1).default(DEFAULT_MAX_POST_IDEMPOTENCY_ENTRIES_PER_CHANNEL),
  maxTaskAttemptsPerTask: z.number().step(1).min(1).default(DEFAULT_MAX_TASK_ATTEMPTS_PER_TASK),
  maxTaskLeaseDurationMs: z.number().step(1).min(1).default(DEFAULT_MAX_TASK_LEASE_DURATION_MS),
  maxParticipantsPerTeam: z.number().step(1).min(1).default(DEFAULT_MAX_PARTICIPANTS_PER_TEAM),
  maxActivationsPerTeam: z.number().step(1).min(1).default(DEFAULT_MAX_ACTIVATIONS_PER_TEAM),
  maxTasksPerTeam: z.number().step(1).min(1).default(DEFAULT_MAX_TASKS_PER_TEAM),
  maxChannelsPerTeam: z.number().step(1).min(1).default(DEFAULT_MAX_CHANNELS_PER_TEAM),
  maxTurnsPerTeam: z.number().step(1).min(1).default(DEFAULT_MAX_TURNS_PER_TEAM),
  maxModelTokensPerTeam: z.number().step(1).min(1).default(DEFAULT_MAX_MODEL_TOKENS_PER_TEAM),
  maxWallTimeMsPerTeam: z.number().step(1).min(1).default(DEFAULT_MAX_WALL_TIME_MS_PER_TEAM),
  maxCostUnitsPerTeam: z.number().step(1).min(1).default(DEFAULT_MAX_COST_UNITS_PER_TEAM),
  maxRetriesPerTeam: z.number().step(1).min(1).default(DEFAULT_MAX_RETRIES_PER_TEAM),
  maxInboxItemsPerParticipant: z.number().step(1).min(1).default(DEFAULT_MAX_INBOX_ITEMS_PER_PARTICIPANT),
  maxRatePerParticipantPerMinute: z.number().step(1).min(1).default(DEFAULT_MAX_RATE_PER_PARTICIPANT_PER_MINUTE),
  rankingLatencyBucketsMs: z.array(z.number().step(1).min(0)).default([100, 1000, 10000, 60000]),
  rankingCostRateBuckets: z.array(z.number().step(1).min(0)).default([0, 1, 10, 100]),
  usageRates: z.dict(z.object({
    input: z.number().min(0),
    output: z.number().min(0),
    cacheRead: z.number().min(0),
    cacheWrite: z.number().min(0),
  })).default({}),
})

/**
 * Local authoritative Team provider. Team and channel streams are opened only
 * through `ctx.storageLog`; stream recovery validates every durable record
 * before the projection becomes visible through `ctx.teams`.
 */
export class TeamHub extends TeamRuntime {
  static inject = ['storageLog']
  static Config = Config

  private readonly config: Omit<Required<Config>, 'rankingLatencyBucketsMs' | 'rankingCostRateBuckets'> & { readonly taskRanking: TeamTaskRankingPolicy }
  private readonly teams = new Map<TeamId, LoadedTeam>()
  private readonly projectionReadScopes = new AsyncLocalStorage<{
    active: boolean
    readonly teams: Set<LoadedTeam>
    readonly channels: Set<LoadedChannel>
  }>()
  private readonly teamEvictions = new Map<TeamId, Promise<void>>()
  private readonly teamLoads = new Map<TeamId, Promise<LoadedTeam>>()
  /** Team streams retained while recovery is validating an in-flight open. */
  private readonly teamOpeningStreams = new Map<TeamId, HubLogStream>()
  /** In-flight cross-process Team suffix reconciliation shared by callers. */
  private readonly teamRefreshes = new Map<TeamId, Promise<void>>()
  private readonly channels = new Map<ChannelId, LoadedChannel>()
  private readonly channelLoads = new Map<ChannelId, Promise<LoadedChannel>>()
  /** In-flight cross-process channel suffix reconciliation shared by callers. */
  private readonly channelRefreshes = new Map<ChannelId, Promise<void>>()
  /** Terminal channel handles waiting for every accepted admission to settle. */
  private readonly terminalChannels = new Set<LoadedChannel>()
  /** Physical channel cleanup operations that disposal must await. */
  private readonly channelCleanups = new Set<Promise<void>>()
  /** Per-channel barriers that prevent recovery racing stream close and lease release. */
  private readonly channelReleases = new Map<ChannelId, Promise<void>>()
  /** Open audit projection streams keyed by their source stream name. */
  private readonly auditStreams = new Map<string, HubLogStream>()
  /** Serialize audit repair and append operations independently from business streams. */
  private readonly auditQueues = new Map<string, SerialQueue>()
  /** Audit streams whose existing prefix has passed structural validation. */
  private readonly validatedAuditStreams = new Set<string>()
  /** Process-local admission counters; durable inbox limits remain WAL-derived. */
  private readonly participantRateWindows = new Map<string, ParticipantRateWindow>()
  private readonly accepted = new Set<Promise<unknown>>()
  private lastTaskLatencyMs = 0
  private lastReceiptLatencyMs = 0
  private closing = false
  private disposal: Promise<void> | undefined

  /**
   * @param ctx - Context carrying the routed append-only log facility.
   * @param config - Recovery, checkpoint, and disposal limits.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    this.config = {
      maxDiscoveryBytes: positiveLimit('maxDiscoveryBytes', config.maxDiscoveryBytes ?? 65536),
      maxSelectionBytes: positiveLimit('maxSelectionBytes', config.maxSelectionBytes ?? 16384),
      maxSelectionTextBytes: nonNegativeLimit('maxSelectionTextBytes', config.maxSelectionTextBytes ?? 512),
      channelInvitationTimeoutMs: positiveLimit(
        'channelInvitationTimeoutMs', config.channelInvitationTimeoutMs ?? DEFAULT_CHANNEL_INVITATION_TIMEOUT_MS,
      ),
      recoveryPageSize: positiveLimit('recoveryPageSize', config.recoveryPageSize ?? DEFAULT_RECOVERY_PAGE_SIZE),
      checkpointEvery: positiveLimit('checkpointEvery', config.checkpointEvery ?? DEFAULT_CHECKPOINT_EVERY),
      auditRetentionTail: positiveLimit('auditRetentionTail', config.auditRetentionTail ?? DEFAULT_AUDIT_RETENTION_TAIL),
      disposalTimeoutMs: positiveLimit('disposalTimeoutMs', config.disposalTimeoutMs ?? DEFAULT_DISPOSAL_TIMEOUT_MS),
      maxTeamDepth: nonNegativeLimit('maxTeamDepth', config.maxTeamDepth ?? DEFAULT_MAX_TEAM_DEPTH),
      maxEnvelopeBytes: positiveLimit('maxEnvelopeBytes', config.maxEnvelopeBytes ?? DEFAULT_MAX_ENVELOPE_BYTES),
      maxChannelViewBytes: positiveLimit('maxChannelViewBytes', config.maxChannelViewBytes ?? DEFAULT_MAX_CHANNEL_VIEW_BYTES),
      maxPendingDeliveriesPerChannel: positiveLimit(
        'maxPendingDeliveriesPerChannel',
        config.maxPendingDeliveriesPerChannel ?? DEFAULT_MAX_PENDING_DELIVERIES_PER_CHANNEL,
      ),
      maxPendingDeliveriesPerParticipant: positiveLimit(
        'maxPendingDeliveriesPerParticipant',
        config.maxPendingDeliveriesPerParticipant ?? DEFAULT_MAX_PENDING_DELIVERIES_PER_PARTICIPANT,
      ),
      maxPendingDeliveryPageSize: positiveLimit(
        'maxPendingDeliveryPageSize',
        config.maxPendingDeliveryPageSize ?? DEFAULT_MAX_PENDING_DELIVERY_PAGE_SIZE,
      ),
      maxPostIdempotencyEntriesPerChannel: positiveLimit(
        'maxPostIdempotencyEntriesPerChannel',
        config.maxPostIdempotencyEntriesPerChannel ?? DEFAULT_MAX_POST_IDEMPOTENCY_ENTRIES_PER_CHANNEL,
      ),
      maxTaskAttemptsPerTask: positiveLimit(
        'maxTaskAttemptsPerTask',
        config.maxTaskAttemptsPerTask ?? DEFAULT_MAX_TASK_ATTEMPTS_PER_TASK,
      ),
      maxTaskLeaseDurationMs: positiveLimit(
        'maxTaskLeaseDurationMs',
        config.maxTaskLeaseDurationMs ?? DEFAULT_MAX_TASK_LEASE_DURATION_MS,
      ),
      maxParticipantsPerTeam: positiveLimit(
        'maxParticipantsPerTeam',
        config.maxParticipantsPerTeam ?? DEFAULT_MAX_PARTICIPANTS_PER_TEAM,
      ),
      maxActivationsPerTeam: positiveLimit(
        'maxActivationsPerTeam',
        config.maxActivationsPerTeam ?? DEFAULT_MAX_ACTIVATIONS_PER_TEAM,
      ),
      maxTasksPerTeam: positiveLimit('maxTasksPerTeam', config.maxTasksPerTeam ?? DEFAULT_MAX_TASKS_PER_TEAM),
      maxChannelsPerTeam: positiveLimit(
        'maxChannelsPerTeam',
        config.maxChannelsPerTeam ?? DEFAULT_MAX_CHANNELS_PER_TEAM,
      ),
      maxTurnsPerTeam: positiveLimit('maxTurnsPerTeam', config.maxTurnsPerTeam ?? DEFAULT_MAX_TURNS_PER_TEAM),
      maxModelTokensPerTeam: positiveLimit('maxModelTokensPerTeam', config.maxModelTokensPerTeam ?? DEFAULT_MAX_MODEL_TOKENS_PER_TEAM),
      maxWallTimeMsPerTeam: positiveLimit('maxWallTimeMsPerTeam', config.maxWallTimeMsPerTeam ?? DEFAULT_MAX_WALL_TIME_MS_PER_TEAM),
      maxCostUnitsPerTeam: positiveLimit('maxCostUnitsPerTeam', config.maxCostUnitsPerTeam ?? DEFAULT_MAX_COST_UNITS_PER_TEAM),
      maxRetriesPerTeam: positiveLimit('maxRetriesPerTeam', config.maxRetriesPerTeam ?? DEFAULT_MAX_RETRIES_PER_TEAM),
      maxInboxItemsPerParticipant: positiveLimit('maxInboxItemsPerParticipant', config.maxInboxItemsPerParticipant ?? DEFAULT_MAX_INBOX_ITEMS_PER_PARTICIPANT),
      maxRatePerParticipantPerMinute: positiveLimit('maxRatePerParticipantPerMinute', config.maxRatePerParticipantPerMinute ?? DEFAULT_MAX_RATE_PER_PARTICIPANT_PER_MINUTE),
      usageRates: resolveUsageRates(config.usageRates ?? {}),
      taskRanking: teamTaskRankingPolicySchema.parse({ name: 'outcome-latency', version: 1,
        latencyUpperBoundsMs: config.rankingLatencyBucketsMs ?? [100, 1000, 10000, 60000],
        costRateUpperBounds: config.rankingCostRateBuckets ?? [0, 1, 10, 100], missingCost: 'unknown-last' }),
    }
    ctx.effect(() => () => this.closeHub(), 'teamHub.close()')
  }

  /**
   * Create a durable root or child Team and move it from provisioning to active
   * in one atomic journal append. Each path requires a source-owned proof; a
   * child link is validated under its exact active parent Team before its
   * stream becomes visible.
   * @param request - initial JSON payload plus root or child runtime authority.
   * @returns the detached active Team state.
   */
  override async createTeam(request: TeamCreateRequest): Promise<TeamStateSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamCreateRequestSchema.parse(untrustedInput)
      if (!('parentTeamId' in input)) {
        const authority = this.requireRootCreationAuthority(actor as TeamSystemRootCreationProof | undefined, input)
        return await this.createResolvedTeam(authority.input, {
          depth: 0,
          maxTeamDepth: this.config.maxTeamDepth,
        }, undefined, authority)
      }
      const authority = this.requireChildCreationAuthority(actor as TeamSystemChildCreationProof | undefined, input)
      const { parentTeamId, parentTaskId } = input
      const parent = await this.ensureTeam(parentTeamId)
      await this.repairPendingParentCharges(parent)
      return await parent.queue.run(async () => {
        const acceptedScope = authority.revalidate()
        this.assertTeamCursor(parent, acceptedScope.expectedParentCursor)
        this.assertNoPendingParentCharges(parent.projection)
        const lineage = this.resolveChildLineage(parent, parentTeamId, parentTaskId)
        const acceptedInput = childCreationInput(acceptedScope)
        const task = this.requireTask(parent, parentTaskId)
        if (task.execution.kind !== 'child-team' || task.delegation?.id !== acceptedInput.delegationId
          || task.delegation.childTeamId === undefined || !isDeepStrictEqual(task.delegation.creation, acceptedInput)
          || task.cancellation !== undefined || task.phase !== 'running') {
          throw new TeamError('Child creation has no matching parent task reservation', 'TEAM_DELEGATION_INVALID')
        }
        let existing: LoadedTeam | undefined
        try { existing = await this.ensureTeam(task.delegation.childTeamId) } catch (error: unknown) {
          if (!(error instanceof TeamError) || error.code !== 'TEAM_NOT_FOUND') throw error
        }
        if (existing !== undefined) {
          this.assertDelegationChild(task as ChildDelegationTask, existing)
          return this.teamState(existing.projection)
        }
        this.assertChildTeamBudget(parent.projection, acceptedInput.budgets, task.id)
        return await this.createResolvedTeam(acceptedInput, lineage, parent.projection.team.authorityGrant, undefined, authority,
          task.delegation.childTeamId)
      })
    })
  }

  /** Create one Team after root-or-child hierarchy facts have been resolved. */
  private async createResolvedTeam(
    input: TeamCreateInput,
    lineage: TeamLineage,
    inheritedAuthorityGrant?: TeamAuthorityGrant,
    rootCreationAuthority?: RootCreationAuthority,
    childCreationAuthority?: ChildCreationAuthority,
    reservedId?: TeamId,
  ): Promise<TeamStateSnapshot> {
    const parent = isChildLineage(lineage) ? lineage : undefined
    const creationSource = rootCreationAuthority?.sourceName ?? childCreationAuthority?.sourceName
    await this.authorizeOrThrow('register', parent?.parentTeamId, {
      goal: {
        objective: input.goal.objective,
        budgets: input.goal.budgets,
      },
      rules: input.rules,
      budgets: input.budgets,
      ...parent === undefined ? {} : {
        parentTeamId: parent.parentTeamId,
        parentTaskId: parent.parentTaskId,
      },
      ...(creationSource === undefined ? {} : { creationSource }),
      depth: lineage.depth,
      maxTeamDepth: lineage.maxTeamDepth,
    })
    const acceptedInput = rootCreationAuthority?.revalidate()
      ?? (childCreationAuthority === undefined ? undefined : childCreationInput(childCreationAuthority.revalidate()))
      ?? input
    resourceBudget(acceptedInput.budgets, 'Team budget')
    const authorityGrant = resolveAuthorityGrant(acceptedInput.authorityGrant, inheritedAuthorityGrant)
    if (inheritedAuthorityGrant !== undefined) {
      assertAuthorityGrantSubset(inheritedAuthorityGrant, authorityGrant, 'child Team authority')
    }
    const id = reservedId ?? mintTeamId()
    const createdAt = Date.now()
    const goal: TeamGoalSnapshot = {
      teamId: id,
      revision: 1,
      objective: normalizedText(acceptedInput.goal.objective, 'goal objective'),
      phase: 'active',
      budgets: jsonObjectSchema.parse(acceptedInput.goal.budgets),
    }
    const records: readonly TeamJournalRecord[] = [
      {
        type: 'team/created',
        teamId: id,
        ...parent === undefined ? {} : {
          parentTeamId: parent.parentTeamId,
          parentTaskId: parent.parentTaskId,
        },
        depth: lineage.depth,
        maxTeamDepth: lineage.maxTeamDepth,
        goal,
        rules: this.snapshotRules(acceptedInput.rules),
        budgets: jsonObjectSchema.parse(acceptedInput.budgets),
        authorityGrant,
        ...(rootCreationAuthority === undefined ? {} : {
          createdBy: { kind: 'system' as const, name: rootCreationAuthority.sourceName },
        }),
        createdAt,
      },
      { type: 'team/phase', phase: 'active', createdAt },
    ]
    const stream = await this.ctx.storageLog.open({
      name: teamStreamName(id),
      version: TEAM_JOURNAL_FORMAT_VERSION,
    })
    try {
      // Opening is asynchronous and may yield after the source revokes its
      // one-shot proof. Recheck before any fold or durable append; failure
      // closes this still-empty handle through the common creation cleanup.
      rootCreationAuthority?.revalidate()
      childCreationAuthority?.revalidate()
      let projection: TeamProjection | undefined
      const events: TeamEvent[] = []
      for (const [index, record] of records.entries()) {
        projection = foldTeamRecord(projection, record, index, id)
        events.push(teamEventFor(record, projection))
      }
      /* v8 ignore next 3 -- this fixed non-empty creation batch always folds a projection. */
      if (projection === undefined) {
        throw new TeamHubError('Team creation did not produce a projection', 'TEAM_JOURNAL_MALFORMED')
      }
      const appended = await stream.append(EMPTY_CURSOR, records, { summary: this.discoverySummary(projection) })
      /* v8 ignore next 3 -- LogStream append returns the final cursor of its accepted batch. */
      if (appended.tailSequence !== records.length - 1) {
        throw new TeamHubError('Team journal append returned an unexpected tail', 'TEAM_JOURNAL_MALFORMED')
      }
      const loaded: LoadedTeam = {
        readers: 0,        id,
        stream,
        queue: new SerialQueue(),
        activity: new CursorActivity(),
        projection,
        policyDenialCursors: new Set(),
        invalid: false,
      }
      this.teams.set(id, loaded)
      for (const event of events) this.emitTeamEvent(event)
      loaded.activity.notify(projection.team.cursor)
      await this.maybeCheckpointTeam(loaded)
      await this.maintainAuditProjection(id, 'team', stream)
      return this.teamState(loaded.projection)
    } catch (error: unknown) {
      // v8 ignore next -- backend failure cleanup is exercised by storage-log conformance.
      return await closeAfterFailure(stream, error)
    }
  }

  /** Resolve one root proof and bind it to the caller's complete JSON payload. */
  private requireRootCreationAuthority(
    actor: TeamSystemRootCreationProof | undefined,
    input: TeamRootCreateInput,
  ): RootCreationAuthority {
    if (actor === undefined) {
      throw new TeamError('Root Team creation requires a live system root-creation proof', 'TEAM_ACTOR_PROOF_INVALID')
    }
    const initial = this.requireSystemRootCreationProof(actor)
    if (initial.sourceName !== TEAM_RUN_ROOT_CREATION_PROOF_SOURCE || !sameRootCreationInput(initial, input)) {
      throw new TeamError('Root Team creation proof does not authorize the supplied payload', 'TEAM_ACTOR_PROOF_INVALID')
    }
    const expected = initial.scope
    return Object.freeze({
      sourceName: initial.sourceName,
      input: rootCreationInput(expected),
      revalidate: (): TeamRootCreateInput => {
        const current = this.requireSystemRootCreationProof(actor)
        if (current.sourceName !== TEAM_RUN_ROOT_CREATION_PROOF_SOURCE
          || current.sourceName !== initial.sourceName
          || !isDeepStrictEqual(current.scope, expected)) {
          throw new TeamError('Root Team creation proof changed before journal admission', 'TEAM_ACTOR_PROOF_INVALID')
        }
        return rootCreationInput(current.scope)
      },
    })
  }

  /** Resolve one child-delegation proof and bind it to exact child JSON input. */
  private requireChildCreationAuthority(
    actor: TeamSystemChildCreationProof | undefined,
    input: TeamChildCreateInput,
  ): ChildCreationAuthority {
    if (actor === undefined) {
      throw new TeamError('Child Team creation requires a live system child-creation proof', 'TEAM_ACTOR_PROOF_INVALID')
    }
    const initial = this.requireSystemChildCreationProof(actor)
    if (initial.sourceName !== TEAM_CHILD_CREATION_PROOF_SOURCE || !sameChildCreationInput(initial, input)) {
      throw new TeamError('Child Team creation proof does not authorize the supplied payload', 'TEAM_ACTOR_PROOF_INVALID')
    }
    const expected = initial.scope
    return Object.freeze({
      sourceName: initial.sourceName,
      revalidate: (): TeamSystemChildCreationProofResolution['scope'] => {
        const current = this.requireSystemChildCreationProof(actor)
        if (current.sourceName !== TEAM_CHILD_CREATION_PROOF_SOURCE
          || current.sourceName !== initial.sourceName
          || !isDeepStrictEqual(current.scope, expected)) {
          throw new TeamError('Child Team creation proof changed before journal admission', 'TEAM_ACTOR_PROOF_INVALID')
        }
        return current.scope
      },
    })
  }

  /** Resolve one channel-summary proof and bind it to exact JSON input. */
  private requireChannelSummaryAuthority(
    actor: TeamSystemChannelSummaryProof | undefined,
    input: ChannelSummarizeInput,
  ): ChannelSummaryAuthority {
    if (actor === undefined) {
      throw new TeamError('Channel summary requires a live system channel-summary proof', 'TEAM_ACTOR_PROOF_INVALID')
    }
    const initial = this.requireSystemChannelSummaryProof(actor)
    if (initial.sourceName !== TEAM_CHANNEL_SUMMARY_PROOF_SOURCE || !sameChannelSummaryInput(initial, input)) {
      throw new TeamError('Channel summary proof does not authorize the supplied payload', 'TEAM_ACTOR_PROOF_INVALID')
    }
    const expected = initial.scope
    return Object.freeze({
      sourceName: initial.sourceName,
      input: channelSummaryInput(expected),
      revalidate: (): ChannelSummarizeInput => {
        const current = this.requireSystemChannelSummaryProof(actor)
        if (current.sourceName !== TEAM_CHANNEL_SUMMARY_PROOF_SOURCE
          || current.sourceName !== initial.sourceName
          || !isDeepStrictEqual(current.scope, expected)) {
          throw new TeamError('Channel summary proof changed before WAL admission', 'TEAM_ACTOR_PROOF_INVALID')
        }
        return channelSummaryInput(current.scope)
      },
    })
  }

  /** Resolve one generic channel-lifecycle proof and bind it to exact JSON closure input. */
  private requireChannelLifecycleAuthority(
    actor: TeamSystemChannelLifecycleProof | undefined,
    input: ChannelCloseInput,
  ): ChannelLifecycleAuthority {
    if (actor === undefined) {
      throw new TeamError('Channel closure requires a live system channel-lifecycle proof', 'TEAM_ACTOR_PROOF_INVALID')
    }
    const initial = this.requireSystemChannelLifecycleProof(actor)
    if (initial.sourceName !== TEAM_CHANNEL_LIFECYCLE_PROOF_SOURCE
      || initial.scope.kind !== 'channel-close'
      || !sameChannelCloseInput(initial, input)) {
      throw new TeamError('Channel lifecycle proof does not authorize the supplied payload', 'TEAM_ACTOR_PROOF_INVALID')
    }
    const expected = initial.scope
    return Object.freeze({
      sourceName: initial.sourceName,
      input: channelCloseInput(expected),
      revalidate: (): Extract<TeamSystemChannelLifecycleProofResolution['scope'], { readonly kind: 'channel-close' }> => {
        const current = this.requireSystemChannelLifecycleProof(actor)
        if (current.sourceName !== TEAM_CHANNEL_LIFECYCLE_PROOF_SOURCE
          || current.sourceName !== initial.sourceName
          || current.scope.kind !== 'channel-close'
          || !isDeepStrictEqual(current.scope, expected)) {
          throw new TeamError('Channel lifecycle proof changed before WAL admission', 'TEAM_ACTOR_PROOF_INVALID')
        }
        return current.scope
      },
    })
  }

  /** Resolve one generic channel-open proof and bind it to exact JSON admission input. */
  private requireChannelOpenLifecycleAuthority(
    actor: TeamSystemChannelLifecycleProof | undefined,
    input: ChannelOpenInput,
  ): ChannelOpenLifecycleAuthority {
    if (actor === undefined) {
      throw new TeamError('Channel opening requires a live system channel-lifecycle proof', 'TEAM_ACTOR_PROOF_INVALID')
    }
    const initial = this.requireSystemChannelLifecycleProof(actor)
    if ((initial.sourceName !== TEAM_CHANNEL_LIFECYCLE_PROOF_SOURCE && initial.sourceName !== 'team-run-child')
      || initial.scope.kind !== 'channel-open'
      || !sameChannelOpenInput(initial, input)) {
      throw new TeamError('Channel lifecycle proof does not authorize the supplied payload', 'TEAM_ACTOR_PROOF_INVALID')
    }
    const expected = initial.scope
    return Object.freeze({
      sourceName: initial.sourceName,
      input: channelOpenInput(expected),
      revalidate: (): Extract<TeamSystemChannelLifecycleProofResolution['scope'], { readonly kind: 'channel-open' }> => {
        const current = this.requireSystemChannelLifecycleProof(actor)
        if (current.sourceName !== initial.sourceName
          || current.scope.kind !== 'channel-open'
          || !isDeepStrictEqual(current.scope, expected)) {
          throw new TeamError('Channel lifecycle proof changed before WAL admission', 'TEAM_ACTOR_PROOF_INVALID')
        }
        return current.scope
      },
    })
  }

  /** Recognize one exact authenticated-human terminal archive request before the Team load begins. */
  private isHumanArchiveActor(
    actor: TeamSystemArchiveProof | TeamHumanActorProof,
    input: TeamArchiveInput,
  ): actor is TeamHumanActorProof {
    const human = this.tryResolveHumanActorProof(actor)
    if (human === undefined) return false
    this.assertHumanArchiveProofScope(human, this.humanArchiveProofInput(input))
    return true
  }

  /** Build the complete parsed terminal archive input whose cursor fence an authenticated human proof retains. */
  private humanArchiveProofInput(input: TeamArchiveInput): TeamHumanActorProofInput {
    return {
      teamId: input.teamId,
      operation: 'close',
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Re-resolve one active human archive proof under the Team serializer. */
  private resolveHumanArchiveAuthority(
    team: LoadedTeam,
    actor: TeamHumanActorProof,
    input: TeamArchiveInput,
  ): { readonly sourceName: string; readonly actorId: ParticipantId } {
    const resolution = this.requireHumanActorProof(actor)
    const expected = this.humanArchiveProofInput(input)
    this.assertHumanArchiveProofScope(resolution.scope, expected)
    if (resolution.scope.teamId !== team.id) this.rejectHumanArchiveActor()
    const participant = this.requireActiveParticipant(team, resolution.scope.participantId)
    if (participant.kind !== 'human') this.rejectHumanArchiveActor()
    return { sourceName: resolution.sourceName, actorId: participant.id }
  }

  /** Reject a human terminal archive proof whose Team, cursor, operation, or payload does not match. */
  private assertHumanArchiveProofScope(scope: TeamHumanActorScope, expected: TeamHumanActorProofInput): void {
    if (scope.teamId !== expected.teamId
      || scope.operation !== expected.operation
      || scope.payloadFingerprint !== fingerprintTeamHumanActorPayload(expected)
      || !isDeepStrictEqual(scope.fence, expected.fence)) {
      this.rejectHumanArchiveActor()
    }
  }

  /** Reject forged, revoked, stale, cross-Team, or wrong-operation authenticated-human archive authority. */
  private rejectHumanArchiveActor(): never {
    throw new TeamError('Human terminal archive actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Recognize one exact authenticated-human Team resume request before the Team load begins. */
  private assertHumanResumeActor(actor: TeamHumanActorProof, input: TeamResumeInput): void {
    const human = this.tryResolveHumanActorProof(actor)
    if (human === undefined) this.rejectHumanResumeActor()
    this.assertHumanResumeProofScope(human, this.humanResumeProofInput(input))
  }

  /** Build the complete parsed Team resume input whose cursor fence an authenticated human proof retains. */
  private humanResumeProofInput(input: TeamResumeInput): TeamHumanActorProofInput {
    return {
      teamId: input.teamId,
      operation: 'activate',
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Re-resolve one active human resume proof under the Team serializer. */
  private resolveHumanResumeAuthority(
    team: LoadedTeam,
    actor: TeamHumanActorProof,
    input: TeamResumeInput,
  ): { readonly sourceName: string; readonly actorId: ParticipantId } {
    const resolution = this.requireHumanActorProof(actor)
    this.assertHumanResumeProofScope(resolution.scope, this.humanResumeProofInput(input))
    const projection = team.projection.team
    if (resolution.scope.teamId !== team.id
      || projection.archivedAt !== undefined
      || projection.phase !== 'active' && projection.phase !== 'stalled'
      || projection.closure !== undefined
      || projection.cancellation !== undefined) {
      this.rejectHumanResumeActor()
    }
    const participant = this.requireActiveParticipant(team, resolution.scope.participantId)
    if (participant.kind !== 'human') this.rejectHumanResumeActor()
    return { sourceName: resolution.sourceName, actorId: participant.id }
  }

  /** Return whether the proof remains source-live and still binds this exact resume payload. */
  private isLiveHumanResumeActor(actor: TeamHumanActorProof, input: TeamResumeInput): boolean {
    try {
      const resolution = this.requireHumanActorProof(actor)
      this.assertHumanResumeProofScope(resolution.scope, this.humanResumeProofInput(input))
      return true
    } catch (error: unknown) {
      if (error instanceof TeamError && error.code === 'TEAM_ACTOR_PROOF_INVALID') return false
      throw error
    }
  }

  /** Reject a human resume proof whose Team, cursor, operation, or payload does not match. */
  private assertHumanResumeProofScope(scope: TeamHumanActorScope, expected: TeamHumanActorProofInput): void {
    if (scope.teamId !== expected.teamId
      || scope.operation !== expected.operation
      || scope.payloadFingerprint !== fingerprintTeamHumanActorPayload(expected)
      || !isDeepStrictEqual(scope.fence, expected.fence)) {
      this.rejectHumanResumeActor()
    }
  }

  /** Reject forged, revoked, stale, cross-Team, or wrong-operation authenticated-human resume authority. */
  private rejectHumanResumeActor(): never {
    throw new TeamError('Human Team resume actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Resolve one TeamRun-owned archive proof and bind it to exact JSON input. */
  private requireArchiveAuthority(
    actor: TeamSystemArchiveProof | undefined,
    input: TeamArchiveInput,
  ): ArchiveAuthority {
    if (actor === undefined) {
      throw new TeamError('Terminal Team archive requires a live system archive proof', 'TEAM_ACTOR_PROOF_INVALID')
    }
    const initial = this.requireSystemArchiveProof(actor)
    if (initial.sourceName !== TEAM_RUN_ARCHIVE_PROOF_SOURCE || !sameArchiveInput(initial, input)) {
      throw new TeamError('Terminal Team archive proof does not authorize the supplied Team and cursor', 'TEAM_ACTOR_PROOF_INVALID')
    }
    const expected = initial.scope
    return Object.freeze({
      sourceName: initial.sourceName,
      input: archiveInput(expected),
      revalidate: (): TeamArchiveInput => {
        const current = this.requireSystemArchiveProof(actor)
        if (current.sourceName !== TEAM_RUN_ARCHIVE_PROOF_SOURCE
          || current.sourceName !== initial.sourceName
          || !isDeepStrictEqual(current.scope, expected)) {
          throw new TeamError('Terminal Team archive proof changed before journal admission', 'TEAM_ACTOR_PROOF_INVALID')
        }
        return archiveInput(current.scope)
      },
    })
  }

  /** Freeze deployment-varying per-Team limits in the creation record. */
  private snapshotRules(rules: JsonObject): JsonObject {
    return jsonObjectSchema.parse({
      ...structuredClone(rules),
      teamLimits: {
        maxParticipants: this.config.maxParticipantsPerTeam,
        maxActivations: this.config.maxActivationsPerTeam,
        maxTasks: this.config.maxTasksPerTeam,
        maxChannels: this.config.maxChannelsPerTeam,
        maxEnvelopeBytes: this.config.maxEnvelopeBytes,
        maxChannelViewBytes: this.config.maxChannelViewBytes,
        maxPendingDeliveriesPerChannel: this.config.maxPendingDeliveriesPerChannel,
        maxPendingDeliveriesPerParticipant: this.config.maxPendingDeliveriesPerParticipant,
        maxPendingDeliveryPageSize: this.config.maxPendingDeliveryPageSize,
        maxPostIdempotencyEntriesPerChannel: this.config.maxPostIdempotencyEntriesPerChannel,
        maxTaskAttemptsPerTask: this.config.maxTaskAttemptsPerTask,
        maxTaskLeaseDurationMs: this.config.maxTaskLeaseDurationMs,
        maxTurnsPerTeam: this.config.maxTurnsPerTeam,
        maxModelTokensPerTeam: this.config.maxModelTokensPerTeam,
        maxWallTimeMsPerTeam: this.config.maxWallTimeMsPerTeam,
        maxCostUnitsPerTeam: this.config.maxCostUnitsPerTeam,
        maxRetriesPerTeam: this.config.maxRetriesPerTeam,
        maxInboxItemsPerParticipant: this.config.maxInboxItemsPerParticipant,
        maxRatePerParticipantPerMinute: this.config.maxRatePerParticipantPerMinute,
      },
      usageRates: structuredClone(this.config.usageRates),
      taskRanking: structuredClone(this.config.taskRanking),
    })
  }

  /** Read one immutable limit from the creation-time Team rule snapshot. */
  private teamLimit(projection: TeamProjection, key: TeamLimitKey, fallback: number): number {
    const raw = projection.rules.teamLimits
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fallback
    const value = (raw as JsonObject)[key]
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback
  }

  /** Validate a parent Team/task and derive immutable hierarchy facts for its child. */
  private resolveChildLineage(
    parent: LoadedTeam,
    parentTeamId: TeamId,
    parentTaskId: TeamTaskId,
  ): TeamLineage {
    const current = this.requireLiveTeam(parent)
    if (current.projection.team.phase !== 'active') {
      throw new TeamError(`parent Team '${parentTeamId}' is not active`, 'TEAM_INVALID_ARGUMENT')
    }
    const task = current.projection.tasks.get(parentTaskId)
    if (task === undefined || task.phase === 'deleted') {
      throw new TeamError(`parent Team task '${parentTaskId}' was not found`, 'TEAM_TASK_NOT_FOUND')
    }
    if (current.projection.team.depth >= Number.MAX_SAFE_INTEGER) {
      throw new TeamError(`parent Team '${parentTeamId}' has no representable child depth`, 'TEAM_INVALID_ARGUMENT')
    }
    const depth = current.projection.team.depth + 1
    if (depth > current.projection.team.maxTeamDepth) {
      throw new TeamError(
        `parent Team '${parentTeamId}' depth cap ${current.projection.team.maxTeamDepth} rejects child depth ${depth}`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    return {
      parentTeamId,
      parentTaskId,
      depth,
      maxTeamDepth: current.projection.team.maxTeamDepth,
    }
  }

  /**
   * Read one Team after lazily recovering its durable journal.
   * @param request - Team identity to read.
   * @returns a detached current Team state.
   */
  override async getTeam(request: TeamGetRequest): Promise<TeamStateSnapshot> {
    return await this.admit(async () => {
      const input = teamGetRequestSchema.parse(request)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(() => Promise.resolve(this.teamState(this.requireLiveTeam(loaded).projection)))
    })
  }

  /** Read the selected action under its owning Team serializer and selection byte allowance. */
  override async getHumanAction(request: TeamHumanActionReadRequest): Promise<TeamHumanActionSnapshot> {
    return await this.admit(async () => {
      const input = teamHumanActionReadRequestSchema.parse(request)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(() => {
        const result = projectHumanAction(
          this.requireLiveTeam(loaded).projection.humanActions.get(input.actionId), this.config.maxSelectionBytes,
        )
        if (!result.ok) throw new TeamError(`Human action '${input.actionId}' is ${result.reason}`,
          result.reason === 'missing' ? 'TEAM_INVALID_ARGUMENT' : 'TEAM_CHANNEL_BACKPRESSURE')
        return Promise.resolve(freeze(result.value))
      })
    })
  }

  /** Project first-selection data under the same cursor serializer as full-state reads. */
  override async getTeamSelection(request: TeamSelectionRequest): Promise<TeamSelectionSnapshot> {
    return await this.admit(async () => {
      const input = teamSelectionRequestSchema.parse(request)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(() => Promise.resolve(freeze(teamSelection(
        this.requireLiveTeam(loaded).projection, this.config.maxSelectionTextBytes, this.config.maxSelectionBytes, input.includeMetadata,
      ))))
    })
  }

  /** Resolve the provider's configured page size before reading any summary rows. */
  private resolveBrowse(request: TeamBrowseRequest): TeamBrowseSpec {
    return { teamId: request.teamId, kind: request.kind, afterCursor: request.afterCursor ?? -1,
      limit: this.pageLimit(request.limit ?? this.config.recoveryPageSize) }
  }

  /** Read collection summaries directly from the authoritative maps under their serializer. */
  override async browse(request: TeamBrowseRequest): Promise<TeamBrowsePage> {
    return await this.admit(async () => {
      const input = this.resolveBrowse(teamBrowseRequestSchema.parse(request))
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(() => {
        const result = projectTeamBrowse(this.requireLiveTeam(loaded).projection, input,
          this.config.maxSelectionTextBytes, this.config.maxSelectionBytes)
        if (!result.ok) throw new TeamError(`Team browse ${result.reason} cannot fit the selected response`, 'TEAM_CHANNEL_BACKPRESSURE')
        return Promise.resolve(freeze(result.value))
      })
    })
  }

  /** Resolve the configured task history page before reading authoritative records. */
  private resolveTaskInspection(request: TeamTaskInspectRequest): TeamTaskInspectSpec {
    return request.section === 'record' ? request : { ...request,
      afterCursor: request.afterCursor ?? -1, limit: this.pageLimit(request.limit ?? this.config.recoveryPageSize) }
  }

  /** Inspect one exact task without copying its complete settled history. */
  override async inspectTask(request: TeamTaskInspectRequest): Promise<TeamTaskInspection> {
    return await this.admit(async () => {
      const input = this.resolveTaskInspection(teamTaskInspectRequestSchema.parse(request))
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(() => {
        const current = this.requireLiveTeam(loaded)
        const result = projectTaskInspection(this.requireTask(current, input.taskId), current.projection.team.cursor,
          input, this.config.maxSelectionBytes)
        if (result.ok) return Promise.resolve(freeze(result.value))
        switch (result.reason) {
          case 'owner': throw new TeamError('Task is not in the selected Team', 'TEAM_TASK_NOT_FOUND')
          case 'revision': throw new TeamError('Task inspection revision changed; refresh the task record', 'TEAM_TASK_STALE_REVISION')
          case 'metadata': case 'row': throw new TeamError('Task inspection exceeds maxSelectionBytes', 'TEAM_CHANNEL_BACKPRESSURE')
          default: return assertNever(result.reason)
        }
      })
    })
  }

  /** Resolve capability pagination from deployment settings before storage admission. */
  private resolveMemberInspection(request: TeamMemberInspectRequest): TeamMemberInspectSpec {
    return { ...request, afterCursor: request.afterCursor ?? -1, limit: this.pageLimit(request.limit ?? this.config.recoveryPageSize) }
  }

  /** Inspect one exact member under the same serializer as membership changes. */
  override async inspectMember(request: TeamMemberInspectRequest): Promise<TeamMemberInspection> {
    return await this.admit(async () => {
      const input = this.resolveMemberInspection(teamMemberInspectRequestSchema.parse(request))
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(() => {
        const state = this.requireLiveTeam(loaded).projection
        const member = state.participants.get(input.participantId)
        if (member === undefined) throw new TeamError('Participant is not in the selected Team', 'TEAM_PARTICIPANT_NOT_FOUND')
        const result = projectMemberInspection(member, state.team.cursor, input, this.config.maxSelectionBytes)
        if (result.ok) return Promise.resolve(freeze(result.value))
        switch (result.reason) {
          case 'owner': throw new TeamError('Member inspection ownership mismatch', 'TEAM_PARTICIPANT_NOT_FOUND')
          case 'cursor': throw new TeamError('Team changed; refresh member inspection', 'TEAM_CURSOR_CONFLICT')
          case 'metadata': case 'row': throw new TeamError('Member inspection exceeds maxSelectionBytes', 'TEAM_CHANNEL_BACKPRESSURE')
          default: return assertNever(result.reason)
        }
      })
    })
  }

  /** Read one latest published member binding under the Team serializer. */
  override async getMemberSession(request: TeamMemberSessionRequest): Promise<TeamMemberSessionSnapshot> {
    return await this.admit(async () => {
      const input = teamMemberSessionRequestSchema.parse(request)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(() => {
        const result = projectMemberSession(this.requireLiveTeam(loaded).projection, input.participantId, this.config.maxSelectionBytes)
        if (result.ok) return Promise.resolve(freeze(result.value))
        switch (result.reason) {
          case 'missing-participant': throw new TeamError('Participant is not in the selected Team', 'TEAM_PARTICIPANT_NOT_FOUND')
          case 'missing-binding': throw new TeamError('Participant has no published Session binding', 'TEAM_ACTIVATION_NOT_FOUND')
          case 'too-large': throw new TeamError('Member Session binding exceeds maxSelectionBytes', 'TEAM_CHANNEL_BACKPRESSURE')
          default: return assertNever(result.reason)
        }
      })
    })
  }

  /**
   * Persist a host-mediated approval/question request in the Team journal.
   * Repeating the same action identity is idempotent and returns the durable
   * projection even when another Team record advanced the caller's cursor.
   * Closure and cancellation intents or a terminal phase reject new actions.
   * @param request - Host proof and JSON-only Team cursor routing fields.
   * @returns the accepted or replayed durable action.
   */
  override async upsertHumanAction(request: TeamHumanActionUpsertRequest): Promise<TeamHumanActionSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamHumanActionUpsertInputSchema.parse(untrustedInput)
      this.assertInitialHumanActionAuthority(actor, input, 'upsert')
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const action = this.resolveHumanActionUpsertAuthority(current, actor, input)
        const existing = current.projection.humanActions.get(action.id)
        if (existing !== undefined) {
          if (!sameHumanActionRequest(existing, action)) {
            throw new TeamError(`human action '${action.id}' was already used with different request facts`, 'TEAM_INVALID_ARGUMENT')
          }
          return this.humanActionSnapshot(existing)
        }
        this.assertTeamCursor(current, input.expectedCursor)
        const team = current.projection.team
        if (team.cancellation !== undefined || team.closure !== undefined
          || team.phase === 'completed' || team.phase === 'cancelled' || team.phase === 'failed') {
          throw new TeamError(`Team '${current.id}' is closing and cannot accept a new human action`, 'TEAM_INVALID_ARGUMENT')
        }
        if (!current.projection.participants.has(action.participantId)) {
          throw new TeamError(`human action '${action.id}' names an unknown participant '${action.participantId}'`, 'TEAM_PARTICIPANT_NOT_FOUND')
        }
        if (action.taskId !== undefined && !current.projection.tasks.has(action.taskId)) {
          throw new TeamError(`human action '${action.id}' names an unknown task '${action.taskId}'`, 'TEAM_TASK_NOT_FOUND')
        }
        await this.authorizeOrThrow('human-action', input.teamId, {
          actionId: action.id,
          kind: action.kind,
          sourceId: action.sourceId,
          participantId: action.participantId,
          sessionId: action.sessionId,
        }, action.participantId)
        if (!isDeepStrictEqual(this.resolveHumanActionUpsertAuthority(current, actor, input), action)) {
          this.rejectHumanActionActor()
        }
        const createdAt = nextTeamTimestamp(current.projection)
        const next: TeamHumanActionSnapshot = {
          ...structuredClone(action),
          createdAt,
          updatedAt: createdAt,
        }
        await this.commitTeamCommand(current, [{
          type: 'human-action/changed', action: next, createdAt,
        }], 'TEAM_INVALID_ARGUMENT')
        return this.humanActionSnapshot(next)
      })
    })
  }

  /**
   * Persist the terminal outcome of one Team human action.
   * Repeating a matching terminal write is idempotent; a different terminal
   * outcome is rejected rather than rewriting the Team's interaction history.
   * @param request - Host proof and JSON-only Team cursor routing fields.
   * @returns the settled durable action.
   */
  override async resolveHumanAction(request: TeamHumanActionResolveRequest): Promise<TeamHumanActionSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamHumanActionResolveInputSchema.parse(untrustedInput)
      this.assertInitialHumanActionAuthority(actor, input, 'resolve')
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const authority = this.resolveHumanActionResolveAuthority(current, actor, input)
        const existing = current.projection.humanActions.get(authority.action.id)
        if (existing === undefined) {
          throw new TeamError(`human action '${authority.action.id}' was not found`, 'TEAM_INVALID_ARGUMENT')
        }
        if (!sameHumanActionRequest(existing, authority.action)) this.rejectHumanActionActor()
        const outcome = structuredClone(authority.outcome)
        if (existing.phase !== 'pending') {
          if (existing.phase === authority.phase && isDeepStrictEqual(existing.outcome, outcome)) {
            return this.humanActionSnapshot(existing)
          }
          if (existing.phase === 'cancelled' && existing.outcome?.kind === 'task-cancelled'
            && authority.phase === 'cancelled' && outcome.kind === 'cancelled') return this.humanActionSnapshot(existing)
          throw new TeamError(`human action '${authority.action.id}' is already ${existing.phase}`, 'TEAM_INVALID_ARGUMENT')
        }
        this.assertTeamCursor(current, input.expectedCursor)
        await this.authorizeOrThrow('human-action', input.teamId, {
          actionId: authority.action.id,
          phase: authority.phase,
          outcome,
          participantId: existing.participantId,
          sessionId: existing.sessionId,
        }, existing.participantId)
        if (!isDeepStrictEqual(this.resolveHumanActionResolveAuthority(current, actor, input), authority)) {
          this.rejectHumanActionActor()
        }
        const updatedAt = nextTeamTimestamp(current.projection)
        const next: TeamHumanActionSnapshot = {
          ...structuredClone(existing),
          phase: authority.phase,
          outcome,
          updatedAt,
        }
        await this.commitTeamCommand(current, [{
          type: 'human-action/changed', action: next, createdAt: updatedAt,
        }], 'TEAM_INVALID_ARGUMENT')
        return this.humanActionSnapshot(next)
      })
    })
  }

  override async acceptHumanActionResponse(request: TeamHumanActionResolveRequest): Promise<TeamHumanActionSnapshot> {
    return await this.admit(async () => {
      const { actor, ...raw } = request
      const input = teamHumanActionResolveInputSchema.parse(raw)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const team = this.requireLiveTeam(loaded)
        const validate = () => {
          const resolution = this.requireSystemHumanActionProof(actor)
          const scope = resolution.scope
          if (resolution.sourceName !== HOST_API_PROXY_HUMAN_ACTION_PROOF_SOURCE || scope.kind !== 'host-human-action-response-accept'
            || scope.teamId !== input.teamId || scope.expectedCursor !== input.expectedCursor
            || scope.input.teamId !== input.teamId || scope.input.actionId !== scope.action.id) this.rejectHumanActionActor()
          const matches = [...team.projection.participants.values()].filter(participant => participant.kind === 'human'
            && participant.phase === 'active' && participant.owner?.kind === 'product-principal'
            && participant.owner.principalId === scope.principalId)
          if (matches.length !== 1 || matches[0]?.id !== scope.humanId
            || !matches[0].authorityGrant?.operations.includes('human-action')) this.rejectHumanActionActor()
          const action = team.projection.humanActions.get(scope.input.actionId)
          if (action === undefined || !sameHumanActionRequest(action, scope.action)) this.rejectHumanActionActor()
          if (action.response === undefined && action.taskId !== undefined) {
            const task = team.projection.tasks.get(action.taskId)
            const binding = task?.lease?.activationId === undefined ? undefined : team.projection.activations.get(task.lease.activationId)
            if (action.attemptId === undefined || task?.lease?.attemptId !== action.attemptId
              || task.lease.participantId !== action.participantId || binding?.sessionId !== action.sessionId) {
              throw new TeamError('Human action belongs to an obsolete task attempt', 'TEAM_INVALID_ARGUMENT')
            }
          }
          return { scope, action }
        }
        const { scope, action } = validate()
        if (action.response !== undefined) {
          if (action.response.idempotencyKey !== scope.input.idempotencyKey
            || action.response.expectedUpdatedAt !== scope.input.expectedUpdatedAt
            || action.response.respondedBy !== scope.humanId || !isDeepStrictEqual(action.response.answer, scope.input.answer)) {
            throw new TeamError('Human response retry conflicts with the accepted answer', 'TEAM_INVALID_ARGUMENT')
          }
          return this.humanActionSnapshot(action)
        }
        if (action.phase !== 'pending' || action.updatedAt !== scope.input.expectedUpdatedAt
          || action.kind !== scope.input.answer.kind || team.projection.team.phase !== 'active'
          || team.projection.team.cancellation !== undefined || team.projection.team.closure !== undefined) {
          throw new TeamError('Human action or its request revision is no longer answerable', 'TEAM_INVALID_ARGUMENT')
        }
        this.assertTeamCursor(team, input.expectedCursor)
        await this.authorizeOrThrow('human-action', team.id, { operation: 'response-accept', actionId: action.id,
          answer: scope.input.answer as unknown as JsonObject }, scope.humanId)
        validate()
        const updatedAt = nextTeamTimestamp(team.projection)
        const next: TeamHumanActionSnapshot = { ...structuredClone(action), updatedAt,
          response: { expectedUpdatedAt: scope.input.expectedUpdatedAt, idempotencyKey: scope.input.idempotencyKey,
            answer: structuredClone(scope.input.answer), respondedBy: scope.humanId, acceptedAt: updatedAt } }
        await this.commitTeamCommand(team, [{ type: 'human-action/changed', action: next, createdAt: updatedAt }], 'TEAM_INVALID_ARGUMENT')
        return this.humanActionSnapshot(next)
      })
    })
  }

  override async unavailableHumanAction(request: TeamHumanActionResolveRequest): Promise<TeamHumanActionSnapshot> {
    return await this.admit(async () => {
      const { actor, ...raw } = request
      const input = teamHumanActionResolveInputSchema.parse(raw)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const team = this.requireLiveTeam(loaded)
        const validate = () => {
          const resolution = this.requireSystemHumanActionProof(actor)
          const scope = resolution.scope
          if (resolution.sourceName !== HOST_API_PROXY_HUMAN_ACTION_PROOF_SOURCE || scope.kind !== 'host-human-action-unavailable'
            || scope.teamId !== input.teamId || scope.expectedCursor !== input.expectedCursor) this.rejectHumanActionActor()
          const action = team.projection.humanActions.get(scope.action.id)
          if (action === undefined || !isDeepStrictEqual(action, scope.action) || action.phase !== 'pending') this.rejectHumanActionActor()
          return action
        }
        const action = validate()
        this.assertTeamCursor(team, input.expectedCursor)
        await this.authorizeOrThrow('human-action', team.id, { operation: 'continuation-unavailable', actionId: action.id }, action.participantId)
        validate()
        const updatedAt = nextTeamTimestamp(team.projection)
        const next: TeamHumanActionSnapshot = { ...structuredClone(action), phase: 'cancelled', updatedAt,
          outcome: { kind: 'unavailable', code: 'HUMAN_ACTION_CONTINUATION_UNAVAILABLE' } }
        const records: TeamJournalRecord[] = [{ type: 'human-action/changed', action: next, createdAt: updatedAt }]
        if (team.projection.team.phase === 'active' && team.projection.team.closure === undefined && team.projection.team.cancellation === undefined) {
          records.push({ type: 'team/phase', phase: 'stalled', createdAt: updatedAt,
            reason: { code: 'HUMAN_ACTION_CONTINUATION_UNAVAILABLE', message: `The Host cannot recover continuation for human action '${action.id}'` } })
        }
        await this.commitTeamCommand(team, records, 'TEAM_INVALID_ARGUMENT')
        return this.humanActionSnapshot(next)
      })
    })
  }

  /** Resolve one Host upsert proof to the exact pending action facts it owns. */
  private resolveHumanActionUpsertAuthority(
    team: LoadedTeam,
    actor: TeamSystemHumanActionProof,
    input: TeamHumanActionUpsertInput,
  ): TeamHumanActionSnapshot {
    const resolution = this.requireSystemHumanActionProof(actor)
    const scope = resolution.scope
    if (resolution.sourceName !== HOST_API_PROXY_HUMAN_ACTION_PROOF_SOURCE
      || scope.kind !== 'host-human-action-upsert'
      || scope.teamId !== team.id
      || scope.teamId !== input.teamId
      || scope.expectedCursor !== input.expectedCursor
      || scope.action.teamId !== team.id) {
      this.rejectHumanActionActor()
    }
    return structuredClone(scope.action)
  }

  /** Resolve one Host terminal-action proof to its exact retained pending action and outcome. */
  private resolveHumanActionResolveAuthority(
    team: LoadedTeam,
    actor: TeamSystemHumanActionProof,
    input: TeamHumanActionResolveInput,
  ): { readonly action: TeamHumanActionSnapshot; readonly phase: 'resolved' | 'cancelled'; readonly outcome: JsonObject } {
    const resolution = this.requireSystemHumanActionProof(actor)
    const scope = resolution.scope
    if (resolution.sourceName !== HOST_API_PROXY_HUMAN_ACTION_PROOF_SOURCE
      || scope.kind !== 'host-human-action-resolve'
      || scope.teamId !== team.id
      || scope.teamId !== input.teamId
      || scope.expectedCursor !== input.expectedCursor
      || scope.action.teamId !== team.id) {
      this.rejectHumanActionActor()
    }
    return {
      action: structuredClone(scope.action),
      phase: scope.phase,
      outcome: structuredClone(scope.outcome),
    }
  }

  /** Resolve a Host human-action proof before the Hub opens the selected Team journal. */
  private assertInitialHumanActionAuthority(
    actor: TeamSystemHumanActionProof,
    input: TeamHumanActionUpsertInput | TeamHumanActionResolveInput,
    operation: 'upsert' | 'resolve',
  ): void {
    const resolution = this.requireSystemHumanActionProof(actor)
    const scope = resolution.scope
    if (resolution.sourceName !== HOST_API_PROXY_HUMAN_ACTION_PROOF_SOURCE
      || scope.teamId !== input.teamId
      || scope.expectedCursor !== input.expectedCursor
      || (operation === 'upsert' && scope.kind !== 'host-human-action-upsert')
      || (operation === 'resolve' && scope.kind !== 'host-human-action-resolve')) {
      this.rejectHumanActionActor()
    }
  }

  /** Reject every forged, revoked, foreign, or wrong-operation Host human-action proof. */
  private rejectHumanActionActor(): never {
    throw new TeamError('Human action actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Record one activation-authorized provider/model usage fact and enforce the
   * frozen Team turn/token/cost ceilings. A repeated sample id is replaced
   * (chunk to final-message accounting) without double counting; crossing a
   * ceiling durably stalls the Team after the observed fact is retained.
   * @param request - runtime activation proof, cursor, and provider/model usage facts.
   * @returns the durable aggregate after acceptance or idempotent replay.
   */
  override async recordUsage(request: TeamUsageRecordRequest): Promise<TeamUsageSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamUsageRecordInputSchema.parse(untrustedInput)
      const issued = this.requireActivationActorProof(actor)
      const loaded = await this.ensureTeam(issued.activation.teamId)
      await loaded.queue.run(() => {
        const current = this.requireLiveTeam(loaded)
        const binding = this.requireCurrentActivationActorBinding(current, actor)
        this.requireActiveParticipant(current, binding.activation.participantId)
        return Promise.resolve()
      })
      await this.repairPendingParentCharges(loaded)
      const usage = await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        this.assertNoPendingParentCharges(current.projection)
        const binding = this.requireCurrentActivationActorBinding(current, actor)
        this.requireActiveParticipant(current, binding.activation.participantId)
        const sample = teamUsageSampleSchema.parse({
          ...input.sample,
          teamId: current.id,
          participantId: binding.activation.participantId,
          sessionId: binding.sessionId,
          observedAt: 0,
        })
        this.assertUsageTaskProvenance(current.projection, sample)
        const existing = current.projection.usageSamples.get(sample.id)
        if (existing !== undefined && !sameUsageSampleProvenance(existing, sample)) {
          throw new TeamError(`usage sample '${sample.id}' changed immutable provenance`, 'TEAM_INVALID_ARGUMENT')
        }
        // Replay compares normalized values; pricing errors retain their post-policy admission order.
        let pricedCost = sample.costUnits
        let pricingFailure: { readonly error: unknown } | undefined
        if (pricedCost === undefined) {
          try { pricedCost = usageCost(current.projection, sample) }
          catch (error: unknown) { pricingFailure = { error } }
        }
        const pricedSample = { ...sample, ...pricedCost === undefined ? {} : { costUnits: pricedCost } }
        if (existing !== undefined && pricingFailure === undefined && sameUsageSampleValue(existing, pricedSample)) {
          return structuredClone(current.projection.usage)
        }
        if (current.projection.team.phase === 'completed'
          || current.projection.team.phase === 'failed'
          || current.projection.team.phase === 'cancelled'
          || current.projection.team.closure !== undefined) {
          throw new TeamError(`Team '${current.id}' cannot accept usage after '${current.projection.team.phase}'`, 'TEAM_INVALID_ARGUMENT')
        }
        this.assertTeamCursor(current, input.expectedCursor)
        await this.authorizeOrThrow('usage', current.id, {
          sampleId: sample.id,
          participantId: sample.participantId,
          sessionId: sample.sessionId,
          turn: sample.turn,
          step: sample.step,
          usage: structuredClone(sample.usage) as unknown as JsonObject,
          ...sample.costUnits === undefined ? {} : { costUnits: sample.costUnits },
        }, sample.participantId)
        const createdAt = nextTeamTimestamp(current.projection)
        if (pricingFailure !== undefined) throw pricingFailure.error
        if (pricedCost === undefined && usageCostRequired(current.projection, sample.participantId, sample.taskId)) {
          throw new TeamError(
            `usage sample '${sample.id}' has no provider cost or frozen pricing while a cost ceiling is active`,
            'TEAM_BUDGET_INVALID',
          )
        }
        const normalized: TeamUsageSample = {
          ...structuredClone(pricedSample),
          observedAt: createdAt,
        }
        const samples = new Map(current.projection.usageSamples)
        samples.set(normalized.id, normalized)
        const usage = usageFromSamplesAndCharges(samples, current.projection.usageCharges)
        const records: TeamJournalRecord[] = [{
          type: 'usage/changed', sample: normalized, usage, createdAt,
        }]
        if (current.projection.team.parentTeamId !== undefined) {
          const parentTaskId = current.projection.team.parentTaskId
          if (parentTaskId === undefined) throw new TeamError('Child usage has no owning parent task', 'TEAM_PARENT_USAGE_PENDING')
          records.push({
            type: 'usage/parent-charge-pending',
            charge: usageChargeForSample(current.id, parentTaskId, normalized, createdAt),
            createdAt,
          })
        }
        const budget = usageBudgetExceeded(current.projection, usage)
          ?? (sample.taskId === undefined ? undefined : taskBudgetExceeded(
            current.projection.tasks.get(sample.taskId), samples, createdAt, current.projection.usageCharges,
          ))
        if (budget !== undefined && (current.projection.team.phase === 'active' || current.projection.team.phase === 'quiescing')) {
          records.push({ type: 'team/phase', phase: 'stalled', reason: budget, createdAt })
        }
        this.requireCurrentActivationActorBinding(current, actor)
        await this.commitTeamCommand(current, records, 'TEAM_INVALID_ARGUMENT')
        return structuredClone(current.projection.usage)
      })
      await this.repairPendingParentCharges(loaded)
      return usage
    })
  }

  /**
   * Discover a bounded page of materialized, non-archived Team journals.
   * @param request - provider-order cursor and requested page size.
   * @returns detached Team summaries and a continuation cursor when needed.
   */
  override async listTeamsPage(request: TeamListPageRequest): Promise<TeamListPage> {
    return await this.admit(async () => {
      const input = teamListPageRequestSchema.parse(request)
      let page
      try {
        page = await this.ctx.storageLog.scanNames({ prefix: 'team/', limit: this.pageLimit(input.limit),
          ...input.afterCursor === -1 ? {} : { afterCursor: input.afterCursor as string as LogNameScanCursor } })
      } catch (error: unknown) {
        if (error instanceof StorageLogError && error.code === 'scan-expired') {
          throw new TeamError('Team discovery cursor expired; restart from -1', 'TEAM_DISCOVERY_CURSOR_EXPIRED', { cause: error })
        }
        if (error instanceof StorageLogError && (error.code === 'scan-invalid' || error.code === 'scan-limit')) {
          throw new TeamError(error.message, error.code === 'scan-limit' ? 'TEAM_CHANNEL_BACKPRESSURE' : 'TEAM_INVALID_ARGUMENT', { cause: error })
        }
        throw error
      }
      const items: TeamSnapshot[] = []
      for (const name of page.names) {
        const teamId = teamIdSchema.parse(name.slice('team/'.length))
        let summary
        try {
          summary = await this.ctx.storageLog.readSummary({ name, version: TEAM_JOURNAL_FORMAT_VERSION }, this.config.maxDiscoveryBytes)
        } catch (error: unknown) {
          if (error instanceof Error && 'code' in error && error.code === 'version-mismatch') {
            throw new TeamHubError(`Team journal '${name}' has an unsupported format`, 'TEAM_JOURNAL_MALFORMED', { cause: error })
          }
          throw error
        }
        if (summary === undefined) {
          if (!await this.ctx.storageLog.hasStream(name)) continue
          throw new TeamHubError(`Team journal '${name}' has no current discovery summary`, 'TEAM_JOURNAL_MALFORMED')
        }
        const parsed = teamSnapshotSchema.safeParse(summary.value)
        if (!parsed.success || parsed.data.id !== teamId || parsed.data.cursor !== summary.sequence) {
          throw new TeamHubError(`Team journal '${name}' has invalid discovery identity or cursor`, 'TEAM_JOURNAL_MALFORMED')
        }
        if (parsed.data.archivedAt === undefined) items.push(parsed.data)
      }
      return freeze(teamListPageSchema.parse({ items, scanned: page.scanned,
        ...page.nextCursor === undefined ? {} : { nextCursor: teamDiscoveryCursorSchema.parse(page.nextCursor) } }))
    })
  }

  /** Archive one terminal Team through a current system or authenticated-human runtime proof. */
  override async archiveTeam(request: TeamArchiveRequest): Promise<TeamStateSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamArchiveInputSchema.parse(untrustedInput)
      const human = this.isHumanArchiveActor(actor, input)
      if (human) {
        const loaded = await this.ensureTeam(input.teamId)
        return await loaded.queue.run(async () => {
          const authority = this.resolveHumanArchiveAuthority(loaded, actor, input)
          const current = this.requireLiveTeam(loaded)
          if (current.projection.team.archivedAt !== undefined) return this.teamState(current.projection)
          this.assertTeamCursor(current, input.expectedCursor)
          const phase = current.projection.team.phase
          if (phase !== 'completed' && phase !== 'failed' && phase !== 'cancelled') {
            throw new TeamError(`Team '${input.teamId}' cannot be archived from '${phase}'`, 'TEAM_INVALID_ARGUMENT')
          }
          await this.authorizeOrThrow('close', input.teamId, {
            operation: 'terminal-archive',
            phase: 'archived',
            expectedCursor: input.expectedCursor,
            sourceName: authority.sourceName,
          }, authority.actorId)
          this.resolveHumanArchiveAuthority(loaded, actor, input)
          await this.commitTeamCommand(current, [{ type: 'team/archived', createdAt: nextTeamTimestamp(current.projection) }], 'TEAM_INVALID_ARGUMENT')
          return this.teamState(current.projection)
        })
      }
      const authority = this.requireArchiveAuthority(actor, input)
      const loaded = await this.ensureTeam(authority.input.teamId)
      return await loaded.queue.run(async () => {
        const authorized = authority.revalidate()
        const current = this.requireLiveTeam(loaded)
        if (current.projection.team.archivedAt !== undefined) return this.teamState(current.projection)
        this.assertTeamCursor(current, authorized.expectedCursor)
        const phase = current.projection.team.phase
        if (phase !== 'completed' && phase !== 'failed' && phase !== 'cancelled') {
          throw new TeamError(`Team '${input.teamId}' cannot be archived from '${phase}'`, 'TEAM_INVALID_ARGUMENT')
        }
        await this.authorizeOrThrow('close', input.teamId, {
          operation: 'terminal-archive',
          phase: 'archived',
          expectedCursor: authorized.expectedCursor,
          sourceName: authority.sourceName,
        })
        authority.revalidate()
        await this.commitTeamCommand(current, [{ type: 'team/archived', createdAt: nextTeamTimestamp(current.projection) }], 'TEAM_INVALID_ARGUMENT')
        return this.teamState(current.projection)
      })
    })
  }

  /** Authorize one active human to keep a recoverable Team resume operation live through coordinator publication. */
  override async authorizeHumanResume(request: TeamHumanResumeRequest): Promise<TeamHumanResumeAuthorization> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamResumeInputSchema.parse(untrustedInput)
      this.assertHumanResumeActor(actor, input)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const authority = this.resolveHumanResumeAuthority(current, actor, input)
        this.assertTeamCursor(current, input.expectedCursor)
        await this.authorizeOrThrow('activate', input.teamId, {
          operation: 'team-resume',
          expectedCursor: input.expectedCursor,
          phase: current.projection.team.phase,
          sourceName: authority.sourceName,
        }, authority.actorId)
        this.resolveHumanResumeAuthority(current, actor, input)
        this.assertTeamCursor(current, input.expectedCursor)
        let closed = false
        const authorization: TeamHumanResumeAuthorization = Object.freeze({
          isLive: (): boolean => !closed && this.isLiveHumanResumeActor(actor, input),
          assert: (): Promise<TeamStateSnapshot> => this.admit(async () => {
            if (closed) this.rejectHumanResumeActor()
            this.assertHumanResumeActor(actor, input)
            const selected = await this.ensureTeam(input.teamId)
            return await selected.queue.run(() => {
              if (closed) this.rejectHumanResumeActor()
              this.resolveHumanResumeAuthority(this.requireLiveTeam(selected), actor, input)
              return Promise.resolve(this.teamState(this.requireLiveTeam(selected).projection))
            })
          }),
          close: (): void => { closed = true },
        }) as TeamHumanResumeAuthorization
        return authorization
      })
    })
  }

  /** Read one source-specific audit page without changing Team or channel state. */
  override async readAudit(request: TeamAuditReadRequest): Promise<TeamAuditReadResult> {
    return await this.admit(async () => {
      const input = teamAuditReadRequestSchema.parse(request)
      if (input.limit > this.config.recoveryPageSize) {
        throw new TeamError(
          `Team audit page limit ${input.limit} exceeds recoveryPageSize ${this.config.recoveryPageSize}`,
          'TEAM_INVALID_ARGUMENT',
        )
      }
      const team = await this.ensureTeam(input.teamId)
      return await team.queue.run(async () => {
        const currentTeam = this.requireLiveTeam(team)
        if (input.channelId === undefined) {
          const audit = await this.repairAuditForRead(input.teamId, 'team', currentTeam.stream)
          return await this.readAuditPage(audit, input, 'team')
        }
        const channel = await this.ensureChannel(input.channelId)
        this.assertAttachedChannel(currentTeam, channel)
        return await channel.queue.run(async () => {
          const audit = await this.repairAuditForRead(input.teamId, 'channel', channel.stream, input.channelId)
          return await this.readAuditPage(audit, input, 'channel', input.channelId)
        })
      })
    })
  }

  /** Read one contiguous page from an already repaired audit projection. */
  private async readAuditPage(
    stream: HubLogStream,
    request: TeamAuditReadRequest,
    source: 'team' | 'channel',
    channelId?: ChannelId,
  ): Promise<TeamAuditReadResult> {
    let entries: readonly { readonly sequence: number; readonly value: unknown }[]
    try {
      entries = await stream.read(request.afterCursor, request.limit + 1)
    } catch (error: unknown) {
      if (isCompacted(error)) {
        throw new TeamError(
          `audit projection for ${source} stream no longer retains cursor ${request.afterCursor}`,
          'TEAM_AUDIT_COMPACTED',
          {
            cause: error,
            details: {
              teamId: request.teamId,
              ...channelId === undefined ? {} : { channelId },
              firstCursor: stream.firstSequence,
            },
          },
        )
      }
      throw error
    }
    let expected = request.afterCursor
    const items: TeamAuditEntry[] = []
    const sourceFields = source === 'channel' && channelId !== undefined ? { channelId } : {}
    const malformedCode = source === 'channel' ? 'TEAM_CHANNEL_WAL_MALFORMED' : 'TEAM_JOURNAL_MALFORMED'
    for (const [index, entry] of entries.entries()) {
      if (entry.sequence !== expected + 1) {
        throw new TeamHubError(`${source} audit stream has a cursor gap at ${entry.sequence}`, malformedCode)
      }
      expected = entry.sequence
      const audit = parseAuditEntry(entry.value, request.teamId, source, channelId)
      if (audit.cursor !== entry.sequence) {
        throw new TeamHubError(`${source} audit record cursor disagrees with storage`, malformedCode)
      }
      if (index < request.limit) {
        items.push(audit)
      }
    }
    return freeze(teamAuditReadResultSchema.parse({
      teamId: request.teamId,
      ...sourceFields,
      ...stream.firstSequence === 0 ? {} : { firstCursor: stream.firstSequence },
      items,
      ...entries.length > request.limit && items.length > 0 ? { nextCursor: items.at(-1)?.cursor } : {},
    }))
  }

  /**
   * Open and repair one audit projection before a read or post-commit
   * observation uses it. Audit records are rebuildable; the Team or channel
   * stream remains the only business authority.
   */
  private async repairAuditProjection(
    teamId: TeamId,
    source: 'team' | 'channel',
    sourceStream: HubLogStream,
    channelId?: ChannelId,
  ): Promise<HubLogStream> {
    const name = auditStreamName(teamId, channelId)
    const queue = this.auditQueues.get(name) ?? new SerialQueue()
    this.auditQueues.set(name, queue)
    return await queue.run(async () => {
      const audit = await this.openAuditStream(name)
      if (!this.validatedAuditStreams.has(name)) {
        await this.validateAuditProjection(audit, sourceStream, teamId, source, channelId)
        this.validatedAuditStreams.add(name)
      }
      if (audit.tailSequence > sourceStream.tailSequence) {
        throw new TeamHubError(
          `${source} audit projection '${name}' is ahead of its source stream`,
          source === 'channel' ? 'TEAM_CHANNEL_WAL_MALFORMED' : 'TEAM_JOURNAL_MALFORMED',
        )
      }
      let cursor = audit.tailSequence
      while (cursor < sourceStream.tailSequence) {
        const entries = await sourceStream.read(cursor, this.config.recoveryPageSize)
        if (entries.length === 0) {
          throw new TeamHubError(
            `${source} audit projection '${name}' could not read source suffix after ${String(cursor)}`,
            source === 'channel' ? 'TEAM_CHANNEL_WAL_MALFORMED' : 'TEAM_JOURNAL_MALFORMED',
          )
        }
        const values: TeamAuditEntry[] = []
        for (const entry of entries) {
          if (entry.sequence !== cursor + 1) {
            throw new TeamHubError(
              `${source} audit source has a cursor gap at ${entry.sequence}`,
              source === 'channel' ? 'TEAM_CHANNEL_WAL_MALFORMED' : 'TEAM_JOURNAL_MALFORMED',
            )
          }
          let record: TeamJournalRecord | ChannelRecord
          if (source === 'team') {
            record = parseTeamRecord(entry.value, teamId)
          } else {
            if (channelId === undefined) {
              throw new TeamHubError('channel audit repair omitted its channel id', 'TEAM_CHANNEL_WAL_MALFORMED')
            }
            record = parseChannelRecord(entry.value, channelId)
          }
          values.push(auditEntryForRecord(record, teamId, source, entry.sequence, channelId))
          cursor = entry.sequence
        }
        const expected = audit.tailSequence
        let appended: Awaited<ReturnType<HubLogStream['append']>>
        try {
          appended = await audit.append(expected, values)
        } catch (error: unknown) {
          if (isSequenceConflict(error)) {
            try {
              await this.resetAuditStream(name, audit)
            } catch (cleanupError: unknown) {
              throw new AggregateError([error, cleanupError], `audit projection '${name}' conflict cleanup failed`)
            }
          }
          throw error
        }
        if (appended.tailSequence !== cursor) {
          throw new TeamHubError(
            `${source} audit projection '${name}' append returned an unexpected tail`,
            source === 'channel' ? 'TEAM_CHANNEL_WAL_MALFORMED' : 'TEAM_JOURNAL_MALFORMED',
          )
        }
      }
      return audit
    })
  }

  /** Open one Hub-owned audit stream once per source identity. */
  private async openAuditStream(name: string): Promise<HubLogStream> {
    const existing = this.auditStreams.get(name)
    if (existing !== undefined) return existing
    const stream = await this.ctx.storageLog.open({ name, version: AUDIT_PROJECTION_FORMAT_VERSION })
    this.auditStreams.set(name, stream)
    return stream
  }

  /** Drop a stale local audit handle after another Hub advanced its stream. */
  private async resetAuditStream(name: string, stream: HubLogStream): Promise<void> {
    if (this.auditStreams.get(name) !== stream) return
    this.auditStreams.delete(name)
    this.validatedAuditStreams.delete(name)
    await stream.close()
  }

  /** Validate every existing audit entry before a projection becomes trusted. */
  private async validateAuditProjection(
    stream: HubLogStream,
    sourceStream: HubLogStream,
    teamId: TeamId,
    source: 'team' | 'channel',
    channelId?: ChannelId,
  ): Promise<void> {
    let cursor = stream.firstSequence - 1
    while (true) {
      const entries = await stream.read(cursor, this.config.recoveryPageSize)
      if (entries.length === 0) return
      for (const entry of entries) {
        if (entry.sequence !== cursor + 1) {
          throw new TeamHubError(
            `${source} audit projection has a cursor gap at ${entry.sequence}`,
            source === 'channel' ? 'TEAM_CHANNEL_WAL_MALFORMED' : 'TEAM_JOURNAL_MALFORMED',
          )
        }
        const audit = parseAuditEntry(entry.value, teamId, source, channelId)
        if (audit.cursor !== entry.sequence) {
          throw new TeamHubError(
            `${source} audit record cursor disagrees with storage`,
            source === 'channel' ? 'TEAM_CHANNEL_WAL_MALFORMED' : 'TEAM_JOURNAL_MALFORMED',
          )
        }
        let sourceEntries: readonly { readonly sequence: number; readonly value: unknown }[]
        try {
          sourceEntries = await sourceStream.read(audit.cursor - 1, 1)
        } catch (error: unknown) {
          if (isCompacted(error)) {
            throw new TeamHubError(
              `${source} audit entry ${audit.cursor} no longer has a retained source record`,
              source === 'channel' ? 'TEAM_CHANNEL_WAL_MALFORMED' : 'TEAM_JOURNAL_MALFORMED',
              { cause: error },
            )
          }
          throw error
        }
        const sourceEntry = sourceEntries[0]
        if (sourceEntry === undefined || sourceEntry.sequence !== audit.cursor) {
          throw new TeamHubError(
            `${source} audit entry ${audit.cursor} has no matching source record`,
            source === 'channel' ? 'TEAM_CHANNEL_WAL_MALFORMED' : 'TEAM_JOURNAL_MALFORMED',
          )
        }
        let sourceRecord: TeamJournalRecord | ChannelRecord
        if (source === 'team') {
          sourceRecord = parseTeamRecord(sourceEntry.value, teamId)
        } else {
          if (channelId === undefined) {
            throw new TeamHubError('channel audit validation omitted its channel id', 'TEAM_CHANNEL_WAL_MALFORMED')
          }
          sourceRecord = parseChannelRecord(sourceEntry.value, channelId)
        }
        if (!isDeepStrictEqual(audit, auditEntryForRecord(sourceRecord, teamId, source, audit.cursor, channelId))) {
          throw new TeamHubError(
            `${source} audit entry ${audit.cursor} disagrees with its source record`,
            source === 'channel' ? 'TEAM_CHANNEL_WAL_MALFORMED' : 'TEAM_JOURNAL_MALFORMED',
          )
        }
        cursor = entry.sequence
      }
    }
  }

  /** Preserve a committed audit failure without changing the business result. */
  private async maintainAuditProjection(
    teamId: TeamId,
    source: 'team' | 'channel',
    sourceStream: HubLogStream,
    channelId?: ChannelId,
  ): Promise<void> {
    try {
      await this.repairAuditProjection(teamId, source, sourceStream, channelId)
      this.incrementMetric('auditProjectionRepairs')
    } catch (error: unknown) {
      this.incrementMetric('auditProjectionFailures')
      this.ctx.logger.warn(`team-hub: ${source} audit projection repair failed after durable commit: ${renderError(error)}`)
    }
  }

  /** Repair an audit projection for a caller and expose the outcome in metrics. */
  private async repairAuditForRead(
    teamId: TeamId,
    source: 'team' | 'channel',
    sourceStream: HubLogStream,
    channelId?: ChannelId,
  ): Promise<HubLogStream> {
    try {
      const projection = await this.repairAuditProjection(teamId, source, sourceStream, channelId)
      this.incrementMetric('auditProjectionRepairs')
      return projection
    } catch (error: unknown) {
      this.incrementMetric('auditProjectionFailures')
      throw error
    }
  }

  /**
   * Wait for a Team journal to advance past an observed cursor.
   * @param request - Team and exclusive observed cursor.
   * @returns an advanced cursor or a closed result.
   */
  override async watchTeam(request: TeamWatchRequest): Promise<TeamWatchResult> {
    return await this.admit(async () => {
      const { signal, ...wire } = request
      const input = teamWatchRequestSchema.parse(wire)
      if (this.closing) return freeze({ kind: 'closed' as const })
      try {
        const loaded = await this.ensureTeam(input.teamId, false)
        const registered = await loaded.queue.run(() => {
          if (this.closing) return Promise.resolve({ wait: Promise.resolve<TeamWatchResult>({ kind: 'closed' }) })
          const team = this.requireLiveTeam(loaded).projection.team
          const wait = team.archivedAt !== undefined
            ? Promise.resolve<TeamWatchResult>(team.cursor > input.afterCursor ? { kind: 'changed', cursor: team.cursor } : { kind: 'closed' })
            : loaded.activity.wait(team.cursor, input.afterCursor, signal)
          return Promise.resolve({ wait })
        })
        return freeze(await registered.wait)
      } catch (error: unknown) {
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- disposal may begin while this admitted watch awaits recovery.
        if (this.closing && error instanceof TeamError && error.code === 'TEAM_DISPOSED') return freeze({ kind: 'closed' as const })
        throw error
      }
    })
  }

  /**
   * Compare-and-set one Team lifecycle transition.
   * @param request - Team, observed journal cursor, and next phase.
   * @returns the detached Team state after durable acceptance.
   */
  override async transitionTeamPhase(request: TeamPhaseTransitionRequest): Promise<TeamStateSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamPhaseTransitionInputSchema.parse(untrustedInput)
      const initial = this.requireSystemPhaseProof(actor)
      if (initial.scope.teamId !== input.teamId) this.rejectPhaseActor()
      const loaded = await this.ensureTeam(input.teamId)
      const finalChannel = initial.scope.kind === 'team-run-finalization-quiesce'
        ? await this.ensureAttachedChannel(initial.scope.finalChannelId)
        : undefined
      const transition = async (): Promise<TeamStateSnapshot> => {
        const current = this.requireLiveTeam(loaded)
        const resolution = this.requireSystemPhaseProof(actor)
        const actorName = await this.resolvePhaseAuthority(current, resolution, input, finalChannel)
        const cancellationStall = resolution.scope.kind === 'activation-controller-cancellation-stall'
          || resolution.scope.kind === 'activation-controller-closure-stall'
          || resolution.scope.kind === 'activation-controller-startup-stall'
        if ((current.projection.team.closure !== undefined || current.projection.team.cancellation !== undefined)
          && !cancellationStall) {
          throw new TeamError(`Team '${current.id}' has a typed lifecycle intent; use its lifecycle command`, 'TEAM_INVALID_ARGUMENT')
        }
        this.assertTeamCursor(current, input.expectedCursor)
        if (resolution.scope.kind === 'team-run-finalization-quiesce'
          && current.projection.team.phase === 'quiescing') {
          return this.teamState(current.projection)
        }
        if ((cancellationStall || resolution.scope.kind === 'activation-controller-recovery-stall') && current.projection.team.phase === 'stalled'
          && isDeepStrictEqual(current.projection.team.stallReason, input.reason)) {
          return this.teamState(current.projection)
        }
        await this.authorizeOrThrow('close', input.teamId, {
          phase: input.phase,
          expectedCursor: input.expectedCursor,
          actor: { kind: 'system', name: actorName },
          ...resolution.scope.kind === 'team-run-finalization-quiesce' ? {
            operation: 'finalization-admission',
            finalChannelId: resolution.scope.finalChannelId,
            finalEnvelopeId: resolution.scope.finalEnvelopeId,
            humanId: resolution.scope.humanId,
            coordinatorId: resolution.scope.coordinatorId,
          } : resolution.scope.kind === 'activation-controller-cancellation-stall' || resolution.scope.kind === 'activation-controller-recovery-stall' ? {
            operation: resolution.scope.kind === 'activation-controller-recovery-stall' ? 'activation-recovery-unconfirmed' : 'cancellation-termination-unconfirmed',
            activationId: resolution.scope.activationId,
            participantId: resolution.scope.participantId,
            sessionId: resolution.scope.sessionId,
            provider: resolution.scope.provider,
          } : {},
          ...input.reason === undefined ? {} : { reason: structuredClone(input.reason) },
        })
        const beforeCommit = this.requireSystemPhaseProof(actor)
        await this.resolvePhaseAuthority(current, beforeCommit, input, finalChannel)
        const createdAt = nextTeamTimestamp(current.projection)
        await this.commitTeamCommand(current, [{
          type: 'team/phase',
          phase: input.phase,
          ...input.reason === undefined ? {} : { reason: structuredClone(input.reason) },
          createdAt,
        }], 'TEAM_INVALID_ARGUMENT')
        return this.teamState(current.projection)
      }
      return finalChannel === undefined
        ? await loaded.queue.run(transition)
        : await loaded.queue.run(async () => await finalChannel.queue.run(transition))
    })
  }

  /**
   * Revalidate a source-owned phase proof under the Team serializer and
   * reduce it to the only system attribution that may reach close policy.
   */
  private async resolvePhaseAuthority(
    team: LoadedTeam,
    resolution: TeamSystemPhaseProofResolution,
    input: {
      readonly teamId: TeamId
      readonly expectedCursor: number
      readonly phase: TeamPhaseTransitionRequest['phase']
      readonly reason?: TeamPhaseTransitionRequest['reason']
    },
    finalChannel: LoadedChannel | undefined,
  ): Promise<string> {
    const scope = resolution.scope
    if (scope.teamId !== team.id) this.rejectPhaseActor()
    switch (scope.kind) {
      case 'team-run-resume':
        if (resolution.sourceName !== TEAM_RUN_PHASE_PROOF_SOURCE
          || input.phase !== 'active'
          || input.reason !== undefined
          || team.projection.team.phase !== 'stalled') {
          this.rejectPhaseActor()
        }
        return TEAM_RUN_PHASE_PROOF_SOURCE
      case 'team-run-finalization-quiesce':
        if (resolution.sourceName !== TEAM_RUN_PHASE_PROOF_SOURCE
          || input.phase !== 'quiescing'
          || input.reason !== undefined
          || scope.expectedCursor !== input.expectedCursor) {
          this.rejectPhaseActor()
        }
        await this.resolveTeamRunFinalizationQuiescePhaseAuthority(team, finalChannel, scope)
        return TEAM_RUN_PHASE_PROOF_SOURCE
      case 'scheduler-stall':
        if (resolution.sourceName !== TEAM_SCHEDULER_PHASE_PROOF_SOURCE
          || input.phase !== 'stalled'
          || input.reason === undefined
          || !isDeepStrictEqual(input.reason, scope.reason)
          || team.projection.team.phase !== 'active') {
          this.rejectPhaseActor()
        }
        return TEAM_SCHEDULER_PHASE_PROOF_SOURCE
      case 'activation-controller-cancellation-stall':
        if (resolution.sourceName !== TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE
          || input.phase !== 'stalled'
          || input.reason === undefined
          || !isDeepStrictEqual(input.reason, scope.reason)
          || scope.expectedCursor !== input.expectedCursor) {
          this.rejectPhaseActor()
        }
        this.resolveActivationControllerCancellationStallPhaseAuthority(team, scope)
        return TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE
      case 'activation-controller-recovery-stall': {
        const current = team.projection.team
        const binding = team.projection.activations.get(scope.activationId)
        const latest = [...team.projection.activations.values()]
          .findLast(candidate => candidate.activation.participantId === scope.participantId)
        if (resolution.sourceName !== TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE
          || input.phase !== 'stalled' || scope.expectedCursor !== input.expectedCursor
          || !isDeepStrictEqual(input.reason, scope.reason)
          || ![
            'SUPERVISOR_UNAVAILABLE', 'SUPERVISOR_INVALID', 'SUPERVISOR_GENERATION_MISMATCH',
            'SUPERVISOR_UNREACHABLE', 'SUPERVISOR_UNKNOWN', 'SUPERVISOR_TERMINATION_UNCONFIRMED',
            'AGENT_RUNTIME_PROVIDER_UNAVAILABLE', 'AGENT_RUNTIME_FENCER_UNAVAILABLE', 'AGENT_RUNTIME_FENCE_FAILED',
          ].includes(scope.reason.code)
          || (current.phase !== 'active' && !(current.phase === 'stalled' && isDeepStrictEqual(current.stallReason, scope.reason)))
          || current.closure !== undefined || current.cancellation !== undefined
          || binding === undefined || latest?.activation.id !== scope.activationId
          || !this.activationScopeMatchesBinding(team, binding, scope)
          || (scope.supervisor === undefined
            ? binding.recovery?.supervisor !== undefined
            : !isDeepStrictEqual(binding.recovery?.supervisor, scope.supervisor)
              || scope.supervisor.generation !== scope.activationId)) this.rejectPhaseActor()
        this.assertTeamCursor(team, scope.expectedCursor)
        return TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE
      }
      case 'activation-controller-startup-stall': {
        const current = team.projection.team
        const intent = scope.closureKind === 'cancel' ? current.cancellation : current.closure
        const reservation = team.projection.participants.get(scope.participantId)?.activationReservation
        if (resolution.sourceName !== TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE || input.phase !== 'stalled'
          || !isDeepStrictEqual(input.reason, scope.reason) || scope.expectedCursor !== input.expectedCursor
          || (current.phase !== 'quiescing' && current.phase !== 'stalled') || intent === undefined
          || (scope.closureKind !== 'cancel' && current.closure?.kind !== scope.closureKind)
          || intent.idempotencyKey !== scope.idempotencyKey || intent.requestedAt !== scope.requestedAt
          || reservation?.id !== scope.reservationId || reservation.releasedAt !== undefined
          || reservation.sessionId !== scope.sessionId || reservation.provider !== scope.provider
          || [...team.projection.activations.values()].some(binding => binding.reservationId === scope.reservationId)) {
          this.rejectPhaseActor()
        }
        this.assertTeamCursor(team, scope.expectedCursor)
        return TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE
      }
      case 'activation-controller-closure-stall': {
        const current = team.projection.team
        const intent = scope.closureKind === 'cancel' ? current.cancellation : current.closure
        const binding = team.projection.activations.get(scope.activationId)
        if (resolution.sourceName !== TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE
          || input.phase !== 'stalled'
          || !isDeepStrictEqual(input.reason, scope.reason)
          || scope.expectedCursor !== input.expectedCursor
          || (current.phase !== 'quiescing' && current.phase !== 'stalled')
          || intent === undefined
          || (scope.closureKind !== 'cancel' && current.closure?.kind !== scope.closureKind)
          || intent.idempotencyKey !== scope.idempotencyKey
          || intent.requestedAt !== scope.requestedAt
          || binding === undefined
          || !this.activationScopeMatchesBinding(team, binding, scope)
          || (binding.quiescedAt !== undefined
            && ![...team.projection.workspaceAllocations.values()].some(allocation =>
              allocation.activationId === scope.activationId && allocation.lifecycle === 'preserved'))) {
          this.rejectPhaseActor()
        }
        this.assertTeamCursor(team, scope.expectedCursor)
        return TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE
      }
      /* v8 ignore next -- TeamSystemPhaseScope is closed and every phase operation is handled above. */
      default:
        scope satisfies never
        return this.rejectPhaseActor()
    }
  }

  /** Validate TeamRun's exact human-receipted final before it fences new channel admission. */
  private async resolveTeamRunFinalizationQuiescePhaseAuthority(
    team: LoadedTeam,
    finalChannel: LoadedChannel | undefined,
    scope: Extract<TeamSystemPhaseScope, { readonly kind: 'team-run-finalization-quiesce' }>,
  ): Promise<void> {
    if (finalChannel === undefined) return this.rejectPhaseActor()
    const channel = this.requireLiveChannel(finalChannel)
    const human = team.projection.participants.get(scope.humanId)
    const coordinator = team.projection.participants.get(scope.coordinatorId)
    const members = channel.projection.manifest.participants
    if (team.projection.team.cursor !== scope.expectedCursor
      || (team.projection.team.phase !== 'active' && team.projection.team.phase !== 'quiescing')
      || team.projection.team.cancellation !== undefined
      || team.projection.team.closure !== undefined
      || !team.projection.channelIds.has(scope.finalChannelId)
      || channel.projection.manifest.teamId !== team.id
      || (team.projection.team.phase === 'active' && channel.projection.phase !== 'active')
      || (team.projection.team.phase === 'quiescing'
        && channel.projection.phase !== 'active'
        && channel.projection.phase !== 'closed'
        && channel.projection.phase !== 'expired'
        && channel.projection.phase !== 'failed')
      || channel.projection.manifest.adapter.type !== DIRECT_CHANNEL_V4_ADAPTER.type
      || channel.projection.manifest.adapter.version !== DIRECT_CHANNEL_V4_ADAPTER.version
      || members.length !== 2
      || scope.humanId === scope.coordinatorId
      || human?.kind !== 'human'
      || human.role !== 'human'
      || human.phase !== 'active'
      || coordinator?.kind !== 'local-agent'
      || coordinator.role !== 'coordinator'
      || coordinator.phase !== 'active'
      || !members.some(member => member.id === scope.humanId && member.role === 'human')
      || !members.some(member => member.id === scope.coordinatorId && member.role === 'coordinator')) {
      return this.rejectPhaseActor()
    }
    try {
      const final = await this.requireFinalEnvelope(team, channel, scope.finalEnvelopeId)
      if (final.senderId !== scope.coordinatorId
        || final.audience[0] !== scope.humanId) {
        this.rejectPhaseActor()
      }
    } catch (error: unknown) {
      if (error instanceof TeamError && (error.code === 'TEAM_FINAL_INVALID' || error.code === 'TEAM_CHANNEL_NOT_FOUND')) {
        return this.rejectPhaseActor()
      }
      throw error
    }
    this.assertFinalizationAdmissionQuiescence(team)
  }

  /** Verify that the controller still owns the stopping remote epoch blocking this exact cancellation. */
  private resolveActivationControllerCancellationStallPhaseAuthority(
    team: LoadedTeam,
    scope: Extract<TeamSystemPhaseScope, { readonly kind: 'activation-controller-cancellation-stall' }>,
  ): void {
    const current = team.projection.team
    const cancellation = current.cancellation
    const binding = team.projection.activations.get(scope.activationId)
    if ((current.phase !== 'quiescing' && current.phase !== 'stalled')
      || current.closure !== undefined
      || cancellation === undefined
      || cancellation.idempotencyKey !== scope.cancellationIdempotencyKey
      || cancellation.requestedAt !== scope.cancellationRequestedAt
      || (current.phase === 'stalled' && !isDeepStrictEqual(current.stallReason, scope.reason))
      || binding === undefined
      || binding.activation.teamId !== team.id
      || binding.activation.id !== scope.activationId
      || binding.activation.participantId !== scope.participantId
      || binding.activation.status !== 'stopping'
      || binding.sessionId !== scope.sessionId
      || binding.provider !== scope.provider) {
      this.rejectPhaseActor()
    }
    this.assertTeamCursor(team, scope.expectedCursor)
  }

  /** Reject every forged, stale, cross-Team, or mismatched phase authority uniformly. */
  private rejectPhaseActor(): never {
    throw new TeamError('Team phase actor is invalid for this transition', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Persist the selected final in the closed TeamRun result sink before any human receipt. */
  override async admitTeamFinalResult(request: TeamFinalAdmissionRequest): Promise<TeamFinalAdmission> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const resolution = this.requireSystemFinalReceiptProof(actor)
      const input = teamFinalAdmissionInputSchema.parse(untrustedInput)
      if (resolution.sourceName !== TEAM_RUN_FINAL_RECEIPT_PROOF_SOURCE
        || resolution.scope.teamId !== input.teamId || resolution.scope.channelId !== input.channelId) {
        this.rejectReceiptActor()
      }
      const team = await this.ensureTeam(input.teamId)
      const channel = await this.ensureAttachedChannel(input.channelId)
      return await team.queue.run(async () => await channel.queue.run(async () => {
        const current = this.requireLiveTeam(team)
        const liveChannel = this.requireLiveChannel(channel)
        const receiptInput = { channelId: input.channelId, envelopeId: input.envelopeId, expectedCursor: liveChannel.projection.cursor }
        const recipientId = await this.resolveTeamRunFinalReceiptRecipient(current, liveChannel, actor, receiptInput)
        this.assertAttachedChannel(current, liveChannel)
        const final = await this.requireFinalEnvelope(current, liveChannel, input.envelopeId, false)
        let candidate = this.finalAdmissionFor(
          current, final, recipientId, input.idempotencyKey, current.projection.finalAdmission?.inboxSequence,
        )
        if (candidate.envelopeSequence !== input.envelopeSequence || candidate.contentFingerprint !== input.contentFingerprint) {
          throw new TeamError('final admission does not match committed Envelope content', 'TEAM_FINAL_INVALID')
        }
        const prior = current.projection.finalAdmission
        if (prior !== null) {
          if (!isDeepStrictEqual({ ...prior, admittedAt: candidate.admittedAt }, candidate)) {
            throw new TeamError('Team final-result retry conflicts with its accepted result', 'TEAM_FINAL_INVALID')
          }
          await this.resolveTeamRunFinalReceiptRecipient(current, liveChannel, actor, receiptInput)
          return freeze(structuredClone(prior))
        }
        await this.assertFinalDeliveryAvailable(liveChannel, final)
        this.assertFinalAdmissionEligibility(current, final)
        if (current.projection.team.closure === undefined) {
          await this.authorizeOrThrow('close', current.id, {
            operation: 'final-admission', channelId: channel.id, envelopeId: final.id,
          })
        }
        await this.authorizeOrThrow('dispatch', current.id, {
          operation: 'final-admission', channelId: channel.id, envelopeId: final.id,
          envelopeSequence: final.sequence, contentFingerprint: candidate.contentFingerprint,
        })
        await this.resolveTeamRunFinalReceiptRecipient(current, liveChannel, actor, receiptInput)
        this.assertFinalAdmissionEligibility(current, final)
        candidate = await this.admitPrincipalFinalSink(final, candidate)
        await this.resolveTeamRunFinalReceiptRecipient(current, liveChannel, actor, receiptInput)
        this.assertFinalAdmissionEligibility(current, final)
        await this.commitTeamCommand(current, [{ type: 'team/final-admitted', admission: candidate, createdAt: candidate.admittedAt }], 'TEAM_FINAL_INVALID')
        return freeze(structuredClone(candidate))
      }))
    })
  }

  /** Recheck the objective, unfinished work, and any immutable completion selection before result acceptance. */
  private assertFinalAdmissionEligibility(team: LoadedTeam, final: TeamEnvelope): void {
    const current = team.projection.team
    if (current.goal.phase === 'paused' || current.goal.phase === 'blocked'
      || current.cancellation !== undefined
      || current.closure !== undefined && (current.closure.kind !== 'complete'
        || current.closure.finalChannelId !== final.channelId || current.closure.finalEnvelopeId !== final.id)) {
      throw new TeamError('final admission requires an eligible Team objective and matching completion selection', 'TEAM_FINAL_INVALID')
    }
    this.assertFinalizationAdmissionQuiescence(team)
  }

  /** Derive closed-sink attribution exclusively from durable membership and committed WAL content. */
  private finalAdmissionFor(
    team: TeamProjectionOwner,
    final: TeamEnvelope,
    recipientId: ParticipantId,
    idempotencyKey: TeamFinalAdmission['idempotencyKey'],
    inboxSequence?: number,
  ): TeamFinalAdmission {
    const human = team.projection.participants.get(recipientId)
    if (human?.kind !== 'human' || human.owner === undefined) {
      throw new TeamError('final-result recipient has no durable human owner', 'TEAM_FINAL_INVALID')
    }
    return {
      sink: human.owner.kind === 'product-principal' ? 'principal-inbox' : 'team-run-result',
      ...(inboxSequence === undefined ? {} : { inboxSequence }),
      teamId: team.id, channelId: final.channelId,
      envelopeId: final.id, envelopeSequence: final.sequence,
      contentFingerprint: fingerprintTeamFinalContent(final.payload),
      recipientId, owner: structuredClone(human.owner), idempotencyKey,
      admittedAt: nextTeamTimestamp(team.projection),
    }
  }

  /** Persist principal delivery under the existing final authority before its journal admission and channel receipt. */
  private async admitPrincipalFinalSink(final: TeamEnvelope, admission: TeamFinalAdmission): Promise<TeamFinalAdmission> {
    if (admission.owner.kind !== 'product-principal') return admission
    const sink = this.ctx.get('teamHumanDelivery')
    if (sink === undefined) throw new TeamError('Principal final delivery requires the durable human inbox Consumer', 'TEAM_FINAL_INVALID')
    const payload = final.payload['text']
    if (typeof payload !== 'string' || payload.length === 0) throw new TeamError('Principal final text is missing', 'TEAM_FINAL_INVALID')
    const input = {
      teamId: admission.teamId, channelId: admission.channelId, envelopeId: admission.envelopeId,
      envelopeSequence: admission.envelopeSequence, contentFingerprint: admission.contentFingerprint,
      idempotencyKey: admission.idempotencyKey, principalId: admission.owner.principalId,
      recipientId: admission.recipientId, text: payload,
    }
    const delivery = await this.withHumanSinkProof({ kind: 'final', input }, async proof => await sink.admitFinal(input, proof))
    return { ...admission, sink: 'principal-inbox', inboxSequence: delivery.sequence }
  }

  /** Reject a receipt or recovery reference whose persisted result differs from the retained WAL or human owner. */
  private requireFinalAdmission(team: TeamProjectionOwner, final: TeamEnvelope, recipientId: ParticipantId): TeamFinalAdmission {
    const admission = team.projection.finalAdmission
    if (admission === null) throw new TeamError('final result has no durable sink admission', 'TEAM_FINAL_INVALID')
    const expected = this.finalAdmissionFor(team, final, recipientId, admission.idempotencyKey, admission.inboxSequence)
    if (!isDeepStrictEqual({ ...expected, admittedAt: admission.admittedAt }, admission)) {
      throw new TeamError('durable final admission does not match retained WAL content or recipient ownership', 'TEAM_FINAL_INVALID')
    }
    return admission
  }

  /**
   * Accept one Team completion intent before or after its final human receipt.
   * The TeamRun source may fence a receipt-pending intent; a closure driver
   * writes the terminal phase only after that receipt and owned work converge.
   * @param request - authenticated final-answer closure command.
   * @returns the durable quiescing Team state after completion intent acceptance.
   */
  override async completeTeam(request: TeamCompleteRequest): Promise<TeamStateSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamCompleteInputSchema.parse(untrustedInput)
      this.assertClosureAuthorityTeamId(actor, input.teamId)
      const team = await this.ensureTeam(input.teamId)
      await this.ensureChannel(input.finalChannelId)
      let channels = await Promise.all([...team.projection.channelIds].map(channelId => this.ensureChannel(channelId)))
      await this.preflightClosureAuthority(team, channels, actor, input, 'complete')
      await this.repairPendingParentCharges(team)
      channels = await Promise.all([...team.projection.channelIds].map(channelId => this.ensureChannel(channelId)))
      return await team.queue.run(async () => await this.withChannelQueues(channels, async () => {
        const current = this.requireLiveTeam(team)
        let resolved = this.resolveClosureAuthority(current, actor, input, 'complete', channels)
        const replay = this.replayClosure(current, resolved, 'complete')
        if (replay !== undefined) return replay
        if (current.projection.team.cancellation !== undefined) {
          throw new TeamError(`Team '${current.id}' is cancelling`, 'TEAM_INVALID_ARGUMENT')
        }
        this.assertTeamCursor(current, input.expectedCursor)
        this.assertClosureActor(current, resolved.actor)
        if (current.projection.team.phase !== 'active' && current.projection.team.phase !== 'quiescing') {
          throw new TeamError(
            `Team '${current.id}' cannot complete from '${current.projection.team.phase}'`,
            'TEAM_INVALID_ARGUMENT',
          )
        }
        if (current.projection.team.goal.phase === 'paused' || current.projection.team.goal.phase === 'blocked') {
          throw new TeamError(
            `Team '${current.id}' cannot complete while its objective is '${current.projection.team.goal.phase}'`,
            'TEAM_FINAL_INVALID',
          )
        }
        const loadedFinalChannel = channels.find(channel => channel.id === input.finalChannelId)
        if (loadedFinalChannel === undefined || !current.projection.channelIds.has(input.finalChannelId)) {
          throw new TeamError(`final channel '${input.finalChannelId}' is not attached to Team '${current.id}'`, 'TEAM_CHANNEL_NOT_FOUND')
        }
        const allowPendingFinalReceipt = this.isTeamRunCompletionProof(actor)
        if (allowPendingFinalReceipt) this.assertFinalizationAdmissionQuiescence(current)
        const final = await this.requireFinalEnvelope(current, loadedFinalChannel, input.finalEnvelopeId, !allowPendingFinalReceipt)
        const recipient = current.projection.participants.get(final.audience[0])
        if (recipient?.kind !== 'human' || recipient.owner === undefined) {
          throw new TeamError('completion requires a human recipient with a durable owner', 'TEAM_FINAL_INVALID')
        }
        if (allowPendingFinalReceipt) await this.assertFinalDeliveryAvailable(loadedFinalChannel, final)
        if (current.projection.finalAdmission !== null) {
          this.requireFinalAdmission(current, final, final.audience[0])
        }
        await this.authorizeOrThrow('close', current.id, closureFacts(resolved, 'complete'), closureActorId(resolved.actor))
        resolved = this.resolveClosureAuthority(current, actor, input, 'complete', channels)
        const requestedAt = nextTeamTimestamp(current.projection)
        const closure: TeamClosureSnapshot = {
          teamId: current.id,
          kind: 'complete',
          idempotencyKey: input.idempotencyKey,
          actor: structuredClone(resolved.actor),
          reason: structuredClone(input.reason),
          finalChannelId: input.finalChannelId,
          finalEnvelopeId: input.finalEnvelopeId,
          requestedAt,
        }
        const records: TeamJournalRecord[] = [{ type: 'team/closure', closure, createdAt: requestedAt }]
        const goal = current.projection.team.goal
        if (goal.phase !== 'complete') {
          records.push({
            type: 'goal/changed',
            goal: {
              teamId: goal.teamId,
              revision: goal.revision + 1,
              objective: goal.objective,
              phase: 'complete',
              budgets: structuredClone(goal.budgets),
            },
            createdAt: requestedAt,
          })
        }
        if (current.projection.team.phase === 'active') {
          records.push({ type: 'team/phase', phase: 'quiescing', createdAt: requestedAt })
        }
        await this.commitTeamCommand(current, records, 'TEAM_FINAL_INVALID')
        return this.teamState(current.projection)
      }))
    })
  }

  /**
   * Accept one typed, retry-safe Team failure intent. A closure driver settles
   * owned resources and commits the terminal phase after quiescence.
   * @param request - authenticated structured failure command.
   * @returns the durable quiescing Team state after failure intent acceptance.
   */
  override async failTeam(request: TeamFailRequest): Promise<TeamStateSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamFailInputSchema.parse(untrustedInput)
      this.assertClosureAuthorityTeamId(actor, input.teamId)
      const loaded = await this.ensureTeam(input.teamId)
      await this.preflightClosureAuthority(loaded, [], actor, input, 'fail')
      await this.repairPendingParentCharges(loaded)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        let closure = this.resolveClosureAuthority(current, actor, input, 'fail')
        const replay = this.replayClosure(current, closure, 'fail')
        if (replay !== undefined) return replay
        if (current.projection.team.cancellation !== undefined) {
          throw new TeamError(`Team '${current.id}' is cancelling`, 'TEAM_INVALID_ARGUMENT')
        }
        this.assertTeamCursor(current, input.expectedCursor)
        this.assertClosureActor(current, closure.actor)
        if (current.projection.team.phase === 'completed' || current.projection.team.phase === 'cancelled' || current.projection.team.phase === 'failed') {
          throw new TeamError(`Team '${current.id}' is already terminal`, 'TEAM_INVALID_ARGUMENT')
        }
        await this.authorizeOrThrow('close', current.id, closureFacts(closure, 'fail'), closureActorId(closure.actor))
        closure = this.resolveClosureAuthority(current, actor, input, 'fail')
        const requestedAt = nextTeamTimestamp(current.projection)
        const records: TeamJournalRecord[] = [
          {
            type: 'team/closure',
            closure: {
              teamId: current.id,
              kind: 'fail',
              idempotencyKey: input.idempotencyKey,
              actor: structuredClone(closure.actor),
              reason: structuredClone(input.reason),
              requestedAt,
            },
            createdAt: requestedAt,
          },
        ]
        if (current.projection.team.phase !== 'quiescing') {
          records.push({ type: 'team/phase', phase: 'quiescing', createdAt: requestedAt })
        }
        await this.commitTeamCommand(current, records, 'TEAM_INVALID_ARGUMENT')
        return this.teamState(current.projection)
      })
    })
  }

  /**
   * Request cancellation, close new admission, and finish cancellation when
   * owned resources have reached quiescence. The first call durably records the
   * intent even when an activation or task lease is still live; later retries
   * with the same key continue the same cancellation rather than creating a
   * second lifecycle branch.
   * @param request - authenticated structured cancellation command.
   * @returns the terminal Team state, or the quiescing/stalled state while an
   * owner still has to report resource termination.
   */
  override async cancelTeam(request: TeamCancelRequest): Promise<TeamStateSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamCancelInputSchema.parse(untrustedInput)
      this.assertClosureAuthorityTeamId(actor, input.teamId)
      const loaded = await this.ensureTeam(input.teamId)
      let channels = await Promise.all([...loaded.projection.channelIds].map(channelId => this.ensureChannel(channelId)))
      await this.preflightClosureAuthority(loaded, channels, actor, input, 'cancel')
      await this.repairPendingParentCharges(loaded)
      channels = await Promise.all([...loaded.projection.channelIds].map(channelId => this.ensureChannel(channelId)))
      return await loaded.queue.run(async () => await this.withChannelQueues(channels, async () => {
        let current = this.requireLiveTeam(loaded)
        let closure = this.resolveClosureAuthority(current, actor, input, 'cancel', channels)
        const replay = this.replayClosure(current, closure, 'cancel')
        if (replay !== undefined) return replay
        const cancellation = current.projection.team.cancellation
        if (cancellation === undefined) {
          this.assertTeamCursor(current, input.expectedCursor)
          this.assertClosureActor(current, closure.actor)
          if (current.projection.team.phase === 'completed'
            || current.projection.team.phase === 'cancelled'
            || current.projection.team.phase === 'failed') {
            throw new TeamError(`Team '${current.id}' is already terminal`, 'TEAM_INVALID_ARGUMENT')
          }
          await this.authorizeOrThrow('close', current.id, closureFacts(closure, 'cancel'), closureActorId(closure.actor))
          closure = this.resolveClosureAuthority(current, actor, input, 'cancel', channels)
          const requestedAt = nextTeamTimestamp(current.projection)
          const records: TeamJournalRecord[] = [{
            type: 'team/cancellation',
            cancellation: {
              teamId: current.id,
              idempotencyKey: input.idempotencyKey,
              actor: structuredClone(closure.actor),
              reason: structuredClone(input.reason),
              requestedAt,
            },
            createdAt: requestedAt,
          }]
          if (current.projection.team.phase === 'active' || current.projection.team.phase === 'stalled') {
            records.push({ type: 'team/phase', phase: 'quiescing', createdAt: requestedAt })
          }
          records.push(...this.closureBusinessCleanupRecords(current.projection, 'cancel', input.reason))
          await this.commitTeamCommand(current, records, 'TEAM_INVALID_ARGUMENT')
          current = this.requireLiveTeam(loaded)
        } else if (!cancellationMatches(cancellation, closure)) {
          throw new TeamError(
            `Team '${loaded.id}' cancellation key '${input.idempotencyKey}' conflicts with its durable cancellation request`,
            'TEAM_CLOSURE_IDEMPOTENCY_CONFLICT',
          )
        }

        const acceptedCancellation = current.projection.team.cancellation
        if (acceptedCancellation === undefined) {
          throw new TeamError(`Team '${loaded.id}' has no durable cancellation request`, 'TEAM_INVALID_ARGUMENT')
        }
        closure = this.resolveClosureAuthority(current, actor, input, 'cancel', channels)
        await this.expireClosureDeliveries(
          current,
          channels,
          'cancellation-delivery-expiry',
          acceptedCancellation.idempotencyKey,
          acceptedCancellation.requestedAt,
          closureActorId(acceptedCancellation.actor),
          'cancellation',
          () => {
            closure = this.resolveClosureAuthority(this.requireLiveTeam(loaded), actor, input, 'cancel', channels)
          },
        )

        const cleanupRecords = this.closureBusinessCleanupRecords(current.projection, 'cancel', acceptedCancellation.reason)
        if (cleanupRecords.length > 0) {
          closure = this.resolveClosureAuthority(current, actor, input, 'cancel', channels)
          await this.commitTeamCommand(current, cleanupRecords, 'TEAM_INVALID_ARGUMENT')
          current = this.requireLiveTeam(loaded)
        }
        if (!this.cancellationResourcesSettled(current.projection)) {
          return this.teamState(current.projection)
        }
        if (!this.cancellationDeliveriesSettled(channels)) {
          return this.teamState(current.projection)
        }
        await this.settleClosureBranches(
          channels.map(channel => async () => {
            closure = this.resolveClosureAuthority(this.requireLiveTeam(loaded), actor, input, 'cancel', channels)
            const currentChannel = this.requireLiveChannel(channel)
            if (currentChannel.projection.phase === 'closed'
              || currentChannel.projection.phase === 'expired'
              || currentChannel.projection.phase === 'failed') return
            await this.closeChannelOwned(channel, {
              channelId: channel.id,
              expectedCursor: currentChannel.projection.cursor,
              reason: 'Team cancelled',
            }, {
              channelId: channel.id,
              expectedCursor: currentChannel.projection.cursor,
              closure: 'cancel',
            }, closureActorId(closure.actor), () => {
              closure = this.resolveClosureAuthority(this.requireLiveTeam(loaded), actor, input, 'cancel', channels)
            })
          }),
          'Team cancellation channel cleanup failed',
        )
        current = this.requireLiveTeam(loaded)
        if (!this.cancellationResourcesSettled(current.projection)
          || !this.cancellationDeliveriesSettled(channels)) {
          return this.teamState(current.projection)
        }
        closure = this.resolveClosureAuthority(current, actor, input, 'cancel', channels)
        const requestedAt = nextTeamTimestamp(current.projection)
        await this.commitTeamCommand(current, [
          {
            type: 'team/closure',
            closure: {
              teamId: current.id,
              kind: 'cancel',
              idempotencyKey: input.idempotencyKey,
              actor: structuredClone(closure.actor),
              reason: structuredClone(input.reason),
              requestedAt,
            },
            createdAt: requestedAt,
          },
          { type: 'team/phase', phase: 'cancelled', createdAt: requestedAt },
        ], 'TEAM_INVALID_ARGUMENT')
        return this.teamState(current.projection)
      }))
    })
  }

  /**
   * Continue one source-selected lifecycle observation or durable closure
   * without accepting caller-selected actor, final result, or Team identity.
   * @param request - cursor-fenced Team selection plus an opaque driver proof.
   * @returns the Team state after one idempotent settlement pass.
   */
  override async continueTeamClosure(request: TeamClosureContinuationRequest): Promise<TeamStateSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamClosureContinuationInputSchema.parse(untrustedInput)
      const initial = this.requireSystemClosureDriverProof(actor)
      this.assertClosureDriverInput(initial.scope, input)
      const loaded = await this.ensureTeam(input.teamId)
      const channels = await Promise.all([...loaded.projection.channelIds].map(channelId => this.ensureChannel(channelId)))
      await this.preflightClosureDriverContinuation(loaded, channels, actor, input)
      return await loaded.queue.run(async () => await this.withChannelQueues(channels, async () => {
        const current = this.requireLiveTeam(loaded)
        const resolution = this.resolveClosureDriverContinuationAuthority(current, actor, input)
        switch (resolution.scope.kind) {
          case 'closure-recover-complete':
            return await this.continueCompleteClosure(current, channels, actor, input, resolution)
          case 'closure-recover-fail':
            return await this.continueFailedClosure(current, channels, actor, input, resolution)
          case 'closure-recover-cancel':
            return await this.continueCancellation(current, channels, actor, input, resolution)
          case 'closure-stall-missing-final':
            return await this.recordMissingFinal(current, channels, actor, input, resolution)
          case 'closure-fail-turn':
            return await this.recordTurnFailure(current, channels, actor, input, resolution)
          case 'closure-stall-budget':
            return await this.recordBudgetStall(current, actor, input, resolution)
          case 'closure-stall-quiescing':
            return await this.recordQuiescingStall(current, actor, input, resolution)
          /* v8 ignore next -- unsupported closure-driver source scopes fail closed. */
          default:
            return this.rejectClosureDriverActor()
        }
      }))
    })
  }

  /**
   * Compare-and-set one Team objective definition without changing its phase.
   * @param request - runtime activation or authenticated-human proof plus JSON-only goal revision and replacement fields.
   * @returns the detached Team state after durable acceptance.
   */
  override async updateTeamGoal(request: TeamGoalUpdateRequest): Promise<TeamStateSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamGoalUpdateInputSchema.parse(untrustedInput)
      this.assertGoalAuthorityTeamId(actor, input)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const goal = current.projection.team.goal
        this.assertGoalRevision(goal, input.expectedRevision)
        const actorId = this.resolveGoalActor(current, actor, input)
        const next: TeamGoalSnapshot = {
          ...goal,
          revision: goal.revision + 1,
          ...input.objective === undefined ? {} : { objective: normalizedText(input.objective, 'goal objective') },
          ...input.budgets === undefined ? {} : { budgets: jsonObjectSchema.parse(input.budgets) },
        }
        await this.authorizeOrThrow('goal-mutate', input.teamId, goalMutationFacts(next, input.expectedRevision), actorId)
        this.resolveGoalActor(current, actor, input)
        await this.commitTeamCommand(current, [{
          type: 'goal/changed', goal: next, createdAt: nextTeamTimestamp(current.projection),
        }], 'TEAM_INVALID_ARGUMENT')
        return this.teamState(current.projection)
      })
    })
  }

  /**
   * Compare-and-set one Team objective lifecycle transition.
   * @param request - runtime activation or authenticated-human proof plus JSON-only goal revision, phase, and blocked-only explanation.
   * @returns the detached Team state after durable acceptance.
   */
  override async transitionTeamGoalPhase(request: TeamGoalPhaseTransitionRequest): Promise<TeamStateSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamGoalPhaseTransitionInputSchema.parse(untrustedInput)
      this.assertGoalAuthorityTeamId(actor, input)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const goal = current.projection.team.goal
        this.assertGoalRevision(goal, input.expectedRevision)
        const actorId = this.resolveGoalActor(current, actor, input)
        this.assertGoalPhaseTransition(goal, input.phase)
        const next: TeamGoalSnapshot = {
          teamId: goal.teamId,
          revision: goal.revision + 1,
          objective: goal.objective,
          phase: input.phase,
          budgets: structuredClone(goal.budgets),
          ...input.phase === 'blocked' && input.blocker !== undefined ? {
            blocker: {
              code: normalizedText(input.blocker.code, 'goal blocker code'),
              message: normalizedText(input.blocker.message, 'goal blocker message'),
            },
          } : {},
        }
        await this.authorizeOrThrow('goal-mutate', input.teamId, goalMutationFacts(next, input.expectedRevision), actorId)
        this.resolveGoalActor(current, actor, input)
        await this.commitTeamCommand(current, [{
          type: 'goal/changed', goal: next, createdAt: nextTeamTimestamp(current.projection),
        }], 'TEAM_INVALID_ARGUMENT')
        return this.teamState(current.projection)
      })
    })
  }

  /**
   * Invite a new participant at a caller-observed Team cursor.
   * @param request - Team, cursor, and participant descriptor.
   * @returns the detached invited participant projection.
   */
  override async inviteParticipant(request: ParticipantInviteRequest): Promise<ParticipantSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = participantInviteInputSchema.parse(untrustedInput)
      const human = this.isHumanParticipantInviteActor(actor, input)
      if (!human) this.topologyParticipantInviteScope(actor as TeamSystemTopologyProof, input)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const humanActorId = human
          ? this.resolveHumanParticipantInviteAuthority(current, actor as TeamHumanActorProof, input)
          : undefined
        if (human && input.kind === 'human') this.rejectHumanParticipantActor()
        if (current.projection.participants.size >= this.teamLimit(current.projection, 'maxParticipants', this.config.maxParticipantsPerTeam)) {
          throw new TeamError(`Team '${input.teamId}' reached its participant limit`, 'TEAM_CHANNEL_BACKPRESSURE')
        }
        this.assertTeamCursor(current, input.expectedCursor)
        const authorityGrant = current.projection.team.authorityGrant === undefined && input.authorityGrant === undefined
          ? undefined
          : resolveAuthorityGrant(input.authorityGrant, current.projection.team.authorityGrant)
        if (authorityGrant !== undefined && current.projection.team.authorityGrant !== undefined) {
          assertAuthorityGrantSubset(current.projection.team.authorityGrant, authorityGrant, 'Participant authority')
        }
        if (human) {
          await this.authorizeOrThrow(
            'invite',
            input.teamId,
            participantInviteFacts(input),
            humanActorId ?? this.rejectHumanParticipantActor(),
          )
        } else {
          const scope = this.resolveTopologyParticipantInviteAuthority(current, actor as TeamSystemTopologyProof, input)
          await this.authorizeOrThrow('invite', input.teamId, {
            operation: 'topology-participant-invite',
            topologyOperation: scope.kind,
            sourceName: TEAM_RUN_TOPOLOGY_PROOF_SOURCE,
            kind: input.kind,
            displayName: input.displayName,
            role: input.role,
            capabilities: input.capabilities,
            expectedCursor: input.expectedCursor,
          })
        }
        const participant: ParticipantSnapshot = {
          id: mintParticipantId(),
          teamId: input.teamId,
          kind: input.kind,
          displayName: normalizedText(input.displayName, 'displayName'),
          role: normalizedText(input.role, 'role'),
          capabilities: normalizeLabels(input.capabilities, 'participant capabilities'),
          phase: 'invited',
          ...input.owner === undefined ? {} : { owner: structuredClone(input.owner) },
          ...input.provider === undefined ? {} : { provider: normalizedText(input.provider, 'provider') },
          ...input.preset === undefined ? {} : { preset: normalizedText(input.preset, 'preset') },
          ...input.model === undefined ? {} : { model: normalizedText(input.model, 'model') },
          ...input.authScheme === undefined ? {} : { authScheme: normalizedText(input.authScheme, 'authScheme') },
          ...authorityGrant === undefined ? {} : { authorityGrant: structuredClone(authorityGrant) },
        }
        if (human) {
          this.resolveHumanParticipantInviteAuthority(current, actor as TeamHumanActorProof, input)
        } else {
          this.resolveTopologyParticipantInviteAuthority(current, actor as TeamSystemTopologyProof, input)
        }
        await this.commitTeamCommand(current, [{
          type: 'participant/changed', participant, createdAt: nextTeamTimestamp(current.projection),
        }], 'TEAM_INVALID_ARGUMENT')
        return freeze(structuredClone(participant))
      })
    })
  }

  /**
   * Compare-and-set one participant membership transition.
   * @param request - Team, participant, observed cursor, and next phase.
   * @returns the detached participant projection after the transition.
   */
  override async transitionParticipantPhase(request: ParticipantPhaseTransitionRequest): Promise<ParticipantSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = participantPhaseTransitionInputSchema.parse(untrustedInput)
      const human = this.isHumanParticipantPhaseActor(actor, input)
      if (!human) this.topologyParticipantPhaseScope(actor as TeamSystemTopologyProof, input)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const humanAuthority = human
          ? this.resolveHumanParticipantPhaseAuthority(current, actor as TeamHumanActorProof, input)
          : undefined
        this.assertTeamCursor(current, input.expectedCursor)
        const participant = current.projection.participants.get(input.participantId)
        if (participant === undefined) {
          throw new TeamError(`Team participant '${input.participantId}' was not found`, 'TEAM_PARTICIPANT_NOT_FOUND')
        }
        if (human) {
          await this.authorizeOrThrow(
            humanAuthority?.operation ?? this.rejectHumanParticipantActor(),
            input.teamId,
            participantPhaseFacts(input),
            humanAuthority?.actorId,
          )
        } else {
          const scope = this.resolveTopologyParticipantPhaseAuthority(current, actor as TeamSystemTopologyProof, input)
          await this.authorizeOrThrow(scope.kind === 'team-run-worker-retire' ? 'close' : 'activate', input.teamId, {
            operation: 'topology-participant-phase',
            topologyOperation: scope.kind,
            sourceName: TEAM_RUN_TOPOLOGY_PROOF_SOURCE,
            participantId: input.participantId,
            phase: input.phase,
            expectedCursor: input.expectedCursor,
          })
        }
        const next: ParticipantSnapshot = { ...participant, phase: input.phase }
        if (human) {
          this.resolveHumanParticipantPhaseAuthority(current, actor as TeamHumanActorProof, input)
        } else {
          this.resolveTopologyParticipantPhaseAuthority(current, actor as TeamSystemTopologyProof, input)
        }
        const createdAt = nextTeamTimestamp(current.projection)
        const records: TeamJournalRecord[] = human && input.phase === 'active' && participant.phase === 'invited'
          ? [
            { type: 'participant/changed', participant: { ...participant, phase: 'provisioning' }, createdAt },
            { type: 'participant/changed', participant: next, createdAt: createdAt + 1 },
          ]
          : [{ type: 'participant/changed', participant: next, createdAt }]
        await this.commitTeamCommand(current, records, 'TEAM_INVALID_ARGUMENT')
        return freeze(structuredClone(next))
      })
    })
  }

  /** Reserve a durable startup slot before the provider can create a process. */
  override async reserveActivation(request: ActivationReservationRequest): Promise<ActivationReservationSnapshot> {
    return await this.changeActivationReservation(request, false)
  }

  /** Confirm cleanup of an unpublished provider start without discarding unknown residency. */
  override async releaseActivationReservation(request: ActivationReservationRequest): Promise<ActivationReservationSnapshot> {
    return await this.changeActivationReservation(request, true)
  }

  private async changeActivationReservation(
    request: ActivationReservationRequest, release: boolean,
  ): Promise<ActivationReservationSnapshot> {
    return await this.admit(async () => {
      const { actor, ...wire } = request
      const input = activationReservationInputSchema.parse(wire)
      const checkAuthority = (): void => {
        const { sourceName, scope } = this.requireSystemActivationProof(actor)
        const { kind, ...selection } = scope
        if (sourceName !== TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE
          || kind !== (release ? 'activation-controller-release-reservation' : 'activation-controller-reserve')
          || !isDeepStrictEqual(selection, input)) this.rejectActivationActor()
      }
      checkAuthority()
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        checkAuthority()
        this.assertTeamCursor(current, input.expectedCursor)
        const participant = current.projection.participants.get(input.participantId)
        if (participant === undefined || !isAgentParticipant(participant)) {
          throw new TeamError('Startup reservation requires an agent participant', 'TEAM_PARTICIPANT_NOT_FOUND')
        }
        const prior = participant.activationReservation
        let reservation: ActivationReservationSnapshot
        const createdAt = nextTeamTimestamp(current.projection)
        if (release) {
          if (prior?.id !== input.reservationId || prior.sessionId !== input.sessionId || prior.provider !== input.provider) {
            this.rejectActivationActor()
          }
          if ([...current.projection.activations.values()].some(binding => binding.reservationId === prior.id)) {
            throw new TeamError('A bound startup reservation must settle through its activation epoch', 'TEAM_NOT_QUIESCENT')
          }
          if (prior.releasedAt !== undefined) return freeze(structuredClone(prior))
          reservation = { ...prior, releasedAt: createdAt }
        } else {
          if (current.projection.team.phase !== 'active' || current.projection.team.cancellation !== undefined
            || current.projection.team.closure !== undefined || participant.phase !== 'active') {
            throw new TeamError('Team or participant is not accepting activation startup', 'TEAM_NOT_QUIESCENT')
          }
          this.assertNoPendingParentCharges(current.projection)
          const bindings = [...current.projection.activations.values()]
          if ([...current.projection.participants.values()].some(value => value.id !== participant.id
            && value.activationReservation?.id === input.reservationId)
            || bindings.some(binding => binding.reservationId === input.reservationId)
            || prior?.id === input.reservationId && prior.releasedAt !== undefined) {
            throw new TeamError('Startup reservation identity is already consumed', 'TEAM_ACTIVATION_RECOVERY_CONFLICT')
          }
          if (prior?.id === input.reservationId && prior.releasedAt === undefined
            && prior.sessionId === input.sessionId && prior.provider === input.provider) {
            return freeze(structuredClone(prior))
          }
          if (bindings.some(binding => binding.activation.participantId === participant.id && binding.quiescedAt === undefined)
            || prior !== undefined && prior.releasedAt === undefined
              && !bindings.some(binding => binding.reservationId === prior.id && binding.quiescedAt !== undefined)) {
            throw new TeamError('Participant startup or old epoch requires confirmed termination', 'TEAM_ACTIVATION_RECOVERY_CONFLICT')
          }
          const limit = liveActivationLimit(current.projection.budgets, current.projection.team.authorityGrant)
          const used = liveActivationCapacity(current.projection.participants.values(), bindings, current.projection.tasks.values())
          if (limit !== undefined && used >= limit || participant.authorityGrant?.budgets.maxLiveActivations === 0) {
            throw new TeamError('Team live Activation capacity is exhausted', 'TEAM_BUDGET_EXCEEDED')
          }
          reservation = { id: input.reservationId, sessionId: input.sessionId, provider: input.provider, reservedAt: createdAt }
        }
        await this.authorizeOrThrow('activate', input.teamId, {
          operation: release ? 'activation-startup-release' : 'activation-startup-reserve', ...input,
        }, participant.id)
        checkAuthority()
        await this.commitTeamCommand(current, [{ type: 'participant/changed',
          participant: { ...participant, activationReservation: reservation }, createdAt }], 'TEAM_INVALID_ARGUMENT')
        return freeze(structuredClone(reservation))
      })
    })
  }

  /**
   * Bind one published activation to its Team participant and Session.
   * @param request - observed Team cursor and complete published binding.
   * @returns the detached durable binding after acceptance.
   */
  override async bindActivation(request: ActivationBindRequest): Promise<ActivationBindingSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = activationBindInputSchema.parse(untrustedInput)
      this.assertInitialActivationBindAuthority(actor, input)
      const loaded = await this.ensureTeam(input.binding.activation.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        this.resolveActivationBindAuthority(actor, input)
        if (current.projection.activations.size >= this.teamLimit(current.projection, 'maxActivations', this.config.maxActivationsPerTeam)) {
          throw new TeamError(`Team '${current.id}' reached its activation limit`, 'TEAM_CHANNEL_BACKPRESSURE')
        }
        const binding = this.normalizedActivationBinding(input.binding)
        this.assertTeamCursor(current, input.expectedCursor)
        if (current.projection.team.phase !== 'active') {
          throw new TeamError(`Team '${current.id}' is not active`, 'TEAM_INVALID_ARGUMENT')
        }
        const participant = current.projection.participants.get(binding.activation.participantId)
        if (binding.activation.teamId !== current.id
          || participant === undefined
          || participant.phase !== 'active'
          || !isAgentParticipant(participant)) {
          throw new TeamError(
            `Activation '${binding.activation.id}' does not bind an active agent participant`,
            'TEAM_PARTICIPANT_NOT_FOUND',
          )
        }
        const reservation = participant.activationReservation
        if (liveActivationLimit(current.projection.budgets, current.projection.team.authorityGrant) !== undefined
          || participant.authorityGrant?.budgets.maxLiveActivations !== undefined || binding.reservationId !== undefined) {
          if (reservation === undefined || binding.reservationId !== reservation.id || reservation.releasedAt !== undefined
            || reservation.sessionId !== binding.sessionId || reservation.provider !== binding.provider) {
            throw new TeamError('Activation binding has no matching live startup reservation', 'TEAM_ACTOR_PROOF_INVALID')
          }
          if ([...current.projection.activations.values()].some(value => value.reservationId === reservation.id)) {
            throw new TeamError('Startup reservation already belongs to another binding', 'TEAM_ACTOR_PROOF_INVALID')
          }
        }
        if (current.projection.activations.has(binding.activation.id)) {
          throw new TeamError(
            `Activation '${binding.activation.id}' is already durably bound`,
            'TEAM_INVALID_ARGUMENT',
          )
        }
        for (const candidate of current.projection.activations.values()) {
          if (candidate.activation.participantId !== binding.activation.participantId) continue
          if (candidate.sessionId !== binding.sessionId) {
            throw new TeamError(
              `Participant '${binding.activation.participantId}' is already bound to another Session`,
              'TEAM_INVALID_ARGUMENT',
            )
          }
          if (candidate.activation.status !== 'offline') {
            throw new TeamError(
              `Participant '${binding.activation.participantId}' already has a resident activation`,
              'TEAM_INVALID_ARGUMENT',
            )
          }
          if (candidate.recovery !== undefined && candidate.quiescedAt === undefined) {
            throw new TeamError(
              `Participant '${binding.activation.participantId}' has an offline activation without replacement proof`,
              'TEAM_INVALID_ARGUMENT',
            )
          }
          await this.assertRetiredQuiescedWakeChannels(current, candidate)
        }
        await this.authorizeOrThrow('activate', current.id, {
          activationId: binding.activation.id,
          participantId: binding.activation.participantId,
          sessionId: binding.sessionId,
          provider: binding.provider,
          status: binding.activation.status,
          expectedCursor: input.expectedCursor,
        })
        this.resolveActivationBindAuthority(actor, input)
        await this.commitTeamCommand(current, [{
          type: 'activation/changed', binding, createdAt: nextTeamTimestamp(current.projection),
        }], 'TEAM_INVALID_ARGUMENT')
        return this.activationBindingSnapshot(binding)
      })
    })
  }

  /**
   * Persist one residency-status transition for an existing activation binding.
   * @param request - Team/activation identity, observed Team cursor, and next status.
   * @returns the detached binding after its durable status transition.
   */
  override async updateActivationStatus(request: ActivationStatusUpdateRequest): Promise<ActivationBindingSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = activationStatusUpdateInputSchema.parse(untrustedInput)
      this.assertInitialActivationStatusAuthority(actor, input)
      return await this.withCurrentActivation(input.teamId, input.activationId, input.expectedCursor, async (current, binding) => {
        this.resolveActivationStatusAuthority(current, binding, actor, input)
        await this.authorizeOrThrow('activate', current.id, {
          activationId: input.activationId,
          participantId: binding.activation.participantId,
          status: input.status,
          expectedCursor: input.expectedCursor,
        })
        const next: ActivationBindingSnapshot = {
          ...binding,
          activation: { ...binding.activation, status: input.status },
        }
        this.resolveActivationStatusAuthority(current, binding, actor, input)
        await this.commitTeamCommand(current, [{
          type: 'activation/changed', binding: next, createdAt: nextTeamTimestamp(current.projection),
        }], 'TEAM_INVALID_ARGUMENT')
        return this.activationBindingSnapshot(next)
      })
    })
  }

  /**
   * Release every current lease owned by one externally fenced activation and
   * commit its offline proof in the same Team-journal batch before retiring
   * its recorded wake channels.
   * @param request - exact fenced activation relation and current Team cursor.
   * @returns the complete detached Team state after the atomic recovery transition.
   */
  override async fenceActivation(request: ActivationFenceRequest): Promise<TeamStateSnapshot> {
    return await this.settleActivationQuiescence(request, 'fenced')
  }

  /**
   * Release every current lease owned by an activation whose handle owner has
   * already settled it, then commit its offline proof and retire recorded wake channels.
   * @param request - exact locally settled activation relation and current Team cursor.
   * @returns the complete detached Team state after quiescence settles.
   */
  override async quiesceActivation(request: ActivationQuiesceRequest): Promise<TeamStateSnapshot> {
    return await this.settleActivationQuiescence(request, 'quiesced')
  }

  /** Commit one trusted activation quiescence proof and its task/wake cleanup. */
  private async settleActivationQuiescence(
    request: ActivationFenceRequest | ActivationQuiesceRequest,
    source: 'fenced' | 'quiesced',
  ): Promise<TeamStateSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = activationFenceInputSchema.parse(untrustedInput)
      this.assertInitialActivationQuiescenceAuthority(actor, input, source)
      return await this.withCurrentActivation(input.teamId, input.activationId, input.expectedCursor, async (current, binding) => {
        this.resolveActivationQuiescenceAuthority(current, binding, actor, input, source)
        const revalidate = (): void => {
          const latest = this.findActivationBinding(current.projection, input.activationId)
          if (latest === undefined) this.rejectActivationActor()
          this.resolveActivationQuiescenceAuthority(current, latest, actor, input, source)
        }
        if (binding.activation.teamId !== input.teamId
          || binding.activation.participantId !== input.participantId
          || binding.sessionId !== input.sessionId
          || binding.provider !== input.provider) {
          throw new TeamError(`Activation '${input.activationId}' does not match its fenced binding`, 'TEAM_INVALID_ARGUMENT')
        }
        if (binding.activation.status === 'offline' && binding.quiescedAt !== undefined) {
          await this.closeQuiescedWakeChannels(
            current,
            binding.activation.id,
            binding.quiescedWakeChannelIds ?? [],
            revalidate,
          )
          return this.teamState(current.projection)
        }
        const wakeChannelIds = this.quiescedWakeChannelIds(current.projection, binding.activation.id)
        const liveAllocation = [...current.projection.workspaceAllocations.values()].find(allocation =>
          allocation.activationId === binding.activation.id && allocation.lifecycle !== 'released')
        if (liveAllocation !== undefined) {
          if (source !== 'fenced' || binding.recovery === undefined
            || (current.projection.team.closure === undefined && current.projection.team.cancellation === undefined)) {
            throw new TeamError(
              `Activation '${binding.activation.id}' retains workspace allocation '${liveAllocation.id}'`,
              'TEAM_NOT_QUIESCENT',
            )
          }
          const createdAt = nextTeamTimestamp(current.projection)
          const records: TeamJournalRecord[] = []
          if (binding.fencedAt === undefined) {
            records.push({
              type: 'activation/changed',
              binding: { ...binding, activation: { ...binding.activation, status: binding.activation.status === 'offline' ? 'offline' : 'stopping' }, fencedAt: createdAt },
              createdAt,
            })
          }
          const allocation = [...current.projection.workspaceAllocations.values()].find(candidate =>
            candidate.activationId === binding.activation.id && (candidate.lifecycle === 'reserved' || candidate.lifecycle === 'active'))
          if (allocation !== undefined) {
            records.push({
              type: 'workspace-allocation/changed',
              allocation: {
                ...allocation,
                revision: allocation.revision + 1,
                lifecycle: 'release-requested',
                releaseRequestedAt: createdAt,
                updatedAt: createdAt,
              },
              createdAt,
            })
          }
          if (records.length > 0) {
            if (allocation !== undefined) {
              await this.authorizeOrThrow('workspace-allocate', input.teamId, workspaceAllocationTransitionFacts(
                allocation, 'workspace-allocation-release-request', TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE,
                { teamId: input.teamId, expectedCursor: input.expectedCursor,
                  allocationId: allocation.id, expectedRevision: allocation.revision },
              ), allocation.participantId)
              revalidate()
            }
            await this.authorizeOrThrow('activate', input.teamId, {
              operation: 'closure-activation-fence', activationId: input.activationId, expectedCursor: input.expectedCursor,
              ...allocation === undefined ? {} : { allocationId: allocation.id, expectedRevision: allocation.revision },
            })
            revalidate()
            await this.commitTeamCommand(current, records, 'TEAM_INVALID_ARGUMENT')
          }
          return this.teamState(current.projection)
        }
        const settledAt = nextQuiescenceTimestamp(current.projection)
        const records: TeamJournalRecord[] = []
        for (const task of current.projection.tasks.values()) {
          const lease = task.lease
          if (lease?.activationId !== binding.activation.id) continue
          const outcome: TaskAttemptOutcome = settledAt >= lease.expiresAt
            ? { kind: 'lease-expired' }
            : { kind: 'released' }
          const owner = {
            teamId: input.teamId,
            taskId: task.id,
            expectedRevision: task.revision,
            attemptId: lease.attemptId,
            participantId: input.participantId,
            activationId: binding.activation.id,
          }
          const nextPhase = task.cancellation !== undefined || current.projection.team.closure !== undefined
            || current.projection.team.cancellation !== undefined
            ? 'cancelled' : this.phaseAfterAttemptOutcome(task, outcome)
          await this.authorizeOrThrow('task-mutate', input.teamId, {
            ...ownerAttemptFacts(owner),
            outcome: attemptOutcomeFacts(outcome),
            nextPhase,
          }, input.participantId)
          revalidate()
          const settled = this.settledAttempt(task, lease, settledAt, outcome)
          const nextTask = this.withSettledAttempt(task, settled, nextPhase)
          records.push({ type: 'task/changed', task: nextTask, createdAt: settledAt })
        }
        const nextBinding: ActivationBindingSnapshot = {
          ...binding,
          activation: { ...binding.activation, status: 'offline' },
          quiescedAt: settledAt,
          quiescenceSource: source,
          quiescedWakeChannelIds: wakeChannelIds,
        }
        await this.authorizeOrThrow('activate', input.teamId, {
          activationId: input.activationId,
          participantId: input.participantId,
          sessionId: input.sessionId,
          provider: input.provider,
          status: 'offline',
          expectedCursor: input.expectedCursor,
          ...source === 'fenced' ? { fenced: true } : { quiesced: true },
        })
        revalidate()
        records.push({ type: 'activation/changed', binding: nextBinding, createdAt: settledAt })
        revalidate()
        await this.commitTeamCommand(current, records, 'TEAM_TASK_GRAPH_INVALID')
        await this.closeQuiescedWakeChannels(current, binding.activation.id, wakeChannelIds, revalidate)
        return this.teamState(current.projection)
      })
    })
  }

  /** Resolve one controller-owned bind proof to its exact JSON-only publication input. */
  private resolveActivationBindAuthority(
    actor: TeamSystemActivationProof,
    input: ActivationBindInput,
  ): void {
    const resolution = this.requireSystemActivationProof(actor)
    const scope = resolution.scope
    if (resolution.sourceName !== TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE
      || scope.kind !== 'activation-controller-bind'
      || scope.expectedCursor !== input.expectedCursor
      || !isDeepStrictEqual(scope.binding, input.binding)) {
      this.rejectActivationActor()
    }
  }

  /** Resolve one controller-owned status proof against the current durable activation binding. */
  private resolveActivationStatusAuthority(
    team: LoadedTeam,
    binding: ActivationBindingSnapshot,
    actor: TeamSystemActivationProof,
    input: ActivationStatusUpdateInput,
  ): void {
    const resolution = this.requireSystemActivationProof(actor)
    const scope = resolution.scope
    if (resolution.sourceName !== TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE
      || scope.kind !== 'activation-controller-status'
      || scope.teamId !== input.teamId
      || scope.activationId !== input.activationId
      || scope.expectedCursor !== input.expectedCursor
      || scope.status !== input.status
      || !this.activationScopeMatchesBinding(team, binding, scope)) {
      this.rejectActivationActor()
    }
  }

  /** Resolve one controller or recovery quiescence proof against the current durable binding. */
  private resolveActivationQuiescenceAuthority(
    team: LoadedTeam,
    binding: ActivationBindingSnapshot,
    actor: TeamSystemActivationProof,
    input: ActivationFenceInput,
    source: 'fenced' | 'quiesced',
  ): void {
    const resolution = this.requireSystemActivationProof(actor)
    const scope = resolution.scope
    if (scope.kind === 'activation-controller-bind' || scope.kind === 'activation-controller-status'
      || scope.kind === 'activation-controller-reserve' || scope.kind === 'activation-controller-release-reservation') {
      this.rejectActivationActor()
    }
    if (!this.matchesActivationQuiescenceScope(resolution, input, source)
      || !this.activationScopeMatchesBinding(team, binding, scope)) {
      this.rejectActivationActor()
    }
    if (scope.kind === 'activation-recovery-quiesce'
      && (binding.activation.status !== 'offline'
        || binding.quiescedAt === undefined
        || binding.quiescenceSource !== 'quiesced')) {
      this.rejectActivationActor()
    }
  }

  /** Resolve bind authority before the Hub opens the selected Team journal. */
  private assertInitialActivationBindAuthority(actor: TeamSystemActivationProof, input: ActivationBindInput): void {
    this.resolveActivationBindAuthority(actor, input)
  }

  /** Resolve status authority before the Hub opens the selected Team journal. */
  private assertInitialActivationStatusAuthority(actor: TeamSystemActivationProof, input: ActivationStatusUpdateInput): void {
    const resolution = this.requireSystemActivationProof(actor)
    const scope = resolution.scope
    if (resolution.sourceName !== TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE
      || scope.kind !== 'activation-controller-status'
      || scope.teamId !== input.teamId
      || scope.activationId !== input.activationId
      || scope.expectedCursor !== input.expectedCursor
      || scope.status !== input.status) {
      this.rejectActivationActor()
    }
  }

  /** Resolve quiescence authority before the Hub opens the selected Team journal. */
  private assertInitialActivationQuiescenceAuthority(
    actor: TeamSystemActivationProof,
    input: ActivationFenceInput,
    source: 'fenced' | 'quiesced',
  ): void {
    if (!this.matchesActivationQuiescenceScope(this.requireSystemActivationProof(actor), input, source)) {
      this.rejectActivationActor()
    }
  }

  /** Check one proof resolution's source, operation kind, and JSON-only exact fence input. */
  private matchesActivationQuiescenceScope(
    resolution: TeamSystemActivationProofResolution,
    input: ActivationFenceInput,
    source: 'fenced' | 'quiesced',
  ): boolean {
    const scope = resolution.scope
    const matchesInput = scope.kind !== 'activation-controller-reserve' && scope.kind !== 'activation-controller-release-reservation'
      && scope.kind !== 'activation-controller-bind'
      && scope.kind !== 'activation-controller-status'
      && scope.teamId === input.teamId
      && scope.activationId === input.activationId
      && scope.participantId === input.participantId
      && scope.sessionId === input.sessionId
      && scope.provider === input.provider
      && scope.expectedCursor === input.expectedCursor
    if (!matchesInput) return false
    if (source === 'fenced') {
      return resolution.sourceName === TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE
        && scope.kind === 'activation-controller-fence'
    }
    return (resolution.sourceName === TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE
      && scope.kind === 'activation-controller-quiesce')
      || (resolution.sourceName === TEAM_ACTIVATION_RECOVERY_PROOF_SOURCE
        && scope.kind === 'activation-recovery-quiesce')
  }

  /** Compare one non-bind source scope to its exact current durable activation identity. */
  private activationScopeMatchesBinding(
    team: LoadedTeam,
    binding: ActivationBindingSnapshot,
    scope: {
      readonly teamId: TeamId
      readonly activationId: ActivationId
      readonly participantId: ParticipantId
      readonly sessionId: ActivationBindingSnapshot['sessionId']
      readonly provider: string
    },
  ): boolean {
    return scope.teamId === team.id
      && binding.activation.teamId === scope.teamId
      && binding.activation.id === scope.activationId
      && binding.activation.participantId === scope.participantId
      && binding.sessionId === scope.sessionId
      && binding.provider === scope.provider
  }

  /** Reject every forged, revoked, foreign, stale, or wrong-operation activation authority. */
  private rejectActivationActor(): never {
    throw new TeamError('Activation lifecycle actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Read one durable binding by Team and activation epoch identity.
   * @param request - Team and activation identities.
   * @returns the current detached durable binding.
   */
  override async getActivation(request: ActivationGetRequest): Promise<ActivationBindingSnapshot> {
    return await this.admit(async () => {
      const input = activationGetRequestSchema.parse(request)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(() => {
        const binding = this.findActivationBinding(this.requireLiveTeam(loaded).projection, input.activationId)
        if (binding === undefined) {
          throw new TeamError(`Activation '${input.activationId}' was not found`, 'TEAM_ACTIVATION_NOT_FOUND')
        }
        return Promise.resolve(this.activationBindingSnapshot(binding))
      })
    })
  }

  /**
   * Persist one TeamRun human-to-coordinator soft interrupt for the current deliverable activation.
   * @param request - source-owned interrupt proof and JSON-only observed Team cursor.
   * @returns the exact durable interrupt target or an existing unacknowledged request for it.
   */
  override async requestParticipantInterrupt(request: ParticipantInterruptRequest): Promise<ParticipantInterruptSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = participantInterruptRequestInputSchema.parse(untrustedInput)
      const human = this.isHumanParticipantInterruptActor(actor, input)
      if (human) {
        const loaded = await this.ensureTeam(input.teamId)
        return await loaded.queue.run(async () => {
          const current = this.requireLiveTeam(loaded)
          const { actorId, target } = this.resolveHumanParticipantInterruptAuthority(
            current,
            actor as TeamHumanActorProof,
            input,
          )
          if (current.projection.team.phase !== 'active') {
            throw new TeamError(`Team '${current.id}' is not active`, 'TEAM_INVALID_ARGUMENT')
          }
          await this.authorizeOrThrow('interrupt', input.teamId, interruptFacts(input.expectedCursor, target), actorId)
          const existing = this.findPendingInterrupt(current.projection, target)
          if (existing !== undefined) return this.interruptSnapshot(existing)
          const createdAt = nextTeamTimestamp(current.projection)
          const interrupt: ParticipantInterruptSnapshot = {
            id: mintTeamInterruptId(),
            actorId,
            target,
            requestedAt: createdAt,
          }
          const record: ParticipantInterruptRequestedJournalRecord = {
            type: 'participant-interrupt/requested',
            interrupt,
            createdAt,
          }
          const confirmed = this.resolveHumanParticipantInterruptAuthority(
            current,
            actor as TeamHumanActorProof,
            input,
          )
          if (confirmed.actorId !== actorId || !sameInterruptTarget(confirmed.target, target)) {
            this.rejectHumanParticipantActor()
          }
          await this.commitTeamCommand(current, [record], 'TEAM_INVALID_ARGUMENT')
          return this.interruptSnapshot(interrupt)
        })
      }

      const initial = this.requireSystemInterruptProof(actor as TeamSystemInterruptProof)
      if (initial.scope.teamId !== input.teamId) this.rejectInterruptActor()
      const loaded = await this.ensureTeam(input.teamId)
      if (!loaded.projection.channelIds.has(initial.scope.channelId)) this.rejectInterruptActor()
      const channel = await this.ensureAttachedChannel(initial.scope.channelId)
      return await loaded.queue.run(async () => await channel.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const currentChannel = this.requireLiveChannel(channel)
        const { actorId, target } = this.resolveTeamRunInterruptAuthority(
          current,
          currentChannel,
          actor as TeamSystemInterruptProof,
          input,
        )
        if (current.projection.team.phase !== 'active') {
          throw new TeamError(`Team '${current.id}' is not active`, 'TEAM_INVALID_ARGUMENT')
        }
        await this.authorizeOrThrow('interrupt', input.teamId, interruptFacts(input.expectedCursor, target), actorId)
        const existing = this.findPendingInterrupt(current.projection, target)
        if (existing !== undefined) return this.interruptSnapshot(existing)
        this.assertTeamCursor(current, input.expectedCursor)
        const createdAt = nextTeamTimestamp(current.projection)
        const interrupt: ParticipantInterruptSnapshot = {
          id: mintTeamInterruptId(),
          actorId,
          target,
          requestedAt: createdAt,
        }
        const record: ParticipantInterruptRequestedJournalRecord = {
          type: 'participant-interrupt/requested',
          interrupt,
          createdAt,
        }
        const confirmed = this.resolveTeamRunInterruptAuthority(
          current,
          currentChannel,
          actor as TeamSystemInterruptProof,
          input,
        )
        if (confirmed.actorId !== actorId || !sameInterruptTarget(confirmed.target, target)) this.rejectInterruptActor()
        await this.commitTeamCommand(current, [record], 'TEAM_INVALID_ARGUMENT')
        return this.interruptSnapshot(interrupt)
      }))
    })
  }

  /**
   * List pending soft interrupts for one exact current Link activation proof.
   * @param request - runtime target activation proof with no caller-selected binding fields.
   * @returns detached pending interrupts in durable request order.
   */
  override async listPendingParticipantInterrupts(
    request: ParticipantInterruptListPendingRequest,
  ): Promise<readonly ParticipantInterruptSnapshot[]> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      participantInterruptListPendingInputSchema.parse(untrustedInput)
      const issued = this.requireActivationActorProof(actor)
      const loaded = await this.ensureTeam(issued.activation.teamId)
      return await loaded.queue.run(() => {
        const current = this.requireLiveTeam(loaded)
        const target = this.resolveInterruptActorTarget(current, actor, false)
        const pending = [...current.projection.interrupts.values()]
          .filter(interrupt => interrupt.acknowledgedAt === undefined && sameInterruptTarget(interrupt.target, target))
          .map(interrupt => this.interruptSnapshot(interrupt))
        return Promise.resolve(freeze(pending))
      })
    })
  }

  /**
   * Acknowledge one soft interrupt from its exact target activation proof.
   * @param request - runtime target activation proof and JSON-only interrupt identity.
   * @returns the durable acknowledged interrupt, including a duplicate acknowledgement.
   */
  override async acknowledgeParticipantInterrupt(
    request: ParticipantInterruptAcknowledgeRequest,
  ): Promise<ParticipantInterruptSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = participantInterruptAcknowledgeInputSchema.parse(untrustedInput)
      const issued = this.requireActivationActorProof(actor)
      const loaded = await this.ensureTeam(issued.activation.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const target = this.resolveInterruptActorTarget(current, actor, true)
        const interrupt = current.projection.interrupts.get(input.interruptId)
        if (interrupt === undefined || !sameInterruptTarget(interrupt.target, target)) {
          throw new TeamError(`Participant interrupt '${input.interruptId}' does not target this activation`, 'TEAM_INVALID_ARGUMENT')
        }
        if (interrupt.acknowledgedAt !== undefined) return this.interruptSnapshot(interrupt)
        const createdAt = nextTeamTimestamp(current.projection)
        const record: ParticipantInterruptAcknowledgedJournalRecord = {
          type: 'participant-interrupt/acknowledged',
          interruptId: input.interruptId,
          target,
          createdAt,
        }
        await this.commitTeamCommand(current, [record], 'TEAM_INVALID_ARGUMENT')
        return this.interruptSnapshot({ ...interrupt, acknowledgedAt: createdAt })
      })
    })
  }

  /**
   * Create one pending Team task with a newly minted independent identity.
   * @param request - Team, observed cursor, complete task fields, coordinator retry command, and runtime proof.
   * @returns the detached pending task projection.
   */
  override async createTask(request: TeamTaskCreateRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamTaskCreateInputSchema.parse(untrustedInput)
      const human = this.isHumanTaskCreateActor(actor, input)
      if (human && (input.workflowPlanId !== undefined || input.workflowTemplateId !== undefined)) {
        return this.rejectHumanTaskActor()
      }
      const coordinatorActor = human ? undefined : this.requireCoordinatorTaskAuthorityForTeam(actor, input.teamId)
      const loaded = await this.ensureTeam(input.teamId)
      await this.repairPendingParentCharges(loaded)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const createCommand = human
          ? this.createCommandFromHuman(current, actor, input)
          : this.createCommandFromCoordinator(
            current,
            this.requireCoordinatorTaskAuthorityForTeam(coordinatorActor, input.teamId),
            input.createCommand.idempotencyKey,
          )
        this.assertNoPendingParentCharges(current.projection)
        const creation = resolveTaskPlacementDefault(current.projection, normalizeTaskCreate(input), createCommand.creator.participantId)
        const workflowExisting = findWorkflowTask(current.projection, input.workflowPlanId, input.workflowTemplateId)
        if (workflowExisting !== undefined) {
          if (!sameTaskCreate(workflowExisting, creation)) {
            throw new TeamError(
              `workflow task template '${input.workflowTemplateId}' was already compiled with different task fields`,
              'TEAM_WORKFLOW_PLAN_INVALID',
            )
          }
          return this.taskSnapshot(workflowExisting)
        }
        if (input.workflowPlanId !== undefined && input.workflowTemplateId !== undefined) {
          const plan = this.requireWorkflowPlan(current, input.workflowPlanId)
          if (plan.phase !== 'compiling') {
            throw new TeamError(`workflow plan '${plan.id}' is not compiling`, 'TEAM_WORKFLOW_PLAN_INVALID')
          }
          const template = plan.plan.tasks.find(candidate => candidate.id === input.workflowTemplateId)
          if (template === undefined) {
            throw new TeamError(`workflow plan '${plan.id}' has no template '${input.workflowTemplateId}'`, 'TEAM_WORKFLOW_PLAN_INVALID')
          }
          this.assertWorkflowTaskTemplate(current.projection, plan, template, {
            id: teamTaskIdSchema.parse('workflow-task-validation'),
            teamId: input.teamId,
            revision: 1,
            execution: structuredClone(creation.execution),
            workflowPlanId: input.workflowPlanId,
            workflowTemplateId: input.workflowTemplateId,
            createCommand,
            subject: creation.subject,
            description: creation.description,
            ...creation.integration === undefined ? {} : { integration: structuredClone(creation.integration) },
            phase: 'pending',
            blockedBy: creation.blockedBy,
            requiredCapabilities: creation.requiredCapabilities,
            ...creation.placement === undefined ? {} : { placement: structuredClone(creation.placement) },
            priority: creation.priority,
            readScopes: creation.readScopes,
            writeScopes: creation.writeScopes,
            workspaceMode: creation.workspaceMode,
            budget: creation.budget,
            reviewPolicy: creation.reviewPolicy,
            reviewHistory: [],
            maxAttempts: creation.maxAttempts,
            attemptCount: 0,
            attemptHistory: [],
          })
        }
        const existing = findTaskByCreateCommand(current.projection, createCommand)
        if (existing !== undefined) {
          if (!sameTaskCreate(existing, creation)) {
            throw new TeamError(
              `task creation key '${createCommand.idempotencyKey}' was already used with different task fields`,
              'TEAM_TASK_IDEMPOTENCY_CONFLICT',
            )
          }
          return this.taskSnapshot(existing)
        }
        this.assertTeamWallTime(current.projection)
        this.assertTeamCursor(current, input.expectedCursor)
        resourceBudget(creation.budget, 'task budget')
        this.assertTaskBudgetWithinTeam(current.projection, creation.budget)
        this.assertTaskIntegration(current.projection, creation.integration)
        if (current.projection.tasks.size >= this.teamLimit(current.projection, 'maxTasks', this.config.maxTasksPerTeam)) {
          throw new TeamError(`Team '${input.teamId}' reached its task limit`, 'TEAM_CHANNEL_BACKPRESSURE')
        }
        if (input.maxAttempts > this.teamLimit(current.projection, 'maxTaskAttemptsPerTask', this.config.maxTaskAttemptsPerTask)) {
          throw new TeamError(
            `Team task maxAttempts ${input.maxAttempts} exceeds its configured limit`,
            'TEAM_INVALID_ARGUMENT',
          )
        }
        if (input.reviewPolicy.kind === 'participant') {
          this.requireReviewParticipant(current, input.reviewPolicy.reviewerId)
        }
        this.assertTaskGrant(current.projection, creation, createCommand.creator.participantId)
        if (creation.integration !== undefined) {
          await this.authorizeOrThrow('workspace-integrate', input.teamId, {
            operation: 'integration-task-create',
            sourceTaskId: creation.integration.sourceTaskId,
            sourceAttemptId: creation.integration.sourceAttemptId,
            provider: creation.integration.provider,
            target: creation.integration.target,
            mode: creation.integration.mode,
          }, createCommand.creator.participantId)
        }
        await this.authorizeOrThrow('task-mutate', input.teamId, {
          subject: creation.subject,
          expectedCursor: input.expectedCursor,
          idempotencyKey: createCommand.idempotencyKey,
        }, createCommand.creator.participantId)
        const confirmedCreateCommand = human
          ? this.createCommandFromHuman(current, actor, input)
          : this.createCommandFromCoordinator(
            current,
            this.requireCoordinatorTaskAuthorityForTeam(coordinatorActor, input.teamId),
            input.createCommand.idempotencyKey,
          )
        const createdAt = nextTeamTimestamp(current.projection)
        const task: TeamTaskSnapshot = {
          id: mintTaskId(),
          teamId: input.teamId,
          revision: 1,
          execution: structuredClone(creation.execution),
          ...creation.execution.kind === 'participant' ? {} : { delegation: {
            id: teamDelegationIdSchema.parse(`delegation-${randomUUID()}`), phase: 'requested' as const,
            requestedAt: createdAt, updatedAt: createdAt,
          } },
          ...creation.parentTaskId === undefined ? {} : { parentTaskId: creation.parentTaskId },
          ...creation.workflowPlanId === undefined ? {} : { workflowPlanId: creation.workflowPlanId },
          ...creation.workflowTemplateId === undefined ? {} : { workflowTemplateId: creation.workflowTemplateId },
          createCommand: structuredClone(confirmedCreateCommand),
          subject: creation.subject,
          description: creation.description,
          ...creation.integration === undefined ? {} : { integration: structuredClone(creation.integration) },
          phase: 'pending',
          blockedBy: [...creation.blockedBy],
          requiredCapabilities: creation.requiredCapabilities,
          ...creation.placement === undefined ? {} : { placement: structuredClone(creation.placement) },
          priority: creation.priority,
          readScopes: creation.readScopes,
          writeScopes: creation.writeScopes,
          workspaceMode: creation.workspaceMode,
          budget: creation.budget,
          reviewPolicy: creation.reviewPolicy,
          reviewHistory: [],
          maxAttempts: creation.maxAttempts,
          attemptCount: 0,
          attemptHistory: [],
        }
        await this.commitTeamCommand(current, [{
          type: 'task/changed', task, createdAt,
        }], 'TEAM_TASK_GRAPH_INVALID')
        return this.taskSnapshot(task)
      })
    })
  }

  /** Reserve one child stream identity and complete template payload before any child process starts. */
  override async beginTaskDelegation(request: TeamTaskDelegationBeginRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const { actor, ...wire } = request
      const input = teamTaskDelegationBeginInputSchema.parse(wire)
      const issued = this.requireSystemDelegationProof(actor)
      if (issued.scope.kind !== 'delegation-begin') this.rejectDelegationProof()
      const source = this.getSystemDelegationProofSource(issued.sourceName)
      if (source === undefined) this.rejectDelegationProof()
      const workspacePath = await source.resolveChildWorkspace(actor)
      if (input.child.rules.workspacePath !== workspacePath) throw new TeamError('Child creation must retain its current controlled workspace', 'TEAM_DELEGATION_WORKSPACE_UNAVAILABLE')
      const parent = await this.ensureTeam(input.teamId)
      await this.repairPendingParentCharges(parent)
      return await parent.queue.run(async () => {
        const current = this.requireLiveTeam(parent)
        this.requireDelegationCommand(current, actor, input, 'delegation-begin')
        const task = this.requireChildDelegationTask(current, input)
        const creation: TeamChildCreateInput = {
          ...input.child, parentTeamId: input.teamId, parentTaskId: input.taskId, delegationId: input.delegationId,
        }
        if (task.delegation.childTeamId !== undefined) {
          if (!isDeepStrictEqual(task.delegation.creation, creation)) throw new TeamError('Child creation retry changed its frozen payload', 'TEAM_DELEGATION_INVALID')
          return this.taskSnapshot(task)
        }
        if (current.projection.team.phase !== 'active' || task.phase !== 'pending' || task.cancellation !== undefined
          || (task.delegation.phase !== 'requested' && task.delegation.phase !== 'stalled')
          || !task.blockedBy.every(id => current.projection.tasks.get(id)?.phase === 'completed')) {
          throw new TeamError('Child delegation is not ready to start', 'TEAM_DELEGATION_BUSY')
        }
        this.assertTeamWallTime(current.projection)
        this.assertNoPendingParentCharges(current.projection)
        this.resolveChildLineage(current, current.id, task.id)
        this.assertChildDelegationPayload(current.projection, task, creation)
        const requestedConcurrency = Math.max(1, resourceBudget(creation.budgets, 'child budget').maxConcurrency ?? 1)
        const limit = resourceBudget(current.projection.budgets, 'parent Team budget').maxConcurrency
        if (limit !== undefined && requestedConcurrency > limit) throw new TeamError('Child delegation exceeds parent concurrency', 'TEAM_BUDGET_EXCEEDED')
        if ((limit !== undefined && resourceBudgetUsage(current.projection).maxConcurrency + requestedConcurrency > limit)
          || taskHasSharedWriteConflict(task, current.projection.tasks.values())) {
          throw new TeamError('Child delegation waits for parent concurrency or shared write scopes', 'TEAM_DELEGATION_BUSY')
        }
        await this.authorizeOrThrow('task-assign', current.id, { operation: 'delegation-begin', taskId: task.id,
          delegationId: task.delegation.id, child: jsonObjectSchema.parse(creation) }, task.createCommand.creator.participantId)
        this.requireDelegationCommand(current, actor, input, 'delegation-begin')
        const createdAt = nextTeamTimestamp(current.projection)
        const next: TeamTaskSnapshot = { ...task, revision: task.revision + 1, phase: 'running', attemptCount: 1,
          delegation: { ...task.delegation, phase: 'creating', startedAt: createdAt, updatedAt: createdAt,
            childTeamId: mintTeamId(), creation: structuredClone(creation) } }
        await this.commitTeamCommand(current, [{ type: 'task/changed', task: next, createdAt }], 'TEAM_DELEGATION_INVALID')
        return this.taskSnapshot(next)
      })
    })
  }

  /** Confirm the already published child endpoints without starting another activation. */
  override async bindTaskDelegation(request: TeamTaskDelegationBindRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const { actor, ...wire } = request
      const input = teamTaskDelegationBindInputSchema.parse(wire)
      this.requireSystemDelegationProof(actor)
      const parent = await this.ensureTeam(input.teamId)
      const child = await this.ensureTeam(input.childTeamId)
      return await parent.queue.run(async () => {
        const current = this.requireLiveTeam(parent)
        this.requireDelegationCommand(current, actor, input, 'delegation-bind')
        const task = this.requireChildDelegationTask(current, input)
        this.assertDelegationChild(task, this.requireLiveTeam(child))
        const binding = child.projection.team.childRun
        if (binding !== undefined && binding.delegationId !== task.delegation.id) throw new TeamError('Child runtime differs from its reserved delegation', 'TEAM_DELEGATION_INVALID')
        if (task.delegation.phase === 'active' || task.delegation.phase === 'settling') return this.taskSnapshot(task)
        if (binding === undefined && task.delegation.childCursor === child.projection.team.cursor) return this.taskSnapshot(task)
        const createdAt = nextTeamTimestamp(current.projection)
        const next: TeamTaskSnapshot = { ...task, revision: task.revision + 1,
          delegation: { ...task.delegation, phase: binding === undefined ? 'creating' : 'active', updatedAt: createdAt,
            childCursor: child.projection.team.cursor } }
        await this.commitTeamCommand(current, [{ type: 'task/changed', task: next, createdAt }], 'TEAM_DELEGATION_INVALID')
        return this.taskSnapshot(next)
      })
    })
  }

  /** Keep an unresolved child's reservation while surfacing its operational reason. */
  override async stallTaskDelegation(request: TeamTaskDelegationStallRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const { actor, ...wire } = request
      const input = teamTaskDelegationStallInputSchema.parse(wire)
      this.requireSystemDelegationProof(actor)
      const parent = await this.ensureTeam(input.teamId)
      return await parent.queue.run(async () => {
        const current = this.requireLiveTeam(parent)
        this.requireDelegationCommand(current, actor, input, 'delegation-stall')
        const task = this.requireChildDelegationTask(current, input)
        if (task.phase === 'completed' || task.phase === 'failed' || task.phase === 'cancelled' || task.phase === 'deleted') return this.taskSnapshot(task)
        if (task.delegation.phase === 'stalled' && isDeepStrictEqual(task.delegation.failure, input.reason)) return this.taskSnapshot(task)
        const createdAt = nextTeamTimestamp(current.projection)
        const next: TeamTaskSnapshot = { ...task, revision: task.revision + 1,
          delegation: { ...task.delegation, phase: 'stalled', updatedAt: createdAt, failure: structuredClone(input.reason) } }
        await this.commitTeamCommand(current, [{ type: 'task/changed', task: next, createdAt },
          ...current.projection.team.phase === 'active' ? [{ type: 'team/phase' as const, phase: 'stalled' as const, reason: input.reason, createdAt }] : [],
        ], 'TEAM_DELEGATION_INVALID')
        return this.taskSnapshot(next)
      })
    })
  }

  /** Mint a live operation token whose synchronous validator never takes a child-to-parent lock. */
  override async authorizeChildRun(request: TeamChildRunAuthorizeRequest): Promise<TeamChildRunAuthorization> {
    return await this.admit(async () => {
      const { actor, ...wire } = request
      const input = teamChildRunAuthorizeInputSchema.parse(wire)
      const resolution = this.requireSystemDelegationProof(actor)
      if (resolution.scope.kind !== 'delegation-authorize-run') this.rejectDelegationProof()
      const source = this.getSystemDelegationProofSource(resolution.sourceName)
      if (source === undefined) this.rejectDelegationProof()
      const parent = await this.ensureTeam(input.teamId)
      const workspacePath = input.operation === 'start' ? await source.resolveChildWorkspace(actor) : undefined
      return await parent.queue.run(() => {
        const current = this.requireLiveTeam(parent)
        this.requireDelegationCommand(current, actor, input, 'delegation-authorize-run')
        const task = this.requireChildDelegationTask(current, input)
        const childTeamId = task.delegation.childTeamId
        if (input.operation === 'start') {
          if (task.delegation.creation?.rules.workspacePath !== workspacePath) {
            throw new TeamError('Child workspace differs from its frozen reservation', 'TEAM_DELEGATION_WORKSPACE_UNAVAILABLE')
          }
          this.assertTeamWallTime(current.projection)
          this.assertNoPendingParentCharges(current.projection)
          const exceeded = taskBudgetExceeded(task, current.projection.usageSamples, Date.now(), current.projection.usageCharges)
          if (exceeded !== undefined) throw new TeamError(exceeded.message, 'TEAM_BUDGET_EXCEEDED')
        }
        if (childTeamId === undefined) throw new TeamError('Child operation has no reserved child', 'TEAM_DELEGATION_INVALID')
        const identity = { parentTeamId: input.teamId, parentTaskId: input.taskId, childTeamId, delegationId: input.delegationId }
        const scope: TeamChildRunScope = input.operation === 'cancel' ? { ...identity, operation: 'cancel' }
          : { ...identity, operation: 'start', workspacePath: workspacePath as string }
        const isLive = (): boolean => {
          if (this.getSystemDelegationProofSource(resolution.sourceName) !== source
            || source.resolveDelegationProof(actor) === undefined) return false
          const latest = parent.projection.tasks.get(input.taskId)
          if (latest?.execution.kind !== 'child-team' || latest.delegation?.id !== input.delegationId
            || latest.delegation.childTeamId !== childTeamId
            || (input.operation === 'start' && latest.delegation.childCursor === undefined)
            || !taskHasActiveExecution(latest)) return false
          return input.operation === 'start'
            ? parent.projection.team.phase === 'active' && latest.phase === 'running' && latest.cancellation === undefined
              && parent.projection.team.closure === undefined && parent.projection.team.cancellation === undefined
            : latest.cancellation !== undefined || parent.projection.team.closure !== undefined
              || parent.projection.team.cancellation !== undefined
        }
        if (!isLive()) this.rejectDelegationProof()
        return Promise.resolve(this.createChildRunAuthorization(scope, async () => {
          if (!isLive()) this.rejectDelegationProof()
          if (input.operation === 'start') {
            const actual = await source.resolveChildWorkspace(actor)
            if (actual !== workspacePath
              || parent.projection.tasks.get(input.taskId)?.delegation?.creation?.rules.workspacePath !== actual) {
              this.rejectDelegationProof()
            }
            this.assertTeamWallTime(parent.projection)
            this.assertNoPendingParentCharges(parent.projection)
            const exceeded = taskBudgetExceeded(
              parent.projection.tasks.get(input.taskId), parent.projection.usageSamples, Date.now(), parent.projection.usageCharges,
            )
            if (exceeded !== undefined) throw new TeamError(exceeded.message, 'TEAM_BUDGET_EXCEEDED')
          }
          if (!isLive()) this.rejectDelegationProof()
          return scope
        }, isLive))
      })
    })
  }

  /** Settle the parent only after the exact child terminal state and charge outbox are durable. */
  override async settleTaskDelegation(request: TeamTaskDelegationSettleRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const { actor, ...wire } = request
      const input = teamTaskDelegationSettleInputSchema.parse(wire)
      this.requireSystemDelegationProof(actor)
      const parent = await this.ensureTeam(input.teamId)
      let child: LoadedTeam | undefined
      try { child = await this.ensureTeam(input.childTeamId) } catch (error: unknown) {
        if (!(error instanceof TeamError) || error.code !== 'TEAM_NOT_FOUND') throw error
      }
      if (child !== undefined) await this.repairPendingParentCharges(child)
      await this.repairPendingParentCharges(parent)
      return await parent.queue.run(async () => {
        const current = this.requireLiveTeam(parent)
        this.requireDelegationCommand(current, actor, input, 'delegation-settle')
        const task = this.requireChildDelegationTask(current, input)
        if (child === undefined) {
          if (this.teams.has(input.childTeamId)) throw new TeamError('Child creation completed during cancellation selection', 'TEAM_DELEGATION_BUSY')
          if (task.delegation.childTeamId !== input.childTeamId || task.delegation.childCursor !== undefined
            || (task.cancellation === undefined && current.projection.team.cancellation === undefined
              && current.projection.team.closure === undefined)) {
            throw new TeamError('Missing child stream cannot prove safe cancellation', 'TEAM_DELEGATION_CHILD_MISSING')
          }
          const createdAt = nextTeamTimestamp(current.projection)
          const next: TeamTaskSnapshot = { ...task, revision: task.revision + 1, phase: 'cancelled',
            delegation: { ...task.delegation, phase: 'cancelled', updatedAt: createdAt } }
          await this.commitTeamCommand(current, [{ type: 'task/changed', task: next, createdAt }], 'TEAM_DELEGATION_INVALID')
          return this.taskSnapshot(next)
        }
        const currentChild = this.requireLiveTeam(child)
        this.assertDelegationChild(task, currentChild)
        const phase = currentChild.projection.team.phase
        if (phase !== 'completed' && phase !== 'failed' && phase !== 'cancelled') throw new TeamError('Child execution is not terminal', 'TEAM_NOT_QUIESCENT')
        this.assertNoPendingParentCharges(currentChild.projection)
        this.assertNoPendingParentCharges(current.projection)
        if (phase === 'completed' && (task.delegation.result === undefined
          || !isDeepStrictEqual(task.delegation.result.binding, currentChild.projection.team.childRun))) {
          throw new TeamError('Completed child has no matching parent-admitted service result', 'TEAM_DELEGATION_INVALID')
        }
        const outcome = task.cancellation !== undefined || current.projection.team.cancellation !== undefined ? 'cancelled' : phase
        if (task.delegation.phase === outcome && task.phase === outcome) return this.taskSnapshot(task)
        await this.authorizeOrThrow('task-mutate', current.id, { operation: 'delegation-settle', taskId: task.id,
          childTeamId: input.childTeamId, outcome }, task.createCommand.creator.participantId)
        this.requireDelegationCommand(current, actor, input, 'delegation-settle')
        const createdAt = nextTeamTimestamp(current.projection)
        const next: TeamTaskSnapshot = { ...task, revision: task.revision + 1, phase: outcome,
          delegation: { ...task.delegation, phase: outcome, updatedAt: createdAt, childCursor: currentChild.projection.team.cursor,
            ...outcome === 'failed' ? { failure: currentChild.projection.team.closure?.reason
              ?? { code: 'CHILD_TEAM_FAILED', message: 'Child Team failed before completion.' } } : {} } }
        await this.commitTeamCommand(current, [{ type: 'task/changed', task: next, createdAt }], 'TEAM_DELEGATION_INVALID')
        return this.taskSnapshot(next)
      })
    })
  }

  private requireChildDelegationTask(parent: LoadedTeam, input: TeamTaskDelegationInput): ChildDelegationTask {
    this.assertTeamCursor(parent, input.expectedCursor)
    const task = this.requireTask(parent, input.taskId)
    if (task.revision !== input.expectedRevision) throw new TeamError('Parent delegation task revision is stale', 'TEAM_TASK_STALE_REVISION')
    if (task.execution.kind !== 'child-team' || task.delegation?.id !== input.delegationId) {
      throw new TeamError('Parent delegation does not match the current task executor or revision', 'TEAM_DELEGATION_INVALID')
    }
    return task as ChildDelegationTask
  }

  private requireDelegationCommand(
    parent: LoadedTeam, proof: TeamSystemDelegationProof, input: object, kind: TeamSystemDelegationScope['kind'],
  ): void {
    const resolution = this.requireSystemDelegationProof(proof)
    const { kind: actual, ...value } = resolution.scope
    if (actual !== kind || value.teamId !== parent.id || !isDeepStrictEqual(value, input)) this.rejectDelegationProof()
  }

  private rejectDelegationProof(): never {
    throw new TeamError('Parent delegation proof is invalid for this operation', 'TEAM_ACTOR_PROOF_INVALID')
  }

  private assertDelegationChild(task: ChildDelegationTask, child: LoadedTeam): void {
    if (task.delegation.childTeamId !== child.id || child.projection.team.parentTeamId !== task.teamId
      || child.projection.team.parentTaskId !== task.id) throw new TeamError('Child Team differs from its parent task reservation', 'TEAM_DELEGATION_INVALID')
  }

  private assertChildDelegationPayload(parent: TeamProjection, task: ChildDelegationTask, child: TeamChildCreateInput): void {
    const grant = child.authorityGrant
    if (grant === undefined || child.rules.workspacePath === undefined) throw new TeamError('Child creation requires an explicit grant and controlled workspace', 'TEAM_DELEGATION_INVALID')
    assertAuthorityGrantSubset(task.execution.authorityGrant, grant, 'delegated child')
    assertBudgetSubset(resourceBudget(task.budget, 'parent task budget'), child.budgets, 'delegated child')
    assertBudgetSubset(task.execution.budget, child.budgets, 'delegated child execution')
    this.assertChildTeamBudget(parent, child.budgets, task.id)
  }

  /** Publish one child's result endpoints under ancestor-first serialization and its live parent authorization. */
  override async bindChildRun(request: TeamChildRunBindRequest): Promise<TeamChildRunBinding> {
    return await this.admit(async () => {
      const binding = teamChildRunBindingSchema.parse(request.binding)
      const scope = await this.assertChildRunAuthorization(request.authorization)
      const matches = (candidate: typeof scope): boolean => candidate.operation === 'start'
        && candidate.parentTeamId === binding.parentTeamId && candidate.parentTaskId === binding.parentTaskId
        && candidate.childTeamId === binding.childTeamId && candidate.delegationId === binding.delegationId
      if (!matches(scope)) throw new TeamError('Child endpoint binding differs from its parent authorization', 'TEAM_ACTOR_PROOF_INVALID')
      const parent = await this.ensureTeam(binding.parentTeamId)
      const child = await this.ensureTeam(binding.childTeamId)
      const channel = await this.ensureAttachedChannel(binding.channelId)
      return await parent.queue.run(() => child.queue.run(() => channel.queue.run(async () => {
        const currentParent = this.requireLiveTeam(parent)
        const current = this.requireLiveTeam(child)
        const currentChannel = this.requireLiveChannel(channel)
        const revalidate = (): void => {
          if (!matches(this.resolveChildRunAuthorization(request.authorization))) {
            throw new TeamError('Child endpoint authorization is no longer current', 'TEAM_ACTOR_PROOF_INVALID')
          }
          const task = this.requireTask(currentParent, binding.parentTaskId)
          const service = current.projection.participants.get(binding.parentServiceId)
          const coordinator = current.projection.participants.get(binding.coordinatorId)
          const manifest = currentChannel.projection.manifest
          if (currentParent.projection.team.phase !== 'active' || task.phase !== 'running' || task.cancellation !== undefined
            || task.execution.kind !== 'child-team' || task.delegation?.id !== binding.delegationId
            || task.delegation.childTeamId !== binding.childTeamId
            || current.projection.team.parentTeamId !== binding.parentTeamId
            || current.projection.team.parentTaskId !== binding.parentTaskId
            || current.projection.team.phase !== 'active' || current.projection.team.cancellation !== undefined
            || current.projection.team.closure !== undefined || service?.kind !== 'service' || service.role !== 'parent-service'
            || service.phase !== 'active' || coordinator?.phase !== 'active' || coordinator.role !== 'coordinator'
            || !isAgentParticipant(coordinator) || manifest.teamId !== binding.childTeamId
            || manifest.adapter.type !== 'consult' || manifest.adapter.version !== 1 || manifest.participants.length !== 2
            || !manifest.participants.some(member => member.id === binding.parentServiceId && member.role === 'initiator')
            || !manifest.participants.some(member => member.id === binding.coordinatorId && member.role === 'respondent')) {
            throw new TeamError('Child runtime endpoints do not match active delegated work', 'TEAM_INVALID_ARGUMENT')
          }
          this.assertAttachedChannel(current, currentChannel)
        }
        revalidate()
        if (current.projection.team.childRun !== undefined) {
          if (!isDeepStrictEqual(current.projection.team.childRun, binding)) {
            throw new TeamError('Child runtime already has different result endpoints', 'TEAM_INVALID_ARGUMENT')
          }
          return structuredClone(current.projection.team.childRun)
        }
        this.assertTeamCursor(current, request.expectedCursor)
        await this.authorizeOrThrow('activate', current.id, { operation: 'child-run-bind', ...binding })
        revalidate()
        await this.commitTeamCommand(current, [{ type: 'team/child-run-bound', binding,
          createdAt: nextTeamTimestamp(current.projection) }], 'TEAM_INVALID_ARGUMENT')
        return structuredClone(binding)
      })))
    })
  }

  /** Accept one immutable child response in its parent task, retaining the running reservation until child settlement. */
  override async admitTaskDelegationResult(request: TeamTaskDelegationResultAdmitRequest): Promise<TeamDelegationResultAdmission> {
    return await this.admit(async () => {
      const { actor, ...raw } = request
      const input = teamTaskDelegationResultAdmitInputSchema.parse(raw)
      const validateProof = (): void => {
        const resolution = this.requireSystemDelegationProof(actor)
        const { kind, ...scope } = resolution.scope
        if (resolution.sourceName !== 'team-delegation' || kind !== 'delegation-result-admit' || !isDeepStrictEqual(scope, input)) {
          throw new TeamError('Parent result admission proof does not match its exact request', 'TEAM_ACTOR_PROOF_INVALID')
        }
      }
      validateProof()
      const parent = await this.ensureTeam(input.teamId)
      const child = await this.ensureTeam(input.childTeamId)
      await this.repairPendingParentCharges(child)
      const binding = child.projection.team.childRun
      if (binding === undefined) throw new TeamError('Child runtime has not bound its result endpoints', 'TEAM_CHILD_RESULT_PARENT_PENDING')
      const channel = await this.ensureAttachedChannel(binding.channelId)
      return await parent.queue.run(async () => await child.queue.run(async () => await channel.queue.run(async () => {
        validateProof()
        const currentParent = this.requireLiveTeam(parent)
        const currentChild = this.requireLiveTeam(child)
        const currentChannel = this.requireLiveChannel(channel)
        const task = this.requireParentDelegation(currentParent, currentChild, binding)
        if (task.id !== input.taskId || task.delegation.id !== input.delegationId) {
          throw new TeamError('Parent result selects another delegation', 'TEAM_ACTOR_PROOF_INVALID')
        }
        const selected = await this.requireChildResponse(currentChild, currentChannel, input.responseEnvelopeId)
        const payload = this.childResultPayload(currentChild, binding, selected.request, selected.response)
        const prior = task.delegation.result
        if (prior !== undefined) {
          const { parentCursor: _cursor, parentTaskRevision: _revision, admittedAt: _time, ...original } = prior
          if (!isDeepStrictEqual(original, payload)) throw new TeamError('Parent delegation already accepted a different child result', 'TEAM_CHILD_RESULT_CONFLICT')
          validateProof()
          return freeze(structuredClone(prior))
        }
        if (currentParent.projection.team.phase !== 'active' || currentParent.projection.team.cancellation !== undefined
          || currentParent.projection.team.closure !== undefined || task.cancellation !== undefined
          || task.phase !== 'running' || !['creating', 'active'].includes(task.delegation.phase)) {
          throw new TeamError('Parent delegation is not accepting a child result', 'TEAM_CHILD_RESULT_INVALID')
        }
        this.assertTeamCursor(currentParent, input.expectedCursor)
        if (task.revision !== input.expectedRevision) throw new TeamError('Parent task revision changed before result admission', 'TEAM_TASK_STALE_REVISION')
        this.assertFinalAdmissionEligibility(currentChild, selected.response)
        await this.authorizeOrThrow('task-mutate', currentParent.id, { operation: 'delegation-result-admit', taskId: task.id,
          childTeamId: child.id, responseEnvelopeId: selected.response.id })
        validateProof()
        this.requireParentDelegation(currentParent, currentChild, binding)
        const admittedAt = Math.max(nextTeamTimestamp(currentParent.projection), selected.response.createdAt)
        const admission = teamDelegationResultAdmissionSchema.parse({ ...payload, parentTaskRevision: task.revision + 1,
          parentCursor: currentParent.projection.team.cursor + 1, admittedAt })
        const next: TeamTaskSnapshot = { ...task, revision: task.revision + 1,
          delegation: { ...task.delegation, phase: 'settling', result: admission, updatedAt: admittedAt } }
        await this.commitTeamCommand(currentParent, [{ type: 'task/changed', task: next, createdAt: admittedAt }], 'TEAM_CHILD_RESULT_INVALID')
        return freeze(structuredClone(admission))
      })))
    })
  }

  /** Admit and receipt a parent-accepted child result before beginning quiescent completion. */
  override async completeChildTeam(request: TeamChildResultCommandRequest): Promise<TeamStateSnapshot> {
    return await this.admit(async () => {
      const { actor, ...raw } = request
      const input = teamChildResultCommandInputSchema.parse(raw)
      const initial = this.requireSystemChildResultProof(actor)
      if (initial.scope.kind !== 'child-result-complete' || initial.scope.binding.childTeamId !== input.childTeamId
        || initial.scope.expectedCursor !== input.expectedCursor) this.rejectChildResultActor()
      const scope = initial.scope
      const parent = await this.ensureTeam(scope.binding.parentTeamId)
      const child = await this.ensureTeam(input.childTeamId)
      await this.repairPendingParentCharges(child)
      const channels = await Promise.all([...child.projection.channelIds].map(id => this.ensureChannel(id)))
      return await parent.queue.run(async () => await child.queue.run(async () => await this.withChannelQueues(channels, async () => {
        const currentParent = this.requireLiveTeam(parent)
        const current = this.requireLiveTeam(child)
        const validate = (): void => {
          const live = this.requireSystemChildResultProof(actor)
          if (!isDeepStrictEqual(live, initial)) this.rejectChildResultActor()
          const task = this.requireParentDelegation(currentParent, current, scope.binding)
          if (task.delegation.result === undefined || !isDeepStrictEqual(task.delegation.result, scope.admission)
            || !isDeepStrictEqual(scope.binding, scope.admission.binding)) {
            throw new TeamError('Child completion lacks its exact parent-task result admission', 'TEAM_CHILD_RESULT_PARENT_PENDING')
          }
        }
        validate()
        const channel = channels.find(value => value.id === scope.binding.channelId)
        if (channel === undefined) throw new TeamError('Child result channel is not attached', 'TEAM_CHILD_RESULT_INVALID')
        const selected = await this.requireChildResponse(current, channel, scope.admission.responseEnvelopeId)
        this.assertChildResultMatches(current, scope.admission, selected.request, selected.response)
        if (current.projection.team.phase === 'completed') {
          await this.requireChildServiceReceipt(current, channel, scope.admission)
          return this.teamState(current.projection)
        }
        if (current.projection.team.cancellation !== undefined || current.projection.team.closure?.kind === 'fail') {
          throw new TeamError('A cancelling or failed child cannot complete', 'TEAM_CHILD_RESULT_INVALID')
        }
        const parentTask = currentParent.projection.tasks.get(scope.binding.parentTaskId)
        if (parentTask?.cancellation !== undefined || currentParent.projection.team.cancellation !== undefined) {
          throw new TeamError('Parent cancellation has closed child completion admission', 'TEAM_CHILD_RESULT_INVALID')
        }
        this.assertTeamCursor(current, input.expectedCursor)
        if (current.projection.team.closure === undefined && current.projection.team.phase !== 'active'
          && current.projection.team.phase !== 'quiescing') {
          throw new TeamError('A stalled child requires explicit resume before result completion', 'TEAM_CHILD_RESULT_INVALID')
        }
        this.assertFinalAdmissionEligibility(current, selected.response)
        await this.authorizeOrThrow('close', current.id, { operation: 'child-result-complete', parentTeamId: parent.id,
          parentTaskId: scope.binding.parentTaskId, responseEnvelopeId: selected.response.id })
        validate()
        if (current.projection.team.childResultAdmission === undefined) {
          const admittedAt = Math.max(nextTeamTimestamp(current.projection), scope.admission.admittedAt)
          const admission: TeamChildResultAdmission = { parent: structuredClone(scope.admission), admittedAt }
          await this.commitTeamCommand(current, [{ type: 'team/child-result-admitted', admission, createdAt: admittedAt }], 'TEAM_CHILD_RESULT_INVALID')
        } else if (!isDeepStrictEqual(current.projection.team.childResultAdmission.parent, scope.admission)) {
          throw new TeamError('Child retained a different parent result admission', 'TEAM_CHILD_RESULT_CONFLICT')
        }
        const prior = await this.findCommittedReceipt(channel, scope.binding.parentServiceId, selected.response.id)
        if (prior === undefined) {
          const pending = channel.projection.pendingDeliveries.get(scope.binding.parentServiceId)?.get(selected.response.id)
          if (pending === undefined) throw new TeamError('Child service response has no pending delivery', 'TEAM_CHILD_RESULT_INVALID')
          await this.authorizeOrThrow('dispatch', current.id, { operation: 'child-service-receipt', channelId: channel.id,
            envelopeId: selected.response.id, parentTeamId: parent.id, parentCursor: scope.admission.parentCursor })
          validate()
          await this.commitPendingDeliveryReceipt(channel, scope.binding.parentServiceId, pending, validate)
        }
        if (current.projection.team.closure === undefined) {
          const requestedAt = nextTeamTimestamp(current.projection)
          const closure: TeamClosureSnapshot = { teamId: current.id, kind: 'complete',
            idempotencyKey: teamClosureIdempotencyKeySchema.parse(`child-result:${scope.binding.delegationId}`),
            actor: { kind: 'system', name: initial.sourceName },
            reason: { code: 'CHILD_RESULT_ACCEPTED', message: 'The parent task accepted the child service response' },
            finalChannelId: channel.id, finalEnvelopeId: selected.response.id, requestedAt }
          const records: TeamJournalRecord[] = [{ type: 'team/closure', closure, createdAt: requestedAt }]
          const goal = current.projection.team.goal
          if (goal.phase !== 'complete') records.push({ type: 'goal/changed', goal: { ...goal, revision: goal.revision + 1, phase: 'complete' }, createdAt: requestedAt })
          if (current.projection.team.phase !== 'quiescing') records.push({ type: 'team/phase', phase: 'quiescing', createdAt: requestedAt })
          validate()
          await this.commitTeamCommand(current, records, 'TEAM_CHILD_RESULT_INVALID')
        } else if (current.projection.team.closure.kind !== 'complete'
          || current.projection.team.closure.finalChannelId !== channel.id
          || current.projection.team.closure.finalEnvelopeId !== selected.response.id) {
          throw new TeamError('Child closure selects another result', 'TEAM_CHILD_RESULT_CONFLICT')
        }
        if (this.closureResourcesSettled(current.projection, true) && this.closureDeliveriesSettled(channels)
          && this.closureChannelsTerminal(channels)) {
          validate()
          const createdAt = nextTeamTimestamp(current.projection)
          const terminal: TeamJournalRecord[] = []
          if (current.projection.team.phase === 'stalled') terminal.push({ type: 'team/phase', phase: 'quiescing', createdAt })
          terminal.push({ type: 'team/phase', phase: 'completed', createdAt })
          await this.commitTeamCommand(current, terminal, 'TEAM_CHILD_RESULT_INVALID')
        }
        return this.teamState(current.projection)
      })))
    })
  }

  /** Close child admission before the parent runtime releases even a partial bootstrap. */
  override async cancelChildTeam(request: TeamChildCancelRequest): Promise<TeamStateSnapshot> {
    return await this.admit(async () => {
      const { authorization, ...raw } = request
      const input = teamChildCancelInputSchema.parse(raw)
      const scope = await this.assertChildRunAuthorization(authorization)
      if (scope.operation !== 'cancel' || scope.childTeamId !== input.childTeamId) this.rejectChildResultActor()
      const parent = await this.ensureTeam(scope.parentTeamId)
      const child = await this.ensureTeam(input.childTeamId)
      const channels = await Promise.all([...child.projection.channelIds].map(id => this.ensureChannel(id)))
      return await parent.queue.run(async () => await child.queue.run(async () => await this.withChannelQueues(channels, async () => {
        const current = this.requireLiveTeam(child)
        const validate = (): void => {
          const live = this.resolveChildRunAuthorization(authorization)
          const task = this.requireLiveTeam(parent).projection.tasks.get(scope.parentTaskId)
          if (!isDeepStrictEqual(live, scope) || current.projection.team.parentTeamId !== parent.id
            || current.projection.team.parentTaskId !== scope.parentTaskId || task?.delegation?.id !== scope.delegationId
            || task.delegation.childTeamId !== child.id) this.rejectChildResultActor()
        }
        validate()
        if (['completed', 'failed', 'cancelled'].includes(current.projection.team.phase)) return this.teamState(current.projection)
        const prior = current.projection.team.cancellation
        if (prior !== undefined) {
          if (prior.idempotencyKey !== input.idempotencyKey || !isDeepStrictEqual(prior.reason, input.reason)) {
            throw new TeamError('Child cancellation retry changed its durable intent', 'TEAM_CLOSURE_IDEMPOTENCY_CONFLICT')
          }
          return this.teamState(current.projection)
        }
        // An accepted completion/failure already closes admission; parent cancellation waits for that terminal settlement.
        if (current.projection.team.closure !== undefined) return this.teamState(current.projection)
        this.assertTeamCursor(current, input.expectedCursor)
        await this.authorizeOrThrow('close', current.id, { operation: 'child-cancel', parentTeamId: parent.id, parentTaskId: scope.parentTaskId })
        validate()
        const requestedAt = nextTeamTimestamp(current.projection)
        const cancellation: TeamCancellationSnapshot = { teamId: current.id, idempotencyKey: input.idempotencyKey,
          actor: { kind: 'system', name: 'team-delegation' }, reason: input.reason, requestedAt }
        const records: TeamJournalRecord[] = [{ type: 'team/cancellation', cancellation, createdAt: requestedAt }]
        if (current.projection.team.phase !== 'quiescing') records.push({ type: 'team/phase', phase: 'quiescing', createdAt: requestedAt })
        records.push(...this.closureBusinessCleanupRecords(current.projection, 'cancel', input.reason))
        await this.commitTeamCommand(current, records, 'TEAM_INVALID_ARGUMENT')
        return this.teamState(current.projection)
      })))
    })
  }

  /** Record only a current child coordinator's observed turn with no accepted service response. */
  override async recordChildResultMissing(request: TeamChildResultCommandRequest): Promise<TeamStateSnapshot> {
    return await this.admit(async () => {
      const { actor, ...raw } = request
      const input = teamChildResultCommandInputSchema.parse(raw)
      const initial = this.requireSystemChildResultProof(actor)
      if (initial.sourceName !== 'team-run' || initial.scope.kind !== 'child-result-missing'
        || initial.scope.binding.childTeamId !== input.childTeamId
        || initial.scope.expectedCursor !== input.expectedCursor) this.rejectChildResultActor()
      const scope = initial.scope
      const child = await this.ensureTeam(input.childTeamId)
      const channel = await this.ensureAttachedChannel(scope.binding.channelId)
      return await child.queue.run(async () => await channel.queue.run(async () => {
        const current = this.requireLiveTeam(child)
        const validate = (): void => {
          const binding = current.projection.activations.get(scope.activationId)
          if (!isDeepStrictEqual(this.requireSystemChildResultProof(actor), initial)
            || !isDeepStrictEqual(current.projection.team.childRun, scope.binding)
            || binding?.activation.participantId !== scope.binding.coordinatorId || binding.sessionId !== scope.sessionId
            || binding.provider !== scope.provider || !['idle', 'running'].includes(binding.activation.status)) this.rejectChildResultActor()
        }
        validate()
        if (current.projection.team.phase !== 'active' || current.projection.team.closure !== undefined
          || current.projection.team.cancellation !== undefined) return this.teamState(current.projection)
        if (await this.findChildResponse(current, channel) !== undefined) return this.teamState(current.projection)
        this.assertTeamCursor(current, input.expectedCursor)
        await this.authorizeOrThrow('close', current.id, { operation: 'child-result-missing', activationId: scope.activationId, turn: scope.turn })
        validate()
        await this.commitTeamCommand(current, [{ type: 'team/phase', phase: 'stalled', createdAt: nextTeamTimestamp(current.projection),
          reason: { code: 'CHILD_RESULT_MISSING', message: `Child coordinator turn ${scope.turn} ended without its parent-service response` } }], 'TEAM_INVALID_ARGUMENT')
        return this.teamState(current.projection)
      }))
    })
  }

  /** Recheck the immutable parent-child task relation without acquiring another serializer. */
  private requireParentDelegation(parent: LoadedTeam, child: LoadedTeam, binding: TeamChildRunBinding): TeamTaskSnapshot & { delegation: NonNullable<TeamTaskSnapshot['delegation']> } {
    const task = parent.projection.tasks.get(binding.parentTaskId)
    if (parent.id !== binding.parentTeamId || child.id !== binding.childTeamId
      || child.projection.team.parentTeamId !== parent.id || child.projection.team.parentTaskId !== binding.parentTaskId
      || !isDeepStrictEqual(child.projection.team.childRun, binding)
      || task?.execution.kind !== 'child-team' || task.delegation?.id !== binding.delegationId
      || task.delegation.childTeamId !== child.id) {
      throw new TeamError('Child result does not match its reserved parent delegation', 'TEAM_CHILD_RESULT_INVALID')
    }
    return task as TeamTaskSnapshot & { delegation: NonNullable<TeamTaskSnapshot['delegation']> }
  }

  /** Validate a child's actual service and coordinator endpoints against the retained consult manifest. */
  private assertChildResultChannel(team: TeamProjectionOwner, channel: LoadedChannel): TeamChildRunBinding {
    const binding = team.projection.team.childRun
    const manifest = channel.projection.manifest
    if (binding === undefined || binding.childTeamId !== team.id || binding.channelId !== channel.id
      || manifest.teamId !== team.id || manifest.adapter.type !== 'consult' || manifest.adapter.version !== 1
      || manifest.participants.length !== 2
      || !manifest.participants.some(member => member.id === binding.parentServiceId && member.role === 'initiator')
      || !manifest.participants.some(member => member.id === binding.coordinatorId && member.role === 'respondent')
      || team.projection.participants.get(binding.parentServiceId)?.kind !== 'service'
      || team.projection.participants.get(binding.coordinatorId)?.role !== 'coordinator') {
      throw new TeamError('Child result does not use its bound parent-service consult', 'TEAM_CHILD_RESULT_INVALID')
    }
    return binding
  }

  /** Validate both consult endpoints and their exact request-response causation. */
  private async requireChildResponse(team: TeamProjectionOwner, channel: LoadedChannel, responseId: EnvelopeId) {
    const binding = this.assertChildResultChannel(team, channel)
    const response = await this.findCommittedEnvelope(channel, responseId)
    if (response === undefined || response.kind !== 'response' || response.senderId !== binding.coordinatorId
      || response.audience?.length !== 1 || response.audience[0] !== binding.parentServiceId
      || response.delivery !== 'turn' || response.causationId === undefined
      || typeof response.payload.text !== 'string' || response.payload.text.trim().length === 0) {
      throw new TeamError('Child response is not addressed to its exact parent service', 'TEAM_CHILD_RESULT_INVALID')
    }
    const request = await this.findCommittedEnvelope(channel, response.causationId)
    if (request === undefined || request.kind !== 'request' || request.senderId !== binding.parentServiceId
      || request.audience?.length !== 1 || request.audience[0] !== binding.coordinatorId || request.delivery !== 'turn'
      || request.sequence >= response.sequence || typeof request.payload.text !== 'string' || request.payload.text.trim().length === 0) {
      throw new TeamError('Child response does not causally answer its bound service request', 'TEAM_CHILD_RESULT_INVALID')
    }
    return { request, response: response as TeamEnvelope & { audience: readonly [ParticipantId] } }
  }

  /** Find a protocol-valid response without interpreting a closed consult as missing human output. */
  private async findChildResponse(team: TeamProjectionOwner, channel: LoadedChannel) {
    this.assertChildResultChannel(team, channel)
    let cursor = -1
    for (;;) {
      const rows = await channel.stream.read(cursor, this.config.recoveryPageSize)
      if (rows.length === 0) return undefined
      for (const row of rows) {
        const record = channelRecordSchema.parse(row.value)
        if (record.type === 'channel/envelope' && record.envelope.kind === 'response') {
          try { return await this.requireChildResponse(team, channel, record.envelope.id) }
          catch (error: unknown) {
            if (error instanceof TeamError && error.code === 'TEAM_CHILD_RESULT_INVALID') return undefined
            throw error
          }
        }
        cursor = row.sequence
      }
    }
  }

  /** Collect every durable artifact reference in authoritative Team order. */
  private artifactReferences(projection: TeamProjection): readonly TeamArtifactReference[] {
    const references: TeamArtifactReference[] = []
    for (const allocation of projection.workspaceAllocations.values()) {
      references.push(...allocation.loss?.artifacts ?? [])
    }
    for (const task of projection.tasks.values()) {
      references.push(...task.delegation?.result?.artifacts ?? [])
      for (const attempt of task.attemptHistory) {
        if (attempt.outcome.kind !== 'completed') continue
        const result = attempt.outcome.result
        references.push(...result.artifacts ?? [])
        if (result.integration?.proposalArtifact !== undefined) references.push(result.integration.proposalArtifact)
        references.push(...result.integration?.artifacts ?? [])
      }
    }
    return references
  }

  /** Deduplicate visible artifact references and remove ambiguous identities. */
  private visibleArtifactReferences(projection: TeamProjection): readonly TeamArtifactReference[] {
    const values = new Map<string, TeamArtifactReference>()
    const ambiguous = new Set<string>()
    for (const reference of this.artifactReferences(projection)) {
      if (reference.visibility === 'private') continue
      const prior = values.get(reference.id)
      if (prior !== undefined && !isDeepStrictEqual(prior, reference)) ambiguous.add(reference.id)
      else values.set(reference.id, structuredClone(reference))
    }
    return [...values.entries()].filter(([id]) => !ambiguous.has(id)).map(([, reference]) => reference)
  }

  /** Resolve one visible, unambiguous artifact without returning the full Team projection. */
  private visibleArtifactReference(projection: TeamProjection, artifactId: string): TeamArtifactReference | undefined {
    return this.visibleArtifactReferences(projection).find(reference => reference.id === artifactId)
  }

  /** Preserve non-private artifacts from the child's completed work, including nested delegated results. */
  private childResultArtifacts(projection: TeamProjection): readonly TeamArtifactReference[] {
    const artifacts = new Map<string, TeamArtifactReference>()
    for (const task of projection.tasks.values()) {
      if (task.phase !== 'completed') continue
      const outcome = task.attemptHistory.at(-1)?.outcome
      const values = task.execution.kind === 'child-team' ? task.delegation?.result?.artifacts ?? []
        : outcome?.kind === 'completed' ? outcome.result.artifacts ?? [] : []
      for (const artifact of values) if (artifact.visibility !== 'private') artifacts.set(JSON.stringify(artifact), artifact)
    }
    return [...artifacts.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([, artifact]) => structuredClone(artifact))
  }

  /** Derive the exact immutable result content separately from the parent's append cursor. */
  private childResultPayload(team: TeamProjectionOwner, binding: TeamChildRunBinding, request: TeamEnvelope, response: TeamEnvelope) {
    return { binding: structuredClone(binding), requestEnvelopeId: request.id, requestSequence: request.sequence,
      responseEnvelopeId: response.id, responseSequence: response.sequence,
      contentFingerprint: fingerprintTeamChildResultContent(response.payload), text: response.payload.text as string,
      artifacts: this.childResultArtifacts(team.projection) }
  }

  /** Match retained child and parent result facts against their actual WAL and task outputs. */
  private assertChildResultMatches(
    team: TeamProjectionOwner, admission: TeamDelegationResultAdmission, request: TeamEnvelope, response: TeamEnvelope,
  ): void {
    const binding = team.projection.team.childRun
    const { parentCursor: _cursor, parentTaskRevision: _revision, admittedAt: _time, ...payload } = admission
    if (binding === undefined || admission.admittedAt < response.createdAt
      || !isDeepStrictEqual(payload, this.childResultPayload(team, binding, request, response))) {
      throw new TeamError('Child result content or artifacts differ from parent admission', 'TEAM_CHILD_RESULT_INVALID')
    }
  }

  /** Verify the service receipt without accepting either a human proof or an activation for that service. */
  private async requireChildServiceReceipt(
    team: TeamProjectionOwner, channel: LoadedChannel, admission: TeamDelegationResultAdmission,
  ): Promise<void> {
    const retained = team.projection.team.childResultAdmission
    if (retained === undefined || !isDeepStrictEqual(retained.parent, admission)
      || await this.findCommittedReceipt(channel, admission.binding.parentServiceId, admission.responseEnvelopeId) === undefined) {
      throw new TeamError('Child result has no matching service receipt and admission', 'TEAM_CHILD_RESULT_INVALID')
    }
  }

  /** Validate the parent sink through a raw immutable record or an anchored checkpoint, avoiding recursive Team loads. */
  private async assertParentResultStored(admission: TeamDelegationResultAdmission): Promise<void> {
    const name = teamStreamName(admission.binding.parentTeamId)
    const retained = this.teams.get(admission.binding.parentTeamId)?.stream
      ?? this.teamOpeningStreams.get(admission.binding.parentTeamId)
      ?? this.ctx.storageLog.get(name)
    const stream = retained ?? await this.ctx.storageLog.open({ name, version: TEAM_JOURNAL_FORMAT_VERSION })
    const matches = (task: TeamTaskSnapshot): boolean => task.id === admission.binding.parentTaskId
      && task.teamId === admission.binding.parentTeamId && task.execution.kind === 'child-team'
      && task.delegation?.id === admission.binding.delegationId && task.delegation.childTeamId === admission.binding.childTeamId
      && isDeepStrictEqual(task.delegation.result, admission)
    try {
      if (admission.parentCursor >= stream.firstSequence) {
        const row = (await stream.read(admission.parentCursor - 1, 1))[0]
        const record = row === undefined ? undefined : teamJournalRecordSchema.parse(row.value)
        if (row?.sequence === admission.parentCursor && record?.type === 'task/changed'
          && record.task.revision === admission.parentTaskRevision
          && record.createdAt === admission.admittedAt && matches(record.task)) return
        throw new TeamError('Parent journal does not contain the claimed child result admission', 'TEAM_CHILD_RESULT_INVALID')
      }
      const checkpoint = await stream.readCheckpoint()
      const parsed = checkpoint === undefined ? undefined : teamProjectionCheckpointSchema.safeParse(checkpoint.value)
      if (checkpoint !== undefined && parsed?.success === true && parsed.data.teamId === admission.binding.parentTeamId
        && parsed.data.projection.team.cursor === checkpoint.sequence && checkpoint.sequence >= admission.parentCursor
        && await hasCheckpointAnchor(stream, checkpoint.sequence)) {
        const projection = teamProjectionFromData(parsed.data.projection)
        const task = projection.tasks.get(admission.binding.parentTaskId)
        if (task !== undefined && matches(task)) return
      }
      throw new TeamError('Parent checkpoint does not retain the claimed child result admission', 'TEAM_CHILD_RESULT_INVALID')
    } finally { if (retained === undefined) await stream.close() }
  }

  /** Reject raw ids, wrong source operations and stale child owner proofs. */
  private rejectChildResultActor(): never {
    throw new TeamError('Child result authority is invalid', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Admit one complete declarative workflow plan before its tasks or channel are created. */
  override async admitWorkflowPlan(request: TeamWorkflowPlanAdmissionRequest): Promise<TeamWorkflowPlanSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamWorkflowPlanAdmissionInputSchema.parse(untrustedInput)
      const coordinatorActor = this.requireCoordinatorTaskAuthorityForTeam(actor, input.teamId)
      const loaded = await this.ensureTeam(input.teamId)
      await this.repairPendingParentCharges(loaded)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const planActor = this.coordinatorTaskCreator(current, coordinatorActor)
        this.assertNoPendingParentCharges(current.projection)
        const existing = findWorkflowPlanByKey(current.projection, input.idempotencyKey)
        if (existing !== undefined) {
          if (!isDeepStrictEqual(existing.plan, input.plan) || !sameWorkflowPlanActor(existing.actor, planActor)) {
            throw new TeamError(
              `workflow plan key '${input.idempotencyKey}' was already used with different plan facts`,
              'TEAM_WORKFLOW_PLAN_IDEMPOTENCY_CONFLICT',
            )
          }
          return this.workflowPlanSnapshot(existing)
        }
        if (current.projection.team.phase !== 'active') {
          throw new TeamError(`Team '${input.teamId}' is not active`, 'TEAM_INVALID_ARGUMENT')
        }
        this.assertTeamWallTime(current.projection)
        this.assertTeamCursor(current, input.expectedCursor)
        if (current.projection.tasks.size + input.plan.tasks.length > this.teamLimit(current.projection, 'maxTasks', this.config.maxTasksPerTeam)) {
          throw new TeamError(`workflow plan '${input.plan.name}' exceeds the Team task limit`, 'TEAM_CHANNEL_BACKPRESSURE')
        }
        this.assertWorkflowPlanParticipants(current.projection, input.plan)
        this.assertWorkflowPlanGrant(current.projection, input.plan, planActor.participantId)
        assertWorkflowPlanTaskBudgets(current.projection, input.plan)
        await this.authorizeOrThrow('task-mutate', input.teamId, {
          operation: 'workflow-plan-admit',
          name: input.plan.name,
          version: input.plan.version,
          taskCount: input.plan.tasks.length,
          maxParallelism: input.plan.bounds.maxParallelism,
          maxTotalAttempts: input.plan.bounds.maxTotalAttempts,
        }, planActor.participantId)
        const confirmedPlanActor = this.coordinatorTaskCreator(
          current,
          this.requireCoordinatorTaskAuthorityForTeam(coordinatorActor, input.teamId),
        )
        const plan: TeamWorkflowPlanSnapshot = {
          id: mintWorkflowPlanId(),
          teamId: input.teamId,
          revision: 1,
          idempotencyKey: input.idempotencyKey,
          actor: structuredClone(confirmedPlanActor),
          plan: structuredClone(input.plan),
          phase: 'compiling',
          taskBindings: [],
        }
        const record: TeamJournalRecord = {
          type: 'workflow-plan/changed',
          plan,
          createdAt: nextTeamTimestamp(current.projection),
        }
        await this.commitTeamCommand(current, [record], 'TEAM_WORKFLOW_PLAN_INVALID')
        return this.workflowPlanSnapshot(plan)
      })
    })
  }

  /** Inspect one workflow under its owning Team serializer and configured response allowance. */
  override async inspectWorkflowPlan(request: TeamWorkflowInspectRequest): Promise<TeamWorkflowInspection> {
    return await this.admit(async () => {
      const input = teamWorkflowInspectRequestSchema.parse(request)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(() => {
        const current = this.requireLiveTeam(loaded).projection
        const plan = current.workflowPlans.get(input.planId)
        if (plan === undefined) throw new TeamError(`workflow plan '${input.planId}' was not found`, 'TEAM_WORKFLOW_PLAN_NOT_FOUND')
        const result = projectWorkflowInspection(plan, current.team.cursor,
          { ...input, afterCursor: input.afterCursor ?? -1, limit: this.pageLimit(input.limit ?? this.config.recoveryPageSize) },
          this.config.maxSelectionTextBytes, this.config.maxSelectionBytes)
        if (!result.ok) throw new TeamError(`Workflow inspection failed: ${result.reason}`,
          result.reason === 'metadata' || result.reason === 'row' ? 'TEAM_CHANNEL_BACKPRESSURE' : 'TEAM_WORKFLOW_PLAN_INVALID')
        return Promise.resolve(freeze(result.value))
      })
    })
  }

  /** Read one durable workflow plan without exposing the Hub's mutable map. */
  override async getWorkflowPlan(request: TeamWorkflowPlanGetRequest): Promise<TeamWorkflowPlanSnapshot> {
    return await this.admit(async () => {
      const input = teamWorkflowPlanGetRequestSchema.parse(request)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(() => {
        const plan = this.requireLiveTeam(loaded).projection.workflowPlans.get(input.planId)
        if (plan === undefined) throw new TeamError(`workflow plan '${input.planId}' was not found`, 'TEAM_WORKFLOW_PLAN_NOT_FOUND')
        return Promise.resolve(this.workflowPlanSnapshot(plan))
      })
    })
  }

  /** List one bounded page of workflow plans without materializing the full projection at the API boundary. */
  override async listWorkflowPlansPage(request: TeamWorkflowPlanListPageRequest): Promise<TeamWorkflowPlanListPage> {
    return await this.admit(async () => {
      const input = teamWorkflowPlanListPageRequestSchema.parse(request)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(() => {
        const current = this.requireLiveTeam(loaded)
        const values = [...current.projection.workflowPlans.values()]
        const limit = this.pageLimit(input.limit)
        const start = input.afterCursor >= values.length ? values.length : input.afterCursor + 1
        const selected = values.slice(start, start + limit + 1)
        return Promise.resolve(freeze(teamWorkflowPlanListPageSchema.parse({
          items: selected.slice(0, limit).map(plan => this.workflowPlanSnapshot(plan)),
          ...selected.length > limit ? { nextCursor: start + limit - 1 } : {},
        })))
      })
    })
  }

  /** Bind one compiled workflow template to its durable Team task. */
  override async bindWorkflowPlanTask(request: TeamWorkflowPlanTaskBindRequest): Promise<TeamWorkflowPlanSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamWorkflowPlanTaskBindInputSchema.parse(untrustedInput)
      this.workflowTaskBindScope(actor, input)
      const loaded = await this.ensureTeam(input.teamId)
      await this.repairPendingParentCharges(loaded)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const plan = this.resolveWorkflowTaskBindAuthority(current, actor, input)
        this.assertNoPendingParentCharges(current.projection)
        const priorBinding = plan.taskBindings.find(binding => binding.templateId === input.templateId)
        if (priorBinding !== undefined) {
          if (priorBinding.taskId !== input.taskId) {
            throw new TeamError(`workflow template '${input.templateId}' is already bound to another task`, 'TEAM_WORKFLOW_PLAN_INVALID')
          }
          return this.workflowPlanSnapshot(plan)
        }
        if (plan.phase !== 'compiling') {
          throw new TeamError(`workflow plan '${plan.id}' is not compiling`, 'TEAM_WORKFLOW_PLAN_INVALID')
        }
        const template = plan.plan.tasks.find(candidate => candidate.id === input.templateId)
        if (template === undefined) {
          throw new TeamError(`workflow plan '${plan.id}' has no template '${input.templateId}'`, 'TEAM_WORKFLOW_PLAN_INVALID')
        }
        const task = current.projection.tasks.get(input.taskId)
        if (task === undefined) throw new TeamError(`Team task '${input.taskId}' was not found`, 'TEAM_TASK_NOT_FOUND')
        this.assertWorkflowTaskTemplate(current.projection, plan, template, task)
        const duplicateTask = plan.taskBindings.find(binding => binding.taskId === task.id)
        if (duplicateTask !== undefined) {
          throw new TeamError(`Team task '${task.id}' is already bound to workflow template '${duplicateTask.templateId}'`, 'TEAM_WORKFLOW_PLAN_INVALID')
        }
        for (const dependency of template.blockedBy) {
          if (!plan.taskBindings.some(binding => binding.templateId === dependency)) {
            throw new TeamError(`workflow template '${template.id}' cannot bind before dependency '${dependency}'`, 'TEAM_WORKFLOW_PLAN_INVALID')
          }
        }
        this.assertTeamCursor(current, input.expectedCursor)
        if (plan.revision !== input.expectedRevision) {
          throw new TeamError(`workflow plan '${plan.id}' revision ${input.expectedRevision} is stale`, 'TEAM_WORKFLOW_PLAN_STALE_REVISION')
        }
        await this.authorizeOrThrow('task-mutate', input.teamId, {
          operation: 'workflow-task-bind',
          planId: input.planId,
          templateId: input.templateId,
          taskId: input.taskId,
        }, plan.actor?.participantId)
        const confirmedPlan = this.resolveWorkflowTaskBindAuthority(current, actor, input)
        const bindings = sortWorkflowBindings(
          confirmedPlan.plan.tasks,
          [...confirmedPlan.taskBindings, { templateId: input.templateId, taskId: input.taskId }],
        )
        const next: TeamWorkflowPlanSnapshot = {
          ...confirmedPlan,
          revision: confirmedPlan.revision + 1,
          taskBindings: bindings,
        }
        await this.commitTeamCommand(current, [{ type: 'workflow-plan/changed', plan: next, createdAt: nextTeamTimestamp(current.projection) }], 'TEAM_WORKFLOW_PLAN_INVALID')
        return this.workflowPlanSnapshot(next)
      })
    })
  }

  /** Bind the idempotently opened workflow channel to its durable plan. */
  override async bindWorkflowPlanChannel(request: TeamWorkflowPlanChannelBindRequest): Promise<TeamWorkflowPlanSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamWorkflowPlanChannelBindInputSchema.parse(untrustedInput)
      this.workflowChannelBindScope(actor, input)
      const loaded = await this.ensureTeam(input.teamId)
      await this.repairPendingParentCharges(loaded)
      const channel = await this.ensureAttachedChannel(input.channelId)
      return await loaded.queue.run(async () => await channel.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const currentChannel = this.requireLiveChannel(channel)
        const plan = this.resolveWorkflowChannelBindAuthority(current, actor, input)
        this.assertNoPendingParentCharges(current.projection)
        if (plan.channelId !== undefined) {
          if (plan.channelId !== input.channelId) {
            throw new TeamError(`workflow plan '${plan.id}' is already bound to another channel`, 'TEAM_WORKFLOW_PLAN_INVALID')
          }
          return this.workflowPlanSnapshot(plan)
        }
        if (plan.phase !== 'compiling') throw new TeamError(`workflow plan '${plan.id}' is not compiling`, 'TEAM_WORKFLOW_PLAN_INVALID')
        if (!current.projection.channelIds.has(input.channelId)
          || currentChannel.projection.manifest.teamId !== input.teamId
          || currentChannel.projection.manifest.workflowPlanId !== input.planId
          || currentChannel.projection.manifest.adapter.type !== 'workflow'
          || currentChannel.projection.manifest.adapter.version !== 1
          || currentChannel.projection.phase !== 'active') {
          throw new TeamError(`channel '${input.channelId}' is not the active workflow channel for plan '${plan.id}'`, 'TEAM_WORKFLOW_PLAN_INVALID')
        }
        const roles = currentChannel.projection.manifest.participants.map(participant => participant.role)
        if (!isDeepStrictEqual(roles, plan.plan.channel.participantRoles)) {
          throw new TeamError(`channel '${input.channelId}' participant roles do not match workflow plan '${plan.id}'`, 'TEAM_WORKFLOW_PLAN_INVALID')
        }
        this.assertTeamCursor(current, input.expectedCursor)
        await this.authorizeOrThrow('task-mutate', input.teamId, {
          operation: 'workflow-channel-bind',
          planId: input.planId,
          channelId: input.channelId,
        }, plan.actor?.participantId)
        const confirmedPlan = this.resolveWorkflowChannelBindAuthority(current, actor, input)
        const next: TeamWorkflowPlanSnapshot = {
          ...confirmedPlan,
          revision: confirmedPlan.revision + 1,
          channelId: input.channelId,
        }
        await this.commitTeamCommand(current, [{ type: 'workflow-plan/changed', plan: next, createdAt: nextTeamTimestamp(current.projection) }], 'TEAM_WORKFLOW_PLAN_INVALID')
        return this.workflowPlanSnapshot(next)
      }))
    })
  }

  /** Advance a workflow plan to ready or retain its terminal result/failure. */
  override async transitionWorkflowPlan(request: TeamWorkflowPlanPhaseRequest): Promise<TeamWorkflowPlanSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamWorkflowPlanPhaseInputSchema.parse(untrustedInput)
      this.workflowPlanPhaseScope(actor, input)
      const loaded = await this.ensureTeam(input.teamId)
      await this.repairPendingParentCharges(loaded)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const plan = this.resolveWorkflowPlanPhaseAuthority(current, actor, input)
        this.assertNoPendingParentCharges(current.projection)
        if (plan.phase === input.phase) {
          if (isDeepStrictEqual(plan.result, input.result)
            && isDeepStrictEqual(plan.failure, input.failure)
            && isDeepStrictEqual(plan.cancellation, input.cancellation)) {
            return this.workflowPlanSnapshot(plan)
          }
          throw new TeamError(
            `workflow plan '${plan.id}' already has different '${input.phase}' facts`,
            'TEAM_WORKFLOW_PLAN_INVALID',
          )
        }
        if (plan.phase === 'completed' || plan.phase === 'failed' || plan.phase === 'cancelled') {
          throw new TeamError(`workflow plan '${plan.id}' is already terminal`, 'TEAM_WORKFLOW_PLAN_INVALID')
        }
        this.assertTeamCursor(current, input.expectedCursor)
        if (input.phase === 'ready') this.assertWorkflowReady(current.projection, plan)
        if (input.result !== undefined) {
          this.assertWorkflowCompiled(current.projection, plan)
          this.assertWorkflowCompleted(current.projection, plan, input.result)
          if (workflowTerminalOutcome(plan, current.projection.tasks)?.phase !== input.phase) {
            throw new TeamError('workflow terminal phase differs from its task outcomes', 'TEAM_WORKFLOW_PLAN_INVALID')
          }
        }
        await this.authorizeOrThrow('task-mutate', input.teamId, {
          operation: `workflow-plan-${input.phase}`,
          planId: input.planId,
          revision: input.expectedRevision,
        }, plan.actor?.participantId)
        const confirmedPlan = this.resolveWorkflowPlanPhaseAuthority(current, actor, input)
        const next: TeamWorkflowPlanSnapshot = {
          ...confirmedPlan,
          revision: confirmedPlan.revision + 1,
          phase: input.phase,
          ...input.result === undefined ? {} : { result: structuredClone(input.result) },
          ...input.phase === 'failed' && input.failure !== undefined ? { failure: structuredClone(input.failure) } : {},
          ...input.phase === 'cancelled' && input.cancellation !== undefined ? { cancellation: structuredClone(input.cancellation) } : {},
        }
        await this.commitTeamCommand(current, [{ type: 'workflow-plan/changed', plan: next, createdAt: nextTeamTimestamp(current.projection) }], 'TEAM_WORKFLOW_PLAN_INVALID')
        return this.workflowPlanSnapshot(next)
      })
    })
  }

  /**
   * Read one Team task, including a deleted tombstone.
   * @param request - owning Team and task identity.
   * @returns a detached task projection.
   */
  override async getTask(request: TeamTaskGetRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const input = teamTaskGetRequestSchema.parse(request)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(() => {
        const task = this.requireLiveTeam(loaded).projection.tasks.get(input.taskId)
        if (task === undefined) throw new TeamError(`Team task '${input.taskId}' was not found`, 'TEAM_TASK_NOT_FOUND')
        return Promise.resolve(this.taskSnapshot(task))
      })
    })
  }

  /**
   * List a bounded page of Team tasks without materializing an unbounded response.
   * @param request - Team identity, provider-order cursor, and requested page size.
   * @returns detached task projections and a continuation cursor when needed.
   */
  override async listTasksPage(request: TeamTaskListPageRequest): Promise<TeamTaskListPage> {
    return await this.admit(async () => {
      const input = teamTaskListPageRequestSchema.parse(request)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(() => {
        const current = this.requireLiveTeam(loaded)
        const values = [...current.projection.tasks.values()]
        const limit = this.pageLimit(input.limit)
        const start = input.afterCursor >= values.length ? values.length : input.afterCursor + 1
        const selected = values.slice(start, start + limit + 1)
        const items = selected.slice(0, limit).map(task => this.taskSnapshot(task))
        return Promise.resolve(freeze(teamTaskListPageSchema.parse({
          items,
          ...selected.length > limit ? { nextCursor: start + limit - 1 } : {},
        })))
      })
    })
  }

  /**
   * List a bounded page of Team participants with their derived attempt stats.
   * @param request - Team identity, provider-order cursor, and requested page size.
   * @returns detached participant projections and a continuation cursor when needed.
   */
  override async listParticipantsPage(request: TeamMemberListPageRequest): Promise<TeamMemberListPage> {
    return await this.admit(async () => {
      const input = teamMemberListPageRequestSchema.parse(request)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(() => {
        const current = this.requireLiveTeam(loaded)
        const values = [...current.projection.participants.values()]
        const limit = this.pageLimit(input.limit)
        const start = input.afterCursor >= values.length ? values.length : input.afterCursor + 1
        const selected = values.slice(start, start + limit + 1)
        const items = selected.slice(0, limit).map(participant => this.participantWithStats(current.projection, participant))
        return Promise.resolve(freeze(teamMemberListPageSchema.parse({
          items,
          ...selected.length > limit ? { nextCursor: start + limit - 1 } : {},
        })))
      })
    })
  }

  /** Resolve one visible, unambiguous artifact reference from the authoritative Team projection. */
  override async getArtifact(request: TeamArtifactGetRequest): Promise<TeamArtifactReference | undefined> {
    return await this.admit(async () => {
      const input = teamArtifactGetRequestSchema.parse(request)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(() => {
        const current = this.requireLiveTeam(loaded)
        const reference = this.visibleArtifactReference(current.projection, input.artifactId)
        return Promise.resolve(reference === undefined ? undefined : structuredClone(reference))
      })
    })
  }

  /** List a bounded page of visible, unambiguous artifact references from the authoritative Team projection. */
  override async listArtifactsPage(request: TeamArtifactListPageRequest): Promise<TeamArtifactListPage> {
    return await this.admit(async () => {
      const input = teamArtifactListPageRequestSchema.parse(request)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(() => {
        const current = this.requireLiveTeam(loaded)
        const values = this.visibleArtifactReferences(current.projection)
        const limit = this.pageLimit(input.limit)
        const start = input.afterCursor >= values.length ? values.length : input.afterCursor + 1
        const selected = values.slice(start, start + limit + 1)
        return Promise.resolve(freeze(teamArtifactListPageSchema.parse({
          items: selected.slice(0, limit),
          ...selected.length > limit ? { nextCursor: start + limit - 1 } : {},
        })))
      })
    })
  }

  /**
   * Compare-and-set the editable task details without changing scheduler-owned state.
   * @param request - Team/task identity, observed revision, and optional replacement details.
   * @returns the detached task projection after the committed details update.
   */
  override async updateTaskDetails(request: TeamTaskDetailsUpdateRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamTaskDetailsUpdateInputSchema.parse(untrustedInput)
      const human = this.isHumanTaskDetailsActor(actor, input)
      const coordinatorActor = human ? undefined : this.requireCoordinatorTaskAuthorityForTeam(actor, input.teamId)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const actorId = human
          ? this.resolveHumanTaskDetailsAuthority(current, actor, input)
          : this.coordinatorTaskCreator(
            current,
            this.requireCoordinatorTaskAuthorityForTeam(coordinatorActor, input.teamId),
          ).participantId
        const prior = this.requireTask(current, input.taskId)
        this.assertWorkflowTaskDetailsMutable(current.projection, prior, 'edit')
        this.assertTaskRevision(prior, input.expectedRevision)
        this.requireLeaseFreeTask(prior)
        await this.authorizeOrThrow('task-mutate', input.teamId, {
          taskId: input.taskId,
          expectedRevision: input.expectedRevision,
        }, actorId)
        if (human) this.resolveHumanTaskDetailsAuthority(current, actor, input)
        else this.coordinatorTaskCreator(
          current,
          this.requireCoordinatorTaskAuthorityForTeam(coordinatorActor, input.teamId),
        )
        const confirmed = this.requireTask(current, input.taskId)
        this.assertTaskRevision(confirmed, input.expectedRevision)
        this.requireLeaseFreeTask(confirmed)
        const task: TeamTaskSnapshot = {
          ...confirmed,
          revision: confirmed.revision + 1,
          ...input.subject === undefined ? {} : { subject: normalizedText(input.subject, 'subject') },
          ...input.description === undefined ? {} : { description: normalizedText(input.description, 'description') },
          ...input.blockedBy === undefined ? {} : { blockedBy: [...input.blockedBy] },
        }
        const createdAt = nextTeamTimestamp(current.projection)
        await this.commitTeamCommand(current, [{ type: 'task/changed', task, createdAt }], 'TEAM_TASK_GRAPH_INVALID')
        return this.taskSnapshot(task)
      })
    })
  }

  /**
   * Compare-and-set an advisory preferred owner for one pending task.
   * @param request - Team/task identity, observed revision, and optional Participant hint.
   * @returns the detached task projection after the proposal change.
   */
  override async proposeTaskOwner(request: TeamTaskOwnerProposalRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamTaskOwnerProposalInputSchema.parse(untrustedInput)
      this.taskControlOwnerProposalScope(actor, input)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const control = this.resolveTaskControlOwnerProposalAuthority(current, actor, input)
        const prior = control.task
        this.assertWorkflowTaskDetailsMutable(current.projection, prior, 'propose owner')
        this.assertTaskRevision(prior, input.expectedRevision)
        this.requireLeaseFreeTask(prior)
        if (prior.phase !== 'pending') {
          throw new TeamError(`Team task '${prior.id}' cannot receive an owner proposal from '${prior.phase}'`, 'TEAM_INVALID_ARGUMENT')
        }
        if (input.proposedOwnerId !== undefined) this.requireActiveParticipant(current, input.proposedOwnerId)
        await this.authorizeOrThrow('task-mutate', input.teamId, {
          taskId: input.taskId,
          expectedRevision: input.expectedRevision,
          ...input.proposedOwnerId === undefined ? {} : { proposedOwnerId: input.proposedOwnerId },
        }, control.actorId)
        const confirmed = this.resolveTaskControlOwnerProposalAuthority(current, actor, input)
        const task: TeamTaskSnapshot = {
          ...confirmed.task,
          revision: confirmed.task.revision + 1,
          proposedOwnerId: input.proposedOwnerId,
        }
        await this.commitTeamCommand(current, [{ type: 'task/changed', task, createdAt: nextTeamTimestamp(current.projection) }], 'TEAM_TASK_GRAPH_INVALID')
        return this.taskSnapshot(task)
      })
    })
  }

  /**
   * Persist one exact-work stop request while retaining live attempt ownership.
   * @param request - authenticated task selection, revision, and optional reason.
   * @returns the task with its accepted intent, or its settled cancellation.
   */
  override async cancelTask(request: TeamTaskCancelRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamTaskCancelInputSchema.parse(untrustedInput)
      const human = this.isHumanTaskCancelActor(actor, input)
      if (!human) this.taskControlCancelScope(actor, input)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const resolveActor = (): ParticipantId => human
          ? this.resolveHumanTaskCancelAuthority(current, actor, input)
          : this.resolveTaskControlCancelAuthority(current, actor, input).actorId
        const actorId = resolveActor()
        const prior = this.requireTask(current, input.taskId)
        this.assertWorkflowTaskCancellationAllowed(current.projection, prior)
        if (prior.cancellation !== undefined) {
          if (input.expectedRevision !== prior.revision && input.expectedRevision !== prior.cancellation.requestedRevision) {
            this.assertTaskRevision(prior, input.expectedRevision)
          }
          if (prior.cancellation.reason !== input.reason) {
            throw new TeamError(`Task '${prior.id}' already retained another cancellation reason`, 'TEAM_INVALID_ARGUMENT')
          }
          return await this.finishLeaseFreeTaskCancellation(current, prior)
        }
        this.assertTaskRevision(prior, input.expectedRevision)
        if (prior.phase === 'completed' || prior.phase === 'failed' || prior.phase === 'cancelled' || prior.phase === 'deleted') {
          return this.taskSnapshot(prior)
        }
        if (current.projection.team.phase !== 'active' || current.projection.team.closure !== undefined || current.projection.team.cancellation !== undefined) {
          throw new TeamError('new task cancellation requires an active Team without an accepted closure', 'TEAM_INVALID_ARGUMENT')
        }
        const requestedAt = nextTeamTimestamp(current.projection)
        const cancellation: TeamTaskCancellationSnapshot = {
          requestedRevision: prior.revision,
          requestedBy: actorId,
          ...input.reason === undefined ? {} : { reason: input.reason },
          requestedAt,
          target: taskCancellationTarget(prior),
        }
        await this.authorizeOrThrow('task-mutate', input.teamId, {
          taskId: input.taskId, expectedRevision: input.expectedRevision,
          cancellation: structuredClone(cancellation) as unknown as JsonObject,
        }, actorId)
        resolveActor()
        const task: TeamTaskSnapshot = {
          ...prior, revision: prior.revision + 1, cancellation,
          phase: prior.phase === 'pending' && prior.delegation === undefined && ![...current.projection.workspaceAllocations.values()].some(allocation => allocation.taskId === prior.id && allocation.lifecycle !== 'released') ? 'cancelled' : prior.phase,
        }
        await this.commitTeamCommand(current, [{ type: 'task/changed', task, createdAt: requestedAt }], 'TEAM_TASK_GRAPH_INVALID')
        return await this.finishLeaseFreeTaskCancellation(current, task)
      })
    })
  }

  /** Recover only work selected by an already durable lease-free cancellation. */
  override async reconcileTaskCancellation(request: TeamTaskCancellationReconcileRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamTaskCancellationReconcileInputSchema.parse(untrustedInput)
      const revalidate = (): void => {
        const resolution = this.requireSystemTaskLeaseProof(actor)
        if (resolution.sourceName !== TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE
          || !isDeepStrictEqual(resolution.scope, { kind: 'scheduler-task-cancellation-reconcile', ...input })) this.rejectTaskLeaseActor()
      }
      revalidate()
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        revalidate()
        const task = this.requireTask(current, input.taskId)
        this.assertTaskRevision(task, input.expectedRevision)
        if (task.cancellation?.requestedRevision !== input.requestedRevision || task.lease !== undefined) {
          throw new TeamError('task cancellation recovery has no matching lease-free intent', 'TEAM_INVALID_ARGUMENT')
        }
        return await this.finishLeaseFreeTaskCancellation(current, task)
      })
    })
  }

  /** Close only consult requests for the cancelled completed attempt before settling review. */
  private async finishLeaseFreeTaskCancellation(team: LoadedTeam, task: TeamTaskSnapshot): Promise<TeamTaskSnapshot> {
    const cancellation = task.cancellation
    if (task.delegation?.childTeamId !== undefined) return this.taskSnapshot(task)
    if (cancellation === undefined || task.lease !== undefined || (task.phase !== 'review' && task.phase !== 'pending')) return this.taskSnapshot(task)
    const target = cancellation.target
    for (const channelId of target.kind === 'review' ? team.projection.channelIds : []) {
      if (target.kind !== 'review') continue
      const loaded = await this.ensureChannel(channelId)
      await loaded.queue.run(async () => {
        const channel = this.requireLiveChannel(loaded)
        if ((channel.projection.phase !== 'active' && channel.projection.phase !== 'pending')
          || channel.projection.manifest.adapter.type !== CONSULT_CHANNEL_ADAPTER.type
          || channel.projection.manifest.adapter.version !== CONSULT_CHANNEL_ADAPTER.version) return
        const records = await this.readChannelRecords(channel, EMPTY_CURSOR)
        const ownsReview = records.some(record => record.type === 'channel/envelope'
          && record.envelope.kind === CONSULT_REVIEW_REQUEST_KIND
          && record.envelope.taskId === task.id
          && record.envelope.payload.attemptId === target.attemptId
          && record.envelope.payload.reviewerId === target.reviewerId)
        if (!ownsReview) return
        await this.closeChannelOwned(channel, {
          channelId, expectedCursor: channel.projection.cursor, reason: 'task cancelled',
        }, { channelId, taskId: task.id, attemptId: target.attemptId, cancellationRequestedAt: cancellation.requestedAt },
        cancellation.requestedBy)
      })
    }
    const createdAt = nextTeamTimestamp(team.projection)
    if ([...team.projection.workspaceAllocations.values()].some(allocation => allocation.taskId === task.id && allocation.lifecycle !== 'released')) return this.taskSnapshot(task)
    const cancelled: TeamTaskSnapshot = { ...task, revision: task.revision + 1, phase: 'cancelled',
      ...task.delegation === undefined ? {} : { delegation: { ...task.delegation, phase: 'cancelled', updatedAt: createdAt } } }
    await this.commitTeamCommand(team, [{ type: 'task/changed', task: cancelled, createdAt }], 'TEAM_TASK_GRAPH_INVALID')
    return this.taskSnapshot(cancelled)
  }

  /** Cancel one exact pending task through the durable TeamRun cancellation-cleanup authority. */
  override async cancelTeamCancellationTask(request: TeamCancellationTaskCancelRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamCancellationTaskCancelInputSchema.parse(untrustedInput)
      this.cancellationTaskCleanupScope(actor, input)
      const loaded = await this.ensureTeam(input.teamId)
      await loaded.queue.run(() => {
        const current = this.requireLiveTeam(loaded)
        this.resolveCancellationTaskCleanupAuthority(current, actor, input)
        return Promise.resolve()
      })
      await this.repairPendingParentCharges(loaded)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const prior = this.resolveCancellationTaskCleanupAuthority(current, actor, input)
        this.assertNoPendingParentCharges(current.projection)
        this.assertWorkflowTaskDetailsMutable(current.projection, prior, 'cancel')
        this.assertTaskRevision(prior, input.expectedRevision)
        this.requireLeaseFreeTask(prior)
        if (prior.phase !== 'pending') {
          throw new TeamError(`Team task '${prior.id}' cannot be cancelled from '${prior.phase}'`, 'TEAM_INVALID_ARGUMENT')
        }
        await this.authorizeOrThrow('task-mutate', input.teamId, {
          operation: 'cancellation-task-cleanup',
          taskId: input.taskId,
          expectedTeamCursor: input.expectedTeamCursor,
          expectedRevision: input.expectedRevision,
          cancellationIdempotencyKey: input.cancellationIdempotencyKey,
          cancellationRequestedAt: input.cancellationRequestedAt,
          sourceName: TEAM_RUN_CANCELLATION_CLEANUP_PROOF_SOURCE,
          phase: 'cancelled',
        })
        this.resolveCancellationTaskCleanupAuthority(current, actor, input)
        const createdAt = nextTeamTimestamp(current.projection)
        const task: TeamTaskSnapshot = { ...prior, revision: prior.revision + 1, phase: 'cancelled',
          ...prior.delegation === undefined ? {} : { delegation: { ...prior.delegation, phase: 'cancelled', updatedAt: createdAt } } }
        await this.commitTeamCommand(current, [{ type: 'task/changed', task, createdAt }], 'TEAM_TASK_GRAPH_INVALID')
        return this.taskSnapshot(task)
      })
    })
  }

  /**
   * Replace one lease-free task with its durable deleted tombstone.
   * @param request - Team/task identity and the revision fence selected before deletion.
   * @returns the detached deleted task projection.
   */
  override async deleteTask(request: TeamTaskDeleteRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamTaskDeleteInputSchema.parse(untrustedInput)
      const human = this.isHumanTaskDeleteActor(actor, input)
      const coordinatorActor = human ? undefined : this.requireCoordinatorTaskAuthorityForTeam(actor, input.teamId)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const actorId = human
          ? this.resolveHumanTaskDeleteAuthority(current, actor, input)
          : this.coordinatorTaskCreator(
            current,
            this.requireCoordinatorTaskAuthorityForTeam(coordinatorActor, input.teamId),
          ).participantId
        const prior = this.requireTask(current, input.taskId)
        this.assertWorkflowTaskDetailsMutable(current.projection, prior, 'delete')
        this.assertTaskRevision(prior, input.expectedRevision)
        this.requireLeaseFreeTask(prior)
        if (prior.phase === 'review') {
          throw new TeamError(`Team task '${prior.id}' cannot be deleted while awaiting review`, 'TEAM_INVALID_ARGUMENT')
        }
        await this.authorizeOrThrow('task-mutate', input.teamId, {
          taskId: input.taskId,
          expectedRevision: input.expectedRevision,
          phase: 'deleted',
        }, actorId)
        if (human) this.resolveHumanTaskDeleteAuthority(current, actor, input)
        else this.coordinatorTaskCreator(
          current,
          this.requireCoordinatorTaskAuthorityForTeam(coordinatorActor, input.teamId),
        )
        const confirmed = this.requireTask(current, input.taskId)
        this.assertTaskRevision(confirmed, input.expectedRevision)
        this.requireLeaseFreeTask(confirmed)
        if (confirmed.phase === 'review') {
          throw new TeamError(`Team task '${confirmed.id}' cannot be deleted while awaiting review`, 'TEAM_INVALID_ARGUMENT')
        }
        const task: TeamTaskSnapshot = {
          ...confirmed,
          revision: confirmed.revision + 1,
          phase: 'deleted',
        }
        const createdAt = nextTeamTimestamp(current.projection)
        await this.commitTeamCommand(current, [{ type: 'task/changed', task, createdAt }], 'TEAM_TASK_GRAPH_INVALID')
        return this.taskSnapshot(task)
      })
    })
  }

  /**
   * Resolve one lease-free review task through the current reviewer's exact
   * activation proof.
   * @param request - runtime reviewer proof and JSON-only review decision fields.
   * @returns the detached task projection after the durable review decision.
   */
  override async resolveTaskReview(request: TeamTaskReviewResolveRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamTaskReviewResolveInputSchema.parse(untrustedInput)
      const human = this.tryResolveHumanActorProof(actor)
      if (human !== undefined) {
        this.assertHumanTaskProofScope(human, this.humanTaskReviewProofInput(human.teamId, input))
        const loaded = await this.ensureTeam(human.teamId)
        return await loaded.queue.run(async () => {
          const current = this.requireLiveTeam(loaded)
          const reviewerId = this.resolveHumanTaskReviewAuthority(current, actor as TeamHumanActorProof, input)
          return await this.resolveTaskReviewForReviewer(
            current,
            input,
            reviewerId,
            () => { this.resolveHumanTaskReviewAuthority(current, actor as TeamHumanActorProof, input) },
          )
        })
      }
      const issued = this.requireActivationActorProof(actor as TeamActorProof)
      const loaded = await this.ensureTeam(issued.activation.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const binding = this.requireCurrentActivationActorBinding(current, actor as TeamActorProof)
        return await this.resolveTaskReviewForReviewer(
          current,
          input,
          binding.activation.participantId,
          () => {
            const confirmed = this.requireCurrentActivationActorBinding(current, actor as TeamActorProof)
            if (confirmed.activation.participantId !== binding.activation.participantId) this.rejectTaskReviewActor()
          },
        )
      })
    })
  }

  /**
   * Recover one review decision from the exact durable consult response held
   * by a registered scheduler source.
   * @param request - runtime-only scheduler recovery proof.
   * @returns the detached task projection after the durable review decision.
   */
  override async resolveTaskReviewFromResponse(request: TeamTaskReviewRecoverRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const initial = this.requireSystemTaskReviewProof(request.actor)
      const channel = await this.ensureAttachedChannel(initial.scope.channelId)
      const loaded = await this.ensureTeam(initial.scope.teamId)
      return await loaded.queue.run(async () => await channel.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const currentChannel = this.requireLiveChannel(channel)
        const resolution = this.requireSystemTaskReviewProof(request.actor)
        return await this.resolveTaskReviewFromSystemResponse(current, currentChannel, request.actor, resolution)
      }))
    })
  }

  /** Resolve one review decision after deriving and validating its exact reviewer. */
  private async resolveTaskReviewForReviewer(
    current: LoadedTeam,
    input: TeamTaskReviewResolveInput,
    reviewerId: ParticipantId,
    revalidate?: () => void | Promise<void>,
  ): Promise<TeamTaskSnapshot> {
    const prior = this.requireTask(current, input.taskId)
    assertTaskNotCancelling(prior)
    this.assertTaskRevision(prior, input.expectedRevision)
    this.requireLeaseFreeTask(prior)
    if (prior.phase !== 'review') {
      throw new TeamError(`Team task '${prior.id}' is not awaiting review`, 'TEAM_INVALID_ARGUMENT')
    }
    this.requireActiveParticipant(current, reviewerId)
    if (prior.reviewPolicy.kind !== 'participant' || prior.reviewPolicy.reviewerId !== reviewerId) {
      throw new TeamError(`Team task '${prior.id}' is not assigned to reviewer '${reviewerId}'`, 'TEAM_INVALID_ARGUMENT')
    }
    const attempt = prior.attemptHistory.at(-1)
    if (attempt?.outcome.kind !== 'completed') {
      throw new TeamError(`Team task '${prior.id}' review has no completed attempt`, 'TEAM_INVALID_ARGUMENT')
    }
    const createdAt = nextTeamTimestamp(current.projection)
    const decision: TeamTaskReviewDecision = {
      attemptId: attempt.id,
      reviewerId,
      nextPhase: input.nextPhase,
      reason: normalizedText(input.reason, 'review reason'),
      decidedAt: createdAt,
    }
    await this.authorizeOrThrow('task-mutate', current.id, {
      taskId: input.taskId,
      expectedRevision: input.expectedRevision,
      attemptId: decision.attemptId,
      reviewerId: decision.reviewerId,
      nextPhase: input.nextPhase,
      reason: decision.reason,
    }, reviewerId)
    if (revalidate !== undefined) await revalidate()
    const confirmed = this.requireTask(current, input.taskId)
    assertTaskNotCancelling(confirmed)
    this.assertTaskRevision(confirmed, input.expectedRevision)
    this.requireLeaseFreeTask(confirmed)
    if (confirmed.phase !== 'review') {
      throw new TeamError(`Team task '${confirmed.id}' is not awaiting review`, 'TEAM_INVALID_ARGUMENT')
    }
    this.requireActiveParticipant(current, reviewerId)
    if (confirmed.reviewPolicy.kind !== 'participant' || confirmed.reviewPolicy.reviewerId !== reviewerId) {
      throw new TeamError(`Team task '${confirmed.id}' is not assigned to reviewer '${reviewerId}'`, 'TEAM_INVALID_ARGUMENT')
    }
    const confirmedAttempt = confirmed.attemptHistory.at(-1)
    if (confirmedAttempt?.outcome.kind !== 'completed' || confirmedAttempt.id !== decision.attemptId) {
      throw new TeamError(`Team task '${confirmed.id}' review has no completed attempt`, 'TEAM_INVALID_ARGUMENT')
    }
    const task: TeamTaskSnapshot = {
      ...confirmed,
      revision: confirmed.revision + 1,
      phase: input.nextPhase,
      reviewHistory: [...confirmed.reviewHistory, decision],
    }
    await this.commitTeamCommand(current, [{ type: 'task/changed', task, createdAt }], 'TEAM_TASK_GRAPH_INVALID')
    return this.taskSnapshot(task)
  }

  /** Validate a scheduler recovery proof against its durable consult request and response. */
  private async resolveTaskReviewFromSystemResponse(
    team: LoadedTeam,
    channel: LoadedChannel,
    actor: TeamSystemTaskReviewProof,
    resolution: TeamSystemTaskReviewProofResolution,
  ): Promise<TeamTaskSnapshot> {
    const scope = await this.assertTaskReviewSystemResponseAuthority(team, channel, resolution)
    return await this.resolveTaskReviewForReviewer(team, {
      taskId: scope.taskId,
      expectedRevision: scope.expectedRevision,
      nextPhase: scope.nextPhase,
      reason: scope.reason,
    }, scope.reviewerId, async () => {
      const confirmed = this.requireSystemTaskReviewProof(actor)
      if (confirmed.sourceName !== resolution.sourceName || !isDeepStrictEqual(confirmed.scope, scope)) {
        this.rejectTaskReviewActor()
      }
      await this.assertTaskReviewSystemResponseAuthority(team, channel, confirmed)
    })
  }

  /** Verify a scheduler review-recovery scope against the locked task and consult channel facts. */
  private async assertTaskReviewSystemResponseAuthority(
    team: LoadedTeam,
    channel: LoadedChannel,
    resolution: TeamSystemTaskReviewProofResolution,
  ): Promise<TeamSystemTaskReviewProofResolution['scope']> {
    const scope = resolution.scope
    if (resolution.sourceName !== TEAM_SCHEDULER_TASK_REVIEW_PROOF_SOURCE
      || scope.teamId !== team.id
      || scope.channelId !== channel.id) {
      return this.rejectTaskReviewActor()
    }
    this.assertAttachedChannel(team, channel)
    const manifest = channel.projection.manifest
    if (manifest.adapter.type !== CONSULT_CHANNEL_ADAPTER.type
      || manifest.adapter.version !== CONSULT_CHANNEL_ADAPTER.version
      || manifest.participants.length !== 2
      || !manifest.participants.some(member => member.id === scope.initiatorId && member.role === CONSULT_INITIATOR_ROLE)
      || !manifest.participants.some(member => member.id === scope.reviewerId && member.role === CONSULT_RESPONDENT_ROLE)) {
      return this.rejectTaskReviewActor()
    }
    const task = team.projection.tasks.get(scope.taskId)
    const attempt = task?.attemptHistory.at(-1)
    if (task === undefined
      || task.phase !== 'review'
      || task.revision !== scope.expectedRevision
      || task.reviewPolicy.kind !== 'participant'
      || task.reviewPolicy.reviewerId !== scope.reviewerId
      || attempt === undefined
      || attempt.id !== scope.attemptId
      || attempt.participantId !== scope.initiatorId
      || attempt.outcome.kind !== 'completed'
      || team.projection.participants.get(scope.reviewerId)?.phase !== 'active') {
      return this.rejectTaskReviewActor()
    }
    const request = await this.findCommittedEnvelope(channel, scope.requestEnvelopeId)
    const response = await this.findCommittedEnvelope(channel, scope.responseEnvelopeId)
    if (request === undefined
      || response === undefined
      || request.teamId !== team.id
      || request.channelId !== channel.id
      || request.kind !== CONSULT_REVIEW_REQUEST_KIND
      || request.senderId !== scope.initiatorId
      || request.audience === null
      || request.audience.length !== 1
      || request.audience[0] !== scope.reviewerId
      || request.taskId !== scope.taskId
      || request.delivery !== 'turn'
      || request.payload.taskId !== scope.taskId
      || request.payload.attemptId !== scope.attemptId
      || request.payload.reviewRevision !== scope.expectedRevision
      || request.payload.initiatorId !== scope.initiatorId
      || request.payload.reviewerId !== scope.reviewerId
      || response.teamId !== team.id
      || response.channelId !== channel.id
      || response.kind !== CONSULT_RESPONSE_KIND
      || response.senderId !== scope.reviewerId
      || response.audience === null
      || response.audience.length !== 1
      || response.audience[0] !== scope.initiatorId
      || response.causationId !== request.id
      || response.taskId !== scope.taskId
      || response.delivery !== 'turn'
      || response.payload.text !== scope.reason
      || (response.payload.decision === 'accepted' ? 'completed' : response.payload.decision === 'rework' ? 'pending' : undefined) !== scope.nextPhase) {
      return this.rejectTaskReviewActor()
    }
    return scope
  }

  /** Reject forged, stale, cross-scope, or unsupported task-review authority uniformly. */
  private rejectTaskReviewActor(): never {
    throw new TeamError('Task review actor is invalid for this Team review', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Mint and persist one bounded lease for a ready pending task.
   * @param request - scheduler proof and JSON-only task owner/lease selection.
   * @returns the detached assigned task projection containing the minted lease.
   */
  override async assignTask(request: TeamTaskAssignRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamTaskAssignInputSchema.parse(untrustedInput)
      this.assertInitialTaskAssignLeaseAuthority(actor, input)
      const loaded = await this.ensureTeam(input.teamId)
      await this.repairPendingParentCharges(loaded)
      const wakeChannel = input.wakeChannelId === undefined
        ? undefined
        : await this.ensureAttachedChannel(input.wakeChannelId)
      return await loaded.queue.run(async () => {
        const assign = async (): Promise<TeamTaskSnapshot> => {
          const current = this.requireLiveTeam(loaded)
          this.resolveTaskAssignLeaseAuthority(current, actor, input)
          const prepared = this.prepareTaskAssignment(current, input, wakeChannel)
          const assignedRevision = prepared.task.revision + 1
          await this.authorizeOrThrow('task-assign', input.teamId, {
            taskId: input.taskId,
            expectedRevision: input.expectedRevision,
            assignedRevision,
            participantId: input.participantId,
            ...prepared.activationId === undefined ? {} : { activationId: prepared.activationId },
            ...input.wakeChannelId === undefined ? {} : { wakeChannelId: input.wakeChannelId },
            leaseDurationMs: input.leaseDurationMs,
            attemptOrdinal: prepared.task.attemptCount + 1,
          })
          this.resolveTaskAssignLeaseAuthority(current, actor, input)
          const confirmed = this.prepareTaskAssignment(current, input, wakeChannel)
          const confirmedAssignedRevision = confirmed.task.revision + 1
          const assignedAt = nextTeamTimestamp(current.projection)
          const lease: TaskLeaseSnapshot = {
            attemptId: mintTaskAttemptId(),
            assignedRevision: confirmedAssignedRevision,
            ordinal: confirmed.task.attemptCount + 1,
            participantId: input.participantId,
            ...confirmed.activationId === undefined ? {} : { activationId: confirmed.activationId },
            ...input.wakeChannelId === undefined ? {} : { wakeChannelId: input.wakeChannelId },
            assignedAt,
            durationMs: input.leaseDurationMs,
            renewedAt: assignedAt,
            expiresAt: leaseExpiresAt(assignedAt, input.leaseDurationMs),
          }
          const task: TeamTaskSnapshot = {
            ...confirmed.task,
            revision: confirmedAssignedRevision,
            phase: 'assigned',
            attemptCount: confirmed.task.attemptCount + 1,
            lease,
          }
          await this.commitTeamCommand(current, [{ type: 'task/changed', task, createdAt: assignedAt }], 'TEAM_TASK_GRAPH_INVALID')
          this.incrementMetric('taskAssignments')
          return this.taskSnapshot(task)
        }
        return wakeChannel === undefined ? await assign() : await wakeChannel.queue.run(assign)
      })
    })
  }

  /** Recheck every mutable scheduler assignment fact while the Team and optional wake-channel locks are held. */
  private prepareTaskAssignment(
    team: LoadedTeam,
    input: TeamTaskAssignInput,
    wakeChannel: LoadedChannel | undefined,
  ): { readonly task: TeamTaskSnapshot; readonly activationId: ActivationId | undefined } {
    this.assertNoPendingParentCharges(team.projection)
    this.assertTeamWallTime(team.projection)
    const maxLeaseDurationMs = this.teamLimit(
      team.projection,
      'maxTaskLeaseDurationMs',
      this.config.maxTaskLeaseDurationMs,
    )
    if (input.leaseDurationMs > maxLeaseDurationMs) {
      throw new TeamError(
        `Task lease duration ${input.leaseDurationMs} exceeds maxTaskLeaseDurationMs ${maxLeaseDurationMs}`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    const task = this.requireTask(team, input.taskId)
    this.assertTaskRevision(task, input.expectedRevision)
    this.assertTaskWorkspaceAllocationsReleased(team.projection, task.id)
    if (team.projection.team.phase !== 'active') {
      throw new TeamError(`Team '${team.id}' is not active`, 'TEAM_INVALID_ARGUMENT')
    }
    if (task.phase !== 'pending' || task.lease !== undefined || task.cancellation !== undefined) {
      throw new TeamError(`Team task '${task.id}' is not pending for assignment`, 'TEAM_INVALID_ARGUMENT')
    }
    this.assertTeamRuntimeBudget(team.projection, task)
    // v8 ignore next -- a valid Hub projection maps an exhausted terminal attempt to failed, never pending.
    if (task.attemptCount >= task.maxAttempts) {
      throw new TeamError(`Team task '${task.id}' exhausted its ${task.maxAttempts} attempts`, 'TEAM_INVALID_ARGUMENT')
    }
    this.assertWorkflowTaskAssignmentAllowed(team.projection, task)
    const retryCount = teamRetryCount(team.projection.tasks)
    const maxRetries = this.teamLimit(team.projection, 'maxRetriesPerTeam', this.config.maxRetriesPerTeam)
    if (task.attemptCount > 0 && retryCount >= maxRetries) {
      throw new TeamError(
        `Team '${input.teamId}' reached maxRetriesPerTeam ${maxRetries}`,
        'TEAM_CHANNEL_BACKPRESSURE',
      )
    }
    this.assertTaskReady(team.projection, task)
    const participant = this.requireActiveParticipant(team, input.participantId)
    this.assertRequiredCapabilities(task, participant)
    const activationId = this.resolveAttemptActivation(team, participant, input.activationId)
    const binding = activationId === undefined ? undefined : team.projection.activations.get(activationId)
    if (!matchesTaskPlacement(task.placement, participant, binding?.provider ?? participant.provider, binding?.selection ?? {})) {
      throw new TeamError(`Participant '${participant.id}' does not satisfy task '${task.id}' placement restrictions`, 'TEAM_POLICY_DENIED')
    }
    if (wakeChannel !== undefined) {
      this.assertTaskWakeChannel(team, this.requireLiveChannel(wakeChannel), participant.id)
      this.assertExclusiveWakeChannel(team.projection, task.id, wakeChannel.id)
    }
    return { task, activationId }
  }

  /**
   * Move one exact owner-held attempt from assigned to running.
   * @param request - Revision, attempt, and owner fence.
   * @returns the detached running task projection.
   */
  override async startTaskAttempt(request: TeamTaskAttemptStartRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamTaskAttemptStartInputSchema.parse(untrustedInput)
      const issued = this.requireActivationActorProof(actor)
      const loaded = await this.ensureTeam(issued.activation.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const binding = this.requireCurrentActivationActorBinding(current, actor)
        const owner = this.proofAttemptOwner(current, input, binding)
        const prior = this.requireTask(current, input.taskId)
        assertTaskNotCancelling(prior)
        const lease = this.requireAttemptOwner(current, prior, owner)
        if (prior.phase !== 'assigned') {
          throw new TeamError(`Team task '${prior.id}' is not assigned`, 'TEAM_INVALID_ARGUMENT')
        }
        const startedAt = nextTeamTimestamp(current.projection)
        this.assertLeaseLive(lease, startedAt)
        await this.authorizeOrThrow('task-mutate', current.id, ownerAttemptFacts(owner), binding.activation.participantId)
        const confirmedBinding = this.requireCurrentActivationActorBinding(current, actor)
        const confirmedOwner = this.proofAttemptOwner(current, input, confirmedBinding)
        const confirmed = this.requireTask(current, input.taskId)
        assertTaskNotCancelling(confirmed)
        const confirmedLease = this.requireAttemptOwner(current, confirmed, confirmedOwner)
        if (confirmed.phase !== 'assigned') {
          throw new TeamError(`Team task '${confirmed.id}' is not assigned`, 'TEAM_INVALID_ARGUMENT')
        }
        this.assertLeaseLive(confirmedLease, startedAt)
        const task: TeamTaskSnapshot = {
          ...confirmed,
          revision: confirmed.revision + 1,
          phase: 'running',
          lease: { ...confirmedLease, startedAt },
        }
        await this.commitTeamCommand(current, [{ type: 'task/changed', task, createdAt: startedAt }], 'TEAM_TASK_GRAPH_INVALID')
        return this.taskSnapshot(task)
      })
    })
  }

  /**
   * Start one assignment after its exact task Envelope reaches the bound task agent.
   * Repeating the same current claim returns the running task without another journal append.
   * @param request - Runtime actor proof plus JSON-only assignment revision and delivery source.
   * @returns the detached running task projection for the claimed current attempt.
   */
  override async claimTaskAttemptStart(request: TeamTaskAttemptStartClaimRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamTaskAttemptStartClaimInputSchema.parse(untrustedInput)
      const channel = await this.ensureAttachedChannel(input.channelId)
      const loaded = await this.ensureTeam(channel.projection.manifest.teamId)
      return await loaded.queue.run(async () => await channel.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const currentChannel = this.requireLiveChannel(channel)
        this.assertAttachedChannel(current, currentChannel)
        if (current.projection.team.phase !== 'active') {
          throw new TeamError(`Team '${current.id}' is not active`, 'TEAM_INVALID_ARGUMENT')
        }
        if (currentChannel.projection.phase !== 'active') {
          throw new TeamError(`channel '${currentChannel.id}' is not active`, 'TEAM_INVALID_ARGUMENT')
        }
        const binding = this.requireCurrentActivationActorBinding(current, actor)
        const participantId = binding.activation.participantId
        this.assertActiveChannelParticipant(current, currentChannel, participantId)
        const prior = this.requireTask(current, input.taskId)
        assertTaskNotCancelling(prior)
        const lease = this.requireTaskAttemptStartClaim(prior, input, binding)
        if (lease.wakeChannelId !== input.channelId) {
          throw new TeamError(`Task attempt '${lease.attemptId}' was not assigned through channel '${input.channelId}'`, 'TEAM_INVALID_ARGUMENT')
        }
        const envelope = await this.findCommittedEnvelope(currentChannel, input.envelopeId)
        if (envelope === undefined) {
          throw new TeamError(`Envelope '${input.envelopeId}' was not found in channel '${input.channelId}'`, 'TEAM_INVALID_ARGUMENT')
        }
        this.assertTaskAssignmentEnvelope(currentChannel, envelope, prior, participantId)
        if (prior.phase === 'running') return this.taskSnapshot(prior)
        /* v8 ignore next 3 -- Team task schema and journal fold allow a current lease only for assigned or running tasks. */
        if (prior.phase !== 'assigned') {
          throw new TeamError(`Team task '${prior.id}' is not assigned`, 'TEAM_INVALID_ARGUMENT')
        }
        const startedAt = nextTeamTimestamp(current.projection)
        this.assertLeaseLive(lease, startedAt)
        await this.authorizeOrThrow('task-mutate', current.id, taskAttemptStartClaimFacts(input, binding), participantId)
        const confirmedBinding = this.requireCurrentActivationActorBinding(current, actor)
        const confirmedParticipantId = confirmedBinding.activation.participantId
        this.assertActiveChannelParticipant(current, currentChannel, confirmedParticipantId)
        const confirmed = this.requireTask(current, input.taskId)
        assertTaskNotCancelling(confirmed)
        const confirmedLease = this.requireTaskAttemptStartClaim(confirmed, input, confirmedBinding)
        if (confirmedLease.wakeChannelId !== input.channelId) {
          throw new TeamError(`Task attempt '${confirmedLease.attemptId}' was not assigned through channel '${input.channelId}'`, 'TEAM_INVALID_ARGUMENT')
        }
        this.assertTaskAssignmentEnvelope(currentChannel, envelope, confirmed, confirmedParticipantId)
        if (confirmed.phase !== 'assigned') {
          throw new TeamError(`Team task '${confirmed.id}' is not assigned`, 'TEAM_INVALID_ARGUMENT')
        }
        this.assertLeaseLive(confirmedLease, startedAt)
        const task: TeamTaskSnapshot = {
          ...confirmed,
          revision: confirmed.revision + 1,
          phase: 'running',
          lease: { ...confirmedLease, startedAt },
        }
        await this.commitTeamCommand(current, [{ type: 'task/changed', task, createdAt: startedAt }], 'TEAM_TASK_GRAPH_INVALID')
        return this.taskSnapshot(task)
      }))
    })
  }

  /**
   * Renew one exact proof-owned active lease for its original fixed duration.
   * @param request - Runtime actor proof, revision, and attempt fence.
   * @returns the detached task projection with its renewed lease.
   */
  override async heartbeatTaskAttempt(request: TeamTaskAttemptHeartbeatRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamTaskAttemptHeartbeatInputSchema.parse(untrustedInput)
      // Resolve once only to find the owning serializer. The lock path below
      // resolves it again so revocation or replacement between these awaits
      // cannot authorize a mutation.
      const issued = this.requireActivationActorProof(actor)
      const loaded = await this.ensureTeam(issued.activation.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const binding = this.requireCurrentActivationActorBinding(current, actor)
        const owner = this.proofAttemptOwner(current, input, binding)
        const prior = this.requireTask(current, input.taskId)
        assertTaskNotCancelling(prior)
        const lease = this.requireAttemptOwner(current, prior, owner)
        const renewedAt = nextTeamTimestamp(current.projection)
        this.assertLeaseLive(lease, renewedAt)
        await this.authorizeOrThrow(
          'task-mutate',
          current.id,
          proofAttemptFacts(input, binding),
          binding.activation.participantId,
        )
        const confirmedBinding = this.requireCurrentActivationActorBinding(current, actor)
        const confirmedOwner = this.proofAttemptOwner(current, input, confirmedBinding)
        const confirmed = this.requireTask(current, input.taskId)
        assertTaskNotCancelling(confirmed)
        const confirmedLease = this.requireAttemptOwner(current, confirmed, confirmedOwner)
        this.assertLeaseLive(confirmedLease, renewedAt)
        const task: TeamTaskSnapshot = {
          ...confirmed,
          revision: confirmed.revision + 1,
          lease: {
            ...confirmedLease,
            renewedAt,
            expiresAt: leaseExpiresAt(renewedAt, confirmedLease.durationMs),
          },
        }
        await this.commitTeamCommand(current, [{ type: 'task/changed', task, createdAt: renewedAt }], 'TEAM_TASK_GRAPH_INVALID')
        return this.taskSnapshot(task)
      })
    })
  }

  /**
   * Settle one current proof-owned attempt and retain its terminal fact.
   * The Hub derives the next task phase from the terminal outcome and attempt budget.
   * @param request - Runtime actor proof, revision/attempt fence, and terminal outcome.
   * @returns the detached task projection without an active lease.
   */
  override async settleTaskAttempt(request: TeamTaskAttemptSettleRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamTaskAttemptSettleInputSchema.parse(untrustedInput)
      // The proof selects the Team before a task lookup. Revalidate it while
      // holding that Team lock before it can select a lease owner or policy actor.
      const issued = this.requireActivationActorProof(actor)
      const loaded = await this.ensureTeam(issued.activation.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const binding = this.requireCurrentActivationActorBinding(current, actor)
        const owner = this.proofAttemptOwner(current, input, binding)
        const prior = this.requireTask(current, input.taskId)
        const recorded = prior.attemptHistory.find(attempt => attempt.id === input.attemptId)
        if (recorded !== undefined) {
          if (recorded.participantId !== binding.activation.participantId || recorded.activationId !== binding.activation.id) {
            throw new TeamError(`Team task '${prior.id}' attempt '${recorded.id}' belongs to another activation binding`, 'TEAM_INVALID_ARGUMENT')
          }
          if (!isDeepStrictEqual(recorded.outcome, input.outcome)) {
            throw new TeamError(`Team task '${prior.id}' attempt '${recorded.id}' already retained another terminal outcome`, 'TEAM_INVALID_ARGUMENT')
          }
          return this.taskSnapshot(prior)
        }
        const lease = this.requireAttemptOwner(current, prior, owner)
        const settledAt = nextTeamTimestamp(current.projection)
        if (prior.cancellation === undefined) this.assertLeaseLive(lease, settledAt)
        else {
          if (input.outcome.kind !== 'cancelled') assertTaskNotCancelling(prior)
          this.assertTaskWorkspaceAllocationsReleased(current.projection, prior.id)
        }
        if (input.outcome.kind === 'completed') {
          if ([...current.projection.workspaceAllocations.values()].some(allocation =>
            allocation.taskId === prior.id && allocation.attemptId === input.attemptId && allocation.loss !== undefined)) {
            throw new TeamError('A task cannot complete after its execution workspace was lost', 'TEAM_INVALID_ARGUMENT')
          }
          if (prior.phase !== 'running') {
            throw new TeamError(`Team task '${prior.id}' must be running before it completes`, 'TEAM_INVALID_ARGUMENT')
          }
          if (prior.reviewPolicy.kind === 'participant') {
            this.requireActiveParticipant(current, prior.reviewPolicy.reviewerId)
          }
        }
        this.assertTaskIntegrationResult(prior, input.attemptId, input.outcome)
        const nextPhase = this.phaseAfterAttemptOutcome(prior, input.outcome)
        await this.authorizeOrThrow('task-mutate', current.id, {
          ...proofAttemptFacts(input, binding),
          outcome: attemptOutcomeFacts(input.outcome),
          nextPhase,
        }, binding.activation.participantId)
        const confirmedBinding = this.requireCurrentActivationActorBinding(current, actor)
        const confirmedOwner = this.proofAttemptOwner(current, input, confirmedBinding)
        const confirmed = this.requireTask(current, input.taskId)
        const confirmedLease = this.requireAttemptOwner(current, confirmed, confirmedOwner)
        if (confirmed.cancellation === undefined) this.assertLeaseLive(confirmedLease, settledAt)
        else this.assertTaskWorkspaceAllocationsReleased(current.projection, confirmed.id)
        this.assertTaskIntegrationResult(confirmed, input.attemptId, input.outcome)
        const confirmedNextPhase = this.phaseAfterAttemptOutcome(confirmed, input.outcome)
        const cancellation = confirmed.cancellation
        if (cancellation !== undefined && confirmedLease.wakeChannelId !== undefined) {
          const wake = await this.ensureChannel(confirmedLease.wakeChannelId)
          await wake.queue.run(async () => {
            const channel = this.requireLiveChannel(wake)
            this.assertAttachedChannel(current, channel)
            if (channel.projection.phase !== 'active' && channel.projection.phase !== 'pending') return
            await this.closeChannelOwned(channel, { channelId: wake.id, expectedCursor: channel.projection.cursor, reason: 'task cancelled' },
              { taskId: confirmed.id, attemptId: confirmedLease.attemptId, cancellationRequestedAt: cancellation.requestedAt },
              cancellation.requestedBy, () => { this.requireCurrentActivationActorBinding(current, actor) })
          })
        }
        const settled = this.settledAttempt(confirmed, confirmedLease, settledAt, input.outcome)
        const task = this.withSettledAttempt(confirmed, settled, confirmedNextPhase)
        await this.commitTeamCommand(current, [{ type: 'task/changed', task, createdAt: settledAt }], 'TEAM_TASK_GRAPH_INVALID')
        this.lastTaskLatencyMs = Math.max(0, settledAt - confirmedLease.assignedAt)
        this.recordLatency('taskLatency', this.lastTaskLatencyMs)
        if (confirmedNextPhase === 'pending') this.incrementMetric('taskRetries')
        return this.taskSnapshot(task)
      })
    })
  }

  /**
   * Record one elapsed lease as terminal before the scheduler retries or fails its task.
   * The Hub derives retry or terminal failure from the retained attempt budget.
   * @param request - scheduler proof and JSON-only revision/attempt fence.
   * @returns the detached task projection without an active lease.
   */
  override async expireTaskAttempt(request: TeamTaskAttemptExpireRequest): Promise<TeamTaskSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamTaskAttemptExpireInputSchema.parse(untrustedInput)
      this.assertInitialTaskExpireLeaseAuthority(actor, input)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        this.resolveTaskExpireLeaseAuthority(current, actor, input)
        const prior = this.requireTask(current, input.taskId)
        const lease = this.requireAttempt(prior, input)
        const settledAt = nextTeamTimestamp(current.projection)
        if (settledAt < lease.expiresAt) {
          throw new TeamError(`Team task '${prior.id}' lease has not expired`, 'TEAM_INVALID_ARGUMENT')
        }
        if (prior.cancellation !== undefined) {
          if (prior.cancellation.expiredAt !== undefined) return this.taskSnapshot(prior)
          await this.authorizeOrThrow('task-assign', input.teamId, { ...attemptFacts(input), cancellationExpired: true })
          this.resolveTaskExpireLeaseAuthority(current, actor, input)
          const task: TeamTaskSnapshot = {
            ...prior, revision: prior.revision + 1,
            cancellation: { ...prior.cancellation, expiredAt: settledAt },
          }
          await this.commitTeamCommand(current, [{ type: 'task/changed', task, createdAt: settledAt }], 'TEAM_TASK_GRAPH_INVALID')
          return this.taskSnapshot(task)
        }
        const nextPhase = this.phaseAfterAttemptOutcome(prior, { kind: 'lease-expired' })
        await this.authorizeOrThrow('task-assign', input.teamId, {
          ...attemptFacts(input),
          nextPhase,
          expiresAt: lease.expiresAt,
        })
        this.resolveTaskExpireLeaseAuthority(current, actor, input)
        const confirmed = this.requireTask(current, input.taskId)
        const confirmedLease = this.requireAttempt(confirmed, input)
        const confirmedSettledAt = nextTeamTimestamp(current.projection)
        if (confirmedSettledAt < confirmedLease.expiresAt) {
          throw new TeamError(`Team task '${confirmed.id}' lease has not expired`, 'TEAM_INVALID_ARGUMENT')
        }
        const confirmedNextPhase = this.phaseAfterAttemptOutcome(confirmed, { kind: 'lease-expired' })
        const settled = this.settledAttempt(confirmed, confirmedLease, confirmedSettledAt, { kind: 'lease-expired' })
        const task = this.withSettledAttempt(confirmed, settled, confirmedNextPhase)
        await this.commitTeamCommand(current, [{ type: 'task/changed', task, createdAt: confirmedSettledAt }], 'TEAM_TASK_GRAPH_INVALID')
        this.lastTaskLatencyMs = Math.max(0, confirmedSettledAt - confirmedLease.assignedAt)
        this.recordLatency('taskLatency', this.lastTaskLatencyMs)
        if (confirmedNextPhase === 'pending') this.incrementMetric('taskRetries')
        return this.taskSnapshot(task)
      })
    })
  }

  /** Retain one provider scan under the allocation and previous-observation CAS. */
  override async recordWorkspaceObservation(request: TeamWorkspaceObservationRequest): Promise<TeamWorkspaceObservation> {
    return await this.admit(async () => {
      const { actor, ...raw } = request
      const input = teamWorkspaceObservationInputSchema.parse(raw)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const source = this.resolveWorkspaceAllocationAuthority(current, actor, input, 'workspace-observe')
        const allocation = this.requireWorkspaceAllocation(current, input.allocationId)
        if (source.sourceName !== `team-workspace-observation/${allocation.provider}`) {
          throw new TeamError('Workspace observation proof does not belong to this allocation provider', 'TEAM_ACTOR_PROOF_INVALID')
        }
        const prior = allocation.observation
        if (prior?.id === input.id) {
          const { taskId: _task, attemptId: _attempt, truncated: _truncated, observedAt: _at, paths, ...retained } = prior
          const exact = { ...retained, paths: paths.map(({ path, change }) => ({ path, change })) }
          if (!isDeepStrictEqual(exact, input)) throw new TeamError('Workspace observation retry changed its scan facts', 'TEAM_INVALID_ARGUMENT')
          return freeze(structuredClone(prior))
        }
        const observation = projectWorkspaceObservation(allocation, this.requireTask(current, allocation.taskId), input,
          nextTeamTimestamp(current.projection))
        this.resolveWorkspaceAllocationAuthority(current, actor, input, 'workspace-observe')
        await this.commitTeamCommand(current, [{ type: 'workspace/observed', observation, createdAt: observation.observedAt }], 'TEAM_INVALID_ARGUMENT')
        return freeze(structuredClone(observation))
      })
    })
  }

  /** Reserve one exact provider allocation before it materializes a live execution root. */
  override async reserveWorkspaceAllocation(
    request: TeamWorkspaceAllocationReserveRequest,
  ): Promise<TeamWorkspaceAllocationSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamWorkspaceAllocationReserveInputSchema.parse(untrustedInput)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const authority = this.resolveWorkspaceAllocationAuthority(current, actor, input, 'workspace-allocation-reserve')
        const existing = current.projection.workspaceAllocations.get(input.allocation.id)
        if (existing !== undefined) return this.workspaceAllocationSnapshot(this.requireMatchingWorkspaceReservation(existing, input))
        this.assertTeamCursor(current, input.expectedCursor)
        this.assertWorkspaceReservationAttempt(current, input)
        await this.authorizeOrThrow(
          'workspace-allocate',
          current.id,
          workspaceReservationFacts(input, authority.sourceName),
          input.allocation.participantId,
        )
        this.resolveWorkspaceAllocationAuthority(current, actor, input, 'workspace-allocation-reserve')
        const confirmedExisting = current.projection.workspaceAllocations.get(input.allocation.id)
        if (confirmedExisting !== undefined) {
          return this.workspaceAllocationSnapshot(this.requireMatchingWorkspaceReservation(confirmedExisting, input))
        }
        this.assertTeamCursor(current, input.expectedCursor)
        this.assertWorkspaceReservationAttempt(current, input)
        if ([...current.projection.workspaceAllocations.values()].some(allocation =>
          allocation.taskId === input.taskId && allocation.attemptId === input.attemptId)) {
          throw new TeamError(`Team task attempt '${input.attemptId}' already owns a workspace allocation`, 'TEAM_INVALID_ARGUMENT')
        }
        const reservedAt = nextTeamTimestamp(current.projection)
        const allocation: TeamWorkspaceAllocationSnapshot = {
          id: input.allocation.id,
          revision: 1,
          teamId: input.teamId,
          taskId: input.taskId,
          attemptId: input.attemptId,
          assignedRevision: input.allocation.assignedRevision,
          participantId: input.allocation.participantId,
          activationId: input.allocation.activationId,
          sessionId: input.allocation.sessionId,
          provider: input.allocation.provider,
          mode: input.allocation.mode,
          ...input.allocation.baseVersion === undefined ? {} : { baseVersion: input.allocation.baseVersion },
          ...input.allocation.executionWorld === undefined ? {} : { executionWorld: input.allocation.executionWorld },
          lifecycle: 'reserved',
          reservedAt,
          updatedAt: reservedAt,
        }
        await this.commitTeamCommand(current, [{
          type: 'workspace-allocation/changed', allocation, createdAt: reservedAt,
        }], 'TEAM_INVALID_ARGUMENT')
        return this.workspaceAllocationSnapshot(allocation)
      })
    })
  }

  /** Mark one reserved or preserved allocation active after its provider materializes or restores it. */
  override async activateWorkspaceAllocation(
    request: TeamWorkspaceAllocationActivateRequest,
  ): Promise<TeamWorkspaceAllocationSnapshot> {
    return await this.transitionWorkspaceAllocation(request, 'workspace-allocation-activate', (allocation, updatedAt) => ({
      ...allocation,
      revision: allocation.revision + 1,
      lifecycle: 'active',
      activatedAt: updatedAt,
      updatedAt,
    }), allocation => allocation.lifecycle === 'reserved' || allocation.lifecycle === 'preserved', true)
  }

  /** Persist release intent before a provider starts physical allocation cleanup. */
  override async requestWorkspaceAllocationRelease(
    request: TeamWorkspaceAllocationReleaseRequest,
  ): Promise<TeamWorkspaceAllocationSnapshot> {
    return await this.transitionWorkspaceAllocation(request, 'workspace-allocation-release-request', (allocation, updatedAt) => ({
      ...allocation,
      revision: allocation.revision + 1,
      lifecycle: 'release-requested',
      releaseRequestedAt: updatedAt,
      updatedAt,
    }), allocation => allocation.lifecycle === 'reserved'
      || allocation.lifecycle === 'active'
      || allocation.lifecycle === 'preserved'
      || allocation.lifecycle === 'unavailable', false)
  }

  /** Preserve an allocation whose provider cannot prove physical release. */
  override async preserveWorkspaceAllocation(
    request: TeamWorkspaceAllocationPreserveRequest,
  ): Promise<TeamWorkspaceAllocationSnapshot> {
    return await this.transitionWorkspaceAllocation(request, 'workspace-allocation-preserve', (allocation, updatedAt, input) => ({
      ...allocation,
      revision: allocation.revision + 1,
      lifecycle: 'preserved',
      preservedAt: updatedAt,
      preservationReason: structuredClone((input as TeamWorkspaceAllocationPreserveInput).reason),
      updatedAt,
    }), allocation => allocation.lifecycle !== 'released' && allocation.lifecycle !== 'preserved', false)
  }

  /** Retain exact execution-world loss; unconfirmed termination stalls admission while cleanup remains visible. */
  override async recordWorkspaceAllocationLoss(request: TeamWorkspaceAllocationLossRequest): Promise<TeamWorkspaceAllocationSnapshot> {
    return await this.admit(async () => {
      const { actor, ...wire } = request
      const input = teamWorkspaceAllocationLossInputSchema.parse(wire)
      const initial = this.requireSystemWorkspaceAllocationProof(actor)
      if (initial.scope.kind !== 'workspace-allocation-loss' || initial.scope.teamId !== input.teamId) {
        throw new TeamError('Workspace loss requires its current allocation owner', 'TEAM_ACTOR_PROOF_INVALID')
      }
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const source = this.resolveWorkspaceAllocationAuthority(current, actor, input, 'workspace-allocation-loss')
        const allocation = this.requireWorkspaceAllocation(current, input.allocationId)
        if (!source.sourceName.startsWith('team-agent-client-workspace-')
          && !(source.sourceName === 'team-workspace-recovery' && allocation.lifecycle === 'release-requested')) {
          throw new TeamError('Workspace loss requires an exact task delivery owner', 'TEAM_ACTOR_PROOF_INVALID')
        }
        if (allocation.loss !== undefined) {
          const { observedAt: _observedAt, ...loss } = allocation.loss
          if (isDeepStrictEqual(loss, input.loss)) return this.workspaceAllocationSnapshot(allocation)
        }
        this.assertTeamCursor(current, input.expectedCursor)
        if (allocation.lifecycle === 'released' || allocation.revision !== input.expectedRevision
          || !isDeepStrictEqual(allocation.executionWorld, input.loss.executionWorld)
          || input.loss.artifacts.some(artifact => artifact.provider === undefined || artifact.sourceAttemptId !== allocation.attemptId)
          || allocation.loss?.terminationProven === true
          || allocation.loss?.artifacts.some(artifact => !input.loss.artifacts.some(next => isDeepStrictEqual(artifact, next)))) {
          throw new TeamError('Workspace loss does not match its current world, revision, or retained artifacts', 'TEAM_INVALID_ARGUMENT')
        }
        await this.authorizeOrThrow('workspace-allocate', current.id, {
          operation: 'workspace-loss', allocationId: allocation.id, taskId: allocation.taskId,
          attemptId: allocation.attemptId, loss: jsonObjectSchema.parse(input.loss),
        }, allocation.participantId)
        this.resolveWorkspaceAllocationAuthority(current, actor, input, 'workspace-allocation-loss')
        this.assertTeamCursor(current, input.expectedCursor)
        const createdAt = nextTeamTimestamp(current.projection)
        const next: TeamWorkspaceAllocationSnapshot = {
          ...allocation, revision: allocation.revision + 1, lifecycle: 'unavailable', updatedAt: createdAt,
          loss: { ...structuredClone(input.loss), observedAt: createdAt },
        }
        await this.commitTeamCommand(current, [
          { type: 'workspace-allocation/changed', allocation: next, createdAt },
          ...!input.loss.terminationProven && current.projection.team.phase === 'active'
            && current.projection.team.closure === undefined && current.projection.team.cancellation === undefined ? [{
              type: 'team/phase' as const, phase: 'stalled' as const, createdAt,
              reason: { code: 'WORKSPACE_LOSS_UNCONFIRMED', message: `Workspace '${allocation.id}' is unavailable without execution termination proof.` },
            }] : [],
        ], 'TEAM_INVALID_ARGUMENT')
        return this.workspaceAllocationSnapshot(next)
      })
    })
  }

  /** Confirm provider cleanup after a preceding durable release request. */
  override async confirmWorkspaceAllocationRelease(
    request: TeamWorkspaceAllocationReleaseConfirmRequest,
  ): Promise<TeamWorkspaceAllocationSnapshot> {
    return await this.transitionWorkspaceAllocation(request, 'workspace-allocation-release', (allocation, updatedAt) => ({
      ...allocation,
      revision: allocation.revision + 1,
      lifecycle: 'released',
      releasedAt: updatedAt,
      updatedAt,
    }), allocation => allocation.lifecycle === 'release-requested', false)
  }

  /** Apply one proof-owned allocation lifecycle transition after policy revalidation. */
  private async transitionWorkspaceAllocation(
    request: TeamWorkspaceAllocationActivateRequest
      | TeamWorkspaceAllocationReleaseRequest
      | TeamWorkspaceAllocationPreserveRequest
      | TeamWorkspaceAllocationReleaseConfirmRequest,
    kind: Exclude<TeamSystemWorkspaceAllocationScope['kind'], 'workspace-allocation-reserve' | 'workspace-observe' | 'workspace-allocation-loss'>,
    transition: (
      allocation: TeamWorkspaceAllocationSnapshot,
      updatedAt: number,
      input: TeamWorkspaceAllocationActivateInput
        | TeamWorkspaceAllocationReleaseRequestInput
        | TeamWorkspaceAllocationPreserveInput
        | TeamWorkspaceAllocationReleaseInput,
    ) => TeamWorkspaceAllocationSnapshot,
    allowed: (allocation: TeamWorkspaceAllocationSnapshot) => boolean,
    requireRunningAttempt: boolean,
  ): Promise<TeamWorkspaceAllocationSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = this.parseWorkspaceAllocationTransitionInput(kind, untrustedInput)
      const loaded = await this.ensureTeam(input.teamId)
      return await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const authority = this.resolveWorkspaceAllocationAuthority(current, actor, input, kind)
        const allocation = this.requireWorkspaceAllocation(current, input.allocationId)
        if (this.isWorkspaceAllocationTransitionReplay(allocation, input, kind)) return this.workspaceAllocationSnapshot(allocation)
        this.assertTeamCursor(current, input.expectedCursor)
        if (allocation.revision !== input.expectedRevision || !allowed(allocation)) {
          throw new TeamError(`Workspace allocation '${allocation.id}' cannot perform '${kind}'`, 'TEAM_INVALID_ARGUMENT')
        }
        if (requireRunningAttempt) this.assertWorkspaceAllocationCurrentAttempt(current, allocation)
        await this.authorizeOrThrow(
          'workspace-allocate',
          current.id,
          workspaceAllocationTransitionFacts(allocation, kind, authority.sourceName, input),
          allocation.participantId,
        )
        this.resolveWorkspaceAllocationAuthority(current, actor, input, kind)
        const confirmed = this.requireWorkspaceAllocation(current, input.allocationId)
        if (this.isWorkspaceAllocationTransitionReplay(confirmed, input, kind)) return this.workspaceAllocationSnapshot(confirmed)
        this.assertTeamCursor(current, input.expectedCursor)
        if (confirmed.revision !== input.expectedRevision || !allowed(confirmed)) {
          throw new TeamError(`Workspace allocation '${confirmed.id}' cannot perform '${kind}'`, 'TEAM_INVALID_ARGUMENT')
        }
        if (requireRunningAttempt) this.assertWorkspaceAllocationCurrentAttempt(current, confirmed)
        const updatedAt = nextTeamTimestamp(current.projection)
        const next = transition(confirmed, updatedAt, input)
        await this.commitTeamCommand(current, [{
          type: 'workspace-allocation/changed', allocation: next, createdAt: updatedAt,
        }, ...kind === 'workspace-allocation-preserve' && next.loss !== undefined && current.projection.team.phase === 'active'
          && current.projection.team.closure === undefined && current.projection.team.cancellation === undefined ? [{
            type: 'team/phase' as const, phase: 'stalled' as const, createdAt: updatedAt,
            reason: { code: 'WORKSPACE_LOSS_UNCONFIRMED', message: `Workspace '${next.id}' loss settlement requires its execution owner.` },
          }] : []], 'TEAM_INVALID_ARGUMENT')
        return this.workspaceAllocationSnapshot(next)
      })
    })
  }

  /** Parse the JSON-only form selected by one closed allocation lifecycle operation. */
  private parseWorkspaceAllocationTransitionInput(
    kind: Exclude<TeamSystemWorkspaceAllocationScope['kind'], 'workspace-allocation-reserve' | 'workspace-observe' | 'workspace-allocation-loss'>,
    input: object,
  ): TeamWorkspaceAllocationActivateInput
    | TeamWorkspaceAllocationReleaseRequestInput
    | TeamWorkspaceAllocationPreserveInput
    | TeamWorkspaceAllocationReleaseInput {
    switch (kind) {
      case 'workspace-allocation-activate':
        return teamWorkspaceAllocationActivateInputSchema.parse(input)
      case 'workspace-allocation-release-request':
        return teamWorkspaceAllocationReleaseRequestInputSchema.parse(input)
      case 'workspace-allocation-preserve':
        return teamWorkspaceAllocationPreserveInputSchema.parse(input)
      case 'workspace-allocation-release':
        return teamWorkspaceAllocationReleaseInputSchema.parse(input)
      default:
        kind satisfies never
        throw new TeamError(`Unknown workspace allocation lifecycle operation '${String(kind)}'`, 'TEAM_INVALID_ARGUMENT')
    }
  }

  /** Resolve and match one source-owned workspace allocation operation under the Team lock. */
  private resolveWorkspaceAllocationAuthority(
    team: LoadedTeam,
    actor: TeamSystemWorkspaceAllocationProof,
    input: { readonly teamId: TeamId },
    kind: TeamSystemWorkspaceAllocationScope['kind'],
  ): TeamSystemWorkspaceAllocationProofResolution {
    const resolution = this.requireSystemWorkspaceAllocationProof(actor)
    const scope = resolution.scope
    const { kind: scopeKind, ...scopeInput } = scope
    if (scopeKind !== kind || scope.teamId !== team.id || !isDeepStrictEqual(scopeInput, input)) {
      throw new TeamError('Workspace allocation actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
    }
    return resolution
  }

  /** Require a current allocation projection by provider-minted id. */
  private requireWorkspaceAllocation(team: LoadedTeam, allocationId: TeamWorkspaceAllocationId): TeamWorkspaceAllocationSnapshot {
    const allocation = team.projection.workspaceAllocations.get(allocationId)
    if (allocation === undefined) {
      throw new TeamError(`Workspace allocation '${allocationId}' was not found`, 'TEAM_INVALID_ARGUMENT')
    }
    return allocation
  }

  /** Verify that initial reservation is still selected by one exact current running task lease. */
  private assertWorkspaceReservationAttempt(team: LoadedTeam, input: TeamWorkspaceAllocationReserveInput): void {
    const task = this.requireTask(team, input.taskId)
    this.assertTaskRevision(task, input.expectedTaskRevision)
    const lease = task.lease
    const metadata = input.allocation
    if (team.projection.team.phase !== 'active'
      || task.phase !== 'running'
      || lease === undefined
      || lease.attemptId !== input.attemptId
      || lease.assignedRevision !== metadata.assignedRevision
      || lease.participantId !== metadata.participantId
      || lease.activationId !== metadata.activationId
      || task.workspaceMode !== metadata.mode) {
      throw new TeamError(`Task attempt '${input.attemptId}' is not current for workspace allocation reservation`, 'TEAM_INVALID_ARGUMENT')
    }
    const binding = this.findActivationBinding(team.projection, metadata.activationId)
    if (binding === undefined
      || binding.activation.participantId !== metadata.participantId
      || binding.sessionId !== metadata.sessionId
      || (binding.activation.status !== 'idle' && binding.activation.status !== 'running')) {
      throw new TeamError(`Workspace allocation '${metadata.id}' does not match a current activation binding`, 'TEAM_INVALID_ARGUMENT')
    }
  }

  /** Verify that activation still belongs to a running exact task attempt. */
  private assertWorkspaceAllocationCurrentAttempt(team: LoadedTeam, allocation: TeamWorkspaceAllocationSnapshot): void {
    const task = this.requireTask(team, allocation.taskId)
    this.assertWorkspaceReservationAttempt(team, {
      teamId: allocation.teamId,
      expectedCursor: team.projection.team.cursor,
      taskId: allocation.taskId,
      expectedTaskRevision: task.revision,
      attemptId: allocation.attemptId,
      allocation: {
        id: allocation.id,
        provider: allocation.provider,
        mode: allocation.mode,
        assignedRevision: allocation.assignedRevision,
        participantId: allocation.participantId,
        activationId: allocation.activationId,
        sessionId: allocation.sessionId,
        ...allocation.baseVersion === undefined ? {} : { baseVersion: allocation.baseVersion },
        ...allocation.executionWorld === undefined ? {} : { executionWorld: allocation.executionWorld },
      },
    })
  }

  /** Match a replayed reservation without allowing metadata reuse for another allocation. */
  private requireMatchingWorkspaceReservation(
    allocation: TeamWorkspaceAllocationSnapshot,
    input: TeamWorkspaceAllocationReserveInput,
  ): TeamWorkspaceAllocationSnapshot {
    const metadata = input.allocation
    if (allocation.teamId !== input.teamId
      || allocation.taskId !== input.taskId
      || allocation.attemptId !== input.attemptId
      || allocation.assignedRevision !== metadata.assignedRevision
      || allocation.participantId !== metadata.participantId
      || allocation.activationId !== metadata.activationId
      || allocation.sessionId !== metadata.sessionId
      || allocation.provider !== metadata.provider
      || allocation.mode !== metadata.mode
      || allocation.baseVersion !== metadata.baseVersion) {
      throw new TeamError(`Workspace allocation '${allocation.id}' conflicts with its reservation replay`, 'TEAM_INVALID_ARGUMENT')
    }
    return allocation
  }

  /** Recognize the exact immediately-prior lifecycle result for one retry. */
  private isWorkspaceAllocationTransitionReplay(
    allocation: TeamWorkspaceAllocationSnapshot,
    input: TeamWorkspaceAllocationActivateInput
      | TeamWorkspaceAllocationReleaseRequestInput
      | TeamWorkspaceAllocationPreserveInput
      | TeamWorkspaceAllocationReleaseInput,
    kind: Exclude<TeamSystemWorkspaceAllocationScope['kind'], 'workspace-allocation-reserve' | 'workspace-observe' | 'workspace-allocation-loss'>,
  ): boolean {
    if (allocation.revision !== input.expectedRevision + 1) return false
    switch (kind) {
      case 'workspace-allocation-activate':
        return allocation.lifecycle === 'active'
      case 'workspace-allocation-release-request':
        return allocation.lifecycle === 'release-requested'
      case 'workspace-allocation-preserve':
        return allocation.lifecycle === 'preserved'
          && isDeepStrictEqual(allocation.preservationReason, (input as TeamWorkspaceAllocationPreserveInput).reason)
      case 'workspace-allocation-release':
        return allocation.lifecycle === 'released'
      default:
        kind satisfies never
        return false
    }
  }

  /** Build an immutable detached allocation response. */
  private workspaceAllocationSnapshot(allocation: TeamWorkspaceAllocationSnapshot): TeamWorkspaceAllocationSnapshot {
    return freeze(structuredClone(allocation))
  }

  /** Resolve one scheduler assignment proof against its exact JSON-only request under the Team/channel lock. */
  private resolveTaskAssignLeaseAuthority(
    team: LoadedTeam,
    actor: TeamSystemTaskLeaseProof,
    input: TeamTaskAssignInput,
  ): void {
    const resolution = this.requireSystemTaskLeaseProof(actor)
    const scope = resolution.scope
    if (resolution.sourceName !== TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE
      || scope.kind !== 'scheduler-task-assign'
      || scope.teamId !== team.id
      || scope.teamId !== input.teamId
      || scope.taskId !== input.taskId
      || scope.expectedRevision !== input.expectedRevision
      || scope.participantId !== input.participantId
      || scope.activationId !== input.activationId
      || scope.wakeChannelId !== input.wakeChannelId
      || scope.leaseDurationMs !== input.leaseDurationMs) {
      this.rejectTaskLeaseActor()
    }
  }

  /** Resolve one scheduler expiry proof against its exact JSON-only request under the Team lock. */
  private resolveTaskExpireLeaseAuthority(
    team: LoadedTeam,
    actor: TeamSystemTaskLeaseProof,
    input: TeamTaskAttemptExpireInput,
  ): void {
    const resolution = this.requireSystemTaskLeaseProof(actor)
    const scope = resolution.scope
    if (resolution.sourceName !== TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE
      || scope.kind !== 'scheduler-task-expire'
      || scope.teamId !== team.id
      || scope.teamId !== input.teamId
      || scope.taskId !== input.taskId
      || scope.expectedRevision !== input.expectedRevision
      || scope.attemptId !== input.attemptId) {
      this.rejectTaskLeaseActor()
    }
  }

  /** Resolve one scheduler assignment proof before parent-charge repair or wake-channel work begins. */
  private assertInitialTaskAssignLeaseAuthority(actor: TeamSystemTaskLeaseProof, input: TeamTaskAssignInput): void {
    const resolution = this.requireSystemTaskLeaseProof(actor)
    const scope = resolution.scope
    if (resolution.sourceName !== TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE
      || scope.kind !== 'scheduler-task-assign'
      || scope.teamId !== input.teamId
      || scope.taskId !== input.taskId
      || scope.expectedRevision !== input.expectedRevision
      || scope.participantId !== input.participantId
      || scope.activationId !== input.activationId
      || scope.wakeChannelId !== input.wakeChannelId
      || scope.leaseDurationMs !== input.leaseDurationMs) {
      this.rejectTaskLeaseActor()
    }
  }

  /** Resolve one scheduler expiry proof before the Hub opens the selected Team journal. */
  private assertInitialTaskExpireLeaseAuthority(actor: TeamSystemTaskLeaseProof, input: TeamTaskAttemptExpireInput): void {
    const resolution = this.requireSystemTaskLeaseProof(actor)
    const scope = resolution.scope
    if (resolution.sourceName !== TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE
      || scope.kind !== 'scheduler-task-expire'
      || scope.teamId !== input.teamId
      || scope.taskId !== input.taskId
      || scope.expectedRevision !== input.expectedRevision
      || scope.attemptId !== input.attemptId) {
      this.rejectTaskLeaseActor()
    }
  }

  /** Reject every forged, revoked, foreign, stale, or wrong-operation scheduler lease proof. */
  private rejectTaskLeaseActor(): never {
    throw new TeamError('Task lease actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Resolve one TeamRun-owned proof to its closed default-worker task-control scope. */
  private requireTeamRunTaskControlScope<K extends TeamSystemTaskControlScope['kind']>(
    actor: TeamSystemTaskControlProof | undefined,
    kind: K,
  ): Extract<TeamSystemTaskControlScope, { readonly kind: K }> {
    if (actor === undefined) return this.rejectTaskControlActor()
    const resolution = this.requireSystemTaskControlProof(actor)
    if (resolution.sourceName !== TEAM_RUN_TASK_CONTROL_PROOF_SOURCE || resolution.scope.kind !== kind) {
      return this.rejectTaskControlActor()
    }
    return resolution.scope as Extract<TeamSystemTaskControlScope, { readonly kind: K }>
  }

  /** Resolve an exact TeamRun default-worker owner-proposal scope without loading a Team. */
  private taskControlOwnerProposalScope(
    actor: TeamSystemTaskControlProof | undefined,
    input: TeamTaskOwnerProposalInput,
  ): Extract<TeamSystemTaskControlScope, { readonly kind: 'team-run-default-worker-owner-proposal' }> {
    const scope = this.requireTeamRunTaskControlScope(actor, 'team-run-default-worker-owner-proposal')
    if (scope.teamId !== input.teamId
      || scope.taskId !== input.taskId
      || scope.expectedRevision !== input.expectedRevision
      || scope.proposedOwnerId !== input.proposedOwnerId) {
      return this.rejectTaskControlActor()
    }
    return scope
  }

  /** Resolve an exact TeamRun default-worker cancellation scope without loading a Team. */
  private taskControlCancelScope(
    actor: TeamSystemTaskControlProof | undefined,
    input: TeamTaskCancelInput,
  ): Extract<TeamSystemTaskControlScope, { readonly kind: 'team-run-default-worker-cancel' | 'team-run-workflow-task-cancel' }> {
    if (actor === undefined) return this.rejectTaskControlActor()
    const resolution = this.requireSystemTaskControlProof(actor)
    const scope = resolution.scope
    if (resolution.sourceName !== 'team-run'
      || (scope.kind !== 'team-run-default-worker-cancel' && scope.kind !== 'team-run-workflow-task-cancel')
      || scope.teamId !== input.teamId || scope.taskId !== input.taskId
      || scope.expectedRevision !== input.expectedRevision || scope.reason !== input.reason) return this.rejectTaskControlActor()
    return scope
  }

  /** Require the current task-control coordinator and its exact durable creator/plan relation. */
  private requireCoordinatorTaskControlOwnership(
    team: LoadedTeam,
    task: TeamTaskSnapshot,
    coordinator: TeamTaskCreator,
    planId?: TeamWorkflowPlanId,
  ): ParticipantId {
    const participant = team.projection.participants.get(coordinator.participantId)
    const binding = this.findActivationBinding(team.projection, coordinator.activationId)
    const creator = task.createCommand.creator
    if (coordinator.teamId !== team.id
      || participant?.phase !== 'active'
      || !isAgentParticipant(participant)
      || participant.role !== 'coordinator'
      || binding === undefined
      || binding.activation.teamId !== coordinator.teamId
      || binding.activation.participantId !== coordinator.participantId
      || binding.sessionId !== coordinator.sessionId
      || binding.provider !== coordinator.provider
      || (binding.activation.status !== 'idle' && binding.activation.status !== 'running')
      || task.workflowPlanId !== planId
      || !sameStableTaskCreator(creator, coordinator)) {
      return this.rejectTaskControlActor()
    }
    return participant.id
  }

  /** Re-resolve a default-worker owner-proposal proof under the Team lock. */
  private resolveTaskControlOwnerProposalAuthority(
    team: LoadedTeam,
    actor: TeamSystemTaskControlProof | undefined,
    input: TeamTaskOwnerProposalInput,
  ): { readonly task: TeamTaskSnapshot; readonly actorId: ParticipantId } {
    const scope = this.taskControlOwnerProposalScope(actor, input)
    const task = this.requireTask(team, scope.taskId)
    if (task.revision !== scope.expectedRevision) return this.rejectTaskControlActor()
    return { task, actorId: this.requireCoordinatorTaskControlOwnership(team, task, scope.coordinator) }
  }

  /** Re-resolve a current-coordinator task cancellation proof under the Team lock. */
  private resolveTaskControlCancelAuthority(
    team: LoadedTeam,
    actor: TeamSystemTaskControlProof | undefined,
    input: TeamTaskCancelInput,
  ): { readonly task: TeamTaskSnapshot; readonly actorId: ParticipantId } {
    const scope = this.taskControlCancelScope(actor, input)
    const task = this.requireTask(team, scope.taskId)
    if (task.revision !== scope.expectedRevision && task.cancellation?.requestedRevision !== scope.expectedRevision) {
      return this.rejectTaskControlActor()
    }
    if (scope.kind === 'team-run-workflow-task-cancel') {
      const plan = this.requireWorkflowPlan(team, scope.planId)
      if (plan.actor === undefined || !sameStableTaskCreator(plan.actor, scope.coordinator)) return this.rejectTaskControlActor()
      if (!plan.taskBindings.some(binding => binding.taskId === task.id && binding.templateId === task.workflowTemplateId)) {
        return this.rejectTaskControlActor()
      }
      return { task, actorId: this.requireCoordinatorTaskControlOwnership(team, task, scope.coordinator, plan.id) }
    }
    return { task, actorId: this.requireCoordinatorTaskControlOwnership(team, task, scope.coordinator) }
  }

  /** Reject every forged, revoked, foreign, stale, or wrong-operation default-worker task-control proof. */
  private rejectTaskControlActor(): never {
    throw new TeamError('Default-worker task-control actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Resolve one TeamRun-owned proof to its closed post-release cancellation cleanup scope. */
  private requireTeamRunCancellationCleanupScope<K extends TeamSystemCancellationCleanupScope['kind']>(
    actor: TeamSystemCancellationCleanupProof | undefined,
    kind: K,
  ): Extract<TeamSystemCancellationCleanupScope, { readonly kind: K }> {
    if (actor === undefined) return this.rejectCancellationCleanupActor()
    const resolution = this.requireSystemCancellationCleanupProof(actor)
    if (resolution.sourceName !== TEAM_RUN_CANCELLATION_CLEANUP_PROOF_SOURCE || resolution.scope.kind !== kind) {
      return this.rejectCancellationCleanupActor()
    }
    return resolution.scope as Extract<TeamSystemCancellationCleanupScope, { readonly kind: K }>
  }

  /** Resolve an exact TeamRun cancellation pending-task scope without loading a Team. */
  private cancellationTaskCleanupScope(
    actor: TeamSystemCancellationCleanupProof | undefined,
    input: TeamCancellationTaskCancelInput,
  ): Extract<TeamSystemCancellationCleanupScope, { readonly kind: 'team-run-cancellation-task-cancel' }> {
    const scope = this.requireTeamRunCancellationCleanupScope(actor, 'team-run-cancellation-task-cancel')
    if (scope.teamId !== input.teamId
      || scope.cancellationIdempotencyKey !== input.cancellationIdempotencyKey
      || scope.cancellationRequestedAt !== input.cancellationRequestedAt
      || scope.expectedTeamCursor !== input.expectedTeamCursor
      || scope.taskId !== input.taskId
      || scope.expectedRevision !== input.expectedRevision) {
      return this.rejectCancellationCleanupActor()
    }
    return scope
  }

  /** Resolve an exact TeamRun cancellation channel-close scope without loading a Team or channel. */
  private cancellationChannelCleanupScope(
    actor: TeamSystemCancellationCleanupProof | undefined,
    input: TeamCancellationChannelCloseInput,
  ): Extract<TeamSystemCancellationCleanupScope, { readonly kind: 'team-run-cancellation-channel-close' }> {
    const scope = this.requireTeamRunCancellationCleanupScope(actor, 'team-run-cancellation-channel-close')
    if (scope.teamId !== input.teamId
      || scope.cancellationIdempotencyKey !== input.cancellationIdempotencyKey
      || scope.cancellationRequestedAt !== input.cancellationRequestedAt
      || scope.expectedTeamCursor !== input.expectedTeamCursor
      || scope.channelId !== input.channelId
      || scope.expectedCursor !== input.expectedCursor
      || scope.reason !== input.reason) {
      return this.rejectCancellationCleanupActor()
    }
    return scope
  }

  /** Require the exact durable TeamRun cancellation identity while the Team lock is held. */
  private requireTeamRunCancellationCleanup(
    team: LoadedTeam,
    scope: Pick<TeamSystemCancellationCleanupScope, 'teamId' | 'cancellationIdempotencyKey' | 'cancellationRequestedAt' | 'expectedTeamCursor'>,
  ): TeamCancellationSnapshot {
    const cancellation = team.projection.team.cancellation
    if (team.projection.team.cursor !== scope.expectedTeamCursor
      || cancellation === undefined
      || cancellation.teamId !== team.id
      || cancellation.idempotencyKey !== scope.cancellationIdempotencyKey
      || cancellation.requestedAt !== scope.cancellationRequestedAt
      || cancellation.actor.kind !== 'system'
      || cancellation.actor.name !== TEAM_RUN_CANCELLATION_CLEANUP_PROOF_SOURCE
      || (team.projection.team.phase !== 'quiescing' && team.projection.team.phase !== 'stalled')) {
      return this.rejectCancellationCleanupActor()
    }
    return cancellation
  }

  /** Re-resolve a cancellation task proof under the Team lock. */
  private resolveCancellationTaskCleanupAuthority(
    team: LoadedTeam,
    actor: TeamSystemCancellationCleanupProof | undefined,
    input: TeamCancellationTaskCancelInput,
  ): TeamTaskSnapshot {
    const scope = this.cancellationTaskCleanupScope(actor, input)
    this.requireTeamRunCancellationCleanup(team, scope)
    const task = this.requireTask(team, scope.taskId)
    if (task.revision !== scope.expectedRevision || task.phase !== 'pending') return this.rejectCancellationCleanupActor()
    return task
  }

  /** Re-resolve a cancellation channel-close proof under Team and channel locks. */
  private resolveCancellationChannelCleanupAuthority(
    team: LoadedTeam,
    channel: LoadedChannel,
    actor: TeamSystemCancellationCleanupProof | undefined,
    input: TeamCancellationChannelCloseInput,
  ): void {
    const scope = this.cancellationChannelCleanupScope(actor, input)
    this.requireTeamRunCancellationCleanup(team, scope)
    const currentChannel = this.requireLiveChannel(channel)
    if (!team.projection.channelIds.has(scope.channelId)
      || currentChannel.projection.manifest.teamId !== team.id
      || !['pending', 'active'].includes(currentChannel.projection.phase)
      || currentChannel.projection.cursor !== scope.expectedCursor) {
      this.rejectCancellationCleanupActor()
    }
  }

  /** Reject every forged, revoked, foreign, stale, or wrong-operation cancellation cleanup proof. */
  private rejectCancellationCleanupActor(): never {
    throw new TeamError('Cancellation cleanup actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Resolve one TeamRun-owned proof to its closed post-release finalization cleanup scope. */
  private requireTeamRunFinalizationCleanupScope(
    actor: TeamSystemFinalizationCleanupProof | undefined,
  ): TeamSystemFinalizationCleanupScope {
    if (actor === undefined) return this.rejectFinalizationCleanupActor()
    const resolution = this.requireSystemFinalizationCleanupProof(actor)
    if (resolution.sourceName !== TEAM_RUN_FINALIZATION_CLEANUP_PROOF_SOURCE) {
      return this.rejectFinalizationCleanupActor()
    }
    return resolution.scope
  }

  /** Resolve an exact TeamRun finalization channel-close scope without loading a Team or channel. */
  private finalizationChannelCleanupScope(
    actor: TeamSystemFinalizationCleanupProof | undefined,
    input: TeamFinalizationChannelCloseInput,
  ): TeamSystemFinalizationCleanupScope {
    const scope = this.requireTeamRunFinalizationCleanupScope(actor)
    if (scope.teamId !== input.teamId
      || scope.finalChannelId !== input.finalChannelId
      || scope.finalEnvelopeId !== input.finalEnvelopeId
      || scope.expectedTeamCursor !== input.expectedTeamCursor
      || scope.channelId !== input.channelId
      || scope.expectedCursor !== input.expectedCursor
      || scope.reason !== input.reason) {
      return this.rejectFinalizationCleanupActor()
    }
    return scope
  }

  /** Re-resolve a finalization channel-close proof under the Team, final-channel, and target-channel locks. */
  private async resolveFinalizationChannelCleanupAuthority(
    team: LoadedTeam,
    finalChannel: LoadedChannel,
    channel: LoadedChannel,
    actor: TeamSystemFinalizationCleanupProof | undefined,
    input: TeamFinalizationChannelCloseInput,
  ): Promise<void> {
    const scope = this.finalizationChannelCleanupScope(actor, input)
    const currentFinal = this.requireLiveChannel(finalChannel)
    const currentChannel = this.requireLiveChannel(channel)
    const human = team.projection.participants.get(scope.humanId)
    const coordinator = team.projection.participants.get(scope.coordinatorId)
    const finalMembers = currentFinal.projection.manifest.participants
    const closure = team.projection.team.closure
    const acceptedCompletion = closure?.kind === 'complete'
      && closure.finalChannelId === scope.finalChannelId
      && closure.finalEnvelopeId === scope.finalEnvelopeId
      && closure.actor.kind === 'system'
      && closure.actor.name === TEAM_RUN_CLOSURE_PROOF_SOURCE
    if (team.projection.team.cursor !== scope.expectedTeamCursor
      || (team.projection.team.phase !== 'active' && team.projection.team.phase !== 'quiescing')
      || team.projection.team.cancellation !== undefined
      || team.projection.team.closure !== undefined && !acceptedCompletion
      || !team.projection.channelIds.has(scope.finalChannelId)
      || currentFinal.projection.manifest.teamId !== team.id
      || currentFinal.projection.manifest.adapter.type !== DIRECT_CHANNEL_V4_ADAPTER.type
      || currentFinal.projection.manifest.adapter.version !== DIRECT_CHANNEL_V4_ADAPTER.version
      || finalMembers.length !== 2
      || scope.humanId === scope.coordinatorId
      || human?.kind !== 'human'
      || human.role !== 'human'
      || human.phase !== 'active'
      || coordinator?.kind !== 'local-agent'
      || coordinator.role !== 'coordinator'
      || coordinator.phase !== 'active'
      || !finalMembers.some(member => member.id === scope.humanId && member.role === 'human')
      || !finalMembers.some(member => member.id === scope.coordinatorId && member.role === 'coordinator')
      || !team.projection.channelIds.has(scope.channelId)
      || currentChannel.projection.manifest.teamId !== team.id
      || !['pending', 'active'].includes(currentChannel.projection.phase)
      || currentChannel.projection.cursor !== scope.expectedCursor) {
      return this.rejectFinalizationCleanupActor()
    }
    try {
      await this.requireFinalEnvelope(team, currentFinal, scope.finalEnvelopeId)
    } catch (error: unknown) {
      if (error instanceof TeamError && (error.code === 'TEAM_FINAL_INVALID' || error.code === 'TEAM_CHANNEL_NOT_FOUND')) {
        return this.rejectFinalizationCleanupActor()
      }
      throw error
    }
  }

  /** Reject every forged, revoked, foreign, stale, or wrong-operation finalization cleanup proof. */
  private rejectFinalizationCleanupActor(): never {
    throw new TeamError('Finalization cleanup actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Resolve one scheduler-owned proof to one closed review or wake channel lifecycle scope. */
  private requireSchedulerChannelScope<K extends TeamSystemSchedulerChannelScope['kind']>(
    actor: TeamSystemSchedulerChannelProof | undefined,
    kind: K,
  ): Extract<TeamSystemSchedulerChannelScope, { readonly kind: K }> {
    if (actor === undefined) return this.rejectSchedulerChannelActor()
    const resolution = this.requireSystemSchedulerChannelProof(actor)
    if (resolution.sourceName !== TEAM_SCHEDULER_CHANNEL_PROOF_SOURCE || resolution.scope.kind !== kind) {
      return this.rejectSchedulerChannelActor()
    }
    return resolution.scope as Extract<TeamSystemSchedulerChannelScope, { readonly kind: K }>
  }

  /** Resolve an exact scheduler review consult scope before Team loading. */
  private schedulerReviewChannelOpenScope(
    actor: TeamSystemSchedulerChannelProof | undefined,
    input: SchedulerReviewChannelOpenInput,
  ): Extract<TeamSystemSchedulerChannelScope, { readonly kind: 'scheduler-review-channel-open' }> {
    const scope = this.requireSchedulerChannelScope(actor, 'scheduler-review-channel-open')
    if (scope.teamId !== input.teamId
      || scope.expectedTeamCursor !== input.expectedTeamCursor
      || scope.taskId !== input.taskId
      || scope.expectedRevision !== input.expectedRevision
      || scope.attemptId !== input.attemptId
      || scope.initiatorId !== input.initiatorId
      || scope.reviewerId !== input.reviewerId
      || scope.reviewerActivationId !== input.reviewerActivationId
      || scope.reviewerSessionId !== input.reviewerSessionId
      || scope.reviewerProvider !== input.reviewerProvider) {
      return this.rejectSchedulerChannelActor()
    }
    return scope
  }

  /** Re-resolve a scheduler consult opening proof under the Team lock before channel WAL creation. */
  private resolveSchedulerReviewChannelOpenAuthority(
    team: LoadedTeam,
    actor: TeamSystemSchedulerChannelProof | undefined,
    input: SchedulerReviewChannelOpenInput,
  ): Extract<TeamSystemSchedulerChannelScope, { readonly kind: 'scheduler-review-channel-open' }> {
    const scope = this.schedulerReviewChannelOpenScope(actor, input)
    const task = team.projection.tasks.get(scope.taskId)
    const attempt = task?.attemptHistory.at(-1)
    const initiator = team.projection.participants.get(scope.initiatorId)
    const reviewer = team.projection.participants.get(scope.reviewerId)
    const binding = this.findActivationBinding(team.projection, scope.reviewerActivationId)
    if (team.projection.team.cursor !== scope.expectedTeamCursor
      || team.projection.team.phase !== 'active'
      || team.projection.team.cancellation !== undefined
      || team.projection.team.closure !== undefined
      || task === undefined
      || task.phase !== 'review'
      || task.revision !== scope.expectedRevision
      || task.reviewPolicy.kind !== 'participant'
      || task.reviewPolicy.reviewerId !== scope.reviewerId
      || attempt?.id !== scope.attemptId
      || attempt.outcome.kind !== 'completed'
      || attempt.participantId !== scope.initiatorId
      || initiator?.phase !== 'active'
      || reviewer?.phase !== 'active'
      || binding === undefined
      || binding.activation.teamId !== team.id
      || binding.activation.participantId !== scope.reviewerId
      || binding.sessionId !== scope.reviewerSessionId
      || binding.provider !== scope.reviewerProvider
      || binding.activation.status !== 'idle') {
      return this.rejectSchedulerChannelActor()
    }
    return scope
  }

  /** Resolve an exact scheduler task-assignment wake opening scope before Team loading. */
  private schedulerWakeChannelOpenScope(
    actor: TeamSystemSchedulerChannelProof | undefined,
    input: SchedulerWakeChannelOpenInput,
  ): Extract<TeamSystemSchedulerChannelScope, { readonly kind: 'scheduler-wake-channel-open' }> {
    const scope = this.requireSchedulerChannelScope(actor, 'scheduler-wake-channel-open')
    if (scope.teamId !== input.teamId
      || scope.expectedTeamCursor !== input.expectedTeamCursor
      || scope.taskId !== input.taskId
      || scope.expectedRevision !== input.expectedRevision
      || scope.participantId !== input.participantId
      || scope.activationId !== input.activationId
      || scope.sessionId !== input.sessionId) {
      return this.rejectSchedulerChannelActor()
    }
    return scope
  }

  /** Re-resolve a scheduler wake opening proof under the Team lock before channel WAL creation. */
  private resolveSchedulerWakeChannelOpenAuthority(
    team: LoadedTeam,
    actor: TeamSystemSchedulerChannelProof | undefined,
    input: SchedulerWakeChannelOpenInput,
  ): Extract<TeamSystemSchedulerChannelScope, { readonly kind: 'scheduler-wake-channel-open' }> {
    const scope = this.schedulerWakeChannelOpenScope(actor, input)
    const task = team.projection.tasks.get(scope.taskId)
    const participant = team.projection.participants.get(scope.participantId)
    const binding = this.findActivationBinding(team.projection, scope.activationId)
    if (team.projection.team.cursor !== scope.expectedTeamCursor
      || team.projection.team.phase !== 'active'
      || team.projection.team.cancellation !== undefined
      || team.projection.team.closure !== undefined
      || task === undefined
      || task.phase !== 'pending'
      || task.revision !== scope.expectedRevision
      || task.lease !== undefined
      || participant?.phase !== 'active'
      || binding === undefined
      || binding.activation.teamId !== team.id
      || binding.activation.participantId !== scope.participantId
      || binding.sessionId !== scope.sessionId
      || binding.activation.status !== 'idle') {
      return this.rejectSchedulerChannelActor()
    }
    this.assertRequiredCapabilities(task, participant)
    return scope
  }

  /** Resolve an exact scheduler failed-wake cleanup scope before Team or channel loading. */
  private schedulerFailedWakeChannelCloseScope(
    actor: TeamSystemSchedulerChannelProof | undefined,
    input: SchedulerFailedWakeChannelCloseInput,
  ): Extract<TeamSystemSchedulerChannelScope, { readonly kind: 'scheduler-failed-wake-channel-close' }> {
    const scope = this.requireSchedulerChannelScope(actor, 'scheduler-failed-wake-channel-close')
    if (scope.teamId !== input.teamId
      || scope.taskId !== input.taskId
      || scope.participantId !== input.participantId
      || scope.activationId !== input.activationId
      || scope.sessionId !== input.sessionId
      || scope.channelId !== input.channelId
      || scope.expectedChannelCursor !== input.expectedChannelCursor) {
      return this.rejectSchedulerChannelActor()
    }
    return scope
  }

  /** Re-resolve a scheduler failed-wake cleanup proof under Team and channel locks. */
  private resolveSchedulerFailedWakeChannelCloseAuthority(
    team: LoadedTeam,
    channel: LoadedChannel,
    actor: TeamSystemSchedulerChannelProof | undefined,
    input: SchedulerFailedWakeChannelCloseInput,
  ): Extract<TeamSystemSchedulerChannelScope, { readonly kind: 'scheduler-failed-wake-channel-close' }> {
    const scope = this.schedulerFailedWakeChannelCloseScope(actor, input)
    const currentChannel = this.requireLiveChannel(channel)
    const assignee = currentChannel.projection.manifest.participants[0]
    if (team.projection.team.phase !== 'active'
      || !team.projection.channelIds.has(scope.channelId)
      || currentChannel.projection.manifest.teamId !== team.id
      || currentChannel.projection.phase !== 'active'
      || currentChannel.projection.cursor !== scope.expectedChannelCursor
      || currentChannel.projection.manifest.adapter.type !== TASK_ASSIGNMENT_CHANNEL_ADAPTER.type
      || currentChannel.projection.manifest.adapter.version !== TASK_ASSIGNMENT_CHANNEL_ADAPTER.version
      || currentChannel.projection.manifest.participants.length !== 1
      || assignee === undefined
      || assignee.id !== scope.participantId
      || assignee.role !== TASK_ASSIGNMENT_ASSIGNEE_ROLE
      || !isDeepStrictEqual(currentChannel.projection.manifest.limits, {
        taskId: scope.taskId,
        activationId: scope.activationId,
        sessionId: scope.sessionId,
      })
      || [...team.projection.tasks.values()].some(task => task.lease?.wakeChannelId === scope.channelId)) {
      return this.rejectSchedulerChannelActor()
    }
    return scope
  }

  /** Resolve an exact scheduler delivery-expiry scope before Team or channel loading. */
  private schedulerChannelDeliveryExpireScope(
    actor: TeamSystemSchedulerChannelProof | undefined,
    input: SchedulerChannelDeliveryExpireInput,
  ): Extract<TeamSystemSchedulerChannelScope, { readonly kind: 'scheduler-channel-delivery-expire' }> {
    const scope = this.requireSchedulerChannelScope(actor, 'scheduler-channel-delivery-expire')
    if (scope.teamId !== input.teamId
      || scope.channelId !== input.channelId
      || scope.expectedTeamCursor !== input.expectedTeamCursor
      || scope.expectedChannelCursor !== input.expectedChannelCursor
      || scope.now !== input.now
      || scope.limit !== input.limit) {
      return this.rejectSchedulerChannelActor()
    }
    return scope
  }

  /** Re-resolve one exact scheduler delivery-expiry scope under Team and channel locks. */
  private resolveSchedulerChannelDeliveryExpireAuthority(
    team: LoadedTeam,
    channel: LoadedChannel,
    actor: TeamSystemSchedulerChannelProof | undefined,
    input: SchedulerChannelDeliveryExpireInput,
  ): Extract<TeamSystemSchedulerChannelScope, { readonly kind: 'scheduler-channel-delivery-expire' }> {
    const scope = this.schedulerChannelDeliveryExpireScope(actor, input)
    const currentChannel = this.requireLiveChannel(channel)
    if ((team.projection.team.phase !== 'active'
      && (team.projection.team.phase !== 'quiescing' || team.projection.team.cancellation === undefined))
      || !team.projection.channelIds.has(scope.channelId)
      || currentChannel.projection.manifest.teamId !== team.id
    ) {
      return this.rejectSchedulerChannelActor()
    }
    this.assertTeamCursor(team, scope.expectedTeamCursor)
    assertChannelCursor(currentChannel.projection.cursor, scope.expectedChannelCursor)
    return scope
  }

  /** Reject every forged, revoked, stale, cross-Team, or wrong-operation scheduler channel proof. */
  private rejectSchedulerChannelActor(): never {
    throw new TeamError('Scheduler channel actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Recognize and preflight one exact human-controlled participant invitation. */
  private isHumanParticipantInviteActor(
    actor: TeamSystemTopologyProof | TeamHumanActorProof,
    input: ParticipantInviteInput,
  ): boolean {
    const human = this.tryResolveHumanActorProof(actor)
    if (human === undefined) return false
    this.assertHumanParticipantProofScope(human, this.humanParticipantInviteProofInput(input))
    return true
  }

  /** Re-resolve one human-controlled participant invitation under the Team serializer. */
  private resolveHumanParticipantInviteAuthority(
    team: LoadedTeam,
    actor: TeamHumanActorProof,
    input: ParticipantInviteInput,
  ): ParticipantId {
    const expected = this.humanParticipantInviteProofInput(input)
    const scope = this.requireHumanParticipantProofScope(actor, expected)
    return this.requireCurrentHumanParticipantAuthority(team, scope, input.expectedCursor)
  }

  /** Resolve a complete generic channel-open proof before the Team is loaded. */
  private requireHumanChannelOpenProof(actor: TeamHumanActorProof, input: ChannelOpenInput): true {
    this.requireHumanParticipantProofScope(actor, this.humanChannelOpenProofInput(input))
    return true
  }

  /** Re-resolve one authenticated-human channel-open proof under the Team serializer. */
  private resolveHumanChannelOpenAuthority(
    team: LoadedTeam,
    actor: TeamHumanActorProof,
    input: ChannelOpenInput,
  ): ParticipantId {
    const scope = this.requireHumanParticipantProofScope(actor, this.humanChannelOpenProofInput(input))
    return this.requireCurrentHumanParticipantAuthority(team, scope, input.expectedCursor)
  }

  /** Bind every parsed generic channel-open field to its authenticated-human proof. */
  private humanChannelOpenProofInput(input: ChannelOpenInput): TeamHumanActorProofInput & {
    readonly operation: 'channel-open'
  } {
    if (input.workflowPlanId !== undefined || input.expectedPlanRevision !== undefined) this.rejectHumanChannelActor()
    return {
      teamId: input.teamId,
      operation: 'channel-open',
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Re-resolve one authenticated-human channel-close proof under Team and channel serializers. */
  private resolveHumanChannelCloseAuthority(
    team: LoadedTeam,
    channel: LoadedChannel,
    actor: TeamHumanActorProof,
    input: ChannelCloseInput,
  ): ParticipantId {
    const currentChannel = this.requireLiveChannel(channel)
    const scope = this.requireHumanParticipantProofScope(actor, this.humanChannelCloseProofInput(team.id, input))
    const participant = team.projection.participants.get(scope.participantId)
    if (scope.teamId !== team.id
      || team.projection.team.phase !== 'active'
      || team.projection.team.cancellation !== undefined
      || team.projection.team.closure !== undefined
      || participant?.kind !== 'human'
      || participant.phase !== 'active'
      || !team.projection.channelIds.has(currentChannel.id)
      || currentChannel.projection.manifest.teamId !== team.id
      || !['pending', 'active'].includes(currentChannel.projection.phase)) {
      this.rejectHumanChannelActor()
    }
    assertChannelCursor(currentChannel.projection.cursor, input.expectedCursor)
    return participant.id
  }

  /** Bind the server-derived channel Team and every parsed close field to one human proof. */
  private humanChannelCloseProofInput(teamId: TeamId, input: ChannelCloseInput): TeamHumanActorProofInput & {
    readonly operation: 'close'
  } {
    return {
      teamId,
      operation: 'close',
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Build the complete parsed JSON input bound to one human participant invitation. */
  private humanParticipantInviteProofInput(input: ParticipantInviteInput): TeamHumanActorProofInput {
    return {
      teamId: input.teamId,
      operation: 'invite',
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Recognize and preflight one exact human-controlled participant phase mutation. */
  private isHumanParticipantPhaseActor(
    actor: TeamSystemTopologyProof | TeamHumanActorProof,
    input: ParticipantPhaseTransitionInput,
  ): boolean {
    const human = this.tryResolveHumanActorProof(actor)
    if (human === undefined) return false
    this.assertHumanParticipantProofScope(human, this.humanParticipantPhaseProofInput(input))
    return true
  }

  /** Re-resolve one human-controlled participant phase mutation under the Team serializer. */
  private resolveHumanParticipantPhaseAuthority(
    team: LoadedTeam,
    actor: TeamHumanActorProof,
    input: ParticipantPhaseTransitionInput,
  ): { readonly actorId: ParticipantId; readonly operation: 'activate' | 'close' } {
    const expected = this.humanParticipantPhaseProofInput(input)
    const scope = this.requireHumanParticipantProofScope(actor, expected)
    const actorId = this.requireCurrentHumanParticipantAuthority(team, scope, input.expectedCursor)
    const participant = team.projection.participants.get(input.participantId)
    if (participant === undefined) {
      throw new TeamError(`Team participant '${input.participantId}' was not found`, 'TEAM_PARTICIPANT_NOT_FOUND')
    }
    if ((expected.operation === 'activate' && participant.phase !== 'invited' && participant.phase !== 'provisioning')
      || (expected.operation === 'close' && participant.phase !== 'active')) {
      throw new TeamError(`Team participant '${input.participantId}' cannot transition to '${input.phase}'`, 'TEAM_INVALID_ARGUMENT')
    }
    return { actorId, operation: expected.operation }
  }

  /** Build the complete parsed JSON input bound to one human participant phase mutation. */
  private humanParticipantPhaseProofInput(input: ParticipantPhaseTransitionInput): TeamHumanActorProofInput & {
    readonly operation: 'activate' | 'close'
  } {
    const operation = input.phase === 'active'
      ? 'activate' as const
      : input.phase === 'left'
        ? 'close' as const
        : this.rejectHumanParticipantActor()
    return {
      teamId: input.teamId,
      operation,
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Recognize and preflight one exact human-controlled participant interrupt. */
  private isHumanParticipantInterruptActor(
    actor: TeamSystemInterruptProof | TeamHumanActorProof,
    input: ParticipantInterruptRequestInput,
  ): boolean {
    const human = this.tryResolveHumanActorProof(actor)
    if (human === undefined) return false
    this.assertHumanParticipantProofScope(human, this.humanParticipantInterruptProofInput(input))
    return true
  }

  /** Re-resolve one human-controlled participant interrupt under the Team serializer. */
  private resolveHumanParticipantInterruptAuthority(
    team: LoadedTeam,
    actor: TeamHumanActorProof,
    input: ParticipantInterruptRequestInput,
  ): { readonly actorId: ParticipantId; readonly target: ParticipantInterruptTarget } {
    const expected = this.humanParticipantInterruptProofInput(input)
    const scope = this.requireHumanParticipantProofScope(actor, expected)
    const actorId = this.requireCurrentHumanParticipantAuthority(team, scope, input.expectedCursor)
    if (input.participantId === undefined) this.rejectHumanParticipantActor()
    return { actorId, target: this.resolveDeliverableInterruptTarget(team, input.participantId) }
  }

  /** Build the complete parsed JSON input bound to one human participant interrupt. */
  private humanParticipantInterruptProofInput(input: ParticipantInterruptRequestInput): TeamHumanActorProofInput {
    if (input.participantId === undefined) this.rejectHumanParticipantActor()
    return {
      teamId: input.teamId,
      operation: 'interrupt',
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Resolve one exact live human proof and compare its complete payload binding. */
  private requireHumanParticipantProofScope(
    actor: TeamHumanActorProof,
    expected: TeamHumanActorProofInput,
  ): TeamHumanActorScope {
    const scope = this.requireHumanActorProof(actor).scope
    this.assertHumanParticipantProofScope(scope, expected)
    return scope
  }

  /** Reject a human proof whose operation, optimistic fence, or parsed payload changed. */
  private assertHumanParticipantProofScope(scope: TeamHumanActorScope, expected: TeamHumanActorProofInput): void {
    if (scope.teamId !== expected.teamId
      || scope.operation !== expected.operation
      || scope.payloadFingerprint !== fingerprintTeamHumanActorPayload(expected)
      || !isDeepStrictEqual(scope.fence, expected.fence)) {
      this.rejectHumanParticipantActor()
    }
  }

  /** Recheck the derived active human and current Team lifecycle before a durable member write. */
  private requireCurrentHumanParticipantAuthority(
    team: LoadedTeam,
    scope: TeamHumanActorScope,
    expectedCursor: number,
  ): ParticipantId {
    const participant = team.projection.participants.get(scope.participantId)
    if (scope.teamId !== team.id
      || team.projection.team.cursor !== expectedCursor
      || team.projection.team.phase !== 'active'
      || team.projection.team.cancellation !== undefined
      || team.projection.team.closure !== undefined
      || participant?.kind !== 'human'
      || participant.phase !== 'active') {
      this.rejectHumanParticipantActor()
    }
    return participant.id
  }

  /** Reject every forged, revoked, stale, cross-Team, or wrong-operation human member authority. */
  private rejectHumanParticipantActor(): never {
    throw new TeamError('Human participant actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Reject every forged, revoked, stale, cross-Team, or wrong-operation human channel authority. */
  private rejectHumanChannelActor(): never {
    throw new TeamError('Human channel actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Require one exact TeamRun topology proof without accepting a generic structural actor. */
  private requireTeamRunTopologyScope(actor: TeamSystemTopologyProof | undefined): TeamSystemTopologyScope {
    if (actor === undefined) return this.rejectTopologyActor()
    const resolution = this.requireSystemTopologyProof(actor)
    if (resolution.sourceName !== TEAM_RUN_TOPOLOGY_PROOF_SOURCE) return this.rejectTopologyActor()
    return resolution.scope
  }

  /** Resolve an exact bootstrap or reviewer invitation scope before Team loading. */
  private topologyParticipantInviteScope(
    actor: TeamSystemTopologyProof | undefined,
    input: ParticipantInviteInput,
  ): Extract<TeamSystemTopologyScope, {
    readonly kind: 'team-run-bootstrap-participant-invite' | 'team-run-worker-invite' | 'team-run-reviewer-invite'
  }> {
    const scope = this.requireTeamRunTopologyScope(actor)
    if ((scope.kind !== 'team-run-bootstrap-participant-invite'
      && scope.kind !== 'team-run-worker-invite' && scope.kind !== 'team-run-reviewer-invite')
      || scope.teamId !== input.teamId
      || scope.expectedCursor !== input.expectedCursor
      || !isDeepStrictEqual(scope.participant, participantInviteDescriptor(input))) {
      return this.rejectTopologyActor()
    }
    return scope
  }

  /** Re-resolve one participant invitation proof under its Team serializer before policy or journal append. */
  private resolveTopologyParticipantInviteAuthority(
    team: LoadedTeam,
    actor: TeamSystemTopologyProof | undefined,
    input: ParticipantInviteInput,
  ): Extract<TeamSystemTopologyScope, {
    readonly kind: 'team-run-bootstrap-participant-invite' | 'team-run-worker-invite' | 'team-run-reviewer-invite'
  }> {
    const scope = this.topologyParticipantInviteScope(actor, input)
    if (team.projection.team.cursor !== scope.expectedCursor
      || team.projection.team.phase !== 'active'
      || team.projection.team.cancellation !== undefined
      || team.projection.team.closure !== undefined) {
      return this.rejectTopologyActor()
    }
    switch (scope.kind) {
      case 'team-run-bootstrap-participant-invite':
        return scope
      case 'team-run-worker-invite':
        if (scope.participant.kind !== 'local-agent'
          || !isWorkerRole(scope.participant.role)
          || [...team.projection.participants.values()].some(participant => (
            participant.role === scope.participant.role
            && participant.phase !== 'left'
            && participant.phase !== 'failed'
          ))) {
          return this.rejectTopologyActor()
        }
        return scope
      case 'team-run-reviewer-invite':
        if (scope.participant.kind !== 'local-agent'
          || scope.participant.role !== 'reviewer'
          || [...team.projection.participants.values()].some(participant => participant.role === 'reviewer')) {
          return this.rejectTopologyActor()
        }
        return scope
      /* v8 ignore next -- the topology scope is closed and invitation kinds are checked above. */
      default:
        scope satisfies never
        return this.rejectTopologyActor()
    }
  }

  /** Resolve an exact bootstrap, worker, or reviewer phase scope before Team loading. */
  private topologyParticipantPhaseScope(
    actor: TeamSystemTopologyProof | undefined,
    input: ParticipantPhaseTransitionInput,
  ): Extract<TeamSystemTopologyScope, {
    readonly kind: 'team-run-bootstrap-participant-phase' | 'team-run-worker-activate' | 'team-run-worker-retire' | 'team-run-reviewer-phase'
  }> {
    const scope = this.requireTeamRunTopologyScope(actor)
    if ((scope.kind !== 'team-run-bootstrap-participant-phase'
      && scope.kind !== 'team-run-worker-activate'
      && scope.kind !== 'team-run-worker-retire'
      && scope.kind !== 'team-run-reviewer-phase')
      || scope.teamId !== input.teamId
      || scope.participantId !== input.participantId
      || scope.expectedCursor !== input.expectedCursor
      || scope.phase !== input.phase) {
      return this.rejectTopologyActor()
    }
    return scope
  }

  /** Re-resolve one participant phase proof under its Team serializer before policy or journal append. */
  private resolveTopologyParticipantPhaseAuthority(
    team: LoadedTeam,
    actor: TeamSystemTopologyProof | undefined,
    input: ParticipantPhaseTransitionInput,
  ): Extract<TeamSystemTopologyScope, {
    readonly kind: 'team-run-bootstrap-participant-phase' | 'team-run-worker-activate' | 'team-run-worker-retire' | 'team-run-reviewer-phase'
  }> {
    const scope = this.topologyParticipantPhaseScope(actor, input)
    const participant = team.projection.participants.get(scope.participantId)
    if (team.projection.team.cursor !== scope.expectedCursor
      || team.projection.team.phase !== 'active'
      || team.projection.team.cancellation !== undefined
      || team.projection.team.closure !== undefined
      || participant === undefined
      || participant.phase !== scope.expectedPhase) {
      return this.rejectTopologyActor()
    }
    switch (scope.kind) {
      case 'team-run-bootstrap-participant-phase':
        return scope
      case 'team-run-worker-activate':
        if (participant.kind !== 'local-agent'
          || !isWorkerRole(participant.role)) {
          return this.rejectTopologyActor()
        }
        return scope
      case 'team-run-worker-retire':
        if (participant.kind !== 'local-agent'
          || !isWorkerRole(participant.role)
          || participant.role === 'worker'
          || input.phase !== 'left'
          || [...team.projection.tasks.values()].some(task =>
            (task.phase === 'assigned' || task.phase === 'running') && task.lease?.participantId === participant.id)) {
          return this.rejectTopologyActor()
        }
        return scope
      case 'team-run-reviewer-phase':
        if (participant.kind !== 'local-agent'
          || participant.role !== 'reviewer'
          || !isParticipantTopologyPhase(scope.expectedPhase, scope.phase)) {
          return this.rejectTopologyActor()
        }
        return scope
      /* v8 ignore next -- the topology scope is closed and phase kinds are checked above. */
      default:
        scope satisfies never
        return this.rejectTopologyActor()
    }
  }

  /** Reject every forged, revoked, cross-Team, or mismatched topology proof uniformly. */
  private rejectTopologyActor(): never {
    throw new TeamError('Team topology actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Resolve the exact bootstrap direct-channel opening scope before Team loading. */
  private topologyChannelOpenScope(
    actor: TeamSystemTopologyProof | undefined,
    input: ChannelOpenInput,
  ): Extract<TeamSystemTopologyScope, { readonly kind: 'team-run-bootstrap-channel-open' }> {
    const scope = this.requireTeamRunTopologyScope(actor)
    if (scope.kind !== 'team-run-bootstrap-channel-open'
      || input.workflowPlanId !== undefined
      || input.expectedPlanRevision !== undefined
      || scope.teamId !== input.teamId
      || scope.expectedCursor !== input.expectedCursor
      || !isDeepStrictEqual(scope.adapter, input.adapter)
      || !isDeepStrictEqual(scope.viewPolicy, input.viewPolicy)
      || !isDeepStrictEqual(scope.participants, input.participants)
      || !isDeepStrictEqual(scope.limits, input.limits)) {
      return this.rejectTopologyActor()
    }
    return scope
  }

  /** Re-resolve one bootstrap direct-channel proof under the Team serializer before repair, policy, or WAL creation. */
  private resolveTopologyChannelOpenAuthority(
    team: LoadedTeam,
    actor: TeamSystemTopologyProof | undefined,
    input: ChannelOpenInput,
  ): Extract<TeamSystemTopologyScope, { readonly kind: 'team-run-bootstrap-channel-open' }> {
    const scope = this.topologyChannelOpenScope(actor, input)
    const human = team.projection.participants.get(scope.humanId)
    const coordinator = team.projection.participants.get(scope.coordinatorId)
    if (team.projection.team.cursor !== scope.expectedCursor
      || team.projection.team.phase !== 'active'
      || team.projection.team.cancellation !== undefined
      || team.projection.team.closure !== undefined
      || team.projection.channelIds.size !== 0
      || scope.humanId === scope.coordinatorId
      || input.adapter.type !== DIRECT_CHANNEL_V4_ADAPTER.type
      || input.adapter.version !== DIRECT_CHANNEL_V4_ADAPTER.version
      || input.viewPolicy?.type !== 'directed'
      || input.viewPolicy.version !== 1
      || input.participants.length !== 2
      || human?.kind !== 'human'
      || human.role !== 'human'
      || human.phase !== 'active'
      || coordinator?.kind !== 'local-agent'
      || coordinator.role !== 'coordinator'
      || coordinator.phase !== 'active'
      || !isDeepStrictEqual(input.participants, [
        { id: scope.humanId, role: 'human' },
        { id: scope.coordinatorId, role: 'coordinator' },
      ])) {
      return this.rejectTopologyActor()
    }
    return scope
  }

  /** Resolve one TeamRun-owned proof to its closed workflow compiler scope. */
  private requireTeamRunWorkflowScope<K extends TeamSystemWorkflowScope['kind']>(
    actor: TeamSystemWorkflowProof | undefined,
    kind: K,
  ): Extract<TeamSystemWorkflowScope, { readonly kind: K }> {
    if (actor === undefined) return this.rejectWorkflowActor()
    const resolution = this.requireSystemWorkflowProof(actor)
    if (resolution.sourceName !== TEAM_RUN_WORKFLOW_PROOF_SOURCE || resolution.scope.kind !== kind) {
      return this.rejectWorkflowActor()
    }
    return resolution.scope as Extract<TeamSystemWorkflowScope, { readonly kind: K }>
  }

  /** Require a workflow scope's coordinator to remain the plan author and a current active coordinator binding. */
  private requireWorkflowScopeCoordinator(
    team: LoadedTeam,
    plan: TeamWorkflowPlanSnapshot,
    coordinator: TeamTaskCreator,
  ): void {
    const participant = team.projection.participants.get(coordinator.participantId)
    const binding = this.findActivationBinding(team.projection, coordinator.activationId)
    if (coordinator.teamId !== team.id
      || plan.actor === undefined
      || !sameTaskCreator(plan.actor, coordinator)
      || participant?.phase !== 'active'
      || !isAgentParticipant(participant)
      || participant.role !== 'coordinator'
      || binding === undefined
      || binding.activation.teamId !== coordinator.teamId
      || binding.activation.participantId !== coordinator.participantId
      || binding.sessionId !== coordinator.sessionId
      || binding.provider !== coordinator.provider
      || (binding.activation.status !== 'idle' && binding.activation.status !== 'running')) {
      this.rejectWorkflowActor()
    }
  }

  /** Resolve an exact workflow-channel opening scope without loading a Team or channel. */
  private workflowChannelOpenScope(
    actor: TeamSystemWorkflowProof | undefined,
    input: ChannelOpenInput,
  ): Extract<TeamSystemWorkflowScope, { readonly kind: 'team-run-workflow-channel-open' }> {
    if (input.workflowPlanId === undefined || input.expectedPlanRevision === undefined) return this.rejectWorkflowActor()
    const scope = this.requireTeamRunWorkflowScope(actor, 'team-run-workflow-channel-open')
    if (scope.teamId !== input.teamId
      || scope.planId !== input.workflowPlanId
      || scope.expectedCursor !== input.expectedCursor
      || scope.expectedRevision !== input.expectedPlanRevision
      || !isDeepStrictEqual(scope.adapter, input.adapter)
      || !isDeepStrictEqual(scope.viewPolicy, input.viewPolicy)
      || !isDeepStrictEqual(scope.participants, input.participants)
      || !isDeepStrictEqual(scope.limits, input.limits)) {
      return this.rejectWorkflowActor()
    }
    return scope
  }

  /** Re-resolve an opening proof under the Team lock and require the exact compiling plan revision. */
  private resolveWorkflowChannelOpenAuthority(
    team: LoadedTeam,
    actor: TeamSystemWorkflowProof | undefined,
    input: ChannelOpenInput,
  ): TeamWorkflowPlanSnapshot {
    const scope = this.workflowChannelOpenScope(actor, input)
    const plan = this.requireWorkflowPlan(team, scope.planId)
    if (plan.revision !== scope.expectedRevision) return this.rejectWorkflowActor()
    this.requireWorkflowScopeCoordinator(team, plan, scope.coordinator)
    return plan
  }

  /** Resolve an exact workflow-plan/channel binding scope without loading a Team or channel. */
  private workflowChannelBindScope(
    actor: TeamSystemWorkflowProof | undefined,
    input: TeamWorkflowPlanChannelBindInput,
  ): Extract<TeamSystemWorkflowScope, { readonly kind: 'team-run-workflow-channel-bind' }> {
    const scope = this.requireTeamRunWorkflowScope(actor, 'team-run-workflow-channel-bind')
    if (scope.teamId !== input.teamId
      || scope.planId !== input.planId
      || scope.expectedCursor !== input.expectedCursor
      || scope.expectedRevision !== input.expectedRevision
      || scope.channelId !== input.channelId) {
      return this.rejectWorkflowActor()
    }
    return scope
  }

  /** Re-resolve a channel-binding proof under Team and channel locks. */
  private resolveWorkflowChannelBindAuthority(
    team: LoadedTeam,
    actor: TeamSystemWorkflowProof | undefined,
    input: TeamWorkflowPlanChannelBindInput,
  ): TeamWorkflowPlanSnapshot {
    const scope = this.workflowChannelBindScope(actor, input)
    const plan = this.requireWorkflowPlan(team, scope.planId)
    if (plan.revision !== scope.expectedRevision) return this.rejectWorkflowActor()
    this.requireWorkflowScopeCoordinator(team, plan, scope.coordinator)
    return plan
  }

  /** Resolve an exact workflow-plan/task binding scope without loading a Team. */
  private workflowTaskBindScope(
    actor: TeamSystemWorkflowProof | undefined,
    input: TeamWorkflowPlanTaskBindInput,
  ): Extract<TeamSystemWorkflowScope, { readonly kind: 'team-run-workflow-task-bind' }> {
    const scope = this.requireTeamRunWorkflowScope(actor, 'team-run-workflow-task-bind')
    if (scope.teamId !== input.teamId
      || scope.planId !== input.planId
      || scope.expectedCursor !== input.expectedCursor
      || scope.expectedRevision !== input.expectedRevision
      || scope.templateId !== input.templateId
      || scope.taskId !== input.taskId) {
      return this.rejectWorkflowActor()
    }
    return scope
  }

  /** Re-resolve a task-binding proof under the Team lock. */
  private resolveWorkflowTaskBindAuthority(
    team: LoadedTeam,
    actor: TeamSystemWorkflowProof | undefined,
    input: TeamWorkflowPlanTaskBindInput,
  ): TeamWorkflowPlanSnapshot {
    const scope = this.workflowTaskBindScope(actor, input)
    const plan = this.requireWorkflowPlan(team, scope.planId)
    if (plan.revision !== scope.expectedRevision) return this.rejectWorkflowActor()
    this.requireWorkflowScopeCoordinator(team, plan, scope.coordinator)
    return plan
  }

  /** Resolve an exact workflow-plan phase scope without loading a Team. */
  private workflowPlanPhaseScope(
    actor: TeamSystemWorkflowProof | undefined,
    input: TeamWorkflowPlanPhaseInput,
  ): Extract<TeamSystemWorkflowScope, { readonly kind: 'team-run-workflow-plan-phase' }> {
    const scope = this.requireTeamRunWorkflowScope(actor, 'team-run-workflow-plan-phase')
    if (scope.teamId !== input.teamId
      || scope.planId !== input.planId
      || scope.expectedCursor !== input.expectedCursor
      || scope.expectedRevision !== input.expectedRevision
      || scope.phase !== input.phase
      || !isDeepStrictEqual(scope.result, input.result)
      || !isDeepStrictEqual(scope.failure, input.failure)) {
      return this.rejectWorkflowActor()
    }
    return scope
  }

  /** Re-resolve a phase proof under the Team lock. */
  private resolveWorkflowPlanPhaseAuthority(
    team: LoadedTeam,
    actor: TeamSystemWorkflowProof | undefined,
    input: TeamWorkflowPlanPhaseInput,
  ): TeamWorkflowPlanSnapshot {
    const scope = this.workflowPlanPhaseScope(actor, input)
    const plan = this.requireWorkflowPlan(team, scope.planId)
    if (plan.revision !== scope.expectedRevision) return this.rejectWorkflowActor()
    this.requireWorkflowScopeCoordinator(team, plan, scope.coordinator)
    return plan
  }

  /** Resolve an exact workflow-channel cleanup scope without loading a Team or channel. */
  private workflowChannelCloseScope(
    actor: TeamSystemWorkflowProof | undefined,
    input: TeamWorkflowChannelCloseInput,
  ): Extract<TeamSystemWorkflowScope, { readonly kind: 'team-run-workflow-channel-close' }> {
    const scope = this.requireTeamRunWorkflowScope(actor, 'team-run-workflow-channel-close')
    if (scope.teamId !== input.teamId
      || scope.planId !== input.planId
      || scope.expectedTeamCursor !== input.expectedTeamCursor
      || scope.expectedRevision !== input.expectedRevision
      || scope.channelId !== input.channelId
      || scope.expectedCursor !== input.expectedCursor
      || scope.reason !== input.reason) {
      return this.rejectWorkflowActor()
    }
    return scope
  }

  /** Re-resolve one workflow cleanup proof against the locked compiling plan and active channel. */
  private resolveWorkflowChannelCloseAuthority(
    team: LoadedTeam,
    channel: LoadedChannel,
    actor: TeamSystemWorkflowProof | undefined,
    input: TeamWorkflowChannelCloseInput,
  ): TeamWorkflowPlanSnapshot {
    const scope = this.workflowChannelCloseScope(actor, input)
    const plan = this.requireWorkflowPlan(team, scope.planId)
    const currentChannel = this.requireLiveChannel(channel)
    this.requireWorkflowScopeCoordinator(team, plan, scope.coordinator)
    this.assertNoPendingParentCharges(team.projection)
    if (team.projection.team.cursor !== scope.expectedTeamCursor
      || plan.revision !== scope.expectedRevision
      || plan.phase !== 'compiling'
      || plan.channelId !== undefined
      || !team.projection.channelIds.has(scope.channelId)
      || currentChannel.projection.cursor !== scope.expectedCursor
      || !['pending', 'active'].includes(currentChannel.projection.phase)
      || currentChannel.projection.manifest.teamId !== scope.teamId
      || currentChannel.projection.manifest.workflowPlanId !== scope.planId
      || currentChannel.projection.manifest.adapter.type !== 'workflow'
      || currentChannel.projection.manifest.adapter.version !== 1) {
      return this.rejectWorkflowActor()
    }
    return plan
  }

  /** Reject every forged, revoked, foreign, stale, or wrong-operation workflow compiler proof. */
  private rejectWorkflowActor(): never {
    throw new TeamError('Workflow compiler actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Open a channel WAL, then make it reachable by appending its id to the
   * owning Team journal. A crash between these commits leaves an orphan WAL
   * that recovery deliberately ignores rather than inventing a Team reference.
   * @param request - Team cursor, adapter identity, and immutable manifest fields.
   * @returns the detached active channel projection.
   */
  override async openChannel(request: ChannelOpenRequest): Promise<ChannelSnapshot> {
    return await this.admit(async () => {
      const { actor, authorityKind, ...untrustedInput } = request
      const input = channelOpenInputSchema.parse(untrustedInput)
      if (input.invitations !== undefined && authorityKind !== 'channel-lifecycle' && authorityKind !== 'human') {
        throw new TeamError('Structural channel owners require every endpoint invitation', 'TEAM_INVALID_ARGUMENT')
      }
      if (input.workflowPlanId !== undefined) this.workflowChannelOpenScope(actor as TeamSystemWorkflowProof | undefined, input)
      if (input.workflowPlanId !== undefined && authorityKind !== undefined) {
        throw new TeamError('Workflow channel opening cannot use generic lifecycle authority', 'TEAM_ACTOR_PROOF_INVALID')
      }
      const lifecycle = input.workflowPlanId === undefined && authorityKind === 'channel-lifecycle'
        ? this.requireChannelOpenLifecycleAuthority(actor, input)
        : undefined
      const human = input.workflowPlanId === undefined && authorityKind === 'human'
        ? this.requireHumanChannelOpenProof(actor, input)
        : false
      const topology = input.workflowPlanId === undefined && authorityKind === undefined
        ? this.topologyChannelOpenScope(actor as TeamSystemTopologyProof, input)
        : undefined
      if (input.workflowPlanId === undefined && lifecycle === undefined && !human && topology === undefined) {
        throw new TeamError('Channel opening requires a recognized authority route', 'TEAM_ACTOR_PROOF_INVALID')
      }
      const team = await this.ensureTeam(input.teamId)
      if (topology !== undefined) {
        await team.queue.run(() => {
          const current = this.requireLiveTeam(team)
          this.resolveTopologyChannelOpenAuthority(current, actor as TeamSystemTopologyProof, input)
          return Promise.resolve()
        })
      }
      if (lifecycle !== undefined) {
        await team.queue.run(() => {
          const current = this.requireLiveTeam(team)
          const scope = lifecycle.revalidate()
          if (scope.teamId !== current.id) {
            throw new TeamError('Channel lifecycle proof is invalid for the current Team', 'TEAM_ACTOR_PROOF_INVALID')
          }
          return Promise.resolve()
        })
      }
      if (human) {
        await team.queue.run(() => {
          this.resolveHumanChannelOpenAuthority(this.requireLiveTeam(team), actor as TeamHumanActorProof, input)
          return Promise.resolve()
        })
      }
      await this.repairPendingParentCharges(team)
      return await team.queue.run(async () => {
        const current = this.requireLiveTeam(team)
        const workflowPlan = input.workflowPlanId === undefined
          ? undefined
          : this.resolveWorkflowChannelOpenAuthority(current, actor as TeamSystemWorkflowProof, input)
        const topologyScope = topology === undefined
          ? undefined
          : this.resolveTopologyChannelOpenAuthority(current, actor as TeamSystemTopologyProof, input)
        const lifecycleScope = lifecycle === undefined ? undefined : lifecycle.revalidate()
        if (lifecycleScope !== undefined && lifecycleScope.teamId !== current.id) {
          throw new TeamError('Channel lifecycle proof is invalid for the current Team', 'TEAM_ACTOR_PROOF_INVALID')
        }
        const humanActorId = human
          ? this.resolveHumanChannelOpenAuthority(current, actor as TeamHumanActorProof, input)
          : undefined
        if (lifecycle?.sourceName === 'team-run-child') this.assertChildResultChannelOpening(current, input)
        this.assertNoPendingParentCharges(current.projection)
        if (workflowPlan !== undefined) {
          const existing = await this.findWorkflowPlanChannel(current.projection, workflowPlan.id)
          if (existing !== undefined) {
            if (!sameWorkflowChannelRequest(existing.projection.manifest, input)) {
              throw new TeamError(
                `workflow plan '${workflowPlan.id}' channel retry has different manifest fields`,
                'TEAM_WORKFLOW_PLAN_IDEMPOTENCY_CONFLICT',
              )
            }
            return this.channelSnapshot(existing)
          }
          if (workflowPlan.phase !== 'compiling') throw new TeamError(`workflow plan '${workflowPlan.id}' is not compiling`, 'TEAM_WORKFLOW_PLAN_INVALID')
          if (input.adapter.type !== 'workflow' || input.adapter.version !== 1) {
            throw new TeamError(`workflow plan '${workflowPlan.id}' requires workflow channel adapter version 1`, 'TEAM_WORKFLOW_PLAN_INVALID')
          }
        }
        this.assertTeamWallTime(current.projection)
        if (current.projection.channelIds.size >= this.teamLimit(current.projection, 'maxChannels', this.config.maxChannelsPerTeam)) {
          throw new TeamError(`Team '${input.teamId}' reached its channel limit`, 'TEAM_CHANNEL_BACKPRESSURE')
        }
        this.assertTeamCursor(current, input.expectedCursor)
        if (current.projection.team.phase !== 'active') {
          throw new TeamError(`Team '${input.teamId}' is not active`, 'TEAM_INVALID_ARGUMENT')
        }
        for (const participant of input.participants) {
          const member = current.projection.participants.get(participant.id)
          if (member?.phase !== 'active') {
            throw new TeamError(`Channel participant '${participant.id}' is not active`, 'TEAM_PARTICIPANT_NOT_FOUND')
          }
        }
        await this.authorizeOrThrow('channel-open', input.teamId, {
          ...topologyScope === undefined ? {} : {
            operation: 'topology-channel-open',
            topologyOperation: topologyScope.kind,
            sourceName: TEAM_RUN_TOPOLOGY_PROOF_SOURCE,
          },
          ...lifecycle === undefined || lifecycleScope === undefined ? {} : {
            operation: 'channel-lifecycle',
            lifecycleOperation: lifecycleScope.kind,
            sourceName: lifecycle.sourceName,
          },
          ...humanActorId === undefined ? {} : { operation: 'human-channel-open' },
          adapterType: input.adapter.type,
          adapterVersion: input.adapter.version,
          ...input.viewPolicy === undefined ? {} : {
            viewPolicyType: input.viewPolicy.type,
            viewPolicyVersion: input.viewPolicy.version,
          },
          expectedCursor: input.expectedCursor,
        }, humanActorId ?? workflowPlan?.actor?.participantId)
        const revalidateOpenAuthority = (): void => {
          if (workflowPlan !== undefined) {
            this.resolveWorkflowChannelOpenAuthority(current, actor as TeamSystemWorkflowProof, input)
            return
          }
          if (topologyScope !== undefined) {
            this.resolveTopologyChannelOpenAuthority(current, actor as TeamSystemTopologyProof, input)
            return
          }
          if (human) {
            this.resolveHumanChannelOpenAuthority(current, actor as TeamHumanActorProof, input)
            return
          }
          if (lifecycle?.sourceName === 'team-run-child') this.assertChildResultChannelOpening(current, input)
          const scope = lifecycle?.revalidate()
          if (scope === undefined || scope.teamId !== current.id) {
            throw new TeamError('Channel lifecycle proof is invalid for the current Team', 'TEAM_ACTOR_PROOF_INVALID')
          }
        }
        revalidateOpenAuthority()
        if (input.viewPolicy !== undefined) this.getViewPolicy(input.viewPolicy)
        const manifest: ChannelManifest = {
          id: mintChannelId(),
          teamId: input.teamId,
          adapter: { ...input.adapter },
          ...input.viewPolicy === undefined ? {} : { viewPolicy: { ...input.viewPolicy } },
          ...input.workflowPlanId === undefined ? {} : { workflowPlanId: input.workflowPlanId },
          participants: input.participants.map(participant => ({ ...participant })),
          limits: jsonObjectSchema.parse(input.limits),
        }
        this.assertChannelViewBound(current, manifest)
        const created = await this.createChannel(manifest, revalidateOpenAuthority, input.invitations)
        try {
          revalidateOpenAuthority()
          await this.commitTeam(current, [{
            type: 'channel/attached', channelId: manifest.id, createdAt: nextTeamTimestamp(current.projection),
          }])
        } catch (error: unknown) {
          /* v8 ignore next 2 -- an attach failure leaves an orphan WAL by design; recovery ignores it. */
          await this.discardChannel(created.channel)
          // v8 ignore next -- the original cross-stream append error stays observable after cleanup.
          throw error
        }
        await this.publishCreatedChannel(created)
        return this.channelSnapshot(created.channel)
      })
    })
  }

  /** Keep child bootstrap authority within its live parent reservation and exact service/coordinator consult. */
  private assertChildResultChannelOpening(child: LoadedTeam, input: ChannelOpenInput): void {
    const identity = child.projection.team
    const parent = identity.parentTeamId === undefined ? undefined : this.teams.get(identity.parentTeamId)
    const task = identity.parentTaskId === undefined ? undefined : parent?.projection.tasks.get(identity.parentTaskId)
    const service = input.participants.find(endpoint => endpoint.role === 'initiator')
    const coordinator = input.participants.find(endpoint => endpoint.role === 'respondent')
    const serviceMember = service === undefined ? undefined : child.projection.participants.get(service.id)
    const coordinatorMember = coordinator === undefined ? undefined : child.projection.participants.get(coordinator.id)
    if (parent?.projection.team.phase !== 'active' || parent.projection.team.cancellation !== undefined
      || parent.projection.team.closure !== undefined || task?.phase !== 'running' || task.cancellation !== undefined
      || task.execution.kind !== 'child-team' || task.delegation?.childTeamId !== child.id
      || input.adapter.type !== 'consult' || input.adapter.version !== 1 || input.participants.length !== 2
      || serviceMember?.kind !== 'service' || serviceMember.role !== 'parent-service'
      || coordinatorMember?.role !== 'coordinator' || coordinatorMember.kind !== 'local-agent'
      || input.invitations !== undefined) {
      throw new TeamError('Child result channel requires its live parent reservation and service/coordinator endpoints', 'TEAM_ACTOR_PROOF_INVALID')
    }
  }

  /** Open one scheduler-owned channel after its exact source scope survives preflight, repair, and policy. */
  private async openSchedulerChannel(
    team: LoadedTeam,
    input: ChannelOpenInput,
    resolve: (current: LoadedTeam) => TeamSystemSchedulerChannelScope,
    facts: JsonObject,
  ): Promise<ChannelSnapshot> {
    await team.queue.run(() => {
      resolve(this.requireLiveTeam(team))
      return Promise.resolve()
    })
    await this.repairPendingParentCharges(team)
    return await team.queue.run(async () => {
      const current = this.requireLiveTeam(team)
      const scope = resolve(current)
      this.assertNoPendingParentCharges(current.projection)
      this.assertTeamWallTime(current.projection)
      this.assertTeamCursor(current, input.expectedCursor)
      if (current.projection.team.phase !== 'active') {
        throw new TeamError(`Team '${input.teamId}' is not active`, 'TEAM_INVALID_ARGUMENT')
      }
      for (const participant of input.participants) {
        const member = current.projection.participants.get(participant.id)
        if (member?.phase !== 'active') {
          throw new TeamError(`Channel participant '${participant.id}' is not active`, 'TEAM_PARTICIPANT_NOT_FOUND')
        }
      }
      await this.authorizeOrThrow('channel-open', input.teamId, facts)
      resolve(current)
      // The review identity survives the gap between channel attachment and request publication.
      const id = scope.kind === 'scheduler-review-channel-open'
        ? channelIdSchema.parse(`channel-review-${createHash('sha256')
          .update(JSON.stringify([input.teamId, scope.taskId, scope.attemptId, scope.reviewerId])).digest('hex')}`)
        : mintChannelId()
      if (current.projection.channelIds.has(id)) {
        const channel = await this.ensureChannel(id)
        resolve(current)
        return this.channelSnapshot(this.requireLiveChannel(channel))
      }
      if (current.projection.channelIds.size >= this.teamLimit(current.projection, 'maxChannels', this.config.maxChannelsPerTeam)) {
        throw new TeamError(`Team '${input.teamId}' reached its channel limit`, 'TEAM_CHANNEL_BACKPRESSURE')
      }
      const manifest: ChannelManifest = {
        id,
        teamId: input.teamId,
        adapter: { ...input.adapter },
        ...input.viewPolicy === undefined ? {} : { viewPolicy: { ...input.viewPolicy } },
        participants: input.participants.map(participant => ({ ...participant })),
        limits: jsonObjectSchema.parse(input.limits),
      }
      this.assertChannelViewBound(current, manifest)
      const created = await this.createChannel(manifest, () => { resolve(current) })
      try {
        resolve(current)
        await this.commitTeam(current, [{
          type: 'channel/attached', channelId: manifest.id, createdAt: nextTeamTimestamp(current.projection),
        }])
      } catch (error: unknown) {
        await this.discardChannel(created.channel)
        throw error
      }
      await this.publishCreatedChannel(created)
      return this.channelSnapshot(created.channel)
    })
  }

  /** Open one exact scheduler-owned participant-review consult channel. */
  override async openSchedulerReviewChannel(request: SchedulerReviewChannelOpenRequest): Promise<ChannelSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = schedulerReviewChannelOpenInputSchema.parse(untrustedInput)
      this.schedulerReviewChannelOpenScope(actor, input)
      const team = await this.ensureTeam(input.teamId)
      const channelInput: ChannelOpenInput = {
        teamId: input.teamId,
        expectedCursor: input.expectedTeamCursor,
        adapter: CONSULT_CHANNEL_ADAPTER,
        viewPolicy: { type: 'recent-window', version: 1 },
        participants: [
          { id: input.initiatorId, role: CONSULT_INITIATOR_ROLE },
          { id: input.reviewerId, role: CONSULT_RESPONDENT_ROLE },
        ],
        limits: {},
      }
      return await this.openSchedulerChannel(
        team,
        channelInput,
        current => this.resolveSchedulerReviewChannelOpenAuthority(current, actor, input),
        {
          operation: 'scheduler-review-channel-open',
          taskId: input.taskId,
          expectedRevision: input.expectedRevision,
          attemptId: input.attemptId,
          initiatorId: input.initiatorId,
          reviewerId: input.reviewerId,
          reviewerActivationId: input.reviewerActivationId,
          expectedTeamCursor: input.expectedTeamCursor,
          sourceName: TEAM_SCHEDULER_CHANNEL_PROOF_SOURCE,
        },
      )
    })
  }

  /** Open one exact scheduler-owned self-addressed task-assignment wake channel. */
  override async openSchedulerWakeChannel(request: SchedulerWakeChannelOpenRequest): Promise<ChannelSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = schedulerWakeChannelOpenInputSchema.parse(untrustedInput)
      this.schedulerWakeChannelOpenScope(actor, input)
      const team = await this.ensureTeam(input.teamId)
      const channelInput: ChannelOpenInput = {
        teamId: input.teamId,
        expectedCursor: input.expectedTeamCursor,
        adapter: TASK_ASSIGNMENT_CHANNEL_ADAPTER,
        participants: [{ id: input.participantId, role: TASK_ASSIGNMENT_ASSIGNEE_ROLE }],
        limits: {
          taskId: input.taskId,
          activationId: input.activationId,
          sessionId: input.sessionId,
        },
      }
      return await this.openSchedulerChannel(
        team,
        channelInput,
        current => this.resolveSchedulerWakeChannelOpenAuthority(current, actor, input),
        {
          operation: 'scheduler-wake-channel-open',
          taskId: input.taskId,
          expectedRevision: input.expectedRevision,
          participantId: input.participantId,
          activationId: input.activationId,
          sessionId: input.sessionId,
          expectedTeamCursor: input.expectedTeamCursor,
          sourceName: TEAM_SCHEDULER_CHANNEL_PROOF_SOURCE,
        },
      )
    })
  }

  /** Find an attached workflow channel by its durable plan identity for retry-safe open. */
  private async findWorkflowPlanChannel(
    projection: TeamProjection,
    planId: TeamWorkflowPlanSnapshot['id'],
  ): Promise<LoadedChannel | undefined> {
    for (const channelId of projection.channelIds) {
      const channel = await this.ensureChannel(channelId)
      if (channel.projection.manifest.workflowPlanId === planId
        && (channel.projection.phase === 'pending' || channel.projection.phase === 'active')) return channel
    }
    return undefined
  }

  /**
   * Admit one authenticated Envelope under the owning Team and channel
   * serializers. The Hub atomically commits the Envelope and any synchronous
   * adapter follow-up records; delivery remains a later consumer concern.
   * @param request - resolved sender, observed channel cursor, and immutable draft fields.
   * @returns the Hub-stamped durable Envelope.
   */
  override async postChannelEnvelope(request: ChannelEnvelopePostRequest): Promise<TeamEnvelope> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = channelEnvelopePostInputSchema.parse(untrustedInput)
      const channel = await this.ensureAttachedChannel(input.draft.channelId)
      const team = await this.ensureTeam(channel.projection.manifest.teamId)
      await this.repairPendingParentCharges(team)
      return await team.queue.run(async () => await channel.queue.run(async () => {
        const currentTeam = this.requireLiveTeam(team)
        const currentChannel = this.requireLiveChannel(channel)
        const resolved = this.resolveEnvelopePostAuthority(currentTeam, currentChannel, actor, input)
        return await this.admitChannelEnvelope(currentTeam, currentChannel, resolved)
      }))
    })
  }

  /**
   * Prepare and post one adapter-owned final while the Team and channel locks
   * hold the exact binding, peer, and cursor facts.
   * @param request - authenticated final text and retry identity.
   * @returns the accepted final Envelope.
   */
  override async postChannelFinalEnvelope(request: ChannelFinalPostRequest): Promise<TeamEnvelope> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = channelFinalPostInputSchema.parse(untrustedInput)
      const channel = await this.ensureAttachedChannel(input.channelId)
      const team = await this.ensureTeam(channel.projection.manifest.teamId)
      await this.repairPendingParentCharges(team)
      return await team.queue.run(async () => await channel.queue.run(async () => {
        const currentTeam = this.requireLiveTeam(team)
        const currentChannel = this.requireLiveChannel(channel)
        this.assertAttachedChannel(currentTeam, currentChannel)
        const binding = this.requireCurrentActivationActorBinding(currentTeam, actor)
        const senderId = binding.activation.participantId
        this.assertActiveChannelSender(currentTeam, currentChannel, senderId)
        const adapter = currentChannel.adapter
        const draft = currentTeam.projection.team.parentTeamId === undefined
          ? this.prepareChannelFinal(adapter, currentChannel, senderId, input.text)
          : await this.prepareChildResult(currentTeam, currentChannel, senderId, input.text)
        const post: ChannelEnvelopePostInput = {
          expectedCursor: currentChannel.projection.cursor,
          idempotencyKey: input.idempotencyKey,
          draft,
        }
        return await this.admitChannelEnvelope(
          currentTeam,
          currentChannel,
          this.resolveEnvelopePostAuthority(currentTeam, currentChannel, actor, post),
        )
      }))
    })
  }

  /** Derive a child response from its bound service request, never from caller-selected audience or causation. */
  private async prepareChildResult(
    team: LoadedTeam, channel: LoadedChannel, senderId: ParticipantId, text: string,
  ): Promise<TeamEnvelopeDraft> {
    const binding = team.projection.team.childRun
    const manifest = channel.projection.manifest
    if (binding === undefined || binding.channelId !== channel.id || binding.coordinatorId !== senderId
      || binding.childTeamId !== team.id || binding.parentTeamId !== team.projection.team.parentTeamId
      || binding.parentTaskId !== team.projection.team.parentTaskId || manifest.adapter.type !== 'consult'
      || manifest.adapter.version !== 1 || text.trim().length === 0
      || team.projection.participants.get(binding.parentServiceId)?.kind !== 'service') {
      throw new TeamError('Child final must address its bound parent-service result channel', 'TEAM_FINAL_INVALID')
    }
    const first = channel.stream.firstSequence
    const records = await this.readChannelRecordRange(channel, first, channel.projection.cursor - first + 1)
    const requests = records.filter((record): record is ChannelEnvelopeRecord => record.type === 'channel/envelope'
      && record.envelope.kind === 'request' && record.envelope.senderId === binding.parentServiceId
      && record.envelope.audience?.length === 1 && record.envelope.audience[0] === binding.coordinatorId
      && record.envelope.delivery === 'turn')
    const request = requests[0]
    if (requests.length !== 1 || request === undefined) {
      throw new TeamError('Child result requires one retained parent request', 'TEAM_FINAL_INVALID')
    }
    return { channelId: channel.id, kind: 'response', audience: [binding.parentServiceId], delivery: 'turn',
      payload: { text }, causationId: request.envelope.id }
  }

  /**
   * Record one recipient's already-flushed Envelope admission. A duplicate
   * acknowledgement returns its existing durable receipt without appending a
   * second record or moving the recipient cursor backward.
   * @param request - runtime receipt actor, observed channel cursor, and Envelope identity; it contains no caller-selected recipient.
   * @returns the immutable durable receipt for this recipient and Envelope.
   */
  override async admitHumanChannelDelivery(request: TeamHumanChannelDeliveryRequest): Promise<TeamHumanChannelDeliveryResult> {
    return await this.admit(async () => {
      const { actor, ...raw } = request
      const input = teamSystemHumanDeliveryScopeSchema.parse(raw)
      const initial = this.requireSystemHumanDeliveryProof(actor)
      if (!isDeepStrictEqual(initial, input)) this.rejectReceiptActor()
      const team = await this.ensureTeam(input.teamId)
      const channel = await this.ensureAttachedChannel(input.channelId)
      return await team.queue.run(async () => await channel.queue.run(async () => {
        const currentTeam = this.requireLiveTeam(team)
        const currentChannel = this.requireLiveChannel(channel)
        const validate = (): void => {
          if (!isDeepStrictEqual(this.requireSystemHumanDeliveryProof(actor), input)) this.rejectReceiptActor()
          this.assertAttachedChannel(currentTeam, currentChannel)
          const human = currentTeam.projection.participants.get(input.recipientId)
          if (human?.kind !== 'human' || human.phase !== 'active' || human.owner?.kind !== 'product-principal'
            || human.owner.principalId !== input.principalId || !human.authorityGrant?.operations.includes('dispatch')) this.rejectReceiptActor()
          this.assertActiveChannelParticipant(currentTeam, currentChannel, input.recipientId)
        }
        validate()
        const envelope = await this.findCommittedEnvelope(currentChannel, input.envelopeId)
        if (envelope === undefined || envelope.kind === 'final') {
          throw new TeamError('Human message admission requires a retained non-final Envelope', 'TEAM_INVALID_ARGUMENT')
        }
        const pending = currentChannel.projection.pendingDeliveries.get(input.recipientId)?.get(input.envelopeId)
        const prior = pending === undefined
          ? await this.findCommittedReceipt(currentChannel, input.recipientId, input.envelopeId) : undefined
        if (pending === undefined && prior === undefined) {
          throw new TeamError('Envelope is not pending for this human', 'TEAM_INVALID_ARGUMENT')
        }
        if (pending !== undefined) {
          this.assertPendingDeliveryOpen(currentTeam, currentChannel, pending, true)
          assertChannelCursor(currentChannel.projection.cursor, input.expectedCursor)
        }
        await this.authorizeOrThrow('dispatch', currentTeam.id, { operation: 'human-inbox-delivery', channelId: input.channelId, envelopeId: input.envelopeId }, input.recipientId)
        validate()
        const sink = this.ctx.get('teamHumanDelivery')
        if (sink === undefined) throw new TeamError('Human message admission requires a durable principal inbox', 'TEAM_INVALID_ARGUMENT')
        if (prior !== undefined) {
          const selection = { principalId: input.principalId, teamId: input.teamId, envelopeId: input.envelopeId }
          const item = await this.withHumanSinkProof({ kind: 'message-read', input: selection },
            async proof => await sink.getMessageAdmission(selection, proof))
          validate()
          if (item === undefined || item.recipientId !== input.recipientId || !isDeepStrictEqual(item.envelope, envelope)) {
            throw new TeamError('Human receipt has no matching durable inbox admission', 'TEAM_INVALID_ARGUMENT')
          }
          return { item, receipt: this.receiptSnapshot(prior) }
        }
        const view = pending !== undefined && this.requiresDurableChannelView(currentChannel.projection.manifest)
          ? await this.renderChannelDeliveryView(currentTeam, currentChannel, pending, input.envelopeId) : undefined
        const text = view?.content.map(block => 'text' in block && typeof block.text === 'string' ? block.text : JSON.stringify(block)).join('\n')
          ?? (typeof envelope.payload['text'] === 'string' ? envelope.payload['text'] : JSON.stringify(envelope.payload))
        const content: TeamHumanMessageInput = { principalId: input.principalId, recipientId: input.recipientId,
          teamId: input.teamId, channelId: input.channelId, envelopeId: input.envelopeId, envelope, text,
          ...(view === undefined ? {} : { view }) }
        const item = await this.withHumanSinkProof({ kind: 'message', input: content }, async proof => await sink.admitMessage(content, proof))
        validate()
        if (pending === undefined) throw new TeamError('Human delivery disappeared before receipt', 'TEAM_INVALID_ARGUMENT')
        this.assertPendingDeliveryOpen(currentTeam, currentChannel, pending, true)
        const receipt = await this.commitPendingDeliveryReceipt(currentChannel, input.recipientId, pending, validate)
        return { item, receipt: this.receiptSnapshot(receipt) }
      }))
    })
  }

  override async ackChannelEnvelope(request: ChannelEnvelopeReceiptRequest): Promise<ChannelReceiptRecord> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = channelEnvelopeReceiptInputSchema.parse(untrustedInput)
      const channel = await this.ensureAttachedChannel(input.channelId)
      const team = await this.ensureTeam(channel.projection.manifest.teamId)
      return await team.queue.run(async () => await channel.queue.run(async () => {
        const currentTeam = this.requireLiveTeam(team)
        const currentChannel = this.requireLiveChannel(channel)
        this.assertAttachedChannel(currentTeam, currentChannel)
        const authority = await this.resolveReceiptAuthority(currentTeam, currentChannel, actor, input)
        const participantId = authority.participantId
        await this.authorizeOrThrow('dispatch', currentTeam.id, {
          channelId: currentChannel.id,
          envelopeId: input.envelopeId,
          expectedCursor: input.expectedCursor,
        }, authority.policyActorId)
        await authority.revalidate()
        const pending = currentChannel.projection.pendingDeliveries.get(participantId)?.get(input.envelopeId)
        if (pending === undefined) {
          const existing = await this.findCommittedReceipt(currentChannel, participantId, input.envelopeId)
          if (existing !== undefined) return this.receiptSnapshot(existing)
          throw new TeamError(
            `Envelope '${input.envelopeId}' is not pending for participant '${participantId}'`,
            'TEAM_INVALID_ARGUMENT',
          )
        }
        if (authority.policyActorId !== undefined) this.assertPendingDeliveryOpen(currentTeam, currentChannel, pending)
        assertChannelCursor(currentChannel.projection.cursor, input.expectedCursor)
        return this.receiptSnapshot(await this.commitPendingDeliveryReceipt(
          currentChannel,
          participantId,
          pending,
          async () => { await authority.revalidate() },
        ))
      }))
    })
  }

  /** Ask the retained protocol whether normal completion preserves its durable outbox. */
  private channelDeliveryOpen(channel: LoadedChannel): boolean {
    if (channel.projection.phase === 'active') return true
    return channel.projection.phase === 'closed' && this.callChannelAdapter(channel, () => channel.adapter.allowsClosedDelivery?.({
      manifest: freeze(structuredClone(channel.projection.manifest)), state: freeze(structuredClone(channel.projection.state)),
    })) === true
  }

  /** Keep model dispatch active-only while allowing human sink drainage during completion. */
  private assertPendingDeliveryOpen(team: LoadedTeam, channel: LoadedChannel, pending: PendingChannelDelivery, human = false): void {
    const state = team.projection.team
    const completingHuman = human && state.phase === 'quiescing' && state.closure?.kind === 'complete'
    if (!this.channelDeliveryOpen(channel) || state.cancellation !== undefined
      || (state.phase !== 'active' && !completingHuman) || (state.closure !== undefined && (!human || state.closure.kind !== 'complete'))
      || (pending.expiresAt !== undefined && pending.expiresAt <= Date.now())) {
      throw new TeamError('Pending delivery is closed, cancelled, or expired', 'TEAM_INVALID_ARGUMENT')
    }
  }

  /**
   * Linearize one recipient delivery against its exact active activation.
   * A successful claim carries no durable reservation; a receipt or causal
   * reply creates or reuses a durable receipt and returns `undefined`.
   * @param request - exact Team, activation, Session, channel, recipient, and Envelope identities.
   * @returns a detached pending-delivery claim, or `undefined` after durable acknowledgement.
   */
  override async claimChannelDelivery(request: ChannelDeliveryClaimRequest): Promise<ChannelDeliveryClaim | undefined> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = channelDeliveryClaimInputSchema.parse(untrustedInput)
      const channel = await this.ensureAttachedChannel(input.channelId)
      const team = await this.ensureTeam(channel.projection.manifest.teamId)
      return await team.queue.run(async () => await channel.queue.run(async () => {
        const currentTeam = this.requireLiveTeam(team)
        const currentChannel = this.requireLiveChannel(channel)
        this.assertAttachedChannel(currentTeam, currentChannel)
        if (currentTeam.projection.team.phase !== 'active' || currentTeam.projection.team.cancellation !== undefined || currentTeam.projection.team.closure !== undefined) {
          if (currentTeam.projection.team.closure?.kind === 'complete') return undefined
          throw new TeamError(`Team '${currentTeam.id}' is not active`, 'TEAM_INVALID_ARGUMENT')
        }
        if (!this.channelDeliveryOpen(currentChannel)) {
          throw new TeamError(`channel '${currentChannel.id}' is not active`, 'TEAM_INVALID_ARGUMENT')
        }
        const authority = this.resolveChannelDeliveryClaimAuthority(currentTeam, currentChannel, actor)
        const binding = authority.binding
        const participantId = binding.activation.participantId
        const pending = currentChannel.projection.pendingDeliveries.get(participantId)?.get(input.envelopeId)
        if (pending === undefined) {
          const receipt = await this.findCommittedReceipt(currentChannel, participantId, input.envelopeId)
          if (receipt === undefined) {
            throw new TeamError(
              `Envelope '${input.envelopeId}' is not pending for participant '${participantId}'`,
              'TEAM_INVALID_ARGUMENT',
            )
          }
          await this.authorizeOrThrow('dispatch', currentTeam.id, claimFacts(input, binding), participantId)
          authority.revalidate()
          return undefined
        }
        this.assertPendingDeliveryOpen(currentTeam, currentChannel, pending)
        await this.authorizeOrThrow('dispatch', currentTeam.id, {
          ...claimFacts(input, binding),
          delivery: pending.delivery,
        }, participantId)
        const confirmedBinding = authority.revalidate()
        if (!this.requiresDurableChannelView(currentChannel.projection.manifest)
          && await this.hasCommittedCausalResult(currentChannel, participantId, input.envelopeId)) {
          await this.commitPendingDeliveryReceipt(currentChannel, participantId, pending, () => {
            authority.revalidate()
          })
          return undefined
        }
        const view = this.requiresDurableChannelView(currentChannel.projection.manifest)
          ? await this.renderChannelDeliveryView(currentTeam, currentChannel, pending, input.envelopeId)
          : undefined
        authority.revalidate()
        this.assertPendingDeliveryOpen(currentTeam, currentChannel, pending)
        this.incrementMetric('deliveryClaims')
        return freeze(channelDeliveryClaimSchema.parse({
          binding: this.activationBindingSnapshot(confirmedBinding),
          channel: this.channelSnapshot(currentChannel),
          envelopeId: input.envelopeId,
          delivery: pending.delivery,
          ...view === undefined ? {} : { view },
        }))
      }))
    })
  }

  /**
   * Page currently pending deliveries for one activation or completion-time human recipient.
   * The page reads the current projection and its durable Envelope records
   * under one Team-to-channel linearization point; it does not reserve,
   * acknowledge, or otherwise mutate recipient delivery state.
   * @param request - channel recipient, exclusive Envelope cursor, and requested page size.
   * @returns the current channel snapshot, pending Envelope payloads, and next cursor.
   */
  override async listChannelPendingDeliveries(
    request: ChannelPendingDeliveryListRequest,
  ): Promise<ChannelPendingDeliveryPage> {
    return await this.admit(async () => {
      const input = channelPendingDeliveryListRequestSchema.parse(request)
      const channel = await this.ensureAttachedChannel(input.channelId)
      const team = await this.ensureTeam(channel.projection.manifest.teamId)
      return await team.queue.run(async () => await channel.queue.run(async () => {
        const currentTeam = this.requireLiveTeam(team)
        const currentChannel = this.requireLiveChannel(channel)
        const maxPageSize = this.teamLimit(
          currentTeam.projection,
          'maxPendingDeliveryPageSize',
          this.config.maxPendingDeliveryPageSize,
        )
        if (input.limit > maxPageSize) {
          throw new TeamError(
            `pending delivery page limit ${input.limit} exceeds configured maximum ${maxPageSize}`,
            'TEAM_INVALID_ARGUMENT',
          )
        }
        this.assertAttachedChannel(currentTeam, currentChannel)
        const recipient = currentTeam.projection.participants.get(input.participantId)
        const completingHuman = currentTeam.projection.team.phase === 'quiescing'
          && currentTeam.projection.team.closure?.kind === 'complete'
          && recipient?.kind === 'human'
        const completionFinal = currentTeam.projection.team.phase === 'quiescing'
          && currentTeam.projection.team.closure?.kind === 'complete'
          && currentTeam.projection.team.closure.finalChannelId === currentChannel.id
        if (currentTeam.projection.team.cancellation !== undefined
          || (currentTeam.projection.team.phase !== 'active' && !completionFinal && !completingHuman)
          || (currentTeam.projection.team.closure !== undefined && !completionFinal && !completingHuman)) {
          throw new TeamError(`Team '${currentTeam.id}' is not active`, 'TEAM_INVALID_ARGUMENT')
        }
        if (!this.channelDeliveryOpen(currentChannel)) {
          throw new TeamError(`channel '${currentChannel.id}' is not active`, 'TEAM_INVALID_ARGUMENT')
        }
        this.assertActiveChannelParticipant(currentTeam, currentChannel, input.participantId)
        await this.authorizeOrThrow('dispatch', currentTeam.id, {
          channelId: input.channelId,
          participantId: input.participantId,
          afterCursor: input.afterCursor,
          limit: input.limit,
        }, recipient?.kind === 'human' ? undefined : input.participantId)
        const candidates = this.pendingDeliveryCandidates(currentChannel, input.participantId, input.afterCursor)
          .filter(pending => pending.expiresAt === undefined || pending.expiresAt > Date.now())
        const selected = candidates.slice(0, input.limit)
        const deliveries = await this.readPendingEnvelopeDeliveries(currentChannel, input.afterCursor, selected)
        const nextCursor = selected.length === candidates.length
          ? Math.max(input.afterCursor, currentChannel.projection.cursor)
          : selected.at(-1)?.envelopeSequence
        /* v8 ignore next -- a non-exhausted page has at least one selected pending delivery. */
        if (nextCursor === undefined) {
          throw new TeamHubError(`channel '${currentChannel.id}' produced an empty non-exhausted delivery page`, 'TEAM_CHANNEL_WAL_MALFORMED')
        }
        return freeze(channelPendingDeliveryPageSchema.parse({
          channel: this.channelSnapshot(currentChannel),
          deliveries,
          nextCursor,
        }))
      }))
    })
  }

  /**
   * Expire one bounded set of currently due pending deliveries from a locked attached channel.
   * @param currentChannel - attached channel linearized with its owning Team.
   * @param finalAdmission - durable result whose exact human delivery remains available for receipt.
   * @param now - trusted clock observation used to select due deliveries.
   * @param limit - requested bounded append size.
   * @param beforeCommit - optional authorization revalidation immediately before the channel-WAL append.
   * @returns the updated channel projection and expiry records appended by this batch.
   */
  private async expirePendingChannelDeliveries(
    currentChannel: LoadedChannel,
    finalAdmission: TeamFinalAdmission | null,
    now: number,
    limit: number,
    beforeCommit?: () => void,
  ): Promise<ChannelDeliveryExpireResult> {
    const due: Array<{ readonly participantId: ParticipantId; readonly pending: PendingChannelDelivery }> = []
    for (const [participantId, deliveries] of currentChannel.projection.pendingDeliveries) {
      for (const pending of deliveries.values()) {
        if (finalAdmission !== null
          && finalAdmission.channelId === currentChannel.id
          && finalAdmission.envelopeId === pending.envelopeId
          && finalAdmission.recipientId === participantId) continue
        if (pending.expiresAt !== undefined && pending.expiresAt <= now) due.push({ participantId, pending })
      }
    }
    due.sort((left, right) => left.pending.envelopeSequence - right.pending.envelopeSequence
      || String(left.participantId).localeCompare(String(right.participantId)))
    const selected = due.slice(0, this.pageLimit(limit))
    const expired: ChannelDeliveryExpiredRecord[] = selected.map(({ participantId, pending }, index) => ({
      type: 'channel/delivery-expired',
      sequence: currentChannel.projection.cursor + index + 1,
      createdAt: now,
      participantId,
      envelopeId: pending.envelopeId,
      envelopeSequence: pending.envelopeSequence,
    }))
    if (expired.length > 0) {
      beforeCommit?.()
      const projection = this.foldChannelAppend(
        currentChannel.projection,
        expired,
        currentChannel.id,
        currentChannel.adapter,
      )
      await this.commitChannel(currentChannel, expired, projection)
    }
    return freeze(channelDeliveryExpireResultSchema.parse({
      channel: this.channelSnapshot(currentChannel),
      expired,
    }))
  }

  /**
   * Expire one exact bounded TTL delivery batch through a current scheduler channel proof.
   * @param request - scheduler proof plus Team/channel cursors, clock observation, and expiry bound.
   * @returns the updated channel projection and expiry records appended by this authorized batch.
   */
  override async expireSchedulerChannelDeliveries(
    request: SchedulerChannelDeliveryExpireRequest,
  ): Promise<ChannelDeliveryExpireResult> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = schedulerChannelDeliveryExpireInputSchema.parse(untrustedInput)
      this.schedulerChannelDeliveryExpireScope(actor, input)
      const team = await this.ensureTeam(input.teamId)
      const channel = await this.ensureAttachedChannel(input.channelId)
      return await team.queue.run(async () => await channel.queue.run(async () => {
        const currentTeam = this.requireLiveTeam(team)
        const currentChannel = this.requireLiveChannel(channel)
        this.resolveSchedulerChannelDeliveryExpireAuthority(currentTeam, currentChannel, actor, input)
        this.assertAttachedChannel(currentTeam, currentChannel)
        return await this.expirePendingChannelDeliveries(
          currentChannel, currentTeam.projection.finalAdmission, input.now, input.limit, () => {
            this.resolveSchedulerChannelDeliveryExpireAuthority(currentTeam, currentChannel, actor, input)
          },
        )
      }))
    })
  }

  /** Read and authorize one bounded source selection before generation outside Hub queues. */
  override async readChannelSummarySource(request: ChannelSummarySourceRequest): Promise<ChannelSummarySource> {
    return await this.admit(async () => {
      const { requester, ...raw } = request
      const input = channelSummarySelectionInputSchema.parse(raw)
      const channel = await this.ensureAttachedChannel(input.channelId)
      const team = await this.ensureTeam(channel.projection.manifest.teamId)
      return await team.queue.run(async () => await channel.queue.run(async () => {
        const currentTeam = this.requireLiveTeam(team)
        const current = this.requireLiveChannel(channel)
        const actorId = this.resolveSummaryRequester(currentTeam, current, requester, input)
        const existing = current.projection.summaries.get(input.idempotencyKey)
        if (existing !== undefined) {
          if (!isDeepStrictEqual(existing.coveredSequenceRange, input.coveredSequenceRange)) {
            throw new TeamError('Summary retry key already names another source range', 'TEAM_CHANNEL_IDEMPOTENCY_CONFLICT')
          }
          return freeze({ channel: this.channelSnapshot(current), envelopes: [],
            sourceFingerprint: existing.sourceFingerprint, existing: this.summarySnapshot(existing) })
        }
        this.assertSummaryAdmission(currentTeam, current, input)
        await this.authorizeOrThrow('send', currentTeam.id, {
          operation: 'channel-summary', channelId: current.id, coveredSequenceRange: { ...input.coveredSequenceRange },
          idempotencyKey: input.idempotencyKey, expectedCursor: input.expectedCursor,
        }, actorId)
        this.resolveSummaryRequester(currentTeam, current, requester, input)
        const envelopes = await this.readSummaryEnvelopes(current, input)
        this.resolveSummaryRequester(currentTeam, current, requester, input)
        return freeze({ channel: this.channelSnapshot(current), envelopes,
          sourceFingerprint: fingerprintChannelSummarySources(envelopes) })
      }))
    })
  }

  /** Append one source-owned summary after revalidating the current requester and exact source content. */
  override async summarizeChannel(request: ChannelSummarizeRequest): Promise<ChannelSummaryRecord> {
    return await this.admit(async () => {
      const { actor, requester, ...raw } = request
      const parsed = channelSummarizeInputSchema.parse(raw)
      const authority = this.requireChannelSummaryAuthority(actor, parsed)
      const channel = await this.ensureAttachedChannel(parsed.channelId)
      const team = await this.ensureTeam(channel.projection.manifest.teamId)
      return await team.queue.run(async () => await channel.queue.run(async () => {
        const input = authority.revalidate()
        const currentTeam = this.requireLiveTeam(team)
        const current = this.requireLiveChannel(channel)
        const actorId = this.resolveSummaryRequester(currentTeam, current, requester, input)
        const existing = current.projection.summaries.get(input.idempotencyKey)
        if (existing !== undefined) {
          if (!sameChannelSummary(existing, input)) {
            throw new TeamError('Summary retry key already names different summary facts', 'TEAM_CHANNEL_IDEMPOTENCY_CONFLICT')
          }
          return this.summarySnapshot(existing)
        }
        this.assertSummaryAdmission(currentTeam, current, input)
        if (!isDeepStrictEqual(current.projection.manifest.viewPolicy, input.policy)) {
          throw new TeamError('Summary policy must match the channel view policy', 'TEAM_INVALID_ARGUMENT')
        }
        await this.authorizeOrThrow('send', currentTeam.id, {
          operation: 'channel-summary', channelId: current.id, coveredSequenceRange: { ...input.coveredSequenceRange },
          sourceFingerprint: input.sourceFingerprint, idempotencyKey: input.idempotencyKey, expectedCursor: input.expectedCursor,
        }, actorId)
        authority.revalidate()
        this.resolveSummaryRequester(currentTeam, current, requester, input)
        const envelopes = await this.readSummaryEnvelopes(current, input)
        if (!isDeepStrictEqual(envelopes.map(envelope => envelope.id), input.sourceEnvelopeIds)
          || fingerprintChannelSummarySources(envelopes) !== input.sourceFingerprint) {
          throw new TeamError('Summary source content does not match its committed WAL range', 'TEAM_INVALID_ARGUMENT')
        }
        const summary: ChannelSummaryRecord = {
          type: 'channel/summary', sequence: current.projection.cursor + 1, createdAt: Date.now(),
          coveredSequenceRange: { ...input.coveredSequenceRange }, sourceEnvelopeIds: [...input.sourceEnvelopeIds],
          sourceFingerprint: input.sourceFingerprint, text: normalizedText(input.text, 'summary text'),
          policy: { ...input.policy }, idempotencyKey: input.idempotencyKey,
        }
        const projection = this.foldChannelAppend(current.projection, [summary], current.id, current.adapter)
        authority.revalidate()
        this.resolveSummaryRequester(currentTeam, current, requester, input)
        this.assertSummaryAdmission(currentTeam, current, input)
        await this.commitChannel(current, [summary], projection)
        return this.summarySnapshot(summary)
      }))
    })
  }

  /** Resolve only a current channel-member coordinator or payload-bound authenticated human. */
  private resolveSummaryRequester(
    team: LoadedTeam, channel: LoadedChannel, requester: TeamActorProof | TeamHumanActorProof,
    input: ChannelSummarySelectionInput,
  ): ParticipantId {
    this.assertAttachedChannel(team, channel)
    const human = this.tryResolveHumanActorProof(requester)
    let participant: ParticipantSnapshot | undefined
    if (human !== undefined) {
      this.assertHumanParticipantProofScope(human, channelSummaryHumanProofInput(team.id, input))
      participant = team.projection.participants.get(human.participantId)
      if (participant?.kind !== 'human' || participant.phase !== 'active') this.rejectHumanParticipantActor()
    } else {
      const binding = this.requireCurrentActivationActorBinding(team, requester as TeamActorProof)
      participant = team.projection.participants.get(binding.activation.participantId)
      if (participant?.role !== 'coordinator' || participant.phase !== 'active') {
        throw new TeamError('Only an active coordinator or authenticated human may request a channel summary', 'TEAM_GRANT_DENIED')
      }
    }
    if (!channel.projection.manifest.participants.some(member => member.id === participant.id)) {
      throw new TeamError('Channel summary requires current channel membership', 'TEAM_GRANT_DENIED')
    }
    return participant.id
  }

  /** Keep new summary work within its immutable channel policy, active lifecycle, cursor and source bound. */
  private assertSummaryAdmission(team: LoadedTeam, channel: LoadedChannel, input: ChannelSummarySelectionInput): void {
    if (team.projection.team.phase !== 'active' || team.projection.team.closure !== undefined
      || team.projection.team.cancellation !== undefined || channel.projection.phase !== 'active') {
      throw new TeamError('New channel summaries require an active Team and channel', 'TEAM_INVALID_ARGUMENT')
    }
    this.assertTeamWallTime(team.projection)
    assertChannelCursor(channel.projection.cursor, input.expectedCursor)
    if (channel.projection.manifest.viewPolicy === undefined) {
      throw new TeamError('Channel summary requires an explicit view policy on the channel', 'TEAM_INVALID_ARGUMENT')
    }
    this.channelViewPolicy(channel)
    const count = input.coveredSequenceRange.to - input.coveredSequenceRange.from + 1
    if (!Number.isSafeInteger(count) || count > this.config.recoveryPageSize || input.coveredSequenceRange.to > input.expectedCursor) {
      throw new TeamError(`Summary source must be committed and fit within recoveryPageSize ${String(this.config.recoveryPageSize)}`, 'TEAM_INVALID_ARGUMENT')
    }
  }

  /** Read only channel-wide source content; private subset content is never returned for generation. */
  private async readSummaryEnvelopes(channel: LoadedChannel, input: ChannelSummarySelectionInput): Promise<TeamEnvelope[]> {
    const records = await this.readChannelRecordRange(channel, input.coveredSequenceRange.from,
      input.coveredSequenceRange.to - input.coveredSequenceRange.from + 1)
    const sourceRecords = records.filter((record): record is ChannelEnvelopeRecord => record.type === 'channel/envelope')
    const envelopes = sourceRecords.map(record => record.envelope)
    if (envelopes.length === 0) throw new TeamError('Summary source range contains no messages', 'TEAM_INVALID_ARGUMENT')
    if (!channelSummarySourcesAreShared(channel.projection.manifest, sourceRecords)) {
      throw new TeamError('Channel-wide summaries require shared messages visible to every channel member; private subset ranges cannot be summarized', 'TEAM_GRANT_DENIED')
    }
    return envelopes
  }

  /** Read the current invitation projection without treating discovery as endpoint consent. */
  override async getChannelAdmission(request: ChannelGetRequest): Promise<ChannelAdmissionSnapshot> {
    return await this.admit(async () => {
      const input = channelGetRequestSchema.parse(request)
      const channel = await this.ensureAttachedChannel(input.channelId)
      return await channel.queue.run(() => Promise.resolve(this.channelAdmissionSnapshot(this.requireLiveChannel(channel))))
    })
  }

  /** Load only the selected channel projections after validating the caller's Team membership. */
  override async listTeamChannels(request: TeamChannelListRequest): Promise<TeamChannelListPage> {
    return await this.admit(async () => {
      const { actor, ...raw } = request
      const input = teamChannelListInputSchema.parse(raw)
      if (this.tryResolveHumanActorProof(actor) === undefined) throw new TeamError('Channel listing requires a current human proof', 'TEAM_ACTOR_PROOF_INVALID')
      const team = await this.ensureTeam(input.teamId)
      const selected = await team.queue.run(() => {
        const current = this.requireLiveTeam(team)
        this.assertHumanTeamRead(current, actor, 'channel-list-read', jsonObjectSchema.parse(input))
        const { limit, afterCursor } = this.resolveChannelList(input)
        const ids: ChannelId[] = []
        let ordinal = -1
        let lastCursor = afterCursor
        for (const id of current.projection.channelIds) {
          ordinal++
          if (ordinal <= afterCursor) continue
          ids.push(id)
          lastCursor = ordinal
          if (ids.length === limit) break
        }
        return Promise.resolve({ ids, lastCursor })
      })
      const channels = await Promise.all(selected.ids.map(id => this.ensureChannel(id)))
      return await team.queue.run(() => this.withChannelQueues(channels, () => {
        const current = this.requireLiveTeam(team)
        this.assertHumanTeamRead(current, actor, 'channel-list-read', jsonObjectSchema.parse(input))
        const items = channels.map((loaded) => {
          const channel = this.requireLiveChannel(loaded)
          this.assertAttachedChannel(current, channel)
          return this.channelSnapshot(channel)
        })
        return Promise.resolve(freeze(teamChannelListPageSchema.parse({ items,
          ...items.length > 0 && current.projection.channelIds.size > selected.lastCursor + 1 ? { nextCursor: selected.lastCursor } : {},
        })))
      }))
    })
  }

  /** Resolve provider-owned pagination defaults without changing the authenticated input. */
  private resolveChannelList(input: TeamChannelListInput): { readonly limit: number; readonly afterCursor: number } {
    return { limit: this.pageLimit(input.limit ?? this.config.recoveryPageSize), afterCursor: input.afterCursor ?? -1 }
  }

  /** Revalidate a membership-only read against its exact operation and complete selected payload. */
  private assertHumanTeamRead(team: LoadedTeam, actor: TeamHumanActorProof,
    operation: 'channel-list-read' | 'channel-admission-read' | 'channel-content-read', payload: JsonObject): void {
    const human = this.tryResolveHumanActorProof(actor)
    const expected: TeamHumanActorProofInput = { teamId: team.id, operation, fence: { kind: 'read' }, payload }
    const participant = human === undefined ? undefined : team.projection.participants.get(human.participantId)
    if (human === undefined || human.teamId !== team.id || human.operation !== operation
      || !isDeepStrictEqual(human.fence, expected.fence) || human.payloadFingerprint !== fingerprintTeamHumanActorPayload(expected)
      || participant?.kind !== 'human' || participant.phase !== 'active' || participant.owner?.kind !== 'product-principal') {
      throw new TeamError('Channel inspection requires a current authenticated Team human', 'TEAM_ACTOR_PROOF_INVALID')
    }
  }

  override async getHumanChannelEnvelope(request: ChannelHumanEnvelopeGetRequest): Promise<TeamEnvelope> {
    return await this.admit(async () => {
      const { actor, ...raw } = request
      const input = channelHumanEnvelopeGetInputSchema.parse(raw)
      const team = await this.ensureTeam(input.teamId)
      const channel = await this.ensureAttachedChannel(input.channelId)
      return await team.queue.run(() => channel.queue.run(async () => {
        const currentTeam = this.requireLiveTeam(team)
        const current = this.requireLiveChannel(channel)
        const validate = (): void => {
          if (current.projection.manifest.teamId !== input.teamId) {
            throw new TeamError('Channel is not attached to the requested Team', 'TEAM_CHANNEL_NOT_FOUND')
          }
          this.assertAttachedChannel(currentTeam, current)
          this.assertHumanTeamRead(currentTeam, actor, 'channel-content-read', jsonObjectSchema.parse(input))
        }
        validate()
        if (input.envelopeSequence < current.stream.firstSequence) {
          throw new TeamError('Envelope is not retained in this channel', 'TEAM_CHANNEL_ENVELOPE_NOT_FOUND')
        }
        const row = (await current.stream.read(input.envelopeSequence - 1, 1))[0]
        validate()
        const record = row === undefined ? undefined : parseChannelRecord(row.value, current.id)
        if (row?.sequence !== input.envelopeSequence || record?.type !== 'channel/envelope' || record.envelope.id !== input.envelopeId) {
          throw new TeamError('Envelope is not retained in this channel', 'TEAM_CHANNEL_ENVELOPE_NOT_FOUND')
        }
        const envelope = record.envelope
        if (envelope.sequence !== input.envelopeSequence) {
          throw new TeamHubError('Envelope sequence disagrees with its WAL row', 'TEAM_CHANNEL_WAL_MALFORMED')
        }
        return freeze(structuredClone(envelope))
      }))
    })
  }

  override async getHumanChannelAdmission(request: ChannelHumanAdmissionGetRequest): Promise<ChannelHumanAdmissionSnapshot> {
    return await this.admit(async () => {
      const { actor, teamId: rawTeamId, ...raw } = request
      const teamId = teamIdSchema.parse(rawTeamId)
      const selection = channelGetRequestSchema.parse(raw)
      const input = { teamId, ...selection }
      const team = await this.ensureTeam(teamId)
      const channel = await this.ensureAttachedChannel(input.channelId)
      return await team.queue.run(() => channel.queue.run(async () => {
        const currentTeam = this.requireLiveTeam(team)
        const current = this.requireLiveChannel(channel)
        if (current.projection.manifest.teamId !== teamId) {
          throw new TeamError('Channel is not attached to the requested Team', 'TEAM_CHANNEL_NOT_FOUND')
        }
        this.assertAttachedChannel(currentTeam, current)
        this.assertHumanTeamRead(currentTeam, actor, 'channel-admission-read', jsonObjectSchema.parse(input))
        const protocolStatus = await this.humanChannelProtocolStatus(current)
        this.assertHumanTeamRead(currentTeam, actor, 'channel-admission-read', jsonObjectSchema.parse(input))
        const expectedNext = this.callChannelAdapter(current, () => current.adapter.expectedNext({
          manifest: freeze(structuredClone(current.projection.manifest)), state: freeze(structuredClone(current.projection.state)),
        }))
        if (expectedNext.kind === 'participant' && !current.projection.manifest.participants.some(member => member.id === expectedNext.participantId)) {
          throw new TeamError('Adapter expects a participant outside this channel', 'TEAM_INVALID_ARGUMENT')
        }
        return freeze(channelHumanAdmissionSnapshotSchema.parse({
          ...this.channelAdmissionSnapshot(current), expectedNext, protocolStatus,
        }))
      }))
    })
  }

  /** Expose built-in control facts without returning arbitrary adapter-owned state. */
  private async humanChannelProtocolStatus(channel: LoadedChannel): Promise<ChannelProtocolStatus> {
    const adapter = channel.projection.manifest.adapter
    if (adapter.version !== 1 || (adapter.type !== 'consult' && adapter.type !== 'discussion')) return { kind: 'other' }
    const state = jsonObjectSchema.parse(channel.projection.state)
    if (adapter.type === 'discussion') {
      return channelProtocolStatusSchema.parse({ kind: 'discussion', turnCount: state['turnCount'],
        maxTurns: state['maxTurns'], speakerPolicy: state['speakerPolicy'] })
    }
    const requestId = state['requestId']
    const request = typeof requestId === 'string' ? await this.findCommittedEnvelope(channel, envelopeIdSchema.parse(requestId)) : undefined
    if ((state['phase'] === 'response' && request === undefined)
      || (request !== undefined && request.kind !== 'request' && request.kind !== 'review-request')) {
      throw new TeamHubError('Consult request state does not match its retained request', 'TEAM_CHANNEL_WAL_MALFORMED')
    }
    return channelProtocolStatusSchema.parse({ kind: 'consult', phase: state['phase'],
      ...request === undefined ? {} : { request: { teamId: request.teamId, channelId: request.channelId,
        envelopeId: request.id, envelopeSequence: request.sequence, review: request.kind === 'review-request',
        ...request.taskId === undefined ? {} : { taskId: request.taskId } } },
    })
  }

  override async getHumanChannelInvitation(request: ChannelHumanInvitationGetRequest): Promise<ChannelHumanInvitationSnapshot> {
    return await this.admit(async () => {
      const { actor, ...raw } = request
      const input = channelGetRequestSchema.parse(raw)
      const channel = await this.ensureAttachedChannel(input.channelId)
      const team = await this.ensureTeam(channel.projection.manifest.teamId)
      return await team.queue.run(() => channel.queue.run(() => {
        const currentTeam = this.requireLiveTeam(team)
        const current = this.requireLiveChannel(channel)
        this.assertAttachedChannel(currentTeam, current)
        const human = this.tryResolveHumanActorProof(actor)
        const expected: TeamHumanActorProofInput = { teamId: team.id, operation: 'channel-invitation-read',
          fence: { kind: 'read' }, payload: jsonObjectSchema.parse(input) }
        const participant = human === undefined ? undefined : currentTeam.projection.participants.get(human.participantId)
        const invitation = human === undefined ? undefined : current.projection.invitations.get(human.participantId)
        if (human === undefined || human.teamId !== team.id || human.operation !== expected.operation
          || !isDeepStrictEqual(human.fence, expected.fence)
          || human.payloadFingerprint !== fingerprintTeamHumanActorPayload(expected)
          || currentTeam.projection.team.phase !== 'active' || currentTeam.projection.team.cancellation !== undefined
          || participant?.kind !== 'human' || participant.phase !== 'active' || participant.owner?.kind !== 'product-principal'
          || invitation?.endpoint.kind !== 'human'
          || !current.projection.manifest.participants.some(member => member.id === human.participantId)) {
          throw new TeamError('Authenticated human does not own this channel invitation', 'TEAM_ACTOR_PROOF_INVALID')
        }
        return Promise.resolve(structuredClone({ channel: this.channelAdmissionSnapshot(current).channel, invitation }))
      }))
    })
  }

  /** Commit exact endpoint consent and activate only after all required acknowledgements are durable. */
  override async acknowledgeChannelInvitation(request: ChannelInvitationAcknowledgeRequest): Promise<ChannelAdmissionSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = channelInvitationAcknowledgeInputSchema.parse(untrustedInput)
      const channel = await this.ensureAttachedChannel(input.channelId)
      const team = await this.ensureTeam(channel.projection.manifest.teamId)
      return await team.queue.run(() => channel.queue.run(async () => {
        const currentTeam = this.requireLiveTeam(team)
        const current = this.requireLiveChannel(channel)
        this.assertAttachedChannel(currentTeam, current)
        const resolve = () => this.resolveChannelInvitationActor(currentTeam, current, actor, input)
        const invitation = resolve()
        if (invitation.revision !== input.revision || invitation.manifestFingerprint !== input.manifestFingerprint) {
          throw new TeamError('Invitation revision or manifest does not match', 'TEAM_CHANNEL_CURSOR_CONFLICT')
        }
        if (!['pending', 'active'].includes(current.projection.phase)) {
          throw new TeamError('Closed channels do not admit endpoint consent', 'TEAM_INVALID_ARGUMENT')
        }
        if (invitation.status === 'acknowledged') {
          if (invitation.acknowledgementKey !== input.idempotencyKey) {
            throw new TeamError('Invitation already has a different acknowledgement key', 'TEAM_CHANNEL_IDEMPOTENCY_CONFLICT')
          }
          return this.channelAdmissionSnapshot(current)
        }
        if (invitation.status !== 'pending' || !['pending', 'active'].includes(current.projection.phase)) {
          throw new TeamError('Channel invitation is no longer pending', 'TEAM_INVALID_ARGUMENT')
        }
        await this.authorizeOrThrow('channel-open', currentTeam.id, {
          operation: 'channel-invitation-acknowledge', channelId: current.id,
          participantId: invitation.participantId, revision: invitation.revision,
        }, invitation.participantId)
        resolve()
        const createdAt = Date.now()
        if (createdAt >= invitation.deadline) throw new TeamError('Channel invitation deadline expired', 'TEAM_INVALID_ARGUMENT')
        const acknowledged: ChannelInvitationSnapshot = { ...invitation, status: 'acknowledged',
          acknowledgementKey: input.idempotencyKey, settledAt: createdAt }
        const records: ChannelRecord[] = [{ type: 'channel/acknowledged',
          sequence: current.projection.cursor + 1, createdAt, invitation: acknowledged }]
        if (current.projection.phase === 'pending'
          && [...current.projection.invitations.values()].every(value =>
            !value.required || value.participantId === invitation.participantId || value.status === 'acknowledged')) {
          records.push({ type: 'channel/phase', sequence: current.projection.cursor + 2, createdAt, phase: 'active' })
        }
        await this.commitChannel(current, records)
        return this.channelAdmissionSnapshot(current)
      }))
    })
  }

  /** Resolve consent from an exact current activation, authenticated human or named endpoint owner. */
  private resolveChannelInvitationActor(
    team: LoadedTeam, channel: LoadedChannel, actor: ChannelInvitationAcknowledgeRequest['actor'],
    input: Omit<ChannelInvitationAcknowledgeRequest, 'actor'>,
  ): ChannelInvitationSnapshot {
    if (team.projection.team.phase !== 'active' || team.projection.team.cancellation !== undefined) {
      throw new TeamError('Team no longer admits endpoint consent', 'TEAM_ACTOR_PROOF_INVALID')
    }
    let participantId: ParticipantId
    let activation: ActivationBindingSnapshot | undefined
    const human = this.tryResolveHumanActorProof(actor)
    if (human !== undefined) {
      const expected: TeamHumanActorProofInput = { teamId: team.id, operation: 'channel-open',
        fence: { kind: 'revision', revision: input.revision }, payload: jsonObjectSchema.parse(input) }
      if (human.teamId !== team.id || human.operation !== expected.operation
        || !isDeepStrictEqual(human.fence, expected.fence)
        || human.payloadFingerprint !== fingerprintTeamHumanActorPayload(expected)) {
        throw new TeamError('Human invitation proof does not match this consent', 'TEAM_ACTOR_PROOF_INVALID')
      }
      participantId = human.participantId
      const participant = team.projection.participants.get(participantId)
      if (participant?.kind !== 'human' || participant.owner?.kind !== 'product-principal') {
        throw new TeamError('Invitation human has no authenticated principal owner', 'TEAM_ACTOR_PROOF_INVALID')
      }
    } else {
      try {
        activation = this.requireCurrentActivationActorBinding(team, actor as TeamActorProof)
        participantId = activation.activation.participantId
      } catch (error: unknown) {
        if (!(error instanceof TeamError) || error.code !== 'TEAM_ACTOR_PROOF_INVALID') throw error
        const resolution = this.requireSystemChannelAdmissionProof(actor as TeamSystemChannelAdmissionProof)
        const scope = resolution.scope
        if (scope.kind !== 'channel-invitation-acknowledge' || scope.teamId !== team.id
          || !isDeepStrictEqual({ channelId: scope.channelId, revision: scope.revision,
            manifestFingerprint: scope.manifestFingerprint, idempotencyKey: scope.idempotencyKey }, input)) {
          throw new TeamError('System endpoint proof does not match this invitation', 'TEAM_ACTOR_PROOF_INVALID')
        }
        participantId = scope.participantId
        const participant = team.projection.participants.get(participantId)
        const expected = channel.projection.invitations.get(participantId)?.endpoint
        const service = participant?.kind === 'service' && expected?.kind === 'service' && expected.name === resolution.sourceName
        const systemHuman = participant?.kind === 'human' && participant.owner?.kind === 'system'
          && resolution.sourceName === 'team-run' && expected?.kind === 'human'
          && channel.projection.manifest.adapter.type === 'direct'
          && [3, 4].includes(channel.projection.manifest.adapter.version)
          && channel.projection.manifest.participants.length === 2
          && channel.projection.manifest.participants.some(member => member.id === participantId && member.role === 'human')
          && channel.projection.manifest.participants.some(member => member.role === 'coordinator'
            && team.projection.participants.get(member.id)?.role === 'coordinator')
        if (!service && !systemHuman) throw new TeamError('Named source does not own this endpoint', 'TEAM_ACTOR_PROOF_INVALID')
      }
    }
    const invitation = channel.projection.invitations.get(participantId)
    if (invitation === undefined || team.projection.participants.get(participantId)?.phase !== 'active'
      || (activation !== undefined && (invitation.endpoint.kind !== 'activation'
        || (invitation.endpoint.activationId !== undefined && invitation.endpoint.activationId !== activation.activation.id)
        || (invitation.endpoint.sessionId !== undefined && invitation.endpoint.sessionId !== activation.sessionId)))) {
      throw new TeamError('Current endpoint cannot acknowledge this invitation', 'TEAM_ACTOR_PROOF_INVALID')
    }
    return invitation
  }

  /** End due invitations under exact Team/channel cursors and the admission owner's clock. */
  override async expireChannelInvitations(request: ChannelInvitationExpireRequest): Promise<ChannelAdmissionSnapshot> {
    return await this.admit(async () => {
      const { actor, ...raw } = request
      const input = channelInvitationExpireInputSchema.parse(raw)
      const channel = await this.ensureAttachedChannel(input.channelId)
      const team = await this.ensureTeam(input.teamId)
      return await team.queue.run(() => channel.queue.run(async () => {
        const currentTeam = this.requireLiveTeam(team)
        const current = this.requireLiveChannel(channel)
        this.assertAttachedChannel(currentTeam, current)
        const resolution = this.requireSystemChannelAdmissionProof(actor)
        const scope = resolution.scope
        if (resolution.sourceName !== 'team-channel-admission' || scope.kind !== 'channel-invitations-expire'
          || !isDeepStrictEqual({ teamId: scope.teamId, channelId: scope.channelId,
            expectedTeamCursor: scope.expectedTeamCursor, expectedChannelCursor: scope.expectedChannelCursor }, input)) {
          throw new TeamError('Invalid channel invitation expiry owner', 'TEAM_ACTOR_PROOF_INVALID')
        }
        this.assertTeamCursor(currentTeam, input.expectedTeamCursor)
        assertChannelCursor(current.projection.cursor, input.expectedChannelCursor)
        if (!['pending', 'active'].includes(current.projection.phase)) return this.channelAdmissionSnapshot(current)
        const pending = [...current.projection.invitations.values()].filter(value => value.status === 'pending')
        const due = pending.filter(value => value.deadline <= scope.now)
        if (due.length === 0) return this.channelAdmissionSnapshot(current)
        const removed = new Set(due.map(value => value.participantId))
        const retained = [...current.projection.invitations.values()]
          .filter(value => !['expired', 'cancelled'].includes(value.status) && !removed.has(value.participantId)).map(value => value.participantId)
        const requiredMissing = due.some(value => value.required)
        const unsupported = !requiredMissing && due.some(value => !this.callChannelAdapter(current, () =>
          current.adapter.allowParticipantRemoval?.({ manifest: freeze(structuredClone(current.projection.manifest)),
            state: freeze(structuredClone(current.projection.state)), participantId: value.participantId,
            retainedParticipantIds: Object.freeze([...retained]) }) === true))
        const terminal = requiredMissing || unsupported
        const reason = {
          code: requiredMissing ? 'TEAM_CHANNEL_REQUIRED_INVITATION_EXPIRED'
            : unsupported ? 'TEAM_CHANNEL_OPTIONAL_REMOVAL_UNSUPPORTED' : 'TEAM_CHANNEL_OPTIONAL_INVITATION_EXPIRED',
          message: requiredMissing ? 'A required endpoint did not acknowledge its channel invitation'
            : unsupported ? 'Channel protocol cannot continue without the optional endpoint' : 'Optional endpoint invitation expired',
        }
        const records: ChannelRecord[] = []
        let sequence = current.projection.cursor
        if (terminal) records.push({ type: 'channel/phase', sequence: ++sequence, createdAt: scope.now, phase: 'closing' })
        for (const invitation of terminal ? pending : due) {
          records.push({ type: 'channel/invitation-ended', sequence: ++sequence, createdAt: scope.now,
            invitation: { ...invitation, status: removed.has(invitation.participantId) ? 'expired' : 'cancelled',
              settledAt: scope.now, reason } })
        }
        if (terminal) records.push({ type: 'channel/closed', sequence: ++sequence, createdAt: scope.now,
          phase: requiredMissing ? 'expired' : 'failed', reason: reason.message })
        await this.commitChannel(current, records)
        return this.channelAdmissionSnapshot(current)
      }))
    })
  }

  /** Return detached consent records alongside the current channel cursor. */
  private channelAdmissionSnapshot(channel: LoadedChannel): ChannelAdmissionSnapshot {
    return freeze(channelAdmissionSnapshotSchema.parse({ channel: this.channelSnapshot(channel),
      invitations: [...channel.projection.invitations.values()] }))
  }

  /**
   * Read one channel after proving its WAL is referenced by its owning Team.
   * @param request - channel identity to read.
   * @returns a detached current channel projection.
   */
  override async getChannel(request: ChannelGetRequest): Promise<ChannelSnapshot> {
    return await this.admit(async () => {
      const input = channelGetRequestSchema.parse(request)
      const channel = await this.ensureAttachedChannel(input.channelId)
      return await channel.queue.run(() => Promise.resolve(this.channelSnapshot(this.requireLiveChannel(channel))))
    })
  }

  /** Read only metadata after current binding, Team attachment and active membership agree under both serializers. */
  override async getChannelForActor(request: ChannelActorGetRequest): Promise<ChannelSnapshot> {
    return await this.admit(async () => {
      const { actor, ...raw } = request
      const issued = this.requireActivationActorProof(actor)
      const input = channelGetRequestSchema.parse(raw)
      const team = await this.ensureTeam(issued.activation.teamId)
      const channel = await this.ensureAttachedChannel(input.channelId)
      if (channel.projection.manifest.teamId !== issued.activation.teamId) {
        throw new TeamError('Channel metadata is outside this bound Team', 'TEAM_ACTOR_PROOF_INVALID')
      }
      return await team.queue.run(() => channel.queue.run(() => {
        const currentTeam = this.requireLiveTeam(team)
        const currentChannel = this.requireLiveChannel(channel)
        const binding = this.requireCurrentActivationActorBinding(currentTeam, actor)
        const participantId = binding.activation.participantId
        if (currentChannel.projection.manifest.teamId !== currentTeam.id
          || !currentTeam.projection.channelIds.has(currentChannel.id)
          || currentTeam.projection.participants.get(participantId)?.phase !== 'active'
          || !currentChannel.projection.manifest.participants.some(member => member.id === participantId)) {
          throw new TeamError('Channel metadata is not visible to this current binding', 'TEAM_ACTOR_PROOF_INVALID')
        }
        return Promise.resolve(this.channelSnapshot(currentChannel))
      }))
    })
  }

  /**
   * Return one bounded WAL suffix and the current channel projection.
   * @param request - channel and exclusive cursor from the last observed page.
   * @returns detached records in storage order plus current channel state.
   */
  override async readChannel(request: ChannelReadRequest): Promise<ChannelReadResult> {
    return await this.admit(async () => {
      const input = channelReadRequestSchema.parse(request)
      const channel = await this.ensureAttachedChannel(input.channelId)
      return await channel.queue.run(async () => {
        const current = this.requireLiveChannel(channel)
        const records = await this.readChannelRecords(current, input.afterCursor)
        const view = current.projection.manifest.viewPolicy === undefined
          ? undefined
          : this.projectChannelView(
            current,
            input.afterCursor === EMPTY_CURSOR ? records : await this.readChannelRecords(current, EMPTY_CURSOR),
          )
        return freeze(channelReadResultSchema.parse({
          channel: this.channelSnapshot(current),
          records,
          ...view === undefined ? {} : { view },
        }))
      })
    })
  }

  /**
   * Read one bounded channel-WAL page without rebuilding the complete history.
   * @param request - channel identity, exclusive cursor, and requested page size.
   * @returns the detached channel projection, records, optional view, and continuation cursor.
   */
  override async readChannelPage(request: ChannelReadPageRequest): Promise<ChannelReadPageResult> {
    return await this.admit(async () => {
      const input = channelReadPageRequestSchema.parse(request)
      const channel = await this.ensureAttachedChannel(input.channelId)
      return await channel.queue.run(async () => {
        const current = this.requireLiveChannel(channel)
        const page = await this.readChannelRecordPage(current, input.afterCursor, this.pageLimit(input.limit))
        const view = current.projection.manifest.viewPolicy === undefined
          ? undefined
          : this.projectChannelView(current, page.records)
        return freeze(channelReadPageResultSchema.parse({
          channel: this.channelSnapshot(current),
          records: page.records,
          ...view === undefined ? {} : { view },
          ...page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor },
        }))
      })
    })
  }

  /** Compact a terminal channel WAL only after delivery, audit, and checkpoint watermarks settle. */
  override async compactChannel(request: TeamChannelCompactRequest): Promise<TeamChannelCompactResult> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamChannelCompactInputSchema.parse(untrustedInput)
      const initial = this.requireSystemMaintenanceProof(actor)
      if (initial.scope.kind !== 'scheduler-channel-compaction'
        || initial.scope.teamId !== input.teamId
        || initial.scope.channelId !== input.channelId) {
        this.rejectMaintenanceActor()
      }
      const team = await this.ensureTeam(input.teamId)
      const channel = await this.ensureAttachedChannel(input.channelId)
      return await team.queue.run(async () => await channel.queue.run(async () => {
        const currentTeam = this.requireLiveTeam(team)
        const currentChannel = this.requireLiveChannel(channel)
        const actorName = this.resolveChannelMaintenanceAuthority(currentTeam, currentChannel, actor, input)
        this.assertAttachedChannel(currentTeam, currentChannel)
        await this.authorizeOrThrow('close', input.teamId, {
          phase: 'compact',
          channelId: input.channelId,
          expectedCursor: input.expectedCursor,
          throughSequence: input.throughSequence,
          actor: { kind: 'system', name: actorName },
        })
        this.resolveChannelMaintenanceAuthority(currentTeam, currentChannel, actor, input)
        if (currentChannel.projection.phase !== 'closed'
          && currentChannel.projection.phase !== 'expired'
          && currentChannel.projection.phase !== 'failed') {
          throw new TeamError(`channel '${currentChannel.id}' is not terminal`, 'TEAM_INVALID_ARGUMENT')
        }
        if (pendingDeliveryCount(currentChannel.projection) > 0) {
          throw new TeamError(`channel '${currentChannel.id}' retains pending deliveries`, 'TEAM_CHANNEL_BACKPRESSURE')
        }
        assertChannelCursor(currentChannel.projection.cursor, input.expectedCursor)
        assertReplayWatermark(currentChannel.projection, input.throughSequence, currentChannel.id)
        if (input.throughSequence >= currentChannel.projection.cursor) {
          throw new TeamError(
            `channel '${currentChannel.id}' compaction must retain its terminal WAL entry`,
            'TEAM_INVALID_ARGUMENT',
          )
        }
        if (currentTeam.projection.team.childRun?.channelId === currentChannel.id) {
          throw new TeamError('Bound child result consults retain their request and service response evidence', 'TEAM_INVALID_ARGUMENT')
        }
        const finalAdmission = currentTeam.projection.finalAdmission
        if (finalAdmission?.channelId === currentChannel.id && input.throughSequence >= finalAdmission.envelopeSequence) {
          throw new TeamError('channel compaction would remove an admitted final result', 'TEAM_INVALID_ARGUMENT')
        }
        if ([...currentChannel.projection.summaries.values()].some(summary => input.throughSequence >= summary.coveredSequenceRange.from)) {
          throw new TeamError('Channel compaction must retain the source range required by its durable summaries', 'TEAM_INVALID_ARGUMENT')
        }
        await this.assertCausationReachability(currentChannel, input.throughSequence)
        this.resolveChannelMaintenanceAuthority(currentTeam, currentChannel, actor, input)
        const audit = await this.repairAuditForRead(
          input.teamId,
          'channel',
          currentChannel.stream,
          currentChannel.id,
        )
        this.resolveChannelMaintenanceAuthority(currentTeam, currentChannel, actor, input)
        await this.maybeCheckpointChannel(currentChannel, true)
        const checkpoint = await currentChannel.stream.readCheckpoint()
        if (checkpoint?.sequence !== currentChannel.projection.cursor) {
          throw new TeamHubError(
            `channel '${currentChannel.id}' has no checkpoint at its compaction cursor`,
            'TEAM_CHANNEL_WAL_MALFORMED',
          )
        }
        const auditThrough = currentChannel.projection.cursor - this.config.auditRetentionTail - 1
        if (auditThrough >= 0) {
          this.resolveChannelMaintenanceAuthority(currentTeam, currentChannel, actor, input)
          await audit.writeCheckpoint({
            sequence: currentChannel.projection.cursor,
            value: { kind: 'channel-audit-projection', channelId: currentChannel.id },
          })
          this.resolveChannelMaintenanceAuthority(currentTeam, currentChannel, actor, input)
          await audit.compact({
            throughSequence: auditThrough,
            expectedCheckpointSequence: currentChannel.projection.cursor,
          })
        }
        this.resolveChannelMaintenanceAuthority(currentTeam, currentChannel, actor, input)
        await currentChannel.stream.compact({
          throughSequence: input.throughSequence,
          expectedCheckpointSequence: currentChannel.projection.cursor,
        })
        this.incrementMetric('channelCompactions')
        return freeze(teamChannelCompactResultSchema.parse({
          channel: this.channelSnapshot(currentChannel),
          compactedThrough: input.throughSequence,
          ...auditThrough >= 0 ? { auditCompactedThrough: auditThrough } : {},
        }))
      }))
    })
  }

  /** Resolve one scheduler proof to the exact channel-WAL prefix it may compact. */
  private resolveChannelMaintenanceAuthority(
    team: LoadedTeam,
    channel: LoadedChannel,
    actor: TeamChannelCompactRequest['actor'],
    input: Omit<TeamChannelCompactRequest, 'actor'>,
  ): string {
    const resolution = this.requireSystemMaintenanceProof(actor)
    const scope = resolution.scope
    if (resolution.sourceName !== TEAM_SCHEDULER_MAINTENANCE_PROOF_SOURCE
      || scope.kind !== 'scheduler-channel-compaction'
      || scope.teamId !== team.id
      || scope.channelId !== channel.id
      || scope.expectedCursor !== input.expectedCursor
      || scope.throughSequence !== input.throughSequence) {
      this.rejectMaintenanceActor()
    }
    return TEAM_SCHEDULER_MAINTENANCE_PROOF_SOURCE
  }

  /** Reject a prefix that would strand a retained Envelope's causal predecessor. */
  private async assertCausationReachability(channel: LoadedChannel, throughSequence: number): Promise<void> {
    if (channel.stream.firstSequence > throughSequence) return
    const retainedEnvelopeIds = new Set<EnvelopeId>()
    let cursor = throughSequence
    while (cursor < channel.projection.cursor) {
      const entries = await this.readChannelEntries(channel, cursor, this.config.recoveryPageSize)
      if (entries.length === 0) {
        throw new TeamHubError(
          `channel '${channel.id}' compaction range ended before its current cursor`,
          'TEAM_CHANNEL_WAL_MALFORMED',
        )
      }
      for (const entry of entries) {
        if (entry.sequence !== cursor + 1) {
          throw new TeamHubError(
            `channel '${channel.id}' compaction range has a cursor gap at ${entry.sequence}`,
            'TEAM_CHANNEL_WAL_MALFORMED',
          )
        }
        const record = parseChannelRecord(entry.value, channel.id)
        if (record.type === 'channel/envelope') {
          if (record.envelope.causationId !== undefined && !retainedEnvelopeIds.has(record.envelope.causationId)) {
            throw new TeamError(
              `channel '${channel.id}' compaction would remove causal predecessor '${record.envelope.causationId}'`,
              'TEAM_INVALID_ARGUMENT',
            )
          }
          retainedEnvelopeIds.add(record.envelope.id)
        }
        cursor = entry.sequence
      }
    }
  }

  /** Compact a terminal Team journal only after its audit and checkpoint watermarks settle. */
  override async compactTeam(request: TeamJournalCompactRequest): Promise<TeamJournalCompactResult> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamJournalCompactInputSchema.parse(untrustedInput)
      const initial = this.requireSystemMaintenanceProof(actor)
      if (initial.scope.kind !== 'scheduler-team-journal-compaction' || initial.scope.teamId !== input.teamId) {
        this.rejectMaintenanceActor()
      }
      const team = await this.ensureTeam(input.teamId)
      return await team.queue.run(async () => {
        const current = this.requireLiveTeam(team)
        const actorName = this.resolveTeamMaintenanceAuthority(current, actor, input)
        await this.authorizeOrThrow('close', input.teamId, {
          phase: 'compact',
          stream: 'team-journal',
          expectedCursor: input.expectedCursor,
          throughSequence: input.throughSequence,
          actor: { kind: 'system', name: actorName },
        })
        this.resolveTeamMaintenanceAuthority(current, actor, input)
        if (current.projection.team.phase !== 'completed'
          && current.projection.team.phase !== 'failed'
          && current.projection.team.phase !== 'cancelled') {
          throw new TeamError(`Team '${current.id}' is not terminal`, 'TEAM_INVALID_ARGUMENT')
        }
        this.assertTeamCursor(current, input.expectedCursor)
        if (input.throughSequence >= current.projection.team.cursor) {
          throw new TeamError(
            `Team '${current.id}' journal compaction must retain its terminal record`,
            'TEAM_INVALID_ARGUMENT',
          )
        }
        this.resolveTeamMaintenanceAuthority(current, actor, input)
        const audit = await this.repairAuditForRead(input.teamId, 'team', current.stream)
        this.resolveTeamMaintenanceAuthority(current, actor, input)
        await this.maybeCheckpointTeam(current, true)
        const checkpoint = await current.stream.readCheckpoint()
        if (checkpoint?.sequence !== current.projection.team.cursor) {
          throw new TeamHubError(
            `Team '${current.id}' has no checkpoint at its compaction cursor`,
            'TEAM_JOURNAL_MALFORMED',
          )
        }
        const auditThrough = Math.max(
          input.throughSequence,
          current.projection.team.cursor - this.config.auditRetentionTail - 1,
        )
        if (auditThrough >= 0) {
          this.resolveTeamMaintenanceAuthority(current, actor, input)
          await audit.writeCheckpoint({
            sequence: current.projection.team.cursor,
            value: { kind: 'team-audit-projection', teamId: current.id },
          })
          this.resolveTeamMaintenanceAuthority(current, actor, input)
          await audit.compact({
            throughSequence: auditThrough,
            expectedCheckpointSequence: current.projection.team.cursor,
          })
        }
        this.resolveTeamMaintenanceAuthority(current, actor, input)
        await current.stream.compact({
          throughSequence: input.throughSequence,
          expectedCheckpointSequence: current.projection.team.cursor,
        })
        this.incrementMetric('teamCompactions')
        return freeze(teamJournalCompactResultSchema.parse({
          team: this.teamState(current.projection),
          compactedThrough: input.throughSequence,
          ...auditThrough >= 0 ? { auditCompactedThrough: auditThrough } : {},
        }))
      })
    })
  }

  /** Resolve one scheduler proof to the exact Team-journal prefix it may compact. */
  private resolveTeamMaintenanceAuthority(
    team: LoadedTeam,
    actor: TeamJournalCompactRequest['actor'],
    input: Omit<TeamJournalCompactRequest, 'actor'>,
  ): string {
    const resolution = this.requireSystemMaintenanceProof(actor)
    const scope = resolution.scope
    if (resolution.sourceName !== TEAM_SCHEDULER_MAINTENANCE_PROOF_SOURCE
      || scope.kind !== 'scheduler-team-journal-compaction'
      || scope.teamId !== team.id
      || scope.expectedCursor !== input.expectedCursor
      || scope.throughSequence !== input.throughSequence) {
      this.rejectMaintenanceActor()
    }
    return TEAM_SCHEDULER_MAINTENANCE_PROOF_SOURCE
  }

  /** Reject every forged, stale, cross-scope, or unsupported maintenance actor uniformly. */
  private rejectMaintenanceActor(): never {
    throw new TeamError('Team maintenance actor is invalid for this compaction', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Read and validate a complete or suffix channel WAL in bounded pages. */
  private async readChannelRecords(channel: LoadedChannel, afterCursor: number): Promise<ChannelRecord[]> {
    const records: ChannelRecord[] = []
    let cursor = afterCursor
    while (true) {
      const entries = await this.readChannelEntries(channel, cursor, this.config.recoveryPageSize)
      if (entries.length === 0) break
      for (const entry of entries) {
        /* v8 ignore next 3 -- LogStream returns contiguous pages; this protects nonconforming providers. */
        if (entry.sequence !== cursor + 1) {
          throw new TeamHubError(`channel '${channel.id}' WAL has a cursor gap at ${entry.sequence}`, 'TEAM_CHANNEL_WAL_MALFORMED')
        }
        cursor = entry.sequence
        const record = parseChannelRecord(entry.value, channel.id)
        /* v8 ignore next 3 -- persisted WAL records duplicate their storage sequence by Hub format. */
        if (channelRecordCursor(record) !== entry.sequence) {
          throw new TeamHubError(`channel '${channel.id}' record cursor disagrees with storage`, 'TEAM_CHANNEL_WAL_MALFORMED')
        }
        if (record.type === 'channel/summary') {
          await this.validateChannelSummaryRecord(channel.stream, channel.id, record, channel.projection.manifest)
        }
        records.push(record)
      }
      if (entries.length < this.config.recoveryPageSize) break
    }
    return records
  }

  /** Render one bounded immutable model view for a claimed non-direct delivery. */
  private async renderChannelDeliveryView(
    team: LoadedTeam,
    channel: LoadedChannel,
    pending: PendingChannelDelivery,
    triggeringEnvelopeId: EnvelopeId,
  ): Promise<NonNullable<ChannelDeliveryClaim['view']>> {
    const manifest = channel.projection.manifest
    const viewPolicyRef = manifest.viewPolicy
    if (viewPolicyRef === undefined) {
      throw new TeamHubError(`channel '${channel.id}' has no model view policy`, 'TEAM_CHANNEL_WAL_MALFORMED')
    }
    this.assertChannelViewBound(team, manifest)
    // The protocol adapters in this path have a frozen turn bound. Reading
    // their retained prefix lets the policy select its own recent or summary
    // window without confusing the storage page size with that semantic bound.
    const firstSequence = channel.stream.firstSequence
    const records = await this.readChannelRecordRange(
      channel,
      firstSequence,
      pending.envelopeSequence - firstSequence + 1,
    )
    const triggering = records.find(record => record.type === 'channel/envelope' && record.envelope.id === triggeringEnvelopeId)
    if (triggering === undefined || triggering.type !== 'channel/envelope') {
      throw new TeamHubError(
        `channel '${channel.id}' does not retain triggering Envelope '${triggeringEnvelopeId}'`,
        'TEAM_CHANNEL_WAL_MALFORMED',
      )
    }
    const expectedNext = await this.projectExpectedNextAtDelivery(channel, pending.envelopeSequence)
    const policyView = this.projectChannelView(channel, records)
    const sourceEnvelopeIds = this.channelViewSourceEnvelopeIds(
      channel,
      policyView,
      records,
      triggeringEnvelopeId,
    )
    // Only the view policy supplies message content; adapter history would bypass its visibility window.
    const text = JSON.stringify({
      teamId: manifest.teamId,
      channelId: manifest.id,
      adapter: { ...manifest.adapter, expectedNext },
      view: policyView,
    })
    const maxViewBytes = this.teamLimit(team.projection, 'maxChannelViewBytes', this.config.maxChannelViewBytes)
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > maxViewBytes) {
      throw new TeamError(
        `channel '${channel.id}' model view is ${bytes} bytes, exceeding maxChannelViewBytes ${maxViewBytes}`,
        'TEAM_CHANNEL_BACKPRESSURE',
      )
    }
    return {
      teamId: manifest.teamId,
      channelId: manifest.id,
      adapter: { ...manifest.adapter },
      viewPolicy: { ...viewPolicyRef },
      triggeringEnvelopeId,
      sourceEnvelopeIds,
      delivery: pending.delivery,
      content: [{ type: 'text', text }],
      ...triggering.envelope.causationId === undefined ? {} : { causationId: triggering.envelope.causationId },
      ...triggering.envelope.taskId === undefined ? {} : { taskId: triggering.envelope.taskId },
      ...channelViewReviewFence(triggering.envelope),
    }
  }

  /** Validate the provenance selected by a built-in policy, or retain all source Envelopes for a custom one. */
  private channelViewSourceEnvelopeIds(
    channel: LoadedChannel,
    policyView: JsonObject,
    records: readonly ChannelRecord[],
    triggeringEnvelopeId: EnvelopeId,
  ): EnvelopeId[] {
    const envelopeIds = records.flatMap(record => record.type === 'channel/envelope' ? [record.envelope.id] : [])
    const selected = policyView['messages']
    if (channel.projection.manifest.viewPolicy?.type === 'summarized-window') {
      const sourceEnvelopeIds = jsonStringArray(policyView['sourceEnvelopeIds'])
      if (sourceEnvelopeIds.length === 0 || !selectedNotEmpty(selected)) {
        throw new TeamHubError(
          `channel '${channel.id}' summarized view has no durable source`,
          'TEAM_CHANNEL_WAL_MALFORMED',
        )
      }
      return this.validateChannelViewSourceIds(channel, sourceEnvelopeIds, envelopeIds, triggeringEnvelopeId)
    }
    if (selected !== undefined) {
      if (!Array.isArray(selected) || selected.length === 0) {
        throw new TeamHubError(
          `channel '${channel.id}' view policy selected no durable source`,
          'TEAM_CHANNEL_WAL_MALFORMED',
        )
      }
      const selectedIds = selected.flatMap((item) => {
        if (!isJsonObject(item) || typeof item['id'] !== 'string' || item['id'].length === 0) return []
        return [envelopeIdSchema.parse(item['id'])]
      })
      if (selectedIds.length !== selected.length) {
        throw new TeamHubError(
          `channel '${channel.id}' view policy returned an invalid message provenance`,
          'TEAM_CHANNEL_WAL_MALFORMED',
        )
      }
      return this.validateChannelViewSourceIds(channel, selectedIds, envelopeIds, triggeringEnvelopeId)
    }
    return this.validateChannelViewSourceIds(channel, envelopeIds, envelopeIds, triggeringEnvelopeId)
  }

  /** Ensure a policy's selected Envelope identities are retained, ordered, and causal to its trigger. */
  private validateChannelViewSourceIds(
    channel: LoadedChannel,
    sourceEnvelopeIds: readonly EnvelopeId[],
    retainedEnvelopeIds: readonly EnvelopeId[],
    triggeringEnvelopeId: EnvelopeId,
  ): EnvelopeId[] {
    const retained = new Set(retainedEnvelopeIds)
    if (retained.size !== retainedEnvelopeIds.length) {
      throw new TeamHubError(
        `channel '${channel.id}' view source WAL repeats an Envelope identity`,
        'TEAM_CHANNEL_WAL_MALFORMED',
      )
    }
    let previousIndex = -1
    for (const envelopeId of sourceEnvelopeIds) {
      const index = retainedEnvelopeIds.indexOf(envelopeId)
      if (!retained.has(envelopeId) || index <= previousIndex) {
        throw new TeamHubError(
          `channel '${channel.id}' view policy returned non-causal Envelope provenance`,
          'TEAM_CHANNEL_WAL_MALFORMED',
        )
      }
      previousIndex = index
    }
    if (sourceEnvelopeIds.length === 0 || sourceEnvelopeIds.at(-1) !== triggeringEnvelopeId
      || new Set(sourceEnvelopeIds).size !== sourceEnvelopeIds.length) {
      throw new TeamHubError(
        `channel '${channel.id}' cannot render durable provenance for Envelope '${triggeringEnvelopeId}'`,
        'TEAM_CHANNEL_WAL_MALFORMED',
      )
    }
    return [...sourceEnvelopeIds]
  }

  /** Rebuild adapter state through the triggering Envelope without exposing later WAL state. */
  private async projectExpectedNextAtDelivery(
    channel: LoadedChannel,
    throughSequence: number,
  ): Promise<ChannelExpectedNext> {
    if (channel.stream.firstSequence !== 0) {
      throw new TeamHubError(
        `channel '${channel.id}' lacks a retained state anchor for delivery rendering`,
        'TEAM_CHANNEL_WAL_MALFORMED',
      )
    }
    const history = await this.readChannelRecordRange(channel, 0, throughSequence + 1)
    let projection: ChannelProjection | undefined
    try {
      for (const record of history) {
        const sequence = channelRecordCursor(record)
        if (sequence > throughSequence) break
        projection = foldChannelRecord(projection, record, sequence, channel.id, channel.adapter)
      }
    } catch (error: unknown) {
      throw new TeamHubError(
        `channel '${channel.id}' cannot reconstruct adapter state for a delivery view`,
        'TEAM_CHANNEL_WAL_MALFORMED',
        { cause: error },
      )
    }
    if (projection === undefined || projection.cursor !== throughSequence) {
      throw new TeamHubError(
        `channel '${channel.id}' has no complete state at delivery cursor ${String(throughSequence)}`,
        'TEAM_CHANNEL_WAL_MALFORMED',
      )
    }
    return this.callChannelAdapter(channel, () => channel.adapter.expectedNext({
      manifest: freeze(structuredClone(channel.projection.manifest)),
      state: freeze(structuredClone(projection.state)),
    }))
  }

  /** Read exactly one bounded source range for summary provenance validation. */
  private async readChannelRecordRange(
    channel: LoadedChannel,
    from: number,
    count: number,
  ): Promise<ChannelRecord[]> {
    const records: ChannelRecord[] = []
    let cursor = from - 1
    while (records.length < count) {
      const batchLimit = Math.min(this.config.recoveryPageSize, count - records.length)
      const entries = await this.readChannelEntries(channel, cursor, batchLimit)
      if (entries.length === 0) break
      for (const entry of entries) {
        if (entry.sequence !== cursor + 1) {
          throw new TeamHubError(`channel '${channel.id}' summary source has a cursor gap at ${entry.sequence}`, 'TEAM_CHANNEL_WAL_MALFORMED')
        }
        cursor = entry.sequence
        const record = parseChannelRecord(entry.value, channel.id)
        if (channelRecordCursor(record) !== entry.sequence) {
          throw new TeamHubError(`channel '${channel.id}' summary source cursor disagrees with storage`, 'TEAM_CHANNEL_WAL_MALFORMED')
        }
        if (record.type === 'channel/summary') {
          await this.validateChannelSummaryRecord(channel.stream, channel.id, record, channel.projection.manifest)
        }
        records.push(record)
      }
      if (entries.length < batchLimit) break
    }
    if (records.length !== count) {
      throw new TeamHubError(`channel '${channel.id}' summary source range is not fully committed`, 'TEAM_CHANNEL_WAL_MALFORMED')
    }
    return records
  }

  /** Verify a durable summary against the authoritative WAL range it claims to cover. */
  private async validateChannelSummaryRecord(
    stream: HubLogStream,
    channelId: ChannelId,
    summary: ChannelSummaryRecord,
    manifest: ChannelManifest,
  ): Promise<void> {
    const { from, to } = summary.coveredSequenceRange
    const count = to - from + 1
    if (from < stream.firstSequence || !Number.isSafeInteger(count) || count < 1 || to >= summary.sequence) {
      throw new TeamHubError(
        `channel '${channelId}' summary '${summary.idempotencyKey}' has an unavailable source range`,
        'TEAM_CHANNEL_WAL_MALFORMED',
      )
    }
    const sourceEnvelopeIds: EnvelopeId[] = []
    const sourceEnvelopes: TeamEnvelope[] = []
    const sourceRecords: ChannelEnvelopeRecord[] = []
    let cursor = from - 1
    let read = 0
    while (read < count) {
      const limit = Math.min(this.config.recoveryPageSize, count - read)
      const entries = await stream.read(cursor, limit)
      if (entries.length === 0) {
        throw new TeamHubError(
          `channel '${channelId}' summary '${summary.idempotencyKey}' source range is not fully committed`,
          'TEAM_CHANNEL_WAL_MALFORMED',
        )
      }
      for (const entry of entries) {
        if (entry.sequence !== cursor + 1) {
          throw new TeamHubError(
            `channel '${channelId}' summary source has a cursor gap at ${entry.sequence}`,
            'TEAM_CHANNEL_WAL_MALFORMED',
          )
        }
        const record = parseChannelRecord(entry.value, channelId)
        if (channelRecordCursor(record) !== entry.sequence) {
          throw new TeamHubError(
            `channel '${channelId}' summary source cursor disagrees with storage`,
            'TEAM_CHANNEL_WAL_MALFORMED',
          )
        }
        if (record.type === 'channel/envelope') {
          sourceEnvelopeIds.push(record.envelope.id)
          sourceEnvelopes.push(record.envelope)
          sourceRecords.push(record)
        }
        cursor = entry.sequence
        read += 1
      }
      if (entries.length < limit) break
    }
    if (read !== count) {
      throw new TeamHubError(
        `channel '${channelId}' summary '${summary.idempotencyKey}' source range is not fully committed`,
        'TEAM_CHANNEL_WAL_MALFORMED',
      )
    }
    if (!isDeepStrictEqual(sourceEnvelopeIds, summary.sourceEnvelopeIds)) {
      throw new TeamHubError(
        `channel '${channelId}' summary '${summary.idempotencyKey}' has invalid source Envelope provenance`,
        'TEAM_CHANNEL_WAL_MALFORMED',
      )
    }
    if (!channelSummarySourcesAreShared(manifest, sourceRecords)) {
      throw new TeamHubError(`channel '${channelId}' summary contains sources hidden from a channel member`, 'TEAM_CHANNEL_WAL_MALFORMED')
    }
    if (fingerprintChannelSummarySources(sourceEnvelopes) !== summary.sourceFingerprint) {
      throw new TeamHubError(`channel '${channelId}' summary '${summary.idempotencyKey}' source content fingerprint differs`, 'TEAM_CHANNEL_WAL_MALFORMED')
    }
  }

  /** Read at most one bounded page plus one look-ahead record from a channel WAL. */
  private async readChannelRecordPage(
    channel: LoadedChannel,
    afterCursor: number,
    limit: number,
  ): Promise<{ readonly records: readonly ChannelRecord[]; readonly nextCursor?: number }> {
    const records: ChannelRecord[] = []
    let cursor = afterCursor
    let hasMore = false
    while (records.length <= limit) {
      const batchLimit = Math.min(this.config.recoveryPageSize, limit + 1 - records.length)
      const entries = await this.readChannelEntries(channel, cursor, batchLimit)
      if (entries.length === 0) break
      for (const entry of entries) {
        /* v8 ignore next 3 -- LogStream returns contiguous pages; this protects nonconforming providers. */
        if (entry.sequence !== cursor + 1) {
          throw new TeamHubError(`channel '${channel.id}' WAL has a cursor gap at ${entry.sequence}`, 'TEAM_CHANNEL_WAL_MALFORMED')
        }
        cursor = entry.sequence
        const record = parseChannelRecord(entry.value, channel.id)
        /* v8 ignore next 3 -- persisted WAL records duplicate their storage sequence by Hub format. */
        if (channelRecordCursor(record) !== entry.sequence) {
          throw new TeamHubError(`channel '${channel.id}' record cursor disagrees with storage`, 'TEAM_CHANNEL_WAL_MALFORMED')
        }
        if (record.type === 'channel/summary') {
          await this.validateChannelSummaryRecord(channel.stream, channel.id, record, channel.projection.manifest)
        }
        records.push(record)
        if (records.length > limit) {
          hasMore = true
          break
        }
      }
      if (hasMore || entries.length < batchLimit) break
    }
    const pageRecords = records.slice(0, limit)
    const lastRecord = pageRecords.at(-1)
    return {
      records: pageRecords,
      ...hasMore && lastRecord !== undefined ? { nextCursor: channelRecordCursor(lastRecord) } : {},
    }
  }

  /** Read a channel WAL page and turn a compacted-prefix miss into a typed Team error. */
  private async readChannelEntries(
    channel: LoadedChannel,
    afterCursor: number,
    limit: number,
  ): Promise<readonly { readonly sequence: number; readonly value: unknown }[]> {
    try {
      return await channel.stream.read(afterCursor, limit)
    } catch (error: unknown) {
      if (isCompacted(error)) {
        throw new TeamError(
          `channel '${channel.id}' no longer retains cursor ${afterCursor}`,
          'TEAM_CHANNEL_COMPACTED',
          {
            cause: error,
            details: {
              teamId: channel.projection.manifest.teamId,
              channelId: channel.id,
              firstCursor: channel.stream.firstSequence,
            },
          },
        )
      }
      throw error
    }
  }

  /** Bound product-facing page responses by the provider's configured recovery read size. */
  private pageLimit(requested: number): number {
    return Math.min(requested, this.config.recoveryPageSize)
  }

  /**
   * Compare-and-set an active channel through closing into its terminal record.
   * @param request - channel cursor and optional closure reason.
   * @returns the detached terminal channel projection.
   */
  override async closeChannel(request: ChannelCloseRequest): Promise<ChannelSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = channelCloseInputSchema.parse(untrustedInput)
      const human = this.tryResolveHumanActorProof(actor)
      const authority = human === undefined
        ? this.requireChannelLifecycleAuthority(actor as TeamSystemChannelLifecycleProof, input)
        : undefined
      const channel = await this.ensureAttachedChannel(input.channelId)
      const team = await this.ensureTeam(channel.projection.manifest.teamId)
      return await team.queue.run(async () => await channel.queue.run(async () => {
        const currentTeam = this.requireLiveTeam(team)
        const currentChannel = this.requireLiveChannel(channel)
        if (human !== undefined) {
          const humanActorId = this.resolveHumanChannelCloseAuthority(
            currentTeam,
            currentChannel,
            actor as TeamHumanActorProof,
            input,
          )
          return await this.closeChannelOwned(channel, input, {
            operation: 'human-channel-close',
          }, humanActorId, () => {
            this.resolveHumanChannelCloseAuthority(
              this.requireLiveTeam(team),
              this.requireLiveChannel(channel),
              actor as TeamHumanActorProof,
              input,
            )
          })
        }
        if (authority === undefined) {
          throw new TeamError('Channel lifecycle proof is invalid for the current channel attachment', 'TEAM_ACTOR_PROOF_INVALID')
        }
        const scope = authority.revalidate()
        if (scope.teamId !== currentTeam.id
          || !currentTeam.projection.channelIds.has(currentChannel.id)
          || currentChannel.projection.manifest.teamId !== currentTeam.id) {
          throw new TeamError('Channel lifecycle proof is invalid for the current channel attachment', 'TEAM_ACTOR_PROOF_INVALID')
        }
        return await this.closeChannelOwned(channel, input, {
          operation: 'channel-lifecycle',
          channelId: input.channelId,
          expectedCursor: input.expectedCursor,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          sourceName: authority.sourceName,
        }, undefined, () => {
          const currentScope = authority.revalidate()
          const committedTeam = this.requireLiveTeam(team)
          const committedChannel = this.requireLiveChannel(channel)
          if (currentScope.teamId !== committedTeam.id
            || !committedTeam.projection.channelIds.has(committedChannel.id)
            || committedChannel.projection.manifest.teamId !== committedTeam.id) {
            throw new TeamError('Channel lifecycle proof is invalid for the current channel attachment', 'TEAM_ACTOR_PROOF_INVALID')
          }
        })
      }))
    })
  }

  /** Close one exact scheduler wake channel only while no current task lease owns it. */
  override async closeSchedulerFailedWakeChannel(request: SchedulerFailedWakeChannelCloseRequest): Promise<ChannelSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = schedulerFailedWakeChannelCloseInputSchema.parse(untrustedInput)
      this.schedulerFailedWakeChannelCloseScope(actor, input)
      const team = await this.ensureTeam(input.teamId)
      const channel = await this.ensureChannel(input.channelId)
      await team.queue.run(async () => {
        await channel.queue.run(() => {
          this.resolveSchedulerFailedWakeChannelCloseAuthority(this.requireLiveTeam(team), channel, actor, input)
          return Promise.resolve()
        })
      })
      return await team.queue.run(async () => await channel.queue.run(async () => {
        this.resolveSchedulerFailedWakeChannelCloseAuthority(this.requireLiveTeam(team), channel, actor, input)
        return await this.closeChannelOwned(channel, {
          channelId: input.channelId,
          expectedCursor: input.expectedChannelCursor,
          reason: 'Task assignment did not commit',
        }, {
          operation: 'scheduler-failed-wake-channel-close',
          taskId: input.taskId,
          participantId: input.participantId,
          activationId: input.activationId,
          sessionId: input.sessionId,
          expectedChannelCursor: input.expectedChannelCursor,
          sourceName: TEAM_SCHEDULER_CHANNEL_PROOF_SOURCE,
        }, undefined, () => {
          this.resolveSchedulerFailedWakeChannelCloseAuthority(this.requireLiveTeam(team), channel, actor, input)
        })
      }))
    })
  }

  /** Close one exact active channel through the durable TeamRun cancellation-cleanup authority. */
  override async closeTeamCancellationChannel(request: TeamCancellationChannelCloseRequest): Promise<ChannelSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamCancellationChannelCloseInputSchema.parse(untrustedInput)
      this.cancellationChannelCleanupScope(actor, input)
      const team = await this.ensureTeam(input.teamId)
      const channel = await this.ensureAttachedChannel(input.channelId)
      await team.queue.run(async () => {
        await channel.queue.run(() => {
          const currentTeam = this.requireLiveTeam(team)
          this.resolveCancellationChannelCleanupAuthority(currentTeam, channel, actor, input)
          return Promise.resolve()
        })
      })
      await this.repairPendingParentCharges(team)
      return await team.queue.run(async () => await channel.queue.run(async () => {
        const currentTeam = this.requireLiveTeam(team)
        this.resolveCancellationChannelCleanupAuthority(currentTeam, channel, actor, input)
        this.assertNoPendingParentCharges(currentTeam.projection)
        this.assertCancellationResourcesSettled(currentTeam.projection)
        this.assertCancellationDeliveriesSettled([channel])
        return await this.closeChannelOwned(channel, {
          channelId: input.channelId,
          expectedCursor: input.expectedCursor,
          reason: input.reason,
        }, {
          operation: 'cancellation-channel-cleanup',
          cancellationIdempotencyKey: input.cancellationIdempotencyKey,
          cancellationRequestedAt: input.cancellationRequestedAt,
          expectedTeamCursor: input.expectedTeamCursor,
          channelId: input.channelId,
          expectedCursor: input.expectedCursor,
          reason: input.reason,
          sourceName: TEAM_RUN_CANCELLATION_CLEANUP_PROOF_SOURCE,
        }, undefined, () => {
          const current = this.requireLiveTeam(team)
          this.resolveCancellationChannelCleanupAuthority(current, channel, actor, input)
        })
      }))
    })
  }

  /** Close one exact active channel through the durable TeamRun finalization-cleanup authority. */
  override async closeTeamFinalizationChannel(request: TeamFinalizationChannelCloseRequest): Promise<ChannelSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamFinalizationChannelCloseInputSchema.parse(untrustedInput)
      this.finalizationChannelCleanupScope(actor, input)
      const team = await this.ensureTeam(input.teamId)
      const finalChannel = await this.ensureAttachedChannel(input.finalChannelId)
      const channel = await this.ensureAttachedChannel(input.channelId)
      const channels = finalChannel.id === channel.id ? [finalChannel] : [finalChannel, channel]
      await team.queue.run(async () => {
        await this.withChannelQueues(channels, async () => {
          const currentTeam = this.requireLiveTeam(team)
          await this.resolveFinalizationChannelCleanupAuthority(currentTeam, finalChannel, channel, actor, input)
        })
      })
      return await team.queue.run(async () => await this.withChannelQueues(channels, async () => {
        const currentTeam = this.requireLiveTeam(team)
        await this.resolveFinalizationChannelCleanupAuthority(currentTeam, finalChannel, channel, actor, input)
        return await this.closeChannelOwned(channel, {
          channelId: input.channelId,
          expectedCursor: input.expectedCursor,
          reason: input.reason,
        }, {
          operation: 'finalization-channel-cleanup',
          finalChannelId: input.finalChannelId,
          finalEnvelopeId: input.finalEnvelopeId,
          expectedTeamCursor: input.expectedTeamCursor,
          channelId: input.channelId,
          expectedCursor: input.expectedCursor,
          reason: input.reason,
          sourceName: TEAM_RUN_FINALIZATION_CLEANUP_PROOF_SOURCE,
        }, undefined, async () => {
          const current = this.requireLiveTeam(team)
          await this.resolveFinalizationChannelCleanupAuthority(current, finalChannel, channel, actor, input)
        })
      }))
    })
  }

  /** Close one exact unbound active workflow channel after a TeamRun compiler failure. */
  override async closeWorkflowChannel(request: TeamWorkflowChannelCloseRequest): Promise<ChannelSnapshot> {
    return await this.admit(async () => {
      const { actor, ...untrustedInput } = request
      const input = teamWorkflowChannelCloseInputSchema.parse(untrustedInput)
      this.workflowChannelCloseScope(actor, input)
      const team = await this.ensureTeam(input.teamId)
      await this.repairPendingParentCharges(team)
      const channel = await this.ensureAttachedChannel(input.channelId)
      return await team.queue.run(async () => await channel.queue.run(async () => {
        const currentTeam = this.requireLiveTeam(team)
        const plan = this.resolveWorkflowChannelCloseAuthority(currentTeam, channel, actor, input)
        return await this.closeChannelOwned(channel, {
          channelId: input.channelId,
          expectedCursor: input.expectedCursor,
          ...input.reason === undefined ? {} : { reason: input.reason },
        }, {
          operation: 'workflow-channel-cleanup',
          planId: input.planId,
          expectedTeamCursor: input.expectedTeamCursor,
          expectedRevision: input.expectedRevision,
          channelId: input.channelId,
          expectedCursor: input.expectedCursor,
          sourceName: TEAM_RUN_WORKFLOW_PROOF_SOURCE,
        }, plan.actor?.participantId, () => {
          const confirmed = this.requireLiveTeam(team)
          this.resolveWorkflowChannelCloseAuthority(confirmed, channel, actor, input)
        })
      }))
    })
  }

  /** Return the active task wake channels that a fence must retire after its Team commit. */
  private quiescedWakeChannelIds(projection: TeamProjection, activationId: ActivationId): ChannelId[] {
    const channelIds = new Set<ChannelId>()
    for (const task of projection.tasks.values()) {
      if (task.lease?.activationId !== activationId || task.lease.wakeChannelId === undefined) continue
      channelIds.add(task.lease.wakeChannelId)
    }
    return [...channelIds]
  }

  /** Close durable wake channels recorded by a completed activation fence. */
  private async closeQuiescedWakeChannels(
    team: LoadedTeam,
    activationId: ActivationId,
    channelIds: readonly ChannelId[],
    beforeCommit?: () => void | Promise<void>,
  ): Promise<void> {
    for (const channelId of channelIds) {
      const loaded = await this.ensureChannel(channelId)
      await loaded.queue.run(async () => {
        const channel = this.requireLiveChannel(loaded)
        this.assertAttachedChannel(team, channel)
        if (channel.projection.phase !== 'active') return
        await this.closeChannelOwned(loaded, {
          channelId,
          expectedCursor: channel.projection.cursor,
          reason: 'activation fenced',
        }, {
          channelId,
          expectedCursor: channel.projection.cursor,
          fencedActivationId: activationId,
        }, undefined, beforeCommit)
      })
    }
  }

  /** Reject a replacement while its predecessor's recorded wake channel can still deliver. */
  private async assertRetiredQuiescedWakeChannels(
    team: LoadedTeam,
    binding: ActivationBindingSnapshot,
  ): Promise<void> {
    for (const channelId of binding.quiescedWakeChannelIds ?? []) {
      const loaded = await this.ensureChannel(channelId)
      await loaded.queue.run(() => {
        const channel = this.requireLiveChannel(loaded)
        this.assertAttachedChannel(team, channel)
        if (channel.projection.phase === 'closed'
          || channel.projection.phase === 'expired'
          || channel.projection.phase === 'failed') return Promise.resolve()
        throw new TeamError(
          `Activation '${binding.activation.id}' wake channel '${channelId}' is not terminal`,
          'TEAM_INVALID_ARGUMENT',
        )
      })
    }
  }

  /** Commit one active channel's closing and terminal records under its existing serializer. */
  private async closeChannelOwned(
    loaded: LoadedChannel,
    input: ChannelCloseInput,
    facts: JsonObject,
    actorId?: ParticipantId,
    beforeCommit?: () => void | Promise<void>,
  ): Promise<ChannelSnapshot> {
    const current = this.requireLiveChannel(loaded)
    assertChannelCursor(current.projection.cursor, input.expectedCursor)
    await this.authorizeOrThrow('close', current.projection.manifest.teamId, facts, actorId)
    if (beforeCommit !== undefined) await beforeCommit()
    const records = this.channelCloseRecords(current.projection, input.reason, Date.now())
    await this.commitChannel(current, records)
    const snapshot = this.channelSnapshot(current)
    return snapshot
  }

  /**
   * Wait for a channel WAL cursor to advance without a read-to-subscribe gap.
   * @param request - channel and exclusive cursor already observed by the caller.
   * @returns an advanced cursor or a closed result.
   */
  override async watchChannel(request: ChannelWatchRequest): Promise<ChannelWatchResult> {
    return await this.admit(async () => {
      const { signal, ...wire } = request
      const input = channelWatchRequestSchema.parse(wire)
      if (this.closing) return freeze({ kind: 'closed' as const })
      try {
        const channel = await this.ensureAttachedChannel(input.channelId, false)
        const registered = await channel.queue.run(() => Promise.resolve({
          wait: this.closing ? Promise.resolve<ChannelWatchResult>({ kind: 'closed' })
            : channel.activity.wait(this.requireLiveChannel(channel).projection.cursor, input.afterCursor, signal),
        }))
        return freeze(await registered.wait)
      } catch (error: unknown) {
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- disposal may begin while this admitted watch awaits recovery.
        if (this.closing && error instanceof TeamError && error.code === 'TEAM_DISPOSED') return freeze({ kind: 'closed' as const })
        throw error
      }
    })
  }

  /**
   * Expose an already-recovered Team projection to this package's invariant
   * companion without opening a durable stream as a side effect.
   * @param teamId - Team whose live Hub projection is inspected.
   * @returns the current detached projection, or `undefined` when not loaded.
   */
  inspectLoadedTeam(teamId: TeamId): TeamStateSnapshot | undefined {
    const loaded = this.teams.get(teamId)
    return loaded === undefined || loaded.invalid ? undefined : this.teamState(loaded.projection)
  }

  /**
   * Expose one already-recovered participant interrupt to this package's
   * invariant companion without opening a durable stream.
   * @param teamId - Team that owns the interrupt.
   * @param interruptId - Hub-minted interrupt identity.
   * @returns the current detached interrupt, or `undefined` when it is not loaded.
   */
  inspectLoadedParticipantInterrupt(
    teamId: TeamId,
    interruptId: TeamInterruptId,
  ): ParticipantInterruptSnapshot | undefined {
    const loaded = this.teams.get(teamId)
    const interrupt = loaded === undefined || loaded.invalid ? undefined : loaded.projection.interrupts.get(interruptId)
    return interrupt === undefined ? undefined : this.interruptSnapshot(interrupt)
  }

  /**
   * Expose an already-recovered channel projection to this package's invariant
   * companion without opening a durable stream as a side effect.
   * @param channelId - channel whose live Hub projection is inspected.
   * @returns the current detached projection, or `undefined` when not loaded.
   */
  inspectLoadedChannel(channelId: ChannelId): ChannelSnapshot | undefined {
    const loaded = this.channels.get(channelId)
    return loaded === undefined || loaded.invalid ? undefined : this.channelSnapshot(loaded)
  }

  /** Admit one operation before disposal closes new Team-Hub work. */
  private async admit<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) throw new TeamError('Team Hub is disposing', 'TEAM_DISPOSED')
    const scope = { active: true, teams: new Set<LoadedTeam>(), channels: new Set<LoadedChannel>() }
    const accepted = Promise.resolve().then(() => this.projectionReadScopes.run(scope, async () => {
      const [outcome] = await Promise.allSettled([Promise.resolve().then(operation)] as const)
      scope.active = false
      for (const team of scope.teams) team.readers -= 1
      for (const channel of scope.channels) channel.readers -= 1
      const cleaning = [
        ...[...scope.teams].map(team => this.evictArchivedTeam(team)),
        ...[...scope.channels].filter(channel => channel.readers === 0 && this.terminalChannels.has(channel))
          .map(channel => this.discardChannel(channel)),
      ]
      scope.teams.clear()
      scope.channels.clear()
      const cleanup = await Promise.allSettled(cleaning)
      const errors = cleanup.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
      if (errors.length > 0) {
        if (outcome.status === 'rejected') errors.unshift(outcome.reason)
        throw new AggregateError(errors, 'Team admission projection cleanup failed')
      }
      if (outcome.status === 'rejected') throw outcome.reason
      return outcome.value
    }))
    this.accepted.add(accepted)
    this.adjustMetric('activeAdmissions', 1)
    try {
      return await accepted
    } finally {
      this.adjustMetric('activeAdmissions', -1)
      this.accepted.delete(accepted)
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- disposal can begin while this admission awaits.
      if (!this.closing && this.accepted.size === 0) await this.evictTerminalChannels()
    }
  }

  /** Load a Team once, sharing an in-flight recovery among concurrent callers. */
  private async ensureTeam(teamId: TeamId, reconcile = true): Promise<LoadedTeam> {
    let eviction = this.teamEvictions.get(teamId)
    while (eviction !== undefined) {
      await eviction
      eviction = this.teamEvictions.get(teamId)
    }
    const existing = this.teams.get(teamId)
    if (existing !== undefined && !existing.invalid) {
      this.retainTeam(existing)
      if (reconcile && existing.stream.tailSequence > existing.projection.team.cursor) {
        await this.refreshTeamIfAdvanced(existing)
      }
      return existing
    }
    const loading = this.teamLoads.get(teamId)
    if (loading !== undefined) return this.retainTeam(await loading)
    const opened = this.openTeam(teamId)
    this.teamLoads.set(teamId, opened)
    try {
      return this.retainTeam(await opened)
    } finally {
      // v8 ignore next -- a replacement loader owns this key only after a stale recovery is discarded.
      if (this.teamLoads.get(teamId) === opened) this.teamLoads.delete(teamId)
    }
  }

  /** Keep a recovered projection alive through every admitted operation that receives it. */
  private retainTeam(team: LoadedTeam): LoadedTeam {
    const scope = this.projectionReadScopes.getStore()
    if (scope?.active && !scope.teams.has(team)) {
      scope.teams.add(team)
      team.readers += 1
    }
    return team
  }

  /** Pin channel projections independently so unrelated watches cannot retain terminal WALs. */
  private retainChannel(channel: LoadedChannel): LoadedChannel {
    const scope = this.projectionReadScopes.getStore()
    if (scope?.active && !scope.channels.has(channel)) {
      scope.channels.add(channel)
      channel.readers += 1
    }
    return channel
  }

  /** Archived journals are immutable; release their projections after their last admitted reader. */
  private async evictArchivedTeam(team: LoadedTeam): Promise<void> {
    if (this.closing || team.readers !== 0 || team.projection.team.archivedAt === undefined
      || this.teams.get(team.id) !== team || team.invalid) return
    const existing = this.teamEvictions.get(team.id)
    if (existing !== undefined) { await existing; return }
    const eviction = Promise.resolve().then(async () => {
      const auditNames = [auditStreamName(team.id), ...[...team.projection.channelIds].map(id => auditStreamName(team.id, id))]
      const audits = auditNames.flatMap((name) => {
        const stream = this.auditStreams.get(name)
        return stream === undefined ? [] : [{ name, stream }]
      })
      try {
        const results = await Promise.allSettled([team.stream.close(), ...audits.map(({ stream }) => stream.close())])
        const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
        if (errors.length > 0) throw new AggregateError(errors, 'Archived Team stream cleanup failed')
      } finally {
        for (const name of auditNames) {
          this.auditStreams.delete(name)
          this.validatedAuditStreams.delete(name)
          this.auditQueues.delete(name)
        }
        team.activity.close()
        team.invalid = true
        if (this.teams.get(team.id) === team) this.teams.delete(team.id)
      }
    })
    this.teamEvictions.set(team.id, eviction)
    try { await eviction }
    finally { this.teamEvictions.delete(team.id) }
  }

  /** Reconcile durable Team records appended by another Hub process. */
  private async refreshTeamIfAdvanced(loaded: LoadedTeam): Promise<void> {
    const current = this.teamRefreshes.get(loaded.id)
    if (current !== undefined) {
      await current
      return
    }
    const refresh = this.refreshTeamProjection(loaded)
    this.teamRefreshes.set(loaded.id, refresh)
    try {
      await refresh
    } finally {
      if (this.teamRefreshes.get(loaded.id) === refresh) this.teamRefreshes.delete(loaded.id)
    }
  }

  /** Fold and publish one durable Team suffix without reopening its stream. */
  private async refreshTeamProjection(loaded: LoadedTeam): Promise<void> {
    if (this.closing) return
    const current = this.requireLiveTeam(loaded)
    let projection = current.projection
    let cursor = projection.team.cursor
    const initialCursor = cursor
    const events: TeamEvent[] = []
    try {
      while (true) {
        const entries = await current.stream.read(cursor, this.config.recoveryPageSize)
        if (entries.length === 0) break
        for (const entry of entries) {
          if (entry.sequence !== cursor + 1) {
            throw new TeamHubError(`Team '${loaded.id}' journal has a cursor gap at ${entry.sequence}`, 'TEAM_JOURNAL_MALFORMED')
          }
          const record = parseTeamRecord(entry.value, loaded.id)
          projection = foldTeamRecord(projection, record, entry.sequence, loaded.id)
          if (record.type === 'policy/denied') current.policyDenialCursors.add(entry.sequence)
          events.push(teamEventFor(record, projection))
          cursor = entry.sequence
        }
      }
      assertTaskCancellationSettlements(projection)
      await this.assertRecoveredTerminalChannels(projection)
    } catch (error: unknown) {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- disposal may race the backend read.
      if (this.closing) return
      await this.invalidateTeam(current)
      throw error
    }
    // A local operation may have advanced this projection while the bounded
    // external scan awaited the backend. Never overwrite that newer state.
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- disposal may race the backend read.
    if (this.closing || cursor === current.projection.team.cursor || current.projection.team.cursor !== initialCursor) return
    current.projection = projection
    // Existing waiters observed the old in-memory projection. Close that
    // generation so a stale CAS caller receives the historical conflict
    // result, then give future watches a fresh activity generation.
    current.activity.close()
    current.activity = new CursorActivity()
    for (const event of events) this.emitTeamEvent(event)
  }

  /** Open, validate, and fold one Team journal before publishing its projection. */
  private async openTeam(teamId: TeamId): Promise<LoadedTeam> {
    const stream = await this.ctx.storageLog.open({
      name: teamStreamName(teamId),
      version: TEAM_JOURNAL_FORMAT_VERSION,
    })
    this.teamOpeningStreams.set(teamId, stream)
    try {
      const recovered = await this.recoverTeam(stream, teamId)
      const loaded: LoadedTeam = {
        readers: 0,
        id: teamId,
        stream,
        queue: new SerialQueue(),
        activity: new CursorActivity(),
        projection: recovered.projection,
        policyDenialCursors: recovered.policyDenialCursors,
        invalid: false,
      }
      this.teams.set(teamId, loaded)
      return loaded
    } catch (error: unknown) {
      return await closeAfterFailure(stream, error)
    } finally {
      if (this.teamOpeningStreams.get(teamId) === stream) this.teamOpeningStreams.delete(teamId)
    }
  }

  /** Rebuild one Team projection from a valid checkpoint plus its log suffix. */
  private async recoverTeam(
    stream: HubLogStream,
    teamId: TeamId,
  ): Promise<{ readonly projection: TeamProjection; readonly policyDenialCursors: Set<number> }> {
    const checkpoint = await stream.readCheckpoint()
    const restored = checkpoint === undefined ? undefined : await this.restoreTeamCheckpoint(stream, teamId, checkpoint)
    let projection = restored?.projection
    let cursor = restored?.cursor ?? EMPTY_CURSOR
    const policyDenialCursors = new Set<number>()
    if (restored !== undefined) {
      let scanned = Math.max(EMPTY_CURSOR, stream.firstSequence - 1)
      while (scanned < restored.cursor) {
        const entries = await stream.read(scanned, this.config.recoveryPageSize)
        if (entries.length === 0) break
        for (const entry of entries) {
          const record = parseTeamRecord(entry.value, teamId)
          if (record.type === 'policy/denied') policyDenialCursors.add(entry.sequence)
          scanned = entry.sequence
        }
      }
    }
    while (true) {
      const entries = await stream.read(cursor, this.config.recoveryPageSize)
      if (entries.length === 0) break
      for (const entry of entries) {
        /* v8 ignore next 3 -- LogStream opens only validated contiguous durable entries. */
        if (entry.sequence !== cursor + 1) {
          throw new TeamHubError(`Team '${teamId}' journal has a cursor gap at ${entry.sequence}`, 'TEAM_JOURNAL_MALFORMED')
        }
        const record = parseTeamRecord(entry.value, teamId)
        projection = foldTeamRecord(projection, record, entry.sequence, teamId)
        if (record.type === 'policy/denied') policyDenialCursors.add(entry.sequence)
        cursor = entry.sequence
      }
    }
    if (projection === undefined) {
      throw new TeamError(`Team '${teamId}' was not found`, 'TEAM_NOT_FOUND')
    }
    assertTaskCancellationSettlements(projection)
    await this.assertRecoveredTerminalChannels(projection)
    return { projection, policyDenialCursors }
  }

  /** Verify terminal Team claims against the authoritative attached WALs before exposing recovered state. */
  private async assertRecoveredTerminalChannels(projection: TeamProjection): Promise<void> {
    const phase = projection.team.phase
    if (phase !== 'completed' && phase !== 'failed' && phase !== 'cancelled') return
    for (const channelId of projection.channelIds) {
      const channel = this.requireLiveChannel(await this.ensureChannel(channelId))
      if (channel.projection.manifest.teamId !== projection.team.id) {
        throw new TeamHubError(`terminal Team '${projection.team.id}' references channel '${channelId}' owned by another Team`, 'TEAM_JOURNAL_MALFORMED')
      }
      if (!isTerminalChannelPhase(channel.projection.phase) || pendingDeliveryCount(channel.projection) !== 0) {
        throw new TeamHubError(`terminal Team '${projection.team.id}' retains unsettled channel '${channelId}'`, 'TEAM_JOURNAL_MALFORMED')
      }
    }
    if (phase === 'completed' && projection.team.parentTeamId !== undefined) {
      const admission = projection.team.childResultAdmission
      const closure = projection.team.closure
      if (admission === undefined || closure?.kind !== 'complete'
        || closure.finalChannelId !== admission.parent.binding.channelId
        || closure.finalEnvelopeId !== admission.parent.responseEnvelopeId) {
        throw new TeamHubError('Completed child has no exact parent-service result and closure', 'TEAM_JOURNAL_MALFORMED')
      }
      const channel = await this.ensureChannel(admission.parent.binding.channelId)
      const owner = { id: projection.team.id, projection }
      try {
        const selected = await this.requireChildResponse(owner, channel, admission.parent.responseEnvelopeId)
        this.assertChildResultMatches(owner, admission.parent, selected.request, selected.response)
        await this.assertParentResultStored(admission.parent)
        await this.requireChildServiceReceipt(owner, channel, admission.parent)
      } catch (cause: unknown) {
        throw new TeamHubError('Completed child has invalid parent-service result evidence', 'TEAM_JOURNAL_MALFORMED', { cause })
      }
      return
    }
    if (phase === 'completed') {
      const admission = projection.finalAdmission
      const closure = projection.team.closure
      if (admission === null || closure?.kind !== 'complete'
        || closure.finalChannelId !== admission.channelId || closure.finalEnvelopeId !== admission.envelopeId
        || !projection.channelIds.has(admission.channelId)) {
        throw new TeamHubError(`completed Team '${projection.team.id}' has no matching attached final admission`, 'TEAM_JOURNAL_MALFORMED')
      }
      const channel = await this.ensureChannel(admission.channelId)
      const owner = { id: projection.team.id, projection }
      try {
        const final = await this.requireFinalEnvelope(owner, channel, admission.envelopeId)
        this.requireFinalAdmission(owner, final, final.audience[0])
      } catch (error: unknown) {
        if (!(error instanceof TeamError) || error.code !== 'TEAM_FINAL_INVALID') throw error
        throw new TeamHubError(`completed Team '${projection.team.id}' has invalid final evidence`, 'TEAM_JOURNAL_MALFORMED', { cause: error })
      }
    }
  }

  /** Trust a Team checkpoint only when its durable anchor and identity agree. */
  private async restoreTeamCheckpoint(
    stream: HubLogStream,
    teamId: TeamId,
    checkpoint: { readonly sequence: number; readonly value: unknown },
  ): Promise<{ readonly projection: TeamProjection; readonly cursor: number } | undefined> {
    const parsed = teamProjectionCheckpointSchema.safeParse(checkpoint.value)
    if (!parsed.success || parsed.data.teamId !== teamId || parsed.data.projection.team.id !== teamId
      || parsed.data.projection.team.cursor !== checkpoint.sequence) {
      return undefined
    }
    // v8 ignore next -- storage rejects checkpoints detached from their durable watermark.
    if (!await hasCheckpointAnchor(stream, checkpoint.sequence)) return undefined
    try {
      const projection = teamProjectionFromData(parsed.data.projection)
      assertTaskCancellationSettlements(projection)
      await this.assertRecoveredTerminalChannels(projection)
      return {
        projection,
        cursor: checkpoint.sequence,
      }
    } catch (error: unknown) {
      if (!(error instanceof TeamHubError) || error.code !== 'TEAM_JOURNAL_MALFORMED') throw error
      this.ctx.logger.warn(`team-hub: ignored invalid Team checkpoint '${teamId}': ${renderError(error)}`)
      return undefined
    }
  }

  /** Load a channel once, sharing one in-flight WAL recovery among callers. */
  private async ensureChannel(channelId: ChannelId, reconcile = true): Promise<LoadedChannel> {
    let release = this.channelReleases.get(channelId)
    while (release !== undefined) {
      await release
      release = this.channelReleases.get(channelId)
    }
    const existing = this.channels.get(channelId)
    if (existing !== undefined && !existing.invalid) {
      this.retainChannel(existing)
      if (reconcile && existing.stream.tailSequence > existing.projection.cursor) {
        await this.refreshChannelIfAdvanced(existing)
      }
      return existing
    }
    const loading = this.channelLoads.get(channelId)
    if (loading !== undefined) return this.retainChannel(await loading)
    const opened = this.openChannelStream(channelId)
    this.channelLoads.set(channelId, opened)
    try {
      return this.retainChannel(await opened)
    } finally {
      // v8 ignore next -- a replacement loader owns this key only after a stale recovery is discarded.
      if (this.channelLoads.get(channelId) === opened) this.channelLoads.delete(channelId)
    }
  }

  /** Reconcile durable channel records appended by another Hub process. */
  private async refreshChannelIfAdvanced(loaded: LoadedChannel): Promise<void> {
    const current = this.channelRefreshes.get(loaded.id)
    if (current !== undefined) {
      await current
      return
    }
    const refresh = this.refreshChannelProjection(loaded)
    this.channelRefreshes.set(loaded.id, refresh)
    try {
      await refresh
    } finally {
      if (this.channelRefreshes.get(loaded.id) === refresh) this.channelRefreshes.delete(loaded.id)
    }
  }

  /** Fold and publish one durable channel suffix without reopening its stream. */
  private async refreshChannelProjection(loaded: LoadedChannel): Promise<void> {
    if (this.closing) return
    const current = this.requireLiveChannel(loaded)
    let projection = current.projection
    let cursor = projection.cursor
    const initialCursor = cursor
    const adapter = loaded.adapter
    const records: ChannelRecord[] = []
    try {
      while (true) {
        const entries = await current.stream.read(cursor, this.config.recoveryPageSize)
        if (entries.length === 0) break
        for (const entry of entries) {
          if (entry.sequence !== cursor + 1) {
            throw new TeamHubError(`channel '${loaded.id}' WAL has a cursor gap at ${entry.sequence}`, 'TEAM_CHANNEL_WAL_MALFORMED')
          }
          const record = parseChannelRecord(entry.value, loaded.id)
          if (record.type === 'channel/summary') {
            await this.validateChannelSummaryRecord(current.stream, loaded.id, record, projection.manifest)
          }
          projection = foldChannelRecord(projection, record, entry.sequence, loaded.id, adapter)
          records.push(record)
          cursor = entry.sequence
        }
      }
    } catch (error: unknown) {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- disposal may race the backend read.
      if (this.closing) return
      await this.invalidateChannel(current)
      throw error
    }
    // A local operation may have advanced this projection while the bounded
    // external scan awaited the backend. Never overwrite that newer state.
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- disposal may race the backend read.
    if (this.closing || cursor === current.projection.cursor || current.projection.cursor !== initialCursor) return
    current.projection = projection
    current.activity.close()
    current.activity = new CursorActivity()
    this.markChannelTerminal(current)
    for (const record of records) this.emitChannelRecord(current.id, record)
  }

  /** Ensure a recovered channel is referenced by its owning Team journal. */
  private async ensureAttachedChannel(channelId: ChannelId, reconcile = true): Promise<LoadedChannel> {
    const channel = await this.ensureChannel(channelId, reconcile)
    let team: LoadedTeam
    try {
      team = await this.ensureTeam(channel.projection.manifest.teamId, reconcile)
    } catch (error: unknown) {
      if ((error instanceof TeamError && error.code === 'TEAM_NOT_FOUND')
        || (error instanceof TeamHubError && error.code === 'TEAM_JOURNAL_MALFORMED')) {
        await this.discardChannel(channel)
      }
      throw error
    }
    if (!team.projection.channelIds.has(channelId)) {
      await this.discardChannel(channel)
      throw new TeamError(`Channel '${channelId}' is not attached to Team '${team.id}'`, 'TEAM_CHANNEL_NOT_FOUND')
    }
    return channel
  }

  /** Find an earlier receipt only on the duplicate-acknowledgement path. */
  private async findCommittedReceipt(
    channel: LoadedChannel,
    participantId: ParticipantId,
    envelopeId: ChannelReceiptRecord['envelopeId'],
  ): Promise<ChannelReceiptRecord | undefined> {
    let cursor = Math.max(EMPTY_CURSOR, channel.stream.firstSequence - 1)
    while (true) {
      const entries = await channel.stream.read(cursor, this.config.recoveryPageSize)
      if (entries.length === 0) return undefined
      for (const entry of entries) {
        // v8 ignore next -- LogStream returns contiguous pages; recovery owns the defensive gap check.
        if (entry.sequence !== cursor + 1) {
          throw new TeamHubError(`channel '${channel.id}' receipt lookup has a cursor gap at ${entry.sequence}`, 'TEAM_CHANNEL_WAL_MALFORMED')
        }
        cursor = entry.sequence
        const record = parseChannelRecord(entry.value, channel.id)
        if (record.type === 'channel/receipt'
          && record.participantId === participantId
          && record.envelopeId === envelopeId) {
          return record
        }
      }
    }
  }

  /** Find one accepted Envelope by its immutable Hub-stamped identity. */
  private async findCommittedEnvelope(
    channel: LoadedChannel,
    envelopeId: EnvelopeId,
  ): Promise<TeamEnvelope | undefined> {
    let cursor = Math.max(EMPTY_CURSOR, channel.stream.firstSequence - 1)
    while (true) {
      const entries = await channel.stream.read(cursor, this.config.recoveryPageSize)
      if (entries.length === 0) return undefined
      for (const entry of entries) {
        // v8 ignore next -- LogStream returns contiguous pages; recovery owns the defensive gap check.
        if (entry.sequence !== cursor + 1) {
          throw new TeamHubError(`channel '${channel.id}' Envelope lookup has a cursor gap at ${entry.sequence}`, 'TEAM_CHANNEL_WAL_MALFORMED')
        }
        cursor = entry.sequence
        const record = parseChannelRecord(entry.value, channel.id)
        if (record.type === 'channel/envelope' && record.envelope.id === envelopeId) return record.envelope
      }
    }
  }

  /** Find a same-channel recipient result that causally completes one pending delivery. */
  private async hasCommittedCausalResult(
    channel: LoadedChannel,
    participantId: ParticipantId,
    envelopeId: EnvelopeId,
  ): Promise<boolean> {
    let cursor = EMPTY_CURSOR
    while (true) {
      const entries = await channel.stream.read(cursor, this.config.recoveryPageSize)
      if (entries.length === 0) return false
      for (const entry of entries) {
        // v8 ignore next -- LogStream returns contiguous pages; recovery owns the defensive gap check.
        if (entry.sequence !== cursor + 1) {
          throw new TeamHubError(`channel '${channel.id}' causal-delivery lookup has a cursor gap at ${entry.sequence}`, 'TEAM_CHANNEL_WAL_MALFORMED')
        }
        cursor = entry.sequence
        const record = parseChannelRecord(entry.value, channel.id)
        if (record.type === 'channel/envelope'
          && record.envelope.senderId === participantId
          && record.envelope.causationId === envelopeId) {
          return true
        }
      }
    }
  }

  /** Check whether one causal predecessor remains in this channel's durable WAL. */
  private async hasCommittedEnvelope(channel: LoadedChannel, envelopeId: EnvelopeId): Promise<boolean> {
    return await this.findCommittedEnvelope(channel, envelopeId) !== undefined
  }

  /** Select current recipient delivery intents strictly after one Envelope cursor in durable order. */
  private pendingDeliveryCandidates(
    channel: LoadedChannel,
    participantId: ParticipantId,
    afterCursor: number,
  ): PendingChannelDelivery[] {
    const candidates: PendingChannelDelivery[] = []
    for (const delivery of channel.projection.pendingDeliveries.get(participantId)?.values() ?? []) {
      if (delivery.envelopeSequence > afterCursor) candidates.push(delivery)
    }
    return candidates
  }

  /** Read the full durable Envelope payload for each selected current pending delivery. */
  private async readPendingEnvelopeDeliveries(
    channel: LoadedChannel,
    afterCursor: number,
    selected: readonly PendingChannelDelivery[],
  ): Promise<ChannelPendingEnvelopeDelivery[]> {
    if (selected.length === 0) return []
    const expected = new Map(selected.map(delivery => [delivery.envelopeId, delivery]))
    const envelopes = new Map<EnvelopeId, TeamEnvelope>()
    let cursor = afterCursor
    while (envelopes.size < expected.size) {
      const entries = await channel.stream.read(cursor, this.config.recoveryPageSize)
      if (entries.length === 0) break
      for (const entry of entries) {
        // v8 ignore next -- LogStream returns contiguous pages; recovery owns the defensive gap check.
        if (entry.sequence !== cursor + 1) {
          throw new TeamHubError(`channel '${channel.id}' pending-delivery lookup has a cursor gap at ${entry.sequence}`, 'TEAM_CHANNEL_WAL_MALFORMED')
        }
        cursor = entry.sequence
        const record = parseChannelRecord(entry.value, channel.id)
        if (record.type !== 'channel/envelope') continue
        const pending = expected.get(record.envelope.id)
        if (pending === undefined) continue
        if (record.envelope.sequence !== pending.envelopeSequence) {
          throw new TeamHubError(
            `channel '${channel.id}' pending delivery '${pending.envelopeId}' has another Envelope cursor`,
            'TEAM_CHANNEL_WAL_MALFORMED',
          )
        }
        envelopes.set(record.envelope.id, record.envelope)
      }
    }
    return selected.map((pending) => {
      const envelope = envelopes.get(pending.envelopeId)
      if (envelope === undefined) {
        throw new TeamHubError(
          `channel '${channel.id}' pending delivery '${pending.envelopeId}' has no durable Envelope`,
          'TEAM_CHANNEL_WAL_MALFORMED',
        )
      }
      return { envelope: this.envelopeSnapshot(envelope), delivery: pending.delivery }
    })
  }

  /** Reject a channel that is not durably reachable from the exact locked Team. */
  private assertAttachedChannel(team: TeamProjectionOwner, channel: LoadedChannel): void {
    if (channel.projection.manifest.teamId !== team.id || !team.projection.channelIds.has(channel.id)) {
      void this.discardChannel(channel)
      throw new TeamError(`Channel '${channel.id}' is not attached to Team '${team.id}'`, 'TEAM_CHANNEL_NOT_FOUND')
    }
  }

  /** Require an attached active channel to include the selected task lease owner. */
  private assertTaskWakeChannel(team: LoadedTeam, channel: LoadedChannel, participantId: ParticipantId): void {
    this.assertAttachedChannel(team, channel)
    if (channel.projection.phase !== 'active') {
      throw new TeamError(`channel '${channel.id}' is not active`, 'TEAM_INVALID_ARGUMENT')
    }
    this.assertActiveChannelParticipant(team, channel, participantId)
  }

  /** Require each current task lease to own its task-assignment wake channel exclusively. */
  private assertExclusiveWakeChannel(projection: TeamProjection, taskId: TeamTaskId, channelId: ChannelId): void {
    if ([...projection.tasks.values()].some(task => task.id !== taskId && task.lease?.wakeChannelId === channelId)) {
      throw new TeamError(`Wake channel '${channelId}' already belongs to another current task lease`, 'TEAM_INVALID_ARGUMENT')
    }
  }

  /** Require an active Team and channel participant before recipient delivery work. */
  private assertActiveChannelParticipant(team: LoadedTeam, channel: LoadedChannel, participantId: ParticipantId): void {
    const participant = team.projection.participants.get(participantId)
    const member = channel.projection.manifest.participants.some(candidate => candidate.id === participantId)
    if (participant?.phase === 'active' && member) return
    throw new TeamError(`Channel recipient '${participantId}' is not an active participant`, 'TEAM_PARTICIPANT_NOT_FOUND')
  }

  /** Require an accepted task-assignment Envelope to be addressed to its current lease owner. */
  private assertTaskAssignmentEnvelope(
    channel: LoadedChannel,
    envelope: TeamEnvelope,
    task: TeamTaskSnapshot,
    participantId: ParticipantId,
  ): void {
    if (envelope.taskId !== task.id) {
      throw new TeamError(`Envelope '${envelope.id}' does not reference Team task '${task.id}'`, 'TEAM_INVALID_ARGUMENT')
    }
    const addressed = envelope.audience === null
      ? envelope.senderId !== participantId
      : envelope.audience.includes(participantId)
    if (!addressed) {
      throw new TeamError(`Envelope '${envelope.id}' does not address task owner '${participantId}' in channel '${channel.id}'`, 'TEAM_INVALID_ARGUMENT')
    }
  }

  /** Append the one standard receipt that removes a still-pending recipient delivery. */
  private async commitPendingDeliveryReceipt(
    channel: LoadedChannel,
    participantId: ParticipantId,
    pending: PendingChannelDelivery,
    beforeCommit?: () => void | Promise<void>,
  ): Promise<ChannelReceiptRecord> {
    const current = this.requireLiveChannel(channel)
    const priorCursor = current.projection.receiptCursors.get(participantId)
    const envelope = await this.findCommittedEnvelope(current, pending.envelopeId)
    const receipt: ChannelReceiptRecord = {
      type: 'channel/receipt',
      sequence: current.projection.cursor + 1,
      createdAt: Date.now(),
      participantId,
      envelopeId: pending.envelopeId,
      cursor: Math.max(priorCursor ?? pending.envelopeSequence, pending.envelopeSequence),
    }
    await beforeCommit?.()
    await this.commitChannel(current, [receipt])
    if (envelope !== undefined) {
      this.lastReceiptLatencyMs = Math.max(0, receipt.createdAt - envelope.createdAt)
      this.recordLatency('receiptLatency', this.lastReceiptLatencyMs)
    }
    return receipt
  }

  /** Validate current membership, including every immutable broadcast target on direct v4. */
  private assertEnvelopeMembership(
    team: LoadedTeam,
    channel: LoadedChannel,
    senderId: ParticipantId,
    audience: readonly ParticipantId[] | null,
  ): void {
    this.assertActiveChannelSender(team, channel, senderId)
    const participants = new Set(channel.projection.manifest.participants.map(participant => participant.id))
    const manifest = channel.projection.manifest
    if (channel.projection.invitations.get(senderId)?.status !== 'acknowledged') {
      throw new TeamError('Channel sender has not acknowledged its invitation', 'TEAM_INVALID_ARGUMENT')
    }
    const recipients = audience ?? (manifest.adapter.type === DIRECT_CHANNEL_V4_ADAPTER.type
      && manifest.adapter.version === DIRECT_CHANNEL_V4_ADAPTER.version
      ? [...participants].filter(participantId => participantId !== senderId
        && channel.projection.invitations.get(participantId)?.status === 'acknowledged') : null)
    if (recipients === null) return
    if (new Set(recipients).size !== recipients.length) {
      throw new TeamError('channel Envelope audience cannot repeat a participant', 'TEAM_INVALID_ARGUMENT')
    }
    for (const recipientId of recipients) {
      const recipient = team.projection.participants.get(recipientId)
      if (recipient?.phase !== 'active' || !participants.has(recipientId)
        || channel.projection.invitations.get(recipientId)?.status !== 'acknowledged') {
        throw new TeamError(`Channel audience '${recipientId}' is not an active participant`, 'TEAM_PARTICIPANT_NOT_FOUND')
      }
    }
  }

  /** A direct-v4 product final cannot derive human authority from caller-selected channel roles. */
  private assertDirectV4FinalAudience(team: LoadedTeam, channel: LoadedChannel, senderId: ParticipantId, draft: TeamEnvelopeDraft): void {
    const manifest = channel.projection.manifest
    if (manifest.adapter.type !== DIRECT_CHANNEL_V4_ADAPTER.type || manifest.adapter.version !== DIRECT_CHANNEL_V4_ADAPTER.version
      || draft.kind !== 'final') return
    const sender = team.projection.participants.get(senderId)
    const recipientId = draft.audience?.length === 1 ? draft.audience[0] : undefined
    const recipient = recipientId === undefined ? undefined : team.projection.participants.get(recipientId)
    if (manifest.participants.length !== 2 || draft.delivery !== 'turn'
      || sender === undefined || !isAgentParticipant(sender) || sender.role !== 'coordinator'
      || recipient?.kind !== 'human' || recipient.role !== 'human'
      || manifest.participants.find(participant => participant.id === senderId)?.role !== 'coordinator'
      || manifest.participants.find(participant => participant.id === recipientId)?.role !== 'human') {
      throw new TeamError('Direct v4 final requires its exact coordinator and authorized human peer with turn delivery', 'TEAM_INVALID_ARGUMENT')
    }
  }

  /** Validate the sender portion of one authenticated channel post. */
  private assertActiveChannelSender(
    team: LoadedTeam,
    channel: LoadedChannel,
    senderId: ParticipantId,
  ): void {
    const participants = new Set(channel.projection.manifest.participants.map(participant => participant.id))
    const sender = team.projection.participants.get(senderId)
    if (sender?.phase !== 'active' || !participants.has(senderId)) {
      throw new TeamError(`Channel sender '${senderId}' is not an active participant`, 'TEAM_PARTICIPANT_NOT_FOUND')
    }
  }

  /**
   * Resolve an opaque proof and recheck its exact deliverable activation
   * binding while the owning Team serializers are held. A stale, revoked,
   * foreign-Team, replaced, or offline proof cannot reach policy or durable
   * command acceptance.
   * @param team - Team whose durable activation projection is authoritative.
   * @param actor - runtime-only proof issued by an activation-bound Link.
   * @returns the current durable binding used to derive command identity.
   */
  private requireCurrentActivationActorBinding(team: LoadedTeam, actor: TeamActorProof): ActivationBindingSnapshot {
    const issued = this.requireActivationActorProof(actor)
    const current = this.findActivationBinding(team.projection, issued.activation.id)
    if (current === undefined
      || current.activation.teamId !== team.id
      || current.activation.teamId !== issued.activation.teamId
      || current.activation.participantId !== issued.activation.participantId
      || current.sessionId !== issued.sessionId
      || current.provider !== issued.provider
      || (current.activation.status !== 'idle' && current.activation.status !== 'running')) {
      throw new TeamError('Team actor proof no longer names a current deliverable activation', 'TEAM_ACTOR_PROOF_INVALID')
    }
    return current
  }

  /**
   * Route a closure command only after its opaque authority resolves to the
   * Team selected by the JSON-only input. The later locked resolution still
   * validates current activation and source-specific topology before repair,
   * replay, policy, or a journal append.
   * @param actor - runtime-only activation or registered system proof.
   * @param teamId - Team selected by the untrusted closure input.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no source owns the proof or it names another Team.
   */
  private assertClosureAuthorityTeamId(actor: TeamClosureAuthority, teamId: TeamId): void {
    let proofTeamId: TeamId
    try {
      proofTeamId = this.requireActivationActorProof(actor as TeamActorProof).activation.teamId
    } catch (error: unknown) {
      if (!(error instanceof TeamError) || error.code !== 'TEAM_ACTOR_PROOF_INVALID') throw error
      proofTeamId = this.requireSystemClosureProof(actor as TeamSystemClosureProof).scope.teamId
    }
    if (proofTeamId !== teamId) this.rejectClosureActor()
  }

  /** Reject a driver scope whose caller-selected Team or cursor differs from its opaque source selection. */
  private assertClosureDriverInput(
    scope: TeamSystemClosureDriverScope,
    input: { readonly teamId: TeamId; readonly expectedCursor: number },
  ): void {
    if (scope.teamId !== input.teamId || scope.expectedCursor !== input.expectedCursor) {
      this.rejectClosureDriverActor()
    }
  }

  /** Resolve one driver proof under every Team/channel serializer before durable lifecycle settlement. */
  private async preflightClosureDriverContinuation(
    team: LoadedTeam,
    channels: readonly LoadedChannel[],
    actor: TeamSystemClosureDriverProof,
    input: { readonly teamId: TeamId; readonly expectedCursor: number },
  ): Promise<void> {
    await team.queue.run(async () => {
      await this.withChannelQueues(channels, () => {
        this.resolveClosureDriverContinuationAuthority(this.requireLiveTeam(team), actor, input)
        return Promise.resolve()
      })
    })
  }

  /**
   * Re-resolve an opaque closure-driver proof and bind it to the current
   * durable intent. The existing intent retains its original actor and facts.
   */
  private resolveClosureDriverContinuationAuthority(
    team: LoadedTeam,
    actor: TeamSystemClosureDriverProof,
    input: { readonly teamId: TeamId; readonly expectedCursor: number },
  ): TeamSystemClosureDriverProofResolution {
    const resolution = this.requireSystemClosureDriverProof(actor)
    const scope = resolution.scope
    this.assertClosureDriverInput(scope, input)
    if (team.id !== input.teamId || team.projection.team.cursor !== scope.expectedCursor) {
      if (scope.kind === 'closure-stall-missing-final' || scope.kind === 'closure-fail-turn' || scope.kind === 'closure-stall-budget') {
        throw new TeamError('Team closure-driver observation cursor is stale', 'TEAM_CURSOR_CONFLICT')
      }
      return this.rejectClosureDriverActor()
    }
    const current = team.projection.team
    switch (scope.kind) {
      case 'closure-recover-complete': {
        const closure = current.closure
        if (closure === undefined
          || closure.kind !== 'complete'
          || closure.teamId !== team.id
          || closure.idempotencyKey !== scope.closureIdempotencyKey
          || closure.requestedAt !== scope.closureRequestedAt
          || closure.finalChannelId !== scope.finalChannelId
          || closure.finalEnvelopeId !== scope.finalEnvelopeId
          || (current.phase !== 'quiescing' && current.phase !== 'stalled' && current.phase !== 'completed')) {
          return this.rejectClosureDriverActor()
        }
        return resolution
      }
      case 'closure-recover-fail': {
        const closure = current.closure
        if (closure === undefined
          || closure.kind !== 'fail'
          || closure.teamId !== team.id
          || closure.idempotencyKey !== scope.closureIdempotencyKey
          || closure.requestedAt !== scope.closureRequestedAt
          || (current.phase !== 'quiescing' && current.phase !== 'stalled' && current.phase !== 'failed')) {
          return this.rejectClosureDriverActor()
        }
        return resolution
      }
      case 'closure-recover-cancel': {
        const cancellation = current.cancellation
        if (cancellation === undefined
          || cancellation.teamId !== team.id
          || cancellation.idempotencyKey !== scope.cancellationIdempotencyKey
          || cancellation.requestedAt !== scope.cancellationRequestedAt
          || (current.closure !== undefined && !this.matchesCancellationClosure(current.closure, cancellation))
          || (current.phase !== 'quiescing' && current.phase !== 'stalled' && current.phase !== 'cancelled')) {
          return this.rejectClosureDriverActor()
        }
        return resolution
      }
      case 'closure-stall-missing-final':
        if (current.phase === 'stalled' && isDeepStrictEqual(current.stallReason, scope.reason)) return resolution
        this.assertObservedCoordinatorTurn(team, scope)
        if (current.phase !== 'active' || current.closure !== undefined || current.cancellation !== undefined) {
          return this.rejectClosureDriverActor()
        }
        return resolution
      case 'closure-fail-turn':
        if (current.closure?.kind === 'fail' && isDeepStrictEqual(current.closure.reason, scope.reason)) return resolution
        this.assertObservedCoordinatorTurn(team, scope)
        if (current.phase !== 'active' || current.closure !== undefined || current.cancellation !== undefined) {
          return this.rejectClosureDriverActor()
        }
        return resolution
      case 'closure-stall-budget': {
        if (current.phase === 'stalled' && isDeepStrictEqual(current.stallReason, scope.reason)) return resolution
        if (current.phase !== 'active' || current.closure !== undefined || current.cancellation !== undefined
          || !isDeepStrictEqual(teamBudgetStallReason(team.projection), scope.reason)) {
          return this.rejectClosureDriverActor()
        }
        return resolution
      }
      case 'closure-stall-quiescing':
        if (current.phase === 'stalled' && isDeepStrictEqual(current.stallReason, scope.reason)) return resolution
        if (current.phase !== 'quiescing' || current.closure !== undefined || current.cancellation !== undefined) {
          return this.rejectClosureDriverActor()
        }
        return resolution
      /* v8 ignore next -- unsupported closure-driver source scopes fail closed. */
      default:
        return this.rejectClosureDriverActor()
    }
  }

  /** Finish one durable completion intent only after the existing final and every owned resource converge. */
  private async continueCompleteClosure(
    team: LoadedTeam,
    channels: readonly LoadedChannel[],
    actor: TeamSystemClosureDriverProof,
    input: { readonly teamId: TeamId; readonly expectedCursor: number },
    resolution: TeamSystemClosureDriverProofResolution,
  ): Promise<TeamStateSnapshot> {
    if (team.projection.team.phase === 'completed') return this.teamState(team.projection)
    if (team.projection.team.goal.phase !== 'complete') {
      throw new TeamError(`Team '${team.id}' completion intent did not complete its objective`, 'TEAM_INVALID_ARGUMENT')
    }
    const scope = resolution.scope
    if (scope.kind !== 'closure-recover-complete') return this.rejectClosureDriverActor()
    const finalChannel = channels.find(channel => channel.id === scope.finalChannelId)
    if (finalChannel === undefined || !team.projection.channelIds.has(scope.finalChannelId)) {
      throw new TeamError(`final channel '${scope.finalChannelId}' is not attached to Team '${team.id}'`, 'TEAM_CHANNEL_NOT_FOUND')
    }
    let final: TeamEnvelope & { readonly audience: readonly [ParticipantId] }
    let recipient: ParticipantId
    const closure = team.projection.team.closure
    if (closure === undefined || closure.kind !== 'complete') return this.rejectClosureDriverActor()
    if (team.projection.team.parentTeamId !== undefined) {
      const admission = team.projection.team.childResultAdmission
      if (admission === undefined || admission.parent.responseEnvelopeId !== scope.finalEnvelopeId
        || admission.parent.binding.channelId !== scope.finalChannelId) {
        throw new TeamError('Child closure has no independent parent result admission', 'TEAM_CHILD_RESULT_INVALID')
      }
      const selected = await this.requireChildResponse(team, finalChannel, scope.finalEnvelopeId)
      this.assertChildResultMatches(team, admission.parent, selected.request, selected.response)
      await this.assertParentResultStored(admission.parent)
      this.resolveClosureDriverContinuationAuthority(team, actor, input)
      final = selected.response
      recipient = admission.parent.binding.parentServiceId
    } else {
      final = await this.requireFinalEnvelope(team, finalChannel, scope.finalEnvelopeId, false)
      recipient = final.audience[0]
      if (team.projection.finalAdmission === null) {
        let admission = this.finalAdmissionFor(team, final, recipient,
          teamFinalAdmissionIdempotencyKeySchema.parse(`team-run-final:${team.id}`))
        await this.authorizeOrThrow('dispatch', team.id, {
          operation: 'final-admission', channelId: finalChannel.id, envelopeId: final.id,
          envelopeSequence: final.sequence, contentFingerprint: admission.contentFingerprint,
        })
        this.resolveClosureDriverContinuationAuthority(team, actor, input)
        admission = await this.admitPrincipalFinalSink(final, admission)
        this.resolveClosureDriverContinuationAuthority(team, actor, input)
        await this.commitTeamCommand(team, [{ type: 'team/final-admitted', admission, createdAt: admission.admittedAt }], 'TEAM_FINAL_INVALID')
        return this.teamState(team.projection)
      }
      this.requireFinalAdmission(team, final, recipient)
    }
    if (await this.findCommittedReceipt(finalChannel, recipient, final.id) === undefined) {
      const pending = finalChannel.projection.pendingDeliveries.get(recipient)?.get(final.id)
      if (pending === undefined) {
        throw new TeamError(
          `completion intent final Envelope '${final.id}' has neither a recipient receipt nor a pending delivery`,
          'TEAM_FINAL_INVALID',
        )
      }
      this.resolveClosureDriverContinuationAuthority(team, actor, input)
      await this.commitPendingDeliveryReceipt(finalChannel, recipient, pending, () => {
        this.resolveClosureDriverContinuationAuthority(team, actor, input)
      })
    }
    await this.expireClosureDeliveries(
      team,
      channels,
      'completion-delivery-expiry',
      closure.idempotencyKey,
      closure.requestedAt,
      closureActorId(closure.actor),
      'closure',
      () => { this.resolveClosureDriverContinuationAuthority(team, actor, input) },
    )
    if (!this.closureResourcesSettled(team.projection, true) || !this.closureDeliveriesSettled(channels)) {
      return this.teamState(team.projection)
    }
    if (!await this.closeClosureChannels(team, channels, actor, input, resolution, 'complete', 'Team completed')) {
      return this.teamState(team.projection)
    }
    if (!this.closureResourcesSettled(team.projection, true)
      || !this.closureDeliveriesSettled(channels)
      || !this.closureChannelsTerminal(channels)) {
      return this.teamState(team.projection)
    }
    this.resolveClosureDriverContinuationAuthority(team, actor, input)
    const createdAt = nextTeamTimestamp(team.projection)
    const terminalRecords: TeamJournalRecord[] = []
    if (team.projection.team.phase === 'stalled') terminalRecords.push({ type: 'team/phase', phase: 'quiescing', createdAt })
    terminalRecords.push({ type: 'team/phase', phase: 'completed', createdAt })
    await this.commitTeamCommand(team, terminalRecords, 'TEAM_INVALID_ARGUMENT')
    return this.teamState(team.projection)
  }

  /** Finish one durable failure intent after every owned resource converges. */
  private async continueFailedClosure(
    team: LoadedTeam,
    channels: readonly LoadedChannel[],
    actor: TeamSystemClosureDriverProof,
    input: { readonly teamId: TeamId; readonly expectedCursor: number },
    resolution: TeamSystemClosureDriverProofResolution,
  ): Promise<TeamStateSnapshot> {
    if (team.projection.team.phase === 'failed') return this.teamState(team.projection)
    const closure = team.projection.team.closure
    if (closure === undefined || closure.kind !== 'fail') return this.rejectClosureDriverActor()
    const cleanup = this.closureBusinessCleanupRecords(team.projection, 'fail', closure.reason)
    if (cleanup.length > 0) {
      await this.authorizeOrThrow('close', team.id, {
        operation: 'fail-business-cleanup', idempotencyKey: closure.idempotencyKey,
        requestedAt: closure.requestedAt, count: cleanup.length,
      }, closureActorId(closure.actor))
      this.resolveClosureDriverContinuationAuthority(team, actor, input)
      await this.commitTeamCommand(team, cleanup, 'TEAM_INVALID_ARGUMENT')
      return this.teamState(team.projection)
    }
    await this.expireClosureDeliveries(
      team,
      channels,
      'failure-delivery-expiry',
      closure.idempotencyKey,
      closure.requestedAt,
      closureActorId(closure.actor),
      'closure',
      () => { this.resolveClosureDriverContinuationAuthority(team, actor, input) },
    )
    if (!this.closureResourcesSettled(team.projection, true) || !this.closureDeliveriesSettled(channels)) {
      return this.teamState(team.projection)
    }
    if (!await this.closeClosureChannels(team, channels, actor, input, resolution, 'fail', 'Team failed')) {
      return this.teamState(team.projection)
    }
    if (!this.closureResourcesSettled(team.projection, true)
      || !this.closureDeliveriesSettled(channels)
      || !this.closureChannelsTerminal(channels)) {
      return this.teamState(team.projection)
    }
    this.resolveClosureDriverContinuationAuthority(team, actor, input)
    const createdAt = nextTeamTimestamp(team.projection)
    await this.commitTeamCommand(team, [
      ...team.projection.team.phase === 'stalled' ? [{ type: 'team/phase' as const, phase: 'quiescing' as const, createdAt }] : [],
      { type: 'team/phase', phase: 'failed', createdAt },
    ], 'TEAM_INVALID_ARGUMENT')
    return this.teamState(team.projection)
  }

  /** Continue one durable cancellation after every non-channel resource and recipient delivery is already settled. */
  private async continueCancellation(
    team: LoadedTeam,
    channels: readonly LoadedChannel[],
    actor: TeamSystemClosureDriverProof,
    input: { readonly teamId: TeamId; readonly expectedCursor: number },
    resolution: TeamSystemClosureDriverProofResolution,
  ): Promise<TeamStateSnapshot> {
    if (team.projection.team.phase === 'cancelled') return this.teamState(team.projection)
    const cancellation = team.projection.team.cancellation
    if (cancellation === undefined || resolution.scope.kind !== 'closure-recover-cancel') {
      return this.rejectClosureDriverActor()
    }
    const cleanup = this.closureBusinessCleanupRecords(team.projection, 'cancel', cancellation.reason)
    if (cleanup.length > 0) {
      await this.authorizeOrThrow('close', team.id, {
        operation: 'cancel-business-cleanup', idempotencyKey: cancellation.idempotencyKey,
        requestedAt: cancellation.requestedAt, count: cleanup.length,
      }, closureActorId(cancellation.actor))
      this.resolveClosureDriverContinuationAuthority(team, actor, input)
      await this.commitTeamCommand(team, cleanup, 'TEAM_INVALID_ARGUMENT')
      return this.teamState(team.projection)
    }
    let currentResolution = resolution
    await this.expireClosureDeliveries(
      team,
      channels,
      'cancellation-delivery-expiry',
      cancellation.idempotencyKey,
      cancellation.requestedAt,
      closureActorId(cancellation.actor),
      'cancellation',
      () => {
        currentResolution = this.resolveClosureDriverContinuationAuthority(team, actor, input)
      },
    )
    if (!this.cancellationResourcesSettled(team.projection) || !this.cancellationDeliveriesSettled(channels)) {
      return this.teamState(team.projection)
    }
    await this.settleClosureBranches(
      channels.map(channel => async () => {
        const currentChannel = this.requireLiveChannel(channel)
        if (currentChannel.projection.phase === 'closed'
          || currentChannel.projection.phase === 'expired'
          || currentChannel.projection.phase === 'failed') return
        currentResolution = this.resolveClosureDriverContinuationAuthority(team, actor, input)
        await this.closeChannelOwned(channel, {
          channelId: channel.id,
          expectedCursor: currentChannel.projection.cursor,
          reason: 'Team cancelled',
        }, {
          operation: 'closure-driver-cancellation-channel-close',
          cancellationIdempotencyKey: cancellation.idempotencyKey,
          cancellationRequestedAt: cancellation.requestedAt,
          expectedTeamCursor: input.expectedCursor,
          channelId: channel.id,
          expectedCursor: currentChannel.projection.cursor,
          sourceName: currentResolution.sourceName,
        }, closureActorId(cancellation.actor), () => {
          currentResolution = this.resolveClosureDriverContinuationAuthority(team, actor, input)
        })
      }),
      'Team cancellation channel cleanup failed',
    )
    if (!this.cancellationResourcesSettled(team.projection) || !this.cancellationDeliveriesSettled(channels)) {
      return this.teamState(team.projection)
    }
    currentResolution = this.resolveClosureDriverContinuationAuthority(team, actor, input)
    const currentCancellation = team.projection.team.cancellation
    if (currentCancellation === undefined || currentResolution.scope.kind !== 'closure-recover-cancel') {
      return this.rejectClosureDriverActor()
    }
    const existing = team.projection.team.closure
    const createdAt = nextTeamTimestamp(team.projection)
    await this.commitTeamCommand(team, [
      ...team.projection.team.phase === 'stalled' ? [{ type: 'team/phase' as const, phase: 'quiescing' as const, createdAt }] : [],
      ...existing === undefined ? [{
        type: 'team/closure' as const,
        closure: {
          teamId: team.id,
          kind: 'cancel' as const,
          idempotencyKey: currentCancellation.idempotencyKey,
          actor: structuredClone(currentCancellation.actor),
          reason: structuredClone(currentCancellation.reason),
          requestedAt: createdAt,
        },
        createdAt,
      }] : [],
      { type: 'team/phase', phase: 'cancelled', createdAt },
    ], 'TEAM_INVALID_ARGUMENT')
    return this.teamState(team.projection)
  }

  /** Settle unstarted work while preserving every completed attempt and review decision. */
  private closureBusinessCleanupRecords(
    projection: TeamProjection,
    kind: 'fail' | 'cancel',
    reason: TeamStallReason,
  ): TeamJournalRecord[] {
    const createdAt = nextTeamTimestamp(projection)
    const records: TeamJournalRecord[] = []
    for (const task of projection.tasks.values()) {
      if (task.phase !== 'pending' && task.phase !== 'review') continue
      if (task.delegation?.childTeamId !== undefined) continue
      if (task.cancellation !== undefined && [...projection.workspaceAllocations.values()].some(allocation => allocation.taskId === task.id && allocation.lifecycle !== 'released')) continue
      records.push({
        type: 'task/changed',
        task: { ...structuredClone(task), revision: task.revision + 1, phase: 'cancelled',
          ...task.delegation === undefined ? {} : { delegation: { ...task.delegation, phase: 'cancelled', updatedAt: createdAt } } },
        createdAt,
      })
    }
    for (const action of projection.humanActions.values()) {
      if (action.phase !== 'pending') continue
      records.push({
        type: 'human-action/changed',
        action: {
          ...structuredClone(action),
          phase: 'cancelled',
          outcome: kind === 'fail'
            ? { kind: 'team-failed', reason: { ...reason } }
            : { kind: 'team-cancelled' },
          updatedAt: createdAt,
        },
        createdAt,
      })
    }
    for (const plan of projection.workflowPlans.values()) {
      if (plan.phase !== 'compiling' && plan.phase !== 'ready') continue
      records.push({
        type: 'workflow-plan/changed',
        plan: {
          ...structuredClone(plan),
          revision: plan.revision + 1,
          phase: kind === 'fail' ? 'failed' : 'cancelled',
          ...kind === 'fail' ? { failure: structuredClone(reason) } : {},
          ...kind === 'cancel' ? { cancellation: structuredClone(reason) } : {},
        },
        createdAt,
      })
    }
    return records
  }

  /** Durably settle pending recipient deliveries once a terminal lifecycle branch owns them. */
  private async expireClosureDeliveries(
    team: LoadedTeam,
    channels: readonly LoadedChannel[],
    operation: 'cancellation-delivery-expiry' | 'completion-delivery-expiry' | 'failure-delivery-expiry',
    idempotencyKey: TeamClosureSnapshot['idempotencyKey'],
    requestedAt: number,
    actorId: ParticipantId | undefined,
    reason: 'cancellation' | 'closure',
    revalidateAuthority: () => void,
  ): Promise<void> {
    await this.settleClosureBranches(
      channels.map(channel => async () => {
        const current = this.requireLiveChannel(channel)
        const pending = [...current.projection.pendingDeliveries.entries()].flatMap(([participantId, deliveries]) =>
          [...deliveries.values()].map(delivery => ({ participantId, delivery })))
          .sort((left, right) => left.delivery.envelopeSequence - right.delivery.envelopeSequence
            || String(left.participantId).localeCompare(String(right.participantId)))
        if (pending.length === 0) return
        const createdAt = Date.now()
        const expired: ChannelDeliveryExpiredRecord[] = pending.map(({ participantId, delivery }, index) => ({
          type: 'channel/delivery-expired',
          sequence: current.projection.cursor + index + 1,
          createdAt,
          participantId,
          envelopeId: delivery.envelopeId,
          envelopeSequence: delivery.envelopeSequence,
          reason,
        }))
        revalidateAuthority()
        await this.authorizeOrThrow('close', team.id, {
          operation,
          channelId: current.id,
          idempotencyKey,
          requestedAt,
          count: expired.length,
        }, actorId)
        revalidateAuthority()
        const projection = this.foldChannelAppend(current.projection, expired, current.id, current.adapter)
        await this.commitChannel(current, expired, projection)
      }),
      `${operation} failed`,
    )
  }

  /** Run every accepted closure branch in deterministic order and report all failures after they settle. */
  private async settleClosureBranches<T>(
    branches: readonly (() => Promise<T>)[],
    message: string,
  ): Promise<readonly T[]> {
    const operations: Promise<T>[] = []
    let previous: Promise<unknown> = Promise.resolve()
    for (const branch of branches) {
      const operation = previous.then(branch, branch)
      operations.push(operation)
      previous = operation
    }
    const settled = await Promise.allSettled(operations)
    const failures = settled
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason as unknown)
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, message)
    return settled.map(result => (result as PromiseFulfilledResult<T>).value)
  }

  /** Persist a current coordinator turn that ended without a final answer. */
  private async recordMissingFinal(
    team: LoadedTeam,
    channels: readonly LoadedChannel[],
    actor: TeamSystemClosureDriverProof,
    input: { readonly teamId: TeamId; readonly expectedCursor: number },
    resolution: TeamSystemClosureDriverProofResolution,
  ): Promise<TeamStateSnapshot> {
    const scope = resolution.scope
    if (scope.kind !== 'closure-stall-missing-final') return this.rejectClosureDriverActor()
    if (team.projection.team.phase === 'stalled' && isDeepStrictEqual(team.projection.team.stallReason, scope.reason)) {
      return this.teamState(team.projection)
    }
    this.assertObservedCoordinatorTurn(team, scope)
    if (team.projection.team.phase !== 'active'
      || team.projection.team.closure !== undefined
      || team.projection.team.cancellation !== undefined) {
      return this.teamState(team.projection)
    }
    if (await this.hasCoordinatorFinal(channels, scope.coordinatorId, scope.finalChannelId, scope.humanId)) {
      return this.teamState(team.projection)
    }
    await this.authorizeOrThrow('close', team.id, {
      operation: scope.kind,
      sourceName: resolution.sourceName,
      coordinatorId: scope.coordinatorId,
      activationId: scope.activationId,
      sessionId: scope.sessionId,
      provider: scope.provider,
      turn: scope.turn,
      reason: structuredClone(scope.reason) as unknown as JsonObject,
    })
    this.resolveClosureDriverContinuationAuthority(team, actor, input)
    const createdAt = nextTeamTimestamp(team.projection)
    await this.commitTeamCommand(team, [{
      type: 'team/phase',
      phase: 'stalled',
      reason: structuredClone(scope.reason),
      createdAt,
    }], 'TEAM_INVALID_ARGUMENT')
    return this.teamState(team.projection)
  }

  /** Persist a structured coordinator turn failure as a restart-visible fail intent. */
  private async recordTurnFailure(
    team: LoadedTeam,
    channels: readonly LoadedChannel[],
    actor: TeamSystemClosureDriverProof,
    input: { readonly teamId: TeamId; readonly expectedCursor: number },
    resolution: TeamSystemClosureDriverProofResolution,
  ): Promise<TeamStateSnapshot> {
    const scope = resolution.scope
    if (scope.kind !== 'closure-fail-turn') return this.rejectClosureDriverActor()
    const existing = team.projection.team.closure
    if (existing?.kind === 'fail' && isDeepStrictEqual(existing.reason, scope.reason)) return this.teamState(team.projection)
    this.assertObservedCoordinatorTurn(team, scope)
    if (team.projection.team.phase !== 'active'
      || existing !== undefined
      || team.projection.team.cancellation !== undefined) {
      return this.teamState(team.projection)
    }
    if (await this.hasCoordinatorFinal(channels, scope.coordinatorId, scope.finalChannelId, scope.humanId)) {
      return this.teamState(team.projection)
    }
    await this.authorizeOrThrow('close', team.id, {
      operation: scope.kind,
      sourceName: resolution.sourceName,
      coordinatorId: scope.coordinatorId,
      activationId: scope.activationId,
      sessionId: scope.sessionId,
      provider: scope.provider,
      turn: scope.turn,
      reason: structuredClone(scope.reason) as unknown as JsonObject,
    })
    this.resolveClosureDriverContinuationAuthority(team, actor, input)
    const createdAt = nextTeamTimestamp(team.projection)
    const closure: TeamClosureSnapshot = {
      teamId: team.id,
      kind: 'fail',
      idempotencyKey: teamClosureIdempotencyKeySchema.parse(
        `team-closure-driver:turn-failure:${String(team.id)}:${String(scope.sessionId)}:${String(scope.turn)}`,
      ),
      actor: { kind: 'system', name: resolution.sourceName },
      reason: structuredClone(scope.reason),
      requestedAt: createdAt,
    }
    await this.commitTeamCommand(team, [
      { type: 'team/closure', closure, createdAt },
      { type: 'team/phase', phase: 'quiescing', createdAt },
    ], 'TEAM_INVALID_ARGUMENT')
    return this.teamState(team.projection)
  }

  /** Persist a validated frozen-budget stall without requiring a later mutation. */
  private async recordBudgetStall(
    team: LoadedTeam,
    actor: TeamSystemClosureDriverProof,
    input: { readonly teamId: TeamId; readonly expectedCursor: number },
    resolution: TeamSystemClosureDriverProofResolution,
  ): Promise<TeamStateSnapshot> {
    const scope = resolution.scope
    if (scope.kind !== 'closure-stall-budget') return this.rejectClosureDriverActor()
    if (team.projection.team.phase === 'stalled' && isDeepStrictEqual(team.projection.team.stallReason, scope.reason)) {
      return this.teamState(team.projection)
    }
    if (team.projection.team.phase !== 'active'
      || team.projection.team.closure !== undefined
      || team.projection.team.cancellation !== undefined
      || !isDeepStrictEqual(teamBudgetStallReason(team.projection), scope.reason)) {
      return this.rejectClosureDriverActor()
    }
    await this.authorizeOrThrow('close', team.id, {
      operation: scope.kind,
      sourceName: resolution.sourceName,
      reason: structuredClone(scope.reason) as unknown as JsonObject,
    })
    this.resolveClosureDriverContinuationAuthority(team, actor, input)
    const createdAt = nextTeamTimestamp(team.projection)
    await this.commitTeamCommand(team, [{
      type: 'team/phase',
      phase: 'stalled',
      reason: structuredClone(scope.reason),
      createdAt,
    }], 'TEAM_INVALID_ARGUMENT')
    return this.teamState(team.projection)
  }

  /** Mark an orphaned quiescing Team stalled without inventing a terminal result. */
  private async recordQuiescingStall(
    team: LoadedTeam,
    actor: TeamSystemClosureDriverProof,
    input: { readonly teamId: TeamId; readonly expectedCursor: number },
    resolution: TeamSystemClosureDriverProofResolution,
  ): Promise<TeamStateSnapshot> {
    const scope = resolution.scope
    if (scope.kind !== 'closure-stall-quiescing') return this.rejectClosureDriverActor()
    if (team.projection.team.phase === 'stalled' && isDeepStrictEqual(team.projection.team.stallReason, scope.reason)) {
      return this.teamState(team.projection)
    }
    if (team.projection.team.phase !== 'quiescing'
      || team.projection.team.closure !== undefined
      || team.projection.team.cancellation !== undefined) {
      return this.rejectClosureDriverActor()
    }
    await this.authorizeOrThrow('close', team.id, {
      operation: scope.kind,
      sourceName: resolution.sourceName,
      reason: structuredClone(scope.reason) as unknown as JsonObject,
    })
    this.resolveClosureDriverContinuationAuthority(team, actor, input)
    const createdAt = nextTeamTimestamp(team.projection)
    await this.commitTeamCommand(team, [{
      type: 'team/phase',
      phase: 'stalled',
      reason: structuredClone(scope.reason),
      createdAt,
    }], 'TEAM_INVALID_ARGUMENT')
    return this.teamState(team.projection)
  }

  /** Validate a current coordinator epoch before a turn observation can mutate Team lifecycle. */
  private assertObservedCoordinatorTurn(
    team: LoadedTeam,
    scope: Extract<TeamSystemClosureDriverScope, { readonly coordinatorId: ParticipantId }>,
  ): void {
    const participant = team.projection.participants.get(scope.coordinatorId)
    const binding = team.projection.activations.get(scope.activationId)
    if (participant === undefined
      || participant.phase !== 'active'
      || participant.role !== 'coordinator'
      || !isAgentParticipant(participant)
      || binding === undefined
      || binding.activation.teamId !== team.id
      || binding.activation.participantId !== scope.coordinatorId
      || (binding.activation.status !== 'idle' && binding.activation.status !== 'running')
      || binding.sessionId !== scope.sessionId
      || binding.provider !== scope.provider) {
      return this.rejectClosureDriverActor()
    }
  }

  /** Check every attached channel for a coordinator final before stalling its turn. */
  private async hasCoordinatorFinal(
    channels: readonly LoadedChannel[],
    coordinatorId: ParticipantId,
    finalChannelId: ChannelId | undefined,
    humanId: ParticipantId | undefined,
  ): Promise<boolean> {
    if (finalChannelId === undefined || humanId === undefined) return false
    for (const channel of channels.filter(candidate => candidate.id === finalChannelId)) {
      let cursor = EMPTY_CURSOR
      while (true) {
        const entries = await channel.stream.read(cursor, this.config.recoveryPageSize)
        if (entries.length === 0) break
        for (const entry of entries) {
          if (entry.sequence !== cursor + 1) {
            throw new TeamHubError(
              `channel '${channel.id}' final lookup has a cursor gap at ${entry.sequence}`,
              'TEAM_CHANNEL_WAL_MALFORMED',
            )
          }
          cursor = entry.sequence
          const record = parseChannelRecord(entry.value, channel.id)
          if (record.type !== 'channel/envelope'
            || record.envelope.senderId !== coordinatorId
            || record.envelope.kind !== 'final'
            || record.envelope.audience === null
            || record.envelope.audience.length !== 1
            || record.envelope.audience[0] !== humanId
            || typeof record.envelope.payload.text !== 'string'
            || record.envelope.payload.text.trim().length === 0) continue
          return true
        }
      }
    }
    return false
  }

  /** Compare the durable cancellation admission with a terminal cancellation closure derived from it. */
  private matchesCancellationClosure(closure: TeamClosureSnapshot, cancellation: TeamCancellationSnapshot): boolean {
    return closure.kind === 'cancel'
      && closure.teamId === cancellation.teamId
      && closure.idempotencyKey === cancellation.idempotencyKey
      && isDeepStrictEqual(closure.actor, cancellation.actor)
      && isDeepStrictEqual(closure.reason, cancellation.reason)
      && closure.finalChannelId === undefined
      && closure.finalEnvelopeId === undefined
  }

  /** Return whether a completion or failure driver may begin terminal channel cleanup. */
  private closureResourcesSettled(projection: TeamProjection, requireQuiescence = false): boolean {
    if ([...projection.participants.values()].some(participant => participant.activationReservation !== undefined
      && participant.activationReservation.releasedAt === undefined
      && ![...projection.activations.values()].some(binding =>
        binding.reservationId === participant.activationReservation?.id))) return false
    if ([...projection.tasks.values()].some(task => (
      task.phase === 'pending' || task.phase === 'assigned' || task.phase === 'running' || task.phase === 'review'
    ))) return false
    if ([...projection.workspaceAllocations.values()].some(allocation => allocation.lifecycle !== 'released')) return false
    if (projection.pendingParentCharges.size > 0) return false
    if ([...projection.activations.values()].some(binding => binding.activation.status !== 'offline'
      || requireQuiescence && binding.quiescedAt === undefined)) return false
    if ([...projection.humanActions.values()].some(action => action.phase === 'pending')) return false
    return ![...projection.workflowPlans.values()].some(plan => plan.phase === 'compiling' || plan.phase === 'ready')
  }

  /** Return whether every closure-owned channel has no unresolved recipient delivery. */
  private closureDeliveriesSettled(channels: readonly LoadedChannel[]): boolean {
    return channels.every(channel => pendingDeliveryCount(this.requireLiveChannel(channel).projection) === 0)
  }

  /** Return whether every closure-owned channel reached a terminal WAL phase. */
  private closureChannelsTerminal(channels: readonly LoadedChannel[]): boolean {
    return channels.every((channel) => {
      const phase = this.requireLiveChannel(channel).projection.phase
      return phase === 'closed' || phase === 'expired' || phase === 'failed'
    })
  }

  /** Close every pending or active closure-owned channel with an intent- and cursor-bound driver proof. */
  private async closeClosureChannels(
    team: LoadedTeam,
    channels: readonly LoadedChannel[],
    actor: TeamSystemClosureDriverProof,
    input: { readonly teamId: TeamId; readonly expectedCursor: number },
    resolution: TeamSystemClosureDriverProofResolution,
    kind: 'complete' | 'fail',
    reason: string,
  ): Promise<boolean> {
    const closure = team.projection.team.closure
    if (closure === undefined || closure.kind !== kind) return this.rejectClosureDriverActor()
    let currentResolution = resolution
    const settled = await this.settleClosureBranches(
      channels.map(channel => async () => {
        const currentChannel = this.requireLiveChannel(channel)
        if (currentChannel.projection.phase === 'closed'
          || currentChannel.projection.phase === 'expired'
          || currentChannel.projection.phase === 'failed') return true
        if (!['pending', 'active'].includes(currentChannel.projection.phase)) return false
        currentResolution = this.resolveClosureDriverContinuationAuthority(team, actor, input)
        await this.closeChannelOwned(channel, {
          channelId: channel.id,
          expectedCursor: currentChannel.projection.cursor,
          reason,
        }, {
          operation: kind === 'complete'
            ? 'closure-driver-completion-channel-close'
            : 'closure-driver-failure-channel-close',
          closureIdempotencyKey: closure.idempotencyKey,
          closureRequestedAt: closure.requestedAt,
          expectedTeamCursor: input.expectedCursor,
          channelId: channel.id,
          expectedCursor: currentChannel.projection.cursor,
          sourceName: currentResolution.sourceName,
        }, closureActorId(closure.actor), () => {
          currentResolution = this.resolveClosureDriverContinuationAuthority(team, actor, input)
          if (kind === 'complete' && currentResolution.scope.kind !== 'closure-recover-complete') {
            this.rejectClosureDriverActor()
          }
          if (kind === 'fail' && currentResolution.scope.kind !== 'closure-recover-fail') {
            this.rejectClosureDriverActor()
          }
        })
        return true
      }),
      `${kind} closure channel cleanup failed`,
    )
    return settled.every(Boolean)
  }

  /** Reject every forged, revoked, cross-Team, stale, or wrong-operation closure-driver proof. */
  private rejectClosureDriverActor(): never {
    throw new TeamError('Team closure-driver proof is invalid for this continuation', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Resolve a closure authority once while the selected Team and every
   * attached channel serializer are held. It deliberately returns only a
   * serializable durable attribution, never the opaque proof itself.
   * @param loaded - Team whose projection is authoritative for the command.
   * @param channels - every channel currently attached to that Team.
   * @param actor - runtime-only activation or registered system proof.
   * @param input - JSON-only closure fields already parsed at the boundary.
   * @param kind - narrow closure operation selected by the caller.
   */
  private async preflightClosureAuthority(
    loaded: LoadedTeam,
    channels: readonly LoadedChannel[],
    actor: TeamClosureAuthority,
    input: TeamClosureInput,
    kind: 'complete' | 'fail' | 'cancel',
  ): Promise<void> {
    await loaded.queue.run(async () => {
      await this.withChannelQueues(channels, () => {
        const current = this.requireLiveTeam(loaded)
        this.resolveClosureAuthority(current, actor, input, kind, channels)
        return Promise.resolve()
      })
    })
  }

  /** Recognize the TeamRun-only completion proof that may precede its final receipt. */
  private isTeamRunCompletionProof(actor: TeamClosureAuthority): boolean {
    try {
      const resolution = this.requireSystemClosureProof(actor as TeamSystemClosureProof)
      return resolution.sourceName === TEAM_RUN_CLOSURE_PROOF_SOURCE
        && resolution.scope.kind === 'team-run-complete'
    } catch (error: unknown) {
      if (error instanceof TeamError && error.code === 'TEAM_ACTOR_PROOF_INVALID') return false
      throw error
    }
  }

  /**
   * Revalidate an opaque closure authority and reduce it to durable actor
   * attribution. This must run before replay because a stale or revoked proof
   * cannot use a matching old idempotency key as an authorization bypass.
   * @param team - locked Team whose durable state is authoritative.
   * @param actor - activation-bound or registered system authority.
   * @param input - parsed JSON-only closure fields.
   * @param kind - selected closure operation.
   * @param channels - locked attached channels required by TeamRun scopes.
   * @returns parsed fields plus the derived durable actor.
   */
  private resolveClosureAuthority<T extends TeamClosureInput>(
    team: LoadedTeam,
    actor: TeamClosureAuthority,
    input: T,
    kind: 'complete' | 'fail' | 'cancel',
    channels: readonly LoadedChannel[] = [],
  ): ResolvedTeamClosureInput<T> {
    try {
      const binding = this.requireCurrentActivationActorBinding(team, actor as TeamActorProof)
      const participant = team.projection.participants.get(binding.activation.participantId)
      if (participant?.phase !== 'active') this.rejectClosureActor()
      return {
        ...input,
        actor: { kind: 'participant', participantId: binding.activation.participantId },
      }
    } catch (error: unknown) {
      if (!(error instanceof TeamError) || error.code !== 'TEAM_ACTOR_PROOF_INVALID') throw error
    }

    const resolution = this.requireSystemClosureProof(actor as TeamSystemClosureProof)
    this.validateTeamRunClosureProof(team, channels, resolution, input, kind)
    return {
      ...input,
      actor: { kind: 'system', name: TEAM_RUN_CLOSURE_PROOF_SOURCE },
    }
  }

  /**
   * Validate TeamRun's three source-owned closure operations against their
   * durable Team/channel topology. Completion may fence its direct channel
   * before the final receipt; cancellation remains a separate terminal branch.
   */
  private validateTeamRunClosureProof(
    team: LoadedTeam,
    channels: readonly LoadedChannel[],
    resolution: TeamSystemClosureProofResolution,
    input: TeamClosureInput,
    kind: 'complete' | 'fail' | 'cancel',
  ): void {
    const scope = resolution.scope
    if (resolution.sourceName !== TEAM_RUN_CLOSURE_PROOF_SOURCE || scope.teamId !== team.id) {
      this.rejectClosureActor()
    }
    switch (scope.kind) {
      case 'team-run-complete': {
        const completion = input as unknown as TeamCompleteInput
        if (kind !== 'complete'
          || completion.finalChannelId !== scope.channelId
          || completion.finalEnvelopeId !== scope.finalEnvelopeId) {
          this.rejectClosureActor()
        }
        this.assertTeamRunClosureTopology(team, channels, scope.channelId, scope.humanId, scope.coordinatorId)
        return
      }
      case 'team-run-cancel':
        if (kind !== 'cancel') this.rejectClosureActor()
        this.assertTeamRunClosureTopology(team, channels, scope.channelId, scope.humanId, scope.coordinatorId)
        return
      case 'team-run-create-failure':
        if (kind !== 'fail') this.rejectClosureActor()
        return
      /* v8 ignore next -- TeamSystemClosureScope is closed and every source operation is handled above. */
      default:
        scope satisfies never
        return this.rejectClosureActor()
    }
  }

  /**
   * Require the immutable default direct-v4 participant roster selected by a
   * TeamRun closure proof. This examines membership and the attached manifest,
   * not live activation/channel phase, so close/retry remains recoverable.
   */
  private assertTeamRunClosureTopology(
    team: LoadedTeam,
    channels: readonly LoadedChannel[],
    channelId: ChannelId,
    humanId: ParticipantId,
    coordinatorId: ParticipantId,
  ): void {
    const channel = channels.find(candidate => candidate.id === channelId)
    const manifest = channel?.projection.manifest
    const human = team.projection.participants.get(humanId)
    const coordinator = team.projection.participants.get(coordinatorId)
    if (channel === undefined
      || !team.projection.channelIds.has(channelId)
      || manifest?.adapter.type !== DIRECT_CHANNEL_V4_ADAPTER.type
      || manifest.adapter.version !== DIRECT_CHANNEL_V4_ADAPTER.version
      || manifest.participants.length !== 2
      || humanId === coordinatorId
      || human?.kind !== 'human'
      || human.phase !== 'active'
      || coordinator?.phase !== 'active'
      || !manifest.participants.some(member => member.id === humanId && member.role === 'human')
      || !manifest.participants.some(member => member.id === coordinatorId && member.role === 'coordinator')) {
      this.rejectClosureActor()
    }
  }

  /** Reject every forged, stale, cross-scope, or unsupported closure actor uniformly. */
  private rejectClosureActor(): never {
    throw new TeamError('Team closure actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Resolve the only recipient a runtime receipt actor may acknowledge while
   * the owning Team and channel serializers hold the current topology. An
   * activation proof names its current recipient. Team-run's separate system
   * proof may name only its exact active human/coordinator direct-v4 final.
   * @param team - Team whose live participant and activation projection is authoritative.
   * @param channel - Attached channel whose receipt is being admitted.
   * @param actor - runtime-only activation or registered system proof.
   * @param input - JSON-only receipt selection fields.
   * @returns the exact participant whose pending delivery may be acknowledged.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when the actor cannot currently authorize this receipt.
   */
  private async resolveReceiptRecipient(
    team: LoadedTeam,
    channel: LoadedChannel,
    actor: ChannelEnvelopeReceiptRequest['actor'],
    input: ChannelEnvelopeReceiptInput,
  ): Promise<ResolvedReceiptRecipient> {
    try {
      const binding = this.requireCurrentActivationActorBinding(team, actor as TeamActorProof)
      const participantId = binding.activation.participantId
      this.assertActiveChannelParticipant(team, channel, participantId)
      return { participantId, policyActorId: participantId }
    } catch (error: unknown) {
      if (!(error instanceof TeamError) || error.code !== 'TEAM_ACTOR_PROOF_INVALID') throw error
    }
    const participantId = await this.resolveTeamRunFinalReceiptRecipient(team, channel, actor as TeamSystemFinalReceiptProof, input)
    const final = await this.requireFinalEnvelope(team, channel, input.envelopeId, false)
    this.requireFinalAdmission(team, final, participantId)
    return { participantId }
  }

  /** Retain one receipt identity with its opaque proof through policy and WAL admission. */
  private async resolveReceiptAuthority(
    team: LoadedTeam,
    channel: LoadedChannel,
    actor: ChannelEnvelopeReceiptRequest['actor'],
    input: ChannelEnvelopeReceiptInput,
  ): Promise<ResolvedChannelReceiptAuthority> {
    const resolved = await this.resolveReceiptRecipient(team, channel, actor, input)
    return {
      ...resolved,
      revalidate: async () => {
        const confirmed = await this.resolveReceiptRecipient(team, channel, actor, input)
        if (confirmed.participantId !== resolved.participantId
          || (confirmed.policyActorId === undefined) !== (resolved.policyActorId === undefined)) {
          this.rejectReceiptActor()
        }
        return confirmed.participantId
      },
    }
  }

  /**
   * Validate Team-run's source-owned final-receipt proof against the durable
   * default topology and its exact coordinator final before receipt policy,
   * pending-delivery lookup, cursor comparison, or WAL append.
   * @param team - Team selected by the caller's channel identifier.
   * @param channel - Locked channel selected by the caller's channel identifier.
   * @param actor - opaque system proof whose source retains its scope.
   * @param input - selected final Envelope and observed channel cursor.
   * @returns the exact human recipient retained by Team-run's proof source.
   */
  private async resolveTeamRunFinalReceiptRecipient(
    team: LoadedTeam,
    channel: LoadedChannel,
    actor: TeamSystemFinalReceiptProof,
    input: ChannelEnvelopeReceiptInput,
  ): Promise<ParticipantId> {
    const resolution = this.requireSystemFinalReceiptProof(actor)
    const { scope } = resolution
    if (resolution.sourceName !== TEAM_RUN_FINAL_RECEIPT_PROOF_SOURCE
      || scope.teamId !== team.id
      || scope.channelId !== channel.id) {
      this.rejectReceiptActor()
    }
    const manifest = channel.projection.manifest
    const human = team.projection.participants.get(scope.humanId)
    const coordinator = team.projection.participants.get(scope.coordinatorId)
    const members = manifest.participants
    const completionPendingReceipt = (team.projection.team.phase === 'quiescing'
      || team.projection.team.phase === 'stalled' || team.projection.team.phase === 'completed')
      && team.projection.team.closure?.kind === 'complete'
      && team.projection.team.closure.finalChannelId === scope.channelId
      && team.projection.team.closure.finalEnvelopeId === input.envelopeId
      && team.projection.team.closure.actor.kind === 'system'
      && team.projection.team.closure.actor.name === TEAM_RUN_CLOSURE_PROOF_SOURCE
    if (team.projection.team.phase !== 'active'
      && !completionPendingReceipt
      || channel.projection.phase !== 'active' && !(completionPendingReceipt && team.projection.finalAdmission !== null)
      || manifest.adapter.type !== DIRECT_CHANNEL_V4_ADAPTER.type
      || manifest.adapter.version !== DIRECT_CHANNEL_V4_ADAPTER.version
      || members.length !== 2
      || human?.kind !== 'human'
      || human.phase !== 'active'
      || coordinator?.phase !== 'active'
      || scope.humanId === scope.coordinatorId
      || !members.some(member => member.id === scope.humanId && member.role === 'human')
      || !members.some(member => member.id === scope.coordinatorId && member.role === 'coordinator')) {
      this.rejectReceiptActor()
    }
    const final = await this.findCommittedEnvelope(channel, input.envelopeId)
    if (final === undefined
      || final.teamId !== team.id
      || final.channelId !== channel.id
      || final.kind !== 'final'
      || final.senderId !== scope.coordinatorId
      || final.audience === null
      || final.audience.length !== 1
      || final.audience[0] !== scope.humanId
      || typeof final.payload.text !== 'string'
      || final.payload.text.trim().length === 0) {
      this.rejectReceiptActor()
    }
    if (!isDeepStrictEqual(this.requireSystemFinalReceiptProof(actor), resolution)) this.rejectReceiptActor()
    return scope.humanId
  }

  /** Reject every forged, stale, cross-scope, or unsupported receipt actor uniformly. */
  private rejectReceiptActor(): never {
    throw new TeamError('Channel receipt actor is invalid for this Team delivery', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Retain one delivery claimant with its opaque activation proof through policy and receipt admission. */
  private resolveChannelDeliveryClaimAuthority(
    team: LoadedTeam,
    channel: LoadedChannel,
    actor: TeamActorProof,
  ): ResolvedChannelDeliveryClaimAuthority {
    const binding = this.requireCurrentActivationActorBinding(team, actor)
    const participantId = binding.activation.participantId
    this.assertActiveChannelParticipant(team, channel, participantId)
    return {
      binding,
      revalidate: () => {
        const confirmed = this.requireCurrentActivationActorBinding(team, actor)
        if (confirmed.activation.id !== binding.activation.id
          || confirmed.activation.teamId !== binding.activation.teamId
          || confirmed.activation.participantId !== participantId
          || confirmed.sessionId !== binding.sessionId
          || confirmed.provider !== binding.provider) {
          throw new TeamError('Channel delivery actor changed after authorization', 'TEAM_ACTOR_PROOF_INVALID')
        }
        this.assertActiveChannelParticipant(team, channel, confirmed.activation.participantId)
        return confirmed
      },
    }
  }

  /**
   * Resolve the exact sender for one ordinary Envelope before the shared
   * admission path applies policy, idempotency, or WAL state. Link proofs
   * derive an active activation sender, human proofs derive one active human,
   * and system proofs are limited to one validated protocol operation.
   * @param team - Team selected by the requested channel.
   * @param channel - Attached channel selected by the requested draft.
   * @param actor - runtime-only activation or registered system proof.
   * @param input - JSON-only ordinary Envelope admission fields.
   * @returns sender-derived fields accepted by the private admission helper.
   */
  private resolveEnvelopePostAuthority(
    team: LoadedTeam,
    channel: LoadedChannel,
    actor: ChannelEnvelopePostActor,
    input: ChannelEnvelopePostInput,
  ): ResolvedChannelEnvelopePost {
    const acceptedInput: ChannelEnvelopePostInput = {
      ...input,
      draft: structuredClone(input.draft),
    }
    const resolve = (): ParticipantId => this.resolveEnvelopePostSender(team, channel, actor, acceptedInput)
    return {
      ...acceptedInput,
      senderId: resolve(),
      revalidate: resolve,
    }
  }

  /** Re-resolve one ordinary Envelope actor against the exact JSON-only post input. */
  private resolveEnvelopePostSender(
    team: LoadedTeam,
    channel: LoadedChannel,
    actor: ChannelEnvelopePostActor,
    input: ChannelEnvelopePostInput,
  ): ParticipantId {
    if (this.requiresSystemEnvelopePostProof(channel, input)) {
      const resolution = this.requireSystemEnvelopePostProof(actor as TeamSystemEnvelopePostProof)
      return this.resolveSystemEnvelopePostSender(team, channel, resolution, input)
    }
    const human = this.tryResolveHumanActorProof(actor)
    if (human !== undefined) return this.resolveHumanEnvelopePostSender(team, channel, human, input)
    try {
      return this.requireCurrentActivationActorBinding(team, actor as TeamActorProof).activation.participantId
    } catch (error: unknown) {
      if (!(error instanceof TeamError) || error.code !== 'TEAM_ACTOR_PROOF_INVALID') throw error
    }
    const resolution = this.requireSystemEnvelopePostProof(actor as TeamSystemEnvelopePostProof)
    return this.resolveSystemEnvelopePostSender(team, channel, resolution, input)
  }

  /** Re-resolve an authenticated human proof against the full parsed ordinary-post input. */
  private resolveHumanEnvelopePostSender(
    team: LoadedTeam,
    channel: LoadedChannel,
    human: TeamHumanActorScope,
    input: ChannelEnvelopePostInput,
  ): ParticipantId {
    const expected: TeamHumanActorProofInput = {
      teamId: team.id,
      operation: 'send',
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
    if (human.teamId !== team.id
      || human.operation !== expected.operation
      || human.payloadFingerprint !== fingerprintTeamHumanActorPayload(expected)
      || !isDeepStrictEqual(human.fence, expected.fence)) {
      return this.rejectEnvelopePostActor()
    }
    const participant = this.requireActiveParticipant(team, human.participantId)
    if (participant.kind !== 'human') return this.rejectEnvelopePostActor()
    this.assertActiveChannelParticipant(team, channel, participant.id)
    return participant.id
  }

  /** Select protocol drafts that only their scheduler source may create. */
  private requiresSystemEnvelopePostProof(channel: LoadedChannel, input: ChannelEnvelopePostInput): boolean {
    const adapter = channel.projection.manifest.adapter
    return (adapter.type === TASK_ASSIGNMENT_CHANNEL_ADAPTER.type
      && adapter.version === TASK_ASSIGNMENT_CHANNEL_ADAPTER.version)
      || (adapter.type === CONSULT_CHANNEL_ADAPTER.type
        && adapter.version === CONSULT_CHANNEL_ADAPTER.version
        && input.draft.kind === CONSULT_REVIEW_REQUEST_KIND)
  }

  /** Resolve one narrow system source proof to its only permitted ordinary Envelope sender. */
  private resolveSystemEnvelopePostSender(
    team: LoadedTeam,
    channel: LoadedChannel,
    resolution: TeamSystemEnvelopePostProofResolution,
    input: ChannelEnvelopePostInput,
  ): ParticipantId {
    switch (resolution.scope.kind) {
      case 'team-delegation-request':
        return this.resolveDelegationRequestSender(team, channel, resolution, input)
      case 'team-run-human-input':
        return this.resolveTeamRunHumanInputSender(team, channel, resolution, input)
      case 'scheduler-assignment':
        return this.resolveSchedulerAssignmentSender(team, channel, resolution, input)
      case 'scheduler-review-request':
        return this.resolveSchedulerReviewRequestSender(team, channel, resolution, input)
      /* v8 ignore next -- TeamSystemEnvelopePostScope is closed and every source operation is handled above. */
      default:
        resolution.scope satisfies never
        return this.rejectEnvelopePostActor()
    }
  }

  /** Admit only the immutable parent objective to its exact child consult endpoint. */
  private resolveDelegationRequestSender(team: LoadedTeam, channel: LoadedChannel,
    resolution: TeamSystemEnvelopePostProofResolution, input: ChannelEnvelopePostInput): ParticipantId {
    const scope = resolution.scope
    if (scope.kind !== 'team-delegation-request' || resolution.sourceName !== 'team-delegation') return this.rejectEnvelopePostActor()
    const binding = team.projection.team.childRun
    const parent = this.teams.get(scope.binding.parentTeamId)
    const task = parent?.projection.tasks.get(scope.binding.parentTaskId)
    if (binding === undefined || !isDeepStrictEqual(binding, scope.binding)
      || parent?.projection.team.phase !== 'active' || parent.projection.team.cancellation !== undefined || parent.projection.team.closure !== undefined
      || task?.delegation?.id !== binding.delegationId || task.delegation.childTeamId !== team.id || task.cancellation !== undefined
      || task.delegation.creation?.goal.objective !== scope.objective || task.phase !== 'running'
      || team.projection.team.phase !== 'active' || channel.projection.phase !== 'active'
      || channel.id !== binding.channelId || channel.projection.manifest.adapter.type !== CONSULT_CHANNEL_ADAPTER.type
      || channel.projection.manifest.adapter.version !== CONSULT_CHANNEL_ADAPTER.version
      || team.projection.participants.get(binding.parentServiceId)?.kind !== 'service'
      || input.draft.kind !== 'request' || input.draft.delivery !== 'turn'
      || input.draft.channelId !== binding.channelId || input.draft.audience?.length !== 1
      || input.draft.audience[0] !== binding.coordinatorId
      || input.draft.taskId !== undefined || input.draft.causationId !== undefined
      || !isDeepStrictEqual(input.draft.payload, { text: scope.objective })
      || input.idempotencyKey !== `child-request:${binding.delegationId}`) return this.rejectEnvelopePostActor()
    return binding.parentServiceId
  }

  /** Validate TeamRun's exact active human-to-coordinator default-channel input. */
  private resolveTeamRunHumanInputSender(
    team: LoadedTeam,
    channel: LoadedChannel,
    resolution: TeamSystemEnvelopePostProofResolution,
    input: ChannelEnvelopePostInput,
  ): ParticipantId {
    const scope = resolution.scope
    if (scope.kind !== 'team-run-human-input'
      || resolution.sourceName !== TEAM_RUN_ENVELOPE_POST_PROOF_SOURCE
      || scope.teamId !== team.id
      || scope.channelId !== channel.id
      || team.projection.team.phase !== 'active'
      || channel.projection.phase !== 'active'
      || channel.projection.manifest.adapter.type !== DIRECT_CHANNEL_V4_ADAPTER.type
      || channel.projection.manifest.adapter.version !== DIRECT_CHANNEL_V4_ADAPTER.version
      || channel.projection.manifest.participants.length !== 2
      || team.projection.participants.get(scope.humanId)?.kind !== 'human'
      || team.projection.participants.get(scope.humanId)?.phase !== 'active'
      || team.projection.participants.get(scope.coordinatorId)?.phase !== 'active'
      || !channel.projection.manifest.participants.some(member => member.id === scope.humanId && member.role === 'human')
      || !channel.projection.manifest.participants.some(member => member.id === scope.coordinatorId && member.role === 'coordinator')
      || input.draft.channelId !== channel.id
      || input.draft.audience === null
      || input.draft.audience.length !== 1
      || input.draft.audience[0] !== scope.coordinatorId
      || input.draft.kind !== DIRECT_CHANNEL_MESSAGE_KIND
      || input.draft.taskId !== undefined
      || input.draft.causationId !== undefined
      || !['context', 'turn', 'steer'].includes(input.draft.delivery)) {
      return this.rejectEnvelopePostActor()
    }
    return scope.humanId
  }

  /** Validate one scheduler-owned self-addressed task-assignment Envelope. */
  private resolveSchedulerAssignmentSender(
    team: LoadedTeam,
    channel: LoadedChannel,
    resolution: TeamSystemEnvelopePostProofResolution,
    input: ChannelEnvelopePostInput,
  ): ParticipantId {
    const scope = resolution.scope
    if (scope.kind !== 'scheduler-assignment'
      || resolution.sourceName !== TEAM_SCHEDULER_ENVELOPE_POST_PROOF_SOURCE
      || scope.teamId !== team.id
      || scope.channelId !== channel.id
      || team.projection.team.phase !== 'active'
      || channel.projection.phase !== 'active'
      || channel.projection.manifest.adapter.type !== TASK_ASSIGNMENT_CHANNEL_ADAPTER.type
      || channel.projection.manifest.adapter.version !== TASK_ASSIGNMENT_CHANNEL_ADAPTER.version
      || channel.projection.manifest.participants.length !== 1
      || !channel.projection.manifest.participants.some(member =>
        member.id === scope.assigneeId && member.role === TASK_ASSIGNMENT_ASSIGNEE_ROLE)
      || channel.projection.manifest.limits.taskId !== scope.taskId
      || channel.projection.manifest.limits.activationId !== scope.activationId
      || channel.projection.manifest.limits.sessionId !== scope.sessionId
      || input.draft.channelId !== channel.id
      || input.draft.audience === null
      || input.draft.audience.length !== 1
      || input.draft.audience[0] !== scope.assigneeId
      || input.draft.kind !== TASK_ASSIGNMENT_ENVELOPE_KIND
      || input.draft.delivery !== 'turn'
      || input.draft.taskId !== scope.taskId
      || input.draft.payload.taskId !== scope.taskId
      || input.draft.payload.attemptId !== scope.attemptId
      || input.draft.payload.assignedRevision !== scope.assignedRevision
      || input.draft.payload.activationId !== scope.activationId
      || input.draft.payload.sessionId !== scope.sessionId) {
      return this.rejectEnvelopePostActor()
    }
    const task = team.projection.tasks.get(scope.taskId)
    const activation = this.findActivationBinding(team.projection, scope.activationId)
    if (task?.phase !== 'assigned'
      || task.revision !== scope.assignedRevision
      || task.lease?.attemptId !== scope.attemptId
      || task.lease.participantId !== scope.assigneeId
      || task.lease.activationId !== scope.activationId
      || task.lease.wakeChannelId !== channel.id
      || activation?.activation.participantId !== scope.assigneeId
      || activation.sessionId !== scope.sessionId
      || (activation.activation.status !== 'idle' && activation.activation.status !== 'running')) {
      return this.rejectEnvelopePostActor()
    }
    return scope.assigneeId
  }

  /** Validate one scheduler-owned completed-task review request. */
  private resolveSchedulerReviewRequestSender(
    team: LoadedTeam,
    channel: LoadedChannel,
    resolution: TeamSystemEnvelopePostProofResolution,
    input: ChannelEnvelopePostInput,
  ): ParticipantId {
    const scope = resolution.scope
    if (scope.kind !== 'scheduler-review-request'
      || resolution.sourceName !== TEAM_SCHEDULER_ENVELOPE_POST_PROOF_SOURCE
      || scope.teamId !== team.id
      || scope.channelId !== channel.id
      || team.projection.team.phase !== 'active'
      || channel.projection.phase !== 'active'
      || channel.projection.manifest.adapter.type !== CONSULT_CHANNEL_ADAPTER.type
      || channel.projection.manifest.adapter.version !== CONSULT_CHANNEL_ADAPTER.version
      || channel.projection.manifest.participants.length !== 2
      || !channel.projection.manifest.participants.some(member => member.id === scope.initiatorId && member.role === CONSULT_INITIATOR_ROLE)
      || !channel.projection.manifest.participants.some(member => member.id === scope.reviewerId && member.role === CONSULT_RESPONDENT_ROLE)
      || input.draft.channelId !== channel.id
      || input.draft.audience === null
      || input.draft.audience.length !== 1
      || input.draft.audience[0] !== scope.reviewerId
      || input.draft.kind !== CONSULT_REVIEW_REQUEST_KIND
      || input.draft.delivery !== 'turn'
      || input.draft.taskId !== scope.taskId
      || input.draft.payload.taskId !== scope.taskId
      || input.draft.payload.attemptId !== scope.attemptId
      || input.draft.payload.reviewRevision !== scope.reviewRevision
      || input.draft.payload.reviewerId !== scope.reviewerId
      || input.draft.payload.initiatorId !== scope.initiatorId) {
      return this.rejectEnvelopePostActor()
    }
    const task = team.projection.tasks.get(scope.taskId)
    const attempt = task?.attemptHistory.at(-1)
    const reviewer = team.projection.participants.get(scope.reviewerId)
    const reviewerActivation = this.findActivationBinding(team.projection, scope.reviewerActivationId)
    if (task?.phase !== 'review'
      || task.revision !== scope.reviewRevision
      || task.reviewPolicy.kind !== 'participant'
      || task.reviewPolicy.reviewerId !== scope.reviewerId
      || attempt?.id !== scope.attemptId
      || attempt.participantId !== scope.initiatorId
      || attempt.outcome.kind !== 'completed'
      || reviewer?.phase !== 'active'
      || reviewerActivation === undefined
      || reviewerActivation.activation.participantId !== scope.reviewerId
      || reviewerActivation.sessionId !== scope.reviewerSessionId
      || reviewerActivation.provider !== scope.reviewerProvider
      || reviewerActivation.activation.status !== 'idle') {
      return this.rejectEnvelopePostActor()
    }
    return scope.initiatorId
  }

  /** Reject every forged, stale, cross-scope, or unsupported ordinary-post actor uniformly. */
  private rejectEnvelopePostActor(): never {
    throw new TeamError('Channel Envelope actor is invalid for this Team admission', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Admit one authenticated draft after the caller acquired its Team and channel serializers. */
  private async admitChannelEnvelope(
    currentTeam: LoadedTeam,
    currentChannel: LoadedChannel,
    input: ResolvedChannelEnvelopePost,
  ): Promise<TeamEnvelope> {
    this.assertAttachedChannel(currentTeam, currentChannel)
    this.assertNoPendingParentCharges(currentTeam.projection)
    this.assertActiveChannelSender(currentTeam, currentChannel, input.senderId)
    if (input.idempotencyKey !== undefined) {
      const existing = currentChannel.projection.postIdempotency.get(input.senderId)?.get(input.idempotencyKey)
      if (existing !== undefined) {
        if (!samePostDraft(existing, input.draft)) {
          throw new TeamError(
            `idempotency key '${input.idempotencyKey}' was already used with a different channel post`,
            'TEAM_CHANNEL_IDEMPOTENCY_CONFLICT',
          )
        }
        return this.envelopeSnapshot(existing)
      }
      this.assertPostIdempotencyLimit(currentChannel.projection, currentTeam.projection)
    }
    this.assertTeamWallTime(currentTeam.projection)
    if (currentTeam.projection.team.phase !== 'active') {
      throw new TeamError(`Team '${currentTeam.id}' is not active`, 'TEAM_INVALID_ARGUMENT')
    }
    if (currentChannel.projection.phase !== 'active') {
      throw new TeamError(`channel '${currentChannel.id}' is not active`, 'TEAM_INVALID_ARGUMENT')
    }
    assertChannelCursor(currentChannel.projection.cursor, input.expectedCursor)
    this.assertEnvelopeMembership(currentTeam, currentChannel, input.senderId, input.draft.audience)
    this.assertDirectV4FinalAudience(currentTeam, currentChannel, input.senderId, input.draft)
    this.assertParticipantRateLimit(currentTeam.projection, input.senderId)
    if (input.draft.taskId !== undefined) {
      const task = currentTeam.projection.tasks.get(input.draft.taskId)
      if (task === undefined || task.phase === 'deleted') {
        throw new TeamError(`Team task '${input.draft.taskId}' was not found`, 'TEAM_TASK_NOT_FOUND')
      }
    }
    if (input.draft.causationId !== undefined
      && !await this.hasCommittedEnvelope(currentChannel, input.draft.causationId)) {
      throw new TeamError(
        `Envelope causation '${input.draft.causationId}' is not committed in channel '${currentChannel.id}'`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    const priority = input.draft.priority ?? 'normal'
    await this.authorizeOrThrow('send', currentTeam.id, {
      channelId: currentChannel.id,
      expectedCursor: input.expectedCursor,
      senderId: input.senderId,
      audience: input.draft.audience,
      kind: input.draft.kind,
      delivery: input.draft.delivery,
      priority,
      ...input.draft.taskId === undefined ? {} : { taskId: input.draft.taskId },
      ...input.draft.causationId === undefined ? {} : { causationId: input.draft.causationId },
      ...input.draft.correlationId === undefined ? {} : { correlationId: input.draft.correlationId },
      ...input.draft.traceId === undefined ? {} : { traceId: input.draft.traceId },
      ...input.draft.ttlMs === undefined ? {} : { ttlMs: input.draft.ttlMs },
    }, input.senderId)
    const envelope = this.stampEnvelope(currentTeam.id, currentChannel, input.senderId, input.draft, priority)
    this.assertEnvelopeByteLimit(envelope, currentTeam.projection)
    const adapter = currentChannel.adapter
    this.validateAdapterSend(adapter, currentChannel, input.senderId, input.draft)
    const envelopeRecord = prepareChannelEnvelopeRecord(currentChannel.projection, envelope, input.idempotencyKey, adapter)
    const afterEnvelope = this.foldChannelAppend(currentChannel.projection, [envelopeRecord], currentChannel.id, adapter)
    const adapterRecords = this.afterAcceptAdapterRecords(adapter, currentChannel, afterEnvelope, envelopeRecord)
      .map((draft, index): ChannelAdapterRecord => ({
        type: 'channel/adapter',
        sequence: envelope.sequence + index + 1,
        createdAt: envelope.createdAt,
        adapter: { ...currentChannel.projection.manifest.adapter },
        payload: structuredClone(draft.payload),
      }))
    const afterAdapterRecords = this.foldChannelAppend(afterEnvelope, adapterRecords, currentChannel.id, adapter)
    const closeReason = this.closeAfterAcceptReason(adapter, currentChannel, afterAdapterRecords, envelopeRecord)
    const closeRecords = closeReason === undefined
      ? []
      : this.channelCloseRecords(afterAdapterRecords, closeReason, envelope.createdAt)
    const records: readonly ChannelRecord[] = [envelopeRecord, ...adapterRecords, ...closeRecords]
    const projection = this.foldChannelAppend(afterAdapterRecords, closeRecords, currentChannel.id, adapter)
    this.assertPendingDeliveryLimit(projection, currentTeam.projection)
    const confirmedSenderId = input.revalidate()
    if (confirmedSenderId !== input.senderId) this.rejectEnvelopePostActor()
    this.assertEnvelopeMembership(currentTeam, currentChannel, confirmedSenderId, input.draft.audience)
    this.assertDirectV4FinalAudience(currentTeam, currentChannel, confirmedSenderId, input.draft)
    await this.commitChannel(currentChannel, records, projection)
    this.recordParticipantRate(currentTeam.projection, input.senderId, envelope.createdAt)
    const snapshot = this.envelopeSnapshot(envelope)
    return snapshot
  }

  /** Ask an adapter whether the accepted Envelope completed its protocol. */
  private closeAfterAcceptReason(
    adapter: TeamChannelAdapter,
    channel: LoadedChannel,
    projection: ChannelProjection,
    record: ChannelEnvelopeRecord,
  ): string | undefined {
    if (adapter.closeAfterAccept === undefined) return undefined
    const raw = this.callChannelAdapter(channel, () => adapter.closeAfterAccept?.({
      manifest: freeze(structuredClone(channel.projection.manifest)),
      state: freeze(structuredClone(projection.state)),
      record: freeze(structuredClone(record)),
    }))
    if (raw === undefined) return undefined
    try {
      return normalizedText(raw, 'channel close reason')
    } catch (error: unknown) {
      throw new TeamError(
        `Channel adapter '${channel.projection.manifest.adapter.type}' returned an invalid close reason`,
        'TEAM_CHANNEL_ADAPTER_REJECTED',
        { cause: error },
      )
    }
  }

  /** Build the two lifecycle records that atomically close an active channel. */
  private channelCloseRecords(
    projection: ChannelProjection, reason: string | undefined, createdAt: number,
  ): readonly ChannelRecord[] {
    let sequence = projection.cursor
    const records: ChannelRecord[] = [{ type: 'channel/phase', sequence: ++sequence, createdAt, phase: 'closing' }]
    for (const invitation of projection.invitations.values()) {
      if (invitation.status !== 'pending') continue
      records.push({ type: 'channel/invitation-ended', sequence: ++sequence, createdAt,
        invitation: { ...invitation, status: 'cancelled', settledAt: createdAt,
          reason: { code: 'TEAM_CHANNEL_INVITATION_CANCELLED', message: reason ?? 'Channel closed' } } })
    }
    records.push({ type: 'channel/closed', sequence: ++sequence, createdAt, phase: 'closed',
      ...reason === undefined ? {} : { reason: normalizedText(reason, 'reason') } })
    return records
  }

  /** Ask a registered protocol to derive its final draft from current locked channel facts. */
  private prepareChannelFinal(
    adapter: TeamChannelAdapter,
    channel: LoadedChannel,
    senderId: ParticipantId,
    text: string,
  ): TeamEnvelopeDraft {
    if (!supportsFinal(adapter)) {
      throw new TeamError(
        `Channel adapter '${channel.projection.manifest.adapter.type}' does not support final Envelope preparation`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    const prepared = this.callChannelAdapter(channel, () => adapter.prepareFinal({
      manifest: freeze(structuredClone(channel.projection.manifest)),
      state: freeze(structuredClone(channel.projection.state)),
      senderId,
      text,
    }))
    try {
      return teamEnvelopeDraftSchema.parse({
        channelId: channel.id,
        audience: prepared.audience,
        kind: prepared.kind,
        payload: prepared.payload,
        delivery: prepared.delivery,
      })
    } catch (error: unknown) {
      throw new TeamError(
        `Channel adapter '${channel.projection.manifest.adapter.type}' returned an invalid final Envelope draft`,
        'TEAM_CHANNEL_ADAPTER_REJECTED',
        { cause: error },
      )
    }
  }

  /** Invoke one adapter admission hook with immutable detached inputs. */
  private validateAdapterSend(
    adapter: TeamChannelAdapter,
    channel: LoadedChannel,
    senderId: ParticipantId,
    draft: TeamEnvelopeDraft,
  ): void {
    this.callChannelAdapter(channel, () => {
      adapter.validateSend({
        manifest: freeze(structuredClone(channel.projection.manifest)),
        state: freeze(structuredClone(channel.projection.state)),
        senderId,
        draft: freeze(structuredClone(draft)),
      })
    })
  }

  /** Derive and validate adapter-owned records before their atomic WAL append. */
  private afterAcceptAdapterRecords(
    adapter: TeamChannelAdapter,
    channel: LoadedChannel,
    afterEnvelope: ChannelProjection,
    record: ChannelEnvelopeRecord,
  ): readonly ChannelAdapterRecordDraft[] {
    const raw = this.callChannelAdapter(channel, () => adapter.afterAccept({
      manifest: freeze(structuredClone(channel.projection.manifest)),
      state: freeze(structuredClone(afterEnvelope.state)),
      record: freeze(structuredClone(record)),
    }))
    if (!Array.isArray(raw)) {
      throw new TeamError(
        `Channel adapter '${channel.projection.manifest.adapter.type}' returned non-array post-accept records`,
        'TEAM_CHANNEL_ADAPTER_REJECTED',
      )
    }
    return raw.map((draft) => {
      try {
        return channelAdapterRecordDraftSchema.parse(draft)
      } catch (error: unknown) {
        throw new TeamError(
          `Channel adapter '${channel.projection.manifest.adapter.type}' returned an invalid post-accept record`,
          'TEAM_CHANNEL_ADAPTER_REJECTED',
          { cause: error },
        )
      }
    })
  }

  /** Convert an adapter exception into the public rejection owned by this Hub. */
  private callChannelAdapter<T>(channel: LoadedChannel, operation: () => T): T {
    try {
      return operation()
    } catch (error: unknown) {
      this.incrementMetric('adapterFailures')
      throw new TeamError(
        `Channel adapter '${channel.projection.manifest.adapter.type}' rejected Envelope admission`,
        'TEAM_CHANNEL_ADAPTER_REJECTED',
        { cause: error },
      )
    }
  }

  /** Return the implementation retained by a manifest that requires a view policy. */
  private channelViewPolicy(channel: LoadedChannel): TeamViewPolicy {
    const policy = channel.viewPolicyLease
    if (policy === undefined) {
      throw new TeamHubError(
        `channel '${channel.id}' has a view-policy manifest without a retained implementation`,
        'TEAM_CHANNEL_WAL_MALFORMED',
      )
    }
    return policy.policy
  }

  /** Invoke a retained view policy only with a detached immutable channel slice. */
  private projectChannelView(channel: LoadedChannel, records: readonly ChannelRecord[]): JsonObject {
    const policy = this.channelViewPolicy(channel)
    try {
      return jsonObjectSchema.parse(policy.project({
        manifest: freeze(structuredClone(channel.projection.manifest)),
        records: freeze(structuredClone(records)),
      }))
    } catch (error: unknown) {
      this.incrementMetric('adapterFailures')
      throw new TeamError(
        `Channel view policy '${channel.projection.manifest.viewPolicy?.type ?? ''}' rejected delivery rendering`,
        'TEAM_CHANNEL_ADAPTER_REJECTED',
        { cause: error },
      )
    }
  }

  /** Identify channel protocols whose model delivery must persist a rendered view. */
  private requiresDurableChannelView(manifest: ChannelManifest): boolean {
    return manifest.adapter.type === 'consult'
      || manifest.adapter.type === 'discussion'
      || manifest.adapter.type === 'workflow'
  }

  /** Prove a full-transcript model view cannot exceed this Team's frozen byte limit. */
  private assertChannelViewBound(team: LoadedTeam, manifest: ChannelManifest): void {
    if (!this.requiresDurableChannelView(manifest) || manifest.viewPolicy?.type !== 'full-transcript') return
    const maxTurns = channelViewTurnBound(manifest)
    const maxEnvelopeBytes = this.teamLimit(team.projection, 'maxEnvelopeBytes', this.config.maxEnvelopeBytes)
    const maxViewBytes = this.teamLimit(team.projection, 'maxChannelViewBytes', this.config.maxChannelViewBytes)
    const perTurnBytes = maxEnvelopeBytes > Math.floor((Number.MAX_SAFE_INTEGER - 2_048) / 4)
      ? Number.MAX_SAFE_INTEGER
      : maxEnvelopeBytes * 4 + 2_048
    if (maxTurns === undefined
      || perTurnBytes > maxViewBytes || maxTurns > Math.floor(maxViewBytes / perTurnBytes)) {
      throw new TeamError(
        `channel '${manifest.id}' cannot prove its full-transcript view fits maxChannelViewBytes`,
        'TEAM_CHANNEL_BACKPRESSURE',
      )
    }
  }

  /** Hub-stamp one detached Envelope only after membership and policy admission. */
  private stampEnvelope(
    teamId: TeamId,
    channel: LoadedChannel,
    senderId: ParticipantId,
    draft: TeamEnvelopeDraft,
    priority: TeamEnvelope['priority'],
  ): TeamEnvelope {
    return {
      id: mintEnvelopeId(),
      teamId,
      channelId: channel.id,
      sequence: channel.projection.cursor + 1,
      senderId,
      audience: draft.audience === null ? null : [...draft.audience],
      kind: draft.kind,
      payload: structuredClone(draft.payload),
      delivery: draft.delivery,
      ...draft.causationId === undefined ? {} : { causationId: draft.causationId },
      ...draft.correlationId === undefined ? {} : { correlationId: draft.correlationId },
      ...draft.taskId === undefined ? {} : { taskId: draft.taskId },
      ...draft.traceId === undefined ? {} : { traceId: draft.traceId },
      priority,
      createdAt: Date.now(),
      ...draft.ttlMs === undefined ? {} : { ttlMs: draft.ttlMs },
    }
  }

  /** Enforce the configured complete durable Envelope size before a WAL append. */
  private assertEnvelopeByteLimit(envelope: TeamEnvelope, team: TeamProjection): void {
    const bytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8')
    const maxBytes = this.teamLimit(team, 'maxEnvelopeBytes', this.config.maxEnvelopeBytes)
    if (bytes > maxBytes) {
      throw new TeamError(
        `channel Envelope is ${bytes} bytes, exceeding maxEnvelopeBytes ${maxBytes}`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
  }

  /** Reject new Team work at or after the creation-time wall-clock deadline. */
  private assertTeamWallTime(team: TeamProjection): void {
    const maxWallTimeMs = this.teamLimit(team, 'maxWallTimeMsPerTeam', this.config.maxWallTimeMsPerTeam)
    const elapsed = Math.max(0, Date.now() - team.team.createdAt)
    const typedBudget = resourceBudget(team.budgets, 'Team budget')
    const typedLimit = typedBudget.maxWallTimeMs
    if (elapsed < maxWallTimeMs && (typedLimit === undefined || elapsed < typedLimit)) return
    const limit = typedLimit === undefined ? maxWallTimeMs : Math.min(maxWallTimeMs, typedLimit)
    throw new TeamError(
      `Team '${team.team.id}' exceeded its wall-time budget of ${String(limit)}ms`,
      'TEAM_CHANNEL_BACKPRESSURE',
    )
  }

  /** Reject a new assignment at concurrency capacity or a retry without remaining quota. */
  private assertTeamRuntimeBudget(projection: TeamProjection, task: TeamTaskSnapshot): void {
    if (task.execution.kind !== 'participant') throw new TeamError('Child tasks cannot receive Participant attempts', 'TEAM_INVALID_ARGUMENT')
    if (taskHasSharedWriteConflict(task, projection.tasks.values())) {
      throw new TeamError('Shared task scopes conflict with an active execution reservation', 'TEAM_INVALID_ARGUMENT')
    }
    const budget = resourceBudget(projection.budgets, 'Team budget')
    const usage = resourceBudgetUsage(projection)
    for (const key of ['maxRetries', 'maxConcurrency'] as const) {
      if (key === 'maxRetries' && task.attemptCount === 0) continue
      const limit = budget[key]
      if (limit !== undefined && usage[key] >= limit) {
        throw new TeamError(
          `Team '${projection.team.id}' reached its ${key} budget of ${String(limit)}`,
          'TEAM_BUDGET_EXCEEDED',
        )
      }
    }
  }

  /** Reject an append whose derived recipient admissions exceed the channel's configured capacity. */
  private assertPendingDeliveryLimit(projection: ChannelProjection, team: TeamProjection): void {
    const pending = [...projection.pendingDeliveries.values()].reduce((count, deliveries) => count + deliveries.size, 0)
    const maxPending = this.teamLimit(
      team,
      'maxPendingDeliveriesPerChannel',
      this.config.maxPendingDeliveriesPerChannel,
    )
    if (pending > maxPending) {
      throw new TeamError(
        `channel has ${pending} pending deliveries, exceeding maxPendingDeliveriesPerChannel ${maxPending}`,
        'TEAM_CHANNEL_BACKPRESSURE',
      )
    }
    const maxParticipantPending = Math.min(
      this.teamLimit(
        team,
        'maxPendingDeliveriesPerParticipant',
        this.config.maxPendingDeliveriesPerParticipant,
      ),
      this.teamLimit(team, 'maxInboxItemsPerParticipant', this.config.maxInboxItemsPerParticipant),
    )
    for (const [participantId, deliveries] of projection.pendingDeliveries) {
      if (deliveries.size > maxParticipantPending) {
        throw new TeamError(
          `participant '${participantId}' has ${deliveries.size} pending deliveries, exceeding maxPendingDeliveriesPerParticipant ${maxParticipantPending}`,
          'TEAM_CHANNEL_BACKPRESSURE',
        )
      }
    }
  }

  /** Reject a sender that exceeds the Team's deployment-frozen per-minute rate cap. */
  private assertParticipantRateLimit(team: TeamProjection, participantId: ParticipantId): void {
    const key = JSON.stringify([team.team.id, participantId])
    const current = this.participantRateWindows.get(key)
    if (current === undefined) return
    const now = Date.now()
    const limit = this.teamLimit(team, 'maxRatePerParticipantPerMinute', this.config.maxRatePerParticipantPerMinute)
    if (now - current.startAt < 60_000 && current.count >= limit) {
      throw new TeamError(
        `participant '${participantId}' exceeded maxRatePerParticipantPerMinute ${limit}`,
        'TEAM_CHANNEL_BACKPRESSURE',
      )
    }
  }

  /** Record one accepted sender admission in the process-local rate window. */
  private recordParticipantRate(team: TeamProjection, participantId: ParticipantId, acceptedAt: number): void {
    const key = JSON.stringify([team.team.id, participantId])
    const current = this.participantRateWindows.get(key)
    if (current === undefined || acceptedAt - current.startAt >= 60_000) {
      this.participantRateWindows.set(key, { startAt: acceptedAt, count: 1 })
      return
    }
    current.count += 1
  }

  /** Reject a new post key once the channel retains its configured retry-key capacity. */
  private assertPostIdempotencyLimit(projection: ChannelProjection, team: TeamProjection): void {
    const entries = [...projection.postIdempotency.values()].reduce((count, keys) => count + keys.size, 0)
    const maxEntries = this.teamLimit(
      team,
      'maxPostIdempotencyEntriesPerChannel',
      this.config.maxPostIdempotencyEntriesPerChannel,
    )
    if (entries >= maxEntries) {
      throw new TeamError(
        `channel retains ${entries} post retry keys, reaching maxPostIdempotencyEntriesPerChannel ${maxEntries}`,
        'TEAM_CHANNEL_BACKPRESSURE',
      )
    }
  }

  /** Open, validate, and fold one referenced channel WAL before publishing it. */
  private async openChannelStream(channelId: ChannelId): Promise<LoadedChannel> {
    const stream = await this.ctx.storageLog.open({
      name: channelStreamName(channelId),
      version: CHANNEL_WAL_FORMAT_VERSION,
    })
    const recovered = await this.recoverChannel(stream, channelId)
    const loaded: LoadedChannel = {
      readers: 0,
      id: channelId,
      stream,
      queue: new SerialQueue(),
      activity: new CursorActivity(),
      projection: recovered.projection,
      adapterLease: recovered.adapterLease,
      adapter: recovered.adapter,
      ...recovered.viewPolicyLease === undefined ? {} : { viewPolicyLease: recovered.viewPolicyLease },
      ...recovered.adapterRuntimeLease === undefined ? {} : { adapterRuntimeLease: recovered.adapterRuntimeLease },
      invalid: false,
    }
    this.channels.set(channelId, loaded)
    this.retainChannel(loaded)
    this.markChannelTerminal(loaded)
    return loaded
  }

  /** Rebuild a channel from its checkpoint and WAL, settling the stream and acquired implementations on failure. */
  private async recoverChannel(stream: HubLogStream, channelId: ChannelId): Promise<RecoveredChannel> {
    let adapterLease: TeamAdapterLease | undefined
    let adapter: TeamChannelAdapter | undefined
    let viewPolicyLease: TeamViewPolicyLease | undefined
    let adapterRuntimeLease: TeamChannelAdapterRuntimeLease | undefined
    try {
      const checkpoint = await stream.readCheckpoint()
      const restored = checkpoint === undefined ? undefined : await this.restoreChannelCheckpoint(stream, channelId, checkpoint)
      let projection = restored?.projection
      let cursor = restored?.cursor ?? EMPTY_CURSOR
      if (projection !== undefined) {
        ({ adapterLease, adapter, viewPolicyLease, adapterRuntimeLease } = this.acquireChannelImplementations(projection.manifest))
      }
      while (true) {
        const entries = await stream.read(cursor, this.config.recoveryPageSize)
        if (entries.length === 0) break
        for (const entry of entries) {
          /* v8 ignore next 3 -- LogStream opens only validated contiguous durable entries. */
          if (entry.sequence !== cursor + 1) {
            throw new TeamHubError(`channel '${channelId}' WAL has a cursor gap at ${entry.sequence}`, 'TEAM_CHANNEL_WAL_MALFORMED')
          }
          const record = parseChannelRecord(entry.value, channelId)
          if (projection === undefined) {
            /* v8 ignore next 3 -- a valid channel WAL always starts with its opening record. */
            if (record.type !== 'channel/opened') {
              throw new TeamHubError(`channel '${channelId}' WAL does not start with an opening record`, 'TEAM_CHANNEL_WAL_MALFORMED')
            }
            ({ adapterLease, adapter, viewPolicyLease, adapterRuntimeLease } = this.acquireChannelImplementations(record.manifest))
          }
          /* v8 ignore next -- a first opening record selects an adapter before it reaches the fold. */
          if (adapter === undefined) throw new TeamHubError(`channel '${channelId}' has no adapter`, 'TEAM_CHANNEL_WAL_MALFORMED')
          projection = foldChannelRecord(projection, record, entry.sequence, channelId, adapter)
          if (record.type === 'channel/summary') {
            await this.validateChannelSummaryRecord(stream, channelId, record, projection.manifest)
          }
          cursor = entry.sequence
        }
      }
      /* v8 ignore next 3 -- an opened WAL folds at least its opening record. */
      if (projection === undefined || adapterLease === undefined || adapter === undefined) {
        throw new TeamError(`Channel '${channelId}' was not found`, 'TEAM_CHANNEL_NOT_FOUND')
      }
      return {
        projection,
        adapterLease,
        adapter,
        ...viewPolicyLease === undefined ? {} : { viewPolicyLease },
        ...adapterRuntimeLease === undefined ? {} : { adapterRuntimeLease },
      }
    } catch (error: unknown) {
      return await closeChannelAfterFailure(stream, error, () => {
        releaseChannelImplementations(adapterRuntimeLease, viewPolicyLease, adapterLease)
      }, `Team Hub channel '${channelId}' recovery failed during cleanup`)
    }
  }

  /** Trust a channel checkpoint only when its durable anchor and identity agree. */
  private async restoreChannelCheckpoint(
    stream: HubLogStream,
    channelId: ChannelId,
    checkpoint: { readonly sequence: number; readonly value: unknown },
  ): Promise<{ readonly projection: ChannelProjection; readonly cursor: number } | undefined> {
    const parsed = channelProjectionCheckpointSchema.safeParse(checkpoint.value)
    /* v8 ignore next 4 -- channel checkpoint mismatches fall back through the same replay path as malformed Team checkpoints. */
    if (!parsed.success || parsed.data.channelId !== channelId || parsed.data.projection.manifest.id !== channelId
      || parsed.data.projection.cursor !== checkpoint.sequence) {
      return undefined
    }
    // v8 ignore next -- storage rejects checkpoints detached from their durable watermark.
    if (!await hasCheckpointAnchor(stream, checkpoint.sequence)) return undefined
    try {
      for (const summary of parsed.data.projection.summaries) {
        await this.validateChannelSummaryRecord(stream, channelId, summary, parsed.data.projection.manifest)
      }
      return { projection: channelProjectionFromData(parsed.data.projection), cursor: checkpoint.sequence }
    } catch (error: unknown) {
      /* v8 ignore next 2 -- semantic checkpoint damage falls back to WAL replay when injected by a storage fault. */
      this.ctx.logger.warn(`team-hub: ignored invalid channel checkpoint '${channelId}': ${renderError(error)}`)
      // v8 ignore next -- the malformed checkpoint is intentionally ignored after its diagnostic is recorded.
      return undefined
    }
  }

  /** Materialize a fresh channel WAL before its owning Team references it. */
  private async createChannel(
    manifest: ChannelManifest,
    beforeAppend?: () => void | Promise<void>,
    options: readonly ChannelInvitationOptions[] = [],
  ): Promise<CreatedChannel> {
    const { adapterLease, adapter, viewPolicyLease, adapterRuntimeLease } = this.acquireChannelImplementations(manifest)
    let stream: HubLogStream | undefined
    try {
      stream = await this.ctx.storageLog.open({
        name: channelStreamName(manifest.id),
        version: CHANNEL_WAL_FORMAT_VERSION,
      })
      await beforeAppend?.()
      const createdAt = Date.now()
      const invitations = this.resolveChannelInvitations(manifest, options, createdAt)
      const records: readonly ChannelRecord[] = [
        { type: 'channel/opened', sequence: 0, createdAt, manifest },
        { type: 'channel/phase', sequence: 1, createdAt, phase: 'pending' },
        ...invitations.map((invitation, index): ChannelRecord => ({
          type: 'channel/invitation', sequence: index + 2, createdAt, invitation,
        })),
      ]
      let projection: ChannelProjection | undefined
      for (const record of records) {
        projection = foldChannelRecord(projection, record, channelRecordCursor(record), manifest.id, adapter)
      }
      /* v8 ignore next 3 -- this fixed non-empty channel creation batch always folds a projection. */
      if (projection === undefined) {
        throw new TeamHubError(`channel '${manifest.id}' creation did not produce a projection`, 'TEAM_CHANNEL_WAL_MALFORMED')
      }
      const appended = await stream.append(EMPTY_CURSOR, records)
      /* v8 ignore next 3 -- LogStream append returns the final cursor of its accepted batch. */
      if (appended.tailSequence !== records.length - 1) {
        throw new TeamHubError(`channel '${manifest.id}' append returned an unexpected tail`, 'TEAM_CHANNEL_WAL_MALFORMED')
      }
      const loaded: LoadedChannel = {
        readers: 0,
        id: manifest.id,
        stream,
        queue: new SerialQueue(),
        activity: new CursorActivity(),
        projection,
        adapterLease,
        adapter,
        ...viewPolicyLease === undefined ? {} : { viewPolicyLease },
        ...adapterRuntimeLease === undefined ? {} : { adapterRuntimeLease },
        invalid: false,
      }
      this.channels.set(manifest.id, loaded)
      this.retainChannel(loaded)
      return { channel: loaded, records }
    } catch (error: unknown) {
      return await closeChannelAfterFailure(stream, error, () => {
        releaseChannelImplementations(adapterRuntimeLease, viewPolicyLease, adapterLease)
      }, `Team Hub channel '${manifest.id}' creation failed during cleanup`)
    }
  }

  /** Resolve required members, deadlines and protocol-specific endpoint expectations before WAL append. */
  private resolveChannelInvitations(
    manifest: ChannelManifest, options: readonly ChannelInvitationOptions[], createdAt: number,
  ): readonly ChannelInvitationSnapshot[] {
    const team = this.teams.get(manifest.teamId)
    if (team === undefined) throw new TeamError('Channel Team is unavailable', 'TEAM_NOT_FOUND')
    const ids = new Set(manifest.participants.map(member => member.id))
    if (new Set(options.map(option => option.participantId)).size !== options.length
      || options.some(option => !ids.has(option.participantId))) {
      throw new TeamError('Invitation options must select distinct channel members', 'TEAM_INVALID_ARGUMENT')
    }
    const deadline = createdAt + this.config.channelInvitationTimeoutMs
    if (!Number.isSafeInteger(deadline)) throw new TeamError('Invitation deadline is not representable', 'TEAM_INVALID_ARGUMENT')
    const manifestFingerprint = fingerprintChannelManifest(manifest)
    const invitations = manifest.participants.map((member): ChannelInvitationSnapshot => {
      const participant = team.projection.participants.get(member.id)
      if (participant === undefined) throw new TeamError('Invited participant is unavailable', 'TEAM_PARTICIPANT_NOT_FOUND')
      const endpoint = isAgentParticipant(participant)
        ? { kind: 'activation' as const,
          ...manifest.adapter.type === TASK_ASSIGNMENT_CHANNEL_ADAPTER.type
            && manifest.adapter.version === TASK_ASSIGNMENT_CHANNEL_ADAPTER.version
            && typeof manifest.limits.activationId === 'string' && typeof manifest.limits.sessionId === 'string'
            ? { activationId: manifest.limits.activationId as ActivationId, sessionId: manifest.limits.sessionId as ActivationBindingSnapshot['sessionId'] } : {} }
        : participant.kind === 'human' ? { kind: 'human' as const } : { kind: 'service' as const, name: participant.role }
      return { participantId: member.id, role: member.role, visibility: 'channel',
        required: options.find(option => option.participantId === member.id)?.required ?? true,
        deadline, endpoint, revision: 1, manifestFingerprint, status: 'pending' }
    })
    if (!invitations.some(invitation => invitation.required)) {
      throw new TeamError('A channel requires at least one required endpoint invitation', 'TEAM_INVALID_ARGUMENT')
    }
    return invitations
  }

  /** Publish a newly created channel only after its Team attachment is durable. */
  private async publishCreatedChannel(created: CreatedChannel): Promise<void> {
    const { channel, records } = created
    for (const record of records) this.emitChannelRecord(channel.id, record)
    channel.activity.notify(channel.projection.cursor)
    await this.maybeCheckpointChannel(channel)
    await this.maintainAuditProjection(channel.projection.manifest.teamId, 'channel', channel.stream, channel.id)
  }

  /** Acquire every implementation frozen into one channel before its WAL can become live. */
  private acquireChannelImplementations(manifest: ChannelManifest): {
    readonly adapterLease: TeamAdapterLease
    readonly adapter: TeamChannelAdapter
    readonly viewPolicyLease?: TeamViewPolicyLease | undefined
    readonly adapterRuntimeLease?: TeamChannelAdapterRuntimeLease | undefined
  } {
    if (this.requiresDurableChannelView(manifest) && manifest.viewPolicy === undefined) {
      throw new TeamError(
        `channel '${manifest.id}' requires an explicit model view policy`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    const adapterLease = this.acquireAdapter(manifest.adapter)
    let viewPolicyLease: TeamViewPolicyLease | undefined
    let adapterRuntimeLease: TeamChannelAdapterRuntimeLease | undefined
    try {
      viewPolicyLease = manifest.viewPolicy === undefined
        ? undefined
        : this.acquireViewPolicy(manifest.viewPolicy)
      adapterRuntimeLease = adapterLease.adapter.acquireRuntimeLease?.(manifest)
      return {
        adapterLease,
        adapter: adapterRuntimeLease?.adapter ?? adapterLease.adapter,
        ...viewPolicyLease === undefined ? {} : { viewPolicyLease },
        ...adapterRuntimeLease === undefined ? {} : { adapterRuntimeLease },
      }
    } catch (error: unknown) {
      releaseChannelImplementations(adapterRuntimeLease, viewPolicyLease, adapterLease)
      throw error
    }
  }

  /** Append a validated Team batch with terminal task interaction cleanup, then publish its complete projection. */
  private async commitTeam(loaded: LoadedTeam, records: readonly TeamJournalRecord[]): Promise<void> {
    const current = this.requireLiveTeam(loaded)
    let projection = current.projection
    let cursor = projection.team.cursor
    const events: TeamEvent[] = []
    const acceptedRecords = [...records]
    for (const record of records) {
      cursor += 1
      projection = foldTeamRecord(projection, record, cursor, loaded.id)
      events.push(teamEventFor(record, projection))
    }
    for (const record of workflowOutcomeRecords(projection)) {
      acceptedRecords.push(record)
      cursor += 1
      projection = foldTeamRecord(projection, record, cursor, loaded.id)
      events.push(teamEventFor(record, projection))
    }
    const cancelledTaskIds = new Set(acceptedRecords.flatMap(record => record.type === 'task/changed'
      && record.task.phase === 'cancelled' && (record.task.cancellation !== undefined || record.task.blockedByOutcome !== undefined) ? [record.task.id] : []))
    for (const action of projection.humanActions.values()) {
      if (action.phase !== 'pending' || action.taskId === undefined || !cancelledTaskIds.has(action.taskId)) continue
      const createdAt = projection.team.updatedAt
      const record: TeamJournalRecord = { type: 'human-action/changed', createdAt, action: {
        ...structuredClone(action), phase: 'cancelled', updatedAt: createdAt,
        outcome: { kind: 'task-cancelled', taskId: action.taskId },
      } }
      acceptedRecords.push(record)
      cursor += 1
      projection = foldTeamRecord(projection, record, cursor, loaded.id)
      events.push(teamEventFor(record, projection))
    }
    assertTaskCancellationSettlements(projection)
    try {
      const appended = await current.stream.append(current.projection.team.cursor, acceptedRecords, {
        summary: this.discoverySummary(projection),
      })
      /* v8 ignore next 3 -- LogStream append returns the final cursor of its accepted batch. */
      if (appended.tailSequence !== cursor) {
        throw new TeamHubError(`Team '${loaded.id}' append returned an unexpected tail`, 'TEAM_JOURNAL_MALFORMED')
      }
    } catch (error: unknown) {
      // v8 ignore next -- normal backends either accept the batch or report sequence-conflict.
      if (isSequenceConflict(error)) {
        await this.invalidateTeam(current)
        throw new TeamError(`Team '${loaded.id}' journal cursor changed outside this Hub`, 'TEAM_CURSOR_CONFLICT', { cause: error })
      }
      // v8 ignore next -- non-conflict backend errors retain their original diagnostic identity.
      throw error
    }
    current.projection = projection
    for (const [index, record] of acceptedRecords.entries()) {
      if (record.type === 'policy/denied') current.policyDenialCursors.add(current.projection.team.cursor - acceptedRecords.length + index + 1)
    }
    for (const event of events) this.emitTeamEvent(event)
    current.activity.notify(projection.team.cursor)
    if (projection.team.archivedAt !== undefined) current.activity.close()
    await this.maybeCheckpointTeam(current)
    await this.maintainAuditProjection(loaded.id, 'team', current.stream)
  }

  /** Map an invalid caller-supplied record to a public Team command failure before append. */
  private async commitTeamCommand(
    loaded: LoadedTeam,
    records: readonly TeamJournalRecord[],
    code: TeamErrorCode,
  ): Promise<void> {
    try {
      await this.commitTeam(loaded, records)
    } catch (error: unknown) {
      if (error instanceof TeamHubError && error.code === 'TEAM_JOURNAL_MALFORMED') {
        throw new TeamError(error.message, code, { cause: error })
      }
      throw error
    }
  }

  /** Fold a candidate channel-WAL suffix without publishing it or touching storage. */
  private foldChannelAppend(
    projection: ChannelProjection,
    records: readonly ChannelRecord[],
    channelId: ChannelId,
    adapter: TeamChannelAdapter,
  ): ChannelProjection {
    let next = projection
    let cursor = projection.cursor
    for (const record of records) {
      cursor += 1
      next = foldChannelRecord(next, record, cursor, channelId, adapter)
    }
    return next
  }

  /** Append a prevalidated channel-WAL batch, then update memory and notify. */
  private async commitChannel(
    loaded: LoadedChannel,
    records: readonly ChannelRecord[],
    projected?: ChannelProjection,
  ): Promise<void> {
    const current = this.requireLiveChannel(loaded)
    const projection = projected ?? this.foldChannelAppend(
      current.projection,
      records,
      current.id,
      current.adapter,
    )
    const cursor = projection.cursor
    try {
      const appended = await current.stream.append(current.projection.cursor, records)
      /* v8 ignore next 3 -- LogStream append returns the final cursor of its accepted batch. */
      if (appended.tailSequence !== cursor) {
        throw new TeamHubError(`channel '${loaded.id}' append returned an unexpected tail`, 'TEAM_CHANNEL_WAL_MALFORMED')
      }
    } catch (error: unknown) {
      // v8 ignore next -- normal backends either accept the batch or report sequence-conflict.
      if (isSequenceConflict(error)) {
        // The current handle still owns the exact implementations selected for
        // this channel. Reconcile the external winner through those same
        // implementations before exposing the conflict; discarding here would
        // release a lease that may still be needed by the retrying caller.
        await this.refreshChannelProjection(current)
        throw new TeamError(`channel '${loaded.id}' WAL cursor changed outside this Hub`, 'TEAM_CHANNEL_CURSOR_CONFLICT', { cause: error })
      }
      // v8 ignore next -- non-conflict backend errors retain their original diagnostic identity.
      throw error
    }
    current.projection = projection
    if (isTerminalChannelPhase(projection.phase)) this.markChannelTerminal(current)
    else current.activity.notify(projection.cursor)
    for (const record of records) this.emitChannelRecord(current.id, record)
    await this.maybeCheckpointChannel(current)
    await this.maintainAuditProjection(current.projection.manifest.teamId, 'channel', current.stream, current.id)
  }

  /** Persist a monotonic Team checkpoint at the configured record cadence. */
  private async maybeCheckpointTeam(loaded: LoadedTeam, force = false): Promise<void> {
    const cursor = loaded.projection.team.cursor
    if (!force && (cursor + 1) % this.config.checkpointEvery !== 0) return
    const checkpoint: TeamProjectionCheckpoint = {
      kind: 'team-projection',
      version: TEAM_CHECKPOINT_FORMAT_VERSION,
      teamId: loaded.id,
      projection: teamProjectionData(loaded.projection),
    }
    try {
      await loaded.stream.writeCheckpoint({ sequence: cursor, value: checkpoint })
    } catch (error: unknown) {
      this.incrementMetric('checkpointFailures')
      this.ctx.logger.warn(`team-hub: Team checkpoint '${loaded.id}' failed after durable commit: ${renderError(error)}`)
    }
  }

  /** Persist a monotonic channel checkpoint at the configured record cadence. */
  private async maybeCheckpointChannel(loaded: LoadedChannel, force = false): Promise<void> {
    const cursor = loaded.projection.cursor
    if (!force && (cursor + 1) % this.config.checkpointEvery !== 0) return
    const checkpoint: ChannelProjectionCheckpoint = {
      kind: 'channel-projection',
      version: CHANNEL_CHECKPOINT_FORMAT_VERSION,
      channelId: loaded.id,
      projection: channelProjectionData(loaded.projection),
    }
    try {
      await loaded.stream.writeCheckpoint({ sequence: cursor, value: checkpoint })
    } catch (error: unknown) {
      this.incrementMetric('checkpointFailures')
      this.ctx.logger.warn(`team-hub: channel checkpoint '${loaded.id}' failed after durable commit: ${renderError(error)}`)
    }
  }

  /** Release one orphaned or conflict-invalidated channel handle. */
  private async discardChannel(loaded: LoadedChannel): Promise<void> {
    loaded.invalid = true
    loaded.activity.close()
    this.terminalChannels.delete(loaded)
    // v8 ignore next -- a replacement channel projection can only arrive after this invalidation completes.
    if (this.channels.get(loaded.id) === loaded) this.channels.delete(loaded.id)
    let release: Promise<void> | undefined
    try {
      const cleanup = this.closeChannelResources(loaded)
      release = cleanup.then(() => undefined, () => undefined)
      this.channelReleases.set(loaded.id, release)
      await cleanup
    } catch (error: unknown) {
      // v8 ignore next -- a close failure is logged after the orphan marker has been removed.
      this.ctx.logger.warn(`team-hub: channel '${loaded.id}' close failed: ${renderError(error)}`)
    } finally {
      if (release !== undefined && this.channelReleases.get(loaded.id) === release) {
        this.channelReleases.delete(loaded.id)
      }
    }
  }

  /** Mark a terminal channel and defer cleanup until admissions and pending deliveries quiesce. */
  private markChannelTerminal(loaded: LoadedChannel): void {
    if (!isTerminalChannelPhase(loaded.projection.phase)) return
    loaded.activity.close()
    if (pendingDeliveryCount(loaded.projection) > 0) return
    this.terminalChannels.add(loaded)
  }

  /** Evict terminal handles only after no accepted operation can still read them. */
  private async evictTerminalChannels(): Promise<void> {
    if (this.closing || this.accepted.size !== 0) return
    const terminal = [...this.terminalChannels].filter(channel => channel.readers === 0)
    for (const channel of terminal) this.terminalChannels.delete(channel)
    await Promise.all(terminal.map(channel => this.discardChannel(channel)))
  }

  /** Share one physical channel close and lease release across all teardown paths. */
  private closeChannelResources(loaded: LoadedChannel): Promise<void> {
    const cleanup = loaded.cleanup ??= (async () => {
      try {
        await loaded.stream.close()
      } finally {
        releaseChannelImplementations(loaded.adapterRuntimeLease, loaded.viewPolicyLease, loaded.adapterLease)
      }
    })()
    this.channelCleanups.add(cleanup)
    void cleanup.then(
      () => { this.channelCleanups.delete(cleanup) },
      () => { this.channelCleanups.delete(cleanup) },
    )
    return cleanup
  }

  /** Invalidate a stale Team projection before a caller explicitly recovers it. */
  private async invalidateTeam(loaded: LoadedTeam): Promise<void> {
    loaded.invalid = true
    loaded.activity.close()
    // v8 ignore next -- a replacement Team projection can only arrive after this invalidation completes.
    if (this.teams.get(loaded.id) === loaded) this.teams.delete(loaded.id)
    try {
      await loaded.stream.close()
    } catch (error: unknown) {
      // v8 ignore next -- a conflict-release failure is diagnostic-only after invalidation.
      this.ctx.logger.warn(`team-hub: Team '${loaded.id}' close after cursor conflict failed: ${renderError(error)}`)
    }
  }

  /** Invalidate a stale channel projection before a caller explicitly recovers it. */
  private async invalidateChannel(loaded: LoadedChannel): Promise<void> {
    await this.discardChannel(loaded)
  }

  /** Return one task from the current Team projection or raise the owned missing-task error. */
  private requireTask(loaded: LoadedTeam, taskId: TeamTaskId): TeamTaskSnapshot {
    const task = loaded.projection.tasks.get(taskId)
    if (task === undefined) throw new TeamError(`Team task '${taskId}' was not found`, 'TEAM_TASK_NOT_FOUND')
    return task
  }

  /** Reject a task operation whose caller did not fence the exact current revision. */
  private assertTaskRevision(task: TeamTaskSnapshot, expectedRevision: number): void {
    if (task.revision !== expectedRevision) {
      throw new TeamError(
        `Team task '${task.id}' revision ${expectedRevision} is stale; current revision is ${task.revision}`,
        'TEAM_TASK_STALE_REVISION',
      )
    }
  }

  /** Reject a goal mutation whose caller did not fence the exact current revision. */
  private assertGoalRevision(goal: TeamGoalSnapshot, expectedRevision: number): void {
    if (goal.revision !== expectedRevision) {
      throw new TeamError(
        `Team goal '${goal.teamId}' revision ${expectedRevision} is stale; current revision is ${goal.revision}`,
        'TEAM_GOAL_STALE_REVISION',
      )
    }
  }

  /** Reject a phase command that is not one permitted lifecycle edge for the current goal. */
  private assertGoalPhaseTransition(goal: TeamGoalSnapshot, phase: TeamGoalPhaseTransitionRequest['phase']): void {
    try {
      assertTeamGoalPhaseTransition(goal.phase, phase)
    } catch (error: unknown) {
      throw new TeamError(`Team goal '${goal.teamId}' cannot transition from '${goal.phase}' to '${phase}'`, 'TEAM_INVALID_ARGUMENT', {
        cause: error,
      })
    }
  }

  /** Require the durable Team participant selected for assignment to remain active. */
  private requireActiveParticipant(loaded: LoadedTeam, participantId: ParticipantId): ParticipantSnapshot {
    const participant = loaded.projection.participants.get(participantId)
    if (participant?.phase !== 'active') {
      throw new TeamError(`Team participant '${participantId}' is not active`, 'TEAM_PARTICIPANT_NOT_FOUND')
    }
    return participant
  }

  /** Recognize one exact human-controlled task creation before the Team load begins. */
  private isHumanTaskCreateActor(
    actor: TeamActorProof | TeamHumanActorProof,
    input: TeamTaskCreateInput,
  ): actor is TeamHumanActorProof {
    return this.isHumanTaskActor(actor, this.humanTaskCreateProofInput(input))
  }

  /** Recognize one exact human-controlled task-details edit before the Team load begins. */
  private isHumanTaskDetailsActor(
    actor: TeamActorProof | TeamHumanActorProof,
    input: TeamTaskDetailsUpdateInput,
  ): actor is TeamHumanActorProof {
    return this.isHumanTaskActor(actor, this.humanTaskRevisionProofInput(input))
  }

  /** Recognize one exact human-controlled task cancellation before the Team load begins. */
  private isHumanTaskCancelActor(
    actor: TeamSystemTaskControlProof | TeamHumanActorProof,
    input: TeamTaskCancelInput,
  ): actor is TeamHumanActorProof {
    return this.isHumanTaskActor(actor, this.humanTaskCancelProofInput(input))
  }

  /** Recognize one exact human-controlled task tombstone request before the Team load begins. */
  private isHumanTaskDeleteActor(
    actor: TeamActorProof | TeamHumanActorProof,
    input: TeamTaskDeleteInput,
  ): actor is TeamHumanActorProof {
    return this.isHumanTaskActor(actor, this.humanTaskRevisionProofInput(input))
  }

  /** Resolve one human proof against a complete task mutation input before any policy or durable append. */
  private isHumanTaskActor(actor: unknown, expected: TeamHumanActorProofInput): actor is TeamHumanActorProof {
    const human = this.tryResolveHumanActorProof(actor)
    if (human === undefined) return false
    this.assertHumanTaskProofScope(human, expected)
    return true
  }

  /** Build the complete parsed task-create input whose cursor fence the authenticated human proof retains. */
  private humanTaskCreateProofInput(input: TeamTaskCreateInput): TeamHumanActorProofInput {
    return {
      teamId: input.teamId,
      operation: 'task-mutate',
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Build one complete parsed revision-fenced task input for authenticated human proof matching. */
  private humanTaskRevisionProofInput(
    input: TeamTaskDetailsUpdateInput | TeamTaskDeleteInput,
  ): TeamHumanActorProofInput {
    return {
      teamId: input.teamId,
      operation: 'task-mutate',
      fence: { kind: 'revision', revision: input.expectedRevision },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Build the complete parsed task-cancel input whose revision fence the authenticated human proof retains. */
  private humanTaskCancelProofInput(input: TeamTaskCancelInput): TeamHumanActorProofInput {
    return this.humanTaskRevisionProofInput(input)
  }

  /** Build the complete parsed review input, including its externally selected Team identity. */
  private humanTaskReviewProofInput(
    teamId: TeamId,
    input: TeamTaskReviewResolveInput,
  ): TeamHumanActorProofInput {
    return {
      teamId,
      operation: 'task-mutate',
      fence: { kind: 'revision', revision: input.expectedRevision },
      payload: jsonObjectSchema.parse({ teamId, ...structuredClone(input) }),
    }
  }

  /** Re-resolve the live authenticated human and exact task mutation scope under the Team serializer. */
  private resolveHumanTaskAuthority(
    team: LoadedTeam,
    actor: TeamHumanActorProof,
    expected: TeamHumanActorProofInput,
    allowStalled = false,
  ): ParticipantId {
    const scope = this.requireHumanActorProof(actor).scope
    this.assertHumanTaskProofScope(scope, expected)
    if (scope.teamId !== team.id) this.rejectHumanTaskActor()
    const participant = this.requireActiveParticipant(team, scope.participantId)
    if ((team.projection.team.phase !== 'active' && !(allowStalled && team.projection.team.phase === 'stalled'))
      || team.projection.team.closure !== undefined
      || team.projection.team.cancellation !== undefined
      || participant.kind !== 'human') {
      this.rejectHumanTaskActor()
    }
    return participant.id
  }

  /** Re-resolve one human task-create proof and derive its durable creator attribution. */
  private createCommandFromHuman(
    team: LoadedTeam,
    actor: TeamHumanActorProof,
    input: TeamTaskCreateInput,
  ): TeamTaskCreateCommand {
    return {
      creator: {
        teamId: team.id,
        participantId: this.resolveHumanTaskAuthority(team, actor, this.humanTaskCreateProofInput(input)),
      },
      idempotencyKey: input.createCommand.idempotencyKey,
    }
  }

  /** Re-resolve one human task-details proof under the Team serializer. */
  private resolveHumanTaskDetailsAuthority(
    team: LoadedTeam,
    actor: TeamHumanActorProof,
    input: TeamTaskDetailsUpdateInput,
  ): ParticipantId {
    return this.resolveHumanTaskAuthority(team, actor, this.humanTaskRevisionProofInput(input))
  }

  /** Re-resolve one human task-cancel proof under the Team serializer. */
  private resolveHumanTaskCancelAuthority(
    team: LoadedTeam,
    actor: TeamHumanActorProof,
    input: TeamTaskCancelInput,
  ): ParticipantId {
    return this.resolveHumanTaskAuthority(team, actor, this.humanTaskCancelProofInput(input))
  }

  /** Re-resolve one human task-delete proof under the Team serializer. */
  private resolveHumanTaskDeleteAuthority(
    team: LoadedTeam,
    actor: TeamHumanActorProof,
    input: TeamTaskDeleteInput,
  ): ParticipantId {
    return this.resolveHumanTaskAuthority(team, actor, this.humanTaskRevisionProofInput(input), true)
  }

  /** Re-resolve one human review proof and ensure its human maps to the durable reviewer policy. */
  private resolveHumanTaskReviewAuthority(
    team: LoadedTeam,
    actor: TeamHumanActorProof,
    input: TeamTaskReviewResolveInput,
  ): ParticipantId {
    return this.resolveHumanTaskAuthority(team, actor, this.humanTaskReviewProofInput(team.id, input))
  }

  /** Reject a human proof whose task operation, Team, payload, or fence does not match. */
  private assertHumanTaskProofScope(scope: TeamHumanActorScope, expected: TeamHumanActorProofInput): void {
    if (scope.teamId !== expected.teamId
      || scope.operation !== expected.operation
      || scope.payloadFingerprint !== fingerprintTeamHumanActorPayload(expected)
      || !isDeepStrictEqual(scope.fence, expected.fence)) {
      this.rejectHumanTaskActor()
    }
  }

  /** Reject forged, revoked, stale, cross-Team, or wrong-operation authenticated-human task authority. */
  private rejectHumanTaskActor(): never {
    throw new TeamError('Human task actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Resolve an opaque coordinator proof before repair and again under the Team lock before durable acceptance. */
  private requireCoordinatorTaskAuthorityForTeam(actor: TeamActorProof | undefined, teamId: TeamId): TeamActorProof {
    if (actor === undefined || this.requireActivationActorProof(actor).activation.teamId !== teamId) {
      return this.rejectCoordinatorTaskActor()
    }
    return actor
  }

  /** Re-resolve a coordinator proof under the Team lock and derive its durable task provenance. */
  private coordinatorTaskCreator(loaded: LoadedTeam, actor: TeamActorProof): TeamTaskCreator {
    const binding = this.requireCurrentActivationActorBinding(loaded, actor)
    const participant = loaded.projection.participants.get(binding.activation.participantId)
    if (participant?.phase !== 'active' || !isAgentParticipant(participant) || participant.role !== 'coordinator') {
      return this.rejectCoordinatorTaskActor()
    }
    return {
      teamId: binding.activation.teamId,
      participantId: binding.activation.participantId,
      activationId: binding.activation.id,
      sessionId: binding.sessionId,
      provider: binding.provider,
    }
  }

  /** Derive one durable task-command record from a current coordinator proof and JSON retry identity. */
  private createCommandFromCoordinator(
    loaded: LoadedTeam,
    actor: TeamActorProof,
    idempotencyKey: TeamTaskCreateCommand['idempotencyKey'],
  ): TeamTaskCreateCommand {
    return { creator: this.coordinatorTaskCreator(loaded, actor), idempotencyKey }
  }

  /** Reject forged, revoked, foreign, stale, or non-coordinator task-admission authority uniformly. */
  private rejectCoordinatorTaskActor(): never {
    throw new TeamError('Coordinator task actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Require every declared workflow role to resolve before plan admission. */
  private assertWorkflowPlanParticipants(projection: TeamProjection, plan: TeamWorkflowPlan): void {
    for (const role of plan.channel.participantRoles) {
      const matches = [...projection.participants.values()].filter(participant => participant.role === role && participant.phase === 'active')
      if (matches.length !== 1) {
        throw new TeamError(
          `workflow channel role '${role}' must resolve to exactly one active participant`,
          'TEAM_PARTICIPANT_NOT_FOUND',
        )
      }
    }
  }

  /** Enforce the plan author's immutable workspace, scope, and budget grant before admission. */
  private assertWorkflowPlanGrant(
    projection: TeamProjection,
    plan: TeamWorkflowPlan,
    actorId: ParticipantId | undefined,
  ): void {
    const grant = actorId === undefined
      ? projection.team.authorityGrant
      : projection.participants.get(actorId)?.authorityGrant ?? projection.team.authorityGrant
    if (grant === undefined) return
    for (const template of plan.tasks) {
      if (!grant.workspaceModes.includes(template.workspaceMode)) {
        throw new TeamError(`authority grant does not permit '${template.workspaceMode}' for workflow task '${template.id}'`, 'TEAM_GRANT_DENIED')
      }
      if (template.readScopes.some(scope => !scopeAllowed(grant.readScopes, scope))) {
        throw new TeamError(`authority grant does not cover workflow task '${template.id}' read scopes`, 'TEAM_GRANT_DENIED')
      }
      if (template.writeScopes.some(scope => !scopeAllowed(grant.writeScopes, scope))) {
        throw new TeamError(`authority grant does not cover workflow task '${template.id}' write scopes`, 'TEAM_GRANT_DENIED')
      }
      assertBudgetSubset(grant.budgets, template.budget, `workflow task '${template.id}' authority`)
    }
  }

  /** Resolve one durable workflow plan or return its stable not-found error. */
  private requireWorkflowPlan(loaded: LoadedTeam, planId: TeamWorkflowPlanSnapshot['id']): TeamWorkflowPlanSnapshot {
    const plan = loaded.projection.workflowPlans.get(planId)
    if (plan === undefined) throw new TeamError(`workflow plan '${planId}' was not found`, 'TEAM_WORKFLOW_PLAN_NOT_FOUND')
    return plan
  }

  /** Enforce that a compiled Team task exactly represents its immutable plan template. */
  private assertWorkflowTaskTemplate(
    projection: TeamProjection,
    plan: TeamWorkflowPlanSnapshot,
    template: TeamWorkflowTaskTemplate,
    task: TeamTaskSnapshot,
  ): void {
    if (task.workflowPlanId !== plan.id || task.workflowTemplateId !== template.id) {
      throw new TeamError(`task '${task.id}' does not belong to workflow template '${template.id}'`, 'TEAM_WORKFLOW_PLAN_INVALID')
    }
    const dependencyIds = template.blockedBy.map((dependency) => {
      const binding = plan.taskBindings.find(candidate => candidate.templateId === dependency)
      if (binding === undefined) {
        throw new TeamError(`workflow template '${template.id}' has an unbound dependency '${dependency}'`, 'TEAM_WORKFLOW_PLAN_INVALID')
      }
      return binding.taskId
    })
    if (!isDeepStrictEqual(task.blockedBy, dependencyIds)
      || task.subject !== template.subject
      || task.description !== template.description
      || !isDeepStrictEqual(task.requiredCapabilities, template.requiredCapabilities)
      || task.priority !== template.priority
      || !isDeepStrictEqual(task.readScopes, template.readScopes)
      || !isDeepStrictEqual(task.writeScopes, template.writeScopes)
      || task.workspaceMode !== template.workspaceMode
      || !isDeepStrictEqual(task.budget, template.budget)
      || task.maxAttempts !== template.maxAttempts) {
      throw new TeamError(`task '${task.id}' does not match workflow template '${template.id}'`, 'TEAM_WORKFLOW_PLAN_INVALID')
    }
    if (template.reviewPolicy.kind === 'none') {
      if (task.reviewPolicy.kind !== 'none') throw new TeamError(`workflow task '${template.id}' has an unexpected review route`, 'TEAM_WORKFLOW_PLAN_INVALID')
    } else {
      const reviewer = task.reviewPolicy.kind === 'participant'
        ? projection.participants.get(task.reviewPolicy.reviewerId)
        : undefined
      if (task.reviewPolicy.kind !== 'participant' || reviewer?.role !== template.reviewPolicy.reviewerRole) {
        throw new TeamError(`workflow task '${template.id}' has an invalid reviewer role`, 'TEAM_WORKFLOW_PLAN_INVALID')
      }
    }
  }

  /** Require cancellation to select an exact compiled binding without stopping independent plan tasks. */
  private assertWorkflowTaskCancellationAllowed(projection: TeamProjection, task: TeamTaskSnapshot): void {
    if (task.workflowPlanId === undefined) return
    const plan = projection.workflowPlans.get(task.workflowPlanId)
    if (plan === undefined
      || !plan.taskBindings.some(binding => binding.taskId === task.id && binding.templateId === task.workflowTemplateId)
      || (plan.phase !== 'ready' && task.phase !== 'completed' && task.phase !== 'failed' && task.phase !== 'cancelled')) {
      throw new TeamError(`workflow task '${task.id}' is not a cancellable compiled binding`, 'TEAM_WORKFLOW_PLAN_INVALID')
    }
  }

  /** Keep plan-owned task details and lifecycle under the workflow compiler. */
  private assertWorkflowTaskDetailsMutable(
    projection: TeamProjection,
    task: TeamTaskSnapshot,
    operation: string,
  ): void {
    if (task.workflowPlanId === undefined) return
    if (!projection.workflowPlans.has(task.workflowPlanId)) {
      throw new TeamError(`workflow task '${task.id}' references an unknown plan`, 'TEAM_WORKFLOW_PLAN_NOT_FOUND')
    }
    throw new TeamError(`workflow task '${task.id}' cannot be directly modified by '${operation}'`, 'TEAM_WORKFLOW_PLAN_INVALID')
  }

  /** Require every plan task and its workflow channel to be durably bound. */
  private assertWorkflowReady(projection: TeamProjection, plan: TeamWorkflowPlanSnapshot): void {
    this.assertWorkflowCompiled(projection, plan)
    for (const binding of plan.taskBindings) {
      const task = projection.tasks.get(binding.taskId)
      if (task === undefined || task.phase !== 'pending') {
        throw new TeamError(
          `workflow plan '${plan.id}' cannot become ready with task '${binding.taskId}' in phase '${task?.phase ?? 'missing'}'`,
          'TEAM_WORKFLOW_PLAN_INVALID',
        )
      }
    }
  }

  /** Require every plan task and its workflow channel to be durably bound. */
  private assertWorkflowCompiled(projection: TeamProjection, plan: TeamWorkflowPlanSnapshot): void {
    if (plan.taskBindings.length !== plan.plan.tasks.length || plan.channelId === undefined) {
      throw new TeamError(`workflow plan '${plan.id}' is not fully compiled`, 'TEAM_WORKFLOW_PLAN_INVALID')
    }
    if (!projection.channelIds.has(plan.channelId)) {
      throw new TeamError(`workflow plan '${plan.id}' references an unattached channel`, 'TEAM_WORKFLOW_PLAN_INVALID')
    }
  }

  /** Enforce workflow readiness and the plan-wide attempt ceiling at assignment. */
  private assertWorkflowTaskAssignmentAllowed(projection: TeamProjection, task: TeamTaskSnapshot): void {
    if (task.workflowPlanId === undefined) return
    const plan = projection.workflowPlans.get(task.workflowPlanId)
    if (plan === undefined) throw new TeamError(`workflow plan '${task.workflowPlanId}' was not found`, 'TEAM_WORKFLOW_PLAN_NOT_FOUND')
    if (plan.phase !== 'ready') {
      throw new TeamError(`workflow task '${task.id}' cannot be assigned while plan '${plan.id}' is '${plan.phase}'`, 'TEAM_WORKFLOW_PLAN_INVALID')
    }
    const attempts = [...projection.tasks.values()]
      .filter(candidate => candidate.workflowPlanId === plan.id)
      .reduce((sum, candidate) => sum + candidate.attemptCount, 0)
    if (attempts >= plan.plan.bounds.maxTotalAttempts) {
      throw new TeamError(`workflow plan '${plan.id}' reached maxTotalAttempts ${String(plan.plan.bounds.maxTotalAttempts)}`, 'TEAM_BUDGET_EXCEEDED')
    }
  }

  /** Check terminal task facts against a requested workflow result projection. */
  private assertWorkflowCompleted(
    projection: TeamProjection,
    plan: TeamWorkflowPlanSnapshot,
    result: TeamWorkflowPlanResult | undefined,
  ): void {
    if (result === undefined) throw new TeamError(`workflow plan '${plan.id}' completion requires a result`, 'TEAM_WORKFLOW_PLAN_INVALID')
    const selected = plan.plan.result.taskTemplateIds
    if (result.tasks.length !== selected.length || result.tasks.some((item, index) => item.templateId !== selected[index])) {
      throw new TeamError(`workflow plan '${plan.id}' result does not match its projection`, 'TEAM_WORKFLOW_PLAN_INVALID')
    }
    for (const projected of result.tasks) {
      const binding = plan.taskBindings.find(candidate => candidate.templateId === projected.templateId)
      const task = binding === undefined ? undefined : projection.tasks.get(binding.taskId)
      if (binding === undefined || task === undefined || task.phase === 'pending' || task.phase === 'assigned' || task.phase === 'running' || task.phase === 'review') {
        throw new TeamError(`workflow plan '${plan.id}' has nonterminal task '${binding?.taskId ?? projected.taskId}'`, 'TEAM_WORKFLOW_PLAN_INVALID')
      }
      if (binding.taskId !== projected.taskId || task.phase !== projected.phase) {
        throw new TeamError(`workflow plan '${plan.id}' result does not match task '${binding.taskId}'`, 'TEAM_WORKFLOW_PLAN_INVALID')
      }
      if (projected.phase === 'completed') {
        const outcome = task.attemptHistory.at(-1)?.outcome
        if (outcome?.kind !== 'completed' || !isDeepStrictEqual(outcome.result, projected.result)) {
          throw new TeamError(`workflow plan '${plan.id}' result does not match completed task '${task.id}'`, 'TEAM_WORKFLOW_PLAN_INVALID')
        }
      } else if (projected.phase === 'failed' && projected.failure !== undefined) {
        const outcome = task.attemptHistory.at(-1)?.outcome
        if (outcome?.kind !== 'failed' || !isDeepStrictEqual(outcome.failure, projected.failure)) {
          throw new TeamError(`workflow plan '${plan.id}' failure does not match task '${task.id}'`, 'TEAM_WORKFLOW_PLAN_INVALID')
        }
      }
    }
  }

  /** Reject a runtime authority whose captured Team does not match the JSON-only goal input. */
  private assertGoalAuthorityTeamId(
    actor: TeamActorProof | TeamHumanActorProof,
    input: TeamGoalUpdateInput | TeamGoalPhaseTransitionInput,
  ): void {
    const human = this.tryResolveHumanActorProof(actor)
    if (human !== undefined) {
      if (human.teamId !== input.teamId) this.rejectGoalActor()
      return
    }
    if (this.requireActivationActorProof(actor as TeamActorProof).activation.teamId !== input.teamId) this.rejectGoalActor()
  }

  /** Resolve a runtime proof to the exact active participant allowed to mutate one Team goal. */
  private resolveGoalActor(
    loaded: LoadedTeam,
    actor: TeamActorProof | TeamHumanActorProof,
    input: TeamGoalUpdateInput | TeamGoalPhaseTransitionInput,
  ): ParticipantId {
    const human = this.tryResolveHumanActorProof(actor)
    if (human !== undefined) {
      const expected = this.goalHumanActorProofInput(input)
      if (human.teamId !== loaded.id
        || human.operation !== expected.operation
        || human.payloadFingerprint !== fingerprintTeamHumanActorPayload(expected)
        || !isDeepStrictEqual(human.fence, expected.fence)) {
        this.rejectGoalActor()
      }
      const participant = this.requireActiveParticipant(loaded, human.participantId)
      if (loaded.projection.team.phase !== 'active'
        || loaded.projection.team.closure !== undefined
        || loaded.projection.team.cancellation !== undefined
        || participant.kind !== 'human') {
        this.rejectGoalActor()
      }
      return participant.id
    }
    const binding = this.requireCurrentActivationActorBinding(loaded, actor as TeamActorProof)
    const participant = this.requireActiveParticipant(loaded, binding.activation.participantId)
    if (!isAgentParticipant(participant)) {
      throw new TeamError(
        `Team participant '${participant.id}' cannot mutate a Team goal through an activation command`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    return participant.id
  }

  /** Resolve a human proof when this authority originated from the product control plane. */
  private tryResolveHumanActorProof(actor: unknown): TeamHumanActorScope | undefined {
    try {
      return this.requireHumanActorProof(actor as TeamHumanActorProof).scope
    } catch (error: unknown) {
      if (error instanceof TeamError && error.code === 'TEAM_ACTOR_PROOF_INVALID') return undefined
      throw error
    }
  }

  /** Build the full JSON-only goal mutation facts bound into one human proof. */
  private goalHumanActorProofInput(
    input: TeamGoalUpdateInput | TeamGoalPhaseTransitionInput,
  ): TeamHumanActorProofInput {
    const payload = 'phase' in input
      ? {
        teamId: input.teamId,
        expectedRevision: input.expectedRevision,
        phase: input.phase,
        ...input.blocker === undefined ? {} : { blocker: structuredClone(input.blocker) },
      }
      : {
        teamId: input.teamId,
        expectedRevision: input.expectedRevision,
        ...input.objective === undefined ? {} : { objective: input.objective },
        ...input.budgets === undefined ? {} : { budgets: structuredClone(input.budgets) },
      }
    return {
      teamId: input.teamId,
      operation: 'goal-mutate',
      fence: { kind: 'revision', revision: input.expectedRevision },
      payload: jsonObjectSchema.parse(payload),
    }
  }

  /** Reject every forged, stale, or cross-Team Team-goal actor uniformly. */
  private rejectGoalActor(): never {
    throw new TeamError('Team goal actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Resolve the one idle or running activation that a new soft interrupt may target. */
  private resolveDeliverableInterruptTarget(loaded: LoadedTeam, participantId: ParticipantId): ParticipantInterruptTarget {
    const participant = this.requireActiveParticipant(loaded, participantId)
    if (!isAgentParticipant(participant)) {
      throw new TeamError(`Team participant '${participantId}' cannot receive an activation interrupt`, 'TEAM_INVALID_ARGUMENT')
    }
    const binding = [...loaded.projection.activations.values()].find(candidate =>
      candidate.activation.participantId === participantId
      && (candidate.activation.status === 'idle' || candidate.activation.status === 'running'))
    if (binding === undefined) {
      throw new TeamError(`Team participant '${participantId}' has no deliverable activation`, 'TEAM_ACTIVATION_NOT_FOUND')
    }
    return this.interruptTarget(binding)
  }

  /** Resolve TeamRun's source proof to the sole current human-to-coordinator interrupt operation. */
  private resolveTeamRunInterruptAuthority(
    loaded: LoadedTeam,
    channel: LoadedChannel,
    actor: TeamSystemInterruptProof,
    input: Omit<ParticipantInterruptRequest, 'actor'>,
  ): { readonly actorId: ParticipantId; readonly target: ParticipantInterruptTarget } {
    const resolution = this.requireSystemInterruptProof(actor)
    const scope = resolution.scope
    const manifest = channel.projection.manifest
    const human = loaded.projection.participants.get(scope.humanId)
    const coordinator = loaded.projection.participants.get(scope.coordinatorId)
    if (resolution.sourceName !== TEAM_RUN_INTERRUPT_PROOF_SOURCE
      || scope.teamId !== loaded.id
      || scope.teamId !== input.teamId
      || scope.channelId !== channel.id
      || !loaded.projection.channelIds.has(channel.id)
      || loaded.projection.team.phase !== 'active'
      || channel.projection.phase !== 'active'
      || manifest.adapter.type !== DIRECT_CHANNEL_V4_ADAPTER.type
      || manifest.adapter.version !== DIRECT_CHANNEL_V4_ADAPTER.version
      || manifest.participants.length !== 2
      || scope.humanId === scope.coordinatorId
      || human?.kind !== 'human'
      || human.phase !== 'active'
      || coordinator?.phase !== 'active'
      || !manifest.participants.some(member => member.id === scope.humanId && member.role === 'human')
      || !manifest.participants.some(member => member.id === scope.coordinatorId && member.role === 'coordinator')) {
      this.rejectInterruptActor()
    }
    return { actorId: scope.humanId, target: this.resolveDeliverableInterruptTarget(loaded, scope.coordinatorId) }
  }

  /** Resolve a Link proof to its exact current target binding for interrupt discovery or acknowledgement. */
  private resolveInterruptActorTarget(
    loaded: LoadedTeam,
    actor: TeamActorProof,
    allowStopping: boolean,
  ): ParticipantInterruptTarget {
    const issued = this.requireActivationActorProof(actor)
    const binding = this.findActivationBinding(loaded.projection, issued.activation.id)
    const participant = binding === undefined ? undefined : loaded.projection.participants.get(binding.activation.participantId)
    const status = binding?.activation.status
    const acceptable = status === 'idle' || status === 'running' || (allowStopping && status === 'stopping')
    if (binding === undefined
      || binding.activation.teamId !== loaded.id
      || binding.activation.teamId !== issued.activation.teamId
      || binding.activation.participantId !== issued.activation.participantId
      || binding.sessionId !== issued.sessionId
      || binding.provider !== issued.provider
      || participant?.phase !== 'active'
      || !isAgentParticipant(participant)
      || !acceptable) {
      this.rejectInterruptActor()
    }
    return this.interruptTarget(binding)
  }

  /** Reject every forged, stale, cross-Team, or wrong-scope interrupt authority uniformly. */
  private rejectInterruptActor(): never {
    throw new TeamError('Participant interrupt actor is invalid for this command', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Project an immutable interrupt target from one durable activation binding. */
  private interruptTarget(binding: ActivationBindingSnapshot): ParticipantInterruptTarget {
    return {
      teamId: binding.activation.teamId,
      participantId: binding.activation.participantId,
      activationId: binding.activation.id,
      sessionId: binding.sessionId,
      provider: binding.provider,
    }
  }

  /** Locate an unacknowledged interrupt for exactly one immutable activation target. */
  private findPendingInterrupt(
    projection: TeamProjection,
    target: ParticipantInterruptTarget,
  ): ParticipantInterruptSnapshot | undefined {
    return [...projection.interrupts.values()].find(interrupt =>
      interrupt.acknowledgedAt === undefined && sameInterruptTarget(interrupt.target, target))
  }

  /** Require a review route to name a current non-terminal Team participant. */
  private requireReviewParticipant(loaded: LoadedTeam, participantId: ParticipantId): ParticipantSnapshot {
    const participant = loaded.projection.participants.get(participantId)
    if (participant === undefined || participant.phase === 'left' || participant.phase === 'failed') {
      throw new TeamError(`Team review participant '${participantId}' is unavailable`, 'TEAM_PARTICIPANT_NOT_FOUND')
    }
    return participant
  }

  /** Reject an operation that requires a task to have no current lease. */
  private requireLeaseFreeTask(task: TeamTaskSnapshot): void {
    if (taskHasActiveExecution(task)) {
      throw new TeamError(`Team task '${task.id}' has active execution`, 'TEAM_INVALID_ARGUMENT')
    }
  }

  /** Require a selected participant to declare every immutable task capability. */
  private assertRequiredCapabilities(task: TeamTaskSnapshot, participant: ParticipantSnapshot): void {
    const available = new Set(participant.capabilities)
    const missing = task.requiredCapabilities.filter(capability => !available.has(capability))
    if (missing.length > 0) {
      throw new TeamError(
        `Team task '${task.id}' requires capabilities unavailable to '${participant.id}': ${missing.join(', ')}`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
  }

  /**
   * Repair child usage charges before allowing the child to continue work.
   * Each hop commits its own accepted charge before the source Team records a
   * settlement, so a restart or lost response can safely repeat this walk.
   */
  private async repairPendingParentCharges(loaded: LoadedTeam): Promise<void> {
    while (true) {
      const pending = await loaded.queue.run(() => Promise.resolve().then(() => {
        const current = this.requireLiveTeam(loaded)
        const charge = current.projection.pendingParentCharges.values().next().value
        if (charge === undefined) return undefined
        const parentTeamId = current.projection.team.parentTeamId
        const parentTaskId = current.projection.team.parentTaskId
        if (parentTeamId === undefined || parentTaskId === undefined) {
          throw new TeamHubError(
            `Team '${current.id}' has a pending parent usage charge without a complete parent link`,
            'TEAM_JOURNAL_MALFORMED',
          )
        }
        return { charge: structuredClone(charge), parentTeamId, parentTaskId }
      }))
      if (pending === undefined) return

      const parent = await this.ensureTeam(pending.parentTeamId)
      await parent.queue.run(async () => {
        const currentParent = this.requireLiveTeam(parent)
        if (!currentParent.projection.tasks.has(pending.parentTaskId)) {
          throw new TeamError(
            `parent Team '${pending.parentTeamId}' does not retain task '${pending.parentTaskId}' for usage charge '${pending.charge.id}'`,
            'TEAM_PARENT_USAGE_PENDING',
          )
        }
        if (pending.charge.parentTaskId !== pending.parentTaskId) throw new TeamError('Child usage charge changed its owning parent task', 'TEAM_PARENT_USAGE_PENDING')
        await this.acceptChildUsageCharge(currentParent, pending.charge, loaded.id)
      })
      await this.repairPendingParentCharges(parent)
      await loaded.queue.run(async () => {
        const current = this.requireLiveTeam(loaded)
        const stillPending = current.projection.pendingParentCharges.get(pending.charge.id)
        if (stillPending === undefined) return
        if (!sameUsageChargeValue(stillPending, pending.charge)) {
          throw new TeamError(
            `pending parent usage charge '${pending.charge.id}' changed while it was being repaired`,
            'TEAM_PARENT_USAGE_PENDING',
          )
        }
        await this.commitTeamCommand(current, [{
          type: 'usage/parent-charge-settled',
          chargeId: pending.charge.id,
          createdAt: nextTeamTimestamp(current.projection),
        }], 'TEAM_PARENT_USAGE_PENDING')
      })
    }
  }

  /** Accept or idempotently replay one child charge in its direct parent. */
  private async acceptChildUsageCharge(
    parent: LoadedTeam,
    charge: TeamUsageCharge,
    sourceTeamId: TeamId,
  ): Promise<void> {
    const current = this.requireLiveTeam(parent)
    if (charge.sourceTeamId !== sourceTeamId || charge.sourceTeamId === current.id) {
      throw new TeamError(
        `usage charge '${charge.id}' does not name its direct child source Team`,
        'TEAM_PARENT_USAGE_PENDING',
      )
    }
    const ownerTask = current.projection.tasks.get(charge.parentTaskId)
    if (ownerTask?.delegation?.childTeamId !== sourceTeamId) throw new TeamError('Child usage charge has no matching parent reservation', 'TEAM_PARENT_USAGE_PENDING')
    const pricedCost = charge.costUnits ?? usageCostForCharge(current.projection, charge)
    if (pricedCost === undefined && usageCostRequired(current.projection, charge.participantId, charge.parentTaskId)) {
      throw new TeamError(
        `usage charge '${charge.id}' has no provider cost or frozen pricing while a cost ceiling is active`,
        'TEAM_BUDGET_INVALID',
      )
    }
    const pricedCharge: TeamUsageCharge = pricedCost === undefined
      ? charge
      : { ...structuredClone(charge), costUnits: pricedCost }
    const existing = current.projection.usageCharges.get(pricedCharge.id)
    if (existing !== undefined) {
      if (!sameUsageChargeValue(existing, pricedCharge)) {
        if (!sameUsageChargeProvenance(existing, pricedCharge)) {
          throw new TeamError(`usage charge '${pricedCharge.id}' changed immutable provenance`, 'TEAM_INVALID_ARGUMENT')
        }
      } else {
        return
      }
    }
    if (current.projection.team.phase === 'completed'
      || current.projection.team.phase === 'failed'
      || current.projection.team.phase === 'cancelled'
      || current.projection.team.closure !== undefined) {
      throw new TeamError(
        `parent Team '${current.id}' cannot accept usage charge '${charge.id}' after '${current.projection.team.phase}'`,
        'TEAM_PARENT_USAGE_PENDING',
      )
    }
    if (current.projection.team.phase !== 'active'
      && current.projection.team.phase !== 'quiescing'
      && current.projection.team.phase !== 'stalled') {
      throw new TeamError(
        `parent Team '${current.id}' cannot accept usage charge '${charge.id}' while '${current.projection.team.phase}'`,
        'TEAM_PARENT_USAGE_PENDING',
      )
    }
    await this.authorizeOrThrow('usage', current.id, {
      chargeId: charge.id,
      sourceTeamId,
      originTeamId: charge.originTeamId,
      sourceSampleId: charge.sourceSampleId,
      participantId: charge.participantId,
      sessionId: charge.sessionId,
      turn: charge.turn,
      step: charge.step,
      usage: structuredClone(charge.usage) as unknown as JsonObject,
      ...charge.costUnits === undefined ? {} : { costUnits: charge.costUnits },
    })
    const createdAt = nextTeamTimestamp(current.projection)
    const accepted: TeamUsageCharge = { ...structuredClone(pricedCharge), observedAt: createdAt }
    const charges = new Map(current.projection.usageCharges)
    charges.set(accepted.id, accepted)
    const usage = usageFromSamplesAndCharges(current.projection.usageSamples, charges)
    const records: TeamJournalRecord[] = [{
      type: 'usage/child-charged',
      charge: accepted,
      usage,
      createdAt,
    }]
    const budget = usageBudgetExceeded(current.projection, usage)
      ?? taskBudgetExceeded(ownerTask, current.projection.usageSamples, createdAt, charges)
    if (budget !== undefined && (current.projection.team.phase === 'active' || current.projection.team.phase === 'quiescing')) {
      records.push({ type: 'team/phase', phase: 'stalled', reason: budget, createdAt })
    }
    await this.commitTeamCommand(current, records, 'TEAM_PARENT_USAGE_PENDING')
  }

  /** Reject new child work until every accepted usage charge reaches its parent. */
  private assertNoPendingParentCharges(projection: TeamProjection): void {
    const charge = projection.pendingParentCharges.values().next().value
    if (charge === undefined) return
    throw new TeamError(
      `Team '${projection.team.id}' is waiting for parent usage charge '${charge.id}' to settle`,
      'TEAM_PARENT_USAGE_PENDING',
    )
  }

  /** Reject another lease while an earlier attempt still owns a provider allocation. */
  private assertTaskWorkspaceAllocationsReleased(projection: TeamProjection, taskId: TeamTaskId): void {
    const allocation = [...projection.workspaceAllocations.values()].find(candidate =>
      candidate.taskId === taskId && candidate.lifecycle !== 'released')
    if (allocation !== undefined) {
      throw new TeamError(
        `Team task '${taskId}' retains unreleased workspace allocation '${allocation.id}'`,
        'TEAM_NOT_QUIESCENT',
      )
    }
  }

  /** Reject terminal settlement while any provider-owned allocation remains unreleased. */
  private assertNoUnreleasedWorkspaceAllocations(projection: TeamProjection): void {
    const allocation = [...projection.workspaceAllocations.values()]
      .find(candidate => candidate.lifecycle !== 'released')
    if (allocation !== undefined) {
      throw new TeamError(
        `Team '${projection.team.id}' retains workspace allocation '${allocation.id}' in '${allocation.lifecycle}' state`,
        'TEAM_NOT_QUIESCENT',
      )
    }
  }

  /** Resolve the exact live epoch required by an agent participant, or reject an inapplicable proof. */
  private resolveAttemptActivation(
    loaded: LoadedTeam,
    participant: ParticipantSnapshot,
    activationId: ActivationBindingSnapshot['activation']['id'] | undefined,
  ): ActivationBindingSnapshot['activation']['id'] | undefined {
    if (!isAgentParticipant(participant)) {
      if (activationId !== undefined) {
        throw new TeamError(`Team participant '${participant.id}' cannot carry an activation proof`, 'TEAM_INVALID_ARGUMENT')
      }
      return undefined
    }
    if (activationId === undefined) {
      throw new TeamError(`Agent participant '${participant.id}' requires an activation proof`, 'TEAM_INVALID_ARGUMENT')
    }
    const binding = this.findActivationBinding(loaded.projection, activationId)
    if (binding === undefined) {
      throw new TeamError(`Activation '${activationId}' was not found`, 'TEAM_ACTIVATION_NOT_FOUND')
    }
    if (binding.activation.teamId !== loaded.id
      || binding.activation.participantId !== participant.id
      || (binding.activation.status !== 'idle' && binding.activation.status !== 'running')) {
      throw new TeamError(`Activation '${activationId}' cannot execute for participant '${participant.id}'`, 'TEAM_INVALID_ARGUMENT')
    }
    return activationId
  }

  /** Reject assignment while a durable blocker has not reached its completed state. */
  private assertTaskReady(projection: TeamProjection, task: TeamTaskSnapshot): void {
    for (const blockerId of task.blockedBy) {
      if (projection.tasks.get(blockerId)?.phase !== 'completed') {
        throw new TeamError(`Team task '${task.id}' is blocked by '${blockerId}'`, 'TEAM_INVALID_ARGUMENT')
      }
    }
  }

  /** Reserve one task's typed ceilings against the remaining Team budget. */
  private assertTaskBudgetWithinTeam(projection: TeamProjection, requested: JsonObject): void {
    const teamBudget = resourceBudget(projection.budgets, 'Team budget')
    const requestedBudget = resourceBudget(requested, 'task budget')
    const usage = resourceBudgetUsage(projection)
    const reserved = reservedTaskBudget(projection.tasks)
    for (const key of RESOURCE_BUDGET_KEYS) {
      const limit = teamBudget[key]
      const value = requestedBudget[key]
      if (limit === undefined || value === undefined) continue
      const remaining = key === 'maxLiveActivations' ? limit : limit - usage[key] - reserved[key]
      if (value > remaining) {
        throw new TeamError(
          `task budget '${key}' requests ${String(value)} but Team '${projection.team.id}' has ${String(Math.max(0, remaining))} remaining`,
          'TEAM_BUDGET_EXCEEDED',
        )
      }
    }
  }

  /** Validate that an integration task names one accepted source attempt. */
  private assertTaskIntegration(
    projection: TeamProjection,
    integration: TeamTaskIntegrationSpec | undefined,
  ): void {
    if (integration === undefined) return
    const source = projection.tasks.get(integration.sourceTaskId)
    if (source === undefined || source.phase !== 'completed') {
      throw new TeamError(
        `integration source task '${integration.sourceTaskId}' is not completed in Team '${projection.team.id}'`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    const attempt = source.attemptHistory.find(candidate => candidate.id === integration.sourceAttemptId)
    if (attempt === undefined || attempt.outcome.kind !== 'completed') {
      throw new TeamError(
        `integration source attempt '${integration.sourceAttemptId}' is not a completed result`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    if (integration.mode === 'integrate' && integration.expectedTarget === undefined) {
      throw new TeamError(
        'an integrating Team task requires an expected target revision',
        'TEAM_INVALID_ARGUMENT',
      )
    }
  }

  /** Require a completed integration task to retain the exact provider result it reports. */
  private assertTaskIntegrationResult(
    task: TeamTaskSnapshot,
    attemptId: TaskAttemptId,
    outcome: TaskAttemptOutcome,
  ): void {
    const spec = task.integration
    const result = outcome.kind === 'completed' ? outcome.result.integration : undefined
    if (spec === undefined) {
      if (result !== undefined) {
        throw new TeamError(
          `ordinary Team task '${task.id}' cannot retain an integration result`,
          'TEAM_INVALID_ARGUMENT',
        )
      }
      return
    }
    if (outcome.kind !== 'completed') return
    if (result === undefined) {
      throw new TeamError(
        `integration task '${task.id}' must retain its provider result`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    if (result.target !== spec.target || result.expectedTarget !== spec.expectedTarget) {
      throw new TeamError(
        `integration task '${task.id}' result does not match its target fence`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    if (spec.mode === 'proposal' && result.status !== 'proposed') {
      throw new TeamError(
        `proposal task '${task.id}' cannot retain an '${result.status}' integration result`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    if (spec.mode === 'integrate' && result.status === 'proposed') {
      throw new TeamError(
        `integration task '${task.id}' cannot retain a proposal result`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    for (const artifact of [result.proposalArtifact, ...(result.artifacts ?? [])]) {
      if (artifact === undefined || artifact.sourceAttemptId === undefined) continue
      if (artifact.sourceAttemptId !== attemptId && artifact.sourceAttemptId !== spec.sourceAttemptId) {
        throw new TeamError(
          `integration task '${task.id}' result references an unrelated artifact attempt`,
          'TEAM_INVALID_ARGUMENT',
        )
      }
    }
  }

  /** Require a nested Team's typed budget to fit inside its parent's remainder. */
  private assertChildTeamBudget(projection: TeamProjection, requested: JsonObject, reservationTaskId?: TeamTaskId): void {
    const parentBudget = resourceBudget(projection.budgets, 'Team budget')
    const liveLimit = liveActivationLimit(projection.budgets, projection.team.authorityGrant)
    const childBudget = resourceBudget(requested, 'child Team budget')
    if (childBudget.maxChildTeams === Number.MAX_SAFE_INTEGER) {
      throw new TeamError('Child Team count leaves no representable slot for the child itself', 'TEAM_BUDGET_INVALID')
    }
    const usage = resourceBudgetUsage(projection)
    const reservation = reservationTaskId === undefined ? undefined : projection.tasks.get(reservationTaskId)
    if (reservation !== undefined) {
      usage.maxConcurrency = Math.max(0, usage.maxConcurrency - taskConcurrencyUsage(reservation))
      usage.maxChildTeams -= taskChildTeamReservation(reservation)
      usage.maxLiveActivations -= taskLiveActivationReservation(reservation)
    }
    if (parentBudget.maxChildTeams !== undefined) {
      if (childBudget.maxChildTeams === undefined) {
        throw new TeamError('Child Team must freeze its descendant count under a bounded parent', 'TEAM_BUDGET_INVALID')
      }
      if (childBudget.maxChildTeams + 1 > parentBudget.maxChildTeams - usage.maxChildTeams) {
        throw new TeamError('Child Team identity and descendant reservation exceed the parent lifetime count', 'TEAM_BUDGET_EXCEEDED')
      }
    }
    if (liveLimit !== undefined && childBudget.maxLiveActivations === undefined) {
      throw new TeamError('Child Team must freeze its live Activation capacity under a bounded parent', 'TEAM_BUDGET_INVALID')
    }
    for (const key of RESOURCE_BUDGET_KEYS) {
      const limit = key === 'maxLiveActivations' ? liveLimit : parentBudget[key]
      const value = childBudget[key]
      if (limit === undefined || value === undefined) continue
      const remaining = limit - usage[key]
      if (value > remaining) {
        throw new TeamError(
          `child Team budget '${key}' requests ${String(value)} but Team '${projection.team.id}' has ${String(Math.max(0, remaining))} remaining`,
          key === 'maxLiveActivations' && value <= limit ? 'TEAM_DELEGATION_BUSY' : 'TEAM_BUDGET_EXCEEDED',
        )
      }
    }
  }

  /** Enforce participant workspace, scope, and budget subsets before task admission. */
  private assertTaskGrant(
    projection: TeamProjection,
    task: NormalizedTaskCreate,
    actorId: ParticipantId | undefined,
  ): void {
    if (task.execution.kind === 'child-team' && projection.team.depth >= projection.team.maxTeamDepth) {
      throw new TeamError(`Team '${projection.team.id}' has reached its child-Team depth limit`, 'TEAM_DELEGATION_INVALID')
    }
    const grant = actorId === undefined
      ? projection.team.authorityGrant
      : projection.participants.get(actorId)?.authorityGrant ?? projection.team.authorityGrant
    if (grant === undefined) return
    if (!grant.workspaceModes.includes(task.workspaceMode)) {
      throw new TeamError(
        `authority grant does not permit '${task.workspaceMode}' workspace for Team task`,
        'TEAM_GRANT_DENIED',
      )
    }
    if (task.readScopes.some(scope => !scopeAllowed(grant.readScopes, scope))) {
      throw new TeamError('authority grant does not cover one or more task read scopes', 'TEAM_GRANT_DENIED')
    }
    if (task.writeScopes.some(scope => !scopeAllowed(grant.writeScopes, scope))) {
      throw new TeamError('authority grant does not cover one or more task write scopes', 'TEAM_GRANT_DENIED')
    }
    assertPlacementGrantSubset(grant.placement, task.placement, 'task authority')
    assertBudgetSubset(grant.budgets, task.budget, 'task authority')
    if (task.execution.kind === 'child-team') {
      assertAuthorityGrantSubset(grant, task.execution.authorityGrant, 'child task authority')
      assertAuthorityGrantSubset({ ...grant, workspaceModes: ['shared'], readScopes: task.readScopes, writeScopes: task.writeScopes,
        budgets: resourceBudget(task.budget, 'parent task budget') }, task.execution.authorityGrant, 'parent task delegation')
      assertBudgetSubset(resourceBudget(task.budget, 'parent task budget'), task.execution.budget, 'child task')
    }
  }

  /** Validate optional task/attempt provenance before accepting provider usage. */
  private assertUsageTaskProvenance(projection: TeamProjection, sample: TeamUsageSample): void {
    if (sample.taskId === undefined || sample.attemptId === undefined) return
    const task = projection.tasks.get(sample.taskId)
    if (task === undefined || task.phase === 'deleted') {
      throw new TeamError(`usage sample '${sample.id}' names an unknown task`, 'TEAM_TASK_NOT_FOUND')
    }
    const attempt = task.lease?.attemptId === sample.attemptId
      ? task.lease
      : task.attemptHistory.find(candidate => candidate.id === sample.attemptId)
    if (attempt === undefined || attempt.participantId !== sample.participantId) {
      throw new TeamError(`usage sample '${sample.id}' names an invalid task attempt`, 'TEAM_INVALID_ARGUMENT')
    }
    if (attempt.activationId !== undefined) {
      const binding = projection.activations.get(attempt.activationId)
      if (binding === undefined || binding.sessionId !== sample.sessionId) {
        throw new TeamError(`usage sample '${sample.id}' does not match its task activation Session`, 'TEAM_INVALID_ARGUMENT')
      }
    }
  }

  /** Require a caller fence to name the current lease after checking its task revision. */
  private requireAttempt(task: TeamTaskSnapshot, request: TeamTaskAttemptFence): TaskLeaseSnapshot {
    this.assertTaskRevision(task, request.expectedRevision)
    const lease = task.lease
    if (lease === undefined || lease.attemptId !== request.attemptId) {
      throw new TeamError(`Team task '${task.id}' has no current attempt '${request.attemptId}'`, 'TEAM_INVALID_ARGUMENT')
    }
    return lease
  }

  /** Require an owner and optional epoch fence to match the exact current lease. */
  private requireAttemptOwner(
    loaded: LoadedTeam,
    task: TeamTaskSnapshot,
    request: TeamTaskAttemptOwnerFence,
  ): TaskLeaseSnapshot {
    const lease = this.requireAttempt(task, request)
    if (lease.participantId !== request.participantId) {
      throw new TeamError(`Team task '${task.id}' attempt '${lease.attemptId}' belongs to another participant`, 'TEAM_INVALID_ARGUMENT')
    }
    const participant = this.requireActiveParticipant(loaded, request.participantId)
    const activationId = this.resolveAttemptActivation(loaded, participant, request.activationId)
    if (lease.activationId !== activationId) {
      throw new TeamError(`Team task '${task.id}' attempt '${lease.attemptId}' has a stale activation proof`, 'TEAM_INVALID_ARGUMENT')
    }
    return lease
  }

  /**
   * Derive one internal owner fence from a revalidated activation proof.
   * The public heartbeat and settlement requests never carry this identity.
   * @param team - Team lock whose current activation projection was checked.
   * @param input - JSON-only task revision and attempt selection.
   * @param binding - current activation relation selected by the runtime proof.
   * @returns the internal owner fence for lease validation only.
   */
  private proofAttemptOwner(
    team: LoadedTeam,
    input: { readonly taskId: TeamTaskId; readonly expectedRevision: number; readonly attemptId: TaskAttemptId },
    binding: ActivationBindingSnapshot,
  ): TeamTaskAttemptOwnerFence {
    return {
      teamId: team.id,
      taskId: input.taskId,
      expectedRevision: input.expectedRevision,
      attemptId: input.attemptId,
      participantId: binding.activation.participantId,
      activationId: binding.activation.id,
    }
  }

  /** Require the exact current lease to match a proof-derived activation binding and assignment delivery. */
  private requireTaskAttemptStartClaim(
    task: TeamTaskSnapshot,
    request: TeamTaskAttemptStartClaimInput,
    binding: ActivationBindingSnapshot,
  ): TaskLeaseSnapshot {
    const lease = task.lease
    if (lease === undefined || lease.attemptId !== request.attemptId) {
      throw new TeamError(`Team task '${task.id}' has no current attempt '${request.attemptId}'`, 'TEAM_INVALID_ARGUMENT')
    }
    if (lease.assignedRevision !== request.assignedRevision) {
      throw new TeamError(
        `Team task '${task.id}' attempt '${lease.attemptId}' assignment revision ${request.assignedRevision} is stale`,
        'TEAM_TASK_STALE_REVISION',
      )
    }
    if (lease.participantId !== binding.activation.participantId) {
      throw new TeamError(`Team task '${task.id}' attempt '${lease.attemptId}' belongs to another participant`, 'TEAM_INVALID_ARGUMENT')
    }
    if (lease.activationId !== binding.activation.id) {
      throw new TeamError(`Team task '${task.id}' attempt '${lease.attemptId}' has a stale activation proof`, 'TEAM_INVALID_ARGUMENT')
    }
    return lease
  }

  /** Reject ordinary attempt activity once the durable lease deadline has elapsed. */
  private assertLeaseLive(lease: TaskLeaseSnapshot, now: number): void {
    if (now >= lease.expiresAt) {
      throw new TeamError(`Task attempt '${lease.attemptId}' lease expired; record expiry before retrying`, 'TEAM_INVALID_ARGUMENT')
    }
  }

  /** Map one terminal attempt fact to the durable task phase owned by this Hub. */
  private phaseAfterAttemptOutcome(
    task: TeamTaskSnapshot,
    outcome: TaskAttemptOutcome,
  ): 'pending' | 'review' | 'completed' | 'failed' | 'cancelled' {
    switch (outcome.kind) {
      case 'completed':
        return task.reviewPolicy.kind === 'none' ? 'completed' : 'review'
      case 'cancelled':
        return 'cancelled'
      case 'released':
      case 'lease-expired':
      case 'failed':
        return task.attemptCount >= task.maxAttempts ? 'failed' : 'pending'
      /* v8 ignore next 2 -- TaskAttemptOutcome is closed and all discriminants are handled above. */
      default:
        outcome satisfies never
        throw new Error('unreachable task attempt outcome')
    }
  }

  /** Materialize the immutable terminal history row for one lease-backed attempt. */
  private settledAttempt(
    task: TeamTaskSnapshot,
    lease: TaskLeaseSnapshot,
    settledAt: number,
    outcome: TaskAttemptOutcome,
  ): TaskAttemptSnapshot {
    return {
      id: lease.attemptId,
      teamId: task.teamId,
      taskId: task.id,
      ordinal: lease.ordinal,
      participantId: lease.participantId,
      ...lease.activationId === undefined ? {} : { activationId: lease.activationId },
      ...lease.wakeChannelId === undefined ? {} : { wakeChannelId: lease.wakeChannelId },
      assignedAt: lease.assignedAt,
      ...lease.startedAt === undefined ? {} : { startedAt: lease.startedAt },
      leaseExpiresAt: lease.expiresAt,
      settledAt,
      outcome: structuredClone(outcome),
    }
  }

  /** Replace the sole active lease with its immutable terminal history row. */
  private withSettledAttempt(
    task: TeamTaskSnapshot,
    settled: TaskAttemptSnapshot,
    phase: 'pending' | 'review' | 'completed' | 'failed' | 'cancelled',
  ): TeamTaskSnapshot {
    const { lease: _lease, ...withoutLease } = task
    return {
      ...withoutLease,
      revision: task.revision + 1,
      phase,
      attemptHistory: [...task.attemptHistory, settled],
    }
  }

  /** Apply all registered policies and raise the stable denial error when one vetoes. */
  private async authorizeOrThrow(
    hook: Parameters<TeamRuntime['authorize']>[0]['hook'],
    teamId: TeamId | undefined,
    facts: JsonObject,
    actorId?: ParticipantId,
  ): Promise<void> {
    if (teamId !== undefined) {
      const loaded = this.teams.get(teamId)
      if (loaded !== undefined && !loaded.invalid) {
        this.assertGranted(loaded.projection, hook, actorId)
      }
    }
    const decision = await this.authorize({
      hook,
      facts,
      ...(teamId === undefined ? {} : { teamId }),
      ...(actorId === undefined ? {} : { actorId }),
    })
    if (decision.kind === 'deny') {
      if (teamId !== undefined) {
        const loaded = this.teams.get(teamId)
        if (loaded !== undefined && !loaded.invalid && !this.closing) {
          try {
            await this.commitTeam(loaded, [{
              type: 'policy/denied',
              hook,
              ...actorId === undefined ? {} : { actorId },
              code: decision.code,
              message: decision.message,
              facts: structuredClone(facts),
              createdAt: nextTeamTimestamp(loaded.projection),
            }])
          } catch (error: unknown) {
            this.ctx.logger.warn(`team-hub: could not persist policy denial for '${teamId}': ${renderError(error)}`)
          }
        }
      }
      throw new TeamError(decision.message, 'TEAM_POLICY_DENIED')
    }
  }

  /** Enforce the immutable Team or Participant grant before extensible policy. */
  private assertGranted(projection: TeamProjection, hook: TeamPolicyHook, actorId: ParticipantId | undefined): void {
    const participantGrant = actorId === undefined
      ? undefined
      : projection.participants.get(actorId)?.authorityGrant
    const grant = participantGrant ?? projection.team.authorityGrant
    if (grant !== undefined && !grant.operations.includes(hook)) {
      throw new TeamError(
        `authority grant does not permit '${hook}' for Team '${projection.team.id}'`,
        'TEAM_GRANT_DENIED',
      )
    }
  }

  /** Run one closure validation while holding every attached channel serializer in stable order. */
  private async withChannelQueues<T>(
    channels: readonly LoadedChannel[],
    operation: () => Promise<T>,
  ): Promise<T> {
    const ordered = [...channels].sort((left, right) => left.id.localeCompare(right.id))
    const visit = async (index: number): Promise<T> => {
      const channel = ordered[index]
      if (channel === undefined) return await operation()
      return await channel.queue.run(() => visit(index + 1))
    }
    return await visit(0)
  }

  /** Return an idempotent closure result or reject a reused key with different facts. */
  private replayClosure(
    loaded: LoadedTeam,
    request: ResolvedTeamClosureInput<TeamClosureInput>,
    kind: 'complete' | 'fail' | 'cancel',
  ): TeamStateSnapshot | undefined {
    const existing = loaded.projection.team.closure
    if (existing === undefined) return undefined
    if (closureMatches(existing, request, kind)) return this.teamState(loaded.projection)
    throw new TeamError(
      `Team '${loaded.id}' closure key '${request.idempotencyKey}' conflicts with its durable closure intent`,
      'TEAM_CLOSURE_IDEMPOTENCY_CONFLICT',
    )
  }

  /** Require a closure actor to remain a current active Team participant. */
  private assertClosureActor(loaded: LoadedTeam, actor: TeamClosureActor): void {
    if (actor.kind === 'system') return
    const participant = loaded.projection.participants.get(actor.participantId)
    if (participant?.phase !== 'active') {
      throw new TeamError(`closure actor '${actor.participantId}' is not an active Team participant`, 'TEAM_PARTICIPANT_NOT_FOUND')
    }
  }

  /** Validate the exact coordinator-to-human final Envelope and optionally its receipt. */
  private async requireFinalEnvelope(
    team: TeamProjectionOwner,
    channel: LoadedChannel,
    envelopeId: EnvelopeId,
    requireReceipt = true,
  ): Promise<TeamEnvelope & { readonly audience: readonly [ParticipantId] }> {
    const currentChannel = this.requireLiveChannel(channel)
    this.assertAttachedChannel(team, currentChannel)
    if (team.projection.team.parentTeamId !== undefined) throw new TeamError('Child completion requires its parent-service result', 'TEAM_FINAL_INVALID')
    if (currentChannel.projection.manifest.participants.length !== 2) {
      throw new TeamError('Team completion requires an exact two-party final channel', 'TEAM_FINAL_INVALID')
    }
    const human = currentChannel.projection.manifest.participants.find(participant => participant.role === 'human')
    const coordinator = currentChannel.projection.manifest.participants.find(participant => participant.role === 'coordinator')
    if (human === undefined || coordinator === undefined || human.id === coordinator.id) {
      throw new TeamError('Team completion requires one human and one coordinator final-channel participant', 'TEAM_FINAL_INVALID')
    }
    const final = await this.findCommittedEnvelope(currentChannel, envelopeId)
    if (final === undefined
      || final.kind !== 'final'
      || final.senderId !== coordinator.id
      || final.audience === null
      || final.audience.length !== 1
      || final.audience[0] !== human.id
      || typeof final.payload.text !== 'string'
      || final.payload.text.trim().length === 0) {
      throw new TeamError(`final Envelope '${envelopeId}' is not a human-addressed coordinator final`, 'TEAM_FINAL_INVALID')
    }
    if (requireReceipt) {
      const receipt = await this.findCommittedReceipt(currentChannel, human.id, envelopeId)
      if (receipt === undefined) {
        throw new TeamError(`final Envelope '${envelopeId}' has no durable human receipt`, 'TEAM_FINAL_INVALID')
      }
    }
    return final as TeamEnvelope & { readonly audience: readonly [ParticipantId] }
  }

  /** Require an available human delivery before the final may reserve a result or completion selection. */
  private async assertFinalDeliveryAvailable(
    channel: LoadedChannel,
    final: TeamEnvelope & { readonly audience: readonly [ParticipantId] },
  ): Promise<void> {
    if (!channel.projection.pendingDeliveries.get(final.audience[0])?.has(final.id)
      && await this.findCommittedReceipt(channel, final.audience[0], final.id) === undefined) {
      throw new TeamError(`final Envelope '${final.id}' has no pending delivery or durable human receipt`, 'TEAM_FINAL_INVALID')
    }
  }

  /** Return whether cancellation may begin channel closure without stranding live Team-owned resources. */
  private cancellationResourcesSettled(projection: TeamProjection): boolean {
    if ([...projection.participants.values()].some(participant => participant.activationReservation !== undefined
      && participant.activationReservation.releasedAt === undefined
      && ![...projection.activations.values()].some(binding =>
        binding.reservationId === participant.activationReservation?.id))) return false
    if ([...projection.workspaceAllocations.values()].some(allocation => allocation.lifecycle !== 'released')) return false
    if (projection.pendingParentCharges.size > 0) return false
    if ([...projection.tasks.values()].some(task => (
      task.phase === 'pending' || task.phase === 'assigned' || task.phase === 'running' || task.phase === 'review'
    ))) return false
    if ([...projection.activations.values()].some(binding => binding.activation.status !== 'offline'
      || binding.quiescedAt === undefined)) return false
    if ([...projection.humanActions.values()].some(action => action.phase === 'pending')) return false
    return ![...projection.workflowPlans.values()].some(plan => plan.phase === 'compiling' || plan.phase === 'ready')
  }

  /** Return whether every cancellation-owned channel has durably settled recipient delivery work. */
  private cancellationDeliveriesSettled(channels: readonly LoadedChannel[]): boolean {
    return channels.every(channel => pendingDeliveryCount(this.requireLiveChannel(channel).projection) === 0)
  }

  /** Reject a cancellation channel close before all Team-owned resources settle. */
  private assertCancellationResourcesSettled(projection: TeamProjection): void {
    if (this.cancellationResourcesSettled(projection)) return
    throw new TeamError('Team cancellation retains active resources', 'TEAM_NOT_QUIESCENT')
  }

  /** Reject a cancellation channel close before its durable recipient work is resolved. */
  private assertCancellationDeliveriesSettled(channels: readonly LoadedChannel[]): void {
    if (this.cancellationDeliveriesSettled(channels)) return
    throw new TeamError('Team cancellation retains pending channel deliveries', 'TEAM_NOT_QUIESCENT')
  }

  /** Reject final-result admission while durable non-channel work could still reopen or block settlement. */
  private assertFinalizationAdmissionQuiescence(team: LoadedTeam): void {
    this.assertNoUnreleasedWorkspaceAllocations(team.projection)
    const charge = team.projection.pendingParentCharges.values().next().value
    if (charge !== undefined) {
      throw new TeamError(
        `Team '${team.id}' retains pending parent usage charge '${charge.id}'`,
        'TEAM_NOT_QUIESCENT',
      )
    }
    const activeTask = [...team.projection.tasks.values()].find(task =>
      task.phase === 'pending' || task.phase === 'assigned' || task.phase === 'running' || task.phase === 'review')
    if (activeTask !== undefined) {
      throw new TeamError(`Team '${team.id}' retains unfinished task '${activeTask.id}'`, 'TEAM_NOT_QUIESCENT')
    }
    if ([...team.projection.humanActions.values()].some(action => action.phase === 'pending')) {
      throw new TeamError(`Team '${team.id}' retains a pending human action`, 'TEAM_NOT_QUIESCENT')
    }
    const activePlan = [...team.projection.workflowPlans.values()].find(plan => plan.phase === 'compiling' || plan.phase === 'ready')
    if (activePlan !== undefined) {
      throw new TeamError(`Team '${team.id}' retains unfinished workflow plan '${activePlan.id}'`, 'TEAM_NOT_QUIESCENT')
    }
  }

  /** Reject a command that continued after its projection was invalidated or Hub disposal began. */
  private requireLiveTeam(loaded: LoadedTeam): LoadedTeam {
    // v8 ignore next 2 -- only an admitted operation racing disposal can reach this guard.
    if (this.closing) throw new TeamError('Team Hub is disposing', 'TEAM_DISPOSED')
    // v8 ignore next 2 -- invalidation wakes queued callers before their next command begins.
    if (loaded.invalid) throw new TeamError(`Team '${loaded.id}' cursor is stale`, 'TEAM_CURSOR_CONFLICT')
    return loaded
  }

  /** Accept a cursor that advanced only through non-business policy-denial records. */
  private assertTeamCursor(loaded: LoadedTeam, expected: number): void {
    const current = loaded.projection.team.cursor
    if (current === expected) return
    if (expected < current) {
      let onlyDenials = true
      for (let cursor = expected + 1; cursor <= current; cursor += 1) {
        if (!loaded.policyDenialCursors.has(cursor)) { onlyDenials = false; break }
      }
      if (onlyDenials) return
    }
    assertCursor(current, expected, 'Team')
  }

  /** Reject a command that continued after its channel projection was invalidated or Hub disposal began. */
  private requireLiveChannel(loaded: LoadedChannel): LoadedChannel {
    // v8 ignore next 2 -- only an admitted operation racing disposal can reach this guard.
    if (this.closing) throw new TeamError('Team Hub is disposing', 'TEAM_DISPOSED')
    // v8 ignore next 2 -- invalidation wakes queued callers before their next command begins.
    if (loaded.invalid) throw new TeamError(`channel '${loaded.id}' cursor is stale`, 'TEAM_CHANNEL_CURSOR_CONFLICT')
    return loaded
  }

  /** Build an immutable detached Team state response. */
  private teamState(projection: TeamProjection): TeamStateSnapshot {
    const data = teamProjectionData(projection)
    const {
      finalAdmission: _finalAdmission,
      interrupts: _interrupts,
      taskExecutionStats: _taskExecutionStats,
      usageSamples: _usageSamples,
      usageCharges: _usageCharges,
      pendingParentCharges: _pendingParentCharges,
      ...state
    } = {
      ...data,
      participants: data.participants.map(participant => this.participantWithStats(projection, participant)),
    }
    return freeze(teamStateSnapshotSchema.parse(state))
  }

  /** Overlay immutable Hub-derived task observations on one participant read model. */
  private participantWithStats(projection: TeamProjection, participant: ParticipantSnapshot): ParticipantSnapshot {
    const taskOutcomes = [...projection.taskExecutionStats.values()].filter(value => value.participantId === participant.id)
    const activeAttempts = [...projection.tasks.values()].filter(task => task.lease?.participantId === participant.id).length
    const completedAttempts = taskOutcomes.reduce((total, value) => total + value.completedAttempts, 0)
    const failedAttempts = taskOutcomes.reduce((total, value) => total + value.failedAttempts, 0)
    const totalLatencyMs = taskOutcomes.reduce((total, value) => total + value.totalLatencyMs, 0)
    return { ...participant, stats: { activeAttempts, completedAttempts, failedAttempts, totalLatencyMs,
      taskOutcomes: structuredClone(taskOutcomes), updatedAt: projection.team.updatedAt } }
  }

  /** Bound metadata before its journal batch commits; reserve the largest compaction watermark. */
  private discoverySummary(projection: TeamProjection): TeamSnapshot {
    const summary = projection.team
    const header = { stream: { name: teamStreamName(summary.id), version: TEAM_JOURNAL_FORMAT_VERSION,
      tailSequence: summary.cursor, firstSequence: Number.MAX_SAFE_INTEGER, summary } }
    if (Buffer.byteLength(JSON.stringify(header)) + 1 > this.config.maxDiscoveryBytes) {
      throw new TeamError('Team discovery metadata exceeds maxDiscoveryBytes', 'TEAM_CHANNEL_BACKPRESSURE')
    }
    return summary
  }

  /** Build an immutable detached task response. */
  private taskSnapshot(task: TeamTaskSnapshot): TeamTaskSnapshot {
    return freeze(teamTaskSnapshotSchema.parse(task))
  }

  /** Build an immutable detached workflow-plan response. */
  private workflowPlanSnapshot(plan: TeamWorkflowPlanSnapshot): TeamWorkflowPlanSnapshot {
    return freeze(teamWorkflowPlanSnapshotSchema.parse(structuredClone(plan)))
  }

  /** Build an immutable detached response for one durable human action. */
  private humanActionSnapshot(action: TeamHumanActionSnapshot): TeamHumanActionSnapshot {
    return freeze(teamHumanActionSnapshotSchema.parse(structuredClone(action)))
  }

  /** Build an immutable detached activation binding response. */
  private activationBindingSnapshot(binding: ActivationBindingSnapshot): ActivationBindingSnapshot {
    return freeze(structuredClone(binding))
  }

  /** Build an immutable detached response for one durable participant interrupt. */
  private interruptSnapshot(interrupt: ParticipantInterruptSnapshot): ParticipantInterruptSnapshot {
    return freeze(participantInterruptSnapshotSchema.parse(structuredClone(interrupt)))
  }

  /** Normalize immutable provider text before a binding reaches the Team journal. */
  private normalizedActivationBinding(binding: ActivationBindingSnapshot): ActivationBindingSnapshot {
    if (binding.fencedAt !== undefined
      || binding.quiescedAt !== undefined
      || binding.quiescenceSource !== undefined
      || binding.quiescedWakeChannelIds !== undefined) {
      throw new TeamError('published activation binding cannot carry a fence proof', 'TEAM_INVALID_ARGUMENT')
    }
    return {
      activation: { ...binding.activation },
      ...binding.reservationId === undefined ? {} : { reservationId: binding.reservationId },
      sessionId: binding.sessionId,
      provider: normalizedText(binding.provider, 'provider'),
      ...binding.selection === undefined ? {} : { selection: structuredClone(binding.selection) },
      ...(binding.recovery === undefined ? {} : { recovery: activationRecoverySnapshotSchema.parse(binding.recovery) }),
    }
  }

  /** Serialize one exact activation mutation after its Team cursor and durable existence are current. */
  private async withCurrentActivation<T>(
    teamId: TeamId,
    activationId: ActivationBindingSnapshot['activation']['id'],
    expectedCursor: number,
    operation: (team: LoadedTeam, binding: ActivationBindingSnapshot) => Promise<T>,
  ): Promise<T> {
    const loaded = await this.ensureTeam(teamId)
    return await loaded.queue.run(async () => {
      const current = this.requireLiveTeam(loaded)
      this.assertTeamCursor(current, expectedCursor)
      const binding = this.findActivationBinding(current.projection, activationId)
      if (binding === undefined) {
        throw new TeamError(`Activation '${activationId}' was not found`, 'TEAM_ACTIVATION_NOT_FOUND')
      }
      return await operation(current, binding)
    })
  }

  /** Locate one exact activation epoch without treating its id as a participant id. */
  private findActivationBinding(projection: TeamProjection, activationId: ActivationBindingSnapshot['activation']['id']): ActivationBindingSnapshot | undefined {
    return projection.activations.get(activationId)
  }

  /** Build an immutable detached response for one Hub-stamped Envelope. */
  private envelopeSnapshot(envelope: TeamEnvelope): TeamEnvelope {
    return freeze(teamEnvelopeSchema.parse(structuredClone(envelope)))
  }

  /** Build an immutable detached response for one persisted recipient receipt. */
  private receiptSnapshot(receipt: ChannelReceiptRecord): ChannelReceiptRecord {
    return freeze(channelReceiptRecordSchema.parse(structuredClone(receipt)))
  }

  /** Build an immutable detached channel summary response. */
  private summarySnapshot(summary: ChannelSummaryRecord): ChannelSummaryRecord {
    return freeze(channelSummaryRecordSchema.parse(structuredClone(summary)))
  }

  /** Build an immutable detached channel response without exposing adapter fold state. */
  private channelSnapshot(loaded: LoadedChannel): ChannelSnapshot {
    const projection = loaded.projection
    const firstCursor = loaded.stream.firstSequence
    return freeze(channelSnapshotSchema.parse({
      manifest: projection.manifest,
      phase: projection.phase,
      cursor: projection.cursor,
      ...firstCursor === 0 ? {} : { firstCursor },
      replayWatermark: channelReplayWatermark(projection),
    }))
  }

  /** Return counters plus provider-owned gauges and latest latency samples. */
  override getMetrics(): TeamMetricsSnapshot {
    const metrics = super.getMetrics()
    let pendingDeliveries = 0
    let activeActivations = 0
    let activeTasks = 0
    let stalledTeams = 0
    let replayLag = 0
    for (const loaded of this.teams.values()) {
      if (loaded.invalid) continue
      if (loaded.projection.team.phase === 'stalled') stalledTeams += 1
      activeActivations += [...loaded.projection.activations.values()]
        .filter(binding => binding.activation.status !== 'offline').length
      activeTasks += [...loaded.projection.tasks.values()]
        .filter(task => task.phase === 'pending' || task.phase === 'assigned' || task.phase === 'running' || task.phase === 'review').length
    }
    for (const loaded of this.channels.values()) {
      if (loaded.invalid) continue
      pendingDeliveries += pendingDeliveryCount(loaded.projection)
      replayLag = Math.max(replayLag, loaded.projection.cursor - channelReplayWatermark(loaded.projection))
    }
    return Object.freeze({
      ...metrics,
      pendingDeliveries,
      activeActivations,
      activeTasks,
      stalledTeams,
      replayLag,
      lastTaskLatencyMs: this.lastTaskLatencyMs,
      lastReceiptLatencyMs: this.lastReceiptLatencyMs,
    })
  }

  /** Close admission, settle accepted work, checkpoint projections, and release every stream. */
  private closeHub(): Promise<void> {
    this.disposal ??= this.disposeHub()
    return this.disposal
  }

  /** Run the one Hub-owned bounded disposal sequence. */
  private async disposeHub(): Promise<void> {
    this.closing = true
    for (const loaded of this.teams.values()) loaded.activity.close()
    for (const loaded of this.channels.values()) loaded.activity.close()
    const failures: unknown[] = []
    const accepted = [...this.accepted]
    let timedOut = false
    try {
      const settled = await withTimeout(Promise.allSettled(accepted), this.config.disposalTimeoutMs)
      for (const result of settled) {
        // v8 ignore next -- activity closure resolves admitted watches before this settlement starts.
        if (result.status === 'rejected') failures.push(result.reason)
      }
    } catch (error: unknown) {
      // v8 ignore next -- timeout is covered by the bounded lifecycle contract, not normal shutdown.
      failures.push(error)
      timedOut = true
    }
    if (timedOut) {
      while (this.accepted.size > 0) {
        const settled = await Promise.allSettled([...this.accepted])
        for (const result of settled) {
          if (result.status === 'rejected') failures.push(result.reason)
        }
      }
    }
    const teams = [...this.teams.values()]
    const channels = [...this.channels.values()]
    const channelCleanups = [...this.channelCleanups]
    const audits = [...this.auditStreams.values()]
    for (const result of await Promise.allSettled([
      ...teams.map(async (loaded) => {
        await this.maybeCheckpointTeam(loaded, true)
        await loaded.stream.close()
      }),
      ...channels.map(async (loaded) => {
        try {
          await this.maybeCheckpointChannel(loaded, true)
        } finally {
          await this.closeChannelResources(loaded)
        }
      }),
      ...channelCleanups,
      ...audits.map(stream => stream.close()),
    ])) {
      // v8 ignore next -- each backend close is individually covered by storage-log conformance.
      if (result.status === 'rejected') failures.push(result.reason)
    }
    this.teams.clear()
    this.channels.clear()
    this.terminalChannels.clear()
    this.channelCleanups.clear()
    this.channelReleases.clear()
    this.auditStreams.clear()
    this.auditQueues.clear()
    this.validatedAuditStreams.clear()
    this.projectionReadScopes.disable()
    // v8 ignore next -- aggregate disposal failures require a deliberately faulty log provider.
    if (failures.length > 0) throw new AggregateError(failures, 'Team Hub disposal failed')
  }
}

/** Compare the caller-owned fields of a retry request with an accepted Envelope. */
function samePostDraft(envelope: TeamEnvelope, draft: TeamEnvelopeDraft): boolean {
  return envelope.channelId === draft.channelId
    && isDeepStrictEqual(envelope.audience, draft.audience)
    && envelope.kind === draft.kind
    && isDeepStrictEqual(envelope.payload, draft.payload)
    && envelope.delivery === draft.delivery
    && envelope.causationId === draft.causationId
    && envelope.correlationId === draft.correlationId
    && envelope.taskId === draft.taskId
    && envelope.traceId === draft.traceId
    && envelope.priority === (draft.priority ?? 'normal')
    && envelope.ttlMs === draft.ttlMs
}

/** Derive a review fence only from the closed consult review-request record. */
function channelViewReviewFence(envelope: TeamEnvelope): { readonly review: {
  readonly attemptId: string
  readonly reviewRevision: number
  readonly reviewerId: string
  readonly initiatorId: string
} } | undefined {
  if (envelope.kind !== 'review-request') return undefined
  const payload = envelope.payload as Record<string, unknown>
  const attemptId = payload['attemptId']
  const reviewRevision = payload['reviewRevision']
  const reviewerId = payload['reviewerId']
  const initiatorId = payload['initiatorId']
  if (typeof attemptId !== 'string' || attemptId.length === 0
    || typeof reviewRevision !== 'number' || !Number.isSafeInteger(reviewRevision) || reviewRevision < 1
    || typeof reviewerId !== 'string' || reviewerId.length === 0
    || typeof initiatorId !== 'string' || initiatorId.length === 0) return undefined
  return { review: { attemptId, reviewRevision, reviewerId, initiatorId } }
}

/** Return the protocol-owned hard turn bound needed to prove a full transcript view. */
function channelViewTurnBound(manifest: ChannelManifest): number | undefined {
  if (manifest.adapter.type === 'consult') return 2
  const source = manifest.adapter.type === 'workflow'
    ? manifest.limits['graph']
    : manifest.limits['maxTurns']
  if (manifest.adapter.type === 'workflow') {
    if (typeof source !== 'object' || source === null || Array.isArray(source)) return undefined
    const value = (source as JsonObject)['maxTurns']
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : undefined
  }
  return typeof source === 'number' && Number.isSafeInteger(source) && source >= 1 ? source : undefined
}

/** Narrow one JSON value to the object form consumed by a built-in view policy. */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse a policy-owned list of non-empty Envelope identifiers. */
function jsonStringArray(value: unknown): EnvelopeId[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0)
    ? value as EnvelopeId[]
    : []
}

/** Whether a JSON policy selection contains at least one model-facing item. */
function selectedNotEmpty(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

/** Compare retry-safe caller fields for one durable channel summary. */
function sameChannelSummary(
  existing: ChannelSummaryRecord,
  request: ChannelSummarizeInput,
): boolean {
  return isDeepStrictEqual(existing.coveredSequenceRange, request.coveredSequenceRange)
    && isDeepStrictEqual(existing.sourceEnvelopeIds, request.sourceEnvelopeIds)
    && existing.sourceFingerprint === request.sourceFingerprint
    && existing.text === request.text
    && isDeepStrictEqual(existing.policy, request.policy)
}

/** Compare immutable caller facts for an idempotent human-action upsert. */
function sameHumanActionRequest(existing: TeamHumanActionSnapshot, request: TeamHumanActionSnapshot): boolean {
  return existing.teamId === request.teamId
    && existing.id === request.id
    && existing.kind === request.kind
    && existing.sessionId === request.sessionId
    && existing.participantId === request.participantId
    && existing.taskId === request.taskId
    && existing.attemptId === request.attemptId
    && existing.sourceId === request.sourceId
    && isDeepStrictEqual(existing.details, request.details)
}

/** Compare immutable provenance fields for one replaceable usage sample. */
function sameUsageSampleProvenance(left: TeamUsageSample, right: TeamUsageSample): boolean {
  return left.teamId === right.teamId
    && left.participantId === right.participantId
    && left.sessionId === right.sessionId
    && left.provider === right.provider
    && left.model === right.model
    && left.turn === right.turn
    && left.step === right.step
    && left.taskId === right.taskId
    && left.attemptId === right.attemptId
}

/** Compare one usage observation while ignoring its Hub-owned timestamp. */
function sameUsageSampleValue(left: TeamUsageSample, right: TeamUsageSample): boolean {
  return sameUsageSampleProvenance(left, right)
    && isDeepStrictEqual(left.usage, right.usage)
    && left.costUnits === right.costUnits
}

/** Compare one child charge while ignoring the per-hop observation timestamp. */
function sameUsageChargeValue(left: TeamUsageCharge, right: TeamUsageCharge): boolean {
  return sameUsageChargeProvenance(left, right)
    && isDeepStrictEqual(left.usage, right.usage)
    && left.costUnits === right.costUnits
}

/** Compare the immutable source and model-step identity of one child charge. */
function sameUsageChargeProvenance(left: TeamUsageCharge, right: TeamUsageCharge): boolean {
  return left.id === right.id
    && left.sourceTeamId === right.sourceTeamId
    && left.parentTaskId === right.parentTaskId
    && left.originTeamId === right.originTeamId
    && left.sourceSampleId === right.sourceSampleId
    && left.participantId === right.participantId
    && left.sessionId === right.sessionId
    && left.provider === right.provider
    && left.model === right.model
    && left.turn === right.turn
    && left.step === right.step
}

/** Closed typed resource-ceiling keys; unknown keys remain provider extensions. */
const RESOURCE_BUDGET_KEYS = [
  'maxInputTokens',
  'maxOutputTokens',
  'maxTotalTokens',
  'maxTurns',
  'maxWallTimeMs',
  'maxCostUnits',
  'maxRetries',
  'maxConcurrency',
  'maxChildTeams',
  'maxLiveActivations',
  'maxArtifactBytes',
] as const

const DEFAULT_AUTHORITY_OPERATIONS: readonly TeamPolicyHook[] = [
  'register', 'invite', 'activate', 'channel-open', 'send', 'human-action', 'usage', 'dispatch',
  'goal-mutate', 'task-mutate', 'task-assign', 'interrupt', 'workspace-allocate', 'workspace-integrate', 'close',
]
const DEFAULT_AUTHORITY_WORKSPACE_MODES: readonly TeamTaskWorkspaceMode[] = ['shared', 'worktree', 'sandbox', 'remote']

type ResourceBudgetKey = typeof RESOURCE_BUDGET_KEYS[number]
type ResourceBudgetValues = Record<ResourceBudgetKey, number>

/** Resolve and normalize the explicit authority grant for a new Team entity. */
function resolveAuthorityGrant(
  requested: TeamAuthorityGrant | undefined,
  inherited: TeamAuthorityGrant | undefined,
): TeamAuthorityGrant {
  const source = requested ?? inherited ?? {
    operations: DEFAULT_AUTHORITY_OPERATIONS,
    workspaceModes: DEFAULT_AUTHORITY_WORKSPACE_MODES,
    readScopes: ['.'],
    writeScopes: ['.'],
    budgets: {},
  }
  const parsed = teamAuthorityGrantSchema.parse(structuredClone(source))
  return {
    operations: [...parsed.operations],
    workspaceModes: [...parsed.workspaceModes],
    readScopes: normalizeAuthorityScopes(parsed.readScopes, 'authority readScopes'),
    writeScopes: normalizeAuthorityScopes(parsed.writeScopes, 'authority writeScopes'),
    ...parsed.placement === undefined ? {} : { placement: structuredClone(parsed.placement) },
    budgets: structuredClone(parsed.budgets),
  }
}

/** Normalize and deduplicate workspace-relative authority prefixes. */
function normalizeAuthorityScopes(scopes: readonly string[], field: string): readonly string[] {
  const normalized = scopes.map((scope) => {
    if (scope === '.') return scope
    return normalizeTaskScope(scope, field)
  })
  if (new Set(normalized).size !== normalized.length) {
    throw new TeamError(`${field} cannot contain duplicates`, 'TEAM_GRANT_DENIED')
  }
  return normalized
}

/** Require a child budget and grant to be a subset of its immutable parent. */
function assertAuthorityGrantSubset(
  parent: TeamAuthorityGrant,
  child: TeamAuthorityGrant,
  subject: string,
): void {
  if (child.operations.some(operation => !parent.operations.includes(operation))) {
    throw new TeamError(`${subject} requests an operation outside its parent grant`, 'TEAM_GRANT_DENIED')
  }
  if (child.workspaceModes.some(mode => !parent.workspaceModes.includes(mode))) {
    throw new TeamError(`${subject} requests a workspace mode outside its parent grant`, 'TEAM_GRANT_DENIED')
  }
  if (child.readScopes.some(scope => !scopeAllowed(parent.readScopes, scope))) {
    throw new TeamError(`${subject} requests a read scope outside its parent grant`, 'TEAM_GRANT_DENIED')
  }
  if (child.writeScopes.some(scope => !scopeAllowed(parent.writeScopes, scope))) {
    throw new TeamError(`${subject} requests a write scope outside its parent grant`, 'TEAM_GRANT_DENIED')
  }
  assertPlacementGrantSubset(parent.placement, child.placement, subject)
  assertBudgetSubset(parent.budgets, child.budgets, subject)
}

/** Require a child placement restriction to remain within its parent's candidate set. */
function assertPlacementGrantSubset(
  parent: TeamTaskPlacement | undefined,
  child: TeamTaskPlacement | undefined,
  subject: string,
): void {
  if (parent === undefined) return
  if (child === undefined) throw new TeamError(`${subject} omits a placement restriction allowed by its parent grant`, 'TEAM_GRANT_DENIED')
  for (const key of ['participantIds', 'roles', 'providers', 'presets', 'models'] as const) {
    const allowed = parent[key]
    const requested = child[key]
    const allowedValues = allowed === undefined ? undefined : new Set<string>(allowed)
    if (allowedValues !== undefined
      && (requested === undefined || requested.some(value => !allowedValues.has(value)))) {
      throw new TeamError(`${subject} requests a placement value outside its parent grant`, 'TEAM_GRANT_DENIED')
    }
  }
}

/** Require a child budget ceiling to fit under every parent ceiling it names. */
function assertBudgetSubset(parent: TeamResourceBudget, child: JsonObject | TeamResourceBudget, subject: string): void {
  const parentBudget = resourceBudget(parent as unknown as JsonObject, `${subject} parent budget`)
  const childBudget = resourceBudget(child as JsonObject, `${subject} budget`)
  for (const key of RESOURCE_BUDGET_KEYS) {
    const limit = parentBudget[key]
    const value = childBudget[key]
    if (limit !== undefined && value !== undefined && value > limit) {
      throw new TeamError(`${subject} budget '${key}' exceeds its parent ceiling`, 'TEAM_BUDGET_EXCEEDED')
    }
  }
}

/** Test whether a workspace-relative path is covered by one granted prefix. */
function scopeAllowed(grantedScopes: readonly string[], requested: string): boolean {
  return grantedScopes.some(scope => scope === '.' || requested === scope || requested.startsWith(`${scope}/`))
}

/** Parse known budget ceilings while retaining compatibility with namespaced extensions. */
function resourceBudget(value: JsonObject, subject: string): TeamResourceBudget {
  const raw = jsonObjectSchema.parse(value)
  const known: Record<string, JsonValue> = {}
  for (const key of RESOURCE_BUDGET_KEYS) {
    if (Object.hasOwn(raw, key)) known[key] = raw[key] as JsonValue
  }
  if (Object.hasOwn(raw, 'extensions')) known.extensions = raw.extensions as JsonValue
  const parsed = teamResourceBudgetSchema.safeParse(known)
  if (!parsed.success) {
    throw new TeamError(`${subject} contains an invalid typed resource ceiling`, 'TEAM_BUDGET_INVALID', { cause: parsed.error })
  }
  return parsed.data
}

/** Start an all-zero usage vector for typed budget comparisons. */
function emptyResourceBudgetValues(): ResourceBudgetValues {
  return Object.fromEntries(RESOURCE_BUDGET_KEYS.map(key => [key, 0])) as ResourceBudgetValues
}

/** Project current Team consumption onto the typed budget dimensions. */
function resourceBudgetUsage(projection: TeamProjection): ResourceBudgetValues {
  const values = emptyResourceBudgetValues()
  const usage = projection.usage
  values.maxInputTokens = usage.inputTokens
  values.maxOutputTokens = usage.outputTokens
  values.maxTotalTokens = safeBudgetNumber(usage.inputTokens + usage.outputTokens)
  values.maxTurns = usage.turns
  values.maxWallTimeMs = Math.max(0, Date.now() - projection.team.createdAt)
  values.maxCostUnits = usage.costUnits
  values.maxRetries = teamRetryCount(projection.tasks)
  values.maxConcurrency = [...projection.tasks.values()].reduce((sum, task) => safeBudgetNumber(sum + taskConcurrencyUsage(task)), 0)
  values.maxLiveActivations = liveActivationCapacity(
    projection.participants.values(), projection.activations.values(), projection.tasks.values(),
  )
  values.maxChildTeams = [...projection.tasks.values()].reduce((sum, task) => safeBudgetNumber(sum + taskChildTeamReservation(task)), 0)
  return values
}

/** Reserve the explicit ceilings of all nonterminal tasks before admitting another task. */
function reservedTaskBudget(tasks: ReadonlyMap<TeamTaskId, TeamTaskSnapshot>): ResourceBudgetValues {
  const reserved = emptyResourceBudgetValues()
  for (const task of tasks.values()) {
    if (task.phase === 'completed' || task.phase === 'failed' || task.phase === 'cancelled' || task.phase === 'deleted') continue
    const budget = resourceBudget(task.budget, `task '${task.id}' budget`)
    for (const key of RESOURCE_BUDGET_KEYS) {
      if (key === 'maxLiveActivations') continue
      const value = budget[key]
      if (value !== undefined) reserved[key] = safeBudgetNumber(reserved[key] + value)
    }
  }
  return reserved
}

/** Ensure every task budget in one workflow fits the Team's remaining ledger before admission. */
function assertWorkflowPlanTaskBudgets(projection: TeamProjection, plan: TeamWorkflowPlan): void {
  const teamBudget = resourceBudget(projection.budgets, 'Team budget')
  const usage = resourceBudgetUsage(projection)
  const reserved = reservedTaskBudget(projection.tasks)
  for (const template of plan.tasks) {
    const requested = resourceBudget(template.budget, `workflow task '${template.id}' budget`)
    for (const key of RESOURCE_BUDGET_KEYS) {
      const limit = teamBudget[key]
      const value = requested[key]
      if (limit !== undefined && value !== undefined) {
        const remaining = limit - usage[key] - reserved[key]
        if (value > remaining) {
          throw new TeamError(
            `workflow task '${template.id}' budget '${key}' requests ${String(value)} but Team '${projection.team.id}' has ${String(Math.max(0, remaining))} remaining`,
            'TEAM_BUDGET_EXCEEDED',
          )
        }
      }
      if (value !== undefined) reserved[key] = safeBudgetNumber(reserved[key] + value)
    }
  }
}

/** Compare one task's observed usage against its frozen typed ceilings. */
function taskBudgetExceeded(
  task: TeamTaskSnapshot | undefined,
  samples: ReadonlyMap<TeamUsageSample['id'], TeamUsageSample>,
  observedAt: number,
  charges: ReadonlyMap<TeamUsageCharge['id'], TeamUsageCharge> = new Map(),
): { readonly code: string; readonly message: string } | undefined {
  if (task === undefined) return undefined
  const budget = resourceBudget(task.budget, `task '${task.id}' budget`)
  const relevant = [
    ...[...samples.values()].filter(sample => sample.taskId === task.id).map(sample => ({ ...sample, originTeamId: sample.teamId })),
    ...[...charges.values()].filter(charge => charge.parentTaskId === task.id),
  ]
  const inputTokens = relevant.reduce((sum, sample) => safeBudgetNumber(sum + sample.usage.inputTokens), 0)
  const outputTokens = relevant.reduce((sum, sample) => safeBudgetNumber(sum + sample.usage.outputTokens), 0)
  const turns = new Set(relevant.map(sample => `${sample.originTeamId}:${sample.sessionId}:${String(sample.turn)}`)).size
  const costUnits = relevant.reduce((sum, sample) => safeBudgetNumber(sum + (sample.costUnits ?? 0)), 0)
  const assignedAt = task.delegation?.startedAt ?? task.lease?.assignedAt ?? task.attemptHistory.at(-1)?.assignedAt
  const values: ResourceBudgetValues = {
    ...emptyResourceBudgetValues(),
    maxInputTokens: inputTokens,
    maxOutputTokens: outputTokens,
    maxTotalTokens: safeBudgetNumber(inputTokens + outputTokens),
    maxTurns: turns,
    maxWallTimeMs: assignedAt === undefined ? 0 : Math.max(0, observedAt - assignedAt),
    maxCostUnits: costUnits,
    maxRetries: Math.max(0, task.attemptCount - 1),
    maxConcurrency: taskConcurrencyUsage(task),
  }
  for (const key of RESOURCE_BUDGET_KEYS) {
    // Execution and descendant ceilings are checked at admission, not charged by model usage.
    if (key === 'maxConcurrency' || key === 'maxChildTeams' || key === 'maxLiveActivations') continue
    const limit = budget[key]
    if (limit !== undefined && values[key] > limit) {
      return {
        code: `TEAM_TASK_${key.replaceAll('max', '').replaceAll(/([A-Z])/gu, '_$1').toUpperCase()}_BUDGET_EXCEEDED`,
        message: `Team task '${task.id}' exceeded its ${key} budget of ${String(limit)}`,
      }
    }
  }
  return undefined
}

/** Keep typed budget sums within the same safe range as durable token counters. */
function safeBudgetNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new TeamError('Team budget aggregate is not representable', 'TEAM_BUDGET_INVALID')
  }
  if (value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new TeamError('Team budget aggregate is outside its representable range', 'TEAM_BUDGET_INVALID')
  }
  return value
}

/** Return the first frozen Team budget exceeded by one usage aggregate. */
function usageBudgetExceeded(
  projection: TeamProjection,
  usage: TeamUsageSnapshot,
): { readonly code: string; readonly message: string } | undefined {
  const raw = projection.rules.teamLimits
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const limit = (key: string): number | undefined => {
    const value = (raw as JsonObject)[key]
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
  }
  const maxTurns = limit('maxTurnsPerTeam')
  if (maxTurns !== undefined && usage.turns > maxTurns) {
    return { code: 'TEAM_TURN_BUDGET_EXCEEDED', message: `Team '${projection.team.id}' exceeded its ${String(maxTurns)}-turn model budget` }
  }
  const maxTokens = limit('maxModelTokensPerTeam')
  if (maxTokens !== undefined && usage.outputTokens > maxTokens) {
    return { code: 'TEAM_TOKEN_BUDGET_EXCEEDED', message: `Team '${projection.team.id}' exceeded its ${String(maxTokens)}-token model budget` }
  }
  const maxCostRaw = (raw as JsonObject).maxCostUnitsPerTeam
  const maxCost = typeof maxCostRaw === 'number' && Number.isFinite(maxCostRaw) && maxCostRaw > 0 ? maxCostRaw : undefined
  if (maxCost !== undefined && usage.costUnits > maxCost) {
    return { code: 'TEAM_COST_BUDGET_EXCEEDED', message: `Team '${projection.team.id}' exceeded its ${String(maxCost)}-unit cost budget` }
  }
  const typedBudget = resourceBudget(projection.budgets, 'Team budget')
  const typedUsage: ResourceBudgetValues = {
    ...resourceBudgetUsage(projection),
    maxInputTokens: usage.inputTokens,
    maxOutputTokens: usage.outputTokens,
    maxTotalTokens: safeBudgetNumber(usage.inputTokens + usage.outputTokens),
    maxTurns: usage.turns,
    maxCostUnits: usage.costUnits,
  }
  for (const key of RESOURCE_BUDGET_KEYS) {
    const limit = typedBudget[key]
    if (limit !== undefined && typedUsage[key] > limit) {
      return {
        code: `TEAM_${key.replaceAll('max', '').replaceAll(/([A-Z])/gu, '_$1').toUpperCase()}_BUDGET_EXCEEDED`,
        message: `Team '${projection.team.id}' exceeded its ${key} budget of ${String(limit)}`,
      }
    }
  }
  return undefined
}

/** Return the first frozen Team budget that is exhausted during a recovery pass. */
function teamBudgetStallReason(projection: TeamProjection): TeamStallReason | undefined {
  const raw = projection.rules.teamLimits
  const limits = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as JsonObject
    : undefined
  const legacyLimit = (key: string): number | undefined => {
    const value = limits?.[key]
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
  }
  const typed = resourceBudget(projection.budgets, 'Team budget')
  const wallLimit = typed.maxWallTimeMs === undefined
    ? legacyLimit('maxWallTimeMsPerTeam')
    : limits === undefined
      ? typed.maxWallTimeMs
      : Math.min(typed.maxWallTimeMs, legacyLimit('maxWallTimeMsPerTeam') ?? typed.maxWallTimeMs)
  if (wallLimit !== undefined && Date.now() - projection.team.createdAt >= wallLimit) {
    return {
      code: 'TEAM_WALL_TIME_BUDGET_EXCEEDED',
      message: `Team '${projection.team.id}' exceeded its ${String(wallLimit)}ms wall-time budget`,
    }
  }
  const usage = resourceBudgetUsage(projection)
  const candidates: readonly {
    readonly key: ResourceBudgetKey
    readonly limit: number | undefined
    readonly legacy: number | undefined
    readonly code: string
  }[] = [
    { key: 'maxInputTokens', limit: typed.maxInputTokens, legacy: undefined, code: 'TEAM_INPUT_TOKENS_BUDGET_EXCEEDED' },
    { key: 'maxOutputTokens', limit: typed.maxOutputTokens, legacy: legacyLimit('maxModelTokensPerTeam'), code: 'TEAM_TOKEN_BUDGET_EXCEEDED' },
    { key: 'maxTotalTokens', limit: typed.maxTotalTokens, legacy: undefined, code: 'TEAM_TOTAL_TOKENS_BUDGET_EXCEEDED' },
    { key: 'maxTurns', limit: typed.maxTurns, legacy: legacyLimit('maxTurnsPerTeam'), code: 'TEAM_TURN_BUDGET_EXCEEDED' },
    { key: 'maxCostUnits', limit: typed.maxCostUnits, legacy: legacyLimit('maxCostUnitsPerTeam'), code: 'TEAM_COST_BUDGET_EXCEEDED' },
  ]
  for (const candidate of candidates) {
    const limit = candidate.limit === undefined ? candidate.legacy
      : candidate.legacy === undefined ? candidate.limit : Math.min(candidate.limit, candidate.legacy)
    if (limit === undefined || usage[candidate.key] < limit) continue
    return {
      code: candidate.code,
      message: `Team '${projection.team.id}' reached its ${candidate.key} budget of ${String(limit)}`,
    }
  }
  return undefined
}

/** Price one usage sample from the immutable provider/model rate snapshot. */
function usageCost(projection: TeamProjection, sample: TeamUsageSample): number | undefined {
  return usageCostForValues(
    projection,
    sample.provider,
    sample.model,
    sample.usage,
    `usage sample '${sample.id}'`,
  )
}

/** Price one propagated child charge from the receiving Team's frozen rate table. */
function usageCostForCharge(projection: TeamProjection, charge: TeamUsageCharge): number | undefined {
  return usageCostForValues(
    projection,
    charge.provider,
    charge.model,
    charge.usage,
    `usage charge '${charge.id}'`,
  )
}

/** Calculate a normalized cost from one immutable provider/model rate entry. */
function usageCostForValues(
  projection: TeamProjection,
  provider: string | undefined,
  model: string | undefined,
  usage: TeamUsageSample['usage'],
  subject: string,
): number | undefined {
  const raw = projection.rules.usageRates
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  if (provider === undefined || model === undefined) return undefined
  const candidate = (raw as JsonObject)[`${provider}/${model}`]
    ?? (raw as JsonObject)[provider]
    ?? (raw as JsonObject)['*']
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined
  const value = candidate as JsonObject
  const input = finiteNonNegative(value.input)
  const output = finiteNonNegative(value.output)
  const cacheRead = finiteNonNegative(value.cacheRead)
  const cacheWrite = finiteNonNegative(value.cacheWrite)
  if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) return undefined
  const cost = usage.inputTokens * input
    + usage.outputTokens * output
    + (usage.cacheReadTokens ?? 0) * cacheRead
    + (usage.cacheWriteTokens ?? 0) * cacheWrite
  if (!Number.isFinite(cost) || cost < 0 || cost > Number.MAX_SAFE_INTEGER) {
    throw new TeamError(`${subject} produced an unrepresentable cost`, 'TEAM_INVALID_ARGUMENT')
  }
  return cost
}

/** Return whether a cost ceiling makes an unknown provider price unsafe. */
function usageCostRequired(
  projection: TeamProjection,
  participantId: ParticipantId,
  taskId: TeamTaskId | undefined,
): boolean {
  if (resourceBudget(projection.budgets, 'Team budget').maxCostUnits !== undefined) return true
  const participant = projection.participants.get(participantId)
  if (participant?.authorityGrant?.budgets.maxCostUnits !== undefined) return true
  if (taskId !== undefined) {
    const task = projection.tasks.get(taskId)
    if (task !== undefined && resourceBudget(task.budget, `task '${task.id}' budget`).maxCostUnits !== undefined) return true
  }
  return false
}

/** Read one finite non-negative number from an immutable JSON rate entry. */
function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
    ? value
    : undefined
}

/** Compare two immutable activation targets without widening their branded identities. */
function sameInterruptTarget(left: ParticipantInterruptTarget, right: ParticipantInterruptTarget): boolean {
  return left.teamId === right.teamId
    && left.participantId === right.participantId
    && left.activationId === right.activationId
    && left.sessionId === right.sessionId
    && left.provider === right.provider
}

/** Build policy facts only after the Hub resolves the exact interrupt target binding. */
function interruptFacts(expectedCursor: number, target: ParticipantInterruptTarget): JsonObject {
  return {
    expectedCursor,
    teamId: target.teamId,
    participantId: target.participantId,
    activationId: target.activationId,
    sessionId: target.sessionId,
    provider: target.provider,
  }
}

/** Build policy facts from one complete parsed human participant invitation. */
function participantInviteFacts(input: ParticipantInviteInput): JsonObject {
  return {
    operation: 'participant-invite',
    ...jsonObjectSchema.parse(structuredClone(input)),
  }
}

/** Build policy facts from one complete parsed human participant phase mutation. */
function participantPhaseFacts(input: ParticipantPhaseTransitionInput): JsonObject {
  return {
    operation: 'participant-phase',
    ...jsonObjectSchema.parse(structuredClone(input)),
  }
}

/** Build the policy facts for one already-validated channel delivery claim. */
function claimFacts(input: ChannelDeliveryClaimInput, binding: ActivationBindingSnapshot): JsonObject {
  return {
    activationId: binding.activation.id,
    sessionId: binding.sessionId,
    channelId: input.channelId,
    participantId: binding.activation.participantId,
    envelopeId: input.envelopeId,
  }
}

/** Build policy facts after the Hub resolves the proof-derived task lease owner binding. */
function taskAttemptStartClaimFacts(
  request: TeamTaskAttemptStartClaimInput,
  binding: ActivationBindingSnapshot,
): JsonObject {
  return {
    taskId: request.taskId,
    attemptId: request.attemptId,
    assignedRevision: request.assignedRevision,
    participantId: binding.activation.participantId,
    activationId: binding.activation.id,
    sessionId: binding.sessionId,
    channelId: request.channelId,
    envelopeId: request.envelopeId,
  }
}

/** Build policy facts for one complete post-mutation Team goal value. */
function goalMutationFacts(goal: TeamGoalSnapshot, expectedRevision: number): JsonObject {
  return {
    expectedRevision,
    revision: goal.revision,
    objective: goal.objective,
    phase: goal.phase,
    budgets: goal.budgets,
    ...goal.blocker === undefined ? {} : {
      blocker: { code: goal.blocker.code, message: goal.blocker.message },
    },
  }
}

/** Build policy facts for a revision-and-attempt fence without trusting extra caller fields. */
function attemptFacts(request: TeamTaskAttemptFence): JsonObject {
  return {
    taskId: request.taskId,
    expectedRevision: request.expectedRevision,
    attemptId: request.attemptId,
  }
}

/** Add the optional agent epoch that belongs to one owner-fenced attempt operation. */
function ownerAttemptFacts(request: TeamTaskAttemptOwnerFence): JsonObject {
  return {
    ...attemptFacts(request),
    ...request.activationId === undefined ? {} : { activationId: request.activationId },
    participantId: request.participantId,
  }
}

/** Build policy facts after the Hub derives a current task-attempt owner from its runtime proof. */
function proofAttemptFacts(
  request: { readonly taskId: TeamTaskId; readonly expectedRevision: number; readonly attemptId: TaskAttemptId },
  binding: ActivationBindingSnapshot,
): JsonObject {
  return {
    taskId: request.taskId,
    expectedRevision: request.expectedRevision,
    attemptId: request.attemptId,
    participantId: binding.activation.participantId,
    activationId: binding.activation.id,
    sessionId: binding.sessionId,
    provider: binding.provider,
  }
}

/** Build policy facts for one exact pre-materialization workspace reservation. */
function workspaceReservationFacts(
  input: TeamWorkspaceAllocationReserveInput,
  sourceName: string,
): JsonObject {
  return {
    operation: 'reserve',
    sourceName,
    taskId: input.taskId,
    expectedTaskRevision: input.expectedTaskRevision,
    attemptId: input.attemptId,
    allocationId: input.allocation.id,
    provider: input.allocation.provider,
    mode: input.allocation.mode,
    assignedRevision: input.allocation.assignedRevision,
    participantId: input.allocation.participantId,
    activationId: input.allocation.activationId,
    sessionId: input.allocation.sessionId,
    ...input.allocation.baseVersion === undefined ? {} : { baseVersion: input.allocation.baseVersion },
  }
}

/** Build policy facts for one exact allocation lifecycle transition. */
function workspaceAllocationTransitionFacts(
  allocation: TeamWorkspaceAllocationSnapshot,
  operation: Exclude<TeamSystemWorkspaceAllocationScope['kind'], 'workspace-allocation-reserve' | 'workspace-observe' | 'workspace-allocation-loss'>,
  sourceName: string,
  input: TeamWorkspaceAllocationActivateInput
    | TeamWorkspaceAllocationReleaseRequestInput
    | TeamWorkspaceAllocationPreserveInput
    | TeamWorkspaceAllocationReleaseInput,
): JsonObject {
  return {
    operation,
    sourceName,
    allocationId: allocation.id,
    expectedRevision: input.expectedRevision,
    lifecycle: allocation.lifecycle,
    taskId: allocation.taskId,
    attemptId: allocation.attemptId,
    participantId: allocation.participantId,
    activationId: allocation.activationId,
    sessionId: allocation.sessionId,
    provider: allocation.provider,
    mode: allocation.mode,
    ...allocation.baseVersion === undefined ? {} : { baseVersion: allocation.baseVersion },
    ...'reason' in input ? { reason: { code: input.reason.code, message: input.reason.message } } : {},
  }
}

/** Convert one closed attempt outcome into JSON-safe policy facts. */
function attemptOutcomeFacts(outcome: TaskAttemptOutcome): JsonObject {
  switch (outcome.kind) {
    case 'released':
    case 'lease-expired':
    case 'cancelled':
      return { kind: outcome.kind }
    case 'failed':
      return { kind: outcome.kind, failure: { code: outcome.failure.code, message: outcome.failure.message } }
    case 'completed':
      return { kind: outcome.kind, result: structuredClone(outcome.result) as unknown as JsonObject }
    /* v8 ignore next 2 -- TaskAttemptOutcome is closed and all discriminants are handled above. */
    default:
      outcome satisfies never
      throw new Error('unreachable task attempt outcome')
  }
}

/** Decode one durable Team-journal value at the storage boundary. */
function parseTeamRecord(value: unknown, teamId: TeamId): TeamJournalRecord {
  try {
    return teamJournalRecordSchema.parse(value)
  } catch (error: unknown) {
    throw new TeamHubError(`Team '${teamId}' journal contains an invalid record`, 'TEAM_JOURNAL_MALFORMED', { cause: error })
  }
}

/** Decode one durable channel-WAL value at the storage boundary. */
function parseChannelRecord(value: unknown, channelId: ChannelId): ChannelRecord {
  try {
    return channelRecordSchema.parse(value)
  } catch (error: unknown) {
    throw new TeamHubError(`channel '${channelId}' WAL contains an invalid record`, 'TEAM_CHANNEL_WAL_MALFORMED', { cause: error })
  }
}

/** Remove source metadata from one durable record while retaining its audit facts. */
function auditRecordFacts(record: TeamJournalRecord | ChannelRecord): {
  readonly type: string
  readonly createdAt: number
  readonly facts: JsonObject
} {
  if (record.type === 'workspace/observed') {
    const observation = record.observation
    return { type: record.type, createdAt: record.createdAt, facts: {
      observation: structuredClone(observation) as unknown as JsonObject,
      warnings: [
        ...observation.truncated ? ['WORKSPACE_OBSERVATION_INCOMPLETE'] : [],
        ...observation.paths.some(path => path.classification === 'undeclared') ? ['WORKSPACE_UNDECLARED_PATHS'] : [],
        ...observation.paths.some(path => path.classification === 'external-window') ? ['WORKSPACE_EXTERNAL_WINDOW'] : [],
      ],
    } }
  }
  if (record.type === 'channel/envelope') {
    const { type, ...facts } = record
    return { type, createdAt: record.envelope.createdAt, facts: structuredClone(facts) as unknown as JsonObject }
  }
  const { type, createdAt, ...facts } = record
  return { type, createdAt, facts: structuredClone(facts) as unknown as JsonObject }
}

/** Decode one durable audit projection row and verify its source identity. */
function parseAuditEntry(
  value: unknown,
  teamId: TeamId,
  source: 'team' | 'channel',
  channelId?: ChannelId,
): TeamAuditEntry {
  const malformedCode = source === 'channel' ? 'TEAM_CHANNEL_WAL_MALFORMED' : 'TEAM_JOURNAL_MALFORMED'
  try {
    const entry = teamAuditEntrySchema.parse(value)
    if (entry.teamId !== teamId || entry.stream !== source || entry.channelId !== channelId) {
      throw new Error('audit entry source identity does not match its stream')
    }
    return entry
  } catch (error: unknown) {
    throw new TeamHubError(`${source} audit projection contains an invalid entry`, malformedCode, { cause: error })
  }
}

/** Build one audit projection row from an authoritative source record. */
function auditEntryForRecord(
  record: TeamJournalRecord | ChannelRecord,
  teamId: TeamId,
  source: 'team' | 'channel',
  cursor: number,
  channelId?: ChannelId,
): TeamAuditEntry {
  const { type, createdAt, facts } = auditRecordFacts(record)
  return teamAuditEntrySchema.parse({
    teamId,
    stream: source,
    ...channelId === undefined ? {} : { channelId },
    cursor,
    type,
    createdAt,
    facts,
  })
}

/** Project one Team journal record into the post-commit observer event. */
function teamEventFor(record: TeamJournalRecord, projection: TeamProjection): TeamEvent {
  switch (record.type) {
    case 'team/created':
      return { type: 'team/created', team: projection.team }
    case 'team/phase':
    case 'team/child-run-bound':
    case 'team/child-result-admitted':
    case 'team/closure':
    case 'team/final-admitted':
    case 'team/cancellation':
    case 'team/archived':
    case 'channel/attached':
      return { type: 'team/changed', team: projection.team }
    case 'goal/changed':
      return {
        type: 'goal/changed',
        goal: record.goal,
        cursor: projection.team.cursor,
        createdAt: record.createdAt,
      }
    case 'participant/changed':
      return { type: 'participant/changed', participant: record.participant, cursor: projection.team.cursor, createdAt: record.createdAt }
    case 'task/changed':
      return { type: 'task/changed', task: record.task, cursor: projection.team.cursor, createdAt: record.createdAt }
    case 'workspace/observed':
      return { type: 'workspace/observed', observation: record.observation, cursor: projection.team.cursor, createdAt: record.createdAt }
    case 'workspace-allocation/changed':
      return {
        type: 'workspace-allocation/changed',
        allocation: record.allocation,
        cursor: projection.team.cursor,
        createdAt: record.createdAt,
      }
    case 'activation/changed':
      return { type: 'activation/changed', binding: record.binding, cursor: projection.team.cursor, createdAt: record.createdAt }
    case 'participant-interrupt/requested':
      return {
        type: 'participant-interrupt/changed',
        interrupt: record.interrupt,
        cursor: projection.team.cursor,
        createdAt: record.createdAt,
      }
    case 'participant-interrupt/acknowledged': {
      const interrupt = projection.interrupts.get(record.interruptId)
      /* v8 ignore next 3 -- the journal fold rejects an acknowledgement without its requested interrupt. */
      if (interrupt === undefined) throw new TeamHubError(
        `participant interrupt '${record.interruptId}' is absent after acknowledgement`, 'TEAM_JOURNAL_MALFORMED')
      return { type: 'participant-interrupt/changed', interrupt, cursor: projection.team.cursor, createdAt: record.createdAt }
    }
    case 'human-action/changed':
      return {
        type: 'human-action/changed',
        action: record.action,
        cursor: projection.team.cursor,
        createdAt: record.createdAt,
      }
    case 'usage/changed':
    case 'usage/child-charged':
      return {
        type: 'usage/changed',
        teamId: projection.team.id,
        usage: record.usage,
        cursor: projection.team.cursor,
        createdAt: record.createdAt,
      }
    case 'usage/parent-charge-pending':
    case 'usage/parent-charge-settled':
      return { type: 'team/changed', team: projection.team }
    case 'workflow-plan/changed':
      return {
        type: 'workflow-plan/changed',
        plan: record.plan,
        cursor: projection.team.cursor,
        createdAt: record.createdAt,
      }
    case 'policy/denied':
      return {
        type: 'policy/denied',
        teamId: projection.team.id,
        hook: record.hook,
        ...record.actorId === undefined ? {} : { actorId: record.actorId },
        code: record.code,
        message: record.message,
        cursor: projection.team.cursor,
        createdAt: record.createdAt,
      }
    /* v8 ignore next 2 -- TeamJournalRecord is closed and all discriminants are handled above. */
    default:
      return assertNever(record)
  }
}

/** Compare the durable closure identity and immutable request facts for a retry. */
function closureMatches(
  existing: TeamClosureSnapshot,
  request: ResolvedTeamClosureInput<TeamClosureInput>,
  kind: 'complete' | 'fail' | 'cancel',
): boolean {
  if (existing.teamId !== request.teamId
    || existing.kind !== kind
    || existing.idempotencyKey !== request.idempotencyKey
    || !isDeepStrictEqual(existing.actor, request.actor)
    || !isDeepStrictEqual(existing.reason, request.reason)) return false
  if (kind === 'complete') {
    const completion = request as ResolvedTeamClosureInput<TeamCompleteInput>
    return existing.finalChannelId === completion.finalChannelId
      && existing.finalEnvelopeId === completion.finalEnvelopeId
  }
  return existing.finalChannelId === undefined && existing.finalEnvelopeId === undefined
}

/** Compare a retryable cancellation request with its durable admission fact. */
function cancellationMatches(
  existing: TeamCancellationSnapshot,
  request: ResolvedTeamClosureInput<TeamClosureInput>,
): boolean {
  return existing.teamId === request.teamId
    && existing.idempotencyKey === request.idempotencyKey
    && isDeepStrictEqual(existing.actor, request.actor)
    && isDeepStrictEqual(existing.reason, request.reason)
}

/** Convert a typed closure actor to the optional policy actor identity. */
function closureActorId(actor: TeamClosureActor): ParticipantId | undefined {
  return actor.kind === 'participant' ? actor.participantId : undefined
}

/** Build lossless policy facts from the typed closure command. */
function closureFacts(
  request: ResolvedTeamClosureInput<TeamClosureInput>,
  kind: 'complete' | 'fail' | 'cancel',
): JsonObject {
  const completion = kind === 'complete' ? request as ResolvedTeamClosureInput<TeamCompleteInput> : undefined
  return {
    kind,
    expectedCursor: request.expectedCursor,
    idempotencyKey: request.idempotencyKey,
    reason: { code: request.reason.code, message: request.reason.message },
    actor: request.actor.kind === 'participant'
      ? { kind: 'participant', participantId: request.actor.participantId }
      : { kind: 'system', name: request.actor.name },
    ...completion === undefined ? {} : {
      finalChannelId: completion.finalChannelId,
      finalEnvelopeId: completion.finalEnvelopeId,
    },
  }
}

/** Check whether a checkpoint still has an entry at its claimed watermark. */
async function hasCheckpointAnchor(stream: HubLogStream, sequence: number): Promise<boolean> {
  // v8 ignore next -- Team checkpoints contain a non-negative projection cursor.
  if (sequence < 0) return false
  const anchor = await stream.read(sequence - 1, 1)
  return anchor.length === 1 && anchor[0]?.sequence === sequence
}

/** Close a stream after a failed recovery or creation and preserve the original failure. */
async function closeAfterFailure(stream: HubLogStream, error: unknown): Promise<never> {
  try {
    await stream.close()
  } catch (closeError: unknown) {
    // v8 ignore next -- a second close failure is aggregated only for a faulty stream provider.
    throw new AggregateError([error, closeError], `Team Hub stream '${stream.name}' failed during cleanup`)
  }
  throw error
}

/** Mint an opaque Team identity without converting from a Session identity. */
function mintTeamId(): TeamId {
  return teamIdSchema.parse(`team-${randomUUID()}`)
}

/** Mint an opaque participant identity without converting from a Session identity. */
function mintParticipantId(): ParticipantId {
  return participantIdSchema.parse(`participant-${randomUUID()}`)
}

/** Mint an opaque durable participant-interrupt identity. */
function mintTeamInterruptId(): TeamInterruptId {
  return teamInterruptIdSchema.parse(`interrupt-${randomUUID()}`)
}

/** Mint an opaque Team-task identity. */
function mintTaskId(): TeamTaskId {
  return teamTaskIdSchema.parse(`task-${randomUUID()}`)
}

/** Mint one opaque workflow-plan identity at its Team provider boundary. */
function mintWorkflowPlanId(): TeamWorkflowPlanSnapshot['id'] {
  return teamWorkflowPlanIdSchema.parse(`workflow-${randomUUID()}`)
}

/** Mint an opaque Team-task attempt identity. */
function mintTaskAttemptId(): TaskAttemptId {
  return taskAttemptIdSchema.parse(`attempt-${randomUUID()}`)
}

/** Mint an opaque channel identity. */
function mintChannelId(): ChannelId {
  return channelIdSchema.parse(`channel-${randomUUID()}`)
}

/** Mint an opaque Hub-stamped channel-envelope identity. */
function mintEnvelopeId() {
  return envelopeIdSchema.parse(`envelope-${randomUUID()}`)
}

/** Derive one stable parent-charge identity from a Team's usage sample. */
function usageChargeForSample(
  sourceTeamId: TeamId,
  parentTaskId: TeamTaskId,
  sample: TeamUsageSample,
  observedAt: number,
): TeamUsageCharge {
  return teamUsageChargeSchema.parse({
    id: teamUsageChargeIdSchema.parse(`${sourceTeamId}:${sample.id}`),
    sourceTeamId,
    parentTaskId,
    originTeamId: sourceTeamId,
    sourceSampleId: sample.id,
    participantId: sample.participantId,
    sessionId: sample.sessionId,
    ...sample.provider === undefined ? {} : { provider: sample.provider },
    ...sample.model === undefined ? {} : { model: sample.model },
    turn: sample.turn,
    step: sample.step,
    usage: structuredClone(sample.usage),
    ...sample.costUnits === undefined ? {} : { costUnits: sample.costUnits },
    observedAt,
  })
}

/** Derive one Team-owned log stream name. */
function teamStreamName(teamId: TeamId): string {
  return `team/${teamId}`
}

/** Derive one channel-owned log stream name. */
function channelStreamName(channelId: ChannelId): string {
  return `channel/${channelId}`
}

/** Derive one Team-owned audit projection stream name. */
function auditStreamName(teamId: TeamId, channelId?: ChannelId): string {
  return channelId === undefined
    ? `audit/${teamId}`
    : `audit/${teamId}/channel/${channelId}`
}

/** Normalize one required human-authored string before durable storage. */
function normalizedText(value: string, field: string): string {
  const text = value.trim()
  if (text.length === 0) throw new TeamError(`${field} must be non-empty`, 'TEAM_INVALID_ARGUMENT')
  return text
}

/** Normalize the provider and target fields retained by one integration task. */
function normalizeIntegrationSpec(value: TeamTaskIntegrationSpec): TeamTaskIntegrationSpec {
  return {
    sourceTaskId: value.sourceTaskId,
    sourceAttemptId: value.sourceAttemptId,
    provider: normalizedText(value.provider, 'integration provider'),
    target: normalizedText(value.target, 'integration target'),
    ...value.expectedTarget === undefined ? {} : { expectedTarget: normalizedText(value.expectedTarget, 'integration expected target') },
    mode: value.mode,
  }
}

function normalizeTaskCreate(request: TeamTaskCreateInput): NormalizedTaskCreate {
  return {
    execution: request.execution === undefined ? { kind: 'participant' } : teamTaskExecutionSchema.parse(request.execution),
    placement: request.placement === undefined ? undefined : teamTaskPlacementSchema.parse(request.placement),
    parentTaskId: request.parentTaskId,
    workflowPlanId: request.workflowPlanId,
    workflowTemplateId: request.workflowTemplateId,
    integration: request.integration === undefined ? undefined : normalizeIntegrationSpec(request.integration),
    subject: normalizedText(request.subject, 'subject'),
    description: normalizedText(request.description, 'description'),
    blockedBy: [...request.blockedBy],
    requiredCapabilities: normalizeLabels(request.requiredCapabilities, 'task requiredCapabilities'),
    priority: request.priority,
    readScopes: normalizeTaskScopes(request.readScopes, 'readScopes'),
    writeScopes: normalizeWriteScopes(request.writeScopes),
    workspaceMode: request.workspaceMode,
    budget: jsonObjectSchema.parse(request.budget),
    reviewPolicy: structuredClone(request.reviewPolicy),
    maxAttempts: request.maxAttempts,
  }
}

/** Resolve an omitted Participant-task placement from the Team's creation-time product template. */
function resolveTaskPlacementDefault(
  projection: TeamProjection,
  creation: NormalizedTaskCreate,
  actorId: ParticipantId | undefined,
): NormalizedTaskCreate {
  if (creation.execution.kind !== 'participant' || creation.placement !== undefined) return creation
  const template = projection.rules.productTemplate
  if (template !== undefined && (typeof template !== 'object' || template === null || Array.isArray(template))) {
    throw new TeamError('Team product template is not a JSON object', 'TEAM_INVALID_ARGUMENT')
  }
  const rawPlacement = template === undefined ? undefined : (template as JsonObject).placement
  const grant = actorId === undefined
    ? projection.team.authorityGrant
    : projection.participants.get(actorId)?.authorityGrant ?? projection.team.authorityGrant
  if (rawPlacement === undefined) {
    return grant?.placement === undefined ? creation : { ...creation, placement: structuredClone(grant.placement) }
  }
  let placement: TeamTaskPlacement
  try {
    placement = teamTaskPlacementSchema.parse(rawPlacement)
  } catch (error: unknown) {
    throw new TeamError('Team product template placement defaults are invalid', 'TEAM_INVALID_ARGUMENT', { cause: error })
  }
  return { ...creation, placement: structuredClone(placement) }
}

function findTaskByCreateCommand(
  projection: TeamProjection,
  command: TeamTaskCreateCommand,
): TeamTaskSnapshot | undefined {
  return [...projection.tasks.values()].find(task => task.createCommand.idempotencyKey === command.idempotencyKey
    && sameTaskCreator(task.createCommand.creator, command.creator))
}

/** Find the durable task already compiled for one plan-local template. */
function findWorkflowTask(
  projection: TeamProjection,
  planId: TeamWorkflowPlanSnapshot['id'] | undefined,
  templateId: TeamWorkflowTaskTemplateId | undefined,
): TeamTaskSnapshot | undefined {
  if (planId === undefined || templateId === undefined) return undefined
  return [...projection.tasks.values()].find(task => task.workflowPlanId === planId && task.workflowTemplateId === templateId)
}

/** Find an already admitted workflow plan by its immutable retry identity. */
function findWorkflowPlanByKey(
  projection: TeamProjection,
  idempotencyKey: TeamWorkflowPlanSnapshot['idempotencyKey'],
): TeamWorkflowPlanSnapshot | undefined {
  return [...projection.workflowPlans.values()].find(plan => plan.idempotencyKey === idempotencyKey)
}

/** Compare a workflow-plan author across coordinator activation epochs. */
function sameWorkflowPlanActor(
  left: TeamWorkflowPlanSnapshot['actor'],
  right: TeamTaskCreator,
): boolean {
  if (left === undefined) return false
  return left.teamId === right.teamId
    && left.participantId === right.participantId
    && left.provider === right.provider
}

/** Keep plan bindings in the plan's source template order for deterministic replay. */
function sortWorkflowBindings(
  templates: readonly TeamWorkflowTaskTemplate[],
  bindings: readonly TeamWorkflowTaskBinding[],
): readonly TeamWorkflowTaskBinding[] {
  const order = new Map(templates.map((template, index) => [template.id, index]))
  return [...bindings].sort((left, right) => {
    const leftIndex = order.get(left.templateId) ?? Number.MAX_SAFE_INTEGER
    const rightIndex = order.get(right.templateId) ?? Number.MAX_SAFE_INTEGER
    return leftIndex === rightIndex ? 0 : leftIndex < rightIndex ? -1 : 1
  })
}

/** Compare a workflow channel open retry with its already durable manifest. */
function sameWorkflowChannelRequest(
  manifest: ChannelManifest,
  request: ChannelOpenInput,
): boolean {
  return manifest.teamId === request.teamId
    && manifest.workflowPlanId === request.workflowPlanId
    && manifest.adapter.type === request.adapter.type
    && manifest.adapter.version === request.adapter.version
    && isDeepStrictEqual(manifest.viewPolicy, request.viewPolicy)
    && isDeepStrictEqual(manifest.participants, request.participants)
    && isDeepStrictEqual(manifest.limits, request.limits)
}

/** Select the JSON-only descriptor whose exact value a topology invitation proof must retain. */
function participantInviteDescriptor(input: ParticipantInviteInput): Omit<ParticipantInviteInput, 'teamId' | 'expectedCursor'> {
  const { teamId: _teamId, expectedCursor: _expectedCursor, ...participant } = input
  return participant
}

/** Recognize the fixed worker-pool role namespace retained by TeamRun. */
function isWorkerRole(role: string): boolean {
  return role === 'worker' || /^worker-(?:[2-9]|[1-9][0-9]+)$/u.test(role)
}

/** Restrict source-owned membership transitions to the two legal topology advances. */
function isParticipantTopologyPhase(expected: ParticipantPhase, phase: ParticipantPhase): boolean {
  return (expected === 'invited' && phase === 'provisioning')
    || (expected === 'provisioning' && phase === 'active')
}

function sameTaskCreate(task: TeamTaskSnapshot, creation: NormalizedTaskCreate): boolean {
  return isDeepStrictEqual(taskCreateFields(task), creation)
}

function sameTaskCreator(left: TeamTaskCommandCreator, right: TeamTaskCommandCreator): boolean {
  return isDeepStrictEqual(left, right)
}

/** Compare durable task ownership across coordinator activation epochs. */
function sameStableTaskCreator(left: TeamTaskCommandCreator, right: TeamTaskCreator): boolean {
  if (!isActivationTaskCreator(left)) return false
  return left.teamId === right.teamId
    && left.participantId === right.participantId
    && left.sessionId === right.sessionId
    && left.provider === right.provider
}

/** Identify a task command whose durable creator is an activation binding. */
function isActivationTaskCreator(creator: TeamTaskCommandCreator): creator is TeamTaskCreator {
  return 'activationId' in creator
}

function taskCreateFields(task: TeamTaskSnapshot): NormalizedTaskCreate {
  return {
    execution: structuredClone(task.execution),
    placement: task.placement,
    parentTaskId: task.parentTaskId,
    workflowPlanId: task.workflowPlanId,
    workflowTemplateId: task.workflowTemplateId,
    integration: task.integration === undefined ? undefined : structuredClone(task.integration),
    subject: task.subject,
    description: task.description,
    blockedBy: task.blockedBy,
    requiredCapabilities: task.requiredCapabilities,
    priority: task.priority,
    readScopes: task.readScopes,
    writeScopes: task.writeScopes,
    workspaceMode: task.workspaceMode,
    budget: task.budget,
    reviewPolicy: task.reviewPolicy,
    maxAttempts: task.maxAttempts,
  }
}

/** Count retries already consumed by the Team before admitting another attempt. */
function teamRetryCount(tasks: ReadonlyMap<TeamTaskId, TeamTaskSnapshot>): number {
  let retries = 0
  for (const task of tasks.values()) {
    retries += Math.max(0, task.attemptCount - 1)
  }
  return retries
}

/** Derive a safe deadline for a lease whose duration was validated at the public boundary. */
function leaseExpiresAt(renewedAt: number, durationMs: number): number {
  if (durationMs > Number.MAX_SAFE_INTEGER - renewedAt) {
    throw new TeamError('task lease duration exceeds the representable timestamp range', 'TEAM_INVALID_ARGUMENT')
  }
  return renewedAt + durationMs
}

/** Normalize and de-duplicate immutable capability labels. */
function normalizeLabels(labels: readonly string[], field: string): readonly string[] {
  const normalized = labels.map(label => normalizedText(label, field))
  if (new Set(normalized).size !== normalized.length) {
    throw new TeamError(`${field} cannot contain duplicates`, 'TEAM_TASK_GRAPH_INVALID')
  }
  return normalized
}

/** Normalize and de-duplicate advisory workspace-relative task scopes. */
function normalizeTaskScopes(scopes: readonly string[], field: string): readonly string[] {
  const normalized = scopes.map(scope => normalizeTaskScope(scope, field))
  if (new Set(normalized).size !== normalized.length) {
    throw new TeamError(`task ${field} cannot contain duplicates`, 'TEAM_TASK_GRAPH_INVALID')
  }
  return normalized
}

/** Normalize and de-duplicate advisory workspace-relative write scopes. */
function normalizeWriteScopes(scopes: readonly string[]): readonly string[] {
  return normalizeTaskScopes(scopes, 'writeScopes')
}

/** Reject an absolute, parent-traversing, or blank write-scope declaration. */
function normalizeTaskScope(value: string, field: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '')
  const segments = normalized.split('/')
  if (normalized.length === 0 || normalized.startsWith('/') || /^[a-z]:/iu.test(normalized)
    || segments.some(segment => segment.length === 0 || segment === '..' || (segment === '.' && normalized !== '.'))) {
    throw new TeamError(`invalid workspace-relative ${field} ${JSON.stringify(value)}`, 'TEAM_INVALID_ARGUMENT')
  }
  return normalized
}

/** Reject a stale Team-journal cursor without attempting a silent merge. */
function assertCursor(current: number, expected: number, subject: string): void {
  if (current !== expected) {
    throw new TeamError(`${subject} cursor ${expected} is stale; current cursor is ${current}`, 'TEAM_CURSOR_CONFLICT')
  }
}

/** Reject a stale channel-WAL cursor without attempting a silent merge. */
function assertChannelCursor(current: number, expected: number): void {
  if (current !== expected) {
    throw new TeamError(`channel cursor ${expected} is stale; current cursor is ${current}`, 'TEAM_CHANNEL_CURSOR_CONFLICT')
  }
}

/** Ensure a configuration number is a positive safe integer. */
function positiveLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`team-hub: ${name} must be a positive safe integer`)
  }
  return value
}

/** Validate and detach provider/model rates before a Team can snapshot them. */
function resolveUsageRates(raw: Readonly<Record<string, TeamUsageRate>>): Readonly<Record<string, TeamUsageRate>> {
  const resolved: Record<string, TeamUsageRate> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key.length === 0 || key.trim() !== key) throw new Error('team-hub: usageRates keys must be non-empty without surrounding whitespace')
    resolved[key] = teamUsageRateSchema.parse(value)
  }
  return Object.freeze(resolved)
}

/** Ensure a configuration number is a non-negative safe integer. */
function nonNegativeLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`team-hub: ${name} must be a non-negative safe integer`)
  }
  return value
}

/** Preserve a recovered timestamp when the local wall clock moves backwards. */
function nextTeamTimestamp(projection: TeamProjection): number {
  return Math.max(Date.now(), projection.team.updatedAt)
}

/** Select a quiescence-batch timestamp that cannot equal a preceding Team command. */
function nextQuiescenceTimestamp(projection: TeamProjection): number {
  if (projection.team.updatedAt >= Number.MAX_SAFE_INTEGER) {
    throw new TeamHubError(`Team '${projection.team.id}' quiescence timestamp cannot advance`, 'TEAM_JOURNAL_MALFORMED')
  }
  return Math.max(Date.now(), projection.team.updatedAt + 1)
}

/** Recognize the storage provider's expected-tail conflict without importing its concrete class. */
function isSequenceConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { readonly code?: unknown }).code === 'sequence-conflict'
}

/** Recognize a storage read that intentionally starts before a compacted prefix. */
function isCompacted(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { readonly code?: unknown }).code === 'compacted'
}

function supportsFinal(adapter: TeamChannelAdapter): adapter is TeamChannelAdapter & Required<Pick<TeamChannelAdapter, 'prepareFinal'>> {
  return adapter.prepareFinal !== undefined
}

/** Count every recipient delivery still present in one folded channel projection. */
function pendingDeliveryCount(projection: ChannelProjection): number {
  return [...projection.pendingDeliveries.values()].reduce((count, deliveries) => count + deliveries.size, 0)
}

/** Refuse source compaction past the durable replay watermark. */
function assertReplayWatermark(projection: ChannelProjection, throughSequence: number, channelId: ChannelId): void {
  const watermark = channelReplayWatermark(projection)
  if (throughSequence > watermark) {
    throw new TeamError(
      `channel '${channelId}' compaction crosses replay watermark ${String(watermark)}`,
      'TEAM_CHANNEL_BACKPRESSURE',
    )
  }
}

/** Deep-freeze a detached response before it reaches a Hub caller. */
function freeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) freeze(child)
  return value
}

/** Bound a shutdown settlement without leaving a timer behind. */
async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_resolve, reject) => {
    // v8 ignore next 3 -- normal Hub disposal settles admitted work before its configured deadline.
    timer = setTimeout(() => {
      reject(new TeamError(`Team Hub disposal exceeded ${timeoutMs}ms`, 'TEAM_DISPOSED'))
    }, timeoutMs)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Render a contained diagnostic failure without allowing stringification to fail. */
function renderError(error: unknown): string {
  try {
    return String(error)
  } catch {
    // v8 ignore next -- thrown stringification is retained as a defensive diagnostic fallback.
    return '[unrenderable thrown value]'
  }
}

/** Exhaust a closed durable Team record union. */
/* v8 ignore next 3 -- reachable only from a statically closed-union default arm. */
function assertNever(value: never): never {
  throw new Error(`unhandled Team journal record ${JSON.stringify(value)}`)
}

export default TeamHub

/** A source is shared only with its sender and the recipients fixed at its original WAL position. */
function channelSummarySourcesAreShared(manifest: ChannelManifest, records: readonly ChannelEnvelopeRecord[]): boolean {
  return records.every(record => manifest.participants.every(member => member.id === record.envelope.senderId
    || record.deliveryIntents.some(delivery => delivery.participantId === member.id)))
}

/** Freeze the work selected by one revision-fenced cancellation admission. */
function taskCancellationTarget(task: TeamTaskSnapshot): TeamTaskCancellationSnapshot['target'] {
  if (task.execution.kind === 'child-team' && task.delegation !== undefined) return { kind: 'delegation', delegationId: task.delegation.id, childTeamId: task.delegation.childTeamId }
  if (task.lease !== undefined) {
    const lease = task.lease
    if (lease.activationId === undefined) {
      throw new TeamError(`Task '${task.id}' cancellation requires an exact activation owner`, 'TEAM_INVALID_ARGUMENT')
    }
    return { kind: 'attempt', attemptId: lease.attemptId, participantId: lease.participantId, activationId: lease.activationId }
  }
  if (task.phase === 'review' && task.reviewPolicy.kind === 'participant') {
    const attempt = task.attemptHistory.at(-1)
    if (attempt === undefined) throw new TeamError(`Task '${task.id}' has no review attempt`, 'TEAM_INVALID_ARGUMENT')
    return { kind: 'review', attemptId: attempt.id, reviewerId: task.reviewPolicy.reviewerId }
  }
  return { kind: 'pending' }
}

/** Reject new owner activity after a durable task cancellation selected its exact work. */
function assertTaskNotCancelling(task: TeamTaskSnapshot): void {
  if (task.cancellation !== undefined) {
    throw new TeamError(`Task '${task.id}' has an accepted cancellation request`, 'TEAM_INVALID_ARGUMENT')
  }
}
