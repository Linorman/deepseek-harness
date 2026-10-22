/** Browser-safe personnel metadata parsing, independent of runtime owners and private Team snapshots. */
import { z } from 'zod'
import type { SimTime } from '@clocky/clocky-simulation/time-types'
import type { SimulationProductPeopleCounts } from './people-types.ts'

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** A complete history observation cannot be manufactured from a partial page. */
export const simulationProductPeopleHistorySchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('observed'), teamCursor: count, participants: count, activations: count }),
  z.strictObject({ status: z.literal('unavailable'), reason: z.enum(['unavailable', 'unsupported', 'partial', 'source-moved']) }),
])
/** Strict whole-run counts preserve zero, unavailable and retained writer capacity as distinct facts. */
export const simulationProductPeopleCountsSchema = z.strictObject({ scope: z.literal('run'), snapshotRevision: count,
  time: z.string().regex(/^(0|[1-9][0-9]*)$/).transform(value => value as SimTime),
  employed: count, nonTerminalPersons: count, resident: count, residentLimit: count.positive(), unreleasedWriters: count,
  history: simulationProductPeopleHistorySchema,
}).refine(value => value.employed <= value.nonTerminalPersons && value.resident <= value.unreleasedWriters
  && value.unreleasedWriters <= value.residentLimit, 'Personnel counts violate their run-wide subset or capacity relationships') satisfies
  z.ZodType<SimulationProductPeopleCounts>
