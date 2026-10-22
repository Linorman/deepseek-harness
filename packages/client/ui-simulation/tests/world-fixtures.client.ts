/** Schema-shaped World domain fixtures shared by component specs and the local review gallery. */
import type { ExternalIdentityDetail, ExternalView, GovernanceView, OrganizationView, PersonDetailView, ProposalDetailView,
  NormVersionView, WorldCaseExtension, WorldOverviewView, ActionPreview, ActionField } from '../src/client/world-domain.ts'

import { worldReadEntityIdSchema as entityId, worldReadRelationIdSchema as relationId, worldReadDecisionIdSchema as decisionId, worldReadParticipantIdSchema as participantId, worldReadSessionIdSchema as sessionId, worldReadProposalIdSchema as proposalId, worldReadExternalIdentityIdSchema as externalIdentityId, worldReadRequestIdSchema as requestId, worldReadNormIdSchema as normId, worldReadIntentIdSchema as intentId, worldReadFactIdSchema as factId } from '@clocky/clocky-simulation-product/world-read-schema'
import { simulationProductRunIdSchema, simulationProductCursorSchema } from '@clocky/clocky-simulation-product/schema'

const text = (value: string) => ({ text: value, truncated: false })

/** Portable definition matching `examples/simulation-company/scenarios/world-laboratory.json`. */
export const laboratory = { 'apiVersion': 'clocky.world/v0', 'metadata': { 'id': 'laboratory', 'name': 'Horizon Laboratory', 'description': 'One organization with a bounded request for one new colleague.' }, 'organization': { 'id': 'laboratory', 'name': 'Horizon Laboratory', 'description': 'Members collaborate through private channels.' }, 'positions': [{ 'id': 'research', 'name': 'Research assistant', 'capacity': 2 }], 'runtimeProfile': { 'id': 'world-agent', 'version': '1' }, 'templates': [{ 'id': 'laboratory-person', 'version': '1' }], 'actors': [{ 'id': 'director', 'role': 'director', 'template': { 'id': 'laboratory-person', 'version': '1' }, 'persona': { 'name': 'Coordinator' } }, { 'id': 'requester', 'role': 'member', 'template': { 'id': 'laboratory-person', 'version': '1' }, 'persona': { 'name': 'Research Lead' } }, { 'id': 'observer', 'role': 'member', 'template': { 'id': 'laboratory-person', 'version': '1' }, 'persona': { 'name': 'Observer' } }], 'assignments': [{ 'id': 'initial-assignment', 'personId': 'requester', 'positionId': 'research' }], 'authorizations': [{ 'id': 'hiring-authority', 'requesterId': 'requester', 'positionId': 'research' }], 'initialEvents': [{ 'kind': 'hire-request', 'applicationId': 'first-colleague', 'requesterId': 'requester', 'positionId': 'research', 'at': '0', 'description': 'We need one additional colleague for this position.' }], 'limits': { 'world': { 'maxPlansPerRequest': 3 } } } as const

const runId = simulationProductRunIdSchema.parse('run-lab')

/** Overview with every attention family and a voting proposal. */
export const overview: WorldOverviewView = {
  runId, revision: 382, now: '1240', tickUnit: 'minute',
  attention: { handoffRequired: 1, outcomeUnknown: 2, retirementUnconfirmed: 1, implementationMissing: 0, evidenceRequired: 1 },
  upcoming: [{ at: '1300', label: text('周例会'), scope: text('研发部') }, { at: '1400', label: text('提案截止') }],
  proposals: [{ id: proposalId.parse('p-hire'), title: text('招聘需委员会批准'), committee: text('治理委员会'), status: 'voting', deadline: '1400',
    tally: { for: 2, against: 1, abstain: 0, pending: 2, electorate: 5, threshold: 4, quorum: 4, rule: 'absolute', closure: 'can-still-change' } }],
  norms: { active: 4, knownNotEffective: 1 },
  external: { identities: 6, byKind: { 'simulated-actor': 2, rule: 3, 'director-ruling': 1 },
    latest: { at: '1180', summary: text('BioSupply 代表回应报价') } },
  caseFlow: [{ status: 'open', count: 4 }, { status: 'cancel-requested', count: 1 }, { status: 'committed', count: 14 }, { status: 'cancelled', count: 1 }],
}

const tenure = (id: string, personId: string, positionId: string, name: string, from: string, until?: string, extra: object = {}) =>
  ({ id: relationId.parse(id), personId: entityId.parse(personId), positionId: entityId.parse(positionId),
    positionName: text(name), from, ...until === undefined ? {} : { until }, revision: 3, ...extra })

/** Organization window with a unit tree, a transfer and a termination. */
export const organization: OrganizationView = {
  runId, now: '1240', tickUnit: 'minute', range: { from: '0', until: '1500' }, unloadedNodes: 7,
  coverage: { scope: 'organization:structure', complete: false, loaded: 24, total: 31, revision: 382, nextCursor: simulationProductCursorSchema.parse('org-next') },
  nodes: [
    { id: entityId.parse('lab'), kind: 'unit', name: text('新药研发实验室') },
    { id: entityId.parse('rd'), kind: 'unit', name: text('研发部'), parentId: entityId.parse('lab') },
    { id: entityId.parse('ops'), kind: 'unit', name: text('运营部'), parentId: entityId.parse('lab') },
    { id: entityId.parse('chief'), kind: 'position', name: text('首席科学家'), parentId: entityId.parse('rd'), occupancy: { occupied: 1, reserved: 0, capacity: 1 } },
    { id: entityId.parse('researcher'), kind: 'position', name: text('研究员'), parentId: entityId.parse('rd'), occupancy: { occupied: 2, reserved: 1, capacity: 4 } },
    { id: entityId.parse('buyer'), kind: 'position', name: text('采购专员'), parentId: entityId.parse('ops'), occupancy: { occupied: 1, reserved: 0, capacity: 2 } },
  ],
  edges: [{ id: relationId.parse('e1'), from: entityId.parse('lab'), to: entityId.parse('rd'), kind: 'parent' }, { id: relationId.parse('e2'), from: entityId.parse('lab'), to: entityId.parse('ops'), kind: 'parent' },
    { id: relationId.parse('e3'), from: entityId.parse('rd'), to: entityId.parse('chief'), kind: 'parent' }, { id: relationId.parse('e4'), from: entityId.parse('rd'), to: entityId.parse('researcher'), kind: 'parent' },
    { id: relationId.parse('e5'), from: entityId.parse('ops'), to: entityId.parse('buyer'), kind: 'parent' }],
  people: [
    { id: entityId.parse('li'), name: text('李华'), unitId: entityId.parse('rd'), position: text('首席科学家'), employment: 'employed', cognition: 'agent', residency: 'resident',
      pendingObligations: 0, tenures: [tenure('t1', 'li', 'chief', '首席科学家', '0')] },
    { id: entityId.parse('wang'), name: text('王强'), unitId: entityId.parse('rd'), position: text('研究员'), employment: 'departing', cognition: 'agent', residency: 'retiring',
      pendingObligations: 3, tenures: [tenure('a11', 'wang', 'buyer', '采购专员', '0', '600', { end: 'transferred' }),
        tenure('a12', 'wang', 'researcher', '研究员', '600', undefined, { requestedAt: '560' })] },
    { id: entityId.parse('zhou'), name: text('周敏'), unitId: entityId.parse('rd'), position: text('研究员'), employment: 'employed', cognition: 'agent', residency: 'retirement-unconfirmed',
      pendingObligations: 0, tenures: [tenure('t3', 'zhou', 'researcher', '研究员', '200')] },
    { id: entityId.parse('chen'), name: text('陈晨'), unitId: entityId.parse('ops'), employment: 'terminated', cognition: 'none', residency: 'not-applicable',
      pendingObligations: 0, tenures: [tenure('t4', 'chen', 'buyer', '采购专员', '100', '900', { end: 'terminated' })] },
  ],
}

/** Departing person with obligations and Host action hints. */
export const person: PersonDetailView = {
  runId, personId: entityId.parse('wang'), revision: 7, name: text('王强'), employment: 'departing', residency: 'retiring',
  sources: [], participantId: participantId.parse('participant-wang'), sessionId: sessionId.parse('session-wang'), entity: { kind: 'entity', id: entityId.parse('entity-wang') },
  persona: { state: 'withheld' }, tenures: organization.people[1]?.tenures ?? [],
  obligations: [
    { id: 'o1', kind: 'decision', label: text('评审实验方案 B'), owner: text('王强'), state: 'handoff-required', revision: 4,
      ref: { kind: 'decision', id: decisionId.parse('decision-412') }, dispositions: ['wait', 'cancel-and-recreate'] },
    { id: 'o2', kind: 'wake', label: text('1,300 周例会提醒'), owner: text('王强'), state: 'waiting', revision: 2, dispositions: ['wait'] },
    { id: 'o3', kind: 'resource', label: text('试剂预算账户'), owner: text('研发部'), state: 'settled', revision: 9, dispositions: [] },
  ],
  actions: [{ action: 'transfer', allowed: true }, { action: 'depart', allowed: false, reason: '离职已在进行中' }],
}

/** Governance with active, superseded and announced-in-advance norm versions. */
export const governance: GovernanceView = {
  runId, now: '1240', tickUnit: 'minute', coverage: { scope: 'governance:proposals', complete: true, loaded: 2, total: 2, revision: 382 },
  proposals: [overview.proposals[0] as GovernanceView['proposals'][number],
    { id: proposalId.parse('p-budget'), title: text('季度预算上限'), committee: text('治理委员会'), status: 'enacted', deadline: '900',
      tally: { for: 5, against: 0, abstain: 0, pending: 0, electorate: 5, threshold: 5, quorum: 3, rule: 'unanimous', closure: 'closed' } }],
  norms: [
    { id: 'n-hire-2', normId: normId.parse('hiring-approval'), title: text('招聘审批'), version: '2', enforcement: { mode: 'validated', policyRef: 'policy.hiring@1' },
      sources: [], scope: text('全组织'), recordedAt: '300', effectiveFrom: '320', knowableAt: '300', until: '1300', body: { state: 'allowed', value: text('招聘需部门负责人批准。') } },
    { id: 'n-hire-3', normId: normId.parse('hiring-approval'), title: text('招聘审批'), version: '3', enforcement: { mode: 'validated', policyRef: 'policy.hiring@1' },
      sources: [], scope: text('全组织'), recordedAt: '1200', effectiveFrom: '1300', knowableAt: '1200', body: { state: 'allowed', value: text('招聘需委员会 4 票批准。') } },
    { id: 'n-budget', normId: normId.parse('budget'), title: text('季度预算上限'), version: '1', enforcement: { mode: 'advisory' },
      sources: [], scope: text('研发部'), recordedAt: '880', effectiveFrom: '900', knowableAt: '900', body: { state: 'withheld' } },
  ],
}

/** Proposal detail with a frozen electorate and one member who left. */
export const proposal: ProposalDetailView = {
  ...overview.proposals[0] as ProposalDetailView, runId, version: '2', bodyHash: 'sha256:9c1e00000000000000000000000000000000000000000000000000000000f02',
  body: { state: 'withheld' }, targetNorm: { id: normId.parse('hiring-approval'), version: '3' }, frozenAt: '1180',
  sources: [], electorateMembers: [
    { personId: entityId.parse('li'), name: text('李华'), ballot: 'for', decision: { kind: 'decision', id: decisionId.parse('412') }, leftCommittee: false },
    { personId: entityId.parse('zhou'), name: text('周敏'), ballot: 'for', decision: { kind: 'decision', id: decisionId.parse('417') }, leftCommittee: false },
    { personId: entityId.parse('wang'), name: text('王强'), ballot: 'against', decision: { kind: 'decision', id: decisionId.parse('420') }, leftCommittee: true },
    { personId: entityId.parse('chen'), name: text('陈晨'), ballot: 'none', leftCommittee: false },
    { personId: entityId.parse('zhao'), name: text('赵磊'), ballot: 'none', leftCommittee: false },
  ],
  enactment: { state: 'awaiting-request' },
}

/** Active norm detail. */
export const norm: NormVersionView = governance.norms[0] as NormVersionView

/** External identities across every representation. */
export const external: ExternalView = {
  runId, coverage: { scope: 'external', complete: false, loaded: 3, total: 6, revision: 382, nextCursor: simulationProductCursorSchema.parse('ext-next') },
  identities: [
    { key: externalIdentityId.parse('biosupply'), name: text('BioSupply'), kind: 'simulated-actor', generation: 2, latest: { at: '1180', summary: text('回应报价') } },
    { key: externalIdentityId.parse('regulator'), name: text('药监局'), kind: 'rule', generation: 0 },
    { key: externalIdentityId.parse('market'), name: text('市场'), kind: 'director-ruling', generation: 0, latest: { at: '1100', summary: text('需求裁决') } },
  ],
}

/** Represented external identity with an unknown fact and a sampled interaction. */
export const identity: ExternalIdentityDetail = {
  ...external.identities[0] as ExternalIdentityDetail, runId, entity: { kind: 'entity', id: entityId.parse('entity-biosupply') }, revision: 5,
  sources: [], expansion: text('仅在交互时展开代表'),
  facts: [{ key: factId.parse('price'), value: { state: 'known', text: text('每批 1,200') }, report: false },
    { key: factId.parse('capacity'), value: { state: 'unknown' }, report: false },
    { key: factId.parse('delivery'), value: { state: 'known', text: text('两周') }, report: true }],
  representative: { person: text('BioSupply 销售代表'), participantId: participantId.parse('participant-bio'), ready: 'ready',
    steps: [{ id: 'r', label: '预留', state: 'done' }, { id: 'p', label: '准备', state: 'done' }, { id: 'a', label: '就绪', state: 'done' }] },
  representatives: [{ person: text('BioSupply 销售代表'), entity: { kind: 'entity', id: entityId.parse('entity-bio-representative') },
    participantId: participantId.parse('participant-bio'), sessionId: sessionId.parse('session-bio'), ready: 'ready', steps: [] }],
  interactions: [{ id: intentId.parse('x1'), at: '1180', requester: text('王强'), kind: 'simulated-actor', basis: text('代表回应'), outcome: text('报价每批 1,200'),
    sampled: true, disclosure: { state: 'allowed', value: text('我们可以在两周内交付首批。') } }],
}

/** Case extension with evidence required, a blocked execution and engine sources. */
export const caseExtension: WorldCaseExtension = {
  businessSummary: { status: 'unsupported' },
  requestId: requestId.parse('case'), domain: 'organization', operation: 'hire', businessKey: { state: 'allowed', value: text('hire/researcher/2') }, target: text('研究员'), updatedAt: '1230',
  tracks: [
    { kind: 'request', summary: '待补证（缺：预算依据）', steps: [{ id: 'recorded', label: '已记录', state: 'done' },
      { id: 'delivered', label: '已交付', state: 'done' }, { id: 'evidence', label: '待补证', state: 'waiting' }] },
    { kind: 'plan', summary: '尚未开始', steps: [] },
    { kind: 'execution', summary: '已阻塞', steps: [{ id: 'reserved', label: '已预留', state: 'blocked' }] },
    { kind: 'notification', summary: '请求通知已投递 · 已被 HR 消费', steps: [{ id: 'delivered', label: '已投递', state: 'done' }] },
  ],
  evidence: { fields: ['预算依据'], responders: [text('研发部负责人')], deadline: '1350', remainingAttempts: 1,
    revisions: [{ at: '1220', summary: text('补充了岗位说明') }] },
  sources: [{ kind: 'decision', id: decisionId.parse('decision-401'), label: '李华的决策' }, { kind: 'record', sequence: 88 }],
  mutation: { phase: 'quiescing', blocked: 'handoff-required', cancelRequested: false },
}

/** Host-declared transfer fields. */
export const transferFields: readonly ActionField[] = [
  { id: 'position', kind: 'choice', required: true, options: [{ id: 'chief', label: '首席科学家' }, { id: 'buyer', label: '采购专员' }] },
  { id: 'effective', kind: 'choice', required: true, options: [{ id: 'at', label: '指定时刻' }, { id: 'boundary', label: '下一安全边界' }] },
  { id: 'at', kind: 'time', required: false },
]

/** Transfer preview blocked by one obligation. */
export const transferPreview: ActionPreview = {
  previewHash: 'sha256:1f3a0000000000000000000000000000000000000000000000000000000000aa', revision: 7,
  impacts: [text('王强 将从 研究员 调至 首席科学家'), text('首席科学家 占用 1 → 2（容量 1）')],
  obligations: person.obligations.slice(0, 1), blockers: [{ reason: '2 项义务需先处理', next: { label: '查看义务', obligations: true } }],
  allowance: [{ key: 'maxResidentActors', before: '8', after: '8' }],
}
