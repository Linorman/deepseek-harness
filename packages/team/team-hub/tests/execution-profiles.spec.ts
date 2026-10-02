/** Catalog authorization and lifecycle refusals do not disclose deployment descriptors. */
import { expect, it } from 'vitest'
import { fingerprintTeamHumanActorPayload, jsonObjectSchema, teamExecutionProfileSchema } from '@clocky/clocky-team'
import type { TeamHumanActorProof, TeamHumanActorScope, TeamExecutionProfilesInput } from '@clocky/clocky-team'
import { recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, teamId, teamPhase } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('enforces current membership and invite grants for profile observations (%s)', async (backend) => {
  const human = participant({ id: 'profile-reader', kind: 'human', owner: { kind: 'product-principal', principalId: 'reader' } })
  const records = [createdTeam(), teamPhase(), ...(['invited', 'provisioning', 'active'] as const).map((phase, index) =>
    participantChanged({ participant: { ...human, phase }, createdAt: 12 + index }))]
  const ctx = await recover(backend, records, undefined, teamId, [], records.length - 1)
  const scopes = new Map<TeamHumanActorProof, TeamHumanActorScope>()
  ctx.teams.registerHumanActorProofSource({ name: 'profile-reader', resolveHumanActorProof: proof => scopes.get(proof) })
  ctx.teams.registerExecutionProfile({ profile: teamExecutionProfileSchema.parse({ id: `profile-${'a'.repeat(64)}`,
    kind: 'local-agent', role: 'worker', provider: 'runtime', model: 'mock' }), availability: () => { throw new Error('Denied reads cannot inspect deployment') } })
  const input: TeamExecutionProfilesInput = { teamId, kind: 'local-agent' }
  const actor = Object.freeze({}) as TeamHumanActorProof
  const bound = { teamId, operation: 'execution-profiles-read' as const, fence: { kind: 'read' as const }, payload: jsonObjectSchema.parse(input) }
  scopes.set(actor, { teamId, participantId: human.id, operation: bound.operation, fence: bound.fence,
    payloadFingerprint: fingerprintTeamHumanActorPayload(bound) })
  expect(await ctx.teams.getExecutionProfiles({ ...input, actor })).toMatchObject({ allowed: false, reason: 'not-authorized', items: [] })
  await expect(ctx.teams.getExecutionProfiles({ ...input, kind: 'service', actor })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  scopes.delete(actor)
  await expect(ctx.teams.getExecutionProfiles({ ...input, actor })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
})
