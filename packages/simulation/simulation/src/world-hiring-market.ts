import { simulationGenerationJobIdSchema } from './generation-identities.ts'
import { SessionId } from '@clocky/clocky-session/types'
import type { SimulationRelation } from './entity-types.ts'
import type { SimulationEntityId } from './identities.ts'
/** Finite Persona review and exact offer revisions. Native result records own the immutable history. */
import { z } from 'zod'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationWorldPersonaSchema, worldPlanIdSchema } from './world.ts'
import { simulationWorldDomainPinSchema } from './world-domain.ts'
import { simulationWorldAuthenticatedUserSourceSchema } from './world-management-source.ts'
import { simTimeSchema } from './time.ts'
import { simulationHiringFeePolicySchema } from './world-hiring-resources.ts'
import { simulationHireApprovalBasisSchema } from './world-hire-approval.ts'
import type { SimulationSnapshot } from './types.ts'
import type { WorldRequestId, WorldPlanId } from './world-types.ts'

const key = z.string().min(1).max(256)
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const revision = z.number().int().min(1).max(16)
const scope = { organizationEntityId: simulationEntityIdSchema, positionEntityId: simulationEntityIdSchema }
const draftBody = z.strictObject({ templateId: key, templateVersion: key, persona: simulationWorldPersonaSchema })
/** Explicit finite draft edit; each revision consumes the original bounded selection budget. */
export const simulationPersonaDraftCommandSchema = z.strictObject({ kind: z.literal('draft'), generationJobId: simulationGenerationJobIdSchema.exactOptional(), ...scope, id: key, expectedRevision: z.number().int().min(0).max(15), validUntil: simTimeSchema, body: draftBody })
/** Exact human/actor review decision; it never authorizes a candidate acceptance. */
export const simulationPersonaReviewCommandSchema = z.strictObject({ kind: z.literal('review'), ...scope, id: key, revision, bodyHash: hash, decision: z.enum(['reviewed', 'rejected', 'accepted', 'expired']), reason: z.string().min(1).max(2048) })
/** Human management can author or review finite drafts, never respond as a candidate. */
export const simulationPersonaManagementCommandSchema = z.union([simulationPersonaDraftCommandSchema, simulationPersonaReviewCommandSchema])
/** Finite review commands cannot carry arbitrary generated text, hidden source material or authority fields. */
export const simulationHiringMarketCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('vacancy'), ...scope, id: key, validUntil: simTimeSchema,
    capacity: z.number().int().positive().max(10000), requirements: z.array(key).max(32), reservationPolicy: z.enum(['on-proposal', 'on-acceptance']) }),
  z.strictObject({ kind: z.literal('application'), ...scope, id: key, vacancyId: key }),
  simulationPersonaDraftCommandSchema, simulationPersonaReviewCommandSchema,
  z.strictObject({ kind: z.literal('offer'), ...scope, id: key, expectedRevision: z.number().int().min(0).max(15),
    planId: worldPlanIdSchema, vacancyId: key, applicationId: key, candidateId: simulationEntityIdSchema, validUntil: simTimeSchema,
    terms: z.string().min(1).max(8192) }),
  z.strictObject({ kind: z.literal('offer-response'), ...scope, id: key, revision, bodyHash: hash,
    decision: z.enum(['delivered', 'accepted', 'declined', 'withdrawn', 'expired']) }),
])
/** Original Persona content is immutable after acceptance; revisions consume a finite sixteen-selection budget. */
export const simulationPersonaDraftSchema = z.strictObject({ kind: z.literal('persona-draft'), ...scope, id: key,
  revision, validUntil: simTimeSchema, body: draftBody, bodyHash: hash,
  prior: z.strictObject({ revision, bodyHash: hash }).nullable(),
  editedBy: z.strictObject({ actorId: simulationEntityIdSchema.nullable(), user: simulationWorldAuthenticatedUserSourceSchema.nullable() }),
  reviewReason: z.string().max(2048).nullable(), source: z.union([
    z.strictObject({ kind: z.literal('finite-template'), actorId: simulationEntityIdSchema.nullable(),
      user: simulationWorldAuthenticatedUserSourceSchema.nullable(), generatorVersion: z.literal('finite-template/1'),
      modelVersion: z.null(), templateId: key, templateVersion: key, policyVersion: key }),
    z.strictObject({ kind: z.literal('generation'), actorId: simulationEntityIdSchema.nullable(),
      user: simulationWorldAuthenticatedUserSourceSchema.nullable(), generatorVersion: z.literal('isolated-generation/1'),
      modelVersion: key, templateId: key, templateVersion: key, policyVersion: key, generationJobId: simulationGenerationJobIdSchema,
      sessionId: key.transform(SessionId), sessionSequence: z.number().int().nonnegative() }),
  ]),
  status: z.enum(['draft', 'reviewed', 'rejected', 'accepted', 'expired']), reviewerId: simulationEntityIdSchema.nullable(), reviewerSource: simulationWorldAuthenticatedUserSourceSchema.nullable() })
/** A one-time fee is frozen from its Native plan. Recurring salary is deliberately not supported by this contract. */
export const simulationOfferRevisionSchema = z.strictObject({ kind: z.literal('offer-revision'), ...scope, id: key,
  revision, planId: worldPlanIdSchema, vacancyId: key, applicationId: key, candidateId: simulationEntityIdSchema,
  employerId: simulationEntityIdSchema,
  validUntil: simTimeSchema, terms: z.string().min(1).max(8192), bodyHash: hash,
  fee: simulationHiringFeePolicySchema.nullable(), approvals: z.array(simulationHireApprovalBasisSchema), reservationPolicy: z.enum(['on-proposal', 'on-acceptance']),
  compensation: z.literal('one-time-only'), status: z.enum(['proposed', 'delivered', 'accepted', 'declined', 'withdrawn', 'expired']) })
/** Fixed finite vacancy owner; acceptance consumes the original position and resource bounds. */
export const simulationVacancySchema = z.strictObject({ kind: z.literal('vacancy'), ...scope, id: key,
  employerId: simulationEntityIdSchema, validUntil: simTimeSchema, capacity: z.number().int().positive().max(10000),
  requirements: z.array(key).max(32), reservationPolicy: z.enum(['on-proposal', 'on-acceptance']) })
/** A candidate's own immutable application; employers cannot submit it on their behalf. */
export const simulationCandidateApplicationSchema = z.strictObject({ kind: z.literal('application'), ...scope, id: key,
  vacancyId: key, candidateId: simulationEntityIdSchema })
/** Fixed scoped demand with a finite deadline and acceptance reservation policy. */
export type SimulationVacancy = z.infer<typeof simulationVacancySchema>
/** Original application attributed to the actual candidate. */
export type SimulationCandidateApplication = z.infer<typeof simulationCandidateApplicationSchema>
/** Complete committed transition, or the empty payload of a non-commit result. */
export const simulationHiringMarketResultSchema = z.union([simulationPersonaDraftSchema, simulationOfferRevisionSchema,
  simulationVacancySchema, simulationCandidateApplicationSchema, z.strictObject({})])
/** Exact parser and Native implementation generation. */
export const WORLD_HIRING_MARKET_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({ domain: 'organization',
  operation: 'hiring-market', version: '1', schemaRef: 'clocky.organization.hiring-market/schema/3',
  implementationRef: 'clocky.organization.hiring-market/native/3', generation: 1 }))
/** Shared parsers used by model requests, persistence and execution. */
export const WORLD_HIRING_MARKET_DEFINITION = Object.freeze({ domain: 'organization', operation: 'hiring-market', version: '1',
  schemaRef: WORLD_HIRING_MARKET_PIN.schemaRef, schemas: Object.freeze({ request: simulationHiringMarketCommandSchema,
    plan: simulationHiringMarketCommandSchema, mutation: simulationHiringMarketCommandSchema,
    result: simulationHiringMarketResultSchema }) })
/** Closed market intent with no caller-supplied authority. */
export type SimulationHiringMarketCommand = z.infer<typeof simulationHiringMarketCommandSchema>
/** Immutable finite Persona revision with its exact source and review state. */
export type SimulationPersonaDraft = z.infer<typeof simulationPersonaDraftSchema>
/** Original offer terms and independent candidate acceptance state. */
export type SimulationOfferRevision = z.infer<typeof simulationOfferRevisionSchema>
/**
 * Reconstruct latest revisions from committed Native results; no mutable sidecar or model invocation is needed.
 * @param state - Authoritative Native snapshot, not an untrusted client cache.
 * @returns fresh maps retaining only the latest transition for each stable business identity.
 */
export function hiringMarket(state: SimulationSnapshot): {
  drafts: Map<string, SimulationPersonaDraft>
  offers: Map<string, SimulationOfferRevision>
  vacancies: Map<string, SimulationVacancy>
  applications: Map<string, SimulationCandidateApplication>
} {
  const drafts = new Map<string, SimulationPersonaDraft>(), offers = new Map<string, SimulationOfferRevision>()
  const vacancies = new Map<string, SimulationVacancy>(), applications = new Map<string, SimulationCandidateApplication>()
  for (const result of Object.values(state.world?.results ?? {}).sort((a, b) => a.sequence - b.sequence)) {
    if (state.world?.intents[result.intentId]?.pin.implementationRef !== WORLD_HIRING_MARKET_PIN.implementationRef || result.outcome.kind !== 'committed') continue
    const value = simulationHiringMarketResultSchema.parse(result.payload)
    if ('kind' in value) {
      if (value.kind === 'persona-draft') drafts.set(value.id, value)
      else if (value.kind === 'offer-revision') offers.set(value.id, value)
      else if (value.kind === 'vacancy') vacancies.set(value.id, value)
      else applications.set(value.id, value)
    }
  }
  return { drafts, offers, vacancies, applications }
}

/**
 * Inspect the exact accepted offer required by an opt-in market scene before hiring may execute.
 * @param state - Authoritative Native snapshot.
 * @param planId - Original accepted existing-person plan.
 * @returns true in legacy scenes or when the candidate accepted this exact retained plan.
 */
export function hiringMarketAcceptance(state: SimulationSnapshot, planId: string): boolean {
  if (!state.world?.definition.operations.some(pin => pin.implementationRef === WORLD_HIRING_MARKET_PIN.implementationRef)) return true
  return [...hiringMarket(state).offers.values()].some(value => value.planId === planId && value.status === 'accepted')
}

/**
 * Keep accepted promises distinct from legacy admission, including after the offer's delivery deadline.
 * @param state - Authoritative Native snapshot.
 * @param planId - Original hiring plan.
 * @returns whether this plan has an immutable accepted offer.
 */
export function hasAcceptedHiringOffer(state: SimulationSnapshot, planId: string): boolean {
  return [...hiringMarket(state).offers.values()].some(value => value.planId === planId && value.status === 'accepted')
}

/**
 * Read retained accepted obligations awaiting their exact hiring result, including overdue offers.
 * @param state - Authoritative Native snapshot.
 * @returns original accepted offers; a technical replacement ID cannot release their capacity.
 */
export function pendingHiringOffers(state: SimulationSnapshot): SimulationOfferRevision[] {
  return [...hiringMarket(state).offers.values()].filter(value => value.status === 'accepted'
    && !Object.values(state.world?.results ?? {}).some(result => result.source.kind === 'plan'
      && result.source.planId === value.planId && result.outcome.kind === 'committed'))
}

/**
 * Reserve position capacity at the vacancy's declared decision boundary.
 * @param state - Authoritative Native prefix.
 * @returns accepted obligations and unexpired offers whose frozen policy reserves on proposal.
 */
export function reservedHiringOffers(state: SimulationSnapshot): SimulationOfferRevision[] {
  return [...hiringMarket(state).offers.values()].filter(value => (value.status === 'accepted'
    || value.reservationPolicy === 'on-proposal' && ['proposed', 'delivered'].includes(value.status)
      && BigInt(state.time) < BigInt(value.validUntil))
    && !Object.values(state.world?.results ?? {}).some(result => result.source.kind === 'plan'
      && result.source.planId === value.planId && result.outcome.kind === 'committed'))
}

/**
 * Authorize an original financial hold without treating proposal reservation as candidate consent.
 * @param state - Authoritative Native prefix.
 * @param planId - Original accepted hiring plan.
 * @returns legacy admission, accepted consent, or the exact live offer with proposal reservation.
 */
export function hiringMarketReservationAuthorized(state: SimulationSnapshot, planId: string): boolean {
  return hiringMarketAcceptance(state, planId) || reservedHiringOffers(state).some(value => value.planId === planId)
}

/**
 * Candidate eligibility substitutes only market membership, never employment or another operation's authority.
 * @param state - Authoritative Native prefix.
 * @param actorId - Actual canonical actor.
 * @param scope - Exact organization.
 * @returns active explicit eligibility relations to retain in consumed authority and execution reads.
 */
export function candidateMembership(state: SimulationSnapshot, actorId: SimulationEntityId,
  scope: SimulationEntityId): SimulationRelation[] {
  return Object.values(state.relations).filter(value => value.subject === actorId && value.relation === 'eligible-for-hire'
    && value.object === scope && value.scope === scope && BigInt(value.validFrom) <= BigInt(state.time)
    && (value.validUntil === null || BigInt(state.time) < BigInt(value.validUntil)))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Retain cancellation of the original hiring job after its exact terminal offer response.
 * @param state - Authoritative Native prefix; the independent Person and Session remain owned after cancellation.
 * @param marketPlanId - Original market response plan, not the generated hiring plan.
 * @returns original hiring request until its job cancellation is durable; never an identity cleanup request.
 */
export function pendingCandidateCancellation(state: SimulationSnapshot, marketPlanId: WorldPlanId): WorldRequestId | undefined {
  const result = Object.values(state.world?.results ?? {}).find(value => value.source.kind === 'plan'
    && value.source.planId === marketPlanId && value.outcome.kind === 'committed')
  if (result === undefined || state.world?.intents[result.intentId]?.pin.implementationRef !== WORLD_HIRING_MARKET_PIN.implementationRef)
    return undefined
  const offer = simulationOfferRevisionSchema.safeParse(result.payload)
  if (!offer.success || !['declined', 'withdrawn', 'expired'].includes(offer.data.status)) return undefined
  const plan = state.world.plans[offer.data.planId], request = plan === undefined ? undefined : state.world.requests[plan.requestId]
  return request?.status === 'open' ? request.id : undefined
}
