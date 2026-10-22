/** Public numeric budget diagnostics derived from the retained Native prefix. */
import { budgetUsage, simulationTokenCount } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import type { SimulationProductControl } from './control-types.ts'

/**
 * Project a complete original overrun quote without acknowledging it or attaching actors.
 * @param state - Observed Native prefix.
 * @param held - Whether this provider holds the scheduling owner.
 * @param inFlight - Whether owned work still needs to settle.
 * @returns numeric diagnostics and explicit recovery preconditions.
 */
export function tokenDiagnostics(state: SimulationSnapshot, held: boolean, inFlight: boolean):
Pick<SimulationProductControl, 'tokenRecovery' | 'requestBudget'> {
  const reservation = Object.values(state.tokenReservations ?? {}).find(value => value.overrunAcknowledged === false)
  const block = state.stall?.code === 'SIM_REQUEST_BUDGET_EXCEEDED' ? state.decisions[state.stall.decisionId] : undefined
  const requestBudget = block?.requestBudgetBlock === undefined ? {} : {
    requestBudget: { ...block.requestBudgetBlock, decisionId: block.id } }
  const usage = reservation?.usage ?? reservation?.observedUsage
  if (reservation === undefined || usage === undefined) return requestBudget
  const budget = budgetUsage(state, reservation.interval).tokens
  const reason = !held ? 'ownership-unavailable' : state.phase !== 'paused' ? 'pause-required'
    : inFlight || Object.values(state.decisions).some(value => value.status === 'open' || value.status === 'submitted') ? 'in-flight'
      : reservation.status !== 'settled' || reservation.usage === undefined ? 'unknown-usage' : 'ready'
  return { ...requestBudget, tokenRecovery: { request: { reservationId: reservation.id, reserved: reservation.reserved,
    used: simulationTokenCount(usage), interval: reservation.interval, additionalTokens: Math.max(0, budget.used - budget.limit) },
  allowed: reason === 'ready', reason } }
}

/**
 * Map the owner's bounded numeric token facts using the same explicit recovery requirements.
 * @param state - Current Native control facts, without Session or decision bodies.
 * @param held - Whether this product holds the current scheduling owner.
 * @param inFlight - Whether accepted owner work still needs settlement.
 * @returns a quote only; no budget acknowledgement or resume occurs.
 */
export function tokenControlDiagnostics(state: import('@clocky/clocky-simulation').SimulationControlObservation,
  held: boolean, inFlight: boolean): Pick<SimulationProductControl, 'tokenRecovery' | 'requestBudget'> {
  const recovery = state.token.recovery
  const base = state.token.requestBudget === undefined ? {} : { requestBudget: state.token.requestBudget }
  if (recovery === undefined) return base
  const reason = !held ? 'ownership-unavailable' : state.phase !== 'paused' ? 'pause-required'
    : inFlight || state.activeDecisions !== 0 ? 'in-flight' : !recovery.complete || !recovery.settled ? 'unknown-usage' : 'ready'
  return { ...base, tokenRecovery: { request: recovery.request, allowed: reason === 'ready', reason } }
}
