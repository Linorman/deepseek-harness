/** Shared task placement selection used by admission and execution Consumers. @module */
import type { ActivationBindingSnapshot, ParticipantSnapshot, TeamTaskPlacement } from './types.ts'

/**
 * Match a durable descriptor and the actual selected execution provider.
 * @param placement - immutable task restrictions; absent fields impose no additional restriction.
 * @param participant - authoritative Team participant descriptor.
 * @param provider - actual activation provider, or the descriptor's provider before activation.
 * @param selection - actual activation composition; omitted only for pre-activation descriptor matching.
 * @returns whether every specified restriction admits this candidate.
 */
export function matchesTaskPlacement(
  placement: TeamTaskPlacement | undefined,
  participant: ParticipantSnapshot,
  provider: string | undefined = participant.provider,
  selection?: ActivationBindingSnapshot['selection'],
): boolean {
  if (placement === undefined) return true
  return includes(placement.participantIds, participant.id)
    && includes(placement.roles, participant.role)
    && includes(placement.providers, provider)
    && includes(placement.presets, selection === undefined ? participant.preset : selection.preset)
    && includes(placement.models, selection === undefined ? participant.model
      : selection.provider === undefined || selection.model === undefined ? undefined : `${selection.provider}/${selection.model}`)
}

/** An absent restriction admits all values; an explicit set admits only its named values. */
function includes(values: readonly string[] | undefined, value: string | undefined): boolean {
  return values === undefined || value !== undefined && values.includes(value)
}
