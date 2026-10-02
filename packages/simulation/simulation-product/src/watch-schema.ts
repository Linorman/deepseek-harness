/** Strict metadata-only watch parsing shares existing product identities and response budgets. */
import { z } from 'zod'
import type { SimulationProductReadVersion, SimulationProductWatchInput, SimulationProductWatchResult } from './watch-types.ts'
import { simulationProductRunIdSchema, simulationProductCursorSchema } from './schema-common.ts'

/** This token identifies a policy lifetime, never grants access to it. */
export const simulationProductReadVersionSchema = z.string().min(1).transform(value => value as SimulationProductReadVersion)
/** Request waits are real time; no actor, body or administrative command is accepted. */
export const simulationProductWatchInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  cursor: simulationProductCursorSchema.optional(), waitMs: z.number().int().nonnegative().max(2147483647).optional() }) satisfies
  z.ZodType<SimulationProductWatchInput>
/** A successful hint always identifies both the current policy and a fresh authenticated continuation. */
export const simulationProductWatchResultSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  readVersion: simulationProductReadVersionSchema, cursor: simulationProductCursorSchema,
  status: z.enum(['changed', 'unchanged', 'reset']), observedAt: z.number().int().nonnegative(),
  world: z.union([z.strictObject({ status: z.literal('observed'), revision: z.number().int().nonnegative() }),
    z.strictObject({ status: z.enum(['missing', 'unavailable']) })]),
}) satisfies z.ZodType<SimulationProductWatchResult>
