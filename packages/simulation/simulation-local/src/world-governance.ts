import { worldDecisionSource, governanceVoteTally } from '@clocky/clocky-simulation'
/** Pure Native committee admission and closure; callers append records and wakes in one owned batch. */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { SimulationGovernanceError, simulationGovernanceProposalInputSchema, simulationGovernanceProposalSchema,
  simulationGovernanceVoteInputSchema, simulationGovernanceVoteSchema, simulationGovernanceResolutionSchema,
  worldVoteIdSchema, worldProposalIdSchema, worldResolutionIdSchema, simulationEventIdSchema,
  simulationContextConsumptionHash, simulationContextConsumptionSchema, parseSimTime, governanceProposalMaterial,
  WORLD_GOVERNANCE_PROPOSE_DEFINITION, WORLD_GOVERNANCE_PROPOSE_PIN,
  WORLD_GOVERNANCE_VOTE_DEFINITION, WORLD_GOVERNANCE_VOTE_PIN, simulationGovernanceAcknowledgeSchema,
  simulationWorldReadSetSchema, simulationGovernanceNormProposalInputSchema, hireApprovalBody,
  simulationGovernanceDelegationInputSchema, simulationGovernanceDelegationSchema,
  WORLD_GOVERNANCE_DELEGATE_PIN, WORLD_GOVERNANCE_DELEGATE_DEFINITION, simulationReviewRouteDefinitionInputSchema,
  simulationReviewRouteDefinitionSchema, governanceRouteMaterial, currentWorldOperationGrants,
  WORLD_GOVERNANCE_ROUTE_PIN, WORLD_GOVERNANCE_ROUTE_DEFINITION } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationOperation, SimulationEntityId, SimulationGovernanceState,
  SimulationGovernanceProposal, SimulationGovernanceVote, SimulationGovernanceResolution,
  WorldProposalId, NativeWorldDomain, SimulationWorldDomainRequest,
  SimulationWorldIntent, SimulationWorldBusinessResolution, SimulationWorldPlan, SimulationWorldJsonValue,
  SimulationDecision, SimulationGovernanceProposalInput, SimulationReviewRouteDefinition, SimulationReviewRouteDefinitionInput } from '@clocky/clocky-simulation'
import { businessFingerprint } from './business.ts'
import { allocateEventKey } from './scheduler.ts'
import type { SchedulerRecord } from './scheduler.ts'
import { validateHireApprovalTarget } from './world-hire-approval.ts'
import { assertFrozenCommitteeProposal, frozenCommitteeProposalPolicies } from './world-norm-bootstrap.ts'

/** Core-owned records; no model method exposes these append envelopes. */
export const worldGovernanceRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('world/governance-proposed'), proposal: simulationGovernanceProposalSchema }),
  z.strictObject({ kind: z.literal('world/governance-voted'), vote: simulationGovernanceVoteSchema }),
  z.strictObject({ kind: z.literal('world/governance-closed'), resolution: simulationGovernanceResolutionSchema }),
])
/** One complete immutable governance fact in the existing Native stream. */
export type WorldGovernanceRecord = z.infer<typeof worldGovernanceRecordSchema>

function lookup<T>(values: Readonly<Record<string, T>>, id: string): T | undefined {
  return Object.hasOwn(values, id) ? values[id] : undefined
}
function deny(code: SimulationGovernanceError['code'], message: string): never {
  throw new SimulationGovernanceError(code, message)
}
function originalOperation(state: SimulationSnapshot, operation: SimulationOperation, name: string,
  live: boolean): { source: SimulationGovernanceVote['source']
  actor: SimulationEntityId
  payload: unknown
  decision: SimulationDecision
  context: Extract<SimulationDecision['context'], { status: 'prepared' }> } {
  const retained = lookup(state.operations, operation.id), decision = lookup(state.decisions, operation.decisionId)
  if (!isDeepStrictEqual(retained, operation) || decision?.status !== 'accepted'
    || !decision.operationIds.includes(operation.id) || operation.entityId !== decision.entityId || operation.action.kind !== 'world/request'
    || operation.action.domain !== 'governance' || operation.action.operation !== name || operation.action.version !== '1') {
    deny('SIM_GOVERNANCE_SOURCE', 'Governance contribution must be the exact original accepted operation')
  }
  const actor = lookup(state.entities, decision.entityId), context = decision.context, consumption = decision.consumption
  if (actor?.binding === undefined || context?.status !== 'prepared' || context.world === undefined
    || consumption === undefined || consumption.sessionId !== actor.binding.sessionId
    || consumption.contextHash !== simulationContextConsumptionHash(context.view)
    || consumption.inputId !== context.view.inputId || context.view.entityId !== actor.id
    || context.view.slot !== decision.slot || context.view.epoch !== decision.epoch || context.view.runId !== state.spec.runId
    || context.view.time !== decision.time || context.view.projections.run !== decision.snapshotRevision
    || context.view.projections.entity !== decision.entityRevision
    || live && (actor.phase !== 'active' || actor.cognition !== 'agent' || actor.readiness !== 'ready'
      || actor.writer?.phase !== 'active' || actor.writer.epoch !== decision.epoch || decision.time !== state.time)) {
    deny('SIM_GOVERNANCE_SOURCE', 'Governance contribution lost its canonical actor, epoch or consumed prepared view')
  }
  if (!simulationContextConsumptionSchema.safeParse(consumption).success) {
    deny('SIM_GOVERNANCE_SOURCE', 'Governance consumption must follow its exact recorded context view')
  }
  return { actor: actor.id, payload: operation.action.payload, decision, context, source: { decisionId: decision.id,
    operationId: operation.id, epoch: decision.epoch, binding: actor.binding,
    contextHash: consumption.contextHash, inputId: consumption.inputId } }
}
function electorate(state: SimulationSnapshot, committeeId: SimulationEntityId, scopeId: SimulationEntityId):
SimulationGovernanceProposal['electorate'] {
  if (lookup(state.entities, committeeId)?.phase !== 'active' || lookup(state.entities, scopeId)?.phase !== 'active') {
    deny('SIM_GOVERNANCE_ELECTORATE', 'Proposal committee and scope must exist and be active')
  }
  const relations = Object.values(state.relations).filter(value => value.relation === 'committee-member'
    && value.object === committeeId && value.scope === scopeId && BigInt(value.validFrom) <= BigInt(state.time)
    && (value.validUntil === null || BigInt(state.time) < BigInt(value.validUntil)))
  const members = relations.map((membership) => {
    const member = lookup(state.entities, membership.subject)
    if (member?.phase !== 'active' || member.cognition !== 'agent' || member.readiness !== 'ready' || member.binding === undefined) {
      deny('SIM_GOVERNANCE_ELECTORATE', 'Every actual committee member needs an independent canonical cognitive identity')
    }
    return { entityId: member.id, binding: member.binding, membership: { id: membership.id, revision: membership.revision,
      validFrom: membership.validFrom, validUntil: membership.validUntil } }
  }).sort((a, b) => a.entityId < b.entityId ? -1 : a.entityId === b.entityId ? 0 : 1)
  if (!members.length || new Set(members.map(value => value.entityId)).size !== members.length) {
    deny('SIM_GOVERNANCE_ELECTORATE', 'Committee electorate cannot be empty or contain duplicate memberships')
  }
  return members
}
/**
 * Hash the exact proposed document text; display summaries cannot stand in for this original.
 * @param body - Exact original Unicode document text.
 * @returns lowercase SHA-256 with the protocol hash prefix.
 */
export function governanceBodyHash(body: string): string {
  return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`
}
/** Validate an immutable review route against actual Native proposal and vote receipts.
 * @param state - Original Native history containing each referenced committee decision.
 * @param input - Proposed final document with its explicit frozen route.
 * @returns normally only when the complete route authorizes this exact document and scope.
 */
export function assertReviewRoute(state: SimulationSnapshot, input: SimulationGovernanceProposalInput): void {
  const route = input.reviewRoute
  if (route === undefined) return
  const originalRoute = state.world?.governance.routes?.[route.id]
  if (originalRoute === undefined || originalRoute.hash !== route.definitionHash || originalRoute.revision !== route.revision
    || originalRoute.mode !== route.mode || originalRoute.bodyHash !== route.bodyHash || originalRoute.deadline !== route.deadline
    || !isDeepStrictEqual(originalRoute.steps.map(({ proposalRevision: _revision, ...step }) => step),
      route.steps.map(({ resolutionId: _id, resolutionHash: _hash, ...step }) => step)))
    deny('SIM_GOVERNANCE_PROPOSAL', 'Approval proof differs from its original pre-ballot route definition')
  const { hash, ...material } = route
  if (hash !== businessFingerprint(material) || route.bodyHash !== governanceBodyHash(input.body)) deny('SIM_GOVERNANCE_PROPOSAL', 'Review route lost its hash, exact document or deadline')
  const members = new Set<string>(), decisions = new Map<string, SimulationGovernanceResolution>()
  for (const step of route.steps) {
    const proposal = state.world?.governance.proposals[step.proposalId]
    const resolution = step.resolutionId === null ? undefined : state.world?.governance.resolutions[step.resolutionId]
    if (proposal === undefined || proposal.bodyHash !== route.bodyHash || proposal.body !== input.body
      || proposal.scopeId !== input.scopeId || !isDeepStrictEqual(proposal.target, input.target)
      || proposal.reviewRoute !== undefined || (step.resolutionId === null) !== (step.resolutionHash === null)
      || step.resolutionId !== null && (resolution === undefined || resolution.proposalId !== proposal.id
        || resolution.hash !== step.resolutionHash || resolution.sequence > state.revision
        || BigInt(resolution.time) > BigInt(route.deadline)))
      deny('SIM_GOVERNANCE_PROPOSAL', 'Review route requires actual original committee decisions for the same document')
    for (const member of proposal.electorate) {
      if (members.has(member.entityId)) deny('SIM_GOVERNANCE_ELECTORATE', 'Review route cannot count one approver in multiple committees')
      members.add(member.entityId)
    }
    if (resolution !== undefined) decisions.set(step.id, resolution)
  }
  for (const [index, step] of route.steps.entries()) {
    const current = decisions.get(step.id), previous = route.steps[index - 1]
    if (current === undefined || current.outcome !== 'passed') continue
    const dependencies = [...step.dependsOn, ...route.mode === 'ordered' && previous !== undefined ? [previous.id] : []]
    if (dependencies.some((id) => {
      const dependency = decisions.get(id)
      return dependency === undefined || dependency.outcome !== 'passed' || dependency.sequence >= current.sequence
    }))
      deny('SIM_GOVERNANCE_PROPOSAL', 'Review route dependencies must pass before their dependent step')
  }
  const passed = [...decisions.values()].filter(value => value.outcome === 'passed').length
  if (route.mode === 'or' ? passed === 0 : passed !== route.steps.length)
    deny('SIM_GOVERNANCE_PENDING', 'Review route has not satisfied its frozen approval combination')
}
/** Materialize only actual resolution references for a fixed pre-ballot route; pending OR branches remain explicit.
 * @param state - Complete Native projection.
 * @param route - Original immutable route definition.
 * @returns exact hashed proof material; callers still validate its AND/OR/ordered satisfaction before publishing.
 */
export function governanceRouteProof(state: SimulationSnapshot, route: SimulationReviewRouteDefinition): NonNullable<SimulationGovernanceProposalInput['reviewRoute']> {
  const material = { id: route.id, revision: route.revision, definitionHash: route.hash, mode: route.mode,
    bodyHash: route.bodyHash, membershipPolicy: route.membershipPolicy, deadline: route.deadline,
    steps: route.steps.map((step) => {
      const resolution = Object.values(state.world?.governance.resolutions ?? {}).find(value => value.proposalId === step.proposalId
        && BigInt(value.time) <= BigInt(route.deadline))
      return { id: step.id, proposalId: step.proposalId, dependsOn: step.dependsOn,
        resolutionId: resolution?.id ?? null, resolutionHash: resolution?.hash ?? null }
    }) }
  return { ...material, hash: businessFingerprint(material) }
}

/**
 * Freeze an admitted proposal from its actual accepted request and current committee relations.
 * @param state - Current authoritative Native state, including the original accepted operation.
 * @param governance - Current Native governance projection.
 * @param operation - Exact original governance.propose-norm world request.
 * @param sequence - Candidate append sequence for this complete record.
 * @returns original retry or a complete proposal; no journal or model IO occurs here.
 */
export function prepareGovernanceProposal(state: SimulationSnapshot, governance: SimulationGovernanceState,
  operation: SimulationOperation, sequence: number): SimulationGovernanceProposal {
  const operationName = operation.action.kind === 'world/request' ? operation.action.operation : undefined
  if (operationName !== 'propose-norm' && operationName !== 'propose-hire-approval') {
    deny('SIM_GOVERNANCE_SOURCE', 'Proposal requires an installed normative or single-hire approval operation')
  }
  const identity = originalOperation(state, operation, operationName, false)
  const input = simulationGovernanceProposalInputSchema.parse(identity.payload)
  assertReviewRoute(state, input)
  if (operationName === 'propose-norm' && input.target.kind !== 'norm'
    || operationName === 'propose-hire-approval' && input.target.kind !== 'hire-approval') {
    deny('SIM_GOVERNANCE_PROPOSAL', 'Proposal operation differs from its exact closed target purpose')
  }
  if (operation.action.kind !== 'world/request') deny('SIM_GOVERNANCE_SOURCE', 'Proposal lost its original request')
  const id = worldProposalIdSchema.parse(`governance-proposal:${businessFingerprint([state.spec.runId,
      operation.action.businessKey]).slice(7)}`), original = lookup(governance.proposals, id)
  if (original !== undefined) {
    const { id: _id, revision: _revision, bodyHash: _hash, proposer: _proposer, source: _source,
      electorate: _electorate, time: _time, sequence: _sequence, ...priorInput } = original
    if (!isDeepStrictEqual(priorInput, input) || !isDeepStrictEqual(original.source, identity.source)
      || original.proposer !== identity.actor) deny('SIM_GOVERNANCE_PROPOSAL', 'Proposal identity already retains different original content')
    return original
  }
  originalOperation(state, operation, operationName, true)
  if (state.worldBootstrap !== undefined) assertFrozenCommitteeProposal(state, input)
  if (input.target.kind === 'hire-approval') {
    const target = validateHireApprovalTarget(state, input.target.approval, input.committeeId, input.scopeId)
    if (input.body !== hireApprovalBody(target)) {
      deny('SIM_GOVERNANCE_PROPOSAL', 'Approval document must contain its complete exact single-hire purpose')
    }
  }
  parseSimTime(input.deadline, state.spec.maxTime)
  if (BigInt(input.deadline) <= BigInt(state.time)) deny('SIM_GOVERNANCE_TIME', 'A proposal deadline must follow its admission time')
  const members = electorate(state, input.committeeId, input.scopeId)
  if (input.quorum > members.length || input.rule.kind === 'absolute-threshold' && input.rule.yes > members.length) {
    deny('SIM_GOVERNANCE_ELECTORATE', 'Voting quorum and threshold must be attainable')
  }
  return simulationGovernanceProposalSchema.parse({ ...input, id, revision: 1, bodyHash: governanceBodyHash(input.body),
    proposer: identity.actor, source: identity.source, electorate: members, time: state.time, sequence })
}
function proposalVotes(governance: SimulationGovernanceState, proposal: SimulationGovernanceProposal): SimulationGovernanceVote[] {
  const votes = Object.values(governance.votes).filter(value => value.proposalId === proposal.id)
  const byActor = new Map(votes.map(value => [value.voter, value]))
  if (byActor.size !== votes.length || votes.some(value => !proposal.electorate.some(member => member.entityId === value.voter)
    || value.proposalRevision !== proposal.revision || value.bodyHash !== proposal.bodyHash)) {
    deny('SIM_GOVERNANCE_INTEGRITY', 'Vote projection differs from its frozen proposal or unique electorate')
  }
  return proposal.electorate.flatMap((member) => { const vote = byActor.get(member.entityId); return vote === undefined ? [] : [vote] })
}
function originalResolution(governance: SimulationGovernanceState,
  proposalId: WorldProposalId): SimulationGovernanceResolution | undefined {
  return Object.values(governance.resolutions).find(value => value.proposalId === proposalId)
}
function consumedProposalMaterial(context: Extract<SimulationDecision['context'], { status: 'prepared' }>,
  proposal: SimulationGovernanceProposal): boolean {
  const material = governanceProposalMaterial(proposal)
  return context.view.content.some(section => section.blocks.some((block) => {
    if (block.type !== 'text') return false
    let value: unknown
    try { value = JSON.parse(block.text) }
    catch { return false /* Ordinary non-JSON sections carry no authoritative proposal material. */ }
    if (typeof value !== 'object' || value === null || !('kind' in value) || value.kind !== 'world-context'
      || !('governance' in value) || !Array.isArray(value.governance)) return false
    return value.governance.some(candidate => isDeepStrictEqual(candidate, material))
  }))
}
/** Derive a scoped proxy grant/revocation from the principal's actual accepted request.
 * @param state - Accepted Native decision state.
 * @param operation - Original principal-owned delegate-vote request.
 * @param sequence - Exact append position.
 * @returns immutable grant or revocation; no identity is accepted from model input.
 */
export function prepareGovernanceDelegation(state: SimulationSnapshot, operation: SimulationOperation,
  sequence: number): ReturnType<typeof simulationGovernanceDelegationSchema.parse> {
  const identity = originalOperation(state, operation, 'delegate-vote', false)
  const input = simulationGovernanceDelegationInputSchema.parse(identity.payload)
  const proposal = state.world?.governance.proposals[input.proposalId]
  const original = state.world?.governance.delegations?.find(value => value.source.operationId === operation.id)
  if (original !== undefined) return original
  originalOperation(state, operation, 'delegate-vote', true)
  validateDelegation(state, identity.actor, input)
  if (proposal === undefined) deny('SIM_GOVERNANCE_PROPOSAL', 'Delegation requires its original proposal')
  const value = { ...input, id: `governance-delegation:${businessFingerprint([state.spec.runId, operation.id]).slice(7)}`,
    principal: identity.actor, source: identity.source, time: state.time, sequence }
  return simulationGovernanceDelegationSchema.parse({ ...value, hash: businessFingerprint(value) })
}
function validateDelegation(state: SimulationSnapshot, principal: SimulationEntityId,
  input: ReturnType<typeof simulationGovernanceDelegationInputSchema.parse>): void {
  const proposal = state.world?.governance.proposals[input.proposalId]
  if (proposal === undefined || proposal.bodyHash !== input.bodyHash || proposal.revision !== input.proposalRevision
    || !proposal.electorate.some(member => member.entityId === principal)
    || !proposal.electorate.some(member => member.entityId === input.delegateId) || principal === input.delegateId)
    deny('SIM_GOVERNANCE_VOTE', 'Delegation requires distinct principals within the original frozen electorate and exact document')
  if (BigInt(input.expiresAt) > BigInt(proposal.deadline) || BigInt(input.expiresAt) <= BigInt(state.time))
    deny('SIM_GOVERNANCE_TIME', 'Delegation expiry must lie in the remaining proposal interval')
  if (state.world !== undefined && originalResolution(state.world.governance, proposal.id) !== undefined)
    deny('SIM_GOVERNANCE_CLOSED', 'Resolved proposals cannot change proxy authority')
}
function ballotPrincipal(governance: SimulationGovernanceState, actor: SimulationEntityId,
  input: ReturnType<typeof simulationGovernanceVoteInputSchema.parse>, time: string, sequence: number): SimulationEntityId {
  if (input.delegationId === undefined) return actor
  const grant = governance.delegations?.find(value => value.id === input.delegationId)
  if (grant === undefined || grant.revoked || grant.delegateId !== actor || grant.proposalId !== input.proposalId
    || grant.proposalRevision !== input.proposalRevision || grant.bodyHash !== input.bodyHash
    || grant.sequence >= sequence || BigInt(grant.expiresAt) <= BigInt(time)
    || governance.delegations?.some(value => value.principal === grant.principal && value.proposalId === grant.proposalId
      && value.sequence > grant.sequence && value.sequence < sequence))
    deny('SIM_GOVERNANCE_VOTE', 'Proxy grant is missing, out of scope, revoked, superseded or expired')
  return grant.principal
}
/** Freeze the exact route before any member proposal has accepted a ballot.
 * @param state - Native accepted request prefix.
 * @param operation - Original actual actor operation.
 * @param sequence - Native append cursor.
 * @returns immutable definition with full original electorates, thresholds and deadlines.
 */
export function prepareGovernanceRoute(state: SimulationSnapshot, operation: SimulationOperation,
  sequence: number): SimulationReviewRouteDefinition {
  const identity = originalOperation(state, operation, 'define-review-route', false)
  const input = simulationReviewRouteDefinitionInputSchema.parse(identity.payload)
  const previous = state.world?.governance.routes?.[input.id]
  if (previous !== undefined) {
    if (previous.source.operationId !== operation.id) deny('SIM_GOVERNANCE_PROPOSAL', 'Route identity already belongs to another original')
    return previous
  }
  originalOperation(state, operation, 'define-review-route', true)
  const proposals = routeProposals(state, input, identity.actor)
  const value = { ...input, proposals, proposer: identity.actor, source: identity.source, time: state.time, sequence }
  return simulationReviewRouteDefinitionSchema.parse({ ...value, hash: businessFingerprint(value) })
}
function routeProposals(state: SimulationSnapshot, input: SimulationReviewRouteDefinitionInput,
  actorId: SimulationEntityId): SimulationGovernanceProposal[] {
  const governance = ownedGovernance(state), members = new Set<string>()
  if (governance.routes?.[input.id] !== undefined || BigInt(input.deadline) <= BigInt(state.time))
    deny('SIM_GOVERNANCE_PROPOSAL', 'Route requires a fresh identity and future deadline')
  let first: SimulationGovernanceProposal | undefined
  return input.steps.map((step) => {
    const proposal = governance.proposals[step.proposalId]
    if (proposal === undefined || proposal.revision !== step.proposalRevision || proposal.bodyHash !== input.bodyHash
      || proposal.reviewRoute !== undefined || BigInt(proposal.deadline) < BigInt(input.deadline)
      || proposalVotes(governance, proposal).length !== 0 || originalResolution(governance, proposal.id) !== undefined
      || Object.values(governance.routes ?? {}).some(route => route.steps.some(value => value.proposalId === proposal.id)))
      deny('SIM_GOVERNANCE_PROPOSAL', 'Route requires distinct unvoted original proposals with sufficient voting deadlines')
    if (!currentWorldOperationGrants(state, actorId, WORLD_GOVERNANCE_ROUTE_PIN, proposal.scopeId, proposal.committeeId).length)
      deny('SIM_GOVERNANCE_SOURCE', 'Route creation requires explicit authority for every participating committee')
    first ??= proposal
    if (proposal.scopeId !== first.scopeId || proposal.body !== first.body || !isDeepStrictEqual(proposal.target, first.target))
      deny('SIM_GOVERNANCE_PROPOSAL', 'Route steps must approve one exact document, target and scope')
    for (const member of proposal.electorate) {
      if (members.has(member.entityId)) deny('SIM_GOVERNANCE_ELECTORATE', 'Route cannot repeat an approver across committees')
      members.add(member.entityId)
    }
    return proposal
  })
}
function assertRouteBallot(state: SimulationSnapshot, proposal: SimulationGovernanceProposal,
  identity: ReturnType<typeof originalOperation>, time: string, sequence: number): void {
  const route = Object.values(state.world?.governance.routes ?? {}).find(value => value.steps.some(step => step.proposalId === proposal.id))
  if (route === undefined) return
  if (route.sequence >= sequence || route.sequence > identity.decision.snapshotRevision || BigInt(time) >= BigInt(route.deadline))
    deny('SIM_GOVERNANCE_TIME', 'Ballot is outside its original route prefix or voting interval')
  const material = governanceRouteMaterial(route)
  const consumed = identity.context.view.content.some(section => section.blocks.some((block) => {
    if (block.type !== 'text') return false
    let value: unknown
    try { value = JSON.parse(block.text) }
    catch { return false /* Non-JSON prose contains no authoritative route material. */ }
    return typeof value === 'object' && value !== null && 'governanceRoutes' in value && Array.isArray(value.governanceRoutes)
      && value.governanceRoutes.some(item => isDeepStrictEqual(item, material))
  }))
  if (!consumed)
    deny('SIM_GOVERNANCE_SOURCE', 'Ballot did not consume its original route contract')
  const index = route.steps.findIndex(value => value.proposalId === proposal.id)
  const step = route.steps[index], previous = route.steps[index - 1]
  if (step === undefined) deny('SIM_GOVERNANCE_PROPOSAL', 'Route lost its original proposal step')
  for (const dependency of [...step.dependsOn, ...route.mode === 'ordered' && previous !== undefined ? [previous.id] : []]) {
    const source = route.steps.find(value => value.id === dependency)
    const resolution = source === undefined ? undefined : Object.values(state.world?.governance.resolutions ?? {})
      .find(value => value.proposalId === source.proposalId)
    if (resolution?.outcome !== 'passed' || resolution.sequence >= sequence || resolution.sequence > identity.decision.snapshotRevision)
      deny('SIM_GOVERNANCE_PENDING', 'Ordered route dependencies must pass before the dependent ballot context is prepared')
  }
}
/**
 * Admit a vote from an actual accepted decision rather than any input actor declaration.
 * @param state - Accepted Native decision batch with its still-current canonical writer.
 * @param governance - Authoritative frozen proposals and prior original votes.
 * @param operation - Exact accepted governance.vote request, with no model-selected voter.
 * @param sequence - Candidate append position within the same decision acceptance batch.
 * @returns original retry or a complete independent vote for atomic retention.
 */
export function prepareGovernanceVote(state: SimulationSnapshot, governance: SimulationGovernanceState,
  operation: SimulationOperation, sequence: number): SimulationGovernanceVote {
  const identity = originalOperation(state, operation, 'vote', false)
  const input = simulationGovernanceVoteInputSchema.parse(identity.payload), proposal = lookup(governance.proposals, input.proposalId)
  if (proposal === undefined || input.proposalRevision !== proposal.revision || input.bodyHash !== proposal.bodyHash) {
    deny('SIM_GOVERNANCE_PROPOSAL', 'Vote must reference the exact original proposal revision and document hash')
  }
  const retainedVote = Object.values(governance.votes).find(value => value.source.operationId === operation.id)
  assertRouteBallot(state, proposal, identity, retainedVote?.time ?? state.time, retainedVote?.sequence ?? sequence)
  const principal = ballotPrincipal(governance, identity.actor, input, retainedVote?.time ?? state.time, retainedVote?.sequence ?? sequence)
  const member = proposal.electorate.find(value => value.entityId === principal)
  if (member === undefined || input.delegationId === undefined && !isDeepStrictEqual(member.binding, identity.source.binding)) {
    deny('SIM_GOVERNANCE_VOTE', 'Only an original frozen committee actor may vote for itself')
  }
  const context = identity.context
  const selected = context.world?.governance
  if (proposal.sequence > identity.decision.snapshotRevision
    || !selected?.some(ref => ref.proposalId === proposal.id && ref.proposalRevision === proposal.revision
      && ref.bodyHash === proposal.bodyHash) || !consumedProposalMaterial(context, proposal)) {
    deny('SIM_GOVERNANCE_SOURCE', 'Vote proposal was absent from the original consumed Native-selected material')
  }
  const id = worldVoteIdSchema.parse(`governance-vote:${businessFingerprint([state.spec.runId, proposal.id, principal]).slice(7)}`)
  const original = lookup(governance.votes, id)
  if (original !== undefined) {
    if (original.choice !== input.choice || !isDeepStrictEqual(original.source, identity.source)) {
      deny('SIM_GOVERNANCE_VOTE', 'A frozen actor already voted; a changed choice or source needs a new proposal')
    }
    return original
  }
  originalOperation(state, operation, 'vote', true)
  if (originalResolution(governance, proposal.id) !== undefined) deny('SIM_GOVERNANCE_CLOSED', 'Proposal already has its sole original resolution')
  if (BigInt(state.time) >= BigInt(proposal.deadline)) deny('SIM_GOVERNANCE_TIME', 'Voting admission closes at the exact proposal deadline')
  const value = { ...input, id, voter: principal, source: identity.source, time: state.time, sequence }
  return simulationGovernanceVoteSchema.parse({ ...value, hash: businessFingerprint(value) })
}
/**
 * Determine a unique resolution only after all votes, an irreversible result, or a settled deadline.
 * @param state - Current Native projection; no open decision window may be closed around.
 * @param governance - Original proposal and independently accepted vote receipts.
 * @param proposalId - Exact frozen proposal to resolve.
 * @param sequence - Candidate resolution append position.
 * @returns original resolution retry or complete deterministic resolution and wake identity.
 */
export function prepareGovernanceClose(state: SimulationSnapshot, governance: SimulationGovernanceState,
  proposalId: WorldProposalId, sequence: number): SimulationGovernanceResolution {
  const prior = originalResolution(governance, proposalId)
  if (prior !== undefined) return prior
  const proposal = lookup(governance.proposals, proposalId)
  if (proposal === undefined) deny('SIM_GOVERNANCE_PROPOSAL', 'Cannot resolve an absent proposal')
  if (state.activeWindowId !== undefined) deny('SIM_GOVERNANCE_PENDING', 'Governance closure waits for the current decision window to settle')
  const votes = proposalVotes(governance, proposal)
  const { counts, outcome: result, earlyClosure } = governanceVoteTally(proposal, votes)
  const closure = BigInt(state.time) >= BigInt(proposal.deadline) ? 'deadline' : earlyClosure
  if (closure === undefined) deny('SIM_GOVERNANCE_PENDING', 'Remaining legal votes can still change the resolution')
  const id = worldResolutionIdSchema.parse(`governance-resolution:${businessFingerprint([state.spec.runId, proposal.id]).slice(7)}`)
  const value = { proposalId: proposal.id, proposalRevision: proposal.revision, bodyHash: proposal.bodyHash,
    id, outcome: result, closure, votes: votes.map(value => ({ id: value.id, hash: value.hash })), counts,
    wakeId: simulationEventIdSchema.parse(`simulation-governance-resolution:${id}`), time: state.time, sequence }
  return simulationGovernanceResolutionSchema.parse({ ...value, hash: businessFingerprint(value) })
}
/**
 * Fold one strict record by reconstructing all derived fields from current Native originals.
 * @param state - Prior append projection with accepted decision/operation relationships intact.
 * @param governance - Prior Native governance state; not an external database or unchecked patch.
 * @param record - Complete strict record at the owned acceptance/mutation boundary.
 * @param sequence - Exact next Native cursor.
 * @returns immutable governance projection; caller retains it in the sole Native snapshot.
 */
export function foldWorldGovernance(state: SimulationSnapshot, governance: SimulationGovernanceState,
  record: WorldGovernanceRecord, sequence: number): SimulationGovernanceState {
  const parsed = worldGovernanceRecordSchema.parse(record)
  const retained = parsed.kind === 'world/governance-proposed' ? parsed.proposal
    : parsed.kind === 'world/governance-voted' ? parsed.vote : parsed.resolution
  if (sequence !== state.revision + 1 || retained.sequence !== sequence) {
    deny('SIM_GOVERNANCE_INTEGRITY', 'Governance record lost its exact Native append cursor')
  }
  switch (parsed.kind) {
    case 'world/governance-proposed': {
      const operation = lookup(state.operations, parsed.proposal.source.operationId)
      if (operation === undefined) deny('SIM_GOVERNANCE_SOURCE', 'Proposal lost its accepted source operation')
      const expected = prepareGovernanceProposal(state, governance, operation, sequence)
      if (!isDeepStrictEqual(expected, parsed.proposal)) deny('SIM_GOVERNANCE_INTEGRITY', 'Proposal altered its derived source, electorate, body or rules')
      return { ...governance, proposals: { ...governance.proposals, [expected.id]: expected } }
    }
    case 'world/governance-voted': {
      const operation = lookup(state.operations, parsed.vote.source.operationId)
      if (operation === undefined) deny('SIM_GOVERNANCE_SOURCE', 'Vote lost its accepted source operation')
      const expected = prepareGovernanceVote(state, governance, operation, sequence)
      if (!isDeepStrictEqual(expected, parsed.vote)) deny('SIM_GOVERNANCE_INTEGRITY', 'Vote altered its derived canonical voter or original choice')
      return { ...governance, votes: { ...governance.votes, [expected.id]: expected } }
    }
    case 'world/governance-closed': {
      const expected = prepareGovernanceClose(state, governance, parsed.resolution.proposalId, sequence)
      if (!isDeepStrictEqual(expected, parsed.resolution)) deny('SIM_GOVERNANCE_INTEGRITY', 'Resolution altered its independent receipts, outcome or wake')
      return { ...governance, resolutions: { ...governance.resolutions, [expected.id]: expected } }
    }
    default: return assertNever(parsed)
  }
}
/**
 * Derive the exact resolution announcement responsibility for the same Native append batch.
 * @param state - Resolution-retaining Native projection, before the scheduler record is appended.
 * @param governance - Complete governance projection containing this original resolution.
 * @param resolution - Original accepted resolution; caller cannot invent its recipient or content.
 * @returns zero records for an original queued wake, otherwise one exact bounded queue record.
 */
export function governanceResolutionWakeRecords(state: SimulationSnapshot, governance: SimulationGovernanceState,
  resolution: SimulationGovernanceResolution): SchedulerRecord[] {
  if (!isDeepStrictEqual(lookup(governance.resolutions, resolution.id), resolution)) {
    deny('SIM_GOVERNANCE_INTEGRITY', 'Resolution wake requires its exact retained resolution')
  }
  const proposal = lookup(governance.proposals, resolution.proposalId)
  if (proposal === undefined) deny('SIM_GOVERNANCE_INTEGRITY', 'Resolution wake lost its original proposal')
  const action = { kind: 'wake' as const, entityId: proposal.proposer,
    reason: JSON.stringify({ kind: 'governance-resolution', proposalId: proposal.id, resolutionId: resolution.id, hash: resolution.hash }) }
  const prior = lookup(state.scheduledEvents, resolution.wakeId)
  if (prior !== undefined) {
    if (!isDeepStrictEqual(prior.action, action) || prior.key.time !== resolution.time) {
      deny('SIM_GOVERNANCE_INTEGRITY', 'Resolution wake identity retains a different original responsibility')
    }
    return []
  }
  return [{ kind: 'event/queued', id: resolution.wakeId, key: allocateEventKey(state, resolution.time, action), action }]
}

/**
 * Verify retained governance against its exact accepted sources, independent vote hashes and pending wakes.
 * @param state - Complete Native projection after a whole append batch or before writable restoration.
 * @returns nothing for an intact history; summaries, forged receipts or missing announcement responsibility reject.
 */
export function assertWorldGovernanceProjection(state: SimulationSnapshot): void {
  if (state.world === undefined) return
  const governance = state.world.governance
  if (!Object.hasOwn(state.world, 'governance')) deny('SIM_GOVERNANCE_INTEGRITY', 'World projection omitted its governance history')
  const sourceRequest = (source: SimulationGovernanceVote['source'], sequence: number) => {
    const request = Object.values(state.world?.requests ?? {}).find(value => value.operationId === source.operationId)
    if (request === undefined || request.sequence !== sequence || worldDecisionSource(request).decisionId !== source.decisionId
      || worldDecisionSource(request).epoch !== source.epoch || !isDeepStrictEqual(worldDecisionSource(request).binding, source.binding)) {
      deny('SIM_GOVERNANCE_INTEGRITY', 'Governance record lost its original accepted request position or source')
    }
  }
  for (const [id, raw] of Object.entries(governance.routes ?? {})) {
    const route = simulationReviewRouteDefinitionSchema.parse(raw), operation = state.operations[route.source.operationId]
    if (operation === undefined) deny('SIM_GOVERNANCE_SOURCE', 'Route lost its original accepted operation')
    const identity = originalOperation(state, operation, 'define-review-route', false)
    const { proposals, proposer, source, time, sequence, hash, ...input } = route
    simulationReviewRouteDefinitionInputSchema.parse(input)
    if (id !== route.id || proposer !== identity.actor || !isDeepStrictEqual(source, identity.source)
      || !isDeepStrictEqual(input, simulationReviewRouteDefinitionInputSchema.parse(identity.payload))
      || hash !== businessFingerprint({ ...input, proposals, proposer, source, time, sequence })
      || sequence > state.revision || BigInt(time) >= BigInt(route.deadline)
      || route.steps.length !== proposals.length || route.steps.some((step, index) => {
      const proposal = proposals[index]
      return proposal?.id !== step.proposalId || proposal.revision !== step.proposalRevision
          || proposal.bodyHash !== route.bodyHash || !isDeepStrictEqual(governance.proposals[step.proposalId], proposal)
          || proposal.sequence >= sequence || BigInt(proposal.deadline) < BigInt(route.deadline)
          || Object.values(governance.votes).some(value => value.proposalId === proposal.id && value.sequence <= sequence)
    })) deny('SIM_GOVERNANCE_INTEGRITY', 'Route lost its original pre-ballot definition or frozen electorate')
    sourceRequest(source, sequence)
  }
  const delegationIds = new Set<string>()
  for (const raw of governance.delegations ?? []) {
    const grant = simulationGovernanceDelegationSchema.parse(raw), operation = state.operations[grant.source.operationId]
    if (operation === undefined) deny('SIM_GOVERNANCE_SOURCE', 'Delegation lost its accepted operation')
    const identity = originalOperation(state, operation, 'delegate-vote', false)
    const { id, principal, source, time, sequence, hash, ...input } = grant
    if (delegationIds.has(id) || id !== `governance-delegation:${businessFingerprint([state.spec.runId, operation.id]).slice(7)}`
      || principal !== identity.actor || !isDeepStrictEqual(source, identity.source)
      || !isDeepStrictEqual(input, simulationGovernanceDelegationInputSchema.parse(identity.payload))
      || hash !== businessFingerprint({ ...input, id, principal, source, time, sequence }) || sequence > state.revision)
      deny('SIM_GOVERNANCE_INTEGRITY', 'Delegation lost its original source, scope, identity or hash')
    sourceRequest(source, sequence)
    const proposal = governance.proposals[grant.proposalId]
    if (proposal === undefined || proposal.sequence >= sequence || proposal.bodyHash !== grant.bodyHash
      || proposal.revision !== grant.proposalRevision || !proposal.electorate.some(member => member.entityId === principal)
      || !proposal.electorate.some(member => member.entityId === grant.delegateId) || principal === grant.delegateId
      || BigInt(time) >= BigInt(grant.expiresAt) || BigInt(grant.expiresAt) > BigInt(proposal.deadline))
      deny('SIM_GOVERNANCE_INTEGRITY', 'Delegation lost its frozen electorate or valid interval')
    delegationIds.add(id)
  }
  for (const [key, raw] of Object.entries(governance.proposals)) {
    const proposal = simulationGovernanceProposalSchema.parse(raw), operation = lookup(state.operations, proposal.source.operationId)
    if (operation === undefined) deny('SIM_GOVERNANCE_INTEGRITY', 'Proposal source operation is missing')
    const expected = prepareGovernanceProposal(state, governance, operation, proposal.sequence)
    sourceRequest(proposal.source, proposal.sequence)
    if (key !== proposal.id || !isDeepStrictEqual(proposal, expected) || proposal.bodyHash !== governanceBodyHash(proposal.body)
      || proposal.sequence > state.revision || BigInt(proposal.time) >= BigInt(proposal.deadline)
      || proposal.electorate.some(member => !isDeepStrictEqual(lookup(state.entities, member.entityId)?.binding, member.binding)
        || BigInt(member.membership.validFrom) > BigInt(proposal.time)
        || member.membership.validUntil !== null && BigInt(member.membership.validUntil) <= BigInt(proposal.time))) {
      deny('SIM_GOVERNANCE_INTEGRITY', 'Proposal lost its original text, source, frozen electorate or admission time')
    }
    proposalVotes(governance, proposal)
  }
  for (const [key, raw] of Object.entries(governance.votes)) {
    const vote = simulationGovernanceVoteSchema.parse(raw), operation = lookup(state.operations, vote.source.operationId)
    const proposal = lookup(governance.proposals, vote.proposalId)
    if (operation === undefined || proposal === undefined) deny('SIM_GOVERNANCE_INTEGRITY', 'Vote lost its original source or proposal')
    const expected = prepareGovernanceVote(state, governance, operation, vote.sequence), { hash, ...body } = vote
    sourceRequest(vote.source, vote.sequence)
    if (key !== vote.id || !isDeepStrictEqual(vote, expected) || hash !== businessFingerprint(body)
      || vote.sequence <= proposal.sequence || vote.sequence > state.revision || BigInt(vote.time) < BigInt(proposal.time)
      || BigInt(vote.time) >= BigInt(proposal.deadline)) {
      deny('SIM_GOVERNANCE_INTEGRITY', 'Vote lost its unique canonical original, hash or open proposal interval')
    }
  }
  const resolved = new Set<WorldProposalId>()
  for (const [key, raw] of Object.entries(governance.resolutions)) {
    const resolution = simulationGovernanceResolutionSchema.parse(raw), proposal = lookup(governance.proposals, resolution.proposalId)
    if (proposal === undefined || resolved.has(proposal.id)) deny('SIM_GOVERNANCE_INTEGRITY', 'Resolution lost its unique frozen proposal')
    resolved.add(proposal.id)
    const { activeWindowId: _window, ...settledState } = state
    const original = prepareGovernanceClose({ ...settledState, time: resolution.time },
      { ...governance, resolutions: {} }, proposal.id, resolution.sequence)
    if (key !== resolution.id || !isDeepStrictEqual(resolution, original) || resolution.sequence > state.revision
      || resolution.sequence <= proposal.sequence || proposalVotes(governance, proposal).some(vote => vote.sequence >= resolution.sequence)
      || governanceResolutionWakeRecords(state, governance, resolution).length !== 0) {
      deny('SIM_GOVERNANCE_INTEGRITY', 'Resolution lost its actual receipts, determined outcome or exact announcement wake')
    }
  }
}

function ownedGovernance(state: SimulationSnapshot): SimulationGovernanceState {
  if (state.world === undefined) deny('SIM_GOVERNANCE_INTEGRITY', 'World must retain the original Native governance projection')
  return state.world.governance
}
function requestForIntent(state: SimulationSnapshot, intent: SimulationWorldIntent) {
  const world = state.world
  if (world === undefined) deny('SIM_GOVERNANCE_INTEGRITY', 'Governance request requires its original configured world')
  const request = intent.requestId === undefined ? undefined : lookup(world.requests, intent.requestId)
  if (request?.intentId !== intent.id) deny('SIM_GOVERNANCE_SOURCE', 'Governance acknowledgement lost its original request')
  return request
}
function proposalForIntent(state: SimulationSnapshot, intent: SimulationWorldIntent): SimulationGovernanceProposal {
  const request = requestForIntent(state, intent)
  const value = Object.values(ownedGovernance(state).proposals).find(value => value.source.operationId === request.operationId)
  if (value === undefined || value.proposer !== intent.requesterEntityId
    || !isDeepStrictEqual(simulationGovernanceProposalInputSchema.parse(intent.payload),
      simulationGovernanceProposalInputSchema.parse(request.proposal.payload))) {
    deny('SIM_GOVERNANCE_SOURCE', 'Proposal acknowledgement requires its original accepted contribution')
  }
  return value
}
function voteForIntent(state: SimulationSnapshot, intent: SimulationWorldIntent): SimulationGovernanceVote {
  const request = requestForIntent(state, intent)
  const value = Object.values(ownedGovernance(state).votes).find(value => value.source.operationId === request.operationId)
  if (value === undefined || state.decisions[value.source.decisionId]?.entityId !== intent.requesterEntityId
    || !isDeepStrictEqual(simulationGovernanceVoteInputSchema.parse(intent.payload),
      simulationGovernanceVoteInputSchema.parse(request.proposal.payload))) {
    deny('SIM_GOVERNANCE_SOURCE', 'Vote acknowledgement requires its original accepted independent contribution')
  }
  return value
}
function immediate(request: SimulationWorldDomainRequest): void {
  if (request.expectedTime !== null) deny('SIM_GOVERNANCE_TIME', 'Governance contributions are admitted at their actual decision boundary')
}

/** Installed proposal logic; Native freezes the electorate in its accepted request batch. */
export class GovernanceProposalNativeWorldDomain implements NativeWorldDomain {
  // This operation addresses its requester and non-person scope/target; it accepts no additional existing person.
  personnelSubjects(_intent: SimulationWorldIntent): readonly SimulationEntityId[] { return [] }

  readonly definition = WORLD_GOVERNANCE_PROPOSE_DEFINITION
  readonly ref = WORLD_GOVERNANCE_PROPOSE_PIN.implementationRef
  readonly generation = WORLD_GOVERNANCE_PROPOSE_PIN.generation
  /** Native owns this closed acceptance effect; the request cannot select a record or electorate. */
  readonly acceptedResponsibility = 'governance-proposal' as const

  goalContext(state: SimulationSnapshot, actorId: SimulationEntityId) {
    return z.json().parse({ kind: 'committee-proposal-policies',
      committees: frozenCommitteeProposalPolicies(state, actorId, WORLD_GOVERNANCE_PROPOSE_PIN) })
  }

  admitRequest(state: SimulationSnapshot, actorId: SimulationEntityId, request: SimulationWorldDomainRequest) {
    immediate(request)
    const payload = simulationGovernanceNormProposalInputSchema.parse(request.payload)
    assertReviewRoute(state, payload)
    if (request.evidence.length !== 0) deny('SIM_GOVERNANCE_PROPOSAL', 'Proposal freezes current committee facts without model-supplied authorization evidence')
    const id = worldProposalIdSchema.parse(`governance-proposal:${businessFingerprint([state.spec.runId, request.businessKey]).slice(7)}`)
    const original = lookup(ownedGovernance(state).proposals, id)
    if (original !== undefined) {
      const { id: _id, revision: _revision, bodyHash: _hash, proposer: _proposer, source: _source,
        electorate: _electorate, time: _time, sequence: _sequence, ...input } = original
      if (!isDeepStrictEqual(payload, input) || original.proposer !== actorId) {
        deny('SIM_GOVERNANCE_SOURCE', 'Proposal acknowledgement changed its original accepted contribution')
      }
      return { scopeEntityId: original.scopeId, targetEntityId: original.committeeId,
        description: original.body, payload: z.json().parse(payload) }
    }
    parseSimTime(payload.deadline, state.spec.maxTime)
    if (BigInt(payload.deadline) <= BigInt(state.time)) deny('SIM_GOVERNANCE_TIME', 'Proposal deadline must follow its actual admission')
    const members = electorate(state, payload.committeeId, payload.scopeId)
    if (payload.quorum > members.length || payload.rule.kind === 'absolute-threshold' && payload.rule.yes > members.length) {
      deny('SIM_GOVERNANCE_ELECTORATE', 'Proposal threshold and quorum must be attainable')
    }
    return { scopeEntityId: payload.scopeId, targetEntityId: payload.committeeId, description: payload.body,
      payload: z.json().parse(payload) }
  }

  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    return z.json().parse({ proposal: proposalForIntent(state, intent) })
  }

  validatePlan(state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution): void {
    proposalForIntent(state, intent)
    if (resolution.kind === 'apply') simulationGovernanceAcknowledgeSchema.parse(resolution.payload)
  }

  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const proposal = proposalForIntent(state, intent)
    return simulationWorldReadSetSchema.parse([{ kind: 'proposal', id: proposal.id, hash: proposal.bodyHash }])
  }

  reduceMutation(state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan, payload: SimulationWorldJsonValue) {
    if (plan.proposal.resolution.kind !== 'apply' || !isDeepStrictEqual(payload, plan.proposal.resolution.payload)) {
      deny('SIM_GOVERNANCE_SOURCE', 'Proposal acknowledgement must preserve its original apply payload')
    }
    simulationGovernanceAcknowledgeSchema.parse(payload)
    return { changes: [], resultPayload: z.json().parse({ proposalId: proposalForIntent(state, intent).id }) }
  }
}

/** Installed independent vote logic; director plans only acknowledge the already accepted choice. */
export class GovernanceVoteNativeWorldDomain implements NativeWorldDomain {
  // This operation addresses its requester and non-person scope/target; it accepts no additional existing person.
  personnelSubjects(_intent: SimulationWorldIntent): readonly SimulationEntityId[] { return [] }

  readonly definition = WORLD_GOVERNANCE_VOTE_DEFINITION
  readonly ref = WORLD_GOVERNANCE_VOTE_PIN.implementationRef
  readonly generation = WORLD_GOVERNANCE_VOTE_PIN.generation
  /** Closed Native acceptance effect whose voter always derives from the current actual decision. */
  readonly acceptedResponsibility = 'governance-vote' as const

  admitRequest(state: SimulationSnapshot, actorId: SimulationEntityId, request: SimulationWorldDomainRequest) {
    immediate(request)
    const payload = simulationGovernanceVoteInputSchema.parse(request.payload), owned = ownedGovernance(state)
    const proposal = lookup(owned.proposals, payload.proposalId)
    if (proposal === undefined || proposal.revision !== payload.proposalRevision || proposal.bodyHash !== payload.bodyHash) {
      deny('SIM_GOVERNANCE_PROPOSAL', 'Vote requires its exact original proposal revision and document')
    }
    if (request.evidence.some(ref => ref.kind !== 'proposal' || ref.id !== proposal.id || ref.hash !== proposal.bodyHash)
      || request.evidence.length > 1) deny('SIM_GOVERNANCE_PROPOSAL', 'Vote evidence may reference only its exact original proposal')
    const principal = ballotPrincipal(owned, actorId, payload, state.time, state.revision + 1)
    if (!proposal.electorate.some(member => member.entityId === principal)) deny('SIM_GOVERNANCE_VOTE', 'Only the frozen actual committee electorate may vote')
    const original = Object.values(owned.votes).find(value => value.proposalId === proposal.id && value.voter === principal)
    if (original !== undefined && original.choice !== payload.choice) deny('SIM_GOVERNANCE_VOTE', 'Changing a vote requires a new proposal')
    if (original === undefined) {
      if (originalResolution(owned, proposal.id) !== undefined) deny('SIM_GOVERNANCE_CLOSED', 'Proposal already resolved')
      if (BigInt(state.time) >= BigInt(proposal.deadline)) deny('SIM_GOVERNANCE_TIME', 'Voting closes at the exact deadline')
    }
    return { scopeEntityId: proposal.scopeId, targetEntityId: proposal.committeeId,
      description: `Vote on ${proposal.id}`, payload: z.json().parse(payload) }
  }

  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const vote = voteForIntent(state, intent), proposal = ownedGovernance(state).proposals[vote.proposalId]
    if (proposal === undefined) deny('SIM_GOVERNANCE_INTEGRITY', 'Vote planning context lost its frozen proposal')
    return z.json().parse({ proposal: governanceProposalMaterial(proposal), vote: { id: vote.id, choice: vote.choice } })
  }

  validatePlan(state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution): void {
    voteForIntent(state, intent)
    if (resolution.kind === 'apply') simulationGovernanceAcknowledgeSchema.parse(resolution.payload)
  }

  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const vote = voteForIntent(state, intent)
    return simulationWorldReadSetSchema.parse([{ kind: 'proposal', id: vote.proposalId, hash: vote.bodyHash }])
  }

  reduceMutation(state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan, payload: SimulationWorldJsonValue) {
    if (plan.proposal.resolution.kind !== 'apply' || !isDeepStrictEqual(payload, plan.proposal.resolution.payload)) {
      deny('SIM_GOVERNANCE_SOURCE', 'Vote acknowledgement must preserve its original apply payload')
    }
    simulationGovernanceAcknowledgeSchema.parse(payload)
    const vote = voteForIntent(state, intent)
    return { changes: [], resultPayload: z.json().parse({ proposalId: vote.proposalId, voteId: vote.id }) }
  }
}
function assertNever(value: never): never { throw new Error(`Unknown governance record: ${String(value)}`) }

/** Explicit proxy grant/revocation; authority is recorded at acceptance, independently of director acknowledgement. */
export class GovernanceDelegationNativeWorldDomain implements NativeWorldDomain {
  readonly definition = WORLD_GOVERNANCE_DELEGATE_DEFINITION
  readonly ref = WORLD_GOVERNANCE_DELEGATE_PIN.implementationRef
  readonly generation = WORLD_GOVERNANCE_DELEGATE_PIN.generation
  readonly acceptedResponsibility = 'governance-delegation' as const
  personnelSubjects(_intent: SimulationWorldIntent): readonly SimulationEntityId[] { return [] }
  admitRequest(state: SimulationSnapshot, actorId: SimulationEntityId, request: SimulationWorldDomainRequest) {
    immediate(request)
    const input = simulationGovernanceDelegationInputSchema.parse(request.payload)
    validateDelegation(state, actorId, input)
    const proposal = ownedGovernance(state).proposals[input.proposalId]
    if (proposal === undefined) deny('SIM_GOVERNANCE_PROPOSAL', 'Delegation lost its original proposal')
    return { scopeEntityId: proposal.scopeId, targetEntityId: proposal.committeeId,
      description: `Record proxy authority for ${proposal.id}`, payload: z.json().parse(input) }
  }
  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const request = requestForIntent(state, intent)
    const grant = ownedGovernance(state).delegations?.find(value => value.source.operationId === request.operationId)
    if (grant === undefined) deny('SIM_GOVERNANCE_SOURCE', 'Proxy acknowledgement lost its original grant')
    return z.json().parse({ delegation: grant })
  }
  validatePlan(state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution): void {
    this.planningContext(state, intent)
    if (resolution.kind === 'apply') simulationGovernanceAcknowledgeSchema.parse(resolution.payload)
  }
  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    this.planningContext(state, intent)
    const input = simulationGovernanceDelegationInputSchema.parse(intent.payload)
    return simulationWorldReadSetSchema.parse([{ kind: 'proposal', id: input.proposalId, hash: input.bodyHash }])
  }
  reduceMutation(state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan, payload: SimulationWorldJsonValue) {
    this.planningContext(state, intent)
    if (plan.proposal.resolution.kind !== 'apply' || !isDeepStrictEqual(payload, plan.proposal.resolution.payload))
      deny('SIM_GOVERNANCE_SOURCE', 'Proxy acknowledgement must retain the original payload')
    simulationGovernanceAcknowledgeSchema.parse(payload)
    return { changes: [], resultPayload: {} }
  }
}

/** Prospective route definitions are recorded by Native at accepted actor-request admission. */
export class GovernanceRouteNativeWorldDomain implements NativeWorldDomain {
  readonly definition = WORLD_GOVERNANCE_ROUTE_DEFINITION
  readonly ref = WORLD_GOVERNANCE_ROUTE_PIN.implementationRef
  readonly generation = WORLD_GOVERNANCE_ROUTE_PIN.generation
  readonly acceptedResponsibility = 'governance-route' as const
  goalContext(state: SimulationSnapshot, actorId: SimulationEntityId) {
    const governance = ownedGovernance(state)
    return z.json().parse({ kind: 'review-route-opportunities', proposals: Object.values(governance.proposals)
      .filter(proposal => currentWorldOperationGrants(state, actorId, WORLD_GOVERNANCE_ROUTE_PIN,
        proposal.scopeId, proposal.committeeId).length > 0
        && proposalVotes(governance, proposal).length === 0 && originalResolution(governance, proposal.id) === undefined
        && !Object.values(governance.routes ?? {}).some(route => route.steps.some(step => step.proposalId === proposal.id)))
      .map(governanceProposalMaterial) })
  }
  personnelSubjects(_intent: SimulationWorldIntent): readonly SimulationEntityId[] { return [] }
  admitRequest(state: SimulationSnapshot, actorId: SimulationEntityId, request: SimulationWorldDomainRequest) {
    immediate(request)
    const input = simulationReviewRouteDefinitionInputSchema.parse(request.payload), retained = ownedGovernance(state).routes?.[input.id]
    if (retained !== undefined) {
      const { proposals: _proposals, proposer, source: _source, time: _time, sequence: _sequence, hash: _hash, ...original } = retained
      if (proposer !== actorId || !isDeepStrictEqual(input, original)) deny('SIM_GOVERNANCE_SOURCE', 'Route command changed its original author or definition')
    }
    const proposals = retained?.proposals ?? routeProposals(state, input, actorId)
    const first = proposals[0]
    if (first === undefined) deny('SIM_GOVERNANCE_PROPOSAL', 'Route requires an original first step')
    return { scopeEntityId: first.scopeId, targetEntityId: first.committeeId, description: `Define review route ${input.id}`, payload: z.json().parse(input) }
  }
  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const request = requestForIntent(state, intent)
    const route = Object.values(ownedGovernance(state).routes ?? {}).find(value => value.source.operationId === request.operationId)
    if (route === undefined) deny('SIM_GOVERNANCE_SOURCE', 'Route acknowledgement lost its original definition')
    return z.json().parse({ reviewRoute: governanceRouteMaterial(route) })
  }
  validatePlan(state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution): void {
    this.planningContext(state, intent)
    if (resolution.kind === 'apply') simulationGovernanceAcknowledgeSchema.parse(resolution.payload)
  }
  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    this.planningContext(state, intent)
    const input = simulationReviewRouteDefinitionInputSchema.parse(intent.payload)
    return simulationWorldReadSetSchema.parse(input.steps.map(step => ({ kind: 'proposal', id: step.proposalId, hash: input.bodyHash })))
  }
  reduceMutation(state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan, payload: SimulationWorldJsonValue) {
    this.planningContext(state, intent)
    if (plan.proposal.resolution.kind !== 'apply' || !isDeepStrictEqual(payload, plan.proposal.resolution.payload))
      deny('SIM_GOVERNANCE_SOURCE', 'Route acknowledgement must retain its original payload')
    simulationGovernanceAcknowledgeSchema.parse(payload)
    return { changes: [], resultPayload: {} }
  }
}
