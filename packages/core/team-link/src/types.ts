import type { ChannelInvitationSnapshot, ChannelInvitationAcknowledgeInput, ChannelAdmissionSnapshot, ChannelSnapshot } from '@clocky/clocky-team'
/** Team Link provider, client, and connection-request types. @module @clocky/clocky-team-link/types */

import type {
  ActivationBindingSnapshot,
  ChannelDeliveryClaim,
  ChannelId,
  ChannelPostIdempotencyKey,
  ChannelReceiptRecord,
  EnvelopeId,
  TaskAttemptId,
  TaskAttemptFailure,
  TaskAttemptResult,
  TeamInterruptId,
  TeamTaskId,
  TeamTaskSnapshot,
  TeamTaskCancellationSnapshot,
  TeamEnvelope,
  TeamEnvelopeDraft,
  ParticipantInterruptSnapshot,
} from '@clocky/clocky-team'
import type { Branded } from '@clocky/clocky-brand'

/** Opaque provider-issued identifier for one live Link notification delivery. */
export type TeamLinkDeliveryId = Branded<'TeamLinkDeliveryId'>

/** Structured reason sent by a Hub when a remote Link must stop admission. */
export interface TeamLinkTerminationReason {
  /** Stable transport or lifecycle classification for the requested stop. */
  readonly code: string
  /** Bounded human-readable explanation for the remote endpoint. */
  readonly message: string
}

/** One pending soft participant interrupt delivered to a bound Link consumer. */
export interface TeamLinkInterruptNotification {
  /** Link-issued delivery correlation retained until acknowledgement or Link closure. */
  readonly deliveryId: TeamLinkDeliveryId
  /** Durable command targeting this Link's exact activation binding. */
  readonly interrupt: ParticipantInterruptSnapshot
}

/** Durable task cancellation delivered only to its selected activation owner. */
export interface TeamLinkTaskCancellationNotification {
  /** Task carrying the still-active attempt. */
  readonly taskId: TeamTaskId
  /** Current non-terminal execution phase. */
  readonly phase: 'assigned' | 'running'
  /** Latest task revision selected for acknowledgement. */
  readonly revision: number
  /** Accepted cancellation and its immutable work selection. */
  readonly cancellation: TeamTaskCancellationSnapshot
}

/** Exact active attempt acknowledged after the owner stops work and releases its allocation. */
export interface TeamLinkTaskCancellationAcknowledgeRequest {
  /** Task carrying the accepted cancellation. */
  readonly taskId: TeamTaskId
  /** Exact cancelled attempt; an older attempt cannot settle current work. */
  readonly attemptId: TaskAttemptId
  /** Task revision observed with the notification. */
  readonly expectedRevision: number
}

/** Provider-selected request to connect one durable activation binding snapshot. */
export interface TeamLinkConnectRequest {
  /** Registered Team Link provider selected by the caller. */
  readonly provider: string
  /**
   * Connection-time activation, Session, and AgentRuntime provider snapshot.
   * Its activation id, Team, Participant, Session, and provider identify the
   * Link; the residency status is rechecked by the provider because it can
   * change while a Link remains connected.
   */
  readonly binding: ActivationBindingSnapshot
  /** Optional cancellation before the provider publishes a Link. */
  readonly signal?: AbortSignal
  /**
   * Optional endpoint-owned handler for a Hub termination request. The handler
   * must stop new Team delivery and any current model work owned by this Link;
   * returning resolves the cooperative acknowledgement, while rejection
   * reports that the endpoint could not accept the request.
   * @param reason - Hub-provided lifecycle reason.
   * @returns resolution after the endpoint has stopped Link-owned admission.
   */
  readonly onTerminate?: (reason: TeamLinkTerminationReason) => Promise<void>
}

/** Authenticated channel-admission fields forwarded through one bound Link. */
export interface TeamLinkPostRequest {
  /** Optional channel-WAL cursor observed before requesting admission. When omitted, the Hub resolves its current cursor. */
  readonly expectedCursor?: number
  /** Opaque sender-scoped key retained across reconnect after an uncertain post result. */
  readonly idempotencyKey: ChannelPostIdempotencyKey
  /** Unstamped Envelope fields; the Link derives its sender from {@link TeamLink.binding}. */
  readonly draft: TeamEnvelopeDraft
}

/** Model-final fields admitted atomically through one activation-bound Link. */
export interface TeamLinkFinalResultRequest {
  /** Product direct channel selected by the model. */
  readonly channelId: ChannelId
  /** Opaque retry key derived from the model tool-call lineage. */
  readonly idempotencyKey: ChannelPostIdempotencyKey
  /** Non-empty human-visible final text. */
  readonly text: string
}

/**
 * Task-attempt facts supplied by a client after it claims a durable
 * task-assignment Envelope. The Link derives every caller identity fact from
 * its immutable activation binding.
 */
export interface TeamLinkTaskAttemptStartClaimRequest {
  /** Team task selected by the assignment Envelope. */
  readonly taskId: TeamTaskId
  /** Current lease attempt selected by the scheduler. */
  readonly attemptId: TaskAttemptId
  /** Task revision committed with the current lease assignment. */
  readonly assignedRevision: number
  /** Bound Team channel that delivered the assignment Envelope. */
  readonly channelId: ChannelId
  /** Accepted assignment Envelope that the bound recipient claimed. */
  readonly envelopeId: EnvelopeId
}

/**
 * Task-attempt facts supplied by the active lease owner when it settles work.
 * The Link derives its Team, Participant, and activation identity from its
 * immutable binding; task cancellation and lease expiry have separate owners.
 */
export interface TeamLinkTaskAttemptSettleRequest {
  /** Team task carrying the active lease. */
  readonly taskId: TeamTaskId
  /** Exact current lease attempt being settled. */
  readonly attemptId: TaskAttemptId
  /** Task revision observed before settlement. */
  readonly expectedRevision: number
  /** Owner-reported terminal fact permitted through an activation-bound Link. */
  readonly outcome:
    | { readonly kind: 'released' }
    | { readonly kind: 'failed'; readonly failure: TaskAttemptFailure }
    | { readonly kind: 'completed'; readonly result: TaskAttemptResult }
}

/** Integration-task facts supplied by the current activation owner. */
export interface TeamLinkTaskIntegrationRequest {
  /** Integration task carrying the current lease. */
  readonly taskId: TeamTaskId
  /** Exact integration attempt being executed. */
  readonly attemptId: TaskAttemptId
  /** Task revision observed before provider execution. */
  readonly expectedRevision: number
  /** Optional non-empty verification fact retained in the durable result. */
  readonly verification?: string | undefined
}

/** Task-attempt facts supplied by the active lease owner when renewing work. */
export interface TeamLinkTaskAttemptHeartbeatRequest {
  /** Team task carrying the active lease. */
  readonly taskId: TeamTaskId
  /** Exact current lease attempt being renewed. */
  readonly attemptId: TaskAttemptId
  /** Task revision observed before renewal. */
  readonly expectedRevision: number
}

/** Review decision supplied by the exact configured reviewer. */
export interface TeamLinkTaskReviewRequest {
  /** Team task currently awaiting review. */
  readonly taskId: TeamTaskId
  /** Task revision observed before the decision. */
  readonly expectedRevision: number
  /** Durable next phase selected by the reviewer. */
  readonly nextPhase: 'pending' | 'completed'
  /** Non-empty human-readable review reason. */
  readonly reason: string
}

/** One immutable manifest delivered to its invited activation endpoint. */
export interface TeamLinkInvitationNotification {
  /** Exact channel manifest and its observed lifecycle cursor. */
  readonly channel: ChannelSnapshot
  /** Only this authenticated participant's invitation. */
  readonly invitation: ChannelInvitationSnapshot
}

/** One provider-owned client connection for one durable activation identity. */
export interface TeamLink {
  /**
   * Read current channel metadata through this Link's authenticated member binding.
   * @param channelId - pending, active or terminal channel containing this member.
   * @returns immutable manifest, phase and cursors, without messages or protocol state.
   */
  getChannel(channelId: ChannelId): Promise<ChannelSnapshot>

  /**
   * Subscribe to this endpoint's unacknowledged channel invitations.
   * @param listener - receiver that validates exact protocol support before acknowledgement.
   * @returns an idempotent subscription disposer.
   */
  onInvitation(listener: (notification: TeamLinkInvitationNotification) => Promise<void>): () => void
  /**
   * Acknowledge the exact manifest accepted by this activation endpoint.
   * @param request - invitation revision, manifest fingerprint and retry key.
   * @returns the durable admission projection after acknowledgement.
   */
  acknowledgeChannelInvitation(request: ChannelInvitationAcknowledgeInput): Promise<ChannelAdmissionSnapshot>

  /** Immutable registry name of the provider that published this Link. */
  readonly provider: string
  /**
   * Immutable connection-time activation, Session, and AgentRuntime-provider
   * snapshot for this Link. Its residency status is not a connection identity.
   */
  readonly binding: ActivationBindingSnapshot
  /**
   * Settles when this Link reaches a terminal state without an explicit caller
   * release. A rejection reports a provider-owned replay, transport, or
   * lifecycle failure; a consumer can then reconnect its still-current binding.
   * @returns fulfillment on orderly terminal closure or rejection with the terminal failure.
   */
  readonly done: Promise<void>
  /**
   * Subscribe to accepted Envelope notifications visible to this binding.
   * Implementations contain listener throws and rejections so one subscriber
   * cannot interrupt later notifications; Link lifecycle failures remain observable.
   * @param listener - asynchronous callback for one accepted Envelope notification.
   * @returns an idempotent listener disposer.
   */
  onNotify(listener: (envelope: TeamEnvelope) => Promise<void>): () => void
  /**
   * Subscribe to pending soft participant interrupts targeted to this exact
   * activation binding. A consumer acknowledges only after it has issued the
   * local interruption request; listener failure leaves the durable command
   * pending for replay.
   * @param listener - asynchronous callback for one binding-targeted interrupt notification.
   * @returns an idempotent listener disposer.
   */
  onInterrupt(listener: (notification: TeamLinkInterruptNotification) => Promise<void>): () => void
  /**
   * Replay pending task stops from the durable journal for this exact binding.
   * @param listener - owner callback that stops the attempt before acknowledging it.
   * @returns an idempotent listener disposer.
   */
  onTaskCancellation(listener: (notification: TeamLinkTaskCancellationNotification) => Promise<void>): () => void
  /**
   * Settle an accepted task cancellation after work and allocation release finish.
   * @param request - current revision and exact attempt selected by the intent.
   * @returns the cancelled task with its immutable attempt outcome.
   */
  acknowledgeTaskCancellation(request: TeamLinkTaskCancellationAcknowledgeRequest): Promise<TeamTaskSnapshot>
  /**
   * Submit one unstamped Envelope through the authenticated binding.
   * @param request - observed cursor, retry key, and draft; the caller cannot supply a sender identity.
   * @returns the immutable Hub-accepted Envelope.
   */
  post(request: TeamLinkPostRequest): Promise<TeamEnvelope>
  /**
   * Atomically derive and append one protocol-owned direct final through this
   * Link's exact binding. Callers do not provide recipient or channel cursor.
   * @param request - channel, retry key, and final text.
   * @returns the immutable Hub-accepted final Envelope.
   */
  postFinalResult(request: TeamLinkFinalResultRequest): Promise<TeamEnvelope>
  /**
   * Claim one pending recipient delivery for this exact binding.
   * @param channelId - channel that owns the accepted Envelope.
   * @param envelopeId - accepted Envelope to claim.
   * @returns the ephemeral delivery claim, or `undefined` after a durable recipient acknowledgement.
   */
  claim(channelId: ChannelId, envelopeId: EnvelopeId): Promise<ChannelDeliveryClaim | undefined>
  /**
   * Claim and start the assignment delivered to this Link's exact activation
   * and Session. Repeating the same current claim after successful startup
   * returns the running task without another durable task transition.
   * @param request - task/lease/revision and accepted channel delivery facts; identity comes from this Link.
   * @returns the current running task projection.
   */
  claimTaskAttemptStart(request: TeamLinkTaskAttemptStartClaimRequest): Promise<TeamTaskSnapshot>
  /**
   * Settle this Link binding's exact current task attempt. This operation only
   * admits worker-owned released, failed, and completed outcomes.
   * @param request - task/attempt/revision and permitted outcome; identity comes from this Link.
   * @returns the detached task projection with its settled attempt retained in history.
   */
  settleTaskAttempt(request: TeamLinkTaskAttemptSettleRequest): Promise<TeamTaskSnapshot>
  /**
   * Execute and settle this Link binding's current artifact-sourced integration task.
   * @param request - task/attempt fence and optional verification; source and target facts remain durable task data.
   * @returns the task projection with its provider integration result retained in attempt history.
   */
  integrateTask(request: TeamLinkTaskIntegrationRequest): Promise<TeamTaskSnapshot>
  /**
   * Renew this Link binding's exact current task attempt lease.
   * @param request - task and attempt ids plus the observed task revision.
   * @returns the detached running task projection with its renewed lease.
   */
  heartbeatTaskAttempt(request: TeamLinkTaskAttemptHeartbeatRequest): Promise<TeamTaskSnapshot>
  /** Resolve this Link binding's exact configured task review. */
  resolveTaskReview(request: TeamLinkTaskReviewRequest): Promise<TeamTaskSnapshot>
  /**
   * Record this binding's durable admission of one accepted Envelope.
   * @param channelId - channel that owns the accepted Envelope.
   * @param envelopeId - accepted Envelope admitted by this binding.
   * @param expectedCursor - channel-WAL cursor observed before the acknowledgement.
   * @returns the immutable accepted recipient receipt.
   */
  acknowledge(channelId: ChannelId, envelopeId: EnvelopeId, expectedCursor: number): Promise<ChannelReceiptRecord>
  /**
   * Record this binding's acceptance of one delivered soft interrupt. The
   * provider verifies both its live delivery correlation and durable command
   * identity before it delegates the exact binding acknowledgement.
   * @param deliveryId - Link-issued correlation for the received notification.
   * @param interruptId - durable command identity carried by that notification.
   * @returns the durable interrupt with its exact-target acknowledgement retained.
   */
  acknowledgeInterrupt(
    deliveryId: TeamLinkDeliveryId,
    interruptId: TeamInterruptId,
  ): Promise<ParticipantInterruptSnapshot>
  /**
   * Stop notifications and release provider-owned Link resources.
   * @returns resolution after the provider reaches its Link-local terminal state.
   */
  close(): Promise<void>
}

/**
 * Owner-scoped access to one already-connected activation-bound Link.
 * The owner controls Link lifetime; borrowers may use it only while the
 * callback is running.
 */
export interface TeamLinkBoundLinkBorrower {
  /**
   * Run one operation through the current bound Link without transferring its
   * connection or credential ownership.
   * @param operation - Link operation that must finish before the borrow returns.
   * @returns the operation result.
   */
  withLink<T>(operation: (link: TeamLink) => Promise<T>): Promise<T>
}

/** One named provider of activation-bound Team Links. */
export interface TeamLinkProvider {
  /** Unique registry name for this local or remote Link implementation. */
  readonly name: string
  /**
   * Publish one Link for the selected durable activation binding.
   * @param request - provider name, exact binding, and optional pre-publication cancellation signal.
   * @returns a Link with provider and binding equal to the request.
   */
  connect(request: TeamLinkConnectRequest): Promise<TeamLink>
}

/** Diagnostic identity for one registered Team Link provider. */
export interface TeamLinkProviderRef {
  /** Unique registry name for this local or remote Link implementation. */
  readonly name: string
}

/** Request one ephemeral remote Link credential for an exact durable binding. */
export interface TeamLinkEnrollmentRequest {
  /** Registered enrollment provider selected by the trusted activation owner. */
  readonly provider: string
  /** Exact active activation binding that the issued credential may attach. */
  readonly binding: ActivationBindingSnapshot
}

/** One provider-issued remote Link credential held only by its trusted activation owner. */
export interface TeamLinkEnrollment {
  /** Link provider name that the remote child must select for this credential. */
  readonly provider: string
  /** Complete WebSocket endpoint selected by the deployment. */
  readonly endpoint: string
  /** Opaque attach credential; callers must not persist or log its value. */
  readonly capability: string
  /** Revoke this credential and any attached Link before the activation ends. */
  revoke(): Promise<void>
}

/** One named issuer of ephemeral credentials for remote activation-bound Links. */
export interface TeamLinkEnrollmentProvider {
  /** Unique registry name shared with the remote Link transport. */
  readonly name: string
  /**
   * Issue a credential for one exact durable activation binding.
   * @param binding - active binding selected by the Team activation owner.
   * @returns an opaque credential plus the endpoint and Link provider the child must use.
   */
  reserve(binding: ActivationBindingSnapshot): Promise<TeamLinkEnrollment>
}

/** Diagnostic identity for one registered remote-Link enrollment provider. */
export interface TeamLinkEnrollmentProviderRef {
  /** Unique registry name shared with the remote Link transport. */
  readonly name: string
}
