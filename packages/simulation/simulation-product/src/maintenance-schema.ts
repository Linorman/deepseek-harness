/** Strict maintenance and ingress JSON boundaries preserve exact time and omit native configuration and private receipts. */
import { z } from 'zod'
import type { SimulationIngressId, SimulationEventId } from '@clocky/clocky-simulation/identities'
import type { SimulationCheckpointId, SimulationEntityId, SimulationDecisionId } from '@clocky/clocky-simulation/identities'
import type { SimTime } from '@clocky/clocky-simulation/time-types'
import { simulationProductRunIdSchema } from './schema-common.ts'
import { simulationProductCommandIdSchema } from './administration-schema.ts'
import type { SimulationProductCheckpointInput, SimulationProductRestoreInput, SimulationProductIngressInput,
  SimulationProductIngressQuery, SimulationProductIngressReceipt, SimulationProductIngressResult } from './maintenance-types.ts'

/** Preserve exact native full-checkpoint identity at the public boundary. */
export const simulationProductCheckpointIdSchema: z.ZodType<SimulationCheckpointId> = z.string().min(1)
  .transform(value => value as SimulationCheckpointId)
const ingressId = z.string().min(1).transform(value => value as SimulationIngressId)
const entityId = z.string().min(1).transform(value => value as SimulationEntityId)
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(value => value as SimTime)
/** Collection policy and checkpoint identity are not browser-selected. */
export const simulationProductCheckpointInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  commandId: simulationProductCommandIdSchema }) satisfies z.ZodType<SimulationProductCheckpointInput>
/** A full checkpoint selector cannot provide native paths, policy versions or rollback flags. */
export const simulationProductRestoreInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  commandId: simulationProductCommandIdSchema, checkpointId: simulationProductCheckpointIdSchema }) satisfies
  z.ZodType<SimulationProductRestoreInput>
/** Only one target and its original text/time are accepted; caller-provided attribution rejects. */
export const simulationProductIngressInputSchema = z.strictObject({ runId: simulationProductRunIdSchema, ingressId, entityId,
  text: z.string().min(1), availableAt: decimal }) satisfies z.ZodType<SimulationProductIngressInput>
/** Exact original input lookup independent of transport request identity. */
export const simulationProductIngressQuerySchema = z.strictObject({ runId: simulationProductRunIdSchema, ingressId }) satisfies
  z.ZodType<SimulationProductIngressQuery>
/** Metadata never includes the retained private text or authentication subject. */
export const simulationProductIngressReceiptSchema = z.strictObject({ runId: simulationProductRunIdSchema, ingressId, entityId,
  eventId: z.string().min(1).transform(value => value as SimulationEventId), availableAt: decimal, assignedAt: decimal,
  sequence: z.number().int().nonnegative(), status: z.enum(['pending', 'claimed', 'consumed', 'cancelled']),
  decisionId: z.string().min(1).transform(value => value as SimulationDecisionId).optional() }) satisfies
  z.ZodType<SimulationProductIngressReceipt>
/** Received data must match the exact original run/input query. */
export const simulationProductIngressResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ runId: simulationProductRunIdSchema, ingressId, status: z.literal('not-found') }),
  z.strictObject({ runId: simulationProductRunIdSchema, ingressId, status: z.literal('found'), receipt: simulationProductIngressReceiptSchema }),
]).refine(value => value.status === 'not-found' || value.receipt.runId === value.runId && value.receipt.ingressId === value.ingressId,
  'Input receipt belongs to another original query') satisfies z.ZodType<SimulationProductIngressResult>
