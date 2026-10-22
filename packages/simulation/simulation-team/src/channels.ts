import { ProvisioningQueue } from './provisioning-queue.ts'
import { originalWorldChannel, assertWorldChannelAdmission } from './world-cleanup.ts'
import type { WorldIdentityCleanupSelection, WorldChannelCleanupSelection } from './world-cleanup.ts'
/** Durable direct-channel provisioning and canonical endpoint consent. @module @clocky/clocky-simulation-team/channels */
import type { Context } from '@clocky/cordis'
import { isDeepStrictEqual } from 'node:util'
import { simulationChannelSpecSchema, assertSimulationWorldPreparationAdmission } from '@clocky/clocky-simulation'
import type { SimulationChannelSpec, SimulationRun } from '@clocky/clocky-simulation'
import type { ChannelSnapshot, ChannelAdmissionSnapshot, SimulationChannelOpenScope, SimulationChannelCloseScope,
  ChannelId, TeamId, TeamSystemChannelLifecycleProof } from '@clocky/clocky-team'
import type { SimulationInvitationAuthority } from './invitation.ts'

/** Owns serial channel provisioning per run; channel existence alone never grants endpoint consent. */
export class SimulationChannelAuthority {
  private readonly proofs = new WeakMap<TeamSystemChannelLifecycleProof, () => SimulationChannelOpenScope | SimulationChannelCloseScope>()
  private readonly pending = new ProvisioningQueue()

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
    const members = spec.members.map(member => member.entityId)
    checkAdmission()
    assertSimulationWorldPreparationAdmission(run.snapshot(), members, spec.key)
    return this.pending.enqueue(run, async () => {
      checkAdmission()
      assertSimulationWorldPreparationAdmission(run.snapshot(), members, spec.key)
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
        assertSimulationWorldPreparationAdmission(state, members, spec.key)
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

  }

  /**
   * Drain accepted channel creation and consent IO before releasing the run lock.
   * @param run - Run whose admission is already closed.
   * @returns completion after its queued work settles.
   */
  async drain(run: SimulationRun): Promise<void> { await this.pending.drain(run) }

  /**
   * Close an original cancelled identity channel, preserving its WAL and settling pending endpoint invitations.
   * @param run - Native cancelled preparation and quiescent maintenance owner.
   * @param reservation - Original newcomer and immutable private channel identities.
   * @param channelId - One of those two channels; other targets reject.
   * @param teamId - Canonical execution Team.
   * @param lifecycleOwner - Immutable source name.
   * @param check - Original domain cancellation and connection admission, checked around policy IO.
   * @param reason - Original domain's terminal cancellation label.
   * @returns terminal original channel or explicit source absence; unknown reads/close results propagate without capacity release.
   */
  async closeWorldIdentity(run: SimulationRun, reservation: WorldIdentityCleanupSelection, channelId: ChannelId,
    teamId: TeamId, lifecycleOwner: string, check: () => void,
    reason: 'World hire cancelled' | 'World external representative cancelled'): Promise<ChannelSnapshot | undefined> {
    check()
    const identity = reservation.identities.channels.find(value => value.channelId === channelId)
    const reserved = identity === undefined ? undefined : run.snapshot().channelReservations?.[identity.key]
    if (reserved?.channelId !== channelId) throw new Error('World cleanup channel has no original reservation')
    return await this.closeWorldChannel(run, { key: reserved.spec.key, channelId, spec: reserved.spec },
      teamId, lifecycleOwner, check, reason)
  }

  /**
   * Read exactly one original Channel without treating provider/storage failures as absence.
   * @param run - Original run retaining the source reservation.
   * @param selected - Exact Native Channel key, id and original canonical specification.
   * @param teamId - Canonical execution Team.
   * @param check - Domain owner, cancellation/keeper and connection lifetime check around IO.
   * @returns precise original admission or explicit not-found for an unconfirmed reservation.
   */
  async inspectWorldChannel(run: SimulationRun, selected: WorldChannelCleanupSelection, teamId: TeamId,
    check: () => void): Promise<ChannelAdmissionSnapshot | undefined> {
    check()
    const reserved = run.snapshot().channelReservations?.[selected.key]
    if (reserved?.channelId !== selected.channelId || !isDeepStrictEqual(reserved.spec, selected.spec)) {
      throw new Error('World cleanup Channel no longer has its exact original source')
    }
    const admission = await originalWorldChannel(this.ctx, selected.channelId)
    check()
    const current = run.snapshot().channelReservations?.[selected.key]
    if (current?.channelId !== selected.channelId || !isDeepStrictEqual(current.spec, selected.spec)) {
      throw new Error('World cleanup Channel source moved during inspection')
    }
    if (admission === undefined) {
      if (current.confirmed) throw new Error('World cleanup lost a confirmed canonical channel')
      return undefined
    }
    assertWorldChannelAdmission(run.snapshot(), selected, admission, teamId)
    return admission
  }

  /**
   * Close one unleased original Channel through its current domain proof; this never retires an endpoint.
   * @param run - Original paused source and maintenance owner.
   * @param selected - Exact single-Channel allocation, without fabricated two-Channel identity reservations.
   * @param teamId - Canonical execution Team.
   * @param lifecycleOwner - Original attached source name.
   * @param check - Domain cancellation, no-live-keeper and connection lifetime around source and Hub IO.
   * @param reason - Original domain's cancellation label.
   * @returns complete terminal original Channel or explicit source absence; unknown IO retains responsibility.
   */
  async closeWorldChannel(run: SimulationRun, selected: WorldChannelCleanupSelection,
    teamId: TeamId, lifecycleOwner: string, check: () => void,
    reason: 'World hire cancelled' | 'World external representative cancelled' | 'World external contact cancelled'):
  Promise<ChannelSnapshot | undefined> {
    const admission = await this.inspectWorldChannel(run, selected, teamId, check)
    check()
    if (admission === undefined) return undefined
    const channel = admission.channel
    if (channel.phase === 'closed' || channel.phase === 'expired' || channel.phase === 'failed') {
      if (admission.invitations.some(value => value.status === 'pending')) throw new Error('World cleanup terminal channel retains pending consent')
      return channel
    }
    const channelId = selected.channelId
    const scope: SimulationChannelCloseScope = { kind: 'simulation-channel-close', teamId, channelId,
      expectedCursor: channel.cursor, reason, runId: run.snapshot().spec.runId, lifecycleOwner }
    const token: object = {}
    Object.defineProperty(token, 'toJSON', { enumerable: true, value: (): never => { throw new TypeError('Simulation cleanup authority is runtime-only') } })
    const proof = Object.freeze(token) as TeamSystemChannelLifecycleProof
    this.proofs.set(proof, () => { check(); return scope })
    try {
      const closed = await this.ctx.teams.closeChannel({ actor: proof, channelId, expectedCursor: channel.cursor, reason })
      check()
      if (closed.manifest.id !== channelId || closed.phase !== 'closed') throw new Error('World cleanup closure reply differs from its original target')
      return closed
    } finally { this.proofs.delete(proof) }
  }
}
