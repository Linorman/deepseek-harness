/** Shared temporal and transitive audience projection for native cognition and authorized product readers. */
import { simulationKnowledgeQuerySchema } from './knowledge.ts'
import type { SimulationKnowledge, SimulationKnowledgeId, SimulationKnowledgeQuery, SimulationKnowledgeRef } from './knowledge.ts'
import type { SimulationSnapshot } from './types.ts'
import type { SimulationEntityId } from './identities.ts'

function versions(state: SimulationSnapshot, id: SimulationKnowledgeId): readonly SimulationKnowledge[] {
  const knowledge = state.knowledge
  return knowledge !== undefined && Object.hasOwn(knowledge, id) ? knowledge[id] as readonly SimulationKnowledge[] : []
}
function audience(value: SimulationKnowledge, viewer: SimulationEntityId): boolean {
  return value.owner === viewer || value.readers.includes(viewer)
}
/**
 * Check an exact version and every derivation premise under current revocation and fixed-cutoff rules.
 * @param state - Current authoritative versions and audiences.
 * @param reference - Exact retained version.
 * @param query - Viewer, as-of cursor and time; the limit does not affect this predicate.
 * @returns whether the version and all its premises may be retrieved.
 */
export function knowledgeVisible(state: SimulationSnapshot, reference: SimulationKnowledgeRef,
  query: SimulationKnowledgeQuery): boolean {
  const seen = new Set<string>()
  const pending = [reference]
  for (let ref = pending.pop(); ref !== undefined; ref = pending.pop()) {
    const key = JSON.stringify([ref.id, ref.revision])
    if (seen.has(key)) continue
    const history = versions(state, ref.id)
    // Journal replay validates contiguous one-based versions; retained ancestry can exceed the call stack.
    const value = history[ref.revision - 1]
    const latest = history.at(-1)
    if (value === undefined || latest === undefined || !audience(value, query.viewer) || !audience(latest, query.viewer)
      || value.sequence > query.cursor || BigInt(value.observedAt) > BigInt(query.time) || BigInt(value.availableAt) > BigInt(query.time)
      || BigInt(value.validFrom) > BigInt(query.time)
      || value.validUntil !== null && BigInt(value.validUntil) <= BigInt(query.time)) return false
    seen.add(key)
    if (value.source.kind === 'inference' || value.source.kind === 'summary') {
      for (const premise of value.source.premises) pending.push(premise)
    }
  }
  return true
}
/**
 * Select the latest temporally available version at a fixed cursor without exposing inaccessible identities.
 * @param state - Current projection retaining version history.
 * @param request - Explicit bounded query.
 * @returns detached authorized results in stable identity order.
 */
export function selectKnowledge(state: SimulationSnapshot, request: SimulationKnowledgeQuery): SimulationKnowledge[] {
  const query = simulationKnowledgeQuerySchema.parse(request)
  if (query.cursor > state.revision || BigInt(query.time) > BigInt(state.time)
    || query.limit > state.spec.maxKnowledgePerQuery || state.entities[query.viewer]?.phase !== 'active') {
    throw new Error('Simulation knowledge query exceeds its current cursor, time, viewer or result bound')
  }
  const ids = query.ids ?? Object.keys(state.knowledge ?? {}) as SimulationKnowledgeId[]
  const selected: SimulationKnowledge[] = []
  for (const id of [...new Set(ids)].sort()) {
    const value = versions(state, id).findLast(value => value.sequence <= query.cursor
      && BigInt(value.observedAt) <= BigInt(query.time) && BigInt(value.availableAt) <= BigInt(query.time)
      && BigInt(value.validFrom) <= BigInt(query.time) && (value.validUntil === null || BigInt(value.validUntil) > BigInt(query.time)))
    if (value === undefined || !knowledgeVisible(state, { id, revision: value.revision }, query)) continue
    selected.push(structuredClone(value))
    if (selected.length === query.limit) break
  }
  return selected
}
