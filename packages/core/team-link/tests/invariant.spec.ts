import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as TeamLinkInvariant from '../src/invariant.ts'

describe('Team Link invariant companion', () => {
  it('registers and unregisters its explicit provider-owned invariant slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(TeamLinkInvariant)

    expect(TeamLinkInvariant.name).toBe('team-link-invariant')
    expect(TeamLinkInvariant.inject).toEqual(['invariants'])
    expect('default' in TeamLinkInvariant).toBe(false)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
