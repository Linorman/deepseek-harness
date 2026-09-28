/** Durable simulation-interval budgets and explicit administrative additions. @module @clocky/clocky-simulation/budget */
import { z } from 'zod'
import type { Branded } from '@clocky/clocky-brand'
import { simTimeSchema } from './time.ts'

/** Independent decision, accepted-message and model-token accounting. */
export const simulationBudgetKindSchema = z.enum(['decisions', 'messages', 'tokens'])
/** Run-local retry identity for an administrative budget addition. */
export const simulationBudgetGrantIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationBudgetGrantId'>)
/** Explicit additional capacity for one interval; it never resets consumed work. */
export const simulationBudgetGrantRequestSchema = z.strictObject({
  id: simulationBudgetGrantIdSchema, interval: simTimeSchema, budget: simulationBudgetKindSchema,
  amount: z.number().int().positive(), reason: z.string().trim().min(1),
})
/** Run-local budget addition identity. */
export type SimulationBudgetGrantId = z.infer<typeof simulationBudgetGrantIdSchema>
/** Administrative, idempotent budget addition. */
export type SimulationBudgetGrantRequest = z.infer<typeof simulationBudgetGrantRequestSchema>
/** Independently charged budget kind. */
export type SimulationBudgetKind = z.infer<typeof simulationBudgetKindSchema>
/** Current interval totals, including grants and held model reservations. */
export interface SimulationBudgetUsage {
  readonly interval: z.infer<typeof simTimeSchema>
  readonly decisions: { readonly used: number; readonly limit: number }
  readonly tokens: { readonly used: number; readonly limit: number }
  readonly messages: { readonly used: number; readonly limit: number }
}
