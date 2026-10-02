import { simulationCheckpointManifestSchema, checkpointState } from '@clocky/clocky-simulation'
/** Unpublished cross-owner candidates held behind a run write barrier. @module @clocky/clocky-simulation-team/checkpoint */
import { isDeepStrictEqual } from 'node:util'
import { deepFreeze } from '@clocky/clocky-llm'
import type { Context } from '@clocky/cordis'
import { TeamError } from '@clocky/clocky-team'
import type { TeamId } from '@clocky/clocky-team'
import { SessionPersistenceReferenceChanged } from '@clocky/clocky-session-persistence'
import type { SimulationCheckpointCut, SimulationEntity, SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationCheckpointCollection } from './types.ts'
import { validateAcceptedTargets } from './target-references.ts'
import { checkpointRule, checkpointSource } from './checkpoint-failure.ts'
import { SimulationCheckpointError } from '@clocky/clocky-simulation'

/**
 * Collect and recheck every owner after the coordinator has retired local writers.
 * @param ctx - Canonical owner services.
 * @param run - Paused run held by the cut.
 * @param cut - Caller-owned sealed run position.
 * @param teamId - Dedicated execution Team.
 * @param ownerName - Lifecycle owner registered by the connection.
 * @param maxAttempts - Positive bound on retries caused by owner movement.
 * @param check - Live collector admission and cancellation check.
 * @param release - Release the run cut and connection admission barrier.
 * @param signal - Optional cancellation propagated to Session storage reads.
 * @returns an unpublished candidate with repeatable validation and explicit release.
 */
export async function collectCheckpoint(ctx: Context, run: SimulationRun, cut: SimulationCheckpointCut, teamId: TeamId,
  ownerName: string, maxAttempts: number, check: () => void, release: () => void,
  signal?: AbortSignal): Promise<SimulationCheckpointCollection> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      check()
      const teamSubject = { kind: 'team' as const, teamId }
      if (cut.reference.firstSequence !== 0) throw checkpointRule('Checkpoint run history has been removed',
        'collect', 'history-incomplete', { kind: 'run' })
      const team = await checkpointSource('collect', teamSubject, () => ctx.teams.getTeam({ teamId }))
      if (team.rules['simulationRunId'] !== cut.snapshot.spec.runId) throw checkpointRule('Checkpoint Team belongs to another run',
        'collect', 'binding-mismatch', teamSubject)
      if (team.rules['activationLifecycleOwner'] !== ownerName) throw checkpointRule('Checkpoint Team has another lifecycle owner',
        'collect', 'owner-conflict', teamSubject)
      if (Object.values(cut.snapshot.channelReservations ?? {}).some(value =>
        value.confirmed && !team.channelIds.includes(value.channelId))) {
        throw checkpointRule('Checkpoint run has a confirmed channel missing from its Team', 'collect', 'binding-mismatch', teamSubject)
      }
      if (team.team.parentTeamId !== undefined || team.tasks.some(task => task.execution.kind === 'child-team')) {
        throw checkpointRule('Checkpoint collection does not cover child-Team owners', 'collect', 'unsupported-ownership', teamSubject)
      }
      if (team.activations.some(binding => binding.quiescedAt === undefined)) {
        throw checkpointRule('Checkpoint Team retains an activation without confirmed quiescence', 'collect', 'owner-not-quiescent', teamSubject)
      }
      if (team.participants.some(participant => participant.activationReservation !== undefined
        && participant.activationReservation.releasedAt === undefined
        && !team.activations.some(binding => binding.reservationId === participant.activationReservation?.id))) {
        throw checkpointRule('Checkpoint Team retains an unpublished startup without confirmed release', 'collect', 'owner-not-quiescent', teamSubject)
      }
      const teamReference = await checkpointSource('collect', teamSubject,
        () => ctx.teams.getPersistenceReference({ kind: 'team', teamId, expectedCursor: team.team.cursor }))
      if (teamReference.retention !== 'full') throw checkpointRule('Checkpoint Team history is not protected', 'collect', 'history-incomplete', teamSubject)
      if (teamReference.firstSequence !== 0) throw checkpointRule('Checkpoint Team history has been removed', 'collect', 'history-incomplete', teamSubject)
      const channels: SimulationCheckpointCollection['channels'][number][] = []
      for (const channelId of [...team.channelIds].sort()) {
        check()
        const subject = { kind: 'channel' as const, teamId, channelId }
        const channel = await checkpointSource('collect', subject, () => ctx.teams.getChannel({ channelId }))
        if (channel.manifest.teamId !== teamId) throw checkpointRule('Checkpoint channel belongs to another Team', 'collect', 'binding-mismatch', subject)
        const reference = await checkpointSource('collect', subject,
          () => ctx.teams.getPersistenceReference({ kind: 'channel', channelId, expectedCursor: channel.cursor }))
        if (reference.retention !== 'full') throw checkpointRule('Checkpoint channel history is not protected', 'collect', 'history-incomplete', subject)
        if (reference.firstSequence !== 0) throw checkpointRule('Checkpoint channel history has been removed', 'collect', 'history-incomplete', subject)
        channels.push(reference)
      }
      const sessions: SimulationCheckpointCollection['sessions'][number][] = []
      for (const id of Object.values(cut.snapshot.entities).map(entity => entity.id).sort()) {
        const entity = cut.snapshot.entities[id] as SimulationEntity
        const binding = entity.binding
        if (binding === undefined) continue
        const subject = { kind: 'session' as const, ...binding }
        check()
        if (binding.teamId !== teamId || !team.participants.some(value => value.id === binding.participantId)) {
          throw checkpointRule('Checkpoint entity has no canonical Team participant', 'collect', 'binding-mismatch', { kind: 'entity', entityId: entity.id })
        }
        if (entity.writer?.activationId !== undefined && !team.activations.some(value =>
          value.activation.id === entity.writer?.activationId && value.sessionId === binding.sessionId
          && value.activation.participantId === binding.participantId)) {
          throw checkpointRule('Checkpoint writer has no matching retained Team activation', 'collect', 'binding-mismatch', { kind: 'entity', entityId: entity.id })
        }
        if (await checkpointSource('collect', subject, () => ctx.sessionPersistence.isUnmaterialized(binding.sessionId, signal))) {
          if (entity.writer !== undefined || team.activations.some(value => value.sessionId === binding.sessionId
            || value.activation.participantId === binding.participantId)) {
            throw checkpointRule('Checkpoint Session history is missing for an executed entity', 'collect', 'history-incomplete', subject)
          }
          sessions.push({ kind: 'unmaterialized', ...binding })
          continue
        }
        const stored = await checkpointSource('collect', subject, () => ctx.sessionPersistence.readFrom(binding.sessionId, 0, signal))
        const reference = await checkpointSource('collect', subject,
          () => ctx.sessionPersistence.getPersistenceReference(binding.sessionId, stored.events.length - 1, signal))
        if (reference.retention !== 'full') throw checkpointRule('Checkpoint Session history is not protected', 'collect', 'history-incomplete', subject)
        if (reference.header.teamId !== teamId || reference.header.participantId !== binding.participantId) {
          throw checkpointRule('Checkpoint Session has another canonical binding', 'collect', 'binding-mismatch', subject)
        }
        sessions.push({ kind: 'materialized', ...reference })
      }
      const validate = async (): Promise<void> => {
        check()
        if (!isDeepStrictEqual(await checkpointSource('validate', { kind: 'run' },
          () => run.getPersistenceReference(cut.reference.cursor)), cut.reference)) {
          throw checkpointRule('Run reference changed', 'validate', 'source-moved', { kind: 'run' })
        }
        const current = await checkpointSource('validate', teamSubject,
          () => ctx.teams.getPersistenceReference({ kind: 'team', teamId, expectedCursor: teamReference.cursor }))
        if (!isDeepStrictEqual(current, teamReference)) throw checkpointRule('Team reference changed', 'validate', 'source-moved', teamSubject)
        for (const reference of channels) {
          check()
          if (reference.owner.kind !== 'channel') throw checkpointRule('Checkpoint channel reference has another owner kind', 'validate', 'binding-mismatch', teamSubject)
          const subject = { kind: 'channel' as const, teamId, channelId: reference.owner.channelId }
          const next = await checkpointSource('validate', subject,
            () => ctx.teams.getPersistenceReference({ ...reference.owner, expectedCursor: reference.cursor }))
          if (!isDeepStrictEqual(next, reference)) throw checkpointRule('Channel reference changed', 'validate', 'source-moved', subject)
        }
        for (const reference of sessions) {
          check()
          const sessionId = reference.kind === 'unmaterialized' ? reference.sessionId : reference.header.id
          const binding = Object.values(cut.snapshot.entities).find(entity => entity.binding?.sessionId === sessionId)?.binding
          if (binding === undefined) throw checkpointRule('Checkpoint Session has no retained entity binding', 'validate', 'binding-mismatch', teamSubject)
          const subject = { kind: 'session' as const, ...binding }
          if (reference.kind === 'unmaterialized') {
            if (!await checkpointSource('validate', subject, () => ctx.sessionPersistence.isUnmaterialized(reference.sessionId, signal))) {
              throw checkpointRule('Session materialized', 'validate', 'source-moved', subject)
            }
            continue
          }
          const next = await checkpointSource('validate', subject,
            () => ctx.sessionPersistence.getPersistenceReference(reference.header.id, reference.sequence, signal))
          if (!isDeepStrictEqual({ kind: 'materialized', ...next }, reference)) throw checkpointRule('Session reference changed', 'validate', 'source-moved', subject)
        }
        check()
      }
      await checkpointSource('validate', teamSubject,
        () => validateAcceptedTargets(ctx, cut.snapshot, channels, team.tasks, team.activations, check))
      await validate()
      return deepFreeze({ snapshot: cut.snapshot, run: cut.reference, team: teamReference, channels, sessions, validate, release,
        publish: async (id: import('@clocky/clocky-simulation').SimulationCheckpointId) => {
          const operation = cut.snapshot.checkpoints?.[id]
          if (operation?.status !== 'in-progress') throw checkpointRule('Candidate has no pending checkpoint request',
            'publish', 'manifest-mismatch', { kind: 'checkpoint', checkpointId: id })
          await validate()
          const manifest = simulationCheckpointManifestSchema.parse({ version: 2, id,
            implementationVersion: operation.request.implementationVersion, rulesVersion: cut.snapshot.spec.rulesVersion,
            policyVersion: cut.snapshot.spec.policyVersion, rng: { kind: 'none' }, run: cut.reference, team: teamReference, channels,
            sessions: sessions.map(reference => reference.kind === 'unmaterialized' ? reference : ({ kind: 'materialized', sessionId: reference.header.id, teamId: reference.header.teamId,
              participantId: reference.header.participantId, formatVersion: reference.header.version, sequence: reference.sequence,
              revision: reference.revision, fingerprint: reference.fingerprint, retention: reference.retention })),
            state: checkpointState(cut.snapshot) })
          check()
          return await checkpointSource('publish', { kind: 'checkpoint', checkpointId: id }, () => cut.publish(manifest))
        } })
    } catch (error: unknown) {
      check()
      const moved = error instanceof SimulationCheckpointError && error.diagnostic.code === 'source-moved'
        || error instanceof SessionPersistenceReferenceChanged
        || error instanceof TeamError && (error.code === 'TEAM_CURSOR_CONFLICT' || error.code === 'TEAM_CHANNEL_CURSOR_CONFLICT')
      if (!moved || attempt + 1 === maxAttempts) throw error
    }
  }
  throw new Error('Checkpoint collection has no allowed attempt')
}
