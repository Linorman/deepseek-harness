/** Opaque identities shared by generation commands and their consumers. */
import { z } from 'zod'
import type { Branded } from '@clocky/clocky-brand'

/** Original run-local generation command identity. */
export type SimulationGenerationJobId = Branded<'SimulationGenerationJobId'>
/** Original run-local bounded planner assignment identity. */
export type SimulationPlannerAssignmentId = Branded<'SimulationPlannerAssignmentId'>
/** Parse a generation identity without changing its wire representation. */
export const simulationGenerationJobIdSchema = z.string().min(1).max(256).transform(value => value as SimulationGenerationJobId)
/** Parse a planner identity without changing its wire representation. */
export const simulationPlannerAssignmentIdSchema = z.string().min(1).max(256).transform(value => value as SimulationPlannerAssignmentId)
