import type { TeamMemberInspection } from '../src/types.ts'
import type { TeamBrowsePage } from '../src/types.ts'
import type { TeamMemberSessionSnapshot } from '../src/types.ts'
import type { TeamSelectionSnapshot } from '../src/types.ts'
import type { ActivationReservationRequest, ActivationReservationSnapshot } from '../src/types.ts'
import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import {
  TeamError,
  teamIdSchema,
  teamTaskIdSchema,
  participantIdSchema,
  envelopeIdSchema,
  taskAttemptIdSchema,
  teamWorkflowPlanIdSchema,
  teamWorkflowTaskTemplateIdSchema,
  teamClosureIdempotencyKeySchema,
  teamWorkflowPlanIdempotencyKeySchema,
  teamUsageSampleIdSchema,
  teamFinalAdmissionIdempotencyKeySchema,
  fingerprintTeamFinalContent,
  teamWorkflowPlanSchema,
  teamStateSnapshotSchema,
  channelSnapshotSchema,

  TeamRuntime,
  activationBindingSnapshotSchema,
  channelIdSchema,
  channelRecordSchema,
  teamSystemEnvelopePostScopeSchema,
  teamSystemActivationScopeSchema,
  teamSystemHumanActionScopeSchema,
  teamSystemTaskLeaseScopeSchema,
  teamSystemTaskControlScopeSchema,
  teamSystemRootCreationScopeSchema,
  teamSystemChildCreationScopeSchema,
  teamSystemChannelSummaryScopeSchema,
  teamSystemChannelLifecycleScopeSchema,
  teamSystemWorkspaceAllocationScopeSchema,
  teamSystemArchiveScopeSchema,
  teamSystemTopologyScopeSchema,
  teamSystemSchedulerChannelScopeSchema,
  teamSystemCancellationCleanupScopeSchema,
  teamSystemFinalizationCleanupScopeSchema,
  teamSystemWorkflowScopeSchema,
  teamSystemFinalReceiptScopeSchema,
  teamSystemClosureScopeSchema,
  teamSystemClosureDriverScopeSchema,
  teamSystemPhaseScopeSchema,
  teamSystemMaintenanceScopeSchema,
  teamSystemInterruptScopeSchema,
  teamSystemTaskReviewScopeSchema,
  teamSnapshotSchema,
} from '../src/index.ts'
import type {
  ActivationBindRequest,
  ActivationBindingSnapshot,
  ActivationFenceRequest,
  ActivationQuiesceRequest,
  ActivationGetRequest,
  ActivationStatusUpdateRequest,
  ChannelCloseRequest,
  ChannelDeliveryClaim,
  ChannelDeliveryClaimRequest,
  ChannelSummaryRecord,
  ChannelSummarizeRequest,
  ChannelEnvelopePostRequest,
  ChannelFinalPostRequest,
  ChannelEnvelopeReceiptRequest,
  ChannelGetRequest,
  ChannelPendingDeliveryListRequest,
  ChannelPendingDeliveryPage,
  ChannelReadPageRequest,
  ChannelReadPageResult,
  ChannelRecord,
  ChannelReceiptRecord,
  ChannelOpenRequest,
  ChannelReadRequest,
  ChannelReadResult,
  ChannelSnapshot,
  ChannelWatchRequest,
  ChannelWatchResult,
  ParticipantInviteRequest,
  ParticipantInterruptAcknowledgeRequest,
  ParticipantInterruptListPendingRequest,
  ParticipantInterruptRequest,
  ParticipantInterruptSnapshot,
  ParticipantPhaseTransitionRequest,
  ParticipantSnapshot,
  TeamMemberListPage,
  TeamMemberListPageRequest,
  TeamChannelAdapter,
  TeamViewPolicy,
  TeamChannelCompactRequest,
  TeamChannelCompactResult,
  TeamJournalCompactRequest,
  TeamJournalCompactResult,
  TeamArchiveRequest,
  TeamAuditReadRequest,
  TeamAuditReadResult,
  TeamCreateRequest,
  TeamEnvelope,
  TeamGetRequest,
  TeamGoalPhaseTransitionRequest,
  TeamGoalSnapshot,
  TeamGoalUpdateRequest,
  TeamPhaseTransitionRequest,
  TeamPolicy,
  TeamSnapshot,
  TeamListPage,
  TeamListPageRequest,
  TeamStateSnapshot,
  TeamTaskAssignRequest,
  TeamTaskAttemptExpireRequest,
  TeamTaskAttemptHeartbeatRequest,
  TeamTaskAttemptSettleRequest,
  TeamTaskAttemptStartClaimRequest,
  TeamTaskAttemptStartRequest,
  TeamWorkspaceAllocationReserveRequest,
  TeamWorkspaceAllocationActivateRequest,
  TeamWorkspaceAllocationReleaseRequest,
  TeamWorkspaceAllocationPreserveRequest,
  TeamWorkspaceAllocationReleaseConfirmRequest,
  TeamWorkspaceAllocationSnapshot,
  TeamTaskCancelRequest,
  TeamTaskCancellationReconcileRequest,
  TeamTaskCreateRequest,
  TeamTaskDeleteRequest,
  TeamTaskDetailsUpdateRequest,
  TeamTaskGetRequest,
  TeamTaskListPage,
  TeamTaskListPageRequest,
  TeamTaskReviewResolveRequest,
  TeamTaskReviewRecoverRequest,
  TeamTaskSnapshot,
  TeamActorProof,
  TeamHumanActorProof,
  TeamSystemFinalReceiptProof,
  TeamSystemFinalReceiptProofResolution,
  TeamSystemFinalReceiptProofSource,
  TeamSystemEnvelopePostProof,
  TeamSystemEnvelopePostProofResolution,
  TeamSystemEnvelopePostProofSource,
  TeamSystemClosureProof,
  TeamSystemClosureProofResolution,
  TeamSystemClosureProofSource,
  TeamSystemClosureDriverProof,
  TeamSystemClosureDriverProofResolution,
  TeamSystemClosureDriverProofSource,
  TeamSystemPhaseProof,
  TeamSystemPhaseProofResolution,
  TeamSystemPhaseProofSource,
  TeamSystemMaintenanceProof,
  TeamSystemMaintenanceProofResolution,
  TeamSystemMaintenanceProofSource,
  TeamSystemInterruptProof,
  TeamSystemInterruptProofResolution,
  TeamSystemInterruptProofSource,
  TeamSystemTaskReviewProof,
  TeamSystemTaskReviewProofResolution,
  TeamSystemTaskReviewProofSource,
  TeamSystemActivationProof,
  TeamSystemActivationProofResolution,
  TeamSystemActivationProofSource,
  TeamSystemHumanActionProof,
  TeamSystemHumanActionProofResolution,
  TeamSystemHumanActionProofSource,
  TeamSystemTaskLeaseProof,
  TeamSystemTaskLeaseProofResolution,
  TeamSystemTaskLeaseProofSource,
  TeamSystemTaskControlProof,
  TeamSystemTaskControlProofResolution,
  TeamSystemTaskControlProofSource,
  TeamSystemRootCreationProof,
  TeamSystemRootCreationProofResolution,
  TeamSystemRootCreationProofSource,
  TeamSystemChildCreationProof,
  TeamSystemChildCreationProofResolution,
  TeamSystemChildCreationProofSource,
  TeamSystemChannelSummaryProof,
  TeamSystemChannelSummaryProofResolution,
  TeamSystemChannelSummaryProofSource,
  TeamSystemChannelLifecycleProof,
  TeamSystemChannelLifecycleProofResolution,
  TeamSystemChannelLifecycleProofSource,
  TeamSystemWorkspaceAllocationProof,
  TeamSystemWorkspaceAllocationProofResolution,
  TeamSystemWorkspaceAllocationProofSource,
  TeamSystemArchiveProof,
  TeamSystemArchiveProofResolution,
  TeamSystemArchiveProofSource,
  TeamSystemTopologyProof,
  TeamSystemTopologyProofResolution,
  TeamSystemTopologyProofSource,
  TeamSystemSchedulerChannelProof,
  TeamSystemSchedulerChannelProofResolution,
  TeamSystemSchedulerChannelProofSource,
  TeamSystemCancellationCleanupProof,
  TeamSystemCancellationCleanupProofResolution,
  TeamSystemCancellationCleanupProofSource,
  TeamSystemFinalizationCleanupProof,
  TeamSystemFinalizationCleanupProofResolution,
  TeamSystemFinalizationCleanupProofSource,
  TeamSystemWorkflowProof,
  TeamSystemWorkflowProofResolution,
  TeamSystemWorkflowProofSource,
  TeamWatchRequest,
  TeamWatchResult,
} from '../src/index.ts'

class FakeTeamRuntime extends TeamRuntime {
  override inspectTask(): Promise<never> { return Promise.reject(new Error('Fake runtime has no task inspection')) }
  createTeam(_request: TeamCreateRequest): Promise<TeamStateSnapshot> {
    throw new Error('FakeTeamRuntime does not persist Teams')
  }

  inspectMember(): Promise<TeamMemberInspection> { throw new Error('not implemented') }

  getMemberSession(): Promise<TeamMemberSessionSnapshot> { throw new Error('not implemented') }

  browse(): Promise<TeamBrowsePage> { throw new Error('not implemented') }

  getTeamSelection(): Promise<TeamSelectionSnapshot> {
    throw new Error('FakeTeamRuntime does not persist selection views')
  }

  getTeam(_request: TeamGetRequest): Promise<TeamStateSnapshot> {
    throw new Error('FakeTeamRuntime does not persist Teams')
  }

  listTeamsPage(_request: TeamListPageRequest): Promise<TeamListPage> {
    throw new Error('FakeTeamRuntime does not persist Teams')
  }

  archiveTeam(_request: TeamArchiveRequest): Promise<TeamStateSnapshot> {
    throw new Error('FakeTeamRuntime does not persist Teams')
  }

  readAudit(_request: TeamAuditReadRequest): Promise<TeamAuditReadResult> {
    throw new Error('FakeTeamRuntime does not persist Team audit')
  }

  watchTeam(_request: TeamWatchRequest): Promise<TeamWatchResult> {
    throw new Error('FakeTeamRuntime does not persist Teams')
  }

  transitionTeamPhase(_request: TeamPhaseTransitionRequest): Promise<TeamStateSnapshot> {
    throw new Error('FakeTeamRuntime does not persist Teams')
  }

  updateTeamGoal(_request: TeamGoalUpdateRequest): Promise<TeamStateSnapshot> {
    throw new Error('FakeTeamRuntime does not persist Team goals')
  }

  transitionTeamGoalPhase(_request: TeamGoalPhaseTransitionRequest): Promise<TeamStateSnapshot> {
    throw new Error('FakeTeamRuntime does not persist Team goals')
  }

  inviteParticipant(_request: ParticipantInviteRequest): Promise<ParticipantSnapshot> {
    throw new Error('FakeTeamRuntime does not persist participants')
  }

  listParticipantsPage(_request: TeamMemberListPageRequest): Promise<TeamMemberListPage> {
    throw new Error('FakeTeamRuntime does not persist participants')
  }

  transitionParticipantPhase(_request: ParticipantPhaseTransitionRequest): Promise<ParticipantSnapshot> {
    throw new Error('FakeTeamRuntime does not persist participants')
  }

  reserveActivation(_request: ActivationReservationRequest): Promise<ActivationReservationSnapshot> {
    throw new Error('FakeTeamRuntime does not persist activation reservations')
  }

  releaseActivationReservation(_request: ActivationReservationRequest): Promise<ActivationReservationSnapshot> {
    throw new Error('FakeTeamRuntime does not persist activation reservations')
  }

  bindActivation(_request: ActivationBindRequest): Promise<ActivationBindingSnapshot> {
    throw new Error('FakeTeamRuntime does not persist activation bindings')
  }

  updateActivationStatus(_request: ActivationStatusUpdateRequest): Promise<ActivationBindingSnapshot> {
    throw new Error('FakeTeamRuntime does not persist activation statuses')
  }

  fenceActivation(_request: ActivationFenceRequest): Promise<TeamStateSnapshot> {
    throw new Error('FakeTeamRuntime does not fence activation leases')
  }

  quiesceActivation(_request: ActivationQuiesceRequest): Promise<TeamStateSnapshot> {
    throw new Error('FakeTeamRuntime does not quiesce activation leases')
  }

  getActivation(_request: ActivationGetRequest): Promise<ActivationBindingSnapshot> {
    throw new Error('FakeTeamRuntime does not persist activation bindings')
  }

  requestParticipantInterrupt(_request: ParticipantInterruptRequest): Promise<ParticipantInterruptSnapshot> {
    throw new Error('FakeTeamRuntime does not persist participant interrupts')
  }

  listPendingParticipantInterrupts(
    _request: ParticipantInterruptListPendingRequest,
  ): Promise<readonly ParticipantInterruptSnapshot[]> {
    throw new Error('FakeTeamRuntime does not persist participant interrupts')
  }

  acknowledgeParticipantInterrupt(
    _request: ParticipantInterruptAcknowledgeRequest,
  ): Promise<ParticipantInterruptSnapshot> {
    throw new Error('FakeTeamRuntime does not persist participant interrupts')
  }

  createTask(_request: TeamTaskCreateRequest): Promise<TeamTaskSnapshot> {
    throw new Error('FakeTeamRuntime does not persist tasks')
  }

  getTask(_request: TeamTaskGetRequest): Promise<TeamTaskSnapshot> {
    throw new Error('FakeTeamRuntime does not persist tasks')
  }

  beginTaskDelegation(): Promise<TeamTaskSnapshot> { throw new Error('Fixture does not start child Teams') }
  bindTaskDelegation(): Promise<TeamTaskSnapshot> { throw new Error('Fixture does not bind child Teams') }
  settleTaskDelegation(): Promise<TeamTaskSnapshot> { throw new Error('Fixture does not settle child Teams') }
  stallTaskDelegation(): Promise<TeamTaskSnapshot> { throw new Error('Fixture does not stall child Teams') }
  authorizeChildRun(): Promise<import('@clocky/clocky-team').TeamChildRunAuthorization> { throw new Error('Fixture does not authorize child Teams') }

  listTasksPage(_request: TeamTaskListPageRequest): Promise<TeamTaskListPage> {
    throw new Error('FakeTeamRuntime does not persist tasks')
  }

  updateTaskDetails(_request: TeamTaskDetailsUpdateRequest): Promise<TeamTaskSnapshot> {
    throw new Error('FakeTeamRuntime does not persist tasks')
  }

  reconcileTaskCancellation(_request: TeamTaskCancellationReconcileRequest): Promise<TeamTaskSnapshot> {
    throw new Error('FakeTeamRuntime does not reconcile tasks')
  }

  cancelTask(_request: TeamTaskCancelRequest): Promise<TeamTaskSnapshot> {
    throw new Error('FakeTeamRuntime does not cancel tasks')
  }

  deleteTask(_request: TeamTaskDeleteRequest): Promise<TeamTaskSnapshot> {
    throw new Error('FakeTeamRuntime does not tombstone tasks')
  }

  resolveTaskReview(_request: TeamTaskReviewResolveRequest): Promise<TeamTaskSnapshot> {
    throw new Error('FakeTeamRuntime does not resolve task reviews')
  }

  resolveTaskReviewFromResponse(_request: TeamTaskReviewRecoverRequest): Promise<TeamTaskSnapshot> {
    throw new Error('FakeTeamRuntime does not recover task reviews')
  }

  assignTask(_request: TeamTaskAssignRequest): Promise<TeamTaskSnapshot> {
    throw new Error('FakeTeamRuntime does not assign task attempts')
  }

  startTaskAttempt(_request: TeamTaskAttemptStartRequest): Promise<TeamTaskSnapshot> {
    throw new Error('FakeTeamRuntime does not start task attempts')
  }

  claimTaskAttemptStart(_request: TeamTaskAttemptStartClaimRequest): Promise<TeamTaskSnapshot> {
    throw new Error('FakeTeamRuntime does not claim task attempt starts')
  }

  heartbeatTaskAttempt(_request: TeamTaskAttemptHeartbeatRequest): Promise<TeamTaskSnapshot> {
    throw new Error('FakeTeamRuntime does not renew task attempts')
  }

  settleTaskAttempt(_request: TeamTaskAttemptSettleRequest): Promise<TeamTaskSnapshot> {
    throw new Error('FakeTeamRuntime does not settle task attempts')
  }

  expireTaskAttempt(_request: TeamTaskAttemptExpireRequest): Promise<TeamTaskSnapshot> {
    throw new Error('FakeTeamRuntime does not expire task attempts')
  }

  recordWorkspaceObservation(_request: import('../src/types.ts').TeamWorkspaceObservationRequest): Promise<import('../src/types.ts').TeamWorkspaceObservation> {
    throw new Error('FakeTeamRuntime does not persist workspace observations')
  }

  reserveWorkspaceAllocation(_request: TeamWorkspaceAllocationReserveRequest): Promise<TeamWorkspaceAllocationSnapshot> {
    throw new Error('FakeTeamRuntime does not reserve workspace allocations')
  }

  activateWorkspaceAllocation(_request: TeamWorkspaceAllocationActivateRequest): Promise<TeamWorkspaceAllocationSnapshot> {
    throw new Error('FakeTeamRuntime does not activate workspace allocations')
  }

  requestWorkspaceAllocationRelease(_request: TeamWorkspaceAllocationReleaseRequest): Promise<TeamWorkspaceAllocationSnapshot> {
    throw new Error('FakeTeamRuntime does not request workspace allocation release')
  }

  preserveWorkspaceAllocation(_request: TeamWorkspaceAllocationPreserveRequest): Promise<TeamWorkspaceAllocationSnapshot> {
    throw new Error('FakeTeamRuntime does not preserve workspace allocations')
  }

  recordWorkspaceAllocationLoss(): Promise<TeamWorkspaceAllocationSnapshot> {
    throw new Error('FakeTeamRuntime does not persist workspace loss')
  }

  confirmWorkspaceAllocationRelease(_request: TeamWorkspaceAllocationReleaseConfirmRequest): Promise<TeamWorkspaceAllocationSnapshot> {
    throw new Error('FakeTeamRuntime does not confirm workspace allocation release')
  }

  openChannel(_request: ChannelOpenRequest): Promise<ChannelSnapshot> {
    throw new Error('FakeTeamRuntime does not persist channels')
  }

  postChannelEnvelope(_request: ChannelEnvelopePostRequest): Promise<TeamEnvelope> {
    throw new Error('FakeTeamRuntime does not persist channel Envelopes')
  }

  postChannelFinalEnvelope(_request: ChannelFinalPostRequest): Promise<TeamEnvelope> {
    throw new Error('FakeTeamRuntime does not persist channel final Envelopes')
  }

  ackChannelEnvelope(_request: ChannelEnvelopeReceiptRequest): Promise<ChannelReceiptRecord> {
    throw new Error('FakeTeamRuntime does not persist channel receipts')
  }

  claimChannelDelivery(_request: ChannelDeliveryClaimRequest): Promise<ChannelDeliveryClaim | undefined> {
    throw new Error('FakeTeamRuntime does not issue delivery claims')
  }

  listChannelPendingDeliveries(_request: ChannelPendingDeliveryListRequest): Promise<ChannelPendingDeliveryPage> {
    throw new Error('FakeTeamRuntime does not list pending deliveries')
  }

  readChannelSummarySource(_request: import('../src/types.ts').ChannelSummarySourceRequest): Promise<import('../src/types.ts').ChannelSummarySource> {
    throw new Error('unused')
  }

  summarizeChannel(_request: ChannelSummarizeRequest): Promise<ChannelSummaryRecord> {
    throw new Error('FakeTeamRuntime does not summarize channels')
  }

  getChannel(_request: ChannelGetRequest): Promise<ChannelSnapshot> {
    throw new Error('FakeTeamRuntime does not persist channels')
  }

  readChannel(_request: ChannelReadRequest): Promise<ChannelReadResult> {
    throw new Error('FakeTeamRuntime does not persist channels')
  }

  readChannelPage(_request: ChannelReadPageRequest): Promise<ChannelReadPageResult> {
    throw new Error('FakeTeamRuntime does not persist channels')
  }

  compactChannel(_request: TeamChannelCompactRequest): Promise<TeamChannelCompactResult> {
    throw new Error('FakeTeamRuntime does not compact channels')
  }

  compactTeam(_request: TeamJournalCompactRequest): Promise<TeamJournalCompactResult> {
    throw new Error('FakeTeamRuntime does not compact Team journals')
  }

  closeChannel(_request: ChannelCloseRequest): Promise<ChannelSnapshot> {
    throw new Error('FakeTeamRuntime does not persist channels')
  }

  watchChannel(_request: ChannelWatchRequest): Promise<ChannelWatchResult> {
    throw new Error('FakeTeamRuntime does not persist channels')
  }

  resolveActivationActorProof(proof: TeamActorProof): ActivationBindingSnapshot {
    return this.requireActivationActorProof(proof)
  }

  resolveSystemActivationProof(proof: TeamSystemActivationProof): TeamSystemActivationProofResolution {
    return this.requireSystemActivationProof(proof)
  }

  resolveSystemHumanActionProof(proof: TeamSystemHumanActionProof): TeamSystemHumanActionProofResolution {
    return this.requireSystemHumanActionProof(proof)
  }

  resolveSystemTaskLeaseProof(proof: TeamSystemTaskLeaseProof): TeamSystemTaskLeaseProofResolution {
    return this.requireSystemTaskLeaseProof(proof)
  }

  resolveSystemTaskControlProof(proof: TeamSystemTaskControlProof): TeamSystemTaskControlProofResolution {
    return this.requireSystemTaskControlProof(proof)
  }

  resolveSystemRootCreationProof(proof: TeamSystemRootCreationProof): TeamSystemRootCreationProofResolution {
    return this.requireSystemRootCreationProof(proof)
  }

  resolveSystemChildCreationProof(proof: TeamSystemChildCreationProof): TeamSystemChildCreationProofResolution {
    return this.requireSystemChildCreationProof(proof)
  }

  resolveSystemChannelSummaryProof(
    proof: TeamSystemChannelSummaryProof,
  ): TeamSystemChannelSummaryProofResolution {
    return this.requireSystemChannelSummaryProof(proof)
  }

  resolveSystemChannelLifecycleProof(
    proof: TeamSystemChannelLifecycleProof,
  ): TeamSystemChannelLifecycleProofResolution {
    return this.requireSystemChannelLifecycleProof(proof)
  }

  resolveSystemWorkspaceAllocationProof(
    proof: TeamSystemWorkspaceAllocationProof,
  ): TeamSystemWorkspaceAllocationProofResolution {
    return this.requireSystemWorkspaceAllocationProof(proof)
  }

  resolveSystemArchiveProof(proof: TeamSystemArchiveProof): TeamSystemArchiveProofResolution {
    return this.requireSystemArchiveProof(proof)
  }

  resolveSystemTopologyProof(proof: TeamSystemTopologyProof): TeamSystemTopologyProofResolution {
    return this.requireSystemTopologyProof(proof)
  }

  resolveSystemSchedulerChannelProof(
    proof: TeamSystemSchedulerChannelProof,
  ): TeamSystemSchedulerChannelProofResolution {
    return this.requireSystemSchedulerChannelProof(proof)
  }

  resolveSystemCancellationCleanupProof(
    proof: TeamSystemCancellationCleanupProof,
  ): TeamSystemCancellationCleanupProofResolution {
    return this.requireSystemCancellationCleanupProof(proof)
  }

  resolveSystemFinalizationCleanupProof(
    proof: TeamSystemFinalizationCleanupProof,
  ): TeamSystemFinalizationCleanupProofResolution {
    return this.requireSystemFinalizationCleanupProof(proof)
  }

  resolveSystemWorkflowProof(proof: TeamSystemWorkflowProof): TeamSystemWorkflowProofResolution {
    return this.requireSystemWorkflowProof(proof)
  }

  resolveSystemFinalReceiptProof(proof: TeamSystemFinalReceiptProof): TeamSystemFinalReceiptProofResolution {
    return this.requireSystemFinalReceiptProof(proof)
  }

  resolveSystemEnvelopePostProof(proof: TeamSystemEnvelopePostProof): TeamSystemEnvelopePostProofResolution {
    return this.requireSystemEnvelopePostProof(proof)
  }

  resolveSystemClosureProof(proof: TeamSystemClosureProof): TeamSystemClosureProofResolution {
    return this.requireSystemClosureProof(proof)
  }

  resolveSystemClosureDriverProof(
    proof: TeamSystemClosureDriverProof,
  ): TeamSystemClosureDriverProofResolution {
    return this.requireSystemClosureDriverProof(proof)
  }

  resolveSystemPhaseProof(proof: TeamSystemPhaseProof): TeamSystemPhaseProofResolution {
    return this.requireSystemPhaseProof(proof)
  }

  resolveSystemMaintenanceProof(proof: TeamSystemMaintenanceProof): TeamSystemMaintenanceProofResolution {
    return this.requireSystemMaintenanceProof(proof)
  }

  resolveSystemInterruptProof(proof: TeamSystemInterruptProof): TeamSystemInterruptProofResolution {
    return this.requireSystemInterruptProof(proof)
  }

  resolveSystemTaskReviewProof(proof: TeamSystemTaskReviewProof): TeamSystemTaskReviewProofResolution {
    return this.requireSystemTaskReviewProof(proof)
  }

  emitTeam(team: TeamSnapshot): void {
    this.emitTeamEvent({ type: 'team/created', team })
  }

  emitGoal(goal: TeamGoalSnapshot): void {
    this.emitTeamEvent({ type: 'goal/changed', goal, cursor: 2, createdAt: 2 })
  }

  emitRecord(record: ChannelRecord): void {
    this.emitChannelRecord(channelIdSchema.parse('channel-1'), record)
  }

  adjustMetricForTest(metric: 'activeAdmissions', delta: number): void {
    this.adjustMetric(metric, delta)
  }
}

const directAdapter: TeamChannelAdapter = {
  type: 'direct',
  version: 1,
  validateCreate() {},
  initialState() { return {} },
  validateSend() {},
  fold(state) { return state },
  afterAccept() { return [] },
  expectedNext() { return { kind: 'none' } },
  deliveryPlan() { return [] },
  projectView() { return {} },
}

/** Create one source-owned proof that behaves like TeamRun's private runtime token. */
function systemFinalReceiptProof(): TeamSystemFinalReceiptProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system final-receipt proofs are runtime-only and cannot be serialized') },
  })
  return Object.freeze(proof) as TeamSystemFinalReceiptProof
}

/** Create one source-owned proof that behaves like a private activation lifecycle token. */
function systemActivationProof(): TeamSystemActivationProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system activation proofs are runtime-only and cannot be serialized') },
  })
  return Object.freeze(proof) as TeamSystemActivationProof
}

/** Create one source-owned proof that behaves like a private Host human-action token. */
function systemHumanActionProof(): TeamSystemHumanActionProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system human-action proofs are runtime-only and cannot be serialized') },
  })
  return Object.freeze(proof) as TeamSystemHumanActionProof
}

/** Create one source-owned proof that behaves like a private scheduler task-lease token. */
function systemTaskLeaseProof(): TeamSystemTaskLeaseProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system task-lease proofs are runtime-only and cannot be serialized') },
  })
  return Object.freeze(proof) as TeamSystemTaskLeaseProof
}

/** Create one source-owned proof that behaves like TeamRun's private default-worker task-control token. */
function systemTaskControlProof(): TeamSystemTaskControlProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system task-control proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemTaskControlProof
}

/** Create one source-owned proof that behaves like TeamRun's private root-creation token. */
function systemRootCreationProof(): TeamSystemRootCreationProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system root-creation proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemRootCreationProof
}

/** Create one source-owned proof that behaves like a private child-delegation token. */
function systemChildCreationProof(): TeamSystemChildCreationProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system child-creation proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemChildCreationProof
}

/** Create one source-owned proof that behaves like a private channel-summary token. */
function systemChannelSummaryProof(): TeamSystemChannelSummaryProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system channel-summary proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemChannelSummaryProof
}

/** Create one source-owned proof that behaves like a private generic channel lifecycle token. */
function systemChannelLifecycleProof(): TeamSystemChannelLifecycleProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system channel-lifecycle proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemChannelLifecycleProof
}

/** Create one source-owned proof for a private workspace allocation lifecycle operation. */
function systemWorkspaceAllocationProof(): TeamSystemWorkspaceAllocationProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system workspace-allocation proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemWorkspaceAllocationProof
}

/** Create one source-owned proof that behaves like TeamRun's private terminal archive token. */
function systemArchiveProof(): TeamSystemArchiveProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system archive proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemArchiveProof
}

/** Create one source-owned proof that behaves like TeamRun's private topology token. */
function systemTopologyProof(): TeamSystemTopologyProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system topology proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemTopologyProof
}

/** Create one source-owned proof that behaves like the scheduler's private channel lifecycle token. */
function systemSchedulerChannelProof(): TeamSystemSchedulerChannelProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system scheduler channel proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemSchedulerChannelProof
}

/** Create one source-owned proof that behaves like TeamRun's post-release cancellation-cleanup token. */
function systemCancellationCleanupProof(): TeamSystemCancellationCleanupProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system cancellation-cleanup proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemCancellationCleanupProof
}

/** Create one source-owned proof that behaves like TeamRun's post-release finalization-cleanup token. */
function systemFinalizationCleanupProof(): TeamSystemFinalizationCleanupProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system finalization-cleanup proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemFinalizationCleanupProof
}

/** Create one source-owned proof that behaves like TeamRun's private workflow compiler token. */
function systemWorkflowProof(): TeamSystemWorkflowProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system workflow proofs are runtime-only and cannot be serialized') },
  })
  return Object.freeze(proof) as TeamSystemWorkflowProof
}

/** Create one source-owned proof that behaves like a private system Envelope-post token. */
function systemEnvelopePostProof(): TeamSystemEnvelopePostProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system Envelope-post proofs are runtime-only and cannot be serialized') },
  })
  return Object.freeze(proof) as TeamSystemEnvelopePostProof
}

/** Create one source-owned proof that behaves like a private system Team-closure token. */
function systemClosureProof(): TeamSystemClosureProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system closure proofs are runtime-only and cannot be serialized') },
  })
  return Object.freeze(proof) as TeamSystemClosureProof
}

/** Create one source-owned proof that behaves like a private closure-driver token. */
function systemClosureDriverProof(): TeamSystemClosureDriverProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team closure-driver proofs are runtime-only and cannot be serialized') },
  })
  return Object.freeze(proof) as TeamSystemClosureDriverProof
}

/** Create one source-owned proof that behaves like a private system Team-phase token. */
function systemPhaseProof(): TeamSystemPhaseProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system phase proofs are runtime-only and cannot be serialized') },
  })
  return Object.freeze(proof) as TeamSystemPhaseProof
}

/** Create one source-owned proof that behaves like a private system Team-maintenance token. */
function systemMaintenanceProof(): TeamSystemMaintenanceProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system maintenance proofs are runtime-only and cannot be serialized') },
  })
  return Object.freeze(proof) as TeamSystemMaintenanceProof
}

/** Create one source-owned proof that behaves like a private system Team-interrupt token. */
function systemInterruptProof(): TeamSystemInterruptProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system interrupt proofs are runtime-only and cannot be serialized') },
  })
  return Object.freeze(proof) as TeamSystemInterruptProof
}

/** Create one source-owned proof that behaves like a private system task-review token. */
function systemTaskReviewProof(): TeamSystemTaskReviewProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team system task-review proofs are runtime-only and cannot be serialized') },
  })
  return Object.freeze(proof) as TeamSystemTaskReviewProof
}

/** Parse a one-task workflow used by provider capability and quiescence callers. */
function definitionWorkflowPlan() {
  return teamWorkflowPlanSchema.parse({
    version: 1, name: 'review',
    tasks: [{ id: 'review', subject: 'Review', description: 'Review the durable result.', blockedBy: [],
      requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
      budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 }],
    bounds: { maxTasks: 1, maxParallelism: 1, maxTotalAttempts: 1 },
    channel: { participantRoles: ['coordinator', 'worker'], graph: {
      initial: { kind: 'participant', role: 'coordinator' },
      transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 1,
    } },
    result: { kind: 'task-results', taskTemplateIds: ['review'] },
  })
}

async function setup(): Promise<{ ctx: Context; runtimeFiber: Context['fiber'] }> {
  const ctx = new Context()
  const runtimeFiber = await ctx.plugin(FakeTeamRuntime)
  return { ctx, runtimeFiber }
}

describe('TeamRuntime service definition', () => {
  it('rejects loading the abstract Service Definition without a provider', () => {
    const DirectRuntime = TeamRuntime as unknown as new (ctx: Context) => TeamRuntime
    expect(() => { void new DirectRuntime(new Context()) }).toThrow(/abstract Team runtime seam/)
  })

  it('allows a fake provider to satisfy the thin contract without AgentLoop', async () => {
    const { ctx, runtimeFiber } = await setup()
    const events: string[] = []
    let isRuntimeSubject = false
    ctx.on('team/changed', function (event) {
      isRuntimeSubject = this instanceof TeamRuntime
      events.push(event.type)
    })

    const team = teamSnapshotSchema.parse({
      id: 'team-1', depth: 0, maxTeamDepth: 0,
      goal: { teamId: 'team-1', revision: 1, objective: 'review a patch', phase: 'active', budgets: {} },
      phase: 'active', cursor: 1, createdAt: 1, updatedAt: 1,
    })
    const runtime = ctx.teams as FakeTeamRuntime
    runtime.emitTeam(team)
    runtime.emitGoal(team.goal)
    expect(events).toEqual(['team/created', 'goal/changed'])
    expect(isRuntimeSubject).toBe(true)

    await runtimeFiber.dispose()
    expect(ctx.get('teams')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('fails explicitly when a provider has no closure-driver continuation implementation', async () => {
    const { ctx, runtimeFiber } = await setup()
    await expect(ctx.teams.continueTeamClosure({
      teamId: 'team-1' as never,
      expectedCursor: 0,
      actor: {} as TeamSystemClosureDriverProof,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects optional product, scheduler, and workflow capabilities on a minimal provider', async () => {
    const { ctx } = await setup()
    const teamId = teamIdSchema.parse('team-1')
    const channelId = channelIdSchema.parse('channel-1')
    const taskId = teamTaskIdSchema.parse('task-1')
    const participantId = participantIdSchema.parse('coordinator-1')
    const envelopeId = envelopeIdSchema.parse('final-1')
    const planId = teamWorkflowPlanIdSchema.parse('plan-1')
    const actorIssuer = ctx.teams.openActivationActorProofIssuer()
    const binding = activationBindingSnapshotSchema.parse({
      activation: { id: 'activation-1', teamId, participantId, status: 'idle' }, sessionId: 'session-1', provider: 'in-process',
    })
    const actorLease = actorIssuer.issue(binding)
    const actor = actorLease.proof
    const cursor = { teamId, expectedCursor: 1 }
    const taskRevision = { teamId, taskId, expectedRevision: 1 }
    const closure = { ...cursor, idempotencyKey: teamClosureIdempotencyKeySchema.parse('close-1'),
      reason: { code: 'RUN_SETTLED', message: 'The run finished.' }, actor }
    const cancellation = { ...taskRevision, cancellationIdempotencyKey: closure.idempotencyKey,
      cancellationRequestedAt: 1, expectedTeamCursor: 1 }
    const channelClose = { teamId, channelId, expectedCursor: 1, expectedTeamCursor: 1, reason: 'Run settled' }
    const workflow = { ...cursor, planId, expectedRevision: 1, actor: systemWorkflowProof() }
    const humanToken: object = {}
    Object.defineProperty(humanToken, 'toJSON', { enumerable: true, value(): never { throw new TypeError('Human proof is runtime-only') } })
    const humanActor = Object.freeze(humanToken) as TeamHumanActorProof
    const unsupported: Array<() => Promise<unknown>> = [
      () => ctx.teams.upsertHumanAction({ ...cursor, actor: systemHumanActionProof() }),
      () => ctx.teams.resolveHumanAction({ ...cursor, actor: systemHumanActionProof() }),
      () => ctx.teams.recordUsage({ actor, expectedCursor: 1,
        sample: { id: teamUsageSampleIdSchema.parse('usage-1'), turn: 1, step: 1, usage: { inputTokens: 1, outputTokens: 1 } } }),
      () => ctx.teams.authorizeHumanResume({ ...cursor, actor: humanActor }),
      () => ctx.teams.admitTeamFinalResult({ actor: systemFinalReceiptProof(), teamId, channelId, envelopeId,
        envelopeSequence: 1, contentFingerprint: fingerprintTeamFinalContent({ text: 'Final result' }),
        idempotencyKey: teamFinalAdmissionIdempotencyKeySchema.parse('final-1') }),
      () => ctx.teams.completeTeam({ ...closure, finalChannelId: channelId, finalEnvelopeId: envelopeId }),
      () => ctx.teams.failTeam(closure),
      () => ctx.teams.cancelTeam(closure),
      () => ctx.teams.proposeTaskOwner({ ...taskRevision, actor: systemTaskControlProof(), proposedOwnerId: participantId }),
      () => ctx.teams.admitWorkflowPlan({ ...cursor, actor,
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('plan-admit-1'), plan: definitionWorkflowPlan() }),
      () => ctx.teams.getWorkflowPlan({ teamId, planId }),
      () => ctx.teams.listWorkflowPlansPage({ teamId, afterCursor: -1, limit: 1 }),
      () => ctx.teams.bindWorkflowPlanTask({ ...workflow, taskId, templateId: teamWorkflowTaskTemplateIdSchema.parse('review') }),
      () => ctx.teams.bindWorkflowPlanChannel({ ...workflow, channelId }),
      () => ctx.teams.transitionWorkflowPlan({ ...workflow, phase: 'ready' }),
      () => ctx.teams.cancelTeamCancellationTask({ ...cancellation, actor: systemCancellationCleanupProof() }),
      () => ctx.teams.openSchedulerReviewChannel({ ...taskRevision, expectedTeamCursor: 1,
        actor: systemSchedulerChannelProof(), attemptId: taskAttemptIdSchema.parse('attempt-1'),
        initiatorId: participantId, reviewerId: participantIdSchema.parse('reviewer-1'),
        reviewerActivationId: binding.activation.id, reviewerSessionId: binding.sessionId, reviewerProvider: binding.provider }),
      () => ctx.teams.openSchedulerWakeChannel({ ...taskRevision, expectedTeamCursor: 1,
        actor: systemSchedulerChannelProof(), participantId, activationId: binding.activation.id, sessionId: binding.sessionId }),
      () => ctx.teams.expireSchedulerChannelDeliveries({ teamId, channelId, expectedTeamCursor: 1, expectedChannelCursor: 1,
        actor: systemSchedulerChannelProof(), now: 1, limit: 1 }),
      () => ctx.teams.closeSchedulerFailedWakeChannel({ teamId, taskId, participantId, channelId, expectedChannelCursor: 1,
        actor: systemSchedulerChannelProof(), activationId: binding.activation.id, sessionId: binding.sessionId }),
      () => ctx.teams.closeTeamCancellationChannel({ ...channelClose, actor: systemCancellationCleanupProof(),
        cancellationIdempotencyKey: cancellation.cancellationIdempotencyKey,
        cancellationRequestedAt: cancellation.cancellationRequestedAt }),
      () => ctx.teams.closeTeamFinalizationChannel({ ...channelClose, actor: systemFinalizationCleanupProof(),
        finalChannelId: channelId, finalEnvelopeId: envelopeId }),
      () => ctx.teams.closeWorkflowChannel({ ...channelClose, planId, expectedRevision: 1, actor: systemWorkflowProof() }),
    ]
    try {
      for (const call of unsupported) await expect(call()).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    } finally { actorLease.revoke(); actorIssuer.close(); await ctx.fiber.dispose() }
  })

  it('counts idle activation epochs as non-quiescent work', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const state = {
      team: {
        id: 'team-1', depth: 0, maxTeamDepth: 0,
        goal: { teamId: 'team-1', revision: 1, objective: 'quiesce', phase: 'active', budgets: {} },
        phase: 'quiescing', cursor: 1, createdAt: 1, updatedAt: 1,
      },
      goal: { teamId: 'team-1', revision: 1, objective: 'quiesce', phase: 'active', budgets: {} },
      rules: {}, budgets: {}, participants: [],
      activations: [{
        activation: { id: 'activation-1', teamId: 'team-1', participantId: 'participant-1', status: 'idle' },
        sessionId: 'session-1', provider: 'in-process',
      }],
      tasks: [], workspaceAllocations: [], channelIds: [],
    } as unknown as TeamStateSnapshot
    runtime.getTeam = async () => state
    const quiescence = await runtime.inspectQuiescence('team-1' as never)
    expect(quiescence).toMatchObject({
      quiescent: false,
      reasons: ['activations-active'],
      activeActivationIds: ['activation-1'],
    })
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('retains human and workflow blockers after task, activation, and channel work settles', async () => {
    const { ctx } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const goal = { teamId: 'team-1', revision: 2, objective: 'Settle every owner.', phase: 'complete', budgets: {} }
    const creator = { teamId: 'team-1', participantId: 'coordinator-1', activationId: 'activation-1',
      sessionId: 'session-1', provider: 'in-process' }
    const task = { id: 'task-1', teamId: 'team-1', revision: 2, subject: 'Review', description: 'Review the result.',
      execution: { kind: 'participant' as const },
      phase: 'cancelled', blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [],
      workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, reviewHistory: [],
      createCommand: { creator, idempotencyKey: 'task-created' }, maxAttempts: 1, attemptCount: 0, attemptHistory: [] }
    const action = { id: 'action-1', teamId: 'team-1', kind: 'question', phase: 'pending', sessionId: 'session-1',
      participantId: 'coordinator-1', sourceId: 'source-1', details: { question: 'Confirm the result.' }, createdAt: 1, updatedAt: 1 }
    const plan = { id: 'plan-1', teamId: 'team-1', revision: 1, idempotencyKey: 'plan-created',
      plan: definitionWorkflowPlan(), phase: 'compiling', taskBindings: [] }
    let state = teamStateSnapshotSchema.parse({
      team: { id: 'team-1', depth: 0, maxTeamDepth: 0, goal, phase: 'quiescing', cursor: 8, createdAt: 1, updatedAt: 8 },
      goal, rules: {}, budgets: {},
      participants: [{ id: 'coordinator-1', teamId: 'team-1', kind: 'local-agent', role: 'coordinator',
        displayName: 'Coordinator', capabilities: [], phase: 'active' }],
      tasks: [task], activations: [{ activation: { id: 'activation-1', teamId: 'team-1', participantId: 'coordinator-1', status: 'stopping' },
        sessionId: 'session-1', provider: 'in-process' }],
      workspaceAllocations: [], channelIds: ['channel-1'], humanActions: [action], workflowPlans: [plan],
    })
    const channel = channelSnapshotSchema.parse({
      manifest: { id: 'channel-1', teamId: 'team-1', adapter: { type: 'direct', version: 1 },
        participants: [{ id: 'coordinator-1', role: 'coordinator' }], limits: {} },
      phase: 'closed', cursor: 1,
    })
    runtime.getTeam = async (request) => { expect(request.teamId).toBe(state.team.id); return state }
    runtime.getChannel = async (request) => { expect(request.channelId).toBe(channel.manifest.id); return channel }
    try {
      expect(await runtime.inspectQuiescence(state.team.id)).toMatchObject({
        quiescent: false, reasons: ['activations-active', 'human-actions-pending', 'workflow-plans-active'],
        activeTaskIds: [], openChannelIds: [],
      })
      state = teamStateSnapshotSchema.parse({ ...state,
        activations: [{ ...state.activations[0], activation: { ...state.activations[0]?.activation, status: 'offline' } }],
        workflowPlans: [{ ...plan, phase: 'ready', taskBindings: [{ templateId: 'review', taskId: 'task-1' }], channelId: 'channel-1' }],
      })
      expect(await runtime.inspectQuiescence(state.team.id)).toMatchObject({
        quiescent: false, reasons: ['human-actions-pending', 'workflow-plans-active'], activeActivationIds: [],
      })
      state = teamStateSnapshotSchema.parse({ ...state,
        humanActions: [{ ...action, phase: 'resolved', outcome: { accepted: true }, updatedAt: 8 }],
        workflowPlans: [{ ...plan, phase: 'cancelled' }],
      })
      expect(await runtime.inspectQuiescence(state.team.id)).toMatchObject({ quiescent: true, reasons: [] })
    } finally { await ctx.fiber.dispose() }
  })

  it('tracks non-negative operational metrics and exposes audit counters', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    expect(runtime.getMetrics()).toMatchObject({
      activeAdmissions: 0,
      pendingDeliveries: 0,
      activeActivations: 0,
      activeTasks: 0,
      stalledTeams: 0,
      replayLag: 0,
      lastTaskLatencyMs: 0,
      lastReceiptLatencyMs: 0,
      workspaceConflicts: 0,
      teamCompactions: 0,
      channelCompactions: 0,
      checkpointFailures: 0,
      auditProjectionRepairs: 0,
      auditProjectionFailures: 0,
    })
    runtime.adjustMetricForTest('activeAdmissions', 1)
    expect(runtime.getMetrics().activeAdmissions).toBe(1)
    runtime.adjustMetricForTest('activeAdmissions', -1)
    expect(runtime.getMetrics().activeAdmissions).toBe(0)
    expect(() => { runtime.adjustMetricForTest('activeAdmissions', -1) }).toThrow(/became invalid/u)
    runtime.reportWorkspaceConflict()
    expect(runtime.getMetrics().workspaceConflicts).toBe(1)

    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('issues nonserializable revocable activation actor proofs per runtime', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const sourceBinding = activationBindingSnapshotSchema.parse({
      activation: {
        id: 'activation-1', teamId: 'team-1', participantId: 'participant-1', status: 'running',
      },
      sessionId: 'session-1',
      provider: 'in-process',
    })
    const issuer = runtime.openActivationActorProofIssuer()
    const first = issuer.issue(sourceBinding)
    const resolved = runtime.resolveActivationActorProof(first.proof)
    expect(resolved).toEqual(sourceBinding)
    const mutableSource = sourceBinding as unknown as { activation: { status: string } }
    mutableSource.activation.status = 'offline'
    expect(resolved.activation.status).toBe('running')
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.activation)).toBe(true)
    expect(Object.isFrozen(first.proof)).toBe(true)
    expect(() => JSON.stringify(first.proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(first.proof)).toThrow()
    expect(() => issuer.issue({} as ActivationBindingSnapshot)).toThrow()
    expect(() => runtime.resolveActivationActorProof({} as TeamActorProof)).toThrow(expect.objectContaining<Partial<TeamError>>({
      code: 'TEAM_ACTOR_PROOF_INVALID',
    }))

    const second = issuer.issue(activationBindingSnapshotSchema.parse({
      activation: {
        id: 'activation-2', teamId: 'team-1', participantId: 'participant-1', status: 'running',
      },
      sessionId: 'session-1',
      provider: 'in-process',
    }))
    issuer.close()
    expect(runtime.resolveActivationActorProof(first.proof)).toBe(resolved)
    expect(runtime.resolveActivationActorProof(second.proof)).toBeDefined()
    expect(() => issuer.issue(sourceBinding)).toThrow(expect.objectContaining<Partial<TeamError>>({
      code: 'TEAM_ACTOR_PROOF_INVALID',
    }))

    first.revoke()
    first.revoke()
    expect(() => runtime.resolveActivationActorProof(first.proof)).toThrow(expect.objectContaining<Partial<TeamError>>({
      code: 'TEAM_ACTOR_PROOF_INVALID',
    }))

    const otherCtx = new Context()
    const otherFiber = await otherCtx.plugin(FakeTeamRuntime)
    expect(() => (otherCtx.teams as FakeTeamRuntime).resolveActivationActorProof(second.proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    second.revoke()
    await otherFiber.dispose()
    await otherCtx.fiber.dispose()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned system final-receipt proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemFinalReceiptProof()
    const sourceScope = teamSystemFinalReceiptScopeSchema.parse({
      teamId: 'team-1', channelId: 'channel-1', humanId: 'human-1', coordinatorId: 'coordinator-1',
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemFinalReceiptProofSource = {
      name: 'team-run',
      resolveFinalReceiptProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemFinalReceiptScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemFinalReceiptProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemFinalReceiptProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemFinalReceiptProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-run', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(Object.isFrozen(proof)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    const mutableScope = sourceScope as unknown as { humanId: string }
    mutableScope.humanId = 'other-human'
    expect(resolution.scope.humanId).toBe('human-1')

    expect(() => runtime.resolveSystemFinalReceiptProof({} as TeamSystemFinalReceiptProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemFinalReceiptProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_FINAL_RECEIPT_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemFinalReceiptProofSource({ ...source, name: ' team-run' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_FINAL_RECEIPT_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemFinalReceiptProof()
    const invalidSource: TeamSystemFinalReceiptProofSource = {
      name: 'invalid-scope',
      resolveFinalReceiptProof(candidate) {
        return candidate === invalidProof
          ? { teamId: 'team-1' as never, channelId: 'channel-1' as never, humanId: 'same' as never, coordinatorId: 'same' as never }
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemFinalReceiptProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemFinalReceiptProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemFinalReceiptProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemFinalReceiptProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemFinalReceiptProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemFinalReceiptProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemFinalReceiptProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemFinalReceiptProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemFinalReceiptProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned system activation lifecycle proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemActivationProof()
    const sourceScope = teamSystemActivationScopeSchema.parse({
      kind: 'activation-controller-status',
      teamId: 'team-1',
      activationId: 'activation-1',
      participantId: 'participant-1',
      sessionId: 'session-1',
      provider: 'in-process',
      expectedCursor: 4,
      status: 'running',
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemActivationProofSource = {
      name: 'team-activation-controller',
      resolveActivationProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemActivationScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemActivationProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemActivationProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemActivationProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-activation-controller', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(Object.isFrozen(proof)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    const mutableScope = sourceScope as unknown as { status: string }
    mutableScope.status = 'offline'
    expect(resolution.scope).toMatchObject({ status: 'running' })

    expect(() => runtime.resolveSystemActivationProof({} as TeamSystemActivationProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemActivationProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_ACTIVATION_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemActivationProofSource({ ...source, name: ' team-activation-controller' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_ACTIVATION_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemActivationProof()
    const invalidSource: TeamSystemActivationProofSource = {
      name: 'invalid-scope',
      resolveActivationProof(candidate) {
        return candidate === invalidProof
          ? {
            kind: 'activation-controller-status',
            teamId: 'team-1' as never,
            activationId: 'activation-1' as never,
            participantId: 'participant-1' as never,
            sessionId: 'session-1' as never,
            provider: 'in-process',
            expectedCursor: -1,
            status: 'running',
          }
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemActivationProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemActivationProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemActivationProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemActivationProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemActivationProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemActivationProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemActivationProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemActivationProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemActivationProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned system human-action proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemHumanActionProof()
    const sourceScope = teamSystemHumanActionScopeSchema.parse({
      kind: 'host-human-action-upsert',
      teamId: 'team-1',
      expectedCursor: 4,
      action: {
        id: 'question:session-1:source-1',
        teamId: 'team-1',
        kind: 'question',
        phase: 'pending',
        sessionId: 'session-1',
        participantId: 'participant-1',
        sourceId: 'source-1',
        details: { questionRpcId: 'source-1' },
        createdAt: 0,
        updatedAt: 0,
      },
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemHumanActionProofSource = {
      name: 'host-api-proxy',
      resolveHumanActionProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemHumanActionScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemHumanActionProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemHumanActionProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemHumanActionProof(proof)
    expect(resolution).toEqual({ sourceName: 'host-api-proxy', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(Object.isFrozen(proof)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    const mutableScope = sourceScope as unknown as { action: { participantId: string } }
    mutableScope.action.participantId = 'other-participant'
    expect(resolution.scope).toMatchObject({ action: { participantId: 'participant-1' } })

    expect(() => runtime.resolveSystemHumanActionProof({} as TeamSystemHumanActionProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemHumanActionProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_HUMAN_ACTION_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemHumanActionProofSource({ ...source, name: ' host-api-proxy' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_HUMAN_ACTION_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemHumanActionProof()
    const invalidSource: TeamSystemHumanActionProofSource = {
      name: 'invalid-scope',
      resolveHumanActionProof(candidate) {
        return candidate === invalidProof
          ? {
            kind: 'host-human-action-upsert',
            teamId: 'team-1' as never,
            expectedCursor: 0,
            action: {
              id: 'question:session-1:source-1' as never,
              teamId: 'team-1' as never,
              kind: 'question',
              phase: 'pending',
              sessionId: 'session-1' as never,
              participantId: 'participant-1' as never,
              sourceId: 'source-1' as never,
              details: {},
              createdAt: 1,
              updatedAt: 1,
            },
          }
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemHumanActionProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemHumanActionProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemHumanActionProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemHumanActionProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemHumanActionProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemHumanActionProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemHumanActionProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemHumanActionProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemHumanActionProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned system task-lease proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemTaskLeaseProof()
    const sourceScope = teamSystemTaskLeaseScopeSchema.parse({
      kind: 'scheduler-task-assign',
      teamId: 'team-1',
      taskId: 'task-1',
      expectedRevision: 3,
      participantId: 'participant-1',
      activationId: 'activation-1',
      wakeChannelId: 'channel-1',
      leaseDurationMs: 1_000,
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemTaskLeaseProofSource = {
      name: 'team-scheduler-dag',
      resolveTaskLeaseProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemTaskLeaseScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemTaskLeaseProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemTaskLeaseProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemTaskLeaseProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-scheduler-dag', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(Object.isFrozen(proof)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    const mutableScope = sourceScope as unknown as { leaseDurationMs: number }
    mutableScope.leaseDurationMs = 1
    expect(resolution.scope).toMatchObject({ leaseDurationMs: 1_000 })

    expect(() => runtime.resolveSystemTaskLeaseProof({} as TeamSystemTaskLeaseProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemTaskLeaseProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_TASK_LEASE_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemTaskLeaseProofSource({ ...source, name: ' team-scheduler-dag' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_TASK_LEASE_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemTaskLeaseProof()
    const invalidSource: TeamSystemTaskLeaseProofSource = {
      name: 'invalid-scope',
      resolveTaskLeaseProof(candidate) {
        return candidate === invalidProof
          ? {
            kind: 'scheduler-task-expire',
            teamId: 'team-1' as never,
            taskId: 'task-1' as never,
            expectedRevision: 0,
            attemptId: 'attempt-1' as never,
          }
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemTaskLeaseProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemTaskLeaseProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemTaskLeaseProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemTaskLeaseProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemTaskLeaseProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemTaskLeaseProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemTaskLeaseProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemTaskLeaseProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemTaskLeaseProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned system default-worker task-control proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemTaskControlProof()
    const sourceScope = teamSystemTaskControlScopeSchema.parse({
      kind: 'team-run-default-worker-owner-proposal',
      teamId: 'team-1',
      coordinator: {
        teamId: 'team-1', participantId: 'participant-1', activationId: 'activation-1', sessionId: 'session-1', provider: 'in-process',
      },
      taskId: 'task-1',
      expectedRevision: 3,
      proposedOwnerId: 'participant-2',
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemTaskControlProofSource = {
      name: 'team-run',
      resolveTaskControlProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemTaskControlScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemTaskControlProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemTaskControlProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemTaskControlProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-run', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(Object.isFrozen(proof)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    const mutableScope = sourceScope as unknown as { proposedOwnerId: string }
    mutableScope.proposedOwnerId = 'participant-3'
    expect(resolution.scope).toMatchObject({ proposedOwnerId: 'participant-2' })

    expect(() => runtime.resolveSystemTaskControlProof({} as TeamSystemTaskControlProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemTaskControlProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_TASK_CONTROL_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemTaskControlProofSource({ ...source, name: ' team-run' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_TASK_CONTROL_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemTaskControlProof()
    const invalidSource: TeamSystemTaskControlProofSource = {
      name: 'invalid-task-control-scope',
      resolveTaskControlProof(candidate) {
        return candidate === invalidProof
          ? {
            kind: 'team-run-default-worker-cancel',
            teamId: 'team-1' as never,
            coordinator: {
              teamId: 'team-1' as never,
              participantId: 'participant-1' as never,
              activationId: 'activation-1' as never,
              sessionId: 'session-1' as never,
              provider: 'in-process',
            },
            taskId: 'task-1' as never,
            expectedRevision: 0,
          } as never
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemTaskControlProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemTaskControlProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemTaskControlProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemTaskControlProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemTaskControlProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemTaskControlProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemTaskControlProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemTaskControlProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemTaskControlProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned root-creation proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemRootCreationProof()
    const sourceScope = teamSystemRootCreationScopeSchema.parse({
      kind: 'team-run-root-create',
      goal: { objective: 'Create one root Team.', budgets: {} },
      rules: { productTemplate: { id: 'default-v1', version: 1 } },
      budgets: {},
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemRootCreationProofSource = {
      name: 'team-run',
      resolveRootCreationProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemRootCreationScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemRootCreationProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemRootCreationProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemRootCreationProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-run', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(Object.isFrozen(proof)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    const mutableScope = sourceScope as unknown as { goal: { objective: string } }
    mutableScope.goal.objective = 'Mutated outside the source.'
    expect(resolution.scope).toMatchObject({ goal: { objective: 'Create one root Team.' } })

    expect(() => runtime.resolveSystemRootCreationProof({} as TeamSystemRootCreationProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemRootCreationProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_ROOT_CREATION_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemRootCreationProofSource({ ...source, name: ' team-run' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_ROOT_CREATION_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemRootCreationProof()
    const invalidSource: TeamSystemRootCreationProofSource = {
      name: 'invalid-root-creation-scope',
      resolveRootCreationProof(candidate) {
        return candidate === invalidProof
          ? {
            kind: 'wrong-root-create-kind',
            goal: { objective: 'Invalid root creation.', budgets: {} },
            rules: {},
            budgets: {},
          } as never
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemRootCreationProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemRootCreationProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemRootCreationProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemRootCreationProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemRootCreationProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemRootCreationProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemRootCreationProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemRootCreationProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemRootCreationProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned child-creation proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemChildCreationProof()
    const sourceScope = teamSystemChildCreationScopeSchema.parse({
      kind: 'team-child-create',
      goal: { objective: 'Create one child Team.', budgets: {} },
      rules: {},
      budgets: {},
      parentTeamId: 'team-parent',
      parentTaskId: 'task-parent',
      delegationId: 'delegation-runtime',
      expectedParentCursor: 4,
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemChildCreationProofSource = {
      name: 'team-child-delegation',
      resolveChildCreationProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemChildCreationScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemChildCreationProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemChildCreationProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemChildCreationProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-child-delegation', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    expect(() => runtime.resolveSystemChildCreationProof({} as TeamSystemChildCreationProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemChildCreationProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_CHILD_CREATION_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemChildCreationProofSource({ ...source, name: ' team-child-delegation' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_CHILD_CREATION_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemChildCreationProof()
    const invalidSource: TeamSystemChildCreationProofSource = {
      name: 'invalid-child-creation-scope',
      resolveChildCreationProof(candidate) {
        return candidate === invalidProof
          ? { kind: 'wrong-child-create', parentTeamId: 'team-parent', parentTaskId: 'task-parent', expectedParentCursor: 4 } as never
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemChildCreationProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemChildCreationProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemChildCreationProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemChildCreationProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemChildCreationProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemChildCreationProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemChildCreationProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemChildCreationProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemChildCreationProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned channel-summary proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemChannelSummaryProof()
    const sourceScope = teamSystemChannelSummaryScopeSchema.parse({
      kind: 'channel-summary',
      channelId: 'channel-1',
      expectedCursor: 4,
      coveredSequenceRange: { from: 1, to: 2 },
      sourceEnvelopeIds: ['envelope-1'], sourceFingerprint: `sha256:${'0'.repeat(64)}`,
      text: 'One source Envelope.',
      policy: { type: 'summarized', version: 1 },
      idempotencyKey: 'summary-1',
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemChannelSummaryProofSource = {
      name: 'team-channel-summary',
      resolveChannelSummaryProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemChannelSummaryScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemChannelSummaryProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemChannelSummaryProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemChannelSummaryProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-channel-summary', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    expect(() => runtime.resolveSystemChannelSummaryProof({} as TeamSystemChannelSummaryProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemChannelSummaryProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_CHANNEL_SUMMARY_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemChannelSummaryProofSource({ ...source, name: ' team-channel-summary' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_CHANNEL_SUMMARY_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemChannelSummaryProof()
    const invalidSource: TeamSystemChannelSummaryProofSource = {
      name: 'invalid-channel-summary-scope',
      resolveChannelSummaryProof(candidate) {
        return candidate === invalidProof
          ? { kind: 'wrong-channel-summary', channelId: 'channel-1' } as never
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemChannelSummaryProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemChannelSummaryProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemChannelSummaryProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemChannelSummaryProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemChannelSummaryProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemChannelSummaryProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemChannelSummaryProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemChannelSummaryProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemChannelSummaryProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned generic channel lifecycle proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemChannelLifecycleProof()
    const sourceScope = teamSystemChannelLifecycleScopeSchema.parse({
      kind: 'channel-open',
      teamId: 'team-1',
      expectedCursor: 3,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: 'participant-1', role: 'sender' }],
      limits: { maxTurns: 2 },
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemChannelLifecycleProofSource = {
      name: 'team-channel-lifecycle',
      resolveChannelLifecycleProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemChannelLifecycleScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemChannelLifecycleProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemChannelLifecycleProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemChannelLifecycleProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-channel-lifecycle', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    expect(() => runtime.resolveSystemChannelLifecycleProof({} as TeamSystemChannelLifecycleProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemChannelLifecycleProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_CHANNEL_LIFECYCLE_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemChannelLifecycleProofSource({ ...source, name: ' team-channel-lifecycle' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_CHANNEL_LIFECYCLE_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemChannelLifecycleProof()
    const invalidSource: TeamSystemChannelLifecycleProofSource = {
      name: 'invalid-channel-lifecycle-scope',
      resolveChannelLifecycleProof(candidate) {
        return candidate === invalidProof
          ? { kind: 'channel-open', teamId: 'team-1', expectedCursor: 1 } as never
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemChannelLifecycleProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemChannelLifecycleProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemChannelLifecycleProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemChannelLifecycleProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemChannelLifecycleProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemChannelLifecycleProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemChannelLifecycleProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemChannelLifecycleProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemChannelLifecycleProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned workspace allocation proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemWorkspaceAllocationProof()
    const sourceScope = teamSystemWorkspaceAllocationScopeSchema.parse({
      kind: 'workspace-allocation-reserve',
      teamId: 'team-1',
      expectedCursor: 3,
      taskId: 'task-1',
      expectedTaskRevision: 2,
      attemptId: 'attempt-1',
      allocation: {
        id: 'allocation-1', provider: 'worktree-local', mode: 'worktree', assignedRevision: 1,
        participantId: 'participant-1', activationId: 'activation-1', sessionId: 'session-1', baseVersion: 'commit-a',
      },
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemWorkspaceAllocationProofSource = {
      name: 'team-agent-client',
      resolveWorkspaceAllocationProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemWorkspaceAllocationScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemWorkspaceAllocationProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemWorkspaceAllocationProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemWorkspaceAllocationProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-agent-client', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => runtime.resolveSystemWorkspaceAllocationProof({} as TeamSystemWorkspaceAllocationProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemWorkspaceAllocationProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_WORKSPACE_ALLOCATION_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemWorkspaceAllocationProofSource({ ...source, name: ' team-agent-client' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_WORKSPACE_ALLOCATION_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemWorkspaceAllocationProof()
    const invalidSource: TeamSystemWorkspaceAllocationProofSource = {
      name: 'invalid-workspace-allocation-scope',
      resolveWorkspaceAllocationProof(candidate) {
        return candidate === invalidProof ? { kind: 'workspace-allocation-reserve', teamId: 'team-1' } as never : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemWorkspaceAllocationProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemWorkspaceAllocationProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()
    const replacementProof = systemWorkspaceAllocationProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemWorkspaceAllocationProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemWorkspaceAllocationProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemWorkspaceAllocationProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemWorkspaceAllocationProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemWorkspaceAllocationProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemWorkspaceAllocationProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned terminal archive proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemArchiveProof()
    const sourceScope = teamSystemArchiveScopeSchema.parse({
      kind: 'team-run-terminal-archive', teamId: 'team-1', expectedCursor: 5,
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemArchiveProofSource = {
      name: 'team-run',
      resolveArchiveProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemArchiveScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemArchiveProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemArchiveProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemArchiveProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-run', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(Object.isFrozen(proof)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    expect(() => runtime.resolveSystemArchiveProof({} as TeamSystemArchiveProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemArchiveProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_ARCHIVE_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemArchiveProofSource({ ...source, name: ' team-run' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_ARCHIVE_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemArchiveProof()
    const invalidSource: TeamSystemArchiveProofSource = {
      name: 'invalid-archive-scope',
      resolveArchiveProof(candidate) {
        return candidate === invalidProof
          ? { kind: 'wrong-terminal-archive', teamId: 'team-1', expectedCursor: 5 } as never
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemArchiveProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemArchiveProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemArchiveProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemArchiveProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemArchiveProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemArchiveProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemArchiveProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemArchiveProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemArchiveProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned system topology proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemTopologyProof()
    const sourceScope = teamSystemTopologyScopeSchema.parse({
      kind: 'team-run-bootstrap-channel-open',
      teamId: 'team-1',
      expectedCursor: 3,
      humanId: 'participant-human',
      coordinatorId: 'participant-coordinator',
      adapter: { type: 'direct', version: 3 },
      viewPolicy: { type: 'directed', version: 1 },
      participants: [
        { id: 'participant-human', role: 'human' },
        { id: 'participant-coordinator', role: 'coordinator' },
      ],
      limits: {},
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemTopologyProofSource = {
      name: 'team-run',
      resolveTopologyProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemTopologyScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemTopologyProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemTopologyProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemTopologyProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-run', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(Object.isFrozen(proof)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    const mutableScope = sourceScope as unknown as { participants: Array<{ role: string }> }
    mutableScope.participants[0]!.role = 'observer'
    if (resolution.scope.kind !== 'team-run-bootstrap-channel-open') {
      throw new Error('topology proof did not retain its bootstrap channel scope')
    }
    expect(resolution.scope.participants[0]).toMatchObject({ role: 'human' })

    expect(() => runtime.resolveSystemTopologyProof({} as TeamSystemTopologyProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemTopologyProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_TOPOLOGY_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemTopologyProofSource({ ...source, name: ' team-run' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_TOPOLOGY_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemTopologyProof()
    const invalidSource: TeamSystemTopologyProofSource = {
      name: 'invalid-topology-scope',
      resolveTopologyProof(candidate) {
        return candidate === invalidProof
          ? {
            kind: 'team-run-reviewer-phase',
            teamId: 'team-1' as never,
            participantId: 'participant-reviewer' as never,
            expectedCursor: 3,
            expectedPhase: 'invited',
            phase: 'active',
          } as never
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemTopologyProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemTopologyProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemTopologyProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemTopologyProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemTopologyProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemTopologyProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemTopologyProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemTopologyProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemTopologyProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned scheduler channel lifecycle proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemSchedulerChannelProof()
    const sourceScope = teamSystemSchedulerChannelScopeSchema.parse({
      kind: 'scheduler-channel-delivery-expire',
      teamId: 'team-1',
      channelId: 'channel-1',
      expectedTeamCursor: 3,
      expectedChannelCursor: 4,
      now: 5,
      limit: 6,
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemSchedulerChannelProofSource = {
      name: 'team-scheduler-dag',
      resolveSchedulerChannelProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemSchedulerChannelScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemSchedulerChannelProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemSchedulerChannelProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemSchedulerChannelProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-scheduler-dag', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(Object.isFrozen(proof)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    const mutableScope = sourceScope as unknown as { expectedChannelCursor: number }
    mutableScope.expectedChannelCursor = 5
    expect(resolution.scope).toMatchObject({ expectedChannelCursor: 4 })

    expect(() => runtime.resolveSystemSchedulerChannelProof({} as TeamSystemSchedulerChannelProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemSchedulerChannelProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_SCHEDULER_CHANNEL_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemSchedulerChannelProofSource({ ...source, name: ' team-scheduler-dag' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_SCHEDULER_CHANNEL_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemSchedulerChannelProof()
    const invalidSource: TeamSystemSchedulerChannelProofSource = {
      name: 'invalid-scheduler-channel-scope',
      resolveSchedulerChannelProof(candidate) {
        return candidate === invalidProof
          ? {
            kind: 'scheduler-failed-wake-channel-close',
            teamId: 'team-1' as never,
            taskId: 'task-1' as never,
            participantId: 'participant-1' as never,
            activationId: 'activation-1' as never,
            sessionId: 'session-1' as never,
            channelId: 'channel-1' as never,
            expectedChannelCursor: 2,
            reason: 'wrong reason',
          } as never
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemSchedulerChannelProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemSchedulerChannelProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemSchedulerChannelProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemSchedulerChannelProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemSchedulerChannelProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemSchedulerChannelProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemSchedulerChannelProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemSchedulerChannelProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemSchedulerChannelProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned post-release cancellation-cleanup proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemCancellationCleanupProof()
    const sourceScope = teamSystemCancellationCleanupScopeSchema.parse({
      kind: 'team-run-cancellation-task-cancel',
      teamId: 'team-1',
      cancellationIdempotencyKey: 'cancel-1',
      cancellationRequestedAt: 10,
      expectedTeamCursor: 12,
      taskId: 'task-1',
      expectedRevision: 3,
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemCancellationCleanupProofSource = {
      name: 'team-run',
      resolveCancellationCleanupProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemCancellationCleanupScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemCancellationCleanupProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemCancellationCleanupProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemCancellationCleanupProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-run', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(Object.isFrozen(proof)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    const mutableScope = sourceScope as unknown as { expectedRevision: number }
    mutableScope.expectedRevision = 4
    expect(resolution.scope).toMatchObject({ expectedRevision: 3 })

    expect(() => runtime.resolveSystemCancellationCleanupProof({} as TeamSystemCancellationCleanupProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemCancellationCleanupProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_CANCELLATION_CLEANUP_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemCancellationCleanupProofSource({ ...source, name: ' team-run' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_CANCELLATION_CLEANUP_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemCancellationCleanupProof()
    const invalidSource: TeamSystemCancellationCleanupProofSource = {
      name: 'invalid-cancellation-cleanup-scope',
      resolveCancellationCleanupProof(candidate) {
        return candidate === invalidProof
          ? {
            kind: 'team-run-cancellation-channel-close',
            teamId: 'team-1' as never,
            cancellationIdempotencyKey: 'cancel-1' as never,
            cancellationRequestedAt: 10,
            expectedTeamCursor: 12,
            channelId: 'channel-1' as never,
            expectedCursor: 2,
            reason: '',
          } as never
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemCancellationCleanupProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemCancellationCleanupProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemCancellationCleanupProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemCancellationCleanupProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemCancellationCleanupProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemCancellationCleanupProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemCancellationCleanupProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemCancellationCleanupProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemCancellationCleanupProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned post-release finalization-cleanup proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemFinalizationCleanupProof()
    const sourceScope = teamSystemFinalizationCleanupScopeSchema.parse({
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
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemFinalizationCleanupProofSource = {
      name: 'team-run',
      resolveFinalizationCleanupProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemFinalizationCleanupScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemFinalizationCleanupProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemFinalizationCleanupProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemFinalizationCleanupProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-run', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(Object.isFrozen(proof)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    const mutableScope = sourceScope as unknown as { reason: string }
    mutableScope.reason = 'wrong reason'
    expect(resolution.scope).toMatchObject({ reason: 'parent Team completed' })

    expect(() => runtime.resolveSystemFinalizationCleanupProof({} as TeamSystemFinalizationCleanupProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemFinalizationCleanupProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_FINALIZATION_CLEANUP_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemFinalizationCleanupProofSource({ ...source, name: ' team-run' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_FINALIZATION_CLEANUP_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemFinalizationCleanupProof()
    const invalidSource: TeamSystemFinalizationCleanupProofSource = {
      name: 'invalid-finalization-cleanup-scope',
      resolveFinalizationCleanupProof(candidate) {
        return candidate === invalidProof
          ? {
            kind: 'team-run-finalization-channel-close',
            teamId: 'team-1' as never,
            finalChannelId: 'channel-final' as never,
            finalEnvelopeId: 'envelope-final' as never,
            humanId: 'human-1' as never,
            coordinatorId: 'human-1' as never,
            expectedTeamCursor: 12,
            channelId: 'channel-auxiliary' as never,
            expectedCursor: 2,
            reason: 'parent Team completed',
          } as never
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemFinalizationCleanupProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemFinalizationCleanupProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemFinalizationCleanupProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemFinalizationCleanupProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemFinalizationCleanupProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemFinalizationCleanupProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemFinalizationCleanupProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemFinalizationCleanupProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemFinalizationCleanupProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned system workflow compiler proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemWorkflowProof()
    const sourceScope = teamSystemWorkflowScopeSchema.parse({
      kind: 'team-run-workflow-channel-open',
      teamId: 'team-1',
      coordinator: {
        teamId: 'team-1', participantId: 'participant-1', activationId: 'activation-1', sessionId: 'session-1', provider: 'in-process',
      },
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
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemWorkflowProofSource = {
      name: 'team-run',
      resolveWorkflowProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemWorkflowScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemWorkflowProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemWorkflowProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemWorkflowProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-run', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(Object.isFrozen(proof)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    const mutableScope = sourceScope as unknown as { limits: { graph: { changed?: boolean } } }
    mutableScope.limits.graph.changed = true
    expect(resolution.scope).toMatchObject({ limits: { graph: {} } })

    expect(() => runtime.resolveSystemWorkflowProof({} as TeamSystemWorkflowProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemWorkflowProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_WORKFLOW_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemWorkflowProofSource({ ...source, name: ' team-run' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_WORKFLOW_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemWorkflowProof()
    const invalidSource: TeamSystemWorkflowProofSource = {
      name: 'invalid-workflow-scope',
      resolveWorkflowProof(candidate) {
        return candidate === invalidProof
          ? {
            kind: 'team-run-workflow-plan-phase',
            teamId: 'team-1' as never,
            coordinator: {
              teamId: 'team-1' as never,
              participantId: 'participant-1' as never,
              activationId: 'activation-1' as never,
              sessionId: 'session-1' as never,
              provider: 'in-process',
            },
            planId: 'workflow-plan-1' as never,
            expectedCursor: 0,
            expectedRevision: 1,
            phase: 'cancelled',
          } as never
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemWorkflowProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemWorkflowProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemWorkflowProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemWorkflowProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemWorkflowProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemWorkflowProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemWorkflowProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemWorkflowProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemWorkflowProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned system Envelope-post proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemEnvelopePostProof()
    const sourceScope = teamSystemEnvelopePostScopeSchema.parse({
      kind: 'team-run-human-input',
      teamId: 'team-1',
      channelId: 'channel-1',
      humanId: 'human-1',
      coordinatorId: 'coordinator-1',
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemEnvelopePostProofSource = {
      name: 'team-run',
      resolveEnvelopePostProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemEnvelopePostProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemEnvelopePostProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    if (sourceScope.kind !== 'team-run-human-input') throw new Error('fixture requires the human-input source scope')
    const conflictingOwnerProof = systemEnvelopePostProof()
    proofs.set(conflictingOwnerProof, { ...sourceScope, humanId: sourceScope.coordinatorId })
    expect(() => runtime.resolveSystemEnvelopePostProof(conflictingOwnerProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const resolution = runtime.resolveSystemEnvelopePostProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-run', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(Object.isFrozen(proof)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    expect(() => runtime.resolveSystemEnvelopePostProof({} as TeamSystemEnvelopePostProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemEnvelopePostProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_ENVELOPE_POST_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemEnvelopePostProofSource({ ...source, name: ' team-run' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_ENVELOPE_POST_PROOF_SOURCE_INVALID' }))

    const replacementProof = systemEnvelopePostProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemEnvelopePostProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemEnvelopePostProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemEnvelopePostProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemEnvelopePostProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemEnvelopePostProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemEnvelopePostProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned system task-review proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemTaskReviewProof()
    const sourceScope = teamSystemTaskReviewScopeSchema.parse({
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
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemTaskReviewProofSource = {
      name: 'team-scheduler-dag',
      resolveTaskReviewProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemTaskReviewProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemTaskReviewProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const conflictingOwnerProof = systemTaskReviewProof()
    proofs.set(conflictingOwnerProof, { ...sourceScope, reviewerId: sourceScope.initiatorId })
    expect(() => runtime.resolveSystemTaskReviewProof(conflictingOwnerProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const resolution = runtime.resolveSystemTaskReviewProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-scheduler-dag', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(() => runtime.resolveSystemTaskReviewProof({} as TeamSystemTaskReviewProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemTaskReviewProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_TASK_REVIEW_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemTaskReviewProofSource({ ...source, name: ' team-scheduler-dag' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_TASK_REVIEW_PROOF_SOURCE_INVALID' }))

    const replacementProof = systemTaskReviewProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemTaskReviewProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemTaskReviewProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemTaskReviewProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemTaskReviewProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemTaskReviewProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemTaskReviewProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned system Team-closure proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemClosureProof()
    const sourceScope = teamSystemClosureScopeSchema.parse({
      kind: 'team-run-complete',
      teamId: 'team-1',
      channelId: 'channel-1',
      humanId: 'human-1',
      coordinatorId: 'coordinator-1',
      finalEnvelopeId: 'envelope-1',
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemClosureProofSource = {
      name: 'team-run',
      resolveClosureProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemClosureScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemClosureProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemClosureProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemClosureProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-run', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(Object.isFrozen(proof)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    const mutableScope = sourceScope as unknown as { finalEnvelopeId: string }
    mutableScope.finalEnvelopeId = 'other-envelope'
    expect(resolution.scope).toMatchObject({ finalEnvelopeId: 'envelope-1' })

    expect(() => runtime.resolveSystemClosureProof({} as TeamSystemClosureProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemClosureProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_CLOSURE_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemClosureProofSource({ ...source, name: ' team-run' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_CLOSURE_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemClosureProof()
    const invalidSource: TeamSystemClosureProofSource = {
      name: 'invalid-scope',
      resolveClosureProof(candidate) {
        return candidate === invalidProof
          ? {
            kind: 'team-run-cancel',
            teamId: 'team-1' as never,
            channelId: 'channel-1' as never,
            humanId: 'same' as never,
            coordinatorId: 'same' as never,
          }
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemClosureProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemClosureProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemClosureProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemClosureProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemClosureProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemClosureProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemClosureProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemClosureProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemClosureProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned closure-driver proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemClosureDriverProof()
    const sourceScope = teamSystemClosureDriverScopeSchema.parse({
      kind: 'closure-recover-cancel',
      teamId: 'team-1',
      expectedCursor: 4,
      cancellationIdempotencyKey: 'cancel-1',
      cancellationRequestedAt: 12,
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemClosureDriverProofSource = {
      name: 'team-closure-driver',
      resolveClosureDriverProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemClosureDriverScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemClosureDriverProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemClosureDriverProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemClosureDriverProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-closure-driver', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(() => runtime.resolveSystemClosureDriverProof({} as TeamSystemClosureDriverProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemClosureDriverProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_CLOSURE_DRIVER_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemClosureDriverProofSource({ ...source, name: ' team-closure-driver' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_CLOSURE_DRIVER_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemClosureDriverProof()
    const invalidSource: TeamSystemClosureDriverProofSource = {
      name: 'invalid-closure-driver-scope',
      resolveClosureDriverProof(candidate) {
        return candidate === invalidProof
          ? {
            kind: 'closure-recover-complete',
            teamId: 'team-1' as never,
            expectedCursor: 4,
            closureIdempotencyKey: 'complete-1' as never,
            closureRequestedAt: 12,
            finalChannelId: 'channel-1' as never,
          } as never
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemClosureDriverProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemClosureDriverProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemClosureDriverProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemClosureDriverProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemClosureDriverProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemClosureDriverProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemClosureDriverProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemClosureDriverProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemClosureDriverProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned system Team-phase proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemPhaseProof()
    const sourceScope = teamSystemPhaseScopeSchema.parse({
      kind: 'scheduler-stall',
      teamId: 'team-1',
      phase: 'stalled',
      reason: { code: 'TASK_NO_ELIGIBLE_OWNER', message: 'Ready work has no eligible owner.' },
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemPhaseProofSource = {
      name: 'team-scheduler-dag',
      resolvePhaseProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemPhaseScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemPhaseProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemPhaseProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemPhaseProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-scheduler-dag', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(Object.isFrozen(proof)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    const mutableReason = sourceScope as unknown as { reason: { message: string } }
    mutableReason.reason.message = 'Other text'
    expect(resolution.scope).toMatchObject({ reason: { message: 'Ready work has no eligible owner.' } })

    expect(() => runtime.resolveSystemPhaseProof({} as TeamSystemPhaseProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemPhaseProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_PHASE_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemPhaseProofSource({ ...source, name: ' team-scheduler-dag' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_PHASE_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemPhaseProof()
    const invalidSource: TeamSystemPhaseProofSource = {
      name: 'invalid-scope',
      resolvePhaseProof(candidate) {
        return candidate === invalidProof
          ? { kind: 'team-run-resume', teamId: 'team-1' as never, phase: 'stalled' as never }
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemPhaseProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemPhaseProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemPhaseProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemPhaseProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemPhaseProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemPhaseProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemPhaseProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemPhaseProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemPhaseProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned system Team-maintenance proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemMaintenanceProof()
    const sourceScope = teamSystemMaintenanceScopeSchema.parse({
      kind: 'scheduler-channel-compaction',
      teamId: 'team-1',
      channelId: 'channel-1',
      expectedCursor: 7,
      throughSequence: 4,
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemMaintenanceProofSource = {
      name: 'team-scheduler-dag',
      resolveMaintenanceProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemMaintenanceScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemMaintenanceProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemMaintenanceProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemMaintenanceProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-scheduler-dag', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(Object.isFrozen(proof)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    const mutableScope = sourceScope as unknown as { throughSequence: number }
    mutableScope.throughSequence = 0
    expect(resolution.scope).toMatchObject({ throughSequence: 4 })

    expect(() => runtime.resolveSystemMaintenanceProof({} as TeamSystemMaintenanceProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemMaintenanceProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_MAINTENANCE_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemMaintenanceProofSource({ ...source, name: ' team-scheduler-dag' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_MAINTENANCE_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemMaintenanceProof()
    const invalidSource: TeamSystemMaintenanceProofSource = {
      name: 'invalid-scope',
      resolveMaintenanceProof(candidate) {
        return candidate === invalidProof
          ? {
            kind: 'scheduler-team-journal-compaction',
            teamId: 'team-1' as never,
            expectedCursor: -1,
            throughSequence: 0,
          }
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemMaintenanceProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemMaintenanceProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemMaintenanceProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemMaintenanceProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemMaintenanceProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemMaintenanceProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemMaintenanceProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemMaintenanceProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemMaintenanceProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves only live source-owned system Team-interrupt proofs', async () => {
    const { ctx, runtimeFiber } = await setup()
    const runtime = ctx.teams as FakeTeamRuntime
    const proof = systemInterruptProof()
    const sourceScope = teamSystemInterruptScopeSchema.parse({
      kind: 'team-run-human-interrupt',
      teamId: 'team-1',
      channelId: 'channel-1',
      humanId: 'human-1',
      coordinatorId: 'coordinator-1',
    })
    const proofs = new WeakMap([[proof, sourceScope]])
    let sourceFailure: Error | undefined
    const source: TeamSystemInterruptProofSource = {
      name: 'team-run',
      resolveInterruptProof(candidate) {
        const scope = proofs.get(candidate)
        if (scope !== undefined && sourceFailure !== undefined) throw sourceFailure
        return scope === undefined ? undefined : teamSystemInterruptScopeSchema.parse(scope)
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemInterruptProofSource(source)
    }, { inject: ['teams'] }))

    sourceFailure = new Error('The owning source cannot read its current proof scope.')
    expect(() => runtime.resolveSystemInterruptProof(proof)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID', cause: sourceFailure,
    }))
    sourceFailure = undefined
    const resolution = runtime.resolveSystemInterruptProof(proof)
    expect(resolution).toEqual({ sourceName: 'team-run', scope: sourceScope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(Object.isFrozen(proof)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()
    const mutableScope = sourceScope as unknown as { coordinatorId: string }
    mutableScope.coordinatorId = 'other-coordinator'
    expect(resolution.scope).toMatchObject({ coordinatorId: 'coordinator-1' })

    expect(() => runtime.resolveSystemInterruptProof({} as TeamSystemInterruptProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerSystemInterruptProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_INTERRUPT_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerSystemInterruptProofSource({ ...source, name: ' team-run' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_SYSTEM_INTERRUPT_PROOF_SOURCE_INVALID' }))

    const invalidProof = systemInterruptProof()
    const invalidSource: TeamSystemInterruptProofSource = {
      name: 'invalid-scope',
      resolveInterruptProof(candidate) {
        return candidate === invalidProof
          ? {
            kind: 'team-run-human-interrupt',
            teamId: 'team-1' as never,
            channelId: 'channel-1' as never,
            humanId: 'same' as never,
            coordinatorId: 'same' as never,
          }
          : undefined
      },
    }
    const invalidContribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerSystemInterruptProofSource(invalidSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveSystemInterruptProof(invalidProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await invalidContribution.dispose()

    const replacementProof = systemInterruptProof()
    proofs.set(replacementProof, sourceScope)
    proofs.delete(proof)
    expect(() => runtime.resolveSystemInterruptProof(proof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(runtime.resolveSystemInterruptProof(replacementProof)).toMatchObject({ sourceName: source.name })
    const foreignOwner = await setup()
    expect(() => (foreignOwner.ctx.teams as FakeTeamRuntime).resolveSystemInterruptProof(replacementProof))
      .toThrow(expect.objectContaining({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await foreignOwner.ctx.fiber.dispose()
    await contribution.dispose()
    expect(() => runtime.resolveSystemInterruptProof(proof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    const replace = runtime.registerSystemInterruptProofSource({ ...source })
    await contribution.dispose()
    expect(runtime.resolveSystemInterruptProof(replacementProof)).toMatchObject({ sourceName: source.name })
    replace()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('retires an adapter on contribution disposal while an acquired channel lease retains its exact object', async () => {
    const { ctx, runtimeFiber } = await setup()
    const events: string[] = []
    ctx.on('team/adapter-added', (adapter) => { events.push(`added:${adapter.type}/${adapter.version}`) })
    ctx.on('team/adapter-removed', (adapter) => { events.push(`removed:${adapter.type}/${adapter.version}`) })

    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerAdapter(directAdapter)
    }, { inject: ['teams'] }))
    expect(ctx.teams.getAdapter({ type: 'direct', version: 1 })).toBe(directAdapter)
    expect(ctx.teams.listAdapters()).toEqual([{ type: 'direct', version: 1 }])
    const lease = ctx.teams.acquireAdapter({ type: 'direct', version: 1 })
    expect(lease.adapter).toBe(directAdapter)
    expect(ctx.teams.getImplementationLeaseMetrics()).toEqual({
      acceptingAdapterImplementations: 1,
      retiredAdapterImplementations: 0,
      activeAdapterLeases: 1,
      acceptingViewPolicyImplementations: 0,
      retiredViewPolicyImplementations: 0,
      activeViewPolicyLeases: 0,
    })
    expect(() => ctx.teams.registerAdapter(directAdapter)).toThrow(expect.objectContaining<Partial<TeamError>>({
      code: 'TEAM_ADAPTER_DUPLICATE',
    }))

    await contribution.dispose()
    expect(() => ctx.teams.getAdapter({ type: 'direct', version: 1 })).toThrow(expect.objectContaining<Partial<TeamError>>({
      code: 'TEAM_ADAPTER_NOT_FOUND',
    }))
    expect(() => ctx.teams.acquireAdapter({ type: 'direct', version: 1 })).toThrow(expect.objectContaining<Partial<TeamError>>({
      code: 'TEAM_ADAPTER_NOT_FOUND',
    }))
    expect(ctx.teams.listAdapters()).toEqual([])
    expect(lease.adapter).toBe(directAdapter)
    expect(ctx.teams.getImplementationLeaseMetrics()).toMatchObject({
      acceptingAdapterImplementations: 0,
      retiredAdapterImplementations: 1,
      activeAdapterLeases: 1,
    })
    expect(events).toEqual(['added:direct/1', 'removed:direct/1'])

    lease.release()
    lease.release()
    expect(() => lease.adapter).toThrow(/lease is released/u)
    expect(ctx.teams.getImplementationLeaseMetrics()).toMatchObject({
      retiredAdapterImplementations: 0,
      activeAdapterLeases: 0,
    })

    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('lets a newly registered adapter replace a retired same-identity implementation without invalidating its lease', async () => {
    const { ctx, runtimeFiber } = await setup()
    const firstFiber = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerAdapter(directAdapter)
    }, { inject: ['teams'] }))
    const lease = ctx.teams.acquireAdapter(directAdapter)
    await firstFiber.dispose()
    const replacement = { ...directAdapter }
    const replacementFiber = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerAdapter(replacement)
    }, { inject: ['teams'] }))
    expect(ctx.teams.getAdapter({ type: 'direct', version: 1 })).toBe(replacement)
    expect(lease.adapter).toBe(directAdapter)
    expect(ctx.teams.getImplementationLeaseMetrics()).toMatchObject({
      acceptingAdapterImplementations: 1,
      retiredAdapterImplementations: 1,
      activeAdapterLeases: 1,
    })
    lease.release()
    expect(ctx.teams.getImplementationLeaseMetrics()).toMatchObject({ retiredAdapterImplementations: 0 })
    await replacementFiber.dispose()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('retires a view policy on contribution disposal while an acquired lease remains usable', async () => {
    const { ctx, runtimeFiber } = await setup()
    const events: string[] = []
    ctx.on('team/view-policy-added', (viewPolicy) => { events.push(`added:${viewPolicy.type}/${viewPolicy.version}`) })
    ctx.on('team/view-policy-removed', (viewPolicy) => { events.push(`removed:${viewPolicy.type}/${viewPolicy.version}`) })
    const policy = {
      type: 'directed',
      version: 1,
      project() { return {} },
    } satisfies TeamViewPolicy
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerViewPolicy(policy)
    }, { inject: ['teams'] }))
    const lease = ctx.teams.acquireViewPolicy(policy)

    await contribution.dispose()

    expect(() => ctx.teams.getViewPolicy(policy)).toThrow(expect.objectContaining<Partial<TeamError>>({
      code: 'TEAM_ADAPTER_NOT_FOUND',
    }))
    expect(() => ctx.teams.acquireViewPolicy(policy)).toThrow(expect.objectContaining<Partial<TeamError>>({
      code: 'TEAM_ADAPTER_NOT_FOUND',
    }))
    expect(ctx.teams.listViewPolicies()).toEqual([])
    expect(lease.policy).toBe(policy)
    expect(ctx.teams.getImplementationLeaseMetrics()).toMatchObject({
      retiredViewPolicyImplementations: 1,
      activeViewPolicyLeases: 1,
    })
    expect(events).toEqual(['added:directed/1', 'removed:directed/1'])
    lease.release()
    expect(() => lease.policy).toThrow(/lease is released/u)
    expect(ctx.teams.getImplementationLeaseMetrics()).toMatchObject({
      retiredViewPolicyImplementations: 0,
      activeViewPolicyLeases: 0,
    })

    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  for (const kind of ['adapter', 'view-policy'] as const) {
    it(`keeps ${kind} replacement and lease retirement independent across repeated owner disposal`, async () => {
      const { ctx } = await setup()
      const firstPolicy: TeamViewPolicy = { type: 'directed', version: 1, project() { return {} } }
      const replacementPolicy: TeamViewPolicy = { ...firstPolicy }
      const replacementAdapter: TeamChannelAdapter = { ...directAdapter }
      const ref = kind === 'adapter' ? directAdapter : firstPolicy
      const registry = kind === 'adapter' ? {
        register: (replacement: boolean) => ctx.teams.registerAdapter(replacement ? replacementAdapter : directAdapter),
        acquire: () => {
          const lease = ctx.teams.acquireAdapter(ref)
          return { value: () => lease.adapter, isRetired: () => lease.isRetired(), release: () => { lease.release() } }
        },
        current: () => ctx.teams.getAdapter(ref),
        list: () => ctx.teams.listAdapters(),
        counts: () => {
          const metrics = ctx.teams.getImplementationLeaseMetrics()
          return [metrics.acceptingAdapterImplementations, metrics.retiredAdapterImplementations, metrics.activeAdapterLeases]
        },
      } : {
        register: (replacement: boolean) => ctx.teams.registerViewPolicy(replacement ? replacementPolicy : firstPolicy),
        acquire: () => {
          const lease = ctx.teams.acquireViewPolicy(ref)
          return { value: () => lease.policy, isRetired: () => lease.isRetired(), release: () => { lease.release() } }
        },
        current: () => ctx.teams.getViewPolicy(ref),
        list: () => ctx.teams.listViewPolicies(),
        counts: () => {
          const metrics = ctx.teams.getImplementationLeaseMetrics()
          return [metrics.acceptingViewPolicyImplementations, metrics.retiredViewPolicyImplementations, metrics.activeViewPolicyLeases]
        },
      }
      try {
        const disposeFirst = registry.register(false)
        expect(registry.list()).toEqual([{ type: ref.type, version: ref.version }])
        expect(() => registry.register(false)).toThrow(expect.objectContaining({ code: 'TEAM_ADAPTER_DUPLICATE' }))
        const first = registry.acquire()
        const second = registry.acquire()
        expect(first.isRetired()).toBe(false)
        disposeFirst()
        expect(first.isRetired()).toBe(true)
        const disposeReplacement = registry.register(true)
        disposeFirst()
        const replacement = registry.acquire()
        expect(replacement.value()).toBe(registry.current())
        expect(first.value()).not.toBe(replacement.value())
        expect(registry.counts()).toEqual([1, 1, 3])
        first.release()
        first.release()
        expect(first.isRetired()).toBe(false)
        expect(() => first.value()).toThrow(/lease is released/u)
        expect(registry.counts()).toEqual([1, 1, 2])
        replacement.release()
        expect(replacement.isRetired()).toBe(false)
        expect(registry.counts()).toEqual([1, 1, 1])
        second.release()
        expect(registry.counts()).toEqual([1, 0, 0])
        disposeReplacement()
        expect(registry.list()).toEqual([])
        expect(registry.counts()).toEqual([0, 0, 0])
      } finally { await ctx.fiber.dispose() }
    })
  }

  it('composes named policy waterfalls and removes their effects on disposal', async () => {
    const { ctx, runtimeFiber } = await setup()
    const observed: string[] = []
    let isRuntimeSubject = false
    ctx.on('team/policy', function (_request, next) {
      isRuntimeSubject = this instanceof TeamRuntime
      return next()
    })
    const policy: TeamPolicy = {
      name: 'record-send',
      async apply(request, next) {
        observed.push(request.hook)
        return await next()
      },
    }
    const deny: TeamPolicy = {
      name: 'deny-send',
      async apply() {
        return { kind: 'deny', code: 'policy-denied', message: 'sending is disabled' }
      },
    }
    const policyFiber = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerPolicy('send', policy)
      pluginCtx.teams.registerPolicy('send', deny)
    }, { inject: ['teams'] }))

    expect(await ctx.teams.authorize({ hook: 'send', facts: {} }))
      .toEqual({ kind: 'deny', code: 'policy-denied', message: 'sending is disabled' })
    expect(await ctx.teams.authorize({ hook: 'close', facts: {} })).toEqual({ kind: 'allow' })
    expect(observed).toEqual(['send'])
    expect(isRuntimeSubject).toBe(true)
    expect(ctx.teams.listPolicies()).toEqual([
      { hook: 'send', name: 'record-send' },
      { hook: 'send', name: 'deny-send' },
    ])
    expect(() => ctx.teams.registerPolicy('send', policy)).toThrow(expect.objectContaining<Partial<TeamError>>({
      code: 'TEAM_POLICY_DUPLICATE',
    }))

    await policyFiber.dispose()
    expect(await ctx.teams.authorize({ hook: 'send', facts: {} })).toEqual({ kind: 'allow' })
    expect(ctx.teams.listPolicies()).toEqual([])

    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('does not let a stale policy disposer remove a replacement', async () => {
    const { ctx, runtimeFiber } = await setup()
    const policy: TeamPolicy = { name: 'allow', async apply(_request, next) { return await next() } }
    const first = ctx.teams.registerPolicy('send', policy)
    first()
    const replacement = ctx.teams.registerPolicy('send', { ...policy })
    first()
    expect(ctx.teams.listPolicies()).toEqual([{ hook: 'send', name: 'allow' }])
    expect(await ctx.teams.authorize({ hook: 'send', facts: {} })).toEqual({ kind: 'allow' })
    replacement()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('contains post-commit channel observer failures', async () => {
    const { ctx, runtimeFiber } = await setup()
    const observed: string[] = []
    ctx.on('channel/changed', () => { throw new Error('observer failed') })
    // oxlint-disable-next-line typescript/no-misused-promises -- verifies containment of a rejected observer promise.
    ctx.on('channel/changed', () => Promise.reject(new Error('observer rejected')))
    ctx.on('channel/changed', () => { throw Object.create(null) })
    ctx.on('channel/changed', (event) => {
      expect(event.channelId).toBe('channel-1')
      const record = event.record
      if (record.type === 'channel/envelope') {
        expect(Object.isFrozen(record.envelope.payload)).toBe(true)
        expect(() => { (record.envelope.payload as { text: string }).text = 'mutated' }).toThrow()
        const text = record.envelope.payload['text']
        if (typeof text === 'string') observed.push(text)
      }
    })
    const runtime = ctx.teams as FakeTeamRuntime

    expect(() => {
      runtime.emitRecord(channelRecordSchema.parse({
        type: 'channel/envelope',
        envelope: {
          id: 'envelope-1', teamId: 'team-1', channelId: 'channel-1', sequence: 1, senderId: 'participant-1',
          audience: null, kind: 'report', payload: { text: 'original' }, delivery: 'turn', priority: 'normal', createdAt: 1,
        },
        deliveryIntents: [],
      }))
    }).not.toThrow()

    await Promise.resolve()
    expect(observed).toEqual(['original'])

    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('contains adapter and policy observer failures during registration and disposal', async () => {
    const { ctx, runtimeFiber } = await setup()
    ctx.on('team/adapter-added', () => { throw new Error('adapter added') })
    // oxlint-disable-next-line typescript/no-misused-promises -- verifies containment of a rejected observer promise.
    ctx.on('team/adapter-removed', () => Promise.reject(new Error('adapter removed')))
    // oxlint-disable-next-line typescript/no-misused-promises -- verifies containment of a rejected observer promise.
    ctx.on('team/policy-added', () => Promise.reject(new Error('policy added')))
    ctx.on('team/policy-removed', () => { throw new Error('policy removed') })
    const policy: TeamPolicy = { name: 'allow', async apply(_request, next) { return await next() } }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerAdapter(directAdapter)
      pluginCtx.teams.registerPolicy('send', policy)
    }, { inject: ['teams'] }))
    expect(ctx.teams.listAdapters()).toEqual([{ type: 'direct', version: 1 }])
    expect(ctx.teams.listPolicies()).toEqual([{ hook: 'send', name: 'allow' }])
    await expect(contribution.dispose()).resolves.toBeUndefined()
    await Promise.resolve()
    expect(ctx.teams.listAdapters()).toEqual([])
    expect(ctx.teams.listPolicies()).toEqual([])
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })
})
