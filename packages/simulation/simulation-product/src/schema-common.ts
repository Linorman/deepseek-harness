/** Browser-safe product identity and explicit display truncation parsers shared by read DTOs. */
import { z } from 'zod'
import type { SimulationProductRunId, SimulationProductCursor } from './types.ts'

/** Brand one opaque directory identity at its parser boundary. */
export const simulationProductRunIdSchema = z.string().min(1).transform(value => value as SimulationProductRunId)
/** Brand an opaque encrypted continuation at its parser boundary. */
export const simulationProductCursorSchema = z.string().min(1).transform(value => value as SimulationProductCursor)
/** Bounded text remains distinguishable from a complete display value. */
export const simulationProductTextSchema = z.object({ text: z.string(), truncated: z.boolean() }).strict()
