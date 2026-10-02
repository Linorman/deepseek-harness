/** Strict actor-free administrative task review boundary. */
import { z } from 'zod'
import type { TeamId, TeamTaskId, TaskAttemptId } from '@clocky/clocky-team/types'
import type { SimulationEntityId, SimulationOperationId } from '@clocky/clocky-simulation/identities'
import { simulationProductCursorSchema, simulationProductRunIdSchema } from './schema-common.ts'
import type { SimulationProductCommandId } from './administration-types.ts'
import type { SimulationProductTaskReviewListInput, SimulationProductTaskReviewPage, SimulationProductTaskReviewResolveInput } from './review-types.ts'

const teamIdSchema = z.string().min(1).transform(value => value as TeamId)
const teamTaskIdSchema = z.string().min(1).transform(value => value as TeamTaskId)
const taskAttemptIdSchema = z.string().min(1).transform(value => value as TaskAttemptId)
const simulationEntityIdSchema = z.string().min(1).transform(value => value as SimulationEntityId)
const simulationOperationIdSchema = z.string().min(1).transform(value => value as SimulationOperationId)
const simulationProductCommandIdSchema = z.string().min(1)
  .refine(value => value === value.trim(), 'Review command identity must be trimmed').transform(value => value as SimulationProductCommandId)
/** No actor, arbitrary task selector, native configuration or grant fields are admitted. */
export const simulationProductTaskReviewListInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  limit: z.number().int().positive().optional(), cursor: simulationProductCursorSchema.optional(),
  expectedRevision: z.number().int().nonnegative().optional() }) satisfies z.ZodType<SimulationProductTaskReviewListInput>
/** Every original mutation binds the accepted operation, exact completed attempt and canonical revision. */
export const simulationProductTaskReviewResolveInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  commandId: simulationProductCommandIdSchema, operationId: simulationOperationIdSchema, attemptId: taskAttemptIdSchema,
  expectedRevision: z.number().int().positive(), nextPhase: z.enum(['completed', 'pending']), reason: z.string().trim().min(1),
}) satisfies z.ZodType<SimulationProductTaskReviewResolveInput>
/** Safe metadata deliberately omits task subject, instructions, arbitrary result bodies and reviewer grants. */
export const simulationProductTaskReviewPageSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  snapshotRevision: z.number().int().nonnegative(), observedAt: z.number().int().nonnegative(), total: z.number().int().nonnegative(),
  nextCursor: simulationProductCursorSchema.optional(), items: z.array(z.strictObject({ operationId: simulationOperationIdSchema,
    teamId: teamIdSchema, taskId: teamTaskIdSchema, attemptId: taskAttemptIdSchema, taskRevision: z.number().int().positive(),
    reviewerEntityId: simulationEntityIdSchema, phase: z.enum(['pending', 'assigned', 'running', 'review', 'completed', 'failed', 'cancelled', 'deleted']),
    attemptCount: z.number().int().nonnegative(), maxAttempts: z.number().int().positive(),
    evidence: z.strictObject({ inventoryTransfer: z.strictObject({ operationId: simulationOperationIdSchema,
      status: z.literal('applied'), quantity: z.literal('1') }).optional(),
    report: z.strictObject({ operationId: simulationOperationIdSchema, delivery: z.literal('persisted') }) }).optional(), action: z.strictObject({ allowed: z.boolean(),
      reason: z.enum(['ready', 'review-disabled', 'recovery-required', 'maintenance-in-progress', 'target-changed', 'review-unavailable']),
    }).refine(value => value.allowed === (value.reason === 'ready'), 'Only ready reviews are allowed'),
  }).refine(value => !value.action.allowed || value.evidence !== undefined, 'An allowed review requires fixed scene evidence')) }).refine(value => value.total >= value.items.length, 'Review total must include its page') satisfies z.ZodType<SimulationProductTaskReviewPage>
