/** Real Loader catalog admission probes; no run, actor, model or external execution is allocated. */
import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { boot } from '@clocky/clocky-app-boot'
import {
  WORLD_GENERATE_AND_HIRE_PIN, WORLD_HIRE_EXISTING_PIN, WORLD_TRANSFER_PIN, WORLD_DEPART_PIN,
  WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN, WORLD_GOVERNANCE_HIRE_APPROVAL_PIN,
  WORLD_NORM_ENACT_PIN, WORLD_NORM_REVOKE_PIN, WORLD_EXTERNAL_INTERACT_PIN, WORLD_EXTERNAL_ACTOR_PIN,
  WORLD_EXTERNAL_MEDIATED_PIN, WORLD_HIRING_MARKET_PIN, WORLD_GOVERNANCE_DELEGATE_PIN, WORLD_GOVERNANCE_ROUTE_PIN,
  WORLD_ENVIRONMENT_PIN, WORLD_EXPERIENCE_PIN, WORLD_LOCAL_OBJECT_PIN, WORLD_REPRESENTATION_PIN,
  SimulationWorldDomainError,
} from '@clocky/clocky-simulation'
import * as WorldProtocol from '@clocky/clocky-simulation'
import type { SimulationWorldDomainPin } from '@clocky/clocky-simulation'

const hash = `sha256:${'a'.repeat(64)}`
const proposal = { committeeId: 'committee', scopeId: 'organization', body: 'Original proposal',
  policyRef: 'clocky.governance/1', rule: { kind: 'unanimity' }, quorum: 1, deadline: '10' }
const norm = { norm: { id: 'norm', version: '2' }, prior: { id: 'norm', version: '1' },
  proposal: { id: 'proposal', revision: 1, bodyHash: hash }, resolution: { id: 'resolution', hash }, scope: 'organization',
  body: 'Original institution', effectiveFrom: '1', effectiveUntil: null, availableAt: '1',
  audience: { kind: 'public' }, impact: 'future-admissions' }
const personnel = { organizationEntityId: 'organization', personId: 'person', assignmentId: 'assignment', assignmentRevision: 1,
  requestedEffectiveAt: null, description: 'Original personnel change' }
const external = { scope: 'organization', externalKey: 'supplier', subjectRef: 'supplier' }
const supply = { scopeEntityId: 'organization', targetEntityId: 'warehouse', demand: 2 }
const experience = { scopeEntityId: 'organization', targetEntityId: 'person', personId: 'person',
  field: 'skill', key: 'negotiation', previous: 0, next: 2, sourceIntentId: 'source-intent', effectiveAt: '1', validUntil: '10' }
const rename = { scopeEntityId: 'organization', targetEntityId: 'display-object', entityRevision: 1, name: 'Renamed object' }
const representationSwitch = { scopeEntityId: 'organization', targetEntityId: 'supplier', identityId: 'supplier-identity',
  expectedGeneration: 1, from: 'simulated-rule', to: 'director-mediated' }
const cases: Array<{ pin: SimulationWorldDomainPin; payload: object; plan?: object; mutation?: object; result?: object }> = [
  { pin: WORLD_ENVIRONMENT_PIN, payload: supply, mutation: { ...supply, implementation: 'supply-fixed/1',
    production: 3, consumed: 2, previousInventory: 4, inventory: 5, time: '1', simulated: true } },
  { pin: WORLD_EXPERIENCE_PIN, payload: experience },
  { pin: WORLD_LOCAL_OBJECT_PIN, payload: rename, result: { ...rename, previousName: 'Original object',
    execution: { kind: 'local', owner: 'native' } } },
  { pin: WORLD_REPRESENTATION_PIN, payload: representationSwitch, mutation: { ...representationSwitch,
    generation: 2, sourceRevision: 1, identitySequence: 1, time: '1', memory: 'none', obligations: 'no-pending-representation-io' } },
  { pin: WORLD_HIRING_MARKET_PIN, payload: { kind: 'vacancy', id: 'vacancy', organizationEntityId: 'organization',
    positionEntityId: 'position', validUntil: '10', capacity: 1, requirements: [], reservationPolicy: 'on-acceptance' } },
  { pin: WORLD_GOVERNANCE_DELEGATE_PIN, payload: { proposalId: 'proposal', proposalRevision: 1, bodyHash: hash,
    delegateId: 'delegate', expiresAt: '9', revoked: false }, plan: { kind: 'acknowledge' } },
  { pin: WORLD_GOVERNANCE_ROUTE_PIN, payload: { id: 'route', revision: 1, mode: 'ordered', bodyHash: hash,
    membershipPolicy: 'frozen', deadline: '10', steps: [{ id: 'first', proposalId: 'proposal', proposalRevision: 1,
      dependsOn: [] }] }, plan: { kind: 'acknowledge' } },
  { pin: WORLD_GENERATE_AND_HIRE_PIN, payload: { organizationEntityId: 'organization', positionEntityId: 'position', description: 'Hire' },
    plan: { templateId: 'person', templateVersion: '1', persona: { name: 'Person', skills: [], traits: [], goals: [] } },
    mutation: { maintenanceId: 'original-maintenance' } },
  { pin: WORLD_HIRE_EXISTING_PIN, payload: { organizationEntityId: 'organization', positionEntityId: 'position', personId: 'person', description: 'Hire' } },
  { pin: WORLD_TRANSFER_PIN, payload: { ...personnel, targetPositionId: 'target' } },
  { pin: WORLD_DEPART_PIN, payload: { ...personnel, retire: true } },
  { pin: WORLD_GOVERNANCE_PROPOSE_PIN, payload: { ...proposal, target: { kind: 'norm', norm: { id: 'norm', version: '1' } } }, plan: { kind: 'acknowledge' } },
  { pin: WORLD_GOVERNANCE_VOTE_PIN, payload: { proposalId: 'proposal', proposalRevision: 1, bodyHash: hash, choice: 'yes' }, plan: { kind: 'acknowledge' } },
  { pin: WORLD_GOVERNANCE_HIRE_APPROVAL_PIN, payload: { ...proposal, target: { kind: 'hire-approval', approval: {
    intentId: 'intent', requestId: 'request', requestHash: hash, scopeId: 'organization', positionId: 'position',
    norm: { id: 'norm', version: '1' }, quantity: 1,
    selection: { kind: 'existing-person', personId: 'person', entityRevision: 1, profileHash: hash },
  } } }, plan: { kind: 'acknowledge' } },
  { pin: WORLD_NORM_ENACT_PIN, payload: { ...norm, enforcement: { kind: 'validated',
    policyRef: 'clocky.organization.hiring-approval/1', params: { committeeId: 'committee', positionIds: ['position'], maxHires: 1 } } } },
  { pin: WORLD_NORM_REVOKE_PIN, payload: norm },
  { pin: WORLD_EXTERNAL_INTERACT_PIN, payload: { ...external, sourceKind: 'simulated-rule',
    policyRef: 'clocky.external.availability/1', input: { kind: 'availability', unit: 'item' } }, plan: { kind: 'evaluate-rule' } },
  { pin: WORLD_EXTERNAL_ACTOR_PIN, payload: { ...external, sourceKind: 'simulated-actor',
    policyRef: 'clocky.external.representative/1', input: { kind: 'contact', unit: 'item' } },
  plan: { kind: 'reuse', identityId: 'original-supplier', generation: 1 }, mutation: { kind: 'representation-owned' } },
  { pin: WORLD_EXTERNAL_MEDIATED_PIN, payload: { ...external, sourceKind: 'director-mediated',
    policyRef: 'clocky.external.adjudication/1', input: { kind: 'adjudicate', question: 'Availability?' },
    responseScope: { allowed: ['failure'], disclosure: { kind: 'requester' } } },
  plan: { kind: 'adjudicate', outcome: { kind: 'failure', subjectRef: 'supplier', sourceKind: 'director-mediated',
    policyRef: 'clocky.external.adjudication/1', attribution: 'scenario-generated', evidence: [],
    disclosure: { kind: 'requester' }, code: 'unavailable', description: 'No observation available' } },
  mutation: { kind: 'apply-original-adjudication' } },
]
function extensions(value: unknown, path = '$'): Array<{ path: string; value: unknown }> {
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return (value as unknown[]).flatMap((item, index) => extensions(item, `${path}[${index}]`).map(change => ({
    path: change.path, value: (value as unknown[]).map((original, selected) => selected === index ? change.value : original),
  })))
  const entries = Object.entries(value)
  return [{ path, value: { ...value, unexpectedAuthority: 'injected' } }, ...entries.flatMap(([key, item]) =>
    extensions(item, `${path}.${key}`).map(change => ({ path: change.path, value: { ...value, [key]: change.value } })))]
}
function refuses(action: () => unknown, code: string): void {
  assert.throws(action, error => error instanceof SimulationWorldDomainError && error.code === code)
}
const exportedPins = Object.entries(WorldProtocol).filter(([name]) => /^WORLD_.+_PIN$/.test(name)).map(([, value]) => value)
assert.deepEqual(new Set(cases.map(value => value.pin)), new Set(exportedPins))
const root = process.env.SIMULATION_TEST_ROOT!
const ctx = await boot('world-catalog-admission', process.argv[2]!)
const registry = ctx.simulations.domains('local')
const rows: Array<{ pin: SimulationWorldDomainPin; rejectedPaths: string[] }> = []
let commits = 0
ctx.on('simulation/committed', () => { commits++ })
try {
  const before = await readdir(root, { recursive: true })
  assert.deepEqual(before, [])
  for (const { pin, payload, plan = payload, mutation = plan, result = {} } of cases) {
    const selector = { domain: pin.domain, operation: pin.operation, version: pin.version }
    assert.deepEqual(registry.pin(selector), pin)
    const lease = registry.acquire(pin)
    assert.equal(lease.implementation.definition.schemaRef, pin.schemaRef)
    assert.equal(lease.implementation.ref, pin.implementationRef)
    lease.release()
    const request = { kind: 'world/request', ...selector, businessKey: 'original', expectedTime: null, evidence: [], payload }
    assert.deepEqual(registry.parseRequest(request), request)
    const bodies = [
      { parse: registry.parseRequest.bind(registry), body: request },
      { parse: registry.parsePlan.bind(registry), body: { kind: 'world/plan', id: 'plan', requestId: 'request', intentId: 'intent',
        pin, requestRevision: 1, supersedes: null, expectedTime: null, reads: [], authority: [], payload: plan } },
      { parse: registry.parseResult.bind(registry), body: { kind: 'world/result', id: 'result', requestId: 'request',
        intentId: 'intent', planId: 'plan', pin, outcome: { kind: 'rejected', reason: 'policy' }, time: '0', sequence: 1, payload: result } },
      { parse: registry.parseMutation.bind(registry), body: { kind: 'world/mutation', id: 'mutation', requestId: 'request',
        planId: 'plan', pin, time: '0', sequence: 1, recordedAt: 0, payload: mutation } },
    ]
    const rejectedPaths: string[] = []
    for (const { parse, body } of bodies) {
      assert.deepEqual(parse(body), body)
      for (const variant of extensions(body.payload)) {
        refuses(() => parse({ ...body, payload: variant.value }), 'SIM_WORLD_SCHEMA')
        rejectedPaths.push(`${body.kind}:${variant.path}`)
      }
      refuses(() => parse({ ...body, unexpectedAuthority: true }), 'SIM_WORLD_SCHEMA')
    }
    refuses(() => registry.parseRequest({ ...request, requesterEntityId: 'forged' }), 'SIM_WORLD_SCHEMA')
    refuses(() => registry.parseRequest({ ...request, domain: 'not-installed' }), 'SIM_WORLD_DOMAIN_UNKNOWN')
    refuses(() => registry.parseRequest({ ...request, operation: 'not-installed' }), 'SIM_WORLD_OPERATION_UNKNOWN')
    refuses(() => registry.parseRequest({ ...request, version: 'not-installed' }), 'SIM_WORLD_VERSION_UNAVAILABLE')
    refuses(() => registry.acquire({ ...pin, generation: pin.generation + 1 }), 'SIM_WORLD_IMPLEMENTATION_MISMATCH')
    rows.push({ pin, rejectedPaths })
  }
  assert.equal(commits, 0)
  assert.deepEqual(await readdir(root, { recursive: true }), before)
} finally { await ctx.fiber.dispose() }
for (const { pin } of cases) {
  refuses(() => registry.acquire(pin), 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE')
  refuses(() => registry.pin({ domain: pin.domain, operation: pin.operation, version: pin.version }), 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE')
}
const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
const paths = ['@clocky/clocky-simulation', '@clocky/clocky-simulation-local'].map(name => import.meta.resolve(name))
assert.ok(paths.every(path => path.includes(face === 'lib' ? '/lib/' : '/src/')))
if (face === 'lib') assert.deepEqual(process.execArgv, [])
process.stdout.write(JSON.stringify({ pid: process.pid, face, backend: process.env.SIMULATION_TEST_BACKEND,
  paths, commits, rows, unloaded: true }) + '\n')
