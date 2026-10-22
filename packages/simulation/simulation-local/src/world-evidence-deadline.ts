/** Frozen evidence deadlines terminate their original case without inference or replacing prior inputs. */
import { simulationEventIdSchema, SimulationWorldError } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationScheduledEvent, SimulationWorldEvidenceChallenge,
  WorldEvidenceChallengeId, SimulationOperationId } from '@clocky/clocky-simulation'
import { withWorldResult, worldResultIdentity } from './world.ts'
import { allocateEventKey, foldSchedulerRecord, worldResultWakeRecords } from './scheduler.ts'
import type { SchedulerRecord } from './scheduler.ts'
import type { NativeWorldRuntime } from './world-runtime.ts'

/**
 * Identify the sole deadline belonging to an original evidence question.
 * @param id - Original challenge identity.
 * @returns its sole durable deadline identity.
 */
export function worldEvidenceDeadlineId(id: WorldEvidenceChallengeId): SimulationScheduledEvent['id'] {
  return simulationEventIdSchema.parse(`simulation-world-evidence-deadline:${id}`)
}
/**
 * Queue new challenges and cancel settled questions in the same Native append as their transition.
 * @param state - Prospective complete business projection before scheduler additions.
 * @returns ordered exact scheduler records; repeated calls on the completed projection return none.
 */
export function worldEvidenceDeadlineRecords(state: SimulationSnapshot): SchedulerRecord[] {
  const records: SchedulerRecord[] = []; let projected = state
  for (const question of Object.values(state.world?.evidence.challenges ?? {})) {
    const id = worldEvidenceDeadlineId(question.id), event = projected.scheduledEvents[id]
    let record: SchedulerRecord | undefined
    if (event === undefined && question.status === 'awaiting') {
      const action = { kind: 'world-evidence-deadline' as const, challengeId: question.id }
      record = { kind: 'event/queued', id, action, sourceOperationId: question.source.operationId,
        key: allocateEventKey(projected, question.deadline, action) }
    } else if (event?.status === 'pending' && question.status !== 'awaiting') {
      record = { kind: 'event/cancelled', id, reason: 'Original evidence challenge settled' }
    }
    if (record !== undefined) {
      records.push(record)
      projected = { ...foldSchedulerRecord(projected, record, projected.revision + 1), revision: projected.revision + 1 }
    }
  }
  return records
}
/**
 * Check the event against the original accepted asking plan and its exact immutable deadline.
 * @param state - Retained Native business projection.
 * @param event - Proposed or retained scheduler envelope.
 * @returns the original challenge; mismatched identities, source, plan or time reject.
 */
export function assertWorldEvidenceDeadlineSource(state: SimulationSnapshot,
  event: Pick<SimulationScheduledEvent, 'id' | 'action' | 'key'> & { readonly sourceOperationId?: SimulationOperationId | undefined }): SimulationWorldEvidenceChallenge {
  const question = event.action.kind === 'world-evidence-deadline' ? state.world?.evidence.challenges[event.action.challengeId] : undefined
  const operation = question === undefined ? undefined : state.operations[question.source.operationId]
  const plan = question === undefined ? undefined : state.world?.plans[question.planId]
  const request = question === undefined ? undefined : state.world?.requests[question.requestId]
  if (question === undefined || request === undefined || operation?.action.kind !== 'world/resolve' || operation.action.resolution.kind !== 'awaiting-evidence'
    || operation.action.requestId !== question.requestId || operation.action.resolution.deadline !== question.deadline
    || operation.decisionId !== question.source.decisionId || state.decisions[operation.decisionId]?.status !== 'accepted'
    || plan?.operationId !== operation.id || plan.requestId !== question.requestId || plan.sequence > question.sequence
    || event.id !== worldEvidenceDeadlineId(question.id) || event.key.time !== question.deadline || event.key.phase !== 'deadline'
    || event.sourceOperationId !== question.source.operationId)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence deadline lost its original challenge, asking plan or time')
  return question
}
/**
 * Close one still-awaiting question and retain its sole rejected result plus canonical result wake.
 * @param state - Projection with this exact deadline already marked consumed.
 * @param event - Actual consumed deadline.
 * @param runtime - Original installed domain catalog for result parsing and notification role.
 * @returns expired challenge and terminal case at the deadline consumption sequence.
 */
export function consumeWorldEvidenceDeadline(state: SimulationSnapshot, event: SimulationScheduledEvent,
  runtime?: NativeWorldRuntime): SimulationSnapshot {
  const question = assertWorldEvidenceDeadlineSource(state, event), world = state.world
  if (world === undefined || question.status !== 'awaiting' || state.time !== question.deadline
    || state.lastEventKey?.phase !== 'deadline' || state.scheduledEvents[event.id]?.status !== 'consumed'
    || state.activeWindowId !== undefined || world.requests[question.requestId]?.status !== 'awaiting-evidence')
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence expiry requires its original awaiting case and consumed deadline')
  const sequence = state.revision + 1, request = world.requests[question.requestId]
  if (request === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence expiry lost its original request')
  const result = { id: worldResultIdentity(request.intentId), requestId: request.id, intentId: request.intentId,
    source: { kind: 'evidence-deadline' as const, challengeId: question.id, eventId: event.id },
    outcome: { kind: 'rejected' as const, reason: 'insufficient-information' as const }, payload: {}, time: state.time, sequence }
  let next = withWorldResult({ ...state, world: { ...world, evidence: { ...world.evidence, challenges: {
    ...world.evidence.challenges, [question.id]: { ...question, status: 'expired', settledSequence: sequence },
  } } } }, result, runtime)
  for (const wake of worldResultWakeRecords(next, result, runtime)) next = foldSchedulerRecord(next, wake, sequence, runtime)
  return next
}
/**
 * Require every challenge's deadline and its matching terminal disposition at complete Native tails.
 * @param state - Published or restored journal projection.
 */
export function assertWorldEvidenceDeadlineProjection(state: SimulationSnapshot): void {
  for (const question of Object.values(state.world?.evidence.challenges ?? {})) {
    const event = state.scheduledEvents[worldEvidenceDeadlineId(question.id)]
    if (event === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence challenge omitted its original deadline')
    assertWorldEvidenceDeadlineSource(state, event)
    if (question.status === 'awaiting' ? event.status !== 'pending'
      : question.status === 'expired' ? event.status !== 'consumed' || event.settledAt !== question.settledSequence
        : event.status !== 'cancelled' || event.cancellation !== 'Original evidence challenge settled'
          || event.settledAt === undefined || question.settledSequence === undefined || event.settledAt < question.settledSequence)
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence deadline contradicts its original challenge settlement')
    if (question.status === 'expired') {
      const request = state.world?.requests[question.requestId]
      if (request === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence expiry lost its original request')
      const result = state.world?.results[worldResultIdentity(request.intentId)]
      if (result?.source.kind !== 'evidence-deadline' || result.source.challengeId !== question.id || result.source.eventId !== event.id
        || result.sequence !== question.settledSequence || result.time !== question.deadline
        || result.outcome.kind !== 'rejected' || result.outcome.reason !== 'insufficient-information')
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Expired evidence challenge lost its sole original rejection')
    }
  }
  for (const event of Object.values(state.scheduledEvents)) if (event.action.kind === 'world-evidence-deadline')
    assertWorldEvidenceDeadlineSource(state, event)
}
