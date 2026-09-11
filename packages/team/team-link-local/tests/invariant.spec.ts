import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as TeamLinkLocalInvariant from '../src/invariant.ts'

describe('local Team Link invariant companion', () => {
  it('registers and unregisters its explicit Team-owned invariant slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(TeamLinkLocalInvariant)

    expect(TeamLinkLocalInvariant.name).toBe('team-link-local-invariant')
    expect(TeamLinkLocalInvariant.inject).toEqual(['invariants'])
    expect('default' in TeamLinkLocalInvariant).toBe(false)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
