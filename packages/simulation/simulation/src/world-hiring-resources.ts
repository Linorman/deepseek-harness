/** Closed, explicitly authored one-time hiring charges; no implicit minting, payroll or model-selected prices. */
import { z } from 'zod'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationResourceIdSchema, simulationQuantitySchema, simulationGrantIdSchema } from './resource.ts'
import { simTimeSchema } from './time.ts'
import type { Branded } from '@clocky/clocky-brand'
import { SimulationWorldError } from './world-errors.ts'

/** Immutable installed hiring charge identity, separate from the hiring case or account. */
export type SimulationHiringFeePolicyId = Branded<'SimulationHiringFeePolicyId'>
/** Strict policy identity retained with the complete frozen fee quote. */
export const simulationHiringFeePolicyIdSchema = z.string().min(1).max(256)
  .transform(value => value as SimulationHiringFeePolicyId)
/** Exact Native-enforced fee terms; only the actual requester or its exact one-use grants can authorize funds. */
export const simulationHiringFeePolicySchema = z.strictObject({
  id: simulationHiringFeePolicyIdSchema,
  version: z.string().min(1),
  policyRef: z.literal('clocky.organization.hiring-fee/1'),
  operation: z.enum(['generate-and-hire', 'hire-existing']),
  positionEntityId: simulationEntityIdSchema,
  from: simulationResourceIdSchema,
  to: simulationResourceIdSchema,
  unit: z.string().min(1),
  quantity: simulationQuantitySchema.refine(value => BigInt(value) > 0n, 'A hiring charge must be positive'),
  grants: z.array(simulationGrantIdSchema).refine(values => new Set(values).size === values.length, 'Fee grants must be distinct'),
  reservationPeriod: simTimeSchema.refine(value => BigInt(value) > 0n, 'Fee validity requires a positive simulated period'),
}).refine(value => value.from !== value.to, 'Hiring payment requires distinct existing debit and credit accounts')
/** Strict frozen financial terms supplied by the scene, never director rationale. */
export type SimulationHiringFeePolicy = z.infer<typeof simulationHiringFeePolicySchema>

/** Stable financial blocker; consumers never classify a fee failure from prose. */
export type SimulationHiringResourceFailure = 'authority' | 'insufficient' | 'history-limit' | 'stale' | 'expired' | 'deadline'
/** Native-owned fee classification under the existing World error contract. */
export class SimulationHiringResourceError extends SimulationWorldError {
  /** Exact original resource precondition that prevents this hire. */
  readonly resourceFailure: SimulationHiringResourceFailure
  /** @param failure - Current exact funding precondition, rather than a model-selected explanation. */
  constructor(failure: SimulationHiringResourceFailure) {
    super(failure === 'authority' ? 'SIM_WORLD_AUTHORITY' : 'SIM_WORLD_CONFLICT', `Hiring resource precondition: ${failure}`)
    this.resourceFailure = failure
    this.name = 'SimulationHiringResourceError'
  }
}
