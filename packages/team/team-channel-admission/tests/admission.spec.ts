import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { TeamError, channelIdSchema } from '@clocky/clocky-team'
import TeamChannelAdmission from '../src/index.ts'

const contexts = new Set<Context>()

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
})

describe('Team channel admission cursor safety', () => {
  it('contains scheduled recovery failures and waits for the in-flight pass during disposal', async () => {
    const started = Promise.withResolvers<undefined>()
    const held = Promise.withResolvers<{ items: [] }>()
    let firstRead = true
    const ctx = new Context()
    contexts.add(ctx)
    const warn = vi.spyOn(ctx.logger, 'warn')
    ctx.provide('teams', { listTeamsPage: vi.fn(async () => {
      if (firstRead) { firstRead = false; throw new Error('scheduled discovery failed') }
      started.resolve(undefined)
      return await held.promise
    }), registerSystemChannelAdmissionProofSource: () => () => {} } as never)
    await ctx.plugin(TeamChannelAdmission, { scanIntervalMs: 60_000, teamPageSize: 1, maxChannelsPerPass: 1 })
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('scheduled discovery failed')) })
    const consumer = ctx.teamChannelAdmission
    const first = consumer.runOnce()
    await started.promise
    expect(consumer.runOnce()).toBe(first)
    const disposing = ctx.fiber.dispose()
    held.reject(new Error('late discovery failure'))
    await expect(first).rejects.toThrow('late discovery failure')
    await disposing
    expect(warn).toHaveBeenCalledTimes(1)
    await expect(consumer.runOnce()).resolves.toBeUndefined()
  })

  it('does not warn when a scheduled failure settles after shutdown begins', async () => {
    const started = Promise.withResolvers<undefined>()
    const held = Promise.withResolvers<{ items: [] }>()
    const ctx = new Context()
    contexts.add(ctx)
    const warn = vi.spyOn(ctx.logger, 'warn')
    ctx.provide('teams', { listTeamsPage: vi.fn(async () => { started.resolve(undefined); return await held.promise }),
      registerSystemChannelAdmissionProofSource: () => () => {} } as never)
    await ctx.plugin(TeamChannelAdmission, { scanIntervalMs: 60_000, teamPageSize: 1, maxChannelsPerPass: 1 })
    await started.promise
    const disposing = ctx.fiber.dispose()
    held.reject(new Error('late shutdown failure'))
    await disposing
    expect(warn).not.toHaveBeenCalled()
  })

  it('propagates non-expiration Team discovery errors and skips non-due channels', async () => {
    let mode: 'idle' | 'error' | 'plain-error' | 'not-due' = 'idle'
    const getChannelAdmission = vi.fn(async () => ({ channel: { phase: 'pending', cursor: 3 },
      invitations: [{ status: 'pending', deadline: Date.now() + 60_000 }] }))
    const expire = vi.fn(async () => {})
    const ctx = new Context()
    contexts.add(ctx)
    ctx.provide('teams', {
      listTeamsPage: vi.fn(async () => {
        if (mode === 'error') throw new TeamError('Discovery denied', 'TEAM_INVALID_ARGUMENT')
        if (mode === 'plain-error') throw new Error('Plain discovery error')
        return mode === 'not-due' ? { items: [{ id: 'team-not-due' }] } : { items: [] }
      }),
      getTeam: vi.fn(async () => ({ team: { cursor: 4 }, channelIds: ['channel-not-due'] })),
      getChannelAdmission,
      expireChannelInvitations: expire,
      registerSystemChannelAdmissionProofSource: () => () => {},
    } as never)
    await ctx.plugin(TeamChannelAdmission, { scanIntervalMs: 60_000, teamPageSize: 1, maxChannelsPerPass: 1 })
    await ctx.teamChannelAdmission.runOnce()
    mode = 'error'
    await expect(ctx.teamChannelAdmission.runOnce()).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    mode = 'plain-error'
    await expect(ctx.teamChannelAdmission.runOnce()).rejects.toThrow('Plain discovery error')
    mode = 'not-due'
    await expect(ctx.teamChannelAdmission.runOnce()).resolves.toBeUndefined()
    expect(getChannelAdmission).toHaveBeenCalledOnce()
    expect(expire).not.toHaveBeenCalled()
  })

  it('restarts Team discovery after an expired cursor and rejects a non-advancing page', async () => {
    let mode: 'idle' | 'expired' | 'stale' = 'idle'
    const listTeamsPage = vi.fn(async () => {
      if (mode === 'expired') throw new TeamError('Expired', 'TEAM_DISCOVERY_CURSOR_EXPIRED')
      return mode === 'stale' ? { items: [], nextCursor: -1 } : { items: [] }
    })
    const ctx = new Context()
    contexts.add(ctx)
    ctx.provide('teams', { listTeamsPage,
      registerSystemChannelAdmissionProofSource: () => () => {} } as never)
    await ctx.plugin(TeamChannelAdmission, { scanIntervalMs: 60_000, teamPageSize: 1, maxChannelsPerPass: 1 })
    await ctx.teamChannelAdmission.runOnce()
    mode = 'expired'
    await expect(ctx.teamChannelAdmission.runOnce()).resolves.toBeUndefined()
    mode = 'stale'
    await expect(ctx.teamChannelAdmission.runOnce()).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
    expect(listTeamsPage).toHaveBeenLastCalledWith({ afterCursor: -1, limit: 1 })
  })

  it('expires only due pending invitations, keeps proof private, and retries an operation failure', async () => {
    let ready = false
    let failure: Error | undefined
    let resolveProof: ((proof: object) => unknown) | undefined
    const expire = vi.fn(async (input: { actor: object }) => {
      expect(() => JSON.stringify(input.actor)).toThrow(/runtime-only/)
      expect(resolveProof?.(input.actor)).toMatchObject({ kind: 'channel-invitations-expire', channelId: 'due-channel' })
      if (failure !== undefined) throw failure
    })
    const teams = {
      listTeamsPage: vi.fn(async () => ready ? { items: [{ id: 'due-team' }] } : { items: [] }),
      getTeam: vi.fn(async () => ({ team: { cursor: 4 }, channelIds: ['due-channel'] })),
      getChannelAdmission: vi.fn(async () => ({ channel: { phase: 'pending', cursor: 3 },
        invitations: [{ status: 'pending', deadline: Date.now() - 1 }] })),
      expireChannelInvitations: expire,
      registerSystemChannelAdmissionProofSource: vi.fn((source: { resolveChannelAdmissionProof(proof: object): unknown }) => {
        resolveProof = proof => source.resolveChannelAdmissionProof(proof)
        return () => {}
      }),
    }
    const ctx = new Context()
    contexts.add(ctx)
    ctx.provide('teams', teams as never)
    await ctx.plugin(TeamChannelAdmission, { scanIntervalMs: 60_000, teamPageSize: 1, maxChannelsPerPass: 1 })
    await ctx.teamChannelAdmission.runOnce()
    ready = true
    failure = new TeamError('Concurrent channel update', 'TEAM_CHANNEL_CURSOR_CONFLICT')
    await expect(ctx.teamChannelAdmission.runOnce()).resolves.toBeUndefined()
    expect(expire).toHaveBeenCalledTimes(1)
    expect(resolveProof?.(expire.mock.calls[0]![0].actor)).toBeUndefined()

    failure = new Error('provider unavailable')
    await expect(ctx.teamChannelAdmission.runOnce()).rejects.toThrow('provider unavailable')
    failure = undefined
    await expect(ctx.teamChannelAdmission.runOnce()).resolves.toBeUndefined()
    expect(expire).toHaveBeenCalledTimes(3)
  })

  it('waits through an advancing watch and rejects terminal or closed channels', async () => {
    let phase: 'pending' | 'active' | 'failed' = 'pending'
    let watchKind: 'changed' | 'closed' = 'changed'
    const teams = {
      listTeamsPage: vi.fn(async () => ({ items: [] })),
      registerSystemChannelAdmissionProofSource: () => () => {},
      getChannel: vi.fn(async () => ({ phase, cursor: phase === 'active' ? 5 : 4 })),
      watchChannel: vi.fn(async () => {
        if (watchKind === 'changed') phase = 'active'
        return watchKind === 'changed' ? { kind: 'changed', cursor: 5 } : { kind: 'closed' }
      }),
    }
    const ctx = new Context()
    contexts.add(ctx)
    ctx.provide('teams', teams as never)
    await ctx.plugin(TeamChannelAdmission, { scanIntervalMs: 60_000, teamPageSize: 1, maxChannelsPerPass: 1 })
    await expect(ctx.teamChannelAdmission.waitUntilActive({ channelId: channelIdSchema.parse('watched-channel'),
      signal: new AbortController().signal })).resolves.toMatchObject({ phase: 'active', cursor: 5 })
    phase = 'failed'
    await expect(ctx.teamChannelAdmission.waitUntilActive({ channelId: channelIdSchema.parse('watched-channel'),
      signal: new AbortController().signal })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    phase = 'pending'
    watchKind = 'closed'
    await expect(ctx.teamChannelAdmission.waitUntilActive({ channelId: channelIdSchema.parse('watched-channel'),
      signal: new AbortController().signal })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  })

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
