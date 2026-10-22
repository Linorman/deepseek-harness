/** Browser-safe generation inputs and original-result views. */
import type { z } from 'zod'
import type { simulationProductGenerationReadSchema, simulationProductGenerationRequestSchema,
  simulationProductGenerationTransitionSchema, simulationProductGenerationResultSchema,
  simulationProductGenerationPersonaDraftSchema } from './generation-schema.ts'
/** Original job lookup and explicit execution selection. */
export type SimulationProductGenerationRead = z.infer<typeof simulationProductGenerationReadSchema>
/** Human-authored request under the original runtime and organization scope. */
export type SimulationProductGenerationRequest = z.infer<typeof simulationProductGenerationRequestSchema>
/** Finite review/cancel/incorporate transition without provider authority. */
export type SimulationProductGenerationTransition = z.infer<typeof simulationProductGenerationTransitionSchema>
/** Bounded retained private original. */
export type SimulationProductGenerationResult = z.infer<typeof simulationProductGenerationResultSchema>
/** Existing A2 review placement for a retained validated Persona. */
export type SimulationProductGenerationPersonaDraft = z.infer<typeof simulationProductGenerationPersonaDraftSchema>
