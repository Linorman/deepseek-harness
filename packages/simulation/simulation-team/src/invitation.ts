/** Runtime consent for canonical Simulation Session endpoints. @module @clocky/clocky-simulation-team/invitation */
import type { Context } from '@clocky/cordis'
import { channelInvitationIdempotencyKeySchema } from '@clocky/clocky-team'
import type { ChannelAdmissionSnapshot, ChannelId, SimulationChannelInvitationAcknowledgeScope, TeamId, TeamSystemChannelAdmissionProof } from '@clocky/clocky-team'
import type { SimulationEntityId, SimulationRun } from '@clocky/clocky-simulation'

/** Named owner of exact invitation consent; no model request or activation is needed. */
export class SimulationInvitationAuthority {
  private readonly proofs = new WeakMap<TeamSystemChannelAdmissionProof, () => SimulationChannelInvitationAcknowledgeScope | undefined>()
  private readonly pending = new Map<SimulationRun, Set<Promise<ChannelAdmissionSnapshot>>>()

  constructor(private readonly ctx: Context) {
    ctx.teams.registerSystemChannelAdmissionProofSource({ name: 'simulation-team',
      resolveChannelAdmissionProof: proof => this.proofs.get(proof)?.() })
  }

  /**
   * Confirm a channel's frozen Session against its current canonical run binding.
   * @param run - Exclusive journal owner.
   * @param entityId - Entity whose endpoint consents.
   * @param channelId - Pending or already acknowledged direct channel.
   * @param teamId - Canonical execution Team.
   * @param lifecycleOwner - Immutable controller owner.
   * @param accepting - Connection admission checked again inside Hub policy serialization.
   * @returns durable invitation state; failed or expired consent rejects.
   */
  acknowledge(run: SimulationRun, entityId: SimulationEntityId, channelId: ChannelId, teamId: TeamId,
    lifecycleOwner: string, accepting: () => boolean): Promise<ChannelAdmissionSnapshot> {
    const work = this.confirm(run, entityId, channelId, teamId, lifecycleOwner, accepting)
    const pending = this.pending.get(run) ?? new Set<Promise<ChannelAdmissionSnapshot>>()
    pending.add(work)
    this.pending.set(run, pending)
    const settled = () => {
      pending.delete(work)
      if (pending.size === 0) this.pending.delete(run)
    }
    void work.then(settled, settled)
    return work
  }

  /**
   * Wait for accepted endpoint acknowledgement IO after its connection closes admission.
   * @param run - Run whose coordinator lock must remain held during target IO.
   * @returns completion after each acknowledgement settles; callers retain their individual errors.
   */
  async drain(run: SimulationRun): Promise<void> {
    const pending = this.pending.get(run)
    if (pending !== undefined) await Promise.allSettled([...pending])
  }

  private async confirm(run: SimulationRun, entityId: SimulationEntityId, channelId: ChannelId, teamId: TeamId,
    lifecycleOwner: string, accepting: () => boolean): Promise<ChannelAdmissionSnapshot> {
    if (!accepting()) throw new Error('Simulation invitation admission is closed')
    const observed = run.inspectEntity(entityId)
    const binding = observed.entity?.binding
    if (binding?.teamId !== teamId) throw new Error('Simulation invitation requires a canonical entity binding')
    const admission = await this.ctx.teams.getChannelAdmission({ channelId })
    const invitation = admission.invitations.find(value => value.participantId === binding.participantId)
    if (admission.channel.manifest.teamId !== teamId || invitation?.endpoint.kind !== 'activation'
      || invitation.endpoint.sessionId !== binding.sessionId || invitation.endpoint.activationId !== undefined) {
      throw new Error('Simulation invitation does not select its canonical Session endpoint')
    }
    const scope: SimulationChannelInvitationAcknowledgeScope = { kind: 'simulation-invitation-acknowledge',
      runId: observed.runId, lifecycleOwner, teamId, participantId: binding.participantId,
      sessionId: binding.sessionId, channelId, revision: invitation.revision, manifestFingerprint: invitation.manifestFingerprint,
      idempotencyKey: channelInvitationIdempotencyKeySchema.parse(JSON.stringify(['simulation', observed.runId, entityId, channelId, invitation.revision])) }
    const token: object = {}
    Object.defineProperty(token, 'toJSON', { enumerable: true, value: (): never => { throw new TypeError('Simulation invitation authority is runtime-only') } })
    const proof = Object.freeze(token) as TeamSystemChannelAdmissionProof
    this.proofs.set(proof, () => {
      const entity = run.inspectEntity(entityId).entity
      return accepting() && entity?.phase === 'active' && entity.binding?.teamId === teamId
        && entity.binding.participantId === scope.participantId && entity.binding.sessionId === scope.sessionId ? scope : undefined
    })
    try {
      return await this.ctx.teams.acknowledgeChannelInvitation({ actor: proof, channelId, revision: scope.revision,
        manifestFingerprint: scope.manifestFingerprint, idempotencyKey: scope.idempotencyKey })
    } finally { this.proofs.delete(proof) }
  }
}
