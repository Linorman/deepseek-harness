import { teamMemberInspectRequestSchema, teamMemberInspectionSchema } from '@clocky/clocky-team/schema'
import type { TeamMemberInspectParams, TeamMemberInspectResult } from './types.ts'
import type { TeamSelectionParams } from './types.ts'
import { teamTaskInspectRequestSchema, teamTaskInspectionSchema } from '@clocky/clocky-team/schema'
import type { TeamTaskInspectParams, TeamTaskInspectResult } from './types.ts'
import { teamBrowsePageSchema } from '@clocky/clocky-team/schema'
import type { TeamBrowseParams, TeamBrowseResult } from './types.ts'
import { teamMemberSessionSnapshotSchema } from '@clocky/clocky-team/schema'
import type { TeamMemberSessionParams, TeamMemberSessionResult } from './types.ts'
import { teamListPageSchema, teamSelectionSnapshotSchema } from '@clocky/clocky-team/schema'
import { AttachmentId } from '@clocky/clocky-attachment'
/** Strict parsers for SDK activation frames at the JSON-RPC wire boundary. @module @clocky/clocky-sdk-protocol/schema */

import { z } from 'zod'
import type { ContentBlock } from '@clocky/clocky-llm'
import type {
  ActivationDisposeParams,
  ActivationDisposeResult,
  ActivationInterruptParams,
  ActivationInterruptResult,
  ActivationLinkEnrollParams,
  ActivationLinkEnrollResult,
  ActivationOpenParams,
  ActivationOpenResult,
  ActivationStatusNotification,
  ActivationStatusParams,
  ActivationStatusResult,
  SdkActivationInterruptCause,
  SdkActivationSeed,
  SdkActivationState,
  SdkActivationStatus,
  SdkActivationTarget,
  SdkTeamLinkBinding,
  SdkTeamLinkEnrollment,
  InitializeParams,
  InitializeResult,
  TeamCancelParams,
  TeamCancelResult,
  TeamArchiveParams,
  TeamArchiveResult,
  TeamCreateParams,
  TeamCreateResult,
  TeamResumeParams,
  TeamResumeResult,
  TeamWaitFinalParams,
  TeamWaitFinalResult,
  TeamListParams,
  TeamListResult,
  TeamGetParams,
  TeamGetResult,
  TeamSelectionResult,
  TeamGoalUpdateParams,
  TeamGoalUpdateResult,
  TeamGoalTransitionParams,
  TeamGoalTransitionResult,
  TeamQuiescenceParams,
  TeamQuiescenceResult,
  TeamMetricsParams,
  TeamMetricsResult,
  TeamAuditReadParams,
  TeamAuditReadResult,
  TeamArtifactReadParams,
  TeamArtifactReadResult,
  TeamArtifactListParams,
  TeamArtifactListResult,
  TeamMemberListParams,
  TeamMemberListResult,
  TeamMemberInviteParams,
  TeamMemberInviteResult,
  TeamMemberActivateParams,
  TeamMemberActivateResult,
  TeamMemberRemoveParams,
  TeamMemberRemoveResult,
  TeamMemberInterruptParams,
  TeamMemberInterruptResult,
  TeamChannelOpenParams,
  TeamChannelInvitationParams,
  TeamChannelCatalogParams,
  TeamChannelCatalogResult,
  TeamChannelSummarizeParams,
  TeamChannelSummarizeResult,
  TeamChannelListParams,
  TeamChannelListResult,
  TeamChannelAdmissionParams,
  TeamChannelAdmissionResult,
  TeamChannelInvitationAcknowledgeParams,
  TeamChannelInvitationResult,
  TeamChannelOpenResult,
  TeamChannelInputParams,
  TeamChannelAttachmentParams,
  TeamChannelAttachmentResult,
  TeamChannelPostParams,
  TeamChannelPostResult,
  TeamChannelReadParams,
  TeamChannelReadResult,
  TeamChannelCloseParams,
  TeamChannelCloseResult,
  TeamChannelWatchParams,
  TeamChannelWatchResult,
  TeamTaskCreateParams,
  TeamTaskCreateResult,
  TeamTaskGetParams,
  TeamTaskGetResult,
  TeamTaskListParams,
  TeamTaskListResult,
  TeamWorkflowPlanListParams,
  TeamWorkflowPlanListResult,
  TeamTaskUpdateParams,
  TeamTaskUpdateResult,
  TeamTaskCancelParams,
  TeamTaskCancelResult,
  TeamTaskDeleteParams,
  TeamTaskDeleteResult,
  TeamTaskReviewParams,
  TeamTaskReviewResult,
  TeamTaskWatchParams,
  TeamTaskWatchResult,
} from './types.ts'
import {
  channelIdSchema,
  channelParticipantSchema,
  channelReadPageResultSchema,
  channelSnapshotSchema,
  channelGetRequestSchema,
  channelInvitationAcknowledgeInputSchema,
  channelHumanInvitationSnapshotSchema,
  channelHumanAdmissionSnapshotSchema,
  teamChannelCatalogSchema,
  channelSummarySelectionInputSchema,
  channelSummaryRecordSchema,
  teamChannelListInputSchema,
  teamChannelListPageSchema,
  channelWatchResultSchema,
  channelPostIdempotencyKeySchema,
  envelopeDeliverySchema,
  envelopeIdSchema,
  envelopePrioritySchema,
  jsonObjectSchema,
  participantIdSchema,
  participantInterruptSnapshotSchema,
  participantSnapshotSchema,
  teamAdapterRefSchema,
  teamAuditReadResultSchema as coreTeamAuditReadResultSchema,
  teamArtifactReferenceSchema,
  teamEnvelopeSchema,
  teamGoalPhaseTransitionInputSchema,
  teamGoalUpdateInputSchema,
  teamIdSchema,
  teamQuiescenceSnapshotSchema,
  teamMetricsSnapshotSchema,
  teamPhaseSchema,
  teamStateSnapshotSchema,
  teamTaskCreateIdempotencyKeySchema,
  teamTaskDetailsUpdateInputSchema,
  teamTaskIdSchema,
  teamTaskIntegrationSpecSchema,
  teamTaskReviewPolicySchema,
  teamTaskSnapshotSchema,
  teamWorkflowPlanSnapshotSchema,
  teamTaskWorkspaceModeSchema,
  teamWatchResultSchema,
  teamViewPolicyRefSchema,
} from '@clocky/clocky-team/schema'

const nonEmptyStringSchema = z.string().min(1)
const nonNegativeSafeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const positiveSafeIntegerSchema = nonNegativeSafeIntegerSchema.min(1)

/** Parse a durable Team summary listing request. */
export const teamListParamsSchema = z.object({
  afterCursor: z.union([z.literal(-1), nonEmptyStringSchema]).optional(),
  limit: positiveSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<TeamListParams>

/** Parse a durable Team summary listing result. */
export const teamListResultSchema = teamListPageSchema satisfies z.ZodType<TeamListResult>

/** Parse one complete Team state request. */
export const teamSelectionParamsSchema = z.object({ teamId: nonEmptyStringSchema, includeMetadata: z.boolean().optional() })
  .strict() satisfies z.ZodType<TeamSelectionParams>

/** Complete Team projection request. */
export const teamGetParamsSchema = z.object({ teamId: nonEmptyStringSchema }).strict() satisfies z.ZodType<TeamGetParams>

/** Parse one complete Team state result. */
export const teamGetResultSchema = z.object({ state: teamStateSnapshotSchema }).strict() satisfies z.ZodType<TeamGetResult>

/** Exact wire identities for member Session inspection. */
export const teamMemberSessionParamsSchema = z.object({ teamId: nonEmptyStringSchema, participantId: nonEmptyStringSchema })
  .strict() satisfies z.ZodType<TeamMemberSessionParams>
/** Published member binding without supervision configuration or history. */
export const teamMemberSessionResultSchema = z.object({ binding: teamMemberSessionSnapshotSchema })
  .strict() satisfies z.ZodType<TeamMemberSessionResult>

/** Actor-free task section, with optional revision-pinned history pagination. */
export const teamTaskInspectParamsSchema = teamTaskInspectRequestSchema satisfies z.ZodType<TeamTaskInspectParams>
/** Strict wrapper around the bounded task inspection. */
export const teamTaskInspectResultSchema = z.object({ inspection: teamTaskInspectionSchema })
  .strict() satisfies z.ZodType<TeamTaskInspectResult>

/** Parse a collection summary request. */
export const teamBrowseParamsSchema = z.object({ teamId: nonEmptyStringSchema, kind: z.enum(['tasks', 'members', 'workflowPlans']),
  afterCursor: z.number().int().min(-1).optional(), limit: z.number().int().positive().optional(),
}).strict() satisfies z.ZodType<TeamBrowseParams>
/** Summary response with exact collection and Team ownership. */
export const teamBrowseResultSchema = z.object({ page: teamBrowsePageSchema }).strict() satisfies z.ZodType<TeamBrowseResult>

/** Bounded selection data with explicit coordinator availability. */
export const teamSelectionResultSchema = z.object({ selection: teamSelectionSnapshotSchema })
  .strict() satisfies z.ZodType<TeamSelectionResult>


/** Parse an actor-free Team objective definition update. */
export const teamGoalUpdateParamsSchema = teamGoalUpdateInputSchema as unknown as z.ZodType<TeamGoalUpdateParams>
/** Parse the state returned after a Team objective definition update. */
export const teamGoalUpdateResultSchema = (
  z.object({ state: teamStateSnapshotSchema }).strict()
) satisfies z.ZodType<TeamGoalUpdateResult>
/** Parse an actor-free Team objective lifecycle transition. */
export const teamGoalTransitionParamsSchema = teamGoalPhaseTransitionInputSchema as unknown as z.ZodType<TeamGoalTransitionParams>
/** Parse the state returned after a Team objective lifecycle transition. */
export const teamGoalTransitionResultSchema = (
  z.object({ state: teamStateSnapshotSchema }).strict()
) satisfies z.ZodType<TeamGoalTransitionResult>

/** Parse durable quiescence diagnostics. */
export const teamQuiescenceParamsSchema = (
  z.object({ teamId: teamIdSchema }).strict()
) as unknown as z.ZodType<TeamQuiescenceParams>
/** Wire schema for teamQuiescenceResultSchema. */
export const teamQuiescenceResultSchema = (
  z.object({ value: teamQuiescenceSnapshotSchema }).strict()
) as unknown as z.ZodType<TeamQuiescenceResult>
/** Parse the process-local Team metrics request and snapshot. */
export const teamMetricsParamsSchema = z.object({}).strict() satisfies z.ZodType<TeamMetricsParams>
/** Wire schema for teamMetricsResultSchema. */
export const teamMetricsResultSchema = teamMetricsSnapshotSchema as unknown as z.ZodType<TeamMetricsResult>

/** Parse a bounded Team or channel audit page. */
export const teamAuditReadParamsSchema = z.object({
  teamId: teamIdSchema,
  channelId: channelIdSchema.optional(),
  afterCursor: z.number().int().min(-1).optional(),
  limit: positiveSafeIntegerSchema.optional(),
}).strict() as unknown as z.ZodType<TeamAuditReadParams>
/** Wire schema for teamAuditReadResultSchema. */
export const teamAuditReadResultSchema = coreTeamAuditReadResultSchema as z.ZodType<TeamAuditReadResult>
/** Parse one visible Team artifact read request. */
export const teamArtifactReadParamsSchema = z.object({
  teamId: teamIdSchema,
  artifactId: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<TeamArtifactReadParams>
/** Parse verified Team artifact bytes returned by the runtime. */
export const teamArtifactReadResultSchema = z.object({
  artifact: teamArtifactReferenceSchema,
  bytes: nonNegativeSafeIntegerSchema,
  data: z.string(),
}).strict() satisfies z.ZodType<TeamArtifactReadResult>
/** Parse a bounded visible artifact-list request. */
export const teamArtifactListParamsSchema = z.object({
  teamId: teamIdSchema,
  afterCursor: z.number().int().min(-1).optional(),
  limit: positiveSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<TeamArtifactListParams>
/** Parse a bounded visible artifact-list result. */
export const teamArtifactListResultSchema = z.object({
  items: z.array(teamArtifactReferenceSchema),
  nextCursor: nonNegativeSafeIntegerSchema.optional(),
}).strict() as unknown as z.ZodType<TeamArtifactListResult>

/** Parse a Team participant-list request. */
export const teamMemberListParamsSchema = z.object({
  teamId: teamIdSchema,
  afterCursor: z.number().int().min(-1).optional(),
  limit: positiveSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<TeamMemberListParams>
/** Parse a Team participant-list result. */
export const teamMemberListResultSchema = z.object({
  items: z.array(participantSnapshotSchema),
  nextCursor: nonNegativeSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<TeamMemberListResult>
/** Parse participant management requests and results. */
export const teamMemberInviteParamsSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  kind: z.enum(['local-agent', 'remote-agent', 'service'] as const),
  displayName: nonEmptyStringSchema,
  role: nonEmptyStringSchema,
  capabilities: z.array(nonEmptyStringSchema),
  provider: nonEmptyStringSchema.optional(),
  preset: nonEmptyStringSchema.optional(),
  model: nonEmptyStringSchema.optional(),
  authScheme: nonEmptyStringSchema.optional(),
}).strict() as unknown as z.ZodType<TeamMemberInviteParams>
/** Wire schema for teamMemberInviteResultSchema. */
export const teamMemberInviteResultSchema = (
  z.object({ value: participantSnapshotSchema }).strict()
) as unknown as z.ZodType<TeamMemberInviteResult>
/** Wire schema for teamMemberActivateParamsSchema. */
export const teamMemberActivateParamsSchema = z.object({
  teamId: teamIdSchema,
  participantId: participantIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamMemberActivateParams>
/** Wire schema for teamMemberActivateResultSchema. */
export const teamMemberActivateResultSchema = (
  z.object({ value: participantSnapshotSchema }).strict()
) as unknown as z.ZodType<TeamMemberActivateResult>
/** Wire schema for teamMemberRemoveParamsSchema. */
export const teamMemberRemoveParamsSchema = teamMemberActivateParamsSchema as z.ZodType<TeamMemberRemoveParams>
/** Wire schema for teamMemberRemoveResultSchema. */
export const teamMemberRemoveResultSchema = teamMemberActivateResultSchema as z.ZodType<TeamMemberRemoveResult>
/** Wire schema for teamMemberInterruptParamsSchema. */
export const teamMemberInterruptParamsSchema = teamMemberActivateParamsSchema as z.ZodType<TeamMemberInterruptParams>
/** Wire schema for the durable participant interrupt result. */
export const teamMemberInterruptResultSchema = (
  z.object({ value: participantInterruptSnapshotSchema }).strict()
) as unknown as z.ZodType<TeamMemberInterruptResult>
/** Parse a channel read request. */
export const teamChannelReadParamsSchema = z.object({
  channelId: channelIdSchema,
  afterCursor: z.number().int().min(-1).optional(),
  limit: positiveSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<TeamChannelReadParams>
/** Parse a channel read result. */
export const teamChannelReadResultSchema = (
  z.object({ value: channelReadPageResultSchema }).strict()
) satisfies z.ZodType<TeamChannelReadResult>
/** Strict actor-free channel list request; defaults remain provider-owned. */
export const teamChannelListParamsSchema = teamChannelListInputSchema satisfies z.ZodType<TeamChannelListParams>
/** Channel page preserving the provider's insertion-index continuation. */
export const teamChannelListResultSchema = teamChannelListPageSchema satisfies z.ZodType<TeamChannelListResult>

/** Authenticated protocol discovery input. */
export const teamChannelCatalogParamsSchema = z.object({}).strict() satisfies z.ZodType<TeamChannelCatalogParams>
/** Accepting registrations and optional extractive summary bounds. */
export const teamChannelCatalogResultSchema = teamChannelCatalogSchema satisfies z.ZodType<TeamChannelCatalogResult>
/** Explicit summary selection with a stable retry identity. */
export const teamChannelSummarizeParamsSchema = channelSummarySelectionInputSchema satisfies z.ZodType<TeamChannelSummarizeParams>
/** Validated durable summary result. */
export const teamChannelSummarizeResultSchema = (
  z.object({ value: channelSummaryRecordSchema }).strict()
) satisfies z.ZodType<TeamChannelSummarizeResult>

/** Actor-free membership-scoped channel admission selection. */
export const teamChannelAdmissionParamsSchema = (
  z.object({ teamId: teamIdSchema, channelId: channelIdSchema }).strict()
) as z.ZodType<TeamChannelAdmissionParams>
/** Durable channel admission metadata returned without consent or dispatch. */
export const teamChannelAdmissionResultSchema = (
  z.object({ value: channelHumanAdmissionSnapshotSchema }).strict()
) satisfies z.ZodType<TeamChannelAdmissionResult>

/** Authenticated human invitation discovery input. */
export const teamChannelInvitationParamsSchema = channelGetRequestSchema as unknown as z.ZodType<TeamChannelInvitationParams>
/** Exact invitation acceptance input; actor and principal fields are forbidden. */
export const teamChannelInvitationAcknowledgeParamsSchema = channelInvitationAcknowledgeInputSchema as unknown as
  z.ZodType<TeamChannelInvitationAcknowledgeParams>
/** Authenticated human invitation result. */
export const teamChannelInvitationResultSchema = z.object({ value: channelHumanInvitationSnapshotSchema }).strict() as unknown as
  z.ZodType<TeamChannelInvitationResult>

/** Wire schema for teamChannelOpenParamsSchema. */
export const teamChannelOpenParamsSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  adapter: teamAdapterRefSchema,
  viewPolicy: teamViewPolicyRefSchema.optional(),
  participants: z.array(channelParticipantSchema),
  limits: jsonObjectSchema,
}).strict() as unknown as z.ZodType<TeamChannelOpenParams>
/** Wire schema for teamChannelOpenResultSchema. */
export const teamChannelOpenResultSchema = (
  z.object({ value: channelSnapshotSchema }).strict()
) as unknown as z.ZodType<TeamChannelOpenResult>
/** Common channel post fields shared by durable drafts and encoded input. */
const channelPostInputSchema = z.object({
  channelId: channelIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  audience: z.array(participantIdSchema).nullable(),
  kind: nonEmptyStringSchema,
  payload: jsonObjectSchema,
  delivery: envelopeDeliverySchema,
  priority: envelopePrioritySchema.optional(),
  idempotencyKey: channelPostIdempotencyKeySchema.optional(),
  causationId: envelopeIdSchema.optional(),
  correlationId: nonEmptyStringSchema.optional(),
  taskId: teamTaskIdSchema.optional(),
  traceId: nonEmptyStringSchema.optional(),
  ttlMs: positiveSafeIntegerSchema.optional(),
}).strict()
/** Strict ordinary durable channel draft. */
export const teamChannelPostParamsSchema = channelPostInputSchema as unknown as z.ZodType<TeamChannelPostParams>
const channelImageMediaTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
/** Strict ordered upload content; bytes are verified by AttachmentStore admission. */
export const teamChannelInputParamsSchema = channelPostInputSchema.omit({ kind: true, payload: true }).extend({
  content: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: nonEmptyStringSchema }).strict(),
    z.object({ type: z.literal('image'), mediaType: channelImageMediaTypeSchema, data: nonEmptyStringSchema, name: z.string().optional() }).strict(),
  ])).min(1),
}).strict() as unknown as z.ZodType<TeamChannelInputParams>
/** Strict reference selection; no arbitrary store read is exposed. */
export const teamChannelAttachmentParamsSchema = z.object({ teamId: teamIdSchema, channelId: channelIdSchema,
  envelopeId: envelopeIdSchema, envelopeSequence: nonNegativeSafeIntegerSchema, attachmentId: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<TeamChannelAttachmentParams>
/** Verified image reference and encoded bytes returned by the attachment provider. */
export const teamChannelAttachmentResultSchema = z.object({ attachment: z.object({
  attachmentId: nonEmptyStringSchema.transform(AttachmentId), mediaType: channelImageMediaTypeSchema,
  bytes: positiveSafeIntegerSchema, width: positiveSafeIntegerSchema, height: positiveSafeIntegerSchema, name: z.string().optional(),
  originalDimensions: z.object({ width: positiveSafeIntegerSchema, height: positiveSafeIntegerSchema }).strict().optional(),
}).strict(), data: nonEmptyStringSchema }).strict() as z.ZodType<TeamChannelAttachmentResult>

/** Wire schema for teamChannelPostResultSchema. */
export const teamChannelPostResultSchema = z.object({ value: teamEnvelopeSchema }).strict() satisfies z.ZodType<TeamChannelPostResult>
/** Wire schema for teamChannelCloseParamsSchema. */
export const teamChannelCloseParamsSchema = z.object({
  channelId: channelIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  reason: nonEmptyStringSchema.optional(),
}).strict() as unknown as z.ZodType<TeamChannelCloseParams>
/** Wire schema for teamChannelCloseResultSchema. */
export const teamChannelCloseResultSchema = (
  z.object({ value: channelSnapshotSchema }).strict()
) as unknown as z.ZodType<TeamChannelCloseResult>
/** Wire schema for teamChannelWatchParamsSchema. */
export const teamChannelWatchParamsSchema = z.object({
  channelId: channelIdSchema,
  afterCursor: z.number().int().min(-1).optional(),
}).strict() satisfies z.ZodType<TeamChannelWatchParams>
/** Wire schema for teamChannelWatchResultSchema. */
export const teamChannelWatchResultSchema = (
  z.object({ value: channelWatchResultSchema }).strict()
) as unknown as z.ZodType<TeamChannelWatchResult>
/** Parse a Team task-list request. */
export const teamTaskListParamsSchema = z.object({
  teamId: teamIdSchema,
  afterCursor: z.number().int().min(-1).optional(),
  limit: positiveSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<TeamTaskListParams>
/** Parse a Team task-list result. */
export const teamTaskListResultSchema = z.object({
  items: z.array(teamTaskSnapshotSchema),
  nextCursor: nonNegativeSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<TeamTaskListResult>
/** Parse a bounded workflow-plan listing request. */
export const teamWorkflowPlanListParamsSchema = z.object({
  teamId: teamIdSchema,
  afterCursor: z.number().int().min(-1).optional(),
  limit: positiveSafeIntegerSchema.optional(),
}).strict() satisfies z.ZodType<TeamWorkflowPlanListParams>
/** Parse a bounded workflow-plan listing result. */
export const teamWorkflowPlanListResultSchema = z.object({
  items: z.array(teamWorkflowPlanSnapshotSchema),
  nextCursor: nonNegativeSafeIntegerSchema.optional(),
}).strict() as unknown as z.ZodType<TeamWorkflowPlanListResult>
/** Parse Team task mutation and watch operations. */
export const teamTaskCreateParamsSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
  idempotencyKey: teamTaskCreateIdempotencyKeySchema,
  parentTaskId: teamTaskIdSchema.optional(),
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
}).strict() as unknown as z.ZodType<TeamTaskCreateParams>
/** Wire schema for teamTaskCreateResultSchema. */
export const teamTaskCreateResultSchema = (
  z.object({ value: teamTaskSnapshotSchema }).strict()
) as unknown as z.ZodType<TeamTaskCreateResult>
/** Wire schema for teamTaskGetParamsSchema. */
export const teamTaskGetParamsSchema = (
  z.object({ teamId: teamIdSchema, taskId: teamTaskIdSchema }).strict()
) as unknown as z.ZodType<TeamTaskGetParams>
/** Wire schema for teamTaskGetResultSchema. */
export const teamTaskGetResultSchema = (
  z.object({ value: teamTaskSnapshotSchema }).strict()
) as unknown as z.ZodType<TeamTaskGetResult>
/** Wire schema for teamTaskUpdateParamsSchema. */
export const teamTaskUpdateParamsSchema = teamTaskDetailsUpdateInputSchema as unknown as z.ZodType<TeamTaskUpdateParams>
/** Wire schema for teamTaskUpdateResultSchema. */
export const teamTaskUpdateResultSchema = (
  z.object({ value: teamTaskSnapshotSchema }).strict()
) as unknown as z.ZodType<TeamTaskUpdateResult>
/** Wire schema for teamTaskCancelParamsSchema. */
export const teamTaskCancelParamsSchema = z.object({
  teamId: teamIdSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  reason: z.string().min(1).optional(),
}).strict() as z.ZodType<TeamTaskCancelParams>
/** Wire schema for teamTaskCancelResultSchema. */
export const teamTaskCancelResultSchema = (
  z.object({ value: teamTaskSnapshotSchema }).strict()
) as unknown as z.ZodType<TeamTaskCancelResult>
/** Wire schema for teamTaskDeleteParamsSchema. */
export const teamTaskDeleteParamsSchema = z.object({
  teamId: teamIdSchema, taskId: teamTaskIdSchema, expectedRevision: positiveSafeIntegerSchema,
}).strict() as z.ZodType<TeamTaskDeleteParams>
/** Wire schema for teamTaskDeleteResultSchema. */
export const teamTaskDeleteResultSchema = (
  z.object({ value: teamTaskSnapshotSchema }).strict()
) as unknown as z.ZodType<TeamTaskDeleteResult>
/** Wire schema for teamTaskReviewParamsSchema. */
export const teamTaskReviewParamsSchema = z.object({
  teamId: teamIdSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: positiveSafeIntegerSchema,
  decision: z.enum(['accepted', 'rework'] as const),
  reason: nonEmptyStringSchema,
}).strict() as z.ZodType<TeamTaskReviewParams>
/** Wire schema for teamTaskReviewResultSchema. */
export const teamTaskReviewResultSchema = (
  z.object({ value: teamTaskSnapshotSchema }).strict()
) as unknown as z.ZodType<TeamTaskReviewResult>
/** Wire schema for teamTaskWatchParamsSchema. */
export const teamTaskWatchParamsSchema = z.object({
  teamId: teamIdSchema,
  afterCursor: z.number().int().min(-1).optional(),
}).strict() as unknown as z.ZodType<TeamTaskWatchParams>
/** Wire schema for teamTaskWatchResultSchema. */
export const teamTaskWatchResultSchema = (
  z.object({ value: teamWatchResultSchema }).strict()
) as unknown as z.ZodType<TeamTaskWatchResult>

/** Parse the process-level SDK bootstrap route. */
export const initializeParamsSchema = z.object({
  credential: nonEmptyStringSchema,
  cwd: nonEmptyStringSchema,
  provider: nonEmptyStringSchema,
  model: nonEmptyStringSchema,
  maxTokens: positiveSafeIntegerSchema.optional(),
}).strict().transform((value): InitializeParams => ({
  credential: value.credential,
  cwd: value.cwd,
  provider: value.provider,
  model: value.model,
  ...value.maxTokens === undefined ? {} : { maxTokens: value.maxTokens },
})) satisfies z.ZodType<InitializeParams>

/** Parse the stable server identity returned by a successful bootstrap. */
export const initializeResultSchema = z.object({
  serverInfo: z.object({
    name: nonEmptyStringSchema,
    version: nonEmptyStringSchema,
  }).strict(),
}).strict() satisfies z.ZodType<InitializeResult>

/**
 * Validate the merge-extensible ContentBlock envelope at the wire boundary.
 * A deployment-specific block type retains its own fields, while every block
 * must name a non-empty type before it can reach model-facing message code.
 */
const contentBlockSchema = z.looseObject({ type: nonEmptyStringSchema }) as unknown as z.ZodType<ContentBlock>

/** Parse default-Team creation and its initial direct-channel content. */
export const teamCreateParamsSchema = z.object({
  objective: nonEmptyStringSchema,
  contentBlocks: z.array(contentBlockSchema).min(1),
}).strict() satisfies z.ZodType<TeamCreateParams>

/** Parse one Team creation and initial-Envelope receipt. */
export const teamCreateResultSchema = z.object({
  teamId: nonEmptyStringSchema,
  coordinatorSessionId: nonEmptyStringSchema,
  envelopeId: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<TeamCreateResult>

/** Parse a durable Team resume request. */
export const teamResumeParamsSchema = z.object({
  teamId: nonEmptyStringSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamResumeParams>

/** Parse a durable Team resume result. */
export const teamResumeResultSchema = z.object({
  teamId: nonEmptyStringSchema,
  coordinatorSessionId: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<TeamResumeResult>

/** Parse a Team final-result wait request. */
export const teamWaitFinalParamsSchema = z.object({
  teamId: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<TeamWaitFinalParams>

/** Parse one settled explicit final result. */
export const teamWaitFinalResultSchema = z.object({
  teamId: nonEmptyStringSchema,
  channelId: nonEmptyStringSchema,
  envelopeId: nonEmptyStringSchema,
  text: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<TeamWaitFinalResult>

/** Parse a Team cancellation request. */
export const teamCancelParamsSchema = z.object({
  teamId: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<TeamCancelParams>

/** Parse the terminal Team cancellation result. */
export const teamCancelResultSchema = z.object({ phase: teamPhaseSchema }).strict() satisfies z.ZodType<TeamCancelResult>

/** Parse a Team archive request. */
export const teamArchiveParamsSchema = z.object({
  teamId: nonEmptyStringSchema,
  expectedCursor: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamArchiveParams>

/** Parse a durable Team archive confirmation. */
export const teamArchiveResultSchema = z.object({
  teamId: nonEmptyStringSchema,
  archivedAt: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<TeamArchiveResult>

/** Parse the no-parameter shutdown request after transport normalization. */
export const shutdownParamsSchema = z.object({}).strict()

/** Parse the exact identifiers selecting one activation epoch. */
export const sdkActivationTargetSchema = z.object({
  activationId: nonEmptyStringSchema,
  teamId: nonEmptyStringSchema,
  participantId: nonEmptyStringSchema,
  sessionId: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<SdkActivationTarget>

/** Parse a fresh or persisted-resume activation seed. */
export const sdkActivationSeedSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fresh') }).strict(),
  z.object({ kind: z.literal('resume') }).strict(),
]) satisfies z.ZodType<SdkActivationSeed>

/** Parse the closed remote activation residency statuses. */
export const sdkActivationStatusSchema = z.enum([
  'starting', 'running', 'idle', 'stopping', 'offline',
] as const) satisfies z.ZodType<SdkActivationStatus>

/** Parse a complete ordered remote activation state. */
export const sdkActivationStateSchema = z.object({
  ...sdkActivationTargetSchema.shape,
  status: sdkActivationStatusSchema,
  statusSequence: nonNegativeSafeIntegerSchema,
}).strict() satisfies z.ZodType<SdkActivationState>

/** Parse one remote activation open request. */
export const activationOpenParamsSchema = z.object({
  target: sdkActivationTargetSchema,
  seed: sdkActivationSeedSchema,
}).strict() satisfies z.ZodType<ActivationOpenParams>

/** Parse a successful remote activation open response. */
export const activationOpenResultSchema = z.object({
  state: sdkActivationStateSchema,
}).strict() satisfies z.ZodType<ActivationOpenResult>

/** Parse one immutable remote Team Link binding. */
export const sdkTeamLinkBindingSchema = z.object({
  ...sdkActivationTargetSchema.shape,
  provider: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<SdkTeamLinkBinding>

/** Parse one opaque remote Link credential without relaxing the SDK wire boundary. */
export const sdkTeamLinkEnrollmentSchema = z.object({
  provider: nonEmptyStringSchema,
  endpoint: nonEmptyStringSchema,
  capability: nonEmptyStringSchema,
}).strict() satisfies z.ZodType<SdkTeamLinkEnrollment>

/** Parse post-bind remote Link enrollment for one existing activation. */
export const activationLinkEnrollParamsSchema = z.object({
  target: sdkActivationTargetSchema,
  binding: sdkTeamLinkBindingSchema,
  enrollment: sdkTeamLinkEnrollmentSchema,
}).strict() satisfies z.ZodType<ActivationLinkEnrollParams>

/** Parse the empty post-bind Link enrollment acknowledgement. */
export const activationLinkEnrollResultSchema = z.object({}).strict() satisfies z.ZodType<ActivationLinkEnrollResult>

/** Parse one remote activation state-read request. */
export const activationStatusParamsSchema = z.object({
  target: sdkActivationTargetSchema,
}).strict() satisfies z.ZodType<ActivationStatusParams>

/** Parse a remote activation state-read response. */
export const activationStatusResultSchema = z.object({
  state: sdkActivationStateSchema,
}).strict() satisfies z.ZodType<ActivationStatusResult>

/** Parse a caller-supplied remote Agent cancellation cause. */
export const sdkActivationInterruptCauseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user') }).strict(),
  z.object({ kind: z.literal('parent') }).strict(),
  z.object({ kind: z.literal('hook'), reason: nonEmptyStringSchema }).strict(),
  z.object({ kind: z.literal('disposed') }).strict(),
]) satisfies z.ZodType<SdkActivationInterruptCause>

/** Parse one remote activation interruption request. */
export const activationInterruptParamsSchema = z.object({
  target: sdkActivationTargetSchema,
  cause: sdkActivationInterruptCauseSchema,
}).strict() satisfies z.ZodType<ActivationInterruptParams>

/** Parse the empty interruption acknowledgement. */
export const activationInterruptResultSchema = z.object({}).strict() satisfies z.ZodType<ActivationInterruptResult>

/** Parse one remote activation disposal request. */
export const activationDisposeParamsSchema = z.object({
  target: sdkActivationTargetSchema,
}).strict() satisfies z.ZodType<ActivationDisposeParams>

/** Parse the terminal remote activation disposal response. */
export const activationDisposeResultSchema = z.object({
  state: sdkActivationStateSchema,
}).strict() satisfies z.ZodType<ActivationDisposeResult>

/** Parse one remote activation lifecycle notification. */
export const activationStatusNotificationSchema = z.object({
  state: sdkActivationStateSchema,
}).strict() satisfies z.ZodType<ActivationStatusNotification>

/** Validate member inspection identities and capability continuation. */
export const teamMemberInspectParamsSchema = teamMemberInspectRequestSchema satisfies z.ZodType<TeamMemberInspectParams>
/** Validate exact scalar metadata and a bounded capability window. */
export const teamMemberInspectResultSchema = z.object({ detail: teamMemberInspectionSchema })
  .strict() satisfies z.ZodType<TeamMemberInspectResult>
