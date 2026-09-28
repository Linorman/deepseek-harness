/** Revisioned knowledge with temporal and transitive audience checks. @module @clocky/clocky-simulation-local/knowledge */
import { z } from 'zod'
import { simulationKnowledgeRequestSchema, simulationKnowledgeQuerySchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationKnowledge, SimulationKnowledgeId, SimulationKnowledgeQuery,
  SimulationKnowledgeRef, SimulationEntityId, SimulationKnowledgeRequest } from '@clocky/clocky-simulation'

const knowledgeRequest: z.ZodType<SimulationKnowledgeRequest> = simulationKnowledgeRequestSchema

/** Knowledge writes retain their full version and provenance in one journal event. */
export const knowledgeRecordSchema = z.strictObject({ kind: z.literal('knowledge/recorded'), request: knowledgeRequest })
/** Parsed knowledge version write. */
export type KnowledgeRecord = z.infer<typeof knowledgeRecordSchema>
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
/**
 * Validate attributed provenance and preserve a complete immutable next version.
 * @param state - Projection before this write.
 * @param record - Parsed owner, audience, temporal fields and provenance.
 * @param sequence - Storage-assigned version cursor.
 * @returns the updated history without changing authoritative world facts.
 */
export function foldKnowledge(state: SimulationSnapshot, record: KnowledgeRecord, sequence: number): SimulationSnapshot {
  const { expectedRevision, ...request } = record.request
  const history = versions(state, request.id)
  const previous = history.at(-1)
  if ((previous?.revision ?? 0) !== expectedRevision || state.entities[request.owner]?.phase !== 'active'
    || previous !== undefined && (previous.owner !== request.owner || previous.source.kind !== request.source.kind)
    || request.readers.some(id => state.entities[id]?.phase !== 'active')
    || BigInt(request.availableAt) < BigInt(request.observedAt)
    || request.validUntil !== null && BigInt(request.validUntil) <= BigInt(request.validFrom)
    || [request.observedAt, request.availableAt, request.validFrom, request.validUntil]
      .some(time => time !== null && BigInt(time) > BigInt(state.spec.maxTime))) {
    throw new Error('Simulation knowledge owner, version, audience or time is invalid')
  }
  const value: SimulationKnowledge = { ...request, revision: expectedRevision + 1, sequence }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > state.spec.maxKnowledgeBytes) throw new Error('Simulation knowledge byte budget exceeded')
  const source = request.source
  switch (source.kind) {
    case 'observation':
      if (source.worldRevision > state.revision || source.visibilityPolicy !== state.spec.policyVersion) {
        throw new Error('Simulation observation has no known world cursor and visibility policy')
      }
      break
    case 'report': {
      const delivery = Object.hasOwn(state.operations, source.operationId) ? state.operations[source.operationId] : undefined
      if (delivery?.action.kind !== 'communication/post' || delivery.action.recipient !== request.owner
        || delivery.delivery?.receipt === undefined || request.statement !== delivery.action.text
        || BigInt(request.observedAt) < BigInt(delivery.delivery.time)) {
        throw new Error('Simulation report requires its owner-specific durable delivery receipt')
      }
      break
    }
    case 'belief':
      if (source.profileRevision !== state.entities[request.owner]?.profileRevision || source.policyVersion !== state.spec.policyVersion) {
        throw new Error('Simulation belief configuration does not match its owner')
      }
      break
    case 'inference': case 'summary': {
      const decision = source.kind === 'inference' ? state.decisions[source.decisionId] : undefined
      let cursor: number
      if (source.kind === 'inference') {
        if (decision?.entityId !== request.owner || decision.status !== 'accepted' || request.observedAt !== decision.time
          || decision.context?.status !== 'prepared' || !source.premises.every(ref =>
          decision.context?.status === 'prepared' && decision.context.knowledge?.some(selected => selected.id === ref.id && selected.revision === ref.revision))
          || new Set(source.premises.map(ref => JSON.stringify(ref))).size !== source.premises.length) {
          throw new Error('Simulation inference requires its accepted owner decision and selected distinct premises')
        }
        cursor = decision.snapshotRevision
      } else {
        if (source.cursor > state.revision || BigInt(request.observedAt) > BigInt(state.time)
          || source.premises.length > state.spec.maxKnowledgePerQuery
          || new Set(source.premises.map(ref => JSON.stringify(ref))).size !== source.premises.length) {
          throw new Error('Simulation summary requires a bounded fixed-cursor source selection')
        }
        cursor = source.cursor
      }
      for (const viewer of [request.owner, ...request.readers]) {
        if (!source.premises.every(ref => knowledgeVisible(state, ref, {
          viewer, cursor, time: request.observedAt, limit: state.spec.maxKnowledgePerQuery,
        }))) throw new Error('Simulation inference audience cannot access every premise at its decision snapshot')
      }
      break
    }
    /* v8 ignore next 2 -- the parsed knowledge-source union is exhausted above. */
    default: return assertNever(source)
  }
  return { ...state, knowledge: { ...state.knowledge, [value.id]: [...history, value] } }
}
/* v8 ignore next 2 -- only the statically unreachable closed-union arm calls this helper. */
function assertNever(value: never): never { throw new Error(`Unknown knowledge source: ${String(value)}`) }
/**
 * Check retained version identity and inference provenance without reapplying current permissions to history.
 * @param state - Complete durable projection.
 */
export function assertKnowledgeProjection(state: SimulationSnapshot): void {
  for (const [id, history] of Object.entries(state.knowledge ?? {})) {
    let sequence = -1
    const first = history[0]
    if (first === undefined) throw new Error('Simulation knowledge history is empty')
    for (const [index, value] of history.entries()) {
      if (value.id !== id || value.revision !== index + 1 || value.sequence <= sequence || value.sequence > state.revision
        || value.owner !== first.owner || value.source.kind !== first.source.kind) throw new Error('Simulation knowledge history is inconsistent')
      sequence = value.sequence
      if (value.source.kind === 'inference' || value.source.kind === 'summary') for (const ref of value.source.premises) {
        const premise = versions(state, ref.id)[ref.revision - 1]
        if (premise === undefined || premise.sequence >= value.sequence) throw new Error('Simulation inference lost its prior premise version')
      }
    }
  }
}
