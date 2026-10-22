/** Public user-command contracts, without runtime authority or credential serialization. */
import type { z } from 'zod'
import type { simulationWorldManagementActionSchema, simulationWorldManagementPreviewRequestSchema,
  simulationWorldManagementSubmitRequestSchema, simulationWorldManagementPreviewSchema, simulationWorldManagementImpactSchema,
  simulationWorldManagementAdmissionSchema, simulationWorldManagementReceiptSchema } from './world-management.ts'
import type { SimulationWorldAuthenticatedUserSource, SimulationWorldManagementFundingAuthority } from './world-management-source.ts'
export type { WorldManagementCommandId, SimulationWorldAuthenticatedUserSource, SimulationWorldManagementFundingAuthority } from './world-management-source.ts'
/** One of the three installed personnel management families. */
export type SimulationWorldManagementAction = z.infer<typeof simulationWorldManagementActionSchema>
/** Explicit prefix used by a read-only preview. */
export type SimulationWorldManagementPreviewRequest = z.infer<typeof simulationWorldManagementPreviewRequestSchema>
/** Caller-retained exact original input. */
export type SimulationWorldManagementSubmitRequest = z.infer<typeof simulationWorldManagementSubmitRequestSchema>
/** Actual Native identity and role impacts; never proposed replacement identities. */
export type SimulationWorldManagementImpact = z.infer<typeof simulationWorldManagementImpactSchema>
/** Bounded actual dependencies and blockers. */
export type SimulationWorldManagementPreview = z.infer<typeof simulationWorldManagementPreviewSchema>
/** Retained original preview and authorization commitment. */
export type SimulationWorldManagementAdmission = z.infer<typeof simulationWorldManagementAdmissionSchema>
/** Original acceptance and current business/callback facts. */
export type SimulationWorldManagementReceipt = z.infer<typeof simulationWorldManagementReceiptSchema>
/** Live trusted policy resolution, supplied beside the parsed user input and never by the transport payload. */
export interface SimulationWorldManagementAdmissionAuthority {
  readonly source: Omit<SimulationWorldAuthenticatedUserSource, 'commandId' | 'time'>
  readonly actionHash: string
  readonly sourceFingerprint: string
  readonly sourceComplete: boolean
  readonly funding: SimulationWorldManagementFundingAuthority | null
}
/** Runtime-only revocable authorization; implementations perform no IO or inference in the Native queue. */
export interface SimulationWorldManagementAuthority {
  /** Re-resolve current authentication, exact action, source cut and policy; undefined rejects fresh acceptance. */
  resolve(): SimulationWorldManagementAdmissionAuthority | undefined
}
