/** Web-owned default World installation over the shared durable administration service. */
import type { Context } from '@clocky/cordis'
import Administration from '@clocky/clocky-simulation-product/administration'
import type { Config } from '@clocky/clocky-simulation-product/administration'
import { webWorldCatalog } from './world-catalog.ts'
import { webWorldTemplates } from './world-scenarios.ts'

/** Standard Web profiles publish editable worlds; explicit installations retain their own configuration. */
export default class WebSimulationAdministration extends Administration {
  /**
   * @param ctx - Existing Native, Team, product and model owners injected by Administration.
   * @param config - Administration allowances and procurement templates; an explicit world replaces the Web defaults.
   */
  constructor(ctx: Context, config: Config) {
    const catalog = webWorldCatalog()
    super(ctx, Object.assign({}, config, { world: config.world ?? { provider: 'web-local', catalog,
      model: { source: 'agent-default' as const }, authoringTemplates: webWorldTemplates(catalog),
      checkpoint: { maxDrainRounds: 32, maxAttempts: 3 } } }))
  }
}
