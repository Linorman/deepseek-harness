import { ProvisioningQueue } from './provisioning-queue.ts'
import type { WorldIdentityCleanupSelection } from './world-cleanup.ts'
/** Recoverable canonical participant provisioning without model execution. @module @clocky/clocky-simulation-team/participants */
import type { Context } from '@clocky/cordis'
import { isDeepStrictEqual } from 'node:util'
import { simulationParticipantSpecSchema, assertSimulationWorldPreparationAdmission } from '@clocky/clocky-simulation'
import type { SimulationEntityBinding, SimulationEntityId, SimulationParticipantSpec, SimulationRun } from '@clocky/clocky-simulation'
import type { ParticipantSnapshot, TeamId, TeamSystemTopologyProof, TeamSystemTopologyScope } from '@clocky/clocky-team'

/** Serializes topology writes for each attached run and retains exact proofs only during target IO. */
export class SimulationParticipantAuthority {
  private readonly proofs = new WeakMap<TeamSystemTopologyProof, () => TeamSystemTopologyScope | undefined>()
  private readonly pending = new ProvisioningQueue()

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
    assertSimulationWorldPreparationAdmission(run.snapshot(), [entityId])
    return this.pending.enqueue(run, async () => {
      assertAdmitted()
      assertSimulationWorldPreparationAdmission(run.snapshot(), [entityId])
      await run.reserveParticipant(entityId, accepted, run.inspectEntity(entityId).revision)
      const observed = run.inspectEntity(entityId)
      const reservation = observed.entity?.participantReservation
      if (reservation?.binding.teamId !== teamId) throw new Error('Simulation participant has no canonical reservation')
      const check = (): void => {
        assertAdmitted()
        assertSimulationWorldPreparationAdmission(run.snapshot(), [entityId])
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

  }

  /**
   * Drain accepted topology IO before releasing the run coordinator.
   * @param run - Closing run whose admission has already stopped.
   * @returns completion after every queued provisioning attempt settles.
   */
  async drain(run: SimulationRun): Promise<void> { await this.pending.drain(run) }

  /**
   * Exit only the original cancelled identity's membership after accepted preparation IO drains.
   * @param run - Native cancellation and quiescent maintenance owner.
   * @param reservation - Original reserved member descriptor and identities.
   * @param teamId - Canonical execution Team.
   * @param lifecycleOwner - Immutable source identity.
   * @param check - Original domain cancellation and connection admission rechecked by the Hub around policy IO.
   * @returns retained terminal membership or proven absence; foreign descriptors and live activation/task obligations reject.
   */
  async retireWorldIdentity(run: SimulationRun, reservation: WorldIdentityCleanupSelection, teamId: TeamId,
    lifecycleOwner: string, check: () => void): Promise<{ readonly phase: 'left' | 'failed' } | undefined> {
    check()
    const team = await this.ctx.teams.getTeam({ teamId })
    const binding = reservation.identities.binding
    const target = team.participants.find(value => value.id === binding.participantId)
    check()
    if (target === undefined) {
      if (run.inspectEntity(reservation.identities.entityId).entity?.binding !== undefined) {
        throw new Error('World cleanup lost a bound canonical participant')
      }
      return undefined
    }
    const { modelVersion: _version, ...member } = reservation.request.member
    if (binding.teamId !== teamId || target.kind !== 'local-agent'
      || !isDeepStrictEqual({ displayName: target.displayName, role: target.role, capabilities: target.capabilities,
        provider: target.provider, preset: target.preset, model: target.model }, member)
      || target.activationReservation !== undefined || team.activations.some(value => value.activation.participantId === target.id)
      || team.tasks.some(task => task.lease?.participantId === target.id)) {
      throw new Error('World cleanup cannot retire a foreign member or an unresolved activation/task owner')
    }
    if (target.phase === 'left' || target.phase === 'failed') return { phase: target.phase }
    const retired = await this.withProof({ kind: 'simulation-participant-retire', runId: run.snapshot().spec.runId,
      lifecycleOwner, teamId, participantId: target.id, expectedCursor: team.team.cursor, expectedPhase: target.phase, phase: 'left' }, check,
    async actor => await this.ctx.teams.transitionParticipantPhase({ actor, teamId, participantId: target.id,
      expectedCursor: team.team.cursor, phase: 'left' }))
    check()
    if (retired.id !== target.id || retired.phase !== 'left') throw new Error('World cleanup membership reply differs from its original target')
    return { phase: retired.phase }
  }

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
