import { simulationNativeMigrationSchema } from '@clocky/clocky-simulation'
import { runControlRecordSchema, foldRunControl, assertRunControlAdmission } from './run-control.ts'
import { simulationDriverObservationSchema } from '@clocky/clocky-simulation'
import { simulationFederationTimeSchema } from '@clocky/clocky-simulation'
import { foldFederationTime } from './federation-time.ts'
import { simulationExperimentInitSchema } from '@clocky/clocky-simulation'
import { simulationGenerationTransitionSchema } from '@clocky/clocky-simulation'
import { foldGeneration } from './world-generation.ts'
import { foldCalendarCommand, calendarCommandRecordSchema } from './world-calendar-command.ts'
import { foldCalendarRevision } from './world-calendar.ts'
import { simulationCalendarRevisionRequestSchema } from '@clocky/clocky-simulation'
import { worldExecutionRecordSchema, foldWorldExecution } from './world-execution.ts'
import { worldEvidenceRecordSchema, foldWorldEvidence } from './world-evidence.ts'
import { installExistingHireDirectorChannel } from './world-hire-existing.ts'
import { installWorldRolePermissions } from './world-role-permissions.ts'
import { foldWorldBootstrap, worldBootstrapRecordSchema } from './world-bootstrap.ts'
import { externalRepresentativeRecordSchema, foldExternalRepresentative, externalRepresentativeCleanupReservation, externalRepresentativeChannelCleanup, externalContactChannelCleanup } from './world-external-actor.ts'
import { foldPersonnel, personnelRecordSchema } from './world-personnel.ts'
import { requireWorldRuntime } from './world-runtime.ts'
import { foldWorldMutation, worldMutationRecordSchema } from './world-mutation.ts'
import type { NativeWorldRuntime } from './world-runtime.ts'
import { worldRecordSchema, foldWorld } from './world.ts'
import { worldFactRecordSchema, foldWorldFact } from './world-facts.ts'
import { worldGovernanceRecordSchema, foldWorldGovernance } from './world-governance.ts'
import { requireWorld } from './world.ts'
import { worldHireRecordSchema, foldWorldHire, worldHireChannelCleanup, worldHireCleanupReservation } from './world-hire.ts'
import { existingHireResourcesRecordSchema, foldExistingHireResources } from './world-hiring-resources.ts'
import { maintenanceRecordSchema, foldMaintenance } from './maintenance.ts'
import { assertSimulationMaintenanceAdmission } from '@clocky/clocky-simulation'
import { assertSimulationWorldPreparationAdmission } from '@clocky/clocky-simulation'
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
export const SIMULATION_JOURNAL_VERSION = 102
/** Creation is the only record permitted at sequence zero. */
export const creationSchema = z.strictObject({
  kind: z.literal('run/created'),
  migration: simulationNativeMigrationSchema.optional(),
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
  z.strictObject({ kind: z.literal('run/control'), ...referenceFields, change: runControlRecordSchema }),
  z.strictObject({ kind: z.literal('run/driver-observation'), ...referenceFields, observation: simulationDriverObservationSchema }),
  z.strictObject({ kind: z.literal('run/federation-time'), ...referenceFields, evidence: simulationFederationTimeSchema }),
  z.strictObject({ kind: z.literal('run/branch-init'), ...referenceFields, request: simulationExperimentInitSchema }),
  z.strictObject({ kind: z.literal('run/generation'), ...referenceFields, change: simulationGenerationTransitionSchema }),
  z.strictObject({ kind: z.literal('run/calendar-command'), ...referenceFields, change: calendarCommandRecordSchema }),
  z.strictObject({ kind: z.literal('run/calendar-revision'), ...referenceFields, request: simulationCalendarRevisionRequestSchema, author: z.strictObject({ kind: z.literal('host'), principalId: z.string().min(1).nullable() }) }),
  z.strictObject({ kind: z.literal('run/world-execution'), ...referenceFields, change: worldExecutionRecordSchema }),
  z.strictObject({ kind: z.literal('run/world-evidence'), ...referenceFields, change: worldEvidenceRecordSchema }),
  z.strictObject({ kind: z.literal('run/world-bootstrap'), ...referenceFields, change: worldBootstrapRecordSchema }),
  z.strictObject({ kind: z.literal('run/external-representative'), ...referenceFields, change: externalRepresentativeRecordSchema }),
  z.strictObject({ kind: z.literal('run/world-governance'), ...referenceFields, change: worldGovernanceRecordSchema.options[2] }),
  z.strictObject({ kind: z.literal('run/world-facts'), ...referenceFields, change: worldFactRecordSchema }),
  phaseSchema,
  z.strictObject({ kind: z.literal('run/world'), ...referenceFields, change: worldRecordSchema }),
  z.strictObject({ kind: z.literal('run/personnel'), runId: simulationRunIdSchema, expectedRevision: z.number().int().nonnegative(), change: personnelRecordSchema }),
  z.strictObject({ kind: z.literal('run/world-mutation'), ...referenceFields, change: worldMutationRecordSchema }),
  z.strictObject({ kind: z.literal('run/world-hire'), ...referenceFields, change: worldHireRecordSchema }),
  z.strictObject({ kind: z.literal('run/existing-hire-resources'), ...referenceFields, change: existingHireResourcesRecordSchema }),
  z.strictObject({ kind: z.literal('run/maintenance'), ...referenceFields, change: maintenanceRecordSchema }),
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
 * @param runtime - Original explicit World parser/reducer catalog; absent only for base simulation operations.
 * @returns a fresh projection or throws for malformed/configuration-conflicting history.
 */
export function foldEntry(
  previous: SimulationSnapshot | undefined,
  entry: LogEntry,
  spec: SimulationRunSpec,
  backend: 'json' | 'sqlite',
  runtime?: NativeWorldRuntime,
): SimulationSnapshot {
  const next = fold(previous, entry, spec, backend, runtime)
  runtime?.observeMigrationEntry(entry)
  return next
}

/**
 * Fold a bounded batch with private entity dictionaries reused only across adjacent entity changes.
 * @param previous - Published input projection; it remains unchanged even when a later entry rejects.
 * @param entries - Untrusted contiguous records from a storage page or pending append.
 * @param spec - Exact caller configuration.
 * @param backend - Required storage medium.
 * @param runtime - Original explicit World parser/reducer catalog; absent only for base simulation operations.
 * @returns the final projection, with the same per-record validation as individual folds.
 */
export function foldEntries(previous: SimulationSnapshot, entries: readonly LogEntry[],
  spec: SimulationRunSpec, backend: 'json' | 'sqlite', runtime?: NativeWorldRuntime): SimulationSnapshot {
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
    state = fold(state, entry, spec, backend, runtime, update)
    runtime?.observeMigrationEntry(entry)
    if (lastEntitySequence !== entry.sequence) owned = undefined
  }
  return state
}

/** Validate one record before applying it with the caller's optional private entity updater. */
function fold(previous: SimulationSnapshot | undefined, entry: LogEntry, spec: SimulationRunSpec,
  backend: 'json' | 'sqlite', runtime: NativeWorldRuntime | undefined, update?: Parameters<typeof foldEntityChange>[2]): SimulationSnapshot {
  if (entry.sequence !== (previous === undefined ? 0 : previous.revision + 1)) {
    throw new Error('Simulation journal has a missing or noncontiguous prefix')
  }
  if (previous === undefined) {
    const created = creationSchema.parse(entry.value)
    if (created.migration !== undefined) {
      if (runtime === undefined) throw new Error('Native migration requires its exact installed context registry')
      runtime.configureMigration(created.migration)
    }
    if (!isDeepStrictEqual(created.spec, spec) || created.backend !== backend) {
      throw new Error('Simulation run configuration does not match its journal')
    }
    return { spec: created.spec, revision: entry.sequence, phase: 'paused', entities: {}, relations: {},
      time: simTimeSchema.parse('0'), nextDecisionSlot: simulationDecisionSlotSchema.parse('0'),
      decisions: {}, operations: {}, resources: {}, resourceReservations: {}, grants: {}, interactions: {}, commitments: {},
      nextEventSlot: simulationEventSlotSchema.parse('0'), scheduledEvents: {}, wakes: {} }
  }
  const record = recordSchema.parse(entry.value)
  if (record.runId !== spec.runId || record.expectedRevision !== previous.revision) {
    throw new Error('Simulation phase record has a different run or causal revision')
  }
  if (record.kind === 'run/driver-observation') {
    const observation = record.observation, prior = previous.driverObservation
    if (observation.status !== 'advancing' && (prior?.status !== 'advancing'
      || prior.ownerId !== observation.ownerId || prior.batchId !== observation.batchId))
      throw new Error('Driver terminal observation has no matching active owner batch')
    if (observation.status === 'failed' && observation.failure.revision > previous.revision)
      throw new Error('Driver failure references a future Native revision')
    return { ...previous, revision: entry.sequence, driverObservation: { ...observation, revision: entry.sequence } }
  }
  if (previous.worldBootstrap?.status === 'retained' && record.kind !== 'run/world-bootstrap'
    && record.kind !== 'run/management' && record.kind !== 'run/phase' && record.kind !== 'run/control')
    throw new Error('Original scenario initialization retains exclusive mutation admission')
  if (record.kind === 'run/control') return { ...foldRunControl(previous, record.change, entry.sequence, runtime), revision: entry.sequence }
  if (record.kind === 'run/federation-time') return { ...foldFederationTime(previous, record.evidence), revision: entry.sequence }
  if (record.kind === 'run/branch-init') {
    if (previous.revision !== 0 || previous.phase !== 'paused' || previous.experiment !== undefined
      || record.request.parentRunId === spec.runId || BigInt(record.request.budget.maxTime) !== BigInt(spec.maxTime)
      || record.request.budget.maxTokens !== spec.maxTokensPerInterval || BigInt(record.request.cutTime) > BigInt(spec.maxTime))
      throw new Error('Branch initialization requires an empty fresh namespace with its exact budget')
    return { ...previous, revision: entry.sequence, experiment: record.request, time: record.request.cutTime }
  }
  if (record.kind === 'run/channel-reserved') {
    assertSimulationWorldPreparationAdmission(previous, record.spec.members.map(member => member.entityId), record.spec.key)
    if (Object.values(previous.world?.reservations ?? {}).some(reservation =>
      reservation.identities.channels.some(channel => channel.key === record.spec.key || channel.channelId === record.channelId))) {
      throw new Error('World private channel identities require their original preparing transition')
    }
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
    const selected = previous.channelReservations?.[record.key]
    assertSimulationWorldPreparationAdmission(previous, selected?.spec.members.map(member => member.entityId) ?? [], record.key)
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
      || record.change.manifest.run.stream.name !== 'simulation' || record.change.manifest.run.stream.version !== (runtime?.journalVersion(entry.sequence) ?? SIMULATION_JOURNAL_VERSION))) {
      throw new Error('Checkpoint manifest names another run journal or format')
    }
    return { ...foldCheckpoint(previous, record.change, entry.sequence), revision: entry.sequence }
  }
  if (record.kind === 'run/generation') return { ...foldGeneration(previous, record.change, entry.sequence, runtime), revision: entry.sequence }
  if (record.kind === 'run/world-execution') return { ...foldWorldExecution(previous, record.change, entry.sequence, runtime), revision: entry.sequence }
  if (record.kind === 'run/calendar-command') return { ...foldCalendarCommand(previous, record.change, entry.sequence), revision: entry.sequence }
  if (record.kind === 'run/calendar-revision') return { ...foldCalendarRevision(previous, record.request, entry.sequence, record.author), revision: entry.sequence }
  if (record.kind === 'run/world-bootstrap') return { ...foldWorldBootstrap(previous, record.change, entry.sequence, runtime), revision: entry.sequence }
  if (record.kind === 'run/external-representative') return { ...foldExternalRepresentative(previous, record.change, entry.sequence, runtime), revision: entry.sequence }
  if (record.kind === 'run/world-facts') return { ...foldWorldFact(previous, record.change, entry.sequence), revision: entry.sequence }
  if (record.kind === 'run/world-governance') return { ...previous, revision: entry.sequence,
    world: { ...requireWorld(previous), governance: foldWorldGovernance(previous, requireWorld(previous).governance,
      record.change, entry.sequence) } }
  if (record.kind === 'run/personnel') return { ...foldPersonnel(previous, record.change, entry.sequence, requireWorldRuntime(runtime)), revision: entry.sequence }
  if (record.kind === 'run/world-mutation') {
    let next = foldWorldMutation(previous, record.change, entry.sequence, runtime)
    const request = next.world?.requests[record.change.mutation.requestId]
    if (request === undefined) throw new Error('Committed mutation lost its original role source')
    const intent = next.world?.intents[request.intentId]
    if (intent?.pin.domain === 'organization' && intent.pin.operation === 'hire-existing')
      next = installExistingHireDirectorChannel(next, request.intentId, entry.sequence)
    return { ...installWorldRolePermissions(next, request.intentId, entry.sequence), revision: entry.sequence }
  }
  if (record.kind === 'run/world-evidence') return { ...foldWorldEvidence(previous, record.change, entry.sequence, requireWorldRuntime(runtime)),
    revision: entry.sequence }
  if (record.kind === 'run/world') return { ...foldWorld(previous, record.change, entry.sequence, runtime), revision: entry.sequence }
  if (record.kind === 'run/world-hire') {
    const next = foldWorldHire(previous, record.change, entry.sequence, runtime)
    return { ...record.change.kind === 'hire/committed' ? installWorldRolePermissions(next, record.change.id, entry.sequence) : next,
      revision: entry.sequence }
  }
  if (record.kind === 'run/existing-hire-resources') return { ...foldExistingHireResources(previous, record.change, entry.sequence, runtime), revision: entry.sequence }
  if (record.kind === 'run/maintenance') return { ...foldMaintenance(previous, record.change, entry.sequence), revision: entry.sequence }
  if (record.kind === 'run/management') return { ...foldManagement(previous, record.change, entry.sequence), revision: entry.sequence }
  if (record.kind === 'run/outbox') return { ...foldOutboxRecord(previous, record.change, entry.sequence), revision: entry.sequence }
  if (record.kind === 'run/scheduler') return { ...foldSchedulerRecord(previous, record.change, entry.sequence, runtime), revision: entry.sequence }
  if (record.kind === 'run/business') return { ...foldBusinessRecord(previous, record.change, entry.sequence, runtime), revision: entry.sequence }
  if (record.kind === 'run/change') {
    if (previous.worldBootstrap?.status === 'retained') throw new Error('Original bootstrap must settle before generic administration')
    if (previous.activeWindowId !== undefined) throw new Error('Simulation administrative changes wait for the current window to close')
    return { ...foldEntityChange(previous, record.command, update), revision: entry.sequence }
  }
  if (record.phase === 'running') { assertSimulationMaintenanceAdmission(previous); assertRunControlAdmission(previous) }
  if (record.phase === 'running' && previous.worldBootstrap?.status === 'retained')
    throw new Error('Original scenario initialization must finish before running')
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
  if (record.phase === 'running' && Object.values(previous.world?.external.contacts ?? {}).some(contact => contact.status === 'cancel-requested'))
    throw new Error('Original contact withdrawal must settle before ordinary scheduling resumes')
  if (record.phase === 'running' && Object.values(previous.channelReservations ?? {}).some(channel =>
    !channel.confirmed && worldHireChannelCleanup(previous, channel) === undefined
    && externalRepresentativeChannelCleanup(previous, channel) === undefined
    && externalContactChannelCleanup(previous, channel) === undefined)) {
    throw new Error('Simulation channel invitations must finish before running')
  }
  if (record.phase === 'running' && Object.values(previous.entities).some(entity =>
    entity.participantReservation !== undefined && entity.binding === undefined
    && worldHireCleanupReservation(previous, entity.id) === undefined
    && externalRepresentativeCleanupReservation(previous, entity.id) === undefined)) {
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
  if (record.phase === 'running' && previous.activationAdmissionBlocks?.length) {
    throw new Error('Simulation frozen Activation history capacity requires a new scenario')
  }
  if (record.phase === 'running' && previous.stall?.code === 'SIM_WORLD_SUBMISSION_BLOCKED') {
    throw new Error('Simulation original rejected world submission requires inspection and a new scenario')
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
