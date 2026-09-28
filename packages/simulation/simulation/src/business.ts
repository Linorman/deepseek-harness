import { simulationTaskSpecSchema } from './task-outbox.ts'
/** Decision and resource-operation input schemas. @module @clocky/clocky-simulation/business */
import { z } from 'zod'
import { channelIdSchema } from '@clocky/clocky-team'
import type { Branded } from '@clocky/clocky-brand'
import { simulationEntityIdSchema } from './entity.ts'
import { simTimeSchema } from './time.ts'
import { simulationCommitmentIdSchema, simulationInteractionIdSchema } from './interaction.ts'

/** Decision identity selected before inference and retained for retries. */
export const simulationDecisionIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationDecisionId'>)
/** Operation identity derived by the executor from run, decision and index. */
export const simulationOperationIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationOperationId'>)
/** Resource account identity within a run. */
export const simulationResourceIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationResourceId'>)
/** One-use authorization for an exact resource transaction. */
export const simulationGrantIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationGrantId'>)
/** Canonical non-negative quantity in the resource's fixed unit. */
export const simulationQuantitySchema = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(value => value as Branded<'SimulationQuantity'>)
/** Ordered decision position, persisted before inference. */
export const simulationDecisionSlotSchema = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(value => value as Branded<'SimulationDecisionSlot'>)
const positiveQuantity = simulationQuantitySchema.refine(value => value !== '0', 'Transfer quantity must be positive')
/** Explicit bootstrap resource; business operations cannot mint balances. */
export const simulationResourceSpecSchema = z.strictObject({
  id: simulationResourceIdSchema,
  owner: simulationEntityIdSchema,
  kind: z.enum(['money', 'inventory']),
  unit: z.string().min(1),
  quantity: simulationQuantitySchema,
  controllers: z.array(simulationEntityIdSchema),
})
/** Complete resource read set and conserved transfers applied as one world transaction. */
export const simulationTransactionSchema = z.strictObject({
  commitmentId: simulationCommitmentIdSchema.nullable(),
  reads: z.array(z.strictObject({ resourceId: simulationResourceIdSchema, revision: z.number().int().positive() })).min(1),
  transfers: z.array(z.strictObject({
    from: simulationResourceIdSchema, to: simulationResourceIdSchema, quantity: positiveQuantity,
  })).min(1),
})
/** Objective evidence or explicit creditor approval is required to settle an obligation. */
export const simulationFulfillmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('explicit') }),
  z.strictObject({ kind: z.literal('task-completed') }),
  z.strictObject({ kind: z.literal('transfer'), from: simulationResourceIdSchema, to: simulationResourceIdSchema, quantity: positiveQuantity }),
])
/** Business effects are staged; only the run executor applies them. */
export const simulationOperationSchema = z.discriminatedUnion('kind', [
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
