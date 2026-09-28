import type { SimulationDispatchResult, SimulationTeamTransport } from './outbox-types.ts'
import type { SimulationDriveRequest, SimulationDriveResult, SimulationEventId, SimulationEventKey, SimulationEventPhase, SimulationEventSlot, SimulationScheduledEvent, SimulationStall, SimulationWake, SimulationWakeRequest } from './scheduler-types.ts'
import type { SimulationCommitment, SimulationCommitmentId, SimulationInteraction, SimulationInteractionId, SimulationDecision, SimulationDecisionId, SimulationDecisionSlot, SimulationGrantId, SimulationOperation, SimulationOperationId, SimulationOperationResult, SimulationResource, SimulationResourceGrant, SimulationResourceId, SimulationResourceSpec } from './business-types.ts'
/** Durable simulation run identities and provider contracts. @module @clocky/clocky-simulation/types */
import type { SimulationChange, SimulationEntity, SimulationEntityId, SimulationRelation, SimulationRelationId, SimulationRelationRule } from './entity-types.ts'
import type { SimulationEntityBinding, SimulationWriterActivation, SimulationWriterLease, SimulationWriterReservation } from './writer-types.ts'
import type { ActivationReservationId } from '@clocky/clocky-team'
import type { Branded } from '@clocky/clocky-brand'

/** Stable identity within one simulation provider's storage root. */
export type SimulationRunId = Branded<'SimulationRunId'>
/** Stable run-local retry identity for a configured direct channel. */
export type SimulationChannelKey = Branded<'SimulationChannelKey'>
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
/** Canonical non-negative decimal simulation time; compare numerically. */
export type SimTime = Branded<'SimTime'>
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
   * Retain or recover one immutable checkpoint request before collecting owners.
   * @param request - Caller id, implementation version and bounded collection policy.
   * @returns retained request state; terminal retries do not repeat collection.
   */
  beginCheckpoint(request: import('./checkpoint.ts').SimulationCheckpointRequest): Promise<import('./checkpoint.ts').SimulationCheckpointOperation>
  /**
   * Retain a terminal collection failure without replacing the latest complete manifest.
   * @param id - Pending checkpoint request.
   * @param error - Concrete acquisition/publication failure.
   * @returns retained failed request.
   */
  failCheckpoint(id: import('./checkpoint.ts').SimulationCheckpointId, error: string): Promise<import('./checkpoint.ts').SimulationCheckpointOperation>
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
   * @param request - Immutable request id and desired phase; failed ids retain their original failure.
   * @returns historical terminal result; a retry never undoes a later management request.
   */
  managePhase(request: import('./management.ts').SimulationPhaseManagementRequest): Promise<import('./management.ts').SimulationManagementOperation>
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
   * @param operationId - Unknown communication.
   * @param reason - Recorded administrative recovery decision.
   * @param wallTime - Real timestamp at which retries become eligible.
   * @param expectedRevision - Observed run tail.
   * @returns the committed projection; resuming a stalled run remains explicit.
   */
  retryOutbox(operationId: SimulationOperationId, reason: string, wallTime: number, expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Compare-and-set the administrative phase. Failure leaves the projection unchanged.
   * @param phase - Requested phase.
   * @param expectedRevision - Exact tail observed by the caller.
   * @returns the committed projection.
   */
  setPhase(phase: 'paused' | 'running', expectedRevision: number): Promise<SimulationSnapshot>
  /**
   * Retain a task revision read from its authoritative Team owner by the run coordinator.
   * @param request - Exact source fact and interaction revision; never model-supplied evidence.
   * @returns updated interaction with task execution and independent commitment state.
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
  readonly name: string
  /**
   * Open or create an exclusively owned run.
   * @param selection - Fully resolved request.
   * @returns live run.
   */
  open(selection: SimulationRunSelection): Promise<SimulationRun>
}
