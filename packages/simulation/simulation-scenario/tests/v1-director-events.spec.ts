/** Environmental declarations are portable data; only explicit installed capabilities can authorize them. */
import { describe, expect, it } from 'vitest'
import { WORLD_EXTERNAL_INTERACT_PIN } from '@clocky/clocky-simulation'
import { scenarioV1CatalogSchema, worldScenarioV1Schema } from '../src/v1-schema.ts'
import { validateV1Relationships } from '../src/v1-validation.ts'
import { compileWorldScenarioV1 } from '../src/v1-compiler.ts'
import { sample, deployment } from './v1-fixtures.ts'
function fixture() {
  const value = structuredClone(sample), catalog = structuredClone(deployment)
  const director = value.entities.find(row => row.kind === 'person' && row.cognition === 'agent' && row.role === 'director')!
  value.entities.push({ id: 'outside', name: 'Outside', description: 'Existing outside organization', kind: 'organization', cognition: 'none' })
  value.domains.push({ domain: 'external', operation: 'interact', version: '1' })
  value.externalWorld.identities.push({ scopeId: value.organization.rootId, subjectId: 'outside', externalKey: 'outside', representation: 'simulated-rule' })
  value.behavior.calendars.push({ id: 'scene-clock', startsAt: '1', endsAt: '3', period: '1', maxOccurrences: 3,
    target: { kind: 'person', personId: director.id }, body: 'Read the existing environment' })
  value.behavior.directorEvents.push({ id: 'scene-request', calendarId: 'scene-clock', domain: 'external', operation: 'interact', version: '1',
    scopeId: value.organization.rootId, targetId: 'outside', maxRequests: 2 })
  catalog.domains.push({ pin: WORLD_EXTERNAL_INTERACT_PIN, available: true, directorEvents: true })
  return { value, catalog }
}
describe('portable director environmental authorization', () => {
  it('compiles only the explicit source and independent finite request budget, without inventing a role grant', async () => {
    const { value, catalog } = fixture()
    expect(validateV1Relationships(value, catalog)).toEqual([])
    const result = await compileWorldScenarioV1(value, catalog)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Original declaration failed pure compilation')
    expect(result.resolved.compilerVersion).toBe('9')
    expect(result.resolved.bootstrap.behavior.directorEvents).toEqual(value.behavior.directorEvents)
    expect(result.resolved.world.operationGrants.some(row => row.requesterEntityId === result.resolved.world.directorEntityId)).toBe(false)
    expect(result.resolved.relations.some(row => row.subject === result.resolved.world.directorEntityId)).toBe(false)
  })
  it.each([undefined, false])('missing or false installed capability %s rejects the original field before preparation', (capability) => {
    const { value, catalog } = fixture(), entry = catalog.domains.at(-1)!
    if (capability === undefined) delete entry.directorEvents
    else entry.directorEvents = capability
    expect(validateV1Relationships(value, catalog)).toContainEqual(expect.objectContaining({ code: 'unsupported-feature', path: ['behavior', 'directorEvents', 0] }))
  })
  it.each(['calendar', 'scope', 'target', 'version', 'budget', 'duplicate'] as const)('%s authority mistakes identify original declaration fields', (kind) => {
    const { value, catalog } = fixture(), event = value.behavior.directorEvents[0]!
    if (kind === 'calendar') event.calendarId = 'missing'
    else if (kind === 'scope') event.scopeId = 'outside'
    else if (kind === 'target') event.targetId = 'missing'
    else if (kind === 'version') event.version = 'uninstalled'
    else if (kind === 'budget') event.maxRequests = 4
    else value.behavior.directorEvents.push({ ...event })
    expect(validateV1Relationships(value, catalog).some(row => row.path[0] === 'behavior' && row.path[1] === 'directorEvents')).toBe(true)
  })
  it.each([undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('invalid or missing request budget %s never gets a default', (maxRequests) => {
    const { value } = fixture()
    expect(worldScenarioV1Schema.safeParse({ ...value, behavior: { ...value.behavior,
      directorEvents: [{ ...value.behavior.directorEvents[0], maxRequests }] } }).success).toBe(false)
  })
  it('catalog does not accept arbitrary environment callback or capability metadata', () => {
    const { catalog } = fixture()
    expect(scenarioV1CatalogSchema.safeParse({ ...catalog, domains: [{ ...catalog.domains.at(-1), directorCallback: 'arbitrary' }] }).success).toBe(false)
  })
})
