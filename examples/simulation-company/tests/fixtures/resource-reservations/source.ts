import { simulationResourceSpecSchema } from '@clocky/clocky-simulation'
/** Original v1 data allocates no funds outside the declared conserved accounts. */
import { worldScenarioV1Schema, scenarioV1CatalogSchema } from '@clocky/clocky-simulation-scenario'
import { worldV1Definition, worldV1Catalog } from '../world-v1-product/deployment.ts'
const source = structuredClone(worldV1Definition), catalog = structuredClone(worldV1Catalog)
export const resourceActorId = source.organization.assignments[0]!.personId
source.behavior = { initialGoals: [], calendars: [], directorEvents: [] }
source.facts = []; source.knowledge = []; source.governance.norms = []
source.resources = [{ id: 'cash', owner: source.organization.rootId, controllers: [resourceActorId], kind: 'money', unit: 'credit', quantity: '10' },
  { id: 'payee', owner: 'outside-vendor', controllers: [], kind: 'money', unit: 'credit', quantity: '0' }].map(value => simulationResourceSpecSchema.parse(value))
source.limits.native.maxResourceReservationHistory = 3
catalog.runtimeProfiles = catalog.runtimeProfiles.filter(value => value.version !== 'unavailable-model')
for (const row of catalog.runtimeProfiles) row.model.provider = 'resource-reservation-scripted'
export const resourceDefinition = worldScenarioV1Schema.parse(source)
export const resourceCatalog = scenarioV1CatalogSchema.parse(catalog)
