import { SimulationContextIntegrityError } from './integrity.ts'
/** Canonical Session attestation for Native world authority; no model-supplied evidence is accepted. */
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@clocky/cordis'
import type { Agent } from '@clocky/clocky-agent'
import type { SimulationContextViewEventData, SessionEvent, SessionId } from '@clocky/clocky-session'
import { simulationContextConsumptionHash } from '@clocky/clocky-simulation'
import type { SimulationContextConsumption, SimulationDecision } from '@clocky/clocky-simulation'
import { renderDirectV4EnvelopeInput } from '@clocky/clocky-team-agent-client'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import { decisionInput, inputState } from './input.ts'

/**
 * Reconstruct the exact consumption receipt from retained Session events.
 * @param decision - Native decision with its complete prepared context.
 * @param sessionId - Canonical Session being inspected.
 * @param events - Full durable or live Session history, including entered inputs.
 * @param state - Required for World notifications; supplies the original accepted operation and receipt.
 * @param validatedPriorViews - Prior presentation positions separately validated by the Native owner after report rebasing.
 * @returns verified event positions; absent, duplicate, changed or out-of-order evidence rejects.
 */
export function contextConsumption(decision: SimulationDecision, sessionId: SessionId,
  events: readonly SessionEvent[], state?: SimulationSnapshot,
  validatedPriorViews: ReadonlySet<number> = new Set()): SimulationContextConsumption {
  if (decision.context?.status !== 'prepared') throw new SimulationContextIntegrityError('Simulation consumption requires a prepared context')
  const view = decision.context.view, input = decisionInput(view)
  const views = events.filter(event => event.type === 'simulation/context-view' && event.data.inputId === view.inputId)
  const consumed = events.filter(event => event.type === 'user/message' && event.surfaceOp === 'append' && event.data.id === input.id)
  const entered = consumed[0]
  const projected = views.findLast(event => entered !== undefined && event.seq < entered.seq
    && (isDeepStrictEqual(event.data, view) || validatedPriorViews.has(event.seq)))
  const latest = views.at(-1)
  // A replayed presentation is not a second consumption. Only a completed, recorded summary may shadow its predecessor.
  let previous = projected
  for (const restored of views.filter(event => projected !== undefined && event.seq > projected.seq)) {
    const prior = previous
    const summary = events.find(event => event.type === 'compaction/summary' && prior !== undefined
      && event.seq > prior.seq && event.seq < restored.seq && event.data.shadowedSeqs.includes(prior.seq)
      && events.some(start => start.type === 'compaction/start' && start.data.compactionId === event.data.compactionId
        && start.seq > prior.seq && start.seq < event.seq)
      && events.some(replacement => replacement.type === 'user/message' && replacement.seq > event.seq
        && replacement.seq < restored.seq && typeof replacement.surfaceOp === 'object'
        && replacement.sourceEventSeqs?.includes(event.seq) === true && replacement.sourceEventSeqs.includes(prior.seq))
      && events.some(end => end.type === 'compaction/end' && end.data.compactionId === event.data.compactionId
        && end.seq > event.seq && end.seq < restored.seq))
    if ((!isDeepStrictEqual(restored.data, view) && !validatedPriorViews.has(restored.seq)) || summary === undefined)
      throw new SimulationContextIntegrityError('Simulation context restoration has no completed compaction provenance')
    previous = restored
  }
  if (latest === undefined || !isDeepStrictEqual(latest.data, view) || projected?.type !== 'simulation/context-view' || (!isDeepStrictEqual(projected.data, view) && !validatedPriorViews.has(projected.seq))
    || consumed.length !== 1 || entered === undefined || !isDeepStrictEqual(entered.data, input) || entered.seq <= projected.seq) {
    throw new SimulationContextIntegrityError('Simulation context has no exact single consumed Session input')
  }
  let notification: SimulationContextConsumption['notification']
  const world = decision.context.world
  if (world?.kind === 'resolve' || world?.kind === 'evidence') {
    const operation = state?.operations[world.notificationOperationId]
    const receipt = operation?.outbox?.receipt
    const sender = operation === undefined ? undefined : state?.entities[operation.entityId]?.binding
    if (operation?.action.kind !== 'communication/post' || operation.action.recipient !== decision.entityId || operation.delivery?.receipt === undefined || receipt === undefined
      || sender === undefined || operation.delivery.sessionId !== sessionId) throw new SimulationContextIntegrityError('World notification has no persisted canonical delivery')
    const expected = renderDirectV4EnvelopeInput({ id: receipt.envelopeId, teamId: receipt.teamId, channelId: receipt.channelId,
      senderId: sender.participantId, delivery: 'context', payload: { content: [{ type: 'text', text: operation.action.text }] } })
    const messages = events.filter(event => event.type === 'user/message' && event.surfaceOp === 'append' && event.data.id === expected.id)
    const message = messages[0]
    if (messages.length !== 1 || message === undefined || !isDeepStrictEqual(message.data, expected)) throw new SimulationContextIntegrityError('World actor has not consumed the exact original notification')
    notification = { operationId: operation.id, consumedSequence: message.seq }
  }
  return { ...notification === undefined ? {} : { notification }, sessionId, inputId: view.inputId,
    viewSequence: projected.seq, consumedSequence: entered.seq,
    contextHash: simulationContextConsumptionHash(view) }
}
/**
 * Flush actual actor consumption before producing a Native receipt, without holding the run write queue.
 * @param ctx - Canonical Session persistence owner.
 * @param agent - Actual controller-bound local Agent.
 * @param decision - Exact current Native decision requested by its writer.
 * @param assertCurrent - Recheck lifecycle ownership before and after persistence.
 * @param state - Read the current Native projection for exact notification evidence.
 * @param validatePresentation - Native validator for retained earlier report presentations; absent permits only exact current views.
 * @returns proof derived from the flushed events; no receipt is returned on ambiguous persistence.
 */
export async function flushContextConsumption(ctx: Context, agent: Agent, decision: SimulationDecision,
  assertCurrent: () => void, state: () => SimulationSnapshot,
  validatePresentation?: (view: SimulationContextViewEventData) => Promise<void>): Promise<SimulationContextConsumption> {
  assertCurrent()
  if (decision.context?.status !== 'prepared' || inputState(agent, decisionInput(decision.context.view)) !== 'consumed') {
    throw new SimulationContextIntegrityError('Simulation world authority requires consumed input')
  }
  const validated = new Set<number>()
  if (validatePresentation !== undefined) {
    for (const event of agent.session.events) {
      if (event.type !== 'simulation/context-view' || event.data.inputId !== decision.context.view.inputId
        || isDeepStrictEqual(event.data, decision.context.view)) continue
      try { await validatePresentation(event.data) }
      catch (cause: unknown) { throw new SimulationContextIntegrityError('Unrecognized prior context presentation', { cause }) }
      validated.add(event.seq)
    }
  }
  const receipt = contextConsumption(decision, agent.session.id, agent.session.events, state(), validated)
  let durable: boolean
  try { durable = await ctx.sessions.flush(agent.session) }
  catch (cause: unknown) { throw new SimulationContextIntegrityError('Simulation context persistence failed', { cause }) }
  if (!durable) throw new SimulationContextIntegrityError('Simulation world authority requires durable consumed input')
  assertCurrent()
  if (!isDeepStrictEqual(receipt, contextConsumption(decision, agent.session.id, agent.session.events, state(), validated))) {
    throw new SimulationContextIntegrityError('Simulation consumption changed during Session persistence')
  }
  return receipt
}
