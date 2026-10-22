/** Versioned v1 authoring and complete resolved initialization contracts. */
import type { compileWorldScenarioV1 } from './v1-compiler.ts'
import type { ScenarioReadonly } from './types.ts'
export type { WorldScenarioV1, ScenarioV1Catalog, ScenarioV1Diagnostic } from './v1-schema.ts'

/** Complete v1 success or field-diagnostic result; it never owns a live run or allocates identities. */
export type ScenarioV1Compilation = Awaited<ReturnType<typeof compileWorldScenarioV1>>
/** Frozen definition, complete configured catalog/defaults/ceilings, observed Team bounds and Native bootstrap data. */
export type ResolvedWorldScenarioV1 = ScenarioReadonly<Extract<ScenarioV1Compilation, { ok: true }>['resolved']>
/** Public preview covers actual selected models, operations, limits and initialization mode. */
export type ScenarioV1Preview = ScenarioReadonly<Extract<ScenarioV1Compilation, { ok: true }>['preview']>

/** Located closed diagnostics for source syntax, installed metadata and reviewed v1 commitments. */
export type ScenarioV1SourceDiagnostic = Extract<ScenarioV1Compilation, { ok: false }>['diagnostics'][number]
