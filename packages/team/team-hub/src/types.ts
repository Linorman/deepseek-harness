import type { ChannelInvitationSnapshot } from '@clocky/clocky-team'
/** Durable Team-Hub journal, projection, and checkpoint records. @module @clocky/clocky-team-hub/types */

import type {
  ActivationBindingSnapshot,
  ActivationId,
  ChannelId,
  ChannelPostIdempotencyKey,
  ChannelSummaryIdempotencyKey,
  EnvelopeDelivery,
  EnvelopeId,
  ChannelManifest,
  ChannelPhase,
  ChannelRecord,
  ChannelSummaryRecord,
  JsonObject,
  JsonValue,
  ParticipantId,
  ParticipantInterruptSnapshot,
  ParticipantInterruptTarget,
  ParticipantSnapshot,
  TeamId,
  TeamClosureSnapshot,
  TeamFinalAdmission,
  TeamCancellationSnapshot,
  TeamCreationActor,
  TeamAuthorityGrant,
  TeamInterruptId,
  TeamGoalSnapshot,
  TeamHumanActionId,
  TeamHumanActionSnapshot,
  TeamUsageSample,
  TeamUsageSampleId,
  TeamUsageCharge,
  TeamUsageChargeId,
  TeamUsageSnapshot,
  TeamPhase,
  TeamSnapshot,
  TeamTaskId,
  TeamTaskSnapshot,
  TeamWorkspaceObservation,
  TeamTaskExecutionStats,
  TeamWorkspaceAllocationId,
  TeamWorkspaceAllocationSnapshot,
  TeamEnvelope,
  TeamPolicyHook,
  TeamWorkflowPlanId,
  TeamWorkflowPlanSnapshot,
} from '@clocky/clocky-team'

/** Durable format stamped on every Team journal stream. */
export const TEAM_JOURNAL_FORMAT_VERSION = 33
/** Durable format stamped on every channel WAL stream. */
export const CHANNEL_WAL_FORMAT_VERSION = 7
/** Durable format stamped on every Team or channel audit projection stream. */
export const AUDIT_PROJECTION_FORMAT_VERSION = 1
/** Serialization format for Team-journal projection checkpoints. */
export const TEAM_CHECKPOINT_FORMAT_VERSION = 33
/** Serialization format for channel-WAL projection checkpoints. */
export const CHANNEL_CHECKPOINT_FORMAT_VERSION = 10

/** First record in a Team journal. */
export interface TeamCreatedJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'team/created'
  /** Stable Team identity matching the stream suffix. */
  readonly teamId: TeamId
  /** Direct durable parent Team when this Team represents nested work. */
  readonly parentTeamId?: TeamId
  /** Parent Team task that created this nested Team. */
  readonly parentTaskId?: TeamTaskId
  /** Edge distance from a root Team; root Teams have depth zero. */
  readonly depth: number
  /** Absolute subtree depth cap resolved when this Team was created. */
  readonly maxTeamDepth: number
  /** Complete initial Team goal at its immutable revision-one seed. */
  readonly goal: TeamGoalSnapshot
  /** Deployment or template rules frozen at Team creation. */
  readonly rules: JsonObject
  /** Deployment or template budgets frozen at Team creation. */
  readonly budgets: JsonObject
  /** Immutable root/child authority grant resolved at Team creation. */
  readonly authorityGrant?: TeamAuthorityGrant | undefined
  /** System source that created a proof-owned root Team. Child delegation remains outside this slice. */
  readonly createdBy?: TeamCreationActor | undefined
  /** Epoch milliseconds when the Team was created. */
  readonly createdAt: number
}

/** Publication of one child Team's service/coordinator result endpoints. */
export interface TeamChildRunBoundJournalRecord {
  readonly type: 'team/child-run-bound'
  readonly binding: import('@clocky/clocky-team').TeamChildRunBinding
  readonly createdAt: number
}

/** Child-side copy of an independently accepted parent-task result. */
export interface TeamChildResultAdmissionJournalRecord {
  readonly type: 'team/child-result-admitted'
  readonly admission: import('@clocky/clocky-team').TeamChildResultAdmission
  readonly createdAt: number
}

/** Durable Team lifecycle transition. */
export interface TeamPhaseJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'team/phase'
  /** Next durable Team phase. */
  readonly phase: TeamPhase
  /** Durable explanation required when this transition stalls the Team. */
  readonly reason?: { readonly code: string; readonly message: string } | undefined
  /** Epoch milliseconds when the transition was accepted. */
  readonly createdAt: number
}

/** Independent acceptance of one final by the closed TeamRun result sink. */
export interface TeamFinalAdmissionJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'team/final-admitted'
  /** Exact WAL content reference and derived result owner. */
  readonly admission: TeamFinalAdmission
  /** Timestamp matching the flushed result admission. */
  readonly createdAt: number
}

/** Durable typed closure intent accepted before a Team terminal transition. */
export interface TeamClosureJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'team/closure'
  /** Complete authenticated and retry-safe closure facts. */
  readonly closure: TeamClosureSnapshot
  /** Epoch milliseconds when the closure intent was accepted. */
  readonly createdAt: number
}

/** Durable cancellation request that precedes terminal Team cancellation. */
export interface TeamCancellationJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'team/cancellation'
  /** Authenticated cancellation request retained while owned work settles. */
  readonly cancellation: TeamCancellationSnapshot
  /** Epoch milliseconds when cancellation admission was accepted. */
  readonly createdAt: number
}

/** Durable marker hiding a terminal Team from default listings. */
export interface TeamArchiveJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'team/archived'
  /** Epoch milliseconds when the archive marker was accepted. */
  readonly createdAt: number
}

/** Whole durable Team goal value after one compare-and-set mutation. */
export interface GoalChangedJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'goal/changed'
  /** Complete current goal snapshot after the mutation. */
  readonly goal: TeamGoalSnapshot
  /** Epoch milliseconds when the change was accepted. */
  readonly createdAt: number
}

/** Whole durable participant value. */
export interface ParticipantChangedJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'participant/changed'
  /** Complete participant snapshot after the transition. */
  readonly participant: ParticipantSnapshot
  /** Epoch milliseconds when the change was accepted. */
  readonly createdAt: number
}

/** Whole durable task value. */
export interface TaskChangedJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'task/changed'
  /** Complete task snapshot after the mutation. */
  readonly task: TeamTaskSnapshot
  /** Epoch milliseconds when the change was accepted. */
  readonly createdAt: number
}

/** Whole durable workspace allocation value after one lifecycle mutation. */
export interface WorkspaceAllocationChangedJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'workspace-allocation/changed'
  /** Complete provider-owned allocation snapshot after the mutation. */
  readonly allocation: TeamWorkspaceAllocationSnapshot
  /** Epoch milliseconds when the lifecycle transition was accepted. */
  readonly createdAt: number
}

/** Provider scan fact independent of resource lifecycle changes. */
export interface WorkspaceObservedJournalRecord {
  readonly type: 'workspace/observed'
  readonly observation: TeamWorkspaceObservation
  readonly createdAt: number
}

/** Whole durable activation binding value. */
export interface ActivationChangedJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'activation/changed'
  /** Complete binding after creation or status update. */
  readonly binding: ActivationBindingSnapshot
  /** Epoch milliseconds when the binding transition was accepted. */
  readonly createdAt: number
}

/** Durable request for one exact participant activation to stop its current turn softly. */
export interface ParticipantInterruptRequestedJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'participant-interrupt/requested'
  /** Complete unacknowledged interrupt selected by the Hub. */
  readonly interrupt: ParticipantInterruptSnapshot
  /** Epoch milliseconds when the request was accepted. */
  readonly createdAt: number
}

/** Durable acknowledgement from the exact activation selected by a prior interrupt request. */
export interface ParticipantInterruptAcknowledgedJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'participant-interrupt/acknowledged'
  /** Interrupt whose pending state this acknowledgement closes. */
  readonly interruptId: TeamInterruptId
  /** Exact immutable binding selected by the request. */
  readonly target: ParticipantInterruptTarget
  /** Epoch milliseconds when the acknowledgement was accepted. */
  readonly createdAt: number
}

/** Reference to a channel WAL that became reachable from a Team journal. */
export interface ChannelAttachedJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'channel/attached'
  /** Channel whose complete protocol data remains in its own WAL. */
  readonly channelId: ChannelId
  /** Epoch milliseconds when the reference was accepted. */
  readonly createdAt: number
}

/** Durable governance denial retained for audit and replay diagnostics. */
export interface PolicyDeniedJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'policy/denied'
  /** Operation hook whose policy rejected the command. */
  readonly hook: TeamPolicyHook
  /** Optional authenticated actor that requested the operation. */
  readonly actorId?: ParticipantId | undefined
  /** Stable policy denial classification. */
  readonly code: string
  /** Human-readable denial explanation. */
  readonly message: string
  /** Provider-validated facts supplied to the policy waterfall. */
  readonly facts: JsonObject
  /** Epoch milliseconds when the denial was recorded. */
  readonly createdAt: number
}

/** Whole durable Team human-action value after one request or resolution. */
export interface HumanActionChangedJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'human-action/changed'
  /** Complete current interaction snapshot. */
  readonly action: TeamHumanActionSnapshot
  /** Epoch milliseconds when the change was accepted. */
  readonly createdAt: number
}

/** Durable provider usage sample accepted by a Team journal. */
export interface UsageChangedJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'usage/changed'
  /** Complete model-step usage observation. */
  readonly sample: TeamUsageSample
  /** Aggregate after applying the sample. */
  readonly usage: TeamUsageSnapshot
  /** Epoch milliseconds when the sample was accepted. */
  readonly createdAt: number
}

/** Durable child-usage charge waiting to reach the direct parent Team. */
export interface UsageParentChargePendingJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'usage/parent-charge-pending'
  /** Exact charge that must be accepted by the parent before more child work. */
  readonly charge: TeamUsageCharge
  /** Epoch milliseconds when the pending charge was retained. */
  readonly createdAt: number
}

/** Durable child-usage charge accepted by the current parent Team. */
export interface UsageChildChargeJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'usage/child-charged'
  /** Exact child charge accepted into this Team's subtree aggregate. */
  readonly charge: TeamUsageCharge
  /** Aggregate after replacing or applying the child charge. */
  readonly usage: TeamUsageSnapshot
  /** Epoch milliseconds when the charge was accepted. */
  readonly createdAt: number
}

/** Durable acknowledgement that one parent accepted a pending child charge. */
export interface UsageParentChargeSettledJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'usage/parent-charge-settled'
  /** Charge identity whose pending state is removed. */
  readonly chargeId: TeamUsageChargeId
  /** Epoch milliseconds when the acknowledgement was retained. */
  readonly createdAt: number
}

/** Whole durable workflow-plan revision after admission, binding, or transition. */
export interface WorkflowPlanChangedJournalRecord {
  /** Closed durable-record discriminator. */
  readonly type: 'workflow-plan/changed'
  /** Complete workflow plan projection after this mutation. */
  readonly plan: TeamWorkflowPlanSnapshot
  /** Epoch milliseconds when the revision was accepted. */
  readonly createdAt: number
}

/** One exact record accepted by a Team journal. */
export type TeamJournalRecord =
  | TeamChildResultAdmissionJournalRecord
  | TeamChildRunBoundJournalRecord
  | TeamCreatedJournalRecord
  | TeamPhaseJournalRecord
  | TeamFinalAdmissionJournalRecord
  | TeamClosureJournalRecord
  | TeamCancellationJournalRecord
  | TeamArchiveJournalRecord
  | GoalChangedJournalRecord
  | ParticipantChangedJournalRecord
  | TaskChangedJournalRecord
  | WorkspaceAllocationChangedJournalRecord
  | WorkspaceObservedJournalRecord
  | ActivationChangedJournalRecord
  | ParticipantInterruptRequestedJournalRecord
  | ParticipantInterruptAcknowledgedJournalRecord
  | ChannelAttachedJournalRecord
  | HumanActionChangedJournalRecord
  | UsageChangedJournalRecord
  | UsageParentChargePendingJournalRecord
  | UsageChildChargeJournalRecord
  | UsageParentChargeSettledJournalRecord
  | WorkflowPlanChangedJournalRecord
  | PolicyDeniedJournalRecord

/** JSON-safe Team projection written into a checkpoint. */
export interface TeamProjectionData {
  /** Unique accepted result retained with its WAL provenance for the Team lifetime. */
  readonly finalAdmission: TeamFinalAdmission | null
  /** Current Team lifecycle projection. */
  readonly team: TeamSnapshot
  /** Current revisioned Team goal, duplicated for direct state consumers. */
  readonly goal: TeamGoalSnapshot
  /** Creation-time Team rules. */
  readonly rules: JsonObject
  /** Creation-time Team budgets. */
  readonly budgets: JsonObject
  /** Participant snapshots in journal order. */
  readonly participants: readonly ParticipantSnapshot[]
  /** Incremental attempt aggregates checked against retained attempts during recovery. */
  readonly taskExecutionStats?: readonly TeamTaskExecutionStats[]
  /** Task snapshots in first-record order. */
  readonly tasks: readonly TeamTaskSnapshot[]
  /** Workspace allocation snapshots in first-reservation order. */
  readonly workspaceAllocations: readonly TeamWorkspaceAllocationSnapshot[]
  /** Activation bindings in first-record order. */
  readonly activations: readonly ActivationBindingSnapshot[]
  /** Participant interrupt requests in durable request order. */
  readonly interrupts: readonly ParticipantInterruptSnapshot[]
  /** Human actions keyed by stable Team-owned interaction id. */
  readonly humanActions?: readonly TeamHumanActionSnapshot[]
  /** Durable Team usage aggregate. */
  readonly usage?: TeamUsageSnapshot
  /** Idempotent provider samples retained for replay replacement. */
  readonly usageSamples?: readonly TeamUsageSample[]
  /** Child usage charges already accepted by this Team. */
  readonly usageCharges?: readonly TeamUsageCharge[]
  /** Child usage charges awaiting this Team's direct parent. */
  readonly pendingParentCharges?: readonly TeamUsageCharge[]
  /** Durable workflow plans in admission order. */
  readonly workflowPlans?: readonly TeamWorkflowPlanSnapshot[]
  /** Channel ids attached by the Team journal in append order. */
  readonly channelIds: readonly ChannelId[]
}

/** Mutable lookup form of one folded Team projection. */
export interface TeamProjection {
  /** Unique accepted result retained with its WAL provenance for the Team lifetime. */
  readonly finalAdmission: TeamFinalAdmission | null
  /** Current Team lifecycle projection. */
  readonly team: TeamSnapshot
  /** Creation-time Team rules. */
  readonly rules: JsonObject
  /** Creation-time Team budgets. */
  readonly budgets: JsonObject
  /** Participants keyed by their stable id. */
  readonly participants: Map<ParticipantId, ParticipantSnapshot>
  /** Attempt aggregates keyed by Participant and canonical required-capability set. */
  readonly taskExecutionStats: Map<string, TeamTaskExecutionStats>
  /** Tasks keyed by their stable id. */
  readonly tasks: Map<TeamTaskId, TeamTaskSnapshot>
  /** Provider allocations keyed by their stable provider-minted identity. */
  readonly workspaceAllocations: Map<TeamWorkspaceAllocationId, TeamWorkspaceAllocationSnapshot>
  /** Activation bindings keyed by their provider-owned epoch identity. */
  readonly activations: Map<ActivationId, ActivationBindingSnapshot>
  /** Participant interrupts keyed by their Hub-minted identity. */
  readonly interrupts: Map<TeamInterruptId, ParticipantInterruptSnapshot>
  /** Human actions keyed by stable Team-owned interaction id. */
  readonly humanActions: Map<TeamHumanActionId, TeamHumanActionSnapshot>
  /** Durable Team usage aggregate. */
  readonly usage: TeamUsageSnapshot
  /** Provider usage samples keyed by idempotency identity. */
  readonly usageSamples: Map<TeamUsageSampleId, TeamUsageSample>
  /** Child usage charges keyed by their stable propagation identity. */
  readonly usageCharges: Map<TeamUsageChargeId, TeamUsageCharge>
  /** Child usage charges awaiting the direct parent Team. */
  readonly pendingParentCharges: Map<TeamUsageChargeId, TeamUsageCharge>
  /** Declarative workflow plans keyed by their Hub-minted identity. */
  readonly workflowPlans: Map<TeamWorkflowPlanId, TeamWorkflowPlanSnapshot>
  /** Referenced channel ids keyed by their stable id. */
  readonly channelIds: Set<ChannelId>
}

/** Checkpoint payload for one Team journal. */
export interface TeamProjectionCheckpoint {
  /** Distinguishes Team checkpoints from channel checkpoints. */
  readonly kind: 'team-projection'
  /** Team-Hub checkpoint serialization version. */
  readonly version: number
  /** Team selected by the checkpoint. */
  readonly teamId: TeamId
  /** Checkpointed journal projection. */
  readonly projection: TeamProjectionData
}

/** One pending recipient delivery derived from an accepted channel Envelope. */
export interface PendingChannelDelivery {
  /** Accepted Envelope that still awaits this recipient's durable admission. */
  readonly envelopeId: EnvelopeId
  /** Channel-WAL cursor occupied by the accepted Envelope. */
  readonly envelopeSequence: number
  /** Recipient treatment selected by the adapter. */
  readonly delivery: EnvelopeDelivery
  /** Absolute expiry time derived from the accepted Envelope TTL, when present. */
  readonly expiresAt?: number | undefined
}

/** JSON-safe checkpoint row for one recipient's pending delivery. */
export interface PendingChannelDeliveryData extends PendingChannelDelivery {
  /** Recipient that has not yet acknowledged this Envelope. */
  readonly participantId: ParticipantId
}

/** JSON-safe checkpoint row for one recipient's monotonic high-water cursor. */
export interface ChannelReceiptCursorData {
  /** Participant whose durable admissions this cursor summarizes. */
  readonly participantId: ParticipantId
  /** Highest acknowledged Envelope channel-WAL cursor for this participant. */
  readonly cursor: number
}

/** JSON-safe sender/key lookup for one accepted idempotent channel post. */
export interface ChannelPostIdempotencyData {
  /** Sender namespace for the opaque retry key. */
  readonly senderId: ParticipantId
  /** Opaque retry key accepted with the original post. */
  readonly idempotencyKey: ChannelPostIdempotencyKey
  /** Original immutable Envelope returned by matching retry requests. */
  readonly envelope: TeamEnvelope
}

/** JSON-safe checkpoint form of one folded channel WAL. */
export interface ChannelProjectionData {
  /** Frozen invitations and exact endpoint confirmations. */
  readonly invitations: readonly ChannelInvitationSnapshot[]
  /** Frozen channel protocol configuration. */
  readonly manifest: ChannelManifest
  /** Current durable channel lifecycle phase. */
  readonly phase: ChannelPhase
  /** Highest WAL sequence represented by the projection. */
  readonly cursor: number
  /** Adapter-owned pure fold state. */
  readonly state: JsonValue
  /** Every recipient admission still derived from accepted Envelopes. */
  readonly pendingDeliveries: readonly PendingChannelDeliveryData[]
  /** Per-recipient receipt high-water cursors. */
  readonly receiptCursors: readonly ChannelReceiptCursorData[]
  /** Sender-scoped retry keys retained for idempotent post replay. */
  readonly postIdempotency: readonly ChannelPostIdempotencyData[]
  /** Summary-command retry keys retained for deterministic replay. */
  readonly summaries: readonly ChannelSummaryRecord[]
}

/** Folded channel WAL state retained by the Hub. */
export interface ChannelProjection {
  /** Invitation state keyed by immutable member identity. */
  readonly invitations: Map<ParticipantId, ChannelInvitationSnapshot>
  /** Frozen channel protocol configuration. */
  readonly manifest: ChannelManifest
  /** Current durable channel lifecycle phase. */
  readonly phase: ChannelPhase
  /** Highest WAL sequence represented by the projection. */
  readonly cursor: number
  /** Adapter-owned pure fold state. */
  readonly state: JsonValue
  /** Pending recipient admissions keyed by recipient then Envelope identity. */
  readonly pendingDeliveries: Map<ParticipantId, Map<EnvelopeId, PendingChannelDelivery>>
  /** Per-recipient maximum Envelope WAL cursor durably acknowledged so far. */
  readonly receiptCursors: Map<ParticipantId, number>
  /** Accepted retry keys keyed by sender then opaque key. */
  readonly postIdempotency: Map<ParticipantId, Map<ChannelPostIdempotencyKey, TeamEnvelope>>
  /** Durable summaries keyed by their channel-scoped retry identity. */
  readonly summaries: Map<ChannelSummaryIdempotencyKey, ChannelSummaryRecord>
}

/** Checkpoint payload for one channel WAL. */
export interface ChannelProjectionCheckpoint {
  /** Distinguishes channel checkpoints from Team checkpoints. */
  readonly kind: 'channel-projection'
  /** Team-Hub checkpoint serialization version. */
  readonly version: number
  /** Channel selected by the checkpoint. */
  readonly channelId: ChannelId
  /** Checkpointed channel projection. */
  readonly projection: ChannelProjectionData
}

/** One durable channel record together with its storage cursor. */
export interface ChannelJournalEntry {
  /** Storage-assigned WAL cursor. */
  readonly cursor: number
  /** Parsed channel WAL record. */
  readonly record: ChannelRecord
}
