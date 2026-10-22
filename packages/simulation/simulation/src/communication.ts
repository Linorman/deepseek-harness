import { assertSimulationStopTime } from './run-control.ts'
/** Canonical simulation addressing shared by proposal validation and final acceptance. */
import type { SimulationSnapshot } from './types.ts'
import type { SimulationEntityId } from './entity-types.ts'
import type { SimulationOperationAction } from './business-types.ts'

/** A model-correctable message precondition, distinct from storage or infrastructure failure. */
export class SimulationCommunicationError extends Error {
  /** @param code - Stable message rejection category. @param message - Bounded correction guidance without private message text. */
  constructor(readonly code: 'SIM_MESSAGE_RECIPIENT_INVALID' | 'SIM_MESSAGE_TIME_INVALID', message: string) { super(message) }
}

/**
 * Validate simulation entity addressing without applying effects or translating Participant IDs.
 * @param state - Current authoritative Native prefix; final acceptance must check again after staging.
 * @param senderId - Actual decision owner.
 * @param action - Parsed communication proposal.
 * @throws SimulationCommunicationError for an invalid time or missing/cross-Team canonical binding.
 */
export function validateSimulationCommunication(state: SimulationSnapshot, senderId: SimulationEntityId,
  action: Extract<SimulationOperationAction, { kind: 'communication/post' }>): void {
  assertSimulationStopTime(state, action.deliverAt)
  if (BigInt(action.deliverAt) < BigInt(state.time) || BigInt(action.deliverAt) > BigInt(state.spec.maxTime))
    throw new SimulationCommunicationError('SIM_MESSAGE_TIME_INVALID', 'deliverAt must be between the current simulation time and its horizon')
  const sender = state.entities[senderId]
  const recipient = Object.hasOwn(state.entities, action.recipient) ? state.entities[action.recipient] : undefined
  if (sender?.binding === undefined || recipient?.binding === undefined || sender.binding.teamId !== recipient.binding.teamId)
    throw new SimulationCommunicationError('SIM_MESSAGE_RECIPIENT_INVALID',
      'recipient must be a simulation Entity ID with a canonical binding in this Team; use replyTarget.entityId, not its Participant ID')
}
