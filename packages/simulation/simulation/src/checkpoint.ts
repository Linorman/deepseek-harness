import type { SimulationEntity } from './entity-types.ts'
/** Durable checkpoint requests and immutable cross-owner manifests. @module @clocky/clocky-simulation/checkpoint */
import { z } from 'zod'
import type { Branded } from '@clocky/clocky-brand'
import { SessionId } from '@clocky/clocky-session'
import { teamIdSchema, channelIdSchema, participantIdSchema } from '@clocky/clocky-team'
import { simulationRunIdSchema } from './schema.ts'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationWriterEpochSchema } from './writer.ts'
import { simTimeSchema } from './time.ts'
import { simulationEventIdSchema, simulationEventSlotSchema } from './scheduler.ts'
import { simulationOperationIdSchema, simulationDecisionSlotSchema } from './business.ts'

/** Caller-retained identity of one checkpoint request. */
export const simulationCheckpointIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationCheckpointId'>)
/** Explicit implementation identity and bounded collector policy. */
export const simulationCheckpointRequestSchema = z.strictObject({ id: simulationCheckpointIdSchema,
  implementationVersion: z.string().min(1), maxDrainRounds: z.number().int().positive(), maxAttempts: z.number().int().positive() })
/** Read-only checkpoint selection; retries revalidate the same manifest against the current retained suffix. */
export const simulationCheckpointRestoreRequestSchema = z.strictObject({ id: simulationCheckpointIdSchema,
  implementationVersion: z.string().min(1), maxAttempts: z.number().int().positive() })
/** Explicit implementation compatibility and bounded owner-movement retries for restoration. */
export type SimulationCheckpointRestoreRequest = z.infer<typeof simulationCheckpointRestoreRequestSchema>
/** Stable checkpoint identity. */
export type SimulationCheckpointId = z.infer<typeof simulationCheckpointIdSchema>
/** Immutable checkpoint command; changed retries reject. */
export type SimulationCheckpointRequest = z.infer<typeof simulationCheckpointRequestSchema>
const fingerprint = <B extends string>() => z.string().regex(/^sha256:[a-f0-9]{64}$/).transform(value => value as Branded<B>)
const stream = z.strictObject({ name: z.string().min(1), version: z.number().int().nonnegative() })
const ownerFields = { stream, cursor: z.number().int().nonnegative(), firstSequence: z.literal(0), retention: z.literal('full'),
  projectionVersion: z.number().int().nonnegative(), fingerprint: fingerprint<'TeamPersistenceFingerprint'>() }
const sessionBinding = { sessionId: z.string().min(1).transform(SessionId), teamId: teamIdSchema, participantId: participantIdSchema }
/** Reserved identity with no live owner, stored artifact or execution history at the cut. */
export const simulationUnmaterializedSessionSchema = z.strictObject({ kind: z.literal('unmaterialized'), ...sessionBinding })
/** Strict persisted manifest; run projections are reconstructed at the named journal cursor. */
export const simulationCheckpointManifestSchema = z.strictObject({
  version: z.literal(2), id: simulationCheckpointIdSchema, implementationVersion: z.string().min(1),
  rulesVersion: z.string().min(1), policyVersion: z.string().min(1), rng: z.strictObject({ kind: z.literal('none') }),
  run: z.strictObject({ runId: simulationRunIdSchema, backend: z.enum(['json', 'sqlite']), stream,
    cursor: z.number().int().nonnegative(), firstSequence: z.literal(0), retention: z.literal('full'), fingerprint: fingerprint<'SimulationRunFingerprint'>() }),
  team: z.strictObject({ ...ownerFields, owner: z.strictObject({ kind: z.literal('team'), teamId: teamIdSchema }) }),
  channels: z.array(z.strictObject({ ...ownerFields, owner: z.strictObject({ kind: z.literal('channel'), channelId: channelIdSchema }) })),
  sessions: z.array(z.discriminatedUnion('kind', [simulationUnmaterializedSessionSchema,
    z.strictObject({ kind: z.literal('materialized'), ...sessionBinding, formatVersion: z.literal(0), sequence: z.number().int().min(-1),
      revision: z.string().min(1).transform(value => value as Branded<'SessionPersistenceRevision'>),
      fingerprint: fingerprint<'SessionPersistenceFingerprint'>(), retention: z.literal('full') })])),
  state: z.strictObject({ time: simTimeSchema, nextEventSlot: simulationEventSlotSchema, nextDecisionSlot: simulationDecisionSlotSchema,
    nextIngressSlot: simulationEventSlotSchema, activeWindowId: z.null(),
    contextVersions: z.strictObject({ personas: z.array(z.string().min(1)), models: z.array(z.string().min(1)),
      policies: z.array(z.string().min(1)) }),
    pendingEvents: z.array(simulationEventIdSchema), pendingOperations: z.array(simulationOperationIdSchema),
    pendingWakes: z.array(simulationEventIdSchema),
    writers: z.array(z.strictObject({ entityId: simulationEntityIdSchema, epoch: simulationWriterEpochSchema, phase: z.literal('released') })) }),
})
/** A complete reference vector and its exact run-prefix responsibilities. */
export type SimulationCheckpointManifest = z.infer<typeof simulationCheckpointManifestSchema>
/** Request progress and a terminal result retained independently of later checkpoints. */
export type SimulationCheckpointOperation = { readonly request: SimulationCheckpointRequest; readonly startedSequence: number } & (
  | { readonly status: 'in-progress' }
  | { readonly status: 'failed'; readonly finishedSequence: number; readonly error: string }
  | { readonly status: 'completed'; readonly finishedSequence: number; readonly manifest: SimulationCheckpointManifest }
)

/**
 * Derive the responsibilities and counters at one exact journal position.
 * @param state - Quiescent run state before manifest publication.
 * @returns deterministic manifest summary; the full projection is bound by its fingerprint.
 */
export function checkpointState(state: import('./types.ts').SimulationSnapshot): SimulationCheckpointManifest['state'] {
  const versions = Object.values(state.decisions).flatMap(decision => decision.context?.status === 'prepared' ? [decision.context.view.versions] : [])
  return { time: state.time, nextEventSlot: state.nextEventSlot, nextDecisionSlot: state.nextDecisionSlot,
    nextIngressSlot: state.nextIngressSlot ?? simulationEventSlotSchema.parse('0'), activeWindowId: null,
    contextVersions: { personas: [...new Set(versions.map(value => value.persona))].sort(),
      models: [...new Set(versions.map(value => value.model))].sort(), policies: [...new Set(versions.map(value => value.policy))].sort() },
    pendingEvents: Object.values(state.scheduledEvents).filter(value => value.status === 'pending').map(value => value.id).sort(),
    pendingOperations: Object.values(state.operations).filter(value => value.result === undefined).map(value => value.id).sort(),
    pendingWakes: Object.values(state.wakes).filter(value => value.status === 'pending' || value.status === 'claimed')
      .map(value => value.eventId).sort(),
    writers: Object.values(state.entities).map(value => value.id).sort()
      .flatMap((id) => {
        const value = state.entities[id] as SimulationEntity
        if (value.writer === undefined) return []
        if (value.writer.phase !== 'released') throw new Error('Checkpoint state retains a live writer')
        return [{ entityId: value.id, epoch: value.writer.epoch, phase: value.writer.phase }]
      }) }
}

/**
 * Preserve the execution Team recorded by root reservation and completed checkpoints.
 * @param state - Current authoritative run projection.
 * @param teamId - Team proposed for binding, attachment or checkpoint publication.
 * @returns normally only when every retained execution-owner identity agrees.
 */
export function assertCanonicalTeam(state: import('./types.ts').SimulationSnapshot, teamId: import('@clocky/clocky-team').TeamId): void {
  if (state.teamReservation !== undefined && state.teamReservation.teamId !== teamId
    || Object.values(state.checkpoints ?? {}).some(checkpoint => checkpoint.status === 'completed'
      && checkpoint.manifest.team.owner.teamId !== teamId)) {
    throw new Error('Simulation canonical Team cannot change after reservation or checkpoint')
  }
}
