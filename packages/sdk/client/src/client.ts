import type { SimulationTasksParams, SimulationTasksResult, SimulationTaskCancelParams, SimulationTaskCancelResult } from '@clocky/clocky-sdk-protocol'
import { simulationTasksParamsSchema, simulationTasksResultSchema, simulationTaskCancelParamsSchema, simulationTaskCancelResultSchema } from '@clocky/clocky-sdk-protocol'
import { simulationRequestsParamsSchema, simulationRequestsResultSchema, simulationRetryRequestParamsSchema, simulationRetryRequestResultSchema, type SimulationRequestsParams, type SimulationRequestsResult, type SimulationRetryRequestParams, type SimulationRetryRequestResult } from '@clocky/clocky-sdk-protocol'
import { simulationPreflightParamsSchema, simulationPreflightResultSchema, type SimulationPreflightParams, type SimulationPreflightResult } from '@clocky/clocky-sdk-protocol'
import { simulationOperationRetryParamsSchema, simulationOperationRetryResultSchema } from '@clocky/clocky-sdk-protocol'
import type { SimulationOperationRetryParams, SimulationOperationRetryResult } from '@clocky/clocky-sdk-protocol'
import { simulationRunStatusesParamsSchema, simulationRunStatusesResultSchema } from '@clocky/clocky-sdk-protocol'
import type { SimulationRunStatusesParams, SimulationRunStatusesResult } from '@clocky/clocky-sdk-protocol'
import { simulationTaskReviewListParamsSchema, simulationTaskReviewListResultSchema, simulationTaskReviewResolveParamsSchema, simulationTaskReviewResolveResultSchema } from '@clocky/clocky-sdk-protocol'
import type { SimulationTaskReviewListParams, SimulationTaskReviewListResult, SimulationTaskReviewResolveParams, SimulationTaskReviewResolveResult } from '@clocky/clocky-sdk-protocol'
import { simulationSourceParamsSchema, simulationSourceResultSchema } from '@clocky/clocky-sdk-protocol'
import type { SimulationSourceParams, SimulationSourceResult } from '@clocky/clocky-sdk-protocol'
import { simulationRecordsParamsSchema, simulationRecordsResultSchema } from '@clocky/clocky-sdk-protocol'
import type { SimulationRecordsParams, SimulationRecordsResult } from '@clocky/clocky-sdk-protocol'
import { simulationWatchParamsSchema, simulationWatchResultSchema } from '@clocky/clocky-sdk-protocol'
import type { SimulationWatchParams, SimulationWatchResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationControlParams, SimulationControlResult, SimulationManageParams, SimulationManageResult, SimulationManagementParams, SimulationManagementResult, SimulationCheckpointParams, SimulationCheckpointResult, SimulationRestoreParams, SimulationRestoreResult, SimulationIngressParams, SimulationIngressResult, SimulationIngressRequestParams, SimulationIngressRequestResult } from '@clocky/clocky-sdk-protocol'
import { simulationControlParamsSchema, simulationControlResultSchema, simulationManageParamsSchema, simulationManageResultSchema, simulationManagementParamsSchema, simulationManagementResultSchema, simulationCheckpointParamsSchema, simulationCheckpointResultSchema, simulationRestoreParamsSchema, simulationRestoreResultSchema, simulationIngressParamsSchema, simulationIngressResultSchema, simulationIngressRequestParamsSchema, simulationIngressRequestResultSchema } from '@clocky/clocky-sdk-protocol'
import { simulationCatalogParamsSchema, simulationCatalogResultSchema, simulationListParamsSchema, simulationListResultSchema, simulationInspectParamsSchema, simulationInspectResultSchema, simulationBrowseParamsSchema, simulationBrowseResultSchema, simulationObjectParamsSchema, simulationObjectResultSchema, simulationCreateParamsSchema, simulationCreateResultSchema, simulationPrepareParamsSchema, simulationPrepareResultSchema, simulationRequestParamsSchema, simulationRequestResultSchema } from '@clocky/clocky-sdk-protocol'
import type { SimulationCatalogParams, SimulationCatalogResult, SimulationListParams, SimulationListResult, SimulationInspectParams, SimulationInspectResult, SimulationBrowseParams, SimulationBrowseResult, SimulationObjectParams, SimulationObjectResult, SimulationCreateParams, SimulationCreateResult, SimulationPrepareParams, SimulationPrepareResult, SimulationRequestParams, SimulationRequestResult } from '@clocky/clocky-sdk-protocol'
import { teamTaskUpdateLookupParamsSchema, teamTaskUpdateLookupResultSchema, type TeamTaskUpdateLookupParams, type TeamTaskUpdateLookupResult } from '@clocky/clocky-sdk-protocol'
import { teamMemberInspectParamsSchema, teamMemberInspectResultSchema, type TeamMemberInspectParams, type TeamMemberInspectResult } from '@clocky/clocky-sdk-protocol'
import type { TeamWorkflowInspectParams } from '@clocky/clocky-sdk-protocol'
import type { TeamWorkflowInspection } from '@clocky/clocky-team'
import { teamWorkflowInspectRequestSchema, teamWorkflowInspectionSchema } from '@clocky/clocky-team/schema'
import type { TeamActionReadParams } from '@clocky/clocky-sdk-protocol'
import type { TeamHumanActionSnapshot } from '@clocky/clocky-team'
import { teamHumanActionReadRequestSchema, teamHumanActionSnapshotSchema } from '@clocky/clocky-team/schema'
import { teamSelectionParamsSchema, type TeamSelectionParams } from '@clocky/clocky-sdk-protocol'
import { teamTaskInspectParamsSchema, teamTaskInspectResultSchema, type TeamTaskInspectParams, type TeamTaskInspectResult } from '@clocky/clocky-sdk-protocol'
import { teamBrowseParamsSchema, teamBrowseResultSchema, type TeamBrowseParams, type TeamBrowseResult } from '@clocky/clocky-sdk-protocol'
import { teamMemberSessionParamsSchema, teamMemberSessionResultSchema, type TeamMemberSessionParams, type TeamMemberSessionResult } from '@clocky/clocky-sdk-protocol'
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
// Explicit protocol imports and public re-exports repeat contract names, not executable behavior.
/* jscpd:ignore-start */
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
  type TeamSelectionResult,
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
  teamSelectionResultSchema,
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
/* jscpd:ignore-end */
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
   * Read current scheduling ownership and preconditions without opening or advancing a run.
   * @param params - Actor-free selection; retain the original identity and payload across uncertain outcomes.
   * @returns validated public observation or original durable receipt; private configuration and input text are withheld.
   */
  async getSimulationControl(params: SimulationControlParams): Promise<SimulationControlResult> {
    const input = parseProtocolValue('simulation/runs-control params', simulationControlParamsSchema, params)
    const result = parseProtocolValue('simulation/runs-control result', simulationControlResultSchema,
      await this.request('simulation/runs-control', input))
    if (result.runId !== input.runId) {
      throw new SdkProtocolError('simulation/runs-control response belongs to a different selection or command')
    }
    return result
  }

  /**
   * Submit an original scheduling intent; exact retries retain its result without undoing later intent.
   * @param params - Actor-free selection; retain the original identity and payload across uncertain outcomes.
   * @returns validated public observation or original durable receipt; private configuration and input text are withheld.
   */
  async manageSimulation(params: SimulationManageParams): Promise<SimulationManageResult> {
    const input = parseProtocolValue('simulation/runs-manage params', simulationManageParamsSchema, params)
    const result = parseProtocolValue('simulation/runs-manage result', simulationManageResultSchema,
      await this.request('simulation/runs-manage', input))
    if (result.runId !== input.runId || result.operation.managementId !== input.managementId || result.operation.phase !== input.phase) {
      throw new SdkProtocolError('simulation/runs-manage response belongs to a different selection or command')
    }
    return result
  }

  /**
   * Query an original scheduling outcome; absence does not establish failure.
   * @param params - Actor-free selection; retain the original identity and payload across uncertain outcomes.
   * @returns validated public observation or original durable receipt; private configuration and input text are withheld.
   */
  async getSimulationManagement(params: SimulationManagementParams): Promise<SimulationManagementResult> {
    const input = parseProtocolValue('simulation/management-get params', simulationManagementParamsSchema, params)
    const result = parseProtocolValue('simulation/management-get result', simulationManagementResultSchema,
      await this.request('simulation/management-get', input))
    if (result.runId !== input.runId || result.managementId !== input.managementId) {
      throw new SdkProtocolError('simulation/management-get response belongs to a different selection or command')
    }
    return result
  }

  /**
   * Read a bounded set of canonical tasks without creating an execution owner.
   * @param params - Owned run and exact bounded canonical observation.
   * @returns run-owned task metadata without task bodies or general Team authority.
   */
  async listSimulationTasks(params: SimulationTasksParams): Promise<SimulationTasksResult> {
    const input = parseProtocolValue('simulation/tasks-list params', simulationTasksParamsSchema, params)
    const result = parseProtocolValue('simulation/tasks-list result', simulationTasksResultSchema,
      await this.request('simulation/tasks-list', input))
    if (result.runId !== input.runId || input.expectedRevision !== undefined && result.snapshotRevision !== input.expectedRevision
      || input.limit !== undefined && result.items.length > input.limit) throw new SdkProtocolError('Simulation task page belongs to another selection')
    return result
  }

  /**
   * Submit or retry one original cancellation without general Team authority or inference.
   * @param params - Source operation, current task revision and exact attempt or explicit no-lease fence.
   * @returns original persistent receipt; requests-get reconciles response loss using the same command.
   */
  async cancelSimulationTask(params: SimulationTaskCancelParams): Promise<SimulationTaskCancelResult> {
    const input = parseProtocolValue('simulation/tasks-cancel params', simulationTaskCancelParamsSchema, params)
    const result = parseProtocolValue('simulation/tasks-cancel result', simulationTaskCancelResultSchema,
      await this.request('simulation/tasks-cancel', input))
    if (result.runId !== input.runId || result.commandId !== input.commandId || result.kind !== 'cancel-task') {
      throw new SdkProtocolError('Simulation cancellation receipt belongs to another original command')
    }
    return result
  }

  /**
   * Read exact bounded run-owned review metadata without task bodies.
   * @param params - Exact run, page and optional canonical revision.
   * @returns current scene-authorized review targets.
   */
  async listSimulationTaskReviews(params: SimulationTaskReviewListParams): Promise<SimulationTaskReviewListResult> {
    const input = parseProtocolValue('simulation/task-reviews-list params', simulationTaskReviewListParamsSchema, params)
    const result = parseProtocolValue('simulation/task-reviews-list result', simulationTaskReviewListResultSchema,
      await this.request('simulation/task-reviews-list', input))
    if (result.runId !== input.runId || input.expectedRevision !== undefined && result.snapshotRevision !== input.expectedRevision
      || input.limit !== undefined && result.items.length > input.limit) throw new SdkProtocolError('Simulation review page belongs to another selection')
    return result
  }

  /**
   * Submit or retry one original scene-authorized review while preserving its command identity.
   * @param params - Original immutable scene review command, completed attempt and canonical revision.
   * @returns original persistent receipt; requests-get reconciles response loss without allocating another command.
   */
  async resolveSimulationTaskReview(params: SimulationTaskReviewResolveParams): Promise<SimulationTaskReviewResolveResult> {
    const input = parseProtocolValue('simulation/task-reviews-resolve params', simulationTaskReviewResolveParamsSchema, params)
    const result = parseProtocolValue('simulation/task-reviews-resolve result', simulationTaskReviewResolveResultSchema,
      await this.request('simulation/task-reviews-resolve', input))
    if (result.runId !== input.runId || result.commandId !== input.commandId || result.kind !== 'review') {
      throw new SdkProtocolError('Simulation review receipt belongs to another original command')
    }
    return result
  }

  /**
   * Request a full checkpoint; accepted work outlives its waiter and remains paused after completion.
   * @param params - Actor-free selection; retain the original identity and payload across uncertain outcomes.
   * @returns validated public observation or original durable receipt; private configuration and input text are withheld.
   */
  async checkpointSimulation(params: SimulationCheckpointParams): Promise<SimulationCheckpointResult> {
    const input = parseProtocolValue('simulation/runs-checkpoint params', simulationCheckpointParamsSchema, params)
    const result = parseProtocolValue('simulation/runs-checkpoint result', simulationCheckpointResultSchema,
      await this.request('simulation/runs-checkpoint', input))
    if (result.runId !== input.runId || result.commandId !== input.commandId || result.kind !== 'checkpoint') {
      throw new SdkProtocolError('simulation/runs-checkpoint response belongs to a different selection or command')
    }
    return result
  }

  /**
   * Verify checkpoint history and current suffix, then acquire a paused owner without rollback or inference.
   * @param params - Actor-free selection; retain the original identity and payload across uncertain outcomes.
   * @returns validated public observation or original durable receipt; private configuration and input text are withheld.
   */
  async restoreSimulation(params: SimulationRestoreParams): Promise<SimulationRestoreResult> {
    const input = parseProtocolValue('simulation/runs-restore params', simulationRestoreParamsSchema, params)
    const result = parseProtocolValue('simulation/runs-restore result', simulationRestoreResultSchema,
      await this.request('simulation/runs-restore', input))
    if (result.runId !== input.runId || result.commandId !== input.commandId
      || result.kind !== 'restore' || result.checkpointId !== input.checkpointId) {
      throw new SdkProtocolError('simulation/runs-restore response belongs to a different selection or command')
    }
    return result
  }

  /**
   * Submit one attributed entity input with its original identity and exact simulated time.
   * @param params - Actor-free selection; retain the original identity and payload across uncertain outcomes.
   * @returns validated public observation or original durable receipt; private configuration and input text are withheld.
   */
  async ingressSimulation(params: SimulationIngressParams): Promise<SimulationIngressResult> {
    const input = parseProtocolValue('simulation/runs-ingress params', simulationIngressParamsSchema, params)
    const result = parseProtocolValue('simulation/runs-ingress result', simulationIngressResultSchema,
      await this.request('simulation/runs-ingress', input))
    if (result.runId !== input.runId || result.ingressId !== input.ingressId
      || result.entityId !== input.entityId || result.availableAt !== input.availableAt) {
      throw new SdkProtocolError('simulation/runs-ingress response belongs to a different selection or command')
    }
    return result
  }

  /**
   * Query original input assignment and consumption independently of scheduling.
   * @param params - Actor-free selection; retain the original identity and payload across uncertain outcomes.
   * @returns validated public observation or original durable receipt; private configuration and input text are withheld.
   */
  async getSimulationIngress(params: SimulationIngressRequestParams): Promise<SimulationIngressRequestResult> {
    const input = parseProtocolValue('simulation/ingress-get params', simulationIngressRequestParamsSchema, params)
    const result = parseProtocolValue('simulation/ingress-get result', simulationIngressRequestResultSchema,
      await this.request('simulation/ingress-get', input))
    if (result.runId !== input.runId || result.ingressId !== input.ingressId) {
      throw new SdkProtocolError('simulation/ingress-get response belongs to a different selection or command')
    }
    return result
  }

  /**
   * Read authorized Simulation metadata without executing models.
   * @param params - Actor-free selection; command IDs must be retained across uncertain outcomes.
   * @returns validated bounded public result; private run configuration and knowledge are withheld.
   */
  async simulationCatalog(params: SimulationCatalogParams = {}): Promise<SimulationCatalogResult> {
    const input = parseProtocolValue('simulation/catalog params', simulationCatalogParamsSchema, params)
    const result = parseProtocolValue('simulation/catalog result', simulationCatalogResultSchema,
      await this.request('simulation/catalog', input))
    return result
  }

  /**
   * Grant a bounded retry allowance for the original unknown intent without publishing or resuming it.
   * @param params - Original command, unknown operation, exact retained attempt count and reason.
   * @returns persistent original grant receipt; explicit scheduling is required to reconcile the target.
   */
  async retrySimulationOperation(params: SimulationOperationRetryParams): Promise<SimulationOperationRetryResult> {
    const input = parseProtocolValue('simulation/operation-retry params', simulationOperationRetryParamsSchema, params)
    const result = parseProtocolValue('simulation/operation-retry result', simulationOperationRetryResultSchema,
      await this.request('simulation/operation-retry', input))
    if (result.runId !== input.runId || result.commandId !== input.commandId || result.kind !== 'retry-operation') {
      throw new SdkProtocolError('Simulation operation retry response belongs to another original command')
    }
    return result
  }

  /**
   * Observe exact registered runs with independent failure and scheduling states.
   * @param params - Exact bounded registered run batch; every identity is authorized before provider IO.
   * @returns independent native metrics and Host scheduling observations without opening execution.
   */
  async getSimulationRunStatuses(params: SimulationRunStatusesParams): Promise<SimulationRunStatusesResult> {
    const input = parseProtocolValue('simulation/runs-statuses params', simulationRunStatusesParamsSchema, params)
    const result = parseProtocolValue('simulation/runs-statuses result', simulationRunStatusesResultSchema,
      await this.request('simulation/runs-statuses', input))
    if (result.items.length !== input.runIds.length || result.items.some((item, index) => item.run.id !== input.runIds[index])) {
      throw new SdkProtocolError('Simulation status response belongs to another exact run batch')
    }
    return result
  }

  /**
   * Read authorized Simulation metadata without executing models.
   * @param params - Actor-free selection; command IDs must be retained across uncertain outcomes.
   * @returns validated bounded public result; private run configuration and knowledge are withheld.
   */
  async listSimulations(params: SimulationListParams = {}): Promise<SimulationListResult> {
    const input = parseProtocolValue('simulation/runs-list params', simulationListParamsSchema, params)
    const result = parseProtocolValue('simulation/runs-list result', simulationListResultSchema,
      await this.request('simulation/runs-list', input))
    return result
  }

  /**
   * Read authorized Simulation metadata without executing models.
   * @param params - Actor-free selection; command IDs must be retained across uncertain outcomes.
   * @returns validated bounded public result; private run configuration and knowledge are withheld.
   */
  async inspectSimulation(params: SimulationInspectParams): Promise<SimulationInspectResult> {
    const input = parseProtocolValue('simulation/runs-inspect params', simulationInspectParamsSchema, params)
    const result = parseProtocolValue('simulation/runs-inspect result', simulationInspectResultSchema,
      await this.request('simulation/runs-inspect', input))
    if (result.run.id !== input.runId) {
      throw new SdkProtocolError('simulation/runs-inspect response belongs to a different selection or command')
    }
    return result
  }

  /**
   * Read authorized Simulation metadata without executing models.
   * @param params - Actor-free selection; command IDs must be retained across uncertain outcomes.
   * @returns validated bounded public result; private run configuration and knowledge are withheld.
   */
  async browseSimulation(params: SimulationBrowseParams): Promise<SimulationBrowseResult> {
    const input = parseProtocolValue('simulation/collections-list params', simulationBrowseParamsSchema, params)
    const result = parseProtocolValue('simulation/collections-list result', simulationBrowseResultSchema,
      await this.request('simulation/collections-list', input))
    if (result.runId !== input.runId || result.collection !== input.collection) {
      throw new SdkProtocolError('simulation/collections-list response belongs to a different selection or command')
    }
    return result
  }

  /**
   * Inspect one exact retained Team Envelope source without activating execution.
   * @param params - Decision source ordinal and bounded lookup/body continuation.
   * @returns separately authorized text, redacted status or explicit lookup continuation.
   */
  async inspectSimulationSource(params: SimulationSourceParams): Promise<SimulationSourceResult> {
    const input = parseProtocolValue('simulation/sources-inspect params', simulationSourceParamsSchema, params)
    const result = parseProtocolValue('simulation/sources-inspect result', simulationSourceResultSchema,
      await this.request('simulation/sources-inspect', input))
    if (result.runId !== input.runId || result.decisionId !== input.decisionId || result.sourceIndex !== input.sourceIndex
      || input.expectedRevision !== undefined && result.snapshotRevision !== input.expectedRevision
      || input.envelopeSequence !== undefined && result.envelope !== undefined && result.envelope.sequence !== input.envelopeSequence
      || input.limit !== undefined && result.items.length > input.limit) throw new SdkProtocolError('Simulation source response does not match its selection')
    return result
  }

  /**
   * Read retained Simulation journal metadata or separately authorized original JSON text.
   * @param params - Exact run/filter/mode with optional revision and continuation.
   * @returns validated bounded policy-tagged page; does not open execution or infer historical events.
   */
  async readSimulationRecords(params: SimulationRecordsParams): Promise<SimulationRecordsResult> {
    const input = parseProtocolValue('simulation/records-list params', simulationRecordsParamsSchema, params)
    const result = parseProtocolValue('simulation/records-list result', simulationRecordsResultSchema,
      await this.request('simulation/records-list', input))
    if (result.runId !== input.runId || result.mode !== input.mode || result.selection.kind !== input.kind
      || result.selection.sequence !== input.sequence
      || input.expectedRevision !== undefined && result.snapshotRevision !== input.expectedRevision
      || input.sequence !== undefined && result.items.some(item => item.sequence !== input.sequence)
      || input.limit !== undefined && result.items.length > input.limit) {
      throw new SdkProtocolError('simulation/records-list response belongs to a different selection or exceeds its page')
    }
    return result
  }

  /**
   * Observe bounded read invalidation without opening or driving a run.
   * @param params - Exact run and optional prior cursor/real wait. Zero is an immediate probe.
   * @returns metadata-only hint; callers decide whether to repeat the wait or refresh pages.
   */
  async watchSimulation(params: SimulationWatchParams): Promise<SimulationWatchResult> {
    const input = parseProtocolValue('simulation/changes-watch params', simulationWatchParamsSchema, params)
    const result = parseProtocolValue('simulation/changes-watch result', simulationWatchResultSchema,
      await this.request('simulation/changes-watch', input))
    if (result.runId !== input.runId) throw new SdkProtocolError('simulation/changes-watch response belongs to a different run')
    return result
  }

  /**
   * Read authorized Simulation metadata without executing models.
   * @param params - Actor-free selection; command IDs must be retained across uncertain outcomes.
   * @returns validated bounded public result; private run configuration and knowledge are withheld.
   */
  async inspectSimulationObject(params: SimulationObjectParams): Promise<SimulationObjectResult> {
    const input = parseProtocolValue('simulation/objects-inspect params', simulationObjectParamsSchema, params)
    const result = parseProtocolValue('simulation/objects-inspect result', simulationObjectResultSchema,
      await this.request('simulation/objects-inspect', input))
    const selectedReference = result.selection.collection === 'decisions' ? result.selection.reference : undefined
    if (result.runId !== input.runId || result.selection.collection !== input.collection
      || result.selection.id !== input.id || result.selection.section !== input.section
      || input.collection === 'decisions' && input.section === 'knowledge' && (selectedReference?.id !== input.reference?.id
        || selectedReference?.revision !== input.reference?.revision)
      || input.expectedRevision !== undefined && result.snapshotRevision !== input.expectedRevision) {
      throw new SdkProtocolError('simulation/objects-inspect response belongs to a different selection or command')
    }
    return result
  }

  /**
   * Validate creation semantics without allocating a run, Team, actor or command.
   * @param params - Allowlisted template draft and optional run allowances.
   * @returns current resolved configuration or safe field issues; no resources are reserved.
   */
  async preflightSimulation(params: SimulationPreflightParams): Promise<SimulationPreflightResult> {
    const input = parseProtocolValue('simulation/runs-preflight params', simulationPreflightParamsSchema, params)
    return parseProtocolValue('simulation/runs-preflight result', simulationPreflightResultSchema,
      await this.request('simulation/runs-preflight', input))
  }

  /**
   * Allocate and prepare a run with the retained original command identity.
   * @param params - Exact original allowlisted creation payload.
   * @returns immutable creation receipt without starting inference.
   */
  async createSimulation(params: SimulationCreateParams): Promise<SimulationCreateResult> {
    const input = parseProtocolValue('simulation/runs-create params', simulationCreateParamsSchema, params)
    const result = parseProtocolValue('simulation/runs-create result', simulationCreateResultSchema,
      await this.request('simulation/runs-create', input))
    if (result.commandId !== input.commandId || result.kind !== 'create') {
      throw new SdkProtocolError('simulation/runs-create response belongs to a different selection or command')
    }
    return result
  }

  /**
   * Submit or query an original durable preparation request without starting inference.
   * @param params - Actor-free selection; command IDs must be retained across uncertain outcomes.
   * @returns original durable receipt; absence does not establish failure.
   */
  async prepareSimulation(params: SimulationPrepareParams): Promise<SimulationPrepareResult> {
    const input = parseProtocolValue('simulation/runs-prepare params', simulationPrepareParamsSchema, params)
    const result = parseProtocolValue('simulation/runs-prepare result', simulationPrepareResultSchema,
      await this.request('simulation/runs-prepare', input))
    if (result.commandId !== input.commandId || result.kind !== 'prepare' || result.runId !== input.runId) {
      throw new SdkProtocolError('simulation/runs-prepare response belongs to a different selection or command')
    }
    return result
  }

  /**
   * Discover original administrative receipts for one authorized run without exposing command inputs.
   * @param params - Exact run and optional revision-pinned bounded page.
   * @returns metadata-only page; reads neither schedule inference nor retry any command.
   */
  async listSimulationRequests(params: SimulationRequestsParams): Promise<SimulationRequestsResult> {
    const input = parseProtocolValue('simulation/requests-list params', simulationRequestsParamsSchema, params)
    const result = parseProtocolValue('simulation/requests-list result', simulationRequestsResultSchema,
      await this.request('simulation/requests-list', input))
    if (result.runId !== input.runId || result.items.some(item => item.runId !== input.runId)
      || input.expectedRevision !== undefined && result.snapshotRevision !== input.expectedRevision
      || input.limit !== undefined && result.items.length > input.limit) {
      throw new SdkProtocolError('simulation/requests-list response belongs to a different selection or exceeds its page')
    }
    return result
  }

  /**
   * Retry the exact server-retained original command without replacing its payload or allocating another identity.
   * @param params - Exact run and original command metadata discovered from the request list.
   * @returns original accepted or terminal receipt; no automatic retry is scheduled by the client.
   */
  async retrySimulationRequest(params: SimulationRetryRequestParams): Promise<SimulationRetryRequestResult> {
    const input = parseProtocolValue('simulation/requests-retry params', simulationRetryRequestParamsSchema, params)
    const result = parseProtocolValue('simulation/requests-retry result', simulationRetryRequestResultSchema,
      await this.request('simulation/requests-retry', input))
    if (result.runId !== input.runId || result.commandId !== input.commandId) {
      throw new SdkProtocolError('simulation/requests-retry response belongs to a different original request')
    }
    return result
  }

  /**
   * Query the exact original durable administrative command; absence does not establish failure.
   * @param params - Original retained command identity.
   * @returns known original request or non-authoritative absence without scheduling work.
   */
  async getSimulationRequest(params: SimulationRequestParams): Promise<SimulationRequestResult> {
    const input = parseProtocolValue('simulation/requests-get params', simulationRequestParamsSchema, params)
    const result = parseProtocolValue('simulation/requests-get result', simulationRequestResultSchema,
      await this.request('simulation/requests-get', input))
    if ((result.status === 'found' ? result.request.commandId : result.commandId) !== input.commandId) {
      throw new SdkProtocolError('simulation/requests-get response belongs to a different selection or command')
    }
    return result
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

  /** Resolve the latest published Session of a retained member without activating it.
   * @param params - exact owning Team and member.
   * @returns validated published binding.
   */
  async getTeamMemberSession(params: TeamMemberSessionParams): Promise<TeamMemberSessionResult> {
    const parsed = parseProtocolValue('team/member-session params', teamMemberSessionParamsSchema, params)
    const result = parseProtocolValue('team/member-session result', teamMemberSessionResultSchema,
      await this.request('team/member-session', parsed))
    if (result.binding.activation.teamId !== parsed.teamId || result.binding.activation.participantId !== parsed.participantId) {
      throw new SdkProtocolError('team/member-session response belongs to a different Team or participant')
    }
    return result
  }

  /** Read current task fields or one revision-pinned history page without private artifact references.
   * @param params - Exact Team/task, section, optional revision and history continuation.
   * @returns the validated bounded task inspection.
   */
  async inspectTeamTask(params: TeamTaskInspectParams): Promise<TeamTaskInspectResult> {
    const parsed = parseProtocolValue('team/task-inspect params', teamTaskInspectParamsSchema, params)
    const result = parseProtocolValue('team/task-inspect result', teamTaskInspectResultSchema, await this.request('team/task-inspect', parsed))
    const value = result.inspection
    if (value.teamId !== parsed.teamId || value.taskId !== parsed.taskId || value.section !== parsed.section
      || parsed.expectedRevision !== undefined && value.revision !== parsed.expectedRevision
      || value.section !== 'record' && parsed.section !== 'record' && value.startCursor !== (parsed.afterCursor ?? -1)) {
      throw new SdkProtocolError('team/task-inspect response does not match its task selection')
    }
    return result
  }

  /** Read bounded collection summaries.
   * @param params - Collection selection.
   * @returns the matching page.
   */
  async browseTeam(params: TeamBrowseParams): Promise<TeamBrowseResult> {
    const parsed = parseProtocolValue('team/browse params', teamBrowseParamsSchema, params)
    const result = parseProtocolValue('team/browse result', teamBrowseResultSchema, await this.request('team/browse', parsed))
    if (result.page.teamId !== parsed.teamId || result.page.kind !== parsed.kind) {
      throw new SdkProtocolError('team/browse response belongs to a different Team or collection')
    }
    if (parsed.query !== undefined && (result.page.kind !== 'tasks' || result.page.query?.search !== parsed.query.search
      || result.page.query.phase !== parsed.query.phase || result.page.query.excludeTaskId !== parsed.query.excludeTaskId)) {
      throw new SdkProtocolError('team/browse response belongs to a different task query')
    }
    return result
  }

  /** Read a revision-pinned workflow task/dependency page.
   * @param params - Exact workflow and window.
   * @returns bounded inspection data with matching ownership and revision.
   */
  async inspectWorkflowPlan(params: TeamWorkflowInspectParams): Promise<TeamWorkflowInspection> {
    const input = parseProtocolValue('team/workflow-plan-inspect params', teamWorkflowInspectRequestSchema, params)
    const value = parseProtocolValue('team/workflow-plan-inspect result', teamWorkflowInspectionSchema,
      await this.request('team/workflow-plan-inspect', input))
    if (value.record.teamId !== input.teamId || value.record.id !== input.planId || value.startCursor !== (input.afterCursor ?? -1)
      || input.expectedRevision !== undefined && value.record.revision !== input.expectedRevision) {
      throw new SdkProtocolError('Workflow inspection response does not match its selection')
    }
    return value
  }

  /** Read one bounded current human action.
   * @param params - Team and action identity.
   * @returns current action with matching scope.
   */
  async readTeamAction(params: TeamActionReadParams): Promise<TeamHumanActionSnapshot> {
    const input = parseProtocolValue('team/action-read params', teamHumanActionReadRequestSchema, params)
    const action = parseProtocolValue('team/action-read result', teamHumanActionSnapshotSchema, await this.request('team/action-read', input))
    if (action.teamId !== input.teamId || action.id !== input.actionId) throw new SdkProtocolError('Action response does not match its selection')
    return action
  }

  /** Read member metadata and one capability window without activating the member.
   * @param params - exact member and optional cursor-pinned continuation.
   * @returns validated detail for the requested member.
   */
  async inspectTeamMember(params: TeamMemberInspectParams): Promise<TeamMemberInspectResult> {
    const input = parseProtocolValue('team/member-inspect params', teamMemberInspectParamsSchema, params)
    const result = parseProtocolValue('team/member-inspect result', teamMemberInspectResultSchema,
      await this.request('team/member-inspect', input))
    const detail = result.detail
    if (detail.record.teamId !== input.teamId || detail.record.id !== input.participantId
      || detail.startCursor !== (input.afterCursor ?? -1)
      || input.expectedTeamCursor !== undefined && detail.teamCursor !== input.expectedTeamCursor) {
      throw new SdkProtocolError('Member inspection belongs to another member or capability window')
    }
    return result
  }

  /** Read bounded Team selection data without activating an Agent.
   * @param params - Team identity to inspect.
   * @returns validated selection projection.
   */
  async getTeamSelection(params: TeamSelectionParams): Promise<TeamSelectionResult> {
    const parsed = parseProtocolValue('team/selection params', teamSelectionParamsSchema, params)
    const result = await this.request('team/selection', parsed)
    return parseProtocolValue('team/selection result', teamSelectionResultSchema, result)
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

  /** Query the original admission without resending its update.
   * @param params - Team, task and original command identity.
   * @returns immutable applied metadata or absence at this authorized read.
   */
  async getTeamTaskUpdateResult(params: TeamTaskUpdateLookupParams): Promise<TeamTaskUpdateLookupResult> {
    const parsed = parseProtocolValue('team/task-update-result params', teamTaskUpdateLookupParamsSchema, params)
    const result = parseProtocolValue('team/task-update-result result', teamTaskUpdateLookupResultSchema,
      await this.request('team/task-update-result', parsed))
    let identity: typeof parsed
    switch (result.kind) {
      case 'applied': identity = result.receipt; break
      case 'rejected': identity = result.rejection; break
      case 'not-found': identity = result; break
      /* v8 ignore next 2 -- The protocol lookup parser accepts only these three outcome tags. */
      default: return assertNever(result)
    }
    if (identity.teamId !== parsed.teamId || identity.taskId !== parsed.taskId || identity.commandId !== parsed.commandId) {
      throw new SdkProtocolError('Task update lookup does not match its original command identity')
    }
    return result
  }

  /**
   * Update one Team task through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns original acceptance metadata and current task state, which may have advanced since admission.
   */
  async updateTeamTask(params: TeamTaskUpdateParams): Promise<TeamTaskUpdateResult> {
    const parsed = parseProtocolValue('team/task-update params', teamTaskUpdateParamsSchema, params)
    const result = await this.request('team/task-update', parsed)
    const response = parseProtocolValue('team/task-update result', teamTaskUpdateResultSchema, result)
    const receipt = response.value.receipt
    if (receipt.teamId !== parsed.teamId || receipt.taskId !== parsed.taskId || receipt.commandId !== parsed.commandId
      || receipt.expectedRevision !== parsed.expectedRevision) {
      throw new SdkProtocolError('Task update receipt does not match its original command identity')
    }
    return response
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

/** Reject an unhandled future original-update outcome without exposing its body. */
/* v8 ignore next -- Parsed original-update outcomes have exactly three closed tags. */
function assertNever(value: never): never { void value; throw new SdkProtocolError('Unhandled task update outcome') }
