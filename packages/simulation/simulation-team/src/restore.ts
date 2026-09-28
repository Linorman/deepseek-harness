/** Cross-owner prefix validation before exposing a restored run for execution. @module @clocky/clocky-simulation-team/restore */
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@clocky/cordis'
import { TeamError } from '@clocky/clocky-team'
import type { TeamPersistenceReference } from '@clocky/clocky-team'
import { SessionPersistenceReferenceChanged } from '@clocky/clocky-session-persistence'
import type { SessionPersistenceReference } from '@clocky/clocky-session-persistence'
import type { SessionId } from '@clocky/clocky-session'
import type { SimulationCheckpointManifest, SimulationRun } from '@clocky/clocky-simulation'
import { validateAcceptedTargets } from './target-references.ts'

class RecoverySourceMoved extends Error {}

/**
 * Verify the manifest's retained prefixes and a stable vector of current owner states.
 * @param ctx - Authoritative Team and Session providers.
 * @param run - Exclusively held, fully replayed run not yet exposed to execution.
 * @param manifest - Completed manifest verified by run-journal replay.
 * @param maxAttempts - Positive bound on owner movement retries.
 * @param check - Service admission and cancellation check.
 * @param signal - Optional cancellation propagated to Session reads.
 * @returns the immutable lifecycle owner name; no models, world effects or Session repairs run here.
 */
export async function validateCheckpointOwners(ctx: Context, run: SimulationRun, manifest: SimulationCheckpointManifest,
  maxAttempts: number, check: () => void, signal?: AbortSignal): Promise<string> {
  const state = run.snapshot()
  const teamId = manifest.team.owner.teamId
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      check()
      const team = await ctx.teams.getTeam({ teamId })
      const ownerName = team.rules['activationLifecycleOwner']
      if (team.rules['simulationRunId'] !== state.spec.runId || typeof ownerName !== 'string' || ownerName.length === 0) {
        throw new Error('Checkpoint Team has another run or lifecycle owner')
      }
      if (team.team.parentTeamId !== undefined || team.tasks.some(task => task.execution.kind === 'child-team')) {
        throw new Error('Checkpoint recovery does not cover child-Team owners')
      }
      const references: TeamPersistenceReference[] = []
      const capture = async (owner: TeamPersistenceReference['owner'], cursor: number,
        prefix?: TeamPersistenceReference): Promise<void> => {
        check()
        const current = await ctx.teams.getPersistenceReference({ ...owner, expectedCursor: cursor })
        if (current.retention !== 'full' || current.firstSequence !== 0) throw new Error('Checkpoint owner history is not protected')
        if (prefix !== undefined) {
          const retained = await ctx.teams.getPersistenceReference({ ...owner, expectedCursor: cursor, prefixCursor: prefix.cursor })
          if (!isDeepStrictEqual(retained, prefix)) throw new Error('Checkpoint owner prefix does not match its manifest')
        }
        references.push(current)
      }
      await capture(manifest.team.owner, team.team.cursor, manifest.team)
      if (manifest.channels.some(value => !team.channelIds.includes(value.owner.channelId))) {
        throw new Error('Checkpoint channel is no longer attached to its Team')
      }
      for (const channelId of [...team.channelIds].sort()) {
        check()
        const channel = await ctx.teams.getChannel({ channelId })
        if (channel.manifest.teamId !== teamId) throw new Error('Checkpoint channel belongs to another Team')
        await capture({ kind: 'channel', channelId }, channel.cursor,
          manifest.channels.find(value => value.owner.channelId === channelId))
      }
      if (Object.values(state.channelReservations ?? {}).some(value => value.confirmed && !team.channelIds.includes(value.channelId))) {
        throw new Error('Restored run has a confirmed channel missing from its Team')
      }
      const sessions: SessionPersistenceReference[] = []
      const absent: SessionId[] = []
      const bindings = Object.values(state.entities).flatMap(entity => entity.binding === undefined ? [] : [entity.binding])
      if (manifest.sessions.some(prefix => !bindings.some(binding => binding.sessionId === prefix.sessionId
        && binding.teamId === prefix.teamId && binding.participantId === prefix.participantId))) {
        throw new Error('Checkpoint Session binding differs from the restored run')
      }
      for (const entity of Object.values(state.entities)) {
        const binding = entity.binding
        if (binding === undefined) continue
        check()
        if (binding.teamId !== teamId || !team.participants.some(value => value.id === binding.participantId)) {
          throw new Error('Restored entity has no canonical Team participant')
        }
        if (entity.writer?.activationId !== undefined && !team.activations.some(value =>
          value.activation.id === entity.writer?.activationId && value.sessionId === binding.sessionId
          && value.activation.participantId === binding.participantId)) {
          throw new Error('Checkpoint writer has no matching retained Team activation')
        }
        const prefix = manifest.sessions.find(value => value.sessionId === binding.sessionId)
        if (await ctx.sessionPersistence.isUnmaterialized(binding.sessionId, signal)) {
          if (prefix?.kind === 'materialized' || team.activations.some(value => value.sessionId === binding.sessionId
            || value.activation.participantId === binding.participantId)) {
            throw new Error('Checkpoint Session history is missing')
          }
          absent.push(binding.sessionId)
          continue
        }
        const stored = await ctx.sessionPersistence.readFrom(binding.sessionId, 0, signal)
        const current = await ctx.sessionPersistence.getPersistenceReference(binding.sessionId, stored.events.length - 1, signal)
        if (current.retention !== 'full' || current.header.teamId !== teamId || current.header.participantId !== binding.participantId) {
          throw new Error('Checkpoint Session has another binding or unprotected history')
        }
        if (prefix?.kind === 'materialized') {
          // Revisions name the current whole artifact; retained-prefix identity comes from its content fingerprint.
          const retained = await ctx.sessionPersistence.getPersistencePrefix(binding.sessionId, prefix.sequence, signal)
          if (retained.revision !== current.revision) throw new RecoverySourceMoved('Session advanced during recovery')
          if (retained.fingerprint !== prefix.fingerprint || retained.header.version !== prefix.formatVersion) {
            throw new Error('Checkpoint Session prefix does not match its manifest')
          }
        }
        sessions.push(current)
      }
      await validateAcceptedTargets(ctx, state, references, team.tasks, check)
      for (const reference of references) {
        check()
        const current = await ctx.teams.getPersistenceReference({ ...reference.owner, expectedCursor: reference.cursor })
        if (!isDeepStrictEqual(current, reference)) throw new RecoverySourceMoved('Team owner changed during recovery')
      }
      for (const reference of sessions) {
        check()
        const current = await ctx.sessionPersistence.getPersistenceReference(reference.header.id, reference.sequence, signal)
        if (!isDeepStrictEqual(current, reference)) throw new RecoverySourceMoved('Session changed during recovery')
      }
      for (const id of absent) {
        check()
        if (!await ctx.sessionPersistence.isUnmaterialized(id, signal)) throw new RecoverySourceMoved('Session materialized during recovery')
      }
      check()
      if (run.snapshot().revision !== state.revision) throw new Error('Run advanced before recovery admission')
      return ownerName
    } catch (error: unknown) {
      check()
      const moved = error instanceof RecoverySourceMoved || error instanceof SessionPersistenceReferenceChanged
        || error instanceof TeamError && (error.code === 'TEAM_CURSOR_CONFLICT' || error.code === 'TEAM_CHANNEL_CURSOR_CONFLICT')
      if (!moved || attempt + 1 === maxAttempts) throw error
    }
  }
  throw new Error('Checkpoint recovery has no allowed attempt')
}
