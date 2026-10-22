/** Field comparisons preserve removed fields and state the omitted tail rather than claiming complete coverage. */
import { expect, it } from 'vitest'
import { compareAuthorDrafts } from '../src/client/world-draft-compare.ts'
import { worldScenarioV1Schema } from '@clocky/clocky-simulation-scenario'
import definition from '../../../sdk/protocol/tests/fixtures/world-v1-definition.json'

it('shows both sides of scalar edits, additions and removals under stable escaped paths', () => {
  const original = { name: 'Original', definition: worldScenarioV1Schema.parse(definition) }
  const local = structuredClone(original)
  local.name = 'Local'
  local.definition.metadata.description = 'Changed'
  local.definition.facts.pop()
  const result = compareAuthorDrafts(local, original)
  expect(result.changes).toContainEqual({ path: '/name', local: '"Local"', saved: '"Original"' })
  expect(result.changes.some(row => row.path === '/definition/metadata/description')).toBe(true)
  expect(result.changes.some(row => row.path.startsWith('/definition/facts/') && row.local === undefined)).toBe(true)
  expect(result.omitted).toBe(0)
  expect(original.name).toBe('Original')
})
it('bounds displayed changes without dropping the count or mutating full source values', () => {
  const original = { name: 'Original', definition: worldScenarioV1Schema.parse(definition) }
  const local = structuredClone(original)
  for (let index = 0; index < 200; index++) local.definition.entities.push({ id: `extra-${index}`, kind: 'organization',
    cognition: 'none', name: '🌏'.repeat(200), description: 'An extra unit' })
  const result = compareAuthorDrafts(local, original)
  expect(result.changes).toHaveLength(128)
  expect(result.omitted).toBe(72)
  expect(result.changes[0]?.local?.endsWith('…')).toBe(true)
  expect(local.definition.entities.at(-1)?.name).toBe('🌏'.repeat(200))
})

it('unwraps a valid inert template while keeping its license and pins separate from editable world fields', async () => {
  const { createDraft, draftBytes } = await import('../src/client/world-draft.ts')
  const manifest = { id: 'example', version: '1', license: { identifier: 'LicenseRef-Private', notice: 'Original notice' },
    attribution: ['Author'], dependencies: {
      domains: definition.domains.map(domain => ({ ...domain, schemaRef: 'schema/1', implementationRef: 'impl/1', generation: 1 })),
      runtimeProfiles: definition.runtimeProfiles.allowed, templates: definition.runtimeProfiles.templates,
      policyVersion: 'policy/1', normPolicies: ['clocky.organization.hiring-approval/1'] } }
  const parsed = worldScenarioV1Schema.parse(definition)
  manifest.dependencies.normPolicies = [...new Set(parsed.governance.norms.flatMap(norm => norm.enforcement.kind === 'validated'
    ? [norm.enforcement.policyRef] : []))]
  const draft = createDraft('import', 'Imported', null, { format: 'json', text: JSON.stringify({
    apiVersion: 'clocky.world-template/v1', manifest, definition }) })
  expect(draft.model).toEqual(definition)
  expect(draft.templateManifest).toEqual(manifest)
  expect(draft.source.text).not.toContain('LicenseRef-Private')
  expect(draftBytes({ ...draft, layout: [{ id: 'node', x: 1, y: 2 }] })).toBeGreaterThan(draftBytes(draft))
  const refused = createDraft('invalid', 'Invalid', null, { format: 'json', text: JSON.stringify({
    apiVersion: 'clocky.world-template/v1', manifest, definition, install: 'execute' }) })
  expect(refused.templateManifest).toBeUndefined()
})
