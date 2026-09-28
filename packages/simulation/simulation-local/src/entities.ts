/** Entity lifecycle and temporally constrained organization folds. @module @clocky/clocky-simulation-local/entities */
import { parseSimTime } from '@clocky/clocky-simulation'
import type {
  SimTime, SimulationChange, SimulationEntity, SimulationEntityId, SimulationRelation, SimulationSnapshot,
} from '@clocky/clocky-simulation'

/**
 * Apply a parsed command to an immutable projection; caller publishes only after durable append.
 * @param state - Projection at the preceding journal entry.
 * @param command - Validated administrative entity/organization mutation.
 * @param update - Optional batch-owned entity publication; must preserve the caller-owned input projection.
 * @returns the updated projection without advancing its journal revision.
 */
export function foldEntityChange(state: SimulationSnapshot, command: SimulationChange,
  update: (state: SimulationSnapshot, entity: SimulationEntity) => SimulationSnapshot = (previous, entity) =>
    ({ ...previous, entities: { ...previous.entities, [entity.id]: entity } })): SimulationSnapshot {
  switch (command.kind) {
    case 'entity/create': {
      if (Object.hasOwn(state.entities, command.id)) throw new Error('Simulation entity already exists')
      if (Object.values(state.entities).filter(entity => entity.phase !== 'terminated').length >= state.spec.maxEntities) {
        throw new Error('Simulation entity capacity exceeded')
      }
      const entity: SimulationEntity = {
        id: command.id, kind: command.entityKind, cognition: command.cognition,
        revision: 1, profileRevision: 1, phase: 'active', profile: command.profile,
      }
      return update(state, entity)
    }
    case 'entity/profile':
    case 'entity/phase': {
      const entity = requireEntity(state, command.id)
      if (entity.revision !== command.entityRevision) throw new Error('Simulation entity revision conflict')
      if (entity.phase === 'terminated') throw new Error('Terminated simulation entities cannot change')
      if (command.kind === 'entity/phase' && entity.writer !== undefined && entity.writer.phase !== 'released') {
        throw new Error('Simulation entity lifecycle requires a proven-stopped writer')
      }
      const next: SimulationEntity = command.kind === 'entity/profile'
        ? { ...entity, revision: entity.revision + 1, profileRevision: entity.profileRevision + 1, profile: command.profile }
        : { ...entity, revision: entity.revision + 1, phase: command.phase }
      return update(state, next)
    }
    case 'relation/create':
    case 'relation/update': {
      const previous = Object.hasOwn(state.relations, command.id) ? state.relations[command.id] : undefined
      if (command.kind === 'relation/create' && previous !== undefined) throw new Error('Simulation relation already exists')
      if (command.kind === 'relation/update' && previous?.revision !== command.relationRevision) {
        throw new Error('Simulation relation revision conflict')
      }
      const subject = requireEntity(state, command.subject)
      const object = requireEntity(state, command.object)
      const rule = state.spec.relationRules.find(value => value.relation === command.relation)
      if (rule === undefined) throw new Error('Simulation relation has no configured rule')
      if (!rule.subjectKinds.includes(subject.kind) || !rule.objectKinds.includes(object.kind)) {
        throw new Error('Simulation relation endpoint kinds are not permitted')
      }
      if (command.scope !== undefined) {
        const scope = requireEntity(state, command.scope)
        if (rule.scopeKinds === undefined || !rule.scopeKinds.includes(scope.kind)) {
          throw new Error('Simulation relation scope kind is not permitted')
        }
      }
      parseSimTime(command.validFrom, state.spec.maxTime)
      if (command.validUntil !== null) {
        parseSimTime(command.validUntil, state.spec.maxTime)
        if (BigInt(command.validUntil) <= BigInt(command.validFrom)) throw new Error('Simulation relation interval is empty or reversed')
      }
      const relation: SimulationRelation = {
        id: command.id, subject: command.subject, relation: command.relation, object: command.object,
        ...command.scope === undefined ? {} : { scope: command.scope },
        validFrom: command.validFrom, validUntil: command.validUntil, revision: (previous?.revision ?? 0) + 1,
      }
      if (rule.acyclic) assertNoTemporalCycle(state, relation)
      return { ...state, relations: { ...state.relations, [relation.id]: relation } }
    }
    /* v8 ignore next 2 -- the strict command schema and closed union exclude other variants. */
    default:
      return assertNever(command)
  }
}

function requireEntity(state: SimulationSnapshot, id: SimulationEntityId): SimulationEntity {
  const entity = Object.hasOwn(state.entities, id) ? state.entities[id] : undefined
  if (entity === undefined) throw new Error(`Simulation entity '${id}' does not exist`)
  return entity
}

/** An interval carried through a path; only simultaneous relationships form a cycle. */
interface Interval {
  readonly from: bigint
  readonly until: bigint | null
}
function interval(relation: SimulationRelation): Interval {
  return { from: BigInt(relation.validFrom), until: relation.validUntil === null ? null : BigInt(relation.validUntil) }
}
function intersection(left: Interval, right: Interval): Interval | undefined {
  const from = left.from > right.from ? left.from : right.from
  const until = left.until === null ? right.until
    : right.until === null || left.until < right.until ? left.until : right.until
  return until !== null && from >= until ? undefined : { from, until }
}
function contains(outer: Interval, inner: Interval): boolean {
  return outer.from <= inner.from && (outer.until === null || inner.until !== null && outer.until >= inner.until)
}
function assertNoTemporalCycle(state: SimulationSnapshot, candidate: SimulationRelation): void {
  const edges = Object.values(state.relations).filter(edge => edge.id !== candidate.id && edge.relation === candidate.relation
    && edge.scope === candidate.scope)
  const pending = [{ id: candidate.object, interval: interval(candidate) }]
  const visited = new Map<SimulationEntityId, Interval[]>()
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const node = pending[cursor] as typeof pending[number]
    if (node.id === candidate.subject) throw new Error('Simulation relation would create a simultaneous cycle')
    const intervals = visited.get(node.id) ?? []
    if (intervals.some(covered => contains(covered, node.interval))) continue
    intervals.push(node.interval)
    visited.set(node.id, intervals)
    for (const edge of edges) {
      if (edge.subject !== node.id) continue
      const overlap = intersection(node.interval, interval(edge))
      if (overlap !== undefined) pending.push({ id: edge.object, interval: overlap })
    }
  }
}

/**
 * Select facts at a numeric time; large decimal values never use lexicographic ordering.
 * @param state - Current administrative organization projection.
 * @param time - Canonical bounded simulation time.
 * @param scope - Exact organization identity, null for unscoped facts, or omitted for all scopes.
 * @returns detached relations valid on their half-open intervals.
 */
export function selectRelations(
  state: SimulationSnapshot, time: SimTime, scope?: SimulationEntityId | null,
): readonly SimulationRelation[] {
  const at = BigInt(parseSimTime(time, state.spec.maxTime))
  return structuredClone(Object.values(state.relations).filter(relation =>
    (scope === undefined || (relation.scope ?? null) === scope)
    && BigInt(relation.validFrom) <= at && (relation.validUntil === null || at < BigInt(relation.validUntil)))
    .sort((left, right) => left.id < right.id ? -1 : 1))
}
/* v8 ignore next 3 -- only a statically unreachable closed-union arm calls this helper. */
function assertNever(value: never): never {
  throw new Error(`Unknown simulation change: ${String(value)}`)
}
