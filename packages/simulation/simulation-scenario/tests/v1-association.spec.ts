/** A distinct portable association declares independent votes and consenting existing volunteers without external assets. */
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { WORLD_HIRE_EXISTING_PIN, WORLD_GOVERNANCE_HIRE_APPROVAL_PIN, WORLD_GOVERNANCE_VOTE_PIN,
  WORLD_EXTERNAL_MEDIATED_PIN } from '@clocky/clocky-simulation'
import { catalog } from './fixtures.ts'
import { compileWorldScenarioV1, parseWorldScenarioV1 } from '../src/v1-compiler.ts'
import { scenarioV1CatalogSchema, worldScenarioV1Schema } from '../src/v1-schema.ts'
import type { WorldScenarioV1 } from '../src/v1-schema.ts'
import { resolvedWorldScenarioV1Schema } from '../src/v1-resolved.ts'
import { serializeScenarioDefinition } from '../src/input.ts'

const text = await readFile(new URL('../../../../examples/simulation-company/scenarios/world-association-v1.json', import.meta.url), 'utf8')
const raw: unknown = JSON.parse(text)
const definition = worldScenarioV1Schema.parse(raw)
const pins = [WORLD_GOVERNANCE_HIRE_APPROVAL_PIN, WORLD_GOVERNANCE_VOTE_PIN, WORLD_HIRE_EXISTING_PIN, WORLD_EXTERNAL_MEDIATED_PIN]
const installed = scenarioV1CatalogSchema.parse({ ...catalog(), domains: pins.map(pin => ({ pin, available: true })),
  factSchemas: ['clocky.world-fact/text/1'], normPolicies: ['clocky.organization.hiring-approval/1'] })

it.each(['json', 'yaml'] as const)('round-trips complete association author data and its original commitment through safe %s', async (format) => {
  const original = structuredClone(definition), metadata = structuredClone(installed)
  const source = serializeScenarioDefinition(definition, format)
  const parsed = parseWorldScenarioV1(source, format)
  expect(parsed.ok && parsed.definition).toEqual(definition)
  const first = await compileWorldScenarioV1(definition, installed)
  const second = await compileWorldScenarioV1(source, installed, format)
  expect(first.ok, JSON.stringify(first)).toBe(true)
  expect(second.ok, JSON.stringify(second)).toBe(true)
  if (!first.ok || !second.ok) return
  expect(second.resolved.definition).toEqual(original)
  expect(second.preview.hash).toBe(first.preview.hash)
  expect(second.resolved.compilerVersion).toBe('9')
  expect(resolvedWorldScenarioV1Schema.parse(second.resolved)).toEqual(second.resolved)
  expect(definition).toEqual(original)
  expect(installed).toEqual(metadata)
})

it('resolves actual independent council grants, candidate eligibility and role calendars with an unexpanded partner', async () => {
  const result = await compileWorldScenarioV1(definition, installed)
  expect(result.ok, JSON.stringify(result)).toBe(true)
  if (!result.ok) return
  const { resolved, preview } = result
  expect(preview).toMatchObject({ creationMode: 'paused', source: 'simulated-only', actorCount: 4,
    entityCount: 10, positionCount: 3, initialRequestCount: 0, directorEntityId: 'director' })
  expect(preview.domains).toEqual(pins)
  expect(preview.models.map(value => value.entityId)).toEqual(['director', 'chair', 'councillor', 'candidate'])
  expect(preview.enforcement).toEqual([{ id: 'volunteer-approval', kind: 'validated' }])
  expect(resolved.bootstrap.committeePolicies[0]).toMatchObject({ id: 'council', quorum: 2,
    rule: { kind: 'absolute-threshold', yes: 2 }, members: [{ personId: 'chair' }, { personId: 'councillor' }] })
  const votes = resolved.world.operationGrants.filter(value => value.domain === 'governance' && value.operation === 'vote')
  expect(votes.map(value => value.requesterEntityId)).toEqual(['chair', 'councillor'])
  expect(resolved.world.operationGrants).toContainEqual(expect.objectContaining({ requesterEntityId: 'chair',
    operation: 'propose-hire-approval', targetEntityId: 'council', scopeEntityId: 'association', relation: 'can-approve-hire' }))
  expect(resolved.relations).toContainEqual(expect.objectContaining({ subject: 'candidate', relation: 'eligible-for-hire',
    object: 'association', scope: 'association' }))
  expect(resolved.world.operationGrants).toContainEqual(expect.objectContaining({ requesterEntityId: 'chair',
    operation: 'hire-existing', targetEntityId: 'volunteer-seat', scopeEntityId: 'association', relation: 'can-hire' }))
  expect(resolved.relations.filter(value => value.relation === 'assignment').map(value => [value.subject, value.scope]))
    .toEqual([['chair', 'association'], ['councillor', 'association']])
  expect(resolved.relations.some(value => value.relation === 'assignment' && value.subject === 'candidate')).toBe(false)
  expect(resolved.bootstrap.behavior.calendars.map(value => value.target))
    .toEqual([{ kind: 'position', positionId: 'volunteer-seat' }, { kind: 'position', positionId: 'council-seat' }])
  expect(resolved.bootstrap.resources).toEqual([])
  expect(resolved.bootstrap.externalIdentities).toEqual([{ scopeId: 'association', externalKey: 'library',
    subjectId: 'external-library', representation: 'director-mediated' }])
  expect(resolved.world.externalAdjudicationPolicy?.allowedOutcomeKinds).toEqual(['failure'])
  expect(resolved.world.hiringFees).toBeUndefined()
})

const invalid: readonly [string, (value: WorldScenarioV1) => void, string, string][] = [
  ['missing candidate consent target', (value) => { value.organization.grants[5]!.targetId = 'unknown' }, 'unknown-reference', 'organization.grants.5.targetId'],
  ['unknown calendar role', (value) => { value.behavior.calendars[0]!.target = { kind: 'position', positionId: 'unknown' } },
    'unknown-reference', 'behavior.calendars.0.target.positionId'],
  ['external identity masquerades as managed root', (value) => { value.externalWorld.identities[0]!.subjectId = 'association' },
    'invalid-reference', 'externalWorld.identities.0.subjectId'],
  ['two votes attributed to one person', (value) => { value.governance.committees[0]!.members[1]!.personId = 'chair' },
    'membership-overlap', 'governance.committees.0.members.1'],
  ['unreachable council quorum', (value) => { value.governance.committees[0]!.quorum = 3 },
    'committee-threshold', 'governance.committees.0.rule'],
  ['calendar beyond the trusted horizon', (value) => { value.behavior.calendars[0]!.startsAt = '1001'; value.behavior.calendars[0]!.endsAt = '1002' },
    'time-horizon', 'behavior.calendars.0.startsAt'],
  ['requested history exceeds installed ceiling', (value) => { value.limits.native.maxResourceReservationHistory = 129 },
    'capacity', 'limits.native.maxResourceReservationHistory'],
  ['overlapping initial appointments', (value) => { value.organization.assignments.push({ id: 'overlapping-role', personId: 'chair',
    positionId: 'council-seat', validFrom: '0', validUntil: null }) }, 'assignment-overlap', 'organization.assignments.2'],
]
it.each(invalid)('locates invalid association data: %s', async (_name, change, code, path) => {
  const bad = structuredClone(definition)
  change(bad)
  const result = await compileWorldScenarioV1(bad, installed)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.diagnostics.some(value => value.code === code && value.path.join('.') === path)).toBe(true)
})

it('rejects executable metadata, non-finite occurrence bounds and unsafe YAML input', () => {
  expect(parseWorldScenarioV1({ ...definition, callbacks: 'forbidden' }).ok).toBe(false)
  const bad = structuredClone(definition)
  bad.behavior.calendars[0]!.maxOccurrences = 0
  expect(parseWorldScenarioV1(bad).ok).toBe(false)
  expect(parseWorldScenarioV1('!!js/function >\n  () => require("fs")\n', 'yaml').ok).toBe(false)
  expect(parseWorldScenarioV1('<<: {apiVersion: clocky.world/v1}\n', 'yaml').ok).toBe(false)
})
