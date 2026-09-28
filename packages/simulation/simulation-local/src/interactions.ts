/** Independent request replies and evidence-backed commitments. @module @clocky/clocky-simulation-local/interactions */
import { assertCapacity } from './capacity.ts'
import { simulationCommitmentIdSchema } from '@clocky/clocky-simulation'
import type {
  SimTime, SimulationCommitment, SimulationInteraction, SimulationInteractionId, SimulationOperation,
  SimulationOperationAction, SimulationSnapshot,
} from '@clocky/clocky-simulation'
import { denyBusiness as deny, rejectBusiness as reject } from './business-error.ts'

function interaction(state: SimulationSnapshot, id: SimulationInteractionId): SimulationInteraction {
  const value = Object.hasOwn(state.interactions, id) ? state.interactions[id] : undefined
  if (value === undefined) reject('SIM_INTERACTION_NOT_FOUND')
  return value
}
function commitment(state: SimulationSnapshot, request: SimulationInteraction): SimulationCommitment {
  const value = request.commitmentId === undefined ? undefined : state.commitments[request.commitmentId]
  if (value === undefined) reject('SIM_COMMITMENT_NOT_FOUND')
  return value
}
function validTime(state: SimulationSnapshot, time: SimTime | null): void {
  if (time !== null && (BigInt(time) < BigInt(state.time) || BigInt(time) > BigInt(state.spec.maxTime))) reject('SIM_INTERACTION_DEADLINE_INVALID')
}
function update(state: SimulationSnapshot, request: SimulationInteraction, obligation?: SimulationCommitment): SimulationSnapshot {
  return { ...state, interactions: { ...state.interactions, [request.id]: request },
    ...obligation === undefined ? {} : { commitments: { ...state.commitments, [obligation.id]: obligation } } }
}
/**
 * Apply a validated request/reply action under the accepted operation's immutable actor identity.
 * @param state - Current run state.
 * @param operation - Accepted operation owning this transition.
 * @returns updated responsibility projections, or a classified rejection.
 */
export function applyInteraction(state: SimulationSnapshot, operation: SimulationOperation): SimulationSnapshot {
  const action = operation.action
  if (action.kind === 'interaction/request') {
    if (Object.hasOwn(state.interactions, action.id)) reject('SIM_INTERACTION_CONFLICT')
    const assignee = Object.hasOwn(state.entities, action.assignee) ? state.entities[action.assignee] : undefined
    if (assignee?.phase !== 'active' || assignee.cognition !== 'agent') reject('SIM_ASSIGNEE_UNAVAILABLE')
    validTime(state, action.replyBy); validTime(state, action.completeBy)
    if (action.replyBy !== null && action.completeBy !== null && BigInt(action.replyBy) > BigInt(action.completeBy)) reject('SIM_INTERACTION_DEADLINE_INVALID')
    if (action.fulfillment.kind === 'transfer') {
      const from = Object.hasOwn(state.resources, action.fulfillment.from) ? state.resources[action.fulfillment.from] : undefined
      const to = Object.hasOwn(state.resources, action.fulfillment.to) ? state.resources[action.fulfillment.to] : undefined
      if (from === undefined || to === undefined || from.id === to.id || from.kind !== to.kind || from.unit !== to.unit
        || BigInt(action.fulfillment.quantity) > BigInt(state.spec.maxResourceQuantity)) reject('SIM_FULFILLMENT_INVALID')
    }
    assertCapacity(state, 'interactions', 1)
    return update(state, { id: action.id, requester: operation.entityId, assignee: action.assignee,
      description: action.description, replyBy: action.replyBy, completeBy: action.completeBy, fulfillment: action.fulfillment,
      revision: 1, reply: 'pending', execution: 'pending', createdBy: operation.id })
  }
  if (!isReply(action)) throw new Error('Non-interaction action passed to the interaction owner')
  const request = interaction(state, action.id)
  if (request.revision !== action.expectedRevision) reject('SIM_INTERACTION_REVISION_CONFLICT')
  if (action.kind === 'interaction/cancel') {
    if (request.requester !== operation.entityId) deny('SIM_INTERACTION_AUTHORITY')
    if (request.execution !== 'pending' && request.execution !== 'task' || request.reply === 'rejected') reject('SIM_INTERACTION_CLOSED')
    const obligation = request.commitmentId === undefined ? undefined : commitment(state, request)
    if (obligation !== undefined && (obligation.phase !== 'open' || obligation.evidence.length !== 0)) reject('SIM_INTERACTION_EFFECTS_EXIST')
    return update(state, { ...request, execution: request.task === undefined ? 'cancelled' : 'task', revision: request.revision + 1, reason: action.reason },
      obligation === undefined ? undefined : { ...obligation, phase: 'cancelled', revision: obligation.revision + 1 })
  }
  if (action.kind === 'interaction/confirm') {
    if (request.requester !== operation.entityId) deny('SIM_INTERACTION_AUTHORITY')
    const obligation = commitment(state, request)
    if (request.fulfillment.kind !== 'explicit' || obligation.phase !== 'open') reject('SIM_FULFILLMENT_INVALID')
    return update(state, { ...request, execution: request.task === undefined ? 'completed' : 'task', revision: request.revision + 1 },
      { ...obligation, phase: 'fulfilled', revision: obligation.revision + 1, fulfilledAt: state.time, evidence: [operation.id] })
  }
  if (request.assignee !== operation.entityId) deny('SIM_INTERACTION_AUTHORITY')
  if (action.kind === 'interaction/result') {
    const obligation = commitment(state, request)
    if (obligation.phase !== 'fulfilled' || request.resultOperationId !== undefined
      || new Set(action.evidence).size !== action.evidence.length || action.evidence.length !== obligation.evidence.length
      || action.evidence.some(id => !obligation.evidence.includes(id))) reject('SIM_RESULT_BEFORE_FULFILLMENT')
    return update(state, { ...request, revision: request.revision + 1, resultOperationId: operation.id })
  }
  if (request.execution !== 'pending' || request.reply !== 'pending' && request.reply !== 'deferred') reject('SIM_INTERACTION_CLOSED')
  if (request.replyExpiredAt !== undefined || request.replyBy !== null && BigInt(state.time) > BigInt(request.replyBy)) reject('SIM_REPLY_EXPIRED')
  if (request.deferUntil !== undefined && BigInt(state.time) < BigInt(request.deferUntil)) reject('SIM_REPLY_DEFERRED')
  switch (action.kind) {
    case 'interaction/accept': {
      const id = simulationCommitmentIdSchema.parse(`commitment:${JSON.stringify([state.spec.runId, request.id])}`)
      return update(state, { ...request, reply: 'accepted', revision: request.revision + 1, commitmentId: id }, {
        id, interactionId: request.id, debtor: request.assignee, creditor: request.requester,
        revision: 1, phase: 'open', createdBy: operation.id, evidence: [],
      })
    }
    case 'interaction/reject': return update(state, { ...request, reply: 'rejected', revision: request.revision + 1, reason: action.reason })
    case 'interaction/defer': {
      validTime(state, action.until)
      if (BigInt(action.until) <= BigInt(state.time) || request.replyBy !== null && BigInt(action.until) > BigInt(request.replyBy)) reject('SIM_DEFER_INVALID')
      return update(state, { ...request, reply: 'deferred', revision: request.revision + 1, deferUntil: action.until, reason: action.reason })
    }
    /* v8 ignore next 2 -- remaining reply kinds are exhausted above. */
    default: return assertNever(action)
  }
}
function isReply(
  action: SimulationOperationAction,
): action is Extract<SimulationOperationAction, { expectedRevision: number; id: SimulationInteractionId }> {
  return action.kind === 'interaction/accept' || action.kind === 'interaction/reject' || action.kind === 'interaction/defer'
    || action.kind === 'interaction/cancel' || action.kind === 'interaction/confirm' || action.kind === 'interaction/result'
}
/**
 * Accumulate actual world-transfer evidence; fulfillment and resource updates share the settlement record.
 * @param state - Prospective resource state, not yet published.
 * @param operation - Transfer whose effect is being committed.
 * @returns updated commitment and interaction facts.
 */
export function recordTransferEvidence(state: SimulationSnapshot, operation: SimulationOperation): SimulationSnapshot {
  if (operation.action.kind !== 'resource/transfer') throw new Error('Transfer evidence requires a resource transfer')
  const id = operation.action.transaction.commitmentId
  if (id === null) return state
  const obligation = Object.hasOwn(state.commitments, id) ? state.commitments[id] : undefined
  if (obligation === undefined) reject('SIM_COMMITMENT_NOT_FOUND')
  const request = interaction(state, obligation.interactionId)
  if (obligation.phase !== 'open' || request.fulfillment.kind !== 'transfer') reject('SIM_COMMITMENT_CLOSED')
  const policy = request.fulfillment
  const evidence = [...obligation.evidence, operation.id]
  let total = 0n
  for (const evidenceId of evidence) {
    const effect = evidenceId === operation.id ? operation : state.operations[evidenceId]
    if (effect?.action.kind !== 'resource/transfer') throw new Error('Commitment evidence is not an authoritative transfer')
    let contribution = 0n
    for (const transfer of effect.action.transaction.transfers) {
      if (transfer.from === policy.from && transfer.to === policy.to) contribution += BigInt(transfer.quantity)
    }
    if (contribution === 0n) reject('SIM_FULFILLMENT_INVALID')
    total += contribution
  }
  const fulfilled = total >= BigInt(policy.quantity)
  return update(state, fulfilled ? { ...request, execution: request.task === undefined ? 'completed' : 'task', revision: request.revision + 1 } : request,
    { ...obligation, evidence, revision: obligation.revision + 1,
      ...fulfilled ? { phase: 'fulfilled', fulfilledAt: state.time } : {} })
}
/* v8 ignore next 3 -- only the statically unreachable closed-union arm calls this helper. */
function assertNever(value: never): never { throw new Error(`Unknown reply: ${String(value)}`) }
