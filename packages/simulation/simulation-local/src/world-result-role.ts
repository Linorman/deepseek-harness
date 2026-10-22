/** Native derives notification actors from the original business source and pinned domain, never model sender fields. */
import { isDeepStrictEqual } from 'node:util'
import { SimulationWorldError } from '@clocky/clocky-simulation'
import type { SimulationEntityId, SimulationSnapshot, SimulationWorldResult } from '@clocky/clocky-simulation'
import { requireWorldRuntime } from './world-runtime.ts'
import type { NativeWorldRuntime } from './world-runtime.ts'

/**
 * Resolve the immutable business role for result scheduling, replay and consumed context authorization.
 * @param state - Authoritative original World and request identity.
 * @param result - Retained terminal result whose business source selects the exact domain pin.
 * @param runtime - Original explicitly installed parser and reducer catalog.
 * @returns original requester or frozen director identity; absent or mismatched sources reject.
 */
export function worldResultNotificationActor(state: SimulationSnapshot, result: SimulationWorldResult,
  runtime: NativeWorldRuntime | undefined): SimulationEntityId {
  const world = state.world, request = world?.requests[result.requestId], intent = world?.intents[result.intentId]
  if (world === undefined || request?.intentId !== result.intentId || intent?.requestId !== request.id
    || intent.requesterEntityId !== request.requesterEntityId || !isDeepStrictEqual(intent.pin, request.pin)
    || !world.definition.operations.some(pin => isDeepStrictEqual(pin, intent.pin)))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Result notification lost its original request and pinned intent')
  const role = requireWorldRuntime(runtime).original(intent.pin).resultNotificationRole ?? 'requester'
  switch (role) {
    case 'requester': {
      if (request.requesterEntityId === null) throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Authenticated users receive Product receipts, not simulated role notifications')
      return request.requesterEntityId
    }
    case 'director': return world.definition.directorEntityId
    default: return assertNever(role)
  }
}

function assertNever(value: never): never {
  throw new SimulationWorldError('SIM_WORLD_INTEGRITY', `Unknown installed result notification role: ${String(value)}`)
}
