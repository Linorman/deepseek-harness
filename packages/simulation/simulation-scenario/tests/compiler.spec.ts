import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  compileWorldScenario, exportWorldScenario, parseWorldScenario, verifyWorldScenario, worldScenarioSchema,
} from '../src/index.ts'
import type { ScenarioCatalog, ScenarioCompilation, WorldScenario } from '../src/index.ts'
import { catalog } from './fixtures.ts'

const examples = new URL('../../../../examples/simulation-company/scenarios/', import.meta.url)
const input = async (name = 'company') => worldScenarioSchema.parse(JSON.parse(await readFile(new URL(`world-${name}.json`, examples), 'utf8')))
function success(value: ScenarioCompilation) {
  if (!value.ok) throw new Error(JSON.stringify(value.diagnostics))
  return value
}
const diagnostic = (result: ScenarioCompilation, source: string, code: string, path?: readonly (string | number)[]) => {
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.diagnostics).toContainEqual(expect.objectContaining({
    source, code, ...path === undefined ? {} : { path },
  }))
}
afterEach(() => { vi.restoreAllMocks() })

it.each(['company', 'laboratory'])('compiles the %s definition without allocation, storage, network or inference', async (name) => {
  const definition = await input(name), installed = catalog()
  const before = structuredClone({ definition, installed })
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Compilation must not use the network'))
  const compiled = success(await compileWorldScenario(JSON.stringify(definition), installed))
  expect(fetch).not.toHaveBeenCalled()
  expect({ definition, installed }).toEqual(before)
  expect(compiled.preview).toMatchObject({ actorCount: 3, positionCount: 1, initialRequestCount: 1, directorEntityId: 'director' })
  expect(compiled.resolved.actors.map(actor => actor.persona.name)).toEqual(name === 'company'
    ? ['Director', 'Recruiter', 'Observer'] : ['Coordinator', 'Research Lead', 'Observer'])
  expect(compiled.resolved.entities.filter(entity => entity.cognition === 'agent').every(entity => entity.readiness === 'preparing')).toBe(true)
  expect(compiled.resolved.entities).toHaveLength(5)
  expect(compiled.resolved.channels).toHaveLength(2)
  expect(compiled.resolved.relations.map(relation => relation.relation)).toEqual(['assignment', 'can-hire'])
  expect(compiled.resolved.initialEvents[0]?.request).toEqual({ organizationEntityId: definition.organization.id,
    positionEntityId: definition.positions[0]!.id, requesterEntityId: 'requester', applicationId: 'first-colleague' })
  expect(compiled.resolved.native).toMatchObject({
    ...installed.native, ...installed.limits.defaults.native, policyVersion: installed.policyVersion,
  })
  expect(compiled.resolved.generatedActorRuntime.model.version).toBe('model-1')
  expect(JSON.stringify(compiled.resolved)).not.toMatch(
    /participantId|sessionId|channelId|runId|endpoint|credential|purchase|supplier|buyer/,
  )
})

it('produces command inputs accepted by the current Native and Team-facing schemas', async () => {
  const native = await import('@clocky/clocky-simulation')
  const { resolved } = success(await compileWorldScenario(await input(), catalog()))
  expect(native.simulationRunSpecSchema.parse({ runId: 'caller-selected-run', ...resolved.native }).maxEntities).toBe(16)
  for (const command of [...resolved.entities, ...resolved.relations]) expect(native.simulationChangeSchema.parse(command)).toEqual(command)
  for (const channel of resolved.channels) {
    expect(native.simulationChannelSpecSchema.parse({ ...channel, limits: {} }).members).toEqual(channel.members)
  }
  for (const actor of resolved.actors) {
    const { runtime, persona, role } = actor
    expect(native.simulationParticipantSpecSchema.parse({ displayName: persona.name, role, capabilities: runtime.capabilities,
      provider: runtime.provider, preset: runtime.preset, model: `${runtime.model.provider}/${runtime.model.name}` }).role).toBe(role)
  }
  for (const event of resolved.initialEvents) expect(native.simulationHireIntentRequestSchema.parse(event.request)).toEqual(event.request)
})

it('uses standard SHA-256 over canonical JSON and deeply freezes detached results', async () => {
  const definition = await input(), installed = catalog()
  const result = success(await compileWorldScenario(definition, installed))
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, value]) => [key, sorted(value)])) : value
  expect(result.resolved.definitionHash).toBe(`sha256:${createHash('sha256').update(JSON.stringify(sorted(definition))).digest('hex')}`)
  expect(result.preview.hash).toBe(`sha256:${createHash('sha256').update(JSON.stringify(sorted(result.resolved))).digest('hex')}`)
  for (const value of [result, result.preview, result.resolved, result.resolved.actors, result.resolved.actors[0]?.persona,
    result.resolved.world.templates[0]?.names, result.resolved.limits.native]) expect(Object.isFrozen(value)).toBe(true)
  definition.organization.name = 'Changed'
  installed.runtimeProfiles[0]!.model.version = 'Changed'
  expect(result.resolved.definition.organization.name).toBe('Northstar Studio')
  expect(result.resolved.actors[0]!.runtime.model.version).toBe('model-1')
})

it('is insensitive to JSON object key order and whitespace', async () => {
  const definition = await input(), installed = catalog()
  const shuffled = Object.fromEntries(Object.entries(definition).reverse())
  const expected = await compileWorldScenario(definition, installed)
  expect(await compileWorldScenario(JSON.stringify(shuffled, null, 4), installed)).toEqual(expected)
})

it('resolves allowed requests and caps deployment defaults while persisting every effective field', async () => {
  const definition = await input(), installed = catalog()
  definition.limits = { native: { maxEntities: 16, maxResidentActors: 1 }, team: { maxChannels: 3 }, world: { maxRequests: 2 } }
  installed.limits.defaults.native.maxDriveSteps = 999
  const { resolved } = success(await compileWorldScenario(definition, installed))
  expect(resolved.limits.native.maxEntities).toBe(16)
  expect(resolved.limits.native.maxResidentActors).toBe(1)
  expect(resolved.limits.native.maxDriveSteps).toBe(32)
  expect(resolved.limits.team.maxChannels).toBe(3)
  expect(resolved.world.limits.maxRequests).toBe(2)
  expect(resolved.native.maxResidentActors).toBe(1)
})

it('resolves an actor profile override and preserves explicit empty persona selections', async () => {
  const definition = await input(), installed = catalog()
  installed.runtimeProfiles[0]!.roles = ['member']
  installed.runtimeProfiles.push({ ...structuredClone(installed.runtimeProfiles[0]!), id: 'director-profile',
    roles: ['director'], model: { provider: 'scripted', name: 'director', version: 'director-model-1', available: true } })
  definition.actors[0]!.runtimeProfile = { id: 'director-profile', version: '1' }
  definition.actors[0]!.persona = { name: 'Director', skills: [], goals: [] }
  const { resolved } = success(await compileWorldScenario(definition, installed))
  expect(resolved.actors[0]?.runtime.model.version).toBe('director-model-1')
  expect(resolved.generatedActorRuntime.model.version).toBe('model-1')
  expect(resolved.actors[0]?.persona).toEqual({ name: 'Director', skills: [], traits: ['patient'], goals: [] })
})

it('exports only new-run input and round-trips the same resolved semantics and preflight', async () => {
  const installed = catalog(), initial = success(await compileWorldScenario(await input(), installed))
  const exported = exportWorldScenario(initial.resolved)
  expect(exported).toEqual(initial.resolved.definition)
  expect(exported).not.toBe(initial.resolved.definition)
  expect(JSON.stringify(exported)).not.toMatch(/deployment-1|world-policy-1|model-1|in-process|scripted|preparing|journal/)
  expect(await compileWorldScenario(exported, installed)).toEqual(initial)
  exported.organization.name = 'Portable copy'
  expect(initial.resolved.definition.organization.name).toBe('Northstar Studio')
})

it('requires a new preview for generation, source, selected model or effective policy changes', async () => {
  const definition = await input(), installed = catalog()
  const initial = success(await compileWorldScenario(definition, installed))
  expect(await verifyWorldScenario(definition, installed, initial.preview)).toEqual(initial)
  const changeGeneration = structuredClone(installed)
  changeGeneration.generation = 'deployment-2'
  diagnostic(await verifyWorldScenario(definition, changeGeneration, initial.preview), 'preflight', 'stale-preflight', ['catalogGeneration'])
  for (const alter of [
    (value: ScenarioCatalog) => { value.policyVersion = 'policy-2' },
    (value: ScenarioCatalog) => { value.runtimeProfiles[0]!.model.version = 'model-2' },
    (value: ScenarioCatalog) => { value.templates[0]!.template.description = 'Revised public description' },
    (value: ScenarioCatalog) => { value.limits.ceilings.native.maxEntities = 8 },
    (value: ScenarioCatalog) => { value.native.maxTime = '2000' },
  ]) {
    const changed = structuredClone(installed)
    alter(changed)
    diagnostic(await verifyWorldScenario(definition, changed, initial.preview), 'preflight', 'stale-preflight', ['hash'])
  }
  definition.initialEvents[0]!.description = 'Another requirement'
  diagnostic(await verifyWorldScenario(definition, installed, initial.preview), 'preflight', 'stale-preflight', ['hash'])
})

it('returns field diagnostics for malformed JSON, missing fields and unknown nested capabilities', async () => {
  expect(parseWorldScenario('{')).toMatchObject({ ok: false, diagnostics: [{ code: 'invalid-json', path: [] }] })
  diagnostic(await compileWorldScenario({}, catalog()), 'scenario', 'invalid-shape', ['apiVersion'])
  const definition = await input()
  for (const field of ['provider', 'sessionId', 'runtimeProof', 'credentials', 'code', 'endpoint']) {
    const actors = [{ ...definition.actors[0], [field]: 'forged' }, ...definition.actors.slice(1)]
    diagnostic(await compileWorldScenario({ ...definition, actors }, catalog()), 'scenario', 'invalid-shape', ['actors', 0, field])
  }
  diagnostic(await compileWorldScenario({ ...definition, apiVersion: 'clocky.world/v1' }, catalog()), 'scenario', 'invalid-shape', ['apiVersion'])
})

it.each([' ', '\t\r\n', '\u00a0\u3000'])('rejects a whitespace-only Team objective before materialization: %j', async (description) => {
  const definition = await input()
  definition.metadata.description = description
  diagnostic(await compileWorldScenario(definition, catalog()), 'scenario', 'invalid-shape', ['metadata', 'description'])
})

it('preserves surrounding whitespace in valid descriptions and their definition hashes', async () => {
  const definition = await input(), installed = catalog()
  const original = success(await compileWorldScenario(definition, installed))
  definition.metadata.description = ` \t${definition.metadata.description}\n `
  const compiled = success(await compileWorldScenario(definition, installed))
  expect(compiled.resolved.definition.metadata.description).toBe(definition.metadata.description)
  expect(exportWorldScenario(compiled.resolved)).toEqual(definition)
  expect(compiled.resolved.definitionHash).not.toBe(original.resolved.definitionHash)
  expect(await compileWorldScenario(exportWorldScenario(compiled.resolved), installed)).toEqual(compiled)
})

const duplicateCases: readonly [string, (value: WorldScenario) => void][] = [
  ['organization/entity', (value) => { value.positions[0]!.id = value.organization.id }],
  ['actor/entity', (value) => { value.actors[1]!.id = value.actors[0]!.id }],
  ['template', (value) => { value.templates.push({ ...value.templates[0]! }) }],
  ['relation', (value) => { value.authorizations[0]!.id = value.assignments[0]!.id }],
  ['assignment', (value) => { value.assignments.push({ ...value.assignments[0]!, id: 'other-assignment' }) }],
  ['authorization', (value) => { value.authorizations.push({ ...value.authorizations[0]!, id: 'other-authorization' }) }],
  ['application', (value) => { value.initialEvents.push({ ...value.initialEvents[0]! }) }],
]
it.each(duplicateCases)('rejects duplicate %s identities', async (_name, alter) => {
  const definition = await input()
  alter(definition)
  diagnostic(await compileWorldScenario(definition, catalog()), 'scenario', 'duplicate-id')
})

const referenceCases: readonly [string, (value: WorldScenario) => void][] = [
  ['profile', (value) => { value.runtimeProfile.version = 'missing' }],
  ['scenario template', (value) => { value.templates[0]!.version = 'missing' }],
  ['actor template', (value) => { value.actors[0]!.template.version = 'missing' }],
  ['assignment actor', (value) => { value.assignments[0]!.personId = 'missing' }],
  ['assignment position', (value) => { value.assignments[0]!.positionId = 'missing' }],
  ['authorization actor', (value) => { value.authorizations[0]!.requesterId = 'missing' }],
  ['authorization position', (value) => { value.authorizations[0]!.positionId = 'missing' }],
  ['event actor', (value) => { value.initialEvents[0]!.requesterId = 'missing' }],
  ['event position', (value) => { value.initialEvents[0]!.positionId = 'missing' }],
]
it.each(referenceCases)('rejects the dangling %s reference', async (_name, alter) => {
  const definition = await input()
  alter(definition)
  diagnostic(await compileWorldScenario(definition, catalog()), 'scenario', 'unknown-reference')
})

it.each(['missing-director', 'two-directors', 'director-request', 'unauthorized-event'])(
  'rejects role and authorization mismatch: %s', async (kind) => {
    const definition = await input()
    if (kind === 'missing-director') definition.actors[0]!.role = 'member'
    if (kind === 'two-directors') definition.actors[1]!.role = 'director'
    if (kind === 'director-request') definition.authorizations[0]!.requesterId = 'director'
    if (kind === 'unauthorized-event') definition.initialEvents[0]!.requesterId = 'observer'
    diagnostic(await compileWorldScenario(definition, catalog()), 'scenario', 'unauthorized-role')
  })

it.each(['profile', 'model', 'role'])('rejects unavailable or unauthorized installed %s', async (kind) => {
  const installed = catalog()
  if (kind === 'profile') installed.runtimeProfiles[0]!.available = false
  if (kind === 'model') installed.runtimeProfiles[0]!.model.available = false
  if (kind === 'role') installed.runtimeProfiles[0]!.roles = ['member']
  diagnostic(await compileWorldScenario(await input(), installed), 'scenario', kind === 'role' ? 'unauthorized-role' : 'model-unavailable')
})

it.each(['name', 'skills', 'traits', 'goals'] as const)('rejects out-of-template persona %s', async (field) => {
  const definition = await input()
  definition.actors[0]!.persona = { [field]: field === 'name' ? 'forged' : ['forged'] }
  diagnostic(await compileWorldScenario(definition, catalog()), 'scenario', 'template-choice', ['actors', 0, 'persona', field])
})

it('rejects duplicate catalog identities and invalid catalog defaults', async () => {
  const definition = await input()
  for (const target of ['profile', 'template', 'persona'] as const) {
    const installed = catalog()
    if (target === 'profile') installed.runtimeProfiles.push({ ...installed.runtimeProfiles[0]! })
    if (target === 'template') installed.templates.push(structuredClone(installed.templates[0]!))
    if (target === 'persona') installed.templates[0]!.defaultPersona.name = 'forged'
    diagnostic(await compileWorldScenario(definition, installed), 'catalog', target === 'persona' ? 'template-choice' : 'duplicate-id')
  }
  diagnostic(await compileWorldScenario(definition, { ...catalog(), credentials: 'secret' }), 'catalog', 'invalid-shape', ['credentials'])
})

const capacityCases: readonly [string, (value: WorldScenario, installed: ScenarioCatalog) => void][] = [
  ['position', (value) => {
    value.positions[0]!.capacity = 1
    value.assignments.push({ id: 'observer-assignment', personId: 'observer', positionId: value.positions[0]!.id })
  }],
  ['entities', (_value, installed) => { installed.limits.ceilings.native.maxEntities = 4 }],
  ['participants', (_value, installed) => { installed.limits.ceilings.team.maxParticipants = 2 }],
  ['activations', (_value, installed) => { installed.limits.ceilings.team.maxActivations = 2 }],
  ['channels', (_value, installed) => { installed.limits.ceilings.team.maxChannels = 1 }],
  ['pending events', (_value, installed) => { installed.limits.ceilings.native.maxPendingEvents = 0 }],
  ['applications', (value, installed) => {
    installed.limits.ceilings.world.maxRequests = 1
    value.initialEvents.push({ ...value.initialEvents[0]!, applicationId: 'another-application' })
  }],
  ['operations', (_value, installed) => { installed.limits.ceilings.native.maxOperationsPerDecision = 1 }],
  ['time', (value) => { value.initialEvents[0]!.at = '1001' }],
]
it.each(capacityCases)('rejects insufficient %s capacity', async (_name, alter) => {
  const definition = await input(), installed = catalog()
  alter(definition, installed)
  diagnostic(await compileWorldScenario(definition, installed), 'scenario', 'capacity')
})

it.each([0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1])('rejects nonpositive or unsafe world and position limits: %s', async (value) => {
  const definition = await input()
  definition.positions[0]!.capacity = value
  diagnostic(await compileWorldScenario(definition, catalog()), 'scenario', 'invalid-shape', ['positions', 0, 'capacity'])
  definition.positions[0]!.capacity = 2
  definition.limits = { world: { maxPlansPerRequest: value } }
  diagnostic(await compileWorldScenario(definition, catalog()), 'scenario', 'invalid-shape', ['limits', 'world', 'maxPlansPerRequest'])
})

describe('browser entry', () => {
  it('contains no Host runtime, IO, random identity or model invocation dependencies', async () => {
    for (const name of ['index', 'compiler', 'schema', 'validation', 'types']) {
      const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')
      expect(source).not.toMatch(/from ['"](?:node:|@clocky\/clocky-simulation['"]|@clocky\/clocky-simulation-local|@clocky\/clocky-agent)/)
      expect(source).not.toMatch(/\b(?:process|Buffer)\.|\b(?:fetch|randomUUID|setTimeout|setInterval)\s*\(/)
    }
  })
})


it.each(['native', 'team', 'world'] as const)('rejects explicit %s limit requests above deployment ceilings', async (group) => {
  const definition = await input(), installed = catalog()
  definition.limits = group === 'native' ? { native: { maxEntities: 999 } }
    : group === 'team' ? { team: { maxParticipants: 999 } } : { world: { maxPlansPerRequest: 999 } }
  diagnostic(await compileWorldScenario(definition, installed), 'scenario', 'capacity')
})
