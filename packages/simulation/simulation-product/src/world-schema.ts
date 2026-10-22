/** Browser-safe World request parsing; no Host service, provider selection or persisted resolution is imported. */
import { z } from 'zod'
import { scenarioTemplateManifestSchema, worldScenarioSchema, worldScenarioV1Schema, scenarioLimitsSchema, scenarioV1DiagnosticCodeSchema } from '@clocky/clocky-simulation-scenario'
import { simulationWorldFactAudienceSchema, simulationNormEnforcementSchema } from '@clocky/clocky-simulation/world-authoring'
import { simulationWorldDomainPinSchema } from '@clocky/clocky-simulation/world-domain'
import { SIMULATION_WORLD_HIRE_OPERATION } from '@clocky/clocky-simulation/world'
import { simulationProductCommandIdSchema } from './administration-schema.ts'
import { simulationProductRunIdSchema } from './schema-common.ts'
import type { SimulationProductWorldCreateInput, SimulationProductWorldPreflightInput,
  SimulationProductWorldPreflightResult, SimulationProductWorldExportResult } from './world-types.ts'

/** Parse an inert portable definition; unknown fields reject at every declared object. */
export const simulationProductWorldPreflightInputSchema = z.strictObject({ definition: z.discriminatedUnion('apiVersion', [worldScenarioSchema, worldScenarioV1Schema]), templateManifest: scenarioTemplateManifestSchema.optional() }) satisfies
  z.ZodType<SimulationProductWorldPreflightInput>

/** Parse the full original command without accepting Native configuration or self-reported authority. */
export const simulationProductWorldCreateInputSchema = z.strictObject({
  templateManifest: scenarioTemplateManifestSchema.optional(),
  commandId: simulationProductCommandIdSchema,
  name: z.string().trim().min(1),
  definition: z.discriminatedUnion('apiVersion', [worldScenarioSchema, worldScenarioV1Schema]),
  preflight: z.strictObject({ hash: z.string().regex(/^sha256:[a-f0-9]{64}$/), catalogGeneration: z.string().min(1) }),
}) satisfies z.ZodType<SimulationProductWorldCreateInput>

const identity = worldScenarioSchema.shape.organization.shape.id
const text = z.string().min(1)
const positive = z.number().int().positive()
const count = z.number().int().nonnegative()
const previewSchema = z.strictObject({ hash: z.string().regex(/^sha256:[a-f0-9]{64}$/), catalogGeneration: text,
  organizationName: text, actorCount: positive, positionCount: positive, initialRequestCount: count, directorEntityId: identity })
const actorSchema = z.strictObject({ entityId: identity, role: z.enum(['director', 'member']), name: text,
  template: z.strictObject({ id: identity, version: text }), model: z.strictObject({ provider: text, name: text, version: text }) })
const positionSchema = z.strictObject({ entityId: identity, name: text, capacity: positive, occupied: count })
  .refine(position => position.occupied <= position.capacity, 'Initial position occupancy exceeds capacity')
const diagnosticSchema = z.strictObject({ source: z.enum(['scenario', 'catalog', 'preflight']),
  path: z.array(z.union([z.string(), count])), code: scenarioV1DiagnosticCodeSchema, message: text,
  format: z.enum(['json', 'yaml']).optional(), line: positive.optional(), column: positive.optional(),
}).refine(value => (value.line === undefined) === (value.column === undefined), 'Source locations require both line and column')

/** Capability dimensions are bounded, closed and never encode unknown as zero. */
const capabilitiesSchema = z.strictObject({
  backup: z.enum(['complete', 'external-state-required', 'unknown']),
  clocks: z.strictObject({ native: z.strictObject({ unit: text, maxTime: z.string().regex(/^(0|[1-9][0-9]*)$/) }),
    domains: z.array(z.strictObject({ domain: text, name: text })).max(64) }),
  models: z.array(z.strictObject({ provider: text, name: text, contextWindow: positive.nullable(), maxOutputTokens: positive.nullable() }))
    .max(64),
  tokensPerRequest: positive, initialContext: z.literal('unknown'), longRunUsage: z.literal('unknown'),
  violations: z.array(z.strictObject({ dimension: z.literal('context-window'), model: text, actual: positive, required: positive })).max(64),
})

/** Public preview responses carry only initial identities, selected versions and explicit quotas; every nested object is closed. */
const legacyReadySchema = z.strictObject({ status: z.literal('ready'), capabilities: capabilitiesSchema.optional(),
  preview: previewSchema, policyVersion: text,
  organization: z.strictObject({ id: identity, name: text, description: text }), actors: z.array(actorSchema).min(2),
  positions: z.array(positionSchema).min(1),
  authorizations: z.array(z.strictObject({ requesterEntityId: identity, positionEntityId: identity })), limits: scenarioLimitsSchema,
  maxTime: z.string().regex(/^(0|[1-9][0-9]*)$/), budgetInterval: z.string().regex(/^[1-9][0-9]*$/), tickUnit: text,
  scope: z.strictObject({ source: z.literal('simulated-only'), operation: z.literal(SIMULATION_WORLD_HIRE_OPERATION), payroll: z.literal(false),
    committeeApproval: z.literal(false) }),
}).refine(value => value.preview.organizationName === value.organization.name
    && value.preview.actorCount === value.actors.length && value.preview.positionCount === value.positions.length
    && value.actors.filter(actor => actor.role === 'director').length === 1
    && value.actors.find(actor => actor.role === 'director')?.entityId === value.preview.directorEntityId
    && new Set([value.organization.id, ...value.positions.map(position => position.entityId),
      ...value.actors.map(actor => actor.entityId)]).size === 1 + value.positions.length + value.actors.length
    && value.authorizations.every(grant => value.actors.some(actor => actor.entityId === grant.requesterEntityId && actor.role === 'member')
      && value.positions.some(position => position.entityId === grant.positionEntityId)), 'World preview initial identities are inconsistent')

const v1ReadySchema = z.strictObject({ status: z.literal('ready'), apiVersion: z.literal('clocky.world/v1'),
  capabilities: capabilitiesSchema.optional(),
  preview: previewSchema.extend({ creationMode: z.literal('paused'), source: z.literal('simulated-only'), entityCount: positive }),
  policyVersion: text, organization: z.strictObject({ id: identity, name: text, description: text }), actors: z.array(actorSchema).min(1),
  positions: z.array(positionSchema), authorizations: z.array(z.strictObject({ requesterEntityId: identity, positionEntityId: identity })),
  limits: scenarioLimitsSchema, maxTime: z.string().regex(/^(0|[1-9][0-9]*)$/),
  budgetInterval: z.string().regex(/^[1-9][0-9]*$/), tickUnit: text,
  scope: z.strictObject({ source: z.literal('simulated-only'), payroll: z.literal(false), committeeApproval: z.boolean(),
    domains: z.array(simulationWorldDomainPinSchema).min(1) }),
  units: z.array(z.strictObject({ id: identity, name: text, parentId: identity })),
  committees: worldScenarioV1Schema.shape.governance.shape.committees,
  institutions: z.array(z.strictObject({ id: identity, scopeId: identity, effectiveFrom: z.string().regex(/^(0|[1-9][0-9]*)$/),
    effectiveUntil: z.string().regex(/^(0|[1-9][0-9]*)$/).nullable(), availableAt: z.string().regex(/^(0|[1-9][0-9]*)$/),
    audience: simulationWorldFactAudienceSchema, enforcement: simulationNormEnforcementSchema })),
  permissions: worldScenarioV1Schema.shape.organization.shape.grants,
  assignments: worldScenarioV1Schema.shape.organization.shape.assignments,
  positionPermissions: z.array(z.strictObject({ positionEntityId: identity,
    permissions: worldScenarioV1Schema.shape.organization.shape.positions.element.shape.permissions })),
  sources: z.strictObject({ facts: count, privateBeliefs: count, resources: count, externalIdentities: count,
    initialGoals: count, calendars: count, directorEvents: count }),
}).refine(value => value.preview.organizationName === value.organization.name && value.preview.actorCount === value.actors.length
  && value.preview.positionCount === value.positions.length && value.preview.initialRequestCount === 0
  && value.actors.filter(actor => actor.role === 'director').length === 1
  && value.actors.find(actor => actor.role === 'director')?.entityId === value.preview.directorEntityId
  && new Set([value.organization.id, ...value.units.map(unit => unit.id), ...value.committees.map(committee => committee.id),
    ...value.positions.map(position => position.entityId), ...value.actors.map(actor => actor.entityId)]).size
    === 1 + value.units.length + value.committees.length + value.positions.length + value.actors.length
  && value.preview.entityCount >= 1 + value.units.length + value.committees.length + value.positions.length + value.actors.length,
'World v1 preview identities differ from its original topology')

/** Both explicit scene versions produce strict bounded results; unknown fields and diagnostic kinds reject. */
export const simulationProductWorldPreflightResultSchema = z.discriminatedUnion('status', [
  z.discriminatedUnion('apiVersion', [legacyReadySchema.safeExtend({ apiVersion: z.undefined().optional() }), v1ReadySchema]),
  z.strictObject({ status: z.literal('invalid'), diagnostics: z.array(diagnosticSchema).min(1) }),
]) satisfies z.ZodType<SimulationProductWorldPreflightResult>

/** Bind an exported portable definition to the selected registration without adding original execution configuration. */
export const simulationProductWorldExportResultSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  definition: z.discriminatedUnion('apiVersion', [worldScenarioSchema, worldScenarioV1Schema]) }) satisfies z.ZodType<SimulationProductWorldExportResult>
