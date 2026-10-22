import { isDeepStrictEqual } from 'node:util'
/** Native enforcement of a durable Host bridge time limit, including direct scheduler record replay. */
import type { SimulationSnapshot, SimulationFederationTime, SimTime } from '@clocky/clocky-simulation'
/** Require the original bridge owner/generation and monotonic safe time, preserving permanent stops.
 * @param state - Original Native state.
 * @param evidence - Parsed current bridge cut.
 * @returns State with retained original time authority; malformed histories reject.
 */
export function foldFederationTime(state: SimulationSnapshot, evidence: SimulationFederationTime): SimulationSnapshot {
  const prior = state.federationTime
  if (evidence.runId !== state.spec.runId || BigInt(evidence.limit) < BigInt(state.time)
    || BigInt(evidence.limit) > BigInt(state.spec.maxTime) + 1n
    || new Set(evidence.blockedPeers).size !== evidence.blockedPeers.length) throw new Error('Federation Native time evidence scope invalid')
  if (prior === undefined) {
    if (state.phase !== 'paused') throw new Error('Federation Native fence must first bind while paused')
  } else if (prior.ownerId !== evidence.ownerId || prior.generation !== evidence.generation || BigInt(evidence.limit) < BigInt(prior.limit)
    || evidence.sourceSequence < prior.sourceSequence
    || evidence.sourceSequence === prior.sourceSequence && !isDeepStrictEqual(evidence, prior)
    || prior.blockedPeers.some(peer => !evidence.blockedPeers.includes(peer))) throw new Error('Federation Native owner/generation/time changed')
  return { ...state, federationTime: evidence }
}
/** Fail closed at the executor, so callers cannot bypass peer dependencies through direct drive/collect calls.
 * @param state - Native state at this queued operation.
 * @param time - Actual proposed consumption or clock boundary; it must be strictly below the exclusive limit.
 */
export function assertFederationTime(state: SimulationSnapshot, time: SimTime): void {
  const fence = state.federationTime
  if (fence && (fence.blockedPeers.length > 0 || BigInt(time) >= BigInt(fence.limit))) throw new Error('Federation clock blocked: peer boundary unavailable or permanently stopped')
}
