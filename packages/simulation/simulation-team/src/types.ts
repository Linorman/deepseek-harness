/** Administrative local cognition connection; models never receive these capabilities. @module @clocky/clocky-simulation-team/types */
import type { SimulationContextRequest, SimulationContextPreparation } from '@clocky/clocky-simulation'
import type { ParticipantId } from '@clocky/clocky-team'
import type { SimulationEventId, SimulationDecision, SimulationDecisionId, SimulationEntityBinding, SimulationEntityId, SimulationProposal } from '@clocky/clocky-simulation'
import type { TeamActivationLease, TeamActivationRequest } from '@clocky/clocky-team-activation-controller'

/** Unpublished owner-reference set held behind the run and connection barriers. */
export interface SimulationCheckpointCollection {
  readonly snapshot: import('@clocky/clocky-simulation').SimulationSnapshot
  readonly run: import('@clocky/clocky-simulation').SimulationRunPersistenceReference
  readonly team: import('@clocky/clocky-team').TeamPersistenceReference
  readonly channels: readonly import('@clocky/clocky-team').TeamPersistenceReference[]
  readonly sessions: readonly ((import('@clocky/clocky-session-persistence').SessionPersistenceReference & { readonly kind: 'materialized' })
    | Extract<import('@clocky/clocky-simulation').SimulationCheckpointManifest['sessions'][number], { kind: 'unmaterialized' }>)[]
  /** Export the complete protected owner and attachment closure without deleting or compacting sources. */
  exportArchive(limits: { readonly maxEntries: number; readonly maxBytes: number; readonly pageSize: number }): Promise<import('./archive.ts').WorldArchiveBody>
  /**
   * Revalidate and publish this candidate for a request already retained in its run cut.
   * @param id - Pending checkpoint request captured by this candidate.
   * @returns the atomically completed request and manifest.
   */
  publish(id: import('@clocky/clocky-simulation').SimulationCheckpointId): Promise<import('@clocky/clocky-simulation').SimulationCheckpointOperation>
  /** Recheck every source before publication; source movement invalidates this candidate. */
  validate(): Promise<void>
  /** Release admission barriers without resuming scheduling or reactivating actors. */
  release(): void
}

/** Restored current state remains paused; the caller owns the returned run and must close it. */
export interface SimulationCheckpointRestoration {
  readonly run: import('@clocky/clocky-simulation').SimulationRun
  readonly connection: SimulationTeamConnection
  readonly manifest: import('@clocky/clocky-simulation').SimulationCheckpointManifest
}

/** Placement facts remaining after the integration derives all trusted entity identity. */
export type SimulationActivationRequest = Pick<TeamActivationRequest, 'provider' | 'agent' | 'signal'> & {
  readonly seed: { readonly kind: 'fresh' } | { readonly kind: 'resume' }
}
/** Durable queue result; in-flight denotes a live driver without a retained consumption result yet. */
export interface SimulationInputDispatch {
  readonly inputId: import('@clocky/clocky-session').SimulationContextViewEventData['inputId']
  readonly status: 'queued' | 'consumed' | 'in-flight'
}
/** Unconfirmed epochs remain charged; recovery names their owner, while capacity names the actor awaiting placement. */
export type SimulationResidencyResult = { readonly status: 'resident'; readonly lease: TeamActivationLease }
  | { readonly status: 'capacity' | 'recovery-required'; readonly entityId: SimulationEntityId }
/** Caller-owned placement and ordered eviction policy, outside model tools. */
export interface SimulationResidencyChoice {
  readonly activation: SimulationActivationRequest
  readonly evict: readonly SimulationEntityId[]
  /** Optional retained automatic idle policy; absent preserves the caller's exact candidate order. */
  readonly policy?: import('./residency-policy.ts').SimulationResidencyPolicy
}
/** A bounded coordinator stop; it never hides a sleeping recipient or technical retry deadline. */
export interface SimulationTeamDriveResult {
  readonly reason: Exclude<import('@clocky/clocky-simulation').SimulationDriveResult['reason'], 'dispatch-required' | 'delivery-required'>
    | 'retry' | 'outcome-unknown' | 'recipient-required' | 'recipient-busy' | 'coordination-limit'
    | 'resident-capacity' | 'residency-recovery-required'
  readonly rounds: number
  readonly steps: number
  readonly revision: number
  readonly operationId?: import('@clocky/clocky-simulation').SimulationOperationId
  readonly entityId?: SimulationEntityId
  readonly nextAttemptAt?: number
}

/** Result acceptance remains separate from the canonical Team receipt. */
export type SimulationTaskCompletionResult =
  | { readonly status: 'waiting'; readonly reason: string; readonly execution: import('@clocky/clocky-simulation').SimulationTaskExecution }
  | { readonly status: 'settled' | 'interrupted'; readonly execution: import('@clocky/clocky-simulation').SimulationTaskExecution }

/** Administrative review of one original completed attempt; identities resolve from the attached run. */
export interface SimulationTaskReviewRequest {
  /** Run-wide exact command retry identity. */
  readonly commandId: string
  readonly attemptId: import('@clocky/clocky-team').TaskAttemptId
  /** Active native entity bound to the task's frozen participant reviewer. */
  readonly reviewerEntityId: SimulationEntityId
  readonly expectedRevision: number
  readonly nextPhase: 'completed' | 'pending'
  readonly reason: string
}

/** One run's attachment to its canonical execution Team. */
export interface SimulationTeamConnection {
  /**
   * Execute one accepted tool-free generation using the dedicated canonical Session and shared model pool.
   * @param jobId - Original Native job; retained or unknown attempts are never regenerated.
   * @param authorize - Live input disclosure authorization, checked before dispatch and validation.
   * @param signal - Caller cancellation combined with connection shutdown.
   * @returns retained and validated output, or retained unknown responsibility on interrupted IO.
   */
  generate(jobId: string, authorize: (job: import('@clocky/clocky-simulation').SimulationGenerationJob) => void,
    signal?: AbortSignal): Promise<import('@clocky/clocky-simulation').SimulationGenerationRecord>

  /**
   * Settle only an originally reserved personnel mutation under actual canonical owner serializers and Native proof validation.
   * @param id - Original retained transfer/departure reservation identity; maintenance must already be quiescent.
   * @returns original atomic business result; unresolved duties or source movement preserve the reservation and fence.
   */
  commitPersonnel(id: import('@clocky/clocky-simulation').WorldIntentId): Promise<import('@clocky/clocky-simulation').SimulationWorldResult>

  /**
   * Inventory the selected original person's Native and canonical Team/Channel obligations without producing any work.
   * @param request - Exact person/assignment revisions and complete metadata output limits.
   * @returns source coverage and original responsibility references; complete coverage never grants transfer or departure authority.
   */
  inspectPersonnelObligations(request: import('@clocky/clocky-simulation').PersonnelObligationQuery):
  Promise<import('@clocky/clocky-simulation').PersonnelObligationReport>

  /**
   * Persist original case cancellation, drain accepted preparation and reconcile exact target cleanup before Native settlement.
   * @param request - Original trusted cancellation command; exact retries preserve its case and result.
   * @returns the retained receipt after proven cleanup, or the original already-resolved/committed result without further IO.
   * Unknown target outcomes reject while Native retains cancel-requested and occupancy; no model or automatic resume is performed.
   */
  cancelWorldCase(request: import('@clocky/clocky-simulation').SimulationWorldCancelRequest):
  Promise<import('@clocky/clocky-simulation').SimulationWorldCancellation>

  /**
   * Persist exclusive maintenance, drain accepted work and retire canonical writers through the checkpoint owner path.
   * @param request - Immutable Native maintenance owner request.
   * @param maxDrainRounds - Positive bound on retirement-queue stability observations.
   * @param maxAttempts - Total positive bound on fresh-cut attempts, including durable pause/cancel source movement.
   * @param signal - Optional cancellation; failure retains draining responsibility and never resumes scheduling.
   * @returns quiescent maintenance, or its historical completion; caller owns preparation and explicit finishMaintenance.
   */
  quiesceForMaintenance(request: import('@clocky/clocky-simulation').SimulationMaintenanceRequest,
    maxDrainRounds: number, maxAttempts: number, signal?: AbortSignal): Promise<import('@clocky/clocky-simulation').SimulationMaintenanceOperation>

  /**
   * Persist a request, collect owners and atomically publish its complete manifest.
   * @param request - Stable caller id, implementation identity and collector bounds.
   * @param signal - Optional cancellation before publication.
   * @returns retained completed/failed outcome; identical terminal retries perform no new work.
   */
  checkpoint(request: import('@clocky/clocky-simulation').SimulationCheckpointRequest, signal?: AbortSignal):
  Promise<import('@clocky/clocky-simulation').SimulationCheckpointOperation>
  /**
   * Pause and retire local actors, then collect and revalidate an unpublished owner-reference set.
   * @param maxDrainRounds - Run retirement-queue stability bound.
   * @param maxAttempts - Positive maximum attempts after cursor/source movement.
   * @param signal - Optional acquisition cancellation; returned candidates still require explicit release.
   * @param mode - 'quiescent' rejects live writers instead of pausing or retiring any owner.
   * @returns caller-owned candidate; this does not pin history or publish a manifest.
   */
  collectCheckpointCandidate(maxDrainRounds: number, maxAttempts: number, signal?: AbortSignal, mode?: 'quiescent'): Promise<SimulationCheckpointCollection>
  /**
   * Establish actor residency using caller-selected safe eviction candidates.
   * @param entityId - Required canonical actor.
   * @param choice - Explicit placement and ordered eviction candidates.
   * @returns a lease or capacity/recovery requirement; busy and unaccepted decisions are never evicted.
   */
  ensureResident(entityId: SimulationEntityId, choice: SimulationResidencyChoice): Promise<SimulationResidencyResult>
  /**
   * Drive transport and establish a demanded recipient's residency within the coordination bound.
   * @param request - Explicit simulated horizon.
   * @param clock - Real time for transport retries.
   * @param choose - Caller policy for a required recipient; it does not start inference.
   * @returns the next decision or explicit scheduling/capacity/recovery requirement.
   */
  driveResident(request: import('@clocky/clocky-simulation').SimulationDriveRequest, clock: () => number,
    choose: (entityId: SimulationEntityId) => SimulationResidencyChoice): Promise<SimulationTeamDriveResult>
  /**
   * Stop an idle actor after closing new input admission and draining accepted delivery work.
   * @param entityId - Actor with no open or submitted decision; repeated completed hibernation is harmless.
   * @returns confirmed Session flush and controller quiescence; uncertain cleanup retains capacity and rejects.
   */
  hibernate(entityId: SimulationEntityId): Promise<void>
  /**
   * Resume a proven-stopped actor in its existing canonical Session.
   * @param entityId - Entity with a released, previously bound activation.
   * @param request - Explicit provider, preset/model options and cancellation signal.
   * @returns the newly owned activation without starting a model turn.
   */
  resume(entityId: SimulationEntityId, request: Omit<SimulationActivationRequest, 'seed'>): Promise<TeamActivationLease>
  /**
   * Freeze ordered actor decisions and authorized contexts in one durable window.
   * @param request - Stable window id and distinct resident actors; budgets and Team cursor are connection-owned.
   * @returns the window before any model request.
   */
  openWindow(request: { readonly id: import('@clocky/clocky-simulation').SimulationWindowId
    readonly decisions: readonly { readonly id: SimulationDecisionId
      readonly entityId: SimulationEntityId
      readonly wakeId?: SimulationEventId
      readonly policy?: import('@clocky/clocky-simulation').SimulationPolicyRef
      readonly context: Omit<SimulationContextRequest, 'maxBytes' | 'teamCursor'> }[] }): Promise<import('@clocky/clocky-simulation').SimulationWindow>
  /**
   * Cancel this actor's unaccepted decision, releasing its wake for a later attempt.
   * @param entityId - Current writer owner.
   * @param id - Open or submitted decision.
   * @returns the retained cancellation.
   */
  cancelDecision(entityId: SimulationEntityId, id: SimulationDecisionId): Promise<SimulationDecision>
  /**
   * Compute a versioned pure policy using the same actor, context and operation authority as a model decision.
   * @param entityId - Canonical idle actor.
   * @param id - Stable decision identity; retained results are not recomputed.
   * @param context - Authorized material for first preparation.
   * @param policy - Exact registered policy generation; selected decisions cannot invoke a model.
   * @param wakeId - Optional pending wake owned by this entity.
   * @returns submitted/accepted/cancelled durable decision; effects remain executor-owned.
   */
  executeDeterministicDecision(entityId: SimulationEntityId, id: SimulationDecisionId,
    context: Omit<SimulationContextRequest, 'maxBytes' | 'teamCursor'>, policy: import('@clocky/clocky-simulation').SimulationPolicyRef,
    wakeId?: SimulationEventId): Promise<SimulationDecision>
  /**
   * Reserve and assign one exact task attempt without waking an actor or invoking a model.
   * @param request - Stable attempt identity, accepted creation, selected resident entity and optional explicit interaction.
   * @returns retained reservation and exact canonical assignment; an IO failure remains retryable with the same selection.
   */
  assignTask(request: { readonly attemptId: import('@clocky/clocky-team').TaskAttemptId
    readonly operationId: import('@clocky/clocky-simulation').SimulationOperationId
    readonly entityId: SimulationEntityId
    readonly interactionId?: import('@clocky/clocky-simulation').SimulationInteractionId
    readonly reportContinuation?: import('@clocky/clocky-simulation').SimulationTaskReportContinuation
    readonly leaseDurationMs: number }):
  Promise<import('@clocky/clocky-simulation').SimulationTaskExecution>
  /**
   * Cancel an exact accepted source task before draining its busy actor; no ordinary Team mutation authority is granted.
   * @param request - Current revision and exact live attempt, or null for pending/review work, with its original reason.
   * @param authorize - Optional current caller admission lease, rechecked before canonical mutation.
   * @returns canonical task after cancellation intent and affected actor cleanup; already accepted effects keep their identity.
   */
  cancelTask(request: { readonly operationId: import('@clocky/clocky-simulation').SimulationOperationId
    readonly expectedRevision: number
    readonly expectedAttemptId: import('@clocky/clocky-team').TaskAttemptId | null
    readonly reason?: string | undefined }, authorize?: () => void): Promise<import('@clocky/clocky-team').TeamTaskSnapshot>
  /**
   * Drive a recorded task decision through durable input, exact attempt start and scoped cognition.
   * @param request - Stable attempt/decision/predecessor, reason, optional deterministic policy and authorized scenario context.
   * @returns recorded decision; this does not infer task completion from submission or apply world effects.
   */
  executeTaskDecision(request: { readonly attemptId: import('@clocky/clocky-team').TaskAttemptId
    readonly decisionId: SimulationDecisionId
    readonly predecessor: SimulationDecisionId | null
    readonly reason: string
    readonly policy?: import('@clocky/clocky-simulation').SimulationPolicyRef
    readonly context: Omit<SimulationContextRequest, 'maxBytes' | 'teamCursor'> }): Promise<SimulationDecision>
  /**
   * Check the selected scenario completion policy and reconcile its immutable result with the original task.
   * @param request - Exact attempt and registered policy generation; changed policy retries reject.
   * @returns waiting, original target receipt or interruption without repeating world effects or inference.
   */
  completeTask(request: { readonly attemptId: import('@clocky/clocky-team').TaskAttemptId
    readonly policy: import('@clocky/clocky-simulation').SimulationPolicyRef }): Promise<SimulationTaskCompletionResult>
  /**
   * Resolve one retained completed result through its exact native reviewer binding, without activation or inference.
   * @param request - Stable command, original attempt, reviewer entity, task revision and decision.
   * @param authorize - Optional caller-owned admission lease, rechecked by the source proof around Hub policy IO and after owner waits.
   * @returns current canonical task retaining the original decision on an identical retry.
   * Changed payloads reject. Paused and running runs admit review; checkpoint collection and close withdraw authority.
   */
  reviewTask(request: SimulationTaskReviewRequest, authorize?: () => void): Promise<import('@clocky/clocky-team').TeamTaskSnapshot>
  /**
   * Read a canonical Simulation-created Team task revision and retain its exact attempt evidence for an accepted interaction.
   * @param interactionId - Interaction whose immutable linkage is being established or refreshed.
   * @param expectedRevision - Interaction revision before the source observation.
   * @param taskId - Task backed by this run's accepted creation receipt; its executor must match the interaction assignee.
   * @returns updated interaction; completion fulfills only the explicit task-completed policy.
   */
  reconcileTask(interactionId: import('@clocky/clocky-simulation').SimulationInteractionId, expectedRevision: number,
    taskId: import('@clocky/clocky-team').TeamTaskId): Promise<import('@clocky/clocky-simulation').SimulationInteraction>
  /**
   * Produce a source-scoped summary without reading an actor's or channel's ambient history.
   * @param entityId - Active knowledge owner; residency and model inference are not required.
   * @param policy - Exact registered pure summary policy.
   * @param request - Explicit input identities, audience, output identity and availability.
   * @returns the retained source-linked summary; unauthorized audiences reject before computation.
   */
  summarizeKnowledge(entityId: SimulationEntityId, policy: import('@clocky/clocky-simulation').SimulationPolicyRef,
    request: import('@clocky/clocky-simulation').SimulationSummaryRequest): Promise<import('@clocky/clocky-simulation').SimulationKnowledge>

  /**
   * Drive one prepared model decision to a submitted or accepted, durably completed turn.
   * @param entityId - Resident canonical actor.
   * @param id - Stable decision identity, retained for exact retries.
   * @param context - Authorized material for first preparation; retries reuse the recorded selection.
   * @param wakeId - Optional pending wake responsibility.
   * @returns submitted/accepted decision or timeout cancellation after its exact turn ends and flushes.
   * Missing submission or overflow rejects.
   */
  executeDecision(entityId: SimulationEntityId, id: SimulationDecisionId,
    context: Omit<SimulationContextRequest, 'maxBytes' | 'teamCursor'>, wakeId?: SimulationEventId): Promise<SimulationDecision>
  /**
   * Create or resume one reserved direct channel and obtain every canonical Session endpoint's consent.
   * @param request - Immutable ordered members and limits under a stable run-local retry key.
   * @returns the active channel after run confirmation; no Agent or model is started.
   */
  ensureChannel(request: import('@clocky/clocky-simulation').SimulationChannelSpec): Promise<import('@clocky/clocky-team').ChannelSnapshot>
  /**
   * Provision canonical local membership and bind its reserved Session without starting a model.
   * @param entityId - Active cognitive entity in the confirmed execution Team.
   * @param participant - Explicit immutable local actor configuration; conflicting retries reject.
   * @returns permanent binding, reconciling target response loss and partial membership transitions.
   */
  ensureParticipant(entityId: SimulationEntityId, participant: import('@clocky/clocky-simulation').SimulationParticipantSpec): Promise<SimulationEntityBinding>
  /**
   * Reconcile a recorded transport failure with durable recipient input without changing business commitments.
   * @param id - Published operation whose target failure halted the run.
   * @returns retained input, proven absence under a live writer, or irreversible recipient termination; resume remains explicit.
   */
  reconcileDeliveryFailure(id: import('@clocky/clocky-simulation').SimulationOperationId): Promise<'retained-input' | 'absent-input' | 'entity-terminated'>
  /**
   * Freeze the entity's canonical Session into channel creation options.
   * @param entityId - Active bound entity, resident or dormant.
   * @returns a required invitation selecting the permanent participant and Session.
   */
  invitation(entityId: SimulationEntityId): import('@clocky/clocky-team').ChannelInvitationOptions
  /**
   * Confirm the exact frozen endpoint without starting an Agent or requesting inference.
   * @param entityId - Canonical invited entity.
   * @param channelId - Direct-v4 channel containing its frozen Session endpoint.
   * @returns durable consent state; failure and expiry reject.
   */
  acknowledgeInvitation(entityId: SimulationEntityId, channelId: import('@clocky/clocky-team').ChannelId): Promise<import('@clocky/clocky-team').ChannelAdmissionSnapshot>
  /**
   * Drive local work and required Team publication/receipt until a bounded stop or cognition requirement.
   * @param request - Explicit simulation horizon.
   * @param clock - Real time for transport retry accounting.
   * @returns current scheduler, residency, retry or work-limit evidence.
   */
  drive(request: import('@clocky/clocky-simulation').SimulationDriveRequest, clock: () => number): Promise<SimulationTeamDriveResult>
  /**
   * Admit a published operation into its resident recipient's Session and record a wake before the Hub receipt.
   * @param id - Exact applied communication operation.
   * @returns the durable wake identity, shared by retries.
   */
  receiveOperation(id: import('@clocky/clocky-simulation').SimulationOperationId): Promise<SimulationEventId>
  /**
   * Publish one accepted due operation through the canonical Team Hub with its original identities.
   * @param id - Durable operation identity.
   * @param clock - Current real time for technical retry accounting.
   * @returns the retained receipt, retry deadline or unknown outcome.
   */
  dispatchOperation(id: import('@clocky/clocky-simulation').SimulationOperationId,
    clock: () => number): Promise<import('@clocky/clocky-simulation').SimulationDispatchResult>
  /**
   * Queue and flush the exact control input, then wake its canonical actor without duplicating consumed input.
   * @param entityId - Bound actor.
   * @param id - Prepared decision; already consumed input is reported without starting new work.
   * @returns durable queue/consumption evidence, or an explicit live in-flight observation.
   */
  dispatchDecision(entityId: SimulationEntityId, id: SimulationDecisionId): Promise<SimulationInputDispatch>
  /**
   * Freeze already-authorized context under the deployment byte budget before model admission.
   * @param entityId - Bound actor.
   * @param id - Current decision identity.
   * @param request - Authorized sections and provenance; Team cursor and budget are derived by this connection.
   * @returns the durable selection or explicit overflow; the pre-step owner appends and flushes successful views.
   */
  prepareContext(entityId: SimulationEntityId, id: SimulationDecisionId,
    request: Omit<SimulationContextRequest, 'maxBytes' | 'teamCursor'>): Promise<SimulationContextPreparation>
  /**
   * Allocate a serial decision slot using this entity's live controller-owned authority.
   * @param entityId - Bound actor.
   * @param id - Stable decision retry identity.
   * @param wakeId - Optional pending scheduled responsibility.
   * @returns durable slot and input reference.
   */
  openDecision(entityId: SimulationEntityId, id: SimulationDecisionId, wakeId?: SimulationEventId): Promise<SimulationDecision>
  /**
   * Accept effects only while the live Agent, participant and writer remain authorized.
   * @param entityId - Bound actor.
   * @param id - Open decision identity.
   * @param proposals - Ordered staged effects.
   * @returns durable acceptance without executing the effects.
   */
  submitDecision(
    entityId: SimulationEntityId, id: SimulationDecisionId, proposals: readonly SimulationProposal[],
  ): Promise<SimulationDecision>
  /**
   * Assign an unbound participant to an entity and mint its stable Session id server-side.
   * @param entityId - Cognitive entity in the attached run.
   * @param participantId - Active, previously unactivated participant in the canonical Team.
   * @returns the immutable binding.
   */
  bind(entityId: SimulationEntityId, participantId: ParticipantId): Promise<SimulationEntityBinding>
  /**
   * Activate using the Entity's durable participant and Session identity.
   * @param entityId - Bound cognitive entity.
   * @param request - Explicit placement and composition without caller-selected identity.
   * @returns the controller-owned activation lease.
   */
  activate(entityId: SimulationEntityId, request: SimulationActivationRequest): Promise<TeamActivationLease>
  /**
   * Reconcile the latest durable local epoch after prior coordinator exit or a committed quiescence proof.
   * @param entityId - Bound cognitive entity.
   * @returns completion after durable writer and Team retirement.
   */
  recover(entityId: SimulationEntityId): Promise<void>
  /**
   * Stop all accepted activations and detach; failed termination retains ownership.
   * @returns confirmed shutdown.
   */
  close(): Promise<void>
}

/** Model tools never select their own run, entity, writer or decision identity. */
export type SimulationModelRequest = { readonly kind: 'observe'; readonly detail?: 'full'; readonly sections?: readonly string[] }
  | { readonly kind: 'submit'; readonly notification?: { readonly resultId: string } }
  | { readonly kind: 'stage'; readonly proposals: readonly SimulationProposal[] }
/** Observation and proposal acknowledgement do not claim world effects have succeeded. */
export type SimulationModelResult =
  | { readonly status: 'observed'
    readonly time: string
    readonly sections: import('@clocky/clocky-session').SimulationContextSection[]
    readonly context?: { readonly inputId: string
      readonly hash: string } }
  | { readonly status: 'staged'; readonly count: number; readonly effects: 'none' }
  | { readonly status: 'accepted' | 'submitted'; readonly operationIds: import('@clocky/clocky-simulation').SimulationOperationId[]; readonly effects: 'pending' }
