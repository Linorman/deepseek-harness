/** Durable direct-channel provisioning and canonical endpoint consent. @module @clocky/clocky-simulation-team/channels */
import type { Context } from '@clocky/cordis'
import { isDeepStrictEqual } from 'node:util'
import { simulationChannelSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationChannelSpec, SimulationRun } from '@clocky/clocky-simulation'
import type { ChannelSnapshot, SimulationChannelOpenScope, TeamId, TeamSystemChannelLifecycleProof } from '@clocky/clocky-team'
import type { SimulationInvitationAuthority } from './invitation.ts'

/** Owns serial channel provisioning per run; channel existence alone never grants endpoint consent. */
export class SimulationChannelAuthority {
  private readonly proofs = new WeakMap<TeamSystemChannelLifecycleProof, () => SimulationChannelOpenScope>()
  private readonly pending = new Map<SimulationRun, Promise<unknown>>()

  constructor(private readonly ctx: Context, private readonly invitations: SimulationInvitationAuthority) {
    ctx.teams.registerSystemChannelLifecycleProofSource({ name: 'simulation-team', resolveChannelLifecycleProof: proof => this.proofs.get(proof)?.() })
  }

  /**
   * Resume channel creation and required consent without activating any member.
   * @param run - Exclusive run with a confirmed canonical Team.
   * @param request - Stable retry key, ordered members and explicit limits.
   * @param teamId - Attached execution Team.
   * @param lifecycleOwner - Immutable lifecycle owner.
   * @param checkAdmission - Rejects after shutdown starts.
   * @returns the admitted channel after its confirmation is durable in the run.
   */
  ensure(run: SimulationRun, request: SimulationChannelSpec, teamId: TeamId, lifecycleOwner: string,
    checkAdmission: () => void): Promise<ChannelSnapshot> {
    const spec = simulationChannelSpecSchema.parse(request)
    checkAdmission()
    const work = (this.pending.get(run) ?? Promise.resolve()).then(async () => {
      checkAdmission()
      await run.reserveChannel(spec, run.snapshot().revision)
      const reservedState = run.snapshot()
      const reserved = reservedState.channelReservations?.[spec.key]
      if (reserved === undefined) throw new Error('Simulation channel lost its reservation')
      const bindings = spec.members.map((member) => {
        const entity = reservedState.entities[member.entityId]
        if (entity?.phase !== 'active' || entity.binding?.teamId !== teamId) throw new Error('Simulation channel member has no active canonical binding')
        return { binding: entity.binding, role: member.role }
      })
      const check = (): void => {
        checkAdmission()
        const state = run.snapshot()
        if (!isDeepStrictEqual(state.channelReservations?.[spec.key]?.spec, spec)
          || spec.members.some((member, index) => {
            const entity = state.entities[member.entityId]
            return entity?.phase !== 'active' || !isDeepStrictEqual(entity.binding, bindings[index]?.binding)
          })) throw new Error('Simulation channel membership is no longer authorized')
      }
      const team = await this.ctx.teams.getTeam({ teamId })
      const input = { teamId, expectedCursor: team.team.cursor, adapter: { type: 'direct', version: 4 },
        participants: bindings.map(endpoint => ({ id: endpoint.binding.participantId, role: endpoint.role })),
        invitations: bindings.map(({ binding }) => ({
          participantId: binding.participantId, sessionId: binding.sessionId, required: true,
        })),
        limits: spec.limits }
      const scope: SimulationChannelOpenScope = { kind: 'simulation-channel-open', runId: reservedState.spec.runId,
        lifecycleOwner, channelId: reserved.channelId, ...input }
      const token: object = {}
      Object.defineProperty(token, 'toJSON', { enumerable: true, value: (): never => { throw new TypeError('Simulation channel authority is runtime-only') } })
      const proof = Object.freeze(token) as TeamSystemChannelLifecycleProof
      this.proofs.set(proof, () => { check(); return scope })
      let channel: ChannelSnapshot
      try { channel = await this.ctx.teams.openChannel({ actor: proof, authorityKind: 'channel-lifecycle', ...input }) }
      finally { this.proofs.delete(proof) }
      if (channel.manifest.id !== reserved.channelId) throw new Error('Simulation channel target returned another identity')
      for (const member of spec.members) {
        check()
        const admission = await this.invitations.acknowledge(run, member.entityId, channel.manifest.id, teamId, lifecycleOwner,
          () => { check(); return true })
        channel = admission.channel
      }
      check()
      if (channel.phase !== 'active') throw new Error('Simulation channel has not obtained every required consent')
      await run.confirmChannel(spec.key, channel.manifest.id, run.snapshot().revision)
      return channel
    })
    const settled = work.then(() => {}, () => {})
    this.pending.set(run, settled)
    void settled.then(() => { if (this.pending.get(run) === settled) this.pending.delete(run) })
    return work
  }

  /**
   * Drain accepted channel creation and consent IO before releasing the run lock.
   * @param run - Run whose admission is already closed.
   * @returns completion after its queued work settles.
   */
  async drain(run: SimulationRun): Promise<void> { await this.pending.get(run) }
}
