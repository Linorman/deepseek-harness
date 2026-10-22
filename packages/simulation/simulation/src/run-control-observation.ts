/** Bounded stop metadata is separate from the complete durable admitted-work cut and save history. */
import { z } from 'zod'
import { simTimeSchema } from './time.ts'
import { simulationRunControlStateSchema, simulationStopCutSchema } from './run-control.ts'
import type { SimulationRunControlState } from './run-control.ts'

const time = simTimeSchema.refine(value => value.length <= 256, 'Stop clock value exceeds its observation allowance')
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** Public cut coverage preserves exact clock/source metadata without copying responsibility identities. */
export const simulationStopCutObservationSchema = simulationStopCutSchema.omit({ operationIds: true, requestIds: true,
  decisionIds: true, tokenReservations: true }).extend({ operationCount: count, requestCount: count, decisionCount: count,
  tokenReservationCount: count, nativeTime: time, clockValue: time })
/** Current stop target plus scalar coverage; full original identities remain in the Native journal. */
export const simulationRunControlObservationSchema = simulationRunControlStateSchema.omit({ cut: true, checkpointAttempts: true })
  .extend({ cut: simulationStopCutObservationSchema.nullable(), checkpointAttemptCount: count, nativeBoundary: time.nullable() })
/** No collection in this observation grows with admitted responsibilities or prior save attempts. */
export type SimulationRunControlObservation = z.infer<typeof simulationRunControlObservationSchema>

/**
 * Project the current stopping fact without its retained identity collections.
 * @param state - Authoritative current stopping fact at one Native revision.
 * @returns independent scalar counts and exact target/source metadata; no source identity is truncated or rewritten.
 */
export function observeSimulationRunControl(state: SimulationRunControlState): SimulationRunControlObservation {
  const { cut, checkpointAttempts, ...current } = state
  let tokenReservationCount = 0
  if (cut !== null) for (const _id in cut.tokenReservations) tokenReservationCount++
  return structuredClone({ ...current, checkpointAttemptCount: checkpointAttempts.length,
    cut: cut === null ? null : { nativeRevision: cut.nativeRevision, nativeTime: cut.nativeTime,
      clockRevision: cut.clockRevision, clockValue: cut.clockValue, recordedAt: cut.recordedAt, tokenBaseline: cut.tokenBaseline,
      operationCount: cut.operationIds.length, requestCount: cut.requestIds.length, decisionCount: cut.decisionIds.length,
      tokenReservationCount } })
}
