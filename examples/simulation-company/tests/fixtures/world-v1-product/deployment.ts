/** Test-only installed catalog and portable original data use the real product service through the Loader. */
import { readFile } from 'node:fs/promises'
import type { Context } from '@clocky/cordis'
import Products from '@clocky/clocky-simulation-product'
import Administration from '@clocky/clocky-simulation-product/administration'
import { WORLD_GENERATE_AND_HIRE_PIN, WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN,
  WORLD_EXTERNAL_MEDIATED_PIN } from '@clocky/clocky-simulation'
import { worldScenarioSchema, worldScenarioV1Schema, scenarioV1CatalogSchema } from '@clocky/clocky-simulation-scenario'
import { catalog } from '../../../../../packages/simulation/simulation-scenario/tests/fixtures.ts'

export const name = 'world-v1-product-deployment'
export const inject = ['storageLog', 'simulations', 'simulationTeams', 'teams', 'llm', 'agentRuntimes', 'agentPresets']
const installed = catalog()
const profile = installed.runtimeProfiles[0]!
profile.model = { provider: 'world-external-mediated-scripted', name: 'scripted', version: '1', available: true }
const pins = [WORLD_GENERATE_AND_HIRE_PIN, WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN, WORLD_EXTERNAL_MEDIATED_PIN]
export const worldV1Catalog = scenarioV1CatalogSchema.parse({ ...installed,
  runtimeProfiles: [...installed.runtimeProfiles, { ...profile, version: 'unavailable-model',
    model: { provider: 'unavailable-world-v1-model', name: 'scripted', version: '1', available: true } }],
  domains: [...pins.map(pin => ({ pin, available: true })), { pin: { ...WORLD_EXTERNAL_MEDIATED_PIN,
    version: 'uninstalled-version', implementationRef: 'uninstalled-v1-product-operation' }, available: true }],
  factSchemas: ['clocky.world-fact/text/1'], normPolicies: ['clocky.organization.hiring-approval/1'] })
const legacy = worldScenarioSchema.parse(JSON.parse(await readFile('examples/simulation-company/scenarios/world-company.json', 'utf8')))
const rootId = legacy.organization.id, requester = legacy.actors.find(value => value.role === 'member'
  && legacy.assignments.some(assignment => assignment.personId === value.id))!, director = legacy.actors.find(value => value.role === 'director')!
const reference = { id: profile.id, version: profile.version }
export const worldV1Definition = worldScenarioV1Schema.parse({ apiVersion: 'clocky.world/v1', metadata: legacy.metadata,
  runtimeProfiles: { allowed: [reference], generated: reference, templates: legacy.templates },
  domains: pins.map(({ domain, operation, version }) => ({ domain, operation, version })),
  entities: [{ ...legacy.organization, kind: 'organization', cognition: 'none' },
    { id: 'managed-unit', name: 'Managed unit', description: 'A real declared child unit.', kind: 'organization', cognition: 'none' },
    { id: 'outside-vendor', name: 'Vendor', description: 'An unexpanded outside party.', kind: 'organization', cognition: 'none' },
    ...legacy.actors.map((value) => { const template = installed.templates.find(item => item.template.id === value.template.id)!
      return { id: value.id, name: value.persona?.name ?? template.defaultPersona.name, description: template.template.description,
        kind: 'person', cognition: 'agent', role: value.role, runtimeProfile: reference, template: value.template,
        persona: { ...template.defaultPersona, ...value.persona } } })],
  organization: { rootId, units: [{ id: 'managed-unit', parentId: rootId }],
    positions: legacy.positions.map(value => ({ ...value, description: value.name, unitId: 'managed-unit', permissions: [] })),
    assignments: legacy.assignments.map(value => ({ ...value, validFrom: '0', validUntil: null })),
    grants: [...legacy.authorizations.map(value => ({ id: value.id, personId: value.requesterId, domain: 'organization',
      operation: 'generate-and-hire', version: '1', scopeId: rootId, targetId: value.positionId, relation: 'can-hire',
      validFrom: '0', validUntil: null })),
    ...[WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN].map(pin => ({ id: `permission-${pin.operation}`, personId: requester.id,
      domain: pin.domain, operation: pin.operation, version: pin.version, scopeId: rootId, targetId: 'original-committee',
      relation: `can-${pin.operation}`, validFrom: '0', validUntil: null })),
    { id: 'permission-interact', personId: requester.id, domain: 'external', operation: 'interact', version: '3',
      scopeId: rootId, targetId: 'outside-vendor', relation: 'can-interact', validFrom: '0', validUntil: null }] },
  governance: { committees: [{ id: 'original-committee', name: 'Committee', description: 'The exact original electorate.', scopeId: rootId,
    members: [{ id: 'original-membership', personId: requester.id, validFrom: '0', validUntil: null }],
    rule: { kind: 'unanimity' }, quorum: 1 }],
  norms: [{ id: 'initial-hiring-policy', scopeId: rootId, body: 'An authored institution without a fabricated vote or resolution.',
    effectiveFrom: '0', effectiveUntil: '10', availableAt: '0', audience: { kind: 'public' },
    enforcement: { kind: 'validated', policyRef: 'clocky.organization.hiring-approval/1',
      params: { maxHires: 1, committeeId: 'original-committee', positionIds: legacy.positions.map(value => value.id) } } }] },
  facts: [{ id: 'original-private-fact', subjectId: rootId, scopeId: rootId, body: 'PRIVATE-C30-DIRECTOR-FACT-CANARY',
    effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'actors', entityIds: [director.id] } }],
  knowledge: [{ id: 'original-belief', ownerId: requester.id, body: 'PRIVATE-C30-BELIEF-CANARY', observedAt: '0', availableAt: '0',
    validFrom: '0', validUntil: null, readers: [] }],
  resources: [{ id: 'supplier-stock', owner: 'outside-vendor', kind: 'inventory', unit: 'widget', quantity: '7', controllers: [] }],
  communication: { channels: [{ key: 'original-workroom', members: legacy.actors.map(value => ({ personId: value.id, role: value.role })) }] },
  externalWorld: { mode: 'simulated-only', identities: [{ scopeId: rootId, externalKey: 'vendor', subjectId: 'outside-vendor',
    representation: 'director-mediated' }], adjudicationPolicy: { ref: 'clocky.external.adjudication/1', version: '1', generation: 1,
    conditionInstalls: [], futureConditionInstalls: [], allowedOutcomeKinds: ['failure'], maxDelay: '10',
    allowPublicDisclosure: false, allowScopeDisclosure: false, actorDisclosure: [] } },
  behavior: { initialGoals: [{ id: 'ordinary-stock-goal', kind: 'goal', at: '1', body: 'stock', target: { kind: 'person', personId: requester.id } }],
    calendars: [{ id: 'finite-stock-calendar', startsAt: '3', endsAt: '7', period: '2', maxOccurrences: 3,
      body: 'stock', target: { kind: 'position', positionId: legacy.positions[0]!.id } }], directorEvents: [] },
  limits: { native: {}, team: {}, world: {} } })

/** @param ctx - Actual Loader service graph; only installed metadata is provided here. */
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(Products, { directoryStream: 'c30-v1-products' })
  await ctx.plugin(Administration, { journalStream: 'c30-v1-commands', templates: [], recoveryPageSize: 2,
    world: { provider: 'local', catalog: worldV1Catalog, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } } })
}
