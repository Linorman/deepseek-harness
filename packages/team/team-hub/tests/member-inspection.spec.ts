/** Member detail reads one capability window without grants, statistics or other participants. */
import { expect, it } from 'vitest'
import { teamMemberInspectionSchema } from '@clocky/clocky-team'
import { projectMemberInspection } from '@clocky/clocky-team/selection'
import { createdTeam, participant, participantChanged, teamId } from './fixtures.ts'
import { recover } from './durable-replay-fixtures.ts'

it('keeps exact metadata and pages capabilities without reading grant or statistics bodies', () => {
  const member = participant({ displayName: 'Full member name', role: 'custom-role', provider: 'remote', preset: 'research',
    model: 'model', authScheme: 'token', capabilities: Array.from({ length: 1000 }, (_, index) => `capability-${index}`) })
  Object.defineProperties(member, {
    stats: { get: () => { throw new Error('Statistics scanned') } },
    authorityGrant: { get: () => { throw new Error('Grant copied') } },
    activationReservation: { get: () => { throw new Error('Startup configuration copied') } },
  })
  const request = { teamId, participantId: member.id, afterCursor: 900, limit: 2, expectedTeamCursor: 7 }
  const result = projectMemberInspection(member, 7, request, 4096)
  expect(result).toMatchObject({ ok: true, value: { teamCursor: 7, startCursor: 900, total: 1000,
    scanned: 2, items: ['capability-901', 'capability-902'], nextCursor: 902,
    record: { role: 'custom-role', provider: 'remote', preset: 'research', model: 'model', authScheme: 'token' } } })
  if (!result.ok) throw new Error(result.reason)
  expect(teamMemberInspectionSchema.parse(result.value)).toEqual(result.value)
  expect(projectMemberInspection(member, 8, request, 4096)).toEqual({ ok: false, reason: 'cursor' })
  expect(projectMemberInspection(member, 7, { ...request, teamId: participant({ teamId: 'foreign' }).teamId }, 4096))
    .toEqual({ ok: false, reason: 'owner' })
})

it('accounts for Unicode and JSON escapes and refuses an indivisible oversized field', () => {
  const member = participant({ capabilities: ['甲😀"\\\n'.repeat(10), 'second'.repeat(50), 'third'.repeat(10)] })
  const request = { teamId, participantId: member.id, afterCursor: -1, limit: 3 }
  const full = projectMemberInspection(member, 7, request, 4096)
  if (!full.ok) throw new Error(full.reason)
  const bytes = Buffer.byteLength(JSON.stringify(full.value))
  expect(projectMemberInspection(member, 7, request, bytes)).toEqual(full)
  const shorter = projectMemberInspection(member, 7, request, bytes - 1)
  if (!shorter.ok) throw new Error(shorter.reason)
  expect(Buffer.byteLength(JSON.stringify(shorter.value))).toBeLessThanOrEqual(bytes - 1)
  expect(shorter.value.nextCursor).toBeDefined()
  expect(projectMemberInspection({ ...member, role: 'x'.repeat(5000) }, 7, request, 4096)).toEqual({ ok: false, reason: 'metadata' })
  expect(projectMemberInspection({ ...member, capabilities: ['x'.repeat(5000)] }, 7, request, 4096)).toEqual({ ok: false, reason: 'row' })
  expect(projectMemberInspection(member, 7, { ...request, afterCursor: 99 }, 4096))
    .toMatchObject({ ok: true, value: { items: [], scanned: 0 } })
  expect(teamMemberInspectionSchema.safeParse({ ...full.value, nextCursor: 0 }).success).toBe(false)
  expect(teamMemberInspectionSchema.safeParse({ ...full.value, scanned: 0 }).success).toBe(false)
})

it('never exceeds a byte allowance across continuation metadata digit changes', () => {
  const member = participant({ capabilities: Array.from({ length: 15 }, (_, index) => `cap-${index}`) })
  for (let maxBytes = 200; maxBytes <= 600; maxBytes++) {
    for (const afterCursor of [-1, 8, 9, 13]) {
      const result = projectMemberInspection(member, 99, { teamId, participantId: member.id, afterCursor, limit: 15 }, maxBytes)
      if (!result.ok) continue
      expect(Buffer.byteLength(JSON.stringify(result.value))).toBeLessThanOrEqual(maxBytes)
      expect(teamMemberInspectionSchema.parse(result.value)).toEqual(result.value)
    }
  }
})

it.each(['json', 'sqlite'] as const)('replays exact member details with deployment row limits and stale-cursor rejection (%s)', async (backend) => {
  const member = participant({ capabilities: ['first', 'second', 'third'], provider: 'local' })
  const records = [createdTeam(), participantChanged({ participant: member, createdAt: 12 })]
  const ctx = await recover(backend, records, undefined, teamId, [], records.length - 1, [], { recoveryPageSize: 1 })
  const first = await ctx.teams.inspectMember({ teamId, participantId: member.id })
  expect(first.items).toEqual(['first'])
  const second = await ctx.teams.inspectMember({ teamId, participantId: member.id, afterCursor: first.nextCursor,
    expectedTeamCursor: first.teamCursor, limit: 100 })
  expect(second.items).toEqual(['second'])
  await expect(ctx.teams.inspectMember({ teamId, participantId: member.id, expectedTeamCursor: first.teamCursor - 1 }))
    .rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
  await expect(ctx.teams.inspectMember({ teamId, participantId: participant({ id: 'missing' }).id }))
    .rejects.toMatchObject({ code: 'TEAM_PARTICIPANT_NOT_FOUND' })
})
