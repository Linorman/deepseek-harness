import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as ToolTeamInvariant from '../src/invariant.ts'

describe('tool-team invariant companion', () => {
  it('registers its intentionally empty task-report ownership companion', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ToolTeamInvariant)
    expect(ctx.get('invariants')).toBeInstanceOf(InvariantRegistry)
    await ctx.fiber.dispose()
  })
})
