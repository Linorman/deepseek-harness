/** Original v1 institutions and one finite external contact retain the deployment's unmodified budgets. */
import { WORLD_EXTERNAL_ACTOR_PIN, simulationWorldFactAudienceSchema } from '@clocky/clocky-simulation'
import { worldScenarioV1Schema, scenarioV1CatalogSchema } from '@clocky/clocky-simulation-scenario'
import { worldV1Definition, worldV1Catalog } from '../world-v1-product/deployment.ts'
const source = structuredClone(worldV1Definition), catalog = structuredClone(worldV1Catalog)
const requester = source.organization.assignments[0]!.personId
const director = source.entities.find(value => value.kind === 'person' && value.cognition === 'agent' && value.role === 'director')!.id
source.domains = [{ domain: 'external', operation: 'interact', version: '2' }]
source.organization.grants = [{ id: 'norm-contact-grant', personId: requester, domain: 'external', operation: 'interact', version: '2',
  scopeId: source.organization.rootId, targetId: 'outside-vendor', relation: 'can-interact', validFrom: '0', validUntil: null }]
source.governance = { committees: [], norms: [
  { id: 'norm-public', body: 'NORM-PUBLIC-ROLE-CANARY', audience: { kind: 'public' } },
  { id: 'norm-director', body: 'NORM-DIRECTOR-ROLE-CANARY', audience: { kind: 'actors', entityIds: [director] } },
  { id: 'norm-members', body: 'NORM-MEMBER-ROLE-CANARY', audience: { kind: 'scope-members' } },
].map(value => ({ ...value, audience: simulationWorldFactAudienceSchema.parse(value.audience), scopeId: source.organization.rootId, effectiveFrom: '0', effectiveUntil: null, availableAt: '0',
  enforcement: { kind: 'advisory' } })) }
source.facts = []; source.knowledge = []
source.externalWorld.identities = source.externalWorld.identities.map(value => ({ ...value, representation: 'simulated-actor' }))
source.behavior = { initialGoals: [{ id: 'norm-contact', kind: 'goal', at: '0', target: { kind: 'person', personId: requester },
  body: 'norm-role-contact/vendor/widget' }], calendars: [], directorEvents: [] }
catalog.runtimeProfiles = catalog.runtimeProfiles.filter(value => value.version !== 'unavailable-model')
for (const runtime of catalog.runtimeProfiles) runtime.model.provider = 'world-external-actor-scripted'
catalog.domains = [{ pin: WORLD_EXTERNAL_ACTOR_PIN, available: true }]
export const definition = worldScenarioV1Schema.parse(source)
export const deployment = scenarioV1CatalogSchema.parse(catalog)
export const originalBudgets = { native: worldV1Catalog.native, defaults: worldV1Catalog.limits.defaults,
  ceilings: worldV1Catalog.limits.ceilings, limits: worldV1Definition.limits }
export const roles = { member: requester, director }
