/** Complete one explicitly selected model decision and verify its durable turn. @module @clocky/clocky-simulation-team/decision */
import type { Agent } from '@clocky/clocky-agent'
import { LlmError, MessageId } from '@clocky/clocky-llm'
import type { SimulationContextRequest, SimulationDecision, SimulationDecisionId, SimulationEntityId, SimulationEventId, SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from './types.ts'

/**
 * Prepare, dispatch and settle the exact decision input through a real Agent turn.
 * @param run - Exclusive run owner.
 * @param connection - Its canonical cognition connection.
 * @param agent - Current local actor for the entity.
 * @param entityId - Bound cognitive entity.
 * @param id - Stable decision identity.
 * @param context - Authorized material for first preparation; retries reuse the recorded selection.
 * @param flush - Owning Session persistence barrier.
 * @param check - Live connection and actor validation.
 * @param wakeId - Optional durable wake responsibility.
 * @param settlePause - Canonical writer confirmation of a typed dispatch refusal; unrelated or no-longer-eligible failures return false.
 * @returns Submitted/accepted decision or durable admission/timeout cancellation after its Agent settles and Session flushes.
 */
export async function executeDecision(run: SimulationRun, connection: SimulationTeamConnection, agent: Agent,
  entityId: SimulationEntityId, id: SimulationDecisionId, context: Omit<SimulationContextRequest, 'maxBytes' | 'teamCursor'>,
  flush: () => Promise<boolean>, check: () => void, wakeId?: SimulationEventId,
  settlePause?: (error: unknown) => Promise<boolean>): Promise<SimulationDecision> {
  check()
  const decisions = run.snapshot().decisions
  const existing = Object.hasOwn(decisions, id) ? decisions[id] : undefined
  const initialStall = run.snapshot().stall
  if (existing === undefined) await connection.openDecision(entityId, id, wakeId)
  else if (existing.entityId !== entityId || existing.wakeId !== wakeId) throw new Error('Simulation decision retry changed its owner or wake')
  if (existing?.status === 'cancelled' && (existing.cancellation === 'paused' || existing.cancellation === 'timeout'
    || initialStall?.code === 'SIM_CONTEXT_INTEGRITY' && initialStall.decisionId === id)) {
    if (!await flush()) throw new Error('Simulation decision completion requires durable Session storage')
    check()
    return existing
  }
  if (run.snapshot().decisions[id]?.context === undefined) {
    const prepared = await connection.prepareContext(entityId, id, context)
    if (prepared.status !== 'prepared') throw new Error('Simulation required decision context exceeds its configured budget')
  }
  try { await connection.dispatchDecision(entityId, id) }
  catch (error) {
    const cancelled = run.snapshot().decisions[id]
    const stall = run.snapshot().stall
    const terminal = cancelled?.status === 'cancelled' && (cancelled.cancellation === 'timeout'
      || stall?.code === 'SIM_CONTEXT_INTEGRITY' && stall.decisionId === id)
    if (!terminal && (settlePause === undefined || !await settlePause(error))) throw error
  }
  await agent.whenIdle()
  check()
  const decision = run.snapshot().decisions[id]
  if (decision?.context?.status !== 'prepared') throw new Error('Simulation decision lost its prepared input')
  let currentTurn: number | undefined
  let inputTurn: number | undefined
  let ended = false
  let turnFailure: import('@clocky/clocky-llm').LlmFailure | undefined
  for (const event of agent.session.events) {
    if (event.type === 'turn/start') currentTurn = event.data.turn
    if (event.type === 'user/message' && event.surfaceOp === 'append' && event.data.id === MessageId(decision.context.view.inputId)) {
      inputTurn = currentTurn
    }
    if (event.type === 'turn/end' && inputTurn !== undefined && event.data.turn === inputTurn) {
      ended = true
      if (event.data.reason.kind === 'error') turnFailure = event.data.reason.error
    }
  }
  const finalStall = run.snapshot().stall
  const contextFailed = finalStall?.code === 'SIM_CONTEXT_INTEGRITY' && finalStall.decisionId === id
  const paused = decision.status === 'cancelled' && decision.cancellation === 'paused'
  if ((!ended && !paused) || (decision.status !== 'accepted' && decision.status !== 'submitted'
    && !(decision.status === 'cancelled' && (decision.cancellation === 'timeout' || contextFailed || decision.modelAdmissionBlock !== undefined
      || decision.worldSubmissionBlock !== undefined || decision.requestBudgetBlock !== undefined
      || Object.values(run.snapshot().tokenReservations ?? {}).some(value => value.overrunAcknowledged === false
        && (value.decisionId === id || value.compactionId !== undefined
          && value.entityId === decision.entityId && value.epoch === decision.epoch))
      || paused
      || run.snapshot().compactionAdmissionBlocks?.some(value => value.decisionId === id))))) {
    // Read only the terminal event of this exact consumed input; historical failed turns cannot poison later decisions.
    if (turnFailure !== undefined) {
      if (!await flush()) throw new Error('Simulation decision failure requires durable Session storage')
      check()
      throw new LlmError(turnFailure.message, turnFailure.code, turnFailure)
    }
    throw new Error('Simulation model turn ended without submitting its identified decision')
  }
  if (!await flush()) throw new Error('Simulation decision completion requires durable Session storage')
  check()
  return decision
}
