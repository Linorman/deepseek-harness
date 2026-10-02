/** Readiness pages retain authorization, complete byte limits and requested order on both stores. */
import { expect, it } from 'vitest'
import { fingerprintTeamHumanActorPayload, jsonObjectSchema, teamMemberReadinessPageSchema } from '@clocky/clocky-team'
import type { TeamHumanActorProof, TeamHumanActorScope, TeamMemberReadinessInput } from '@clocky/clocky-team'
import { recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, teamId, teamPhase } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('reads a finite member selection without journal changes (%s)', async (backend) => {
  const human = participant({ id: 'human-reader', kind: 'human', owner: { kind: 'product-principal', principalId: 'reader' } })
  const members = Array.from({ length: 7 }, (_, index) => participant({ id: `service-${index}`, kind: 'service' }))
  const records = [createdTeam(), teamPhase(), ...[human, ...members].flatMap((member, memberIndex) =>
    (['invited', 'provisioning', 'active'] as const).map((phase, index) => participantChanged({
      participant: { ...member, phase }, createdAt: 12 + memberIndex * 3 + index,
    })))]
  const ctx = await recover(backend, records, undefined, teamId, [], records.length - 1, [],
    { recoveryPageSize: 2, maxSelectionBytes: 900 })
  const scopes = new Map<TeamHumanActorProof, TeamHumanActorScope>()
  ctx.teams.registerHumanActorProofSource({ name: 'readiness-test', resolveHumanActorProof: proof => scopes.get(proof) })
  const read = async (input: TeamMemberReadinessInput) => {
    const actor = Object.freeze({}) as TeamHumanActorProof
    const bound = { teamId, operation: 'member-readiness-read' as const, fence: { kind: 'read' as const }, payload: jsonObjectSchema.parse(input) }
    scopes.set(actor, { teamId, participantId: human.id, operation: bound.operation, fence: bound.fence,
      payloadFingerprint: fingerprintTeamHumanActorPayload(bound) })
    try { return await ctx.teams.getMemberReadiness({ ...input, actor }) }
    finally { scopes.delete(actor) }
  }
  const before = await ctx.teams.getTeam({ teamId })
  const ids = members.map(member => member.id)
  const received: string[] = []
  let afterCursor = 0
  let pages = 0
  while (received.length < ids.length) {
    const page = await read({ teamId, participantIds: ids, afterCursor, expectedTeamCursor: before.team.cursor })
    expect(teamMemberReadinessPageSchema.parse(page)).toEqual(page)
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(900)
    expect(page.items.length).toBeLessThanOrEqual(2)
    expect(page.items.every(item => item.state === 'not-applicable' && item.reasons.includes('service-managed'))).toBe(true)
    received.push(...page.items.map(item => item.participantId))
    pages++
    if (page.nextCursor === undefined) break
    expect(page.nextCursor).toBeGreaterThan(afterCursor)
    afterCursor = page.nextCursor
  }
  expect(received).toEqual(ids)
  expect(pages).toBe(4)
  expect(await ctx.teams.getTeam({ teamId })).toEqual(before)
  await expect(read({ teamId, participantIds: ids, expectedTeamCursor: before.team.cursor - 1 }))
    .rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
  await expect(read({ teamId, participantIds: [human.id, human.id] })).rejects.toThrow()
  await expect(ctx.teams.getMemberReadiness({ teamId, participantIds: ids, actor: {} as never }))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  await expect(read({ teamId, participantIds: Array.from({ length: 100 }, (_, index) => `unread-${index}` as never) }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
})
