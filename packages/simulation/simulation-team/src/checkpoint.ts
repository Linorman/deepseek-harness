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

class CandidateMoved extends Error {}

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
      if (cut.reference.firstSequence !== 0) throw new Error('Checkpoint run history has been removed')
      const team = await ctx.teams.getTeam({ teamId })
      if (team.rules['simulationRunId'] !== cut.snapshot.spec.runId) throw new Error('Checkpoint Team belongs to another run')
      if (team.rules['activationLifecycleOwner'] !== ownerName) throw new Error('Checkpoint Team has another lifecycle owner')
      if (Object.values(cut.snapshot.channelReservations ?? {}).some(value =>
        value.confirmed && !team.channelIds.includes(value.channelId))) {
        throw new Error('Checkpoint run has a confirmed channel missing from its Team')
      }
      if (team.team.parentTeamId !== undefined || team.tasks.some(task => task.execution.kind === 'child-team')) {
        throw new Error('Checkpoint collection does not cover child-Team owners')
      }
      if (team.activations.some(binding => binding.quiescedAt === undefined)) {
        throw new Error('Checkpoint Team retains an activation without confirmed quiescence')
      }
      if (team.participants.some(participant => participant.activationReservation !== undefined
        && participant.activationReservation.releasedAt === undefined
        && !team.activations.some(binding => binding.reservationId === participant.activationReservation?.id))) {
        throw new Error('Checkpoint Team retains an unpublished startup without confirmed release')
      }
      const teamReference = await ctx.teams.getPersistenceReference({ kind: 'team', teamId, expectedCursor: team.team.cursor })
      if (teamReference.retention !== 'full') throw new Error('Checkpoint Team history is not protected')
      if (teamReference.firstSequence !== 0) throw new Error('Checkpoint Team history has been removed')
      const channels: SimulationCheckpointCollection['channels'][number][] = []
      for (const channelId of [...team.channelIds].sort()) {
        check()
        const channel = await ctx.teams.getChannel({ channelId })
        if (channel.manifest.teamId !== teamId) throw new Error('Checkpoint channel belongs to another Team')
        const reference = await ctx.teams.getPersistenceReference({ kind: 'channel', channelId, expectedCursor: channel.cursor })
        if (reference.retention !== 'full') throw new Error('Checkpoint channel history is not protected')
        if (reference.firstSequence !== 0) throw new Error('Checkpoint channel history has been removed')
        channels.push(reference)
      }
      const sessions: SimulationCheckpointCollection['sessions'][number][] = []
      for (const id of Object.values(cut.snapshot.entities).map(entity => entity.id).sort()) {
        const entity = cut.snapshot.entities[id] as SimulationEntity
        const binding = entity.binding
        if (binding === undefined) continue
        check()
        if (binding.teamId !== teamId || !team.participants.some(value => value.id === binding.participantId)) {
          throw new Error('Checkpoint entity has no canonical Team participant')
        }
        if (entity.writer?.activationId !== undefined && !team.activations.some(value =>
          value.activation.id === entity.writer?.activationId && value.sessionId === binding.sessionId
          && value.activation.participantId === binding.participantId)) {
          throw new Error('Checkpoint writer has no matching retained Team activation')
        }
        if (await ctx.sessionPersistence.isUnmaterialized(binding.sessionId, signal)) {
          if (entity.writer !== undefined || team.activations.some(value => value.sessionId === binding.sessionId
            || value.activation.participantId === binding.participantId)) {
            throw new Error('Checkpoint Session history is missing for an executed entity')
          }
          sessions.push({ kind: 'unmaterialized', ...binding })
          continue
        }
        const stored = await ctx.sessionPersistence.readFrom(binding.sessionId, 0, signal)
        const reference = await ctx.sessionPersistence.getPersistenceReference(binding.sessionId, stored.events.length - 1, signal)
        if (reference.retention !== 'full') throw new Error('Checkpoint Session history is not protected')
        if (reference.header.teamId !== teamId || reference.header.participantId !== binding.participantId) {
          throw new Error('Checkpoint Session has another canonical binding')
        }
        sessions.push({ kind: 'materialized', ...reference })
      }
      const validate = async (): Promise<void> => {
        check()
        if (!isDeepStrictEqual(await run.getPersistenceReference(cut.reference.cursor), cut.reference)) throw new CandidateMoved('Run reference changed')
        const current = await ctx.teams.getPersistenceReference({ kind: 'team', teamId, expectedCursor: teamReference.cursor })
        if (!isDeepStrictEqual(current, teamReference)) throw new CandidateMoved('Team reference changed')
        for (const reference of channels) {
          check()
          if (reference.owner.kind !== 'channel') throw new Error('Checkpoint channel reference has another owner kind')
          const next = await ctx.teams.getPersistenceReference({ ...reference.owner, expectedCursor: reference.cursor })
          if (!isDeepStrictEqual(next, reference)) throw new CandidateMoved('Channel reference changed')
        }
        for (const reference of sessions) {
          check()
          if (reference.kind === 'unmaterialized') {
            if (!await ctx.sessionPersistence.isUnmaterialized(reference.sessionId, signal)) throw new CandidateMoved('Session materialized')
            continue
          }
          const next = await ctx.sessionPersistence.getPersistenceReference(reference.header.id, reference.sequence, signal)
          if (!isDeepStrictEqual({ kind: 'materialized', ...next }, reference)) throw new CandidateMoved('Session reference changed')
        }
        check()
      }
      await validateAcceptedTargets(ctx, cut.snapshot, channels, team.tasks, check)
      await validate()
      return deepFreeze({ snapshot: cut.snapshot, run: cut.reference, team: teamReference, channels, sessions, validate, release,
        publish: async (id: import('@clocky/clocky-simulation').SimulationCheckpointId) => {
          const operation = cut.snapshot.checkpoints?.[id]
          if (operation?.status !== 'in-progress') throw new Error('Candidate has no pending checkpoint request')
          await validate()
          const manifest = simulationCheckpointManifestSchema.parse({ version: 2, id,
            implementationVersion: operation.request.implementationVersion, rulesVersion: cut.snapshot.spec.rulesVersion,
            policyVersion: cut.snapshot.spec.policyVersion, rng: { kind: 'none' }, run: cut.reference, team: teamReference, channels,
            sessions: sessions.map(reference => reference.kind === 'unmaterialized' ? reference : ({ kind: 'materialized', sessionId: reference.header.id, teamId: reference.header.teamId,
              participantId: reference.header.participantId, formatVersion: reference.header.version, sequence: reference.sequence,
              revision: reference.revision, fingerprint: reference.fingerprint, retention: reference.retention })),
            state: checkpointState(cut.snapshot) })
          check()
          return await cut.publish(manifest)
        } })
    } catch (error: unknown) {
      check()
      const moved = error instanceof CandidateMoved || error instanceof SessionPersistenceReferenceChanged
        || error instanceof TeamError && (error.code === 'TEAM_CURSOR_CONFLICT' || error.code === 'TEAM_CHANNEL_CURSOR_CONFLICT')
      if (!moved || attempt + 1 === maxAttempts) throw error
    }
  }
  throw new Error('Checkpoint collection has no allowed attempt')
}
