/** Optional local Harbor case integration; never installed by the default Web profile. */
import { resolve } from 'node:path'
import { z } from 'zod'
import type { Context } from '@clocky/cordis'
import { HarborNativeDomain } from './harbor-domain.ts'
import { harborArchiveProvider } from './harbor-archive-provider.ts'
import { HarborExecution } from './harbor-execution.ts'
import { HARBOR_CONTRACTS } from './harbor-protocol.ts'
import type {} from './providers.ts'
import type {} from '@clocky/clocky-simulation-team'

export const name = 'simulation-harbor'
export const inject = ['simulations', 'simulationTeams', 'simulationWorldExecutions']
/** Trusted local deployment paths; no model input can change either directory or the provider. */
export const Config = z.strictObject({
  sourceDirectory: z.string().min(1), root: z.string().min(1), provider: z.string().min(1),
})
/** Validated optional local deployment settings. */
export type Config = z.infer<typeof Config>

/** Mount the original case parser/reducer and its effect-scoped execution factory.
 * @param ctx - Existing Simulation services.
   * @param config - Validated trusted case deployment. */
export function apply(ctx: Context, config: Config): void {
  const source = resolve(config.sourceDirectory), root = resolve(config.root)
  ctx.simulationTeams.registerWorldArchiveProvider(harborArchiveProvider(root))
  for (const contract of HARBOR_CONTRACTS) {
    const domain = new HarborNativeDomain(contract)
    ctx.effect(() => ctx.simulations.domains(config.provider).register(domain.definition, domain))
    ctx.effect(() => ctx.simulationWorldExecutions.register({ definition: contract.definition,
      ref: contract.pin.implementationRef, generation: contract.pin.generation,
      create: binding => new HarborExecution(binding, source, root, contract) }))
  }
}

export { HARBOR_ACTORS, HARBOR_PIN } from './harbor-protocol.ts'
export { createHarborInstallation } from './harbor-installation.ts'
