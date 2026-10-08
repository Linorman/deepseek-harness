import { taskExecutionRecordSchema, foldTaskExecution, assertTaskExecutions } from './task-execution.ts'
import { isOutboxAction } from './outbox.ts'
import { taskRecordSchema, foldTaskEvidence, assertTaskEvidence } from './task-evidence.ts'
/** Serial decision slots, atomic intent acceptance, and immutable operation outcomes. @module @clocky/clocky-simulation-local/decisions */
import { z } from 'zod'
import { knowledgeRecordSchema, foldKnowledge, assertKnowledgeProjection } from './knowledge.ts'
import { isDeepStrictEqual } from 'node:util'
import { simulationPolicyRefSchema, taskDecision, taskContinuationEvidence, taskReportContinuationEvidence } from '@clocky/clocky-simulation'
import { capacityRecordSchema, foldCapacity, assertCapacityProjection } from './capacity.ts'
import { tokenRecordSchema, foldTokens, assertTokenProjection } from './tokens.ts'
import { assertBudget, budgetRecordSchema, foldBudget, assertBudgetProjection } from './budget.ts'
import { dispatchRecordSchema, foldDispatch, openDispatch, decisionDispatch, assertDispatchProjection } from './dispatch.ts'
import { assertContextProjection, prepareContext, materializeReports } from './context.ts'
import { simulationContextRequestSchema } from '@clocky/clocky-simulation'
import { simulationWindowRequestSchema, simulationWindowIdSchema, simulationProposalSchema } from '@clocky/clocky-simulation'
import { simulationWallTimeSchema } from '@clocky/clocky-simulation'
import {
  simulationDecisionIdSchema, simulationDecisionSlotSchema, simulationEntityIdSchema, simulationOperationIdSchema,
  simulationOperationSchema, simulationResourceSpecSchema, simulationWriterEpochSchema, simulationEventIdSchema, parseSimTime,
} from '@clocky/clocky-simulation'
import type {
  SimulationDecision, SimulationDecisionId, SimulationEntityId, SimulationOperation, SimulationProposal,
  SimulationSnapshot, SimulationWriterEpoch,
} from '@clocky/clocky-simulation'
import { businessFingerprint, computeOperation, createResource, operationId } from './business.ts'
import { requireWriterEpoch } from './writers.ts'
import { dependenciesReady } from './outbox.ts'

/** Parsed business journal records; all decision intents are appended with acceptance in one batch. */
export const businessRecordSchema = z.discriminatedUnion('kind', [
  ...dispatchRecordSchema.options,
  ...budgetRecordSchema.options,
  ...capacityRecordSchema.options,
  knowledgeRecordSchema,
  taskRecordSchema,
  ...taskExecutionRecordSchema.options,
  z.strictObject({ kind: z.literal('deterministic/selected'), id: simulationDecisionIdSchema, policy: simulationPolicyRefSchema }),
  z.strictObject({ kind: z.literal('deterministic/result'), id: simulationDecisionIdSchema, proposals: z.array(simulationProposalSchema) }),
  ...tokenRecordSchema.options,
  z.strictObject({ kind: z.literal('decision/started'), id: simulationDecisionIdSchema, startedAt: simulationWallTimeSchema }),
  z.strictObject({ kind: z.literal('decision/finished'), id: simulationDecisionIdSchema, finishedAt: simulationWallTimeSchema }),
  z.strictObject({ kind: z.literal('decision/expired'), id: simulationDecisionIdSchema, expiredAt: simulationWallTimeSchema }),
  z.strictObject({ kind: z.literal('window/opened'), request: simulationWindowRequestSchema }),
  z.strictObject({ kind: z.literal('window/closed'), id: simulationWindowIdSchema }),
  z.strictObject({ kind: z.literal('decision/submitted'), id: simulationDecisionIdSchema, proposals: z.array(simulationProposalSchema) }),
  z.strictObject({ kind: z.literal('decision/rebased'), id: simulationDecisionIdSchema, reports: z.array(simulationOperationIdSchema).min(1) }),
  z.strictObject({ kind: z.literal('decision/context'), id: simulationDecisionIdSchema, request: simulationContextRequestSchema }),
  z.strictObject({ kind: z.literal('resource/created'), resource: simulationResourceSpecSchema }),
  z.strictObject({ kind: z.literal('decision/opened'), id: simulationDecisionIdSchema,
    entityId: simulationEntityIdSchema, epoch: simulationWriterEpochSchema, slot: simulationDecisionSlotSchema,
    snapshotRevision: z.number().int().nonnegative(), entityRevision: z.number().int().positive(),
    wakeId: simulationEventIdSchema.optional() }),
  z.strictObject({ kind: z.literal('decision/accepted'), id: simulationDecisionIdSchema,
    fingerprint: z.string().min(1), operationIds: z.array(simulationOperationIdSchema) }),
  z.strictObject({ kind: z.literal('operation/intent'), id: simulationOperationIdSchema, decisionId: simulationDecisionIdSchema,
    index: z.number().int().nonnegative(), action: simulationOperationSchema,
    dependencies: z.array(simulationOperationIdSchema), fingerprint: z.string().min(1) }),
  z.strictObject({ kind: z.literal('decision/cancelled'), id: simulationDecisionIdSchema }),
  z.strictObject({ kind: z.literal('operation/settled'), id: simulationOperationIdSchema,
    status: z.enum(['applied', 'rejected', 'blocked-authority', 'blocked-dependency']), code: z.string().min(1) }),
])
/** Parsed business event. */
export type BusinessRecord = z.infer<typeof businessRecordSchema>

/**
 * Resolve a decision without prototype-key fallback.
 * @param state - Current run.
 * @param id - Exact id.
 * @returns durable decision.
 */
export function requireDecision(state: SimulationSnapshot, id: SimulationDecisionId): SimulationDecision {
  const decision = Object.hasOwn(state.decisions, id) ? state.decisions[id] : undefined
  if (decision === undefined) throw new Error('Simulation decision does not exist')
  return decision
}
/**
 * Verify a decision belongs to the issuing epoch.
 * @param decision - Recorded slot.
 * @param entity - Capability owner.
 * @param epoch - Issued epoch.
 */
export function assertDecisionOwner(decision: SimulationDecision, entity: SimulationEntityId, epoch: SimulationWriterEpoch): void {
  if (decision.entityId !== entity || decision.epoch !== epoch) throw new Error('Simulation decision belongs to another writer')
}
function replaceDecision(state: SimulationSnapshot, decision: SimulationDecision, close: boolean): SimulationSnapshot {
  const next = { ...state, decisions: { ...state.decisions, [decision.id]: decision } }
  if (close && next.activeDecisionId === decision.id) delete next.activeDecisionId
  return next
}
/**
 * Check a slot's membership in the current serial decision or fixed window.
 * @param state - Current run projection.
 * @param decision - Recorded decision.
 * @returns whether the decision belongs to current admission.
 */
export function currentDecision(state: SimulationSnapshot, decision: SimulationDecision): boolean {
  return decision.windowId === undefined ? state.activeDecisionId === decision.id
    : state.activeWindowId === decision.windowId && state.windows?.[decision.windowId]?.status === 'collecting'
      && state.windows[decision.windowId]?.request.decisions.some(value => value.id === decision.id) === true
}
/**
 * Reconstruct a business mutation from its immutable intent and journal position.
 * @param state - Projection before this entry.
 * @param record - Parsed event.
 * @param sequence - Storage-assigned event position.
 * @returns updated projection before advancing the run tail.
 */
export function foldBusinessRecord(state: SimulationSnapshot, record: BusinessRecord, sequence: number): SimulationSnapshot {
  switch (record.kind) {
    case 'task/execution-policy':
    case 'task/cancellation':
    case 'task/execution-result':
    case 'task/execution-decision':
    case 'task/execution-input':
    case 'task/execution-reserved':
    case 'task/execution-observed':
    case 'task/execution-retired': return foldTaskExecution(state, record, sequence)
    case 'task/reconciled': return foldTaskEvidence(state, record)
    case 'knowledge/recorded': return foldKnowledge(state, record, sequence)
    case 'capacity/extended': case 'capacity/exhausted': return foldCapacity(state, record)
    case 'token/reserved': case 'token/compaction-reserved': case 'token/settled': case 'token/acknowledged': return foldTokens(state, record)
    case 'budget/extended': case 'budget/exhausted': return foldBudget(state, record)
    case 'dispatch/queued': case 'dispatch/reserved': case 'dispatch/cancelled': return foldDispatch(state, record)
    case 'deterministic/selected': case 'deterministic/result': {
      const decision = requireDecision(state, record.id)
      const entity = requireWriterEpoch(state, decision.entityId, decision.epoch)
      if (state.phase !== 'running' || decision.status !== 'open' || !currentDecision(state, decision)
        || decision.inference !== undefined || entity.writer?.phase !== 'active'
        || entity.phase !== 'active' || entity.revision !== decision.entityRevision) {
        throw new Error('Simulation deterministic computation requires its current prepared decision owner')
      }
      if (record.kind === 'deterministic/selected') {
        if (decision.deterministic !== undefined) throw new Error('Simulation deterministic policy is already selected')
        return replaceDecision(state, { ...decision, deterministic: { policy: record.policy } }, false)
      }
      if (decision.context?.status !== 'prepared' || decision.deterministic === undefined || decision.deterministic.proposals !== undefined) {
        throw new Error('Simulation deterministic output requires an unfinished selected policy')
      }
      const completed = { ...decision, deterministic: { ...decision.deterministic, proposals: record.proposals } }
      acceptanceRecords(state, completed, record.proposals)
      return replaceDecision(state, completed, false)
    }
    case 'decision/started': {
      const decision = requireDecision(state, record.id)
      const entity = requireWriterEpoch(state, decision.entityId, decision.epoch)
      const deadline = record.startedAt + state.spec.decisionTimeoutMs
      if (decision.deterministic !== undefined || decision.status !== 'open' || !currentDecision(state, decision) || decision.context?.status !== 'prepared'
        || decision.inference !== undefined || state.phase !== 'running' || entity.writer?.phase !== 'active'
        || !Number.isSafeInteger(deadline)) throw new Error('Simulation inference cannot start for this decision')
      return replaceDecision(state, { ...decision, inference: { startedAt: record.startedAt, deadline } }, false)
    }
    case 'decision/finished': {
      const decision = requireDecision(state, record.id)
      const timing = decision.inference
      if (decision.status !== 'open' || !currentDecision(state, decision) || timing === undefined || timing.finishedAt !== undefined
        || record.finishedAt < timing.startedAt || record.finishedAt >= timing.deadline) throw new Error('Simulation inference completion missed its deadline')
      return replaceDecision(state, { ...decision, inference: { ...timing, finishedAt: record.finishedAt } }, false)
    }
    case 'decision/expired': {
      const decision = requireDecision(state, record.id)
      const timing = decision.inference
      if (timing === undefined || timing.finishedAt !== undefined || record.expiredAt < timing.deadline) {
        throw new Error('Simulation decision has no expired inference')
      }
      const next = foldBusinessRecord(state, { kind: 'decision/cancelled', id: record.id }, sequence)
      return replaceDecision(next, { ...requireDecision(next, record.id), cancellation: 'timeout',
        inference: { ...timing, expiredAt: record.expiredAt } }, false)
    }
    case 'window/opened': {
      const request = record.request
      const pending = nextLocalOperation(state)
      if (state.phase !== 'running' || state.activeWindowId !== undefined || state.activeDecisionId !== undefined
        || Object.hasOwn(state.windows ?? {}, request.id) || request.decisions.length > state.spec.maxDecisionsPerWindow
        || pending !== undefined && dependenciesReady(state, pending)) {
        throw new Error('Simulation window requires settled prior decisions and operations within its configured limit')
      }
      assertBudget(state, 'decisions', request.decisions.length)
      let next = openDispatch(state, request)
      let overflow: { decisionId: SimulationDecisionId; requiredBytes: number; maxBytes: number } | undefined
      for (const selected of request.decisions) {
        const entity = state.entities[selected.entityId]
        if (entity?.writer?.phase !== 'active') throw new Error('Simulation window actor has no active writer')
        next = foldBusinessRecord(next, { kind: 'decision/opened', id: selected.id, entityId: selected.entityId,
          epoch: entity.writer.epoch, slot: next.nextDecisionSlot, snapshotRevision: state.revision,
          entityRevision: entity.revision, ...selected.wakeId === undefined ? {} : { wakeId: selected.wakeId } }, sequence)
        const decision = { ...requireDecision(next, selected.id), windowId: request.id,
          ...selected.policy === undefined ? {} : { deterministic: { policy: selected.policy } } }
        const context = prepareContext(state, decision, selected.context)
        next = replaceDecision(next, { ...decision, context }, true)
        if (context.status === 'overflow') overflow ??= { decisionId: decision.id, requiredBytes: context.requiredBytes, maxBytes: context.maxBytes }
      }
      return { ...next, ...overflow === undefined ? {} : { phase: 'stalled' as const, stall: {
        code: 'SIM_CONTEXT_REQUIRED_ITEM_OVERFLOW' as const, ...overflow, recovery: 'cancel-decision-adjust-budget-and-resume' as const,
      } }, activeWindowId: request.id, windows: { ...state.windows, [request.id]: {
        id: request.id, request, snapshotRevision: state.revision, time: state.time, status: 'collecting',
      } } }
    }
    case 'window/closed': {
      const window = state.windows?.[record.id]
      if (window === undefined || state.activeWindowId !== record.id || window.status !== 'collecting'
        || window.request.decisions.some(value => ['open', 'submitted'].includes(requireDecision(state, value.id).status))) {
        throw new Error('Simulation window still has unsettled decisions')
      }
      const next = { ...state, windows: { ...state.windows, [record.id]: { ...window, status: 'closed' as const } } }
      delete next.activeWindowId
      return next
    }
    case 'decision/submitted': {
      const decision = requireDecision(state, record.id)
      const entity = requireWriterEpoch(state, decision.entityId, decision.epoch)
      if (decision.windowId === undefined || !currentDecision(state, decision) || decision.status !== 'open'
        || state.phase !== 'running' || entity.writer?.phase !== 'active' || entity.phase !== 'active'
        || entity.revision !== decision.entityRevision || record.proposals.length > state.spec.maxOperationsPerDecision) {
        throw new Error('Simulation window proposal has no current decision authority')
      }
      acceptanceRecords(state, decision, record.proposals)
      if (decision.inference !== undefined && decision.inference.finishedAt === undefined) throw new Error('Simulation submission lacks completed inference')
      return replaceDecision(state, { ...decision, status: 'submitted', submission: record.proposals }, false)
    }
    case 'resource/created':
      if (state.activeWindowId !== undefined) throw new Error('Simulation resource creation waits for its window to close')
      return createResource(state, record.resource)
    case 'decision/rebased': {
      const decision = requireDecision(state, record.id)
      const entity = requireWriterEpoch(state, decision.entityId, decision.epoch)
      if (state.phase !== 'running' || decision.status !== 'open' || !currentDecision(state, decision)
        || entity.phase !== 'active' || entity.writer?.phase !== 'active' || entity.revision !== decision.entityRevision) {
        throw new Error('Simulation report presentation has no current decision authority')
      }
      const context = materializeReports(state, decision, record.reports)
      return preparedDecisionContext(state, decision, context)
    }
    case 'decision/context': {
      const decision = requireDecision(state, record.id)
      const entity = requireWriterEpoch(state, decision.entityId, decision.epoch)
      if (state.phase !== 'running' || decision.status !== 'open' || !currentDecision(state, decision)
        || entity.writer?.phase !== 'active' || entity.phase !== 'active' || entity.revision !== decision.entityRevision
        || decision.context !== undefined) throw new Error('Simulation context does not belong to a current unprepared decision')
      const context = prepareContext(state, decision, record.request)
      return preparedDecisionContext(state, decision, context)
    }
    case 'decision/opened': {
      const entity = requireWriterEpoch(state, record.entityId, record.epoch)
      const dispatch = decisionDispatch(state)
      if (dispatch.active !== undefined
        || dispatch.tickets[record.id]?.status === 'queued'
        || dispatch.tickets[record.id]?.status === 'reserved'
        || dispatch.tickets[record.id]?.status === 'cancelled'
        || record.wakeId !== undefined && Object.values(dispatch.tickets).some(ticket => ticket.candidate.wakeId === record.wakeId
          && (ticket.status === 'queued' || ticket.status === 'reserved'))) throw new Error('Simulation decision requires its reserved window')
      if (state.phase !== 'running' || entity.phase !== 'active' || entity.writer?.phase !== 'active') throw new Error('Simulation writer is not admitting decisions')
      if (state.activeDecisionId !== undefined || state.activeWindowId !== undefined) {
        throw new Error('Serial simulation decisions require the previous slot to settle')
      }
      if (Object.hasOwn(state.decisions, record.id) || record.slot !== state.nextDecisionSlot
        || record.snapshotRevision !== state.revision || record.entityRevision !== entity.revision) throw new Error('Simulation decision snapshot or slot conflicts')
      const wake = record.wakeId === undefined ? undefined : state.wakes[record.wakeId]
      const retry = record.wakeId === undefined ? undefined : state.scheduledEvents[record.wakeId]?.action
      if (record.wakeId !== undefined && (wake?.status !== 'pending' || wake.entityId !== record.entityId)) {
        throw new Error('Simulation decision does not own a pending scheduled wake')
      }
      if (Object.values(state.operations).some(operation => operation.action.kind === 'communication/post'
        && operation.action.recipient === record.entityId && operation.outbox?.ready === true
        && (operation.result === undefined || operation.result.status === 'applied' && operation.delivery?.receipt === undefined && operation.deliveryFailure?.resolution === undefined))) {
        throw new Error('Simulation recipient must wait for its due publication result')
      }
      assertBudget(state, 'decisions', 1)
      const decision: SimulationDecision = { id: record.id, entityId: record.entityId, epoch: record.epoch,
        slot: record.slot, snapshotRevision: record.snapshotRevision, entityRevision: record.entityRevision,
        ...retry?.kind !== 'conflict-retry' ? {} : { retry: { rootDecisionId: retry.rootDecisionId,
          attempt: retry.attempt, sourceOperationId: retry.operationId } },
        ...retry?.kind !== 'ingress' ? {} : { ingressId: retry.ingressId },
        time: state.time, status: 'open', operationIds: [], ...record.wakeId === undefined ? {} : { wakeId: record.wakeId } }
      return { ...replaceDecision(state, decision, false), activeDecisionId: decision.id,
        ...wake === undefined ? {} : { wakes: { ...state.wakes, [wake.eventId]: { ...wake, status: 'claimed', decisionId: decision.id } } },
        nextDecisionSlot: simulationDecisionSlotSchema.parse(String(BigInt(record.slot) + 1n)) }
    }
    case 'decision/accepted': {
      const decision = requireDecision(state, record.id)
      const entity = requireWriterEpoch(state, decision.entityId, decision.epoch)
      if (decision.inference !== undefined && decision.inference.finishedAt === undefined) throw new Error('Simulation acceptance lacks completed inference')
      if (state.phase !== 'running' || decision.status !== (decision.windowId === undefined ? 'open' : 'submitted') || entity.writer?.phase !== 'active'
        || entity.revision !== decision.entityRevision || !currentDecision(state, decision)) throw new Error('Simulation decision is not current')
      if (decision.windowId !== undefined) {
        const prior = state.windows?.[decision.windowId]?.request.decisions
          .find(value => ['open', 'submitted'].includes(requireDecision(state, value.id).status))
        if (prior?.id !== decision.id || decision.submission === undefined) {
          throw new Error('Simulation window acceptance is out of slot order')
        }
        const expected = acceptanceRecords(state, decision, decision.submission)[0]
        if (expected?.kind !== 'decision/accepted' || expected.fingerprint !== record.fingerprint) {
          throw new Error('Simulation acceptance differs from its submitted proposal')
        }
      }
      if (record.operationIds.length > state.spec.maxOperationsPerDecision
        || record.operationIds.some((id, index) => id !== operationId(state.spec.runId, record.id, index))) throw new Error('Simulation operation identities or count are invalid')
      const accepted = replaceDecision(state, { ...decision, status: 'accepted', fingerprint: record.fingerprint,
        operationIds: record.operationIds, closedAt: sequence }, true)
      if (decision.wakeId !== undefined) {
        const wake = state.wakes[decision.wakeId]
        if (wake?.status !== 'claimed' || wake.decisionId !== decision.id) throw new Error('Simulation decision lost its scheduled wake')
        return { ...accepted, wakes: { ...state.wakes, [wake.eventId]: { ...wake, status: 'completed' } } }
      }
      return accepted
    }
    case 'operation/intent': {
      const decision = requireDecision(state, record.decisionId)
      if (decision.status !== 'accepted' || decision.operationIds[record.index] !== record.id
        || Object.hasOwn(state.operations, record.id) || record.fingerprint !== businessFingerprint(record.action)
        || new Set(record.dependencies).size !== record.dependencies.length
        || record.dependencies.some(id => !Object.hasOwn(state.operations, id))) throw new Error('Simulation operation intent is inconsistent with its decision')
      if (record.action.kind === 'communication/post') {
        assertBudget(state, 'messages', 1)
        parseSimTime(record.action.deliverAt, state.spec.maxTime)
        const sender = state.entities[decision.entityId]
        const recipient = Object.hasOwn(state.entities, record.action.recipient) ? state.entities[record.action.recipient] : undefined
        if (BigInt(record.action.deliverAt) < BigInt(state.time) || sender?.binding === undefined
          || recipient?.binding === undefined || sender.binding.teamId !== recipient.binding.teamId) {
          throw new Error('Simulation message needs a future time and exact canonical bindings')
        }
      }
      if (record.action.kind === 'task/create') {
        parseSimTime(record.action.deliverAt, state.spec.maxTime)
        if (BigInt(record.action.deliverAt) < BigInt(state.time) || state.entities[decision.entityId]?.binding === undefined) {
          throw new Error('Simulation task requires a future time and canonical creator binding')
        }
      }
      const operation: SimulationOperation = { id: record.id, decisionId: decision.id, index: record.index,
        entityId: decision.entityId, action: record.action, dependencies: record.dependencies,
        fingerprint: record.fingerprint, status: 'pending',
        ...isOutboxAction(record.action) ? { outbox: { ready: false, attempts: [], budgetStart: 0 } } : {} }
      return { ...state, operations: { ...state.operations, [operation.id]: operation } }
    }
    case 'decision/cancelled': {
      const decision = requireDecision(state, record.id)
      if (!['open', 'submitted'].includes(decision.status) || !currentDecision(state, decision)) throw new Error('Only an open simulation decision can be cancelled')
      const cancelled = replaceDecision(state, { ...decision, status: 'cancelled', closedAt: sequence, cancellation: 'requested' }, true)
      if (decision.wakeId !== undefined) {
        const wake = state.wakes[decision.wakeId]
        if (wake?.status !== 'claimed' || wake.decisionId !== decision.id) throw new Error('Simulation decision lost its scheduled wake')
        const pending = { ...wake, status: 'pending' as const }
        delete pending.decisionId
        return { ...cancelled, wakes: { ...state.wakes, [wake.eventId]: pending } }
      }
      return cancelled
    }
    case 'operation/settled': {
      if (state.activeWindowId !== undefined) throw new Error('Simulation world settlement precedes window closure')
      const operation = Object.hasOwn(state.operations, record.id) ? state.operations[record.id] : undefined
      if (operation === undefined || operation.result !== undefined) throw new Error('Simulation operation cannot be settled twice or before acceptance')
      const slot = BigInt(requireDecision(state, operation.decisionId).slot)
      if (Object.values(state.operations).some(candidate => !isOutboxAction(candidate.action) && candidate.result === undefined
        && (BigInt(requireDecision(state, candidate.decisionId).slot) < slot
          || candidate.decisionId === operation.decisionId && candidate.index < operation.index))) {
        throw new Error('An earlier simulation operation is still pending')
      }
      const outcome = computeOperation(state, operation)
      if (record.status !== outcome.status || record.code !== outcome.code) throw new Error('Simulation settlement contradicts its authoritative effect')
      return { ...outcome.state, operations: { ...outcome.state.operations, [record.id]: { ...operation,
        status: outcome.status,
        result: { operationId: operation.id, status: outcome.status, code: outcome.code, sequence, time: state.time },
      } } }
    }
    /* v8 ignore next 2 -- persisted records cross the strict discriminated schema. */
    default: return assertNever(record)
  }
}
/**
 * Build an acceptance batch after the current writer and permissions have been checked.
 * @param state - Current run projection.
 * @param decision - Owned open slot.
 * @param proposals - Ordered validated effects.
 * @returns acceptance and all initial intents, ready for one atomic append.
 */
export function acceptanceRecords(
  state: SimulationSnapshot, decision: SimulationDecision, proposals: readonly SimulationProposal[],
): BusinessRecord[] {
  const task = taskDecision(state, decision.id)
  if (task !== undefined && state.taskCancellations?.[task.execution.request.operationId] !== undefined) {
    throw new Error('Simulation cancelled task cannot accept additional decision proposals')
  }
  if (task?.execution.request.reportContinuation !== undefined
    && (proposals.length !== 0 || taskReportContinuationEvidence(state, task.execution.request) === undefined)) {
    throw new Error('Simulation report continuation accepts only acknowledgement of its original persisted report')
  }
  if (task?.execution.request.interaction?.execution === 'continuation'
    && (proposals.length !== 0 || taskContinuationEvidence(state, task.execution.request) === undefined)) {
    throw new Error('Simulation task continuation accepts only an acknowledgement of its original fulfilled effects')
  }
  if (decision.deterministic !== undefined && !isDeepStrictEqual(decision.deterministic.proposals, proposals)) {
    throw new Error('Simulation deterministic submission differs from its recorded output')
  }
  if (proposals.length > state.spec.maxOperationsPerDecision) throw new Error('Simulation decision exceeds its configured operation limit')
  const ids = proposals.map((_, index) => operationId(state.spec.runId, decision.id, index))
  const intents: Extract<BusinessRecord, { kind: 'operation/intent' }>[] = proposals.map((proposal, index) => {
    const dependencies = proposal.after.map((dependency) => {
      if (typeof dependency === 'number') {
        if (dependency >= index) throw new Error('Simulation operation dependencies must precede their consumer')
        return ids[dependency] as SimulationOperation['id']
      }
      if (!Object.hasOwn(state.operations, dependency)) throw new Error('Simulation dependency does not exist')
      return dependency
    })
    return { kind: 'operation/intent', id: ids[index] as SimulationOperation['id'], decisionId: decision.id, index,
      action: proposal.action, dependencies, fingerprint: businessFingerprint(proposal.action) }
  })
  return [{ kind: 'decision/accepted', id: decision.id, operationIds: ids, fingerprint: businessFingerprint(intents.map(intent => ({ after: intent.dependencies, action: intent.action }))) }, ...intents]
}
/**
 * Reject truncated/tampered acceptance batches before exposing a rebuilt run.
 * @param state - Projection at a complete durable tail.
 */
export function assertBusinessProjection(state: SimulationSnapshot): void {
  assertDispatchProjection(state)
  assertBudgetProjection(state)
  assertTokenProjection(state)
  assertCapacityProjection(state)
  assertKnowledgeProjection(state)
  assertTaskEvidence(state); assertTaskExecutions(state)
  if (state.activeWindowId !== undefined && !Object.hasOwn(state.windows ?? {}, state.activeWindowId)) {
    throw new Error('Simulation active window has no durable opening')
  }
  for (const window of Object.values(state.windows ?? {})) {
    if ((window.status === 'collecting') !== (state.activeWindowId === window.id)
      || window.request.decisions.length > state.spec.maxDecisionsPerWindow) throw new Error('Simulation window admission is inconsistent')
    let previousSlot: bigint | undefined
    let unfinished = false
    for (const selected of window.request.decisions) {
      const decision = requireDecision(state, selected.id)
      const slot = BigInt(decision.slot)
      if (decision.windowId !== window.id || decision.entityId !== selected.entityId
        || decision.snapshotRevision !== window.snapshotRevision
        || decision.time !== window.time || decision.context?.fingerprint !== businessFingerprint(selected.context)
        || previousSlot !== undefined && slot !== previousSlot + 1n
        || decision.status === 'submitted' && decision.submission === undefined
        || decision.status === 'accepted' && unfinished) {
        throw new Error('Simulation window decision order or frozen input is inconsistent')
      }
      previousSlot = slot
      unfinished ||= decision.status === 'open' || decision.status === 'submitted'
    }
    if (window.status === 'closed' && unfinished) throw new Error('Simulation closed window retains an unfinished decision')
  }
  for (const decision of Object.values(state.decisions)) {
    assertContextProjection(state, decision)
    if (decision.deterministic !== undefined && (decision.inference !== undefined
      || decision.deterministic.proposals !== undefined && decision.context?.status !== 'prepared'
      || (decision.status === 'accepted' || decision.status === 'submitted') && decision.deterministic.proposals === undefined
      || decision.submission !== undefined && !isDeepStrictEqual(decision.submission, decision.deterministic.proposals))) {
      throw new Error('Simulation deterministic policy lost its prepared input or recorded output')
    }
    if (decision.ingressId !== undefined) {
      const ingress = state.ingresses?.[decision.ingressId]
      const event = decision.wakeId === undefined ? undefined : state.scheduledEvents[decision.wakeId]
      if (ingress?.request.entityId !== decision.entityId || ingress.eventId !== decision.wakeId
        || event?.action.kind !== 'ingress' || event.action.ingressId !== decision.ingressId || event.status !== 'consumed') {
        throw new Error('Simulation decision ingress has no consumed recipient responsibility')
      }
    }
    if (decision.retry !== undefined) {
      const action = decision.wakeId === undefined ? undefined : state.scheduledEvents[decision.wakeId]?.action
      if (action?.kind !== 'conflict-retry' || action.rootDecisionId !== decision.retry.rootDecisionId
        || action.attempt !== decision.retry.attempt || action.operationId !== decision.retry.sourceOperationId
        || state.operations[action.operationId]?.entityId !== decision.entityId) {
        throw new Error('Simulation decision retry lost its conflict responsibility')
      }
    }
    const timing = decision.inference
    if (timing !== undefined && (timing.deadline !== timing.startedAt + state.spec.decisionTimeoutMs
      || timing.finishedAt !== undefined && (timing.finishedAt < timing.startedAt || timing.finishedAt >= timing.deadline || decision.status === 'open')
      || timing.expiredAt !== undefined && (timing.expiredAt < timing.deadline || timing.finishedAt !== undefined || decision.cancellation !== 'timeout'))) {
      throw new Error('Simulation inference timing contradicts its decision outcome')
    }
    if (decision.cancellation === 'timeout' && timing?.expiredAt === undefined) throw new Error('Simulation timeout has no recorded observation')
    const actor = state.entities[decision.entityId]
    if (actor?.writer === undefined || BigInt(decision.epoch) > BigInt(actor.writer.epoch)) {
      throw new Error('Simulation decision has no owning writer epoch')
    }
    if ((decision.status === 'open' || decision.status === 'submitted') && (!currentDecision(state, decision)
      || actor.writer.phase !== 'active' || actor.writer.epoch !== decision.epoch)) {
      throw new Error('Simulation open decision is outside its active writer interval')
    }
    if (decision.status !== 'accepted') continue
    const proposals = decision.operationIds.map((id, index) => {
      const operation = state.operations[id]
      if (operation === undefined || operation.decisionId !== decision.id || operation.entityId !== decision.entityId
        || operation.index !== index) throw new Error('Simulation accepted decision is missing its operation intents')
      return operation
    })
    if (proposals.length > state.spec.maxOperationsPerDecision) throw new Error('Simulation accepted decision exceeds its operation limit')
    const fingerprint = businessFingerprint(proposals.map(operation => ({ after: operation.dependencies, action: operation.action })))
    if (decision.fingerprint !== fingerprint) {
      throw new Error('Simulation accepted decision fingerprint does not match its intents')
    }
  }
}
/** Select the next local effect in durable decision/operation order.
 * @param state - Current run projection.
 * @returns the earliest unsettled local operation, excluding asynchronous communication.
 */
export function nextLocalOperation(state: SimulationSnapshot): SimulationOperation | undefined {
  return Object.values(state.operations).filter(operation => !isOutboxAction(operation.action) && operation.result === undefined)
    .sort((left, right) => {
      const a = BigInt(requireDecision(state, left.decisionId).slot)
      const b = BigInt(requireDecision(state, right.decisionId).slot)
      return a < b ? -1 : a > b ? 1 : left.index - right.index
    })[0]
}
/* v8 ignore next 3 -- only the closed-union default calls this helper. */
function assertNever(value: never): never { throw new Error(`Unknown business record: ${String(value)}`) }

/** Publish prepared context or its exact bounded-context stall through one decision fold. */
function preparedDecisionContext(
  state: SimulationSnapshot, decision: SimulationDecision, context: ReturnType<typeof prepareContext>,
): SimulationSnapshot {
  const next = replaceDecision(state, { ...decision, context }, false)
  return context.status === 'prepared' ? next : { ...next, phase: 'stalled', stall: {
    code: 'SIM_CONTEXT_REQUIRED_ITEM_OVERFLOW', decisionId: decision.id, requiredBytes: context.requiredBytes,
    maxBytes: context.maxBytes, recovery: 'cancel-decision-adjust-budget-and-resume',
  } }
}
