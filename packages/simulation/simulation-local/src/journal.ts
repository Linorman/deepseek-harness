import { assertCanonicalTeam } from '@clocky/clocky-simulation'
import { checkpointRecordSchema, foldCheckpoint } from './checkpoints.ts'
import { managementRecordSchema, foldManagement, pendingManagement } from './management.ts'
import { simulationManagementIdSchema } from '@clocky/clocky-simulation'
/** Strict replay of the single authoritative run journal. @module @clocky/clocky-simulation-local/journal */
import { teamIdSchema, teamRootCreateInputSchema } from '@clocky/clocky-team'
import { channelIdSchema } from '@clocky/clocky-team'
import { simulationChannelKeySchema, simulationChannelSpecSchema } from '@clocky/clocky-simulation'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { simulationChangeSchema, simulationRunIdSchema, simulationRunSpecSchema, simulationEntityIdSchema, simulationEntityBindingSchema, simulationParticipantSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationRunSpec, SimulationSnapshot, SimulationEntity, SimulationEntityId } from '@clocky/clocky-simulation'
import type { LogEntry } from '@clocky/clocky-storage'
import { queueUsage } from './capacity.ts'
import { budgetUsage } from './budget.ts'
import { foldEntityChange } from './entities.ts'
import { foldWriterChange, writerChangeSchema } from './writers.ts'
import { foldOutboxRecord, outboxRecordSchema } from './outbox.ts'
import { foldSchedulerRecord, schedulerRecordSchema } from './scheduler.ts'
import { businessRecordSchema, foldBusinessRecord } from './decisions.ts'
import { simTimeSchema, simulationDecisionSlotSchema, simulationEventSlotSchema } from '@clocky/clocky-simulation'

/** Durable journal version; unsupported versions reject on open. */
export const SIMULATION_JOURNAL_VERSION = 36
/** Creation is the only record permitted at sequence zero. */
export const creationSchema = z.strictObject({
  kind: z.literal('run/created'),
  spec: simulationRunSpecSchema,
  backend: z.enum(['json', 'sqlite']),
})
const referenceFields = {
  runId: simulationRunIdSchema,
  expectedRevision: z.number().int().nonnegative(),
}
const phaseSchema = z.strictObject({
  kind: z.literal('run/phase'),
  ...referenceFields,
  phase: z.enum(['paused', 'running']),
  managementId: simulationManagementIdSchema.optional(),
})
const recordSchema = z.discriminatedUnion('kind', [
  phaseSchema,
  z.strictObject({ kind: z.literal('run/checkpoint'), ...referenceFields, change: checkpointRecordSchema }),
  z.strictObject({ kind: z.literal('run/management'), ...referenceFields, change: managementRecordSchema }),
  z.strictObject({ kind: z.literal('run/channel-reserved'), ...referenceFields, channelId: channelIdSchema, spec: simulationChannelSpecSchema }),
  z.strictObject({ kind: z.literal('run/channel-confirmed'), ...referenceFields, key: simulationChannelKeySchema, channelId: channelIdSchema }),
  z.strictObject({ kind: z.literal('run/participant-reserved'), ...referenceFields, entityId: simulationEntityIdSchema,
    binding: simulationEntityBindingSchema, participant: simulationParticipantSpecSchema }),
  z.strictObject({ kind: z.literal('run/team-reserved'), ...referenceFields, teamId: teamIdSchema, creation: teamRootCreateInputSchema }),
  z.strictObject({ kind: z.literal('run/team-confirmed'), ...referenceFields, teamId: teamIdSchema }),
  z.strictObject({ kind: z.literal('run/change'), ...referenceFields, command: simulationChangeSchema }),
  z.strictObject({ kind: z.literal('run/writer'), ...referenceFields, change: writerChangeSchema }),
  z.strictObject({ kind: z.literal('run/business'), ...referenceFields, change: businessRecordSchema }),
  z.strictObject({ kind: z.literal('run/scheduler'), ...referenceFields, change: schedulerRecordSchema }),
  z.strictObject({ kind: z.literal('run/outbox'), ...referenceFields, change: outboxRecordSchema }),
])

/**
 * Fold one contiguous storage entry without side effects.
 * @param previous - State at the previous sequence, absent before creation.
 * @param entry - Untrusted persisted value with backend-assigned sequence.
 * @param spec - Exact configuration requested by the caller.
 * @param backend - Explicit medium required by the composition.
 * @returns a fresh projection or throws for malformed/configuration-conflicting history.
 */
export function foldEntry(
  previous: SimulationSnapshot | undefined,
  entry: LogEntry,
  spec: SimulationRunSpec,
  backend: 'json' | 'sqlite',
): SimulationSnapshot {
  return fold(previous, entry, spec, backend)
}

/**
 * Fold a bounded batch with private entity dictionaries reused only across adjacent entity changes.
 * @param previous - Published input projection; it remains unchanged even when a later entry rejects.
 * @param entries - Untrusted contiguous records from a storage page or pending append.
 * @param spec - Exact caller configuration.
 * @param backend - Required storage medium.
 * @returns the final projection, with the same per-record validation as individual folds.
 */
export function foldEntries(previous: SimulationSnapshot, entries: readonly LogEntry[],
  spec: SimulationRunSpec, backend: 'json' | 'sqlite'): SimulationSnapshot {
  let state = previous
  let owned: Record<SimulationEntityId, SimulationEntity> | undefined
  let lastEntitySequence = -1
  const update = (current: SimulationSnapshot, entity: SimulationEntity): SimulationSnapshot => {
    lastEntitySequence = current.revision + 1
    if (owned === undefined || owned !== current.entities) owned = { ...current.entities }
    Object.defineProperty(owned, entity.id, { value: entity, enumerable: true, writable: true, configurable: true })
    return { ...current, entities: owned }
  }
  for (const entry of entries) {
    state = fold(state, entry, spec, backend, update)
    if (lastEntitySequence !== entry.sequence) owned = undefined
  }
  return state
}

/** Validate one record before applying it with the caller's optional private entity updater. */
function fold(previous: SimulationSnapshot | undefined, entry: LogEntry, spec: SimulationRunSpec,
  backend: 'json' | 'sqlite', update?: Parameters<typeof foldEntityChange>[2]): SimulationSnapshot {
  if (entry.sequence !== (previous === undefined ? 0 : previous.revision + 1)) {
    throw new Error('Simulation journal has a missing or noncontiguous prefix')
  }
  if (previous === undefined) {
    const created = creationSchema.parse(entry.value)
    if (!isDeepStrictEqual(created.spec, spec) || created.backend !== backend) {
      throw new Error('Simulation run configuration does not match its journal')
    }
    return { spec: created.spec, revision: entry.sequence, phase: 'paused', entities: {}, relations: {},
      time: simTimeSchema.parse('0'), nextDecisionSlot: simulationDecisionSlotSchema.parse('0'),
      decisions: {}, operations: {}, resources: {}, grants: {}, interactions: {}, commitments: {},
      nextEventSlot: simulationEventSlotSchema.parse('0'), scheduledEvents: {}, wakes: {} }
  }
  const record = recordSchema.parse(entry.value)
  if (record.runId !== spec.runId || record.expectedRevision !== previous.revision) {
    throw new Error('Simulation phase record has a different run or causal revision')
  }
  if (record.kind === 'run/channel-reserved') {
    if (previous.phase !== 'paused' || previous.activeWindowId !== undefined || previous.teamReservation?.confirmed !== true
      || Object.hasOwn(previous.channelReservations ?? {}, record.spec.key)
      || Object.values(previous.channelReservations ?? {}).some(value => value.channelId === record.channelId)
      || record.spec.members.some((member) => {
        const entity = Object.hasOwn(previous.entities, member.entityId) ? previous.entities[member.entityId] : undefined
        return entity?.phase !== 'active' || entity.cognition !== 'agent'
          || entity.binding?.teamId !== previous.teamReservation?.teamId
      })) throw new Error('Simulation channel reservation requires active bound members in its confirmed Team')
    return { ...previous, revision: entry.sequence, channelReservations: { ...previous.channelReservations,
      [record.spec.key]: { channelId: record.channelId, spec: record.spec, confirmed: false } } }
  }
  if (record.kind === 'run/channel-confirmed') {
    const reserved = Object.hasOwn(previous.channelReservations ?? {}, record.key) ? previous.channelReservations?.[record.key] : undefined
    if (reserved === undefined || reserved.confirmed || reserved.channelId !== record.channelId) {
      throw new Error('Simulation channel confirmation has no matching reservation')
    }
    return { ...previous, revision: entry.sequence, channelReservations: { ...previous.channelReservations,
      [record.key]: { ...reserved, confirmed: true } } }
  }
  if (record.kind === 'run/participant-reserved') {
    const entity = Object.hasOwn(previous.entities, record.entityId) ? previous.entities[record.entityId] : undefined
    if (previous.phase !== 'paused' || previous.activeWindowId !== undefined || previous.teamReservation?.confirmed !== true
      || previous.teamReservation.teamId !== record.binding.teamId || entity?.phase !== 'active'
      || entity.cognition !== 'agent' || entity.binding !== undefined || entity.participantReservation !== undefined
      || Object.values(previous.entities).some((other) => {
        const binding = other.participantReservation?.binding ?? other.binding
        return binding !== undefined && (binding.participantId === record.binding.participantId
          || binding.sessionId === record.binding.sessionId)
      })) throw new Error('Simulation participant reservation is not admissible')
    return { ...previous, revision: entry.sequence, entities: { ...previous.entities, [entity.id]: {
      ...entity, participantReservation: { binding: record.binding, participant: record.participant },
    } } }
  }
  if (record.kind === 'run/team-reserved') {
    if (previous.teamReservation !== undefined || previous.phase !== 'paused'
      || Object.values(previous.entities).some(entity => entity.binding !== undefined)
      || record.creation.rules['simulationRunId'] !== spec.runId
      || typeof record.creation.rules['activationLifecycleOwner'] !== 'string'
      || record.creation.rules['activationLifecycleOwner'].trim().length === 0
      || record.creation.rules['activationLifecycleOwner'].trim() !== record.creation.rules['activationLifecycleOwner']) throw new Error('Simulation Team reservation is not admissible')
    assertCanonicalTeam(previous, record.teamId)
    return { ...previous, revision: entry.sequence,
      teamReservation: { teamId: record.teamId, creation: record.creation, confirmed: false } }
  }
  if (record.kind === 'run/team-confirmed') {
    const reserved = previous.teamReservation
    if (reserved === undefined || reserved.confirmed || reserved.teamId !== record.teamId) throw new Error('Simulation Team confirmation has no matching reservation')
    return { ...previous, revision: entry.sequence, teamReservation: { ...reserved, confirmed: true } }
  }
  if (record.kind === 'run/writer') {
    const next = foldWriterChange(previous, record.change)
    if (record.change.kind !== 'writer/revoked') return { ...next, revision: entry.sequence }
    const { entityId, epoch } = record.change
    const active = Object.values(next.decisions).find(decision => (decision.status === 'open' || decision.status === 'submitted')
      && decision.entityId === entityId && decision.epoch === epoch)
    if (active !== undefined) {
      const cancelled = { ...next, decisions: { ...next.decisions, [active.id]: {
        ...active, status: 'cancelled' as const, cancellation: 'writer-revoked' as const, closedAt: entry.sequence,
      } }, revision: entry.sequence }
      if (cancelled.activeDecisionId === active.id) delete cancelled.activeDecisionId
      if (active.wakeId !== undefined) {
        const wake = next.wakes[active.wakeId]
        if (wake?.status !== 'claimed' || wake.decisionId !== active.id) throw new Error('Revoked decision lost its scheduled wake')
        const pending = { ...wake, status: 'pending' as const }
        delete pending.decisionId
        cancelled.wakes = { ...next.wakes, [wake.eventId]: pending }
      }
      return cancelled
    }
    return { ...next, revision: entry.sequence }
  }
  if (record.kind === 'run/checkpoint') {
    if (record.change.kind === 'checkpoint/published' && (record.change.manifest.run.backend !== backend
      || record.change.manifest.run.stream.name !== 'simulation' || record.change.manifest.run.stream.version !== SIMULATION_JOURNAL_VERSION)) {
      throw new Error('Checkpoint manifest names another run journal or format')
    }
    return { ...foldCheckpoint(previous, record.change, entry.sequence), revision: entry.sequence }
  }
  if (record.kind === 'run/management') return { ...foldManagement(previous, record.change, entry.sequence), revision: entry.sequence }
  if (record.kind === 'run/outbox') return { ...foldOutboxRecord(previous, record.change, entry.sequence), revision: entry.sequence }
  if (record.kind === 'run/scheduler') return { ...foldSchedulerRecord(previous, record.change, entry.sequence), revision: entry.sequence }
  if (record.kind === 'run/business') return { ...foldBusinessRecord(previous, record.change, entry.sequence), revision: entry.sequence }
  if (record.kind === 'run/change') {
    if (previous.activeWindowId !== undefined) throw new Error('Simulation administrative changes wait for the current window to close')
    return { ...foldEntityChange(previous, record.command, update), revision: entry.sequence }
  }
  const management = pendingManagement(previous)
  if (management !== undefined || record.managementId !== undefined) {
    if (management === undefined || record.managementId !== management.request.id || record.phase !== management.request.phase) {
      throw new Error('Simulation phase change must belong to its pending management request')
    }
  }
  if (record.phase === 'running' && Object.values(previous.checkpoints ?? {}).some(operation => operation.status === 'in-progress')) {
    throw new Error('Simulation checkpoint request must finish before resuming')
  }
  if (record.phase === 'running' && previous.teamReservation?.confirmed === false) {
    throw new Error('Simulation Team creation must be confirmed before running')
  }
  if (record.phase === 'running' && Object.values(previous.operations).some(operation =>
    operation.conflictRetry?.kind === 'exhausted' && !operation.conflictRetry.acknowledged)) {
    throw new Error('Simulation exhausted conflict requires acknowledgement before resuming')
  }
  if (record.phase === 'running' && Object.values(previous.channelReservations ?? {}).some(channel => !channel.confirmed)) {
    throw new Error('Simulation channel invitations must finish before running')
  }
  if (record.phase === 'running' && Object.values(previous.entities).some(entity =>
    entity.participantReservation !== undefined && entity.binding === undefined)) {
    throw new Error('Simulation participant provisioning must finish before running')
  }
  if (record.phase === 'running' && Object.values(previous.decisions).some(decision =>
    decision.status === 'open' && decision.context?.status === 'overflow')) {
    throw new Error('Simulation overflowing decision must be cancelled before resuming')
  }
  if (record.phase === 'running' && Object.values(previous.operations).some(operation => operation.deliveryFailure !== undefined
    && operation.deliveryFailure.resolution === undefined)) {
    throw new Error('Simulation failed delivery needs recipient reconciliation before resuming')
  }
  if (record.phase === 'running') {
    for (const reservation of Object.values(previous.tokenReservations ?? {})) {
      if (reservation.overrunAcknowledged === false) throw new Error('Simulation token overrun requires acknowledgement')
      const usage = budgetUsage(previous, reservation.interval).tokens
      if (usage.used > usage.limit) throw new Error('Simulation token usage requires additional interval budget')
    }
  }
  if (record.phase === 'running' && previous.stall !== undefined) {
    if (previous.stall.code === 'SIM_QUEUE_CAPACITY') {
      const usage = queueUsage(previous)[previous.stall.capacity]
      if (previous.stall.requested > usage.limit - usage.used) throw new Error('Simulation queue capacity must be freed or extended before resuming')
    }
    if (previous.stall.code === 'SIM_BUDGET_LIMIT') {
      const usage = budgetUsage(previous, previous.stall.interval)[previous.stall.budget]
      if (previous.stall.requested > usage.limit - usage.used) throw new Error('Simulation exhausted budget requires an explicit addition before resuming')
    }
    if (previous.stall.code === 'SIM_MICROSTEP_LIMIT' && previous.scheduledEvents[previous.stall.eventId]?.status === 'pending') {
      throw new Error('Simulation stalled event must be resolved before resuming')
    }
    if (previous.stall.code === 'SIM_OUTBOX_OUTCOME_UNKNOWN' && previous.operations[previous.stall.operationId]?.status === 'outcome-unknown') {
      throw new Error('Simulation unknown outbox outcome needs an explicit recovery decision')
    }
  }
  if (record.phase === previous.phase) throw new Error('Simulation journal repeats the current phase')
  const next = { ...previous, revision: entry.sequence, phase: record.phase }
  if (record.phase === 'running') delete next.stall
  return next
}
