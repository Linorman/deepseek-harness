/** Journal-derived, revocable authority for exact Team outbox publication. @module @clocky/clocky-simulation-team/transport */
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@clocky/cordis'
import { channelPostIdempotencyKeySchema, TeamError } from '@clocky/clocky-team'
import { envelopeByteLimitDetails, fingerprintTeamEnvelopeDraft } from '@clocky/clocky-team'
import type { SimulationOperationEnvelopePostScope, TeamId, TeamSystemEnvelopePostProof } from '@clocky/clocky-team'
import type { SimulationOutboundMessage, SimulationRun, SimulationTeamTransport } from '@clocky/clocky-simulation'

/** One registered source retaining only currently executing post capabilities. */
export class SimulationPostAuthority {
  private readonly proofs = new WeakMap<TeamSystemEnvelopePostProof, () => SimulationOperationEnvelopePostScope | undefined>()

  constructor(private readonly ctx: Context) {
    ctx.teams.registerSystemEnvelopePostProofSource({ name: 'simulation-team',
      resolveEnvelopePostProof: proof => this.proofs.get(proof)?.() })
  }

  /**
   * Bind a transport to its canonical run and Team; sender identity never comes from a model tool.
   * @param run - Open journal owner.
   * @param teamId - Dedicated execution Team.
   * @param lifecycleOwner - Immutable Team rule selecting the cognition owner.
   * @param accepting - Whether this connection still permits new publication.
   * @returns a transport whose proofs are re-resolved inside the Hub's serializers.
   */
  transport(run: SimulationRun, teamId: TeamId, lifecycleOwner: string, accepting: () => boolean): SimulationTeamTransport {
    return { post: async (message) => {
      const resolve = () => scopeFor(run, teamId, lifecycleOwner, message, accepting())
      const scope = resolve()
      if (scope === undefined) throw new Error('Simulation transport has no exact accepted due intent')
      const token: object = {}
      Object.defineProperty(token, 'toJSON', { enumerable: true, value: (): never => { throw new TypeError('Simulation post authority is runtime-only') } })
      const proof = Object.freeze(token) as TeamSystemEnvelopePostProof
      this.proofs.set(proof, resolve)
      try {
        const channel = await this.ctx.teams.getChannel({ channelId: message.channelId })
        const envelope = await this.ctx.teams.postChannelEnvelope({ actor: proof, expectedCursor: channel.cursor,
          idempotencyKey: scope.idempotencyKey, draft: scope.draft })
        return { status: 'applied', receipt: { runId: message.runId, teamId: envelope.teamId,
          recipientId: message.recipient.participantId, sequence: envelope.sequence,
          operationId: message.operationId, fingerprint: message.fingerprint,
          channelId: envelope.channelId, envelopeId: envelope.id } }
      } catch (error: unknown) {
        const bytes = envelopeByteLimitDetails(error)
        if (bytes !== undefined && bytes.teamId === teamId && bytes.channelId === message.channelId
          && bytes.senderId === message.sender.participantId && bytes.idempotencyKey === scope.idempotencyKey
          && bytes.draftFingerprint === fingerprintTeamEnvelopeDraft(scope.draft)) {
          return { status: 'rejected', code: 'SIM_ENVELOPE_BYTE_LIMIT' }
        }
        if (error instanceof TeamError && (error.code === 'TEAM_POLICY_DENIED' || error.code === 'TEAM_PARTICIPANT_NOT_FOUND')) {
          return { status: 'blocked-authority', code: error.code }
        }
        if (error instanceof TeamError && error.code === 'TEAM_CHANNEL_IDEMPOTENCY_CONFLICT') return { status: 'rejected', code: error.code }
        // Missing proof ownership, stale cursors and IO failure do not prove that an earlier target attempt failed.
        throw error
      } finally { this.proofs.delete(proof) }
    } }
  }
}

function scopeFor(run: SimulationRun, teamId: TeamId, lifecycleOwner: string, message: SimulationOutboundMessage,
  accepting: boolean): SimulationOperationEnvelopePostScope | undefined {
  const state = run.snapshot()
  const operation = state.operations[message.operationId]
  const decision = state.decisions[message.decisionId]
  if (operation?.action.kind !== 'communication/post' || operation.decisionId !== message.decisionId
    || operation.status !== 'pending' || operation.result !== undefined
    || operation.outbox?.attempts.at(-1)?.outcome !== 'in-flight'
    || decision?.status !== 'accepted' || decision.closedAt === undefined || !operation.outbox.ready
    || BigInt(state.time) < BigInt(operation.action.deliverAt)
    || state.spec.runId !== message.runId || operation.entityId !== message.entityId
    || operation.fingerprint !== message.fingerprint || operation.action.channelId !== message.channelId
    || operation.action.text !== message.text
    || operation.dependencies.some(id => state.operations[id]?.result?.status !== 'applied')) return undefined
  const sender = state.entities[operation.entityId]
  const recipient = state.entities[operation.action.recipient]
  if (sender?.binding?.teamId !== teamId || recipient?.binding?.teamId !== teamId
    || !isDeepStrictEqual(sender.binding, message.sender) || !isDeepStrictEqual(recipient.binding, message.recipient)) return undefined
  return { kind: 'simulation-operation', runId: message.runId, decisionId: message.decisionId,
    operationId: message.operationId, acceptedRevision: decision.closedAt, fingerprint: operation.fingerprint,
    lifecycleOwner, teamId, senderId: sender.binding.participantId, recipientId: recipient.binding.participantId,
    publishAllowed: accepting && message.publishAllowed && sender.phase === 'active' && recipient.phase === 'active',
    idempotencyKey: channelPostIdempotencyKeySchema.parse(JSON.stringify(['simulation', message.runId, message.operationId])),
    draft: { channelId: operation.action.channelId, audience: [recipient.binding.participantId], kind: 'message',
      payload: { content: [{ type: 'text', text: operation.action.text }] }, delivery: 'context', traceId: operation.fingerprint,
      correlationId: JSON.stringify([message.runId, message.decisionId, message.operationId, decision.closedAt]) } }
}
