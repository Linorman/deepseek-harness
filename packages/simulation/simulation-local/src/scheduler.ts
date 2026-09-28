import { isOutboxAction } from './outbox.ts'
/** Persistent event order and atomic handoff into wake or deadline facts. @module @clocky/clocky-simulation-local/scheduler */
import { assertCapacity } from './capacity.ts'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { decisionDispatch } from './dispatch.ts'
import {
  parseSimTime, simTimeSchema, simulationEventActionSchema, simulationEventIdSchema,
  simulationEventKeySchema, simulationEventSlotSchema, simulationOperationIdSchema,
  simulationIngressRequestSchema,
} from '@clocky/clocky-simulation'
import type {
  SimTime, SimulationEventAction, SimulationEventId, SimulationEventKey, SimulationEventPhase,
  SimulationOperation, SimulationSnapshot, SimulationScheduledEvent,
} from '@clocky/clocky-simulation'
import { dependenciesReady } from './outbox.ts'
import { nextLocalOperation } from './decisions.ts'
import { businessFingerprint } from './business.ts'

/** Exact queue mutations; keys are stored, never reassigned on recovery. */
export const schedulerRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ingress/received'), request: simulationIngressRequestSchema,
    ordinal: simulationEventSlotSchema, eventId: simulationEventIdSchema, key: simulationEventKeySchema }),
  z.strictObject({ kind: z.literal('conflict/exhausted'), id: simulationOperationIdSchema }),
  z.strictObject({ kind: z.literal('conflict/acknowledged'), id: simulationOperationIdSchema }),
  z.strictObject({ kind: z.literal('event/queued'), id: simulationEventIdSchema, key: simulationEventKeySchema,
    action: simulationEventActionSchema, sourceOperationId: simulationOperationIdSchema.optional() }),
  z.strictObject({ kind: z.literal('event/cancelled'), id: simulationEventIdSchema, reason: z.string().min(1) }),
  z.strictObject({ kind: z.literal('event/consumed'), id: simulationEventIdSchema }),
  z.strictObject({ kind: z.literal('event/cohort-consumed'), id: simulationEventIdSchema }),
  z.strictObject({ kind: z.literal('wake/cancelled'), id: simulationEventIdSchema, reason: z.string().min(1) }),
  z.strictObject({ kind: z.literal('clock/advanced'), time: simTimeSchema }),
  z.strictObject({ kind: z.literal('run/stalled'), id: simulationEventIdSchema }),
])
/** Parsed scheduler mutation. */
export type SchedulerRecord = z.infer<typeof schedulerRecordSchema>

/** Compare canonical decimal ordering keys under the persisted phase policy.
 * @param state - Run policy.
 * @param left - First key.
 * @param right - Second key.
 * @returns numeric ordering without precision loss or locale dependence.
 */
export function compareEventKeys(state: SimulationSnapshot, left: SimulationEventKey, right: SimulationEventKey): number {
  for (const [a, b] of [[BigInt(left.time), BigInt(right.time)], [BigInt(left.microstep), BigInt(right.microstep)]] as const) {
    if (a < b) return -1
    if (a > b) return 1
  }
  const phase = state.spec.phaseOrder.indexOf(left.phase) - state.spec.phaseOrder.indexOf(right.phase)
  if (phase !== 0) return phase
  return BigInt(left.slot) < BigInt(right.slot) ? -1 : BigInt(left.slot) > BigInt(right.slot) ? 1 : 0
}
/** Find the next pending event; consumed/cancelled entries remain historical only.
 * @param state - Current queue.
 * @returns the earliest pending event, when one exists.
 */
export function nextScheduledEvent(state: SimulationSnapshot): SimulationScheduledEvent | undefined {
  return Object.values(state.scheduledEvents).filter(event => event.status === 'pending')
    .sort((left, right) => compareEventKeys(state, left.key, right.key))[0]
}
function phase(action: SimulationEventAction): SimulationEventPhase {
  if (action.kind === 'outbox-ready') return 'delivery'
  return action.kind === 'wake' || action.kind === 'reply-wake' || action.kind === 'conflict-retry' || action.kind === 'ingress' ? 'decision' : 'deadline'
}
/** Allocate a future key without changing state; the queued record consumes its slot.
 * @param state - Current clock and allocation counter.
 * @param time - Requested simulation time.
 * @param action - Domain work selecting its phase.
 * @returns exact key to append with the event.
 */
export function allocateEventKey(state: SimulationSnapshot, time: SimTime, action: SimulationEventAction): SimulationEventKey {
  parseSimTime(time, state.spec.maxTime)
  if (BigInt(time) < BigInt(state.time)) throw new Error('Simulation cannot schedule into the committed past')
  const microstep = state.lastEventKey?.time === time ? BigInt(state.lastEventKey.microstep) + 1n
    : action.kind === 'conflict-retry' || action.kind === 'ingress' && time === state.time ? 1n : 0n
  return { time, microstep: simulationEventSlotSchema.parse(String(microstep)), phase: phase(action), slot: state.nextEventSlot }
}
function requireEvent(state: SimulationSnapshot, id: SimulationEventId): SimulationScheduledEvent {
  const event = Object.hasOwn(state.scheduledEvents, id) ? state.scheduledEvents[id] : undefined
  if (event === undefined) throw new Error('Simulation scheduled event does not exist')
  return event
}
/**
 * Check whether an event extends the still-unclaimed decision cohort without crossing a causal key boundary.
 * @param state - Current pending wakes and last consumed event key.
 * @param event - Next pending event in canonical order.
 * @returns whether all outstanding wakes belong to that same decision phase, time and microstep.
 */
export function canCollectDecisionEvent(state: SimulationSnapshot, event: SimulationScheduledEvent): boolean {
  const same = (key: SimulationEventKey | undefined): boolean => key?.phase === 'decision'
    && key.time === event.key.time && key.microstep === event.key.microstep
  const wakes = Object.values(state.wakes).filter(wake => wake.status === 'pending' || wake.status === 'claimed')
  return event.key.phase === 'decision' && same(state.lastEventKey) && wakes.length > 0
    && wakes.every(wake => wake.status === 'pending' && same(state.scheduledEvents[wake.eventId]?.key))
}
function assertRunnable(state: SimulationSnapshot, collecting = false): void {
  if (state.phase !== 'running') throw new Error('Simulation clock is not running')
  if (Object.values(state.operations).some(operation => operation.action.kind === 'communication/post'
    && operation.result?.status === 'applied' && operation.delivery?.receipt === undefined && operation.deliveryFailure?.resolution === undefined)) {
    throw new Error('Simulation clock cannot skip an unreceived publication')
  }
  if (Object.values(decisionDispatch(state).tickets).some(ticket => ticket.status === 'queued' || ticket.status === 'reserved')
    || state.activeDecisionId !== undefined || state.activeWindowId !== undefined || Object.values(state.wakes).some(wake => wake.status === 'claimed' || wake.status === 'pending' && !collecting)
    || (nextLocalOperation(state) !== undefined && dependenciesReady(state, nextLocalOperation(state) as SimulationOperation))
    || Object.values(state.operations).some(operation => isOutboxAction(operation.action)
      && operation.outbox?.ready === true && operation.result === undefined && dependenciesReady(state, operation))) {
    throw new Error('Simulation must settle current decisions and operations before advancing time')
  }
}
function consume(state: SimulationSnapshot, event: SimulationScheduledEvent): SimulationSnapshot {
  const action = event.action
  switch (action.kind) {
    case 'ingress': {
      const ingress = state.ingresses?.[action.ingressId]
      if (ingress === undefined) throw new Error('Simulation ingress event lost its receipt')
      return consume(state, { ...event, action: { kind: 'wake', entityId: ingress.request.entityId,
        reason: `External input ${ingress.request.id} from ${ingress.request.source}` } })
    }
    case 'conflict-retry': {
      const operation = state.operations[action.operationId]
      if (operation === undefined) throw new Error('Simulation conflict retry lost its failed operation')
      return consume(state, { ...event, action: { kind: 'wake', entityId: operation.entityId,
        reason: `Refresh reads after resource conflict ${operation.id}; retry ${action.attempt} of ${state.spec.maxConflictRetries}. Do not repeat applied effects.` } })
    }
    case 'outbox-ready': {
      const operation = state.operations[action.operationId]
      if (!isOutboxAction(operation?.action) || operation.outbox === undefined) throw new Error('Scheduled outbox intent is missing')
      return { ...state, operations: { ...state.operations, [operation.id]: {
        ...operation, outbox: { ...operation.outbox, ready: true },
      } } }
    }
    case 'wake': {
      const entity = Object.hasOwn(state.entities, action.entityId) ? state.entities[action.entityId] : undefined
      if (entity === undefined) throw new Error('Scheduled wake entity is missing')
      if (entity.phase !== 'active' || entity.cognition !== 'agent') return { ...state, wakes: { ...state.wakes, [event.id]: {
        eventId: event.id, entityId: action.entityId, reason: action.reason, status: 'cancelled', cancellation: 'Entity unavailable',
      } } }
      return { ...state, wakes: { ...state.wakes, [event.id]: {
        eventId: event.id, entityId: action.entityId, reason: action.reason, status: 'pending',
      } } }
    }
    case 'reply-wake': {
      const request = state.interactions[action.interactionId]
      if (request === undefined) throw new Error('Scheduled reply interaction is missing')
      if (request.reply !== 'deferred' || request.execution !== 'pending'
        || request.replyExpiredAt !== undefined || request.deferUntil !== event.key.time) return {
        ...state, wakes: { ...state.wakes, [event.id]: {
          eventId: event.id, entityId: request.assignee, reason: `Reply to ${request.id}`, status: 'cancelled', cancellation: 'Reply no longer pending',
        } } }
      return { ...state, wakes: { ...state.wakes, [event.id]: {
        eventId: event.id, entityId: request.assignee, reason: `Reply to ${request.id}`, status: 'pending',
      } } }
    }
    case 'reply-deadline': {
      const request = state.interactions[action.interactionId]
      if (request === undefined || request.execution !== 'pending' || request.replyExpiredAt !== undefined
        || request.reply !== 'pending' && request.reply !== 'deferred') return state
      return { ...state, interactions: { ...state.interactions, [request.id]: {
        ...request, replyExpiredAt: event.key.time, revision: request.revision + 1,
      } } }
    }
    case 'commitment-deadline': {
      const commitment = state.commitments[action.commitmentId]
      if (commitment === undefined || commitment.phase !== 'open' || commitment.breachedAt !== undefined) return state
      return { ...state, commitments: { ...state.commitments, [commitment.id]: {
        ...commitment, breachedAt: event.key.time, revision: commitment.revision + 1,
      } } }
    }
    /* v8 ignore next 2 -- scheduled actions cross a closed discriminated schema. */
    default: return assertNever(action)
  }
}
/** Fold one scheduler fact, including clock movement and its domain responsibility.
 * @param state - Projection preceding this entry.
 * @param record - Parsed mutation.
 * @param sequence - Storage position of the mutation.
 * @returns the complete prospective state without advancing its journal tail.
 */
export function foldSchedulerRecord(state: SimulationSnapshot, record: SchedulerRecord, sequence: number): SimulationSnapshot {
  switch (record.kind) {
    case 'ingress/received': {
      if (Object.values(state.checkpoints ?? {}).some(operation => operation.status === 'in-progress')) {
        throw new Error('Simulation checkpoint request blocks new external input')
      }
      const request = record.request
      const entity = Object.hasOwn(state.entities, request.entityId) ? state.entities[request.entityId] : undefined
      const time = BigInt(request.availableAt) < BigInt(state.time) ? state.time : request.availableAt
      parseSimTime(request.availableAt, state.spec.maxTime)
      const key = allocateEventKey(state, time, { kind: 'ingress', ingressId: request.id })
      const ingress = { request, ordinal: record.ordinal, eventId: record.eventId, key: record.key, sequence }
      if (entity?.phase !== 'active' || entity.cognition !== 'agent' || Object.hasOwn(state.ingresses ?? {}, request.id)
        || record.ordinal !== (state.nextIngressSlot ?? '0') || record.eventId !== ingressEventId(state, request.id)
        || !isDeepStrictEqual(record.key, key) || Buffer.byteLength(JSON.stringify(ingress), 'utf8') > state.spec.maxIngressBytes) {
        throw new Error('Simulation ingress identity, actor, assignment or byte budget is invalid')
      }
      return { ...state, nextIngressSlot: simulationEventSlotSchema.parse(String(BigInt(record.ordinal) + 1n)),
        ingresses: { ...state.ingresses, [request.id]: ingress } }
    }
    case 'conflict/exhausted': {
      const operation = state.operations[record.id]
      if (operation === undefined || !resourceConflict(operation) || retryOwner(state, operation.decisionId) !== undefined) {
        throw new Error('Simulation retry exhaustion has no unresolved resource conflict')
      }
      const lineage = retryLineage(state, operation)
      if (lineage.attempt < state.spec.maxConflictRetries) throw new Error('Simulation conflict retry budget is not exhausted')
      return { ...state, phase: 'stalled', stall: { code: 'SIM_CONFLICT_RETRY_LIMIT', operationId: operation.id,
        ...lineage, recovery: 'acknowledge-conflict-and-resume' }, operations: { ...state.operations, [operation.id]: {
        ...operation, conflictRetry: { kind: 'exhausted', ...lineage, acknowledged: false },
      } } }
    }
    case 'conflict/acknowledged': {
      const operation = state.operations[record.id]
      if (operation?.conflictRetry?.kind !== 'exhausted' || operation.conflictRetry.acknowledged) {
        throw new Error('Simulation conflict acknowledgement has no exhausted retry')
      }
      return { ...state, operations: { ...state.operations, [operation.id]: {
        ...operation, conflictRetry: { ...operation.conflictRetry, acknowledged: true },
      } } }
    }
    case 'event/queued': {
      if (Object.hasOwn(state.scheduledEvents, record.id)) throw new Error('Simulation event identity is already retained')
      assertReferent(state, record.action)
      assertEventSource(state, record)
      assertCapacity(state, 'events', 1)
      if (!isDeepStrictEqual(record.key, allocateEventKey(state, record.key.time, record.action))) throw new Error('Simulation event key is not the next policy allocation')
      if (record.sourceOperationId !== undefined && state.operations[record.sourceOperationId]?.result?.status !== 'applied'
        && record.action.kind !== 'conflict-retry'
        && !(record.action.kind === 'outbox-ready' && record.action.operationId === record.sourceOperationId
          && isOutboxAction(state.operations[record.sourceOperationId]?.action))) {
        throw new Error('Simulation event source operation is not applied')
      }
      const source = record.action.kind === 'conflict-retry' ? state.operations[record.action.operationId] : undefined
      return { ...state, ...source === undefined ? {} : { operations: { ...state.operations, [source.id]: {
        ...source, conflictRetry: { kind: 'scheduled' as const, eventId: record.id },
      } } }, nextEventSlot: simulationEventSlotSchema.parse(String(BigInt(state.nextEventSlot) + 1n)),
      scheduledEvents: { ...state.scheduledEvents, [record.id]: {
        id: record.id, key: record.key, action: record.action, status: 'pending',
        ...record.sourceOperationId === undefined ? {} : { sourceOperationId: record.sourceOperationId },
      } } }
    }
    case 'event/cancelled': {
      const event = requireEvent(state, record.id)
      if (event.status !== 'pending') throw new Error('Only a pending simulation event can be cancelled')
      const next: SimulationSnapshot = { ...state, scheduledEvents: { ...state.scheduledEvents, [record.id]: {
        ...event, status: 'cancelled', settledAt: sequence, cancellation: record.reason,
      } } }
      if (event.action.kind === 'outbox-ready') {
        const operation = state.operations[event.action.operationId]
        if (!isOutboxAction(operation?.action) || operation.outbox?.attempts.length !== 0) {
          throw new Error('Only an unattempted outbox publication can be cancelled with its readiness event')
        }
        return { ...next, operations: { ...next.operations, [operation.id]: { ...operation, status: 'rejected',
          result: { operationId: operation.id, status: 'rejected', code: operation.action.kind === 'task/create' ? 'SIM_TASK_CANCELLED' : 'SIM_POST_CANCELLED', sequence, time: state.time } } } }
      }
      return next
    }
    case 'wake/cancelled': {
      const wake = state.wakes[record.id]
      if (wake === undefined || wake.status === 'completed' || wake.status === 'cancelled') throw new Error('Simulation wake has no pending responsibility')
      const next = { ...state, wakes: { ...state.wakes, [record.id]: { ...wake, status: 'cancelled' as const, cancellation: record.reason } } }
      if (wake.decisionId !== undefined) {
        const decision = state.decisions[wake.decisionId]
        if (decision?.status === 'open' || decision?.status === 'submitted') {
          next.decisions = { ...state.decisions, [decision.id]: { ...decision, status: 'cancelled',
            cancellation: 'scheduled-wake-cancelled', closedAt: sequence } }
          if (next.activeDecisionId === decision.id) delete next.activeDecisionId
        }
      }
      return next
    }
    case 'event/consumed': case 'event/cohort-consumed': {
      const event = requireEvent(state, record.id)
      const collecting = record.kind === 'event/cohort-consumed'
      if (collecting && !canCollectDecisionEvent(state, event)) throw new Error('Simulation event cannot extend this unclaimed decision cohort')
      assertRunnable(state, collecting)
      if (event.status !== 'pending' || nextScheduledEvent(state)?.id !== event.id) throw new Error('Simulation event is not next to consume')
      if (BigInt(event.key.time) < BigInt(state.time) || BigInt(event.key.microstep) >= BigInt(state.spec.maxMicrostepsPerTime)) {
        throw new Error('Simulation event cannot advance this clock')
      }
      return consume({ ...state, time: event.key.time, lastEventKey: event.key,
        scheduledEvents: { ...state.scheduledEvents, [event.id]: { ...event, status: 'consumed', settledAt: sequence } } }, event)
    }
    case 'clock/advanced': {
      assertRunnable(state)
      parseSimTime(record.time, state.spec.maxTime)
      const next = nextScheduledEvent(state)
      if (BigInt(record.time) <= BigInt(state.time) || next !== undefined && BigInt(next.key.time) <= BigInt(record.time)) {
        throw new Error('Simulation clock cannot rewind or skip a pending event')
      }
      return { ...state, time: record.time }
    }
    case 'run/stalled': {
      const event = requireEvent(state, record.id)
      if (event.status !== 'pending' || BigInt(event.key.microstep) < BigInt(state.spec.maxMicrostepsPerTime)) {
        throw new Error('Simulation microstep stall has no overflowing event')
      }
      return { ...state, phase: 'stalled', stall: { code: 'SIM_MICROSTEP_LIMIT', eventId: event.id, recovery: 'cancel-event-and-resume' } }
    }
    /* v8 ignore next 2 -- scheduler records cross a closed discriminated schema. */
    default: return assertNever(record)
  }
}

/** Derive durable wake/deadline work from an applied business effect, before publishing the batch.
 * @param state - State including the operation's settlement.
 * @param operation - Settled operation.
 * @returns exact queue mutations for the same atomic batch.
 */
export function schedulerConsequences(state: SimulationSnapshot, operation: SimulationOperation): SchedulerRecord[] {
  if (resourceConflict(operation)) {
    if (retryOwner(state, operation.decisionId) !== undefined) return []
    const lineage = retryLineage(state, operation)
    if (lineage.attempt >= state.spec.maxConflictRetries) return [{ kind: 'conflict/exhausted', id: operation.id }]
    const action: SimulationEventAction = { kind: 'conflict-retry', operationId: operation.id,
      rootDecisionId: lineage.rootDecisionId, attempt: lineage.attempt + 1 }
    return [{ kind: 'event/queued', id: internalEventId(state, operation, action.kind), sourceOperationId: operation.id,
      key: allocateEventKey(state, state.time, action), action }]
  }
  if (operation.result?.status !== 'applied') return []
  const records: SchedulerRecord[] = []
  let projected = state
  const add = (record: SchedulerRecord): void => {
    projected = { ...foldSchedulerRecord(projected, record, projected.revision + 1), revision: projected.revision + 1 }
    records.push(record)
  }
  const queue = (time: SimTime | null, action: SimulationEventAction): void => {
    if (time === null) return
    const id = internalEventId(state, operation, action.kind)
    add({ kind: 'event/queued', id, key: allocateEventKey(projected, time, action), action, sourceOperationId: operation.id })
  }
  for (const event of Object.values(state.scheduledEvents)) {
    const action = event.action
    const request = action.kind === 'reply-wake' || action.kind === 'reply-deadline' ? state.interactions[action.interactionId] : undefined
    const commitment = action.kind === 'commitment-deadline' ? state.commitments[action.commitmentId] : undefined
    const obsolete = request !== undefined && (request.execution !== 'pending' || request.reply === 'accepted' || request.reply === 'rejected'
      || request.replyExpiredAt !== undefined || action.kind === 'reply-wake' && request.deferUntil !== event.key.time)
      || commitment !== undefined && commitment.phase !== 'open'
    if (!obsolete) continue
    if (event.status === 'pending') add({ kind: 'event/cancelled', id: event.id, reason: 'Business responsibility changed' })
    const wake = projected.wakes[event.id]
    if (wake?.status === 'pending' || wake?.status === 'claimed') add({ kind: 'wake/cancelled', id: event.id, reason: 'Business responsibility changed' })
  }
  const action = operation.action
  if (action.kind === 'interaction/request') queue(action.replyBy, { kind: 'reply-deadline', interactionId: action.id })
  if (action.kind === 'interaction/defer') queue(action.until, { kind: 'reply-wake', interactionId: action.id })
  if (action.kind === 'interaction/accept') {
    const request = state.interactions[action.id]
    if (request?.commitmentId === undefined) throw new Error('Accepted interaction has no commitment')
    queue(request.completeBy, { kind: 'commitment-deadline', commitmentId: request.commitmentId })
  }
  return records
}
function assertEventSource(state: SimulationSnapshot, event: Extract<SchedulerRecord, { kind: 'event/queued' }>): void {
  if (event.action.kind === 'ingress') {
    const ingress = state.ingresses?.[event.action.ingressId]
    if (event.sourceOperationId !== undefined || ingress?.eventId !== event.id || !isDeepStrictEqual(ingress.key, event.key)) {
      throw new Error('Simulation ingress event differs from its receipt assignment')
    }
    return
  }
  if (event.action.kind === 'wake') {
    if (event.sourceOperationId !== undefined) throw new Error('Administrative wakes cannot impersonate a business consequence')
    return
  }
  const operation = event.sourceOperationId === undefined ? undefined : state.operations[event.sourceOperationId]
  if (operation === undefined || event.id !== internalEventId(state, operation, event.action.kind)) {
    throw new Error('Simulation internal event has no exact accepted operation source')
  }
  const action = operation.action
  if (event.action.kind === 'conflict-retry') {
    const lineage = retryLineage(state, operation)
    if (!resourceConflict(operation) || retryOwner(state, operation.decisionId) !== undefined
      || event.action.operationId !== operation.id || event.action.rootDecisionId !== lineage.rootDecisionId
      || event.action.attempt !== lineage.attempt + 1 || event.action.attempt > state.spec.maxConflictRetries
      || event.key.time !== operation.result?.time) throw new Error('Simulation conflict retry disagrees with its source or budget')
    return
  }
  const matches = isOutboxAction(action) && event.action.kind === 'outbox-ready'
      && event.action.operationId === operation.id && event.key.time === action.deliverAt
    || action.kind === 'interaction/request' && event.action.kind === 'reply-deadline'
      && event.action.interactionId === action.id && event.key.time === action.replyBy
    || action.kind === 'interaction/defer' && event.action.kind === 'reply-wake'
      && event.action.interactionId === action.id && event.key.time === action.until
    || action.kind === 'interaction/accept' && event.action.kind === 'commitment-deadline'
      && event.action.commitmentId === state.interactions[action.id]?.commitmentId
      && event.key.time === state.interactions[action.id]?.completeBy
  if (!matches) throw new Error('Simulation event time or target disagrees with its business source')
}
function assertReferent(state: SimulationSnapshot, action: SimulationEventAction): void {
  const exists = action.kind === 'ingress' ? Object.hasOwn(state.ingresses ?? {}, action.ingressId)
    : action.kind === 'outbox-ready' || action.kind === 'conflict-retry' ? Object.hasOwn(state.operations, action.operationId)
      : action.kind === 'wake' ? Object.hasOwn(state.entities, action.entityId)
        : action.kind === 'commitment-deadline' ? Object.hasOwn(state.commitments, action.commitmentId)
          : Object.hasOwn(state.interactions, action.interactionId)
  if (!exists) throw new Error('Simulation scheduled event references a missing domain object')
}
function internalEventId(state: SimulationSnapshot, operation: SimulationOperation, kind: SimulationEventAction['kind']): SimulationEventId {
  return simulationEventIdSchema.parse(`simulation-event:${businessFingerprint([state.spec.runId, operation.id, kind]).slice(7)}`)
}
/** Verify every applied operation retains its required scheduled responsibility.
 * @param state - Projection at a complete durable tail.
 */
export function assertSchedulerProjection(state: SimulationSnapshot): void {
  const ingresses = Object.values(state.ingresses ?? {}).sort((left, right) => BigInt(left.ordinal) < BigInt(right.ordinal) ? -1 : 1)
  if (BigInt(state.nextIngressSlot ?? '0') !== BigInt(ingresses.length)) throw new Error('Simulation ingress receipt order has a gap')
  for (const [index, ingress] of ingresses.entries()) {
    const event = state.scheduledEvents[ingress.eventId]
    if (BigInt(ingress.ordinal) !== BigInt(index) || event?.action.kind !== 'ingress'
      || event.action.ingressId !== ingress.request.id || !isDeepStrictEqual(event.key, ingress.key)
      || BigInt(ingress.key.time) < BigInt(ingress.request.availableAt)) {
      throw new Error('Simulation ingress lost its durable order or scheduled responsibility')
    }
  }
  const retries = new Map<SimulationOperation['decisionId'], SimulationOperation>()
  for (const operation of Object.values(state.operations)) {
    const retry = operation.conflictRetry
    if (retry === undefined) continue
    if (!resourceConflict(operation) || retries.has(operation.decisionId)) throw new Error('Simulation conflict responsibility is duplicated or unsupported')
    retries.set(operation.decisionId, operation)
    const lineage = retryLineage(state, operation)
    if (retry.kind === 'scheduled') {
      const event = state.scheduledEvents[retry.eventId]
      if (event?.action.kind !== 'conflict-retry' || event.sourceOperationId !== operation.id
        || event.action.operationId !== operation.id || event.action.rootDecisionId !== lineage.rootDecisionId
        || event.action.attempt !== lineage.attempt + 1 || event.action.attempt > state.spec.maxConflictRetries) {
        throw new Error('Simulation conflict retry lost its scheduled responsibility')
      }
    } else if (retry.rootDecisionId !== lineage.rootDecisionId || retry.attempt !== lineage.attempt
      || retry.attempt < state.spec.maxConflictRetries || !retry.acknowledged && state.phase === 'running') {
      throw new Error('Simulation retry exhaustion contradicts its lineage or acknowledgement')
    }
  }
  for (const operation of Object.values(state.operations)) {
    if (resourceConflict(operation) && !retries.has(operation.decisionId)) throw new Error('Simulation resource conflict has no retry disposition')
    const action = operation.action
    const failed = operation.deliveryFailure
    if (failed !== undefined && (action.kind !== 'communication/post' || operation.result?.status !== 'applied'
      || operation.delivery?.receipt !== undefined || failed.record.envelopeId !== operation.outbox?.receipt?.envelopeId
      || failed.record.participantId !== state.entities[action.recipient]?.binding?.participantId
      || failed.resolution?.kind === 'retained-input' && operation.delivery === undefined
      || failed.resolution?.kind === 'absent-input' && operation.delivery !== undefined
      || failed.resolution?.kind === 'entity-terminated' && state.entities[action.recipient]?.phase !== 'terminated')) {
      throw new Error('Simulation delivery failure has another target or contradicts its receipt')
    }
    if (operation.delivery !== undefined) {
      const event = state.scheduledEvents[operation.delivery.wakeId]
      const receipt = operation.delivery.receipt
      if (receipt !== undefined && (action.kind !== 'communication/post' || receipt.envelopeId !== operation.outbox?.receipt?.envelopeId
        || receipt.participantId !== state.entities[action.recipient]?.binding?.participantId)) {
        throw new Error('Simulation delivery receipt has another target')
      }
      if (action.kind !== 'communication/post' || operation.result?.status !== 'applied'
        || event?.action.kind !== 'wake' || event.action.entityId !== action.recipient || event.key.time !== operation.delivery.time
        || event.action.reason !== `Team message ${operation.outbox?.receipt?.envelopeId}`
        || operation.delivery.sessionId !== state.entities[action.recipient]?.binding?.sessionId) {
        throw new Error('Simulation delivery is missing its recipient wake responsibility')
      }
    }
    if (operation.result?.status !== 'applied' && !isOutboxAction(action)) continue
    let expected: SimulationEventAction['kind'] | undefined
    if (isOutboxAction(action)) expected = 'outbox-ready'
    if (action.kind === 'interaction/request' && action.replyBy !== null) expected = 'reply-deadline'
    if (action.kind === 'interaction/defer') expected = 'reply-wake'
    if (action.kind === 'interaction/accept' && state.interactions[action.id]?.completeBy !== null) expected = 'commitment-deadline'
    if (expected !== undefined) {
      const event = state.scheduledEvents[internalEventId(state, operation, expected)]
      if (event === undefined || event.sourceOperationId !== operation.id || event.action.kind !== expected) {
        throw new Error('Simulation business effect is missing its scheduled responsibility')
      }
    }
  }
  for (const wake of Object.values(state.wakes)) {
    if (state.scheduledEvents[wake.eventId]?.status !== 'consumed') throw new Error('Simulation wake has no consumed source event')
  }
}

function resourceConflict(operation: SimulationOperation): boolean {
  return (operation.action.kind === 'resource/transfer' || operation.action.kind === 'resource/grant')
    && operation.result?.status === 'rejected' && operation.result.code === 'SIM_RESOURCE_REVISION_CONFLICT'
}
/**
 * Derive the event identity retained with one external input receipt.
 * @param state - Owning run.
 * @param id - Caller-selected ingress retry identity.
 * @returns a reserved scheduler identity independent of replay or arrival retries.
 */
export function ingressEventId(state: SimulationSnapshot, id: import('@clocky/clocky-simulation').SimulationIngressId): SimulationEventId {
  return simulationEventIdSchema.parse(`simulation-ingress:${businessFingerprint([state.spec.runId, id]).slice(7)}`)
}
function retryOwner(state: SimulationSnapshot, id: SimulationOperation['decisionId']): SimulationOperation | undefined {
  return Object.values(state.operations).find(operation => operation.decisionId === id && operation.conflictRetry !== undefined)
}
function retryLineage(state: SimulationSnapshot, operation: SimulationOperation) {
  const decision = state.decisions[operation.decisionId]
  if (decision === undefined) throw new Error('Simulation conflict lost its decision')
  return { rootDecisionId: decision.retry?.rootDecisionId ?? decision.id, attempt: decision.retry?.attempt ?? 0 }
}
/** Allocate communication readiness in the same batch as decision acceptance.
 * @param state - Projection containing every newly accepted intent.
 * @param operations - Exact new communication operation identities.
 * @returns persisted readiness events, with all slots already fixed.
 */
export function outboxScheduleRecords(state: SimulationSnapshot, operations: readonly SimulationOperation[]): SchedulerRecord[] {
  assertCapacity(state, 'events', operations.filter(operation => isOutboxAction(operation.action)).length)
  let projected = state
  const records: SchedulerRecord[] = []
  for (const operation of operations) {
    if (!isOutboxAction(operation.action)) continue
    const action = { kind: 'outbox-ready' as const, operationId: operation.id }
    const record: SchedulerRecord = { kind: 'event/queued', id: internalEventId(projected, operation, action.kind),
      key: allocateEventKey(projected, operation.action.deliverAt, action), action, sourceOperationId: operation.id }
    projected = { ...foldSchedulerRecord(projected, record, projected.revision + 1), revision: projected.revision + 1 }
    records.push(record)
  }
  return records
}
/* v8 ignore next 3 -- only the closed-union default calls this helper. */
function assertNever(value: never): never { throw new Error(`Unknown scheduler record: ${String(value)}`) }
