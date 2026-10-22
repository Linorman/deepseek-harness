import { WORLD_GENERATE_AND_HIRE_PIN } from '@clocky/clocky-simulation/world-domains'
/** Browser-safe deterministic compilation over bounded JSON/YAML input and standard Web Crypto; no host IO. */
import type { z } from 'zod'
import { simulationWorldDefinitionSchema } from '@clocky/clocky-simulation/world'
import { scenarioCatalogSchema, worldScenarioSchema } from './schema.ts'
import { resolveLimits, resolvePersona, selectedProfile, validateRelationships } from './validation.ts'
import { decodeScenarioInput, serializeScenarioDefinition, validateScenarioJSON, validateScenarioResultSize } from './input.ts'
import type {
  ResolvedWorldScenario, ScenarioCatalog, ScenarioCompilation, ScenarioDiagnostic, ScenarioEntityCommand,
  ScenarioLimits, ScenarioParseResult, ScenarioPreview, ScenarioRelationCommand, ScenarioSourceFormat, WorldScenario,
} from './types.ts'

function schemaDiagnostics(source: 'scenario' | 'catalog', error: z.ZodError): ScenarioDiagnostic[] {
  return error.issues.flatMap(issue => (issue.code === 'unrecognized_keys' ? issue.keys.map(key => [...issue.path, key]) : [issue.path])
    .map(path => ({ source, path: path.map(key => typeof key === 'number' ? key : String(key)),
      code: 'invalid-shape' as const, message: issue.message })))
}

/**
 * Parse explicit JSON/YAML text or an inert decoded JSON value without resolving references or assigning defaults.
 * @param input - Portable definition at the file/JSON boundary.
 * @param format - Explicit file syntax, defaulting to JSON; no fallback guessing occurs.
 * @returns a detached validated definition, or field diagnostics; malformed JSON never reaches catalog resolution.
 */
export function parseWorldScenario(input: unknown, format: ScenarioSourceFormat = 'json'): ScenarioParseResult {
  const decoded = decodeScenarioInput(input, format)
  if (!decoded.ok) return decoded
  const parsed = worldScenarioSchema.safeParse(decoded.value)
  return parsed.success ? { ok: true, definition: JSON.parse(JSON.stringify(parsed.data)) as WorldScenario }
    : { ok: false, diagnostics: schemaDiagnostics('scenario', parsed.error).map(diagnostic => ({ ...diagnostic,
      ...typeof input !== 'string' ? {} : { format, ...decoded.locate(diagnostic.path) } })) }
}

function canonicalJSON(value: unknown): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted)
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, item]) => [key, sorted(item)]))
    }
    return value
  }
  return JSON.stringify(sorted(value))
}
async function fingerprint(value: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJSON(value)))
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function materialize(definition: WorldScenario, catalog: ScenarioCatalog, limits: ScenarioLimits,
  definitionHash: string): ResolvedWorldScenario {
  // Relationship validation has established every selected version and the unique director.
  const templates = definition.templates.map(reference => catalog.templates.find(value =>
    value.template.id === reference.id && value.template.version === reference.version) as ScenarioCatalog['templates'][number])
  const actors = definition.actors.map((actor) => {
    const selected = templates.find(value => value.template.id === actor.template.id
      && value.template.version === actor.template.version) as ScenarioCatalog['templates'][number]
    return { entityId: actor.id, role: actor.role,
      runtime: selectedProfile({ runtimeProfile: actor.runtimeProfile ?? definition.runtimeProfile }, catalog),
      template: selected.template, persona: resolvePersona(selected.defaultPersona, actor.persona) }
  })
  const director = actors.find(value => value.role === 'director') as typeof actors[number]
  const entities: ScenarioEntityCommand[] = [
    { kind: 'entity/create', id: definition.organization.id, entityKind: 'organization', cognition: 'none', readiness: 'ready',
      profile: { name: definition.organization.name, description: definition.organization.description } },
    ...definition.positions.map(position => ({ kind: 'entity/create' as const, id: position.id, entityKind: 'position' as const,
      cognition: 'none' as const, readiness: 'ready' as const, profile: { name: position.name, description: position.name } })),
    ...actors.map(actor => ({ kind: 'entity/create' as const, id: actor.entityId, entityKind: 'person' as const,
      cognition: 'agent' as const, readiness: 'preparing' as const,
      profile: { name: actor.persona.name, description: actor.template.description, persona: actor.persona } })),
  ]
  const relations: ScenarioRelationCommand[] = [
    ...definition.assignments.map(value => ({ kind: 'relation/create' as const, id: value.id, subject: value.personId,
      relation: 'assignment' as const, object: value.positionId, scope: definition.organization.id, validFrom: '0' as const,
      validUntil: null })),
    ...definition.authorizations.map(value => ({ kind: 'relation/create' as const, id: value.id, subject: value.requesterId,
      relation: 'can-hire' as const, object: value.positionId, scope: definition.organization.id, validFrom: '0' as const,
      validUntil: null })),
  ]
  return {
    apiVersion: 'clocky.world/v0', compilerVersion: '1', catalogGeneration: catalog.generation, policyVersion: catalog.policyVersion,
    definitionHash, definition, limits,
    native: { ...catalog.native, ...limits.native, policyVersion: catalog.policyVersion,
      relationRules: (['assignment', 'can-hire'] as const).map(relation => ({ relation,
        subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: true })) },
    world: simulationWorldDefinitionSchema.parse({ operations: [WORLD_GENERATE_AND_HIRE_PIN], positionRolePermissions: [],
      operationGrants: definition.authorizations.map(value => ({ requesterEntityId: value.requesterId,
        domain: WORLD_GENERATE_AND_HIRE_PIN.domain, operation: WORLD_GENERATE_AND_HIRE_PIN.operation,
        version: WORLD_GENERATE_AND_HIRE_PIN.version,
        scopeEntityId: definition.organization.id, targetEntityId: value.positionId, relationId: value.id, relation: 'can-hire' })),
      directorEntityId: director.entityId, organizationEntityId: definition.organization.id,
      positions: definition.positions.map(value => ({ entityId: value.id, capacity: value.capacity })),
      authorizations: definition.authorizations.map(value => ({ requesterEntityId: value.requesterId,
        positionEntityId: value.positionId, relationId: value.id })),
      templates: templates.map(value => value.template), policyVersion: catalog.policyVersion, limits: limits.world }),
    generatedActorRuntime: selectedProfile(definition, catalog), actors, entities, relations,
    channels: actors.filter(actor => actor.role !== 'director').map(actor => ({ key: `world-director:${actor.entityId}`,
      members: [{ entityId: actor.entityId, role: 'member' }, { entityId: director.entityId, role: 'director' }] })),
    initialEvents: definition.initialEvents.map(event => ({ at: event.at, description: event.description,
      request: { organizationEntityId: definition.organization.id, positionEntityId: event.positionId,
        requesterEntityId: event.requesterId, applicationId: event.applicationId } })),
  }
}

/**
 * Resolve one portable definition using an installed metadata snapshot, without loading profiles, allocating identities or performing IO.
 * @param input - Decoded JSON definition or explicit file text.
 * @param catalogInput - Explicit installed versions, model availability, policy, clocks, defaults and hard caps.
 * @param format - File syntax, defaulting to JSON.
 * @returns deeply frozen resolved creation inputs and a SHA-256 preflight, or field diagnostics with no partial result.
 * @throws if standard Web Crypto is unavailable or its digest operation fails; Node 22+ and secure browser contexts provide it.
 */
export async function compileWorldScenario(input: unknown, catalogInput: unknown,
  format: ScenarioSourceFormat = 'json'): Promise<ScenarioCompilation> {
  const parsed = parseWorldScenario(input, format)
  if (!parsed.ok) return parsed
  const catalogError = validateScenarioJSON(catalogInput, 'catalog')
  if (catalogError !== undefined) return { ok: false, diagnostics: [catalogError] }
  const installed = scenarioCatalogSchema.safeParse(catalogInput)
  if (!installed.success) return { ok: false, diagnostics: schemaDiagnostics('catalog', installed.error) }
  const definition = parsed.definition, catalog = installed.data, limits = resolveLimits(definition, catalog)
  const diagnostics = validateRelationships(definition, catalog, limits)
  if (diagnostics.length !== 0) return { ok: false, diagnostics }
  const resolved = materialize(definition, catalog, limits, await fingerprint(definition))
  const preview: ScenarioPreview = { hash: await fingerprint(resolved), catalogGeneration: catalog.generation,
    organizationName: definition.organization.name, actorCount: definition.actors.length,
    positionCount: definition.positions.length, initialRequestCount: definition.initialEvents.length,
    directorEntityId: resolved.world.directorEntityId }
  const result = { ok: true as const, resolved, preview }
  const resultError = validateScenarioResultSize(result)
  return resultError === undefined ? freeze(result) : { ok: false, diagnostics: [resultError] }
}

/**
 * Recompile immediately before accepting a creation command and reject a changed preview or installed generation.
 * @param input - Original portable definition retained by the caller.
 * @param catalog - Current installed metadata snapshot.
 * @param expected - Preview identity the user reviewed.
 * @param format - Original file syntax, defaulting to JSON.
 * @returns the current frozen compilation only when both commitments match; callers persist it before any creation IO.
 */
export async function verifyWorldScenario(input: unknown, catalog: unknown,
  expected: Pick<ScenarioPreview, 'hash' | 'catalogGeneration'>, format: ScenarioSourceFormat = 'json'): Promise<ScenarioCompilation> {
  const compiled = await compileWorldScenario(input, catalog, format)
  if (!compiled.ok) return compiled
  const diagnostics: ScenarioDiagnostic[] = []
  for (const key of ['hash', 'catalogGeneration'] as const) {
    if (compiled.preview[key] !== expected[key]) diagnostics.push({ source: 'preflight', path: [key], code: 'stale-preflight',
      message: 'Scenario preview changed; review a new preflight before creating the run' })
  }
  return diagnostics.length === 0 ? compiled : { ok: false, diagnostics }
}

/**
 * Return only the portable new-run definition, excluding resolved runtime metadata, identity bindings and live state.
 * @param resolved - Previously accepted compiler result; live snapshots are not export inputs.
 * @returns a detached JSON definition that recompiles identically against the same catalog; this is not a running-world backup.
 */
export function exportWorldScenario(resolved: ResolvedWorldScenario): WorldScenario {
  return worldScenarioSchema.parse(resolved.definition)
}

/**
 * Export the portable definition in an explicit syntax for another new run.
 * @param resolved - Original successful compilation; no live run state is exported.
 * @param format - JSON or safe YAML syntax.
 * @returns one document preserving supported semantics and definition hash against the same catalog.
 */
export function exportWorldScenarioText(resolved: ResolvedWorldScenario, format: ScenarioSourceFormat): string {
  return serializeScenarioDefinition(exportWorldScenario(resolved), format)
}
