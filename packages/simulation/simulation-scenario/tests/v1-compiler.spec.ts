/** Portable v1 decoding, semantic rejection and exact frozen compilation operate without a live run. */
import assert from 'node:assert/strict'
import { it as test } from 'vitest'
import { WORLD_GENERATE_AND_HIRE_PIN } from '@clocky/clocky-simulation/world-domains'
import { worldScenarioV1Schema } from '../src/v1-schema.ts'
import { validateV1Relationships } from '../src/v1-validation.ts'
import { compileWorldScenarioV1 } from '../src/v1-compiler.ts'
import type { WorldScenarioV1 } from '../src/v1-schema.ts'

import { sample, deployment, legacy } from './v1-fixtures.ts'

function changed(action: (value: WorldScenarioV1) => void): WorldScenarioV1 {
  const value = structuredClone(sample); action(value); return worldScenarioV1Schema.parse(value)
}
function diagnostic(value: WorldScenarioV1, code: string, path: readonly (string | number)[]) {
  const output = validateV1Relationships(value, deployment)
  assert.ok(output.some(item => item.code === code && JSON.stringify(item.path) === JSON.stringify(path)), JSON.stringify(output))
}
test('a complete explicit v1 definition validates without modifying its portable input or catalog', () => {
  const before = structuredClone({ sample, deployment, legacy })
  assert.deepEqual(validateV1Relationships(sample, deployment), [])
  assert.deepEqual({ sample, deployment, legacy }, before)
})
test('old format and executable or resolved fields cannot be silently accepted as v1', () => {
  assert.equal(worldScenarioV1Schema.safeParse(legacy).success, false)
  for (const field of ['credentials', 'include', 'implementation', 'runId', 'sessionId'])
    assert.equal(worldScenarioV1Schema.safeParse({ ...sample, [field]: 'forbidden' }).success, false)
  assert.equal(worldScenarioV1Schema.safeParse({ ...sample, externalWorld: { ...sample.externalWorld, mode: 'network' } }).success, false)
})
test('duplicate entity identities are field-local even when their display names are equal', () => {
  diagnostic(changed((value) => { value.entities.push(value.entities[0]!) }), 'duplicate-id', ['entities', sample.entities.length, 'id'])
})
test('unknown domain versions and declared-but-unavailable profiles reject before bootstrap', () => {
  diagnostic(changed((value) => { value.domains[0]!.version = 'unsupported' }), 'domain-unavailable', ['domains', 0])
  const unavailable = structuredClone(deployment); unavailable.runtimeProfiles[0]!.model.available = false
  assert.ok(validateV1Relationships(sample, unavailable).some(item => item.code === 'model-unavailable'))
})
test('undeclared actor runtimes and names outside the finite template remain distinct diagnoses', () => {
  diagnostic(changed((value) => {
    const actor = value.entities[1]!; assert.ok(actor.kind === 'person' && actor.cognition === 'agent')
    actor.runtimeProfile = { id: 'missing', version: '1' }
  }), 'unknown-reference', ['entities', 1, 'runtimeProfile'])
  diagnostic(changed((value) => {
    const actor = value.entities[1]!; assert.ok(actor.kind === 'person' && actor.cognition === 'agent')
    actor.persona.name = 'Not a finite name'
  }), 'template-choice', ['entities', 1, 'persona', 'name'])
})
test('cycles and disconnected managed units do not become an implicit second employer', () => {
  diagnostic(changed((value) => {
    value.entities.push({ id: 'unit', kind: 'organization', cognition: 'none', name: 'Unit', description: 'Unit' })
    value.organization.units.push({ id: 'unit', parentId: 'unit' })
  }), 'organization-cycle', ['organization', 'units', 0, 'parentId'])
})
test('assignment boundaries are half-open while genuine overlap and capacity excess reject', () => {
  const original = sample.organization.assignments[0]!
  const legal = changed((value) => {
    value.organization.assignments[0]!.validUntil = '10'
    value.organization.assignments.push({ ...original, id: 'successor', validFrom: '10' })
  })
  assert.deepEqual(validateV1Relationships(legal, deployment), [])
  diagnostic(changed((value) => { value.organization.assignments.push({ ...original, id: 'duplicate-office' }) }),
    'assignment-overlap', ['organization', 'assignments', sample.organization.assignments.length])
  const other = sample.entities.find(value => value.kind === 'person' && value.cognition === 'agent'
    && value.id !== original.personId)!
  diagnostic(changed((value) => {
    value.organization.positions[0]!.capacity = 1
    value.organization.assignments.push({ ...original, id: 'occupied-office', personId: other.id })
  }),
  'capacity', ['organization', 'positions', 0, 'capacity'])
})
test('committee thresholds and duplicate electorates cannot be made reachable by copying membership', () => {
  const personId = sample.organization.assignments[0]!.personId
  diagnostic(changed((value) => { value.governance.committees.push({ id: 'committee', name: 'Committee', description: 'Committee',
    scopeId: value.organization.rootId, members: [{ id: 'committee-member', personId, validFrom: '0', validUntil: null }],
    rule: { kind: 'absolute-threshold', yes: 2 }, quorum: 1 }) }), 'committee-threshold', ['governance', 'committees', 0, 'rule'])
})
test('bad fact audience and expired horizon have independent field paths', () => {
  const value = changed((value) => { value.facts.push({ id: 'fact', subjectId: value.organization.rootId, scopeId: value.organization.rootId,
    body: 'Text', effectiveFrom: '0', effectiveUntil: null, availableAt: '1001', audience: { kind: 'actors', entityIds: ['missing' as never] } }) })
  diagnostic(value, 'unknown-reference', ['facts', 0, 'audience', 'entityIds', 0])
  diagnostic(value, 'time-horizon', ['facts', 0, 'availableAt'])
})
test('unknown resources and noncognitive controllers are rejected without inferring ownership', () => {
  diagnostic(changed((value) => { value.resources.push({ id: 'stock' as never, owner: value.organization.rootId as never,
    unit: 'widget', kind: 'inventory', quantity: '7' as never, controllers: [value.organization.rootId as never] }) }),
  'invalid-reference', ['resources', 0, 'controllers', 0])
})
test('simulated external keys are scoped and cannot claim the managed root as their subject', () => {
  diagnostic(changed((value) => { value.externalWorld.identities.push({ scopeId: value.organization.rootId, externalKey: 'vendor',
    subjectId: value.organization.rootId, representation: 'simulated-rule' }) }), 'invalid-reference', ['externalWorld', 'identities', 0, 'subjectId'])
})
test('calendar bounds constrain actual final occurrence rather than expanding unlimited future work', () => {
  diagnostic(changed((value) => { value.behavior.calendars.push({ id: 'calendar', target: { kind: 'person',
    personId: value.organization.assignments[0]!.personId }, body: 'Goal', startsAt: '1', endsAt: null, period: '10', maxOccurrences: 101 }) }),
  'time-horizon', ['behavior', 'calendars', 0, 'maxOccurrences'])
})
test('compiler freezes complete effective defaults, pins, models and ordinary goals without a prebuilt HireIntent', async () => {
  const result = await compileWorldScenarioV1(sample, deployment)
  assert.ok(result.ok)
  assert.equal(result.resolved.apiVersion, 'clocky.world/v1')
  assert.deepEqual(result.resolved.world.operations, [WORLD_GENERATE_AND_HIRE_PIN])
  assert.deepEqual(result.resolved.bootstrap.behavior.initialGoals, sample.behavior.initialGoals)
  assert.deepEqual(result.resolved.bootstrap.externalIdentities, [])
  assert.equal(Object.hasOwn(result.resolved, 'initialEvents'), false)
  assert.equal(result.preview.creationMode, 'paused')
  assert.equal(result.preview.source, 'simulated-only')
  assert.equal(Object.isFrozen(result.resolved), true)
  assert.equal(Object.isFrozen(result.resolved.actors[0]!.runtime.model), true)
})
test('compiler canonical commitment is format-independent and notices a complete deployment change', async () => {
  const json = await compileWorldScenarioV1(JSON.stringify(sample), deployment)
  const { stringify } = await import('yaml')
  const yaml = await compileWorldScenarioV1(stringify(sample), deployment, 'yaml')
  assert.ok(json.ok && yaml.ok)
  assert.equal(json.preview.hash, yaml.preview.hash)
  const other = structuredClone(deployment); other.runtimeProfiles[0]!.model.version = 'model-2'
  const changed = await compileWorldScenarioV1(sample, other)
  assert.ok(changed.ok)
  assert.notEqual(changed.preview.hash, json.preview.hash)
  assert.equal(changed.resolved.definitionHash, json.resolved.definitionHash)
})
test('compiler retains all initial private and authoritative definitions instead of dropping fields', async () => {
  const owner = sample.organization.assignments[0]!.personId
  const withData = changed((value) => {
    value.resources.push({ id: 'stock' as never, owner: value.organization.rootId as never,
      kind: 'inventory', unit: 'widget', quantity: '7' as never, controllers: [owner as never] })
    value.facts.push({ id: 'notice', subjectId: value.organization.rootId, scopeId: value.organization.rootId,
      body: 'An initial announcement.', effectiveFrom: '1', effectiveUntil: null, availableAt: '0', audience: { kind: 'public' } })
    value.knowledge.push({ id: 'private', ownerId: owner, body: 'Private initial knowledge.', observedAt: '0', availableAt: '0',
      validFrom: '0', validUntil: null, readers: [] })
    value.governance.norms.push({ id: 'advisory', scopeId: value.organization.rootId, body: 'An authored advisory institution.',
      effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'public' }, enforcement: { kind: 'advisory' } })
  })
  const result = await compileWorldScenarioV1(withData, deployment)
  assert.ok(result.ok)
  assert.deepEqual(result.resolved.bootstrap.resources, withData.resources)
  assert.deepEqual(result.resolved.bootstrap.facts, withData.facts)
  assert.deepEqual(result.resolved.bootstrap.knowledge, withData.knowledge)
  assert.deepEqual(result.resolved.bootstrap.norms, withData.governance.norms)
})
