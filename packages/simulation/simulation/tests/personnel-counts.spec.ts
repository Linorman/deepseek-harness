/** Pure relationship counts and independently covered Team histories; no mock IO or invented liveness. */
import { expect, it } from 'vitest'
import { teamIdSchema, teamStateSnapshotSchema, teamRootCreateInputSchema, activationReservationIdSchema,
  activationIdSchema } from '@clocky/clocky-team/schema'
import type { TeamStateSnapshot } from '@clocky/clocky-team/types'
import type { SimulationSnapshot } from '../src/types.ts'
import type { SimulationEntity, SimulationRelation } from '../src/entity-types.ts'
import type { SimulationWriter } from '../src/writer-types.ts'
import { simulationRunSpecSchema } from '../src/schema.ts'
import { simulationEntityIdSchema, simulationRelationIdSchema } from '../src/entity.ts'
import { simulationEntityBindingSchema, simulationWriterEpochSchema, simulationCoordinatorIdSchema } from '../src/writer.ts'
import { simulationDecisionSlotSchema } from '../src/business.ts'
import { simulationEventSlotSchema } from '../src/scheduler.ts'
import { simTimeSchema } from '../src/time.ts'
import { projectPersonnelCounts, combinePersonnelCounts, personnelCountsSchema } from '../src/personnel-counts.ts'

function person(name: string, phase: SimulationEntity['phase'] = 'active'): SimulationEntity {
  return { id: simulationEntityIdSchema.parse(name), kind: 'person', cognition: 'agent', revision: 1, profileRevision: 1,
    phase, readiness: 'ready', profile: {}, binding: simulationEntityBindingSchema.parse({
      teamId: 'canonical', participantId: name, sessionId: `session:${name}` }) }
}
function writer(phase: SimulationWriter['phase']): SimulationWriter {
  return { phase, epoch: simulationWriterEpochSchema.parse('1'), provider: 'in-process',
    coordinatorId: simulationCoordinatorIdSchema.parse('original-owner'), reservationId: activationReservationIdSchema.parse('reservation'),
    ...phase === 'reserved' ? {} : { activationId: activationIdSchema.parse('epoch') } }
}
function assignment(id: string, subject: SimulationEntity, from: string, until: string | null): SimulationRelation {
  return { id: simulationRelationIdSchema.parse(id), relation: 'assignment', subject: subject.id,
    object: simulationEntityIdSchema.parse('position'), scope: simulationEntityIdSchema.parse('organization'),
    revision: 1, validFrom: simTimeSchema.parse(from), validUntil: until === null ? null : simTimeSchema.parse(until) }
}
function state(entities: readonly SimulationEntity[] = [], relations: readonly SimulationRelation[] = []): SimulationSnapshot {
  return { spec: simulationRunSpecSchema.parse({ runId: 'personnel-counts', tickUnit: 'minute', origin: '0', maxTime: '100',
    rulesVersion: '1', policyVersion: '1', relationRules: [], outboxMaxAttempts: 3, outboxRetryDelayMs: 10,
    maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000,
    maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 16, maxResidentActors: 4, maxTokensPerInterval: 1000000,
    tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100,
    maxPendingEvents: 100, maxPendingInteractions: 100, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32,
    maxQueuedDecisions: 100, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 4, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '1000' }),
  revision: 10, time: simTimeSchema.parse('2'), phase: 'paused', entities: Object.fromEntries(entities.map(value => [value.id, value])),
  relations: Object.fromEntries(relations.map(value => [value.id, value])),
  nextDecisionSlot: simulationDecisionSlotSchema.parse('0'), nextEventSlot: simulationEventSlotSchema.parse('0'),
  decisions: {}, operations: {}, resources: {},
  resourceReservations: {}, grants: {}, interactions: {}, commitments: {}, scheduledEvents: {}, wakes: {},
  teamReservation: { teamId: teamIdSchema.parse('canonical'), confirmed: true, creation: teamRootCreateInputSchema.parse({
    goal: { objective: 'Original personnel', budgets: {} }, budgets: {}, rules: {} }) } }
}
function team(): TeamStateSnapshot {
  const goal = { teamId: 'canonical', revision: 1, objective: 'Original personnel', phase: 'active', budgets: {} }
  return teamStateSnapshotSchema.parse({ team: { id: 'canonical', depth: 0, maxTeamDepth: 0, goal, phase: 'active',
    cursor: 7, createdAt: 1, updatedAt: 1 }, goal, rules: {}, budgets: {}, participants: [
    { id: 'current', teamId: 'canonical', kind: 'local-agent', displayName: 'Current', role: 'worker', capabilities: [], phase: 'active' },
    { id: 'retired', teamId: 'canonical', kind: 'local-agent', displayName: 'Retired', role: 'worker', capabilities: [], phase: 'left' },
  ], activations: [
    { activation: { id: 'epoch', teamId: 'canonical', participantId: 'current', status: 'running' },
      sessionId: 'session:current', reservationId: 'reservation', provider: 'in-process' },
    { activation: { id: 'old-epoch', teamId: 'canonical', participantId: 'current', status: 'offline' },
      sessionId: 'old-session', provider: 'in-process', quiescedAt: 1, quiescenceSource: 'quiesced', quiescedWakeChannelIds: [] },
    { activation: { id: 'retired-epoch', teamId: 'canonical', participantId: 'retired', status: 'offline' },
      sessionId: 'retired-session', provider: 'in-process', quiescedAt: 1, quiescenceSource: 'quiesced', quiescedWakeChannelIds: [] },
  ], tasks: [], workspaceAllocations: [], channelIds: [] })
}
function full(snapshot: SimulationSnapshot, source = team()) {
  return { kind: 'full' as const, runId: snapshot.spec.runId, nativeCursor: snapshot.revision, teamCursor: source.team.cursor, team: source }
}

it('counts distinct nonterminated people on half-open current assignments, retaining inactive people', () => {
  const active = person('active'), inactive = person('inactive', 'inactive'), ended = person('ended'), future = person('future')
  const terminated = person('terminated', 'terminated'), nonperson = { ...person('director'), kind: 'director' }
  const snapshot = state([active, inactive, ended, future, terminated, nonperson], [
    assignment('a', active, '2', null), assignment('duplicate', active, '1', '3'), assignment('i', inactive, '0', null),
    assignment('ended', ended, '0', '2'), assignment('future', future, '3', null),
    assignment('terminated', terminated, '0', null), assignment('nonperson', nonperson, '0', null),
  ])
  const counts = projectPersonnelCounts(snapshot)
  expect(counts).toMatchObject({ assignedPeople: 2, nonterminatedPeople: 4, residentActors: 0, unreleasedWriters: 0, residentLimit: 4 })
  expect(projectPersonnelCounts({ ...snapshot, time: simTimeSchema.parse('3') }).assignedPeople).toBe(3)
  expect(projectPersonnelCounts({ ...snapshot, time: simTimeSchema.parse('900719925474099312345') }).assignedPeople).toBe(3)
})

it('separates admitted cognitive writers from reservations, unknown stop responsibility and released history', () => {
  const active = { ...person('active'), writer: writer('active') }
  const snapshot = state([active, { ...person('reserved'), writer: writer('reserved') },
    { ...person('revoked'), writer: writer('revoked') }, { ...person('released'), writer: writer('released') },
    { ...person('inactive', 'inactive'), writer: writer('active') },
    { ...person('preparing'), readiness: 'preparing', writer: writer('active') },
    { ...person('none'), cognition: 'none', writer: writer('active') },
    { ...person('no-activation'), writer: { ...writer('reserved'), phase: 'active' } }])
  expect(projectPersonnelCounts(snapshot)).toMatchObject({ residentActors: 1, unreleasedWriters: 7 })
  expect(projectPersonnelCounts(state([{ ...active, writer: writer('revoked') }]))).toMatchObject({ residentActors: 0, unreleasedWriters: 1 })
})

it('keeps unavailable or unsupported history unknown while a complete empty canonical Team proves zero', () => {
  const snapshot = state(), counts = projectPersonnelCounts(snapshot)
  expect(counts.historicalParticipants).toEqual({ kind: 'unknown', reason: 'unavailable' })
  for (const reason of ['unavailable', 'unsupported', 'partial', 'source-moved'] as const) {
    const result = combinePersonnelCounts(snapshot, counts, { kind: 'unknown', reason })
    expect(result.historicalParticipants).toEqual({ kind: 'unknown', reason })
    expect(result.historicalActivations).toEqual({ kind: 'unknown', reason })
  }
  const source = { ...team(), participants: [], activations: [] }
  expect(combinePersonnelCounts(snapshot, counts, full(snapshot, source))).toMatchObject({
    historicalParticipants: { kind: 'known', value: 0 }, historicalActivations: { kind: 'known', value: 0 } })
})

it('counts every canonical Team identity and epoch, including removed participants and prior Sessions', () => {
  const snapshot = state([{ ...person('current'), writer: writer('active') }])
  const result = combinePersonnelCounts(snapshot, projectPersonnelCounts(snapshot), full(snapshot))
  expect(result).toMatchObject({ historicalParticipants: { kind: 'known', value: 2, cursor: 7 },
    historicalActivations: { kind: 'known', value: 3, cursor: 7 }, nonterminatedPeople: 1, residentActors: 1 })
  const released = state([{ ...person('current'), writer: writer('released'),
    binding: simulationEntityBindingSchema.parse({ teamId: 'canonical', participantId: 'current', sessionId: 'new-session' }) }])
  const history = combinePersonnelCounts(released, projectPersonnelCounts(released), full(released)).historicalActivations
  expect(history).toMatchObject({ value: 3 })
})

it('rejects stale Native projection, unknown canonical scope and mismatched Team cursor or ownership', () => {
  const snapshot = state(), counts = projectPersonnelCounts(snapshot), source = full(snapshot)
  expect(() => combinePersonnelCounts({ ...snapshot, revision: 11 }, counts, source)).toThrow()
  expect(() => combinePersonnelCounts(snapshot, { ...counts, nonterminatedPeople: 1 }, source)).toThrow()
  expect(() => combinePersonnelCounts(snapshot, counts, { ...source, runId: simulationRunSpecSchema.parse({ ...snapshot.spec, runId: 'other' }).runId })).toThrow()
  expect(() => combinePersonnelCounts(snapshot, counts, { ...source, nativeCursor: 9 })).toThrow()
  expect(() => combinePersonnelCounts(snapshot, counts, { ...source, teamCursor: 6 })).toThrow()
  const { teamReservation: _reservation, ...unconfirmed } = snapshot
  expect(() => combinePersonnelCounts(unconfirmed, counts, source)).toThrow()
  const pendingTeam = { ...snapshot, teamReservation: { ...snapshot.teamReservation!, confirmed: false } }
  expect(() => combinePersonnelCounts(pendingTeam, counts, source)).toThrow()
  expect(() => combinePersonnelCounts(snapshot, counts, full(snapshot, { ...source.team,
    team: { ...source.team.team, id: teamIdSchema.parse('foreign') } }))).toThrow()
})

it('rejects duplicate and orphan history refs and retained writer identity substitutions', () => {
  const snapshot = state([{ ...person('current'), writer: writer('active') }]), counts = projectPersonnelCounts(snapshot)
  const original = team()
  for (const source of [
    { ...original, participants: [...original.participants, original.participants[0]!] },
    { ...original, activations: [...original.activations, original.activations[0]!] },
    { ...original, participants: original.participants.slice(1) },
    { ...original, activations: original.activations.slice(1) },
    { ...original, activations: original.activations.map((value, index) => index === 0
      ? { ...value, sessionId: original.activations[1]!.sessionId } : value) },
    { ...original, activations: original.activations.map((value, index) => index === 0 ? { ...value,
      reservationId: activationReservationIdSchema.parse('substitute') } : value) },
  ]) expect(() => combinePersonnelCounts(snapshot, counts, full(snapshot, source))).toThrow()
})

it('refuses impossible count subsets, unpaired source coverage and extra protocol fields', () => {
  const counts = projectPersonnelCounts(state())
  for (const value of [{ ...counts, assignedPeople: 1 }, { ...counts, residentActors: 1 },
    { ...counts, physicalProcesses: 0 }, { ...counts, historicalParticipants: { kind: 'known', value: 0, teamId: 'canonical', cursor: 1 } },
    { ...counts, historicalActivations: { kind: 'unknown', reason: 'unsupported' } }]) expect(() => personnelCountsSchema.parse(value)).toThrow()
})
