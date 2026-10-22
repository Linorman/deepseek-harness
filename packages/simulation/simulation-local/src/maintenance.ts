/** Exclusive maintenance records without external IO. @module @clocky/clocky-simulation-local/maintenance */
import { z } from 'zod'
import { activeSimulationMaintenance, SimulationMaintenanceError, simulationMaintenanceRequestSchema,
  simulationResidentSlots } from '@clocky/clocky-simulation'
import type { SimulationMaintenanceOperation, SimulationSnapshot } from '@clocky/clocky-simulation'

/** Every transition retains and revalidates its complete original owner request. */
export const maintenanceRecordSchema = z.strictObject({
  request: simulationMaintenanceRequestSchema,
  status: z.enum(['draining', 'quiescent', 'completed']),
})
/** Validated durable maintenance transition. */
export type MaintenanceRecord = z.infer<typeof maintenanceRecordSchema>

function assertQuiescent(state: SimulationSnapshot): void {
  if (state.phase !== 'paused' || state.activeWindowId !== undefined || state.activeDecisionId !== undefined
    || simulationResidentSlots(state).used !== 0
    || Object.values(state.operations).some(operation => operation.outbox?.attempts.at(-1)?.outcome === 'in-flight')) {
    throw new SimulationMaintenanceError('SIM_MAINTENANCE_NOT_QUIESCENT',
      'Simulation maintenance requires paused scheduling, closed decisions, released writers and settled publication IO')
  }
}
/**
 * Validate the sole owner, immutable request and ordered state transitions before publication.
 * @param state - Projection before the append.
 * @param record - Parsed transition; exact retry handling belongs to the run queue.
 * @param sequence - Contiguous journal sequence of this transition.
 * @returns a new projection with the maintenance history; scheduling never resumes here.
 */
export function foldMaintenance(state: SimulationSnapshot, record: MaintenanceRecord, sequence: number): SimulationSnapshot {
  const history = state.maintenance ?? {}
  const prior = Object.hasOwn(history, record.request.id) ? history[record.request.id] : undefined
  let operation: SimulationMaintenanceOperation
  if (record.status === 'draining') {
    if (prior !== undefined || activeSimulationMaintenance(state) !== undefined
      || Object.values(state.checkpoints ?? {}).some(value => value.status === 'in-progress')
      || Object.values(state.management ?? {}).some(value => value.status === 'in-progress')) {
      throw new SimulationMaintenanceError('SIM_MAINTENANCE_CONFLICT', 'Simulation maintenance owner is occupied or another control request is pending')
    }
    operation = { request: record.request, startedSequence: sequence, status: 'draining' }
  } else {
    if (prior === undefined || prior.request.owner !== record.request.owner || prior.status === 'completed'
      || record.status === 'quiescent' && prior.status !== 'draining'
      || record.status === 'completed' && prior.status !== 'quiescent') {
      throw new SimulationMaintenanceError('SIM_MAINTENANCE_CONFLICT', 'Simulation maintenance transition has no matching original owner')
    }
    assertQuiescent(state)
    if (record.status === 'completed' && Object.values(state.world?.reservations ?? {}).some(reservation =>
      reservation.request.maintenance.id === record.request.id && reservation.request.maintenance.owner === record.request.owner
      && reservation.status !== 'candidate' && reservation.status !== 'committed' && reservation.status !== 'abandoned')) {
      throw new SimulationMaintenanceError('SIM_MAINTENANCE_NOT_QUIESCENT', 'World maintenance retains unresolved preparation or cancellation responsibility')
    }
    if (record.status === 'completed' && Object.values(state.world?.reservations ?? {}).some(reservation =>
      reservation.candidate?.maintenance.id === record.request.id && reservation.candidate.maintenance.owner === record.request.owner
      && reservation.status !== 'committed' && reservation.status !== 'abandoned'))
      throw new SimulationMaintenanceError('SIM_MAINTENANCE_NOT_QUIESCENT', 'Candidate commit retains its original hiring obligation')
    if (record.status === 'completed' && Object.values(state.world?.external.representatives ?? {}).some(value =>
      value.request.maintenance.id === record.request.id && value.request.maintenance.owner === record.request.owner
      && value.status !== 'committed' && value.status !== 'abandoned'))
      throw new SimulationMaintenanceError('SIM_MAINTENANCE_NOT_QUIESCENT', 'External maintenance retains original identity or cleanup responsibility')
    if (record.status === 'completed' && Object.values(state.world?.external.contacts ?? {}).some(value =>
      value.cancellation?.maintenance.id === record.request.id && value.cancellation.maintenance.owner === record.request.owner
      && value.status !== 'cancelled'))
      throw new SimulationMaintenanceError('SIM_MAINTENANCE_NOT_QUIESCENT', 'Contact maintenance retains original conversation cleanup responsibility')
    if (record.status === 'completed' && Object.values(state.world?.personnel.reservations ?? {}).some(reservation =>
      reservation.request.maintenance.id === record.request.id && reservation.request.maintenance.owner === record.request.owner
      && reservation.status !== 'committed' && reservation.status !== 'cancelled'))
      throw new SimulationMaintenanceError('SIM_MAINTENANCE_NOT_QUIESCENT', 'Personnel maintenance retains its original disposition or cancellation responsibility')
    operation = record.status === 'quiescent'
      ? { ...prior, status: 'quiescent', quiescentSequence: sequence }
      : { ...prior, status: 'completed', quiescentSequence: (prior as Extract<SimulationMaintenanceOperation, { status: 'quiescent' }>).quiescentSequence,
        finishedSequence: sequence }
  }
  return { ...state, maintenance: { ...history, [record.request.id]: operation } }
}

/**
 * Check retained transition order and the relationship between a quiescent owner and execution state.
 * @param state - Complete published or replayed projection.
 */
export function assertMaintenanceProjection(state: SimulationSnapshot): void {
  let active = 0
  for (const [id, operation] of Object.entries(state.maintenance ?? {})) {
    if (id !== operation.request.id || operation.startedSequence < 1 || operation.startedSequence > state.revision
      || operation.status !== 'draining' && (operation.quiescentSequence <= operation.startedSequence || operation.quiescentSequence > state.revision)
      || operation.status === 'completed' && (operation.finishedSequence <= operation.quiescentSequence || operation.finishedSequence > state.revision)) {
      throw new Error('Simulation maintenance history has inconsistent identities or transition order')
    }
    if (operation.status !== 'completed') active += 1
    if (operation.status === 'quiescent') assertQuiescent(state)
  }
  if (active > 1) throw new Error('Simulation run retains more than one active maintenance owner')
}
