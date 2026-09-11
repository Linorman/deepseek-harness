import { expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as PlacementInvariant from '../src/invariant.ts'

it('releases its invariant registration when the placement companion unloads', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(PlacementInvariant)
    expect(() => ctx.invariants.register('@clocky/clocky-team-placement-default', () => {})).toThrow(/already registered/u)
    await fiber.dispose()
    const unregister = ctx.invariants.register('@clocky/clocky-team-placement-default', () => {})
    unregister()
  } finally { await ctx.fiber.dispose() }
})
