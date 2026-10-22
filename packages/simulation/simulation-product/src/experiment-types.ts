/** Public experiment DTOs contain references and bounded results, never archive contents or Host capabilities. */
import type { z } from 'zod'
import type { simulationProductExperimentSourceSchema, simulationProductWorldBranchInputSchema,
  simulationProductWorldBranchReadInputSchema, simulationProductWorldBranchResultSchema, simulationProductWorldCausalInputSchema,
  simulationProductWorldCausalResultSchema, simulationProductWorldCompareInputSchema, simulationProductWorldCompareResultSchema } from './experiment-schema.ts'
/** Immutable completed retention source. */
export type SimulationProductExperimentSource = z.infer<typeof simulationProductExperimentSourceSchema>
/** Exact original branch command. */
export type SimulationProductWorldBranchInput = z.infer<typeof simulationProductWorldBranchInputSchema>
/** Read the original command outcome. */
export type SimulationProductWorldBranchReadInput = z.infer<typeof simulationProductWorldBranchReadInputSchema>
/** Paused branch discovery and explicit memory policy. */
export type SimulationProductWorldBranchResult = z.infer<typeof simulationProductWorldBranchResultSchema>
/** Bounded authenticated causal traversal. */
export type SimulationProductWorldCausalInput = z.infer<typeof simulationProductWorldCausalInputSchema>
/** Actual event references and explicit unknown coverage. */
export type SimulationProductWorldCausalResult = z.infer<typeof simulationProductWorldCausalResultSchema>
/** Two observations of the same recorded parent cut. */
export type SimulationProductWorldCompareInput = z.infer<typeof simulationProductWorldCompareInputSchema>
/** Bounded differences with separate nondeterminism and unavailable quality/cost. */
export type SimulationProductWorldCompareResult = z.infer<typeof simulationProductWorldCompareResultSchema>
