/** Reconstructable, bounded idle selection; the connection still owns every retirement. */
import { z } from 'zod'
import { simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationEntityId, SimulationSnapshot } from '@clocky/clocky-simulation'

/** Explicit deployment policy; durations use the run's simulated tick unit. */
export const simulationResidencyPolicySchema = z.strictObject({
  version: z.literal('1'), idleFor: simTimeSchema,
  maxCandidates: z.number().int().positive(),
})
/** Immutable policy retained by the scenario's driver configuration. */
export type SimulationResidencyPolicy = z.infer<typeof simulationResidencyPolicySchema>

/**
 * Select oldest idle actors from authoritative history without activation or inference.
 * @param state - One current run revision; eligibility is rechecked by the connection before retirement.
 * @param candidates - Caller-authorized eviction set; duplicates reject.
 * @param request - Explicit idle threshold and maximum transitions per residency request.
 * @returns ordered candidates; unfinished tasks, decisions, wakes and undelivered messages retain residency.
 */
export function selectResidencyCandidates(state: SimulationSnapshot, candidates: readonly SimulationEntityId[],
  request: SimulationResidencyPolicy): SimulationEntityId[] {
  const policy = simulationResidencyPolicySchema.parse(request)
  if (new Set(candidates).size !== candidates.length) throw new Error('Simulation eviction candidates must be distinct')
  const now = BigInt(state.time)
  const eligible: { id: SimulationEntityId; last: bigint }[] = []
  for (const id of candidates) {
    const entity = state.entities[id]
    if (entity === undefined) throw new Error('Simulation eviction candidate does not exist')
    // Unconfirmed ownership must reach ensureResident's recovery branch, never disappear as an idle-policy skip.
    if (entity.writer !== undefined && entity.writer.phase !== 'released' && entity.writer.phase !== 'active') {
      eligible.push({ id, last: -1n }); continue
    }
    if (entity.writer?.phase !== 'active') continue
    const decisions = Object.values(state.decisions).filter(value => value.entityId === id)
    if (decisions.some(value => value.status === 'open' || value.status === 'submitted')
      || Object.values(state.taskExecutions ?? {}).some(value => value.request.entityId === id
        && value.retired === undefined && value.task?.executor?.outcome === undefined)
      || Object.values(state.wakes).some(value => value.entityId === id && (value.status === 'pending' || value.status === 'claimed'))
      || Object.values(state.operations).some(value => value.action.kind === 'communication/post'
        && value.action.recipient === id && value.status !== 'rejected'
        && value.delivery === undefined && value.deliveryFailure?.resolution === undefined)) continue
    let last = BigInt(state.spec.origin)
    for (const decision of decisions) if (BigInt(decision.time) > last) last = BigInt(decision.time)
    for (const operation of Object.values(state.operations)) {
      if (operation.action.kind === 'communication/post' && operation.action.recipient === id
        && operation.delivery !== undefined && BigInt(operation.delivery.time) > last) last = BigInt(operation.delivery.time)
    }
    if (now - last >= BigInt(policy.idleFor)) eligible.push({ id, last })
  }
  eligible.sort((a, b) => a.last < b.last ? -1 : a.last > b.last ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return eligible.slice(0, policy.maxCandidates).map(value => value.id)
}
