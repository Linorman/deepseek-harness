import { independentPersonnelEligibility, personnelRoleAuthorities } from './personnel-authorities.ts'
/** Pure Native personnel inventory; Team/Channel observation is a separate required owner responsibility. */
import { PersonnelObligationError, personnelObligationQuerySchema, boundPersonnelObligationReport,
  personnelObligationSchema } from '@clocky/clocky-simulation'
import type { PersonnelObligation, PersonnelObligationQuery, PersonnelObligationReference, PersonnelObligationReport,
  SimulationSnapshot, SimulationEntityId, SimulationOperation, SimulationScheduledEvent } from '@clocky/clocky-simulation'
import { requireWorldRuntime } from './world-runtime.ts'
import type { NativeWorldRuntime } from './world-runtime.ts'

function lookup<T>(values: Readonly<Record<string, T>>, id: string): T | undefined {
  return Object.hasOwn(values, id) ? values[id] : undefined
}
function interactionTouches(state: SimulationSnapshot, id: string, person: SimulationEntityId): boolean {
  const value = lookup(state.interactions, id)
  return value !== undefined && (value.requester === person || value.assignee === person)
}
function operationTouches(state: SimulationSnapshot, value: SimulationOperation, person: SimulationEntityId): boolean {
  if (value.entityId === person) return true
  const action = value.action
  switch (action.kind) {
    case 'communication/post': return action.recipient === person
    case 'interaction/request': return action.assignee === person
    case 'interaction/accept': case 'interaction/reject': case 'interaction/defer': case 'interaction/cancel':
    case 'interaction/confirm': case 'interaction/result': return interactionTouches(state, action.id, person)
    case 'resource/grant': return action.grantee === person
    case 'resource/reserve': case 'resource/commit-reservation': case 'resource/cancel-reservation':
    case 'world/request': case 'world/resolve': case 'world/evidence': case 'task/create': case 'resource/transfer': case 'resource/revoke-grant': return false
    default: return assertNever(action)
  }
}
function eventTouches(state: SimulationSnapshot, event: SimulationScheduledEvent, person: SimulationEntityId): boolean {
  const action = event.action
  switch (action.kind) {
    case 'wake': return action.entityId === person
    case 'ingress': return lookup(state.ingresses ?? {}, action.ingressId)?.request.entityId === person
    case 'conflict-retry': case 'outbox-ready': {
      const operation = lookup(state.operations, action.operationId)
      return operation !== undefined && operationTouches(state, operation, person)
    }
    case 'reply-wake': case 'reply-deadline': return interactionTouches(state, action.interactionId, person)
    case 'commitment-deadline': {
      const commitment = lookup(state.commitments, action.commitmentId)
      return commitment !== undefined && (commitment.debtor === person || commitment.creditor === person)
    }
    case 'governance-deadline': {
      const proposal = lookup(state.world?.governance.proposals ?? {}, action.proposalId)
      const voted = Object.values(state.world?.governance.votes ?? {}).some(value =>
        value.proposalId === action.proposalId && value.voter === person)
      return proposal !== undefined && (proposal.proposer === person
        || proposal.electorate.some(value => value.entityId === person) && !voted)
    }
    case 'resource-reservation-expiry': return state.resourceReservations[action.id]?.actorId === person
    case 'world-evidence-deadline': return false // The original case and notification retain each actor's evidence responsibility.
    case 'world-execution-time': return false // Original World case duties cover this run-owned immutable clock boundary.
    case 'external-adjudicated-event': return state.world?.intents[action.intentId]?.requesterEntityId === person
      || state.world?.definition.directorEntityId === person
    case 'world-calendar': return false // The run resolves actual recipients when this authored occurrence fires.
    case 'norm-boundary': return false // A scope-wide rule boundary remains run-owned after one person's departure.
    default: return assertNever(action)
  }
}

/**
 * Inspect actual local relationships before transfer/departure without disposing, cancelling, acknowledging or writing anything.
 * @param state - Authoritative Native snapshot at the exact returned cursor.
 * @param input - Original person/assignment revision selector plus complete output limits.
 * @param runtime - Original pinned pure domain catalog; required for a configured World, including read-only restoration.
 * @returns bounded Native inventory with Team coverage required, even when no local obligations remain.
 */
export function inspectPersonnelObligations(state: SimulationSnapshot, input: PersonnelObligationQuery,
  runtime?: NativeWorldRuntime): PersonnelObligationReport {
  const query = personnelObligationQuerySchema.parse(input), selected = query.selector
  const person = lookup(state.entities, selected.personId)
  if (person?.kind !== 'person') throw new PersonnelObligationError('SIM_PERSONNEL_SELECTOR', 'Personnel selector must identify an existing person')
  if (person.revision !== selected.personRevision) throw new PersonnelObligationError('SIM_PERSONNEL_STALE', 'Personnel selector lost its exact person revision')
  if (selected.kind === 'assignment') {
    const assignment = lookup(state.relations, selected.assignmentId)
    if (assignment?.relation !== 'assignment' || assignment.subject !== person.id) {
      throw new PersonnelObligationError('SIM_PERSONNEL_SELECTOR', 'Personnel assignment must belong to its exact selected person')
    }
    if (assignment.revision !== selected.assignmentRevision) {
      throw new PersonnelObligationError('SIM_PERSONNEL_STALE', 'Personnel assignment selector lost its exact original revision')
    }
  }
  if (state.world !== undefined) requireWorldRuntime(runtime).manifest(state.world.definition)
  const entries = new Map<string, PersonnelObligation>()
  const owner = (subsystem: Extract<PersonnelObligation['owner'], { kind: 'native' }>['subsystem']): PersonnelObligation['owner'] =>
    ({ kind: 'native', runId: state.spec.runId, subsystem })
  const add = (ref: PersonnelObligationReference, category: PersonnelObligation['category'], status: string,
    dispositions: PersonnelObligation['dispositions'], certainty: PersonnelObligation['certainty'] = 'recorded',
    originalOwner: PersonnelObligation['owner'] = owner('operation')) => {
    const value = personnelObligationSchema.parse({ ref, owner: originalOwner, category, state: status, dispositions, certainty })
    entries.set(JSON.stringify(value.ref), value)
  }

  for (const decision of Object.values(state.decisions)) {
    if (decision.entityId === person.id && (decision.status === 'open' || decision.status === 'submitted')) {
      add({ kind: 'decision', id: decision.id, epoch: decision.epoch, slot: decision.slot }, 'decision', decision.status,
        ['wait', 'cancel-supported'], 'recorded', owner('decision'))
    }
  }
  for (const operation of Object.values(state.operations)) {
    if (!operationTouches(state, operation, person.id)) continue
    const unresolved = operation.status !== 'applied' && operation.status !== 'rejected'
    const lastAttempt = operation.outbox?.attempts.at(-1)
    const uncertain = operation.status === 'outcome-unknown' || lastAttempt?.outcome === 'in-flight' || lastAttempt?.outcome === 'uncertain'
    if (unresolved || uncertain) {
      add({ kind: 'operation', id: operation.id, decisionId: operation.decisionId, index: operation.index,
        fingerprint: operation.fingerprint }, 'operation', operation.status, ['wait'], uncertain ? 'outcome-unknown' : 'recorded')
    }
    if (operation.outbox !== undefined && (unresolved || uncertain)) {
      add({ kind: 'outbox', operationId: operation.id, fingerprint: operation.fingerprint, attempt: lastAttempt?.number ?? null },
        'outbox', lastAttempt?.outcome ?? 'not-dispatched', ['wait'], uncertain ? 'outcome-unknown' : 'recorded', owner('outbox'))
    }
    if (operation.action.kind === 'communication/post') {
      const receiverWake = operation.delivery === undefined ? undefined : lookup(state.wakes, operation.delivery.wakeId)
      const delivered = operation.delivery?.receipt !== undefined && (receiverWake?.status === 'completed' || receiverWake?.status === 'cancelled')
      if (unresolved || uncertain || operation.status === 'applied' && !delivered || operation.deliveryFailure?.resolution === undefined
        && operation.deliveryFailure !== undefined) {
        add({ kind: 'message', operationId: operation.id, channelId: operation.action.channelId,
          recipientEntityId: operation.action.recipient, direction: operation.action.recipient === person.id ? 'incoming' : 'outgoing',
          envelopeId: operation.outbox?.receipt?.envelopeId ?? null }, 'message', operation.deliveryFailure === undefined
          ? operation.delivery?.receipt === undefined ? 'awaiting-delivery' : receiverWake?.status ?? 'recipient-wake-unknown'
          : 'delivery-failure-unresolved', ['wait'], uncertain ? 'outcome-unknown' : 'recorded',
        { kind: 'channel', channelId: operation.action.channelId })
      }
    }
    if (operation.action.kind === 'task/create' && operation.entityId === person.id && operation.outbox?.taskReceipt !== undefined) {
      const receipt = operation.outbox.taskReceipt
      add({ kind: 'task-target', teamId: receipt.teamId, taskId: receipt.taskId, operationId: operation.id,
        fingerprint: receipt.fingerprint }, 'task-target', 'created-task-current-state-required', ['handoff-required'],
      'external-observation-required', { kind: 'team', teamId: receipt.teamId })
    }
  }
  for (const execution of Object.values(state.taskExecutions ?? {})) {
    const request = execution.request
    if (request.entityId !== person.id) continue
    if (execution.retired === undefined || execution.task === undefined) {
      add({ kind: 'task-assignment', teamId: request.teamId, taskId: request.taskId, attemptId: request.attemptId,
        operationId: request.operationId, selectedRevision: request.taskRevision, reservedSequence: execution.reservedSequence },
      'task-assignment', execution.task === undefined ? 'assignment-outcome-unobserved' : 'assignment-observed', ['wait'],
      execution.task === undefined ? 'outcome-unknown' : 'recorded', { kind: 'team', teamId: request.teamId })
    }
    if (execution.retired === undefined || execution.result === undefined
      && (execution.task === undefined || !['completed', 'failed', 'cancelled', 'deleted'].includes(execution.task.phase))) {
      add({ kind: 'task-execution', teamId: request.teamId, taskId: request.taskId, attemptId: request.attemptId,
        selectedRevision: request.taskRevision, observedRevision: execution.task?.revision ?? null }, 'task-execution',
      execution.retired === undefined ? execution.task?.phase ?? 'attempt-unobserved' : execution.task?.phase ?? 'retired-without-result',
      ['wait', 'handoff-required'], execution.task === undefined ? 'outcome-unknown' : 'recorded', { kind: 'team', teamId: request.teamId })
    }
  }
  for (const interaction of Object.values(state.interactions)) {
    if (interaction.requester !== person.id && interaction.assignee !== person.id) continue
    const awaitingReply = (interaction.reply === 'pending' || interaction.reply === 'deferred')
      && interaction.execution !== 'cancelled' && interaction.execution !== 'completed'
    const taskOpen = interaction.execution === 'task' && (interaction.task === undefined
      || !['completed', 'failed', 'cancelled', 'deleted'].includes(interaction.task.phase))
    if (awaitingReply || interaction.execution === 'pending' || taskOpen) {
      const obligation = interaction.commitmentId === undefined ? undefined : lookup(state.commitments, interaction.commitmentId)
      const cancel = interaction.requester === person.id && interaction.reply !== 'rejected'
        && (obligation === undefined || obligation.phase === 'open' && obligation.evidence.length === 0)
      add({ kind: 'interaction', id: interaction.id, revision: interaction.revision }, 'interaction',
        `${interaction.reply}/${interaction.execution}`, cancel ? ['wait', 'cancel-supported'] : ['wait', 'handoff-required'],
        'recorded', owner('interaction'))
    }
  }
  for (const commitment of Object.values(state.commitments)) {
    if (commitment.phase === 'open' && (commitment.debtor === person.id || commitment.creditor === person.id)) {
      add({ kind: 'commitment', id: commitment.id, revision: commitment.revision }, 'commitment', 'open', ['wait', 'handoff-required'],
        'recorded', owner('interaction'))
    }
  }
  for (const resource of Object.values(state.resources)) {
    if (resource.owner === person.id || resource.controllers.includes(person.id)) {
      add({ kind: 'resource', id: resource.id, revision: resource.revision, relation: resource.owner === person.id ? 'owner' : 'controller' },
        'resource-control', 'current-authority', ['handoff-required'], 'recorded', owner('resource'))
    }
  }
  for (const grant of Object.values(state.grants)) {
    if (grant.phase === 'available' && (grant.issuer === person.id || grant.grantee === person.id)) {
      add({ kind: 'resource-grant', id: grant.id, revision: grant.revision, relation: grant.issuer === person.id ? 'issuer' : 'grantee' },
        'resource-grant', 'available', ['handoff-required'], 'recorded', owner('resource'))
    }
  }
  for (const event of Object.values(state.scheduledEvents)) {
    if (event.status === 'pending' && eventTouches(state, event, person.id)) {
      const operation = event.action.kind === 'outbox-ready' ? lookup(state.operations, event.action.operationId) : undefined
      const cancel = event.action.kind !== 'governance-deadline' && (event.action.kind !== 'outbox-ready'
        || operation?.outbox?.attempts.length === 0)
      add({ kind: 'scheduled-event', id: event.id, key: event.key }, 'scheduled-event', event.action.kind,
        cancel ? ['wait', 'cancel-supported'] : ['wait'], 'recorded', owner('scheduler'))
    }
  }
  for (const wake of Object.values(state.wakes)) {
    if (wake.entityId === person.id && (wake.status === 'pending' || wake.status === 'claimed')) {
      const decision = wake.decisionId === undefined ? undefined : lookup(state.decisions, wake.decisionId)
      const cancel = decision?.status === 'open' || decision?.status === 'submitted'
      add({ kind: 'wake', eventId: wake.eventId, decisionId: wake.decisionId ?? null }, 'wake', wake.status,
        cancel ? ['wait', 'cancel-supported'] : ['wait'], 'recorded', owner('scheduler'))
    }
  }
  const roleAuthorityIds = new Set(personnelRoleAuthorities(state, person.id).map(value => value.id))
  for (const relation of Object.values(state.relations)) {
    if (relation.subject !== person.id && relation.object !== person.id || relation.validUntil !== null
      && BigInt(relation.validUntil) <= BigInt(state.time) || selected.kind === 'assignment' && relation.id === selected.assignmentId) continue
    if (Object.values(state.world?.personnel.reservations ?? {}).some(value => value.status === 'committed'
      && value.revokedAuthorityRelationIds.includes(relation.id))) continue
    if (independentPersonnelEligibility(state, relation)) continue
    const authority = roleAuthorityIds.has(relation.id)
    const canEnd = authority && BigInt(relation.validFrom) < BigInt(state.time)
    add({ kind: 'relation', id: relation.id, revision: relation.revision, relation: relation.relation, subject: relation.subject,
      object: relation.object, scope: relation.scope ?? null, validFrom: relation.validFrom, validUntil: relation.validUntil },
    authority ? 'authority-relation' : 'structural-relation', BigInt(relation.validFrom) > BigInt(state.time) ? 'future' : 'current',
    canEnd ? ['update-supported'] : ['handoff-required'], 'recorded', owner('relation'))
  }
  if (person.writer !== undefined && person.writer.phase !== 'released') {
    add({ kind: 'writer', entityId: person.id, epoch: person.writer.epoch, reservationId: person.writer.reservationId,
      activationId: person.writer.activationId ?? null }, 'writer', person.writer.phase, ['wait'], 'recorded', owner('writer'))
  }
  for (const reservation of Object.values(state.world?.reservations ?? {})) {
    if (reservation.status !== 'committed' && reservation.status !== 'abandoned') {
      add({ kind: 'world-reservation', intentId: reservation.id, requestId: reservation.requestId,
        planId: reservation.request.planId, updatedSequence: reservation.updatedSequence }, 'world-reservation', reservation.status,
      ['wait', 'cancel-supported'], 'recorded', owner('world'))
    }
  }
  for (const reservation of Object.values(state.world?.personnel.reservations ?? {})) {
    if (reservation.personId === person.id && reservation.status !== 'committed' && reservation.status !== 'cancelled') {
      add({ kind: 'world-reservation', intentId: reservation.id, requestId: reservation.requestId,
        planId: reservation.request.planId, updatedSequence: reservation.updatedSequence }, 'world-reservation', reservation.status,
      ['wait', 'cancel-supported'], 'recorded', owner('world'))
    }
  }
  for (const request of Object.values(state.world?.requests ?? {})) {
    if (request.status !== 'open' && request.status !== 'awaiting-evidence' && request.status !== 'cancel-requested') continue
    const intent = lookup(state.world?.intents ?? {}, request.intentId)
    if (intent === undefined) {
      throw new PersonnelObligationError('SIM_PERSONNEL_SOURCE', 'Personnel world-case inventory lost its original immutable intent')
    }
    const involves = request.requesterEntityId === person.id
      || requireWorldRuntime(runtime).original(intent.pin).personnelSubjects(intent).includes(person.id)
    if (involves) add({ kind: 'world-case', requestId: request.id, intentId: request.intentId, sequence: request.sequence },
      'world-case', request.status, ['wait', 'cancel-supported'], 'recorded', owner('world'))
  }
  const items = [...entries.values()].sort((a, b) => {
    const left = JSON.stringify(a.ref), right = JSON.stringify(b.ref)
    return left < right ? -1 : left === right ? 0 : 1
  })
  return boundPersonnelObligationReport({ runId: state.spec.runId, cursor: state.revision, time: state.time, selector: query.selector,
    status: 'native-only', complete: false, coverage: { native: 'complete', team: { kind: 'required',
      teamId: person.binding?.teamId ?? null, participantId: person.binding?.participantId ?? null } },
    items, totalCount: items.length, overflow: null }, query)
}
function assertNever(value: never): never { throw new Error(`Unknown personnel responsibility discriminant: ${String(value)}`) }
