import { worldRolePlanOperationId } from '@clocky/clocky-simulation'
import { withWorldResult, worldResultIdentity, requireWorld, worldExecutionReads } from './world.ts'
import { worldResultWakeRecords, foldSchedulerRecord } from './scheduler.ts'
import { worldEvidenceChallengeIdSchema, simulationDecisionIdSchema } from '@clocky/clocky-simulation'
/** Original-case clarification records; sources, field authority and input revisions are Native-owned. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { SimulationWorldError, simulationWorldEvidenceAskSchema, simulationWorldEvidenceSupplySchema,
  simulationWorldEvidenceChallengeSchema, simulationWorldEvidenceRevisionSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationDecision, SimulationWorldPlan, SimulationWorldRequest,
  SimulationWorldEvidenceAsk, SimulationWorldEvidenceSupply, SimulationWorldEvidenceChallenge,
  SimulationWorldEvidenceRevision, WorldRequestId, WorldEvidenceChallengeId, SimulationOperation } from '@clocky/clocky-simulation'
import type { NativeWorldRuntime } from './world-runtime.ts'
import { businessFingerprint, operationId } from './business.ts'
import { pendingWorldMutations } from './world-structure-budget.ts'

/** Complete copied questions and answer inputs are retained, rather than regenerated from provider metadata on replay. */
export const worldEvidenceRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('evidence/exhausted'), challengeId: worldEvidenceChallengeIdSchema, decisionId: simulationDecisionIdSchema }),
  z.strictObject({ kind: z.literal('evidence/opened'), challenge: simulationWorldEvidenceChallengeSchema }),
  z.strictObject({ kind: z.literal('evidence/answered'), revision: simulationWorldEvidenceRevisionSchema }),
])
/** Strict transition payload retained by the Native journal. */
export type WorldEvidenceRecord = z.infer<typeof worldEvidenceRecordSchema>

/**
 * Select the current immutable input revision at an original readable Native prefix.
 * @param state - Authoritative Native projection.
 * @param requestId - Original business case identity.
 * @param cursor - Readable Native prefix; defaults to the current revision.
 * @returns Latest retained input at or before the selected Native cursor, if any.
 */
export function latestWorldEvidence(state: SimulationSnapshot, requestId: WorldRequestId,
  cursor = state.revision): SimulationWorldEvidenceRevision | undefined {
  return Object.values(state.world?.evidence.revisions ?? {}).filter(value => value.requestId === requestId && value.sequence <= cursor)
    .sort((a, b) => b.revision - a.revision)[0]
}

/**
 * Find a question by its retained identity without prototype fallback.
 * @param state - Authoritative Native projection.
 * @param id - Original question or revision identity.
 * @returns Original retained question; missing identity rejects.
 */
export function requireWorldEvidence(state: SimulationSnapshot, id: WorldEvidenceChallengeId): SimulationWorldEvidenceChallenge {
  const values = state.world?.evidence.challenges
  const value = values !== undefined && Object.hasOwn(values, id) ? values[id] : undefined
  if (value === undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Original evidence question is unavailable')
  return value
}

/**
 * Count prepared response decisions; later cancellation never refunds an attempt.
 * @param state - Authoritative Native projection.
 * @param requestId - Original business case identity.
 * @param challengeId - Optional question filter within the same case.
 * @param exclude - Current decision excluded when validating its own admission.
 * @returns Charged original prepared response decisions.
 */
export function worldEvidenceAttempts(state: SimulationSnapshot, requestId: WorldRequestId,
  challengeId?: WorldEvidenceChallengeId, exclude?: SimulationDecision['id']): number {
  return evidenceDecisions(state, requestId, challengeId).filter(value => value.id !== exclude).length
}
function evidenceDecisions(state: SimulationSnapshot, requestId: WorldRequestId,
  challengeId?: WorldEvidenceChallengeId): SimulationDecision[] {
  return Object.values(state.decisions).filter((value) => {
    const scope = value.context?.status === 'prepared' ? value.context.world : undefined
    const question = scope?.kind === 'evidence' ? state.world?.evidence.challenges[scope.challengeId] : undefined
    return scope?.kind === 'evidence' && scope.requestId === requestId && question?.requestId === requestId
      && (challengeId === undefined || question.id === challengeId) && question.responders.includes(value.entityId)
      && scope.inputRevision === question.inputRevision && scope.notificationOperationId === question.notificationOperationId
      && value.snapshotRevision >= question.sequence
  })
}

/**
 * Validate a director's bounded question against the original operation's installed vocabulary.
 * @param state - Authoritative Native projection.
 * @param decision - Actual canonical actor decision.
 * @param request - Immutable original business request.
 * @param input - Untrusted model proposal to validate.
 * @param runtime - Original installed domain leases.
 * @returns Copied declared fields in the requested order; invalid authority or bounds reject.
 */
export function validateWorldEvidenceAsk(state: SimulationSnapshot, decision: SimulationDecision,
  request: SimulationWorldRequest, input: SimulationWorldEvidenceAsk, runtime: NativeWorldRuntime): SimulationWorldEvidenceChallenge['fields'] {
  const ask = simulationWorldEvidenceAskSchema.parse(input), world = state.world
  if (world === undefined || decision.entityId !== world.definition.directorEntityId || request.status !== 'open'
    || request.notificationOperationId === null || request.requesterEntityId === decision.entityId)
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Evidence requires the original private requester and director')
  if (Object.values(world.evidence.challenges).some(value => value.requestId === request.id && value.status === 'awaiting'))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'The original case already awaits evidence')
  if (pendingWorldMutations(state).has(request.intentId))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Evidence cannot interrupt original unsettled structural or funding work')
  const remaining = world.definition.limits.maxEvidenceAttemptsPerRequest - worldEvidenceAttempts(state, request.id)
  const planning = Object.values(state.decisions).filter(value => value.context?.status === 'prepared'
    && value.context.world?.kind === 'resolve' && value.context.world.requestId === request.id).length
  if (ask.maxAttempts > remaining || planning >= world.definition.limits.maxPlansPerRequest)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Evidence requires remaining answer and subsequent planning allowance', 'plans')
  if (BigInt(ask.deadline) <= BigInt(decision.time) || BigInt(ask.deadline) > BigInt(state.spec.maxTime))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Evidence deadline must be a future bounded simulation time')
  const context = decision.context?.status === 'prepared' ? decision.context.world : undefined
  const intent = world.intents[request.intentId]
  if (context?.kind !== 'resolve' || context.requestId !== request.id || intent === undefined)
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Evidence requires its original prepared planning context')
  if (!isDeepStrictEqual(context.reads, worldExecutionReads(state, intent, runtime)))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Evidence question planning reads are stale')
  const fields = runtime.original(request.pin).definition.evidenceFields ?? []
  return ask.missingFields.map((code) => {
    const field = fields.find(value => value.code === code)
    if (field === undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Evidence field is not declared by the original domain')
    return field
  })
}

/**
 * Safe question index; private director rationale never enters the responder's Channel.
 * @param id - Original question or revision identity.
 * @param requestId - Original business case identity.
 * @returns Safe Channel index without private rationale.
 */
export function worldEvidenceNotice(id: WorldEvidenceChallengeId, requestId: WorldRequestId): string {
  return JSON.stringify({ evidenceChallengeId: id, requestId })
}

/**
 * Safe answer index; the director reads its authorized retained revision only after actual delivery.
 * @param id - Original question or revision identity.
 * @param requestId - Original business case identity.
 * @returns Safe Channel revision index.
 */
export function worldEvidenceRevisionNotice(id: SimulationWorldEvidenceRevision['id'], requestId: WorldRequestId): string {
  return JSON.stringify({ evidenceRevisionId: id, requestId })
}

/**
 * Derive the complete question from its accepted original plan and actual director decision.
 * @param state - Authoritative Native projection.
 * @param plan - Accepted original director plan.
 * @param sequence - Native sequence retaining this transition.
 * @param runtime - Original installed domain leases.
 * @returns Complete original question for the acceptance batch.
 */
export function prepareWorldEvidenceChallenge(state: SimulationSnapshot, plan: SimulationWorldPlan,
  sequence: number, runtime: NativeWorldRuntime): SimulationWorldEvidenceChallenge {
  const world = state.world, request = world?.requests[plan.requestId], operation = state.operations[worldRolePlanOperationId(plan)]
  const decision = operation === undefined ? undefined : state.decisions[operation.decisionId]
  if (world === undefined || request === undefined || operation === undefined || decision?.status !== 'accepted'
    || plan.proposal.resolution.kind !== 'awaiting-evidence')
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence question lost its original accepted plan')
  const fields = validateWorldEvidenceAsk(state, decision, request, plan.proposal.resolution, runtime)
  const binding = state.entities[decision.entityId]?.binding
  if (binding === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence question lost its canonical director')
  return simulationWorldEvidenceChallengeSchema.parse({ id: `world-evidence:${plan.id}`, requestId: request.id, planId: plan.id,
    inputRevision: latestWorldEvidence(state, request.id)?.revision ?? 0,
    round: Object.values(world.evidence.challenges).filter(value => value.requestId === request.id).length + 1,
    fields, responders: [request.requesterEntityId], deadline: plan.proposal.resolution.deadline,
    maxAttempts: plan.proposal.resolution.maxAttempts, notificationOperationId: operationId(state.spec.runId, decision.id, 1),
    source: { decisionId: decision.id, operationId: operation.id, epoch: decision.epoch, binding }, sequence, status: 'awaiting' })
}

/**
 * Validate an answer against the exact consumed question, actor, input revision and visible sources.
 * @param state - Authoritative Native projection.
 * @param decision - Actual canonical actor decision.
 * @param input - Untrusted model proposal to validate.
 * @returns Original matching question; invalid scope, fields or sources reject.
 */
export function validateWorldEvidenceSupply(state: SimulationSnapshot, decision: SimulationDecision,
  input: SimulationWorldEvidenceSupply): SimulationWorldEvidenceChallenge {
  const supply = simulationWorldEvidenceSupplySchema.parse(input), challenge = requireWorldEvidence(state, supply.challengeId)
  const scope = decision.context?.status === 'prepared' ? decision.context.world : undefined
  if (scope?.kind !== 'evidence' || scope.challengeId !== challenge.id || scope.requestId !== supply.requestId
    || challenge.requestId !== supply.requestId || !challenge.responders.includes(decision.entityId)
    || decision.consumption?.notification?.operationId !== challenge.notificationOperationId)
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Evidence requires its original consumed question and actual responder')
  if (challenge.status !== 'awaiting' || state.world?.requests[challenge.requestId]?.status !== 'awaiting-evidence'
    || supply.expectedInputRevision !== challenge.inputRevision || scope.inputRevision !== challenge.inputRevision
    || (latestWorldEvidence(state, supply.requestId)?.revision ?? 0) !== challenge.inputRevision)
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Evidence answer no longer matches the original input revision')
  if (BigInt(decision.time) >= BigInt(challenge.deadline))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Evidence deadline has elapsed')
  if (worldEvidenceAttempts(state, supply.requestId, challenge.id, decision.id) >= challenge.maxAttempts
    || worldEvidenceAttempts(state, supply.requestId, undefined, decision.id)
      >= state.world.definition.limits.maxEvidenceAttemptsPerRequest)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Original evidence attempt allowance is exhausted', 'plans')
  const fields = new Set(challenge.fields.map(value => value.code))
  const references = decision.context?.status === 'prepared' ? decision.context.view.sources : []
  if (supply.answers.length !== fields.size || supply.answers.some(answer => !fields.has(answer.field)
    || answer.references.some(reference => !references.some(source => isDeepStrictEqual(source, reference)))))
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY',
      'Evidence must answer the declared fields using only actually visible sources')
  return challenge
}

/**
 * Derive one immutable next input revision from the accepted actual response operation.
 * @param state - Authoritative Native projection.
 * @param operation - Accepted original response operation.
 * @param sequence - Native sequence retaining this transition.
 * @returns Immutable next original-case input revision.
 */
export function prepareWorldEvidenceRevision(state: SimulationSnapshot, operation: SimulationOperation,
  sequence: number): SimulationWorldEvidenceRevision {
  const decision = state.decisions[operation.decisionId]
  if (operation.action.kind !== 'world/evidence' || decision?.status !== 'accepted')
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence revision lost its original accepted response')
  const challenge = validateWorldEvidenceSupply(state, decision, operation.action), binding = state.entities[decision.entityId]?.binding
  if (binding === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence responder lost its canonical binding')
  return simulationWorldEvidenceRevisionSchema.parse({ id: `world-evidence-input:${operation.id}`, requestId: challenge.requestId,
    challengeId: challenge.id, revision: challenge.inputRevision + 1, answers: operation.action.answers,
    source: { actorId: decision.entityId, decisionId: decision.id, operationId: operation.id, epoch: decision.epoch, binding },
    notificationOperationId: operationId(state.spec.runId, decision.id, 1), sequence, time: decision.time,
    hash: businessFingerprint(operation.action) })
}

/**
 * Fold original clarification records atomically with their operation and notification intents.
 * @param state - Authoritative Native projection.
 * @param record - Strict retained evidence transition.
 * @param sequence - Native sequence retaining this transition.
 * @param runtime - Original installed domain leases.
 * @returns Projection after the validated evidence transition.
 */
export function foldWorldEvidence(state: SimulationSnapshot, record: WorldEvidenceRecord, sequence: number,
  runtime: NativeWorldRuntime): SimulationSnapshot {
  const world = state.world
  if (world === undefined) throw new SimulationWorldError('SIM_WORLD_NOT_CONFIGURED', 'Evidence requires the original World')
  if (record.kind === 'evidence/exhausted') {
    const expected = worldEvidenceExhaustionRecords(state).find(value => value.challengeId === record.challengeId)
    if (!isDeepStrictEqual(expected, record)) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence exhaustion lost its terminal original attempts')
    const question = requireWorldEvidence(state, record.challengeId), request = world.requests[question.requestId]
    if (request === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence lost its original request')
    const result = { id: worldResultIdentity(request.intentId), requestId: request.id, intentId: request.intentId,
      source: { kind: 'evidence-exhausted' as const, challengeId: question.id, decisionId: record.decisionId },
      outcome: { kind: 'rejected' as const, reason: 'insufficient-information' as const }, payload: {}, time: state.time, sequence }
    let next = withWorldResult({ ...state, world: { ...world, evidence: { ...world.evidence, challenges: {
      ...world.evidence.challenges, [question.id]: { ...question, status: 'exhausted', settledSequence: sequence },
    } } } }, result, runtime)
    for (const wake of worldResultWakeRecords(next, result, runtime)) next = foldSchedulerRecord(next, wake, sequence, runtime)
    return next
  }
  if (record.kind === 'evidence/opened') {
    const plan = world.plans[record.challenge.planId]
    if (plan === undefined || world.evidence.challenges[record.challenge.id] !== undefined
      || !isDeepStrictEqual(record.challenge, prepareWorldEvidenceChallenge(state, plan, sequence, runtime)))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence question changed its original declaration or source')
    const request = world.requests[record.challenge.requestId]
    if (request === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence lost its original request')
    return { ...state, world: { ...world, evidence: { ...world.evidence, challenges: {
      ...world.evidence.challenges, [record.challenge.id]: record.challenge } },
    requests: { ...world.requests, [request.id]: { ...request, status: 'awaiting-evidence' } } } }
  }
  const operation = state.operations[record.revision.source.operationId]
  if (operation === undefined || world.evidence.revisions[record.revision.id] !== undefined
    || !isDeepStrictEqual(record.revision, prepareWorldEvidenceRevision(state, operation, sequence)))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence revision changed its original response or source')
  const challenge = requireWorldEvidence(state, record.revision.challengeId), request = world.requests[challenge.requestId]
  if (request === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence lost its original request')
  return { ...state, world: { ...world, evidence: {
    challenges: { ...world.evidence.challenges, [challenge.id]: { ...challenge, status: 'answered',
      settledSequence: sequence, responseRevisionId: record.revision.id } },
    revisions: { ...world.evidence.revisions, [record.revision.id]: record.revision },
  }, requests: { ...world.requests, [request.id]: { ...request, status: 'open' } } } }
}

/**
 * Materialize only the original responder's safe question after its actual private delivery.
 * @param state - Authoritative Native projection.
 * @param decision - Actual canonical actor decision.
 * @param id - Original question or revision identity.
 * @returns Safe question material, authority and visible sources.
 */
export function worldEvidenceContext(state: SimulationSnapshot, decision: SimulationDecision, id: WorldEvidenceChallengeId): {
  authority: import('@clocky/clocky-simulation').SimulationWorldContext
  text: string
  sources: import('@clocky/clocky-session').SimulationContextReference[]
} {
  const challenge = requireWorldEvidence(state, id), world = requireWorld(state), request = world.requests[challenge.requestId]
  const notification = state.operations[challenge.notificationOperationId], receipt = notification?.outbox?.receipt
  if (request === undefined || !challenge.responders.includes(decision.entityId)
    || challenge.status !== 'awaiting' || request.status !== 'awaiting-evidence'
    || BigInt(decision.time) >= BigInt(challenge.deadline))
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Evidence context requires its original live responder and question')
  if (notification?.action.kind !== 'communication/post' || notification.action.recipient !== decision.entityId
    || notification.result?.status !== 'applied' || receipt === undefined || notification.delivery?.receipt === undefined
    || notification.delivery.sessionId !== state.entities[decision.entityId]?.binding?.sessionId
    || BigInt(notification.action.deliverAt) > BigInt(decision.time))
    throw new SimulationWorldError('SIM_WORLD_DELIVERY', 'Evidence question requires its original due private notification')
  const used = worldEvidenceAttempts(state, request.id, challenge.id, decision.id)
  if (used >= challenge.maxAttempts || worldEvidenceAttempts(state, request.id, undefined, decision.id)
    >= world.definition.limits.maxEvidenceAttemptsPerRequest)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Evidence attempts are exhausted', 'plans')
  const authority = { kind: 'evidence' as const, pin: request.pin, intentId: request.intentId, requestId: request.id,
    challengeId: challenge.id, inputRevision: challenge.inputRevision,
    notificationOperationId: challenge.notificationOperationId, baseRevision: state.revision }
  return { authority, sources: [
    { kind: 'run-event', runId: state.spec.runId, sequence: challenge.sequence },
    { kind: 'team-envelope', teamId: receipt.teamId, channelId: receipt.channelId, envelopeId: receipt.envelopeId },
  ], text: JSON.stringify({ kind: 'world-context', authority, request: { id: request.id, proposal: request.proposal },
    question: { id: challenge.id, fields: challenge.fields, deadline: challenge.deadline,
      expectedInputRevision: challenge.inputRevision, attemptsRemaining: challenge.maxAttempts - used },
    instruction: 'Answer every requested field using your own known information and only source references present in this context. '
      + 'Answers are attributed statements, not authority to alter the original request. Submit no actions if you cannot answer.' }) }
}

/**
 * Derive finite exhaustion only after charged decisions have actually ended without an accepted answer.
 * @param state - Authoritative Native projection.
 * @returns Deterministic terminal records for exhausted closed attempts.
 */
export function worldEvidenceExhaustionRecords(state: SimulationSnapshot): Array<Extract<WorldEvidenceRecord, { kind: 'evidence/exhausted' }>> {
  const world = state.world
  if (world === undefined) return []
  return Object.values(world.evidence.challenges).flatMap((question) => {
    if (question.status !== 'awaiting' || world.requests[question.requestId]?.status !== 'awaiting-evidence') return []
    const attempts = evidenceDecisions(state, question.requestId, question.id)
    if (attempts.length < question.maxAttempts
      && worldEvidenceAttempts(state, question.requestId) < world.definition.limits.maxEvidenceAttemptsPerRequest
      || attempts.some(value => value.status === 'open' || value.status === 'submitted')) return []
    const last = attempts.toSorted((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))[0]
    if (last?.closedAt === undefined) return []
    return [{ kind: 'evidence/exhausted' as const, challengeId: question.id, decisionId: last.id }]
  })
}

/**
 * Verify copied evidence and terminal attempt sources against their immutable Native owners.
 * @param state - Authoritative Native projection.
 * @param runtime - Original installed domain leases.
 */
export function assertWorldEvidenceProjection(state: SimulationSnapshot, runtime?: NativeWorldRuntime): void {
  const world = state.world
  if (world === undefined) return
  function fail(): never { throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World evidence lost its original source or revision chain') }
  for (const [id, stored] of Object.entries(world.evidence.challenges)) {
    const question = simulationWorldEvidenceChallengeSchema.parse(stored), request = world.requests[question.requestId]
    const plan = world.plans[question.planId], operation = state.operations[question.source.operationId]
    const decision = state.decisions[question.source.decisionId], notice = state.operations[question.notificationOperationId]
    const scope = decision?.context?.status === 'prepared' ? decision.context.world : undefined
    const ask = plan?.proposal.resolution
    const previous = Object.values(world.evidence.challenges)
      .filter(value => value.requestId === question.requestId && value.sequence < question.sequence)
    const input = latestWorldEvidence(state, question.requestId, question.sequence - 1)
    if (id !== question.id || id !== `world-evidence:${question.planId}` || request === undefined
      || ask?.kind !== 'awaiting-evidence' || plan?.operationId !== operation?.id || plan?.requestId !== request.id
      || operation?.action.kind !== 'world/resolve' || !isDeepStrictEqual(operation.action, plan.proposal)
      || operation.decisionId !== decision?.id || decision.status !== 'accepted' || decision.entityId !== world.definition.directorEntityId
      || scope?.kind !== 'resolve' || scope.requestId !== request.id || question.source.epoch !== decision.epoch
      || !isDeepStrictEqual(question.source.binding, state.entities[decision.entityId]?.binding)
      || question.sequence <= plan.sequence || question.sequence > state.revision
      || question.round !== previous.length + 1 || question.inputRevision !== (input?.revision ?? 0)
      || !isDeepStrictEqual(question.responders, [request.requesterEntityId])
      || question.deadline !== ask.deadline || question.maxAttempts !== ask.maxAttempts
      || !isDeepStrictEqual(question.fields.map(value => value.code), ask.missingFields)
      || notice?.id !== operationId(state.spec.runId, decision.id, 1) || notice.action.kind !== 'communication/post'
      || notice.action.recipient !== request.requesterEntityId || notice.action.text !== worldEvidenceNotice(question.id, request.id)
      || notice.decisionId !== decision.id || !notice.dependencies.includes(operation.id)) fail()
    if (runtime !== undefined) {
      const fields = runtime.original(request.pin).definition.evidenceFields ?? []
      if (!isDeepStrictEqual(question.fields, ask.missingFields.map(code => fields.find(field => field.code === code)))) fail()
    }
    const revisions = Object.values(world.evidence.revisions).filter(value => value.challengeId === question.id)
    if (question.status === 'answered' ? revisions.length !== 1 || revisions[0]?.id !== question.responseRevisionId
      || revisions[0]?.sequence !== question.settledSequence : revisions.length !== 0) fail()
    if (question.status === 'awaiting' && request.status !== 'awaiting-evidence') fail()
    if (question.status === 'exhausted') {
      const result = world.results[worldResultIdentity(request.intentId)], settledSequence = question.settledSequence
      if (settledSequence === undefined) fail()
      const attempts = evidenceDecisions(state, request.id, question.id).filter(value => value.snapshotRevision < settledSequence)
      const total = evidenceDecisions(state, request.id).filter(value => value.snapshotRevision < settledSequence)
      const last = attempts.toSorted((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))[0]
      if (result?.source.kind !== 'evidence-exhausted' || result.source.challengeId !== question.id
        || result.sequence !== question.settledSequence || result.source.decisionId !== last?.id
        || attempts.some(value => value.closedAt === undefined || value.closedAt >= result.sequence)
        || attempts.length < question.maxAttempts && total.length < world.definition.limits.maxEvidenceAttemptsPerRequest) fail()
    }
  }
  for (const [id, stored] of Object.entries(world.evidence.revisions)) {
    const revision = simulationWorldEvidenceRevisionSchema.parse(stored), question = world.evidence.challenges[revision.challengeId]
    const operation = state.operations[revision.source.operationId], decision = state.decisions[revision.source.decisionId]
    const notice = state.operations[revision.notificationOperationId]
    if (id !== revision.id || id !== `world-evidence-input:${operation?.id}` || question?.status !== 'answered'
      || question.responseRevisionId !== id || question.requestId !== revision.requestId || question.inputRevision + 1 !== revision.revision
      || operation?.action.kind !== 'world/evidence' || operation.action.challengeId !== question.id
      || operation.action.requestId !== revision.requestId || operation.action.expectedInputRevision !== question.inputRevision
      || !isDeepStrictEqual(operation.action.answers, revision.answers) || revision.hash !== businessFingerprint(operation.action)
      || decision?.status !== 'accepted' || operation.decisionId !== decision.id || decision.entityId !== revision.source.actorId
      || revision.source.epoch !== decision.epoch || !isDeepStrictEqual(revision.source.binding, state.entities[decision.entityId]?.binding)
      || !evidenceDecisions(state, revision.requestId, question.id).some(value => value.id === decision.id)
      || decision.consumption?.notification?.operationId !== question.notificationOperationId
      || revision.time !== decision.time || BigInt(revision.time) >= BigInt(question.deadline)
      || revision.sequence <= question.sequence || revision.sequence > state.revision
      || notice?.id !== operationId(state.spec.runId, decision.id, 1) || notice.action.kind !== 'communication/post'
      || notice.action.recipient !== world.definition.directorEntityId
      || notice.action.text !== worldEvidenceRevisionNotice(revision.id, revision.requestId)
      || notice.decisionId !== decision.id || !notice.dependencies.includes(operation.id)) fail()
  }
  for (const request of Object.values(world.requests)) {
    const awaiting = Object.values(world.evidence.challenges).filter(value => value.requestId === request.id && value.status === 'awaiting')
    if (request.status === 'awaiting-evidence' ? awaiting.length !== 1 : awaiting.length !== 0) fail()
  }
  if (worldEvidenceExhaustionRecords(state).length !== 0) fail()
}
