/** Public default definitions compile without test deployment metadata or model IO. */
import { expect, it } from 'vitest'
import { compileWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import { webWorldCatalog } from '../src/world-catalog.ts'
import { webWorldTemplates } from '../src/world-scenarios.ts'

it('publishes three portable starter worlds with finite quotas and a separate director', async () => {
  const catalog = webWorldCatalog(), templates = webWorldTemplates(catalog)
  expect(templates.map(value => value.id)).toEqual(['world-company-v1', 'world-laboratory-v1', 'world-association-v1'])
  // Only the deployment model is substituted; every definition, limit and domain comes from shipped code.
  catalog.runtimeProfiles[0]!.model = { provider: 'local-test', name: 'keyless', version: '1', available: true }
  for (const template of templates) {
    const compiled = await compileWorldScenarioV1(template.definition, catalog, 'json', null)
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true)
    if (!compiled.ok) throw new Error('Default starter did not compile')
    expect(compiled.resolved.actors).toHaveLength(3)
    expect(compiled.resolved.actors.map(actor => actor.runtime.preset)).toEqual(Array(3).fill('simulation-world'))
    expect(compiled.resolved.native.maxResidentActors).toBe(3)
    expect(compiled.resolved.definition.externalWorld.mode).toBe('simulated-only')
    expect(compiled.resolved.definition.behavior.initialGoals).toHaveLength(1)
    expect(compiled.resolved.definition.organization.assignments.some(value => value.personId === 'director')).toBe(false)
  }
})
