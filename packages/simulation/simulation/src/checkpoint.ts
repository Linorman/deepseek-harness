import type { SimulationEntity } from './entity-types.ts'
import type { SimulationCheckpointDiagnostic } from './checkpoint-diagnostics-types.ts'
export * from './checkpoint-diagnostics.ts'
/** Durable checkpoint requests and immutable cross-owner manifests. @module @clocky/clocky-simulation/checkpoint */
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { simulationWorldDomainPinSchema } from './world-domain.ts'
import type { Branded } from '@clocky/clocky-brand'
import { SessionId } from '@clocky/clocky-session/types'
import { teamIdSchema, channelIdSchema, participantIdSchema } from '@clocky/clocky-team'
import { simulationRunIdSchema } from './schema.ts'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationWriterEpochSchema } from './writer.ts'
import { simTimeSchema } from './time.ts'
import { simulationEventIdSchema, simulationEventSlotSchema } from './scheduler.ts'
import { simulationOperationIdSchema, simulationDecisionSlotSchema } from './business.ts'
export type { SimulationCheckpointId } from './identities.ts'

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
/** Immutable checkpoint command; changed retries reject. */
export type SimulationCheckpointRequest = z.infer<typeof simulationCheckpointRequestSchema>
const fingerprint = <B extends string>() => z.string().regex(/^sha256:[a-f0-9]{64}$/).transform(value => value as Branded<B>)
const stream = z.strictObject({ name: z.string().min(1), version: z.number().int().nonnegative() })
const ownerFields = { stream, cursor: z.number().int().nonnegative(), firstSequence: z.literal(0), retention: z.literal('full'),
  projectionVersion: z.number().int().nonnegative(), fingerprint: fingerprint<'TeamPersistenceFingerprint'>() }
const sessionBinding = { sessionId: z.string().min(1).transform(SessionId), teamId: teamIdSchema, participantId: participantIdSchema }
/** Original World implementation manifest and content-bound responsibility references, without private bodies. */
export const simulationCheckpointWorldSchema = z.strictObject({
  domains: z.array(simulationWorldDomainPinSchema),
  definitionFingerprint: fingerprint<'SimulationWorldDefinitionFingerprint'>(),
  projectionFingerprint: fingerprint<'SimulationWorldProjectionFingerprint'>(),
  records: z.array(z.strictObject({
    kind: z.enum(['bootstrap', 'calendar-command', 'calendar-revision', 'review-route', 'delegation', 'calendar-occurrence', 'intent', 'request', 'plan', 'result', 'execution', 'mutation', 'reservation', 'cancellation', 'fact',
      'evidence-challenge', 'evidence-revision', 'external-adjudication', 'external-event',
      'external-contact', 'external-representative', 'external-identity', 'external-interaction', 'proposal', 'vote', 'resolution', 'norm', 'norm-closure', 'norm-announcement', 'personnel-reservation', 'personnel-fence']),
    id: z.string().min(1), version: z.string().min(1).nullable(), sequence: z.number().int().positive(),
    fingerprint: fingerprint<'SimulationWorldRecordFingerprint'>(),
  })),
}).refine(value => new Set(value.domains.map(pin => JSON.stringify([pin.domain, pin.operation, pin.version]))).size
  === value.domains.length,
'Checkpoint World domains must have unique operation selectors')
  .refine(value => new Set(value.records.map(record => JSON.stringify([record.kind, record.id, record.version]))).size
    === value.records.length,
  'Checkpoint World records must have unique original identities and versions')
/** Reserved identity with no live owner, stored artifact or execution history at the cut. */
export const simulationUnmaterializedSessionSchema = z.strictObject({ kind: z.literal('unmaterialized'), ...sessionBinding })
/** Strict persisted manifest; run projections are reconstructed at the named journal cursor. */
export const simulationCheckpointManifestSchema = z.strictObject({
  version: z.literal(8), id: simulationCheckpointIdSchema, implementationVersion: z.string().min(1),
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
    world: simulationCheckpointWorldSchema.nullable(),
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
  | { readonly status: 'failed'; readonly finishedSequence: number; readonly error: string; readonly diagnostic?: SimulationCheckpointDiagnostic | undefined }
  | { readonly status: 'completed'; readonly finishedSequence: number; readonly publishedAt: number; readonly manifest: SimulationCheckpointManifest }
)

/**
 * Derive the responsibilities and counters at one exact journal position.
 * @param state - Quiescent run state before manifest publication.
 * @returns deterministic manifest summary; the full projection is bound by its fingerprint.
 */
export function checkpointState(state: import('./types.ts').SimulationSnapshot): SimulationCheckpointManifest['state'] {
  const versions = Object.values(state.decisions).flatMap(decision => decision.context?.status === 'prepared' ? [decision.context.view.versions] : [])
  return { time: state.time, nextEventSlot: state.nextEventSlot, nextDecisionSlot: state.nextDecisionSlot,
    world: checkpointWorldState(state),
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
 * Bind installed World generations and every retained business record at the checkpoint cut.
 * @param state - Exact quiescent Native prefix, never a current deployment projection.
 * @returns the strict World reference manifest, or null for a base simulation without World state.
 */
export function checkpointWorldState(state: import('./types.ts').SimulationSnapshot):
SimulationCheckpointManifest['state']['world'] {
  const world = state.world
  if (world === undefined) return null
  const digest = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
  type RecordKind = z.infer<typeof simulationCheckpointWorldSchema>['records'][number]['kind']
  const records: {
    kind: RecordKind
    id: string
    version: string | null
    sequence: number
    fingerprint: string
  }[] = []
  const appendRecords = (kind: RecordKind, values: Readonly<Record<string, { readonly sequence: number }>>) => {
    for (const [id, value] of Object.entries(values)) {
      records.push({ kind, id, version: null, sequence: value.sequence, fingerprint: digest(value) })
    }
  }
  const tables = [
    ['external-contact', world.external.contacts], ['external-representative', world.external.representatives], ['external-identity', world.external.identities], ['external-interaction', world.external.interactions],
    ['intent', world.intents], ['request', world.requests], ['plan', world.plans], ['result', world.results],
    ['execution', world.executions], ['mutation', world.mutations], ['reservation', world.reservations], ['cancellation', world.cancellations],
    ['proposal', world.governance.proposals], ['vote', world.governance.votes], ['resolution', world.governance.resolutions],
    ['norm-announcement', world.norms.announcements],
    ['evidence-challenge', world.evidence.challenges], ['external-adjudication', world.external.adjudications],
    ['personnel-reservation', world.personnel.reservations], ['personnel-fence', world.personnel.fences],
  ] as const
  for (const [kind, values] of tables) appendRecords(kind, values)
  for (const value of Object.values(world.governance.routes ?? {})) records.push({ kind: 'review-route', id: value.id,
    version: String(value.revision), sequence: value.sequence, fingerprint: digest(value) })
  for (const value of world.governance.delegations ?? []) records.push({ kind: 'delegation', id: value.id,
    version: null, sequence: value.sequence, fingerprint: digest(value) })
  for (const [id, value] of Object.entries(world.evidence.revisions)) records.push({ kind: 'evidence-revision', id,
    version: String(value.revision), sequence: value.sequence, fingerprint: digest(value) })
  for (const [id, value] of Object.entries(world.external.events)) records.push({ kind: 'external-event', id,
    version: null, sequence: value.original.adjudicationSequence, fingerprint: digest(value) })
  if (state.worldBootstrap !== undefined) {
    records.push({ kind: 'bootstrap', id: state.worldBootstrap.request.definitionHash, version: '1',
      sequence: state.worldBootstrap.sequence, fingerprint: digest(state.worldBootstrap) })
    for (const value of state.worldBootstrap.calendarCommands ?? []) records.push({ kind: 'calendar-command',
      id: value.request.commandId, version: '1', sequence: value.sequence, fingerprint: digest(value) })
    for (const value of state.worldBootstrap.calendarRevisions ?? []) records.push({ kind: 'calendar-revision',
      id: value.request.calendar.id, version: String(value.revision), sequence: value.sequence, fingerprint: digest(value) })
    for (const value of state.worldBootstrap.occurrences) records.push({ kind: 'calendar-occurrence', id: value.eventId,
      version: String(value.occurrence), sequence: value.sequence, fingerprint: digest(value) })
  }
  for (const [id, versions] of Object.entries(world.facts)) {
    for (const value of versions) records.push({ kind: 'fact', id, version: value.version,
      sequence: value.sequence, fingerprint: digest(value) })
  }
  for (const [id, versions] of Object.entries(world.norms.versions)) {
    for (const value of versions) records.push({ kind: 'norm', id, version: value.version,
      sequence: value.sequence, fingerprint: digest(value) })
  }
  for (const value of world.norms.closures) records.push({ kind: 'norm-closure', id: value.id, version: null,
    sequence: value.sequence, fingerprint: digest(value) })
  records.sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1
    : (a.version ?? '') < (b.version ?? '') ? -1 : (a.version ?? '') > (b.version ?? '') ? 1 : 0)
  return simulationCheckpointWorldSchema.parse({ domains: world.definition.operations,
    definitionFingerprint: digest(world.definition), projectionFingerprint: digest({ world, bootstrap: state.worldBootstrap ?? null }),
    records })
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
