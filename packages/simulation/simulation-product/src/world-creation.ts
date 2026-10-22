import { WORLD_GENERATE_AND_HIRE_PIN } from '@clocky/clocky-simulation'
/** Private original World creation parsing; retained snapshots are validated without current metadata or execution IO. */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { scenarioLimitsSchema, scenarioNativeLimitsSchema, scenarioNativeSettingsSchema,
  scenarioRuntimeProfileSchema, worldScenarioSchema, resolvedWorldScenarioV1Schema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario, ResolvedWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import { simulationWorldDefinitionSchema, simulationWorldPersonaSchema, simulationWorldTemplateSchema,
  simulationHireIntentRequestSchema } from '@clocky/clocky-simulation/world'
import { simulationCheckpointIdSchema } from '@clocky/clocky-simulation'
import { simulationProductRecordSchema } from './directory.ts'
import { simulationProductWorldCreateInputSchema } from './world-schema.ts'
import type { SimulationProductRecord } from './registration-types.ts'
import type { SimulationProductWorldCreateInput } from './world-types.ts'
import type { SimulationWorldPreparation } from './world-preparation.ts'

/** Full private creation intent; public callers supply only request, never record or preparation. */
export interface SimulationWorldCreation {
  /** Product-allocated provider/run identity and authenticated owner, retained before identity IO. */
  readonly record: SimulationProductRecord
  /** Complete original public command, including the reviewed preview commitment. */
  readonly request: SimulationProductWorldCreateInput
  /** Exact accepted compilation and fixed initial preparation identity; replay never recomputes current defaults. */
  readonly preparation: SimulationWorldPreparation
}

const key = worldScenarioSchema.shape.organization.shape.id
const text = z.string().min(1)
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const role = z.enum(['director', 'member'])
const nativeRule = z.strictObject({ relation: z.enum(['assignment', 'can-hire']), subjectKinds: z.tuple([z.literal('person')]),
  objectKinds: z.tuple([z.literal('position')]), scopeKinds: z.tuple([z.literal('organization')]), acyclic: z.literal(true) })
const native = scenarioNativeSettingsSchema.extend({ ...scenarioNativeLimitsSchema.shape,
  policyVersion: text, relationRules: z.array(nativeRule).length(2) })
const entity = z.discriminatedUnion('cognition', [
  z.strictObject({ kind: z.literal('entity/create'), id: key, entityKind: z.enum(['organization', 'position']),
    cognition: z.literal('none'), readiness: z.literal('ready'), profile: z.strictObject({ name: text, description: text }) }),
  z.strictObject({ kind: z.literal('entity/create'), id: key, entityKind: z.literal('person'), cognition: z.literal('agent'),
    readiness: z.literal('preparing'), profile: z.strictObject({ name: text, description: text, persona: simulationWorldPersonaSchema }) }),
])
const relation = z.strictObject({ kind: z.literal('relation/create'), id: key, subject: key,
  relation: z.enum(['assignment', 'can-hire']), object: key, scope: key, validFrom: z.literal('0'), validUntil: z.null() })
const channel = z.strictObject({ key: text, members: z.tuple([
  z.strictObject({ entityId: key, role: z.literal('member') }), z.strictObject({ entityId: key, role: z.literal('director') }),
]) })
const resolvedFields = z.strictObject({ apiVersion: z.literal('clocky.world/v0'), compilerVersion: z.literal('1'),
  catalogGeneration: text, policyVersion: text, definitionHash: hash, definition: worldScenarioSchema,
  limits: scenarioLimitsSchema, native, world: simulationWorldDefinitionSchema, generatedActorRuntime: scenarioRuntimeProfileSchema,
  actors: z.array(z.strictObject({ entityId: key, role, runtime: scenarioRuntimeProfileSchema,
    template: simulationWorldTemplateSchema, persona: simulationWorldPersonaSchema })).min(2),
  entities: z.array(entity), relations: z.array(relation), channels: z.array(channel),
  initialEvents: z.array(z.strictObject({ at: z.string().regex(/^(0|[1-9][0-9]*)$/), description: text,
    request: simulationHireIntentRequestSchema })),
})

/** Canonical hashes cover complete original metadata, including fields not yet materialized in Native. */
function fingerprint(value: object): string {
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, child]) => [key, sorted(child)])) : value
  return `sha256:${createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex')}`
}
function distinct(values: readonly string[]): boolean { return new Set(values).size === values.length }
function reference(value: { readonly id: string; readonly version: string }): string { return JSON.stringify([value.id, value.version]) }
function matchesSubset(expected: object, actual: object): boolean {
  const retained = new Map<string, unknown>(Object.entries(actual))
  return Object.entries(expected).every(([key, value]) => isDeepStrictEqual(value, retained.get(key)))
}

/** Portable references must describe one authorized, capacity-bounded initial topology before materialization. */
function validDefinition(definition: ResolvedWorldScenario['definition'], resolved: ResolvedWorldScenario): boolean {
  const actors = new Map(definition.actors.map(actor => [actor.id, actor]))
  const positions = new Map(definition.positions.map(position => [position.id, position]))
  const grantKey = (requesterId: string, positionId: string): string => JSON.stringify([requesterId, positionId])
  const grants = new Set(definition.authorizations.map(grant => grantKey(grant.requesterId, grant.positionId)))
  const entityIds = [definition.organization.id,
    ...definition.positions.map(position => position.id), ...definition.actors.map(actor => actor.id)]
  if (!distinct(entityIds)
    || !distinct([...definition.assignments.map(assignment => assignment.id), ...definition.authorizations.map(grant => grant.id)])
    || !distinct(definition.assignments.map(assignment => assignment.personId))
    || !distinct(definition.templates.map(template => template.id))
    || definition.actors.filter(actor => actor.role === 'director').length !== 1
    || grants.size !== definition.authorizations.length
    || !distinct(definition.initialEvents.map(event => event.applicationId))
    || definition.assignments.some(assignment => !actors.has(assignment.personId) || !positions.has(assignment.positionId))
    || definition.authorizations.some(grant => actors.get(grant.requesterId)?.role !== 'member' || !positions.has(grant.positionId))
    || definition.initialEvents.some(event => !actors.has(event.requesterId) || !positions.has(event.positionId)
      || !grants.has(grantKey(event.requesterId, event.positionId)) || BigInt(event.at) > BigInt(resolved.native.maxTime))
    || definition.positions.some(position =>
      definition.assignments.filter(assignment => assignment.positionId === position.id).length > position.capacity)) {
    return false
  }
  for (const group of ['native', 'team', 'world'] as const) {
    if (!matchesSubset(definition.limits?.[group] ?? {}, resolved.limits[group])) return false
  }
  const needs: readonly [number, number][] = [
    [1 + definition.positions.length + definition.actors.length, resolved.limits.native.maxEntities],
    [definition.actors.length, resolved.limits.team.maxParticipants],
    [definition.actors.length, resolved.limits.team.maxActivations],
    [definition.actors.length - 1, resolved.limits.team.maxChannels],
    [definition.initialEvents.length, resolved.limits.native.maxPendingEvents],
    [definition.initialEvents.length, resolved.limits.world.maxRequests],
    [2, resolved.limits.native.maxOperationsPerDecision],
  ]
  return needs.every(([needed, limit]) => needed <= limit)
}

/** Retained installed versions and finite Persona choices authorize no new model route or actor role. */
function validActors(resolved: ResolvedWorldScenario): boolean {
  const { definition } = resolved
  const templates = new Map(resolved.world.templates.map(template => [reference(template), template]))
  if (reference(resolved.generatedActorRuntime) !== reference(definition.runtimeProfile)
    || !resolved.generatedActorRuntime.roles.includes('member')
    || !isDeepStrictEqual(resolved.world.templates.map(template => ({ id: template.id, version: template.version })), definition.templates)
    || resolved.actors.length !== definition.actors.length) return false
  const versions = new Map<string, ResolvedWorldScenario['generatedActorRuntime']>()
  for (const runtime of [resolved.generatedActorRuntime, ...resolved.actors.map(actor => actor.runtime)]) {
    if (!runtime.available || !runtime.model.available) return false
    const prior = versions.get(reference(runtime))
    if (prior !== undefined && !isDeepStrictEqual(prior, runtime)) return false
    versions.set(reference(runtime), runtime)
  }
  return resolved.actors.every((actor, index) => {
    const original = definition.actors[index]
    if (original === undefined || actor.entityId !== original.id || actor.role !== original.role
      || reference(actor.runtime) !== reference(original.runtimeProfile ?? definition.runtimeProfile)
      || !actor.runtime.roles.includes(actor.role) || reference(actor.template) !== reference(original.template)
      || !isDeepStrictEqual(actor.template, templates.get(reference(original.template)))
      || !actor.template.names.includes(actor.persona.name)) return false
    for (const key of ['skills', 'traits', 'goals'] as const) {
      if (actor.persona[key].some(choice => !actor.template[key].includes(choice))) return false
    }
    return matchesSubset(original.persona ?? {}, actor.persona)
  })
}

/** Compare exact compiler-derived commands with the original portable identities and retained installed snapshots. */
function validProjection(resolved: ResolvedWorldScenario): boolean {
  const { definition } = resolved, director = resolved.actors.find(actor => actor.role === 'director')
  if (director === undefined) return false
  const entities = [
    { kind: 'entity/create', id: definition.organization.id, entityKind: 'organization', cognition: 'none', readiness: 'ready',
      profile: { name: definition.organization.name, description: definition.organization.description } },
    ...definition.positions.map(position => ({ kind: 'entity/create', id: position.id, entityKind: 'position', cognition: 'none',
      readiness: 'ready', profile: { name: position.name, description: position.name } })),
    ...resolved.actors.map(actor => ({ kind: 'entity/create', id: actor.entityId, entityKind: 'person', cognition: 'agent',
      readiness: 'preparing', profile: { name: actor.persona.name, description: actor.template.description, persona: actor.persona } })),
  ]
  const relations = [
    ...definition.assignments.map(assignment => ({ kind: 'relation/create', id: assignment.id, subject: assignment.personId,
      relation: 'assignment', object: assignment.positionId, scope: definition.organization.id, validFrom: '0', validUntil: null })),
    ...definition.authorizations.map(grant => ({ kind: 'relation/create', id: grant.id, subject: grant.requesterId,
      relation: 'can-hire', object: grant.positionId, scope: definition.organization.id, validFrom: '0', validUntil: null })),
  ]
  const channels = resolved.actors.filter(actor => actor.role === 'member').map(actor => ({ key: `world-director:${actor.entityId}`,
    members: [{ entityId: actor.entityId, role: 'member' }, { entityId: director.entityId, role: 'director' }] }))
  const initialEvents = definition.initialEvents.map(event => ({ at: event.at, description: event.description, request: {
    organizationEntityId: definition.organization.id, positionEntityId: event.positionId,
    requesterEntityId: event.requesterId, applicationId: event.applicationId,
  } }))
  const world = { positionRolePermissions: [], operations: [WORLD_GENERATE_AND_HIRE_PIN],
    operationGrants: definition.authorizations.map(grant => ({ requesterEntityId: grant.requesterId,
      domain: WORLD_GENERATE_AND_HIRE_PIN.domain, operation: WORLD_GENERATE_AND_HIRE_PIN.operation,
      version: WORLD_GENERATE_AND_HIRE_PIN.version, scopeEntityId: definition.organization.id,
      targetEntityId: grant.positionId, relationId: grant.id, relation: 'can-hire' })),
    directorEntityId: director.entityId, organizationEntityId: definition.organization.id,
    positions: definition.positions.map(position => ({ entityId: position.id, capacity: position.capacity })),
    authorizations: definition.authorizations.map(grant => ({ requesterEntityId: grant.requesterId,
      positionEntityId: grant.positionId, relationId: grant.id })), templates: resolved.world.templates,
    policyVersion: resolved.policyVersion, limits: resolved.limits.world }
  return isDeepStrictEqual(resolved.entities, entities) && isDeepStrictEqual(resolved.relations, relations)
    && isDeepStrictEqual(resolved.channels, channels) && isDeepStrictEqual(resolved.initialEvents, initialEvents)
    && isDeepStrictEqual(resolved.world, world) && matchesSubset(resolved.limits.native, resolved.native)
    && resolved.native.policyVersion === resolved.policyVersion
    && isDeepStrictEqual(resolved.native.relationRules, ['assignment', 'can-hire'].map(relation => ({ relation,
      subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: true })))
}

/** Parse every retained compiler field and reject inconsistent references, choices, derived commands or policy snapshots. */
const legacyResolvedWorldScenarioSchema = resolvedFields.superRefine((value, context) => {
  if (value.definitionHash !== fingerprint(value.definition)) {
    context.addIssue({ code: 'custom', path: ['definitionHash'], message: 'Resolved World definition hash differs from its original definition' })
  }
  if (!validDefinition(value.definition, value)) {
    context.addIssue({ code: 'custom', path: ['definition'], message: 'Resolved World references, authority or initial capacity are inconsistent' })
  }
  if (!validActors(value)) {
    context.addIssue({ code: 'custom', path: ['actors'], message: 'Resolved World actor versions, roles or Persona choices are inconsistent' })
  }
  if (!validProjection(value)) {
    context.addIssue({ code: 'custom', message: 'Resolved World Native, authority or materialization fields differ from the original definition' })
  }
}) satisfies z.ZodType<ResolvedWorldScenario>

/** Complete retained v1 creation also checks its original portable definition commitment. */
const currentResolvedWorldScenarioSchema = resolvedWorldScenarioV1Schema.superRefine((value, context) => {
  if (value.definitionHash !== fingerprint(value.definition)) context.addIssue({ code: 'custom', path: ['definitionHash'],
    message: 'Resolved v1 definition hash differs from its original portable definition' })
})
/** Parse an explicitly versioned complete compilation; Native stream versions retain their independent rejection contract. */
export const simulationResolvedWorldScenarioSchema = z.discriminatedUnion('apiVersion', [legacyResolvedWorldScenarioSchema,
  currentResolvedWorldScenarioSchema]) satisfies z.ZodType<ResolvedWorldScenario | ResolvedWorldScenarioV1>

/** All original preparation settings are explicit; the initial checkpoint cannot be silently substituted on replay. */
export const simulationWorldPreparationSchema = z.strictObject({ resolved: simulationResolvedWorldScenarioSchema,
  ownerName: z.string().trim().min(1), checkpoint: z.strictObject({ id: simulationCheckpointIdSchema,
    maxDrainRounds: z.number().int().positive(), maxAttempts: z.number().int().positive() }),
}) satisfies z.ZodType<SimulationWorldPreparation>

/** Complete original command and authenticated private registration; parsing performs no live metadata lookup or IO. */
export const simulationWorldCreationSchema = z.strictObject({ record: simulationProductRecordSchema,
  request: simulationProductWorldCreateInputSchema, preparation: simulationWorldPreparationSchema,
}).refine(value => value.record.id === String(value.record.spec.runId) && value.record.name === value.request.name
  && value.preparation.ownerName === `simulation-product/${value.record.id}`
  && value.preparation.checkpoint.id === `product-initial/${value.request.commandId}`
  && isDeepStrictEqual(value.preparation.resolved.definition, value.request.definition)
  && isDeepStrictEqual(value.record.spec, { ...value.preparation.resolved.native, runId: value.record.spec.runId })
  && value.request.preflight.catalogGeneration === value.preparation.resolved.catalogGeneration
  && value.request.preflight.hash === fingerprint(value.preparation.resolved),
'World creation differs from its original identity, preview or resolved payload') satisfies z.ZodType<SimulationWorldCreation>
