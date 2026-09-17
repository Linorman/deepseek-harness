/**
 * Exact Team Link delivery consumer plus local durable-binding discovery
 * wrapper. It admits direct and task-assignment input without importing a
 * Hub implementation or AgentLoop internals.
 * @module @clocky/clocky-team-agent-client
 */

import { FiberState, type Context } from '@clocky/cordis'
import { isDeepStrictEqual } from 'node:util'
import z from '@clocky/schemastery'
import {
  openAgentWorkspaceLease,
  resolveAgentWorkspaceRoot,
} from '@clocky/clocky-agent'
import type { Agent, AgentCancelCause, AgentWorkspaceLease, PreStepDecision } from '@clocky/clocky-agent'
import { freezeMessage, MessageId } from '@clocky/clocky-llm'
import type { UserMessage } from '@clocky/clocky-llm'
import { TeamLinkConnectionError, TeamLinkError } from '@clocky/clocky-team-link'
import type {
  TeamLink,
  TeamLinkBoundLinkBorrower,
  TeamLinkInterruptNotification,
  TeamLinkTaskCancellationNotification,
  TeamLinkInvitationNotification,
  TeamLinkTerminationReason,
} from '@clocky/clocky-team-link'
import {
  directChannelAdapter,
  directChannelV2Adapter,
  directChannelV3Adapter,
  directChannelV4Adapter,
  DIRECT_CHANNEL_ADAPTER_V1,
  DIRECT_CHANNEL_ADAPTER_V2,
  DIRECT_CHANNEL_ADAPTER_V3,
  DIRECT_CHANNEL_ADAPTER_V4,
  DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND,
  parseDirectChannelV2Manifest,
  parseDirectChannelV3Manifest,
  parseDirectChannelV3MessagePayload,
  directChannelV4Recipients,
  parseDirectChannelV4MessagePayload,
} from '@clocky/clocky-team-channel-direct'
import {
  parseTaskAssignmentEnvelope,
  parseTaskAssignmentChannelManifest,
  TASK_ASSIGNMENT_CHANNEL_TYPE,
  TASK_ASSIGNMENT_CHANNEL_VERSION,
} from '@clocky/clocky-team-channel-task-assignment'
import type { TaskAssignmentEnvelope } from '@clocky/clocky-team-channel-task-assignment'
import type {
  TeamWorkspaceAllocation,
  TeamWorkspaceAllocationMetadata,
  TeamWorkspaceOwnerPublicationRequest,
  TeamWorkspacePublishResult,
  TeamWorkspacePreparation,
  TeamWorkspacePrepareRequest,
  TeamWorkspaceRegistry,
} from '@clocky/clocky-team-workspace'
import { TeamWorkspaceLostError } from '@clocky/clocky-team-workspace'
import type {} from '@clocky/clocky-team-artifact'
import type { TeamWorkspaceLoss } from '@clocky/clocky-team'
import {
  channelInvitationIdempotencyKeySchema,
  fingerprintChannelManifest,
  TeamError,
  participantIdSchema,
  teamUsageSampleIdSchema,
  teamIdSchema,
} from '@clocky/clocky-team'
import type { SessionEvent, TeamChannelViewEventData, TeamChannelViewMessageSource } from '@clocky/clocky-session'
import type {
  ActivationBindingSnapshot,
  ActivationActorProofIssuer,
  ActivationId,
  ChannelDeliveryClaim,
  ChannelSnapshot,
  EnvelopeId,
  ParticipantId,
  ParticipantSnapshot,
  TeamEnvelope,
  TeamId,
  TeamStateSnapshot,
  TeamReviewAssignmentSource,
  TeamTaskAssignmentSource,
  TaskAttemptFailure,
  TaskLeaseSnapshot,
  TeamTaskSnapshot,
  TeamActorProofLease,
  TeamRuntime,
  TeamSystemWorkspaceAllocationProof,
  TeamSystemWorkspaceAllocationProofSource,
  TeamSystemWorkspaceAllocationScope,
  TeamUsageSampleInput,
  TeamWorkspaceAllocationSnapshot,
} from '@clocky/clocky-team'

/** Cordis plugin name. */
export const name = 'team-agent-client'
/** Team, Team Link, Agent, and Session services must exist before local delivery starts. */
export const inject = ['teams', 'teamLinks', 'agents', 'sessions']

const DEFAULT_LINK_PROVIDER = 'local'
const DEFAULT_DISPOSAL_TIMEOUT_MS = 5_000
const DEFAULT_RECONNECT_DELAY_MS = 100
const DEFAULT_WORKSPACE_MUTATION_MAX_ATTEMPTS = 3
const DEFAULT_TASK_OUTPUT_CONTINUATIONS = 3
const DEFAULT_TASK_REPORT_REMINDERS = 1
const DEFAULT_TASK_HANDOFF_BYTES = 16_384
const DIRECT_CHANNEL_V1_KEY = adapterKey(DIRECT_CHANNEL_ADAPTER_V1)
const DIRECT_CHANNEL_V2_KEY = adapterKey(DIRECT_CHANNEL_ADAPTER_V2)
const DIRECT_CHANNEL_V3_KEY = adapterKey(DIRECT_CHANNEL_ADAPTER_V3)
const DIRECT_CHANNEL_V4_KEY = adapterKey(DIRECT_CHANNEL_ADAPTER_V4)

/** Team Link delivery configuration. */
export interface Config {
  /** Team Link provider that carries direct and task-assignment notifications and receipts. */
  readonly linkProvider?: string
  /** Maximum milliseconds allowed to settle accepted delivery before the consumer closes. */
  readonly disposalTimeoutMs?: number
  /** Delay before reconnecting a still-current binding after its Link fails or closes unexpectedly. */
  readonly reconnectDelayMs?: number
  /** Maximum attempts for one workspace mutation when concurrent Team writes advance its cursor. */
  readonly workspaceMutationMaxAttempts?: number
  /** Whether task assignment delivery should consume the selected workspace allocation. */
  readonly consumeWorkspace?: boolean
  /** Maximum automatic continuation turns after a worker reaches the model output limit. */
  readonly maxTaskOutputContinuations?: number
  /** Maximum reminders after a worker ends normally without reporting its running attempt; zero disables this recovery. */
  readonly maxTaskReportReminders?: number
  /** Maximum UTF-8 bytes of prior-attempt evidence appended to a new assignment, including truncation notice. */
  readonly maxTaskHandoffBytes?: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  linkProvider: z.string().default(DEFAULT_LINK_PROVIDER),
  disposalTimeoutMs: z.number().step(1).min(1).default(DEFAULT_DISPOSAL_TIMEOUT_MS),
  reconnectDelayMs: z.number().step(1).min(1).default(DEFAULT_RECONNECT_DELAY_MS),
  workspaceMutationMaxAttempts: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_WORKSPACE_MUTATION_MAX_ATTEMPTS),
  consumeWorkspace: z.boolean().default(false),
  maxTaskHandoffBytes: z.number().step(1).min(128).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_TASK_HANDOFF_BYTES),
  maxTaskReportReminders: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_TASK_REPORT_REMINDERS),
  maxTaskOutputContinuations: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_TASK_OUTPUT_CONTINUATIONS),
})

/** Exact Agent and durable activation binding owned by one Link-delivery consumer. */
export interface FixedBindingTeamAgentLinkDeliveryRequest {
  /** Live local Agent that receives claimed Team input. */
  readonly agent: Agent
  /** Immutable Team binding used for every Link operation. */
  readonly binding: ActivationBindingSnapshot
  /** Optional owner callback for a Hub-originated cooperative Link termination. */
  readonly onTerminate?: (reason: TeamLinkTerminationReason) => Promise<void>
}

/** Durable provenance retained on a direct Envelope-derived inbox message. */
export interface TeamEnvelopeSource {
  /** Distinguishes Team channel delivery from user and plugin input. */
  readonly kind: 'team-envelope'
  /** Team that owns the source channel. */
  readonly teamId: TeamId
  /** Channel that accepted the Envelope. */
  readonly channelId: TeamEnvelope['channelId']
  /** Stable Hub-stamped Envelope identity. */
  readonly envelopeId: EnvelopeId
  /** Authenticated participant that posted the Envelope. */
  readonly senderId: ParticipantId
  /** Durable delivery intent that selected the Agent inbox operation. */
  readonly delivery: TeamEnvelope['delivery']
  /** Triggering Envelope for replies or handoffs, when present. */
  readonly causationId?: EnvelopeId
}

declare module '@clocky/clocky-llm' {
  interface MessageSourceMap {
    'team-envelope': TeamEnvelopeSource
    'team-review-assignment': TeamReviewAssignmentSource
  }
}

interface Binding {
  readonly agent: Agent
  readonly teamId: TeamId
  readonly participantId: ParticipantId
  /** Durable epoch that authorized this Agent's local channel delivery. */
  readonly activationId: ActivationId
  /** Exact local Session matched against the durable activation binding. */
  readonly sessionId: Agent['session']['id']
  /** Durable activation snapshot passed unchanged to the selected Team Link provider. */
  readonly durableBinding: ActivationBindingSnapshot
  /** Endpoint owner callback invoked before acknowledging a Hub termination request. */
  readonly onTerminate?: (reason: TeamLinkTerminationReason) => Promise<void>
}

interface ResolvedConfig {
  readonly linkProvider: string
  readonly disposalTimeoutMs: number
  readonly reconnectDelayMs: number
  readonly workspaceMutationMaxAttempts: number
  readonly consumeWorkspace: boolean
  readonly maxTaskReportReminders: number
  readonly maxTaskOutputContinuations: number
  readonly maxTaskHandoffBytes: number
}

/** One Client-owned Link lifetime for a still-current local Agent binding. */
interface LinkConnection {
  /** Removes endpoint invitation reception before its Link closes. */
  unsubscribeInvitation?: (() => void) | undefined
  /** Local binding whose exact durable snapshot authenticated this Link. */
  readonly binding: Binding
  /** Cancels a connection that has not yet published its Link. */
  readonly controller: AbortController
  /** Resolves when the binding is superseded, departs, or the Client closes. */
  readonly released: Promise<void>
  /** Signal the Link lifetime to unsubscribe and close. */
  readonly release: () => void
  /** Published Link, if connection completed before release. */
  link?: TeamLink
  /** Removes this Client's notification subscriber before Link closure. */
  unsubscribe: (() => void) | undefined
  /** Removes this Client's soft-interrupt subscriber before Link closure. */
  unsubscribeInterrupt: (() => void) | undefined
  /** Removes the exact-task cancellation subscriber before Link closure. */
  unsubscribeTaskCancellation: (() => void) | undefined
  /** Prevents stale connection work from admitting another Envelope. */
  stopping: boolean
  /** Prevents reconnect after the Hub deliberately retired this endpoint. */
  remoteTerminating: boolean
}

/** One accepted inbox source that must reach Session persistence before a request may use it. */
interface FlushBarrier {
  /** Session whose next proposed step must await this source. */
  readonly sessionId: Agent['session']['id']
  /** Settles when the source Session is durably flushed or that flush fails. */
  readonly settled: Promise<void>
  /** Release the waiting pre-step after durable persistence succeeds. */
  readonly resolve: () => void
  /** Reject the waiting pre-step when source persistence fails. */
  readonly reject: (reason?: unknown) => void
}

/** Runtime-local issuer for exact Team workspace lifecycle source proofs. */
class WorkspaceAllocationAuthority {
  private readonly proofs = new Map<TeamSystemWorkspaceAllocationProof, TeamSystemWorkspaceAllocationScope>()
  private readonly unregister: () => void

  /** @param teams - Team runtime that owns source-proof registration. @param name - fixed delivery source identity. */
  constructor(teams: TeamRuntime, name: string) {
    const source: TeamSystemWorkspaceAllocationProofSource = {
      name,
      resolveWorkspaceAllocationProof: proof => this.proofs.get(proof),
    }
    this.unregister = teams.registerSystemWorkspaceAllocationProofSource(source)
  }

  /** Retain one exact source scope only until its canonical Team mutation settles. */
  async withProof<T>(
    scope: TeamSystemWorkspaceAllocationScope,
    operation: (actor: TeamSystemWorkspaceAllocationProof) => Promise<T>,
  ): Promise<T> {
    const proof = createWorkspaceAllocationProof()
    this.proofs.set(proof, Object.freeze(structuredClone(scope)))
    try {
      return await operation(proof)
    } finally {
      this.proofs.delete(proof)
    }
  }

  /** Revoke every source proof and release the fixed delivery's registration. */
  close(): void {
    this.proofs.clear()
    this.unregister()
  }
}

let nextWorkspaceAllocationAuthority = 1

/** Delivers one exact Agent/activation binding without discovering Team state. */
export class FixedBindingTeamAgentLinkDelivery implements TeamLinkBoundLinkBorrower {
  private readonly bindings = new Map<string, Binding>()
  private readonly connections = new Map<string, LinkConnection>()
  private readonly deliveryTails = new Map<Agent['id'], Promise<void>>()
  private readonly flushBarriers = new Map<string, FlushBarrier>()
  private readonly claimedChannelViews = new Set<string>()
  private readonly flushedEnvelopeSources = new Map<string, Agent['session']['id']>()
  private readonly workspacePublications = new Map<string, Promise<TeamWorkspacePublishResult | undefined>>()
  private readonly workspaceAllocations = new Map<string, TeamWorkspaceAllocation>()
  private readonly workspaceSnapshots = new Map<string, TeamWorkspaceAllocationSnapshot>()
  private readonly workspaceKeysById = new Map<TeamWorkspaceAllocationSnapshot['id'], string>()
  private readonly workspaceDisposers = new Map<string, () => void>()
  private readonly workspaceLossDisposers = new Map<string, () => void>()
  private readonly workspaceLossOperations = new Map<string, Promise<void>>()
  private readonly workspaceReleaseOperations = new Map<string, Promise<void>>()
  private readonly taskTurnOperations = new Map<number, Promise<void>>()
  private readonly physicallyReleasedWorkspaces = new Set<string>()
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly accepted = new Set<Promise<void>>()
  private readonly listeners: (() => void)[] = []
  private preStepListener: (() => void) | undefined
  private unregisterBoundLinkBorrower: (() => void) | undefined
  private workspaceUnavailableDisposer: (() => void) | undefined
  private workspaceLease: AgentWorkspaceLease | undefined
  private workspaceAuthority: WorkspaceAllocationAuthority | undefined
  private workspaceAllocationFailed = false
  private readonly linkProvider: string
  private readonly disposalTimeoutMs: number
  private readonly reconnectDelayMs: number
  private readonly workspaceMutationMaxAttempts: number
  private closeAdmissionSettled = false
  private readonly consumeWorkspace: boolean
  private readonly maxTaskHandoffBytes: number
  private readonly maxTaskReportReminders: number
  private readonly maxTaskOutputContinuations: number
  private readonly binding: Binding
  private readonly onTerminate: ((reason: TeamLinkTerminationReason) => Promise<void>) | undefined
  private started = false
  private closing = false
  private disposal: Promise<void> | undefined

  /**
   * @param ctx - Context carrying Link, Agent, and Session services.
   * @param request - Exact local Agent and durable activation binding to serve.
   * @param config - Validated Link-provider, reconnection, and local-delivery shutdown limits.
   */
  constructor(private readonly ctx: Context, request: FixedBindingTeamAgentLinkDeliveryRequest, config: Config = {}) {
    const resolved = resolveConfig(config)
    this.linkProvider = resolved.linkProvider
    this.disposalTimeoutMs = resolved.disposalTimeoutMs
    this.reconnectDelayMs = resolved.reconnectDelayMs
    this.workspaceMutationMaxAttempts = resolved.workspaceMutationMaxAttempts
    this.consumeWorkspace = resolved.consumeWorkspace
    this.maxTaskOutputContinuations = resolved.maxTaskOutputContinuations
    this.maxTaskReportReminders = resolved.maxTaskReportReminders
    this.maxTaskHandoffBytes = resolved.maxTaskHandoffBytes
    this.binding = bindingFor(request.agent, request.binding)
    this.onTerminate = request.onTerminate
    this.bindings.set(bindingKey(this.binding.teamId, this.binding.participantId), this.binding)
  }

  /** Subscribe to one exact Agent before connecting its immutable Team Link binding. */
  start(): void {
    if (this.started || this.closing) return
    this.started = true
    this.unregisterBoundLinkBorrower ??= this.ctx.teamLinks.registerBoundLinkBorrower(this.binding.agent, this)
    this.preStepListener ??= this.ctx.on('agent/pre-step', async ({ agent, messages }, next): Promise<PreStepDecision> => {
      if (agent !== this.binding.agent) return await next()
      if (this.closing) return { kind: 'reject' }
      return await this.awaitFlushBarriers(agent, messages, next)
    }, { prepend: true })
    this.listeners.push(this.ctx.on('team-link/provider-added', (provider) => {
      if (provider.name === this.linkProvider) this.scheduleConnection(this.binding)
    }))
    this.listeners.push(this.ctx.on('agent/disposed', ({ agent }) => {
      if (agent !== this.binding.agent) return
      this.bindings.delete(bindingKey(this.binding.teamId, this.binding.participantId))
      this.disconnectBinding(this.binding)
      this.clearFlushBarriers(agent, new Error(`team-agent-client: Agent '${agent.id}' was disposed`))
      this.clearClaimedChannelViews()
      this.clearFlushedEnvelopeSources(agent)
      this.track(this.close(), `Agent '${agent.id}' fixed binding disposal`)
    }))
    this.listeners.push(this.ctx.on('agent/inbox/discarded', ({ agent, message }) => {
      if (agent !== this.binding.agent) return
      this.removeMessageFlushBarrier(agent, message)
    }))
    this.listeners.push(this.ctx.on('agent/inbox/claimed', ({ agent, message }) => {
      if (agent !== this.binding.agent || message.source.kind !== 'team-channel-view') return
      this.claimedChannelViews.add(flushBarrierKey(agent.session.id, message.source.triggeringEnvelopeId))
    }))
    this.listeners.push(this.ctx.on('session/event', (session, event) => {
      if (session !== this.binding.agent.session) return
      if (event.type === 'step/start' || event.type === 'turn/end') this.clearClaimedChannelViews()
    }))
    if (!this.consumeWorkspace) {
      this.scheduleConnection(this.binding)
      return
    }
    if (this.ctx.get('teams') === undefined) {
      throw new TeamError('team-agent-client workspace consumption requires local Team authority', 'TEAM_INVALID_ARGUMENT')
    }
    if (this.ctx.get('teamWorkspaces') === undefined) {
      throw new TeamError('team-agent-client workspace consumption requires a registered workspace registry', 'TEAM_INVALID_ARGUMENT')
    }
    this.workspaceLease ??= openAgentWorkspaceLease(this.binding.agent, Object.freeze({
      settleForActivationDisposal: async (): Promise<void> => {
        await this.settleWorkspaceAllocations()
      },
    }))
    this.listeners.push(this.requireWorkspaceRegistry().registerAllocationPublisher(this.binding.agent, {
      publish: async request => await this.publishTaskWorkspace(request),
    }))
    this.listeners.push(this.ctx.on('team/changed', (event) => {
      if (event.type !== 'workspace-allocation/changed') return
      this.observeWorkspaceAllocation(event.allocation)
    }))
    this.track((async () => {
      await this.recoverWorkspaces()
      this.scheduleConnection(this.binding)
    })(), `Agent '${this.binding.agent.id}' workspace recovery`)
  }

  /** Stop admission and await every previously accepted local delivery. */
  close(): Promise<void> {
    this.disposal ??= this.dispose()
    return this.disposal
  }

  /**
   * Release one task allocation after the Hub records its terminal outcome.
   * @param taskId - Team task whose allocation should be released.
   * @param attemptId - exact terminal attempt owning the allocation.
   */
  releaseTaskAllocation(taskId: string, attemptId: string): void {
    const key = workspaceKey(taskId, attemptId)
    this.releaseWorkspace(key)
  }

  /** Publish only a current claimed attempt; allocation release waits for this complete operation. */
  private async publishTaskWorkspace(request: TeamWorkspaceOwnerPublicationRequest): Promise<TeamWorkspacePublishResult | undefined> {
    const key = workspaceKey(request.taskId, request.attemptId)
    const pending = this.workspacePublications.get(key)
    if (pending !== undefined) {
      await this.requirePublishingAllocation(request)
      const result = await pending
      request.signal.throwIfAborted()
      return result
    }
    const operation = (async () => {
      const allocation = await this.requirePublishingAllocation(request)
      const registry = this.requireWorkspaceRegistry()
      const provider = registry.getProvider(allocation.provider)
      if (provider === undefined) throw new TeamError('Workspace publication provider is no longer registered', 'TEAM_INVALID_ARGUMENT')
      if (provider.publish === undefined) return undefined
      let result: TeamWorkspacePublishResult
      try { result = await registry.publish(allocation.mode, { allocation, signal: request.signal }) } catch (error: unknown) {
        const snapshot = this.workspaceSnapshots.get(key)
        if (error instanceof TeamWorkspaceLostError && snapshot !== undefined) {
          this.track(this.settleWorkspaceLoss(snapshot, error.loss), `workspace '${snapshot.id}' publication loss`)
        }
        throw error
      }
      await this.requirePublishingAllocation(request)
      return result
    })()
    this.workspacePublications.set(key, operation)
    // The tool caller owns errors; disposal and release wait for completion without replacing that result.
    const settled = operation.then(() => {}, () => {})
    this.accepted.add(settled)
    void settled.then(() => {
      this.accepted.delete(settled)
      if (this.workspacePublications.get(key) === operation) this.workspacePublications.delete(key)
    })
    return await operation
  }

  /** Require actual Session claim evidence and the same live allocation, task lease and fixed activation. */
  private async requirePublishingAllocation(request: TeamWorkspaceOwnerPublicationRequest): Promise<TeamWorkspaceAllocation> {
    request.signal.throwIfAborted()
    const agent = this.binding.agent
    const key = workspaceKey(request.taskId, request.attemptId)
    const allocation = this.workspaceAllocations.get(key)
    if (this.closing || agent.status !== 'running' || allocation?.id !== request.allocationId
      || this.workspaceReleaseOperations.has(key) || resolveAgentWorkspaceRoot(agent) !== allocation.root
      || taskTurnEvidence(agent.session.events, this.binding.teamId, this.binding.activationId, request.taskId, request.attemptId).kind !== 'open') {
      throw new TeamError('Workspace publication requires its current claimed task allocation', 'TEAM_INVALID_ARGUMENT')
    }
    const state = await this.requireWorkspaceTeams().getTeam({ teamId: this.binding.teamId })
    const task = state.tasks.find(value => value.id === request.taskId)
    const retained = state.workspaceAllocations.find(value => value.id === allocation.id)
    const binding = state.activations.find(value => value.activation.id === this.binding.activationId)
    if (task?.phase !== 'running' || task.lease?.attemptId !== request.attemptId
      || task.lease.assignedRevision !== allocation.assignedRevision || task.lease.participantId !== this.binding.participantId
      || task.lease.activationId !== this.binding.activationId || task.lease.expiresAt <= Date.now()
      || retained?.lifecycle !== 'active' || retained.revision !== request.expectedRevision
      || this.workspaceSnapshots.get(key)?.revision !== request.expectedRevision || retained.attemptId !== request.attemptId
      || binding?.sessionId !== agent.session.id || (binding.activation.status !== 'idle' && binding.activation.status !== 'running')
      || this.ctx.agents.get(agent.id) !== agent || this.workspaceAllocations.get(key) !== allocation) {
      throw new TeamError('Workspace publication lost its running lease or activation binding', 'TEAM_INVALID_ARGUMENT')
    }
    request.signal.throwIfAborted()
    return allocation
  }

  /**
   * Return the current task identity for a usage sample emitted by this exact delivery Agent.
   * @returns the current allocation task/attempt identity, or `undefined` outside task work.
   */
  workspaceUsageProvenance(): Pick<TeamUsageSampleInput, 'taskId' | 'attemptId'> | undefined {
    const allocation = this.workspaceAllocations.values().next().value
    return allocation === undefined ? undefined : { taskId: allocation.taskId, attemptId: allocation.attemptId }
  }

  /** Durable activation epoch served by this fixed delivery binding. */
  get activationId(): ActivationId {
    return this.binding.activationId
  }

  /**
   * Recover a truncated or unreported worker turn, or settle an exhausted request failure.
   * The assignment and lease are re-read before waking the Agent so a stale
   * turn cannot resurrect a cancelled or replaced attempt.
   * @param event - The exact Session turn-end event observed by the client.
   */
  observeTurnEnd(event: SessionEvent): void {
    if (event.type !== 'turn/end' || this.closing
      || !['max-tokens', 'completed', 'error'].includes(event.data.reason.kind)
      || event.data.reason.kind === 'completed' && this.maxTaskReportReminders === 0) return
    const assignment = taskAssignmentForTurn(this.binding.agent.session.events, event.data.turn)
    if (assignment === undefined
      || assignment.teamId !== this.binding.teamId
      || assignment.activationId !== this.binding.activationId) return
    if (this.taskTurnOperations.has(event.data.turn)) return
    const operation = this.recoverTaskTurn(assignment, event)
      .finally(() => { this.taskTurnOperations.delete(event.data.turn) })
    this.taskTurnOperations.set(event.data.turn, operation)
    this.track(operation, `worker task '${assignment.taskId}' turn recovery`)
  }

  /** Queue one durable continuation only while the exact lease remains live. */
  private async recoverTaskTurn(
    assignment: TeamTaskAssignmentSource,
    event: SessionEvent<'turn/end'>,
  ): Promise<void> {
    const agent = this.binding.agent
    if (!this.isCurrentBinding(this.binding) || this.ctx.agents.get(agent.id) !== agent) return
    const state = await this.requireWorkspaceTeams().getTeam({ teamId: this.binding.teamId })
    const task = state.tasks.find(candidate => candidate.id === assignment.taskId)
    const lease = task?.lease
    const activation = state.activations.find(candidate => candidate.activation.id === this.binding.activationId)
    if (!this.isCurrentBinding(this.binding) || this.ctx.agents.get(agent.id) !== agent
      || task?.phase !== 'running' || task.cancellation !== undefined
      || lease?.attemptId !== assignment.attemptId
      || lease.participantId !== this.binding.participantId
      || lease.activationId !== this.binding.activationId
      || lease.expiresAt <= Date.now()
      || activation?.sessionId !== agent.session.id
      || (activation.activation.status !== 'idle' && activation.activation.status !== 'running')) return
    if (event.data.reason.kind === 'error') {
      await this.settleTaskFailure(assignment, event.data.reason.error)
      return
    }
    const kind = event.data.reason.kind === 'max-tokens' ? 'output-limit' : 'missing-report'
    const limit = kind === 'output-limit' ? this.maxTaskOutputContinuations : this.maxTaskReportReminders
    const id = MessageId(`team-task-continuation:${kind}:${assignment.envelopeId}:${String(event.data.turn)}`)
    const continuations = taskContinuationIds(agent.session.events, assignment, kind)
    if (continuations.has(id)) return
    if (continuations.size >= limit) {
      await this.settleTaskFailure(assignment, {
        code: kind === 'output-limit' ? 'TEAM_WORKER_OUTPUT_LIMIT' : 'TEAM_TASK_REPORT_MISSING',
        message: `worker exhausted ${String(limit)} ${kind} continuation turns without reporting the task`,
      })
      return
    }
    const barrier = this.installFlushBarrier(agent, assignment.envelopeId)
    try {
      agent.followup(freezeMessage({
        id,
        role: 'user',
        content: [{
          type: 'text',
          text: `The assigned Team task ${kind === 'output-limit' ? 'reached the model output limit' : 'ended without a task report'}. Continue the same task from the existing context; do not restart or delegate it. When finished, call team_task_report with task_id ${assignment.taskId} and attempt_id ${assignment.attemptId}. If the task cannot be completed, report the failure or release the attempt instead of ending with text only.`,
        }],
        source: assignment,
      }))
      await this.ctx.sessions.flush(agent.session)
      barrier.resolve()
      this.removeFlushBarrier(agent, assignment.envelopeId, barrier)
    } catch (error: unknown) {
      barrier.reject(error)
      throw error
    }
  }

  /** Settle an exact failed worker turn without waiting for lease expiry. */
  private async settleTaskFailure(
    assignment: TeamTaskAssignmentSource,
    failure: TaskAttemptFailure,
  ): Promise<void> {
    const state = await this.requireWorkspaceTeams().getTeam({ teamId: this.binding.teamId })
    const task = state.tasks.find(candidate => candidate.id === assignment.taskId)
    const lease = task?.lease
    const activation = state.activations.find(candidate => candidate.activation.id === this.binding.activationId)
    if (!this.isCurrentBinding(this.binding) || task?.phase !== 'running' || task.cancellation !== undefined
      || lease?.attemptId !== assignment.attemptId
      || lease.participantId !== this.binding.participantId
      || lease.activationId !== this.binding.activationId
      || lease.expiresAt <= Date.now()
      || activation?.sessionId !== this.binding.agent.session.id) return
    await this.withLink(async link => await link.settleTaskAttempt({
      taskId: assignment.taskId,
      attemptId: assignment.attemptId,
      expectedRevision: task.revision,
      outcome: { kind: 'failed', failure: { code: failure.code, message: failure.message } },
    }))
  }

  /**
   * Run one operation through the current fixed Link without taking over its
   * connection lifetime.
   * @param operation - operation authorized by this exact delivery owner.
   * @returns the operation result.
   */
  async withLink<T>(operation: (link: TeamLink) => Promise<T>): Promise<T> {
    const key = bindingKey(this.binding.teamId, this.binding.participantId)
    const connection = this.connections.get(key)
    const link = connection?.link
    if (connection === undefined || link === undefined || !this.isCurrentConnection(connection)) {
      throw new TeamLinkError('Team Link bound to this delivery is unavailable', 'TEAM_LINK_BOUND_LINK_UNAVAILABLE')
    }
    return await operation(link)
  }

  /** Connect the selected Team Link after one exact local binding becomes live. */
  private scheduleConnection(binding: Binding): void {
    if (!this.isCurrentBinding(binding)) return
    const key = bindingKey(binding.teamId, binding.participantId)
    const current = this.connections.get(key)
    if (current?.binding === binding && !current.stopping) return
    this.clearReconnect(key)
    this.track(this.connect(binding), `Agent '${binding.agent.id}' Team Link connection`)
  }

  /** Retry one exact current binding after a provider connection or Link lifetime failure. */
  private scheduleReconnect(binding: Binding): void {
    if (!this.isCurrentBinding(binding)) return
    const key = bindingKey(binding.teamId, binding.participantId)
    if (this.connections.has(key) || this.reconnectTimers.has(key)) return
    const timer = setTimeout(() => {
      if (this.reconnectTimers.get(key) !== timer) return
      this.reconnectTimers.delete(key)
      if (!this.isCurrentBinding(binding)) return
      this.scheduleConnection(binding)
    }, this.reconnectDelayMs)
    timer.unref()
    this.reconnectTimers.set(key, timer)
  }

  /** Cancel one scheduled retry before its binding is replaced, removed, or immediately reconciled. */
  private clearReconnect(key: string): void {
    const timer = this.reconnectTimers.get(key)
    if (timer === undefined) return
    clearTimeout(timer)
    this.reconnectTimers.delete(key)
  }

  /** Run one Link-originated direct Envelope through this Client's inbox and persistence path. */
  private async notify(connection: LinkConnection, envelope: TeamEnvelope): Promise<void> {
    if (!this.isCurrentConnection(connection)) return
    if (envelope.audience !== null && !envelope.audience.includes(connection.binding.participantId)) return
    const operation = this.serialize(connection.binding.agent, async () => {
      await this.deliver(connection, envelope)
    })
    this.track(operation, `Envelope '${envelope.id}' delivery`)
    await operation
  }

  /** Connect, subscribe, and retain one Link until its local binding loses authority. */
  private async connect(binding: Binding): Promise<void> {
    const key = bindingKey(binding.teamId, binding.participantId)
    const current = this.connections.get(key)
    if (current !== undefined) {
      this.connections.delete(key)
      this.disconnect(current)
    }
    const controller = new AbortController()
    const released = Promise.withResolvers<void>()
    const connection: LinkConnection = {
      binding,
      controller,
      released: released.promise,
      release: released.resolve,
      unsubscribe: undefined,
      unsubscribeInterrupt: undefined,
      unsubscribeTaskCancellation: undefined,
      stopping: false,
      remoteTerminating: false,
    }
    this.connections.set(key, connection)
    let link: TeamLink | undefined
    let reconnect = false
    try {
      link = await this.ctx.teamLinks.connect({
        provider: this.linkProvider,
        binding: binding.durableBinding,
        signal: controller.signal,
        onTerminate: async (reason) => {
          connection.remoteTerminating = true
          if (this.onTerminate !== undefined) {
            await this.onTerminate(reason)
            return
          }
          binding.agent.cancel({ kind: 'disposed' }, { keepInbox: true })
          await binding.agent.whenIdle()
        },
      })
      connection.link = link
      if (!this.isCurrentConnection(connection)) return
      connection.unsubscribeInvitation = link.onInvitation(async (notification) => {
        await this.acceptInvitation(connection, notification)
      })
      connection.unsubscribe = link.onNotify(async (envelope) => {
        await this.notify(connection, envelope)
      })
      connection.unsubscribeInterrupt = link.onInterrupt(async (notification) => {
        await this.interrupt(connection, notification)
      })
      connection.unsubscribeTaskCancellation = link.onTaskCancellation(async (notification) => {
        await this.cancelTask(connection, notification)
      })
      if (!this.isCurrentConnection(connection)) return
      const terminal = await Promise.race([
        connection.released.then(() => ({ kind: 'released' as const })),
        link.done.then(
          () => ({ kind: 'closed' as const }),
          (error: unknown) => ({ kind: 'failed' as const, error }),
        ),
      ])
      if (terminal.kind !== 'released' && !connection.remoteTerminating && this.isCurrentConnection(connection)) {
        const terminalFailure = terminal.kind === 'failed'
          ? terminal.error
          : new Error(`Team Link '${link.provider}' closed unexpectedly`)
        reconnect = !(terminalFailure instanceof TeamLinkConnectionError) || terminalFailure.retryable
        this.ctx.logger.warn(
          `team-agent-client: Agent '${binding.agent.id}' Team Link ended: ${renderError(terminalFailure)}`,
        )
      }
    } catch (error: unknown) {
      if (this.isCurrentConnection(connection)) {
        reconnect = !(error instanceof TeamLinkConnectionError) || error.retryable
        this.ctx.logger.warn(
          `team-agent-client: Agent '${binding.agent.id}' Team Link connection ${reconnect ? 'failed' : 'paused until provider reconfiguration or a new activation'}: ${renderError(error)}`,
        )
      }
    } finally {
      connection.unsubscribeInvitation?.()
      connection.unsubscribeInvitation = undefined
      connection.unsubscribe?.()
      connection.unsubscribe = undefined
      connection.unsubscribeInterrupt?.()
      connection.unsubscribeInterrupt = undefined
      connection.unsubscribeTaskCancellation?.()
      connection.unsubscribeTaskCancellation = undefined
      if (link !== undefined) {
        try {
          await link.close()
        } catch (error: unknown) {
          if (!reconnect) throw error
        }
      }
      if (this.connections.get(key) === connection) this.connections.delete(key)
      if (reconnect && this.isCurrentBinding(binding)) this.scheduleReconnect(binding)
    }
  }

  /** Check that this consumer still owns a deliverable Agent and immutable activation binding. */
  private isCurrentBinding(binding: Binding): boolean {
    return !this.closing
      && this.ctx.fiber.state === FiberState.ACTIVE
      && this.bindings.get(bindingKey(binding.teamId, binding.participantId)) === binding
      && this.ctx.agents.get(binding.agent.id) === binding.agent
      && binding.sessionId === binding.agent.session.id
      && isDeliverableActivation(binding.durableBinding.activation.status)
  }

  /** Return whether one Link still owns the current live Agent binding. */
  private isCurrentConnection(connection: LinkConnection): boolean {
    const binding = connection.binding
    return this.isCurrentBinding(binding)
      && !connection.stopping
      && this.connections.get(bindingKey(binding.teamId, binding.participantId)) === connection
  }

  /** Stop one Link lifetime without allowing a late connection result to subscribe. */
  private disconnect(connection: LinkConnection): void {
    if (connection.stopping) return
    connection.stopping = true
    connection.controller.abort()
    connection.unsubscribe?.()
    connection.unsubscribe = undefined
    connection.unsubscribeInterrupt?.()
    connection.unsubscribeInterrupt = undefined
    connection.unsubscribeTaskCancellation?.()
    connection.unsubscribeTaskCancellation = undefined
    connection.release()
  }

  /** Stop the Link attached to one replaced durable binding. */
  private disconnectBinding(binding: Binding): void {
    const key = bindingKey(binding.teamId, binding.participantId)
    this.clearReconnect(key)
    const connection = this.connections.get(key)
    if (connection?.binding !== binding) return
    this.connections.delete(key)
    this.disconnect(connection)
  }

  /** Track one accepted local operation and contain its asynchronous diagnostic. */
  private track(operation: Promise<void>, subject: string): void {
    this.accepted.add(operation)
    void operation.then(
      () => { this.accepted.delete(operation) },
      (error: unknown) => {
        this.accepted.delete(operation)
        if (!this.closing) this.ctx.logger.warn(`team-agent-client: ${subject} failed: ${renderError(error)}`)
      },
    )
  }

  /** Serialize Team Envelope inbox admission for one local Agent. */
  private serialize(agent: Agent, operation: () => void | Promise<void>): Promise<void> {
    const prior = this.deliveryTails.get(agent.id) ?? Promise.resolve()
    const run = prior.then(operation, operation)
    const tail = run.then(() => undefined, () => undefined)
    this.deliveryTails.set(agent.id, tail)
    void tail.then(() => {
      if (this.deliveryTails.get(agent.id) === tail) this.deliveryTails.delete(agent.id)
    })
    return run
  }

  /** Cancel the current local turn and then durably acknowledge its exact soft interrupt. */
  private async interrupt(connection: LinkConnection, notification: TeamLinkInterruptNotification): Promise<void> {
    if (!this.isCurrentConnection(connection)) return
    const { binding, link } = connection
    if (link === undefined || this.ctx.agents.get(binding.agent.id) !== binding.agent) return
    if (!interruptMatchesBinding(notification, binding)) {
      throw new Error(`team-agent-client: interrupt '${notification.interrupt.id}' does not target the current Link binding`)
    }
    binding.agent.cancel({ kind: 'user' }, { keepInbox: true })
    if (!this.isCurrentConnection(connection)
      || connection.link !== link
      || this.ctx.agents.get(binding.agent.id) !== binding.agent) return
    await link.acknowledgeInterrupt(notification.deliveryId, notification.interrupt.id)
  }

  /** Stop the exact claimed turn or discard proven unrun input before releasing its task resource. */
  private async cancelTask(connection: LinkConnection, notification: TeamLinkTaskCancellationNotification): Promise<void> {
    const { binding, link } = connection
    const target = notification.cancellation.target
    if (link === undefined || target.kind !== 'attempt'
      || target.activationId !== binding.activationId || target.participantId !== binding.participantId) return
    await this.stopTaskTurn(binding, notification.taskId, target.attemptId, notification.phase,
      () => this.isCurrentConnection(connection), connection.controller.signal)
    if (!this.isCurrentConnection(connection) || connection.link !== link) return
    const key = workspaceKey(notification.taskId, target.attemptId)
    const allocation = this.workspaceAllocations.get(key)
    if (allocation !== undefined) await this.startWorkspaceRelease(key, allocation)
    if (!this.isCurrentConnection(connection) || connection.link !== link) return
    await link.acknowledgeTaskCancellation({
      taskId: notification.taskId, attemptId: target.attemptId, expectedRevision: notification.revision,
    })
  }

  /** Stop only the task's proven open turn or queued source; unrelated work remains in the inbox. */
  private async stopTaskTurn(
    binding: Binding,
    taskId: TeamTaskSnapshot['id'],
    attemptId: TaskLeaseSnapshot['attemptId'],
    phase: TeamTaskSnapshot['phase'],
    isCurrent: () => boolean,
    signal: AbortSignal,
    unadmitted = false,
    cause: AgentCancelCause = { kind: 'user' },
  ): Promise<void> {
    let turnEnd: Promise<void> | undefined
    let disposeTurnWait = (): void => {}
    try {
      await this.serialize(binding.agent, () => {
        if (!isCurrent()) return
        const evidence = taskTurnEvidence(binding.agent.session.events, binding.teamId, binding.activationId, taskId, attemptId)
        let removedQueued = false
        for (const boundary of ['next-step', 'next-turn'] as const) {
          const messages = boundary === 'next-step' ? binding.agent.inbox.nextStep : binding.agent.inbox.nextTurn
          for (let index = messages.length - 1; index >= 0; index -= 1) {
            const source = messages[index]?.source
            if (source?.kind !== 'team-task-assignment' || source.taskId !== taskId || source.attemptId !== attemptId
              || source.teamId !== binding.teamId || source.activationId !== binding.activationId) continue
            binding.agent.inbox.splice(boundary, index, 1, [])
            removedQueued = true
          }
        }
        if (evidence.kind === 'open') {
          const ended = Promise.withResolvers<void>()
          const stop = this.ctx.on('session/event', (session, event) => {
            if (session === binding.agent.session && event.type === 'turn/end' && event.data.turn === evidence.turn) ended.resolve()
          })
          const abort = (): void => { ended.reject(new Error('task cancellation lost its active Link before target-turn settlement')) }
          signal.addEventListener('abort', abort, { once: true })
          disposeTurnWait = () => { stop(); signal.removeEventListener('abort', abort) }
          turnEnd = ended.promise
          void turnEnd.catch(() => {})
          signal.throwIfAborted()
          binding.agent.cancel(cause, { keepInbox: true, resumePending: true })
        } else if (!removedQueued && evidence.kind !== 'closed' && phase !== 'assigned' && !unadmitted) {
          throw new Error('task cancellation has no exact Session evidence that the running attempt stopped')
        }
      })
      await turnEnd
      if (isCurrent()) await this.ctx.sessions.flush(binding.agent.session)
    } finally { disposeTurnWait() }
  }

  /** Confirm only manifests supported by this installed delivery consumer and its exact current binding. */
  private async acceptInvitation(connection: LinkConnection, notification: TeamLinkInvitationNotification): Promise<void> {
    const { link, binding } = connection
    if (!this.isCurrentConnection(connection) || link === undefined
      || this.ctx.agents.get(binding.agent.id) !== binding.agent) return
    const { channel, invitation } = notification
    const manifest = channel.manifest
    if (manifest.teamId !== binding.teamId || invitation.participantId !== binding.participantId
      || invitation.status !== 'pending' || invitation.endpoint.kind !== 'activation'
      || invitation.manifestFingerprint !== fingerprintChannelManifest(manifest)
      || !manifest.participants.some(member => member.id === binding.participantId && member.role === invitation.role)) {
      throw new TeamError('Channel invitation does not match this delivery endpoint', 'TEAM_INVALID_ARGUMENT')
    }
    switch (adapterKey(manifest.adapter)) {
      case DIRECT_CHANNEL_V1_KEY: directChannelAdapter.validateCreate(manifest); break
      case DIRECT_CHANNEL_V2_KEY: directChannelV2Adapter.validateCreate(manifest); break
      case DIRECT_CHANNEL_V3_KEY: directChannelV3Adapter.validateCreate(manifest); break
      case DIRECT_CHANNEL_V4_KEY: directChannelV4Adapter.validateCreate(manifest); break
      default:
        if (manifest.adapter.type === TASK_ASSIGNMENT_CHANNEL_TYPE && manifest.adapter.version === TASK_ASSIGNMENT_CHANNEL_VERSION) {
          const assignment = parseTaskAssignmentChannelManifest(manifest)
          if (assignment.activationId !== binding.activationId || assignment.sessionId !== binding.sessionId) {
            throw new TeamError('Task invitation targets another activation', 'TEAM_INVALID_ARGUMENT')
          }
        } else if (manifest.viewPolicy === undefined || manifest.adapter.version !== 1
          || !['consult', 'discussion', 'workflow'].includes(manifest.adapter.type)) {
          throw new TeamError('Delivery endpoint does not support the invited channel protocol', 'TEAM_INVALID_ARGUMENT')
        }
    }
    if (!this.isCurrentConnection(connection)) return
    await link.acknowledgeChannelInvitation({ channelId: manifest.id, revision: invitation.revision,
      manifestFingerprint: invitation.manifestFingerprint,
      idempotencyKey: channelInvitationIdempotencyKeySchema.parse(`agent-client:${String(manifest.id)}:${invitation.revision}`) })
  }

  /** Claim and durably admit one supported Team Envelope into its exact live Agent inbox. */
  private async deliver(connection: LinkConnection, envelope: TeamEnvelope): Promise<void> {
    if (!this.isCurrentConnection(connection)) return
    const { binding, link } = connection
    if (link === undefined) return
    if (this.ctx.agents.get(binding.agent.id) !== binding.agent) return
    let claim: ChannelDeliveryClaim | undefined
    try {
      claim = await link.claim(envelope.channelId, envelope.id)
    } catch (error: unknown) {
      // Retiring this Link revokes its proof before a queued Hub claim can run.
      // No Session input is admitted yet; its Envelope remains pending for replay.
      if (!this.isCurrentConnection(connection)) return
      throw error
    }
    if (claim === undefined) {
      this.flushedEnvelopeSources.delete(flushBarrierKey(binding.agent.session.id, envelope.id))
      return
    }
    if (!this.isCurrentConnection(connection)
      || connection.link !== link
      || this.ctx.agents.get(binding.agent.id) !== binding.agent) return
    if (isDirectChannel(claim.channel, envelope)) {
      const message = directMessage(claim.channel, envelope)
      if (message === undefined) {
        this.ctx.logger.warn(`team-agent-client: direct Envelope '${envelope.id}' has no admissible message payload`)
        return
      }
      if (!claimMatchesDirectDelivery(binding, envelope, claim)) return
      await this.admitEnvelope(connection, envelope, claim, message)
      return
    }
    if (isDirectProtocolChannel(claim.channel)) return
    if (!isTaskAssignmentChannel(claim.channel)) {
      if (!claimMatchesChannelRecipient(binding, envelope, claim)) return
      const view = claim.view
      if (view === undefined) {
        throw new TeamError(`non-direct channel '${envelope.channelId}' delivery claim lacks a model view`, 'TEAM_INVALID_ARGUMENT')
      }
      if (!claimViewMatchesDelivery(view, envelope, claim)) {
        throw new TeamError(`non-direct channel '${envelope.channelId}' delivery claim has an invalid model view`, 'TEAM_INVALID_ARGUMENT')
      }
      await this.admitChannelView(connection, envelope, claim, view)
      return
    }
    if (!claimMatchesDelivery(binding, envelope, claim)) return
    const assignment = parseTaskAssignmentEnvelope(claim.channel.manifest, envelope)
    if (!assignmentMatchesBinding(assignment, binding)) return
    const task = await link.claimTaskAttemptStart({
      taskId: assignment.taskId,
      attemptId: assignment.attemptId,
      assignedRevision: assignment.assignedRevision,
      channelId: assignment.channelId,
      envelopeId: assignment.envelopeId,
    })
    if (!this.isCurrentConnection(connection)
      || connection.link !== link
      || this.ctx.agents.get(binding.agent.id) !== binding.agent
      || !startedTaskMatchesAssignment(task, assignment, binding)) return
    const allocation = await this.allocateWorkspace(task, assignment, binding)
    try {
      await this.admitEnvelope(
        connection,
        envelope,
        claim,
        taskAssignmentMessage(assignment, task, binding.activationId, this.maxTaskHandoffBytes, allocation?.root, allocation?.id),
      )
    } catch (error: unknown) {
      if (allocation !== undefined) this.releaseWorkspace(workspaceKey(task.id, assignment.attemptId))
      throw error
    }
  }

  /** Persist and flush one non-direct model view before placing its stable derived message in the Agent inbox. */
  private async admitChannelView(
    connection: LinkConnection,
    envelope: TeamEnvelope,
    claim: ChannelDeliveryClaim,
    view: TeamChannelViewEventData,
  ): Promise<void> {
    const { binding } = connection
    const link = connection.link as TeamLink
    const recorded = recordedChannelView(binding.agent, envelope.id)
    if (recorded !== undefined && !isDeepStrictEqual(recorded.data, view)) {
      throw new TeamError(`non-direct channel '${envelope.channelId}' redelivery does not match its durable model view`, 'TEAM_INVALID_ARGUMENT')
    }
    const event = recorded ?? binding.agent.session.append('team/channel-view', view, { surfaceOp: 'append' })
    // Session's fixed team/channel-view projection always returns a user message.
    const message = binding.agent.session.deriveEventMessage(event) as UserMessage
    if (recorded === undefined || !channelViewReachedModelStep(binding.agent, event)) {
      const barrier = this.installFlushBarrier(binding.agent, envelope.id)
      try {
        if (!channelViewMessagePending(binding.agent, envelope.id)
          && !this.channelViewClaimed(binding.agent, envelope.id)) {
          switch (event.data.delivery) {
            case 'context':
              binding.agent.inject(message)
              break
            case 'turn':
              binding.agent.followup(message)
              break
            case 'steer':
              binding.agent.steer(message)
              break
            /* v8 ignore next 2 -- TeamChannelViewEventData.delivery is a closed service-definition union. */
            default:
              event.data.delivery satisfies never
          }
        }
        await this.ctx.sessions.flush(binding.agent.session)
      } catch (error: unknown) {
        barrier.reject(error)
        this.removeFlushBarrier(binding.agent, envelope.id, barrier)
        this.claimedChannelViews.delete(flushBarrierKey(binding.agent.session.id, envelope.id))
        throw error
      }
      barrier.resolve()
      this.removeFlushBarrier(binding.agent, envelope.id, barrier)
    } else {
      await this.ctx.sessions.flush(binding.agent.session)
    }
    if (!this.isCurrentConnection(connection)
      || connection.link !== link
      || this.ctx.agents.get(binding.agent.id) !== binding.agent) return
    await link.acknowledge(envelope.channelId, envelope.id, claim.channel.cursor)
  }

  /** Persist one claimed Envelope-derived source, flush its Session, then append the recipient receipt. */
  private async admitEnvelope(
    connection: LinkConnection,
    envelope: TeamEnvelope,
    claim: ChannelDeliveryClaim,
    message: UserMessage,
  ): Promise<void> {
    const { binding, link } = connection
    if (link === undefined || !this.isCurrentConnection(connection)) return
    const sourceKey = flushBarrierKey(binding.agent.session.id, envelope.id)
    if (!this.envelopeAccepted(binding.agent, envelope.id)) {
      const barrier = this.installFlushBarrier(binding.agent, envelope.id)
      try {
        switch (claim.delivery) {
          case 'context':
            binding.agent.inject(message)
            break
          case 'turn':
            binding.agent.followup(message)
            break
          case 'steer':
            binding.agent.steer(message)
            break
          /* v8 ignore next 2 -- EnvelopeDelivery is a closed service-definition union. */
          default:
            claim.delivery satisfies never
        }
      } catch (error: unknown) {
        barrier.reject(error)
        this.removeFlushBarrier(binding.agent, envelope.id, barrier)
        throw error
      }
      try {
        await this.ctx.sessions.flush(binding.agent.session)
      } catch (error: unknown) {
        barrier.reject(error)
        throw error
      }
      this.flushedEnvelopeSources.set(sourceKey, binding.agent.session.id)
      barrier.resolve()
      this.removeFlushBarrier(binding.agent, envelope.id, barrier)
    } else {
      await this.ctx.sessions.flush(binding.agent.session)
      this.flushedEnvelopeSources.set(sourceKey, binding.agent.session.id)
      this.removeFlushBarrierByKey(sourceKey, this.flushBarriers.get(sourceKey))
    }
    if (!this.isCurrentConnection(connection) || connection.link !== link
      || this.ctx.agents.get(binding.agent.id) !== binding.agent) return
    await link.acknowledge(envelope.channelId, envelope.id, claim.channel.cursor)
    this.flushedEnvelopeSources.delete(sourceKey)
  }

  /** Hold a proposed model step until each accepted Team source in it is durable. */
  private async awaitFlushBarriers(
    agent: Agent,
    messages: readonly UserMessage[],
    next: () => Promise<PreStepDecision>,
  ): Promise<PreStepDecision> {
    if (!this.taskWorkspaceSourcesRemainLive(messages)) return { kind: 'reject' }
    const barriers = new Map<string, FlushBarrier>()
    for (const message of messages) {
      if (!isTeamEnvelopeSource(message)) continue
      const key = flushBarrierKey(agent.session.id, teamSourceEnvelopeId(message))
      const barrier = this.flushBarriers.get(key)
      if (barrier !== undefined) barriers.set(key, barrier)
    }
    if (barriers.size === 0) return await next()
    const settled = await Promise.allSettled([...barriers.values()].map(barrier => barrier.settled))
    for (const [key, barrier] of barriers) this.removeFlushBarrierByKey(key, barrier)
    return settled.some(result => result.status === 'rejected') ? { kind: 'reject' } : await next()
  }

  /** Reject a task step rather than letting a released allocation fall back to the Session cwd. */
  private taskWorkspaceSourcesRemainLive(messages: readonly UserMessage[]): boolean {
    for (const message of messages) {
      if (message.source.kind !== 'team-task-assignment') continue
      const allocationId = message.source.workspaceAllocationId
      if (allocationId === undefined) continue
      const key = this.workspaceKeysById.get(allocationId)
      const allocation = key === undefined ? undefined : this.workspaceAllocations.get(key)
      if (allocation?.id !== allocationId || allocation.root.length === 0) return false
    }
    return true
  }

  /** Install the one-shot durability barrier before an Envelope can enter a live inbox. */
  private installFlushBarrier(agent: Agent, envelopeId: EnvelopeId): FlushBarrier {
    const key = flushBarrierKey(agent.session.id, envelopeId)
    const existing = this.flushBarriers.get(key)
    if (existing !== undefined) return existing
    const settled = Promise.withResolvers<void>()
    // A canceled Agent can discard its source before it reaches pre-step.
    void settled.promise.catch(() => {})
    const barrier: FlushBarrier = {
      sessionId: agent.session.id,
      settled: settled.promise,
      resolve: settled.resolve,
      reject: settled.reject,
    }
    this.flushBarriers.set(key, barrier)
    return barrier
  }

  /** Reject a source that the Agent discarded before its barrier could reach a model step. */
  private removeMessageFlushBarrier(agent: Agent, message: UserMessage): void {
    if (!isTeamEnvelopeSource(message)) return
    const envelopeId = teamSourceEnvelopeId(message)
    const key = flushBarrierKey(agent.session.id, envelopeId)
    if (message.source.kind === 'team-channel-view') this.claimedChannelViews.delete(key)
    this.flushedEnvelopeSources.delete(key)
    this.rejectFlushBarrierByKey(key, new Error(`team-agent-client: Envelope '${envelopeId}' was discarded`))
  }

  /** Reject every source whose Agent can no longer reach another proposed step. */
  private clearFlushBarriers(
    agent: Agent,
    reason: unknown = new Error(`team-agent-client: Agent '${agent.id}' cannot reach another proposed step`),
  ): void {
    for (const [key, barrier] of this.flushBarriers) {
      if (barrier.sessionId === agent.session.id) this.rejectFlushBarrierByKey(key, reason)
    }
  }

  /** Remove one known flush barrier without disturbing a later retry for the same Envelope. */
  private removeFlushBarrier(agent: Agent, envelopeId: EnvelopeId, barrier: FlushBarrier): void {
    this.removeFlushBarrierByKey(flushBarrierKey(agent.session.id, envelopeId), barrier)
  }

  /** Remove one known flush barrier without disturbing a later retry for the same key. */
  private removeFlushBarrierByKey(key: string, barrier: FlushBarrier | undefined): void {
    if (barrier === undefined) return
    if (this.flushBarriers.get(key) === barrier) this.flushBarriers.delete(key)
  }

  /** Reject one known live barrier before removing it from future pre-step lookup. */
  private rejectFlushBarrierByKey(key: string, reason: unknown): void {
    const barrier = this.flushBarriers.get(key)
    if (barrier === undefined) return
    this.flushBarriers.delete(key)
    barrier.reject(reason)
  }

  /** Clear retained post-flush retry state for one Agent that has departed. */
  private clearFlushedEnvelopeSources(agent: Agent): void {
    for (const [key, sessionId] of this.flushedEnvelopeSources) {
      if (sessionId === agent.session.id) this.flushedEnvelopeSources.delete(key)
    }
  }

  /** Clear view claims after a step or when the owning Agent leaves this Client. */
  private clearClaimedChannelViews(): void {
    this.claimedChannelViews.clear()
  }

  /** Return whether a view is already claimed by the Agent before step/start is logged. */
  private channelViewClaimed(agent: Agent, envelopeId: EnvelopeId): boolean {
    return this.claimedChannelViews.has(flushBarrierKey(agent.session.id, envelopeId))
  }

  /** Check current model history, pending inbox state, and a prior flush awaiting only a receipt retry. */
  private envelopeAccepted(agent: Agent, envelopeId: EnvelopeId): boolean {
    const key = flushBarrierKey(agent.session.id, envelopeId)
    return this.flushedEnvelopeSources.has(key) || envelopeAccepted(agent, envelopeId)
  }

  /** Reserve, materialize, activate, and scope one exact task execution root after delivery-bound start. */
  private async allocateWorkspace(
    task: TeamTaskSnapshot & { readonly lease: TaskLeaseSnapshot },
    assignment: TaskAssignmentEnvelope,
    binding: Binding,
  ): Promise<TeamWorkspaceAllocation | undefined> {
    if (!this.consumeWorkspace) return undefined
    const key = workspaceKey(task.id, assignment.attemptId)
    const existing = this.workspaceAllocations.get(key)
    if (existing !== undefined) return existing
    // A task assignment has already entered durable execution. Do not let any
    // interleaved model step use the Session root while its task root is pending.
    this.installUnavailableWorkspaceScope()
    const workspaces = this.ctx.get('teamWorkspaces')
    if (workspaces === undefined) {
      this.markWorkspaceAllocationFailure()
      throw new TeamError('team-agent-client cannot admit a task assignment without a workspace provider registry', 'TEAM_INVALID_ARGUMENT')
    }
    const request: TeamWorkspacePrepareRequest = {
      teamId: task.teamId,
      taskId: task.id,
      attemptId: assignment.attemptId,
      assignedRevision: assignment.assignedRevision,
      participantId: binding.participantId,
      activationId: binding.activationId,
      sessionId: binding.sessionId,
    }
    let preparation: TeamWorkspacePreparation
    try {
      preparation = await workspaces.prepare(task.workspaceMode, request)
    } catch (error: unknown) {
      this.markWorkspaceAllocationFailure()
      throw error
    }
    if (!this.isCurrentBinding(this.binding)) {
      await preparation.abandon()
      return undefined
    }
    let snapshot: TeamWorkspaceAllocationSnapshot
    try {
      snapshot = await this.reserveWorkspaceAllocation(task, request, preparation)
    } catch (error: unknown) {
      this.markWorkspaceAllocationFailure()
      try {
        await preparation.abandon()
      } catch (abandonError: unknown) {
        throw new AggregateError([error, abandonError], `team-agent-client: workspace '${preparation.id}' reservation cleanup failed`)
      }
      throw error
    }
    if (!this.isCurrentBinding(this.binding)) {
      await this.cleanupUnpublishedWorkspace(preparation.abandon.bind(preparation), snapshot, undefined,
        new Error('team-agent-client: workspace setup was cancelled during disposal'))
      return undefined
    }
    let allocation: TeamWorkspaceAllocation | undefined
    let disposeAllocation: (() => void) | undefined
    try {
      allocation = await workspaces.materialize(task.workspaceMode, request, preparation)
      if (this.isCurrentBinding(this.binding)) snapshot = await this.activateWorkspaceAllocation(snapshot)
      if (this.isCurrentBinding(this.binding)) {
        disposeAllocation = this.requireWorkspaceLease().publishRoot(allocation.root)
        this.workspaceAllocationFailed = false
        this.clearUnavailableWorkspaceScope()
      }
    } catch (error: unknown) {
      if (allocation === undefined) {
        this.markWorkspaceAllocationFailure()
        const cleanupFailures: unknown[] = []
        try {
          if (error instanceof TeamWorkspaceLostError) await this.settleWorkspaceLoss(snapshot, error.loss, true)
          else await this.preserveWorkspaceAllocation(snapshot, workspacePreservationReason('WORKSPACE_MATERIALIZATION_FAILED', error))
        } catch (preservation: unknown) {
          cleanupFailures.push(preservation)
        }
        try {
          await preparation.abandon()
        } catch (abandonment: unknown) {
          cleanupFailures.push(abandonment)
        }
        if (cleanupFailures.length > 0) {
          throw new AggregateError([error, ...cleanupFailures], `team-agent-client: workspace '${preparation.id}' materialization cleanup failed`)
        }
      } else {
        await this.cleanupUnpublishedWorkspace(allocation.release.bind(allocation), snapshot, disposeAllocation, error)
      }
      throw error
    }
    if (!this.isCurrentBinding(this.binding)) {
      await this.cleanupUnpublishedWorkspace(allocation.release.bind(allocation), snapshot, disposeAllocation,
        new Error('team-agent-client: workspace setup was cancelled during disposal'))
      return undefined
    }
    this.workspaceAllocations.set(key, allocation)
    this.watchWorkspaceLoss(key, allocation)
    this.workspaceSnapshots.set(key, snapshot)
    this.workspaceKeysById.set(snapshot.id, key)
    this.workspaceDisposers.set(key, disposeAllocation as () => void)
    return allocation
  }

  /** Release one task allocation through durable release intent and physical cleanup. */
  private releaseWorkspace(key: string): void {
    if (this.workspaceLossOperations.has(key)) return
    const allocation = this.workspaceAllocations.get(key)
    if (allocation === undefined) return
    this.track(this.startWorkspaceRelease(key, allocation), `workspace allocation '${key}' release`)
  }

  /** Keep provider loss observation attached while its unavailable root remains owned. */
  private watchWorkspaceLoss(key: string, allocation: TeamWorkspaceAllocation): void {
    if (allocation.onLoss === undefined || this.workspaceLossDisposers.has(key)) return
    this.workspaceLossDisposers.set(key, allocation.onLoss(async (loss) => {
      const snapshot = this.workspaceSnapshots.get(key)
      if (snapshot !== undefined) await this.settleWorkspaceLoss(snapshot, loss)
    }))
  }

  /** Serialize loss with the exact task consumer instead of treating restore failure as cleanup success. */
  private settleWorkspaceLoss(snapshot: TeamWorkspaceAllocationSnapshot, loss: TeamWorkspaceLoss, unadmitted = false): Promise<void> {
    const key = workspaceKey(snapshot.taskId, snapshot.attemptId)
    const pending = this.workspaceLossOperations.get(key)
    if (pending !== undefined) return pending
    this.installUnavailableWorkspaceScope()
    const operation = this.settleWorkspaceLossOwned(snapshot, loss, unadmitted)
    this.workspaceLossOperations.set(key, operation)
    this.accepted.add(operation)
    void operation.then(() => {
      this.workspaceLossOperations.delete(key)
      this.accepted.delete(operation)
    }, () => {
      this.workspaceLossOperations.delete(key)
      this.accepted.delete(operation)
    })
    return operation
  }

  private async recordWorkspaceLoss(
    snapshot: TeamWorkspaceAllocationSnapshot, loss: TeamWorkspaceLoss,
  ): Promise<TeamWorkspaceAllocationSnapshot> {
    const teams = this.requireWorkspaceTeams()
    const facts: TeamWorkspaceLoss = {
      executionWorld: loss.executionWorld, reason: loss.reason, terminationProven: loss.terminationProven, artifacts: loss.artifacts,
    }
    return await this.retryWorkspaceMutation(async () => {
      const { current, cursor } = await this.currentWorkspaceAllocation(teams, snapshot)
      const input = {
        teamId: current.teamId, expectedCursor: cursor, allocationId: current.id, expectedRevision: current.revision, loss: facts,
      }
      return await this.requireWorkspaceAuthority().withProof({ kind: 'workspace-allocation-loss', ...input }, async actor =>
        await teams.recordWorkspaceAllocationLoss({ actor, ...input }))
    })
  }

  private async settleWorkspaceLossOwned(
    snapshot: TeamWorkspaceAllocationSnapshot, loss: TeamWorkspaceLoss, unadmitted: boolean,
  ): Promise<void> {
    if (snapshot.teamId !== this.binding.teamId || snapshot.participantId !== this.binding.participantId
      || snapshot.activationId !== this.binding.activationId || snapshot.sessionId !== this.binding.sessionId
      || !isDeepStrictEqual(snapshot.executionWorld, loss.executionWorld)) {
      throw new TeamError('Workspace loss does not belong to this exact task execution owner', 'TEAM_INVALID_ARGUMENT')
    }
    const artifacts = this.ctx.get('teamArtifacts')
    for (const artifact of loss.artifacts) {
      if (artifacts === undefined || artifact.provider === undefined || artifact.sourceAttemptId !== snapshot.attemptId) {
        throw new TeamError('Workspace loss artifact has no exact provider-backed attempt provenance', 'TEAM_INVALID_ARGUMENT')
      }
      await artifacts.read(artifact.provider, { reference: artifact })
    }
    let unavailable = await this.recordWorkspaceLoss(snapshot, loss)
    const teams = this.requireWorkspaceTeams()
    let state = await teams.getTeam({ teamId: snapshot.teamId })
    const task = state.tasks.find(candidate => candidate.id === snapshot.taskId)
    const currentAttempt = task?.lease?.attemptId === snapshot.attemptId
    if (currentAttempt) {
      try {
        await this.stopTaskTurn(this.binding, task.id, snapshot.attemptId, task.phase,
          () => this.isCurrentBinding(this.binding), new AbortController().signal, unadmitted,
          { kind: 'hook', reason: 'task execution workspace is unavailable' })
      } catch (error: unknown) {
        await this.preserveWorkspaceAllocation(unavailable, workspacePreservationReason('WORKSPACE_TASK_STOP_UNCONFIRMED', error))
        throw error
      }
    }
    const key = workspaceKey(snapshot.taskId, snapshot.attemptId)
    if (loss.terminationProven) {
      const publication = this.workspacePublications.get(key)
      if (publication !== undefined) await Promise.allSettled([publication])
      unavailable = await this.requestWorkspaceAllocationRelease(unavailable)
      const allocation = this.workspaceAllocations.get(key)
      if (allocation !== undefined) await allocation.release()
      unavailable = await this.confirmWorkspaceAllocationRelease(unavailable)
      this.workspaceSnapshots.set(key, unavailable)
      this.forgetWorkspace(key)
    } else {
      this.workspaceSnapshots.set(key, unavailable)
      this.detachWorkspaceScope(key)
    }
    state = await teams.getTeam({ teamId: snapshot.teamId })
    const remaining = state.tasks.find(candidate => candidate.id === snapshot.taskId)
    const binding = state.activations.find(candidate => candidate.activation.id === snapshot.activationId)
    if (remaining?.lease?.attemptId !== snapshot.attemptId || binding === undefined || remaining.cancellation !== undefined) return
    const issuer = teams.openActivationActorProofIssuer()
    const actor = issuer.issue(binding)
    try {
      await teams.settleTaskAttempt({
        actor: actor.proof, taskId: remaining.id, attemptId: snapshot.attemptId, expectedRevision: remaining.revision,
        outcome: state.team.cancellation !== undefined || state.team.closure !== undefined
          ? { kind: 'cancelled' }
          : { kind: 'failed', failure: { code: 'WORKSPACE_LOST', message: `Execution workspace is unavailable: ${loss.reason}` } },
      })
    } finally { actor.revoke(); issuer.close() }
  }

  /** Start or join one exact allocation cleanup operation. */
  private startWorkspaceRelease(key: string, allocation: TeamWorkspaceAllocation): Promise<void> {
    const existing = this.workspaceReleaseOperations.get(key)
    if (existing !== undefined) return existing
    // A published allocation and its durable snapshot enter and leave their
    // private maps together, before any provider operation can yield.
    const snapshot = this.workspaceSnapshots.get(key) as TeamWorkspaceAllocationSnapshot
    const operation = this.releaseWorkspaceOwned(key, allocation, snapshot)
    this.workspaceReleaseOperations.set(key, operation)
    void operation.then(
      () => { this.workspaceReleaseOperations.delete(key); this.releaseClosedWorkspaceOwnership() },
      () => { this.workspaceReleaseOperations.delete(key); this.releaseClosedWorkspaceOwnership() },
    )
    return operation
  }

  /** Await release or preservation of every allocation currently scoped to this Agent. */
  private async settleWorkspaceAllocations(): Promise<void> {
    const operations = new Set<Promise<void>>()
    for (const [key, allocation] of this.workspaceAllocations) {
      operations.add(this.startWorkspaceRelease(key, allocation))
    }
    for (const operation of this.workspaceReleaseOperations.values()) operations.add(operation)
    if (operations.size === 0) return
    const settled = await Promise.allSettled(operations)
    const failures = settled
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason as unknown)
    if (failures.length > 0) throw new AggregateError(failures, 'team-agent-client: pre-dispose workspace settlement failed')
  }

  /** Reserve provider metadata before an execution root exists. */
  private async reserveWorkspaceAllocation(
    task: TeamTaskSnapshot & { readonly lease: TaskLeaseSnapshot },
    request: TeamWorkspacePrepareRequest,
    preparation: TeamWorkspacePreparation,
  ): Promise<TeamWorkspaceAllocationSnapshot> {
    const teams = this.requireWorkspaceTeams()
    return await this.retryWorkspaceMutation(async () => {
      const state = await teams.getTeam({ teamId: request.teamId })
      const input = {
        teamId: request.teamId,
        expectedCursor: state.team.cursor,
        taskId: request.taskId,
        expectedTaskRevision: task.revision,
        attemptId: request.attemptId,
        allocation: workspaceBindingMetadata(preparation),
      }
      const scope: TeamSystemWorkspaceAllocationScope = { kind: 'workspace-allocation-reserve', ...input }
      return await this.requireWorkspaceAuthority().withProof(scope, async actor =>
        await teams.reserveWorkspaceAllocation({ actor, ...input }))
    })
  }

  /** Mark one materialized provider root active through its latest durable allocation fence. */
  private async activateWorkspaceAllocation(snapshot: TeamWorkspaceAllocationSnapshot): Promise<TeamWorkspaceAllocationSnapshot> {
    const teams = this.requireWorkspaceTeams()
    return await this.retryWorkspaceMutation(async () => {
      const { current, cursor } = await this.currentWorkspaceAllocation(teams, snapshot)
      if (current.lifecycle === 'active') return current
      const input = {
        teamId: current.teamId,
        expectedCursor: cursor,
        allocationId: current.id,
        expectedRevision: current.revision,
      }
      const scope: TeamSystemWorkspaceAllocationScope = { kind: 'workspace-allocation-activate', ...input }
      return await this.requireWorkspaceAuthority().withProof(scope, async actor =>
        await teams.activateWorkspaceAllocation({ actor, ...input }))
    })
  }

  /** Persist release intent before this process touches a provider-owned root. */
  private async requestWorkspaceAllocationRelease(snapshot: TeamWorkspaceAllocationSnapshot): Promise<TeamWorkspaceAllocationSnapshot> {
    const teams = this.requireWorkspaceTeams()
    return await this.retryWorkspaceMutation(async () => {
      const { current, cursor } = await this.currentWorkspaceAllocation(teams, snapshot)
      if (current.lifecycle === 'released' || (current.lifecycle === 'preserved' && current.loss?.terminationProven !== true)
        || current.lifecycle === 'release-requested') return current
      const input = {
        teamId: current.teamId,
        expectedCursor: cursor,
        allocationId: current.id,
        expectedRevision: current.revision,
      }
      const scope: TeamSystemWorkspaceAllocationScope = { kind: 'workspace-allocation-release-request', ...input }
      return await this.requireWorkspaceAuthority().withProof(scope, async actor =>
        await teams.requestWorkspaceAllocationRelease({ actor, ...input }))
    })
  }

  /** Record a recoverable provider cleanup failure instead of hiding a live root. */
  private async preserveWorkspaceAllocation(
    snapshot: TeamWorkspaceAllocationSnapshot,
    reason: { readonly code: string; readonly message: string },
  ): Promise<TeamWorkspaceAllocationSnapshot> {
    const teams = this.requireWorkspaceTeams()
    return await this.retryWorkspaceMutation(async () => {
      const { current, cursor } = await this.currentWorkspaceAllocation(teams, snapshot)
      if (current.lifecycle === 'preserved' || current.lifecycle === 'released') return current
      const input = {
        teamId: current.teamId,
        expectedCursor: cursor,
        allocationId: current.id,
        expectedRevision: current.revision,
        reason,
      }
      const scope: TeamSystemWorkspaceAllocationScope = { kind: 'workspace-allocation-preserve', ...input }
      return await this.requireWorkspaceAuthority().withProof(scope, async actor =>
        await teams.preserveWorkspaceAllocation({ actor, ...input }))
    })
  }

  /** Confirm physical provider cleanup only after its release intent became durable. */
  private async confirmWorkspaceAllocationRelease(snapshot: TeamWorkspaceAllocationSnapshot): Promise<TeamWorkspaceAllocationSnapshot> {
    const teams = this.requireWorkspaceTeams()
    return await this.retryWorkspaceMutation(async () => {
      const { current, cursor } = await this.currentWorkspaceAllocation(teams, snapshot)
      if (current.lifecycle === 'released') return current
      const input = {
        teamId: current.teamId,
        expectedCursor: cursor,
        allocationId: current.id,
        expectedRevision: current.revision,
      }
      const scope: TeamSystemWorkspaceAllocationScope = { kind: 'workspace-allocation-release', ...input }
      return await this.requireWorkspaceAuthority().withProof(scope, async actor =>
        await teams.confirmWorkspaceAllocationRelease({ actor, ...input }))
    })
  }

  /** Resolve the latest durable allocation snapshot rather than trusting a stale local transition fence. */
  private async currentWorkspaceAllocation(
    teams: TeamRuntime,
    snapshot: TeamWorkspaceAllocationSnapshot,
  ): Promise<{ readonly current: TeamWorkspaceAllocationSnapshot; readonly cursor: number }> {
    const state = await teams.getTeam({ teamId: snapshot.teamId })
    const current = state.workspaceAllocations.find(allocation => allocation.id === snapshot.id)
    if (current === undefined) {
      throw new TeamError(`workspace allocation '${snapshot.id}' is no longer durable`, 'TEAM_INVALID_ARGUMENT')
    }
    return { current, cursor: state.team.cursor }
  }

  /** Reissue an exact workspace proof only when another durable Team write won the cursor CAS. */
  private async retryWorkspaceMutation<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await operation()
      } catch (error: unknown) {
        if (!(error instanceof TeamError) || error.code !== 'TEAM_CURSOR_CONFLICT' || attempt >= this.workspaceMutationMaxAttempts) throw error
      }
    }
  }

  /** Release one mapped live allocation after an owner accepted durable release intent. */
  private async releaseWorkspaceOwned(
    key: string,
    allocation: TeamWorkspaceAllocation,
    snapshot: TeamWorkspaceAllocationSnapshot,
  ): Promise<void> {
    const publication = this.workspacePublications.get(key)
    if (publication !== undefined) await Promise.allSettled([publication])
    let releasing = await this.requestWorkspaceAllocationRelease(snapshot)
    if (releasing.lifecycle === 'released' || releasing.lifecycle === 'preserved') {
      this.workspaceSnapshots.set(key, releasing)
      this.forgetWorkspace(key)
      return
    }
    if (!this.physicallyReleasedWorkspaces.has(key)) {
      try {
        await allocation.release()
      } catch (error: unknown) {
        if (error instanceof TeamWorkspaceLostError) {
          releasing = await this.recordWorkspaceLoss(releasing, error.loss)
          if (error.loss.terminationProven) {
            releasing = await this.requestWorkspaceAllocationRelease(releasing)
            await allocation.release()
          }
          else {
            this.workspaceSnapshots.set(key, releasing)
            this.detachWorkspaceScope(key)
            return
          }
        } else {
          releasing = await this.preserveWorkspaceAllocation(releasing, workspacePreservationReason('WORKSPACE_RELEASE_FAILED', error))
          this.workspaceSnapshots.set(key, releasing)
          this.forgetWorkspace(key)
          return
        }
      }
      this.physicallyReleasedWorkspaces.add(key)
    }
    try {
      releasing = await this.confirmWorkspaceAllocationRelease(releasing)
      this.workspaceSnapshots.set(key, releasing)
      this.forgetWorkspace(key)
    } catch (error: unknown) {
      this.workspaceSnapshots.set(key, releasing)
      this.detachWorkspaceScope(key)
      if (error instanceof TeamError) throw error
      try {
        releasing = await this.reconcileWorkspaceRelease(this.requireWorkspaceRegistry(), releasing)
        this.workspaceSnapshots.set(key, releasing)
        this.forgetWorkspace(key)
      } catch (reconciliation: unknown) {
        throw new AggregateError([error, reconciliation], `team-agent-client: workspace '${releasing.id}' release confirmation failed`)
      }
    }
  }

  /** Reconcile a release-requested provider resource, then confirm its existing durable release intent. */
  private async reconcileWorkspaceRelease(
    workspaces: TeamWorkspaceRegistry,
    snapshot: TeamWorkspaceAllocationSnapshot,
  ): Promise<TeamWorkspaceAllocationSnapshot> {
    const request: TeamWorkspacePrepareRequest = {
      teamId: snapshot.teamId,
      taskId: snapshot.taskId,
      attemptId: snapshot.attemptId,
      assignedRevision: snapshot.assignedRevision,
      participantId: snapshot.participantId,
      activationId: snapshot.activationId,
      sessionId: snapshot.sessionId,
    }
    let releasing = snapshot
    try { await workspaces.reconcileRelease(snapshot.mode, request, workspaceMetadata(snapshot)) } catch (error: unknown) {
      if (!(error instanceof TeamWorkspaceLostError)) throw error
      releasing = await this.recordWorkspaceLoss(snapshot, error.loss)
      if (!error.loss.terminationProven) throw error
      releasing = await this.requestWorkspaceAllocationRelease(releasing)
      await workspaces.reconcileRelease(snapshot.mode, request, workspaceMetadata(releasing))
    }
    return await this.confirmWorkspaceAllocationRelease(releasing)
  }

  /** Settle provider cleanup for an allocation that cannot publish its Agent root. */
  private async cleanupUnpublishedWorkspace(
    cleanup: () => Promise<void>,
    snapshot: TeamWorkspaceAllocationSnapshot,
    dispose: (() => void) | undefined,
    original: unknown,
  ): Promise<void> {
    let releasing: TeamWorkspaceAllocationSnapshot = snapshot
    let physicallyReleased = false
    try {
      releasing = await this.requestWorkspaceAllocationRelease(snapshot)
      await cleanup()
      physicallyReleased = true
      await this.confirmWorkspaceAllocationRelease(releasing)
    } catch (cleanup: unknown) {
      if (!physicallyReleased) {
        try {
          await this.preserveWorkspaceAllocation(releasing, workspacePreservationReason('WORKSPACE_PUBLICATION_FAILED', cleanup))
        } catch (preservation: unknown) {
          throw new AggregateError([original, cleanup, preservation], 'team-agent-client: workspace publication cleanup failed')
        }
      }
      throw new AggregateError([original, cleanup], 'team-agent-client: workspace publication cleanup failed')
    } finally {
      dispose?.()
      this.markWorkspaceAllocationFailure()
    }
  }

  /** Observe durable release requests that terminal task, expiry, cancellation, or activation paths emit. */
  private observeWorkspaceAllocation(snapshot: TeamWorkspaceAllocationSnapshot): void {
    if (snapshot.teamId !== this.binding.teamId
      || snapshot.participantId !== this.binding.participantId
      || snapshot.activationId !== this.binding.activationId
      || snapshot.sessionId !== this.binding.sessionId) return
    const key = this.workspaceKeysById.get(snapshot.id)
    if (key === undefined) return
    this.workspaceSnapshots.set(key, snapshot)
    if (snapshot.lifecycle === 'release-requested') this.releaseWorkspace(key)
    if (snapshot.lifecycle === 'unavailable') this.installUnavailableWorkspaceScope()
    if (snapshot.lifecycle === 'released' || snapshot.lifecycle === 'preserved') this.forgetWorkspace(key)
  }

  /** Reopen an active or reserved allocation before this binding accepts another waking task delivery. */
  private async recoverWorkspaces(): Promise<void> {
    // Until the durable allocation scan completes, an Agent may be resuming a
    // task root that is not yet scoped locally.
    this.installUnavailableWorkspaceScope()
    const teams = this.requireWorkspaceTeams()
    const workspaces = this.ctx.get('teamWorkspaces') as TeamWorkspaceRegistry
    const state = await teams.getTeam({ teamId: this.binding.teamId })
    const allocations = state.workspaceAllocations.filter(allocation => (
      allocation.participantId === this.binding.participantId
      && allocation.activationId === this.binding.activationId
      && allocation.sessionId === this.binding.sessionId
      && allocation.lifecycle !== 'released'
    ))
    if (allocations.length === 0) {
      this.clearUnavailableWorkspaceScope()
      return
    }
    let retainsUnavailableScope = false
    for (const snapshot of allocations) {
      if (snapshot.loss !== undefined && (snapshot.lifecycle === 'unavailable' || snapshot.loss.terminationProven)) {
        await this.settleWorkspaceLoss(snapshot, snapshot.loss)
        continue
      }
      if (snapshot.lifecycle === 'preserved') {
        retainsUnavailableScope = true
        continue
      }
      if (snapshot.lifecycle === 'release-requested') {
        try {
          await this.reconcileWorkspaceRelease(workspaces, snapshot)
        } catch (error: unknown) {
          try {
            await this.preserveWorkspaceAllocation(snapshot, workspacePreservationReason('WORKSPACE_RELEASE_RECONCILIATION_FAILED', error))
          } catch (preservation: unknown) {
            throw new AggregateError([error, preservation], `team-agent-client: workspace '${snapshot.id}' release reconciliation failed`)
          }
          throw error
        }
        continue
      }
      const request: TeamWorkspacePrepareRequest = {
        teamId: snapshot.teamId,
        taskId: snapshot.taskId,
        attemptId: snapshot.attemptId,
        assignedRevision: snapshot.assignedRevision,
        participantId: snapshot.participantId,
        activationId: snapshot.activationId,
        sessionId: snapshot.sessionId,
      }
      let allocation: TeamWorkspaceAllocation | undefined
      let active = snapshot
      let dispose: (() => void) | undefined
      try {
        allocation = await workspaces.restore(snapshot.mode, request, workspaceMetadata(snapshot))
        if (this.isCurrentBinding(this.binding) && snapshot.lifecycle === 'reserved') active = await this.activateWorkspaceAllocation(snapshot)
        if (this.isCurrentBinding(this.binding)) {
          const key = workspaceKey(snapshot.taskId, snapshot.attemptId)
          dispose = this.requireWorkspaceLease().publishRoot(allocation.root)
          this.workspaceAllocations.set(key, allocation)
          this.watchWorkspaceLoss(key, allocation)
          this.workspaceSnapshots.set(key, active)
          this.workspaceKeysById.set(active.id, key)
          this.workspaceDisposers.set(key, dispose)
        }
      } catch (error: unknown) {
        retainsUnavailableScope = true
        if (error instanceof TeamWorkspaceLostError) {
          await this.settleWorkspaceLoss(snapshot, error.loss)
          continue
        }
        if (allocation !== undefined) {
          await this.cleanupUnpublishedWorkspace(allocation.release.bind(allocation), active, dispose, error)
          throw error
        }
        try {
          await this.preserveWorkspaceAllocation(snapshot, workspacePreservationReason('WORKSPACE_RECOVERY_FAILED', error))
        } catch (preservation: unknown) {
          throw new AggregateError([error, preservation], `team-agent-client: workspace '${snapshot.id}' recovery preservation failed`)
        }
        throw error
      }
      if (!this.isCurrentBinding(this.binding)) {
        await this.cleanupUnpublishedWorkspace(allocation.release.bind(allocation), active, dispose,
          new Error('team-agent-client: workspace recovery was cancelled during disposal'))
        return
      }
    }
    if (this.workspaceAllocations.size > 0 && !retainsUnavailableScope) {
      this.workspaceAllocationFailed = false
      this.clearUnavailableWorkspaceScope()
    } else if (this.workspaceAllocations.size === 0 && !retainsUnavailableScope && !this.workspaceAllocationFailed) {
      this.clearUnavailableWorkspaceScope()
    } else {
      this.installUnavailableWorkspaceScope()
    }
  }

  /** Remove a released or preserved root from model-facing scope. */
  private forgetWorkspace(key: string): void {
    this.workspaceLossDisposers.get(key)?.()
    this.workspaceLossDisposers.delete(key)
    this.detachWorkspaceScope(key)
    const snapshot = this.workspaceSnapshots.get(key) as TeamWorkspaceAllocationSnapshot
    this.workspaceAllocations.delete(key)
    this.physicallyReleasedWorkspaces.delete(key)
    this.workspaceSnapshots.delete(key)
    this.workspaceDisposers.delete(key)
    this.workspaceKeysById.delete(snapshot.id)
    if (this.workspaceAllocations.size > 0) return
    if (snapshot.lifecycle !== 'released' || this.workspaceAllocationFailed) {
      this.installUnavailableWorkspaceScope()
      return
    }
    this.clearUnavailableWorkspaceScope()
  }

  /** Remove one live root contribution without allowing its Session cwd to become an implicit task fallback. */
  private detachWorkspaceScope(key: string): void {
    const dispose = this.workspaceDisposers.get(key)
    this.workspaceDisposers.delete(key)
    dispose?.()
  }

  /** Install an explicit invalid Agent-keyed value consumed by `resolveAgentWorkspaceRoot()` as fail-closed. */
  private installUnavailableWorkspaceScope(): void {
    if (this.closing) return
    this.workspaceUnavailableDisposer?.()
    this.workspaceUnavailableDisposer = this.requireWorkspaceLease().markUnavailable()
  }

  /** Retain the fail-closed marker after a task assignment cannot obtain its promised execution root. */
  private markWorkspaceAllocationFailure(): void {
    this.workspaceAllocationFailed = true
    this.installUnavailableWorkspaceScope()
  }

  /** Remove a temporary unavailable marker once no unfinished task root requires it. */
  private clearUnavailableWorkspaceScope(): void {
    if (this.closing) return
    this.workspaceUnavailableDisposer?.()
    this.workspaceUnavailableDisposer = undefined
  }

  /** Resolve local Team authority only for the explicitly local workspace-consumption path. */
  private requireWorkspaceTeams(): TeamRuntime {
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new TeamError('team-agent-client workspace consumption requires local Team authority', 'TEAM_INVALID_ARGUMENT')
    return teams
  }

  /** Resolve the local registry required to prove a previously requested physical release. */
  private requireWorkspaceRegistry(): TeamWorkspaceRegistry {
    const workspaces = this.ctx.get('teamWorkspaces')
    if (workspaces === undefined) throw new TeamError('team-agent-client workspace registry is unavailable', 'TEAM_INVALID_ARGUMENT')
    return workspaces
  }

  /** Return the Agent-keyed lease that owns this delivery's workspace root and activation cleanup. */
  private requireWorkspaceLease(): AgentWorkspaceLease {
    return this.workspaceLease as AgentWorkspaceLease
  }

  /** Retain one private source registration for this fixed delivery's exact local lifetime. */
  private requireWorkspaceAuthority(): WorkspaceAllocationAuthority {
    const existing = this.workspaceAuthority
    if (existing !== undefined) return existing
    const authority = new WorkspaceAllocationAuthority(
      this.requireWorkspaceTeams(),
      `team-agent-client-workspace-${String(nextWorkspaceAllocationAuthority++)}`,
    )
    this.workspaceAuthority = authority
    return authority
  }

  /** Revoke a closed consumer only after admitted work and every mapped provider allocation settle. */
  private releaseClosedWorkspaceOwnership(): void {
    if (!this.closeAdmissionSettled || this.workspaceAllocations.size > 0 || this.workspaceReleaseOperations.size > 0) return
    this.preStepListener?.()
    this.preStepListener = undefined
    this.workspaceUnavailableDisposer?.()
    this.workspaceUnavailableDisposer = undefined
    this.workspaceAuthority?.close()
    this.workspaceAuthority = undefined
    this.workspaceLease?.dispose()
    this.workspaceLease = undefined
  }

  /** Await bounded settlement after rejecting all future delivery admission. */
  private async dispose(): Promise<void> {
    this.closing = true
    if (this.workspaceLease !== undefined) {
      this.workspaceUnavailableDisposer?.()
      this.workspaceUnavailableDisposer = this.workspaceLease.markUnavailable()
    }
    this.unregisterBoundLinkBorrower?.()
    this.unregisterBoundLinkBorrower = undefined
    for (const dispose of this.listeners.splice(0)) dispose()
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer)
    this.reconnectTimers.clear()
    this.bindings.clear()
    const connections = [...this.connections.values()]
    this.connections.clear()
    for (const connection of connections) this.disconnect(connection)
    for (const key of [...this.workspaceAllocations.keys()]) this.releaseWorkspace(key)
    const accepted = [...this.accepted]
    for (const barrier of this.flushBarriers.values()) {
      barrier.reject(new Error('team-agent-client: delivery barriers were cancelled during disposal'))
    }
    const settled = Promise.allSettled(accepted).then((results) => {
      this.closeAdmissionSettled = true
      this.flushBarriers.clear()
      this.flushedEnvelopeSources.clear()
      this.claimedChannelViews.clear()
      this.releaseClosedWorkspaceOwnership()
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => result.reason as unknown)
      if (failures.length > 0) throw new AggregateError(failures, 'Team Agent Client disposal failed')
    })
    // A timeout reports incomplete shutdown; accepted provider work still owns
    // its proof source and workspace lease until settlement releases them.
    await withTimeout(settled, this.disposalTimeoutMs)
  }
}

/** Discovers live local Agent bindings and delegates each to a fixed-binding delivery consumer. */
export class TeamAgentClient {
  private readonly bindings = new Map<string, Binding>()
  private readonly usageActorLeases = new Map<Binding, TeamActorProofLease>()
  private readonly deliveries = new Map<string, FixedBindingTeamAgentLinkDelivery>()
  private readonly closingDeliveries = new Set<Promise<void>>()
  private readonly listeners: (() => void)[] = []
  private readonly config: ResolvedConfig
  private readonly usageActorProofIssuer: ActivationActorProofIssuer
  private started = false
  private closing = false
  private disposal: Promise<void> | undefined

  /**
   * @param ctx - Context carrying Team discovery plus Link, Agent, and Session services.
   * @param config - Link-provider, reconnection, and local-delivery shutdown limits.
   */
  constructor(private readonly ctx: Context, config: Config = {}) {
    this.config = resolveConfig(config)
    this.usageActorProofIssuer = ctx.teams.openActivationActorProofIssuer()
  }

  /** Subscribe before reconciling already-live Agents against durable activation bindings. */
  start(): void {
    if (this.started || this.closing) return
    this.started = true
    this.listeners.push(this.ctx.on('team/changed', (event) => {
      if (event.type === 'activation/changed') this.reconcileBinding(event.binding)
      if (event.type === 'participant/changed') this.reconcileParticipant(event.participant)
      if (event.type === 'task/changed') {
        const attempt = event.task.attemptHistory.at(-1)
        if (attempt === undefined || event.task.phase === 'assigned' || event.task.phase === 'running') return
        const delivery = this.deliveries.get(bindingKey(event.task.teamId, attempt.participantId))
        if (delivery !== undefined && attempt.activationId === delivery.activationId) {
          delivery.releaseTaskAllocation(event.task.id, attempt.id)
        }
      }
    }))
    this.listeners.push(this.ctx.on('agent/created', ({ agent }) => {
      this.scheduleReconciliation(agent)
    }))
    this.listeners.push(this.ctx.on('agent/disposed', ({ agent }) => {
      this.unbind(agent)
    }))
    this.listeners.push(this.ctx.on('session/event', (session, event) => {
      const binding = [...this.bindings.values()].find(candidate => candidate.sessionId === session.id)
      if (binding === undefined) return
      const delivery = this.deliveries.get(bindingKey(binding.teamId, binding.participantId))
      if (delivery === undefined) return
      if (event.type === 'turn/end') delivery.observeTurnEnd(event)
      if (event.type !== 'assistant/message' || event.data.usage === undefined) return
      const usage = event.data.usage
      const taskProvenance = delivery.workspaceUsageProvenance() ?? {}
      const sample: TeamUsageSampleInput = {
        id: teamUsageSampleIdSchema.parse(`${String(session.id)}:${String(event.data.turn)}:${String(event.data.step)}`),
        provider: event.data.message.source.provider,
        model: event.data.message.source.model,
        turn: event.data.turn,
        step: event.data.step,
        ...taskProvenance,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          ...usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: usage.cacheReadTokens },
          ...usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens },
          ...usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens },
        },
      }
      void this.recordUsage(sample, binding).catch((error: unknown) => {
        if (!this.closing) this.ctx.logger.warn(`team-agent-client: usage sample '${String(sample.id)}' failed: ${renderError(error)}`)
      })
    }))
    for (const agent of this.ctx.agents.list()) this.scheduleReconciliation(agent)
  }

  /** Stop discovery and await every fixed-binding delivery that this wrapper released. */
  close(): Promise<void> {
    this.disposal ??= this.dispose()
    return this.disposal
  }

  /** Schedule durable activation reconciliation for one local Agent. */
  private scheduleReconciliation(agent: Agent): void {
    const operation = this.reconcile(agent)
    void operation.catch((error: unknown) => {
      if (!this.closing) this.ctx.logger.warn(
        `team-agent-client: Agent '${agent.id}' activation reconciliation failed: ${renderError(error)}`,
      )
    })
  }

  /** Reconcile one live Agent against the current durable binding for its Session provenance. */
  private async reconcile(agent: Agent): Promise<void> {
    if (this.closing) return
    const provenance = agentProvenance(agent)
    if (provenance === undefined || this.ctx.agents.get(agent.id) !== agent) {
      this.unbind(agent)
      return
    }
    const team = await this.ctx.teams.getTeam({ teamId: provenance.teamId })
    if (
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- close() can run while getTeam() is pending.
      this.closing || this.ctx.agents.get(agent.id) !== agent
    ) {
      this.unbind(agent)
      return
    }
    const activation = deliverableActivation(team, provenance.participantId, agent.session.id)
    if (activation === undefined) {
      this.unbind(agent)
      return
    }
    this.bind(agent, provenance.teamId, provenance.participantId, activation)
  }

  /** Record one local Agent usage sample with a short cursor-retry loop. */
  private async recordUsage(sample: TeamUsageSampleInput, binding: Binding): Promise<void> {
    const lease = this.usageActorLeases.get(binding) as TeamActorProofLease
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = await this.ctx.teams.getTeam({ teamId: binding.teamId })
      try {
        await this.ctx.teams.recordUsage({ actor: lease.proof, expectedCursor: state.team.cursor, sample })
        return
      } catch (error: unknown) {
        if (error instanceof TeamError && error.code === 'TEAM_CURSOR_CONFLICT') continue
        if (!this.closing) this.ctx.logger.warn(`team-agent-client: usage sample '${String(sample.id)}' was not recorded: ${renderError(error)}`)
        return
      }
    }
    if (!this.closing) this.ctx.logger.warn(`team-agent-client: usage sample '${String(sample.id)}' cursor kept changing`)
  }

  /** Reconcile an accepted binding once its exact local Agent becomes live. */
  private reconcileBinding(binding: ActivationBindingSnapshot): void {
    const agent = this.ctx.agents.get(binding.sessionId)
    if (agent !== undefined) this.scheduleReconciliation(agent)
  }

  /** Release a local delivery and usage lease when its participant loses activation eligibility. */
  private reconcileParticipant(participant: ParticipantSnapshot): void {
    const key = bindingKey(participant.teamId, participant.id)
    const binding = this.bindings.get(key)
    if (binding === undefined) return
    if (!isDeliverableParticipant(participant)) {
      this.releaseBinding(key, binding)
      return
    }
    this.scheduleReconciliation(binding.agent)
  }

  /** Create one fixed delivery owner after the local discovery check accepts its binding. */
  private bind(
    agent: Agent,
    teamId: TeamId,
    participantId: ParticipantId,
    activation: ActivationBindingSnapshot,
  ): void {
    if (this.closing
      || activation.activation.teamId !== teamId
      || activation.activation.participantId !== participantId
      || activation.sessionId !== agent.session.id
      || !isDeliverableActivation(activation.activation.status)) return
    const key = bindingKey(teamId, participantId)
    const current = this.bindings.get(key)
    if (current?.agent === agent && current.activationId === activation.activation.id) return
    if (current !== undefined) this.releaseBinding(key, current)
    const binding = bindingFor(agent, activation)
    const delivery = new FixedBindingTeamAgentLinkDelivery(this.ctx, { agent, binding: activation }, this.config)
    const usageLease = this.usageActorProofIssuer.issue(activation)
    this.usageActorLeases.set(binding, usageLease)
    this.bindings.set(key, binding)
    this.deliveries.set(key, delivery)
    try {
      delivery.start()
    } catch (error: unknown) {
      this.bindings.delete(key)
      this.deliveries.delete(key)
      this.usageActorLeases.delete(binding)
      usageLease.revoke()
      // start() throws only before admitting provider work, so rollback has
      // no backend failures to await or report.
      void delivery.close()
      throw error
    }
  }

  /** Stop the delivery owner for an Agent that lost its locally discovered binding. */
  private unbind(agent: Agent): void {
    for (const [key, binding] of this.bindings) {
      if (binding.agent === agent) this.releaseBinding(key, binding)
    }
  }

  /** Close one exact delivery owner without awaiting a later binding replacement. */
  private releaseBinding(key: string, binding: Binding): void {
    if (this.bindings.get(key) !== binding) return
    this.bindings.delete(key)
    this.usageActorLeases.get(binding)?.revoke()
    this.usageActorLeases.delete(binding)
    const delivery = this.deliveries.get(key)
    this.deliveries.delete(key)
    if (delivery !== undefined) this.trackDeliveryClose(delivery)
  }

  /** Retain a released delivery until its Link and barriers have reached quiescence. */
  private trackDeliveryClose(delivery: FixedBindingTeamAgentLinkDelivery): void {
    const closing = delivery.close()
    this.closingDeliveries.add(closing)
    void closing.then(
      () => { this.closingDeliveries.delete(closing) },
      (error: unknown) => {
        this.closingDeliveries.delete(closing)
        if (!this.closing) this.ctx.logger.warn(`team-agent-client: released binding close failed: ${renderError(error)}`)
      },
    )
  }

  /** Await discovery teardown and all fixed delivery owners. */
  private async dispose(): Promise<void> {
    this.closing = true
    for (const dispose of this.listeners.splice(0)) dispose()
    const pending = new Set<Promise<void>>(this.closingDeliveries)
    for (const delivery of this.deliveries.values()) pending.add(delivery.close())
    for (const lease of this.usageActorLeases.values()) lease.revoke()
    this.usageActorLeases.clear()
    this.usageActorProofIssuer.close()
    this.bindings.clear()
    this.deliveries.clear()
    const settled = await Promise.allSettled(pending)
    const failures: unknown[] = []
    for (const result of settled) {
      if (result.status === 'rejected') failures.push(result.reason)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Team Agent Client disposal failed')
  }
}

/** Install one local Team-binding discovery wrapper in the containing Cordis fiber. */
export function apply(ctx: Context, config: Config = {}): () => Promise<void> {
  const client = new TeamAgentClient(ctx, config)
  client.start()
  return () => client.close()
}

/** Create one opaque token that cannot cross a wire or durable boundary. */
function createWorkspaceAllocationProof(): TeamSystemWorkspaceAllocationProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team workspace allocation proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemWorkspaceAllocationProof
}

/** Project root-free provider preparation fields into the exact Hub reservation metadata form. */
function workspaceBindingMetadata(preparation: TeamWorkspacePreparation) {
  return {
    id: preparation.id,
    provider: preparation.provider,
    mode: preparation.mode,
    assignedRevision: preparation.assignedRevision,
    participantId: preparation.participantId,
    activationId: preparation.activationId,
    sessionId: preparation.sessionId,
    ...preparation.baseVersion === undefined ? {} : { baseVersion: preparation.baseVersion },
    ...preparation.executionWorld === undefined ? {} : { executionWorld: preparation.executionWorld },
  }
}

/** Project one durable allocation snapshot into root-free provider recovery metadata. */
function workspaceMetadata(snapshot: TeamWorkspaceAllocationSnapshot): TeamWorkspaceAllocationMetadata {
  return {
    id: snapshot.id,
    provider: snapshot.provider,
    mode: snapshot.mode,
    teamId: snapshot.teamId,
    taskId: snapshot.taskId,
    attemptId: snapshot.attemptId,
    assignedRevision: snapshot.assignedRevision,
    participantId: snapshot.participantId,
    activationId: snapshot.activationId,
    sessionId: snapshot.sessionId,
    ...snapshot.baseVersion === undefined ? {} : { baseVersion: snapshot.baseVersion },
    ...snapshot.executionWorld === undefined ? {} : { executionWorld: snapshot.executionWorld },
  }
}

/** Retain a bounded diagnostic reason when a provider resource cannot reach normal cleanup. */
function workspacePreservationReason(code: string, error: unknown): { readonly code: string; readonly message: string } {
  return { code, message: renderError(error) }
}

/** Resolve the exact stable map key without delimiter collisions. */
function bindingKey(teamId: TeamId, participantId: ParticipantId): string {
  return JSON.stringify([teamId, participantId])
}

/** Read a complete Team participant pair from one local Agent's Session header. */
function agentProvenance(agent: Agent): { readonly teamId: TeamId; readonly participantId: ParticipantId } | undefined {
  const teamId = teamIdSchema.safeParse(agent.session.header.teamId)
  const participantId = participantIdSchema.safeParse(agent.session.header.participantId)
  return teamId.success && participantId.success ? { teamId: teamId.data, participantId: participantId.data } : undefined
}

/** Return whether one durable residency state can still receive local channel input. */
function isDeliverableActivation(status: ActivationBindingSnapshot['activation']['status']): boolean {
  return status === 'idle' || status === 'running'
}

/** Return whether one active agent participant may own locally delivered activation work. */
function isDeliverableParticipant(participant: ParticipantSnapshot | undefined): boolean {
  return participant?.phase === 'active'
    && (participant.kind === 'local-agent' || participant.kind === 'remote-agent')
}

/** Locate the sole delivery-authorizing epoch for one local Session participant pair. */
function deliverableActivation(
  team: TeamStateSnapshot,
  participantId: ParticipantId,
  sessionId: Agent['session']['id'],
): ActivationBindingSnapshot | undefined {
  const participant = team.participants.find(candidate => candidate.id === participantId)
  if (!isDeliverableParticipant(participant)) return undefined
  return team.activations.find(binding => binding.activation.participantId === participantId
    && binding.activation.teamId === team.team.id
    && binding.sessionId === sessionId
    && isDeliverableActivation(binding.activation.status))
}

/** Match an exact durable activation epoch before placing model-visible local input. */
function bindingMatchesActivation(binding: Binding, activation: ActivationBindingSnapshot): boolean {
  return activation.activation.id === binding.activationId
    && activation.activation.teamId === binding.teamId
    && activation.activation.participantId === binding.participantId
    && activation.sessionId === binding.sessionId
    && isDeliverableActivation(activation.activation.status)
}

/** Verify that a Link notification targets this exact durable local binding. */
function interruptMatchesBinding(notification: TeamLinkInterruptNotification, binding: Binding): boolean {
  const target = notification.interrupt.target
  return notification.interrupt.acknowledgedAt === undefined
    && target.teamId === binding.teamId
    && target.participantId === binding.participantId
    && target.activationId === binding.activationId
    && target.sessionId === binding.sessionId
    && target.provider === binding.durableBinding.provider
}

/** Verify that a Hub claim still describes this exact local channel delivery. */
function claimMatchesDelivery(binding: Binding, envelope: TeamEnvelope, claim: ChannelDeliveryClaim): boolean {
  return claim.envelopeId === envelope.id
    && claim.delivery === envelope.delivery
    && bindingMatchesActivation(binding, claim.binding)
    && (claim.channel.phase === 'active' || claim.channel.phase === 'closed')
    && claim.channel.manifest.id === envelope.channelId
    && claim.channel.manifest.teamId === envelope.teamId
}

/** Verify that a generic channel claim was derived for this recipient's audience. */
function claimMatchesChannelRecipient(binding: Binding, envelope: TeamEnvelope, claim: ChannelDeliveryClaim): boolean {
  return claimMatchesDelivery(binding, envelope, claim)
    && (envelope.audience === null || envelope.audience.includes(binding.participantId))
}

/** Verify that a Hub-supplied non-direct view is the exact pending delivery selected by this claim. */
function claimViewMatchesDelivery(
  view: TeamChannelViewEventData,
  envelope: TeamEnvelope,
  claim: ChannelDeliveryClaim,
): boolean {
  const manifest = claim.channel.manifest
  if (view.sourceEnvelopeIds.length === 0
    || new Set(view.sourceEnvelopeIds).size !== view.sourceEnvelopeIds.length
    || view.sourceEnvelopeIds.at(-1) !== envelope.id
    || view.content.length === 0) return false
  if (view.teamId !== envelope.teamId || view.channelId !== envelope.channelId) return false
  if (view.taskId !== envelope.taskId || view.causationId !== envelope.causationId) return false
  if (envelope.kind === 'review-request') {
    const payload = envelope.payload as Record<string, unknown>
    const review = view.review
    if (review === undefined
      || review.attemptId !== payload['attemptId']
      || review.reviewRevision !== payload['reviewRevision']
      || review.reviewerId !== payload['reviewerId']
      || review.initiatorId !== payload['initiatorId']) return false
  } else if (view.review !== undefined) {
    return false
  }
  return view.teamId === envelope.teamId
    && view.channelId === envelope.channelId
    && view.triggeringEnvelopeId === envelope.id
    && view.delivery === claim.delivery
    && view.adapter.type === manifest.adapter.type
    && view.adapter.version === manifest.adapter.version
    && manifest.viewPolicy !== undefined
    && view.viewPolicy.type === manifest.viewPolicy.type
    && view.viewPolicy.version === manifest.viewPolicy.version
}

/** Verify the protocol-specific facts required before direct input reaches an Agent inbox. */
function claimMatchesDirectDelivery(binding: Binding, envelope: TeamEnvelope, claim: ChannelDeliveryClaim): boolean {
  return claimMatchesDelivery(binding, envelope, claim)
    && isDirectChannel(claim.channel, envelope)
    && channelRecipientMatches(claim.channel, envelope, binding.participantId)
    && (adapterKey(claim.channel.manifest.adapter) === DIRECT_CHANNEL_V4_KEY
      ? binding.participantId !== envelope.senderId && (envelope.audience === null || envelope.audience.includes(binding.participantId))
      : singleRecipient(envelope) === binding.participantId)
}

/** Return the sole recipient only for the direct protocol's explicit unicast form. */
function singleRecipient(envelope: TeamEnvelope): ParticipantId | undefined {
  return envelope.audience !== null && envelope.audience.length === 1 ? envelope.audience[0] : undefined
}

/** Recognize ordinary messages on supported direct protocols without admitting direct final answers to local Agents. */
function isDirectChannel(channel: ChannelSnapshot, envelope: TeamEnvelope): boolean {
  if (envelope.kind !== DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND) return false
  switch (adapterKey(channel.manifest.adapter)) {
    case DIRECT_CHANNEL_V1_KEY:
      return true
    case DIRECT_CHANNEL_V2_KEY:
      try {
        parseDirectChannelV2Manifest(channel.manifest)
        return true
      } catch {
        return false
      }
    case DIRECT_CHANNEL_V3_KEY:
      try {
        parseDirectChannelV3Manifest(channel.manifest)
        return true
      } catch {
        return false
      }
    case DIRECT_CHANNEL_V4_KEY:
      try {
        directChannelV4Recipients(channel.manifest, envelope.senderId, envelope.audience)
        return true
      } catch {
        return false
      }
    default:
      return false
  }
}

/** Recognize a supported direct adapter even when its current Envelope is a final or another non-inbox kind. */
function isDirectProtocolChannel(channel: ChannelSnapshot): boolean {
  switch (adapterKey(channel.manifest.adapter)) {
    case DIRECT_CHANNEL_V1_KEY:
    case DIRECT_CHANNEL_V2_KEY:
    case DIRECT_CHANNEL_V3_KEY:
    case DIRECT_CHANNEL_V4_KEY:
      return true
    default:
      return false
  }
}

/** Serialize one adapter identity for exact protocol selection without type or version coercion. */
function adapterKey(adapter: ChannelSnapshot['manifest']['adapter']): string {
  return JSON.stringify([adapter.type, adapter.version])
}

/** Recognize the exact task-assignment protocol before handing its payload to the parser. */
function isTaskAssignmentChannel(channel: ChannelSnapshot): boolean {
  return channel.manifest.adapter.type === TASK_ASSIGNMENT_CHANNEL_TYPE
    && channel.manifest.adapter.version === TASK_ASSIGNMENT_CHANNEL_VERSION
}

/** Ensure the task-assignment manifest routes this delivery to the exact current local binding. */
function assignmentMatchesBinding(assignment: TaskAssignmentEnvelope, binding: Binding): boolean {
  return assignment.teamId === binding.teamId
    && assignment.assigneeId === binding.participantId
    && assignment.activationId === binding.activationId
    && assignment.sessionId === binding.sessionId
}

/** Verify that the Link-bound start claim returned the current exact running task attempt. */
function startedTaskMatchesAssignment(
  task: TeamTaskSnapshot,
  assignment: TaskAssignmentEnvelope,
  binding: Binding,
): task is TeamTaskSnapshot & { readonly lease: TaskLeaseSnapshot } {
  const lease = task.lease
  return task.id === assignment.taskId
    && task.teamId === assignment.teamId
    && task.phase === 'running'
    && lease !== undefined
    && lease.attemptId === assignment.attemptId
    && lease.assignedRevision === assignment.assignedRevision
    && lease.participantId === binding.participantId
    && lease.activationId === binding.activationId
    && lease.wakeChannelId === assignment.channelId
    && lease.startedAt !== undefined
}

/** Verify that the target remains visible in the direct channel manifest. */
function channelRecipientMatches(channel: ChannelSnapshot, envelope: TeamEnvelope, recipientId: ParticipantId): boolean {
  return channel.manifest.teamId === envelope.teamId
    && channel.manifest.participants.some(participant => participant.id === envelope.senderId)
    && channel.manifest.participants.some(participant => participant.id === recipientId)
}

/** Resolve the per-recipient key for a pending Envelope persistence barrier. */
function flushBarrierKey(sessionId: Agent['session']['id'], envelopeId: string): string {
  return JSON.stringify([sessionId, envelopeId])
}

/** Stable local key for one task attempt workspace allocation. */
function workspaceKey(taskId: string, attemptId: string): string {
  return JSON.stringify([taskId, attemptId])
}

/** Extract the direct adapter's stable text payload from a durable JSON Envelope. */
function directText(envelope: TeamEnvelope): string | undefined {
  const text = envelope.payload.text
  return typeof text === 'string' && text.length > 0 ? text : undefined
}

/** Render one validated direct Envelope without admitting product final answers. */
function directMessage(channel: ChannelSnapshot, envelope: TeamEnvelope): UserMessage | undefined {
  switch (adapterKey(channel.manifest.adapter)) {
    case DIRECT_CHANNEL_V1_KEY:
    case DIRECT_CHANNEL_V2_KEY: {
      const text = directText(envelope)
      return text === undefined ? undefined : envelopeMessage(envelope, text)
    }
    case DIRECT_CHANNEL_V3_KEY:
      try {
        return directV3EnvelopeMessage(envelope, parseDirectChannelV3MessagePayload(envelope.payload).content)
      } catch {
        return undefined
      }
    case DIRECT_CHANNEL_V4_KEY:
      try {
        return directV3EnvelopeMessage(envelope, parseDirectChannelV4MessagePayload(envelope.payload).content)
      } catch {
        return undefined
      }
    /* v8 ignore next 2 -- isDirectChannel has already selected a supported direct adapter. */
    default:
      return undefined
  }
}

/** Build the exact durable message the direct recipient sees in its Agent inbox. */
function envelopeMessage(envelope: TeamEnvelope, text: string): UserMessage {
  return envelopeContentMessage(envelope, [{
    type: 'text',
    text: `Direct message from ${envelope.senderId}:\n${text}`,
  }])
}

/** Build one direct v3 message whose ordered human content follows its durable sender prefix. */
function directV3EnvelopeMessage(
  envelope: TeamEnvelope,
  content: ReturnType<typeof parseDirectChannelV3MessagePayload>['content'],
): UserMessage {
  return envelopeContentMessage(envelope, [
    { type: 'text', text: `Direct message from ${envelope.senderId}:\n` },
    ...content,
  ])
}

/** Attach immutable Team provenance to one complete direct message content sequence. */
function envelopeContentMessage(envelope: TeamEnvelope, content: UserMessage['content']): UserMessage {
  return freezeMessage({
    id: MessageId(`team-envelope:${envelope.id}`),
    role: 'user',
    content,
    source: {
      kind: 'team-envelope',
      teamId: envelope.teamId,
      channelId: envelope.channelId,
      envelopeId: envelope.id,
      senderId: envelope.senderId,
      delivery: envelope.delivery,
      ...envelope.causationId === undefined ? {} : { causationId: envelope.causationId },
    },
  })
}

/** Build the exact model-visible task instruction that records its durable assignment provenance. */
function taskAssignmentMessage(
  assignment: TaskAssignmentEnvelope,
  task: TeamTaskSnapshot & { readonly lease: TaskLeaseSnapshot },
  activationId: ActivationId,
  maxHandoffBytes: number,
  workspaceRoot?: string,
  workspaceAllocationId?: TeamWorkspaceAllocationSnapshot['id'],
): UserMessage {
  const lease = task.lease
  return freezeMessage({
    id: MessageId(`team-task-assignment:${assignment.envelopeId}`),
    role: 'user',
    content: [{
      type: 'text',
      text: `Team task assignment: ${task.subject}\n\n${task.description}\n\nTask: ${task.id}\nAttempt: ${lease.attemptId}`
        + (workspaceRoot === undefined ? '' : `\nWorkspace root: ${workspaceRoot}`)
        + previousAttemptHandoff(task, maxHandoffBytes),
    }],
    source: {
      kind: 'team-task-assignment',
      teamId: assignment.teamId,
      channelId: assignment.channelId,
      envelopeId: assignment.envelopeId,
      taskId: assignment.taskId,
      attemptId: assignment.attemptId,
      assignedRevision: assignment.assignedRevision,
      runningRevision: task.revision,
      activationId,
      ...workspaceAllocationId === undefined ? {} : { workspaceAllocationId },
    },
  })
}

/** Check model history and live inbox state without treating a rejected historical splice as admission. */
function envelopeAccepted(agent: Agent, envelopeId: EnvelopeId): boolean {
  for (const event of agent.session.events) {
    if (event.type === 'user/message' && isTeamEnvelopeMessage(event.data, envelopeId)) return true
  }
  return [...agent.inbox.nextStep, ...agent.inbox.nextTurn]
    .some(message => isTeamEnvelopeMessage(message, envelopeId))
}

/** Return the exact stored view committed for one triggering Envelope. */
function recordedChannelView(agent: Agent, envelopeId: EnvelopeId): SessionEvent<'team/channel-view'> | undefined {
  return agent.session.events.find((event): event is SessionEvent<'team/channel-view'> => (
    event.type === 'team/channel-view' && event.data.triggeringEnvelopeId === envelopeId
  ))
}

/** Return whether the stored view was claimed by a durable inbox splice and entered that turn's step. */
function channelViewReachedModelStep(agent: Agent, event: SessionEvent<'team/channel-view'>): boolean {
  const message = agent.session.deriveEventMessage(event) as UserMessage
  const nextTurn: UserMessage[] = []
  const nextStep: UserMessage[] = []
  const claimedTurns = new Set<number>()
  let openTurn: number | undefined
  const seedLength = agent.session.header.seedLength ?? 0
  for (const candidate of agent.session.events) {
    if (candidate.seq < seedLength) continue
    if (candidate.type === 'turn/start') {
      openTurn = candidate.data.turn
      continue
    }
    if (candidate.type === 'step/start') {
      if (claimedTurns.has(candidate.data.turn)) return true
      continue
    }
    if (candidate.type === 'turn/end') {
      claimedTurns.delete(candidate.data.turn)
      openTurn = undefined
      continue
    }
    if (candidate.type !== 'agent/inbox/spliced') continue
    const target = candidate.data.target === 'next-turn' ? nextTurn : nextStep
    const removedCount = candidate.data.removedCount ?? 0
    const removed = target.slice(candidate.data.start, candidate.data.start + removedCount)
    if (candidate.seq > event.seq
      && openTurn !== undefined
      && candidate.data.outcome === undefined
      && candidate.data.inserted.length === 0
      && removed.some(candidateMessage => candidateMessage.id === message.id)) {
      claimedTurns.add(openTurn)
    }
    target.splice(candidate.data.start, removedCount, ...candidate.data.inserted)
  }
  return false
}

/** Return whether the exact stored view remains queued for an Agent step. */
function channelViewMessagePending(agent: Agent, envelopeId: EnvelopeId): boolean {
  return [...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(message => (
    message.source.kind === 'team-channel-view' && message.source.triggeringEnvelopeId === envelopeId
  ))
}

/** Return whether a user message carries either supported Team Envelope provenance form. */
function isTeamEnvelopeSource(message: UserMessage): message is UserMessage & {
  readonly source: TeamEnvelopeSource | TeamTaskAssignmentSource | TeamReviewAssignmentSource | TeamChannelViewMessageSource
} {
  return message.source.kind === 'team-envelope'
    || message.source.kind === 'team-task-assignment'
    || message.source.kind === 'team-review-assignment'
    || message.source.kind === 'team-channel-view'
}

/** Return the durable triggering Envelope for every Team-derived inbox source. */
function teamSourceEnvelopeId(
  message: UserMessage & {
    readonly source: TeamEnvelopeSource | TeamTaskAssignmentSource | TeamReviewAssignmentSource | TeamChannelViewMessageSource
  },
): string {
  return message.source.kind === 'team-channel-view'
    ? message.source.triggeringEnvelopeId
    : message.source.envelopeId
}

/** Match one Team-derived message to its globally stable Hub Envelope identity. */
function isTeamEnvelopeMessage(message: UserMessage, envelopeId: EnvelopeId): boolean {
  return isTeamEnvelopeSource(message) && teamSourceEnvelopeId(message) === envelopeId
}

/** Derive the immutable local delivery binding that a Link provider receives unchanged. */
function bindingFor(agent: Agent, durableBinding: ActivationBindingSnapshot): Binding {
  return {
    agent,
    teamId: durableBinding.activation.teamId,
    participantId: durableBinding.activation.participantId,
    activationId: durableBinding.activation.id,
    sessionId: durableBinding.sessionId,
    durableBinding,
  }
}

/** Resolve and validate the configuration shared by discovery and fixed-binding delivery owners. */
function resolveConfig(config: Config): ResolvedConfig {
  const maxTaskReportReminders = config.maxTaskReportReminders ?? DEFAULT_TASK_REPORT_REMINDERS
  if (!Number.isSafeInteger(maxTaskReportReminders) || maxTaskReportReminders < 0) {
    throw new TypeError('maxTaskReportReminders must be a non-negative safe integer')
  }
  const maxTaskHandoffBytes = positiveLimit('maxTaskHandoffBytes', config.maxTaskHandoffBytes ?? DEFAULT_TASK_HANDOFF_BYTES)
  if (maxTaskHandoffBytes < 128) throw new TypeError('maxTaskHandoffBytes must allow at least 128 UTF-8 bytes')
  return {
    maxTaskHandoffBytes,
    maxTaskReportReminders,
    linkProvider: linkProviderName(config.linkProvider ?? DEFAULT_LINK_PROVIDER),
    disposalTimeoutMs: positiveLimit(
      'disposalTimeoutMs',
      config.disposalTimeoutMs ?? DEFAULT_DISPOSAL_TIMEOUT_MS,
    ),
    reconnectDelayMs: positiveLimit(
      'reconnectDelayMs',
      config.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS,
    ),
    workspaceMutationMaxAttempts: positiveLimit(
      'workspaceMutationMaxAttempts',
      config.workspaceMutationMaxAttempts ?? DEFAULT_WORKSPACE_MUTATION_MAX_ATTEMPTS,
    ),
    consumeWorkspace: config.consumeWorkspace ?? false,
    maxTaskOutputContinuations: positiveLimit(
      'maxTaskOutputContinuations',
      config.maxTaskOutputContinuations ?? DEFAULT_TASK_OUTPUT_CONTINUATIONS,
    ),
  }
}

/** Reject an invalid configurable positive integer at plugin construction. */
function positiveLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`team-agent-client: ${name} must be a positive safe integer`)
  }
  return value
}

/** Reject an unusable Team Link provider name at Client construction. */
function linkProviderName(value: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error('team-agent-client: linkProvider must be non-empty without surrounding whitespace')
  }
  return value
}

/** Bound local delivery disposal without retaining a timer after normal settlement. */
async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`team-agent-client: disposal exceeded ${timeoutMs}ms`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Render a contained delivery failure without letting diagnostics throw. */
function renderError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

/** Reconstruct only the selected attempt's claimed turn from the authoritative Session inbox log. */
function taskTurnEvidence(
  events: readonly SessionEvent[],
  teamId: TeamId,
  activationId: ActivationId,
  taskId: string,
  attemptId: string,
): { readonly kind: 'open'; readonly turn: number } | { readonly kind: 'closed' | 'unknown' } {
  const pending: Record<'next-step' | 'next-turn', UserMessage[]> = { 'next-step': [], 'next-turn': [] }
  let open: number | undefined
  let claimedTurn: number | undefined
  let closed = false
  for (const event of events) {
    if (event.type === 'turn/start') open = event.data.turn
    else if (event.type === 'agent/inbox/spliced') {
      const removed = pending[event.data.target].splice(event.data.start, event.data.removedCount ?? 0, ...event.data.inserted)
      if (event.data.outcome === 'canceled' || open === undefined) continue
      if (removed.some(message => message.source.kind === 'team-task-assignment' && message.source.teamId === teamId
        && message.source.activationId === activationId && message.source.taskId === taskId && message.source.attemptId === attemptId)) {
        claimedTurn = open
        closed = false
      }
    } else if (event.type === 'turn/end') {
      if (event.data.turn === claimedTurn) closed = event.data.reason.kind !== 'interrupted'
      if (event.data.turn === open) open = undefined
    }
  }
  if (claimedTurn !== undefined && claimedTurn === open) return { kind: 'open', turn: claimedTurn }
  return { kind: closed ? 'closed' : 'unknown' }
}

/** Locate the task assignment source that was claimed by one completed turn. */
function taskAssignmentForTurn(
  events: readonly SessionEvent[],
  turn: number,
): TeamTaskAssignmentSource | undefined {
  const pending: Record<'next-step' | 'next-turn', UserMessage[]> = { 'next-step': [], 'next-turn': [] }
  let open: number | undefined
  let assignment: TeamTaskAssignmentSource | undefined
  for (const event of events) {
    if (event.type === 'turn/start') {
      open = event.data.turn
      continue
    }
    if (event.type === 'agent/inbox/spliced') {
      const queue = pending[event.data.target]
      const removed = queue.splice(event.data.start, event.data.removedCount ?? 0, ...event.data.inserted)
      if (open !== turn || event.data.outcome !== undefined) continue
      for (const message of removed) {
        if (message.source.kind === 'team-task-assignment') assignment = message.source
      }
      continue
    }
    if (event.type === 'turn/end' && event.data.turn === turn) break
  }
  return assignment
}

/** Count persisted continuation admissions for the exact attempt, including already claimed input. */
function taskContinuationIds(events: readonly SessionEvent[], assignment: TeamTaskAssignmentSource, kind: 'output-limit' | 'missing-report'): Set<MessageId> {
  const ids = new Set<MessageId>()
  for (const event of events) {
    if (event.type !== 'agent/inbox/spliced') continue
    for (const message of event.data.inserted) {
      if (message.source.kind === 'team-task-assignment'
        && message.source.teamId === assignment.teamId
        && message.source.taskId === assignment.taskId
        && message.source.attemptId === assignment.attemptId
        && message.source.activationId === assignment.activationId
        && message.id.startsWith(`team-task-continuation:${kind}:`)) ids.add(message.id)
    }
  }
  return ids
}

/** Carry the latest attempt's evidence to any replacement worker without copying its conversation. */
function previousAttemptHandoff(task: TeamTaskSnapshot, maxBytes: number): string {
  const previous = task.attemptHistory.at(-1)
  if (previous === undefined) return ''
  const review = task.reviewHistory.findLast(candidate => candidate.attemptId === previous.id)
  const text = `\n\nPrevious attempt evidence (use it to address the failure or requested rework):\n${JSON.stringify({
    attemptId: previous.id,
    ...review === undefined ? {} : { review: { nextPhase: review.nextPhase, reason: review.reason } },
    outcome: previous.outcome,
  })}`
  const bytes = Buffer.from(text)
  if (bytes.byteLength <= maxBytes) return text
  const notice = '\n[Handoff truncated; ask the coordinator for missing evidence.]'
  return new TextDecoder().decode(bytes.subarray(0, maxBytes - Buffer.byteLength(notice)), { stream: true }) + notice
}
