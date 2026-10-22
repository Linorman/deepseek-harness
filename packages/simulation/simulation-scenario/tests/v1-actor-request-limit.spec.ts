/** Actor request limits remain explicit in reviewed defaults, ceilings, portable inputs and resolved commitments. */
import { describe, expect, it } from 'vitest'
import { compileWorldScenarioV1 } from '../src/v1-compiler.ts'
import { resolvedWorldScenarioV1Schema } from '../src/v1-resolved.ts'
import { scenarioV1CatalogSchema } from '../src/v1-schema.ts'
import { serializeScenarioDefinition } from '../src/input.ts'
import { sample, deployment } from './v1-fixtures.ts'

it.each(['json', 'yaml'] as const)('freezes the explicit actor limit with the same simulated period through %s', async (format) => {
  const definition = structuredClone(sample), catalog = structuredClone(deployment)
  definition.limits.world.maxRequestsPerActorPerInterval = 1
  const direct = await compileWorldScenarioV1(definition, catalog)
  const parsed = await compileWorldScenarioV1(serializeScenarioDefinition(definition, format), catalog, format)
  expect(direct.ok && parsed.ok).toBe(true)
  if (!direct.ok || !parsed.ok) return
  expect(parsed.resolved.definitionHash).toBe(direct.resolved.definitionHash)
  expect(parsed.preview.hash).toBe(direct.preview.hash)
  expect(parsed.resolved.limits.world.maxRequestsPerActorPerInterval).toBe(1)
  expect(parsed.resolved.world.limits.maxRequestsPerActorPerInterval).toBe(1)
  expect(parsed.resolved.native.budgetInterval).toBe(catalog.native.budgetInterval)
  expect(parsed.resolved.catalog.limits.defaults.world.maxRequestsPerActorPerInterval).toBe(10)
  expect(parsed.resolved.compilerVersion).toBe('9')
  expect(resolvedWorldScenarioV1Schema.safeParse({ ...parsed.resolved, compilerVersion: '6' }).success).toBe(false)
})

it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null])('rejects an invalid authored actor bound %j', async (value) => {
  const definition = structuredClone(sample)
  Object.assign(definition.limits.world, { maxRequestsPerActorPerInterval: value })
  expect((await compileWorldScenarioV1(definition, deployment)).ok).toBe(false)
})

describe.each(['defaults', 'ceilings'] as const)('%s actor allowance', (kind) => {
  it('requires the field in the installed catalog and changes review identity even above a smaller authored bound', async () => {
    const definition = structuredClone(sample), catalog = structuredClone(deployment)
    definition.limits.world.maxRequestsPerActorPerInterval = 1
    const missing = structuredClone(catalog)
    Reflect.deleteProperty(missing.limits[kind].world, 'maxRequestsPerActorPerInterval')
    expect(scenarioV1CatalogSchema.safeParse(missing).success).toBe(false)
    const original = await compileWorldScenarioV1(definition, catalog)
    catalog.limits[kind].world.maxRequestsPerActorPerInterval = 9
    if (kind === 'ceilings') catalog.limits.defaults.world.maxRequestsPerActorPerInterval = 9
    const changed = await compileWorldScenarioV1(definition, catalog)
    expect(original.ok && changed.ok).toBe(true)
    if (!original.ok || !changed.ok) return
    expect(changed.resolved.limits.world.maxRequestsPerActorPerInterval).toBe(1)
    expect(changed.preview.hash).not.toBe(original.preview.hash)
  })
})

it('rejects an authored actor allowance above the trusted ceiling', async () => {
  const definition = structuredClone(sample)
  definition.limits.world.maxRequestsPerActorPerInterval = 11
  const result = await compileWorldScenarioV1(definition, deployment)
  expect(result.ok).toBe(false)
})
