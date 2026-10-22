/** Original personnel cut authorities are private, revocable and re-resolved by both the Hub and Native queue. */
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@clocky/cordis'
import { simulationPersonnelSettlementCutScopeSchema } from '@clocky/clocky-team'
import type { TeamId, TeamSystemMaintenanceProof, SimulationPersonnelSettlementCutScope,
  TeamPersonnelSettlementCutSources } from '@clocky/clocky-team'
import { personnelObligationQuerySchema, personnelTerminalSourceFingerprint } from '@clocky/clocky-simulation'
import type { SimulationRun, WorldIntentId, PersonnelCommitProof, PersonnelCommitEvidence, SimulationWorldResult } from '@clocky/clocky-simulation'
import { projectPersonnelObligations } from './personnel-obligations.ts'
import { projectPersonnelTaskTerminalEvidence } from './personnel-terminal.ts'

/** A single source owns all currently admitted original personnel settlement cuts. */
export class PersonnelSettlementAuthority {
  private readonly hubProofs = new WeakMap<TeamSystemMaintenanceProof, () => SimulationPersonnelSettlementCutScope | undefined>()
  private readonly nativeProofs = new WeakMap<PersonnelCommitProof, () => PersonnelCommitEvidence | undefined>()

  /** @param ctx - Original canonical Team reader and proof registry; registration follows the source's Fiber lifetime. */
  constructor(private readonly ctx: Context) {
    ctx.teams.registerSystemMaintenanceProofSource({ name: 'simulation-personnel',
      resolveMaintenanceProof: proof => this.hubProofs.get(proof)?.() })
  }

  /**
   * Register the original run's Native commit authority and retain its exact source owner name.
   * @param run - Original exclusive Native run.
   * @param owner - Exact durable maintenance/lifecycle owner selected by preparation.
   * @returns disposer closing fresh cut proof admission without discarding durable responsibility.
   */
  attach(run: SimulationRun, owner: string): () => void {
    return run.onPersonnelCommitAuthority(owner, proof => this.nativeProofs.get(proof)?.())
  }

  /**
   * Acquire the actual complete Team/channel source vector and submit only the original Native personnel mutation under that cut.
   * @param run - Original Native reservation owner.
   * @param teamId - Canonical original Team.
   * @param owner - Exact recorded lifecycle and maintenance owner.
   * @param id - Original retained personnel intent identity.
   * @param admitted - Original connection's current source admission.
   * @returns original atomic result; missing obligations, moving source or unknown retirement remains unresolved.
   */
  async commit(run: SimulationRun, teamId: TeamId, owner: string, id: WorldIntentId, admitted: () => void): Promise<SimulationWorldResult> {
    admitted()
    const reservation = run.snapshot().world?.personnel.reservations[id]
    if (reservation === undefined || reservation.request.maintenance.owner !== owner) throw new Error('Personnel source lost its original reservation owner')
    if (reservation.status === 'committed') {
      const result = Object.values(run.snapshot().world?.results ?? {}).find(value => value.intentId === id && value.outcome.kind === 'committed')
      if (result === undefined) throw new Error('Committed personnel reservation lost its original result')
      return result
    }
    const team = await this.ctx.teams.getTeam({ teamId })
    const channels: { channelId: import('@clocky/clocky-team').ChannelId; cursor: number }[] = []
    for (const channelId of [...team.channelIds].sort()) {
      admitted()
      const channel = await this.ctx.teams.getChannel({ channelId })
      channels.push({ channelId, cursor: channel.cursor })
    }
    const scope = simulationPersonnelSettlementCutScopeSchema.parse({ kind: 'simulation-personnel-cut', runId: run.snapshot().spec.runId,
      teamId, lifecycleOwner: owner, personnelIntentId: id, expectedTeamCursor: team.team.cursor, channels })
    const token: object = {}
    Object.defineProperty(token, 'toJSON', { value: (): never => { throw new TypeError('Personnel source authority is runtime-only') } })
    const hub = Object.freeze(token) as TeamSystemMaintenanceProof
    this.hubProofs.set(hub, () => {
      try { admitted() } catch { return undefined /* Original source admission ended; no fresh cut can enter. */ }
      const current = run.snapshot().world?.personnel.reservations[id]
      return current !== undefined && isDeepStrictEqual(current.request, reservation.request) && current.status === 'fenced' ? scope : undefined
    })
    try {
      return await this.ctx.teams.withPersonnelSettlementCut({ scope, actor: hub }, async (sources) => {
        const nativeToken: object = {}
        Object.defineProperty(nativeToken, 'toJSON', { value: (): never => { throw new TypeError('Personnel Native authority is runtime-only') } })
        const native = Object.freeze(nativeToken) as PersonnelCommitProof
        this.nativeProofs.set(native, () => this.evidence(run, id, sources, admitted))
        try { return await run.commitPersonnel(id, native) }
        finally { this.nativeProofs.delete(native) }
      })
    } finally { this.hubProofs.delete(hub) }
  }

  private evidence(run: SimulationRun, id: WorldIntentId, sources: TeamPersonnelSettlementCutSources,
    admitted: () => void): PersonnelCommitEvidence | undefined {
    try { admitted() } catch { return undefined /* A retired connection cannot publish a new Native personnel commit. */ }
    const state = run.snapshot(), world = state.world
    const reservation = world?.personnel.reservations[id]
    const person = reservation === undefined ? undefined : state.entities[reservation.personId]
    if (world === undefined || reservation?.status !== 'fenced' || person?.binding === undefined) return undefined
    const binding = person.binding
    const query = personnelObligationQuerySchema.parse({ selector: { kind: 'assignment', personId: person.id,
      personRevision: person.revision, assignmentId: reservation.assignmentId, assignmentRevision: reservation.assignmentRevision },
    limit: 1024, maxBytes: Math.min(world.definition.limits.maxBytesPerPlan, 1024 * 1024) })
    const original = run.inspectPersonnelObligations(query)
    const channels = sources.channels.map(({ channel, pending }) => ({ channel, deliveries: pending.flatMap(value =>
      value.recipientId !== binding.participantId && value.senderId !== binding.participantId ? [] : [{
        ...value, direction: value.recipientId === binding.participantId ? 'incoming' as const : 'outgoing' as const }]) }))
    const projected = projectPersonnelObligations(state, original, { team: sources.team, channels, complete: true }, query)
    const terminalTasks = projectPersonnelTaskTerminalEvidence(state, sources.team, original)
    const coverage = projected.coverage.team
    const report = coverage.kind !== 'observed' ? projected : { ...projected, coverage: { ...projected.coverage,
      team: { ...coverage, hash: personnelTerminalSourceFingerprint(coverage, terminalTasks) } } }
    return { reservationId: id, report, terminalTasks }
  }
}
