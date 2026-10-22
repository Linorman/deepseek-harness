/** Adversarial pure Norm folds; real Loader/committee/Channel integration is verified by the owning composition suite. */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { teamRootCreateInputSchema } from '@clocky/clocky-team/schema'
import {
  simulationRunSpecSchema, simulationEntityIdSchema, simulationEntityBindingSchema, simulationWorldDefinitionSchema,
  simulationGovernanceProposalSchema, simulationGovernanceResolutionSchema, simulationWorldRoleIntentSchema,
  simulationWorldResolveOperationSchema, simulationWorldRequestOperationSchema, simulationWorldDomainMutationSchema,
  simulationWorldResultSchema, simulationCommitmentIdSchema, simulationInteractionIdSchema, simulationOperationIdSchema,
  simulationInitialNormSchema, simulationFrozenCommitteePolicySchema, simulationNormBootstrapSourceSchema,
  simulationGovernanceProposalInputSchema, simulationRelationIdSchema, simulationChangeSchema,
} from '@clocky/clocky-simulation'
import { simulationNormEnactRequestSchema, simulationNormRevokeRequestSchema,
  simulationNormMutationSourceSchema, simulationNormReferenceSchema, projectNorms, effectiveNorms, SimulationNormError } from '@clocky/clocky-simulation'
import { WORLD_NORM_ENACT_PIN, WORLD_NORM_REVOKE_PIN } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationWorldPlan, SimulationNormState,
  SimulationNormEffect, SimulationCommitment } from '@clocky/clocky-simulation'
import { applyNormEffect, validateNormRequest, normContextMaterial, assertNormProjection,
  NormEnactNativeWorldDomain, NormRevokeNativeWorldDomain, previewNormImpact } from '../src/world-norms.ts'
import { prepareInitialNorm, foldInitialNorm, assertFrozenCommitteeProposal,
  assertFrozenCommitteeMembership, assertFrozenCommitteeInitialization, assertInitialNormSource } from '../src/world-norm-bootstrap.ts'
import { foldEntityChange } from '../src/entities.ts'
import { simulationWorldBootstrapBookSchema } from '@clocky/clocky-simulation/src/world-bootstrap.ts'

function digest(value: string) { return `sha256:${createHash('sha256').update(value).digest('hex')}` }
const entityId = (value: unknown) => simulationEntityIdSchema.parse(value)
function base(): SimulationSnapshot {
  const spec = simulationRunSpecSchema.parse({ runId: 'norms', tickUnit: 'minute', origin: '0', maxTime: '100',
    rulesVersion: '1', policyVersion: '1', relationRules: [], outboxMaxAttempts: 3, outboxRetryDelayMs: 10,
    maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000,
    maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 16, maxResidentActors: 4, maxTokensPerInterval: 1000000,
    tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100,
    maxPendingEvents: 100, maxPendingInteractions: 100, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32,
    maxQueuedDecisions: 100, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 4, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '1000' })
  const ids = ['publisher', 'reader', 'outsider', 'organization', 'committee', 'position']
  const entities = Object.fromEntries(ids.map((name, index) => [name, { id: entityId(name), kind: index < 3 ? 'person' : 'organization',
    cognition: index < 3 ? 'agent' as const : 'none' as const, phase: 'active' as const, readiness: 'ready' as const,
    revision: 1, profileRevision: 1, profile: {}, ...index >= 3 ? {} : { binding: simulationEntityBindingSchema.parse({
      teamId: 'canonical', participantId: name, sessionId: `session:${name}` }) } }]))
  return { spec, revision: 10, time: '0' as SimulationSnapshot['time'], phase: 'running', entities, relations: {},
    teamReservation: { teamId: entities['publisher']!.binding!.teamId, confirmed: true,
      creation: teamRootCreateInputSchema.parse({ goal: { objective: 'Institutions', budgets: {} }, budgets: {},
        rules: { simulationRunId: spec.runId, activationLifecycleOwner: 'norm-owner' } }) },
    nextDecisionSlot: '0' as SimulationSnapshot['nextDecisionSlot'], nextEventSlot: '0' as SimulationSnapshot['nextEventSlot'],
    decisions: {}, operations: {}, resources: {},
    resourceReservations: {}, grants: {}, interactions: {}, commitments: {}, scheduledEvents: {}, wakes: {},
    world: { executions: {}, external: { identities: {}, interactions: {}, representatives: {}, contacts: {}, adjudications: {}, events: {} }, personnel: { reservations: {}, fences: {}, generations: {}, operationGrants: [] }, definition: simulationWorldDefinitionSchema.parse({ positionRolePermissions: [], directorEntityId: 'publisher', organizationEntityId: 'organization',
      operations: [WORLD_NORM_ENACT_PIN, WORLD_NORM_REVOKE_PIN], operationGrants: [], authorizations: [],
      positions: [{ entityId: 'position', capacity: 1 }], templates: [{ id: 'person', version: '1', names: ['Lin'], skills: [],
        traits: [], goals: [], description: 'Person' }], policyVersion: '1',
      limits: { maxRequests: 10,
        maxBirthsPerInterval: 10, maxExternalExpansionsPerInterval: 10, maxPendingMutations: 1,
        maxRequestsPerActorPerInterval: 10,
        maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 4096, maxBytesPerPlan: 4096 } }),
    sequence: 1, channels: {}, intents: {}, requests: {}, plans: {}, results: {}, cancellations: {}, reservations: {}, mutations: {},
    facts: {}, evidence: { challenges: {}, revisions: {} }, governance: { proposals: {}, votes: {}, resolutions: {} },
    norms: { versions: {}, closures: [], announcements: {} } } }
}

function sourceFixture(state: SimulationSnapshot, version = '1', revoke = false,
  overrides: Record<string, unknown> = {}) {
  const body = revoke ? 'Repeal the original institution.' : 'Hiring requires the original committee approval.'
  const input = (revoke ? simulationNormRevokeRequestSchema : simulationNormEnactRequestSchema).parse({
    norm: { id: 'hiring-rule', version }, prior: version === '1' ? null : { id: 'hiring-rule', version: String(BigInt(version) - BigInt(1)) },
    proposal: { id: `proposal-${version}`, revision: 1, bodyHash: digest(body) },
    resolution: { id: `resolution-${version}`, hash: digest(`resolution-${version}`) }, scope: 'organization', body,
    effectiveFrom: state.time, effectiveUntil: null, availableAt: state.time, audience: { kind: 'public' }, impact: 'future-admissions',
    ...revoke ? {} : { enforcement: { kind: 'advisory' } }, ...overrides,
  })
  const binding = state.entities[entityId('publisher')]!.binding!
  const proposal = simulationGovernanceProposalSchema.parse({ id: input.proposal.id, revision: 1, body: input.body,
    bodyHash: input.proposal.bodyHash, committeeId: 'committee', scopeId: input.scope,
    target: { kind: 'norm', norm: input.norm }, policyRef: 'clocky.governance/1', rule: { kind: 'unanimity' }, quorum: 1,
    deadline: '50', proposer: 'publisher', time: '0', sequence: state.revision - 5,
    source: { decisionId: 'proposal-decision', operationId: 'proposal-operation', epoch: '1', binding,
      contextHash: 'a'.repeat(64), inputId: 'proposal-input' }, electorate: [{ entityId: 'publisher', binding,
      membership: { id: 'membership', revision: 1, validFrom: '0', validUntil: null } }] })
  const resolution = simulationGovernanceResolutionSchema.parse({ id: input.resolution.id, hash: input.resolution.hash,
    proposalId: proposal.id, proposalRevision: 1, bodyHash: proposal.bodyHash, outcome: 'passed', closure: 'all-voted',
    votes: [], counts: { yes: 1, no: 0, abstain: 0, missing: 0 }, wakeId: 'resolution-wake', time: state.time, sequence: state.revision - 3 })
  const pin = revoke ? WORLD_NORM_REVOKE_PIN : WORLD_NORM_ENACT_PIN
  const intent = simulationWorldRoleIntentSchema.parse({ id: `intent-${version}`, pin, businessKey: `enact-${version}`,
    requesterEntityId: 'publisher', scopeEntityId: 'organization', targetEntityId: proposal.committeeId,
    expectedTime: null, evidence: [], description: 'Enact original norm.',
    payload: input, sequence: state.revision - 2, requestId: `request-${version}` })
  const plan: SimulationWorldPlan = { id: `plan-${version}` as SimulationWorldPlan['id'], requestId: intent.requestId!,
    pin, operationId: `plan-operation-${version}` as NonNullable<SimulationWorldPlan['operationId']>, reads: [], baseRevision: state.revision,
    sequence: state.revision - 1, hash: digest(`plan-${version}`), status: 'accepted',
    proposal: simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve', requestId: intent.requestId,
      supersedes: null, resolution: { kind: 'apply', payload: input, rationale: 'Private-rationale-sentinel' } }) }
  const request = { id: intent.requestId!, intentId: intent.id, operationId: 'request-operation' as NonNullable<SimulationWorldPlan['operationId']>,
    notificationOperationId: 'request-notification' as NonNullable<SimulationWorldPlan['operationId']>, requesterEntityId: intent.requesterEntityId,
    proposal: simulationWorldRequestOperationSchema.parse({ kind: 'world/request', domain: pin.domain, operation: pin.operation,
      version: '1', businessKey: intent.businessKey, expectedTime: null, evidence: [], payload: input }), pin,
    source: { kind: 'decision' as const, decisionId: 'request-decision' as SimulationWorldPlan['proposal']['requestId'] &
      import('@clocky/clocky-simulation').SimulationDecisionId, epoch: '1' as import('@clocky/clocky-simulation').SimulationWriterEpoch, binding },
    description: intent.description, payloadHash: digest(JSON.stringify(input)), sequence: intent.sequence, plans: [plan.id], status: 'open' as const }
  const next: SimulationSnapshot = { ...state, world: { ...state.world!,
    governance: { ...state.world!.governance, proposals: { ...state.world!.governance.proposals, [proposal.id]: proposal },
      resolutions: { ...state.world!.governance.resolutions, [resolution.id]: resolution } },
    intents: { ...state.world!.intents, [intent.id]: intent }, requests: { ...state.world!.requests, [request.id]: request },
    plans: { ...state.world!.plans, [plan.id]: plan } } }
  const source = simulationNormMutationSourceSchema.parse({ requestId: request.id, planId: plan.id, mutationId: `world-mutation:${plan.id}` })
  const effect = { kind: revoke ? 'norm/revoke' : 'norm/enact', request: input } as SimulationNormEffect
  return { state: next, input, source, effect, intent, plan }
}

function committed(h: ReturnType<typeof sourceFixture>, recordedAt = 1000): SimulationSnapshot {
  const sequence = h.state.revision + 1, norms = applyNormEffect(h.state, h.source, h.effect, sequence, recordedAt)
  const mutation = simulationWorldDomainMutationSchema.parse({ kind: 'world/mutation', id: h.source.mutationId,
    requestId: h.source.requestId, planId: h.source.planId, pin: h.plan.pin, time: h.state.time, sequence, recordedAt, payload: h.input })
  const result = simulationWorldResultSchema.parse({ id: `world-result:${h.intent.id}`, requestId: h.source.requestId, intentId: h.intent.id,
    source: { kind: 'plan', planId: h.plan.id }, outcome: { kind: 'committed' },
    payload: { norm: h.input.norm, status: h.effect.kind === 'norm/enact' ? 'enacted' : 'revoked' }, time: h.state.time, sequence })
  return { ...h.state, revision: sequence, world: { ...h.state.world!, norms,
    mutations: { ...h.state.world!.mutations, [mutation.id]: mutation }, results: { ...h.state.world!.results, [result.id]: result },
    requests: { ...h.state.world!.requests, [h.source.requestId]: { ...h.state.world!.requests[h.source.requestId]!, status: 'committed' } } } }
}

function initialFixture(): SimulationSnapshot {
  const state = base(), publisher = state.entities[entityId('publisher')]!, position = state.entities[entityId('position')]!
  const committee = simulationFrozenCommitteePolicySchema.parse({ id: 'committee', name: 'Original committee',
    description: 'Frozen unanimous policy.', scopeId: 'organization', members: [{ id: 'membership', personId: publisher.id,
      validFrom: '0', validUntil: null }], rule: { kind: 'unanimity' }, quorum: 1 })
  const norm = simulationInitialNormSchema.parse({ id: 'hiring-rule', scopeId: 'organization', body: 'Every hire needs unanimous approval.',
    effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'public' }, enforcement: {
      kind: 'validated', policyRef: 'clocky.organization.hiring-approval/1', params: { committeeId: committee.id,
        positionIds: [position.id], maxHires: 1 } } })
  const relation = { id: committee.members[0]!.id, subject: publisher.id, object: committee.id, scope: committee.scopeId,
    relation: 'committee-member', revision: 1, validFrom: committee.members[0]!.validFrom, validUntil: null }
  const book = simulationWorldBootstrapBookSchema.parse({ request: { definitionHash: digest('original-scenario'),
    definition: state.world!.definition, actorIds: [publisher.id], data: { resources: [], facts: [], knowledge: [], norms: [norm],
      committeePolicies: [committee], externalIdentities: [], behavior: { initialGoals: [], calendars: [], directorEvents: [] } } },
  sequence: 2, status: 'retained', occurrences: [] })
  return { ...state, entities: { ...state.entities, [position.id]: { ...position, kind: 'position' } },
    relations: { [relation.id]: relation }, world: { ...state.world!, sequence: state.revision + 1 }, worldBootstrap: book }
}
function initialCommitted(state: SimulationSnapshot = initialFixture()): SimulationSnapshot {
  const book = state.worldBootstrap!, input = book.request.data.norms[0]!
  const source = simulationNormBootstrapSourceSchema.parse({ definitionHash: book.request.definitionHash,
    bootstrapSequence: book.sequence })
  const version = prepareInitialNorm(state, input, source, state.revision + 1, 1000)
  const norms = foldInitialNorm(state, version)
  return { ...state, revision: version.sequence, world: { ...state.world!, norms },
    worldBootstrap: { ...book, status: 'applied', appliedSequence: version.sequence } }
}

describe('original scenario institutions', () => {
  it('initializes future-only membership literally and admits real votes only at its effective half-open boundary', () => {
    const original = initialFixture(), book = original.worldBootstrap!, existing = book.request.data.committeePolicies[0]!
    const membership = { ...existing.members[0]!, validFrom: '10' as SimulationSnapshot['time'], validUntil: '20' as SimulationSnapshot['time'] }
    const committee = simulationFrozenCommitteePolicySchema.parse({ ...existing, rule: { kind: 'absolute-threshold', yes: 1 },
      members: [membership] })
    const input = { ...book.request.data.norms[0]!, effectiveFrom: '10' as SimulationSnapshot['time'] }
    const relation = Object.values(original.relations)[0]!
    const state = { ...original, relations: { [relation.id]: { ...relation,
      validFrom: membership.validFrom, validUntil: membership.validUntil } },
    worldBootstrap: { ...book, request: { ...book.request,
      data: { ...book.request.data, committeePolicies: [committee], norms: [input] } } } }
    expect(() => { assertFrozenCommitteeInitialization(state, committee) }).not.toThrow()
    const source = simulationNormBootstrapSourceSchema.parse({ definitionHash: book.request.definitionHash,
      bootstrapSequence: book.sequence })
    expect(prepareInitialNorm(state, input, source, 11, 1000)).toMatchObject({ origin: 'scenario', effectiveFrom: '10' })
    expect(() => { assertFrozenCommitteeMembership(state, committee) }).toThrow()
    expect(() => { assertFrozenCommitteeMembership({ ...state, time: '10' as SimulationSnapshot['time'] }, committee) }).not.toThrow()
    expect(() => { assertFrozenCommitteeMembership({ ...state, time: '20' as SimulationSnapshot['time'] }, committee) }).toThrow()
    const tooLate = { ...committee, members: [{ ...membership, validUntil: '101' as SimulationSnapshot['time'] }] }
    const unknownHorizon = { ...state, worldBootstrap: { ...state.worldBootstrap, request: { ...state.worldBootstrap.request,
      data: { ...state.worldBootstrap.request.data, committeePolicies: [tooLate] } } } }
    expect(() => { assertFrozenCommitteeInitialization(unknownHorizon, tooLate) }).toThrow()
  })
  it('validates every declared membership at initialization, including disjoint later intervals for the same actual person', () => {
    const original = initialFixture(), book = original.worldBootstrap!, existing = book.request.data.committeePolicies[0]!
    const first = { ...existing.members[0]!, validUntil: '5' as SimulationSnapshot['time'] }
    const later = { ...first, id: simulationRelationIdSchema.parse('later-membership'), validFrom: '5' as SimulationSnapshot['time'], validUntil: null }
    const committee = simulationFrozenCommitteePolicySchema.parse({ ...existing, members: [first, later] })
    const relation = Object.values(original.relations)[0]!
    const state = { ...original, relations: { [first.id]: { ...relation, validUntil: first.validUntil },
      [later.id]: { ...relation, id: later.id, validFrom: later.validFrom } }, worldBootstrap: { ...book,
      request: { ...book.request, data: { ...book.request.data, committeePolicies: [committee] } } } }
    expect(() => { assertFrozenCommitteeInitialization(state, committee) }).not.toThrow()
    expect(() => { assertFrozenCommitteeMembership(state, committee) }).not.toThrow()
    expect(() => { assertFrozenCommitteeMembership({ ...state, time: '5' as SimulationSnapshot['time'] }, committee) }).not.toThrow()
    expect(() => {
      assertFrozenCommitteeInitialization({ ...state, relations: { [first.id]: state.relations[first.id]! } }, committee)
    }).toThrow()
  })
  it('creates a genuine initial source and notification without manufacturing votes, proposals, resolutions or mutations', () => {
    const state = initialCommitted(), norm = Object.values(state.world!.norms.versions)[0]![0]!
    expect(norm).toMatchObject({ origin: 'scenario', version: '1', source: { definitionHash: digest('original-scenario'), bootstrapSequence: 2 } })
    expect(norm).not.toHaveProperty('proposal'); expect(norm).not.toHaveProperty('resolution')
    expect(norm.source).not.toHaveProperty('mutationId')
    expect(state.world!.governance).toEqual({ proposals: {}, votes: {}, resolutions: {} })
    expect(state.world!.mutations).toEqual({})
    const announcement = Object.values(state.world!.norms.announcements)[0]!
    expect(announcement.material).toMatchObject({ origin: 'scenario', source: { definitionHash: digest('original-scenario'), bootstrapSequence: 2 } })
    expect(announcement).not.toHaveProperty('mutationId')
    expect(() => { assertNormProjection(state) }).not.toThrow()
    expect(normContextMaterial(state, entityId('reader'), state.time, state.revision).sources)
      .toEqual([{ kind: 'run-event', runId: state.spec.runId, sequence: 2 }, { kind: 'run-event', runId: state.spec.runId, sequence: 11 }])
  })
  it('retains the authored predecessor and its exact source when real governance later revokes it', () => {
    const first = initialCommitted(), original = structuredClone(first.world!.norms.versions)
    const revoked = committed(sourceFixture({ ...first, revision: 20, time: '5' as SimulationSnapshot['time'] }, '2', true))
    expect(Object.values(revoked.world!.norms.versions)[0]![0]).toEqual(Object.values(original)[0]![0])
    expect(Object.values(revoked.world!.norms.versions)[0]![1]).toMatchObject({ origin: 'governance', status: 'revoked' })
    expect(revoked.world!.norms.closures[0]!.source).toMatchObject({ mutationId: 'world-mutation:plan-2' })
    expect(() => { assertNormProjection(revoked) }).not.toThrow()
    expect(projectNorms(revoked, { viewer: entityId('reader'), time: first.time, cursor: first.revision, limit: 10 })
      .items[0]?.norm).toMatchObject({ origin: 'scenario', source: { bootstrapSequence: 2 } })
  })
  it('rejects source substitution, undeclared bodies, duplicate folding and complete-output byte overflow', () => {
    const state = initialFixture(), book = state.worldBootstrap!, input = book.request.data.norms[0]!
    const source = simulationNormBootstrapSourceSchema.parse({ definitionHash: book.request.definitionHash,
      bootstrapSequence: book.sequence })
    expect(() => prepareInitialNorm(state, { ...input, body: 'Replacement' }, source, 11, 1000)).toThrow()
    expect(() => prepareInitialNorm(state, input, { ...source, definitionHash: digest('foreign') }, 11, 1000)).toThrow()
    expect(() => prepareInitialNorm(state, input, { ...source, bootstrapSequence: 3 }, 11, 1000)).toThrow()
    expect(() => prepareInitialNorm(state, input, source, 12, 1000)).toThrow()
    const version = prepareInitialNorm(state, input, source, 11, 1000)
    expect(() => foldInitialNorm(state, { ...version, bodyHash: digest('changed') })).toThrow()
    expect(() => foldInitialNorm({ ...state, spec: { ...state.spec, maxKnowledgeBytes: 10 } }, version)).toThrow()
    expect(() => foldInitialNorm(initialCommitted(), version)).toThrow()
    const final = initialCommitted(), corrupt = { ...final, worldBootstrap: { ...final.worldBootstrap!, sequence: 3 } }
    expect(() => { assertNormProjection(corrupt) }).toThrow()
  })
  it('rejects missing committee, foreign position, unknown audience and retroactive authored time', () => {
    const state = initialFixture(), book = state.worldBootstrap!, input = book.request.data.norms[0]!
    const source = simulationNormBootstrapSourceSchema.parse({ definitionHash: book.request.definitionHash,
      bootstrapSequence: book.sequence })
    const changed = (value: typeof input) => ({ ...state, worldBootstrap: { ...book, request: { ...book.request,
      data: { ...book.request.data, norms: [value] } } } })
    const audience = { ...input, audience: { kind: 'actors' as const, entityIds: [entityId('missing')] } }
    expect(() => prepareInitialNorm(changed(audience), audience, source, 11, 1000)).toThrow()
    expect(() => prepareInitialNorm({ ...state, time: '1' as SimulationSnapshot['time'] }, input, source, 11, 1000)).toThrow()
    if (input.enforcement.kind !== 'validated') throw new Error('Fixture must select a real installed primitive')
    const position = { ...input, enforcement: { ...input.enforcement, params: { ...input.enforcement.params, positionIds: [entityId('outsider')] } } }
    expect(() => prepareInitialNorm(changed(position), position, source, 11, 1000)).toThrow()
    expect(() => prepareInitialNorm({ ...state, worldBootstrap: { ...book, request: { ...book.request,
      data: { ...book.request.data, committeePolicies: [] } } } }, input, source, 11, 1000)).toThrow()
  })
  it('rejects proposal-selected weaker rules, changed quorum, missing or duplicate Native memberships', () => {
    const state = initialCommitted(), input = simulationGovernanceProposalInputSchema.parse({ committeeId: 'committee', scopeId: 'organization',
      body: 'An actual new proposal.', target: { kind: 'norm', norm: { id: 'next-rule', version: '1' } },
      policyRef: 'clocky.governance/1', rule: { kind: 'unanimity' }, quorum: 1, deadline: '10' })
    expect(() => { assertFrozenCommitteeProposal(state, input) }).not.toThrow()
    expect(() => { assertFrozenCommitteeProposal(state, { ...input, rule: { kind: 'absolute-threshold', yes: 1 } }) }).toThrow()
    expect(() => { assertFrozenCommitteeProposal(state, { ...input, quorum: 2 }) }).toThrow()
    expect(() => { assertFrozenCommitteeProposal(state, { ...input, committeeId: entityId('missing') }) }).toThrow()
    expect(() => { assertFrozenCommitteeProposal({ ...state, relations: {} }, input) }).toThrow()
    const original = Object.values(state.relations)[0]!
    expect(() => { assertFrozenCommitteeMembership({ ...state, relations: { ...state.relations,
      [simulationRelationIdSchema.parse('duplicate')]: { ...original, id: simulationRelationIdSchema.parse('duplicate') } } }, state.worldBootstrap!.request.data.committeePolicies[0]!) })
      .toThrow()
  })
  it('keeps advisory scenario-origin text, private audience and future availability separate from governance and actuation', () => {
    const original = initialFixture(), book = original.worldBootstrap!
    const input = simulationInitialNormSchema.parse({ ...book.request.data.norms[0], enforcement: { kind: 'advisory' },
      audience: { kind: 'actors', entityIds: ['reader'] }, effectiveFrom: '5', effectiveUntil: '10', availableAt: '3' })
    const state = initialCommitted({ ...original, worldBootstrap: { ...book, request: { ...book.request,
      data: { ...book.request.data, norms: [input], committeePolicies: [] } } } })
    const version = Object.values(state.world!.norms.versions)[0]![0]!
    expect(version).toMatchObject({ origin: 'scenario', subject: 'organization', enforcement: { kind: 'advisory' } })
    expect(() => { assertInitialNormSource(state, version) }).not.toThrow()
    expect(() => { assertNormProjection({ ...state, entities: { ...state.entities,
      [entityId('organization')]: { ...state.entities[entityId('organization')]!, phase: 'terminated' } } }) }).not.toThrow()
    expect(projectNorms({ ...state, time: '3' as SimulationSnapshot['time'] }, {
      viewer: entityId('reader'), cursor: state.revision, time: '3' as SimulationSnapshot['time'], limit: 10 }).items[0]?.effective).toBe('scheduled')
    expect(projectNorms(state, { viewer: entityId('publisher'), cursor: state.revision, time: state.time, limit: 10 }).items).toEqual([])
  })
  it('rejects foreign world sources, changed declarations, noncanonical committee identity and unsupported provenance', () => {
    const state = initialFixture(), book = state.worldBootstrap!, input = book.request.data.norms[0]!
    const committee = book.request.data.committeePolicies[0]!
    const source = simulationNormBootstrapSourceSchema.parse({ definitionHash: book.request.definitionHash,
      bootstrapSequence: book.sequence })
    const { worldBootstrap: _originalBook, ...withoutBook } = state
    expect(() => prepareInitialNorm(withoutBook, input, source, 11, 1000)).toThrow()
    expect(() => prepareInitialNorm({ ...state, world: { ...state.world!, definition: { ...state.world!.definition, policyVersion: 'foreign' } } },
      input, source, 11, 1000)).toThrow()
    expect(() => { assertFrozenCommitteeInitialization(state, { ...committee, name: 'Changed' }) }).toThrow()
    const retired = { ...state, entities: { ...state.entities, [committee.id]: { ...state.entities[committee.id]!, phase: 'terminated' as const } } }
    expect(() => { assertFrozenCommitteeInitialization(retired, committee) }).toThrow()
    const foreign = { ...state, entities: { ...state.entities, [entityId('publisher')]: { ...state.entities[entityId('publisher')]!, binding: undefined } } }
    expect(() => { assertFrozenCommitteeInitialization(foreign, committee) }).toThrow()
    const governed = committed(sourceFixture(base())), version = Object.values(governed.world!.norms.versions)[0]![0]!
    expect(() => foldInitialNorm(state, version)).toThrow()
    expect(() => { assertInitialNormSource(governed, version) }).toThrow()
    const applied = initialCommitted(), originalVersion = Object.values(applied.world!.norms.versions)[0]![0]!
    expect(() => {
      assertInitialNormSource({ ...applied, worldBootstrap: { ...applied.worldBootstrap!, appliedSequence: 12 } }, originalVersion)
    }).toThrow()
  })
})

describe('pure original Norm effects', () => {
  it.each([false, true])('rejects a conflicting common effective time before %s institution admission', (revoke) => {
    const prior = revoke ? { ...committed(sourceFixture(base())), time: '1' as SimulationSnapshot['time'] } : base()
    const h = sourceFixture(prior, revoke ? '2' : '1', revoke)
    const domain = revoke ? new NormRevokeNativeWorldDomain() : new NormEnactNativeWorldDomain()
    const request = simulationWorldRequestOperationSchema.parse({ kind: 'world/request', domain: domain.definition.domain,
      operation: domain.definition.operation, version: domain.definition.version,
      businessKey: 'conflicting-time', expectedTime: '10', evidence: [], payload: h.input })
    expect(() => domain.admitRequest(h.state, entityId('publisher'), request)).toThrow(/explicit effective boundary/)
  })
  it('appends exact approved body, source, original clock and actual frozen recipients without plan prose', () => {
    const h = sourceFixture(base()), state = committed(h), norm = state.world!.norms.versions[h.input.norm.id]![0]!
    expect(norm.body).toBe(h.input.body)
    expect(norm.source).toMatchObject(h.source)
    expect(norm.recordedAt).toBe(1000)
    expect(state.world!.norms.announcements[`norm-announcement:${h.source.mutationId}` as
      import('@clocky/clocky-simulation').WorldNormAnnouncementId]?.recipients).toEqual(['outsider', 'publisher', 'reader'])
    expect(JSON.stringify(state.world!.norms)).not.toContain('Private-rationale-sentinel')
    expect(h.state.world!.norms.versions).toEqual({})
    expect(() => { assertNormProjection(state) }).not.toThrow()
  })

  it.each(['ended-assignment', 'position-terminated', 'organization-terminated'] as const)(
    'excludes %s from new scope announcements without changing previously frozen recipients', (change) => {
      const original = base(), position = original.entities[entityId('position')]!, membership = simulationRelationIdSchema.parse('reader-assignment')
      const member: SimulationSnapshot = { ...original, entities: { ...original.entities, [position.id]: { ...position, kind: 'position' } },
        relations: { [membership]: { id: membership, revision: 1, subject: entityId('reader'), relation: 'assignment',
          object: position.id, scope: entityId('organization'), validFrom: '0' as SimulationSnapshot['time'],
          validUntil: '10' as SimulationSnapshot['time'] } } }
      const first = committed(sourceFixture(member, '1', false, { audience: { kind: 'scope-members' } }))
      const publication = Object.values(first.world!.norms.announcements)[0]!
      expect(publication.recipients).toEqual([entityId('reader')])
      const atBoundary = { ...first, time: (change === 'ended-assignment' ? '10' : '1') as SimulationSnapshot['time'] }
      const endpoint = atBoundary.entities[entityId(change === 'position-terminated' ? 'position' : 'organization')]!
      const changed = change === 'ended-assignment' ? atBoundary : foldEntityChange(atBoundary,
        simulationChangeSchema.parse({ kind: 'entity/phase', id: endpoint.id, entityRevision: endpoint.revision, phase: 'terminated' }))
      const next = committed(sourceFixture(changed, '2', false, { audience: { kind: 'scope-members' } }))
      const latest = Object.values(next.world!.norms.announcements).find(value => value.norm.version === '2')!
      expect(latest.recipients).toEqual([])
      expect(next.world!.norms.announcements[publication.id]).toEqual(publication)
      expect(() => { assertNormProjection(next) }).not.toThrow()
      expect(projectNorms(next, { viewer: entityId('reader'), cursor: next.revision, time: first.time, limit: 5 }).items).toEqual([])
    })

  it('enforces private and unannounced validated institutions while known projections remain reader scoped', () => {
    const h = sourceFixture(base(), '1', false, { availableAt: '10', audience: { kind: 'actors', entityIds: ['reader'] },
      enforcement: { kind: 'validated', policyRef: 'clocky.organization.hiring-approval/1',
        params: { committeeId: 'committee', positionIds: ['position'], maxHires: 1 } } })
    let state = committed(h)
    expect(effectiveNorms(state, entityId('organization'), state.time, state.revision)).toHaveLength(1)
    expect(projectNorms(state, { viewer: entityId('reader'), cursor: state.revision, time: state.time, limit: 5,
      ids: [h.input.norm.id] }).unknown).toEqual([h.input.norm.id])
    state = { ...state, time: '10' as SimulationSnapshot['time'] }
    expect(projectNorms(state, { viewer: entityId('reader'), cursor: state.revision, time: state.time, limit: 5 }).items).toHaveLength(1)
    expect(projectNorms(state, { viewer: entityId('publisher'), cursor: state.revision, time: state.time, limit: 5,
      ids: [h.input.norm.id] }).unknown).toEqual([h.input.norm.id])
    expect(effectiveNorms(state, entityId('organization'), state.time, state.revision)).toHaveLength(1)
  })

  it('keeps announced future versions separate from current enforcement and expires at the open endpoint', () => {
    const h = sourceFixture(base(), '1', false, { effectiveFrom: '5', effectiveUntil: '10' })
    let state = committed(h)
    expect(projectNorms(state, { viewer: entityId('reader'), cursor: state.revision, time: state.time, limit: 5 }).items[0]?.effective)
      .toBe('scheduled')
    expect(effectiveNorms(state, entityId('organization'), state.time, state.revision)).toEqual([])
    state = { ...state, time: '5' as SimulationSnapshot['time'] }
    expect(effectiveNorms(state, entityId('organization'), state.time, state.revision)).toHaveLength(1)
    state = { ...state, time: '10' as SimulationSnapshot['time'] }
    expect(effectiveNorms(state, entityId('organization'), state.time, state.revision)).toEqual([])
  })

  it('appends revocation and its original closure while earlier queries and body originals remain unchanged', () => {
    const first = committed(sourceFixture(base())), original = structuredClone(first.world!.norms.versions)
    const revoked = committed(sourceFixture({ ...first, revision: 20, time: '5' as SimulationSnapshot['time'] }, '2', true), 2000)
    expect(revoked.world!.norms.versions[entityId('hiring-rule') as unknown as keyof SimulationNormState['versions']]?.[0])
      .toEqual(Object.values(original)[0]?.[0])
    expect(revoked.world!.norms.closures).toHaveLength(1)
    expect(effectiveNorms(revoked, entityId('organization'), revoked.time, revoked.revision)).toEqual([])
    const old = projectNorms(revoked, { viewer: entityId('reader'), cursor: first.revision, time: first.time, limit: 5 })
    expect(old.items).toHaveLength(1); expect(old.items[0]?.effective).toBe('effective')
    const current = projectNorms(revoked, { viewer: entityId('reader'), cursor: revoked.revision, time: revoked.time, limit: 5 })
    expect(current.items.map(value => value.effective)).toEqual(['historical', 'revoked'])
    expect(() => { assertNormProjection(revoked) }).not.toThrow()
  })

  it('blocks unsupported old obligation migration without changing old legal tasks, commitments or Norm state', () => {
    const state = base(), commitment: SimulationCommitment = { id: simulationCommitmentIdSchema.parse('old-obligation'),
      interactionId: simulationInteractionIdSchema.parse('old-interaction'), debtor: entityId('reader'), creditor: entityId('publisher'),
      revision: 1, phase: 'open', createdBy: simulationOperationIdSchema.parse('old-operation'), evidence: [] }
    const withObligation = { ...state, commitments: { [commitment.id]: commitment } }
    const h = sourceFixture(withObligation, '1', false, { impact: 'migrate-existing' })
    try { validateNormRequest(h.state, h.input, 'norm/enact', h.source.requestId); throw new Error('Expected typed migration block') }
    catch (error) {
      expect(error).toBeInstanceOf(SimulationNormError)
      expect(error).toMatchObject({ code: 'SIM_NORM_EXISTING_OBLIGATIONS', obligations: [{ kind: 'commitment', id: 'old-obligation', revision: 1 }] })
    }
    expect(previewNormImpact(h.state, simulationNormEnactRequestSchema.parse(h.input), h.source.requestId)).toMatchObject({
      existingObligations: [{ kind: 'commitment', id: 'old-obligation', revision: 1 }],
      existingObligationsPolicy: 'preserve-original', blocked: 'existing-obligations-require-explicit-migration',
      policyCombination: { rule: 'all-applicable-hiring-approvals' },
    })
    const future = sourceFixture(withObligation)
    const next = committed(future)
    expect(next.commitments).toBe(withObligation.commitments)
    expect(next.world!.norms.versions).not.toEqual({})
    expect(h.state.world!.norms.versions).toEqual({})
  })

  it('rejects changed vote material, source substitution, version conflicts and past dates before a closed effect', () => {
    const h = sourceFixture(base())
    for (const input of [{ ...h.input, body: 'Director replacement' },
      { ...h.input, resolution: { ...h.input.resolution, hash: digest('changed') } },
      { ...h.input, norm: simulationNormReferenceSchema.parse({ id: 'hiring-rule', version: '2' }) },
      { ...h.input, scope: entityId('committee') }]) {
      expect(() => validateNormRequest(h.state, input, 'norm/enact')).toThrow()
    }
    expect(() => applyNormEffect(h.state, { ...h.source, mutationId: 'replacement' as typeof h.source.mutationId }, h.effect, 11, 1000)).toThrow()
    expect(() => validateNormRequest({ ...h.state, time: '1' as SimulationSnapshot['time'] }, h.input, 'norm/enact')).toThrow()
    expect(h.state.world!.norms.versions).toEqual({})
  })

  it('provides actual passed opportunities only through exact live committee/scope grants', () => {
    const h = sourceFixture(base()), actor = entityId('publisher'), grant = { requesterEntityId: actor,
      domain: 'governance', operation: 'enact-norm', version: '1', scopeEntityId: entityId('organization'),
      targetEntityId: entityId('committee'), relationId: 'enact-grant' as keyof SimulationSnapshot['relations'], relation: 'can-enact' }
    const relation = { id: grant.relationId, subject: actor, object: grant.targetEntityId, scope: grant.scopeEntityId,
      relation: grant.relation, revision: 1, validFrom: h.state.time, validUntil: null }
    const state = { ...h.state, spec: { ...h.state.spec, relationRules: [{ relation: 'can-enact',
      subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }] },
    relations: { ...h.state.relations, [relation.id]: relation }, world: { ...h.state.world!,
      definition: { ...h.state.world!.definition, operationGrants: [grant] } } }
    const domain = new NormEnactNativeWorldDomain()
    expect(domain.goalContext(state, actor)).toMatchObject({
      opportunities: [{ proposal: h.input.proposal, resolution: h.input.resolution }],
    })
    for (const endpoint of ['publisher', 'committee', 'organization']) {
      const current = state.entities[entityId(endpoint)]!
      const revoked = foldEntityChange(state, simulationChangeSchema.parse({ kind: 'entity/phase', id: current.id,
        entityRevision: current.revision, phase: 'inactive' }))
      expect(domain.goalContext(revoked, actor), `Inactive ${endpoint} cannot disclose approved proposal text`)
        .toEqual({ kind: 'norm-enact-opportunities', opportunities: [] })
    }
    expect(domain.goalContext(state, entityId('outsider'))).toEqual({ kind: 'norm-enact-opportunities', opportunities: [] })
    expect(domain.goalContext({ ...state, relations: { [relation.id]: { ...relation, scope: entityId('committee') } } }, actor))
      .toEqual({ kind: 'norm-enact-opportunities', opportunities: [] })
  })

  it('returns exact context sources and rejects partial histories, rewritten announcements and complete-output overflow', () => {
    const h = sourceFixture(base()), state = committed(h), material = normContextMaterial(state, entityId('reader'), state.time, state.revision)
    expect(material.sources.some(value => value.sequence === state.revision)).toBe(true)
    const announcement = Object.values(state.world!.norms.announcements)[0]!
    const corrupt = { ...state, world: { ...state.world!, norms: { ...state.world!.norms, announcements: {
      [announcement.id]: { ...announcement, material: { ...announcement.material, body: 'Private-rationale-sentinel' } } } } } }
    expect(() => { assertNormProjection(corrupt) }).toThrow()
    expect(() => applyNormEffect({ ...h.state, spec: { ...h.state.spec, maxKnowledgeBytes: 10 } }, h.source, h.effect, 11, 1000)).toThrow()
    expect(() => projectNorms(state, { viewer: entityId('reader'), cursor: state.revision, time: state.time, limit: 1,
      ids: [h.input.norm.id, h.input.norm.id] })).toThrow()
  })
})
