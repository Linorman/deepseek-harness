/** Browser-safe original mediation records. Execution and publication remain Native-owned. */
import type { z } from 'zod'
import type { simulationExternalMediatedRequestSchema, simulationExternalMediatedPlanSchema,
  simulationExternalAdjudicatedOutcomeSchema, simulationExternalAdjudicationSchema,
  simulationExternalMediatedPolicyParametersSchema, simulationExternalMediatedEffectSchema,
  simulationExternalAdjudicatedEventStateSchema } from './world-external-mediated.ts'

/** Strict request with original stable identity, policy and bounded response/disclosure scope. */
export type SimulationExternalMediatedRequest = z.infer<typeof simulationExternalMediatedRequestSchema>
/** Complete original model/policy proposal; no current resources, Actor IDs or sender may be supplied. */
export type SimulationExternalMediatedPlan = z.infer<typeof simulationExternalMediatedPlanSchema>
/** Closed environmental outcome, distinct from authorization and actual external observations. */
export type SimulationExternalAdjudicatedOutcome = z.infer<typeof simulationExternalAdjudicatedOutcomeSchema>
/** Immutable actual source and checked original proposal. */
export type SimulationExternalAdjudication = z.infer<typeof simulationExternalAdjudicationSchema>
/** Frozen explicit policy resolution input. */
export type SimulationExternalMediatedPolicyParameters = z.infer<typeof simulationExternalMediatedPolicyParametersSchema>
/** Domain projection capability; original Native source selects the proposal and outcome. */
export type SimulationExternalMediatedEffect = z.infer<typeof simulationExternalMediatedEffectSchema>
/** Retained finite event responsibility including blocks and its sole actual consumption. */
export type SimulationExternalAdjudicatedEventState = z.infer<typeof simulationExternalAdjudicatedEventStateSchema>
