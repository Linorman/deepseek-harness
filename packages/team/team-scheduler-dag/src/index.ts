import type {} from '@clocky/clocky-team-channel-admission'
import type {} from '@clocky/clocky-team-placement-default'
/**
 * Deterministic DAG task scheduler for durable Team task attempts.
 *
 * The scheduler chooses only from Team projections and commits every state
 * change through `TeamRuntime`; it checks but never allocates a workspace and
 * never wakes an Agent. A deployment calls {@link TeamDagScheduler.drive} to scan lease
 * deadlines, while local Team notifications reduce ordinary scheduling delay.
 *
 * @module @clocky/clocky-team-scheduler-dag
 */

import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { taskHasActiveExecution, taskHasSharedWriteConflict, taskConcurrencyUsage } from '@clocky/clocky-team'
import {
  CONSULT_CHANNEL_ADAPTER_V1,
  CONSULT_INITIATOR_ROLE,
  CONSULT_REVIEW_REQUEST_KIND,
  CONSULT_RESPONDENT_ROLE,
  CONSULT_RESPONSE_KIND,
  parseConsultReviewResponsePayload,
  parseConsultReviewAssignmentPayload,
  parseConsultTextPayload,
} from '@clocky/clocky-team-channel-basic'
import {
  TASK_ASSIGNMENT_ENVELOPE_KIND,
  parseTaskAssignmentChannelManifest,
  parseTaskAssignmentEnvelope,
} from '@clocky/clocky-team-channel-task-assignment'
import type {
  TaskAssignmentChannelManifest,
  TaskAssignmentEnvelope,
} from '@clocky/clocky-team-channel-task-assignment'
import type { TeamWorkspaceEligibilityRequest } from '@clocky/clocky-team-workspace'
import { TeamError, channelPostIdempotencyKeySchema, teamTaskRankingPolicySchema, matchesTaskPlacement } from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ActivationId,
  ChannelId,
  ChannelRecord,
  ChannelEnvelopePostInput,
  ChannelSnapshot,
  ChannelDeliveryExpireResult,
  JsonObject,
  ParticipantSnapshot,
  TeamChannelCompactInput,
  TeamJournalCompactInput,
  TeamEvent,
  TeamEnvelope,
  TeamId,
  TeamStateSnapshot,
  TeamSnapshot,
  TeamTaskSnapshot,
  TeamTaskId,
  TeamTaskWorkspaceMode,
  TeamSystemEnvelopePostProof,
  TeamSystemEnvelopePostScope,
  TeamSystemEnvelopePostProofSource,
  TeamSystemTaskReviewProof,
  TeamSystemTaskReviewProofSource,
  TeamSystemTaskReviewScope,
  TeamSystemPhaseProof,
  TeamSystemPhaseProofSource,
  TeamSystemPhaseScope,
  TeamSystemMaintenanceProof,
  TeamSystemMaintenanceProofSource,
  TeamSystemMaintenanceScope,
  TeamSystemTaskLeaseProof,
  TeamSystemTaskLeaseProofSource,
  TeamSystemTaskLeaseScope,
  TeamSystemSchedulerChannelProof,
  TeamSystemSchedulerChannelProofSource,
  TeamSystemSchedulerChannelScope,
  SchedulerChannelDeliveryExpireInput,
  TeamStallReason,
  TaskLeaseSnapshot,
} from '@clocky/clocky-team'

import { taskOwnerRank } from './ranking.ts'
import type { TaskOwnerRank } from './ranking.ts'

/** Cordis plugin name. */
export const name = 'team-scheduler-dag'
/** Team authority and workspace eligibility must exist before scheduling begins. */
export const inject = ['teamChannelAdmission', 'teams', 'teamWorkspaces']

const DEFAULT_STALL_AFTER_UNASSIGNABLE_DRIVES = 3
const DEFAULT_TEAM_PAGE_SIZE = 128
const DEFAULT_CHANNEL_PAGE_SIZE = 128
const TEAM_SCHEDULER_ENVELOPE_POST_PROOF_SOURCE = 'team-scheduler-dag'
const TEAM_SCHEDULER_TASK_REVIEW_PROOF_SOURCE = 'team-scheduler-dag'
const TEAM_SCHEDULER_PHASE_PROOF_SOURCE = 'team-scheduler-dag'
const TEAM_SCHEDULER_MAINTENANCE_PROOF_SOURCE = 'team-scheduler-dag'
const TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE = 'team-scheduler-dag'
const TEAM_SCHEDULER_CHANNEL_PROOF_SOURCE = 'team-scheduler-dag'

/** Deployment choices that bound deterministic task scheduling. */
export interface Config {
  /** Fixed duration recorded on every lease that this scheduler assigns. */
  readonly leaseDurationMs: number
  /** Maximum successful task assignments committed during one Team drive. */
  readonly maxAssignmentsPerDrive: number
  /** Maximum task-lease or channel-delivery expiry records committed during one Team drive. */
  readonly maxExpirationsPerDrive: number
  /** Maximum existing assignment channels validated or repaired during one Team drive. */
  readonly maxWakeDispatchesPerDrive: number
  /** Maximum state-race rereads after assignment or expiry CAS conflicts. */
  readonly maxConflictsPerDrive: number
  /** Maximum assigned or running attempts one participant may hold. */
  readonly maxActiveAttemptsPerParticipant: number
  /** Task workspace modes that this deployment permits the scheduler to assign. */
  readonly permittedWorkspaceModes: TeamTaskWorkspaceMode[]
  /** Explicitly enable non-shared workspace providers for this deployment. */
  readonly allowNonSharedWorkspaceModes?: boolean
  /** Maximum milliseconds allowed to await already accepted drives during disposal. */
  readonly disposalTimeoutMs: number
  /** Optional recurring discovery pulse for lease expiry and stalled work. */
  readonly pulseIntervalMs?: number
  /** Maximum Team summaries discovered in one scheduler page. */
  readonly teamPageSize?: number
  /** Maximum channel records read by one scheduler recovery page. */
  readonly channelPageSize?: number
  /** Number of consecutive drives with pending work but no eligible owner before stalling the Team. */
  readonly stallAfterUnassignableDrives?: number
  /** Number of records to retain for terminal Team and channel streams during an opt-in retention drive. */
  readonly terminalChannelRetentionTail?: number
  /** Maximum terminal Team or channel prefixes compacted during one retention drive. */
  readonly maxCompactionsPerDrive?: number
}

/** Schemastery validator for {@link Config}. Every scheduling limit is explicit. */
export const Config: z<Config> = z.object({
  leaseDurationMs: z.number().step(1).min(1),
  maxAssignmentsPerDrive: z.number().step(1).min(1),
  maxExpirationsPerDrive: z.number().step(1).min(1),
  maxWakeDispatchesPerDrive: z.number().step(1).min(1),
  maxConflictsPerDrive: z.number().step(1).min(1),
  maxActiveAttemptsPerParticipant: z.number().step(1).min(1),
  permittedWorkspaceModes: z.array(z.union(['shared', 'worktree', 'sandbox', 'remote'] as const)).min(1),
  allowNonSharedWorkspaceModes: z.boolean().default(false),
  disposalTimeoutMs: z.number().step(1).min(1),
  pulseIntervalMs: z.number().step(1).min(1).default(undefined as unknown as number),
  teamPageSize: z.number().step(1).min(1).default(DEFAULT_TEAM_PAGE_SIZE),
  channelPageSize: z.number().step(1).min(1).default(DEFAULT_CHANNEL_PAGE_SIZE),
  stallAfterUnassignableDrives: z.number().step(1).min(1).default(DEFAULT_STALL_AFTER_UNASSIGNABLE_DRIVES),
  terminalChannelRetentionTail: z.number().step(1).min(1).default(undefined as unknown as number),
  maxCompactionsPerDrive: z.number().step(1).min(1).default(undefined as unknown as number),
})

/** Optional Team filter for one explicit scheduling drive. */
export interface TeamSchedulerDriveRequest {
  /** When supplied, scan only this Team; omission scans every discovered Team. */
  readonly teamId?: TeamId
}

/** Advisory post-WAL observation for a future task-delivery Consumer. */
export interface TeamTaskAssignmentNotice {
  /** Durable task projection carrying the assigned lease. */
  readonly task: TeamTaskSnapshot
  /** Idle activation selected from the projection before assignment. */
  readonly activation: ActivationBindingSnapshot
  /** Durable assignment channel attached to the lease. */
  readonly channel: ChannelSnapshot
  /** Hub-stamped self-addressed assignment Envelope accepted by the channel WAL. */
  readonly envelope: TaskAssignmentEnvelope
}

declare module '@clocky/cordis' {
  interface Events {
    /**
     * The scheduler committed a task lease and its durable assignment Envelope.
     * This observation remains advisory; a task-delivery Consumer pulls the
     * channel WAL after restart before it starts an owner-fenced attempt.
     * @param notice - immutable assignment task, activation, channel, and Envelope.
     * @mode emit
     */
    'team-scheduler/assigned'(this: TeamDagScheduler, notice: TeamTaskAssignmentNotice): void
  }
}

/** Validated configuration retained in scheduler-owned lookup forms. */
interface ResolvedConfig {
  readonly leaseDurationMs: number
  readonly maxAssignmentsPerDrive: number
  readonly maxExpirationsPerDrive: number
  readonly maxWakeDispatchesPerDrive: number
  readonly maxConflictsPerDrive: number
  readonly maxActiveAttemptsPerParticipant: number
  readonly permittedWorkspaceModes: ReadonlySet<TeamTaskWorkspaceMode>
  readonly allowNonSharedWorkspaceModes: boolean
  readonly disposalTimeoutMs: number
  readonly pulseIntervalMs?: number
  readonly teamPageSize: number
  readonly channelPageSize: number
  readonly stallAfterUnassignableDrives: number
  readonly terminalChannelRetentionTail?: number
  readonly maxCompactionsPerDrive?: number
}

/** One coalesced drive owned by one Team identity. */
interface TeamDrive {
  /** Team whose current durable projection is being scanned. */
  readonly teamId: TeamId
  /** A Team event or explicit caller asked for another pass while this drive ran. */
  requested: boolean
  /** Resolves after every pass coalesced into this exact drive settles. */
  readonly operation: Promise<void>
  /** Resolves or rejects the public operation after the internal loop settles. */
  readonly settle: PromiseWithResolvers<void>
}

/** One ready task and the activation-backed participant selected to own it. */
interface AssignmentSelection extends TaskOwnerRank {
  /** Pending task selected in deterministic priority and creation order. */
  readonly task: TeamTaskSnapshot
  /** Participant selected after capability and current-load ranking. */
  readonly participant: ParticipantSnapshot
  /** Exact idle residency epoch that authorizes the selected agent lease. */
  readonly activation: ActivationBindingSnapshot
  /** Active lease count observed before this candidate assignment. */
  readonly load: number
  /** Declared capabilities not required by the selected task. */
  readonly capabilitySurplus: number
}

/** One assigned lease whose channel may still need its durable assignment Envelope. */
interface WakeRecoverySelection {
  /** Assigned task retaining an activation-bound wake channel. */
  readonly task: WakeLeasedTeamTask
  /** Durable binding frozen in the task-assignment channel manifest. */
  readonly activation: ActivationBindingSnapshot
}

/** Parsed assignment channel and Envelope after durable validation or publication. */
interface WakeEnvelopeResolution {
  /** Current durable channel projection that owns the assignment. */
  readonly channel: ChannelSnapshot
  /** Parsed accepted task-assignment Envelope. */
  readonly envelope: TaskAssignmentEnvelope
  /** Whether this scheduler appended the Envelope during this operation. */
  readonly posted: boolean
}

/** Provider-backed pre-allocation check used while building one deterministic candidate set. */
type WorkspaceEligibility = (
  mode: TeamTaskWorkspaceMode,
  request: TeamWorkspaceEligibilityRequest,
) => Promise<boolean>

/** Task projection whose active-phase invariant guarantees a current lease. */
type LeasedTeamTask = TeamTaskSnapshot & { readonly lease: TaskLeaseSnapshot }

/** Assigned agent lease whose immutable channel identity can carry one task-assignment Envelope. */
type WakeLeasedTeamTask = LeasedTeamTask & {
  readonly lease: TaskLeaseSnapshot & {
    readonly activationId: ActivationId
    readonly wakeChannelId: ChannelId
  }
}

/** Team task scheduler that leaves durable authority to the mounted Team provider. */
export class TeamDagScheduler {
  private readonly config: ResolvedConfig
  private readonly drives = new Map<string, TeamDrive>()
  private readonly accepted = new Set<Promise<void>>()
  private readonly listeners: (() => void)[] = []
  /** Task revisions this scheduler is currently committing through TeamRuntime. */
  private readonly ownTaskChanges = new Set<string>()
  /** Team journal cursors this scheduler advances while attaching a wake channel. */
  private readonly ownTeamChanges = new Set<string>()
  /** Last wake lease examined per Team, used to rotate bounded recovery scans. */
  private readonly wakeCursors = new Map<string, string>()
  private readonly unassignableDrives = new Map<string, number>()
  private readonly envelopePostProofs = new WeakMap<TeamSystemEnvelopePostProof, TeamSystemEnvelopePostScope>()
  private readonly taskReviewProofs = new WeakMap<TeamSystemTaskReviewProof, TeamSystemTaskReviewScope>()
  private readonly phaseProofs = new WeakMap<TeamSystemPhaseProof, TeamSystemPhaseScope>()
  private readonly maintenanceProofs = new WeakMap<TeamSystemMaintenanceProof, TeamSystemMaintenanceScope>()
  private readonly taskLeaseProofs = new Map<TeamSystemTaskLeaseProof, TeamSystemTaskLeaseScope>()
  private readonly schedulerChannelProofs = new Map<TeamSystemSchedulerChannelProof, TeamSystemSchedulerChannelScope>()
  /** Private source resolver registered while this scheduler owns ordinary protocol posts. */
  readonly envelopePostProofSource: TeamSystemEnvelopePostProofSource
  /** Private source resolver registered while this scheduler owns review-response recovery. */
  readonly taskReviewProofSource: TeamSystemTaskReviewProofSource
  /** Private source resolver registered while this scheduler owns bounded stall transitions. */
  readonly phaseProofSource: TeamSystemPhaseProofSource
  /** Private source resolver registered while this scheduler owns terminal prefix compaction. */
  readonly maintenanceProofSource: TeamSystemMaintenanceProofSource
  /** Private source resolver registered while this scheduler owns task assignment and lease expiry. */
  readonly taskLeaseProofSource: TeamSystemTaskLeaseProofSource
  /** Private source resolver registered while this scheduler owns review and wake channel lifecycle mutations. */
  readonly schedulerChannelProofSource: TeamSystemSchedulerChannelProofSource
  private pulseTimer: ReturnType<typeof setInterval> | undefined
  private started = false
  private readonly admissionAbort = new AbortController()
  private closing = false
  private disposal: Promise<void> | undefined

  /**
   * @param ctx - Context carrying Team authority and workspace eligibility.
   * @param config - Explicit lease, capacity, workspace, conflict, and shutdown limits.
   */
  constructor(private readonly ctx: Context, config: Config) {
    this.config = resolveConfig(config)
    this.envelopePostProofSource = Object.freeze({
      name: TEAM_SCHEDULER_ENVELOPE_POST_PROOF_SOURCE,
      resolveEnvelopePostProof: (proof: TeamSystemEnvelopePostProof): TeamSystemEnvelopePostScope | undefined =>
        this.closing ? undefined : this.envelopePostProofs.get(proof),
    })
    this.taskReviewProofSource = Object.freeze({
      name: TEAM_SCHEDULER_TASK_REVIEW_PROOF_SOURCE,
      resolveTaskReviewProof: (proof: TeamSystemTaskReviewProof): TeamSystemTaskReviewScope | undefined =>
        this.closing ? undefined : this.taskReviewProofs.get(proof),
    })
    this.phaseProofSource = Object.freeze({
      name: TEAM_SCHEDULER_PHASE_PROOF_SOURCE,
      resolvePhaseProof: (proof: TeamSystemPhaseProof): TeamSystemPhaseScope | undefined =>
        this.closing ? undefined : this.phaseProofs.get(proof),
    })
    this.maintenanceProofSource = Object.freeze({
      name: TEAM_SCHEDULER_MAINTENANCE_PROOF_SOURCE,
      resolveMaintenanceProof: (proof: TeamSystemMaintenanceProof): TeamSystemMaintenanceScope | undefined =>
        this.closing ? undefined : this.maintenanceProofs.get(proof),
    })
    this.taskLeaseProofSource = Object.freeze({
      name: TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE,
      resolveTaskLeaseProof: (proof: TeamSystemTaskLeaseProof): TeamSystemTaskLeaseScope | undefined =>
        this.closing ? undefined : this.taskLeaseProofs.get(proof),
    })
    this.schedulerChannelProofSource = Object.freeze({
      name: TEAM_SCHEDULER_CHANNEL_PROOF_SOURCE,
      resolveSchedulerChannelProof: (proof: TeamSystemSchedulerChannelProof): TeamSystemSchedulerChannelScope | undefined =>
        this.closing ? undefined : this.schedulerChannelProofs.get(proof),
    })
  }

  /**
   * Subscribe to post-commit Team changes, then begin the restart-safe initial scan.
   * The registration precedes bounded `listTeamsPage()` discovery so a Team mutation during discovery
   * marks the corresponding coalesced drive for another pass.
   */
  start(): void {
    if (this.started || this.closing) return
    this.started = true
    this.listeners.push(this.ctx.on('team/changed', (event) => {
      if (event.type === 'team/changed' && this.ownTeamChanges.delete(teamChangeKey(event.team))) return
      if (event.type === 'task/changed' && this.ownTaskChanges.delete(taskChangeKey(event.task))) {
        const current = this.drives.get(teamKey(event.task.teamId))
        if (current !== undefined) {
          current.requested = true
          return
        }
      }
      void this.requestTeamDrive(teamIdFromEvent(event))
    }))
    this.listeners.push(this.ctx.on('channel/changed', (event) => {
      void this.requestChannelDrive(event.channelId)
    }))
    if (this.config.pulseIntervalMs !== undefined) {
      this.pulseTimer = setInterval(() => { void this.drive() }, this.config.pulseIntervalMs)
      this.pulseTimer.unref()
    }
    void this.drive()
  }

  /**
   * Check consumption/time ceilings, expire due leases, then assign ready work for one Team or every discovered Team.
   * This method owns no deadline timer: callers or an explicit deployment pulse decide
   * when expiry is scanned.
   * @param request - optional Team restriction for this coalesced drive.
   * @returns resolution after the selected Team drive or discovery sweep settles.
   */
  drive(request: TeamSchedulerDriveRequest = {}): Promise<void> {
    if (this.closing) return Promise.resolve()
    const operation = request.teamId === undefined
      ? this.driveAllTeams()
      : this.requestTeamDrive(request.teamId)
    this.track(operation, request.teamId === undefined ? 'Team scheduler discovery drive' : `Team '${request.teamId}' scheduler drive`)
    return operation
  }

  /**
   * Stop future drives and await all accepted work within the configured disposal bound.
   * A command already handed to TeamRuntime remains that provider's accepted operation.
   * @returns resolution after accepted drives settle, or rejection with all observed cleanup failures.
   */
  close(): Promise<void> {
    this.disposal ??= this.dispose()
    return this.disposal
  }

  /** Discover current Teams, joining each existing per-Team coalesced drive. */
  private async driveAllTeams(): Promise<void> {
    let afterCursor = -1
    for (;;) {
      const page = await this.ctx.teams.listTeamsPage({ afterCursor, limit: this.config.teamPageSize })
      if (this.closing) return
      await Promise.all(page.items.map(team => this.requestTeamDrive(team.id)))
      if (page.nextCursor === undefined) return
      if (page.nextCursor <= afterCursor) throw new TeamError('scheduler Team discovery returned a non-advancing cursor', 'TEAM_CURSOR_CONFLICT')
      afterCursor = page.nextCursor
    }
  }

  /** Return one current or newly created coalesced Team drive. */
  private requestTeamDrive(teamId: TeamId): Promise<void> {
    const key = teamKey(teamId)
    const current = this.drives.get(key)
    if (current !== undefined) {
      current.requested = true
      return current.operation
    }
    const settle = Promise.withResolvers<void>()
    const drive: TeamDrive = { teamId, requested: true, operation: settle.promise, settle }
    this.drives.set(key, drive)
    const operation = this.runTeamDrive(drive)
    void operation.then(settle.resolve, settle.reject)
    this.track(settle.promise, `Team '${teamId}' scheduler drive`)
    return settle.promise
  }

  /** Route one post-commit channel record back to its owning coalesced Team drive. */
  private async requestChannelDrive(channelId: ChannelId): Promise<void> {
    try {
      const channel = await this.ctx.teams.getChannel({ channelId })
      if (this.closing) return
      await this.requestTeamDrive(channel.manifest.teamId)
    } catch (error: unknown) {
      if (!this.closing) this.ctx.logger.warn(`team-scheduler-dag: channel '${channelId}' drive request failed: ${renderError(error)}`)
    }
  }

  /** Drain all signals coalesced for one Team without allowing a listener storm to overlap CAS decisions. */
  private async runTeamDrive(drive: TeamDrive): Promise<void> {
    let retries = 0
    try {
      while (drive.requested && !this.closing) {
        drive.requested = false
        try {
          await this.driveTeam(drive.teamId)
          retries = 0
        } catch (error: unknown) {
          // A cursor can advance between the drive's read and a bounded
          // channel-maintenance or assignment CAS. `driveTeam` retries its
          // local step budget; retry the complete scan with a fresh projection
          // before surfacing a non-race failure to the scheduler owner.
          // oxlint-disable-next-line typescript/no-unnecessary-condition -- close() can race the retry delay.
          if (this.closing && error === this.admissionAbort.signal.reason) return
          if (!isRetryableRace(error) || retries >= this.config.maxConflictsPerDrive) throw error
          retries += 1
          drive.requested = true
          await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
        }
      }
    } finally {
      this.drives.delete(teamKey(drive.teamId))
    }
  }

  /** Expire due leases and TTL deliveries, repair review/assignment Channels, run opt-in retention, then assign ready work. */
  private async driveTeam(teamId: TeamId): Promise<void> {
    const placement = this.ctx.get('teamPlacement')
    if (placement !== undefined) await placement.prepare(teamId, this.admissionAbort.signal)
    const scanNow = Date.now()
    let expired = 0
    let assigned = 0
    let wakeDispatches = 0
    let conflicts = 0
    let compactions = 0
    const verifiedWakes = new Set<string>()
    while (!this.closing) {
      const state = await this.ctx.teams.getTeam({ teamId })
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- close() can run while getTeam() is pending.
      if (this.closing) return

      const canExpireDeliveries = state.team.phase === 'active'
        || (state.team.phase === 'quiescing' && state.team.cancellation !== undefined)
      if (canExpireDeliveries && expired < this.config.maxExpirationsPerDrive) {
        try {
          const expiredDeliveries = await this.expireDueChannelDeliveries(
            state,
            scanNow,
            this.config.maxExpirationsPerDrive - expired,
          )
          if (expiredDeliveries > 0) {
            expired += expiredDeliveries
            continue
          }
        } catch (error: unknown) {
          // oxlint-disable-next-line typescript/no-unnecessary-condition -- close() can revoke an in-flight expiry proof.
          if (this.closing) return
          if (isPolicyDenial(error)) return
          if (!isRetryableRace(error) || conflicts >= this.config.maxConflictsPerDrive) throw error
          conflicts += 1
          continue
        }
      }

      if (state.team.phase === 'active') {
        const budget = expiredTeamBudget(state, scanNow)
        if (budget !== undefined) {
          await this.stallTeam(state, budget)
          return
        }
      }

      const cancelledReview = state.tasks.find(task => (task.phase === 'review' || task.phase === 'pending') && task.cancellation !== undefined)
      if (cancelledReview?.cancellation !== undefined) {
        if (expired >= this.config.maxExpirationsPerDrive) return
        const input = { teamId, taskId: cancelledReview.id, expectedRevision: cancelledReview.revision,
          requestedRevision: cancelledReview.cancellation.requestedRevision }
        try {
          await this.withTaskLeaseProof({ kind: 'scheduler-task-cancellation-reconcile', ...input }, async actor =>
            await this.ctx.teams.reconcileTaskCancellation({ actor, ...input }))
          expired += 1
          continue
        } catch (error: unknown) {
          if (isPolicyDenial(error)) return
          if (!isRetryableRace(error) || conflicts >= this.config.maxConflictsPerDrive) throw error
          conflicts += 1
          continue
        }
      }

      if (state.team.phase !== 'active') {
        if (this.config.terminalChannelRetentionTail !== undefined && this.config.maxCompactionsPerDrive !== undefined) {
          compactions += await this.compactTerminalStreams(
            state,
            this.config.maxCompactionsPerDrive - compactions,
          )
        }
        return
      }

      const due = selectExpiredTask(state, scanNow)
      if (due !== undefined) {
        if (expired >= this.config.maxExpirationsPerDrive) return
        const ownChange = taskChangeKey({ ...due, revision: due.revision + 1 })
        this.ownTaskChanges.add(ownChange)
        try {
          const input = {
            teamId,
            taskId: due.id,
            expectedRevision: due.revision,
            attemptId: due.lease.attemptId,
          }
          await this.withTaskLeaseProof({ kind: 'scheduler-task-expire', ...input }, async actor =>
            await this.ctx.teams.expireTaskAttempt({ actor, ...input }))
          expired += 1
          conflicts = 0
          continue
        } catch (error: unknown) {
          // oxlint-disable-next-line typescript/no-unnecessary-condition -- scheduler close can race the proof-authorized expiry call.
          if (this.closing) return
          if (isPolicyDenial(error)) return
          if (!isRetryableRace(error) || conflicts >= this.config.maxConflictsPerDrive) throw error
          conflicts += 1
          continue
        } finally {
          this.ownTaskChanges.delete(ownChange)
        }
      }

      const wake = selectWakeRecovery(state, verifiedWakes, this.wakeCursors.get(teamKey(teamId)))
      if (wake !== undefined) {
        if (wakeDispatches >= this.config.maxWakeDispatchesPerDrive) return
        try {
          const resolution = await this.ensureWakeEnvelope(wake)
          wakeDispatches += 1
          verifiedWakes.add(wakeKey(wake.task))
          this.wakeCursors.set(teamKey(teamId), wakeKey(wake.task))
          conflicts = 0
          if (resolution.posted) this.emitAssignment(wake.task, wake.activation, resolution)
          continue
        } catch (error: unknown) {
          if (isPolicyDenial(error)) return
          if (!isRetryableRace(error) || conflicts >= this.config.maxConflictsPerDrive) throw error
          conflicts += 1
          continue
        }
      }

      if (verifiedWakes.size === 0) this.wakeCursors.delete(teamKey(teamId))

      if (wakeDispatches < this.config.maxWakeDispatchesPerDrive && await this.ensureReviewDispatch(state)) {
        wakeDispatches += 1
        continue
      }

      if (this.config.terminalChannelRetentionTail !== undefined && this.config.maxCompactionsPerDrive !== undefined) {
        compactions += await this.compactTerminalStreams(
          state,
          this.config.maxCompactionsPerDrive - compactions,
        )
      }

      if (assigned >= this.config.maxAssignmentsPerDrive) return
      const concurrencyLimit = minimumBudgetLimit(state.budgets['maxConcurrency'], undefined, false)
      if (concurrencyLimit !== undefined && state.tasks.reduce((sum, task) => sum + taskConcurrencyUsage(task), 0) >= concurrencyLimit) {
        if (concurrencyLimit === 0 && state.tasks.some(task => isReadyTask(task, state))) {
          await this.stallTeam(state, {
            code: 'TEAM_CONCURRENCY_BUDGET_EXCEEDED',
            message: `Team '${state.team.id}' reached its maxConcurrency budget of 0`,
          })
        } else if (concurrencyLimit > 0) {
          this.unassignableDrives.delete(teamKey(state.team.id))
        }
        return
      }
      const selection = await selectAssignment(
        state,
        this.config,
        async (mode, request) => await this.ctx.teamWorkspaces.eligible(mode, request),
      )
      if (selection === undefined) {
        const retryBudget = blockedRetryBudget(state, this.config)
        if (retryBudget !== undefined) {
          await this.stallTeam(state, retryBudget)
          return
        }
        await this.maybeMarkStalled(state)
        return
      }
      try {
        const wake = await this.assignTaskWithWakeChannel(state, selection)
        assigned += 1
        const resolution = await this.ensureWakeEnvelope(wake)
        verifiedWakes.add(wakeKey(wake.task))
        conflicts = 0
        this.emitAssignment(wake.task, wake.activation, resolution)
      } catch (error: unknown) {
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- scheduler close can race the proof-authorized assignment call.
        if (this.closing) return
        if (isPolicyDenial(error)) return
        if (!isRetryableRace(error) || conflicts >= this.config.maxConflictsPerDrive) throw error
        conflicts += 1
      }
    }
  }

  /** Compact bounded terminal Team and channel prefixes through provider-owned watermark gates. */
  private async compactTerminalStreams(state: TeamStateSnapshot, limit: number): Promise<number> {
    if (limit <= 0 || this.config.terminalChannelRetentionTail === undefined) return 0
    let compacted = 0
    for (const channelId of state.channelIds) {
      if (compacted >= limit) break
      const channel = await this.ctx.teams.getChannel({ channelId })
      if (channel.phase !== 'closed' && channel.phase !== 'expired' && channel.phase !== 'failed') continue
      const throughSequence = channel.cursor - this.config.terminalChannelRetentionTail - 1
      if (throughSequence < 0 || (channel.firstCursor !== undefined && throughSequence < channel.firstCursor)) continue
      const request: TeamChannelCompactInput = {
        teamId: state.team.id,
        channelId,
        expectedCursor: channel.cursor,
        throughSequence,
      }
      try {
        await this.compactChannelPrefix(request)
        compacted += 1
      } catch (error: unknown) {
        // A pending recipient is a normal retention veto; the next drive can retry after its receipt.
        if (isRetentionNotReady(error) || isPolicyDenial(error)) continue
        if (isRetryableRace(error)) continue
        throw error
      }
    }
    if (compacted >= limit) return compacted
    const teamThroughSequence = state.team.cursor - this.config.terminalChannelRetentionTail - 1
    const terminalTeam = state.team.phase === 'completed' || state.team.phase === 'failed' || state.team.phase === 'cancelled'
    if (terminalTeam && teamThroughSequence >= 0) {
      const request: TeamJournalCompactInput = {
        teamId: state.team.id,
        expectedCursor: state.team.cursor,
        throughSequence: teamThroughSequence,
      }
      try {
        await this.compactTeamPrefix(request)
        compacted += 1
      } catch (error: unknown) {
        if (isRetentionNotReady(error) || isPolicyDenial(error)) return compacted
        if (!isRetryableRace(error)) throw error
      }
    }
    return compacted
  }

  /** Compact one terminal Team journal prefix through the exact scheduler-maintenance proof. */
  private async compactTeamPrefix(input: TeamJournalCompactInput): Promise<void> {
    const scope: TeamSystemMaintenanceScope = {
      kind: 'scheduler-team-journal-compaction',
      ...input,
    }
    await this.withMaintenanceProof(scope, async (actor) => {
      await this.ctx.teams.compactTeam({ actor, ...input })
    })
  }

  /** Compact one terminal channel-WAL prefix through the exact scheduler-maintenance proof. */
  private async compactChannelPrefix(input: TeamChannelCompactInput): Promise<void> {
    const scope: TeamSystemMaintenanceScope = {
      kind: 'scheduler-channel-compaction',
      ...input,
    }
    await this.withMaintenanceProof(scope, async (actor) => {
      await this.ctx.teams.compactChannel({ actor, ...input })
    })
  }

  /** Retain one exact destructive-maintenance proof only for its single TeamRuntime call. */
  private async withMaintenanceProof<T>(
    scope: TeamSystemMaintenanceScope,
    operation: (actor: TeamSystemMaintenanceProof) => Promise<T>,
  ): Promise<T> {
    const proof = createTeamSchedulerMaintenanceProof()
    this.maintenanceProofs.set(proof, Object.freeze(structuredClone(scope)))
    try {
      return await operation(proof)
    } finally {
      this.maintenanceProofs.delete(proof)
    }
  }

  /** Retain one exact scheduler task-lease proof only for its single TeamRuntime call. */
  private async withTaskLeaseProof<T>(
    scope: TeamSystemTaskLeaseScope,
    operation: (actor: TeamSystemTaskLeaseProof) => Promise<T>,
  ): Promise<T> {
    if (this.closing) throw new TeamError('Team scheduler is disposing', 'TEAM_DISPOSED')
    const proof = createTeamSchedulerTaskLeaseProof()
    this.taskLeaseProofs.set(proof, Object.freeze(structuredClone(scope)))
    try {
      return await operation(proof)
    } finally {
      this.taskLeaseProofs.delete(proof)
    }
  }

  /** Expire a bounded prefix of TTL-bound channel deliveries for one Team. */
  private async expireDueChannelDeliveries(
    state: TeamStateSnapshot,
    now: number,
    limit: number,
  ): Promise<number> {
    let expired = 0
    for (const channelId of state.channelIds) {
      if (expired >= limit) break
      const channel = await this.ctx.teams.getChannel({ channelId })
      const input: SchedulerChannelDeliveryExpireInput = {
        teamId: state.team.id,
        channelId,
        expectedTeamCursor: state.team.cursor,
        expectedChannelCursor: channel.cursor,
        now,
        limit: limit - expired,
      }
      const result = await this.expireSchedulerChannelDeliveries(input)
      expired += result.expired.length
    }
    return expired
  }

  /** Persist a stalled lifecycle when pending work has no possible owner. */
  private async maybeMarkStalled(state: TeamStateSnapshot): Promise<void> {
    const inProgress = state.tasks.some((task) => {
      if (task.phase === 'assigned' || task.phase === 'running') return true
      if (task.phase !== 'review' || task.reviewPolicy.kind !== 'participant') return false
      const reviewerId = task.reviewPolicy.reviewerId
      return state.participants.some(participant => participant.id === reviewerId && participant.phase === 'active')
        && state.activations.some(binding => binding.activation.participantId === reviewerId
          && (binding.activation.status === 'idle' || binding.activation.status === 'running'))
    })
    if (inProgress) {
      this.unassignableDrives.delete(teamKey(state.team.id))
      return
    }
    const pending = state.tasks.filter((task) => {
      if (task.execution.kind !== 'participant') return false
      if (task.phase === 'pending') return task.cancellation === undefined && task.attemptCount < task.maxAttempts && workflowTaskSchedulable(task, state)
      return task.phase === 'review' && task.reviewPolicy.kind === 'participant'
    })
    if (pending.length === 0) {
      this.unassignableDrives.delete(teamKey(state.team.id))
      return
    }
    const ready = pending.filter(task => task.phase === 'review' || isReadyTask(task, state))
    for (const task of ready) {
      if (task.phase !== 'pending' || task.cancellation !== undefined || !this.config.permittedWorkspaceModes.has(task.workspaceMode)) continue
      for (const participant of state.participants) {
        const possible = potentialOwnerActivation(participant, task, state)
        if (possible === undefined) continue
        const workspaceEligible = await this.ctx.teamWorkspaces.eligible(task.workspaceMode, { task, binding: possible })
        if (this.closing) return
        if (workspaceEligible) {
          this.unassignableDrives.delete(teamKey(state.team.id))
          return
        }
      }
    }
    const reason = ready.length === 0
      ? { code: 'TASK_DEPENDENCY_DEADLOCK', message: 'Pending Team tasks are blocked by incomplete or terminal dependencies.' }
      : { code: 'TASK_NO_ELIGIBLE_OWNER', message: 'Ready Team tasks have no eligible active participant or workspace.' }
    const key = teamKey(state.team.id)
    const count = (this.unassignableDrives.get(key) ?? 0) + 1
    this.unassignableDrives.set(key, count)
    if (count < this.config.stallAfterUnassignableDrives || state.team.phase !== 'active') return
    try {
      await this.stallTeam(state, reason)
      this.unassignableDrives.delete(key)
    } catch (error: unknown) {
      if (!isRetryableRace(error)) throw error
    }
  }

  /** Commit one scheduler-owned stalled phase through a private exact phase proof. */
  private async stallTeam(state: TeamStateSnapshot, reason: TeamStallReason): Promise<void> {
    const proof = createTeamSchedulerPhaseProof()
    const scope: TeamSystemPhaseScope = {
      kind: 'scheduler-stall',
      teamId: state.team.id,
      phase: 'stalled',
      reason: structuredClone(reason),
    }
    this.phaseProofs.set(proof, Object.freeze(structuredClone(scope)))
    try {
      await this.ctx.teams.transitionTeamPhase({
        actor: proof,
        teamId: state.team.id,
        expectedCursor: state.team.cursor,
        phase: 'stalled',
        reason,
      })
    } finally {
      this.phaseProofs.delete(proof)
    }
  }

  /** Ensure the first undispatched participant-review task has a durable consult request. */
  private async ensureReviewDispatch(state: TeamStateSnapshot): Promise<boolean> {
    for (const task of state.tasks) {
      if (task.phase !== 'review' || task.reviewPolicy.kind !== 'participant') continue
      const reviewerId = task.reviewPolicy.reviewerId
      const reviewer = state.participants.find(participant => participant.id === reviewerId)
      if (reviewer === undefined || reviewer.phase !== 'active') continue
      const attempt = task.attemptHistory.at(-1)
      if (attempt?.outcome.kind !== 'completed') continue
      const senderId = attempt.participantId
      const sender = state.participants.find(participant => participant.id === senderId)
      if (sender?.phase !== 'active') continue
      const existing = await this.findReviewChannel(state, task.id, attempt.id, senderId, reviewer.id)
      if (existing !== undefined) {
        let reviewRequest: TeamEnvelope | undefined
        let reviewResponse: TeamEnvelope | undefined
        await this.scanChannelPages(existing.manifest.id, (records: readonly ChannelRecord[]) => {
          for (const record of records) {
            if (record.type !== 'channel/envelope') continue
            if (reviewRequest === undefined
              && record.envelope.kind === CONSULT_REVIEW_REQUEST_KIND
              && record.envelope.taskId === task.id) reviewRequest = record.envelope
            if (reviewRequest !== undefined
              && record.envelope.kind === CONSULT_RESPONSE_KIND
              && record.envelope.causationId === reviewRequest.id
              && record.envelope.taskId === task.id) reviewResponse = record.envelope
          }
          return reviewResponse
        })
        if (reviewRequest !== undefined) {
          if (reviewResponse !== undefined) {
            const response = parseConsultReviewResponsePayload(reviewResponse.payload)
            await this.recoverTaskReviewResponse({
              kind: 'scheduler-review-response',
              teamId: task.teamId,
              taskId: task.id,
              expectedRevision: task.revision,
              attemptId: attempt.id,
              reviewerId: reviewer.id,
              initiatorId: senderId,
              channelId: existing.manifest.id,
              requestEnvelopeId: reviewRequest.id,
              responseEnvelopeId: reviewResponse.id,
              nextPhase: response.decision === 'accepted' ? 'completed' : 'pending',
              reason: response.text,
            })
            return true
          }
          continue
        }
        const activation = state.activations.find(binding => binding.activation.participantId === reviewer.id
          && binding.activation.status === 'idle')
        if (activation === undefined) continue
        await this.postReviewRequest(existing, task, reviewer.id, senderId, activation)
        return true
      }
      const activation = state.activations.find(binding => binding.activation.participantId === reviewer.id
        && binding.activation.status === 'idle')
      if (activation === undefined) continue
      const channel = await this.openSchedulerReviewChannel({
        kind: 'scheduler-review-channel-open',
        teamId: task.teamId,
        expectedTeamCursor: state.team.cursor,
        taskId: task.id,
        expectedRevision: task.revision,
        attemptId: attempt.id,
        initiatorId: senderId,
        reviewerId: reviewer.id,
        reviewerActivationId: activation.activation.id,
        reviewerSessionId: activation.sessionId,
        reviewerProvider: activation.provider,
      })
      await this.postReviewRequest(channel, task, reviewer.id, senderId, activation)
      return true
    }
    return false
  }

  /** Find the durable review request for one completed attempt and reviewer pair. */
  private async findReviewChannel(
    state: TeamStateSnapshot,
    taskId: TeamTaskId,
    attemptId: TaskLeaseSnapshot['attemptId'],
    senderId: ParticipantSnapshot['id'],
    reviewerId: ParticipantSnapshot['id'],
  ): Promise<ChannelSnapshot | undefined> {
    for (const channelId of state.channelIds) {
      const channel = await this.ctx.teams.getChannel({ channelId })
      if (channel.manifest.adapter.type !== CONSULT_CHANNEL_ADAPTER_V1.type
        || channel.manifest.adapter.version !== CONSULT_CHANNEL_ADAPTER_V1.version) continue
      const participants = channel.manifest.participants
      if (participants.length !== 2) continue
      const sender = participants[0]
      const reviewer = participants[1]
      if (sender === undefined || reviewer === undefined
        || sender.id !== senderId
        || sender.role !== CONSULT_INITIATOR_ROLE
        || reviewer.id !== reviewerId
        || reviewer.role !== CONSULT_RESPONDENT_ROLE) continue
      const found = await this.scanChannelPages(channelId, (records: readonly ChannelRecord[]) => records.some(record => record.type === 'channel/envelope'
        && record.envelope.kind === CONSULT_REVIEW_REQUEST_KIND
        && record.envelope.taskId === taskId
        && parseConsultReviewAssignmentPayload(record.envelope.payload).attemptId === attemptId) ? true : undefined)
      if (found.value === true) return found.channel
    }
    return undefined
  }

  /** Append one idempotent consult request carrying the completed task result. */
  private async postReviewRequest(
    channel: ChannelSnapshot,
    task: TeamTaskSnapshot,
    reviewerId: ParticipantSnapshot['id'],
    senderId: ParticipantSnapshot['id'],
    reviewerActivation: ActivationBindingSnapshot,
  ): Promise<void> {
    channel = await this.ctx.teamChannelAdmission.waitUntilActive({ channelId: channel.manifest.id, signal: this.admissionAbort.signal })
    const attempt = task.attemptHistory.at(-1)
    if (attempt?.outcome.kind !== 'completed') return
    const text = `Review Team task ${task.id}: ${task.subject}\n\n${task.description}\n\nResult: ${attempt.outcome.result.summary}`
    const existing = await this.scanChannelPages(channel.manifest.id, (records: readonly ChannelRecord[]) => records.some(record =>
      record.type === 'channel/envelope' && record.envelope.taskId === task.id) ? true : undefined)
    channel = existing.channel
    if (existing.value === true) return
    const envelope = await this.postSystemEnvelope({
      kind: 'scheduler-review-request',
      teamId: task.teamId,
      channelId: channel.manifest.id,
      taskId: task.id,
      attemptId: attempt.id,
      reviewRevision: task.revision,
      initiatorId: senderId,
      reviewerId,
      reviewerActivationId: reviewerActivation.activation.id,
      reviewerSessionId: reviewerActivation.sessionId,
      reviewerProvider: reviewerActivation.provider,
    }, {
      expectedCursor: channel.cursor,
      idempotencyKey: channelPostIdempotencyKeySchema.parse(`team-review:${String(task.id)}:${String(attempt.id)}`),
      draft: {
        channelId: channel.manifest.id,
        audience: [reviewerId],
        kind: CONSULT_REVIEW_REQUEST_KIND,
        payload: {
          text,
          taskId: task.id,
          attemptId: attempt.id,
          reviewRevision: task.revision,
          reviewerId,
          initiatorId: senderId,
          result: structuredClone(attempt.outcome.result) as unknown as JsonObject,
        },
        delivery: 'turn',
        taskId: task.id,
      },
    })
    parseConsultTextPayload(envelope.payload)
  }

  /** Open, validate, attach, and assign one persistent task-assignment channel. */
  private async assignTaskWithWakeChannel(
    state: TeamStateSnapshot,
    selection: AssignmentSelection,
  ): Promise<WakeRecoverySelection> {
    const channel = await this.openWakeChannel(state, selection)
    const ownChange = taskChangeKey({ ...selection.task, revision: selection.task.revision + 1 })
    this.ownTaskChanges.add(ownChange)
    try {
      const input = {
        teamId: selection.task.teamId,
        taskId: selection.task.id,
        expectedRevision: selection.task.revision,
        participantId: selection.participant.id,
        activationId: selection.activation.activation.id,
        wakeChannelId: channel.manifest.id,
        leaseDurationMs: this.config.leaseDurationMs,
      }
      const task = await this.withTaskLeaseProof({ kind: 'scheduler-task-assign', ...input }, async actor =>
        await this.ctx.teams.assignTask({ actor, ...input }))
      return assignmentWakeSelection(task, selection.activation, channel)
    } catch (error: unknown) {
      try {
        await this.closeUnassignedWakeChannel(channel, selection)
      } catch (cleanup: unknown) {
        throw new AggregateError([error, cleanup], `scheduler could not assign task '${selection.task.id}' or close its wake channel`)
      }
      throw error
    } finally {
      this.ownTaskChanges.delete(ownChange)
    }
  }

  /** Close a just-opened wake channel after its corresponding assignment did not commit. */
  private async closeUnassignedWakeChannel(channel: ChannelSnapshot, selection: AssignmentSelection): Promise<void> {
    const current = await this.ctx.teams.getChannel({ channelId: channel.manifest.id })
    if (current.phase === 'closed' || current.phase === 'expired' || current.phase === 'failed') return
    await this.withSchedulerChannelProof({
      kind: 'scheduler-failed-wake-channel-close',
      teamId: selection.task.teamId,
      taskId: selection.task.id,
      participantId: selection.participant.id,
      activationId: selection.activation.activation.id,
      sessionId: selection.activation.sessionId,
      channelId: current.manifest.id,
      expectedChannelCursor: current.cursor,
      reason: 'Task assignment did not commit',
    }, async actor => await this.ctx.teams.closeSchedulerFailedWakeChannel({
      actor,
      teamId: selection.task.teamId,
      taskId: selection.task.id,
      participantId: selection.participant.id,
      activationId: selection.activation.activation.id,
      sessionId: selection.activation.sessionId,
      channelId: current.manifest.id,
      expectedChannelCursor: current.cursor,
    }))
  }

  /** Open one self-addressed task-assignment channel and validate its frozen binding facts. */
  private async openWakeChannel(state: TeamStateSnapshot, selection: AssignmentSelection): Promise<ChannelSnapshot> {
    const ownChange = teamChangeKey({ ...state.team, cursor: state.team.cursor + 1 })
    this.ownTeamChanges.add(ownChange)
    try {
      let channel = await this.openSchedulerWakeChannel({
        kind: 'scheduler-wake-channel-open',
        teamId: selection.task.teamId,
        expectedTeamCursor: state.team.cursor,
        taskId: selection.task.id,
        expectedRevision: selection.task.revision,
        participantId: selection.participant.id,
        activationId: selection.activation.activation.id,
        sessionId: selection.activation.sessionId,
      })
      channel = await this.ctx.teamChannelAdmission.waitUntilActive({ channelId: channel.manifest.id, signal: this.admissionAbort.signal })
      assertWakeManifest(channel, selection.task, selection.participant.id, selection.activation)
      return channel
    } finally {
      this.ownTeamChanges.delete(ownChange)
    }
  }

  /** Return an existing valid task-assignment Envelope or append the one durable self-addressed assignment. */
  private async ensureWakeEnvelope(selection: WakeRecoverySelection): Promise<WakeEnvelopeResolution> {
    await this.ctx.teamChannelAdmission.waitUntilActive({
      channelId: selection.task.lease.wakeChannelId, signal: this.admissionAbort.signal,
    })
    let existing: TeamEnvelope | undefined
    const read = await this.scanChannelPages(selection.task.lease.wakeChannelId, (records: readonly ChannelRecord[]) => {
      for (const record of records) {
        if (record.type !== 'channel/envelope') continue
        if (existing !== undefined) {
          throw new Error(`task-assignment channel '${selection.task.lease.wakeChannelId}' contains multiple assignment Envelopes`)
        }
        existing = record.envelope
      }
      return undefined
    })
    assertWakeManifest(read.channel, selection.task, selection.task.lease.participantId, selection.activation)
    if (existing !== undefined) {
      return {
        channel: read.channel,
        envelope: assertWakeEnvelope(read.channel, existing, selection.task, selection.activation),
        posted: false,
      }
    }
    const envelope = await this.postSystemEnvelope({
      kind: 'scheduler-assignment',
      teamId: selection.task.teamId,
      channelId: read.channel.manifest.id,
      taskId: selection.task.id,
      attemptId: selection.task.lease.attemptId,
      assignedRevision: selection.task.lease.assignedRevision,
      assigneeId: selection.task.lease.participantId,
      activationId: selection.activation.activation.id,
      sessionId: selection.activation.sessionId,
    }, {
      expectedCursor: read.channel.cursor,
      draft: {
        channelId: read.channel.manifest.id,
        audience: [selection.task.lease.participantId],
        kind: TASK_ASSIGNMENT_ENVELOPE_KIND,
        payload: {
          taskId: selection.task.id,
          attemptId: selection.task.lease.attemptId,
          assignedRevision: selection.task.lease.assignedRevision,
          activationId: selection.activation.activation.id,
          sessionId: selection.activation.sessionId,
        },
        delivery: 'turn',
        taskId: selection.task.id,
      },
    })
    const channel = await this.ctx.teams.getChannel({ channelId: read.channel.manifest.id })
    return {
      channel,
      envelope: assertWakeEnvelope(channel, envelope, selection.task, selection.activation),
      posted: true,
    }
  }

  /** Scan one channel WAL in bounded pages and fail closed on a non-advancing continuation. */
  private async scanChannelPages<T>(
    channelId: ChannelId,
    inspect: (records: readonly ChannelRecord[]) => T | undefined,
  ): Promise<{ readonly channel: ChannelSnapshot; readonly value?: T }> {
    let afterCursor = -1
    for (;;) {
      const page = await this.ctx.teams.readChannelPage({
        channelId,
        afterCursor,
        limit: this.config.channelPageSize,
      })
      const value = inspect(page.records)
      if (value !== undefined) return { channel: page.channel, value }
      if (page.nextCursor === undefined) return { channel: page.channel }
      if (page.nextCursor <= afterCursor) {
        throw new TeamError(
          `Scheduler channel '${channelId}' returned a non-advancing page cursor`,
          'TEAM_CHANNEL_CURSOR_CONFLICT',
        )
      }
      afterCursor = page.nextCursor
    }
  }

  /** Append one scheduler-owned protocol Envelope through a private source-scoped proof. */
  private async postSystemEnvelope(
    scope: TeamSystemEnvelopePostScope,
    input: ChannelEnvelopePostInput,
  ): Promise<TeamEnvelope> {
    const proof = createTeamSchedulerEnvelopePostProof()
    this.envelopePostProofs.set(proof, Object.freeze(structuredClone(scope)))
    try {
      return await this.ctx.teams.postChannelEnvelope({ actor: proof, ...input })
    } finally {
      this.envelopePostProofs.delete(proof)
    }
  }

  /** Issue one exact scheduler channel proof and revoke it after its canonical Hub mutation settles. */
  private async withSchedulerChannelProof<T>(
    scope: TeamSystemSchedulerChannelScope,
    operation: (actor: TeamSystemSchedulerChannelProof) => Promise<T>,
  ): Promise<T> {
    if (this.closing) throw new Error('Team scheduler is disposing')
    const proof = createTeamSchedulerChannelProof()
    this.schedulerChannelProofs.set(proof, Object.freeze(structuredClone(scope)))
    try {
      return await operation(proof)
    } finally {
      this.schedulerChannelProofs.delete(proof)
    }
  }

  /** Expire one exact bounded TTL delivery batch through the scheduler's private channel source. */
  private async expireSchedulerChannelDeliveries(
    input: SchedulerChannelDeliveryExpireInput,
  ): Promise<ChannelDeliveryExpireResult> {
    const scope: TeamSystemSchedulerChannelScope = {
      kind: 'scheduler-channel-delivery-expire',
      ...input,
    }
    return await this.withSchedulerChannelProof(scope, async actor =>
      await this.ctx.teams.expireSchedulerChannelDeliveries({ actor, ...input }))
  }

  /** Open one exact scheduler-owned participant-review consult channel. */
  private async openSchedulerReviewChannel(
    scope: Extract<TeamSystemSchedulerChannelScope, { readonly kind: 'scheduler-review-channel-open' }>,
  ): Promise<ChannelSnapshot> {
    return await this.withSchedulerChannelProof(scope, async actor =>
      await this.ctx.teams.openSchedulerReviewChannel({
        actor,
        teamId: scope.teamId,
        expectedTeamCursor: scope.expectedTeamCursor,
        taskId: scope.taskId,
        expectedRevision: scope.expectedRevision,
        attemptId: scope.attemptId,
        initiatorId: scope.initiatorId,
        reviewerId: scope.reviewerId,
        reviewerActivationId: scope.reviewerActivationId,
        reviewerSessionId: scope.reviewerSessionId,
        reviewerProvider: scope.reviewerProvider,
      }))
  }

  /** Open one exact scheduler-owned self-addressed task-assignment wake channel. */
  private async openSchedulerWakeChannel(
    scope: Extract<TeamSystemSchedulerChannelScope, { readonly kind: 'scheduler-wake-channel-open' }>,
  ): Promise<ChannelSnapshot> {
    return await this.withSchedulerChannelProof(scope, async actor =>
      await this.ctx.teams.openSchedulerWakeChannel({
        actor,
        teamId: scope.teamId,
        expectedTeamCursor: scope.expectedTeamCursor,
        taskId: scope.taskId,
        expectedRevision: scope.expectedRevision,
        participantId: scope.participantId,
        activationId: scope.activationId,
        sessionId: scope.sessionId,
      }))
  }

  /** Resolve one already-durable consult response through a private recovery proof. */
  private async recoverTaskReviewResponse(scope: TeamSystemTaskReviewScope): Promise<TeamTaskSnapshot> {
    const proof = createTeamSchedulerTaskReviewProof()
    this.taskReviewProofs.set(proof, Object.freeze(structuredClone(scope)))
    try {
      return await this.ctx.teams.resolveTaskReviewFromResponse({ actor: proof })
    } finally {
      this.taskReviewProofs.delete(proof)
    }
  }

  /** Emit a post-WAL advisory assignment notification while containing observer failures. */
  private emitAssignment(
    task: TeamTaskSnapshot,
    activation: ActivationBindingSnapshot,
    wake: WakeEnvelopeResolution,
  ): void {
    const notice = deepFreeze({
      task: structuredClone(task),
      activation: structuredClone(activation),
      channel: structuredClone(wake.channel),
      envelope: structuredClone(wake.envelope),
    })
    const args: unknown[] = [this, 'team-scheduler/assigned', notice]
    for (const callback of this.ctx.events.dispatch('emit', args)) {
      try {
        const returned = (callback as (...values: unknown[]) => unknown)(...args)
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`team-scheduler-dag: assignment listener rejected: ${renderError(error)}`)
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`team-scheduler-dag: assignment listener threw: ${renderError(error)}`)
      }
    }
  }

  /** Retain a rejection handler for background work without changing the public promise result. */
  private track(operation: Promise<void>, label: string): void {
    if (this.accepted.has(operation)) return
    this.accepted.add(operation)
    void operation.then(
      () => { this.accepted.delete(operation) },
      (error: unknown) => {
        this.accepted.delete(operation)
        this.ctx.logger.warn(`team-scheduler-dag: ${label} failed: ${renderError(error)}`)
      },
    )
  }

  /** Release listeners, await accepted work, and aggregate any completed-drive failures. */
  private async dispose(): Promise<void> {
    this.closing = true
    this.admissionAbort.abort()
    if (this.pulseTimer !== undefined) {
      clearInterval(this.pulseTimer)
      this.pulseTimer = undefined
    }
    for (const stop of this.listeners.splice(0)) stop()
    this.unassignableDrives.clear()
    const accepted = [...this.accepted]
    if (accepted.length === 0) {
      this.taskLeaseProofs.clear()
      this.schedulerChannelProofs.clear()
      return
    }
    const settledPromise = Promise.allSettled(accepted)
    let settled: readonly PromiseSettledResult<void>[]
    try {
      settled = await withTimeout(settledPromise, this.config.disposalTimeoutMs)
    } catch (error: unknown) {
      void settledPromise.then(() => {
        this.taskLeaseProofs.clear()
        this.schedulerChannelProofs.clear()
      })
      throw error
    }
    this.taskLeaseProofs.clear()
    this.schedulerChannelProofs.clear()
    const failures: unknown[] = []
    for (const result of settled) {
      if (result.status === 'rejected') failures.push(result.reason)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Team scheduler disposal failed')
  }
}

/** Install one scheduler whose state remains wholly owned by the mounted Team provider. */
export function apply(ctx: Context, config: Config): () => Promise<void> {
  const scheduler = new TeamDagScheduler(ctx, config)
  const unregisterEnvelopePost = ctx.teams.registerSystemEnvelopePostProofSource(scheduler.envelopePostProofSource)
  const unregisterTaskReview = ctx.teams.registerSystemTaskReviewProofSource(scheduler.taskReviewProofSource)
  const unregisterPhase = ctx.teams.registerSystemPhaseProofSource(scheduler.phaseProofSource)
  const unregisterMaintenance = ctx.teams.registerSystemMaintenanceProofSource(scheduler.maintenanceProofSource)
  const unregisterTaskLease = ctx.teams.registerSystemTaskLeaseProofSource(scheduler.taskLeaseProofSource)
  const unregisterSchedulerChannel = ctx.teams.registerSystemSchedulerChannelProofSource(scheduler.schedulerChannelProofSource)
  scheduler.start()
  return async () => {
    try {
      await scheduler.close()
    } finally {
      try {
        unregisterSchedulerChannel()
      } finally {
        try {
          unregisterTaskLease()
        } finally {
          try {
            unregisterMaintenance()
          } finally {
            try {
              unregisterPhase()
            } finally {
              try {
                unregisterTaskReview()
              } finally {
                unregisterEnvelopePost()
              }
            }
          }
        }
      }
    }
  }
}

/** Create one non-serializable proof that only the scheduler's private source can resolve. */
function createTeamSchedulerEnvelopePostProof(): TeamSystemEnvelopePostProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team scheduler Envelope-post proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemEnvelopePostProof
}

/** Create one non-serializable proof that only the scheduler's private recovery source can resolve. */
function createTeamSchedulerTaskReviewProof(): TeamSystemTaskReviewProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team scheduler task-review proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemTaskReviewProof
}

/** Create one non-serializable proof that only the scheduler's channel source can resolve. */
function createTeamSchedulerChannelProof(): TeamSystemSchedulerChannelProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team scheduler channel proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemSchedulerChannelProof
}

/** Create one non-serializable proof that only the scheduler's phase source can resolve. */
function createTeamSchedulerPhaseProof(): TeamSystemPhaseProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team scheduler phase proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemPhaseProof
}

/** Create one non-serializable proof that only the scheduler's maintenance source can resolve. */
function createTeamSchedulerMaintenanceProof(): TeamSystemMaintenanceProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team scheduler maintenance proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemMaintenanceProof
}

/** Create one non-serializable proof that only the scheduler's task-lease source can resolve. */
function createTeamSchedulerTaskLeaseProof(): TeamSystemTaskLeaseProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team scheduler task-lease proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemTaskLeaseProof
}

/** Select the next elapsed task lease in expiration then durable creation order. */
function selectExpiredTask(state: TeamStateSnapshot, now: number): LeasedTeamTask | undefined {
  return state.tasks
    .map((task, index) => ({ task, index }))
    .filter((entry): entry is { readonly task: LeasedTeamTask; readonly index: number } =>
      isLeasedTask(entry.task) && entry.task.cancellation?.expiredAt === undefined && entry.task.lease.expiresAt <= now)
    .sort((left, right) => compareNumber(left.task.lease.expiresAt, right.task.lease.expiresAt) || left.index - right.index)[0]
    ?.task
}

/** Return the first frozen consumption or time ceiling reached during this drive. */
function expiredTeamBudget(
  state: TeamStateSnapshot,
  now: number,
): TeamStallReason | undefined {
  const teamLimits = asJsonObject(state.rules['teamLimits'])
  const typed = state.budgets
  const wallTimeLimit = minimumBudgetLimit(
    typed['maxWallTimeMs'],
    teamLimits?.['maxWallTimeMsPerTeam'],
    false,
  )
  if (wallTimeLimit !== undefined && Math.max(0, now - state.team.createdAt) >= wallTimeLimit) {
    return {
      code: 'TEAM_WALL_TIME_BUDGET_EXCEEDED',
      message: `Team '${state.team.id}' exceeded its ${String(wallTimeLimit)}ms wall-time budget`,
    }
  }

  const usage = state.usage
  const inputTokens = usage?.inputTokens ?? 0
  const outputTokens = usage?.outputTokens ?? 0
  const turns = usage?.turns ?? 0
  const costUnits = usage?.costUnits ?? 0
  const ceilings: readonly {
    readonly key: 'maxInputTokens' | 'maxOutputTokens' | 'maxTotalTokens' | 'maxTurns' | 'maxCostUnits'
    readonly value: number
    readonly legacy?: string
    readonly code: string
  }[] = [
    { key: 'maxInputTokens', value: inputTokens, code: 'TEAM_INPUT_TOKENS_BUDGET_EXCEEDED' },
    { key: 'maxOutputTokens', value: outputTokens, legacy: 'maxModelTokensPerTeam', code: 'TEAM_TOKEN_BUDGET_EXCEEDED' },
    { key: 'maxTotalTokens', value: inputTokens + outputTokens, code: 'TEAM_TOTAL_TOKENS_BUDGET_EXCEEDED' },
    { key: 'maxTurns', value: turns, legacy: 'maxTurnsPerTeam', code: 'TEAM_TURN_BUDGET_EXCEEDED' },
    { key: 'maxCostUnits', value: costUnits, legacy: 'maxCostUnitsPerTeam', code: 'TEAM_COST_BUDGET_EXCEEDED' },
  ]
  for (const ceiling of ceilings) {
    const limit = minimumBudgetLimit(typed[ceiling.key],
      ceiling.legacy === undefined ? undefined : teamLimits?.[ceiling.legacy], ceiling.key === 'maxCostUnits')
    if (limit !== undefined && ceiling.value >= limit) {
      return {
        code: ceiling.code,
        message: `Team '${state.team.id}' reached its ${ceiling.key} budget of ${String(limit)}`,
      }
    }
  }
  return undefined
}

/** Resolve a schema-valid typed ceiling against its frozen positive-integer deployment limit. */
function minimumBudgetLimit(typed: unknown, legacy: unknown, fractional: boolean): number | undefined {
  const typedLimit = typeof typed === 'number' && typed >= 0
    && (fractional ? Number.isFinite(typed) : Number.isSafeInteger(typed)) ? typed : undefined
  const legacyLimit = typeof legacy === 'number' && Number.isSafeInteger(legacy) && legacy > 0 ? legacy : undefined
  if (typedLimit === undefined) return legacyLimit
  return legacyLimit === undefined ? typedLimit : Math.min(typedLimit, legacyLimit)
}

/** Resolve the Team-wide count of permitted retries, excluding first attempts. */
function teamRetryLimit(state: TeamStateSnapshot): number | undefined {
  return minimumBudgetLimit(state.budgets['maxRetries'], asJsonObject(state.rules['teamLimits'])?.['maxRetriesPerTeam'], false)
}

/** Count retry attempts already admitted across every retained Team task. */
function teamRetries(state: TeamStateSnapshot): number {
  return state.tasks.reduce((sum, task) => sum + Math.max(0, task.attemptCount - 1), 0)
}

/** Diagnose exhausted retry admission only after accepted work and other ready tasks can no longer advance. */
function blockedRetryBudget(state: TeamStateSnapshot, config: ResolvedConfig): TeamStallReason | undefined {
  const limit = teamRetryLimit(state)
  if (limit === undefined || teamRetries(state) < limit
    || state.tasks.some(task => taskHasActiveExecution(task) || task.phase === 'review')) return undefined
  const ready = state.tasks.filter(task => config.permittedWorkspaceModes.has(task.workspaceMode)
    && !workflowPlanAtCapacity(task, state) && isReadyTask(task, state))
  if (ready.length === 0 || ready.some(task => task.attemptCount === 0)) return undefined
  return {
    code: 'TEAM_RETRIES_BUDGET_EXCEEDED',
    message: `Team '${state.team.id}' reached its maxRetries budget of ${String(limit)}`,
  }
}

/** Narrow one durable JSON value to an object before reading named Team limits. */
function asJsonObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined
}

/** Select the first creation-ordered assigned lease whose wake channel has not been checked in this drive. */
function selectWakeRecovery(
  state: TeamStateSnapshot,
  verifiedWakes: ReadonlySet<string>,
  afterKey: string | undefined,
): WakeRecoverySelection | undefined {
  const candidates = state.tasks.filter(isWakeLeasedTask).filter(task => task.cancellation === undefined)
  const cursor = afterKey === undefined ? -1 : candidates.findIndex(task => wakeKey(task) === afterKey)
  const ordered = cursor < 0
    ? candidates
    : [...candidates.slice(cursor + 1), ...candidates.slice(0, cursor + 1)]
  for (const task of ordered) {
    if (verifiedWakes.has(wakeKey(task))) continue
    const activation = state.activations.find(binding => binding.activation.id === task.lease.activationId)
    if (activation === undefined
      || activation.activation.teamId !== task.teamId
      || activation.activation.participantId !== task.lease.participantId) {
      throw new Error(`task '${task.id}' wake lease has no matching durable activation binding`)
    }
    return { task, activation }
  }
  return undefined
}

/** Validate a new assignment response before its durable task-assignment Envelope is published. */
function assignmentWakeSelection(
  task: TeamTaskSnapshot,
  activation: ActivationBindingSnapshot,
  channel: ChannelSnapshot,
): WakeRecoverySelection {
  if (!isWakeLeasedTask(task)) {
    throw new Error(`task '${task.id}' assignment did not retain an activation-bound wake lease`)
  }
  if (task.lease.participantId !== activation.activation.participantId
    || task.lease.activationId !== activation.activation.id
    || task.lease.wakeChannelId !== channel.manifest.id) {
    throw new Error(`task '${task.id}' assignment does not match its selected wake channel and activation`)
  }
  assertWakeManifest(channel, task, task.lease.participantId, activation)
  return { task, activation }
}

/** Parse and verify immutable channel facts against one current task lease and activation binding. */
function assertWakeManifest(
  channel: ChannelSnapshot,
  task: Pick<TeamTaskSnapshot, 'teamId' | 'id'>,
  participantId: ParticipantSnapshot['id'],
  activation: ActivationBindingSnapshot,
): TaskAssignmentChannelManifest {
  if (channel.phase !== 'active') {
    throw new Error(`task-assignment channel '${channel.manifest.id}' is not active`)
  }
  const manifest = parseTaskAssignmentChannelManifest(channel.manifest)
  if (manifest.teamId !== task.teamId
    || manifest.taskId !== task.id
    || manifest.assigneeId !== participantId
    || manifest.activationId !== activation.activation.id
    || manifest.sessionId !== activation.sessionId) {
    throw new Error(`task-assignment channel '${channel.manifest.id}' does not match its task lease and activation binding`)
  }
  return manifest
}

/** Parse and verify one accepted durable assignment Envelope against the current task attempt fence. */
function assertWakeEnvelope(
  channel: ChannelSnapshot,
  envelope: Parameters<typeof parseTaskAssignmentEnvelope>[1],
  task: WakeLeasedTeamTask,
  activation: ActivationBindingSnapshot,
): TaskAssignmentEnvelope {
  assertWakeManifest(channel, task, task.lease.participantId, activation)
  const parsed = parseTaskAssignmentEnvelope(channel.manifest, envelope)
  if (parsed.attemptId !== task.lease.attemptId
    || parsed.assignedRevision !== task.lease.assignedRevision
    || parsed.assigneeId !== task.lease.participantId
    || parsed.activationId !== task.lease.activationId
    || parsed.sessionId !== activation.sessionId) {
    throw new Error(`task-assignment Envelope '${envelope.id}' does not match its current task attempt fence`)
  }
  return parsed
}

/** Select one ready task and its best currently idle activation-backed owner. */
async function selectAssignment(
  state: TeamStateSnapshot,
  config: ResolvedConfig,
  workspaceEligible: WorkspaceEligibility,
): Promise<AssignmentSelection | undefined> {
  const rankingPolicy = teamTaskRankingPolicySchema.parse(state.rules.taskRanking)
  const retryLimit = teamRetryLimit(state)
  const retries = teamRetries(state)
  const tasks = state.tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => config.permittedWorkspaceModes.has(task.workspaceMode)
      && workflowTaskSchedulable(task, state)
      && !workflowPlanAtCapacity(task, state)
      && (task.attemptCount === 0 || retryLimit === undefined || retries < retryLimit)
      && isReadyTask(task, state))
    .sort((left, right) => compareNumber(right.task.priority, left.task.priority) || left.index - right.index)

  for (const { task } of tasks) {
    if (hasSharedWriteConflict(task, state.tasks)) continue
    const candidates: AssignmentSelection[] = []
    for (const participant of state.participants) {
      const activation = eligibleActivation(participant, task, state, config.maxActiveAttemptsPerParticipant, 'idle')
      if (activation === undefined) continue
      if (!matchesTaskPlacement(task.placement, participant, activation.provider, activation.selection ?? {})) continue
      if (!(await workspaceEligible(task.workspaceMode, { task, binding: activation }))) continue
      candidates.push({
        task,
        participant,
        activation,
        load: activeLoad(participant, state.tasks),
        capabilitySurplus: participant.capabilities.length - task.requiredCapabilities.length,
        ...taskOwnerRank(task, participant, activation, rankingPolicy, state.rules),
      })
    }
    candidates.sort(compareCandidates)
    const selected = candidates[0]
    if (selected !== undefined) return selected
  }
  return undefined
}

/** Find an active capability-matching activation even when its task-load limit is full. */
function potentialOwnerActivation(
  participant: ParticipantSnapshot,
  task: TeamTaskSnapshot,
  state: TeamStateSnapshot,
): ActivationBindingSnapshot | undefined {
  if (participant.phase !== 'active' || (participant.kind !== 'local-agent' && participant.kind !== 'remote-agent')) return undefined
  if (!task.requiredCapabilities.every(capability => participant.capabilities.includes(capability))) return undefined
  const activations = state.activations.filter(binding => binding.activation.participantId === participant.id
    && matchesTaskPlacement(task.placement, participant, binding.provider, binding.selection ?? {})
    && (binding.activation.status === 'idle' || binding.activation.status === 'running'))
  return activations.length === 1 ? activations[0] : undefined
}

/** Return whether one task can receive a new lease from the current durable projection. */
function isReadyTask(task: TeamTaskSnapshot, state: TeamStateSnapshot): boolean {
  return task.execution.kind === 'participant' && task.phase === 'pending' && task.cancellation === undefined
    && workflowTaskSchedulable(task, state)
    && task.lease === undefined
    && task.attemptCount < task.maxAttempts
    && task.blockedBy.every(blockerId => state.tasks.some(blocker => blocker.id === blockerId && blocker.phase === 'completed'))
}

/** Keep compiled workflow tasks dormant until their whole plan is ready. */
function workflowTaskSchedulable(task: TeamTaskSnapshot, state: TeamStateSnapshot): boolean {
  if (task.workflowPlanId === undefined) return true
  return state.workflowPlans?.find(plan => plan.id === task.workflowPlanId)?.phase === 'ready'
}

/** Enforce the plan-local concurrent lease bound without stalling a waiting plan. */
function workflowPlanAtCapacity(task: TeamTaskSnapshot, state: TeamStateSnapshot): boolean {
  if (task.workflowPlanId === undefined) return false
  const plan = state.workflowPlans?.find(candidate => candidate.id === task.workflowPlanId)
  if (plan === undefined) return true
  const active = state.tasks
    .filter(candidate => candidate.workflowPlanId === task.workflowPlanId && taskHasActiveExecution(candidate)).length
  return active >= plan.plan.bounds.maxParallelism
}

/** Return whether a task currently reserves its owner's load and shared write scopes. */
function isLeasedTask(task: TeamTaskSnapshot): task is LeasedTeamTask {
  return (task.phase === 'assigned' || task.phase === 'running') && task.lease !== undefined
}

/** Return whether an assigned agent lease owns a persistent task-assignment channel. */
function isWakeLeasedTask(task: TeamTaskSnapshot): task is WakeLeasedTeamTask {
  return task.phase === 'assigned'
    && task.lease !== undefined
    && task.lease.activationId !== undefined
    && task.lease.wakeChannelId !== undefined
}

/** Return one exact activation satisfying candidate capability, load, and caller-selected status. */
function eligibleActivation(
  participant: ParticipantSnapshot,
  task: TeamTaskSnapshot,
  state: TeamStateSnapshot,
  maxActiveAttempts: number,
  status: 'idle' | 'running',
): ActivationBindingSnapshot | undefined {
  if (participant.phase !== 'active' || (participant.kind !== 'local-agent' && participant.kind !== 'remote-agent')) return undefined
  const capabilities = new Set(participant.capabilities)
  if (!task.requiredCapabilities.every(capability => capabilities.has(capability))) return undefined
  if (activeLoad(participant, state.tasks) >= maxActiveAttempts) return undefined
  const activations = state.activations.filter(binding => binding.activation.participantId === participant.id
    && binding.activation.status === status)
  return activations.length === 1 ? activations[0] : undefined
}

/** Count every assigned or running lease that currently names one participant. */
function activeLoad(participant: ParticipantSnapshot, tasks: readonly TeamTaskSnapshot[]): number {
  return tasks.filter(task => isLeasedTask(task) && task.lease.participantId === participant.id).length
}

/** Return whether two shared-workspace tasks reserve overlapping declared write prefixes. */
function hasSharedWriteConflict(task: TeamTaskSnapshot, tasks: readonly TeamTaskSnapshot[]): boolean {
  return taskHasSharedWriteConflict(task, tasks)
}

/** Rank eligible owners by the frozen proposal, capability, load, outcome, latency, cost, and identity tuple. */
function compareCandidates(left: AssignmentSelection, right: AssignmentSelection): number {
  const leftProposalRank = left.task.proposedOwnerId === left.participant.id ? 0 : 1
  const rightProposalRank = right.task.proposedOwnerId === right.participant.id ? 0 : 1
  return compareNumber(leftProposalRank, rightProposalRank)
    || compareNumber(left.capabilitySurplus, right.capabilitySurplus)
    || compareNumber(left.load, right.load)
    || compareNumber(right.outcomeBalance, left.outcomeBalance)
    || compareNumber(left.latencyBucket, right.latencyBucket)
    || compareNumber(left.costBucket, right.costBucket)
    || left.participant.id.localeCompare(right.participant.id)
}

/** Compare two integers without subtracting potentially distant safe integer values. */
function compareNumber(left: number, right: number): number {
  return left === right ? 0 : left < right ? -1 : 1
}

/** Resolve the Team identity carried by every immutable Team notification form. */
function teamIdFromEvent(event: TeamEvent): TeamId {
  switch (event.type) {
    case 'team/created':
    case 'team/changed':
      return event.team.id
    case 'goal/changed':
      return event.goal.teamId
    case 'participant/changed':
      return event.participant.teamId
    case 'activation/changed':
      return event.binding.activation.teamId
    case 'participant-interrupt/changed':
      return event.interrupt.target.teamId
    case 'human-action/changed':
      return event.action.teamId
    case 'usage/changed':
      return event.teamId
    case 'task/changed':
      return event.task.teamId
    case 'workspace/observed':
      return event.observation.teamId
    case 'workspace-allocation/changed':
      return event.allocation.teamId
    case 'workflow-plan/changed':
      return event.plan.teamId
    case 'policy/denied':
      return event.teamId
    /* v8 ignore next -- TeamEvent is closed and every discriminant is handled above. */
    default:
      event satisfies never
      throw new Error('unreachable Team event')
  }
}

/** Return one collision-free map key for a branded Team identity. */
function teamKey(teamId: TeamId): string {
  return JSON.stringify(teamId)
}

/** Build one exact key for a scheduler-owned Team journal cursor change. */
function teamChangeKey(team: Pick<TeamSnapshot, 'id' | 'cursor'>): string {
  return JSON.stringify([team.id, team.cursor])
}

/** Build one exact key for an in-flight scheduler task revision. */
function taskChangeKey(task: Pick<TeamTaskSnapshot, 'teamId' | 'id' | 'revision'>): string {
  return JSON.stringify([task.teamId, task.id, task.revision])
}

/** Build one exact key for a lease whose wake channel has been checked during this drive. */
function wakeKey(task: WakeLeasedTeamTask): string {
  return JSON.stringify([task.teamId, task.id, task.lease.attemptId])
}

/** Recognize a state race where one fresh durable read may choose another safe action. */
function isRetryableRace(error: unknown): boolean {
  return error instanceof TeamError && (
    error.code === 'TEAM_CURSOR_CONFLICT'
    || error.code === 'TEAM_TASK_STALE_REVISION'
    || error.code === 'TEAM_CHANNEL_CURSOR_CONFLICT'
    || error.code === 'TEAM_INVALID_ARGUMENT'
    || error.code === 'TEAM_PARTICIPANT_NOT_FOUND'
    || error.code === 'TEAM_ACTIVATION_NOT_FOUND'
  )
}

/** Recognize a governance denial that must not cause candidate fallthrough or a retry loop. */
function isPolicyDenial(error: unknown): boolean {
  return error instanceof TeamError && error.code === 'TEAM_POLICY_DENIED'
}

/** Recognize a terminal channel whose pending receipt watermark still blocks retention. */
function isRetentionNotReady(error: unknown): boolean {
  return error instanceof TeamError && error.code === 'TEAM_CHANNEL_BACKPRESSURE'
}

/** Validate explicit configuration before a direct function-plugin caller starts scheduling. */
function resolveConfig(config: Config): ResolvedConfig {
  const configuredWorkspaceModes: readonly string[] = config.permittedWorkspaceModes
  const permittedWorkspaceModes = new Set(configuredWorkspaceModes)
  if (permittedWorkspaceModes.size === 0) {
    throw new TypeError('team-scheduler-dag: permittedWorkspaceModes must contain shared')
  }
  if (permittedWorkspaceModes.size !== configuredWorkspaceModes.length) {
    throw new TypeError('team-scheduler-dag: permittedWorkspaceModes cannot contain duplicates')
  }
  if (!permittedWorkspaceModes.has('shared')) {
    throw new TypeError('team-scheduler-dag: permittedWorkspaceModes must contain shared')
  }
  const allowNonShared = config.allowNonSharedWorkspaceModes === true
  if (!allowNonShared && [...permittedWorkspaceModes].some(mode => mode !== 'shared')) {
    throw new TypeError('team-scheduler-dag: non-shared workspace modes require allowNonSharedWorkspaceModes')
  }
  const retentionTail = config.terminalChannelRetentionTail
  const maxCompactions = config.maxCompactionsPerDrive
  if ((retentionTail === undefined) !== (maxCompactions === undefined)) {
    throw new TypeError(
      'team-scheduler-dag: terminalChannelRetentionTail and maxCompactionsPerDrive must be configured together',
    )
  }
  return {
    leaseDurationMs: positiveSafeInteger('leaseDurationMs', config.leaseDurationMs),
    maxAssignmentsPerDrive: positiveSafeInteger('maxAssignmentsPerDrive', config.maxAssignmentsPerDrive),
    maxExpirationsPerDrive: positiveSafeInteger('maxExpirationsPerDrive', config.maxExpirationsPerDrive),
    maxWakeDispatchesPerDrive: positiveSafeInteger(
      'maxWakeDispatchesPerDrive',
      config.maxWakeDispatchesPerDrive,
    ),
    maxConflictsPerDrive: positiveSafeInteger('maxConflictsPerDrive', config.maxConflictsPerDrive),
    maxActiveAttemptsPerParticipant: positiveSafeInteger(
      'maxActiveAttemptsPerParticipant',
      config.maxActiveAttemptsPerParticipant,
    ),
    permittedWorkspaceModes: new Set<TeamTaskWorkspaceMode>([...permittedWorkspaceModes] as TeamTaskWorkspaceMode[]),
    allowNonSharedWorkspaceModes: allowNonShared,
    disposalTimeoutMs: positiveSafeInteger('disposalTimeoutMs', config.disposalTimeoutMs),
    stallAfterUnassignableDrives: positiveSafeInteger(
      'stallAfterUnassignableDrives',
      config.stallAfterUnassignableDrives ?? DEFAULT_STALL_AFTER_UNASSIGNABLE_DRIVES,
    ),
    ...config.pulseIntervalMs === undefined ? {} : {
      pulseIntervalMs: positiveSafeInteger('pulseIntervalMs', config.pulseIntervalMs),
    },
    teamPageSize: positiveSafeInteger('teamPageSize', config.teamPageSize ?? DEFAULT_TEAM_PAGE_SIZE),
    channelPageSize: positiveSafeInteger('channelPageSize', config.channelPageSize ?? DEFAULT_CHANNEL_PAGE_SIZE),
    ...retentionTail === undefined ? {} : {
      terminalChannelRetentionTail: positiveSafeInteger('terminalChannelRetentionTail', retentionTail),
      maxCompactionsPerDrive: positiveSafeInteger('maxCompactionsPerDrive', maxCompactions as number),
    },
  }
}

/** Reject a non-positive or non-integral deployment limit before it reaches an operation. */
function positiveSafeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`team-scheduler-dag: ${name} must be a positive safe integer`)
  }
  return value
}

/** Recursively freeze a detached observer value before listener delivery. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

/** Bound scheduler shutdown without retaining a disposal timer after normal settlement. */
async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(`team-scheduler-dag: disposal exceeded ${timeoutMs}ms`)) }, timeoutMs)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Render a listener or background-drive failure without letting diagnostic formatting throw. */
function renderError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}
