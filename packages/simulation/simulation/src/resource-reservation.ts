import { simulationWorldAuthenticatedUserSourceSchema } from './world-management-source.ts'
/** Exact local resource holds and simulated expiry sources. */
import { z } from 'zod'
import type { Branded } from '@clocky/clocky-brand'
import { simulationEntityIdSchema } from './entity.ts'
import { simTimeSchema } from './time.ts'
import { simulationTransactionSchema, simulationGrantIdSchema } from './resource.ts'
import { simulationEventIdSchema } from './event-identities.ts'
import type { SimulationOperationId } from './identities.ts'
import { simulationHiringFeePolicySchema } from './world-hiring-resources.ts'
import type { WorldIntentId } from './world-domain-types.ts'
import type { WorldPlanId } from './world-types.ts'
import { simulationHireApprovalBasisSchema } from './world-hiring-approval-basis.ts'
/** Run-local business reservation identity, distinct from a transaction or model decision. */
export type SimulationResourceReservationId = Branded<'SimulationResourceReservationId'>
/** Strict identity at model, persisted and scheduler boundaries. */
export const simulationResourceReservationIdSchema = z.string().min(1).max(256)
  .transform(value => value as SimulationResourceReservationId)
const cursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const operationId = z.string().min(1).transform(value => value as SimulationOperationId)
/** Exact released/committed source; no caller may supply settlement facts in a proposal. */
const settlementSchema = z.union([
  z.strictObject({ kind: z.literal('operation'), operationId, sequence: cursor, time: simTimeSchema }),
  z.strictObject({ kind: z.literal('expiry'), eventId: simulationEventIdSchema, sequence: cursor, time: simTimeSchema }),
  z.strictObject({ kind: z.literal('world'), intentId: z.string().min(1).transform(value => value as WorldIntentId),
    planId: z.string().min(1).transform(value => value as WorldPlanId), transition: z.enum(['committed', 'cancelled']),
    sequence: cursor, time: simTimeSchema }),
])
/** One conserved Native hold; expired and cancelled history is never deleted or refunded. */
export const simulationResourceReservationSchema = z.strictObject({
  id: simulationResourceReservationIdSchema, actorId: simulationEntityIdSchema, transaction: simulationTransactionSchema,
  grants: z.array(simulationGrantIdSchema), expiresAt: simTimeSchema, createdTime: simTimeSchema,
  createdOperationId: operationId.nullable(), management: simulationWorldAuthenticatedUserSourceSchema.optional(),
  sequence: cursor, revision: cursor.positive(),
  world: z.strictObject({ intentId: z.string().min(1).transform(value => value as WorldIntentId),
    planId: z.string().min(1).transform(value => value as WorldPlanId), fee: simulationHiringFeePolicySchema,
    approvals: z.array(simulationHireApprovalBasisSchema),
    expiryConsumed: z.strictObject({ eventId: simulationEventIdSchema, sequence: cursor, time: simTimeSchema }).optional(),
  }).optional(),
  phase: z.enum(['active', 'committed', 'cancelled', 'expired']), settlement: settlementSchema.optional(),
}).refine(value => (value.createdOperationId === null) === (value.management !== undefined)
  && (value.createdOperationId !== null || value.world !== undefined), 'User funding requires its actual World management source')
  .refine(value => (value.phase === 'active') === (value.settlement === undefined), 'Terminal holds require their exact settlement')
  .refine(value => BigInt(value.expiresAt) > BigInt(value.createdTime), 'Original expiry must follow the recorded creation clock')
/** Strict durable projection; Native reconstructs it from the original operation and settlement. */
export type SimulationResourceReservation = z.infer<typeof simulationResourceReservationSchema>

/**
 * Reconstruct a transfer from its original operation or exact committed hold, never a caller's receipt.
 * @param state - Native resource reservation projection.
 * @param operation - Original immutable transfer or reservation settlement.
 * @returns the conserved transaction, or undefined for a non-transfer or unrelated settlement.
 */
export function simulationResourceTransaction(state: Pick<import('./types.ts').SimulationSnapshot, 'resourceReservations'>,
  operation: import('./business-types.ts').SimulationOperation): import('./business-types.ts').SimulationTransaction | undefined {
  if (operation.action.kind === 'resource/transfer') return operation.action.transaction
  if (operation.action.kind !== 'resource/commit-reservation') return undefined
  const reservation = state.resourceReservations[operation.action.id]
  return reservation?.phase === 'committed' && reservation.settlement?.kind === 'operation'
    && reservation.settlement.operationId === operation.id ? reservation.transaction : undefined
}
