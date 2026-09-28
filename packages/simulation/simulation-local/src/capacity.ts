/** Backlog capacity derived from durable responsibilities. @module @clocky/clocky-simulation-local/capacity */
import { z } from 'zod'
import { simulationCapacityGrantRequestSchema, simulationCapacityKindSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationCapacityKind, SimulationQueueUsage } from '@clocky/clocky-simulation'

/** Durable additions and refused backlog growth. */
export const capacityRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('capacity/extended'), request: simulationCapacityGrantRequestSchema }),
  z.strictObject({ kind: z.literal('capacity/exhausted'), capacity: simulationCapacityKindSchema, requested: z.number().int().positive() }),
])
/** Parsed backlog mutation. */
export type CapacityRecord = z.infer<typeof capacityRecordSchema>
/** A prospective atomic mutation exceeded backlog capacity; no tentative effects may escape. */
export class SimulationCapacityExceeded extends Error {
  constructor(readonly capacity: SimulationCapacityKind, readonly used: number, readonly requested: number) {
    super(`Simulation pending ${capacity} capacity exhausted; free or extend capacity and explicitly resume`)
  }
}
/**
 * Derive live counts independently of append-only history size.
 * @param state - Durable event/wake and interaction projections plus administrative additions.
 * @returns active counts and additive limits.
 */
export function queueUsage(state: SimulationSnapshot): SimulationQueueUsage {
  const grants = Object.values(state.capacityGrants ?? {})
  const limit = (kind: SimulationCapacityKind, base: number): number => {
    const total = grants.filter(grant => grant.capacity === kind).reduce((sum, grant) => sum + BigInt(grant.amount), BigInt(base))
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Simulation granted capacity exceeds safe integer range')
    return Number(total)
  }
  return { events: { used: Object.values(state.scheduledEvents).filter(event => event.status === 'pending').length
    + Object.values(state.wakes).filter(wake => wake.status === 'pending' || wake.status === 'claimed').length,
  limit: limit('events', state.spec.maxPendingEvents) },
  interactions: { used: Object.values(state.interactions).filter(request => request.commitmentId === undefined
    ? request.execution === 'pending' && request.reply !== 'rejected'
    : state.commitments[request.commitmentId]?.phase === 'open').length,
  limit: limit('interactions', state.spec.maxPendingInteractions) } }
}
/**
 * Refuse prospective backlog growth before a durable batch is published.
 * @param state - Projection immediately before this growth, possibly within an atomic batch.
 * @param kind - Backlog whose new responsibilities need capacity.
 * @param requested - Number of additional responsibilities.
 */
export function assertCapacity(state: SimulationSnapshot, kind: SimulationCapacityKind, requested: number): void {
  const usage = queueUsage(state)[kind]
  if (requested > usage.limit - usage.used) throw new SimulationCapacityExceeded(kind, usage.used, requested)
}
/**
 * Fold an explicit addition or capacity stall against current authoritative counts.
 * @param state - Current durable projection.
 * @param record - Parsed mutation.
 * @returns updated grants or a stall preserving all accepted work.
 */
export function foldCapacity(state: SimulationSnapshot, record: CapacityRecord): SimulationSnapshot {
  switch (record.kind) {
    case 'capacity/extended': {
      if (Object.hasOwn(state.capacityGrants ?? {}, record.request.id)) throw new Error('Simulation capacity addition identity is retained')
      const next = { ...state, capacityGrants: { ...state.capacityGrants, [record.request.id]: record.request } }
      queueUsage(next)
      return next
    }
    case 'capacity/exhausted': {
      const usage = queueUsage(state)[record.capacity]
      if (record.requested <= usage.limit - usage.used) throw new Error('Simulation backlog demand is not exhausted')
      return { ...state, phase: 'stalled', stall: { code: 'SIM_QUEUE_CAPACITY', capacity: record.capacity,
        ...usage, requested: record.requested, recovery: 'free-or-extend-capacity-and-resume' } }
    }
    /* v8 ignore next -- the persisted discriminant is validated before this closed-union fold. */
    default: return assertNever(record)
  }
}
/**
 * Check retained active responsibilities against independently configured/granted limits.
 * @param state - Complete durable projection after commit or replay.
 */
export function assertCapacityProjection(state: SimulationSnapshot): void {
  const usage = queueUsage(state)
  if (usage.events.used > usage.events.limit || usage.interactions.used > usage.interactions.limit) {
    throw new Error('Simulation retained responsibilities exceed granted capacity')
  }
}
/* v8 ignore next -- only the statically unreachable closed-union arm calls this helper. */
function assertNever(value: never): never { throw new Error(`Unknown capacity record: ${String(value)}`) }
