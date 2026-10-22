/** Current representation admission derives exclusively from immutable Native switch history. */
import { representationHistorySchema, representationSwitchRequestSchema, WORLD_REPRESENTATION_PIN, SimulationWorldError } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationEntityId, WorldExternalIdentityId } from '@clocky/clocky-simulation'

/**
 * Fence new and stale interaction work after an explicit representation switch.
 * @param state - Current authoritative prefix.
 * @param subjectId - Original noncognitive subject.
 * @param identityId - Original external business identity.
 * @param requested - Installed interaction representation being admitted.
 */
export function assertRepresentationAdmission(state: SimulationSnapshot, subjectId: SimulationEntityId,
  identityId: WorldExternalIdentityId, requested: 'simulated-rule' | 'director-mediated' | 'simulated-actor'): void {
  if (Object.values(state.world?.intents ?? {}).some(intent => intent.pin.domain === WORLD_REPRESENTATION_PIN.domain
    && intent.pin.operation === WORLD_REPRESENTATION_PIN.operation
    && representationSwitchRequestSchema.parse(intent.payload).identityId === identityId
    && !Object.values(state.world?.results ?? {}).some(result => result.intentId === intent.id)))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'External representation switch has closed new interaction admission')
  const identity = state.world?.external.identities[identityId]
  if (identity === undefined) return
  const histories = state.entities[subjectId]?.profile.externalRepresentations
  if (histories !== undefined && (histories === null || typeof histories !== 'object' || Array.isArray(histories)))
    throw new Error('Malformed representation history')
  const raw = histories?.[identityId]
  const history = raw === undefined ? undefined : representationHistorySchema.parse(raw)
  const selected = history?.at(-1)?.to ?? identity.representation
  // The actor owner independently proves the exact committed mediated representative and original contact source.
  if (requested === 'simulated-actor' && (history === undefined || selected === 'director-mediated'
    && Object.values(state.world?.external.representatives ?? {}).some(value => value.identityId === identityId
      && value.status === 'committed' && value.adjudication !== undefined))) return
  if (selected !== requested) throw new SimulationWorldError('SIM_WORLD_CONFLICT',
    'External interaction uses a different or retired representation; an explicit switch is required')
}
