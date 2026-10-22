import { environmentStateSchema, personEvolutionStateSchema } from '@clocky/clocky-simulation/world-authoring'
/** Strict complete retained v1 resolutions reconstruct their projection from original metadata without live lookups. */
import { z } from 'zod'
import { simulationWorldDefinitionSchema, simulationWorldPersonaSchema, simulationWorldTemplateSchema } from '@clocky/clocky-simulation/world'
import { simulationWorldInitialDataSchema, simulationRelationRuleSchema } from '@clocky/clocky-simulation/world-authoring'
import { scenarioLimitsSchema, scenarioNativeSettingsSchema, scenarioNativeLimitsSchema,
  scenarioRuntimeProfileSchema, scenarioTeamLimitsSchema } from './schema.ts'
import { worldScenarioV1Schema, scenarioV1CatalogSchema } from './v1-schema.ts'
import { validateV1Relationships } from './v1-validation.ts'
import { projectWorldScenarioV1, boundedWorldScenarioV1Catalog } from './v1-compiler.ts'
import type { ResolvedWorldScenarioV1 } from './v1-types.ts'

const text = z.string().min(1)
const time = z.string().regex(/^(0|[1-9][0-9]*)$/)
const role = z.enum(['director', 'member'])
const entity = z.union([
  z.strictObject({ kind: z.literal('entity/create'), id: text, entityKind: z.literal('environment'), cognition: z.literal('none'), readiness: z.literal('ready'), profile: z.strictObject({ name: text, description: text, environment: environmentStateSchema }) }),
  z.strictObject({ kind: z.literal('entity/create'), id: text, entityKind: z.literal('person-state'), cognition: z.literal('none'), readiness: z.literal('ready'), profile: z.strictObject({ name: text, description: text, evolution: personEvolutionStateSchema }) }),
  z.strictObject({ kind: z.literal('entity/create'), id: text, entityKind: z.enum(['organization', 'position', 'person', 'object']),
    cognition: z.literal('none'), readiness: z.literal('ready'), profile: z.strictObject({ name: text, description: text }) }),
  z.strictObject({ kind: z.literal('entity/create'), id: text, entityKind: z.literal('person'), cognition: z.literal('agent'),
    readiness: z.literal('preparing'), profile: z.strictObject({ name: text, description: text, persona: simulationWorldPersonaSchema }) }),
])
const native = scenarioNativeSettingsSchema.extend({ ...scenarioNativeLimitsSchema.shape, policyVersion: text,
  relationRules: z.array(simulationRelationRuleSchema.and(z.object({ scopeKinds: z.array(text).min(1) }))).refine(values =>
    new Set(values.map(value => value.relation)).size === values.length, 'Retained relation rules must be distinct') })
const fields = z.strictObject({ apiVersion: z.literal('clocky.world/v1'), compilerVersion: z.literal('9'),
  catalogGeneration: text, policyVersion: text, definitionHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  definition: worldScenarioV1Schema, catalog: scenarioV1CatalogSchema,
  teamCeilings: scenarioTeamLimitsSchema.nullable(),
  limits: scenarioLimitsSchema, native, world: simulationWorldDefinitionSchema,
  generatedActorRuntime: scenarioRuntimeProfileSchema, runtimeProfiles: z.array(scenarioRuntimeProfileSchema).min(1),
  actors: z.array(z.strictObject({ entityId: text, role, persona: simulationWorldPersonaSchema,
    template: simulationWorldTemplateSchema, runtime: scenarioRuntimeProfileSchema })).min(1),
  entities: z.array(entity),
  relations: z.array(z.strictObject({ kind: z.literal('relation/create'), id: text, subject: text, relation: text,
    object: text, scope: text, validFrom: time, validUntil: time.nullable() })),
  channels: z.array(z.strictObject({ key: text, members: z.array(z.strictObject({ entityId: text, role })).min(2) })),
  bootstrap: simulationWorldInitialDataSchema,
})

function canonical(value: unknown): string {
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, value]) => [key, sort(value)])) : value
  return JSON.stringify(sort(value))
}
/**
 * Parse every original v1 compiler field and verify symbolic relationships and the complete deterministic projection.
 * Definition/preview hash commitments are checked by the durable creation owner; this browser-safe parser performs no hash IO.
 */
export const resolvedWorldScenarioV1Schema = fields.superRefine((value, context) => {
  const diagnostics = validateV1Relationships(value.definition, boundedWorldScenarioV1Catalog(value.catalog, value.teamCeilings))
  if (diagnostics.length) {
    for (const diagnostic of diagnostics) context.addIssue({ code: 'custom', path: ['definition', ...diagnostic.path], message: diagnostic.message })
    return
  }
  const projected = projectWorldScenarioV1(value.definition, value.catalog, value.teamCeilings)
  const { definitionHash: _hash, ...retained } = value
  if (canonical(projected) !== canonical(retained)) context.addIssue({ code: 'custom',
    message: 'Retained v1 commands, limits, roles or bootstrap differ from the original complete definition and selections' })
}) satisfies z.ZodType<ResolvedWorldScenarioV1>
