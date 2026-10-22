/** Structural quotas remain explicit through input, deployment ceilings and resolved review identity. */
import { expect, it } from 'vitest'
import { compileWorldScenarioV1 } from '../src/v1-compiler.ts'
import { scenarioV1CatalogSchema } from '../src/v1-schema.ts'
import { serializeScenarioDefinition } from '../src/input.ts'
import { sample, deployment } from './v1-fixtures.ts'

const fields = ['maxBirthsPerInterval', 'maxExternalExpansionsPerInterval', 'maxPendingMutations'] as const

it.each(['json', 'yaml'] as const)('preserves disabled dynamic creation and serialized mutations through %s', async (format) => {
  const definition = structuredClone(sample)
  Object.assign(definition.limits.world, { maxBirthsPerInterval: 0, maxExternalExpansionsPerInterval: 0, maxPendingMutations: 1 })
  const result = await compileWorldScenarioV1(serializeScenarioDefinition(definition, format), deployment, format)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.resolved.limits.world).toMatchObject({
    maxBirthsPerInterval: 0, maxExternalExpansionsPerInterval: 0, maxPendingMutations: 1 })
  expect(result.resolved.world.limits).toEqual(result.resolved.limits.world)
})

it.each(fields)('requires installed %s while permitting omitted authored overrides', async (field) => {
  const definition = structuredClone(sample)
  Reflect.deleteProperty(definition.limits.world, field)
  const result = await compileWorldScenarioV1(definition, deployment)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.resolved.limits.world[field]).toBe(deployment.limits.defaults.world[field])
  for (const kind of ['defaults', 'ceilings'] as const) {
    const catalog = structuredClone(deployment)
    Reflect.deleteProperty(catalog.limits[kind].world, field)
    expect(scenarioV1CatalogSchema.safeParse(catalog).success).toBe(false)
  }
})

it.each(fields)('rejects malformed %s and refuses unsupported concurrency', async (field) => {
  for (const value of [null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', true,
    ...field === 'maxPendingMutations' ? [0, 2] : []]) {
    const definition = structuredClone(sample)
    Object.assign(definition.limits.world, { [field]: value })
    expect((await compileWorldScenarioV1(definition, deployment)).ok, `${field}=${String(value)}`).toBe(false)
  }
})

it.each(['maxBirthsPerInterval', 'maxExternalExpansionsPerInterval'] as const)('commits %s defaults to review identity and enforces its ceiling', async (field) => {
  const definition = structuredClone(sample), catalog = structuredClone(deployment)
  Object.assign(definition.limits.world, { [field]: 0 })
  const original = await compileWorldScenarioV1(definition, catalog)
  catalog.limits.defaults.world[field] = 9
  const changed = await compileWorldScenarioV1(definition, catalog)
  expect(original.ok && changed.ok).toBe(true)
  if (!original.ok || !changed.ok) return
  expect(changed.preview.hash).not.toBe(original.preview.hash)
  expect(changed.resolved.limits.world[field]).toBe(0)
  Object.assign(definition.limits.world, { [field]: catalog.limits.ceilings.world[field] + 1 })
  expect((await compileWorldScenarioV1(definition, catalog)).ok).toBe(false)
})
