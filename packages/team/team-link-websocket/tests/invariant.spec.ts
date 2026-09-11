import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as TeamLinkWebSocketInvariant from '../src/invariant.ts'

describe('WebSocket Team Link invariant companion', () => {
  it('registers and unregisters its explicit external-wire invariant slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(TeamLinkWebSocketInvariant)

    expect(TeamLinkWebSocketInvariant.name).toBe('team-link-websocket-invariant')
    expect(TeamLinkWebSocketInvariant.inject).toEqual(['invariants'])
    expect('default' in TeamLinkWebSocketInvariant).toBe(false)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
