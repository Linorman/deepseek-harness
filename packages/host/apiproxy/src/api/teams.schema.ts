import { teamHumanInboxPageSchema as coreHumanInboxPageSchema, teamHumanActionResponseResultSchema as coreHumanActionResponseResultSchema } from '@clocky/clocky-team/schema'
export { teamHumanActionResponseInputSchema } from '@clocky/clocky-team/schema'
export { teamHumanInboxReadInputSchema, teamHumanInboxAcknowledgeInputSchema, teamHumanInboxAcknowledgementSchema } from '@clocky/clocky-team/schema'
/** Zod schemas for the browser-safe Team product domain. */

import { z } from 'zod'
import {
  channelParticipantSchema,
  teamChannelCatalogSchema,
  channelHumanAdmissionSnapshotSchema,
  teamChannelListInputSchema,
  teamChannelListPageSchema,
  channelGetRequestSchema,
  channelInvitationAcknowledgeInputSchema,
  channelHumanInvitationSnapshotSchema,
  channelIdSchema,
  channelReadPageResultSchema,
  channelSnapshotSchema,
  channelSummarySelectionInputSchema,
  channelSummaryRecordSchema,
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
  teamArtifactReferenceSchema,
  teamAuditReadResultSchema,
  teamEnvelopeSchema,
  teamIdSchema,
  teamTaskDetailsUpdateInputSchema as coreTeamTaskDetailsUpdateInputSchema,
  teamTaskCancelInputSchema as coreTeamTaskCancelInputSchema,
  teamGoalPhaseTransitionInputSchema as coreTeamGoalPhaseTransitionInputSchema,
  teamGoalUpdateInputSchema as coreTeamGoalUpdateInputSchema,
  teamTaskCreateIdempotencyKeySchema,
  teamTaskExecutionSchema,
  teamTaskPlacementSchema,
  teamTaskDeleteInputSchema as coreTeamTaskDeleteInputSchema,
  teamTaskGetRequestSchema as coreTeamTaskGetRequestSchema,
  teamTaskIdSchema,
  teamTaskIntegrationSpecSchema,
  teamTaskListPageSchema as coreTeamTaskListPageSchema,
  teamTaskReviewPolicySchema,
  teamViewPolicyRefSchema,
  teamTaskSnapshotSchema,
  teamTaskWorkspaceModeSchema,
  teamWatchResultSchema,
  teamListPageSchema as coreTeamListPageSchema,
  teamMemberListPageSchema as coreTeamMemberListPageSchema,
  teamStateSnapshotSchema,
  teamQuiescenceSnapshotSchema,
  teamMetricsSnapshotSchema,
  teamPhaseSchema,
  teamWorkflowPlanSnapshotSchema,
} from '@clocky/clocky-team/schema'
import { modelSelectionSchema, promptContentPartSchema, imageMediaTypeSchema, attachmentIdSchema, imageAttachmentRefSchema } from './sessions.schema.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { TeamArtifactList, TeamArtifactReadResult, TeamAuditList, TeamFinal, TeamInputReceipt, TeamWorkflowPlanList } from './teams.ts'

/** team.list request payload. */
export const teamListRequestSchema = z.object({
  afterCursor: z.number().int().min(-1).optional(),
  limit: z.number().int().positive().optional(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.list'>>>

/** team.list response value. */
export const teamListValueSchema = coreTeamListPageSchema as unknown as z.ZodType<Wire<ResponseValue<'team.list'>>>

/** team.get request payload. */
export const teamGetRequestSchema = z.object({
  teamId: teamIdSchema,
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.get'>>>

/** team.get and team.create response value. */
export const teamStateValueSchema = teamStateSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.get'>>>

/** team.create request payload. */
export const teamCreateRequestSchema = z.object({
  objective: z.string().trim().min(1),
  cwd: z.string().trim().min(1).optional(),
  agentPreset: z.string().trim().min(1).optional(),
  selection: modelSelectionSchema.optional(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.create'>>>

/** team.resume request payload. */
export const teamResumeRequestSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: z.number().int().nonnegative(),
  cwd: z.string().trim().min(1).optional(),
  agentPreset: z.string().trim().min(1).optional(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.resume'>>>

/** team.resume response value. */
export const teamResumeValueSchema = teamStateSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.resume'>>>

/** team.start request payload. */
export const teamStartRequestSchema = z.object({
  objective: z.string().trim().min(1),
  text: z.string().trim().min(1),
  idempotencyKey: channelPostIdempotencyKeySchema,
  cwd: z.string().trim().min(1).optional(),
  agentPreset: z.string().trim().min(1).optional(),
  selection: modelSelectionSchema.optional(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.start'>>>

/** team.start response value. */
export const teamStartValueSchema = z.object({
  state: teamStateSnapshotSchema,
  envelopeId: envelopeIdSchema,
}).strict() as unknown as z.ZodType<Wire<ResponseValue<'team.start'>>>

/** team.postInput request payload. */
export const teamPostInputRequestSchema = z.object({
  teamId: teamIdSchema,
  text: z.string().trim().min(1).optional(),
  content: z.array(promptContentPartSchema).min(1).optional(),
  idempotencyKey: channelPostIdempotencyKeySchema.optional(),
  delivery: envelopeDeliverySchema.optional(),
}).refine(value => value.text !== undefined || value.content !== undefined, {
  message: 'team.postInput requires text or content',
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.postInput'>>>

/** team.postInput response value. */
export const teamInputReceiptSchema = z.object({
  envelopeId: envelopeIdSchema,
}).strict() satisfies z.ZodType<Wire<TeamInputReceipt>>

/** team.waitFinal request payload. */
export const teamWaitFinalRequestSchema = z.object({
  teamId: teamIdSchema,
  afterCursor: z.number().int().min(-1).optional(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.waitFinal'>>>

/** team.waitFinal response value. */
export const teamFinalSchema = z.object({
  teamId: teamIdSchema,
  channelId: channelIdSchema,
  envelopeId: envelopeIdSchema,
  text: z.string().min(1),
}).strict() satisfies z.ZodType<Wire<TeamFinal>>

/** team.cancel request payload. */
export const teamCancelRequestSchema = z.object({
  teamId: teamIdSchema,
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.cancel'>>>

/** team.cancel response value. */
export const teamCancelValueSchema = z.object({
  accepted: z.literal(true),
  phase: teamPhaseSchema,
}).strict() satisfies z.ZodType<Wire<ResponseValue<'team.cancel'>>>

/** team.archive request payload. */
export const teamArchiveRequestSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: z.number().int().nonnegative(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.archive'>>>

/** team.archive response value. */
export const teamArchiveValueSchema = teamStateSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.archive'>>>

/** team.goal.update request payload. */
export const teamGoalUpdateRequestSchema = coreTeamGoalUpdateInputSchema as unknown as z.ZodType<Wire<RequestPayload<'team.goal.update'>>>

/** team.goal.update response value. */
export const teamGoalUpdateValueSchema = teamStateSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.goal.update'>>>

/** team.goal.transition request payload. */
export const teamGoalTransitionRequestSchema = coreTeamGoalPhaseTransitionInputSchema as unknown as z.ZodType<Wire<RequestPayload<'team.goal.transition'>>>

/** team.goal.transition response value. */
export const teamGoalTransitionValueSchema = teamStateSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.goal.transition'>>>

/** team.quiescence request payload. */
export const teamQuiescenceRequestSchema = z.object({ teamId: teamIdSchema }).strict() as unknown as z.ZodType<Wire<RequestPayload<'team.quiescence'>>>

/** team.quiescence response value. */
export const teamQuiescenceValueSchema = teamQuiescenceSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.quiescence'>>>

/** team.metrics request payload. */
export const teamMetricsRequestSchema = z.object({}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.metrics'>>>
/** team.metrics response value. */
export const teamMetricsValueSchema = teamMetricsSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.metrics'>>>

/** team.audit.read request payload. */
export const teamAuditReadRequestSchema = z.object({
  teamId: teamIdSchema,
  channelId: channelIdSchema.optional(),
  afterCursor: z.number().int().min(-1).optional(),
  limit: z.number().int().positive().optional(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.audit.read'>>>

/** team.audit.read response value. */
export const teamAuditReadValueSchema = teamAuditReadResultSchema as unknown as z.ZodType<Wire<TeamAuditList>>

/** team.artifact.read request payload. */
export const teamArtifactReadRequestSchema = z.object({
  teamId: teamIdSchema,
  artifactId: z.string().min(1),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.artifact.read'>>>

/** team.artifact.read response value. */
export const teamArtifactReadValueSchema = z.object({
  artifact: teamArtifactReferenceSchema,
  bytes: z.number().int().nonnegative(),
  data: z.string(),
}).strict() satisfies z.ZodType<Wire<TeamArtifactReadResult>>

/** team.artifact.list request payload. */
export const teamArtifactListRequestSchema = z.object({
  teamId: teamIdSchema,
  afterCursor: z.number().int().min(-1).optional(),
  limit: z.number().int().positive().optional(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.artifact.list'>>>

/** team.artifact.list response value. */
export const teamArtifactListValueSchema = z.object({
  items: z.array(teamArtifactReferenceSchema),
  nextCursor: z.number().int().nonnegative().optional(),
}).strict() as unknown as z.ZodType<Wire<TeamArtifactList>>

/** team.member.list request payload. */
export const teamMemberListRequestSchema = z.object({
  teamId: teamIdSchema,
  afterCursor: z.number().int().min(-1).optional(),
  limit: z.number().int().positive().optional(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.member.list'>>>

/** team.member.list response value. */
export const teamMemberListValueSchema = coreTeamMemberListPageSchema as unknown as z.ZodType<Wire<ResponseValue<'team.member.list'>>>

/** team.member.invite request payload. */
export const teamMemberInviteRequestSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: z.number().int().nonnegative(),
  kind: z.enum(['local-agent', 'remote-agent', 'service'] as const),
  displayName: z.string().trim().min(1),
  role: z.string().trim().min(1),
  capabilities: z.array(z.string().min(1)),
  provider: z.string().trim().min(1).optional(),
  preset: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  authScheme: z.string().trim().min(1).optional(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.member.invite'>>>

/** team.member.invite response value. */
export const teamMemberInviteValueSchema = participantSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.member.invite'>>>

/** team.member.activate request payload. */
export const teamMemberActivateRequestSchema = z.object({
  teamId: teamIdSchema,
  participantId: participantIdSchema,
  expectedCursor: z.number().int().nonnegative(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.member.activate'>>>

/** team.member.activate response value. */
export const teamMemberActivateValueSchema = participantSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.member.activate'>>>

/** team.member.remove request payload. */
export const teamMemberRemoveRequestSchema = z.object({
  teamId: teamIdSchema,
  participantId: participantIdSchema,
  expectedCursor: z.number().int().nonnegative(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.member.remove'>>>

/** team.member.remove response value. */
export const teamMemberRemoveValueSchema = participantSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.member.remove'>>>

/** team.member.interrupt request payload. */
export const teamMemberInterruptRequestSchema = z.object({
  teamId: teamIdSchema,
  participantId: participantIdSchema,
  expectedCursor: z.number().int().nonnegative(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.member.interrupt'>>>

/** team.member.interrupt response value. */
export const teamMemberInterruptValueSchema = participantInterruptSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.member.interrupt'>>>

/** team.channel.catalog request payload. */
export const teamChannelCatalogRequestSchema = z.object({}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.channel.catalog'>>>
/** team.channel.catalog response value. */
export const teamChannelCatalogValueSchema = teamChannelCatalogSchema as unknown as z.ZodType<Wire<ResponseValue<'team.channel.catalog'>>>

/** team.channel.list request payload. */
export const teamChannelListRequestSchema = teamChannelListInputSchema satisfies z.ZodType<Wire<RequestPayload<'team.channel.list'>>>
/** team.channel.list response value. */
export const teamChannelListValueSchema = teamChannelListPageSchema as unknown as z.ZodType<Wire<ResponseValue<'team.channel.list'>>>

/** team.channel.admission request payload. */
export const teamChannelAdmissionRequestSchema = z.object({ teamId: teamIdSchema, channelId: channelIdSchema }).strict() satisfies z.ZodType<Wire<RequestPayload<'team.channel.admission'>>>
/** team.channel.admission response value. */
export const teamChannelAdmissionValueSchema = channelHumanAdmissionSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.channel.admission'>>>

/** Actor-free discovery of the current human invitation. */
export const teamChannelInvitationRequestSchema = channelGetRequestSchema
/** Exact manifest acceptance; actor and principal fields are rejected. */
export const teamChannelInvitationAcknowledgeRequestSchema = channelInvitationAcknowledgeInputSchema
/** The caller's own invitation and complete manifest. */
export const teamChannelInvitationValueSchema = channelHumanInvitationSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.channel.invitation'>>>

/** team.channel.open request payload. */
export const teamChannelOpenRequestSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: z.number().int().nonnegative(),
  adapter: teamAdapterRefSchema,
  viewPolicy: teamViewPolicyRefSchema.optional(),
  participants: z.array(channelParticipantSchema),
  limits: jsonObjectSchema,
}).strict() as unknown as z.ZodType<Wire<RequestPayload<'team.channel.open'>>>

/** team.channel.open response value. */
export const teamChannelOpenValueSchema = channelSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.channel.open'>>>

const channelPostRoutingFields = {
  channelId: channelIdSchema,
  expectedCursor: z.number().int().nonnegative(),
  audience: z.array(participantIdSchema).nullable(),
  delivery: envelopeDeliverySchema,
  priority: envelopePrioritySchema.optional(),
  idempotencyKey: channelPostIdempotencyKeySchema.optional(),
  causationId: envelopeIdSchema.optional(),
  correlationId: z.string().min(1).optional(),
  taskId: teamTaskIdSchema.optional(),
  traceId: z.string().min(1).optional(),
  ttlMs: z.number().int().positive().optional(),
}

/** team.channel.post request payload. */
export const teamChannelPostRequestSchema = z.object({ ...channelPostRoutingFields,
  kind: z.string().min(1), payload: jsonObjectSchema,
}).strict() as unknown as z.ZodType<Wire<RequestPayload<'team.channel.post'>>>

/** team.channel.input accepts uploads, never caller-constructed durable attachment references. */
export const teamChannelInputRequestSchema = z.object({ ...channelPostRoutingFields,
  content: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string().min(1) }).strict(),
    z.object({ type: z.literal('image'), mediaType: imageMediaTypeSchema, data: z.string().min(1), name: z.string().optional() }).strict(),
  ])).min(1),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.channel.input'>>>
/** team.channel.input response value. */
export const teamChannelInputValueSchema = teamEnvelopeSchema as unknown as z.ZodType<Wire<ResponseValue<'team.channel.input'>>>
/** team.channel.attachment request payload. */
export const teamChannelAttachmentRequestSchema = z.object({ teamId: teamIdSchema, channelId: channelIdSchema,
  envelopeId: envelopeIdSchema, envelopeSequence: z.number().int().nonnegative(), attachmentId: attachmentIdSchema,
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.channel.attachment'>>>
/** team.channel.attachment response value. */
export const teamChannelAttachmentValueSchema = z.object({ attachment: imageAttachmentRefSchema, data: z.string() }) satisfies z.ZodType<Wire<ResponseValue<'team.channel.attachment'>>>

/** team.channel.post response value. */
export const teamChannelPostValueSchema = teamEnvelopeSchema as unknown as z.ZodType<Wire<ResponseValue<'team.channel.post'>>>

/** team.channel.summarize selection; generated text and authority never come from the wire. */
export const teamChannelSummarizeRequestSchema = channelSummarySelectionInputSchema as unknown as z.ZodType<Wire<RequestPayload<'team.channel.summarize'>>>
/** team.channel.summarize committed record and source provenance. */
export const teamChannelSummarizeValueSchema = channelSummaryRecordSchema as unknown as z.ZodType<Wire<ResponseValue<'team.channel.summarize'>>>

/** team.channel.read request payload. */
export const teamChannelReadRequestSchema = z.object({
  channelId: channelIdSchema,
  afterCursor: z.number().int().min(-1).optional(),
  limit: z.number().int().positive().optional(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.channel.read'>>>

/** team.channel.read response value. */
export const teamChannelReadValueSchema = channelReadPageResultSchema as unknown as z.ZodType<Wire<ResponseValue<'team.channel.read'>>>

/** team.channel.close request payload. */
export const teamChannelCloseRequestSchema = z.object({
  channelId: channelIdSchema,
  expectedCursor: z.number().int().nonnegative(),
  reason: z.string().min(1).optional(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.channel.close'>>>

/** team.channel.close response value. */
export const teamChannelCloseValueSchema = channelSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.channel.close'>>>

/** team.channel.watch request payload. */
export const teamChannelWatchRequestSchema = z.object({
  channelId: channelIdSchema,
  afterCursor: z.number().int().min(-1).optional(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.channel.watch'>>>

/** team.channel.watch response value. */
export const teamChannelWatchValueSchema = channelWatchResultSchema as unknown as z.ZodType<Wire<ResponseValue<'team.channel.watch'>>>

/** team.task.create request payload. */
export const teamTaskCreateRequestSchema = z.object({
  teamId: teamIdSchema,
  expectedCursor: z.number().int().nonnegative(),
  idempotencyKey: teamTaskCreateIdempotencyKeySchema,
  parentTaskId: teamTaskIdSchema.optional(),
  execution: teamTaskExecutionSchema.optional(),
  placement: teamTaskPlacementSchema.optional(),
  subject: z.string().min(1),
  description: z.string().min(1),
  integration: teamTaskIntegrationSpecSchema.optional(),
  blockedBy: z.array(teamTaskIdSchema),
  requiredCapabilities: z.array(z.string().min(1)),
  priority: z.number().int().nonnegative(),
  readScopes: z.array(z.string().min(1)),
  writeScopes: z.array(z.string().min(1)),
  workspaceMode: teamTaskWorkspaceModeSchema,
  budget: jsonObjectSchema,
  reviewPolicy: teamTaskReviewPolicySchema,
  maxAttempts: z.number().int().positive(),
}).strict() as unknown as z.ZodType<Wire<RequestPayload<'team.task.create'>>>

/** team.task.create response value. */
export const teamTaskCreateValueSchema = teamTaskSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.task.create'>>>

/** team.task.get request payload. */
export const teamTaskGetRequestSchema = coreTeamTaskGetRequestSchema satisfies z.ZodType<Wire<RequestPayload<'team.task.get'>>>

/** team.task.get response value. */
export const teamTaskGetValueSchema = teamTaskSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.task.get'>>>

/** team.task.list request payload. */
export const teamTaskListRequestSchema = z.object({
  teamId: teamIdSchema,
  afterCursor: z.number().int().min(-1).optional(),
  limit: z.number().int().positive().optional(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.task.list'>>>

/** team.task.list response value. */
export const teamTaskListValueSchema = coreTeamTaskListPageSchema as unknown as z.ZodType<Wire<ResponseValue<'team.task.list'>>>

/** team.workflow.plan.list request payload. */
export const teamWorkflowPlanListRequestSchema = z.object({
  teamId: teamIdSchema,
  afterCursor: z.number().int().min(-1).optional(),
  limit: z.number().int().positive().optional(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.workflow.plan.list'>>>

/** team.workflow.plan.list response value. */
export const teamWorkflowPlanListValueSchema = z.object({
  items: z.array(teamWorkflowPlanSnapshotSchema),
  nextCursor: z.number().int().nonnegative().optional(),
}).strict() as unknown as z.ZodType<Wire<TeamWorkflowPlanList>>

/** team.task.update request payload. */
export const teamTaskUpdateRequestSchema = coreTeamTaskDetailsUpdateInputSchema as unknown as z.ZodType<Wire<RequestPayload<'team.task.update'>>>

/** team.task.update response value. */
export const teamTaskUpdateValueSchema = teamTaskSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.task.update'>>>

/** team.task.cancel request payload. */
export const teamTaskCancelRequestSchema = coreTeamTaskCancelInputSchema satisfies z.ZodType<Wire<RequestPayload<'team.task.cancel'>>>

/** team.task.cancel response value. */
export const teamTaskCancelValueSchema = teamTaskSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.task.cancel'>>>

/** team.task.delete request payload. */
export const teamTaskDeleteRequestSchema = coreTeamTaskDeleteInputSchema satisfies z.ZodType<Wire<RequestPayload<'team.task.delete'>>>

/** team.task.delete response value. */
export const teamTaskDeleteValueSchema = teamTaskSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.task.delete'>>>

/** team.task.review request payload. */
export const teamTaskReviewRequestSchema = z.object({
  teamId: teamIdSchema,
  taskId: teamTaskIdSchema,
  expectedRevision: z.number().int().positive(),
  decision: z.enum(['accepted', 'rework'] as const),
  reason: z.string().trim().min(1),
}).strict() as unknown as z.ZodType<Wire<RequestPayload<'team.task.review'>>>

/** team.task.review response value. */
export const teamTaskReviewValueSchema = teamTaskSnapshotSchema as unknown as z.ZodType<Wire<ResponseValue<'team.task.review'>>>

/** team.task.watch request payload. */
export const teamTaskWatchRequestSchema = z.object({
  teamId: teamIdSchema,
  afterCursor: z.number().int().min(-1).optional(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'team.task.watch'>>>

/** team.task.watch response value. */
export const teamTaskWatchValueSchema = teamWatchResultSchema as unknown as z.ZodType<Wire<ResponseValue<'team.task.watch'>>>

/** Principal inbox page projected through the Host's JSON wire mapping. */
export const teamHumanInboxPageSchema = coreHumanInboxPageSchema as unknown as z.ZodType<Wire<ResponseValue<'team.inbox.read'>>>
/** Typed response outcome projected through the Host's JSON wire mapping. */
export const teamHumanActionResponseResultSchema = coreHumanActionResponseResultSchema as unknown as z.ZodType<Wire<ResponseValue<'team.inbox.respond'>>>
