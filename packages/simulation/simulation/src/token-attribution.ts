/** Mutually exclusive request attribution from Native reservations and canonical Session evidence.
 * @module @clocky/clocky-simulation/token-attribution
 */
import { z } from 'zod'
import type { SessionEvent, SessionId } from '@clocky/clocky-session/types'
import type { SimulationDecision } from './business-types.ts'
import type { SimulationTokenReservation, SimulationTokenUsage } from './tokens.ts'
import { simulationContextConsumptionHash } from './context-consumption.ts'
import { simulationTokenCount } from './tokens.ts'

/** One category per model request, irrespective of the number of actions it produces. */
export type SimulationTokenCategory = 'business-choice' | 'adjudication' | 'result-closeout'
  | 'communication' | 'compaction' | 'unknown'

/** Independently summed provider buckets; these are tokens rather than monetary costs. */
export interface SimulationTokenAttributionBucket {
  /** Number of reservation identities in this category, including non-dispatch. */
  attempts: number
  /** Counts by authoritative settlement status. */
  statuses: Record<SimulationTokenReservation['status'], number>
  /** Unsettled reserved ceiling (reserved and unknown requests only). */
  outstandingReservedTokens: number
  /** Complete provider-reported usage for settled requests. */
  settled: SimulationTokenUsage
  /** Incomplete observed usage for unknown requests; never added to settled. */
  unknownReported: SimulationTokenUsage
}

/** An exactly-once accounting projection with an explicit unclassifiable category. */
export interface SimulationTokenAttribution {
  /** Mutually exclusive categories whose buckets sum to total. */
  categories: Record<SimulationTokenCategory, SimulationTokenAttributionBucket>
  /** All retained reservations, including unknown and non-dispatch. */
  total: SimulationTokenAttributionBucket
}

const CATEGORIES: readonly SimulationTokenCategory[] = [
  'business-choice', 'adjudication', 'result-closeout', 'communication', 'compaction', 'unknown',
]

function empty(): SimulationTokenAttributionBucket {
  return { attempts: 0, statuses: { reserved: 0, unknown: 0, settled: 0, 'not-dispatched': 0 },
    outstandingReservedTokens: 0,
    settled: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    unknownReported: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }
}

/**
 * Project usage without splitting a shared business/message request or guessing from prose.
 * @param reservations - authoritative retained attempts; duplicate identities are rejected.
 * @param decisions - Native decisions keyed by their identity.
 * @param sessions - canonical authorized Session logs keyed by Session identity.
 * @returns disjoint categories and their total; missing Native ownership or consumed-context evidence is unknown.
 * Optional Session logs additionally corroborate that evidence.
 * @throws on duplicate reservations or unsafe bucket totals.
 */
export function attributeSimulationTokens(
  reservations: readonly SimulationTokenReservation[],
  decisions: Readonly<Record<string, SimulationDecision>>,
  sessions: ReadonlyMap<SessionId, readonly SessionEvent[]> = new Map(),
): SimulationTokenAttribution {
  const categories = Object.fromEntries(CATEGORIES.map(category => [category, empty()])) as SimulationTokenAttribution['categories']
  const total = empty()
  const seen = new Set<string>()
  for (const reservation of reservations) {
    if (seen.has(reservation.id)) throw new Error('Duplicate token reservation in attribution')
    seen.add(reservation.id)
    const category = classify(reservation, decisions, sessions)
    add(categories[category], reservation)
    add(total, reservation)
  }
  return { categories, total }
}

const compactionEvidence = z.object({ type: z.literal('compaction/request'), data: z.object({
  compactionId: z.string().min(1), request: z.object({ provider: z.string().min(1), model: z.string().min(1) }),
}) })

function classify(reservation: SimulationTokenReservation,
  decisions: Readonly<Record<string, SimulationDecision>>,
  sessions: ReadonlyMap<SessionId, readonly SessionEvent[]>): SimulationTokenCategory {
  const events = sessions.get(reservation.sessionId)
  const at = events?.[reservation.request.sessionSequence]
  if (events !== undefined && at?.seq !== reservation.request.sessionSequence) return 'unknown'
  if (reservation.compactionId !== undefined) {
    if (events === undefined) return 'compaction'
    const evidence = compactionEvidence.safeParse(at)
    return evidence.success && evidence.data.data.compactionId === reservation.compactionId
      && evidence.data.data.request.provider === reservation.request.provider
      && evidence.data.data.request.model === reservation.request.model ? 'compaction' : 'unknown'
  }
  if (reservation.decisionId === undefined) return 'unknown'
  const decision = decisions[reservation.decisionId]
  const context = decision?.context
  const consumption = decision?.consumption
  if (decision === undefined || context?.status !== 'prepared' || consumption === undefined
    || consumption.sessionId !== reservation.sessionId || consumption.consumedSequence > reservation.request.sessionSequence
    || decision.entityId !== reservation.entityId || decision.epoch !== reservation.epoch) return 'unknown'
  if (simulationContextConsumptionHash(context.view) !== consumption.contextHash) return 'unknown'
  if (events !== undefined) {
    const view = events[consumption.viewSequence]
    if (view?.type !== 'simulation/context-view' || view.data.inputId !== consumption.inputId
      || view.data.inputId !== context.view.inputId
      || simulationContextConsumptionHash(view.data) !== consumption.contextHash
      || simulationContextConsumptionHash(context.view) !== consumption.contextHash) return 'unknown'
    const header = events.slice(0, reservation.request.sessionSequence + 1).findLast(event => event.type === 'request/header')
    if (header?.type !== 'request/header' || header.data.header.config.provider !== reservation.request.provider
      || header.data.header.config.model !== reservation.request.model) return 'unknown'
  }
  switch (context.world?.kind) {
    case 'resolve': case 'scenario-resolve': return 'adjudication'
    case 'result': case 'scenario-result': return 'result-closeout'
    case 'request': case 'goal': case 'first-action': return 'business-choice'
    // A communication may share the same request as a business decision.
    // Without an independently typed input purpose, it remains unknown.
    default: return 'unknown'
  }
}

function sum(left: number, right: number): number {
  const result = left + right
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Token attribution exceeds safe integer capacity')
  return result
}

function usage(left: SimulationTokenUsage, right: SimulationTokenUsage): SimulationTokenUsage {
  simulationTokenCount(right)
  const result = { inputTokens: sum(left.inputTokens, right.inputTokens), outputTokens: sum(left.outputTokens, right.outputTokens),
    cacheReadTokens: sum(left.cacheReadTokens ?? 0, right.cacheReadTokens ?? 0),
    cacheWriteTokens: sum(left.cacheWriteTokens ?? 0, right.cacheWriteTokens ?? 0) }
  simulationTokenCount(result)
  return result
}

function add(bucket: SimulationTokenAttributionBucket, reservation: SimulationTokenReservation): void {
  bucket.attempts = sum(bucket.attempts, 1)
  bucket.statuses[reservation.status] = sum(bucket.statuses[reservation.status], 1)
  if (reservation.status === 'reserved' || reservation.status === 'unknown') {
    bucket.outstandingReservedTokens = sum(bucket.outstandingReservedTokens, reservation.reserved)
  }
  if (reservation.status === 'settled' && reservation.usage !== undefined) bucket.settled = usage(bucket.settled, reservation.usage)
  if (reservation.status === 'unknown' && reservation.observedUsage !== undefined) {
    bucket.unknownReported = usage(bucket.unknownReported, reservation.observedUsage)
  }
}
