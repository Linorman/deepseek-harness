/** Durable auxiliary refusals retain request ownership without charging an undispatched model. */
import { z } from 'zod'
import { simulationEntityIdSchema, simulationWriterEpochSchema, simulationCompactionTokenRequestSchema,
  simulationModelPoolUsageSchema, simulationDecisionIdSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationCompactionAdmissionBlock } from '@clocky/clocky-simulation'
import { currentDecision, requireDecision, foldBusinessRecord } from './decisions.ts'
import { requireWriterEpoch } from './writers.ts'

/** Canonical writer-attested pool rejection, with any exact unsubmitted decision ownership. */
export const compactionAdmissionRecordSchema = z.strictObject({ kind: z.literal('compaction/model-blocked'),
  entityId: simulationEntityIdSchema, epoch: simulationWriterEpochSchema,
  request: simulationCompactionTokenRequestSchema, pool: simulationModelPoolUsageSchema,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  decisionId: simulationDecisionIdSchema.optional() })
/** Parsed auxiliary admission fact. */
export type CompactionAdmissionRecord = z.infer<typeof compactionAdmissionRecordSchema>

/**
 * Retain an exact refusal and atomically return any unsubmitted wake before publishing its stop.
 * @param state - Current writer and optional active decision ownership.
 * @param record - Strict owner-attested request and pool facts.
 * @param sequence - Atomic journal position shared with cancellation.
 * @returns stopped projection; a concurrent explicit pause remains paused.
 */
export function foldCompactionAdmission(state: SimulationSnapshot,
  record: CompactionAdmissionRecord, sequence: number): SimulationSnapshot {
  const entity = requireWriterEpoch(state, record.entityId, record.epoch)
  const cancelledTask = Object.values(state.taskExecutions ?? {}).some(execution => execution.retired === undefined
    && execution.request.entityId === record.entityId && execution.request.epoch === record.epoch
    && state.taskCancellations?.[execution.request.operationId] !== undefined)
  const decision = Object.values(state.decisions).find(value => value.entityId === entity.id && value.epoch === record.epoch
    && value.status === 'open' && currentDecision(state, value))
  if (!['running', 'paused'].includes(state.phase) || cancelledTask || entity.readiness !== 'ready' || entity.phase !== 'active'
    || entity.writer?.phase !== 'active' || entity.binding === undefined || record.decisionId !== decision?.id
    || state.compactionAdmissionBlocks?.some(value => value.entityId === record.entityId
      && value.request.compactionId === record.request.compactionId)) {
    throw new Error('Simulation compaction refusal requires its exact current writer and unsubmitted decision')
  }
  const next = decision === undefined ? state : foldBusinessRecord(state, { kind: 'decision/cancelled', id: decision.id }, sequence)
  const block: SimulationCompactionAdmissionBlock = { entityId: entity.id, epoch: record.epoch,
    sessionId: entity.binding.sessionId, request: record.request, pool: record.pool, requestHash: record.requestHash,
    ...decision === undefined ? {} : { decisionId: decision.id } }
  return { ...next, compactionAdmissionBlocks: [...state.compactionAdmissionBlocks ?? [], block],
    phase: state.phase === 'paused' ? 'paused' : 'stalled', stall: { code: 'SIM_COMPACTION_MODEL_POOL_CAPACITY',
      entityId: entity.id, compactionId: record.request.compactionId, recovery: 'release-capacity-and-explicitly-resume' } }
}

/**
 * Validate retained request ownership and any cancelled decision relationship.
 * @param state - Complete authoritative projection after append or replay.
 */
export function assertCompactionAdmissionProjection(state: SimulationSnapshot): void {
  const seen = new Set<string>()
  for (const block of state.compactionAdmissionBlocks ?? []) {
    z.string().regex(/^[a-f0-9]{64}$/).parse(block.requestHash)
    simulationCompactionTokenRequestSchema.parse(block.request)
    simulationModelPoolUsageSchema.parse(block.pool)
    const entity = state.entities[block.entityId], key = JSON.stringify([block.entityId, block.request.compactionId])
    if (seen.has(key) || entity?.binding?.sessionId !== block.sessionId || entity.writer === undefined
      || BigInt(block.epoch) > BigInt(entity.writer.epoch)) throw new Error('Simulation compaction refusal lost canonical ownership')
    seen.add(key)
    if (block.decisionId !== undefined) {
      const decision = requireDecision(state, block.decisionId)
      if (decision.entityId !== block.entityId || decision.epoch !== block.epoch
        || decision.status !== 'cancelled' || decision.cancellation !== 'requested') {
        throw new Error('Simulation compaction refusal lost its cancelled decision')
      }
    }
  }
  if (state.stall?.code === 'SIM_COMPACTION_MODEL_POOL_CAPACITY') {
    const stall = state.stall
    if (!state.compactionAdmissionBlocks?.some(value => value.entityId === stall.entityId
      && value.request.compactionId === stall.compactionId)) throw new Error('Simulation compaction stop lost its request')
  }
}
