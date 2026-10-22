/** Original v1 source gives calendar recipients distinct before/after roles and a real future response. */
import { simulationEntityIdSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { worldScenarioV1Schema, scenarioV1CatalogSchema } from '@clocky/clocky-simulation-scenario'
import { worldV1Definition, worldV1Catalog } from '../world-v1-product/deployment.ts'
const definition = structuredClone(worldV1Definition), catalog = structuredClone(worldV1Catalog)
catalog.native.maxTime = '6'
catalog.limits.defaults.world.maxBytesPerPlan = 16384
catalog.limits.ceilings.world.maxBytesPerPlan = 16384
const requester = definition.organization.assignments[0]!.personId, position = definition.organization.positions[0]!.id
const director = definition.entities.find(value => value.kind === 'person' && value.cognition === 'agent' && value.role === 'director')!
const observer = definition.entities.find(value => value.kind === 'person' && value.cognition === 'agent'
  && value.role === 'member' && value.id !== requester)!
definition.organization.positions.push({ id: 'standby-position', name: 'Standby', description: 'Continued root employment without the old office.',
  unitId: definition.organization.rootId, capacity: 1, permissions: [] })
definition.facts[0]!.id = 'director-only-canary'
definition.governance.norms[0] = { id: 'time-institution', scopeId: definition.organization.rootId, body: 'This institution is effective only on [4,5).',
  effectiveFrom: '4', effectiveUntil: '5', availableAt: '4', audience: { kind: 'actors', entityIds: [simulationEntityIdSchema.parse(director.id)] },
  enforcement: { kind: 'advisory' } }
definition.externalWorld.identities[0]!.externalKey = 'mediated-vendor'
definition.externalWorld.adjudicationPolicy = { ref: 'clocky.external.adjudication/1', version: '1', generation: 1,
  conditionInstalls: ['lead-time'], futureConditionInstalls: ['lead-time'],
  allowedOutcomeKinds: ['delayed-event', 'environmental-fact', 'unverified-report', 'failure'],
  maxDelay: simTimeSchema.parse('6'), allowPublicDisclosure: false, allowScopeDisclosure: false, actorDisclosure: [] }
definition.behavior.initialGoals = []
definition.behavior.calendars = [{ id: 'office-calendar', body: 'delayed', target: { kind: 'position', positionId: position },
  startsAt: '1', endsAt: '3', period: '2', maxOccurrences: 2 }]
definition.limits.native.maxDriveSteps = 1
export const calendarDefinition = worldScenarioV1Schema.parse(definition)
export const calendarCatalog = scenarioV1CatalogSchema.parse(catalog)
export const calendarActors = { requester, observer: observer.id, director: director.id, position }
