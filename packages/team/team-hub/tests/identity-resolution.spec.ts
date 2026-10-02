/** Both persistence owners resolve only requested authorized display identities. */
import { expect, it } from 'vitest'
import { fingerprintTeamHumanActorPayload, jsonObjectSchema, teamIdentityResolveInputSchema } from '@clocky/clocky-team'
import type { TeamHumanActorProof, TeamHumanActorScope, TeamIdentityResolveInput } from '@clocky/clocky-team'
import { recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, teamId, teamPhase } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('retains request order and revision fences without changing Team state (%s)', async (backend) => {
  const human = participant({ id: 'identity-reader', kind: 'human', owner: { kind: 'product-principal', principalId: 'reader' } })
  const member = participant({ id: 'identity-worker', displayName: 'Historical member' })
  const records = [createdTeam(), teamPhase(), ...[human, member].flatMap((item, memberIndex) =>
    (['invited', 'provisioning', 'active'] as const).map((phase, index) =>
      participantChanged({ participant: { ...item, phase }, createdAt: 12 + memberIndex * 3 + index })))]
  const ctx = await recover(backend, records, undefined, teamId, [], records.length - 1, [], { recoveryPageSize: 1 })
  const scopes = new Map<TeamHumanActorProof, TeamHumanActorScope>()
  ctx.teams.registerHumanActorProofSource({ name: 'identity-reader', resolveHumanActorProof: proof => scopes.get(proof) })
  const read = async (raw: TeamIdentityResolveInput) => {
    const input = teamIdentityResolveInputSchema.parse(raw)
    const actor = Object.freeze({}) as TeamHumanActorProof
    const bound = { teamId, operation: 'identity-resolve-read' as const, fence: { kind: 'read' as const }, payload: jsonObjectSchema.parse(input) }
    scopes.set(actor, { teamId, participantId: human.id, operation: bound.operation, fence: bound.fence,
      payloadFingerprint: fingerprintTeamHumanActorPayload(bound) })
    try { return await ctx.teams.resolveIdentities({ ...input, actor }) }
    finally { scopes.delete(actor) }
  }
  const before = await ctx.teams.getTeam({ teamId })
  const input = { teamId, participantIds: [member.id, 'unknown' as never, member.id] }
  const first = await read(input)
  expect(first.items).toEqual([{ participantId: member.id, state: 'resolved', displayName: { text: 'Historical member', truncated: false }, phase: 'active' }])
  expect(first.nextCursor).toBe(1)
  const last = await read({ ...input, afterCursor: first.nextCursor!, expectedTeamCursor: first.teamCursor })
  expect(last.items).toEqual([{ participantId: 'unknown', state: 'unavailable' }])
  expect(last.nextCursor).toBeUndefined()
  expect(await ctx.teams.getTeam({ teamId })).toEqual(before)
  await expect(read({ ...input, expectedTeamCursor: first.teamCursor - 1 })).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
  await expect(ctx.teams.resolveIdentities({ ...input, actor: {} as never })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
})
