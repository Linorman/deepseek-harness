/** Fixed multi-actor decision windows and their explicit context inputs. @module @clocky/clocky-simulation/window */
import { z } from 'zod'
import { simulationPolicyRefSchema } from './deterministic.ts'
import type { Branded } from '@clocky/clocky-brand'
import { simulationContextRequestSchema } from './context.ts'
import { simulationDecisionIdSchema } from './business.ts'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationEventIdSchema } from './scheduler.ts'

/** Stable run-local window identity. */
export const simulationWindowIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationWindowId'>)
/** Ordered actors and authorized inputs frozen together before inference. */
export const simulationWindowRequestSchema = z.strictObject({
  id: simulationWindowIdSchema,
  decisions: z.array(z.strictObject({ id: simulationDecisionIdSchema, entityId: simulationEntityIdSchema,
    wakeId: simulationEventIdSchema.optional(), policy: simulationPolicyRefSchema.optional(),
    context: simulationContextRequestSchema })).min(1)
    .refine(values => new Set(values.map(value => value.id)).size === values.length
      && new Set(values.map(value => value.entityId)).size === values.length, 'A window requires distinct decisions and actors'),
})
/** Stable window identity. */
export type SimulationWindowId = z.infer<typeof simulationWindowIdSchema>
/** Complete ordered window opening request. */
export type SimulationWindowRequest = z.infer<typeof simulationWindowRequestSchema>
