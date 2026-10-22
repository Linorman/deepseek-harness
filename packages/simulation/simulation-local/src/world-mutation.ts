import { assertRunControlRequest } from './run-control.ts'
import { localObjectFallback, localObjectMaintenance, localObjectFootprint } from './world-local-object.ts'
import { WORLD_LOCAL_OBJECT_PIN, localObjectRenameSchema, localObjectFootprintSchema } from '@clocky/clocky-simulation'
import { WORLD_ENVIRONMENT_PIN, WORLD_EXPERIENCE_PIN } from '@clocky/clocky-simulation'
import { WORLD_HIRING_MARKET_PIN, simulationOfferRevisionSchema } from '@clocky/clocky-simulation'
import { prepareHiringResourceReservation, installHiringResourceReservation } from './world-hiring-resources.ts'
import { assertAcceptedWorldPlanSource } from './world-management.ts'
import { parseSimulationWorldSchema } from '@clocky/clocky-simulation'
import { applyExternalEffect, prepareExternalEvaluation } from './world-external.ts'
import { applyExternalAdjudication, prepareExternalAdjudication } from './world-external-mediated.ts'
import { foldWorldFact, worldFactOwner } from './world-facts.ts'
import { finishPersonnelMutation } from './world-personnel.ts'
/** Atomic domain changes and outcomes over the original Native journal, without provider IO in the fold. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { simulationWorldDomainMutationSchema, simulationExternalInteractionSchema, simulationExternalAdjudicationSchema,
  WORLD_EXTERNAL_MEDIATED_PIN, WORLD_EXTERNAL_INTERACT_PIN, SimulationWorldError, activeSimulationMaintenance } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import { foldEntityChange } from './entities.ts'
import { WORLD_REPRESENTATION_PIN } from '@clocky/clocky-simulation'
import { applyNormEffect } from './world-norms.ts'
import { requireWorld, worldPlanStaleReason, withWorldResult, worldResultIdentity } from './world.ts'
import { requireWorldRuntime } from './world-runtime.ts'
import type { NativeWorldRuntime } from './world-runtime.ts'
import { commitHiringResourceReservation, hiringFee } from './world-hiring-resources.ts'

/** Native-assigned exact responsibility; untrusted journal payloads cannot choose changes or outcome. */
export const worldMutationRecordSchema = z.strictObject({
  kind: z.literal('world/mutation'), mutation: simulationWorldDomainMutationSchema,
  localFootprint: localObjectFootprintSchema.optional(),
  externalEvaluation: simulationExternalInteractionSchema.optional(),
  externalAdjudication: simulationExternalAdjudicationSchema.optional(),
}).refine(value => value.externalEvaluation === undefined || value.externalAdjudication === undefined,
  'A mutation retains one original external execution family')
/** Strict original mutation record. */
export type WorldMutationRecord = z.infer<typeof worldMutationRecordSchema>

/**
 * Retain actual closed external rule inputs/output before the journal append; no model or provider IO is available.
 * @param state - Current authoritative prefix within the Native queue.
 * @param mutation - Exact Native-derived pinned source and clocks.
 * @param runtime - Original registered pure domain implementation.
 * @returns complete durable record whose replay uses the actual retained evaluation.
 */
export function prepareWorldMutationRecord(state: SimulationSnapshot, mutation: WorldMutationRecord['mutation'],
  runtime: NativeWorldRuntime | undefined): WorldMutationRecord {
  const world = requireWorld(state), plan = world.plans[mutation.planId], request = world.requests[mutation.requestId]
  const intent = request === undefined ? undefined : world.intents[request.intentId]
  if (plan === undefined || intent === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Mutation preparation lost its original plan')
  const module = requireWorldRuntime(runtime).original(plan.pin)
  const projection = module.reduceMutation(state, intent, plan, mutation.payload)
  const effects = projection.externalEffects ?? []
  const adjudications = projection.externalAdjudicationEffects ?? []
  if (adjudications.length > 0) {
    if (adjudications.length !== 1 || adjudications[0] === undefined || effects.length !== 0
      || !isDeepStrictEqual(plan.pin, WORLD_EXTERNAL_MEDIATED_PIN))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Adjudication requires its sole exact original pinned effect')
    return { kind: 'world/mutation', mutation,
      externalAdjudication: prepareExternalAdjudication(state, mutation, adjudications[0]) }
  }
  if (effects.length === 0) return { kind: 'world/mutation', mutation,
    ...isDeepStrictEqual(plan.pin, WORLD_LOCAL_OBJECT_PIN) ? {
      localFootprint: localObjectFootprint(state, localObjectRenameSchema.parse(mutation.payload).targetEntityId),
    } : {} }
  if (effects.length !== 1 || effects[0] === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
    'External mutation requires one exact recorded evaluation')
  return { kind: 'world/mutation', mutation, externalEvaluation: prepareExternalEvaluation(state, mutation, effects[0]) }
}

/**
 * Reduce and validate one original domain mutation before publishing any effect or result.
 * @param state - Authoritative prior Native projection.
 * @param record - Parsed original responsibility; changes are derived by its retained pure implementation.
 * @param sequence - Exact journal position.
 * @param runtime - Explicit original parser/reducer catalog.
 * @returns the single atomic business projection; uncertain IO cannot enter this capability.
 */
export function foldWorldMutation(state: SimulationSnapshot, record: WorldMutationRecord, sequence: number,
  runtime: NativeWorldRuntime | undefined): SimulationSnapshot {
  const world = requireWorld(state), mutation = record.mutation, plan = world.plans[mutation.planId]
  const request = plan === undefined ? undefined : world.requests[plan.requestId]
  const intent = request === undefined ? undefined : world.intents[request.intentId]
  const personnel = intent === undefined ? undefined : world.personnel.reservations[intent.id]
  const localObject = plan !== undefined && isDeepStrictEqual(plan.pin, WORLD_LOCAL_OBJECT_PIN)
  const localWindow = localObject
    && localObjectFallback(state, localObjectRenameSchema.parse(mutation.payload).targetEntityId) === undefined
  const localMaintenance = localObject && localObjectMaintenance(state, plan.id) !== undefined
  if (localObject ? !isDeepStrictEqual(record.localFootprint,
    localObjectFootprint(state, localObjectRenameSchema.parse(mutation.payload).targetEntityId)) : record.localFootprint !== undefined)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Local mutation footprint differs from its complete Native source')
  if (plan?.status !== 'accepted' || plan.proposal.resolution.kind !== 'apply' || request?.status !== 'open'
    || request.plans.at(-1) !== plan.id || intent === undefined
    || mutation.requestId !== request.id || mutation.id !== `world-mutation:${plan.id}` || mutation.sequence !== sequence
    || mutation.time !== state.time || !isDeepStrictEqual(mutation.pin, plan.pin)
    || Object.hasOwn(world.mutations, mutation.id) || state.activeWindowId !== undefined && !localWindow
      || activeSimulationMaintenance(state) !== undefined && personnel?.status !== 'ready' && !localMaintenance)
    throw new SimulationWorldError('SIM_WORLD_CONFLICT',
      'Domain mutation requires its latest original apply plan outside structural maintenance')
  const execution = world.executions[plan.id]
  if (execution?.phase !== 'armed' && execution?.phase !== 'outcome-unknown')
    assertRunControlRequest(state, request.proposal, runtime, { requestId: request.id })
  assertAcceptedWorldPlanSource(state, plan)
  if (worldPlanStaleReason(state, plan, runtime) !== undefined)
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Domain mutation lost its original execution dependencies')
  const module = requireWorldRuntime(runtime).original(plan.pin)
  if (Buffer.byteLength(JSON.stringify({ kind: 'run/world-mutation', runId: state.spec.runId,
    expectedRevision: sequence - 1, change: record }), 'utf8') > world.definition.limits.maxBytesPerPlan)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Complete retained domain mutation exceeds its byte allowance', 'bytes')
  const payload = parseSimulationWorldSchema(z.json(), parseSimulationWorldSchema(module.definition.schemas.mutation, mutation.payload))
  if (!isDeepStrictEqual(payload, mutation.payload))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Mutation payload differs from its strict original parser')
  module.validatePlan(state, intent, plan.proposal.resolution)
  const projection = module.reduceMutation(state, intent, plan, payload)
  const adjudications = projection.externalAdjudicationEffects ?? []
  if (isDeepStrictEqual(plan.pin, WORLD_EXTERNAL_MEDIATED_PIN) && adjudications.length !== 1)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Mediated implementation omitted its required original adjudication')
  if (adjudications.length > 0 && (adjudications.length !== 1 || !isDeepStrictEqual(plan.pin, WORLD_EXTERNAL_MEDIATED_PIN)
    || projection.changes.length !== 0 || (projection.normEffects?.length ?? 0) !== 0
    || (projection.externalEffects?.length ?? 0) !== 0 || record.externalEvaluation !== undefined))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Adjudication cannot change resources, institutions or select another execution family')
  if (record.externalAdjudication !== undefined && adjudications.length !== 1)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Unexpected adjudication on another domain mutation')
  if (isDeepStrictEqual(plan.pin, WORLD_EXTERNAL_INTERACT_PIN) && projection.externalEffects?.length !== 1)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'External implementation omitted its required closed evaluation')
  if ((projection.externalEffects?.length ?? 0) > 0 && (projection.externalEffects?.length !== 1
    || projection.changes.length !== 0 || (projection.normEffects?.length ?? 0) !== 0))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'External evaluation cannot change resources, institutions or identities')
  if (record.externalEvaluation !== undefined && (projection.externalEffects?.length ?? 0) !== 1)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Unexpected external evaluation on another domain mutation')
  let next = state
  if (hiringFee(state, intent)?.operation === 'hire-existing') next = commitHiringResourceReservation(state, plan, sequence)
  let adjudicatedResult: import('@clocky/clocky-simulation').SimulationWorldJsonValue | undefined
  for (const change of projection.changes) next = foldEntityChange(next, change, undefined,
    isDeepStrictEqual(mutation.pin, WORLD_ENVIRONMENT_PIN) || isDeepStrictEqual(mutation.pin, WORLD_EXPERIENCE_PIN),
    isDeepStrictEqual(mutation.pin, WORLD_REPRESENTATION_PIN))
  for (const effect of projection.normEffects ?? []) {
    const source = { requestId: mutation.requestId, planId: mutation.planId, mutationId: mutation.id }
    const norms = applyNormEffect(next, source, effect, sequence, mutation.recordedAt)
    next = { ...next, world: { ...requireWorld(next), norms } }
  }
  for (const effect of projection.externalEffects ?? []) {
    const external = applyExternalEffect(next, mutation, effect, record.externalEvaluation)
    next = { ...next, world: { ...requireWorld(next), external } }
  }
  for (const effect of adjudications) {
    const applied = applyExternalAdjudication(next, mutation, effect, record.externalAdjudication)
    next = { ...next, world: { ...requireWorld(next), external: applied.external } }
    for (const publication of applied.publications) {
      const { sources, ...input } = publication
      next = foldWorldFact(next, { kind: 'world/fact-recorded', fact: { ...input,
        source: { kind: 'owner', owner: worldFactOwner(next), references: sources },
        sequence, recordedAt: mutation.recordedAt } }, sequence)
    }
    adjudicatedResult = applied.resultPayload
  }
  if (world.personnel.reservations[intent.id]?.status === 'ready') next = finishPersonnelMutation(next, intent.id, sequence)
  const resultPayload = parseSimulationWorldSchema(z.json(), parseSimulationWorldSchema(module.definition.schemas.result,
    adjudicatedResult ?? record.externalEvaluation?.result ?? projection.resultPayload))
  if (adjudications.length > 0 && (!isDeepStrictEqual(projection.resultPayload, {}) || adjudicatedResult === undefined))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Adjudicated result must derive solely from its actual original retained outcome')
  if ((projection.externalEffects?.length ?? 0) > 0
    && (!isDeepStrictEqual(projection.resultPayload, {})
      || !isDeepStrictEqual(resultPayload, requireWorld(next).external.interactions[intent.id]?.result)))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'External result differs from its independently derived actual outcome')
  next = { ...next, world: { ...requireWorld(next), mutations: { ...world.mutations, [mutation.id]: mutation } } }
  next = withWorldResult(next, { id: worldResultIdentity(intent.id), requestId: request.id, intentId: intent.id,
    source: { kind: 'plan', planId: plan.id }, outcome: { kind: 'committed' }, payload: resultPayload,
    time: state.time, sequence }, runtime)
  if (isDeepStrictEqual(intent.pin, WORLD_HIRING_MARKET_PIN)) {
    const accepted = simulationOfferRevisionSchema.safeParse(resultPayload)
    if (accepted.success && (accepted.data.status === 'accepted'
      || accepted.data.status === 'proposed' && accepted.data.reservationPolicy === 'on-proposal')) {
      const hiringPlan = requireWorld(next).plans[accepted.data.planId]
      if (hiringPlan === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Accepted offer lost its original plan')
      const hold = prepareHiringResourceReservation(next, hiringPlan, sequence)
      next = installHiringResourceReservation(next, hiringPlan, hold, sequence)
    }
  }
  return next
}
