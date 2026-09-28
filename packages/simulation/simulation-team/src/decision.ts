/** Complete one explicitly selected model decision and verify its durable turn. @module @clocky/clocky-simulation-team/decision */
import type { Agent } from '@clocky/clocky-agent'
import { MessageId } from '@clocky/clocky-llm'
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
 * @returns submitted/accepted decision or timeout cancellation after its identified turn ends and its Session flushes.
 */
export async function executeDecision(run: SimulationRun, connection: SimulationTeamConnection, agent: Agent,
  entityId: SimulationEntityId, id: SimulationDecisionId, context: Omit<SimulationContextRequest, 'maxBytes' | 'teamCursor'>,
  flush: () => Promise<boolean>, check: () => void, wakeId?: SimulationEventId): Promise<SimulationDecision> {
  check()
  const decisions = run.snapshot().decisions
  const existing = Object.hasOwn(decisions, id) ? decisions[id] : undefined
  if (existing === undefined) await connection.openDecision(entityId, id, wakeId)
  else if (existing.entityId !== entityId || existing.wakeId !== wakeId) throw new Error('Simulation decision retry changed its owner or wake')
  if (run.snapshot().decisions[id]?.context === undefined) {
    const prepared = await connection.prepareContext(entityId, id, context)
    if (prepared.status !== 'prepared') throw new Error('Simulation required decision context exceeds its configured budget')
  }
  await connection.dispatchDecision(entityId, id)
  await agent.whenIdle()
  check()
  const decision = run.snapshot().decisions[id]
  if (decision?.context?.status !== 'prepared') throw new Error('Simulation decision lost its prepared input')
  let currentTurn: number | undefined
  let inputTurn: number | undefined
  let ended = false
  for (const event of agent.session.events) {
    if (event.type === 'turn/start') currentTurn = event.data.turn
    if (event.type === 'user/message' && event.surfaceOp === 'append' && event.data.id === MessageId(decision.context.view.inputId)) {
      inputTurn = currentTurn
    }
    if (event.type === 'turn/end' && inputTurn !== undefined && event.data.turn === inputTurn) ended = true
  }
  if (!ended || (decision.status !== 'accepted' && decision.status !== 'submitted'
    && !(decision.status === 'cancelled' && decision.cancellation === 'timeout'))) {
    throw new Error('Simulation model turn ended without submitting its identified decision')
  }
  if (!await flush()) throw new Error('Simulation decision completion requires durable Session storage')
  check()
  return decision
}
