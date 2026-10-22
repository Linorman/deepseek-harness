/** Structural budgets derive from retained identity and cleanup obligations in simulation time. */
import { isDeepStrictEqual } from 'node:util'
import { activeSimulationMaintenance, budgetInterval, SimulationWorldError } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimTime, WorldIntentId } from '@clocky/clocky-simulation'

/**
 * Collect distinct structural owners, retaining terminal work until its maintenance completes.
 * @param state - Authoritative Native projection, including unsettled financial and topology work.
 * @returns original business identities; multiple obligations for one identity consume one slot.
 */
export function pendingWorldMutations(state: SimulationSnapshot): ReadonlySet<WorldIntentId> {
  const pending = new Set<WorldIntentId>(), world = state.world
  if (world === undefined) return pending
  const owner = activeSimulationMaintenance(state)
  for (const reservation of [...Object.values(world.reservations), ...Object.values(world.external.representatives)]) {
    if (reservation.status !== 'committed' && reservation.status !== 'abandoned'
      || owner !== undefined && isDeepStrictEqual(owner.request, reservation.request.maintenance)) pending.add(reservation.id)
  }
  for (const reservation of Object.values(world.personnel.reservations)) {
    if (reservation.status !== 'committed' && reservation.status !== 'cancelled'
      || owner !== undefined && isDeepStrictEqual(owner.request, reservation.request.maintenance)) pending.add(reservation.id)
  }
  for (const contact of Object.values(world.external.contacts)) {
    if (contact.status === 'reserved' || contact.status === 'cancel-requested'
      || owner !== undefined && isDeepStrictEqual(owner.request, contact.cancellation?.maintenance)) pending.add(contact.id)
  }
  for (const hold of Object.values(state.resourceReservations)) {
    if (hold.phase === 'active' && hold.world !== undefined) pending.add(hold.world.intentId)
  }
  return pending
}

/**
 * Reject a different structural owner before allocating identities or taking financial holds.
 * @param state - Current authoritative projection.
 * @param own - Original owner continuing its existing obligation, if any.
 */
export function assertWorldMutationSlot(state: SimulationSnapshot, own?: WorldIntentId): void {
  const world = state.world
  if (world === undefined) throw new SimulationWorldError('SIM_WORLD_NOT_CONFIGURED', 'Structural admission requires its frozen World')
  const pending = pendingWorldMutations(state), owner = activeSimulationMaintenance(state)
  if ([...pending].filter(id => id !== own).length >= world.definition.limits.maxPendingMutations
    || owner !== undefined && (own === undefined || !pending.has(own)))
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World pending structural mutation allowance is occupied', 'mutations')
}

function charged(state: SimulationSnapshot, time: SimTime, externalOnly: boolean, exclude?: WorldIntentId): number {
  const world = state.world
  if (world === undefined) return 0
  const interval = budgetInterval(state, time)
  const reservations = [...externalOnly ? [] : Object.values(world.reservations), ...Object.values(world.external.representatives)]
  return reservations.filter((value) => {
    if (value.id === exclude) return false
    const result = Object.values(world.results).find(result => result.intentId === value.id)
    return value.status !== 'committed' && value.status !== 'abandoned'
      || [value.reservedAt, value.prepared?.time, 'candidate' in value ? value.candidate?.time : undefined, result?.time].some(at => at !== undefined && budgetInterval(state, at) === interval)
  }).length
}

/**
 * Reserve one birth, and for an external representative one external expansion, in the current interval.
 * Unsettled older reservations carry forward; cancellation never refunds an interval already charged.
 * @param state - Current authoritative projection with all retained reservations.
 * @param external - Whether the new identity also expands the external actor population.
 * @param own - Exclude this same original reservation during preparation or commit.
 */
export function assertWorldBirthBudget(state: SimulationSnapshot, external: boolean, own?: WorldIntentId): void {
  const limits = state.world?.definition.limits
  if (limits === undefined) throw new SimulationWorldError('SIM_WORLD_NOT_CONFIGURED', 'Birth admission requires its frozen World')
  if (charged(state, state.time, false, own) >= limits.maxBirthsPerInterval)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World birth allowance is exhausted for this simulation interval', 'births')
  if (external && charged(state, state.time, true, own) >= limits.maxExternalExpansionsPerInterval)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World external expansion allowance is exhausted for this simulation interval', 'expansions')
}

/**
 * Verify recorded interval charges and current outstanding responsibilities on restore and publication.
 * @param state - Complete Native projection; admission folds also validate every historical prefix.
 */
export function assertWorldStructureBudgetProjection(state: SimulationSnapshot): void {
  const world = state.world
  if (world === undefined) return
  if (pendingWorldMutations(state).size > world.definition.limits.maxPendingMutations)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World retains too many pending structural mutations')
  const births = new Map<SimTime, Set<WorldIntentId>>(), expansions = new Map<SimTime, Set<WorldIntentId>>()
  for (const reservation of [...Object.values(world.reservations), ...Object.values(world.external.representatives)]) {
    const result = Object.values(world.results).find(value => value.intentId === reservation.id)
    const times = [reservation.reservedAt, reservation.prepared?.time,
      'candidate' in reservation ? reservation.candidate?.time : undefined, result?.time,
      reservation.status !== 'committed' && reservation.status !== 'abandoned' ? state.time : undefined]
    for (const time of times) {
      if (time === undefined) continue
      const interval = budgetInterval(state, time)
      for (const map of [births, ...Object.hasOwn(world.external.representatives, reservation.id) ? [expansions] : []]) {
        const ids = map.get(interval) ?? new Set<WorldIntentId>()
        ids.add(reservation.id)
        map.set(interval, ids)
      }
    }
  }
  if ([...births.values()].some(ids => ids.size > world.definition.limits.maxBirthsPerInterval)
    || [...expansions.values()].some(ids => ids.size > world.definition.limits.maxExternalExpansionsPerInterval))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World retained identity charges exceed their frozen interval allowance')
}
