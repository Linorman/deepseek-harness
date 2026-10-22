/** Shared trusted committee composition; independent ballots still originate in real Agent decisions. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { simulationWorldDefinitionSchema, WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN } from '@clocky/clocky-simulation'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'

const scenario = process.env.WORLD_SCENARIO
assert.ok(scenario === 'company' || scenario === 'laboratory')
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(`examples/simulation-company/scenarios/world-${scenario}.json`, 'utf8')))
const members = definition.actors.filter(value => value.role === 'member')
assert.equal(members.length, 2)
const selected = (() => {
  const [proposer, voter] = members
  assert.ok(proposer && voter)
  return { proposer, voter }
})()
const { proposer, voter } = selected
definition.assignments.push({ id: 'voter-assignment', personId: voter.id, positionId: definition.positions[0]!.id })
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-governance-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok)
const original = compiled.resolved, org = original.world.organizationEntityId, committee = 'policy-committee'
const permissions = [{ entityId: proposer.id, pin: WORLD_GOVERNANCE_PROPOSE_PIN, relation: 'can-propose-norm' },
  ...members.map(value => ({ entityId: value.id, pin: WORLD_GOVERNANCE_VOTE_PIN, relation: 'can-vote' }))]
const world = simulationWorldDefinitionSchema.parse({ ...original.world,
  operations: [WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN], authorizations: [],
  operationGrants: permissions.map(value => ({ requesterEntityId: value.entityId, domain: value.pin.domain,
    operation: value.pin.operation, version: value.pin.version, targetEntityId: committee, scopeEntityId: org,
    relation: value.relation, relationId: `permission:${value.relation}:${value.entityId}` })) })
const resolved: ResolvedWorldScenario = { ...original, world, initialEvents: [],
  native: { ...original.native, relationRules: [...original.native.relationRules,
    ...['committee-member', 'can-propose-norm', 'can-vote'].map(relation => ({ relation, subjectKinds: ['person'],
      objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }))] },
  entities: [...original.entities, { kind: 'entity/create', id: committee, entityKind: 'organization', cognition: 'none',
    readiness: 'ready', profile: { name: 'Policy committee', description: 'Frozen independent electorate for institutional proposals.' } }],
  relations: [...original.relations, ...members.map(value => ({ kind: 'relation/create' as const, id: `membership:${value.id}`,
    subject: value.id, relation: 'committee-member', object: committee, scope: org, validFrom: '0' as const, validUntil: null })),
  ...permissions.map(value => ({ kind: 'relation/create' as const, id: `permission:${value.relation}:${value.entityId}`,
    subject: value.entityId, relation: value.relation, object: committee, scope: org, validFrom: '0' as const, validUntil: null }))] }
const { definitionHash: _hash, ...body } = resolved
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}` })

export { scenario, members, proposer, voter, resolved, org }
