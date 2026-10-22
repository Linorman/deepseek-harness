/** Pure v1 compiler retains complete source data and exact deployment selections for paused Native initialization. */
import { worldScenarioV1Schema, scenarioV1CatalogSchema } from './v1-schema.ts'
import type { WorldScenarioV1, ScenarioV1Catalog, ScenarioV1Diagnostic } from './v1-schema.ts'
import { validateV1Relationships } from './v1-validation.ts'
import { decodeScenarioInput, validateScenarioJSON, validateScenarioResultSize, serializeScenarioDefinition } from './input.ts'
import { simulationWorldDefinitionSchema } from '@clocky/clocky-simulation/world'
import type { ScenarioSourceFormat, ScenarioDiagnostic } from './types.ts'
import { scenarioTeamLimitsSchema } from './schema.ts'

type TeamCeilings = ScenarioV1Catalog['limits']['ceilings']['team']

/**
 * Apply the observed Team owner ceiling without overwriting the declared deployment catalog.
 * @param catalog - Complete original configured metadata.
 * @param teamCeilings - Actual Team creation bounds, or null for compilation without a Host observation.
 * @returns metadata used only for semantic validation and effective Team limit resolution.
 */
export function boundedWorldScenarioV1Catalog(catalog: ScenarioV1Catalog, teamCeilings: TeamCeilings | null): ScenarioV1Catalog {
  if (teamCeilings === null) return catalog
  const team = Object.fromEntries(Object.entries(catalog.limits.ceilings.team).map(([key, value]) =>
    [key, Math.min(value, teamCeilings[key as keyof TeamCeilings])])) as TeamCeilings
  return { ...catalog, limits: { defaults: catalog.limits.defaults, ceilings: { ...catalog.limits.ceilings, team } } }
}

function canonical(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
    : item !== null && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, sort(value)]))
      : item
  return JSON.stringify(sort(value))
}
async function hash(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))
  return `sha256:${Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')}`
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
/** Semantic validation proves every deployment and entity lookup before materialization. */
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Validated v1 compiler lookup lost its original declaration')
  return value
}
function resolveLimits(definition: WorldScenarioV1, catalog: ScenarioV1Catalog) {
  const cap = <T extends Record<string, number>>(defaults: T, ceilings: T,
    requested: { [Key in keyof T]?: T[Key] | undefined }): T =>
    Object.fromEntries(Object.entries(defaults).map(([key, value]) =>
      [key, Math.min(requested[key] ?? value, required(ceilings[key]))])) as T
  return { native: cap(catalog.limits.defaults.native, catalog.limits.ceilings.native, definition.limits.native),
    team: cap(catalog.limits.defaults.team, catalog.limits.ceilings.team, definition.limits.team),
    world: cap(catalog.limits.defaults.world, catalog.limits.ceilings.world, definition.limits.world) }
}
function materialize(definition: WorldScenarioV1, catalog: ScenarioV1Catalog, teamCeilings: TeamCeilings | null) {
  const reference = (value: { id: string; version: string }) => JSON.stringify([value.id, value.version])
  const selector = (value: { domain: string; operation: string; version: string }) =>
    JSON.stringify([value.domain, value.operation, value.version])
  const templates = definition.runtimeProfiles.templates.map(value =>
    required(catalog.templates.find(item => reference(item.template) === reference(value))).template)
  const actors = definition.entities.flatMap((value) => {
    if (value.kind !== 'person' || value.cognition !== 'agent') return []
    return [{ entityId: value.id, role: value.role, persona: value.persona,
      template: required(templates.find(item => reference(item) === reference(value.template))),
      runtime: required(catalog.runtimeProfiles.find(item => reference(item) === reference(value.runtimeProfile))) }]
  })
  const operations = definition.domains.map(value =>
    required(catalog.domains.find(item => selector(item.pin) === selector(value))).pin)
  const director = required(actors.find(value => value.role === 'director'))
  const limits = resolveLimits(definition, boundedWorldScenarioV1Catalog(catalog, teamCeilings))
  const world = simulationWorldDefinitionSchema.parse({ directorEntityId: director.entityId,
    ...catalog.modelProtocol === undefined ? {} : { modelProtocol: catalog.modelProtocol },
    ...definition.organization.hiringFees === undefined ? {} : { hiringFees: definition.organization.hiringFees },
    organizationEntityId: definition.organization.rootId, operations,
    positions: definition.organization.positions.map(value => ({ entityId: value.id, capacity: value.capacity })),
    positionRolePermissions: definition.organization.positions.map(value => ({ positionEntityId: value.id,
      permissions: value.permissions.map(item => ({ domain: item.domain, operation: item.operation, version: item.version,
        scopeEntityId: item.scopeId, targetEntityId: item.targetId, relation: item.relation })) })),
    operationGrants: definition.organization.grants.map(value => ({ requesterEntityId: value.personId,
      domain: value.domain, operation: value.operation, version: value.version, scopeEntityId: value.scopeId,
      targetEntityId: value.targetId, relationId: value.id, relation: value.relation })),
    authorizations: definition.organization.grants.filter(value => value.domain === 'organization'
      && value.operation === 'generate-and-hire' && value.version === '1').map(value => ({ requesterEntityId: value.personId,
      positionEntityId: value.targetId, relationId: value.id })),
    ...definition.externalWorld.adjudicationPolicy === undefined ? {}
      : { externalAdjudicationPolicy: definition.externalWorld.adjudicationPolicy },
    templates, policyVersion: catalog.policyVersion, limits: limits.world })
  const entity = (id: string, kind: string, name: string, description: string) => ({ kind: 'entity/create' as const, id,
    entityKind: kind, cognition: 'none' as const, readiness: 'ready' as const, profile: { name, description } })
  const entities = [
    ...definition.entities.map(value => value.kind === 'person' && value.cognition === 'agent'
      ? { kind: 'entity/create' as const, id: value.id, entityKind: value.kind, cognition: 'agent' as const,
        readiness: 'preparing' as const, profile: { name: value.name, description: value.description, persona: value.persona } }
      : value.kind === 'environment' ? { ...entity(value.id, value.kind, value.name, value.description), profile: { name: value.name, description: value.description, environment: value.environment } }
        : value.kind === 'person-state' ? { ...entity(value.id, value.kind, value.name, value.description), profile: { name: value.name, description: value.description, evolution: value.evolution } }
          : entity(value.id, value.kind, value.name, value.description)),
    ...definition.organization.positions.map(value => entity(value.id, 'position', value.name, value.description)),
    ...definition.governance.committees.map(value => entity(value.id, 'organization', value.name, value.description)),
  ]
  const relation = (id: string, subject: string, name: string, object: string, scope: string,
    validFrom: string, validUntil: string | null) =>
    ({ kind: 'relation/create' as const, id, subject, relation: name, object, scope, validFrom, validUntil })
  const relations = [
    ...definition.organization.assignments.map(value => relation(value.id, value.personId, 'assignment', value.positionId,
      definition.organization.rootId, value.validFrom, value.validUntil)),
    ...definition.organization.grants.map(value => relation(value.id, value.personId, value.relation, value.targetId,
      value.scopeId, value.validFrom, value.validUntil)),
    ...definition.governance.committees.flatMap(value => value.members.map(member => relation(member.id, member.personId,
      'committee-member', value.id, value.scopeId, member.validFrom, member.validUntil))),
    ...definition.organization.units.map(value => relation(`unit-parent:${value.id}`, value.id, 'organization-parent', value.parentId,
      definition.organization.rootId, '0', null)),
  ]
  const rules = new Map<string, { relation: string; subjectKinds: Set<string>; objectKinds: Set<string>; scopeKinds: Set<string> }>()
  const kinds = new Map(entities.map(value => [value.id, value.entityKind]))
  rules.set('assignment', { relation: 'assignment', subjectKinds: new Set(['person']),
    objectKinds: new Set(['position']), scopeKinds: new Set(['organization']) })
  for (const value of relations) {
    const rule = rules.get(value.relation) ?? { relation: value.relation,
      subjectKinds: new Set(), objectKinds: new Set(), scopeKinds: new Set() }
    rule.subjectKinds.add(required(kinds.get(value.subject)))
    rule.objectKinds.add(required(kinds.get(value.object)))
    rule.scopeKinds.add(required(kinds.get(value.scope)))
    rules.set(value.relation, rule)
  }
  for (const position of definition.organization.positions) for (const permission of position.permissions) {
    const rule = rules.get(permission.relation) ?? { relation: permission.relation,
      subjectKinds: new Set<string>(), objectKinds: new Set<string>(), scopeKinds: new Set<string>() }
    rule.subjectKinds.add('person')
    rule.objectKinds.add(required(kinds.get(permission.targetId)))
    rule.scopeKinds.add('organization')
    rules.set(permission.relation, rule)
  }
  if (definition.domains.some(value => value.domain === 'organization' && value.operation === 'hiring-market')) {
    for (const [relation, objectKind] of [['eligible-for-hire', 'organization'], ['can-market', 'position']]) {
      if (relation === undefined || objectKind === undefined) throw new Error('Candidate relation declaration is incomplete')
      const rule = rules.get(relation) ?? { relation,
        subjectKinds: new Set<string>(), objectKinds: new Set<string>(), scopeKinds: new Set<string>() }
      rule.subjectKinds.add('person'); rule.objectKinds.add(objectKind); rule.scopeKinds.add('organization'); rules.set(relation, rule)
    }
  }
  const representative = definition.domains.some(value => value.domain === 'external' && value.operation === 'interact'
    && (value.version === '2' || value.version === '3'
      && definition.externalWorld.adjudicationPolicy?.allowedOutcomeKinds.includes('representative-preparation-plan')))
  if (representative) rules.set('represents', { relation: 'represents', subjectKinds: new Set(['person']),
    objectKinds: new Set(['organization']), scopeKinds: new Set(['organization']) })
  const channels = [...actors.filter(value => value.role !== 'director').map(value => ({ key: `world-director:${value.entityId}`,
    members: [{ entityId: value.entityId, role: 'member' }, { entityId: director.entityId, role: 'director' }] })),
  ...definition.communication.channels.map(value => ({ key: value.key,
    members: value.members.map(member => ({ entityId: member.personId, role: member.role })) }))]
  return { apiVersion: 'clocky.world/v1' as const, compilerVersion: '9' as const,
    catalogGeneration: catalog.generation, policyVersion: catalog.policyVersion, definition, catalog, teamCeilings, limits,
    native: { ...catalog.native, ...limits.native, policyVersion: catalog.policyVersion,
      relationRules: [...rules.values()].map(value => ({ relation: value.relation, subjectKinds: [...value.subjectKinds].sort(),
        objectKinds: [...value.objectKinds].sort(), scopeKinds: [...value.scopeKinds].sort(),
        acyclic: value.relation === 'assignment' || value.relation === 'organization-parent' })) },
    world, actors, entities, relations, channels,
    runtimeProfiles: catalog.runtimeProfiles.filter(value =>
      definition.runtimeProfiles.allowed.some(original => reference(original) === reference(value))),
    generatedActorRuntime: required(catalog.runtimeProfiles.find(value =>
      reference(value) === reference(definition.runtimeProfiles.generated))),
    bootstrap: { resources: definition.resources, facts: definition.facts, knowledge: definition.knowledge,
      norms: definition.governance.norms, committeePolicies: definition.governance.committees,
      externalIdentities: definition.externalWorld.identities, behavior: definition.behavior } }
}

/**
 * Derive commands from a semantically validated definition and its original retained metadata.
 * @param definition - Strict v1 definition whose symbols and owner limits were validated by the compiler.
 * @param catalog - Strict original installed selections; this helper performs no current metadata lookup.
 * @param teamCeilings - Retained actual Team creation bounds, or null when no Host observation was supplied.
 * @returns complete deterministic Native/Team/bootstrap projection, excluding its asynchronous definition hash.
 */
export function projectWorldScenarioV1(definition: WorldScenarioV1, catalog: ScenarioV1Catalog,
  teamCeilings: TeamCeilings | null): ReturnType<typeof materialize> {
  return materialize(definition, catalog, teamCeilings)
}

type V1Failure = { readonly ok: false; readonly diagnostics: readonly (Omit<ScenarioDiagnostic, 'code'> & { readonly code: ScenarioV1Diagnostic['code'] })[] }
type V1ParseResult = { readonly ok: true; readonly definition: WorldScenarioV1 } | V1Failure
type V1Resolved = ReturnType<typeof materialize> & { definitionHash: string }
type V1Preview = {
  hash: string
  catalogGeneration: string
  creationMode: 'paused'
  source: 'simulated-only'
  actorCount: number
  organizationName: string | undefined
  positionCount: number
  initialRequestCount: number
  entityCount: number
  directorEntityId: V1Resolved['world']['directorEntityId']
  domains: V1Resolved['world']['operations']
  limits: V1Resolved['limits']
  models: Array<{ entityId: string
    role: 'director' | 'member' } & V1Resolved['actors'][number]['runtime']['model']>
  enforcement: Array<{ id: string
    kind: 'advisory' | 'validated' }>
}
type V1Compilation = { readonly ok: true; readonly resolved: V1Resolved; readonly preview: V1Preview } | V1Failure

/**
 * Parse, validate and resolve a complete bounded definition without identity allocation or inference.
 * @param input - Decoded definition or explicit JSON/YAML file text.
 * @param catalogInput - Trusted complete deployment metadata with exact operation generations.
 * @param format - Explicit source syntax; JSON is the default and no fallback guessing occurs.
 * @param teamCeilings - Actual Host Team creation bounds; null when compiling without a Host observation.
 * @returns the complete frozen portable definition, execution choices, bootstrap data and preview, or field diagnostics.
 * @throws when standard Web Crypto is unavailable or hashing fails.
 */
export async function compileWorldScenarioV1(input: unknown, catalogInput: unknown,
  format: ScenarioSourceFormat = 'json', teamCeilings: unknown = null): Promise<V1Compilation> {
  const parsed = parseWorldScenarioV1(input, format)
  if (!parsed.ok) return parsed
  const badCatalog = validateScenarioJSON(catalogInput, 'catalog')
  if (badCatalog !== undefined) return { ok: false as const, diagnostics: [badCatalog] }
  const installed = scenarioV1CatalogSchema.safeParse(catalogInput)
  if (!installed.success) return { ok: false as const, diagnostics: installed.error.issues.map(issue => ({ source: 'catalog' as const,
    path: issue.path.map(key =>
      typeof key === 'number' ? key : String(key)), code: 'invalid-catalog', message: issue.message })) }
  const observed = scenarioTeamLimitsSchema.nullable().safeParse(teamCeilings)
  if (!observed.success) return { ok: false, diagnostics: observed.error.issues.map(issue => ({ source: 'catalog',
    path: ['teamCeilings', ...issue.path.map(key => typeof key === 'number' ? key : String(key))],
    code: 'invalid-catalog', message: issue.message })) }
  const diagnostics: ScenarioV1Diagnostic[] = validateV1Relationships(parsed.definition,
    boundedWorldScenarioV1Catalog(installed.data, observed.data))
  if (diagnostics.length > 0) return { ok: false as const, diagnostics: diagnostics.map(value => ({ ...value, source: 'scenario' as const })) }
  const body = materialize(parsed.definition, installed.data, observed.data)
  const resolved = { ...body, definitionHash: await hash(parsed.definition) }
  const preview = { hash: await hash(resolved), catalogGeneration: resolved.catalogGeneration,
    creationMode: 'paused' as const, source: 'simulated-only' as const, actorCount: resolved.actors.length,
    organizationName: resolved.entities.find(value => value.id === resolved.world.organizationEntityId)?.profile.name,
    positionCount: resolved.world.positions.length, initialRequestCount: 0,
    entityCount: resolved.entities.length, directorEntityId: resolved.world.directorEntityId,
    domains: resolved.world.operations, limits: resolved.limits,
    models: resolved.actors.map(value => ({ entityId: value.entityId, role: value.role, ...value.runtime.model })),
    enforcement: resolved.bootstrap.norms.map(value => ({ id: value.id, kind: value.enforcement.kind })) }
  const result = { ok: true as const, resolved, preview }
  const size = validateScenarioResultSize(result)
  return size === undefined ? freeze(result) : { ok: false as const, diagnostics: [size] }
}

/**
 * Validate source syntax and the strict v1 shape without resolving routes, templates or identities.
 * @param input - Decoded JSON data or explicit file text.
 * @param format - JSON or safe YAML syntax.
 * @returns a detached v1 definition or located field diagnostics.
 */
export function parseWorldScenarioV1(input: unknown, format: ScenarioSourceFormat = 'json'): V1ParseResult {
  const decoded = decodeScenarioInput(input, format)
  if (!decoded.ok) return decoded
  const result = worldScenarioV1Schema.safeParse(decoded.value)
  if (result.success) return { ok: true as const, definition: result.data }
  return { ok: false as const, diagnostics: result.error.issues.flatMap((issue) => {
    const paths = issue.code === 'unrecognized_keys' ? issue.keys.map(key => [...issue.path, key]) : [issue.path]
    return paths.map((path) => {
      const selected = path.map(key => typeof key === 'number' ? key : String(key))
      return { source: 'scenario' as const, path: selected, code: 'invalid-shape' as const, message: issue.message,
        ...typeof input !== 'string' ? {} : { format, ...decoded.locate(selected) } }
    })
  }) }
}

/**
 * Recompile before accepting a new command against its reviewed generation and complete preview commitment.
 * @param input - Original portable input.
 * @param catalog - Actual current installed metadata.
 * @param expected - Previously reviewed preview hash and generation.
 * @param format - Original explicit source syntax.
 * @param teamCeilings - Current actual Team creation bounds, or null for pure compilation without a Host observation.
 * @returns the exact current compilation or a stale-preview diagnosis, with no world writes.
 */
export async function verifyWorldScenarioV1(input: unknown, catalog: unknown,
  expected: { readonly hash: string; readonly catalogGeneration: string },
  format: ScenarioSourceFormat = 'json', teamCeilings: unknown = null): Promise<V1Compilation> {
  const current = await compileWorldScenarioV1(input, catalog, format, teamCeilings)
  if (!current.ok) return current
  if (current.preview.hash !== expected.hash || current.preview.catalogGeneration !== expected.catalogGeneration)
    return { ok: false as const, diagnostics: [{ source: 'preflight' as const, path: ['preview'], code: 'stale-preflight',
      message: 'Scenario preview or installed generation changed; review a new preflight' }] }
  return current
}

/**
 * Export only the original portable definition, preserving supported JSON/YAML semantics.
 * @param resolved - Original successful compiler result; live logs, bindings and private execution records are excluded.
 * @param format - Selected JSON or safe YAML output syntax.
 * @returns one new-run definition; this is not a runtime backup.
 */
export function exportWorldScenarioV1Text(resolved: { readonly definition: unknown }, format: ScenarioSourceFormat): string {
  return serializeScenarioDefinition(worldScenarioV1Schema.parse(resolved.definition), format)
}
