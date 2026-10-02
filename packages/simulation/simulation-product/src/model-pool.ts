/** Observation of the existing Host-wide model admission owner; no run allocation or derived budget accounting. */
import type { SimulationProductModelPoolObservation } from './control-types.ts'

/**
 * Sample aggregate permits without exposing actor, model request or foreign run identities.
 * @param read - Current provider observation, absent when this observer cannot reach its owner.
 * @returns observed real-time occupancy or explicit unavailability; unavailable never invents zero usage.
 */
export function observeModelPool(read?: () => { readonly active: number
  readonly queued: number
  readonly limit: number
  readonly queueLimit: number }): SimulationProductModelPoolObservation {
  const observedAt = Date.now()
  if (read === undefined) return { status: 'unavailable', clock: 'real', observedAt }
  let usage
  try { usage = read() }
  catch { return { status: 'unavailable', clock: 'real', observedAt } } // The provider observation is unavailable; no count is inferred.
  return { status: 'observed', clock: 'real', observedAt, ...usage }
}
