/** ACP subprocess AgentRuntime provider for Team-bound remote Participants. */

import { Readable, Writable } from 'node:stream'
import type { Context } from '@clocky/cordis'
import Schema from '@clocky/schemastery'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type PromptRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk'
import { AgentRuntimeTerminationUnconfirmedError, isAgentRuntimeTerminationUnconfirmed } from '@clocky/clocky-agent-runtime'
import type { ActivationHandle, AgentRuntimeActivationRequest, AgentRuntimeFencer, AgentRuntimeProvider } from '@clocky/clocky-agent-runtime'
import { SdkLocalProcessFencer } from '@clocky/clocky-agent-runtime-sdk'
import { ActivationSupervisorError } from '@clocky/clocky-activation-supervisor'
import { activationIdSchema, activationRecoverySnapshotSchema, teamChannelViewEventDataSchema, TeamError } from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ActivationSnapshot,
  ChannelId,
  ChannelDeliveryClaim,
  EnvelopeId,
  ParticipantId,
  TeamEnvelope,
  TeamChannelViewEventData,
  TeamTaskAssignmentSource,
  TeamTaskSnapshot,
  TeamId,
} from '@clocky/clocky-team'
import { createUserMessage } from '@clocky/clocky-llm'
import type { CreateSessionOptions, Session, SessionEvent } from '@clocky/clocky-session'
import type {} from '@clocky/clocky-session-persistence'
import type { SubprocessHandle } from '@clocky/clocky-subprocess'
import { createProcessInspector } from '@clocky/clocky-subprocess-local'
import type { ProcessInspector } from '@clocky/clocky-subprocess-local'
import {
  parseTaskAssignmentEnvelope,
  TASK_ASSIGNMENT_CHANNEL_TYPE,
  TASK_ASSIGNMENT_CHANNEL_VERSION,
} from '@clocky/clocky-team-channel-task-assignment'
import type { TaskAssignmentEnvelope } from '@clocky/clocky-team-channel-task-assignment'
import { createCapabilityWebSocketTeamLinkProvider } from '@clocky/clocky-team-link-websocket'
import type { TeamLink, TeamLinkEnrollment, TeamLinkTerminationReason } from '@clocky/clocky-team-link'
import type {} from '@clocky/clocky-team-link'
import { proveAcpChildTermination } from './termination.ts'

/** Cordis plugin name. */
export const name = 'agent-runtime-acp'
/** AgentRuntime and subprocess services must exist before provider registration. */
export const inject = ['agentRuntimes', 'subprocess', 'sessions', 'sessionPersistence']

/** Node's largest safe timer delay; larger values overflow into immediate timers. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Durable completion fact for one ACP prompt admitted from a Team Envelope. */
export interface AcpPromptCompletedData {
  /** Team that owns the source Envelope. */
  readonly teamId: TeamId
  /** Participant whose ACP proxy Session retains this fact. */
  readonly participantId: ParticipantId
  /** Channel that carried the source Envelope. */
  readonly channelId: ChannelId
  /** Source Envelope acknowledged after ACP completion. */
  readonly envelopeId: EnvelopeId
  /** ACP response stop reason retained for replay diagnostics. */
  readonly stopReason: string
}

/** Provenance source used by the ACP proxy Session's model-visible input record. */
export interface AcpTeamEnvelopeSource {
  /** Distinguishes the proxy's Team-derived prompt from ordinary user input. */
  readonly kind: 'acp-team-envelope'
  /** Team that owns the source Envelope. */
  readonly teamId: TeamId
  /** Channel that carried the source Envelope. */
  readonly channelId: ChannelId
  /** Source Envelope identity. */
  readonly envelopeId: EnvelopeId
  /** Authenticated source participant. */
  readonly senderId: ParticipantId
}

declare module '@clocky/clocky-llm' {
  interface MessageSourceMap {
    'acp-team-envelope': AcpTeamEnvelopeSource
  }
}

declare module '@clocky/clocky-session/types' {
  interface SessionEventMap {
    /**
     * Records a successful ACP response before the source Envelope receipt.
     * @param data - exact Team, participant, channel, Envelope, and response facts.
     */
    'agent-runtime-acp/prompt-completed': AcpPromptCompletedData
  }
}

/** Provider configuration for an ACP child command. */
export interface Config {
  /** Provider registry name. */
  readonly providerName?: string
  /** ACP server executable. */
  readonly command: string
  /** ACP server arguments. */
  readonly args?: string[]
  /** Child environment additions. */
  readonly env?: Record<string, string>
  /** Grace period after stdin EOF before forced process termination. */
  readonly disposeEofGraceMs?: number
  /** Optional Team Link enrollment issuer used to bridge durable Team input into ACP prompts. */
  readonly teamLinkEnrollmentProvider?: string
  /** Prefix for the ephemeral Link provider registered for one ACP activation. */
  readonly teamLinkProviderPrefix?: string
  /** Delay before re-enrolling a current ACP activation after a Link transport failure. */
  readonly teamLinkReconnectDelayMs?: number
  /** Explicit non-secret ACP runtime profile required to cold-replace a persisted activation. */
  readonly recoveryProfile?: string
  /** Stable identity of the local host allowed to fence and replace the ACP child. */
  readonly recoveryHostId?: string
  /** Maximum wait after graceful and forced stale-child termination. */
  readonly recoveryFenceGraceMs?: number
  /** Supervisor implementation advertising this owned ACP process to remote recovery consumers. */
  readonly recoverySupervisor?: {
    /** Stable supervisor implementation name. */
    readonly name: string
    /** Supervisor protocol version required by the persisted descriptor. */
    readonly version: number
    /** Non-secret endpoint identity selected by the deployment. */
    readonly endpointId: string
  } | undefined
}

/** Schemastery validator for {@link Config}. */
export const Config: Schema<Config> = Schema.object({
  providerName: Schema.string().default('acp'),
  command: Schema.string().min(1).required(),
  args: Schema.array(Schema.string()).default([]),
  env: Schema.dict(Schema.string()).default({}),
  disposeEofGraceMs: Schema.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(6_000),
  teamLinkEnrollmentProvider: Schema.string().min(1),
  teamLinkProviderPrefix: Schema.string().min(1).pattern(/^\S(?:.*\S)?$/).default('acp-link'),
  teamLinkReconnectDelayMs: Schema.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(100),
  recoveryProfile: Schema.string().min(1),
  recoveryHostId: Schema.string().min(1),
  recoveryFenceGraceMs: Schema.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
  recoverySupervisor: Schema.union([
    Schema.const(undefined),
    Schema.object({
      name: Schema.string().min(1).required(),
      version: Schema.number().step(1).min(1).required(),
      endpointId: Schema.string().min(1).required(),
    }),
  ]),
})

/** Configuration with loader defaults resolved for one ACP provider instance. */
interface ResolvedConfig {
  readonly providerName: string
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly disposeEofGraceMs: number
  readonly teamLinkEnrollmentProvider?: string
  readonly teamLinkProviderPrefix: string
  readonly teamLinkReconnectDelayMs: number
  readonly recoverySupervisor?: Config['recoverySupervisor']
  readonly recovery?: AcpLocalRecoveryConfig | undefined
}

/** Validated same-host recovery settings selected as one atomic deployment choice. */
interface AcpLocalRecoveryConfig {
  /** Required profile id that the recovery owner compares before resuming. */
  readonly profile: string
  /** Host identity that owns both the recorded process and this fencer. */
  readonly hostId: string
  /** Bounded wait after graceful and forced stale-child termination. */
  readonly fenceGraceMs: number
}

/** Hub-owned issuer selected for one activation's short-lived Team Link credential. */
interface EnrollmentReservation {
  readonly provider: string
  reserve(binding: ActivationBindingSnapshot): Promise<TeamLinkEnrollment>
}

/** Ephemeral ACP-side Team Link ownership retained until the child activation ends. */
interface EnrolledLink {
  readonly binding: ActivationBindingSnapshot
  readonly provider: string
  readonly link: TeamLink
  readonly unregister: () => void
  readonly enrollment: TeamLinkEnrollment
}

/** One ACP-backed activation and its child-process lifecycle. */
class AcpActivationHandle implements ActivationHandle {
  readonly localAgent = undefined
  private status: ActivationSnapshot['status']
  private readonly listeners = new Set<(activation: ActivationSnapshot) => void>()
  private disposal: Promise<void> | undefined
  private terminationUnconfirmed: AgentRuntimeTerminationUnconfirmedError | undefined
  private offline = false
  private readonly terminal: Promise<void>
  private enrolled: EnrolledLink | undefined
  private enrollmentBinding: ActivationBindingSnapshot | undefined
  private enrollmentReservation: EnrollmentReservation | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private enrollmentTail: Promise<void> = Promise.resolve()
  private enrollmentOperation: Promise<void> | undefined
  private enrollmentKey: string | undefined
  /** Prevent an endpoint-requested Link retirement from scheduling a reconnect. */
  private terminationRequested = false
  private promptTail: Promise<void> = Promise.resolve()
  private readonly durableCompletions: Set<EnvelopeId>
  private proxyReleased = false

  constructor(
    readonly activation: ActivationHandle['activation'],
    readonly sessionId: ActivationHandle['sessionId'],
    private readonly child: SubprocessHandle,
    private readonly connection: ClientSideConnection,
    private readonly acpSessionId: string,
    private readonly eofGraceMs: number,
    private readonly ctx: Context,
    private readonly linkProviderPrefix: string,
    private readonly linkReconnectDelayMs: number,
    private readonly proxySession: Session,
    private readonly releaseProxySession: () => void,
    readonly recovery: ActivationHandle['recovery'],
    private readonly onDone: () => void,
  ) {
    this.status = activation.status
    this.durableCompletions = completedProxyPromptIds(proxySession)
    this.terminal = child.done.then(() => { this.finishOffline() }, () => { this.finishOffline() })
    void this.terminal.catch(() => {})
  }

  health(): Promise<ActivationSnapshot> {
    if (this.terminationUnconfirmed !== undefined) return Promise.reject(this.terminationUnconfirmed)
    return Promise.resolve(this.snapshot())
  }

  onStatus(listener: (activation: ActivationSnapshot) => void): () => void {
    if (this.offline) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  interrupt(_cause: Parameters<ActivationHandle['interrupt']>[0]): void {
    if (this.offline || this.disposal !== undefined) return
    void this.connection.cancel({ sessionId: this.acpSessionId }).catch(() => {})
  }

  /** Cooperatively stop the current ACP turn before the Hub retires this Link. */
  private async terminateFromLink(_reason: TeamLinkTerminationReason): Promise<void> {
    if (this.offline) return
    this.terminationRequested = true
    await this.connection.cancel({ sessionId: this.acpSessionId })
    this.reportIdleIfLive()
  }

  /** Restore an idle activation only when cooperative Link termination did not retire it. */
  private reportIdleIfLive(): void {
    if (this.offline || this.disposal !== undefined) return
    this.report('idle')
  }

  /** Enroll one exact durable binding and bridge its Team Link notifications into ACP prompts. */
  enrollLink(binding: ActivationBindingSnapshot, reservation: EnrollmentReservation): Promise<void> {
    this.enrollmentBinding = binding
    this.enrollmentReservation = reservation
    const key = bindingKey(binding)
    if (this.enrollmentOperation !== undefined && this.enrollmentKey === key) return this.enrollmentOperation
    if (this.enrolled !== undefined && bindingKey(this.enrolled.binding) === key) return Promise.resolve()
    const operation = this.enrollmentTail.then(
      () => this.enrollLinkOwned(binding, reservation),
      () => this.enrollLinkOwned(binding, reservation),
    )
    this.enrollmentKey = key
    this.enrollmentOperation = operation
    this.enrollmentTail = operation.then(() => undefined, () => undefined)
    void operation.then(
      () => { if (this.enrollmentOperation === operation) { this.enrollmentOperation = undefined; this.enrollmentKey = undefined } },
      (error: unknown) => {
        if (this.enrollmentOperation === operation) {
          this.enrollmentOperation = undefined
          this.enrollmentKey = undefined
        }
        if (!this.offline && this.disposal === undefined) {
          this.ctx.logger.warn(`ACP Team Link enrollment failed: ${error instanceof Error ? error.message : String(error)}`)
          this.scheduleLinkReconnect()
        }
      },
    )
    return operation
  }

  dispose(): Promise<void> {
    this.disposal ??= this.disposeOwned()
    return this.disposal
  }

  private async disposeOwned(): Promise<void> {
    if (this.offline) return
    this.report('stopping')
    let terminationProven = false
    try {
      await this.closeEnrolledLink()
      await this.connection.cancel({ sessionId: this.acpSessionId }).catch(() => {})
      this.child.stdin?.end()
      await proveAcpChildTermination(this.child, this.eofGraceMs)
      terminationProven = true
      await this.promptTail
    } catch (error: unknown) {
      if (!terminationProven) throw this.markTerminationUnconfirmed(error)
      this.ctx.logger.warn(`ACP activation cleanup failed after termination was proven: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (terminationProven) {
        this.releaseProxy()
        this.finishOffline()
      }
    }
  }

  /** Retain one provider-neutral failure while the ACP child may still execute the activation. */
  private markTerminationUnconfirmed(cause: unknown): AgentRuntimeTerminationUnconfirmedError {
    this.terminationUnconfirmed ??= new AgentRuntimeTerminationUnconfirmedError(
      `ACP activation '${this.activation.id}' termination is unconfirmed`,
      { cause },
    )
    return this.terminationUnconfirmed
  }

  private finishOffline(): void {
    if (this.offline) return
    this.offline = true
    this.report('offline')
    this.listeners.clear()
    void this.closeEnrolledLink().catch(() => {})
    void this.promptTail.then(() => { this.releaseProxy() }, () => { this.releaseProxy() })
    this.onDone()
  }

  /** Detach the proxy Session once no late prompt operation can append to it. */
  private releaseProxy(): void {
    if (this.proxyReleased) return
    this.proxyReleased = true
    this.releaseProxySession()
  }

  /** Serialize a Team envelope into one ACP prompt and acknowledge it only after prompt admission. */
  private deliverEnvelope(link: TeamLink, envelope: TeamEnvelope): Promise<void> {
    const operation = this.promptTail.then(async () => {
      const claim = await link.claim(envelope.channelId, envelope.id)
      if (claim === undefined) return
      const assignment = resolveTaskAssignment(claim, envelope, this.activation, this.sessionId)
      const view = assignment === undefined ? resolveChannelView(envelope, claim) : undefined
      const admission = proxyDeliveryAdmission(this.proxySession, envelope.id)
      if (this.durableCompletions.has(envelope.id)) {
        if (!proxyAdmissionMatches(admission, view, assignment)) {
          throw new TeamError(
            `ACP replay for Envelope '${envelope.id}' has no matching durable model input`,
            'TEAM_INVALID_ARGUMENT',
          )
        }
        await link.acknowledge(envelope.channelId, envelope.id, claim.channel.cursor)
        return
      }
      let task: (TeamTaskSnapshot & { readonly lease: NonNullable<TeamTaskSnapshot['lease']> }) | undefined
      if (assignment !== undefined) {
        const startedTask = await link.claimTaskAttemptStart({
          taskId: assignment.taskId,
          attemptId: assignment.attemptId,
          assignedRevision: assignment.assignedRevision,
          channelId: assignment.channelId,
          envelopeId: assignment.envelopeId,
        })
        if (!startedTaskMatchesAssignment(startedTask, assignment, this.activation)) {
          throw new TeamError(
            `ACP task assignment '${envelope.id}' did not return its current running attempt`,
            'TEAM_INVALID_ARGUMENT',
          )
        }
        task = startedTask
      }
      if (admission !== undefined && !proxyAdmissionMatches(admission, view, assignment)) {
        throw new TeamError(
          `ACP replay for Envelope '${envelope.id}' has a conflicting durable model input`,
          'TEAM_INVALID_ARGUMENT',
        )
      }
      this.report('running')
      const turn = nextProxyTurn(this.proxySession)
      this.proxySession.append('turn/start', { turn })
      const prompt = admission?.type === 'user/message'
        ? admission.data.content
        : admission?.type === 'team/channel-view'
          ? admission.data.content
          : view?.content
            ?? (task !== undefined
              ? taskAssignmentContent(task)
              : [{ type: 'text' as const, text: renderTeamEnvelope(envelope) }])
      if (view !== undefined) {
        if (admission === undefined) this.proxySession.append('team/channel-view', view, { surfaceOp: 'append' })
      } else if (task !== undefined) {
        if (assignment === undefined) throw new Error('ACP task assignment lost its parsed source')
        if (admission === undefined) this.proxySession.append('user/message', createUserMessage({
          content: prompt,
          source: taskAssignmentSource(assignment, task, this.activation),
        }), { surfaceOp: 'append' })
      } else if (admission === undefined) {
        this.proxySession.append('user/message', createUserMessage({
          content: prompt,
          source: {
            kind: 'acp-team-envelope',
            teamId: envelope.teamId,
            channelId: envelope.channelId,
            envelopeId: envelope.id,
            senderId: envelope.senderId,
          },
        }), { surfaceOp: 'append' })
      }
      await this.ctx.sessions.flush(this.proxySession)
      try {
        const result = await this.connection.prompt({
          sessionId: this.acpSessionId,
          prompt: prompt as unknown as PromptRequest['prompt'],
        })
        if (result.stopReason === 'cancelled') {
          this.proxySession.append('turn/end', { turn, reason: { kind: 'aborted', reason: { kind: 'parent' } } })
          await this.ctx.sessions.flush(this.proxySession)
          return
        }
        this.proxySession.append('agent-runtime-acp/prompt-completed', {
          teamId: envelope.teamId,
          participantId: this.activation.participantId,
          channelId: envelope.channelId,
          envelopeId: envelope.id,
          stopReason: result.stopReason,
        })
        this.proxySession.append('turn/end', { turn, reason: { kind: 'completed' } })
        await this.ctx.sessions.flush(this.proxySession)
        this.durableCompletions.add(envelope.id)
        await link.acknowledge(envelope.channelId, envelope.id, claim.channel.cursor)
      } finally {
        if (!this.offline && this.disposal === undefined) this.report('idle')
      }
    })
    this.promptTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  /** Cancel and release one dynamic Link before an ACP child process is torn down. */
  private async closeEnrolledLink(): Promise<void> {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    this.enrollmentBinding = undefined
    this.enrollmentReservation = undefined
    // An issuer reservation or WebSocket connect may still be in flight. Wait
    // for the serialized operation so a credential returned after disposal is
    // revoked before the child process is considered quiescent.
    await this.enrollmentTail
    const enrolled = this.enrolled
    this.enrolled = undefined
    if (enrolled === undefined) return
    await enrolled.enrollment.revoke().catch(() => {})
    await enrolled.link.close().catch(() => {})
    enrolled.unregister()
  }

  /** Reserve an activation-bound credential and connect one ACP-owned Team Link. */
  private async enrollLinkOwned(
    binding: ActivationBindingSnapshot,
    reservation: EnrollmentReservation,
  ): Promise<void> {
    if (this.offline || binding.activation.status === 'offline' || binding.activation.status === 'stopping') return
    if (binding.activation.id !== this.activation.id
      || binding.activation.teamId !== this.activation.teamId
      || binding.activation.participantId !== this.activation.participantId
      || binding.sessionId !== this.sessionId) {
      throw new TeamError(`ACP Team Link binding does not match activation '${this.activation.id}'`, 'TEAM_INVALID_ARGUMENT')
    }
    const links = this.ctx.get('teamLinks')
    if (links === undefined) throw new TeamError('ACP Team Link enrollment requires a Team Link registry', 'TEAM_INVALID_ARGUMENT')
    const enrollment = await reservation.reserve(binding)
    if (!this.canAcceptEnrollment()) {
      await enrollment.revoke().catch(() => {})
      return
    }
    let unregister: (() => void) | undefined
    let link: TeamLink | undefined
    try {
      const provider = createCapabilityWebSocketTeamLinkProvider({
        providerName: `${this.linkProviderPrefix}-${String(this.activation.id)}`,
        endpoint: enrollment.endpoint,
      }, enrollment.capability)
      unregister = links.registerProvider(provider)
      link = await links.connect({
        provider: provider.name,
        binding,
        onTerminate: reason => this.terminateFromLink(reason),
      })
      if (!this.canAcceptEnrollment()) {
        await link.close().catch(() => {})
        unregister()
        await enrollment.revoke().catch(() => {})
        return
      }
      const current = this.enrolled
      this.enrolled = { binding, provider: provider.name, link, unregister, enrollment }
      if (current !== undefined) {
        await current.link.close().catch(() => {})
        current.unregister()
        await current.enrollment.revoke().catch(() => {})
      }
      const connectedLink = link
      connectedLink.onNotify(async (envelope) => {
        await this.deliverEnvelope(connectedLink, envelope)
      })
      connectedLink.onInterrupt(async (notification) => {
        await this.connection.cancel({ sessionId: this.acpSessionId })
        await connectedLink.acknowledgeInterrupt(notification.deliveryId, notification.interrupt.id)
      })
      void connectedLink.done.catch((error: unknown) => {
        if (!this.offline && !this.terminationRequested && this.enrolled?.link === connectedLink) {
          this.ctx.logger.warn(`ACP Team Link '${provider.name}' ended: ${error instanceof Error ? error.message : String(error)}`)
          this.scheduleLinkReconnect()
        }
      })
    } catch (error: unknown) {
      if (link !== undefined) await link.close().catch(() => {})
      unregister?.()
      await enrollment.revoke().catch(() => {})
      throw error
    }
  }

  /** Re-enroll a current activation after a remote Link closes unexpectedly. */
  private scheduleLinkReconnect(): void {
    if (this.offline || this.disposal !== undefined || this.reconnectTimer !== undefined) return
    const binding = this.enrollmentBinding
    const reservation = this.enrollmentReservation
    const enrolled = this.enrolled
    if (binding === undefined || reservation === undefined) return
    if (enrolled !== undefined) {
      this.enrolled = undefined
      enrolled.unregister()
      void enrolled.enrollment.revoke().catch(() => {})
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.enrollLink(binding, reservation).catch((error: unknown) => {
        if (!this.offline) {
          this.ctx.logger.warn(`ACP Team Link re-enrollment failed: ${error instanceof Error ? error.message : String(error)}`)
          this.scheduleLinkReconnect()
        }
      })
    }, this.linkReconnectDelayMs)
    this.reconnectTimer.unref()
  }

  /** Whether an enrollment that is already in flight may still publish a Link. */
  private canAcceptEnrollment(): boolean {
    return !this.offline && this.disposal === undefined
  }

  private report(status: ActivationSnapshot['status']): void {
    if (this.status === status) return
    this.status = status
    const snapshot = this.snapshot()
    for (const listener of [...this.listeners]) {
      try { listener(snapshot) } catch { /* observer failure cannot change lifecycle */ }
    }
  }

  private snapshot(): ActivationSnapshot {
    return Object.freeze({ ...this.activation, status: this.status })
  }
}

/** Validate one Hub-rendered non-direct view before it enters the proxy Session. */
function resolveChannelView(
  envelope: TeamEnvelope,
  claim: ChannelDeliveryClaim,
): TeamChannelViewEventData | undefined {
  const required = requiresChannelView(claim)
  if (claim.view === undefined) {
    if (required) {
      throw new TeamError(
        `non-direct channel '${envelope.channelId}' delivery claim lacks a model view`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    return undefined
  }
  if (!required) {
    throw new TeamError(
      `channel '${envelope.channelId}' supplied a model view for a protocol without durable-view admission`,
      'TEAM_INVALID_ARGUMENT',
    )
  }
  let view: TeamChannelViewEventData
  try {
    view = teamChannelViewEventDataSchema.parse(claim.view)
  } catch (error: unknown) {
    throw new TeamError(
      `non-direct channel '${envelope.channelId}' delivery claim has an invalid model view`,
      'TEAM_INVALID_ARGUMENT',
      { cause: error },
    )
  }
  const manifest = claim.channel.manifest
  if (claim.envelopeId !== envelope.id
    || claim.delivery !== envelope.delivery
    || claim.channel.phase !== 'active'
    || manifest.id !== envelope.channelId
    || manifest.teamId !== envelope.teamId
    || view.teamId !== envelope.teamId
    || view.channelId !== envelope.channelId
    || view.triggeringEnvelopeId !== envelope.id
    || view.delivery !== claim.delivery
    || view.adapter.type !== manifest.adapter.type
    || view.adapter.version !== manifest.adapter.version
    || manifest.viewPolicy === undefined
    || view.viewPolicy.type !== manifest.viewPolicy.type
    || view.viewPolicy.version !== manifest.viewPolicy.version
    || view.sourceEnvelopeIds.at(-1) !== envelope.id
    || view.causationId !== envelope.causationId
    || view.taskId !== envelope.taskId) {
    throw new TeamError(
      `non-direct channel '${envelope.channelId}' delivery claim has an inconsistent model view`,
      'TEAM_INVALID_ARGUMENT',
    )
  }
  if (envelope.kind === 'review-request') {
    const payload = envelope.payload as Record<string, unknown>
    const review = view.review
    if (review === undefined
      || review.attemptId !== payload['attemptId']
      || review.reviewRevision !== payload['reviewRevision']
      || review.reviewerId !== payload['reviewerId']
      || review.initiatorId !== payload['initiatorId']) {
      throw new TeamError(
        `non-direct channel '${envelope.channelId}' delivery claim has an inconsistent review fence`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
  } else if (view.review !== undefined) {
    throw new TeamError(
      `non-direct channel '${envelope.channelId}' delivery claim has an unexpected review fence`,
      'TEAM_INVALID_ARGUMENT',
    )
  }
  return view
}

type ProxyDeliveryAdmission = SessionEvent<'user/message'> | SessionEvent<'team/channel-view'>

/** Find the durable model input admitted for one source Envelope. */
function proxyDeliveryAdmission(session: Session, envelopeId: EnvelopeId): ProxyDeliveryAdmission | undefined {
  return session.events.find((event): event is ProxyDeliveryAdmission => {
    if (event.type === 'team/channel-view') return event.data.triggeringEnvelopeId === envelopeId
    if (event.type !== 'user/message') return false
    const source = event.data.source
    return source.kind === 'acp-team-envelope' || source.kind === 'team-task-assignment'
      ? source.envelopeId === envelopeId
      : false
  })
}

/** Match a restored proxy input against the current exact Team claim. */
function proxyAdmissionMatches(
  admission: ProxyDeliveryAdmission | undefined,
  view: TeamChannelViewEventData | undefined,
  assignment: TaskAssignmentEnvelope | undefined,
): boolean {
  if (admission === undefined) return false
  if (view !== undefined) {
    return admission.type === 'team/channel-view' && JSON.stringify(admission.data) === JSON.stringify(view)
  }
  if (assignment !== undefined) {
    if (admission.type !== 'user/message' || admission.data.source.kind !== 'team-task-assignment') return false
    const source = admission.data.source
    return source.teamId === assignment.teamId
      && source.channelId === assignment.channelId
      && source.envelopeId === assignment.envelopeId
      && source.taskId === assignment.taskId
      && source.attemptId === assignment.attemptId
      && source.assignedRevision === assignment.assignedRevision
      && source.activationId === assignment.activationId
  }
  return admission.type === 'user/message'
    && admission.data.source.kind === 'acp-team-envelope'
}

/** Parse and bind one ACP task-assignment claim to this activation epoch. */
function resolveTaskAssignment(
  claim: ChannelDeliveryClaim,
  envelope: TeamEnvelope,
  activation: ActivationSnapshot,
  sessionId: Session['id'],
): TaskAssignmentEnvelope | undefined {
  const manifest = claim.channel.manifest
  if (manifest.adapter.type !== TASK_ASSIGNMENT_CHANNEL_TYPE
    || manifest.adapter.version !== TASK_ASSIGNMENT_CHANNEL_VERSION) return undefined
  if (claim.view !== undefined
    || claim.envelopeId !== envelope.id
    || claim.delivery !== envelope.delivery
    || claim.channel.phase !== 'active'
    || manifest.id !== envelope.channelId
    || manifest.teamId !== envelope.teamId
    || claim.binding.activation.id !== activation.id
    || claim.binding.activation.teamId !== activation.teamId
    || claim.binding.activation.participantId !== activation.participantId
    || claim.binding.sessionId !== sessionId) {
    throw new TeamError(
      `ACP task assignment '${envelope.id}' has an inconsistent delivery claim`,
      'TEAM_INVALID_ARGUMENT',
    )
  }
  let assignment: TaskAssignmentEnvelope
  try {
    assignment = parseTaskAssignmentEnvelope(manifest, envelope)
  } catch (error: unknown) {
    throw new TeamError(
      `ACP task assignment '${envelope.id}' is malformed`,
      'TEAM_INVALID_ARGUMENT',
      { cause: error },
    )
  }
  if (assignment.assigneeId !== activation.participantId
    || assignment.teamId !== activation.teamId
    || assignment.channelId !== envelope.channelId) {
    throw new TeamError(
      `ACP task assignment '${envelope.id}' is not bound to this activation`,
      'TEAM_INVALID_ARGUMENT',
    )
  }
  return assignment
}

/** Prove that a Link task-start result is the exact running attempt selected by the assignment. */
function startedTaskMatchesAssignment(
  task: TeamTaskSnapshot,
  assignment: TaskAssignmentEnvelope,
  activation: ActivationSnapshot,
): task is TeamTaskSnapshot & { readonly lease: NonNullable<TeamTaskSnapshot['lease']> } {
  const lease = task.lease
  return task.id === assignment.taskId
    && task.teamId === assignment.teamId
    && task.phase === 'running'
    && lease !== undefined
    && lease.attemptId === assignment.attemptId
    && lease.assignedRevision === assignment.assignedRevision
    && lease.participantId === activation.participantId
    && lease.activationId === activation.id
    && lease.wakeChannelId === assignment.channelId
    && lease.startedAt !== undefined
}

/** Build the stable task-assignment content retained in the ACP proxy Session. */
function taskAssignmentContent(task: TeamTaskSnapshot & { readonly lease: NonNullable<TeamTaskSnapshot['lease']> }): [{ type: 'text'; text: string }] {
  return [{
    type: 'text',
    text: `Team task assignment: ${task.subject}\n\n${task.description}\n\nTask: ${task.id}\nAttempt: ${task.lease.attemptId}`,
  }]
}

/** Build the shared Team task-assignment provenance source. */
function taskAssignmentSource(
  assignment: TaskAssignmentEnvelope,
  task: TeamTaskSnapshot,
  activation: ActivationSnapshot,
): TeamTaskAssignmentSource {
  return {
    kind: 'team-task-assignment',
    teamId: assignment.teamId,
    channelId: assignment.channelId,
    envelopeId: assignment.envelopeId,
    taskId: assignment.taskId,
    attemptId: assignment.attemptId,
    assignedRevision: assignment.assignedRevision,
    runningRevision: task.revision,
    activationId: activation.id,
  }
}

/** Identify the channel protocols whose claims must carry a durable view. */
function requiresChannelView(claim: ChannelDeliveryClaim): boolean {
  const adapterType = claim.channel.manifest.adapter.type
  return adapterType === 'consult' || adapterType === 'discussion' || adapterType === 'workflow'
}

/** ACP-backed provider with one child process per Team participant epoch. */
class AcpProvider implements AgentRuntimeProvider {
  readonly terminationMode = 'owned-process' as const
  /** Local fencer used to prove exact owned-process termination during recovery. */
  readonly fencer: AgentRuntimeFencer | undefined
  private readonly processInspector: ProcessInspector | undefined
  private readonly activations = new Map<string, Promise<ActivationHandle>>()
  private closed = false

  constructor(
    private readonly ctx: Context,
    readonly name: string,
    private readonly config: ResolvedConfig,
    processInspector: ProcessInspector | undefined,
  ) {
    this.processInspector = config.recovery === undefined ? undefined : processInspector ?? createProcessInspector()
    const inspector = this.processInspector
    if (config.recovery !== undefined && (inspector === undefined || inspector.hasExactIdentity !== true)) {
      throw new TypeError('agent-runtime-acp recovery requires exact local process creation identities')
    }
    this.fencer = config.recovery === undefined
      ? undefined
      : new SdkLocalProcessFencer({
        provider: name,
        profile: config.recovery.profile,
        hostId: config.recovery.hostId,
        fenceGraceMs: config.recovery.fenceGraceMs,
        kind: 'acp-local-cold-replace',
      }, this.processInspector as ProcessInspector)
  }

  async activate(request: AgentRuntimeActivationRequest): Promise<ActivationHandle> {
    if (this.closed) throw new Error(`ACP AgentRuntime provider '${this.name}' is closed`)
    if (request.participant.kind !== 'remote-agent' && request.participant.kind !== 'local-agent') {
      throw new Error(`ACP provider cannot activate participant '${request.participant.id}' of kind '${request.participant.kind}'`)
    }
    const key = JSON.stringify([request.teamId, request.participant.id])
    const existing = this.activations.get(key)
    if (existing !== undefined) {
      const handle = await existing
      if (handle.sessionId !== request.sessionId) throw new Error(`Participant '${request.participant.id}' is already bound to another Session`)
      return handle
    }
    const operation = this.materialize(request, key)
    this.activations.set(key, operation)
    void operation.catch((error: unknown) => {
      if (!isAgentRuntimeTerminationUnconfirmed(error) && this.activations.get(key) === operation) this.activations.delete(key)
    })
    return await operation
  }

  /** Stop future ACP activation admission while accepted handles continue. */
  closeAdmission(): void { this.closed = true }

  private async materialize(request: AgentRuntimeActivationRequest, key: string): Promise<ActivationHandle> {
    const cwd = request.agent.cwd
    if (cwd === undefined || cwd.trim().length === 0) throw new Error('ACP activation requires an explicit workspace cwd')
    if (request.signal.aborted) throw request.signal.reason
    const child = this.ctx.subprocess.spawn({
      argv: [this.config.command, ...this.config.args],
      cwd,
      env: this.config.env,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
      graceMs: this.config.disposeEofGraceMs,
    })
    let releaseProxy: (() => void) | undefined
    try {
      if (child.stdin === undefined || child.stdout === undefined) throw new Error('ACP subprocess did not expose piped stdio')
      const connection = new ClientSideConnection(() => acpClient(), ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      ))
      await raceAbort(request.signal, () => connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }))
      const session = await raceAbort(request.signal, () => connection.newSession({ cwd, mcpServers: [] }))
      const acpSessionId = Reflect.get(session, 'sessionId')
      if (typeof acpSessionId !== 'string') throw new Error('ACP child did not return a session id')
      request.signal.throwIfAborted()
      const activation = Object.freeze({
        id: activationIdSchema.parse(`acp-${crypto.randomUUID()}`),
        teamId: request.teamId,
        participantId: request.participant.id,
        status: 'idle' as const,
      })
      const recovery = this.recoverySnapshot(child, activation.id, cwd)
      if (recovery?.supervisor !== undefined) {
        const supervisors = this.ctx.get('activationSupervisors')
        if (supervisors === undefined) throw new ActivationSupervisorError('ACP supervised recovery requires an execution-host supervisor owner', 'SUPERVISOR_UNAVAILABLE')
        await supervisors.admitOwned({ activation, sessionId: request.sessionId, provider: this.name, recovery })
        request.signal.throwIfAborted()
      }
      const proxy = await createProxySession(this.ctx, request)
      releaseProxy = proxy.release
      request.signal.throwIfAborted()
      const reservation = resolveEnrollmentReservation(this.ctx, this.config.teamLinkEnrollmentProvider)
      let stopBindingWatch = (): void => {}
      const handle = new AcpActivationHandle(
        activation,
        request.sessionId,
        child,
        connection,
        acpSessionId,
        this.config.disposeEofGraceMs,
        this.ctx,
        this.config.teamLinkProviderPrefix,
        this.config.teamLinkReconnectDelayMs,
        proxy.session,
        proxy.release,
        recovery,
        () => {
          stopBindingWatch()
          this.activations.delete(key)
        },
      )
      if (reservation !== undefined) {
        const enroll = (binding: ActivationBindingSnapshot): void => {
          if (binding.activation.id !== activation.id
            || binding.activation.teamId !== activation.teamId
            || binding.activation.participantId !== activation.participantId
            || binding.sessionId !== request.sessionId
            || binding.provider !== request.provider
            || (binding.activation.status !== 'idle' && binding.activation.status !== 'running')) return
          void handle.enrollLink(binding, reservation).catch((error: unknown) => {
            this.ctx.logger.warn(`ACP Team Link enrollment failed: ${error instanceof Error ? error.message : String(error)}`)
          })
        }
        stopBindingWatch = this.ctx.on('team/changed', (event) => {
          if (event.type === 'activation/changed') enroll(event.binding)
        })
        void observeCurrentBinding(this.ctx, request.teamId, activation.id, request.sessionId).then((binding) => {
          if (binding !== undefined) enroll(binding)
        })
      }
      return handle
    } catch (error: unknown) {
      releaseProxy?.()
      child.stdin?.end()
      try {
        await proveAcpChildTermination(child, this.config.disposeEofGraceMs)
      } catch (terminationError: unknown) {
        throw new AgentRuntimeTerminationUnconfirmedError('Unpublished ACP child termination is unconfirmed', {
          cause: new AggregateError([error, terminationError], 'ACP activation and child cleanup failed'),
        })
      }
      throw error
    }
  }

  /** Build a recovery plan only when exact same-host process identity is configured. */
  private recoverySnapshot(
    child: SubprocessHandle,
    activationId: ActivationSnapshot['id'],
    cwd: string,
  ): ActivationHandle['recovery'] {
    const recovery = this.config.recovery
    if (recovery === undefined) return undefined
    const inspector = this.processInspector
    if (inspector === undefined || inspector.hasExactIdentity !== true) {
      throw new TeamError('ACP recovery requires exact local process identities', 'TEAM_INVALID_ARGUMENT')
    }
    const identity = inspector.processTree(child.pid).find(candidate => candidate.pid === child.pid)
    if (identity === undefined || identity.started.length === 0) {
      throw new TeamError(`ACP child '${String(child.pid)}' has no observable process identity for recovery`, 'TEAM_INVALID_ARGUMENT')
    }
    return activationRecoverySnapshotSchema.parse({
      kind: 'acp-local-cold-replace',
      version: 1,
      runtimeProvider: this.name,
      profile: recovery.profile,
      cwd,
      ...this.config.recoverySupervisor === undefined ? {} : {
        supervisor: {
          ...this.config.recoverySupervisor,
          hostId: recovery.hostId,
          generation: activationId,
          terminationMode: this.terminationMode,
        },
      },
      process: {
        hostId: recovery.hostId,
        pid: identity.pid,
        started: identity.started,
        ...(process.platform === 'win32' ? {} : { processGroupId: identity.pid }),
      },
    })
  }
}

/** Keep ACP permission requests fail-closed; Team human ingress owns approval. */
function acpClient(): Client {
  return {
    sessionUpdate(_params: SessionNotification): Promise<void> { return Promise.resolve() },
    requestPermission(_params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
      return Promise.resolve({ outcome: { outcome: 'cancelled' } })
    },
  }
}

/** Resolve the optional Hub-owned enrollment issuer without making it a hard ACP dependency. */
function resolveEnrollmentReservation(ctx: Context, provider: string | undefined): EnrollmentReservation | undefined {
  if (provider === undefined) return undefined
  const links = ctx.get('teamLinks')
  if (links?.getEnrollmentProvider(provider) === undefined) {
    throw new TeamError(`ACP Team Link enrollment provider '${provider}' is not registered`, 'TEAM_INVALID_ARGUMENT')
  }
  return {
    provider,
    reserve: async binding => await links.reserveEnrollment({ provider, binding }),
  }
}

/** Publish the local durable proxy Session used to record ACP prompt admission. */
async function createProxySession(
  ctx: Context,
  request: AgentRuntimeActivationRequest,
): Promise<{ readonly session: Session; readonly release: () => void }> {
  const meta: NonNullable<CreateSessionOptions['meta']> = {
    ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd },
    teamId: request.teamId,
    participantId: request.participant.id,
    ...request.agent.preset === undefined ? {} : { agentPreset: request.agent.preset },
    ...request.seed.kind === 'fork' ? {
      parentSession: request.seed.sourceSessionId,
      seedLength: request.seed.events.length,
    } : {},
  }
  const session = request.seed.kind === 'resume'
    ? await resumeProxySession(ctx, request)
    : request.seed.kind === 'fork'
      ? ctx.sessions.prepare(request.sessionId, { seed: request.seed.events, meta })
      : ctx.sessions.prepare(request.sessionId, { meta })
  const release = ctx.sessions.enter(session)
  try {
    ctx.sessions.announce(session)
    await ctx.sessionPersistence.materializeHeader(session)
    return { session, release }
  } catch (error: unknown) {
    release()
    throw error
  }
}

/** Recover an existing ACP proxy Session before a remote activation resumes. */
async function resumeProxySession(ctx: Context, request: AgentRuntimeActivationRequest): Promise<Session> {
  const inspection = await ctx.sessionPersistence.load(request.sessionId)
  if (inspection.meta.teamId !== request.teamId || inspection.meta.participantId !== request.participant.id) {
    throw new TeamError(
      `ACP proxy Session '${request.sessionId}' does not belong to Team participant '${request.participant.id}'`,
      'TEAM_INVALID_ARGUMENT',
    )
  }
  return ctx.sessions.prepare(request.sessionId, {
    seed: inspection.events.map(event => structuredClone(event)),
    meta: structuredClone(inspection.meta),
    seedSource: 'persistence',
  })
}

/** Read an already committed binding when a provider joins a Team after its activation event. */
async function observeCurrentBinding(
  ctx: Context,
  teamId: ActivationSnapshot['teamId'],
  activationId: ActivationSnapshot['id'],
  sessionId: ActivationHandle['sessionId'],
): Promise<ActivationBindingSnapshot | undefined> {
  const teams = ctx.get('teams')
  if (teams === undefined) return undefined
  try {
    const state = await teams.getTeam({ teamId })
    return state.activations.find(binding => binding.activation.id === activationId && binding.sessionId === sessionId)
  } catch (error: unknown) {
    ctx.logger.warn(`ACP Team Link binding lookup failed: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/** Render one accepted Team Envelope as the exact user prompt sent to an ACP child. */
function renderTeamEnvelope(envelope: TeamEnvelope): string {
  return [
    'Clocky Team Envelope',
    `Team: ${String(envelope.teamId)}`,
    `Channel: ${String(envelope.channelId)}`,
    `Envelope: ${String(envelope.id)}`,
    `Sender: ${String(envelope.senderId)}`,
    `Kind: ${envelope.kind}`,
    ...envelope.causationId === undefined ? [] : [`Causation: ${String(envelope.causationId)}`],
    JSON.stringify(envelope.payload),
  ].join('\n')
}

/** Return the next proxy turn number after all retained ACP turns. */
function nextProxyTurn(session: Session): number {
  let next = 0
  for (const event of session.events) {
    if (event.type !== 'turn/start') continue
    next = Math.max(next, event.data.turn + 1)
  }
  return next
}

/** Read completion facts from a proxy Session restored from durable storage. */
function completedProxyPromptIds(session: Session): Set<EnvelopeId> {
  return new Set(session.events.flatMap(event => event.type === 'agent-runtime-acp/prompt-completed' ? [event.data.envelopeId] : []))
}

/** Build a collision-resistant identity for one activation binding. */
function bindingKey(binding: ActivationBindingSnapshot): string {
  return JSON.stringify([
    binding.activation.id,
    binding.activation.teamId,
    binding.activation.participantId,
    binding.sessionId,
    binding.provider,
  ])
}

/** Register the ACP provider; accepted handles survive provider removal. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig({
    providerName: config.providerName ?? 'acp',
    command: config.command,
    args: config.args ?? [],
    env: config.env ?? {},
    disposeEofGraceMs: config.disposeEofGraceMs ?? 6_000,
    ...config.teamLinkEnrollmentProvider === undefined ? {} : { teamLinkEnrollmentProvider: config.teamLinkEnrollmentProvider },
    teamLinkProviderPrefix: config.teamLinkProviderPrefix ?? 'acp-link',
    teamLinkReconnectDelayMs: config.teamLinkReconnectDelayMs ?? 100,
    ...config.recoveryProfile === undefined ? {} : { recoveryProfile: config.recoveryProfile },
    ...config.recoveryHostId === undefined ? {} : { recoveryHostId: config.recoveryHostId },
    ...config.recoveryFenceGraceMs === undefined ? {} : { recoveryFenceGraceMs: config.recoveryFenceGraceMs },
    ...config.recoverySupervisor === undefined ? {} : { recoverySupervisor: config.recoverySupervisor },
  })
  const processInspector = resolved.recovery === undefined ? undefined : createProcessInspector()
  const provider = new AcpProvider(ctx, resolved.providerName, resolved, processInspector)
  ctx.effect(() => {
    const unregisterFencer = provider.fencer === undefined ? undefined : ctx.agentRuntimes.registerFencer(provider.fencer)
    const unregister = ctx.agentRuntimes.registerProvider(provider)
    return () => { provider.closeAdmission(); unregister(); unregisterFencer?.() }
  }, 'agentRuntimeAcp.registerProvider()')
}

export { AcpProvider }

/** Resolve loader defaults and validate the all-or-nothing local recovery choice. */
function resolveConfig(config: Config & {
  readonly providerName: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly disposeEofGraceMs: number
  readonly teamLinkProviderPrefix: string
  readonly teamLinkReconnectDelayMs: number
}): ResolvedConfig {
  const base: ResolvedConfig = {
    providerName: config.providerName,
    command: config.command,
    args: [...config.args],
    env: { ...config.env },
    disposeEofGraceMs: config.disposeEofGraceMs,
    ...config.teamLinkEnrollmentProvider === undefined ? {} : { teamLinkEnrollmentProvider: config.teamLinkEnrollmentProvider },
    teamLinkProviderPrefix: config.teamLinkProviderPrefix,
    teamLinkReconnectDelayMs: config.teamLinkReconnectDelayMs,
    ...config.recoverySupervisor === undefined ? {} : { recoverySupervisor: config.recoverySupervisor },
  }
  const hasRecovery = config.recoveryProfile !== undefined || config.recoveryHostId !== undefined
    || config.recoveryFenceGraceMs !== undefined
  if (!hasRecovery) {
    if (config.recoverySupervisor !== undefined) {
      throw new TypeError('agent-runtime-acp recoverySupervisor requires recoveryProfile and recoveryHostId')
    }
    return base
  }
  if (config.recoveryProfile === undefined || config.recoveryHostId === undefined) {
    throw new TypeError('agent-runtime-acp recoveryProfile and recoveryHostId must be configured together')
  }
  const profile = normalizedRecoveryText(config.recoveryProfile, 'recoveryProfile')
  const hostId = normalizedRecoveryText(config.recoveryHostId, 'recoveryHostId')
  const fenceGraceMs = config.recoveryFenceGraceMs ?? 1_000
  if (!Number.isSafeInteger(fenceGraceMs) || fenceGraceMs < 1 || fenceGraceMs > MAX_TIMER_DELAY_MS) {
    throw new TypeError('agent-runtime-acp recoveryFenceGraceMs must be a positive safe integer within the timer range')
  }
  return { ...base, recovery: { profile, hostId, fenceGraceMs } }
}

/** Reject surrounding whitespace in durable recovery identities. */
function normalizedRecoveryText(value: string, name: 'recoveryProfile' | 'recoveryHostId'): string {
  if (value.trim().length === 0 || value.trim() !== value) {
    throw new TypeError(`agent-runtime-acp ${name} must be non-empty without surrounding whitespace`)
  }
  return value
}

/** Race ACP startup against activation cancellation so a stalled handshake is reaped immediately. */
async function raceAbort<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw abortError(signal)
  let removeAbort!: () => void
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => { reject(abortError(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    removeAbort = () => { signal.removeEventListener('abort', onAbort) }
  })
  try {
    return await Promise.race([operation(), aborted])
  } finally {
    removeAbort()
  }
}

/** Preserve an Error abort reason while normalizing arbitrary caller reasons. */
function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  return new Error('ACP AgentRuntime activation was aborted before publication', { cause: signal.reason })
}
