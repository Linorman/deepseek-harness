/** Trusted finite task workflows over the prepared actors; browser inputs cannot supply these routes. */
import { z } from 'zod'
import { simulationEntityIdSchema, simulationChannelKeySchema } from '@clocky/clocky-simulation'
import { simulationScenarioTopologySchema, resolveScenarioTopology, preparedScenarioRoute } from './scenario-topology.ts'

/** A report step can publish only Simulation communication, and completes from recipient persistence. */
export const simulationTaskScenarioSchema = z.strictObject({
  kind: z.literal('task-workflow'), version: z.literal('1'),
  topology: simulationScenarioTopologySchema.optional(),
  steps: z.array(z.strictObject({
    id: z.string().trim().min(1).max(128),
    sourceEntityId: simulationEntityIdSchema, entityId: simulationEntityIdSchema,
    recipientEntityId: simulationEntityIdSchema, channelKey: simulationChannelKeySchema,
    reviewerEntityId: simulationEntityIdSchema.optional(),
    subject: z.string().trim().min(1), description: z.string().trim().min(1), text: z.string().trim().min(1),
    cognition: z.literal('deterministic'), leaseDurationMs: z.number().int().positive(),
    maxAttempts: z.number().int().positive(), retry: z.enum(['never', 'before-effects']),
  })).min(1).max(64),
}).refine(value => new Set(value.steps.map(step => step.id)).size === value.steps.length,
  'Task workflow step identities must be unique')
  .refine(value => value.steps.every(step => step.entityId !== step.recipientEntityId
    && step.entityId !== step.reviewerEntityId), 'Task executors cannot receive or review their own report')
  .refine((value) => {
    if (value.topology !== undefined && !simulationScenarioTopologySchema.safeParse(value.topology).success) return false
    const topology = resolveScenarioTopology({ buyerName: 'Buyer', supplierName: 'Supplier', topology: value.topology })
    return value.steps.every(step => preparedScenarioRoute(topology, step))
  }, 'Workflow routes require prepared actors and exact report channel membership')
/** Immutable installed report workflow; version changes require another supported generation. */
export type SimulationTaskScenario = z.infer<typeof simulationTaskScenarioSchema>
/** One exact source, executor, recipient and optional human review route. */
export type SimulationTaskScenarioStep = SimulationTaskScenario['steps'][number]

/**
 * Persisted create decisions identify a step independently of task titles or browser fields.
 * @param index - Zero-based position in the immutable installed workflow.
 * @returns native creation decision prefix owned by that step.
 */
export function taskScenarioPrefix(index: number): string { return `task-workflow/1/${index}/create/` }
