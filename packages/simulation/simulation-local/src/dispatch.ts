import { assertSimulationMaintenanceAdmission, personnelRetired } from '@clocky/clocky-simulation'
/** Deterministic fair admission and journal-owned window reservations. @module @clocky/clocky-simulation-local/dispatch */
import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import { simulationDispatchCandidateSchema, simulationDispatchSelectionRequestSchema,
  simulationDecisionIdSchema, simulationEventSlotSchema, parseSimTime } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationDecisionDispatch, SimulationDispatchSelectionRequest,
  SimulationDispatchTicket, SimulationWindowRequest, SimulationDecisionId } from '@clocky/clocky-simulation'

/** Complete immutable queue mutations; replay recomputes and verifies allocation order. */
export const dispatchRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('dispatch/queued'), candidate: simulationDispatchCandidateSchema }),
  z.strictObject({ kind: z.literal('dispatch/reserved'), request: simulationDispatchSelectionRequestSchema,
    decisions: z.array(simulationDecisionIdSchema).min(1) }),
  z.strictObject({ kind: z.literal('dispatch/cancelled'), id: simulationDecisionIdSchema }),
])
/** Parsed queue mutation. */
export type DispatchRecord = z.infer<typeof dispatchRecordSchema>
/**
 * Read the queue before or after its first nomination.
 * @param state - Authoritative run projection.
 * @returns retained state or the empty initial queue.
 */
export function decisionDispatch(state: SimulationSnapshot): SimulationDecisionDispatch {
  return state.decisionDispatch ?? { round: simulationEventSlotSchema.parse('0'), nextOrdinal: simulationEventSlotSchema.parse('0'),
    tickets: {}, selections: {} }
}
const compare = (a: bigint, b: bigint): number => a < b ? -1 : a > b ? 1 : 0
/**
 * Select distinct active actors by starvation age, earliest deadline, descending priority and FIFO.
 * @param state - Durable candidates and policy; residency is deliberately not an eligibility condition.
 * @param request - Explicit slot count, bounded by the configured window capacity.
 * @returns the deterministic decision order; no state is mutated.
 */
export function selectDecisions(state: SimulationSnapshot, request: SimulationDispatchSelectionRequest): SimulationDecisionId[] {
  const queue = decisionDispatch(state)
  if (state.phase !== 'running' || state.activeDecisionId !== undefined || state.activeWindowId !== undefined
    || queue.active !== undefined || request.limit > state.spec.maxDecisionsPerWindow) {
    throw new Error('Simulation fair allocation requires an idle running decision coordinator within its window limit')
  }
  const age = (ticket: SimulationDispatchTicket): bigint => BigInt(queue.round) - BigInt(ticket.queuedRound)
  const eligible = Object.values(queue.tickets).filter((ticket) => {
    const entity = state.entities[ticket.candidate.entityId]
    const wake = ticket.candidate.wakeId === undefined ? undefined : state.wakes[ticket.candidate.wakeId]
    return ticket.status === 'queued' && entity?.readiness === 'ready' && entity.phase === 'active' && entity.cognition === 'agent' && entity.binding !== undefined
      && !personnelRetired(state, entity.id)
      && (ticket.candidate.wakeId === undefined || wake?.status === 'pending' && wake.entityId === entity.id)
  }).sort((a, b) => {
    const starvedA = age(a) >= BigInt(state.spec.maxDispatchWaitRounds)
    const starvedB = age(b) >= BigInt(state.spec.maxDispatchWaitRounds)
    if (starvedA !== starvedB) return starvedA ? -1 : 1
    if (starvedA) return compare(BigInt(a.ordinal), BigInt(b.ordinal))
    const deadlineA = a.candidate.deadline, deadlineB = b.candidate.deadline
    if (deadlineA !== deadlineB) {
      if (deadlineA === undefined) return 1
      if (deadlineB === undefined) return -1
      return compare(BigInt(deadlineA), BigInt(deadlineB))
    }
    return compare(BigInt(b.candidate.priority), BigInt(a.candidate.priority)) || compare(BigInt(a.ordinal), BigInt(b.ordinal))
  })
  const entities = new Set<string>()
  return eligible.filter((ticket) => {
    if (entities.has(ticket.candidate.entityId)) return false
    entities.add(ticket.candidate.entityId); return true
  }).slice(0, request.limit).map(ticket => ticket.candidate.id)
}
/**
 * Apply a queue event after checking its authority, budget and deterministic order.
 * @param state - State before the journal record.
 * @param record - Parsed queue mutation.
 * @returns updated durable queue projection.
 */
export function foldDispatch(state: SimulationSnapshot, record: DispatchRecord): SimulationSnapshot {
  const queue = decisionDispatch(state)
  switch (record.kind) {
    case 'dispatch/queued': {
      assertSimulationMaintenanceAdmission(state)
      const candidate = record.candidate
      const entity = state.entities[candidate.entityId]
      if (Object.hasOwn(queue.tickets, candidate.id) || Object.hasOwn(state.decisions, candidate.id)
        || entity?.readiness !== 'ready' || entity.phase !== 'active' || entity.cognition !== 'agent' || entity.binding === undefined) {
        throw new Error('Simulation nomination requires a new decision identity and active bound actor')
      }
      if (Object.values(queue.tickets).filter(ticket => ticket.status === 'queued' || ticket.status === 'reserved').length
        >= state.spec.maxQueuedDecisions) throw new Error('Simulation decision queue capacity exceeded')
      if (candidate.deadline !== undefined) parseSimTime(candidate.deadline, state.spec.maxTime)
      if (candidate.wakeId !== undefined && (state.wakes[candidate.wakeId]?.status !== 'pending'
        || state.wakes[candidate.wakeId]?.entityId !== candidate.entityId
        || Object.values(queue.tickets).some(ticket => ticket.candidate.wakeId === candidate.wakeId
          && (ticket.status === 'queued' || ticket.status === 'reserved')))) throw new Error('Simulation nomination has no exclusive pending wake')
      return { ...state, decisionDispatch: { ...queue,
        nextOrdinal: simulationEventSlotSchema.parse(String(BigInt(queue.nextOrdinal) + 1n)),
        tickets: { ...queue.tickets, [candidate.id]: { candidate, ordinal: queue.nextOrdinal, queuedRound: queue.round, status: 'queued' } } } }
    }
    case 'dispatch/reserved': {
      assertSimulationMaintenanceAdmission(state)
      if (Object.hasOwn(queue.selections, record.request.id) || Object.hasOwn(state.windows ?? {}, record.request.id)
        || !isDeepStrictEqual(selectDecisions(state, record.request), record.decisions)) {
        throw new Error('Simulation allocation changed its identity or fair order')
      }
      const tickets = { ...queue.tickets }
      for (const id of record.decisions) {
        const ticket = tickets[id]
        if (ticket === undefined) throw new Error('Simulation allocation lost its nominated decision')
        tickets[id] = { ...ticket, status: 'reserved' }
      }
      return { ...state, decisionDispatch: { ...queue, tickets, active: record.request.id,
        round: simulationEventSlotSchema.parse(String(BigInt(queue.round) + 1n)),
        selections: { ...queue.selections, [record.request.id]: { request: record.request, round: queue.round,
          decisions: record.decisions, status: 'reserved' } } } }
    }
    case 'dispatch/cancelled': {
      const ticket = Object.hasOwn(queue.tickets, record.id) ? queue.tickets[record.id] : undefined
      if (ticket === undefined || ticket.status === 'opened' || ticket.status === 'cancelled') {
        throw new Error('Simulation nomination has no cancellable queue responsibility')
      }
      const tickets = { ...queue.tickets }
      const selection = queue.active === undefined ? undefined : queue.selections[queue.active]
      const next = { ...queue, tickets }
      if (ticket.status === 'reserved') {
        if (selection === undefined || !selection.decisions.includes(record.id)) throw new Error('Simulation reservation lost its candidate')
        for (const id of selection.decisions) {
          const ticket = tickets[id]
          if (ticket === undefined) throw new Error('Simulation allocation lost its nominated decision')
          tickets[id] = { ...ticket, status: 'cancelled' }
        }
        next.selections = { ...queue.selections, [selection.request.id]: { ...selection, status: 'cancelled' } }
        delete next.active
      } else tickets[record.id] = { ...ticket, status: 'cancelled' }
      return { ...state, decisionDispatch: next }
    }
    /* v8 ignore next -- the persisted discriminant is validated before this closed-union fold. */
    default: return assertNever(record)
  }
}
/* v8 ignore next -- only the statically unreachable closed-union arm calls this helper. */
function assertNever(value: never): never { throw new Error(`Unknown dispatch record: ${String(value)}`) }
/**
 * Consume exactly the reserved order when opening its window; manual windows cannot claim queued identities.
 * @param state - Durable allocation and candidate facts.
 * @param request - Context-bearing window request.
 * @returns queue with opened tickets and no outstanding allocation.
 */
export function openDispatch(state: SimulationSnapshot, request: SimulationWindowRequest): SimulationSnapshot {
  const queue = decisionDispatch(state)
  if (queue.active === undefined) {
    if (Object.hasOwn(queue.selections, request.id) || request.decisions.some(value => Object.hasOwn(queue.tickets, value.id))) throw new Error('Simulation queued decisions require allocation')
    return state
  }
  const selection = queue.selections[queue.active]
  if (selection === undefined) throw new Error('Simulation active allocation is missing')
  if (request.id !== queue.active || !isDeepStrictEqual(request.decisions.map(value => value.id), selection.decisions)
    || request.decisions.some((value) => {
      const candidate = queue.tickets[value.id]?.candidate
      return candidate === undefined || candidate.entityId !== value.entityId || candidate.wakeId !== value.wakeId
    })) throw new Error('Simulation window must preserve its reserved decision order and identities')
  const tickets = { ...queue.tickets }
  for (const id of selection.decisions) tickets[id] = { ...(tickets[id] as SimulationDispatchTicket), status: 'opened' }
  const next = { ...queue, tickets, selections: { ...queue.selections, [request.id]: { ...selection, status: 'opened' as const } } }
  delete next.active
  return { ...state, decisionDispatch: next }
}
/**
 * Check retained candidate ownership against allocation and opened window order.
 * @param state - Authoritative projection to validate at commit and replay boundaries.
 */
export function assertDispatchProjection(state: SimulationSnapshot): void {
  const queue = decisionDispatch(state)
  const seen = new Set<SimulationDecisionId>()
  for (const selection of Object.values(queue.selections)) {
    if ((selection.status === 'reserved') !== (selection.request.id === queue.active)
      || selection.decisions.length > selection.request.limit || BigInt(selection.round) >= BigInt(queue.round)) {
      throw new Error('Simulation dispatch reservation is inconsistent')
    }
    for (const id of selection.decisions) {
      if (seen.has(id) || queue.tickets[id]?.status !== selection.status) throw new Error('Simulation dispatch candidate lost its allocation')
      seen.add(id)
    }
    if (selection.status === 'opened'
      && !isDeepStrictEqual(state.windows?.[selection.request.id]?.request.decisions.map(value => value.id), selection.decisions)) {
      throw new Error('Simulation opened window changed its allocated order')
    }
  }
  if (queue.active !== undefined && !Object.hasOwn(queue.selections, queue.active)) throw new Error('Simulation active allocation is missing')
  const ordinals = new Set<string>()
  for (const ticket of Object.values(queue.tickets)) {
    if (ordinals.has(ticket.ordinal) || BigInt(ticket.ordinal) >= BigInt(queue.nextOrdinal)
      || BigInt(ticket.queuedRound) > BigInt(queue.round)
      || (ticket.status === 'reserved' || ticket.status === 'opened') && !seen.has(ticket.candidate.id)) {
      throw new Error('Simulation dispatch queue ownership or age is inconsistent')
    }
    ordinals.add(ticket.ordinal)
  }
}
