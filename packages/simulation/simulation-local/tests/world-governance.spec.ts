import { marketFixture } from './world-hiring-market-fixture.ts'
import { NativeWorldRuntime } from '../src/world-runtime.ts'
import { NormEnactNativeWorldDomain, NormRevokeNativeWorldDomain } from '../src/world-norms.ts'
import type { NativeWorldDomain } from '@clocky/clocky-simulation'
/** Adversarial pure Native record tests; Loader/Agent acceptance coverage belongs to the composition suite. */
import { describe, expect, it } from 'vitest'
import type { SimulationContextViewEventData } from '@clocky/clocky-session'
import { simulationRunSpecSchema, simulationEntityIdSchema, simulationEntityBindingSchema, simulationWriterEpochSchema,
  simulationCoordinatorIdSchema, simulationDecisionIdSchema, simulationDecisionSlotSchema, simulationOperationIdSchema,
  simulationOperationSchema, simulationRelationIdSchema, simulationContextConsumptionHash, simTimeSchema,
  simulationGovernanceProposalInputSchema, simulationGovernanceProposalSchema, simulationGovernanceVoteInputSchema,
  governanceProposalMaterial, simulationWindowIdSchema, assertPreparedWorldScopeAccess,
  governanceEarlyClosure, governanceVoteTally, simulationReviewRouteSchema, governanceRouteMaterial, SimulationWorldDomainRegistry,
  WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN, WORLD_NORM_ENACT_PIN, WORLD_NORM_REVOKE_PIN, simulationWorldDomainPinSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationDecision, SimulationOperation, SimulationEntity, SimulationWorldContext,
  SimulationGovernanceState, SimulationGovernanceProposal, SimulationGovernanceVoteInput } from '@clocky/clocky-simulation'
import { activationReservationIdSchema } from '@clocky/clocky-team'
import { prepareGovernanceProposal, prepareGovernanceVote, prepareGovernanceClose, foldWorldGovernance,
  governanceResolutionWakeRecords, assertReviewRoute, prepareGovernanceRoute, prepareGovernanceDelegation, GovernanceProposalNativeWorldDomain, GovernanceVoteNativeWorldDomain } from '../src/world-governance.ts'
import { businessFingerprint } from '../src/business.ts'

function actor(name: string): SimulationEntity {
  return { id: simulationEntityIdSchema.parse(name), kind: 'person', cognition: 'agent', phase: 'active', readiness: 'ready',
    revision: 1, profileRevision: 1, profile: {},
    binding: simulationEntityBindingSchema.parse({ teamId: 'canonical-team', participantId: name, sessionId: `session:${name}` }),
    writer: { epoch: simulationWriterEpochSchema.parse('1'), coordinatorId: simulationCoordinatorIdSchema.parse('owner'),
      reservationId: activationReservationIdSchema.parse(`reservation:${name}`), provider: 'test', phase: 'active' } }
}
function base(members = ['alice', 'bob', 'carol']): SimulationSnapshot {
  const spec = simulationRunSpecSchema.parse({ runId: 'committee', tickUnit: 'minute', origin: '0', maxTime: '100000000000000000000',
    rulesVersion: '1', policyVersion: '1', relationRules: [], outboxMaxAttempts: 3, outboxRetryDelayMs: 10,
    maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000,
    maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000,
    tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000,
    maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32,
    maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 8,
    maxResourceReservationHistory: 128,
    maxResourceQuantity: '1000000' })
  const people = [...new Set(['ceo', 'outsider', ...members])].map(actor)
  const organization = ['scope', 'committee'].map((name) => {
    const { binding: _binding, writer: _writer, ...entity } = actor(name)
    return { ...entity, cognition: 'none' as const, kind: 'organization' }
  })
  return { spec, revision: 10, phase: 'running', time: simTimeSchema.parse('0'),
    entities: Object.fromEntries([...people, ...organization].map(value => [value.id, value])),
    relations: Object.fromEntries(members.map((name) => { const id = simulationRelationIdSchema.parse(`member:${name}`)
      return [id, { id, subject: simulationEntityIdSchema.parse(name), relation: 'committee-member',
        object: simulationEntityIdSchema.parse('committee'), scope: simulationEntityIdSchema.parse('scope'),
        validFrom: simTimeSchema.parse('0'), validUntil: null, revision: 1 }] })),
    nextDecisionSlot: simulationDecisionSlotSchema.parse('0'), decisions: {}, operations: {}, resources: {}, resourceReservations: {}, grants: {},
    interactions: {}, commitments: {}, nextEventSlot: '0' as SimulationSnapshot['nextEventSlot'], scheduledEvents: {}, wakes: {} }
}
function accepted(state: SimulationSnapshot, name: string, operationName: string, payload: unknown,
  proposal?: SimulationGovernanceProposal, suffix = ''): { state: SimulationSnapshot; operation: SimulationOperation } {
  const entity = state.entities[simulationEntityIdSchema.parse(name)]!, id = simulationDecisionIdSchema.parse(`${name}:${operationName}${suffix}`)
  const operationId = simulationOperationIdSchema.parse(`operation:${id}`), inputId = `input:${id}` as SimulationContextViewEventData['inputId']
  const selected = proposal === undefined ? []
    : [{ proposalId: proposal.id, proposalRevision: proposal.revision, bodyHash: proposal.bodyHash }]
  const view: SimulationContextViewEventData = { version: 1, runId: state.spec.runId, entityId: entity.id,
    windowId: `${id}:window` as SimulationContextViewEventData['windowId'], slot: simulationDecisionSlotSchema.parse('1'),
    epoch: entity.writer!.epoch, time: state.time, inputId, projections: { run: state.revision, entity: 1, team: 1 },
    versions: { rules: '1', policy: '1', persona: '1', model: '1' }, sources: [], content: [{ kind: 'goals',
      blocks: [{ type: 'text', text: JSON.stringify({ kind: 'world-context', governanceRoutes: Object.values(state.world?.governance.routes ?? {}).map(governanceRouteMaterial), governance: proposal === undefined ? [] : [governanceProposalMaterial(proposal)] }) }] }] }
  const world: SimulationWorldContext = { kind: 'goal', operations: [], baseRevision: state.revision, assignments: [], governance: selected }
  const decision: SimulationDecision = { id, entityId: entity.id, epoch: entity.writer!.epoch, slot: view.slot,
    snapshotRevision: state.revision, entityRevision: 1, time: state.time, status: 'accepted', operationIds: [operationId],
    context: { status: 'prepared', requiredSections: ['goals'], fingerprint: businessFingerprint(view), view,
      world, teamCursor: 1, maxBytes: 10000, retainedBytes: 1000, omitted: [] },
    consumption: { sessionId: entity.binding!.sessionId, inputId, contextHash: simulationContextConsumptionHash(view),
      viewSequence: 0, consumedSequence: 1 } }
  const action = simulationOperationSchema.parse({ kind: 'world/request', domain: 'governance', operation: operationName,
    version: '1', businessKey: `${id}:business`, expectedTime: null, evidence: [], payload })
  const operation: SimulationOperation = { id: operationId, decisionId: id, index: 0, entityId: entity.id, action,
    dependencies: [], fingerprint: businessFingerprint(action), status: 'pending' }
  return { state: { ...state, decisions: { ...state.decisions, [id]: decision },
    operations: { ...state.operations, [operationId]: operation } }, operation }
}
function proposalFixture(rule: { kind: 'unanimity' } | { kind: 'absolute-threshold'; yes: number } = { kind: 'absolute-threshold', yes: 2 },
  quorum = 2, members = ['alice', 'bob', 'carol']) {
  const empty: SimulationGovernanceState = { proposals: {}, votes: {}, resolutions: {} }
  const source = accepted(base(members), 'ceo', 'propose-norm', { committeeId: 'committee', scopeId: 'scope',
    body: '招聘需委员会批准。', target: { kind: 'norm', norm: { id: 'hiring', version: '1' } },
    policyRef: 'clocky.governance/1', rule, quorum, deadline: '10' })
  const proposal = prepareGovernanceProposal(source.state, empty, source.operation, source.state.revision + 1)
  const governance = foldWorldGovernance(source.state, empty, { kind: 'world/governance-proposed', proposal }, proposal.sequence)
  let state = { ...source.state, revision: proposal.sequence }, current = governance
  const vote = (actorName: string, choice: SimulationGovernanceVoteInput['choice'], suffix = '') => {
    const input = { proposalId: proposal.id, proposalRevision: proposal.revision, bodyHash: proposal.bodyHash, choice }
    const contribution = accepted(state, actorName, 'vote', input, proposal, suffix)
    const value = prepareGovernanceVote(contribution.state, current, contribution.operation, state.revision + 1)
    current = foldWorldGovernance(contribution.state, current, { kind: 'world/governance-voted', vote: value }, state.revision + 1)
    state = { ...contribution.state, revision: state.revision + 1 }
    return { value, contribution }
  }
  return { proposal, source, empty, vote, get state() { return state }, get governance() { return current },
    setState(next: SimulationSnapshot) { state = next } }
}

describe('Native committee records', () => {
  it('refuses an attached proposal body whose original disclosure witness is missing', () => {
    const h = proposalFixture(), contribution = accepted(h.state, 'alice', 'vote', {
      proposalId: h.proposal.id, proposalRevision: h.proposal.revision, bodyHash: h.proposal.bodyHash, choice: 'yes',
    }, h.proposal)
    const decision = contribution.state.decisions[contribution.operation.decisionId]!
    expect(() => { assertPreparedWorldScopeAccess(contribution.state, decision) }).toThrow(/governance body authority/)
  })

  it('freezes actual membership, original text, target version, rules and source at acceptance', () => {
    const h = proposalFixture()
    expect(h.proposal).toMatchObject({ revision: 1, body: '招聘需委员会批准。', target: { kind: 'norm', norm: { id: 'hiring', version: '1' } },
      proposer: 'ceo', policyRef: 'clocky.governance/1', rule: { kind: 'absolute-threshold', yes: 2 }, quorum: 2, deadline: '10' })
    expect(h.proposal.electorate.map(value => [value.entityId, value.membership.id, value.binding.sessionId])).toEqual([
      ['alice', 'member:alice', 'session:alice'], ['bob', 'member:bob', 'session:bob'], ['carol', 'member:carol', 'session:carol'] ])
    expect(prepareGovernanceProposal(h.state, h.governance, h.source.operation, 999)).toBe(h.governance.proposals[h.proposal.id])
    expect(() => foldWorldGovernance(h.source.state, h.empty, { kind: 'world/governance-proposed',
      proposal: { ...h.proposal, electorate: h.proposal.electorate.slice(0, 2) } }, h.proposal.sequence)).toThrow(/electorate/)
  })

  it.each([
    ['empty', [], { kind: 'unanimity' }, 1], ['quorum', ['alice'], { kind: 'unanimity' }, 2],
    ['threshold', ['alice'], { kind: 'absolute-threshold', yes: 2 }, 1],
  ] as const)('rejects %s unreachable electorate', (_name, members, rule, quorum) => {
    expect(() => proposalFixture(rule, quorum, [...members])).toThrow(/empty|attainable/)
  })

  it('rejects zero thresholds, duplicate electorate and model-selected identity fields', () => {
    const h = proposalFixture()
    if (h.source.operation.action.kind !== 'world/request') throw new Error('Fixture requires an original request')
    const payload = simulationGovernanceProposalInputSchema.parse(h.source.operation.action.payload)
    expect(() => simulationGovernanceProposalInputSchema.parse({ ...payload, quorum: 0 })).toThrow()
    expect(() => simulationGovernanceProposalSchema.parse({ ...h.proposal,
      electorate: [h.proposal.electorate[0], h.proposal.electorate[0]] })).toThrow(/distinct/)
    expect(() => simulationGovernanceVoteInputSchema.parse({ proposalId: h.proposal.id, proposalRevision: 1,
      bodyHash: h.proposal.bodyHash, choice: 'yes', voter: 'alice' })).toThrow(/voter/)
  })

  it('membership changes cannot grant a new voter or remove an original elector', () => {
    const h = proposalFixture()
    const changed = Object.fromEntries(Object.entries(h.state.relations).filter(([id]) => id !== 'member:alice'))
    h.setState({ ...h.state, relations: { ...changed, [simulationRelationIdSchema.parse('outsider')]: {
      id: simulationRelationIdSchema.parse('outsider'),
      subject: simulationEntityIdSchema.parse('outsider'), object: simulationEntityIdSchema.parse('committee'),
      scope: simulationEntityIdSchema.parse('scope'), relation: 'committee-member', revision: 1,
      validFrom: simTimeSchema.parse('0'), validUntil: null } } })
    expect(h.vote('alice', 'yes').value.voter).toBe('alice')
    expect(() => h.vote('outsider', 'yes')).toThrow(/frozen/)
    expect(h.proposal.electorate.map(value => value.entityId)).toEqual(['alice', 'bob', 'carol'])
  })

  it('retains the exact original vote after deadline and writer retirement; changed choice or source rejects', () => {
    const h = proposalFixture(), first = h.vote('alice', 'yes')
    const alice = h.state.entities[simulationEntityIdSchema.parse('alice')]!
    const later = { ...h.state, time: simTimeSchema.parse('10'), entities: { ...h.state.entities,
      [alice.id]: { ...alice, writer: { ...alice.writer!, phase: 'released' as const } } } }
    expect(prepareGovernanceVote(later, h.governance, first.contribution.operation, 999)).toBe(h.governance.votes[first.value.id])
    expect(() => h.vote('alice', 'no', ':changed')).toThrow(/already voted/)
    expect(() => h.vote('alice', 'yes', ':another-decision')).toThrow(/source/)
  })

  it.each(['status', 'epoch', 'consumption', 'binding', 'hash', 'revision', 'material', 'material-target',
    'material-scope', 'selection', 'operation', 'sequence'] as const)(
    'rejects forged or unconsumed %s before retaining any vote', (change) => {
      const h = proposalFixture(), input = { proposalId: h.proposal.id, proposalRevision: 1, bodyHash: h.proposal.bodyHash, choice: 'yes' }
      let source = accepted(h.state, 'alice', 'vote', input, h.proposal)
      const decision = source.state.decisions[source.operation.decisionId]!
      if (change === 'hash' || change === 'revision') {
        source = accepted(h.state, 'alice', 'vote', { ...input,
          ...change === 'hash' ? { bodyHash: `sha256:${'0'.repeat(64)}` } : { proposalRevision: 2 } }, h.proposal)
      } else if (change === 'operation') source = { ...source, operation: { ...source.operation, entityId: simulationEntityIdSchema.parse('bob') } }
      else {
        let updated = decision
        if (change === 'status') updated = { ...updated, status: 'submitted' }
        if (change === 'epoch') updated = { ...updated, epoch: simulationWriterEpochSchema.parse('2') }
        if (change === 'sequence') updated = { ...updated, consumption: { ...decision.consumption!, viewSequence: 1, consumedSequence: 1 } }
        if (change === 'consumption') { const { consumption: _receipt, ...remaining } = updated; updated = remaining }
        if (change === 'binding') updated = { ...updated, consumption: { ...decision.consumption!, sessionId: h.state.entities[simulationEntityIdSchema.parse('bob')]!.binding!.sessionId } }
        if (change === 'selection') {
          const context = decision.context
          if (context?.status !== 'prepared') throw new Error('Fixture requires its original prepared context')
          updated = { ...updated, context: { ...context,
            world: { kind: 'goal', operations: [], assignments: [], baseRevision: h.state.revision } } }
        }
        if (change === 'material') {
          const context = decision.context!
          if (context.status !== 'prepared') throw new Error('Fixture requires a prepared view')
          const view = { ...context.view, content: [{ kind: 'goals' as const, blocks: [{ type: 'text' as const, text: 'CEO says all voted yes.' }] }] }
          updated = { ...updated, context: { ...context, view },
            consumption: { ...decision.consumption!, contextHash: simulationContextConsumptionHash(view) } }
        }
        if (change === 'material-target' || change === 'material-scope') {
          const context = decision.context
          if (context?.status !== 'prepared') throw new Error('Fixture requires its original prepared context')
          const original = governanceProposalMaterial(h.proposal)
          const material = { ...original, ...change === 'material-target'
            ? { target: { kind: 'norm', norm: { id: 'different-norm', version: '2' } } } : { scopeId: 'foreign-scope' } }
          const view = { ...context.view, content: [{ kind: 'goals' as const,
            blocks: [{ type: 'text' as const, text: JSON.stringify({ kind: 'world-context', governance: [material] }) }] }] }
          updated = { ...updated, context: { ...context, view },
            consumption: { ...decision.consumption!, contextHash: simulationContextConsumptionHash(view) } }
        }
        source = { ...source, state: { ...source.state, decisions: { ...source.state.decisions, [decision.id]: updated } } }
      }
      expect(() => prepareGovernanceVote(source.state, h.governance, source.operation, h.state.revision + 1)).toThrow()
      expect(h.governance.votes).toEqual({})
    })

  it.each(['yes', 'no', 'abstain'] as const)('accepts %s strictly before deadline and rejects it at equality', (choice) => {
    const h = proposalFixture()
    h.setState({ ...h.state, time: simTimeSchema.parse('9') })
    expect(h.vote('alice', choice).value.time).toBe('9')
    h.setState({ ...h.state, time: simTimeSchema.parse('10') })
    expect(() => h.vote('bob', choice)).toThrow(/exact.*deadline/)
  })

  it.each([
    [{ kind: 'unanimity' }, 1, ['yes', 'yes', 'yes'], 'passed', 'all-voted'],
    [{ kind: 'unanimity' }, 1, ['no'], 'failed', 'determined'],
    [{ kind: 'unanimity' }, 1, ['abstain'], 'failed', 'determined'],
    [{ kind: 'absolute-threshold', yes: 2 }, 2, ['yes', 'yes'], 'passed', 'determined'],
    [{ kind: 'absolute-threshold', yes: 2 }, 3, ['yes', 'yes', 'abstain'], 'passed', 'all-voted'],
    [{ kind: 'absolute-threshold', yes: 2 }, 1, ['no', 'abstain'], 'failed', 'determined'],
    [{ kind: 'absolute-threshold', yes: 1 }, 3, ['yes', 'abstain', 'no'], 'passed', 'all-voted'],
  ] as const)('computes %j with quorum %s from independent actual receipts %j', (rule, quorum, choices, expected, closure) => {
    const h = proposalFixture(rule, quorum)
    for (const [index, choice] of choices.entries()) h.vote(['alice', 'bob', 'carol'][index]!, choice)
    const resolution = prepareGovernanceClose(h.state, h.governance, h.proposal.id, h.state.revision + 1)
    expect(resolution).toMatchObject({ outcome: expected, closure })
    expect(resolution.votes).toHaveLength(choices.length)
    expect(resolution.counts.missing).toBe(3 - choices.length)
    expect(governanceVoteTally(h.proposal, Object.values(h.governance.votes))).toMatchObject({
      outcome: resolution.outcome, earlyClosure: resolution.closure, counts: resolution.counts })
    expect(governanceEarlyClosure(h.state, h.governance, h.proposal.id)).toBe(closure)
    expect(governanceEarlyClosure({ ...h.state, phase: 'paused' }, h.governance, h.proposal.id)).toBeUndefined()
    expect(governanceEarlyClosure({ ...h.state, activeWindowId: simulationWindowIdSchema.parse('live') },
      h.governance, h.proposal.id)).toBeUndefined()
    expect(governanceEarlyClosure({ ...h.state, time: h.proposal.deadline }, h.governance, h.proposal.id)).toBeUndefined()
  })

  it('waits for any remaining vote that can alter pass or quorum, and counts abstention only for quorum', () => {
    const h = proposalFixture({ kind: 'absolute-threshold', yes: 1 }, 3)
    h.vote('alice', 'yes')
    h.vote('bob', 'abstain')
    expect(governanceEarlyClosure(h.state, h.governance, h.proposal.id)).toBeUndefined()
    expect(() => prepareGovernanceClose(h.state, h.governance, h.proposal.id, h.state.revision + 1)).toThrow(/Remaining/)
    h.setState({ ...h.state, time: simTimeSchema.parse('10') })
    expect(prepareGovernanceClose(h.state, h.governance, h.proposal.id, h.state.revision + 1)).toMatchObject({
      outcome: 'failed', closure: 'deadline', counts: { yes: 1, no: 0, abstain: 1, missing: 1 } })
  })

  it('cannot close around an unsettled decision window at the exact deadline', () => {
    const h = proposalFixture()
    h.setState({ ...h.state, time: simTimeSchema.parse('10'), activeWindowId: simulationWindowIdSchema.parse('live') })
    expect(() => prepareGovernanceClose(h.state, h.governance, h.proposal.id, h.state.revision + 1)).toThrow(/window/)
    const { activeWindowId: _window, ...settled } = h.state
    h.setState(settled)
    expect(prepareGovernanceClose(h.state, h.governance, h.proposal.id, h.state.revision + 1).outcome).toBe('failed')
  })

  it('rejects forged Native vote receipts and resolution outcomes; original close and wake are unique', () => {
    const h = proposalFixture(), vote = h.vote('alice', 'yes')
    expect(() => foldWorldGovernance(vote.contribution.state, { ...h.governance, votes: {} }, { kind: 'world/governance-voted',
      vote: { ...vote.value, voter: simulationEntityIdSchema.parse('bob') } }, vote.value.sequence)).toThrow(/canonical voter/)
    h.vote('bob', 'yes')
    const resolution = prepareGovernanceClose(h.state, h.governance, h.proposal.id, h.state.revision + 1)
    expect(() => foldWorldGovernance(h.state, h.governance, { kind: 'world/governance-closed', resolution: { ...resolution,
      outcome: 'failed' } }, resolution.sequence)).toThrow(/Resolution altered/)
    const settled = foldWorldGovernance(h.state, h.governance, { kind: 'world/governance-closed', resolution }, resolution.sequence)
    expect(() => foldWorldGovernance({ ...h.state, revision: resolution.sequence }, settled,
      { kind: 'world/governance-closed', resolution }, resolution.sequence + 1)).toThrow(/append cursor/)
    expect(prepareGovernanceClose({ ...h.state, time: simTimeSchema.parse('100') }, settled, h.proposal.id, 999)).toBe(settled.resolutions[resolution.id])
    const records = governanceResolutionWakeRecords({ ...h.state, revision: resolution.sequence }, settled, resolution)
    expect(records).toHaveLength(1)
    const queued = records[0]!
    if (queued.kind !== 'event/queued') throw new Error('Expected exact queued wake')
    expect(queued.action).toMatchObject({ kind: 'wake', entityId: 'ceo' })
    const withWake = { ...h.state, scheduledEvents: { [queued.id]: { id: queued.id, key: queued.key, action: queued.action, status: 'pending' as const } } }
    expect(governanceResolutionWakeRecords(withWake, settled, resolution)).toEqual([])
    const late = accepted(h.state, 'carol', 'vote', { proposalId: h.proposal.id, proposalRevision: 1, bodyHash: h.proposal.bodyHash, choice: 'yes' }, h.proposal)
    expect(() => prepareGovernanceVote(late.state, settled, late.operation, late.state.revision + 1)).toThrow(/sole original resolution/)
  })
})

describe('frozen composite routes and explicit proxy authority', () => {
  it('checks a complete route against actual votes and rejects changed text, omitted steps, cycles and copied hashes', async () => {
    const h = proposalFixture({ kind: 'unanimity' }, 1, ['alice'])
    const definitionInput = { id: 'route', revision: 1, mode: 'and', membershipPolicy: 'frozen',
      bodyHash: h.proposal.bodyHash, deadline: h.proposal.deadline,
      steps: [{ id: 'review', proposalId: h.proposal.id, proposalRevision: 1, dependsOn: [] }] }
    const donor = marketFixture(), originalWorld = donor.state.world!
    await donor.close()
    const relation = { id: simulationRelationIdSchema.parse('route-authority'), subject: simulationEntityIdSchema.parse('ceo'),
      relation: 'can-route', object: simulationEntityIdSchema.parse('committee'), scope: simulationEntityIdSchema.parse('scope'),
      validFrom: simTimeSchema.parse('0'), validUntil: null, revision: 1 }
    const routeState: SimulationSnapshot = { ...h.state, relations: { ...h.state.relations, [relation.id]: relation },
      spec: { ...h.state.spec, relationRules: [...h.state.spec.relationRules, { relation: 'can-route', subjectKinds: ['person'],
        objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }] },
      world: { ...originalWorld, governance: h.governance, definition: { ...originalWorld.definition,
        operationGrants: [{ requesterEntityId: relation.subject, domain: 'governance', operation: 'define-review-route', version: '1',
          scopeEntityId: relation.scope, targetEntityId: relation.object, relationId: relation.id, relation: relation.relation }] } } }
    const creation = accepted(routeState, 'ceo', 'define-review-route', definitionInput)
    const originalRoute = prepareGovernanceRoute(creation.state, creation.operation, creation.state.revision + 1)
    h.setState({ ...creation.state, revision: originalRoute.sequence, world: { ...creation.state.world!,
      governance: { ...h.governance, routes: { route: originalRoute } } } })
    h.vote('alice', 'yes')
    const resolution = prepareGovernanceClose(h.state, h.governance, h.proposal.id, h.state.revision + 1)
    const governance = { ...h.governance, routes: { route: originalRoute }, resolutions: { [resolution.id]: resolution } }
    const state = { ...h.state, revision: resolution.sequence,
      world: { ...h.state.world!, governance } }
    const material = { id: 'route', revision: 1, definitionHash: originalRoute.hash, mode: 'and' as const, membershipPolicy: 'frozen' as const,
      bodyHash: h.proposal.bodyHash, deadline: h.proposal.deadline,
      steps: [{ id: 'review', proposalId: h.proposal.id, resolutionId: resolution.id, resolutionHash: resolution.hash, dependsOn: [] }] }
    const route = { ...material, hash: businessFingerprint(material) }
    if (h.source.operation.action.kind !== 'world/request') throw new Error('Fixture lost its original request')
    const original = simulationGovernanceProposalInputSchema.parse(h.source.operation.action.payload)
    const input = simulationGovernanceProposalInputSchema.parse({ ...original, reviewRoute: route })
    expect(() =>{  assertReviewRoute(state, input) }).not.toThrow()
    expect(() =>{  assertReviewRoute(state, { ...input, body: 'new text' }) }).toThrow(/hash/)
    expect(() =>{  assertReviewRoute(state, { ...input, reviewRoute: { ...route, hash: `sha256:${'0'.repeat(64)}` } }) }).toThrow(/hash/)
    expect(() => simulationReviewRouteSchema.parse({ ...route, steps: [] })).toThrow()
    expect(() => simulationReviewRouteSchema.parse({ ...route,
      steps: [{ ...route.steps[0], dependsOn: ['missing'] }] })).toThrow(/missing/)
    expect(() => simulationReviewRouteSchema.parse({ ...route,
      steps: [{ ...route.steps[0], dependsOn: ['review'] }] })).toThrow(/cyclic/)
    // Completion requires the original definition; an absent OR branch is explicit, never silently omitted.
    const second = simulationGovernanceProposalSchema.parse({ ...h.proposal, id: 'second-proposal',
      committeeId: 'second-committee', electorate: [{ ...h.proposal.electorate[0], entityId: 'bob', binding: actor('bob').binding }] })
    for (const mode of ['and', 'or', 'ordered'] as const) {
      const steps = [...originalRoute.steps, { id: 'second', proposalId: second.id, proposalRevision: 1, dependsOn: [] }]
      const definition = { ...originalRoute, mode, steps, proposals: [h.proposal, second] }
      const matrixState = { ...state, entities: { ...state.entities, bob: actor('bob') }, world: { ...state.world, governance: { ...governance,
        proposals: { ...governance.proposals, [second.id]: second }, routes: { route: definition } } } }
      const material = { ...route, mode, steps: [...route.steps,
        { id: 'second', proposalId: second.id, resolutionId: null, resolutionHash: null, dependsOn: [] }] }
      const { hash: _hash, ...withoutHash } = material
      const proof = { ...material, hash: businessFingerprint(withoutHash) }
      const validate = () =>{  assertReviewRoute(matrixState, { ...input, reviewRoute: proof }) }
      if (mode === 'or') expect(validate).not.toThrow()
      else expect(validate).toThrow(/not satisfied/)
      const pendingVote = accepted({ ...matrixState, revision: originalRoute.sequence }, 'bob', 'vote', { proposalId: second.id,
        proposalRevision: 1, bodyHash: second.bodyHash, choice: 'yes' }, second)
      const early = { ...pendingVote.state, revision: state.revision }
      if (mode === 'ordered') expect(() => prepareGovernanceVote(early, matrixState.world.governance,
        pendingVote.operation, state.revision + 1)).toThrow(/before the dependent ballot/)
    }
    const late = { ...resolution, time: simTimeSchema.parse('11') }
    const lateState = { ...state, world: { ...state.world, governance: { ...governance,
      resolutions: { [late.id]: late } } } }
    expect(() =>{  assertReviewRoute(lateState, input) }).toThrow(/actual original committee decisions/)
    // An approval at the deadline remains valid when an institution is published later.
    expect(() =>{  assertReviewRoute({ ...state, time: simTimeSchema.parse('20') }, input) }).not.toThrow()

  })

  it('records independent principals, refuses stale/revoked/expired proxies and retains old accepted ballots', () => {
    const h = proposalFixture()
    let state: SimulationSnapshot = { ...h.state, world: { governance: h.governance } as NonNullable<SimulationSnapshot['world']> }
    const input = { proposalId: h.proposal.id, proposalRevision: 1, bodyHash: h.proposal.bodyHash,
      delegateId: 'bob', expiresAt: '9', revoked: false }
    const grantSource = accepted(state, 'alice', 'delegate-vote', input, h.proposal)
    const grant = prepareGovernanceDelegation(grantSource.state, grantSource.operation, state.revision + 1)
    state = { ...grantSource.state, revision: grant.sequence, world: { ...state.world!,
      governance: { ...h.governance, delegations: [grant] } } }
    const voteInput = { proposalId: h.proposal.id, proposalRevision: 1, bodyHash: h.proposal.bodyHash,
      choice: 'yes', delegationId: grant.id }
    const contribution = accepted(state, 'bob', 'vote', voteInput, h.proposal)
    const vote = prepareGovernanceVote(contribution.state, state.world!.governance, contribution.operation, state.revision + 1)
    expect(vote.voter).toBe('alice')
    expect(vote.source.binding.participantId).toBe('bob')
    const revokeSource = accepted(state, 'alice', 'delegate-vote', { ...input, revoked: true }, h.proposal, ':revoke')
    const revoke = prepareGovernanceDelegation(revokeSource.state, revokeSource.operation, vote.sequence + 1)
    const revoked = { ...state.world!.governance, delegations: [grant, revoke] }
    expect(() => prepareGovernanceVote({ ...contribution.state, revision: revoke.sequence }, revoked,
      contribution.operation, revoke.sequence + 1)).toThrow(/revoked/)
    expect(() => prepareGovernanceVote({ ...contribution.state, time: simTimeSchema.parse('9') }, state.world!.governance,
      contribution.operation, state.revision + 1)).toThrow(/expired/)
    expect(() => prepareGovernanceVote(contribution.state, { ...revoked, votes: { [vote.id]: vote } },
      contribution.operation, revoke.sequence + 1)).not.toThrow()
    const foreign = accepted(state, 'carol', 'vote', voteInput, h.proposal)
    expect(() => prepareGovernanceVote(foreign.state, state.world!.governance, foreign.operation, state.revision + 1)).toThrow(/scope/)
  })
})

it('rejects legacy proposal and vote artifacts through the same Native manifest lookup used by writable replay', async () => {
  const registry = new SimulationWorldDomainRegistry<NativeWorldDomain>()
  const proposal = new GovernanceProposalNativeWorldDomain(), vote = new GovernanceVoteNativeWorldDomain()
  const disposers = [registry.register(proposal.definition, proposal), registry.register(vote.definition, vote)]
  const runtime = new NativeWorldRuntime(registry)
  try {
    expect(runtime.original(WORLD_GOVERNANCE_PROPOSE_PIN)).toBe(proposal)
    expect(runtime.original(WORLD_GOVERNANCE_VOTE_PIN)).toBe(vote)
    expect(() => runtime.original(simulationWorldDomainPinSchema.parse({ ...WORLD_GOVERNANCE_PROPOSE_PIN,
      schemaRef: 'clocky.governance.propose-norm/schema/2', implementationRef: 'clocky.governance.propose-norm/native/2', generation: 1 }))).toThrow()
    expect(() => runtime.original(simulationWorldDomainPinSchema.parse({ ...WORLD_GOVERNANCE_VOTE_PIN,
      schemaRef: 'clocky.governance.vote/schema/2', implementationRef: 'clocky.governance.vote/native/3', generation: 2 }))).toThrow()
  } finally { runtime.close(); for (const dispose of disposers) await dispose() }
})

it('rejects pre-route institution pins instead of interpreting their payloads under the new approval contract', async () => {
  const registry = new SimulationWorldDomainRegistry<NativeWorldDomain>()
  const enact = new NormEnactNativeWorldDomain(), revoke = new NormRevokeNativeWorldDomain()
  const disposers = [registry.register(enact.definition, enact), registry.register(revoke.definition, revoke)]
  const runtime = new NativeWorldRuntime(registry)
  try {
    for (const pin of [WORLD_NORM_ENACT_PIN, WORLD_NORM_REVOKE_PIN]) {
      expect(runtime.original(pin)).toBe(pin === WORLD_NORM_ENACT_PIN ? enact : revoke)
      expect(() => runtime.original(simulationWorldDomainPinSchema.parse({ ...pin,
        schemaRef: pin.schemaRef.replace('/2', '/1'), implementationRef: pin.implementationRef.replace('/2', '/1'), generation: 1 }))).toThrow()
    }
  } finally { runtime.close(); for (const dispose of disposers) await dispose() }
})
