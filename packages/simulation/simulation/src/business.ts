import { simulationWorldEvidenceSupplySchema } from './world-evidence.ts'
import { simulationWorldRequestOperationSchema, simulationWorldResolveOperationSchema } from './world.ts'
import { simulationTaskSpecSchema } from './task-outbox.ts'
/** Decision and resource-operation input schemas. @module @clocky/clocky-simulation/business */
import { z } from 'zod'
import { channelIdSchema } from '@clocky/clocky-team/schema'
import type { Branded } from '@clocky/clocky-brand'
import { simulationEntityIdSchema } from './entity.ts'
import { simTimeSchema } from './time.ts'
import { simulationInteractionIdSchema } from './interaction.ts'
import { simulationResourceIdSchema, simulationQuantitySchema, simulationGrantIdSchema,
  simulationTransactionSchema } from './resource.ts'
import { simulationResourceReservationIdSchema } from './resource-reservation.ts'
export { simulationResourceIdSchema, simulationQuantitySchema, simulationGrantIdSchema,
  simulationResourceSpecSchema, simulationTransactionSchema } from './resource.ts'
const positiveQuantity = simulationQuantitySchema.refine(value => value !== '0', 'Transfer quantity must be positive')

/** Decision identity selected before inference and retained for retries. */
export const simulationDecisionIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationDecisionId'>)
/** Operation identity derived by the executor from run, decision and index. */
export const simulationOperationIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationOperationId'>)
/** Ordered decision position, persisted before inference. */
export const simulationDecisionSlotSchema = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(value => value as Branded<'SimulationDecisionSlot'>)
/** Objective evidence or explicit creditor approval is required to settle an obligation. */
export const simulationFulfillmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('explicit') }),
  z.strictObject({ kind: z.literal('task-completed') }),
  z.strictObject({ kind: z.literal('transfer'), from: simulationResourceIdSchema, to: simulationResourceIdSchema, quantity: positiveQuantity }),
])
/** Business effects are staged; only the run executor applies them. */
export const simulationOperationSchema = z.discriminatedUnion('kind', [
  simulationWorldRequestOperationSchema, simulationWorldResolveOperationSchema, simulationWorldEvidenceSupplySchema,
  z.strictObject({ kind: z.literal('task/create'), task: simulationTaskSpecSchema, deliverAt: simTimeSchema }),
  z.strictObject({ kind: z.literal('communication/post'), recipient: simulationEntityIdSchema, channelId: channelIdSchema,
    text: z.string().min(1), deliverAt: simTimeSchema }),
  z.strictObject({ kind: z.literal('interaction/request'), id: simulationInteractionIdSchema,
    assignee: simulationEntityIdSchema, description: z.string().min(1), replyBy: simTimeSchema.nullable(),
    completeBy: simTimeSchema.nullable(), fulfillment: simulationFulfillmentSchema }),
  z.strictObject({ kind: z.literal('interaction/accept'), id: simulationInteractionIdSchema, expectedRevision: z.number().int().positive() }),
  z.strictObject({ kind: z.literal('interaction/reject'), id: simulationInteractionIdSchema, expectedRevision: z.number().int().positive(), reason: z.string().min(1) }),
  z.strictObject({ kind: z.literal('interaction/defer'), id: simulationInteractionIdSchema, expectedRevision: z.number().int().positive(), until: simTimeSchema, reason: z.string().min(1) }),
  z.strictObject({ kind: z.literal('interaction/cancel'), id: simulationInteractionIdSchema, expectedRevision: z.number().int().positive(), reason: z.string().min(1) }),
  z.strictObject({ kind: z.literal('interaction/confirm'), id: simulationInteractionIdSchema, expectedRevision: z.number().int().positive() }),
  z.strictObject({ kind: z.literal('interaction/result'), id: simulationInteractionIdSchema, expectedRevision: z.number().int().positive(),
    evidence: z.array(simulationOperationIdSchema) }),
  z.strictObject({ kind: z.literal('resource/reserve'), id: simulationResourceReservationIdSchema,
    transaction: simulationTransactionSchema, grants: z.array(simulationGrantIdSchema), expiresAt: simTimeSchema }),
  z.strictObject({ kind: z.literal('resource/commit-reservation'), id: simulationResourceReservationIdSchema,
    expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
  z.strictObject({ kind: z.literal('resource/cancel-reservation'), id: simulationResourceReservationIdSchema,
    expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
  z.strictObject({ kind: z.literal('resource/transfer'), transaction: simulationTransactionSchema, grants: z.array(simulationGrantIdSchema) }),
  z.strictObject({ kind: z.literal('resource/grant'), id: simulationGrantIdSchema, grantee: simulationEntityIdSchema,
    resources: z.array(simulationResourceIdSchema).min(1), transaction: simulationTransactionSchema }),
  z.strictObject({ kind: z.literal('resource/revoke-grant'), id: simulationGrantIdSchema, expectedRevision: z.number().int().positive() }),
])
/** Dependencies may select earlier operations in this decision or already accepted operation identities. */
export const simulationProposalSchema = z.strictObject({
  after: z.array(z.union([z.number().int().nonnegative(), simulationOperationIdSchema])),
  action: simulationOperationSchema,
})
