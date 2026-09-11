import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as ClosureDriverInvariant from '../src/invariant.ts'

describe('Team closure-driver invariant companion', () => {
  it('reserves and releases its package invariant slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(ClosureDriverInvariant)

    expect(ClosureDriverInvariant.name).toBe('team-closure-driver-invariant')
    expect(ClosureDriverInvariant.inject).toEqual(['invariants'])
    expect(() => ctx.invariants.register('@clocky/clocky-team-closure-driver', () => {})).toThrow(/already registered/)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
