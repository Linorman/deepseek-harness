import { assertSimulationMaintenanceAdmission } from '@clocky/clocky-simulation'
import { channelReceiptRecordSchema, channelDeliveryExpiredRecordSchema } from '@clocky/clocky-team'
/** Durable technical attempts for exact, idempotent Team publication. @module @clocky/clocky-simulation-local/outbox */
import { z } from 'zod'
import {
  simulationOperationIdSchema, simulationDispatchOutcomeSchema, simulationWallTimeSchema,
  simulationWriterEpochSchema, simulationEventIdSchema,
  simulationOutboxRetryRequestSchema,
  simulationOutboxRetryCapability,
} from '@clocky/clocky-simulation'
import type {
  SimulationOperation, SimulationOperationId, SimulationOutbox, SimulationOutboundMessage,
  SimulationPostAttempt, SimulationSnapshot,
} from '@clocky/clocky-simulation'

/** Every attempt is durable before invoking a transport. */
export const outboxRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('outbox/delivery-failure-resolved'), id: simulationOperationIdSchema,
    resolution: z.union([z.strictObject({ kind: z.enum(['retained-input', 'entity-terminated']) }),
      z.strictObject({ kind: z.literal('absent-input'), epoch: simulationWriterEpochSchema })]) }),
  z.strictObject({ kind: z.literal('outbox/delivery-failed'), id: simulationOperationIdSchema, record: channelDeliveryExpiredRecordSchema }),
  z.strictObject({ kind: z.literal('outbox/delivery-receipted'), id: simulationOperationIdSchema, receipt: channelReceiptRecordSchema }),
  z.strictObject({ kind: z.literal('outbox/received'), id: simulationOperationIdSchema, epoch: simulationWriterEpochSchema }),
  z.strictObject({ kind: z.literal('outbox/started'), id: simulationOperationIdSchema, number: z.number().int().positive(), at: simulationWallTimeSchema }),
  z.strictObject({ kind: z.literal('outbox/finished'), id: simulationOperationIdSchema, number: z.number().int().positive(),
    at: simulationWallTimeSchema, outcome: simulationDispatchOutcomeSchema }),
  z.strictObject({ kind: z.literal('outbox/uncertain'), id: simulationOperationIdSchema, number: z.number().int().positive(),
    at: simulationWallTimeSchema, detail: z.string().min(1) }),
  z.strictObject({ kind: z.literal('outbox/exhausted'), id: simulationOperationIdSchema }),
  z.strictObject({ kind: z.literal('outbox/blocked'), id: simulationOperationIdSchema,
    code: z.enum(['SIM_DEPENDENCY_FAILED', 'SIM_ENTITY_UNAVAILABLE']) }),
  z.strictObject({ kind: z.literal('outbox/retry-authorized'), id: simulationOperationIdSchema,
    request: simulationOutboxRetryRequestSchema }),
])
/** Parsed outbox event. */
export type OutboxRecord = z.infer<typeof outboxRecordSchema>
/** An accepted communication always owns its outbox state. */
export type OutboxOperation = SimulationOperation & {
  readonly action: Extract<SimulationOperation['action'], { kind: 'communication/post' | 'task/create' }>
  readonly outbox: SimulationOutbox
}
/**
 * Resolve the exact accepted communication.
 * @param state - Run state.
 * @param id - Operation identity.
 * @returns retained intent.
 */
export function requireOutbox(state: SimulationSnapshot, id: SimulationOperationId): OutboxOperation {
  const operation = Object.hasOwn(state.operations, id) ? state.operations[id] : undefined
  if (!isOutboxAction(operation?.action) || operation.outbox === undefined) throw new Error('Simulation operation is not an accepted outbox intent')
  return operation as OutboxOperation
}
/**
 * Check immutable prerequisite outcomes.
 * @param state - Current run.
 * @param operation - Accepted intent.
 * @returns whether every prerequisite is terminal.
 */
export function dependenciesReady(state: SimulationSnapshot, operation: SimulationOperation): boolean {
  return operation.dependencies.every(id => state.operations[id]?.result !== undefined)
}
/**
 * Check successful prerequisites.
 * @param state - Current run.
 * @param operation - Accepted intent.
 * @returns whether an earlier operation failed.
 */
export function dependencyFailed(state: SimulationSnapshot, operation: SimulationOperation): boolean {
  return operation.dependencies.some((id) => {
    const result = state.operations[id]?.result
    return result !== undefined && result.status !== 'applied'
  })
}
/** Derive actual canonical identities without trusting tool-supplied sender fields.
 * @param state - Authoritative run projection.
 * @param operation - Accepted due intent.
 * @returns immutable transport input; inactive entities only permit reconciliation.
 */
export function outboundMessage(state: SimulationSnapshot, operation: OutboxOperation): SimulationOutboundMessage {
  if (operation.action.kind !== 'communication/post') throw new Error('Message transport requires communication')
  const sender = state.entities[operation.entityId]
  const recipient = state.entities[operation.action.recipient]
  if (sender?.binding === undefined || recipient?.binding === undefined || sender.binding.teamId !== recipient.binding.teamId) {
    throw new Error('Simulation communication has no canonical sender and recipient bindings')
  }
  return { runId: state.spec.runId, decisionId: operation.decisionId, operationId: operation.id,
    fingerprint: operation.fingerprint, entityId: operation.entityId, sender: sender.binding, recipient: recipient.binding,
    channelId: operation.action.channelId, text: operation.action.text,
    publishAllowed: sender.phase === 'active' && recipient.phase === 'active' }
}
function replace(state: SimulationSnapshot, operation: SimulationOperation): SimulationSnapshot {
  return { ...state, operations: { ...state.operations, [operation.id]: operation } }
}
function unknownOutcome(state: SimulationSnapshot, operation: OutboxOperation): SimulationSnapshot {
  return { ...replace(state, { ...operation, status: 'outcome-unknown' }), phase: 'stalled',
    stall: { code: 'SIM_OUTBOX_OUTCOME_UNKNOWN', operationId: operation.id, recovery: 'authorize-idempotent-retry-and-resume' } }
}
/** Replay attempt facts without invoking a target or a model.
 * @param state - State preceding the record.
 * @param record - Parsed attempt or management event.
 * @param sequence - Durable event position.
 * @returns the prospective projection.
 */
export function foldOutboxRecord(state: SimulationSnapshot, record: OutboxRecord, sequence: number): SimulationSnapshot {
  const operation = requireOutbox(state, record.id)
  const outbox = operation.outbox
  if (record.kind === 'outbox/delivery-failed') {
    if (operation.action.kind !== 'communication/post') throw new Error('Task creation cannot have message delivery evidence')
    const recipient = state.entities[operation.action.recipient]
    if (operation.result?.status !== 'applied' || operation.deliveryFailure !== undefined || operation.delivery?.receipt !== undefined
      || record.record.envelopeId !== outbox.receipt?.envelopeId || record.record.envelopeSequence !== outbox.receipt.sequence
      || record.record.participantId !== recipient?.binding?.participantId) {
      throw new Error('Simulation delivery failure does not match its unreceipted publication')
    }
    return { ...replace(state, { ...operation, deliveryFailure: { record: record.record, sequence, time: state.time } }),
      phase: 'stalled', stall: { code: 'SIM_DELIVERY_FAILED', operationId: operation.id, recovery: 'reconcile-recipient-responsibility' } }
  }
  if (record.kind === 'outbox/delivery-failure-resolved') {
    if (operation.action.kind !== 'communication/post') throw new Error('Task creation cannot have message delivery evidence')
    const recipient = state.entities[operation.action.recipient]
    const failed = operation.deliveryFailure
    const resolution = record.resolution
    if (failed === undefined || failed.resolution !== undefined
      || (resolution.kind === 'retained-input' && operation.delivery === undefined)
      || (resolution.kind === 'entity-terminated' && recipient?.phase !== 'terminated')
      || (resolution.kind === 'absent-input' && (operation.delivery !== undefined || recipient?.phase !== 'active'
        || recipient.writer?.phase !== 'active' || recipient.writer.epoch !== resolution.epoch))) {
      throw new Error('Simulation failed delivery resolution lacks recipient evidence')
    }
    return replace(state, { ...operation, deliveryFailure: { ...failed,
      resolution: { kind: resolution.kind, sequence, time: state.time } } })
  }
  if (operation.deliveryFailure !== undefined && record.kind !== 'outbox/received') {
    throw new Error('Simulation failed transport cannot receive another target result')
  }
  if (record.kind === 'outbox/delivery-receipted') {
    if (operation.action.kind !== 'communication/post') throw new Error('Task creation cannot have message delivery evidence')
    const recipient = state.entities[operation.action.recipient]
    if (operation.delivery === undefined || operation.delivery.receipt !== undefined
      || record.receipt.envelopeId !== outbox.receipt?.envelopeId || record.receipt.participantId !== recipient?.binding?.participantId) {
      throw new Error('Simulation target receipt does not match its durable delivery')
    }
    return replace(state, { ...operation, delivery: { ...operation.delivery, receipt: record.receipt } })
  }
  if (record.kind === 'outbox/received') {
    if (operation.action.kind !== 'communication/post') throw new Error('Task creation cannot have message delivery evidence')
    const recipient = state.entities[operation.action.recipient]
    if (operation.result?.status !== 'applied' || outbox.receipt === undefined || operation.delivery !== undefined
      || operation.deliveryFailure?.resolution !== undefined
      || recipient?.phase !== 'active' || recipient.binding === undefined || recipient.writer?.phase !== 'active'
      || recipient.writer.epoch !== record.epoch) throw new Error('Simulation delivery lacks its published target and current recipient')
    return replace(state, { ...operation, delivery: { wakeId: simulationEventIdSchema.parse(`simulation-delivery:${operation.id}`),
      sessionId: recipient.binding.sessionId, sequence, time: state.time } })
  }
  if (record.kind === 'outbox/retry-authorized') {
    const request = record.request
    if (request.operationId !== operation.id || operation.status !== 'outcome-unknown' || operation.result !== undefined
      || request.expectedAttemptCount !== outbox.attempts.length || !simulationOutboxRetryCapability(state, operation.id).allowed
      || Object.values(state.operations).some(value => Object.hasOwn(value.outbox?.retryAuthorizations ?? {}, request.id))) {
      throw new Error('Only the exact current unknown due outbox attempt can receive an original retry allowance')
    }
    const grant = { request, sequence, time: state.time, budgetStart: outbox.attempts.length, maxAttempts: state.spec.outboxMaxAttempts }
    return replace(state, { ...operation, status: 'pending', outbox: {
      ...outbox, budgetStart: outbox.attempts.length, nextAttemptAt: request.authorizedAt,
      retryAuthorizations: { ...outbox.retryAuthorizations, [request.id]: grant },
    } })
  }
  if (operation.result !== undefined || operation.status === 'outcome-unknown') throw new Error('Simulation outbox result is already retained or needs recovery')
  if (!outbox.ready || BigInt(state.time) < BigInt(operation.action.deliverAt)) throw new Error('Simulation outbox effect is not due')
  if (!dependenciesReady(state, operation)) throw new Error('Simulation outbox prerequisites are not applied')
  if (record.kind === 'outbox/blocked') {
    if (state.phase !== 'running' || state.activeWindowId !== undefined) throw new Error('Simulation outbox rejection is not admissible')
    const denied = record.code === 'SIM_DEPENDENCY_FAILED' ? dependencyFailed(state, operation)
      : !dependencyFailed(state, operation) && outbox.attempts.length === 0 && !outboundPayload(state, operation).publishAllowed
    if (!denied) throw new Error('Simulation outbox rejection lacks authoritative evidence')
    const status = record.code === 'SIM_DEPENDENCY_FAILED' ? 'blocked-dependency' as const : 'blocked-authority' as const
    return replace(state, { ...operation, status,
      result: { operationId: operation.id, status, code: record.code, sequence, time: state.time } })
  }
  if (dependencyFailed(state, operation)) throw new Error('Simulation outbox prerequisites are not applied')
  const exhausted = outbox.attempts.length - outbox.budgetStart >= state.spec.outboxMaxAttempts
  if (record.kind === 'outbox/exhausted') {
    if (!exhausted) throw new Error('Simulation outbox retry budget is not exhausted')
    return unknownOutcome(state, operation)
  }
  if (record.kind === 'outbox/started') {
    assertSimulationMaintenanceAdmission(state)
    if (state.phase !== 'running' || state.activeWindowId !== undefined || exhausted || record.number !== outbox.attempts.length + 1
      || outbox.nextAttemptAt !== undefined && record.at < outbox.nextAttemptAt) throw new Error('Simulation outbox attempt is not admissible')
    const next = { ...outbox, attempts: [...outbox.attempts, { number: record.number, startedAt: record.at, outcome: 'in-flight' as const }] }
    delete next.nextAttemptAt
    return replace(state, { ...operation, outbox: next })
  }
  const attempt = outbox.attempts.at(-1)
  if (attempt?.number !== record.number || attempt.outcome !== 'in-flight') throw new Error('Simulation outbox completion has no matching attempt')
  if (record.kind === 'outbox/uncertain') {
    const nextAttemptAt = simulationWallTimeSchema.parse(record.at + state.spec.outboxRetryDelayMs)
    const failed: SimulationPostAttempt = { ...attempt, finishedAt: record.at, outcome: 'uncertain', detail: record.detail }
    const next = { ...operation, outbox: { ...outbox, attempts: [...outbox.attempts.slice(0, -1), failed], nextAttemptAt } }
    return exhausted ? unknownOutcome(state, next) : replace(state, next)
  }
  const outcome = record.outcome
  if (outcome.status === 'applied' && !receiptMatches(state, operation, outcome)) {
    throw new Error('Simulation transport receipt does not match the accepted payload and target')
  }
  const finished: SimulationPostAttempt = { ...attempt, finishedAt: record.at, outcome: outcome.status }
  return replace(state, { ...operation, status: outcome.status,
    outbox: { ...outbox, attempts: [...outbox.attempts.slice(0, -1), finished],
      ...outcome.status !== 'applied' ? {} : 'receipt' in outcome ? { receipt: outcome.receipt } : { taskReceipt: outcome.taskReceipt } },
    result: { operationId: operation.id, status: outcome.status, sequence, time: state.time,
      code: outcome.status === 'applied' ? operation.action.kind === 'task/create' ? 'SIM_TASK_CREATED' : 'SIM_POSTED' : outcome.code } })
}

/**
 * Resolve source-owned outbound data for the selected target kind.
 * @param state - Authoritative run projection.
 * @param operation - Accepted outbox intent.
 * @returns immutable message or task target input.
 */
export function outboundPayload(state: SimulationSnapshot, operation: OutboxOperation):
SimulationOutboundMessage | import('@clocky/clocky-simulation').SimulationOutboundTask {
  if (operation.action.kind === 'communication/post') return outboundMessage(state, operation)
  const sender = state.entities[operation.entityId]
  if (sender?.binding === undefined) throw new Error('Simulation task requires its canonical creator binding')
  return { runId: state.spec.runId, decisionId: operation.decisionId, operationId: operation.id,
    entityId: operation.entityId, fingerprint: operation.fingerprint, sender: sender.binding,
    task: operation.action.task, publishAllowed: sender.phase === 'active' }
}
/**
 * Match a target receipt against the exact accepted operation and target domain.
 * @param state - Source identities.
 * @param operation - Accepted target intent.
 * @param outcome - Applied transport response.
 * @returns whether the receipt belongs to this operation.
 */
export function receiptMatches(state: SimulationSnapshot, operation: OutboxOperation,
  outcome: Extract<import('@clocky/clocky-simulation').SimulationDispatchOutcome, { status: 'applied' }>): boolean {
  const receipt = 'receipt' in outcome ? outcome.receipt : outcome.taskReceipt
  return receipt.operationId === operation.id && receipt.fingerprint === operation.fingerprint
    && (operation.action.kind === 'communication/post' ? 'receipt' in outcome && outcome.receipt.channelId === operation.action.channelId
      && outcome.receipt.runId === state.spec.runId && outcome.receipt.teamId === state.entities[operation.entityId]?.binding?.teamId
      && outcome.receipt.recipientId === state.entities[operation.action.recipient]?.binding?.participantId
      : 'taskReceipt' in outcome && outcome.taskReceipt.teamId === state.entities[operation.entityId]?.binding?.teamId)
}

/**
 * Select the accepted operation kinds executed by the shared outbox.
 * @param action - Operation action, or an absent lookup result.
 * @returns whether the action owns a durable external-target attempt.
 */
export function isOutboxAction(action: import('@clocky/clocky-simulation').SimulationOperationAction | undefined):
action is Extract<import('@clocky/clocky-simulation').SimulationOperationAction, { kind: 'communication/post' | 'task/create' }> {
  return action?.kind === 'communication/post' || action?.kind === 'task/create'
}
