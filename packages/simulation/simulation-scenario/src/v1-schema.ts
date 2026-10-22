import { environmentStateSchema, personEvolutionStateSchema, personExperienceSchema } from '@clocky/clocky-simulation/world-authoring'
/** Explicit complete v1 portable authoring schema. */
import { z } from 'zod'
import { simulationWorldPersonaSchema } from '@clocky/clocky-simulation/world'
import { simulationWorldDomainSelectorSchema, simulationWorldDomainPinSchema } from '@clocky/clocky-simulation/world-domain'
import { simulationResourceSpecSchema } from '@clocky/clocky-simulation/world-authoring'
import { simulationWorldFactAudienceSchema } from '@clocky/clocky-simulation/world-authoring'
import { simulationNormEnforcementSchema } from '@clocky/clocky-simulation/world-authoring'
import { simulationGovernanceRuleSchema } from '@clocky/clocky-simulation/world-authoring'
import { simulationExternalMediatedPolicyParametersSchema } from '@clocky/clocky-simulation/world-authoring'
import { simulationCalendarRecurrenceSchema, simulationCivilCalendarSchema } from '@clocky/clocky-simulation/world-authoring'
import { simulationHiringFeePolicySchema } from '@clocky/clocky-simulation/world-authoring'
import { scenarioCatalogSchema, scenarioLimitsSchema } from './schema.ts'

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{0,127}$/)
const text = z.string().min(1)
const time = z.string().regex(/^(0|[1-9][0-9]*)$/)
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const reference = z.strictObject({ id: key, version: text })
const interval = { validFrom: time, validUntil: time.nullable() }
const nonemptyInterval = (value: { validFrom: string; validUntil: string | null }) =>
  value.validUntil === null || BigInt(value.validUntil) > BigInt(value.validFrom)
const entity = { id: key, name: text, description: text }
const person = z.strictObject({ ...entity, kind: z.literal('person'), cognition: z.literal('agent'),
  role: z.enum(['director', 'member']), runtimeProfile: reference, template: reference, persona: simulationWorldPersonaSchema })
const organizationEntity = z.strictObject({ ...entity, kind: z.literal('organization'), cognition: z.literal('none') })
const environment = z.strictObject({ ...entity, kind: z.literal('environment'), cognition: z.literal('none'),
  environment: environmentStateSchema.safeExtend({ lastTime: z.null() }) })
const personState = z.strictObject({ ...entity, kind: z.literal('person-state'), cognition: z.literal('none'),
  evolution: personEvolutionStateSchema.extend({ versions: z.array(personExperienceSchema).max(0) }) })
const plainObject = z.strictObject({ ...entity, kind: z.literal('object'), cognition: z.literal('none') })
const inactivePerson = z.strictObject({ ...entity, kind: z.literal('person'), cognition: z.literal('none') })
const permission = z.strictObject({ ...simulationWorldDomainSelectorSchema.shape, scopeId: key, targetId: key, relation: key })
const assignment = z.strictObject({ id: key, personId: key, positionId: key, ...interval }).refine(nonemptyInterval)
const membership = z.strictObject({ id: key, personId: key, ...interval }).refine(nonemptyInterval)
const fact = z.strictObject({ id: key, subjectId: key, scopeId: key, body: text, effectiveFrom: time,
  effectiveUntil: time.nullable(), availableAt: time, audience: simulationWorldFactAudienceSchema })
  .refine(value => value.effectiveUntil === null || BigInt(value.effectiveUntil) > BigInt(value.effectiveFrom))
const norm = z.strictObject({ id: key, scopeId: key, body: text, effectiveFrom: time, effectiveUntil: time.nullable(),
  availableAt: time, audience: simulationWorldFactAudienceSchema, enforcement: simulationNormEnforcementSchema })
  .refine(value => value.effectiveUntil === null || BigInt(value.effectiveUntil) > BigInt(value.effectiveFrom))
const target = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('person'), personId: key }),
  z.strictObject({ kind: z.literal('position'), positionId: key }),
])
const goal = z.strictObject({ id: key, kind: z.literal('goal'), at: time, target, body: text })
const calendar = z.strictObject({ id: key, target, body: text, startsAt: time, endsAt: time.nullable(),
  period: time.refine(value => BigInt(value) > 0n), maxOccurrences: positive, recurrence: simulationCalendarRecurrenceSchema.optional(),
  civil: simulationCivilCalendarSchema.optional(),
  priority: z.number().int().min(-1000).max(1000).optional() })
  .refine(value => value.endsAt === null || BigInt(value.endsAt) >= BigInt(value.startsAt))

/** Portable input has no host paths, credentials, resolved identity IDs, transport implementations or implicit code. */
export const worldScenarioV1Schema = z.strictObject({
  apiVersion: z.literal('clocky.world/v1'),
  metadata: z.strictObject({ id: key, name: text, description: text }),
  runtimeProfiles: z.strictObject({ allowed: z.array(reference).min(1), generated: reference, templates: z.array(reference).min(1) }),
  domains: z.array(simulationWorldDomainSelectorSchema).min(1),
  entities: z.array(z.union([person, organizationEntity, inactivePerson, plainObject, environment, personState])).min(3),
  organization: z.strictObject({ rootId: key,
    hiringFees: z.array(simulationHiringFeePolicySchema).optional(),
    units: z.array(z.strictObject({ id: key, parentId: key })),
    positions: z.array(z.strictObject({ ...entity, unitId: key, capacity: positive, permissions: z.array(permission).max(64) })).min(1),
    assignments: z.array(assignment),
    grants: z.array(z.strictObject({ id: key, personId: key, ...permission.shape, ...interval }).refine(nonemptyInterval)),
  }),
  governance: z.strictObject({ committees: z.array(z.strictObject({ ...entity, scopeId: key,
    members: z.array(membership).min(1), rule: simulationGovernanceRuleSchema, quorum: positive })), norms: z.array(norm) }),
  facts: z.array(fact),
  knowledge: z.array(z.strictObject({ id: key, ownerId: key, body: text, observedAt: time, availableAt: time,
    ...interval, readers: z.array(key) }).refine(nonemptyInterval)),
  resources: z.array(simulationResourceSpecSchema),
  communication: z.strictObject({ channels: z.array(z.strictObject({ key, members: z.array(z.strictObject({ personId: key,
    role: z.enum(['director', 'member']) })).min(2) })) }),
  externalWorld: z.strictObject({ mode: z.literal('simulated-only'),
    identities: z.array(z.strictObject({ scopeId: key, externalKey: key, subjectId: key,
      representation: z.enum(['simulated-rule', 'simulated-actor', 'director-mediated']) })),
    adjudicationPolicy: simulationExternalMediatedPolicyParametersSchema.optional() }),
  behavior: z.strictObject({ initialGoals: z.array(goal), calendars: z.array(calendar),
    directorEvents: z.array(z.strictObject({ id: key, calendarId: key, maxRequests: positive, ...simulationWorldDomainSelectorSchema.shape,
      scopeId: key, targetId: key })) }),
  limits: z.strictObject({ native: scenarioLimitsSchema.shape.native.partial(), team: scenarioLimitsSchema.shape.team.partial(),
    world: scenarioLimitsSchema.shape.world.partial() }),
})

const isTrimmed = (value: string) => value.trim() === value && value.length > 0

/** Trusted deployment catalog supplies exact parser/reducer generations and closed initial document schemas. */
export const scenarioV1CatalogSchema = scenarioCatalogSchema.extend({
  modelProtocol: z.literal('bounded-v1').optional(),
  runtimeProfiles: scenarioCatalogSchema.shape.runtimeProfiles.element.extend({
    preset: scenarioCatalogSchema.shape.runtimeProfiles.element.shape.preset.refine(isTrimmed, 'Installed preset must be trimmed'),
    capabilities: scenarioCatalogSchema.shape.runtimeProfiles.element.shape.capabilities.refine(values => values.every(isTrimmed),
      'Installed capabilities must be trimmed'),
  }).array().min(1),
  domains: z.array(z.strictObject({ pin: simulationWorldDomainPinSchema, available: z.boolean(),
    directorEvents: z.boolean().optional() })).min(1),
  factSchemas: z.array(z.literal('clocky.world-fact/text/1')).min(1),
  normPolicies: z.array(z.literal('clocky.organization.hiring-approval/1')),
}).superRefine((catalog, context) => {
  const distinct = (values: readonly string[], path: string) => {
    const seen = new Set<string>()
    values.forEach((value, index) => {
      if (seen.has(value)) context.addIssue({ code: 'custom', path: [path, index],
        message: 'Installed version metadata must be unique in its owner namespace' })
      seen.add(value)
    })
  }
  distinct(catalog.runtimeProfiles.map(value => JSON.stringify([value.id, value.version])), 'runtimeProfiles')
  distinct(catalog.templates.map(value => JSON.stringify([value.template.id, value.template.version])), 'templates')
  distinct(catalog.domains.map(value => JSON.stringify([value.pin.domain, value.pin.operation, value.pin.version])), 'domains')
})
/** Complete portable v1 authoring definition. */
export type WorldScenarioV1 = z.infer<typeof worldScenarioV1Schema>
/** Trusted installed metadata and owner ceilings for v1 compilation. */
export type ScenarioV1Catalog = z.infer<typeof scenarioV1CatalogSchema>
/** Closed diagnostics shared by v1 authoring and public result parsers. */
export const scenarioV1DiagnosticCodeSchema = z.enum(['invalid-json', 'invalid-shape', 'invalid-catalog', 'duplicate-id',
  'unknown-reference', 'invalid-reference', 'capacity', 'unauthorized-role', 'model-unavailable', 'template-choice',
  'stale-preflight', 'domain-unavailable', 'organization-cycle', 'assignment-overlap', 'membership-overlap',
  'committee-threshold', 'policy-unavailable', 'time-horizon', 'unsupported-scope', 'unsupported-feature'])
/** One known v1 semantic failure, excluding source bodies and secrets. */
export type ScenarioV1Diagnostic = { readonly path: readonly (string | number)[]
  readonly code: z.infer<typeof scenarioV1DiagnosticCodeSchema>
  readonly message: string }
