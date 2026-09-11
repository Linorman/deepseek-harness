import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as DirectInvariant from '../src/invariant.ts'

describe('direct channel invariant companion', () => {
  it('registers the package-owned explained empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(DirectInvariant)
    expect(() => ctx.invariants.register('@clocky/clocky-team-channel-direct', () => {})).toThrow(/already registered/)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
