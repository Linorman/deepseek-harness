/** Persistent maintenance identities without run implementation or Cordis declarations. */
import type { Branded } from '@clocky/clocky-brand'

/** Durable maintenance identity, separate from phase-management command identities. */
export type SimulationMaintenanceId = Branded<'SimulationMaintenanceId'>
/** Original trusted owner request reused for every transition and recovery. */
export interface SimulationMaintenanceRequest {
  readonly id: SimulationMaintenanceId
  readonly owner: string
}
