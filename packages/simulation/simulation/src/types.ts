import type { SimulationDispatchResult, SimulationTeamTransport } from './outbox-types.ts'
import type { SimulationDriveRequest, SimulationDriveResult, SimulationEventId, SimulationEventKey, SimulationEventPhase, SimulationEventSlot, SimulationScheduledEvent, SimulationStall, SimulationWake, SimulationWakeRequest } from './scheduler-types.ts'
import type { SimulationCommitment, SimulationCommitmentId, SimulationInteraction, SimulationInteractionId, SimulationDecision, SimulationDecisionId, SimulationDecisionSlot, SimulationGrantId, SimulationOperation, SimulationOperationId, SimulationOperationResult, SimulationResource, SimulationResourceGrant, SimulationResourceId, SimulationResourceSpec } from './business-types.ts'
/** Durable simulation run identities and provider contracts. @module @clocky/clocky-simulation/types */
import type { SimulationChange, SimulationEntity, SimulationEntityId, SimulationRelation, SimulationRelationId, SimulationRelationRule } from './entity-types.ts'
import type { SimulationEntityBinding, SimulationWriterActivation, SimulationWriterLease, SimulationWriterReservation } from './writer-types.ts'
import type { ActivationReservationId } from '@clocky/clocky-team'
import type { Branded } from '@clocky/clocky-brand'
import type { SimTime } from './time-types.ts'
export type { SimTime } from './time-types.ts'
import type { SimulationChannelKey } from './identities.ts'
export type { SimulationChannelKey } from './identities.ts'

/** Stable identity within one simulation provider's storage root. */
export type SimulationRunId = Branded<'SimulationRunId'>
/** Immutable direct-channel membership and adapter limits. */
export interface SimulationChannelSpec {
  readonly key: SimulationChannelKey
  readonly members: readonly { readonly entityId: SimulationEntityId; readonly role: string }[]
  readonly limits: import('@clocky/clocky-team').JsonObject
}
/** Durable identity reserved before channel WAL creation; confirmation follows every required consent. */
export interface SimulationChannelReservation {
  readonly channelId: import('@clocky/clocky-team').ChannelId
  readonly spec: SimulationChannelSpec
  readonly confirmed: boolean
}
/** Explicit durable semantics that must match when reopening a run. */
export interface SimulationRunSpec {
  readonly maxQueuedDecisions: number
  readonly maxDispatchWaitRounds: number
  readonly maxTokensPerInterval: number
  readonly tokensPerModelRequest: number
  readonly budgetInterval: SimTime
  readonly maxDecisionsPerInterval: number
  readonly maxMessagesPerInterval: number
  readonly maxPendingEvents: number
  readonly maxPendingInteractions: number
  /** Complete resource reservation history, including expired/cancelled/committed identities. */
  readonly maxResourceReservationHistory: number
  readonly maxKnowledgeBytes: number
  readonly maxKnowledgePerQuery: number
  readonly maxEntities: number
  readonly maxResidentActors: number
  readonly maxIngressBytes: number
  readonly maxConflictRetries: number
  readonly decisionTimeoutMs: number
  readonly maxDecisionsPerWindow: number
  readonly runId: SimulationRunId
  readonly tickUnit: string
  readonly origin: string
  readonly maxTime: SimTime
  readonly rulesVersion: string
  readonly policyVersion: string
  readonly outboxMaxAttempts: number
  readonly outboxRetryDelayMs: number
  readonly maxDriveSteps: number
  readonly maxMicrostepsPerTime: number
  readonly phaseOrder: readonly SimulationEventPhase[]
  readonly maxOperationsPerDecision: number
  readonly maxResourceQuantity: import('./business-types.ts').SimulationQuantity
  readonly relationRules: readonly SimulationRelationRule[]
}
/** Immutable root creation responsibility, reserved before the Hub is invoked. */
export interface SimulationTeamReservation {
  readonly teamId: import('@clocky/clocky-team').TeamId
  readonly creation: import('@clocky/clocky-team').TeamRootCreateInput
  readonly confirmed: boolean
}
/** Current projection at an exact journal tail. */
export interface SimulationSnapshot {
  /** Durable stopping target and original bounded Host command receipts. */
  readonly runControl?: import('./run-control.ts').SimulationRunControlBook
  /** Last durable owner batch fact; it does not prove a live scheduler exists. */
  readonly driverObservation?: import('./driver-observation.ts').SimulationDriverObservation & { readonly revision: number }

  /** Original Host federation fence; absence leaves single-run scheduling unchanged. */
  readonly federationTime?: import('./federation-time.ts').SimulationFederationTime
  /** Immutable parent cut; all executable facts are initialized anew in this run. */
  readonly experiment?: import('./experiment.ts').SimulationExperimentInit

  readonly generationJobs?: Readonly<Record<string, import('./world-generation.ts').SimulationGenerationRecord>>
  readonly activationAdmissionBlocks?: readonly import('./activation-admission.ts').SimulationActivationAdmissionBlock[]
  readonly compactionAdmissionBlocks?: readonly import('./model-admission.ts').SimulationCompactionAdmissionBlock[]
  readonly world?: import('./world-types.ts').SimulationWorldState
  /** Original scenario initialization, including unresolved local application authority. */
  readonly worldBootstrap?: import('./world-bootstrap-types.ts').SimulationWorldBootstrapBook
  readonly maintenance?: Readonly<Record<import('./maintenance.ts').SimulationMaintenanceId, import('./maintenance.ts').SimulationMaintenanceOperation>>
  readonly taskCancellations?: Readonly<Record<SimulationOperationId,
    import('./task-cancellation.ts').SimulationTaskCancellationRecord>>
  readonly taskDecisionOwners?: Readonly<Record<SimulationDecisionId, { readonly attemptId: import('@clocky/clocky-team').TaskAttemptId
    readonly index: number }>>
  readonly taskExecutions?: Readonly<Record<import('@clocky/clocky-team').TaskAttemptId,
    import('./task-execution.ts').SimulationTaskExecution>>
  readonly checkpoints?: Readonly<Record<import('./checkpoint.ts').SimulationCheckpointId, import('./checkpoint.ts').SimulationCheckpointOperation>>
  readonly latestCheckpointId?: import('./checkpoint.ts').SimulationCheckpointId
  readonly management?: Readonly<Record<import('./management.ts').SimulationManagementId, import('./management.ts').SimulationManagementOperation>>
  readonly knowledge?: Readonly<Record<import('./knowledge.ts').SimulationKnowledgeId, readonly import('./knowledge.ts').SimulationKnowledge[]>>
  readonly capacityGrants?: Readonly<Record<import('./capacity.ts').SimulationCapacityGrantId, import('./capacity.ts').SimulationCapacityGrantRequest>>
  readonly tokenReservations?: Readonly<Record<import('./tokens.ts').SimulationTokenReservationId, import('./tokens.ts').SimulationTokenReservation>>
  readonly nextTokenSlot?: import('./scheduler-types.ts').SimulationEventSlot
  readonly budgetGrants?: Readonly<Record<import('./budget.ts').SimulationBudgetGrantId, import('./budget.ts').SimulationBudgetGrantRequest>>
  readonly decisionDispatch?: import('./dispatch.ts').SimulationDecisionDispatch
  readonly nextIngressSlot?: SimulationEventSlot
  readonly ingresses?: Readonly<Record<import('./ingress.ts').SimulationIngressId, SimulationIngress>>
  readonly activeWindowId?: import('./window.ts').SimulationWindowId
  readonly windows?: Readonly<Record<import('./window.ts').SimulationWindowId, SimulationWindow>>
  readonly channelReservations?: Readonly<Record<SimulationChannelKey, SimulationChannelReservation>>
  readonly teamReservation?: SimulationTeamReservation

  readonly spec: SimulationRunSpec
  readonly revision: number
  readonly phase: 'paused' | 'running' | 'stalled'
  readonly nextEventSlot: SimulationEventSlot
  readonly lastEventKey?: SimulationEventKey
  readonly scheduledEvents: Readonly<Record<SimulationEventId, SimulationScheduledEvent>>
  readonly wakes: Readonly<Record<SimulationEventId, SimulationWake>>
  readonly stall?: SimulationStall
  readonly time: SimTime
  readonly nextDecisionSlot: SimulationDecisionSlot
  readonly activeDecisionId?: SimulationDecisionId
  readonly decisions: Readonly<Record<SimulationDecisionId, SimulationDecision>>
  readonly operations: Readonly<Record<SimulationOperationId, SimulationOperation>>
  readonly resources: Readonly<Record<SimulationResourceId, SimulationResource>>
  /** Conserved held amounts and terminal history; expiry never depends on wall-clock time. */
  readonly resourceReservations: Readonly<Record<import('./resource-reservation.ts').SimulationResourceReservationId,
    import('./resource-reservation.ts').SimulationResourceReservation>>
  readonly interactions: Readonly<Record<SimulationInteractionId, SimulationInteraction>>
  readonly commitments: Readonly<Record<SimulationCommitmentId, SimulationCommitment>>
  readonly grants: Readonly<Record<SimulationGrantId, SimulationResourceGrant>>
  readonly entities: Readonly<Record<SimulationEntityId, SimulationEntity>>
  readonly relations: Readonly<Record<SimulationRelationId, SimulationRelation>>
}
/** Validated run selection before provider IO. */
export interface SimulationRunRequest {
  readonly provider: string
  readonly spec: SimulationRunSpec
  readonly mode: 'create' | 'open'
}
/** Resolved run request; no defaults are applied by the provider. */
export type SimulationRunSelection = SimulationRunRequest
/** Detached entity observation and the global run revision at which it was read. */
export interface SimulationEntitySnapshot {
  readonly runId: SimulationRunId
  readonly revision: number
  readonly entity?: SimulationEntity
}
/** One caller-owned live run; close drains accepted writes before releasing ownership. */
export interface SimulationRun {
  /**
   * Retry saving the same logical stopping command with a new physical checkpoint identity.
   * @param commandId - Original reached stopping command; its target and cut remain unchanged.
   * @param previousCheckpointId - Actual failed Native checkpoint; its history is never rewritten.
   * @param nextCheckpointId - Unused replacement identity bounded by the run's frozen attempt allowance.
   * @param authorize - Recheck Host authorization inside the Native queue.
   * @returns pending save state without starting inference or resuming; duplicate retry inputs return retained state.
   */
  retryRunControlCheckpoint(commandId: string, previousCheckpointId: string, nextCheckpointId: string,
    authorize?: () => void): Promise<import('./run-control.ts').SimulationRunControlState>


  /**
   * Record separate save disposition for the current reached, paused stop command.
   * @param commandId - Original command owning this save; stale callbacks reject.
   * @param checkpointId - Stable saving identity; later callbacks cannot substitute another identity.
   * @param status - Complete verified Native backup, actual failed checkpoint, or explicit missing external coverage.
   * @param authorize - Recheck Host authority inside the Native queue.
   * @returns retained control state; no inference or resume is started.
   */
  recordRunControlCheckpoint(commandId: string, checkpointId: string,
    status: 'completed' | 'failed' | 'external-state-required', authorize?: () => void): Promise<import('./run-control.ts').SimulationRunControlState>


  /**
   * Read one original stopping command without copying the command book or unrelated retained world.
   * @param commandId - Original Host command identity.
   * @returns detached original command/receipt, or undefined; does not mutate stopping state.
   */
  runControlCommandObservation(commandId: string): {
    readonly command: import('./run-control.ts').SimulationRunControlCommand
    readonly receipt: import('./run-control.ts').SimulationRunControlReceipt
  } | undefined

  /**
   * Read one original management receipt without copying unrelated retained state.
   * @param id - Exact original management identity.
   * @returns detached original operation or undefined; does not schedule or authorize work.
   */
  managementObservation(id: import('./management.ts').SimulationManagementId):
  import('./management.ts').SimulationManagementOperation | undefined

  /**
   * Observe only current-owner scheduling facts without copying or replaying historical state.
   * @param checkpointId - Optional exact preparation anchor; returns only its comparison metadata, never manifest bodies.
   * @returns detached bounded current control facts from this exclusive live owner; no ownership or execution is acquired.
   */
  controlObservation(checkpointId?: string): import('./control-observation-types.ts').SimulationControlObservation

  /**
   * Check a proposed original request against the retained stop target without changing any state.
   * @param request - Exact domain request; this check grants no authority and rewrites no payload.
   * @param responsibility - Original frozen case being reconciled or resolved, if any.
   * @returns nothing when the clock bound is provable; otherwise throws a correctable boundary refusal.
   */
  checkStopBoundary(request: import('./world-domain-types.ts').SimulationWorldDomainRequest,
    responsibility?: { readonly requestId: string }): void


  /**
   * Persist an authenticated Host stop-target update on the ordinary Native commit queue.
   * @param command - Idempotent command; changed inputs under an existing ID reject.
   * @param expectedRevision - Original control-cut revision; duplicate commands return their original receipt.
   * @param authorize - Recheck Host authorization inside the queue before returning or writing.
   * @returns original receipt; pending activation requires external reconciliation before it is effective.
   */
  updateRunControl(command: import('./run-control.ts').SimulationRunControlCommand, expectedRevision: number,
    authorize?: () => void): Promise<import('./run-control.ts').SimulationRunControlReceipt>


  /**
   * Persist one safe batch observation in the Native write queue. Settlements must match the last admitted owner/batch.
   * @param observation - Strict safe start or terminal observation.
   * @returns its authoritative journal revision; does not change Native scheduling phase.
   */
  recordDriverObservation(observation: import('./driver-observation.ts').SimulationDriverObservation): Promise<number>

  /**
   * Read the retained strict parser for pure model proposal preflight; never admits execution.
   * @param pin - Original exact pin selected into the current context.
   * @param kind - Request or apply-plan payload.
   * @returns original parser; unavailable or mismatched protocol identities reject.
   */
  worldPayloadSchema(pin: import('./world-domain-types.ts').SimulationWorldDomainPin,
    kind: 'request' | 'plan'): import('zod').z.ZodType

  /** Install a nonserializable Host time source. The returned capability is never a model/JSON setter.
   * @param ownerId - Stable original bridge owner.
   * @param resolve - Pure lookup of current authenticated durable mailbox evidence, or unavailable.
   * @returns live sync/dispose capability; disposal leaves the last durable Native fence intact.
   */
  bindFederationTime(ownerId: string, resolve: () => import('./federation-time.ts').SimulationFederationTime | undefined): import('./federation-time.ts').SimulationFederationTimeBinding

  /** Retain immutable provenance on an otherwise empty paused run before branch initialization.
   * @param request - Exact source commitment, bounded budget and explicit memory policy.
   * @returns paused snapshot; retries reject changed provenance and never allocate source identities.
   */
  initializeBranch(request: import('./experiment.ts').SimulationExperimentInit): Promise<SimulationSnapshot>

  /**
   * Retain target capacity and close the original assignment's new-work generation before maintenance IO.
   * @param request - Exact accepted plan and original maintenance owner.
   * @returns original immutable reservation; changed retries reject without another occupancy or fence.
   */
  reservePersonnel(request: import('./personnel-state.ts').PersonnelReserveRequest): Promise<import('./personnel-state.ts').PersonnelReservation>
  /**
   * Register the original cross-owner cut resolver; every live commit re-resolves its non-serializable authority in Native's queue.
   * @param owner - Exact durable maintenance owner selected by the prepared run.
   * @param resolve - Pure lookup for currently held original Team/channel cut proofs.
   * @returns disposer closing fresh proof admission; durable obligations remain retained.
   */
  onPersonnelCommitAuthority(owner: string, resolve: (proof: import('./personnel-state.ts').PersonnelCommitProof) =>
    import('./personnel-state.ts').PersonnelCommitEvidence | undefined): () => void
  /**
   * Commit the original ready personnel mutation and role directory under its exact held source cut.
   * @param id - Original retained reservation, not a caller-selected person or replacement plan.
   * @param proof - Non-serializable live original owner proof; JSON evidence cannot authorize the mutation.
   * @returns original atomic result; identical committed retries never create a second assignment or permission generation.
   */
  commitPersonnel(id: import('./world-domain-types.ts').WorldIntentId, proof: import('./personnel-state.ts').PersonnelCommitProof):
  Promise<import('./world-types.ts').SimulationWorldResult>
  /**
   * Settle an original retained personnel cancellation only after initiated maintenance has proven its IO stopped.
   * @param id - Exact original reservation; a new command cannot replace or release another obligation.
   * @returns the sole original cancelled result; uncertain retirement retains the fence, capacity and command responsibility.
   */
  settlePersonnelCancellation(id: import('./world-domain-types.ts').WorldIntentId): Promise<import('./world-types.ts').SimulationWorldResult>

  /**
   * Inventory original Native personnel duties without writing, cancelling, changing phase or starting cognition.
   * @param request - Exact person/assignment revision and complete output limits.
   * @returns a bounded Native report; canonical Team/Channel coverage remains explicitly required.
   */
  inspectPersonnelObligations(request: import('./personnel-obligations.ts').PersonnelObligationQuery):
  import('./personnel-obligations.ts').PersonnelObligationReport

  /**
   * Inspect current structural hiring admission without allocating identities, starting inference or publishing effects.
   * @param planId - Original accepted plan identity selected by the execution owner.
   * @returns a safe readiness reason; private policy text and committee records are not disclosed.
   */
  inspectWorldHireAuthorization(planId: import('./world-types.ts').WorldPlanId):
  { readonly allowed: true } | { readonly allowed: false; readonly reason: 'approval-required' | 'plan-stale' | 'authority-missing' }
  /** Retain an authenticated original quote before admitting its execution.
   * @param request - Complete original replacement command.
   * @param quoteRevision - Exact Native prefix quoted to the user.
   * @param quoteHash - Complete original product quote commitment.
   * @param principalId - Actual authenticated author supplied by the Host.
   * @returns the original durable command; exact retries never append again.
   */
  retainWorldCalendarCommand(request: import('./world-calendar.ts').SimulationCalendarRevisionRequest,
    quoteRevision: number, quoteHash: string, principalId: string): Promise<import('./world-calendar.ts').SimulationCalendarCommand>
  /** Cancel a retained command only while it has no accepted calendar revision.
   * @param commandId - Original command identity.
   * @param principalId - Actual original author.
   * @returns authoritative state; a raced application remains applied and is never undone.
   */
  cancelWorldCalendarCommand(commandId: string, principalId: string): Promise<SimulationSnapshot>
  /** Validate an inert calendar replacement against this exact Native prefix.
   * @param request - Original bounded replacement and command identity.
   * @returns original revision and exact affected event identities; no record is appended or model invoked.
   */
  previewWorldCalendar(request: import('./world-calendar.ts').SimulationCalendarRevisionRequest):
  { readonly revision: number
    readonly cancelled: readonly string[]
    readonly queued: readonly { readonly id: string; readonly time: string }[] }
  /** Replace only future unaccepted calendar occurrences while paused; original wakes and rules remain immutable.
   * @param request - Exact command identity, expected rule revision and bounded replacement schedule.
   * @param expectedRevision - Current Native revision; exact command retries retain their original result.
   * @param principalId - Actual authenticated Host principal, omitted only by trusted non-product callers.
   * @returns authoritative snapshot after one durable append, or rejects stale/conflicting input without effects.
   */
  reviseWorldCalendar(request: import('./world-calendar.ts').SimulationCalendarRevisionRequest,
    expectedRevision: number, principalId?: string): Promise<SimulationSnapshot>

  /**
   * Close a proposal from its frozen rules and independently accepted votes outside an active decision window.
   * @param proposalId - Original Native proposal identity; callers cannot choose an outcome, electorate or tally.
   * @returns the sole immutable resolution; its wake is retained in the same append batch and retries do not append.
   */
  closeWorldGovernance(proposalId: import('./world-domain-types.ts').WorldProposalId):
  Promise<import('./world-governance-types.ts').SimulationGovernanceResolution>
  /**
   * Close at an explicitly running scheduler boundary; recheck eligibility inside the Native write queue.
   * @param proposalId - Original proposal; an already retained resolution is returned unchanged.
   * @param options - Strict boundary mode; no caller-supplied outcome, count or timing policy is accepted.
   * @returns the original/new resolution, or undefined without append after pause, an open window, deadline or incomplete voting.
   */
  closeWorldGovernance(proposalId: import('./world-domain-types.ts').WorldProposalId, options: { readonly boundary: true }):
  Promise<import('./world-governance-types.ts').SimulationGovernanceResolution | undefined>
  /**
   * Publish a trusted owner fact into the sole Native journal; model tools cannot call this administrative capability.
   * @param request - Strict next version with exact predecessor, explicit audience and existing causal references.
   * @returns original immutable publication on an exact retry; changed versions or retroactive dates reject.
   * @remarks maxKnowledgeBytes bounds all fact versions together; maxKnowledgePerQuery bounds complete projections.
   */
  recordWorldFact(request: import('./world-facts-types.ts').SimulationWorldFactRequest):
  Promise<import('./world-facts-types.ts').SimulationWorldFact>
  /**
   * Read a complete reader-known projection without opening a writer, delivering a message or asserting understanding.
   * @param request - Existing reader with an explicit available cursor/time and finite complete-selection limit.
   * @returns detached exact publications and unknown requested identities; overflow rejects instead of truncating.
   */
  queryWorldFacts(request: import('./world-facts-types.ts').SimulationWorldFactQuery):
  import('./world-facts-types.ts').SimulationWorldFactProjection
  /**
   * Read complete authorized institution versions at an explicit Native cursor and simulated time.
   * @param request - Actual reader, retained prefix and finite completeness limit; hidden and absent versions stay unknown.
   * @returns detached approved bodies with independent effective state; this does not infer, notify or enact a policy.
   */
  queryWorldNorms(request: import('./world-norms-types.ts').SimulationNormQuery):
  import('./world-norms-types.ts').SimulationNormProjection
  /**
   * Retain an exact controller-attested Activation history refusal without releasing unknown startup ownership.
   * @param request - Canonical entity, original Hub limit facts and confirmed/unconfirmed cleanup outcome.
   * @returns immutable original refusal; new startups remain blocked by the retained hard history limit.
   */
  recordActivationAdmissionBlock(request: import('./activation-admission.ts').SimulationActivationAdmissionRequest):
  Promise<import('./activation-admission.ts').SimulationActivationAdmissionBlock>
  /**
   * Retain an authorized generation lifecycle transition without invoking a model.
   * @param change - Strict job request or original result transition.
   * @param authorize - Live host disclosure policy, checked in the Native queue before append.
   * @returns original durable responsibility; identical retries do not regenerate outputs.
   */
  transitionGeneration(change: import('./world-generation.ts').SimulationGenerationTransition,
    authorize: (job: import('./world-generation.ts').SimulationGenerationJob) => void):
  Promise<import('./world-generation.ts').SimulationGenerationRecord>
  /**
   * Freeze an installed world policy after canonical initial identities and private channels are prepared.
   * @param definition - Trusted fully resolved definition; model inputs never select their own execution role.
   * @param expectedRevision - Current journal tail; exact retries retain the original definition.
   * @returns current detached state; rejects changed definitions, missing authority relations or channels.
   */
  configureWorld(definition: import('./world-types.ts').SimulationWorldDefinition, expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Retain and atomically initialize the original scenario while preserving paused preparation.
   * @param request - Complete accepted original input; changed retries reject.
   * @param expectedRevision - Admission fence used before retaining a new original bootstrap.
   * @returns the completed original initialization; this never starts cognition or scheduling.
   */
  initializeWorld(request: import('./world-bootstrap-types.ts').SimulationWorldBootstrapRequest,
    expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Bootstrap a complete registered domain intent through its original Native policy.
   * @param actorId - Trusted canonical actor; product clients and model payloads cannot select this value.
   * @param request - Complete strict operation, business key, evidence and domain payload.
   * @returns immutable original intent; changed original inputs reject before any new case.
   */
  openWorldIntent(actorId: SimulationEntityId, request: import('./world-types.ts').SimulationWorldRequestOperation): Promise<import('./world-types.ts').SimulationWorldIntent>
  /**
   * Preview actual management dependencies and blockers without reserving or executing business work.
   * @param request - Exact current prefix and strict personnel action.
   * @param authority - Runtime-only current authentication and explicit management policy resolver.
   * @returns bounded actual quote, impact references and commitment hash; no business identity is allocated.
   */
  previewWorldManagement(request: import('./world-management-types.ts').SimulationWorldManagementPreviewRequest,
    authority: import('./world-management-types.ts').SimulationWorldManagementAuthority):
  Promise<import('./world-management-types.ts').SimulationWorldManagementPreview>
  /**
   * Revalidate and atomically retain one original authenticated user request and direct plan, without executing effects.
   * @param request - Caller-retained exact original action, command identity and preview commitment.
   * @param authority - Runtime-only live authority rechecked at the Native queue and immediately before append.
   * @returns the original stable business IDs and current optional callback/result facts; identical retries do not append.
   */
  submitWorldManagement(request: import('./world-management-types.ts').SimulationWorldManagementSubmitRequest,
    authority: import('./world-management-types.ts').SimulationWorldManagementAuthority):
  Promise<import('./world-management-types.ts').SimulationWorldManagementReceipt>
  /**
   * Read one retained original without executing or reconciling it.
   * @param commandId - Original user command identity, separate from model operation IDs.
   * @param principalId - Current authenticated principal supplied by the trusted caller, never an Entity cast.
   * @returns exact original IDs/current facts, or absence in this observed Native prefix only.
   */
  inspectWorldManagement(commandId: import('./world-management-types.ts').WorldManagementCommandId,
    principalId: import('@clocky/clocky-product-principal').ProductPrincipalId):
  import('./world-management-types.ts').SimulationWorldManagementReceipt | undefined
  /**
   * Retain a case-bound execution observation before a callback or after its definite disposition.
   * @param request - Exact original plan, finite observation and prior observation sequence (null before the first).
   * @returns original idempotent observation or the new durable fact; this never executes or settles business effects.
   */
  recordWorldExecution(request: import('./world-execution.ts').WorldExecutionRequest): Promise<import('./world-execution.ts').WorldExecutionObservation>
  /**
   * Inspect the complete supported name-only mutation footprint without acquiring a gate or writing.
   * @param targetId - Exact target object.
   * @returns Native-only local eligibility or an explicit whole-run maintenance reason.
   */
  inspectLocalObjectMutation?(targetId: SimulationEntityId): { readonly kind: 'local'; readonly owner: 'native' }
    | { readonly kind: 'maintenance'; readonly reason: 'related-object' | 'window-read-set-unknown' | 'window-overlap' }
  /**
   * Commit one accepted domain plan through its original pure Native reducer.
   * @param request - Original accepted plan and strictly registered mutation input; no caller-selected effects.
   * @param authorize - Optional synchronous owner fence checked inside the queue and immediately before append.
   * @returns original sole business result after an atomic commit, or rejects without partial changes.
   */
  commitWorldMutation(request: { readonly planId: import('./world-types.ts').WorldPlanId
    readonly payload: import('./world-domain-types.ts').SimulationWorldJsonValue }, authorize?: () => void):
  Promise<import('./world-types.ts').SimulationWorldResult>

  /**
   * Cancel an uncommitted case in the same queue as plan settlement and business execution.
   * Cancellation can invalidate a draining/sealed checkpoint reference without reopening production writes.
   * @param request - Original trusted command identity and case; model proposals cannot cancel cases.
   * @param authorize - Optional trusted current authorization recheck at the Native queue position; never a wire field.
   * @returns durable original receipt, or the prior terminal result; changed payloads reject. This does not delete identities or history.
   */
  cancelWorldCase(request: import('./world-types.ts').SimulationWorldCancelRequest, authorize?: () => void): Promise<import('./world-types.ts').SimulationWorldCancellation>
  /**
   * Reserve an original private conversation with an existing generation before canonical Channel IO.
   * @param planId - Exact accepted reuse plan, including a pending original representation generation.
   * @returns original contact; retries never allocate another Person, Session or Channel.
   */
  reserveExternalContact(planId: import('./world-types.ts').WorldPlanId): Promise<import('./world-external-types.ts').SimulationExternalContact>
  /**
   * Commit the original reuse contact after representation readiness and exact Channel confirmation.
   * @param id - Original case intent and retained conversation.
   * @returns original safe result and atomic requester wake; changed or cancelled preparation rejects.
   */
  commitExternalContact(id: import('./world-domain-types.ts').WorldIntentId): Promise<import('./world-types.ts').SimulationWorldResult>
  /**
   * Register the canonical owner for withdrawing one original shared-generation contact.
   * @param owner - Exact confirmed Native Team lifecycle owner.
   * @param verify - Drains accepted IO and proves an original keeper or sole-channel terminal state outside the Native queue.
   * @returns disposer; revoked evidence cannot authorize a later cancellation result.
   */
  onExternalContactCleanup(owner: string, verify: (contact: import('./world-external-types.ts').SimulationExternalContact) =>
  Promise<import('./world-external-types.ts').SimulationExternalContactCleanupEvidence>): () => void
  /**
   * Settle the original contact withdrawal without retiring its shared representative or another caller's channel.
   * @param id - Exact withdrawn contact intent retaining its original maintenance and IO responsibility.
   * @returns sole original cancellation result after canonical evidence and its notification wake append atomically.
   */
  settleExternalContactCancellation(id: import('./world-domain-types.ts').WorldIntentId):
  Promise<import('./world-types.ts').SimulationWorldResult>

  /**
   * Bind the original canonical cleanup owner for an uncommitted external representative.
   * @param owner - Confirmed Native Team activation lifecycle owner.
   * @param verify - Exact cross-owner terminal observations collected outside the Native write queue.
   * @returns disposer; evidence from a revoked owner cannot settle a cancellation.
   */
  onExternalRepresentativeCleanup(owner: string,
    verify: (reservation: import('./world-external-types.ts').SimulationExternalRepresentativeReservation) =>
    Promise<import('./world-hire-types.ts').SimulationWorldIdentityCleanupEvidence>): () => void
  /**
   * Reconcile and abandon only the original cancelled preparing representative without inference.
   * @param id - Original representative intent retaining cleanup and capacity responsibility.
   * @returns sole cancellation result after exact cleanup, lifecycle and result wake commit atomically.
   */
  settleExternalRepresentativeCancellation(id: import('./world-domain-types.ts').WorldIntentId):
  Promise<import('./world-types.ts').SimulationWorldResult>

  /**
   * Reserve an accepted simulated representative's canonical identities before all target IO.
   * @param request - Original accepted plan, exact maintenance owner and frozen model/member route.
   * @returns original immutable reservation; changed retries or an existing representative generation reject.
   */
  reserveExternalRepresentative(request: import('./world-hire-types.ts').SimulationWorldHireReserveRequest):
  Promise<import('./world-external-types.ts').SimulationExternalRepresentativeReservation>
  /**
   * Publish the original preparing Person and topology reservations after exact maintenance quiescence.
   * @param id - Native-retained original actor intent.
   * @returns original preparing record without activating or materializing a Session.
   */
  prepareExternalRepresentative(id: import('./world-domain-types.ts').WorldIntentId):
  Promise<import('./world-external-types.ts').SimulationExternalRepresentativeReservation>
  /**
   * Atomically commit representation, ready state and a safe first-contact result/wake after canonical receipts.
   * @param id - Original representative intent; cancellation never authorizes commit.
   * @returns original result on exact retry; unknown topology and stale authorization reject without effect.
   */
  commitExternalRepresentative(id: import('./world-domain-types.ts').WorldIntentId): Promise<import('./world-types.ts').SimulationWorldResult>
  /**
   * Reserve position capacity and every future identity for an accepted apply plan before external preparation IO.
   * @param request - Exact plan, trusted maintenance owner and frozen generated-member route.
   * @returns the original durable reservation; stale, unauthorized, cancelled, full or changed requests reject.
   */
  reserveWorldHire(request: import('./world-types.ts').SimulationWorldHireReserveRequest): Promise<import('./world-types.ts').SimulationWorldHireReservation>
  /**
   * Persist a declared existing-person hiring fee under its original plan before the atomic assignment commit.
   * @param planId - Exact latest accepted existing-person hiring plan; authority and approval are rechecked.
   * @returns original conserved hold on retry, or undefined for an explicitly free operation; no person is allocated.
   */
  reserveExistingHireResources(planId: import('./world-types.ts').WorldPlanId):
  Promise<import('./resource-reservation.ts').SimulationResourceReservation | undefined>
  /**
   * Enter identity preparation only under the reservation's quiescent maintenance owner.
   * @param id - Original business reservation identity.
   * @returns original identities and a preparing Entity; no ordinary writer, task or model is admitted.
   */
  prepareWorldHire(id: import('./world-domain-types.ts').WorldIntentId): Promise<import('./world-types.ts').SimulationWorldHireReservation>
  /** Confirm original prepared topology as an independent candidate, without assignment or payment.
   * @param id - Original generated-hire intent. @returns the same retained identity and its commit maintenance cut. */
  readyWorldCandidate(id: import('./world-domain-types.ts').WorldIntentId): Promise<import('./world-types.ts').SimulationWorldHireReservation>
  /**
   * Atomically settle assignment, readiness, structured result, first wake and reserved capacity.
   * @param id - Original prepared business reservation; caller reconciles actual Team IO before invoking this entry.
   * @returns sole original result after append; changed authority, reads, channel evidence or cancellation rejects.
   */
  commitWorldHire(id: import('./world-domain-types.ts').WorldIntentId): Promise<import('./world-types.ts').SimulationWorldResult>
  /**
   * Install the sole canonical Team owner that reconciles original identities and proves terminal cleanup.
   * @param owner - Exact activationLifecycleOwner from the confirmed Native Team reservation.
   * @param verify - Cross-owner reconciliation outside the run write queue; returns exact terminal observations without starting a model.
   * @returns an idempotent disposer; revoked evidence cannot authorize a later Native settlement.
   */
  onWorldHireCleanup(owner: string, verify: (reservation: import('./world-hire-types.ts').SimulationWorldHireReservation) =>
  Promise<import('./world-hire-types.ts').SimulationWorldIdentityCleanupEvidence>): () => void
  /**
   * Reconcile and atomically abandon a cancelled prepared hire through its registered canonical topology owner.
   * @param id - Original business reservation whose pending cancellation still retains capacity.
   * @returns sole original cancellation result after cleanup, abandoned readiness, lifecycle, receipts and result wake commit together.
   */
  settleWorldHireCancellation(id: import('./world-domain-types.ts').WorldIntentId): Promise<import('./world-types.ts').SimulationWorldResult>

  /**
   * Retain or recover one immutable checkpoint request before collecting owners.
   * @param request - Caller id, implementation version and bounded collection policy.
   * @returns retained request state; terminal retries do not repeat collection.
   */
  beginCheckpoint(request: import('./checkpoint.ts').SimulationCheckpointRequest): Promise<import('./checkpoint.ts').SimulationCheckpointOperation>
  /**
   * Retain a terminal collection failure without replacing the latest complete manifest.
   * @param id - Pending checkpoint request.
   * @param error - Concrete acquisition/publication failure.
   * @param diagnostic - Optional safe typed stage, category and source reference; raw failures remain private.
   * @returns retained failed request.
   */
  failCheckpoint(id: import('./checkpoint.ts').SimulationCheckpointId, error: string,
    diagnostic?: import('./checkpoint-diagnostics-types.ts').SimulationCheckpointDiagnostic): Promise<import('./checkpoint.ts').SimulationCheckpointOperation>
  /**
   * Block new mutations, drain admitted work and seal one quiescent run position.
   * @param maxDrainRounds - Positive bound on queue-stability observations during retirement cleanup.
   * @param signal - Optional cancellation of acquisition; admitted work continues and a returned cut still needs release.
   * @returns caller-owned cut; writers and decision windows must already be retired before sealing.
   */
  acquireCheckpointCut(maxDrainRounds: number, signal?: AbortSignal): Promise<import('./checkpoint-reference.ts').SimulationCheckpointCut>
  /**
   * Capture the physical journal position and full-state fingerprint under the run queue.
   * @param expectedRevision - Exact projection cursor already observed by the collector.
   * @returns current durable reference; this neither pins history nor stops later writes.
   */
  getPersistenceReference(expectedRevision: number): Promise<import('./checkpoint-reference.ts').SimulationRunPersistenceReference>
  /**
   * Execute or recover one durable pause/resume scheduling request.
   * New pause remains admissible during checkpoint collection and invalidates its old cut; running admission stays closed.
   * @param request - Immutable request id and desired phase; failed ids retain their original failure.
   * @returns historical terminal result; a retry never undoes a later management request.
   */
  managePhase(request: import('./management.ts').SimulationPhaseManagementRequest): Promise<import('./management.ts').SimulationManagementOperation>
  /**
   * Retain the original maintenance owner and close new execution before external draining.
   * @param request - Trusted immutable owner request; exact retries return its current historical state.
   * @returns durable responsibility; different payloads or another active owner reject. Existing decisions may settle.
   */
  beginMaintenance(request: import('./maintenance.ts').SimulationMaintenanceRequest): Promise<import('./maintenance.ts').SimulationMaintenanceOperation>
  /**
   * Record proven Native quiescence after the owner has drained external IO and retired writers.
   * @param request - Exact original maintenance request.
   * @returns retained quiescence; rejects until paused, window-free, with only released writers and no in-flight publication.
   */
  quiesceMaintenance(request: import('./maintenance.ts').SimulationMaintenanceRequest): Promise<import('./maintenance.ts').SimulationMaintenanceOperation>
  /**
   * Finish the original maintenance responsibility without resuming scheduling.
   * @param request - Exact original maintenance request; completed retries never release a newer owner.
   * @returns durable completion after another quiescence check; new readiness remains independently enforced.
   */
  finishMaintenance(request: import('./maintenance.ts').SimulationMaintenanceRequest): Promise<import('./maintenance.ts').SimulationMaintenanceOperation>

  /**
   * Inspect live entity population and actor capacity charged by durable writer state.
   * @returns non-terminated entities and reserved, active or not-yet-released actor slots.
   */
  population(): { readonly entities: number; readonly chargedActors: number }
  /**
   * Atomically retain external input, receipt order and its allocated future event key.
   * @param request - Stable retry id, target actor, attributed text and earliest availability.
   * @returns the retained ingress; identical retries preserve its assignment and changed payloads reject.
   */
  ingest(request: import('./ingress.ts').SimulationIngressRequest): Promise<SimulationIngress>
  /**
   * Acknowledge an exhausted conflict retry chain without resetting its budget or changing the failed result.
   * @param id - Operation that recorded retry exhaustion.
   * @param expectedRevision - Observed run tail.
   * @returns the retained acknowledgement; resuming the run remains explicit.
   */
  acknowledgeConflict(id: SimulationOperationId, expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Reconcile a retained unknown attempt from authoritative provider usage without replaying inference.
   * @param id - Original model-attempt reservation.
   * @param usage - Explicit provider-reported total input/output counts; settled values cannot be rewritten.
   * @returns the retained settlement; its original simulation interval remains charged.
   */
  reconcileTokenUsage(id: import('./tokens.ts').SimulationTokenReservationId, usage: import('./tokens.ts').SimulationTokenUsage):
  Promise<import('./tokens.ts').SimulationTokenReservation>
  /**
   * Acknowledge a reported reservation overrun without removing its actual charge.
   * @param id - Settled overrun identity.
   * @param expectedRevision - Required run cursor for new acknowledgement.
   * @returns updated state; resume also requires enough interval capacity to cover actual usage.
   */
  acknowledgeTokenOverrun(id: import('./tokens.ts').SimulationTokenReservationId, expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Inspect outstanding event/wake and unresolved interaction responsibilities.
   * @returns active counts and configured plus granted capacity; historical records do not consume slots.
   */
  queueUsage(): import('./capacity.ts').SimulationQueueUsage
  /**
   * Retain an explicit capacity addition without dropping responsibilities or implicitly resuming.
   * @param request - Stable addition identity, backlog kind, amount and reason.
   * @param expectedRevision - Required cursor for a new addition; exact retries preserve the original grant.
   * @returns updated durable state.
   */
  extendCapacity(request: import('./capacity.ts').SimulationCapacityGrantRequest, expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Read current interval usage from retained decisions, message intents and model reservations.
   * @returns consumed and granted capacity, including unresolved model reservations; decisions and messages are not refunded.
   */
  budgetUsage(): import('./budget.ts').SimulationBudgetUsage
  /**
   * Persist an explicit budget addition without resetting usage or implicitly resuming the run.
   * @param request - Stable identity, interval, amount and administrative reason.
   * @param expectedRevision - Required durable cursor for a new addition.
   * @returns the updated run; exact retries do not add capacity twice.
   */
  extendBudget(request: import('./budget.ts').SimulationBudgetGrantRequest, expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Persist an immutable decision nomination without starting cognition.
   * @param candidate - Administrative priority, deadline and optional consumed wake.
   * @returns the retained queue ticket; changed retry payloads reject.
   */
  queueDecision(candidate: import('./dispatch.ts').SimulationDispatchCandidate): Promise<import('./dispatch.ts').SimulationDispatchTicket>
  /**
   * Reserve fair decision order for one future window, independent of residency.
   * @param request - Stable window identity and explicit capacity.
   * @param expectedRevision - Required durable run cursor.
   * @returns the retained assignment, or undefined when no eligible candidate exists.
   */
  reserveDecisionWindow(request: import('./dispatch.ts').SimulationDispatchSelectionRequest, expectedRevision: number):
  Promise<import('./dispatch.ts').SimulationDispatchSelection | undefined>
  /**
   * Retire a queued candidate or its entire unopened reservation.
   * @param id - Candidate decision identity; opened windows use their decision cancellation protocol.
   * @param expectedRevision - Required durable run cursor.
   * @returns the updated durable run; cancelled identities cannot be reused.
   */
  cancelQueuedDecision(id: SimulationDecisionId, expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Atomically allocate ordered slots and freeze all authorized contexts before inference.
   * @param request - Distinct actors with live admission owners, stable ids and complete inputs.
   * @param expectedRevision - Observed run tail.
   * @returns the retained window; changed retry payloads reject.
   */
  openWindow(request: import('./window.ts').SimulationWindowRequest, expectedRevision: number): Promise<SimulationWindow>
  /**
   * Accept submitted slots in order, stopping at the first unfinished model decision.
   * @param id - Current window identity.
   * @returns the window; world effects remain blocked until all slots are accepted or cancelled.
   */
  commitWindow(id: import('./window.ts').SimulationWindowId): Promise<SimulationWindow>
  /**
   * Reserve a direct-channel identity before Team IO while the run is paused.
   * @param channel - Immutable ordered membership and limits for a stable retry key.
   * @param expectedRevision - Observed run tail; identical retries reuse their reservation.
   * @returns the projection with its reserved channel identity.
   */
  reserveChannel(channel: SimulationChannelSpec, expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Record successful Team attachment and all required endpoint consents.
   * @param key - Exact reserved retry key.
   * @param channelId - Matching active channel returned by the Team owner.
   * @param expectedRevision - Observed run tail.
   * @returns the confirmed reservation without changing membership.
   */
  confirmChannel(key: SimulationChannelKey, channelId: import('@clocky/clocky-team').ChannelId, expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Reserve permanent Participant and Session identities for an active cognitive entity.
   * @param entityId - Unbound entity in the confirmed canonical Team.
   * @param participant - Exact immutable local actor configuration.
   * @param expectedRevision - Observed run tail; equal retries reuse the reservation.
   * @returns the durable reservation in the entity projection.
   */
  reserveParticipant(entityId: SimulationEntityId, participant: import('./entity-types.ts').SimulationParticipantSpec,
    expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Reserve one canonical root Team identity before external creation.
   * @param creation - Exact immutable creation payload with this run's ownership rules.
   * @param expectedRevision - Observed run tail; exact retries reuse the reservation.
   * @returns the projection containing the durably minted Team identity.
   */
  reserveTeam(creation: import('@clocky/clocky-team').TeamRootCreateInput, expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Confirm the Hub's durable root creation before attachment, entity binding or execution.
   * @param teamId - Exact reserved Team returned by the Hub.
   * @param expectedRevision - Observed run tail.
   * @returns the confirmed immutable reservation.
   */
  confirmTeam(teamId: import('@clocky/clocky-team').TeamId, expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Record consumer reconciliation of a failed delivery without changing business commitments.
   * @param id - Publication with retained target failure.
   * @param resolution - Retained durable input, live-writer absence attestation, or irreversible entity termination.
   * @param expectedRevision - Observed run tail.
   * @returns the reconciled projection; an explicit phase resume remains required.
   */
  resolveDeliveryFailure(id: SimulationOperationId, resolution: { readonly kind: 'retained-input' | 'entity-terminated' }
    | { readonly kind: 'absent-input'; readonly epoch: import('./writer-types.ts').SimulationWriterEpoch },
    expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Retain definitive Hub delivery failure and halt before further simulated time passes.
   * @param id - Applied publication whose recipient transport ended.
   * @param record - Exact durable target expiry or abandonment evidence.
   * @param expectedRevision - Observed run tail.
   * @returns the stalled projection, preserving local input, wake and business responsibility.
   */
  recordDeliveryFailure(id: SimulationOperationId, record: import('@clocky/clocky-team').ChannelDeliveryExpiredRecord,
    expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Retain the authoritative target receipt after local input and wake durability.
   * @param id - Published operation with recorded recipient responsibility.
   * @param receipt - Exact Hub receipt for that recipient and Envelope.
   * @param expectedRevision - Observed run tail.
   * @returns the projection retaining the immutable receipt.
   */
  confirmDelivery(id: SimulationOperationId, receipt: import('@clocky/clocky-team').ChannelReceiptRecord,
    expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Record durable recipient input and its wake atomically before the Team receipt.
   * @param id - Applied publication whose input the consumer has flushed.
   * @param epoch - Current recipient writer that admitted the input.
   * @param expectedRevision - Observed run tail.
   * @returns the projection retaining exactly one delivery responsibility.
   */
  recordDelivery(id: SimulationOperationId, epoch: import('./writer-types.ts').SimulationWriterEpoch,
    expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Inspect one entity without copying unrelated run history.
   * @param id - Entity identity to look up.
   * @returns detached entity, or no entity for an unknown identity, with the same observation's run id/revision.
   */
  inspectEntity(id: SimulationEntityId): SimulationEntitySnapshot
  /**
   * Read a detached projection.
   * @returns current committed state.
   */
  snapshot(): SimulationSnapshot
  /**
   * Persist an administrative wake with a policy-derived ordering key.
   * @param request - Explicit entity, time, identity and reason.
   * @param expectedRevision - Observed run tail.
   * @returns the committed projection.
   */
  scheduleWake(request: SimulationWakeRequest, expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Cancel pending scheduled work without deleting its history.
   * @param id - Pending event identity.
   * @param reason - Recorded administrative explanation.
   * @param expectedRevision - Observed run tail.
   * @returns the committed projection.
   */
  cancelEvent(id: SimulationEventId, reason: string, expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Consume one bounded decision-event cohort before nominating its pending wakes.
   * @param request - Simulation horizon; collection never crosses a time, microstep or phase boundary while wakes remain.
   * @returns a decision requirement once the cohort is collected, or the same external/work-limit stops as drive.
   */
  collectDecisionWakes(request: SimulationDriveRequest): Promise<SimulationDriveResult>
  /**
   * Settle local operations and consume scheduled events up to an explicit target time.
   * @param request - Maximum simulation time to reach; work is bounded by the persisted run policy.
   * @returns the exact stop reason and committed tail.
   */
  drive(request: SimulationDriveRequest): Promise<SimulationDriveResult>
  /**
   * Create a fixed-unit resource through the trusted bootstrap path; proposals cannot mint quantities.
   * @param spec - Initial balance, owner and controller identities.
   * @param expectedRevision - Exact observed journal tail.
   * @returns the committed projection.
   */
  createResource(spec: SimulationResourceSpec, expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Apply an already accepted operation, or return its immutable prior result.
   * @param operationId - Run-owned durable operation identity.
   * @returns terminal result; incomplete prerequisites leave the operation pending and reject the call.
   */
  executeOperation(operationId: SimulationOperationId): Promise<SimulationOperationResult>
  /**
   * Dispatch an accepted, due communication through one idempotent Team transport outside the run write queue.
   * @param operationId - Accepted communication identity.
   * @param transport - Trusted target implementation honoring operation/payload deduplication.
   * @param clock - Real-time timestamp source for attempt and backoff records.
   * @returns terminal result, retry time or an explicit unknown outcome.
   */
  dispatchOperation(
    operationId: SimulationOperationId, transport: SimulationTeamTransport | import('./task-outbox.ts').SimulationTaskTransport, clock: () => number,
  ): Promise<SimulationDispatchResult>
  /**
   * Authorize another bounded retry budget for an unknown target outcome without changing payload or identity.
   * @param request - Exact original command, unknown operation, attempt-count fence, reason and accepted real timestamp.
   * @param authorize - Optional caller lease rechecked at the native queue and after IO.
   * @returns original immutable grant, including on exact retries after later attempts or phases; changed payloads reject.
   * First acceptance requires the current unknown due external intent. This never publishes or resumes scheduling.
   */
  retryOutbox(request: import('./outbox-retry.ts').SimulationOutboxRetryRequest,
    authorize?: () => void): Promise<import('./outbox-retry.ts').SimulationOutboxRetryGrant>
  /**
   * Compare-and-set the administrative phase. Failure leaves the projection unchanged.
   * @param phase - Requested phase.
   * @param expectedRevision - Exact tail observed by the caller.
   * @param authorize - Optional synchronous owner fence checked after queue admission, before any phase append.
   * @returns the committed projection.
   */
  setPhase(phase: 'paused' | 'running', expectedRevision: number, authorize?: () => void): Promise<SimulationSnapshot>
  /**
   * Retain one immutable attempt reservation and optional interaction linkage atomically before cross-owner assignment.
   * @param request - Accepted creation, canonical pending task, current writer identity and optional explicit accepted interaction.
   * @param expectedRevision - Run revision before first acceptance; exact retries return the retained reservation.
   * @returns durable responsibility for this task attempt.
   */
  reserveTaskExecution(request: import('./task-execution.ts').SimulationTaskExecutionRequest,
    expectedRevision: number): Promise<import('./task-execution.ts').SimulationTaskExecution>
  /**
   * Retain the accepted canonical cancellation before stopping its exact actor or awaiting busy work.
   * @param request - Exact source task and original Team cancellation snapshot, selected by its proof owner.
   * @returns original immutable native admission fence; retries cannot change the target or reason.
   */
  recordTaskCancellation(request: import('./task-cancellation.ts').SimulationTaskCancellation):
  Promise<import('./task-cancellation.ts').SimulationTaskCancellationRecord>
  /**
   * Retain the exact canonical assignment or settled attempt fact without repeating Hub effects.
   * @param observation - Reserved attempt and its current Team revision.
   * @returns retained responsibility and source evidence.
   */
  observeTaskExecution(observation: import('./task-execution.ts').SimulationTaskExecutionObservation):
  Promise<import('./task-execution.ts').SimulationTaskExecution>
  /**
   * Retain task instructions and ordered decision identity before creating its input.
   * @param request - Exact attempt, new decision, predecessor and canonical task instructions.
   * @returns immutable association; exact retries retain the original source selection.
   */
  associateTaskDecision(request: import('./task-execution.ts').SimulationTaskDecisionRequest):
  Promise<import('./task-execution.ts').SimulationTaskDecision>
  /**
   * Retain the identified task input after its queued or deterministic-consumed Session event has reached durable storage.
   * @param receipt - Exact task decision and prepared input identity.
   * @returns association with its immutable input receipt; no actor is woken by this method.
   */
  recordTaskInput(receipt: import('./task-execution.ts').SimulationTaskInputReceipt):
  Promise<import('./task-execution.ts').SimulationTaskDecision>
  /**
   * Select one immutable completion policy before evaluating a task's result.
   * @param attemptId - Exact retained task attempt.
   * @param policy - Registered scenario rule and generation selected by its trusted owner.
   * @returns retained policy selection; changing its generation on retry rejects.
   */
  selectTaskCompletionPolicy(attemptId: import('@clocky/clocky-team').TaskAttemptId,
    policy: import('./deterministic.ts').SimulationPolicyRef): Promise<import('./task-execution.ts').SimulationTaskExecution>
  /**
   * Retain a terminal policy result after independently checking its applied operation evidence.
   * @param request - Original attempt, selected policy, effect references and terminal outcome.
   * @param expectedRevision - Exact world snapshot evaluated by the policy before first acceptance.
   * @returns original immutable result intent; this method does not settle the Team attempt.
   */
  recordTaskResult(request: import('./task-completion.ts').SimulationTaskResultRequest,
    expectedRevision: number): Promise<import('./task-completion.ts').SimulationTaskResult>
  /**
   * Retire an unfinished attempt responsibility after canonical controller quiescence.
   * @param retirement - Exact original attempt, immutable controller evidence and interruption reason.
   * @returns retained retirement; this neither settles a Team attempt nor claims world completion.
   */
  retireTaskExecution(retirement: import('./task-execution.ts').SimulationTaskExecutionRetirement):
  Promise<import('./task-execution.ts').SimulationTaskExecution>
  /**
   * Reconcile one accepted interaction using an exact Simulation-created task revision.
   * @param request - Immutable creation, attempt and interaction revision facts; requireOpenCommitment rejects newer facts after closure.
   * @returns the updated interaction, preserving independent fulfillment rules.
   */
  reconcileTask(request: import('./task-evidence.ts').SimulationTaskReconcileRequest): Promise<import('./business-types.ts').SimulationInteraction>
  /**
   * Retain a versioned statement and attributed provenance, never a world mutation.
   * @param request - Expected knowledge revision, immutable owner/kind, temporal availability and audience.
   * @returns the new version; exact retries reuse the same retained version.
   */
  recordKnowledge(request: import('./knowledge.ts').SimulationKnowledgeRequest): Promise<import('./knowledge.ts').SimulationKnowledge>
  /**
   * Select bounded historical versions under both recorded and current audience permissions.
   * @param query - Viewer, fixed cursor, simulation time and result limit.
   * @returns available authorized knowledge; hidden and missing identities are both omitted.
   */
  queryKnowledge(query: import('./knowledge.ts').SimulationKnowledgeQuery): readonly import('./knowledge.ts').SimulationKnowledge[]
  /**
   * Commit an ordered administrative Entity/relation batch without publishing intermediate states.
   * @param commands - Nonempty validated changes; each observes earlier changes in the same batch.
   * @param expectedRevision - Required cursor before the first change.
   * @returns the final durable snapshot; validation or append failure publishes none of the batch.
   */
  changeMany(commands: readonly SimulationChange[], expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Apply one validated administrative entity or organization command atomically.
   * @param command - Requested mutation, independent of model proposals.
   * @param expectedRevision - Exact run journal tail observed by the caller.
   * @returns the committed detached projection.
   */
  change(command: SimulationChange, expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Inspect organization facts valid at one simulation time; does not expose a model-authorized view.
   * @param time - Canonical time within the run's configured range.
   * @param scope - Exact organization identity, null for unscoped facts, or omitted for all scopes.
   * @returns detached active relations in stable id order.
   */
  relationsAt(time: SimTime, scope?: SimulationEntityId | null): readonly SimulationRelation[]
  /**
   * Permanently bind a cognitive entity; all bindings in a run share one execution Team.
   * @param entityId - Entity selected by the trusted integration.
   * @param binding - Verified canonical Team identity.
   * @param expectedRevision - Observed run tail.
   * @returns the committed projection.
   */
  bindEntity(entityId: SimulationEntityId, binding: SimulationEntityBinding, expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Reserve the next epoch before invoking an activation provider.
   * @param entityId - Active cognitive entity with a canonical binding.
   * @param provider - Local runtime implementation verified by the integration.
   * @param reservationId - Durable Team startup reservation shared by this writer.
   * @param expectedRevision - Observed run tail.
   * @returns an epoch-scoped capability retained only by the controller.
   */
  reserveWriter(
    entityId: SimulationEntityId, provider: string, reservationId: ActivationReservationId, expectedRevision: number,
  ): Promise<SimulationWriterLease>
  /**
   * Recover an existing epoch without granting fresh decision authority.
   * @param entityId - Entity resolved from its canonical participant binding.
   * @param activation - Durable binding read by the controller.
   * @returns a capability for revocation and proven-quiescent release.
   */
  recoverWriter(entityId: SimulationEntityId, activation: SimulationWriterActivation): Promise<SimulationWriterLease>
  /**
   * Recover a Team startup that has no durable activation binding.
   * @param entityId - Entity resolved from the durable reservation's canonical identity.
   * @param reservation - Exact Team startup reservation.
   * @returns its writer lease, or undefined when this reservation never admitted runtime startup.
   */
  recoverUnpublishedWriter(
    entityId: SimulationEntityId, reservation: SimulationWriterReservation,
  ): Promise<SimulationWriterLease | undefined>
  /**
   * Install the single runtime retirement owner invoked outside the run write queue before close.
   * @param retire - Callback that revokes and fully stops associated activations without reentering close().
   * @returns disposer; removing it does not waive outstanding-writer checks.
   */
  onClose(retire: () => Promise<void>): () => void
  /**
   * Close admission and drain accepted writes. A handle used only for inspection may release ownership
   * with historical writers retained; any admitted mutation, recovery or retirement owner requires quiescence.
   * @returns completion after ownership release.
   */
  close(): Promise<void>
}

/** Immutable window input projection and ordered decision identities. */
export interface SimulationWindow {
  readonly id: import('./window.ts').SimulationWindowId
  readonly request: import('./window.ts').SimulationWindowRequest
  readonly snapshotRevision: number
  readonly time: SimTime
  readonly status: 'collecting' | 'closed'
}

/** Immutable external input receipt; delivery status belongs to its scheduled event and wake. */
export interface SimulationIngress {
  readonly request: import('./ingress.ts').SimulationIngressRequest
  readonly ordinal: SimulationEventSlot
  readonly eventId: SimulationEventId
  readonly key: SimulationEventKey
  readonly sequence: number
}
/** Replaceable named provider; owns all opened run lifetimes. */
export interface SimulationProvider {
  /**
   * Preserve an existing registered-source journal without interpreting its Native version or taking writable ownership.
   * @param selection - Fixed provider/run namespace; no caller filesystem paths.
   * @returns a bounded raw-only archive or absence; not a checkpoint or validated Native state.
   */
  rawArchive?(selection: import('./inspection.ts').SimulationInspectionSelection):
  Promise<import('./inspection.ts').SimulationRawArchiveObservation | undefined>

  /** Purely replay an immutable archive prefix with installed reducers, without storage or model IO.
   * @param input - Strict complete original prefix and exact spec/version.
   * @returns detached owner-validated snapshot; unsupported/malformed versions and budget overflow reject.
   */
  validateArchivePrefix?(input: import('./experiment.ts').SimulationArchivePrefix): SimulationSnapshot

  /** Explicit provider-owned pure World catalog; absent when this provider offers only base simulation. */
  readonly worldDomains?: import('./world-domain-registry.ts').SimulationWorldDomainRegistry<import('./world-native-types.ts').NativeWorldDomain> | undefined
  readonly name: string
  /**
   * Open or create an exclusively owned run.
   * @param selection - Fully resolved request.
   * @returns live run.
   */
  open(selection: SimulationRunSelection): Promise<SimulationRun>
  /**
   * Observe an existing run without writer ownership, creation or restoration.
   * @param selection - Resolved provider and immutable expected spec.
   * @returns detached history and observed owner, or undefined for a missing run; native consumers own authorization.
   */
  inspect?(selection: import('./inspection.ts').SimulationInspectionSelection): Promise<import('./inspection.ts').SimulationRunObservation | undefined>
  /**
   * Rebuild derived references from one existing exact prefix; never writes world facts.
   * @param selection - Existing provider/spec.
   * @param expectedRevision - Exact requested source prefix; changes reject.
   * @param authorize - Trusted caller fence checked immediately before publication admission.
   * @returns source manifest after atomic publication; retries of the same prefix are equivalent.
   */
  rebuildIndex?(selection: import('./inspection.ts').SimulationInspectionSelection, expectedRevision: number,
    authorize: () => void): Promise<import('./inspection.ts').SimulationIndexManifest>

  /**
   * Read original personnel duties against the installed pure domain manifest, without opening a run.
   * @param selection - Expected provider and immutable existing-run spec.
   * @param query - Exact person/assignment revisions and complete inventory bounds.
   * @returns one detached Native prefix and inventory, or undefined for absent history.
   */
  /**
   * Replay-only management preview; never acquires a run writer or creates missing history.
   * @param selection - Expected immutable existing run and provider.
   * @param request - Strict current-prefix action; there are no create/open or credential fields.
   * @param authority - Current runtime-only principal, management policy and source-cut resolver.
   * @returns bounded actual preview, or undefined when existing history is absent.
   */
  previewWorldManagement?(selection: import('./inspection.ts').SimulationInspectionSelection,
    request: import('./world-management-types.ts').SimulationWorldManagementPreviewRequest,
    authority: import('./world-management-types.ts').SimulationWorldManagementAuthority):
  Promise<import('./world-management-types.ts').SimulationWorldManagementPreview | undefined>
  inspectPersonnelObligations?(selection: import('./inspection.ts').SimulationInspectionSelection,
    query: import('./personnel-obligations.ts').PersonnelObligationQuery):
  Promise<import('./inspection.ts').SimulationPersonnelObligationObservation | undefined>

}
