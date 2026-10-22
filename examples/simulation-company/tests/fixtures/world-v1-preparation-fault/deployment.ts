/** Original C30 portable source and metadata mount in a separate real Loader fault-test administration. */
import type { Context } from '@clocky/cordis'
import Products from '@clocky/clocky-simulation-product'
import Administration from '@clocky/clocky-simulation-product/administration'
import { worldV1Catalog } from '../world-v1-product/deployment.ts'
export { worldV1Definition } from '../world-v1-product/deployment.ts'
export const name = 'world-v1-preparation-fault-deployment'
export const inject = ['storageLog', 'simulations', 'simulationTeams', 'teams', 'llm', 'agentRuntimes', 'agentPresets']
/** @param ctx - Original actual Loader service graph; no owner implementation is replaced. */
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(Products, { directoryStream: 'c31-v1-products' })
  await ctx.plugin(Administration, { journalStream: 'c31-v1-commands', templates: [], recoveryPageSize: 2,
    world: { provider: 'local', catalog: worldV1Catalog, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } } })
}
