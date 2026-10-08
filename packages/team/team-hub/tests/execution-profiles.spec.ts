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

it.each([
  { name: 'simulation-owned', created: { rules: { simulationRunId: 'run-profile', mode: 'local' } }, reason: 'simulation-managed' },
  { name: 'member capacity reached', created: { rules: { teamLimits: { maxParticipants: 1 } } }, reason: 'member-limit' },
  { name: 'stalled Team', created: { rules: {} }, phase: 'stalled', reason: 'team-inactive' },
  { name: 'active Team with available capacity', created: { rules: {} }, reason: undefined },
] as const)('projects execution profile choices for $name', async (row) => {
  const { created, reason } = row
  const human = participant({ id: 'profile-invite-owner', kind: 'human',
    owner: { kind: 'product-principal', principalId: 'invite-owner' },
    authorityGrant: { operations: ['invite'], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} } })
  const records = [createdTeam(created), teamPhase(), ...(['invited', 'provisioning', 'active'] as const).map((phase, index) =>
    participantChanged({ participant: { ...human, phase }, createdAt: 12 + index })),
  ...'phase' in row ? [teamPhase({ phase: row.phase, createdAt: 15,
    reason: { code: 'PROVIDER_UNAVAILABLE', message: 'A current provider is unavailable.' } })] : []]
  const ctx = await recover('json', records, undefined, teamId, [], records.length - 1)
  const scopes = new Map<TeamHumanActorProof, TeamHumanActorScope>()
  ctx.teams.registerHumanActorProofSource({ name: 'profile-invite-owner', resolveHumanActorProof: proof => scopes.get(proof) })
  const input: TeamExecutionProfilesInput = { teamId, kind: 'local-agent' }
  const actor = Object.freeze({}) as TeamHumanActorProof
  const bound = { teamId, operation: 'execution-profiles-read' as const,
    fence: { kind: 'read' as const }, payload: jsonObjectSchema.parse(input) }
  scopes.set(actor, { teamId, participantId: human.id, operation: bound.operation, fence: bound.fence,
    payloadFingerprint: fingerprintTeamHumanActorPayload(bound) })
  expect(await ctx.teams.getExecutionProfiles({ ...input, actor })).toMatchObject({
    allowed: reason === undefined, ...reason === undefined ? {} : { reason }, items: [],
  })
})
