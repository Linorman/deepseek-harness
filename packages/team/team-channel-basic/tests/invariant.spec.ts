import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as BasicInvariant from '../src/invariant.ts'

describe('basic Team-channel invariant companion', () => {
  it('registers and disposes its package-owned companion', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(BasicInvariant)
    expect(() => ctx.invariants.register('@clocky/clocky-team-channel-basic', () => {})).toThrow(/already registered/)
    await fiber.dispose()
    expect(() => ctx.invariants.register('@clocky/clocky-team-channel-basic', () => {})).not.toThrow()
    await ctx.fiber.dispose()
  })
})
