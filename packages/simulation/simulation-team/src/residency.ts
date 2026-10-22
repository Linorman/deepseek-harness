/** Safe residency transitions selected by an explicit caller policy. @module @clocky/clocky-simulation-team/residency */
import type { Agent } from '@clocky/clocky-agent'
import { isAgentRuntimeTerminationUnconfirmed } from '@clocky/clocky-agent-runtime'
import type { SimulationEntityId, SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationActivationRequest, SimulationResidencyResult, SimulationTeamConnection } from './types.ts'
import { selectResidencyCandidates } from './residency-policy.ts'
import type { SimulationResidencyPolicy } from './residency-policy.ts'

/**
 * Reuse or establish residency, hibernating only eligible actors from the supplied order.
 * @param run - Authoritative population and decision state.
 * @param connection - Canonical activation/hibernation owner.
 * @param entityId - Required actor.
 * @param request - Explicit placement and fresh/resume choice.
 * @param candidates - Ordered possible victims; the required actor is never evicted.
 * @param local - Current local actor lookup.
 * @param check - Connection admission check repeated after asynchronous transitions.
 * @param policy - Optional automatic idle selection, rechecked after each asynchronous retirement.
 * @returns resident lease or capacity/recovery requirement; unrelated runtime failures propagate.
 */
export async function ensureResident(run: SimulationRun, connection: SimulationTeamConnection, entityId: SimulationEntityId,
  request: SimulationActivationRequest, candidates: readonly SimulationEntityId[], local: (id: SimulationEntityId) => Agent | undefined,
  check: () => void, policy?: SimulationResidencyPolicy): Promise<SimulationResidencyResult> {
  const ordered = policy === undefined ? [...candidates] : selectResidencyCandidates(run.snapshot(), candidates, policy)
  if (new Set(ordered).size !== ordered.length) throw new Error('Simulation eviction candidates must be distinct')
  const validate = (): void => { check(); request.signal.throwIfAborted() }
  validate()
  let state = run.snapshot()
  const entity = state.entities[entityId]
  if (entity?.phase !== 'active' || entity.binding === undefined) throw new Error('Simulation residency requires an active bound entity')
  if (entity.writer !== undefined && entity.writer.phase !== 'released') {
    if (entity.writer.phase === 'active' && local(entityId) !== undefined) {
      return { status: 'resident', lease: await connection.activate(entityId, request) }
    }
    return { status: 'recovery-required', entityId }
  }
  for (const candidateId of ordered) {
    if (run.population().chargedActors < state.spec.maxResidentActors) break
    validate()
    if (candidateId === entityId) continue
    state = run.snapshot()
    if (policy !== undefined && !selectResidencyCandidates(state, [candidateId], policy).includes(candidateId)) continue
    const candidate = state.entities[candidateId]
    if (candidate === undefined) throw new Error('Simulation eviction candidate does not exist')
    const actor = local(candidateId)
    if (candidate.writer !== undefined && candidate.writer.phase !== 'released'
      && (candidate.writer.phase !== 'active' || actor === undefined)) return { status: 'recovery-required', entityId: candidateId }
    if (candidate.writer?.phase !== 'active' || actor?.status !== 'idle'
      || Object.values(state.taskExecutions ?? {}).some(value => value.request.entityId === candidateId
        && value.retired === undefined && value.task?.executor?.outcome === undefined)
      || Object.values(state.decisions).some(decision => decision.entityId === candidateId
        && (decision.status === 'open' || decision.status === 'submitted'))) continue
    try { await connection.hibernate(candidateId) }
    catch (error: unknown) {
      validate()
      const retained = run.snapshot().entities[candidateId]?.writer
      if (!isAgentRuntimeTerminationUnconfirmed(error) || retained?.epoch !== candidate.writer.epoch || retained.phase !== 'revoked') throw error
      // The exact provider refusal and retained revoked epoch prove that this residency remains charged.
      return { status: 'recovery-required', entityId: candidateId }
    }
    state = run.snapshot()
  }
  validate()
  if (run.population().chargedActors >= state.spec.maxResidentActors) return { status: 'capacity', entityId }
  return { status: 'resident', lease: await connection.activate(entityId, request) }
}
