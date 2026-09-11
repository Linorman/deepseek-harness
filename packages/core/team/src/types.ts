/**
 * Team work-system identities, records, adapter inputs, and policy vocabulary.
 * This module contains only type declarations so providers can depend on it
 * without importing a runtime implementation.
 *
 * @module @clocky/clocky-team/types
 */

import type { Branded } from '@clocky/clocky-brand'
import type { SessionId, TeamChannelViewEventData } from '@clocky/clocky-session/types'

export type { TeamChannelViewEventData } from '@clocky/clocky-session/types'

/** One durable user-visible work system. */
export type TeamId = Branded<'TeamId'>

/** One logical human, local agent, remote agent, or service in a Team. */
export type ParticipantId = Branded<'ParticipantId'>

/** One live residency epoch for an agent participant. */
export type ActivationId = Branded<'ActivationId'>

/** One durable request to softly interrupt a participant activation. */
export type TeamInterruptId = Branded<'TeamInterruptId'>

/** One bounded protocol conversation inside a Team. */
export type ChannelId = Branded<'ChannelId'>

/** One Hub-accepted channel event. */
export type EnvelopeId = Branded<'EnvelopeId'>

/** One opaque sender-scoped key that identifies a retryable channel post. */
export type ChannelPostIdempotencyKey = Branded<'ChannelPostIdempotencyKey'>

/** One opaque channel-scoped key that identifies a retryable summary command. */
export type ChannelSummaryIdempotencyKey = Branded<'ChannelSummaryIdempotencyKey'>
/** Digest binding a summary to the exact ordered source Envelope content. */
export type ChannelSummarySourceFingerprint = Branded<'ChannelSummarySourceFingerprint'>

/** One opaque key that identifies a retryable Team closure command. */
export type TeamClosureIdempotencyKey = Branded<'TeamClosureIdempotencyKey'>

/** One opaque creator-scoped key that identifies a retryable Team task creation. */
export type TeamTaskCreateIdempotencyKey = Branded<'TeamTaskCreateIdempotencyKey'>

/** One Team-local task in the shared work graph. */
export type TeamTaskId = Branded<'TeamTaskId'>

/** One lease-backed execution attempt for a Team task. */
export type TaskAttemptId = Branded<'TaskAttemptId'>

/** One provider-minted durable allocation for a Team task attempt. */
export type TeamWorkspaceAllocationId = Branded<'TeamWorkspaceAllocationId'>

/** One durable Team-wide human-interaction identity. */
export type TeamHumanActionId = Branded<'TeamHumanActionId'>

/** Opaque source request identity supplied by the approval/question transport. */
export type TeamHumanActionSourceId = Branded<'TeamHumanActionSourceId'>

/** One idempotent provider usage observation for a Team model step. */
export type TeamUsageSampleId = Branded<'TeamUsageSampleId'>

/** One idempotent usage charge propagated from a child Team to its parent. */
export type TeamUsageChargeId = Branded<'TeamUsageChargeId'>

/** One durable, Team-owned declarative workflow admission. */
export type TeamWorkflowPlanId = Branded<'TeamWorkflowPlanId'>

/** One retry identity for a declarative workflow admission. */
export type TeamWorkflowPlanIdempotencyKey = Branded<'TeamWorkflowPlanIdempotencyKey'>

/** One plan-local task template label. */
export type TeamWorkflowTaskTemplateId = Branded<'TeamWorkflowTaskTemplateId'>

/** A JSON scalar accepted in Team durable and wire records. */
export type JsonScalar = string | number | boolean | null

/** A lossless JSON value accepted in Team durable and wire records. */
export type JsonValue = JsonScalar | JsonObject | readonly JsonValue[]

/** A JSON object accepted in Team durable and wire records. */
export interface JsonObject {
  readonly [key: string]: JsonValue
}

/** Typed resource ceilings accepted in Team and task budget objects. */
export interface TeamResourceBudget {
  /** Maximum uncached input tokens. */
  readonly maxInputTokens?: number
  /** Maximum output tokens, including provider-reported reasoning tokens. */
  readonly maxOutputTokens?: number
  /** Maximum combined input and output tokens. */
  readonly maxTotalTokens?: number
  /** Maximum model turns attributable to the owner. */
  readonly maxTurns?: number
  /** Maximum wall-clock milliseconds for the owner. */
  readonly maxWallTimeMs?: number
  /** Maximum normalized cost units. */
  readonly maxCostUnits?: number
  /** Maximum retry attempts or retries, depending on the budget owner. */
  readonly maxRetries?: number
  /** Maximum concurrent task attempts. */
  readonly maxConcurrency?: number
  /** Maximum bytes of published artifacts. */
  readonly maxArtifactBytes?: number
  /** Namespaced provider-specific budget ceilings. */
  readonly extensions?: JsonObject
}

/** Immutable authority subset carried by a Team or Participant. */
export interface TeamAuthorityGrant {
  /** Team operations this authority may request. */
  readonly operations: readonly TeamPolicyHook[]
  /** Workspace modes this authority may allocate. */
  readonly workspaceModes: readonly TeamTaskWorkspaceMode[]
  /** Workspace-relative read prefixes this authority may inspect. */
  readonly readScopes: readonly string[]
  /** Workspace-relative write prefixes this authority may modify. */
  readonly writeScopes: readonly string[]
  /** Optional eligible-participant restriction that descendants may only narrow. */
  readonly placement?: TeamTaskPlacement | undefined
  /** Resource ceilings attached to this authority. */
  readonly budgets: TeamResourceBudget
}

/** Durable Team lifecycle. */
export type TeamPhase = 'provisioning' | 'active' | 'quiescing' | 'stalled' | 'completed' | 'failed' | 'cancelled'

/** Durable explanation retained when a Team cannot make progress. */
export interface TeamStallReason {
  /** Stable provider- or policy-defined blocking classification. */
  readonly code: string
  /** Human-readable explanation of the incomplete work. */
  readonly message: string
}

/** Operation that owns a Team's terminal closure intent. */
export type TeamClosureKind = 'complete' | 'fail' | 'cancel'

/** Authenticated actor that may request a Team closure. */
export type TeamClosureActor =
  | { readonly kind: 'participant'; readonly participantId: ParticipantId }
  | { readonly kind: 'system'; readonly name: string }

/** Durable system origin recorded when a root Team is created through a trusted source. */
export interface TeamCreationActor {
  /** Root creation is currently owned only by registered system sources. */
  readonly kind: 'system'
  /** Stable registered source name, retained as non-secret provenance. */
  readonly name: string
}

/** Durable closure intent retained before a Team reaches its terminal phase. */
export interface TeamClosureSnapshot {
  /** Team whose admission is being closed. */
  readonly teamId: TeamId
  /** Closure operation selected by the caller. */
  readonly kind: TeamClosureKind
  /** Retry identity for this closure command. */
  readonly idempotencyKey: TeamClosureIdempotencyKey
  /** Authenticated actor that requested the closure. */
  readonly actor: TeamClosureActor
  /** Structured reason retained for audit and replay. */
  readonly reason: TeamStallReason
  /** Final channel selected by a successful completion, when applicable. */
  readonly finalChannelId?: ChannelId | undefined
  /** Final Envelope selected by a successful completion, when applicable. */
  readonly finalEnvelopeId?: EnvelopeId | undefined
  /** Epoch milliseconds when the closure intent was accepted. */
  readonly requestedAt: number
}

/** Durable cancellation request retained while owned work is winding down. */
export interface TeamCancellationSnapshot {
  /** Team whose new admission is closed. */
  readonly teamId: TeamId
  /** Retry identity for the cancellation command. */
  readonly idempotencyKey: TeamClosureIdempotencyKey
  /** Authenticated actor that requested cancellation. */
  readonly actor: TeamClosureActor
  /** Structured reason retained for audit and replay. */
  readonly reason: TeamStallReason
  /** Epoch milliseconds when cancellation admission was accepted. */
  readonly requestedAt: number
}

/** Durable objective lifecycle independent of the enclosing Team lifecycle. */
export type TeamGoalPhase = 'active' | 'paused' | 'blocked' | 'complete'

/** Machine-routable and human-readable explanation for a blocked Team objective. */
export interface TeamGoalBlocker {
  /** Stable provider- or policy-defined blocking classification. */
  readonly code: string
  /** Human-readable explanation of the current blocking condition. */
  readonly message: string
}

/** Fields supplied when a provider seeds a Team's first durable objective revision. */
export interface TeamGoalSeed {
  /** Human-requested completion objective. */
  readonly objective: string
  /** Goal-specific resource limits resolved before durable creation. */
  readonly budgets: JsonObject
}

/** Immutable revisioned Team objective retained in the Team journal. */
export interface TeamGoalSnapshot {
  /** Team that owns this single durable objective. */
  readonly teamId: TeamId
  /** Positive compare-and-set revision for Team-goal mutations. */
  readonly revision: number
  /** Human-requested completion objective. */
  readonly objective: string
  /** Current durable objective lifecycle phase. */
  readonly phase: TeamGoalPhase
  /** Present exactly while the objective phase is `blocked`. */
  readonly blocker?: TeamGoalBlocker
  /** Goal-specific resource limits resolved before durable creation or update. */
  readonly budgets: JsonObject
}

/** Durable membership lifecycle for one participant. */
export type ParticipantPhase = 'invited' | 'provisioning' | 'active' | 'left' | 'failed'

/** Live residency status independent of durable participant membership. */
export type ActivationStatus = 'starting' | 'running' | 'idle' | 'offline' | 'stopping'

/** Durable lifecycle for one protocol channel. */
export type ChannelPhase = 'pending' | 'active' | 'closing' | 'closed' | 'expired' | 'failed'

/** Durable lifecycle for one Team task. */
export type TeamTaskPhase = 'pending' | 'assigned' | 'running' | 'review' | 'completed' | 'failed' | 'cancelled' | 'deleted'

/** Minimal durable report retained when a task attempt completes its assigned work. */
export interface TaskAttemptResult {
  /** Concise human-readable result summary. */
  readonly summary: string
  /** Optional short evidence statements supporting the result. */
  readonly evidence?: readonly string[] | undefined
  /** Optional workspace-owned artifact references produced by the attempt. */
  readonly artifacts?: readonly TeamArtifactReference[] | undefined
  /** Optional normalized paths changed by the attempt. */
  readonly changedPaths?: readonly string[] | undefined
  /** Optional verification command or human-readable verification summary. */
  readonly verification?: string | undefined
  /** Durable result of an explicit workspace integration task, when this attempt owns one. */
  readonly integration?: TaskAttemptIntegrationResult | undefined
}

/** Immutable integration target selected when a Team integration task is created. */
export interface TeamTaskIntegrationSpec {
  /** Completed source task whose change set is being integrated. */
  readonly sourceTaskId: TeamTaskId
  /** Exact completed source attempt whose result supplies the change set. */
  readonly sourceAttemptId: TaskAttemptId
  /** Workspace provider expected to perform the integration. */
  readonly provider: string
  /** Branch or provider-defined target selected by policy. */
  readonly target: string
  /** Target revision observed before the integration task was admitted. */
  readonly expectedTarget?: string | undefined
  /** Whether the task creates a reviewable proposal or updates the target. */
  readonly mode: 'proposal' | 'integrate'
}

/** Durable outcome returned by an explicit Team integration task attempt. */
export interface TaskAttemptIntegrationResult {
  /** Target named by the integration task. */
  readonly target: string
  /** Target revision observed before the provider operation. */
  readonly expectedTarget?: string | undefined
  /** Result of the provider operation. */
  readonly status: 'proposed' | 'integrated' | 'conflict'
  /** Target revision after a successful integration. */
  readonly targetVersion?: string | undefined
  /** Reviewable patch or proposal artifact, when the provider produced one. */
  readonly proposalArtifact?: TeamArtifactReference | undefined
  /** Paths that prevented integration, when the result is a conflict without only a target-version fence. */
  readonly conflictPaths?: readonly string[] | undefined
  /** Verification performed after an accepted integration or proposal. */
  readonly verification?: string | undefined
  /** Final artifact manifest published for the integration attempt. */
  readonly artifacts?: readonly TeamArtifactReference[] | undefined
}

/** Durable reference to one task-produced artifact or change record. */
export interface TeamArtifactReference {
  /** Stable artifact identity from the owning workspace/artifact provider. */
  readonly id: string
  /** Named artifact provider required when a consumer is allowed to read bytes. */
  readonly provider?: string | undefined
  /** Artifact category used by views and integration consumers. */
  readonly kind: 'file' | 'patch' | 'log' | 'screenshot' | 'report'
  /** Provider URI or path, never the artifact contents themselves. */
  readonly uri: string
  /** Optional content hash used for stale/conflict detection. */
  readonly contentHash?: string | undefined
  /** Optional source task-attempt identity for provenance. */
  readonly sourceAttemptId?: TaskAttemptId | undefined
  /** Artifact visibility policy. */
  readonly visibility: 'private' | 'team' | 'human'
}

/** Request one provider-owned lookup of a visible Team artifact reference. */
export interface TeamArtifactGetRequest {
  /** Team whose visible artifact references are searched. */
  readonly teamId: TeamId
  /** Durable artifact identity selected by the caller. */
  readonly artifactId: string
}

/** Request one bounded page of visible Team artifact references. */
export interface TeamArtifactListPageRequest {
  /** Team whose visible artifacts are read. */
  readonly teamId: TeamId
  /** Exclusive provider-order ordinal from a prior page, or `-1` initially. */
  readonly afterCursor: number
  /** Maximum number of visible artifact references to return. */
  readonly limit: number
}

/** One bounded page of visible Team artifact references. */
export interface TeamArtifactListPage {
  /** Unambiguous non-private artifact references in durable Team order. */
  readonly items: readonly TeamArtifactReference[]
  /** Provider-order ordinal for the next page when more artifacts remain. */
  readonly nextCursor?: number | undefined
}

/** Minimal durable failure fact retained when a task attempt fails. */
export interface TaskAttemptFailure {
  /** Stable provider- or policy-defined failure classification. */
  readonly code: string
  /** Human-readable failure explanation. */
  readonly message: string
}

/** Terminal fact recorded for one lease-backed task attempt. */
export type TaskAttemptOutcome =
  | { readonly kind: 'released' }
  | { readonly kind: 'lease-expired' }
  | { readonly kind: 'failed'; readonly failure: TaskAttemptFailure }
  | { readonly kind: 'completed'; readonly result: TaskAttemptResult }
  | { readonly kind: 'cancelled' }

/** Execution-world requirement frozen when a Team task is created. */
export type TeamTaskWorkspaceMode = 'shared' | 'worktree' | 'sandbox' | 'remote'

/** Durable lifecycle for one provider-owned task workspace allocation. */
export type TeamWorkspaceAllocationLifecycle =
  | 'reserved'
  | 'active'
  | 'release-requested'
  | 'released'
  | 'preserved'
  | 'unavailable'

/** Provider-owned immutable execution-world identity, independent of a filesystem path. */
export type TeamWorkspaceExecutionWorldId = Branded<'TeamWorkspaceExecutionWorldId'>

/** Remote world whose identity must remain stable when an allocation is restored. */
export interface TeamWorkspaceExecutionWorld {
  readonly kind: 'e2b'
  readonly id: TeamWorkspaceExecutionWorldId
}

/** Provider observation that an exact allocation cannot execute more work. */
export interface TeamWorkspaceLoss {
  readonly executionWorld: TeamWorkspaceExecutionWorld
  readonly reason: 'sandbox-expired' | 'manifest-missing' | 'world-changed'
  /** True only when the provider proved that this entire execution world was destroyed. */
  readonly terminationProven: boolean
  /** Bytes already retained outside the lost world; remote-only locators are excluded. */
  readonly artifacts: readonly TeamArtifactReference[]
}

/** Hub-retained loss with the exact provider observation timestamp. */
export interface TeamWorkspaceLossSnapshot extends TeamWorkspaceLoss {
  readonly observedAt: number
}

/** Opaque retry identity for one provider workspace scan. */
export type TeamWorkspaceObservationId = Branded<'TeamWorkspaceObservationId'>
/** Content-derived digest of one bounded directory observation. */
export type TeamWorkspaceContentVersion = Branded<'TeamWorkspaceContentVersion'>

/** A bounded scan observes a time window, never an atomic filesystem snapshot. */
export interface TeamWorkspaceScanVersion {
  /** Digest of the ordered observed fingerprints and completeness marker. */
  readonly digest: TeamWorkspaceContentVersion
  /** Whether all entries and file content fit inside the configured scan limits. */
  readonly complete: boolean
  /** Wall-clock start of the actual traversal. */
  readonly startedAt: number
  /** Wall-clock completion of the actual traversal. */
  readonly finishedAt: number
  /** Number of directory entries actually inspected, including directories. */
  readonly scannedEntries: number
  /** Number of file bytes actually hashed. */
  readonly hashedBytes: number
  /** Known omitted entries; this is a lower bound when traversal stops early. */
  readonly knownOmittedEntries: number
  /** Explicit limits, missing-baseline or filesystem failures preventing a complete observation. */
  readonly incompleteReasons: readonly string[]
}

/** One change proven by the captured portions of both scans. */
export interface TeamWorkspaceObservedPath {
  /** Portable relative path; symlink targets are never followed. */
  readonly path: string
  /** Addition/deletion require a complete opposite scan; partial absence is not evidence. */
  readonly change: 'added' | 'modified' | 'deleted'
}

/** Exact provider facts submitted after one lock-free scan. */
export interface TeamWorkspaceObservationInput {
  /** Owning Team and exact allocation, independent of unrelated Team writes. */
  readonly teamId: TeamId
  readonly allocationId: TeamWorkspaceAllocationId
  /** Allocation lifecycle revision observed before committing scan facts. */
  readonly expectedRevision: number
  /** Latest accepted scan identity; absent only for the first baseline. */
  readonly previousObservationId?: TeamWorkspaceObservationId | undefined
  /** Provider-owned retry identity for this exact scan. */
  readonly id: TeamWorkspaceObservationId
  /** Actual lifecycle operation that requested the observation. */
  readonly stage: 'baseline' | 'restore' | 'periodic' | 'publish' | 'release' | 'integration'
  /** Immutable allocation baseline version, absent only on its initial observation. */
  readonly base: TeamWorkspaceScanVersion | null
  /** Whether baseline comparison is supported by retained fingerprints or an unchanged complete prior observation. */
  readonly baselineAvailable: boolean
  /** Newly observed tree with its own completeness and traversal window. */
  readonly final: TeamWorkspaceScanVersion
  /** Sorted proven path changes, capped independently of scan entry count. */
  readonly paths: readonly TeamWorkspaceObservedPath[]
  /** Known changed paths omitted by the reporting limit. */
  readonly omittedPaths: number
}

/** Durable latest observation; older observations remain in the Team journal/audit pages. */
export interface TeamWorkspaceObservation extends TeamWorkspaceObservationInput {
  /** Task/attempt provenance derived by the Hub from the allocation. */
  readonly taskId: TeamTaskId
  readonly attemptId: TaskAttemptId
  /** Whether either scan or the path list is incomplete. */
  readonly truncated: boolean
  /** Scope classification says nothing about the identity of a writer. */
  readonly paths: readonly (TeamWorkspaceObservedPath & {
    readonly classification: 'declared' | 'undeclared' | 'external-window'
  })[]
  /** Hub commit time, distinct from the non-atomic scan window. */
  readonly observedAt: number
}

/** Provider proof plus complete JSON-only scan facts. */
export interface TeamWorkspaceObservationRequest extends TeamWorkspaceObservationInput {
  readonly actor: TeamSystemWorkspaceAllocationProof
}

/**
 * Durable provider metadata for one task-attempt execution root. The actual
 * filesystem root, credentials, and release handle remain live provider data.
 */
export interface TeamWorkspaceAllocationSnapshot {
  /** Provider-minted allocation identity. */
  readonly id: TeamWorkspaceAllocationId
  /** Compare-and-set revision for allocation lifecycle transitions. */
  readonly revision: number
  /** Team that owns the allocation. */
  readonly teamId: TeamId
  /** Task whose exact attempt owns the allocation. */
  readonly taskId: TeamTaskId
  /** Attempt whose lease selected the allocation. */
  readonly attemptId: TaskAttemptId
  /** Task revision committed with the assignment selected by the provider. */
  readonly assignedRevision: number
  /** Participant that owned the allocation's task lease. */
  readonly participantId: ParticipantId
  /** Activation epoch that consumed the allocation. */
  readonly activationId: ActivationId
  /** Session durably bound to the consuming activation. */
  readonly sessionId: SessionId
  /** Registered provider identity that owns the live allocation resource. */
  readonly provider: string
  /** Immutable task mode that selected the provider. */
  readonly mode: TeamTaskWorkspaceMode
  /** Optional provider-owned opaque base version, such as a Git commit. */
  readonly baseVersion?: string | undefined
  /** Current durable resource lifecycle state. */
  readonly executionWorld?: TeamWorkspaceExecutionWorld | undefined
  /** Exact provider loss retained through release and attempt settlement. */
  readonly loss?: TeamWorkspaceLossSnapshot | undefined
  /** Current durable resource lifecycle state. */
  readonly lifecycle: TeamWorkspaceAllocationLifecycle
  /** Epoch milliseconds when the Hub reserved this allocation before provider materialization. */
  readonly reservedAt: number
  /** Epoch milliseconds when this durable snapshot last changed. */
  readonly updatedAt: number
  /** Epoch milliseconds when the provider materialized or restored the allocation. */
  readonly activatedAt?: number | undefined
  /** Epoch milliseconds when durable release intent was accepted before provider cleanup. */
  readonly releaseRequestedAt?: number | undefined
  /** Epoch milliseconds when cleanup explicitly preserved the provider resource. */
  readonly preservedAt?: number | undefined
  /** Epoch milliseconds when provider release was durably recorded. */
  readonly releasedAt?: number | undefined
  /** Structured reason retained when a provider resource cannot be released. */
  readonly preservationReason?: TeamStallReason | undefined
  /** Latest bounded observation; history is read from journal/audit pages. */
  readonly observation?: TeamWorkspaceObservation | undefined
}

/** Kind of host-mediated human action retained by a Team. */
export type TeamHumanActionKind = 'approval' | 'question'

/** Durable lifecycle of one Team-wide human action. */
export type TeamHumanActionPhase = 'pending' | 'resolved' | 'cancelled'

/** Immutable request and mutable resolution facts for one human action. */
export interface TeamHumanActionSnapshot {
  /** Stable Team-owned interaction identity. */
  readonly id: TeamHumanActionId
  /** Team that owns the interaction. */
  readonly teamId: TeamId
  /** Approval or question request kind. */
  readonly kind: TeamHumanActionKind
  /** Current durable interaction phase. */
  readonly phase: TeamHumanActionPhase
  /** Session that originated the request. */
  readonly sessionId: SessionId
  /** Participant that originated the request. */
  readonly participantId: ParticipantId
  /** Task active when the request was made, when provenance is available. */
  readonly taskId?: TeamTaskId | undefined
  /** Exact source attempt when the request originated inside task execution. */
  readonly attemptId?: TaskAttemptId | undefined
  /** Stable source request identity (approval id or mux rpc id). */
  readonly sourceId: TeamHumanActionSourceId
  /** JSON-safe request details retained for replay and UI projection. */
  readonly details: JsonObject
  /** JSON-safe answer or outcome after resolution. */
  readonly outcome?: JsonObject | undefined
  /** Durable answer accepted before the original callback is notified. */
  readonly response?: import('./human-delivery-types.ts').TeamHumanActionResponseSnapshot | undefined
  /** Epoch milliseconds when the request was first accepted. */
  readonly createdAt: number
  /** Epoch milliseconds of the latest phase transition. */
  readonly updatedAt: number
}

/** Private nominal member that prevents structural construction of system human-action proof values. */
declare const teamSystemHumanActionProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered Host source for one exact
 * approval or question action mutation. The proof has no serializable fields
 * and cannot grant generic Team participant authority.
 */
export interface TeamSystemHumanActionProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemHumanActionProofBrand]: never
}

/** Exact Host admission of one verified pending approval or question action. */
export interface HostHumanActionUpsertScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'host-human-action-upsert'
  /** Team that owns the verified pending interaction. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before admitting this interaction. */
  readonly expectedCursor: number
  /** Pending action facts derived by the Host from its verified interaction entry. */
  readonly action: TeamHumanActionSnapshot
}

/** Exact Host resolution of one previously verified pending interaction. */
export interface HostHumanActionResolveScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'host-human-action-resolve'
  /** Team that owns the verified interaction. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before resolving this interaction. */
  readonly expectedCursor: number
  /** Immutable pending action facts retained when the Host verified the entry. */
  readonly action: TeamHumanActionSnapshot
  /** Terminal outcome selected by the Host interaction owner. */
  readonly phase: Extract<TeamHumanActionPhase, 'resolved' | 'cancelled'>
  /** Complete JSON-safe outcome retained with the terminal action. */
  readonly outcome: JsonObject
}

/** Closed human-action mutations a registered Host source may select. */
export interface HostHumanActionResponseScope {
  readonly kind: 'host-human-action-response-accept'
  readonly teamId: TeamId
  readonly expectedCursor: number
  readonly action: TeamHumanActionSnapshot
  readonly input: import('./human-delivery-types.ts').TeamHumanActionResponseInput
  readonly principalId: Branded<'ProductPrincipalId'>
  readonly humanId: ParticipantId
}
/** A Host may only cancel and stall an exact action whose continuation it cannot recover. */
export interface HostHumanActionUnavailableScope {
  readonly kind: 'host-human-action-unavailable'
  readonly teamId: TeamId
  readonly expectedCursor: number
  readonly action: TeamHumanActionSnapshot
}
/** Closed Host admissions, outcomes and failure-only recovery scopes. */
export type TeamSystemHumanActionScope = HostHumanActionUpsertScope | HostHumanActionResolveScope
  | HostHumanActionResponseScope | HostHumanActionUnavailableScope

/** Immutable source attribution resolved for one system human-action proof. */
export interface TeamSystemHumanActionProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact host interaction mutation supplied by that source. */
  readonly scope: TeamSystemHumanActionScope
}

/**
 * Registration contributed by a Host owner that retains opaque proofs for
 * verified approval or question interactions. A source never receives
 * caller-selected Team or participant attribution.
 */
export interface TeamSystemHumanActionProofSource {
  /** Stable nonempty registry identity for the contributing Host owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact human-action scope, or `undefined` when this source does not own the token.
   */
  resolveHumanActionProof(proof: TeamSystemHumanActionProof): TeamSystemHumanActionScope | undefined
}

/** Private nominal member that prevents structural construction of system task-lease proof values. */
declare const teamSystemTaskLeaseProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered scheduler source for one
 * exact task assignment or elapsed lease expiry. The proof has no serializable
 * fields and cannot grant generic task or participant authority.
 */
export interface TeamSystemTaskLeaseProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemTaskLeaseProofBrand]: never
}

/** Exact scheduler assignment of one ready task to one current lease owner. */
export interface SchedulerTaskAssignLeaseScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'scheduler-task-assign'
  /** Team that owns the assigned task and selected participant. */
  readonly teamId: TeamId
  /** Ready task selected for one new lease. */
  readonly taskId: TeamTaskId
  /** Task revision observed before assignment. */
  readonly expectedRevision: number
  /** Participant selected by scheduler eligibility. */
  readonly participantId: ParticipantId
  /** Current activation selected for an agent participant, when required. */
  readonly activationId?: ActivationId | undefined
  /** Persistent assignment channel selected to wake this lease owner, when any. */
  readonly wakeChannelId?: ChannelId | undefined
  /** Fixed lease duration selected by the scheduler. */
  readonly leaseDurationMs: number
}

/** Exact scheduler expiry of one elapsed current task lease. */
export interface SchedulerTaskExpireLeaseScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'scheduler-task-expire'
  /** Team that owns the lease-bearing task. */
  readonly teamId: TeamId
  /** Task whose current lease has elapsed. */
  readonly taskId: TeamTaskId
  /** Task revision observed before expiry. */
  readonly expectedRevision: number
  /** Exact elapsed lease attempt selected for expiry. */
  readonly attemptId: TaskAttemptId
}

/** Exact scheduler recovery of an already accepted lease-free task cancellation. */
export interface SchedulerTaskCancellationReconcileScope extends TeamTaskCancellationReconcileInput {
  /** Closed source operation selected by this proof. */
  readonly kind: 'scheduler-task-cancellation-reconcile'
}

/** Closed scheduler task-lease mutations a system source may select. */
export type TeamSystemTaskLeaseScope =
  | SchedulerTaskAssignLeaseScope
  | SchedulerTaskExpireLeaseScope
  | SchedulerTaskCancellationReconcileScope

/** Immutable source attribution resolved for one scheduler task-lease proof. */
export interface TeamSystemTaskLeaseProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact scheduler assignment or expiry supplied by that source. */
  readonly scope: TeamSystemTaskLeaseScope
}

/**
 * Registration contributed by a scheduler owner that retains opaque task-lease
 * proofs. A source never receives caller-selected task, participant, or lease
 * attribution.
 */
export interface TeamSystemTaskLeaseProofSource {
  /** Stable nonempty registry identity for the contributing scheduler owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact task-lease scope, or `undefined` when this source does not own the token.
   */
  resolveTaskLeaseProof(proof: TeamSystemTaskLeaseProof): TeamSystemTaskLeaseScope | undefined
}

/** Private nominal member that prevents structural construction of system workflow proof values. */
declare const teamSystemWorkflowProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered workflow compiler source for
 * one exact channel, binding, phase, or orphan-cleanup mutation. The proof has
 * no serializable fields and cannot grant generic Team or channel authority.
 */
export interface TeamSystemWorkflowProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemWorkflowProofBrand]: never
}

/** Exact TeamRun opening of the workflow channel for one compiling plan revision. */
export interface TeamRunWorkflowChannelOpenScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-workflow-channel-open'
  /** Team that owns the compiling plan and new channel. */
  readonly teamId: TeamId
  /** Exact current coordinator binding that owns the compiler operation. */
  readonly coordinator: TeamTaskCreator
  /** Plan whose channel is opened. */
  readonly planId: TeamWorkflowPlanId
  /** Team cursor observed before opening the channel. */
  readonly expectedCursor: number
  /** Compiling plan revision observed before opening the channel. */
  readonly expectedRevision: number
  /** Exact registered workflow adapter retained by the new manifest. */
  readonly adapter: TeamAdapterRef
  /** Optional exact view policy retained by the new manifest. */
  readonly viewPolicy?: TeamViewPolicyRef | undefined
  /** Exact active Team membership and role assignment retained by the manifest. */
  readonly participants: readonly ChannelParticipant[]
  /** Exact adapter limits retained by the new manifest. */
  readonly limits: JsonObject
}

/** Exact TeamRun binding of one newly opened workflow channel to its plan. */
export interface TeamRunWorkflowChannelBindScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-workflow-channel-bind'
  /** Team that owns the compiling plan and channel. */
  readonly teamId: TeamId
  /** Exact current coordinator binding that owns the compiler operation. */
  readonly coordinator: TeamTaskCreator
  /** Compiling workflow plan that receives the channel binding. */
  readonly planId: TeamWorkflowPlanId
  /** Team cursor observed before binding. */
  readonly expectedCursor: number
  /** Plan revision observed before binding. */
  readonly expectedRevision: number
  /** Exact active workflow channel opened for this plan. */
  readonly channelId: ChannelId
}

/** Exact TeamRun binding of one coordinator-created task to one plan template. */
export interface TeamRunWorkflowTaskBindScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-workflow-task-bind'
  /** Team that owns the compiling plan and task. */
  readonly teamId: TeamId
  /** Exact current coordinator binding that owns the compiler operation. */
  readonly coordinator: TeamTaskCreator
  /** Compiling workflow plan that receives the task binding. */
  readonly planId: TeamWorkflowPlanId
  /** Team cursor observed before binding. */
  readonly expectedCursor: number
  /** Plan revision observed before binding. */
  readonly expectedRevision: number
  /** Exact plan-local template selected by the compiler. */
  readonly templateId: TeamWorkflowTaskTemplateId
  /** Exact coordinator-created task selected for the template. */
  readonly taskId: TeamTaskId
}

/** Exact TeamRun transition of one compiling workflow plan to ready or a terminal result. */
export interface TeamRunWorkflowPlanPhaseScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-workflow-plan-phase'
  /** Team that owns the workflow plan. */
  readonly teamId: TeamId
  /** Exact current coordinator binding that owns the compiler operation. */
  readonly coordinator: TeamTaskCreator
  /** Workflow plan whose phase changes. */
  readonly planId: TeamWorkflowPlanId
  /** Team cursor observed before the phase transition. */
  readonly expectedCursor: number
  /** Plan revision observed before the phase transition. */
  readonly expectedRevision: number
  /** Exact ready, completed, or failed phase selected by the compiler. */
  readonly phase: 'ready' | 'completed' | 'failed'
  /** Required result projection when phase is completed. */
  readonly result?: TeamWorkflowPlanResult | undefined
  /** Required failure facts when phase is failed. */
  readonly failure?: TeamStallReason | undefined
}

/** Exact TeamRun cleanup of an unbound active workflow channel after compiler failure. */
export interface TeamRunWorkflowChannelCloseScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-workflow-channel-close'
  /** Team that owns the compiling plan and unbound channel. */
  readonly teamId: TeamId
  /** Exact current coordinator binding that owns the compiler operation. */
  readonly coordinator: TeamTaskCreator
  /** Compiling workflow plan whose unbound channel is retired. */
  readonly planId: TeamWorkflowPlanId
  /** Team cursor observed before cleanup. */
  readonly expectedTeamCursor: number
  /** Current plan revision observed before cleanup. */
  readonly expectedRevision: number
  /** Exact active unbound workflow channel selected for cleanup. */
  readonly channelId: ChannelId
  /** Channel cursor observed before closure. */
  readonly expectedCursor: number
  /** Optional exact diagnostic reason retained in the terminal channel record. */
  readonly reason?: string | undefined
}

/** Closed TeamRun workflow-compiler mutations a system source may select. */
export type TeamSystemWorkflowScope =
  | TeamRunWorkflowChannelOpenScope
  | TeamRunWorkflowChannelBindScope
  | TeamRunWorkflowTaskBindScope
  | TeamRunWorkflowPlanPhaseScope
  | TeamRunWorkflowChannelCloseScope

/** Immutable source attribution resolved for one TeamRun workflow compiler proof. */
export interface TeamSystemWorkflowProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact workflow compiler mutation supplied by that source. */
  readonly scope: TeamSystemWorkflowScope
}

/**
 * Registration contributed by a workflow compiler owner that retains opaque
 * proofs. A source never receives caller-selected plan, channel, task, or
 * terminal payload attribution.
 */
export interface TeamSystemWorkflowProofSource {
  /** Stable nonempty registry identity for the contributing workflow compiler owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact workflow scope, or `undefined` when this source does not own the token.
   */
  resolveWorkflowProof(proof: TeamSystemWorkflowProof): TeamSystemWorkflowScope | undefined
}

/** Private nominal member that prevents structural construction of system task-control proof values. */
declare const teamSystemTaskControlProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered TeamRun source for one exact
 * default-worker owner proposal or current-coordinator cancellation. The proof
 * has no serializable fields and cannot grant generic task control.
 */
export interface TeamSystemTaskControlProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemTaskControlProofBrand]: never
}

/** Exact TeamRun owner proposal for one current default-worker task. */
export interface TeamRunDefaultWorkerOwnerProposalScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-default-worker-owner-proposal'
  /** Team that owns the default-worker task. */
  readonly teamId: TeamId
  /** Exact current coordinator binding that owns this task-control operation. */
  readonly coordinator: TeamTaskCreator
  /** Default-worker task selected for the advisory proposal. */
  readonly taskId: TeamTaskId
  /** Task revision observed before the proposal. */
  readonly expectedRevision: number
  /** Exact preferred Participant, or omission to clear the proposal. */
  readonly proposedOwnerId?: ParticipantId | undefined
}

/** Exact TeamRun current-coordinator cancellation of one default-worker task. */
export interface TeamRunDefaultWorkerCancelScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-default-worker-cancel'
  /** Team that owns the default-worker task. */
  readonly teamId: TeamId
  /** Exact current coordinator binding that owns this task-control operation. */
  readonly coordinator: TeamTaskCreator
  /** Default-worker task selected for cancellation. */
  readonly taskId: TeamTaskId
  /** Task revision observed before cancellation. */
  readonly expectedRevision: number
  /** Optional explanation bound to this cancellation proof. */
  readonly reason?: string | undefined
}

/** Exact current-coordinator cancellation of one task bound to its workflow plan. */
export interface TeamRunWorkflowTaskCancelScope extends Omit<TeamRunDefaultWorkerCancelScope, 'kind'> {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-workflow-task-cancel'
  /** Workflow whose durable binding must own the selected task. */
  readonly planId: TeamWorkflowPlanId
}

/** Closed TeamRun coordinator task-control mutations a system source may select. */
export type TeamSystemTaskControlScope =
  | TeamRunDefaultWorkerOwnerProposalScope
  | TeamRunDefaultWorkerCancelScope
  | TeamRunWorkflowTaskCancelScope

/** Immutable source attribution resolved for one TeamRun coordinator task-control proof. */
export interface TeamSystemTaskControlProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact default-worker task-control operation supplied by that source. */
  readonly scope: TeamSystemTaskControlScope
}

/**
 * Registration contributed by a TeamRun owner that retains opaque proofs for
 * exact current-coordinator default-worker task controls. A source never
 * receives caller-selected task, coordinator, or proposal attribution.
 */
export interface TeamSystemTaskControlProofSource {
  /** Stable nonempty registry identity for the contributing TeamRun owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact task-control scope, or `undefined` when this source does not own the token.
   */
  resolveTaskControlProof(proof: TeamSystemTaskControlProof): TeamSystemTaskControlScope | undefined
}

/** Private nominal member that prevents structural construction of root-creation proof values. */
declare const teamSystemRootCreationProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered source for one exact root
 * Team creation. The proof has no serializable fields and cannot authorize a
 * child Team or any post-creation mutation.
 */
export interface TeamSystemRootCreationProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemRootCreationProofBrand]: never
}

/** Exact TeamRun creation of one root Team before a Team identity exists. */
export interface TeamRunRootCreationScope extends TeamRootCreateInput {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-root-create'
}

/** Closed root-Team creation mutations a system source may select. */
export type TeamSystemRootCreationScope = TeamRunRootCreationScope

/** Immutable source attribution resolved for one root-Team creation proof. */
export interface TeamSystemRootCreationProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact root creation payload supplied by that source. */
  readonly scope: TeamSystemRootCreationScope
}

/**
 * Registration contributed by a root-Team owner that retains opaque proofs for
 * exact root creation. A source never receives caller-selected Team identity,
 * participant, or child-link attribution.
 */
export interface TeamSystemRootCreationProofSource {
  /** Stable nonempty registry identity for the contributing root-Team owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact root-creation scope, or `undefined` when this source does not own the token.
   */
  resolveRootCreationProof(proof: TeamSystemRootCreationProof): TeamSystemRootCreationScope | undefined
}

/** Private nominal member that prevents structural construction of child-creation proof values. */
export type TeamDelegationId = Branded<'TeamDelegationId'>

/** Identity shared by every operation of one parent-task delegation. */
export interface TeamChildRunIdentity {
  readonly parentTeamId: TeamId
  readonly parentTaskId: TeamTaskId
  readonly childTeamId: TeamId
  readonly delegationId: TeamDelegationId
}

/** Current authorization facts; only startup carries the provider-validated shared execution root. */
export type TeamChildRunScope =
  | (TeamChildRunIdentity & { readonly operation: 'start'; readonly workspacePath: string })
  | (TeamChildRunIdentity & { readonly operation: 'cancel' })

declare const teamChildRunAuthorizationBrand: unique symbol

/** Hub-owned runtime capability for one exact child startup or cancellation operation. */
export interface TeamChildRunAuthorization {
  readonly [teamChildRunAuthorizationBrand]: never
  /** Revalidate its live source and parent delegation before an external side effect.
   * @returns exact current operation facts; stale or revoked authority rejects.
   */
  assertCurrent(): Promise<TeamChildRunScope>
  /** Revoke the capability after its owning operation settles. */
  close(): void
}

/** Immutable executor selected when a Team task is created. */
export type TeamTaskExecution =
  | { readonly kind: 'participant' }
  | {
    readonly kind: 'child-team'
    readonly templateId: string
    readonly templateVersion: number
    readonly authorityGrant: TeamAuthorityGrant
    readonly budget: TeamResourceBudget
  }

/** Durable progress of one parent task's child-Team saga. */
export type TeamTaskDelegationPhase = 'requested' | 'creating' | 'active' | 'settling' | 'completed' | 'failed' | 'cancelled' | 'stalled'

/** Parent-owned child creation, execution reservation, and result progress. */
export interface TeamTaskDelegationSnapshot {
  readonly id: TeamDelegationId
  readonly phase: TeamTaskDelegationPhase
  readonly requestedAt: number
  readonly updatedAt: number
  /** Reservation start, independent of a Participant lease. */
  readonly startedAt?: number | undefined
  /** Reserved by the parent before the child journal is opened. */
  readonly childTeamId?: TeamId | undefined
  /** Complete immutable child creation payload retained for crash-safe retry. */
  readonly creation?: TeamChildCreateInput | undefined
  readonly childCursor?: number | undefined
  readonly failure?: TeamStallReason | undefined
  /** Exact parent sink result retained before child terminal settlement. */
  readonly result?: import('./child-result-types.ts').TeamDelegationResultAdmission | undefined
}

declare const teamSystemDelegationProofBrand: unique symbol

/** Source-owned proof for one exact parent-task delegation mutation. */
export interface TeamSystemDelegationProof {
  readonly [teamSystemDelegationProofBrand]: never
}

/** Common current-parent cursor and task-revision fence. */
export interface TeamTaskDelegationInput {
  readonly teamId: TeamId
  readonly taskId: TeamTaskId
  readonly expectedCursor: number
  readonly expectedRevision: number
  readonly delegationId: TeamDelegationId
}

/** Reserve child identity and its fully resolved template before creating its stream. */
export interface TeamTaskDelegationBeginInput extends TeamTaskDelegationInput {
  readonly child: TeamRootCreateInput
}

/** Confirm a child that reached its bound runtime or retain an exact startup stall. */
export interface TeamTaskDelegationBindInput extends TeamTaskDelegationInput {
  readonly childTeamId: TeamId
}

/** Settle only after the exact child and its usage charges reach a terminal state. */
export interface TeamTaskDelegationSettleInput extends TeamTaskDelegationInput {
  readonly childTeamId: TeamId
}

/** Request a runtime-only capability for one selected child operation. */
export interface TeamChildRunAuthorizeInput extends TeamTaskDelegationInput {
  readonly operation: 'start' | 'cancel'
}

/** Retain an operational stall without discarding its child reservation. */
export interface TeamTaskDelegationStallInput extends TeamTaskDelegationInput {
  readonly reason: TeamStallReason
}

/** Closed parent-task operations admitted by the delegation Consumer. */
export type TeamSystemDelegationScope =
  | import('./child-result-types.ts').TeamTaskDelegationResultAdmitScope
  | (TeamTaskDelegationBeginInput & { readonly kind: 'delegation-begin' })
  | (TeamTaskDelegationBindInput & { readonly kind: 'delegation-bind' })
  | (TeamTaskDelegationSettleInput & { readonly kind: 'delegation-settle' })
  | (TeamTaskDelegationStallInput & { readonly kind: 'delegation-stall' })
  | (TeamChildRunAuthorizeInput & { readonly kind: 'delegation-authorize-run' })

/** Exact source attribution returned by the runtime proof registry. */
export interface TeamSystemDelegationProofResolution {
  readonly sourceName: string
  readonly scope: TeamSystemDelegationScope
}

/** Consumer-owned proofs and live shared-workspace validation. */
export interface TeamSystemDelegationProofSource {
  readonly name: string
  /** Resolve only source-retained proofs while their operation remains admitted. */
  resolveDelegationProof(proof: TeamSystemDelegationProof): TeamSystemDelegationScope | undefined
  /** Validate the actual parent execution root outside all Team serializers.
   * @param proof - current startup or reservation proof retained by this Consumer.
   * @returns the provider-validated canonical shared root; cancellation does not invoke this resolver.
   */
  resolveChildWorkspace(proof: TeamSystemDelegationProof): Promise<string>
}

/** Runtime-authorized reservation command. */
export interface TeamTaskDelegationBeginRequest extends TeamTaskDelegationBeginInput { readonly actor: TeamSystemDelegationProof }
/** Runtime-authorized child binding command. */
export interface TeamTaskDelegationBindRequest extends TeamTaskDelegationBindInput { readonly actor: TeamSystemDelegationProof }
/** Runtime-authorized terminal child settlement command. */
export interface TeamTaskDelegationSettleRequest extends TeamTaskDelegationSettleInput { readonly actor: TeamSystemDelegationProof }
/** Runtime-authorized operational stall command. */
export interface TeamTaskDelegationStallRequest extends TeamTaskDelegationStallInput { readonly actor: TeamSystemDelegationProof }
/** Runtime-authorized child startup or cancellation capability request. */
export interface TeamChildRunAuthorizeRequest extends TeamChildRunAuthorizeInput { readonly actor: TeamSystemDelegationProof }

/** Private nominal member that prevents structural construction of child-creation proof values. */
declare const teamSystemChildCreationProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered source for one exact nested
 * Team creation. The proof has no serializable fields and cannot authorize a
 * root Team or recover a parent delegation from durable hierarchy data.
 */
export interface TeamSystemChildCreationProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemChildCreationProofBrand]: never
}

/** Exact delegated creation of one child Team under one observed parent cursor. */
export interface TeamChildCreationScope extends TeamChildCreateInput {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-child-create'
  /** Parent Team journal cursor observed by the delegation source. */
  readonly expectedParentCursor: number
}

/** Closed nested-Team creation mutations a system source may select. */
export type TeamSystemChildCreationScope = TeamChildCreationScope

/** Immutable source attribution resolved for one nested-Team creation proof. */
export interface TeamSystemChildCreationProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact child creation operation supplied by that source. */
  readonly scope: TeamSystemChildCreationScope
}

/**
 * Registration contributed by an owner that retains opaque proofs for exact
 * nested-Team creation. Shipped compositions intentionally register no such
 * owner until parent-task delegation has a product consumer.
 */
export interface TeamSystemChildCreationProofSource {
  /** Stable nonempty registry identity for the contributing child-delegation owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact child creation scope, or `undefined` when this source does not own the token.
   */
  resolveChildCreationProof(proof: TeamSystemChildCreationProof): TeamSystemChildCreationScope | undefined
}

/** Private nominal member that prevents structural construction of channel-summary proof values. */
declare const teamSystemChannelSummaryProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered source for one exact channel
 * summary append. The proof has no serializable fields and cannot authorize
 * ordinary channel mutation or reconstruct authority from a view policy.
 */
export interface TeamSystemChannelSummaryProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemChannelSummaryProofBrand]: never
}

/** Exact source-owned durable channel summary append. */
export interface TeamChannelSummaryScope extends ChannelSummarizeInput {
  /** Closed source operation selected by this proof. */
  readonly kind: 'channel-summary'
}

/** Closed channel summary mutations a system source may select. */
export type TeamSystemChannelSummaryScope = TeamChannelSummaryScope

/** Immutable source attribution resolved for one channel summary proof. */
export interface TeamSystemChannelSummaryProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact channel summary operation supplied by that source. */
  readonly scope: TeamSystemChannelSummaryScope
}

/**
 * Registration contributed by an owner that retains opaque proofs for exact
 * channel summary appends. The explicit extractive Consumer registers the
 * canonical source; callers retain a separate current coordinator/human proof.
 */
export interface TeamSystemChannelSummaryProofSource {
  /** Stable nonempty registry identity for the contributing summary owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact summary scope, or `undefined` when this source does not own the token.
   */
  resolveChannelSummaryProof(proof: TeamSystemChannelSummaryProof): TeamSystemChannelSummaryScope | undefined
}

declare const teamSystemChannelLifecycleProofBrand: unique symbol
/** Runtime-only evidence retained by a registered source for one exact generic channel lifecycle mutation. */
export interface TeamSystemChannelLifecycleProof {
  readonly [teamSystemChannelLifecycleProofBrand]: never
}
/** Exact source-owned generic channel admission. */
export interface TeamChannelOpenScope extends ChannelOpenInput {
  /** Closed source operation selected by this proof. */
  readonly kind: 'channel-open'
  /** Generic lifecycle authority never opens workflow-plan channels. */
  readonly workflowPlanId?: undefined
  /** Generic lifecycle authority never selects a workflow-plan revision. */
  readonly expectedPlanRevision?: undefined
}
/** Exact source-owned generic channel closure. */
export interface TeamChannelCloseScope extends ChannelCloseInput {
  readonly kind: 'channel-close'
  readonly teamId: TeamId
}
/** Closed generic channel lifecycle mutations a system source may select. */
export type TeamSystemChannelLifecycleScope = TeamChannelOpenScope | TeamChannelCloseScope
/** Immutable source attribution resolved for one generic channel lifecycle proof. */
export interface TeamSystemChannelLifecycleProofResolution {
  readonly sourceName: string
  readonly scope: TeamSystemChannelLifecycleScope
}
/** Registration contributed by the owner that retains opaque generic channel lifecycle proofs. */
export interface TeamSystemChannelLifecycleProofSource {
  readonly name: string
  /** Resolve one source-owned proof while it remains live. */
  resolveChannelLifecycleProof(proof: TeamSystemChannelLifecycleProof): TeamSystemChannelLifecycleScope | undefined
}

declare const teamSystemWorkspaceAllocationProofBrand: unique symbol

/** Runtime-only evidence retained by an allocation owner for one exact workspace lifecycle mutation. */
export interface TeamSystemWorkspaceAllocationProof {
  readonly [teamSystemWorkspaceAllocationProofBrand]: never
}

/** Exact source-owned reservation before a provider materializes one allocation. */
export interface TeamWorkspaceAllocationReserveScope extends TeamWorkspaceAllocationReserveInput {
  readonly kind: 'workspace-allocation-reserve'
}

/** Exact source-owned activation after a provider materializes or restores one allocation. */
export interface TeamWorkspaceAllocationActivateScope extends TeamWorkspaceAllocationActivateInput {
  readonly kind: 'workspace-allocation-activate'
}

/** Exact source-owned release intent before provider cleanup starts. */
export interface TeamWorkspaceAllocationReleaseRequestScope extends TeamWorkspaceAllocationReleaseRequestInput {
  readonly kind: 'workspace-allocation-release-request'
}

/** Exact source-owned preservation of one provider allocation that cannot be released yet. */
export interface TeamWorkspaceAllocationPreserveScope extends TeamWorkspaceAllocationPreserveInput {
  readonly kind: 'workspace-allocation-preserve'
}

/** Exact source-owned durable release of one provider allocation. */
export interface TeamWorkspaceAllocationReleaseScope extends TeamWorkspaceAllocationReleaseInput {
  readonly kind: 'workspace-allocation-release'
}

/** Exact allocation loss observed by its current provider-backed execution owner. */
export interface TeamWorkspaceAllocationLossScope extends TeamWorkspaceAllocationLossInput {
  readonly kind: 'workspace-allocation-loss'
}

/** Closed workspace allocation lifecycle mutations a system source may select. */
export type TeamSystemWorkspaceAllocationScope =
  | TeamWorkspaceAllocationReserveScope
  | TeamWorkspaceAllocationActivateScope
  | TeamWorkspaceAllocationReleaseRequestScope
  | TeamWorkspaceAllocationPreserveScope
  | TeamWorkspaceAllocationReleaseScope
  | TeamWorkspaceAllocationLossScope
  | (TeamWorkspaceObservationInput & { readonly kind: 'workspace-observe' })

/** Immutable source attribution resolved for one workspace allocation proof. */
export interface TeamSystemWorkspaceAllocationProofResolution {
  readonly sourceName: string
  readonly scope: TeamSystemWorkspaceAllocationScope
}

/** Registration contributed by an owner of live provider workspace allocations. */
export interface TeamSystemWorkspaceAllocationProofSource {
  readonly name: string
  /** Resolve one source-owned proof while it remains live. */
  resolveWorkspaceAllocationProof(
    proof: TeamSystemWorkspaceAllocationProof,
  ): TeamSystemWorkspaceAllocationScope | undefined
}

/** Private nominal member that prevents structural construction of terminal-archive proof values. */
declare const teamSystemArchiveProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered source for one exact
 * terminal Team archive. The proof has no serializable fields and cannot
 * recover archive authority from durable Team state.
 */
export interface TeamSystemArchiveProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemArchiveProofBrand]: never
}

/** Exact TeamRun archival of one locally owned terminal Team. */
export interface TeamRunTerminalArchiveScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-terminal-archive'
  /** Terminal Team whose local product owner retained archive authority. */
  readonly teamId: TeamId
  /** Team-journal cursor observed by that local product owner. */
  readonly expectedCursor: number
}

/** Closed terminal Team archive mutations a system source may select. */
export type TeamSystemArchiveScope = TeamRunTerminalArchiveScope

/** Immutable source attribution resolved for one terminal Team archive proof. */
export interface TeamSystemArchiveProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact terminal archive operation supplied by that source. */
  readonly scope: TeamSystemArchiveScope
}

/**
 * Registration contributed by a TeamRun owner that retains opaque proofs for
 * terminal Team archive. A source never receives caller-selected terminal
 * provenance or an authority reconstructed from a Team snapshot.
 */
export interface TeamSystemArchiveProofSource {
  /** Stable nonempty registry identity for the contributing TeamRun owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact terminal archive scope, or `undefined` when this source does not own the token.
   */
  resolveArchiveProof(proof: TeamSystemArchiveProof): TeamSystemArchiveScope | undefined
}

/** Private nominal member that prevents structural construction of topology proof values. */
declare const teamSystemTopologyProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered TeamRun source for one exact
 * default-topology mutation. The proof has no serializable fields and cannot
 * grant generic participant or channel authority.
 */
export interface TeamSystemTopologyProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemTopologyProofBrand]: never
}

/** Exact TeamRun bootstrap invitation of one default-topology participant. */
export interface TeamRunBootstrapParticipantInviteScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-bootstrap-participant-invite'
  /** Team whose default topology is being initialized. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before the invitation. */
  readonly expectedCursor: number
  /** Complete immutable descriptor for the invited participant. */
  readonly participant: {
    /** Logical participant implementation category. */
    readonly kind: ParticipantKind
    /** Human-facing participant name. */
    readonly displayName: string
    /** Template-defined responsibility label. */
    readonly role: string
    /** Immutable capabilities declared for scheduler eligibility. */
    readonly capabilities: readonly string[]
    /** Closed immutable human owner, when this descriptor creates a human participant. */
    readonly owner?: TeamParticipantOwner | undefined
    readonly provider?: string | undefined
    readonly preset?: string | undefined
    readonly model?: string | undefined
    readonly authScheme?: string | undefined
    /** Optional authority subset; omission inherits the Team grant. */
    readonly authorityGrant?: TeamAuthorityGrant | undefined
  }
}

/** Exact TeamRun bootstrap membership transition for one default-topology participant. */
export interface TeamRunBootstrapParticipantPhaseScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-bootstrap-participant-phase'
  /** Team that owns the participant. */
  readonly teamId: TeamId
  /** Participant whose bootstrap phase advances. */
  readonly participantId: ParticipantId
  /** Team-journal cursor observed before the phase transition. */
  readonly expectedCursor: number
  /** Current durable participant phase required by this transition. */
  readonly expectedPhase: 'invited' | 'provisioning'
  /** Next durable participant phase selected by the source. */
  readonly phase: 'provisioning' | 'active'
}

/** Exact TeamRun bootstrap opening of the default human/coordinator direct channel. */
export interface TeamRunBootstrapChannelOpenScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-bootstrap-channel-open'
  /** Team whose default channel is being initialized. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before opening the channel. */
  readonly expectedCursor: number
  /** Durable human participant in the bootstrap topology. */
  readonly humanId: ParticipantId
  /** Durable coordinator participant in the bootstrap topology. */
  readonly coordinatorId: ParticipantId
  /** Exact registered adapter identity frozen into the channel manifest. */
  readonly adapter: TeamAdapterRef
  /** Optional exact view policy identity frozen in the channel manifest. */
  readonly viewPolicy?: TeamViewPolicyRef | undefined
  /** Frozen participant membership and adapter-defined roles. */
  readonly participants: readonly ChannelParticipant[]
  /** Adapter-defined limits captured in the channel manifest. */
  readonly limits: JsonObject
}

/** Exact TeamRun invitation of one coordinator-selected worker participant. */
export interface TeamRunWorkerInviteScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-worker-invite'
  /** Team that receives the worker. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before the invitation. */
  readonly expectedCursor: number
  /** Complete immutable descriptor for the invited worker. */
  readonly participant: {
    /** Logical participant implementation category. */
    readonly kind: ParticipantKind
    /** Human-facing participant name. */
    readonly displayName: string
    /** Worker-pool responsibility label. */
    readonly role: string
    /** Immutable capabilities declared for scheduler eligibility. */
    readonly capabilities: readonly string[]
    readonly owner?: TeamParticipantOwner | undefined
    readonly provider?: string | undefined
    readonly preset?: string | undefined
    readonly model?: string | undefined
    readonly authScheme?: string | undefined
    /** Optional authority subset; omission inherits the Team grant. */
    readonly authorityGrant?: TeamAuthorityGrant | undefined
  }
}

/** Exact TeamRun activation of one worker-pool participant. */
export interface TeamRunWorkerActivateScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-worker-activate'
  /** Team that owns the default worker. */
  readonly teamId: TeamId
  /** Worker-pool participant selected for activation. */
  readonly participantId: ParticipantId
  /** Team-journal cursor observed before the phase transition. */
  readonly expectedCursor: number
  /** Worker activation starts from invitation or provisioning. */
  readonly expectedPhase: 'invited' | 'provisioning'
  /** Worker activation advances invitation to provisioning or provisioning to active. */
  readonly phase: 'provisioning' | 'active'
}

/** Exact TeamRun retirement of an idle worker-pool participant. */
export interface TeamRunWorkerRetireScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-worker-retire'
  /** Team that owns the worker. */
  readonly teamId: TeamId
  /** Worker participant whose durable membership is retired. */
  readonly participantId: ParticipantId
  /** Team-journal cursor observed before retirement. */
  readonly expectedCursor: number
  /** Current durable worker phase required by this transition. */
  readonly expectedPhase: 'invited' | 'provisioning' | 'active'
  /** Retired workers cannot receive later assignments. */
  readonly phase: 'left'
}

/** Exact TeamRun invitation of one lazily provisioned reviewer participant. */
export interface TeamRunReviewerInviteScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-reviewer-invite'
  /** Team that receives the reviewer. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before the invitation. */
  readonly expectedCursor: number
  /** Complete immutable descriptor for the invited reviewer. */
  readonly participant: {
    /** Logical participant implementation category. */
    readonly kind: ParticipantKind
    /** Human-facing participant name. */
    readonly displayName: string
    /** Template-defined responsibility label. */
    readonly role: string
    /** Immutable capabilities declared for scheduler eligibility. */
    readonly capabilities: readonly string[]
    /** Closed immutable human owner, when this descriptor creates a human participant. */
    readonly owner?: TeamParticipantOwner | undefined
    readonly provider?: string | undefined
    readonly preset?: string | undefined
    readonly model?: string | undefined
    readonly authScheme?: string | undefined
    /** Optional authority subset; omission inherits the Team grant. */
    readonly authorityGrant?: TeamAuthorityGrant | undefined
  }
}

/** Exact TeamRun membership transition for one lazily provisioned reviewer. */
export interface TeamRunReviewerPhaseScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-reviewer-phase'
  /** Team that owns the reviewer. */
  readonly teamId: TeamId
  /** Reviewer participant whose phase advances. */
  readonly participantId: ParticipantId
  /** Team-journal cursor observed before the phase transition. */
  readonly expectedCursor: number
  /** Current durable reviewer phase required by this transition. */
  readonly expectedPhase: 'invited' | 'provisioning'
  /** Next durable reviewer phase selected by the source. */
  readonly phase: 'provisioning' | 'active'
}

/** Closed TeamRun topology mutations a system source may select. */
export type TeamSystemTopologyScope =
  | TeamRunBootstrapParticipantInviteScope
  | TeamRunBootstrapParticipantPhaseScope
  | TeamRunBootstrapChannelOpenScope
  | TeamRunWorkerInviteScope
  | TeamRunWorkerActivateScope
  | TeamRunWorkerRetireScope
  | TeamRunReviewerInviteScope
  | TeamRunReviewerPhaseScope

/** Immutable source attribution resolved for one TeamRun topology proof. */
export interface TeamSystemTopologyProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact topology mutation supplied by that source. */
  readonly scope: TeamSystemTopologyScope
}

/**
 * Registration contributed by a TeamRun owner that retains opaque proofs for
 * exact default-topology mutations. A source never receives caller-selected
 * participant, phase, or channel attribution.
 */
export interface TeamSystemTopologyProofSource {
  /** Stable nonempty registry identity for the contributing TeamRun owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact topology scope, or `undefined` when this source does not own the token.
   */
  resolveTopologyProof(proof: TeamSystemTopologyProof): TeamSystemTopologyScope | undefined
}

/** Private nominal member that prevents structural construction of scheduler channel proof values. */
declare const teamSystemSchedulerChannelProofBrand: unique symbol

/**
 * Runtime-only evidence retained by the scheduler for one exact review or
 * task-assignment channel lifecycle mutation. It cannot grant generic channel authority.
 */
export interface TeamSystemSchedulerChannelProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemSchedulerChannelProofBrand]: never
}

/** Exact scheduler opening of one consult channel for a participant-review task. */
export interface SchedulerReviewChannelOpenScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'scheduler-review-channel-open'
  /** Team that owns the review task. */
  readonly teamId: TeamId
  /** Team cursor observed before channel admission. */
  readonly expectedTeamCursor: number
  /** Review task whose completed attempt needs a consult request. */
  readonly taskId: TeamTaskId
  /** Exact review revision retained by the task. */
  readonly expectedRevision: number
  /** Completed task attempt whose result is routed for review. */
  readonly attemptId: TaskAttemptId
  /** Completed attempt owner who receives the consult response. */
  readonly initiatorId: ParticipantId
  /** Active participant-review owner who receives the consult request. */
  readonly reviewerId: ParticipantId
  /** Exact idle reviewer activation selected for consult delivery. */
  readonly reviewerActivationId: ActivationId
  /** Session bound to the selected reviewer activation. */
  readonly reviewerSessionId: SessionId
  /** Provider that owns the selected reviewer activation. */
  readonly reviewerProvider: string
}

/** Exact scheduler opening of one self-addressed task-assignment wake channel. */
export interface SchedulerWakeChannelOpenScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'scheduler-wake-channel-open'
  /** Team that owns the pending task and selected activation. */
  readonly teamId: TeamId
  /** Team cursor observed before channel admission. */
  readonly expectedTeamCursor: number
  /** Pending task selected for assignment. */
  readonly taskId: TeamTaskId
  /** Task revision observed before assignment preparation. */
  readonly expectedRevision: number
  /** Selected active participant who will receive the self-addressed wake. */
  readonly participantId: ParticipantId
  /** Exact idle activation selected for the assignment lease. */
  readonly activationId: ActivationId
  /** Session bound to the selected activation. */
  readonly sessionId: SessionId
}

/** Exact scheduler closure of a wake channel whose assignment never committed. */
export interface SchedulerFailedWakeChannelCloseScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'scheduler-failed-wake-channel-close'
  /** Team that owns the orphaned wake channel. */
  readonly teamId: TeamId
  /** Task identity frozen into the wake channel manifest. */
  readonly taskId: TeamTaskId
  /** Selected participant frozen into the wake channel manifest. */
  readonly participantId: ParticipantId
  /** Selected activation frozen into the wake channel manifest. */
  readonly activationId: ActivationId
  /** Session frozen into the wake channel manifest. */
  readonly sessionId: SessionId
  /** Exact attached wake channel selected for closure. */
  readonly channelId: ChannelId
  /** Channel cursor observed before closure. */
  readonly expectedChannelCursor: number
  /** Fixed diagnostic retained by the terminal wake channel record. */
  readonly reason: 'Task assignment did not commit'
}

/** Exact scheduler expiry of a bounded due-delivery batch from one attached channel. */
export interface SchedulerChannelDeliveryExpireScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'scheduler-channel-delivery-expire'
  /** Team that currently attaches the selected channel. */
  readonly teamId: TeamId
  /** Attached channel whose pending TTL deliveries may be expired. */
  readonly channelId: ChannelId
  /** Team-journal cursor observed before this expiry batch. */
  readonly expectedTeamCursor: number
  /** Channel-WAL cursor observed before this expiry batch. */
  readonly expectedChannelCursor: number
  /** Scheduler clock observation used to determine which TTLs are due. */
  readonly now: number
  /** Maximum delivery-expiry records this exact batch may append. */
  readonly limit: number
}

/** Closed scheduler channel lifecycle mutations a system source may select. */
export type TeamSystemSchedulerChannelScope =
  | SchedulerReviewChannelOpenScope
  | SchedulerWakeChannelOpenScope
  | SchedulerFailedWakeChannelCloseScope
  | SchedulerChannelDeliveryExpireScope

/** Immutable source attribution resolved for one scheduler channel proof. */
export interface TeamSystemSchedulerChannelProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact scheduler channel mutation supplied by that source. */
  readonly scope: TeamSystemSchedulerChannelScope
}

/** Registration contributed by the scheduler that retains opaque proofs for exact channel lifecycle mutations. */
export interface TeamSystemSchedulerChannelProofSource {
  /** Stable nonempty registry identity for the contributing scheduler. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact scheduler channel scope, or `undefined` when this source does not own the token.
   */
  resolveSchedulerChannelProof(
    proof: TeamSystemSchedulerChannelProof,
  ): TeamSystemSchedulerChannelScope | undefined
}

/** Private nominal member that prevents structural construction of cancellation-cleanup proof values. */
declare const teamSystemCancellationCleanupProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered TeamRun source for one exact
 * post-release cleanup mutation after a durable cancellation intent. The proof
 * has no serializable fields and cannot grant coordinator or generic cleanup authority.
 */
export interface TeamSystemCancellationCleanupProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemCancellationCleanupProofBrand]: never
}

/** Exact TeamRun post-release cancellation of one pending Team task. */
export interface TeamRunCancellationTaskCleanupScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-cancellation-task-cancel'
  /** Team whose accepted cancellation owns this cleanup. */
  readonly teamId: TeamId
  /** Durable cancellation retry identity accepted by the Hub. */
  readonly cancellationIdempotencyKey: TeamClosureIdempotencyKey
  /** Durable cancellation timestamp accepted by the Hub. */
  readonly cancellationRequestedAt: number
  /** Team cursor observed before the cleanup mutation. */
  readonly expectedTeamCursor: number
  /** Pending task selected for cancellation cleanup. */
  readonly taskId: TeamTaskId
  /** Task revision observed before cancellation. */
  readonly expectedRevision: number
}

/** Exact TeamRun post-release closure of one active cancellation-owned channel. */
export interface TeamRunCancellationChannelCleanupScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-cancellation-channel-close'
  /** Team whose accepted cancellation owns this cleanup. */
  readonly teamId: TeamId
  /** Durable cancellation retry identity accepted by the Hub. */
  readonly cancellationIdempotencyKey: TeamClosureIdempotencyKey
  /** Durable cancellation timestamp accepted by the Hub. */
  readonly cancellationRequestedAt: number
  /** Team cursor observed before the cleanup mutation. */
  readonly expectedTeamCursor: number
  /** Attached active channel selected for closure. */
  readonly channelId: ChannelId
  /** Channel cursor observed before closure. */
  readonly expectedCursor: number
  /** Exact reason retained by the terminal channel record. */
  readonly reason: string
}

/** Closed TeamRun post-release cancellation cleanup mutations a source may select. */
export type TeamSystemCancellationCleanupScope = TeamRunCancellationTaskCleanupScope | TeamRunCancellationChannelCleanupScope

/** Immutable source attribution resolved for one TeamRun cancellation-cleanup proof. */
export interface TeamSystemCancellationCleanupProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact cancellation cleanup mutation supplied by that source. */
  readonly scope: TeamSystemCancellationCleanupScope
}

/**
 * Registration contributed by a TeamRun owner that retains opaque proofs for
 * exact cleanup after one durable cancellation intent. A source never receives
 * caller-selected cancellation, task, or channel attribution.
 */
export interface TeamSystemCancellationCleanupProofSource {
  /** Stable nonempty registry identity for the contributing TeamRun owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact cancellation-cleanup scope, or `undefined` when this source does not own the token.
   */
  resolveCancellationCleanupProof(
    proof: TeamSystemCancellationCleanupProof,
  ): TeamSystemCancellationCleanupScope | undefined
}

/** Private nominal member that prevents structural construction of finalization-cleanup proof values. */
declare const teamSystemFinalizationCleanupProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered TeamRun source for one exact
 * post-release channel closure after a durably receipted coordinator final.
 * The proof has no serializable fields and cannot grant generic close authority.
 */
export interface TeamSystemFinalizationCleanupProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemFinalizationCleanupProofBrand]: never
}

/** Exact TeamRun post-release closure of one active channel after an accepted final result. */
export interface TeamRunFinalizationChannelCleanupScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-finalization-channel-close'
  /** Team whose accepted final result owns this cleanup. */
  readonly teamId: TeamId
  /** Direct-v3 channel retaining the accepted coordinator final. */
  readonly finalChannelId: ChannelId
  /** Durable coordinator final accepted by the human participant. */
  readonly finalEnvelopeId: EnvelopeId
  /** Human recipient whose receipt made this final result admissible. */
  readonly humanId: ParticipantId
  /** Coordinator that authored the accepted final result. */
  readonly coordinatorId: ParticipantId
  /** Team cursor observed before the cleanup mutation. */
  readonly expectedTeamCursor: number
  /** Attached active channel selected for closure. */
  readonly channelId: ChannelId
  /** Channel cursor observed before closure. */
  readonly expectedCursor: number
  /** Exact completion-specific reason retained by the terminal channel record. */
  readonly reason: string
}

/** Closed TeamRun post-release finalization cleanup mutations a system source may select. */
export type TeamSystemFinalizationCleanupScope = TeamRunFinalizationChannelCleanupScope

/** Immutable source attribution resolved for one TeamRun finalization-cleanup proof. */
export interface TeamSystemFinalizationCleanupProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact finalization cleanup mutation supplied by that source. */
  readonly scope: TeamSystemFinalizationCleanupScope
}

/**
 * Registration contributed by a TeamRun owner that retains opaque proofs for
 * exact channel cleanup after a durably accepted final result. A source never
 * receives caller-selected participant, final, or channel attribution.
 */
export interface TeamSystemFinalizationCleanupProofSource {
  /** Stable nonempty registry identity for the contributing TeamRun owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact finalization-cleanup scope, or `undefined` when this source does not own the token.
   */
  resolveFinalizationCleanupProof(
    proof: TeamSystemFinalizationCleanupProof,
  ): TeamSystemFinalizationCleanupScope | undefined
}

/** Provider-reported token buckets for one model call. */
export interface TeamTokenUsage {
  /** Uncached prompt tokens. */
  readonly inputTokens: number
  /** Completion tokens, including reasoning tokens when the provider reports them separately. */
  readonly outputTokens: number
  /** Prompt tokens served from provider cache. */
  readonly cacheReadTokens?: number | undefined
  /** Prompt tokens written to provider cache. */
  readonly cacheWriteTokens?: number | undefined
  /** Optional provider-reported reasoning subset, already included in outputTokens. */
  readonly reasoningTokens?: number | undefined
}

/** Durable aggregate of provider usage observed by one Team subtree. */
export interface TeamUsageSnapshot {
  /** Sum of uncached prompt tokens. */
  readonly inputTokens: number
  /** Sum of completion tokens. */
  readonly outputTokens: number
  /** Sum of cache-read prompt tokens. */
  readonly cacheReadTokens: number
  /** Sum of cache-write prompt tokens. */
  readonly cacheWriteTokens: number
  /** Distinct model turns represented by accepted samples. */
  readonly turns: number
  /** Provider-normalized cost units, when supplied by the adapter. */
  readonly costUnits: number
  /** Epoch milliseconds of the latest accepted observation. */
  readonly updatedAt: number
}

/** Per-token price used when a provider reports usage but omits a cost. */
export interface TeamUsageRate {
  /** Cost units for one uncached input token. */
  readonly input: number
  /** Cost units for one output token. */
  readonly output: number
  /** Cost units for one cache-read token. */
  readonly cacheRead: number
  /** Cost units for one cache-write token. */
  readonly cacheWrite: number
}

/** One model-step usage fact with exact Team/Participant provenance. */
export interface TeamUsageSample {
  /** Idempotency identity for one Session turn/step usage observation. */
  readonly id: TeamUsageSampleId
  /** Team owning the model call. */
  readonly teamId: TeamId
  /** Participant that owned the Session. */
  readonly participantId: ParticipantId
  /** Session that emitted the provider usage. */
  readonly sessionId: SessionId
  /** Provider route that produced the model call, when known. */
  readonly provider?: string | undefined
  /** Provider model id that produced the model call, when known. */
  readonly model?: string | undefined
  /** Model turn number from the Session log. */
  readonly turn: number
  /** Model step number from the Session log. */
  readonly step: number
  /** Team task that consumed this model step, when the Agent held a task allocation. */
  readonly taskId?: TeamTaskId | undefined
  /** Exact task attempt that consumed this model step, when known. */
  readonly attemptId?: TaskAttemptId | undefined
  /** Provider usage buckets. */
  readonly usage: TeamTokenUsage
  /** Optional provider-normalized cost for this exact step. */
  readonly costUnits?: number | undefined
  /** Epoch milliseconds when this observation entered the Team journal. */
  readonly observedAt: number
}

/** One child-usage charge that can be replayed through every parent Team. */
export interface TeamUsageCharge {
  /** Stable identity derived from the originating Team and usage sample. */
  readonly id: TeamUsageChargeId
  /** Direct child Team that produced this charge for the current parent. */
  readonly sourceTeamId: TeamId
  /** Task in this parent that owns the direct child reservation. */
  readonly parentTaskId: TeamTaskId
  /** Original Team that owns the model usage sample. */
  readonly originTeamId: TeamId
  /** Usage sample identity being charged exactly once per parent. */
  readonly sourceSampleId: TeamUsageSampleId
  /** Participant that owned the originating model step. */
  readonly participantId: ParticipantId
  /** Session that emitted the originating model step. */
  readonly sessionId: SessionId
  /** Provider route that produced the originating model step, when known. */
  readonly provider?: string | undefined
  /** Provider model id that produced the originating model step, when known. */
  readonly model?: string | undefined
  /** Model turn number from the originating Session log. */
  readonly turn: number
  /** Model step number from the originating Session log. */
  readonly step: number
  /** Provider usage buckets being charged. */
  readonly usage: TeamTokenUsage
  /** Optional normalized cost for the originating model step. */
  readonly costUnits?: number | undefined
  /** Epoch milliseconds when this charge entered the current Team's aggregate. */
  readonly observedAt: number
}

/** Kind of logical participant. */
export type ParticipantKind = 'human' | 'local-agent' | 'remote-agent' | 'service'

/** Closed durable owner of a human Team participant. */
export type TeamParticipantOwner =
  | {
    /** Authenticated product principal that may receive human control-plane authority. */
    readonly kind: 'product-principal'
    /** Stable non-secret product-principal identity. */
    readonly principalId: Branded<'ProductPrincipalId'>
  }
  | {
    /** Closed system owner used by unattended product runs. */
    readonly kind: 'system'
  }

/** Intent for a recipient's local delivery. */
export type EnvelopeDelivery = 'context' | 'turn' | 'steer'

/** Delivery priority selected before Hub admission. */
export type EnvelopePriority = 'background' | 'normal' | 'urgent'

/** Durable child execution endpoints owned by one parent delegation. */
export interface TeamChildRunBinding extends TeamChildRunIdentity {
  /** Service Participant accepting the child's result for the parent task. */
  readonly parentServiceId: ParticipantId
  /** Child coordinator that may answer the bound consult request. */
  readonly coordinatorId: ParticipantId
  /** Exact consult channel for the parent request and child response. */
  readonly channelId: ChannelId
}

/** Runtime-authorized binding of a child's created endpoints. */
export interface TeamChildRunBindRequest {
  readonly authorization: TeamChildRunAuthorization
  readonly expectedCursor: number
  readonly binding: TeamChildRunBinding
}

/** Immutable Team read model returned by a Team provider. */
export interface TeamSnapshot {
  /** Team identity minted by its provider. */
  readonly id: TeamId
  /** Direct durable parent Team when this Team represents nested work. */
  readonly parentTeamId?: TeamId
  /** Parent Team task that created this nested Team. */
  readonly parentTaskId?: TeamTaskId
  /** Published result endpoints, present only for a parent-owned child Team. */
  readonly childRun?: TeamChildRunBinding | undefined
  /** Independent parent-service result evidence; never a human final admission. */
  readonly childResultAdmission?: import('./child-result-types.ts').TeamChildResultAdmission | undefined
  /** Edge distance from a root Team; root Teams have depth zero. */
  readonly depth: number
  /** Absolute subtree depth cap resolved when this Team was created. */
  readonly maxTeamDepth: number
  /** Current revisioned objective retained by the Team journal. */
  readonly goal: TeamGoalSnapshot
  /** Canonical project directory associated with this Team, when supplied by its creator. */
  readonly workspacePath?: string | undefined
  /** Current durable Team lifecycle phase. */
  readonly phase: TeamPhase
  /** Present exactly while the Team is durably stalled. */
  readonly stallReason?: TeamStallReason | undefined
  /** Present after a typed closure command is durably accepted. */
  readonly closure?: TeamClosureSnapshot | undefined
  /** Present after cancellation admission closes while owned work settles. */
  readonly cancellation?: TeamCancellationSnapshot | undefined
  /** Immutable root or child authority grant governing this Team. */
  readonly authorityGrant?: TeamAuthorityGrant | undefined
  /** System origin retained for proof-owned root creation; child delegation remains outside this slice. */
  readonly createdBy?: TeamCreationActor | undefined
  /** Highest committed Team-journal sequence represented by this view. */
  readonly cursor: number
  /** Epoch milliseconds when the Team was created. */
  readonly createdAt: number
  /** Epoch milliseconds of the latest Team-journal transition. */
  readonly updatedAt: number
  /** Epoch milliseconds when the terminal Team was archived, when hidden from default listings. */
  readonly archivedAt?: number
}

/** Request one bounded page of visible Team summaries.
 *
 * `afterCursor` is an exclusive materialized-journal descriptor ordinal, not a
 * Team-journal cursor. Archived descriptors remain part of the ordinal space,
 * while providers omit them from `items`.
 */
export interface TeamListPageRequest {
  /** Exclusive provider-order ordinal from a prior page, or `-1` initially. */
  readonly afterCursor: number
  /** Maximum number of Team summaries to return. */
  readonly limit: number
}

/** One bounded page of visible Team summaries. */
export interface TeamListPage {
  /** Visible Team summaries in provider order. */
  readonly items: readonly TeamSnapshot[]
  /** Provider-order ordinal for the next page when more summaries remain. */
  readonly nextCursor?: number | undefined
}

/** Immutable participant read model returned by a Team provider. */
export interface ParticipantSnapshot {
  /** Stable Team participant identity. */
  readonly id: ParticipantId
  /** Team that owns this participant. */
  readonly teamId: TeamId
  /** Logical participant kind. */
  readonly kind: ParticipantKind
  /** Human-facing participant name. */
  readonly displayName: string
  /** Template- or policy-defined responsibility label. */
  readonly role: string
  /** Immutable capabilities declared for scheduler eligibility. */
  readonly capabilities: readonly string[]
  /** Durable membership lifecycle phase. */
  readonly phase: ParticipantPhase
  /** Closed immutable owner required for a human participant and absent for other kinds. */
  readonly owner?: TeamParticipantOwner | undefined
  /** Optional AgentRuntime provider used for this participant. */
  readonly provider?: string | undefined
  /** Optional non-secret preset/model hints retained for placement and audit. */
  readonly preset?: string | undefined
  readonly model?: string | undefined
  /** Optional non-secret credential scheme identifier. */
  readonly authScheme?: string | undefined
  /** Immutable authority subset granted to this Participant. */
  readonly authorityGrant?: TeamAuthorityGrant | undefined
  /** Hub-derived counters and timing observations, never caller-claimed. */
  readonly stats?: ParticipantStats | undefined
}

/** Request one bounded page of a Team's participant projections. */
export interface TeamMemberListPageRequest {
  /** Team whose participants are read. */
  readonly teamId: TeamId
  /** Exclusive provider-order ordinal from a prior page, or `-1` initially. */
  readonly afterCursor: number
  /** Maximum number of participant projections to return. */
  readonly limit: number
}

/** Authenticated selection of a Team's attached channels in insertion order. */
export interface TeamChannelListInput {
  readonly teamId: TeamId
  /** Exclusive channel insertion index, or -1 before the first page. */
  readonly afterCursor?: number | undefined
  /** Requested page size, bounded by the provider's configured listing limit. */
  readonly limit?: number | undefined
}
/** Runtime-only current Team human membership authority for a channel page. */
export interface TeamChannelListRequest extends TeamChannelListInput { readonly actor: TeamHumanActorProof }
/** One bounded page of channel projections without WAL contents. */
export interface TeamChannelListPage {
  readonly items: readonly ChannelSnapshot[]
  readonly nextCursor?: number | undefined
}

/** One bounded page of a Team's participant projections. */
export interface TeamMemberListPage {
  /** Participant projections in first durable-record order. */
  readonly items: readonly ParticipantSnapshot[]
  /** Provider-order ordinal for the next page when more participants remain. */
  readonly nextCursor?: number | undefined
}

/** Deterministic ranking profile frozen in Team rules by its provider. */
export interface TeamTaskRankingPolicy {
  /** Closed tuple policy, using outcomes only after proposal, capability surplus, and load. */
  readonly name: 'outcome-latency'
  /** Interpretation of outcome counts, histograms, and missing evidence. */
  readonly version: 1
  /** Strictly increasing inclusive millisecond bounds; the final bucket contains larger latencies. */
  readonly latencyUpperBoundsMs: readonly number[]
  /** Strictly increasing maximum-per-token rate bounds used only for cost-constrained tasks. */
  readonly costRateUpperBounds: readonly number[]
  /** Unverified current model routes and absent frozen prices rank after every known rate bucket. */
  readonly missingCost: 'unknown-last'
}

/** Hub-derived attempt statistics for one Participant and exact required-capability set. */
export interface TeamTaskExecutionStats {
  /** Durable owner of these settled attempts. */
  readonly participantId: ParticipantId
  /** Sorted unique task requirements, independent of their input order. */
  readonly requiredCapabilities: readonly string[]
  /** Settled completed attempts for this capability set. */
  readonly completedAttempts: number
  /** Settled failed, expired, released, and cancelled attempts for this capability set. */
  readonly failedAttempts: number
  /** Sum of settledAt minus assignedAt, in milliseconds. */
  readonly totalLatencyMs: number
  /** Non-cumulative counts; one bucket per frozen bound plus an overflow bucket. */
  readonly latencyBucketCounts: readonly number[]
}

/** Hub-derived operational observations for one participant. */
export interface ParticipantStats {
  /** Number of currently assigned or running task attempts. */
  readonly activeAttempts: number
  /** Number of settled completed attempts. */
  readonly completedAttempts: number
  /** Number of settled failed, expired, released, or cancelled attempts. */
  readonly failedAttempts: number
  /** Sum of settled attempt wall time in milliseconds. */
  readonly totalLatencyMs: number
  /** Exact capability-set summaries used by the frozen scheduler ranking policy. */
  readonly taskOutcomes?: readonly TeamTaskExecutionStats[] | undefined
  /** Epoch milliseconds at which these observations were folded. */
  readonly updatedAt: number
}

/** Immutable live-activation projection returned by a Team provider. */
export interface ActivationSnapshot {
  /** One provider-owned activation epoch. */
  readonly id: ActivationId
  /** Team owning the activated participant. */
  readonly teamId: TeamId
  /** Logical participant whose residency this describes. */
  readonly participantId: ParticipantId
  /** Current process or remote reachability status. */
  readonly status: ActivationStatus
}

/** Provider termination evidence required before an activation can be replaced. */
export type ActivationTerminationMode = 'owned-process' | 'externally-fenced' | 'cooperative'

/** Non-secret endpoint selection and exact epoch for remote supervision. */
export interface ActivationSupervisorDescriptor {
  /** Registered supervisor implementation name. */
  readonly name: string
  /** Exact implementation version required after restart. */
  readonly version: number
  /** Deployment identity of the execution host. */
  readonly hostId: string
  /** Deployment endpoint alias; URLs and credentials remain provider configuration. */
  readonly endpointId: string
  /** Exact activation epoch to which health and fence results must belong. */
  readonly generation: ActivationId
  /** Execution termination mechanism owned by the endpoint. */
  readonly terminationMode: ActivationTerminationMode
}

/** Common process identity retained by a recoverable activation epoch. */
export interface ActivationRecoveryProcess {
  /** Stable deployment identity of the host that owns the process. */
  readonly hostId: string
  /** Operating-system process identifier. */
  readonly pid: number
  /** Opaque start fingerprint that prevents PID-reuse confusion. */
  readonly started: string
  /** POSIX process group when the runtime owns one. */
  readonly processGroupId?: number | undefined
}

/** Shared fields retained by a provider-specific activation recovery plan. */
interface ActivationRecoveryBase {
  /** Recovery-record format selected by {@link kind}. */
  readonly version: 1
  /** AgentRuntime provider that must match the enclosing activation binding. */
  readonly runtimeProvider: string
  /** Optional exact remote supervisor; absence selects the local process fencer. */
  readonly supervisor?: ActivationSupervisorDescriptor | undefined
  /** Deployment-selected non-secret runtime profile required on replacement. */
  readonly profile: string
  /** Exact local process identity that a later recovery owner must fence. */
  readonly process: ActivationRecoveryProcess
}

/** Immutable SDK cold-replacement data retained with one recoverable activation epoch. */
export interface SdkActivationRecoverySnapshot extends ActivationRecoveryBase {
  /** Concrete recovery mechanism accepted by the SDK provider. */
  readonly kind: 'sdk-local-cold-replace'
  /** Exact model route reused by the replacement SDK activation. */
  readonly agent: {
    /** Configured LLM provider route. */
    readonly provider: string
    /** Provider-specific model identifier. */
    readonly model: string
    /** Optional positive per-request output-token cap. */
    readonly maxTokens?: number | undefined
  }
}

/** Immutable same-host ACP cold-replacement data retained with one activation epoch. */
export interface AcpActivationRecoverySnapshot extends ActivationRecoveryBase {
  /** Concrete recovery mechanism accepted by the ACP provider. */
  readonly kind: 'acp-local-cold-replace'
  /** Workspace root required to create the replacement ACP session. */
  readonly cwd: string
}

/** Provider-specific facts required to cold-replace one activation epoch. */
export type ActivationRecoverySnapshot = SdkActivationRecoverySnapshot | AcpActivationRecoverySnapshot

/** Immutable durable binding of one activation epoch to its Session and placement provider. */
export interface ActivationBindingSnapshot {
  /** Provider-owned activation epoch and its current durable residency status. */
  readonly activation: ActivationSnapshot
  /** Session that the activated participant uses. */
  readonly sessionId: SessionId
  /** Named AgentRuntime provider that published this activation epoch. */
  readonly provider: string
  /** Actual composition selected by the activation owner, never participant hints. */
  readonly selection?: {
    readonly preset?: string | undefined
    readonly provider?: string | undefined
    readonly model?: string | undefined
  } | undefined
  /** Optional provider-specific facts required to cold-replace this epoch after a Hub restart. */
  readonly recovery?: ActivationRecoverySnapshot | undefined
  /** Hub-stamped provider termination proof retained while closure-owned workspace cleanup remains pending. */
  readonly fencedAt?: number | undefined
  /** Hub-stamped proof that this epoch is quiescent before replacement. */
  readonly quiescedAt?: number | undefined
  /** Trusted actor that proved the epoch quiescent. */
  readonly quiescenceSource?: 'fenced' | 'quiesced' | undefined
  /** Wake channels that must be terminal before a quiescent epoch can be replaced. */
  readonly quiescedWakeChannelIds?: readonly ChannelId[] | undefined
}

/** Private nominal member that prevents structural construction of actor proof values. */
declare const teamActorProofBrand: unique symbol

/**
 * Runtime-only evidence that a trusted issuer resolved one activation binding.
 * The proof has no serializable fields; a TeamRuntime accepts only the exact
 * object it issued for that runtime.
 */
export interface TeamActorProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamActorProofBrand]: never
}

/** One revocable runtime lease for an issued Team actor proof. */
export interface TeamActorProofLease {
  /** Opaque proof accepted by the issuing TeamRuntime until revoked. */
  readonly proof: TeamActorProof
  /** Invalidate this proof without affecting other issued proofs. */
  revoke(): void
}

/** Stable digest for the complete JSON-only payload bound to a human mutation proof. */
export type TeamHumanActorPayloadFingerprint = Branded<'TeamHumanActorPayloadFingerprint'>

/** Read authorization or an observed optimistic-concurrency fence bound to a human proof. */
export type TeamHumanActorProofFence =
  | { readonly kind: 'read' }
  | { readonly kind: 'cursor'; readonly cursor: number }
  | { readonly kind: 'revision'; readonly revision: number }

/** JSON-only facts whose complete value is bound to one human mutation proof. */
export interface TeamHumanActorProofInput {
  /** Team selected by the authenticated product route. */
  readonly teamId: TeamId
  /** Mutation operation required by the grant, or membership-only channel inspection. */
  readonly operation: TeamPolicyHook | 'channel-invitation-read' | 'channel-admission-read' | 'channel-list-read' | 'channel-content-read'
  /** Current cursor or revision observed before the mutation. */
  readonly fence: TeamHumanActorProofFence
  /** Complete parsed JSON-only mutation input, excluding every runtime proof. */
  readonly payload: JsonValue
}

/** Private nominal member that prevents structural construction of human proof values. */
declare const teamHumanActorProofBrand: unique symbol

/**
 * Runtime-only evidence that an authenticated product principal mapped to one
 * exact active human participant. It never crosses a durable or wire boundary.
 */
export interface TeamHumanActorProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamHumanActorProofBrand]: never
}

/** Exact durable attribution and payload fence resolved from one human proof. */
export interface TeamHumanActorScope {
  /** Team selected when the proof was minted. */
  readonly teamId: TeamId
  /** Exact active human participant derived from the authenticated principal. */
  readonly participantId: ParticipantId
  /** Policy operation accepted by the participant's immutable grant. */
  readonly operation: TeamPolicyHook | 'channel-invitation-read' | 'channel-admission-read' | 'channel-list-read' | 'channel-content-read'
  /** Digest of the complete JSON-only mutation input and its Team fence. */
  readonly payloadFingerprint: TeamHumanActorPayloadFingerprint
  /** Cursor or revision observed before the proof was minted. */
  readonly fence: TeamHumanActorProofFence
}

/** Detached source attribution resolved for one runtime-only human proof. */
export interface TeamHumanActorProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact participant attribution and payload fence selected by that source. */
  readonly scope: TeamHumanActorScope
}

/**
 * Registration contributed by a product-authentication binder that retains
 * runtime-only human proof scopes for the duration of one admitted operation.
 */
export interface TeamHumanActorProofSource {
  /** Stable nonempty registry identity for the contributing binder. */
  readonly name: string
  /**
   * Resolve one source-owned proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact human mutation scope, or `undefined` when this source does not own the token.
   */
  resolveHumanActorProof(proof: TeamHumanActorProof): TeamHumanActorScope | undefined
}

/**
 * Trusted factory for activation-bound Team actor proofs. Closing an issuer
 * blocks future issuance but leaves its previously issued leases valid until
 * each lease is revoked.
 */
export interface ActivationActorProofIssuer {
  /**
   * Validate and freeze one exact activation binding before issuing its proof.
   * @param binding - activation, Session, and provider binding resolved by the issuer.
   * @returns a revocable lease for one runtime-only proof.
   */
  issue(binding: ActivationBindingSnapshot): TeamActorProofLease
  /** Stop this issuer from creating additional proof leases. */
  close(): void
}

/** Private nominal member that prevents structural construction of system activation proof values. */
declare const teamSystemActivationProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered source for one exact
 * activation lifecycle mutation. The proof has no serializable fields and
 * cannot grant generic activation ownership.
 */
export interface TeamSystemActivationProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemActivationProofBrand]: never
}

/** Exact controller-owned publication of one newly created activation binding. */
export interface ActivationControllerBindScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'activation-controller-bind'
  /** Team-journal cursor observed before the raw handle was published. */
  readonly expectedCursor: number
  /** Complete binding produced by the controller-owned raw activation handle. */
  readonly binding: ActivationBindingSnapshot
}

/** Exact controller-owned residency status observation for one activation epoch. */
export interface ActivationControllerStatusScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'activation-controller-status'
  /** Team that owns the observed activation epoch. */
  readonly teamId: TeamId
  /** Activation epoch whose residency status changes. */
  readonly activationId: ActivationId
  /** Participant bound to that activation epoch. */
  readonly participantId: ParticipantId
  /** Session bound to that activation epoch. */
  readonly sessionId: SessionId
  /** AgentRuntime provider that published that activation epoch. */
  readonly provider: string
  /** Team-journal cursor observed before this status mutation. */
  readonly expectedCursor: number
  /** Exact next residency status observed from the owned raw handle. */
  readonly status: ActivationStatus
}

/** Exact controller-owned fence of an externally terminated activation epoch. */
export interface ActivationControllerFenceScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'activation-controller-fence'
  /** Team that owns the fenced activation epoch. */
  readonly teamId: TeamId
  /** Activation epoch confirmed stopped by the controller's fencer. */
  readonly activationId: ActivationId
  /** Participant bound to the fenced activation epoch. */
  readonly participantId: ParticipantId
  /** Session bound to the fenced activation epoch. */
  readonly sessionId: SessionId
  /** AgentRuntime provider that published the fenced activation epoch. */
  readonly provider: string
  /** Team-journal cursor observed after external fencing completed. */
  readonly expectedCursor: number
}

/** Exact controller-owned quiescence settlement after one raw handle disposes. */
export interface ActivationControllerQuiesceScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'activation-controller-quiesce'
  /** Team that owns the settled activation epoch. */
  readonly teamId: TeamId
  /** Activation epoch whose local resources are settled. */
  readonly activationId: ActivationId
  /** Participant bound to the settled activation epoch. */
  readonly participantId: ParticipantId
  /** Session bound to the settled activation epoch. */
  readonly sessionId: SessionId
  /** AgentRuntime provider that published the settled activation epoch. */
  readonly provider: string
  /** Team-journal cursor observed before quiescence settlement. */
  readonly expectedCursor: number
}

/** Exact startup-recovery wake cleanup for an already locally quiesced epoch. */
export interface ActivationRecoveryQuiesceScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'activation-recovery-quiesce'
  /** Team that owns the wake-cleanup activation epoch. */
  readonly teamId: TeamId
  /** Activation epoch whose recorded wake channels are retried. */
  readonly activationId: ActivationId
  /** Participant bound to the recovered activation epoch. */
  readonly participantId: ParticipantId
  /** Session bound to the recovered activation epoch. */
  readonly sessionId: SessionId
  /** AgentRuntime provider that published the recovered activation epoch. */
  readonly provider: string
  /** Team-journal cursor observed before the recovery cleanup retry. */
  readonly expectedCursor: number
}

/** Closed activation-lifecycle mutations a system source may select. */
export type TeamSystemActivationScope =
  | ActivationControllerBindScope
  | ActivationControllerStatusScope
  | ActivationControllerFenceScope
  | ActivationControllerQuiesceScope
  | ActivationRecoveryQuiesceScope

/** Immutable system-source attribution resolved for one activation lifecycle proof. */
export interface TeamSystemActivationProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact activation lifecycle operation supplied by that source. */
  readonly scope: TeamSystemActivationScope
}

/**
 * Registration contributed by a system owner that retains opaque activation
 * lifecycle proofs. A source never receives caller-selected durable binding
 * attribution.
 */
export interface TeamSystemActivationProofSource {
  /** Stable nonempty registry identity for the contributing system owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact activation scope, or `undefined` when this source does not own the token.
   */
  resolveActivationProof(proof: TeamSystemActivationProof): TeamSystemActivationScope | undefined
}

/** Private nominal member that prevents structural construction of system final-receipt proof values. */
declare const teamSystemFinalReceiptProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered system source for one closed
 * final-result admission and human receipt. The source owns proof construction and lifetime; the proof
 * contains no serializable fields and does not grant generic human authority.
 */
export interface TeamSystemFinalReceiptProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemFinalReceiptProofBrand]: never
}

/** Retry identity scoped to one Team's closed final-result sink. */
export type TeamFinalAdmissionIdempotencyKey = Branded<'TeamFinalAdmissionIdempotencyKey'>

/** SHA-256 fingerprint of the canonical JSON payload retained by the final channel WAL. */
export type TeamFinalContentFingerprint = Branded<'TeamFinalContentFingerprint'>

/** JSON-only selection for durable admission to the final recipient’s owned result sink. */
export interface TeamFinalAdmissionInput {
  /** Team whose closed result sink accepts this final. */
  readonly teamId: TeamId
  /** Channel retaining the complete final payload. */
  readonly channelId: ChannelId
  /** Exact coordinator final selected by the result owner. */
  readonly envelopeId: EnvelopeId
  /** WAL sequence of the selected final. */
  readonly envelopeSequence: number
  /** Fingerprint independently recomputed from the committed final payload. */
  readonly contentFingerprint: TeamFinalContentFingerprint
  /** Team-scoped retry identity bound to all selected final facts. */
  readonly idempotencyKey: TeamFinalAdmissionIdempotencyKey
}

/** Runtime-only final admission through the existing closed TeamRun authority. */
export interface TeamFinalAdmissionRequest extends TeamFinalAdmissionInput {
  /** Source-owned proof whose exact human and coordinator are revalidated before commit. */
  readonly actor: TeamSystemFinalReceiptProof
}

/** Durable result acceptance independent of completion intent and channel receipt. */
export interface TeamFinalAdmission extends TeamFinalAdmissionInput {
  /** Discriminates the unattended system result from a persisted principal inbox delivery. */
  readonly sink: 'team-run-result' | 'principal-inbox'
  /** Exact inbox sequence for principal admission; absent for the closed system sink. */
  readonly inboxSequence?: number | undefined
  /** Human recipient derived from the proof and committed final audience. */
  readonly recipientId: ParticipantId
  /** Durable human owner derived from Team membership, never selected by the caller. */
  readonly owner: TeamParticipantOwner
  /** Journal timestamp of the flushed result acceptance. */
  readonly admittedAt: number
}

/** Exact durable topology that a system source may use to admit and receipt a coordinator final. */
export interface TeamSystemFinalReceiptScope {
  /** Team that owns the exact final channel. */
  readonly teamId: TeamId
  /** Two-party channel that retains the coordinator final. */
  readonly channelId: ChannelId
  /** Human recipient whose durable receipt may be appended. */
  readonly humanId: ParticipantId
  /** Coordinator whose final Envelope the Hub must validate. */
  readonly coordinatorId: ParticipantId
}

/** Immutable system-source attribution resolved for one final-receipt proof. */
export interface TeamSystemFinalReceiptProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact Team, channel, human, and coordinator scope supplied by that source. */
  readonly scope: TeamSystemFinalReceiptScope
}

/**
 * Registration contributed by a system owner that retains its own opaque
 * final-receipt proofs. Returning `undefined` means this source does not own
 * the supplied proof; a source never receives a caller-selected human id.
 */
export interface TeamSystemFinalReceiptProofSource {
  /** Stable nonempty registry identity for the contributing system owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact receipt scope, or `undefined` when this source does not own the token.
   */
  resolveFinalReceiptProof(proof: TeamSystemFinalReceiptProof): TeamSystemFinalReceiptScope | undefined
}

/** Private nominal member that prevents structural construction of system Envelope-post proof values. */
declare const teamSystemEnvelopePostProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered system source for one narrow
 * ordinary Envelope admission. The source owns proof construction and
 * lifetime; the proof contains no serializable fields and grants no generic
 * human or sender authority.
 */
export interface TeamSystemEnvelopePostProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemEnvelopePostProofBrand]: never
}

/** Exact default topology that a TeamRun source may use for trusted human input. */
export interface TeamRunHumanInputEnvelopePostScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-human-input'
  /** Team that owns the exact default direct channel. */
  readonly teamId: TeamId
  /** Active direct-v3 channel that receives the human input. */
  readonly channelId: ChannelId
  /** Human participant derived as the submitted Envelope sender. */
  readonly humanId: ParticipantId
  /** Coordinator participant derived as the sole human-input recipient. */
  readonly coordinatorId: ParticipantId
}

/** Exact assignment delivery that a scheduler source may append once. */
export interface SchedulerAssignmentEnvelopePostScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'scheduler-assignment'
  /** Team that owns the leased task and assignment channel. */
  readonly teamId: TeamId
  /** Self-addressed task-assignment channel that receives the assignment. */
  readonly channelId: ChannelId
  /** Task whose current lease selected this assignment. */
  readonly taskId: TeamTaskId
  /** Current lease attempt that the assignment wakes. */
  readonly attemptId: TaskAttemptId
  /** Task revision committed with the current lease assignment. */
  readonly assignedRevision: number
  /** Agent participant derived as the assignment Envelope sender and recipient. */
  readonly assigneeId: ParticipantId
  /** Exact activation selected for the assignment wake. */
  readonly activationId: ActivationId
  /** Session durably bound to the selected activation. */
  readonly sessionId: SessionId
}

/** Exact completed-task review request that a scheduler source may append once. */
export interface SchedulerReviewRequestEnvelopePostScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'scheduler-review-request'
  /** Team that owns the reviewed task and consult channel. */
  readonly teamId: TeamId
  /** Consult channel that receives the review request. */
  readonly channelId: ChannelId
  /** Task whose completed attempt requires review. */
  readonly taskId: TeamTaskId
  /** Completed attempt carried by the review request. */
  readonly attemptId: TaskAttemptId
  /** Current task revision that the reviewer may resolve. */
  readonly reviewRevision: number
  /** Task-result participant derived as the review-request sender. */
  readonly initiatorId: ParticipantId
  /** Participant derived as the sole review-request recipient. */
  readonly reviewerId: ParticipantId
  /** Exact idle reviewer activation selected for consult delivery. */
  readonly reviewerActivationId: ActivationId
  /** Session bound to the selected reviewer activation. */
  readonly reviewerSessionId: SessionId
  /** Provider that owns the selected reviewer activation. */
  readonly reviewerProvider: string
}

/** Exact parent-service request derived from the reserved child objective. */
export interface TeamDelegationEnvelopePostScope {
  readonly kind: 'team-delegation-request'
  readonly binding: TeamChildRunBinding
  readonly objective: string
}

/** Closed durable topologies that a system source may select for ordinary Envelope admission. */
export type TeamSystemEnvelopePostScope =
  | TeamDelegationEnvelopePostScope
  | TeamRunHumanInputEnvelopePostScope
  | SchedulerAssignmentEnvelopePostScope
  | SchedulerReviewRequestEnvelopePostScope

/** Immutable system-source attribution resolved for one ordinary Envelope-post proof. */
export interface TeamSystemEnvelopePostProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact source operation and durable topology supplied by that source. */
  readonly scope: TeamSystemEnvelopePostScope
}

/**
 * Registration contributed by a system owner that retains its own opaque
 * ordinary Envelope-post proofs. Returning `undefined` means this source does
 * not own the supplied proof; a source never receives caller-selected sender
 * or activation identity.
 */
export interface TeamSystemEnvelopePostProofSource {
  /** Stable nonempty registry identity for the contributing system owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact Envelope-post scope, or `undefined` when this source does not own the token.
   */
  resolveEnvelopePostProof(proof: TeamSystemEnvelopePostProof): TeamSystemEnvelopePostScope | undefined
}

/** Private nominal member that prevents structural construction of system task-review proof values. */
declare const teamSystemTaskReviewProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered system source for one narrow
 * durable review-response recovery. The proof contains no serializable fields
 * and cannot grant a generic reviewer identity.
 */
export interface TeamSystemTaskReviewProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemTaskReviewProofBrand]: never
}

/** Exact scheduler recovery selected by one accepted consult review response. */
export interface SchedulerReviewResponseTaskReviewScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'scheduler-review-response'
  /** Team that owns the review task. */
  readonly teamId: TeamId
  /** Review task selected by the current task revision. */
  readonly taskId: TeamTaskId
  /** Task revision observed while the response recovery was selected. */
  readonly expectedRevision: number
  /** Completed attempt retained by the review task. */
  readonly attemptId: TaskAttemptId
  /** Configured reviewer derived from the consult response sender. */
  readonly reviewerId: ParticipantId
  /** Completed-attempt owner derived from the consult request sender. */
  readonly initiatorId: ParticipantId
  /** Consult channel that owns both review Envelopes. */
  readonly channelId: ChannelId
  /** Durable scheduler review request that the response must cause. */
  readonly requestEnvelopeId: EnvelopeId
  /** Durable consult response that authorizes this recovery. */
  readonly responseEnvelopeId: EnvelopeId
  /** Review phase derived from the accepted or rework response decision. */
  readonly nextPhase: 'completed' | 'pending'
  /** Review reason derived from the durable consult response text. */
  readonly reason: string
}

/** Closed durable scope a system task-review source may select. */
export type TeamSystemTaskReviewScope = SchedulerReviewResponseTaskReviewScope

/** Immutable system-source attribution resolved for one task-review recovery proof. */
export interface TeamSystemTaskReviewProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact task, reviewer, and consult-response scope supplied by that source. */
  readonly scope: TeamSystemTaskReviewScope
}

/**
 * Registration contributed by a system owner that retains opaque task-review
 * recovery proofs. A source never receives a caller-selected reviewer or
 * response identity.
 */
export interface TeamSystemTaskReviewProofSource {
  /** Stable nonempty registry identity for the contributing system owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact task-review scope, or `undefined` when this source does not own the token.
   */
  resolveTaskReviewProof(proof: TeamSystemTaskReviewProof): TeamSystemTaskReviewScope | undefined
}

/** Private nominal member that prevents structural construction of system closure proof values. */
declare const teamSystemClosureProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered source for one exact Team
 * closure operation. The proof has no serializable fields and cannot grant a
 * generic durable closure actor.
 */
export interface TeamSystemClosureProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemClosureProofBrand]: never
}

/** Exact TeamRun completion selected after a durable human-facing final. */
export interface TeamRunCompleteClosureScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-complete'
  /** Team whose default topology may complete. */
  readonly teamId: TeamId
  /** Default direct-v3 channel that retains the final. */
  readonly channelId: ChannelId
  /** Human recipient of the final. */
  readonly humanId: ParticipantId
  /** Coordinator sender of the final. */
  readonly coordinatorId: ParticipantId
  /** Exact accepted final Envelope selected for completion. */
  readonly finalEnvelopeId: EnvelopeId
}

/** Exact TeamRun human cancellation selected for its current default topology. */
export interface TeamRunCancelClosureScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-cancel'
  /** Team whose admission may close. */
  readonly teamId: TeamId
  /** Default direct-v3 channel that identifies this TeamRun topology. */
  readonly channelId: ChannelId
  /** Human participant in the current default topology. */
  readonly humanId: ParticipantId
  /** Current TeamRun coordinator paired with that human. */
  readonly coordinatorId: ParticipantId
}

/** Exact TeamRun creation failure that may settle a partially initialized Team. */
export interface TeamRunCreateFailureClosureScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-create-failure'
  /** Team whose creation failed before a current run exists. */
  readonly teamId: TeamId
}

/** Closed durable scopes a system closure source may select. */
export type TeamSystemClosureScope =
  | TeamRunCompleteClosureScope
  | TeamRunCancelClosureScope
  | TeamRunCreateFailureClosureScope

/** Immutable system-source attribution resolved for one Team closure proof. */
export interface TeamSystemClosureProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact closure operation and topology supplied by that source. */
  readonly scope: TeamSystemClosureScope
}

/**
 * Registration contributed by a system owner that retains opaque Team closure
 * proofs. A source never receives caller-selected durable actor attribution.
 */
export interface TeamSystemClosureProofSource {
  /** Stable nonempty registry identity for the contributing system owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact closure scope, or `undefined` when this source does not own the token.
   */
  resolveClosureProof(proof: TeamSystemClosureProof): TeamSystemClosureScope | undefined
}

/** Private nominal member that prevents structural construction of closure-driver proof values. */
declare const teamSystemClosureDriverProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered source for one bounded pass
 * that may continue an already durable Team closure or cancellation.
 */
export interface TeamSystemClosureDriverProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemClosureDriverProofBrand]: never
}

/** Exact recovery of one durable completion intent. */
export interface TeamClosureRecoverCompleteScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'closure-recover-complete'
  /** Team whose already accepted completion may reach its terminal phase. */
  readonly teamId: TeamId
  /** Team-journal cursor observed when the pass selected this durable intent. */
  readonly expectedCursor: number
  /** Retry identity retained by the durable completion intent. */
  readonly closureIdempotencyKey: TeamClosureIdempotencyKey
  /** Durable timestamp retained by the completion intent. */
  readonly closureRequestedAt: number
  /** Channel retained by the accepted human-receipted coordinator final. */
  readonly finalChannelId: ChannelId
  /** Accepted human-receipted coordinator final selected by the intent. */
  readonly finalEnvelopeId: EnvelopeId
}

/** Exact recovery of one durable failure intent. */
export interface TeamClosureRecoverFailScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'closure-recover-fail'
  /** Team whose already accepted failure may reach its terminal phase. */
  readonly teamId: TeamId
  /** Team-journal cursor observed when the pass selected this durable intent. */
  readonly expectedCursor: number
  /** Retry identity retained by the durable failure intent. */
  readonly closureIdempotencyKey: TeamClosureIdempotencyKey
  /** Durable timestamp retained by the failure intent. */
  readonly closureRequestedAt: number
}

/** Exact recovery of one durable cancellation admission. */
export interface TeamClosureRecoverCancelScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'closure-recover-cancel'
  /** Team whose already accepted cancellation may reach its terminal phase. */
  readonly teamId: TeamId
  /** Team-journal cursor observed when the pass selected this durable admission. */
  readonly expectedCursor: number
  /** Retry identity retained by the durable cancellation admission. */
  readonly cancellationIdempotencyKey: TeamClosureIdempotencyKey
  /** Durable timestamp retained by the cancellation admission. */
  readonly cancellationRequestedAt: number
}

/**
 * Current-observer stall intent for a coordinator turn that ended normally
 * without an accepted final answer. The coordinator epoch and turn fence keep
 * a delayed observer from stalling a later epoch.
 */
export interface TeamClosureStallMissingFinalScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'closure-stall-missing-final'
  /** Team whose current lifecycle becomes stalled. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before recording the stall intent. */
  readonly expectedCursor: number
  /** Coordinator participant whose turn ended without a final. */
  readonly coordinatorId: ParticipantId
  /** Coordinator activation epoch observed by the current source. */
  readonly activationId: ActivationId
  /** Session bound to the observed coordinator epoch. */
  readonly sessionId: SessionId
  /** AgentRuntime provider that owns the observed coordinator epoch. */
  readonly provider: string
  /** Coordinator turn that ended without an accepted final. */
  readonly turn: number
  /** Canonical direct-v3 final channel observed by the current Team consumer. */
  readonly finalChannelId?: ChannelId | undefined
  /** Human recipient whose durable receipt qualifies the canonical final. */
  readonly humanId?: ParticipantId | undefined
  /** Exact durable stall reason; its code is `FINAL_ANSWER_MISSING`. */
  readonly reason: TeamStallReason
}

/** Current-observer failure intent for one structured coordinator turn failure. */
export interface TeamClosureFailTurnScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'closure-fail-turn'
  /** Team whose failure intent is being recorded. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before recording the failure intent. */
  readonly expectedCursor: number
  /** Coordinator participant whose turn produced the structured failure. */
  readonly coordinatorId: ParticipantId
  /** Coordinator activation epoch observed by the current source. */
  readonly activationId: ActivationId
  /** Session bound to the observed coordinator epoch. */
  readonly sessionId: SessionId
  /** AgentRuntime provider that owns the observed coordinator epoch. */
  readonly provider: string
  /** Coordinator turn that produced the failure. */
  readonly turn: number
  /** Canonical direct-v3 final channel observed by the current Team consumer. */
  readonly finalChannelId?: ChannelId | undefined
  /** Human recipient whose durable receipt qualifies the canonical final. */
  readonly humanId?: ParticipantId | undefined
  /** Exact structured failure code and message retained by the durable intent. */
  readonly reason: TeamStallReason
}

/** Current-observer stall intent for one frozen Team resource ceiling. */
export interface TeamClosureStallBudgetScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'closure-stall-budget'
  /** Team whose current lifecycle becomes stalled. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before recording the stall intent. */
  readonly expectedCursor: number
  /** Exact typed budget reason selected from the frozen Team limits. */
  readonly reason: TeamStallReason
}

/** Recovery fact for a quiescing Team that retained no closure producer. */
export interface TeamClosureStallQuiescingScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'closure-stall-quiescing'
  /** Team whose orphaned quiescing phase becomes stalled. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before recording the stall. */
  readonly expectedCursor: number
  /** Durable reason explaining why no producer can continue quiescence. */
  readonly reason: TeamStallReason
}

/** Closed recovery and current-observer intent operations a closure-driver proof may select. */
export type TeamSystemClosureDriverScope =
  | TeamClosureRecoverCompleteScope
  | TeamClosureRecoverFailScope
  | TeamClosureRecoverCancelScope
  | TeamClosureStallMissingFinalScope
  | TeamClosureFailTurnScope
  | TeamClosureStallBudgetScope
  | TeamClosureStallQuiescingScope

/** Immutable source attribution resolved for one closure-driver proof. */
export interface TeamSystemClosureDriverProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact durable identity and cursor selected by that source. */
  readonly scope: TeamSystemClosureDriverScope
}

/**
 * Registration contributed by a closure driver that privately retains opaque
 * recovery proofs. It cannot mint an initial Team closure or cancellation.
 */
export interface TeamSystemClosureDriverProofSource {
  /** Stable nonempty registry identity for the contributing closure driver. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact recovery scope, or `undefined` when this source does not own the token.
   */
  resolveClosureDriverProof(proof: TeamSystemClosureDriverProof): TeamSystemClosureDriverScope | undefined
}

/** Runtime authority accepted only while a Team closure command is admitted. */
export type TeamClosureAuthority = TeamActorProof | TeamSystemClosureProof

/** Private nominal member that prevents structural construction of system phase proof values. */
declare const teamSystemPhaseProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered source for one narrow Team
 * phase transition. The proof has no serializable fields and cannot grant a
 * generic lifecycle-transition authority.
 */
export interface TeamSystemPhaseProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemPhaseProofBrand]: never
}

/** Exact TeamRun recovery operation that may resume one stalled Team. */
export interface TeamRunResumePhaseScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-resume'
  /** Team whose stalled lifecycle may return to active. */
  readonly teamId: TeamId
  /** Only the active lifecycle phase is permitted by this recovery source. */
  readonly phase: 'active'
}

/** Exact TeamRun final-result admission fence that closes new channel admission before local release. */
export interface TeamRunFinalizationQuiescePhaseScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-finalization-quiesce'
  /** Team whose accepted final result is being settled. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before quiescing completion admission. */
  readonly expectedCursor: number
  /** Only the quiescing lifecycle phase is permitted by this finalization fence. */
  readonly phase: 'quiescing'
  /** Direct-v3 channel retaining the accepted coordinator final. */
  readonly finalChannelId: ChannelId
  /** Durable human-receipted coordinator final selected for settlement. */
  readonly finalEnvelopeId: EnvelopeId
  /** Human recipient whose receipt made the final result admissible. */
  readonly humanId: ParticipantId
  /** Coordinator that authored the accepted final result. */
  readonly coordinatorId: ParticipantId
}

/** Exact scheduler operation that may record a durable Team stall. */
export interface SchedulerStallPhaseScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'scheduler-stall'
  /** Team whose active lifecycle may become stalled. */
  readonly teamId: TeamId
  /** Only the stalled lifecycle phase is permitted by this scheduler source. */
  readonly phase: 'stalled'
  /** Exact durable reason selected by the scheduler's bounded drive. */
  readonly reason: TeamStallReason
}

/** Exact activation-controller operation that records a remote cancellation whose termination cannot be proven. */
export interface ActivationControllerCancellationStallPhaseScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'activation-controller-cancellation-stall'
  /** Team whose cancellation remains blocked by one remote activation epoch. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before recording the stall. */
  readonly expectedCursor: number
  /** Only the stalled lifecycle phase is permitted by this cancellation fence. */
  readonly phase: 'stalled'
  /** Fixed durable reason selected by the controller after a provider cannot prove termination. */
  readonly reason: TeamStallReason
  /** Exact durable cancellation identity that this stall belongs to. */
  readonly cancellationIdempotencyKey: TeamClosureIdempotencyKey
  /** Durable timestamp of the selected cancellation intent. */
  readonly cancellationRequestedAt: number
  /** Activation epoch whose remote termination remains unconfirmed. */
  readonly activationId: ActivationId
  /** Participant bound to that activation epoch. */
  readonly participantId: ParticipantId
  /** Session bound to that activation epoch. */
  readonly sessionId: SessionId
  /** AgentRuntime provider that could not prove termination. */
  readonly provider: string
}

/** Exact closure resource whose owner cannot prove termination or workspace release. */
export interface ActivationControllerClosureStallPhaseScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'activation-controller-closure-stall'
  /** Team retaining the accepted lifecycle intent. */
  readonly teamId: TeamId
  /** Team cursor observed before recording the resource stall. */
  readonly expectedCursor: number
  /** A resource stall cannot resume or terminate its Team. */
  readonly phase: 'stalled'
  /** Exact durable intent branch whose cleanup cannot proceed. */
  readonly closureKind: 'complete' | 'fail' | 'cancel'
  /** Immutable retry identity of that intent. */
  readonly idempotencyKey: TeamClosureIdempotencyKey
  /** Immutable admission timestamp of that intent. */
  readonly requestedAt: number
  /** Exact epoch whose termination or allocation cleanup remains unresolved. */
  readonly activationId: ActivationId
  /** Participant bound to the selected epoch. */
  readonly participantId: ParticipantId
  /** Durable Session bound to the selected epoch. */
  readonly sessionId: SessionId
  /** Runtime provider retaining the recovery responsibility. */
  readonly provider: string
  /** Durable diagnostic naming the unresolved resource. */
  readonly reason: TeamStallReason
}

/** Closed durable scopes a system phase source may select. */
export interface ActivationControllerRecoveryStallPhaseScope {
  /** Exact recovery operation selected by the controller. */
  readonly kind: 'activation-controller-recovery-stall'
  readonly teamId: TeamId
  readonly expectedCursor: number
  readonly phase: 'stalled'
  readonly reason: TeamStallReason
  readonly activationId: ActivationId
  readonly participantId: ParticipantId
  readonly sessionId: SessionId
  readonly provider: string
  /** Exact descriptor whose health or fence cannot be established, when a supervisor owns the epoch. */
  readonly supervisor?: ActivationSupervisorDescriptor | undefined
}

/** Closed durable scopes a system phase source may select. */
export type TeamSystemPhaseScope =
  | TeamRunResumePhaseScope
  | TeamRunFinalizationQuiescePhaseScope
  | SchedulerStallPhaseScope
  | ActivationControllerCancellationStallPhaseScope
  | ActivationControllerClosureStallPhaseScope
  | ActivationControllerRecoveryStallPhaseScope

/** Immutable system-source attribution resolved for one Team phase proof. */
export interface TeamSystemPhaseProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact phase transition selected by that source. */
  readonly scope: TeamSystemPhaseScope
}

/**
 * Registration contributed by a system owner that retains opaque Team phase
 * proofs. A source never receives caller-selected phase or stall facts.
 */
export interface TeamSystemPhaseProofSource {
  /** Stable nonempty registry identity for the contributing system owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact phase scope, or `undefined` when this source does not own the token.
   */
  resolvePhaseProof(proof: TeamSystemPhaseProof): TeamSystemPhaseScope | undefined
}

/** Private nominal member that prevents structural construction of system maintenance proof values. */
declare const teamSystemMaintenanceProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered source for one exact
 * destructive Team-maintenance operation. The proof has no serializable
 * fields and cannot grant generic journal-compaction authority.
 */
export interface TeamSystemMaintenanceProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemMaintenanceProofBrand]: never
}

/** Exact scheduler-owned compaction of one terminal Team journal prefix. */
export interface SchedulerTeamJournalCompactionScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'scheduler-team-journal-compaction'
  /** Terminal Team whose journal prefix may be compacted. */
  readonly teamId: TeamId
  /** Team-journal cursor the scheduler observed before compaction. */
  readonly expectedCursor: number
  /** Highest Team-journal sequence selected for removal. */
  readonly throughSequence: number
}

/** Exact scheduler-owned compaction of one terminal channel WAL prefix. */
export interface SchedulerChannelCompactionScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'scheduler-channel-compaction'
  /** Team that owns the selected terminal channel. */
  readonly teamId: TeamId
  /** Terminal channel whose WAL prefix may be compacted. */
  readonly channelId: ChannelId
  /** Channel-WAL cursor the scheduler observed before compaction. */
  readonly expectedCursor: number
  /** Highest channel-WAL sequence selected for removal. */
  readonly throughSequence: number
}

/** Closed durable scopes a system maintenance source may select. */
export type TeamSystemMaintenanceScope = SchedulerTeamJournalCompactionScope | SchedulerChannelCompactionScope

/** Immutable system-source attribution resolved for one Team-maintenance proof. */
export interface TeamSystemMaintenanceProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact destructive maintenance operation selected by that source. */
  readonly scope: TeamSystemMaintenanceScope
}

/**
 * Registration contributed by a system owner that retains opaque Team
 * maintenance proofs. A source never receives caller-selected compaction
 * identities or bounds.
 */
export interface TeamSystemMaintenanceProofSource {
  /** Stable nonempty registry identity for the contributing system owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact maintenance scope, or `undefined` when this source does not own the token.
   */
  resolveMaintenanceProof(proof: TeamSystemMaintenanceProof): TeamSystemMaintenanceScope | undefined
}

/** Private nominal member that prevents structural construction of system interrupt proof values. */
declare const teamSystemInterruptProofBrand: unique symbol

/**
 * Runtime-only evidence retained by a registered source for one exact human
 * soft-interrupt request. The proof has no serializable fields and cannot
 * grant generic participant interrupt authority.
 */
export interface TeamSystemInterruptProof {
  /** Opaque nominal member that prevents structural construction. */
  readonly [teamSystemInterruptProofBrand]: never
}

/** Exact current TeamRun human-to-coordinator soft-interrupt operation. */
export interface TeamRunHumanInterruptScope {
  /** Closed source operation selected by this proof. */
  readonly kind: 'team-run-human-interrupt'
  /** Team that owns the exact default human/coordinator topology. */
  readonly teamId: TeamId
  /** Default direct-v3 channel that proves the two-party topology. */
  readonly channelId: ChannelId
  /** Human participant derived as the interrupt requester. */
  readonly humanId: ParticipantId
  /** Coordinator participant derived as the soft-interrupt target. */
  readonly coordinatorId: ParticipantId
}

/** Closed durable scopes a system interrupt source may select. */
export type TeamSystemInterruptScope = TeamRunHumanInterruptScope

/** Immutable system-source attribution resolved for one Team interrupt proof. */
export interface TeamSystemInterruptProofResolution {
  /** Registered source that retained and resolved the opaque proof. */
  readonly sourceName: string
  /** Exact human-to-coordinator soft-interrupt scope selected by that source. */
  readonly scope: TeamSystemInterruptScope
}

/**
 * Registration contributed by a system owner that retains opaque Team
 * interrupt proofs. A source never receives caller-selected requester or
 * target participant identities.
 */
export interface TeamSystemInterruptProofSource {
  /** Stable nonempty registry identity for the contributing system owner. */
  readonly name: string
  /**
   * Resolve one source-owned opaque proof while it remains live.
   * @param proof - runtime-only token retained by this source.
   * @returns the exact interrupt scope, or `undefined` when this source does not own the token.
   */
  resolveInterruptProof(proof: TeamSystemInterruptProof): TeamSystemInterruptScope | undefined
}

/** Immutable activation binding selected for one soft participant interrupt. */
export interface ParticipantInterruptTarget {
  /** Team that owns the activated participant. */
  readonly teamId: TeamId
  /** Participant selected for interruption. */
  readonly participantId: ParticipantId
  /** Exact currently deliverable activation epoch. */
  readonly activationId: ActivationId
  /** Session durably bound to the target activation. */
  readonly sessionId: SessionId
  /** AgentRuntime provider that owns the target activation. */
  readonly provider: string
}

/** Durable soft-interrupt command and its optional exact-target acknowledgement. */
export interface ParticipantInterruptSnapshot {
  /** Hub-minted interrupt identity. */
  readonly id: TeamInterruptId
  /** Active Team participant that requested the interrupt. */
  readonly actorId: ParticipantId
  /** Immutable activation binding that may receive the soft interrupt. */
  readonly target: ParticipantInterruptTarget
  /** Epoch milliseconds when the Hub committed the request. */
  readonly requestedAt: number
  /** Epoch milliseconds when the exact target acknowledged the request. */
  readonly acknowledgedAt?: number
}

/** Immutable activation binding identity that authorized one task-creation command. */
export interface TeamTaskCreator {
  /** Team that owns the creator's activation binding. */
  readonly teamId: TeamId
  /** Active coordinator agent participant that issued the task-creation command. */
  readonly participantId: ParticipantId
  /** Exact activation epoch that issued the command. */
  readonly activationId: ActivationId
  /** Session durably bound to the creator activation. */
  readonly sessionId: SessionId
  /** AgentRuntime provider that owns the creator activation. */
  readonly provider: string
}

/** Durable product-human attribution for one authenticated task-creation command. */
export interface TeamHumanTaskCreator {
  /** Team that owns the authenticated human participant. */
  readonly teamId: TeamId
  /** Active human participant derived from the authenticated product principal. */
  readonly participantId: ParticipantId
}

/** Durable source attribution accepted for one task-creation command. */
export type TeamTaskCommandCreator = TeamTaskCreator | TeamHumanTaskCreator

/** Durable retry identity for one activation- or human-authorized task-creation command. */
export interface TeamTaskCreateCommand {
  /** Exact activation binding or authenticated human participant that authorized the command. */
  readonly creator: TeamTaskCommandCreator
  /** Opaque key supplied by that creator for retry-safe task creation. */
  readonly idempotencyKey: TeamTaskCreateIdempotencyKey
}

/** JSON-only retry identity for one task creation. */
export interface TeamTaskCreateCommandInput {
  /** Opaque key supplied by the caller for retry-safe task creation. */
  readonly idempotencyKey: TeamTaskCreateIdempotencyKey
}

/** Current bounded lease for the active attempt of one Team task. */
export interface TaskLeaseSnapshot {
  /** Provider-minted attempt identity used to fence subsequent owner writes. */
  readonly attemptId: TaskAttemptId
  /** Task revision committed with this lease assignment and retained for idempotent start claims. */
  readonly assignedRevision: number
  /** One-based task-local attempt sequence that is never reused. */
  readonly ordinal: number
  /** Participant authorized to start, renew, or settle this exact attempt. */
  readonly participantId: ParticipantId
  /** Current agent residency epoch authorized for this lease, when the owner is an agent participant. */
  readonly activationId?: ActivationId
  /** Attached Team channel that carries the task-assignment wake-up for this lease, when one was selected. */
  readonly wakeChannelId?: ChannelId
  /** Epoch milliseconds when the provider assigned this attempt. */
  readonly assignedAt: number
  /** Epoch milliseconds when the owner started execution, when it has started. */
  readonly startedAt?: number
  /** Fixed lease duration selected when the scheduler assigned this attempt. */
  readonly durationMs: number
  /** Epoch milliseconds when the provider most recently renewed this lease. */
  readonly renewedAt: number
  /** Epoch milliseconds after which the provider may expire this lease. */
  readonly expiresAt: number
}

/** Immutable settled task-attempt record retained in one task's bounded history. */
export interface TaskAttemptSnapshot {
  /** Provider-minted attempt identity. */
  readonly id: TaskAttemptId
  /** Team that owns the task this attempt executed. */
  readonly teamId: TeamId
  /** Task that this attempt executed. */
  readonly taskId: TeamTaskId
  /** One-based task-local attempt sequence that is never reused. */
  readonly ordinal: number
  /** Participant that held the lease for this attempt. */
  readonly participantId: ParticipantId
  /** Agent residency epoch that held this attempt's lease, when the owner was an agent participant. */
  readonly activationId?: ActivationId
  /** Persistent task-assignment channel attached to this attempt's lease, when one was selected. */
  readonly wakeChannelId?: ChannelId
  /** Epoch milliseconds when the provider assigned this attempt. */
  readonly assignedAt: number
  /** Epoch milliseconds when the owner started execution, when it started. */
  readonly startedAt?: number
  /** Latest lease expiry recorded before this attempt settled. */
  readonly leaseExpiresAt: number
  /** Epoch milliseconds when the provider recorded the terminal outcome. */
  readonly settledAt: number
  /** Closed terminal fact for this attempt. */
  readonly outcome: TaskAttemptOutcome
}

/** Frozen review route selected when a task is created. */
export type TeamTaskReviewPolicy =
  | { readonly kind: 'none' }
  | { readonly kind: 'participant'; readonly reviewerId: ParticipantId }

/** Durable resolution of one completed task attempt by its configured reviewer. */
export interface TeamTaskReviewDecision {
  /** Completed attempt whose result this decision resolves. */
  readonly attemptId: TaskAttemptId
  /** Participant that accepted the result or returned it for rework. */
  readonly reviewerId: ParticipantId
  /** Task phase selected by the review decision. */
  readonly nextPhase: 'completed' | 'pending'
  /** Nonempty explanation retained with the durable review result. */
  readonly reason: string
  /** Epoch milliseconds when the provider committed this decision. */
  readonly decidedAt: number
}

/** Versioned condition accepted by a declarative Team workflow graph. */
export type TeamWorkflowCondition =
  | { readonly kind: 'always' }
  | { readonly kind: 'envelope-kind'; readonly value: string }
  | { readonly kind: 'payload-present'; readonly path: string }
  | { readonly kind: 'payload-equals'; readonly path: string; readonly value: JsonValue }
  | { readonly kind: 'extension'; readonly name: string; readonly version: number; readonly config: JsonValue }

/** Versioned target accepted by a declarative Team workflow graph. */
export type TeamWorkflowTarget =
  | { readonly kind: 'participant'; readonly role: string }
  | { readonly kind: 'round-robin' }
  | { readonly kind: 'stay' }
  | { readonly kind: 'return-to-initiator' }
  | { readonly kind: 'terminate' }
  | { readonly kind: 'extension'; readonly name: string; readonly version: number; readonly config: JsonValue }

/** One ordered condition-to-target edge in a Team workflow channel plan. */
export interface TeamWorkflowTransition {
  /** Ordered condition evaluated against the accepted channel Envelope. */
  readonly condition: TeamWorkflowCondition
  /** Target selected when the condition matches. */
  readonly target: TeamWorkflowTarget
}

/** Bounded declarative transition graph stored inside a workflow plan. */
export interface TeamWorkflowGraph {
  /** Target expected before the first workflow Envelope. */
  readonly initial: TeamWorkflowTarget
  /** Ordered post-Envelope transitions; the first matching condition wins. */
  readonly transitions: readonly TeamWorkflowTransition[]
  /** Fallback target when no ordered condition matches. */
  readonly defaultTarget?: TeamWorkflowTarget | undefined
  /** Hard upper bound on accepted workflow Envelopes. */
  readonly maxTurns: number
}

/** Channel portion of one declarative Team workflow plan. */
export interface TeamWorkflowChannelPlan {
  /** Ordered Team participant roles admitted to the workflow channel. */
  readonly participantRoles: readonly string[]
  /** Pure transition graph; participant targets name roles, not opaque ids. */
  readonly graph: TeamWorkflowGraph
  /** Optional versioned pure projection policy for channel reads. */
  readonly viewPolicy?: TeamViewPolicyRef | undefined
}

/** Review route selected by a workflow task template before role resolution. */
export type TeamWorkflowTaskReviewPolicy =
  | { readonly kind: 'none' }
  | { readonly kind: 'participant'; readonly reviewerRole: string }

/** One task definition in a declarative workflow plan. */
export interface TeamWorkflowTaskTemplate {
  /** Plan-local stable label used by dependency and result projections. */
  readonly id: TeamWorkflowTaskTemplateId
  /** Short human-readable task subject. */
  readonly subject: string
  /** Complete self-contained instructions retained in the Team task. */
  readonly description: string
  /** Plan-local task labels that must complete first. */
  readonly blockedBy: readonly TeamWorkflowTaskTemplateId[]
  /** Capabilities required of the eventual task owner. */
  readonly requiredCapabilities: readonly string[]
  /** Scheduler-defined immutable priority. */
  readonly priority: number
  /** Workspace-relative read prefixes. */
  readonly readScopes: readonly string[]
  /** Workspace-relative write prefixes. */
  readonly writeScopes: readonly string[]
  /** Execution-world requirement for the task. */
  readonly workspaceMode: TeamTaskWorkspaceMode
  /** Typed and provider-specific task ceilings. */
  readonly budget: JsonObject
  /** Reviewer role resolution, or no review. */
  readonly reviewPolicy: TeamWorkflowTaskReviewPolicy
  /** Maximum number of attempts this template may create. */
  readonly maxAttempts: number
}

/** Explicit bounds applied to one admitted workflow plan. */
export interface TeamWorkflowPlanBounds {
  /** Maximum task templates in the plan. */
  readonly maxTasks: number
  /** Maximum concurrently leased tasks belonging to the plan. */
  readonly maxParallelism: number
  /** Maximum total attempts across all plan tasks. */
  readonly maxTotalAttempts: number
}

/** Declarative selection of task results returned by a completed workflow. */
export interface TeamWorkflowResultProjection {
  /** Result projection discriminator. */
  readonly kind: 'task-results'
  /** Task template labels included in the projected result. */
  readonly taskTemplateIds: readonly TeamWorkflowTaskTemplateId[]
}

/** Complete JSON-serializable workflow input accepted by the shipped Consumer. */
export interface TeamWorkflowPlan {
  /** Workflow plan format and behavior version. */
  readonly version: 1
  /** Human-readable workflow name. */
  readonly name: string
  /** Complete task DAG templates. */
  readonly tasks: readonly TeamWorkflowTaskTemplate[]
  /** Explicit plan task and concurrency bounds. */
  readonly bounds: TeamWorkflowPlanBounds
  /** Workflow-channel participant roles and versioned transition graph. */
  readonly channel: TeamWorkflowChannelPlan
  /** Durable result projection selected by the plan author. */
  readonly result: TeamWorkflowResultProjection
}

/** Durable relation between one plan-local template and one Team task. */
export interface TeamWorkflowTaskBinding {
  /** Plan-local task template label. */
  readonly templateId: TeamWorkflowTaskTemplateId
  /** Team task created for the template. */
  readonly taskId: TeamTaskId
}

/** One task result selected by a completed workflow result projection. */
export type TeamWorkflowProjectedTaskResult =
  | {
    readonly templateId: TeamWorkflowTaskTemplateId
    readonly taskId: TeamTaskId
    readonly phase: 'completed'
    readonly result: TaskAttemptResult
  }
  | {
    readonly templateId: TeamWorkflowTaskTemplateId
    readonly taskId: TeamTaskId
    readonly phase: 'failed'
    readonly failure?: TaskAttemptFailure | undefined
  }
  | {
    readonly templateId: TeamWorkflowTaskTemplateId
    readonly taskId: TeamTaskId
    readonly phase: 'cancelled' | 'deleted'
    /** Retained prerequisite failure when execution never began. */
    readonly blockedByOutcome?: TeamTaskDependencyOutcome | undefined
  }

/** Result projection retained when a workflow plan reaches its terminal phase. */
export interface TeamWorkflowPlanResult {
  /** Result projection discriminator. */
  readonly kind: 'task-results'
  /** Results in the exact order selected by the plan. */
  readonly tasks: readonly TeamWorkflowProjectedTaskResult[]
}

/** Durable lifecycle of one admitted workflow plan. */
export type TeamWorkflowPlanPhase = 'compiling' | 'ready' | 'completed' | 'failed' | 'cancelled'

/** Complete durable workflow plan projection. */
export interface TeamWorkflowPlanSnapshot {
  /** Hub-minted workflow plan identity. */
  readonly id: TeamWorkflowPlanId
  /** Team that owns the plan. */
  readonly teamId: TeamId
  /** Compare-and-set revision for bindings and lifecycle. */
  readonly revision: number
  /** Retry identity used for admission. */
  readonly idempotencyKey: TeamWorkflowPlanIdempotencyKey
  /** Exact coordinator binding that authored the plan, when it was model-admitted. */
  readonly actor?: TeamTaskCreator | undefined
  /** Immutable plan input accepted at admission. */
  readonly plan: TeamWorkflowPlan
  /** Current durable compilation or terminal phase. */
  readonly phase: TeamWorkflowPlanPhase
  /** Task bindings in plan template order of successful admission. */
  readonly taskBindings: readonly TeamWorkflowTaskBinding[]
  /** Durable workflow channel after it is opened. */
  readonly channelId?: ChannelId | undefined
  /** Configured task results after all plan tasks settle, including failed or cancelled plans. */
  readonly result?: TeamWorkflowPlanResult | undefined
  /** Structured terminal failure, when compilation or execution failed. */
  readonly failure?: TeamStallReason | undefined
  /** Structured cancellation reason retained when Team closure cancels the plan. */
  readonly cancellation?: TeamStallReason | undefined
}

/** Exact model-visible review assignment retained as Session provenance. */
export interface TeamReviewAssignmentSource {
  /** Source discriminator for a reviewer delivery. */
  readonly kind: 'team-review-assignment'
  /** Team that owns the reviewed task. */
  readonly teamId: TeamId
  /** Consult channel carrying the review request. */
  readonly channelId: ChannelId
  /** Review request Envelope admitted to the reviewer Session. */
  readonly envelopeId: EnvelopeId
  /** Task whose completed attempt is being reviewed. */
  readonly taskId: TeamTaskId
  /** Completed attempt included in the review evidence. */
  readonly attemptId: TaskAttemptId
  /** Exact task revision the reviewer is authorized to resolve. */
  readonly reviewRevision: number
  /** Reviewer participant selected by the frozen task policy. */
  readonly reviewerId: ParticipantId
  /** Participant that submitted the reviewed result and receives the response. */
  readonly initiatorId: ParticipantId
  /** Immutable result evidence delivered for this review. */
  readonly result: TaskAttemptResult
}

/** Exact work selected by an accepted single-task cancellation. */
export type TeamTaskCancellationTarget =
  | { readonly kind: 'delegation'; readonly delegationId: TeamDelegationId; readonly childTeamId?: TeamId | undefined }
  | { readonly kind: 'pending' }
  | { readonly kind: 'review'; readonly attemptId: TaskAttemptId; readonly reviewerId: ParticipantId }
  | { readonly kind: 'attempt'; readonly attemptId: TaskAttemptId; readonly participantId: ParticipantId; readonly activationId: ActivationId }

/** Durable single-task stop intent; terminal attempt facts remain in attemptHistory. */
export interface TeamTaskCancellationSnapshot {
  /** Task revision selected by the original cancellation command. */
  readonly requestedRevision: number
  /** Authenticated participant that requested this cancellation. */
  readonly requestedBy: ParticipantId
  /** Optional caller-supplied explanation; absence means no reason was supplied. */
  readonly reason?: string | undefined
  /** Epoch milliseconds when this intent was durably accepted. */
  readonly requestedAt: number
  /** Immutable attempt or lease-free phase selected at admission. */
  readonly target: TeamTaskCancellationTarget
  /** Elapsed lease deadline recorded while owner termination remains unconfirmed. */
  readonly expiredAt?: number | undefined
}

/** Exact terminal dependency that prevents an unstarted dependent task from executing. */
export interface TeamTaskDependencyOutcome {
  /** Direct prerequisite in the same Team task graph. */
  readonly taskId: TeamTaskId
  /** Immutable terminal prerequisite revision used for propagation. */
  readonly revision: number
  /** Unsatisfied terminal outcome; pending or review dependencies do not propagate. */
  readonly phase: 'failed' | 'cancelled' | 'deleted'
}

/** Optional restrictions on a task's eligible participant descriptors and execution provider. */
export interface TeamTaskPlacement {
  /** Eligible durable identities; omission permits any otherwise authorized participant. */
  readonly participantIds?: readonly ParticipantId[] | undefined
  /** Eligible immutable participant roles. */
  readonly roles?: readonly string[] | undefined
  /** Eligible AgentRuntime provider names. */
  readonly providers?: readonly string[] | undefined
  /** Eligible named Agent presets; an unnamed preset does not match this restriction. */
  readonly presets?: readonly string[] | undefined
  /** Eligible immutable participant model route identifiers. */
  readonly models?: readonly string[] | undefined
}

/** Immutable Team task projection returned by a Team provider. */
export interface TeamTaskSnapshot {
  /** Team-local task identity. */
  readonly id: TeamTaskId
  /** Team that owns this task. */
  readonly teamId: TeamId
  /** Compare-and-set revision for mutations. */
  readonly revision: number
  /** Immutable task executor; child Teams never receive a Participant lease. */
  readonly execution: TeamTaskExecution
  /** Child-Team reservation and saga facts, absent for Participant tasks. */
  readonly delegation?: TeamTaskDelegationSnapshot | undefined
  /** Parent task that created this unit of work, when task ancestry exists. */
  readonly parentTaskId?: TeamTaskId
  /** Declarative workflow plan that owns this task, when the task was compiled from a plan. */
  readonly workflowPlanId?: TeamWorkflowPlanId | undefined
  /** Plan-local template that owns this task, when the task was compiled from a plan. */
  readonly workflowTemplateId?: TeamWorkflowTaskTemplateId | undefined
  /** Durable activation-bound command that created this task. */
  readonly createCommand: TeamTaskCreateCommand
  /** Optional scheduler hint naming a preferred Participant; this grants no authority. */
  readonly proposedOwnerId?: ParticipantId | undefined
  /** Creation-time placement restrictions, independently enforced during assignment. */
  readonly placement?: TeamTaskPlacement | undefined
  /** Short human-readable task subject. */
  readonly subject: string
  /** Complete durable task instructions. */
  readonly description: string
  /** Explicit workspace integration task specification, when this task integrates another attempt. */
  readonly integration?: TeamTaskIntegrationSpec | undefined
  /** Current durable task lifecycle phase. */
  readonly phase: TeamTaskPhase
  /** Tasks that must reach the provider-defined completion state first. */
  readonly blockedBy: readonly TeamTaskId[]
  /** Capabilities the assigned participant must declare. */
  readonly requiredCapabilities: readonly string[]
  /** Scheduler-defined immutable priority value. */
  readonly priority: number
  /** Declared filesystem regions this task may read. */
  readonly readScopes: readonly string[]
  /** Declared filesystem regions this task may modify. */
  readonly writeScopes: readonly string[]
  /** Execution-world requirement retained for scheduler and workspace providers. */
  readonly workspaceMode: TeamTaskWorkspaceMode
  /** Provider-defined budget facts frozen when the task was created. */
  readonly budget: JsonObject
  /** Frozen review route that determines whether a completed attempt completes directly or enters review. */
  readonly reviewPolicy: TeamTaskReviewPolicy
  /** Durable review decisions for completed attempts, in completed-attempt order. */
  readonly reviewHistory: readonly TeamTaskReviewDecision[]
  /** Maximum number of attempts permitted for this task. */
  readonly maxAttempts: number
  /** Number of retained settled attempts plus the current lease, when present. */
  readonly attemptCount: number
  /** Settled attempts retained until this task reaches its frozen attempt bound. */
  readonly attemptHistory: readonly TaskAttemptSnapshot[]
  /** Unsatisfied direct prerequisite that cancelled this unstarted task. */
  readonly blockedByOutcome?: TeamTaskDependencyOutcome | undefined
  /** Accepted single-task cancellation, retained after settlement for retries and attribution. */
  readonly cancellation?: TeamTaskCancellationSnapshot | undefined
  /** Current lease-backed attempt, present only while the task is assigned or running. */
  readonly lease?: TaskLeaseSnapshot
}

/** Exact model-visible task assignment provenance retained by local and ACP consumers. */
export interface TeamTaskAssignmentSource {
  /** Distinguishes a lease-backed task wake-up from direct Team channel input. */
  readonly kind: 'team-task-assignment'
  /** Team that owns the assigned task and source channel. */
  readonly teamId: TeamId
  /** Channel that durably carried this assignment. */
  readonly channelId: ChannelId
  /** Stable Hub-stamped assignment Envelope identity. */
  readonly envelopeId: EnvelopeId
  /** Task selected by the scheduler. */
  readonly taskId: TeamTaskId
  /** Current lease attempt that this source starts. */
  readonly attemptId: TaskAttemptId
  /** Task revision committed with the lease assignment. */
  readonly assignedRevision: number
  /** Task revision committed when this exact lease entered running execution. */
  readonly runningRevision: number
  /** Activation epoch that claimed the task start. */
  readonly activationId: ActivationId
  /** Durable provider allocation selected before this task input reached the model. */
  readonly workspaceAllocationId?: TeamWorkspaceAllocationSnapshot['id'] | undefined
}

declare module '@clocky/clocky-llm' {
  interface MessageSourceMap {
    'team-task-assignment': TeamTaskAssignmentSource
  }
}

/** Complete detached Team state returned by a Team provider. */
export interface TeamStateSnapshot {
  /** Current Team lifecycle and journal cursor. */
  readonly team: TeamSnapshot
  /** Current revisioned Team objective, duplicated for direct state consumers. */
  readonly goal: TeamGoalSnapshot
  /** Provider-resolved Team rules retained in the Team journal. */
  readonly rules: JsonObject
  /** Provider-resolved Team resource budgets retained in the Team journal. */
  readonly budgets: JsonObject
  /** Current durable participant projections. */
  readonly participants: readonly ParticipantSnapshot[]
  /** Every durable activation epoch and its Session binding, in creation order. */
  readonly activations: readonly ActivationBindingSnapshot[]
  /** Current durable task projections, including deleted tombstones, in first-record creation order. */
  readonly tasks: readonly TeamTaskSnapshot[]
  /** Provider-owned workspace allocations retained independently from immutable task-attempt history. */
  readonly workspaceAllocations: readonly TeamWorkspaceAllocationSnapshot[]
  /** Every channel owned by this Team, regardless of its lifecycle phase. */
  readonly channelIds: readonly ChannelId[]
  /** Durable host-mediated approval/question records, including settled history. */
  readonly humanActions?: readonly TeamHumanActionSnapshot[]
  /** Durable provider usage aggregate for this Team subtree. */
  readonly usage?: TeamUsageSnapshot
  /** Durable declarative workflow plans owned by this Team, in admission order. */
  readonly workflowPlans?: readonly TeamWorkflowPlanSnapshot[]
}

/** Read-only diagnostics used by schedulers and product completion policies. */
export interface TeamQuiescenceSnapshot {
  /** Team being evaluated. */
  readonly teamId: TeamId
  /** True only when no durable or live work is known to remain. */
  readonly quiescent: boolean
  /** Stable machine-readable reasons that keep the Team from quiescing. */
  readonly reasons: readonly string[]
  /** Current nonterminal task identities. */
  readonly activeTaskIds: readonly TeamTaskId[]
  /** Current non-offline activation identities. */
  readonly activeActivationIds: readonly ActivationId[]
  /** Provider allocations that still require release or recovery. */
  readonly activeWorkspaceAllocationIds: readonly TeamWorkspaceAllocationId[]
  /** Current nonterminal channel identities. */
  readonly openChannelIds: readonly ChannelId[]
}

/** One cumulative latency bucket; `null` is the final positive-infinity bucket. */
export interface TeamLatencyBucket {
  /** Inclusive upper bound in milliseconds, or `null` for all larger values. */
  readonly upperBoundMs: number | null
  /** Number of samples at or below this bucket's upper bound. */
  readonly count: number
}

/** Fixed-boundary latency histogram exposed by Team operational metrics. */
export interface TeamLatencyHistogram {
  /** Number of observations represented by the histogram. */
  readonly count: number
  /** Sum of observed latency milliseconds. */
  readonly sumMs: number
  /** Cumulative buckets in the order defined by the metrics implementation. */
  readonly buckets: readonly TeamLatencyBucket[]
}

/** Monotonic in-process operational counters for Team observability. */
export interface TeamMetricsSnapshot {
  /** Number of currently admitted Team operations awaiting settlement. */
  readonly activeAdmissions: number
  /** Current count of unacknowledged or non-expired recipient deliveries. */
  readonly pendingDeliveries: number
  /** Current count of non-offline activation epochs across loaded Teams. */
  readonly activeActivations: number
  /** Current count of nonterminal task projections across loaded Teams. */
  readonly activeTasks: number
  /** Current count of loaded Teams in the stalled phase. */
  readonly stalledTeams: number
  /** Largest channel cursor distance from its durable replay watermark. */
  readonly replayLag: number
  /** Most recently settled task-attempt latency in milliseconds. */
  readonly lastTaskLatencyMs: number
  /** Most recently acknowledged Envelope latency in milliseconds. */
  readonly lastReceiptLatencyMs: number
  /** Cumulative task-attempt latency histogram. */
  readonly taskLatency: TeamLatencyHistogram
  /** Cumulative receipt latency histogram. */
  readonly receiptLatency: TeamLatencyHistogram
  /** Number of workspace allocation conflicts reported by the provider. */
  readonly workspaceConflicts: number
  readonly teamEvents: number
  readonly channelEvents: number
  readonly policyDenials: number
  readonly adapterFailures: number
  readonly deliveryClaims: number
  readonly taskAssignments: number
  readonly taskRetries: number
  /** Number of successful terminal Team-journal compaction operations. */
  readonly teamCompactions: number
  /** Number of successful terminal channel-WAL compaction operations. */
  readonly channelCompactions: number
  /** Number of checkpoint writes that failed after a durable business commit. */
  readonly checkpointFailures: number
  /** Number of successful audit-projection repair or append passes. */
  readonly auditProjectionRepairs: number
  /** Number of audit-projection passes that failed after business commit. */
  readonly auditProjectionFailures: number
  readonly updatedAt: number
}

/** Process-local registry counts for retained channel protocol implementations. */
export interface TeamImplementationLeaseMetrics {
  /** Implementations that still accept new adapter leases. */
  readonly acceptingAdapterImplementations: number
  /** Retired adapter objects retained only because an existing lease references them. */
  readonly retiredAdapterImplementations: number
  /** Total live leases held against accepting and retired adapter implementations. */
  readonly activeAdapterLeases: number
  /** Implementations that still accept new view-policy leases. */
  readonly acceptingViewPolicyImplementations: number
  /** Retired view-policy objects retained only because an existing lease references them. */
  readonly retiredViewPolicyImplementations: number
  /** Total live leases held against accepting and retired view-policy implementations. */
  readonly activeViewPolicyLeases: number
}

/** JSON-only routing fields for one Host-owned pending human-action admission. */
export interface TeamHumanActionUpsertInput {
  /** Team that owns the action. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before this append. */
  readonly expectedCursor: number
}

/** JSON-only routing fields for one Host-owned human-action resolution. */
export interface TeamHumanActionResolveInput {
  /** Team that owns the action. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before this append. */
  readonly expectedCursor: number
}

/** Runtime-authorized admission of one pending Host human action. */
export interface TeamHumanActionUpsertRequest extends TeamHumanActionUpsertInput {
  /** Trusted Host human-action authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemHumanActionProof
}

/** Runtime-authorized resolution of one pending Host human action. */
export interface TeamHumanActionResolveRequest extends TeamHumanActionResolveInput {
  /** Trusted Host human-action authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemHumanActionProof
}

/** JSON-only provider/model usage facts for one activation-owned model step. */
export interface TeamUsageSampleInput {
  /** Idempotency identity for one Session turn/step usage observation. */
  readonly id: TeamUsageSampleId
  /** Provider route that produced the model call, when known. */
  readonly provider?: string | undefined
  /** Provider model id that produced the model call, when known. */
  readonly model?: string | undefined
  /** Model turn number from the Session log. */
  readonly turn: number
  /** Model step number from the Session log. */
  readonly step: number
  /** Team task that consumed this model step, when the Agent held a task allocation. */
  readonly taskId?: TeamTaskId | undefined
  /** Exact task attempt that consumed this model step, when known. */
  readonly attemptId?: TaskAttemptId | undefined
  /** Provider usage buckets. */
  readonly usage: TeamTokenUsage
  /** Optional provider-normalized cost for this exact step. */
  readonly costUnits?: number | undefined
}

/** JSON-only compare-and-set request that records one activation-owned usage sample. */
export interface TeamUsageRecordInput {
  /** Team-journal cursor observed before this append. */
  readonly expectedCursor: number
  /** Provider/model facts whose Team/Participant/Session provenance comes from the proof. */
  readonly sample: TeamUsageSampleInput
}

/** Runtime-authorized record of one provider-reported model usage sample. */
export interface TeamUsageRecordRequest extends TeamUsageRecordInput {
  /** Trusted current activation authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamActorProof
}

/** Registered channel-adapter identity frozen in a channel manifest. */
export interface TeamAdapterRef {
  /** Adapter implementation family. */
  readonly type: string
  /** Adapter format and behavior version. */
  readonly version: number
}

/** Versioned pure projection policy frozen in a channel manifest. */
export interface TeamViewPolicyRef {
  /** Projection policy family. */
  readonly type: string
  /** Projection policy behavior version. */
  readonly version: number
}

/** Stateless view-policy implementation used by channel read consumers. */
export interface TeamViewPolicy extends TeamViewPolicyRef {
  /** Project a bounded JSON-safe view from one channel record suffix. */
  project(input: {
    readonly manifest: ChannelManifest
    readonly records: readonly ChannelRecord[]
  }): JsonObject
}

/**
 * Retained exact view-policy implementation for one already admitted channel.
 * Releasing this runtime-only handle permits a retired registration to be
 * collected after its channel has reached terminal quiescence.
 */
export interface TeamViewPolicyLease {
  /** The exact policy object selected while the registration accepted work; reading after release throws. */
  readonly policy: TeamViewPolicy
  /** Whether this exact implementation retired from future registrations. */
  isRetired(): boolean
  /** Release this handle once; repeated calls are harmless. */
  release(): void
}

/** One participant's frozen role in a channel. */
export interface ChannelParticipant {
  /** Team participant visible in the channel. */
  readonly id: ParticipantId
  /** Adapter-defined role retained in the manifest. */
  readonly role: string
}

/** Retry identity for one endpoint invitation acknowledgement. */
export type ChannelInvitationIdempotencyKey = Branded<'ChannelInvitationIdempotencyKey'>

/** Exact immutable channel-manifest fingerprint. */
export type ChannelManifestFingerprint = Branded<'ChannelManifestFingerprint'>

/** Frozen delivery endpoint expected to confirm a channel invitation. */
export type ChannelInvitationEndpoint =
  | { readonly kind: 'activation'; readonly activationId?: ActivationId | undefined; readonly sessionId?: SessionId | undefined }
  | { readonly kind: 'human' }
  | { readonly kind: 'service'; readonly name: string }

/** Participant-specific invitation choices resolved before channel creation. */
export interface ChannelInvitationOptions {
  /** Member selected from the immutable channel roster. */
  readonly participantId: ParticipantId
  /** Required members must acknowledge before the channel becomes active. */
  readonly required: boolean
}

/** Durable consent and endpoint expectations for one immutable channel member. */
export interface ChannelInvitationSnapshot {
  /** Invited member; identity is scoped by the owning channel. */
  readonly participantId: ParticipantId
  /** Frozen adapter-defined member role. */
  readonly role: string
  /** The recipient may inspect the complete immutable channel manifest. */
  readonly visibility: 'channel'
  /** Whether activation requires this acknowledgement. */
  readonly required: boolean
  /** Epoch milliseconds after which an unacknowledged invitation expires. */
  readonly deadline: number
  /** Endpoint identity selected when the invitation was created. */
  readonly endpoint: ChannelInvitationEndpoint
  /** Monotonic invitation revision, beginning at one. */
  readonly revision: number
  /** Exact immutable manifest encoded by the Hub; acknowledgement must echo it. */
  readonly manifestFingerprint: ChannelManifestFingerprint
  /** Durable invitation lifecycle. */
  readonly status: 'pending' | 'acknowledged' | 'expired' | 'cancelled'
  /** Structured reason for expiry or cancellation. */
  readonly reason?: TeamStallReason | undefined
  /** Retry key retained when the endpoint acknowledges. */
  readonly acknowledgementKey?: ChannelInvitationIdempotencyKey | undefined
  /** Epoch milliseconds when the invitation reached its current terminal state. */
  readonly settledAt?: number | undefined
}

/** Complete channel admission projection, independent of message receipts. */
export interface ChannelAdmissionSnapshot {
  /** Current channel state. */
  readonly channel: ChannelSnapshot
  /** One durable invitation per immutable member. */
  readonly invitations: readonly ChannelInvitationSnapshot[]
}

/** Retained request identity for ordinary consult replies; it contains no request content. */
export interface ChannelConsultRequestMetadata {
  readonly teamId: TeamId
  readonly channelId: ChannelId
  readonly envelopeId: EnvelopeId
  readonly envelopeSequence: number
  readonly taskId?: TeamTaskId | undefined
  readonly review: boolean
}
/** Bounded status of built-in protocols, derived from the current adapter state. */
export type ChannelProtocolStatus =
  | { readonly kind: 'consult'; readonly phase: 'request' | 'response' | 'complete'; readonly request?: ChannelConsultRequestMetadata | undefined }
  | { readonly kind: 'discussion'; readonly turnCount: number; readonly maxTurns: number; readonly speakerPolicy: 'round-robin' | 'free-form' }
  | { readonly kind: 'other' }
/** Authenticated operator inspection, separate from endpoint consent responses. */
export interface ChannelHumanAdmissionSnapshot extends ChannelAdmissionSnapshot {
  readonly expectedNext: ChannelExpectedNext
  readonly protocolStatus: ChannelProtocolStatus
}

/** Actor-free selection of one retained channel Envelope. */
export interface ChannelHumanEnvelopeGetInput {
  readonly teamId: TeamId
  readonly channelId: ChannelId
  readonly envelopeId: EnvelopeId
  /** Exact WAL row; selection never scans unrelated channel history. */
  readonly envelopeSequence: number
}
/** Current human membership proof for the exact retained Envelope selection. */
export interface ChannelHumanEnvelopeGetRequest extends ChannelHumanEnvelopeGetInput {
  readonly actor: TeamHumanActorProof
}

/** Authenticated Team-member inspection of one attached channel's admission state. */
export interface ChannelHumanAdmissionGetRequest extends ChannelGetRequest {
  readonly teamId: TeamId
  /** Current principal proof bound to both Team and channel; never accepted from JSON. */
  readonly actor: TeamHumanActorProof
}

/** Authenticated human discovery result containing only the caller's invitation. */
export interface ChannelHumanInvitationSnapshot {
  /** Immutable manifest and current channel phase and cursors. */
  readonly channel: ChannelSnapshot
  /** Invitation belonging to the authenticated Team human. */
  readonly invitation: ChannelInvitationSnapshot
}

/** Runtime-only principal proof bound to a channel invitation query. */
export interface ChannelHumanInvitationGetRequest extends ChannelGetRequest {
  /** Current authenticated call proof; never supplied in JSON. */
  readonly actor: TeamHumanActorProof
}

/** JSON acknowledgement selecting one current endpoint invitation. */
export interface ChannelInvitationAcknowledgeInput {
  /** Channel carrying the invitation. */
  readonly channelId: ChannelId
  /** Exact invitation revision supplied to the endpoint. */
  readonly revision: number
  /** Exact immutable manifest accepted by the endpoint. */
  readonly manifestFingerprint: ChannelManifestFingerprint
  /** Retry identity, scoped to the invited participant and channel. */
  readonly idempotencyKey: ChannelInvitationIdempotencyKey
}

/** Activation-authenticated endpoint confirmation. */
export interface ChannelInvitationAcknowledgeRequest extends ChannelInvitationAcknowledgeInput {
  /** Live activation proof deriving the invited participant. */
  readonly actor: TeamActorProof | TeamHumanActorProof | TeamSystemChannelAdmissionProof
}

/** Private nominal identity retained by a channel admission owner. */
declare const teamSystemChannelAdmissionProofBrand: unique symbol

/** Runtime-only endpoint or expiry evidence retained by its named owner. */
export interface TeamSystemChannelAdmissionProof {
  /** Prevent structural fabrication of runtime authority. */
  readonly [teamSystemChannelAdmissionProofBrand]: never
}

/** Source-owned confirmation of one service or system human endpoint. */
export interface SystemChannelInvitationAcknowledgeScope extends ChannelInvitationAcknowledgeInput {
  /** Exact source operation. */
  readonly kind: 'channel-invitation-acknowledge'
  /** Owning Team. */
  readonly teamId: TeamId
  /** Participant derived by the accepting service owner. */
  readonly participantId: ParticipantId
}

/** JSON selection for a bounded channel invitation expiry pass. */
export interface ChannelInvitationExpireInput {
  /** Owning Team. */
  readonly teamId: TeamId
  /** Channel whose pending invitations are inspected. */
  readonly channelId: ChannelId
  /** Team cursor observed before the pass. */
  readonly expectedTeamCursor: number
  /** Channel cursor observed before the pass. */
  readonly expectedChannelCursor: number
}

/** Source-owned clock observation for one invitation expiry pass. */
export interface SystemChannelInvitationExpireScope extends ChannelInvitationExpireInput {
  /** Exact source operation. */
  readonly kind: 'channel-invitations-expire'
  /** Epoch milliseconds supplied by the admission Consumer's clock. */
  readonly now: number
}

/** Closed channel-admission operations that named owners may prove. */
export type TeamSystemChannelAdmissionScope = SystemChannelInvitationAcknowledgeScope | SystemChannelInvitationExpireScope

/** Exact named attribution resolved from a runtime-only admission proof. */
export interface TeamSystemChannelAdmissionProofResolution {
  /** Live registered source that owns the proof. */
  readonly sourceName: string
  /** Exact operation retained by the source. */
  readonly scope: TeamSystemChannelAdmissionScope
}

/** Owner of short-lived channel endpoint or expiry proofs. */
export interface TeamSystemChannelAdmissionProofSource {
  /** Stable named endpoint or admission Consumer. */
  readonly name: string
  /**
   * Resolve an opaque proof while its owning operation remains live.
   * @param proof - runtime-only authority supplied to the Hub.
   * @returns the exact owned operation, or undefined for another source's token.
   */
  resolveChannelAdmissionProof(proof: TeamSystemChannelAdmissionProof): TeamSystemChannelAdmissionScope | undefined
}

/** Source-authenticated bounded invitation expiry. */
export interface ChannelInvitationExpireRequest extends ChannelInvitationExpireInput {
  /** Named admission Consumer proof carrying the selected clock observation. */
  readonly actor: TeamSystemChannelAdmissionProof
}

/** Durable opening invitation or authenticated endpoint confirmation. */
export interface ChannelInvitationRecord {
  /** Invitation facts never imply a message receipt. */
  readonly type: 'channel/invitation' | 'channel/acknowledged' | 'channel/invitation-ended'
  /** Monotonic channel WAL sequence. */
  readonly sequence: number
  /** Epoch milliseconds when the record was committed. */
  readonly createdAt: number
  /** Complete resulting invitation state. */
  readonly invitation: ChannelInvitationSnapshot
}

/** Immutable protocol configuration for one channel. */
export interface ChannelManifest {
  /** Channel identity. */
  readonly id: ChannelId
  /** Team that owns this channel. */
  readonly teamId: TeamId
  /** Adapter implementation selected when the channel was opened. */
  readonly adapter: TeamAdapterRef
  /** Optional pure view policy frozen at channel creation. */
  readonly viewPolicy?: TeamViewPolicyRef | undefined
  /** Declarative workflow plan that owns this channel, when applicable. */
  readonly workflowPlanId?: TeamWorkflowPlanId | undefined
  /** Frozen channel membership and roles. */
  readonly participants: readonly ChannelParticipant[]
  /** Adapter-defined limits captured at channel creation. */
  readonly limits: JsonObject
}

/** Immutable channel projection returned by a Team provider. */
export interface ChannelSnapshot {
  /** Immutable configuration captured when the channel was opened. */
  readonly manifest: ChannelManifest
  /** Current durable channel lifecycle phase. */
  readonly phase: ChannelPhase
  /** Highest committed channel-WAL sequence represented by this view. */
  readonly cursor: number
  /** First retained channel-WAL cursor after an optional prefix compaction. */
  readonly firstCursor?: number | undefined
  /** Highest source cursor every current recipient replay scan may safely skip. */
  readonly replayWatermark?: number | undefined
}

/** Client-supplied envelope fields before Hub stamping. */
export interface TeamEnvelopeDraft {
  /** Target channel. */
  readonly channelId: ChannelId
  /** `null` addresses every other visible channel participant. */
  readonly audience: readonly ParticipantId[] | null
  /** Adapter-defined event kind. */
  readonly kind: string
  /** Adapter-validated JSON payload. */
  readonly payload: JsonObject
  /** Intended recipient treatment, subject to policy. */
  readonly delivery: EnvelopeDelivery
  /** Triggering envelope for a reply or handoff. */
  readonly causationId?: EnvelopeId
  /** Correlation key spanning a higher-level operation. */
  readonly correlationId?: string
  /** Related shared task. */
  readonly taskId?: TeamTaskId
  /** Trace correlation selected by the caller. */
  readonly traceId?: string
  /** Queue priority; the Hub resolves an omitted value. */
  readonly priority?: EnvelopePriority
  /** Optional lifetime measured from acceptance. */
  readonly ttlMs?: number
}

/** Hub-stamped immutable channel event. */
export interface TeamEnvelope extends TeamEnvelopeDraft {
  /** Envelope identity stable across retry and replay. */
  readonly id: EnvelopeId
  /** Owning Team. */
  readonly teamId: TeamId
  /** Monotonic sequence in the channel WAL. */
  readonly sequence: number
  /** Authenticated participant that submitted the draft. */
  readonly senderId: ParticipantId
  /** Resolved priority. */
  readonly priority: EnvelopePriority
  /** Epoch milliseconds when the Hub accepted this event. */
  readonly createdAt: number
}

/** JSON-only fields submitted to append one ordinary client draft to a channel WAL. */
export interface ChannelEnvelopePostInput {
  /** Channel-WAL cursor the caller read before requesting admission. */
  readonly expectedCursor: number
  /** Opaque retry key scoped to the sender derived from the runtime authority. */
  readonly idempotencyKey?: ChannelPostIdempotencyKey | undefined
  /** Unstamped event fields submitted for Hub admission. */
  readonly draft: TeamEnvelopeDraft
}

/** Runtime authority that derives the ordinary Envelope sender without accepting a caller-selected identity. */
export type ChannelEnvelopePostActor = TeamActorProof | TeamHumanActorProof | TeamSystemEnvelopePostProof

/** Runtime-only request to append one ordinary client draft to a channel WAL. */
export interface ChannelEnvelopePostRequest extends ChannelEnvelopePostInput {
  /** Trusted activation, authenticated-human, or narrow system authority; it never crosses a wire or durable boundary. */
  readonly actor: ChannelEnvelopePostActor
}

/** JSON-only fields submitted to prepare one adapter-owned final Envelope. */
export interface ChannelFinalPostInput {
  /** Product channel whose registered adapter prepares the final draft. */
  readonly channelId: ChannelId
  /** Sender-scoped opaque key for retry-safe final admission. */
  readonly idempotencyKey: ChannelPostIdempotencyKey
  /** Non-empty final text supplied by the model. */
  readonly text: string
}

/** Runtime-only request to atomically prepare and append an adapter-owned final Envelope. */
export interface ChannelFinalPostRequest extends ChannelFinalPostInput {
  /** Trusted activation authority; it never crosses a wire or durable boundary. */
  readonly actor: TeamActorProof
}

/** JSON-only fields that select one accepted Envelope for a recipient receipt. */
export interface ChannelEnvelopeReceiptInput {
  /** Channel that owns the accepted Envelope. */
  readonly channelId: ChannelId
  /** Accepted Envelope durably admitted by the recipient. */
  readonly envelopeId: EnvelopeId
  /** Channel-WAL cursor the caller read before requesting receipt acceptance. */
  readonly expectedCursor: number
}

/** Runtime authority that derives the receipt recipient without accepting a raw participant identifier. */
export type ChannelEnvelopeReceiptActor = TeamActorProof | TeamSystemFinalReceiptProof

/** Runtime-only request to record one recipient's durable Envelope admission. */
export interface ChannelEnvelopeReceiptRequest extends ChannelEnvelopeReceiptInput {
  /** Trusted activation or source-scoped system authority; it never crosses a wire or durable boundary. */
  readonly actor: ChannelEnvelopeReceiptActor
}

/** JSON-only fields that select one pending channel delivery. */
export interface ChannelDeliveryClaimInput {
  /** Channel that owns the accepted Envelope. */
  readonly channelId: ChannelId
  /** Accepted Envelope whose delivery is claimed. */
  readonly envelopeId: EnvelopeId
}

/** Runtime-only request to atomically claim one delivery through a trusted activation proof. */
export interface ChannelDeliveryClaimRequest extends ChannelDeliveryClaimInput {
  /** Trusted activation authority; it never crosses a wire or durable boundary. */
  readonly actor: TeamActorProof
}

/** Ephemeral Hub-issued linearization claim for one channel Envelope delivery. */
export interface ChannelDeliveryClaim {
  /** Exact durable binding that authorized this recipient delivery. */
  readonly binding: ActivationBindingSnapshot
  /** Current channel projection at the claim's linearization point. */
  readonly channel: ChannelSnapshot
  /** Accepted Envelope whose delivery this claim authorizes. */
  readonly envelopeId: EnvelopeId
  /** Recipient treatment derived from the accepted Envelope and channel adapter. */
  readonly delivery: EnvelopeDelivery
  /** Exact model-delivery view selected by the Hub before the delivery receipt, when this claim needs one. */
  readonly view?: TeamChannelViewEventData
}

/** Request one bounded page of currently pending deliveries for one channel recipient. */
export interface ChannelPendingDeliveryListRequest {
  /** Channel whose pending recipient deliveries are enumerated. */
  readonly channelId: ChannelId
  /** Recipient whose pending deliveries are enumerated. */
  readonly participantId: ParticipantId
  /** Exclusive source channel-WAL cursor from a prior page, or `-1` before the first page. */
  readonly afterCursor: number
  /** Maximum number of pending deliveries to include. */
  readonly limit: number
}

/** One currently pending recipient delivery discovered from a channel WAL. */
export interface ChannelPendingEnvelopeDelivery {
  /** Accepted Envelope that remains unacknowledged for the requested recipient. */
  readonly envelope: TeamEnvelope
  /** Recipient treatment derived from the accepted Envelope and channel adapter. */
  readonly delivery: EnvelopeDelivery
}

/** Detached bounded page of currently pending deliveries for one channel recipient. */
export interface ChannelPendingDeliveryPage {
  /** Channel projection at the page's discovery point. */
  readonly channel: ChannelSnapshot
  /** Pending deliveries in ascending source Envelope sequence order. */
  readonly deliveries: readonly ChannelPendingEnvelopeDelivery[]
  /** Exclusive cursor for the next page; an exhausted page preserves the greater of its request cursor and `channel.cursor`. */
  readonly nextCursor: number
}

/** JSON-only scheduler request to expire one bounded set of due channel deliveries. */
export interface SchedulerChannelDeliveryExpireInput {
  /** Team that currently attaches the selected channel. */
  readonly teamId: TeamId
  /** Attached channel whose pending TTL deliveries are examined. */
  readonly channelId: ChannelId
  /** Team-journal cursor observed before this expiry batch. */
  readonly expectedTeamCursor: number
  /** Channel-WAL cursor observed before this expiry batch. */
  readonly expectedChannelCursor: number
  /** Scheduler clock observation used to evaluate Envelope TTLs. */
  readonly now: number
  /** Maximum expiry records to append in this exact batch. */
  readonly limit: number
}

/** Runtime-authorized scheduler expiry of one exact bounded pending-delivery batch. */
export interface SchedulerChannelDeliveryExpireRequest extends SchedulerChannelDeliveryExpireInput {
  /** Trusted scheduler channel authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemSchedulerChannelProof
}

/** Result of one durable pending-delivery expiry drive. */
export interface ChannelDeliveryExpireResult {
  /** Channel projection after the expiry records commit. */
  readonly channel: ChannelSnapshot
  /** Expiry records appended by this drive, in WAL order. */
  readonly expired: readonly ChannelDeliveryExpiredRecord[]
}

/** Explicit selection for one channel-wide extractive summary. */
export interface ChannelSummarySelectionInput {
  /** Channel selected by the caller. */
  readonly channelId: ChannelId
  /** Observed channel cursor; matching completed retries may retain an earlier cursor. */
  readonly expectedCursor: number
  /** Inclusive committed WAL range; every source Envelope must be channel-wide visible. */
  readonly coveredSequenceRange: { readonly from: number; readonly to: number }
  /** Channel-scoped identity for the exact selected range. */
  readonly idempotencyKey: ChannelSummaryIdempotencyKey
}

/** Authenticated source selection before extractive generation. */
export interface ChannelSummarySourceRequest extends ChannelSummarySelectionInput {
  /** Current coordinator activation or authenticated human proof. */
  readonly requester: TeamActorProof | TeamHumanActorProof
}

/** Bounded source facts or an already committed idempotent summary. */
export interface ChannelSummarySource {
  /** Current immutable channel identity and policy. */
  readonly channel: ChannelSnapshot
  /** Exact ordered source Envelope values, empty when a committed result is returned. */
  readonly envelopes: readonly TeamEnvelope[]
  /** Fingerprint of the ordered source values. */
  readonly sourceFingerprint: ChannelSummarySourceFingerprint
  /** Existing result for this exact channel/range/key, without regeneration. */
  readonly existing?: ChannelSummaryRecord
}

/** JSON-only request fields for one durable channel summary over a bounded source range. */
export interface ChannelSummarizeInput {
  /** Channel whose WAL is summarized. */
  readonly channelId: ChannelId
  /** Channel-WAL cursor observed before the summary append. */
  readonly expectedCursor: number
  /** Inclusive source channel-WAL range covered by the summary. */
  readonly coveredSequenceRange: { readonly from: number; readonly to: number }
  /** Exact source Envelope ids represented by the summary. */
  readonly sourceEnvelopeIds: readonly EnvelopeId[]
  /** Digest of the exact ordered source Envelope values read before generation. */
  readonly sourceFingerprint: ChannelSummarySourceFingerprint
  /** Exact summary text to retain. */
  readonly text: string
  /** Registered view policy that authorized the summary. */
  readonly policy: TeamViewPolicyRef
  /** Retry identity for this summary command. */
  readonly idempotencyKey: ChannelSummaryIdempotencyKey
}

/** Runtime-authorized durable channel summary append. */
export interface ChannelSummarizeRequest extends ChannelSummarizeInput {
  /** Trusted summary authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemChannelSummaryProof
  /** Current caller whose selection and visibility are revalidated before append. */
  readonly requester: TeamActorProof | TeamHumanActorProof
}

/** Channel WAL opening record. */
export interface ChannelOpenedRecord {
  /** Closed record discriminator. */
  readonly type: 'channel/opened'
  /** Monotonic sequence in the channel WAL. */
  readonly sequence: number
  /** Epoch milliseconds when this record was accepted. */
  readonly createdAt: number
  /** Complete immutable channel configuration. */
  readonly manifest: ChannelManifest
}

/** Channel WAL lifecycle transition. */
export interface ChannelPhaseRecord {
  /** Closed record discriminator. */
  readonly type: 'channel/phase'
  /** Monotonic sequence in the channel WAL. */
  readonly sequence: number
  /** Epoch milliseconds when this transition was accepted. */
  readonly createdAt: number
  /** Next durable channel lifecycle phase. */
  readonly phase: ChannelPhase
}

/** Channel WAL envelope record. */
export interface ChannelEnvelopeRecord {
  /** Exact accepted recipient intents; later invitation changes cannot alter their recipients. */
  readonly deliveryIntents: readonly DeliveryIntent[]
  /** Closed record discriminator. */
  readonly type: 'channel/envelope'
  /** Accepted Hub envelope. */
  readonly envelope: TeamEnvelope
  /** Sender-scoped retry key retained only for idempotent post lookup. */
  readonly idempotencyKey?: ChannelPostIdempotencyKey
}

/** Channel WAL receipt record. */
export interface ChannelReceiptRecord {
  /** Closed record discriminator. */
  readonly type: 'channel/receipt'
  /** Monotonic sequence in the channel WAL. */
  readonly sequence: number
  /** Epoch milliseconds when this receipt was accepted. */
  readonly createdAt: number
  /** Recipient that durably admitted the envelope. */
  readonly participantId: ParticipantId
  /** Accepted envelope identified by this receipt. */
  readonly envelopeId: EnvelopeId
  /** Highest acknowledged Envelope channel-WAL cursor for this recipient after this receipt. */
  readonly cursor: number
}

/** Channel WAL record that durably removes one expired pending delivery. */
export interface ChannelDeliveryExpiredRecord {
  /** Closed record discriminator. */
  readonly type: 'channel/delivery-expired'
  /** Monotonic sequence in the channel WAL. */
  readonly sequence: number
  /** Epoch milliseconds when expiry was recorded. */
  readonly createdAt: number
  /** Recipient whose pending delivery expired. */
  readonly participantId: ParticipantId
  /** Envelope whose delivery expired. */
  readonly envelopeId: EnvelopeId
  /** Source channel-WAL sequence occupied by the Envelope. */
  readonly envelopeSequence: number
  /** Durable closure reason when the delivery was abandoned before a TTL deadline. */
  readonly reason?: 'cancellation' | 'closure' | undefined
}

/** Durable channel summary record selected by a view policy. */
export interface ChannelSummaryRecord {
  /** Closed record discriminator. */
  readonly type: 'channel/summary'
  /** Monotonic sequence in the channel WAL. */
  readonly sequence: number
  /** Epoch milliseconds when this summary was accepted. */
  readonly createdAt: number
  /** Inclusive channel-WAL range represented by the summary. */
  readonly coveredSequenceRange: { readonly from: number; readonly to: number }
  /** Source Envelope identities in their original channel order. */
  readonly sourceEnvelopeIds: readonly EnvelopeId[]
  /** Digest checked against retained source content during commit and replay. */
  readonly sourceFingerprint: ChannelSummarySourceFingerprint
  /** Exact summary text retained for deterministic view projection. */
  readonly text: string
  /** View-policy identity that authorized this summary. */
  readonly policy: TeamViewPolicyRef
  /** Retry identity for this summary command. */
  readonly idempotencyKey: ChannelSummaryIdempotencyKey
}

/** Channel WAL adapter-owned record. */
export interface ChannelAdapterRecord {
  /** Closed record discriminator. */
  readonly type: 'channel/adapter'
  /** Monotonic sequence in the channel WAL. */
  readonly sequence: number
  /** Epoch milliseconds when this record was accepted. */
  readonly createdAt: number
  /** Adapter implementation that owns the payload. */
  readonly adapter: TeamAdapterRef
  /** Adapter-defined lossless JSON payload. */
  readonly payload: JsonObject
}

/** Channel WAL closing record. */
export interface ChannelClosedRecord {
  /** Closed record discriminator. */
  readonly type: 'channel/closed'
  /** Monotonic sequence in the channel WAL. */
  readonly sequence: number
  /** Epoch milliseconds when this record was accepted. */
  readonly createdAt: number
  /** Terminal channel phase. */
  readonly phase: 'closed' | 'expired' | 'failed'
  /** Optional provider or policy explanation. */
  readonly reason?: string
}

/** One closed channel WAL record. */
export type ChannelRecord =
  | ChannelInvitationRecord
  | ChannelOpenedRecord
  | ChannelPhaseRecord
  | ChannelEnvelopeRecord
  | ChannelReceiptRecord
  | ChannelDeliveryExpiredRecord
  | ChannelSummaryRecord
  | ChannelAdapterRecord
  | ChannelClosedRecord

/** Identified post-commit notification for one channel WAL record. */
export interface ChannelEvent {
  /** Channel WAL that accepted the record. */
  readonly channelId: ChannelId
  /** Parsed immutable durable record. */
  readonly record: ChannelRecord
}

/** Detached response to an incremental channel-WAL read. */
export interface ChannelReadResult {
  /** Channel state at the end of this read. */
  readonly channel: ChannelSnapshot
  /** Records committed after the request cursor, in durable order. */
  readonly records: readonly ChannelRecord[]
  /** Optional pure policy view for channels that freeze a view policy. */
  readonly view?: JsonObject | undefined
}

/** Request one bounded page of a channel WAL suffix. */
export interface ChannelReadPageRequest {
  /** Channel whose WAL is read. */
  readonly channelId: ChannelId
  /** Latest channel-WAL sequence already observed, or `-1` initially. */
  readonly afterCursor: number
  /** Maximum number of channel records to return. */
  readonly limit: number
}

/** One bounded page of a channel WAL suffix. */
export interface ChannelReadPageResult extends ChannelReadResult {
  /** Last returned WAL sequence when more records remain. */
  readonly nextCursor?: number | undefined
}

/** JSON-only request to compact an obsolete prefix of a terminal channel WAL. */
export interface TeamChannelCompactInput {
  /** Team that owns the channel. */
  readonly teamId: TeamId
  /** Terminal channel whose WAL prefix may be removed. */
  readonly channelId: ChannelId
  /** Channel-WAL cursor observed before requesting compaction. */
  readonly expectedCursor: number
  /** Highest channel-WAL sequence that may be removed. */
  readonly throughSequence: number
}

/** Runtime-authorized terminal channel-WAL compaction. */
export interface TeamChannelCompactRequest extends TeamChannelCompactInput {
  /** Trusted system maintenance authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemMaintenanceProof
}

/** Result of one checkpoint-gated terminal channel compaction. */
export interface TeamChannelCompactResult {
  /** Channel projection after the source WAL compaction. */
  readonly channel: ChannelSnapshot
  /** Highest source channel-WAL sequence removed. */
  readonly compactedThrough: number
  /** Highest audit-projection sequence removed, when the audit tail was shortened. */
  readonly auditCompactedThrough?: number | undefined
}

/** JSON-only request to compact an obsolete prefix of a terminal Team journal. */
export interface TeamJournalCompactInput {
  /** Team whose journal prefix may be removed. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before requesting compaction. */
  readonly expectedCursor: number
  /** Highest Team-journal sequence that may be removed. */
  readonly throughSequence: number
}

/** Runtime-authorized terminal Team-journal compaction. */
export interface TeamJournalCompactRequest extends TeamJournalCompactInput {
  /** Trusted system maintenance authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemMaintenanceProof
}

/** Result of one checkpoint-gated terminal Team-journal compaction. */
export interface TeamJournalCompactResult {
  /** Team projection after the source journal compaction. */
  readonly team: TeamStateSnapshot
  /** Highest source Team-journal sequence removed. */
  readonly compactedThrough: number
  /** Highest Team-audit sequence removed, when the audit tail was shortened. */
  readonly auditCompactedThrough?: number | undefined
}

/** JSON-only payload used to create a root Team before its identity exists. */
export interface TeamRootCreateInput {
  /** Seed for the Team's first durable objective revision. */
  readonly goal: TeamGoalSeed
  /** Complete provider-resolved governance and lifecycle rules. */
  readonly rules: JsonObject
  /** Complete provider-resolved resource budgets. */
  readonly budgets: JsonObject
  /** Optional authority grant; omitted requests receive the provider's explicit default grant. */
  readonly authorityGrant?: TeamAuthorityGrant | undefined
}

/** JSON-only payload used to create one nested Team; its authority is separate from root creation. */
export interface TeamChildCreateInput extends TeamRootCreateInput {
  /** Exact parent task delegation that reserved this child identity. */
  readonly delegationId: TeamDelegationId
  /** Direct Team from which this nested Team is created, supplied with {@link parentTaskId}. */
  readonly parentTeamId: TeamId
  /** Parent Team task that creates this nested Team, supplied with {@link parentTeamId}. */
  readonly parentTaskId: TeamTaskId
}

/** JSON-only root-or-child Team creation payload after runtime authority is omitted. */
export type TeamCreateInput = TeamRootCreateInput | TeamChildCreateInput

/** Runtime-authorized creation of one root Team. */
export interface TeamRootCreateRequest extends TeamRootCreateInput {
  /** Trusted system root-creation authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemRootCreationProof
}

/** Runtime-authorized creation of one nested Team. */
export interface TeamChildCreateRequest extends TeamChildCreateInput {
  /** Trusted child-delegation authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemChildCreationProof
}

/** Root and nested Team creation both require a source-owned runtime proof. */
export type TeamCreateRequest = TeamRootCreateRequest | TeamChildCreateRequest

/** Request for the complete detached state of one Team. */
export interface TeamGetRequest {
  /** Team to read. */
  readonly teamId: TeamId
}

/** Durable stream selected by a Team audit read. */
export type TeamAuditStream = 'team' | 'channel'

/** One read-only audit projection of an authoritative Team or channel record. */
export interface TeamAuditEntry {
  /** Team that owns the audited stream. */
  readonly teamId: TeamId
  /** Source stream kind. */
  readonly stream: TeamAuditStream
  /** Channel source when {@link stream} is `channel`. */
  readonly channelId?: ChannelId
  /** Monotonic cursor in the selected source stream. */
  readonly cursor: number
  /** Durable record discriminator. */
  readonly type: string
  /** Epoch milliseconds recorded by the source record. */
  readonly createdAt: number
  /** Record fields other than its discriminator and timestamp. */
  readonly facts: JsonObject
}

/** Read a bounded audit page from a Team journal or one attached channel WAL. */
export interface TeamAuditReadRequest {
  /** Team whose authoritative stream is read. */
  readonly teamId: TeamId
  /** Optional attached channel WAL; omission selects the Team journal. */
  readonly channelId?: ChannelId
  /** Last source cursor observed by the caller, or `-1` before the first page. */
  readonly afterCursor: number
  /** Maximum number of source records to project. */
  readonly limit: number
}

/** One bounded audit page and its source-specific continuation cursor. */
export interface TeamAuditReadResult {
  /** Team owning the selected source stream. */
  readonly teamId: TeamId
  /** Channel source when the page reads a channel WAL. */
  readonly channelId?: ChannelId
  /** First retained audit cursor after an optional prefix compaction. */
  readonly firstCursor?: number | undefined
  /** Ordered audit entries after the requested cursor. */
  readonly items: readonly TeamAuditEntry[]
  /** Last returned cursor when another page may exist. */
  readonly nextCursor?: number
}

/** JSON-only compare-and-set fields to hide one terminal Team from default listings. */
export interface TeamArchiveInput {
  /** Team whose durable archive marker is added. */
  readonly teamId: TeamId
  /** Team-journal cursor the caller read before requesting archival. */
  readonly expectedCursor: number
}

/** Runtime-authorized request to hide one terminal Team from default listings. */
export interface TeamArchiveRequest extends TeamArchiveInput {
  /** Trusted terminal archive authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemArchiveProof | TeamHumanActorProof
}

/** JSON-only Team cursor fence observed before an authenticated human resumes local ownership. */
export interface TeamResumeInput {
  /** Team whose coordinator recovery the caller requests. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before the authenticated resume request. */
  readonly expectedCursor: number
}

/** Runtime-authorized authenticated-human Team recovery request. */
export interface TeamHumanResumeRequest extends TeamResumeInput {
  /** Trusted active-human authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamHumanActorProof
}

/** Private nominal member that prevents structural construction of a human resume authorization. */
declare const teamHumanResumeAuthorizationBrand: unique symbol

/** Runtime-only authorization retained while one authenticated Team recovery prepares and publishes a coordinator. */
export interface TeamHumanResumeAuthorization {
  /** Opaque nominal member that prevents callers from fabricating recovery authorization. */
  readonly [teamHumanResumeAuthorizationBrand]: never
  /** Return whether the original authenticated human proof remains live for this recovery. */
  isLive(): boolean
  /** Revalidate the live human proof and current recoverable Team relation before a recovery side effect. */
  assert(): Promise<TeamStateSnapshot>
  /** Invalidate this authorization after the owning recovery operation settles. */
  close(): void
}

/** Common JSON-only and retry-safe fields for a Team closure command. */
export interface TeamClosureInput {
  /** Team whose admission is being closed. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before requesting closure. */
  readonly expectedCursor: number
  /** Retry identity for this closure operation. */
  readonly idempotencyKey: TeamClosureIdempotencyKey
  /** Structured closure reason retained in the Team journal. */
  readonly reason: TeamStallReason
}

/** JSON-only completion fields that select the accepted final result. */
export interface TeamCompleteInput extends TeamClosureInput {
  /** Channel retaining the final Envelope. */
  readonly finalChannelId: ChannelId
  /** Human-addressed final Envelope accepted in that channel. */
  readonly finalEnvelopeId: EnvelopeId
}

/** JSON-only failure fields; the runtime proof supplies the closer. */
export type TeamFailInput = TeamClosureInput

/** JSON-only cancellation fields; the runtime proof supplies the closer. */
export type TeamCancelInput = TeamClosureInput

/** Runtime-authorized Team closure command. */
export interface TeamClosureRequest extends TeamClosureInput {
  /** Trusted activation or system closure authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamClosureAuthority
}

/** Typed completion command requiring a durable human-addressed final receipt. */
export interface TeamCompleteRequest extends TeamCompleteInput {
  /** Trusted activation or system closure authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamClosureAuthority
}

/** Typed failure command for an infrastructure or model failure. */
export interface TeamFailRequest extends TeamFailInput {
  /** Trusted activation or system closure authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamClosureAuthority
}

/** Typed cancellation command for a user or parent-requested stop. */
export interface TeamCancelRequest extends TeamCancelInput {
  /** Trusted activation or system closure authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamClosureAuthority
}

/** JSON-only cursor fence for one closure-driver recovery pass. */
export interface TeamClosureContinuationInput {
  /** Team whose already durable closure or cancellation is being continued. */
  readonly teamId: TeamId
  /** Team-journal cursor observed when the recovery proof was minted. */
  readonly expectedCursor: number
}

/** Runtime-authorized continuation of an already durable Team closure or cancellation. */
export interface TeamClosureContinuationRequest extends TeamClosureContinuationInput {
  /** Trusted source-owned recovery proof; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemClosureDriverProof
}

/** JSON-only compare-and-set Team lifecycle transition. */
export interface TeamPhaseTransitionInput {
  /** Team whose lifecycle changes. */
  readonly teamId: TeamId
  /** Team-journal cursor the caller read before requesting this transition. */
  readonly expectedCursor: number
  /** Next durable Team lifecycle phase. */
  readonly phase: TeamPhase
  /** Required exactly when the next lifecycle phase is `stalled`. */
  readonly reason?: TeamStallReason | undefined
}

/** Runtime-authorized Team lifecycle transition. */
export interface TeamPhaseTransitionRequest extends TeamPhaseTransitionInput {
  /** Trusted system phase authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemPhaseProof
}

/** JSON-only compare-and-set Team objective definition update. */
export interface TeamGoalUpdateInput {
  /** Team whose objective definition changes. */
  readonly teamId: TeamId
  /** Goal revision the caller observed before this update. */
  readonly expectedRevision: number
  /** Replacement human-requested completion objective, when it changes. */
  readonly objective?: string
  /** Replacement goal-specific resource limits, when they change. */
  readonly budgets?: JsonObject
}

/** JSON-only compare-and-set Team objective lifecycle transition. */
export interface TeamGoalPhaseTransitionInput {
  /** Team whose objective lifecycle changes. */
  readonly teamId: TeamId
  /** Goal revision the caller observed before this transition. */
  readonly expectedRevision: number
  /** Next durable objective lifecycle phase. */
  readonly phase: TeamGoalPhase
  /** Required exactly when the next phase is `blocked`. */
  readonly blocker?: TeamGoalBlocker
}

/** Runtime-authorized Team objective definition update. */
export interface TeamGoalUpdateRequest extends TeamGoalUpdateInput {
  /** Trusted current activation or authenticated-human authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamActorProof | TeamHumanActorProof
}

/** Runtime-authorized Team objective lifecycle transition. */
export interface TeamGoalPhaseTransitionRequest extends TeamGoalPhaseTransitionInput {
  /** Trusted current activation or authenticated-human authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamActorProof | TeamHumanActorProof
}

/** Wait for a Team-journal cursor to advance without a registration gap. */
export interface TeamWatchRequest {
  /** Team whose journal is observed. */
  readonly teamId: TeamId
  /** Latest Team-journal cursor already observed by the caller, or `-1` before its first read. */
  readonly afterCursor: number
  /** Optional local cancellation for this wait; providers omit it before parsing JSON-only request fields. */
  readonly signal?: AbortSignal
}

/** Result of waiting for one Team-journal cursor. */
export type TeamWatchResult =
  | { readonly kind: 'changed'; readonly cursor: number }
  | { readonly kind: 'closed' }

/** JSON-only request that admits one complete declarative workflow plan in `compiling`. */
export interface TeamWorkflowPlanAdmissionInput {
  /** Team that owns the workflow plan. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before admission. */
  readonly expectedCursor: number
  /** Retry identity for this exact plan input. */
  readonly idempotencyKey: TeamWorkflowPlanIdempotencyKey
  /** Complete JSON-serializable plan to validate and retain. */
  readonly plan: TeamWorkflowPlan
}

/** Runtime-authorized admission of one coordinator-authored workflow plan. */
export interface TeamWorkflowPlanAdmissionRequest extends TeamWorkflowPlanAdmissionInput {
  /** Trusted current coordinator authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamActorProof
}

/** JSON-only request that binds one compiled plan template to one durable Team task. */
export interface TeamWorkflowPlanTaskBindInput {
  /** Team that owns the plan and task. */
  readonly teamId: TeamId
  /** Workflow plan being compiled. */
  readonly planId: TeamWorkflowPlanId
  /** Team-journal cursor observed before this binding. */
  readonly expectedCursor: number
  /** Plan revision observed before this binding. */
  readonly expectedRevision: number
  /** Plan-local template label. */
  readonly templateId: TeamWorkflowTaskTemplateId
  /** Durable Team task created for the template. */
  readonly taskId: TeamTaskId
}

/** Runtime-authorized TeamRun binding of one coordinator-created task to a workflow plan. */
export interface TeamWorkflowPlanTaskBindRequest extends TeamWorkflowPlanTaskBindInput {
  /** Trusted TeamRun workflow compiler authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemWorkflowProof
}

/** JSON-only request that binds one compiled plan to its durable workflow channel. */
export interface TeamWorkflowPlanChannelBindInput {
  /** Team that owns the plan and channel. */
  readonly teamId: TeamId
  /** Workflow plan being compiled. */
  readonly planId: TeamWorkflowPlanId
  /** Team-journal cursor observed before this binding. */
  readonly expectedCursor: number
  /** Plan revision observed before this binding. */
  readonly expectedRevision: number
  /** Durable channel opened for this plan. */
  readonly channelId: ChannelId
}

/** Runtime-authorized TeamRun binding of one newly opened workflow channel to its plan. */
export interface TeamWorkflowPlanChannelBindRequest extends TeamWorkflowPlanChannelBindInput {
  /** Trusted TeamRun workflow compiler authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemWorkflowProof
}

/** JSON-only request that advances a compiled workflow plan or retains its terminal facts. */
export interface TeamWorkflowPlanPhaseInput {
  /** Team that owns the plan. */
  readonly teamId: TeamId
  /** Workflow plan whose phase changes. */
  readonly planId: TeamWorkflowPlanId
  /** Team-journal cursor observed before the phase transition. */
  readonly expectedCursor: number
  /** Plan revision observed before the phase transition. */
  readonly expectedRevision: number
  /** Next ready or terminal plan phase. */
  readonly phase: Exclude<TeamWorkflowPlanPhase, 'compiling'>
  /** Required result projection when phase is `completed`. */
  readonly result?: TeamWorkflowPlanResult | undefined
  /** Required failure explanation when phase is `failed`. */
  readonly failure?: TeamStallReason | undefined
  /** Optional cancellation explanation retained when phase is `cancelled`. */
  readonly cancellation?: TeamStallReason | undefined
}

/** Runtime-authorized TeamRun ready or terminal workflow-plan transition. */
export interface TeamWorkflowPlanPhaseRequest extends TeamWorkflowPlanPhaseInput {
  /** Trusted TeamRun workflow compiler authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemWorkflowProof
}

/** Request for one durable workflow plan projection. */
export interface TeamWorkflowPlanGetRequest {
  /** Team that owns the plan. */
  readonly teamId: TeamId
  /** Workflow plan to read. */
  readonly planId: TeamWorkflowPlanId
}

/** Request one bounded page of workflow plans in durable admission order. */
export interface TeamWorkflowPlanListPageRequest {
  /** Team whose workflow plans are read. */
  readonly teamId: TeamId
  /** Exclusive provider-order ordinal from a prior page, or `-1` initially. */
  readonly afterCursor: number
  /** Maximum number of workflow-plan projections to return. */
  readonly limit: number
}

/** One bounded page of workflow-plan projections. */
export interface TeamWorkflowPlanListPage {
  /** Workflow plans in durable admission order. */
  readonly items: readonly TeamWorkflowPlanSnapshot[]
  /** Provider-order ordinal for the next page when more plans remain. */
  readonly nextCursor?: number | undefined
}

/** JSON-only fields accepted when a provider invites a participant and mints its identity. */
export interface ParticipantInviteInput {
  /** Team receiving the participant. */
  readonly teamId: TeamId
  /** Team-journal cursor the caller read before this invitation. */
  readonly expectedCursor: number
  /** Logical participant implementation category. */
  readonly kind: ParticipantKind
  /** Human-facing participant name. */
  readonly displayName: string
  /** Template- or policy-defined responsibility label. */
  readonly role: string
  /** Immutable capabilities declared for scheduler eligibility. */
  readonly capabilities: readonly string[]
  /** Closed immutable human owner required when this invitation creates a human participant. */
  readonly owner?: TeamParticipantOwner | undefined
  readonly provider?: string | undefined
  readonly preset?: string | undefined
  readonly model?: string | undefined
  readonly authScheme?: string | undefined
  /** Optional authority subset; omitted requests inherit the Team grant. */
  readonly authorityGrant?: TeamAuthorityGrant | undefined
}

/** Runtime-authorized invitation of one Team participant. */
export interface ParticipantInviteRequest extends ParticipantInviteInput {
  /** Trusted TeamRun topology or authenticated-human authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemTopologyProof | TeamHumanActorProof
}

/** JSON-only compare-and-set durable participant-membership transition. */
export interface ParticipantPhaseTransitionInput {
  /** Team that owns the participant. */
  readonly teamId: TeamId
  /** Participant whose membership lifecycle changes. */
  readonly participantId: ParticipantId
  /** Team-journal cursor the caller read before requesting this transition. */
  readonly expectedCursor: number
  /** Next durable participant-membership phase. */
  readonly phase: ParticipantPhase
}

/** Runtime-authorized durable participant-membership transition. */
export interface ParticipantPhaseTransitionRequest extends ParticipantPhaseTransitionInput {
  /** Trusted TeamRun topology or authenticated-human authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemTopologyProof | TeamHumanActorProof
}

/** JSON-only compare-and-set request to persist one newly published activation binding. */
export interface ActivationBindInput {
  /** Team-journal cursor the caller read before binding this activation. */
  readonly expectedCursor: number
  /** Published activation, Session, and placement-provider identity. */
  readonly binding: ActivationBindingSnapshot
}

/** JSON-only compare-and-set request to persist one activation residency-status transition. */
export interface ActivationStatusUpdateInput {
  /** Team that owns the activation epoch. */
  readonly teamId: TeamId
  /** Activation epoch whose status changes. */
  readonly activationId: ActivationId
  /** Team-journal cursor the caller read before updating this status. */
  readonly expectedCursor: number
  /** Next permitted residency status for this activation epoch. */
  readonly status: ActivationStatus
}

/** JSON-only exact stale activation relation selected for an externally fenced epoch. */
export interface ActivationFenceInput {
  /** Team that owns the activation and affected task leases. */
  readonly teamId: TeamId
  /** Activation epoch confirmed stopped by the external fencer. */
  readonly activationId: ActivationId
  /** Participant that owns the fenced activation. */
  readonly participantId: ParticipantId
  /** Session bound to the fenced activation. */
  readonly sessionId: SessionId
  /** AgentRuntime provider that published the fenced activation. */
  readonly provider: string
  /** Team-journal cursor observed after external fencing completed. */
  readonly expectedCursor: number
}

/** JSON-only exact activation relation whose owner reports locally settled resources. */
export type ActivationQuiesceInput = ActivationFenceInput

/** Runtime-authorized publication of one activation binding. */
export interface ActivationBindRequest extends ActivationBindInput {
  /** Trusted system activation authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemActivationProof
}

/** Runtime-authorized activation residency-status transition. */
export interface ActivationStatusUpdateRequest extends ActivationStatusUpdateInput {
  /** Trusted system activation authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemActivationProof
}

/** Runtime-authorized externally fenced activation lease release. */
export interface ActivationFenceRequest extends ActivationFenceInput {
  /** Trusted system activation authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemActivationProof
}

/** Runtime-authorized locally quiesced activation lease release. */
export interface ActivationQuiesceRequest extends ActivationQuiesceInput {
  /** Trusted system activation authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemActivationProof
}

/** Request for one durable activation binding. */
export interface ActivationGetRequest {
  /** Team that owns the activation epoch. */
  readonly teamId: TeamId
  /** Activation epoch to read. */
  readonly activationId: ActivationId
}

/** JSON-only request for one TeamRun- or authenticated-human-owned soft interrupt. */
export interface ParticipantInterruptRequestInput {
  /** Team selected by the current TeamRun's interrupt source. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before a new request is committed. */
  readonly expectedCursor: number
  /** Explicit target required only for an authenticated-human interrupt. */
  readonly participantId?: ParticipantId | undefined
}

/** Runtime-authorized TeamRun or authenticated-human soft-interrupt request. */
export interface ParticipantInterruptRequest extends ParticipantInterruptRequestInput {
  /** Trusted TeamRun interrupt or authenticated-human authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemInterruptProof | TeamHumanActorProof
}

/** JSON-only request for soft interrupts pending at the current Link target. */
export interface ParticipantInterruptListPendingInput {}

/** Runtime-authorized soft-interrupt discovery for one current activation target. */
export interface ParticipantInterruptListPendingRequest extends ParticipantInterruptListPendingInput {
  /** Trusted target activation authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamActorProof
}

/** JSON-only acknowledgement of one delivered soft interrupt. */
export interface ParticipantInterruptAcknowledgeInput {
  /** Interrupt identity returned by the pending-interrupt read. */
  readonly interruptId: TeamInterruptId
}

/** Runtime-authorized soft-interrupt acknowledgement from one current Link target. */
export interface ParticipantInterruptAcknowledgeRequest extends ParticipantInterruptAcknowledgeInput {
  /** Trusted target activation authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamActorProof
}

/** JSON-only fields accepted when a coordinator or authenticated human creates a task. */
export interface TeamTaskCreateInput {
  /** Team that owns the new task. */
  readonly teamId: TeamId
  /** Team-journal cursor the caller read before creating this task. */
  readonly expectedCursor: number
  /** Retry identity for the task-creation command. */
  readonly createCommand: TeamTaskCreateCommandInput
  /** Executor request; the owning creation resolver explicitly selects Participant execution when omitted. */
  readonly execution?: TeamTaskExecution | undefined
  /** Optional narrowing of eligible participant identities, roles and execution routes. */
  readonly placement?: TeamTaskPlacement | undefined
  /** Parent task that creates this unit of work, when task ancestry exists. */
  readonly parentTaskId?: TeamTaskId
  /** Declarative workflow plan that authorizes this task, when compiled from a plan. */
  readonly workflowPlanId?: TeamWorkflowPlanId | undefined
  /** Plan-local template that authorizes this task, when compiled from a plan. */
  readonly workflowTemplateId?: TeamWorkflowTaskTemplateId | undefined
  /** Short human-readable task subject. */
  readonly subject: string
  /** Complete durable task instructions. */
  readonly description: string
  /** Optional explicit workspace integration task specification. */
  readonly integration?: TeamTaskIntegrationSpec | undefined
  /** Existing tasks that must complete before this task may run. */
  readonly blockedBy: readonly TeamTaskId[]
  /** Capabilities the assigned participant must declare. */
  readonly requiredCapabilities: readonly string[]
  /** Scheduler-defined priority retained without interpretation by this definition. */
  readonly priority: number
  /** Declared filesystem regions this task may read. */
  readonly readScopes: readonly string[]
  /** Declared filesystem regions this task may modify. */
  readonly writeScopes: readonly string[]
  /** Execution-world requirement selected for this task. */
  readonly workspaceMode: TeamTaskWorkspaceMode
  /** Provider-defined budget facts frozen with the task. */
  readonly budget: JsonObject
  /** Frozen review route selected for the task. */
  readonly reviewPolicy: TeamTaskReviewPolicy
  /** Maximum bounded attempt history and active attempts permitted for this task. */
  readonly maxAttempts: number
}

/** Runtime-authorized coordinator or authenticated-human task creation. */
export interface TeamTaskCreateRequest extends TeamTaskCreateInput {
  /** Trusted current coordinator or human authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamActorProof | TeamHumanActorProof
}

/** Request for one detached Team task projection. */
export interface TeamTaskGetRequest {
  /** Team that owns the task. */
  readonly teamId: TeamId
  /** Task to read. */
  readonly taskId: TeamTaskId
}

/** Request one bounded page of a Team's task projections. */
export interface TeamTaskListPageRequest {
  /** Team whose task graph is read. */
  readonly teamId: TeamId
  /** Exclusive provider-order ordinal from a prior page, or `-1` initially. */
  readonly afterCursor: number
  /** Maximum number of task projections to return. */
  readonly limit: number
}

/** One bounded page of a Team's task projections. */
export interface TeamTaskListPage {
  /** Task projections, including tombstones, in first durable-record order. */
  readonly items: readonly TeamTaskSnapshot[]
  /** Provider-order ordinal for the next page when more tasks remain. */
  readonly nextCursor?: number | undefined
}

/** JSON-only narrow compare-and-set edit of a lease-free task's instructions and dependency graph. */
export interface TeamTaskDetailsUpdateInput {
  /** Team that owns the task. */
  readonly teamId: TeamId
  /** Task whose details change. */
  readonly taskId: TeamTaskId
  /** Task revision the caller read before changing task details. */
  readonly expectedRevision: number
  /** Replacement short human-readable task subject, when changed. */
  readonly subject?: string
  /** Replacement complete durable task instructions, when changed. */
  readonly description?: string
  /** Replacement task dependencies, when changed. */
  readonly blockedBy?: readonly TeamTaskId[]
}

/** Runtime-authorized current-coordinator or authenticated-human task details edit. */
export interface TeamTaskDetailsUpdateRequest extends TeamTaskDetailsUpdateInput {
  /** Trusted current coordinator or human authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamActorProof | TeamHumanActorProof
}

/** JSON-only compare-and-set of a pending task's advisory owner proposal. */
export interface TeamTaskOwnerProposalInput {
  /** Team that owns the task. */
  readonly teamId: TeamId
  /** Pending task whose scheduler hint changes. */
  readonly taskId: TeamTaskId
  /** Task revision the caller read before changing the proposal. */
  readonly expectedRevision: number
  /** Preferred Participant, or omitted to clear the proposal. */
  readonly proposedOwnerId?: ParticipantId | undefined
}

/** Runtime-authorized TeamRun advisory owner proposal for one default-worker task. */
export interface TeamTaskOwnerProposalRequest extends TeamTaskOwnerProposalInput {
  /** Trusted TeamRun task-control authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemTaskControlProof
}

/** JSON-only compare-and-set request to replace one lease-free non-review task with its deleted tombstone. */
export interface TeamTaskDeleteInput {
  /** Team that owns the task. */
  readonly teamId: TeamId
  /** Lease-free task that is not awaiting review and that the provider may tombstone. */
  readonly taskId: TeamTaskId
  /** Task revision the caller read before requesting deletion. */
  readonly expectedRevision: number
}

/** Runtime-authorized current-coordinator or authenticated-human task tombstone request. */
export interface TeamTaskDeleteRequest extends TeamTaskDeleteInput {
  /** Trusted current coordinator or human authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamActorProof | TeamHumanActorProof
}

/** JSON-only compare-and-set request to stop one task without closing its Team. */
export interface TeamTaskCancelInput {
  /** Team that owns the task. */
  readonly teamId: TeamId
  /** Task whose current work the provider must stop. */
  readonly taskId: TeamTaskId
  /** Task revision the caller read before requesting cancellation. */
  readonly expectedRevision: number
  /** Optional explanation retained with the first accepted intent. */
  readonly reason?: string | undefined
}

/** Runtime-authorized TeamRun or authenticated-human cancellation of one default-worker task. */
export interface TeamTaskCancelRequest extends TeamTaskCancelInput {
  /** Trusted TeamRun task-control or authenticated-human authority for one current default-worker task. */
  readonly actor: TeamSystemTaskControlProof | TeamHumanActorProof
}

/** JSON-only recovery of one accepted lease-free cancellation after a channel-WAL interruption. */
export interface TeamTaskCancellationReconcileInput {
  /** Team that retained the stop intent. */
  readonly teamId: TeamId
  /** Task whose exact accepted stop is being continued. */
  readonly taskId: TeamTaskId
  /** Current task revision selected for cleanup. */
  readonly expectedRevision: number
  /** Original task revision frozen by the cancellation intent. */
  readonly requestedRevision: number
}

/** Runtime-authorized continuation that cannot create a new task cancellation intent. */
export interface TeamTaskCancellationReconcileRequest extends TeamTaskCancellationReconcileInput {
  /** Trusted scheduler authority for this exact retained cancellation. */
  readonly actor: TeamSystemTaskLeaseProof
}

/** JSON-only post-release cancellation cleanup of one pending Team task. */
export interface TeamCancellationTaskCancelInput {
  /** Team whose durable cancellation owns this cleanup. */
  readonly teamId: TeamId
  /** Durable cancellation retry identity accepted by the Hub. */
  readonly cancellationIdempotencyKey: TeamClosureIdempotencyKey
  /** Durable cancellation timestamp accepted by the Hub. */
  readonly cancellationRequestedAt: number
  /** Team cursor observed before the cleanup mutation. */
  readonly expectedTeamCursor: number
  /** Pending task selected for cancellation cleanup. */
  readonly taskId: TeamTaskId
  /** Task revision observed before cancellation. */
  readonly expectedRevision: number
}

/** Runtime-authorized TeamRun post-release cancellation of one pending task. */
export interface TeamCancellationTaskCancelRequest extends TeamCancellationTaskCancelInput {
  /** Trusted TeamRun cancellation-cleanup authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemCancellationCleanupProof
}

/** JSON-only compare-and-set resolution of an unleased review task. */
export interface TeamTaskReviewResolveInput {
  /** Review task to resolve. */
  readonly taskId: TeamTaskId
  /** Task revision the reviewing participant read before resolving it. */
  readonly expectedRevision: number
  /** Accepted review completion or explicit rework return to pending. */
  readonly nextPhase: 'completed' | 'pending'
  /** Nonempty explanation retained in the durable review decision. */
  readonly reason: string
}

/** Runtime-only activation- or authenticated-human-authorized review resolution. */
export interface TeamTaskReviewResolveRequest extends TeamTaskReviewResolveInput {
  /** Trusted reviewer activation or human authority; it never crosses a wire or durable boundary. */
  readonly actor: TeamActorProof | TeamHumanActorProof
}

/** Runtime-only scheduler recovery of one durable consult review response. */
export interface TeamTaskReviewRecoverRequest {
  /** Trusted system authority; it never crosses a wire or durable boundary. */
  readonly actor: TeamSystemTaskReviewProof
}

/** Optional agent residency proof carried with a task lease and its owner operations. */
type TaskAttemptActivationSelection =
  | {
    /** Current agent residency epoch for the selected or lease-owning participant. */
    readonly activationId: ActivationId
  }
  | {
    /** No residency epoch is present because the participant is human or service-owned. */
    readonly activationId?: undefined
  }

/** JSON-only fields for one scheduler-selected task assignment. */
export type TeamTaskAssignInput = TaskAttemptActivationSelection & {
  /** Team that owns the task. */
  readonly teamId: TeamId
  /** Pending task to assign. */
  readonly taskId: TeamTaskId
  /** Task revision the scheduler read before assigning an attempt. */
  readonly expectedRevision: number
  /** Participant selected to own the new attempt. */
  readonly participantId: ParticipantId
  /** Attached Team channel selected to durably wake this lease owner, when task delivery is configured. */
  readonly wakeChannelId?: ChannelId
  /** Fixed duration that the provider records on the new lease. */
  readonly leaseDurationMs: number
}

/** Runtime-authorized scheduler task assignment. */
export type TeamTaskAssignRequest = TeamTaskAssignInput & {
  /** Trusted scheduler task-lease authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemTaskLeaseProof
}

/** Revision and attempt fence shared by every post-assignment task operation. */
export interface TeamTaskAttemptFence {
  /** Team that owns the task. */
  readonly teamId: TeamId
  /** Task carrying the active lease. */
  readonly taskId: TeamTaskId
  /** Exact task revision observed before this operation. */
  readonly expectedRevision: number
  /** Exact active attempt that this operation addresses. */
  readonly attemptId: TaskAttemptId
}

/** Attempt fence for operations that only the current lease holder may issue. */
export type TeamTaskAttemptOwnerFence = TeamTaskAttemptFence & TaskAttemptActivationSelection & {
  /** Participant that must match the current lease holder. */
  readonly participantId: ParticipantId
}

/** JSON-only fence for a transition from an assigned attempt to running execution. */
export interface TeamTaskAttemptStartInput {
  /** Task carrying the current assigned lease. */
  readonly taskId: TeamTaskId
  /** Exact current task revision observed before execution starts. */
  readonly expectedRevision: number
  /** Exact assigned attempt selected by the current activation proof. */
  readonly attemptId: TaskAttemptId
}

/** Runtime-authorized start of one activation-owned assigned attempt. */
export interface TeamTaskAttemptStartRequest extends TeamTaskAttemptStartInput {
  /** Trusted activation authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamActorProof
}

/** JSON-only fields that identify one durable assignment delivery to claim for task start. */
export interface TeamTaskAttemptStartClaimInput {
  /** Task carrying the assigned current lease. */
  readonly taskId: TeamTaskId
  /** Exact current attempt selected by the scheduler. */
  readonly attemptId: TaskAttemptId
  /** Task revision committed with the assignment and retained by the current lease. */
  readonly assignedRevision: number
  /** Current lease's durable assignment channel. */
  readonly channelId: ChannelId
  /** Accepted task-assignment Envelope delivered to the claimant. */
  readonly envelopeId: EnvelopeId
}

/** Runtime-only claim that starts the exact assignment delivered through its durable Team channel. */
export interface TeamTaskAttemptStartClaimRequest extends TeamTaskAttemptStartClaimInput {
  /** Trusted activation authority; it never crosses a wire or durable boundary. */
  readonly actor: TeamActorProof
}

/** JSON-only fields that select the current task attempt whose fixed lease is renewed. */
export interface TeamTaskAttemptHeartbeatInput {
  /** Task carrying the current lease. */
  readonly taskId: TeamTaskId
  /** Exact active attempt whose lease is renewed. */
  readonly attemptId: TaskAttemptId
  /** Exact task revision observed before requesting the renewal. */
  readonly expectedRevision: number
}

/** Runtime-only request to renew one current task attempt through a trusted activation proof. */
export interface TeamTaskAttemptHeartbeatRequest extends TeamTaskAttemptHeartbeatInput {
  /** Trusted activation authority; it never crosses a wire or durable boundary. */
  readonly actor: TeamActorProof
}

/** JSON-only fields that select and settle the current task attempt. */
export interface TeamTaskAttemptSettleInput {
  /** Task carrying the current lease. */
  readonly taskId: TeamTaskId
  /** Exact active attempt that is settled. */
  readonly attemptId: TaskAttemptId
  /** Exact task revision observed before requesting settlement. */
  readonly expectedRevision: number
  /** Owner-reported terminal fact; lease expiry belongs exclusively to `expireTaskAttempt()`. */
  readonly outcome:
    | { readonly kind: 'released' }
    | { readonly kind: 'failed'; readonly failure: TaskAttemptFailure }
    | { readonly kind: 'completed'; readonly result: TaskAttemptResult }
    | { readonly kind: 'cancelled' }
}

/** Runtime-only request to settle one current task attempt through a trusted activation proof. */
export interface TeamTaskAttemptSettleRequest extends TeamTaskAttemptSettleInput {
  /** Trusted activation authority; it never crosses a wire or durable boundary. */
  readonly actor: TeamActorProof
}

/** JSON-only fence for one scheduler-selected elapsed task lease. */
export interface TeamTaskAttemptExpireInput extends TeamTaskAttemptFence {}

/** Runtime-authorized scheduler expiry of one elapsed task lease. */
export interface TeamTaskAttemptExpireRequest extends TeamTaskAttemptExpireInput {
  /** Trusted scheduler task-lease authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemTaskLeaseProof
}

/** JSON-only metadata selected by a live workspace provider for one exact allocation. */
export interface TeamWorkspaceAllocationBindingInput {
  /** Provider-minted allocation identity. */
  readonly id: TeamWorkspaceAllocationId
  /** Registered provider identity that owns the live allocation resource. */
  readonly provider: string
  /** Immutable task mode selected by the provider. */
  readonly mode: TeamTaskWorkspaceMode
  /** Assignment revision selected by the provider before task execution started. */
  readonly assignedRevision: number
  /** Participant that owns the exact current task lease. */
  readonly participantId: ParticipantId
  /** Activation epoch that owns the exact current task lease. */
  readonly activationId: ActivationId
  /** Session durably bound to the selected activation. */
  readonly sessionId: SessionId
  /** Optional provider-owned opaque base version, such as a Git commit. */
  readonly baseVersion?: string | undefined
  /** Immutable provider execution world; roots and credentials are never persisted here. */
  readonly executionWorld?: TeamWorkspaceExecutionWorld | undefined
}

/** JSON-only request that reserves a provider allocation before materialization. */
export interface TeamWorkspaceAllocationReserveInput {
  /** Team that owns the selected task attempt. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before reserving the allocation. */
  readonly expectedCursor: number
  /** Running task selected by the allocation owner. */
  readonly taskId: TeamTaskId
  /** Current task revision observed before allocation reservation. */
  readonly expectedTaskRevision: number
  /** Exact running attempt selected by the allocation owner. */
  readonly attemptId: TaskAttemptId
  /** Provider-owned metadata that excludes the live filesystem root. */
  readonly allocation: TeamWorkspaceAllocationBindingInput
}

/** Runtime-authorized reservation of one source-owned provider allocation. */
export interface TeamWorkspaceAllocationReserveRequest extends TeamWorkspaceAllocationReserveInput {
  /** Trusted allocation-owner proof; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemWorkspaceAllocationProof
}

/** JSON-only common fence for one already bound allocation lifecycle transition. */
export interface TeamWorkspaceAllocationLifecycleInput {
  /** Team that owns the selected allocation. */
  readonly teamId: TeamId
  /** Team-journal cursor observed before this lifecycle transition. */
  readonly expectedCursor: number
  /** Provider-minted allocation identity. */
  readonly allocationId: TeamWorkspaceAllocationId
  /** Allocation revision observed before this lifecycle transition. */
  readonly expectedRevision: number
}

/** JSON-only activation after a provider materializes or restores an allocation. */
export interface TeamWorkspaceAllocationActivateInput extends TeamWorkspaceAllocationLifecycleInput {}

/** Runtime-authorized activation after provider materialization or restore. */
export interface TeamWorkspaceAllocationActivateRequest extends TeamWorkspaceAllocationActivateInput {
  /** Trusted allocation-owner proof; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemWorkspaceAllocationProof
}

/** JSON-only release intent accepted before provider cleanup starts. */
export interface TeamWorkspaceAllocationReleaseRequestInput extends TeamWorkspaceAllocationLifecycleInput {}

/** Runtime-authorized release intent before provider cleanup starts. */
export interface TeamWorkspaceAllocationReleaseRequest extends TeamWorkspaceAllocationReleaseRequestInput {
  /** Trusted allocation-owner proof; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemWorkspaceAllocationProof
}

/** JSON-only transition that retains an unreleased provider allocation for recovery. */
export interface TeamWorkspaceAllocationPreserveInput extends TeamWorkspaceAllocationLifecycleInput {
  /** Structured explanation for retaining the provider resource. */
  readonly reason: TeamStallReason
}

/** Runtime-authorized preservation of one source-owned provider allocation. */
export interface TeamWorkspaceAllocationPreserveRequest extends TeamWorkspaceAllocationPreserveInput {
  /** Trusted allocation-owner proof; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemWorkspaceAllocationProof
}

/** JSON-only exact allocation loss and artifacts retained before the world disappeared. */
export interface TeamWorkspaceAllocationLossInput extends TeamWorkspaceAllocationLifecycleInput {
  readonly loss: TeamWorkspaceLoss
}

/** Runtime-authorized provider loss observation for one durable allocation. */
export interface TeamWorkspaceAllocationLossRequest extends TeamWorkspaceAllocationLossInput {
  readonly actor: TeamSystemWorkspaceAllocationProof
}

/** JSON-only transition that records successful provider release. */
export interface TeamWorkspaceAllocationReleaseInput extends TeamWorkspaceAllocationLifecycleInput {}

/** Runtime-authorized confirmation of one successful provider allocation release. */
export interface TeamWorkspaceAllocationReleaseConfirmRequest extends TeamWorkspaceAllocationReleaseInput {
  /** Trusted allocation-owner proof; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemWorkspaceAllocationProof
}

/** JSON-only fields accepted when a provider opens a channel and mints its identity. */
export interface ChannelOpenInput {
  /** Explicit required/optional choices; omitted members resolve to required invitations. */
  readonly invitations?: readonly ChannelInvitationOptions[] | undefined
  /** Team that owns the new channel. */
  readonly teamId: TeamId
  /** Team-journal cursor the caller read before opening this channel. */
  readonly expectedCursor: number
  /** Exact registered adapter identity frozen into the channel manifest. */
  readonly adapter: TeamAdapterRef
  /** Optional exact view policy identity frozen in the channel manifest. */
  readonly viewPolicy?: TeamViewPolicyRef | undefined
  /** Optional declarative workflow plan used for retry-safe channel admission. */
  readonly workflowPlanId?: TeamWorkflowPlanId | undefined
  /** Compiling workflow-plan revision observed before a workflow channel opens. */
  readonly expectedPlanRevision?: number | undefined
  /** Frozen participant membership and adapter-defined roles. */
  readonly participants: readonly ChannelParticipant[]
  /** Adapter-defined limits captured in the channel manifest. */
  readonly limits: JsonObject
}

/** Runtime-authorized generic, authenticated-human, TeamRun bootstrap, or TeamRun workflow channel opening. */
export type ChannelOpenRequest = ChannelOpenInput & (
  | {
    /** Generic channels are not owned by a workflow compiler. */
    readonly workflowPlanId?: undefined
    readonly expectedPlanRevision?: undefined
    /** Trusted generic lifecycle authority; it never crosses a durable or wire boundary. */
    readonly actor: TeamSystemChannelLifecycleProof
    /** Runtime-only dispatch marker; the canonical source still validates the opaque proof. */
    readonly authorityKind: 'channel-lifecycle'
  }
  | {
    /** Authenticated-human channels are not owned by a workflow compiler. */
    readonly workflowPlanId?: undefined
    readonly expectedPlanRevision?: undefined
    /** Trusted authenticated-human authority; it never crosses a durable or wire boundary. */
    readonly actor: TeamHumanActorProof
    /** Runtime-only dispatch marker for the authenticated-human route. */
    readonly authorityKind: 'human'
  }
  | {
    /** Bootstrap channels are not owned by a workflow compiler. */
    readonly workflowPlanId?: undefined
    readonly expectedPlanRevision?: undefined
    /** Trusted TeamRun topology authority; it never crosses a durable or wire boundary. */
    readonly actor: TeamSystemTopologyProof
    /** Topology authority remains the default non-workflow route. */
    readonly authorityKind?: undefined
  }
  | {
    /** Compiling workflow plan selected by the TeamRun proof. */
    readonly workflowPlanId: TeamWorkflowPlanId
    /** Exact compiling plan revision selected by the TeamRun proof. */
    readonly expectedPlanRevision: number
    /** Trusted TeamRun workflow compiler authority; it never crosses a durable or wire boundary. */
    readonly actor: TeamSystemWorkflowProof
    /** Workflow fields select this route without a generic lifecycle marker. */
    readonly authorityKind?: undefined
  }
)

/** Request for one detached channel projection. */
export interface ChannelGetRequest {
  /** Channel to read. */
  readonly channelId: ChannelId
}

/** Runtime-only member-authorized read of immutable channel metadata. */
export interface ChannelActorGetRequest extends ChannelGetRequest {
  /** Current activation proof; Team and participant identities are derived by the provider. */
  readonly actor: TeamActorProof
}

/** Request for the suffix of one channel WAL. */
export interface ChannelReadRequest {
  /** Channel whose WAL is read. */
  readonly channelId: ChannelId
  /** Latest channel-WAL sequence already observed by the caller, or `-1` before its first read. */
  readonly afterCursor: number
}

/** JSON-only fields that select one active channel for compare-and-set closure. */
export interface ChannelCloseInput {
  /** Channel to close. */
  readonly channelId: ChannelId
  /** Channel-WAL cursor the caller read before closing this channel. */
  readonly expectedCursor: number
  /** Optional human-readable closure reason. */
  readonly reason?: string
}
/** Runtime-authorized generic or authenticated-human channel closure. */
export interface ChannelCloseRequest extends ChannelCloseInput {
  /** Trusted generic lifecycle or authenticated-human authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemChannelLifecycleProof | TeamHumanActorProof
}

/** JSON-only scheduler request to open one consult channel for a participant-review task. */
export interface SchedulerReviewChannelOpenInput {
  /** Team that owns the review task. */
  readonly teamId: TeamId
  /** Team cursor observed before channel admission. */
  readonly expectedTeamCursor: number
  /** Participant-review task whose completed attempt needs a consult request. */
  readonly taskId: TeamTaskId
  /** Exact review revision retained by the task. */
  readonly expectedRevision: number
  /** Completed task attempt whose result is routed for review. */
  readonly attemptId: TaskAttemptId
  /** Completed attempt owner who receives the consult response. */
  readonly initiatorId: ParticipantId
  /** Active participant-review owner who receives the consult request. */
  readonly reviewerId: ParticipantId
  /** Exact idle reviewer activation selected for consult delivery. */
  readonly reviewerActivationId: ActivationId
  /** Session bound to the selected reviewer activation. */
  readonly reviewerSessionId: SessionId
  /** Provider that owns the selected reviewer activation. */
  readonly reviewerProvider: string
}

/** Runtime-authorized scheduler opening of one participant-review consult channel. */
export interface SchedulerReviewChannelOpenRequest extends SchedulerReviewChannelOpenInput {
  /** Trusted scheduler channel authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemSchedulerChannelProof
}

/** JSON-only scheduler request to open one self-addressed task-assignment wake channel. */
export interface SchedulerWakeChannelOpenInput {
  /** Team that owns the pending task and selected activation. */
  readonly teamId: TeamId
  /** Team cursor observed before channel admission. */
  readonly expectedTeamCursor: number
  /** Pending task selected for assignment. */
  readonly taskId: TeamTaskId
  /** Task revision observed before assignment preparation. */
  readonly expectedRevision: number
  /** Selected active participant who receives the wake. */
  readonly participantId: ParticipantId
  /** Exact idle activation selected for the assignment lease. */
  readonly activationId: ActivationId
  /** Session bound to the selected activation. */
  readonly sessionId: SessionId
}

/** Runtime-authorized scheduler opening of one task-assignment wake channel. */
export interface SchedulerWakeChannelOpenRequest extends SchedulerWakeChannelOpenInput {
  /** Trusted scheduler channel authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemSchedulerChannelProof
}

/** JSON-only scheduler request to close an unassigned task-assignment wake channel. */
export interface SchedulerFailedWakeChannelCloseInput {
  /** Team that owns the orphaned wake channel. */
  readonly teamId: TeamId
  /** Task identity frozen into the wake channel manifest. */
  readonly taskId: TeamTaskId
  /** Selected participant frozen into the wake channel manifest. */
  readonly participantId: ParticipantId
  /** Selected activation frozen into the wake channel manifest. */
  readonly activationId: ActivationId
  /** Session frozen into the wake channel manifest. */
  readonly sessionId: SessionId
  /** Exact attached wake channel selected for closure. */
  readonly channelId: ChannelId
  /** Channel cursor observed before closure. */
  readonly expectedChannelCursor: number
}

/** Runtime-authorized scheduler closure of an assignment wake channel whose lease never committed. */
export interface SchedulerFailedWakeChannelCloseRequest extends SchedulerFailedWakeChannelCloseInput {
  /** Trusted scheduler channel authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemSchedulerChannelProof
}

/** JSON-only post-release cancellation cleanup closure of one active Team channel. */
export interface TeamCancellationChannelCloseInput {
  /** Team whose durable cancellation owns this cleanup. */
  readonly teamId: TeamId
  /** Durable cancellation retry identity accepted by the Hub. */
  readonly cancellationIdempotencyKey: TeamClosureIdempotencyKey
  /** Durable cancellation timestamp accepted by the Hub. */
  readonly cancellationRequestedAt: number
  /** Team cursor observed before the cleanup mutation. */
  readonly expectedTeamCursor: number
  /** Attached active channel selected for closure. */
  readonly channelId: ChannelId
  /** Channel cursor observed before closure. */
  readonly expectedCursor: number
  /** Exact reason retained by the terminal channel record. */
  readonly reason: string
}

/** Runtime-authorized TeamRun post-release cancellation closure of one channel. */
export interface TeamCancellationChannelCloseRequest extends TeamCancellationChannelCloseInput {
  /** Trusted TeamRun cancellation-cleanup authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemCancellationCleanupProof
}

/** JSON-only post-release cleanup closure of one active channel after a durably accepted final result. */
export interface TeamFinalizationChannelCloseInput {
  /** Team whose accepted final result owns this cleanup. */
  readonly teamId: TeamId
  /** Direct-v3 channel retaining the accepted coordinator final. */
  readonly finalChannelId: ChannelId
  /** Durable human-receipted coordinator final accepted by the Hub. */
  readonly finalEnvelopeId: EnvelopeId
  /** Team cursor observed before the cleanup mutation. */
  readonly expectedTeamCursor: number
  /** Attached active channel selected for closure. */
  readonly channelId: ChannelId
  /** Channel cursor observed before closure. */
  readonly expectedCursor: number
  /** Exact completion-specific reason retained by the terminal channel record. */
  readonly reason: string
}

/** Runtime-authorized TeamRun post-release finalization closure of one channel. */
export interface TeamFinalizationChannelCloseRequest extends TeamFinalizationChannelCloseInput {
  /** Trusted TeamRun finalization-cleanup authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemFinalizationCleanupProof
}

/** JSON-only cleanup request for one unbound active workflow channel. */
export interface TeamWorkflowChannelCloseInput {
  /** Team that owns the compiling workflow plan and channel. */
  readonly teamId: TeamId
  /** Compiling workflow plan that still has no bound channel. */
  readonly planId: TeamWorkflowPlanId
  /** Team cursor observed before cleanup. */
  readonly expectedTeamCursor: number
  /** Current plan revision observed before cleanup. */
  readonly expectedRevision: number
  /** Exact active workflow channel selected for cleanup. */
  readonly channelId: ChannelId
  /** Channel-WAL cursor observed before closure. */
  readonly expectedCursor: number
  /** Optional human-readable closure reason. */
  readonly reason?: string | undefined
}

/** Runtime-authorized TeamRun cleanup of one unbound workflow channel. */
export interface TeamWorkflowChannelCloseRequest extends TeamWorkflowChannelCloseInput {
  /** Trusted TeamRun workflow compiler authority; it never crosses a durable or wire boundary. */
  readonly actor: TeamSystemWorkflowProof
}

/** Wait for a channel-WAL cursor to advance without a registration gap. */
export interface ChannelWatchRequest {
  /** Channel whose WAL is observed. */
  readonly channelId: ChannelId
  /** Latest channel-WAL sequence already observed by the caller, or `-1` before its first read. */
  readonly afterCursor: number
  /** Optional local cancellation for this wait; providers omit it before parsing JSON-only request fields. */
  readonly signal?: AbortSignal
}

/** Result of waiting for one channel-WAL cursor. */
export type ChannelWatchResult =
  | { readonly kind: 'changed'; readonly cursor: number }
  | { readonly kind: 'closed' }

/** Adapter-owned record requested after an accepted envelope. */
export interface ChannelAdapterRecordDraft {
  /** Adapter-defined record payload. */
  readonly payload: JsonObject
}

/** A channel adapter's derived speaker expectation. */
export type ChannelExpectedNext =
  | { readonly kind: 'none' }
  | { readonly kind: 'participant'; readonly participantId: ParticipantId }

/** One recipient admission the Hub must schedule from an accepted envelope. */
export interface DeliveryIntent {
  /** Recipient whose durable inbox must admit the envelope. */
  readonly participantId: ParticipantId
  /** Source envelope to deliver. */
  readonly envelopeId: EnvelopeId
  /** Recipient treatment selected by the adapter. */
  readonly delivery: EnvelopeDelivery
}

/** Stateless synchronous channel protocol implementation. */
export interface TeamChannelAdapter extends TeamAdapterRef {
  /**
   * Validate one immutable channel manifest before it enters a WAL.
   * @param manifest - candidate immutable channel configuration.
   */
  validateCreate(manifest: ChannelManifest): void
  /**
   * Authorize ending an optional invitation without making the protocol unsatisfiable.
   * @param input - immutable protocol state, removed member and retained invitation members.
   * @returns true only when the protocol can continue with that retained set.
   */
  allowParticipantRemoval?(input: {
    readonly manifest: ChannelManifest
    readonly state: JsonValue
    readonly participantId: ParticipantId
    readonly retainedParticipantIds: readonly ParticipantId[]
  }): boolean

  /**
   * Construct the initial fold state from a validated manifest.
   * @param manifest - validated immutable channel configuration.
   * @returns initial lossless JSON fold state.
   */
  initialState(manifest: ChannelManifest): JsonValue
  /**
   * Validate one sender's draft against the current folded channel state.
   * @param input - manifest, fold state, sender, and candidate draft.
   */
  validateSend(input: {
    readonly manifest: ChannelManifest
    readonly state: JsonValue
    readonly senderId: ParticipantId
    readonly draft: TeamEnvelopeDraft
  }): void
  /**
   * Prepare the one final Envelope this adapter permits for a bound sender.
   * Omission makes the channel ineligible for `team_final`.
   * @param input - current immutable channel facts and model-supplied final text.
   * @returns recipient, kind, payload, and delivery selected by this protocol.
   */
  prepareFinal?(input: {
    readonly manifest: ChannelManifest
    readonly state: JsonValue
    readonly senderId: ParticipantId
    readonly text: string
  }): {
    readonly audience: readonly ParticipantId[]
    readonly kind: string
    readonly payload: JsonObject
    readonly delivery: EnvelopeDelivery
  }
  /**
   * Fold one committed common or adapter-owned channel record.
   * @param state - prior lossless JSON fold state.
   * @param record - next committed channel WAL record.
   * @returns next lossless JSON fold state.
   */
  fold(state: JsonValue, record: ChannelRecord): JsonValue
  /**
   * Request adapter-owned records to append after a channel envelope commits.
   * @param input - manifest, post-envelope state, and committed envelope record.
   * @returns adapter-owned records the Hub may append atomically.
   */
  afterAccept(input: {
    readonly manifest: ChannelManifest
    readonly state: JsonValue
    readonly record: ChannelEnvelopeRecord
  }): readonly ChannelAdapterRecordDraft[]
  /**
   * Request an atomic channel close after one accepted Envelope. Returning a
   * reason appends the closing and terminal records in the same WAL batch.
   * @param input - manifest, fold state after adapter records, and accepted Envelope.
   * @returns a non-empty closure reason, or `undefined` when the channel remains open.
   */
  closeAfterAccept?(input: {
    readonly manifest: ChannelManifest
    readonly state: JsonValue
    readonly record: ChannelEnvelopeRecord
  }): string | undefined
  /**
   * Permit delivery of an already committed outbox after normal protocol completion.
   * @param input - Immutable manifest and current folded protocol state.
   * @returns True only for a completed protocol whose retained recipients may still drain.
   */
  allowsClosedDelivery?(input: { readonly manifest: ChannelManifest; readonly state: JsonValue }): boolean
  /**
   * State whether this protocol expects a specific next participant.
   * @param input - manifest and current fold state.
   * @returns the adapter's next-speaker expectation.
   */
  expectedNext(input: { readonly manifest: ChannelManifest; readonly state: JsonValue }): ChannelExpectedNext
  /**
   * Expand one accepted envelope into recipient admission work.
   * @param input - manifest, current fold state, and accepted envelope.
   * @returns recipient admission intents.
   */
  deliveryPlan(input: {
    readonly manifest: ChannelManifest
    readonly state: JsonValue
    readonly envelope: TeamEnvelope
  }): readonly DeliveryIntent[]
  /**
   * Produce a JSON-safe channel view without mutating fold state or records.
   * @param input - manifest, current fold state, and channel WAL records.
   * @returns JSON-safe channel view.
   */
  projectView(input: {
    readonly manifest: ChannelManifest
    readonly state: JsonValue
    readonly records: readonly ChannelRecord[]
  }): JsonObject
  /** Retain adapter-private runtime implementations for one active channel. */
  acquireRuntimeLease?(manifest: ChannelManifest): TeamChannelAdapterRuntimeLease
}

/** Adapter-private implementations retained by one active channel until projection eviction. */
export interface TeamChannelAdapterRuntimeLease {
  /** Adapter wrapper bound to the retained private implementations. */
  readonly adapter: TeamChannelAdapter
  /** Release retained private implementations once; repeated calls are harmless. */
  release(): void
}

/**
 * Retained exact adapter implementation for one already admitted channel.
 * Releasing this runtime-only handle permits a retired registration to be
 * collected after its channel has reached terminal quiescence.
 */
export interface TeamAdapterLease {
  /** The exact adapter object selected while the registration accepted work; reading after release throws. */
  readonly adapter: TeamChannelAdapter
  /** Whether this exact implementation retired from future registrations. */
  isRetired(): boolean
  /** Release this handle once; repeated calls are harmless. */
  release(): void
}

/** Team operations subject to policy waterfalls. */
export type TeamPolicyHook =
  | 'register'
  | 'invite'
  | 'activate'
  | 'channel-open'
  | 'send'
  | 'human-action'
  | 'usage'
  | 'dispatch'
  | 'goal-mutate'
  | 'task-mutate'
  | 'task-assign'
  | 'interrupt'
  | 'workspace-allocate'
  | 'workspace-integrate'
  | 'close'

/** Context that a provider presents to one policy waterfall. */
export interface TeamPolicyRequest {
  /** Operation whose authorization or governance is being decided. */
  readonly hook: TeamPolicyHook
  /** Team affected by the operation, when it already exists. */
  readonly teamId?: TeamId
  /** Authenticated participant making the request, when applicable. */
  readonly actorId?: ParticipantId
  /** Provider-validated operation facts available to policy code. */
  readonly facts: JsonObject
}

/** Result of a Team policy waterfall. */
export type TeamPolicyDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deny'; readonly code: string; readonly message: string }

/** One named policy contribution registered for exactly one policy hook. */
export interface TeamPolicy {
  /** Unique policy name within its hook. */
  readonly name: string
  /**
   * Decide or delegate; an allowing policy calls `next()`, while a denial short-circuits.
   * @param request - provider-validated operation facts.
   * @param next - remaining policy waterfall.
   * @returns the final allow or deny decision.
   */
  apply(request: TeamPolicyRequest, next: () => Promise<TeamPolicyDecision>): Promise<TeamPolicyDecision>
}

/** One registered policy's diagnostic identity. */
export interface TeamPolicyRegistration {
  /** Hook this policy intercepts. */
  readonly hook: TeamPolicyHook
  /** Unique policy name within the hook. */
  readonly name: string
}

/** Post-commit Team journal notification. */
export type TeamEvent =
  | { readonly type: 'team/created'; readonly team: TeamSnapshot }
  | { readonly type: 'team/changed'; readonly team: TeamSnapshot }
  | { readonly type: 'goal/changed'; readonly goal: TeamGoalSnapshot; readonly cursor: number; readonly createdAt: number }
  | { readonly type: 'participant/changed'; readonly participant: ParticipantSnapshot; readonly cursor: number; readonly createdAt: number }
  | { readonly type: 'activation/changed'; readonly binding: ActivationBindingSnapshot; readonly cursor: number; readonly createdAt: number }
  | { readonly type: 'participant-interrupt/changed'; readonly interrupt: ParticipantInterruptSnapshot; readonly cursor: number; readonly createdAt: number }
  | { readonly type: 'human-action/changed'; readonly action: TeamHumanActionSnapshot; readonly cursor: number; readonly createdAt: number }
  | { readonly type: 'usage/changed'; readonly teamId: TeamId; readonly usage: TeamUsageSnapshot; readonly cursor: number; readonly createdAt: number }
  | { readonly type: 'workflow-plan/changed'; readonly plan: TeamWorkflowPlanSnapshot; readonly cursor: number; readonly createdAt: number }
  | { readonly type: 'task/changed'; readonly task: TeamTaskSnapshot; readonly cursor: number; readonly createdAt: number }
  | { readonly type: 'workspace/observed'; readonly observation: TeamWorkspaceObservation; readonly cursor: number; readonly createdAt: number }
  | { readonly type: 'workspace-allocation/changed'; readonly allocation: TeamWorkspaceAllocationSnapshot; readonly cursor: number; readonly createdAt: number }
  | { readonly type: 'policy/denied'; readonly teamId: TeamId; readonly hook: TeamPolicyHook; readonly code: string; readonly message: string; readonly actorId?: ParticipantId | undefined; readonly cursor: number; readonly createdAt: number }

export type * from './human-delivery-types.ts'

export type * from './child-result-types.ts'

/** Public bounds of the installed extractive summary Consumer. */
export interface ChannelSummaryCapabilities {
  readonly allowedPolicies: readonly string[]
  readonly maxSourceEnvelopes: number
  readonly maxSourceBytes: number
  readonly maxSummaryBytes: number
  readonly maxHistorySpan: number
}

/** Currently registered channel protocols, view policies and optional summary support. */
export interface TeamChannelCatalog {
  readonly adapters: readonly TeamAdapterRef[]
  readonly viewPolicies: readonly TeamViewPolicyRef[]
  readonly summary?: ChannelSummaryCapabilities | undefined
}
