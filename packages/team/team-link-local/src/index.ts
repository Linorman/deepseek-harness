import type { ChannelInvitationAcknowledgeInput, ChannelAdmissionSnapshot } from '@clocky/clocky-team'
import type { TeamLinkInvitationNotification } from '@clocky/clocky-team-link'
/**
 * Local Team Link provider. It binds one durable activation to authenticated
 * Team operations and cursor-based pending-delivery notification recovery.
 *
 * @module @clocky/clocky-team-link-local
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { TeamError } from '@clocky/clocky-team'
import { executeTeamIntegrationTask } from '@clocky/clocky-team-workspace'
import type {
  ActivationBindingSnapshot,
  ActivationActorProofIssuer,
  ChannelId,
  ChannelWatchResult,
  ChannelSnapshot,
  EnvelopeId,
  ParticipantInterruptSnapshot,
  TeamInterruptId,
  TeamEnvelope,
  TeamActorProofLease,
  TeamStateSnapshot,
  TeamWatchResult,
  TeamTaskSnapshot,
} from '@clocky/clocky-team'
import type {
  TeamLink,
  TeamLinkConnectRequest,
  TeamLinkDeliveryId,
  TeamLinkInterruptNotification,
  TeamLinkTaskCancellationNotification,
  TeamLinkTaskCancellationAcknowledgeRequest,
  TeamLinkFinalResultRequest,
  TeamLinkPostRequest,
  TeamLinkProvider,
  TeamLinkTaskAttemptStartClaimRequest,
  TeamLinkTaskAttemptSettleRequest,
  TeamLinkTaskIntegrationRequest,
  TeamLinkTaskAttemptHeartbeatRequest,
  TeamLinkTaskReviewRequest,
} from '@clocky/clocky-team-link'
import { TeamLinkLocalError } from './error.ts'

export { TeamLinkLocalError } from './error.ts'
export type { TeamLinkLocalErrorCode } from './error.ts'

/** Cordis plugin name. */
export const name = 'team-link-local'
/** Team authority and the Link registry must exist before local Link registration. */
export const inject = ['teams', 'teamLinks']

const DEFAULT_PROVIDER_NAME = 'local'
const DEFAULT_PAGE_SIZE = 128
const DEFAULT_DISPOSAL_TIMEOUT_MS = 5_000
const DEFAULT_NOTIFICATION_RETRY_DELAY_MS = 100

/** Deployment configuration for the local Team Link provider. */
export interface Config {
  /** Provider name registered on `ctx.teamLinks`. */
  readonly providerName: string
  /** Maximum pending deliveries read from one Team channel page. */
  readonly pageSize: number
  /** Maximum milliseconds allowed for accepted replay and notification work during Link close. */
  readonly disposalTimeoutMs: number
  /** Delay before retrying one listener notification that did not settle successfully. */
  readonly notificationRetryDelayMs: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  providerName: z.string().default(DEFAULT_PROVIDER_NAME),
  pageSize: z.number().step(1).min(1).default(DEFAULT_PAGE_SIZE),
  disposalTimeoutMs: z.number().step(1).min(1).default(DEFAULT_DISPOSAL_TIMEOUT_MS),
  notificationRetryDelayMs: z.number().step(1).min(1).default(DEFAULT_NOTIFICATION_RETRY_DELAY_MS),
})

const DEFAULT_CONFIG: Config = {
  providerName: DEFAULT_PROVIDER_NAME,
  pageSize: DEFAULT_PAGE_SIZE,
  disposalTimeoutMs: DEFAULT_DISPOSAL_TIMEOUT_MS,
  notificationRetryDelayMs: DEFAULT_NOTIFICATION_RETRY_DELAY_MS,
}

/** One resolved Team/channel watch result or its contained rejection. */
type Settled<T> = { readonly kind: 'fulfilled'; readonly value: T } | { readonly kind: 'rejected'; readonly reason: unknown }

/** One retained local background failure surfaced by later Link lifecycle calls. */
interface LinkFailure {
  /** Original failed operation reason. */
  readonly error: unknown
}

/** One notification subscriber and its failed-notification retry set. */
interface NotificationSubscription<T> {
  /** Consumer callback for one recipient-visible Envelope. */
  readonly listener: (notification: T) => Promise<void>
  /** Delayed retries keyed by one Link-owned delivery identity. */
  readonly retries: Map<string, NotificationRetry<T>>
}

/** One delayed retry of a failed notification callback. */
interface NotificationRetry<T> {
  /** Source notification retained without rescanning durable Team state. */
  readonly notification: T
  /** Notification-cycle signal that cancels this retry. */
  readonly signal: AbortSignal
  /** Timer removed when this retry succeeds, is replaced, or the Link stops. */
  timer: ReturnType<typeof setTimeout> | undefined
}

/** Owns admission for future local Links while leaving accepted Links with their callers. */
class LocalTeamLinkProvider implements TeamLinkProvider {
  private closing = false

  /**
   * @param ctx - Context carrying Team authority.
   * @param name - registry name for this local provider.
   * @param config - validated page and disposal limits for accepted Links.
   */
  constructor(
    private readonly ctx: Context,
    readonly name: string,
    private readonly actorIssuer: ActivationActorProofIssuer,
    private readonly config: Pick<Config, 'pageSize' | 'disposalTimeoutMs' | 'notificationRetryDelayMs'>,
  ) {}

  /** Prevent new connections without revoking Links already published to callers. */
  closeAdmission(): void {
    this.closing = true
  }

  /**
   * Verify a durable activation binding before publishing a local Link.
   * @param request - selected provider, exact binding, and optional cancellation signal.
   * @returns a local Link retaining the verified immutable binding.
   */
  async connect(request: TeamLinkConnectRequest): Promise<TeamLink> {
    this.assertOpen()
    assertNotAborted(request.signal)
    const binding = await this.ctx.teams.getActivation({
      teamId: request.binding.activation.teamId,
      activationId: request.binding.activation.id,
    })
    assertNotAborted(request.signal)
    if (!sameBindingIdentity(binding, request.binding)) {
      throw new TeamLinkLocalError(
        `activation '${request.binding.activation.id}' no longer matches the requested Team Link binding`,
        'TEAM_LINK_LOCAL_BINDING_MISMATCH',
      )
    }
    if (!isDeliverableActivation(binding.activation.status)) {
      throw new TeamLinkLocalError(
        `activation '${binding.activation.id}' is not available for local Team Link delivery`,
        'TEAM_LINK_LOCAL_ACTIVATION_UNAVAILABLE',
      )
    }
    this.assertOpen()
    const actorLease = this.actorIssuer.issue(binding)
    return new LocalTeamLink(this.ctx, this.name, immutable(binding), actorLease, this.config)
  }

  /** Reject publication after this provider stops accepting new Links. */
  private assertOpen(): void {
    if (this.closing) {
      throw new TeamLinkLocalError('local Team Link provider is closed', 'TEAM_LINK_LOCAL_PROVIDER_CLOSED')
    }
  }
}

/** One local Team Link and all pending replay/watch work it owns. */
class LocalTeamLink implements TeamLink {
  readonly provider: string
  readonly binding: ActivationBindingSnapshot
  private readonly terminal = Promise.withResolvers<void>()
  readonly done = this.terminal.promise
  private readonly invitationListeners = new Set<NotificationSubscription<TeamLinkInvitationNotification>>()
  private readonly listeners = new Set<NotificationSubscription<TeamEnvelope>>()
  private readonly cancellationListeners = new Set<NotificationSubscription<TeamLinkTaskCancellationNotification>>()
  private cancellationAbort: AbortController | undefined
  private readonly cancellationRevisions = new Map<string, number>()
  private readonly interruptListeners = new Set<NotificationSubscription<TeamLinkInterruptNotification>>()
  private readonly interruptDeliveries = new Map<TeamLinkDeliveryId, TeamLinkInterruptNotification>()
  private readonly interruptDeliveryIds = new Map<TeamInterruptId, TeamLinkDeliveryId>()
  private readonly accepted = new Set<Promise<void>>()
  private readonly channels = new Map<ChannelId, Promise<void>>()
  private notificationAbort: AbortController | undefined
  private interruptAbort: AbortController | undefined
  private started = false
  private interruptStarted = false
  private closing = false
  private failure: LinkFailure | undefined
  private disposal: Promise<void> | undefined
  private terminalSettled = false

  /**
   * @param ctx - Context carrying the authoritative local Team provider.
   * @param provider - immutable provider name published by this Link.
   * @param binding - immutable exact activation binding verified before Link publication.
   * @param actorLease - private proof lease derived from the verified binding.
   * @param config - validated pending-page and shutdown bounds.
   */
  constructor(
    private readonly ctx: Context,
    provider: string,
    binding: ActivationBindingSnapshot,
    private readonly actorLease: TeamActorProofLease,
    private readonly config: Pick<Config, 'pageSize' | 'disposalTimeoutMs' | 'notificationRetryDelayMs'>,
  ) {
    this.provider = provider
    this.binding = binding
    void this.done.catch(() => {})
  }

  /** Read only the current bound member's channel metadata through Hub authorization. */
  getChannel(channelId: ChannelId): Promise<ChannelSnapshot> {
    this.assertUsable()
    return this.ctx.teams.getChannelForActor({ actor: this.actorLease.proof, channelId })
  }

  /**
   * Subscribe to recipient-visible pending Envelope notifications.
   * The first listener starts cursor watches before the initial pending replay,
   * so the Link never emits recovery notifications before a caller can observe them.
   * @param listener - asynchronous callback for one current pending Envelope.
   * @returns an idempotent listener disposer.
   */
  onNotify(listener: (envelope: TeamEnvelope) => Promise<void>): () => void {
    if (this.closing || this.failure !== undefined) return () => {}
    const subscription: NotificationSubscription<TeamEnvelope> = { listener, retries: new Map() }
    this.listeners.add(subscription)
    this.startNotifications()
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.listeners.delete(subscription)
      this.clearRetries(subscription)
      if (this.listeners.size === 0 && this.invitationListeners.size === 0) this.stopNotifications()
    }
  }

  /** Deliver exact pending invitations through this Link's authenticated participant identity. */
  onInvitation(listener: (notification: TeamLinkInvitationNotification) => Promise<void>): () => void {
    if (this.closing || this.failure !== undefined) return () => {}
    const subscription: NotificationSubscription<TeamLinkInvitationNotification> = { listener, retries: new Map() }
    this.invitationListeners.add(subscription)
    this.startNotifications()
    return () => {
      this.invitationListeners.delete(subscription)
      this.clearRetries(subscription)
      if (this.listeners.size === 0 && this.invitationListeners.size === 0) this.stopNotifications()
    }
  }

  /** Commit endpoint consent through the Link's private activation proof. */
  async acknowledgeChannelInvitation(request: ChannelInvitationAcknowledgeInput): Promise<ChannelAdmissionSnapshot> {
    this.assertUsable()
    await this.assertChannelTeam(request.channelId)
    this.assertUsable()
    return await this.ctx.teams.acknowledgeChannelInvitation({ actor: this.actorLease.proof, ...request })
  }

  /** Start a shared channel watch only after a recipient listener is installed. */
  private startNotifications(): void {
    if (!this.started) {
      this.started = true
      const controller = new AbortController()
      this.notificationAbort = controller
      this.track(
        this.watchTeam(controller.signal),
        `Team '${this.binding.activation.teamId}' notification watch`,
        controller.signal,
      )
    }
  }

  /**
   * Subscribe to pending soft interrupts targeted to this Link's exact durable binding.
   * @param listener - asynchronous callback that issues and then acknowledges one local interrupt.
   * @returns an idempotent listener disposer.
   */
  onInterrupt(listener: (notification: TeamLinkInterruptNotification) => Promise<void>): () => void {
    if (this.closing || this.failure !== undefined) return () => {}
    const subscription: NotificationSubscription<TeamLinkInterruptNotification> = { listener, retries: new Map() }
    this.interruptListeners.add(subscription)
    if (!this.interruptStarted) {
      this.interruptStarted = true
      const controller = new AbortController()
      this.interruptAbort = controller
      this.track(
        this.watchInterrupts(controller.signal),
        `Team '${this.binding.activation.teamId}' interrupt watch`,
        controller.signal,
      )
    }
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.interruptListeners.delete(subscription)
      this.clearRetries(subscription)
      if (this.interruptListeners.size === 0) this.stopInterrupts()
    }
  }

  /**
   * Post an Envelope as the Participant authenticated by this Link binding.
   * @param request - observed cursor and unstamped draft without a caller-provided sender.
   * @returns the Hub-accepted immutable Envelope.
   */
  async post(request: TeamLinkPostRequest): Promise<TeamEnvelope> {
    this.assertUsable()
    await this.assertChannelTeam(request.draft.channelId)
    this.assertUsable()
    return await this.ctx.teams.postChannelEnvelope({
      actor: this.actorLease.proof,
      expectedCursor: request.expectedCursor ?? (await this.ctx.teams.getChannel({ channelId: request.draft.channelId })).cursor,
      idempotencyKey: request.idempotencyKey,
      draft: request.draft,
    })
  }

  /** Post one direct final through the immutable Link binding without a caller cursor or peer. */
  async postFinalResult(request: TeamLinkFinalResultRequest): Promise<TeamEnvelope> {
    this.assertUsable()
    return await this.ctx.teams.postChannelFinalEnvelope({
      actor: this.actorLease.proof,
      channelId: request.channelId,
      idempotencyKey: request.idempotencyKey,
      text: request.text,
    })
  }

  /**
   * Claim one pending Envelope through this Link's private activation proof.
   * @param channelId - channel that owns the accepted Envelope.
   * @param envelopeId - accepted Envelope to claim.
   * @returns the Hub-issued ephemeral claim, or `undefined` when no pending delivery remains.
   */
  async claim(channelId: ChannelId, envelopeId: EnvelopeId) {
    this.assertUsable()
    await this.assertChannelTeam(channelId)
    this.assertUsable()
    return await this.ctx.teams.claimChannelDelivery({
      actor: this.actorLease.proof,
      channelId,
      envelopeId,
    })
  }

  /**
   * Start one durable task assignment as this Link's exact activation and
   * Session after the caller claims its assignment Envelope.
   * @param request - task attempt and accepted assignment delivery facts.
   * @returns the current running task projection for this idempotent claim.
   */
  async claimTaskAttemptStart(request: TeamLinkTaskAttemptStartClaimRequest) {
    this.assertUsable()
    await this.assertChannelTeam(request.channelId)
    this.assertUsable()
    return await this.ctx.teams.claimTaskAttemptStart({
      actor: this.actorLease.proof,
      ...request,
    })
  }

  /** Subscribe to exact task cancellations retained by the Team journal. */
  onTaskCancellation(listener: (notification: TeamLinkTaskCancellationNotification) => Promise<void>): () => void {
    this.assertUsable()
    const subscription: NotificationSubscription<TeamLinkTaskCancellationNotification> = { listener, retries: new Map() }
    this.cancellationListeners.add(subscription)
    if (this.cancellationAbort === undefined) {
      const controller = new AbortController()
      this.cancellationAbort = controller
      this.track(this.watchTaskCancellations(controller.signal), 'task cancellation watch', controller.signal)
    }
    return () => {
      this.clearRetries(subscription)
      this.cancellationListeners.delete(subscription)
      if (this.cancellationListeners.size === 0) {
        this.cancellationAbort?.abort()
        this.cancellationAbort = undefined
        this.cancellationRevisions.clear()
      }
    }
  }

  /** Verify the durable intent before submitting an owner cancellation outcome. */
  async acknowledgeTaskCancellation(request: TeamLinkTaskCancellationAcknowledgeRequest): Promise<TeamTaskSnapshot> {
    this.assertUsable()
    const task = await this.ctx.teams.getTask({ teamId: this.binding.activation.teamId, taskId: request.taskId })
    const target = task.cancellation?.target
    if (target?.kind !== 'attempt' || target.attemptId !== request.attemptId
      || target.activationId !== this.binding.activation.id || target.participantId !== this.binding.activation.participantId) {
      throw new TeamLinkLocalError('task cancellation does not select this exact attempt and binding', 'TEAM_LINK_LOCAL_BINDING_MISMATCH')
    }
    this.assertUsable()
    return await this.ctx.teams.settleTaskAttempt({ actor: this.actorLease.proof, ...request, outcome: { kind: 'cancelled' } })
  }

  /** Establish each watch before replaying the currently retained exact-binding cancellation intents. */
  private async watchTaskCancellations(signal: AbortSignal): Promise<void> {
    let state = await this.ctx.teams.getTeam({ teamId: this.binding.activation.teamId })
    while (!signal.aborted) {
      const watch = settle(this.ctx.teams.watchTeam({ teamId: state.team.id, afterCursor: state.team.cursor, signal }))
      for (const task of state.tasks) {
        const cancellation = task.cancellation
        const target = cancellation?.target
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- subscriber delivery can synchronously revoke this watch.
        if (signal.aborted) break
        if ((task.phase !== 'assigned' && task.phase !== 'running') || task.lease === undefined || cancellation === undefined || target?.kind !== 'attempt'
          || target.activationId !== this.binding.activation.id || target.participantId !== this.binding.activation.participantId) continue
        const notification: TeamLinkTaskCancellationNotification = {
          taskId: task.id, phase: task.phase, revision: task.revision, cancellation,
        }
        if (this.cancellationRevisions.get(task.id) === task.revision) continue
        this.cancellationRevisions.set(task.id, task.revision)
        this.track(this.notifyListeners(this.cancellationListeners, notification,
          `${task.id}:${task.revision}`, `task cancellation '${task.id}'`, signal), `task cancellation '${task.id}'`, signal)
      }
      for (const taskId of this.cancellationRevisions.keys()) {
        if (!state.tasks.some(task => task.id === taskId && task.lease !== undefined && task.cancellation !== undefined)) {
          this.cancellationRevisions.delete(taskId)
        }
      }
      const observed = await watch
      if (observed.kind === 'rejected') throw observed.reason
      if (observed.value.kind === 'closed') return
      assertTeamWatchCursor(observed.value, state.team.cursor)
      state = await this.ctx.teams.getTeam({ teamId: this.binding.activation.teamId })
    }
  }

  /**
   * Settle one current task attempt through this Link's private activation proof.
   * Settlement does not address a channel, so only Link lifecycle state is
   * checked before the authoritative Team provider resolves its actor proof.
   * @param request - task attempt, revision, and worker-permitted terminal outcome.
   * @returns the detached task projection with its settled attempt retained in history.
   */
  async settleTaskAttempt(request: TeamLinkTaskAttemptSettleRequest): Promise<TeamTaskSnapshot> {
    this.assertUsable()
    return await this.ctx.teams.settleTaskAttempt({
      actor: this.actorLease.proof,
      ...request,
    })
  }

  /** Execute and settle this binding's artifact-sourced integration task. */
  async integrateTask(request: TeamLinkTaskIntegrationRequest): Promise<TeamTaskSnapshot> {
    this.assertUsable()
    const workspaces = this.ctx.get('teamWorkspaces')
    if (workspaces === undefined) {
      throw new TeamLinkLocalError(
        'local Team Link integration requires a Team workspace provider registry',
        'TEAM_LINK_LOCAL_FAILED',
      )
    }
    return await executeTeamIntegrationTask(this.ctx.teams, workspaces, {
      actor: this.actorLease.proof,
      teamId: this.binding.activation.teamId,
      participantId: this.binding.activation.participantId,
      activationId: this.binding.activation.id,
      ...request,
    })
  }

  /** Renew one task-attempt lease through this Link's private activation proof. */
  async heartbeatTaskAttempt(request: TeamLinkTaskAttemptHeartbeatRequest): Promise<TeamTaskSnapshot> {
    this.assertUsable()
    return await this.ctx.teams.heartbeatTaskAttempt({
      actor: this.actorLease.proof,
      ...request,
    })
  }

  /** Resolve this Link binding's exact configured task review. */
  async resolveTaskReview(request: TeamLinkTaskReviewRequest): Promise<TeamTaskSnapshot> {
    this.assertUsable()
    return await this.ctx.teams.resolveTaskReview({
      actor: this.actorLease.proof,
      ...request,
    })
  }

  /**
   * Record the private activation proof's recipient admission of one accepted Envelope.
   * @param channelId - channel that owns the accepted Envelope.
   * @param envelopeId - Envelope admitted by the bound Participant.
   * @param expectedCursor - channel cursor observed before acknowledgement.
   * @returns the Hub-accepted immutable recipient receipt.
   */
  async acknowledge(channelId: ChannelId, envelopeId: EnvelopeId, expectedCursor: number) {
    this.assertUsable()
    await this.assertChannelTeam(channelId)
    this.assertUsable()
    return await this.ctx.teams.ackChannelEnvelope({
      actor: this.actorLease.proof,
      channelId,
      envelopeId,
      expectedCursor,
    })
  }

  /**
   * Acknowledge one Link-issued interrupt delivery after the local consumer issued its cancellation request.
   * @param deliveryId - Link-local delivery correlation received by the consumer.
   * @param interruptId - durable command identity carried by that delivery.
   * @returns the Hub-acknowledged durable soft interrupt.
   */
  async acknowledgeInterrupt(
    deliveryId: TeamLinkDeliveryId,
    interruptId: TeamInterruptId,
  ): Promise<ParticipantInterruptSnapshot> {
    this.assertUsable()
    const notification = this.interruptDeliveries.get(deliveryId)
    if (notification === undefined || notification.interrupt.id !== interruptId) {
      throw new TeamLinkLocalError(
        `interrupt delivery '${deliveryId}' does not match interrupt '${interruptId}'`,
        'TEAM_LINK_LOCAL_INTERRUPT_DELIVERY_INVALID',
      )
    }
    this.assertInterruptBinding(notification.interrupt)
    const acknowledged = await this.ctx.teams.acknowledgeParticipantInterrupt({
      actor: this.actorLease.proof,
      interruptId,
    })
    this.assertInterruptBinding(acknowledged)
    this.forgetInterruptDelivery(notification)
    return acknowledged
  }

  /**
   * Stop watch/replay admission and await bounded accepted local work. Idempotent.
   * @returns resolution after Link-owned work settles, or rejection for a prior Link failure or timeout.
   */
  close(): Promise<void> {
    this.disposal ??= this.dispose()
    return this.disposal
  }

  /** Start Team cursor watches before discovering the first full channel set. */
  private async watchTeam(signal: AbortSignal): Promise<void> {
    let state = await this.ctx.teams.getTeam({ teamId: this.binding.activation.teamId })
    while (!signal.aborted) {
      const watch = settle(this.ctx.teams.watchTeam({
        teamId: state.team.id,
        afterCursor: state.team.cursor,
        signal,
      }))
      this.startChannels(state, signal)
      const observed = await watch
      if (observed.kind === 'rejected') throw observed.reason
      if (observed.value.kind === 'closed') return
      assertTeamWatchCursor(observed.value, state.team.cursor)
      state = await this.ctx.teams.getTeam({ teamId: this.binding.activation.teamId })
    }
  }

  /** Watch the Team journal around each exact-binding pending-interrupt replay. */
  private async watchInterrupts(signal: AbortSignal): Promise<void> {
    let state = await this.ctx.teams.getTeam({ teamId: this.binding.activation.teamId })
    while (!signal.aborted) {
      const watch = settle(this.ctx.teams.watchTeam({
        teamId: state.team.id,
        afterCursor: state.team.cursor,
        signal,
      }))
      await this.replayInterrupts(signal)
      const observed = await watch
      if (observed.kind === 'rejected') throw observed.reason
      if (observed.value.kind === 'closed') return
      assertTeamWatchCursor(observed.value, state.team.cursor)
      state = await this.ctx.teams.getTeam({ teamId: this.binding.activation.teamId })
    }
  }

  /** Replay every unacknowledged soft interrupt selected by this exact Link binding. */
  private async replayInterrupts(signal: AbortSignal): Promise<void> {
    const interrupts = await this.ctx.teams.listPendingParticipantInterrupts({
      actor: this.actorLease.proof,
    })
    for (const interrupt of interrupts) {
      if (signal.aborted) return
      this.assertInterruptBinding(interrupt)
      await this.notifyInterrupt(this.interruptDelivery(interrupt), signal)
    }
  }

  /** Start one channel recovery/watch task for each currently attached Team channel. */
  private startChannels(state: TeamStateSnapshot, signal: AbortSignal): void {
    for (const channelId of state.channelIds) {
      if (signal.aborted) return
      if (this.channels.has(channelId)) continue
      const operation = this.watchRecipientChannel(channelId, signal)
      this.channels.set(channelId, operation)
      void operation.then(
        () => { if (this.channels.get(channelId) === operation) this.channels.delete(channelId) },
        () => { if (this.channels.get(channelId) === operation) this.channels.delete(channelId) },
      )
      this.track(operation, `channel '${channelId}' notification watch`, signal)
    }
  }

  /** Ignore a Team channel that cannot have pending delivery for this Link's bound recipient. */
  private async watchRecipientChannel(channelId: ChannelId, signal: AbortSignal): Promise<void> {
    const channel = await this.ctx.teams.getChannel({ channelId })
    this.assertChannelSnapshotTeam(channel)
    if (!hasChannelParticipant(channel, this.binding.activation.participantId)) return
    await this.watchChannel(channelId, signal)
  }

  /** Watch one channel before each pending-delivery page scan to avoid a scan-to-watch gap. */
  private async watchChannel(channelId: ChannelId, signal: AbortSignal): Promise<void> {
    let afterCursor = -1
    while (!signal.aborted) {
      const watchAfterCursor = afterCursor
      const watch = settle(this.ctx.teams.watchChannel({
        channelId,
        afterCursor,
        signal,
      }))
      const current = await this.ctx.teams.getChannel({ channelId })
      this.assertChannelSnapshotTeam(current)
      if (afterCursor === -1 && current.replayWatermark !== undefined) {
        afterCursor = current.replayWatermark
      }
      if (current.phase === 'pending' || current.phase === 'active') {
        const admission = await this.ctx.teams.getChannelAdmission({ channelId })
        const invitation = admission.invitations.find(value => value.participantId === this.binding.activation.participantId)
        if (invitation?.status === 'pending') {
          await this.notifyListeners(this.invitationListeners, { channel: admission.channel, invitation },
            `${String(channelId)}:${invitation.revision}`, `channel '${channelId}' invitation`, signal)
        }
      }
      if (current.phase === 'pending') {
        afterCursor = current.cursor
        const observed = await watch
        if (observed.kind === 'rejected') throw observed.reason
        assertWatchCursor(observed.value, watchAfterCursor, channelId)
        if (observed.value.kind === 'closed') return
        continue
      }
      if ((current.phase !== 'active' && current.phase !== 'closed')) {
        const observed = await watch
        if (observed.kind === 'rejected') throw observed.reason
        assertWatchCursor(observed.value, watchAfterCursor, channelId)
        return
      }
      const team = await this.ctx.teams.getTeam({ teamId: this.binding.activation.teamId })
      if (team.team.phase !== 'active' || team.team.cancellation !== undefined || team.team.closure !== undefined) {
        const observed = await watch
        if (observed.kind === 'rejected') throw observed.reason
        return
      }
      let page
      try {
        page = await this.ctx.teams.listChannelPendingDeliveries({
          channelId,
          participantId: this.binding.activation.participantId,
          afterCursor,
          limit: this.config.pageSize,
        })
      } catch (error: unknown) {
        const current = await this.ctx.teams.getChannel({ channelId })
        this.assertChannelSnapshotTeam(current)
        const team = await this.ctx.teams.getTeam({ teamId: this.binding.activation.teamId })
        if (current.phase !== 'active' || team.team.phase !== 'active' || team.team.cancellation !== undefined || team.team.closure !== undefined) {
          const observed = await watch
          if (observed.kind === 'rejected') throw observed.reason
          assertWatchCursor(observed.value, watchAfterCursor, channelId)
          return
        }
        throw error
      }
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Link close may abort during pending-page I/O.
      if (signal.aborted) return
      this.assertChannelSnapshotTeam(page.channel)
      if (page.nextCursor < afterCursor) {
        throw new TeamLinkLocalError(
          `channel '${channelId}' pending-delivery page moved its cursor backward`,
          'TEAM_LINK_LOCAL_FAILED',
        )
      }
      for (const delivery of page.deliveries) {
        if (delivery.envelope.channelId !== channelId || delivery.envelope.teamId !== this.binding.activation.teamId) {
          throw new TeamLinkLocalError(
            `channel '${channelId}' returned a pending Envelope outside this Team Link binding`,
            'TEAM_LINK_LOCAL_CHANNEL_TEAM_MISMATCH',
          )
        }
        await this.notify(delivery.envelope, signal)
      }
      afterCursor = page.nextCursor
      const observed = await watch
      if (observed.kind === 'rejected') throw observed.reason
      assertWatchCursor(observed.value, watchAfterCursor, channelId)
      if (page.channel.phase === 'closed') {
        if (afterCursor < page.channel.cursor) continue
        return
      }
      if (observed.value.kind === 'closed') return
    }
  }

  /**
   * Deliver one page item through every current subscriber before scanning the
   * next item, bounding replay work by the number of active channel watchers.
   */
  private async notify(envelope: TeamEnvelope, signal: AbortSignal): Promise<void> {
    if (this.closing || signal.aborted) return
    const operation = this.notifyListeners(this.listeners, envelope, notificationKey(envelope), `Envelope '${envelope.id}'`, signal)
    this.track(operation, `Envelope '${envelope.id}' notification`, signal)
    await operation
  }

  /** Notify each interrupt subscriber while retaining its delivery until acknowledgement. */
  private async notifyInterrupt(notification: TeamLinkInterruptNotification, signal: AbortSignal): Promise<void> {
    if (this.closing || signal.aborted) return
    const operation = this.notifyListeners(
      this.interruptListeners,
      notification,
      notification.deliveryId,
      `participant interrupt '${notification.interrupt.id}'`,
      signal,
    )
    this.track(operation, `participant interrupt '${notification.interrupt.id}' notification`, signal)
    await operation
  }

  /** Call each current subscriber while retaining failed notifications for retry. */
  private async notifyListeners<T>(
    subscriptions: ReadonlySet<NotificationSubscription<T>>,
    notification: T,
    key: string,
    subject: string,
    signal: AbortSignal,
  ): Promise<void> {
    for (const subscription of subscriptions) {
      await this.notifySubscription(subscriptions, subscription, notification, key, subject, signal)
    }
  }

  /** Invoke one subscriber and retain the same notification for a delayed retry on failure. */
  private async notifySubscription<T>(
    subscriptions: ReadonlySet<NotificationSubscription<T>>,
    subscription: NotificationSubscription<T>,
    notification: T,
    key: string,
    subject: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.closing || signal.aborted || !subscriptions.has(subscription)) return
    try {
      await subscription.listener(notification)
      this.clearRetry(subscription, key)
    } catch (error: unknown) {
      if (isPermanentDeliveryRejection(error)) {
        this.clearRetry(subscription, key)
        return
      }
      this.ctx.logger.warn(`team-link-local: ${subject} listener failed: ${renderError(error)}`)
      this.scheduleRetry(subscriptions, subscription, notification, key, subject, signal)
    }
  }

  /** Schedule exactly one delayed re-notification for one failed subscriber and source item. */
  private scheduleRetry<T>(
    subscriptions: ReadonlySet<NotificationSubscription<T>>,
    subscription: NotificationSubscription<T>,
    notification: T,
    key: string,
    subject: string,
    signal: AbortSignal,
  ): void {
    if (subscription.retries.has(key) || this.closing || signal.aborted || !subscriptions.has(subscription)) return
    const retry: NotificationRetry<T> = { notification, signal, timer: undefined }
    subscription.retries.set(key, retry)
    retry.timer = setTimeout(() => {
      retry.timer = undefined
      if (subscription.retries.get(key) !== retry) return
      subscription.retries.delete(key)
      if (this.closing || signal.aborted || !subscriptions.has(subscription)) return
      this.track(
        this.notifySubscription(subscriptions, subscription, notification, key, subject, signal),
        `${subject} notification retry`,
        signal,
      )
    }, this.config.notificationRetryDelayMs)
  }

  /** Cancel one delayed subscriber retry after a successful delivery or teardown. */
  private clearRetry<T>(subscription: NotificationSubscription<T>, key: string): void {
    const retry = subscription.retries.get(key)
    if (retry === undefined) return
    if (retry.timer !== undefined) clearTimeout(retry.timer)
    subscription.retries.delete(key)
  }

  /** Cancel every retry owned by one removed or stopped subscriber. */
  private clearRetries<T>(subscription: NotificationSubscription<T>): void {
    for (const key of subscription.retries.keys()) this.clearRetry(subscription, key)
  }

  /** Cancel every delayed notification from the current Link notification cycle. */
  private clearNotificationRetries(): void {
    for (const subscription of this.invitationListeners) this.clearRetries(subscription)
    for (const subscription of this.listeners) this.clearRetries(subscription)
    for (const subscription of this.interruptListeners) this.clearRetries(subscription)
    for (const subscription of this.cancellationListeners) this.clearRetries(subscription)
  }

  /** Retain a background operation until it settles and turn its failure into Link lifecycle state. */
  private track(operation: Promise<void>, subject: string, signal: AbortSignal): void {
    const settled = operation.then(
      () => undefined,
      (error: unknown) => {
        if (!this.closing && this.failure === undefined && !signal.aborted) this.fail(error, subject)
      },
    )
    this.accepted.add(settled)
    void settled.then(() => { this.accepted.delete(settled) })
  }

  /** Mark the Link unusable after an owned watch or recovery operation rejects. */
  private fail(error: unknown, subject: string): void {
    this.failure = { error }
    this.ctx.logger.warn(`team-link-local: ${subject} failed: ${renderError(error)}`)
    this.settleDone(error)
    this.clearNotificationRetries()
    this.notificationAbort?.abort()
    this.interruptAbort?.abort()
    this.cancellationAbort?.abort()
  }

  /** Cancel the current recovery/watch cycle after the last notification subscriber leaves. */
  private stopNotifications(): void {
    const controller = this.notificationAbort
    if (controller === undefined) return
    this.notificationAbort = undefined
    this.started = false
    this.channels.clear()
    this.clearNotificationRetries()
    controller.abort()
  }

  /** Cancel exact-binding interrupt replay after its final subscriber leaves. */
  private stopInterrupts(): void {
    const controller = this.interruptAbort
    if (controller === undefined) return
    this.interruptAbort = undefined
    this.interruptStarted = false
    this.clearNotificationRetries()
    this.interruptDeliveries.clear()
    this.interruptDeliveryIds.clear()
    controller.abort()
  }

  /** Retain one Link-local interrupt correlation across callback retries. */
  private interruptDelivery(interrupt: ParticipantInterruptSnapshot): TeamLinkInterruptNotification {
    const existingId = this.interruptDeliveryIds.get(interrupt.id)
    if (existingId !== undefined) {
      const existing = this.interruptDeliveries.get(existingId)
      if (existing !== undefined) return existing
    }
    const deliveryId = randomUUID() as TeamLinkDeliveryId
    const notification: TeamLinkInterruptNotification = freeze({
      deliveryId,
      interrupt: this.interruptSnapshot(interrupt),
    })
    this.interruptDeliveries.set(deliveryId, notification)
    this.interruptDeliveryIds.set(interrupt.id, deliveryId)
    return notification
  }

  /** Forget an acknowledged delivery without removing a newer same-id mapping. */
  private forgetInterruptDelivery(notification: TeamLinkInterruptNotification): void {
    if (this.interruptDeliveries.get(notification.deliveryId) === notification) {
      this.interruptDeliveries.delete(notification.deliveryId)
    }
    if (this.interruptDeliveryIds.get(notification.interrupt.id) === notification.deliveryId) {
      this.interruptDeliveryIds.delete(notification.interrupt.id)
    }
  }

  /** Reject an interrupt whose durable target differs from this exact Link binding. */
  private assertInterruptBinding(interrupt: ParticipantInterruptSnapshot): void {
    const target = interrupt.target
    if (target.teamId === this.binding.activation.teamId
      && target.participantId === this.binding.activation.participantId
      && target.activationId === this.binding.activation.id
      && target.sessionId === this.binding.sessionId
      && target.provider === this.binding.provider) return
    throw new TeamLinkLocalError(
      `participant interrupt '${interrupt.id}' does not target this Team Link binding`,
      'TEAM_LINK_LOCAL_BINDING_MISMATCH',
    )
  }

  /** Detach and recursively freeze one public interrupt snapshot. */
  private interruptSnapshot(interrupt: ParticipantInterruptSnapshot): ParticipantInterruptSnapshot {
    return freeze(structuredClone(interrupt))
  }

  /** Confirm that a public operation targets a channel attached to this Link's Team. */
  private async assertChannelTeam(channelId: ChannelId): Promise<void> {
    const channel = await this.ctx.teams.getChannel({ channelId })
    this.assertChannelSnapshotTeam(channel)
  }

  /** Reject a detached channel projection owned by another Team. */
  private assertChannelSnapshotTeam(channel: ChannelSnapshot): void {
    if (channel.manifest.teamId !== this.binding.activation.teamId) {
      throw new TeamLinkLocalError(
        `channel '${channel.manifest.id}' does not belong to Team '${this.binding.activation.teamId}'`,
        'TEAM_LINK_LOCAL_CHANNEL_TEAM_MISMATCH',
      )
    }
  }

  /** Reject public Link calls after close begins or a background Link operation has failed. */
  private assertUsable(): void {
    if (this.closing) {
      throw new TeamLinkLocalError('local Team Link is closed', 'TEAM_LINK_LOCAL_CLOSED')
    }
    if (this.failure !== undefined) {
      throw new TeamLinkLocalError('local Team Link notification work failed', 'TEAM_LINK_LOCAL_FAILED', {
        cause: this.failure.error,
      })
    }
  }

  /** Stop admission, cancel owned local waits, and await a bounded snapshot of accepted work. */
  private async dispose(): Promise<void> {
    this.closing = true
    this.actorLease.revoke()
    this.stopNotifications()
    this.stopInterrupts()
    for (const subscription of this.invitationListeners) this.clearRetries(subscription)
    for (const subscription of this.listeners) this.clearRetries(subscription)
    for (const subscription of this.interruptListeners) this.clearRetries(subscription)
    for (const subscription of this.cancellationListeners) this.clearRetries(subscription)
    this.listeners.clear()
    this.interruptListeners.clear()
    this.cancellationListeners.clear()
    this.cancellationAbort?.abort()
    const accepted = [...this.accepted]
    try {
      if (accepted.length > 0) {
        await withTimeout(Promise.all(accepted), this.config.disposalTimeoutMs)
      }
      if (this.failure !== undefined) {
        throw new TeamLinkLocalError('local Team Link notification work failed', 'TEAM_LINK_LOCAL_FAILED', {
          cause: this.failure.error,
        })
      }
      this.settleDone()
    } catch (error: unknown) {
      this.settleDone(error)
      throw error
    }
  }

  /** Settle the public terminal signal exactly once without exposing a raw deferred. */
  private settleDone(error?: unknown): void {
    if (this.terminalSettled) return
    this.terminalSettled = true
    if (error === undefined) this.terminal.resolve()
    else this.terminal.reject(error)
  }
}

/** Register a provider whose accepted Links retain independent caller-owned lifetimes. */
export function apply(ctx: Context, config: Config = DEFAULT_CONFIG): void {
  const resolved = resolveConfig(config)
  const actorIssuer = ctx.teams.openActivationActorProofIssuer()
  const provider = new LocalTeamLinkProvider(ctx, resolved.providerName, actorIssuer, resolved)
  ctx.effect(() => {
    const unregister = ctx.teamLinks.registerProvider(provider)
    return () => {
      provider.closeAdmission()
      actorIssuer.close()
      unregister()
    }
  }, 'teamLinkLocal.registerProvider()')
}

/** Return whether one immutable channel manifest names this Link's bound recipient. */
function hasChannelParticipant(channel: ChannelSnapshot, participantId: ActivationBindingSnapshot['activation']['participantId']): boolean {
  return channel.manifest.participants.some(participant => participant.id === participantId)
}

/** Return a fulfilled/rejected discriminated result without leaving a watch rejection unobserved. */
function settle<T>(operation: Promise<T>): Promise<Settled<T>> {
  return operation.then(
    value => ({ kind: 'fulfilled', value }),
    (reason: unknown) => ({ kind: 'rejected', reason }),
  )
}

/** Reject a changed watch that repeats or rewinds the cursor it was asked to observe. */
function assertWatchCursor(result: ChannelWatchResult, afterCursor: number, channelId: ChannelId): void {
  if (result.kind === 'changed' && result.cursor <= afterCursor) {
    throw new TeamLinkLocalError(`channel '${channelId}' watch cursor did not advance`, 'TEAM_LINK_LOCAL_FAILED')
  }
}

/** Reject a Team watch that repeats or rewinds the cursor it was asked to observe. */
function assertTeamWatchCursor(result: TeamWatchResult, afterCursor: number): void {
  if (result.kind === 'changed' && result.cursor <= afterCursor) {
    throw new TeamLinkLocalError('Team watch cursor did not advance', 'TEAM_LINK_LOCAL_FAILED')
  }
}

/** Compare the immutable fields that identify one activation-bound Link. */
function sameBindingIdentity(left: ActivationBindingSnapshot, right: ActivationBindingSnapshot): boolean {
  return JSON.stringify([
    left.activation.id,
    left.activation.teamId,
    left.activation.participantId,
    left.sessionId,
    left.provider,
  ]) === JSON.stringify([
    right.activation.id,
    right.activation.teamId,
    right.activation.participantId,
    right.sessionId,
    right.provider,
  ])
}

/** Return the collision-free retry key for one accepted source Envelope. */
function notificationKey(envelope: TeamEnvelope): string {
  return JSON.stringify([envelope.channelId, envelope.id])
}

/** Return whether a Hub has permanently invalidated this Link's exact delivery claim. */
function isPermanentDeliveryRejection(error: unknown): boolean {
  return error instanceof TeamError
    && error.code !== 'TEAM_CURSOR_CONFLICT'
    && error.code !== 'TEAM_CHANNEL_CURSOR_CONFLICT'
}

/** Detach and recursively freeze one provider-published durable binding. */
function immutable(binding: ActivationBindingSnapshot): ActivationBindingSnapshot {
  return freeze(structuredClone(binding))
}

/** Freeze a detached public value recursively. */
function freeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) freeze(child)
  return value
}

/** Reject a connection request cancelled before the local provider publishes its Link. */
function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new TeamLinkLocalError('local Team Link connection was aborted before publication', 'TEAM_LINK_LOCAL_ABORTED', {
      cause: signal.reason,
    })
  }
}

/** Return whether an activation can receive a local delivery claim. */
function isDeliverableActivation(status: ActivationBindingSnapshot['activation']['status']): boolean {
  return status === 'idle' || status === 'running'
}

/** Validate direct plugin inputs that bypass the loader's Config parser. */
function resolveConfig(config: Config): Config {
  if (!Number.isSafeInteger(config.pageSize) || config.pageSize < 1) {
    throw new TypeError('team-link-local: pageSize must be a positive safe integer')
  }
  if (!Number.isSafeInteger(config.disposalTimeoutMs) || config.disposalTimeoutMs < 1) {
    throw new TypeError('team-link-local: disposalTimeoutMs must be a positive safe integer')
  }
  if (!Number.isSafeInteger(config.notificationRetryDelayMs) || config.notificationRetryDelayMs < 1) {
    throw new TypeError('team-link-local: notificationRetryDelayMs must be a positive safe integer')
  }
  return config
}

/** Bound local Link shutdown without retaining a timer after normal settlement. */
async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new TeamLinkLocalError(
        `local Team Link disposal exceeded ${timeoutMs}ms`,
        'TEAM_LINK_LOCAL_DISPOSAL_TIMEOUT',
      ))
    }, timeoutMs)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Render a contained listener or background-work failure without letting diagnostics throw. */
function renderError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}
