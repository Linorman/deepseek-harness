/** Deployment model binding is read at preview/admission and never retained as a driver selector. */
import type { Context } from '@clocky/cordis'
import type {} from '@clocky/clocky-agent-default-model'
import type {} from '@clocky/clocky-llm'
import type { SimulationInstalledCompanyTemplate } from './creation-types.ts'
import type { SimulationProductModelReadiness, SimulationProductModelRoute } from './administration-types.ts'

/**
 * Read the explicit route or the current Agent default without contacting a model.
 * Company activation supports provider defaults, not an explicit reasoning-effort override.
 * @param ctx - Existing default-selection owner and registered model providers.
 * @param template - Validated installed definition, including its deployment-only selector.
 * @returns exact route or a safe configuration reason; no identity or resources are allocated.
 */
export function currentTemplateModel(ctx: Context, template: SimulationInstalledCompanyTemplate): SimulationProductModelReadiness {
  if (!('source' in template.driver.model)) return { status: 'ready', model: { ...template.driver.model } }
  const selection = ctx.get('agentDefaultModel')?.currentSelection()
  if (selection === undefined) return { status: 'needs-model', reason: 'default-model-missing' }
  if (selection.reasoningEffort !== undefined) return { status: 'unavailable', reason: 'reasoning-unsupported' }
  return { status: 'ready', model: { provider: selection.provider, name: selection.model } }
}

/**
 * Resolve adapter-owned metadata for the exact route, without inference or a connection test.
 * @param ctx - Registered provider owner.
 * @param template - Current installed definition.
 * @param signal - Authenticated read/admission lifetime.
 * @returns bounded readiness; adapter failure details and credentials are withheld.
 */
export async function resolveTemplateModel(ctx: Context, template: SimulationInstalledCompanyTemplate,
  signal: AbortSignal): Promise<SimulationProductModelReadiness> {
  const current = currentTemplateModel(ctx, template)
  if (current.status !== 'ready') return current
  if (!templateProviderAvailable(ctx, current.model)) return { status: 'unavailable', reason: 'provider-unavailable' }
  try { await ctx.llm.resolveModelInfo(current.model.provider, current.model.name, signal) }
  catch { return { status: 'unavailable', reason: 'metadata-unavailable' } }
  return current
}

/**
 * Verify registration again at serialized acceptance without inference or another asynchronous lookup.
 * @param ctx - Provider registry at this queue position.
 * @param model - The metadata-resolved route.
 * @returns whether that provider is still registered; remote API key validity remains a request-time fact.
 */
export function templateProviderAvailable(ctx: Context, model: SimulationProductModelRoute): boolean {
  return ctx.llm.listProviders().some(provider => provider.id === model.provider)
}
