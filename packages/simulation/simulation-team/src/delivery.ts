import { assertAcceptedSimulationEnvelope } from './accepted-envelope.ts'
/** Durable recipient admission before receipt. @module @clocky/clocky-simulation-team/delivery */
import { isDeepStrictEqual } from 'node:util'
import type { Agent } from '@clocky/clocky-agent'
import type { UserMessage } from '@clocky/clocky-llm'
import type { Context } from '@clocky/cordis'
import { renderDirectV4EnvelopeInput } from '@clocky/clocky-team-agent-client'
import type { ActivationBindingSnapshot, TeamDeliveryOwnerProof, TeamDeliveryOwnerScope, TeamId } from '@clocky/clocky-team'
import type { SimulationEventId, SimulationOperation, SimulationOperationId, SimulationRun, SimulationSnapshot } from '@clocky/clocky-simulation'
import { inputState } from './input.ts'

/** One owner registration; capabilities exist only during their exact claim or receipt call. */
export class SimulationDeliveryAuthority {
  private readonly proofs = new WeakMap<TeamDeliveryOwnerProof, () => TeamDeliveryOwnerScope | undefined>()

  constructor(private readonly ctx: Context, private readonly pageSize: number) {
    ctx.teams.registerDeliveryOwnerProofSource({ name: 'simulation-team', resolveDeliveryOwnerProof: proof => this.proofs.get(proof)?.() })
  }

  /**
   * Observe definitive recipient abandonment without inferring failure from exceptions or channel phase.
   * @param run - Exclusive journal owner.
   * @param id - Applied publication.
   * @param teamId - Canonical execution Team.
   * @param admitted - Current connection admission.
   * @returns whether a durable failure has halted the run.
   */
  async observeFailure(run: SimulationRun, id: SimulationOperationId, teamId: TeamId, admitted: () => boolean): Promise<boolean> {
    const { operation, recipient, envelope } = published(run.snapshot(), id, teamId)
    if (operation.deliveryFailure !== undefined) return true
    if (operation.delivery?.receipt !== undefined) return false
    let afterCursor = -1
    for (;;) {
      if (!admitted()) throw new Error('Simulation delivery observation is closed')
      const page = await this.ctx.teams.readChannelPage({ channelId: envelope.channelId, afterCursor, limit: this.pageSize })
      if (page.channel.manifest.teamId !== teamId) throw new Error('Simulation target channel belongs to another Team')
      const failed = page.records.find(record => record.type === 'channel/delivery-expired'
        && record.envelopeId === envelope.envelopeId && record.participantId === recipient.binding.participantId)
      if (failed?.type === 'channel/delivery-expired') {
        if (!admitted()) throw new Error('Simulation delivery observation retired before persistence')
        await run.recordDeliveryFailure(id, failed, run.snapshot().revision)
        return true
      }
      if (page.nextCursor === undefined) return false
      if (page.nextCursor <= afterCursor) throw new Error('Simulation delivery evidence scan did not advance')
      afterCursor = page.nextCursor
    }
  }

  /**
   * Reconcile failed transport against retained run responsibility or the canonical recipient Session.
   * @param run - Exclusive journal owner.
   * @param id - Publication whose failure is already durable.
   * @param teamId - Canonical execution Team.
   * @param admitted - Current connection admission.
   * @returns the retained input disposition; the caller must explicitly resume the run.
   */
  async reconcileFailure(run: SimulationRun, id: SimulationOperationId, teamId: TeamId,
    admitted: () => boolean): Promise<'retained-input' | 'absent-input' | 'entity-terminated'> {
    const { operation, recipient, sender, envelope } = published(run.snapshot(), id, teamId)
    if (operation.deliveryFailure === undefined) throw new Error('Simulation delivery has no durable target failure')
    const saved = operation.deliveryFailure.resolution
    if (saved !== undefined) return saved.kind
    if (!admitted()) throw new Error('Simulation delivery reconciliation is closed')
    if (operation.delivery !== undefined || recipient.phase === 'terminated') {
      const kind = operation.delivery !== undefined ? 'retained-input' as const : 'entity-terminated' as const
      await run.resolveDeliveryFailure(id, { kind }, run.snapshot().revision)
      return kind
    }
    const actor = this.ctx.agents.get(recipient.binding.sessionId)
    if (actor === undefined || recipient.writer?.phase !== 'active') throw new Error('Simulation failure reconciliation requires its resident recipient')
    const epoch = recipient.writer.epoch
    const valid = () => admitted() && this.ctx.agents.get(actor.id) === actor
      && run.snapshot().entities[recipient.id]?.writer?.epoch === epoch && run.snapshot().entities[recipient.id]?.writer?.phase === 'active'
    const expected = renderDirectV4EnvelopeInput({ id: envelope.envelopeId, teamId, channelId: envelope.channelId,
      senderId: sender.binding.participantId, delivery: 'context', payload: { content: [{ type: 'text', text: operation.action.text }] } })
    return await actor.runMaintenance(async (signal) => {
      if (!valid()) throw new Error('Simulation failure reconciliation lost its writer')
      inputState(actor, expected)
      const retained = actor.session.events.some(event => event.type === 'user/message' && event.surfaceOp === 'append' && event.data.id === expected.id
        || event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.id === expected.id))
      if (retained) restoreInput(actor, expected, run, id, true)
      if (!await this.ctx.sessions.flush(actor.session)) throw new Error('Simulation failure reconciliation requires durable Session storage')
      signal.throwIfAborted()
      if (!valid()) throw new Error('Simulation failure reconciliation retired during flush')
      if (retained) await run.recordDelivery(id, epoch, run.snapshot().revision)
      const resolution = retained ? { kind: 'retained-input' as const } : { kind: 'absent-input' as const, epoch }
      await run.resolveDeliveryFailure(id, resolution, run.snapshot().revision)
      return resolution.kind
    })
  }

  /**
   * Persist one published operation's recipient input and wake before acknowledging the target.
   * @param run - Exclusive run owner.
   * @param id - Published communication operation.
   * @param teamId - Canonical execution Team.
   * @param owner - Immutable lifecycle owner name.
   * @param admitted - Whether the connection is still accepting work.
   * @returns the retained recipient wake identity.
   */
  async receive(run: SimulationRun, id: SimulationOperationId, teamId: TeamId, owner: string,
    admitted: () => boolean): Promise<SimulationEventId> {
    if (await this.observeFailure(run, id, teamId, admitted)) throw new Error('Simulation delivery failed; recipient responsibility needs reconciliation')
    const { operation, recipientId, recipient, sender, envelope } = published(run.snapshot(), id, teamId)
    const actor = this.ctx.agents.get(recipient.binding.sessionId)
    const expected = renderDirectV4EnvelopeInput({ id: envelope.envelopeId, teamId, channelId: envelope.channelId,
      senderId: sender.binding.participantId, delivery: 'context', payload: { content: [{ type: 'text', text: operation.action.text }] } })
    if (operation.delivery?.receipt !== undefined) {
      if (actor !== undefined && actor.status === 'idle' && recipient.writer?.phase === 'active'
        && inputState(actor, expected) === 'absent') await this.restorePending(run, recipientId, teamId, admitted)
      return operation.delivery.wakeId
    }
    if (actor === undefined || recipient.writer?.phase !== 'active') throw new Error('Simulation recipient is not resident')
    const epoch = recipient.writer.epoch
    const state = await this.ctx.teams.getTeam({ teamId })
    const binding = state.activations.find(value => value.activation.id === recipient.writer?.activationId)
    if (binding === undefined) throw new Error('Simulation recipient has no current activation')
    const valid = () => {
      const latest = run.snapshot().entities[recipientId]
      return admitted() && this.ctx.agents.get(actor.id) === actor && latest?.phase === 'active'
        && latest.writer?.phase === 'active' && latest.writer.epoch === epoch && latest.writer.activationId === binding.activation.id
        && latest.binding?.teamId === teamId && latest.binding.sessionId === actor.id
    }
    return await actor.runMaintenance(async (signal) => {
      if (!valid()) throw new Error('Simulation delivery authority is no longer current')
      const lease = this.ctx.teams.openActivationActorProofIssuer().issue(binding)
      try {
        const claim = operation.delivery === undefined ? await this.authorize(binding, owner, run, envelope.channelId, envelope.envelopeId, 'claim', null, valid,
          proof => this.ctx.teams.claimChannelDelivery({ actor: lease.proof, deliveryOwner: proof,
            channelId: envelope.channelId, envelopeId: envelope.envelopeId })) : undefined
        if (claim !== undefined) {
          const found = await this.findEnvelope(envelope.channelId, binding.activation.participantId, envelope.envelopeId)
          assertAcceptedSimulationEnvelope(run.snapshot(), operation, found)
          if (!isDeepStrictEqual(renderDirectV4EnvelopeInput(found), expected)) {
            throw new Error('Simulation target content or position differs from its accepted intent')
          }
          if (!valid()) throw new Error('Simulation delivery authority retired before input admission')
        } else if (operation.delivery === undefined) {
          throw new Error('Simulation target receipt has no durable local input responsibility')
        }
        restoreInput(actor, expected, run, id, claim !== undefined)
        if (!await this.ctx.sessions.flush(actor.session)) throw new Error('Simulation delivery requires durable Session input')
        signal.throwIfAborted()
        if (!valid()) throw new Error('Simulation recipient retired during input flush')
        const delivered = await run.recordDelivery(id, epoch, run.snapshot().revision)
        const wakeId = delivered.operations[id]?.delivery?.wakeId
        if (wakeId === undefined) throw new Error('Simulation delivery has no recorded wake')
        const channel = await this.ctx.teams.getChannel({ channelId: envelope.channelId })
        const receipt = await this.authorize(binding, owner, run, envelope.channelId, envelope.envelopeId, 'receipt', channel.cursor, valid,
          proof => this.ctx.teams.ackChannelEnvelope({ actor: lease.proof, deliveryOwner: proof, channelId: envelope.channelId,
            envelopeId: envelope.envelopeId, expectedCursor: channel.cursor }))
        await run.confirmDelivery(id, receipt, run.snapshot().revision)
        return wakeId
      } finally { lease.revoke() }
    })
  }

  /**
   * Restore pending receipted inputs and retire queued copies handled by accepted deterministic decisions.
   * @param run - Exclusive run owner.
   * @param entityId - Recipient entering another decision or quiescence.
   * @param teamId - Canonical execution Team.
   * @param admitted - Whether the connection remains live.
   */
  async restorePending(run: SimulationRun, entityId: import('@clocky/clocky-simulation').SimulationEntityId,
    teamId: TeamId, admitted: () => boolean): Promise<void> {
    const state = run.snapshot()
    const pending = Object.values(state.operations).filter((operation): operation is SimulationOperation & {
      readonly delivery: NonNullable<SimulationOperation['delivery']>
    } => operation.action.kind === 'communication/post'
      && operation.action.recipient === entityId && operation.delivery !== undefined
      && (!terminalWake(state, operation.id) || deterministicWakeCompleted(state, operation.delivery.wakeId)))
    if (pending.length === 0) return
    const binding = state.entities[entityId]?.binding
    const actor = binding === undefined ? undefined : this.ctx.agents.get(binding.sessionId)
    if (actor === undefined) throw new Error('Simulation input restoration requires its canonical actor')
    await actor.runMaintenance(async (signal) => {
      if (!admitted()) throw new Error('Simulation input restoration is closed')
      for (const item of pending) {
        const { operation, sender, envelope } = published(state, item.id, teamId)
        const input = renderDirectV4EnvelopeInput({ id: envelope.envelopeId, teamId, channelId: envelope.channelId,
          senderId: sender.binding.participantId, delivery: 'context', payload: { content: [{ type: 'text', text: operation.action.text }] } })
        if (deterministicWakeCompleted(state, item.delivery.wakeId)) {
          if (inputState(actor, input) === 'queued') actor.inbox.remove(input.id)
        } else restoreInput(actor, input, run, item.id, false)
      }
      if (!await this.ctx.sessions.flush(actor.session)) throw new Error('Simulation restored input requires durable Session storage')
      signal.throwIfAborted()
      if (!admitted()) throw new Error('Simulation input restoration retired during flush')
    })
  }

  private async findEnvelope(channelId: TeamDeliveryOwnerScope['channelId'], participantId: TeamDeliveryOwnerScope['participantId'],
    envelopeId: TeamDeliveryOwnerScope['envelopeId']) {
    let afterCursor = -1
    for (;;) {
      const page = await this.ctx.teams.listChannelPendingDeliveries({ channelId, participantId, afterCursor, limit: this.pageSize })
      const found = page.deliveries.find(value => value.envelope.id === envelopeId)
      if (found !== undefined) return found.envelope
      if (page.deliveries.length === 0) throw new Error('Simulation claimed Envelope is no longer pending')
      if (page.nextCursor <= afterCursor) throw new Error('Team pending delivery scan did not advance')
      afterCursor = page.nextCursor
    }
  }

  private async authorize<T>(binding: ActivationBindingSnapshot, owner: string, run: SimulationRun,
    channelId: TeamDeliveryOwnerScope['channelId'], envelopeId: TeamDeliveryOwnerScope['envelopeId'],
    operation: 'claim' | 'receipt', cursor: number | null, valid: () => boolean,
    action: (proof: TeamDeliveryOwnerProof) => Promise<T>): Promise<T> {
    const token: object = { toJSON(): never { throw new TypeError('Simulation delivery authority is runtime-only') } }
    const proof = Object.freeze(token) as TeamDeliveryOwnerProof
    this.proofs.set(proof, () => valid() ? { kind: 'simulation-delivery', operation, cursor,
      runId: run.snapshot().spec.runId, lifecycleOwner: owner, teamId: binding.activation.teamId,
      channelId, envelopeId, participantId: binding.activation.participantId,
      activationId: binding.activation.id, sessionId: binding.sessionId } : undefined)
    try { return await action(proof) }
    finally { this.proofs.delete(proof) }
  }
}

function published(state: SimulationSnapshot, id: SimulationOperationId, teamId: TeamId) {
  const operation = state.operations[id]
  if (operation?.action.kind !== 'communication/post' || operation.result?.status !== 'applied' || operation.outbox?.receipt === undefined) {
    throw new Error('Simulation receipt requires a published communication')
  }
  const recipientId = operation.action.recipient
  const recipient = state.entities[recipientId]
  const sender = state.entities[operation.entityId]
  if (recipient?.binding?.teamId !== teamId || sender?.binding?.teamId !== teamId) {
    throw new Error('Simulation delivery has no canonical bindings')
  }
  return { operation: { ...operation, action: operation.action }, recipientId,
    recipient: { ...recipient, binding: recipient.binding }, sender: { ...sender, binding: sender.binding },
    envelope: operation.outbox.receipt }
}
function deterministicWakeCompleted(state: SimulationSnapshot, wakeId: SimulationEventId): boolean {
  const wake = state.wakes[wakeId]
  const decision = wake?.decisionId === undefined ? undefined : state.decisions[wake.decisionId]
  return wake?.status === 'completed' && decision?.status === 'accepted' && decision.deterministic !== undefined
}
function terminalWake(state: SimulationSnapshot, id: SimulationOperationId): boolean {
  const delivery = state.operations[id]?.delivery
  if (delivery === undefined) return false
  const wake = state.wakes[delivery.wakeId]
  return state.scheduledEvents[delivery.wakeId]?.status === 'cancelled' || wake?.status === 'completed' || wake?.status === 'cancelled'
}
function restoreInput(actor: Agent, expected: UserMessage, run: SimulationRun, id: SimulationOperationId, firstAdmission: boolean): void {
  if (inputState(actor, expected) !== 'absent') return
  const recorded = actor.session.events.some(event => event.type === 'agent/inbox/spliced'
    && event.data.inserted.some(message => message.id === expected.id))
  if (!firstAdmission && !recorded) throw new Error('Simulation receipted input is absent from its Session log')
  if (!terminalWake(run.snapshot(), id)) actor.inject(expected)
}
