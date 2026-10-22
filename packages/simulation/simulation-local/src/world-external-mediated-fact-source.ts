import { worldRolePlanOperationId } from '@clocky/clocky-simulation'
/** Exact historical structured publication source; this reader never recomputes a next version or present-day balance. */
import { isDeepStrictEqual } from 'node:util'
import { simulationExternalAdjudicationSchema, simulationWorldFactAdjudicatedRequestSchema,
  WORLD_EXTERNAL_MEDIATED_PIN, WORLD_EXTERNAL_MEDIATION_FACT_SCHEMA_REF, simulationContextConsumptionSchema,
  simulationContextConsumptionHash } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationWorldFactRequest, SimulationExternalAdjudicatedFactProvenance } from '@clocky/clocky-simulation'
import { businessFingerprint } from './business.ts'

/**
 * Read the actually retained canonical publication from its original adjudication or event consumption.
 * @param state - Complete Native projection retaining original source records.
 * @param provenance - Strict slim original references from the proposed structured publication.
 * @returns exact captured publication, or undefined for missing or changed source; no version or amount is recomputed.
 */
export function originalAdjudicatedFactSource(state: SimulationSnapshot,
  provenance: SimulationExternalAdjudicatedFactProvenance): SimulationWorldFactRequest | undefined {
  const world = state.world, candidate = world?.external.adjudications[provenance.intentId]
  if (world === undefined || candidate === undefined) return undefined
  const parsed = simulationExternalAdjudicationSchema.safeParse(candidate)
  if (!parsed.success) return undefined
  const record = parsed.data, plan = world.plans[record.planId], intent = world.intents[record.intentId]
  const request = world.requests[record.requestId],
    operation = plan === undefined ? undefined : state.operations[worldRolePlanOperationId(plan)]
  const decision = operation === undefined ? undefined : state.decisions[operation.decisionId]
  if (record.identityId !== provenance.identityId || record.intentId !== provenance.intentId
    || record.requestId !== provenance.requestId || record.planId !== provenance.planId
    || record.sequence !== provenance.adjudicationSequence || record.policyFingerprint !== provenance.policyFingerprint
    || businessFingerprint(record.policyParameters) !== record.policyFingerprint
    || businessFingerprint(record.actualInputs) !== record.actualInputHash
    || !isDeepStrictEqual(world.definition.externalAdjudicationPolicy, record.policyParameters)
    || !isDeepStrictEqual(intent?.pin, WORLD_EXTERNAL_MEDIATED_PIN) || !isDeepStrictEqual(plan?.pin, WORLD_EXTERNAL_MEDIATED_PIN)
    || request?.intentId !== record.intentId || plan?.requestId !== record.requestId || plan.status !== 'accepted'
    || plan.proposal.resolution.kind !== 'apply' || !isDeepStrictEqual(plan.proposal.resolution.payload, record.proposal)
    || !isDeepStrictEqual(intent?.payload, record.request) || decision?.id !== record.basis.decisionId
    || decision.entityId !== world.definition.directorEntityId || decision.status !== 'accepted'
    || decision.context?.status !== 'prepared' || decision.consumption === undefined
    || decision.context.fingerprint !== record.basis.contextFingerprint || record.basis.actorId !== decision.entityId
    || !simulationContextConsumptionSchema.safeParse(decision.consumption).success
    || decision.consumption.contextHash !== simulationContextConsumptionHash(decision.context.view)
    || decision.consumption.inputId !== decision.context.view.inputId
    || decision.consumption.sessionId !== state.entities[decision.entityId]?.binding?.sessionId
    || decision.context.view.entityId !== decision.entityId || decision.context.view.runId !== state.spec.runId
    || decision.context.view.epoch !== decision.epoch || decision.context.view.slot !== decision.slot
    || decision.context.view.time !== decision.time || decision.context.view.projections.run !== decision.snapshotRevision
    || decision.context.view.projections.entity !== decision.entityRevision) return undefined
  if (record.basis.kind === 'model' && (record.basis.modelVersion !== decision.context.view.versions.model
    || record.basis.personaVersion !== decision.context.view.versions.persona || decision.deterministic !== undefined)) return undefined
  if (record.basis.kind === 'policy' && !isDeepStrictEqual(record.basis.policy, decision.deterministic?.policy)) return undefined
  let actual: unknown = record.actualPublication
  let asOf = record.time, sourceSequence = plan.sequence
  let outcome = record.proposal.outcome
  if (provenance.event !== undefined) {
    const retained = world.external.events[provenance.event.eventId]
    if (retained?.status !== 'consumed' || retained.consumption?.sequence !== provenance.event.consumedSequence
      || retained.original.intentId !== record.intentId || retained.original.adjudicationSequence !== record.sequence
      || retained.original.policyFingerprint !== record.policyFingerprint || outcome.kind !== 'delayed-event'
      || !isDeepStrictEqual(retained.original.leaf, outcome.outcome)) return undefined
    outcome = outcome.outcome
    actual = retained.consumption.actualPublication
    asOf = retained.consumption.time
    sourceSequence = record.sequence
  }
  if (outcome.kind !== 'environmental-fact' || actual === undefined) return undefined
  const publication = simulationWorldFactAdjudicatedRequestSchema.safeParse(actual)
  if (!publication.success) return undefined
  const value = publication.data
  const audience = outcome.disclosure.kind === 'requester' ? { kind: 'actors', entityIds: [request.requesterEntityId] } : outcome.disclosure
  const expectedId = `external-fact:${businessFingerprint([record.identityId, outcome.factKey]).slice(7)}`
  if (value.factId !== expectedId || !isDeepStrictEqual(value.audience, audience) || value.availableAt !== asOf
    || value.payload.asOf !== asOf
    || !isDeepStrictEqual(value.sources, [{ kind: 'run-event', runId: state.spec.runId, sequence: sourceSequence }])) return undefined
  if (value.subject !== record.request.subjectRef || value.scope !== record.request.scope
    || String(value.schemaRef) !== WORLD_EXTERNAL_MEDIATION_FACT_SCHEMA_REF
    || !isDeepStrictEqual(value.payload.claim, outcome.claim) || !isDeepStrictEqual(value.payload.provenance, provenance)
    || value.effectiveFrom !== outcome.effectiveFrom || value.effectiveUntil !== outcome.effectiveUntil
    || value.sources.some(source => source.runId !== state.spec.runId
      || source.sequence >= (provenance.event?.consumedSequence ?? record.sequence))) return undefined
  return value
}
