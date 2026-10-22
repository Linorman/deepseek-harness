/** Original deployment defaults and observed owner ceilings participate in the complete v1 commitment. */
import { describe, expect, it } from 'vitest'
import { compileWorldScenarioV1, verifyWorldScenarioV1 } from '../src/v1-compiler.ts'
import { resolvedWorldScenarioV1Schema } from '../src/v1-resolved.ts'
import { sample, deployment } from './v1-fixtures.ts'

function inputs() {
  const definition = structuredClone(sample), catalog = structuredClone(deployment)
  definition.limits.native.maxEntities = 8
  definition.limits.team.maxParticipants = 8
  definition.limits.world.maxRequests = 4
  catalog.limits.ceilings.native.maxEntities = 32
  catalog.limits.ceilings.team.maxParticipants = 32
  catalog.limits.ceilings.world.maxRequests = 20
  const team = structuredClone(catalog.limits.ceilings.team)
  team.maxParticipants = 64
  return { definition, catalog, team }
}

it('rejects every unsupported compiler version on an otherwise complete original resolution', async () => {
  const h = inputs(), result = await compileWorldScenarioV1(h.definition, h.catalog, 'json', h.team)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Version refusal requires a complete valid retained resolution')
  for (const version of [...Array.from({ length: 9 }, (_, value) => String(value)), '10', 'future']) {
    const changed = { ...result.resolved, compilerVersion: version }
    const parsed = resolvedWorldScenarioV1Schema.safeParse(changed)
    expect(parsed.success, version).toBe(false)
    if (!parsed.success) expect(parsed.error.issues.some(issue => issue.path.join('.') === 'compilerVersion'), version).toBe(true)
  }
  expect(resolvedWorldScenarioV1Schema.parse(result.resolved)).toEqual(result.resolved)
})

it('retains every original catalog field and the independently observed Team ceiling without replacing their defaults', async () => {
  const h = inputs(), before = structuredClone(h)
  const result = await compileWorldScenarioV1(h.definition, h.catalog, 'json', h.team)
  expect(result.ok, JSON.stringify(result)).toBe(true)
  if (!result.ok) return
  expect(result.resolved.compilerVersion).toBe('9')
  expect(result.resolved.catalog).toEqual(h.catalog)
  expect(result.resolved.teamCeilings).toEqual(h.team)
  expect(result.resolved.limits.team.maxParticipants).toBe(8)
  expect(result.resolved.catalog.limits.defaults.team.maxParticipants).toBe(16)
  expect(result.resolved.catalog.limits.ceilings.team.maxParticipants).toBe(32)
  expect(result.resolved.catalog.templates[0]!.defaultPersona).toEqual(h.catalog.templates[0]!.defaultPersona)
  expect(resolvedWorldScenarioV1Schema.parse(result.resolved)).toEqual(result.resolved)
  expect(Object.isFrozen(result.resolved.catalog.templates[0]!.defaultPersona)).toBe(true)
  expect(Object.isFrozen(result.resolved.teamCeilings)).toBe(true)
  expect(h).toEqual(before)
})

describe.each(['native', 'team', 'world'] as const)('%s retained allowances', (group) => {
  it.each(['defaults', 'ceilings'] as const)('invalidates an old preview when %s change above an unchanged explicit limit', async (kind) => {
    const h = inputs(), original = await compileWorldScenarioV1(h.definition, h.catalog, 'json', h.team)
    expect(original.ok).toBe(true)
    if (!original.ok) return
    const changed = structuredClone(h.catalog)
    switch (group) {
      case 'native': changed.limits[kind].native.maxEntities++; break
      case 'team': changed.limits[kind].team.maxParticipants++; break
      case 'world': changed.limits[kind].world.maxRequests++; break
    }
    const current = await compileWorldScenarioV1(h.definition, changed, 'json', h.team)
    expect(current.ok).toBe(true)
    if (!current.ok) return
    expect(current.resolved.limits).toEqual(original.resolved.limits)
    expect(current.resolved.definitionHash).toBe(original.resolved.definitionHash)
    expect(current.preview.hash).not.toBe(original.preview.hash)
    const verified = await verifyWorldScenarioV1(h.definition, changed, original.preview, 'json', h.team)
    expect(verified).toMatchObject({ ok: false, diagnostics: [{ code: 'stale-preflight' }] })
  })
})

it('commits observed ceilings independently even above the configured ceiling and rejects explicit excess before projecting', async () => {
  const h = inputs(), first = await compileWorldScenarioV1(h.definition, h.catalog, 'json', h.team)
  const changed = { ...h.team, maxParticipants: 65 }
  const second = await compileWorldScenarioV1(h.definition, h.catalog, 'json', changed)
  expect(first.ok && second.ok).toBe(true)
  if (!first.ok || !second.ok) return
  expect(first.resolved.limits).toEqual(second.resolved.limits)
  expect(first.preview.hash).not.toBe(second.preview.hash)
  expect(await verifyWorldScenarioV1(h.definition, h.catalog, first.preview, 'json', h.team)).toEqual(first)
  const rejected = await compileWorldScenarioV1(h.definition, h.catalog, 'json', { ...h.team, maxParticipants: 4 })
  expect(rejected.ok).toBe(false)
  if (!rejected.ok) expect(rejected.diagnostics.some(d => d.path.join('.') === 'limits.team.maxParticipants')).toBe(true)
  delete h.definition.limits.team.maxParticipants
  const capped = await compileWorldScenarioV1(h.definition, h.catalog, 'json', { ...h.team, maxParticipants: 4 })
  expect(capped.ok, JSON.stringify(capped)).toBe(true)
  if (capped.ok) {
    expect(capped.resolved.catalog.limits.defaults.team.maxParticipants).toBe(16)
    expect(capped.resolved.catalog.limits.ceilings.team.maxParticipants).toBe(32)
    expect(capped.resolved.teamCeilings?.maxParticipants).toBe(4)
    expect(capped.resolved.limits.team.maxParticipants).toBe(4)
    expect(resolvedWorldScenarioV1Schema.parse(capped.resolved)).toEqual(capped.resolved)
  }
})

it('refuses obsolete compiler records and incomplete or mismatched original metadata instead of inventing defaults', async () => {
  const h = inputs(), result = await compileWorldScenarioV1(h.definition, h.catalog, 'json', h.team)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  for (const changed of [{ ...result.resolved, compilerVersion: '2' }, { ...result.resolved, compilerVersion: '5' }, { ...result.resolved, compilerVersion: '6' }, { ...result.resolved, catalog: undefined },
    { ...result.resolved, teamCeilings: undefined }, { ...result.resolved, catalogGeneration: 'another-generation' },
    { ...result.resolved, policyVersion: 'another-policy' },
    { ...result.resolved, teamCeilings: { ...h.team, maxParticipants: 4 } },
    { ...result.resolved, catalog: { ...h.catalog, native: { ...h.catalog.native, tickUnit: 'hour' } } }]) {
    expect(resolvedWorldScenarioV1Schema.safeParse(changed).success).toBe(false)
  }
  const pure = await compileWorldScenarioV1(h.definition, h.catalog)
  expect(pure.ok).toBe(true)
  if (pure.ok) {
    expect(pure.resolved.teamCeilings).toBeNull()
    expect(resolvedWorldScenarioV1Schema.parse(pure.resolved)).toEqual(pure.resolved)
  }
  expect((await compileWorldScenarioV1(h.definition, h.catalog, 'json', { ...h.team, credentials: 'forbidden' })).ok).toBe(false)
})
