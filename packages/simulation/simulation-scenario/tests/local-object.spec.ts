/** Portable plain objects retain strict no-cognition identity and the original compiler projection. */
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import * as domains from '@clocky/clocky-simulation'
import { compileWorldScenarioV1, exportWorldScenarioV1Text, parseWorldScenarioV1 } from '../src/v1-compiler.ts'
import { scenarioV1CatalogSchema, worldScenarioV1Schema } from '../src/v1-schema.ts'
import { catalog } from './fixtures.ts'

it('authors a plain display object and preserves it through JSON and YAML', async () => {
  const source: unknown = JSON.parse(await readFile(new URL('../../../../examples/simulation-company/scenarios/world-company-v1.json', import.meta.url), 'utf8'))
  const definition = worldScenarioV1Schema.parse(source)
  definition.entities.push({ id: 'display-object', name: 'Display', description: 'A non-cognitive display object.', kind: 'object', cognition: 'none' })
  const metadata = catalog()
  for (const limits of [metadata.limits.defaults, metadata.limits.ceilings]) {
    limits.world = { ...limits.world, maxRequests: 32, maxBirthsPerInterval: 32, maxExternalExpansionsPerInterval: 32,
      maxPendingMutations: 1, maxRequestsPerActorPerInterval: 32, maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 }
    limits.native = { ...limits.native, maxDecisionsPerInterval: 256, maxMessagesPerInterval: 256, maxMicrostepsPerTime: 128 }
  }
  const installed = scenarioV1CatalogSchema.parse({ ...metadata, domains: Object.entries(domains)
    .filter(([name]) => name.endsWith('_PIN')).map(([, pin]) => ({ pin, available: true, directorEvents: true })),
  factSchemas: ['clocky.world-fact/text/1'], normPolicies: ['clocky.organization.hiring-approval/1'] })
  const result = await compileWorldScenarioV1(definition, installed)
  expect(result.ok, JSON.stringify(result)).toBe(true)
  if (!result.ok) return
  expect(result.resolved.entities.find(value => value.id === 'display-object')).toMatchObject({ entityKind: 'object', cognition: 'none',
    profile: { name: 'Display', description: 'A non-cognitive display object.' } })
  for (const format of ['json', 'yaml'] as const) {
    const roundtrip = parseWorldScenarioV1(exportWorldScenarioV1Text(result.resolved, format), format)
    expect(roundtrip.ok && roundtrip.definition).toEqual(definition)
  }
  expect(() => worldScenarioV1Schema.parse({ ...definition, entities: [...definition.entities,
    { id: 'bad-object', name: 'Bad', description: 'Bad', kind: 'object', cognition: 'agent' }] })).toThrow()
})
