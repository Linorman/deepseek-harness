import { describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import type { TeamId, TeamSystemClosureDriverProof } from '@clocky/clocky-team'
import { TeamClosureDriveBackendRegistry } from '../src/index.ts'
import TeamClosureDriverHub from '../src/hub.ts'

describe('Team closure-driver Hub backend', () => {
  it.each(['closure', 'cancellation'] as const)('recovers an accepted %s before continuing the same cursor', async (intent) => {
    const order: string[] = []
    const team = { id: 'team-recovery' as TeamId, cursor: 7, [intent]: { kind: 'fail' } }
    const continueTeamClosure = vi.fn(async () => { order.push('continue'); return { team } })
    const getTeam = vi.fn(async () => { order.push('read'); return { team } })
    const recoverClosure = vi.fn(async () => { order.push('recover') })
    const ctx = new Context()
    ctx.provide('teams', { continueTeamClosure, getTeam } as never)
    ctx.provide('teamActivations', { recoverClosure } as never)
    await ctx.plugin(TeamClosureDriveBackendRegistry)
    await ctx.plugin(TeamClosureDriverHub, { backend: 'hub' })
    const actor = Object.freeze({}) as TeamSystemClosureDriverProof
    try {
      await ctx.teamClosureDrives.requireBackend('hub').drive({
        state: { team } as never,
        triggers: ['startup'],
        actor,
        signal: new AbortController().signal,
      })
      expect(order).toEqual(['recover', 'read', 'continue'])
      expect(recoverClosure).toHaveBeenCalledWith({ teamId: team.id, expectedCursor: 7, actor })
      expect(continueTeamClosure).toHaveBeenCalledWith({ teamId: team.id, expectedCursor: 7, actor })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('leaves a changed recovery cursor for a fresh driver proof', async () => {
    const continueTeamClosure = vi.fn()
    const ctx = new Context()
    ctx.provide('teams', {
      continueTeamClosure,
      getTeam: vi.fn(async () => ({ team: { id: 'team-recovery', cursor: 8 } })),
    } as never)
    ctx.provide('teamActivations', { recoverClosure: vi.fn(async () => undefined) } as never)
    await ctx.plugin(TeamClosureDriveBackendRegistry)
    await ctx.plugin(TeamClosureDriverHub, { backend: 'hub' })
    try {
      await ctx.teamClosureDrives.requireBackend('hub').drive({
        state: { team: { id: 'team-recovery', cursor: 7, cancellation: {} } } as never,
        triggers: ['startup'],
        actor: Object.freeze({}) as TeamSystemClosureDriverProof,
        signal: new AbortController().signal,
      })
      expect(continueTeamClosure).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('propagates recovery failure without claiming a completed Hub pass', async () => {
    const failure = new Error('termination proof is unavailable')
    const continueTeamClosure = vi.fn()
    const getTeam = vi.fn()
    const ctx = new Context()
    ctx.provide('teams', { continueTeamClosure, getTeam } as never)
    ctx.provide('teamActivations', { recoverClosure: vi.fn(async () => { throw failure }) } as never)
    await ctx.plugin(TeamClosureDriveBackendRegistry)
    await ctx.plugin(TeamClosureDriverHub, { backend: 'hub' })
    try {
      await expect(ctx.teamClosureDrives.requireBackend('hub').drive({
        state: { team: { id: 'team-recovery', cursor: 7, closure: {} } } as never,
        triggers: ['startup'],
        actor: Object.freeze({}) as TeamSystemClosureDriverProof,
        signal: new AbortController().signal,
      })).rejects.toBe(failure)
      expect(getTeam).not.toHaveBeenCalled()
      expect(continueTeamClosure).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('forwards the driver-issued Core proof and removes its backend when its fiber disposes', async () => {
    const continueTeamClosure = vi.fn(async () => ({ team: {} }))
    const ctx = new Context()
    ctx.provide('teams', { continueTeamClosure } as never)
    ctx.provide('teamActivations', { recoverClosure: vi.fn() } as never)
    const registry = await ctx.plugin(TeamClosureDriveBackendRegistry)
    const hub = await ctx.plugin(TeamClosureDriverHub, { backend: 'hub' })
    const actor = Object.freeze({}) as TeamSystemClosureDriverProof

    await ctx.teamClosureDrives.requireBackend('hub').drive({
      state: { team: { id: 'team-closure-driver' as TeamId, cursor: 7 } } as never,
      triggers: ['startup'],
      actor,
      signal: new AbortController().signal,
    })

    expect(continueTeamClosure).toHaveBeenCalledWith({
      teamId: 'team-closure-driver',
      expectedCursor: 7,
      actor,
    })
    await hub.dispose()
    expect(ctx.teamClosureDrives.getBackend('hub')).toBeUndefined()
    await registry.dispose()
    await ctx.fiber.dispose()
  })

  it.each(['teams', 'teamClosureDrives', 'teamActivations'] as const)('rejects a missing %s dependency before registering its bridge', (missing) => {
    const ctx = new Context()
    if (missing !== 'teams') ctx.provide('teams', {} as never)
    if (missing !== 'teamClosureDrives') ctx.provide('teamClosureDrives', {} as never)
    if (missing !== 'teamActivations') ctx.provide('teamActivations', {} as never)
    expect(() => new TeamClosureDriverHub(ctx, { backend: 'hub' })).toThrow('requires Team, closure-drive registry, and activation-controller services')
  })

  it('rejects a malformed backend identity before registration', () => {
    const ctx = new Context()
    ctx.provide('teams', {} as never)
    ctx.provide('teamClosureDrives', {} as never)
    expect(() => new TeamClosureDriverHub(ctx, { backend: ' hub' })).toThrow('non-empty without surrounding whitespace')
  })
})
