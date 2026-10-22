import { worldDecisionSource, worldRoleRequester } from '@clocky/clocky-simulation'
/** One immutable clock boundary per actual accepted timed World intent; it creates no actor or model wake. */
import { isDeepStrictEqual } from 'node:util'
import { simulationEventIdSchema, SimulationWorldError } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationScheduledEvent, SimulationWorldIntent } from '@clocky/clocky-simulation'
import { allocateEventKey, foldSchedulerRecord } from './scheduler.ts'
import type { SchedulerRecord } from './scheduler.ts'

/**
 * Preserve each accepted intent's exact future execution boundary in the same Native acceptance append.
 * @param state - Original accepted prefix after other event allocations in this batch.
 * @returns finite unique clock records; retries and replay never reassign keys or expand further occurrences.
 */
export function worldExecutionTimeRecords(state: SimulationSnapshot): SchedulerRecord[] {
  const records: SchedulerRecord[] = []
  let projected = state
  for (const intent of Object.values(state.world?.intents ?? {})) {
    if (intent.requestId === undefined || intent.expectedTime === null) continue
    const id = simulationEventIdSchema.parse(`simulation-world-execution-time:${intent.id}`)
    if (Object.hasOwn(projected.scheduledEvents, id)) continue
    const action = { kind: 'world-execution-time' as const, intentId: intent.id }
    const request = state.world?.requests[intent.requestId]
    if (request === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Timed World intent lost its accepted request')
    const record: SchedulerRecord = { kind: 'event/queued', id, action, ...request.operationId === null ? {} : { sourceOperationId: request.operationId },
      key: allocateEventKey(projected, intent.expectedTime, action) }
    records.push(record)
    projected = { ...foldSchedulerRecord(projected, record, projected.revision + 1), revision: projected.revision + 1 }
  }
  return records
}

/**
 * Validate a pure clock boundary against its immutable actual accepted operation and domain pin.
 * @param state - Original Native prefix or replay projection.
 * @param event - Exact proposed or retained clock record.
 * @returns the original timed intent; terminal cases still retain the historical boundary without new execution authority.
 */
export function assertWorldExecutionTimeSource(state: SimulationSnapshot,
  event: Pick<SimulationScheduledEvent, 'id' | 'key' | 'action'>
    & { readonly sourceOperationId?: import('@clocky/clocky-simulation').SimulationOperationId | undefined }): SimulationWorldIntent {
  const intent = event.action.kind === 'world-execution-time' ? state.world?.intents[event.action.intentId] : undefined
  const request = intent?.requestId === undefined ? undefined : state.world?.requests[intent.requestId]
  if (intent !== undefined && request?.operationId === null) {
    if (intent.requesterEntityId !== null || intent.expectedTime === null || event.sourceOperationId !== undefined
      || event.id !== `simulation-world-execution-time:${intent.id}` || event.key.time !== intent.expectedTime
      || event.key.phase !== 'deadline' || request.intentId !== intent.id
      || request.proposal.expectedTime !== intent.expectedTime || !isDeepStrictEqual(request.pin, intent.pin)
      || !isDeepStrictEqual(request.source, intent.source))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Management clock boundary lost its actual original source')
    return intent
  }
  const operation = request?.operationId == null ? undefined : state.operations[request.operationId]
  const decision = operation === undefined ? undefined : state.decisions[operation.decisionId]
  if (intent === undefined || request?.intentId !== intent.id || operation?.action.kind !== 'world/request'
    || decision?.status !== 'accepted' || event.sourceOperationId !== operation.id
    || !isDeepStrictEqual(operation.action, request.proposal) || !isDeepStrictEqual(operation.worldPin, intent.pin)
    || !isDeepStrictEqual(request.pin, intent.pin) || operation.entityId !== intent.requesterEntityId
    || request.requesterEntityId !== intent.requesterEntityId || operation.action.businessKey !== intent.businessKey
    || worldDecisionSource(request).decisionId !== operation.decisionId || worldDecisionSource(request).epoch !== decision.epoch
    || !isDeepStrictEqual(worldDecisionSource(request).binding, state.entities[worldRoleRequester(intent)]?.binding)
    || request.payloadHash !== operation.fingerprint || operation.action.expectedTime !== intent.expectedTime
    || intent.expectedTime === null || event.key.time !== intent.expectedTime || event.key.phase !== 'deadline'
    || event.id !== `simulation-world-execution-time:${intent.id}`)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World execution clock lost its original accepted intent, source or simulated time')
  return intent
}

/**
 * Require the unique original clock record for every accepted timed intent at publication and cold restoration.
 * @param state - Complete accepted or replayed Native projection.
 * @returns normally only when retained boundaries and original intents agree; no clock or inference is advanced.
 */
export function assertWorldExecutionTimeProjection(state: SimulationSnapshot): void {
  for (const intent of Object.values(state.world?.intents ?? {})) {
    if (intent.requestId === undefined || intent.expectedTime === null) continue
    const event = state.scheduledEvents[simulationEventIdSchema.parse(`simulation-world-execution-time:${intent.id}`)]
    if (event === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Accepted timed World intent lost its original clock boundary')
    assertWorldExecutionTimeSource(state, event)
  }
  for (const event of Object.values(state.scheduledEvents)) {
    if (event.action.kind === 'world-execution-time') assertWorldExecutionTimeSource(state, event)
  }
}
