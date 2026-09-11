/** Team workspace provider and allocation types. @module @clocky/clocky-team-workspace/types */

import type {
  ActivationBindingSnapshot,
  ActivationId,
  ParticipantId,
  ParticipantSnapshot,
  TaskAttemptId,
  TeamWorkspaceAllocationId,
  TeamId,
  TeamTaskId,
  TeamTaskSnapshot,
  TeamTaskWorkspaceMode,
  TeamArtifactReference,
  TeamWorkspaceObservation,
  TeamWorkspaceExecutionWorld,
  TeamWorkspaceLoss,
} from '@clocky/clocky-team'
import type { SessionId } from '@clocky/clocky-session'

/** Immutable scheduler input used to decide whether one activation can execute one task mode. */
export interface TeamWorkspaceEligibilityRequest {
  /** Current durable task whose immutable workspace mode selects the provider. */
  readonly task: TeamTaskSnapshot
  /** Exact durable activation and Session binding proposed for the task. */
  readonly binding: ActivationBindingSnapshot
}

/** Deployment route facts a provider may check before a Participant activation exists. */
export interface TeamWorkspacePreflightRequest {
  /** Current durable task whose immutable workspace mode selects the provider. */
  readonly task: TeamTaskSnapshot
  /** Active Participant that the placement route would activate. */
  readonly participant: ParticipantSnapshot
  /** Runtime route selected by the placement Consumer. */
  readonly route: {
    /** AgentRuntime provider name selected for the activation. */
    readonly provider: string
    /** Provider/model identity selected for the activation. */
    readonly model: string
    /** Optional preset selected for the activation. */
    readonly preset?: string | undefined
    /** Candidate execution cwd selected for the activation. */
    readonly cwd: string
  }
}

/** Exact current lease and activation facts required to prepare an execution root. */
export interface TeamWorkspacePrepareRequest {
  /** Team owning the task attempt. */
  readonly teamId: TeamId
  /** Task carrying the current lease. */
  readonly taskId: TeamTaskId
  /** Current lease attempt selected by the scheduler. */
  readonly attemptId: TaskAttemptId
  /** Task revision committed with the lease assignment. */
  readonly assignedRevision: number
  /** Lease owner that requests the execution root. */
  readonly participantId: ParticipantId
  /** Agent residency epoch bound to the current lease. */
  readonly activationId: ActivationId
  /** Session durably bound to the residency epoch. */
  readonly sessionId: SessionId
}

/** Provider-owned durable metadata for one exact task-attempt allocation. */
export interface TeamWorkspaceAllocationMetadata {
  /** Provider-minted opaque allocation identity. */
  readonly id: TeamWorkspaceAllocationId
  /** Registered provider identity that owns this allocation. */
  readonly provider: string
  /** Immutable task workspace mode that selected this provider. */
  readonly mode: TeamTaskWorkspaceMode
  /** Team that owns the allocation. */
  readonly teamId: TeamId
  /** Task that owns the allocation. */
  readonly taskId: TeamTaskId
  /** Current task attempt that owns the allocation. */
  readonly attemptId: TaskAttemptId
  /** Revision committed with the lease assignment. */
  readonly assignedRevision: number
  /** Lease owner that requests the execution root. */
  readonly participantId: ParticipantId
  /** Agent residency epoch bound to the current lease. */
  readonly activationId: ActivationId
  /** Session durably bound to the residency epoch. */
  readonly sessionId: SessionId
  /** Optional provider-owned immutable base version, such as a Git commit. */
  readonly baseVersion?: string | undefined
  /** Immutable remote execution world; restored allocations must use this exact identity. */
  readonly executionWorld?: TeamWorkspaceExecutionWorld | undefined
}

/** One root-less provider reservation that waits for its Team binding before materialization. */
export interface TeamWorkspacePreparation extends TeamWorkspaceAllocationMetadata {
  /**
   * Create or reopen the provider-owned execution root after Team durability
   * accepts this exact metadata.
   * @returns the exact live allocation handle.
   */
  materialize(): Promise<TeamWorkspaceAllocation>
  /**
   * Discard this root-less provider reservation when its Team binding cannot
   * commit. This is idempotent and never changes Team state.
   * @returns resolution after provider reservation cleanup completes.
   */
  abandon(): Promise<void>
}

/** One provider-owned live execution root for one exact Team task attempt. */
export interface TeamWorkspaceAllocation extends TeamWorkspaceAllocationMetadata {
  /** Canonical execution root exposed to the task Agent. */
  readonly root: string
  /** Observe provider-confirmed loss while this allocation remains owned.
   * @param listener - current task consumer that persists and settles the exact loss.
   * @returns listener disposer; rejected notifications remain retryable at the provider.
   */
  onLoss?(listener: (loss: TeamWorkspaceLoss) => Promise<void>): () => void
  /**
   * Release provider-owned allocation state. This is idempotent and never
   * changes Team task state.
   * @returns resolution after the provider releases its allocation resources.
   */
  release(): Promise<void>
}

/** Agent-scoped owner that settles live task allocations before local activation disposal. */
export interface TeamWorkspaceAllocationSettler {
  /**
   * Complete durable release or preservation for every allocation exposed to
   * this Agent before its activation owner releases the local process handle.
   * @returns resolution after every current allocation cleanup path settles.
   */
  settleForActivationDisposal(): Promise<void>
}

/** Exact allocation publication requested by its currently executing same-process owner. */
export interface TeamWorkspaceOwnerPublicationRequest {
  readonly taskId: TeamTaskId
  readonly attemptId: TaskAttemptId
  readonly allocationId: TeamWorkspaceAllocationId
  readonly expectedRevision: number
  /** Actual tool/driver cancellation; ownership persists until publication settles. */
  readonly signal: AbortSignal
}

/** Delivery owner that resolves its private allocations by exact task and attempt. */
export interface TeamWorkspaceAllocationPublisher {
  /**
   * Publish only a current claimed task allocation, refusing missing, queued, stale or released work.
   * @param request - Exact task/attempt/allocation and active execution cancellation.
   * @returns Provider publication after scan facts settle; undefined only if that provider has no publication capability.
   */
  publish(request: TeamWorkspaceOwnerPublicationRequest): Promise<TeamWorkspacePublishResult | undefined>
}

/** Explicit publish/integrate request for an owned task workspace. */
export interface TeamWorkspacePublishRequest {
  /** Optional cancellation for the actual publishing operation. */
  readonly signal?: AbortSignal
  /** Exact allocation identity being published. */
  readonly allocation: TeamWorkspaceAllocation
  /** Optional destination branch or integration target selected by policy. */
  readonly target?: string | undefined
}

/** Durable provenance returned by a workspace publish operation. */
export interface TeamWorkspacePublishResult {
  /** Latest bounded observation; truncated observations never establish an empty whole-tree change set. */
  readonly observation?: TeamWorkspaceObservation
  /** Exact task attempt that produced the change set. */
  readonly teamId: TeamId
  readonly taskId: TeamTaskId
  readonly attemptId: TaskAttemptId
  /** Paths observed as changed by the provider. */
  readonly changedPaths: readonly string[]
  /** Provider-owned artifact references, when materialized. */
  readonly artifacts: readonly TeamArtifactReference[]
  /** Whether integration was accepted by the provider/policy. */
  readonly accepted: boolean
}

/** Explicit integration/proposal request for one provider-owned allocation. */
export interface TeamWorkspaceIntegrateRequest {
  /** Exact allocation whose changes are being integrated. */
  readonly allocation: TeamWorkspaceAllocation
  /** Branch or other provider-defined integration target. */
  readonly target: string
  /** Target revision observed by the caller, when the provider can compare it. */
  readonly expectedTarget?: string | undefined
  /** Whether to materialize a proposal or perform an authorized integration. */
  readonly mode: 'proposal' | 'integrate'
  /** Optional Team participant requesting the operation for policy checks. */
  readonly actorId?: ParticipantId | undefined
}

/** Result of an explicit provider integration operation. */
export interface TeamWorkspaceIntegrateResult {
  /** Exact task attempt that produced the change set. */
  readonly teamId: TeamId
  readonly taskId: TeamTaskId
  readonly attemptId: TaskAttemptId
  /** Target selected by the caller. */
  readonly target: string
  /** Provider-owned operation result. */
  readonly status: 'proposed' | 'integrated' | 'conflict'
  /** Target revision after a successful integration, when the provider has one. */
  readonly targetVersion?: string | undefined
  /** Whether the requested operation was accepted by provider policy. */
  readonly accepted: boolean
  /** Optional artifact carrying a reviewable patch/proposal. */
  readonly artifact?: TeamArtifactReference | undefined
  /** Paths that prevented integration, when status is `conflict`. */
  readonly conflictPaths?: readonly string[] | undefined
}

/** Completed source-attempt artifacts supplied to an integration provider. */
export interface TeamWorkspaceSourceArtifactInput {
  /** Team that owns both the source and integration task. */
  readonly teamId: TeamId
  /** Completed source task whose artifact set is being integrated. */
  readonly taskId: TeamTaskId
  /** Completed source attempt whose artifact provenance must match every applied patch. */
  readonly attemptId: TaskAttemptId
  /** Provider-independent artifact references published by the source attempt. */
  readonly artifacts: readonly TeamArtifactReference[]
}

/** Explicit integration request that does not depend on a live source allocation. */
export interface TeamWorkspaceSourceIntegrateRequest {
  /** Verified source task and attempt artifact manifest. */
  readonly source: TeamWorkspaceSourceArtifactInput
  /** Integration task that owns the operation and its durable result. */
  readonly integrationTaskId: TeamTaskId
  /** Current integration attempt that owns the operation. */
  readonly integrationAttemptId: TaskAttemptId
  /** Branch or provider-defined integration target. */
  readonly target: string
  /** Target revision observed when the integration task was created. */
  readonly expectedTarget?: string | undefined
  /** Whether to return a proposal or update the target. */
  readonly mode: 'proposal' | 'integrate'
  /** Derived Team participant used for provider policy facts. */
  readonly actorId?: ParticipantId | undefined
}

/** Provider result for an integration sourced from durable artifacts. */
export interface TeamWorkspaceSourceIntegrateResult {
  /** Team owning the source and integration task. */
  readonly teamId: TeamId
  /** Source task provenance returned without caller-selected substitution. */
  readonly sourceTaskId: TeamTaskId
  /** Source attempt provenance returned without caller-selected substitution. */
  readonly sourceAttemptId: TaskAttemptId
  /** Integration task provenance returned without caller-selected substitution. */
  readonly integrationTaskId: TeamTaskId
  /** Integration attempt provenance returned without caller-selected substitution. */
  readonly integrationAttemptId: TaskAttemptId
  /** Target selected by the integration task. */
  readonly target: string
  /** Provider operation result. */
  readonly status: 'proposed' | 'integrated' | 'conflict'
  /** Target revision after a successful integration. */
  readonly targetVersion?: string | undefined
  /** Patch or proposal artifact retained as part of the result. */
  readonly artifact?: TeamArtifactReference | undefined
  /** Paths that prevented integration, when status is `conflict`. */
  readonly conflictPaths?: readonly string[] | undefined
}

/** One local, worktree, sandbox, or remote execution-root provider. */
export interface TeamWorkspaceProvider {
  /** Unique non-empty registry name. */
  readonly name: string
  /** Workspace modes this provider accepts for future eligibility and allocation requests. */
  readonly modes: readonly TeamTaskWorkspaceMode[]
  /**
   * Optionally reject a deployment route using facts available before activation.
   * Providers must not allocate roots or mutate Team state during this check.
   * @param request - task, Participant, and candidate runtime route.
   * @returns whether the route is compatible; absence means no provider-owned preflight is available.
   */
  preflight?(request: TeamWorkspacePreflightRequest): Promise<boolean>
  /**
   * Determine whether the exact task and activation can execute through this provider.
   * @param request - current task and activation binding selected by a scheduler.
   * @returns whether this provider can allocate the request without changing Team state.
   */
  eligible(request: TeamWorkspaceEligibilityRequest): Promise<boolean>
  /**
   * Prepare provider-owned metadata before an execution root exists.
   * @param request - lease and activation facts that the provider revalidates before reserving.
   * @returns a root-less reservation whose materialization waits for Team binding.
   */
  prepare(request: TeamWorkspacePrepareRequest): Promise<TeamWorkspacePreparation>
  /**
   * Reopen an exact durable allocation after process recovery. Providers reject
   * metadata they did not mint instead of inferring authority from a path.
   * @param request - exact current task-attempt ownership relation.
   * @param metadata - provider metadata retained by the Team journal.
   * @returns the provider-owned live execution-root allocation.
   */
  restore(request: TeamWorkspacePrepareRequest, metadata: TeamWorkspaceAllocationMetadata): Promise<TeamWorkspaceAllocation>
  /**
   * Reconcile a durable release-requested allocation without materializing a
   * new root. Providers prove cleanup succeeded or reject so the caller can
   * preserve the resource for recovery.
   * @param request - exact task-attempt ownership retained by the allocation.
   * @param metadata - provider metadata retained by the Team journal.
   * @returns resolution after cleanup is proven or completed.
   */
  reconcileRelease(request: TeamWorkspacePrepareRequest, metadata: TeamWorkspaceAllocationMetadata): Promise<void>
  /** Optional explicit publish/integrate boundary; providers never auto-merge. */
  publish?(request: TeamWorkspacePublishRequest): Promise<TeamWorkspacePublishResult>
  /** Optional explicit proposal/integration operation; providers never auto-merge. */
  integrate?(request: TeamWorkspaceIntegrateRequest): Promise<TeamWorkspaceIntegrateResult>
  /** Optional artifact-sourced integration operation; providers never infer source bytes from a path. */
  integrateSource?(request: TeamWorkspaceSourceIntegrateRequest): Promise<TeamWorkspaceSourceIntegrateResult>
}

/** Detached identity of one live Team workspace provider. */
export interface TeamWorkspaceProviderRef {
  /** Unique registry name. */
  readonly name: string
  /** Registered immutable workspace modes in provider declaration order. */
  readonly modes: readonly TeamTaskWorkspaceMode[]
}
