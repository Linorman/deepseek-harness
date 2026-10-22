/** Stop-target commands carry no actor, principal, permission or caller-selected revision. */
import { z } from 'zod'
import { simulationStopTargetSchema, simulationRunControlReceiptSchema } from '@clocky/clocky-simulation/run-control'
import { simulationProductRunIdSchema } from './schema-common.ts'
import { simulationProductControlSchema } from './control-schema.ts'
import type { SimulationProductRunControlInput, SimulationProductRunControlResult } from './control-types.ts'

/** Strict update or explicit clear; null is required for clear and never omitted by SDK serializers. */
export const simulationProductRunControlInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  commandId: z.string().min(1).max(128), target: simulationStopTargetSchema.nullable(),
}) satisfies z.ZodType<SimulationProductRunControlInput>
/** Validate original command result independently of subsequent current stop state. */
export const simulationProductRunControlResultSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  receipt: simulationRunControlReceiptSchema, control: simulationProductControlSchema,
}).refine(value => value.runId === value.control.runId, 'Stop control result belongs to another run') satisfies
  z.ZodType<SimulationProductRunControlResult>
