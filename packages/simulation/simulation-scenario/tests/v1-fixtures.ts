/** Explicit portable v1 fixture and trusted finite deployment used by compiler and preparation tests. */
import { readFile } from 'node:fs/promises'
import { WORLD_GENERATE_AND_HIRE_PIN } from '@clocky/clocky-simulation/world-domains'
import { catalog } from './fixtures.ts'
import { worldScenarioSchema } from '../src/schema.ts'
import { worldScenarioV1Schema, scenarioV1CatalogSchema } from '../src/v1-schema.ts'

const installed = catalog()
export const legacy = worldScenarioSchema.parse(JSON.parse(await readFile('examples/simulation-company/scenarios/world-company.json', 'utf8')))
const profile = legacy.runtimeProfile
export const sample = worldScenarioV1Schema.parse({ apiVersion: 'clocky.world/v1', metadata: legacy.metadata,
  runtimeProfiles: { allowed: [profile], generated: profile, templates: legacy.templates },
  domains: [{ domain: WORLD_GENERATE_AND_HIRE_PIN.domain, operation: WORLD_GENERATE_AND_HIRE_PIN.operation,
    version: WORLD_GENERATE_AND_HIRE_PIN.version }],
  entities: [{ ...legacy.organization, kind: 'organization', cognition: 'none' }, ...legacy.actors.map((value) => {
    const template = installed.templates.find(item => item.template.id === value.template.id)!
    return { id: value.id, name: value.persona?.name ?? template.defaultPersona.name, description: template.template.description,
      kind: 'person', cognition: 'agent', role: value.role, runtimeProfile: value.runtimeProfile ?? profile, template: value.template,
      persona: { ...template.defaultPersona, ...value.persona } }
  })],
  organization: { rootId: legacy.organization.id, units: [], positions: legacy.positions.map(value => ({ ...value,
    description: value.name, unitId: legacy.organization.id, permissions: [] })),
  assignments: legacy.assignments.map(value => ({ ...value, validFrom: '0', validUntil: null })),
  grants: legacy.authorizations.map(value => ({ id: value.id, personId: value.requesterId, domain: WORLD_GENERATE_AND_HIRE_PIN.domain,
    operation: WORLD_GENERATE_AND_HIRE_PIN.operation, version: WORLD_GENERATE_AND_HIRE_PIN.version, scopeId: legacy.organization.id,
    targetId: value.positionId, relation: 'can-hire', validFrom: '0', validUntil: null })) },
  governance: { committees: [], norms: [] }, facts: [], knowledge: [], resources: [], communication: { channels: [] },
  externalWorld: { mode: 'simulated-only', identities: [] }, behavior: { initialGoals: legacy.initialEvents.map(value => ({
    id: value.applicationId, kind: 'goal', at: value.at, target: { kind: 'person', personId: value.requesterId }, body: value.description })),
  calendars: [], directorEvents: [] }, limits: { native: {}, team: {}, world: {} } })
export const deployment = scenarioV1CatalogSchema.parse({ ...installed, domains: [{ pin: WORLD_GENERATE_AND_HIRE_PIN, available: true }],
  factSchemas: ['clocky.world-fact/text/1'], normPolicies: ['clocky.organization.hiring-approval/1'] })
