/** Pure compiler inputs and immutable outputs; no Host service declarations are imported. */
import type { z } from 'zod'
import type { SimulationWorldDefinition, SimulationWorldPersona, SimulationWorldTemplate } from '@clocky/clocky-simulation/world-types'
import type { scenarioCatalogSchema, scenarioLimitsSchema, scenarioRuntimeProfileSchema, scenarioNativeSettingsSchema, worldScenarioSchema } from './schema.ts'

/** Recursive readonly JSON value retained after successful compilation. */
export type ScenarioReadonly<T> = T extends string | number | boolean | null | undefined ? T
  : T extends readonly (infer Item)[] ? readonly ScenarioReadonly<Item>[]
    : T extends object ? { readonly [Key in keyof T]: ScenarioReadonly<T[Key]> } : T
/** Parsed portable JSON input. */
export type WorldScenario = z.infer<typeof worldScenarioSchema>
/** Explicit file syntax; both formats compile through the same strict JSON definition. */
export type ScenarioSourceFormat = 'json' | 'yaml'
/** Trusted installed metadata snapshot supplied by the deployment owner. */
export type ScenarioCatalog = z.infer<typeof scenarioCatalogSchema>
/** Fully resolved numeric admission bounds. */
export type ScenarioLimits = z.infer<typeof scenarioLimitsSchema>
/** Fully resolved installed runtime and versioned model metadata. */
export type ScenarioRuntimeProfile = z.infer<typeof scenarioRuntimeProfileSchema>
/** Frozen Native creation fields; the owner supplies only its new run identity and storage route. */
export type ScenarioNativeDefinition = z.infer<typeof scenarioNativeSettingsSchema> & ScenarioLimits['native'] & {
  readonly policyVersion: string
  readonly relationRules: readonly {
    readonly relation: string
    readonly subjectKinds: readonly string[]
    readonly objectKinds: readonly string[]
    readonly scopeKinds: readonly string[]
    readonly acyclic: boolean
  }[]
}
/** Field-level validation diagnosis without input values or deployment secrets. */
export interface ScenarioDiagnostic {
  readonly source: 'scenario' | 'catalog' | 'preflight'
  readonly path: readonly (string | number)[]
  readonly code: 'invalid-json' | 'invalid-shape' | 'duplicate-id' | 'unknown-reference' | 'capacity'
    | 'unauthorized-role' | 'model-unavailable' | 'template-choice' | 'stale-preflight'
  readonly message: string
  /** File parser diagnostics retain syntax and one-based locations without input contents. */
  readonly format?: ScenarioSourceFormat | undefined
  readonly line?: number | undefined
  readonly column?: number | undefined
}
/** Parser outcome; no defaults or live references are resolved by parsing alone. */
export type ScenarioParseResult = { readonly ok: true; readonly definition: WorldScenario }
  | { readonly ok: false; readonly diagnostics: readonly ScenarioDiagnostic[] }
/** Initial entity command input; the creation owner validates it against Native before mutation. */
export interface ScenarioEntityCommand {
  readonly kind: 'entity/create'
  readonly id: string
  readonly entityKind: string
  readonly cognition: 'none' | 'agent'
  readonly readiness: 'ready' | 'preparing'
  readonly profile: { readonly name: string; readonly description: string; readonly persona?: ScenarioReadonly<SimulationWorldPersona> }
}
/** Initial scoped relation input; its identities come from the portable definition. */
export interface ScenarioRelationCommand {
  readonly kind: 'relation/create'
  readonly id: string
  readonly subject: string
  readonly relation: string
  readonly object: string
  readonly scope: string
  readonly validFrom: '0'
  readonly validUntil: null
}
/** Fully resolved compiler output with symbolic scenario identities and no run/Participant/Session/Channel allocation. */
export interface ResolvedWorldScenario {
  readonly apiVersion: 'clocky.world/v0'
  readonly compilerVersion: '1'
  readonly catalogGeneration: string
  readonly policyVersion: string
  readonly definitionHash: string
  readonly definition: ScenarioReadonly<WorldScenario>
  readonly limits: ScenarioReadonly<ScenarioLimits>
  readonly native: ScenarioReadonly<ScenarioNativeDefinition>
  readonly world: ScenarioReadonly<SimulationWorldDefinition>
  readonly generatedActorRuntime: ScenarioReadonly<ScenarioRuntimeProfile>
  readonly actors: readonly {
    readonly entityId: string
    readonly role: 'director' | 'member'
    readonly runtime: ScenarioReadonly<ScenarioRuntimeProfile>
    readonly template: ScenarioReadonly<SimulationWorldTemplate>
    readonly persona: ScenarioReadonly<SimulationWorldPersona>
  }[]
  readonly entities: readonly ScenarioEntityCommand[]
  readonly relations: readonly ScenarioRelationCommand[]
  readonly channels: readonly { readonly key: string; readonly members: readonly { readonly entityId: string; readonly role: string }[] }[]
  readonly initialEvents: readonly {
    readonly at: string
    readonly description: string
    readonly request: {
      readonly organizationEntityId: string
      readonly positionEntityId: string
      readonly requesterEntityId: string
      readonly applicationId: string
    }
  }[]
}
/** Successful preflight binds the exact resolved definition and installed catalog generation. */
export interface ScenarioPreview {
  readonly hash: string
  readonly catalogGeneration: string
  readonly organizationName: string
  readonly actorCount: number
  readonly positionCount: number
  readonly initialRequestCount: number
  readonly directorEntityId: string
}
/** Compilation either returns complete immutable output or only field diagnostics. */
export type ScenarioCompilation = { readonly ok: true; readonly resolved: ResolvedWorldScenario; readonly preview: ScenarioPreview }
  | { readonly ok: false; readonly diagnostics: readonly ScenarioDiagnostic[] }
