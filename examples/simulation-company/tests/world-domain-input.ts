/** Fixture builders express hiring through the strict generic owner API, without reintroducing a public legacy alias. */
import { simulationWorldHirePayloadSchema, simulationHireIntentRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldIntent, SimulationHireIntentRequest } from '@clocky/clocky-simulation'

/**
 * Inspect the original hiring payload in tests.
 * @param intent - Exact generic intent with a hiring payload.
 * @returns the strict business fields used by hiring-specific fixture assertions.
 */
export function hiringIntentFields(intent: SimulationWorldIntent | undefined): SimulationHireIntentRequest {
  if (intent === undefined) throw new Error('Original domain intent is missing')
  const payload = simulationWorldHirePayloadSchema.parse(intent.payload)
  return simulationHireIntentRequestSchema.parse({ organizationEntityId: payload.organizationEntityId,
    positionEntityId: payload.positionEntityId, requesterEntityId: intent.requesterEntityId, applicationId: intent.businessKey,
    ...payload.priorRequestId === undefined ? {} : { priorRequestId: payload.priorRequestId } })
}

/**
 * Construct a complete proposed request for an original hiring fixture.
 * @param run - Original Native owner.
 * @param input - Strict trusted hiring business fields.
 * @param description - Actual initial request description, retained before the requester decides.
 * @returns the original generic intent.
 */
export function seedHiringIntent(run: SimulationRun, input: SimulationHireIntentRequest, description?: string) {
  const original = Object.values(run.snapshot().world?.intents ?? {}).find(value => value.businessKey === input.applicationId
    && value.requesterEntityId === input.requesterEntityId)
  const retainedDescription = description ?? original?.description ?? 'A colleague is needed.'
  return run.openWorldIntent(input.requesterEntityId, { kind: 'world/request', domain: 'organization', operation: 'generate-and-hire',
    version: '1', businessKey: input.applicationId, expectedTime: null, evidence: [], payload: {
      organizationEntityId: input.organizationEntityId, positionEntityId: input.positionEntityId, description: retainedDescription,
      ...input.priorRequestId === undefined ? {} : { priorRequestId: input.priorRequestId } } })
}
