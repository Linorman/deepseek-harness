/** Inert portable template packages pin implementation dependencies and carry explicit distribution metadata. */
import { z } from 'zod'
import { simulationWorldDomainPinSchema } from '@clocky/clocky-simulation/world-domain'
import { worldScenarioV1Schema, scenarioV1CatalogSchema } from './v1-schema.ts'
import { decodeScenarioInput } from './input.ts'
import type { WorldScenarioV1, ScenarioV1Catalog, ScenarioV1SourceDiagnostic } from './v1-types.ts'
import type { ScenarioSourceFormat } from './types.ts'

const key = z.string().min(1).max(256)
const reference = z.strictObject({ id: key, version: key })
/** Data-only package metadata; provider routes, credentials, install scripts and host paths are not accepted. */
export const scenarioTemplateManifestSchema = z.strictObject({
  id: key, version: key,
  license: z.strictObject({ identifier: key, notice: z.string().max(8192) }),
  attribution: z.array(z.string().min(1).max(1024)).max(32),
  dependencies: z.strictObject({ domains: z.array(simulationWorldDomainPinSchema).min(1),
    runtimeProfiles: z.array(reference).min(1), templates: z.array(reference).min(1), policyVersion: key,
    normPolicies: z.array(key) }),
})
/** Metadata remains separate from both the authored world and its execution facts. */
export type ScenarioTemplateManifest = z.infer<typeof scenarioTemplateManifestSchema>
const selector = (value: { domain: string; operation: string; version: string }) =>
  JSON.stringify([value.domain, value.operation, value.version])
const refKey = (value: { id: string; version: string }) => JSON.stringify([value.id, value.version])
const sameSet = (left: readonly string[], right: readonly string[]) => new Set(left).size === left.length
  && new Set(right).size === right.length && left.length === right.length && left.every(value => right.includes(value))

/** Check that a package declares exactly the symbolic dependencies its complete definition uses.
 * @param definition - Original parsed definition.
 * @param manifest - Closed package metadata.
 * @returns true only for a complete, nonduplicated dependency inventory; no catalog or code is loaded.
 */
export function templateDependenciesMatch(definition: WorldScenarioV1, manifest: ScenarioTemplateManifest): boolean {
  return sameSet(definition.domains.map(selector), manifest.dependencies.domains.map(selector))
    && sameSet(definition.runtimeProfiles.allowed.map(refKey), manifest.dependencies.runtimeProfiles.map(refKey))
    && sameSet(definition.runtimeProfiles.templates.map(refKey), manifest.dependencies.templates.map(refKey))
    && sameSet([...new Set(definition.governance.norms.flatMap(norm => norm.enforcement.kind === 'validated'
      ? [norm.enforcement.policyRef] : []))], manifest.dependencies.normPolicies)
}
/** Complete transport wrapper; an import installs no executable content and cannot discard unknown fields. */
export const worldTemplatePackageSchema = z.strictObject({ apiVersion: z.literal('clocky.world-template/v1'),
  manifest: scenarioTemplateManifestSchema, definition: worldScenarioV1Schema,
}).refine(value => templateDependenciesMatch(value.definition, value.manifest), 'Template dependencies must match the complete definition')
/** Validated inert template transport. */
export type WorldTemplatePackage = z.infer<typeof worldTemplatePackageSchema>

/** Decode a bounded JSON/YAML package with the same non-executable decoder as ordinary author definitions.
 * @param input - Untrusted file text or decoded data.
 * @param format - Explicit source syntax.
 * @returns complete parsed data or located diagnostics; never evaluates imports or package scripts.
 */
export function parseWorldTemplatePackage(input: unknown, format: ScenarioSourceFormat = 'json'):
{ readonly ok: true; readonly value: WorldTemplatePackage }
  | { readonly ok: false; readonly diagnostics: readonly ScenarioV1SourceDiagnostic[] } {
  const decoded = decodeScenarioInput(input, format)
  if (!decoded.ok) return decoded
  const parsed = worldTemplatePackageSchema.safeParse(decoded.value)
  if (parsed.success) return { ok: true, value: parsed.data }
  return { ok: false, diagnostics: parsed.error.issues.map(issue => ({ source: 'scenario', code: 'invalid-shape',
    path: issue.path.map(part => typeof part === 'number' ? part : String(part)),
    ...decoded.locate(issue.path.map(part => typeof part === 'number' ? part : String(part))), message: issue.message })) }
}

/** Verify exact pinned implementations against the current installed catalog before preflight or creation.
 * @param definition - Complete authored definition.
 * @param manifest - Original package metadata.
 * @param installed - Current trusted deployment catalog.
 * @returns bounded dependency refusals; actual world references and limits still use the ordinary compiler.
 */
export function verifyTemplateDependencies(definition: WorldScenarioV1, manifest: ScenarioTemplateManifest,
  installed: ScenarioV1Catalog): readonly ScenarioV1SourceDiagnostic[] {
  const catalog = scenarioV1CatalogSchema.parse(installed)
  const issues: ScenarioV1SourceDiagnostic[] = []
  if (!templateDependenciesMatch(definition, manifest)) issues.push({ source: 'scenario', code: 'invalid-reference',
    path: ['template', 'dependencies'], message: 'Template dependencies differ from the authored definition' })
  if (manifest.dependencies.policyVersion !== catalog.policyVersion) issues.push({ source: 'catalog', code: 'policy-unavailable',
    path: ['template', 'dependencies', 'policyVersion'], message: 'The original template policy version is not installed' })
  for (const pin of manifest.dependencies.domains) {
    const actual = catalog.domains.find(entry => selector(entry.pin) === selector(pin))
    if (actual?.available !== true || JSON.stringify(actual.pin) !== JSON.stringify(pin)) issues.push({
      source: 'catalog', code: 'domain-unavailable', path: ['template', 'dependencies', 'domains'],
      message: 'An exact template schema or implementation generation is unavailable' })
  }
  for (const policy of manifest.dependencies.normPolicies) if (!catalog.normPolicies.some(value => value === policy)) issues.push({
    source: 'catalog', code: 'policy-unavailable', path: ['template', 'dependencies', 'normPolicies'],
    message: 'An original template norm policy is unavailable' })
  return issues
}
