/** Pointer and keyboard edits must obey the same semantic compiler as imported source. */
import { expect, it } from 'vitest'
import { applyScenarioDraftCommand, scenarioDraftCommandSchema } from '../src/draft-commands.ts'
import { sample, deployment } from './v1-fixtures.ts'

it('creates a unit without losing any supported document fields and refuses cycles', async () => {
  const before = structuredClone(sample)
  const result = await applyScenarioDraftCommand(sample, { kind: 'unit/create', id: 'research', name: 'Research',
    description: 'Research division', parentId: sample.organization.rootId }, deployment)
  expect(result.ok).toBe(true)
  expect(sample).toEqual(before)
  if (!result.ok) return
  const definition = { ...sample, entities: [...sample.entities, { id: 'research', name: 'Research',
    description: 'Research division', kind: 'organization' as const, cognition: 'none' as const }],
  organization: { ...sample.organization, units: [...sample.organization.units, { id: 'research', parentId: sample.organization.rootId }] } }
  const cycle = await applyScenarioDraftCommand(definition, { kind: 'unit/move', id: 'research', parentId: 'research' }, deployment)
  expect(cycle.ok).toBe(false)
  if (!cycle.ok) expect(cycle.diagnostics.some(value => value.code === 'organization-cycle')).toBe(true)
})
it('rejects missing targets and executable or unknown command fields', async () => {
  const result = await applyScenarioDraftCommand(sample, { kind: 'position/move', id: 'missing', unitId: sample.organization.rootId }, deployment)
  expect(result.ok).toBe(false)
  expect(() => scenarioDraftCommandSchema.parse({ kind: 'unit/create', id: 'x', name: 'X', description: 'X', parentId: 'root', code: 'run()' })).toThrow()
})

it('refuses capacity reductions and duplicate identities through the shared compiler', async () => {
  const definition = structuredClone(sample)
  const position = definition.organization.positions[0]!
  position.capacity = 2
  const unassigned = definition.entities.find(entity => entity.kind === 'person' && entity.cognition === 'agent'
    && entity.role !== 'director' && !definition.organization.assignments.some(row => row.personId === entity.id))!
  definition.organization.assignments.push({ id: 'second-member', personId: unassigned.id, positionId: position.id, validFrom: '0', validUntil: null })
  const refused = await applyScenarioDraftCommand(definition, { kind: 'position/capacity', id: position.id, capacity: 1 }, deployment)
  expect(refused.ok).toBe(false)
  if (!refused.ok) expect(refused.diagnostics.some(value => value.code === 'capacity')).toBe(true)
  const duplicate = await applyScenarioDraftCommand(sample, { kind: 'unit/create', id: sample.organization.rootId,
    parentId: sample.organization.rootId, name: 'Duplicate', description: 'Duplicate' }, deployment)
  expect(duplicate.ok).toBe(false)
})
