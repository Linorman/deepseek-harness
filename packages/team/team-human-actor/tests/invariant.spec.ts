import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as Invariant from '../src/invariant.ts'

describe('Team human actor invariant companion', () => {
  it('registers and disposes its package-owned companion', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(Invariant)
    expect(() => ctx.invariants.register('@clocky/clocky-team-human-actor', () => {})).toThrow(/already registered/u)
    await fiber.dispose()
    expect(() => ctx.invariants.register('@clocky/clocky-team-human-actor', () => {})).not.toThrow()
    await ctx.fiber.dispose()
  })
})
