/** Pure run-wide personnel counts; Native admission, retained capacity and Team history remain separate. */
import { z } from 'zod'
import type { TeamStateSnapshot } from '@clocky/clocky-team/types'
import { teamIdSchema } from '@clocky/clocky-team/schema'
import type { SimulationSnapshot, SimulationRunId } from './types.ts'
import { simulationRunIdSchema } from './schema.ts'
import { simTimeSchema } from './time.ts'

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** Incomplete history observations never imply an empty Team. */
export const personnelHistoryUnknownReasonSchema = z.enum(['unavailable', 'unsupported', 'partial', 'source-moved'])
/** One complete canonical Team history count, or an explicit unknown observation. */
export const personnelHistoryCountSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unknown'), reason: personnelHistoryUnknownReasonSchema }),
  z.strictObject({ kind: z.literal('known'), value: count, teamId: teamIdSchema, cursor: count }),
])
/** Safe run-wide counts at an exact Native cursor; histories carry their independent Team cursor. */
export const personnelCountsSchema = z.strictObject({
  scope: z.strictObject({ kind: z.literal('run') }), runId: simulationRunIdSchema, cursor: count, time: simTimeSchema,
  assignedPeople: count, nonterminatedPeople: count, residentActors: count, unreleasedWriters: count, residentLimit: count.positive(),
  historicalParticipants: personnelHistoryCountSchema, historicalActivations: personnelHistoryCountSchema,
}).superRefine((value, ctx) => {
  if (value.assignedPeople > value.nonterminatedPeople || value.residentActors > value.unreleasedWriters)
    ctx.addIssue({ code: 'custom', message: 'Personnel counts violate Native subset relationships' })
  const participants = value.historicalParticipants, activations = value.historicalActivations
  if (participants.kind !== activations.kind || (participants.kind === 'known' && activations.kind === 'known'
    && (participants.teamId !== activations.teamId || participants.cursor !== activations.cursor))
    || (participants.kind === 'unknown' && activations.kind === 'unknown' && participants.reason !== activations.reason))
    ctx.addIssue({ code: 'custom', message: 'Personnel history counts require the same complete source coverage' })
})
/** Validated administrative count projection, without private Person or Team bodies. */
export type PersonnelCounts = z.infer<typeof personnelCountsSchema>
/** A trusted full Team snapshot fetched between matching Native cursor observations; partial pages are explicitly unknown. */
export type PersonnelTeamHistoryObservation =
  | { readonly kind: 'unknown'; readonly reason: z.infer<typeof personnelHistoryUnknownReasonSchema> }
  | { readonly kind: 'full'
    readonly runId: SimulationRunId
    readonly nativeCursor: number
    readonly teamCursor: number
    readonly team: TeamStateSnapshot }

/**
 * Project current Native personnel and capacity predicates without external IO.
 * @param state - Authoritative Native snapshot, including every entity and relation.
 * @returns run-wide counts; historical Team totals remain unknown until a complete source is supplied.
 * Resident means a currently admitted active cognitive writer with its canonical binding and activation,
 * not observed physical process liveness. Reserved and revoked writers retain capacity but are not resident.
 */
export function projectPersonnelCounts(state: SimulationSnapshot): PersonnelCounts {
  const entities = Object.values(state.entities)
  const people = new Set(entities.filter(entity => entity.kind === 'person' && entity.phase !== 'terminated').map(entity => entity.id))
  const time = BigInt(state.time)
  const assigned = new Set(Object.values(state.relations).filter(relation => relation.relation === 'assignment'
    && people.has(relation.subject) && BigInt(relation.validFrom) <= time
    && (relation.validUntil === null || time < BigInt(relation.validUntil))).map(relation => relation.subject))
  return personnelCountsSchema.parse({ scope: { kind: 'run' }, runId: state.spec.runId, cursor: state.revision, time: state.time,
    assignedPeople: assigned.size, nonterminatedPeople: people.size,
    residentActors: entities.filter(entity => entity.cognition === 'agent' && entity.phase === 'active' && entity.readiness === 'ready'
      && entity.binding !== undefined && entity.writer?.phase === 'active' && entity.writer.activationId !== undefined).length,
    unreleasedWriters: entities.filter(entity => entity.writer !== undefined && entity.writer.phase !== 'released').length,
    residentLimit: state.spec.maxResidentActors,
    historicalParticipants: { kind: 'unknown', reason: 'unavailable' }, historicalActivations: { kind: 'unknown', reason: 'unavailable' } })
}

/**
 * Combine Native counts with actual complete canonical Team history, without filtering retired historical identities.
 * @param state - Original Native snapshot whose Team reservation owns the history.
 * @param counts - Native projection from this exact snapshot; stale or changed values reject.
 * @param observation - Complete trusted Team source and both source cursors, or explicit incomplete coverage.
 * @returns separate historical participant and activation-epoch totals; incomplete coverage remains unknown.
 * @throws when run, cursor, canonical Team, uniqueness or current writer identity relationships disagree.
 */
export function combinePersonnelCounts(state: SimulationSnapshot, counts: PersonnelCounts,
  observation: PersonnelTeamHistoryObservation): PersonnelCounts {
  const native = projectPersonnelCounts(state)
  for (const field of ['runId', 'cursor', 'time', 'assignedPeople', 'nonterminatedPeople', 'residentActors', 'unreleasedWriters', 'residentLimit'] as const)
    if (counts[field] !== native[field]) throw new Error('Personnel counts do not match the original Native cursor')
  if (observation.kind === 'unknown') {
    const unknown = { kind: 'unknown' as const, reason: observation.reason }
    return personnelCountsSchema.parse({ ...native, historicalParticipants: unknown, historicalActivations: unknown })
  }
  const team = observation.team, reservation = state.teamReservation
  if (observation.runId !== state.spec.runId || observation.nativeCursor !== state.revision
    || !Number.isSafeInteger(observation.teamCursor) || observation.teamCursor < 0 || observation.teamCursor !== team.team.cursor
    || reservation?.confirmed !== true || reservation.teamId !== team.team.id || team.goal.teamId !== team.team.id)
    throw new Error('Personnel history requires matching run, Native cursor and confirmed canonical Team source')
  const participants = new Set(team.participants.map(participant => participant.id))
  if (participants.size !== team.participants.length || team.participants.some(participant => participant.teamId !== team.team.id))
    throw new Error('Personnel history contains duplicate or foreign participants')
  const activations = new Set(team.activations.map(binding => binding.activation.id))
  if (activations.size !== team.activations.length || team.activations.some(binding => binding.activation.teamId !== team.team.id
    || !participants.has(binding.activation.participantId)))
    throw new Error('Personnel history contains duplicate, foreign or orphan activation epochs')
  const boundParticipants = new Set<string>()
  for (const entity of Object.values(state.entities)) {
    const binding = entity.binding
    if (binding === undefined) continue
    if (binding.teamId !== team.team.id || !participants.has(binding.participantId) || boundParticipants.has(binding.participantId))
      throw new Error('Personnel history disagrees with a canonical Native participant binding')
    boundParticipants.add(binding.participantId)
    if (entity.writer?.activationId === undefined || entity.writer.phase === 'released') continue
    const actual = team.activations.find(value => value.activation.id === entity.writer?.activationId)
    if (actual === undefined || actual.activation.participantId !== binding.participantId || actual.sessionId !== binding.sessionId
      || actual.reservationId !== entity.writer.reservationId || actual.provider !== entity.writer.provider)
      throw new Error('Personnel history disagrees with the retained Native writer epoch')
  }
  return personnelCountsSchema.parse({ ...native,
    historicalParticipants: { kind: 'known', value: team.participants.length, teamId: team.team.id, cursor: team.team.cursor },
    historicalActivations: { kind: 'known', value: team.activations.length, teamId: team.team.id, cursor: team.team.cursor } })
}
