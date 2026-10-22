/** Three distinct authored worlds share the same compiler and freeze their dependency/size observations. */
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import * as domains from '@clocky/clocky-simulation'
import { compileWorldScenarioV1, exportWorldScenarioV1Text, parseWorldScenarioV1 } from '../src/v1-compiler.ts'
import { scenarioV1CatalogSchema, worldScenarioV1Schema } from '../src/v1-schema.ts'
import { catalog } from './fixtures.ts'

const pins = Object.entries(domains).filter(([name]) => name.endsWith('_PIN')).map(([, pin]) => ({ pin, available: true, directorEvents: true }))
const metadata = catalog()
for (const limits of [metadata.limits.defaults, metadata.limits.ceilings]) {
  limits.world = { ...limits.world, maxRequests: 32, maxBirthsPerInterval: 32, maxExternalExpansionsPerInterval: 32,
    maxPendingMutations: 1, maxRequestsPerActorPerInterval: 32, maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 }
  limits.native = { ...limits.native, maxDecisionsPerInterval: 256, maxMessagesPerInterval: 256, maxMicrostepsPerTime: 128 }
}
const installed = scenarioV1CatalogSchema.parse({ ...metadata, domains: pins,
  factSchemas: ['clocky.world-fact/text/1'], normPolicies: ['clocky.organization.hiring-approval/1'] })
for (const name of ['company', 'laboratory', 'association']) {
  it(`${name}: retains every supported field, exact dependencies and semantic refusal across author views`, async () => {
    const definition = worldScenarioV1Schema.parse(JSON.parse(await readFile(
      new URL(`../../../../examples/simulation-company/scenarios/world-${name}-v1.json`, import.meta.url), 'utf8')))
    const compiled = await compileWorldScenarioV1(definition, installed)
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true)
    if (!compiled.ok) return
    for (const format of ['json', 'yaml'] as const) {
      const exported = exportWorldScenarioV1Text(compiled.resolved, format)
      const parsed = parseWorldScenarioV1(exported, format)
      expect(parsed.ok && parsed.definition).toEqual(definition)
    }
    expect({ scene: name, entities: compiled.preview.entityCount, actors: compiled.preview.actorCount,
      positions: compiled.preview.positionCount, domains: compiled.preview.domains,
      committees: definition.governance.committees.length, calendars: definition.behavior.calendars.length,
      external: definition.externalWorld.identities.length }).toMatchSnapshot()
    const bad = structuredClone(definition)
    bad.organization.positions[0]!.unitId = 'missing-unit'
    const rejected = await compileWorldScenarioV1(bad, installed)
    expect(rejected.ok).toBe(false)
    expect(worldScenarioV1Schema.safeParse({ ...definition, include: '/execute/me' }).success).toBe(false)
  })
}
