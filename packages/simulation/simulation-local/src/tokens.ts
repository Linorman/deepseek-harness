/** Durable model-attempt token ownership and reconciliation. @module @clocky/clocky-simulation-local/tokens */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { taskDecision } from '@clocky/clocky-simulation'
import { simulationCompactionTokenRequestSchema, simulationEntityIdSchema, simulationWriterEpochSchema,
  simulationTokenReservationIdSchema, simulationTokenOutcomeSchema, simulationTokenCount, simulationTokenRequestSchema,
  simulationDecisionIdSchema, simulationEventSlotSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationTokenReservationId, SimulationTokenReservation } from '@clocky/clocky-simulation'
import { assertBudget, budgetInterval } from './budget.ts'

/** Reservations precede provider dispatch; settlement never changes their request identity or interval. */
export const tokenRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('token/compaction-reserved'), id: simulationTokenReservationIdSchema,
    entityId: simulationEntityIdSchema, epoch: simulationWriterEpochSchema, request: simulationCompactionTokenRequestSchema }),
  z.strictObject({ kind: z.literal('token/reserved'), id: simulationTokenReservationIdSchema,
    decisionId: simulationDecisionIdSchema, request: simulationTokenRequestSchema }),
  z.strictObject({ kind: z.literal('token/settled'), id: simulationTokenReservationIdSchema, outcome: simulationTokenOutcomeSchema }),
  z.strictObject({ kind: z.literal('token/acknowledged'), id: simulationTokenReservationIdSchema }),
])
/** Parsed attempt mutation. */
export type TokenRecord = z.infer<typeof tokenRecordSchema>
/**
 * Derive the next run-local model-attempt identity.
 * @param state - Persisted allocation counter.
 * @returns stable identity consumed by the next reservation record.
 */
export function nextTokenId(state: SimulationSnapshot): SimulationTokenReservationId {
  return simulationTokenReservationIdSchema.parse(`tokens/${state.nextTokenSlot ?? '0'}`)
}
/**
 * Resolve a retained attempt without inherited object keys.
 * @param state - Authoritative model reservations.
 * @param id - Exact attempt identity.
 * @returns the retained reservation or a missing-identity error.
 */
export function requireTokenReservation(state: SimulationSnapshot, id: SimulationTokenReservationId): SimulationTokenReservation {
  const reservations = state.tokenReservations ?? {}
  const value = Object.hasOwn(reservations, id) ? reservations[id] : undefined
  if (value === undefined) throw new Error('Simulation token reservation does not exist')
  return value
}
/**
 * Fold one model-attempt record, retaining unknown costs and reported overruns.
 * @param state - Projection preceding the record.
 * @param record - Parsed durable mutation.
 * @returns the updated accounting and any explicit overrun stall.
 */
export function foldTokens(state: SimulationSnapshot, record: TokenRecord): SimulationSnapshot {
  switch (record.kind) {
    case 'token/reserved': {
      const decision = state.decisions[record.decisionId]
      const entity = decision === undefined ? undefined : state.entities[decision.entityId]
      const task = taskDecision(state, record.decisionId)
      if (record.id !== nextTokenId(state) || state.phase !== 'running' || decision?.status !== 'open'
        || task !== undefined && state.taskCancellations?.[task.execution.request.operationId] !== undefined
        || decision.context?.status !== 'prepared' || decision.inference === undefined || entity?.binding === undefined
        || entity.readiness !== 'ready' || entity.writer?.phase !== 'active' || entity.writer.epoch !== decision.epoch
        || (decision.windowId === undefined ? state.activeDecisionId !== decision.id : state.activeWindowId !== decision.windowId)) {
        throw new Error('Simulation token reservation requires its current prepared inference owner')
      }
      assertBudget(state, 'tokens', state.spec.tokensPerModelRequest)
      const reservation: SimulationTokenReservation = { id: record.id, decisionId: decision.id, entityId: decision.entityId,
        epoch: decision.epoch, sessionId: entity.binding.sessionId, request: record.request, interval: budgetInterval(state, decision.time),
        reserved: state.spec.tokensPerModelRequest, status: 'reserved' }
      return { ...state, nextTokenSlot: simulationEventSlotSchema.parse(String(BigInt(state.nextTokenSlot ?? '0') + 1n)),
        tokenReservations: { ...state.tokenReservations, [record.id]: reservation } }
    }
    case 'token/compaction-reserved': {
      const entity = state.entities[record.entityId]
      const cancelledTask = Object.values(state.taskExecutions ?? {}).some(execution => execution.retired === undefined
        && execution.request.entityId === record.entityId && execution.request.epoch === record.epoch
        && state.taskCancellations?.[execution.request.operationId] !== undefined)
      if (record.id !== nextTokenId(state) || state.phase === 'stalled' || entity?.readiness !== 'ready' || entity.phase !== 'active'
        || cancelledTask
        || entity.binding === undefined || entity.writer?.phase !== 'active' || entity.writer.epoch !== record.epoch) {
        throw new Error('Simulation compaction tokens require their current canonical writer')
      }
      assertBudget(state, 'tokens', state.spec.tokensPerModelRequest)
      const { compactionId, ...request } = record.request
      const reservation: SimulationTokenReservation = { id: record.id, entityId: entity.id, epoch: record.epoch,
        compactionId, sessionId: entity.binding.sessionId, request, interval: budgetInterval(state, state.time),
        reserved: state.spec.tokensPerModelRequest, status: 'reserved' }
      return { ...state, nextTokenSlot: simulationEventSlotSchema.parse(String(BigInt(state.nextTokenSlot ?? '0') + 1n)),
        tokenReservations: { ...state.tokenReservations, [record.id]: reservation } }
    }
    case 'token/settled': {
      const reservation = requireTokenReservation(state, record.id)
      if (reservation.status === 'settled' || reservation.status === 'not-dispatched'
        || reservation.status === 'unknown' && record.outcome.kind !== 'complete') {
        throw new Error('Simulation token settlement is already retained')
      }
      const outcome = record.outcome
      const usage = outcome.kind === 'complete' ? outcome.usage : outcome.kind === 'unknown' ? outcome.observedUsage : undefined
      const overrun = usage !== undefined && simulationTokenCount(usage) > reservation.reserved
      const settled: SimulationTokenReservation = { ...reservation,
        status: outcome.kind === 'complete' ? 'settled' : outcome.kind,
        ...usage === undefined ? {} : outcome.kind === 'complete' ? { usage } : { observedUsage: usage },
        ...overrun ? { overrunAcknowledged: false } : {} }
      return { ...state, tokenReservations: { ...state.tokenReservations, [record.id]: settled },
        ...overrun ? { phase: 'stalled' as const, stall: { code: 'SIM_TOKEN_RESERVATION_EXCEEDED' as const,
          reservationId: record.id, recovery: 'acknowledge-overrun-and-cover-usage' as const } } : {} }
    }
    case 'token/acknowledged': {
      const reservation = requireTokenReservation(state, record.id)
      if (reservation.overrunAcknowledged !== false) throw new Error('Simulation token attempt has no unacknowledged overrun')
      return { ...state, tokenReservations: { ...state.tokenReservations, [record.id]: { ...reservation, overrunAcknowledged: true } } }
    }
    /* v8 ignore next -- the persisted discriminant is validated before this closed-union fold. */
    default: return assertNever(record)
  }
}
/**
 * Check immutable request ownership and settlement consistency against retained decisions and canonical Sessions.
 * @param state - Complete durable run projection.
 */
export function assertTokenProjection(state: SimulationSnapshot): void {
  for (const reservation of Object.values(state.tokenReservations ?? {})) {
    const decision = reservation.decisionId === undefined ? undefined : state.decisions[reservation.decisionId]
    if ((reservation.compactionId === undefined) === (reservation.decisionId === undefined)
      || reservation.decisionId !== undefined && (decision?.entityId !== reservation.entityId || decision.epoch !== reservation.epoch)
      || state.entities[reservation.entityId]?.binding?.sessionId !== reservation.sessionId
      || reservation.reserved !== state.spec.tokensPerModelRequest
      || decision !== undefined && reservation.interval !== budgetInterval(state, decision.time)
      || (reservation.status === 'settled') !== (reservation.usage !== undefined)
      || (reservation.overrunAcknowledged !== undefined) !== (Math.max(
        reservation.usage === undefined ? 0 : simulationTokenCount(reservation.usage),
        reservation.observedUsage === undefined ? 0 : simulationTokenCount(reservation.observedUsage)) > reservation.reserved)) {
      throw new Error('Simulation token reservation lost its request ownership or usage evidence')
    }
  }
}
/**
 * Verify an exact settlement retry without permitting usage to be rewritten.
 * @param reservation - Existing result.
 * @param outcome - Requested terminal or incomplete observation.
 * @returns whether no journal mutation is needed.
 */
export function tokenSettlementRetained(reservation: SimulationTokenReservation,
  outcome: import('@clocky/clocky-simulation').SimulationTokenOutcome): boolean {
  if (reservation.status === 'reserved') return false
  if (reservation.status === 'unknown' && outcome.kind === 'complete') return false
  const retained = reservation.status === 'settled' ? { kind: 'complete', usage: reservation.usage }
    : reservation.status === 'not-dispatched' ? { kind: 'not-dispatched' }
      : { kind: 'unknown', ...reservation.observedUsage === undefined ? {} : { observedUsage: reservation.observedUsage } }
  if (!isDeepStrictEqual(retained, outcome)) throw new Error('Simulation token settlement retry changed its usage')
  return true
}

/* v8 ignore next -- only the statically unreachable closed-union arm calls this helper. */
function assertNever(value: never): never { throw new Error(`Unknown token record: ${String(value)}`) }
