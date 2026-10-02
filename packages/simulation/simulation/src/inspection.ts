/** Trusted native inspection observes existing runs without acquiring execution ownership. */
import { z } from 'zod'
import { simulationRunSpecSchema } from './schema.ts'
import type { SimulationRunSpec, SimulationSnapshot } from './types.ts'

/** Deployment-resolved provider and immutable expected run configuration. */
export interface SimulationInspectionSelection {
  readonly provider: string
  readonly spec: SimulationRunSpec
  /** Include validated original journal entries for trusted source inspection; never a public transport flag. */
  readonly includeRecords?: boolean | undefined
}

/** Owner status is an observation, never permission to take over or execute. */
export type SimulationOwnerObservation = 'this-provider' | 'unowned' | 'other-owner' | 'unavailable'

/** Detached authoritative history; native consumers own authorization and public redaction. */
export interface SimulationRunObservation {
  readonly snapshot: SimulationSnapshot
  readonly owner: SimulationOwnerObservation
  /** Complete validated history within provider inspection allowances; absent unless explicitly requested. */
  readonly records?: readonly { readonly sequence: number; readonly value: unknown }[] | undefined
}

/** Parse immutable inspection selection without accepting create/open or filesystem flags. */
export const simulationInspectionSelectionSchema = z.object({ provider: z.string().trim().min(1), spec: simulationRunSpecSchema,
  includeRecords: z.boolean().optional() })
  .strict() satisfies z.ZodType<SimulationInspectionSelection>
