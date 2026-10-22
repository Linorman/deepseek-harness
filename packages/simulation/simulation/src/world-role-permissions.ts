/** Scenario-owned role permissions are independent from mutable personnel state and identity allocation. */
import { z } from 'zod'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationWorldDomainSelectorSchema } from './world-domain.ts'

/** Only permissions declared before run creation may follow a target position; a model cannot select new authority. */
export const personnelPositionPermissionSchema = z.strictObject({ positionEntityId: simulationEntityIdSchema,
  permissions: z.array(z.strictObject({ ...simulationWorldDomainSelectorSchema.shape, targetEntityId: simulationEntityIdSchema,
    scopeEntityId: simulationEntityIdSchema, relation: z.string().min(1) })).max(64) })
