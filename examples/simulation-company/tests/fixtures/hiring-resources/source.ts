/** Portable explicitly funded hiring; each operation uses its original actors, accounts and frozen fee rule. */
import { simulationResourceSpecSchema, simulationHiringFeePolicySchema, simulationInitialNormSchema, WORLD_GENERATE_AND_HIRE_PIN, WORLD_HIRE_EXISTING_PIN } from '@clocky/clocky-simulation'
import { worldScenarioV1Schema, scenarioV1CatalogSchema } from '@clocky/clocky-simulation-scenario'
import { worldV1Definition, worldV1Catalog } from '../world-v1-product/deployment.ts'
const source = structuredClone(worldV1Definition), catalog = structuredClone(worldV1Catalog)
const mode = process.env.WORLD_HIRING_MODE
if (mode !== 'generate-and-hire' && mode !== 'hire-existing') throw new Error('Hiring fixture requires an explicit operation')
source.limits = { ...source.limits, world: { ...source.limits?.world,
  maxBirthsPerInterval: mode === 'generate-and-hire' ? 1 : 0, maxExternalExpansionsPerInterval: 0, maxPendingMutations: 1 } }
// The separate clarification scenario declares its complete question/revision envelope bounds before compilation.
if (process.env.WORLD_HIRING_EVIDENCE === 'true') {
  source.limits.world = { ...source.limits.world,
    maxBytesPerRequest: 32768, maxBytesPerPlan: 32768, maxPlansPerRequest: 3, maxEvidenceAttemptsPerRequest: 2 }
  catalog.limits.ceilings.world = { ...catalog.limits.ceilings.world, maxBytesPerRequest: 32768, maxBytesPerPlan: 32768 }
}
const requestBytes = process.env.WORLD_HIRING_REQUEST_BYTES
if (requestBytes !== undefined) {
  const limit = Number(requestBytes)
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Hiring request byte limit must be a positive integer')
  source.limits.world = { ...source.limits.world, maxBytesPerRequest: limit }
}
const pin = mode === 'generate-and-hire' ? WORLD_GENERATE_AND_HIRE_PIN : WORLD_HIRE_EXISTING_PIN
const requester = source.organization.assignments[0]!.personId, position = source.organization.positions[0]!.id
source.domains = [{ domain: pin.domain, operation: pin.operation, version: pin.version }]
source.organization.grants = source.organization.grants.filter(value => value.relation === 'can-hire').map(value => ({ ...value, operation: mode }))
source.governance = { committees: [], norms: [] }; source.knowledge = []
if (process.env.WORLD_HIRING_POLICY_BOUNDARY === 'blocked') {
  const base = source.organization.positions[0]!
  source.organization.positions.push({ ...base, id: 'policy-only-position', name: 'Policy-only position' })
  source.governance = { committees: structuredClone(worldV1Definition.governance.committees), norms: [simulationInitialNormSchema.parse({
    id: 'request-policy', scopeId: source.organization.rootId, body: 'PRIVATE-REQUEST-POLICY-CANARY',
    effectiveFrom: '0', effectiveUntil: null, availableAt: '100', audience: { kind: 'actors', entityIds: ['director'] },
    enforcement: { kind: 'validated', policyRef: 'clocky.organization.hiring-approval/1',
      params: { committeeId: 'original-committee', positionIds: ['policy-only-position'], maxHires: 1 } },
  })] }
}

source.externalWorld = { mode: 'simulated-only', identities: [] }
source.behavior = { initialGoals: [{ id: 'funded-hiring-goal', kind: 'goal', at: '0', target: { kind: 'person', personId: requester },
  body: 'Hire one colleague under the original declared one-time charge.' }], calendars: [], directorEvents: [] }
source.resources = [{ id: 'fee-cash', owner: source.organization.rootId, controllers: [requester], kind: 'money', unit: 'credit', quantity: '10' },
  { id: 'fee-payee', owner: 'outside-vendor', controllers: [], kind: 'money', unit: 'credit', quantity: '0' }]
  .map(value => simulationResourceSpecSchema.parse(value))
source.organization.hiringFees = [simulationHiringFeePolicySchema.parse({ id: 'original-fee', version: '1', policyRef: 'clocky.organization.hiring-fee/1',
  operation: mode, positionEntityId: position, from: 'fee-cash', to: 'fee-payee', unit: 'credit', quantity: '3', grants: [], reservationPeriod: '10' })]
if (mode === 'hire-existing') source.organization.grants.push({ id: 'candidate-eligibility', personId: 'observer', domain: pin.domain,
  operation: pin.operation, version: pin.version, scopeId: source.organization.rootId, targetId: source.organization.rootId,
  relation: 'eligible-for-hire', validFrom: '0', validUntil: null })
catalog.domains = [{ pin, available: true }]
catalog.runtimeProfiles = catalog.runtimeProfiles.filter(value => value.version !== 'unavailable-model')
for (const row of catalog.runtimeProfiles) row.model.provider = 'hiring-resource-scripted'
export const hiringDefinition = worldScenarioV1Schema.parse(source)
export const hiringCatalog = scenarioV1CatalogSchema.parse(catalog)
