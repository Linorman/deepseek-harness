/** Versioned deterministic cognition policies and retained results. @module @clocky/clocky-simulation/deterministic */
import { z } from 'zod'
import type { Branded } from '@clocky/clocky-brand'
import type { SimulationContextViewEventData } from '@clocky/clocky-session/types'
import type { SimulationProposal } from './business-types.ts'

/** Stable registered policy identity. */
export const simulationPolicyIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationPolicyId'>)
/** Exact policy generation selected before deterministic computation. */
export const simulationPolicyRefSchema = z.strictObject({ id: simulationPolicyIdSchema, version: z.string().min(1) })
/** Registered policy identity. */
export type SimulationPolicyId = z.infer<typeof simulationPolicyIdSchema>
/** Immutable policy generation. */
export type SimulationPolicyRef = z.infer<typeof simulationPolicyRefSchema>
/**
 * Trusted plugin computation over a detached, frozen authorized view. Implementations must be bounded, synchronous,
 * deterministic and free of IO; they receive no run, Agent, model or world-mutation capability.
 */
export interface SimulationDeterministicPolicy extends SimulationPolicyRef {
  /**
   * Compute proposed actions without executing effects or mutating the view.
   * @param view - Exact authorized context retained for this decision.
   * @returns complete proposals, subsequently checked by the ordinary admission and business-operation owners.
   */
  decide(this: void, view: Readonly<SimulationContextViewEventData>): readonly SimulationProposal[]
}
/** Chosen generation and optional completed output; neither can change on retry. */
export interface SimulationDeterministicDecision {
  readonly policy: SimulationPolicyRef
  readonly proposals?: readonly SimulationProposal[]
}
