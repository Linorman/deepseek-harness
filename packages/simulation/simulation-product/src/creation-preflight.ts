/** Pure company allowance resolution shared by preview and durable creation admission. */
import { simulationRunSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationRunSpec } from '@clocky/clocky-simulation'
import type { SimulationInstalledCompanyTemplate } from './creation-types.ts'
import type { SimulationProductLimits, SimulationProductPreflightInput, SimulationProductPreflightIssue } from './administration-types.ts'
import { resolveScenarioTopology } from './scenario-topology.ts'

/** Detached resolved native specification and public field refusals, without creation side effects. */
export interface CreationResolution {
  readonly spec: Omit<SimulationRunSpec, 'runId'>
  readonly issues: readonly SimulationProductPreflightIssue[]
}

/**
 * Resolve only explicitly editable reductions of installed allowances without allocating any identity.
 * @param template - Trusted installed maxima and strategy.
 * @param input - Parsed public creation semantics.
 * @param text - Product owner's bounded public text encoder.
 * @returns immutable native spec or field issues; no provider, storage, Team or model calls.
 */
export function resolveCreation(template: SimulationInstalledCompanyTemplate, input: SimulationProductPreflightInput,
  text: (value: string) => SimulationProductPreflightIssue['message']): CreationResolution {
  const choices = Object.entries(input.limits ?? {}).filter((entry): entry is [string, string | number] => entry[1] !== undefined)
  const spec = { ...template.spec, ...Object.fromEntries(choices) }
  const issues: SimulationProductPreflightIssue[] = []
  const issue = (field: string, code: SimulationProductPreflightIssue['code'], message: string) => issues.push({ field, code, message: text(message) })
  for (const [field, value] of choices) {
    const key = field as keyof SimulationProductLimits
    if (!template.editableLimits?.includes(key)) issue(`limits.${field}`, 'not-allowed', 'This template does not permit changing this allowance')
    else if (key === 'maxTime' ? BigInt(value) > BigInt(template.spec.maxTime)
      : Number(value) > template.spec[key]) issue(`limits.${field}`, 'invalid', 'Allowance exceeds the installed template maximum')
  }
  const topology = resolveScenarioTopology({ ...input.parameters, topology: template.driver.scenario?.topology })
  if (spec.maxEntities < topology.actors.length) {
    issue('limits.maxEntities', 'invalid', `Installed topology requires capacity for ${topology.actors.length} actors`)
  }
  const minimumResidents = template.driver.tasks?.review === 'buyer' || template.driver.scenario !== undefined ? 2 : 1
  if (spec.maxResidentActors < minimumResidents) issue('limits.maxResidentActors', 'invalid', 'Resident capacity is insufficient for this template strategy')
  if (spec.maxResidentActors > spec.maxEntities) issue('limits.maxResidentActors', 'invalid', 'Resident capacity cannot exceed entity capacity')
  if (template.driver.scenario === undefined && spec.maxTokensPerInterval < spec.tokensPerModelRequest) {
    issue('limits.maxTokensPerInterval', 'invalid', 'Interval budget must admit at least one complete model request reservation')
  }
  if (BigInt(spec.maxTime) < BigInt(template.driver.completeDelay)) issue('limits.maxTime', 'invalid', 'Tick horizon ends before the template completion schedule')
  if (BigInt(input.parameters.initialStock) > BigInt(template.spec.maxResourceQuantity)) issue('parameters.initialStock', 'invalid', 'Simulation stock exceeds template allowance')
  // Native schema remains the authority for clock and policy types; no preview identity escapes this function.
  const parsed = simulationRunSpecSchema.parse({ ...spec, runId: 'preflight-validation' })
  const { runId: _runId, ...resolved } = parsed
  return { spec: resolved, issues }
}
