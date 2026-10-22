import { z } from 'zod'
import { assertReviewRoute, governanceRouteProof } from './world-governance.ts'
import { SimulationWorldError } from '@clocky/clocky-simulation'
/** Pure institution approval and closed effects; Native appends versions, closures, results and announcement duties atomically. */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  projectNormImpact, existingNormObligations, SimulationGovernanceError, SimulationNormError,
  normState, effectiveNorms, projectNorms, simulationNormEffectSchema, currentWorldAssignments,
  simulationNormVersionSchema, simulationNormClosureSchema, simulationNormAnnouncementSchema,
  simulationNormAnnouncementMaterialSchema, simulationNormEnactRequestSchema, simulationNormRevokeRequestSchema,
  simulationNormMutationSourceSchema, currentWorldOperationGrants,
  WORLD_NORM_SCHEMA_REF, WORLD_NORM_ENACT_PIN, WORLD_NORM_REVOKE_PIN,
  WORLD_NORM_ENACT_DEFINITION, WORLD_NORM_REVOKE_DEFINITION, simulationWorldReadSetSchema, parseSimTime,
} from '@clocky/clocky-simulation'
import type {
  SimulationSnapshot, SimulationEntityId, SimulationWorldDomainRequest, SimulationWorldIntent, SimulationWorldPlan,
  SimulationWorldBusinessResolution, SimulationWorldJsonValue, NativeWorldDomain, SimulationNormState, SimulationNormVersion,
  SimulationNormEnactRequest, SimulationNormRevokeRequest, SimulationNormEffect, SimulationNormMutationSource,
  SimulationNormAnnouncement, WorldRequestId,
  SimulationGovernanceProposal, SimulationGovernanceResolution, SimulationNormProjection,
} from '@clocky/clocky-simulation'

import { assertInitialNormSource } from './world-norm-bootstrap.ts'

export { effectiveNorms, projectNorms, existingNormObligations }

function routeSources(state: SimulationSnapshot, route: SimulationGovernanceProposal['reviewRoute']): number[] {
  if (route === undefined) return []
  const governance = world(state).governance
  const definition = governance.routes?.[route.id]
  if (definition === undefined || definition.hash !== route.definitionHash)
    throw new SimulationNormError('SIM_NORM_SOURCE', 'Institution lost its original review route')
  return [definition.sequence, ...route.steps.flatMap((step) => {
    const proposal = governance.proposals[step.proposalId]
    const resolution = step.resolutionId === null ? undefined : governance.resolutions[step.resolutionId]
    if (proposal === undefined || resolution !== undefined && resolution.hash !== step.resolutionHash)
      throw new SimulationNormError('SIM_NORM_SOURCE', 'Institution lost its original review step')
    return [proposal.sequence, ...resolution === undefined ? [] : [resolution.sequence]]
  })]
}

/**
 * Identify one original publication without inventing a governance mutation for authored institutions.
 * @param version - Immutable governance- or scenario-origin version.
 * @returns exact deterministic announcement identity retained by Native.
 */
export function normAnnouncementIdentity(version: SimulationNormVersion): string {
  return version.origin === 'governance' ? `norm-announcement:${version.source.mutationId}`
    : `norm-announcement:scenario:${version.source.definitionHash}:${version.source.bootstrapSequence}:${version.id}`
}
function announcementOrigin(version: SimulationNormVersion) {
  return version.origin === 'governance' ? { origin: 'governance' as const, mutationId: version.source.mutationId }
    : { origin: 'scenario' as const, source: { definitionHash: version.source.definitionHash,
      bootstrapSequence: version.source.bootstrapSequence } }
}
function announcementMaterial(version: SimulationNormVersion) {
  return simulationNormAnnouncementMaterialSchema.parse({ kind: 'norm-announcement',
    norm: { id: version.id, version: version.version }, status: version.status, scope: version.scope, body: version.body,
    bodyHash: version.bodyHash, enforcement: version.enforcement,
    ...version.origin === 'governance' ? { origin: 'governance', proposal: version.proposal, resolution: version.resolution,
      ...version.reviewRoute === undefined ? {} : { reviewRoute: version.reviewRoute } }
      : { origin: 'scenario', source: { definitionHash: version.source.definitionHash,
        bootstrapSequence: version.source.bootstrapSequence } },
    effectiveFrom: version.effectiveFrom, effectiveUntil: version.effectiveUntil, availableAt: version.availableAt })
}

function world(state: SimulationSnapshot) {
  if (state.world === undefined) throw new SimulationNormError('SIM_NORM_INTEGRITY', 'Norm operation has no original World')
  return state.world
}
function digest(value: string): string { return `sha256:${createHash('sha256').update(value).digest('hex')}` }
function lookup<T>(values: Readonly<Record<string, T>>, id: string): T | undefined {
  return Object.hasOwn(values, id) ? values[id] : undefined
}
function originalProposal(state: SimulationSnapshot, input: SimulationNormEnactRequest | SimulationNormRevokeRequest) {
  const owned = world(state), proposal = lookup(owned.governance.proposals, input.proposal.id)
  const resolution = lookup(owned.governance.resolutions, input.resolution.id)
  if (proposal === undefined || resolution === undefined || resolution.outcome !== 'passed'
    || proposal.target.kind !== 'norm' || !isDeepStrictEqual(proposal.target.norm, input.norm)
    || proposal.revision !== input.proposal.revision || proposal.scopeId !== input.scope
    || proposal.body !== input.body || proposal.bodyHash !== input.proposal.bodyHash || proposal.bodyHash !== digest(input.body)
    || resolution.hash !== input.resolution.hash || resolution.proposalId !== proposal.id
    || resolution.proposalRevision !== proposal.revision || resolution.bodyHash !== proposal.bodyHash
    || proposal.sequence > state.revision || resolution.sequence > state.revision) {
    throw new SimulationNormError('SIM_NORM_GOVERNANCE', 'Norm requires its exact passed resolution, frozen target, body hash and scope')
  }
  const owner = Object.values(owned.governance.routes ?? {}).find(route => route.steps.some(step => step.proposalId === proposal.id))
  const reviewRoute = input.reviewRoute ?? proposal.reviewRoute
  if (owner !== undefined && (reviewRoute === undefined || reviewRoute.id !== owner.id || reviewRoute.definitionHash !== owner.hash))
    throw new SimulationNormError('SIM_NORM_GOVERNANCE', 'A route-bound proposal cannot publish without its original complete route proof')
  if (reviewRoute !== undefined) assertReviewRoute(state, { ...proposal, reviewRoute })
  return { proposal, resolution, ...reviewRoute === undefined ? {} : { reviewRoute } }

}

/** Inspect the exact approved publication fields without publishing a fact or changing an existing obligation.
 * @param state - Current Native owner projection.
 * @param raw - Original complete enactment request.
 * @param exclude - Its original enacting case, if already accepted.
 * @returns complete future calendar and obligation coverage from the shared owner query.
 */
export function previewNormImpact(state: SimulationSnapshot, raw: SimulationNormEnactRequest,
  exclude?: WorldRequestId): import('@clocky/clocky-simulation').SimulationNormImpact {
  const input = simulationNormEnactRequestSchema.parse(raw)
  return projectNormImpact(state, { normId: input.norm.id, scope: input.scope, effectiveFrom: input.effectiveFrom,
    effectiveUntil: input.effectiveUntil, enforcement: input.enforcement, impact: input.impact }, exclude)
}

/**
 * Verify complete enacting semantics without publishing or migrating any old responsibility.
 * @param state - Original authoritative projection at request, plan or mutation admission.
 * @param input - Strict complete original enact or revoke input.
 * @param kind - Closed requested institution effect.
 * @param exclude - Original enacting request, if already accepted.
 * @returns exact prior version and approved governance evidence; invalid or unsupported transitions throw before append.
 */
export function validateNormRequest(state: SimulationSnapshot, input: SimulationNormEnactRequest | SimulationNormRevokeRequest,
  kind: SimulationNormEffect['kind'], exclude?: WorldRequestId): {
  input: SimulationNormEnactRequest | SimulationNormRevokeRequest
  proposal: SimulationGovernanceProposal
  resolution: SimulationGovernanceResolution
  reviewRoute?: SimulationGovernanceProposal['reviewRoute']
  previous: SimulationNormVersion | undefined
} {
  const parsed = kind === 'norm/enact' ? simulationNormEnactRequestSchema.parse(input) : simulationNormRevokeRequestSchema.parse(input)
  const owned = normState(state), approved = originalProposal(state, parsed)
  const history = Object.hasOwn(owned.versions, parsed.norm.id) ? owned.versions[parsed.norm.id] : undefined
  const previous = history?.at(-1)
  if (parsed.norm.version !== String(BigInt(previous?.version ?? '0') + BigInt(1))
    || (previous === undefined ? parsed.prior !== null : !isDeepStrictEqual(parsed.prior,
      { id: previous.id, version: previous.version })) || previous !== undefined && previous.scope !== parsed.scope
    || kind === 'norm/revoke' && (previous === undefined || previous.status !== 'enacted')) {
    throw new SimulationNormError('SIM_NORM_VERSION', 'Norm operation must identify its exact current predecessor and adjacent target version')
  }
  if (!Object.hasOwn(state.entities, parsed.scope) || !Object.hasOwn(state.entities, approved.proposal.committeeId)
    || parsed.audience.kind === 'actors' && parsed.audience.entityIds.some(id => !Object.hasOwn(state.entities, id))) {
    throw new SimulationNormError('SIM_NORM_SCOPE', 'Norm scope, subject and audience require existing identities')
  }
  for (const time of [parsed.effectiveFrom, parsed.effectiveUntil, parsed.availableAt]) {
    if (time !== null) parseSimTime(time, state.spec.maxTime)
  }
  if (BigInt(parsed.effectiveFrom) < BigInt(state.time) || BigInt(parsed.availableAt) < BigInt(state.time)) {
    throw new SimulationNormError('SIM_NORM_TIME', 'Norm publication cannot retroactively rewrite effective or available history')
  }
  const enforcement = kind === 'norm/enact' ? simulationNormEnactRequestSchema.parse(parsed).enforcement : undefined
  if (enforcement?.kind === 'validated') {
    const params = enforcement.params, configured = world(state).definition
    if (params.committeeId !== approved.proposal.committeeId || configured.organizationEntityId !== parsed.scope
      || params.positionIds.some(id => !configured.positions.some(value => value.entityId === id)
        || state.entities[id]?.phase !== 'active' || state.entities[id].cognition !== 'none')) {
      throw new SimulationNormError('SIM_NORM_POLICY', 'Hiring policy requires the approved committee and owned declared position allowlist')
    }
  }
  if (parsed.impact === 'migrate-existing') {
    const obligations = existingNormObligations(state, parsed.scope, exclude)
    if (obligations.length) throw new SimulationNormError('SIM_NORM_EXISTING_OBLIGATIONS',
      'Existing responsibilities require an unsupported explicit migration or compensation protocol', obligations)
  }
  return { input: parsed, previous, ...approved }
}

/**
 * Freeze actual authorized agents and approved document material as a durable announcement responsibility.
 * @param state - Canonical entities and memberships at mutation acceptance.
 * @param version - Complete exact original approved institution publication.
 * @returns stable audience-frozen responsibility; no delivery or understanding is asserted.
 */
export function deriveNormAnnouncement(state: SimulationSnapshot, version: SimulationNormVersion): SimulationNormAnnouncement {
  if (state.teamReservation?.confirmed !== true) {
    throw new SimulationNormError('SIM_NORM_SOURCE', 'Norm announcement requires its confirmed canonical Team')
  }
  const recipients = Object.values(state.entities).filter((entity) => {
    if (entity.phase !== 'active' || entity.cognition !== 'agent' || entity.readiness !== 'ready'
      || entity.binding === undefined || entity.binding.teamId !== state.teamReservation?.teamId) return false
    switch (version.audience.kind) {
      case 'public': return true
      case 'actors': return version.audience.entityIds.includes(entity.id)
      case 'scope-members': return currentWorldAssignments(state, entity.id, version.scope).length !== 0
      default: return assertNever(version.audience)
    }
  }).map(value => value.id).sort()
  const norm = { id: version.id, version: version.version }
  return simulationNormAnnouncementSchema.parse({ id: normAnnouncementIdentity(version), norm, ...announcementOrigin(version),
    scope: version.scope, availableAt: version.availableAt, effectiveFrom: version.effectiveFrom, bodyHash: version.bodyHash,
    recipients, material: announcementMaterial(version), sequence: version.sequence })
}

/**
 * Fold one closed original institution effect; the Native mutation owner commits the returned tables with its result and wakes.
 * @param state - Authoritative prefix before this mutation.
 * @param source - Exact original request, apply plan and deterministic mutation identity.
 * @param proposed - Closed strictly parsed enact/revoke effect derived by its installed implementation.
 * @param sequence - Original next journal position, shared with mutation and result.
 * @param recordedAt - Native-derived original recording clock retained in the mutation, never Date.now during replay.
 * @returns complete new Norm tables; old originals, tasks, commitments and effects are untouched.
 */
export function applyNormEffect(state: SimulationSnapshot, source: SimulationNormMutationSource, proposed: SimulationNormEffect,
  sequence: number, recordedAt: number): SimulationNormState {
  const effect = simulationNormEffectSchema.parse(proposed), originalSource = simulationNormMutationSourceSchema.parse(source)
  const owned = world(state), request = owned.requests[originalSource.requestId], plan = owned.plans[originalSource.planId]
  const intent = request === undefined ? undefined : owned.intents[request.intentId]
  const expectedPin = effect.kind === 'norm/enact' ? WORLD_NORM_ENACT_PIN : WORLD_NORM_REVOKE_PIN
  if (sequence !== state.revision + 1 || !Number.isSafeInteger(recordedAt) || recordedAt < 0
    || request === undefined || plan === undefined || intent === undefined || request.status !== 'open'
    || request.plans.at(-1) !== plan.id || plan.requestId !== request.id || plan.status !== 'accepted'
    || plan.proposal.resolution.kind !== 'apply' || originalSource.mutationId !== `world-mutation:${plan.id}`
    || !isDeepStrictEqual(request.pin, expectedPin) || !isDeepStrictEqual(plan.pin, expectedPin)
    || !isDeepStrictEqual(intent.pin, expectedPin) || !isDeepStrictEqual(intent.payload, effect.request)
    || intent.scopeEntityId !== effect.request.scope || !isDeepStrictEqual(request.proposal.payload, effect.request)
    || !isDeepStrictEqual(plan.proposal.resolution.payload, effect.request)) {
    throw new SimulationNormError('SIM_NORM_SOURCE', 'Norm effect requires its exact original installed request, apply plan and mutation')
  }
  const { input, previous, proposal, resolution, reviewRoute } = validateNormRequest(state, effect.request, effect.kind, request.id)
  const norms = normState(state)
  if (Object.values(norms.versions).flat().some(value => value.origin === 'governance' && value.resolution.id === resolution.id)) {
    throw new SimulationNormError('SIM_NORM_GOVERNANCE', 'An original passed resolution can enact or revoke only once')
  }
  const references = [...new Set([proposal.sequence, resolution.sequence, request.sequence, plan.sequence,
    ...routeSources(state, reviewRoute), ...previous === undefined ? [] : [previous.sequence]])].sort((a, b) => a - b)
    .map(value => ({ kind: 'run-event' as const, runId: state.spec.runId, sequence: value }))
  const enforcement = effect.kind === 'norm/enact'
    ? simulationNormEnactRequestSchema.parse(input).enforcement : previous?.enforcement
  if (enforcement === undefined) throw new SimulationNormError('SIM_NORM_VERSION', 'Revocation lost its original enforcement version')
  const version = simulationNormVersionSchema.parse({ ...input.norm, schemaRef: WORLD_NORM_SCHEMA_REF, origin: 'governance',
    subject: proposal.committeeId, scope: input.scope, body: proposal.body, bodyHash: proposal.bodyHash,
    proposal: input.proposal, resolution: input.resolution, ...reviewRoute === undefined ? {} : { reviewRoute }, status: effect.kind === 'norm/enact' ? 'enacted' : 'revoked',
    enforcement, supersedes: input.prior, effectiveFrom: input.effectiveFrom, effectiveUntil: input.effectiveUntil,
    availableAt: input.availableAt, audience: input.audience, source: { ...originalSource, references }, recordedAt, sequence })
  const closure = previous === undefined ? [] : [simulationNormClosureSchema.parse({
    id: `norm-closure:${originalSource.mutationId}`, norm: { id: previous.id, version: previous.version },
    supersededBy: input.norm, at: input.effectiveFrom, source: originalSource, recordedAt, sequence })]
  const history = Object.hasOwn(norms.versions, version.id) ? norms.versions[version.id] ?? [] : []
  const announcement = deriveNormAnnouncement(state, version)
  const next: SimulationNormState = { versions: { ...norms.versions, [version.id]: [...history, version] },
    closures: [...norms.closures, ...closure], announcements: { ...norms.announcements, [announcement.id]: announcement } }
  if (Buffer.byteLength(JSON.stringify(next), 'utf8') > state.spec.maxKnowledgeBytes) {
    throw new SimulationNormError('SIM_NORM_LIMIT', 'Complete Norm history and announcement responsibilities exceed the frozen byte allowance')
  }
  return next
}

/**
 * Project exact known document material and its complete causal Native references for context-view recording.
 * @param state - Authoritative current history.
 * @param viewer - Actual decision owner; no director privilege is assumed.
 * @param time - Original decision time.
 * @param cursor - Original decision snapshot revision.
 * @returns exact JSON material plus distinct run-event references; publication does not assert consumption.
 */
export function normContextMaterial(state: SimulationSnapshot, viewer: SimulationEntityId,
  time: import('@clocky/clocky-simulation').SimTime, cursor: number): {
  material: SimulationNormProjection
  sources: { kind: 'run-event'; runId: SimulationSnapshot['spec']['runId']; sequence: number }[]
} {
  const projection = projectNorms(state, { viewer, time, cursor, limit: state.spec.maxKnowledgePerQuery })
  const norms = normState(state), sequences = new Set<number>()
  for (const { norm } of projection.items) {
    sequences.add(norm.sequence)
    for (const reference of norm.source.references) sequences.add(reference.sequence)
    for (const closure of norms.closures) if (closure.norm.id === norm.id && closure.norm.version === norm.version
      && closure.sequence <= cursor) sequences.add(closure.sequence)
  }
  return { material: projection, sources: [...sequences].sort((a, b) => a - b)
    .map(sequence => ({ kind: 'run-event' as const, runId: state.spec.runId, sequence })) }
}

/**
 * Verify complete immutable institution relationships without reapplying current permissions to historical commits.
 * @param state - Fully replayed Native projection with original requests, plans, mutations and governance records.
 * @returns nothing for a complete history; missing or rewritten source, closure or announcement records reject.
 */
export function assertNormProjection(state: SimulationSnapshot): void {
  if (state.world === undefined) return
  const owned = normState(state), sourceWorld = world(state)
  const expectedClosures = new Map<string, {
    prior: SimulationNormVersion
    next: Extract<SimulationNormVersion, { origin: 'governance' }>
  }>()
  const usedResolutions = new Set<string>(), announcements = new Set<string>()
  for (const [id, history] of Object.entries(owned.versions)) {
    let previous: SimulationNormVersion | undefined
    for (const [index, version] of history.entries()) {
      if (version.id !== id || version.version !== String(index + 1) || version.sequence > state.revision
        || (previous === undefined ? version.origin === 'governance' ? version.sequence <= sourceWorld.sequence
          : version.sequence !== sourceWorld.sequence : version.sequence <= previous.sequence) || version.scope !== history[0]?.scope
        || (previous === undefined ? version.supersedes !== null : !isDeepStrictEqual(version.supersedes,
          { id: previous.id, version: previous.version })) || version.bodyHash !== digest(version.body)) {
        throw new SimulationNormError('SIM_NORM_INTEGRITY', 'Norm history lost its original contiguous version, interval or body')
      }
      if (version.origin === 'governance') {
        const request = lookup(sourceWorld.requests, version.source.requestId), plan = lookup(sourceWorld.plans, version.source.planId)
        const intent = request === undefined ? undefined : sourceWorld.intents[request.intentId]
        const mutation = lookup(sourceWorld.mutations, version.source.mutationId)
        const result = Object.values(sourceWorld.results).find(value => value.source.kind === 'plan'
          && value.source.planId === version.source.planId)
        const input = version.status === 'enacted' ? simulationNormEnactRequestSchema.parse(intent?.payload)
          : simulationNormRevokeRequestSchema.parse(intent?.payload)
        const approved = originalProposal(state, input)
        const references = [...new Set([approved.proposal.sequence, approved.resolution.sequence, request?.sequence, plan?.sequence,
          previous?.sequence, ...routeSources(state, approved.reviewRoute)]
          .filter((value): value is number => value !== undefined))].sort((a, b) => a - b)
          .map(sequence => ({ kind: 'run-event' as const, runId: state.spec.runId, sequence }))
        const expectedPin = version.status === 'enacted' ? WORLD_NORM_ENACT_PIN : WORLD_NORM_REVOKE_PIN
        if (request === undefined || plan === undefined || mutation === undefined || intent === undefined
          || !isDeepStrictEqual(request.pin, expectedPin) || !isDeepStrictEqual(plan.pin, expectedPin)
          || !isDeepStrictEqual(mutation.pin, expectedPin) || plan.requestId !== request.id
          || mutation.planId !== plan.id || mutation.requestId !== request.id || mutation.sequence !== version.sequence
          || mutation.recordedAt !== version.recordedAt || mutation.id !== `world-mutation:${plan.id}`
          || plan.proposal.resolution.kind !== 'apply' || !isDeepStrictEqual(plan.proposal.resolution.payload, input)
          || !isDeepStrictEqual(mutation.payload, input) || !isDeepStrictEqual(input.norm, { id: version.id, version: version.version })
          || request.status !== 'committed' || result?.outcome.kind !== 'committed' || result.sequence !== version.sequence
          || result.requestId !== request.id || result.intentId !== intent.id
          || !isDeepStrictEqual(result.payload, { norm: input.norm, status: version.status })
          || input.body !== version.body || input.scope !== version.scope || version.subject !== approved.proposal.committeeId
          || !isDeepStrictEqual(input.proposal, version.proposal) || !isDeepStrictEqual(input.resolution, version.resolution)
          || input.effectiveFrom !== version.effectiveFrom || input.effectiveUntil !== version.effectiveUntil
          || input.availableAt !== version.availableAt || !isDeepStrictEqual(input.audience, version.audience)
          || intent.scopeEntityId !== version.scope || !isDeepStrictEqual(request.proposal.payload, input)
          || !isDeepStrictEqual(version.reviewRoute, approved.reviewRoute)
          || !isDeepStrictEqual(version.source.references, references)
          || version.source.references.some(value => value.runId !== state.spec.runId || value.sequence >= version.sequence)
          || usedResolutions.has(version.resolution.id)) {
          throw new SimulationNormError('SIM_NORM_INTEGRITY', 'Norm history lost its original version, approved body or accepted mutation source')
        }
        usedResolutions.add(version.resolution.id)
        const enforcement = version.status === 'enacted' ? simulationNormEnactRequestSchema.parse(input).enforcement : previous?.enforcement
        if (!isDeepStrictEqual(enforcement, version.enforcement)) {
          throw new SimulationNormError('SIM_NORM_INTEGRITY', 'Norm history changed its original enforcement mapping')
        }
      } else assertInitialNormSource(state, version)
      if (previous !== undefined) {
        if (version.origin !== 'governance') throw new SimulationNormError('SIM_NORM_INTEGRITY', 'Only governance may close an existing institution')
        expectedClosures.set(`norm-closure:${version.source.mutationId}`, { prior: previous, next: version })
      }
      const announcementId = normAnnouncementIdentity(version)
      const announcement = owned.announcements[announcementId as import('@clocky/clocky-simulation').WorldNormAnnouncementId]
      if (announcement === undefined) throw new SimulationNormError('SIM_NORM_INTEGRITY', 'Norm history lost its original announcement')
      const { recipients, ...publication } = announcement
      const expectedPublication = { id: announcementId, norm: { id: version.id, version: version.version },
        ...announcementOrigin(version), sequence: version.sequence, scope: version.scope, bodyHash: version.bodyHash,
        availableAt: version.availableAt, effectiveFrom: version.effectiveFrom, material: announcementMaterial(version) }
      if (!isDeepStrictEqual(publication, expectedPublication) || recipients.some(recipient => !Object.hasOwn(state.entities, recipient))) {
        throw new SimulationNormError('SIM_NORM_INTEGRITY', 'Norm history changed its original trusted announcement provenance or material')
      }
      announcements.add(announcement.id)
      previous = version
    }
  }
  if (announcements.size !== Object.keys(owned.announcements).length || expectedClosures.size !== owned.closures.length) {
    throw new SimulationNormError('SIM_NORM_INTEGRITY', 'Norm history includes an unrelated announcement or interval closure')
  }
  for (const closure of owned.closures) {
    const expected = expectedClosures.get(closure.id)
    if (expected === undefined || !isDeepStrictEqual(closure.norm, { id: expected.prior.id, version: expected.prior.version })
      || !isDeepStrictEqual(closure.supersededBy, { id: expected.next.id, version: expected.next.version })
      || closure.at !== expected.next.effectiveFrom || closure.sequence !== expected.next.sequence
      || closure.recordedAt !== expected.next.recordedAt || !isDeepStrictEqual(closure.source,
      { requestId: expected.next.source.requestId, planId: expected.next.source.planId,
        mutationId: expected.next.source.mutationId })) {
      throw new SimulationNormError('SIM_NORM_INTEGRITY', 'Norm closure no longer identifies its original predecessor and successor')
    }
    expectedClosures.delete(closure.id)
  }
  if (Buffer.byteLength(JSON.stringify(owned), 'utf8') > state.spec.maxKnowledgeBytes) {
    throw new SimulationNormError('SIM_NORM_LIMIT', 'Complete retained Norm history exceeds its original byte allowance')
  }
}

function normOpportunities(state: SimulationSnapshot, actor: SimulationEntityId, revoke: boolean) {
  const owned = world(state), norms = normState(state), pin = revoke ? WORLD_NORM_REVOKE_PIN : WORLD_NORM_ENACT_PIN
  const opportunities = Object.values(owned.governance.resolutions).flatMap((resolution) => {
    const proposal = owned.governance.proposals[resolution.proposalId]
    if (resolution.outcome !== 'passed' || proposal?.target.kind !== 'norm'
      || resolution.sequence > state.revision || proposal.sequence > state.revision
      || Object.values(norms.versions).flat().some(value => value.origin === 'governance' && value.resolution.id === resolution.id)) return []
    const allowed = currentWorldOperationGrants(state, actor, pin, proposal.scopeId, proposal.committeeId).length > 0
    if (!allowed) return []
    const previous = norms.versions[proposal.target.norm.id]?.at(-1)
    if (proposal.target.norm.version !== String(BigInt(previous?.version ?? '0') + BigInt(1))
      || previous !== undefined && previous.scope !== proposal.scopeId || revoke && previous?.status !== 'enacted') return []
    const routeOwner = Object.values(world(state).governance.routes ?? {})
      .find(route => route.steps.some(step => step.proposalId === proposal.id))
    const reviewRoute = routeOwner === undefined ? proposal.reviewRoute : governanceRouteProof(state, routeOwner)
    if (reviewRoute !== undefined) {
      try { assertReviewRoute(state, { ...proposal, reviewRoute }) }
      catch (cause) {
        if (cause instanceof SimulationGovernanceError && cause.code === 'SIM_GOVERNANCE_PENDING') return []
        throw cause
      }
    }
    return [{ ...reviewRoute === undefined ? {} : { reviewRoute }, norm: proposal.target.norm,
      prior: previous === undefined ? null : { id: previous.id, version: previous.version },
      proposal: { id: proposal.id, revision: proposal.revision, bodyHash: proposal.bodyHash },
      resolution: { id: resolution.id, hash: resolution.hash }, scope: proposal.scopeId, body: proposal.body,
      committeeId: proposal.committeeId, currentTime: state.time,
      positionIds: owned.definition.organizationEntityId === proposal.scopeId
        ? owned.definition.positions.map(value => value.entityId) : [] }]
  })
  return z.json().parse({ kind: revoke ? 'norm-revoke-opportunities' : 'norm-enact-opportunities', opportunities })
}

/** Installed pure enact operation; schema validation and original governance checks precede every core effect. */
export class NormEnactNativeWorldDomain implements NativeWorldDomain {
  // This operation addresses its requester and non-person scope/target; it accepts no additional existing person.
  personnelSubjects(_intent: SimulationWorldIntent): readonly SimulationEntityId[] { return [] }

  readonly definition = WORLD_NORM_ENACT_DEFINITION
  readonly ref = WORLD_NORM_ENACT_PIN.implementationRef
  readonly generation = WORLD_NORM_ENACT_PIN.generation

  goalContext(state: SimulationSnapshot, actorId: SimulationEntityId): SimulationWorldJsonValue {
    return normOpportunities(state, actorId, false)
  }

  admitRequest(state: SimulationSnapshot, _actorId: SimulationEntityId, request: SimulationWorldDomainRequest) {
    const input = simulationNormEnactRequestSchema.parse(request.payload)
    if (request.expectedTime !== null && request.expectedTime !== input.effectiveFrom)
      throw new SimulationNormError('SIM_NORM_TIME', 'Requested institution time differs from its explicit effective boundary')
    const { proposal } = validateNormRequest(state, input, 'norm/enact')
    return { scopeEntityId: input.scope, targetEntityId: proposal.committeeId,
      description: `Enact approved institution ${input.norm.id}/${input.norm.version}.`, payload: z.json().parse(input) }
  }
  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent): SimulationWorldJsonValue {
    const input = simulationNormEnactRequestSchema.parse(intent.payload)
    validateNormRequest(state, input, 'norm/enact', intent.requestId)
    return z.json().parse({ impact: previewNormImpact(state, input, intent.requestId), enactment: input, instruction: 'Preserve the exact approved document, policy, audience and dates. Approval alone has no effect.' })
  }
  validatePlan(state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution): void {
    if (resolution.kind !== 'apply') return
    const input = simulationNormEnactRequestSchema.parse(resolution.payload)
    if (!isDeepStrictEqual(input, intent.payload)) throw new SimulationNormError('SIM_NORM_SOURCE', 'Plan changed the original enactment input')
    validateNormRequest(state, input, 'norm/enact', intent.requestId)
  }
  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const input = simulationNormEnactRequestSchema.parse(intent.payload)
    const { proposal, resolution } = validateNormRequest(state, input, 'norm/enact', intent.requestId)
    return simulationWorldReadSetSchema.parse([{ kind: 'proposal', id: proposal.id, hash: proposal.bodyHash },
      { kind: 'resolution', id: resolution.id, hash: resolution.hash },
      ...input.prior === null ? [] : [{ kind: 'norm', id: input.prior.id, version: input.prior.version }]])
  }
  reduceMutation(state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan, payload: SimulationWorldJsonValue) {
    if (plan.proposal.resolution.kind === 'awaiting-evidence')
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Evidence questions cannot execute a norm mutation')
    this.validatePlan(state, intent, plan.proposal.resolution)
    const input = simulationNormEnactRequestSchema.parse(payload)
    if (!isDeepStrictEqual(input, intent.payload)) throw new SimulationNormError('SIM_NORM_SOURCE', 'Mutation changed the original enactment input')
    return { changes: [], normEffects: [{ kind: 'norm/enact' as const, request: input }],
      resultPayload: { norm: input.norm, status: 'enacted' as const } }
  }
}

/** Installed pure revocation operation; it appends a new approved version instead of deleting an institution. */
export class NormRevokeNativeWorldDomain implements NativeWorldDomain {
  // This operation addresses its requester and non-person scope/target; it accepts no additional existing person.
  personnelSubjects(_intent: SimulationWorldIntent): readonly SimulationEntityId[] { return [] }

  readonly definition = WORLD_NORM_REVOKE_DEFINITION
  readonly ref = WORLD_NORM_REVOKE_PIN.implementationRef
  readonly generation = WORLD_NORM_REVOKE_PIN.generation

  goalContext(state: SimulationSnapshot, actorId: SimulationEntityId): SimulationWorldJsonValue {
    return normOpportunities(state, actorId, true)
  }

  admitRequest(state: SimulationSnapshot, _actorId: SimulationEntityId, request: SimulationWorldDomainRequest) {
    const input = simulationNormRevokeRequestSchema.parse(request.payload)
    if (request.expectedTime !== null && request.expectedTime !== input.effectiveFrom)
      throw new SimulationNormError('SIM_NORM_TIME', 'Requested revocation time differs from its explicit effective boundary')
    const { proposal } = validateNormRequest(state, input, 'norm/revoke')
    return { scopeEntityId: input.scope, targetEntityId: proposal.committeeId,
      description: `Revoke approved institution ${input.norm.id}/${input.norm.version}.`, payload: z.json().parse(input) }
  }
  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent): SimulationWorldJsonValue {
    const input = simulationNormRevokeRequestSchema.parse(intent.payload)
    validateNormRequest(state, input, 'norm/revoke', intent.requestId)
    return z.json().parse({ revocation: input, instruction: 'Preserve the original repeal document and predecessor. Existing commitments remain unchanged.' })
  }
  validatePlan(state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution): void {
    if (resolution.kind !== 'apply') return
    const input = simulationNormRevokeRequestSchema.parse(resolution.payload)
    if (!isDeepStrictEqual(input, intent.payload)) throw new SimulationNormError('SIM_NORM_SOURCE', 'Plan changed the original revocation input')
    validateNormRequest(state, input, 'norm/revoke', intent.requestId)
  }
  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const input = simulationNormRevokeRequestSchema.parse(intent.payload)
    const { proposal, resolution } = validateNormRequest(state, input, 'norm/revoke', intent.requestId)
    return simulationWorldReadSetSchema.parse([{ kind: 'proposal', id: proposal.id, hash: proposal.bodyHash },
      { kind: 'resolution', id: resolution.id, hash: resolution.hash },
      ...input.prior === null ? [] : [{ kind: 'norm', id: input.prior.id, version: input.prior.version }]])
  }
  reduceMutation(state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan, payload: SimulationWorldJsonValue) {
    if (plan.proposal.resolution.kind === 'awaiting-evidence')
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Evidence questions cannot execute a norm mutation')
    this.validatePlan(state, intent, plan.proposal.resolution)
    const input = simulationNormRevokeRequestSchema.parse(payload)
    if (!isDeepStrictEqual(input, intent.payload)) throw new SimulationNormError('SIM_NORM_SOURCE', 'Mutation changed the original revocation input')
    return { changes: [], normEffects: [{ kind: 'norm/revoke' as const, request: input }],
      resultPayload: { norm: input.norm, status: 'revoked' as const } }
  }
}

function assertNever(value: never): never { throw new Error(`Unknown Norm audience: ${String(value)}`) }
