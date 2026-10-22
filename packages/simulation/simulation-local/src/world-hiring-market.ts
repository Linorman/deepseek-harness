import { generationRecordAt } from '@clocky/clocky-simulation'
import { OrganizationNativeWorldDomain } from './world-organization.ts'
import { WORLD_GENERATE_AND_HIRE_PIN, simulationWorldHirePayloadSchema, currentWorldAssignments, currentWorldOperationGrants } from '@clocky/clocky-simulation'
import { ExistingHireNativeWorldDomain } from './world-hire-existing.ts'
/** Native hiring market transitions share the atomic domain-result journal and authenticated actor path. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { pendingHiringOffers, hiringMarket, simulationHiringMarketCommandSchema,
  WORLD_HIRING_MARKET_DEFINITION, WORLD_HIRING_MARKET_PIN,
  SimulationWorldError, candidateMembership, simulationWorldReadSetSchema, simulationWorldHireExistingPayloadSchema,
  WORLD_HIRE_EXISTING_PIN } from '@clocky/clocky-simulation'
import type { NativeWorldDomain, SimulationSnapshot, SimulationWorldIntent, SimulationWorldPlan,
  SimulationWorldDomainRequest, SimulationEntityId, SimulationWorldBusinessResolution, SimulationWorldJsonValue,
  SimulationHiringMarketCommand, SimulationPersonaDraft, SimulationOfferRevision, SimulationVacancy, SimulationCandidateApplication, SimulationWorldAuthenticatedUserSource } from '@clocky/clocky-simulation'
import { businessFingerprint } from './business.ts'
import { hiringFee, hiringResourceReservationId, requireHiringResourceReservation } from './world-hiring-resources.ts'
import { requireHireApproval } from './world-hire-approval.ts'

function deny(message: string): never { throw new SimulationWorldError('SIM_WORLD_CONFLICT', message) }
function actor(intent: SimulationWorldIntent): SimulationEntityId | null { return intent.requesterEntityId }
function userSource(intent: SimulationWorldIntent): SimulationWorldAuthenticatedUserSource | undefined {
  return intent.requesterEntityId === null ? intent.source : undefined
}
function target(state: SimulationSnapshot, command: SimulationHiringMarketCommand) {
  const world = state.world
  const position = world?.definition.positions.find(value => value.entityId === command.positionEntityId)
  if (world === undefined || world.definition.organizationEntityId !== command.organizationEntityId || position === undefined)
    deny('Hiring market requires its installed organization and position')
  return { world, position }
}
function sameScope(value: { organizationEntityId: string; positionEntityId: string }, command: SimulationHiringMarketCommand) {
  if (value.organizationEntityId !== command.organizationEntityId || value.positionEntityId !== command.positionEntityId)
    deny('A market identity cannot move between organizations or positions')
}
/**
 * Project one exact transition; every check repeats at commit to serialize competing decisions.
 * @param state - Authoritative Native prefix containing the original source and current obligations.
 * @param actorId - Actual actor, or null only for authenticated human Persona management.
 * @param command - Strict finite market command; identity and authority are not supplied by this body.
 * @param user - Original authenticated user provenance for a draft or review; absent for actor decisions.
 * @returns complete immutable result proposal; invalid or stale transitions throw before effects.
 */
export function projectHiringMarket(state: SimulationSnapshot, actorId: SimulationEntityId | null,
  command: SimulationHiringMarketCommand, user?: SimulationWorldAuthenticatedUserSource):
SimulationPersonaDraft | SimulationOfferRevision | SimulationVacancy | SimulationCandidateApplication {
  const { world, position } = target(state, command)
  if (actorId === null && (user === undefined || command.kind !== 'draft' && command.kind !== 'review'))
    deny('Human management may only author or review a Persona draft')
  const market = hiringMarket(state)
  const vacancyObligations = [...market.offers.values()].filter(value => value.status === 'accepted'
    || value.reservationPolicy === 'on-proposal' && ['proposed', 'delivered'].includes(value.status)
      && BigInt(state.time) < BigInt(value.validUntil))
  if (actorId !== null && command.kind !== 'application' && !(command.kind === 'offer-response'
    && ['accepted', 'declined'].includes(command.decision))
    && !Object.values(state.relations).some(value => value.subject === actorId && value.relation === 'can-hire'
      && value.object === command.positionEntityId && value.scope === command.organizationEntityId
      && BigInt(value.validFrom) <= BigInt(state.time) && (value.validUntil === null || BigInt(state.time) < BigInt(value.validUntil))))
    deny('Employer and reviewer commands require current explicit scoped can-hire authority')
  if (command.kind === 'vacancy') {
    if (actorId === null) deny('Vacancy requires its employer actor')
    if (market.vacancies.has(command.id) || BigInt(command.validUntil) <= BigInt(state.time)
      || BigInt(command.validUntil) > BigInt(state.spec.maxTime)
      || command.capacity > position.capacity)
      deny('Vacancy requires a fresh identity and bounded installed position capacity and validity')
    return { ...command, employerId: actorId }
  }
  if (command.kind === 'application') {
    if (actorId === null) deny('Application requires its candidate actor')
    const vacancy = market.vacancies.get(command.vacancyId)
    if (vacancy === undefined || BigInt(vacancy.validUntil) <= BigInt(state.time) || market.applications.has(command.id)
      || [...market.applications.values()].some(value => value.vacancyId === command.vacancyId && value.candidateId === actorId))
      deny('Application requires one original candidate decision for an open vacancy')
    sameScope(vacancy, command)
    if (!candidateMembership(state, actorId, command.organizationEntityId).length) deny('Candidate lacks current explicit eligibility')
    return { ...command, candidateId: actorId }
  }
  if (command.kind === 'draft') {
    const prior = market.drafts.get(command.id)
    if (BigInt(command.validUntil) <= BigInt(state.time) || BigInt(command.validUntil) > BigInt(state.spec.maxTime))
      deny('Persona draft requires a finite future review deadline')
    if ((prior?.revision ?? 0) !== command.expectedRevision || prior?.status === 'accepted')
      deny('Persona revision is stale or its accepted birth content is immutable')
    if (prior !== undefined) {
      sameScope(prior, command)
      if (user === undefined && prior.source.actorId !== actorId)
        deny('Actor revision requires the original author; human revision requires authenticated management authority')
    }
    const template = world.definition.templates.find(value => value.id === command.body.templateId
      && value.version === command.body.templateVersion)
    if (template === undefined || !template.names.includes(command.body.persona.name)
      || (['skills', 'traits', 'goals'] as const).some(key => command.body.persona[key].some(value => !template[key].includes(value))))
      deny('Persona selection must remain inside its installed finite template')
    const generated = command.generationJobId === undefined ? undefined : generationRecordAt(state, command.generationJobId)
    if (command.generationJobId !== undefined && (generated?.status !== 'validated' || generated.cancellation !== undefined
      || generated.job.purpose !== 'persona' || generated.job.scope !== command.organizationEntityId
      || !generated.job.audience.includes(command.organizationEntityId) || generated.job.policyVersion !== world.definition.policyVersion
      || BigInt(generated.job.deadline) <= BigInt(state.time) || generated.sessionSequence === undefined
      || generated.content === undefined || !isDeepStrictEqual(JSON.parse(generated.content), command.body.persona)))
      deny('Generated Persona draft requires its exact validated original output and disclosure scope')
    let source: SimulationPersonaDraft['source'] = { kind: 'finite-template', actorId, user: user ?? null,
      generatorVersion: 'finite-template/1', modelVersion: null, templateId: template.id, templateVersion: template.version,
      policyVersion: world.definition.policyVersion }
    if (generated !== undefined) {
      const sessionSequence = generated.sessionSequence
      if (sessionSequence === undefined) deny('Generated Persona has no original Session input')
      source = { kind: 'generation', actorId, user: user ?? null, generatorVersion: 'isolated-generation/1',
        modelVersion: generated.job.model.version, templateId: template.id, templateVersion: template.version,
        policyVersion: world.definition.policyVersion, generationJobId: generated.job.id,
        sessionId: generated.binding.sessionId, sessionSequence }
    }
    return { kind: 'persona-draft', id: command.id, organizationEntityId: command.organizationEntityId,
      positionEntityId: command.positionEntityId, revision: command.expectedRevision + 1, validUntil: command.validUntil,
      body: command.body,
      bodyHash: businessFingerprint(command.body),
      prior: prior === undefined ? null : { revision: prior.revision, bodyHash: prior.bodyHash },
      editedBy: { actorId, user: user ?? null }, source: prior?.source ?? source,
      status: 'draft', reviewerId: null, reviewerSource: null, reviewReason: null }
  }
  if (command.kind === 'review') {
    const prior = market.drafts.get(command.id)
    if (prior === undefined || prior.revision !== command.revision || prior.bodyHash !== command.bodyHash
      || prior.status === 'accepted' || prior.status === 'rejected' || prior.status === 'expired'
      || command.decision === 'accepted' && prior.status !== 'reviewed') deny('Review requires the exact current reviewable draft')
    sameScope(prior, command)
    if (command.decision === 'expired' ? BigInt(state.time) < BigInt(prior.validUntil) : BigInt(state.time) >= BigInt(prior.validUntil))
      deny('Persona review is outside its original review deadline')
    return { ...prior, status: command.decision, reviewerId: actorId, reviewerSource: user ?? null, reviewReason: command.reason }
  }
  if (actorId === null) deny('Offer commands require the original actor')
  if (command.kind === 'offer') {
    const vacancy = market.vacancies.get(command.vacancyId), application = market.applications.get(command.applicationId)
    if (vacancy === undefined || application === undefined || application.vacancyId !== vacancy.id
      || application.candidateId !== command.candidateId || vacancy.employerId !== actorId
      || BigInt(command.validUntil) > BigInt(vacancy.validUntil)) deny('Offer requires its exact live vacancy and independent candidate application')
    sameScope(vacancy, command)
    const prior = market.offers.get(command.id)
    if ((prior?.revision ?? 0) !== command.expectedRevision || prior?.status === 'accepted') deny('Offer revision is stale or already accepted')
    if (prior !== undefined) {
      sameScope(prior, command)
      if (actorId !== prior.employerId || command.planId !== prior.planId || command.candidateId !== prior.candidateId
        || command.vacancyId !== prior.vacancyId || command.applicationId !== prior.applicationId)
        deny('Counteroffers retain the original employer, candidate, application and hiring plan')
    }
    const plan = world.plans[command.planId], request = plan === undefined ? undefined : world.requests[plan.requestId]
    const intent = request === undefined ? undefined : world.intents[request.intentId]
    if (plan === undefined || intent === undefined || request?.status !== 'open' || plan.status !== 'accepted'
      || plan.proposal.resolution.kind !== 'apply'
      || !isDeepStrictEqual(intent.pin, WORLD_HIRE_EXISTING_PIN) && !isDeepStrictEqual(intent.pin, WORLD_GENERATE_AND_HIRE_PIN)
      || intent.requesterEntityId !== actorId || request.plans.at(-1) !== plan.id)
      deny('Offer requires the employer’s exact original accepted existing-person hiring plan')
    const reservation = world.reservations[intent.id]
    const generated = isDeepStrictEqual(intent.pin, WORLD_GENERATE_AND_HIRE_PIN)
    if (generated && reservation?.status !== 'candidate') deny('Offer requires its confirmed independent generated candidate')
    const hired = generated ? { ...simulationWorldHirePayloadSchema.parse(intent.payload), personId: reservation?.identities.entityId }
      : simulationWorldHireExistingPayloadSchema.parse(intent.payload)
    sameScope(hired, command)
    if (hired.personId !== command.candidateId || BigInt(command.validUntil) <= BigInt(state.time)
      || BigInt(command.validUntil) > BigInt(state.spec.maxTime)) deny('Offer candidate or finite validity differs from its original hiring plan')
    if ([...market.offers.values()].some(value => value.id !== command.id && value.planId === plan.id))
      deny('A hiring plan cannot evade offer revisions through a new offer identity')
    const fee = hiringFee(state, intent) ?? null
    if (vacancy.reservationPolicy === 'on-proposal') {
      if (vacancyObligations.filter(value => value.id !== command.id && value.vacancyId === vacancy.id).length >= vacancy.capacity)
        deny('Vacancy capacity is already reserved')
      if (!generated) new ExistingHireNativeWorldDomain().validatePlan(state, intent, plan.proposal.resolution)
      const hold = state.resourceReservations[hiringResourceReservationId(plan.id)]
      if (hold !== undefined) requireHiringResourceReservation(state, plan)
      const expiresAt = hold?.expiresAt
        ?? (fee === null ? command.validUntil : String(BigInt(state.time) + BigInt(fee.reservationPeriod)))
      if (BigInt(command.validUntil) > BigInt(expiresAt)) deny('Offer validity exceeds its original proposal reservation')
    }
    const body = { planId: plan.id, vacancyId: vacancy.id, applicationId: application.id,
      candidateId: command.candidateId, employerId: actorId,
      organizationEntityId: command.organizationEntityId, positionEntityId: command.positionEntityId,
      validUntil: command.validUntil, terms: command.terms, fee,
      reservationPolicy: vacancy.reservationPolicy, compensation: 'one-time-only' as const,
      approvals: [...requireHireApproval(state, intent, plan)],
      revision: command.expectedRevision + 1 }
    return { kind: 'offer-revision', id: command.id, ...body, bodyHash: businessFingerprint(body),
      status: 'proposed' }
  }
  const prior = market.offers.get(command.id)
  if (prior === undefined || prior.revision !== command.revision || prior.bodyHash !== command.bodyHash
    || !['proposed', 'delivered'].includes(prior.status)) deny('Offer response requires the exact live revision and terms hash')
  sameScope(prior, command)
  const candidateDecision = command.decision === 'accepted' || command.decision === 'declined'
  if (actorId !== (candidateDecision ? prior.candidateId : prior.employerId)) deny('Offer decision is not from its original candidate or employer')
  if (candidateDecision && prior.status !== 'delivered') deny('Candidate must receive the same offer before deciding')
  if (command.decision === 'expired' ? BigInt(state.time) < BigInt(prior.validUntil) : BigInt(state.time) >= BigInt(prior.validUntil))
    deny('Offer validity does not permit this response')
  if (command.decision === 'accepted') {
    if (pendingHiringOffers(state).some(value => value.id !== prior.id && value.candidateId === prior.candidateId)) deny('Candidate already accepted an incompatible hiring obligation')
    const vacancy = market.vacancies.get(prior.vacancyId)
    if (vacancy === undefined || vacancyObligations.filter(value => value.id !== prior.id && value.vacancyId === vacancy.id).length >= vacancy.capacity) deny('Vacancy capacity is already committed')
    const plan = world.plans[prior.planId], request = plan === undefined ? undefined : world.requests[plan.requestId]
    const intent = request === undefined ? undefined : world.intents[request.intentId]
    if (plan === undefined || intent === undefined || request?.status !== 'open' || plan.status !== 'accepted'
      || request.plans.at(-1) !== plan.id || plan.proposal.resolution.kind !== 'apply' || !isDeepStrictEqual(requireHireApproval(state, intent, plan), prior.approvals)
      || !isDeepStrictEqual(hiringFee(state, intent) ?? null, prior.fee)) deny('Offer lost its original hiring plan, fee or current approvals')
    if (state.resourceReservations[hiringResourceReservationId(plan.id)] !== undefined) requireHiringResourceReservation(state, plan)
    if (!currentWorldAssignments(state, prior.employerId, prior.organizationEntityId).length
      || !currentWorldOperationGrants(state, prior.employerId, intent.pin, intent.scopeEntityId, intent.targetEntityId).length)
      deny('Offer employer lost its current hiring authority')
    if (isDeepStrictEqual(intent.pin, WORLD_GENERATE_AND_HIRE_PIN)) {
      const reservation = world.reservations[intent.id]
      if (reservation?.status !== 'candidate' || reservation.identities.entityId !== prior.candidateId)
        deny('Generated offer lost its original confirmed candidate')
      const module = new OrganizationNativeWorldDomain()
      module.validatePlan(state, intent, plan.proposal.resolution)
      if (module.executionReads(state, intent).some(read => !plan.reads.some(original => isDeepStrictEqual(original, read))))
        deny('Generated offer lost its original planning reads')
    } else new ExistingHireNativeWorldDomain().validatePlan(state, intent, plan.proposal.resolution)
  }
  return { ...prior, status: command.decision }
}

/** Installed actor-only operations: private Sessions are never consulted by review or inspection. */
export class HiringMarketNativeWorldDomain implements NativeWorldDomain {
  readonly definition = WORLD_HIRING_MARKET_DEFINITION
  readonly ref = WORLD_HIRING_MARKET_PIN.implementationRef
  readonly generation = WORLD_HIRING_MARKET_PIN.generation
  goalContext(state: SimulationSnapshot, actorId: SimulationEntityId): SimulationWorldJsonValue {
    const market = hiringMarket(state), world = state.world
    if (world === undefined) deny('Hiring market requires its installed organization and position')
    return z.json().parse({ kind: 'hiring-market',
      templates: world.definition.templates,
      hiringPlans: Object.values(world.plans).flatMap((plan) => {
        const request = world.requests[plan.requestId]
        const intent = request === undefined ? undefined : world.intents[request.intentId]
        if (plan.status !== 'accepted' || request?.status !== 'open' || intent?.requesterEntityId !== actorId) return []
        if (isDeepStrictEqual(plan.pin, WORLD_HIRE_EXISTING_PIN))
          return [{ planId: plan.id, ...simulationWorldHireExistingPayloadSchema.parse(intent.payload) }]
        const reservation = world.reservations[intent.id]
        return isDeepStrictEqual(plan.pin, WORLD_GENERATE_AND_HIRE_PIN) && reservation?.status === 'candidate'
          ? [{ planId: plan.id, ...simulationWorldHirePayloadSchema.parse(intent.payload), personId: reservation.identities.entityId }] : []
      }), vacancies: [...market.vacancies.values()].filter(value => BigInt(value.validUntil) > BigInt(state.time)),
      applications: [...market.applications.values()].filter(value => value.candidateId === actorId
        || market.vacancies.get(value.vacancyId)?.employerId === actorId),
      offers: [...market.offers.values()].filter(value => value.candidateId === actorId || value.employerId === actorId),
      drafts: [...market.drafts.values()].filter(value => value.source.actorId === actorId || value.reviewerId === actorId) })
  }
  personnelSubjects(intent: SimulationWorldIntent): readonly SimulationEntityId[] {
    const command = simulationHiringMarketCommandSchema.parse(intent.payload)
    return command.kind === 'offer' ? [command.candidateId] : []
  }
  admitRequest(state: SimulationSnapshot, actorId: SimulationEntityId, request: SimulationWorldDomainRequest) {
    if (request.expectedTime !== null || request.evidence.length !== 0) deny('Market commands use the current decision boundary')
    const command = simulationHiringMarketCommandSchema.parse(request.payload)
    projectHiringMarket(state, actorId, command)
    return { scopeEntityId: command.organizationEntityId, targetEntityId: command.positionEntityId,
      description: `${command.kind}: ${command.id}`, payload: z.json().parse(command) }
  }
  admitManagementRequest(state: SimulationSnapshot, request: SimulationWorldDomainRequest, source: SimulationWorldAuthenticatedUserSource) {
    if (request.expectedTime !== null || request.evidence.length !== 0) deny('Persona review uses the current Native boundary')
    const command = simulationHiringMarketCommandSchema.parse(request.payload)
    projectHiringMarket(state, null, command, source)
    return { scopeEntityId: command.organizationEntityId, targetEntityId: command.positionEntityId,
      description: `${command.kind}: ${command.id}`, payload: z.json().parse(command) }
  }
  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent): SimulationWorldJsonValue {
    return z.json().parse({ marketCommand: intent.payload,
      proposed: projectHiringMarket(state, actor(intent), simulationHiringMarketCommandSchema.parse(intent.payload), userSource(intent)) })
  }
  validatePlan(state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution): void {
    if (resolution.kind === 'reject') return
    if (!isDeepStrictEqual(resolution.payload, intent.payload)) deny('Market approval cannot change the original actor decision')
    projectHiringMarket(state, actor(intent), simulationHiringMarketCommandSchema.parse(intent.payload), userSource(intent))
  }
  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const command = simulationHiringMarketCommandSchema.parse(intent.payload)
    return simulationWorldReadSetSchema.parse([command.organizationEntityId, command.positionEntityId].map(id => ({
      kind: 'entity', id, revision: state.entities[id]?.revision })))
  }
  reduceMutation(state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan, payload: SimulationWorldJsonValue) {
    if (plan.proposal.resolution.kind !== 'apply' || !isDeepStrictEqual(payload, intent.payload)
      || !isDeepStrictEqual(payload, plan.proposal.resolution.payload)) deny('Market commit cannot replace its original decision')
    return { changes: [], resultPayload: z.json().parse(projectHiringMarket(state, actor(intent),
      simulationHiringMarketCommandSchema.parse(payload), userSource(intent))) }
  }
}
