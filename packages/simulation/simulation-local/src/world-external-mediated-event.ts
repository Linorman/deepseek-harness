/** Finite original adjudication duties share the Native scheduler and its exact retained ordering keys. */
import { isDeepStrictEqual } from 'node:util'
import { simulationExternalAdjudicatedEventStateSchema, simulationEventIdSchema, SimulationWorldError, WORLD_EXTERNAL_MEDIATED_PIN } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationScheduledEvent, SimulationExternalAdjudicatedEventState } from '@clocky/clocky-simulation'
import { allocateEventKey, foldSchedulerRecord } from './scheduler.ts'
import type { SchedulerRecord } from './scheduler.ts'
import { businessFingerprint } from './business.ts'

/**
 * Verify the scheduler envelope against the immutable original finite duty and its actual adjudication.
 * @param state - Original Native prefix or complete replay projection.
 * @param event - Proposed or retained scheduler envelope.
 * @returns the retained duty; changed leaf, source or simulated time rejects before any publication.
 */
export function assertExternalAdjudicatedEventSource(state: SimulationSnapshot,
  event: Pick<SimulationScheduledEvent, 'id' | 'key' | 'action'>): SimulationExternalAdjudicatedEventState {
  const retained = state.world?.external.events[event.id]
  if (retained === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Scheduled adjudication lost its original finite duty')
  const duty = simulationExternalAdjudicatedEventStateSchema.parse(retained), original = duty.original
  const adjudication = state.world?.external.adjudications[original.intentId]
  const request = state.world?.requests[original.requestId], plan = state.world?.plans[original.planId]
  const initial = state.world?.results[original.initialResultId]
  const proposal = adjudication?.proposal.outcome
  if (event.action.kind !== 'external-adjudicated-event' || event.action.intentId !== original.intentId
    || event.id !== original.eventId
    || event.id !== `simulation-external-adjudication:${original.intentId}:${businessFingerprint([original.intentId, original.key]).slice(7)}`
    || event.action.leafHash !== original.leafHash || businessFingerprint(original.leaf) !== original.leafHash
    || event.key.time !== original.deliverAt || event.key.phase !== 'deadline'
    || adjudication?.sequence !== original.adjudicationSequence || adjudication.identityId !== original.identityId
    || adjudication.requestId !== original.requestId || adjudication.planId !== original.planId
    || adjudication.policyFingerprint !== original.policyFingerprint || proposal?.kind !== 'delayed-event'
    || proposal.key !== original.key || proposal.deliverAt !== original.deliverAt
    || !isDeepStrictEqual(proposal.outcome, original.leaf) || !isDeepStrictEqual(proposal.outcome.evidence, original.evidence)
    || request?.intentId !== original.intentId || request.status !== 'committed' || plan?.status !== 'accepted'
    || !isDeepStrictEqual(request.pin, WORLD_EXTERNAL_MEDIATED_PIN) || !isDeepStrictEqual(plan.pin, request.pin)
    || initial?.intentId !== original.intentId || initial.outcome.kind !== 'committed'
    || initial.source.kind !== 'plan' || initial.source.planId !== plan.id || initial.sequence !== adjudication.sequence)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Scheduled adjudication differs from its original source, leaf or simulated time')
  return duty
}

/**
 * Queue each original finite event in the same atomic append batch as its adjudication and initial result.
 * @param state - Original result-retaining Native prefix.
 * @returns exact finite allocations; existing responsibilities never receive replacement identities or keys.
 */
export function externalAdjudicatedEventRecords(state: SimulationSnapshot): SchedulerRecord[] {
  const records: SchedulerRecord[] = []
  let projected = state
  for (const duty of Object.values(state.world?.external.events ?? {})) {
    const original = duty.original
    if (Object.hasOwn(projected.scheduledEvents, original.eventId)) continue
    if (duty.status !== 'scheduled' || duty.blocks.length !== 0)
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Original adjudication duty omitted its initial scheduler allocation')
    const action = { kind: 'external-adjudicated-event' as const, intentId: original.intentId, leafHash: original.leafHash }
    const record: SchedulerRecord = { kind: 'event/queued', id: original.eventId, action,
      key: allocateEventKey(projected, original.deliverAt, action) }
    records.push(record)
    projected = { ...foldSchedulerRecord(projected, record, projected.revision + 1), revision: projected.revision + 1 }
  }
  return records
}

/**
 * Require every actual finite duty to retain its scheduler envelope and exact completion status.
 * @param state - Complete Native append tail, outside intermediate mutation/scheduler folding.
 * @returns normally only when no original duty, leaf or scheduler responsibility was lost.
 */
export function assertExternalAdjudicatedEventProjection(state: SimulationSnapshot): void {
  assertExternalAdjudicatedEventCapacity(state)
  for (const duty of Object.values(state.world?.external.events ?? {})) {
    const event = state.scheduledEvents[duty.original.eventId]
    if (event === undefined || event.status === 'cancelled'
      || (event.status === 'consumed') !== (duty.status === 'consumed')
      || duty.consumption !== undefined && event.settledAt !== duty.consumption.sequence)
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Original finite adjudication duty lost its scheduler responsibility')
    assertExternalAdjudicatedEventSource(state, event)
    if (duty.status === 'consumed') {
      const wake = state.scheduledEvents[externalAdjudicatedResultWakeId(duty.original.eventId)]
      if (wake === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Consumed adjudication omitted its actual director notification duty')
      assertExternalAdjudicatedResultWakeSource(state, wake)
    }
  }
  for (const event of Object.values(state.scheduledEvents)) {
    if (event.action.kind === 'external-adjudicated-event') assertExternalAdjudicatedEventSource(state, event)
  }
}

/**
 * Bound complete retained original adjudication and consumption history under the frozen external-book allowance.
 * @param state - Complete proposed Native projection.
 * @returns normally within the byte allowance; no partial publication can pass this check.
 */
export function assertExternalAdjudicatedEventCapacity(state: SimulationSnapshot): void {
  if (state.world !== undefined
    && Buffer.byteLength(JSON.stringify(state.world.external), 'utf8') > state.spec.maxKnowledgeBytes)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Complete retained external history exceeds its frozen byte allowance', 'bytes')
}

/**
 * Identify the sole notification of an actually consumed leaf without replacing its original scheduled result.
 * @param eventId - Original finite duty identity.
 * @returns the reserved run-local director wake identity.
 */
export function externalAdjudicatedResultWakeId(eventId: SimulationScheduledEvent['id']): SimulationScheduledEvent['id'] {
  return simulationEventIdSchema.parse(`simulation-external-adjudication-result:${eventId}`)
}

/**
 * Queue director notification only after the original finite duty has actually committed its leaf.
 * @param state - Leaf-retaining Native prefix inside the same consumption append batch.
 * @returns finite exact wakes; replay and retries retain their existing identities and keys.
 */
export function externalAdjudicatedResultWakeRecords(state: SimulationSnapshot): SchedulerRecord[] {
  const records: SchedulerRecord[] = []
  let projected = state
  const world = state.world
  if (world === undefined) return records
  for (const duty of Object.values(world.external.events)) {
    if (duty.status !== 'consumed' || duty.consumption === undefined) continue
    const id = externalAdjudicatedResultWakeId(duty.original.eventId)
    if (Object.hasOwn(projected.scheduledEvents, id)) continue
    const action = { kind: 'wake' as const, entityId: world.definition.directorEntityId,
      reason: JSON.stringify({ resultId: duty.original.initialResultId, externalEventId: duty.original.eventId }) }
    const record: SchedulerRecord = { kind: 'event/queued', id, action,
      key: allocateEventKey(projected, duty.consumption.time, action) }
    records.push(record)
    projected = { ...foldSchedulerRecord(projected, record, projected.revision + 1), revision: projected.revision + 1 }
  }
  return records
}

/**
 * Verify a follow-up wake against its actually consumed original leaf and fixed director identity.
 * @param state - Native history containing the exact original consumption.
 * @param event - Proposed or retained notification envelope.
 * @returns normally only for the one exact canonical consequence.
 */
export function assertExternalAdjudicatedResultWakeSource(state: SimulationSnapshot,
  event: Pick<SimulationScheduledEvent, 'id' | 'key' | 'action'>): void {
  const world = state.world
  const duty = Object.values(world?.external.events ?? {})
    .find(value => event.id === externalAdjudicatedResultWakeId(value.original.eventId))
  if (world === undefined || duty?.status !== 'consumed' || duty.consumption === undefined
    || event.action.kind !== 'wake' || event.action.entityId !== world.definition.directorEntityId
    || event.key.time !== duty.consumption.time || event.key.phase !== 'decision'
    || event.action.reason !== JSON.stringify({ resultId: duty.original.initialResultId, externalEventId: duty.original.eventId }))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Adjudication notification lost its actual original consumption or canonical director')
}
