/** Pure public redaction of original personnel count metadata. */
import type { PersonnelCounts } from '@clocky/clocky-simulation'
import type { SimulationProductPeopleCounts } from './people-types.ts'
import { simulationProductPeopleCountsSchema } from './people-schema.ts'

/**
 * Remove provider-local identity while preserving exact Native and complete Team count provenance.
 * @param counts - Validated original Native projection and independently observed Team history.
 * @returns whole-run metadata without Person names, bindings, paths or private bodies.
 */
export function productPeopleCounts(counts: PersonnelCounts): SimulationProductPeopleCounts {
  const participants = counts.historicalParticipants, activations = counts.historicalActivations
  if (participants.kind !== activations.kind) throw new Error('Personnel history coverage is inconsistent')
  return simulationProductPeopleCountsSchema.parse({ scope: 'run', snapshotRevision: counts.cursor, time: counts.time,
    employed: counts.assignedPeople, nonTerminalPersons: counts.nonterminatedPeople, resident: counts.residentActors,
    residentLimit: counts.residentLimit, unreleasedWriters: counts.unreleasedWriters,
    history: participants.kind === 'known' && activations.kind === 'known'
      ? { status: 'observed', teamCursor: participants.cursor, participants: participants.value, activations: activations.value }
      : { status: 'unavailable', reason: participants.kind === 'unknown' ? participants.reason : 'unavailable' } })
}
