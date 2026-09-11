/** Provision explicitly routed Team participants before deterministic task assignment. @module */
import { randomUUID } from 'node:crypto'
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

  /** Stop new preparation, cancel provider admission and await every owned activation release. */
  close(): Promise<void> {
    this.closed ??= this.closeOwned()
    return this.closed
  }

  private async closeOwned(): Promise<void> {
    const admitted = [...this.pending.values()]
    this.stopping.abort(new Error('Team placement unloaded'))
    const preparations = await Promise.allSettled(admitted.map(entry => entry.operation))
    const failures: unknown[] = preparations.flatMap((result, index) => result.status === 'rejected'
      && result.reason !== admitted[index]?.signal.reason ? [result.reason as unknown] : [])
    const settled = await Promise.allSettled([...this.leases].map(lease => lease.dispose()))
    failures.push(...settled.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []))
    if (failures.length > 0) throw new AggregateError(failures, 'Team placement activation cleanup failed')
    this.leases.clear()
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
        const routes = this.config.routes.filter(route => route.provider === participant.provider
          && route.preset === participant.preset && route.model === participant.model && route.roles.includes(participant.role))
        if (routes.length === 0) continue
        if (routes.length !== 1) throw new TeamError(`Participant '${participant.id}' matches ambiguous placement routes`, 'TEAM_INVALID_ARGUMENT')
        const route = routes[0] as PlacementRoute
        if (!matchesTaskPlacement(task.placement, participant, route.provider)) continue
        if (await this.activateTaskOwner(state, task, participant, route, signal)) {
          count += 1
          selectedOwners.add(participant.id)
          break
        }
      }
    }
    return count
  }

  private async activateTaskOwner(
    initial: TeamStateSnapshot, task: TeamTaskSnapshot, participant: ParticipantSnapshot, route: PlacementRoute,
    signal: AbortSignal,
  ): Promise<boolean> {
    const previous = initial.activations.filter(value => value.activation.participantId === participant.id).at(-1)
    // Recovery owns unfenced epochs; a task-driven fresh start must never bypass it.
    if (previous !== undefined && (previous.activation.status !== 'offline' || previous.quiescedAt === undefined)) return false
    const sessionId = previous?.sessionId ?? SessionId(`team-placement-${randomUUID()}`)
    for (let attempt = 0; attempt < this.config.maxCursorRetries; attempt += 1) {
      signal.throwIfAborted()
      const current = await this.ctx.teams.getTeam({ teamId: initial.team.id })
      const freshTask = current.tasks.find(value => value.id === task.id)
      if (freshTask === undefined || !ready(freshTask, current)) return false
      try {
        const workspaces = this.ctx.get('teamWorkspaces')
        if (workspaces !== undefined && !await workspaces.preflight(freshTask.workspaceMode, {
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
        if (workspaces !== undefined) {
          let eligible: boolean
          try {
            eligible = await workspaces.eligible(freshTask.workspaceMode, { task: freshTask, binding: lease.binding })
          } catch (error: unknown) {
            try { await lease.dispose() }
            catch (disposeError: unknown) { throw new AggregateError([error, disposeError], 'Placement workspace eligibility cleanup failed') }
            throw error
          }
          if (!eligible) {
            await lease.dispose()
            return false
          }
        }
        this.leases.add(lease)
        const after = await this.ctx.teams.getTeam({ teamId: initial.team.id })
        const stillNeeded = after.tasks.some(value => candidate(value, participant)
          && (ready(value, after) || value.lease?.activationId === lease.binding.activation.id))
        if (signal.aborted || !stillNeeded) {
          await lease.dispose()
          this.leases.delete(lease)
          return false
        }
        return true
      } catch (error: unknown) {
        if (!(error instanceof TeamError) || error.code !== 'TEAM_CURSOR_CONFLICT') throw error
      }
    }
    throw new TeamError(`Placement for participant '${participant.id}' exhausted cursor retries`, 'TEAM_CURSOR_CONFLICT')
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
 * @returns asynchronous disposal of every accepted activation.
 */
export function apply(ctx: Context, config: Config): () => Promise<void> {
  const placement = new TeamPlacement(ctx, config)
  return () => placement.close()
}
