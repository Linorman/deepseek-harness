import { liveActivationCapacity, liveActivationLimit } from '@clocky/clocky-team'
import { projectWorkspaceObservation, assertWorkspaceObservationSnapshot } from './workspace-observation.ts'
/** Pure replay folds for Team journals and channel WALs. @module @clocky/clocky-team-hub/fold */

import { isDeepStrictEqual } from 'node:util'
import {
  fingerprintChannelManifest,
  matchesTaskPlacement,
  taskChildTeamReservation,
  teamTaskRankingPolicySchema,
  assertActivationStatusTransition,
  assertChannelPhaseTransition,
  assertParticipantPhaseTransition,
  assertTeamGoalPhaseTransition,
  assertTeamPhaseTransition,
  assertTeamTaskPhaseTransition,
  deliveryIntentSchema,
  jsonObjectSchema,
  jsonValueSchema,
} from '@clocky/clocky-team'
import { workflowTerminalOutcome } from './workflow-outcomes.ts'
import type {
  ChannelId,
  ChannelSummaryIdempotencyKey,
  ChannelSummaryRecord,
  ChannelPostIdempotencyKey,
  ActivationId,
  ActivationBindingSnapshot,
  ChannelManifest,
  ChannelRecord,
  DeliveryIntent,
  EnvelopeId,
  JsonValue,
  ParticipantId,
  ParticipantSnapshot,
  ParticipantInterruptSnapshot,
  ParticipantInterruptTarget,
  TeamChannelAdapter,
  TeamAuthorityGrant,
  TeamTaskPlacement,
  TeamGoalSnapshot,
  TeamId,
  TeamHumanActionId,
  TeamHumanActionSnapshot,
  TeamInterruptId,
  TeamUsageSample,
  TeamUsageSampleId,
  TeamUsageCharge,
  TeamUsageChargeId,
  TeamUsageSnapshot,
  TeamWorkflowPlanId,
  TeamWorkflowPlanSnapshot,
  TeamTaskId,
  TeamTaskCommandCreator,
  TeamHumanTaskCreator,
  TeamTaskCreator,
  TaskAttemptOutcome,
  TaskAttemptSnapshot,
  TaskLeaseSnapshot,
  TeamTaskSnapshot,
  TeamTaskReviewDecision,
  TeamWorkspaceAllocationId,
  TeamWorkspaceAllocationSnapshot,
  TeamEnvelope,
  TeamFinalAdmission,
} from '@clocky/clocky-team'
import { TeamHubError } from './error.ts'
import type {
  ChannelProjection,
  ChannelProjectionData,
  ChannelPostIdempotencyData,
  PendingChannelDelivery,
  ChannelReceiptCursorData,
  PendingChannelDeliveryData,
  TeamJournalRecord,
  TeamProjection,
  TeamProjectionData,
  WorkflowPlanChangedJournalRecord,
  WorkspaceAllocationChangedJournalRecord,
} from './types.ts'

import { addTaskExecutionStats, recoverTaskExecutionStats } from './task-execution-stats.ts'

/**
 * Convert one mutable channel projection into its JSON-safe checkpoint form.
 * @param projection - live channel projection to detach for checkpoint storage.
 * @returns lossless checkpoint data without mutable maps.
 */
export function channelProjectionData(projection: ChannelProjection): ChannelProjectionData {
  return {
    invitations: [...projection.invitations.values()].map(value => structuredClone(value)),
    manifest: structuredClone(projection.manifest),
    phase: projection.phase,
    cursor: projection.cursor,
    state: structuredClone(projection.state),
    pendingDeliveries: [...projection.pendingDeliveries.entries()].flatMap(([participantId, deliveries]) =>
      [...deliveries.values()].map((delivery): PendingChannelDeliveryData => ({
        participantId,
        ...structuredClone(delivery),
      }))),
    receiptCursors: [...projection.receiptCursors.entries()].map(([participantId, cursor]): ChannelReceiptCursorData => ({
      participantId,
      cursor,
    })),
    postIdempotency: [...projection.postIdempotency.entries()].flatMap(([senderId, keys]) =>
      [...keys.entries()].map(([idempotencyKey, envelope]): ChannelPostIdempotencyData => ({
        senderId,
        idempotencyKey,
        envelope: structuredClone(envelope),
      }))),
    summaries: [...projection.summaries.values()].map(summary => structuredClone(summary)),
  }
}

/**
 * Rehydrate a mutable channel projection from an already-validated checkpoint value.
 * @param data - JSON-safe channel checkpoint data.
 * @returns mutable maps ready for later WAL folds.
 */
export function channelProjectionFromData(data: ChannelProjectionData): ChannelProjection {
  const members = new Set(data.manifest.participants.map(participant => participant.id))
  const pendingDeliveries = new Map<ParticipantId, Map<EnvelopeId, PendingChannelDelivery>>()
  const pendingSequences = new Map<ParticipantId, number>()
  for (const pending of data.pendingDeliveries) {
    if (!members.has(pending.participantId)) {
      throw malformedChannel(`channel checkpoint pending recipient '${pending.participantId}' is not a channel participant`)
    }
    if (pending.envelopeSequence > data.cursor) {
      throw malformedChannel(`channel checkpoint pending Envelope '${pending.envelopeId}' is beyond cursor ${data.cursor}`)
    }
    const priorSequence = pendingSequences.get(pending.participantId)
    if (priorSequence !== undefined && pending.envelopeSequence <= priorSequence) {
      throw malformedChannel(`channel checkpoint pending deliveries for '${pending.participantId}' are not in source order`)
    }
    const deliveries = pendingDeliveries.get(pending.participantId) ?? new Map<EnvelopeId, PendingChannelDelivery>()
    if (deliveries.has(pending.envelopeId)) {
      throw malformedChannel(`channel checkpoint repeats pending Envelope '${pending.envelopeId}' for '${pending.participantId}'`)
    }
    deliveries.set(pending.envelopeId, {
      envelopeId: pending.envelopeId,
      envelopeSequence: pending.envelopeSequence,
      delivery: pending.delivery,
      ...pending.expiresAt === undefined ? {} : { expiresAt: pending.expiresAt },
    })
    pendingDeliveries.set(pending.participantId, deliveries)
    pendingSequences.set(pending.participantId, pending.envelopeSequence)
  }
  const receiptCursors = new Map<ParticipantId, number>()
  for (const receipt of data.receiptCursors) {
    if (!members.has(receipt.participantId)) {
      throw malformedChannel(`channel checkpoint receipt recipient '${receipt.participantId}' is not a channel participant`)
    }
    if (receipt.cursor > data.cursor) {
      throw malformedChannel(`channel checkpoint receipt cursor ${receipt.cursor} exceeds channel cursor ${data.cursor}`)
    }
    if (receiptCursors.has(receipt.participantId)) {
      throw malformedChannel(`channel checkpoint repeats receipt cursor for '${receipt.participantId}'`)
    }
    receiptCursors.set(receipt.participantId, receipt.cursor)
  }
  const postIdempotency = new Map<ParticipantId, Map<ChannelPostIdempotencyKey, TeamEnvelope>>()
  const envelopeIds = new Set<EnvelopeId>()
  for (const entry of data.postIdempotency) {
    if (!members.has(entry.senderId)) {
      throw malformedChannel(`channel checkpoint idempotency sender '${entry.senderId}' is not a channel participant`)
    }
    if (entry.envelope.teamId !== data.manifest.teamId
      || entry.envelope.channelId !== data.manifest.id
      || entry.envelope.senderId !== entry.senderId
      || entry.envelope.sequence > data.cursor) {
      throw malformedChannel(`channel checkpoint idempotency key '${entry.idempotencyKey}' has an invalid Envelope relation`)
    }
    const keys = postIdempotency.get(entry.senderId) ?? new Map<ChannelPostIdempotencyKey, TeamEnvelope>()
    if (keys.has(entry.idempotencyKey)) {
      throw malformedChannel(`channel checkpoint repeats idempotency key '${entry.idempotencyKey}' for '${entry.senderId}'`)
    }
    if (envelopeIds.has(entry.envelope.id)) {
      throw malformedChannel(`channel checkpoint repeats idempotent Envelope '${entry.envelope.id}'`)
    }
    keys.set(entry.idempotencyKey, structuredClone(entry.envelope))
    postIdempotency.set(entry.senderId, keys)
    envelopeIds.add(entry.envelope.id)
  }
  const summaries = new Map<ChannelSummaryIdempotencyKey, ChannelSummaryRecord>()
  for (const summary of data.summaries) {
    if (summary.sequence > data.cursor || summary.coveredSequenceRange.to >= summary.sequence) {
      throw malformedChannel(`channel checkpoint summary '${summary.idempotencyKey}' has an invalid source range`)
    }
    if (summaries.has(summary.idempotencyKey)) {
      throw malformedChannel(`channel checkpoint repeats summary key '${summary.idempotencyKey}'`)
    }
    summaries.set(summary.idempotencyKey, structuredClone(summary))
  }
  return {
    invitations: restoreInvitations(data),
    manifest: structuredClone(data.manifest),
    phase: data.phase,
    cursor: data.cursor,
    state: structuredClone(data.state),
    pendingDeliveries,
    receiptCursors,
    postIdempotency,
    summaries,
  }
}

/**
 * Derive the durable replay lower bound from one folded channel projection.
 * Every recipient may skip only the source prefix before its earliest pending
 * Envelope; an exhausted projection can skip through its current cursor.
 * @param projection - current folded channel state.
 * @returns the highest source cursor safe for every recipient to skip.
 */
export function channelReplayWatermark(projection: ChannelProjection): number {
  let watermark = projection.cursor
  for (const deliveries of projection.pendingDeliveries.values()) {
    const earliest = [...deliveries.values()].reduce<number | undefined>(
      (minimum, delivery) => minimum === undefined ? delivery.envelopeSequence : Math.min(minimum, delivery.envelopeSequence),
      undefined,
    )
    if (earliest !== undefined) watermark = Math.min(watermark, earliest - 1)
  }
  return watermark
}

/**
 * Convert one mutable Team projection into its JSON-safe checkpoint form.
 * @param projection - current mutable Team projection.
 * @returns detached checkpoint data covering the projection cursor.
 */
export function teamProjectionData(projection: TeamProjection): TeamProjectionData {
  return {
    team: structuredClone(projection.team),
    finalAdmission: structuredClone(projection.finalAdmission),
    goal: structuredClone(projection.team.goal),
    rules: structuredClone(projection.rules),
    budgets: structuredClone(projection.budgets),
    participants: [...projection.participants.values()].map(participant => structuredClone(participant)),
    tasks: [...projection.tasks.values()].map(task => structuredClone(task)),
    taskExecutionStats: [...projection.taskExecutionStats.values()].map(stats => structuredClone(stats)),
    workspaceAllocations: [...projection.workspaceAllocations.values()].map(allocation => structuredClone(allocation)),
    activations: [...projection.activations.values()].map(binding => structuredClone(binding)),
    interrupts: [...projection.interrupts.values()].map(interrupt => structuredClone(interrupt)),
    humanActions: [...projection.humanActions.values()].map(action => structuredClone(action)),
    usage: structuredClone(projection.usage),
    usageSamples: [...projection.usageSamples.values()].map(sample => structuredClone(sample)),
    usageCharges: [...projection.usageCharges.values()].map(charge => structuredClone(charge)),
    pendingParentCharges: [...projection.pendingParentCharges.values()].map(charge => structuredClone(charge)),
    ...projection.workflowPlans.size === 0 ? {} : {
      workflowPlans: [...projection.workflowPlans.values()].map(plan => structuredClone(plan)),
    },
    channelIds: [...projection.channelIds],
  }
}

/**
 * Rehydrate a mutable Team projection from an already-validated checkpoint value.
 * @param data - JSON-safe checkpoint projection data.
 * @returns mutable lookup structures for subsequent durable folds.
 */
export function teamProjectionFromData(data: TeamProjectionData): TeamProjection {
  if (data.rules.taskRanking !== undefined) teamTaskRankingPolicySchema.parse(data.rules.taskRanking)
  if (!isDeepStrictEqual(data.team.goal, data.goal)) {
    throw malformedTeam('Team checkpoint duplicates a different current goal')
  }
  if (data.team.closure?.kind === 'complete') {
    if (data.team.phase !== 'quiescing' && data.team.phase !== 'stalled' && data.team.phase !== 'completed') {
      throw malformedTeam(`Team checkpoint '${data.team.id}' completion intent has invalid phase '${data.team.phase}'`)
    }
    if (data.team.goal.phase !== 'complete') {
      throw malformedTeam(`Team checkpoint '${data.team.id}' completion intent does not complete its objective`)
    }
  }
  if (data.team.closure?.kind === 'fail'
    && data.team.phase !== 'quiescing'
    && data.team.phase !== 'stalled'
    && data.team.phase !== 'failed') {
    throw malformedTeam(`Team checkpoint '${data.team.id}' failure intent has invalid phase '${data.team.phase}'`)
  }
  if (new Set(data.participants.map(participant => participant.id)).size !== data.participants.length) {
    throw malformedTeam('Team checkpoint repeats a participant identity')
  }
  if (new Set(data.tasks.map(task => task.id)).size !== data.tasks.length) {
    throw malformedTeam('Team checkpoint repeats a task identity')
  }
  if (new Set(data.workspaceAllocations.map(allocation => allocation.id)).size !== data.workspaceAllocations.length) {
    throw malformedTeam('Team checkpoint repeats a workspace allocation identity')
  }
  if (new Set(data.activations.map(binding => binding.activation.id)).size !== data.activations.length) {
    throw malformedTeam('Team checkpoint repeats an activation identity')
  }
  if (new Set(data.interrupts.map(interrupt => interrupt.id)).size !== data.interrupts.length) {
    throw malformedTeam('Team checkpoint repeats a participant interrupt identity')
  }
  if (new Set((data.humanActions ?? []).map(action => action.id)).size !== (data.humanActions ?? []).length) {
    throw malformedTeam('Team checkpoint repeats a human-action identity')
  }
  const channelIds = new Set(data.channelIds)
  if (channelIds.size !== data.channelIds.length) {
    throw malformedTeam('Team checkpoint repeats a channel identity')
  }
  if (new Set((data.workflowPlans ?? []).map(plan => plan.id)).size !== (data.workflowPlans ?? []).length) {
    throw malformedTeam('Team checkpoint repeats a workflow plan identity')
  }
  for (const participant of data.participants) {
    if (participant.teamId !== data.team.id) throw malformedTeam(`Team checkpoint participant '${participant.id}' has a foreign Team`)
    if (participant.authorityGrant !== undefined && data.team.authorityGrant !== undefined) {
      assertFoldAuthorityGrantSubset(data.team.authorityGrant, participant.authorityGrant, `participant '${participant.id}'`)
    }
  }
  assertDistinctActiveHumanOwners(data.participants)
  for (const task of data.tasks) {
    if (task.teamId !== data.team.id) throw malformedTeam(`Team checkpoint task '${task.id}' has a foreign Team`)
  }
  const participants = new Map(data.participants.map(participant => [participant.id, structuredClone(participant)]))
  const tasks = new Map(data.tasks.map(task => [task.id, structuredClone(task)]))
  for (const task of tasks.values()) {
    if (task.delegation?.result !== undefined && task.delegation.result.parentCursor > data.team.cursor) {
      throw malformedTeam(`Team checkpoint task '${task.id}' result admission exceeds its journal cursor`)
    }
  }
  for (const task of tasks.values()) {
    assertDistinct(task.blockedBy, `Team checkpoint task '${task.id}' repeats a blocker`)
    assertDistinct(task.requiredCapabilities, `Team checkpoint task '${task.id}' repeats a required capability`)
    assertDistinct(task.readScopes, `Team checkpoint task '${task.id}' repeats a read scope`)
    assertDistinct(task.writeScopes, `Team checkpoint task '${task.id}' repeats a write scope`)
  }
  assertTaskGraph(tasks)
  const activations = new Map<ActivationId, ActivationBindingSnapshot>()
  const sessionIds = new Map<ParticipantId, ActivationBindingSnapshot['sessionId']>()
  const residentParticipants = new Set<ParticipantId>()
  for (const binding of data.activations) {
    const participant = participants.get(binding.activation.participantId)
    if (binding.activation.teamId !== data.team.id || participant === undefined || !isAgentParticipant(participant)) {
      throw malformedTeam(`Team checkpoint activation '${binding.activation.id}' has an invalid participant relation`)
    }
    if (binding.fencedAt !== undefined) {
      const requestedAt = data.team.cancellation?.requestedAt ?? data.team.closure?.requestedAt
      if (requestedAt === undefined || binding.fencedAt < data.team.createdAt
        || binding.fencedAt < requestedAt || binding.fencedAt > data.team.updatedAt) {
        throw malformedTeam(`Team checkpoint activation '${binding.activation.id}' has no closure-owned fence proof`)
      }
    }
    if (binding.quiescedAt !== undefined
      && (binding.quiescedAt < data.team.createdAt || binding.quiescedAt > data.team.updatedAt)) {
      throw malformedTeam(`Team checkpoint activation '${binding.activation.id}' has a quiescence proof outside its Team lifetime`)
    }
    const previousSessionId = sessionIds.get(binding.activation.participantId)
    if (previousSessionId !== undefined && previousSessionId !== binding.sessionId) {
      throw malformedTeam(`Team checkpoint activation '${binding.activation.id}' changes the participant Session`)
    }
    sessionIds.set(binding.activation.participantId, binding.sessionId)
    if (binding.activation.status !== 'offline') {
      if (residentParticipants.has(binding.activation.participantId)) {
        throw malformedTeam(`Team checkpoint has multiple resident activations for '${binding.activation.participantId}'`)
      }
      residentParticipants.add(binding.activation.participantId)
    }
    activations.set(binding.activation.id, structuredClone(binding))
  }
  const workspaceAllocations = new Map<TeamWorkspaceAllocationId, TeamWorkspaceAllocationSnapshot>()
  const allocationAttempts = new Set<string>()
  for (const allocation of data.workspaceAllocations) {
    assertWorkspaceAllocationRelation(data.team.id, tasks, activations, allocation, false)
    const task = tasks.get(allocation.taskId)
    if (task === undefined) throw malformedTeam('Workspace checkpoint observation has no task')
    assertWorkspaceObservationSnapshot(allocation, task, data.team.updatedAt)
    const attemptKey = workspaceAttemptKey(allocation)
    if (allocationAttempts.has(attemptKey)) {
      throw malformedTeam(`Team checkpoint repeats workspace allocation for task attempt '${allocation.attemptId}'`)
    }
    allocationAttempts.add(attemptKey)
    workspaceAllocations.set(allocation.id, structuredClone(allocation))
  }
  const interrupts = new Map<TeamInterruptId, ParticipantInterruptSnapshot>()
  for (const interrupt of data.interrupts) {
    assertInterruptRelation(data.team.id, participants, activations, interrupt.target)
    if (!participants.has(interrupt.actorId)) {
      throw malformedTeam(`Team checkpoint interrupt '${interrupt.id}' names an unknown actor`)
    }
    interrupts.set(interrupt.id, structuredClone(interrupt))
  }
  const humanActions = new Map<TeamHumanActionId, TeamHumanActionSnapshot>()
  for (const action of data.humanActions ?? []) {
    if (action.teamId !== data.team.id) throw malformedTeam(`Team checkpoint human action '${action.id}' has a foreign Team`)
    const participant = participants.get(action.participantId)
    if (participant === undefined) throw malformedTeam(`Team checkpoint human action '${action.id}' names an unknown participant`)
    if (action.taskId !== undefined && !tasks.has(action.taskId)) {
      throw malformedTeam(`Team checkpoint human action '${action.id}' names an unknown task`)
    }
    if (action.response !== undefined && participants.get(action.response.respondedBy)?.kind !== 'human') {
      throw malformedTeam(`Team checkpoint human action '${action.id}' names an unknown human responder`)
    }
    humanActions.set(action.id, structuredClone(action))
  }
  const usage = data.usage ?? zeroUsage()
  const usageSamples = new Map<TeamUsageSampleId, TeamUsageSample>()
  for (const sample of data.usageSamples ?? []) {
    if (sample.teamId !== data.team.id) throw malformedTeam(`Team checkpoint usage sample '${sample.id}' has a foreign Team`)
    const participant = participants.get(sample.participantId)
    if (participant === undefined) throw malformedTeam(`Team checkpoint usage sample '${sample.id}' names an unknown participant`)
    if (usageSamples.has(sample.id)) throw malformedTeam(`Team checkpoint repeats usage sample '${sample.id}'`)
    usageSamples.set(sample.id, structuredClone(sample))
  }
  const usageCharges = new Map<TeamUsageChargeId, TeamUsageCharge>()
  for (const charge of data.usageCharges ?? []) {
    assertCheckpointUsageCharge(data.team, usageCharges, charge)
    if (tasks.get(charge.parentTaskId)?.delegation?.childTeamId !== charge.sourceTeamId) throw malformedTeam(`Team checkpoint child charge '${charge.id}' has no matching task reservation`)
    usageCharges.set(charge.id, structuredClone(charge))
  }
  const pendingParentCharges = new Map<TeamUsageChargeId, TeamUsageCharge>()
  for (const charge of data.pendingParentCharges ?? []) {
    if (data.team.parentTeamId === undefined) {
      throw malformedTeam(`Team checkpoint '${data.team.id}' has a pending parent charge without a parent Team`)
    }
    if (charge.sourceTeamId !== data.team.id || charge.parentTaskId !== data.team.parentTaskId) {
      throw malformedTeam(`Team checkpoint pending charge '${charge.id}' has a foreign source Team`)
    }
    if (pendingParentCharges.has(charge.id)) {
      throw malformedTeam(`Team checkpoint repeats pending parent charge '${charge.id}'`)
    }
    pendingParentCharges.set(charge.id, structuredClone(charge))
  }
  const workflowPlans = new Map<TeamWorkflowPlanId, TeamWorkflowPlanSnapshot>()
  for (const plan of data.workflowPlans ?? []) {
    assertWorkflowPlanSnapshot(plan, data.team.id, participants, activations)
    workflowPlans.set(plan.id, structuredClone(plan))
  }
  for (const task of tasks.values()) assertWorkflowTaskRelation(task, workflowPlans, false)
  for (const plan of workflowPlans.values()) assertWorkflowPlanBindings(plan, tasks, channelIds)
  if (data.usageSamples !== undefined || data.usageCharges !== undefined) {
    if (!isDeepStrictEqual(usage, usageFromSamplesAndCharges(usageSamples, usageCharges))) {
      throw malformedTeam('Team checkpoint usage aggregate does not match samples and child charges')
    }
  }
  const taskExecutionStats = recoverTaskExecutionStats([...tasks.values()], data.rules)
  const retainedStats = new Map((data.taskExecutionStats ?? [])
    .map(stats => [JSON.stringify([stats.participantId, stats.requiredCapabilities]), stats]))
  if (data.taskExecutionStats !== undefined || data.rules.taskRanking !== undefined) {
    if (retainedStats.size !== data.taskExecutionStats?.length || !isDeepStrictEqual(retainedStats, taskExecutionStats)) {
      throw malformedTeam('Team checkpoint task execution statistics differ from retained attempts')
    }
  }
  const projection: TeamProjection = {
    finalAdmission: structuredClone(data.finalAdmission),
    team: structuredClone(data.team),
    rules: structuredClone(data.rules),
    budgets: structuredClone(data.budgets),
    participants,
    taskExecutionStats,
    tasks,
    workspaceAllocations,
    activations,
    interrupts,
    humanActions,
    usage,
    usageSamples,
    usageCharges,
    pendingParentCharges,
    workflowPlans,
    channelIds,
  }
  if (projection.finalAdmission !== null) assertFinalAdmission(projection, projection.finalAdmission, projection.team.updatedAt)
  if (projection.team.childRun !== undefined) assertChildRunBinding(projection, projection.team.childRun)
  if (projection.team.childResultAdmission !== undefined) {
    assertChildResultAdmission(projection, projection.team.childResultAdmission)
    if (projection.team.childResultAdmission.admittedAt > projection.team.updatedAt) {
      throw malformedTeam('child result admission exceeds its Team lifetime')
    }
  }
  for (const task of tasks.values()) {
    assertTaskCreateProvenance(projection, task, false)
    assertTaskOwnerProposal(projection, task)
    assertCheckpointTaskAttempts(projection, task)
  }
  assertTaskCancellationSettlements(projection)
  assertChildTeamReservations(projection)
  assertActivationCapacity(projection)
  assertDistinctCurrentWakeChannels(projection)
  for (const binding of activations.values()) assertQuiescenceProof(projection, binding)
  assertTerminalTeamResources(projection)
  return projection
}

/**
 * Apply one parsed Team journal record at its durable storage cursor.
 * @param previous - prior projection, or `undefined` before the first record.
 * @param record - validated next Team journal record.
 * @param cursor - storage cursor assigned to `record`.
 * @param streamTeamId - Team identity encoded by the owning stream name.
 * @returns the next mutable Team projection, with every Team-owned resource settled whenever its phase is terminal.
 * @throws {@link TeamHubError} when the record violates a durable resource relationship.
 */
export function foldTeamRecord(
  previous: TeamProjection | undefined,
  record: TeamJournalRecord,
  cursor: number,
  streamTeamId: TeamId,
): TeamProjection {
  const projection = foldTeamRecordValue(previous, record, cursor, streamTeamId)
  assertTerminalTeamResources(projection)
  return projection
}

/** Derive the next record projection before checking terminal Team resource relationships. */
function foldTeamRecordValue(
  previous: TeamProjection | undefined,
  record: TeamJournalRecord,
  cursor: number,
  streamTeamId: TeamId,
): TeamProjection {
  if (previous === undefined) {
    if (cursor !== 0 || record.type !== 'team/created') {
      throw malformedTeam('first record must be team/created at cursor 0')
    }
    if (record.teamId !== streamTeamId) {
      throw malformedTeam(`stream '${streamTeamId}' starts with Team '${record.teamId}'`)
    }
    assertTeamLineage(record)
    assertTeamTransition(() => { assertTeamPhaseTransition(undefined, 'provisioning') })
    assertInitialGoal(record.teamId, record.goal)
    const workspacePath = record.rules.workspacePath
    if (workspacePath !== undefined && (typeof workspacePath !== 'string' || workspacePath.length === 0)) {
      throw malformedTeam('Team workspacePath rule must be a non-empty string')
    }
    if (record.rules.taskRanking !== undefined) teamTaskRankingPolicySchema.parse(record.rules.taskRanking)
    return {
      team: {
        id: record.teamId,
        ...record.parentTeamId === undefined ? {} : {
          parentTeamId: record.parentTeamId,
          parentTaskId: record.parentTaskId,
        },
        depth: record.depth,
        maxTeamDepth: record.maxTeamDepth,
        goal: structuredClone(record.goal),
        ...workspacePath === undefined ? {} : { workspacePath },
        phase: 'provisioning',
        cursor,
        createdAt: record.createdAt,
        updatedAt: record.createdAt,
        ...record.authorityGrant === undefined ? {} : { authorityGrant: structuredClone(record.authorityGrant) },
        ...record.createdBy === undefined ? {} : { createdBy: structuredClone(record.createdBy) },
      },
      rules: structuredClone(record.rules),
      budgets: structuredClone(record.budgets),
      participants: new Map(),
      tasks: new Map(),
      taskExecutionStats: new Map(),
      workspaceAllocations: new Map(),
      activations: new Map(),
      interrupts: new Map(),
      humanActions: new Map(),
      usage: zeroUsage(),
      usageSamples: new Map(),
      usageCharges: new Map(),
      pendingParentCharges: new Map(),
      workflowPlans: new Map(),
      finalAdmission: null,
      channelIds: new Set(),
    }
  }
  if (cursor !== previous.team.cursor + 1) {
    throw malformedTeam(`cursor ${cursor} does not follow ${previous.team.cursor}`)
  }
  assertTimestamp(previous.team.updatedAt, record.createdAt, 'Team journal')
  if (previous.team.archivedAt !== undefined && record.type !== 'team/archived') {
    throw malformedTeam(`Team '${streamTeamId}' has records after archival`)
  }
  if (previous.team.closure !== undefined) {
    if (record.type !== 'team/final-admitted'
      && record.type !== 'team/child-result-admitted'
      && record.type !== 'team/closure'
      && record.type !== 'team/phase'
      && record.type !== 'team/archived'
      && record.type !== 'goal/changed'
      && record.type !== 'participant/changed'
      && record.type !== 'task/changed'
      && record.type !== 'workspace-allocation/changed'
      && record.type !== 'workspace/observed'
      && record.type !== 'activation/changed'
      && record.type !== 'participant-interrupt/acknowledged'
      && record.type !== 'human-action/changed'
      && record.type !== 'workflow-plan/changed'
      && record.type !== 'usage/parent-charge-settled') {
      throw malformedTeam(`Team '${streamTeamId}' has business records after its closure intent`)
    }
    if (previous.team.closure.kind !== 'cancel') {
      assertClosureCleanupRecord(previous, record, streamTeamId)
    }
  }
  if (previous.team.cancellation !== undefined
    && record.type !== 'team/cancellation'
    && record.type !== 'team/closure'
    && record.type !== 'team/phase'
    && record.type !== 'team/archived'
    && record.type !== 'participant/changed'
      && record.type !== 'task/changed'
    && record.type !== 'workspace-allocation/changed'
    && record.type !== 'workspace/observed'
    && record.type !== 'activation/changed'
    && record.type !== 'participant-interrupt/acknowledged'
    && record.type !== 'human-action/changed'
    && record.type !== 'usage/changed'
    && record.type !== 'usage/parent-charge-pending'
        && record.type !== 'usage/child-charged'
        && record.type !== 'usage/parent-charge-settled'
        && record.type !== 'workflow-plan/changed') {
    throw malformedTeam(`Team '${streamTeamId}' has unsupported records after its cancellation request`)
  }
  const team = { ...previous.team, cursor, updatedAt: record.createdAt }
  switch (record.type) {
    case 'team/created':
      throw malformedTeam('team/created appears after the first record')
    case 'team/child-run-bound':
      if (previous.team.phase !== 'active' || previous.team.childRun !== undefined) {
        throw malformedTeam('child runtime endpoints must be bound once during active creation')
      }
      assertChildRunBinding(previous, record.binding)
      return { ...previous, team: { ...team, childRun: structuredClone(record.binding) } }
    case 'team/child-result-admitted':
      if (previous.team.childResultAdmission !== undefined || previous.finalAdmission !== null
        || previous.team.cancellation !== undefined || previous.team.closure?.kind === 'fail') {
        throw malformedTeam('child result admission must be unique and cannot replace human or cancelled work')
      }
      assertChildResultAdmission(previous, record.admission)
      if (record.admission.admittedAt !== record.createdAt) throw malformedTeam('child result admission timestamp differs from its record')
      return { ...previous, team: { ...team, childResultAdmission: structuredClone(record.admission) } }
    case 'team/final-admitted':
      if (previous.team.parentTeamId !== undefined) throw malformedTeam('a child Team cannot accept a human final result')
      if (previous.finalAdmission !== null) throw malformedTeam('Team has more than one final admission')
      if (previous.team.phase !== 'active' && previous.team.phase !== 'quiescing' && previous.team.phase !== 'stalled'
        || previous.team.closure?.kind === 'fail') {
        throw malformedTeam('Team final admission requires active work or its accepted completion intent')
      }
      assertFinalAdmission(previous, record.admission, record.createdAt)
      return { ...previous, team, finalAdmission: structuredClone(record.admission) }
    case 'team/closure':
      if (previous.team.closure !== undefined) {
        throw malformedTeam(`Team '${streamTeamId}' has more than one closure intent`)
      }
      if (record.closure.kind === 'cancel' && previous.team.cancellation === undefined) {
        throw malformedTeam(`Team '${streamTeamId}' cannot close without a durable cancellation request`)
      }
      if (record.closure.kind !== 'cancel' && previous.team.cancellation !== undefined) {
        throw malformedTeam(`Team '${streamTeamId}' cannot request ${record.closure.kind} after cancellation`)
      }
      if (record.closure.teamId !== streamTeamId) {
        throw malformedTeam(`Team closure belongs to '${record.closure.teamId}', not '${streamTeamId}'`)
      }
      if (record.closure.kind === 'complete'
        && previous.team.phase !== 'active'
        && previous.team.phase !== 'quiescing') {
        throw malformedTeam(`Team '${streamTeamId}' cannot request completion from '${previous.team.phase}'`)
      }
      if (record.closure.kind !== 'complete'
        && previous.team.phase !== 'provisioning'
        && previous.team.phase !== 'active'
        && previous.team.phase !== 'quiescing'
        && previous.team.phase !== 'stalled') {
        throw malformedTeam(`Team '${streamTeamId}' cannot request ${record.closure.kind} from '${previous.team.phase}'`)
      }
      return { ...previous, team: { ...team, closure: structuredClone(record.closure) } }
    case 'team/cancellation':
      if (previous.team.cancellation !== undefined) {
        throw malformedTeam(`Team '${streamTeamId}' has more than one cancellation request`)
      }
      if (record.cancellation.teamId !== streamTeamId) {
        throw malformedTeam(`Team cancellation belongs to '${record.cancellation.teamId}', not '${streamTeamId}'`)
      }
      if (previous.team.phase !== 'provisioning'
        && previous.team.phase !== 'active'
        && previous.team.phase !== 'quiescing'
        && previous.team.phase !== 'stalled') {
        throw malformedTeam(`Team '${streamTeamId}' cannot request cancellation from '${previous.team.phase}'`)
      }
      return { ...previous, team: { ...team, cancellation: structuredClone(record.cancellation) } }
    case 'team/phase':
      if (previous.team.closure !== undefined) {
        const closure = previous.team.closure
        const terminal = closure.kind === 'complete'
          ? 'completed'
          : closure.kind === 'fail'
            ? 'failed'
            : 'cancelled'
        const allowed = closure.kind === 'cancel'
          ? record.phase === terminal
          : previous.team.phase === 'quiescing'
            ? record.phase === terminal || record.phase === 'stalled'
            : record.phase === 'quiescing' || previous.team.phase === 'stalled' && record.phase === 'stalled'
        if (!allowed) {
          throw malformedTeam(`Team '${streamTeamId}' closure '${closure.kind}' cannot transition to '${record.phase}'`)
        }
        if (record.phase === 'completed' && previous.team.goal.phase !== 'complete') {
          throw malformedTeam(`Team '${streamTeamId}' cannot complete before its objective is complete`)
        }
      }
      if (previous.team.cancellation !== undefined) {
        const allowed = record.phase === 'quiescing' || record.phase === 'stalled' || record.phase === 'cancelled'
        if (!allowed) {
          throw malformedTeam(`Team '${streamTeamId}' cancellation cannot transition to '${record.phase}'`)
        }
        if (record.phase === 'cancelled' && previous.team.closure?.kind !== 'cancel') {
          throw malformedTeam(`Team '${streamTeamId}' cannot reach cancelled before its closure record`)
        }
      }
      if (previous.team.phase !== 'stalled' || record.phase !== 'stalled') {
        assertTeamTransition(() => { assertTeamPhaseTransition(previous.team.phase, record.phase) })
      }
      const { stallReason: _stallReason, ...teamWithoutStallReason } = team
      return {
        ...previous,
        team: {
          ...teamWithoutStallReason,
          phase: record.phase,
          ...record.phase === 'stalled' && record.reason !== undefined
            ? { stallReason: structuredClone(record.reason) }
            : {},
        },
      }
    case 'team/archived':
      if (previous.team.phase !== 'completed' && previous.team.phase !== 'failed' && previous.team.phase !== 'cancelled') {
        throw malformedTeam(`Team '${streamTeamId}' cannot be archived from '${previous.team.phase}'`)
      }
      if (previous.team.archivedAt !== undefined) throw malformedTeam(`Team '${streamTeamId}' is archived twice`)
      return { ...previous, team: { ...team, archivedAt: record.createdAt } }
    case 'goal/changed':
      if (previous.team.closure !== undefined
        && (previous.team.closure.kind !== 'complete' || record.goal.phase !== 'complete')) {
        throw malformedTeam(`Team '${streamTeamId}' closure does not permit this goal change`)
      }
      return foldGoal(previous, record, team, streamTeamId)
    case 'participant/changed':
      return foldParticipant(previous, record, team, streamTeamId)
    case 'task/changed':
      return foldTask(previous, record, team, streamTeamId)
    case 'workspace/observed': {
      const allocation = previous.workspaceAllocations.get(record.observation.allocationId)
      const task = allocation === undefined ? undefined : previous.tasks.get(allocation.taskId)
      if (allocation === undefined || task === undefined) throw malformedTeam('Workspace observation has no owning allocation or task')
      const { taskId: _taskId, attemptId: _attemptId, truncated: _truncated, observedAt: _observedAt, paths, ...input } = record.observation
      const expected = projectWorkspaceObservation(allocation, task,
        { ...input, paths: paths.map(({ path, change }) => ({ path, change })) }, record.createdAt)
      if (!isDeepStrictEqual(expected, record.observation)) throw malformedTeam('Workspace observation does not match its allocation, window or scope')
      const workspaceAllocations = new Map(previous.workspaceAllocations)
      workspaceAllocations.set(allocation.id, { ...allocation, observation: structuredClone(record.observation) })
      return { ...previous, team, workspaceAllocations }
    }
    case 'workspace-allocation/changed':
      return foldWorkspaceAllocation(previous, record, team, streamTeamId)
    case 'activation/changed':
      return foldActivation(previous, record, team, streamTeamId)
    case 'participant-interrupt/requested':
      return foldParticipantInterruptRequest(previous, record, team, streamTeamId)
    case 'participant-interrupt/acknowledged':
      return foldParticipantInterruptAcknowledgement(previous, record, team, streamTeamId)
    case 'human-action/changed':
      return foldHumanAction(previous, record, team, streamTeamId)
    case 'usage/changed':
      return foldUsage(previous, record, team, streamTeamId)
    case 'usage/parent-charge-pending':
      return foldParentChargePending(previous, record, team, streamTeamId)
    case 'usage/child-charged':
      return foldChildCharge(previous, record, team, streamTeamId)
    case 'usage/parent-charge-settled':
      return foldParentChargeSettled(previous, record, team, streamTeamId)
    case 'workflow-plan/changed':
      return foldWorkflowPlan(previous, record, team, streamTeamId)
    case 'channel/attached':
      if (previous.channelIds.has(record.channelId)) {
        throw malformedTeam(`channel '${record.channelId}' is attached twice`)
      }
      return {
        ...previous,
        team,
        channelIds: new Set([...previous.channelIds, record.channelId]),
      }
    case 'policy/denied':
      return { ...previous, team }
    /* v8 ignore next 2 -- TeamJournalRecord is closed and all discriminants are handled above. */
    default:
      return assertNever(record)
  }
}

/** Journal kinds admitted after closure intent, before resource-specific cleanup checks. */
type ClosureCleanupRecord = Exclude<TeamJournalRecord, { readonly type:
  | 'team/created'
  | 'team/cancellation'
  | 'participant-interrupt/requested'
  | 'channel/attached'
  | 'usage/changed'
  | 'usage/parent-charge-pending'
  | 'usage/child-charged'
  | 'policy/denied'
}>

/** Reject new or reopening business work after a non-cancellation closure intent. */
function assertClosureCleanupRecord(
  previous: TeamProjection,
  record: ClosureCleanupRecord,
  streamTeamId: TeamId,
): void {
  switch (record.type) {
    case 'participant/changed':
      assertReservationRelease(previous.participants.get(record.participant.id), record.participant)
      return
    case 'task/changed': {
      if (!previous.tasks.has(record.task.id)
        || (record.task.phase !== 'completed'
          && record.task.phase !== 'failed'
          && record.task.phase !== 'cancelled'
          && record.task.phase !== 'deleted')) {
        throw malformedTeam(`Team '${streamTeamId}' closure cleanup cannot create or reopen task '${record.task.id}'`)
      }
      return
    }
    case 'workspace/observed':
      if (record.observation.stage !== 'release') throw malformedTeam('Closure cleanup only admits release workspace observations')
      return
    case 'workspace-allocation/changed': {
      if (!previous.workspaceAllocations.has(record.allocation.id)
        || (record.allocation.lifecycle !== 'release-requested'
          && record.allocation.lifecycle !== 'released'
          && record.allocation.lifecycle !== 'preserved')) {
        throw malformedTeam(`Team '${streamTeamId}' closure cleanup cannot create or reactivate workspace allocation '${record.allocation.id}'`)
      }
      return
    }
    case 'activation/changed': {
      if (!previous.activations.has(record.binding.activation.id)
        || (record.binding.activation.status !== 'stopping' && record.binding.activation.status !== 'offline')) {
        throw malformedTeam(`Team '${streamTeamId}' closure cleanup cannot create or reactivate activation '${record.binding.activation.id}'`)
      }
      return
    }
    case 'human-action/changed': {
      if (!previous.humanActions.has(record.action.id)
        || (record.action.phase !== 'resolved' && record.action.phase !== 'cancelled')) {
        throw malformedTeam(`Team '${streamTeamId}' closure cleanup cannot create or reopen human action '${record.action.id}'`)
      }
      return
    }
    case 'workflow-plan/changed': {
      if (!previous.workflowPlans.has(record.plan.id)
        || (record.plan.phase !== 'completed' && record.plan.phase !== 'failed' && record.plan.phase !== 'cancelled')) {
        throw malformedTeam(`Team '${streamTeamId}' closure cleanup cannot create or reopen workflow plan '${record.plan.id}'`)
      }
      return
    }
    case 'team/child-run-bound':
      throw malformedTeam(`Team '${streamTeamId}' cannot bind child endpoints after closure admission`)
    case 'team/child-result-admitted':
    case 'team/final-admitted':
    case 'team/closure':
    case 'team/phase':
    case 'team/archived':
    case 'goal/changed':
    case 'participant-interrupt/acknowledged':
    case 'usage/parent-charge-settled':
      return
    /* v8 ignore next -- TeamJournalRecord is closed and every discriminator is handled above. */
    default:
      return assertNever(record)
  }
}

/** Fold one whole current-goal value after validating its durable CAS lineage. */
function foldGoal(
  previous: TeamProjection,
  record: Extract<TeamJournalRecord, { readonly type: 'goal/changed' }>,
  team: TeamProjection['team'],
  streamTeamId: TeamId,
): TeamProjection {
  const current = previous.team.goal
  const next = record.goal
  assertGoalTeam(streamTeamId, next)
  if (next.revision !== current.revision + 1) {
    throw malformedTeam(`Team goal revision ${next.revision} does not follow ${current.revision}`)
  }
  assertGoalValue(next)
  if (next.phase !== current.phase) {
    assertTeamTransition(() => { assertTeamGoalPhaseTransition(current.phase, next.phase) })
  }
  return { ...previous, team: { ...team, goal: structuredClone(next) } }
}

/** Validate the immutable revision-one Team goal embedded in its creation record. */
function assertInitialGoal(teamId: TeamId, goal: TeamGoalSnapshot): void {
  assertGoalTeam(teamId, goal)
  if (goal.revision !== 1) throw malformedTeam(`Team '${teamId}' initial goal must have revision 1`)
  assertGoalValue(goal)
  assertTeamTransition(() => { assertTeamGoalPhaseTransition(undefined, goal.phase) })
}

/** Require a whole goal snapshot to remain attached to its enclosing Team. */
function assertGoalTeam(teamId: TeamId, goal: TeamGoalSnapshot): void {
  if (goal.teamId !== teamId) {
    throw malformedTeam(`Team goal belongs to '${goal.teamId}', not '${teamId}'`)
  }
}

/** Defensively validate semantics also enforced by the durable parser. */
function assertGoalValue(goal: TeamGoalSnapshot): void {
  if (typeof goal.objective !== 'string' || goal.objective.trim().length === 0 || goal.objective !== goal.objective.trim()) {
    throw malformedTeam('Team goal objective must be non-empty and normalized')
  }
  try {
    jsonObjectSchema.parse(goal.budgets)
  } catch (error: unknown) {
    throw malformedTeam('Team goal budgets must be JSON', error)
  }
  const hasBlocker = goal.blocker !== undefined
  if ((goal.phase === 'blocked') !== hasBlocker) {
    throw malformedTeam(`Team goal phase '${goal.phase}' has an invalid blocker relation`)
  }
}

/** Validate the immutable root-or-child relation carried by a creation record. */
function assertTeamLineage(record: Extract<TeamJournalRecord, { readonly type: 'team/created' }>): void {
  const hasParentTeam = record.parentTeamId !== undefined
  const hasParentTask = record.parentTaskId !== undefined
  if (hasParentTeam !== hasParentTask) throw malformedTeam('Team creation has a one-sided parent link')
  if (!hasParentTeam && record.depth !== 0) throw malformedTeam('root Team creation must have depth zero')
  if (hasParentTeam && record.depth < 1) throw malformedTeam('nested Team creation must have positive depth')
  if (record.depth > record.maxTeamDepth) throw malformedTeam('Team creation exceeds its maxTeamDepth')
}

/** Validate that a durable Participant grant cannot widen its Team authority. */
function assertFoldAuthorityGrantSubset(
  parent: TeamAuthorityGrant,
  child: TeamAuthorityGrant,
  subject: string,
): void {
  assertTeamCondition(child.operations.every(operation => parent.operations.includes(operation)), `${subject} widens authority operations`)
  assertTeamCondition(child.workspaceModes.every(mode => parent.workspaceModes.includes(mode)), `${subject} widens authority workspace modes`)
  assertTeamCondition(child.readScopes.every(scope => childScopeAllowed(parent.readScopes, scope)), `${subject} widens authority read scopes`)
  assertTeamCondition(child.writeScopes.every(scope => childScopeAllowed(parent.writeScopes, scope)), `${subject} widens authority write scopes`)
  assertFoldPlacementGrantSubset(parent.placement, child.placement, subject)
  const budgetKeys = [
    'maxInputTokens', 'maxOutputTokens', 'maxTotalTokens', 'maxTurns', 'maxWallTimeMs',
    'maxCostUnits', 'maxRetries', 'maxConcurrency', 'maxChildTeams', 'maxLiveActivations', 'maxArtifactBytes',
  ] as const
  for (const key of budgetKeys) {
    const parentLimit = parent.budgets[key]
    const childLimit = child.budgets[key]
    if (parentLimit !== undefined && childLimit !== undefined) {
      assertTeamCondition(childLimit <= parentLimit, `${subject} widens authority budget '${key}'`)
    }
  }
}

/** Validate that a durable descendant placement restriction remains within its parent grant. */
function assertFoldPlacementGrantSubset(
  parent: TeamTaskPlacement | undefined,
  child: TeamTaskPlacement | undefined,
  subject: string,
): void {
  if (parent === undefined) return
  if (child === undefined) {
    assertTeamCondition(false, `${subject} omits a placement restriction allowed by its parent grant`)
    return
  }
  for (const key of ['participantIds', 'roles', 'providers', 'presets', 'models'] as const) {
    const allowed = parent[key]
    const requested = child[key]
    const allowedValues = allowed === undefined ? undefined : new Set<string>(allowed)
    const withinGrant = allowedValues === undefined || requested !== undefined
      && requested.every(value => allowedValues.has(value))
    assertTeamCondition(withinGrant, `${subject} widens authority placement '${key}'`)
  }
}

/** Test a workspace-relative scope against a durable grant prefix. */
function childScopeAllowed(granted: readonly string[], requested: string): boolean {
  return granted.some(scope => scope === '.' || scope === requested || requested.startsWith(`${scope}/`))
}

/** Fold a complete task snapshot while retaining stable participant and task identities. */
function foldParticipant(
  previous: TeamProjection,
  record: Extract<TeamJournalRecord, { readonly type: 'participant/changed' }>,
  team: TeamProjection['team'],
  streamTeamId: TeamId,
): TeamProjection {
  const participant = record.participant
  if (participant.teamId !== streamTeamId) {
    throw malformedTeam(`participant '${participant.id}' belongs to '${participant.teamId}', not '${streamTeamId}'`)
  }
  if (participant.authorityGrant !== undefined && previous.team.authorityGrant !== undefined) {
    assertFoldAuthorityGrantSubset(previous.team.authorityGrant, participant.authorityGrant, `participant '${participant.id}'`)
  }
  const current = previous.participants.get(participant.id)
  const reservationChanged = !isDeepStrictEqual(current?.activationReservation, participant.activationReservation)
  if (current === undefined || current.phase !== participant.phase || !reservationChanged) {
    assertTeamTransition(() => { assertParticipantPhaseTransition(current?.phase, participant.phase) })
  }
  if (current !== undefined && (
    current.teamId !== participant.teamId
    || current.kind !== participant.kind
    || current.displayName !== participant.displayName
    || current.role !== participant.role
    || !isDeepStrictEqual(current.capabilities, participant.capabilities)
    || !isDeepStrictEqual(current.owner, participant.owner)
    || current.provider !== participant.provider
    || current.preset !== participant.preset
    || current.model !== participant.model
    || current.authScheme !== participant.authScheme
    || !isDeepStrictEqual(current.authorityGrant, participant.authorityGrant)
  )) {
    throw malformedTeam(`participant '${participant.id}' changed immutable fields`)
  }
  const prior = current?.activationReservation
  const reservation = participant.activationReservation
  if (reservationChanged) {
    assertTeamCondition(current !== undefined && isDeepStrictEqual({ ...current, activationReservation: reservation }, participant),
      'Startup mutation changes unrelated participant fields')
    if (prior !== undefined && reservation?.id === prior.id) {
      assertReservationRelease(current, participant)
      assertTeamCondition(reservation.releasedAt === record.createdAt, 'Startup release time differs from its journal record')
      assertTeamCondition(![...previous.activations.values()].some(binding => binding.reservationId === reservation.id),
        'Bound startup cannot release through a participant record')
    } else {
      assertTeamCondition(reservation !== undefined && reservation.releasedAt === undefined
        && reservation.reservedAt === record.createdAt && current.phase === 'active' && participant.phase === 'active'
        && previous.team.phase === 'active' && previous.team.closure === undefined && previous.team.cancellation === undefined,
      'Startup reservation requires active membership before provider start')
      assertTeamCondition(![...previous.activations.values()].some(binding =>
        binding.activation.participantId === participant.id && binding.quiescedAt === undefined), 'Startup replaces an unquiesced epoch')
      if (prior !== undefined) assertTeamCondition(prior.releasedAt !== undefined
        || [...previous.activations.values()].some(binding => binding.reservationId === prior.id && binding.quiescedAt !== undefined),
      'Startup replaces an unconfirmed reservation')
    }
  } else if (previous.team.cancellation !== undefined || previous.team.closure !== undefined) {
    throw malformedTeam('Closure participant mutation is not an unpublished-start release')
  }
  const participants = new Map(previous.participants)
  participants.set(participant.id, structuredClone(participant))
  assertDistinctActiveHumanOwners(participants.values())
  const projection = { ...previous, team, participants }
  assertActivationCapacity(projection)
  return projection
}

/** Only a previously reserved unpublished start can gain a release timestamp during closure. */
function assertReservationRelease(current: ParticipantSnapshot | undefined, next: ParticipantSnapshot): void {
  const previous = current?.activationReservation
  const reservation = next.activationReservation
  assertTeamCondition(previous !== undefined && reservation !== undefined && previous.releasedAt === undefined
    && reservation.releasedAt !== undefined && isDeepStrictEqual({ ...current, activationReservation: {
    ...previous, releasedAt: reservation.releasedAt,
  } }, next), 'Participant release changed its startup identity or membership')
}

/** Reconstruct capacity from durable admissions, epoch settlement and frozen child allowances. */
function assertActivationCapacity(projection: TeamProjection): void {
  let limit: number | undefined
  assertTeamTransition(() => { limit = liveActivationLimit(projection.budgets, projection.team.authorityGrant) })
  if (limit !== undefined) assertTeamCondition(typeof limit === 'number' && Number.isSafeInteger(limit) && limit >= 0,
    'Team live Activation ceiling is invalid')
  const bound = new Set<string>()
  for (const binding of projection.activations.values()) {
    if (binding.reservationId === undefined) {
      assertTeamCondition(limit === undefined
        && projection.participants.get(binding.activation.participantId)?.authorityGrant?.budgets.maxLiveActivations === undefined,
      'Bounded Team activation omits its startup reservation')
      continue
    }
    assertTeamCondition(!bound.has(binding.reservationId), 'Startup reservation is bound more than once')
    bound.add(binding.reservationId)
    const reservation = projection.participants.get(binding.activation.participantId)?.activationReservation
    if (binding.quiescedAt === undefined || reservation?.id === binding.reservationId) {
      assertTeamCondition(reservation?.id === binding.reservationId && reservation.releasedAt === undefined
        && reservation.provider === binding.provider && reservation.sessionId === binding.sessionId,
      'Activation startup identity differs from its participant reservation')
    }
  }
  const reservationIds = new Set<string>()
  for (const participant of projection.participants.values()) {
    const reservation = participant.activationReservation
    if (reservation === undefined) continue
    assertTeamCondition(!reservationIds.has(reservation.id), 'Participants share one startup reservation identity')
    reservationIds.add(reservation.id)
    if (participant.authorityGrant?.budgets.maxLiveActivations === 0) {
      assertTeamCondition(reservation.releasedAt !== undefined
        || [...projection.activations.values()].some(binding =>
          binding.reservationId === reservation.id && binding.quiescedAt !== undefined),
      'Participant with zero live authority retains startup capacity')
    }
    assertTeamCondition(isAgentParticipant(participant) && reservation.reservedAt >= projection.team.createdAt
      && reservation.reservedAt <= projection.team.updatedAt && (reservation.releasedAt === undefined
        || reservation.releasedAt >= reservation.reservedAt && reservation.releasedAt <= projection.team.updatedAt),
    'Startup reservation has an invalid participant or timestamp')
  }
  if (limit === undefined) return
  for (const task of projection.tasks.values()) {
    if (task.delegation?.childTeamId !== undefined) assertTeamCondition(task.delegation.creation?.budgets.maxLiveActivations !== undefined,
      'Bounded parent child omits its live Activation allowance')
  }
  let used = 0
  assertTeamTransition(() => {
    used = liveActivationCapacity(projection.participants.values(), projection.activations.values(), projection.tasks.values())
  })
  assertTeamCondition(used <= limit, 'Live Activation reservations exceed the Team ceiling')
}

/** Reject two active human participants that bind the same durable product principal. */
function assertDistinctActiveHumanOwners(participants: Iterable<ParticipantSnapshot>): void {
  const owners = new Set<string>()
  for (const participant of participants) {
    if (participant.kind !== 'human' || participant.phase !== 'active') continue
    if (participant.owner?.kind !== 'product-principal') continue
    if (owners.has(participant.owner.principalId)) {
      throw malformedTeam(`Team repeats active human owner '${participant.owner.principalId}'`)
    }
    owners.add(participant.owner.principalId)
  }
}

/** Validate Team-owned settlement after every record and checkpoint, including records after a terminal marker. */
function assertTerminalTeamResources(projection: TeamProjection): void {
  const phase = projection.team.phase
  if (phase !== 'completed' && phase !== 'failed' && phase !== 'cancelled') return

  if (phase === 'completed' && projection.team.parentTeamId !== undefined && projection.team.childResultAdmission === undefined) {
    throw malformedTeam('completed child Team has no parent-service result admission')
  }
  for (const allocation of projection.workspaceAllocations.values()) {
    if (allocation.lifecycle !== 'released') throw malformedTeam(`terminal Team retains unreleased workspace allocation '${allocation.id}'`)
  }
  for (const task of projection.tasks.values()) {
    if (task.phase !== 'completed' && task.phase !== 'failed' && task.phase !== 'cancelled' && task.phase !== 'deleted') {
      throw malformedTeam(`terminal Team retains unfinished task '${task.id}'`)
    }
  }
  for (const plan of projection.workflowPlans.values()) {
    if (plan.phase === 'compiling' || plan.phase === 'ready') throw malformedTeam(`terminal Team retains unfinished workflow plan '${plan.id}'`)
  }
  if (projection.pendingParentCharges.size > 0) throw malformedTeam('terminal Team retains unsettled parent usage charges')
  for (const binding of projection.activations.values()) {
    if (binding.activation.status !== 'offline' || binding.quiescedAt === undefined) {
      throw malformedTeam(`terminal Team retains activation '${binding.activation.id}' without complete quiescence`)
    }
  }
  assertTeamCondition(liveActivationCapacity(
    projection.participants.values(), projection.activations.values(), projection.tasks.values(),
  ) === 0,
  'Terminal Team retains live Activation startup or subtree capacity')
  for (const action of projection.humanActions.values()) {
    if (action.phase === 'pending') throw malformedTeam(`terminal Team retains pending human action '${action.id}'`)
  }
}

/** Fold one durable Team-wide approval/question revision. */
function foldHumanAction(
  previous: TeamProjection,
  record: Extract<TeamJournalRecord, { readonly type: 'human-action/changed' }>,
  team: TeamProjection['team'],
  streamTeamId: TeamId,
): TeamProjection {
  const action = record.action
  if (action.teamId !== streamTeamId) {
    throw malformedTeam(`human action '${action.id}' belongs to '${action.teamId}', not '${streamTeamId}'`)
  }
  if (!previous.participants.has(action.participantId)) {
    throw malformedTeam(`human action '${action.id}' names an unknown participant '${action.participantId}'`)
  }
  if (action.taskId !== undefined && !previous.tasks.has(action.taskId)) {
    throw malformedTeam(`human action '${action.id}' names an unknown task '${action.taskId}'`)
  }
  const current = previous.humanActions.get(action.id)
  if (current === undefined) {
    if (previous.team.cancellation !== undefined) {
      throw malformedTeam(`Team '${streamTeamId}' cancellation cannot create human action '${action.id}'`)
    }
    assertTeamCondition([
      action.phase === 'pending',
      action.response === undefined,
      action.createdAt === record.createdAt,
      action.updatedAt === record.createdAt,
    ].every(Boolean), `human action '${action.id}' must begin pending at its creation timestamp`)
  } else {
    assertTeamCondition([
      current.teamId === action.teamId,
      current.kind === action.kind,
      current.sessionId === action.sessionId,
      current.participantId === action.participantId,
      current.taskId === action.taskId,
      current.attemptId === action.attemptId,
      current.sourceId === action.sourceId,
      isDeepStrictEqual(current.details, action.details),
      action.createdAt === current.createdAt,
      action.updatedAt === record.createdAt,
      action.updatedAt >= current.updatedAt,
      current.phase === 'pending',
      action.phase === 'resolved' || action.phase === 'cancelled'
        || current.response === undefined && action.response !== undefined
          && action.response.expectedUpdatedAt === current.updatedAt && action.response.acceptedAt === record.createdAt,
      current.response === undefined
        ? action.response === undefined || action.phase === 'pending'
        : isDeepStrictEqual(current.response, action.response),
      action.response === undefined || previous.participants.get(action.response.respondedBy)?.kind === 'human',
    ].every(Boolean), `human action '${action.id}' has an invalid terminal or response transition`)
  }
  const humanActions = new Map(previous.humanActions)
  humanActions.set(action.id, structuredClone(action))
  return { ...previous, team, humanActions }
}

/** Return the zero aggregate used by a freshly created Team. */
function zeroUsage(): TeamUsageSnapshot {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    turns: 0,
    costUnits: 0,
    updatedAt: 0,
  }
}

/**
 * Fold all retained provider samples into one deterministic usage aggregate.
 * @param samples - replaceable usage samples keyed by their id.
 * @returns aggregate token, turn, cost, and observation timestamp totals.
 */
export function usageFromSamples(samples: ReadonlyMap<TeamUsageSampleId, TeamUsageSample>): TeamUsageSnapshot {
  return usageFromContributions(samples.values(), new Map<TeamUsageChargeId, TeamUsageCharge>().values())
}

/**
 * Fold local provider samples and child-Team charges into one subtree usage
 * aggregate. Charges replace by identity so retries and updated provider
 * chunks never double-count a model step.
 * @param samples - local provider samples keyed by their id.
 * @param charges - child usage charges keyed by their propagation identity.
 * @returns aggregate token, turn, cost, and observation timestamp totals.
 */
export function usageFromSamplesAndCharges(
  samples: ReadonlyMap<TeamUsageSampleId, TeamUsageSample>,
  charges: ReadonlyMap<TeamUsageChargeId, TeamUsageCharge>,
): TeamUsageSnapshot {
  return usageFromContributions(samples.values(), charges.values())
}

/** Fold both usage contribution forms through one bounded accumulator. */
function usageFromContributions(
  samples: Iterable<TeamUsageSample>,
  charges: Iterable<TeamUsageCharge>,
): TeamUsageSnapshot {
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let costUnits = 0
  let updatedAt = 0
  const turns = new Set<string>()
  for (const sample of samples) {
    inputTokens = safeUsageAdd(inputTokens, sample.usage.inputTokens)
    outputTokens = safeUsageAdd(outputTokens, sample.usage.outputTokens)
    cacheReadTokens = safeUsageAdd(cacheReadTokens, sample.usage.cacheReadTokens ?? 0)
    cacheWriteTokens = safeUsageAdd(cacheWriteTokens, sample.usage.cacheWriteTokens ?? 0)
    costUnits = safeCostAdd(costUnits, sample.costUnits ?? 0)
    turns.add(`${String(sample.sessionId)}\u0000${String(sample.turn)}`)
    updatedAt = Math.max(updatedAt, sample.observedAt)
  }
  for (const charge of charges) {
    inputTokens = safeUsageAdd(inputTokens, charge.usage.inputTokens)
    outputTokens = safeUsageAdd(outputTokens, charge.usage.outputTokens)
    cacheReadTokens = safeUsageAdd(cacheReadTokens, charge.usage.cacheReadTokens ?? 0)
    cacheWriteTokens = safeUsageAdd(cacheWriteTokens, charge.usage.cacheWriteTokens ?? 0)
    costUnits = safeCostAdd(costUnits, charge.costUnits ?? 0)
    turns.add(`${String(charge.sessionId)}\u0000${String(charge.turn)}`)
    updatedAt = Math.max(updatedAt, charge.observedAt)
  }
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, turns: turns.size, costUnits, updatedAt }
}

/** Fold one provider usage sample, replacing an earlier chunk for the same step. */
function foldUsage(
  previous: TeamProjection,
  record: Extract<TeamJournalRecord, { readonly type: 'usage/changed' }>,
  team: TeamProjection['team'],
  streamTeamId: TeamId,
): TeamProjection {
  const sample = record.sample
  if (sample.teamId !== streamTeamId) throw malformedTeam(`usage sample '${sample.id}' belongs to '${sample.teamId}', not '${streamTeamId}'`)
  if (!previous.participants.has(sample.participantId)) {
    throw malformedTeam(`usage sample '${sample.id}' names an unknown participant '${sample.participantId}'`)
  }
  assertUsageTaskRelation(previous, sample)
  const current = previous.usageSamples.get(sample.id)
  if (current !== undefined && (
    current.teamId !== sample.teamId
    || current.participantId !== sample.participantId
    || current.sessionId !== sample.sessionId
    || current.provider !== sample.provider
    || current.model !== sample.model
    || current.turn !== sample.turn
    || current.step !== sample.step
    || current.taskId !== sample.taskId
    || current.attemptId !== sample.attemptId
  )) {
    throw malformedTeam(`usage sample '${sample.id}' changed its immutable provenance`)
  }
  const samples = new Map(previous.usageSamples)
  samples.set(sample.id, structuredClone(sample))
  const usage = usageFromSamplesAndCharges(samples, previous.usageCharges)
  if (!isDeepStrictEqual(usage, record.usage)) {
    throw malformedTeam(`usage aggregate after sample '${sample.id}' is inconsistent`)
  }
  const expectedTimestamp = record.createdAt
  if (sample.observedAt !== expectedTimestamp || usage.updatedAt !== expectedTimestamp) {
    throw malformedTeam(`usage sample '${sample.id}' has an invalid observation timestamp`)
  }
  return { ...previous, team, usage, usageSamples: samples }
}

/** Fold a pending outbound child charge into the current Team projection. */
function foldParentChargePending(
  previous: TeamProjection,
  record: Extract<TeamJournalRecord, { readonly type: 'usage/parent-charge-pending' }>,
  team: TeamProjection['team'],
  streamTeamId: TeamId,
): TeamProjection {
  const charge = record.charge
  if (team.parentTeamId === undefined) {
    throw malformedTeam(`Team '${streamTeamId}' cannot retain a parent usage charge without a parent Team`)
  }
  if (charge.sourceTeamId !== streamTeamId || charge.parentTaskId !== team.parentTaskId) {
    throw malformedTeam(`pending usage charge '${charge.id}' has source Team '${charge.sourceTeamId}', not '${streamTeamId}'`)
  }
  const current = previous.pendingParentCharges.get(charge.id)
  if (current !== undefined && !sameUsageChargeProvenance(current, charge)) {
    throw malformedTeam(`pending usage charge '${charge.id}' changed immutable provenance`)
  }
  const pendingParentCharges = new Map(previous.pendingParentCharges)
  pendingParentCharges.set(charge.id, structuredClone(charge))
  return { ...previous, team, pendingParentCharges }
}

/** Fold a child charge into the current Team and prepare its next hop. */
function foldChildCharge(
  previous: TeamProjection,
  record: Extract<TeamJournalRecord, { readonly type: 'usage/child-charged' }>,
  team: TeamProjection['team'],
  streamTeamId: TeamId,
): TeamProjection {
  const charge = record.charge
  if (charge.sourceTeamId === streamTeamId || charge.originTeamId === streamTeamId) {
    throw malformedTeam(`child usage charge '${charge.id}' must originate outside Team '${streamTeamId}'`)
  }
  if (previous.tasks.get(charge.parentTaskId)?.delegation?.childTeamId !== charge.sourceTeamId) {
    throw malformedTeam(`child usage charge '${charge.id}' has no matching task reservation`)
  }
  const current = previous.usageCharges.get(charge.id)
  if (current !== undefined && !sameUsageChargeProvenance(current, charge)) {
    throw malformedTeam(`child usage charge '${charge.id}' changed immutable provenance`)
  }
  const usageCharges = new Map(previous.usageCharges)
  const acceptedCharge: TeamUsageCharge = { ...structuredClone(charge), observedAt: record.createdAt }
  usageCharges.set(charge.id, acceptedCharge)
  const usage = usageFromSamplesAndCharges(previous.usageSamples, usageCharges)
  if (!isDeepStrictEqual(usage, record.usage)) {
    throw malformedTeam(`child usage aggregate after charge '${charge.id}' is inconsistent`)
  }
  const pendingParentCharges = new Map(previous.pendingParentCharges)
  if (team.parentTeamId !== undefined) {
    // Team lineage validation requires the parent task whenever a parent Team is present.
    pendingParentCharges.set(charge.id, structuredClone({
      ...acceptedCharge, sourceTeamId: streamTeamId, parentTaskId: team.parentTaskId as TeamTaskId,
    }))
  }
  return { ...previous, team, usage, usageCharges, pendingParentCharges }
}

/** Fold the receipt that removes one already accepted outbound charge. */
function foldParentChargeSettled(
  previous: TeamProjection,
  record: Extract<TeamJournalRecord, { readonly type: 'usage/parent-charge-settled' }>,
  team: TeamProjection['team'],
  streamTeamId: TeamId,
): TeamProjection {
  if (!previous.pendingParentCharges.has(record.chargeId)) {
    throw malformedTeam(`Team '${streamTeamId}' has no pending parent usage charge '${record.chargeId}'`)
  }
  const pendingParentCharges = new Map(previous.pendingParentCharges)
  pendingParentCharges.delete(record.chargeId)
  return { ...previous, team, pendingParentCharges }
}

/** Fold one complete durable workflow-plan revision and its compiled bindings. */
function foldWorkflowPlan(
  previous: TeamProjection,
  record: WorkflowPlanChangedJournalRecord,
  team: TeamProjection['team'],
  streamTeamId: TeamId,
): TeamProjection {
  const next = record.plan
  if (next.teamId !== streamTeamId) {
    throw malformedTeam(`workflow plan '${next.id}' belongs to '${next.teamId}', not '${streamTeamId}'`)
  }
  assertWorkflowPlanActorRelation(next, previous.participants, previous.activations)
  const current = previous.workflowPlans.get(next.id)
  if (current === undefined) {
    if (next.revision !== 1 || next.phase !== 'compiling' || next.taskBindings.length !== 0 || next.channelId !== undefined) {
      throw malformedTeam(`workflow plan '${next.id}' must begin empty in compiling phase`)
    }
  } else {
    if (next.revision !== current.revision + 1) {
      throw malformedTeam(`workflow plan '${next.id}' revision ${next.revision} does not follow ${current.revision}`)
    }
    if (next.teamId !== current.teamId
      || next.idempotencyKey !== current.idempotencyKey
      || !isDeepStrictEqual(next.actor, current.actor)
      || !isDeepStrictEqual(next.plan, current.plan)) {
      throw malformedTeam(`workflow plan '${next.id}' changed immutable admission fields`)
    }
    assertWorkflowPlanPhaseTransition(current, next)
  }
  assertWorkflowPlanBindings(next, previous.tasks, previous.channelIds)
  const workflowPlans = new Map(previous.workflowPlans)
  workflowPlans.set(next.id, structuredClone(next))
  return { ...previous, team, workflowPlans }
}

/** Validate one checkpointed workflow plan's Team and author relationships. */
function assertWorkflowPlanSnapshot(
  plan: TeamWorkflowPlanSnapshot,
  teamId: TeamId,
  participants: ReadonlyMap<ParticipantId, ParticipantSnapshot>,
  activations: ReadonlyMap<ActivationId, ActivationBindingSnapshot>,
): void {
  if (plan.teamId !== teamId) throw malformedTeam(`workflow plan '${plan.id}' has a foreign Team`)
  assertWorkflowPlanActorRelation(plan, participants, activations)
}

/** Validate the durable workflow author against its historical Team binding. */
function assertWorkflowPlanActorRelation(
  plan: TeamWorkflowPlanSnapshot,
  participants: ReadonlyMap<ParticipantId, ParticipantSnapshot>,
  activations: ReadonlyMap<ActivationId, ActivationBindingSnapshot>,
): void {
  const actor = plan.actor
  if (actor === undefined) return
  const participant = participants.get(actor.participantId)
  const binding = activations.get(actor.activationId)
  if (participant === undefined
    || !isAgentParticipant(participant)
    || binding === undefined
    || binding.activation.teamId !== plan.teamId
    || binding.activation.participantId !== actor.participantId
    || binding.sessionId !== actor.sessionId
    || binding.provider !== actor.provider) {
    throw malformedTeam(`workflow plan '${plan.id}' has an invalid author binding`)
  }
}

/** Validate one durable workflow-plan phase transition and its binding monotonicity. */
function assertWorkflowPlanPhaseTransition(
  current: TeamWorkflowPlanSnapshot,
  next: TeamWorkflowPlanSnapshot,
): void {
  if (current.channelId !== undefined && next.channelId !== current.channelId) {
    throw malformedTeam(`workflow plan '${current.id}' changed its admitted channel binding`)
  }
  for (const binding of current.taskBindings) {
    if (!next.taskBindings.some(candidate => candidate.templateId === binding.templateId && candidate.taskId === binding.taskId)) {
      throw malformedTeam(`workflow plan '${current.id}' changed its admitted task binding '${binding.templateId}'`)
    }
  }
  if (current.phase === 'completed' || current.phase === 'failed' || current.phase === 'cancelled') {
    throw malformedTeam(`workflow plan '${current.id}' has records after terminal phase '${current.phase}'`)
  }
  if (current.phase === 'ready' && next.phase !== 'completed' && next.phase !== 'failed' && next.phase !== 'cancelled') {
    throw malformedTeam(`ready workflow plan '${current.id}' cannot return to '${next.phase}'`)
  }
  if (current.phase === 'compiling' && next.phase === 'compiling') {
    const addedTask = next.taskBindings.length > current.taskBindings.length
    const addedChannel = current.channelId === undefined && next.channelId !== undefined
    if (!addedTask && !addedChannel) throw malformedTeam(`workflow plan '${current.id}' has a compiling no-op revision`)
  }
}

/** Validate workflow bindings and projected outcomes against retained task facts. */
function assertWorkflowPlanBindings(
  plan: TeamWorkflowPlanSnapshot,
  tasks: ReadonlyMap<TeamTaskId, TeamTaskSnapshot>,
  channelIds: ReadonlySet<ChannelId>,
): void {
  if (plan.channelId !== undefined && !channelIds.has(plan.channelId)) {
    throw malformedTeam(`workflow plan '${plan.id}' references unattached channel '${plan.channelId}'`)
  }
  for (const binding of plan.taskBindings) {
    const task = tasks.get(binding.taskId)
    if (task === undefined || (task.phase === 'deleted' && plan.phase !== 'cancelled' && plan.phase !== 'failed')) {
      throw malformedTeam(`workflow plan '${plan.id}' binds missing or deleted task '${binding.taskId}'`)
    }
    if (task.workflowPlanId !== plan.id || task.workflowTemplateId !== binding.templateId) {
      throw malformedTeam(`workflow plan '${plan.id}' binding '${binding.templateId}' has an invalid task relation`)
    }
  }
  if (plan.phase === 'ready' || plan.phase === 'completed') {
    if (plan.channelId === undefined) throw malformedTeam(`workflow plan '${plan.id}' is ready without a channel binding`)
  }
  if (plan.result !== undefined) {
    const terminal = workflowTerminalOutcome(plan, tasks)
    if (terminal === undefined || terminal.phase !== plan.phase) {
      throw malformedTeam(`workflow plan '${plan.id}' terminal result differs from its complete task outcomes`)
    }
    const result = plan.result
    const selected = new Set(plan.plan.result.taskTemplateIds)
    if (result.tasks.length !== selected.size) throw malformedTeam(`workflow plan '${plan.id}' result has an unexpected task count`)
    for (const projected of result.tasks) {
      const binding = plan.taskBindings.find(candidate => candidate.templateId === projected.templateId)
      if (binding?.taskId !== projected.taskId) throw malformedTeam(`workflow plan '${plan.id}' result has an invalid task binding`)
      const task = tasks.get(projected.taskId)
      if (task === undefined || projected.phase !== task.phase) {
        throw malformedTeam(`workflow plan '${plan.id}' result phase does not match task '${projected.taskId}'`)
      }
      if ((projected.phase === 'cancelled' || projected.phase === 'deleted')
        && !isDeepStrictEqual(projected.blockedByOutcome, task.blockedByOutcome)) {
        throw malformedTeam(`workflow plan '${plan.id}' dependency cause does not match task '${task.id}'`)
      }
      const outcome = task.attemptHistory.at(-1)?.outcome
      if (projected.phase === 'completed'
        && !isDeepStrictEqual(outcome, { kind: 'completed', result: projected.result })) {
        throw malformedTeam(`workflow plan '${plan.id}' result does not match completed task '${task.id}'`)
      }
      if (projected.phase === 'failed' && projected.failure !== undefined
        && !isDeepStrictEqual(outcome, { kind: 'failed', failure: projected.failure })) {
        throw malformedTeam(`workflow plan '${plan.id}' failure does not match task '${task.id}'`)
      }
    }
  }
}

/** Validate the relation of a workflow-owned task to its admitted plan. */
function assertWorkflowTaskRelation(
  task: TeamTaskSnapshot,
  plans: ReadonlyMap<TeamWorkflowPlanId, TeamWorkflowPlanSnapshot>,
  creating: boolean,
): void {
  if (task.workflowPlanId === undefined) return
  if (task.proposedOwnerId !== undefined) {
    throw malformedTeam(`workflow task '${task.id}' cannot retain an owner proposal`)
  }
  const plan = plans.get(task.workflowPlanId)
  if (plan === undefined) throw malformedTeam(`task '${task.id}' references unknown workflow plan '${task.workflowPlanId}'`)
  if (!plan.plan.tasks.some(template => template.id === task.workflowTemplateId)) {
    throw malformedTeam(`task '${task.id}' references unknown workflow template '${task.workflowTemplateId}'`)
  }
  if (creating && plan.phase !== 'compiling') throw malformedTeam(`task '${task.id}' was created after workflow plan '${plan.id}' left compiling`)
}

/** Validate one checkpointed child charge's relation to its owning Team. */
function assertCheckpointUsageCharge(
  team: TeamProjection['team'],
  charges: ReadonlyMap<TeamUsageChargeId, TeamUsageCharge>,
  charge: TeamUsageCharge,
): void {
  if (charge.sourceTeamId === team.id || charge.originTeamId === team.id) {
    throw malformedTeam(`Team checkpoint child charge '${charge.id}' originates from '${team.id}'`)
  }
  if (charges.has(charge.id)) throw malformedTeam(`Team checkpoint repeats child usage charge '${charge.id}'`)
}

/** Compare charge provenance while allowing provider chunks to replace usage. */
function sameUsageChargeProvenance(left: TeamUsageCharge, right: TeamUsageCharge): boolean {
  return left.id === right.id
    && left.sourceTeamId === right.sourceTeamId
    && left.parentTaskId === right.parentTaskId
    && left.originTeamId === right.originTeamId
    && left.sourceSampleId === right.sourceSampleId
    && left.participantId === right.participantId
    && left.sessionId === right.sessionId
    && left.provider === right.provider
    && left.model === right.model
    && left.turn === right.turn
    && left.step === right.step
}

/** Validate optional task/attempt provenance retained with a durable usage sample. */
function assertUsageTaskRelation(projection: TeamProjection, sample: TeamUsageSample): void {
  if (sample.taskId === undefined || sample.attemptId === undefined) return
  const task = projection.tasks.get(sample.taskId)
  if (task === undefined || task.phase === 'deleted') {
    throw malformedTeam(`usage sample '${sample.id}' names an unknown task '${sample.taskId}'`)
  }
  const attempt = task.lease?.attemptId === sample.attemptId
    ? task.lease
    : task.attemptHistory.find(candidate => candidate.id === sample.attemptId)
  if (attempt === undefined || attempt.participantId !== sample.participantId) {
    throw malformedTeam(`usage sample '${sample.id}' names an invalid task attempt '${sample.attemptId}'`)
  }
  if (attempt.activationId !== undefined) {
    const binding = projection.activations.get(attempt.activationId)
    if (binding === undefined || binding.sessionId !== sample.sessionId) {
      throw malformedTeam(`usage sample '${sample.id}' does not match its task activation Session`)
    }
  }
}

/** Add bounded integer token counts without allowing an invalid durable number. */
function safeUsageAdd(left: number, right: number): number {
  const value = left + right
  if (!Number.isSafeInteger(value)) throw malformedTeam('Team usage token aggregate exceeds safe integer range')
  return value
}

/** Add bounded finite deployment cost units without allowing an invalid durable number. */
function safeCostAdd(left: number, right: number): number {
  const value = left + right
  if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER) throw malformedTeam('Team usage cost aggregate exceeds safe range')
  return value
}

/** Fold one full task snapshot and validate the resulting dependency graph. */
function foldTask(
  previous: TeamProjection,
  record: Extract<TeamJournalRecord, { readonly type: 'task/changed' }>,
  team: TeamProjection['team'],
  streamTeamId: TeamId,
): TeamProjection {
  const task = record.task
  if (task.teamId !== streamTeamId) {
    throw malformedTeam(`task '${task.id}' belongs to '${task.teamId}', not '${streamTeamId}'`)
  }
  const current = previous.tasks.get(task.id)
  if (current === undefined) {
    if (task.revision !== 1) throw malformedTeam(`task '${task.id}' must start at revision 1`)
    assertTeamTransition(() => { assertTeamTaskPhaseTransition(undefined, task.phase) })
    assertInitialTaskAttemptState(task)
    if (task.execution.kind === 'child-team' && (task.delegation?.phase !== 'requested'
      || task.delegation.requestedAt !== record.createdAt || task.delegation.updatedAt !== record.createdAt
      || task.delegation.childTeamId !== undefined || task.delegation.startedAt !== undefined || task.delegation.creation !== undefined)) {
      throw malformedTeam(`child task '${task.id}' must begin with a fresh unreserved delegation`)
    }
    assertTaskCreateProvenance(previous, task, true)
  } else {
    if (task.revision !== current.revision + 1) {
      throw malformedTeam(`task '${task.id}' revision ${task.revision} does not follow ${current.revision}`)
    }
    if (task.phase !== current.phase && task.execution.kind === 'participant') {
      assertTeamTransition(() => { assertTeamTaskPhaseTransition(current.phase, task.phase) })
    }
    assertImmutableTaskFields(current, task)
    assertTaskAttemptTransition(previous, current, task, record.createdAt)
    assertTaskCreateProvenance(previous, task, false)
  }
  assertDistinct(task.blockedBy, `task '${task.id}' repeats a blocker`)
  assertDistinct(task.requiredCapabilities, `task '${task.id}' repeats a required capability`)
  assertDistinct(task.readScopes, `task '${task.id}' repeats a read scope`)
  assertDistinct(task.writeScopes, `task '${task.id}' repeats a write scope`)
  assertTaskParent(previous.tasks, task)
  assertWorkflowTaskRelation(task, previous.workflowPlans, current === undefined)
  assertTaskOwnerProposal(previous, task)
  const tasks = new Map(previous.tasks)
  tasks.set(task.id, structuredClone(task))
  assertTaskGraph(tasks, task.phase === 'deleted' ? task.id : undefined)
  const taskExecutionStats = addTaskExecutionStats(previous.taskExecutionStats, task,
    task.attemptHistory.slice(current?.attemptHistory.length ?? 0), previous.rules)
  const projection = { ...previous, team, tasks, taskExecutionStats }
  assertTaskReviewHistory(projection, task)
  assertTaskDependencyOutcome(projection, task)
  assertChildTeamReservations(projection)
  assertActivationCapacity(projection)
  return projection
}

/** A bounded subtree retains its lifetime child reservations across cancellation and replay. */
function assertChildTeamReservations(projection: TeamProjection): void {
  const limit = projection.budgets.maxChildTeams
  if (limit === undefined) return
  assertTeamCondition(typeof limit === 'number' && Number.isSafeInteger(limit) && limit >= 0,
    'Team descendant count ceiling is invalid')
  let count = 0
  for (const task of projection.tasks.values()) {
    if (task.delegation?.childTeamId === undefined) continue
    assertTeamCondition(task.delegation.creation?.budgets.maxChildTeams !== undefined,
      'Bounded parent delegation omits its descendant ceiling')
    assertTeamTransition(() => { count += taskChildTeamReservation(task) })
  }
  assertTeamCondition(Number.isSafeInteger(count) && count <= limit,
    'Team descendant reservations exceed its lifetime ceiling')
}

/** Fold one provider-owned workspace allocation lifecycle snapshot. */
function foldWorkspaceAllocation(
  previous: TeamProjection,
  record: WorkspaceAllocationChangedJournalRecord,
  team: TeamProjection['team'],
  streamTeamId: TeamId,
): TeamProjection {
  const allocation = record.allocation
  if (allocation.teamId !== streamTeamId || allocation.updatedAt !== record.createdAt) {
    throw malformedTeam(`workspace allocation '${allocation.id}' has an invalid Team or timestamp relation`)
  }
  const current = previous.workspaceAllocations.get(allocation.id)
  if (current === undefined) {
    if (allocation.revision !== 1 || allocation.lifecycle !== 'reserved'
      || allocation.reservedAt !== record.createdAt
      || allocation.activatedAt !== undefined
      || allocation.releaseRequestedAt !== undefined
      || allocation.releasedAt !== undefined
      || allocation.preservedAt !== undefined
      || allocation.preservationReason !== undefined
      || allocation.loss !== undefined
      || allocation.observation !== undefined) {
      throw malformedTeam(`workspace allocation '${allocation.id}' has an invalid initial reservation`)
    }
    assertWorkspaceAllocationRelation(streamTeamId, previous.tasks, previous.activations, allocation, true)
    if ([...previous.workspaceAllocations.values()].some(candidate => workspaceAttemptKey(candidate) === workspaceAttemptKey(allocation))) {
      throw malformedTeam(`workspace allocation '${allocation.id}' repeats task attempt '${allocation.attemptId}'`)
    }
  } else {
    if (allocation.revision !== current.revision + 1) {
      throw malformedTeam(`workspace allocation '${allocation.id}' revision ${allocation.revision} does not follow ${current.revision}`)
    }
    if (!isDeepStrictEqual(current.observation, allocation.observation)) throw malformedTeam('Workspace lifecycle cannot rewrite its observation')
    assertWorkspaceAllocationImmutableFields(current, allocation)
    assertWorkspaceAllocationTransition(current, allocation, record.createdAt)
    assertWorkspaceAllocationRelation(streamTeamId, previous.tasks, previous.activations, allocation, false)
  }
  const workspaceAllocations = new Map(previous.workspaceAllocations)
  workspaceAllocations.set(allocation.id, structuredClone(allocation))
  return { ...previous, team, workspaceAllocations }
}

/** Validate the durable task, attempt, activation, and Session relation of an allocation. */
function assertWorkspaceAllocationRelation(
  teamId: TeamId,
  tasks: ReadonlyMap<TeamTaskId, TeamTaskSnapshot>,
  activations: ReadonlyMap<ActivationId, ActivationBindingSnapshot>,
  allocation: TeamWorkspaceAllocationSnapshot,
  requireRunningLease: boolean,
): void {
  const task = tasks.get(allocation.taskId)
  if (task === undefined || task.phase === 'deleted' || task.workspaceMode !== allocation.mode) {
    throw malformedTeam(`workspace allocation '${allocation.id}' has an invalid task or workspace mode relation`)
  }
  const lease = task.lease
  const historical = task.attemptHistory.find(candidate => candidate.id === allocation.attemptId)
  const attempt = lease?.attemptId === allocation.attemptId ? lease : historical
  if (attempt === undefined
    || attempt.participantId !== allocation.participantId
    || attempt.activationId !== allocation.activationId) {
    throw malformedTeam(`workspace allocation '${allocation.id}' has an invalid task attempt relation`)
  }
  if (requireRunningLease && (task.phase !== 'running'
    || lease?.attemptId !== allocation.attemptId
    || lease.assignedRevision !== allocation.assignedRevision)) {
    throw malformedTeam(`workspace allocation '${allocation.id}' was not reserved by its current running lease`)
  }
  const binding = activations.get(allocation.activationId)
  if (binding === undefined
    || binding.activation.teamId !== teamId
    || binding.activation.participantId !== allocation.participantId
    || binding.sessionId !== allocation.sessionId) {
    throw malformedTeam(`workspace allocation '${allocation.id}' has an invalid activation Session relation`)
  }
}

/** Keep provider identity and exact ownership fields immutable across lifecycle transitions. */
function assertWorkspaceAllocationImmutableFields(
  current: TeamWorkspaceAllocationSnapshot,
  next: TeamWorkspaceAllocationSnapshot,
): void {
  const same = current.id === next.id
    && current.teamId === next.teamId
    && current.taskId === next.taskId
    && current.attemptId === next.attemptId
    && current.assignedRevision === next.assignedRevision
    && current.participantId === next.participantId
    && current.activationId === next.activationId
    && current.sessionId === next.sessionId
    && current.provider === next.provider
    && current.mode === next.mode
    && current.baseVersion === next.baseVersion
    && isDeepStrictEqual(current.executionWorld, next.executionWorld)
    && current.reservedAt === next.reservedAt
  if (!same) throw malformedTeam(`workspace allocation '${current.id}' changed immutable ownership fields`)
}

/** Validate one monotonic provider-allocation lifecycle transition. */
function assertWorkspaceAllocationTransition(
  current: TeamWorkspaceAllocationSnapshot,
  next: TeamWorkspaceAllocationSnapshot,
  createdAt: number,
): void {
  if (current.loss !== undefined && (next.loss === undefined
    || (current.loss.terminationProven && !isDeepStrictEqual(current.loss, next.loss))
    || current.loss.artifacts.some(artifact => !next.loss?.artifacts.some(candidate => isDeepStrictEqual(artifact, candidate))))) {
    throw malformedTeam(`workspace allocation '${current.id}' discarded its confirmed loss or retained artifacts`)
  }
  if (next.loss !== undefined && next.lifecycle === 'active') {
    throw malformedTeam(`workspace allocation '${current.id}' cannot reactivate a lost execution world`)
  }
  if (next.lifecycle !== 'release-requested' && next.releaseRequestedAt !== current.releaseRequestedAt) {
    throw malformedTeam(`workspace allocation '${current.id}' changed release intent outside its release-request transition`)
  }
  const allowed = next.lifecycle === 'unavailable' && current.lifecycle !== 'released'
    ? next.loss !== undefined && next.loss.observedAt === createdAt
    : current.lifecycle === 'unavailable'
      ? next.lifecycle === 'release-requested' || next.lifecycle === 'preserved'
      : current.lifecycle === 'reserved'
        ? next.lifecycle === 'active' || next.lifecycle === 'release-requested' || next.lifecycle === 'preserved'
        : current.lifecycle === 'active'
          ? next.lifecycle === 'release-requested' || next.lifecycle === 'preserved'
          : current.lifecycle === 'release-requested'
            ? next.lifecycle === 'released' || next.lifecycle === 'preserved'
            : current.lifecycle === 'preserved'
              ? next.lifecycle === 'active' || next.lifecycle === 'release-requested'
              : false
  if (!allowed) throw malformedTeam(`workspace allocation '${current.id}' has an invalid '${current.lifecycle}' to '${next.lifecycle}' transition`)
  if (next.lifecycle === 'active' && next.activatedAt !== createdAt) {
    throw malformedTeam(`workspace allocation '${current.id}' activation timestamp is invalid`)
  }
  if (next.lifecycle === 'release-requested' && next.releaseRequestedAt !== createdAt) {
    throw malformedTeam(`workspace allocation '${current.id}' release-request timestamp is invalid`)
  }
  if (next.lifecycle === 'released' && next.releasedAt !== createdAt) {
    throw malformedTeam(`workspace allocation '${current.id}' release timestamp is invalid`)
  }
  if (next.lifecycle === 'preserved'
    && (next.preservedAt !== createdAt || next.preservationReason === undefined)) {
    throw malformedTeam(`workspace allocation '${current.id}' preservation facts are invalid`)
  }
}

/** Produce one Team-local allocation-attempt uniqueness key. */
function workspaceAttemptKey(allocation: Pick<TeamWorkspaceAllocationSnapshot, 'taskId' | 'attemptId'>): string {
  return JSON.stringify([allocation.taskId, allocation.attemptId])
}

/** Reject a revision-one task that claims an attempt before any assignment record. */
function assertInitialTaskAttemptState(task: TeamTaskSnapshot): void {
  assertTeamCondition([
    task.attemptCount === 0,
    task.attemptHistory.length === 0,
    task.reviewHistory.length === 0,
    task.lease === undefined,
  ].every(Boolean), `initial task '${task.id}' cannot retain a lease or attempt history`)
}

function assertTaskCreateProvenance(
  projection: TeamProjection,
  task: TeamTaskSnapshot,
  requireDeliverable: boolean,
): void {
  const command = task.createCommand
  const creator = command.creator
  const participant = projection.participants.get(creator.participantId)
  if (isHumanTaskCreator(creator)) {
    if (creator.teamId !== projection.team.id
      || creator.teamId !== task.teamId
      || participant === undefined
      || participant.kind !== 'human'
      || (requireDeliverable && participant.phase !== 'active')
      || task.workflowPlanId !== undefined) {
      throw malformedTeam(`task '${task.id}' has an invalid human task-creation command relation`)
    }
    for (const current of projection.tasks.values()) {
      if (current.id !== task.id && sameTaskCreateCommand(current.createCommand, command)) {
        throw malformedTeam(`task '${task.id}' repeats a task-creation command`)
      }
    }
    return
  }
  const activationCreator = creator as TeamTaskCreator
  const binding = projection.activations.get(activationCreator.activationId)
  if (activationCreator.teamId !== projection.team.id
    || activationCreator.teamId !== task.teamId
    || participant === undefined
    || !isAgentParticipant(participant)
    || binding === undefined
    || binding.activation.teamId !== activationCreator.teamId
    || binding.activation.participantId !== activationCreator.participantId
    || binding.sessionId !== activationCreator.sessionId
    || binding.provider !== activationCreator.provider
    || (requireDeliverable && (participant.phase !== 'active'
      || (binding.activation.status !== 'idle' && binding.activation.status !== 'running')))) {
    throw malformedTeam(`task '${task.id}' has an invalid task-creation command relation`)
  }
  for (const current of projection.tasks.values()) {
    if (current.id !== task.id && sameTaskCreateCommand(current.createCommand, command)) {
      throw malformedTeam(`task '${task.id}' repeats a task-creation command`)
    }
  }
}

function sameTaskCreateCommand(
  left: TeamTaskSnapshot['createCommand'],
  right: TeamTaskSnapshot['createCommand'],
): boolean {
  return left.idempotencyKey === right.idempotencyKey
    && sameTaskCreator(left.creator, right.creator)
}

function sameTaskCreator(left: TeamTaskCommandCreator, right: TeamTaskCommandCreator): boolean {
  return isDeepStrictEqual(left, right)
}

/** Identify a task command whose durable attribution is an authenticated human, not an activation. */
function isHumanTaskCreator(creator: TeamTaskCommandCreator): creator is TeamHumanTaskCreator {
  return !('activationId' in creator)
}

/** Keep an advisory owner proposal attached to an existing Team Participant. */
function assertTaskOwnerProposal(projection: TeamProjection, task: TeamTaskSnapshot): void {
  if (task.proposedOwnerId !== undefined && !projection.participants.has(task.proposedOwnerId)) {
    throw malformedTeam(`task '${task.id}' proposes an unknown owner '${task.proposedOwnerId}'`)
  }
}

/** Preserve fields that only a task's creation record may select. */
function assertImmutableTaskFields(current: TeamTaskSnapshot, next: TeamTaskSnapshot): void {
  assertTeamCondition([
    current.parentTaskId === next.parentTaskId,
    isDeepStrictEqual(current.execution, next.execution),
    current.workflowPlanId === next.workflowPlanId,
    current.workflowTemplateId === next.workflowTemplateId,
    isDeepStrictEqual(current.requiredCapabilities, next.requiredCapabilities),
    isDeepStrictEqual(current.placement, next.placement),
    current.priority === next.priority,
    isDeepStrictEqual(current.readScopes, next.readScopes),
    isDeepStrictEqual(current.writeScopes, next.writeScopes),
    current.workspaceMode === next.workspaceMode,
    isDeepStrictEqual(current.budget, next.budget),
    isDeepStrictEqual(current.reviewPolicy, next.reviewPolicy),
    current.maxAttempts === next.maxAttempts,
    isDeepStrictEqual(current.createCommand, next.createCommand),
  ].every(Boolean), `task '${current.id}' changed immutable scheduler fields`)
}

/** Require a parent-task edge to identify an already retained non-deleted task. */
function assertTaskParent(tasks: ReadonlyMap<TeamTaskId, TeamTaskSnapshot>, task: TeamTaskSnapshot): void {
  if (task.parentTaskId === undefined) return
  if (task.parentTaskId === task.id) throw malformedTeam(`task '${task.id}' cannot parent itself`)
  const parent = tasks.get(task.parentTaskId)
  if (parent === undefined || parent.phase === 'deleted') {
    throw malformedTeam(`task '${task.id}' references missing or deleted parent '${task.parentTaskId}'`)
  }
}

/** Validate history continuity and the exact single-lease transition on one task revision. */
function assertTaskAttemptTransition(
  projection: TeamProjection,
  current: TeamTaskSnapshot,
  next: TeamTaskSnapshot,
  createdAt: number,
): void {
  if (current.blockedByOutcome !== undefined) {
    assertTeamCondition(isDeepStrictEqual(current.blockedByOutcome, next.blockedByOutcome), `task '${current.id}' rewrote its dependency outcome`)
  } else if (next.blockedByOutcome !== undefined) {
    assertTeamCondition(current.phase === 'pending' && current.attemptCount === 0 && current.cancellation === undefined,
      `task '${current.id}' received dependency cancellation after execution started`)
  }
  if (current.execution.kind === 'child-team') {
    assertTaskCancellationTransition(projection, current, next, createdAt)
    assertChildDelegationTransition(current, next, createdAt)
    if (current.delegation?.result === undefined && next.delegation?.result !== undefined) {
      const result = next.delegation.result
      if (result.parentCursor !== projection.team.cursor + 1 || result.parentTaskRevision !== next.revision
        || result.admittedAt !== createdAt
        || result.binding.parentTeamId !== next.teamId || result.binding.parentTaskId !== next.id
        || result.binding.delegationId !== next.delegation.id || result.binding.childTeamId !== next.delegation.childTeamId
        || (current.delegation?.phase !== 'creating' && current.delegation?.phase !== 'active') || next.delegation.phase !== 'settling') {
        throw malformedTeam(`child task '${next.id}' has invalid parent result admission`)
      }
    }
    return
  }
  assertTaskCancellationTransition(projection, current, next, createdAt)
  const currentLease = current.lease
  const nextLease = next.lease
  if (currentLease === undefined) {
    if (nextLease === undefined) {
      assertTeamCondition([
        isDeepStrictEqual(current.attemptHistory, next.attemptHistory),
        current.attemptCount === next.attemptCount,
      ].every(Boolean), `task '${current.id}' changed settled attempt history without a lease`)
      assertTaskReviewTransition(projection, current, next, createdAt)
      return
    }
    assertLiveTaskAttemptOwner(projection, current, nextLease, createdAt)
    assertNewLease(projection, current, next, nextLease, createdAt)
    return
  }
  if (nextLease === undefined) {
    assertLeaseBoundTaskDetails(current, next)
    assertSettledLease(projection, current, next, currentLease, createdAt)
    return
  }
  assertLeaseBoundTaskDetails(current, next)
  if (next.cancellation === undefined) assertLiveTaskAttemptOwner(projection, current, currentLease, createdAt)
  else assertTaskAttemptOwner(projection, current, currentLease, true)
  assertContinuedLease(current, next, currentLease, nextLease, createdAt)
}

/** Validate the child saga without inventing a Participant lease or attempt history. */
function assertChildDelegationTransition(current: TeamTaskSnapshot, next: TeamTaskSnapshot, createdAt: number): void {
  const prior = current.delegation
  const delegation = next.delegation
  if (prior === undefined || delegation === undefined || prior.id !== delegation.id || prior.requestedAt !== delegation.requestedAt
    || (prior.childTeamId !== undefined && prior.childTeamId !== delegation.childTeamId)
    || (prior.creation !== undefined && !isDeepStrictEqual(prior.creation, delegation.creation))
    || (prior.startedAt !== undefined && prior.startedAt !== delegation.startedAt)
    || (prior.result !== undefined && !isDeepStrictEqual(prior.result, delegation.result))) {
    throw malformedTeam(`child task '${current.id}' changed its exact delegation identity, creation, or admitted result`)
  }
  if (isDeepStrictEqual(prior, delegation)) {
    if (current.phase !== next.phase && next.phase !== 'deleted') throw malformedTeam(`child task '${current.id}' changed phase without delegation settlement`)
    return
  }
  if (delegation.updatedAt !== createdAt || next.lease !== undefined || next.attemptHistory.length !== 0
    || next.reviewHistory.length !== 0 || next.attemptCount !== (delegation.startedAt === undefined ? 0 : 1)) {
    throw malformedTeam(`child task '${current.id}' has inconsistent delegation time or Participant attempt state`)
  }
  const permitted: Readonly<Record<typeof prior.phase, readonly typeof prior.phase[]>> = {
    requested: ['creating', 'stalled', 'cancelled'],
    creating: ['creating', 'active', 'settling', 'stalled', 'failed', 'cancelled'],
    active: ['settling', 'stalled', 'failed', 'cancelled'],
    settling: ['completed', 'stalled', 'failed', 'cancelled'],
    stalled: ['creating', 'active', 'settling', 'stalled', 'completed', 'failed', 'cancelled'],
    completed: [], failed: [], cancelled: [],
  }
  if (!permitted[prior.phase].includes(delegation.phase)) throw malformedTeam(`child task '${current.id}' has an invalid delegation transition`)
  if (prior.childCursor !== undefined && (delegation.childCursor === undefined || delegation.childCursor < prior.childCursor)) {
    throw malformedTeam(`child task '${current.id}' rewound its observed child cursor`)
  }
  if (prior.startedAt === undefined && delegation.startedAt !== undefined && delegation.startedAt !== createdAt) {
    throw malformedTeam(`child task '${current.id}' has an invalid execution reservation timestamp`)
  }
  if (prior.startedAt !== undefined) assertLeaseBoundTaskDetails(current, next)
}

/** Validate assignment of the next non-reusable attempt after a lease-free task revision. */
function assertNewLease(
  projection: TeamProjection,
  current: TeamTaskSnapshot,
  next: TeamTaskSnapshot,
  lease: TaskLeaseSnapshot,
  createdAt: number,
): void {
  assertTeamCondition([
    current.phase === 'pending',
    next.phase === 'assigned',
    next.attemptCount === current.attemptCount + 1,
    isDeepStrictEqual(next.attemptHistory, current.attemptHistory),
    isDeepStrictEqual(next.reviewHistory, current.reviewHistory),
    current.proposedOwnerId === next.proposedOwnerId,
    lease.assignedRevision === next.revision,
    lease.ordinal === next.attemptCount,
    lease.assignedAt === createdAt,
    lease.renewedAt === createdAt,
    lease.startedAt === undefined,
    lease.wakeChannelId === undefined || projection.channelIds.has(lease.wakeChannelId),
    lease.wakeChannelId === undefined || [...projection.tasks.values()]
      .every(task => task.id === current.id || task.lease?.wakeChannelId !== lease.wakeChannelId),
  ].every(Boolean), `task '${current.id}' has an invalid new lease transition`)
}

/** Preserve the task details that lease-free edits exclusively own. */
function assertLeaseBoundTaskDetails(current: TeamTaskSnapshot, next: TeamTaskSnapshot): void {
  assertTeamCondition([
    current.subject === next.subject,
    current.description === next.description,
    isDeepStrictEqual(current.blockedBy, next.blockedBy),
    isDeepStrictEqual(current.reviewHistory, next.reviewHistory),
    current.proposedOwnerId === next.proposedOwnerId,
  ].every(Boolean), `task '${current.id}' changed editable details while leased`)
}

/** Validate endpoint identities against the child's own durable roster and attached channels. */
function assertChildRunBinding(projection: TeamProjection, binding: import('@clocky/clocky-team').TeamChildRunBinding): void {
  const service = projection.participants.get(binding.parentServiceId)
  const coordinator = projection.participants.get(binding.coordinatorId)
  if (projection.team.id !== binding.childTeamId || projection.team.parentTeamId !== binding.parentTeamId
    || projection.team.parentTaskId !== binding.parentTaskId || service?.kind !== 'service' || service.role !== 'parent-service'
    || coordinator?.role !== 'coordinator' || !isAgentParticipant(coordinator)
    || !projection.channelIds.has(binding.channelId)) {
    throw malformedTeam('child runtime binding does not match its lineage, endpoints or attached result channel')
  }
}

/** Verify child-side sink facts without turning a durable parent reference back into runtime authority. */
function assertChildResultAdmission(projection: TeamProjection, admission: import('@clocky/clocky-team').TeamChildResultAdmission): void {
  const binding = projection.team.childRun
  const parent = admission.parent
  if (binding === undefined || !isDeepStrictEqual(binding, parent.binding)
    || projection.team.parentTeamId !== binding.parentTeamId || projection.team.parentTaskId !== binding.parentTaskId
    || admission.admittedAt < projection.team.createdAt || admission.admittedAt < parent.admittedAt
    || projection.finalAdmission !== null
    || projection.team.closure?.kind === 'complete' && (projection.team.closure.finalChannelId !== binding.channelId
      || projection.team.closure.finalEnvelopeId !== parent.responseEnvelopeId)) {
    throw malformedTeam('child result admission differs from its lineage, bound endpoints or parent result')
  }
  assertChildRunBinding(projection, binding)
}

/** Validate a task attempt owner against membership, capabilities, and its optional residency epoch. */
function assertTaskAttemptOwner(
  projection: TeamProjection,
  task: TeamTaskSnapshot,
  attempt: Pick<TaskLeaseSnapshot, 'participantId' | 'activationId'>,
  requireLive: boolean,
): void {
  const participant = projection.participants.get(attempt.participantId)
  if (participant === undefined || (requireLive && participant.phase !== 'active')) {
    throw malformedTeam(`task '${task.id}' attempt owner '${attempt.participantId}' is not available`)
  }
  assertTeamCondition(task.requiredCapabilities.every(capability => participant.capabilities.includes(capability)),
    `task '${task.id}' attempt owner '${participant.id}' lacks a required capability`)
  const executionProvider = attempt.activationId === undefined
    ? participant.provider : projection.activations.get(attempt.activationId)?.provider
  const selection = attempt.activationId === undefined ? {} : projection.activations.get(attempt.activationId)?.selection ?? {}
  assertTeamCondition(matchesTaskPlacement(task.placement, participant, executionProvider, selection),
    `task '${task.id}' attempt owner '${participant.id}' violates placement restrictions`)
  if (!isAgentParticipant(participant)) {
    if (attempt.activationId !== undefined) {
      throw malformedTeam(`non-agent participant '${participant.id}' cannot retain a task activation`)
    }
    return
  }
  if (attempt.activationId === undefined) {
    throw malformedTeam(`agent participant '${participant.id}' task lease lacks an activation`)
  }
  const binding = projection.activations.get(attempt.activationId)
  if (binding === undefined
    || binding.activation.participantId !== participant.id
    || binding.activation.teamId !== projection.team.id
    || (requireLive && binding.activation.status !== 'idle' && binding.activation.status !== 'running')) {
    throw malformedTeam(`task attempt activation '${attempt.activationId}' is not valid for '${participant.id}'`)
  }
}

/** Validate every checkpointed task attempt against its owner and frozen task requirements. */
function assertCheckpointTaskAttempts(projection: TeamProjection, task: TeamTaskSnapshot): void {
  assertTaskDependencyOutcome(projection, task)
  if (task.cancellation !== undefined && !projection.participants.has(task.cancellation.requestedBy)) {
    throw malformedTeam(`checkpoint task '${task.id}' cancellation references an unknown requesting participant`)
  }
  assertTaskReviewHistory(projection, task)
  for (const attempt of task.attemptHistory) {
    assertTaskAttemptOwner(projection, task, attempt, false)
    if (attempt.wakeChannelId !== undefined && !projection.channelIds.has(attempt.wakeChannelId)) {
      throw malformedTeam(`checkpoint task '${task.id}' attempt '${attempt.id}' references unattached wake channel '${attempt.wakeChannelId}'`)
    }
  }
  if (task.lease !== undefined) {
    assertTaskAttemptOwner(projection, task, task.lease, false)
    if (task.lease.wakeChannelId !== undefined && !projection.channelIds.has(task.lease.wakeChannelId)) {
      throw malformedTeam(`checkpoint task '${task.id}' references unattached wake channel '${task.lease.wakeChannelId}'`)
    }
    return
  }
  const last = task.attemptHistory.at(-1)
  if (last !== undefined) assertCheckpointTerminalPhase(task, last.outcome)
}

/** Ensure a recovered Team cannot let two current attempts own one wake channel. */
function assertDistinctCurrentWakeChannels(projection: TeamProjection): void {
  const channels = new Set<ChannelId>()
  for (const task of projection.tasks.values()) {
    const channelId = task.lease?.wakeChannelId
    if (channelId === undefined) continue
    if (channels.has(channelId)) {
      throw malformedTeam(`checkpoint wake channel '${channelId}' belongs to multiple current task leases`)
    }
    channels.add(channelId)
  }
}

/** Verify a lease-free checkpoint phase remains reachable after its retained terminal attempt. */
function assertCheckpointTerminalPhase(task: TeamTaskSnapshot, outcome: TaskAttemptOutcome): void {
  const permitted = outcome.kind === 'completed'
    ? ['review', 'pending', 'completed', 'failed', 'cancelled', 'deleted']
    : outcome.kind === 'cancelled'
      ? ['cancelled']
      : ['pending', 'failed', 'cancelled', 'deleted']
  if (!permitted.includes(task.phase)) {
    throw malformedTeam(`checkpoint task '${task.id}' phase '${task.phase}' conflicts with '${outcome.kind}' attempt outcome`)
  }
}

/** Reject ordinary lease writes that occur after the retained deadline or lose current owner authority. */
function assertLiveTaskAttemptOwner(
  projection: TeamProjection,
  task: TeamTaskSnapshot,
  lease: TaskLeaseSnapshot,
  createdAt: number,
): void {
  if (createdAt >= lease.expiresAt) {
    throw malformedTeam(`task '${task.id}' changed a lease after its expiry`)
  }
  assertTaskAttemptOwner(projection, task, lease, true)
}

/** Validate a current lease's start or renewal while it retains its immutable identity. */
function assertContinuedLease(
  current: TeamTaskSnapshot,
  next: TeamTaskSnapshot,
  currentLease: TaskLeaseSnapshot,
  nextLease: TaskLeaseSnapshot,
  createdAt: number,
): void {
  assertTeamCondition([
    isDeepStrictEqual(current.attemptHistory, next.attemptHistory),
    isDeepStrictEqual(current.reviewHistory, next.reviewHistory),
    current.attemptCount === next.attemptCount,
    currentLease.attemptId === nextLease.attemptId,
    currentLease.assignedRevision === nextLease.assignedRevision,
    currentLease.ordinal === nextLease.ordinal,
    currentLease.participantId === nextLease.participantId,
    currentLease.activationId === nextLease.activationId,
    currentLease.wakeChannelId === nextLease.wakeChannelId,
    currentLease.assignedAt === nextLease.assignedAt,
    currentLease.durationMs === nextLease.durationMs,
    nextLease.renewedAt >= currentLease.renewedAt,
    nextLease.renewedAt === currentLease.renewedAt || nextLease.renewedAt === createdAt,
  ].every(Boolean), `task '${current.id}' changed immutable current-lease fields`)
  if (currentLease.startedAt === undefined) {
    if (nextLease.startedAt !== undefined) {
      assertTeamCondition([
        next.phase === 'running',
        current.phase === 'assigned',
        nextLease.startedAt === createdAt,
        nextLease.renewedAt === currentLease.renewedAt,
      ].every(Boolean), `task '${current.id}' has an invalid attempt-start transition`)
      return
    }
    assertTeamCondition([next.phase === 'assigned', current.phase === 'assigned'].every(Boolean),
      `task '${current.id}' changed its unstarted lease phase`)
    return
  }
  assertTeamCondition([
    nextLease.startedAt === currentLease.startedAt,
    current.phase === 'running',
    next.phase === 'running',
  ].every(Boolean), `task '${current.id}' changed its started lease identity`)
}

/** Require a review decision only when a review task returns to pending or completes. */
function assertTaskReviewTransition(
  projection: TeamProjection,
  current: TeamTaskSnapshot,
  next: TeamTaskSnapshot,
  createdAt: number,
): void {
  const requiresDecision = current.phase === 'review'
    && (next.phase === 'pending' || next.phase === 'completed')
  if (!requiresDecision) {
    assertTeamCondition(isDeepStrictEqual(current.reviewHistory, next.reviewHistory),
      `task '${current.id}' changed review history outside review resolution`)
    return
  }
  assertTeamCondition(next.reviewHistory.length === current.reviewHistory.length + 1,
    `task '${current.id}' review resolution must append exactly one decision`)
  assertTeamCondition(isDeepStrictEqual(next.reviewHistory.slice(0, -1), current.reviewHistory),
    `task '${current.id}' review resolution rewrote prior decisions`)
  const decision = next.reviewHistory.at(-1)
  // v8 ignore next -- the preceding exact-length assertion guarantees an array tail exists.
  if (decision === undefined) throw malformedTeam(`task '${current.id}' review resolution lacks a decision`)
  const attempt = current.attemptHistory.at(-1)
  assertTeamCondition(attempt?.outcome.kind === 'completed'
    && decision.attemptId === attempt.id
    && decision.decidedAt >= attempt.settledAt,
  `task '${current.id}' review decision does not resolve its completed attempt`)
  assertReviewDecision(projection, current, decision, createdAt)
  assertTeamCondition(decision.nextPhase === next.phase,
    `task '${current.id}' review decision phase does not match its task transition`)
}

/** Validate the immutable reviewer route and every retained completed-attempt decision. */
function assertTaskReviewHistory(projection: TeamProjection, task: TeamTaskSnapshot): void {
  if (task.reviewPolicy.kind === 'none') {
    assertTeamCondition(task.reviewHistory.length === 0 && task.phase !== 'review',
      `task '${task.id}' has review state without a reviewer policy`)
    return
  }
  assertTeamCondition(projection.participants.has(task.reviewPolicy.reviewerId),
    `task '${task.id}' names an unknown review participant '${task.reviewPolicy.reviewerId}'`)
  const decisions = new Map<TaskAttemptSnapshot['id'], TeamTaskReviewDecision>()
  let priorAttemptIndex = -1
  let priorDecidedAt = -1
  for (const decision of task.reviewHistory) {
    if (decisions.has(decision.attemptId)) {
      throw malformedTeam(`task '${task.id}' repeats review decision for attempt '${decision.attemptId}'`)
    }
    const attemptIndex = task.attemptHistory.findIndex(attempt => attempt.id === decision.attemptId)
    const attempt = attemptIndex < 0 ? undefined : task.attemptHistory[attemptIndex]
    assertTeamCondition(
      attempt?.outcome.kind === 'completed'
      && attemptIndex > priorAttemptIndex
      && decision.reviewerId === task.reviewPolicy.reviewerId
      && projection.participants.has(decision.reviewerId)
      && typeof decision.reason === 'string'
      && decision.reason.trim().length > 0
      && decision.reason === decision.reason.trim()
      && decision.decidedAt >= attempt.settledAt
      && decision.decidedAt >= priorDecidedAt,
      `task '${task.id}' has an invalid review decision`,
    )
    decisions.set(decision.attemptId, decision)
    priorAttemptIndex = attemptIndex
    priorDecidedAt = decision.decidedAt
  }
  const completed = task.attemptHistory.filter(attempt => attempt.outcome.kind === 'completed')
  const unresolved = completed.filter(attempt => !decisions.has(attempt.id))
  const latest = task.attemptHistory.at(-1)
  if (task.phase === 'review') {
    assertTeamCondition(
      latest?.outcome.kind === 'completed'
      && unresolved.length === 1
      && unresolved[0]?.id === latest.id,
      `task '${task.id}' review phase lacks exactly one unresolved completed attempt`,
    )
    return
  }
  if (task.phase === 'cancelled') return
  assertTeamCondition(unresolved.length === 0,
    `task '${task.id}' has an unresolved completed attempt outside review`)
  if (task.lease !== undefined) return
  if (latest?.outcome.kind !== 'completed') return
  const decision = decisions.get(latest.id)
  assertTeamCondition(decision?.nextPhase === task.phase,
    `task '${task.id}' latest review decision conflicts with its phase`)
}

/** Validate the one decision appended by the current review-resolution record. */
function assertReviewDecision(
  projection: TeamProjection,
  task: TeamTaskSnapshot,
  decision: TeamTaskReviewDecision,
  createdAt: number,
): void {
  assertTeamCondition(
    task.reviewPolicy.kind === 'participant'
    && decision.reviewerId === task.reviewPolicy.reviewerId
    && projection.participants.get(decision.reviewerId)?.phase === 'active'
    && typeof decision.reason === 'string'
    && decision.reason.trim().length > 0
    && decision.reason === decision.reason.trim()
    && decision.decidedAt === createdAt,
    `task '${task.id}' review resolution has an invalid reviewer or decision`,
  )
}

/** Validate exactly one terminal attempt record replacing the prior current lease. */
function assertSettledLease(
  projection: TeamProjection,
  current: TeamTaskSnapshot,
  next: TeamTaskSnapshot,
  lease: TaskLeaseSnapshot,
  createdAt: number,
): void {
  assertTeamCondition([
    next.attemptCount === current.attemptCount,
    next.attemptHistory.length === current.attemptHistory.length + 1,
    isDeepStrictEqual(next.attemptHistory.slice(0, -1), current.attemptHistory),
    isDeepStrictEqual(next.reviewHistory, current.reviewHistory),
  ].every(Boolean), `task '${current.id}' did not append exactly one terminal attempt`)
  const attempt = next.attemptHistory.at(-1)
  assertTeamCondition(attempt !== undefined && matchesLease(attempt, current, lease) && attempt.settledAt === createdAt,
    `task '${current.id}' terminal attempt does not match its current lease`)
  if (attempt.outcome.kind === 'completed' && current.reviewPolicy.kind === 'participant'
    && projection.participants.get(current.reviewPolicy.reviewerId)?.phase !== 'active') {
    throw malformedTeam(`task '${current.id}' completed without an active configured reviewer`)
  }
  if (attempt.outcome.kind === 'lease-expired') {
    if (attempt.settledAt < lease.expiresAt) {
      throw malformedTeam(`task '${current.id}' expired its lease before its deadline`)
    }
    assertTaskAttemptOwner(projection, current, lease, false)
  } else if (attempt.settledAt >= lease.expiresAt && !(current.cancellation !== undefined && attempt.outcome.kind === 'cancelled')) {
    throw malformedTeam(`task '${current.id}' settled an expired lease without a lease-expired outcome`)
  } else {
    const closureRelease = attempt.outcome.kind === 'released'
      && (current.cancellation !== undefined || projection.team.closure !== undefined || projection.team.cancellation !== undefined)
    assertTaskAttemptOwner(projection, current, lease, !closureRelease)
  }
  assertAttemptOutcomeTaskPhase(projection, current, next.phase, attempt.outcome)
}

/** Match an immutable attempt-history row to the lease it closes. */
function matchesLease(attempt: TaskAttemptSnapshot, task: TeamTaskSnapshot, lease: TaskLeaseSnapshot): boolean {
  return [
    attempt.id === lease.attemptId,
    attempt.teamId === task.teamId,
    attempt.taskId === task.id,
    attempt.ordinal === lease.ordinal,
    attempt.participantId === lease.participantId,
    attempt.activationId === lease.activationId,
    attempt.wakeChannelId === lease.wakeChannelId,
    attempt.assignedAt === lease.assignedAt,
    attempt.startedAt === lease.startedAt,
    attempt.leaseExpiresAt === lease.expiresAt,
  ].every(Boolean)
}

/** Enforce the terminal attempt result's one permitted task-phase family. */
function assertAttemptOutcomeTaskPhase(
  projection: TeamProjection,
  task: TeamTaskSnapshot,
  next: TeamTaskSnapshot['phase'],
  outcome: TaskAttemptOutcome,
): void {
  const expected = outcome.kind === 'completed'
    ? task.reviewPolicy.kind === 'none' ? 'completed' : 'review'
    : outcome.kind === 'cancelled'
      ? 'cancelled'
      : task.attemptCount >= task.maxAttempts
        ? 'failed'
        : 'pending'
  if (next === expected) return
  if (next === 'cancelled' && (outcome.kind === 'released' || outcome.kind === 'lease-expired')
    && (task.cancellation !== undefined || projection.team.closure !== undefined || projection.team.cancellation !== undefined)) return
  throw malformedTeam(`task attempt outcome '${outcome.kind}' cannot move '${task.phase}' to '${next}'`)
}

/** Fold one durable binding while preserving its immutable activation identity. */
function foldActivation(
  previous: TeamProjection,
  record: Extract<TeamJournalRecord, { readonly type: 'activation/changed' }>,
  team: TeamProjection['team'],
  streamTeamId: TeamId,
): TeamProjection {
  const binding = record.binding
  const activation = binding.activation
  const participant = previous.participants.get(activation.participantId)
  const current = previous.activations.get(activation.id)
  if (activation.teamId !== streamTeamId
    || participant === undefined
    || !isAgentParticipant(participant)
    || (current === undefined && participant.phase !== 'active')) {
    throw malformedTeam(`activation '${activation.id}' has an invalid Team participant relation`)
  }
  if (current === undefined) {
    if (liveActivationLimit(previous.budgets, previous.team.authorityGrant) !== undefined
      || participant.authorityGrant?.budgets.maxLiveActivations !== undefined || binding.reservationId !== undefined) {
      const reservation = participant.activationReservation
      assertTeamCondition(reservation !== undefined && reservation.id === binding.reservationId
        && reservation.releasedAt === undefined && reservation.sessionId === binding.sessionId && reservation.provider === binding.provider,
      'Activation has no exact startup reservation')
      assertTeamCondition(![...previous.activations.values()].some(value => value.reservationId === binding.reservationId),
        'Startup reservation publishes more than one epoch')
    }
    if (binding.fencedAt !== undefined || binding.quiescedAt !== undefined || binding.quiescenceSource !== undefined) {
      throw malformedTeam(`activation '${activation.id}' cannot publish a quiescence proof`)
    }
    for (const candidate of previous.activations.values()) {
      if (candidate.activation.participantId !== activation.participantId) continue
      if (candidate.sessionId !== binding.sessionId) {
        throw malformedTeam(`activation '${activation.id}' changes the participant Session`)
      }
      if (candidate.activation.status !== 'offline') {
        throw malformedTeam(`participant '${activation.participantId}' already has a resident activation`)
      }
    }
    assertTeamTransition(() => { assertActivationStatusTransition(undefined, activation.status) })
  } else {
    if (current.reservationId !== binding.reservationId
      || current.activation.id !== activation.id
      || current.activation.teamId !== activation.teamId
      || current.activation.participantId !== activation.participantId
      || current.sessionId !== binding.sessionId
      || current.provider !== binding.provider
      || !isDeepStrictEqual(current.selection, binding.selection)
      || !isDeepStrictEqual(current.recovery, binding.recovery)
      || (current.fencedAt !== undefined && binding.fencedAt !== current.fencedAt)
      || (current.quiescedAt !== undefined && binding.quiescedAt !== current.quiescedAt)
      || (current.quiescenceSource !== undefined && binding.quiescenceSource !== current.quiescenceSource)
      || (current.quiescedWakeChannelIds !== undefined
        && !isDeepStrictEqual(current.quiescedWakeChannelIds, binding.quiescedWakeChannelIds))) {
      throw malformedTeam(`activation '${activation.id}' changed immutable binding fields`)
    }
    const newlyFenced = current.fencedAt === undefined && binding.fencedAt !== undefined
    if (newlyFenced && (binding.fencedAt !== record.createdAt
      || (previous.team.closure === undefined && previous.team.cancellation === undefined))) {
      throw malformedTeam(`activation '${activation.id}' has no closure-owned fence proof`)
    }
    const newlyQuiesced = current.quiescedAt === undefined && binding.quiescedAt !== undefined
    if (newlyQuiesced) {
      if (binding.quiescedAt !== record.createdAt) {
        throw malformedTeam(`activation '${activation.id}' has an invalid quiescence proof`)
      }
      assertQuiescenceProof(previous, binding)
      if (current.activation.status !== 'offline') {
        assertTeamTransition(() => { assertActivationStatusTransition(current.activation.status, activation.status) })
      }
    } else if (!newlyFenced || current.activation.status !== activation.status) {
      assertTeamTransition(() => { assertActivationStatusTransition(current.activation.status, activation.status) })
    }
  }
  const activations = new Map(previous.activations)
  activations.set(activation.id, structuredClone(binding))
  const projection = { ...previous, team, activations }
  assertActivationCapacity(projection)
  return projection
}

/** Derive the exact wake channels retained by task attempts settled in one activation quiescence. */
function quiescedWakeChannelIds(
  projection: TeamProjection,
  activationId: ActivationId,
  quiescedAt: number,
): Set<ChannelId> {
  const channels = new Set<ChannelId>()
  for (const task of projection.tasks.values()) {
    for (const attempt of task.attemptHistory) {
      if (attempt.activationId !== activationId || attempt.settledAt !== quiescedAt) continue
      if (attempt.outcome.kind !== 'released' && attempt.outcome.kind !== 'lease-expired') {
        throw malformedTeam(`activation '${activationId}' quiescence proof retains a non-quiescence task outcome`)
      }
      if (attempt.wakeChannelId !== undefined) channels.add(attempt.wakeChannelId)
    }
  }
  return channels
}

/** Verify one durable quiescence proof against the task attempts and channels it retires. */
function assertQuiescenceProof(projection: TeamProjection, binding: ActivationBindingSnapshot): void {
  if (binding.quiescedAt === undefined) return
  const expectedWakeChannelIds = quiescedWakeChannelIds(projection, binding.activation.id, binding.quiescedAt)
  const actualWakeChannelIds = new Set(binding.quiescedWakeChannelIds)
  if (actualWakeChannelIds.size !== expectedWakeChannelIds.size
    || [...actualWakeChannelIds].some(channelId => !expectedWakeChannelIds.has(channelId))) {
    throw malformedTeam(`activation '${binding.activation.id}' quiescence proof does not match its released task wakes`)
  }
  if ([...projection.tasks.values()].some(task => task.lease?.activationId === binding.activation.id)) {
    throw malformedTeam(`activation '${binding.activation.id}' quiescence proof retains an active task lease`)
  }
}

/** Fold one new soft-interrupt request after validating its live target relation. */
function foldParticipantInterruptRequest(
  previous: TeamProjection,
  record: Extract<TeamJournalRecord, { readonly type: 'participant-interrupt/requested' }>,
  team: TeamProjection['team'],
  streamTeamId: TeamId,
): TeamProjection {
  const { interrupt } = record
  if (interrupt.requestedAt !== record.createdAt || interrupt.acknowledgedAt !== undefined) {
    throw malformedTeam(`participant interrupt '${interrupt.id}' has an invalid request timestamp`)
  }
  if (previous.interrupts.has(interrupt.id)) {
    throw malformedTeam(`participant interrupt '${interrupt.id}' is requested twice`)
  }
  if (previous.participants.get(interrupt.actorId)?.phase !== 'active') {
    throw malformedTeam(`participant interrupt '${interrupt.id}' has an inactive actor`)
  }
  assertInterruptRelation(streamTeamId, previous.participants, previous.activations, interrupt.target, 'deliverable')
  const interrupts = new Map(previous.interrupts)
  interrupts.set(interrupt.id, structuredClone(interrupt))
  return { ...previous, team, interrupts }
}

/** Fold one exact-target acknowledgement without allowing an interrupt to be reopened or retargeted. */
function foldParticipantInterruptAcknowledgement(
  previous: TeamProjection,
  record: Extract<TeamJournalRecord, { readonly type: 'participant-interrupt/acknowledged' }>,
  team: TeamProjection['team'],
  streamTeamId: TeamId,
): TeamProjection {
  const current = previous.interrupts.get(record.interruptId)
  if (current === undefined) {
    throw malformedTeam(`participant interrupt '${record.interruptId}' is acknowledged before its request`)
  }
  if (current.acknowledgedAt !== undefined) {
    throw malformedTeam(`participant interrupt '${record.interruptId}' is acknowledged twice`)
  }
  if (!isDeepStrictEqual(current.target, record.target)) {
    throw malformedTeam(`participant interrupt '${record.interruptId}' acknowledgement changes its target`)
  }
  assertInterruptRelation(streamTeamId, previous.participants, previous.activations, record.target, 'acknowledging')
  const interrupt: ParticipantInterruptSnapshot = { ...current, acknowledgedAt: record.createdAt }
  const interrupts = new Map(previous.interrupts)
  interrupts.set(interrupt.id, interrupt)
  return { ...previous, team, interrupts }
}

/** Validate that an interrupt target remains attached to one exact durable activation binding. */
function assertInterruptRelation(
  teamId: TeamId,
  participants: ReadonlyMap<ParticipantId, { readonly kind: string; readonly phase: string }>,
  activations: ReadonlyMap<ActivationId, ActivationBindingSnapshot>,
  target: ParticipantInterruptTarget,
  status: 'any' | 'deliverable' | 'acknowledging' = 'any',
): void {
  const participant = participants.get(target.participantId)
  const binding = activations.get(target.activationId)
  if (target.teamId !== teamId
    || participant === undefined
    || !isAgentParticipant(participant)
    || binding === undefined
    || binding.activation.teamId !== target.teamId
    || binding.activation.participantId !== target.participantId
    || binding.sessionId !== target.sessionId
    || binding.provider !== target.provider) {
    throw malformedTeam(`participant interrupt target '${target.activationId}' has an invalid binding relation`)
  }
  const deliverable = binding.activation.status === 'idle' || binding.activation.status === 'running'
  const acknowledging = deliverable || binding.activation.status === 'stopping'
  if ((status === 'deliverable' && (participant.phase !== 'active' || !deliverable))
    || (status === 'acknowledging' && (participant.phase !== 'active' || !acknowledging))) {
    throw malformedTeam(`participant interrupt target '${target.activationId}' is not deliverable`)
  }
}

/** Whether a durable participant kind can own an activation epoch. */
function isAgentParticipant(participant: { readonly kind: string }): boolean {
  return participant.kind === 'local-agent' || participant.kind === 'remote-agent'
}

/** Validate the complete live task dependency graph after one candidate replacement. */
function assertTaskGraph(
  tasks: ReadonlyMap<TeamTaskId, TeamTaskSnapshot>, transientDeletedBlockerId?: TeamTaskId,
): void {
  for (const task of tasks.values()) {
    if (task.phase === 'deleted') continue
    assertTaskParent(tasks, task)
    for (const blockerId of task.blockedBy) {
      if (blockerId === task.id) throw malformedTeam(`task '${task.id}' cannot block itself`)
      const blocker = tasks.get(blockerId)
      const retainedDeletedCause = task.phase === 'cancelled' && task.blockedByOutcome?.taskId === blockerId
        && task.blockedByOutcome.phase === 'deleted'
      const transientChildCause = task.phase === 'pending' && task.execution.kind === 'child-team'
        && task.delegation?.phase === 'requested' && task.delegation.childTeamId === undefined
        && transientDeletedBlockerId === blockerId
      if (blocker === undefined
        || blocker.phase === 'deleted' && !retainedDeletedCause && !transientChildCause) {
        throw malformedTeam(`task '${task.id}' references missing or deleted blocker '${blockerId}'`)
      }
    }
  }
  const visiting = new Set<TeamTaskId>()
  const visited = new Set<TeamTaskId>()
  const visit = (id: TeamTaskId): void => {
    if (visiting.has(id)) throw malformedTeam(`task dependency cycle includes '${id}'`)
    if (visited.has(id)) return
    const task = tasks.get(id)
    if (task === undefined || task.phase === 'deleted') return
    visiting.add(id)
    for (const blockerId of task.blockedBy) visit(blockerId)
    visiting.delete(id)
    visited.add(id)
  }
  for (const task of tasks.values()) visit(task.id)
}

/**
 * Apply one parsed channel WAL record at its durable storage cursor.
 * @param previous - prior channel projection, or `undefined` before its opening record.
 * @param record - validated next channel WAL record.
 * @param cursor - storage cursor assigned to `record`.
 * @param streamChannelId - channel identity encoded by the owning stream name.
 * @param adapter - exact adapter frozen by the channel manifest.
 * @returns the next mutable channel projection.
 */
export function foldChannelRecord(
  previous: ChannelProjection | undefined,
  record: ChannelRecord,
  cursor: number,
  streamChannelId: ChannelId,
  adapter: TeamChannelAdapter,
): ChannelProjection {
  if (channelRecordCursor(record) !== cursor) {
    throw malformedChannel(`record cursor ${channelRecordCursor(record)} does not match storage cursor ${cursor}`)
  }
  if (previous === undefined) {
    if (cursor !== 0 || record.type !== 'channel/opened') {
      throw malformedChannel('first record must be channel/opened at cursor 0')
    }
    if (record.manifest.id !== streamChannelId) {
      throw malformedChannel(`stream '${streamChannelId}' starts with channel '${record.manifest.id}'`)
    }
    assertManifest(record.manifest)
    assertChannelTransition(() => { assertChannelPhaseTransition(undefined, 'pending') })
    callAdapter(() => { adapter.validateCreate(immutable(record.manifest)) })
    const initial = normalizeState(callAdapter(() => adapter.initialState(immutable(record.manifest))))
    return {
      invitations: new Map(),
      manifest: structuredClone(record.manifest),
      phase: 'pending',
      cursor,
      state: foldAdapterState(adapter, initial, record),
      pendingDeliveries: new Map(),
      receiptCursors: new Map(),
      postIdempotency: new Map(),
      summaries: new Map(),
    }
  }
  if (cursor !== previous.cursor + 1) {
    throw malformedChannel(`cursor ${cursor} does not follow ${previous.cursor}`)
  }
  validateChannelRecordOwner(record, previous.manifest)
  switch (record.type) {
    case 'channel/opened':
      throw malformedChannel('channel/opened appears after the first record')
    case 'channel/invitation':
    case 'channel/acknowledged':
    case 'channel/invitation-ended': {
      const invitation = record.invitation
      const old = previous.invitations.get(invitation.participantId)
      validateInvitation(previous.manifest, invitation)
      if (record.type === 'channel/invitation') {
        if (previous.phase !== 'pending' || old !== undefined || invitation.status !== 'pending'
          || invitation.revision !== 1 || invitation.deadline <= record.createdAt) throw malformedChannel('invalid opening invitation')
      } else {
        if (old === undefined || old.status !== 'pending' || !['pending', 'active', 'closing'].includes(previous.phase)
          || invitation.settledAt !== record.createdAt
          || !isDeepStrictEqual({ ...invitation, status: 'pending', acknowledgementKey: undefined, settledAt: undefined, reason: undefined },
            { ...old, acknowledgementKey: undefined, settledAt: undefined, reason: undefined })) throw malformedChannel('invalid invitation transition')
        if (record.type === 'channel/acknowledged'
          ? previous.phase === 'closing' || invitation.status !== 'acknowledged' || invitation.acknowledgementKey === undefined || record.createdAt >= old.deadline
          : !['expired', 'cancelled'].includes(invitation.status) || invitation.acknowledgementKey !== undefined) {
          throw malformedChannel('invitation status does not match its record')
        }
      }
      if (record.type === 'channel/invitation-ended') {
        if (invitation.reason === undefined || (invitation.status === 'expired' && record.createdAt < invitation.deadline)) {
          throw malformedChannel('invitation ended without a due deadline or structured reason')
        }
        if (previous.phase !== 'closing') {
          const retained = [...previous.invitations.values()].filter(value => value.participantId !== invitation.participantId
            && !['expired', 'cancelled'].includes(value.status)).map(value => value.participantId)
          if (invitation.required || invitation.status !== 'expired' || callAdapter(() => adapter.allowParticipantRemoval?.({
            manifest: immutable(previous.manifest), state: immutable(previous.state), participantId: invitation.participantId,
            retainedParticipantIds: Object.freeze(retained),
          })) !== true) throw malformedChannel('optional invitation removal is not authorized by the protocol')
        }
      }
      const invitations = new Map(previous.invitations)
      invitations.set(invitation.participantId, structuredClone(invitation))
      return { ...previous, cursor, invitations, state: foldAdapterState(adapter, previous.state, record) }
    }
    case 'channel/phase':
    case 'channel/closed':
      if (!(record.type === 'channel/phase' && record.phase === 'pending' && previous.phase === 'pending' && previous.cursor === 0)) {
        assertChannelTransition(() => { assertChannelPhaseTransition(previous.phase, record.phase) })
      }
      if (record.phase === 'active' && !invitationsReady(previous.manifest, previous.invitations)) {
        throw malformedChannel('channel activated without every required endpoint acknowledgement')
      }
      if (record.type === 'channel/closed' && [...previous.invitations.values()].some(invitation => invitation.status === 'pending')) {
        throw malformedChannel('channel closed with pending invitations')
      }
      return { ...previous, phase: record.phase, cursor, state: foldAdapterState(adapter, previous.state, record) }
    case 'channel/envelope': {
      if (previous.phase !== 'active') throw malformedChannel('Envelope accepted before channel admission')
      const state = foldAdapterState(adapter, previous.state, record)
      const pendingDeliveries = clonePendingDeliveries(previous.pendingDeliveries)
      const postIdempotency = clonePostIdempotency(previous.postIdempotency)
      if (record.idempotencyKey !== undefined) {
        const keys = postIdempotency.get(record.envelope.senderId) ?? new Map<ChannelPostIdempotencyKey, TeamEnvelope>()
        if (keys.has(record.idempotencyKey)) {
          throw malformedChannel(`channel WAL repeats idempotency key '${record.idempotencyKey}' for '${record.envelope.senderId}'`)
        }
        keys.set(record.idempotencyKey, structuredClone(record.envelope))
        postIdempotency.set(record.envelope.senderId, keys)
      }
      const expiresAt = envelopeExpiresAt(record.envelope)
      const expected = admittedDeliveries(previous, state, record.envelope, adapter)
      if (!isDeepStrictEqual(record.deliveryIntents, expected)) throw malformedChannel('Envelope recipient intents differ from admitted endpoint plan')
      for (const delivery of record.deliveryIntents) {
        const deliveries = pendingDeliveries.get(delivery.participantId) ?? new Map<EnvelopeId, PendingChannelDelivery>()
        if (deliveries.has(record.envelope.id)) {
          throw malformedChannel(`Envelope '${record.envelope.id}' repeats a pending delivery for '${delivery.participantId}'`)
        }
        deliveries.set(record.envelope.id, {
          envelopeId: record.envelope.id,
          envelopeSequence: record.envelope.sequence,
          delivery: delivery.delivery,
          ...expiresAt === undefined ? {} : { expiresAt },
        })
        pendingDeliveries.set(delivery.participantId, deliveries)
      }
      return { ...previous, cursor, state, pendingDeliveries, postIdempotency }
    }
    case 'channel/receipt': {
      const delivery = previous.pendingDeliveries.get(record.participantId)?.get(record.envelopeId)
      if (delivery === undefined) {
        throw malformedChannel(`receipt '${record.envelopeId}' has no pending delivery for '${record.participantId}'`)
      }
      const priorCursor = previous.receiptCursors.get(record.participantId)
      const receiptCursor = Math.max(priorCursor ?? delivery.envelopeSequence, delivery.envelopeSequence)
      if (record.cursor !== receiptCursor) {
        throw malformedChannel(`receipt '${record.envelopeId}' cursor ${record.cursor} does not match '${receiptCursor}'`)
      }
      const pendingDeliveries = clonePendingDeliveries(previous.pendingDeliveries)
      const deliveries = pendingDeliveries.get(record.participantId)
      // v8 ignore next -- a matching pending delivery exists above and the clone preserves its recipient row.
      if (deliveries === undefined) throw malformedChannel(`receipt '${record.envelopeId}' lost its pending recipient`)
      deliveries.delete(record.envelopeId)
      if (deliveries.size === 0) pendingDeliveries.delete(record.participantId)
      const receiptCursors = new Map(previous.receiptCursors)
      receiptCursors.set(record.participantId, receiptCursor)
      return {
        ...previous,
        cursor,
        state: foldAdapterState(adapter, previous.state, record),
        pendingDeliveries,
        receiptCursors,
      }
    }
    case 'channel/delivery-expired': {
      const delivery = previous.pendingDeliveries.get(record.participantId)?.get(record.envelopeId)
      if (delivery === undefined) {
        throw malformedChannel(`expiry '${record.envelopeId}' has no pending delivery for '${record.participantId}'`)
      }
      if (delivery.envelopeSequence !== record.envelopeSequence) {
        throw malformedChannel(`expiry '${record.envelopeId}' does not match its pending delivery`)
      }
      if (record.reason === undefined) {
        if (delivery.expiresAt === undefined || record.createdAt < delivery.expiresAt) {
          throw malformedChannel(`expiry '${record.envelopeId}' was recorded before its TTL deadline`)
        }
      }
      const pendingDeliveries = clonePendingDeliveries(previous.pendingDeliveries)
      const deliveries = pendingDeliveries.get(record.participantId)
      // v8 ignore next -- a matching pending delivery exists above and the clone preserves its recipient row.
      if (deliveries === undefined) throw malformedChannel(`expiry '${record.envelopeId}' lost its pending recipient`)
      deliveries.delete(record.envelopeId)
      if (deliveries.size === 0) pendingDeliveries.delete(record.participantId)
      return {
        ...previous,
        cursor,
        state: foldAdapterState(adapter, previous.state, record),
        pendingDeliveries,
      }
    }
    case 'channel/summary': {
      if (record.coveredSequenceRange.to >= cursor) {
        throw malformedChannel(`summary '${record.idempotencyKey}' covers its own or a later WAL record`)
      }
      if (previous.summaries.has(record.idempotencyKey)) {
        throw malformedChannel(`channel WAL repeats summary key '${record.idempotencyKey}'`)
      }
      const summaries = new Map(previous.summaries)
      summaries.set(record.idempotencyKey, structuredClone(record))
      return {
        ...previous,
        cursor,
        state: foldAdapterState(adapter, previous.state, record),
        summaries,
      }
    }
    case 'channel/adapter':
      return {
        ...previous,
        cursor,
        state: foldAdapterState(adapter, previous.state, record),
      }
    /* v8 ignore next 2 -- ChannelRecord is closed and all discriminants are handled above. */
    default:
      return assertNever(record)
  }
}

/**
 * Resolve the one storage cursor encoded by every channel WAL record form.
 * @param record - validated channel WAL record.
 * @returns its duplicated durable storage cursor.
 */
export function channelRecordCursor(record: ChannelRecord): number {
  return record.type === 'channel/envelope' ? record.envelope.sequence : record.sequence
}

/** Derive and validate the absolute expiry timestamp of one TTL-bound Envelope. */
function envelopeExpiresAt(envelope: TeamEnvelope): number | undefined {
  if (envelope.ttlMs === undefined) return undefined
  const expiresAt = envelope.createdAt + envelope.ttlMs
  if (!Number.isSafeInteger(expiresAt)) {
    throw malformedChannel(`Envelope '${envelope.id}' has an unrepresentable TTL expiry`)
  }
  return expiresAt
}

/** Reject foreign Team/channel or adapter identities before adapter code sees a record. */
function validateChannelRecordOwner(record: ChannelRecord, manifest: ChannelManifest): void {
  switch (record.type) {
    case 'channel/invitation':
    case 'channel/acknowledged':
    case 'channel/invitation-ended':
    case 'channel/opened':
    case 'channel/phase':
    case 'channel/closed':
      return
    case 'channel/envelope':
      if (record.envelope.channelId !== manifest.id || record.envelope.teamId !== manifest.teamId) {
        throw malformedChannel(`envelope '${record.envelope.id}' does not belong to channel '${manifest.id}'`)
      }
      return
    case 'channel/adapter':
      if (record.adapter.type !== manifest.adapter.type || record.adapter.version !== manifest.adapter.version) {
        throw malformedChannel(`adapter record does not match '${manifest.adapter.type}' version ${manifest.adapter.version}`)
      }
      return
    case 'channel/receipt':
      if (!manifest.participants.some(participant => participant.id === record.participantId)) {
        throw malformedChannel(`receipt participant '${record.participantId}' does not belong to channel '${manifest.id}'`)
      }
      return
    case 'channel/delivery-expired':
      if (!manifest.participants.some(participant => participant.id === record.participantId)) {
        throw malformedChannel(`expiry participant '${record.participantId}' does not belong to channel '${manifest.id}'`)
      }
      return
    case 'channel/summary':
      return
    /* v8 ignore next 2 -- ChannelRecord is closed and all discriminants are handled above. */
    default:
      return assertNever(record)
  }
}

/** Validate channel membership before protocol code receives its immutable manifest. */
function assertManifest(manifest: ChannelManifest): void {
  const ids = manifest.participants.map(participant => participant.id)
  assertDistinct(ids, `channel '${manifest.id}' repeats a participant`, malformedChannel)
}

/** Give adapter code a frozen detached input and retain only a JSON-safe return value. */
function foldAdapterState(adapter: TeamChannelAdapter, state: JsonValue, record: ChannelRecord): JsonValue {
  return normalizeState(callAdapter(() => adapter.fold(immutable(state), immutable(record))))
}

/**
 * Derive and validate each protocol recipient before endpoint admission filtering.
 * @param adapter - exact retained implementation.
 * @param manifest - immutable channel configuration.
 * @param state - protocol state after accepting the Envelope.
 * @param envelope - exact stamped Envelope.
 * @returns validated ordered recipient intents.
 */
export function planDeliveries(
  adapter: TeamChannelAdapter,
  manifest: ChannelManifest,
  state: JsonValue,
  envelope: Extract<ChannelRecord, { readonly type: 'channel/envelope' }>['envelope'],
): readonly DeliveryIntent[] {
  const raw = callAdapter(() => adapter.deliveryPlan({
    manifest: immutable(manifest),
    state: immutable(state),
    envelope: immutable(envelope),
  }))
  if (!Array.isArray(raw)) throw malformedChannel('channel adapter returned non-array delivery plan')
  const members = new Set(manifest.participants.map(participant => participant.id))
  const participants = new Set<ParticipantId>()
  return raw.map((candidate) => {
    let delivery: DeliveryIntent
    try {
      delivery = deliveryIntentSchema.parse(candidate)
    } catch (error: unknown) {
      throw malformedChannel('channel adapter returned an invalid delivery plan', error)
    }
    if (delivery.envelopeId !== envelope.id) {
      throw malformedChannel(`delivery plan references '${delivery.envelopeId}', not Envelope '${envelope.id}'`)
    }
    if (!members.has(delivery.participantId)) {
      throw malformedChannel(`delivery plan recipient '${delivery.participantId}' is not a channel participant`)
    }
    if (participants.has(delivery.participantId)) {
      throw malformedChannel(`delivery plan repeats recipient '${delivery.participantId}'`)
    }
    participants.add(delivery.participantId)
    return delivery
  })
}

/** Clone the nested recipient delivery map before one immutable fold replacement. */
function clonePendingDeliveries(
  source: ReadonlyMap<ParticipantId, ReadonlyMap<EnvelopeId, PendingChannelDelivery>>,
): Map<ParticipantId, Map<EnvelopeId, PendingChannelDelivery>> {
  return new Map([...source.entries()].map(([participantId, deliveries]) => [
    participantId,
    new Map([...deliveries.entries()].map(([envelopeId, delivery]) => [envelopeId, structuredClone(delivery)])),
  ]))
}

/** Clone sender-scoped idempotency entries before a channel envelope fold. */
function clonePostIdempotency(
  source: ReadonlyMap<ParticipantId, ReadonlyMap<ChannelPostIdempotencyKey, TeamEnvelope>>,
): Map<ParticipantId, Map<ChannelPostIdempotencyKey, TeamEnvelope>> {
  return new Map([...source.entries()].map(([senderId, keys]) => [
    senderId,
    new Map([...keys.entries()].map(([key, envelope]) => [key, structuredClone(envelope)])),
  ]))
}

/** Parse, clone, and freeze only the copy passed across an adapter boundary. */
function immutable<T>(value: T): T {
  const copy = structuredClone(value)
  return freeze(copy)
}

/** Recursively freeze one detached value. */
function freeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) freeze(child)
  return value
}

/** Convert unexpected adapter failures into a durable-WAL diagnosis. */
function callAdapter<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error: unknown) {
    throw malformedChannel('channel adapter rejected durable state', error)
  }
}

/** Validate a JSON-safe adapter fold result. */
function normalizeState(value: unknown): JsonValue {
  try {
    return jsonValueSchema.parse(value)
  } catch (error: unknown) {
    throw malformedChannel('channel adapter returned non-JSON fold state', error)
  }
}

/** Reject a journal timestamp that moves behind its prior durable record. */
function assertTimestamp(previous: number, next: number, subject: string): void {
  if (next < previous) throw malformedTeam(`${subject} timestamp ${next} is before ${previous}`)
}

/** Run a closed lifecycle assertion with an owned malformed-medium error. */
function assertTeamTransition(assertion: () => void): void {
  try {
    assertion()
  } catch (error: unknown) {
    throw malformedTeam('durable lifecycle transition is invalid', error)
  }
}

/** Convert one failed durable Team relation into the provider-owned recovery error. */
function assertTeamCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw malformedTeam(message)
}

/** Run a closed channel lifecycle assertion with an owned malformed-WAL error. */
function assertChannelTransition(assertion: () => void): void {
  try {
    assertion()
  } catch (error: unknown) {
    throw malformedChannel('durable lifecycle transition is invalid', error)
  }
}

/** Reject duplicated durable ids or strings. */
function assertDistinct(
  values: readonly unknown[],
  message: string,
  failure: (message: string) => TeamHubError = malformedTeam,
): void {
  if (new Set(values).size !== values.length) throw failure(message)
}

/** Build an exact Team-journal recovery failure. */
function malformedTeam(message: string, cause?: unknown): TeamHubError {
  return new TeamHubError(message, 'TEAM_JOURNAL_MALFORMED', cause === undefined ? undefined : { cause })
}

/** Build an exact channel-WAL recovery failure. */
function malformedChannel(message: string, cause?: unknown): TeamHubError {
  return new TeamHubError(message, 'TEAM_CHANNEL_WAL_MALFORMED', cause === undefined ? undefined : { cause })
}

/** Exhaust a closed local union. */
/* v8 ignore next 3 -- reachable only from a statically closed-union default arm. */
function assertNever(value: never): never {
  throw new Error(`unhandled durable Team record ${JSON.stringify(value)}`)
}

/** Validate a durable final sink's ownership and exact completion selection during journal and checkpoint replay. */
function assertFinalAdmission(projection: TeamProjection, admission: TeamFinalAdmission, latestTimestamp: number): void {
  const human = projection.participants.get(admission.recipientId)
  const closure = projection.team.closure
  if (admission.teamId !== projection.team.id
    || projection.team.parentTeamId !== undefined
    || admission.admittedAt < projection.team.createdAt
    || admission.admittedAt > latestTimestamp
    || !projection.channelIds.has(admission.channelId)
    || human?.kind !== 'human'
    || !isDeepStrictEqual(human.owner, admission.owner)
    || (admission.sink === 'principal-inbox'
      ? admission.owner.kind !== 'product-principal' || admission.inboxSequence === undefined
      : admission.owner.kind !== 'system' || admission.inboxSequence !== undefined)
    || closure?.kind === 'complete' && (closure.finalChannelId !== admission.channelId
      || closure.finalEnvelopeId !== admission.envelopeId)) {
    throw malformedTeam('final admission does not match its Team lifetime, human owner, or completion selection')
  }
}

/** Preserve cancellation attribution and prevent any new attempt activity after admission. */
function assertTaskCancellationTransition(
  projection: TeamProjection,
  current: TeamTaskSnapshot,
  next: TeamTaskSnapshot,
  createdAt: number,
): void {
  const prior = current.cancellation
  const cancellation = next.cancellation
  if (prior === undefined && cancellation === undefined) return
  assertTeamCondition(cancellation !== undefined, `task '${current.id}' removed its cancellation intent`)
  if (prior === undefined) {
    assertTeamCondition(projection.team.phase === 'active' && projection.team.closure === undefined && projection.team.cancellation === undefined
      && cancellation.requestedRevision === current.revision
      && cancellation.requestedAt === createdAt
      && cancellation.expiredAt === undefined
      && projection.participants.get(cancellation.requestedBy)?.phase === 'active',
    `task '${current.id}' has invalid cancellation admission attribution`)
    const target = cancellation.target
    assertTeamCondition(current.execution.kind === 'child-team'
      ? target.kind === 'delegation' && target.delegationId === current.delegation?.id && target.childTeamId === current.delegation.childTeamId
      : current.lease === undefined
        ? current.phase === 'pending' ? target.kind === 'pending' : current.phase === 'review' && target.kind === 'review'
        && current.attemptHistory.at(-1)?.id === target.attemptId
        && current.reviewPolicy.kind === 'participant' && current.reviewPolicy.reviewerId === target.reviewerId
        : target.kind === 'attempt' && target.attemptId === current.lease.attemptId
        && target.activationId === current.lease.activationId && target.participantId === current.lease.participantId,
    `task '${current.id}' cancellation selected different work`)
  } else {
    const { expiredAt: priorExpiry, ...priorIntent } = prior
    const { expiredAt: nextExpiry, ...nextIntent } = cancellation
    assertTeamCondition(isDeepStrictEqual(priorIntent, nextIntent), `task '${current.id}' changed its cancellation intent`)
    assertTeamCondition(priorExpiry === nextExpiry || (priorExpiry === undefined && nextExpiry === createdAt
      && current.lease !== undefined && createdAt >= current.lease.expiresAt),
    `task '${current.id}' changed its cancellation deadline fact`)
  }
  assertTeamCondition(next.lease === undefined || isDeepStrictEqual(current.lease, next.lease),
    `task '${current.id}' changed lease work after cancellation`)
  if (current.lease !== undefined && next.lease === undefined) {
    const outcome = next.attemptHistory.at(-1)?.outcome.kind
    assertTeamCondition(next.phase === 'cancelled' && (outcome === 'cancelled' || outcome === 'released' || outcome === 'lease-expired'),
      `task '${current.id}' ignored cancellation during settlement`)
    assertTeamCondition([...projection.workspaceAllocations.values()].every(allocation => allocation.taskId !== current.id || allocation.lifecycle === 'released'),
      `task '${current.id}' settled cancellation before workspace release`)
  }
}

/**
 * Validate cancellation resource and fence relationships after a complete Team journal batch.
 * @param projection - complete recovered or proposed Team state, including activation quiescence records.
 */
export function assertTaskCancellationSettlements(projection: TeamProjection): void {
  for (const task of projection.tasks.values()) {
    const cancellation = task.cancellation
    if (cancellation === undefined) continue
    assertTeamCondition(projection.participants.has(cancellation.requestedBy)
      && cancellation.requestedAt <= projection.team.updatedAt
      && (cancellation.expiredAt === undefined || cancellation.expiredAt <= projection.team.updatedAt),
    `task '${task.id}' cancellation has invalid participant or timestamp provenance`)
    if (task.phase !== 'cancelled') continue
    assertTeamCondition([...projection.humanActions.values()].every(action => action.taskId !== task.id || action.phase !== 'pending'),
      `task '${task.id}' cancelled with a pending human action`)
    assertTeamCondition([...projection.workspaceAllocations.values()].every(allocation => allocation.taskId !== task.id || allocation.lifecycle === 'released'),
      `task '${task.id}' cancelled before workspace release`)
    if (cancellation.target.kind !== 'attempt') continue
    const attempt = task.attemptHistory.at(-1)
    assertTeamCondition(attempt !== undefined && attempt.id === cancellation.target.attemptId,
      `task '${task.id}' cancellation settled another attempt`)
    if (attempt.outcome.kind === 'cancelled') continue
    const binding = projection.activations.get(cancellation.target.activationId)
    assertTeamCondition((attempt.outcome.kind === 'released' || attempt.outcome.kind === 'lease-expired')
      && binding?.quiescedAt === attempt.settledAt && binding.activation.status === 'offline',
    `task '${task.id}' cancellation has no matching activation quiescence fact`)
  }
}

/** Validate one invitation against its immutable manifest. */
function validateInvitation(manifest: ChannelManifest, invitation: import('@clocky/clocky-team').ChannelInvitationSnapshot): void {
  if (manifest.participants.find(member => member.id === invitation.participantId)?.role !== invitation.role
    || invitation.manifestFingerprint !== fingerprintChannelManifest(manifest)) throw malformedChannel('invitation does not match its manifest')
  if ((['expired', 'cancelled'].includes(invitation.status)) !== (invitation.reason !== undefined)
    || (invitation.status === 'pending') !== (invitation.settledAt === undefined)
    || (invitation.status === 'acknowledged') !== (invitation.acknowledgementKey !== undefined)) {
    throw malformedChannel('invitation settlement fields do not match its status')
  }
}

/** Required consent is complete only when every immutable member has an invitation. */
function invitationsReady(manifest: ChannelManifest, invitations: ChannelProjection['invitations']): boolean {
  return invitations.size === manifest.participants.length
    && [...invitations.values()].every(invitation => !invitation.required || invitation.status === 'acknowledged')
}

/** Restore consent independently of pending message deliveries. */
function restoreInvitations(data: ChannelProjectionData): ChannelProjection['invitations'] {
  const invitations: ChannelProjection['invitations'] = new Map()
  for (const invitation of data.invitations) {
    validateInvitation(data.manifest, invitation)
    if (invitations.has(invitation.participantId)) throw malformedChannel('checkpoint repeats a channel invitation')
    invitations.set(invitation.participantId, structuredClone(invitation))
  }
  if (data.phase === 'active' && !invitationsReady(data.manifest, invitations)) throw malformedChannel('checkpoint activated an unacknowledged channel')
  return invitations
}

/**
 * Freeze the exact accepted protocol recipients in the Envelope's WAL record.
 * @param projection - current admission and protocol state.
 * @param envelope - Hub-stamped message.
 * @param idempotencyKey - sender-scoped retry key, when supplied.
 * @param adapter - exact retained protocol implementation.
 * @returns a detached Envelope record whose recipients are fixed before append.
 */
export function prepareChannelEnvelopeRecord(
  projection: ChannelProjection, envelope: TeamEnvelope, idempotencyKey: ChannelPostIdempotencyKey | undefined,
  adapter: TeamChannelAdapter,
): Extract<ChannelRecord, { type: 'channel/envelope' }> {
  const record: Extract<ChannelRecord, { type: 'channel/envelope' }> = {
    type: 'channel/envelope', envelope, deliveryIntents: [], ...idempotencyKey === undefined ? {} : { idempotencyKey },
  }
  const state = foldAdapterState(adapter, projection.state, record)
  const deliveryIntents = admittedDeliveries(projection, state, envelope, adapter)
  return { ...record, deliveryIntents }
}

/** Select recipients at this exact WAL prefix; only v4 broadcast permits optional endpoints to remain absent. */
function admittedDeliveries(
  projection: ChannelProjection, state: JsonValue, envelope: TeamEnvelope, adapter: TeamChannelAdapter,
): readonly DeliveryIntent[] {
  if (projection.invitations.get(envelope.senderId)?.status !== 'acknowledged') throw malformedChannel('Envelope sender has not acknowledged its invitation')
  const planned = planDeliveries(adapter, projection.manifest, state, envelope)
  const admitted = planned.filter(delivery => projection.invitations.get(delivery.participantId)?.status === 'acknowledged')
  if (admitted.length !== planned.length
    && !(projection.manifest.adapter.type === 'direct' && projection.manifest.adapter.version === 4
      && envelope.kind === 'message' && envelope.audience === null)) throw malformedChannel('Envelope targets an unacknowledged protocol recipient')
  if (planned.length > 0 && admitted.length === 0) throw malformedChannel('Envelope has no admitted recipient')
  return admitted
}

/** Validate the causal terminal prerequisite of one unstarted cancelled task. */
function assertTaskDependencyOutcome(projection: TeamProjection, task: TeamTaskSnapshot): void {
  const cause = task.blockedByOutcome
  if (cause === undefined) return
  const blocker = projection.tasks.get(cause.taskId)
  assertTeamCondition(task.phase === 'cancelled' && task.attemptCount === 0 && task.lease === undefined
    && task.cancellation === undefined && task.blockedBy.includes(cause.taskId)
    && blocker?.revision === cause.revision && blocker.phase === cause.phase,
  `task '${task.id}' has an invalid dependency cancellation cause`)
}
