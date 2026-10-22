/** Stable cognition bindings and epoch-scoped administrative capabilities. @module @clocky/clocky-simulation/writer-types */
import type { SimulationDecision, SimulationDecisionId, SimulationProposal } from './business-types.ts'
import type { SimulationEventId } from './scheduler-types.ts'
import type { Branded } from '@clocky/clocky-brand'
import type { ActivationId, ActivationReservationId } from '@clocky/clocky-team/types'
import type { SimulationEntityId } from './entity-types.ts'
import type { SimulationWriterEpoch } from './identities.ts'
import type { SimulationEntityBinding } from './binding-types.ts'
export type { SimulationEntityBinding } from './binding-types.ts'
export type { SimulationWriterEpoch } from './identities.ts'

/** Identity of one exclusively owned open-run lifetime. */
export type SimulationCoordinatorId = Branded<'SimulationCoordinatorId'>
/** Durable writer ownership; revoked/unknown epochs remain reserved until proven stopped. */
export interface SimulationWriter {
  readonly epoch: SimulationWriterEpoch
  readonly coordinatorId: SimulationCoordinatorId
  readonly reservationId: ActivationReservationId
  readonly provider: string
  readonly phase: 'reserved' | 'active' | 'revoked' | 'released'
  readonly activationId?: ActivationId
}
/** Durable startup selected before any runtime can execute. */
export interface SimulationWriterReservation extends SimulationEntityBinding {
  readonly reservationId: ActivationReservationId
  readonly provider: string
}
/** Exact activation facts supplied by the controller after durable bind. */
export interface SimulationWriterActivation extends SimulationWriterReservation {
  readonly activationId: ActivationId
}
/** Controller-owned capability for one reserved writer epoch; never passed to model tools. */
export interface SimulationWriterLease {
  /**
   * Retain an auxiliary compaction refusal without inventing a model call or world decision.
   * @param request - Flushed request event and transaction attested by the canonical compaction owner.
   * @param pool - Exact full pool/queue facts; original transaction retries preserve the complete payload.
   * @param requestHash - SHA-256 of the complete recorded compaction request event data.
   * @returns original refusal; any current unsubmitted owned decision is cancelled and its wake returned atomically.
   */
  blockCompactionModelAdmission(request: import('./tokens.ts').SimulationCompactionTokenRequest,
    pool: import('./model-admission.ts').SimulationModelPoolUsage,
    requestHash: string): Promise<import('./model-admission.ts').SimulationCompactionAdmissionBlock>
  /**
   * Cancel an undispatched model attempt and return its wake before persisting the capacity stop.
   * @param id - Current owned decision whose flushed Session request was refused by the live model pool.
   * @param block - Exact Session position and observed full pool/queue; exact retries retain the original evidence.
   * @returns cancelled decision; only an explicit new scheduling intent may retry its returned wake.
   */
  blockModelAdmission(id: SimulationDecisionId, block: import('./model-admission.ts').SimulationModelAdmissionBlock): Promise<SimulationDecision>
  /** Cancel and retain a canonical context failure without retrying inference.
   * @param id - Current owned unsubmitted prepared decision.
   * @returns cancelled decision and durable stop; closes its window when every slot is settled.
   */
  failContextIntegrity(id: SimulationDecisionId): Promise<SimulationDecision>
  /** Cancel an undispatched oversized request and return its wake atomically.
   * @param id - Current owned decision.
   * @param block - Measurement bound to its original durable Session request.
   * @returns the retained cancelled decision; identical retries do not append.
   */
  blockRequestBudget(id: SimulationDecisionId, block: import('./model-admission.ts').SimulationRequestBudgetBlock): Promise<SimulationDecision>
  /**
   * Reserve interval tokens for one logged, owner-attested compaction call without opening a world decision.
   * @param request - Canonical compaction id and durable request-event position.
   * @returns a separately charged auxiliary attempt; caller must validate the Session ownership reference.
   */
  reserveCompactionTokens(request: import('./tokens.ts').SimulationCompactionTokenRequest): Promise<import('./tokens.ts').SimulationTokenReservation>

  /**
   * Materialize selected report bodies whose canonical originals were compacted out of the model prefix.
   * @param id - Current prepared decision; input identity, source versions and snapshot remain fixed.
   * @param reports - Nonempty subset of its referenced report operations.
   * @returns the rebudgeted context or a durable required-content overflow.
   */
  materializeCompactedReports(id: SimulationDecisionId, reports: readonly import('./business-types.ts').SimulationOperationId[]):
  Promise<import('./context.ts').SimulationContextPreparation>
  /**
   * Validate a Session view against this decision's current or retained prior presentation.
   * @param id - Current owned decision.
   * @param view - Existing Session view about to be replaced.
   * @returns completion when the view is an authoritative presentation of this decision.
   */
  validateContextPresentation(id: SimulationDecisionId, view: import('@clocky/clocky-session/types').SimulationContextViewEventData): Promise<void>

  /**
   * Select a deterministic policy for a prepared decision before any model request.
   * @param id - Current owned decision.
   * @param policy - Immutable registered policy generation; a selected decision cannot switch back to inference.
   * @returns the retained decision and policy choice.
   */
  selectDeterministicPolicy(id: SimulationDecisionId, policy: import('./deterministic.ts').SimulationPolicyRef): Promise<SimulationDecision>
  /**
   * Record complete deterministic output without applying its effects.
   * @param id - Owned prepared decision with a selected policy.
   * @param proposals - Complete policy output; exact retries preserve the existing result.
   * @returns the retained decision, ready for ordinary ordered submission and acceptance.
   */
  recordDeterministicResult(id: SimulationDecisionId, proposals: readonly SimulationProposal[]): Promise<SimulationDecision>

  /**
   * Reserve configured token capacity before dispatching one model attempt.
   * @param id - Current prepared decision with a started inference deadline.
   * @param request - Exact flushed Session prefix and provider/model; each call allocates a new attempt.
   * @returns the durable reservation, independently charged from model concurrency.
   * @throws SimulationDecisionPausedError when recorded pause closes this otherwise eligible model decision.
   */
  reserveModelTokens(id: SimulationDecisionId, request: import('./tokens.ts').SimulationTokenRequest):
  Promise<import('./tokens.ts').SimulationTokenReservation>
  /**
   * Settle an owned attempt after stream cleanup, including after writer revocation.
   * @param id - This epoch's retained reservation.
   * @param outcome - Proven non-dispatch, incomplete usage, or the complete provider result.
   * @returns the retained result; known usage cannot be replaced by different values.
   */
  settleModelTokens(id: import('./tokens.ts').SimulationTokenReservationId, outcome: import('./tokens.ts').SimulationTokenOutcome):
  Promise<import('./tokens.ts').SimulationTokenReservation>

  /**
   * Persist the absolute deadline before the first model request; subsequent steps reuse it.
   * @param id - Current prepared decision.
   * @param now - Observed real time in milliseconds.
   * @returns retained timing independent of simulated time.
   */
  startDecision(id: SimulationDecisionId, now: number): Promise<NonNullable<SimulationDecision['inference']>>
  /**
   * Record timeout for an open inference whose deadline has passed.
   * @param id - Owned decision.
   * @param now - Observed real time in milliseconds.
   * @returns the current decision; completed submissions and earlier cancellation remain unchanged.
   */
  expireDecision(id: SimulationDecisionId, now: number): Promise<SimulationDecision>
  readonly entityId: SimulationEntityId
  readonly epoch: SimulationWriterEpoch
  /** True only after a new exclusive coordinator has replaced the epoch's owner lifetime. */
  readonly priorCoordinatorExited: boolean
  /**
   * Install the single live permission check used inside the decision write queue.
   * @param consumption - Optional canonical Session verifier; it performs flush IO outside the Native write queue.
   * @param authorize - Non-reentrant check of the current Agent and Team authority; must not write to this run.
   */
  bindDecisionAdmission(authorize: () => Promise<void>,
    consumption?: (decision: SimulationDecision) => Promise<import('./context-consumption.ts').SimulationContextConsumption>): void
  /**
   * Ask the bound Session owner to verify and flush exact input consumption before retaining its receipt.
   * @param id - Current prepared decision owned by this writer.
   * @returns immutable evidence; rejects without the trusted verifier or after authority/context changes.
   */
  recordContextConsumption(id: SimulationDecisionId): Promise<import('./context-consumption.ts').SimulationContextConsumption>
  /**
   * Allocate the next serial slot and fix its input revision before inference.
   * @param id - Stable caller-selected decision retry identity.
   * @param expectedRevision - Observed run tail.
   * @param wakeId - Optional pending scheduled responsibility owned by this entity.
   * @returns the durable slot and snapshot reference.
   */
  openDecision(id: SimulationDecisionId, expectedRevision: number, wakeId?: SimulationEventId): Promise<SimulationDecision>
  /**
   * Accept a complete proposal and all initial operation intents atomically.
   * @param id - This writer's open decision.
   * @param proposals - Ordered effects and causal prerequisites.
   * @returns durable acceptance; identical retries return its existing result.
   */
  submitDecision(id: SimulationDecisionId, proposals: readonly SimulationProposal[]): Promise<SimulationDecision>
  /**
   * Freeze an authorized context selection, or durably stall if required content exceeds its byte budget.
   * @param id - This writer's current decision.
   * @param request - Exact candidates and explicit policy; retries must preserve them.
   * @returns the retained preparation, independent of Session delivery or input consumption.
   */
  prepareContext(id: SimulationDecisionId, request: import('./context.ts').SimulationContextRequest): Promise<import('./context.ts').SimulationContextPreparation>
  /**
   * Read the frozen context only while the writer, entity, decision and selected knowledge/World scope access still admit inference.
   * @param id - Current decision identity.
   * @returns immutable prepared selection; this does not prove input consumption.
   * @throws SimulationDecisionPausedError when recorded pause closes this otherwise eligible model decision.
   */
  readPreparedContext(id: SimulationDecisionId): Promise<Extract<import('./context.ts').SimulationContextPreparation, { status: 'prepared' }>>
  /**
   * Cancel an unaccepted slot without rewinding its durable position.
   * @param id - This writer's open decision.
   * @returns durable cancellation.
   */
  cancelDecision(id: SimulationDecisionId): Promise<SimulationDecision>
  /**
   * Cancel only a current prepared model decision after recorded scheduling pause, retaining all token charges.
   * @param id - Exact decision of this live writer; foreign or retired ownership rejects.
   * @returns original paused cancellation, or undefined when this decision is not eligible at the queue.
   */
  cancelDecisionForPause(id: SimulationDecisionId): Promise<SimulationDecision | undefined>
  /**
   * Admit this epoch after its exact Team/Participant/Session binding is durable.
   * @param activation - Controller-observed activation identity.
   * @returns completion after writer authority is durable.
   */
  activate(activation: SimulationWriterActivation): Promise<void>
  /**
   * Revoke new decisions before stopping its runtime.
   * @returns durable revocation.
   */
  revoke(): Promise<void>
  /**
   * Release only after the controller proves quiescence or that startup never ran.
   * @returns durable release.
   */
  release(): Promise<void>
}
