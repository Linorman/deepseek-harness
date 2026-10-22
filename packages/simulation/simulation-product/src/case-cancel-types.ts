/** Actor-free original World case cancellation; Native owns its race with hiring and cleanup. */
import type { WorldRequestId } from '@clocky/clocky-simulation/world-types'
import type { SimulationProductCommandId } from './administration-types.ts'
import type { SimulationProductRunId } from './types.ts'

/** Original intent selects a case, without claiming that it is still cancellable or replacing its plan. */
export interface SimulationProductWorldCaseCancelInput {
  readonly runId: SimulationProductRunId
  readonly commandId: SimulationProductCommandId
  readonly requestId: WorldRequestId
  /** Native prefix and hash shown at confirmation; exact retries keep this original quote. */
  readonly previewRevision: number
  readonly previewHash: string
}
