/** Provision explicitly routed Team participants before deterministic task assignment. @module */
import { Service } from '@clocky/cordis'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { SessionId } from '@clocky/clocky-session'
import { TeamError, matchesTaskPlacement } from '@clocky/clocky-team'
import type { ParticipantSnapshot, TeamId, TeamStateSnapshot, TeamTaskSnapshot } from '@clocky/clocky-team'
import type { TeamActivationLease } from '@clocky/clocky-team-activation-controller'
import type {} from '@clocky/clocky-agent-runtime'
import type {} from '@clocky/clocky-team-workspace'

declare module '@clocky/cordis' {
  interface Context {
    /** Task-driven provisioning using explicit participant execution routes. */
    teamPlacement: TeamPlacement
  }
}

/** Complete deployment execution route matched against immutable participant metadata. */
export interface PlacementRoute {
  /** AgentRuntime provider that owns the activation. */
  readonly provider: string
  /** Roles eligible to use this route. */
  readonly roles: string[]
  /** Participant model identifier, exactly provider/model. */
  readonly model: string
  /** LLM provider selected for the activation. */
  readonly modelProvider: string
  /** LLM model selected for the activation. */
  readonly modelId: string
  /** Preset required by the route and participant descriptor. */
  readonly preset?: string
  /** Execution root used before a task workspace is bound. */
  readonly cwd: string
  /** Explicit model output allowance for this route. */
  readonly maxTokens: number
}

/** Bounded placement policy; routes never infer a model or preset from ambient defaults. */
export interface Config {
  /** Explicit participant execution routes available to this deployment. */
  readonly routes: PlacementRoute[]
  /** Maximum new activations accepted by one Team preparation. */
  readonly maxActivationsPerDrive: number
  /** Maximum fresh-cursor retries for one activation admission. */
  readonly maxCursorRetries: number
}

/** Validate all execution choices before loading the Consumer. */
export const Config: z<Config> = z.object({
  routes: z.array(z.object({
    provider: z.string().min(1), roles: z.array(z.string().min(1)).min(1),
    model: z.string().min(1), modelProvider: z.string().min(1), modelId: z.string().min(1),
    preset: z.string().default(undefined as unknown as string), cwd: z.string().min(1),
    maxTokens: z.number().step(1).min(1),
  })),
  maxActivationsPerDrive: z.number().step(1).min(1),
  maxCursorRetries: z.number().step(1).min(1),
})

/** Activation owner for tasks whose participants have an explicit deployment route. */
export class TeamPlacement extends Service {
  private readonly stopping = new AbortController()
  private readonly pending = new Map<TeamId, { readonly operation: Promise<number>; readonly signal: AbortSignal }>()
  private readonly leases = new Set<TeamActivationLease>()
  private readonly rolePreparations = new Map<TeamId, { readonly operation: Promise<void>; readonly signal: AbortSignal }>()
  private closed: Promise<void> | undefined

  /** @param ctx - Authoritative Team, activation and runtime services. @param config - Explicit bounded routes. */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'teamPlacement')
    const selections = new Set<string>()
    for (const route of config.routes) {
      if (route.model !== `${route.modelProvider}/${route.modelId}`) throw new TypeError('Placement model must equal modelProvider/modelId')
      if (ctx.agentRuntimes.getProvider(route.provider) === undefined) throw new TypeError(`Placement provider '${route.provider}' is unavailable`)
      for (const role of route.roles) {
        const key = JSON.stringify([route.provider, route.preset, route.model, role])
        if (selections.has(key)) throw new TypeError(`Placement role '${role}' has overlapping execution routes`)
        selections.add(key)
      }
    }
  }

  /**
   * Prepare idle owners for currently ready tasks without assigning any lease.
   * @param teamId - Durable Team selected by the scheduler.
   * @param signal - First caller's cancellation, retained by all coalesced callers of that preparation.
   * @returns number of activations published by this pass.
   */
  prepare(teamId: TeamId, signal?: AbortSignal): Promise<number> {
    if (this.stopping.signal.aborted) return Promise.reject(new Error('Team placement is closed'))
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- preserve the caller's exact AbortSignal reason.
    if (signal?.aborted) return Promise.reject(signal.reason)
    const prior = this.pending.get(teamId)
    if (prior !== undefined) return prior.operation
    const cancellation = signal === undefined ? this.stopping.signal : AbortSignal.any([signal, this.stopping.signal])
    const operation = this.prepareTeam(teamId, cancellation).finally(() => { this.pending.delete(teamId) })
    this.pending.set(teamId, { operation, signal: cancellation })
    return operation
  }

  /** Prepare declared workflow roles before channel admission or task publication.
   * @param teamId - Team whose active membership authorizes the roles.
   * @param roles - Unique roles already resolved by the workflow compiler.
   * @param signal - Cancellation of this compilation.
   * @returns resolution when every agent role has a resident activation; unavailable routes reject.
   */
  async prepareRoles(teamId: TeamId, roles: readonly string[], signal?: AbortSignal): Promise<void> {
    const cancellation = signal === undefined ? this.stopping.signal : AbortSignal.any([signal, this.stopping.signal])
    cancellation.throwIfAborted()
    const prior = this.rolePreparations.get(teamId)
    if (prior !== undefined) {
      await prior.operation
      await this.prepareRoles(teamId, roles, signal)
      return
    }
    const operation = this.prepareRoleOwners(teamId, roles, cancellation)
    this.rolePreparations.set(teamId, { operation, signal: cancellation })
    try { await operation }
    finally { this.rolePreparations.delete(teamId) }
  }

  private async prepareRoleOwners(teamId: TeamId, roles: readonly string[], signal: AbortSignal): Promise<void> {
    const initial = await this.ctx.teams.getTeam({ teamId })
    const selected = roles.flatMap((role) => {
      const matches = initial.participants.filter(value => value.role === role && value.phase === 'active')
      if (matches.length !== 1) throw new TeamError(`Workflow role '${role}' must identify one active participant`, 'TEAM_INVALID_ARGUMENT')
      const participant = matches[0] as ParticipantSnapshot
      if (participant.kind !== 'local-agent' && participant.kind !== 'remote-agent') return []
      const previous = initial.activations.filter(value => value.activation.participantId === participant.id).at(-1)
      if (previous !== undefined && (previous.activation.status === 'idle' || previous.activation.status === 'running')) return []
      const route = this.config.routes.find(route => route.provider === participant.provider
        && route.preset === participant.preset && route.model === participant.model && route.roles.includes(role))
      if (route === undefined) throw new TeamError(`Workflow role '${role}' requires one configured placement route`, 'TEAM_INVALID_ARGUMENT')
      return [{ participant, route }]
    })
    if (selected.length > this.config.maxActivationsPerDrive) {
      throw new TeamError('Workflow roles exceed the placement activation budget', 'TEAM_CHANNEL_BACKPRESSURE')
    }
    for (const { participant, route } of selected) {
      signal.throwIfAborted()
      const current = await this.ctx.teams.getTeam({ teamId })
      if (!await this.activateOwner(current, undefined, participant, route, signal)) {
        signal.throwIfAborted()
        throw new TeamError(`Workflow role '${participant.role}' requires activation recovery`, 'TEAM_ACTIVATION_RECOVERY_CONFLICT')
      }
    }
  }

  /** Stop new preparation and cancel provider admission; failed releases remain available to a later close.
   * @returns Shared in-flight cleanup; rejects with collected failures until all owned leases settle.
   */
  close(): Promise<void> {
    this.closed ??= this.closeOwned().catch((error: unknown) => {
      this.closed = undefined
      throw error
    })
    return this.closed
  }

  private async closeOwned(): Promise<void> {
    const admitted = [...this.pending.values()]
    const roles = [...this.rolePreparations.values()]
    this.stopping.abort(new Error('Team placement unloaded'))
    const preparations = await Promise.allSettled(admitted.map(entry => entry.operation))
    const failures: unknown[] = preparations.flatMap((result, index) => result.status === 'rejected'
      && result.reason !== admitted[index]?.signal.reason ? [result.reason as unknown] : [])
    const preparedRoles = await Promise.allSettled(roles.map(entry => entry.operation))
    failures.push(...preparedRoles.flatMap((result, index) => result.status === 'rejected'
      && result.reason !== roles[index]?.signal.reason ? [result.reason as unknown] : []))
    const settled = await Promise.allSettled([...this.leases].map(lease => this.releaseLease(lease)))
    failures.push(...settled.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []))
    if (failures.length > 0) throw new AggregateError(failures, 'Team placement activation cleanup failed')
  }

  private async prepareTeam(teamId: TeamId, signal: AbortSignal): Promise<number> {
    signal.throwIfAborted()
    for (const lease of this.leases) {
      if (lease.binding.quiescedAt !== undefined) this.leases.delete(lease)
    }
    let count = 0
    const selectedOwners = new Set<string>()
    const initial = await this.ctx.teams.getTeam({ teamId })
    const taskIds = initial.tasks.filter(task => ready(task, initial)).sort((a, b) => b.priority - a.priority).map(task => task.id)
    for (const taskId of taskIds) {
      if (count >= this.config.maxActivationsPerDrive) break
      signal.throwIfAborted()
      const state = await this.ctx.teams.getTeam({ teamId })
      const task = state.tasks.find(value => value.id === taskId)
      if (task === undefined || !ready(task, state)) continue
      const available = state.participants.find(participant => !selectedOwners.has(participant.id) && candidate(task, participant)
        && state.activations.some(binding => binding.activation.participantId === participant.id
          && matchesTaskPlacement(task.placement, participant, binding.provider, binding.selection ?? {})
          && binding.activation.status === 'idle'))
      if (available !== undefined) { selectedOwners.add(available.id); continue }
      const participants = state.participants.filter(participant => !selectedOwners.has(participant.id) && candidate(task, participant))
        .sort((a, b) => Number(b.id === task.proposedOwnerId) - Number(a.id === task.proposedOwnerId) || a.id.localeCompare(b.id))
      for (const participant of participants) {
        const route = this.config.routes.find(route => route.provider === participant.provider
          && route.preset === participant.preset && route.model === participant.model && route.roles.includes(participant.role))
        if (route === undefined) continue
        if (await this.activateOwner(state, task, participant, route, signal)) {
          count += 1
          selectedOwners.add(participant.id)
          break
        }
      }
    }
    return count
  }

  private async activateOwner(
    initial: TeamStateSnapshot, task: TeamTaskSnapshot | undefined, participant: ParticipantSnapshot, route: PlacementRoute,
    signal: AbortSignal,
  ): Promise<boolean> {
    const previous = initial.activations.filter(value => value.activation.participantId === participant.id).at(-1)
    if (task === undefined && previous !== undefined
      && (previous.activation.status === 'idle' || previous.activation.status === 'running')) return true
    // Recovery owns unfenced epochs; a task-driven fresh start must never bypass it.
    if (previous !== undefined && (previous.activation.status !== 'offline' || previous.quiescedAt === undefined)) return false
    const sessionId = previous?.sessionId ?? SessionId(`team-placement-${initial.team.id}-${participant.id}`)
    for (let attempt = 0; attempt < this.config.maxCursorRetries; attempt += 1) {
      signal.throwIfAborted()
      const current = await this.ctx.teams.getTeam({ teamId: initial.team.id })
      const freshTask = task === undefined ? undefined : current.tasks.find(value => value.id === task.id)
      if (task !== undefined && (freshTask === undefined || !ready(freshTask, current))) return false
      if (current.team.phase !== 'active' || current.team.cancellation !== undefined
        || !current.participants.some(value => value.id === participant.id && value.phase === 'active')) return false
      try {
        const workspaces = this.ctx.get('teamWorkspaces')
        if (workspaces !== undefined && freshTask !== undefined && !await workspaces.preflight(freshTask.workspaceMode, {
          task: freshTask,
          participant,
          route: {
            provider: route.provider,
            model: route.model,
            ...route.preset === undefined ? {} : { preset: route.preset },
            cwd: route.cwd,
          },
        })) return false
        const lease = await this.ctx.teamActivations.activate({
          teamId: initial.team.id, participantId: participant.id, expectedCursor: current.team.cursor,
          provider: route.provider, sessionId, seed: { kind: previous === undefined ? 'fresh' : 'resume' },
          agent: { cwd: route.cwd, ...route.preset === undefined ? {} : { preset: route.preset },
            options: { provider: route.modelProvider, model: route.modelId, maxTokens: route.maxTokens } },
          signal,
        })
        this.leases.add(lease)
        if (workspaces !== undefined && freshTask !== undefined) {
          let eligible: boolean
          try {
            eligible = await workspaces.eligible(freshTask.workspaceMode, { task: freshTask, binding: lease.binding })
          } catch (error: unknown) {
            try { await this.releaseLease(lease) }
            catch (disposeError: unknown) { throw new AggregateError([error, disposeError], 'Placement workspace eligibility cleanup failed') }
            throw error
          }
          if (!eligible) {
            await this.releaseLease(lease)
            return false
          }
        }
        const after = await this.ctx.teams.getTeam({ teamId: initial.team.id })
        const stillNeeded = task === undefined
          ? after.team.phase === 'active' && after.team.cancellation === undefined
            && after.participants.some(value => value.id === participant.id && value.phase === 'active')
          : after.tasks.some(value => candidate(value, participant)
            && (ready(value, after) || value.lease?.activationId === lease.binding.activation.id))
        if (signal.aborted || !stillNeeded) {
          await this.releaseLease(lease)
          return false
        }
        return true
      } catch (error: unknown) {
        if (!(error instanceof TeamError) || error.code !== 'TEAM_CURSOR_CONFLICT') throw error
      }
    }
    throw new TeamError(`Placement for participant '${participant.id}' exhausted cursor retries`, 'TEAM_CURSOR_CONFLICT')
  }

  private async releaseLease(lease: TeamActivationLease): Promise<void> {
    await lease.dispose()
    this.leases.delete(lease)
  }
}

/** Check only durable task readiness; assignment rechecks capacity and workspace eligibility. */
function ready(task: TeamTaskSnapshot, state: TeamStateSnapshot): boolean {
  return task.execution.kind === 'participant'
    && state.team.phase === 'active' && state.team.cancellation === undefined
    && task.phase === 'pending' && task.cancellation === undefined && task.lease === undefined
    && task.attemptCount < task.maxAttempts
    && (task.workflowPlanId === undefined || state.workflowPlans?.some(plan => plan.id === task.workflowPlanId && plan.phase === 'ready') === true)
    && task.blockedBy.every(id => state.tasks.some(value => value.id === id && value.phase === 'completed'))
}

/** Require an authorized descriptor before selecting a configured route. */
function candidate(task: TeamTaskSnapshot, participant: ParticipantSnapshot): boolean {
  const grant = participant.authorityGrant
  return task.execution.kind === 'participant'
    && participant.phase === 'active' && ['local-agent', 'remote-agent'].includes(participant.kind)
    && matchesTaskPlacement(task.placement, participant)
    && task.requiredCapabilities.every(capability => participant.capabilities.includes(capability))
    && (grant === undefined || grant.workspaceModes.includes(task.workspaceMode))
}

/** Cordis plugin identity. */
export const name = 'team-placement-default'
/** Required services exist before route validation and provider admission. */
export const inject = ['teams', 'teamActivations', 'agentRuntimes']
/** Install the placement Consumer and retain its admitted operations through disposal.
 * @param ctx - Deployment context with the declared providers.
 * @param config - Complete placement route configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const placement = new TeamPlacement(ctx, config)
  ctx.effect(() => () => placement.close())
}
