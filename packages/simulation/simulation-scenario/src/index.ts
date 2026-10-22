/** Pure browser-compatible world scenario compilation and preflight; no Cordis or Host runtime is loaded. */
export { compileWorldScenario, exportWorldScenario, exportWorldScenarioText, parseWorldScenario, verifyWorldScenario } from './compiler.ts'
export { WORLD_SCENARIO_INPUT_LIMITS, decodeScenarioInput, serializeScenarioDefinition } from './input.ts'
export { scenarioCatalogSchema, scenarioLimitsSchema, scenarioNativeLimitsSchema, scenarioNativeSettingsSchema,
  scenarioRuntimeProfileSchema, scenarioTeamLimitsSchema, worldScenarioSchema } from './schema.ts'
export type { ResolvedWorldScenario, ScenarioCatalog, ScenarioCompilation, ScenarioDiagnostic, ScenarioEntityCommand,
  ScenarioLimits, ScenarioNativeDefinition, ScenarioParseResult, ScenarioPreview, ScenarioReadonly,
  ScenarioRelationCommand, ScenarioRuntimeProfile, ScenarioSourceFormat, WorldScenario } from './types.ts'
export { compileWorldScenarioV1, parseWorldScenarioV1, verifyWorldScenarioV1, exportWorldScenarioV1Text } from './v1-compiler.ts'
export { worldScenarioV1Schema, scenarioV1CatalogSchema, scenarioV1DiagnosticCodeSchema } from './v1-schema.ts'
export type { WorldScenarioV1, ScenarioV1Catalog, ScenarioV1Diagnostic, ScenarioV1Compilation,
  ResolvedWorldScenarioV1, ScenarioV1Preview, ScenarioV1SourceDiagnostic } from './v1-types.ts'
export { resolvedWorldScenarioV1Schema } from './v1-resolved.ts'

export { scenarioDraftCommandSchema, applyScenarioDraftCommand, stageScenarioDraftCommand } from './draft-commands.ts'
export type { ScenarioDraftCommand } from './draft-commands.ts'

export { scenarioTemplateManifestSchema, worldTemplatePackageSchema, parseWorldTemplatePackage, templateDependenciesMatch, verifyTemplateDependencies } from './template-package.ts'
export type { ScenarioTemplateManifest, WorldTemplatePackage } from './template-package.ts'
