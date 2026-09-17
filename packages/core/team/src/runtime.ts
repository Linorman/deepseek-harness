import type { TeamMemberInspectRequest, TeamMemberInspection } from './types.ts'
import type { TeamWorkflowInspectRequest, TeamWorkflowInspection } from './types.ts'
import type { TeamHumanActionReadRequest } from './types.ts'
import type { TeamSelectionRequest } from './types.ts'
import type { TeamTaskInspectRequest, TeamTaskInspection } from './types.ts'
import type { TeamBrowseRequest, TeamBrowsePage } from './types.ts'
import type { TeamMemberSessionRequest, TeamMemberSessionSnapshot } from './types.ts'
import type { TeamSelectionSnapshot } from './types.ts'
import type { ActivationReservationRequest, ActivationReservationSnapshot } from './types.ts'
import type { TeamChannelListRequest, TeamChannelListPage } from './types.ts'
import type { TeamSystemChildResultProof, TeamSystemChildResultProofSource, TeamSystemChildResultProofResolution, TeamChildResultCommandRequest, TeamChildCancelRequest, TeamTaskDelegationResultAdmitRequest, TeamDelegationResultAdmission } from './types.ts'
import { teamSystemChildResultScopeSchema } from './schema.ts'
import { isDeepStrictEqual } from 'node:util'
import type { TeamChildRunAuthorization, TeamChildRunScope } from './types.ts'
import type {
  TeamSystemDelegationProof, TeamSystemDelegationScope, TeamSystemDelegationProofSource, TeamSystemDelegationProofResolution,
  TeamTaskDelegationBeginRequest, TeamTaskDelegationBindRequest, TeamTaskDelegationSettleRequest,
  TeamTaskDelegationStallRequest, TeamChildRunAuthorizeRequest,
} from './types.ts'
import { teamSystemDelegationScopeSchema } from './schema.ts'
import type { TeamHumanSinkProof, TeamHumanSinkScope } from './types.ts'
import type { TeamSystemHumanDeliveryProof, TeamSystemHumanDeliveryScope, TeamSystemHumanDeliveryProofSource, TeamHumanChannelDeliveryRequest, TeamHumanChannelDeliveryResult } from './types.ts'
import { teamSystemHumanDeliveryScopeSchema } from './schema.ts'
import type { ChannelHumanAdmissionSnapshot, ChannelHumanEnvelopeGetRequest, ChannelHumanAdmissionGetRequest, ChannelHumanInvitationGetRequest, ChannelHumanInvitationSnapshot, ChannelActorGetRequest } from './types.ts'
import { teamSystemChannelAdmissionProofSourceNameSchema, teamSystemChannelAdmissionProofResolutionSchema } from './schema.ts'
import type { TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionProofSource, TeamSystemChannelAdmissionProofResolution, ChannelInvitationExpireRequest } from './types.ts'
import type { ChannelAdmissionSnapshot, ChannelInvitationAcknowledgeRequest } from './types.ts'
import type { TeamWorkspaceObservationRequest, TeamWorkspaceObservation } from './types.ts'
/**
 * Abstract Team service definition with adapter registration and typed policy
 * waterfalls. Providers own persistence, scheduling, and transport.
 *
 * @module @clocky/clocky-team/runtime
 */

import { Context, Service } from '@clocky/cordis'
import { TeamError } from './error.ts'
import { addTeamLatencySample, emptyTeamLatencyHistogram } from './metrics.ts'
import {
  activationBindingSnapshotSchema,
  channelEventSchema,
  teamSystemActivationProofResolutionSchema,
  teamSystemActivationProofSourceNameSchema,
  teamSystemHumanActionProofResolutionSchema,
  teamSystemHumanActionProofSourceNameSchema,
  teamHumanActorProofResolutionSchema,
  teamHumanActorProofSourceNameSchema,
  teamSystemTaskLeaseProofResolutionSchema,
  teamSystemTaskLeaseProofSourceNameSchema,
  teamSystemWorkflowProofResolutionSchema,
  teamSystemWorkflowProofSourceNameSchema,
  teamSystemTaskControlProofResolutionSchema,
  teamSystemTaskControlProofSourceNameSchema,
  teamSystemRootCreationProofResolutionSchema,
  teamSystemRootCreationProofSourceNameSchema,
  teamSystemChildCreationProofResolutionSchema,
  teamSystemChildCreationProofSourceNameSchema,
  teamSystemChannelSummaryProofResolutionSchema,
  teamSystemChannelSummaryProofSourceNameSchema,
  teamSystemChannelLifecycleProofResolutionSchema,
  teamSystemChannelLifecycleProofSourceNameSchema,
  teamSystemWorkspaceAllocationProofResolutionSchema,
  teamSystemWorkspaceAllocationProofSourceNameSchema,
  teamSystemArchiveProofResolutionSchema,
  teamSystemArchiveProofSourceNameSchema,
  teamSystemTopologyProofResolutionSchema,
  teamSystemTopologyProofSourceNameSchema,
  teamSystemSchedulerChannelProofResolutionSchema,
  teamSystemSchedulerChannelProofSourceNameSchema,
  teamSystemCancellationCleanupProofResolutionSchema,
  teamSystemCancellationCleanupProofSourceNameSchema,
  teamSystemFinalizationCleanupProofResolutionSchema,
  teamSystemFinalizationCleanupProofSourceNameSchema,
  teamSystemEnvelopePostProofResolutionSchema,
  teamSystemEnvelopePostProofSourceNameSchema,
  teamSystemClosureProofResolutionSchema,
  teamSystemClosureProofSourceNameSchema,
  teamSystemClosureDriverProofResolutionSchema,
  teamSystemClosureDriverProofSourceNameSchema,
  teamSystemPhaseProofResolutionSchema,
  teamSystemPhaseProofSourceNameSchema,
  teamSystemMaintenanceProofResolutionSchema,
  teamSystemMaintenanceProofSourceNameSchema,
  teamSystemInterruptProofResolutionSchema,
  teamSystemInterruptProofSourceNameSchema,
  teamSystemTaskReviewProofResolutionSchema,
  teamSystemTaskReviewProofSourceNameSchema,
  teamSystemFinalReceiptProofResolutionSchema,
  teamSystemFinalReceiptProofSourceNameSchema,
  teamEventSchema,
  teamQuiescenceSnapshotSchema,
} from './schema.ts'
import type { TeamWorkspaceAllocationLossRequest } from './types.ts'
import type {
  ActivationActorProofIssuer,
  ActivationBindRequest,
  ActivationBindingSnapshot,
  ActivationFenceRequest,
  ActivationQuiesceRequest,
  ActivationGetRequest,
  ActivationStatusUpdateRequest,
  ChannelCloseRequest,
  TeamCancellationChannelCloseRequest,
  TeamFinalizationChannelCloseRequest,
  SchedulerReviewChannelOpenRequest,
  SchedulerWakeChannelOpenRequest,
  SchedulerFailedWakeChannelCloseRequest,
  ChannelDeliveryClaim,
  ChannelDeliveryClaimRequest,
  ChannelDeliveryExpireResult,
  SchedulerChannelDeliveryExpireRequest,
  ChannelSummaryRecord,
  ChannelSummarizeRequest,
  ChannelSummarySourceRequest,
  ChannelSummarySource,
  ChannelFinalPostRequest,
  ChannelEnvelopePostRequest,
  ChannelEnvelopeReceiptRequest,
  ChannelEvent,
  ChannelGetRequest,
  ChannelRecord,
  ChannelReceiptRecord,
  ChannelOpenRequest,
  ChannelPendingDeliveryListRequest,
  ChannelPendingDeliveryPage,
  ChannelReadPageRequest,
  ChannelReadPageResult,
  TeamChannelCompactRequest,
  TeamChannelCompactResult,
  TeamJournalCompactRequest,
  TeamJournalCompactResult,
  ChannelReadRequest,
  ChannelReadResult,
  ChannelSnapshot,
  ChannelId,
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
  TeamAdapterLease,
  TeamAdapterRef,
  TeamActorProof,
  TeamActorProofLease,
  TeamSystemActivationProof,
  TeamSystemActivationProofResolution,
  TeamSystemActivationProofSource,
  TeamSystemHumanActionProof,
  TeamSystemHumanActionProofResolution,
  TeamSystemHumanActionProofSource,
  TeamHumanActorProof,
  TeamHumanActorProofResolution,
  TeamHumanActorProofSource,
  TeamSystemTaskLeaseProof,
  TeamSystemTaskLeaseProofResolution,
  TeamSystemTaskLeaseProofSource,
  TeamSystemWorkflowProof,
  TeamSystemWorkflowProofResolution,
  TeamSystemWorkflowProofSource,
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
  TeamViewPolicy,
  TeamViewPolicyLease,
  TeamViewPolicyRef,
  TeamArchiveRequest,
  TeamHumanResumeAuthorization,
  TeamHumanResumeRequest,
  TeamAuditReadRequest,
  TeamAuditReadResult,
  TeamChannelAdapter,
  TeamCancelRequest,
  TeamClosureContinuationRequest,
  TeamFinalAdmissionRequest,
  TeamFinalAdmission,
  TeamCompleteRequest,
  TeamFailRequest,
  TeamCreateRequest,
  TeamEnvelope,
  TeamEvent,
  TeamGetRequest,
  TeamGoalPhaseTransitionRequest,
  TeamGoalUpdateRequest,
  TeamHumanActionResolveRequest,
  TeamHumanActionSnapshot,
  TeamHumanActionUpsertRequest,
  TeamUsageRecordRequest,
  TeamUsageSnapshot,
  TeamPhaseTransitionRequest,
  TeamPolicy,
  TeamPolicyDecision,
  TeamPolicyHook,
  TeamPolicyRegistration,
  TeamPolicyRequest,
  TeamId,
  TeamListPage,
  TeamListPageRequest,
  TeamStateSnapshot,
  TeamArtifactGetRequest,
  TeamArtifactReference,
  TeamArtifactListPage,
  TeamArtifactListPageRequest,
  TeamQuiescenceSnapshot,
  TeamImplementationLeaseMetrics,
  TeamMetricsSnapshot,
  TeamTaskAssignRequest,
  TeamTaskAttemptExpireRequest,
  TeamTaskAttemptHeartbeatRequest,
  TeamTaskAttemptStartClaimRequest,
  TeamTaskAttemptSettleRequest,
  TeamTaskAttemptStartRequest,
  TeamWorkspaceAllocationReserveRequest,
  TeamWorkspaceAllocationActivateRequest,
  TeamWorkspaceAllocationReleaseRequest,
  TeamWorkspaceAllocationPreserveRequest,
  TeamWorkspaceAllocationReleaseConfirmRequest,
  TeamWorkspaceAllocationSnapshot,
  TeamTaskCancelRequest,
  TeamTaskCancellationReconcileRequest,
  TeamCancellationTaskCancelRequest,
  TeamTaskCreateRequest,
  TeamTaskDeleteRequest,
  TeamTaskDetailsUpdateRequest,
  TeamTaskGetRequest,
  TeamTaskListPage,
  TeamTaskListPageRequest,
  TeamTaskOwnerProposalRequest,
  TeamTaskReviewResolveRequest,
  TeamTaskReviewRecoverRequest,
  TeamTaskSnapshot,
  TeamWatchRequest,
  TeamWatchResult,
  TeamWorkflowPlanAdmissionRequest,
  TeamWorkflowPlanChannelBindRequest,
  TeamWorkflowPlanGetRequest,
  TeamWorkflowPlanListPage,
  TeamWorkflowPlanListPageRequest,
  TeamWorkflowPlanPhaseRequest,
  TeamWorkflowChannelCloseRequest,
  TeamWorkflowPlanSnapshot,
  TeamWorkflowPlanTaskBindRequest,
} from './types.ts'

type TeamCounterMetric = Exclude<keyof TeamMetricsSnapshot, 'updatedAt' | 'taskLatency' | 'receiptLatency'>
type TeamLatencyMetric = 'taskLatency' | 'receiptLatency'

/** Runtime-only state retained for one issued activation actor proof. */
interface ActivationActorProofRecord {
  /** Immutable durable binding resolved when the issuer minted this proof. */
  readonly binding: ActivationBindingSnapshot
  /** Whether its issuer-owned lease still permits proof resolution. */
  active: boolean
}

/** One registered implementation that may outlive its accepting contribution. */
interface RetainedImplementation<T> {
  /** Exact immutable identity used to resolve this implementation. */
  readonly ref: TeamAdapterRef
  /** Provider-owned implementation object. */
  readonly implementation: T
  /** Whether new callers may acquire this implementation. */
  accepting: boolean
  /** Number of active runtime-only leases retaining this exact object. */
  leases: number
}

/** Private generic lease used to construct the public adapter and policy handles. */
interface RetainedImplementationLease<T> {
  /** Exact provider-owned object retained by this lease. */
  readonly implementation: T
  /** Whether this exact retained entry no longer accepts new work. */
  isRetired(): boolean
  /** Release this exact lease idempotently. */
  release(): void
}

declare module '@clocky/cordis' {
  interface Context {
    teams: TeamRuntime
  }

  interface Events {
    /**
     * A Team channel adapter became available for future channel openings.
     * @param adapter - registered adapter identity.
     * @mode emit
     */
    'team/adapter-added'(this: TeamRuntime, adapter: TeamAdapterRef): void
    /**
     * A Team channel adapter stopped accepting new channels. Existing leases
     * retain the exact implementation until their owners release them.
     * @param adapter - removed adapter identity.
     * @mode emit
     */
    'team/adapter-removed'(this: TeamRuntime, adapter: TeamAdapterRef): void
    /** A pure channel view policy became available for future channel reads.
     * @param policy - registered view-policy identity.
     * @mode emit
     */
    'team/view-policy-added'(this: TeamRuntime, policy: TeamViewPolicyRef): void
    /** A channel view policy stopped accepting new channels; existing leases retain its exact implementation.
     * @param policy - removed view-policy identity.
     * @mode emit
     */
    'team/view-policy-removed'(this: TeamRuntime, policy: TeamViewPolicyRef): void
    /**
     * A policy began intercepting one Team operation.
     * @param policy - registered policy identity.
     * @mode emit
     */
    'team/policy-added'(this: TeamRuntime, policy: TeamPolicyRegistration): void
    /**
     * A policy no longer intercepts future Team operations.
     * @param policy - removed policy identity.
     * @mode emit
     */
    'team/policy-removed'(this: TeamRuntime, policy: TeamPolicyRegistration): void
    /**
     * Authorize one Team operation. An allowing listener must call `next()`;
     * a denial returns a decision without delegating.
     * @param request - provider-validated operation facts.
     * @mode waterfall
     */
    'team/policy'(this: TeamRuntime, request: TeamPolicyRequest, next: () => Promise<TeamPolicyDecision>): Promise<TeamPolicyDecision>
    /**
     * A provider committed a Team-journal record. Listener failure cannot roll
     * back the already committed fact.
     * @param event - committed Team record projection.
     * @mode emit
     */
    'team/changed'(this: TeamRuntime, event: TeamEvent): void
    /**
     * A provider committed a channel WAL record. Listener failure cannot roll
     * back the already committed fact.
     * @param event - identified committed channel record.
     * @mode emit
     */
    'channel/changed'(this: TeamRuntime, event: ChannelEvent): void
  }
}

/** Build one stable registry key from an adapter's frozen identity. */
function adapterKey(adapter: TeamAdapterRef): string {
  return `${adapter.type}\u0000${String(adapter.version)}`
}

/** Render a contained observer failure without allowing diagnostic formatting to throw. */
function renderListenerError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

/** Recursively freeze a detached durable notification before observer delivery. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

/** Create one opaque proof that rejects JSON serialization and structured cloning before it can cross a boundary. */
function createTeamActorProof(): TeamActorProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team actor proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamActorProof
}

/** Validate, detach, and freeze one Team-owned durable notification. */
function immutableTeamEvent(event: TeamEvent): TeamEvent {
  return deepFreeze(teamEventSchema.parse(event))
}

/** Validate, detach, and freeze one identified channel WAL notification. */
function immutableChannelEvent(event: ChannelEvent): ChannelEvent {
  return deepFreeze(channelEventSchema.parse(event))
}

/**
 * Team Service Definition (`ctx.teams`). A provider supplies Team operations;
 * this base class owns adapter/policy registration and post-commit observer
 * dispatch without depending on an Agent, Session, Hub, storage medium, or
 * transport.
 */
export abstract class TeamRuntime extends Service {
  private readonly systemDelegationProofSources = new Map<string, TeamSystemDelegationProofSource>()
  private readonly childRunAuthorizations = new WeakMap<TeamChildRunAuthorization, {
    readonly scope: TeamChildRunScope
    readonly assertCurrent: () => Promise<TeamChildRunScope>
    readonly isLive: () => boolean
    closed: boolean
  }>()
  /** Accepting adapter implementations available to new channel admissions. */
  private readonly adapters = new Map<string, RetainedImplementation<TeamChannelAdapter>>()
  /** Retired adapter implementations retained solely by active channel leases. */
  private readonly retiredAdapters = new Set<RetainedImplementation<TeamChannelAdapter>>()
  /** Accepting view-policy implementations available to new channel admissions. */
  private readonly viewPolicies = new Map<string, RetainedImplementation<TeamViewPolicy>>()
  /** Retired view-policy implementations retained solely by active channel leases. */
  private readonly retiredViewPolicies = new Set<RetainedImplementation<TeamViewPolicy>>()
  private readonly activationActorProofs = new WeakMap<TeamActorProof, ActivationActorProofRecord>()
  private readonly systemActivationProofSources = new Map<string, TeamSystemActivationProofSource>()
  private readonly systemHumanActionProofSources = new Map<string, TeamSystemHumanActionProofSource>()
  private readonly humanActorProofSources = new Map<string, TeamHumanActorProofSource>()
  private readonly systemTaskLeaseProofSources = new Map<string, TeamSystemTaskLeaseProofSource>()
  private readonly systemWorkflowProofSources = new Map<string, TeamSystemWorkflowProofSource>()
  private readonly systemTaskControlProofSources = new Map<string, TeamSystemTaskControlProofSource>()
  private readonly systemRootCreationProofSources = new Map<string, TeamSystemRootCreationProofSource>()
  private readonly systemChildCreationProofSources = new Map<string, TeamSystemChildCreationProofSource>()
  private readonly systemChannelSummaryProofSources = new Map<string, TeamSystemChannelSummaryProofSource>()
  private readonly systemChannelLifecycleProofSources = new Map<string, TeamSystemChannelLifecycleProofSource>()
  private readonly systemWorkspaceAllocationProofSources = new Map<string, TeamSystemWorkspaceAllocationProofSource>()
  private readonly systemArchiveProofSources = new Map<string, TeamSystemArchiveProofSource>()
  private readonly systemTopologyProofSources = new Map<string, TeamSystemTopologyProofSource>()
  private readonly systemSchedulerChannelProofSources = new Map<string, TeamSystemSchedulerChannelProofSource>()
  private readonly systemCancellationCleanupProofSources = new Map<string, TeamSystemCancellationCleanupProofSource>()
  private readonly systemFinalizationCleanupProofSources = new Map<string, TeamSystemFinalizationCleanupProofSource>()
  private readonly childResultProofSources = new Map<string, TeamSystemChildResultProofSource>()
  private readonly humanSinkProofs = new WeakMap<TeamHumanSinkProof, TeamHumanSinkScope>()
  private readonly humanDeliveryProofSources = new Map<string, TeamSystemHumanDeliveryProofSource>()
  private readonly systemFinalReceiptProofSources = new Map<string, TeamSystemFinalReceiptProofSource>()
  private readonly systemEnvelopePostProofSources = new Map<string, TeamSystemEnvelopePostProofSource>()
  private readonly systemClosureProofSources = new Map<string, TeamSystemClosureProofSource>()
  private readonly systemClosureDriverProofSources = new Map<string, TeamSystemClosureDriverProofSource>()
  private readonly systemPhaseProofSources = new Map<string, TeamSystemPhaseProofSource>()
  private readonly systemChannelAdmissionProofSources = new Map<string, TeamSystemChannelAdmissionProofSource>()
  private readonly systemMaintenanceProofSources = new Map<string, TeamSystemMaintenanceProofSource>()
  private readonly systemInterruptProofSources = new Map<string, TeamSystemInterruptProofSource>()
  private readonly systemTaskReviewProofSources = new Map<string, TeamSystemTaskReviewProofSource>()
  private readonly metrics: { -readonly [K in keyof TeamMetricsSnapshot]: TeamMetricsSnapshot[K] } = {
    activeAdmissions: 0,
    pendingDeliveries: 0,
    activeActivations: 0,
    activeTasks: 0,
    stalledTeams: 0,
    replayLag: 0,
    lastTaskLatencyMs: 0,
    lastReceiptLatencyMs: 0,
    taskLatency: emptyTeamLatencyHistogram(),
    receiptLatency: emptyTeamLatencyHistogram(),
    workspaceConflicts: 0,
    teamEvents: 0,
    channelEvents: 0,
    policyDenials: 0,
    adapterFailures: 0,
    deliveryClaims: 0,
    taskAssignments: 0,
    taskRetries: 0,
    teamCompactions: 0,
    channelCompactions: 0,
    checkpointFailures: 0,
    auditProjectionRepairs: 0,
    auditProjectionFailures: 0,
    updatedAt: Date.now(),
  }
  private readonly policies = new Map<TeamPolicyHook, Map<string, TeamPolicy>>()

  constructor(ctx: Context) {
    // An abstract class remains constructable at runtime. Rejecting its direct
    // use makes a configuration error fail at load instead of on a later call.
    if (new.target === TeamRuntime) {
      throw new Error('@clocky/clocky-team is the abstract Team runtime seam; load a Team provider')
    }
    super(ctx, 'teams')
  }

  /** Retain a child operation capability in this exact Team provider instance.
   * @param scope - fully resolved delegation identity and operation.
   * @param assertCurrent - provider-owned parent/world validation outside child serializers.
   * @param isLive - synchronous source-lifetime check used inside parent-to-child serializers.
   * @returns runtime-only capability bound to this provider and complete immutable scope.
   */
  protected createChildRunAuthorization(
    scope: TeamChildRunScope,
    assertCurrent: () => Promise<TeamChildRunScope>,
    isLive: () => boolean,
  ): TeamChildRunAuthorization {
    const record = { scope: deepFreeze(structuredClone(scope)), assertCurrent, isLive, closed: false }
    const value: object = Object.freeze({
      assertCurrent: async (): Promise<TeamChildRunScope> => await this.assertChildRunAuthorization(value as TeamChildRunAuthorization),
      close: (): void => { record.closed = true },
      toJSON(): never { throw new TypeError('Child run authorization is runtime-only') },
    })
    const token = value as TeamChildRunAuthorization
    this.childRunAuthorizations.set(token, record)
    return token
  }

  /** Resolve a retained child capability without taking a parent serializer or performing I/O.
   * @param token - runtime-only capability previously created by this provider.
   * @returns immutable operation facts after live-source validation.
   */
  protected resolveChildRunAuthorization(token: TeamChildRunAuthorization): TeamChildRunScope {
    const record = this.childRunAuthorizations.get(token)
    if (record === undefined || record.closed || !record.isLive()) {
      throw new TeamError('Child run authorization is foreign, closed, or retired', 'TEAM_ACTOR_PROOF_INVALID')
    }
    return record.scope
  }

  /** Validate provider ownership before calling any capability method supplied by a caller.
   * @param token - child operation capability returned by this exact provider.
   * @returns current immutable scope after asynchronous parent and workspace validation.
   */
  async assertChildRunAuthorization(token: TeamChildRunAuthorization): Promise<TeamChildRunScope> {
    const scope = this.resolveChildRunAuthorization(token)
    const record = this.childRunAuthorizations.get(token)
    if (record === undefined) throw new TeamError('Child run authorization disappeared', 'TEAM_ACTOR_PROOF_INVALID')
    const current = await record.assertCurrent()
    if (!isDeepStrictEqual(scope, current)) {
      throw new TeamError('Child run authorization changed its operation or execution root', 'TEAM_ACTOR_PROOF_INVALID')
    }
    return this.resolveChildRunAuthorization(token)
  }

  /** Register the owner of parent delegation operations and live shared-root resolution.
   * @param source - exact runtime proof resolver retained by the delegation Consumer.
   * @returns effect-owned registration disposer.
   */
  registerSystemDelegationProofSource(source: TeamSystemDelegationProofSource): () => void {
    if (source.name !== 'team-delegation') throw new TeamError('Delegation source must be the canonical team-delegation owner', 'TEAM_ACTOR_PROOF_INVALID')
    // oxlint-disable-next-line typescript/no-misused-promises -- preserve the Cordis effect disposer identity.
    return this.ctx.effect(() => {
      if (this.systemDelegationProofSources.has(source.name)) {
        throw new TeamError('Delegation source is already registered', 'TEAM_ACTOR_PROOF_INVALID')
      }
      this.systemDelegationProofSources.set(source.name, source)
      return () => {
        if (this.systemDelegationProofSources.get(source.name) === source) this.systemDelegationProofSources.delete(source.name)
      }
    }, 'teams.registerSystemDelegationProofSource()')
  }

  /** Resolve a live source-owned delegation command without trusting caller-selected actor ids.
   * @param proof - source-retained runtime token.
   * @returns validated immutable source attribution and exact operation scope.
   */
  protected requireSystemDelegationProof(proof: TeamSystemDelegationProof): TeamSystemDelegationProofResolution {
    for (const [sourceName, source] of this.systemDelegationProofSources) {
      let scope: TeamSystemDelegationScope | undefined
      try { scope = source.resolveDelegationProof(proof) } catch (cause: unknown) {
        throw new TeamError('Delegation source could not resolve its proof', 'TEAM_ACTOR_PROOF_INVALID', { cause })
      }
      if (scope === undefined) continue
      const parsed = teamSystemDelegationScopeSchema.safeParse(scope)
      if (!parsed.success) throw new TeamError('Delegation proof scope is invalid', 'TEAM_ACTOR_PROOF_INVALID', { cause: parsed.error })
      return deepFreeze({ sourceName, scope: parsed.data })
    }
    throw new TeamError('Delegation proof is absent, expired, or foreign', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Select a live root resolver without coupling the Hub to a placement or filesystem implementation.
   * @param name - already validated canonical source identity.
   * @returns the currently registered source, or undefined after retirement.
   */
  protected getSystemDelegationProofSource(name: string): TeamSystemDelegationProofSource | undefined {
    return this.systemDelegationProofSources.get(name)
  }

  /**
   * Publish exact service/coordinator endpoints for a reserved child Team.
   * @param _request - live parent authorization, observed child cursor and complete endpoint binding.
   * @returns the durable immutable binding; an identical retry returns its original value.
   */
  bindChildRun(_request: import('./types.ts').TeamChildRunBindRequest): Promise<import('./types.ts').TeamChildRunBinding> {
    return Promise.reject(new TeamError('Child runtime binding is unavailable in this Team provider', 'TEAM_INVALID_ARGUMENT'))
  }

  /** Register a child runtime or parent saga result owner.
   * @param source - Owner retaining its own nonserializable proofs.
   * @returns Effect disposer that invalidates this source.
   */
  registerSystemChildResultProofSource(source: TeamSystemChildResultProofSource): () => void | Promise<void> {
    const registered = Object.freeze({ name: source.name, resolveChildResultProof: source.resolveChildResultProof.bind(source) })
    return this.ctx.effect(() => {
      if (this.childResultProofSources.has(source.name)) throw new TeamError('Child result source is already registered', 'TEAM_INVALID_ARGUMENT')
      this.childResultProofSources.set(source.name, registered)
      return () => { this.childResultProofSources.delete(source.name) }
    })
  }

  /** Resolve child-only authority before any parent or child store mutation.
   * @param proof - Runtime token retained by a current result owner.
   * @returns Validated source and exact operation scope.
   */
  protected requireSystemChildResultProof(proof: TeamSystemChildResultProof): TeamSystemChildResultProofResolution {
    for (const source of this.childResultProofSources.values()) {
      try {
        const value = source.resolveChildResultProof(proof)
        if (value === undefined) continue
        const scope = teamSystemChildResultScopeSchema.parse(value)
        if (scope.kind === 'child-result-missing' && source.name !== 'team-run') break
        return deepFreeze({ sourceName: source.name, scope })
      } catch (cause: unknown) {
        throw new TeamError('Child result source returned invalid authority', 'TEAM_ACTOR_PROOF_INVALID', { cause })
      }
    }
    throw new TeamError('Child result proof is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** Accept a child response into the parent task without settling the parent.
   * @param _request - Exact parent task fence and delegation-owned response selection.
   * @returns Durable parent result admission.
   */
  admitTaskDelegationResult(_request: TeamTaskDelegationResultAdmitRequest): Promise<TeamDelegationResultAdmission> {
    return Promise.reject(new TeamError('Parent result admission is unavailable in this Team provider', 'TEAM_INVALID_ARGUMENT'))
  }
  /** Admit and receipt an already parent-accepted result, then begin child completion.
   * @param _request - Exact child-result proof and child cursor.
   * @returns Current child state; completed is possible only after resource quiescence.
   */
  completeChildTeam(_request: TeamChildResultCommandRequest): Promise<TeamStateSnapshot> {
    return Promise.reject(new TeamError('Child completion is unavailable in this Team provider', 'TEAM_INVALID_ARGUMENT'))
  }
  /** Record child cancellation before releasing runtime resources, including partial bootstrap.
   * @param _request - Provider-owned parent cancellation capability and exact child input.
   * @returns Durable cancellation-admitted child state.
   */
  cancelChildTeam(_request: TeamChildCancelRequest): Promise<TeamStateSnapshot> {
    return Promise.reject(new TeamError('Child cancellation is unavailable in this Team provider', 'TEAM_INVALID_ARGUMENT'))
  }
  /** Record an actual coordinator turn ending without its bound service response.
   * @param _request - Live child runtime observation proof and current child cursor.
   * @returns Unchanged state when a response exists, otherwise a durable missing-result stall.
   */
  recordChildResultMissing(_request: TeamChildResultCommandRequest): Promise<TeamStateSnapshot> {
    return Promise.reject(new TeamError('Child result observations are unavailable in this Team provider', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Open one trusted issuer for activation-bound runtime proofs. The issuer
   * validates and freezes each durable binding; its closure prevents later
   * issuance but does not revoke leases it already returned.
   * @returns an issuer whose leases may be revoked independently.
   */
  openActivationActorProofIssuer(): ActivationActorProofIssuer {
    let closed = false
    return Object.freeze({
      issue: (binding: ActivationBindingSnapshot): TeamActorProofLease => {
        if (closed) {
          throw new TeamError('Activation actor proof issuer is closed', 'TEAM_ACTOR_PROOF_INVALID')
        }
        const proof = createTeamActorProof()
        const record: ActivationActorProofRecord = {
          binding: deepFreeze(activationBindingSnapshotSchema.parse(binding)),
          active: true,
        }
        this.activationActorProofs.set(proof, record)
        let revoked = false
        return Object.freeze({
          proof,
          revoke: (): void => {
            if (revoked) return
            revoked = true
            record.active = false
            this.activationActorProofs.delete(proof)
          },
        })
      },
      close: (): void => {
        closed = true
      },
    })
  }

  /**
   * Resolve a current activation proof issued by this runtime.
   * @param proof - opaque runtime authority supplied by a trusted issuer.
   * @returns the immutable activation binding captured when the proof was issued.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when the proof is forged, foreign, or revoked.
   */
  protected requireActivationActorProof(proof: TeamActorProof): ActivationBindingSnapshot {
    const record = this.activationActorProofs.get(proof)
    if (record === undefined || !record.active) {
      throw new TeamError('Team actor proof is invalid or revoked', 'TEAM_ACTOR_PROOF_INVALID')
    }
    return record.binding
  }

  /**
   * Register one system owner that privately resolves opaque proofs for exact
   * activation lifecycle mutations. Registration is effect-scoped: disposing
   * the contributing fiber immediately makes all of its proofs invalid.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemActivationProofSource(source: TeamSystemActivationProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemActivationProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System activation proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_ACTIVATION_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemActivationProofSource = Object.freeze({
      name: sourceName,
      resolveActivationProof: source.resolveActivationProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemActivationProofSources.has(sourceName)) {
        throw new TeamError(
          `System activation proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_ACTIVATION_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemActivationProofSources.set(sourceName, registered)
      yield () => {
        this.systemActivationProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemActivationProofSource()')
  }

  /**
   * Resolve one current system-owned activation lifecycle proof. A source owns
   * the opaque token in its private map; this runtime validates and freezes
   * the derived scope before a provider authorizes durable effects.
   * @param proof - runtime-only proof supplied by a registered system source.
   * @returns immutable source attribution and the exact activation scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemActivationProof(proof: TeamSystemActivationProof): TeamSystemActivationProofResolution {
    for (const [sourceName, source] of this.systemActivationProofSources) {
      let scope: ReturnType<TeamSystemActivationProofSource['resolveActivationProof']>
      try {
        scope = source.resolveActivationProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System activation proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemActivationProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System activation proof source '${sourceName}' returned an invalid activation scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System activation proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one Host owner that privately resolves opaque proofs for exact
   * approval or question action mutations. Registration is effect-scoped:
   * disposing the contributing fiber immediately makes all proofs invalid.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemHumanActionProofSource(source: TeamSystemHumanActionProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemHumanActionProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System human-action proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_HUMAN_ACTION_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemHumanActionProofSource = Object.freeze({
      name: sourceName,
      resolveHumanActionProof: source.resolveHumanActionProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemHumanActionProofSources.has(sourceName)) {
        throw new TeamError(
          `System human-action proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_HUMAN_ACTION_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemHumanActionProofSources.set(sourceName, registered)
      yield () => {
        this.systemHumanActionProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemHumanActionProofSource()')
  }

  /**
   * Resolve one current Host-owned human-action proof. The source owns the
   * opaque token in its private map; this runtime validates and freezes the
   * derived scope before a provider may append or resolve an action.
   * @param proof - runtime-only proof supplied by a registered Host source.
   * @returns immutable source attribution and the exact human-action scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemHumanActionProof(proof: TeamSystemHumanActionProof): TeamSystemHumanActionProofResolution {
    for (const [sourceName, source] of this.systemHumanActionProofSources) {
      let scope: ReturnType<TeamSystemHumanActionProofSource['resolveHumanActionProof']>
      try {
        scope = source.resolveHumanActionProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System human-action proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemHumanActionProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System human-action proof source '${sourceName}' returned an invalid action scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System human-action proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one authenticated-human binder that privately resolves opaque
   * proofs for exact product Team mutations. Registration is effect-scoped:
   * disposal immediately invalidates every outstanding proof from this source.
   * @param source - named resolver that owns human proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerHumanActorProofSource(source: TeamHumanActorProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamHumanActorProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'Human actor proof source name must be non-empty without surrounding whitespace',
        'TEAM_HUMAN_ACTOR_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamHumanActorProofSource = Object.freeze({
      name: sourceName,
      resolveHumanActorProof: source.resolveHumanActorProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.humanActorProofSources.has(sourceName)) {
        throw new TeamError(
          `Human actor proof source '${sourceName}' is already registered`,
          'TEAM_HUMAN_ACTOR_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.humanActorProofSources.set(sourceName, registered)
      yield () => {
        this.humanActorProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerHumanActorProofSource()')
  }

  /**
   * Resolve one current authenticated-human proof. The source owns the opaque
   * token; this runtime validates and freezes its exact participant, payload,
   * and optimistic-concurrency scope before a provider accepts a mutation.
   * @param proof - runtime-only proof supplied by a registered human binder.
   * @returns immutable source attribution and the exact human mutation scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireHumanActorProof(proof: TeamHumanActorProof): TeamHumanActorProofResolution {
    for (const [sourceName, source] of this.humanActorProofSources) {
      let scope: ReturnType<TeamHumanActorProofSource['resolveHumanActorProof']>
      try {
        scope = source.resolveHumanActorProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `Human actor proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamHumanActorProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `Human actor proof source '${sourceName}' returned an invalid human scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('Human actor proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register a named endpoint or expiry owner and revoke its proofs with its effect lifetime.
   * @param source - owner retaining exact runtime operation scopes.
   * @returns an HMR-safe disposer for this registration.
   */
  registerSystemChannelAdmissionProofSource(source: TeamSystemChannelAdmissionProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemChannelAdmissionProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System channel-admission proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_CHANNEL_ADMISSION_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemChannelAdmissionProofSource = Object.freeze({
      name: sourceName,
      resolveChannelAdmissionProof: source.resolveChannelAdmissionProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemChannelAdmissionProofSources.has(sourceName)) {
        throw new TeamError(
          `System channel-admission proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_CHANNEL_ADMISSION_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemChannelAdmissionProofSources.set(sourceName, registered)
      yield () => {
        this.systemChannelAdmissionProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemChannelAdmissionProofSource()')
  }

  /**
   * Resolve one current system-owned Team-channel-admission proof. A source owns the
   * opaque token in its private WeakMap; this runtime validates and freezes
   * the derived scope before a provider commits endpoint consent or invitation expiry.
   * @param proof - runtime-only proof supplied by a registered system source.
   * @returns immutable source attribution and the exact channel-admission scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemChannelAdmissionProof(proof: TeamSystemChannelAdmissionProof): TeamSystemChannelAdmissionProofResolution {
    for (const [sourceName, source] of this.systemChannelAdmissionProofSources) {
      let scope: ReturnType<TeamSystemChannelAdmissionProofSource['resolveChannelAdmissionProof']>
      try {
        scope = source.resolveChannelAdmissionProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System channel-admission proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemChannelAdmissionProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System channel-admission proof source '${sourceName}' returned an invalid channel-admission scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System channel-admission proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one scheduler owner that privately resolves opaque proofs for
   * exact task assignment and elapsed lease expiry. Registration is
   * effect-scoped: disposing the contributing fiber immediately invalidates
   * every proof retained by that source.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemTaskLeaseProofSource(source: TeamSystemTaskLeaseProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemTaskLeaseProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System task-lease proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_TASK_LEASE_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemTaskLeaseProofSource = Object.freeze({
      name: sourceName,
      resolveTaskLeaseProof: source.resolveTaskLeaseProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemTaskLeaseProofSources.has(sourceName)) {
        throw new TeamError(
          `System task-lease proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_TASK_LEASE_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemTaskLeaseProofSources.set(sourceName, registered)
      yield () => {
        this.systemTaskLeaseProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemTaskLeaseProofSource()')
  }

  /**
   * Resolve one current scheduler-owned task-lease proof. The source owns the
   * opaque token in its private map; this runtime validates and freezes the
   * derived scope before a provider assigns or expires a lease.
   * @param proof - runtime-only proof supplied by a registered scheduler source.
   * @returns immutable source attribution and the exact task-lease scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemTaskLeaseProof(proof: TeamSystemTaskLeaseProof): TeamSystemTaskLeaseProofResolution {
    for (const [sourceName, source] of this.systemTaskLeaseProofSources) {
      let scope: ReturnType<TeamSystemTaskLeaseProofSource['resolveTaskLeaseProof']>
      try {
        scope = source.resolveTaskLeaseProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System task-lease proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemTaskLeaseProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System task-lease proof source '${sourceName}' returned an invalid lease scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System task-lease proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one workflow compiler owner that privately resolves opaque proofs
   * for exact workflow channel openings, bindings, phase transitions, and
   * orphan-channel cleanup. Registration is effect-scoped: disposing the
   * contributing fiber immediately invalidates every proof retained by it.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemWorkflowProofSource(source: TeamSystemWorkflowProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemWorkflowProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System workflow proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_WORKFLOW_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemWorkflowProofSource = Object.freeze({
      name: sourceName,
      resolveWorkflowProof: source.resolveWorkflowProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemWorkflowProofSources.has(sourceName)) {
        throw new TeamError(
          `System workflow proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_WORKFLOW_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemWorkflowProofSources.set(sourceName, registered)
      yield () => {
        this.systemWorkflowProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemWorkflowProofSource()')
  }

  /**
   * Resolve one current workflow-compiler proof. The source owns the opaque
   * token in its private map; this runtime validates and freezes the derived
   * exact scope before a provider opens, binds, transitions, or cleans up a
   * workflow channel.
   * @param proof - runtime-only proof supplied by a registered workflow compiler source.
   * @returns immutable source attribution and the exact workflow scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemWorkflowProof(proof: TeamSystemWorkflowProof): TeamSystemWorkflowProofResolution {
    for (const [sourceName, source] of this.systemWorkflowProofSources) {
      let scope: ReturnType<TeamSystemWorkflowProofSource['resolveWorkflowProof']>
      try {
        scope = source.resolveWorkflowProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System workflow proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemWorkflowProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System workflow proof source '${sourceName}' returned an invalid workflow scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System workflow proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one TeamRun owner that privately resolves opaque proofs for exact
   * default-worker owner proposals and current-coordinator cancellations.
   * Registration is effect-scoped: disposing the contributing fiber
   * immediately invalidates every proof retained by it.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemTaskControlProofSource(source: TeamSystemTaskControlProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemTaskControlProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System task-control proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_TASK_CONTROL_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemTaskControlProofSource = Object.freeze({
      name: sourceName,
      resolveTaskControlProof: source.resolveTaskControlProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemTaskControlProofSources.has(sourceName)) {
        throw new TeamError(
          `System task-control proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_TASK_CONTROL_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemTaskControlProofSources.set(sourceName, registered)
      yield () => {
        this.systemTaskControlProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemTaskControlProofSource()')
  }

  /**
   * Resolve one current TeamRun default-worker task-control proof. The source
   * owns the opaque token in its private map; this runtime validates and
   * freezes the derived exact scope before a provider proposes or cancels a
   * task.
   * @param proof - runtime-only proof supplied by a registered TeamRun task-control source.
   * @returns immutable source attribution and the exact task-control scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemTaskControlProof(proof: TeamSystemTaskControlProof): TeamSystemTaskControlProofResolution {
    for (const [sourceName, source] of this.systemTaskControlProofSources) {
      let scope: ReturnType<TeamSystemTaskControlProofSource['resolveTaskControlProof']>
      try {
        scope = source.resolveTaskControlProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System task-control proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemTaskControlProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System task-control proof source '${sourceName}' returned an invalid task-control scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System task-control proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one owner that privately resolves opaque proofs for exact root
   * Team creation. Registration is effect-scoped: disposing the contributing
   * fiber immediately invalidates every proof retained by it.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemRootCreationProofSource(source: TeamSystemRootCreationProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemRootCreationProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System root-creation proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_ROOT_CREATION_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemRootCreationProofSource = Object.freeze({
      name: sourceName,
      resolveRootCreationProof: source.resolveRootCreationProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemRootCreationProofSources.has(sourceName)) {
        throw new TeamError(
          `System root-creation proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_ROOT_CREATION_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemRootCreationProofSources.set(sourceName, registered)
      yield () => {
        this.systemRootCreationProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemRootCreationProofSource()')
  }

  /**
   * Resolve one current root-Team creation proof. The source owns the opaque
   * token in its private map; this runtime validates and freezes the exact
   * root payload before a provider admits a new Team journal.
   * @param proof - runtime-only proof supplied by a registered root-creation source.
   * @returns immutable source attribution and the exact root-creation scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemRootCreationProof(
    proof: TeamSystemRootCreationProof,
  ): TeamSystemRootCreationProofResolution {
    for (const [sourceName, source] of this.systemRootCreationProofSources) {
      let scope: ReturnType<TeamSystemRootCreationProofSource['resolveRootCreationProof']>
      try {
        scope = source.resolveRootCreationProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System root-creation proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemRootCreationProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System root-creation proof source '${sourceName}' returned an invalid root-creation scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System root-creation proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one owner that privately resolves opaque proofs for exact child
   * Team creation. No shipped product composition registers this source until
   * parent-task delegation has an owning consumer.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemChildCreationProofSource(source: TeamSystemChildCreationProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemChildCreationProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System child-creation proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_CHILD_CREATION_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemChildCreationProofSource = Object.freeze({
      name: sourceName,
      resolveChildCreationProof: source.resolveChildCreationProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemChildCreationProofSources.has(sourceName)) {
        throw new TeamError(
          `System child-creation proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_CHILD_CREATION_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemChildCreationProofSources.set(sourceName, registered)
      yield () => {
        this.systemChildCreationProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemChildCreationProofSource()')
  }

  /**
   * Resolve one current nested-Team creation proof. The source owns the opaque
   * token in its private map; this runtime validates and freezes the complete
   * child payload and parent cursor before provider admission.
   * @param proof - runtime-only proof supplied by a registered child-creation source.
   * @returns immutable source attribution and the exact child creation scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemChildCreationProof(
    proof: TeamSystemChildCreationProof,
  ): TeamSystemChildCreationProofResolution {
    for (const [sourceName, source] of this.systemChildCreationProofSources) {
      let scope: ReturnType<TeamSystemChildCreationProofSource['resolveChildCreationProof']>
      try {
        scope = source.resolveChildCreationProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System child-creation proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemChildCreationProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System child-creation proof source '${sourceName}' returned an invalid child-creation scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System child-creation proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one owner that privately resolves opaque proofs for exact durable
   * channel summary appends. No shipped product composition registers this
   * source until a summarization consumer owns the operation.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemChannelSummaryProofSource(source: TeamSystemChannelSummaryProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemChannelSummaryProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System channel-summary proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_CHANNEL_SUMMARY_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemChannelSummaryProofSource = Object.freeze({
      name: sourceName,
      resolveChannelSummaryProof: source.resolveChannelSummaryProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemChannelSummaryProofSources.has(sourceName)) {
        throw new TeamError(
          `System channel-summary proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_CHANNEL_SUMMARY_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemChannelSummaryProofSources.set(sourceName, registered)
      yield () => {
        this.systemChannelSummaryProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemChannelSummaryProofSource()')
  }

  /**
   * Resolve one current channel-summary proof. The source owns the opaque token
   * in its private map; this runtime validates and freezes the complete summary
   * input before provider admission.
   * @param proof - runtime-only proof supplied by a registered summary source.
   * @returns immutable source attribution and the exact channel summary scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemChannelSummaryProof(
    proof: TeamSystemChannelSummaryProof,
  ): TeamSystemChannelSummaryProofResolution {
    for (const [sourceName, source] of this.systemChannelSummaryProofSources) {
      let scope: ReturnType<TeamSystemChannelSummaryProofSource['resolveChannelSummaryProof']>
      try {
        scope = source.resolveChannelSummaryProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System channel-summary proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemChannelSummaryProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System channel-summary proof source '${sourceName}' returned an invalid channel-summary scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System channel-summary proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one owner that privately resolves opaque proofs for exact generic
   * channel openings and closures. Shipped product compositions register no
   * generic lifecycle source until an owning consumer needs this route.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemChannelLifecycleProofSource(source: TeamSystemChannelLifecycleProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemChannelLifecycleProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System channel-lifecycle proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_CHANNEL_LIFECYCLE_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemChannelLifecycleProofSource = Object.freeze({
      name: sourceName,
      resolveChannelLifecycleProof: source.resolveChannelLifecycleProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemChannelLifecycleProofSources.has(sourceName)) {
        throw new TeamError(
          `System channel-lifecycle proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_CHANNEL_LIFECYCLE_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemChannelLifecycleProofSources.set(sourceName, registered)
      yield () => {
        this.systemChannelLifecycleProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemChannelLifecycleProofSource()')
  }

  protected requireSystemChannelLifecycleProof(proof: TeamSystemChannelLifecycleProof): TeamSystemChannelLifecycleProofResolution {
    for (const [sourceName, source] of this.systemChannelLifecycleProofSources) {
      let scope: ReturnType<TeamSystemChannelLifecycleProofSource['resolveChannelLifecycleProof']>
      try {
        scope = source.resolveChannelLifecycleProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System channel-lifecycle proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemChannelLifecycleProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System channel-lifecycle proof source '${sourceName}' returned an invalid channel-lifecycle scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System channel-lifecycle proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one owner that privately resolves opaque proofs for exact
   * workspace allocation bindings and cleanup transitions.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemWorkspaceAllocationProofSource(source: TeamSystemWorkspaceAllocationProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemWorkspaceAllocationProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System workspace-allocation proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_WORKSPACE_ALLOCATION_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemWorkspaceAllocationProofSource = Object.freeze({
      name: sourceName,
      resolveWorkspaceAllocationProof: source.resolveWorkspaceAllocationProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemWorkspaceAllocationProofSources.has(sourceName)) {
        throw new TeamError(
          `System workspace-allocation proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_WORKSPACE_ALLOCATION_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemWorkspaceAllocationProofSources.set(sourceName, registered)
      yield () => {
        this.systemWorkspaceAllocationProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemWorkspaceAllocationProofSource()')
  }

  /** Resolve one current source-owned workspace allocation proof. */
  protected requireSystemWorkspaceAllocationProof(
    proof: TeamSystemWorkspaceAllocationProof,
  ): TeamSystemWorkspaceAllocationProofResolution {
    for (const [sourceName, source] of this.systemWorkspaceAllocationProofSources) {
      let scope: ReturnType<TeamSystemWorkspaceAllocationProofSource['resolveWorkspaceAllocationProof']>
      try {
        scope = source.resolveWorkspaceAllocationProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System workspace-allocation proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemWorkspaceAllocationProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System workspace-allocation proof source '${sourceName}' returned an invalid workspace allocation scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System workspace-allocation proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one TeamRun owner that privately resolves opaque proofs for exact
   * terminal Team archive. Registration is effect-scoped: disposing the
   * contributing fiber immediately invalidates every proof retained by it.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemArchiveProofSource(source: TeamSystemArchiveProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemArchiveProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System archive proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_ARCHIVE_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemArchiveProofSource = Object.freeze({
      name: sourceName,
      resolveArchiveProof: source.resolveArchiveProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemArchiveProofSources.has(sourceName)) {
        throw new TeamError(
          `System archive proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_ARCHIVE_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemArchiveProofSources.set(sourceName, registered)
      yield () => {
        this.systemArchiveProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemArchiveProofSource()')
  }

  /**
   * Resolve one current terminal-Team archive proof. The source owns the
   * opaque token in its private map; this runtime validates and freezes the
   * exact Team/cursor scope before a provider admits an archive marker.
   * @param proof - runtime-only proof supplied by a registered archive source.
   * @returns immutable source attribution and the exact terminal archive scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemArchiveProof(proof: TeamSystemArchiveProof): TeamSystemArchiveProofResolution {
    for (const [sourceName, source] of this.systemArchiveProofSources) {
      let scope: ReturnType<TeamSystemArchiveProofSource['resolveArchiveProof']>
      try {
        scope = source.resolveArchiveProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System archive proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemArchiveProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System archive proof source '${sourceName}' returned an invalid archive scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System archive proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one TeamRun owner that privately resolves opaque proofs for exact
   * bootstrap, worker, and reviewer topology mutations. Registration is
   * effect-scoped: disposing the contributing fiber immediately invalidates
   * every proof retained by it.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemTopologyProofSource(source: TeamSystemTopologyProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemTopologyProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System topology proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_TOPOLOGY_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemTopologyProofSource = Object.freeze({
      name: sourceName,
      resolveTopologyProof: source.resolveTopologyProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemTopologyProofSources.has(sourceName)) {
        throw new TeamError(
          `System topology proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_TOPOLOGY_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemTopologyProofSources.set(sourceName, registered)
      yield () => {
        this.systemTopologyProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemTopologyProofSource()')
  }

  /**
   * Resolve one current TeamRun topology proof. The source owns the opaque
   * token in its private map; this runtime validates and freezes the derived
   * exact scope before a provider mutates participant membership or opens the
   * default channel.
   * @param proof - runtime-only proof supplied by a registered topology source.
   * @returns immutable source attribution and the exact topology scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemTopologyProof(proof: TeamSystemTopologyProof): TeamSystemTopologyProofResolution {
    for (const [sourceName, source] of this.systemTopologyProofSources) {
      let scope: ReturnType<TeamSystemTopologyProofSource['resolveTopologyProof']>
      try {
        scope = source.resolveTopologyProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System topology proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemTopologyProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System topology proof source '${sourceName}' returned an invalid topology scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System topology proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one scheduler owner that privately resolves opaque proofs for exact
   * review and task-assignment channel lifecycle mutations. Registration is
   * effect-scoped: disposing the contributing fiber immediately invalidates
   * every proof retained by it.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemSchedulerChannelProofSource(source: TeamSystemSchedulerChannelProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemSchedulerChannelProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System scheduler channel proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_SCHEDULER_CHANNEL_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemSchedulerChannelProofSource = Object.freeze({
      name: sourceName,
      resolveSchedulerChannelProof: source.resolveSchedulerChannelProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemSchedulerChannelProofSources.has(sourceName)) {
        throw new TeamError(
          `System scheduler channel proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_SCHEDULER_CHANNEL_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemSchedulerChannelProofSources.set(sourceName, registered)
      yield () => {
        this.systemSchedulerChannelProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemSchedulerChannelProofSource()')
  }

  /**
   * Resolve one current scheduler channel proof. The source owns the opaque
   * token in its private map; this runtime validates and freezes the exact
   * scope before a provider opens or closes a scheduler-owned channel.
   * @param proof - runtime-only proof supplied by a registered scheduler channel source.
   * @returns immutable source attribution and the exact scheduler channel scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemSchedulerChannelProof(
    proof: TeamSystemSchedulerChannelProof,
  ): TeamSystemSchedulerChannelProofResolution {
    for (const [sourceName, source] of this.systemSchedulerChannelProofSources) {
      let scope: ReturnType<TeamSystemSchedulerChannelProofSource['resolveSchedulerChannelProof']>
      try {
        scope = source.resolveSchedulerChannelProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System scheduler channel proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemSchedulerChannelProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System scheduler channel proof source '${sourceName}' returned an invalid channel scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System scheduler channel proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one TeamRun owner that privately resolves opaque proofs for exact
   * post-release cleanup after a durable cancellation intent. Registration is
   * effect-scoped: disposing the contributing fiber immediately invalidates
   * every proof retained by it.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemCancellationCleanupProofSource(source: TeamSystemCancellationCleanupProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemCancellationCleanupProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System cancellation-cleanup proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_CANCELLATION_CLEANUP_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemCancellationCleanupProofSource = Object.freeze({
      name: sourceName,
      resolveCancellationCleanupProof: source.resolveCancellationCleanupProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemCancellationCleanupProofSources.has(sourceName)) {
        throw new TeamError(
          `System cancellation-cleanup proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_CANCELLATION_CLEANUP_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemCancellationCleanupProofSources.set(sourceName, registered)
      yield () => {
        this.systemCancellationCleanupProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemCancellationCleanupProofSource()')
  }

  /**
   * Resolve one current TeamRun cancellation-cleanup proof. The source owns
   * the opaque token in its private map; this runtime validates and freezes
   * the derived exact scope before a provider cancels a pending task or closes
   * an active channel.
   * @param proof - runtime-only proof supplied by a registered cancellation-cleanup source.
   * @returns immutable source attribution and the exact cleanup scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemCancellationCleanupProof(
    proof: TeamSystemCancellationCleanupProof,
  ): TeamSystemCancellationCleanupProofResolution {
    for (const [sourceName, source] of this.systemCancellationCleanupProofSources) {
      let scope: ReturnType<TeamSystemCancellationCleanupProofSource['resolveCancellationCleanupProof']>
      try {
        scope = source.resolveCancellationCleanupProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System cancellation-cleanup proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemCancellationCleanupProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System cancellation-cleanup proof source '${sourceName}' returned an invalid cleanup scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System cancellation-cleanup proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one TeamRun owner that privately resolves opaque proofs for exact
   * post-release channel cleanup after a durable human-receipted final result.
   * Registration is effect-scoped: disposal immediately invalidates every proof.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemFinalizationCleanupProofSource(source: TeamSystemFinalizationCleanupProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemFinalizationCleanupProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System finalization-cleanup proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_FINALIZATION_CLEANUP_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemFinalizationCleanupProofSource = Object.freeze({
      name: sourceName,
      resolveFinalizationCleanupProof: source.resolveFinalizationCleanupProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemFinalizationCleanupProofSources.has(sourceName)) {
        throw new TeamError(
          `System finalization-cleanup proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_FINALIZATION_CLEANUP_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemFinalizationCleanupProofSources.set(sourceName, registered)
      yield () => {
        this.systemFinalizationCleanupProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemFinalizationCleanupProofSource()')
  }

  /**
   * Resolve one current TeamRun finalization-cleanup proof. The source owns the
   * opaque token in its private map; this runtime validates and freezes the
   * exact scope before a provider closes an active channel.
   * @param proof - runtime-only proof supplied by a registered finalization-cleanup source.
   * @returns immutable source attribution and the exact finalization-cleanup scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemFinalizationCleanupProof(
    proof: TeamSystemFinalizationCleanupProof,
  ): TeamSystemFinalizationCleanupProofResolution {
    for (const [sourceName, source] of this.systemFinalizationCleanupProofSources) {
      let scope: ReturnType<TeamSystemFinalizationCleanupProofSource['resolveFinalizationCleanupProof']>
      try {
        scope = source.resolveFinalizationCleanupProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System finalization-cleanup proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemFinalizationCleanupProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System finalization-cleanup proof source '${sourceName}' returned an invalid cleanup scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System finalization-cleanup proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one system owner that privately resolves opaque proofs for exact
   * coordinator-final human receipts. Registration is effect-scoped: disposing
   * the contributing fiber immediately makes all of its proofs invalid.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemFinalReceiptProofSource(source: TeamSystemFinalReceiptProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemFinalReceiptProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System final-receipt proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_FINAL_RECEIPT_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemFinalReceiptProofSource = Object.freeze({
      name: sourceName,
      resolveFinalReceiptProof: source.resolveFinalReceiptProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemFinalReceiptProofSources.has(sourceName)) {
        throw new TeamError(
          `System final-receipt proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_FINAL_RECEIPT_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemFinalReceiptProofSources.set(sourceName, registered)
      yield () => {
        this.systemFinalReceiptProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemFinalReceiptProofSource()')
  }

  /**
   * Resolve one current system-owned final-receipt proof. A source owns the
   * opaque token in its private WeakMap; this runtime validates and freezes
   * the derived durable scope before a provider can authorize or append.
   * @param proof - runtime-only proof supplied by a registered system source.
   * @returns immutable source attribution and the exact receipt scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemFinalReceiptProof(proof: TeamSystemFinalReceiptProof): TeamSystemFinalReceiptProofResolution {
    for (const [sourceName, source] of this.systemFinalReceiptProofSources) {
      let scope: ReturnType<TeamSystemFinalReceiptProofSource['resolveFinalReceiptProof']>
      try {
        scope = source.resolveFinalReceiptProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System final-receipt proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemFinalReceiptProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System final-receipt proof source '${sourceName}' returned an invalid receipt scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System final-receipt proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one system owner that privately resolves opaque proofs for exact
   * ordinary Envelope admissions. Registration is effect-scoped: disposing the
   * contributing fiber immediately makes all of its proofs invalid.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemEnvelopePostProofSource(source: TeamSystemEnvelopePostProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemEnvelopePostProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System Envelope-post proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_ENVELOPE_POST_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemEnvelopePostProofSource = Object.freeze({
      name: sourceName,
      resolveEnvelopePostProof: source.resolveEnvelopePostProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemEnvelopePostProofSources.has(sourceName)) {
        throw new TeamError(
          `System Envelope-post proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_ENVELOPE_POST_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemEnvelopePostProofSources.set(sourceName, registered)
      yield () => {
        this.systemEnvelopePostProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemEnvelopePostProofSource()')
  }

  /**
   * Resolve one current system-owned ordinary Envelope-post proof. A source
   * owns the opaque token in its private WeakMap; this runtime validates and
   * freezes the derived durable scope before a provider can admit a draft.
   * @param proof - runtime-only proof supplied by a registered system source.
   * @returns immutable source attribution and the exact Envelope-post scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemEnvelopePostProof(proof: TeamSystemEnvelopePostProof): TeamSystemEnvelopePostProofResolution {
    for (const [sourceName, source] of this.systemEnvelopePostProofSources) {
      let scope: ReturnType<TeamSystemEnvelopePostProofSource['resolveEnvelopePostProof']>
      try {
        scope = source.resolveEnvelopePostProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System Envelope-post proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemEnvelopePostProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System Envelope-post proof source '${sourceName}' returned an invalid post scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System Envelope-post proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one system owner that privately resolves opaque proofs for exact
   * durable task-review recovery. Registration is effect-scoped: disposing the
   * contributing fiber immediately makes all of its proofs invalid.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemTaskReviewProofSource(source: TeamSystemTaskReviewProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemTaskReviewProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System task-review proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_TASK_REVIEW_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemTaskReviewProofSource = Object.freeze({
      name: sourceName,
      resolveTaskReviewProof: source.resolveTaskReviewProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemTaskReviewProofSources.has(sourceName)) {
        throw new TeamError(
          `System task-review proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_TASK_REVIEW_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemTaskReviewProofSources.set(sourceName, registered)
      yield () => {
        this.systemTaskReviewProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemTaskReviewProofSource()')
  }

  /**
   * Resolve one current system-owned task-review recovery proof. A source owns
   * the opaque token in its private WeakMap; this runtime validates and freezes
   * the derived durable scope before a provider resolves the review.
   * @param proof - runtime-only proof supplied by a registered system source.
   * @returns immutable source attribution and the exact task-review scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemTaskReviewProof(proof: TeamSystemTaskReviewProof): TeamSystemTaskReviewProofResolution {
    for (const [sourceName, source] of this.systemTaskReviewProofSources) {
      let scope: ReturnType<TeamSystemTaskReviewProofSource['resolveTaskReviewProof']>
      try {
        scope = source.resolveTaskReviewProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System task-review proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemTaskReviewProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System task-review proof source '${sourceName}' returned an invalid review scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System task-review proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one system owner that privately resolves opaque proofs for exact
   * Team closure commands. Registration is effect-scoped: disposing the
   * contributing fiber immediately makes all of its proofs invalid.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemClosureProofSource(source: TeamSystemClosureProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemClosureProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System closure proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_CLOSURE_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemClosureProofSource = Object.freeze({
      name: sourceName,
      resolveClosureProof: source.resolveClosureProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemClosureProofSources.has(sourceName)) {
        throw new TeamError(
          `System closure proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_CLOSURE_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemClosureProofSources.set(sourceName, registered)
      yield () => {
        this.systemClosureProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemClosureProofSource()')
  }

  /**
   * Resolve one current system-owned Team-closure proof. A source owns the
   * opaque token in its private WeakMap; this runtime validates and freezes
   * the derived durable scope before a provider accepts a closure command.
   * @param proof - runtime-only proof supplied by a registered system source.
   * @returns immutable source attribution and the exact Team-closure scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemClosureProof(proof: TeamSystemClosureProof): TeamSystemClosureProofResolution {
    for (const [sourceName, source] of this.systemClosureProofSources) {
      let scope: ReturnType<TeamSystemClosureProofSource['resolveClosureProof']>
      try {
        scope = source.resolveClosureProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System closure proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemClosureProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System closure proof source '${sourceName}' returned an invalid closure scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System closure proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one closure driver that privately resolves opaque proofs for
   * exact already-durable lifecycle continuation passes.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemClosureDriverProofSource(source: TeamSystemClosureDriverProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemClosureDriverProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System closure-driver proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_CLOSURE_DRIVER_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemClosureDriverProofSource = Object.freeze({
      name: sourceName,
      resolveClosureDriverProof: source.resolveClosureDriverProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemClosureDriverProofSources.has(sourceName)) {
        throw new TeamError(
          `System closure-driver proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_CLOSURE_DRIVER_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemClosureDriverProofSources.set(sourceName, registered)
      yield () => {
        this.systemClosureDriverProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemClosureDriverProofSource()')
  }

  /**
   * Resolve one current closure-driver proof. A source owns the opaque token
   * in private memory; this runtime validates and freezes its durable scope
   * before a provider continues lifecycle settlement.
   * @param proof - runtime-only proof supplied by a registered closure driver.
   * @returns immutable source attribution and the exact durable recovery scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  requireSystemClosureDriverProof(
    proof: TeamSystemClosureDriverProof,
  ): TeamSystemClosureDriverProofResolution {
    for (const [sourceName, source] of this.systemClosureDriverProofSources) {
      let scope: ReturnType<TeamSystemClosureDriverProofSource['resolveClosureDriverProof']>
      try {
        scope = source.resolveClosureDriverProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System closure-driver proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemClosureDriverProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System closure-driver proof source '${sourceName}' returned an invalid recovery scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System closure-driver proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one system owner that privately resolves opaque proofs for exact
   * Team phase transitions. Registration is effect-scoped: disposing the
   * contributing fiber immediately makes all of its proofs invalid.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemPhaseProofSource(source: TeamSystemPhaseProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemPhaseProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System phase proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_PHASE_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemPhaseProofSource = Object.freeze({
      name: sourceName,
      resolvePhaseProof: source.resolvePhaseProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemPhaseProofSources.has(sourceName)) {
        throw new TeamError(
          `System phase proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_PHASE_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemPhaseProofSources.set(sourceName, registered)
      yield () => {
        this.systemPhaseProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemPhaseProofSource()')
  }

  /**
   * Resolve one current system-owned Team-phase proof. A source owns the
   * opaque token in its private WeakMap; this runtime validates and freezes
   * the derived durable scope before a provider transitions its Team.
   * @param proof - runtime-only proof supplied by a registered system source.
   * @returns immutable source attribution and the exact Team-phase scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemPhaseProof(proof: TeamSystemPhaseProof): TeamSystemPhaseProofResolution {
    for (const [sourceName, source] of this.systemPhaseProofSources) {
      let scope: ReturnType<TeamSystemPhaseProofSource['resolvePhaseProof']>
      try {
        scope = source.resolvePhaseProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System phase proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemPhaseProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System phase proof source '${sourceName}' returned an invalid phase scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System phase proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one system owner that privately resolves opaque proofs for exact
   * destructive Team-maintenance operations. Registration is effect-scoped:
   * disposing the contributing fiber immediately makes all of its proofs invalid.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemMaintenanceProofSource(source: TeamSystemMaintenanceProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemMaintenanceProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System maintenance proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_MAINTENANCE_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemMaintenanceProofSource = Object.freeze({
      name: sourceName,
      resolveMaintenanceProof: source.resolveMaintenanceProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemMaintenanceProofSources.has(sourceName)) {
        throw new TeamError(
          `System maintenance proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_MAINTENANCE_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemMaintenanceProofSources.set(sourceName, registered)
      yield () => {
        this.systemMaintenanceProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemMaintenanceProofSource()')
  }

  /**
   * Resolve one current system-owned Team-maintenance proof. A source owns the
   * opaque token in its private WeakMap; this runtime validates and freezes
   * the derived scope before a provider removes a journal prefix.
   * @param proof - runtime-only proof supplied by a registered system source.
   * @returns immutable source attribution and the exact maintenance scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemMaintenanceProof(proof: TeamSystemMaintenanceProof): TeamSystemMaintenanceProofResolution {
    for (const [sourceName, source] of this.systemMaintenanceProofSources) {
      let scope: ReturnType<TeamSystemMaintenanceProofSource['resolveMaintenanceProof']>
      try {
        scope = source.resolveMaintenanceProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System maintenance proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemMaintenanceProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System maintenance proof source '${sourceName}' returned an invalid maintenance scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System maintenance proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register one system owner that privately resolves opaque proofs for exact
   * TeamRun human-to-coordinator soft-interrupt requests. Registration is
   * effect-scoped: disposing the contributing fiber immediately makes all of
   * its proofs invalid.
   * @param source - named resolver that owns proof construction and lifetime.
   * @returns an HMR-safe disposer that removes exactly this source.
   * @throws {@link TeamError} when the source name is invalid or already registered.
   */
  registerSystemInterruptProofSource(source: TeamSystemInterruptProofSource): () => void {
    let sourceName: string
    try {
      sourceName = teamSystemInterruptProofSourceNameSchema.parse(source.name)
    } catch (cause: unknown) {
      throw new TeamError(
        'System interrupt proof source name must be non-empty without surrounding whitespace',
        'TEAM_SYSTEM_INTERRUPT_PROOF_SOURCE_INVALID',
        { cause },
      )
    }
    const registered: TeamSystemInterruptProofSource = Object.freeze({
      name: sourceName,
      resolveInterruptProof: source.resolveInterruptProof.bind(source),
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.systemInterruptProofSources.has(sourceName)) {
        throw new TeamError(
          `System interrupt proof source '${sourceName}' is already registered`,
          'TEAM_SYSTEM_INTERRUPT_PROOF_SOURCE_DUPLICATE',
        )
      }
      this.systemInterruptProofSources.set(sourceName, registered)
      yield () => {
        this.systemInterruptProofSources.delete(sourceName)
      }
    }.bind(this), 'teams.registerSystemInterruptProofSource()')
  }

  /**
   * Resolve one current system-owned Team-interrupt proof. A source owns the
   * opaque token in its private WeakMap; this runtime validates and freezes
   * the derived scope before a provider requests a soft interrupt.
   * @param proof - runtime-only proof supplied by a registered system source.
   * @returns immutable source attribution and the exact interrupt scope.
   * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
   */
  protected requireSystemInterruptProof(proof: TeamSystemInterruptProof): TeamSystemInterruptProofResolution {
    for (const [sourceName, source] of this.systemInterruptProofSources) {
      let scope: ReturnType<TeamSystemInterruptProofSource['resolveInterruptProof']>
      try {
        scope = source.resolveInterruptProof(proof)
      } catch (cause: unknown) {
        throw new TeamError(
          `System interrupt proof source '${sourceName}' failed to resolve a proof`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
      if (scope === undefined) continue
      try {
        return deepFreeze(teamSystemInterruptProofResolutionSchema.parse({
          sourceName,
          scope: structuredClone(scope),
        }))
      } catch (cause: unknown) {
        throw new TeamError(
          `System interrupt proof source '${sourceName}' returned an invalid interrupt scope`,
          'TEAM_ACTOR_PROOF_INVALID',
          { cause },
        )
      }
    }
    throw new TeamError('System interrupt proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Create one Team, mint its identity, and commit its initial durable state.
   * A nested request names both its parent Team and the parent task; a provider
   * resolves its separate runtime proof and persists the resulting depth under
   * its deployment policy.
   * @param request - JSON-only Team payload plus root or child runtime authority.
   * @returns the detached state committed for the new Team.
   */
  abstract createTeam(request: TeamCreateRequest): Promise<TeamStateSnapshot>

  /**
   * Read the complete detached state of one Team.
   * @param request - Team identity to read.
   * @returns the current Team state and its journal cursor.
   */
  abstract getTeam(request: TeamGetRequest): Promise<TeamStateSnapshot>

  /** Read one current human action without copying the Team projection.
   * @param request - Exact Team and action identity.
   * @returns the bounded action snapshot; unsupported providers reject.
   */
  getHumanAction(request: TeamHumanActionReadRequest): Promise<TeamHumanActionSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support human-action reads', 'TEAM_INVALID_ARGUMENT'))
  }

  /** Read initial Team identity, bounded display text, counts and exact coordinator binding without history arrays.
   * @param request - Team selected for read-only inspection.
   * @returns the lightweight selection projection; no activation is created or resumed.
   */
  abstract getTeamSelection(request: TeamSelectionRequest): Promise<TeamSelectionSnapshot>

  /** Read bounded display summaries without materializing task/plan execution history.
   * @param request - Team, collection, provider-order cursor and requested row limit.
   * @returns a byte- and row-limited page, with actual scan work and optional continuation.
   */
  abstract browse(request: TeamBrowseRequest): Promise<TeamBrowsePage>

  /** Read current task fields or one bounded attempt/review history page, without private artifact references.
   * @param request - Exact Team/task, section, optional revision fence and history continuation.
   * @returns detached data capped by the provider's response budget; indivisible oversized records reject.
   */
  abstract inspectTask(request: TeamTaskInspectRequest): Promise<TeamTaskInspection>


  /** Resolve the latest published Session of one retained Team member without starting an Agent.
   * @param request - exact owning Team and member.
   * @returns published binding, including offline history; missing members or bindings reject.
   */
  abstract getMemberSession(request: TeamMemberSessionRequest): Promise<TeamMemberSessionSnapshot>

  /** Read non-secret member metadata and one capability page without activating an Agent.
   * @param request - Team/member identity and optional cursor-pinned capability continuation.
   * @returns bounded detail; a changed Team cursor rejects continuation until refreshed.
   */
  abstract inspectMember(request: TeamMemberInspectRequest): Promise<TeamMemberInspection>




  /**
   * Retain one host-mediated approval/question in the Team journal. Providers
   * that do not offer durable interaction records fail explicitly so callers
   * cannot mistake a transient mux frame for Team truth.
   * The Host source derives the pending action, policy actor, and timestamps;
   * callers provide only runtime proof and JSON routing fields.
   * @param request - Host runtime authority, Team identity, and observed cursor.
   * @returns the accepted or idempotently replayed interaction snapshot.
   */
  upsertHumanAction(request: TeamHumanActionUpsertRequest): Promise<TeamHumanActionSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support durable human actions', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Settle one durable Team human action through its cursor fence.
   * The Host source derives the action identity, terminal outcome, and policy
   * actor; callers provide only runtime proof and JSON routing fields.
   * @param request - Host runtime authority, Team identity, and observed cursor.
   * @returns the settled interaction snapshot.
   */
  resolveHumanAction(request: TeamHumanActionResolveRequest): Promise<TeamHumanActionSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support durable human actions', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Record one activation-authorized provider usage sample for Team-subtree
   * budget accounting. Providers derive Team, Participant, and Session from
   * the runtime proof; a child Team's sample is charged to each parent before
   * more child work proceeds. Unsupported providers fail explicitly instead
   * of silently presenting process-local estimates.
   * @param request - runtime activation authority plus JSON-only cursor and
   * provider/model usage facts; callers do not select durable Team,
   * participant, Session, or observed-time provenance because the Hub derives them.
   * @returns the durable aggregate after accepting or replaying the sample.
   */
  recordUsage(request: TeamUsageRecordRequest): Promise<TeamUsageSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support durable usage accounting', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Inspect durable Team state for a completion-policy-safe quiescence result.
   * This read never mutates state and intentionally reports blocked tasks,
   * resident activations, and open channels instead of treating incomplete
   * work as completed.
   * @param teamId - Team identity to inspect.
   * @returns detached quiescence diagnostics derived from current Team state.
   */
  async inspectQuiescence(teamId: TeamId): Promise<TeamQuiescenceSnapshot> {
    const state = await this.getTeam({ teamId })
    const activeTaskIds = state.tasks
      .filter(task => task.phase === 'pending' || task.phase === 'assigned' || task.phase === 'running' || task.phase === 'review')
      .map(task => task.id)
    const activeActivationIds = state.activations
      .filter(binding => binding.activation.status === 'starting'
        || binding.activation.status === 'running'
        || binding.activation.status === 'idle'
        || binding.activation.status === 'stopping')
      .map(binding => binding.activation.id)
    const activeWorkspaceAllocationIds = state.workspaceAllocations
      .filter(allocation => allocation.lifecycle !== 'released')
      .map(allocation => allocation.id)
    const openChannelIds: ChannelId[] = []
    for (const channelId of state.channelIds) {
      const channel = await this.getChannel({ channelId })
      if (channel.phase !== 'closed' && channel.phase !== 'expired' && channel.phase !== 'failed') openChannelIds.push(channelId)
    }
    const reasons: string[] = []
    if (activeTaskIds.length > 0) reasons.push('tasks-active')
    if (activeActivationIds.length > 0) reasons.push('activations-active')
    if (activeWorkspaceAllocationIds.length > 0) reasons.push('workspace-allocations-active')
    if (openChannelIds.length > 0) reasons.push('channels-open')
    if ((state.humanActions ?? []).some(action => action.phase === 'pending')) reasons.push('human-actions-pending')
    if ((state.workflowPlans ?? []).some(plan => plan.phase === 'compiling' || plan.phase === 'ready')) reasons.push('workflow-plans-active')
    if (state.team.phase === 'active' && state.goal.phase !== 'complete') reasons.push('objective-active')
    return teamQuiescenceSnapshotSchema.parse({
      teamId,
      quiescent: reasons.length === 0,
      reasons,
      activeTaskIds,
      activeActivationIds,
      activeWorkspaceAllocationIds,
      openChannelIds,
    })
  }

  /**
   * List a bounded page of visible Team summaries for product and transport consumers.
   * @param request - opaque discovery position or -1, plus a physical scan-work limit.
   * @returns detached summaries, scanned work and an optional continuation, including for empty pages.
   */
  abstract listTeamsPage(request: TeamListPageRequest): Promise<TeamListPage>

  /**
   * Archive one terminal Team without deleting its journals or descendants.
   * @param request - JSON-only Team/cursor fields plus a current runtime archive proof.
   * @returns the complete detached state after archival.
   */
  abstract archiveTeam(request: TeamArchiveRequest): Promise<TeamStateSnapshot>

  /**
   * Authorize one authenticated human to recover local ownership of an active or stalled Team.
   * @param request - Team cursor fence and runtime-only authenticated-human proof.
   * @returns an opaque authorization that must remain live through coordinator recovery.
   */
  authorizeHumanResume(request: TeamHumanResumeRequest): Promise<TeamHumanResumeAuthorization> {
    void request
    return Promise.reject(new TeamError('Team provider does not support authenticated human resume', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Read a bounded provider-owned audit projection for the Team journal or one attached channel WAL.
   * @param request - selected Team/source, cursor, and page limit.
   * @returns source records projected without changing authoritative state.
   */
  abstract readAudit(request: TeamAuditReadRequest): Promise<TeamAuditReadResult>

  /**
   * Wait until a Team journal moves beyond a caller-observed cursor, closes, or
   * the caller aborts its local wait. Providers omit `request.signal` before
   * parsing the JSON-only request fields; cancellation changes no durable data.
   * @param request - Team identity, last observed journal cursor, and optional local cancellation.
   * @returns an advanced cursor, or closed at an immutable archived tail or provider shutdown.
   * @throws when `request.signal` aborts before the watch resolves.
   */
  abstract watchTeam(request: TeamWatchRequest): Promise<TeamWatchResult>

  /**
   * Compare-and-set one Team lifecycle transition.
   * @param request - Team identity, observed cursor, and next lifecycle phase.
   * @returns the complete detached state after the committed transition.
   */
  abstract transitionTeamPhase(request: TeamPhaseTransitionRequest): Promise<TeamStateSnapshot>

  /**
   * Retain exact sink authority inside an already-authorized provider command.
   * @param scope - Complete final, ordinary delivery, or retained-admission read.
   * @param operation - Consumer call that must finish before this proof is revoked.
   * @returns Consumer result without exposing a reusable authority factory.
   */
  protected async withHumanSinkProof<T>(scope: TeamHumanSinkScope, operation: (proof: TeamHumanSinkProof) => Promise<T>): Promise<T> {
    const value: object = {}
    Object.defineProperty(value, 'toJSON', { value: (): never => { throw new TypeError('Human sink proofs are runtime-only') } })
    const proof = Object.freeze(value) as TeamHumanSinkProof
    this.humanSinkProofs.set(proof, deepFreeze(structuredClone(scope)))
    try { return await operation(proof) } finally { this.humanSinkProofs.delete(proof) }
  }

  /**
   * Validate a Consumer call against its live provider-owned sink capability.
   * @param proof - Runtime-only capability supplied by the Hub command.
   * @param scope - Complete operation and exact data selected for this storage call.
   */
  validateHumanSinkProof(proof: TeamHumanSinkProof, scope: TeamHumanSinkScope): void {
    const current = this.humanSinkProofs.get(proof)
    if (current === undefined || !isDeepStrictEqual(current, scope)) throw new TeamError('Human sink admission proof is invalid', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Register an exact ordinary-human-delivery proof owner.
   * @param source - Consumer that retains proof construction and lifetime.
   * @returns Effect disposer that immediately revokes the source.
   */
  registerSystemHumanDeliveryProofSource(source: TeamSystemHumanDeliveryProofSource): () => void | Promise<void> {
    const registered = Object.freeze({ name: source.name, resolveHumanDeliveryProof: source.resolveHumanDeliveryProof.bind(source) })
    return this.ctx.effect(() => {
      if (this.humanDeliveryProofSources.has(source.name)) throw new TeamError('Human delivery source is already registered', 'TEAM_INVALID_ARGUMENT')
      this.humanDeliveryProofSources.set(source.name, registered)
      return () => { this.humanDeliveryProofSources.delete(source.name) }
    })
  }

  /**
   * Resolve one live ordinary-delivery proof before authoritative pending-state checks.
   * @param proof - Runtime-only Consumer token.
   * @returns Validated exact delivery scope.
   */
  protected requireSystemHumanDeliveryProof(proof: TeamSystemHumanDeliveryProof): TeamSystemHumanDeliveryScope {
    try {
      const scope = this.humanDeliveryProofSources.get('team-human-client')?.resolveHumanDeliveryProof(proof)
      if (scope !== undefined) return deepFreeze(teamSystemHumanDeliveryScopeSchema.parse(scope))
    } catch (cause: unknown) {
      throw new TeamError('Human delivery source could not validate its proof', 'TEAM_ACTOR_PROOF_INVALID', { cause })
    }
    throw new TeamError('Human delivery proof is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /**
   * Persist one ordinary human delivery and then its receipt under exact source authority.
   * @param request - Current source proof and observed pending-delivery selection.
   * @returns Durable inbox item and recipient receipt.
   */
  admitHumanChannelDelivery(request: TeamHumanChannelDeliveryRequest): Promise<TeamHumanChannelDeliveryResult> {
    void request
    return Promise.reject(new TeamError('Team provider does not support principal message delivery', 'TEAM_INVALID_ARGUMENT'))
  }

  /** Accept a live Host-owned answer before invoking its callback.
   * @param request - Exact source proof and Team cursor.
   * @returns Durable action with response acceptance.
   */
  acceptHumanActionResponse(request: TeamHumanActionResolveRequest): Promise<TeamHumanActionSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider cannot accept human responses', 'TEAM_INVALID_ARGUMENT'))
  }
  /** Cancel an unrecoverable action and stall its Team without inventing a callback.
   * @param request - Failure-only Host proof.
   * @returns Explicit unavailable action.
   */
  unavailableHumanAction(request: TeamHumanActionResolveRequest): Promise<TeamHumanActionSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider cannot settle missing human continuations', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Persist final acceptance through the closed TeamRun result owner.
   * @param request - exact WAL content selection and current source-owned proof.
   * @returns the flushed admission, or its original value for an identical retry.
   */
  admitTeamFinalResult(request: TeamFinalAdmissionRequest): Promise<TeamFinalAdmission> {
    void request
    return Promise.reject(new TeamError('Team provider does not support durable final admission', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Accept an authenticated completion intent; receipt repair requires separate durable final admission.
   * @param request - exact authorized closure selection.
   * @returns the durable completion intent state.
   */
  completeTeam(request: TeamCompleteRequest): Promise<TeamStateSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support typed completion authority', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Accept one Team failure intent through the provider's failure policy.
   * @param request - authenticated structured failure command.
   * @returns the durable quiescing state; a closure driver commits terminal failure after owned work settles.
   */
  failTeam(request: TeamFailRequest): Promise<TeamStateSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support typed failure authority', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Cancel one Team through the provider's admission and quiescence policy.
   * @param request - authenticated structured cancellation command.
   * @returns the terminal Team state, or the durable quiescing/stalled state
   *   while an owned resource still needs to settle.
   */
  cancelTeam(request: TeamCancelRequest): Promise<TeamStateSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support typed cancellation authority', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Continue one source-owned Team lifecycle observation or already durable
   * closure/cancellation through a runtime-only recovery proof.
   * @param request - cursor-fenced durable Team selection plus recovery proof.
   * @returns the current Team state after one provider-owned recovery pass.
   */
  continueTeamClosure(request: TeamClosureContinuationRequest): Promise<TeamStateSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support closure-driver recovery', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Compare-and-set a Team objective's text and/or goal-specific resource limits through one exact activation or authenticated-human proof.
   * @param request - runtime authority, Team identity, observed goal revision, and at least one replacement field.
   * @returns the complete detached state after the committed objective update.
   */
  abstract updateTeamGoal(request: TeamGoalUpdateRequest): Promise<TeamStateSnapshot>

  /**
   * Compare-and-set a Team objective lifecycle transition through one exact activation or authenticated-human proof.
   * @param request - runtime authority, Team identity, observed goal revision, next objective phase, and optional blocker.
   * @returns the complete detached state after the committed objective transition.
   */
  abstract transitionTeamGoalPhase(request: TeamGoalPhaseTransitionRequest): Promise<TeamStateSnapshot>

  /**
   * Invite one participant, mint its identity, and commit its initial phase.
   * @param request - topology or authenticated-human proof plus Team identity, observed cursor, and participant descriptor.
   * @returns the detached participant projection after invitation.
   */
  abstract inviteParticipant(request: ParticipantInviteRequest): Promise<ParticipantSnapshot>

  /**
   * List a bounded page of detached participant projections for one Team.
   * @param request - Team identity, provider-order cursor, and page limit.
   * @returns participant projections and an optional continuation cursor.
   */
  abstract listParticipantsPage(request: TeamMemberListPageRequest): Promise<TeamMemberListPage>

  /**
   * Compare-and-set one participant-membership lifecycle transition.
   * @param request - topology or authenticated-human proof plus Team/participant identities, observed cursor, and next phase.
   * @returns the detached participant projection after the transition.
   */
  abstract transitionParticipantPhase(request: ParticipantPhaseTransitionRequest): Promise<ParticipantSnapshot>

  /**
   * Persist a published activation's immutable Session and provider binding.
   * @param request - source-owned runtime proof, observed Team cursor, and published activation binding.
   * @returns the detached durable binding after acceptance.
   */
  abstract bindActivation(request: ActivationBindRequest): Promise<ActivationBindingSnapshot>

  /** Reserve capacity before invoking an activation provider.
   * @param request - Exact controller-owned startup identity and cursor.
   * @returns the durable startup reservation.
   */
  abstract reserveActivation(request: ActivationReservationRequest): Promise<ActivationReservationSnapshot>

  /** Release an unpublished startup only after its controller proves cleanup.
   * @param request - Exact reservation, owner and current cursor.
   * @returns the reservation carrying its durable release time.
   */
  abstract releaseActivationReservation(request: ActivationReservationRequest): Promise<ActivationReservationSnapshot>


  /**
   * Persist one permitted residency-status transition for a bound activation.
   * @param request - source-owned runtime proof, Team/activation identity, observed cursor, and next status.
   * @returns the detached binding after its durable status update.
   */
  abstract updateActivationStatus(request: ActivationStatusUpdateRequest): Promise<ActivationBindingSnapshot>

  /**
   * Atomically release task leases held by one externally fenced activation,
   * record its offline fence proof, and retire any recorded wake channels.
   * Callers must prove process termination before invoking this trusted recovery operation.
   * @param request - source-owned runtime proof, exact activation relation, and current Team cursor.
   * @returns the complete detached Team state after lease release and offline transition.
   */
  abstract fenceActivation(request: ActivationFenceRequest): Promise<TeamStateSnapshot>

  /**
   * Release task leases held by one locally settled activation and persist its
   * quiescence proof before another epoch can use the same Session.
   * @param request - source-owned runtime proof, exact activation relation, and current Team cursor.
   * @returns the complete detached Team state after quiescence settles.
   */
  abstract quiesceActivation(request: ActivationQuiesceRequest): Promise<TeamStateSnapshot>

  /**
   * Read one durable activation binding.
   * @param request - Team and activation identities.
   * @returns the current durable binding.
   */
  abstract getActivation(request: ActivationGetRequest): Promise<ActivationBindingSnapshot>

  /**
   * Resolve the current TeamRun human/coordinator topology from one
   * source-owned proof and commit its soft interrupt request. A matching
   * unacknowledged target returns its existing durable request without another append.
   * @param request - runtime TeamRun authority, Team identity, and observed cursor.
   * @returns the durable request bound to the resolved activation, Session, and provider.
   */
  abstract requestParticipantInterrupt(request: ParticipantInterruptRequest): Promise<ParticipantInterruptSnapshot>

  /**
   * List unacknowledged soft interrupts for one exact current activation proof.
   * @param request - runtime target authority without caller-selected binding identities.
   * @returns detached pending interrupts in durable request order.
   */
  abstract listPendingParticipantInterrupts(
    request: ParticipantInterruptListPendingRequest,
  ): Promise<readonly ParticipantInterruptSnapshot[]>

  /**
   * Acknowledge one soft interrupt from the exact current activation it targets.
   * Repeating an acknowledgement returns the original durable acknowledgement.
   * @param request - runtime target authority and selected interrupt identity.
   * @returns the acknowledged durable interrupt.
   */
  abstract acknowledgeParticipantInterrupt(
    request: ParticipantInterruptAcknowledgeRequest,
  ): Promise<ParticipantInterruptSnapshot>

  /**
   * Create one Team task, mint its identity, and commit its initial phase. The runtime proof derives either an
   * activation creator or an authenticated human creator; the provider replays its original task before cursor
   * comparison. A conflicting command reuse rejects.
   * @param request - Team identity, observed cursor, complete task fields, retry command, and runtime proof.
   * @returns the detached task projection after creation or matching command replay.
   */
  abstract createTask(request: TeamTaskCreateRequest): Promise<TeamTaskSnapshot>

  /**
   * Compare-and-set an advisory preferred owner for one pending task. The
   * proposal is a scheduler hint only; it does not grant task or Participant
   * authority and a provider may select another eligible owner.
   * @param request - Team/task identity, observed task revision, and optional preferred Participant.
   * @returns the detached task projection after the proposal change.
   */
  proposeTaskOwner(request: TeamTaskOwnerProposalRequest): Promise<TeamTaskSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support task owner proposals', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Admit one complete JSON workflow plan before any compiled task or channel
   * record is created. Providers retain the plan in `compiling` so recovery can
   * resume the compiler from durable bindings.
   * @param request - Team cursor, retry identity, complete workflow plan, and current coordinator proof.
   * @returns the accepted or idempotently replayed workflow plan.
   */
  admitWorkflowPlan(request: TeamWorkflowPlanAdmissionRequest): Promise<TeamWorkflowPlanSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support durable workflow plans', 'TEAM_INVALID_ARGUMENT'))
  }

  /** Read current workflow metadata and one task/dependency window.
   * @param request - Exact workflow, optional revision and page selection.
   * @returns a bounded inspection without complete plan or result bodies.
   */
  inspectWorkflowPlan(request: TeamWorkflowInspectRequest): Promise<TeamWorkflowInspection> {
    void request
    return Promise.reject(new TeamError('Team provider does not support workflow inspection', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Read one durable workflow plan and its compiled task/channel bindings.
   * @param request - owning Team and workflow plan identities.
   * @returns the current detached workflow plan projection.
   */
  getWorkflowPlan(request: TeamWorkflowPlanGetRequest): Promise<TeamWorkflowPlanSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support durable workflow plans', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * List a bounded page of workflow plans in durable admission order.
   * @param request - Team identity, provider-order cursor, and page limit.
   * @returns detached workflow plan projections and an optional continuation cursor.
   */
  listWorkflowPlansPage(request: TeamWorkflowPlanListPageRequest): Promise<TeamWorkflowPlanListPage> {
    void request
    return Promise.reject(new TeamError('Team provider does not support durable workflow plans', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Bind one durable Team task to its plan-local template.
   * @param request - TeamRun workflow proof plus JSON-only Team/plan cursor fences and task binding.
   * @returns the updated detached workflow plan projection.
   */
  bindWorkflowPlanTask(request: TeamWorkflowPlanTaskBindRequest): Promise<TeamWorkflowPlanSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support durable workflow plans', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Bind one durable workflow channel to its plan.
   * @param request - TeamRun workflow proof plus JSON-only Team/plan cursor fences and channel identity.
   * @returns the updated detached workflow plan projection.
   */
  bindWorkflowPlanChannel(request: TeamWorkflowPlanChannelBindRequest): Promise<TeamWorkflowPlanSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support durable workflow plans', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Advance a workflow plan to `ready` or retain one terminal result/failure.
   * @param request - TeamRun workflow proof plus JSON-only Team/plan cursor fences and next durable phase.
   * @returns the updated detached workflow plan projection.
   */
  transitionWorkflowPlan(request: TeamWorkflowPlanPhaseRequest): Promise<TeamWorkflowPlanSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support durable workflow plans', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Read one detached Team task projection, including a deleted tombstone.
   * @param request - Team and task identities to read.
   * @returns the current task projection.
   */
  abstract getTask(request: TeamTaskGetRequest): Promise<TeamTaskSnapshot>

  /** Reserve one child identity and complete creation payload under parent-task CAS.
   * @param request - exact source-owned reservation and resolved child template.
   * @returns the running parent task retaining its child reservation.
   */
  abstract beginTaskDelegation(request: TeamTaskDelegationBeginRequest): Promise<TeamTaskSnapshot>
  /** Bind a published child runtime to its existing parent reservation.
   * @param request - current task/delegation/child identities and revision.
   * @returns the active parent delegation projection.
   */
  abstract bindTaskDelegation(request: TeamTaskDelegationBindRequest): Promise<TeamTaskSnapshot>
  /** Settle a child task only after terminal child execution and parent charging.
   * @param request - exact child reservation and current parent task revision.
   * @returns the terminal parent task retaining child result and failure provenance.
   */
  abstract settleTaskDelegation(request: TeamTaskDelegationSettleRequest): Promise<TeamTaskSnapshot>
  /** Retain a child operational stall without releasing its concurrency or scopes.
   * @param request - current parent task and exact stall reason.
   * @returns the stalled delegation projection.
   */
  abstract stallTaskDelegation(request: TeamTaskDelegationStallRequest): Promise<TeamTaskSnapshot>
  /** Authorize one child startup or cancellation with live parent and workspace checks.
   * @param request - source-owned exact operation and parent revision.
   * @returns a provider-owned runtime capability whose caller must close after settlement.
   */
  abstract authorizeChildRun(request: TeamChildRunAuthorizeRequest): Promise<TeamChildRunAuthorization>

  /**
   * List a bounded page of current detached task projections for one Team.
   * @param request - Team identity, provider-order cursor, and page limit.
   * @returns detached task projections and an optional continuation cursor.
   */
  abstract listTasksPage(request: TeamTaskListPageRequest): Promise<TeamTaskListPage>

  /** Resolve one visible, unambiguous Team artifact reference.
   * @param request - Team identity and artifact id selected by the caller.
   * @returns the visible reference, or `undefined` for missing, private, or ambiguous identities.
   */
  getArtifact(request: TeamArtifactGetRequest): Promise<TeamArtifactReference | undefined> {
    void request
    return Promise.reject(new TeamError('Team provider does not support artifact reference lookup', 'TEAM_INVALID_ARGUMENT'))
  }

  /** List a bounded page of visible, unambiguous Team artifact references.
   * @param request - Team identity, provider-order cursor, and page limit.
   * @returns visible artifact references and an optional continuation cursor.
   */
  listArtifactsPage(request: TeamArtifactListPageRequest): Promise<TeamArtifactListPage> {
    void request
    return Promise.reject(new TeamError('Team provider does not support bounded artifact listing', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Compare-and-set a lease-free task details edit without changing phase, scheduler facts, or attempts.
   * @param request - current coordinator proof plus JSON-only task detail fields.
   * @returns the detached task projection after the committed details edit.
   */
  abstract updateTaskDetails(request: TeamTaskDetailsUpdateRequest): Promise<TeamTaskSnapshot>

  /**
   * Persist a single-task cancellation while exact live work retains ownership.
   * @param request - Team/task identities and the observed task revision.
   * @returns accepted stop progress or the settled task after owner cleanup.
   */
  abstract cancelTask(request: TeamTaskCancelRequest): Promise<TeamTaskSnapshot>

  /**
   * Continue an accepted lease-free cancellation after interrupted channel cleanup.
   * @param request - scheduler proof and the exact retained cancellation revision.
   * @returns the task after its corresponding review channel closes.
   */
  abstract reconcileTaskCancellation(request: TeamTaskCancellationReconcileRequest): Promise<TeamTaskSnapshot>

  /**
   * Cancel one exact pending task only while a durable TeamRun cancellation
   * intent still owns the selected Team. This narrow post-release cleanup
   * command deliberately does not grant generic task-cancellation authority.
   * @param request - TeamRun cancellation-cleanup proof plus Team/task/cancellation cursor fences.
   * @returns the detached cancelled task projection.
   */
  cancelTeamCancellationTask(request: TeamCancellationTaskCancelRequest): Promise<TeamTaskSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support cancellation task cleanup', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Replace a lease-free non-review task with its deleted tombstone after provider DAG and policy checks.
   * @param request - current coordinator proof plus JSON-only task tombstone fields.
   * @returns the detached deleted task projection after the committed tombstone.
   */
  abstract deleteTask(request: TeamTaskDeleteRequest): Promise<TeamTaskSnapshot>

  /**
   * Resolve a lease-free review task through task-mutate policy for the reviewer
   * derived from its current activation proof.
   * @param request - runtime reviewer proof plus JSON-only task/revision/decision fields.
   * @returns the detached task projection after the committed review resolution.
   */
  abstract resolveTaskReview(request: TeamTaskReviewResolveRequest): Promise<TeamTaskSnapshot>

  /**
   * Recover one task review from the exact durable consult response selected by
   * a registered system source. The source scope, rather than caller fields,
   * identifies the Team, reviewer, request, response, decision, and reason.
   * @param request - runtime-only system recovery proof.
   * @returns the detached task projection after the recovered review decision.
   */
  abstract resolveTaskReviewFromResponse(request: TeamTaskReviewRecoverRequest): Promise<TeamTaskSnapshot>

  /**
   * Assign a pending task, mint its next non-reusable attempt id, and commit its bounded lease.
   * The scheduler source selects the exact task, participant, optional activation,
   * wake channel, and lease duration through runtime-only authority.
   * @param request - scheduler proof plus JSON-only assignment identifiers and bounds.
   * @returns the detached assigned task projection with its current lease.
   */
  abstract assignTask(request: TeamTaskAssignRequest): Promise<TeamTaskSnapshot>

  /**
   * Start the exact current attempt after checking its revision, id, participant, and optional activation epoch.
   * @param request - current activation proof plus JSON-only task attempt fence.
   * @returns the detached running task projection with its current lease.
   */
  abstract startTaskAttempt(request: TeamTaskAttemptStartRequest): Promise<TeamTaskSnapshot>

  /**
   * Claim and start the exact assigned attempt after its durable assignment
   * Envelope reaches the activation bound to the request's runtime-only actor
   * proof. Providers derive the Team, Participant, activation, and Session
   * from that proof. Repeating the same current claim after it starts returns
   * the running task without another durable transition.
   * @param request - Runtime actor proof, lease identity, assignment revision, assignment channel, and accepted Envelope.
   * @returns the detached running task projection for the current attempt.
   */
  abstract claimTaskAttemptStart(request: TeamTaskAttemptStartClaimRequest): Promise<TeamTaskSnapshot>

  /**
   * Renew the exact current attempt for its fixed lease duration after resolving its runtime-only actor proof.
   * Providers derive the Team, Participant, activation, and Session from that proof before renewing the lease.
   * @param request - Runtime actor proof, task-attempt identity, and observed revision.
   * @returns the detached task projection with its renewed current lease.
   */
  abstract heartbeatTaskAttempt(request: TeamTaskAttemptHeartbeatRequest): Promise<TeamTaskSnapshot>

  /**
   * Settle the exact current attempt once, retaining its closed outcome and removing its lease.
   * The provider maps completed to direct completion or review from the frozen route, cancelled to cancelled,
   * and released or failed to pending until maxAttempts, then failed.
   * Providers resolve the runtime-only actor proof and derive the Team, Participant, activation, and Session
   * before mapping the closed outcome.
   * @param request - Runtime actor proof, task-attempt identity, observed revision, and closed outcome.
   * @returns the detached task projection with the settled attempt in its bounded history.
   */
  abstract settleTaskAttempt(request: TeamTaskAttemptSettleRequest): Promise<TeamTaskSnapshot>

  /**
   * Expire an elapsed current lease once, retaining a lease-expired outcome before retry or failure.
   * The provider returns the task to pending until maxAttempts, then fails it.
   * @param request - scheduler proof plus JSON-only task-attempt fence.
   * @returns the detached task projection with the expired attempt in its bounded history.
   */
  abstract expireTaskAttempt(request: TeamTaskAttemptExpireRequest): Promise<TeamTaskSnapshot>

  /**
   * Commit a provider-owned bounded workspace observation against its exact allocation and prior scan.
   * @param request - Live provider proof and complete scan facts with allocation revision and prior observation CAS.
   * @returns The durable observation with derived task/attempt identity and scope classifications.
   */
  abstract recordWorkspaceObservation(request: TeamWorkspaceObservationRequest): Promise<TeamWorkspaceObservation>

  /**
   * Reserve one provider allocation before its filesystem root is materialized.
   * @param request - source-owned allocation reservation scope.
   * @returns the durable allocation snapshot after reservation.
   */
  abstract reserveWorkspaceAllocation(request: TeamWorkspaceAllocationReserveRequest): Promise<TeamWorkspaceAllocationSnapshot>

  /**
   * Mark one reserved or preserved allocation active after provider materialization or restore.
   * @param request - source-owned allocation activation scope.
   * @returns the durable allocation snapshot after activation.
   */
  abstract activateWorkspaceAllocation(request: TeamWorkspaceAllocationActivateRequest): Promise<TeamWorkspaceAllocationSnapshot>

  /**
   * Persist release intent before the provider starts physical cleanup.
   * @param request - source-owned allocation release-intent scope.
   * @returns the durable allocation snapshot after release intent.
   */
  abstract requestWorkspaceAllocationRelease(request: TeamWorkspaceAllocationReleaseRequest): Promise<TeamWorkspaceAllocationSnapshot>

  /**
   * Preserve one source-owned provider allocation that cannot yet be released.
   * @param request - source-owned allocation preservation scope.
   * @returns the durable allocation snapshot after preservation.
   */
  abstract preserveWorkspaceAllocation(request: TeamWorkspaceAllocationPreserveRequest): Promise<TeamWorkspaceAllocationSnapshot>

  /** Persist exact provider loss without inferring resource release.
   * @param request - source-owned allocation/world/revision and retained artifacts.
   * @returns the unavailable allocation retaining its exact loss observation.
   */
  abstract recordWorkspaceAllocationLoss(request: TeamWorkspaceAllocationLossRequest): Promise<TeamWorkspaceAllocationSnapshot>

  /**
   * Confirm successful release of one source-owned provider allocation.
   * @param request - source-owned allocation release-confirmation scope.
   * @returns the durable allocation snapshot after release.
   */
  abstract confirmWorkspaceAllocationRelease(
    request: TeamWorkspaceAllocationReleaseConfirmRequest,
  ): Promise<TeamWorkspaceAllocationSnapshot>

  /**
   * Open one channel, mint its identity, and commit its immutable manifest.
   * TeamRun bootstrap and workflow-plan channels require their exact runtime
   * proofs; other generic channels retain their existing JSON-only request form.
   * @param request - Team identity, observed cursor, adapter identity, manifest fields, and runtime proof when applicable.
   * @returns the detached channel projection after opening.
   */
  abstract openChannel(request: ChannelOpenRequest): Promise<ChannelSnapshot>

  /**
   * Read durable channel invitations without acknowledging endpoint support.
   * @param request - channel whose admission is inspected.
   * @returns exact channel and invitation projection.
   */
  getChannelAdmission(request: ChannelGetRequest): Promise<ChannelAdmissionSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support channel invitations', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * List attached channels for the current authenticated human Team member.
   * @param request - Exact actor-free page selection plus its runtime membership proof.
   * @returns Bounded channel projections and an optional insertion-index continuation.
   */
  listTeamChannels(request: TeamChannelListRequest): Promise<TeamChannelListPage> {
    void request
    return Promise.reject(new TeamError('Team provider does not support channel listing', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Read one retained Envelope after checking current Team-human membership.
   * @param request - Exact Team, channel, Envelope and current source-owned proof.
   * @returns Immutable accepted content; missing or compacted Envelopes reject.
   */
  getHumanChannelEnvelope(request: ChannelHumanEnvelopeGetRequest): Promise<TeamEnvelope> {
    void request
    return Promise.reject(new TeamError('Team provider does not support human channel content inspection', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Read an attached channel's invitation status for an authenticated Team human.
   * @param request - Team, channel and current payload-bound principal proof.
   * @returns Complete admission state without granting endpoint consent authority.
   */
  getHumanChannelAdmission(request: ChannelHumanAdmissionGetRequest): Promise<ChannelHumanAdmissionSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support human admission inspection', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Read only the authenticated human's invitation without accepting the protocol.
   * @param request - channel identity and current payload-bound human proof.
   * @returns manifest and the caller's own invitation.
   */
  getHumanChannelInvitation(request: ChannelHumanInvitationGetRequest): Promise<ChannelHumanInvitationSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support human invitation discovery', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Confirm a manifest using the invited endpoint's current activation proof.
   * @param request - exact invitation revision, accepted manifest and retry identity.
   * @returns the durable acknowledgement and possibly activated channel.
   */
  acknowledgeChannelInvitation(request: ChannelInvitationAcknowledgeRequest): Promise<ChannelAdmissionSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support channel invitations', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * End due invitations using an admission-owned clock and exact durable cursors.
   * @param request - source proof and bounded channel selection.
   * @returns the durable invitations and resulting channel phase.
   */
  expireChannelInvitations(request: ChannelInvitationExpireRequest): Promise<ChannelAdmissionSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support channel invitations', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Open one exact scheduler-owned consult channel for a participant-review task.
   * @param request - scheduler channel proof plus Team/task/review binding fences.
   * @returns the detached opened consult channel projection.
   */
  openSchedulerReviewChannel(request: SchedulerReviewChannelOpenRequest): Promise<ChannelSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support scheduler review channels', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Open one exact scheduler-owned self-addressed task-assignment wake channel.
   * @param request - scheduler channel proof plus Team/task/activation binding fences.
   * @returns the detached opened wake channel projection.
   */
  openSchedulerWakeChannel(request: SchedulerWakeChannelOpenRequest): Promise<ChannelSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support scheduler wake channels', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Authenticate, authorize, stamp, and atomically append one channel Envelope.
   * The JSON input carries only the observed cursor, optional retry key, and
   * unstamped draft. An activation proof derives a current sender; an
   * authenticated-human proof derives an active product human sender; a
   * registered system proof derives only its scoped TeamRun human input or
   * scheduler-owned assignment/review post. Task-assignment and review-request
   * drafts reject an activation proof before policy or WAL admission.
   * @param request - runtime actor proof plus JSON-only channel post fields.
   * @returns the immutable Envelope accepted by the durable channel WAL.
   */
  abstract postChannelEnvelope(request: ChannelEnvelopePostRequest): Promise<TeamEnvelope>

  /**
   * Atomically prepare and append one protocol-owned final Envelope. The
   * provider derives the sender, peer, draft, and cursor under its channel write lock.
   * @param request - runtime actor proof plus selected channel, retry key, and final text.
   * @returns the immutable final Envelope accepted by the durable channel WAL.
   */
  abstract postChannelFinalEnvelope(request: ChannelFinalPostRequest): Promise<TeamEnvelope>

  /**
   * Append one durable receipt after an authenticated recipient persists the
   * referenced Envelope in its own delivery target. A duplicate receipt
   * returns the original durable record without another channel-WAL append.
   * The runtime-only actor derives the recipient; providers resolve it before
   * policy evaluation or pending-delivery removal.
   * @param request - runtime authority plus JSON-only accepted Envelope and cursor fields.
   * @returns the immutable receipt accepted by the durable channel WAL.
   */
  abstract ackChannelEnvelope(request: ChannelEnvelopeReceiptRequest): Promise<ChannelReceiptRecord>

  /**
   * Atomically claim one unacknowledged Envelope delivery through an opaque
   * activation proof. The provider resolves the proof under its Team/channel
   * serializers before it derives the recipient binding and treatment. A
   * defined claim neither reserves a model turn nor promises exactly-once
   * delivery; it is ephemeral and has no claim identifier or settlement operation.
   * @param request - runtime-only activation proof plus JSON-only channel and Envelope identities.
   * @returns the claim, or `undefined` when the recipient already durably acknowledged the Envelope.
   */
  abstract claimChannelDelivery(request: ChannelDeliveryClaimRequest): Promise<ChannelDeliveryClaim | undefined>

  /**
   * List a bounded page of currently pending deliveries for one recipient.
   * `afterCursor` is an exclusive source channel-WAL cursor, never a receipt
   * high-water. This discovery read neither claims nor acknowledges a delivery;
   * a consumer must call {@link claimChannelDelivery} before delivery.
   * @param request - channel, recipient, exclusive source cursor, and page limit.
   * @returns detached pending deliveries and the cursor for the next page or watch.
   */
  abstract listChannelPendingDeliveries(request: ChannelPendingDeliveryListRequest): Promise<ChannelPendingDeliveryPage>

  /**
   * Durably expire one exact bounded TTL delivery batch through a scheduler-owned proof.
   * @param request - scheduler channel proof plus Team/channel cursors, clock observation, and bound.
   * @returns the channel projection and expiry records committed by the authorized batch.
   */
  expireSchedulerChannelDeliveries(request: SchedulerChannelDeliveryExpireRequest): Promise<ChannelDeliveryExpireResult> {
    void request
    return Promise.reject(new TeamError('Team provider does not support scheduler delivery expiry', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Read bounded channel-wide source content for an authenticated explicit summary selection.
   * @param request - Current coordinator/human proof and exact channel/range/retry selection.
   * @returns The ordered source content and fingerprint, or the matching committed result.
   */
  abstract readChannelSummarySource(request: ChannelSummarySourceRequest): Promise<ChannelSummarySource>

  /**
   * Append one idempotent durable summary over a bounded channel source range.
   * @param request - runtime summary proof plus JSON-only channel source and retry fields.
   * @returns the committed channel summary record.
   */
  abstract summarizeChannel(request: ChannelSummarizeRequest): Promise<ChannelSummaryRecord>

  /**
   * Read one detached channel projection.
   * @param request - channel identity to read.
   * @returns the current channel projection and WAL cursor.
   */
  abstract getChannel(request: ChannelGetRequest): Promise<ChannelSnapshot>

  /**
   * Read channel metadata only for a current member activation, including pending admission.
   * @param request - current actor proof and channel identity, without caller-selected member identity.
   * @returns manifest, phase and cursors; no messages, summaries or adapter state.
   */
  getChannelForActor(request: ChannelActorGetRequest): Promise<ChannelSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support bound channel metadata reads', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Read records committed after one caller-observed channel-WAL cursor.
   * @param request - channel identity and last observed WAL cursor.
   * @returns the detached channel projection and ordered record suffix.
   */
  abstract readChannel(request: ChannelReadRequest): Promise<ChannelReadResult>

  /**
   * Read a bounded page of records committed after one channel-WAL cursor.
   * @param request - channel identity, cursor, and page limit.
   * @returns the detached channel projection, page records, and continuation cursor.
   */
  abstract readChannelPage(request: ChannelReadPageRequest): Promise<ChannelReadPageResult>

  /**
   * Compact a terminal channel's obsolete WAL prefix after durable delivery
   * and checkpoint watermarks prove the prefix is no longer required.
   * @param request - Team/channel identity, observed cursor, and prefix bound.
   * @returns the channel projection and compaction watermarks.
   */
  abstract compactChannel(request: TeamChannelCompactRequest): Promise<TeamChannelCompactResult>

  /**
   * Compact a terminal Team journal's obsolete prefix after durable audit and
   * checkpoint watermarks prove the prefix is no longer required.
   * @param request - Team identity, maintenance actor, observed cursor, and prefix bound.
   * @returns the Team projection and compaction watermarks.
   */
  abstract compactTeam(request: TeamJournalCompactRequest): Promise<TeamJournalCompactResult>

  /**
   * Compare-and-set closure of one channel.
   * @param request - channel identity, observed WAL cursor, and optional reason.
   * @returns the detached terminal channel projection.
   */
  abstract closeChannel(request: ChannelCloseRequest): Promise<ChannelSnapshot>

  /**
   * Close one exact scheduler-owned wake channel only when no current lease owns it.
   * @param request - scheduler channel proof plus immutable wake-manifest and channel cursor fences.
   * @returns the detached terminal wake channel projection.
   */
  closeSchedulerFailedWakeChannel(request: SchedulerFailedWakeChannelCloseRequest): Promise<ChannelSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support scheduler failed wake cleanup', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Close one exact active channel only while a durable TeamRun cancellation
   * intent still owns the selected Team. This narrow post-release cleanup
   * command deliberately does not grant generic channel-close authority.
   * @param request - TeamRun cancellation-cleanup proof plus Team/channel/cancellation cursor fences and reason.
   * @returns the detached terminal channel projection.
   */
  closeTeamCancellationChannel(request: TeamCancellationChannelCloseRequest): Promise<ChannelSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support cancellation channel cleanup', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Close one exact active channel only while a durable human-receipted TeamRun
   * final result still owns the selected Team. This narrow post-release cleanup
   * command deliberately does not grant generic channel-close authority.
   * @param request - TeamRun finalization-cleanup proof plus Team/final/channel cursor fences and completion reason.
   * @returns the detached terminal channel projection.
   */
  closeTeamFinalizationChannel(request: TeamFinalizationChannelCloseRequest): Promise<ChannelSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support finalization channel cleanup', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Close one exact active workflow channel only while its compiling plan has
   * not bound that channel. TeamRun uses this narrow cleanup command after a
   * failed compiler open/bind attempt so no orphaned workflow channel remains.
   * @param request - TeamRun workflow proof plus Team/plan/channel cursor fences and optional reason.
   * @returns the detached terminal channel projection.
   */
  closeWorkflowChannel(request: TeamWorkflowChannelCloseRequest): Promise<ChannelSnapshot> {
    void request
    return Promise.reject(new TeamError('Team provider does not support workflow channel cleanup', 'TEAM_INVALID_ARGUMENT'))
  }

  /**
   * Wait until a channel WAL moves beyond a caller-observed cursor, closes, or
   * the caller aborts its local wait. Providers omit `request.signal` before
   * parsing the JSON-only request fields; cancellation changes no durable data.
   * @param request - channel identity, last observed WAL cursor, and optional local cancellation.
   * @returns whether the cursor advanced or the provider closed the watch.
   * @throws when `request.signal` aborts before the watch resolves.
   */
  abstract watchChannel(request: ChannelWatchRequest): Promise<ChannelWatchResult>

  /**
   * Register one synchronous pure channel adapter. Registration is effect-scoped
   * and duplicate accepting `(type, version)` identities reject before publication.
   * @param adapter - adapter implementation for future channel openings.
   * @returns an HMR-safe disposer that retires exactly this registration while existing leases retain its object.
   */
  registerAdapter(adapter: TeamChannelAdapter): () => void {
    const ref: TeamAdapterRef = { type: adapter.type, version: adapter.version }
    const key = adapterKey(ref)
    const entry: RetainedImplementation<TeamChannelAdapter> = {
      ref: deepFreeze({ ...ref }),
      implementation: adapter,
      accepting: true,
      leases: 0,
    }
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.adapters.has(key)) {
        throw new TeamError(
          `Team adapter "${ref.type}" version ${ref.version} is already registered`,
          'TEAM_ADAPTER_DUPLICATE',
        )
      }
      this.adapters.set(key, entry)
      yield () => {
        entry.accepting = false
        this.adapters.delete(key)
        if (entry.leases > 0) this.retiredAdapters.add(entry)
        this.emitContained('team/adapter-removed', deepFreeze({ ...ref }))
      }
      this.emitContained('team/adapter-added', deepFreeze({ ...ref }))
    }.bind(this), 'teams.registerAdapter()')
  }

  /**
   * Resolve one exact adapter implementation that still accepts new work.
   * @param ref - type and version frozen in a channel manifest.
   * @returns the accepting registered adapter.
   * @throws {@link TeamError} when no accepting exact adapter remains registered.
   */
  getAdapter(ref: TeamAdapterRef): TeamChannelAdapter {
    const entry = this.adapters.get(adapterKey(ref))
    if (entry === undefined || !entry.accepting) {
      throw new TeamError(
        `Team adapter "${ref.type}" version ${ref.version} is not registered`,
        'TEAM_ADAPTER_NOT_FOUND',
      )
    }
    return entry.implementation
  }

  /**
   * Acquire one exact adapter object for an already admitted channel. Retiring
   * its registration blocks later acquisitions but does not invalidate this
   * handle.
   * @param ref - type and version frozen in a channel manifest.
   * @returns a release-once handle retaining the exact adapter object.
   * @throws {@link TeamError} when no accepting exact adapter is registered.
   */
  acquireAdapter(ref: TeamAdapterRef): TeamAdapterLease {
    const lease = this.acquireImplementation(this.adapters, this.retiredAdapters, ref, 'adapter')
    return Object.freeze({
      get adapter(): TeamChannelAdapter { return lease.implementation },
      isRetired: () => lease.isRetired(),
      release: () => { lease.release() },
    })
  }

  /**
   * List registered adapter identities in registration order.
   * @returns detached adapter references.
   */
  listAdapters(): TeamAdapterRef[] {
    return [...this.adapters.values()].map(entry => ({ ...entry.ref }))
  }

  /**
   * Register one pure versioned channel view policy through a Cordis effect.
   * @param policy - view-policy implementation.
   * @returns an HMR-safe disposer that retires the registration while existing leases retain its object.
   */
  registerViewPolicy(policy: TeamViewPolicy): () => void {
    const ref: TeamViewPolicyRef = { type: policy.type, version: policy.version }
    const key = adapterKey(ref)
    const entry: RetainedImplementation<TeamViewPolicy> = {
      ref: deepFreeze({ ...ref }),
      implementation: policy,
      accepting: true,
      leases: 0,
    }
    // oxlint-disable-next-line typescript/no-misused-promises -- Cordis effect consumes the generator disposer synchronously.
    return this.ctx.effect(function* (this: TeamRuntime) {
      if (this.viewPolicies.has(key)) {
        throw new TeamError(`Team view policy "${ref.type}" version ${ref.version} is already registered`, 'TEAM_ADAPTER_DUPLICATE')
      }
      this.viewPolicies.set(key, entry)
      yield () => {
        entry.accepting = false
        this.viewPolicies.delete(key)
        if (entry.leases > 0) this.retiredViewPolicies.add(entry)
        this.emitContained('team/view-policy-removed', deepFreeze({ ...ref }))
      }
      this.emitContained('team/view-policy-added', deepFreeze({ ...ref }))
    }.bind(this), 'teams.registerViewPolicy()')
  }

  /**
   * Resolve one exact durable channel view policy identity that still accepts new work.
   * @param ref - versioned view-policy identity.
   * @returns the accepting registered pure view-policy implementation.
   * @throws {@link TeamError} when no accepting exact view policy remains registered.
   */
  getViewPolicy(ref: TeamViewPolicyRef): TeamViewPolicy {
    const entry = this.viewPolicies.get(adapterKey(ref))
    if (entry === undefined || !entry.accepting) {
      throw new TeamError(`Team view policy "${ref.type}" version ${ref.version} is not registered`, 'TEAM_ADAPTER_NOT_FOUND')
    }
    return entry.implementation
  }

  /**
   * Acquire one exact view-policy object for an already admitted channel.
   * Retiring its registration blocks later acquisitions but does not invalidate
   * this handle.
   * @param ref - type and version frozen in a channel manifest.
   * @returns a release-once handle retaining the exact policy object.
   * @throws {@link TeamError} when no accepting exact view policy is registered.
   */
  acquireViewPolicy(ref: TeamViewPolicyRef): TeamViewPolicyLease {
    const lease = this.acquireImplementation(this.viewPolicies, this.retiredViewPolicies, ref, 'view policy')
    return Object.freeze({
      get policy(): TeamViewPolicy { return lease.implementation },
      isRetired: () => lease.isRetired(),
      release: () => { lease.release() },
    })
  }

  /**
   * List registered channel view policies in registration order.
   * @returns detached view-policy identities.
   */
  listViewPolicies(): TeamViewPolicyRef[] {
    return [...this.viewPolicies.values()].map(entry => ({ ...entry.ref }))
  }

  /**
   * Return process-local counts for accepting and retired implementation
   * registrations plus the channel leases retaining them.
   * @returns a detached snapshot for HMR and runtime diagnostics.
   */
  getImplementationLeaseMetrics(): TeamImplementationLeaseMetrics {
    return Object.freeze({
      acceptingAdapterImplementations: this.adapters.size,
      retiredAdapterImplementations: this.retiredAdapters.size,
      activeAdapterLeases: this.implementationLeaseCount(this.adapters, this.retiredAdapters),
      acceptingViewPolicyImplementations: this.viewPolicies.size,
      retiredViewPolicyImplementations: this.retiredViewPolicies.size,
      activeViewPolicyLeases: this.implementationLeaseCount(this.viewPolicies, this.retiredViewPolicies),
    })
  }

  /** Acquire one implementation from an accepting registry entry and retain it until release. */
  private acquireImplementation<T>(
    implementations: ReadonlyMap<string, RetainedImplementation<T>>,
    retired: Set<RetainedImplementation<T>>,
    ref: TeamAdapterRef,
    label: string,
  ): RetainedImplementationLease<T> {
    const candidate = implementations.get(adapterKey(ref))
    if (candidate === undefined || !candidate.accepting) {
      throw new TeamError(
        `Team ${label} "${ref.type}" version ${ref.version} is not registered`,
        'TEAM_ADAPTER_NOT_FOUND',
      )
    }
    candidate.leases += 1
    let entry: RetainedImplementation<T> | undefined = candidate
    return Object.freeze({
      get implementation(): T {
        if (entry === undefined) throw new Error(`Team ${label} lease is released`)
        return entry.implementation
      },
      isRetired: () => entry !== undefined && !entry.accepting,
      release: () => {
        const releasedEntry = entry
        if (releasedEntry === undefined) return
        entry = undefined
        releasedEntry.leases -= 1
        if (!releasedEntry.accepting && releasedEntry.leases === 0) retired.delete(releasedEntry)
      },
    })
  }

  /** Count all leases retaining accepting and retired implementations in one registry family. */
  private implementationLeaseCount<T>(
    accepting: ReadonlyMap<string, RetainedImplementation<T>>,
    retired: ReadonlySet<RetainedImplementation<T>>,
  ): number {
    let count = 0
    for (const entry of accepting.values()) {
      count += entry.leases
    }
    for (const entry of retired) {
      count += entry.leases
    }
    return count
  }

  /**
   * Return a detached operational counter/gauge snapshot for dashboards and alerts.
   * @returns current in-process Team metrics.
   */
  getMetrics(): TeamMetricsSnapshot {
    return Object.freeze({ ...this.metrics })
  }

  /** Record one workspace integration conflict observed by a Team provider. */
  reportWorkspaceConflict(): void {
    this.incrementMetric('workspaceConflicts')
  }

  /** Increment one provider-owned counter without exposing mutable metrics. */
  protected incrementMetric(metric: TeamCounterMetric): void {
    this.adjustMetric(metric, 1)
  }

  /** Adjust one provider-owned metric while preserving a non-negative counter/gauge. */
  protected adjustMetric(metric: TeamCounterMetric, delta: number): void {
    const next = this.metrics[metric] + delta
    if (!Number.isSafeInteger(next) || next < 0) throw new Error(`Team metric '${metric}' became invalid`)
    this.metrics[metric] = next
    this.metrics.updatedAt = Date.now()
  }

  /** Record one provider-owned latency sample in its cumulative histogram. */
  protected recordLatency(metric: TeamLatencyMetric, latencyMs: number): void {
    this.metrics[metric] = addTeamLatencySample(this.metrics[metric], latencyMs)
    this.metrics.updatedAt = Date.now()
  }

  /**
   * Register one named policy for exactly one Team operation. Matching requests
   * reach it through the `team/policy` waterfall; nonmatching hooks delegate.
   * @param hook - Team operation this policy intercepts.
   * @param policy - named policy implementation.
   * @returns an HMR-safe disposer that removes exactly this policy.
   */
  registerPolicy(hook: TeamPolicyHook, policy: TeamPolicy): () => void {
    const registration: TeamPolicyRegistration = { hook, name: policy.name }
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity
    return this.ctx.effect(function* (this: TeamRuntime) {
      const policies = this.policies.get(hook) ?? new Map<string, TeamPolicy>()
      if (policies.has(policy.name)) {
        throw new TeamError(
          `Team policy "${policy.name}" is already registered for "${hook}"`,
          'TEAM_POLICY_DUPLICATE',
        )
      }
      this.policies.set(hook, policies)
      const unregister = this.ctx.on('team/policy', (request, next) =>
        request.hook === hook ? policy.apply(request, next) : next())
      policies.set(policy.name, policy)
      yield () => {
        unregister()
        policies.delete(policy.name)
        if (policies.size === 0) this.policies.delete(hook)
        this.emitContained('team/policy-removed', deepFreeze({ ...registration }))
      }
      this.emitContained('team/policy-added', deepFreeze({ ...registration }))
    }.bind(this), 'teams.registerPolicy()')
  }

  /**
   * List current policy registrations in hook and registration order.
   * @returns detached diagnostic identities.
   */
  listPolicies(): TeamPolicyRegistration[] {
    const registrations: TeamPolicyRegistration[] = []
    for (const [hook, policies] of this.policies) {
      for (const name of policies.keys()) registrations.push({ hook, name })
    }
    return registrations
  }

  /**
   * Run the policy waterfall for one provider-validated Team operation.
   * @param request - operation facts to authorize or govern.
   * @returns the final allow or deny decision.
   */
  async authorize(request: TeamPolicyRequest): Promise<TeamPolicyDecision> {
    return await this.ctx.waterfall(
      this,
      'team/policy',
      request,
      () => Promise.resolve({ kind: 'allow' } satisfies TeamPolicyDecision),
    )
  }

  /**
   * Publish a Team record after the provider's durable commit point. Listener
   * failure is logged and cannot reject the committed provider operation.
   * @param event - immutable Team record projection.
   */
  protected emitTeamEvent(event: TeamEvent): void {
    this.metrics.teamEvents += 1
    this.metrics.updatedAt = Date.now()
    if (event.type === 'policy/denied') this.metrics.policyDenials += 1
    this.emitContained('team/changed', immutableTeamEvent(event))
  }

  /**
   * Publish a channel record after the provider's durable commit point. Listener
   * failure is logged and cannot reject the committed provider operation.
   * @param channelId - channel WAL that accepted the record.
   * @param record - immutable channel WAL record.
   */
  protected emitChannelRecord(channelId: ChannelEvent['channelId'], record: ChannelRecord): void {
    this.metrics.channelEvents += 1
    this.metrics.updatedAt = Date.now()
    this.emitContained('channel/changed', immutableChannelEvent({ channelId, record }))
  }

  /** Dispatch one notification while containing every observer failure. */
  private emitContained(
    name: 'team/adapter-added' | 'team/adapter-removed' | 'team/view-policy-added' | 'team/view-policy-removed' | 'team/policy-added' | 'team/policy-removed' | 'team/changed' | 'channel/changed',
    payload: TeamAdapterRef | TeamViewPolicyRef | TeamPolicyRegistration | TeamEvent | ChannelEvent,
  ): void {
    const args: unknown[] = [this, name, payload]
    const callbacks = this.ctx.events.dispatch('emit', args)
    for (const callback of callbacks) {
      try {
        const returned = (callback as (...args: unknown[]) => unknown)(...args)
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`teams: ${name} listener rejected: ${renderListenerError(error)}`)
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`teams: ${name} listener threw: ${renderListenerError(error)}`)
      }
    }
  }
}
