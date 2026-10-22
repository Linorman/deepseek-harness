/** Canonical JSON decimal simulation time. @module @clocky/clocky-simulation/time */
import { z } from 'zod'
import type { SimTime } from './time-types.ts'

/** Validated canonical decimal, without a machine-integer precision limit. */
export const simTimeSchema = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(value => value as SimTime)
/**
 * Parse and bound a time before admitting it from persisted or external data.
 * @param value - Untrusted decimal value.
 * @param max - Validated run-specific upper bound.
 * @returns the validated canonical time.
 */
export function parseSimTime(value: unknown, max: SimTime): SimTime {
  const time = simTimeSchema.parse(value)
  if (BigInt(time) > BigInt(max)) throw new RangeError('Simulation time exceeds the run maximum')
  return time
}
