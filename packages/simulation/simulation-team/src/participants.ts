/** Recoverable canonical participant provisioning without model execution. @module @clocky/clocky-simulation-team/participants */
import type { Context } from '@clocky/cordis'
import { isDeepStrictEqual } from 'node:util'
import { simulationParticipantSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationEntityBinding, SimulationEntityId, SimulationParticipantSpec, SimulationRun } from '@clocky/clocky-simulation'
import type { ParticipantSnapshot, TeamId, TeamSystemTopologyProof, TeamSystemTopologyScope } from '@clocky/clocky-team'

/** Serializes topology writes for each attached run and retains exact proofs only during target IO. */
export class SimulationParticipantAuthority {
  private readonly proofs = new WeakMap<TeamSystemTopologyProof, () => TeamSystemTopologyScope | undefined>()
  private readonly pending = new Map<SimulationRun, Promise<unknown>>()

  constructor(private readonly ctx: Context) {
    ctx.teams.registerSystemTopologyProofSource({ name: 'simulation-team', resolveTopologyProof: proof => this.proofs.get(proof)?.() })
  }

  /**
   * Reserve, invite, activate membership and bind one canonical local participant.
   * @param run - Exclusive run owner with a confirmed root Team.
   * @param entityId - Active cognitive entity.
   * @param participant - Immutable explicit actor configuration.
   * @param teamId - Attached canonical Team.
   * @param lifecycleOwner - Attached lifecycle authority.
   * @param assertAdmitted - Rejects after connection shutdown.
   * @returns permanent binding after each target reply matches the reserved Participant; retries do not start an Agent.
   */
  ensure(run: SimulationRun, entityId: SimulationEntityId, participant: SimulationParticipantSpec, teamId: TeamId,
    lifecycleOwner: string, assertAdmitted: () => void): Promise<SimulationEntityBinding> {
    const accepted = simulationParticipantSpecSchema.parse(participant)
    assertAdmitted()
    const work = (this.pending.get(run) ?? Promise.resolve()).then(async () => {
      assertAdmitted()
      await run.reserveParticipant(entityId, accepted, run.inspectEntity(entityId).revision)
      const observed = run.inspectEntity(entityId)
      const reservation = observed.entity?.participantReservation
      if (reservation?.binding.teamId !== teamId) throw new Error('Simulation participant has no canonical reservation')
      const check = (): void => {
        assertAdmitted()
        const entity = run.inspectEntity(entityId).entity
        if (entity?.phase !== 'active' || !isDeepStrictEqual(entity.participantReservation, reservation)) {
          throw new Error('Simulation participant reservation is no longer authorized')
        }
      }
      const exactTarget = (target: ParticipantSnapshot): ParticipantSnapshot => {
        if (target.id !== reservation.binding.participantId) throw new Error('Simulation participant target returned another identity')
        return target
      }
      const state = await this.ctx.teams.getTeam({ teamId })
      const input = { teamId, expectedCursor: state.team.cursor, kind: 'local-agent' as const, ...accepted }
      let target = exactTarget(await this.withProof({ kind: 'simulation-participant-invite', teamId, expectedCursor: state.team.cursor,
        runId: observed.runId, lifecycleOwner, participantId: reservation.binding.participantId,
        participant: { kind: 'local-agent', ...accepted } }, check,
      async actor => await this.ctx.teams.inviteParticipant({ actor, ...input })))
      for (const phase of ['provisioning', 'active'] as const) {
        if (target.phase === 'active' || phase === 'provisioning' && target.phase === 'provisioning') continue
        if (target.phase !== 'invited' && target.phase !== 'provisioning') throw new Error('Simulation participant cannot resume provisioning')
        const latest = await this.ctx.teams.getTeam({ teamId })
        target = exactTarget(await this.withProof({ kind: 'simulation-participant-phase', teamId, participantId: target.id,
          expectedCursor: latest.team.cursor, expectedPhase: target.phase, phase,
          runId: observed.runId, lifecycleOwner }, check,
        async actor => await this.ctx.teams.transitionParticipantPhase({ actor, teamId, participantId: target.id,
          expectedCursor: latest.team.cursor, phase })))
      }
      check()
      await run.bindEntity(entityId, reservation.binding, run.inspectEntity(entityId).revision)
      return reservation.binding
    })
    const settled = work.then(() => {}, () => {})
    this.pending.set(run, settled)
    void settled.then(() => { if (this.pending.get(run) === settled) this.pending.delete(run) })
    return work
  }

  /**
   * Drain accepted topology IO before releasing the run coordinator.
   * @param run - Closing run whose admission has already stopped.
   * @returns completion after every queued provisioning attempt settles.
   */
  async drain(run: SimulationRun): Promise<void> { await this.pending.get(run) }

  private async withProof<T>(scope: TeamSystemTopologyScope, check: () => void,
    operation: (actor: TeamSystemTopologyProof) => Promise<T>): Promise<T> {
    check()
    const token: object = {}
    Object.defineProperty(token, 'toJSON', { enumerable: true, value: (): never => { throw new TypeError('Simulation topology authority is runtime-only') } })
    const proof = Object.freeze(token) as TeamSystemTopologyProof
    this.proofs.set(proof, () => { check(); return scope })
    try { return await operation(proof) }
    finally { this.proofs.delete(proof) }
  }
}
