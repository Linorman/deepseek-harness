/** Real product deployment variants keep a frozen original scenario separate from current catalog metadata. */
import type { Context } from '@clocky/cordis'
import Products from '@clocky/clocky-simulation-product'
import Administration from '@clocky/clocky-simulation-product/administration'
import { worldScenarioV1Schema, scenarioV1CatalogSchema } from '@clocky/clocky-simulation-scenario'
import type { ScenarioV1Catalog } from '@clocky/clocky-simulation-scenario'
import { worldV1Catalog, worldV1Definition } from '../world-v1-product/deployment.ts'
export const name = 'world-v1-resolution-deployment'
export const inject = ['storageLog', 'simulations', 'simulationTeams', 'teams', 'llm', 'agentRuntimes', 'agentPresets']
export const resolutionDefinition = worldScenarioV1Schema.parse({ ...structuredClone(worldV1Definition),
  limits: { ...worldV1Definition.limits, native: { ...worldV1Definition.limits.native, maxEntities: 8 } } })
export const resolutionCatalog = scenarioV1CatalogSchema.parse(structuredClone(worldV1Catalog))
let administrationFiber: ReturnType<Context['plugin']> | undefined
/** Replace only the trusted current administration metadata; actual owners and original journal remain untouched.
 * @param ctx - Actual Loader graph.
 * @param catalog - Current deployment metadata; undefined removes fresh World admission.
 * @returns when the real Administration service has reloaded its original journal.
 */
export async function mountCatalog(ctx: Context, catalog: ScenarioV1Catalog | undefined): Promise<void> {
  await administrationFiber?.dispose()
  administrationFiber = ctx.plugin(Administration, { journalStream: 'c33-v1-commands', templates: [], recoveryPageSize: 2,
    ...catalog === undefined ? {} : { world: { provider: 'local', catalog, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } } } })
  await administrationFiber
}
/** @param ctx - Real Loader context; this plugin changes deployment metadata without replacing any IO implementation. */
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(Products, { directoryStream: 'c33-v1-products' })
  const mode = process.env.WORLD_V1_RESOLUTION_CATALOG ?? 'original'
  if (mode === 'removed') await mountCatalog(ctx, undefined)
  else {
    const catalog = structuredClone(resolutionCatalog)
    if (mode === 'changed') {
      catalog.generation = 'a-completely-different-current-catalog'
      catalog.policyVersion = 'a-completely-different-current-policy'
      catalog.limits.defaults.native.maxEntities = 15
      catalog.limits.ceilings.native.maxEntities = 15
      catalog.runtimeProfiles[0]!.model.version = 'different-current-model'
      catalog.templates[0]!.defaultPersona.name = 'Director'
    }
    await mountCatalog(ctx, catalog)
  }
}
