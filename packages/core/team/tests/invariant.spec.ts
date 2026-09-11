import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as TeamInvariant from '../src/invariant.ts'

describe('Team invariant companion', () => {
  it('registers and unregisters its explicit provider-owned invariant slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(TeamInvariant)

    expect(TeamInvariant.name).toBe('team-invariant')
    expect(TeamInvariant.inject).toEqual(['invariants'])
    expect('default' in TeamInvariant).toBe(false)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
