/** Exact single-hire committee approval; a policy-enactment resolution is never a hiring approval. */
import type { z } from 'zod'
import type { simulationHireApprovalTargetSchema, simulationHireApprovalBasisSchema } from './world-hire-approval.ts'

/** Frozen original hiring case, norm version and finite Persona selection approved by the committee. */
export type SimulationHireApprovalTarget = z.infer<typeof simulationHireApprovalTargetSchema>
/** Original passed resolution and enforced norm versions retained at reservation for commit revalidation. */
export type SimulationHireApprovalBasis = z.infer<typeof simulationHireApprovalBasisSchema>
