/** Serialized management request lifecycle and immutable retry outcomes. @module @clocky/clocky-simulation-local/management */
import { z } from 'zod'
import { simulationManagementIdSchema, simulationPhaseManagementRequestSchema, simulationTokenCount, budgetUsage } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationManagementOperation } from '@clocky/clocky-simulation'

/** Start and terminal outcome records owned by the run coordinator. */
export const managementRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('management/started'), request: simulationPhaseManagementRequestSchema }),
  z.strictObject({ kind: z.literal('management/completed'), id: simulationManagementIdSchema }),
  z.strictObject({ kind: z.literal('management/failed'), id: simulationManagementIdSchema, error: z.string().min(1) }),
])
/** Parsed management lifecycle transition. */
export type ManagementRecord = z.infer<typeof managementRecordSchema>
/** Validate the exact acknowledgement against its original complete usage and paused prefix.
 * @param state - Serialized current Native prefix.
 * @param quote - User-reviewed original amount and any necessary interval addition.
 */
export function validateTokenRecovery(state: SimulationSnapshot, quote: import('@clocky/clocky-simulation').SimulationTokenRecovery): void {
  const original = state.tokenReservations?.[quote.reservationId]
  const usage = original === undefined ? undefined : budgetUsage(state, original.interval).tokens
  if (state.phase !== 'paused' || Object.values(state.decisions).some(value => value.status === 'open' || value.status === 'submitted')
    || original?.status !== 'settled' || original.usage === undefined || original.overrunAcknowledged !== false
    || quote.reserved !== original.reserved || quote.used !== simulationTokenCount(original.usage)
    || quote.interval !== original.interval || usage === undefined || quote.additionalTokens !== Math.max(0, usage.used - usage.limit))
    throw new Error('Token recovery quote changed or the original request is not settled and paused')
}
/**
 * Inspect the sole pending management request before admitting another phase command.
 * @param state - Current durable run facts.
 * @returns pending request or undefined.
 */
export function pendingManagement(state: SimulationSnapshot): SimulationManagementOperation | undefined {
  return Object.values(state.management ?? {}).find(operation => operation.status === 'in-progress')
}
/**
 * Preserve immutable request identity and one terminal result through replay.
 * @param state - Previous run projection.
 * @param record - Validated management transition.
 * @param sequence - New durable event position.
 * @returns updated management history.
 */
export function foldManagement(state: SimulationSnapshot, record: ManagementRecord, sequence: number): SimulationSnapshot {
  if (record.kind === 'management/started') {
    if (record.request.tokenRecovery !== undefined) validateTokenRecovery(state, record.request.tokenRecovery)
    if (Object.hasOwn(state.management ?? {}, record.request.id) || pendingManagement(state) !== undefined
      || record.request.phase !== 'paused' && Object.values(state.checkpoints ?? {}).some(value => value.status === 'in-progress')) {
      throw new Error('Simulation management request already exists or another request is pending')
    }
    return { ...state, management: { ...state.management, [record.request.id]: {
      request: record.request, startedSequence: sequence, status: 'in-progress',
    } } }
  }
  const management = state.management ?? {}
  const operation = Object.hasOwn(management, record.id) ? management[record.id] : undefined
  if (operation?.status !== 'in-progress') throw new Error('Simulation management outcome has no pending request')
  if (record.kind === 'management/completed' && state.phase !== operation.request.phase) {
    throw new Error('Simulation management completion does not match the requested phase')
  }
  if (record.kind === 'management/completed' && operation.request.tokenRecovery !== undefined) {
    const quote = operation.request.tokenRecovery
    const reservation = state.tokenReservations?.[quote.reservationId]
    const grant = Object.values(state.budgetGrants ?? {}).find(value => value.id === `token-recovery:${record.id}`)
    if (reservation?.overrunAcknowledged !== true || reservation.reserved !== quote.reserved || reservation.usage === undefined
      || simulationTokenCount(reservation.usage) !== quote.used || reservation.interval !== quote.interval
      || quote.additionalTokens > 0 && (grant?.amount !== quote.additionalTokens || grant.interval !== quote.interval || grant.budget !== 'tokens'))
      throw new Error('Token recovery completion lost its original acknowledgement or interval addition')
  }
  const finished: SimulationManagementOperation = record.kind === 'management/completed'
    ? { ...operation, status: 'completed', finishedSequence: sequence }
    : { ...operation, status: 'failed', finishedSequence: sequence, error: record.error }
  return { ...state, management: { ...state.management, [record.id]: finished } }
}
