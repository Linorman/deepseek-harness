/** Discovery retains storage cursor semantics and verifies every scanned Team summary. */
import { expect, it, vi } from 'vitest'
import { StorageLogError } from '@clocky/clocky-storage-log'
import { recover } from './durable-replay-fixtures.ts'
import { createdTeam, teamId, teamPhase } from './fixtures.ts'

it('maps expired, malformed and oversized storage name scans to stable Team discovery failures', async () => {
  const ctx = await recover('json', [createdTeam(), teamPhase()])
  const scan = vi.spyOn(ctx.storageLog, 'scanNames')
  const input = { afterCursor: -1 as const, limit: 1 }
  for (const [code, expected] of [
    ['scan-expired', 'TEAM_DISCOVERY_CURSOR_EXPIRED'],
    ['scan-invalid', 'TEAM_INVALID_ARGUMENT'],
    ['scan-limit', 'TEAM_CHANNEL_BACKPRESSURE'],
  ] as const) {
    scan.mockRejectedValueOnce(new StorageLogError(code, `Storage refused ${code}`))
    await expect(ctx.teams.listTeamsPage(input)).rejects.toMatchObject({ code: expected })
  }
  const outage = new Error('Team index storage is unavailable')
  scan.mockRejectedValueOnce(outage)
  await expect(ctx.teams.listTeamsPage(input)).rejects.toBe(outage)
})

it('skips a stream removed between name scan and summary read but rejects a mismatched retained summary', async () => {
  const ctx = await recover('json', [createdTeam(), teamPhase()])
  const scan = vi.spyOn(ctx.storageLog, 'scanNames')
  scan.mockResolvedValueOnce({ names: ['team/vanished-team'], scanned: 1 })
  expect(await ctx.teams.listTeamsPage({ afterCursor: -1, limit: 1 })).toEqual({ items: [], scanned: 1 })
  const state = await ctx.teams.getTeam({ teamId })
  const read = vi.spyOn(ctx.storageLog, 'readSummary')
  read.mockResolvedValueOnce({ sequence: state.team.cursor + 1, value: state.team })
  await expect(ctx.teams.listTeamsPage({ afterCursor: -1, limit: 1 }))
    .rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
})
