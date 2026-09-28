import { simulationTaskReceiptSchema } from './task-outbox.ts'
/** Durable Team receipts and real-time attempt timestamps. @module @clocky/clocky-simulation/outbox */
import { z } from 'zod'
import { channelIdSchema, envelopeIdSchema, participantIdSchema, teamIdSchema } from '@clocky/clocky-team'
import { simulationRunIdSchema } from './schema.ts'
import { simulationOperationIdSchema } from './business.ts'
import type { SimulationPostOutcome, SimulationPostReceipt } from './outbox-types.ts'

/** A target receipt identifies exactly one accepted operation and payload. */
export const simulationPostReceiptSchema: z.ZodType<SimulationPostReceipt> = z.strictObject({
  runId: simulationRunIdSchema, teamId: teamIdSchema, recipientId: participantIdSchema, sequence: z.number().int().positive(),
  operationId: simulationOperationIdSchema, fingerprint: z.string().min(1), channelId: channelIdSchema, envelopeId: envelopeIdSchema,
})
/** Transport results cross the provider boundary before they can alter the run journal. */
export const simulationPostOutcomeSchema: z.ZodType<SimulationPostOutcome> = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('applied'), receipt: simulationPostReceiptSchema }),
  z.strictObject({ status: z.literal('rejected'), code: z.string().min(1) }),
  z.strictObject({ status: z.literal('blocked-authority'), code: z.string().min(1) }),
])
/** Real clock reading, never interpreted as simulation time. */
export const simulationWallTimeSchema = z.number().int().nonnegative()

/** Every accepted outbox target retains its own typed receipt under shared attempt accounting. */
export const simulationDispatchOutcomeSchema = z.union([simulationPostOutcomeSchema,
  z.strictObject({ status: z.literal('applied'), taskReceipt: simulationTaskReceiptSchema })])
/** Validated result of a message or task outbox attempt. */
export type SimulationDispatchOutcome = z.infer<typeof simulationDispatchOutcomeSchema>
