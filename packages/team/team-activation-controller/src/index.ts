/**
 * Local AgentRuntime-to-Team activation binder. It makes a published local
 * Agent usable by Team consumers only after its durable Hub binding commits.
 * @module @clocky/clocky-team-activation-controller
 */

import { isDeepStrictEqual } from 'node:util'
import { Service } from '@clocky/cordis'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { settleAgentWorkspaceLease } from '@clocky/clocky-agent'
import type { Agent, AgentCancelCause } from '@clocky/clocky-agent'
import type {
  ActivationHandle,
  AgentRuntimeActivationRequest,
  AgentRuntimeAgentSpec,
  AgentRuntimeSeed,
} from '@clocky/clocky-agent-runtime'
import { AgentRuntimeError, isAgentRuntimeTerminationUnconfirmed } from '@clocky/clocky-agent-runtime'
import type { AgentRuntimeFencer } from '@clocky/clocky-agent-runtime'
import { ActivationSupervisorError } from '@clocky/clocky-activation-supervisor'
import { TeamError, assertActivationStatusTransition } from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ActivationId,
  ChannelId,
  ActivationStatus,
  ParticipantId,
  TeamId,
  TeamStateSnapshot,
  TeamSystemActivationProof,
  TeamSystemActivationProofSource,
  TeamSystemActivationScope,
  TeamSystemPhaseProof,
  TeamSystemPhaseProofSource,
  TeamSystemPhaseScope,
  TeamHumanResumeAuthorization,
  TeamClosureContinuationRequest,
  ActivationControllerClosureStallPhaseScope,
  TeamWorkspaceAllocationSnapshot,
  TeamStallReason,
} from '@clocky/clocky-team'
import type { SessionId } from '@clocky/clocky-session'

/** Cordis plugin name. */
export const name = 'team-activation-controller'
/** Team and AgentRuntime services must exist before binding. */
export const inject = ['teams', 'agentRuntimes']

declare module '@clocky/cordis' {
  interface Context {
    /** Product-level owner for durable local Team activation leases. */
    teamActivations: TeamActivationController
  }
}

const MAX_TIMER_DELAY_MS = 2_147_483_647
const DEFAULT_DISPOSAL_TIMEOUT_MS = 5_000
const DEFAULT_STATUS_SYNC_ATTEMPTS = 8
const TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE = 'team-activation-controller'

/** Controller deployment limits. */
export interface Config {
  /** Maximum milliseconds allowed to settle accepted activation work during unload. */
  readonly disposalTimeoutMs?: number
  /** Maximum Hub cursor-conflict retries while persisting one observed status. */
  readonly statusSyncAttempts?: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  disposalTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_DISPOSAL_TIMEOUT_MS),
  statusSyncAttempts: z.number().step(1).min(1).default(DEFAULT_STATUS_SYNC_ATTEMPTS),
})

/** Team-resolved request to activate one agent participant through a named provider. */
export interface TeamActivationRequest {
  /** Team owning the logical agent participant. */
  readonly teamId: TeamId
  /** Participant selected from the Team's durable roster. */
  readonly participantId: ParticipantId
  /** Team cursor checked before provider startup; binding re-reads current Team state after startup. */
  readonly expectedCursor: number
  /** Registered AgentRuntime provider selected for this residency epoch. */
  readonly provider: string
  /** Durable Session retained across replacement activation epochs. */
  readonly sessionId: SessionId
  /** Fresh, fork, or persisted-resume seed selected by the caller. */
  readonly seed: AgentRuntimeSeed
  /** Agent composition resolved before placement. */
  readonly agent: AgentRuntimeAgentSpec
  /** Cancellation before the selected provider publishes a handle. */
  readonly signal: AbortSignal
  /** Runtime-only human resume authorization retained through raw activation and durable bind. */
  readonly authorization?: TeamHumanResumeAuthorization
}

/** Read-only provider and durable-binding preflight for one authenticated human coordinator recovery. */
export interface TeamActivationResumePreflightRequest {
  /** Team whose coordinator recovery the caller prepares. */
  readonly teamId: TeamId
  /** Coordinator participant selected from the durable default topology. */
  readonly participantId: ParticipantId
  /** Existing offline coordinator activation that recovery must replace or reuse. */
  readonly activationId: ActivationId
  /** Provider selected by the existing coordinator binding. */
  readonly provider: string
  /** Durable coordinator Session selected for recovery. */
  readonly sessionId: SessionId
  /** Opaque authenticated-human authorization that remains live through recovery. */
  readonly authorization: TeamHumanResumeAuthorization
}

/** Request to replace one fenced stale epoch with a new persisted-resume activation. */
export interface TeamActivationColdReplaceRequest {
  /** Team that owns the stale activation epoch. */
  readonly teamId: TeamId
  /** Participant whose existing epoch must be fenced before replacement. */
  readonly participantId: ParticipantId
  /** Exact stale durable activation epoch. */
  readonly activationId: ActivationId
  /** Cancellation before the replacement provider publishes its new epoch. */
  readonly signal: AbortSignal
  /** Runtime-only human resume authorization retained through fencing and replacement bind. */
  readonly authorization?: TeamHumanResumeAuthorization
}

/** Request to fence a durable activation left running by a previous Host process. */
export interface TeamActivationStaleFenceRequest {
  /** Team owning the stale activation. */
  readonly teamId: TeamId
  /** Participant bound to the stale activation. */
  readonly participantId: ParticipantId
  /** Exact activation epoch to fence. */
  readonly activationId: ActivationId
  /** Session retained by the stale activation. */
  readonly sessionId: SessionId
  /** Provider that owned the stale activation. */
  readonly provider: string
  /** Human authorization retained through the durable fence. */
  readonly authorization: TeamHumanResumeAuthorization
}

/** Controller-owned activation after its Hub binding has committed. */
export interface TeamActivationLease {
  /** Current immutable durable activation binding. */
  readonly binding: ActivationBindingSnapshot
  /** Exact local Agent when this provider published one in the current process. */
  readonly localAgent: Agent | undefined
  /** Reconcile provider health into the Team journal and return the durable result. */
  health(): Promise<ActivationBindingSnapshot>
  /** Interrupt the active local turn while retaining provider ownership. */
  interrupt(cause: AgentCancelCause): void
  /** Persist stopping/offline status and release the provider-owned handle. */
  dispose(): Promise<void>
}

interface ActivationEntry {
  readonly key: string
  readonly raw: ActivationHandle
  readonly localAgent: Agent | undefined
  binding: ActivationBindingSnapshot
  statusTail: Promise<void>
  statusUnsubscribe: () => void
  stopping: boolean
  terminationUnconfirmed: boolean
  disposal: Promise<void> | undefined
  lease: ManagedTeamActivationLease | undefined
}

interface PendingActivation {
  readonly sessionId: SessionId
  readonly operation: Promise<TeamActivationLease>
}

/** One transient activation lifecycle proof retained until its canonical Hub call settles. */
interface ActivationProofRecord {
  /** Exact source-owned mutation selected for this token. */
  readonly scope: TeamSystemActivationScope
  /** Live entry whose release invalidates this proof before a late Hub admission. */
  readonly entry?: ActivationEntry | undefined
  /** Authenticated-human resume authorization required for a resume-owned bind or fence. */
  readonly authorization?: TeamHumanResumeAuthorization | undefined
  /** Accepted closure authority retained through its provider action and exact writeback. */
  readonly closureRecovery?: TeamClosureContinuationRequest | undefined
}

/** One controller-owned cancellation stall proof retained only while its stopping entry remains live. */
interface CancellationStallProofRecord {
  readonly scope: Extract<TeamSystemPhaseScope, { readonly kind: 'activation-controller-cancellation-stall' }>
  readonly entry: ActivationEntry
}

/** Public lease facade that never exposes the raw AgentRuntime handle. */
class ManagedTeamActivationLease implements TeamActivationLease {
  /** @param entry - accepted activation entry. @param operations - controller-owned lease operations. */
  constructor(
    private readonly entry: ActivationEntry,
    private readonly operations: {
      readonly health: () => Promise<ActivationBindingSnapshot>
      readonly interrupt: (cause: AgentCancelCause) => void
      readonly dispose: () => Promise<void>
    },
  ) {}

  get binding(): ActivationBindingSnapshot {
    return freeze(structuredClone(this.entry.binding))
  }

  get localAgent(): Agent | undefined {
    return this.entry.localAgent
  }

  health(): Promise<ActivationBindingSnapshot> {
    return this.operations.health()
  }

  interrupt(cause: AgentCancelCause): void {
    this.operations.interrupt(cause)
  }

  dispose(): Promise<void> {
    return this.operations.dispose()
  }
}

/**
 * Team Consumer that owns the small two-system transaction from a published
 * AgentRuntime handle to a durable Team binding. Each provider owns the
 * execution-specific mechanism behind its handle status stream.
 */
export class TeamActivationController extends Service {
  private readonly entries = new Map<string, ActivationEntry>()
  private readonly pending = new Map<string, PendingActivation>()
  private readonly recoveries = new Map<string, Promise<TeamActivationLease>>()
  private readonly accepted = new Set<Promise<unknown>>()
  private readonly activationProofs = new Map<TeamSystemActivationProof, ActivationProofRecord>()
  private readonly closureRecoveries = new Map<TeamId, Promise<void>>()
  private readonly closureStallProofs = new Map<TeamSystemPhaseProof, {
    readonly scope: ActivationControllerClosureStallPhaseScope
    readonly request: TeamClosureContinuationRequest
  }>()
  private readonly cancellationStallProofs = new Map<TeamSystemPhaseProof, CancellationStallProofRecord>()
  private readonly recoveryStallProofs = new Map<TeamSystemPhaseProof, Extract<TeamSystemPhaseScope, { kind: 'activation-controller-recovery-stall' }>>()
  private readonly listeners: Array<() => void> = []
  private readonly disposalTimeoutMs: number
  private readonly statusSyncAttempts: number
  private started = false
  private closing = false
  private disposal: Promise<void> | undefined

  /**
   * @param ctx - Context carrying Team and AgentRuntime services.
   * @param config - Validated activation settlement and status-sync limits.
   */
  constructor(ctx: Context, config: Config = {}) {
    const disposalTimeoutMs = positiveSafeInteger('disposalTimeoutMs', config.disposalTimeoutMs ?? DEFAULT_DISPOSAL_TIMEOUT_MS)
    if (disposalTimeoutMs > MAX_TIMER_DELAY_MS) {
      throw new TypeError(`disposalTimeoutMs must not exceed ${MAX_TIMER_DELAY_MS}ms`)
    }
    const statusSyncAttempts = positiveSafeInteger('statusSyncAttempts', config.statusSyncAttempts ?? DEFAULT_STATUS_SYNC_ATTEMPTS)
    super(ctx, 'teamActivations')
    this.disposalTimeoutMs = disposalTimeoutMs
    this.statusSyncAttempts = statusSyncAttempts
    teamActivationControllerProofSources.set(this, Object.freeze({
      name: TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE,
      resolveActivationProof: (proof: TeamSystemActivationProof): TeamSystemActivationScope | undefined =>
        this.resolveActivationProof(proof),
    } satisfies TeamSystemActivationProofSource))
    teamActivationControllerPhaseProofSources.set(this, Object.freeze({
      name: TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE,
      resolvePhaseProof: (proof: TeamSystemPhaseProof): TeamSystemPhaseScope | undefined =>
        this.resolveClosureStallProof(proof) ?? this.resolveCancellationStallProof(proof) ?? this.recoveryStallProofs.get(proof),
    } satisfies TeamSystemPhaseProofSource))
  }

  /** Begin terminal-intent-driven release of every exact activation handle currently owned by this controller. */
  start(): void {
    if (this.started || this.closing) return
    this.started = true
    this.listeners.push(this.ctx.on('team/changed', (event) => {
      if (event.type !== 'team/changed'
        || event.team.cancellation === undefined && event.team.closure === undefined) return
      for (const entry of this.entries.values()) {
        if (entry.binding.activation.teamId !== event.team.id) continue
        this.track(this.disposeEntry(entry), `Activation '${entry.binding.activation.id}' terminal-intent disposal`)
      }
    }))
  }

  /**
   * Recover at most one epoch selected from an existing durable lifecycle intent.
   * Missing ownership records produce a durable stall; successful fencing first
   * requests allocation release and only later records complete quiescence.
   * @param input - exact closure-driver proof and its observed Team cursor.
   * @returns settlement of this bounded pass; callers reread state before issuing another proof.
   */
  async recoverClosure(input: TeamClosureContinuationRequest): Promise<void> {
    const request = Object.freeze({ ...input })
    if (this.closing) throw new TeamError('Team activation controller is closed', 'TEAM_DISPOSED')
    this.closureRecoveryScope(request)
    const existing = this.closureRecoveries.get(request.teamId)
    if (existing !== undefined) {  await existing; return }
    const operation = this.recoverClosureOwned(request)
    this.closureRecoveries.set(request.teamId, operation)
    try {
      await operation
    } finally {
      this.closureRecoveries.delete(request.teamId)
    }
  }

  /** Validate the runtime source without admitting observation or new-intent operations. */
  private closureRecoveryScope(request: TeamClosureContinuationRequest) {
    const resolution = this.ctx.teams.requireSystemClosureDriverProof(request.actor)
    const scope = resolution.scope
    if (resolution.sourceName !== 'team-closure-driver'
      || scope.teamId !== request.teamId || scope.expectedCursor !== request.expectedCursor
      || (scope.kind !== 'closure-recover-fail' && scope.kind !== 'closure-recover-cancel' && scope.kind !== 'closure-recover-complete')) {
      throw new TeamError('Activation closure recovery actor is invalid', 'TEAM_ACTOR_PROOF_INVALID')
    }
    return scope
  }

  /** Recheck the accepted intent against durable state, allowing only this pass's later cursor advances. */
  private async closureRecoveryState(request: TeamClosureContinuationRequest, initial = false): Promise<TeamStateSnapshot> {
    const scope = this.closureRecoveryScope(request)
    const state = await this.ctx.teams.getTeam({ teamId: request.teamId })
    const currentScope = this.closureRecoveryScope(request)
    const intent = scope.kind === 'closure-recover-cancel' ? state.team.cancellation : state.team.closure
    const key = scope.kind === 'closure-recover-cancel' ? scope.cancellationIdempotencyKey : scope.closureIdempotencyKey
    const requestedAt = scope.kind === 'closure-recover-cancel' ? scope.cancellationRequestedAt : scope.closureRequestedAt
    const kind = scope.kind === 'closure-recover-cancel' ? 'cancel' : scope.kind === 'closure-recover-fail' ? 'fail' : 'complete'
    if (!isDeepStrictEqual(scope, currentScope)
      || initial && state.team.cursor !== request.expectedCursor
      || (state.team.phase !== 'quiescing' && state.team.phase !== 'stalled')
      || intent === undefined || intent.idempotencyKey !== key || intent.requestedAt !== requestedAt
      || kind !== 'cancel' && state.team.closure?.kind !== kind
      || scope.kind === 'closure-recover-complete'
        && (state.team.closure?.finalChannelId !== scope.finalChannelId || state.team.closure.finalEnvelopeId !== scope.finalEnvelopeId)) {
      throw new TeamError('Activation closure recovery intent is stale', 'TEAM_ACTOR_PROOF_INVALID')
    }
    return state
  }

  /** Select durable epochs rather than assuming the controller's live handles are complete. */
  private async recoverClosureOwned(request: TeamClosureContinuationRequest): Promise<void> {
    const state = await this.closureRecoveryState(request, true)
    const candidates = state.activations.filter(binding => binding.quiescedAt === undefined)
    const binding = candidates.find(candidate =>
      this.entries.get(activationKey(request.teamId, candidate.activation.participantId))?.binding.activation.id
        === candidate.activation.id)
      ?? candidates.find(candidate => candidate.fencedAt !== undefined || candidate.recovery !== undefined)
      ?? candidates[0]
    if (binding === undefined) return
    const key = activationKey(request.teamId, binding.activation.participantId)
    const live = this.entries.get(key)
    if (live !== undefined && live.binding.activation.id === binding.activation.id) {
      try {
        await this.disposeEntry(live)
      } catch (error: unknown) {
        const current = await this.closureRecoveryState(request)
        if (current.team.stallReason?.code !== 'REMOTE_CANCELLATION_UNCONFIRMED'
          || !current.team.stallReason.message.includes(binding.activation.id)) {
          await this.recordClosureTerminationUnconfirmed(request, binding, error)
        }
      }
      return
    }
    if (this.pending.has(key) || this.recoveries.has(key)) return
    const preserved = state.workspaceAllocations.find((allocation): allocation is TeamWorkspaceAllocationSnapshot & {
      readonly preservationReason: TeamStallReason
    } => allocation.activationId === binding.activation.id && allocation.lifecycle === 'preserved')
    if (preserved !== undefined) {
      await this.recordClosureResourceStall(request, binding, {
        code: 'WORKSPACE_RELEASE_RECOVERY_FAILED',
        message: `Workspace allocation '${preserved.id}' remains preserved: ${preserved.preservationReason.message}`,
      })
      return
    }
    if (binding.fencedAt === undefined) {
      const fencer = binding.recovery === undefined ? undefined : this.recoveryFencer(binding)
      if (fencer === undefined) {
        await this.recordClosureTerminationUnconfirmed(request, binding)
        return
      }
      try {
        fencer.validate(binding)
        this.closureRecoveryScope(request)
        await fencer.fence(binding)
      } catch (error: unknown) {
        await this.recordClosureTerminationUnconfirmed(request, binding, error)
        return
      }
    }
    await this.closureRecoveryState(request)
    try {
      await this.fenceDurableActivation(binding, undefined, request)
    } catch (error: unknown) {
      await this.recordClosureTerminationUnconfirmed(request, binding, error)
    }
  }

  /** Preserve an exact unresolved epoch without inferring process death from absent handles. */
  private async recordClosureTerminationUnconfirmed(
    request: TeamClosureContinuationRequest,
    binding: ActivationBindingSnapshot,
    error?: unknown,
  ): Promise<void> {
    const state = await this.closureRecoveryState(request)
    const participant = state.participants.find(candidate => candidate.id === binding.activation.participantId)
    await this.recordClosureResourceStall(request, binding, {
      code: participant?.kind === 'remote-agent' ? 'REMOTE_CANCELLATION_UNCONFIRMED' : 'ACTIVATION_TERMINATION_UNCONFIRMED',
      message: `Activation '${binding.activation.id}' has no confirmed termination for provider '${binding.provider}'.${error === undefined ? '' : ` ${renderError(error)}`}`,
    })
  }

  /** Record one exact intent/epoch diagnostic while the driver authority remains admitted. */
  private async recordClosureResourceStall(
    request: TeamClosureContinuationRequest,
    binding: ActivationBindingSnapshot,
    reason: ActivationControllerClosureStallPhaseScope['reason'],
  ): Promise<void> {
    for (let attempt = 0; attempt < this.statusSyncAttempts; attempt += 1) {
      const state = await this.closureRecoveryState(request)
      if (state.team.phase === 'stalled' && isDeepStrictEqual(state.team.stallReason, reason)) return
      const scope = this.closureRecoveryScope(request)
      const input = { teamId: request.teamId, expectedCursor: state.team.cursor, phase: 'stalled' as const, reason }
      const proof = createTeamActivationControllerPhaseProof()
      const stall: ActivationControllerClosureStallPhaseScope = {
        kind: 'activation-controller-closure-stall', ...input,
        closureKind: scope.kind === 'closure-recover-cancel' ? 'cancel' : scope.kind === 'closure-recover-fail' ? 'fail' : 'complete',
        idempotencyKey: scope.kind === 'closure-recover-cancel' ? scope.cancellationIdempotencyKey : scope.closureIdempotencyKey,
        requestedAt: scope.kind === 'closure-recover-cancel' ? scope.cancellationRequestedAt : scope.closureRequestedAt,
        activationId: binding.activation.id, participantId: binding.activation.participantId,
        sessionId: binding.sessionId, provider: binding.provider,
      }
      this.closureStallProofs.set(proof, { scope: freeze(stall), request })
      try {
        await this.ctx.teams.transitionTeamPhase({ actor: proof, ...input })
        return
      } catch (error: unknown) {
        if (isTeamCursorConflict(error) && attempt + 1 < this.statusSyncAttempts) continue
        throw error
      } finally {
        this.closureStallProofs.delete(proof)
      }
    }
  }

  /** Keep admitted recovery proof authority alive through provider and Hub settlement. */
  private resolveClosureStallProof(proof: TeamSystemPhaseProof): TeamSystemPhaseScope | undefined {
    const record = this.closureStallProofs.get(proof)
    if (record === undefined) return undefined
    this.closureRecoveryScope(record.request)
    return record.scope
  }

  /**
   * Activate one active agent participant and persist its binding before the
   * caller receives a lease. Concurrent callers for the same Team/participant
   * and Session join the exact accepted lease.
   * @param input - fully resolved activation inputs.
   * @returns a controller-owned durable activation lease.
   */
  async activate(input: TeamActivationRequest): Promise<TeamActivationLease> {
    const request = Object.freeze({ ...input })
    if (this.closing) throw new TeamError('Team activation controller is closed', 'TEAM_DISPOSED')
    const key = activationKey(request.teamId, request.participantId)
    if (this.recoveries.has(key)) {
      throw new TeamError(
        `Participant '${request.participantId}' is being cold-replaced`,
        'TEAM_ACTIVATION_RECOVERY_CONFLICT',
      )
    }
    const existing = this.entries.get(key)
    if (existing !== undefined) {
      assertSameSession(existing.binding.sessionId, request.sessionId, request.participantId)
      // v8 ignore next -- every published entry receives its lease immediately before registration.
      if (existing.lease === undefined) throw new Error('accepted activation entry has no public lease')
      return existing.lease
    }
    const pending = this.pending.get(key)
    if (pending !== undefined) {
      assertSameSession(pending.sessionId, request.sessionId, request.participantId)
      return await pending.operation
    }
    const operation = this.activateOwned(request, key)
    this.pending.set(key, { sessionId: request.sessionId, operation })
    try {
      return await operation
    } finally {
      if (this.pending.get(key)?.operation === operation) this.pending.delete(key)
    }
  }

  /**
   * Fence one stale external epoch, atomically release its current task leases
   * and persist it offline, then publish a new activation with the same Team
   * participant and Session under a new id.
   * @param input - exact old binding plus replacement composition selected by the recovery owner.
   * @returns a durable lease for the newly bound persisted-resume epoch.
   */
  async coldReplace(input: TeamActivationColdReplaceRequest): Promise<TeamActivationLease> {
    const request = Object.freeze({ ...input })
    if (this.closing) throw new TeamError('Team activation controller is closed', 'TEAM_DISPOSED')
    const key = activationKey(request.teamId, request.participantId)
    if (this.entries.has(key) || this.pending.has(key) || this.recoveries.has(key)) {
      throw new TeamError(
        `Participant '${request.participantId}' remains owned by this activation controller`,
        'TEAM_ACTIVATION_RECOVERY_CONFLICT',
      )
    }
    const operation = this.coldReplaceOwned(request)
    this.recoveries.set(key, operation)
    try {
      return await operation
    } finally {
      this.recoveries.delete(key)
    }
  }

  /**
   * Fence one activation left running after a Host restart before a Team can be resumed.
   * @param input - Exact stale activation and recovery authorization selected by the recovery owner.
   */
  async fenceStale(input: TeamActivationStaleFenceRequest): Promise<void> {
    const request = Object.freeze({ ...input })
    if (this.closing) throw new TeamError('Team activation controller is closed', 'TEAM_DISPOSED')
    await assertRecoveryAuthorization(request.authorization, request.teamId)
    const key = activationKey(request.teamId, request.participantId)
    const existing = this.entries.get(key)
    if (existing !== undefined) {
      await this.disposeEntry(existing)
      return
    }
    if (this.pending.has(key) || this.recoveries.has(key)) {
      throw new TeamError(
        `Participant '${request.participantId}' remains owned by this activation controller`,
        'TEAM_ACTIVATION_RECOVERY_CONFLICT',
      )
    }
    const state = await this.ctx.teams.getTeam({ teamId: request.teamId })
    const binding = requireMatchingBinding(state, {
      teamId: request.teamId,
      activationId: request.activationId,
      participantId: request.participantId,
      sessionId: request.sessionId,
      provider: request.provider,
    })
    if (binding.activation.status === 'offline') return
    await this.fenceDurableActivation(binding, request.authorization)
  }

  /**
   * Confirm that a human-authorized coordinator recovery can reach the selected provider without mutating Team state.
   * @param input - exact durable coordinator binding and live human resume authorization.
   * @returns resolution after provider and durable binding checks pass.
   */
  async preflightResume(input: TeamActivationResumePreflightRequest): Promise<void> {
    const request = Object.freeze({ ...input })
    await assertRecoveryAuthorization(request.authorization, request.teamId)
    const state = await this.ctx.teams.getTeam({ teamId: request.teamId })
    const participant = state.participants.find(candidate => candidate.id === request.participantId)
    const binding = state.activations.find(candidate => candidate.activation.id === request.activationId)
    if (participant === undefined
      || participant.phase !== 'active'
      || (participant.kind !== 'local-agent' && participant.kind !== 'remote-agent')
      || binding === undefined
      || !matchesBinding(binding, {
        teamId: request.teamId, activationId: request.activationId, participantId: request.participantId,
        sessionId: request.sessionId, provider: request.provider,
      })
      || binding.activation.status !== 'offline'
      || this.ctx.agentRuntimes.getProvider(request.provider) === undefined
      || (binding.recovery !== undefined && binding.quiescedAt === undefined
        && this.recoveryFencer(binding) === undefined)) {
      throw new TeamError('Team coordinator recovery preflight is no longer valid', 'TEAM_ACTIVATION_RECOVERY_UNSUPPORTED')
    }
    await assertRecoveryAuthorization(request.authorization, request.teamId)
  }

  /** Fence and replace one reserved stale activation without permitting another local owner to join it. */
  private async coldReplaceOwned(request: TeamActivationColdReplaceRequest): Promise<TeamActivationLease> {
    await assertRecoveryAuthorization(request.authorization, request.teamId)
    const binding = await this.currentColdReplaceBinding(request)
    const recovery = binding.recovery
    if (recovery === undefined) {
      throw new TeamError(
        `Activation '${binding.activation.id}' has no persisted cold-replacement plan`,
        'TEAM_ACTIVATION_RECOVERY_UNSUPPORTED',
      )
    }
    request.signal.throwIfAborted()
    assertColdReplaceableQuiescence(binding)
    const providerAvailable = this.ctx.agentRuntimes.getProvider(binding.provider) !== undefined
    if (!providerAvailable) {
      await this.recordRecoveryStall(binding, 'AGENT_RUNTIME_PROVIDER_UNAVAILABLE')
      throw new TeamError(
        `AgentRuntime provider '${binding.provider}' is unavailable for replacement`,
        'TEAM_ACTIVATION_FENCE_UNAVAILABLE',
      )
    }
    const fencer = this.recoveryFencer(binding, request.signal)
    if (fencer === undefined) {
      await this.recordRecoveryStall(binding, recovery.supervisor === undefined
        ? 'AGENT_RUNTIME_FENCER_UNAVAILABLE'
        : 'SUPERVISOR_UNAVAILABLE')
      throw new TeamError(
        `AgentRuntime provider '${binding.provider}' has no stale-activation fencer`,
        'TEAM_ACTIVATION_FENCE_UNAVAILABLE',
      )
    }
    try {
      if (recovery.supervisor !== undefined) {
        const supervisors = this.ctx.get('activationSupervisors')
        if (supervisors === undefined) throw new ActivationSupervisorError('Supervisor registry is unavailable', 'SUPERVISOR_UNAVAILABLE')
        const health = await supervisors.health(binding, request.signal)
        if (health.status === 'unreachable' || health.status === 'unknown') {
          await this.recordRecoveryStall(binding, health.status === 'unreachable' ? 'SUPERVISOR_UNREACHABLE' : 'SUPERVISOR_UNKNOWN')
          throw new ActivationSupervisorError('Supervisor cannot establish execution state', 'SUPERVISOR_TERMINATION_UNCONFIRMED')
        }
      }
      fencer.validate(freeze(structuredClone(binding)))
      if (binding.quiescedAt === undefined) await fencer.fence(freeze(structuredClone(binding)))
    } catch (error: unknown) {
      if (request.signal.aborted) throw error
      await this.recordRecoveryStall(binding,
        error instanceof ActivationSupervisorError ? error.code : 'AGENT_RUNTIME_FENCE_FAILED')
      throw new TeamError(
        `Activation '${binding.activation.id}' could not be fenced before replacement`,
        'TEAM_ACTIVATION_FENCE_FAILED',
        { cause: error },
      )
    }
    request.signal.throwIfAborted()
    await assertRecoveryAuthorization(request.authorization, request.teamId)
    await this.fenceDurableActivation(binding, request.authorization)
    await assertRecoveryAuthorization(request.authorization, request.teamId)
    if (this.closing) throw new TeamError('Team activation controller is closed', 'TEAM_DISPOSED')
    return await this.activateColdReplacement(request, binding, recovery)
  }

  /** Resolve a supervisor without coupling the controller to its network transport. */
  private recoveryFencer(binding: ActivationBindingSnapshot, signal?: AbortSignal): AgentRuntimeFencer | undefined {
    if (binding.recovery?.supervisor === undefined) return this.ctx.agentRuntimes.getFencer(binding.provider)
    const supervisors = this.ctx.get('activationSupervisors')
    if (supervisors === undefined) return undefined
    return {
      provider: binding.provider,
      validate: (candidate) => { supervisors.resolve(candidate) },
      fence: async (candidate) => { await supervisors.fence(candidate, signal ?? new AbortController().signal) },
    }
  }

  /** Persist missing execution evidence without rewriting reachability as offline status. */
  private async recordRecoveryStall(
    binding: ActivationBindingSnapshot,
    code:
      | 'SUPERVISOR_UNAVAILABLE'
      | 'SUPERVISOR_INVALID'
      | 'SUPERVISOR_GENERATION_MISMATCH'
      | 'SUPERVISOR_UNREACHABLE'
      | 'SUPERVISOR_UNKNOWN'
      | 'SUPERVISOR_TERMINATION_UNCONFIRMED'
      | 'AGENT_RUNTIME_PROVIDER_UNAVAILABLE'
      | 'AGENT_RUNTIME_FENCER_UNAVAILABLE'
      | 'AGENT_RUNTIME_FENCE_FAILED',
  ): Promise<void> {
    const supervisor = binding.recovery?.supervisor
    for (let attempt = 0; attempt < this.statusSyncAttempts; attempt += 1) {
      const state = await this.ctx.teams.getTeam({ teamId: binding.activation.teamId })
      if (state.team.phase !== 'active' || state.team.closure !== undefined || state.team.cancellation !== undefined) return
      const current = requireMatchingBinding(state, bindingIdentity(binding))
      if (!isLatestParticipantBinding(state, current) || !isDeepStrictEqual(current.recovery?.supervisor, supervisor)) return
      const message = supervisor === undefined
        ? `Activation '${binding.activation.id}' cannot recover through AgentRuntime provider '${binding.provider}'.`
        : `Activation '${binding.activation.id}' cannot recover through supervisor '${supervisor.name}' version ${supervisor.version}.`
      const scope = {
        kind: 'activation-controller-recovery-stall' as const,
        ...bindingIdentity(binding), expectedCursor: state.team.cursor, phase: 'stalled' as const,
        ...supervisor === undefined ? {} : { supervisor: structuredClone(supervisor) },
        reason: { code, message },
      }
      const proof = createTeamActivationControllerPhaseProof()
      this.recoveryStallProofs.set(proof, freeze(scope))
      try {
        await this.ctx.teams.transitionTeamPhase({ actor: proof, teamId: state.team.id, expectedCursor: state.team.cursor, phase: 'stalled', reason: scope.reason })
        return
      } catch (error: unknown) {
        if (!isTeamCursorConflict(error) || attempt + 1 === this.statusSyncAttempts) throw error
      } finally { this.recoveryStallProofs.delete(proof) }
    }
  }

  /** Stop admission, release every accepted handle, and await bounded settlement. */
  close(): Promise<void> {
    this.disposal ??= this.dispose()
    return this.disposal
  }

  /** Reject an operation after controller admission has closed. */
  private assertOpen(): void {
    if (this.closing) throw new TeamError('Team activation controller is closed', 'TEAM_DISPOSED')
  }

  /** Create one raw handle, bind it durably, and hide it behind a lease. */
  private async activateOwned(request: TeamActivationRequest, key: string): Promise<TeamActivationLease> {
    if (this.closing) throw new TeamError('Team activation controller is closed', 'TEAM_DISPOSED')
    const state = await this.ctx.teams.getTeam({ teamId: request.teamId })
    await assertRecoveryAuthorization(request.authorization, request.teamId)
    if (state.team.cursor !== request.expectedCursor) {
      throw new TeamError(
        `Team cursor ${request.expectedCursor} is stale; current cursor is ${state.team.cursor}`,
        'TEAM_CURSOR_CONFLICT',
      )
    }
    if (state.team.phase !== 'active') {
      throw new TeamError(`Team '${request.teamId}' is not active`, 'TEAM_INVALID_ARGUMENT')
    }
    const participant = state.participants.find(item => item.id === request.participantId)
    if (participant === undefined
      || participant.phase !== 'active'
      || (participant.kind !== 'local-agent' && participant.kind !== 'remote-agent')) {
      throw new TeamError(
        `Participant '${request.participantId}' is not an active agent participant`,
        'TEAM_PARTICIPANT_NOT_FOUND',
      )
    }
    for (const binding of state.activations) {
      if (binding.activation.participantId !== request.participantId) continue
      assertSameSession(binding.sessionId, request.sessionId, request.participantId)
      if (binding.activation.status !== 'offline') {
        throw new TeamError(
          `Participant '${request.participantId}' already has a resident activation`,
          'TEAM_INVALID_ARGUMENT',
        )
      }
      if (binding.recovery !== undefined && binding.quiescedAt === undefined) {
        throw new TeamError(
          `Participant '${request.participantId}' has an offline activation without replacement proof`,
          'TEAM_ACTIVATION_RECOVERY_CONFLICT',
        )
      }
    }
    const raw = await this.ctx.agentRuntimes.activate({
      provider: request.provider,
      teamId: request.teamId,
      participant,
      sessionId: request.sessionId,
      seed: request.seed,
      agent: request.agent,
      signal: request.signal,
    } satisfies AgentRuntimeActivationRequest)
    let boundEntry: ActivationEntry | undefined
    try {
      this.assertOpen()
      await assertRecoveryAuthorization(request.authorization, request.teamId)
      const localAgent = raw.localAgent
      if (localAgent !== undefined && localAgent.session.id !== raw.sessionId) {
        throw new TeamError(
          `AgentRuntime provider '${request.provider}' published an Agent for another Session`,
          'TEAM_INVALID_ARGUMENT',
        )
      }
      const health = await raw.health()
      assertActivationIdentity(raw, health, request)
      const bindingState = await this.ctx.teams.getTeam({ teamId: request.teamId })
      this.assertOpen()
      const bindInput = {
        expectedCursor: bindingState.team.cursor,
        binding: {
          activation: health,
          sessionId: raw.sessionId,
          provider: request.provider,
          selection: {
            ...request.agent.preset === undefined ? {} : { preset: request.agent.preset },
            ...request.agent.options.provider === undefined ? {} : { provider: request.agent.options.provider },
            ...request.agent.options.model === undefined ? {} : { model: request.agent.options.model },
          },
          ...raw.recovery === undefined ? {} : { recovery: raw.recovery },
        },
      }
      await assertRecoveryAuthorization(request.authorization, request.teamId)
      const binding = await this.withActivationProof({
        kind: 'activation-controller-bind',
        ...bindInput,
      }, async actor => await this.ctx.teams.bindActivation({ actor, ...bindInput }), undefined, request.authorization)
      const entry: ActivationEntry = {
        key,
        raw,
        localAgent,
        binding,
        statusTail: Promise.resolve(),
        statusUnsubscribe: () => {},
        stopping: false,
        terminationUnconfirmed: false,
        disposal: undefined,
        lease: undefined,
      }
      const lease = new ManagedTeamActivationLease(entry, {
        health: () => this.health(entry),
        interrupt: (cause) => { this.interrupt(entry, cause) },
        dispose: () => this.disposeEntry(entry),
      })
      entry.lease = lease
      this.entries.set(key, entry)
      boundEntry = entry
      entry.statusUnsubscribe = raw.onStatus((status) => { this.observeHandleStatus(entry, status) })
      this.track(this.syncRawHealth(entry), `Activation '${binding.activation.id}' initial status sync`)
      return lease
    } catch (error: unknown) {
      if (boundEntry !== undefined) {
        try {
          await this.disposeEntry(boundEntry)
        } catch (cleanupError: unknown) {
          throw new AggregateError([error, cleanupError], 'Team activation publication failed and bound activation cleanup also failed')
        }
        throw error
      }
      const cleanup = await disposeRaw(raw)
      if (cleanup.kind === 'released') throw error
      throw new AggregateError([error, cleanup.error], 'Team activation binding failed and raw handle cleanup also failed')
    }
  }

  /** Resolve one exact stale binding and reject a changed durable relation. */
  private async currentColdReplaceBinding(
    request: TeamActivationColdReplaceRequest,
  ): Promise<ActivationBindingSnapshot> {
    const state = await this.ctx.teams.getTeam({ teamId: request.teamId })
    return requireMatchingBinding(state, {
      teamId: request.teamId, activationId: request.activationId, participantId: request.participantId,
    })
  }

  /** Atomically release fenced task leases and mark the old epoch offline, retrying only Team cursor races. */
  private async fenceDurableActivation(
    binding: ActivationBindingSnapshot,
    authorization?: TeamHumanResumeAuthorization,
    closureRecovery?: TeamClosureContinuationRequest,
  ): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      const state = await this.ctx.teams.getTeam({ teamId: binding.activation.teamId })
      const current = requireMatchingBinding(state, bindingIdentity(binding))
      assertColdReplaceableQuiescence(current)
      if (current.activation.status === 'offline'
        && hasQuiescence(current)
        && current.quiescedWakeChannelIds.length === 0) return
      try {
        const input = {
          teamId: binding.activation.teamId,
          activationId: binding.activation.id,
          participantId: binding.activation.participantId,
          sessionId: binding.sessionId,
          provider: binding.provider,
          expectedCursor: state.team.cursor,
        }
        await assertRecoveryAuthorization(authorization, binding.activation.teamId)
        await this.withActivationProof({
          kind: 'activation-controller-fence',
          ...input,
        }, async actor => await this.ctx.teams.fenceActivation({ actor, ...input }), undefined, authorization, closureRecovery)
        return
      } catch (error: unknown) {
        if (isTeamCursorConflict(error) && attempt + 1 < this.statusSyncAttempts) continue
        throw error
      }
    }
  }

  /** Publish a replacement epoch, retrying a Team cursor race after fencing left the old epoch offline. */
  private async activateColdReplacement(
    request: TeamActivationColdReplaceRequest,
    binding: ActivationBindingSnapshot,
    recovery: NonNullable<ActivationBindingSnapshot['recovery']>,
  ): Promise<TeamActivationLease> {
    for (let attempt = 0; ; attempt += 1) {
      const current = await this.ctx.teams.getTeam({ teamId: request.teamId })
      if (!isLatestParticipantBinding(current, binding)) {
        throw new TeamError(
          `Activation '${binding.activation.id}' is no longer the participant's latest epoch`,
          'TEAM_ACTIVATION_RECOVERY_CONFLICT',
        )
      }
      try {
        const agent = recovery.kind === 'sdk-local-cold-replace'
          ? {
            options: {
              provider: recovery.agent.provider,
              model: recovery.agent.model,
              ...recovery.agent.maxTokens === undefined ? {} : { maxTokens: recovery.agent.maxTokens },
            },
          }
          : { cwd: recovery.cwd, options: {} }
        return await this.activateOwned({
          teamId: request.teamId,
          participantId: request.participantId,
          expectedCursor: current.team.cursor,
          provider: binding.provider,
          sessionId: binding.sessionId,
          seed: { kind: 'resume' },
          agent: {
            ...binding.selection?.preset === undefined ? {} : { preset: binding.selection.preset },
            ...agent,
          },
          signal: request.signal,
          ...request.authorization === undefined ? {} : { authorization: request.authorization },
        }, activationKey(request.teamId, request.participantId))
      } catch (error: unknown) {
        if (!request.signal.aborted && error instanceof AgentRuntimeError && error.code === 'AGENT_RUNTIME_PROVIDER_NOT_FOUND') {
          await this.recordRecoveryStall(binding, 'AGENT_RUNTIME_PROVIDER_UNAVAILABLE')
        }
        if (isTeamCursorConflict(error) && attempt + 1 < this.statusSyncAttempts) continue
        throw error
      }
    }
  }

  /** Persist current provider health before exposing it through a durable lease. */
  private async health(entry: ActivationEntry): Promise<ActivationBindingSnapshot> {
    if (entry.stopping) return freeze(structuredClone(entry.binding))
    const health = await this.readRawHealth(entry)
    if (health.status === 'offline') {
      await this.disposeEntry(entry)
      return freeze(structuredClone(entry.binding))
    }
    await this.syncStatus(entry, health.status)
    return freeze(structuredClone(entry.binding))
  }

  /** Interrupt one raw handle and asynchronously mirror any resulting health state. */
  private interrupt(entry: ActivationEntry, cause: AgentCancelCause): void {
    if (entry.disposal !== undefined || entry.stopping) return
    entry.raw.interrupt(cause)
    this.track(this.syncRawHealth(entry), `Activation '${entry.binding.activation.id}' interrupt status sync`)
  }

  /** Join one in-flight disposal, then retain ownership after a failed settlement for a later retry. */
  private disposeEntry(entry: ActivationEntry): Promise<void> {
    const existing = entry.disposal
    if (existing !== undefined) return existing
    const disposal = this.disposeOwnedEntry(entry)
    entry.disposal = disposal
    void disposal.then(
      () => {},
      () => {
        entry.disposal = undefined
      },
    )
    return disposal
  }

  /**
   * Stop the durable activation, settle its agent-scoped workspace owner, then
   * release the raw handle and commit quiescence before dropping controller
   * ownership. A failed stage retains the entry for a later disposer retry.
   */
  private async disposeOwnedEntry(entry: ActivationEntry): Promise<void> {
    entry.stopping = true
    await this.syncStatus(entry, 'stopping')
    await this.stopLocalAgent(entry)
    await this.settleWorkspaceAllocations(entry)
    try {
      await entry.raw.dispose()
    } catch (error: unknown) {
      if (isAgentRuntimeTerminationUnconfirmed(error)) {
        entry.terminationUnconfirmed = true
        try {
          await this.recordCancellationTerminationUnconfirmed(entry)
        } catch (stallError: unknown) {
          throw new AggregateError([error, stallError], `Activation '${entry.binding.activation.id}' termination is unconfirmed and its Team stall could not be recorded`)
        }
      }
      throw error
    }
    await this.quiesce(entry)
    this.release(entry)
  }

  /** Cancel local work and wait until no local turn or maintenance work can retain an allocation root. */
  private async stopLocalAgent(entry: ActivationEntry): Promise<void> {
    const agent = entry.localAgent
    if (agent === undefined) return
    agent.cancel({ kind: 'disposed' }, { keepInbox: true })
    await agent.whenIdle()
  }

  /** Delegate durable allocation release or preservation to the exact local Agent scope. */
  private async settleWorkspaceAllocations(entry: ActivationEntry): Promise<void> {
    if (entry.localAgent !== undefined) await settleAgentWorkspaceLease(entry.localAgent)
  }

  /** Mirror one provider-observed handle status after its durable binding becomes visible. */
  private observeHandleStatus(entry: ActivationEntry, status: ActivationHandle['activation']): void {
    this.track(this.syncObservedStatus(entry, status), `Activation '${entry.binding.activation.id}' handle status sync`)
  }

  /** Verify a status belongs to this epoch before persisting or releasing it. */
  private async syncObservedStatus(entry: ActivationEntry, status: ActivationHandle['activation']): Promise<void> {
    assertActivationIdentity(entry.raw, status, {
      teamId: entry.binding.activation.teamId,
      participantId: entry.binding.activation.participantId,
      sessionId: entry.binding.sessionId,
    })
    if (entry.stopping) {
      if (status.status === 'offline' && entry.terminationUnconfirmed) {
        await this.settleLateTerminationProof(entry)
      }
      return
    }
    if (status.status === 'offline') {
      await this.disposeEntry(entry)
      return
    }
    await this.syncStatus(entry, status.status)
  }

  /** Read one raw handle's status and persist it if it remains a valid durable edge. */
  private async syncRawHealth(entry: ActivationEntry): Promise<void> {
    if (entry.stopping || (entry.disposal !== undefined && entry.binding.activation.status === 'offline')) return
    const health = await this.readRawHealth(entry)
    if (health.status === 'offline') {
      await this.disposeEntry(entry)
      return
    }
    await this.syncStatus(entry, health.status)
  }

  /** Read one raw health snapshot and retain the entry's exact Team binding relation. */
  private async readRawHealth(entry: ActivationEntry): Promise<ActivationHandle['activation']> {
    const health = await entry.raw.health()
    assertActivationIdentity(entry.raw, health, {
      teamId: entry.binding.activation.teamId,
      participantId: entry.binding.activation.participantId,
      sessionId: entry.binding.sessionId,
    })
    return health
  }

  /** Serialize one status observation and retry only durable Team cursor races. */
  private syncStatus(entry: ActivationEntry, status: ActivationStatus): Promise<void> {
    return this.serializeStatusWork(entry, async () => { await this.syncStatusOwned(entry, status) })
  }

  /** Serialize the durable proof that a successfully disposed handle is safe to replace. */
  private quiesce(entry: ActivationEntry): Promise<void> {
    return this.serializeStatusWork(entry, async () => { await this.quiesceOwned(entry) })
  }

  /** Append one status-related durable operation behind all earlier observations for this epoch. */
  private serializeStatusWork(entry: ActivationEntry, action: () => Promise<void>): Promise<void> {
    const operation = entry.statusTail.then(action, action)
    entry.statusTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  /** Release a disposed activation's leases and record its replacement proof with cursor retries. */
  private async quiesceOwned(entry: ActivationEntry): Promise<void> {
    await this.withCurrentEntryBinding(entry, async (state, current) => {
      if (hasQuiescence(current) && current.quiescedWakeChannelIds.length === 0) return
      const input = {
        teamId: current.activation.teamId,
        activationId: current.activation.id,
        participantId: current.activation.participantId,
        sessionId: current.sessionId,
        provider: current.provider,
        expectedCursor: state.team.cursor,
      }
      const settled = await this.withActivationProof({
        kind: 'activation-controller-quiesce',
        ...input,
      }, async actor => await this.ctx.teams.quiesceActivation({ actor, ...input }), entry)
      entry.binding = requireMatchingBinding(settled, bindingIdentity(current))
      return
    })
  }

  /** Persist one status only when the current binding still identifies this exact epoch. */
  private async syncStatusOwned(entry: ActivationEntry, status: ActivationStatus): Promise<void> {
    await this.withCurrentEntryBinding(entry, async (state, current) => {
      if (current.activation.status === status || !isStatusTransitionAllowed(current.activation.status, status)) return
      const input = {
        teamId: current.activation.teamId,
        activationId: current.activation.id,
        expectedCursor: state.team.cursor,
        status,
      }
      entry.binding = await this.withActivationProof({
        kind: 'activation-controller-status',
        participantId: current.activation.participantId,
        sessionId: current.sessionId,
        provider: current.provider,
        ...input,
      }, async actor => await this.ctx.teams.updateActivationStatus({ actor, ...input }), entry)
      return
    })
  }

  /** Reread an accepted entry before each status operation; only cursor conflicts consume retry allowance. */
  private async withCurrentEntryBinding(
    entry: ActivationEntry,
    operation: (state: TeamStateSnapshot, current: ActivationBindingSnapshot) => Promise<void>,
  ): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      const state = await this.ctx.teams.getTeam({ teamId: entry.binding.activation.teamId })
      const current = state.activations.find(binding => binding.activation.id === entry.binding.activation.id)
      if (current === undefined || !matchesBinding(current, bindingIdentity(entry.binding))) return
      entry.binding = current
      try {
        await operation(state, current)
        return
      } catch (error: unknown) {
        if (isTeamCursorConflict(error) && attempt + 1 < this.statusSyncAttempts) continue
        throw error
      }
    }
  }

  /** Retain one exact activation proof only for its single canonical Hub call. */
  private async withActivationProof<T>(
    scope: TeamSystemActivationScope,
    operation: (actor: TeamSystemActivationProof) => Promise<T>,
    entry?: ActivationEntry,
    authorization?: TeamHumanResumeAuthorization,
    closureRecovery?: TeamClosureContinuationRequest,
  ): Promise<T> {
    if (this.closing && closureRecovery === undefined && (entry === undefined || !entry.stopping)) {
      throw new TeamError('Team activation controller is closed', 'TEAM_DISPOSED')
    }
    const proof = createTeamActivationControllerProof()
    this.activationProofs.set(proof, Object.freeze({
      scope: freeze(structuredClone(scope)),
      ...entry === undefined ? {} : { entry },
      ...authorization === undefined ? {} : { authorization },
      ...closureRecovery === undefined ? {} : { closureRecovery },
    }))
    try {
      return await operation(proof)
    } finally {
      this.activationProofs.delete(proof)
    }
  }

  /** Resolve a live controller-owned proof; shutdown admits only its current stopping entry. */
  private resolveActivationProof(proof: TeamSystemActivationProof): TeamSystemActivationScope | undefined {
    const record = this.activationProofs.get(proof)
    if (record === undefined) return undefined
    if (record.authorization?.isLive() === false) return undefined
    const entry = record.entry
    if (record.closureRecovery !== undefined) {
      this.closureRecoveryScope(record.closureRecovery)
      return record.scope
    }
    if (entry === undefined) return record.scope
    if (this.entries.get(entry.key) !== entry) return undefined
    return record.scope
  }

  /** Record the exact cancellation branch that remains unsafe to finalize after a remote provider loses termination proof. */
  private async recordCancellationTerminationUnconfirmed(entry: ActivationEntry): Promise<void> {
    await this.withCurrentEntryBinding(entry, async (state, current) => {
      const cancellation = state.team.cancellation
      if (cancellation === undefined || (state.team.phase !== 'quiescing' && state.team.phase !== 'stalled')) return
      const reason = {
        code: 'REMOTE_CANCELLATION_UNCONFIRMED',
        message: `Remote activation '${current.activation.id}' did not confirm termination.`,
      }
      const input = {
        teamId: state.team.id,
        expectedCursor: state.team.cursor,
        phase: 'stalled' as const,
        reason,
      }
      const scope = {
        kind: 'activation-controller-cancellation-stall' as const,
        ...input,
        cancellationIdempotencyKey: cancellation.idempotencyKey,
        cancellationRequestedAt: cancellation.requestedAt,
        activationId: current.activation.id,
        participantId: current.activation.participantId,
        sessionId: current.sessionId,
        provider: current.provider,
      }
      await this.withCancellationStallProof(scope, async actor =>
        await this.ctx.teams.transitionTeamPhase({ actor, ...input }), entry)
      return
    })
  }

  /** Settle a later provider-owned offline proof after the earlier cancellation disposal could not prove termination. */
  private async settleLateTerminationProof(entry: ActivationEntry): Promise<void> {
    await this.settleWorkspaceAllocations(entry)
    await this.quiesce(entry)
    entry.terminationUnconfirmed = false
    this.release(entry)
  }

  /** Retain one exact controller phase proof only for the Team stall it authorizes. */
  private async withCancellationStallProof<T>(
    scope: Extract<TeamSystemPhaseScope, { readonly kind: 'activation-controller-cancellation-stall' }>,
    operation: (actor: TeamSystemPhaseProof) => Promise<T>,
    entry: ActivationEntry,
  ): Promise<T> {
    const proof = createTeamActivationControllerPhaseProof()
    this.cancellationStallProofs.set(proof, Object.freeze({ scope: freeze(structuredClone(scope)), entry }))
    try {
      return await operation(proof)
    } finally {
      this.cancellationStallProofs.delete(proof)
    }
  }

  /** Resolve a live controller phase proof while its exact remote activation remains stopping. */
  private resolveCancellationStallProof(proof: TeamSystemPhaseProof): TeamSystemPhaseScope | undefined {
    const record = this.cancellationStallProofs.get(proof)
    if (record === undefined || this.entries.get(record.entry.key) !== record.entry) return undefined
    return record.scope
  }

  /** Forget one live entry only when the mapping still points at that exact epoch. */
  private release(entry: ActivationEntry): void {
    if (this.entries.get(entry.key) !== entry) return
    revokeEntryProofs(this.activationProofs, entry)
    revokeEntryProofs(this.cancellationStallProofs, entry)
    entry.statusUnsubscribe()
    this.entries.delete(entry.key)
  }

  /** Track asynchronously observed health work while containing diagnostic failures. */
  private track(operation: Promise<unknown>, subject: string): void {
    this.accepted.add(operation)
    void operation.then(
      () => { this.accepted.delete(operation) },
      (error: unknown) => {
        this.accepted.delete(operation)
        if (!this.closing) this.ctx.logger.warn(`team-activation-controller: ${subject} failed: ${renderError(error)}`)
      },
    )
  }

  /** Close listener admission, then settle pending creation, status work, and handles. */
  private async dispose(): Promise<void> {
    this.closing = true
    for (const dispose of this.listeners.splice(0)) dispose()
    for (const [proof, record] of this.activationProofs) {
      if (record.closureRecovery === undefined && record.entry?.stopping !== true) this.activationProofs.delete(proof)
    }
    const settle = async (): Promise<void> => {
      const pending = [...this.pending.values()].map(item => item.operation)
      const recoveries = [...this.recoveries.values(), ...this.closureRecoveries.values()]
      const pendingResults = await Promise.allSettled(pending)
      const recoveryResults = await Promise.allSettled(recoveries)
      const entries = [...this.entries.values()].map(entry => this.disposeEntry(entry))
      const results = await Promise.allSettled([...entries, ...this.accepted])
      const rejected = (settled: readonly PromiseSettledResult<unknown>[]): unknown[] => settled
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => result.reason as unknown)
      const failures = [
        ...rejected(pendingResults),
        ...rejected(recoveryResults).filter(error => !isExpectedClosingRecoveryFailure(error)),
        ...rejected(results),
      ]
      if (failures.length > 0) throw new AggregateError(failures, 'Team activation controller disposal failed')
    }
    await withTimeout(settle(), this.disposalTimeoutMs)
  }
}

/** Revoke only proof records retained for the selected activation entry. */
function revokeEntryProofs<Proof, Record extends { readonly entry?: ActivationEntry | undefined }>(
  proofs: Map<Proof, Record>,
  entry: ActivationEntry,
): void {
  for (const [proof, record] of proofs) {
    if (record.entry !== entry) continue
    proofs.delete(proof)
  }
}

/** Keep each human recovery authorization attached to the Team that minted it. */
async function assertRecoveryAuthorization(authorization: TeamHumanResumeAuthorization | undefined, teamId: TeamId): Promise<void> {
  const authorized = await authorization?.assert()
  if (authorized !== undefined && authorized.team.id !== teamId) {
    throw new TeamError('Team recovery authorization belongs to another Team', 'TEAM_ACTOR_PROOF_INVALID')
  }
}

/** Immutable identity used by public recovery requests and accepted-entry rereads. */
interface BindingSelection {
  readonly teamId: TeamId
  readonly activationId: ActivationId
  readonly participantId: ParticipantId
  readonly sessionId?: SessionId
  readonly provider?: string
}

/** Resolve only the fields that the selecting caller has already established. */
function bindingIdentity(binding: ActivationBindingSnapshot): Required<BindingSelection> {
  return {
    teamId: binding.activation.teamId,
    activationId: binding.activation.id,
    participantId: binding.activation.participantId,
    sessionId: binding.sessionId,
    provider: binding.provider,
  }
}

/** Match the complete supplied owner identity without consulting mutable status. */
function matchesBinding(binding: ActivationBindingSnapshot, expected: BindingSelection): boolean {
  const actual = bindingIdentity(binding)
  return isDeepStrictEqual(actual, { ...actual, ...expected })
}

/** Require a retained epoch and reject an identity that selects another owner. */
function requireMatchingBinding(state: TeamStateSnapshot, expected: BindingSelection): ActivationBindingSnapshot {
  const binding = state.activations.find(candidate => candidate.activation.id === expected.activationId)
  if (binding === undefined) {
    throw new TeamError(`Activation '${expected.activationId}' was not found`, 'TEAM_ACTIVATION_NOT_FOUND')
  }
  if (!matchesBinding(binding, expected)) {
    throw new TeamError(`Activation '${expected.activationId}' does not match its recovery owner`, 'TEAM_ACTIVATION_RECOVERY_CONFLICT')
  }
  return binding
}

/** Narrow the quiescence fields that the Core durable schema validates together. */
function hasQuiescence(binding: ActivationBindingSnapshot): binding is ActivationBindingSnapshot & {
  readonly quiescedAt: number
  readonly quiescedWakeChannelIds: readonly ChannelId[]
} {
  return binding.quiescedAt !== undefined
}

/** Reject a normal local shutdown before it can be mistaken for an externally fenced recovery epoch. */
function assertColdReplaceableQuiescence(binding: ActivationBindingSnapshot): void {
  if (binding.quiescedAt === undefined || binding.quiescenceSource === 'fenced') return
  throw new TeamError(
    `Activation '${binding.activation.id}' is quiesced without an external fence proof`,
    'TEAM_ACTIVATION_RECOVERY_CONFLICT',
  )
}

/** Return whether the selected predecessor remains the latest durable epoch for its participant. */
function isLatestParticipantBinding(state: TeamStateSnapshot, binding: ActivationBindingSnapshot): boolean {
  const current = requireMatchingBinding(state, bindingIdentity(binding))
  const latest = state.activations.findLastIndex(candidate => candidate.activation.participantId === current.activation.participantId)
  return latest === state.activations.indexOf(current)
}

/** Install one Team activation controller in the containing Cordis fiber. */
export function apply(ctx: Context, config: Config = {}): () => Promise<void> {
  const controller = new TeamActivationController(ctx, config)
  // The constructor initializes both private issuers synchronously before returning.
  const proofSource = teamActivationControllerProofSources.get(controller) as TeamSystemActivationProofSource
  const unregisterProofSource = ctx.teams.registerSystemActivationProofSource(proofSource)
  const phaseProofSource = teamActivationControllerPhaseProofSources.get(controller) as TeamSystemPhaseProofSource
  const unregisterPhaseProofSource = ctx.teams.registerSystemPhaseProofSource(phaseProofSource)
  controller.start()
  return async () => {
    try {
      await controller.close()
    } finally {
      try {
        unregisterPhaseProofSource()
      } finally {
        unregisterProofSource()
      }
    }
  }
}

/** Keep each opaque controller activation-proof source private to its service instance. */
const teamActivationControllerProofSources = new WeakMap<TeamActivationController, TeamSystemActivationProofSource>()
/** Keep each opaque controller cancellation-stall proof source private to its service instance. */
const teamActivationControllerPhaseProofSources = new WeakMap<TeamActivationController, TeamSystemPhaseProofSource>()

/** Create one non-serializable proof that only the controller's source can resolve. */
function createTeamActivationControllerProof(): TeamSystemActivationProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team activation controller proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemActivationProof
}

/** Create one non-serializable proof for the controller-owned cancellation-stall transition. */
function createTeamActivationControllerPhaseProof(): TeamSystemPhaseProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team activation controller phase proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemPhaseProof
}

/** Build one collision-free key for a stable Team participant. */
function activationKey(teamId: TeamId, participantId: ParticipantId): string {
  return JSON.stringify([teamId, participantId])
}

/** Reject a same-participant join request that names another durable Session. */
function assertSameSession(current: SessionId, candidate: SessionId, participantId: ParticipantId): void {
  if (current !== candidate) {
    throw new TeamError(`Participant '${participantId}' is already active on another Session`, 'TEAM_INVALID_ARGUMENT')
  }
}

/** Verify a provider health value retains the accepted raw-handle identity. */
function assertActivationIdentity(
  raw: ActivationHandle,
  health: ActivationHandle['activation'],
  expected: Pick<TeamActivationRequest, 'teamId' | 'participantId' | 'sessionId'>,
): void {
  if (health.id !== raw.activation.id
    || health.teamId !== expected.teamId
    || health.participantId !== expected.participantId
    || raw.sessionId !== expected.sessionId) {
    throw new TeamError('AgentRuntime health does not match the requested activation binding', 'TEAM_INVALID_ARGUMENT')
  }
}

/** Return whether a current durable status can advance to the observed next status. */
function isStatusTransitionAllowed(previous: ActivationStatus, next: ActivationStatus): boolean {
  try {
    assertActivationStatusTransition(previous, next)
    return true
  } catch {
    return false
  }
}

/** Recognize the Team error that permits a fresh durable cursor read and retry. */
function isTeamCursorConflict(error: unknown): boolean {
  return error instanceof TeamError && error.code === 'TEAM_CURSOR_CONFLICT'
}

/** A fenced recovery that stops before new placement is expected during controller teardown. */
function isExpectedClosingRecoveryFailure(error: unknown): boolean {
  return error instanceof TeamError && error.code === 'TEAM_DISPOSED'
}

/** Result of releasing a raw activation handle after a failed durable bind. */
type RawDisposal = { readonly kind: 'released' } | { readonly kind: 'failed'; readonly error: unknown }

/** Dispose one raw handle without allowing cleanup failure to hide its original cause. */
async function disposeRaw(handle: ActivationHandle): Promise<RawDisposal> {
  try {
    await handle.dispose()
    return { kind: 'released' }
  } catch (error: unknown) {
    return { kind: 'failed', error }
  }
}

/** Freeze one detached public value recursively. */
function freeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) freeze(child)
  return value
}

/** Render a contained asynchronous failure without allowing rendering to throw. */
function renderError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

/** Bound one controller shutdown without abandoning accepted handles indefinitely. */
async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(`Team activation controller disposal exceeded ${timeoutMs}ms`)) }, timeoutMs)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Validate one locally supplied positive safe integer configuration value. */
function positiveSafeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer`)
  return value
}
