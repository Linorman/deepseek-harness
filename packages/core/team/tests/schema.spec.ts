import { describe, expect, expectTypeOf, it } from 'vitest'
import type { Branded } from '@clocky/clocky-brand'
import {
  activationBindInputSchema,
  activationBindingSnapshotSchema,
  activationFenceInputSchema,
  activationQuiesceInputSchema,
  activationGetRequestSchema,
  activationIdSchema,
  activationRecoverySnapshotSchema,
  activationStatusUpdateInputSchema,
  assertActivationStatusTransition,
  assertChannelPhaseTransition,
  assertParticipantPhaseTransition,
  assertTeamGoalPhaseTransition,
  assertTeamPhaseTransition,
  assertTeamTaskPhaseTransition,
  channelEventSchema,
  channelCloseInputSchema,
  channelDeliveryClaimInputSchema,
  channelDeliveryClaimSchema,
  teamChannelViewEventDataSchema,
  channelEnvelopePostInputSchema,
  channelFinalPostInputSchema,
  channelEnvelopeReceiptInputSchema,
  channelGetRequestSchema,
  channelManifestSchema,
  channelPostIdempotencyKeySchema,
  channelOpenInputSchema,
  channelPendingDeliveryListRequestSchema,
  channelPendingDeliveryPageSchema,
  channelPendingEnvelopeDeliverySchema,
  channelRecordSchema,
  channelIdSchema,
  channelReadRequestSchema,
  channelReadPageRequestSchema,
  channelReadPageResultSchema,
  channelReadResultSchema,
  channelDeliveryExpireResultSchema,
  channelDeliveryExpiredRecordSchema,
  teamChannelCompactInputSchema,
  teamChannelCompactResultSchema,
  teamJournalCompactInputSchema,
  teamJournalCompactResultSchema,
  channelSummaryIdempotencyKeySchema,
  channelSummaryRecordSchema,
  channelSummarizeInputSchema,
  channelSnapshotSchema,
  channelWatchRequestSchema,
  channelWatchResultSchema,
  envelopeIdSchema,
  jsonObjectSchema,
  participantCapabilitiesSchema,
  participantInterruptAcknowledgeInputSchema,
  participantInterruptListPendingInputSchema,
  participantInterruptRequestInputSchema,
  participantInterruptSnapshotSchema,
  participantInterruptTargetSchema,
  participantIdSchema,
  participantInviteInputSchema,
  participantPhaseTransitionInputSchema,
  taskAttemptFailureSchema,
  taskAttemptIntegrationResultSchema,
  taskAttemptIdSchema,
  taskAttemptOutcomeSchema,
  taskAttemptResultSchema,
  taskAttemptSnapshotSchema,
  taskLeaseSnapshotSchema,
  teamCreateRequestSchema,
  teamCreationActorSchema,
  teamRootCreateInputSchema,
  teamChildCreateInputSchema,
  teamArchiveInputSchema,
  teamResumeInputSchema,
  teamAuditEntrySchema,
  teamAuditReadRequestSchema,
  teamAuditReadResultSchema,
  teamEnvelopeDraftSchema,
  teamEnvelopeSchema,
  teamEventSchema,
  teamGetRequestSchema,
  teamGoalBlockerSchema,
  teamGoalPhaseSchema,
  teamGoalPhaseTransitionInputSchema,
  teamGoalSeedSchema,
  teamGoalSnapshotSchema,
  teamGoalUpdateInputSchema,
  teamHumanActionResolveInputSchema,
  teamHumanActionUpsertInputSchema,
  teamIdSchema,
  teamListPageRequestSchema,
  teamListPageSchema,
  teamMemberListPageRequestSchema,
  teamMemberListPageSchema,
  teamInterruptIdSchema,
  teamPhaseTransitionInputSchema,
  teamPhaseSchema,
  teamPolicyDecisionSchema,
  teamPolicyHookSchema,
  teamPolicyRequestSchema,
  teamUsageRecordInputSchema,
  teamUsageSampleInputSchema,
  teamUsageSampleSchema,
  teamStateSnapshotSchema,
  teamSystemFinalReceiptProofResolutionSchema,
  teamSystemFinalReceiptProofSourceNameSchema,
  teamSystemFinalReceiptScopeSchema,
  teamSystemActivationProofResolutionSchema,
  teamSystemActivationProofSourceNameSchema,
  teamSystemActivationScopeSchema,
  teamSystemHumanActionProofResolutionSchema,
  teamSystemHumanActionProofSourceNameSchema,
  teamSystemHumanActionScopeSchema,
  teamSystemTaskLeaseProofResolutionSchema,
  teamSystemTaskLeaseProofSourceNameSchema,
  teamSystemTaskLeaseScopeSchema,
  teamSystemTaskControlProofResolutionSchema,
  teamSystemTaskControlProofSourceNameSchema,
  teamSystemTaskControlScopeSchema,
  teamSystemRootCreationProofResolutionSchema,
  teamSystemRootCreationProofSourceNameSchema,
  teamSystemRootCreationScopeSchema,
  teamSystemChildCreationProofResolutionSchema,
  teamSystemChildCreationProofSourceNameSchema,
  teamSystemChildCreationScopeSchema,
  teamSystemChannelSummaryProofResolutionSchema,
  teamSystemChannelSummaryProofSourceNameSchema,
  teamSystemChannelSummaryScopeSchema,
  teamSystemArchiveProofResolutionSchema,
  teamSystemArchiveProofSourceNameSchema,
  teamSystemArchiveScopeSchema,
  teamSystemTopologyProofResolutionSchema,
  teamSystemTopologyProofSourceNameSchema,
  teamSystemTopologyScopeSchema,
  teamSystemSchedulerChannelProofResolutionSchema,
  teamSystemSchedulerChannelProofSourceNameSchema,
  teamSystemSchedulerChannelScopeSchema,
  teamSystemCancellationCleanupProofResolutionSchema,
  teamSystemCancellationCleanupProofSourceNameSchema,
  teamSystemCancellationCleanupScopeSchema,
  teamSystemFinalizationCleanupProofResolutionSchema,
  teamSystemFinalizationCleanupProofSourceNameSchema,
  teamSystemFinalizationCleanupScopeSchema,
  teamSystemWorkflowProofResolutionSchema,
  teamSystemWorkflowProofSourceNameSchema,
  teamSystemWorkflowScopeSchema,
  teamSystemClosureProofResolutionSchema,
  teamSystemClosureProofSourceNameSchema,
  teamSystemClosureScopeSchema,
  teamSystemClosureDriverProofResolutionSchema,
  teamSystemClosureDriverProofSourceNameSchema,
  teamSystemClosureDriverScopeSchema,
  teamSystemPhaseProofResolutionSchema,
  teamSystemPhaseProofSourceNameSchema,
  teamSystemPhaseScopeSchema,
  teamSystemMaintenanceProofResolutionSchema,
  teamSystemMaintenanceProofSourceNameSchema,
  teamSystemMaintenanceScopeSchema,
  teamSystemInterruptProofResolutionSchema,
  teamSystemInterruptProofSourceNameSchema,
  teamSystemInterruptScopeSchema,
  teamCancelInputSchema,
  teamClosureContinuationInputSchema,
  teamClosureInputSchema,
  teamCompleteInputSchema,
  teamFailInputSchema,
  teamSystemTaskReviewProofResolutionSchema,
  teamSystemTaskReviewProofSourceNameSchema,
  teamSystemTaskReviewScopeSchema,
  teamTaskCreateInputSchema,
  teamTaskCreateCommandSchema,
  teamTaskCreateCommandInputSchema,
  teamTaskCreateIdempotencyKeySchema,
  teamTaskCommandCreatorSchema,
  teamTaskCreatorSchema,
  teamHumanTaskCreatorSchema,
  teamTaskCancelInputSchema,
  teamCancellationTaskCancelInputSchema,
  teamTaskAssignInputSchema,
  teamTaskAttemptExpireInputSchema,
  teamTaskAttemptFenceSchema,
  teamTaskAttemptHeartbeatInputSchema,
  teamTaskAttemptOwnerFenceSchema,
  teamTaskAttemptSettleInputSchema,
  teamTaskAttemptStartClaimInputSchema,
  teamTaskAttemptStartInputSchema,
  teamTaskDeleteInputSchema,
  teamTaskDetailsUpdateInputSchema,
  teamTaskGetRequestSchema,
  teamTaskIdSchema,
  teamTaskListPageRequestSchema,
  teamTaskListPageSchema,
  teamTaskOwnerProposalInputSchema,
  teamTaskReviewResolveInputSchema,
  teamTaskReviewDecisionSchema,
  teamTaskReviewPolicySchema,
  teamTaskSnapshotSchema,
  teamTaskIntegrationSpecSchema,
  teamTaskWorkspaceModeSchema,
  teamWorkspaceAllocationIdSchema,
  teamWorkspaceAllocationSnapshotSchema,
  teamWorkspaceAllocationReserveInputSchema,
  teamWorkspaceAllocationActivateInputSchema,
  teamWorkspaceAllocationReleaseRequestInputSchema,
  teamWorkspaceAllocationPreserveInputSchema,
  teamWorkspaceAllocationReleaseInputSchema,
  teamSystemWorkspaceAllocationProofSourceNameSchema,
  teamSystemWorkspaceAllocationScopeSchema,
  teamSystemWorkspaceAllocationProofResolutionSchema,
  teamCancellationChannelCloseInputSchema,
  teamFinalizationChannelCloseInputSchema,
  schedulerReviewChannelOpenInputSchema,
  schedulerWakeChannelOpenInputSchema,
  schedulerFailedWakeChannelCloseInputSchema,
  schedulerChannelDeliveryExpireInputSchema,
  teamWorkflowChannelCloseInputSchema,
  teamWorkflowPlanChannelBindInputSchema,
  teamWorkflowPlanPhaseInputSchema,
  teamWorkflowPlanTaskBindInputSchema,
  teamSnapshotSchema,
  teamWatchRequestSchema,
  teamWatchResultSchema,
} from '../src/index.ts'
import type {
  ChannelWatchRequest as ChannelWatchRequestType,
  ChannelEnvelopeReceiptActor as ChannelEnvelopeReceiptActorType,
  ChannelEnvelopeReceiptInput as ChannelEnvelopeReceiptInputType,
  ChannelEnvelopeReceiptRequest as ChannelEnvelopeReceiptRequestType,
  ParticipantInterruptAcknowledgeInput as ParticipantInterruptAcknowledgeInputType,
  ParticipantInterruptAcknowledgeRequest as ParticipantInterruptAcknowledgeRequestType,
  ParticipantInterruptListPendingInput as ParticipantInterruptListPendingInputType,
  ParticipantInterruptListPendingRequest as ParticipantInterruptListPendingRequestType,
  ParticipantInterruptRequest as ParticipantInterruptRequestType,
  ParticipantInterruptRequestInput as ParticipantInterruptRequestInputType,
  ParticipantId as ParticipantIdType,
  TeamActorProof as TeamActorProofType,
  TeamHumanActorProof as TeamHumanActorProofType,
  ActivationBindInput as ActivationBindInputType,
  ActivationBindRequest as ActivationBindRequestType,
  ActivationFenceInput as ActivationFenceInputType,
  ActivationFenceRequest as ActivationFenceRequestType,
  ActivationQuiesceInput as ActivationQuiesceInputType,
  ActivationQuiesceRequest as ActivationQuiesceRequestType,
  ActivationStatusUpdateInput as ActivationStatusUpdateInputType,
  ActivationStatusUpdateRequest as ActivationStatusUpdateRequestType,
  TeamHumanActionResolveInput as TeamHumanActionResolveInputType,
  TeamHumanActionResolveRequest as TeamHumanActionResolveRequestType,
  TeamHumanActionUpsertInput as TeamHumanActionUpsertInputType,
  TeamHumanActionUpsertRequest as TeamHumanActionUpsertRequestType,
  TeamClosureAuthority as TeamClosureAuthorityType,
  TeamClosureInput as TeamClosureInputType,
  TeamCompleteInput as TeamCompleteInputType,
  TeamCompleteRequest as TeamCompleteRequestType,
  TeamChildCreateInput as TeamChildCreateInputType,
  TeamChildCreateRequest as TeamChildCreateRequestType,
  TeamGoalPhaseTransitionInput as TeamGoalPhaseTransitionInputType,
  TeamGoalPhaseTransitionRequest as TeamGoalPhaseTransitionRequestType,
  TeamGoalUpdateInput as TeamGoalUpdateInputType,
  TeamGoalUpdateRequest as TeamGoalUpdateRequestType,
  TeamPhaseTransitionInput as TeamPhaseTransitionInputType,
  TeamPhaseTransitionRequest as TeamPhaseTransitionRequestType,
  TeamSystemPhaseProof as TeamSystemPhaseProofType,
  TeamSystemChildCreationProof as TeamSystemChildCreationProofType,
  TeamSystemActivationProof as TeamSystemActivationProofType,
  TeamSystemHumanActionProof as TeamSystemHumanActionProofType,
  TeamSystemTaskLeaseProof as TeamSystemTaskLeaseProofType,
  TeamChannelCompactInput as TeamChannelCompactInputType,
  TeamChannelCompactRequest as TeamChannelCompactRequestType,
  TeamJournalCompactInput as TeamJournalCompactInputType,
  TeamJournalCompactRequest as TeamJournalCompactRequestType,
  TeamSystemMaintenanceProof as TeamSystemMaintenanceProofType,
  TeamSystemInterruptProof as TeamSystemInterruptProofType,
  TeamSystemClosureProof as TeamSystemClosureProofType,
  TeamSystemFinalReceiptProof as TeamSystemFinalReceiptProofType,
  TeamInterruptId as TeamInterruptIdType,
  TeamId as TeamIdType,
  TeamTaskAttemptHeartbeatInput as TeamTaskAttemptHeartbeatInputType,
  TeamTaskAttemptHeartbeatRequest as TeamTaskAttemptHeartbeatRequestType,
  TeamTaskAttemptExpireInput as TeamTaskAttemptExpireInputType,
  TeamTaskAttemptExpireRequest as TeamTaskAttemptExpireRequestType,
  TeamTaskAttemptStartClaimInput as TeamTaskAttemptStartClaimInputType,
  TeamTaskAttemptStartClaimRequest as TeamTaskAttemptStartClaimRequestType,
  TeamTaskAttemptSettleInput as TeamTaskAttemptSettleInputType,
  TeamTaskAttemptSettleRequest as TeamTaskAttemptSettleRequestType,
  TeamTaskCreateIdempotencyKey as TeamTaskCreateIdempotencyKeyType,
  TeamTaskCreateCommandInput as TeamTaskCreateCommandInputType,
  TeamTaskCreateInput as TeamTaskCreateInputType,
  TeamTaskCreateRequest as TeamTaskCreateRequestType,
  TeamTaskAssignInput as TeamTaskAssignInputType,
  TeamTaskAssignRequest as TeamTaskAssignRequestType,
  TeamWorkflowPlanAdmissionInput as TeamWorkflowPlanAdmissionInputType,
  TeamWorkflowPlanAdmissionRequest as TeamWorkflowPlanAdmissionRequestType,
  TeamUsageRecordInput as TeamUsageRecordInputType,
  TeamUsageRecordRequest as TeamUsageRecordRequestType,
  TeamUsageSampleInput as TeamUsageSampleInputType,
  TeamWatchRequest as TeamWatchRequestType,
} from '../src/index.ts'
const manifest = {
  id: 'channel-1',
  teamId: 'team-1',
  adapter: { type: 'direct', version: 1 },
  participants: [{ id: 'participant-1', role: 'worker' }],
  limits: { turns: 4 },
}
const envelope = {
  id: 'envelope-1',
  teamId: 'team-1',
  channelId: 'channel-1',
  sequence: 2,
  senderId: 'participant-1',
  audience: null,
  kind: 'report',
  payload: { text: 'done' },
  delivery: 'turn' as const,
  priority: 'normal' as const,
  createdAt: 3,
}
describe('Team runtime schemas', () => {
  it('keeps Team identities nominally distinct and parses independently minted strings', () => {
    expectTypeOf<TeamIdType>().not.toEqualTypeOf<ParticipantIdType>()
    expectTypeOf<TeamInterruptIdType>().not.toEqualTypeOf<ParticipantIdType>()
    expectTypeOf<TeamTaskCreateIdempotencyKeyType>().not.toEqualTypeOf<Branded<'ChannelPostIdempotencyKey'>>()
    expectTypeOf<TeamIdType>().not.toEqualTypeOf<Branded<'SessionId'>>()
    expectTypeOf<Branded<'SessionId'>>().not.toExtend<TeamIdType>()
    expectTypeOf<TeamWatchRequestType['signal']>().toEqualTypeOf<AbortSignal | undefined>()
    expectTypeOf<ChannelWatchRequestType['signal']>().toEqualTypeOf<AbortSignal | undefined>()
    expectTypeOf<ActivationBindRequestType>().toExtend<ActivationBindInputType>()
    expectTypeOf<ActivationBindRequestType['actor']>().toEqualTypeOf<TeamSystemActivationProofType>()
    expectTypeOf<ActivationStatusUpdateRequestType>().toExtend<ActivationStatusUpdateInputType>()
    expectTypeOf<ActivationStatusUpdateRequestType['actor']>().toEqualTypeOf<TeamSystemActivationProofType>()
    expectTypeOf<ActivationFenceRequestType>().toExtend<ActivationFenceInputType>()
    expectTypeOf<ActivationFenceRequestType['actor']>().toEqualTypeOf<TeamSystemActivationProofType>()
    expectTypeOf<ActivationQuiesceRequestType>().toExtend<ActivationQuiesceInputType>()
    expectTypeOf<ActivationQuiesceRequestType['actor']>().toEqualTypeOf<TeamSystemActivationProofType>()
    expectTypeOf<TeamSystemActivationProofType>().not.toEqualTypeOf<TeamActorProofType>()
    expectTypeOf<TeamHumanActionUpsertRequestType>().toExtend<TeamHumanActionUpsertInputType>()
    expectTypeOf<TeamHumanActionUpsertRequestType['actor']>().toEqualTypeOf<TeamSystemHumanActionProofType>()
    expectTypeOf<TeamHumanActionResolveRequestType>().toExtend<TeamHumanActionResolveInputType>()
    expectTypeOf<TeamHumanActionResolveRequestType['actor']>().toEqualTypeOf<TeamSystemHumanActionProofType>()
    expectTypeOf<TeamSystemHumanActionProofType>().not.toEqualTypeOf<TeamActorProofType>()
    expectTypeOf<TeamTaskAssignRequestType>().toExtend<TeamTaskAssignInputType>()
    expectTypeOf<TeamTaskAssignRequestType['actor']>().toEqualTypeOf<TeamSystemTaskLeaseProofType>()
    expectTypeOf<TeamTaskAttemptExpireRequestType>().toExtend<TeamTaskAttemptExpireInputType>()
    expectTypeOf<TeamTaskAttemptExpireRequestType['actor']>().toEqualTypeOf<TeamSystemTaskLeaseProofType>()
    expectTypeOf<TeamSystemTaskLeaseProofType>().not.toEqualTypeOf<TeamActorProofType>()
    expectTypeOf<TeamTaskAttemptStartClaimRequestType>().toExtend<TeamTaskAttemptStartClaimInputType>()
    expectTypeOf<TeamTaskAttemptStartClaimRequestType['actor']>().toEqualTypeOf<TeamActorProofType>()
    expectTypeOf<TeamTaskAttemptHeartbeatRequestType>().toExtend<TeamTaskAttemptHeartbeatInputType>()
    expectTypeOf<TeamTaskAttemptHeartbeatRequestType['actor']>().toEqualTypeOf<TeamActorProofType>()
    expectTypeOf<TeamTaskAttemptSettleRequestType>().toExtend<TeamTaskAttemptSettleInputType>()
    expectTypeOf<TeamTaskAttemptSettleRequestType['actor']>().toEqualTypeOf<TeamActorProofType>()
    expectTypeOf<TeamSystemFinalReceiptProofType>().not.toEqualTypeOf<TeamActorProofType>()
    expectTypeOf<TeamSystemClosureProofType>().not.toEqualTypeOf<TeamActorProofType>()
    expectTypeOf<TeamChildCreateRequestType>().toExtend<TeamChildCreateInputType>()
    expectTypeOf<TeamChildCreateRequestType['actor']>().toEqualTypeOf<TeamSystemChildCreationProofType>()
    expectTypeOf<ChannelEnvelopeReceiptRequestType>().toExtend<ChannelEnvelopeReceiptInputType>()
    expectTypeOf<ChannelEnvelopeReceiptRequestType['actor']>().toEqualTypeOf<ChannelEnvelopeReceiptActorType>()
    expectTypeOf<TeamCompleteRequestType>().toExtend<TeamCompleteInputType>()
    expectTypeOf<TeamCompleteInputType>().toExtend<TeamClosureInputType>()
    expectTypeOf<TeamCompleteRequestType['actor']>().toEqualTypeOf<TeamClosureAuthorityType>()
    expectTypeOf<TeamGoalUpdateRequestType>().toExtend<TeamGoalUpdateInputType>()
    expectTypeOf<TeamGoalUpdateRequestType['actor']>().toEqualTypeOf<TeamActorProofType | TeamHumanActorProofType>()
    expectTypeOf<TeamGoalPhaseTransitionRequestType>().toExtend<TeamGoalPhaseTransitionInputType>()
    expectTypeOf<TeamGoalPhaseTransitionRequestType['actor']>().toEqualTypeOf<TeamActorProofType | TeamHumanActorProofType>()
    expectTypeOf<TeamPhaseTransitionRequestType>().toExtend<TeamPhaseTransitionInputType>()
    expectTypeOf<TeamPhaseTransitionRequestType['actor']>().toEqualTypeOf<TeamSystemPhaseProofType>()
    expectTypeOf<TeamChannelCompactRequestType>().toExtend<TeamChannelCompactInputType>()
    expectTypeOf<TeamChannelCompactRequestType['actor']>().toEqualTypeOf<TeamSystemMaintenanceProofType>()
    expectTypeOf<TeamJournalCompactRequestType>().toExtend<TeamJournalCompactInputType>()
    expectTypeOf<TeamJournalCompactRequestType['actor']>().toEqualTypeOf<TeamSystemMaintenanceProofType>()
    expectTypeOf<ParticipantInterruptRequestType>().toExtend<ParticipantInterruptRequestInputType>()
    expectTypeOf<ParticipantInterruptRequestType['actor']>().toEqualTypeOf<TeamSystemInterruptProofType | TeamHumanActorProofType>()
    expectTypeOf<ParticipantInterruptListPendingRequestType>().toExtend<ParticipantInterruptListPendingInputType>()
    expectTypeOf<ParticipantInterruptListPendingRequestType['actor']>().toEqualTypeOf<TeamActorProofType>()
    expectTypeOf<ParticipantInterruptAcknowledgeRequestType>().toExtend<ParticipantInterruptAcknowledgeInputType>()
    expectTypeOf<ParticipantInterruptAcknowledgeRequestType['actor']>().toEqualTypeOf<TeamActorProofType>()
    expectTypeOf<TeamUsageRecordRequestType>().toExtend<TeamUsageRecordInputType>()
    expectTypeOf<TeamUsageRecordRequestType['actor']>().toEqualTypeOf<TeamActorProofType>()
    expectTypeOf<TeamUsageRecordInputType['sample']>().toEqualTypeOf<TeamUsageSampleInputType>()
    expectTypeOf<TeamTaskCreateRequestType>().toExtend<TeamTaskCreateInputType>()
    expectTypeOf<TeamTaskCreateRequestType['actor']>().toEqualTypeOf<TeamActorProofType | TeamHumanActorProofType>()
    expectTypeOf<TeamTaskCreateInputType['createCommand']>().toEqualTypeOf<TeamTaskCreateCommandInputType>()
    expectTypeOf<TeamWorkflowPlanAdmissionRequestType>().toExtend<TeamWorkflowPlanAdmissionInputType>()
    expectTypeOf<TeamWorkflowPlanAdmissionRequestType['actor']>().toEqualTypeOf<TeamActorProofType>()
    expect(teamIdSchema.parse('team-1')).toBe('team-1')
    expect(() => teamIdSchema.parse('')).toThrow()
    expect(activationIdSchema.parse('activation-1')).toBe('activation-1')
    expect(teamInterruptIdSchema.parse('interrupt-1')).toBe('interrupt-1')
    expect(channelIdSchema.parse('channel-1')).toBe('channel-1')
    expect(channelPostIdempotencyKeySchema.parse('post-1')).toBe('post-1')
    expect(channelPostIdempotencyKeySchema.safeParse('').success).toBe(false)
    expect(teamTaskCreateIdempotencyKeySchema.parse('task-create-1')).toBe('task-create-1')
    expect(teamTaskCreateIdempotencyKeySchema.safeParse('').success).toBe(false)
    expect(envelopeIdSchema.parse('envelope-1')).toBe('envelope-1')
    expect(participantIdSchema.parse('participant-1')).toBe('participant-1')
    expect(taskAttemptIdSchema.parse('attempt-1')).toBe('attempt-1')
    expect(teamTaskIdSchema.parse('task-1')).toBe('task-1')
    expect(teamSystemFinalReceiptProofSourceNameSchema.parse('team-run')).toBe('team-run')
    expect(teamSystemFinalReceiptProofSourceNameSchema.safeParse(' team-run').success).toBe(false)
    expect(teamSystemFinalReceiptProofSourceNameSchema.safeParse('').success).toBe(false)
    const finalReceiptScope = teamSystemFinalReceiptScopeSchema.parse({
      teamId: 'team-1', channelId: 'channel-1', humanId: 'human-1', coordinatorId: 'coordinator-1',
    })
    expect(teamSystemFinalReceiptProofResolutionSchema.parse({
      sourceName: 'team-run', scope: finalReceiptScope,
    })).toEqual({ sourceName: 'team-run', scope: finalReceiptScope })
    expect(teamSystemFinalReceiptScopeSchema.safeParse({
      ...finalReceiptScope, humanId: finalReceiptScope.coordinatorId,
    }).success).toBe(false)
    expect(teamSystemFinalReceiptProofResolutionSchema.safeParse({
      sourceName: 'team-run', scope: finalReceiptScope, proof: {},
    }).success).toBe(false)
    expect(teamSystemActivationProofSourceNameSchema.parse('team-activation-controller')).toBe('team-activation-controller')
    expect(teamSystemActivationProofSourceNameSchema.safeParse(' team-activation-controller').success).toBe(false)
    const activationStatusScope = teamSystemActivationScopeSchema.parse({
      kind: 'activation-controller-status',
      teamId: 'team-1',
      activationId: 'activation-1',
      participantId: 'participant-1',
      sessionId: 'session-1',
      provider: 'in-process',
      expectedCursor: 4,
      status: 'running',
    })
    expect(teamSystemActivationProofResolutionSchema.parse({
      sourceName: 'team-activation-controller', scope: activationStatusScope,
    })).toEqual({ sourceName: 'team-activation-controller', scope: activationStatusScope })
    expect(teamSystemActivationScopeSchema.parse({
      kind: 'activation-recovery-quiesce',
      teamId: 'team-1',
      activationId: 'activation-1',
      participantId: 'participant-1',
      sessionId: 'session-1',
      provider: 'in-process',
      expectedCursor: 4,
    })).toMatchObject({ kind: 'activation-recovery-quiesce' })
    expect(teamSystemActivationScopeSchema.safeParse({
      ...activationStatusScope,
      expectedCursor: -1,
    }).success).toBe(false)
    expect(teamSystemActivationProofResolutionSchema.safeParse({
      sourceName: 'team-activation-controller', scope: activationStatusScope, proof: {},
    }).success).toBe(false)
    expect(teamSystemHumanActionProofSourceNameSchema.parse('host-api-proxy')).toBe('host-api-proxy')
    expect(teamSystemHumanActionProofSourceNameSchema.safeParse(' host-api-proxy').success).toBe(false)
    const pendingHumanAction = {
      id: 'question:session-1:source-1',
      teamId: 'team-1',
      kind: 'question' as const,
      phase: 'pending' as const,
      sessionId: 'session-1',
      participantId: 'participant-1',
      sourceId: 'source-1',
      details: { questionRpcId: 'source-1' },
      createdAt: 0,
      updatedAt: 0,
    }
    const humanActionScope = teamSystemHumanActionScopeSchema.parse({
      kind: 'host-human-action-upsert',
      teamId: 'team-1',
      expectedCursor: 4,
      action: pendingHumanAction,
    })
    expect(teamSystemHumanActionProofResolutionSchema.parse({
      sourceName: 'host-api-proxy', scope: humanActionScope,
    })).toEqual({ sourceName: 'host-api-proxy', scope: humanActionScope })
    expect(teamSystemHumanActionScopeSchema.parse({
      kind: 'host-human-action-resolve',
      teamId: 'team-1',
      expectedCursor: 4,
      action: pendingHumanAction,
      phase: 'resolved',
      outcome: { kind: 'answered' },
    })).toMatchObject({ kind: 'host-human-action-resolve', phase: 'resolved' })
    expect(teamSystemHumanActionScopeSchema.safeParse({
      ...humanActionScope,
      action: { ...pendingHumanAction, createdAt: 1, updatedAt: 1 },
    }).success).toBe(false)
    expect(teamSystemHumanActionProofResolutionSchema.safeParse({
      sourceName: 'host-api-proxy', scope: humanActionScope, proof: {},
    }).success).toBe(false)
    expect(teamHumanActionUpsertInputSchema.parse({ teamId: 'team-1', expectedCursor: 4 }))
      .toEqual({ teamId: 'team-1', expectedCursor: 4 })
    expect(teamHumanActionUpsertInputSchema.safeParse({
      teamId: 'team-1', expectedCursor: 4, action: pendingHumanAction,
    }).success).toBe(false)
    expect(teamHumanActionResolveInputSchema.parse({ teamId: 'team-1', expectedCursor: 4 }))
      .toEqual({ teamId: 'team-1', expectedCursor: 4 })
    expect(teamHumanActionResolveInputSchema.safeParse({
      teamId: 'team-1', expectedCursor: 4, phase: 'resolved', outcome: {},
    }).success).toBe(false)
    expect(teamSystemTaskLeaseProofSourceNameSchema.parse('team-scheduler-dag')).toBe('team-scheduler-dag')
    expect(teamSystemTaskLeaseProofSourceNameSchema.safeParse(' team-scheduler-dag').success).toBe(false)
    const taskLeaseScope = teamSystemTaskLeaseScopeSchema.parse({
      kind: 'scheduler-task-assign',
      teamId: 'team-1',
      taskId: 'task-1',
      expectedRevision: 3,
      participantId: 'participant-1',
      activationId: 'activation-1',
      wakeChannelId: 'channel-1',
      leaseDurationMs: 1_000,
    })
    expect(teamSystemTaskLeaseProofResolutionSchema.parse({
      sourceName: 'team-scheduler-dag', scope: taskLeaseScope,
    })).toEqual({ sourceName: 'team-scheduler-dag', scope: taskLeaseScope })
    expect(teamSystemTaskLeaseScopeSchema.parse({
      kind: 'scheduler-task-expire',
      teamId: 'team-1',
      taskId: 'task-1',
      expectedRevision: 3,
      attemptId: 'attempt-1',
    })).toMatchObject({ kind: 'scheduler-task-expire' })
    expect(teamSystemTaskLeaseScopeSchema.safeParse({
      ...taskLeaseScope,
      leaseDurationMs: 0,
    }).success).toBe(false)
    expect(teamSystemTaskLeaseProofResolutionSchema.safeParse({
      sourceName: 'team-scheduler-dag', scope: taskLeaseScope, proof: {},
    }).success).toBe(false)
    expect(teamSystemTaskControlProofSourceNameSchema.parse('team-run')).toBe('team-run')
    expect(teamSystemTaskControlProofSourceNameSchema.safeParse(' team-run').success).toBe(false)
    const taskControlCoordinator = {
      teamId: 'team-1', participantId: 'participant-1', activationId: 'activation-1', sessionId: 'session-1', provider: 'in-process',
    }
    const taskControlScope = teamSystemTaskControlScopeSchema.parse({
      kind: 'team-run-default-worker-owner-proposal',
      teamId: 'team-1',
      coordinator: taskControlCoordinator,
      taskId: 'task-1',
      expectedRevision: 3,
      proposedOwnerId: 'participant-2',
    })
    expect(teamSystemTaskControlProofResolutionSchema.parse({
      sourceName: 'team-run', scope: taskControlScope,
    })).toEqual({ sourceName: 'team-run', scope: taskControlScope })
    expect(teamSystemTaskControlScopeSchema.parse({
      kind: 'team-run-default-worker-cancel',
      teamId: 'team-1', coordinator: taskControlCoordinator, taskId: 'task-1', expectedRevision: 3,
    })).toMatchObject({ kind: 'team-run-default-worker-cancel' })
    expect(teamSystemTaskControlScopeSchema.safeParse({
      ...taskControlScope, expectedRevision: 0,
    }).success).toBe(false)
    expect(teamSystemTaskControlProofResolutionSchema.safeParse({
      sourceName: 'team-run', scope: taskControlScope, proof: {},
    }).success).toBe(false)
    expect(teamSystemRootCreationProofSourceNameSchema.parse('team-run')).toBe('team-run')
    expect(teamSystemRootCreationProofSourceNameSchema.safeParse(' team-run').success).toBe(false)
    const rootCreationScope = teamSystemRootCreationScopeSchema.parse({
      kind: 'team-run-root-create',
      goal: { objective: 'Create a root Team.', budgets: {} },
      rules: { productTemplate: { id: 'default-v1', version: 1 } },
      budgets: {},
    })
    expect(teamSystemRootCreationProofResolutionSchema.parse({
      sourceName: 'team-run', scope: rootCreationScope,
    })).toEqual({ sourceName: 'team-run', scope: rootCreationScope })
    expect(teamSystemRootCreationScopeSchema.safeParse({
      ...rootCreationScope, kind: 'not-a-root-create',
    }).success).toBe(false)
    expect(teamSystemRootCreationProofResolutionSchema.safeParse({
      sourceName: 'team-run', scope: rootCreationScope, proof: {},
    }).success).toBe(false)
    expect(teamSystemChildCreationProofSourceNameSchema.parse('team-child-delegation')).toBe('team-child-delegation')
    expect(teamSystemChildCreationProofSourceNameSchema.safeParse(' team-child-delegation').success).toBe(false)
    const childCreationScope = teamSystemChildCreationScopeSchema.parse({
      kind: 'team-child-create',
      delegationId: 'delegation-1',
      goal: { objective: 'Create a nested Team.', budgets: {} },
      rules: {}, budgets: {}, parentTeamId: 'team-1', parentTaskId: 'task-1', expectedParentCursor: 3,
    })
    expect(teamSystemChildCreationProofResolutionSchema.parse({
      sourceName: 'team-child-delegation', scope: childCreationScope,
    })).toEqual({ sourceName: 'team-child-delegation', scope: childCreationScope })
    expect(teamSystemChildCreationScopeSchema.safeParse({
      ...childCreationScope, expectedParentCursor: -1,
    }).success).toBe(false)
    expect(teamSystemChildCreationProofResolutionSchema.safeParse({
      sourceName: 'team-child-delegation', scope: childCreationScope, proof: {},
    }).success).toBe(false)
    expect(teamSystemChannelSummaryProofSourceNameSchema.parse('team-channel-summary')).toBe('team-channel-summary')
    expect(teamSystemChannelSummaryProofSourceNameSchema.safeParse(' team-channel-summary').success).toBe(false)
    const channelSummaryScope = teamSystemChannelSummaryScopeSchema.parse({
      kind: 'channel-summary', channelId: 'channel-1', expectedCursor: 3,
      coveredSequenceRange: { from: 1, to: 1 }, sourceEnvelopeIds: ['envelope-1'], sourceFingerprint: `sha256:${'0'.repeat(64)}`, text: 'One source.',
      policy: { type: 'summarized', version: 1 }, idempotencyKey: 'summary-1',
    })
    expect(teamSystemChannelSummaryProofResolutionSchema.parse({
      sourceName: 'team-channel-summary', scope: channelSummaryScope,
    })).toEqual({ sourceName: 'team-channel-summary', scope: channelSummaryScope })
    expect(teamSystemChannelSummaryScopeSchema.safeParse({
      ...channelSummaryScope, sourceEnvelopeIds: [],
    }).success).toBe(false)
    expect(teamSystemChannelSummaryProofResolutionSchema.safeParse({
      sourceName: 'team-channel-summary', scope: channelSummaryScope, proof: {},
    }).success).toBe(false)
    expect(teamSystemArchiveProofSourceNameSchema.parse('team-run')).toBe('team-run')
    expect(teamSystemArchiveProofSourceNameSchema.safeParse(' team-run').success).toBe(false)
    const archiveScope = teamSystemArchiveScopeSchema.parse({
      kind: 'team-run-terminal-archive', teamId: 'team-1', expectedCursor: 5,
    })
    expect(teamSystemArchiveProofResolutionSchema.parse({
      sourceName: 'team-run', scope: archiveScope,
    })).toEqual({ sourceName: 'team-run', scope: archiveScope })
    expect(teamSystemArchiveScopeSchema.safeParse({
      ...archiveScope, kind: 'not-a-terminal-archive',
    }).success).toBe(false)
    expect(teamSystemArchiveProofResolutionSchema.safeParse({
      sourceName: 'team-run', scope: archiveScope, proof: {},
    }).success).toBe(false)
    expect(teamSystemTopologyProofSourceNameSchema.parse('team-run')).toBe('team-run')
    expect(teamSystemTopologyProofSourceNameSchema.safeParse(' team-run').success).toBe(false)
    const topologyParticipant = {
      kind: 'local-agent', displayName: 'Reviewer', role: 'reviewer', capabilities: ['review'], preset: 'reviewer',
    }
    const topologyWorkerParticipant = {
      kind: 'local-agent', displayName: 'Worker 2', role: 'worker-2', capabilities: ['worker'],
    }
    const topologyInviteScope = teamSystemTopologyScopeSchema.parse({
      kind: 'team-run-bootstrap-participant-invite',
      teamId: 'team-1',
      expectedCursor: 3,
      participant: topologyParticipant,
    })
    expect(teamSystemTopologyProofResolutionSchema.parse({
      sourceName: 'team-run', scope: topologyInviteScope,
    })).toEqual({ sourceName: 'team-run', scope: topologyInviteScope })
    expect(teamSystemTopologyScopeSchema.parse({
      kind: 'team-run-bootstrap-participant-phase',
      teamId: 'team-1', participantId: 'participant-1', expectedCursor: 4, expectedPhase: 'invited', phase: 'provisioning',
    })).toMatchObject({ kind: 'team-run-bootstrap-participant-phase' })
    expect(teamSystemTopologyScopeSchema.parse({
      kind: 'team-run-bootstrap-channel-open',
      teamId: 'team-1',
      expectedCursor: 5,
      humanId: 'participant-human',
      coordinatorId: 'participant-coordinator',
      adapter: { type: 'direct', version: 3 },
      viewPolicy: { type: 'directed', version: 1 },
      participants: [
        { id: 'participant-human', role: 'human' },
        { id: 'participant-coordinator', role: 'coordinator' },
      ],
      limits: {},
    })).toMatchObject({ kind: 'team-run-bootstrap-channel-open' })
    expect(teamSystemTopologyScopeSchema.parse({
      kind: 'team-run-worker-activate',
      teamId: 'team-1', participantId: 'participant-worker', expectedCursor: 6, expectedPhase: 'provisioning', phase: 'active',
    })).toMatchObject({ kind: 'team-run-worker-activate' })
    expect(teamSystemTopologyScopeSchema.parse({
      kind: 'team-run-worker-invite', teamId: 'team-1', expectedCursor: 7, participant: topologyWorkerParticipant,
    })).toMatchObject({ kind: 'team-run-worker-invite', participant: { role: 'worker-2' } })
    expect(teamSystemTopologyScopeSchema.parse({
      kind: 'team-run-worker-retire', teamId: 'team-1', participantId: 'participant-worker-2',
      expectedCursor: 8, expectedPhase: 'active', phase: 'left',
    })).toMatchObject({ kind: 'team-run-worker-retire' })
    expect(teamSystemTopologyScopeSchema.parse({
      kind: 'team-run-reviewer-invite',
      teamId: 'team-1', expectedCursor: 9, participant: topologyParticipant,
    })).toMatchObject({ kind: 'team-run-reviewer-invite' })
    expect(teamSystemTopologyScopeSchema.parse({
      kind: 'team-run-reviewer-phase',
      teamId: 'team-1', participantId: 'participant-reviewer', expectedCursor: 10, expectedPhase: 'provisioning', phase: 'active',
    })).toMatchObject({ kind: 'team-run-reviewer-phase' })
    expect(teamSystemTopologyScopeSchema.safeParse({
      kind: 'team-run-bootstrap-participant-phase',
      teamId: 'team-1', participantId: 'participant-1', expectedCursor: 4, expectedPhase: 'invited', phase: 'active',
    }).success).toBe(false)
    expect(teamSystemTopologyScopeSchema.safeParse({
      kind: 'team-run-bootstrap-channel-open',
      teamId: 'team-1',
      expectedCursor: 5,
      humanId: 'participant-same',
      coordinatorId: 'participant-same',
      adapter: { type: 'direct', version: 3 },
      participants: [{ id: 'participant-same', role: 'human' }],
      limits: {},
    }).success).toBe(false)
    expect(teamSystemTopologyProofResolutionSchema.safeParse({
      sourceName: 'team-run', scope: topologyInviteScope, proof: {},
    }).success).toBe(false)
    expect(teamSystemSchedulerChannelProofSourceNameSchema.parse('team-scheduler-dag')).toBe('team-scheduler-dag')
    expect(teamSystemSchedulerChannelProofSourceNameSchema.safeParse(' team-scheduler-dag').success).toBe(false)
    const reviewChannelScope = teamSystemSchedulerChannelScopeSchema.parse({
      kind: 'scheduler-review-channel-open',
      teamId: 'team-1',
      expectedTeamCursor: 3,
      taskId: 'task-1',
      expectedRevision: 4,
      attemptId: 'attempt-1',
      initiatorId: 'participant-1',
      reviewerId: 'participant-2',
      reviewerActivationId: 'activation-2',
      reviewerSessionId: 'session-2',
      reviewerProvider: 'in-process',
    })
    expect(teamSystemSchedulerChannelProofResolutionSchema.parse({
      sourceName: 'team-scheduler-dag', scope: reviewChannelScope,
    })).toEqual({ sourceName: 'team-scheduler-dag', scope: reviewChannelScope })
    expect(schedulerReviewChannelOpenInputSchema.parse({
      teamId: 'team-1', expectedTeamCursor: 3, taskId: 'task-1', expectedRevision: 4, attemptId: 'attempt-1',
      initiatorId: 'participant-1', reviewerId: 'participant-2', reviewerActivationId: 'activation-2',
      reviewerSessionId: 'session-2', reviewerProvider: 'in-process',
    })).toMatchObject({ reviewerActivationId: 'activation-2' })
    expect(schedulerWakeChannelOpenInputSchema.parse({
      teamId: 'team-1', expectedTeamCursor: 3, taskId: 'task-1', expectedRevision: 4,
      participantId: 'participant-1', activationId: 'activation-1', sessionId: 'session-1',
    })).toMatchObject({ activationId: 'activation-1' })
    expect(schedulerFailedWakeChannelCloseInputSchema.parse({
      teamId: 'team-1', taskId: 'task-1', participantId: 'participant-1', activationId: 'activation-1',
      sessionId: 'session-1', channelId: 'channel-1', expectedChannelCursor: 2,
    })).toMatchObject({ expectedChannelCursor: 2 })
    const deliveryExpiryScope = teamSystemSchedulerChannelScopeSchema.parse({
      kind: 'scheduler-channel-delivery-expire',
      teamId: 'team-1',
      channelId: 'channel-1',
      expectedTeamCursor: 3,
      expectedChannelCursor: 4,
      now: 5,
      limit: 6,
    })
    expect(schedulerChannelDeliveryExpireInputSchema.parse({
      teamId: 'team-1',
      channelId: 'channel-1',
      expectedTeamCursor: 3,
      expectedChannelCursor: 4,
      now: 5,
      limit: 6,
    })).toEqual({
      teamId: 'team-1',
      channelId: 'channel-1',
      expectedTeamCursor: 3,
      expectedChannelCursor: 4,
      now: 5,
      limit: 6,
    })
    if (reviewChannelScope.kind !== 'scheduler-review-channel-open') {
      throw new Error('scheduler channel schema did not retain the review-open scope')
    }
    expect(teamSystemSchedulerChannelScopeSchema.safeParse({
      ...reviewChannelScope, reviewerId: reviewChannelScope.initiatorId,
    }).success).toBe(false)
    expect(teamSystemSchedulerChannelScopeSchema.safeParse({
      ...deliveryExpiryScope, limit: 0,
    }).success).toBe(false)
    expect(teamSystemSchedulerChannelProofResolutionSchema.safeParse({
      sourceName: 'team-scheduler-dag', scope: reviewChannelScope, proof: {},
    }).success).toBe(false)
    expect(teamSystemCancellationCleanupProofSourceNameSchema.parse('team-run')).toBe('team-run')
    expect(teamSystemCancellationCleanupProofSourceNameSchema.safeParse(' team-run').success).toBe(false)
    const cancellationCleanupScope = teamSystemCancellationCleanupScopeSchema.parse({
      kind: 'team-run-cancellation-task-cancel',
      teamId: 'team-1',
      cancellationIdempotencyKey: 'cancel-1',
      cancellationRequestedAt: 10,
      expectedTeamCursor: 12,
      taskId: 'task-1',
      expectedRevision: 3,
    })
    expect(teamSystemCancellationCleanupProofResolutionSchema.parse({
      sourceName: 'team-run', scope: cancellationCleanupScope,
    })).toEqual({ sourceName: 'team-run', scope: cancellationCleanupScope })
    expect(teamSystemCancellationCleanupScopeSchema.parse({
      kind: 'team-run-cancellation-channel-close',
      teamId: 'team-1',
      cancellationIdempotencyKey: 'cancel-1',
      cancellationRequestedAt: 10,
      expectedTeamCursor: 12,
      channelId: 'channel-1',
      expectedCursor: 0,
      reason: 'Team cancelled',
    })).toMatchObject({ kind: 'team-run-cancellation-channel-close' })
    expect(teamSystemCancellationCleanupScopeSchema.safeParse({
      ...cancellationCleanupScope, expectedTeamCursor: -1,
    }).success).toBe(false)
    expect(teamSystemCancellationCleanupProofResolutionSchema.safeParse({
      sourceName: 'team-run', scope: cancellationCleanupScope, proof: {},
    }).success).toBe(false)
    expect(teamSystemFinalizationCleanupProofSourceNameSchema.parse('team-run')).toBe('team-run')
    expect(teamSystemFinalizationCleanupProofSourceNameSchema.safeParse(' team-run').success).toBe(false)
    const finalizationCleanupScope = teamSystemFinalizationCleanupScopeSchema.parse({
      kind: 'team-run-finalization-channel-close',
      teamId: 'team-1',
      finalChannelId: 'channel-final',
      finalEnvelopeId: 'envelope-final',
      humanId: 'human-1',
      coordinatorId: 'coordinator-1',
      expectedTeamCursor: 12,
      channelId: 'channel-auxiliary',
      expectedCursor: 2,
      reason: 'parent Team completed',
    })
    expect(teamSystemFinalizationCleanupProofResolutionSchema.parse({
      sourceName: 'team-run', scope: finalizationCleanupScope,
    })).toEqual({ sourceName: 'team-run', scope: finalizationCleanupScope })
    expect(teamFinalizationChannelCloseInputSchema.parse({
      teamId: 'team-1',
      finalChannelId: 'channel-final',
      finalEnvelopeId: 'envelope-final',
      expectedTeamCursor: 12,
      channelId: 'channel-auxiliary',
      expectedCursor: 2,
      reason: 'parent Team completed',
    })).toMatchObject({ finalEnvelopeId: 'envelope-final' })
    expect(teamSystemFinalizationCleanupScopeSchema.safeParse({
      ...finalizationCleanupScope, humanId: finalizationCleanupScope.coordinatorId,
    }).success).toBe(false)
    expect(teamSystemFinalizationCleanupProofResolutionSchema.safeParse({
      sourceName: 'team-run', scope: finalizationCleanupScope, proof: {},
    }).success).toBe(false)
    expect(teamSystemWorkflowProofSourceNameSchema.parse('team-run')).toBe('team-run')
    expect(teamSystemWorkflowProofSourceNameSchema.safeParse(' team-run').success).toBe(false)
    const workflowCoordinator = {
      teamId: 'team-1', participantId: 'participant-1', activationId: 'activation-1', sessionId: 'session-1', provider: 'in-process',
    }
    const workflowScope = teamSystemWorkflowScopeSchema.parse({
      kind: 'team-run-workflow-channel-open',
      teamId: 'team-1',
      coordinator: workflowCoordinator,
      planId: 'workflow-plan-1',
      expectedCursor: 3,
      expectedRevision: 1,
      adapter: { type: 'workflow', version: 1 },
      participants: [
        { id: 'participant-1', role: 'coordinator' },
        { id: 'participant-2', role: 'worker' },
      ],
      limits: { graph: {} },
    })
    expect(teamSystemWorkflowProofResolutionSchema.parse({
      sourceName: 'team-run', scope: workflowScope,
    })).toEqual({ sourceName: 'team-run', scope: workflowScope })
    expect(teamSystemWorkflowScopeSchema.parse({
      kind: 'team-run-workflow-channel-bind',
      teamId: 'team-1', coordinator: workflowCoordinator, planId: 'workflow-plan-1', expectedCursor: 4, expectedRevision: 2, channelId: 'channel-1',
    })).toMatchObject({ kind: 'team-run-workflow-channel-bind' })
    expect(teamSystemWorkflowScopeSchema.parse({
      kind: 'team-run-workflow-task-bind',
      teamId: 'team-1', coordinator: workflowCoordinator, planId: 'workflow-plan-1', expectedCursor: 5, expectedRevision: 3, templateId: 'first', taskId: 'task-1',
    })).toMatchObject({ kind: 'team-run-workflow-task-bind' })
    expect(teamSystemWorkflowScopeSchema.parse({
      kind: 'team-run-workflow-plan-phase',
      teamId: 'team-1', coordinator: workflowCoordinator, planId: 'workflow-plan-1', expectedCursor: 6, expectedRevision: 4, phase: 'ready',
    })).toMatchObject({ kind: 'team-run-workflow-plan-phase' })
    expect(teamSystemWorkflowScopeSchema.parse({
      kind: 'team-run-workflow-channel-close',
      teamId: 'team-1', coordinator: workflowCoordinator, planId: 'workflow-plan-1', expectedTeamCursor: 7, expectedRevision: 4,
      channelId: 'channel-1', expectedCursor: 0, reason: 'Workflow channel did not bind.',
    })).toMatchObject({ kind: 'team-run-workflow-channel-close' })
    expect(teamSystemWorkflowScopeSchema.safeParse({
      kind: 'team-run-workflow-plan-phase',
      teamId: 'team-1', coordinator: workflowCoordinator, planId: 'workflow-plan-1', expectedCursor: 6, expectedRevision: 4, phase: 'cancelled',
    }).success).toBe(false)
    expect(teamSystemWorkflowProofResolutionSchema.safeParse({
      sourceName: 'team-run', scope: workflowScope, proof: {},
    }).success).toBe(false)
    expect(teamSystemTaskReviewProofSourceNameSchema.parse('team-scheduler-dag')).toBe('team-scheduler-dag')
    expect(teamSystemTaskReviewProofSourceNameSchema.safeParse(' team-scheduler-dag').success).toBe(false)
    const taskReviewScope = teamSystemTaskReviewScopeSchema.parse({
      kind: 'scheduler-review-response',
      teamId: 'team-1',
      taskId: 'task-1',
      expectedRevision: 3,
      attemptId: 'attempt-1',
      reviewerId: 'reviewer-1',
      initiatorId: 'initiator-1',
      channelId: 'channel-1',
      requestEnvelopeId: 'request-1',
      responseEnvelopeId: 'response-1',
      nextPhase: 'completed',
      reason: 'The result is accepted.',
    })
    expect(teamSystemTaskReviewProofResolutionSchema.parse({
      sourceName: 'team-scheduler-dag', scope: taskReviewScope,
    })).toEqual({ sourceName: 'team-scheduler-dag', scope: taskReviewScope })
    expect(teamSystemTaskReviewScopeSchema.safeParse({
      ...taskReviewScope, responseEnvelopeId: taskReviewScope.requestEnvelopeId,
    }).success).toBe(false)
    expect(teamSystemClosureProofSourceNameSchema.parse('team-run')).toBe('team-run')
    expect(teamSystemClosureProofSourceNameSchema.safeParse(' team-run').success).toBe(false)
    const closureScope = teamSystemClosureScopeSchema.parse({
      kind: 'team-run-complete',
      teamId: 'team-1',
      channelId: 'channel-1',
      humanId: 'human-1',
      coordinatorId: 'coordinator-1',
      finalEnvelopeId: 'envelope-1',
    })
    expect(teamSystemClosureProofResolutionSchema.parse({
      sourceName: 'team-run', scope: closureScope,
    })).toEqual({ sourceName: 'team-run', scope: closureScope })
    expect(teamSystemClosureScopeSchema.parse({
      kind: 'team-run-cancel',
      teamId: 'team-1',
      channelId: 'channel-1',
      humanId: 'human-1',
      coordinatorId: 'coordinator-1',
    })).toMatchObject({ kind: 'team-run-cancel' })
    expect(teamSystemClosureScopeSchema.parse({
      kind: 'team-run-create-failure', teamId: 'team-1',
    })).toMatchObject({ kind: 'team-run-create-failure' })
    expect(teamSystemClosureScopeSchema.safeParse({
      ...closureScope, humanId: 'coordinator-1',
    }).success).toBe(false)
    expect(teamSystemClosureProofResolutionSchema.safeParse({
      sourceName: 'team-run', scope: closureScope, proof: {},
    }).success).toBe(false)
    expect(teamSystemClosureDriverProofSourceNameSchema.parse('team-closure-driver')).toBe('team-closure-driver')
    expect(teamSystemClosureDriverProofSourceNameSchema.safeParse(' team-closure-driver').success).toBe(false)
    const closureDriverScope = teamSystemClosureDriverScopeSchema.parse({
      kind: 'closure-recover-complete',
      teamId: 'team-1',
      expectedCursor: 5,
      closureIdempotencyKey: 'complete-1',
      closureRequestedAt: 17,
      finalChannelId: 'channel-final',
      finalEnvelopeId: 'envelope-final',
    })
    expect(teamSystemClosureDriverProofResolutionSchema.parse({
      sourceName: 'team-closure-driver', scope: closureDriverScope,
    })).toEqual({ sourceName: 'team-closure-driver', scope: closureDriverScope })
    expect(teamSystemClosureDriverScopeSchema.parse({
      kind: 'closure-recover-fail',
      teamId: 'team-1',
      expectedCursor: 5,
      closureIdempotencyKey: 'fail-1',
      closureRequestedAt: 17,
    })).toMatchObject({ kind: 'closure-recover-fail' })
    expect(teamSystemClosureDriverScopeSchema.parse({
      kind: 'closure-recover-cancel',
      teamId: 'team-1',
      expectedCursor: 5,
      cancellationIdempotencyKey: 'cancel-1',
      cancellationRequestedAt: 17,
    })).toMatchObject({ kind: 'closure-recover-cancel' })
    expect(teamSystemClosureDriverScopeSchema.parse({
      kind: 'closure-stall-missing-final',
      teamId: 'team-1',
      expectedCursor: 5,
      coordinatorId: 'coordinator-1',
      activationId: 'activation-1',
      sessionId: 'session-1',
      provider: 'in-process',
      turn: 3,
      reason: { code: 'FINAL_ANSWER_MISSING', message: 'The coordinator turn ended without a final answer.' },
    })).toMatchObject({ kind: 'closure-stall-missing-final', turn: 3 })
    expect(teamSystemClosureDriverScopeSchema.parse({
      kind: 'closure-fail-turn',
      teamId: 'team-1',
      expectedCursor: 5,
      coordinatorId: 'coordinator-1',
      activationId: 'activation-1',
      sessionId: 'session-1',
      provider: 'in-process',
      turn: 3,
      reason: { code: 'MODEL_UNAVAILABLE', message: 'The model request failed.' },
    })).toMatchObject({ kind: 'closure-fail-turn', reason: { code: 'MODEL_UNAVAILABLE' } })
    expect(teamSystemClosureDriverScopeSchema.parse({
      kind: 'closure-stall-budget',
      teamId: 'team-1',
      expectedCursor: 5,
      reason: { code: 'TEAM_TOKEN_BUDGET_EXCEEDED', message: 'The Team token ceiling is exhausted.' },
    })).toMatchObject({ kind: 'closure-stall-budget' })
    expect(teamSystemClosureDriverScopeSchema.parse({
      kind: 'closure-stall-quiescing',
      teamId: 'team-1',
      expectedCursor: 5,
      reason: { code: 'TEAM_CLOSURE_INTENT_MISSING', message: 'No closure producer remains.' },
    })).toMatchObject({ kind: 'closure-stall-quiescing' })
    expect(teamSystemClosureDriverScopeSchema.safeParse({
      ...closureDriverScope,
      finalEnvelopeId: undefined,
    }).success).toBe(false)
    expect(teamSystemClosureDriverScopeSchema.safeParse({
      kind: 'closure-stall-missing-final',
      teamId: 'team-1', expectedCursor: 5,
      coordinatorId: 'coordinator-1', activationId: 'activation-1', sessionId: 'session-1', provider: 'in-process', turn: 3,
      reason: { code: 'OTHER', message: 'wrong trigger' },
    }).success).toBe(false)
    expect(teamClosureContinuationInputSchema.parse({ teamId: 'team-1', expectedCursor: 5 }))
      .toEqual({ teamId: 'team-1', expectedCursor: 5 })
    expect(teamSystemPhaseProofSourceNameSchema.parse('team-run')).toBe('team-run')
    expect(teamSystemPhaseProofSourceNameSchema.safeParse(' team-run').success).toBe(false)
    const resumeScope = teamSystemPhaseScopeSchema.parse({
      kind: 'team-run-resume', teamId: 'team-1', phase: 'active',
    })
    expect(teamSystemPhaseProofResolutionSchema.parse({
      sourceName: 'team-run', scope: resumeScope,
    })).toEqual({ sourceName: 'team-run', scope: resumeScope })
    const finalizationQuiesceScope = teamSystemPhaseScopeSchema.parse({
      kind: 'team-run-finalization-quiesce',
      teamId: 'team-1',
      expectedCursor: 4,
      phase: 'quiescing',
      finalChannelId: 'channel-final',
      finalEnvelopeId: 'envelope-final',
      humanId: 'human-1',
      coordinatorId: 'coordinator-1',
    })
    expect(teamSystemPhaseProofResolutionSchema.parse({
      sourceName: 'team-run', scope: finalizationQuiesceScope,
    })).toEqual({ sourceName: 'team-run', scope: finalizationQuiesceScope })
    if (finalizationQuiesceScope.kind !== 'team-run-finalization-quiesce') {
      throw new Error('phase schema did not retain the finalization quiesce scope')
    }
    const stallScope = teamSystemPhaseScopeSchema.parse({
      kind: 'scheduler-stall',
      teamId: 'team-1',
      phase: 'stalled',
      reason: { code: 'TASK_NO_ELIGIBLE_OWNER', message: 'Ready work has no eligible owner.' },
    })
    expect(teamSystemPhaseProofResolutionSchema.parse({
      sourceName: 'team-scheduler-dag', scope: stallScope,
    })).toEqual({ sourceName: 'team-scheduler-dag', scope: stallScope })
    const cancellationStallScope = teamSystemPhaseScopeSchema.parse({
      kind: 'activation-controller-cancellation-stall',
      teamId: 'team-1',
      expectedCursor: 5,
      phase: 'stalled',
      reason: { code: 'REMOTE_CANCELLATION_UNCONFIRMED', message: 'Remote termination is unconfirmed.' },
      cancellationIdempotencyKey: 'closure-cancellation-1',
      cancellationRequestedAt: 4,
      activationId: 'activation-remote-1',
      participantId: 'participant-remote-1',
      sessionId: 'session-remote-1',
      provider: 'sdk',
    })
    expect(teamSystemPhaseProofResolutionSchema.parse({
      sourceName: 'team-activation-controller', scope: cancellationStallScope,
    })).toEqual({ sourceName: 'team-activation-controller', scope: cancellationStallScope })
    expect(teamSystemPhaseScopeSchema.safeParse({
      ...resumeScope, phase: 'stalled',
    }).success).toBe(false)
    expect(teamSystemPhaseScopeSchema.safeParse({
      ...finalizationQuiesceScope, humanId: finalizationQuiesceScope.coordinatorId,
    }).success).toBe(false)
    expect(teamSystemPhaseScopeSchema.safeParse({
      kind: 'scheduler-stall', teamId: 'team-1', phase: 'stalled',
    }).success).toBe(false)
    expect(teamSystemPhaseScopeSchema.safeParse({
      ...cancellationStallScope, cancellationRequestedAt: -1,
    }).success).toBe(false)
    expect(teamSystemPhaseScopeSchema.safeParse({
      ...cancellationStallScope, reason: { code: 'OTHER', message: 'wrong reason' },
    }).success).toBe(false)
    expect(teamSystemPhaseProofResolutionSchema.safeParse({
      sourceName: 'team-run', scope: resumeScope, proof: {},
    }).success).toBe(false)
    expect(teamSystemMaintenanceProofSourceNameSchema.parse('team-scheduler-dag')).toBe('team-scheduler-dag')
    expect(teamSystemMaintenanceProofSourceNameSchema.safeParse(' team-scheduler-dag').success).toBe(false)
    const teamJournalCompactionScope = teamSystemMaintenanceScopeSchema.parse({
      kind: 'scheduler-team-journal-compaction',
      teamId: 'team-1',
      expectedCursor: 7,
      throughSequence: 4,
    })
    expect(teamSystemMaintenanceProofResolutionSchema.parse({
      sourceName: 'team-scheduler-dag', scope: teamJournalCompactionScope,
    })).toEqual({ sourceName: 'team-scheduler-dag', scope: teamJournalCompactionScope })
    expect(teamSystemMaintenanceScopeSchema.parse({
      kind: 'scheduler-channel-compaction',
      teamId: 'team-1',
      channelId: 'channel-1',
      expectedCursor: 7,
      throughSequence: 4,
    })).toMatchObject({ kind: 'scheduler-channel-compaction' })
    expect(teamSystemMaintenanceScopeSchema.safeParse({
      kind: 'scheduler-channel-compaction',
      teamId: 'team-1',
      channelId: 'channel-1',
      expectedCursor: -1,
      throughSequence: 4,
    }).success).toBe(false)
    expect(teamSystemMaintenanceProofResolutionSchema.safeParse({
      sourceName: 'team-scheduler-dag', scope: teamJournalCompactionScope, proof: {},
    }).success).toBe(false)
    expect(teamSystemInterruptProofSourceNameSchema.parse('team-run')).toBe('team-run')
    expect(teamSystemInterruptProofSourceNameSchema.safeParse(' team-run').success).toBe(false)
    const interruptScope = teamSystemInterruptScopeSchema.parse({
      kind: 'team-run-human-interrupt',
      teamId: 'team-1',
      channelId: 'channel-1',
      humanId: 'human-1',
      coordinatorId: 'coordinator-1',
    })
    expect(teamSystemInterruptProofResolutionSchema.parse({
      sourceName: 'team-run', scope: interruptScope,
    })).toEqual({ sourceName: 'team-run', scope: interruptScope })
    expect(teamSystemInterruptScopeSchema.safeParse({
      ...interruptScope, humanId: 'coordinator-1',
    }).success).toBe(false)
    expect(teamSystemInterruptProofResolutionSchema.safeParse({
      sourceName: 'team-run', scope: interruptScope, proof: {},
    }).success).toBe(false)
    const closureInput = {
      teamId: 'team-1',
      expectedCursor: 4,
      idempotencyKey: 'close-1',
      reason: { code: 'COMPLETE', message: 'The Team has finished.' },
    }
    expect(teamClosureInputSchema.parse(closureInput)).toEqual(closureInput)
    expect(teamCompleteInputSchema.parse({
      ...closureInput,
      finalChannelId: 'channel-1',
      finalEnvelopeId: 'envelope-1',
    })).toMatchObject({ finalChannelId: 'channel-1', finalEnvelopeId: 'envelope-1' })
    expect(teamFailInputSchema.parse(closureInput)).toEqual(closureInput)
    expect(teamCancelInputSchema.parse(closureInput)).toEqual(closureInput)
    expect(teamCompleteInputSchema.safeParse({
      ...closureInput,
      actor: { kind: 'system', name: 'team-run' },
      finalChannelId: 'channel-1',
      finalEnvelopeId: 'envelope-1',
    }).success).toBe(false)
    expect(participantCapabilitiesSchema.parse(['repository-read', 'review'])).toEqual(['repository-read', 'review'])
    expect(participantCapabilitiesSchema.safeParse(['review', 'review']).success).toBe(false)
  })
  it('accepts only closed lifecycle and policy vocabularies', () => {
    expect(teamPhaseSchema.parse('quiescing')).toBe('quiescing')
    expect(teamPhaseSchema.safeParse('paused').success).toBe(false)
    expect(teamGoalPhaseSchema.parse('blocked')).toBe('blocked')
    expect(teamGoalPhaseSchema.safeParse('cancelled').success).toBe(false)
    expect(teamPolicyHookSchema.parse('workspace-allocate')).toBe('workspace-allocate')
    expect(teamPolicyHookSchema.parse('workspace-integrate')).toBe('workspace-integrate')
    expect(teamPolicyHookSchema.parse('goal-mutate')).toBe('goal-mutate')
    expect(teamPolicyHookSchema.safeParse('shell').success).toBe(false)
    expect(teamPolicyDecisionSchema.parse({ kind: 'allow' })).toEqual({ kind: 'allow' })
    expect(teamPolicyDecisionSchema.parse({ kind: 'deny', code: 'denied', message: 'not allowed' }))
      .toEqual({ kind: 'deny', code: 'denied', message: 'not allowed' })
  })
  it('accepts only monotonic durable lifecycle transitions', () => {
    expect(() => { assertTeamPhaseTransition(undefined, 'provisioning') }).not.toThrow()
    expect(() => { assertTeamPhaseTransition('provisioning', 'quiescing') }).not.toThrow()
    expect(() => { assertTeamPhaseTransition('completed', 'active') }).toThrow(/lifecycle rejects/)
    expect(() => { assertTeamPhaseTransition('active', 'failed') }).toThrow(/lifecycle rejects/)
    expect(() => { assertTeamPhaseTransition('active', 'cancelled') }).toThrow(/lifecycle rejects/)
    expect(() => { assertTeamPhaseTransition('stalled', 'failed') }).toThrow(/lifecycle rejects/)
    expect(() => { assertTeamGoalPhaseTransition(undefined, 'active') }).not.toThrow()
    expect(() => { assertTeamGoalPhaseTransition('active', 'blocked') }).not.toThrow()
    expect(() => { assertTeamGoalPhaseTransition('blocked', 'paused') }).not.toThrow()
    expect(() => { assertTeamGoalPhaseTransition('complete', 'active') }).toThrow(/lifecycle rejects/)
    expect(() => { assertParticipantPhaseTransition('invited', 'provisioning') }).not.toThrow()
    expect(() => { assertParticipantPhaseTransition('left', 'active') }).toThrow(/lifecycle rejects/)
    expect(() => { assertChannelPhaseTransition(undefined, 'pending') }).not.toThrow()
    expect(() => { assertChannelPhaseTransition(undefined, 'active') }).toThrow(/initial/)
    expect(() => { assertChannelPhaseTransition('active', 'pending') }).toThrow(/lifecycle rejects/)
    expect(() => { assertTeamTaskPhaseTransition('running', 'review') }).not.toThrow()
    expect(() => { assertTeamTaskPhaseTransition('running', 'completed') }).not.toThrow()
    expect(() => { assertTeamTaskPhaseTransition('assigned', 'failed') }).not.toThrow()
    expect(() => { assertTeamTaskPhaseTransition('completed', 'review') }).toThrow(/lifecycle rejects/)
    expect(() => { assertActivationStatusTransition(undefined, 'idle') }).not.toThrow()
    expect(() => { assertActivationStatusTransition('idle', 'running') }).not.toThrow()
    expect(() => { assertActivationStatusTransition('running', 'stopping') }).not.toThrow()
    expect(() => { assertActivationStatusTransition('stopping', 'offline') }).not.toThrow()
    expect(() => { assertActivationStatusTransition('offline', 'idle') }).toThrow(/lifecycle rejects/)
  })
  it('parses fenced task attempts and rejects invalid lease, history, and outcome facts', () => {
    const lease = {
      attemptId: 'attempt-1',
      assignedRevision: 2,
      ordinal: 1,
      participantId: 'participant-1',
      activationId: 'activation-1',
      assignedAt: 10,
      startedAt: 12,
      durationMs: 20,
      renewedAt: 15,
      expiresAt: 35,
    }
    expect(taskLeaseSnapshotSchema.parse(lease)).toEqual(lease)
    const { startedAt: _startedAt, ...unstartedLease } = lease
    expect(taskLeaseSnapshotSchema.parse(unstartedLease)).toEqual(unstartedLease)
    const { activationId: _leaseActivationId, ...unboundLease } = lease
    expect(taskLeaseSnapshotSchema.parse(unboundLease)).toEqual(unboundLease)
    expect(taskLeaseSnapshotSchema.safeParse({ ...lease, renewedAt: 9, expiresAt: 29 }).success).toBe(false)
    expect(taskLeaseSnapshotSchema.safeParse({ ...lease, startedAt: 9 }).success).toBe(false)
    expect(taskLeaseSnapshotSchema.safeParse({ ...lease, expiresAt: 36 }).success).toBe(false)
    expect(taskLeaseSnapshotSchema.safeParse({ ...lease, startedAt: 36 }).success).toBe(false)
    expect(taskLeaseSnapshotSchema.safeParse({ ...lease, assignedRevision: 0 }).success).toBe(false)
    const settled = {
      id: 'attempt-1',
      teamId: 'team-1',
      taskId: 'task-1',
      ordinal: 1,
      participantId: 'participant-1',
      activationId: 'activation-1',
      assignedAt: 10,
      startedAt: 12,
      leaseExpiresAt: 35,
      settledAt: 34,
      outcome: { kind: 'completed' as const, result: { summary: 'Reviewed the changed files.' } },
    }
    expect(taskAttemptSnapshotSchema.parse(settled)).toEqual(settled)
    const { startedAt: _settledStartedAt, ...unstartedAttempt } = settled
    expect(taskAttemptSnapshotSchema.parse(unstartedAttempt)).toEqual(unstartedAttempt)
    const { activationId: _attemptActivationId, ...unboundAttempt } = settled
    expect(taskAttemptSnapshotSchema.parse(unboundAttempt)).toEqual(unboundAttempt)
    expect(taskAttemptSnapshotSchema.safeParse({ ...settled, leaseExpiresAt: 10 }).success).toBe(false)
    expect(taskAttemptSnapshotSchema.safeParse({ ...settled, startedAt: 9 }).success).toBe(false)
    expect(taskAttemptSnapshotSchema.safeParse({ ...settled, startedAt: 36 }).success).toBe(false)
    expect(taskAttemptSnapshotSchema.safeParse({ ...settled, settledAt: 9 }).success).toBe(false)
    expect(taskAttemptSnapshotSchema.safeParse({ ...settled, settledAt: 11 }).success).toBe(false)
    expect(taskAttemptSnapshotSchema.safeParse({ ...settled, settledAt: 35 }).success).toBe(false)
    expect(taskAttemptSnapshotSchema.safeParse({
      ...settled, outcome: { kind: 'lease-expired' }, settledAt: 34,
    }).success).toBe(false)
    expect(taskAttemptSnapshotSchema.parse({
      ...settled, outcome: { kind: 'lease-expired' }, settledAt: 35,
    })).toMatchObject({ outcome: { kind: 'lease-expired' }, settledAt: 35 })
    expect(taskAttemptOutcomeSchema.parse({ kind: 'released' })).toEqual({ kind: 'released' })
    expect(taskAttemptOutcomeSchema.parse({ kind: 'lease-expired' })).toEqual({ kind: 'lease-expired' })
    expect(taskAttemptFailureSchema.parse({ code: 'model-unavailable', message: 'model unavailable' }))
      .toEqual({ code: 'model-unavailable', message: 'model unavailable' })
    expect(taskAttemptResultSchema.parse({ summary: 'Reviewed the changed files.' }))
      .toEqual({ summary: 'Reviewed the changed files.' })
    const integrationSpec = {
      sourceTaskId: 'source-task',
      sourceAttemptId: 'source-attempt',
      provider: 'worktree',
      target: 'main',
      expectedTarget: 'base-commit',
      mode: 'integrate' as const,
    }
    expect(teamTaskIntegrationSpecSchema.parse(integrationSpec)).toEqual(integrationSpec)
    const integrationResult = {
      target: 'main',
      expectedTarget: 'base-commit',
      status: 'integrated' as const,
      targetVersion: 'merged-commit',
      verification: 'tests passed',
      artifacts: [{ id: 'artifact-1', kind: 'patch' as const, uri: 'artifact://patch', visibility: 'team' as const }],
    }
    expect(taskAttemptIntegrationResultSchema.parse(integrationResult)).toEqual(integrationResult)
    expect(taskAttemptResultSchema.parse({ summary: 'Integrated the source task.', integration: integrationResult }))
      .toMatchObject({ integration: { status: 'integrated', targetVersion: 'merged-commit' } })
    expect(taskAttemptIntegrationResultSchema.safeParse({ target: 'main', status: 'integrated' }).success).toBe(false)
    expect(taskAttemptIntegrationResultSchema.safeParse({
      target: 'main', status: 'proposed', targetVersion: 'proposal-commit',
    }).success).toBe(false)
    expect(taskAttemptIntegrationResultSchema.safeParse({ target: 'main', status: 'conflict' }).success).toBe(false)
    expect(taskAttemptIntegrationResultSchema.safeParse({
      target: 'main', expectedTarget: 'base-commit', status: 'conflict',
    }).success).toBe(true)
    expect(taskAttemptIntegrationResultSchema.safeParse({
      target: 'main', status: 'conflict', conflictPaths: ['README.md'], targetVersion: 'merged-commit',
    }).success).toBe(false)
    expect(taskAttemptOutcomeSchema.parse({
      kind: 'failed', failure: { code: 'model-unavailable', message: 'model unavailable' },
    })).toEqual({ kind: 'failed', failure: { code: 'model-unavailable', message: 'model unavailable' } })
    expect(taskAttemptOutcomeSchema.parse({
      kind: 'completed', result: { summary: 'Reviewed the changed files.' },
    })).toEqual({ kind: 'completed', result: { summary: 'Reviewed the changed files.' } })
    expect(taskAttemptOutcomeSchema.parse({ kind: 'cancelled' })).toEqual({ kind: 'cancelled' })
    expect(taskAttemptOutcomeSchema.safeParse({ kind: 'failed' }).success).toBe(false)
    expect(taskAttemptOutcomeSchema.safeParse({ kind: 'completed' }).success).toBe(false)
    const activeTask = {
      execution: { kind: 'participant' as const },
      id: 'task-1',
      teamId: 'team-1',
      revision: 3,
      subject: 'inspect the patch',
      description: 'Read the changed files and report durable findings.',
      phase: 'running' as const,
      blockedBy: [],
      requiredCapabilities: ['repository-read'],
      priority: 1,
      readScopes: ['packages/core/team'],
      writeScopes: ['packages/core/team'],
      workspaceMode: 'shared' as const,
      budget: { maxTurns: 4 },
      reviewPolicy: { kind: 'participant' as const, reviewerId: 'participant-2' },
      reviewHistory: [],
      createCommand: {
        creator: {
          teamId: 'team-1', participantId: 'participant-1', activationId: 'activation-1', sessionId: 'session-1', provider: 'in-process',
        },
        idempotencyKey: 'task-create-1',
      },
      maxAttempts: 3,
      attemptCount: 1,
      attemptHistory: [],
      lease,
    }
    expect(teamTaskSnapshotSchema.parse(activeTask)).toEqual(activeTask)
    const commandTask = activeTask
    expect(teamTaskSnapshotSchema.parse(commandTask)).toEqual(commandTask)
    const humanCreator = { teamId: 'team-1', participantId: 'participant-human' }
    expect(teamHumanTaskCreatorSchema.parse(humanCreator)).toEqual(humanCreator)
    expect(teamTaskCommandCreatorSchema.parse(humanCreator)).toEqual(humanCreator)
    expect(teamTaskCreateCommandSchema.parse({
      creator: humanCreator,
      idempotencyKey: 'task-create-human',
    })).toEqual({ creator: humanCreator, idempotencyKey: 'task-create-human' })
    expect(teamTaskCommandCreatorSchema.safeParse({ ...humanCreator, activationId: 'forged-activation' }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...commandTask,
      createCommand: { ...commandTask.createCommand, creator: { ...commandTask.createCommand.creator, teamId: 'team-2' } },
    }).success).toBe(false)
    const { createCommand: _createCommand, ...withoutCreateCommand } = activeTask
    expect(teamTaskSnapshotSchema.safeParse(withoutCreateCommand).success).toBe(false)
    expect(teamTaskSnapshotSchema.parse({
      ...activeTask,
      revision: 2,
      phase: 'assigned',
      lease: unstartedLease,
    })).toMatchObject({ phase: 'assigned', lease: { attemptId: 'attempt-1' } })
    expect(teamTaskSnapshotSchema.safeParse({ ...activeTask, phase: 'assigned' }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...activeTask,
      lease: unstartedLease,
    }).success).toBe(false)
    const { lease: _lease, ...settledTaskBase } = activeTask
    const settledTask = { ...settledTaskBase, phase: 'review' as const, attemptHistory: [settled] }
    expect(teamTaskSnapshotSchema.parse(settledTask)).toEqual(settledTask)
    expect(teamTaskReviewPolicySchema.parse({ kind: 'none' })).toEqual({ kind: 'none' })
    expect(teamTaskReviewPolicySchema.parse({ kind: 'participant', reviewerId: 'participant-2' }))
      .toEqual({ kind: 'participant', reviewerId: 'participant-2' })
    expect(teamTaskReviewPolicySchema.safeParse({ kind: 'participant' }).success).toBe(false)
    const decision = {
      attemptId: settled.id,
      reviewerId: 'participant-2',
      nextPhase: 'completed' as const,
      reason: 'The submitted result meets the review criteria.',
      decidedAt: 34,
    }
    expect(teamTaskReviewDecisionSchema.parse(decision)).toEqual(decision)
    expect(teamTaskReviewDecisionSchema.safeParse({ ...decision, reason: '' }).success).toBe(false)
    const reviewedCompleted = {
      ...settledTask,
      revision: settledTask.revision + 1,
      phase: 'completed' as const,
      reviewHistory: [decision],
    }
    expect(teamTaskSnapshotSchema.parse(reviewedCompleted)).toEqual(reviewedCompleted)
    expect(teamTaskSnapshotSchema.safeParse({
      ...settledTask,
      reviewHistory: [decision],
    }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...reviewedCompleted,
      reviewHistory: [{ ...decision, reviewerId: 'participant-3' }],
    }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...reviewedCompleted,
      reviewHistory: [{ ...decision, attemptId: 'attempt-missing' }],
    }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...reviewedCompleted,
      reviewHistory: [{ ...decision, decidedAt: settled.settledAt - 1 }],
    }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...reviewedCompleted,
      reviewHistory: [decision, { ...decision, decidedAt: decision.decidedAt + 1 }],
    }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...reviewedCompleted,
      reviewPolicy: { kind: 'none' },
    }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...settledTask,
      reviewPolicy: { kind: 'none' },
    }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...settledTask,
      revision: settledTask.revision + 1,
      phase: 'completed',
    }).success).toBe(false)
    for (const phase of ['pending', 'failed', 'deleted'] as const) {
      expect(teamTaskSnapshotSchema.safeParse({
        ...settledTask,
        revision: settledTask.revision + 1,
        phase,
      }).success).toBe(false)
    }
    expect(teamTaskSnapshotSchema.parse({
      ...settledTask,
      revision: settledTask.revision + 1,
      phase: 'cancelled',
    })).toMatchObject({ phase: 'cancelled' })
    const secondSettled = {
      ...settled,
      id: 'attempt-2',
      ordinal: 2,
      assignedAt: 40,
      startedAt: 42,
      leaseExpiresAt: 65,
      settledAt: 54,
    }
    const reworkDecision = { ...decision, nextPhase: 'pending' as const }
    const secondDecision = {
      ...decision,
      attemptId: secondSettled.id,
      nextPhase: 'pending' as const,
      decidedAt: secondSettled.settledAt,
    }
    const reviewedTwice = {
      ...settledTask,
      revision: settledTask.revision + 2,
      phase: 'pending' as const,
      attemptCount: 2,
      attemptHistory: [settled, secondSettled],
      reviewHistory: [reworkDecision, secondDecision],
    }
    expect(teamTaskSnapshotSchema.parse(reviewedTwice)).toEqual(reviewedTwice)
    expect(teamTaskSnapshotSchema.safeParse({
      ...reviewedTwice,
      reviewHistory: [secondDecision, reworkDecision],
    }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...reviewedTwice,
      phase: 'review',
      reviewHistory: [],
    }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...reviewedTwice,
      phase: 'review',
      reviewHistory: [secondDecision],
    }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({ ...activeTask, attemptCount: 0 }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...activeTask,
      lease: { ...lease, assignedRevision: activeTask.revision + 1 },
    }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({ ...activeTask, revision: lease.assignedRevision }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...activeTask,
      maxAttempts: 1,
      attemptCount: 2,
      attemptHistory: [settled],
      lease: { ...lease, attemptId: 'attempt-2', ordinal: 2 },
    }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({ ...settledTaskBase, attemptCount: 0 }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...settledTask,
      attemptHistory: [{ ...settled, teamId: 'team-2' }],
    }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...settledTask,
      attemptHistory: [{ ...settled, taskId: 'task-2' }],
    }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...settledTask,
      attemptHistory: [{ ...settled, ordinal: 2 }],
    }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...settledTask,
      attemptCount: 2,
      attemptHistory: [settled, { ...settled, ordinal: 2 }],
    }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...activeTask,
      lease: { ...lease, ordinal: 2 },
    }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({
      ...activeTask,
      attemptCount: 2,
      attemptHistory: [settled],
      lease: { ...lease, ordinal: 2 },
    }).success).toBe(false)
    for (const workspaceMode of ['shared', 'worktree', 'sandbox', 'remote']) {
      expect(teamTaskWorkspaceModeSchema.parse(workspaceMode)).toBe(workspaceMode)
    }
    expect(teamTaskWorkspaceModeSchema.safeParse('container').success).toBe(false)
  })
  it('parses detached Team and channel views plus provider-minted operation requests', () => {
    const goal = {
      teamId: 'team-1',
      revision: 1,
      objective: 'ship the Hub',
      phase: 'active' as const,
      budgets: { maxGoalTurns: 8 },
    }
    expect(teamGoalSnapshotSchema.parse(goal)).toEqual(goal)
    expect(teamGoalSeedSchema.parse({ objective: goal.objective, budgets: goal.budgets }))
      .toEqual({ objective: goal.objective, budgets: goal.budgets })
    expect(teamGoalBlockerSchema.parse({ code: 'needs-input', message: 'Choose a deployment target.' }))
      .toEqual({ code: 'needs-input', message: 'Choose a deployment target.' })
    expect(teamGoalSnapshotSchema.parse({
      ...goal,
      revision: 2,
      phase: 'blocked',
      blocker: { code: 'needs-input', message: 'Choose a deployment target.' },
    })).toMatchObject({ phase: 'blocked', blocker: { code: 'needs-input' } })
    expect(teamGoalSnapshotSchema.safeParse({ ...goal, blocker: { code: 'unexpected', message: 'unexpected' } }).success)
      .toBe(false)
    expect(teamGoalSnapshotSchema.safeParse({ ...goal, phase: 'blocked' }).success).toBe(false)
    expect(teamGoalUpdateInputSchema.parse({
      teamId: 'team-1', expectedRevision: 1, objective: 'Ship the local Hub.',
    })).toMatchObject({ expectedRevision: 1, objective: 'Ship the local Hub.' })
    expect(teamGoalUpdateInputSchema.parse({
      teamId: 'team-1', expectedRevision: 1, budgets: { maxGoalTurns: 12 },
    })).toMatchObject({ budgets: { maxGoalTurns: 12 } })
    expect(teamGoalUpdateInputSchema.safeParse({
      teamId: 'team-1', expectedRevision: 1,
    }).success).toBe(false)
    expect(teamGoalUpdateInputSchema.safeParse({
      teamId: 'team-1', participantId: 'participant-1', expectedRevision: 1, objective: 'Raw participant.',
    }).success).toBe(false)
    expect(teamGoalUpdateInputSchema.safeParse({
      teamId: 'team-1', actor: {}, expectedRevision: 1, objective: 'Serialized actor.',
    }).success).toBe(false)
    expect(teamGoalPhaseTransitionInputSchema.parse({
      teamId: 'team-1', expectedRevision: 1, phase: 'blocked',
      blocker: { code: 'needs-input', message: 'Choose a deployment target.' },
    })).toMatchObject({ phase: 'blocked' })
    expect(teamGoalPhaseTransitionInputSchema.parse({
      teamId: 'team-1', expectedRevision: 1, phase: 'complete',
    })).toMatchObject({ phase: 'complete' })
    expect(teamGoalPhaseTransitionInputSchema.safeParse({
      teamId: 'team-1', expectedRevision: 1, phase: 'blocked',
    }).success).toBe(false)
    expect(teamGoalPhaseTransitionInputSchema.safeParse({
      teamId: 'team-1', participantId: 'participant-1', expectedRevision: 1,
      phase: 'active', blocker: { code: 'unexpected', message: 'unexpected' },
    }).success).toBe(false)
    expect(teamGoalPhaseTransitionInputSchema.safeParse({
      teamId: 'team-1', actor: {}, expectedRevision: 1, phase: 'complete',
    }).success).toBe(false)
    const task = {
      execution: { kind: 'participant' as const },
      id: 'task-1',
      teamId: 'team-1',
      revision: 1,
      subject: 'inspect the patch',
      description: 'Read the changed files and report durable findings.',
      phase: 'pending' as const,
      blockedBy: [],
      requiredCapabilities: ['repository-read'],
      priority: 1,
      readScopes: ['packages/core/team'],
      writeScopes: ['packages/core/team'],
      workspaceMode: 'shared' as const,
      budget: { maxTurns: 4 },
      reviewPolicy: { kind: 'none' as const },
      reviewHistory: [],
      createCommand: {
        creator: {
          teamId: 'team-1', participantId: 'participant-1', activationId: 'activation-1', sessionId: 'session-1', provider: 'in-process',
        },
        idempotencyKey: 'task-create-state',
      },
      maxAttempts: 3,
      attemptCount: 0,
      attemptHistory: [],
    }
    const state = teamStateSnapshotSchema.parse({
      team: {
        id: 'team-1', depth: 0, maxTeamDepth: 2,
        goal, phase: 'active', cursor: 4, createdAt: 1, updatedAt: 4,
      },
      goal,
      rules: { maxParticipants: 4 },
      budgets: { maxTasks: 12 },
      participants: [{
        id: 'participant-1', teamId: 'team-1', kind: 'human', displayName: 'owner', role: 'coordinator', capabilities: [], phase: 'active',
        owner: { kind: 'system' },
      }],
      activations: [],
      tasks: [task],
      workspaceAllocations: [],
      channelIds: ['channel-1'],
    })
    expect(state.tasks[0]).toEqual(task)
    expect(teamListPageRequestSchema.parse({ afterCursor: -1, limit: 2 })).toEqual({ afterCursor: -1, limit: 2 })
    expect(teamListPageSchema.parse({ items: [state.team], scanned: 1, nextCursor: 'next-page' }))
      .toMatchObject({ nextCursor: 'next-page' })
    expect(teamMemberListPageRequestSchema.parse({ teamId: 'team-1', afterCursor: -1, limit: 2 }))
      .toEqual({ teamId: 'team-1', afterCursor: -1, limit: 2 })
    expect(teamMemberListPageSchema.parse({ items: state.participants, nextCursor: 0 })).toMatchObject({ nextCursor: 0 })
    expect(teamTaskListPageRequestSchema.parse({ teamId: 'team-1', afterCursor: -1, limit: 2 }))
      .toEqual({ teamId: 'team-1', afterCursor: -1, limit: 2 })
    expect(teamTaskListPageSchema.parse({ items: state.tasks, nextCursor: 0 })).toMatchObject({ nextCursor: 0 })
    expect(teamStateSnapshotSchema.safeParse({
      ...state,
      goal: { ...state.goal, revision: state.goal.revision + 1 },
    }).success).toBe(false)
    expect(teamTaskSnapshotSchema.safeParse({ ...task, description: undefined }).success).toBe(false)
    expect(teamEventSchema.parse({
      type: 'task/changed', task, cursor: 5, createdAt: 5,
    })).toMatchObject({ type: 'task/changed', task: { attemptCount: 0, attemptHistory: [] } })
    const channel = channelSnapshotSchema.parse({ manifest, phase: 'active', cursor: 2, replayWatermark: 1 })
    expect(channel.manifest.id).toBe('channel-1')
    expect(channel.replayWatermark).toBe(1)
    const read = channelReadResultSchema.parse({
      channel,
      records: [
        { type: 'channel/opened', sequence: 1, createdAt: 1, manifest },
        { type: 'channel/phase', sequence: 2, createdAt: 2, phase: 'active' },
      ],
    })
    expect(read.records).toHaveLength(2)
    expect(channelReadPageRequestSchema.parse({ channelId: 'channel-1', afterCursor: -1, limit: 1 }))
      .toEqual({ channelId: 'channel-1', afterCursor: -1, limit: 1 })
    expect(channelReadPageResultSchema.parse({ ...read, nextCursor: 1 })).toMatchObject({ nextCursor: 1 })
    expect(teamChannelCompactInputSchema.parse({
      teamId: 'team-1',
      channelId: 'channel-1',
      expectedCursor: 2,
      throughSequence: 1,
    })).toMatchObject({ throughSequence: 1 })
    expect(teamChannelCompactInputSchema.safeParse({
      teamId: 'team-1',
      channelId: 'channel-1',
      actor: { kind: 'system', name: 'retention' },
      expectedCursor: 2,
      throughSequence: 1,
    }).success).toBe(false)
    expect(teamChannelCompactResultSchema.parse({
      channel: read.channel,
      compactedThrough: 1,
      auditCompactedThrough: 0,
    })).toMatchObject({ compactedThrough: 1, auditCompactedThrough: 0 })
    expect(teamJournalCompactInputSchema.parse({
      teamId: 'team-1',
      expectedCursor: state.team.cursor,
      throughSequence: 1,
    })).toMatchObject({ throughSequence: 1 })
    expect(teamJournalCompactInputSchema.safeParse({
      teamId: 'team-1',
      actor: { kind: 'system', name: 'retention' },
      expectedCursor: state.team.cursor,
      throughSequence: 1,
    }).success).toBe(false)
    expect(teamJournalCompactResultSchema.parse({
      team: state,
      compactedThrough: 1,
      auditCompactedThrough: 0,
    })).toMatchObject({ compactedThrough: 1, auditCompactedThrough: 0 })
    const expiry = {
      type: 'channel/delivery-expired' as const,
      sequence: 3,
      createdAt: 10,
      participantId: 'participant-1',
      envelopeId: 'envelope-1',
      envelopeSequence: 2,
    }
    expect(channelDeliveryExpiredRecordSchema.parse(expiry)).toEqual(expiry)
    expect(channelDeliveryExpireResultSchema.parse({ channel, expired: [expiry] })).toMatchObject({ expired: [expiry] })
    const summary = {
      type: 'channel/summary' as const,
      sequence: 4,
      createdAt: 11,
      coveredSequenceRange: { from: 1, to: 2 },
      sourceEnvelopeIds: ['envelope-1', 'envelope-2'], sourceFingerprint: `sha256:${'0'.repeat(64)}`,
      text: 'A durable summary.',
      policy: { type: 'summarized-window', version: 1 },
      idempotencyKey: channelSummaryIdempotencyKeySchema.parse('summary-1'),
    }
    expect(channelSummaryRecordSchema.parse(summary)).toEqual(summary)
    expect(channelSummarizeInputSchema.parse({
      channelId: 'channel-1',
      expectedCursor: 3,
      coveredSequenceRange: summary.coveredSequenceRange,
      sourceEnvelopeIds: summary.sourceEnvelopeIds, sourceFingerprint: summary.sourceFingerprint,
      text: summary.text,
      policy: summary.policy,
      idempotencyKey: summary.idempotencyKey,
    })).toMatchObject({ idempotencyKey: 'summary-1', expectedCursor: 3 })
    expect(channelSummarizeInputSchema.safeParse({
      channelId: 'channel-1', expectedCursor: 3, coveredSequenceRange: summary.coveredSequenceRange,
      sourceEnvelopeIds: summary.sourceEnvelopeIds,
      sourceFingerprint: summary.sourceFingerprint, text: summary.text, policy: summary.policy,
      idempotencyKey: summary.idempotencyKey, actor: {},
    }).success).toBe(false)
    const rootTeamInput = {
      goal: { objective: 'ship the Hub', budgets: { maxGoalTurns: 8 } }, rules: { maxParticipants: 4 }, budgets: { maxTasks: 12 },
    }
    expect(teamRootCreateInputSchema.parse(rootTeamInput)).not.toHaveProperty('teamId')
    expect(teamCreationActorSchema.parse({ kind: 'system', name: 'team-run' })).toEqual({ kind: 'system', name: 'team-run' })
    expect(teamCreationActorSchema.safeParse({ kind: 'participant', participantId: 'participant-1' }).success).toBe(false)
    expect(teamRootCreateInputSchema.safeParse({ ...rootTeamInput, parentTeamId: 'team-1', parentTaskId: 'task-1' }).success).toBe(false)
    expect(teamRootCreateInputSchema.safeParse({ ...rootTeamInput, actor: {} }).success).toBe(false)
    expect(teamCreateRequestSchema.parse(rootTeamInput)).not.toHaveProperty('teamId')
    const childTeamInput = {
      delegationId: 'delegation-1',
      parentTeamId: 'team-1', parentTaskId: 'task-1',
      goal: { objective: 'review a focused change', budgets: {} }, rules: {}, budgets: {},
    }
    expect(teamChildCreateInputSchema.parse(childTeamInput)).toMatchObject({ parentTeamId: 'team-1', parentTaskId: 'task-1' })
    expect(teamCreateRequestSchema.parse(childTeamInput)).toMatchObject({ parentTeamId: 'team-1', parentTaskId: 'task-1' })
    expect(teamChildCreateInputSchema.safeParse({ ...childTeamInput, parentTaskId: undefined }).success).toBe(false)
    expect(teamCreateRequestSchema.safeParse({
      delegationId: 'delegation-1', parentTeamId: 'team-1', goal: { objective: 'missing parent task', budgets: {} }, rules: {}, budgets: {},
    }).success).toBe(false)
    expect(teamCreateRequestSchema.safeParse({
      delegationId: 'delegation-1', parentTaskId: 'task-1', goal: { objective: 'missing parent Team', budgets: {} }, rules: {}, budgets: {},
    }).success).toBe(false)
    const childTeam = teamSnapshotSchema.parse({
      id: 'child-team-1', parentTeamId: 'team-1', parentTaskId: 'task-1', depth: 1, maxTeamDepth: 2,
      goal: { teamId: 'child-team-1', revision: 1, objective: 'review a focused change', phase: 'active', budgets: {} },
      phase: 'active', cursor: 1, createdAt: 1, updatedAt: 1,
    })
    expect(childTeam).toMatchObject({ parentTeamId: 'team-1', parentTaskId: 'task-1', depth: 1, maxTeamDepth: 2 })
    expect(teamSnapshotSchema.safeParse({ ...childTeam, parentTaskId: undefined }).success).toBe(false)
    expect(teamSnapshotSchema.safeParse({ ...childTeam, depth: 0 }).success).toBe(false)
    expect(teamSnapshotSchema.safeParse({ ...childTeam, maxTeamDepth: 0 }).success).toBe(false)
    expect(teamSnapshotSchema.safeParse({ ...childTeam, parentTeamId: undefined, parentTaskId: undefined }).success).toBe(false)
    expect(teamSnapshotSchema.safeParse({ ...childTeam, goal: { ...childTeam.goal, teamId: 'team-1' } }).success).toBe(false)
    expect(teamGetRequestSchema.parse({ teamId: 'team-1' })).toEqual({ teamId: 'team-1' })
    expect(teamArchiveInputSchema.parse({ teamId: 'team-1', expectedCursor: 5 })).toEqual({ teamId: 'team-1', expectedCursor: 5 })
    expect(teamArchiveInputSchema.safeParse({ teamId: 'team-1', expectedCursor: 5, actor: {} }).success).toBe(false)
    expect(teamResumeInputSchema.parse({ teamId: 'team-1', expectedCursor: 5 })).toEqual({ teamId: 'team-1', expectedCursor: 5 })
    expect(teamResumeInputSchema.safeParse({ teamId: 'team-1', expectedCursor: 5, actor: {} }).success).toBe(false)
    expect(teamAuditReadRequestSchema.parse({ teamId: 'team-1', afterCursor: -1, limit: 4 })).toEqual({
      teamId: 'team-1', afterCursor: -1, limit: 4,
    })
    expect(teamAuditEntrySchema.parse({
      teamId: 'team-1', stream: 'channel', channelId: 'channel-1', cursor: 0,
      type: 'channel/opened', createdAt: 1, facts: {},
    })).toMatchObject({ stream: 'channel', channelId: 'channel-1' })
    expect(teamAuditReadResultSchema.parse({ teamId: 'team-1', items: [] })).toEqual({ teamId: 'team-1', items: [] })
    expect(teamPhaseTransitionInputSchema.parse({ teamId: 'team-1', expectedCursor: 4, phase: 'quiescing' }))
      .toMatchObject({ expectedCursor: 4 })
    expect(teamPhaseTransitionInputSchema.safeParse({
      teamId: 'team-1', expectedCursor: 4, phase: 'active', actor: {},
    }).success).toBe(false)
    const teamWatchSignal = new AbortController().signal
    const teamWatchRequest: TeamWatchRequestType = {
      teamId: teamIdSchema.parse('team-1'), afterCursor: 4, signal: teamWatchSignal,
    }
    const { signal: omittedTeamWatchSignal, ...teamWatchWireRequest } = teamWatchRequest
    expect(teamWatchRequestSchema.parse(teamWatchWireRequest)).toEqual({ teamId: 'team-1', afterCursor: 4 })
    expect(teamWatchRequestSchema.safeParse(teamWatchRequest).success).toBe(false)
    expect(omittedTeamWatchSignal).toBe(teamWatchSignal)
    expect(teamWatchResultSchema.parse({ kind: 'changed', cursor: 5 })).toEqual({ kind: 'changed', cursor: 5 })
    expect(teamWatchResultSchema.parse({ kind: 'closed' })).toEqual({ kind: 'closed' })
    expect(participantInviteInputSchema.parse({
      teamId: 'team-1', expectedCursor: 4, kind: 'local-agent', displayName: 'worker', role: 'reviewer', capabilities: ['review'],
    })).not.toHaveProperty('participantId')
    const humanInvite = participantInviteInputSchema.parse({
      teamId: 'team-1', expectedCursor: 4, kind: 'human', displayName: 'owner', role: 'reviewer', capabilities: [],
      owner: { kind: 'product-principal', principalId: 'principal-1' },
    })
    expect(humanInvite.owner).toEqual({ kind: 'product-principal', principalId: 'principal-1' })
    expect(participantInviteInputSchema.safeParse({ ...humanInvite, owner: undefined }).success).toBe(false)
    expect(participantInviteInputSchema.safeParse({ ...humanInvite, owner: 'principal-1' }).success).toBe(false)
    expect(participantInviteInputSchema.safeParse({
      ...humanInvite,
      owner: { kind: 'product-principal', principalId: ' principal-1' },
    }).success).toBe(false)
    expect(participantInviteInputSchema.safeParse({
      ...humanInvite,
      owner: { kind: 'system', principalId: 'principal-1' },
    }).success).toBe(false)
    expect(participantInviteInputSchema.safeParse({
      ...humanInvite, kind: 'local-agent', owner: { kind: 'system' },
    }).success).toBe(false)
    expect(participantPhaseTransitionInputSchema.parse({
      teamId: 'team-1', participantId: 'participant-1', expectedCursor: 5, phase: 'left',
    })).toMatchObject({ participantId: 'participant-1' })
    const activationBinding = activationBindingSnapshotSchema.parse({
      activation: { id: 'activation-1', teamId: 'team-1', participantId: 'participant-1', status: 'idle' },
      sessionId: 'session-1',
      provider: 'in-process',
    })
    expect(activationBinding).toMatchObject({ sessionId: 'session-1', provider: 'in-process' })
    expect(activationBindingSnapshotSchema.safeParse({ ...activationBinding, sessionId: '' }).success).toBe(false)
    expect(activationBindingSnapshotSchema.safeParse({ ...activationBinding, provider: '' }).success).toBe(false)
    const recovery = activationRecoverySnapshotSchema.parse({
      kind: 'sdk-local-cold-replace',
      version: 1,
      runtimeProvider: 'sdk',
      profile: 'local-sdk-v1',
      agent: { provider: 'mock', model: 'mock', maxTokens: 32 },
      process: { hostId: 'host-a', pid: 42, started: 'start-a', processGroupId: 42 },
    })
    if (recovery.kind !== 'sdk-local-cold-replace') throw new Error('schema fixture must be an SDK recovery plan')
    const fenced = {
      ...activationBinding, provider: 'sdk', recovery, fencedAt: 6,
      activation: { ...activationBinding.activation, status: 'stopping' },
    }
    expect(activationBindingSnapshotSchema.parse(fenced)).toMatchObject({ fencedAt: 6 })
    expect(activationBindingSnapshotSchema.safeParse({ ...fenced, recovery: undefined }).success).toBe(false)
    expect(activationBindingSnapshotSchema.safeParse({ ...fenced, activation: activationBinding.activation }).success).toBe(false)
    expect(activationBindingSnapshotSchema.safeParse({
      ...fenced, activation: { ...fenced.activation, status: 'offline' },
      quiescedAt: 5, quiescenceSource: 'fenced', quiescedWakeChannelIds: [],
    }).success).toBe(false)
    expect(activationBindingSnapshotSchema.parse({ ...activationBinding, provider: 'sdk', recovery }))
      .toMatchObject({ recovery: { kind: 'sdk-local-cold-replace', agent: { maxTokens: 32 } } })
    expect(activationBindingSnapshotSchema.parse({
      ...activationBinding,
      activation: { ...activationBinding.activation, status: 'offline' },
      quiescedAt: 7,
      quiescenceSource: 'fenced',
      quiescedWakeChannelIds: ['channel-1'],
    })).toMatchObject({ quiescedAt: 7, quiescenceSource: 'fenced', quiescedWakeChannelIds: ['channel-1'] })
    expect(activationBindingSnapshotSchema.safeParse({ ...activationBinding, quiescedAt: 7 }).success).toBe(false)
    expect(activationBindingSnapshotSchema.safeParse({
      ...activationBinding,
      activation: { ...activationBinding.activation, status: 'offline' },
      quiescedWakeChannelIds: ['channel-1'],
    }).success).toBe(false)
    expect(activationBindingSnapshotSchema.safeParse({
      ...activationBinding,
      activation: { ...activationBinding.activation, status: 'offline' },
      quiescedAt: 7,
      quiescedWakeChannelIds: [],
    }).success).toBe(false)
    expect(activationBindingSnapshotSchema.safeParse({
      ...activationBinding,
      quiescenceSource: 'fenced',
    }).success).toBe(false)
    expect(activationRecoverySnapshotSchema.safeParse({ ...recovery, profile: ' local-sdk-v1' }).success).toBe(false)
    expect(activationRecoverySnapshotSchema.safeParse({ ...recovery, agent: { ...recovery.agent, maxTokens: 0 } }).success).toBe(false)
    expect(activationRecoverySnapshotSchema.safeParse({ ...recovery, process: { ...recovery.process, pid: 0 } }).success).toBe(false)
    const acpRecovery = activationRecoverySnapshotSchema.parse({
      kind: 'acp-local-cold-replace', version: 1, runtimeProvider: 'acp', profile: 'local-acp-v1', cwd: '/workspace',
      process: { hostId: 'host-a', pid: 43, started: 'start-acp', processGroupId: 43 },
    })
    expect(acpRecovery).toMatchObject({ kind: 'acp-local-cold-replace', cwd: '/workspace' })
    expect(activationRecoverySnapshotSchema.safeParse({ ...acpRecovery, cwd: ' /workspace' }).success).toBe(false)
    expect(activationBindingSnapshotSchema.safeParse({ ...activationBinding, recovery }).success).toBe(false)
    expect(activationBindInputSchema.parse({ expectedCursor: 5, binding: activationBinding }))
      .toMatchObject({ expectedCursor: 5, binding: { activation: { id: 'activation-1' } } })
    expect(activationBindInputSchema.safeParse({ expectedCursor: -1, binding: activationBinding }).success).toBe(false)
    expect(activationBindInputSchema.safeParse({ expectedCursor: 5, binding: activationBinding, actor: {} }).success).toBe(false)
    expect(activationStatusUpdateInputSchema.parse({
      teamId: 'team-1', activationId: 'activation-1', expectedCursor: 5, status: 'running',
    })).toMatchObject({ activationId: 'activation-1', status: 'running' })
    expect(activationStatusUpdateInputSchema.safeParse({
      teamId: 'team-1', activationId: 'activation-1', expectedCursor: -1, status: 'running',
    }).success).toBe(false)
    expect(activationStatusUpdateInputSchema.safeParse({
      teamId: 'team-1', activationId: 'activation-1', expectedCursor: 5, status: 'running', actor: {},
    }).success).toBe(false)
    expect(activationFenceInputSchema.parse({
      teamId: 'team-1',
      activationId: 'activation-1',
      participantId: 'participant-1',
      sessionId: 'session-1',
      provider: 'in-process',
      expectedCursor: 5,
    })).toMatchObject({ activationId: 'activation-1', participantId: 'participant-1' })
    expect(activationFenceInputSchema.safeParse({
      teamId: 'team-1',
      activationId: 'activation-1',
      participantId: 'participant-1',
      sessionId: 'session-1',
      provider: 'in-process',
      expectedCursor: -1,
    }).success).toBe(false)
    expect(activationFenceInputSchema.safeParse({
      teamId: 'team-1',
      activationId: 'activation-1',
      participantId: 'participant-1',
      sessionId: 'session-1',
      provider: 'in-process',
      expectedCursor: 5,
      actor: {},
    }).success).toBe(false)
    expect(activationQuiesceInputSchema.parse({
      teamId: 'team-1',
      activationId: 'activation-1',
      participantId: 'participant-1',
      sessionId: 'session-1',
      provider: 'in-process',
      expectedCursor: 5,
    })).toMatchObject({ activationId: 'activation-1', participantId: 'participant-1' })
    expect(activationGetRequestSchema.parse({ teamId: 'team-1', activationId: 'activation-1' }))
      .toMatchObject({ activationId: 'activation-1' })
    const taskCreate = {
      teamId: 'team-1', expectedCursor: 5, createCommand: { idempotencyKey: 'task-create-1' }, parentTaskId: 'task-0',
      subject: task.subject, description: task.description, blockedBy: [],
      requiredCapabilities: task.requiredCapabilities, priority: task.priority,
      readScopes: task.readScopes, writeScopes: task.writeScopes,
      workspaceMode: task.workspaceMode, budget: task.budget, reviewPolicy: task.reviewPolicy, maxAttempts: task.maxAttempts,
    }
    expect(teamTaskCreateInputSchema.parse(taskCreate)).toMatchObject({
      createCommand: { idempotencyKey: 'task-create-1' }, parentTaskId: 'task-0', maxAttempts: 3,
    })
    const creator = teamTaskCreatorSchema.parse({
      teamId: 'team-1', participantId: 'participant-1', activationId: 'activation-1', sessionId: 'session-1', provider: 'in-process',
    })
    const createCommand = teamTaskCreateCommandSchema.parse({ creator, idempotencyKey: 'task-create-1' })
    const createCommandInput = teamTaskCreateCommandInputSchema.parse({ idempotencyKey: createCommand.idempotencyKey })
    expect(teamTaskCreateInputSchema.parse({ ...taskCreate, createCommand: createCommandInput })).toMatchObject({
      createCommand: { idempotencyKey: 'task-create-1' },
    })
    expect(teamTaskCreateInputSchema.safeParse({
      ...taskCreate, createCommand,
    }).success).toBe(false)
    expect(teamTaskCreateInputSchema.safeParse({
      teamId: taskCreate.teamId,
      expectedCursor: taskCreate.expectedCursor,
      parentTaskId: taskCreate.parentTaskId,
      subject: taskCreate.subject,
      description: taskCreate.description,
      blockedBy: taskCreate.blockedBy,
      requiredCapabilities: taskCreate.requiredCapabilities,
      priority: taskCreate.priority,
      readScopes: taskCreate.readScopes,
      writeScopes: taskCreate.writeScopes,
      workspaceMode: taskCreate.workspaceMode,
      budget: taskCreate.budget,
      reviewPolicy: taskCreate.reviewPolicy,
      maxAttempts: taskCreate.maxAttempts,
    }).success).toBe(false)
    expect(teamTaskGetRequestSchema.parse({ teamId: 'team-1', taskId: 'task-1' })).toEqual({ teamId: 'team-1', taskId: 'task-1' })
    expect(teamTaskListPageRequestSchema.safeParse({ teamId: 'team-1', afterCursor: -1, limit: 0 }).success).toBe(false)
    expect(teamTaskDetailsUpdateInputSchema.parse({
      teamId: task.teamId,
      taskId: task.id,
      expectedRevision: task.revision,
      subject: task.subject,
    }))
      .toMatchObject({ taskId: 'task-1', subject: task.subject })
    expect(teamTaskDetailsUpdateInputSchema.safeParse({
      teamId: task.teamId, taskId: task.id, expectedRevision: task.revision,
    }).success).toBe(false)
    expect(teamTaskDetailsUpdateInputSchema.safeParse({
      teamId: task.teamId, taskId: task.id, expectedRevision: task.revision, phase: 'assigned',
    }).success).toBe(false)
    expect(teamTaskDetailsUpdateInputSchema.safeParse({
      teamId: task.teamId, taskId: task.id, expectedRevision: task.revision, readScopes: task.readScopes,
    }).success).toBe(false)
    expect(teamTaskDeleteInputSchema.parse({
      teamId: task.teamId, taskId: task.id, expectedRevision: task.revision,
    })).toEqual({ teamId: 'team-1', taskId: 'task-1', expectedRevision: 1 })
    expect(teamTaskDeleteInputSchema.safeParse({
      teamId: task.teamId, taskId: task.id, expectedRevision: 0,
    }).success).toBe(false)
    expect(teamTaskCancelInputSchema.parse({
      teamId: task.teamId, taskId: task.id, expectedRevision: task.revision,
    })).toEqual({ teamId: 'team-1', taskId: 'task-1', expectedRevision: 1 })
    expect(teamCancellationTaskCancelInputSchema.parse({
      teamId: task.teamId,
      cancellationIdempotencyKey: 'cancel-1',
      cancellationRequestedAt: 10,
      expectedTeamCursor: 5,
      taskId: task.id,
      expectedRevision: task.revision,
    })).toMatchObject({ cancellationIdempotencyKey: 'cancel-1' })
    expect(teamTaskOwnerProposalInputSchema.parse({
      teamId: task.teamId, taskId: task.id, expectedRevision: task.revision, proposedOwnerId: 'participant-2',
    })).toMatchObject({ proposedOwnerId: 'participant-2' })
    expect(teamTaskOwnerProposalInputSchema.parse({
      teamId: task.teamId, taskId: task.id, expectedRevision: task.revision,
    })).toEqual({ teamId: 'team-1', taskId: 'task-1', expectedRevision: 1 })
    expect(teamTaskReviewResolveInputSchema.parse({
      taskId: task.id,
      expectedRevision: task.revision,
      nextPhase: 'completed',
      reason: 'The submitted result meets the review criteria.',
    })).toMatchObject({ nextPhase: 'completed' })
    expect(teamTaskReviewResolveInputSchema.parse({
      taskId: task.id,
      expectedRevision: task.revision,
      nextPhase: 'pending',
      reason: 'The change needs a focused follow-up.',
    })).toMatchObject({ nextPhase: 'pending' })
    expect(teamTaskReviewResolveInputSchema.safeParse({
      taskId: task.id,
      expectedRevision: task.revision,
      nextPhase: 'review',
      reason: 'Invalid phase.',
    }).success).toBe(false)
    expect(teamTaskReviewResolveInputSchema.safeParse({
      taskId: task.id,
      expectedRevision: task.revision,
      nextPhase: 'completed',
    }).success).toBe(false)
    expect(teamTaskReviewResolveInputSchema.safeParse({
      teamId: task.teamId,
      participantId: 'participant-1',
      taskId: task.id,
      expectedRevision: task.revision,
      nextPhase: 'completed',
      reason: 'Caller-selected reviewer identities are rejected.',
    }).success).toBe(false)
    for (const details of [
      { description: task.description },
      { blockedBy: task.blockedBy },
    ]) {
      expect(teamTaskDetailsUpdateInputSchema.parse({
        teamId: task.teamId, taskId: task.id, expectedRevision: task.revision, ...details,
      })).toMatchObject(details)
    }
    const attemptFence = { teamId: task.teamId, taskId: task.id, expectedRevision: task.revision, attemptId: 'attempt-1' }
    const ownerFence = { ...attemptFence, participantId: 'participant-1' }
    const assign = {
      teamId: task.teamId, taskId: task.id, expectedRevision: task.revision,
      participantId: 'participant-1', leaseDurationMs: 30_000,
    }
    expect(teamTaskAssignInputSchema.parse(assign)).toMatchObject({
      participantId: 'participant-1', leaseDurationMs: 30_000,
    })
    expect(teamTaskAssignInputSchema.parse({ ...assign, activationId: 'activation-1' }))
      .toMatchObject({ activationId: 'activation-1' })
    expect(teamTaskAssignInputSchema.parse({ ...assign, wakeChannelId: 'channel-1' }))
      .toMatchObject({ wakeChannelId: 'channel-1' })
    expect(teamTaskAssignInputSchema.safeParse({ ...assign, activationId: undefined }).success).toBe(false)
    expect(teamTaskAssignInputSchema.safeParse({ ...assign, actor: {} }).success).toBe(false)
    expect(teamTaskAttemptFenceSchema.parse(attemptFence)).toEqual(attemptFence)
    expect(teamTaskAttemptOwnerFenceSchema.parse(ownerFence)).toEqual(ownerFence)
    expect(teamTaskAttemptOwnerFenceSchema.parse({ ...ownerFence, activationId: 'activation-1' }))
      .toMatchObject({ activationId: 'activation-1' })
    expect(teamTaskAttemptOwnerFenceSchema.safeParse({ ...ownerFence, activationId: undefined }).success).toBe(false)
    expect(teamTaskAttemptStartInputSchema.parse({
      taskId: ownerFence.taskId,
      expectedRevision: ownerFence.expectedRevision,
      attemptId: ownerFence.attemptId,
    })).toEqual({
      taskId: ownerFence.taskId,
      expectedRevision: ownerFence.expectedRevision,
      attemptId: ownerFence.attemptId,
    })
    const startClaim = {
      taskId: task.id,
      attemptId: 'attempt-1',
      assignedRevision: 2,
      channelId: 'channel-1',
      envelopeId: 'envelope-1',
    }
    expect(teamTaskAttemptStartClaimInputSchema.parse(startClaim)).toEqual(startClaim)
    expect(teamTaskAttemptStartClaimInputSchema.safeParse({ ...startClaim, teamId: task.teamId }).success).toBe(false)
    expect(teamTaskAttemptStartClaimInputSchema.safeParse({ ...startClaim, participantId: 'participant-1' }).success).toBe(false)
    expect(teamTaskAttemptStartClaimInputSchema.safeParse({ ...startClaim, activationId: 'activation-1' }).success).toBe(false)
    expect(teamTaskAttemptStartClaimInputSchema.safeParse({ ...startClaim, sessionId: 'session-1' }).success).toBe(false)
    expect(teamTaskAttemptStartClaimInputSchema.safeParse({ ...startClaim, actor: {} }).success).toBe(false)
    expect(teamTaskAttemptStartClaimInputSchema.safeParse({ ...startClaim, expectedRevision: 2 }).success).toBe(false)
    const heartbeatInput = { taskId: task.id, attemptId: 'attempt-1', expectedRevision: task.revision }
    expect(teamTaskAttemptHeartbeatInputSchema.parse(heartbeatInput)).toEqual(heartbeatInput)
    expect(teamTaskAttemptHeartbeatInputSchema.safeParse({ ...heartbeatInput, teamId: task.teamId }).success).toBe(false)
    expect(teamTaskAttemptHeartbeatInputSchema.safeParse({ ...heartbeatInput, participantId: 'participant-1' }).success).toBe(false)
    expect(teamTaskAttemptHeartbeatInputSchema.safeParse({ ...heartbeatInput, activationId: 'activation-1' }).success).toBe(false)
    expect(teamTaskAttemptHeartbeatInputSchema.safeParse({ ...heartbeatInput, sessionId: 'session-1' }).success).toBe(false)
    expect(teamTaskAttemptHeartbeatInputSchema.safeParse({ ...heartbeatInput, actor: {} }).success).toBe(false)
    expect(teamTaskAttemptSettleInputSchema.parse({
      ...heartbeatInput, outcome: { kind: 'completed', result: { summary: 'review ready' } },
    })).toMatchObject({ outcome: { kind: 'completed' } })
    expect(teamTaskAttemptSettleInputSchema.parse({
      ...heartbeatInput, outcome: { kind: 'released' },
    })).toMatchObject({ outcome: { kind: 'released' } })
    expect(teamTaskAttemptSettleInputSchema.parse({
      ...heartbeatInput,
      outcome: { kind: 'failed', failure: { code: 'model-unavailable', message: 'model unavailable' } },
    })).toMatchObject({ outcome: { kind: 'failed' } })
    expect(teamTaskAttemptSettleInputSchema.parse({
      ...heartbeatInput, outcome: { kind: 'cancelled' },
    })).toMatchObject({ outcome: { kind: 'cancelled' } })
    expect(teamTaskAttemptExpireInputSchema.parse(attemptFence)).toEqual(attemptFence)
    expect(teamTaskAttemptExpireInputSchema.safeParse({ ...attemptFence, actor: {} }).success).toBe(false)
    expect(teamTaskAttemptSettleInputSchema.safeParse({
      ...heartbeatInput, outcome: { kind: 'completed', result: { summary: 'review ready' } }, nextPhase: 'pending',
    }).success).toBe(false)
    expect(teamTaskAttemptSettleInputSchema.safeParse({
      ...heartbeatInput, outcome: { kind: 'lease-expired' },
    }).success).toBe(false)
    expect(teamTaskAttemptSettleInputSchema.safeParse({
      ...heartbeatInput, outcome: { kind: 'cancelled' }, teamId: task.teamId,
    }).success).toBe(false)
    expect(teamTaskAttemptSettleInputSchema.safeParse({
      ...heartbeatInput, outcome: { kind: 'cancelled' }, participantId: 'participant-1',
    }).success).toBe(false)
    expect(teamTaskAttemptSettleInputSchema.safeParse({
      ...heartbeatInput, outcome: { kind: 'cancelled' }, activationId: 'activation-1',
    }).success).toBe(false)
    expect(teamTaskAttemptSettleInputSchema.safeParse({
      ...heartbeatInput, outcome: { kind: 'cancelled' }, actor: {},
    }).success).toBe(false)
    expect(teamTaskAttemptExpireInputSchema.safeParse({ ...attemptFence, nextPhase: 'pending' }).success).toBe(false)
    expect(channelOpenInputSchema.parse({
      teamId: 'team-1', expectedCursor: 5, adapter: manifest.adapter, participants: manifest.participants, limits: manifest.limits,
    })).not.toHaveProperty('channelId')
    expect(channelOpenInputSchema.parse({
      teamId: 'team-1', expectedCursor: 5, adapter: { type: 'workflow', version: 1 }, workflowPlanId: 'workflow-plan-1',
      expectedPlanRevision: 1, participants: manifest.participants, limits: manifest.limits,
    })).toMatchObject({ workflowPlanId: 'workflow-plan-1', expectedPlanRevision: 1 })
    expect(channelOpenInputSchema.safeParse({
      teamId: 'team-1', expectedCursor: 5, adapter: { type: 'workflow', version: 1 }, workflowPlanId: 'workflow-plan-1',
      participants: manifest.participants, limits: manifest.limits,
    }).success).toBe(false)
    expect(teamWorkflowPlanTaskBindInputSchema.parse({
      teamId: 'team-1', planId: 'workflow-plan-1', expectedCursor: 5, expectedRevision: 1, templateId: 'first', taskId: 'task-1',
    })).toMatchObject({ templateId: 'first' })
    expect(teamWorkflowPlanChannelBindInputSchema.parse({
      teamId: 'team-1', planId: 'workflow-plan-1', expectedCursor: 5, expectedRevision: 1, channelId: 'channel-1',
    })).toMatchObject({ channelId: 'channel-1' })
    expect(teamWorkflowPlanPhaseInputSchema.parse({
      teamId: 'team-1', planId: 'workflow-plan-1', expectedCursor: 5, expectedRevision: 1, phase: 'ready',
    })).toMatchObject({ phase: 'ready' })
    expect(teamWorkflowChannelCloseInputSchema.parse({
      teamId: 'team-1', planId: 'workflow-plan-1', expectedTeamCursor: 5, expectedRevision: 1,
      channelId: 'channel-1', expectedCursor: 0,
    })).toMatchObject({ channelId: 'channel-1' })
    const postInput = {
      expectedCursor: 2,
      draft: {
        channelId: 'channel-1', audience: null, kind: 'message', payload: { text: 'ready' }, delivery: 'turn',
      },
    }
    expect(channelEnvelopePostInputSchema.parse(postInput)).toMatchObject({ expectedCursor: 2 })
    expect(channelEnvelopePostInputSchema.parse({ ...postInput, idempotencyKey: 'post-1' })).toMatchObject({
      idempotencyKey: 'post-1',
    })
    expect(channelEnvelopePostInputSchema.safeParse({ ...postInput, actor: {} }).success).toBe(false)
    expect(channelEnvelopePostInputSchema.safeParse({ ...postInput, senderId: 'participant-1' }).success).toBe(false)
    expect(channelEnvelopePostInputSchema.safeParse({ ...postInput, activationId: 'activation-1' }).success).toBe(false)
    expect(channelEnvelopePostInputSchema.safeParse({ ...postInput, sessionId: 'session-1' }).success).toBe(false)
    expect(channelEnvelopePostInputSchema.safeParse({
      expectedCursor: -1,
      draft: {
        channelId: 'channel-1', audience: null, kind: 'message', payload: { text: 'ready' }, delivery: 'turn',
      },
    }).success).toBe(false)
    const finalInput = {
      channelId: 'channel-1', idempotencyKey: 'final-1', text: 'Finished.',
    }
    expect(channelFinalPostInputSchema.parse(finalInput)).toMatchObject(finalInput)
    expect(channelFinalPostInputSchema.safeParse({ ...finalInput, senderId: 'participant-1' }).success).toBe(false)
    expect(channelFinalPostInputSchema.safeParse({
      ...finalInput, activationId: 'activation-1', sessionId: 'session-1',
    }).success).toBe(false)
    expect(channelFinalPostInputSchema.safeParse({ ...finalInput, actor: {} }).success).toBe(false)
    expect(channelFinalPostInputSchema.safeParse({ ...finalInput, text: '' }).success).toBe(false)
    expect(channelFinalPostInputSchema.safeParse({ ...finalInput, expectedCursor: 2 }).success).toBe(false)
    const receiptInput = {
      channelId: 'channel-1', envelopeId: 'envelope-1', expectedCursor: 2,
    }
    expect(channelEnvelopeReceiptInputSchema.parse(receiptInput)).toMatchObject({
      envelopeId: 'envelope-1', expectedCursor: 2,
    })
    expect(channelEnvelopeReceiptInputSchema.safeParse({ ...receiptInput, actor: {} }).success).toBe(false)
    expect(channelEnvelopeReceiptInputSchema.safeParse({ ...receiptInput, participantId: 'participant-1' }).success).toBe(false)
    expect(channelEnvelopeReceiptInputSchema.safeParse({ ...receiptInput, activationId: 'activation-1' }).success).toBe(false)
    expect(channelEnvelopeReceiptInputSchema.safeParse({ ...receiptInput, sessionId: 'session-1' }).success).toBe(false)
    expect(channelEnvelopeReceiptInputSchema.safeParse({
      channelId: 'channel-1', envelopeId: 'envelope-1', expectedCursor: -1,
    }).success).toBe(false)
    expect(channelEnvelopeReceiptInputSchema.safeParse({
      channelId: 'channel-1', expectedCursor: 2,
    }).success).toBe(false)
    const deliveryClaimInput = channelDeliveryClaimInputSchema.parse({
      channelId: 'channel-1', envelopeId: 'envelope-1',
    })
    expect(deliveryClaimInput).toEqual({ channelId: 'channel-1', envelopeId: 'envelope-1' })
    expect(channelDeliveryClaimInputSchema.safeParse({ ...deliveryClaimInput, unexpected: true }).success).toBe(false)
    expect(channelDeliveryClaimInputSchema.safeParse({ ...deliveryClaimInput, teamId: 'team-1' }).success).toBe(false)
    expect(channelDeliveryClaimInputSchema.safeParse({ ...deliveryClaimInput, participantId: 'participant-1' }).success).toBe(false)
    expect(channelDeliveryClaimInputSchema.safeParse({ ...deliveryClaimInput, activationId: 'activation-1' }).success).toBe(false)
    expect(channelDeliveryClaimInputSchema.safeParse({ ...deliveryClaimInput, sessionId: 'session-1' }).success).toBe(false)
    expect(channelDeliveryClaimInputSchema.safeParse({ ...deliveryClaimInput, actor: {} }).success).toBe(false)
    const deliveryClaim = channelDeliveryClaimSchema.parse({
      binding: activationBinding,
      channel,
      envelopeId: 'envelope-1',
      delivery: 'turn',
    })
    expect(deliveryClaim).toMatchObject({
      binding: { activation: { id: 'activation-1' }, sessionId: 'session-1' },
      channel: { manifest: { id: 'channel-1' } }, envelopeId: 'envelope-1', delivery: 'turn',
    })
    expect(channelDeliveryClaimSchema.safeParse({ ...deliveryClaim, delivery: 'later' }).success).toBe(false)
    expect(channelDeliveryClaimSchema.safeParse({ ...deliveryClaim, unexpected: true }).success).toBe(false)
    const channelWithView = channelSnapshotSchema.parse({
      ...channel,
      manifest: {
        ...channel.manifest,
        adapter: { type: 'discussion', version: 1 },
        viewPolicy: { type: 'recent-window', version: 1 },
      },
    })
    const view = teamChannelViewEventDataSchema.parse({
      teamId: 'team-1',
      channelId: 'channel-1',
      adapter: { type: 'discussion', version: 1 },
      viewPolicy: { type: 'recent-window', version: 1 },
      triggeringEnvelopeId: 'envelope-1',
      sourceEnvelopeIds: ['envelope-source', 'envelope-1'],
      delivery: 'turn',
      content: [{ type: 'text', text: 'The bounded discussion view.' }],
      causationId: 'envelope-cause',
      taskId: 'task-1',
      review: { attemptId: 'attempt-1', reviewRevision: 2, reviewerId: 'participant-1' },
    })
    const viewClaim = channelDeliveryClaimSchema.parse({ ...deliveryClaim, channel: channelWithView, view })
    expect(viewClaim.view).toEqual(view)
    expect(channelDeliveryClaimSchema.safeParse({ ...deliveryClaim, channel: channelWithView }).success).toBe(false)
    expect(teamChannelViewEventDataSchema.safeParse({ ...view, sourceEnvelopeIds: [] }).success).toBe(false)
    expect(teamChannelViewEventDataSchema.safeParse({ ...view, sourceEnvelopeIds: ['envelope-1', 'envelope-1'] }).success).toBe(false)
    expect(teamChannelViewEventDataSchema.safeParse({ ...view, content: [{}] }).success).toBe(false)
    expect(teamChannelViewEventDataSchema.safeParse({ ...view, content: [{ type: 'text', text: undefined }] }).success).toBe(false)
    expect(teamChannelViewEventDataSchema.safeParse({ ...view, causationId: undefined }).success).toBe(false)
    expect(teamChannelViewEventDataSchema.safeParse({ ...view, delivery: 'later' }).success).toBe(false)
    expect(teamChannelViewEventDataSchema.safeParse({ ...view, adapter: { type: 'discussion', version: -1 } }).success).toBe(false)
    expect(teamChannelViewEventDataSchema.safeParse({ ...view, review: { ...view.review, reviewRevision: 0 } }).success).toBe(false)
    expect(teamChannelViewEventDataSchema.safeParse({ ...view, review: { ...view.review, reviewerId: '' } }).success).toBe(false)
    expect(teamChannelViewEventDataSchema.safeParse({ ...view, unexpected: true }).success).toBe(false)
    expect(channelDeliveryClaimSchema.safeParse({ ...viewClaim, channel, view }).success).toBe(false)
    expect(channelDeliveryClaimSchema.safeParse({ ...viewClaim, view: undefined }).success).toBe(false)
    expect(channelDeliveryClaimSchema.safeParse({
      ...viewClaim,
      view: { ...view, adapter: { type: 'workflow', version: 1 } },
    }).success).toBe(false)
    expect(channelDeliveryClaimSchema.safeParse({
      ...viewClaim,
      view: { ...view, viewPolicy: { type: 'full-transcript', version: 1 } },
    }).success).toBe(false)
    expect(channelDeliveryClaimSchema.safeParse({
      ...viewClaim,
      view: { ...view, triggeringEnvelopeId: 'other-envelope' },
    }).success).toBe(false)
    expect(channelDeliveryClaimSchema.safeParse({
      ...viewClaim,
      view: { ...view, delivery: 'context' },
    }).success).toBe(false)
    const pendingDeliveryRequest = channelPendingDeliveryListRequestSchema.parse({
      channelId: 'channel-1', participantId: 'participant-1', afterCursor: -1, limit: 2,
    })
    expect(pendingDeliveryRequest).toEqual({
      channelId: 'channel-1', participantId: 'participant-1', afterCursor: -1, limit: 2,
    })
    expect(channelPendingDeliveryListRequestSchema.safeParse({ ...pendingDeliveryRequest, limit: 0 }).success).toBe(false)
    expect(channelPendingDeliveryListRequestSchema.safeParse({ ...pendingDeliveryRequest, afterCursor: -2 }).success).toBe(false)
    expect(channelPendingDeliveryListRequestSchema.safeParse({ ...pendingDeliveryRequest, unexpected: true }).success).toBe(false)
    const pendingDelivery = channelPendingEnvelopeDeliverySchema.parse({ envelope, delivery: 'turn' })
    expect(pendingDelivery).toMatchObject({ envelope: { id: 'envelope-1', sequence: 2 }, delivery: 'turn' })
    expect(channelPendingEnvelopeDeliverySchema.safeParse({ ...pendingDelivery, unexpected: true }).success).toBe(false)
    const pendingDeliveryPage = channelPendingDeliveryPageSchema.parse({
      channel,
      deliveries: [pendingDelivery],
      nextCursor: 2,
    })
    expect(pendingDeliveryPage).toMatchObject({ channel: { cursor: 2 }, deliveries: [pendingDelivery], nextCursor: 2 })
    expect(channelPendingDeliveryPageSchema.parse({ ...pendingDeliveryPage, nextCursor: 3 })).toMatchObject({ nextCursor: 3 })
    expect(channelPendingDeliveryPageSchema.safeParse({ ...pendingDeliveryPage, nextCursor: -1 }).success).toBe(false)
    expect(channelPendingDeliveryPageSchema.safeParse({ ...pendingDeliveryPage, unexpected: true }).success).toBe(false)
    expect(channelGetRequestSchema.parse({ channelId: 'channel-1' })).toEqual({ channelId: 'channel-1' })
    expect(channelReadRequestSchema.parse({ channelId: 'channel-1', afterCursor: 2 }))
      .toEqual({ channelId: 'channel-1', afterCursor: 2 })
    expect(channelReadRequestSchema.parse({ channelId: 'channel-1', afterCursor: -1 }))
      .toEqual({ channelId: 'channel-1', afterCursor: -1 })
    expect(channelReadRequestSchema.safeParse({ channelId: 'channel-1', afterCursor: -2 }).success).toBe(false)
    expect(channelCloseInputSchema.parse({ channelId: 'channel-1', expectedCursor: 2, reason: 'done' }))
      .toMatchObject({ expectedCursor: 2 })
    expect(teamCancellationChannelCloseInputSchema.parse({
      teamId: 'team-1',
      cancellationIdempotencyKey: 'cancel-1',
      cancellationRequestedAt: 10,
      expectedTeamCursor: 5,
      channelId: 'channel-1',
      expectedCursor: 2,
      reason: 'Team cancelled',
    })).toMatchObject({ reason: 'Team cancelled' })
    const channelWatchSignal = new AbortController().signal
    const channelWatchRequest: ChannelWatchRequestType = {
      channelId: channelIdSchema.parse('channel-1'), afterCursor: 2, signal: channelWatchSignal,
    }
    const { signal: omittedChannelWatchSignal, ...channelWatchWireRequest } = channelWatchRequest
    expect(channelWatchRequestSchema.parse(channelWatchWireRequest))
      .toEqual({ channelId: 'channel-1', afterCursor: 2 })
    expect(channelWatchRequestSchema.safeParse(channelWatchRequest).success).toBe(false)
    expect(omittedChannelWatchSignal).toBe(channelWatchSignal)
    expect(channelWatchResultSchema.parse({ kind: 'changed', cursor: 3 })).toEqual({ kind: 'changed', cursor: 3 })
    expect(channelWatchResultSchema.parse({ kind: 'closed' })).toEqual({ kind: 'closed' })
  })
  it('parses JSON-only envelopes, channel records, and post-commit Team events', () => {
    expect(jsonObjectSchema.parse({ nested: [{ value: true }] })).toEqual({ nested: [{ value: true }] })
    expect(jsonObjectSchema.safeParse({ nonJson: undefined }).success).toBe(false)
    expect(jsonObjectSchema.safeParse({ negativeZero: -0 }).success).toBe(false)
    const draft = teamEnvelopeDraftSchema.parse({
      channelId: 'channel-1',
      audience: ['participant-1'],
      kind: 'question',
      payload: { question: 'ready?' },
      delivery: 'context',
    })
    expect(draft).toMatchObject({ channelId: 'channel-1' })
    expect(draft).not.toHaveProperty('priority')
    expect(teamEnvelopeSchema.parse(envelope)).toMatchObject({ id: 'envelope-1', priority: 'normal' })
    expect(teamEnvelopeSchema.safeParse({ ...envelope, payload: { value: Number.NaN } }).success).toBe(false)
    expect(channelManifestSchema.parse(manifest)).toMatchObject({ id: 'channel-1', adapter: { type: 'direct' } })
    expect(channelRecordSchema.parse({
      type: 'channel/opened', sequence: 1, createdAt: 1, manifest,
    })).toMatchObject({ type: 'channel/opened' })
    expect(channelRecordSchema.parse({ type: 'channel/phase', sequence: 2, createdAt: 2, phase: 'active' }))
      .toMatchObject({ type: 'channel/phase', phase: 'active' })
    expect(channelRecordSchema.parse({
      type: 'channel/envelope', envelope, idempotencyKey: 'post-1',
      deliveryIntents: [{ participantId: 'participant-1', envelopeId: 'envelope-1', delivery: 'turn' }],
    }))
      .toMatchObject({ type: 'channel/envelope', idempotencyKey: 'post-1' })
    expect(channelRecordSchema.parse({
      type: 'channel/receipt', sequence: 3, createdAt: 4, participantId: 'participant-1', envelopeId: 'envelope-1', cursor: 2,
    })).toMatchObject({ type: 'channel/receipt' })
    expect(channelRecordSchema.parse({
      type: 'channel/adapter', sequence: 4, createdAt: 5, adapter: { type: 'direct', version: 1 }, payload: { accepted: true },
    })).toMatchObject({ type: 'channel/adapter' })
    expect(channelRecordSchema.parse({ type: 'channel/closed', sequence: 5, createdAt: 6, phase: 'closed' }))
      .toMatchObject({ type: 'channel/closed' })
    expect(channelRecordSchema.safeParse({ type: 'channel/closed', sequence: 5, createdAt: 6, phase: 'active' }).success)
      .toBe(false)
    expect(channelEventSchema.parse({
      channelId: 'channel-1',
      record: { type: 'channel/phase', sequence: 2, createdAt: 2, phase: 'active' },
    })).toMatchObject({ channelId: 'channel-1', record: { type: 'channel/phase' } })
    expect(teamPolicyRequestSchema.parse({ hook: 'send', teamId: 'team-1', actorId: 'participant-1', facts: { size: 1 } }))
      .toMatchObject({ hook: 'send' })
    expect(teamEventSchema.parse({
      type: 'team/created',
      team: {
        id: 'team-1', depth: 0, maxTeamDepth: 2,
        goal: { teamId: 'team-1', revision: 1, objective: 'ship it', phase: 'active', budgets: {} },
        phase: 'active', cursor: 1, createdAt: 1, updatedAt: 1,
      },
    })).toMatchObject({ type: 'team/created', team: { id: 'team-1' } })
    expect(teamEventSchema.parse({
      type: 'team/changed',
      team: {
        id: 'team-1', depth: 0, maxTeamDepth: 2,
        goal: { teamId: 'team-1', revision: 1, objective: 'ship it', phase: 'active', budgets: {} },
        phase: 'completed', cursor: 2, createdAt: 1, updatedAt: 2, archivedAt: 3,
      },
    })).toMatchObject({ type: 'team/changed', team: { archivedAt: 3 } })
    const interruptTarget = participantInterruptTargetSchema.parse({
      teamId: 'team-1', participantId: 'participant-1', activationId: 'activation-1', sessionId: 'session-1', provider: 'in-process',
    })
    const interrupt = participantInterruptSnapshotSchema.parse({
      id: 'interrupt-1', actorId: 'participant-2', target: interruptTarget, requestedAt: 4,
    })
    expect(participantInterruptRequestInputSchema.parse({
      teamId: 'team-1', expectedCursor: 3,
    })).toMatchObject({ expectedCursor: 3 })
    expect(participantInterruptRequestInputSchema.parse({
      teamId: 'team-1', participantId: 'participant-1', expectedCursor: 3,
    })).toMatchObject({ participantId: 'participant-1', expectedCursor: 3 })
    expect(participantInterruptListPendingInputSchema.parse({})).toEqual({})
    expect(participantInterruptAcknowledgeInputSchema.parse({ interruptId: 'interrupt-1' }))
      .toMatchObject({ interruptId: 'interrupt-1' })
    expect(participantInterruptSnapshotSchema.parse({ ...interrupt, acknowledgedAt: 5 })).toMatchObject({ acknowledgedAt: 5 })
    expect(participantInterruptSnapshotSchema.safeParse({ ...interrupt, acknowledgedAt: 3 }).success).toBe(false)
    expect(participantInterruptRequestInputSchema.safeParse({
      teamId: 'team-1', actorId: 'participant-2', participantId: 'participant-1', expectedCursor: 3, provider: 'spoofed',
    }).success).toBe(false)
    const usageSampleInput = {
      id: 'usage-1',
      provider: 'mock',
      model: 'model-1',
      turn: 2,
      step: 3,
      usage: { inputTokens: 4, outputTokens: 5 },
    }
    expect(teamUsageSampleInputSchema.parse(usageSampleInput)).toEqual(usageSampleInput)
    expect(teamUsageRecordInputSchema.parse({ expectedCursor: 4, sample: usageSampleInput }))
      .toMatchObject({ expectedCursor: 4, sample: { id: 'usage-1' } })
    expect(teamUsageSampleInputSchema.safeParse({
      ...usageSampleInput, teamId: 'team-1', participantId: 'participant-1', sessionId: 'session-1', observedAt: 0,
    }).success).toBe(false)
    expect(teamUsageSampleSchema.parse({
      ...usageSampleInput, teamId: 'team-1', participantId: 'participant-1', sessionId: 'session-1', observedAt: 0,
    })).toMatchObject({ teamId: 'team-1', participantId: 'participant-1', sessionId: 'session-1' })
    expect(teamEventSchema.parse({
      type: 'participant-interrupt/changed', interrupt, cursor: 4, createdAt: 4,
    })).toMatchObject({ type: 'participant-interrupt/changed', interrupt: { id: 'interrupt-1' } })
    expect(teamEventSchema.parse({
      type: 'goal/changed',
      goal: {
        teamId: 'team-1', revision: 2, objective: 'ship it', phase: 'blocked', budgets: {},
        blocker: { code: 'needs-input', message: 'Choose a deployment target.' },
      },
      cursor: 2,
      createdAt: 2,
    })).toMatchObject({ type: 'goal/changed', goal: { revision: 2, phase: 'blocked' } })
    expect(teamEventSchema.parse({
      type: 'activation/changed',
      binding: {
        activation: { id: 'activation-1', teamId: 'team-1', participantId: 'participant-1', status: 'idle' },
        sessionId: 'session-1', provider: 'in-process',
      },
      cursor: 2,
      createdAt: 2,
    })).toMatchObject({ type: 'activation/changed', binding: { sessionId: 'session-1' } })
  })
  it('parses rootless two-stage workspace allocation authority and rejects leaked roots', () => {
    expect(teamWorkspaceAllocationIdSchema.parse('allocation-1')).toBe('allocation-1')
    expect(teamSystemWorkspaceAllocationProofSourceNameSchema.parse('team-agent-client')).toBe('team-agent-client')
    expect(teamSystemWorkspaceAllocationProofSourceNameSchema.safeParse(' team-agent-client').success).toBe(false)
    const reserve = {
      teamId: 'team-1',
      expectedCursor: 4,
      taskId: 'task-1',
      expectedTaskRevision: 3,
      attemptId: 'attempt-1',
      allocation: {
        id: 'allocation-1', provider: 'worktree-local', mode: 'worktree', assignedRevision: 2,
        participantId: 'participant-1', activationId: 'activation-1', sessionId: 'session-1', baseVersion: 'commit-a',
      },
    }
    expect(teamWorkspaceAllocationReserveInputSchema.parse(reserve)).toEqual(reserve)
    expect(teamWorkspaceAllocationReserveInputSchema.safeParse({
      ...reserve,
      allocation: { ...reserve.allocation, root: '/must-not-persist' },
    }).success).toBe(false)
    const snapshot = {
      id: 'allocation-1', revision: 1,
      teamId: 'team-1', taskId: 'task-1', attemptId: 'attempt-1', assignedRevision: 2,
      participantId: 'participant-1', activationId: 'activation-1', sessionId: 'session-1',
      provider: 'worktree-local', mode: 'worktree', baseVersion: 'commit-a',
      lifecycle: 'reserved', reservedAt: 5, updatedAt: 5,
    }
    expect(teamWorkspaceAllocationSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(teamWorkspaceAllocationSnapshotSchema.safeParse({ ...snapshot, root: '/must-not-persist' }).success).toBe(false)
    expect(teamWorkspaceAllocationActivateInputSchema.parse({
      teamId: 'team-1', expectedCursor: 5, allocationId: 'allocation-1', expectedRevision: 1,
    })).toMatchObject({ allocationId: 'allocation-1' })
    expect(teamWorkspaceAllocationReleaseRequestInputSchema.parse({
      teamId: 'team-1', expectedCursor: 6, allocationId: 'allocation-1', expectedRevision: 2,
    })).toMatchObject({ expectedRevision: 2 })
    expect(teamWorkspaceAllocationPreserveInputSchema.parse({
      teamId: 'team-1', expectedCursor: 7, allocationId: 'allocation-1', expectedRevision: 3,
      reason: { code: 'CLEANUP_FAILED', message: 'The provider retained its resource.' },
    })).toMatchObject({ reason: { code: 'CLEANUP_FAILED' } })
    expect(teamWorkspaceAllocationReleaseInputSchema.parse({
      teamId: 'team-1', expectedCursor: 8, allocationId: 'allocation-1', expectedRevision: 3,
    })).toMatchObject({ allocationId: 'allocation-1' })
    const scope = teamSystemWorkspaceAllocationScopeSchema.parse({
      kind: 'workspace-allocation-reserve', ...reserve,
    })
    expect(teamSystemWorkspaceAllocationProofResolutionSchema.parse({ sourceName: 'team-agent-client', scope }))
      .toMatchObject({ scope: { kind: 'workspace-allocation-reserve' } })
  })
})
