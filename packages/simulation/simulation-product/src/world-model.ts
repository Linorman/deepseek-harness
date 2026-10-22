/** Deployment-only model selection; accepted worlds retain concrete routes rather than live defaults. */
import { createHash } from 'node:crypto'
import type { Context } from '@clocky/cordis'
import type {} from '@clocky/clocky-agent-default-model'
import type { ScenarioCatalog, ScenarioV1Catalog } from '@clocky/clocky-simulation-scenario'

/** Select the current Agent default for every profile in an installed World catalog. */
export interface WorldModelSelection {
  /** Use the explicitly saved default, never the first registered provider. */
  readonly source: 'agent-default'
}

/**
 * Resolve a deployment selector without IO, preserving the installed catalog when no selector is declared.
 * @param ctx - Existing model-settings owner; absence never selects an arbitrary registered model.
 * @param installed - Validated installation metadata, never modified.
 * @param selection - Optional deployment-only binding for all installed runtime profiles.
 * @returns a detached concrete catalog, or an actionable refusal before any model or creation IO.
 */
export function resolveWorldModel(ctx: Context, installed: ScenarioCatalog | ScenarioV1Catalog,
  selection?: WorldModelSelection): { catalog: ScenarioCatalog | ScenarioV1Catalog } | { error: string } {
  if (selection === undefined) return { catalog: structuredClone(installed) }
  const current = ctx.get('agentDefaultModel')?.currentSelection()
  if (current === undefined) return { error: 'Choose a provider and save a default model in Settings > Models, then check the scenario again.' }
  if (current.reasoningEffort !== undefined) return {
    error: 'World actors require provider-default reasoning. Clear the explicit reasoning override in Settings > Models, then check again.',
  }
  const catalog = structuredClone(installed)
  const version = `agent-default/1/${createHash('sha256').update(JSON.stringify([current.provider, current.model])).digest('hex')}`
  catalog.generation = `${installed.generation}/${version}`
  for (const profile of catalog.runtimeProfiles) profile.model = {
    provider: current.provider, name: current.model, version, available: true,
  }
  return { catalog }
}
