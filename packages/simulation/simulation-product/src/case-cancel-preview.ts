/** Fixed cancellation dependencies from one owned Native prefix; hashing never includes private body text. */
import { createHash } from 'node:crypto'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import type { WorldRequestId } from '@clocky/clocky-simulation/world-types'
import type { SimulationProductWorldCaseCancelPreview } from './case-types.ts'

/**
 * Read the exact case's finite dependencies for inert confirmation and queued acceptance checks.
 * @param state - One current Native observation, whose revision binds every listed original.
 * @param requestId - Actual original case; an absent case has no quote.
 * @returns fixed metadata and hash; neither the quote nor its retained IDs authorize cleanup.
 */
export function worldCaseCancelPreview(state: SimulationSnapshot, requestId: WorldRequestId):
SimulationProductWorldCaseCancelPreview | undefined {
  const world = state.world
  const request = world !== undefined && Object.hasOwn(world.requests, requestId) ? world.requests[requestId] : undefined
  if (world === undefined || request === undefined) return undefined
  const hiring = world.reservations[request.intentId], personnel = world.personnel.reservations[request.intentId],
    representative = world.external.representatives[request.intentId]
  const impact = { requestStatus: request.status, planIds: [...request.plans],
    hiringReservationIds: hiring === undefined ? [] : [hiring.id],
    personnelReservationIds: personnel === undefined ? [] : [personnel.id],
    representativeReservationIds: representative === undefined ? [] : [representative.id],
    unconfirmedExecutionPlanIds: request.plans.filter((id) => {
      const observed = world.executions[id]
      return observed?.phase === 'armed' || observed?.phase === 'outcome-unknown'
    }) }
  const snapshotRevision = state.revision
  const previewHash = 'sha256:' + createHash('sha256').update(JSON.stringify({ requestId, snapshotRevision, impact })).digest('hex')
  return { snapshotRevision, previewHash, impact }
}
