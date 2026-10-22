/** Evidence rounds remain a frozen request allowance across portable inputs and accepted compiler output. */
import { expect, it } from 'vitest'
import { simulationWorldDefinitionSchema } from '@clocky/clocky-simulation'
import { compileWorldScenarioV1 } from '../src/v1-compiler.ts'
import { resolvedWorldScenarioV1Schema } from '../src/v1-resolved.ts'
import { scenarioV1CatalogSchema } from '../src/v1-schema.ts'
import { serializeScenarioDefinition } from '../src/input.ts'
import { sample, deployment } from './v1-fixtures.ts'

const key = 'maxEvidenceAttemptsPerRequest'
it.each(['json', 'yaml'] as const)('retains a disabled evidence allowance through %s and rejects the prior compiler', async (format) => {
  const definition = structuredClone(sample)
  definition.limits.world[key] = 0
  const result = await compileWorldScenarioV1(serializeScenarioDefinition(definition, format), deployment, format)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.resolved.compilerVersion).toBe('9')
  expect(result.resolved.limits.world[key]).toBe(0)
  expect(result.resolved.world.limits[key]).toBe(0)
  expect(resolvedWorldScenarioV1Schema.safeParse({ ...result.resolved, compilerVersion: '8' }).success).toBe(false)
  const invalid = structuredClone(result.resolved.world)
  Reflect.deleteProperty(invalid.limits, key)
  expect(simulationWorldDefinitionSchema.safeParse(invalid).success).toBe(false)
})

it('requires catalog bounds while omitted authoring input uses its original explicit default', async () => {
  const definition = structuredClone(sample)
  Reflect.deleteProperty(definition.limits.world, key)
  const original = await compileWorldScenarioV1(definition, deployment)
  expect(original.ok).toBe(true)
  if (!original.ok) return
  expect(original.resolved.limits.world[key]).toBe(deployment.limits.defaults.world.maxPlansPerRequest)
  for (const kind of ['defaults', 'ceilings'] as const) {
    const missing = structuredClone(deployment)
    Reflect.deleteProperty(missing.limits[kind].world, key)
    expect(scenarioV1CatalogSchema.safeParse(missing).success).toBe(false)
  }
  const changed = structuredClone(deployment)
  changed.limits.defaults.world[key] = 0
  const next = await compileWorldScenarioV1(definition, changed)
  expect(next.ok).toBe(true)
  if (next.ok) expect(next.preview.hash).not.toBe(original.preview.hash)
})

it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null, true])('rejects malformed evidence allowance %j', async (value) => {
  const definition = structuredClone(sample)
  Object.assign(definition.limits.world, { [key]: value })
  expect((await compileWorldScenarioV1(definition, deployment)).ok).toBe(false)
})

it('refuses requests above the installed evidence ceiling without increasing other quotas', async () => {
  const definition = structuredClone(sample)
  definition.limits.world[key] = deployment.limits.ceilings.world[key] + 1
  expect((await compileWorldScenarioV1(definition, deployment)).ok).toBe(false)
})
