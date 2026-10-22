/** Two independent scene requests share a finite scheduler with ordinary member work. */
import { WORLD_EXTERNAL_INTERACT_PIN, WORLD_EXTERNAL_MEDIATED_PIN, simTimeSchema } from '@clocky/clocky-simulation'
import { scenarioV1CatalogSchema, worldScenarioV1Schema } from '@clocky/clocky-simulation-scenario'
import { worldV1Catalog, worldV1Definition } from '../world-v1-product/deployment.ts'
const source = structuredClone(worldV1Definition), catalog = structuredClone(worldV1Catalog)
const director = source.entities.find(value => value.kind === 'person' && value.cognition === 'agent' && value.role === 'director')!
const member = source.organization.assignments[0]!.personId
export const directorVariant = process.env.WORLD_DIRECTOR_VARIANT ?? 'rule'
const version = directorVariant === 'mediated' ? '3' : '1'
const pin = version === '3' ? WORLD_EXTERNAL_MEDIATED_PIN : WORLD_EXTERNAL_INTERACT_PIN
catalog.runtimeProfiles = catalog.runtimeProfiles.filter(value => value.version !== 'unavailable-model')
for (const value of catalog.runtimeProfiles) value.model.provider = 'world-director-events-scripted'
catalog.domains = [{ pin, available: true, directorEvents: true }]
catalog.native.maxTime = '4'
source.domains = [{ domain: 'external', operation: 'interact', version }]
source.organization.grants = [{ id: 'ordinary-availability-grant', personId: member, domain: 'external', operation: 'interact',
  version, scopeId: source.organization.rootId, targetId: 'outside-vendor', relation: 'can-interact', validFrom: '0', validUntil: null }]
source.governance.norms = []
source.externalWorld.identities[0]!.representation = version === '3' ? 'director-mediated' : 'simulated-rule'
source.externalWorld.adjudicationPolicy!.allowedOutcomeKinds = ['delayed-event', 'failure', 'environmental-fact']
source.externalWorld.adjudicationPolicy!.conditionInstalls = ['lead-time']
source.externalWorld.adjudicationPolicy!.futureConditionInstalls = ['lead-time']
source.externalWorld.adjudicationPolicy!.maxDelay = simTimeSchema.parse('4')
if (version === '3') {
  catalog.limits.defaults.world.maxBytesPerPlan = 16384
  catalog.limits.ceilings.world.maxBytesPerPlan = 16384
}
source.behavior.initialGoals = [1, 2, 3].map(at => ({ id: `ordinary-${at}`, kind: 'goal' as const, at: String(at),
  target: { kind: 'person' as const, personId: member }, body: `ordinary-${at}` }))
source.behavior.calendars = [{ id: 'environment-calendar', startsAt: '1', endsAt: '3', period: '1', maxOccurrences: 3,
  target: { kind: 'person', personId: director.id }, body: 'Read the existing environment through the installed availability rule.' }]
source.behavior.directorEvents = [{ id: 'environment-declaration', calendarId: 'environment-calendar',
  domain: 'external', operation: 'interact', version, scopeId: source.organization.rootId, targetId: 'outside-vendor', maxRequests: 2 }]
source.limits.native.maxDriveSteps = 1
export const directorDefinition = worldScenarioV1Schema.parse(source)
export const directorCatalog = scenarioV1CatalogSchema.parse(catalog)
export const directorActors = { director: director.id, member }
