import type { TeamInboxRespondParams } from '@clocky/clocky-sdk-protocol'
import { teamHumanActionResponseInputSchema, teamHumanActionResponseResultSchema } from '@clocky/clocky-team'
import type { TeamHumanActionResponseResult } from '@clocky/clocky-team'
import { teamHumanInboxReadInputSchema, teamHumanInboxPageSchema, teamHumanInboxAcknowledgeInputSchema, teamHumanInboxAcknowledgementSchema } from '@clocky/clocky-team'
import type { TeamHumanInboxReadInput, TeamHumanInboxPage, TeamHumanInboxAcknowledgeInput, TeamHumanInboxAcknowledgement } from '@clocky/clocky-team'
/**
 * Low-level JSON-RPC client for a Clocky SDK runtime subprocess.
 * {@link HarnessClient} owns the child process: it spawns the runtime, speaks
 * the `@clocky/clocky-sdk-protocol` wire over the child's stdio, fans
 * server notifications out to subscriptions, and tears the child down to
 * quiescence through a private EOF → SIGTERM → SIGKILL ladder. The design
 * twin is the Python SDK's `HarnessClient` (`python/sdk`); both drive the
 * same runtime protocol. This client runs OUTSIDE any harness context, so it
 * spawns directly rather than through the `clocky-subprocess` service — the
 * seam's documented exception for SDK-managed transports.
 *
 * @module @clocky/clocky-sdk-client/client
 */

import { spawn, type ChildProcess } from 'node:child_process'
import {
  activationDisposeParamsSchema,
  activationDisposeResultSchema,
  activationInterruptParamsSchema,
  activationInterruptResultSchema,
  activationLinkEnrollParamsSchema,
  activationLinkEnrollResultSchema,
  activationOpenParamsSchema,
  activationOpenResultSchema,
  activationStatusNotificationSchema,
  activationStatusParamsSchema,
  activationStatusResultSchema,
  initializeParamsSchema,
  initializeResultSchema,
  JsonRpcLineTransport,
  JsonRpcResponseError,
  type ActivationDisposeParams,
  type ActivationInterruptParams,
  type ActivationLinkEnrollParams,
  type ActivationOpenParams,
  type ActivationStatusNotification,
  type ActivationStatusParams,
  type InitializeParams,
  type InitializeResult,
  type SdkActivationState,
  type TeamCancelParams,
  type TeamCancelResult,
  type TeamCreateParams,
  type TeamCreateResult,
  type TeamResumeParams,
  type TeamResumeResult,
  type TeamArchiveParams,
  type TeamArchiveResult,
  type TeamWaitFinalParams,
  type TeamWaitFinalResult,
  type TeamListParams,
  type TeamListResult,
  type TeamGetParams,
  type TeamGetResult,
  type TeamGoalUpdateParams,
  type TeamGoalUpdateResult,
  type TeamGoalTransitionParams,
  type TeamGoalTransitionResult,
  type TeamQuiescenceParams,
  type TeamQuiescenceResult,
  type TeamMetricsParams,
  type TeamMetricsResult,
  type TeamAuditReadParams,
  type TeamAuditReadResult,
  type TeamArtifactReadParams,
  type TeamArtifactReadResult,
  type TeamArtifactListParams,
  type TeamArtifactListResult,
  type TeamMemberListParams,
  type TeamMemberListResult,
  type TeamMemberInviteParams,
  type TeamMemberInviteResult,
  type TeamMemberActivateParams,
  type TeamMemberActivateResult,
  type TeamMemberRemoveParams,
  type TeamMemberRemoveResult,
  type TeamMemberInterruptParams,
  type TeamMemberInterruptResult,
  type TeamChannelOpenParams,
  type TeamChannelInvitationParams,
  type TeamChannelCatalogParams,
  type TeamChannelCatalogResult,
  type TeamChannelSummarizeParams,
  type TeamChannelSummarizeResult,
  type TeamChannelListParams,
  type TeamChannelListResult,
  type TeamChannelAdmissionParams,
  type TeamChannelAdmissionResult,
  type TeamChannelInvitationAcknowledgeParams,
  type TeamChannelInvitationResult,
  type TeamChannelOpenResult,
  type TeamChannelInputParams,
  type TeamChannelAttachmentParams,
  type TeamChannelAttachmentResult,
  type TeamChannelPostParams,
  type TeamChannelPostResult,
  type TeamChannelReadParams,
  type TeamChannelReadResult,
  type TeamChannelCloseParams,
  type TeamChannelCloseResult,
  type TeamChannelWatchParams,
  type TeamChannelWatchResult,
  type TeamTaskCreateParams,
  type TeamTaskCreateResult,
  type TeamTaskGetParams,
  type TeamTaskGetResult,
  type TeamTaskListParams,
  type TeamTaskListResult,
  type TeamWorkflowPlanListParams,
  type TeamWorkflowPlanListResult,
  type TeamTaskUpdateParams,
  type TeamTaskUpdateResult,
  type TeamTaskCancelParams,
  type TeamTaskCancelResult,
  type TeamTaskDeleteParams,
  type TeamTaskDeleteResult,
  type TeamTaskReviewParams,
  type TeamTaskReviewResult,
  type TeamTaskWatchParams,
  type TeamTaskWatchResult,
  teamCancelParamsSchema,
  teamCancelResultSchema,
  teamArchiveParamsSchema,
  teamArchiveResultSchema,
  teamCreateParamsSchema,
  teamCreateResultSchema,
  teamResumeParamsSchema,
  teamResumeResultSchema,
  teamWaitFinalParamsSchema,
  teamWaitFinalResultSchema,
  teamListParamsSchema,
  teamListResultSchema,
  teamGetParamsSchema,
  teamGetResultSchema,
  teamGoalUpdateParamsSchema,
  teamGoalUpdateResultSchema,
  teamGoalTransitionParamsSchema,
  teamGoalTransitionResultSchema,
  teamQuiescenceParamsSchema,
  teamQuiescenceResultSchema,
  teamMetricsParamsSchema,
  teamMetricsResultSchema,
  teamAuditReadParamsSchema,
  teamAuditReadResultSchema,
  teamArtifactReadParamsSchema,
  teamArtifactReadResultSchema,
  teamArtifactListParamsSchema,
  teamArtifactListResultSchema,
  teamMemberListParamsSchema,
  teamMemberListResultSchema,
  teamMemberInviteParamsSchema,
  teamMemberInviteResultSchema,
  teamMemberActivateParamsSchema,
  teamMemberActivateResultSchema,
  teamMemberRemoveParamsSchema,
  teamMemberRemoveResultSchema,
  teamMemberInterruptParamsSchema,
  teamMemberInterruptResultSchema,
  teamChannelOpenParamsSchema,
  teamChannelInvitationParamsSchema,
  teamChannelCatalogParamsSchema,
  teamChannelCatalogResultSchema,
  teamChannelSummarizeParamsSchema,
  teamChannelSummarizeResultSchema,
  teamChannelListParamsSchema,
  teamChannelListResultSchema,
  teamChannelAdmissionParamsSchema,
  teamChannelAdmissionResultSchema,
  teamChannelInvitationAcknowledgeParamsSchema,
  teamChannelInvitationResultSchema,
  teamChannelOpenResultSchema,
  teamChannelInputParamsSchema,
  teamChannelAttachmentParamsSchema,
  teamChannelAttachmentResultSchema,
  teamChannelPostParamsSchema,
  teamChannelPostResultSchema,
  teamChannelReadParamsSchema,
  teamChannelReadResultSchema,
  teamChannelCloseParamsSchema,
  teamChannelCloseResultSchema,
  teamChannelWatchParamsSchema,
  teamChannelWatchResultSchema,
  teamTaskCreateParamsSchema,
  teamTaskCreateResultSchema,
  teamTaskGetParamsSchema,
  teamTaskGetResultSchema,
  teamTaskListParamsSchema,
  teamTaskListResultSchema,
  teamWorkflowPlanListParamsSchema,
  teamWorkflowPlanListResultSchema,
  teamTaskUpdateParamsSchema,
  teamTaskUpdateResultSchema,
  teamTaskCancelParamsSchema,
  teamTaskCancelResultSchema,
  teamTaskDeleteParamsSchema,
  teamTaskDeleteResultSchema,
  teamTaskReviewParamsSchema,
  teamTaskReviewResultSchema,
  teamTaskWatchParamsSchema,
  teamTaskWatchResultSchema,
} from '@clocky/clocky-sdk-protocol'
import { disposeRuntimeProcess } from './dispose.ts'
import type { HarnessClientOptions, HarnessNotification, NotificationFilter } from './types.ts'

/** Retained stderr lines used to diagnose an unexpected runtime death. */
const STDERR_TAIL_LIMIT = 400

/** Grace for the runtime's stdio streams to settle after its exit edge. */
const STREAM_SETTLE_MS = 100

/**
 * The runtime subprocess is gone or unusable: it exited, its stdio closed, or
 * it was never launchable. The message carries the exit code and a stderr
 * tail when available.
 */
export class TransportClosedError extends Error {
  /** @param message - the failure description, including any stderr tail. */
  constructor(message: string) {
    super(message)
    this.name = 'TransportClosedError'
  }
}

/** A request exceeded {@link HarnessClientOptions.requestTimeoutMs}. */
export class RequestTimeoutError extends Error {
  /** @param message - which method timed out. */
  constructor(message: string) {
    super(message)
    this.name = 'RequestTimeoutError'
  }
}

/**
 * The runtime answered outside its documented protocol (for example a
 * a documented Team or activation response with missing required fields).
 */
export class SdkProtocolError extends Error {
  /** @param message - the protocol violation description. */
  constructor(message: string) {
    super(message)
    this.name = 'SdkProtocolError'
  }
}

interface SubscriptionState {
  readonly queue: HarnessNotification[]
  readonly waiters: { resolve: (item: HarnessNotification) => void; reject: (error: Error) => void }[]
  readonly filter: NotificationFilter | undefined
  failure: Error | undefined
}

/** One client-side notification stream returned by {@link HarnessClient.subscribe}. */
export interface NotificationSubscription extends AsyncIterable<HarnessNotification> {
  /**
   * Await the next matching notification.
   * @returns the notification; after the runtime died, drains what was
   * already delivered and then rejects; after {@link close}, rejects
   * immediately (the queue is dropped).
   */
  next(): Promise<HarnessNotification>

  /**
   * Drain one already-delivered notification without waiting.
   * @returns the next queued notification, or `undefined` when none is queued.
   */
  tryNext(): HarnessNotification | undefined

  /** Detach from the client; queued items drop and pending waiters reject. */
  close(): void
}

/** Internal producer side of a public notification subscription. */
class NotificationSubscriptionImpl implements NotificationSubscription {
  constructor(
    private readonly state: SubscriptionState,
    private readonly unsubscribe: () => void,
  ) {}

  /**
   * Await the next matching notification.
   * @returns the notification; after the runtime died, drains what was
   * already delivered and then rejects; after {@link close}, rejects
   * immediately (the queue is dropped).
   */
  next(): Promise<HarnessNotification> {
    const queued = this.state.queue.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    if (this.state.failure !== undefined) return Promise.reject(this.state.failure)
    return new Promise((resolve, reject) => {
      this.state.waiters.push({ resolve, reject })
    })
  }

  /**
   * Drain one already-delivered notification without waiting.
   * @returns the next queued notification, or `undefined` when none is queued.
   */
  tryNext(): HarnessNotification | undefined {
    return this.state.queue.shift()
  }

  /** Detach from the client; queued items drop and pending waiters reject. */
  close(): void {
    this.unsubscribe()
    // The drop is part of this method's contract; a runtime-death fail() keeps
    // the queue so already-delivered notifications remain drainable.
    this.state.queue.length = 0
    this.fail(new TransportClosedError('notification subscription closed'))
  }

  /**
   * Reject pending and future waits (delivery stops; the first failure wins).
   * Already-queued notifications remain drainable via {@link next}/{@link tryNext}.
   * @param error - the terminal failure delivered to waiters.
   */
  fail(error: Error): void {
    this.state.failure ??= error
    for (const waiter of this.state.waiters.splice(0)) waiter.reject(this.state.failure)
  }

  /**
   * Deliver one notification to a waiter or the queue when the filter
   * matches. A throwing filter fails only THIS subscription (detached, the
   * throw becomes its terminal error) — it never disturbs sibling
   * subscriptions or the transport's read loop, mirroring the Python client.
   * @param notification - the wire notification to deliver.
   */
  push(notification: HarnessNotification): void {
    let matches: boolean
    try {
      matches = this.state.filter === undefined || this.state.filter(notification)
    } catch (error) {
      this.unsubscribe()
      this.fail(error instanceof Error ? error : new Error(String(error)))
      return
    }
    if (!matches) return
    const waiter = this.state.waiters.shift()
    if (waiter !== undefined) waiter.resolve(notification)
    else this.state.queue.push(notification)
  }

  /**
   * Iterate notifications until the subscription or runtime closes (the
   * terminating rejection propagates).
   * @returns an async iterator over {@link next} results.
   */
  async * [Symbol.asyncIterator](): AsyncIterator<HarnessNotification> {
    for (;;) yield await this.next()
  }
}

/**
 * JSON-RPC client for Clocky SDK runtime over subprocess stdio.
 *
 * The subprocess starts lazily on {@link start} and is owned by this instance
 * until {@link close}, which requests protocol `shutdown` and then walks the
 * shared EOF → SIGTERM → SIGKILL dispose ladder to quiescence. There is no
 * wire-level cancel: a timed-out request stays running server-side until the
 * runtime is closed.
 */
export class HarnessClient {
  private child: ChildProcess | undefined
  private transport: JsonRpcLineTransport | undefined
  private readonly stderrTail: string[] = []
  private readonly subscriptions = new Map<string, NotificationSubscriptionImpl>()
  private subscriptionSerial = 0
  private exitCode: number | null | undefined
  private spawnError: Error | undefined
  private streamsSettled: Promise<void> = Promise.resolve()
  private closeTask: Promise<void> | undefined
  /** Whether the live child was launched only after its initialization credential was known. */
  private startedWithCredential = false
  /** Handshake credential used while preparing the live child environment; retained only until process teardown. */
  private launchCredential: string | undefined

  /** @param options - launch spec, complete child environment, and timeouts. */
  constructor(readonly options: HarnessClientOptions) {}

  /** Child process id after the runtime starts, or `undefined` before publication, after termination, or after spawn failure. */
  get pid(): number | undefined {
    if (this.exitCode !== undefined || this.spawnError !== undefined) return undefined
    const pid = this.child?.pid
    return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
  }

  /**
   * Spawn the runtime subprocess and start reading frames. Idempotent while
   * the process is live; rejects reuse after {@link close}.
   * @param credential - optional handshake secret used to scrub the child launch environment and reject command-line leaks.
   */
  start(credential?: string): void {
    if (this.closeTask !== undefined) throw new TransportClosedError('Clocky runtime client is closed')
    if (this.child !== undefined) {
      if (credential !== undefined && !this.startedWithCredential) {
        throw new SdkProtocolError('Clocky runtime was started before its product credential was supplied')
      }
      if (credential !== undefined && credential !== this.launchCredential) {
        throw new SdkProtocolError('Clocky runtime was launched with another product credential; create a new client before reinitializing')
      }
      return
    }
    assertCredentialAbsentFromLaunch(this.options, credential)
    const child = spawn(this.options.command, this.options.args ?? [], {
      cwd: this.options.cwd,
      env: scrubCredentialFromLaunchEnvironment(this.options.env ?? process.env, credential),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: this.options.detached === true,
    })
    this.child = child
    this.startedWithCredential = credential !== undefined
    this.launchCredential = credential
    child.once('error', (error) => {
      this.spawnError = error
      // A spawn failure destroys the pipes without an input 'end' edge, so the
      // transport's pending requests must be failed here.
      this.transport?.close()
      this.failSubscriptions(this.closedError('Clocky runtime failed to start'))
    })
    // Writes racing the runtime's death EPIPE on stdin; the exit edge below is
    // the real signal, so the stream-level error only needs to be non-fatal.
    // The timing of that race is not deterministically reproducible.
    /* v8 ignore next */
    child.stdin.on('error', () => {})
    let stderrBuffer = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk
      const newline = stderrBuffer.lastIndexOf('\n')
      if (newline >= 0) {
        this.appendStderr(stderrBuffer.slice(0, newline).split('\n'))
        stderrBuffer = stderrBuffer.slice(newline + 1)
      }
    })
    let signalStreamsSettled!: () => void
    this.streamsSettled = new Promise((resolve) => { signalStreamsSettled = resolve })
    const settled = { stderr: false, exited: false }
    const maybeSettle = (): void => {
      if (settled.stderr && settled.exited) signalStreamsSettled()
    }
    child.stderr.once('close', () => {
      if (stderrBuffer.length > 0) this.appendStderr([stderrBuffer])
      settled.stderr = true
      maybeSettle()
    })
    child.once('exit', (code) => {
      this.exitCode = code
      settled.exited = true
      maybeSettle()
      this.failSubscriptions(this.closedError('Clocky runtime exited'))
    })
    child.once('close', () => {
      // All stdio has settled: stdout 'end' already drained every tail frame,
      // so closing now cannot drop responses — it only fails requests that
      // will never be answered.
      this.transport?.close()
    })
    const transport = new JsonRpcLineTransport(child.stdout, child.stdin)
    transport.onNotification((method, params) => { this.dispatchNotification({ method, params }) })
    transport.start()
    this.transport = transport
  }

  /**
   * Perform the process-wide handshake.
   * @param params - workspace cwd plus the provider/model route.
   * @returns the runtime's wire identity.
   */
  async initialize(params: InitializeParams): Promise<InitializeResult> {
    const credential = typeof (params as Partial<InitializeParams>).credential === 'string'
      ? params.credential
      : ''
    try {
      const parsed = parseProtocolValue('initialize params', initializeParamsSchema, params)
      this.start(parsed.credential)
      const result = await this.request('initialize', parsed)
      return parseProtocolValue('initialize result', initializeResultSchema, result)
    } catch (error: unknown) {
      throw redactCredentialError(error, credential)
    }
  }

  /**
   * Create one product Team and admit its initial human content.
   * @param params - Team objective and direct-channel content.
   * @returns Team and initial Envelope identities after durable admission.
   */
  async createTeam(params: TeamCreateParams): Promise<TeamCreateResult> {
    const parsed = parseProtocolValue('team/create params', teamCreateParamsSchema, params)
    const result = await this.request('team/create', parsed)
    return parseProtocolValue('team/create result', teamCreateResultSchema, result)
  }

  /**
   * List durable Teams visible to this runtime.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async listTeams(params: TeamListParams = {}): Promise<TeamListResult> {
    const parsed = parseProtocolValue('team/list params', teamListParamsSchema, params)
    const result = await this.request('team/list', parsed)
    return parseProtocolValue('team/list result', teamListResultSchema, result)
  }

  /**
   * Read one complete durable Team projection.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async getTeam(params: TeamGetParams): Promise<TeamGetResult> {
    const parsed = parseProtocolValue('team/get params', teamGetParamsSchema, params)
    const result = await this.request('team/get', parsed)
    return parseProtocolValue('team/get result', teamGetResultSchema, result)
  }

  /**
   * Update one Team objective through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the validated Team state from the runtime.
   */
  async updateTeamGoal(params: TeamGoalUpdateParams): Promise<TeamGoalUpdateResult> {
    const parsed = parseProtocolValue('team/goal-update params', teamGoalUpdateParamsSchema, params)
    const result = await this.request('team/goal-update', parsed)
    return parseProtocolValue('team/goal-update result', teamGoalUpdateResultSchema, result)
  }

  /**
   * Transition one Team objective through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the validated Team state from the runtime.
   */
  async transitionTeamGoal(params: TeamGoalTransitionParams): Promise<TeamGoalTransitionResult> {
    const parsed = parseProtocolValue('team/goal-transition params', teamGoalTransitionParamsSchema, params)
    const result = await this.request('team/goal-transition', parsed)
    return parseProtocolValue('team/goal-transition result', teamGoalTransitionResultSchema, result)
  }

  /**
   * Read durable Team quiescence diagnostics.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async getTeamQuiescence(params: TeamQuiescenceParams): Promise<TeamQuiescenceResult> {
    const parsed = parseProtocolValue('team/quiescence params', teamQuiescenceParamsSchema, params)
    const result = await this.request('team/quiescence', parsed)
    return parseProtocolValue('team/quiescence result', teamQuiescenceResultSchema, result)
  }

  /**
   * Answer a durable human action.
   * @param params - Exact action, revision, retry key and typed answer.
   * @returns Durable acceptance or unavailability.
   */
  async inboxRespond(params: TeamInboxRespondParams): Promise<TeamHumanActionResponseResult> {
    const input = parseProtocolValue('team/inbox-respond params', teamHumanActionResponseInputSchema, params)
    return parseProtocolValue('team/inbox-respond result', teamHumanActionResponseResultSchema, await this.request('team/inbox-respond', input))
  }

  /**
   * Read the authenticated principal inbox.
   * @param params - Actor-free inbox input.
   * @returns Validated durable inbox result.
   */
  async inboxRead(params: TeamHumanInboxReadInput): Promise<TeamHumanInboxPage> {
    const input = parseProtocolValue('team/inbox-read params', teamHumanInboxReadInputSchema, params)
    return parseProtocolValue('team/inbox-read result', teamHumanInboxPageSchema, await this.request('team/inbox-read', input))
  }

  /**
   * Watch the authenticated principal inbox.
   * @param params - Actor-free inbox input.
   * @returns Validated durable inbox result.
   */
  async inboxWatch(params: TeamHumanInboxReadInput): Promise<TeamHumanInboxPage> {
    const input = parseProtocolValue('team/inbox-watch params', teamHumanInboxReadInputSchema, params)
    return parseProtocolValue('team/inbox-watch result', teamHumanInboxPageSchema, await this.request('team/inbox-watch', input))
  }

  /**
   * Acknowledge the authenticated principal inbox display cursor.
   * @param params - Actor-free inbox input.
   * @returns Validated durable inbox result.
   */
  async inboxAcknowledge(params: TeamHumanInboxAcknowledgeInput): Promise<TeamHumanInboxAcknowledgement> {
    const input = parseProtocolValue('team/inbox-acknowledge params', teamHumanInboxAcknowledgeInputSchema, params)
    return parseProtocolValue('team/inbox-acknowledge result', teamHumanInboxAcknowledgementSchema, await this.request('team/inbox-acknowledge', input))
  }

  /**
   * Read process-local Team operational counters.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async getTeamMetrics(params: TeamMetricsParams = {}): Promise<TeamMetricsResult> {
    const parsed = parseProtocolValue('team/metrics params', teamMetricsParamsSchema, params)
    const result = await this.request('team/metrics', parsed)
    return parseProtocolValue('team/metrics result', teamMetricsResultSchema, result)
  }

  /**
   * Read one bounded Team or channel audit page.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async readTeamAudit(params: TeamAuditReadParams): Promise<TeamAuditReadResult> {
    const parsed = parseProtocolValue('team/audit-read params', teamAuditReadParamsSchema, params)
    const result = await this.request('team/audit-read', parsed)
    return parseProtocolValue('team/audit-read result', teamAuditReadResultSchema, result)
  }

  /**
   * Read one visible Team artifact through the runtime's provider boundary.
   * @param params - Team and durable artifact identifiers.
   * @returns verified bytes and the exact durable reference.
   */
  async readTeamArtifact(params: TeamArtifactReadParams): Promise<TeamArtifactReadResult> {
    const parsed = parseProtocolValue('team/artifact-read params', teamArtifactReadParamsSchema, params)
    const result = await this.request('team/artifact-read', parsed)
    return parseProtocolValue('team/artifact-read result', teamArtifactReadResultSchema, result)
  }

  /**
   * List bounded visible artifact references retained by one Team.
   * @param params - Team identity, page cursor, and page limit.
   * @returns the validated result from the runtime.
   */
  async listTeamArtifacts(params: TeamArtifactListParams): Promise<TeamArtifactListResult> {
    const parsed = parseProtocolValue('team/artifact-list params', teamArtifactListParamsSchema, params)
    const result = await this.request('team/artifact-list', parsed)
    return parseProtocolValue('team/artifact-list result', teamArtifactListResultSchema, result)
  }

  /**
   * List durable Team participant descriptors.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async listTeamMembers(params: TeamMemberListParams): Promise<TeamMemberListResult> {
    const parsed = parseProtocolValue('team/member-list params', teamMemberListParamsSchema, params)
    const result = await this.request('team/member-list', parsed)
    return parseProtocolValue('team/member-list result', teamMemberListResultSchema, result)
  }

  /**
   * Invite one non-human Team participant through the authenticated human route.
   * @param params - validated Team operation parameters.
   * @returns the invited participant projection.
   */
  async inviteTeamMember(params: TeamMemberInviteParams): Promise<TeamMemberInviteResult> {
    const parsed = parseProtocolValue('team/member-invite params', teamMemberInviteParamsSchema, params)
    const result = await this.request('team/member-invite', parsed)
    return parseProtocolValue('team/member-invite result', teamMemberInviteResultSchema, result)
  }

  /**
   * Activate one invited Team participant through the authenticated human route.
   * @param params - validated Team operation parameters.
   * @returns the active participant projection.
   */
  async activateTeamMember(params: TeamMemberActivateParams): Promise<TeamMemberActivateResult> {
    const parsed = parseProtocolValue('team/member-activate params', teamMemberActivateParamsSchema, params)
    const result = await this.request('team/member-activate', parsed)
    return parseProtocolValue('team/member-activate result', teamMemberActivateResultSchema, result)
  }

  /**
   * Remove one active Team participant through the authenticated human route.
   * @param params - validated Team operation parameters.
   * @returns the departed participant projection.
   */
  async removeTeamMember(params: TeamMemberRemoveParams): Promise<TeamMemberRemoveResult> {
    const parsed = parseProtocolValue('team/member-remove params', teamMemberRemoveParamsSchema, params)
    const result = await this.request('team/member-remove', parsed)
    return parseProtocolValue('team/member-remove result', teamMemberRemoveResultSchema, result)
  }

  /**
   * Request a soft participant interrupt through the authenticated human route.
   * @param params - validated Team operation parameters.
   * @returns the durable interrupt projection.
   */
  async interruptTeamMember(params: TeamMemberInterruptParams): Promise<TeamMemberInterruptResult> {
    const parsed = parseProtocolValue('team/member-interrupt params', teamMemberInterruptParamsSchema, params)
    const result = await this.request('team/member-interrupt', parsed)
    return parseProtocolValue('team/member-interrupt result', teamMemberInterruptResultSchema, result)
  }

  /** Discover installed protocols, view policies and summary bounds.
   * @param params - Empty authenticated discovery request.
   * @returns Accepting registrations and optional summary capabilities.
   */
  async getTeamChannelCatalog(params: TeamChannelCatalogParams = {}): Promise<TeamChannelCatalogResult> {
    const parsed = parseProtocolValue('team/channel-catalog params', teamChannelCatalogParamsSchema, params)
    return parseProtocolValue('team/channel-catalog result', teamChannelCatalogResultSchema, await this.request('team/channel-catalog', parsed))
  }

  /** Commit a summary of an explicitly selected channel range.
   * @param params - Exact source range, observed cursor and retry key.
   * @returns Durable summary and source provenance.
   */
  async summarizeTeamChannel(params: TeamChannelSummarizeParams): Promise<TeamChannelSummarizeResult> {
    const parsed = parseProtocolValue('team/channel-summarize params', teamChannelSummarizeParamsSchema, params)
    return parseProtocolValue('team/channel-summarize result', teamChannelSummarizeResultSchema, await this.request('team/channel-summarize', parsed))
  }

  /**
   * List attached channels through authenticated Team membership.
   * @param params - Team and optional insertion cursor/page size.
   * @returns Bounded channel projections without message history.
   */
  async listTeamChannels(params: TeamChannelListParams): Promise<TeamChannelListResult> {
    const parsed = parseProtocolValue('team/channel-list params', teamChannelListParamsSchema, params)
    return parseProtocolValue('team/channel-list result', teamChannelListResultSchema, await this.request('team/channel-list', parsed))
  }

  /**
   * Read channel admission metadata through authenticated Team membership.
   * @param params - Owning Team and channel identities.
   * @returns Frozen manifest and endpoint admission states.
   */
  async getTeamChannelAdmission(params: TeamChannelAdmissionParams): Promise<TeamChannelAdmissionResult> {
    const parsed = parseProtocolValue('team/channel-admission params', teamChannelAdmissionParamsSchema, params)
    const result = await this.request('team/channel-admission', parsed)
    return parseProtocolValue('team/channel-admission result', teamChannelAdmissionResultSchema, result)
  }

  /**
   * Discover only the authenticated human's invitation without recording consent.
   * @param params - channel identity, with no caller-selected actor.
   * @returns the complete manifest and the caller's invitation.
   */
  async getTeamChannelInvitation(params: TeamChannelInvitationParams): Promise<TeamChannelInvitationResult> {
    const parsed = parseProtocolValue('team/channel-invitation params', teamChannelInvitationParamsSchema, params)
    const result = await this.request('team/channel-invitation', parsed)
    return parseProtocolValue('team/channel-invitation result', teamChannelInvitationResultSchema, result)
  }

  /**
   * Explicitly accept the discovered protocol and exact manifest.
   * @param params - invitation revision, manifest fingerprint and stable retry key.
   * @returns the durable acknowledgement and current channel state.
   */
  async acknowledgeTeamChannelInvitation(params: TeamChannelInvitationAcknowledgeParams): Promise<TeamChannelInvitationResult> {
    const parsed = parseProtocolValue('team/channel-invitation-acknowledge params', teamChannelInvitationAcknowledgeParamsSchema, params)
    const result = await this.request('team/channel-invitation-acknowledge', parsed)
    return parseProtocolValue('team/channel-invitation-acknowledge result', teamChannelInvitationResultSchema, result)
  }

  /**
   * Open one generic Team channel through the authenticated human route.
   * @param params - validated Team operation parameters.
   * @returns the opened channel projection.
   */
  async openTeamChannel(params: TeamChannelOpenParams): Promise<TeamChannelOpenResult> {
    const parsed = parseProtocolValue('team/channel-open params', teamChannelOpenParamsSchema, params)
    const result = await this.request('team/channel-open', parsed)
    return parseProtocolValue('team/channel-open result', teamChannelOpenResultSchema, result)
  }

  /**
   * Admit ordered direct-channel media or one consult/discussion text block.
   * @param params - Content, audience, delivery, and stable retry identity.
   * @returns The accepted Envelope with durable image references.
   */
  async inputTeamChannel(params: TeamChannelInputParams): Promise<TeamChannelPostResult> {
    const parsed = parseProtocolValue('team/channel-input params', teamChannelInputParamsSchema, params)
    return parseProtocolValue('team/channel-input result', teamChannelPostResultSchema, await this.request('team/channel-input', parsed))
  }

  /**
   * Read one image retained by an authorized channel Envelope.
   * @param params - Exact Team/channel/Envelope/attachment identities.
   * @returns Verified image reference and base64 bytes.
   */
  async readTeamChannelAttachment(params: TeamChannelAttachmentParams): Promise<TeamChannelAttachmentResult> {
    const parsed = parseProtocolValue('team/channel-attachment params', teamChannelAttachmentParamsSchema, params)
    return parseProtocolValue('team/channel-attachment result', teamChannelAttachmentResultSchema, await this.request('team/channel-attachment', parsed))
  }

  /**
   * Post one actor-free payload through the authenticated human route.
   * @param params - validated Team operation parameters.
   * @returns the Hub-stamped Envelope projection.
   */
  async postTeamChannel(params: TeamChannelPostParams): Promise<TeamChannelPostResult> {
    const parsed = parseProtocolValue('team/channel-post params', teamChannelPostParamsSchema, params)
    const result = await this.request('team/channel-post', parsed)
    return parseProtocolValue('team/channel-post result', teamChannelPostResultSchema, result)
  }

  /**
   * Read a bounded Team channel WAL suffix.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async readTeamChannel(params: TeamChannelReadParams): Promise<TeamChannelReadResult> {
    const parsed = parseProtocolValue('team/channel-read params', teamChannelReadParamsSchema, params)
    const result = await this.request('team/channel-read', parsed)
    return parseProtocolValue('team/channel-read result', teamChannelReadResultSchema, result)
  }

  /**
   * Close one generic Team channel through the authenticated human route.
   * @param params - validated Team operation parameters.
   * @returns the terminal channel projection.
   */
  async closeTeamChannel(params: TeamChannelCloseParams): Promise<TeamChannelCloseResult> {
    const parsed = parseProtocolValue('team/channel-close params', teamChannelCloseParamsSchema, params)
    const result = await this.request('team/channel-close', parsed)
    return parseProtocolValue('team/channel-close result', teamChannelCloseResultSchema, result)
  }

  /**
   * Wait for one Team channel cursor to advance or close.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async watchTeamChannel(params: TeamChannelWatchParams): Promise<TeamChannelWatchResult> {
    const parsed = parseProtocolValue('team/channel-watch params', teamChannelWatchParamsSchema, params)
    const result = await this.request('team/channel-watch', parsed)
    return parseProtocolValue('team/channel-watch result', teamChannelWatchResultSchema, result)
  }

  /**
   * List durable Team tasks including tombstones.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async listTeamTasks(params: TeamTaskListParams): Promise<TeamTaskListResult> {
    const parsed = parseProtocolValue('team/task-list params', teamTaskListParamsSchema, params)
    const result = await this.request('team/task-list', parsed)
    return parseProtocolValue('team/task-list result', teamTaskListResultSchema, result)
  }

  /**
   * List durable workflow plan projections in bounded admission order.
   * @param params - Team identity, page cursor, and page limit.
   * @returns the validated result from the runtime.
   */
  async listWorkflowPlans(params: TeamWorkflowPlanListParams): Promise<TeamWorkflowPlanListResult> {
    const parsed = parseProtocolValue('team/workflow-plan-list params', teamWorkflowPlanListParamsSchema, params)
    const result = await this.request('team/workflow-plan-list', parsed)
    return parseProtocolValue('team/workflow-plan-list result', teamWorkflowPlanListResultSchema, result)
  }

  /**
   * Create one Team task through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async createTeamTask(params: TeamTaskCreateParams): Promise<TeamTaskCreateResult> {
    const parsed = parseProtocolValue('team/task-create params', teamTaskCreateParamsSchema, params)
    const result = await this.request('team/task-create', parsed)
    return parseProtocolValue('team/task-create result', teamTaskCreateResultSchema, result)
  }

  /**
   * Read one durable Team task.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async getTeamTask(params: TeamTaskGetParams): Promise<TeamTaskGetResult> {
    const parsed = parseProtocolValue('team/task-get params', teamTaskGetParamsSchema, params)
    const result = await this.request('team/task-get', parsed)
    return parseProtocolValue('team/task-get result', teamTaskGetResultSchema, result)
  }

  /**
   * Update one Team task through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async updateTeamTask(params: TeamTaskUpdateParams): Promise<TeamTaskUpdateResult> {
    const parsed = parseProtocolValue('team/task-update params', teamTaskUpdateParamsSchema, params)
    const result = await this.request('team/task-update', parsed)
    return parseProtocolValue('team/task-update result', teamTaskUpdateResultSchema, result)
  }

  /**
   * Cancel one Team task through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async cancelTeamTask(params: TeamTaskCancelParams): Promise<TeamTaskCancelResult> {
    const parsed = parseProtocolValue('team/task-cancel params', teamTaskCancelParamsSchema, params)
    const result = await this.request('team/task-cancel', parsed)
    return parseProtocolValue('team/task-cancel result', teamTaskCancelResultSchema, result)
  }

  /**
   * Delete one Team task through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async deleteTeamTask(params: TeamTaskDeleteParams): Promise<TeamTaskDeleteResult> {
    const parsed = parseProtocolValue('team/task-delete params', teamTaskDeleteParamsSchema, params)
    const result = await this.request('team/task-delete', parsed)
    return parseProtocolValue('team/task-delete result', teamTaskDeleteResultSchema, result)
  }

  /**
   * Resolve one Team task review through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async reviewTeamTask(params: TeamTaskReviewParams): Promise<TeamTaskReviewResult> {
    const parsed = parseProtocolValue('team/task-review params', teamTaskReviewParamsSchema, params)
    const result = await this.request('team/task-review', parsed)
    return parseProtocolValue('team/task-review result', teamTaskReviewResultSchema, result)
  }

  /**
   * Wait for one Team task graph cursor to advance or close.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async watchTeamTasks(params: TeamTaskWatchParams): Promise<TeamTaskWatchResult> {
    const parsed = parseProtocolValue('team/task-watch params', teamTaskWatchParamsSchema, params)
    const result = await this.request('team/task-watch', parsed)
    return parseProtocolValue('team/task-watch result', teamTaskWatchResultSchema, result)
  }

  /**
   * Resume one Team through the authenticated connection's human proof.
   * @param params - Team identity and observed cursor selected for resume.
   * @returns the reattached Team coordinator identity.
   */
  async resumeTeam(params: TeamResumeParams): Promise<TeamResumeResult> {
    const parsed = parseProtocolValue('team/resume params', teamResumeParamsSchema, params)
    const result = await this.request('team/resume', parsed)
    return parseProtocolValue('team/resume result', teamResumeResultSchema, result)
  }

  /**
   * Wait for one current product Team's explicit final output.
   * @param params - Team selected by its creation receipt.
   * @returns human-facing final result after Team settlement.
   */
  async waitForTeamFinal(params: TeamWaitFinalParams): Promise<TeamWaitFinalResult> {
    const parsed = parseProtocolValue('team/wait-final params', teamWaitFinalParamsSchema, params)
    const result = await this.request('team/wait-final', parsed)
    return parseProtocolValue('team/wait-final result', teamWaitFinalResultSchema, result)
  }

  /**
   * Cancel one current product Team and release its coordinator.
   * @param params - Team selected by its creation receipt.
   * @returns settlement after local cancellation completes.
   */
  async cancelTeam(params: TeamCancelParams): Promise<TeamCancelResult> {
    const parsed = parseProtocolValue('team/cancel params', teamCancelParamsSchema, params)
    const result = await this.request('team/cancel', parsed)
    return parseProtocolValue('team/cancel result', teamCancelResultSchema, result)
  }

  /**
   * Archive a terminal Team through the authenticated connection's human proof.
   * @param params - Team identity and observed cursor selected for archival.
   * @returns the durable archive marker, or a binder, authority, or stale-cursor rejection.
   */
  async archiveTeam(params: TeamArchiveParams): Promise<TeamArchiveResult> {
    const parsed = parseProtocolValue('team/archive params', teamArchiveParamsSchema, params)
    const result = await this.request('team/archive', parsed)
    return parseProtocolValue('team/archive result', teamArchiveResultSchema, result)
  }

  /**
   * Open one exact remote activation after the process-level SDK handshake.
   * @param params - Team/Participant/Session/epoch target plus fresh/resume seed.
   * @returns the published remote activation state.
   */
  async openActivation(params: ActivationOpenParams): Promise<SdkActivationState> {
    const parsed = parseProtocolValue('activation/open params', activationOpenParamsSchema, params)
    const result = await this.request('activation/open', parsed)
    return parseProtocolValue('activation/open result', activationOpenResultSchema, result).state
  }

  /**
   * Attach an activation-local Team Link only after the authoritative Hub
   * committed its complete durable binding.
   * @param params - exact activation target, binding, and opaque credential.
   */
  async enrollActivationLink(params: ActivationLinkEnrollParams): Promise<void> {
    const parsed = parseProtocolValue('activation/link-enroll params', activationLinkEnrollParamsSchema, params)
    const result = await this.request('activation/link-enroll', parsed)
    parseProtocolValue('activation/link-enroll result', activationLinkEnrollResultSchema, result)
  }

  /**
   * Read one exact remote activation state.
   * @param params - Team/Participant/Session/epoch target to query.
   * @returns the current remote state, including its monotonic status sequence.
   */
  async getActivationStatus(params: ActivationStatusParams): Promise<SdkActivationState> {
    const parsed = parseProtocolValue('activation/status params', activationStatusParamsSchema, params)
    const result = await this.request('activation/status', parsed)
    return parseProtocolValue('activation/status result', activationStatusResultSchema, result).state
  }

  /**
   * Request interruption of one exact remote activation without disposing it.
   * A later status notification or status read reports the resulting state.
   * @param params - Team/Participant/Session/epoch target plus cancellation cause.
   * @returns settlement once the remote Agent accepts the interrupt request.
   */
  async interruptActivation(params: ActivationInterruptParams): Promise<void> {
    const parsed = parseProtocolValue('activation/interrupt params', activationInterruptParamsSchema, params)
    const result = await this.request('activation/interrupt', parsed)
    parseProtocolValue('activation/interrupt result', activationInterruptResultSchema, result)
  }

  /**
   * Dispose one exact remote activation without closing the hosting process.
   * @param params - Team/Participant/Session/epoch target to release.
   * @returns its terminal offline state after remote quiescence.
   */
  async disposeActivation(params: ActivationDisposeParams): Promise<SdkActivationState> {
    const parsed = parseProtocolValue('activation/dispose params', activationDisposeParamsSchema, params)
    const result = await this.request('activation/dispose', parsed)
    return parseProtocolValue('activation/dispose result', activationDisposeResultSchema, result).state
  }

  /**
   * Send one JSON-RPC request and await its result.
   * @param method - the wire method name.
   * @param params - the params object; omitted params send `{}`.
   * @param timeoutMs - per-call override of {@link HarnessClientOptions.requestTimeoutMs}.
   * @returns the raw result; rejects with {@link JsonRpcResponseError} on a
   * protocol error response, {@link RequestTimeoutError} on timeout, and
   * {@link TransportClosedError} when the runtime is gone.
   */
  async request(method: string, params?: object, timeoutMs?: number): Promise<unknown> {
    this.start()
    // A dead runtime cannot answer; fail with process context instead of
    // writing into a destroyed pipe and hanging until the timeout.
    if (this.exitCode !== undefined || this.spawnError !== undefined) {
      await this.settleStreams()
      throw this.closedError('Clocky runtime is not running')
    }
    const transport = this.transport
    /* v8 ignore next -- start() either sets the transport or throws */
    if (transport === undefined) throw new TransportClosedError('Clocky runtime is not running')
    const timeout = timeoutMs ?? this.options.requestTimeoutMs
    try {
      if (timeout === undefined) return await transport.request(method, params ?? {})
      // The abort signal makes the timeout an abandonment: the transport drops
      // its pending entry, so repeated bounded requests against a hung method
      // retain no per-call state (the server-side work still runs to close).
      const abandon = new AbortController()
      const timer = setTimeout(() => {
        abandon.abort(new RequestTimeoutError(`${method} timed out after ${timeout}ms waiting for Clocky runtime`))
      }, timeout)
      try {
        return await transport.request(method, params ?? {}, abandon.signal)
      } finally {
        clearTimeout(timer)
      }
    } catch (error) {
      if (error instanceof JsonRpcResponseError || error instanceof RequestTimeoutError) throw error
      // Transport-level failures gain process context: exit code + stderr tail.
      await this.settleStreams()
      throw this.closedError(errorMessage(error))
    }
  }

  /**
   * Subscribe to server notifications.
   * @param filter - optional predicate; omitted means every notification.
   * @returns the subscription handle; close it to stop delivery. After
   * {@link close} or runtime death the handle is born failed — there is no
   * producer left, so `next()` rejects instead of waiting forever.
   */
  subscribe(filter?: NotificationFilter): NotificationSubscription {
    const id = String(this.subscriptionSerial++)
    const state: SubscriptionState = { queue: [], waiters: [], filter, failure: undefined }
    const subscription = new NotificationSubscriptionImpl(state, () => { this.subscriptions.delete(id) })
    if (this.closeTask !== undefined || this.exitCode !== undefined || this.spawnError !== undefined) {
      subscription.fail(this.closedError('Clocky runtime closed'))
      return subscription
    }
    this.subscriptions.set(id, subscription)
    return subscription
  }

  /**
   * Shut the runtime down and reap it: a best-effort protocol `shutdown`
   * bounded by `shutdownTimeoutMs`, then the shared stdin-EOF → SIGTERM →
   * SIGKILL ladder until the process actually exited. Idempotent.
   * @returns settlement of the complete teardown.
   */
  close(): Promise<void> {
    this.closeTask ??= this.performClose()
    return this.closeTask
  }

  private async performClose(): Promise<void> {
    const child = this.child
    if (child === undefined) return
    try {
      await this.request('shutdown', undefined, this.options.shutdownTimeoutMs ?? 1_000)
    } catch (error) {
      // Diagnostic only: the dispose ladder below is the authoritative teardown
      // for a runtime that cannot answer shutdown anymore.
      this.appendStderr([`shutdown request failed: ${errorMessage(error)}`])
    }
    await disposeRuntimeProcess(child, {
      disposeEofGraceMs: this.options.disposeEofGraceMs ?? 6_000,
      disposeGraceMs: this.options.disposeGraceMs ?? 3_000,
    }, process.platform, this.options.detached === true)
    this.transport?.close()
    this.failSubscriptions(this.closedError('Clocky runtime closed'))
  }

  private dispatchNotification(notification: HarnessNotification): void {
    for (const subscription of this.subscriptions.values()) subscription.push(notification)
  }

  private failSubscriptions(error: Error): void {
    for (const subscription of this.subscriptions.values()) subscription.fail(error)
  }

  private appendStderr(lines: string[]): void {
    const kept = lines.filter(line => line.length > 0)
    this.stderrTail.push(...kept)
    if (this.stderrTail.length > STDERR_TAIL_LIMIT) {
      this.stderrTail.splice(0, this.stderrTail.length - STDERR_TAIL_LIMIT)
    }
  }

  private settleStreams(): Promise<void> {
    return Promise.race([
      this.streamsSettled,
      new Promise<void>((resolve) => { setTimeout(resolve, STREAM_SETTLE_MS) }),
    ])
  }

  private closedError(reason: string): TransportClosedError {
    const parts = [reason]
    if (this.spawnError !== undefined) parts.push(`spawn error: ${this.spawnError.message}`)
    if (this.exitCode !== undefined) parts.push(`exit code: ${String(this.exitCode)}`)
    if (this.stderrTail.length > 0) parts.push(`stderr tail:\n${this.stderrTail.join('\n')}`)
    return new TransportClosedError(parts.join('\n'))
  }
}

/**
 * Whether `value` is a plain JSON object (the wire-boundary shape probe).
 * @param value - the wire value to probe.
 * @returns `true` iff `value` is a non-null, non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse an `activation.status` notification from a raw subscription item.
 * @param notification - one raw server notification.
 * @returns the typed state notification, or `undefined` for another method.
 * @throws {@link SdkProtocolError} when the activation notification is malformed.
 */
export function parseActivationStatusNotification(
  notification: HarnessNotification,
): ActivationStatusNotification | undefined {
  if (notification.method !== 'activation.status') return undefined
  return parseProtocolValue('activation.status notification', activationStatusNotificationSchema, notification.params)
}

/** Structural subset shared by the exported protocol parsers without a client zod dependency. */
interface ProtocolSchema<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } }
}

/** Parse a protocol-owned strict payload and name malformed fields for the SDK caller. */
function parseProtocolValue<T>(label: string, schema: ProtocolSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  const issues = parsed.error.issues
    .map(issue => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
    .join('; ')
  throw new SdkProtocolError(`${label} is invalid: ${issues}`)
}

/** The message of a thrown value (the transport only throws `Error`s; `String` covers the rest). */
function errorMessage(error: unknown): string {
  /* v8 ignore next -- the transport and dispose ladder reject only with Errors */
  return error instanceof Error ? error.message : String(error)
}

/** Replace an initialization credential anywhere an unexpected transport failure reflected it. */
function redactCredentialError(error: unknown, credential: string): Error {
  const redact = credential.length === 0
    ? (value: string): string => value
    : (value: string): string => value.split(credential).join('[REDACTED]')
  if (error instanceof JsonRpcResponseError) {
    return new JsonRpcResponseError(error.code, redact(error.message), redactCredentialValue(error.data, redact))
  }
  if (error instanceof TransportClosedError) return new TransportClosedError(redact(error.message))
  if (error instanceof RequestTimeoutError) return new RequestTimeoutError(redact(error.message))
  if (error instanceof SdkProtocolError) return new SdkProtocolError(redact(error.message))
  if (error instanceof Error) return new Error(redact(error.message))
  return new Error(redact(String(error)))
}

/** Detach JSON-RPC error data while recursively redacting the handshake secret. */
function redactCredentialValue(value: unknown, redact: (value: string) => string): unknown {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(item => redactCredentialValue(item, redact))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactCredentialValue(item, redact)]))
  }
  return value
}

/** Reject a command line that would disclose the initialization credential through process inspection. */
function assertCredentialAbsentFromLaunch(options: HarnessClientOptions, credential: string | undefined): void {
  if (credential === undefined || credential.length === 0) return
  if (options.command.includes(credential) || (options.args ?? []).some(argument => argument.includes(credential))) {
    throw new SdkProtocolError('Clocky runtime command and arguments must not contain the product credential')
  }
}

/** Clone a launch environment after removing every value that contains the initialization credential. */
function scrubCredentialFromLaunchEnvironment(
  environment: NodeJS.ProcessEnv,
  credential: string | undefined,
): NodeJS.ProcessEnv {
  if (credential === undefined || credential.length === 0) return { ...environment }
  return Object.fromEntries(Object.entries(environment)
    .filter(([, value]) => value === undefined || !value.includes(credential)))
}
