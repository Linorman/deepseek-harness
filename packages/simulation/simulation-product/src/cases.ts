import { simulationProductCommandIdSchema } from './schema-common.ts'
import { WORLD_GENERATE_AND_HIRE_PIN, simulationWorldHirePlanPayloadSchema } from '@clocky/clocky-simulation/world-domains'
/** Pure bounded World case projections; Native remains the sole business-fact owner. */
import type { SimulationSnapshot, SimulationOperation } from '@clocky/clocky-simulation'
import type { WorldRequestId, SimulationWorldRequest } from '@clocky/clocky-simulation/world-types'
import type { SimulationEventId } from '@clocky/clocky-simulation/identities'
import type { SimulationProductText } from './types.ts'
import type { SimulationProductWorldCaseSummary, SimulationProductWorldCaseDetail, SimulationProductWorldCasePlan,
  SimulationProductWorldCasePost, SimulationProductWorldCaseWake, SimulationProductWorldCaseInput, SimulationProductWorldCaseEvidence,
  SimulationProductWorldCaseResponsibilityRecord, SimulationProductWorldCaseNotificationLifecycle,
  SimulationProductWorldCaseExecutionObservation, SimulationProductWorldBusinessSummary } from './case-types.ts'

/**
 * Project an original case without prose or Persona.
 * @param request - Original Native request.
 * @param state - One validated observation.
 * @param businessSummary - Independently authorized pure domain projection, or unsupported when none is installed.
 * @returns bounded administrative references and a non-authorizing lifecycle hint.
 */
export function worldCaseSummary(request: SimulationWorldRequest, state: SimulationSnapshot,
  businessSummary: SimulationProductWorldBusinessSummary = { status: 'unsupported' }): SimulationProductWorldCaseSummary {
  const intent = state.world?.intents[request.intentId]
  if (intent === undefined) throw new Error('World case lost its original business intent')
  const world = state.world
  if (world === undefined) throw new Error('World case lost its original projection')
  const planId = request.plans.at(-1), plan = planId === undefined ? undefined : world.plans[planId]
  const result = Object.values(world.results).find(value => value.requestId === request.id)
  const callback = caseObservation(request, state)
  return { apiVersion: 'clocky.world-case/v4', businessSummary, domain: intent.pin.domain, operation: intent.pin.operation, version: intent.pin.version,
    requestId: request.id, intentId: request.intentId, status: request.status, requesterEntityId: request.requesterEntityId,
    origin: request.operationId === null ? { kind: 'authenticated-user', commandId: simulationProductCommandIdSchema.parse(request.source.commandId) }
      : { kind: 'decision' },
    organizationEntityId: intent.scopeEntityId, targetEntityId: intent.targetEntityId,
    lifecycle: { request: { status: request.status },
      plan: plan === undefined ? { status: 'none' } : { id: plan.id, status: plan.status, resolution: plan.proposal.resolution.kind },
      execution: { callback: callback ?? { status: 'none' },
        business: result === undefined ? { status: 'none' } : { status: result.outcome.kind, resultId: result.id } },
      notification: caseNotification(request, state) },
    cancel: { allowed: false, reason: request.status === 'open' || request.status === 'awaiting-evidence' ? 'recovery-required'
      : request.status === 'cancel-requested' ? 'in-progress' : 'terminal' } }
}

/**
 * Project original ordered plans with independently authorized bodies.
 * @param requestId - Exact run-local case.
 * @param state - One validated observation.
 * @param text - Bounded Unicode-safe display projection.
 * @param grants - Independent case-prose and Persona domains.
 * @returns plan metadata and explicitly allowed or withheld body fields.
 */
export function worldCasePlans(requestId: WorldRequestId, state: SimulationSnapshot, text: (value: string) => SimulationProductText,
  grants: { case: boolean; persona: boolean }): SimulationProductWorldCasePlan[] {
  const world = state.world, request = world?.requests[requestId]
  if (world === undefined || request === undefined) return []
  return request.plans.map((id) => {
    const plan = world.plans[id]
    if (plan === undefined) throw new Error('World case lost its original plan')
    const resolution = plan.proposal.resolution
    const hiring = request.pin.domain === WORLD_GENERATE_AND_HIRE_PIN.domain
      && request.pin.operation === WORLD_GENERATE_AND_HIRE_PIN.operation && request.pin.version === WORLD_GENERATE_AND_HIRE_PIN.version
    const selected = resolution.kind === 'apply' && hiring ? simulationWorldHirePlanPayloadSchema.parse(resolution.payload) : undefined
    return { id, operationId: plan.operationId, sequence: plan.sequence, hash: plan.hash, predecessor: plan.proposal.supersedes,
      status: plan.status, resolution: resolution.kind, ...plan.stale === undefined ? {} : { stale: { ...plan.stale } },
      rationale: grants.case ? { status: 'allowed', text: text(resolution.rationale) } : { status: 'withheld' },
      persona: selected === undefined ? { status: 'not-applicable' } : !grants.persona ? { status: 'withheld' }
        : { status: 'allowed', templateId: text(selected.templateId), templateVersion: text(selected.templateVersion),
          name: text(selected.persona.name), skills: selected.persona.skills.map(text), traits: selected.persona.traits.map(text),
          goals: selected.persona.goals.map(text) } }
  })
}

/**
 * Project one finite original case section; plan pagination belongs to the read owner.
 * @param input - Exact section selector.
 * @param summary - Already-owned administrative references.
 * @param state - One validated Native observation.
 * @param text - Bounded display projection.
 * @param body - Independent case-prose permission.
 * @returns finite details without forwarding Native snapshots or private execution settings.
 */
export function worldCaseDetail(input: SimulationProductWorldCaseInput, summary: SimulationProductWorldCaseSummary,
  state: SimulationSnapshot, text: (value: string) => SimulationProductText, body: boolean): Exclude<SimulationProductWorldCaseDetail,
  { section: 'plans' }> {
  const world = state.world, request = world?.requests[input.requestId]
  if (world === undefined || request === undefined) throw new Error('World detail lost its selected request')
  const result = Object.values(world.results).find(value => value.requestId === request.id)
  switch (input.section) {
    case 'request': return { section: 'request', summary, source: { ...request.operationId === null
      ? { kind: 'authenticated-user' as const, commandId: simulationProductCommandIdSchema.parse(request.source.commandId) }
      : { kind: 'decision' as const, operationId: request.operationId }, sequence: request.sequence,
    payloadHash: request.payloadHash }, description: body ? { status: 'allowed',
      text: text(request.description) } : { status: 'withheld' }, evidence: worldCaseEvidence(request, state, world.evidence, text, body) }
    case 'execution': {
      const responsibilities = caseResponsibilities(request, world)
      const observation = caseObservation(request, state)
      const reservation = world.reservations[request.intentId], entity = reservation === undefined ? undefined
        : state.entities[reservation.identities.entityId]
      return { section: 'execution', summary, ...responsibilities.length === 0 ? {} : { responsibilities },
        ...observation === undefined ? {} : { observation },
        ...reservation === undefined ? {} : { reservation: {
          id: reservation.id, planId: reservation.request.planId, status: reservation.status, sequence: reservation.sequence,
          updatedSequence: reservation.updatedSequence,
          newborn: { entityId: reservation.identities.entityId, readiness: entity?.readiness ?? 'absent', phase: entity?.phase ?? 'absent' },
          assignment: { relationId: reservation.identities.relationId,
            status: state.relations[reservation.identities.relationId] === undefined ? 'absent' : 'retained' },
          ...reservation.cleanup === undefined ? {} : { cleanup: { sequence: reservation.cleanup.sequence,
            participant: reservation.cleanup.evidence.participant } } } }, ...result === undefined ? {} : { result: {
          id: result.id, sequence: result.sequence, time: result.time, source: { ...result.source }, outcome: { ...result.outcome },
          payload: result.payload } } }
    }
    case 'notification': return { section: 'notification', summary, ...caseNotification(request, state) }
    case 'plans': throw new Error('World plan details require bounded owner pagination')
    default: return assertNever(input.section)
  }
}
function caseObservation(request: SimulationWorldRequest, state: SimulationSnapshot):
SimulationProductWorldCaseExecutionObservation | undefined {
  const latestPlan = request.plans.at(-1), observation = latestPlan === undefined ? undefined : state.world?.executions[latestPlan]
  if (observation === undefined) return undefined
  return { planId: observation.planId, mode: observation.mode, sequence: observation.sequence,
    updates: observation.updates, time: observation.time,
    ...observation.phase === 'settled' ? { status: 'settled', reason: null }
      : observation.phase === 'blocked' ? { status: 'blocked', reason: observation.reason }
        : { status: 'outcome-unknown', reason: observation.reason ?? 'callback-unconfirmed' } }
}
function caseNotification(request: SimulationWorldRequest, state: SimulationSnapshot): SimulationProductWorldCaseNotificationLifecycle {
  const world = state.world
  if (world === undefined) throw new Error('World notification lost its original case')
  const result = Object.values(world.results).find(value => value.requestId === request.id)
  const resultWake = result === undefined || request.operationId === null ? undefined : caseWake(`simulation-world-result:${result.id}` as SimulationEventId, state)
  const firstId = `simulation-world-first:${request.intentId}` as SimulationEventId
  const firstWake = state.wakes[firstId] === undefined && state.scheduledEvents[firstId] === undefined ? undefined
    : caseWake(firstId, state)
  const resultPost = resultWake?.decisionId === undefined ? undefined : decisionPost(resultWake.decisionId, state)
  const firstPost = firstWake?.decisionId === undefined ? undefined : decisionPost(firstWake.decisionId, state)
  const notification = request.notificationOperationId === null ? null : state.operations[request.notificationOperationId]
  if (notification === undefined) throw new Error('World request lost its original notification')
  return { request: notification === null ? null : casePost(notification),
    ...result === undefined || resultWake === undefined ? {} : { result: { resultId: result.id, wake: resultWake,
      ...resultPost === undefined ? {} : { post: resultPost } } },
    ...firstWake === undefined ? {} : { firstAction: { wake: firstWake, ...firstPost === undefined ? {} : { post: firstPost } } } }
}
function caseResponsibilities(request: SimulationWorldRequest,
  world: NonNullable<SimulationSnapshot['world']>): SimulationProductWorldCaseResponsibilityRecord[] {
  const personnel = world.personnel.reservations[request.intentId]
  const contact = world.external.contacts[request.intentId]
  // A later contact reuses the first case's representative duty; it must not claim to own a second preparation.
  const representative = world.external.representatives[contact?.representativeIntentId ?? request.intentId]
  return [
    ...personnel === undefined ? [] : [{ kind: 'personnel' as const, id: personnel.id, planId: personnel.request.planId,
      status: personnel.status, sequence: personnel.sequence, updatedSequence: personnel.updatedSequence }],
    ...representative === undefined ? [] : [{ kind: 'representative' as const, id: representative.id,
      planId: representative.request.planId, status: representative.status,
      sequence: representative.sequence, updatedSequence: representative.updatedSequence }],
    ...contact === undefined ? [] : [{ kind: 'contact' as const, id: contact.id, planId: contact.planId,
      status: contact.status, sequence: contact.sequence, updatedSequence: contact.updatedSequence }],
  ]
}
/**
 * Project original challenge metadata and independently disclosed accepted answers from the same Native prefix.
 * @param request - Original accepted case.
 * @param state - Authoritative prefix containing original decision consumption.
 * @param records - Retained evidence records belonging to that prefix.
 * @param text - Bounded public text projection.
 * @param body - Whether the caller may read answer bodies; metadata alone grants no content access.
 * @returns latest challenge with actual consumed attempts and latest accepted input revision.
 */
export function worldCaseEvidence(request: SimulationWorldRequest, state: SimulationSnapshot,
  records: NonNullable<SimulationSnapshot['world']>['evidence'], text: (value: string) => SimulationProductText, body: boolean): SimulationProductWorldCaseEvidence {
  const challenge = Object.values(records.challenges).filter(value => value.requestId === request.id)
    .reduce<(typeof records.challenges)[keyof typeof records.challenges] | undefined>(
      (latest, value) => latest === undefined || value.sequence > latest.sequence ? value : latest, undefined)
  const revision = Object.values(records.revisions).filter(value => value.requestId === request.id)
    .reduce<(typeof records.revisions)[keyof typeof records.revisions] | undefined>(
      (latest, value) => latest === undefined || value.revision > latest.revision ? value : latest, undefined)
  const attemptsUsed = challenge === undefined ? 0 : Object.values(state.decisions).filter((decision) => {
    const context = decision.context?.status === 'prepared' ? decision.context.world : undefined
    return context?.kind === 'evidence' && context.requestId === request.id && context.challengeId === challenge.id
      && context.inputRevision === challenge.inputRevision && context.notificationOperationId === challenge.notificationOperationId
      && challenge.responders.includes(decision.entityId) && decision.snapshotRevision >= challenge.sequence
  }).length
  return { inputRevision: revision?.revision ?? 0,
    ...challenge === undefined ? {} : { latestChallenge: { id: challenge.id, status: challenge.status, round: challenge.round,
      fields: challenge.fields.map(value => ({ code: value.code, description: text(value.description) })),
      responders: [...challenge.responders],
      deadline: challenge.deadline, maxAttempts: challenge.maxAttempts, attemptsUsed } },
    ...revision === undefined ? {} : { latestRevision: { id: revision.id, revision: revision.revision,
      sequence: revision.sequence, actorId: revision.source.actorId,
      answers: body ? { status: 'allowed' as const, items: revision.answers.map(value => ({ field: value.field, text: text(value.text) })) }
        : { status: 'withheld' as const } } } }
}
function casePost(operation: SimulationOperation): SimulationProductWorldCasePost {
  if (operation.action.kind !== 'communication/post') throw new Error('World notification source is not communication')
  const receipt = operation.outbox?.receipt
  return { operationId: operation.id, status: operation.status, channelId: operation.action.channelId,
    publication: receipt !== undefined ? 'published' : operation.status === 'outcome-unknown' ? 'unknown'
      : operation.outbox?.attempts.at(-1)?.outcome === 'in-flight' ? 'in-flight' : 'unpublished',
    delivery: operation.delivery?.receipt === undefined ? 'not-received' : 'received',
    ...receipt === undefined ? {} : { envelopeId: receipt.envelopeId } }
}
function caseWake(id: SimulationEventId, state: SimulationSnapshot): SimulationProductWorldCaseWake {
  const wake = state.wakes[id]
  return { id, status: wake?.status ?? (state.scheduledEvents[id]?.status === 'pending' ? 'scheduled' : 'absent'),
    ...wake?.decisionId === undefined ? {} : { decisionId: wake.decisionId } }
}
function decisionPost(id: import('@clocky/clocky-simulation/identities').SimulationDecisionId,
  state: SimulationSnapshot): SimulationProductWorldCasePost | undefined {
  const decision = state.decisions[id]
  const operation = decision?.operationIds.map(id => state.operations[id]).find(value => value?.action.kind === 'communication/post')
  return operation === undefined ? undefined : casePost(operation)
}
function assertNever(value: never): never { throw new Error(`Unknown World case section: ${String(value)}`) }
