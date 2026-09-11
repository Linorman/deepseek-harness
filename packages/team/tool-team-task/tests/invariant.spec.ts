import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as ToolTeamTaskInvariant from '../src/invariant.ts'

describe('tool-team-task invariant companion', () => {
  it('registers its TeamRun-authority ownership companion', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ToolTeamTaskInvariant)
    expect(ctx.get('invariants')).toBeInstanceOf(InvariantRegistry)
    await ctx.fiber.dispose()
  })
})
