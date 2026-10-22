import { assertRunControlTime } from './run-control.ts'
import { assertFederationTime } from './federation-time.ts'
import { assertWorldEvidenceDeadlineSource, assertWorldEvidenceDeadlineProjection,
  consumeWorldEvidenceDeadline } from './world-evidence-deadline.ts'
import { resourceReservationExpiryId, assertResourceReservationExpirySource,
  consumeResourceReservationExpiry } from './resource-reservation.ts'
import { consumeWorldCalendar, worldCalendarPriority, assertWorldCalendarSource, assertWorldCalendarWakeSource,
  assertWorldCalendarProjection } from './world-calendar.ts'
import { worldResultNotificationActor } from './world-result-role.ts'
import { assertExternalAdjudicatedEventSource, assertExternalAdjudicatedResultWakeSource } from './world-external-mediated-event.ts'
import { applyExternalAdjudicatedEventConsumption, prepareExternalAdjudicatedEventConsumption } from './world-external-mediated.ts'
import { foldWorldFact, worldFactOwner } from './world-facts.ts'
import { requireWorldRuntime } from './world-runtime.ts'
import { assertWorldExecutionTimeSource } from './world-execution-time.ts'
import { directorTriggerFromWake, assertDirectorTrigger } from './world-director-event.ts'
import type { NativeWorldRuntime } from './world-runtime.ts'
import { assertSimulationMaintenanceAdmission, personnelRetired } from '@clocky/clocky-simulation'
import { assertNormAnnouncementSource, assertNormBoundarySource } from './world-norm-announcement.ts'
import { assertGovernanceDeadlineSource, consumeGovernanceDeadline } from './world-governance-deadline.ts'
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
  simulationExternalAdjudicatedEventStateSchema,
} from '@clocky/clocky-simulation'
import type {
  SimTime, SimulationEventAction, SimulationEventId, SimulationEventKey, SimulationEventPhase,
  SimulationOperation, SimulationSnapshot, SimulationScheduledEvent,
  SimulationWorldResult,
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
  z.strictObject({ kind: z.literal('event/consumed'), id: simulationEventIdSchema,
    externalConsumption: simulationExternalAdjudicatedEventStateSchema.shape.consumption.unwrap().optional(),
    recordedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() }),
  z.strictObject({ kind: z.literal('external-event/blocked'), id: simulationEventIdSchema,
    block: simulationExternalAdjudicatedEventStateSchema.shape.blocks.element.omit({ sequence: true }) }),
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
  const priority = (right.priority ?? 0) - (left.priority ?? 0)
  if (priority !== 0) return priority
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
  return action.kind === 'world-calendar' || action.kind === 'wake' || action.kind === 'reply-wake'
    || action.kind === 'conflict-retry' || action.kind === 'ingress' ? 'decision' : 'deadline'
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
  const priority = action.kind === 'world-calendar' ? worldCalendarPriority(state, action) : undefined
  return { time, microstep: simulationEventSlotSchema.parse(String(microstep)), phase: phase(action), slot: state.nextEventSlot,
    ...priority === undefined ? {} : { priority } }
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
  const wakes = Object.values(state.wakes).filter(wake => wake.status === 'claimed'
    || wake.status === 'pending' && !personnelRetired(state, wake.entityId))
  return event.key.phase === 'decision' && same(state.lastEventKey) && wakes.length > 0
    && wakes.every(wake => wake.status === 'pending' && same(state.scheduledEvents[wake.eventId]?.key))
}
function assertRunnable(state: SimulationSnapshot, collecting = false): void {
  assertSimulationMaintenanceAdmission(state)
  if (state.phase !== 'running') throw new Error('Simulation clock is not running')
  if (Object.values(state.operations).some(operation => operation.action.kind === 'communication/post'
    && operation.result?.status === 'applied' && operation.delivery?.receipt === undefined
      && operation.deliveryFailure?.resolution === undefined)) {
    throw new Error('Simulation clock cannot skip an unreceived publication')
  }
  if (Object.values(decisionDispatch(state).tickets).some(ticket => ticket.status === 'reserved'
    || ticket.status === 'queued' && !personnelRetired(state, ticket.candidate.entityId))
    || state.activeDecisionId !== undefined || state.activeWindowId !== undefined
    || Object.values(state.wakes).some(wake => wake.status === 'claimed'
      || wake.status === 'pending' && !collecting && !personnelRetired(state, wake.entityId))
    || (nextLocalOperation(state) !== undefined && dependenciesReady(state, nextLocalOperation(state) as SimulationOperation))
    || Object.values(state.operations).some(operation => isOutboxAction(operation.action)
      && operation.outbox?.ready === true && operation.result === undefined && dependenciesReady(state, operation))) {
    throw new Error('Simulation must settle current decisions and operations before advancing time')
  }
}
function consume(state: SimulationSnapshot, event: SimulationScheduledEvent, sequence: number,
  runtime?: NativeWorldRuntime): SimulationSnapshot {
  const action = event.action
  switch (action.kind) {
    case 'resource-reservation-expiry': return consumeResourceReservationExpiry(state, event, sequence)
    case 'world-calendar': return consumeWorldCalendar(state, event, sequence)
    case 'external-adjudicated-event':
      throw new Error('Finite adjudication consumption requires its actual retained publication')
    case 'world-execution-time': assertWorldExecutionTimeSource(state, event); return state
    case 'norm-boundary': {
      assertNormBoundarySource(state, event)
      return state
    }
    case 'world-evidence-deadline': return consumeWorldEvidenceDeadline(state, event, runtime)
    case 'governance-deadline': return consumeGovernanceDeadline(state, event)
    case 'ingress': {
      const ingress = state.ingresses?.[action.ingressId]
      if (ingress === undefined) throw new Error('Simulation ingress event lost its receipt')
      return consume(state, { ...event, action: { kind: 'wake', entityId: ingress.request.entityId,
        reason: `External input ${ingress.request.id} from ${ingress.request.source}` } }, sequence, runtime)
    }
    case 'conflict-retry': {
      const operation = state.operations[action.operationId]
      if (operation === undefined) throw new Error('Simulation conflict retry lost its failed operation')
      return consume(state, { ...event, action: { kind: 'wake', entityId: operation.entityId,
        reason: `Refresh reads after resource conflict ${operation.id}; retry ${action.attempt} of ${state.spec.maxConflictRetries}. Do not repeat applied effects.` } }, sequence, runtime)
    }
    case 'outbox-ready': {
      const operation = state.operations[action.operationId]
      if (!isOutboxAction(operation?.action) || operation.outbox === undefined) throw new Error('Scheduled outbox intent is missing')
      return { ...state, operations: { ...state.operations, [operation.id]: {
        ...operation, outbox: { ...operation.outbox, ready: true },
      } } }
    }
    case 'wake': {
      const question = Object.values(state.world?.evidence.challenges ?? {}).find(value =>
        event.id === `simulation-delivery:${value.notificationOperationId}`)
      if (question !== undefined && (question.status !== 'awaiting' || BigInt(state.time) >= BigInt(question.deadline)))
        return { ...state, wakes: { ...state.wakes, [event.id]: { eventId: event.id, entityId: action.entityId,
          reason: action.reason, status: 'cancelled', cancellation: 'Evidence challenge no longer accepts answers' } } }
      const entity = Object.hasOwn(state.entities, action.entityId) ? state.entities[action.entityId] : undefined
      if (entity === undefined) throw new Error('Scheduled wake entity is missing')
      if (entity.readiness !== 'ready' || entity.phase !== 'active' || entity.cognition !== 'agent') return { ...state,
        wakes: { ...state.wakes, [event.id]: {
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
          eventId: event.id, entityId: request.assignee, reason: `Reply to ${request.id}`, status: 'cancelled',
          cancellation: 'Reply no longer pending',
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
 * @param runtime - Original held domain catalog for validating a world onboarding consequence.
 * @returns the complete prospective state without advancing its journal tail.
 */
export function foldSchedulerRecord(state: SimulationSnapshot, record: SchedulerRecord, sequence: number,
  runtime?: NativeWorldRuntime): SimulationSnapshot {
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
      if (entity?.readiness !== 'ready' || entity.phase !== 'active' || entity.cognition !== 'agent'
        || entity.kind === 'generation-assistant'
        || Object.hasOwn(state.ingresses ?? {}, request.id)
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
      assertEventSource(state, record, runtime)
      assertCapacity(state, 'events', 1)
      if (!isDeepStrictEqual(record.key, allocateEventKey(state, record.key.time, record.action)))
        throw new Error('Simulation event key is not the next policy allocation')
      if (record.sourceOperationId !== undefined && state.operations[record.sourceOperationId]?.result?.status !== 'applied'
        && record.action.kind !== 'conflict-retry'
        && record.action.kind !== 'governance-deadline'
        && record.action.kind !== 'world-evidence-deadline'
        && record.action.kind !== 'world-execution-time'
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
      if (event.action.kind === 'norm-boundary') throw new Error('Original institution effective/expiry boundaries cannot be cancelled')
      if (event.action.kind === 'resource-reservation-expiry' && state.resourceReservations[event.action.id]?.phase === 'active')
        throw new Error('Active resource expiry cannot be cancelled without settling its original hold')
      if (event.action.kind === 'world-evidence-deadline' && (record.reason !== 'Original evidence challenge settled'
        || assertWorldEvidenceDeadlineSource(state, event).status === 'awaiting'))
        throw new Error('Evidence deadline cancellation requires its original settled challenge')
      if (event.action.kind === 'world-execution-time') throw new Error('Original World execution time boundaries remain immutable')
      if (event.action.kind === 'external-adjudicated-event')
        throw new Error('Original adjudication duties remain pending until their verified consumption')
      if (event.action.kind === 'governance-deadline' && (record.reason !== 'Governance resolution retained'
        || !Object.values(state.world?.governance.resolutions ?? {}).some(value =>
          event.action.kind === 'governance-deadline' && value.proposalId === event.action.proposalId))) {
        throw new Error('A frozen governance deadline can only close with its original retained resolution')
      }
      const next: SimulationSnapshot = { ...state, scheduledEvents: { ...state.scheduledEvents, [record.id]: {
        ...event, status: 'cancelled', settledAt: sequence, cancellation: record.reason,
      } } }
      if (event.action.kind === 'outbox-ready') {
        const operation = state.operations[event.action.operationId]
        if (!isOutboxAction(operation?.action) || operation.outbox?.attempts.length !== 0) {
          throw new Error('Only an unattempted outbox publication can be cancelled with its readiness event')
        }
        return { ...next, operations: { ...next.operations, [operation.id]: { ...operation, status: 'rejected',
          result: { operationId: operation.id, status: 'rejected',
            code: operation.action.kind === 'task/create' ? 'SIM_TASK_CANCELLED' : 'SIM_POST_CANCELLED', sequence, time: state.time } } } }
      }
      return next
    }
    case 'wake/cancelled': {
      const wake = state.wakes[record.id]
      if (wake === undefined || wake.status === 'completed' || wake.status === 'cancelled')
        throw new Error('Simulation wake has no pending responsibility')
      const next = { ...state, wakes: { ...state.wakes, [record.id]: { ...wake, status: 'cancelled' as const,
        cancellation: record.reason } } }
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
      if (collecting && !canCollectDecisionEvent(state, event))
        throw new Error('Simulation event cannot extend this unclaimed decision cohort')
      assertRunnable(state, collecting)
      if (event.status !== 'pending' || nextScheduledEvent(state)?.id !== event.id)
        throw new Error('Simulation event is not next to consume')
      if (BigInt(event.key.time) < BigInt(state.time) || BigInt(event.key.microstep) >= BigInt(state.spec.maxMicrostepsPerTime)) {
        throw new Error('Simulation event cannot advance this clock')
      }
      assertFederationTime(state, event.key.time)
      assertRunControlTime(state, event.key.time)
      let next: SimulationSnapshot = { ...state, time: event.key.time, lastEventKey: event.key,
        scheduledEvents: { ...state.scheduledEvents, [event.id]: { ...event, status: 'consumed', settledAt: sequence } } }
      if (event.action.kind === 'external-adjudicated-event') {
        if (record.kind !== 'event/consumed' || record.externalConsumption === undefined || record.recordedAt === undefined
          || record.externalConsumption.sequence !== sequence || record.externalConsumption.time !== event.key.time)
          throw new Error('Finite adjudication consumption lacks its actual retained publication and clock')
        const duty = assertExternalAdjudicatedEventSource(state, event)
        const applied = applyExternalAdjudicatedEventConsumption({ ...state, time: event.key.time }, duty, record.externalConsumption)
        if (next.world === undefined) throw new Error('Finite adjudication lost its World')
        next = { ...next, world: { ...next.world, external: { ...next.world.external,
          events: { ...next.world.external.events, [event.id]: { ...duty, status: 'consumed', consumption: applied.consumption } } } } }
        for (const publication of applied.publications) {
          const { sources, ...input } = publication
          next = foldWorldFact(next, { kind: 'world/fact-recorded', fact: { ...input,
            source: { kind: 'owner', owner: worldFactOwner(next), references: sources }, sequence,
            recordedAt: record.recordedAt } }, sequence)
        }
        return next
      }
      if (record.kind === 'event/consumed' && (record.externalConsumption !== undefined || record.recordedAt !== undefined))
        throw new Error('Another scheduled family cannot supply adjudication consumption metadata')
      return consume(next, event, sequence, runtime)
    }
    case 'external-event/blocked': {
      const event = requireEvent(state, record.id)
      assertRunnable(state)
      if (event.action.kind !== 'external-adjudicated-event' || event.status !== 'pending'
        || nextScheduledEvent(state)?.id !== event.id || record.block.time !== event.key.time)
        throw new Error('Adjudication block requires its original next pending duty')
      const duty = assertExternalAdjudicatedEventSource(state, event)
      const checked = prepareExternalAdjudicatedEventConsumption({ ...state, time: event.key.time }, duty, sequence)
      if (!('block' in checked) || !isDeepStrictEqual(checked.block,
        { code: record.block.code, currentReadSetHash: record.block.currentReadSetHash }) || state.world === undefined)
        throw new Error('Adjudication block differs from its actual current constraint failure')
      return { ...state, phase: 'stalled', stall: { code: 'SIM_EXTERNAL_ADJUDICATION_BLOCKED', eventId: event.id,
        reason: record.block.code, recovery: 'inspect-original-duty-and-explicitly-resume' },
      world: { ...state.world, external: { ...state.world.external, events: { ...state.world.external.events,
        [event.id]: { ...duty, status: 'blocked', blocks: [...duty.blocks, { ...record.block, sequence }] } } } } }
    }
    case 'clock/advanced': {
      assertFederationTime(state, record.time)
      assertRunControlTime(state, record.time)
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
 * @param runtime - Original domain catalog for a World result consequence; base effects need no catalog.
 * @returns exact queue mutations for the same atomic batch.
 */
export function schedulerConsequences(state: SimulationSnapshot, operation: SimulationOperation,
  runtime?: NativeWorldRuntime): SchedulerRecord[] {
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
    projected = { ...foldSchedulerRecord(projected, record, projected.revision + 1, runtime), revision: projected.revision + 1 }
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
    const obsolete = request !== undefined && (request.execution !== 'pending' || request.reply === 'accepted'
      || request.reply === 'rejected'
      || request.replyExpiredAt !== undefined || action.kind === 'reply-wake' && request.deferUntil !== event.key.time)
      || commitment !== undefined && commitment.phase !== 'open'
    if (!obsolete) continue
    if (event.status === 'pending') add({ kind: 'event/cancelled', id: event.id, reason: 'Business responsibility changed' })
    const wake = projected.wakes[event.id]
    if (wake?.status === 'pending' || wake?.status === 'claimed') add({ kind: 'wake/cancelled', id: event.id,
      reason: 'Business responsibility changed' })
  }
  const action = operation.action
  if (action.kind === 'world/resolve') {
    const result = Object.values(state.world?.results ?? {}).find(value => value.source.kind === 'plan'
      && state.world?.plans[value.source.planId]?.operationId === operation.id)
    if (result !== undefined) for (const record of worldResultWakeRecords(projected, result, runtime)) add(record)
  }
  if (action.kind === 'resource/reserve') {
    const hold = state.resourceReservations[action.id]
    if (hold?.createdOperationId === operation.id) {
      const expiry = { kind: 'resource-reservation-expiry' as const, id: hold.id, revision: 1 }
      add({ kind: 'event/queued', id: resourceReservationExpiryId(hold.id), key: allocateEventKey(projected, hold.expiresAt, expiry),
        action: expiry, sourceOperationId: operation.id })
    }
  }
  if (action.kind === 'resource/commit-reservation' || action.kind === 'resource/cancel-reservation') {
    const hold = state.resourceReservations[action.id], event = projected.scheduledEvents[resourceReservationExpiryId(action.id)]
    if (hold?.settlement?.kind === 'operation' && hold.settlement.operationId === operation.id && event?.status === 'pending')
      add({ kind: 'event/cancelled', id: event.id, reason: 'Original resource reservation settled' })
  }
  if (action.kind === 'interaction/request') queue(action.replyBy, { kind: 'reply-deadline', interactionId: action.id })
  if (action.kind === 'interaction/defer') queue(action.until, { kind: 'reply-wake', interactionId: action.id })
  if (action.kind === 'interaction/accept') {
    const request = state.interactions[action.id]
    if (request?.commitmentId === undefined) throw new Error('Accepted interaction has no commitment')
    queue(request.completeBy, { kind: 'commitment-deadline', commitmentId: request.commitmentId })
  }
  return records
}

/**
 * Retain the pinned domain’s canonical result speaker wake with the terminal business result.
 * @param state - Projection including the result, before its wake is queued.
 * @param result - Original structured result; director free text is excluded.
 * @param runtime - Original domain catalog whose fixed notification role derives the speaker.
 * @returns one deterministic event, or none if its original event is already retained.
 */
export function worldResultWakeRecords(state: SimulationSnapshot, result: SimulationWorldResult,
  runtime?: NativeWorldRuntime): SchedulerRecord[] {
  if (state.world?.requests[result.requestId]?.operationId === null) return []
  const id = simulationEventIdSchema.parse(`simulation-world-result:${result.id}`)
  if (Object.hasOwn(state.scheduledEvents, id)) return []
  const actor = worldResultNotificationActor(state, result, runtime)
  const action = { kind: 'wake' as const, entityId: actor, reason: JSON.stringify({ resultId: result.id }) }
  return [{ kind: 'event/queued', id, key: allocateEventKey(state, result.time, action), action }]
}
/**
 * Derive onboarding from the exact original installed domain, without allocating a new actor or channel.
 * @param state - Projection containing the atomic committed result.
 * @param result - Actual retained result and business identity.
 * @param runtime - Original explicitly installed domain catalog.
 * @returns original first-action wake, or none when the domain has no onboarding consequence.
 */
export function worldFirstActionWakeRecords(state: SimulationSnapshot, result: SimulationWorldResult,
  runtime: NativeWorldRuntime | undefined): SchedulerRecord[] {
  if (result.outcome.kind !== 'committed') return []
  const intent = state.world?.intents[result.intentId]
  if (intent === undefined) throw new Error('World first action lost its original intent')
  const actor = requireWorldRuntime(runtime).original(intent.pin).firstActionActor?.(state, intent, result)
  if (actor === undefined) return []
  const id = simulationEventIdSchema.parse(`simulation-world-first:${intent.id}`)
  if (Object.hasOwn(state.scheduledEvents, id)) return []
  const action = { kind: 'wake' as const, entityId: actor, reason: JSON.stringify({ resultId: result.id }) }
  return [{ kind: 'event/queued', id, key: allocateEventKey(state, result.time, action), action }]
}

function assertEventSource(state: SimulationSnapshot, event: Extract<SchedulerRecord, { kind: 'event/queued' }>,
  runtime?: NativeWorldRuntime): void {
  if (event.action.kind === 'world-calendar') {
    if (event.sourceOperationId !== undefined) throw new Error('A world calendar belongs to its original scenario declaration')
    assertWorldCalendarSource(state, event)
    return
  }
  if (event.id.startsWith('simulation-world-calendar-wake:')) {
    if (event.sourceOperationId !== undefined) throw new Error('A calendar goal belongs to its actual original occurrence')
    assertWorldCalendarWakeSource(state, event)
    return
  }
  if (event.action.kind === 'external-adjudicated-event') {
    if (event.sourceOperationId !== undefined) throw new Error('A finite adjudication belongs to its original Native mutation')
    assertExternalAdjudicatedEventSource(state, event)
    return
  }
  if (event.action.kind === 'resource-reservation-expiry') { assertResourceReservationExpirySource(state, event); return }
  if (event.action.kind === 'world-evidence-deadline') { assertWorldEvidenceDeadlineSource(state, event); return }
  if (event.action.kind === 'world-execution-time') { assertWorldExecutionTimeSource(state, event); return }
  if (event.action.kind === 'norm-boundary') {
    if (event.sourceOperationId !== undefined) throw new Error('An institution boundary belongs to its original Native mutation')
    assertNormBoundarySource(state, event)
    return
  }
  if (event.action.kind === 'governance-deadline') {
    assertGovernanceDeadlineSource(state, event)
    return
  }
  if (event.action.kind === 'ingress') {
    const ingress = state.ingresses?.[event.action.ingressId]
    if (event.sourceOperationId !== undefined || ingress?.eventId !== event.id || !isDeepStrictEqual(ingress.key, event.key)) {
      throw new Error('Simulation ingress event differs from its receipt assignment')
    }
    return
  }
  if (event.action.kind === 'wake') {
    if (event.id.startsWith('simulation-world-director-event:')) {
      // Its entry and wake are published atomically by calendar consumption; queue validation precedes the wake dictionary update.
      const candidate = { ...state, scheduledEvents: { ...state.scheduledEvents, [event.id]: event } }
      directorTriggerFromWake(candidate, event.id)
      return
    }
    if (event.id.startsWith('simulation-world-scenario-resolve:')) {
      const request = Object.values(state.world?.requests ?? {}).find(value => event.id === `simulation-world-scenario-resolve:${value.id}`)
      if (request?.operationId === null || request?.notificationOperationId !== null || request.source.trigger === undefined
        || event.sourceOperationId !== undefined || event.action.entityId !== state.world?.definition.directorEntityId
        || event.action.reason !== JSON.stringify({ scenarioRequestId: request.id })
        || event.key.time !== state.decisions[request.source.decisionId]?.time)
        throw new Error('Scenario planning wake differs from its original accepted Native request')
      assertDirectorTrigger(state, request.source.trigger)
      return
    }
    if (event.id.startsWith('simulation-external-adjudication-result:')) {
      if (event.sourceOperationId !== undefined) throw new Error('Adjudication notification belongs to its actual Native consumption')
      assertExternalAdjudicatedResultWakeSource(state, event)
      return
    }
    if (event.sourceOperationId !== undefined) throw new Error('Administrative wakes cannot impersonate a business consequence')
    if (event.id.startsWith('simulation-norm-announcement:')) assertNormAnnouncementSource(state, event)
    if (event.id.startsWith('simulation-world-result:')) {
      const result = Object.values(state.world?.results ?? {}).find(value => event.id === `simulation-world-result:${value.id}`)
      const request = result === undefined ? undefined : state.world?.requests[result.requestId]
      if (result === undefined || request === undefined || event.key.time !== result.time
        || event.action.entityId !== worldResultNotificationActor(state, result, runtime)
        || event.action.reason !== JSON.stringify({ resultId: result.id })) {
        throw new Error('World result wake differs from its original business result')
      }
    }
    if (event.id.startsWith('simulation-world-first:')) {
      const result = Object.values(state.world?.results ?? {}).find(value => event.id === `simulation-world-first:${value.intentId}`)
      const intent = result === undefined ? undefined : state.world?.intents[result.intentId]
      const actor = intent === undefined || result === undefined ? undefined
        : requireWorldRuntime(runtime).original(intent.pin).firstActionActor?.(state, intent, result)
      if (result?.outcome.kind !== 'committed' || actor === undefined
        || event.action.entityId !== actor || event.key.time !== result.time
        || event.action.reason !== JSON.stringify({ resultId: result.id })) {
        throw new Error('World first-action wake differs from its original committed domain result')
      }
    }
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
  const exists = action.kind === 'resource-reservation-expiry' ? Object.hasOwn(state.resourceReservations, action.id)
    : action.kind === 'world-calendar' ? state.worldBootstrap !== undefined
      : action.kind === 'external-adjudicated-event' ? Object.values(state.world?.external.events ?? {})
        .some(event => event.original.intentId === action.intentId && event.original.leafHash === action.leafHash)
        : action.kind === 'world-evidence-deadline' ? Object.hasOwn(state.world?.evidence.challenges ?? {}, action.challengeId)
          : action.kind === 'world-execution-time' ? Object.hasOwn(state.world?.intents ?? {}, action.intentId)
            : action.kind === 'norm-boundary' ? state.world?.norms.versions[action.norm.id]?.some(value =>
              value.version === action.norm.version) === true
              : action.kind === 'governance-deadline' ? Object.hasOwn(state.world?.governance.proposals ?? {}, action.proposalId)
                : action.kind === 'ingress' ? Object.hasOwn(state.ingresses ?? {}, action.ingressId)
                  : action.kind === 'outbox-ready' || action.kind === 'conflict-retry' ? Object.hasOwn(state.operations, action.operationId)
                    : action.kind === 'wake' ? Object.hasOwn(state.entities, action.entityId)
                      : action.kind === 'commitment-deadline' ? Object.hasOwn(state.commitments, action.commitmentId)
                        : Object.hasOwn(state.interactions, action.interactionId)
  if (!exists) throw new Error('Simulation scheduled event references a missing domain object')
}
function internalEventId(state: SimulationSnapshot, operation: SimulationOperation,
  kind: SimulationEventAction['kind']): SimulationEventId {
  return simulationEventIdSchema.parse(`simulation-event:${businessFingerprint([state.spec.runId, operation.id, kind]).slice(7)}`)
}
/** Verify every applied operation retains its required scheduled responsibility.
 * @param state - Projection at a complete durable tail.
 * @param runtime - Original held domain catalog for checking committed onboarding obligations.
 */
export function assertSchedulerProjection(state: SimulationSnapshot, runtime?: NativeWorldRuntime): void {
  assertWorldEvidenceDeadlineProjection(state)
  assertWorldCalendarProjection(state)
  for (const result of Object.values(state.world?.results ?? {})) {
    if (result.outcome.kind !== 'committed') continue
    const intent = state.world?.intents[result.intentId]
    if (intent === undefined) throw new Error('World onboarding result lost its original intent')
    const actor = requireWorldRuntime(runtime).original(intent.pin).firstActionActor?.(state, intent, result)
    if (actor === undefined) continue
    const event = state.scheduledEvents[simulationEventIdSchema.parse(`simulation-world-first:${intent.id}`)]
    if (event?.action.kind !== 'wake' || event.action.entityId !== actor || event.key.time !== result.time
      || event.action.reason !== JSON.stringify({ resultId: result.id })) {
      throw new Error('Committed world onboarding lost its atomic first-action responsibility')
    }
  }
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
    if (!resourceConflict(operation) || retries.has(operation.decisionId))
      throw new Error('Simulation conflict responsibility is duplicated or unsupported')
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
    if (resourceConflict(operation) && !retries.has(operation.decisionId))
      throw new Error('Simulation resource conflict has no retry disposition')
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
  return (operation.action.kind === 'resource/transfer' || operation.action.kind === 'resource/grant'
    || operation.action.kind === 'resource/reserve' || operation.action.kind === 'resource/commit-reservation')
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
