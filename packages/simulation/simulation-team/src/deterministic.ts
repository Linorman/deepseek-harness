/** Deterministic decisions reuse canonical actors and ordinary operation authority. @module @clocky/clocky-simulation-team/deterministic */
import { deepFreeze } from '@clocky/clocky-llm'
import { isDeepStrictEqual } from 'node:util'
import type { Agent } from '@clocky/clocky-agent'
import type { SimulationContextRequest, SimulationDecision, SimulationDecisionId, SimulationDeterministicPolicy,
  SimulationEntityId, SimulationEventId, SimulationPolicyRef, SimulationRun, SimulationWriterLease } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from './types.ts'

/**
 * Compute and retain policy output under the actor's maintenance lock, then submit through its normal writer.
 * @param run - Authoritative run state.
 * @param connection - Canonical decision/context owner.
 * @param agent - Exact local actor whose idle state is required.
 * @param writer - Current epoch-scoped writer.
 * @param entityId - Required entity identity.
 * @param id - Stable decision identity.
 * @param context - Authorized first-preparation material; retries use the retained view.
 * @param policy - Exact immutable policy reference.
 * @param resolve - Current registered implementation; only needed before computation.
 * @param check - Connection and actor admission recheck after asynchronous work.
 * @param flush - Canonical Session checkpoint before returning completion.
 * @param wakeId - Optional consumed wake responsibility.
 * @returns retained submitted/accepted/cancelled decision without starting inference.
 */
export async function executeDeterministic(run: SimulationRun, connection: SimulationTeamConnection, agent: Agent,
  writer: SimulationWriterLease, entityId: SimulationEntityId, id: SimulationDecisionId,
  context: Omit<SimulationContextRequest, 'maxBytes' | 'teamCursor'>, policy: SimulationPolicyRef,
  resolve: () => SimulationDeterministicPolicy, check: () => void, flush: () => Promise<boolean>,
  wakeId?: SimulationEventId): Promise<SimulationDecision> {
  check()
  const decisions = run.snapshot().decisions
  let decision = Object.hasOwn(decisions, id) ? decisions[id] : undefined
  if (decision !== undefined) {
    if (decision.entityId !== entityId || decision.wakeId !== wakeId
      || decision.deterministic !== undefined && !isDeepStrictEqual(decision.deterministic.policy, policy)) {
      throw new Error('Simulation deterministic retry changed its owner, wake or policy')
    }
    if (decision.status !== 'open') {
      if (decision.deterministic === undefined) throw new Error('Simulation completed decision has no deterministic policy')
      if (!await flush()) throw new Error('Simulation deterministic completion requires durable Session storage')
      check()
      return decision
    }
  }
  if (decision?.deterministic?.proposals === undefined) resolve()
  if (decision === undefined) await connection.openDecision(entityId, id, wakeId)
  return await agent.runMaintenance(async (signal) => {
    const current = (): void => { signal.throwIfAborted(); check() }
    current()
    decision = await writer.selectDeterministicPolicy(id, policy)
    if (run.snapshot().decisions[id]?.context === undefined) {
      const prepared = await connection.prepareContext(entityId, id, context)
      if (prepared.status !== 'prepared') throw new Error('Simulation deterministic context exceeds its configured budget')
    }
    current()
    decision = run.snapshot().decisions[id]
    if (decision?.context?.status === 'prepared' && decision.context.referencedReports?.length) {
      throw new Error('Simulation deterministic report context requires policy selection before window preparation')
    }
    if (decision?.deterministic?.proposals === undefined) {
      const implementation = resolve()
      const prepared = await writer.readPreparedContext(id)
      current()
      if (resolve() !== implementation) throw new Error('Simulation deterministic policy retired before computation')
      const proposals = implementation.decide(deepFreeze(prepared.view))
      current()
      if (resolve() !== implementation) throw new Error('Simulation deterministic policy retired during computation')
      decision = await writer.recordDeterministicResult(id, proposals)
    }
    current()
    const proposals = decision.deterministic?.proposals
    if (proposals === undefined) throw new Error('Simulation deterministic decision lost its recorded output')
    const submitted = await writer.submitDecision(id, proposals)
    if (!await flush()) throw new Error('Simulation deterministic completion requires durable Session storage')
    current()
    return submitted
  })
}
