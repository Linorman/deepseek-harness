/** Public request isolation and complete private original World resolution validation. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { compileWorldScenario } from '@clocky/clocky-simulation-scenario'
import { catalog } from '../../simulation-scenario/tests/fixtures.ts'
import { simulationProductRecordSchema } from '../src/directory.ts'
import { simulationProductWorldCreateInputSchema, simulationProductWorldPreflightInputSchema,
  simulationProductWorldPreflightResultSchema, simulationProductWorldExportResultSchema } from '../src/world-schema.ts'
import { worldPreflightPreview } from '../src/world-preview.ts'
import { simulationResolvedWorldScenarioSchema, simulationWorldCreationSchema } from '../src/world-creation.ts'
import type { SimulationWorldCreation } from '../src/world-creation.ts'

const json = z.json()
type Value = z.infer<typeof json>
type ObjectValue = Record<string, Value>
type Path = readonly (string | number)[]
const jsonObject = z.record(z.string(), json)
afterEach(() => { vi.restoreAllMocks() })

it('retains safe file syntax and locations while rejecting malformed diagnostic locations', () => {
  const diagnostic = { source: 'scenario', path: ['organization', 'name'], code: 'invalid-shape',
    message: 'Expected a string', format: 'yaml', line: 4, column: 9 }
  expect(simulationProductWorldPreflightResultSchema.parse({ status: 'invalid', diagnostics: [diagnostic] }))
    .toEqual({ status: 'invalid', diagnostics: [diagnostic] })
  for (const changes of [{ format: 'javascript' }, { line: 0 }, { column: -1 }, { line: 1.5 }, { line: Number.MAX_SAFE_INTEGER + 1 },
    { line: undefined }, { column: undefined }, { input: 'private contents' }]) {
    expect(simulationProductWorldPreflightResultSchema.safeParse({ status: 'invalid', diagnostics: [{ ...diagnostic, ...changes }] }).success).toBe(false)
  }
})

async function fixture(name: 'company' | 'laboratory' = 'company'): Promise<SimulationWorldCreation> {
  const compiled = await compileWorldScenario(
    await readFile(`examples/simulation-company/scenarios/world-${name}.json`, 'utf8'), catalog())
  if (!compiled.ok) throw new Error('World schema fixture failed compilation')
  const request = simulationProductWorldCreateInputSchema.parse({ commandId: `create-${name}`, name: `${name} World`,
    definition: compiled.resolved.definition,
    preflight: { hash: compiled.preview.hash, catalogGeneration: compiled.preview.catalogGeneration } })
  const record = simulationProductRecordSchema.parse({ id: `world-${name}`, name: request.name, provider: 'local',
    ownerPrincipalId: 'authenticated-owner', registeredAt: 100, spec: { ...compiled.resolved.native, runId: `world-${name}` } })
  return simulationWorldCreationSchema.parse({ record, request, preparation: { resolved: compiled.resolved,
    ownerName: `simulation-product/${record.id}`, checkpoint: { id: `product-initial/${request.commandId}`, maxDrainRounds: 4, maxAttempts: 3 } } })
}

function copy(value: object): ObjectValue { return jsonObject.parse(value) }
function at(root: ObjectValue, path: Path): Value {
  let value: Value = root
  for (const key of path) {
    if (typeof key === 'number' && Array.isArray(value)) value = value[key]!
    else if (typeof key === 'string' && value !== null && typeof value === 'object' && !Array.isArray(value)) value = value[key]!
    else throw new Error(`Invalid test path ${path.join('.')}`)
  }
  return value
}
function objectAt(root: ObjectValue, path: Path): ObjectValue {
  const value = at(root, path)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Test path does not select an object')
  return value
}
function set(root: ObjectValue, path: Path, value: Value): void {
  const parent = at(root, path.slice(0, -1)), key = path[path.length - 1]
  if (typeof key === 'number' && Array.isArray(parent)) parent[key] = value
  else if (typeof key === 'string' && parent !== null && typeof parent === 'object' && !Array.isArray(parent)) parent[key] = value
  else throw new Error('Test mutation does not select a JSON field')
}
function objectPaths(value: Value, path: Path = []): Path[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => objectPaths(item, [...path, index]))
  if (value !== null && typeof value === 'object') return [path,
    ...Object.entries(value).flatMap(([key, item]) => objectPaths(item, [...path, key]))]
  return []
}
function fingerprint(value: Value): string {
  const sorted = (value: Value): Value => Array.isArray(value) ? value.map(sorted)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, item]) => [key, sorted(item)])) : value
  return `sha256:${createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex')}`
}
/** Recommit the mutated snapshot to prove semantic rejections are independent of the preview hash check. */
function reseal(creation: ObjectValue): void {
  const resolved = objectAt(creation, ['preparation', 'resolved'])
  resolved.definitionHash = fingerprint(resolved.definition!)
  objectAt(creation, ['request', 'preflight']).hash = fingerprint(resolved)
}
const resolved = ['preparation', 'resolved'] as const

describe.each(['company', 'laboratory'] as const)('%s original World schemas', (scenario) => {
  it('accepts the complete original compiler output without current metadata, inference or input mutation', async () => {
    const creation = await fixture(scenario), before = structuredClone(creation)
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Schema validation cannot contact a provider'))
    expect(simulationWorldCreationSchema.parse(creation)).toEqual(creation)
    expect(simulationResolvedWorldScenarioSchema.parse(creation.preparation.resolved)).toEqual(creation.preparation.resolved)
    expect(creation).toEqual(before)
    expect(network).not.toHaveBeenCalled()
    const installed = catalog()
    installed.generation = 'current-generation-changed'
    installed.templates[0]!.template.description = 'Current template changed'
    installed.runtimeProfiles[0]!.model.available = false
    expect(simulationWorldCreationSchema.parse(creation)).toEqual(before)
    const parsed = simulationWorldCreationSchema.parse(creation)
    parsed.request.definition.metadata.name = 'Change detached parse result'
    expect(creation).toEqual(before)
  })

  it('rejects unknown fields at every retained object instead of stripping them', async () => {
    const creation = copy(await fixture(scenario))
    const paths = objectPaths(creation)
    expect(paths.length).toBeGreaterThan(70)
    for (const path of paths) {
      const changed = copy(creation)
      objectAt(changed, path).unexpected = 'unretained field'
      const parsed = simulationWorldCreationSchema.safeParse(changed)
      expect(parsed.success, path.join('.')).toBe(false)
      if (!parsed.success) expect(parsed.error.issues.some(issue => issue.code === 'unrecognized_keys'), path.join('.')).toBe(true)
    }
  })

  it('rejects missing original fields throughout the complete retained artifact', async () => {
    const creation = copy(await fixture(scenario))
    for (const path of objectPaths(creation)) {
      for (const key of Object.keys(objectAt(creation, path))) {
        const changed = copy(creation)
        Reflect.deleteProperty(objectAt(changed, path), key)
        expect(simulationWorldCreationSchema.safeParse(changed).success, [...path, key].join('.')).toBe(false)
      }
    }
  })
})

it('rejects public provider, execution, identity and host path injection at every public object', async () => {
  const creation = await fixture(), input = copy(creation.request)
  expect(simulationProductWorldPreflightInputSchema.parse({ definition: creation.request.definition }))
    .toEqual({ definition: creation.request.definition })
  expect(simulationProductWorldCreateInputSchema.parse(input)).toEqual(creation.request)
  for (const field of ['native', 'provider', 'model', 'record', 'preparation', 'runId', 'ownerPrincipalId', 'workspacePath', 'hostPath']) {
    expect(simulationProductWorldCreateInputSchema.safeParse({ ...input, [field]: 'caller-controlled' }).success).toBe(false)
    expect(simulationProductWorldPreflightInputSchema.safeParse({ definition: input.definition, [field]: 'caller-controlled' }).success).toBe(false)
  }
  for (const path of objectPaths(input)) {
    const changed = copy(input)
    objectAt(changed, path).unexpected = true
    expect(simulationProductWorldCreateInputSchema.safeParse(changed).success, path.join('.')).toBe(false)
  }
  for (const key of ['commandId', 'name', 'definition', 'preflight']) {
    const changed = copy(input)
    Reflect.deleteProperty(changed, key)
    expect(simulationProductWorldCreateInputSchema.safeParse(changed).success).toBe(false)
  }
  expect(simulationProductWorldPreflightInputSchema.safeParse({}).success).toBe(false)
  expect(simulationProductWorldCreateInputSchema.safeParse({ ...input, definition: JSON.stringify(input.definition) }).success).toBe(false)
})

it.each([
  { path: ['record', 'id'], value: 'another-product-run' },
  { path: ['record', 'spec', 'runId'], value: 'another-native-run' },
  { path: ['record', 'name'], value: 'another-name' },
  { path: ['preparation', 'ownerName'], value: 'simulation-product/another-run' },
  { path: ['preparation', 'checkpoint', 'id'], value: 'product-initial/another-command' },
  { path: ['preparation', 'checkpoint', 'maxAttempts'], value: 0 },
  { path: ['request', 'commandId'], value: 'another-command' },
  { path: ['request', 'preflight', 'catalogGeneration'], value: 'another-generation' },
  { path: ['request', 'preflight', 'hash'], value: `sha256:${'0'.repeat(64)}` },
  { path: ['request', 'preflight', 'hash'], value: 'not-a-sha256' },
  { path: ['record', 'spec', 'policyVersion'], value: 'different-policy' },
  { path: ['record', 'spec', 'maxEntities'], value: 15 },
  { path: ['request', 'definition', 'metadata', 'description'], value: 'different original definition' },
])('rejects changed retained ownership, identity or preview at $path', async ({ path, value }) => {
  const creation = copy(await fixture())
  set(creation, path, value)
  expect(simulationWorldCreationSchema.safeParse(creation).success).toBe(false)
})

type Mutation = { name: string; path: Path; value: Value }
const mutations: Mutation[] = [
  { name: 'compiler version', path: ['compilerVersion'], value: '2' },
  { name: 'API version', path: ['apiVersion'], value: 'clocky.world/v1' },
  { name: 'definition hash', path: ['definitionHash'], value: `sha256:${'0'.repeat(64)}` },
  { name: 'actor identity', path: ['actors', 0, 'entityId'], value: 'unknown' },
  { name: 'actor role', path: ['actors', 0, 'role'], value: 'member' },
  { name: 'duplicate director', path: ['actors', 1, 'role'], value: 'director' },
  { name: 'runtime profile version', path: ['actors', 0, 'runtime', 'version'], value: 'other-version' },
  { name: 'runtime role authority', path: ['actors', 0, 'runtime', 'roles'], value: ['member'] },
  { name: 'runtime availability', path: ['actors', 0, 'runtime', 'available'], value: false },
  { name: 'model availability', path: ['actors', 0, 'runtime', 'model', 'available'], value: false },
  { name: 'model route', path: ['actors', 0, 'runtime', 'model', 'name'], value: 'changed-model' },
  { name: 'model version', path: ['actors', 0, 'runtime', 'model', 'version'], value: 'other-version' },
  { name: 'template identity', path: ['actors', 0, 'template', 'id'], value: 'unknown-template' },
  { name: 'template version', path: ['actors', 0, 'template', 'version'], value: 'other-version' },
  { name: 'template description', path: ['actors', 0, 'template', 'description'], value: 'Changed template' },
  { name: 'persona name', path: ['actors', 0, 'persona', 'name'], value: 'Not offered' },
  { name: 'persona skill', path: ['actors', 0, 'persona', 'skills'], value: ['not offered'] },
  { name: 'persona trait', path: ['actors', 0, 'persona', 'traits'], value: ['not offered'] },
  { name: 'persona goal', path: ['actors', 0, 'persona', 'goals'], value: ['not offered'] },
  { name: 'generated runtime selection', path: ['generatedActorRuntime', 'id'], value: 'other-profile' },
  { name: 'generated member authority', path: ['generatedActorRuntime', 'roles'], value: ['director'] },
  { name: 'generated model availability', path: ['generatedActorRuntime', 'model', 'available'], value: false },
  { name: 'organization cognition', path: ['entities', 0, 'cognition'], value: 'agent' },
  { name: 'person readiness', path: ['entities', 2, 'readiness'], value: 'ready' },
  { name: 'person omitted readiness', path: ['entities', 2, 'readiness'], value: null },
  { name: 'person kind', path: ['entities', 2, 'entityKind'], value: 'organization' },
  { name: 'person profile', path: ['entities', 2, 'profile', 'description'], value: 'Director rationale' },
  { name: 'relation identity', path: ['relations', 0, 'id'], value: 'other-relation' },
  { name: 'relation subject', path: ['relations', 0, 'subject'], value: 'unknown-person' },
  { name: 'relation position', path: ['relations', 0, 'object'], value: 'unknown-position' },
  { name: 'relation scope', path: ['relations', 0, 'scope'], value: 'unknown-organization' },
  { name: 'relation validity', path: ['relations', 0, 'validFrom'], value: '1' },
  { name: 'channel retry key', path: ['channels', 0, 'key'], value: 'another-private-channel' },
  { name: 'channel member', path: ['channels', 0, 'members', 0, 'entityId'], value: 'observer' },
  { name: 'channel director', path: ['channels', 0, 'members', 1, 'entityId'], value: 'requester' },
  { name: 'wake requester', path: ['initialEvents', 0, 'request', 'requesterEntityId'], value: 'observer' },
  { name: 'wake position', path: ['initialEvents', 0, 'request', 'positionEntityId'], value: 'unknown-position' },
  { name: 'wake description', path: ['initialEvents', 0, 'description'], value: 'Changed initial description' },
  { name: 'wake time', path: ['initialEvents', 0, 'at'], value: '1' },
  { name: 'world director', path: ['world', 'directorEntityId'], value: 'requester' },
  { name: 'world organization', path: ['world', 'organizationEntityId'], value: 'unknown-organization' },
  { name: 'world position capacity', path: ['world', 'positions', 0, 'capacity'], value: 99 },
  { name: 'world grant relation', path: ['world', 'authorizations', 0, 'relationId'], value: 'another-grant' },
  { name: 'world policy version', path: ['world', 'policyVersion'], value: 'other-policy' },
  { name: 'world request limit', path: ['world', 'limits', 'maxRequests'], value: 100 },
  { name: 'Native policy version', path: ['native', 'policyVersion'], value: 'other-policy' },
  { name: 'Native numeric limit', path: ['native', 'maxEntities'], value: 100 },
  { name: 'Native relation namespace', path: ['native', 'relationRules', 0, 'relation'], value: 'can-hire' },
  { name: 'Native endpoint policy', path: ['native', 'relationRules', 0, 'subjectKinds'], value: ['organization'] },
]
it.each(mutations)('rejects inconsistent $name after recomputing the full preview hash', async ({ path, value, name }) => {
  const creation = copy(await fixture())
  set(creation, [...resolved, ...path], value)
  if (name !== 'definition hash') reseal(creation)
  expect(simulationWorldCreationSchema.safeParse(creation).success).toBe(false)
})

it.each([
  { name: 'duplicate entity namespace', path: ['positions', 0, 'id'], value: 'director' },
  { name: 'unknown assignee', path: ['assignments', 0, 'personId'], value: 'unknown-person' },
  { name: 'unknown assigned position', path: ['assignments', 0, 'positionId'], value: 'unknown-position' },
  { name: 'unknown authorized actor', path: ['authorizations', 0, 'requesterId'], value: 'unknown-person' },
  { name: 'director self authorization', path: ['authorizations', 0, 'requesterId'], value: 'director' },
  { name: 'unknown authorized position', path: ['authorizations', 0, 'positionId'], value: 'unknown-position' },
  { name: 'unknown application actor', path: ['initialEvents', 0, 'requesterId'], value: 'observer' },
  { name: 'out of horizon initial event', path: ['initialEvents', 0, 'at'], value: '1001' },
  { name: 'different requested allowance', path: ['limits', 'world', 'maxPlansPerRequest'], value: 2 },
])('rejects inconsistent original $name even with an equal original definition and fresh hashes', async ({ path, value }) => {
  const creation = copy(await fixture())
  set(creation, [...resolved, 'definition', ...path], value)
  objectAt(creation, ['request']).definition = json.parse(at(creation, [...resolved, 'definition']))
  reseal(creation)
  expect(simulationWorldCreationSchema.safeParse(creation).success).toBe(false)
})

it('rejects structural missing arrays and actor capacities even when the original preview is recommitted', async () => {
  for (const [path, value] of [
    [['actors'], []], [['entities'], []], [['relations'], []], [['channels'], []], [['initialEvents'], []],
    [['limits', 'native', 'maxEntities'], 1], [['limits', 'team', 'maxParticipants'], 1],
    [['limits', 'team', 'maxActivations'], 1], [['limits', 'team', 'maxChannels'], 1],
    [['limits', 'native', 'maxPendingEvents'], 0], [['limits', 'native', 'maxOperationsPerDecision'], 1],
  ] satisfies readonly (readonly [Path, Value])[]) {
    const creation = copy(await fixture())
    set(creation, [...resolved, ...path], value)
    reseal(creation)
    expect(simulationWorldCreationSchema.safeParse(creation).success, path.join('.')).toBe(false)
  }
})

it('keeps public modules free of private registration, resolution and Node dependencies', async () => {
  for (const module of ['world-schema', 'world-types']) {
    const source = await readFile(new URL(`../src/${module}.ts`, import.meta.url), 'utf8')
    expect(source).not.toMatch(/from ['"](?:node:|@clocky\/clocky-simulation['"])/)
    expect(source).not.toMatch(/from ['"].*\/(?:directory|world-creation|world-preparation|world-preflight)\.ts/)
    expect(source).not.toMatch(/\b(?:process|Buffer)\.|\b(?:fetch|randomUUID|setTimeout|setInterval)\s*\(/)
  }
})

describe.each(['company', 'laboratory'] as const)('%s public World preview', (scenario) => {
  async function compilation() {
    const result = await compileWorldScenario(
      await readFile(`examples/simulation-company/scenarios/world-${scenario}.json`, 'utf8'), catalog())
    if (!result.ok) throw new Error('Public World preview fixture failed compilation')
    return result
  }

  it('projects complete initial metadata and explicit scope without exposing execution data or mutating the compilation', async () => {
    const compiled = await compilation(), before = structuredClone(compiled)
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Preview projection must not contact a provider'))
    const preview = worldPreflightPreview(compiled)
    if (preview.status !== 'ready') throw new Error('Compiled scenario has no ready public preview')
    expect(preview.preview).toEqual(compiled.preview)
    expect(preview.policyVersion).toBe(compiled.resolved.policyVersion)
    expect(preview.organization).toEqual(compiled.resolved.definition.organization)
    expect(preview.actors.map(actor => actor.name)).toEqual(scenario === 'company'
      ? ['Director', 'Recruiter', 'Observer'] : ['Coordinator', 'Research Lead', 'Observer'])
    expect(preview.actors.map(actor => actor.role)).toEqual(['director', 'member', 'member'])
    expect(preview.actors.map(actor => actor.model)).toEqual([
      { provider: 'scripted', name: 'world', version: 'model-1' },
      { provider: 'scripted', name: 'world', version: 'model-1' },
      { provider: 'scripted', name: 'world', version: 'model-1' },
    ])
    expect(preview.positions).toEqual([{ entityId: scenario === 'company' ? 'engineering' : 'research',
      name: scenario === 'company' ? 'Engineer' : 'Research assistant', capacity: 2, occupied: 1 }])
    expect(preview.authorizations).toEqual([{ requesterEntityId: 'requester', positionEntityId: preview.positions[0]!.entityId }])
    expect(preview.limits).toEqual(compiled.resolved.limits)
    expect(preview.maxTime).toBe(compiled.resolved.native.maxTime)
    expect(preview.budgetInterval).toBe(compiled.resolved.native.budgetInterval)
    expect(preview.tickUnit).toBe(compiled.resolved.native.tickUnit)
    expect(preview.scope).toEqual({ source: 'simulated-only', operation: 'organization.generate-and-hire/v1',
      payroll: false, committeeApproval: false })
    for (const source of [undefined, 'real-network', 'payment', false]) {
      expect(simulationProductWorldPreflightResultSchema.safeParse({ ...preview, scope: { ...preview.scope, source } }).success).toBe(false)
    }
    expect(Object.keys(preview)).toEqual(['status', 'preview', 'policyVersion', 'organization', 'actors', 'positions',
      'authorizations', 'limits', 'maxTime', 'budgetInterval', 'tickUnit', 'scope'])
    const withheld = ['record', 'resolved', 'definition', 'world', 'entities', 'relations', 'channels', 'initialEvents',
      'generatedActorRuntime', 'preparation', 'binding', 'participantId', 'sessionId', 'activationId', 'writer', 'context',
      'runtime', 'preset', 'persona', 'logs', 'origin', 'rulesVersion', 'relationRules']
    const publicJSON = copy(preview)
    for (const path of objectPaths(publicJSON)) {
      expect(Object.keys(objectAt(publicJSON, path)).some(key => withheld.includes(key)
        && !(path.length === 1 && path[0] === 'limits' && key === 'world')), path.join('.')).toBe(false)
    }
    expect(network).not.toHaveBeenCalled()
    expect(compiled).toEqual(before)
    const detached = simulationProductWorldPreflightResultSchema.parse(preview)
    if (detached.status !== 'ready') throw new Error('Parsed public preview lost its ready summary')
    detached.organization.name = 'Change detached public response'
    expect(compiled).toEqual(before)
  })

  it('rejects unknown and missing response fields at every nested public object', async () => {
    const result = copy(worldPreflightPreview(await compilation()))
    for (const path of objectPaths(result)) {
      const unknown = copy(result)
      objectAt(unknown, path).unexpected = true
      const parsed = simulationProductWorldPreflightResultSchema.safeParse(unknown)
      expect(parsed.success, path.join('.')).toBe(false)
      if (!parsed.success) expect(parsed.error.issues.some(issue => issue.code === 'unrecognized_keys')).toBe(true)
      for (const key of Object.keys(objectAt(result, path))) {
        const missing = copy(result)
        Reflect.deleteProperty(objectAt(missing, path), key)
        expect(simulationProductWorldPreflightResultSchema.safeParse(missing).success, [...path, key].join('.')).toBe(false)
      }
    }
  })

  it('rejects altered scope, occupancy, preview counts and unauthorized initial references', async () => {
    const result = copy(worldPreflightPreview(await compilation()))
    const mutations: readonly (readonly [Path, Value])[] = [
      [['scope', 'payroll'], true], [['scope', 'committeeApproval'], true], [['scope', 'operation'], 'another-operation'],
      [['positions', 0, 'occupied'], 3], [['positions', 0, 'occupied'], -1], [['positions', 0, 'capacity'], 0],
      [['preview', 'hash'], 'uncommitted'], [['preview', 'actorCount'], 4], [['preview', 'positionCount'], 0],
      [['preview', 'initialRequestCount'], -1], [['preview', 'directorEntityId'], 'observer'],
      [['preview', 'organizationName'], 'Another organization'], [['actors', 0, 'role'], 'member'],
      [['actors', 1, 'role'], 'director'], [['authorizations', 0, 'requesterEntityId'], 'director'],
      [['authorizations', 0, 'positionEntityId'], 'another-position'], [['budgetInterval'], '0'],
      [['limits', 'native', 'maxEntities'], 0], [['limits', 'team', 'maxParticipants'], 0],
      [['limits', 'world', 'maxPlansPerRequest'], 0],
    ]
    for (const [path, value] of mutations) {
      const changed = copy(result)
      set(changed, path, value)
      expect(simulationProductWorldPreflightResultSchema.safeParse(changed).success, path.join('.')).toBe(false)
    }
  })
})

it('projects only field diagnostics on invalid preflight and strictly rejects extra diagnostic metadata', async () => {
  const compiled = await compileWorldScenario('{', catalog()), before = structuredClone(compiled)
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Invalid preview must remain pure'))
  const invalid = worldPreflightPreview(compiled)
  expect(invalid.status).toBe('invalid')
  if (invalid.status !== 'invalid' || compiled.ok) throw new Error('Invalid fixture unexpectedly compiled')
  expect(invalid.diagnostics).toEqual(compiled.diagnostics)
  expect(Object.keys(invalid)).toEqual(['status', 'diagnostics'])
  const input = copy(invalid)
  for (const path of objectPaths(input)) {
    const changed = copy(input)
    objectAt(changed, path).privateProviderError = 'Must not be forwarded'
    expect(simulationProductWorldPreflightResultSchema.safeParse(changed).success).toBe(false)
  }
  expect(simulationProductWorldPreflightResultSchema.safeParse({ status: 'invalid', diagnostics: [] }).success).toBe(false)
  expect(simulationProductWorldPreflightResultSchema.safeParse({ ...input, resolved: {} }).success).toBe(false)
  expect(network).not.toHaveBeenCalled()
  expect(compiled).toEqual(before)
})

it('binds an exported original definition to its selected run and rejects bare or execution-enriched responses', async () => {
  const creation = await fixture(), exported = { runId: creation.record.id, definition: creation.request.definition }
  expect(simulationProductWorldExportResultSchema.parse(exported)).toEqual(exported)
  expect(simulationProductWorldExportResultSchema.safeParse(creation.request.definition).success).toBe(false)
  expect(simulationProductWorldExportResultSchema.safeParse({ definition: exported.definition }).success).toBe(false)
  expect(simulationProductWorldExportResultSchema.safeParse({ ...exported, record: creation.record }).success).toBe(false)
  for (const path of objectPaths(copy(exported))) {
    const changed = copy(exported)
    objectAt(changed, path).unexpected = true
    expect(simulationProductWorldExportResultSchema.safeParse(changed).success).toBe(false)
  }
})
