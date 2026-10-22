/** Environment and subjective initial state are portable scenario input, never injected runtime history. */
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import * as domains from '@clocky/clocky-simulation'
import { compileWorldScenarioV1, exportWorldScenarioV1Text, parseWorldScenarioV1 } from '../src/v1-compiler.ts'
import { scenarioV1CatalogSchema, worldScenarioV1Schema } from '../src/v1-schema.ts'
import { catalog } from './fixtures.ts'

it('compiles typed initial environment and experience state and rejects missing personal sources', async () => {
  const definition = worldScenarioV1Schema.parse(JSON.parse(await readFile(new URL('../../../../examples/simulation-company/scenarios/world-company-v1.json', import.meta.url), 'utf8')))
  for (const [domain, operation, targetId, relation] of [['environment', 'supply-step', 'supply', 'can-supply'], ['person-state', 'experience', 'experience', 'can-evolve']] as const) {
    definition.domains.push({ domain, operation, version: '1' })
    definition.organization.grants.push({ id: relation, personId: 'ceo', domain, operation, version: '1', scopeId: 'studio', targetId, relation, validFrom: '0', validUntil: null })
    definition.organization.positions.find(position => position.id === 'leadership')!.permissions.push({ domain, operation, version: '1', scopeId: 'studio', targetId, relation })
  }
  const environment = { model: 'supply-seasonal/1', generation: 1, inventory: 10, committed: 4, capacity: 20,
    sourceLimit: 3, sinkLimit: 5, step: 1, lastTime: null }
  const evolution = { personId: 'ceo', audience: ['ceo', 'director'], period: 10, versions: [] }
  const source = { ...definition, entities: [...definition.entities,
    { id: 'supply', name: 'Supply', description: 'Simulated supply.', kind: 'environment', cognition: 'none', environment },
    { id: 'experience', name: 'Experience', description: 'Private experience.', kind: 'person-state', cognition: 'none', evolution }] }
  const parsed = worldScenarioV1Schema.parse(source)
  const metadata = catalog()
  for (const limits of [metadata.limits.defaults, metadata.limits.ceilings]) {
    limits.world = { ...limits.world, maxRequests: 32, maxBirthsPerInterval: 32, maxExternalExpansionsPerInterval: 32,
      maxPendingMutations: 1, maxRequestsPerActorPerInterval: 32, maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 }
    limits.native = { ...limits.native, maxDecisionsPerInterval: 256, maxMessagesPerInterval: 256, maxMicrostepsPerTime: 128 }
  }
  const installed = scenarioV1CatalogSchema.parse({ ...metadata, domains: Object.entries(domains)
    .filter(([name]) => name.endsWith('_PIN')).map(([, pin]) => ({ pin, available: true, directorEvents: true })),
  factSchemas: ['clocky.world-fact/text/1'], normPolicies: ['clocky.organization.hiring-approval/1'] })
  const result = await compileWorldScenarioV1(parsed, installed)
  expect(result.ok, JSON.stringify(result)).toBe(true)
  if (!result.ok) return
  expect(result.resolved.entities.find(entity => entity.id === 'supply')).toMatchObject({ cognition: 'none', profile: { environment } })
  expect(result.resolved.entities.find(entity => entity.id === 'experience')).toMatchObject({ cognition: 'none', profile: { evolution } })
  for (const format of ['json', 'yaml'] as const) expect(parseWorldScenarioV1(exportWorldScenarioV1Text(result.resolved, format), format)).toMatchObject({ ok: true, definition: parsed })
  const bad = structuredClone(source)
  Object.assign(bad.entities.at(-1)!, { evolution: { ...evolution, personId: 'missing' } })
  expect(await compileWorldScenarioV1(worldScenarioV1Schema.parse(bad), installed)).toMatchObject({ ok: false })
  expect(() => worldScenarioV1Schema.parse({ ...source, entities: [...definition.entities,
    { ...source.entities.at(-2), environment: { ...environment, lastTime: '1' } }] })).toThrow()
})
