/** Strict wire selectors and receipt-only task metadata; no public actor or authority fields. */
import { z } from 'zod'
import type { TaskAttemptId, TeamId, TeamTaskId } from '@clocky/clocky-team/types'
import type { SimulationOperationId } from '@clocky/clocky-simulation/identities'
import type { SimulationProductCommandId } from './administration-types.ts'
import { simulationProductCursorSchema, simulationProductRunIdSchema } from './schema-common.ts'
import type { SimulationProductTasksInput, SimulationProductTasksPage, SimulationProductTaskCancelInput } from './task-control-types.ts'

const attemptId = z.string().min(1).transform(value => value as TaskAttemptId)
const simulationOperationIdSchema = z.string().min(1).transform(value => value as SimulationOperationId)
const commandId = z.string().min(1).refine(value => value === value.trim(), 'Cancellation command identity must be trimmed')
  .transform(value => value as SimulationProductCommandId)
/** Independent bounded owned-run task observation. */
export const simulationProductTasksInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  limit: z.number().int().positive().optional(), cursor: simulationProductCursorSchema.optional(),
  expectedRevision: z.number().int().nonnegative().optional() }) satisfies z.ZodType<SimulationProductTasksInput>
/** Exact original task, observed revision and lease-free or exact current-attempt fence. */
export const simulationProductTaskCancelInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  commandId, operationId: simulationOperationIdSchema,
  expectedRevision: z.number().int().positive(), expectedAttemptId: attemptId.nullable(), reason: z.string().trim().min(1),
}) satisfies z.ZodType<SimulationProductTaskCancelInput>
/** Safe current controls deliberately omit canonical task bodies and cancellation reason. */
export const simulationProductTasksPageSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  snapshotRevision: z.number().int().nonnegative(), observedAt: z.number().int().nonnegative(), total: z.number().int().nonnegative(),
  nextCursor: simulationProductCursorSchema.optional(), items: z.array(z.strictObject({ operationId: simulationOperationIdSchema,
    teamId: z.string().min(1).transform(value => value as TeamId), taskId: z.string().min(1).transform(value => value as TeamTaskId),
    taskRevision: z.number().int().positive(), phase: z.enum(['pending', 'assigned', 'running', 'review', 'completed', 'failed', 'cancelled', 'deleted']),
    attemptCount: z.number().int().nonnegative(), maxAttempts: z.number().int().positive(), expectedAttemptId: attemptId.nullable(),
    cancellation: z.strictObject({ requestedAt: z.number().int().nonnegative(), target: z.enum(['pending', 'review', 'attempt', 'delegation']) }).optional(),
    cancel: z.strictObject({ allowed: z.boolean(), reason: z.enum(['ready', 'terminal', 'cancellation-pending', 'recovery-required', 'maintenance-in-progress']) })
      .refine(value => value.allowed === (value.reason === 'ready'), 'Only ready task cancellation is allowed'),
  })) }).refine(value => value.total >= value.items.length, 'Task total must include its current window') satisfies z.ZodType<SimulationProductTasksPage>
