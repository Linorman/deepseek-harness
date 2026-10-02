/** Checkpoint request outcomes and atomic publication of exact run-prefix manifests. @module @clocky/clocky-simulation-local/checkpoints */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { simulationCheckpointRequestSchema, simulationCheckpointIdSchema, simulationCheckpointManifestSchema,
  checkpointState, assertCanonicalTeam, simulationCheckpointDiagnosticSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import { businessFingerprint } from './business.ts'

/** Checkpoint requests and their terminal outcomes are durable run events. */
export const checkpointRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('checkpoint/requested'), request: simulationCheckpointRequestSchema }),
  z.strictObject({ kind: z.literal('checkpoint/failed'), id: simulationCheckpointIdSchema, error: z.string().min(1),
    diagnostic: simulationCheckpointDiagnosticSchema.optional() }),
  z.strictObject({ kind: z.literal('checkpoint/published'), publishedAt: z.number().int().nonnegative(), manifest: simulationCheckpointManifestSchema }),
])
/** Validated checkpoint state transition. */
export type CheckpointRecord = z.infer<typeof checkpointRecordSchema>
/**
 * Apply request identity checks and verify every published run reference against its actual prefix.
 * @param state - Previous run projection.
 * @param record - Parsed request/outcome.
 * @param sequence - Position of this record.
 * @returns updated request history and latest complete checkpoint pointer.
 */
export function foldCheckpoint(state: SimulationSnapshot, record: CheckpointRecord, sequence: number): SimulationSnapshot {
  if (record.kind === 'checkpoint/requested') {
    if (Object.hasOwn(state.checkpoints ?? {}, record.request.id)
      || Object.values(state.management ?? {}).some(value => value.status === 'in-progress')
      || Object.values(state.checkpoints ?? {}).some(value => value.status === 'in-progress')) {
      throw new Error('Simulation checkpoint request already exists or another checkpoint is pending')
    }
    return { ...state, checkpoints: { ...state.checkpoints, [record.request.id]: {
      request: record.request, startedSequence: sequence, status: 'in-progress',
    } } }
  }
  const id = record.kind === 'checkpoint/published' ? record.manifest.id : record.id
  const checkpoints = state.checkpoints ?? {}
  const operation = Object.hasOwn(checkpoints, id) ? checkpoints[id] : undefined
  if (operation?.status !== 'in-progress') throw new Error('Checkpoint outcome has no pending request')
  if (record.kind === 'checkpoint/failed') return { ...state, checkpoints: { ...state.checkpoints, [id]: {
    ...operation, status: 'failed', finishedSequence: sequence, error: record.error,
    ...record.diagnostic === undefined ? {} : { diagnostic: record.diagnostic },
  } } }
  const manifest = record.manifest
  if (state.teamReservation?.confirmed === false || state.phase === 'running' || state.activeDecisionId !== undefined || state.activeWindowId !== undefined
    || Object.values(state.entities).some(value => value.writer !== undefined && value.writer.phase !== 'released')
    || manifest.run.runId !== state.spec.runId || manifest.run.cursor !== state.revision
    || manifest.run.fingerprint !== businessFingerprint(state) || manifest.implementationVersion !== operation.request.implementationVersion
    || manifest.rulesVersion !== state.spec.rulesVersion || manifest.policyVersion !== state.spec.policyVersion
    || !isDeepStrictEqual(manifest.state, checkpointState(state))) throw new Error('Checkpoint manifest does not match its quiescent run prefix')
  assertCanonicalTeam(state, manifest.team.owner.teamId)
  const bindings = Object.values(state.entities).flatMap(entity => entity.binding === undefined ? [] : [entity.binding])
  if (manifest.sessions.length !== bindings.length || new Set(manifest.sessions.map(value => value.sessionId)).size !== bindings.length
    || bindings.some(binding => binding.teamId !== manifest.team.owner.teamId || !manifest.sessions.some(value =>
      value.sessionId === binding.sessionId && value.teamId === binding.teamId && value.participantId === binding.participantId))
    || new Set(manifest.channels.map(value => value.owner.channelId)).size !== manifest.channels.length
    || Object.values(state.channelReservations ?? {}).some(channel =>
      !manifest.channels.some(value => value.owner.channelId === channel.channelId))) {
    throw new Error('Checkpoint manifest omits or changes canonical owner references')
  }
  if (Object.values(state.entities).some(entity => entity.writer !== undefined && manifest.sessions.some(reference =>
    reference.sessionId === entity.binding?.sessionId && reference.kind === 'unmaterialized'))) {
    throw new Error('Checkpoint cannot omit an executed Session history')
  }
  return { ...state, latestCheckpointId: id, checkpoints: { ...state.checkpoints, [id]: {
    ...operation, status: 'completed', finishedSequence: sequence, publishedAt: record.publishedAt, manifest,
  } } }
}
