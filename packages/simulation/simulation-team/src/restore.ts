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
import { checkpointRule, checkpointSource } from './checkpoint-failure.ts'
import { SimulationCheckpointError } from '@clocky/clocky-simulation'

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
  const teamSubject = { kind: 'team' as const, teamId }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      check()
      const team = await checkpointSource('restore', teamSubject, () => ctx.teams.getTeam({ teamId }))
      const ownerName = team.rules['activationLifecycleOwner']
      if (team.rules['simulationRunId'] !== state.spec.runId || typeof ownerName !== 'string' || ownerName.length === 0) {
        throw checkpointRule('Checkpoint Team has another run or lifecycle owner', 'restore', 'owner-conflict', teamSubject)
      }
      if (team.team.parentTeamId !== undefined || team.tasks.some(task => task.execution.kind === 'child-team')) {
        throw checkpointRule('Checkpoint recovery does not cover child-Team owners', 'restore', 'unsupported-ownership', teamSubject)
      }
      const references: TeamPersistenceReference[] = []
      const capture = async (owner: TeamPersistenceReference['owner'], cursor: number,
        prefix?: TeamPersistenceReference): Promise<void> => {
        check()
        const subject = owner.kind === 'team' ? teamSubject : { kind: 'channel' as const, teamId, channelId: owner.channelId }
        const current = await checkpointSource('restore', subject,
          () => ctx.teams.getPersistenceReference({ ...owner, expectedCursor: cursor }))
        if (current.retention !== 'full' || current.firstSequence !== 0) throw checkpointRule('Checkpoint owner history is not protected', 'restore', 'history-incomplete', subject)
        if (prefix !== undefined) {
          const retained = await checkpointSource('restore', subject,
            () => ctx.teams.getPersistenceReference({ ...owner, expectedCursor: cursor, prefixCursor: prefix.cursor }))
          if (!isDeepStrictEqual(retained, prefix)) throw checkpointRule('Checkpoint owner prefix does not match its manifest', 'restore', 'manifest-mismatch', subject)
        }
        references.push(current)
      }
      await capture(manifest.team.owner, team.team.cursor, manifest.team)
      if (manifest.channels.some(value => !team.channelIds.includes(value.owner.channelId))) {
        throw checkpointRule('Checkpoint channel is no longer attached to its Team', 'restore', 'binding-mismatch', teamSubject)
      }
      for (const channelId of [...team.channelIds].sort()) {
        check()
        const subject = { kind: 'channel' as const, teamId, channelId }
        const channel = await checkpointSource('restore', subject, () => ctx.teams.getChannel({ channelId }))
        if (channel.manifest.teamId !== teamId) throw checkpointRule('Checkpoint channel belongs to another Team', 'restore', 'binding-mismatch', subject)
        await capture({ kind: 'channel', channelId }, channel.cursor,
          manifest.channels.find(value => value.owner.channelId === channelId))
      }
      if (Object.values(state.channelReservations ?? {}).some(value => value.confirmed && !team.channelIds.includes(value.channelId))) {
        throw checkpointRule('Restored run has a confirmed channel missing from its Team', 'restore', 'binding-mismatch', teamSubject)
      }
      const sessions: SessionPersistenceReference[] = []
      const absent: SessionId[] = []
      const bindings = Object.values(state.entities).flatMap(entity => entity.binding === undefined ? [] : [entity.binding])
      if (manifest.sessions.some(prefix => !bindings.some(binding => binding.sessionId === prefix.sessionId
        && binding.teamId === prefix.teamId && binding.participantId === prefix.participantId))) {
        throw checkpointRule('Checkpoint Session binding differs from the restored run', 'restore', 'binding-mismatch', teamSubject)
      }
      for (const entity of Object.values(state.entities)) {
        const binding = entity.binding
        if (binding === undefined) continue
        const subject = { kind: 'session' as const, ...binding }
        check()
        if (binding.teamId !== teamId || !team.participants.some(value => value.id === binding.participantId)) {
          throw checkpointRule('Restored entity has no canonical Team participant', 'restore', 'binding-mismatch', { kind: 'entity', entityId: entity.id })
        }
        if (entity.writer?.activationId !== undefined && !team.activations.some(value =>
          value.activation.id === entity.writer?.activationId && value.sessionId === binding.sessionId
          && value.activation.participantId === binding.participantId)) {
          throw checkpointRule('Checkpoint writer has no matching retained Team activation', 'restore', 'binding-mismatch', { kind: 'entity', entityId: entity.id })
        }
        const prefix = manifest.sessions.find(value => value.sessionId === binding.sessionId)
        if (await checkpointSource('restore', subject, () => ctx.sessionPersistence.isUnmaterialized(binding.sessionId, signal))) {
          if (prefix?.kind === 'materialized' || team.activations.some(value => value.sessionId === binding.sessionId
            || value.activation.participantId === binding.participantId)) {
            throw checkpointRule('Checkpoint Session history is missing', 'restore', 'history-incomplete', subject)
          }
          absent.push(binding.sessionId)
          continue
        }
        const stored = await checkpointSource('restore', subject, () => ctx.sessionPersistence.readFrom(binding.sessionId, 0, signal))
        const current = await checkpointSource('restore', subject,
          () => ctx.sessionPersistence.getPersistenceReference(binding.sessionId, stored.events.length - 1, signal))
        if (current.retention !== 'full' || current.header.teamId !== teamId || current.header.participantId !== binding.participantId) {
          throw checkpointRule('Checkpoint Session has another binding or unprotected history', 'restore', 'binding-mismatch', subject)
        }
        if (prefix?.kind === 'materialized') {
          // Revisions name the current whole artifact; retained-prefix identity comes from its content fingerprint.
          const retained = await checkpointSource('restore', subject,
            () => ctx.sessionPersistence.getPersistencePrefix(binding.sessionId, prefix.sequence, signal))
          if (retained.revision !== current.revision) throw checkpointRule('Session advanced during recovery', 'restore', 'source-moved', subject)
          if (retained.fingerprint !== prefix.fingerprint || retained.header.version !== prefix.formatVersion) {
            throw checkpointRule('Checkpoint Session prefix does not match its manifest', 'restore', 'manifest-mismatch', subject)
          }
        }
        sessions.push(current)
      }
      await checkpointSource('restore', teamSubject, () => validateAcceptedTargets(ctx, state, references, team.tasks, team.activations, check))
      for (const reference of references) {
        check()
        const subject = reference.owner.kind === 'team' ? teamSubject : { kind: 'channel' as const, teamId, channelId: reference.owner.channelId }
        const current = await checkpointSource('restore', subject,
          () => ctx.teams.getPersistenceReference({ ...reference.owner, expectedCursor: reference.cursor }))
        if (!isDeepStrictEqual(current, reference)) throw checkpointRule('Team owner changed during recovery', 'restore', 'source-moved', subject)
      }
      for (const reference of sessions) {
        check()
        const binding = bindings.find(value => value.sessionId === reference.header.id)
        if (binding === undefined) throw checkpointRule('Checkpoint Session has no retained entity binding', 'restore', 'binding-mismatch', teamSubject)
        const subject = { kind: 'session' as const, ...binding }
        const current = await checkpointSource('restore', subject,
          () => ctx.sessionPersistence.getPersistenceReference(reference.header.id, reference.sequence, signal))
        if (!isDeepStrictEqual(current, reference)) throw checkpointRule('Session changed during recovery', 'restore', 'source-moved', subject)
      }
      for (const id of absent) {
        check()
        const binding = bindings.find(value => value.sessionId === id)
        if (binding === undefined) throw checkpointRule('Checkpoint Session binding is unavailable', 'restore', 'binding-mismatch', teamSubject)
        const subject = { kind: 'session' as const, ...binding }
        if (!await checkpointSource('restore', subject, () => ctx.sessionPersistence.isUnmaterialized(id, signal))) {
          throw checkpointRule('Session materialized during recovery', 'restore', 'source-moved', subject)
        }
      }
      check()
      if (run.snapshot().revision !== state.revision) throw checkpointRule('Run advanced before recovery admission', 'restore', 'source-moved', { kind: 'run' })
      return ownerName
    } catch (error: unknown) {
      check()
      const moved = error instanceof SimulationCheckpointError && error.diagnostic.code === 'source-moved'
        || error instanceof SessionPersistenceReferenceChanged
        || error instanceof TeamError && (error.code === 'TEAM_CURSOR_CONFLICT' || error.code === 'TEAM_CHANNEL_CURSOR_CONFLICT')
      if (!moved || attempt + 1 === maxAttempts) throw error
    }
  }
  throw new Error('Checkpoint recovery has no allowed attempt')
}
