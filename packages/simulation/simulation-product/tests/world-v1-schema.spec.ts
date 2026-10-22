/** Complete v1 product commands retain original initialized data and reject resealed projection changes. */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { compileWorldScenarioV1, resolvedWorldScenarioV1Schema } from '@clocky/clocky-simulation-scenario'
import { sample, deployment } from '../../simulation-scenario/tests/v1-fixtures.ts'
import { simulationWorldCreationSchema } from '../src/world-creation.ts'
import { simulationProductWorldCreateInputSchema, simulationProductWorldPreflightResultSchema,
  simulationProductWorldExportResultSchema } from '../src/world-schema.ts'
import { worldPreflightPreview } from '../src/world-preview.ts'

function fingerprint(value: unknown): string {
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
    : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, sorted(value)])) : value
  return `sha256:${createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex')}`
}
async function fixture() {
  const compiled = await compileWorldScenarioV1(sample, deployment)
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const request = simulationProductWorldCreateInputSchema.parse({ commandId: 'original-v1', name: 'Full World', definition: sample,
    preflight: { hash: compiled.preview.hash, catalogGeneration: compiled.preview.catalogGeneration } })
  const creation = { record: { id: 'full-v1', name: request.name, provider: 'local', ownerPrincipalId: 'owner', registeredAt: 1,
    spec: { ...compiled.resolved.native, runId: 'full-v1' } }, request,
  preparation: { resolved: resolvedWorldScenarioV1Schema.parse(compiled.resolved), ownerName: 'simulation-product/full-v1',
    checkpoint: { id: 'product-initial/original-v1', maxDrainRounds: 4, maxAttempts: 3 } } }
  return { compiled, creation }
}

it('retains the complete original v1 resolution, requests and exported portable definition', async () => {
  const h = await fixture(), before = structuredClone(h.creation)
  expect(simulationWorldCreationSchema.parse(h.creation)).toEqual(before)
  expect(h.creation.preparation.resolved.runtimeProfiles).toEqual(deployment.runtimeProfiles)
  expect(h.creation.preparation.resolved.catalog).toEqual(deployment)
  expect(h.creation.preparation.resolved.teamCeilings).toBeNull()
  expect(simulationProductWorldExportResultSchema.parse({ runId: 'full-v1', definition: sample }).definition).toEqual(sample)
  const preview = worldPreflightPreview(h.compiled)
  expect(preview).toMatchObject({ status: 'ready', apiVersion: 'clocky.world/v1',
    preview: { creationMode: 'paused', source: 'simulated-only' },
    scope: { source: 'simulated-only', payroll: false, domains: h.compiled.resolved.world.operations },
    assignments: sample.organization.assignments, permissions: sample.organization.grants,
    sources: { facts: 0, privateBeliefs: 0, resources: 0, externalIdentities: 0,
      initialGoals: sample.behavior.initialGoals.length, calendars: sample.behavior.calendars.length,
      directorEvents: sample.behavior.directorEvents.length } })
  expect(simulationProductWorldPreflightResultSchema.parse(preview)).toEqual(preview)
  expect(h.creation).toEqual(before)
})

it('refuses a changed metadata-only deployment when the accepted original preview commitment is retained', async () => {
  const h = await fixture(), resolved = h.creation.preparation.resolved
  resolved.catalog.limits.ceilings.native.maxEntities++
  expect(resolvedWorldScenarioV1Schema.safeParse(resolved).success).toBe(true)
  expect(simulationWorldCreationSchema.safeParse(h.creation).success).toBe(false)
})

describe.each(['entity', 'relation', 'actor', 'bootstrap', 'rule', 'clock', 'model', 'template'] as const)('resealed %s changes', (field) => {
  it('cannot substitute original projection fields even with a recomputed preview hash', async () => {
    const h = await fixture(), resolved = h.creation.preparation.resolved
    switch (field) {
      case 'entity': resolved.entities[0]!.profile.name = 'Different symbolic organization'; break
      case 'relation': resolved.relations[0]!.validFrom = '1'; break
      case 'actor': resolved.actors[0]!.persona.name = 'Different finite choice'; break
      case 'bootstrap': resolved.bootstrap.behavior.initialGoals.push({ id: 'injected', kind: 'goal', at: '1' as never,
        target: { kind: 'person', personId: resolved.actors[0]!.entityId as never }, body: 'Unreviewed work' }); break
      case 'rule': resolved.native.relationRules[0]!.acyclic = false; break
      case 'clock': resolved.native.policyVersion = 'Different original policy'; break
      case 'model': resolved.actors[0]!.runtime.model.version = 'Different original model'; break
      case 'template': resolved.actors[0]!.template.names.push('Unreviewed name'); break
    }
    h.creation.request.preflight.hash = fingerprint(resolved)
    expect(simulationWorldCreationSchema.safeParse(h.creation).success).toBe(false)
  })
})

it('rejects unknown fields, removed required fields and unknown diagnostic kinds', async () => {
  const h = await fixture()
  for (const value of [{ ...h.creation.preparation.resolved, code: 'host script' },
    { ...h.creation.preparation.resolved, compilerVersion: '2' },
    { ...h.creation.preparation.resolved, catalog: undefined },
    { ...h.creation.preparation.resolved, teamCeilings: undefined },
    { ...h.creation.preparation.resolved, runtimeProfiles: undefined },
    { ...h.creation.preparation.resolved, bootstrap: { ...h.creation.preparation.resolved.bootstrap, credential: 'secret' } }]) {
    expect(simulationWorldCreationSchema.safeParse({ ...h.creation,
      preparation: { ...h.creation.preparation, resolved: value } }).success).toBe(false)
  }
  expect(simulationProductWorldPreflightResultSchema.safeParse({ status: 'invalid', diagnostics: [
    { source: 'scenario', path: [], code: 'arbitrary-new-code', message: 'Unknown failure' },
  ] }).success).toBe(false)
})
