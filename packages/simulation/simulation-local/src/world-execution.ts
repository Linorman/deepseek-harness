import { assertRunControlRequest } from './run-control.ts'
import type { NativeWorldRuntime } from './world-runtime.ts'
import { pendingCandidateCancellation } from '@clocky/clocky-simulation'
/** Native-owned callback observations retain original case responsibility without changing business outcomes. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { activeSimulationMaintenance, SimulationWorldError, worldExecutionObservationSchema,
  parseSimulationWorldSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationWorldState, WorldExecutionRequest, WorldExecutionObservation,
  WorldPlanId } from '@clocky/clocky-simulation'

/** One complete original observation is stored in the sole Native journal. */
export const worldExecutionRecordSchema = z.strictObject({
  kind: z.literal('world/execution'), observation: worldExecutionObservationSchema,
})
/** Original observation plus its owning journal discriminant. */
export type WorldExecutionRecord = z.infer<typeof worldExecutionRecordSchema>

function worldState(state: SimulationSnapshot): SimulationWorldState {
  if (state.world === undefined) throw new SimulationWorldError('SIM_WORLD_NOT_CONFIGURED', 'Execution observations require an original World')
  return state.world
}

/**
 * Match only a repeated callback disposition; changing the prior sequence alone never creates another observation.
 * @param original - Latest durable observation, absent before the first transition.
 * @param request - Parsed owner transition.
 * @returns true only for the same original plan, mode, phase and reason.
 */
export function sameWorldExecution(original: WorldExecutionObservation | undefined, request: WorldExecutionRequest): boolean {
  return original !== undefined && original.planId === request.planId && original.mode === request.mode
    && original.phase === request.phase && original.reason === request.reason
}

function retainsDuty(state: SimulationSnapshot, planId: WorldPlanId): boolean {
  const world = worldState(state), maintenance = activeSimulationMaintenance(state)
  if (pendingCandidateCancellation(state, planId) !== undefined) return true
  const candidate = Object.values(world.reservations).find(value => value.request.planId === planId && value.status === 'candidate')
  if (candidate !== undefined && (maintenance === undefined
    || !isDeepStrictEqual(maintenance.request, candidate.request.maintenance)
      && !isDeepStrictEqual(maintenance.request, candidate.candidate?.maintenance))) return false
  if (Object.values(state.resourceReservations).some(value => value.phase === 'active' && value.world?.planId === planId)) return true
  return [
    ...Object.values(world.reservations).map(value => ({ planId: value.request.planId,
      pending: value.status !== 'committed' && value.status !== 'abandoned',
      maintenance: value.candidate?.maintenance ?? value.request.maintenance })),
    ...Object.values(world.personnel.reservations).map(value => ({ planId: value.request.planId,
      pending: value.status !== 'committed' && value.status !== 'cancelled', maintenance: value.request.maintenance })),
    ...Object.values(world.external.representatives).map(value => ({ planId: value.request.planId,
      pending: value.status !== 'committed' && value.status !== 'abandoned', maintenance: value.request.maintenance })),
    ...Object.values(world.external.contacts).map(value => ({ planId: value.planId,
      pending: value.status !== 'committed' && value.status !== 'cancelled', maintenance: value.cancellation?.maintenance })),
  ].some(value => value.planId === planId && (value.pending || maintenance !== undefined
    && value.maintenance !== undefined && isDeepStrictEqual(value.maintenance, maintenance.request)))
}

/**
 * Validate and project a single retained callback fact before any journal append.
 * @param state - Exact authoritative prefix, with original accepted plans and independent domain responsibilities.
 * @param record - Strict original callback observation.
 * @param sequence - Storage-assigned contiguous sequence.
 * @param runtime - Original pinned domain and clock interpreters used for execution-boundary admission.
 * @returns the updated World projection only; no callback, physical retirement or business mutation runs here.
 */
export function foldWorldExecution(state: SimulationSnapshot, record: WorldExecutionRecord, sequence: number,
  runtime?: NativeWorldRuntime): SimulationSnapshot {
  const world = worldState(state), observation = record.observation, plan = world.plans[observation.planId]
  const request = plan === undefined ? undefined : world.requests[plan.requestId]
  const intent = request === undefined ? undefined : world.intents[request.intentId]
  const original = world.executions[observation.planId]
  if (plan === undefined || plan.proposal.resolution.kind !== 'apply' || request === undefined || intent === undefined
    || observation.requestId !== request.id || observation.intentId !== intent.id || !isDeepStrictEqual(observation.pin, plan.pin)
    || !isDeepStrictEqual(request.pin, plan.pin) || !isDeepStrictEqual(intent.pin, plan.pin)
    || observation.sequence !== sequence || sequence !== state.revision + 1 || observation.time !== state.time
    || observation.expectedSequence !== (original?.sequence ?? null) || observation.updates !== (original?.updates ?? 0) + 1
    || sameWorldExecution(original, observation))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Execution observation lost its original plan, prior sequence or next transition')
  const executable = request.status === 'open' && request.plans.at(-1) === plan.id && plan.status === 'accepted'
  if (observation.phase === 'armed') {
    if (observation.mode === 'execute') assertRunControlRequest(state, request.proposal, runtime, { requestId: request.id })
    if (observation.mode === 'execute' && (!executable || original?.phase === 'armed' || original?.phase === 'outcome-unknown')
      || observation.mode === 'reconcile' && !retainsDuty(state, plan.id)
        && original?.phase !== 'armed' && original?.phase !== 'outcome-unknown')
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Execution admission requires its live plan or exact unresolved reconciliation duty')
    const unsettled = Object.values(world.executions).filter(value => value.planId !== plan.id
      && (value.phase === 'armed' || value.phase === 'outcome-unknown')).length
    if (unsettled >= world.definition.limits.maxPendingMutations)
      throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Another original callback still owns pending execution responsibility', 'mutations')
  } else if (observation.phase === 'settled' || observation.phase === 'outcome-unknown') {
    if (original?.phase !== 'armed' && original?.phase !== 'outcome-unknown' || original.mode !== observation.mode)
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Callback disposition requires its original armed or unknown execution mode')
  } else if (!executable && original?.phase !== 'armed' && original?.phase !== 'outcome-unknown') {
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Blocking requires its executable original plan or unsettled callback')
  }
  if (observation.phase === 'settled' && retainsDuty(state, plan.id))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'A settled callback cannot conceal its original pending Native duty')
  if (original?.phase === 'outcome-unknown' && observation.phase === 'blocked')
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Unknown callback requires reconciliation before a definite blocked disposition')
  // Four fixed protocol records cover execution arm/disposition and one reconciliation arm/disposition.
  const limit = 4n * BigInt(state.spec.maxOperationsPerDecision) * BigInt(world.definition.limits.maxPlansPerRequest)
  const used = BigInt(original?.updates ?? 0)
  const required = observation.phase === 'armed' ? observation.mode === 'execute' ? 4n : 2n
    : observation.phase === 'blocked' && !retainsDuty(state, plan.id) ? 5n : 1n
  if (used + required > limit)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Original plan lacks its complete execution observation lifecycle allowance', 'commands')
  const envelope = { kind: 'run/world-execution', runId: state.spec.runId, expectedRevision: state.revision, change: record }
  if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > world.definition.limits.maxBytesPerPlan)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Complete execution observation exceeds the original plan byte allowance', 'bytes')
  return { ...state, world: { ...world, executions: { ...world.executions, [plan.id]: observation } } }
}

/**
 * Verify retained latest observations independently of runtime callback availability.
 * @param state - Replayed Native projection; original journals have already validated each transition.
 */
export function assertWorldExecutionProjection(state: SimulationSnapshot): void {
  const world = state.world
  if (world === undefined) return
  for (const [id, value] of Object.entries(world.executions)) {
    const observation = parseSimulationWorldSchema(worldExecutionObservationSchema, value)
    const plan = world.plans[observation.planId], request = world.requests[observation.requestId]
    if (id !== observation.planId || plan === undefined || request === undefined || plan.requestId !== request.id
      || request.intentId !== observation.intentId || plan.proposal.resolution.kind !== 'apply'
      || !isDeepStrictEqual(observation.pin, plan.pin) || observation.sequence <= plan.sequence || observation.sequence > state.revision
      || observation.expectedSequence !== null && observation.expectedSequence >= observation.sequence
      || (observation.updates === 1) !== (observation.expectedSequence === null)
      || BigInt(observation.updates) > 4n * BigInt(state.spec.maxOperationsPerDecision)
        * BigInt(world.definition.limits.maxPlansPerRequest))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Execution observation lost its original accepted source or bounded update history')
  }
}
