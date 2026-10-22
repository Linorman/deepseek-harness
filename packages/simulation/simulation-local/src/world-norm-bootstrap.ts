/** Scenario-origin institutions and committee rules derive only from the prior Native bootstrap book. */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { simulationInitialNormSchema, simulationNormBootstrapSourceSchema, simulationNormVersionSchema,
  simulationFrozenCommitteePolicySchema, SimulationNormError, SimulationGovernanceError, normState,
  WORLD_NORM_SCHEMA_REF, parseSimTime, currentWorldOperationGrants } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationInitialNorm, SimulationNormBootstrapSource, SimulationNormVersion,
  SimulationNormState, SimulationFrozenCommitteePolicy, SimulationGovernanceProposalInput,
  SimulationEntityId, SimulationWorldDomainPin } from '@clocky/clocky-simulation'
import type { SimulationWorldBootstrapBook } from '@clocky/clocky-simulation/src/world-bootstrap-types.ts'
import { deriveNormAnnouncement } from './world-norms.ts'

function digest(body: string): string { return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}` }
function bootstrap(state: SimulationSnapshot): SimulationWorldBootstrapBook {
  if (state.worldBootstrap === undefined || state.world === undefined
    || state.worldBootstrap.sequence >= state.world.sequence
    || !isDeepStrictEqual(state.worldBootstrap.request.definition, state.world.definition)) {
    throw new SimulationNormError('SIM_NORM_SOURCE', 'Scenario Norm requires its original retained bootstrap and World definition')
  }
  return state.worldBootstrap
}

/**
 * Project only original committee rules reachable through this actor's live proposal permission.
 * @param state - Current Native prefix containing the applied original bootstrap.
 * @param actor - Actual requesting actor; Team membership and display names grant no access.
 * @param pin - Exact installed proposal operation whose goal is being prepared.
 * @returns frozen rule/quorum and their original log source, without other committees or private documents.
 */
export function frozenCommitteeProposalPolicies(state: SimulationSnapshot, actor: SimulationEntityId,
  pin: SimulationWorldDomainPin): Array<{
  committeeId: SimulationFrozenCommitteePolicy['id']
  scopeId: SimulationFrozenCommitteePolicy['scopeId']
  rule: SimulationFrozenCommitteePolicy['rule']
  quorum: number
  source: { bootstrapSequence: number; definitionHash: string }
}> {
  if (state.worldBootstrap === undefined || state.worldBootstrap.status !== 'applied') return []
  const book = bootstrap(state)
  const grants = currentWorldOperationGrants(state, actor, pin).map(({ grant }) => grant)
  return book.request.data.committeePolicies.filter(policy => grants.some(grant => grant.targetEntityId === policy.id
    && grant.scopeEntityId === policy.scopeId)).map(policy => ({ committeeId: policy.id, scopeId: policy.scopeId,
    rule: policy.rule, quorum: policy.quorum, source: { bootstrapSequence: book.sequence, definitionHash: book.request.definitionHash } }))
}
function retainedInput(state: SimulationSnapshot, input: SimulationInitialNorm, source: SimulationNormBootstrapSource) {
  const book = bootstrap(state)
  const originals = book.request.data.norms.filter(value => value.id === input.id)
  if (book.request.definitionHash !== source.definitionHash || book.sequence !== source.bootstrapSequence
    || originals.length !== 1 || !isDeepStrictEqual(originals[0], input)) {
    throw new SimulationNormError('SIM_NORM_SOURCE', 'Scenario Norm differs from its original definition hash, bootstrap sequence or exact input')
  }
  return book
}
function committee(state: SimulationSnapshot, id: SimulationInitialNorm['scopeId'], scope: SimulationInitialNorm['scopeId']):
SimulationFrozenCommitteePolicy {
  const policies = bootstrap(state).request.data.committeePolicies.filter(value => value.id === id)
  const selected = policies[0]
  if (policies.length !== 1 || selected === undefined || selected.scopeId !== scope) {
    throw new SimulationNormError('SIM_NORM_POLICY', 'Validated initial institution requires its original declared committee and scope')
  }
  return simulationFrozenCommitteePolicySchema.parse(selected)
}
function policy(state: SimulationSnapshot, input: SimulationInitialNorm, live: boolean): void {
  const scope = state.entities[input.scopeId]
  if (scope?.kind !== 'organization' || scope.cognition !== 'none' || live && scope.phase !== 'active'
    || input.audience.kind === 'actors' && input.audience.entityIds.some(id => !Object.hasOwn(state.entities, id))) {
    throw new SimulationNormError('SIM_NORM_SCOPE', 'Initial institution scope and audience must name actual original identities')
  }
  if (input.enforcement.kind !== 'validated') return
  const params = input.enforcement.params, original = committee(state, params.committeeId, input.scopeId)
  const configured = bootstrap(state).request.definition, subject = state.entities[original.id]
  if (configured.organizationEntityId !== input.scopeId || subject?.kind !== 'organization' || subject.cognition !== 'none'
    || live && subject.phase !== 'active' || params.positionIds.some(id => !configured.positions.some(value => value.entityId === id)
      || state.entities[id]?.kind !== 'position' || state.entities[id].cognition !== 'none'
      || live && state.entities[id].phase !== 'active')) {
    throw new SimulationNormError('SIM_NORM_POLICY', 'Initial hiring policy requires its owned committee and declared position allowlist')
  }
}

function declaredCommittee(state: SimulationSnapshot, input: SimulationFrozenCommitteePolicy) {
  const selected = simulationFrozenCommitteePolicySchema.parse(input), book = bootstrap(state)
  const originals = book.request.data.committeePolicies.filter(value => value.id === selected.id)
  if (originals.length !== 1 || !isDeepStrictEqual(originals[0], selected)) {
    throw new SimulationGovernanceError('SIM_GOVERNANCE_ELECTORATE', 'Committee declaration differs from its original scenario source')
  }
  for (const id of [selected.id, selected.scopeId]) {
    const entity = state.entities[id]
    if (entity?.kind !== 'organization' || entity.cognition !== 'none' || entity.phase !== 'active')
      throw new SimulationGovernanceError('SIM_GOVERNANCE_ELECTORATE', 'Frozen committee and scope require active original organizations')
  }
  return { selected, book }
}
function memberMatches(state: SimulationSnapshot, book: SimulationWorldBootstrapBook, committee: SimulationFrozenCommitteePolicy,
  value: SimulationFrozenCommitteePolicy['members'][number]): boolean {
  const member = state.entities[value.personId], relation = state.relations[value.id]
  return member?.kind === 'person' && member.cognition === 'agent' && member.phase === 'active' && member.readiness === 'ready'
    && member.binding !== undefined && member.binding.teamId === state.teamReservation?.teamId
    && book.request.actorIds.includes(member.id) && relation?.relation === 'committee-member' && relation.object === committee.id
    && relation.subject === value.personId && relation.scope === committee.scopeId
    && relation.validFrom === value.validFrom && relation.validUntil === value.validUntil
}

/**
 * Validate authored committee intervals and original canonical actors without inventing time-zero membership.
 * @param state - Bootstrap prefix with actual declared relations and prepared canonical actors.
 * @param input - Exact frozen declaration; repeated people need disjoint half-open membership intervals.
 * @returns normally only for literal interval/source matches, bounded times and a simultaneously attainable rule/quorum.
 */
export function assertFrozenCommitteeInitialization(state: SimulationSnapshot, input: SimulationFrozenCommitteePolicy): void {
  const { selected, book } = declaredCommittee(state, input)
  for (const member of selected.members) {
    parseSimTime(member.validFrom, state.spec.maxTime)
    if (member.validUntil !== null) parseSimTime(member.validUntil, state.spec.maxTime)
  }
  const actual = Object.values(state.relations).filter(value => value.relation === 'committee-member' && value.object === selected.id)
  if (actual.length !== selected.members.length || selected.members.some(value => !memberMatches(state, book, selected, value))) {
    throw new SimulationGovernanceError('SIM_GOVERNANCE_ELECTORATE', 'Initialized committee lost its original declared intervals or canonical members')
  }
}

/**
 * Verify the actual currently eligible memberships when admitting a new proposal.
 * @param state - Live Native membership and canonical actor state at the real proposal time.
 * @param input - Exact original committee declaration; future-only membership never contributes current votes.
 * @returns normally only when the live electorate matches original intervals and can attain its frozen quorum/threshold.
 */
export function assertFrozenCommitteeMembership(state: SimulationSnapshot, input: SimulationFrozenCommitteePolicy): void {
  const { selected, book } = declaredCommittee(state, input)
  const eligible = (from: string, until: string | null) => BigInt(from) <= BigInt(state.time)
    && (until === null || BigInt(state.time) < BigInt(until))
  const declared = selected.members.filter(value => eligible(value.validFrom, value.validUntil))
  const actual = Object.values(state.relations).filter(value => value.relation === 'committee-member'
    && value.object === selected.id && value.scope === selected.scopeId && eligible(value.validFrom, value.validUntil))
  if (actual.length !== declared.length || !declared.length || declared.some(value => !memberMatches(state, book, selected, value))
    || selected.quorum > declared.length || selected.rule.kind === 'absolute-threshold' && selected.rule.yes > declared.length) {
    throw new SimulationGovernanceError('SIM_GOVERNANCE_ELECTORATE', 'Actual committee memberships or attainable quorum differ from the frozen scenario')
  }
}

/**
 * Require an actual proposal to use the original scenario rule and quorum; no caller can choose a weaker voting rule.
 * @param state - Authoritative Native source with the actual applied bootstrap book.
 * @param input - Actual model-proposed committee, scope, installed policy, rule and quorum.
 * @returns normally only when the committee declaration and Native membership are exact and current.
 */
export function assertFrozenCommitteeProposal(state: SimulationSnapshot, input: SimulationGovernanceProposalInput): void {
  const book = bootstrap(state)
  const policies = book.request.data.committeePolicies.filter(value => value.id === input.committeeId)
  const selected = policies[0]
  if (book.status !== 'applied' || policies.length !== 1 || selected === undefined || selected.scopeId !== input.scopeId
    || input.quorum !== selected.quorum || !isDeepStrictEqual(input.rule, selected.rule)) {
    throw new SimulationGovernanceError('SIM_GOVERNANCE_PROPOSAL', 'Proposal cannot replace its scenario-frozen committee scope, rule or quorum')
  }
  assertFrozenCommitteeMembership(state, selected)
}

/**
 * Prepare an initial immutable version from its exact prior retained bootstrap source without governance fiction.
 * @param state - Bootstrap prefix after real entities, memberships and World have been populated.
 * @param input - Complete original scenario institution declaration.
 * @param source - Original definition hash and strictly earlier retained bootstrap sequence.
 * @param sequence - Actual next Native append position for this version.
 * @param recordedAt - Original Native recording clock; replay must retain it.
 * @returns complete scenario-origin version 1; no IO, votes, proposals, resolutions or mutation identities are created.
 */
export function prepareInitialNorm(state: SimulationSnapshot, input: SimulationInitialNorm, source: SimulationNormBootstrapSource,
  sequence: number, recordedAt: number): SimulationNormVersion {
  const selected = simulationInitialNormSchema.parse(input), originalSource = simulationNormBootstrapSourceSchema.parse(source)
  const book = retainedInput(state, selected, originalSource)
  if (book.status !== 'retained' || sequence !== state.revision + 1 || state.world?.sequence !== sequence
    || originalSource.bootstrapSequence >= sequence
    || !Number.isSafeInteger(recordedAt) || recordedAt < 0 || Object.hasOwn(normState(state).versions, selected.id)) {
    throw new SimulationNormError('SIM_NORM_SOURCE', 'Initial Norm needs its unconsumed bootstrap, adjacent append and unused version identity')
  }
  for (const time of [selected.effectiveFrom, selected.effectiveUntil, selected.availableAt]) if (time !== null)
    parseSimTime(time, state.spec.maxTime)
  if (BigInt(selected.effectiveFrom) < BigInt(state.time) || BigInt(selected.availableAt) < BigInt(state.time))
    throw new SimulationNormError('SIM_NORM_TIME', 'Initial institutions cannot rewrite earlier effective or available history')
  policy(state, selected, true)
  if (selected.enforcement.kind === 'validated') assertFrozenCommitteeInitialization(state,
    committee(state, selected.enforcement.params.committeeId, selected.scopeId))
  return simulationNormVersionSchema.parse({ id: selected.id, version: '1', schemaRef: WORLD_NORM_SCHEMA_REF, origin: 'scenario',
    subject: selected.enforcement.kind === 'validated' ? selected.enforcement.params.committeeId : selected.scopeId,
    scope: selected.scopeId, body: selected.body, bodyHash: digest(selected.body), status: 'enacted', enforcement: selected.enforcement,
    supersedes: null, effectiveFrom: selected.effectiveFrom, effectiveUntil: selected.effectiveUntil, availableAt: selected.availableAt,
    audience: selected.audience, source: { ...originalSource, references: [{ kind: 'run-event', runId: state.spec.runId,
      sequence: originalSource.bootstrapSequence }] }, sequence, recordedAt })
}

/**
 * Fold the exact prepared scenario record into the sole Norm book, retaining real announcement provenance.
 * @param state - Original prefix before this version's adjacent append.
 * @param input - Actual journal-owned scenario version, including original sequence and clock.
 * @returns complete new Norm state; Native owns atomic ready publication and announcement/boundary records.
 */
export function foldInitialNorm(state: SimulationSnapshot, input: SimulationNormVersion): SimulationNormState {
  const version = simulationNormVersionSchema.parse(input)
  if (version.origin !== 'scenario') throw new SimulationNormError('SIM_NORM_SOURCE', 'Initial Norm fold refuses a governance-origin version')
  const initial = { id: version.id, scopeId: version.scope, body: version.body, effectiveFrom: version.effectiveFrom,
    effectiveUntil: version.effectiveUntil, availableAt: version.availableAt, audience: version.audience, enforcement: version.enforcement }
  const expected = prepareInitialNorm(state, initial, { definitionHash: version.source.definitionHash,
    bootstrapSequence: version.source.bootstrapSequence }, version.sequence, version.recordedAt)
  if (!isDeepStrictEqual(version, expected)) throw new SimulationNormError('SIM_NORM_SOURCE', 'Initial Norm record changed its original source or prepared publication')
  const norms = normState(state), announcement = deriveNormAnnouncement(state, version)
  const next: SimulationNormState = { ...norms, versions: { ...norms.versions, [version.id]: [version] },
    announcements: { ...norms.announcements, [announcement.id]: announcement } }
  if (Buffer.byteLength(JSON.stringify(next), 'utf8') > state.spec.maxKnowledgeBytes)
    throw new SimulationNormError('SIM_NORM_LIMIT', 'Complete initial institution and announcement exceed the frozen byte allowance')
  return next
}

/**
 * Verify original scenario provenance during complete replay without reapplying present membership permissions to history.
 * @param state - Complete authoritative projection including applied bootstrap source.
 * @param version - Immutable historical scenario-origin publication.
 * @returns normally only for exact version 1, original authored fields and earlier retained source.
 */
export function assertInitialNormSource(state: SimulationSnapshot, version: SimulationNormVersion): void {
  if (version.origin !== 'scenario') throw new SimulationNormError('SIM_NORM_SOURCE', 'Scenario provenance cannot stand in for governance')
  const source = simulationNormBootstrapSourceSchema.parse({ definitionHash: version.source.definitionHash,
    bootstrapSequence: version.source.bootstrapSequence })
  const input = simulationInitialNormSchema.parse({ id: version.id, scopeId: version.scope, body: version.body,
    effectiveFrom: version.effectiveFrom, effectiveUntil: version.effectiveUntil, availableAt: version.availableAt,
    audience: version.audience, enforcement: version.enforcement })
  const book = retainedInput(state, input, source)
  if (book.status !== 'applied' || book.appliedSequence !== version.sequence || state.world?.sequence !== version.sequence
    || source.bootstrapSequence >= version.sequence || version.version !== '1' || version.supersedes !== null
    || version.status !== 'enacted' || version.bodyHash !== digest(version.body)
    || version.subject !== (input.enforcement.kind === 'validated' ? input.enforcement.params.committeeId : input.scopeId)
    || !isDeepStrictEqual(version.source.references, [{ kind: 'run-event', runId: state.spec.runId, sequence: book.sequence }])) {
    throw new SimulationNormError('SIM_NORM_INTEGRITY', 'Initial institution lost its original bootstrap provenance or exact authored version')
  }
  policy(state, input, false)
}
