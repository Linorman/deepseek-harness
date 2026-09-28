/** Outstanding event and interaction capacity. @module @clocky/clocky-simulation/capacity */
import { z } from 'zod'
import type { Branded } from '@clocky/clocky-brand'

/** Independent durable backlog kinds. */
export const simulationCapacityKindSchema = z.enum(['events', 'interactions'])
/** Stable run-local administrative capacity addition identity. */
export const simulationCapacityGrantIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationCapacityGrantId'>)
/** Explicit permanent capacity addition; exact retries do not grow the limit twice. */
export const simulationCapacityGrantRequestSchema = z.strictObject({ id: simulationCapacityGrantIdSchema,
  capacity: simulationCapacityKindSchema, amount: z.number().int().positive(), reason: z.string().trim().min(1) })
/** Capacity addition identity. */
export type SimulationCapacityGrantId = z.infer<typeof simulationCapacityGrantIdSchema>
/** Durable backlog kind. */
export type SimulationCapacityKind = z.infer<typeof simulationCapacityKindSchema>
/** Administrative capacity addition. */
export type SimulationCapacityGrantRequest = z.infer<typeof simulationCapacityGrantRequestSchema>
/** Events include pending/claimed wakes; unresolved accepted interactions remain charged. */
export interface SimulationQueueUsage {
  readonly events: { readonly used: number; readonly limit: number }
  readonly interactions: { readonly used: number; readonly limit: number }
}
