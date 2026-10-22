/** Semantic refusals precede identity allocation and preserve valid Native initialization boundaries. */
import assert from 'node:assert/strict'
import { it as test } from 'vitest'
import { simulationResourceSpecSchema } from '@clocky/clocky-simulation/world-authoring'
import { WORLD_EXTERNAL_INTERACT_PIN, WORLD_EXTERNAL_ACTOR_PIN, WORLD_EXTERNAL_MEDIATED_PIN, simTimeSchema } from '@clocky/clocky-simulation'
import { worldScenarioV1Schema } from '../src/v1-schema.ts'
import type { WorldScenarioV1, ScenarioV1Catalog, ScenarioV1Diagnostic } from '../src/v1-schema.ts'
import { validateV1Relationships } from '../src/v1-validation.ts'
import { compileWorldScenarioV1 } from '../src/v1-compiler.ts'
import { sample, deployment } from './v1-fixtures.ts'

function required<T>(value: T | undefined): T { assert.ok(value !== undefined); return value }
function changed(action: (value: WorldScenarioV1) => void): WorldScenarioV1 {
  const value = structuredClone(sample); action(value); return worldScenarioV1Schema.parse(value)
}
const personId = required(sample.organization.assignments[0]).personId
const directorId = required(sample.entities.find(value => value.kind === 'person' && value.cognition === 'agent' && value.role === 'director')).id
function check(value: WorldScenarioV1, code: ScenarioV1Diagnostic['code'], path: readonly (string | number)[], catalog = deployment): void {
  const output = validateV1Relationships(value, catalog)
  assert.ok(output.some(item => item.code === code && JSON.stringify(item.path) === JSON.stringify(path)), JSON.stringify(output))
}
function committee(value: WorldScenarioV1): void {
  value.governance.committees.push({ id: 'committee', name: 'Committee', description: 'Committee', scopeId: value.organization.rootId,
    members: [{ id: 'elector', personId, validFrom: '0', validUntil: null }], rule: { kind: 'absolute-threshold', yes: 1 }, quorum: 1 })
}
function advisory(value: WorldScenarioV1): void {
  value.governance.norms.push({ id: 'norm', scopeId: value.organization.rootId, body: 'Authored institution',
    effectiveFrom: '0', effectiveUntil: '10', availableAt: '0', audience: { kind: 'public' }, enforcement: { kind: 'advisory' } })
}
function outside(value: WorldScenarioV1): void {
  value.entities.push({ id: 'vendor', name: 'Vendor', description: 'Outside party', kind: 'organization', cognition: 'none' })
}
function external(representation: WorldScenarioV1['externalWorld']['identities'][number]['representation']):
{ value: WorldScenarioV1; catalog: ScenarioV1Catalog } {
  const pin = representation === 'simulated-rule' ? WORLD_EXTERNAL_INTERACT_PIN
    : representation === 'simulated-actor' ? WORLD_EXTERNAL_ACTOR_PIN : WORLD_EXTERNAL_MEDIATED_PIN
  const value = changed((value) => {
    outside(value); value.domains.push({ domain: pin.domain, operation: pin.operation, version: pin.version })
    value.externalWorld.identities.push({ scopeId: value.organization.rootId, subjectId: 'vendor', externalKey: 'vendor-key', representation })
    if (representation === 'director-mediated') value.externalWorld.adjudicationPolicy = {
      ref: 'clocky.external.adjudication/1', version: '1', generation: 1, conditionInstalls: [], futureConditionInstalls: [],
      allowedOutcomeKinds: ['failure'], maxDelay: simTimeSchema.parse('1000'), allowPublicDisclosure: false, allowScopeDisclosure: false,
      actorDisclosure: [value.organization.rootId as never],
    }
  })
  const catalog = structuredClone(deployment); catalog.domains.push({ pin, available: true })
  return { value, catalog }
}

test.each(['native', 'team', 'world'] as const)(
  'explicit %s allowances above deployment ceilings reject instead of clamping', async (group) => {
    const value = structuredClone(sample)
    const key = group === 'native' ? 'maxEntities' : group === 'team' ? 'maxChannels' : 'maxRequests'
    const ceiling = required(Object.entries(deployment.limits.ceilings[group]).find(([name]) => name === key))[1]
    Object.assign(value.limits[group], { [key]: ceiling + 1 })
    check(value, 'capacity', ['limits', group, key])
    const result = await compileWorldScenarioV1(value, deployment)
    assert.equal(result.ok, false)
  })

test('exact initialization entity and participant capacities include generated positions and committees', () => {
  const value = changed(committee), actors = value.entities.filter(value => value.cognition === 'agent').length
  value.limits.native.maxEntities = value.entities.length + value.organization.positions.length + value.governance.committees.length
  value.limits.team.maxParticipants = actors
  assert.deepEqual(validateV1Relationships(value, deployment), [])
  value.limits.native.maxEntities--
  check(value, 'capacity', ['limits', 'native', 'maxEntities'])
  value.limits.team.maxParticipants--
  check(value, 'capacity', ['limits', 'team', 'maxParticipants'])
})
test('generated private director channels count before additional multiparty authored channels', () => {
  const value = changed((value) => { value.communication.channels.push({ key: 'workroom', members: value.entities
    .filter(value => value.kind === 'person' && value.cognition === 'agent').map(value => ({ personId: value.id, role: 'member' })) }) })
  const needed = value.entities.filter(value => value.cognition === 'agent').length
  value.limits.team.maxChannels = needed
  assert.deepEqual(validateV1Relationships(value, deployment), [])
  value.limits.team.maxChannels--
  check(value, 'capacity', ['limits', 'team', 'maxChannels'])
})
test.each(['public', 'actors', 'scope-members'] as const)('%s Norm announcements and both boundaries count as initial pending events', (kind) => {
  const value = changed(advisory), actorCount = value.entities.filter(value => value.cognition === 'agent').length
  required(value.governance.norms[0]).audience = kind === 'actors' ? { kind, entityIds: [personId as never] } : { kind }
  const recipients = kind === 'public' ? actorCount : kind === 'actors' ? 1 : new Set(value.organization.assignments.map(value => value.personId)).size
  value.limits.native.maxPendingEvents = value.behavior.initialGoals.length + 2 + recipients
  assert.deepEqual(validateV1Relationships(value, deployment), [])
  value.limits.native.maxPendingEvents--
  check(value, 'capacity', ['limits', 'native', 'maxPendingEvents'])
})
test('finite calendars reserve their first occurrence without pre-expanding later occurrences', () => {
  const value = changed((value) => { value.behavior.calendars.push({ id: 'rotation', body: 'Work', startsAt: '0', endsAt: '1000',
    period: '1', maxOccurrences: 1001, target: { kind: 'person', personId } }) })
  value.limits.native.maxPendingEvents = value.behavior.initialGoals.length + 1
  assert.deepEqual(validateV1Relationships(value, deployment), [])
  value.limits.native.maxPendingEvents--
  check(value, 'capacity', ['limits', 'native', 'maxPendingEvents'])
})
test('future assignments do not produce a time-zero scope-member announcement', () => {
  const value = changed((value) => { advisory(value); value.organization.assignments.forEach((value) => { value.validFrom = '10' })
    required(value.governance.norms[0]).audience = { kind: 'scope-members' } })
  value.limits.native.maxPendingEvents = value.behavior.initialGoals.length + 2
  assert.deepEqual(validateV1Relationships(value, deployment), [])
})
test('the minimum activation and task budgets need not cover every paused initial identity', () => {
  const value = changed((value) => { value.limits.team.maxActivations = 1; value.limits.team.maxTasks = 1 })
  assert.deepEqual(validateV1Relationships(value, deployment), [])
})
test.each(['facts', 'knowledge', 'templates'] as const)(
  'retained %s multibyte data exceeding the Native byte allowance reject without leaking bodies', (kind) => {
    const marker = '秘密'.repeat(20000), value = structuredClone(sample), catalog = structuredClone(deployment)
    if (kind === 'facts') value.facts.push({ id: 'large', subjectId: value.organization.rootId, scopeId: value.organization.rootId,
      body: marker, effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'public' } })
    else if (kind === 'knowledge') value.knowledge.push({ id: 'large', ownerId: personId, body: marker, observedAt: '0',
      availableAt: '0', validFrom: '0', validUntil: null, readers: [] })
    else {
      const selected = required(sample.runtimeProfiles.templates[0]).id
      required(catalog.templates.find(value => value.template.id === selected)).template.description = marker
    }
    check(value, 'capacity', ['limits', 'native', 'maxKnowledgeBytes'], catalog)
    assert.equal(JSON.stringify(validateV1Relationships(value, catalog)).includes('秘密'), false)
  })
test('JSON wrappers alone can exceed a tiny retained-book allowance', () => {
  check(changed((value) => { value.limits.native.maxKnowledgeBytes = 1 }), 'capacity', ['limits', 'native', 'maxKnowledgeBytes'])
})
test('future grant admission is an explicit unsupported field while future half-open memberships stay valid', () => {
  const value = changed((value) => {
    committee(value); const original = required(value.governance.committees[0]); required(original.members[0]).validFrom = '10'
    required(original.members[0]).validUntil = '20'; original.members.push({ id: 'successor-elector', personId, validFrom: '20', validUntil: null })
  })
  assert.deepEqual(validateV1Relationships(value, deployment), [])
  required(value.organization.grants[0]).validFrom = '10'
  check(value, 'unsupported-feature', ['organization', 'grants', 0, 'validFrom'])
})
test('same hiring actor-position pair rejects at its original grant index despite unrelated grants', () => {
  const value = changed((value) => { const original = required(value.organization.grants[0])
    value.organization.grants.push({ ...original, id: 'unrelated', operation: 'other' })
    value.organization.grants.push({ ...original, id: 'duplicate-hire' }) })
  check(value, 'duplicate-id', ['organization', 'grants', sample.organization.grants.length + 1])
})
test('relation IDs share one namespace across assignments, grants and committee members', () => {
  const value = changed((value) => { committee(value)
    required(required(value.governance.committees[0]).members[0]).id = required(value.organization.grants[0]).id })
  check(value, 'duplicate-id', ['governance', 'committees', 0, 'members', 0, 'id'])
})
test('repeated unit-parent source IDs reject and reserved generated relation IDs cannot be authored', () => {
  const value = changed((value) => { outside(value); value.organization.units.push({ id: 'vendor', parentId: value.organization.rootId },
    { id: 'vendor', parentId: value.organization.rootId }) })
  check(value, 'duplicate-id', ['organization', 'units', 1, 'id'])
  const raw = structuredClone(sample); required(raw.organization.grants[0]).id = 'unit-parent:vendor'
  assert.equal(worldScenarioV1Schema.safeParse(raw).success, false)
})
test('the root cannot be declared as a child whose organization-parent fold creates a cycle', () => {
  check(changed((value) => { value.organization.units.push({ id: value.organization.rootId, parentId: value.organization.rootId }) }),
    'organization-cycle', ['organization', 'units', 0, 'id'])
})
test('disjoint electorates cannot satisfy a simultaneously unreachable threshold', () => {
  check(changed((value) => { committee(value); const original = required(value.governance.committees[0])
    required(original.members[0]).validUntil = '10'; original.members.push({ id: 'second', personId: directorId, validFrom: '10', validUntil: null })
    original.quorum = 2 }), 'committee-threshold', ['governance', 'committees', 0, 'rule'])
})
test('known resource quantity bounds allow exact units and reject one above', () => {
  const value = changed((value) => { value.resources.push(simulationResourceSpecSchema.parse({ id: 'stock', owner: value.organization.rootId,
    kind: 'inventory', unit: 'widget', quantity: deployment.native.maxResourceQuantity, controllers: [personId] })) })
  assert.deepEqual(validateV1Relationships(value, deployment), [])
  required(value.resources[0]).quantity = String(BigInt(deployment.native.maxResourceQuantity) + 1n) as never
  check(value, 'capacity', ['resources', 0, 'quantity'])
})
test('belief availability cannot precede its observation but future observations are allowed', () => {
  const value = changed((value) => { value.knowledge.push({ id: 'belief', ownerId: personId, body: 'Belief', observedAt: '10',
    availableAt: '10', validFrom: '0', validUntil: null, readers: [] }) })
  assert.deepEqual(validateV1Relationships(value, deployment), [])
  required(value.knowledge[0]).availableAt = '9'
  check(value, 'invalid-reference', ['knowledge', 0, 'availableAt'])
})
test.each(['simulated-rule', 'simulated-actor', 'director-mediated'] as const)('%s identity requires the exact installed operation but no pre-expanded actor', (representation) => {
  const { value, catalog } = external(representation)
  assert.deepEqual(validateV1Relationships(value, catalog), [])
  value.domains.pop()
  check(value, 'domain-unavailable', ['externalWorld', 'identities', 0, 'representation'], catalog)
})
test('external scope-key duplicates refuse even when their subject or representation differs', () => {
  const { value, catalog } = external('simulated-rule'); value.externalWorld.identities.push({ ...required(value.externalWorld.identities[0]), representation: 'simulated-actor' })
  check(value, 'duplicate-id', ['externalWorld', 'identities', 1], catalog)
})
test('mediated maxDelay obeys the frozen horizon and existing noncognitive disclosure readers remain legal', () => {
  const { value, catalog } = external('director-mediated')
  assert.deepEqual(validateV1Relationships(value, catalog), [])
  required(value.externalWorld.adjudicationPolicy).maxDelay = simTimeSchema.parse('1001')
  check(value, 'time-horizon', ['externalWorld', 'adjudicationPolicy', 'maxDelay'], catalog)
})
test('director operation declarations refuse until their execution and authorization owner exists', () => {
  const value = changed((value) => { value.behavior.calendars.push({ id: 'director-calendar', target: { kind: 'person', personId: directorId },
    body: 'Director work', startsAt: '1', period: '1', endsAt: null, maxOccurrences: 1 })
  value.behavior.directorEvents.push({ id: 'event', calendarId: 'director-calendar', maxRequests: 1, ...required(value.domains[0]),
    scopeId: value.organization.rootId, targetId: required(value.organization.positions[0]).id }) })
  check(value, 'unsupported-feature', ['behavior', 'directorEvents', 0])
})

test('validated initial policy requires a declared same-scope committee and root enforcement scope', () => {
  const value = changed((value) => { committee(value); advisory(value)
    required(value.governance.norms[0]).enforcement = { kind: 'validated', policyRef: 'clocky.organization.hiring-approval/1',
      params: { maxHires: 1, committeeId: 'committee' as never, positionIds: [required(value.organization.positions[0]).id as never] } } })
  assert.deepEqual(validateV1Relationships(value, deployment), [])
  outside(value); required(value.governance.committees[0]).scopeId = 'vendor'
  check(value, 'invalid-reference', ['governance', 'norms', 0, 'enforcement', 'params', 'committeeId'])
  required(value.governance.norms[0]).scopeId = 'vendor'
  check(value, 'unsupported-scope', ['governance', 'norms', 0, 'scopeId'])
  required(value.governance.norms[0]).enforcement = { kind: 'advisory' }
  assert.deepEqual(validateV1Relationships(value, deployment), [])
})
test('initial validated policy cannot name an ordinary organization as its committee or position', () => {
  const value = changed((value) => { advisory(value)
    required(value.governance.norms[0]).enforcement = { kind: 'validated', policyRef: 'clocky.organization.hiring-approval/1',
      params: { maxHires: 1, committeeId: value.organization.rootId as never, positionIds: [value.organization.rootId as never] } } })
  check(value, 'invalid-reference', ['governance', 'norms', 0, 'enforcement', 'params', 'committeeId'])
  check(value, 'invalid-reference', ['governance', 'norms', 0, 'enforcement', 'params', 'positionIds', 0])
  const catalog = structuredClone(deployment); catalog.normPolicies = []
  check(value, 'policy-unavailable', ['governance', 'norms', 0, 'enforcement'], catalog)
})
test('hiring and external grants retain executable root targets and cannot impersonate a director', () => {
  const value = changed(outside); const grant = required(value.organization.grants[0]); grant.scopeId = 'vendor'
  check(value, 'unsupported-scope', ['organization', 'grants', 0, 'scopeId'])
  grant.targetId = value.organization.rootId
  check(value, 'invalid-reference', ['organization', 'grants', 0, 'targetId'])
  grant.personId = directorId
  check(value, 'unauthorized-role', ['organization', 'grants', 0, 'personId'])
  grant.relation = 'assignment'
  check(value, 'invalid-reference', ['organization', 'grants', 0, 'relation'])
  const ext = external('simulated-rule'); required(ext.value.organization.grants[0]).domain = 'external'
  required(ext.value.organization.grants[0]).operation = 'interact'; required(ext.value.organization.grants[0]).targetId = personId
  check(ext.value, 'invalid-reference', ['organization', 'grants', 0, 'targetId'], ext.catalog)
})
test('role permissions refuse structural relationships, undeclared operations, bad targets and unsupported scopes', () => {
  const value = changed(outside), position = required(value.organization.positions[0])
  position.permissions.push({ ...required(value.domains[0]), scopeId: 'vendor', targetId: 'missing', relation: 'represents' })
  check(value, 'unsupported-scope', ['organization', 'positions', 0, 'permissions', 0, 'scopeId'])
  check(value, 'unknown-reference', ['organization', 'positions', 0, 'permissions', 0, 'targetId'])
  check(value, 'invalid-reference', ['organization', 'positions', 0, 'permissions', 0, 'relation'])
  required(position.permissions[0]).operation = 'missing-operation'
  check(value, 'domain-unavailable', ['organization', 'positions', 0, 'permissions', 0])
  position.permissions.push(required(position.permissions[0]))
  check(value, 'duplicate-id', ['organization', 'positions', 0, 'permissions', 1])
  position.unitId = 'vendor'
  check(value, 'unknown-reference', ['organization', 'positions', 0, 'unitId'])
})
test('initial external identities cannot redirect their Native root scope to a second institution', () => {
  const { value, catalog } = external('simulated-rule')
  required(value.externalWorld.identities[0]).scopeId = 'vendor'
  check(value, 'unsupported-scope', ['externalWorld', 'identities', 0, 'scopeId'], catalog)
  required(value.externalWorld.identities[0]).subjectId = 'missing'
  check(value, 'unknown-reference', ['externalWorld', 'identities', 0, 'subjectId'], catalog)
})

test.each(['fact', 'norm', 'knowledge', 'resource', 'channel', 'goal', 'calendar', 'committee'] as const)(
  '%s cross-group references are diagnosed at the original field', (kind) => {
    let path: (string | number)[] = []
    const value = changed((value) => {
      if (kind === 'fact') { value.facts.push({ id: 'item', subjectId: 'missing', scopeId: value.organization.rootId,
        body: 'Fact', effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'public' } }); path = ['facts', 0, 'subjectId'] }
      if (kind === 'norm') { advisory(value); required(value.governance.norms[0]).audience = { kind: 'actors', entityIds: ['missing' as never] }
        path = ['governance', 'norms', 0, 'audience', 'entityIds', 0] }
      if (kind === 'knowledge') { value.knowledge.push({ id: 'item', ownerId: personId, body: 'Belief', observedAt: '0', availableAt: '0',
        validFrom: '0', validUntil: null, readers: ['missing'] }); path = ['knowledge', 0, 'readers', 0] }
      if (kind === 'resource') { value.resources.push(simulationResourceSpecSchema.parse({ id: 'item', owner: 'missing',
        kind: 'inventory', unit: 'widget', quantity: '0', controllers: [] })); path = ['resources', 0, 'owner'] }
      if (kind === 'channel') { value.communication.channels.push({ key: 'item', members: [{ personId, role: 'member' },
        { personId: 'missing', role: 'member' }] }); path = ['communication', 'channels', 0, 'members', 1, 'personId'] }
      if (kind === 'goal') { required(value.behavior.initialGoals[0]).target = { kind: 'person', personId: 'missing' }
        path = ['behavior', 'initialGoals', 0, 'target', 'personId'] }
      if (kind === 'calendar') { value.behavior.calendars.push({ id: 'item', target: { kind: 'position', positionId: 'missing' }, body: 'Goal',
        startsAt: '0', endsAt: null, period: '1', maxOccurrences: 1 }); path = ['behavior', 'calendars', 0, 'target', 'positionId'] }
      if (kind === 'committee') { committee(value); required(required(value.governance.committees[0]).members[0]).personId = 'missing'
        path = ['governance', 'committees', 0, 'members', 0, 'personId'] }
    })
    check(value, 'unknown-reference', path)
  })
test.each(['assignment', 'grant', 'committee', 'fact', 'norm', 'knowledge', 'goal', 'calendar'] as const)(
  '%s uses the frozen Native horizon with an exact endpoint accepted', (kind) => {
    let path: (string | number)[] = []
    const value = changed((value) => {
      if (kind === 'assignment') { required(value.organization.assignments[0]).validUntil = '1000'; path = ['organization', 'assignments', 0, 'validUntil'] }
      if (kind === 'grant') { required(value.organization.grants[0]).validUntil = '1000'; path = ['organization', 'grants', 0, 'validUntil'] }
      if (kind === 'committee') { committee(value); required(required(value.governance.committees[0]).members[0]).validUntil = '1000'
        path = ['governance', 'committees', 0, 'members', 0, 'validUntil'] }
      if (kind === 'fact') { value.facts.push({ id: 'item', subjectId: value.organization.rootId, scopeId: value.organization.rootId,
        body: 'Fact', effectiveFrom: '0', effectiveUntil: '1000', availableAt: '0', audience: { kind: 'public' } }); path = ['facts', 0, 'effectiveUntil'] }
      if (kind === 'norm') { advisory(value); required(value.governance.norms[0]).effectiveUntil = '1000'; path = ['governance', 'norms', 0, 'effectiveUntil'] }
      if (kind === 'knowledge') { value.knowledge.push({ id: 'item', ownerId: personId, body: 'Belief', observedAt: '0', availableAt: '0',
        validFrom: '0', validUntil: '1000', readers: [] }); path = ['knowledge', 0, 'validUntil'] }
      if (kind === 'goal') { required(value.behavior.initialGoals[0]).at = '1000'; path = ['behavior', 'initialGoals', 0, 'at'] }
      if (kind === 'calendar') { value.behavior.calendars.push({ id: 'item', target: { kind: 'person', personId }, body: 'Goal', startsAt: '0',
        endsAt: '1000', period: '1', maxOccurrences: 1 }); path = ['behavior', 'calendars', 0, 'endsAt'] }
    })
    assert.deepEqual(validateV1Relationships(value, deployment), [])
    // Change only the selected endpoint; the mutation remains strict-shape valid.
    let target: unknown = value
    for (const part of path.slice(0, -1)) {
      assert.ok(target !== null && typeof target === 'object'); target = Reflect.get(target, part)
    }
    assert.ok(target !== null && typeof target === 'object'); Reflect.set(target, required(path.at(-1)), '1001')
    check(worldScenarioV1Schema.parse(value), 'time-horizon', path)
  })
test('initial goals and calendars cannot collide across their two source kinds', () => {
  check(changed((value) => { value.behavior.calendars.push({ id: required(value.behavior.initialGoals[0]).id,
    target: { kind: 'person', personId }, body: 'Goal', startsAt: '0', endsAt: null, period: '1', maxOccurrences: 1 }) }),
  'duplicate-id', ['behavior', 'calendars', 0, 'id'])
})
test('pure semantic diagnostics neither mutate inputs nor disclose authored facts or private beliefs', () => {
  const value = changed((value) => { value.limits.native.maxKnowledgeBytes = 1 }), catalog = structuredClone(deployment)
  const before = structuredClone({ value, catalog })
  validateV1Relationships(value, catalog)
  assert.deepEqual({ value, catalog }, before)
})

test('whitespace objectives and template-admitted blank personas reject before Team or Participant preparation', () => {
  check(changed((value) => { value.metadata.description = '  \t  ' }), 'invalid-shape', ['metadata', 'description'])
  const value = structuredClone(sample), catalog = structuredClone(deployment)
  const index = value.entities.findIndex(value => value.kind === 'person' && value.cognition === 'agent')
  const actor = required(value.entities[index]); assert.ok(actor.kind === 'person' && actor.cognition === 'agent')
  actor.persona.name = '  '
  required(catalog.templates.find(value => value.template.id === actor.template.id)).template.names.push('  ')
  check(worldScenarioV1Schema.parse(value), 'invalid-shape', ['entities', index, 'persona', 'name'], catalog)
})
