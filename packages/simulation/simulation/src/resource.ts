/** Conserved resource transaction inputs; no operation or scheduler dependency. */
import { z } from 'zod'
import type { Branded } from '@clocky/clocky-brand'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationCommitmentIdSchema } from './interaction.ts'

/** Resource account identity within a run. */
export const simulationResourceIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationResourceId'>)
/** One-use authorization for an exact resource transaction. */
export const simulationGrantIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationGrantId'>)
/** Canonical non-negative quantity in the resource's fixed unit. */
export const simulationQuantitySchema = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(value => value as Branded<'SimulationQuantity'>)
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
