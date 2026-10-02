/** Actor-free exact original retry payload and safe per-operation capability parsing. */
import { z } from 'zod'
import type { SimulationOperationId } from '@clocky/clocky-simulation/identities'
import type { SimulationProductCommandId } from './administration-types.ts'
import { simulationProductRunIdSchema } from './schema-common.ts'
import type { SimulationProductOperationRetryInput, SimulationProductOperationRetryCapability } from './operation-retry-types.ts'

/** A retry identity is preserved exactly; reason text normalizes once before acceptance. */
export const simulationProductOperationRetryInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  commandId: z.string().min(1).refine(value => value === value.trim(), 'Retry command identity must be trimmed')
    .transform(value => value as SimulationProductCommandId),
  operationId: z.string().min(1).transform(value => value as SimulationOperationId),
  expectedAttemptCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), reason: z.string().trim().min(1),
}) satisfies z.ZodType<SimulationProductOperationRetryInput>

/** Capacity is an observation, not a grant; only an exact ready unknown intent is selectable. */
export const simulationProductOperationRetryCapabilitySchema = z.strictObject({ allowed: z.boolean(),
  reason: z.enum(['ready', 'not-external', 'outcome-known', 'not-unknown', 'not-due', 'maintenance-in-progress', 'recovery-required',
    'request-in-progress', 'capacity-unavailable']), expectedAttemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
}).refine(value => value.allowed === (value.reason === 'ready') && (!value.allowed || value.expectedAttemptCount > 0),
  'Only exact ready unknown attempts can be retried') satisfies z.ZodType<SimulationProductOperationRetryCapability>
