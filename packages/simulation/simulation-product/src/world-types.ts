/** Browser-safe World creation requests; execution configuration and principal identity remain Host-owned. */
import type { ScenarioTemplateManifest, WorldScenario, WorldScenarioV1, ScenarioPreview, ScenarioLimits, ScenarioDiagnostic, ScenarioV1Diagnostic } from '@clocky/clocky-simulation-scenario'
import type { SimulationProductCommandId } from './administration-types.ts'
import type { SimulationProductRunId } from './types.ts'

/** Inert new-world preview; no original command or execution identity is allocated. */
export interface SimulationProductWorldPreflightInput {
  /** Portable definition containing only symbolic identities and installed version references. */
  readonly definition: WorldScenario | WorldScenarioV1
  /** Optional original package metadata; installed dependency pins are rechecked before acceptance. */
  readonly templateManifest?: ScenarioTemplateManifest | undefined
}

/** Original creation command retained in full before any Native or Team identity IO. */
export interface SimulationProductWorldCreateInput extends SimulationProductWorldPreflightInput {
  /** Caller-retained retry identity; reuse with another payload rejects. */
  readonly commandId: SimulationProductCommandId
  /** Product display name, independent of organization and person identities. */
  readonly name: string
  /** Exact successful preview, rechecked against installed metadata before accepting the original command. */
  readonly preflight: {
    readonly hash: string
    readonly catalogGeneration: string
  }
}

/**
 * Preflight capability dimensions read from installed metadata without running provider code. `unknown` means the
 * Host cannot prove the dimension, never zero or complete.
 */
export interface SimulationProductWorldCapabilities {
  /** Checkpoint coverage declared by every installed operation: complete only when all are Native-backed. */
  readonly backup: 'complete' | 'external-state-required' | 'unknown'
  /** Native clock bound and the named domain clocks stop targets may select. */
  readonly clocks: {
    readonly native: { readonly unit: string; readonly maxTime: string }
    readonly domains: readonly { readonly domain: string; readonly name: string }[]
  }
  /** Each selected model route with its disclosed context window and default output cap. */
  readonly models: readonly {
    readonly provider: string
    readonly name: string
    readonly contextWindow: number | null
    readonly maxOutputTokens: number | null
  }[]
  /** Per-request token allowance the run will reserve. */
  readonly tokensPerRequest: number
  /** Initial context size is not measured before the first request. */
  readonly initialContext: 'unknown'
  /** Long-run consumption is not estimated. */
  readonly longRunUsage: 'unknown'
  /** Provably impossible combinations, each with the dimension, actual value and required value. */
  readonly violations: readonly {
    readonly dimension: 'context-window'
    readonly model: string
    readonly actual: number
    readonly required: number
  }[]
}

/** Public initial-scene summary; the preview commitment covers private creation metadata that is not returned. */
type LegacyWorldReady = {
  readonly status: 'ready'
  /** Capability dimensions; absent from peers that predate them. */
  readonly capabilities?: SimulationProductWorldCapabilities | undefined
  readonly preview: ScenarioPreview
  readonly policyVersion: string
  readonly organization: { readonly id: string; readonly name: string; readonly description: string }
  readonly actors: readonly {
    readonly entityId: string
    readonly role: 'director' | 'member'
    readonly name: string
    readonly template: { readonly id: string; readonly version: string }
    readonly model: { readonly provider: string; readonly name: string; readonly version: string }
  }[]
  readonly positions: readonly { readonly entityId: string; readonly name: string; readonly capacity: number; readonly occupied: number }[]
  readonly authorizations: readonly { readonly requesterEntityId: string; readonly positionEntityId: string }[]
  readonly limits: ScenarioLimits
  /** Canonical exact tick horizon from the accepted deployment clock. */
  readonly maxTime: string
  readonly budgetInterval: string
  readonly tickUnit: string
  /** Simulation-only source, exact supported operation and explicitly absent approval/payment mechanisms. */
  readonly scope: {
    readonly source: 'simulated-only'
    readonly operation: 'organization.generate-and-hire/v1'
    readonly payroll: false
    readonly committeeApproval: false
  }
}

/** Complete public v1 preview includes actual installed operations, institutions and authored initialization counts. */
export type SimulationProductWorldV1Ready = Omit<LegacyWorldReady, 'preview' | 'scope'> & {
  readonly apiVersion: 'clocky.world/v1'
  readonly preview: ScenarioPreview & { readonly creationMode: 'paused'
    readonly source: 'simulated-only'
    readonly entityCount: number }
  readonly scope: { readonly source: 'simulated-only'
    readonly payroll: false
    readonly committeeApproval: boolean
    readonly domains: readonly { readonly domain: string
      readonly operation: string
      readonly version: string
      readonly schemaRef: string
      readonly implementationRef: string
      readonly generation: number }[] }
  readonly units: readonly { readonly id: string
    readonly name: string
    readonly parentId: string }[]
  readonly committees: WorldScenarioV1['governance']['committees']
  readonly institutions: readonly Omit<WorldScenarioV1['governance']['norms'][number], 'body'>[]
  readonly permissions: WorldScenarioV1['organization']['grants']
  readonly assignments: WorldScenarioV1['organization']['assignments']
  readonly positionPermissions: readonly { readonly positionEntityId: string
    readonly permissions: WorldScenarioV1['organization']['positions'][number]['permissions'] }[]
  readonly sources: { readonly facts: number
    readonly privateBeliefs: number
    readonly resources: number
    readonly externalIdentities: number
    readonly initialGoals: number
    readonly calendars: number
    readonly directorEvents: number }
}

/** Explicitly versioned previews preserve field diagnostics and never allocate an execution identity. */
export type SimulationProductWorldPreflightResult = LegacyWorldReady | SimulationProductWorldV1Ready | {
  readonly status: 'invalid'
  readonly diagnostics: readonly (ScenarioDiagnostic | (ScenarioV1Diagnostic & { readonly source: 'scenario' | 'catalog' | 'preflight' }))[]
}

/** Portable original definition bound to its selected registered run; execution history and private resolution are omitted. */
export interface SimulationProductWorldExportResult {
  /** Compare with the selected run before using or caching the returned definition. */
  readonly runId: SimulationProductRunId
  readonly definition: WorldScenario | WorldScenarioV1
}
