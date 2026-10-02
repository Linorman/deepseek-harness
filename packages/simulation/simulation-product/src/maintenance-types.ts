/** Original checkpoint/recovery requests and scoped external inputs, without private run configuration. */
import type { SimulationCheckpointId, SimulationEntityId, SimulationDecisionId } from '@clocky/clocky-simulation/identities'
import type { SimulationIngressId, SimulationEventId } from '@clocky/clocky-simulation/identities'
import type { SimTime } from '@clocky/clocky-simulation/time-types'
import type { SimulationProductRunId } from './types.ts'
import type { SimulationProductCommandId } from './administration-types.ts'

/** Capture an original full checkpoint; identity and collector bounds are derived by the Host. */
export interface SimulationProductCheckpointInput {
  readonly runId: SimulationProductRunId
  readonly commandId: SimulationProductCommandId
}
/** Verify retained history and suffix against one full checkpoint; this never requests rollback or inference. */
export interface SimulationProductRestoreInput extends SimulationProductCheckpointInput {
  readonly checkpointId: SimulationCheckpointId
}
/** Attributed single-entity input; the authenticated Host supplies its source, never additional world authority. */
export interface SimulationProductIngressInput {
  readonly runId: SimulationProductRunId
  readonly ingressId: SimulationIngressId
  readonly entityId: SimulationEntityId
  readonly text: string
  readonly availableAt: SimTime
}
/** Exact original receipt query; does not resubmit input or resume scheduling. */
export interface SimulationProductIngressQuery {
  readonly runId: SimulationProductRunId
  readonly ingressId: SimulationIngressId
}
/** Assignment and consumption are separate durable facts; private input text and author identity are omitted. */
export interface SimulationProductIngressReceipt {
  readonly runId: SimulationProductRunId
  readonly ingressId: SimulationIngressId
  readonly entityId: SimulationEntityId
  readonly eventId: SimulationEventId
  readonly availableAt: SimTime
  readonly assignedAt: SimTime
  readonly sequence: number
  readonly status: 'pending' | 'claimed' | 'consumed' | 'cancelled'
  readonly decisionId?: SimulationDecisionId | undefined
}
/** Absence does not establish transport failure or permit a new input identity. */
export type SimulationProductIngressResult = { readonly runId: SimulationProductRunId; readonly ingressId: SimulationIngressId } & (
  | { readonly status: 'not-found' }
  | { readonly status: 'found'; readonly receipt: SimulationProductIngressReceipt }
)
