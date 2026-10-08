/** Shared activation choices for trusted company and task-scenario drivers. */
import type { SimulationRun,SimulationEntityId } from '@clocky/clocky-simulation'
import type { SimulationResidencyChoice } from '@clocky/clocky-simulation-team'
import type { SimulationCompanyPreparation } from './company-preparation.ts'

/** Build the fresh/resume activation route without choosing the scenario's eviction policy.
 * @param run - Current authoritative run state.
 * @param entityId - Cognitive entity whose writer controls seed choice.
 * @param participant - Trusted installed Participant provider and preset.
 * @param model - Driver-resolved model route.
 * @param lifetime - Owning driver cancellation signal.
 * @returns the exact activation choice; each scenario retains ordered eviction authority.
 */
export function driverActivation(
  run: SimulationRun, entityId: SimulationEntityId, participant: SimulationCompanyPreparation['participant'],
  model: { readonly provider: string; readonly name: string }, lifetime: AbortSignal,
): SimulationResidencyChoice['activation'] {
  const entity = run.snapshot().entities[entityId]
  return { provider: participant.provider, seed: { kind: entity?.writer === undefined ? 'fresh' : 'resume' },
    agent: { preset: participant.preset, options: { provider: model.provider, model: model.name } }, signal: lifetime }
}
