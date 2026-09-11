import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { channelIdSchema } from '@clocky/clocky-team'
import TeamChannelAdmission from '../src/index.ts'

const contexts = new Set<Context>()

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
})

describe('Team channel admission cursor safety', () => {
  it('does not advance Team discovery after a transient Team read failure', async () => {
    let ready = false
    let teamReads = 0
    const teams = {
      listTeamsPage: vi.fn(async () => ready ? { items: [{ id: 'team-retry' }] as never, nextCursor: 0 } : { items: [] as never[] }),
      getTeam: vi.fn(async () => {
        teamReads += 1
        if (teamReads === 1) throw new Error('transient Team read')
        return { channelIds: [] }
      }),
      registerSystemChannelAdmissionProofSource: vi.fn(() => () => {}),
    }
    const ctx = new Context()
    contexts.add(ctx)
    ctx.provide('teams', teams as never)
    await ctx.plugin(TeamChannelAdmission, { scanIntervalMs: 60_000, teamPageSize: 1, maxChannelsPerPass: 1 })
    ready = true

    await expect(ctx.teamChannelAdmission.runOnce()).rejects.toThrow('transient Team read')
    await expect(ctx.teamChannelAdmission.runOnce()).resolves.toBeUndefined()
    expect(teams.listTeamsPage.mock.calls.slice(-2)).toEqual([
      [{ afterCursor: -1, limit: 1 }],
      [{ afterCursor: -1, limit: 1 }],
    ])
  })

  it('fails closed on a non-advancing channel watch', async () => {
    const teams = {
      listTeamsPage: vi.fn(async () => ({ items: [] })),
      getChannel: vi.fn(async () => ({ phase: 'pending', cursor: 4 })),
      watchChannel: vi.fn(async () => ({ kind: 'changed' as const, cursor: 4 })),
      registerSystemChannelAdmissionProofSource: vi.fn(() => () => {}),
    }
    const ctx = new Context()
    contexts.add(ctx)
    ctx.provide('teams', teams as never)
    await ctx.plugin(TeamChannelAdmission, { scanIntervalMs: 60_000, teamPageSize: 1, maxChannelsPerPass: 1 })

    await expect(ctx.teamChannelAdmission.waitUntilActive({
      channelId: channelIdSchema.parse('channel-admission-cursor'),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_CURSOR_CONFLICT' })
    expect(teams.watchChannel).toHaveBeenCalledOnce()
  })
})
