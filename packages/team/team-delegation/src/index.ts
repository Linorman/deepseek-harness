/** Parent-owned child-Team creation, consent, result settlement, and cancellation. @module @clocky/clocky-team-delegation */
import { realpath } from 'node:fs/promises'
import type { Context } from '@clocky/cordis'
import Schema from '@clocky/schemastery'
import { resolveAgentWorkspaceRoot } from '@clocky/clocky-agent'
import { registerTeamDelegationDriver, type TeamDelegationDriver } from '@clocky/clocky-team-run'
import '@clocky/clocky-team-run'
import '@clocky/clocky-team-workspace'
import {
  TeamError, channelInvitationIdempotencyKeySchema, channelPostIdempotencyKeySchema,
  type TeamId, type ChannelId, type TeamTaskSnapshot, type TeamStateSnapshot,
  type TeamSystemDelegationProof, type TeamSystemDelegationScope, type TeamTaskDelegationInput,
  type TeamSystemChildCreationProof, type TeamSystemChildCreationScope,
  type TeamSystemChannelAdmissionProof, type TeamSystemChannelAdmissionScope,
  type TeamSystemEnvelopePostProof, type TeamSystemEnvelopePostScope,
  type TeamSystemChildResultProof, type TeamSystemChildResultScope, type TeamChildRunBinding,
} from '@clocky/clocky-team'

/** Deployment bounds for one delegation drive and its channel reads. */
export interface Config {
  /** Maximum child-saga operations accepted by one Team drive. */
  readonly maxOperationsPerDrive: number
  /** Maximum channel records read in one child-result page. */
  readonly channelPageSize: number
  /** Maximum materialized Teams visited by one discovery pulse. */
  readonly teamPageSize: number
  /** Interval between bounded restart-safe discovery pulses, in milliseconds. */
  readonly pulseIntervalMs: number
}
/** Validated limits for restart scans and per-Team saga progress. */
export const Config: Schema<Config> = Schema.object({
  maxOperationsPerDrive: Schema.number().step(1).min(1).default(32),
  channelPageSize: Schema.number().step(1).min(1).default(128),
  teamPageSize: Schema.number().step(1).min(1).default(64),
  pulseIntervalMs: Schema.number().step(1).min(1).default(1000),
})
/** Cordis plugin identity. */
export const name = 'team-delegation'
/** All effects use the ordinary Team and Agent providers. */
export const inject = ['teams', 'teamRuns', 'agents', 'teamWorkspaces']

interface Drive { requested: boolean; readonly operation: Promise<void> }

/** One Consumer instance retains runtime proofs only for its accepted operations. */
export class TeamDelegation implements TeamDelegationDriver {
  private closing = false
  private readonly drives = new Map<TeamId, Drive>()
  private readonly parents = new Map<TeamId, TeamId>()
  private readonly channels = new Map<ChannelId, TeamId>()
  private readonly delegation = new Map<TeamSystemDelegationProof, TeamSystemDelegationScope>()
  private readonly creation = new Map<TeamSystemChildCreationProof, TeamSystemChildCreationScope>()
  private readonly invitations = new Map<TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope>()
  private readonly envelopes = new Map<TeamSystemEnvelopePostProof, TeamSystemEnvelopePostScope>()
  private readonly results = new Map<TeamSystemChildResultProof, TeamSystemChildResultScope>()
  private readonly disposers: (() => void | boolean | Promise<void>)[] = []
  private timer?: ReturnType<typeof setInterval>
  private discovery: Promise<void> | undefined
  /** Provider-order cursor retained between bounded restart-safe discovery pulses. */
  private teamCursor = -1

  constructor(private readonly ctx: Context, private readonly config: Config) {}

  /** Register sources before observing or discovering durable delegations. */
  start(): void {
    this.disposers.push(
      this.ctx.teams.registerSystemDelegationProofSource({ name, resolveDelegationProof: proof => this.delegation.get(proof),
        resolveChildWorkspace: async (proof) => {
          const scope = this.delegation.get(proof)
          if (scope === undefined) throw new TeamError('Delegation operation has ended', 'TEAM_ACTOR_PROOF_INVALID')
          return await this.workspace(scope.teamId, scope.taskId)
        } }),
      this.ctx.teams.registerSystemChildCreationProofSource({ name: 'team-child-delegation', resolveChildCreationProof: proof => this.creation.get(proof) }),
      this.ctx.teams.registerSystemChannelAdmissionProofSource({ name: 'parent-service', resolveChannelAdmissionProof: proof => this.invitations.get(proof) }),
      this.ctx.teams.registerSystemEnvelopePostProofSource({ name, resolveEnvelopePostProof: proof => this.envelopes.get(proof) }),
      this.ctx.teams.registerSystemChildResultProofSource({ name, resolveChildResultProof: proof => this.results.get(proof) }),
      this.ctx.on('team/changed', (event) => {
        if (event.type === 'team/created' || event.type === 'team/changed') {
          if (event.team.parentTeamId !== undefined) this.parents.set(event.team.id, event.team.parentTeamId)
          this.request(event.team.id)
        } else if (event.type === 'task/changed') this.request(event.task.teamId)
        else if (event.type === 'activation/changed') this.request(event.binding.activation.teamId)
      }),
      this.ctx.on('channel/changed', (event) => {
        const parent = this.channels.get(event.channelId)
        if (parent !== undefined) this.request(parent)
      }),
    )
    this.timer = setInterval(() => { this.discover() }, this.config.pulseIntervalMs)
    this.timer.unref()
    this.discover()
  }

  /** Drive one parent, coalescing events that arrive while it advances.
   * @param teamId - Exact parent selected by a durable event or startup discovery.
   * @returns Completion of all work accepted by this drive.
   */
  drive(teamId: TeamId): Promise<void> {
    if (this.closing) return Promise.resolve()
    const prior = this.drives.get(teamId)
    if (prior !== undefined) { prior.requested = true; return prior.operation }
    const drive: Drive = { requested: true, operation: Promise.resolve().then(async () => {
      while (drive.requested && !this.closing) {
        drive.requested = false
        for (let index = 0; index < this.config.maxOperationsPerDrive && !this.isClosing(); index++) {
          if (!await this.advance(teamId)) break
        }
      }
    }).finally(() => { this.drives.delete(teamId) }) }
    this.drives.set(teamId, drive)
    return drive.operation
  }

  /** Stop observations, revoke proofs, and await every operation already accepted. */
  async close(): Promise<void> {
    this.closing = true
    if (this.timer !== undefined) clearInterval(this.timer)
    const errors: unknown[] = []
    for (const dispose of this.disposers.splice(0).reverse()) {
      try { await dispose() } catch (error: unknown) { errors.push(error) }
    }
    this.delegation.clear(); this.creation.clear(); this.invitations.clear(); this.envelopes.clear(); this.results.clear()
    const settled = await Promise.allSettled([
      ...(this.discovery === undefined ? [] : [this.discovery]), ...[...this.drives.values()].map(drive => drive.operation),
    ])
    for (const result of settled) {
      if (result.status === 'rejected') {
        const reason: unknown = result.reason
        errors.push(reason)
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Delegation operations failed during disposal')
  }

  private request(teamId: TeamId): void {
    if (this.closing) return
    void this.drive(teamId).catch((error: unknown) => { this.report(error) })
    const parent = this.parents.get(teamId)
    if (parent !== undefined && parent !== teamId) void this.drive(parent).catch((error: unknown) => { this.report(error) })
  }

  private discover(): void {
    if (this.closing || this.discovery !== undefined) return
    const afterCursor = this.teamCursor
    this.discovery = this.ctx.teams.listTeamsPage({ afterCursor, limit: this.config.teamPageSize }).then(async (page) => {
      for (const team of page.items) {
        if (this.closing) return
        if (team.parentTeamId !== undefined) this.parents.set(team.id, team.parentTeamId)
        await this.drive(team.id)
      }
      if (page.nextCursor !== undefined && page.nextCursor <= afterCursor) {
        throw new TeamError('Team discovery page cursor did not advance', 'TEAM_CURSOR_CONFLICT')
      }
      this.teamCursor = page.nextCursor ?? -1
    }).catch((error: unknown) => { this.report(error) }).finally(() => { this.discovery = undefined })
  }

  private isClosing(): boolean { return this.closing }

  private report(error: unknown): void {
    if (!this.closing) this.ctx.logger.warn(`team-delegation: ${String(error)}`)
  }

  private async workspace(teamId: TeamId, taskId: TeamTaskSnapshot['id']): Promise<string> {
    const state = await this.ctx.teams.getTeam({ teamId })
    const task = state.tasks.find(task => task.id === taskId)
    if (task === undefined) throw new TeamError('Parent task is unavailable', 'TEAM_TASK_NOT_FOUND')
    for (const binding of state.activations) {
      const participant = state.participants.find(participant => participant.id === binding.activation.participantId)
      if (participant?.role !== 'coordinator' || participant.kind !== 'local-agent' || participant.phase !== 'active') continue
      const agent = this.ctx.agents.get(binding.sessionId)
      if (agent === undefined || !await this.ctx.teamWorkspaces.eligible('shared', { task, binding })) continue
      const root = resolveAgentWorkspaceRoot(agent)
      if (root !== undefined) return await realpath(root)
    }
    throw new TeamError('Parent delegation requires its current controlled shared workspace', 'TEAM_DELEGATION_WORKSPACE_UNAVAILABLE')
  }

  private input(state: TeamStateSnapshot, task: TeamTaskSnapshot): TeamTaskDelegationInput {
    if (task.delegation === undefined) throw new TeamError('Task has no delegation', 'TEAM_DELEGATION_INVALID')
    return { teamId: state.team.id, taskId: task.id, expectedCursor: state.team.cursor,
      expectedRevision: task.revision, delegationId: task.delegation.id }
  }

  private async withProof<P extends object, S, R>(map: Map<P, S>, scope: S, operation: (proof: P) => Promise<R>): Promise<R> {
    if (this.closing) throw new TeamError('Delegation Consumer is closing', 'TEAM_ACTOR_PROOF_INVALID')
    const proof = Object.freeze({ toJSON(): never { throw new TypeError('Delegation proofs are runtime-only') } }) as unknown as P
    map.set(proof, scope)
    try { return await operation(proof) } finally { map.delete(proof) }
  }

  private async advance(teamId: TeamId): Promise<boolean> {
    const state = await this.ctx.teams.getTeam({ teamId })
    const tasks = state.tasks.filter(task => task.execution.kind === 'child-team' && !terminal(task.phase))
    for (const task of tasks) {
      try { if (await this.advanceTask(state, task)) return true } catch (error: unknown) {
        if (error instanceof TeamError && ['TEAM_CURSOR_CONFLICT', 'TEAM_CHANNEL_CURSOR_CONFLICT', 'TEAM_TASK_STALE_REVISION', 'TEAM_DELEGATION_BUSY'].includes(error.code)) return false
        if (this.closing && error instanceof TeamError && error.code === 'TEAM_ACTOR_PROOF_INVALID') return false
        const latest = await this.ctx.teams.getTeam({ teamId })
        const selected = latest.tasks.find(candidate => candidate.id === task.id)
        if (selected === undefined || terminal(selected.phase)) continue
        if (task.cancellation === undefined && state.team.cancellation === undefined && state.team.closure === undefined
          && (selected.cancellation !== undefined || latest.team.cancellation !== undefined || latest.team.closure !== undefined)) {
          return true
        }
        const input = { ...this.input(latest, selected),
          reason: { code: error instanceof TeamError ? error.code : 'TEAM_DELEGATION_FAILED', message: String(error) } }
        await this.withProof(this.delegation, { kind: 'delegation-stall', ...input },
          actor => this.ctx.teams.stallTaskDelegation({ ...input, actor }))
        return false
      }
    }
    return false
  }

  private async advanceTask(state: TeamStateSnapshot, task: TeamTaskSnapshot): Promise<boolean> {
    const delegation = task.delegation
    if (task.execution.kind !== 'child-team' || delegation === undefined) return false
    const input = this.input(state, task)
    const cancelling = task.cancellation !== undefined || state.team.cancellation !== undefined || state.team.closure !== undefined
    if (delegation.childTeamId === undefined) {
      if (cancelling || state.team.phase !== 'active' || task.phase !== 'pending'
        || !task.blockedBy.every(id => state.tasks.some(candidate => candidate.id === id && candidate.phase === 'completed'))) return false
      const rules = this.ctx.teamRuns.describeChildTemplate(task.execution.templateId, task.execution.templateVersion)
      const workspacePath = await this.workspace(state.team.id, task.id)
      const child = { goal: { objective: task.description, budgets: { ...task.execution.budget } },
        rules: { ...state.rules, ...rules, workspacePath }, budgets: { ...task.execution.budget },
        authorityGrant: task.execution.authorityGrant }
      await this.withProof(this.delegation, { kind: 'delegation-begin', ...input, child },
        actor => this.ctx.teams.beginTaskDelegation({ ...input, child, actor }))
      return true
    }
    const childTeamId = delegation.childTeamId
    this.parents.set(childTeamId, state.team.id)
    let child: TeamStateSnapshot
    try { child = await this.ctx.teams.getTeam({ teamId: childTeamId }) } catch (error: unknown) {
      if (!(error instanceof TeamError) || error.code !== 'TEAM_NOT_FOUND') throw error
      if (cancelling) {
        await this.withProof(this.delegation, { kind: 'delegation-settle', ...input, childTeamId }, actor => this.ctx.teams.settleTaskDelegation({ ...input, childTeamId, actor }))
        return true
      }
      if (delegation.childCursor !== undefined || delegation.creation === undefined) throw new TeamError('Reserved child stream disappeared', 'TEAM_DELEGATION_CHILD_MISSING')
      const creation = delegation.creation
      await this.withProof(this.creation, { kind: 'team-child-create', ...creation, expectedParentCursor: state.team.cursor }, actor => this.ctx.teams.createTeam({ ...creation, actor }))
      return true
    }
    if (terminal(child.team.phase)) {
      await this.withProof(this.delegation, { kind: 'delegation-settle', ...input, childTeamId }, actor => this.ctx.teams.settleTaskDelegation({ ...input, childTeamId, actor }))
      return true
    }
    if (cancelling) {
      const cancelled = await this.withProof(this.delegation, {
        kind: 'delegation-authorize-run', ...input, operation: 'cancel',
      }, async (actor) => {
        const authorization = await this.ctx.teams.authorizeChildRun({ ...input, operation: 'cancel', actor })
        try {
          return await this.ctx.teamRuns.cancelChild({ parentTeamId: state.team.id, parentTaskId: task.id,
            delegationId: delegation.id, childTeamId, authorization })
        }
        finally { authorization.close() }
      })
      if (cancelled.team.phase === 'stalled') {
        await this.retainChildStall(state, task, cancelled)
        return false
      }
      return true
    }
    if (child.team.phase === 'stalled' && delegation.result === undefined) {
      await this.retainChildStall(state, task, child)
      return false
    }
    if (delegation.result !== undefined) {
      const binding = delegation.result.binding
      const completed = await this.withProof(this.results, {
        kind: 'child-result-complete', binding, admission: delegation.result, expectedCursor: child.team.cursor,
      }, actor => this.ctx.teams.completeChildTeam({ actor, childTeamId, expectedCursor: child.team.cursor }))
      if (completed.team.phase === 'stalled') {
        await this.retainChildStall(state, task, completed)
        return false
      }
      return true
    }
    if (state.team.phase !== 'active') return false
    if (delegation.childCursor === undefined || (child.team.childRun !== undefined && (delegation.phase === 'creating' || delegation.phase === 'stalled'))) {
      await this.withProof(this.delegation, { kind: 'delegation-bind', ...input, childTeamId }, actor => this.ctx.teams.bindTaskDelegation({ ...input, childTeamId, actor }))
      return true
    }
    if (child.team.childRun !== undefined && (await this.readExchange(state, task, child.team.childRun)).admitted) return true
    const binding = await this.withProof(this.delegation, {
      kind: 'delegation-authorize-run', ...input, operation: 'start',
    }, async (actor) => {
      const authorization = await this.ctx.teams.authorizeChildRun({ ...input, operation: 'start', actor })
      try {
        return await this.ctx.teamRuns.startChild({ parentTeamId: state.team.id, parentTaskId: task.id,
          delegationId: delegation.id, childTeamId, authorization })
      }
      finally { authorization.close() }
    })
    this.channels.set(binding.channelId, state.team.id)
    return await this.exchange(state, task, binding)
  }

  private async retainChildStall(state: TeamStateSnapshot, task: TeamTaskSnapshot, child: TeamStateSnapshot): Promise<void> {
    const current = await this.ctx.teams.getTeam({ teamId: state.team.id })
    const selected = current.tasks.find(candidate => candidate.id === task.id)
    if (selected === undefined || terminal(selected.phase)) return
    const reason = child.team.stallReason
    if (reason === undefined) throw new TeamError('Stalled child has no durable reason', 'TEAM_DELEGATION_INVALID')
    const input = { ...this.input(current, selected), reason }
    await this.withProof(this.delegation, { kind: 'delegation-stall', ...input }, actor => this.ctx.teams.stallTaskDelegation({ ...input, actor }))
  }

  private async exchange(state: TeamStateSnapshot, task: TeamTaskSnapshot, binding: TeamChildRunBinding): Promise<boolean> {
    let admission = await this.ctx.teams.getChannelAdmission({ channelId: binding.channelId })
    const invitation = admission.invitations.find(invitation => invitation.participantId === binding.parentServiceId)
    if (invitation === undefined) throw new TeamError('Child parent-service invitation is missing', 'TEAM_DELEGATION_INVALID')
    if (invitation.status === 'pending') {
      const input = { channelId: binding.channelId, revision: invitation.revision, manifestFingerprint: invitation.manifestFingerprint,
        idempotencyKey: channelInvitationIdempotencyKeySchema.parse(`child-consent:${binding.delegationId}`) }
      admission = await this.withProof(this.invitations, { kind: 'channel-invitation-acknowledge', ...input, teamId: binding.childTeamId, participantId: binding.parentServiceId },
        actor => this.ctx.teams.acknowledgeChannelInvitation({ ...input, actor }))
    }
    if (admission.channel.phase === 'pending') return false
    const read = await this.readExchange(state, task, binding)
    if (read.admitted) return true
    if (this.closing) return false
    if (admission.channel.phase !== 'active') throw new TeamError('Child consult ended without a result', 'TEAM_DELEGATION_CHANNEL_UNAVAILABLE')
    if (read.requestFound) return false
    const objective = task.delegation?.creation?.goal.objective
    if (objective === undefined) throw new TeamError('Child objective reservation is missing', 'TEAM_DELEGATION_INVALID')
    await this.withProof(this.envelopes, { kind: 'team-delegation-request', binding, objective }, actor => this.ctx.teams.postChannelEnvelope({ actor,
      expectedCursor: admission.channel.cursor, idempotencyKey: channelPostIdempotencyKeySchema.parse(`child-request:${binding.delegationId}`),
      draft: { channelId: binding.channelId, audience: [binding.coordinatorId], kind: 'request', payload: { text: objective }, delivery: 'turn' } }))
    return true
  }
  private async readExchange(
    state: TeamStateSnapshot, task: TeamTaskSnapshot, binding: TeamChildRunBinding,
  ): Promise<{ readonly requestFound: boolean; readonly admitted: boolean }> {
    let afterCursor = -1
    let requestFound = false
    while (!this.closing) {
      const page = await this.ctx.teams.readChannelPage({ channelId: binding.channelId, afterCursor, limit: this.config.channelPageSize })
      for (const record of page.records) {
        if (record.type !== 'channel/envelope') continue
        if (record.envelope.kind === 'request' && record.envelope.senderId === binding.parentServiceId) requestFound = true
        if (record.envelope.kind === 'response' && record.envelope.senderId === binding.coordinatorId) {
          const current = await this.ctx.teams.getTeam({ teamId: state.team.id })
          const latest = current.tasks.find(candidate => candidate.id === task.id)
          if (latest === undefined) throw new TeamError('Parent task disappeared', 'TEAM_DELEGATION_INVALID')
          const input = { ...this.input(current, latest), childTeamId: binding.childTeamId, responseEnvelopeId: record.envelope.id }
          await this.withProof(this.delegation, { kind: 'delegation-result-admit', ...input }, actor => this.ctx.teams.admitTaskDelegationResult({ ...input, actor }))
          return { requestFound: true, admitted: true }
        }
      }
      if (page.nextCursor === undefined) break
      if (page.nextCursor <= afterCursor) {
        throw new TeamError('Child delegation channel page cursor did not advance', 'TEAM_CHANNEL_CURSOR_CONFLICT')
      }
      afterCursor = page.nextCursor
    }
    return { requestFound, admitted: false }
  }

}

function terminal(phase: string): boolean { return ['completed', 'failed', 'cancelled', 'deleted', 'archived'].includes(phase) }

/** Mount the Consumer and await quiescence when its plugin scope ends.
 * @param ctx - Shared Team service scope.
 * @param config - Validated scan and read bounds.
 */
export function apply(ctx: Context, config: Config): void {
  const consumer = new TeamDelegation(ctx, config)
  ctx.effect(() => {
    const unregister = registerTeamDelegationDriver(ctx, consumer)
    try {
      consumer.start()
    } catch (error: unknown) {
      unregister()
      throw error
    }
    return async () => { unregister(); await consumer.close() }
  })
}
