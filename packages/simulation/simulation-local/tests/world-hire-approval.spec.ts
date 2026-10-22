/** Pure policy admission relationships; real Agent/Session voting and hiring use the Loader snapshot suite. */
import { beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { catalog } from '../../simulation-scenario/tests/fixtures.ts'
import { simulationRunSpecSchema, simulationWorldRoleIntentSchema, simulationWorldDefinitionSchema, simulationWorldRequestOperationSchema,
  simulationWorldResolveOperationSchema, simulationEntityBindingSchema, simulationDecisionIdSchema,
  simulationWriterEpochSchema, simulationOperationIdSchema, simulationDecisionSlotSchema,
  simulationEventSlotSchema, simulationEntityIdSchema, worldPlanIdSchema, worldRequestIdSchema,
  WORLD_GENERATE_AND_HIRE_PIN, WORLD_HIRE_EXISTING_PIN, simulationWorldHireExistingPayloadSchema,
  simulationNormVersionSchema, simulationNormClosureSchema,
  simulationGovernanceProposalSchema, simulationGovernanceVoteSchema, simulationGovernanceResolutionSchema,
  simulationHireApprovalTargetSchema,
  hireApprovalBody, simTimeSchema, SimulationHireApprovalError } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationWorldRequest, SimulationWorldPlan, SimulationWorldIntent,
  SimulationNormVersion, SimulationGovernanceProposal } from '@clocky/clocky-simulation'
import { requireHireApproval, validateHireApprovalTarget, HireApprovalNativeWorldDomain } from '../src/world-hire-approval.ts'
import { businessFingerprint } from '../src/business.ts'
import { governanceBodyHash } from '../src/world-governance.ts'

let resolved: ResolvedWorldScenario
beforeAll(async () => {
  const compiled = await compileWorldScenario(worldScenarioSchema.parse(JSON.parse(
    await readFile('examples/simulation-company/scenarios/world-company.json', 'utf8'))), catalog())
  if (!compiled.ok) throw new Error('Approval fixture requires the actual valid company author definition')
  resolved = compiled.resolved
})

function fixture(existing = false) {
  const scope = resolved.world.organizationEntityId, position = resolved.world.positions[0]!.entityId
  const requester = simulationEntityIdSchema.parse(resolved.actors.find(value => value.role === 'member')!.entityId)
  const template = resolved.world.templates[0]!
  const binding = simulationEntityBindingSchema.parse({ teamId: 'canonical', participantId: requester, sessionId: `session:${requester}` })
  const source = { kind: 'decision' as const, decisionId: simulationDecisionIdSchema.parse('hire-request-decision'),
    epoch: simulationWriterEpochSchema.parse('1'), binding }
  const action = simulationWorldRequestOperationSchema.parse({ kind: 'world/request', domain: 'organization',
    operation: existing ? 'hire-existing' : 'generate-and-hire', version: '1', businessKey: 'single-job', expectedTime: null, evidence: [],
    payload: { organizationEntityId: scope, positionEntityId: position, description: 'Need one colleague.',
      ...existing ? { personId: 'candidate' } : {} } })
  const parsedIntent = simulationWorldRoleIntentSchema.parse({ id: 'job-intent', pin: existing ? WORLD_HIRE_EXISTING_PIN : WORLD_GENERATE_AND_HIRE_PIN,
    businessKey: action.businessKey, requesterEntityId: requester, scopeEntityId: scope, targetEntityId: position, expectedTime: null,
    evidence: [], description: 'Need one colleague.', payload: action.payload, sequence: 10, requestId: 'job-request' })
  const { requestId: _parsedRequest, ...retainedIntent } = parsedIntent
  const intent: SimulationWorldIntent = { ...retainedIntent, requestId: worldRequestIdSchema.parse('job-request') }
  const request: SimulationWorldRequest = { id: worldRequestIdSchema.parse('job-request'), intentId: intent.id,
    operationId: simulationOperationIdSchema.parse('hire-request-op'), notificationOperationId: simulationOperationIdSchema.parse('hire-request-post'),
    requesterEntityId: requester, proposal: action, pin: intent.pin, source, description: intent.description,
    payloadHash: businessFingerprint(action), sequence: 11, plans: [worldPlanIdSchema.parse('hire-plan')], status: 'open' }
  const plan: SimulationWorldPlan = { id: request.plans[0]!, requestId: request.id,
    operationId: simulationOperationIdSchema.parse('hire-plan-op'), pin: intent.pin, reads: [], baseRevision: 11, sequence: 12,
    hash: `sha256:${'0'.repeat(64)}`, status: 'accepted', proposal: simulationWorldResolveOperationSchema.parse({
      kind: 'world/resolve', requestId: request.id, supersedes: null, resolution: { kind: 'apply', rationale: 'Private selection.',
        payload: existing ? action.payload : { templateId: template.id, templateVersion: template.version, persona: {
          name: template.names[0], skills: template.skills, traits: template.traits, goals: template.goals } } } }) }
  const committee = simulationEntityIdSchema.parse('committee')
  const norm = simulationNormVersionSchema.parse({ origin: 'governance', id: 'hiring-policy', version: '1', schemaRef: 'clocky.world-norm/1',
    subject: scope, scope, body: 'Committee approves each individual hire.', bodyHash: governanceBodyHash('Committee approves each individual hire.'),
    proposal: { id: 'norm-proposal', revision: 1, bodyHash: `sha256:${'1'.repeat(64)}` },
    resolution: { id: 'norm-resolution', hash: `sha256:${'2'.repeat(64)}` }, status: 'enacted',
    enforcement: { kind: 'validated', policyRef: 'clocky.organization.hiring-approval/1',
      params: { committeeId: committee, positionIds: [position], maxHires: 1 } }, supersedes: null,
    effectiveFrom: '0', effectiveUntil: null, availableAt: '100', audience: { kind: 'actors', entityIds: [committee] },
    source: { requestId: 'norm-request', planId: 'norm-plan', mutationId: 'norm-mutation', references: [] }, recordedAt: 0, sequence: 9 })
  const candidate = { id: simulationEntityIdSchema.parse('candidate'), kind: 'person', cognition: 'agent' as const,
    phase: 'active' as const, readiness: 'ready' as const, revision: 1, profileRevision: 1,
    profile: { name: 'Original person', persona: { memory: 'Original private person memory.' } }, binding }
  const target = simulationHireApprovalTargetSchema.parse({ intentId: intent.id, requestId: request.id,
    requestHash: request.payloadHash, scopeId: scope, positionId: position, norm: { id: norm.id, version: norm.version }, quantity: 1,
    selection: existing ? { kind: 'existing-person', personId: candidate.id, entityRevision: candidate.revision,
      profileHash: businessFingerprint(candidate.profile) } : { kind: 'finite-template', templateId: template.id, templateVersion: template.version, names: [template.names[0]],
      skills: template.skills, traits: template.traits, goals: template.goals } })
  let state: SimulationSnapshot = { spec: simulationRunSpecSchema.parse({ runId: 'hire-approval-test', ...resolved.native }),
    revision: 30, time: simTimeSchema.parse('0'), phase: 'running', entities: existing ? { [candidate.id]: candidate } : {}, relations: {},
    nextDecisionSlot: simulationDecisionSlotSchema.parse('0'), decisions: {}, operations: {}, resources: {}, resourceReservations: {}, grants: {},
    interactions: {}, commitments: {}, nextEventSlot: simulationEventSlotSchema.parse('0'), scheduledEvents: {}, wakes: {},
    world: { executions: {},
      external: { identities: {}, interactions: {}, representatives: {}, contacts: {}, adjudications: {}, events: {} },
      personnel: { reservations: {}, fences: {}, generations: {}, operationGrants: [] },
      definition: simulationWorldDefinitionSchema.parse(resolved.world), sequence: 1, channels: {},
      intents: { [intent.id]: intent }, requests: { [request.id]: request },
      plans: { [plan.id]: plan }, results: {}, cancellations: {}, reservations: {}, mutations: {}, facts: {},
      evidence: { challenges: {}, revisions: {} },
      governance: { proposals: {}, votes: {}, resolutions: {} },
      norms: { versions: { [norm.id]: [norm] }, closures: [], announcements: {} } } }
  const approve = (approvalTarget = target, mode: 'hire-approval' | 'norm' = 'hire-approval') => {
    const proposed: SimulationGovernanceProposal = simulationGovernanceProposalSchema.parse({ committeeId: committee,
      scopeId: scope, body: hireApprovalBody(approvalTarget), target: mode === 'norm'
        ? { kind: 'norm', norm: approvalTarget.norm } : { kind: 'hire-approval', approval: approvalTarget },
      policyRef: 'clocky.governance/1', rule: { kind: 'unanimity' }, quorum: 1, deadline: '100', id: `approval:${approvalTarget.norm.id}`,
      revision: 1, bodyHash: governanceBodyHash(hireApprovalBody(approvalTarget)), proposer: requester,
      source: { decisionId: 'approval-decision', operationId: 'approval-op', epoch: '1', binding,
        contextHash: '3'.repeat(64), inputId: 'approval-input' },
      electorate: [{ entityId: requester, binding, membership: { id: 'committee-member', revision: 1, validFrom: '0', validUntil: null } }],
      time: '0', sequence: 20 })
    const voteBody = { proposalId: proposed.id, proposalRevision: 1, bodyHash: proposed.bodyHash,
      choice: 'yes', id: `vote:${approvalTarget.norm.id}`, voter: requester,
      source: { decisionId: 'vote-decision', operationId: 'vote-op', epoch: '1', binding, contextHash: '5'.repeat(64), inputId: 'vote-input' },
      time: '0', sequence: 21 }
    const vote = simulationGovernanceVoteSchema.parse({ ...voteBody, hash: businessFingerprint(voteBody) })
    const resolution = simulationGovernanceResolutionSchema.parse({ proposalId: proposed.id, proposalRevision: 1,
      bodyHash: proposed.bodyHash, id: `resolution:${approvalTarget.norm.id}`, outcome: 'passed', closure: 'all-voted',
      votes: [{ id: vote.id, hash: vote.hash }], counts: { yes: 1, no: 0, abstain: 0, missing: 0 },
      wakeId: `wake:${approvalTarget.norm.id}`, time: '0', sequence: 22,
      hash: `sha256:${'4'.repeat(64)}` })
    const world = state.world!
    state = { ...state, world: { ...world, governance: { ...world.governance,
      proposals: { ...world.governance.proposals, [proposed.id]: proposed }, votes: { ...world.governance.votes, [vote.id]: vote },
      resolutions: { ...world.governance.resolutions, [resolution.id]: resolution } } } }
    return { proposed, resolution }
  }
  return { intent, request, plan, norm, target, committee, approve, get state() { return state },
    setState(value: SimulationSnapshot) { state = value },
    replaceNorms(versions: readonly SimulationNormVersion[]) {
      state = { ...state, world: { ...state.world!, norms: { ...state.world!.norms,
        versions: Object.fromEntries(versions.map(value => [value.id, [value]])) } } }
    } }
}

describe('Native hiring committee approval', () => {
  it.each([false, true])('withholds %s single-case approval material when its exact grant endpoints or rule are unavailable', (existing) => {
    const h = fixture(existing), actor = h.intent.requesterEntityId, scope = h.intent.scopeEntityId
    const relationId = 'approval-goal-grant' as keyof SimulationSnapshot['relations']
    const grant = { requesterEntityId: actor, domain: 'governance', operation: 'propose-hire-approval', version: '1',
      targetEntityId: h.committee, scopeEntityId: scope, relationId, relation: 'can-propose-hire-approval' }
    const actorEntity = { id: actor, kind: 'person', cognition: 'agent' as const, readiness: 'ready' as const,
      phase: 'active' as const, revision: 1, profileRevision: 1, profile: {}, binding: h.request.source.binding }
    const organization = { ...actorEntity, kind: 'organization', cognition: 'none' as const, binding: undefined }
    const relation = { id: relationId, revision: 1, subject: actor, object: h.committee, scope,
      relation: grant.relation, validFrom: simTimeSchema.parse('0'), validUntil: null }
    const state: SimulationSnapshot = { ...h.state, entities: { ...h.state.entities, [actor]: actorEntity,
      [scope]: { ...organization, id: scope }, [h.committee]: { ...organization, id: h.committee } },
    relations: { ...h.state.relations, [relationId]: relation }, spec: { ...h.state.spec,
      relationRules: [...h.state.spec.relationRules.filter(value => value.relation !== grant.relation), {
        relation: grant.relation, subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }] },
    world: { ...h.state.world!, definition: { ...h.state.world!.definition,
      operationGrants: [...h.state.world!.definition.operationGrants, grant] } } }
    const domain = new HireApprovalNativeWorldDomain(), before = structuredClone(state)
    expect(domain.goalContext(state, actor)).toMatchObject({ opportunities: [{ target: {
      intentId: h.intent.id, requestId: h.request.id, norm: h.target.norm, selection: { kind: h.target.selection.kind },
    } }] })
    for (const endpoint of [actor, scope, h.committee]) {
      expect(domain.goalContext({ ...state, entities: { ...state.entities,
        [endpoint]: { ...state.entities[endpoint]!, phase: 'inactive' } } }, actor))
        .toEqual({ kind: 'hire-approval-opportunities', opportunities: [], committees: [] })
    }
    expect(domain.goalContext({ ...state, spec: { ...state.spec,
      relationRules: state.spec.relationRules.filter(value => value.relation !== grant.relation) } }, actor))
      .toEqual({ kind: 'hire-approval-opportunities', opportunities: [], committees: [] })
    expect(state).toEqual(before)
  })

  it('hard enforcement applies before availability and does not accept a policy-enactment resolution as hire approval', () => {
    const h = fixture()
    expect(() => requireHireApproval(h.state, h.intent, h.plan)).toThrow(expect.objectContaining({ code: 'SIM_HIRE_APPROVAL_REQUIRED' }))
    h.approve(h.target, 'norm')
    expect(() => requireHireApproval(h.state, h.intent, h.plan)).toThrow(expect.objectContaining({ code: 'SIM_HIRE_APPROVAL_REQUIRED' }))
    h.approve()
    expect(requireHireApproval(h.state, h.intent, h.plan)).toEqual([expect.objectContaining({ norm: h.target.norm })])
  })

  it.each(['intentId', 'requestId', 'requestHash', 'scopeId', 'positionId'] as const)('rejects approval for a different %s', (field) => {
    const h = fixture(), values = { ...h.target, [field]: field === 'requestHash' ? `sha256:${'f'.repeat(64)}` : 'different' }
    const target = simulationHireApprovalTargetSchema.parse(values)
    expect(() => validateHireApprovalTarget(h.state, target, h.committee, h.intent.scopeEntityId)).toThrow(SimulationHireApprovalError)
  })

  it('requires the current committee and forbids positions outside every effective policy allowlist', () => {
    const h = fixture()
    expect(() => validateHireApprovalTarget(h.state, h.target, simulationEntityIdSchema.parse('wrong-committee'),
      h.intent.scopeEntityId)).toThrow(/committee/)
    if (h.norm.enforcement.kind !== 'validated') throw new Error('Fixture requires validated hiring policy')
    h.replaceNorms([{ ...h.norm, enforcement: { ...h.norm.enforcement, params: { ...h.norm.enforcement.params,
      positionIds: [simulationEntityIdSchema.parse('other-position')] } } }])
    expect(() => requireHireApproval(h.state, h.intent, h.plan)).toThrow(/allowlist/)
  })

  it('requires a distinct exact approval for each effective Norm and retains their deterministic order', () => {
    const h = fixture(), second = simulationNormVersionSchema.parse({ ...h.norm, id: 'second-policy' })
    h.replaceNorms([second, h.norm])
    h.approve()
    expect(() => requireHireApproval(h.state, h.intent, h.plan)).toThrow(/current policy/)
    h.approve(simulationHireApprovalTargetSchema.parse({ ...h.target, norm: { id: second.id, version: second.version } }))
    expect(requireHireApproval(h.state, h.intent, h.plan).map(value => value.norm.id)).toEqual(['hiring-policy', 'second-policy'])
  })

  it('a current unresolved committee proposal remains awaiting approval rather than making the hiring plan stale', () => {
    const h = fixture()
    h.approve()
    h.setState({ ...h.state, world: { ...h.state.world!, governance: { ...h.state.world!.governance, resolutions: {} } } })
    expect(() => requireHireApproval(h.state, h.intent, h.plan)).toThrow(expect.objectContaining({ code: 'SIM_HIRE_APPROVAL_REQUIRED' }))
  })

  it('preserves an exact reservation basis but rejects new, changed or revoked policy at commit', () => {
    const h = fixture()
    h.approve()
    const reserved = requireHireApproval(h.state, h.intent, h.plan)
    expect(requireHireApproval(h.state, h.intent, h.plan, reserved)).toEqual(reserved)
    h.replaceNorms([{ ...h.norm, version: '2' as SimulationNormVersion['version'] }])
    expect(() => requireHireApproval(h.state, h.intent, h.plan, reserved)).toThrow(expect.objectContaining({ code: 'SIM_HIRE_APPROVAL_STALE' }))
    h.replaceNorms([])
    expect(() => requireHireApproval(h.state, h.intent, h.plan, reserved)).toThrow(expect.objectContaining({ code: 'SIM_HIRE_APPROVAL_STALE' }))
    expect(requireHireApproval(h.state, h.intent, h.plan)).toEqual([])
    h.replaceNorms([h.norm])
    expect(() => requireHireApproval(h.state, h.intent, h.plan, [])).toThrow(expect.objectContaining({ code: 'SIM_HIRE_APPROVAL_STALE' }))
  })

  it('closes enforcement at the exact half-open interval and keeps scheduled rules out until their start', () => {
    const h = fixture()
    h.replaceNorms([{ ...h.norm, effectiveFrom: simTimeSchema.parse('1') }])
    expect(requireHireApproval(h.state, h.intent, h.plan)).toEqual([])
    h.setState({ ...h.state, time: simTimeSchema.parse('1') })
    expect(() => requireHireApproval(h.state, h.intent, h.plan)).toThrow(SimulationHireApprovalError)
    h.replaceNorms([h.norm])
    h.setState({ ...h.state, world: { ...h.state.world!, norms: { ...h.state.world!.norms,
      closures: [simulationNormClosureSchema.parse({ id: 'closure', norm: h.target.norm,
        supersededBy: { id: h.norm.id, version: '2' }, at: '1',
        source: { requestId: 'next-request', planId: 'next-plan', mutationId: 'next-mutation' }, recordedAt: 0, sequence: 25 })] } } })
    expect(requireHireApproval(h.state, h.intent, h.plan)).toEqual([])
  })

  it('rejects actual Persona values outside the frozen selection even when a passed approval exists', () => {
    const h = fixture(), target = simulationHireApprovalTargetSchema.parse({ ...h.target,
      selection: { ...h.target.selection, skills: [] } })
    h.approve(target)
    expect(() => requireHireApproval(h.state, h.intent, h.plan)).toThrow(expect.objectContaining({ code: 'SIM_HIRE_APPROVAL_SELECTION' }))
    expect(() => validateHireApprovalTarget(h.state, simulationHireApprovalTargetSchema.parse({ ...h.target,
      selection: { ...h.target.selection, names: ['outside-template'] } }), h.committee, h.intent.scopeEntityId)).toThrow(/finite Persona/)
  })

  it('rejects claimed monetary approval, oversized finite selections and a quantity exceeding the supported single hire', () => {
    const h = fixture()
    expect(() => simulationHireApprovalTargetSchema.parse({ ...h.target, money: { amount: '0', unit: 'JPY' } })).toThrow()
    expect(() => simulationHireApprovalTargetSchema.parse({ ...h.target, quantity: 2 })).toThrow()
    expect(() => simulationHireApprovalTargetSchema.parse({ ...h.target,
      selection: { ...h.target.selection, names: Array.from({ length: 33 }, (_, index) => `name-${index}`) } })).toThrow()
  })

  it('cannot consume another accepted case or plan through a typed helper', () => {
    const h = fixture()
    h.approve()
    const altered: SimulationWorldIntent = { ...h.intent, businessKey: 'different-case' }
    expect(() => requireHireApproval(h.state, altered, h.plan)).toThrow(/exact original/)
    expect(() => requireHireApproval(h.state, h.intent, { ...h.plan, requestId: worldRequestIdSchema.parse('other-request') })).toThrow(/exact original/)
  })
})


describe('existing person committee approval', () => {
  it('requires a passed exact existing-person selection and never substitutes a generated Persona', () => {
    const h = fixture(true)
    expect(() => requireHireApproval(h.state, h.intent, h.plan)).toThrow(expect.objectContaining({ code: 'SIM_HIRE_APPROVAL_REQUIRED' }))
    h.approve()
    expect(requireHireApproval(h.state, h.intent, h.plan)).toHaveLength(1)
    const generated = fixture().target.selection
    const changed = simulationHireApprovalTargetSchema.parse({ ...h.target, selection: generated })
    expect(() => validateHireApprovalTarget(h.state, changed, h.committee, h.intent.scopeEntityId)).toThrow(/finite Persona/)
  })

  it.each(['revision', 'profile', 'terminated', 'noncognitive'] as const)('rejects existing-person approval after candidate %s changes', (field) => {
    const h = fixture(true)
    h.approve()
    if (h.target.selection.kind !== 'existing-person') throw new Error('Fixture requires exact existing person')
    const id = h.target.selection.personId, candidate = h.state.entities[id]!
    const changed = { ...candidate, ...field === 'revision' ? { revision: candidate.revision + 1 }
      : field === 'profile' ? { profile: { name: 'Substitute identity' } }
        : field === 'terminated' ? { phase: 'terminated' as const } : { cognition: 'none' as const } }
    h.setState({ ...h.state, entities: { ...h.state.entities, [id]: changed } })
    expect(() => requireHireApproval(h.state, h.intent, h.plan)).toThrow(expect.objectContaining({ code: 'SIM_HIRE_APPROVAL_SELECTION' }))
  })

  it('rejects a different original person, injected Persona and incomplete approved identity fields', () => {
    const h = fixture(true)
    if (h.target.selection.kind !== 'existing-person') throw new Error('Fixture requires exact existing person')
    expect(() => validateHireApprovalTarget(h.state, simulationHireApprovalTargetSchema.parse({ ...h.target,
      selection: { ...h.target.selection, personId: 'somebody-else' } }), h.committee, h.intent.scopeEntityId)).toThrow(/exact existing person/)
    expect(() => simulationHireApprovalTargetSchema.parse({ ...h.target,
      selection: { ...h.target.selection, persona: { name: 'Replacement' } } })).toThrow()
    expect(() => simulationHireApprovalTargetSchema.parse({ ...h.target,
      selection: { kind: 'existing-person', personId: 'candidate' } })).toThrow()
    h.approve()
    const proposal = simulationWorldResolveOperationSchema.parse({ ...h.plan.proposal,
      resolution: { kind: 'apply', payload: { ...simulationWorldHireExistingPayloadSchema.parse(h.intent.payload), personId: 'somebody-else' }, rationale: 'Private' } })
    const changed = { ...h.plan, proposal }
    h.setState({ ...h.state, world: { ...h.state.world!, plans: { ...h.state.world!.plans, [changed.id]: changed } } })
    expect(() => requireHireApproval(h.state, h.intent, changed)).toThrow(/preserve/)
  })
})
